// The Run: the state machine that owns every pool, system and rule for one
// attempt at a stage. Everything gameplay is reachable from here, and nothing
// gameplay reaches around it.

import { CONFIG } from '../core/config.js';
import { seedRun, runRng, fxRng } from '../core/rng.js';
import { SpatialHash } from '../core/spatialHash.js';
import { Scheduler, Cooldown } from '../core/timer.js';
import { events, EV } from '../core/events.js';
import { feel } from '../core/feel.js';
import { audio } from '../core/audio.js';
import { save, rosterEntry, stageEntry } from '../core/save.js';
import { input, ACT } from '../core/input.js';
import { camera } from '../render/camera.js';
import { particles } from '../render/particles.js';
import { damageNumbers, floaters, DMG_KIND } from '../render/damageNumbers.js';
import { shake, flash } from '../render/screenShake.js';
import { atlas } from '../render/spriteAtlas.js';
import {
  clamp, dist2, TAU, lerp, angleTo, formatTime, V, dirTo,
} from '../core/math.js';

import { Player } from './player.js';
import { EnemySystem } from './enemy.js';
import { ProjectileSystem } from './projectile.js';
import { PickupSystem, PICKUP_KIND } from './pickup.js';
import { MinionSystem, MINION_ROLE } from './minion.js';
import { ObstacleField } from './obstacles.js';
import { HazardSystem } from './hazards.js';
import { WaveDirector } from './waveDirector.js';
import { AdaptiveDirector } from './adaptiveDirector.js';
import { BossController } from './boss.js';
import { RelicHooks } from './relicHooks.js';
import { WeaponSystem } from './weapons.js';
import { abilities } from './abilities/index.js';
import {
  dealDamage, damagePlayer, healPlayer, areaDamage, executeEnemy, SRC,
} from './damage.js';
import { applySlow, applyStun, applyInvuln, MARK } from './statusEffects.js';

export const RUN_STATE = {
  PLAYING: 0, LEVEL_UP: 1, CHEST: 2, RELIC_SWAP: 3, PAUSED: 4,
  VICTORY: 5, DEFEAT: 6, BOSS_INTRO: 7,
};

export class Run {
  /**
   * @param data    the loaded data layer
   * @param config  {characterId, stageId, tierIndex, seed, endless}
   */
  constructor(data, config) {
    this.data = data;
    this.config = config;
    this.seed = config.seed >>> 0 || (Date.now() & 0x7fffffff);
    seedRun(this.seed);

    this.stage = data.stages.STAGES_BY_ID[config.stageId];
    this.tier = data.stages.DIFFICULTY_TIERS[config.tierIndex || 0];
    this.modifier = this.stage.modifier ? data.stages.MODIFIERS[this.stage.modifier] : null;
    this.endless = !!config.endless;

    this.difficultyMult = {
      hp: this.tier.hpMult,
      damage: this.tier.hpMult * 0.6 + 0.4,
      speed: this.tier.speedMult,
      count: 1 + (save.data.shrine.curse || 0) * 0.10,
      reward: this.tier.rewardMult * (1 + (save.data.shrine.curse || 0) * 0.08),
    };

    this.time = 0;
    this.realTime = 0;
    this.frameParity = 0;
    this.state = RUN_STATE.PLAYING;
    this.victory = false;
    this.bossActive = false;
    this.lineStamp = 0;
    this.stageManager = null;
    this.stageManagerT = 0;

    this.bounds = {
      minX: 0, minY: 0,
      maxX: CONFIG.ARENA_W, maxY: CONFIG.ARENA_H,
    };

    // --- systems -------------------------------------------------------------
    this.camera = camera;
    this.scheduler = new Scheduler(768);
    this.enemies = new EnemySystem(this);
    this.enemyHash = new SpatialHash(CONFIG.ARENA_W + 2000, CONFIG.ARENA_H + 2000, CONFIG.SPATIAL_CELL, 4096);
    this.projectiles = new ProjectileSystem(this, false, CONFIG.MAX_PROJECTILES);
    this.enemyProjectiles = new ProjectileSystem(this, true, 600);
    this.pickups = new PickupSystem(this);
    this.minions = new MinionSystem(this);
    this.obstacles = new ObstacleField(this);
    this.hazards = new HazardSystem(this);
    this.waveDirector = new WaveDirector(this);
    this.adaptive = new AdaptiveDirector(this);
    this.boss = new BossController(this);
    this.relicHooks = new RelicHooks(this);
    // Built BEFORE the player, because Player.autoDamageMultiplier() reads its
    // multipliers on the very first recompute().
    this.weapons = new WeaponSystem(this);

    // --- player --------------------------------------------------------------
    const charDef = data.characters.CHARACTERS_BY_ID[config.characterId];
    if (!charDef) throw new Error('unknown character: ' + config.characterId);
    this.player = new Player(this, charDef);
    const rEntry = rosterEntry(charDef.id);
    this.player.starLevel = rEntry.starLevel || 1;
    this.player.bond = rEntry.bond || 0;
    this.player.recompute();
    this.player.hp = this.player.maxHp;
    this.player.x = CONFIG.ARENA_W / 2;
    this.player.y = CONFIG.ARENA_H / 2;
    this.player.px = this.player.x; this.player.py = this.player.y;

    // Shrine starting revives + Second Chance are both routed through stats.
    this.revivesLeft = this.player.stats.revives;
    this.revivesUsed = Object.create(null);

    // --- run stats -----------------------------------------------------------
    this.stats = {
      kills: 0, damageDealt: 0, damageTaken: 0, crits: 0, dodges: 0,
      gold: 0, xp: 0, levelUps: 0, elites: 0, bosses: 0,
      chests: 0, relicsFound: 0, evolutions: 0,
      dpsSamples: [], peakDps: 0,
      killedBy: null,
    };
    this._dpsWindow = 0; this._dpsAccum = 0;

    this.killStreak = { count: 0, t: 0, best: 0 };
    this.playerTrail = [];
    for (let i = 0; i < 64; i++) this.playerTrail.push({ x: this.player.x, y: this.player.y });
    this._trailIdx = 0;
    this._trailT = 0;

    // --- level-up / chest queues --------------------------------------------
    this.pendingLevelUps = 0;
    this.pendingChests = [];
    this.levelUpChoices = null;
    this.rerollsLeft = 0;
    this.banishesLeft = 0;
    this.banished = [];
    this.chestResult = null;
    this.relicOffer = null;

    // --- overlays the boss controller pushes each frame ----------------------
    this.overlays = { beams: [], rings: [], wedges: [] };
    this.qte = null;

    // --- ability wiring ------------------------------------------------------
    this.autoDef = charDef.autoAttack;
    this.specialDef = charDef.special;
    this.escapeDef = charDef.escape;
    this.passiveDef = charDef.passive;
    this.player.autoTimer.set(this.autoDef.interval / this.player.stats.attackSpeedMult);

    this._pausedTimeScale = 1;
    this._slowmoT = 0;
    this._hitstopReq = 0;

    this._init();
  }

  _init() {
    const stage = this.stage;
    // Neutralise the camera BEFORE anything reads it: culling distances derive
    // from its zoom, so leftover zoom from a previous run changes what this run
    // can see on tick zero. See Camera.reset().
    camera.reset();
    camera.setBounds(this.bounds.minX, this.bounds.minY, this.bounds.maxX, this.bounds.maxY);
    camera.snapTo(this.player.x, this.player.y);

    // Difficulty tiers can blanket-affix every mob (Kamige). DECISIONS.md §25
    // excludes the two cascading affixes from that roll.
    this.blanketAffixes = null;
    if (this.tier.allMobsAffixed) {
      this.blanketAffixes = this.data.enemies.AFFIXES.filter((a) => !a.cascading);
    }

    this.hazards.setStageHazard(stage.hazards && stage.hazards.length
      ? this.data.stages.HAZARDS[stage.hazards[0]] : null);
    this.obstacles.setStyle(stage.palette.grid || '#4a4f63');

    this.waveDirector.load(stage, this.data.waves.WAVES[stage.id] || []);

    this.rerollsLeft = this.data.upgrades.LEVELUP.freeRerolls + (save.data.shrine.rerolls || 0);
    this.banishesLeft = this.data.upgrades.LEVELUP.banishes + (save.data.shrine.banish || 0);

    this.player.xpToNext = this.xpNeeded(1);

    // The shrine/altar: one per stage, in a random location (SECTION 10).
    const a = runRng.angle(), d = runRng.range(700, 1500);
    this.altar = {
      x: clamp(this.player.x + Math.cos(a) * d, this.bounds.minX + 200, this.bounds.maxX - 200),
      y: clamp(this.player.y + Math.sin(a) * d, this.bounds.minY + 200, this.bounds.maxY - 200),
      used: false, sprite: atlas.ensure({ shape: 'triangle', color: '#ff5f7e', accent: '#3a0a18', size: 22, emoji: '⛩' }),
    };

    this.weapons.init();
    this.relicHooks.rebuild();
    abilities.onRunStart(this);
    events.emit(EV.RUN_START, this);

    // Spawn bark.
    if (this.player.def.barks && this.player.def.barks.spawn) {
      this.bark(this.player.def.barks.spawn);
    }
  }

  // --- helpers the rest of the game calls -----------------------------------
  totalEntities() {
    return this.enemies.count + this.projectiles.count + this.enemyProjectiles.count +
           this.pickups.count + this.minions.count;
  }

  get inputMoveX() { return this._imx; }
  get inputMoveY() { return this._imy; }

  aimAngle() {
    // DECISIONS.md §17 — one abstraction across mouse, pad, touch and auto.
    if (input.hasExplicitAim && !save.data.settings.autoAim) {
      return Math.atan2(input.aimY, input.aimX);
    }
    if (input.lastDevice === 'mouse') {
      return angleTo(this.player.x, this.player.y, input.mouseWorldX, input.mouseWorldY);
    }
    if (input.hasExplicitAim) return Math.atan2(input.aimY, input.aimX);
    // Fall back to the densest cluster, then to facing.
    const pop = this.enemyHash.densestCell(V, this.player.x, this.player.y, 700);
    if (pop > 0) return angleTo(this.player.x, this.player.y, V.x, V.y);
    return this.player.facing;
  }

  requestHitstop(duration, scale) { this._hitstopReq = Math.max(this._hitstopReq, duration); this._hitstopScale = scale; }
  consumeHitstop() { const d = this._hitstopReq; this._hitstopReq = 0; return d; }
  setSlowmo(scale, duration) { this._slowmoScale = scale; this._slowmoT = duration; }
  shakeMedium() { shake.medium(); }

  damageSelf(amount) { damagePlayer(this, amount, SRC.DOT, { ignoreIframes: true, trueDamage: true }); }
  heal(amount) { return healPlayer(this, amount); }

  affixesFor(id) {
    const a = this.data.enemies.AFFIXES.find((x) => x.id === id);
    return a ? [a] : null;
  }

  bark(text) {
    if (!text) return;
    floaters.spawn(this.player.x, this.player.y - 54, text, '#ffffff', 17, 2.0, this.player);
    events.emit(EV.BARK, text);
  }

  // --- XP / levelling --------------------------------------------------------
  xpNeeded(level) {
    const c = this.data.upgrades.XP_CURVE;
    return Math.ceil(c.base * Math.pow(level, c.exponent));
  }

  grantXp(amount) {
    const p = this.player;
    const gained = amount * p.stats.xpMult;
    p.xp += gained;
    this.stats.xp += gained;
    events.emit(EV.XP_GAINED, gained);
    while (p.xp >= p.xpToNext) {
      p.xp -= p.xpToNext;
      p.level++;
      p.xpToNext = this.xpNeeded(p.level);
      this.pendingLevelUps++;
      this.stats.levelUps++;
      events.emit(EV.PLAYER_LEVELUP, p.level);
    }
  }

  grantGold(amount) {
    const g = Math.round(amount * this.player.stats.goldMult *
                         (this.modifier && this.modifier.params.goldMult ? this.modifier.params.goldMult : 1));
    this.stats.gold += g;
    events.emit(EV.GOLD_GAINED, g);
  }

  // --- the tick --------------------------------------------------------------
  update(dt) {
    if (this.state === RUN_STATE.LEVEL_UP || this.state === RUN_STATE.PAUSED ||
        this.state === RUN_STATE.CHEST || this.state === RUN_STATE.RELIC_SWAP) {
      // The sim is entirely frozen on a choice screen (SECTION 2).
      return;
    }
    if (this.state === RUN_STATE.VICTORY || this.state === RUN_STATE.DEFEAT) {
      this.time += dt;
      particles.update(dt);
      return;
    }

    this.time += dt;
    this.frameParity++;
    this.overlays.beams.length = 0;
    this.overlays.rings.length = 0;
    this.overlays.wedges.length = 0;

    // --- input ---------------------------------------------------------------
    this._imx = input.moveX;
    this._imy = input.moveY;

    // --- spatial hash: rebuilt once, before anything queries it --------------
    this.enemyHash.build(this.enemies.items, this.enemies.count);

    // --- player ---------------------------------------------------------------
    this.player.update(dt);
    this._recordTrail(dt);

    // Mouse aim needs the camera's world transform.
    input.setMouseWorld(
      (input.mouseX / (this.camera.dpr || 1) - this.camera.vw / 2) / this.camera.scale + this.camera.x,
      (input.mouseY / (this.camera.dpr || 1) - this.camera.vh / 2) / this.camera.scale + this.camera.y,
      this.player.x, this.player.y);

    // --- abilities ------------------------------------------------------------
    abilities.tick(this, dt);

    // `consume`, not `pressed`: the sim does not run on every render frame, and
    // a one-frame flag is gone before a sim step ever sees it (see input.js).
    if (this.player.special.ready && !this.player.dead && input.consume(ACT.SPECIAL)) {
      if (abilities.castSpecial(this)) {
        this.player.special.use();
        camera.punch(feel.punchZoom, feel.punchDuration);
        audio.play('special');
        events.emit(EV.ABILITY_CAST, this.specialDef.id);
        this.relicHooks.fire('onSpecial');
      }
    }
    if (this.player.escape.ready && !this.player.dead && input.consume(ACT.ESCAPE)) {
      if (abilities.castEscape(this)) {
        this.player.escape.use();
        applyInvuln(this.player.st, this.escapeDef.iframes || 0.4);
        audio.play('escape');
        events.emit(EV.ESCAPE_CAST, this.escapeDef.id);
        this.relicHooks.fire('onEscape');
      }
    }

    // --- auto attack ----------------------------------------------------------
    // This is still the ONE driver for the signature weapon, deliberately: every
    // relic hook, the minion mirror and THE FINAL FORM all hang off this path,
    // and the weapon system only contributes a rate multiplier to it.
    if (!this.player.dead && !this.player.flags.autoAttackDisabled) {
      const interval = this.autoDef.interval /
        (this.player.stats.attackSpeedMult * (this.player.flags.attackSpeedBonus || 1) *
         this.weapons.mods.rate);
      this.player.autoTimer.set(Math.max(0.05, interval));
      const shots = this.player.autoTimer.tick(dt);
      for (let i = 0; i < shots; i++) {
        this.player.autoShotIndex++;
        abilities.fireAuto(this);
        // Two hooks, one event: `onAutoAttack` for relics that care about every
        // swing, `onNthAutoAttack` for the every-Nth family. Splitting them
        // means an every-8th relic is not woken 8x more often than it acts.
        this.relicHooks.fire('onAutoAttack', this.player.autoShotIndex);
        this.relicHooks.fire('onNthAutoAttack', this.player.autoShotIndex);
      }
    }

    // --- systems ---------------------------------------------------------------
    this.weapons.update(dt);
    this.enemies.update(dt);
    this.boss.update(dt);
    this.projectiles.update(dt);
    this.enemyProjectiles.update(dt);
    this.minions.update(dt);
    this.pickups.update(dt);
    this.hazards.update(dt);
    this.obstacles.update(dt);
    this.waveDirector.update(dt);
    this.adaptive.update(dt);
    this.relicHooks.tick(dt);
    this.scheduler.tick(dt);

    // --- altar ----------------------------------------------------------------
    if (!this.altar.used && dist2(this.altar.x, this.altar.y, this.player.x, this.player.y) < 70 * 70) {
      this.state = RUN_STATE.CHEST;
      this.chestResult = { kind: 'altar' };
    }

    // --- kill streak ----------------------------------------------------------
    if (this.killStreak.t > 0) {
      this.killStreak.t -= dt;
      if (this.killStreak.t <= 0) {
        if (this.killStreak.count > this.killStreak.best) this.killStreak.best = this.killStreak.count;
        this.killStreak.count = 0;
      }
    }

    // --- low HP heartbeat -----------------------------------------------------
    if (this.player.isLowHp && !this.player.dead) {
      this._hbT = (this._hbT || 0) - dt;
      if (this._hbT <= 0) { this._hbT = 1 / feel.lowHpPulseHz; audio.play('heartbeat'); }
    }

    // --- Stage Manager --------------------------------------------------------
    if (this.stageManager && this.stageManager.active) {
      this.stageManagerT += dt;
      // He accelerates. There is no outrunning him forever; that is the point.
      this.stageManager.baseSpeed = 90 + this.stageManagerT * 9;
      if (dist2(this.stageManager.x, this.stageManager.y, this.player.x, this.player.y) < 60 * 60) {
        damagePlayer(this, 1e9, SRC.HAZARD, { ignoreIframes: true, undodgeable: true, trueDamage: true });
      }
      if (this.stageManagerT >= 60) {
        save.data.stats.stageManagerSurvived = Math.max(save.data.stats.stageManagerSurvived, this.stageManagerT);
      }
    }

    // --- camera ---------------------------------------------------------------
    camera.update(dt, this.player);
    camera.shakeX = shake.x; camera.shakeY = shake.y;

    // --- DPS sampling for the harness and the results graph -------------------
    this._dpsWindow += dt;
    if (this._dpsWindow >= 1) {
      const dps = this.stats.damageDealt - this._dpsAccum;
      this._dpsAccum = this.stats.damageDealt;
      this._dpsWindow = 0;
      this.stats.dpsSamples.push(dps);
      if (dps > this.stats.peakDps) this.stats.peakDps = dps;
    }

    // --- level-up gate --------------------------------------------------------
    if (this.pendingLevelUps > 0 && this.state === RUN_STATE.PLAYING) {
      this._openLevelUp();
    } else if (this.pendingChests.length > 0 && this.state === RUN_STATE.PLAYING) {
      this._openChest();
    }

    // --- run end --------------------------------------------------------------
    if (this.endless) {
      // No time limit; difficulty keeps climbing.
    } else if (this.waveDirector.bossSpawned && !this.boss.isActive && !this.victory && this.stats.bosses > 0) {
      this._win();
    }
  }

  _recordTrail(dt) {
    this._trailT -= dt;
    if (this._trailT > 0) return;
    this._trailT = 0.08;
    this._trailIdx = (this._trailIdx + 1) % this.playerTrail.length;
    const t = this.playerTrail[this._trailIdx];
    t.x = this.player.x; t.y = this.player.y;
  }

  /** The AdaptiveDirector nudges the timeline forward when a player is bored. */
  pullWaveForward(seconds) {
    const wd = this.waveDirector;
    for (let i = wd.next; i < wd.timeline.length; i++) {
      const ev = wd.timeline[i];
      // Never pull a boss, mid-boss or calm — those anchors are load-bearing.
      if (ev.type === 'boss' || ev.type === 'midboss' || ev.type === 'calm') break;
      ev.t = Math.max(this.time, ev.t - seconds);
      break;
    }
  }

  // --- boss / elite spawning -------------------------------------------------
  spawnBoss(def, isMidBoss) {
    const a = runRng.angle();
    const x = clamp(this.player.x + Math.cos(a) * 520, this.bounds.minX + 200, this.bounds.maxX - 200);
    const y = clamp(this.player.y + Math.sin(a) * 520, this.bounds.minY + 200, this.bounds.maxY - 200);
    const e = this.boss.spawn(def, x, y, isMidBoss);
    if (e) {
      this.bossActive = true;
      this.state = RUN_STATE.PLAYING;
    }
    return e;
  }

  spawnElite(def) {
    const a = runRng.angle();
    const x = clamp(this.player.x + Math.cos(a) * 620, this.bounds.minX + 60, this.bounds.maxX - 60);
    const y = clamp(this.player.y + Math.sin(a) * 620, this.bounds.minY + 60, this.bounds.maxY - 60);
    const pool = this.data.enemies.AFFIXES;
    const n = runRng.int(1, 3);
    const affixes = [];
    const used = Object.create(null);
    for (let i = 0; i < n; i++) {
      const a2 = runRng.pick(pool);
      if (a2 && !used[a2.id]) { used[a2.id] = 1; affixes.push(a2); }
    }
    const e = this.enemies.spawn(def, x, y, { isElite: true, affixes });
    if (e) {
      e.radius *= 1.35;
      floaters.spawn(e.x, e.y - e.radius - 20, (def.name || 'ELITE').toUpperCase(), '#ffd76a', 20, 2.0);
    }
    return e;
  }

  // --- death handling ---------------------------------------------------------
  onEnemyDeath(e, src) {
    const p = this.player;

    // XP + gold drops.
    if (e.xp > 0) this.pickups.dropGem(e.x, e.y, e.xp);
    const goldChance = (e.goldChance || 0) * (1 + p.stats.luck * 0.1);
    if (runRng.chance(goldChance)) this.pickups.dropGold(e.x, e.y, runRng.int(1, 4) + (e.isElite ? 25 : 0));

    if (e.isElite) {
      this.stats.elites++;
      this.pickups.dropChest(e.x, e.y, false);
      this.relicHooks.fire('onEliteKill', e);
    }

    if (e.isBoss || e.isMidBoss) {
      this.stats.bosses++;
      this.bossActive = false;
      this.boss.onDeath();
      this.pickups.dropChest(e.x, e.y, true);
      // Every boss guarantees a relic (SECTION 9).
      const relicId = this._rollRelic();
      if (relicId) this.pickups.dropRelic(e.x + 60, e.y, relicId);
      const frag = e.isBoss
        ? this.data.shrine.FRAGMENT_AWARDS.finalBoss
        : this.data.shrine.FRAGMENT_AWARDS.midBoss;
      this.pendingFragments = (this.pendingFragments || 0) + frag;
      save.data.stats.bossKills++;
      floaters.spawn(e.x, e.y, '+' + frag + '💎', '#ffd76a', 26, 2.0);
    }

    // Random world-pickup drops.
    this._rollPickupDrop(e);

    // Kill streak callout.
    if (this.killStreak.count === feel.killStreakThreshold) {
      floaters.spawn(p.x, p.y - 70, 'KILL STREAK!', '#ffd94a', 24, 1.2);
      audio.play('killStreak');
    }

    this.enemies.onDeath(e, src);
  }

  _rollPickupDrop(e) {
    const luck = this.player.stats.luck;
    const r = runRng.raw();
    const heartWeight = 0.006 * this.adaptive.heartLuck * (1 + luck * 0.08);
    if (r < heartWeight) { this.pickups.dropPickup(e.x, e.y, 'heart'); return; }
    if (r < heartWeight + 0.0022) { this.pickups.dropPickup(e.x, e.y, 'magnet'); return; }
    if (r < heartWeight + 0.0032) { this.pickups.dropPickup(e.x, e.y, 'bomb'); return; }
    if (r < heartWeight + 0.0045) { this.pickups.dropPickup(e.x, e.y, 'bento_box'); return; }
    if (r < heartWeight + 0.0056) { this.pickups.dropPickup(e.x, e.y, 'hourglass'); return; }
    if (r < heartWeight + 0.0075) { this.pickups.dropPickup(e.x, e.y, 'coin_pile'); return; }
  }

  onPlayerLethal(src, opts) {
    const p = this.player;
    // DECISIONS.md §29 — a fixed resolution order, each source consumed once.
    const order = ['undying', 'second_chance', 'shrine_revival', 'rei_s3', 'phoenix_heart'];
    for (const k of order) {
      if (this.revivesUsed[k]) continue;
      if (!this._hasRevive(k)) continue;
      this.revivesUsed[k] = true;
      this._revive(k);
      return;
    }
    this._die(src);
  }

  _hasRevive(kind) {
    const p = this.player;
    switch (kind) {
      case 'undying': return p.flags.undying === true;
      case 'second_chance': return (p.upgrades.second_chance || 0) > 0;
      case 'shrine_revival': return (save.data.shrine.revival || 0) > 0;
      case 'rei_s3': return p.flags.reiRevive === true;
      case 'phoenix_heart': return p.evolutions.indexOf('phoenix_heart') >= 0;
      default: return false;
    }
  }

  _revive(kind) {
    const p = this.player;
    p.hp = p.maxHp * 0.5;
    applyInvuln(p.st, 2.0);
    p.iframeT = 2.0;
    flash.fire('#ffffff', 0.6, 2.5);
    shake.big();
    audio.play('levelUp');
    floaters.spawn(p.x, p.y - 60, 'STAND UP', '#ffd76a', 32, 2.2);
    particles.ring(p.x, p.y, 30, '#ffd76a', 520);
    // PHOENIX HEART: a full-screen nova and every cooldown refilled.
    if (kind === 'phoenix_heart' || p.evolutions.indexOf('phoenix_heart') >= 0) {
      areaDamage(this, p.x, p.y, 520, p.maxHp * 2, SRC.EVOLUTION, { falloff: 0.3 });
      p.special.refill(); p.escape.refill();
    }
    if (kind === 'undying') {
      abilities.cast(this, this.specialDef.id, true);   // a free Rebirth Nova
    }
    this.relicHooks.fire('onRevive', kind);
    events.emit(EV.PLAYER_REVIVED, kind);
  }

  _die(src) {
    const p = this.player;
    p.dead = true;
    p.hp = 0;
    this.state = RUN_STATE.DEFEAT;
    this.victory = false;
    this.stats.killedBy = this._describeKiller(src);
    setTimeoutLikeSlowmo(this);
    particles.burst(p.x, p.y, 24, '#ff5f7e', { speed: 260, life: 0.8, size: 1.1 });
    shake.big();
    flash.fire('#ff3a5e', 0.5, 2.4);
    events.emit(EV.PLAYER_DIED, src);
    events.emit(EV.RUN_END, this, false);
  }

  _describeKiller(src) {
    switch (src) {
      case SRC.CONTACT: return 'a crowd you could not read';
      case SRC.BOSS: return 'the boss, fair and square';
      case SRC.HAZARD: return 'the stage itself';
      case SRC.DOT: return 'something that would not stop burning';
      default: return 'something you will beat next time';
    }
  }

  _win() {
    this.victory = true;
    this.state = RUN_STATE.VICTORY;
    flash.fire('#ffffff', 0.5, 1.8);
    floaters.spawn(this.player.x, this.player.y - 80, 'VICTORY', '#ffd76a', 48, 3.0);
    audio.play('bossDie');
    events.emit(EV.RUN_END, this, true);
  }

  // --- level-up ---------------------------------------------------------------
  _openLevelUp() {
    this.pendingLevelUps--;
    this.state = RUN_STATE.LEVEL_UP;
    this.levelUpChoices = this.rollUpgradeChoices();
    audio.play('levelUp');
    flash.fire('#ffffff', 0.28, 4);
    if (this.player.def.barks && this.player.def.barks.levelUp && runRng.chance(0.35)) {
      this.bark(this.player.def.barks.levelUp);
    }
  }

  /** How many distinct upgrades are held in each bucket, and the caps. */
  buildSlots() {
    const B = this.data.upgrades.BUILD_SLOTS;
    const used = { offensive: 0, utility: 0 };
    for (const id in this.player.upgrades) {
      const up = this.data.upgrades.UPGRADES_BY_ID[id];
      if (up) used[B.bucketOf(up)]++;
    }
    return { used, max: { offensive: B.offensive, utility: B.utility } };
  }

  /**
   * The level-up offer.
   *
   * FIVE KINDS of card can appear, and the order they are considered in is the
   * order of how much they change the run:
   *
   *   weaponEvo   a maxed weapon's always-on form. Always shown when available —
   *               it is the single biggest moment in a build and burying it
   *               behind a weighted roll would mean players never see it.
   *   evolution   the classic upgrade+relic recipe. Same reasoning.
   *   newWeapon   a weapon you do not own, while a slot is free.
   *   weapon      a level on a weapon you do own.
   *   upgrade     a generic stat card.
   *
   * Weapons are deliberately weighted ABOVE stat cards: a weapon level visibly
   * changes what is on screen, and a run where the arsenal never grows is the
   * run this whole system exists to stop happening.
   */
  rollUpgradeChoices() {
    const p = this.player;
    const n = p.flags.upgradeChoices || this.data.upgrades.LEVELUP.choices;
    const B = this.data.upgrades.BUILD_SLOTS;
    const slots = this.buildSlots();
    const out = [];

    // 1. A maxed weapon waiting to evolve takes the first card, every time.
    const evolvable = this.weapons.evolvable();
    for (const w of evolvable) {
      if (out.length >= n) break;
      out.push({ kind: 'weaponEvo', w, evo: this.weapons.evolutionOf(w) });
    }

    // 2. A completed upgrade+relic recipe takes the next.
    const evo = this._availableEvolution();
    if (evo && out.length < n) out.push({ kind: 'evolution', evo });

    // 3. AN EMPTY WEAPON SLOT ALWAYS RESERVES A CARD.
    //
    // This is not generosity, it is the thing that makes the signature nerf
    // survivable. The balance harness was blunt about it: with the nerf in and
    // weapons merely competing in the pool, a ★3 starter died at 111s having
    // reached level 3 — the opening was thin, so the levels came slowly, so the
    // weapons that fix the opening never arrived. Reserving one card guarantees
    // the arsenal is filling from the very first level-up, which is where every
    // game in this genre puts it anyway.
    const pool = [];
    const weights = [];
    const luck = 1 + p.stats.luck * 0.02;

    const fresh = [], freshW = [];
    if (!this.weapons.full) {
      for (const def of this.data.weapons.WEAPONS) {
        if (this.weapons.has(def.id)) continue;
        if (this.banished.indexOf(def.id) >= 0) continue;
        fresh.push({ kind: 'newWeapon', def });
        freshW.push((def.weight || 100) * luck);
      }
      if (fresh.length && out.length < n) {
        const i = runRng.weightedIndex(freshW);
        if (i >= 0) { out.push(fresh[i]); fresh.splice(i, 1); freshW.splice(i, 1); }
      }
    }

    // 4-6. Everything else competes in one weighted pool.
    for (const w of this.weapons.slots) {
      if (this.weapons.isMaxed(w) || w.evolved) continue;
      pool.push({ kind: 'weapon', w, level: w.level + 1 });
      // A weapon you already carry is the most reliably useful card there is.
      weights.push(150 * luck);
    }
    for (let i = 0; i < fresh.length; i++) { pool.push(fresh[i]); weights.push(freshW[i] * 1.35); }
    for (const up of this.data.upgrades.UPGRADES) {
      if (this.banished.indexOf(up.id) >= 0) continue;
      if (p.isMaxed(up.id)) continue;
      // A full bucket stops offering NEW upgrades from that bucket, but never
      // stops offering to level the ones already taken.
      const owned = (p.upgrades[up.id] || 0) > 0;
      if (!owned) {
        const bucket = B.bucketOf(up);
        if (slots.used[bucket] >= slots.max[bucket]) continue;
      }
      pool.push({ kind: 'upgrade', up, level: (p.upgrades[up.id] || 0) + 1 });
      weights.push((up.weight || 100) * luck);
    }

    while (out.length < n && pool.length > 0) {
      const i = runRng.weightedIndex(weights);
      if (i < 0) break;
      out.push(pool[i]);
      pool.splice(i, 1); weights.splice(i, 1);
    }
    // If literally everything is maxed, offer gold instead of a dead screen.
    if (out.length === 0) out.push({ kind: 'gold', amount: 120 });
    return out;
  }

  _availableEvolution() {
    const p = this.player;
    for (const e of this.data.evolutions.EVOLUTIONS) {
      if (p.evolutions.indexOf(e.id) >= 0) continue;
      if (!p.isMaxed(e.requires.upgrade)) continue;
      if (!p.hasRelic(e.requires.relic)) continue;
      return e;
    }
    return null;
  }

  chooseUpgrade(index) {
    const c = this.levelUpChoices && this.levelUpChoices[index];
    if (!c) return;
    if (c.kind === 'upgrade') this.player.addUpgrade(c.up.id);
    else if (c.kind === 'evolution') this.grantEvolution(c.evo.id);
    else if (c.kind === 'newWeapon') this.grantWeapon(c.def.id);
    else if (c.kind === 'weapon') this.levelWeapon(c.w.id);
    else if (c.kind === 'weaponEvo') this.evolveWeapon(c.w.id);
    else if (c.kind === 'gold') this.grantGold(c.amount);
    this.levelUpChoices = null;
    this.state = RUN_STATE.PLAYING;
    audio.play('uiConfirm');
    this.relicHooks.fire('onLevelUp');
  }

  // --- weapons -----------------------------------------------------------------
  grantWeapon(id) {
    const w = this.weapons.add(id);
    if (!w) return false;
    floaters.spawn(this.player.x, this.player.y - 64, this.weapons.nameOf(w), '#6ad8ff', 26, 2.0);
    audio.play('relic');
    return true;
  }

  levelWeapon(id) {
    if (!this.weapons.levelUp(id)) return false;
    const w = this.weapons.get(id);
    floaters.spawn(this.player.x, this.player.y - 52,
                   this.weapons.nameOf(w) + '  Lv' + w.level, '#8ad8ff', 21, 1.4);
    return true;
  }

  /**
   * A weapon's always-on form. Deliberately NOT pushed into `player.evolutions`:
   * that array is counted against a hard-coded total of 8 by the results screen
   * and by two achievements, and quietly moving that denominator would break
   * both without an error anywhere.
   */
  evolveWeapon(id) {
    if (!this.weapons.evolve(id)) return false;
    const w = this.weapons.get(id);
    audio.play('evolve');
    flash.fire('#ffd76a', 0.5, 2.2);
    shake.big();
    camera.punch(feel.punchZoom * 1.6, 0.6);
    floaters.spawn(this.player.x, this.player.y - 76, this.weapons.evolutionOf(w).name,
                   '#ffd76a', 34, 2.6);
    particles.ring(this.player.x, this.player.y, 30, '#ffd76a', 560);
    return true;
  }

  rerollUpgrades() {
    if (this.rerollsLeft <= 0) return false;
    this.rerollsLeft--;
    this.levelUpChoices = this.rollUpgradeChoices();
    audio.play('uiMove');
    return true;
  }

  banishUpgrade(index) {
    if (this.banishesLeft <= 0) return false;
    const c = this.levelUpChoices && this.levelUpChoices[index];
    // A weapon you have not taken yet can be banished exactly like a stat card;
    // one you already carry cannot, because banishing it would strand it at the
    // level it is at with no way to ever improve it again.
    const id = c && (c.kind === 'upgrade' ? c.up.id : c.kind === 'newWeapon' ? c.def.id : null);
    if (!id) return false;
    this.banishesLeft--;
    this.banished.push(id);
    this.levelUpChoices = this.rollUpgradeChoices();
    return true;
  }

  skipUpgrade() {
    this.grantGold(this.data.upgrades.LEVELUP.skipGold);
    this.levelUpChoices = null;
    this.state = RUN_STATE.PLAYING;
  }

  grantEvolution(id) {
    const e = this.data.evolutions.EVOLUTIONS_BY_ID[id];
    if (!e || this.player.evolutions.indexOf(id) >= 0) return;
    this.player.evolutions.push(id);
    this.stats.evolutions++;
    abilities.applyEvolution(this, e);
    this.player.recompute();
    audio.play('evolve');
    flash.fire('#ffd76a', 0.5, 2.2);
    shake.big();
    floaters.spawn(this.player.x, this.player.y - 70, e.name, '#ffd76a', 34, 2.6);
    events.emit(EV.EVOLUTION, id);
  }

  // --- chests / relics ---------------------------------------------------------
  openChest(gold, x, y) {
    this.pendingChests.push({ gold, x, y });
    this.stats.chests++;
    audio.play('chest');
  }

  _openChest() {
    const c = this.pendingChests.shift();
    const T = this.data.upgrades.CHEST_TABLE;
    const table = c.gold ? T.gold : T.normal;
    let r = runRng.raw();
    let count = 1;
    for (const row of table) { r -= row.chance; if (r <= 0) { count = row.upgrades; break; } }
    // Luck nudges the roll up rather than adding a hidden extra table.
    if (runRng.chance(clamp(this.player.stats.luck * 0.05, 0, 0.5))) count = Math.min(5, count + 2);

    // A gold chest may contain a RELIC instead of stat upgrades.
    if (c.gold && runRng.chance(T.goldRelicChance)) {
      const relicId = this._rollRelic();
      if (relicId) { this.offerRelic(relicId); return; }
    }

    // A chest takes the first thing it is offered that it can actually grant.
    // It used to insist on `kind === 'upgrade'`, which would have made weapons
    // the one reward a chest could never contain.
    const granted = [];
    for (let i = 0; i < count; i++) {
      const choices = this.rollUpgradeChoices();
      const pick = choices.find((x) => x.kind === 'upgrade' || x.kind === 'weapon' ||
                                       x.kind === 'newWeapon') || choices[0];
      if (!pick) break;
      if (pick.kind === 'upgrade') { this.player.addUpgrade(pick.up.id); granted.push(pick.up); }
      else if (pick.kind === 'newWeapon') {
        if (this.grantWeapon(pick.def.id)) granted.push(chestRow(pick.def.icon, pick.def.name, 'NEW WEAPON'));
      } else if (pick.kind === 'weapon') {
        const w = pick.w;
        if (this.levelWeapon(w.id)) {
          granted.push(chestRow(this.weapons.iconOf(w), this.weapons.nameOf(w),
                                'Lv ' + w.level + ' / ' + this.weapons.maxLevel(w)));
        }
      } else if (pick.kind === 'evolution') { this.grantEvolution(pick.evo.id); }
    }
    this.chestResult = { kind: 'chest', granted, gold: c.gold };
    this.state = RUN_STATE.CHEST;
    events.emit(EV.CHEST_OPENED, c.gold, granted);
  }

  closeChest() {
    this.chestResult = null;
    this.state = RUN_STATE.PLAYING;
  }

  /** Altar: 25% of current HP for a random relic, or 200 gold for an upgrade. */
  useAltar(option) {
    const A = this.data.upgrades.SHRINE_ALTAR;
    this.altar.used = true;
    if (option === 'hp') {
      this.damageSelf(this.player.hp * A.hpCostPercent);
      const relicId = this._rollRelic();
      if (relicId) this.offerRelic(relicId); else this.closeChest();
    } else if (option === 'gold' && this.stats.gold >= A.goldCost) {
      this.stats.gold -= A.goldCost;
      this.pendingLevelUps++;
      this.closeChest();
    } else {
      this.closeChest();
    }
  }

  _rollRelic() {
    const all = this.data.relics.RELICS;
    const p = this.player;
    const weights = [];
    for (const r of all) {
      if (p.hasRelic(r.id)) { weights.push(0); continue; }
      let w = r.dropWeight || 100;
      // DECISIONS.md §9 — every relic is always in the pool; the Relic Banner
      // grants a permanent 3x weight rather than gating it.
      const banked = save.data.relics[r.id];
      if (banked && banked.banked) w *= this.data.gacha.BANNERS.find((b) => b.type === 'relic').dropWeightBonus || 3;
      // Resonance is a chase, so nudge the owner's own relic upward.
      if (r.owner === p.id) w *= 1.8;
      weights.push(w);
    }
    const i = runRng.weightedIndex(weights);
    return i >= 0 ? all[i].id : null;
  }

  offerRelic(relicId) {
    const p = this.player;
    if (p.relics.length < this.data.relics.RELIC_SLOTS) {
      p.addRelic(relicId);
      const r = this.data.relics.RELICS_BY_ID[relicId];
      this.stats.relicsFound++;
      floaters.spawn(p.x, p.y - 60, r.name, '#ffd76a', 26, 2.4);
      if (p.resonatesWith(relicId)) {
        floaters.spawn(p.x, p.y - 92, 'RESONANCE', '#ff9a3d', 22, 2.4);
        this.bark(this.player.def.barks.levelUp);
      }
      audio.play('relic');
      return;
    }
    // Finding a 4th prompts a swap decision (SECTION 11).
    this.relicOffer = relicId;
    this.state = RUN_STATE.RELIC_SWAP;
  }

  resolveRelicSwap(slotIndex) {
    const id = this.relicOffer;
    this.relicOffer = null;
    this.state = RUN_STATE.PLAYING;
    if (slotIndex >= 0 && id) {
      this.player.relics[slotIndex] = id;
      this.player.recompute();
      this.relicHooks.rebuild();
      this.stats.relicsFound++;
      audio.play('relic');
    }
  }

  // --- global effects -----------------------------------------------------------
  screenClear() {
    // Kills every non-elite on screen and drops their XP (SECTION 10).
    const items = this.enemies.items;
    const vw = camera.viewHalfW(60), vh = camera.viewHalfH(60);
    for (let i = 0; i < this.enemies.count; i++) {
      const e = items[i];
      if (e.isElite || e.isBoss || e.isMidBoss) continue;
      if (Math.abs(e.x - this.player.x) > vw || Math.abs(e.y - this.player.y) > vh) continue;
      executeEnemy(this, e, 0, SRC.HAZARD);
      i--;
    }
    flash.fire('#ffffff', 0.4, 3);
    shake.big();
    audio.play('explode');
  }

  /** The pre-boss screen clear: removes fodder without awarding anything. */
  clearFodder() {
    const items = this.enemies.items;
    for (let i = 0; i < this.enemies.count; i++) {
      const e = items[i];
      if (e.isElite || e.isBoss || e.isMidBoss) continue;
      particles.burst(e.x, e.y, 3, e.visual.color, { speed: 120, life: 0.4 });
      this.enemies.release(e);
      i--;
    }
  }

  slowAllEnemies(mult, duration) {
    const items = this.enemies.items;
    for (let i = 0; i < this.enemies.count; i++) applySlow(items[i].st, mult, duration);
    flash.fire('#c58cff', 0.25, 4);
  }

  addBuff(id, duration, mods) { return this.player.addBuff(id, duration, mods); }

  // --- overlays the boss controller pushes ---------------------------------------
  beamOverlay(x0, y0, x1, y1, w, color) { this.overlays.beams.push({ x0, y0, x1, y1, w, color }); }
  ringOverlay(x, y, r, color) { this.overlays.rings.push({ x, y, r, color }); }
  wedgeOverlay(x, y, r, a0, a1, color) { this.overlays.wedges.push({ x, y, r, a0, a1, color }); }

  startQte(q) { this.qte = q; }
  endQte(success) {
    if (this.qte) {
      floaters.spawn(this.player.x, this.player.y - 60, success ? 'BROKE FREE!' : 'CAUGHT',
                     success ? '#7bf59a' : '#ff3a5e', 26, 1.4);
    }
    this.qte = null;
  }
  mashPressed() { return input.anyMash(); }

  rotateArena(degrees) {
    // The Drum Oni's room rotation: everything orbits the player.
    const rad = degrees * Math.PI / 180;
    const cx = this.player.x, cy = this.player.y;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const rot = (e) => {
      const dx = e.x - cx, dy = e.y - cy;
      e.x = cx + dx * cos - dy * sin;
      e.y = cy + dx * sin + dy * cos;
      e.px = e.x; e.py = e.y;
    };
    for (let i = 0; i < this.enemies.count; i++) rot(this.enemies.items[i]);
    for (let i = 0; i < this.pickups.count; i++) rot(this.pickups.items[i]);
    flash.fire('#c58cff', 0.35, 3);
  }

  /** Uzu's clones and Nekromina's Deadbeats mirror the auto-attack. */
  fireMirroredAuto(minion, damage) {
    abilities.fireAutoFrom(this, minion, damage);
  }

  /**
   * Fire one extra auto-attack WITHOUT advancing the shot index — Alto's Dual
   * Blades relic. Deliberately does not advance it, so a doubled swing cannot
   * re-trigger an every-Nth relic and cascade.
   */
  fireExtraAuto() {
    if (this.player.dead) return;
    abilities.fireAuto(this);
  }

  /** THE FINAL FORM using YOUR move against you. */
  fireMirroredPlayerAbility(boss, powerMult) {
    abilities.fireMirrored(this, boss, powerMult);
  }

  // --- teardown -------------------------------------------------------------
  dispose() {
    this.enemies.clear();
    this.projectiles.clear();
    this.enemyProjectiles.clear();
    this.pickups.clear();
    this.minions.clear();
    this.hazards.clear();
    this.obstacles.clear();
    this.scheduler.clear();
    this.relicHooks.dispose();
    abilities.onRunEnd(this);
    particles.clear();
    damageNumbers.clear();
    floaters.clear();
    shake.reset();
    flash.reset();
  }

  /** The results payload — also exactly what the balance harness prints. */
  summary() {
    const avgDps = this.stats.dpsSamples.length
      ? this.stats.dpsSamples.reduce((a, b) => a + b, 0) / this.stats.dpsSamples.length : 0;
    return {
      character: this.player.id,
      stage: this.stage.id,
      tier: this.tier.id,
      seed: this.seed,
      victory: this.victory,
      time: this.time,
      level: this.player.level,
      kills: this.stats.kills,
      damageDealt: this.stats.damageDealt,
      damageTaken: this.stats.damageTaken,
      // DECISIONS.md §14 — both definitions are reported so the target can never
      // be quietly fudged into being met.
      dpsTotal: avgDps,
      dpsPeak: this.stats.peakDps,
      killsPerSecond: this.time > 0 ? this.stats.kills / this.time : 0,
      gold: this.stats.gold,
      fragments: this.pendingFragments || 0,
      elites: this.stats.elites,
      bosses: this.stats.bosses,
      relics: this.player.relics.slice(),
      weapons: this.weapons.summary(),
      evolutions: this.player.evolutions.slice(),
      upgrades: Object.assign({}, this.player.upgrades),
      levelUps: this.stats.levelUps,
      killedBy: this.stats.killedBy,
      bestStreak: Math.max(this.killStreak.best, this.killStreak.count),
      dpsSamples: this.stats.dpsSamples.slice(),
    };
  }
}

/**
 * A chest-reveal row that is not a stat upgrade.
 *
 * The reveal renderer reads `icon`, `name`, `tier` and formats `perLevel` with
 * `fmt` — so a weapon row supplies exactly those fields with `fmt` already
 * resolved to the line it should print. Cheaper and far less fragile than
 * teaching the reveal screen a second row type.
 */
function chestRow(icon, name, line) {
  return { icon, name, tier: 'rare', perLevel: 0, unit: 'flat', fmt: line };
}

/** Death slow-mo, expressed through the run's own time scale (deterministic). */
function setTimeoutLikeSlowmo(run) {
  run.setSlowmo(0.25, 1.2);
}
