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
import { save, rosterEntry, stageEntry, addCurrency } from '../core/save.js';
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
import { StageEventSystem } from './stageEvents.js';
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

/**
 * Seconds of warning between "your build is finished" and the pre-boss calm, when
 * the finale is called early (Run.callBossEarly). The calm itself then runs for
 * feel.preBossCalm and the boss lands 5s after it starts — the same shape the
 * authored timeline uses at duration-60s / duration-55s, so the arrival reads
 * identically whether it was earned or waited for.
 */
const EARLY_BOSS_LEAD = 10;

/** Frozen stand-in for a missing `reward` block. Never written to. */
const EMPTY_REWARD = {};

/**
 * THE GRIND MINUTE.
 *
 * Play report: "make the final boss spawn if the player has no more upgrades to
 * claim and it's just currency claims — give a 1 min countdown so the player can
 * grind some more coins just before he spawns."
 *
 * So the finale is no longer CALLED the moment a build finishes; a sixty second
 * countdown starts instead, on screen, and the call happens inside it. The minute
 * is not padding. Gold is the only thing a finished build can still earn, the
 * shrine is the only place it goes, and a player told "you are done" with ten
 * seconds of warning cannot act on it — sixty seconds of a fully-covered arena at
 * a finished build's kill rate is a real payout, and it is the last one the run
 * has left to give.
 *
 * Exported because the HUD draws the drain bar as a fraction of it, and a HUD
 * that hard-codes its own 60 is a HUD that lies the first time this is retuned.
 */
export const FINALE_COUNTDOWN = 60;

/**
 * The tail of that countdown that belongs to callBossEarly's OWN sequence:
 * EARLY_BOSS_LEAD of warning, then feel.preBossCalm of silence, then the boss —
 * the same shape the authored timeline uses at duration-60s / duration-55s. The
 * call is therefore made at T-15 rather than at T-0, so the number on the HUD
 * reaches zero exactly as the boss walks on instead of fifteen seconds before it.
 */
const FINALE_HANDOVER = EARLY_BOSS_LEAD + 5;

/**
 * How often nothingLeftToClaim() is evaluated, as a mask on the SIM TICK counter
 * — every 32 ticks, a little over half a second at the fixed 60Hz step. It walks
 * the weapon rack and the whole upgrade table, which is cheap but not free, and
 * nothing about a finished build can change inside half a second.
 *
 * `frameParity` is a tick counter and never a frame counter (run.update only
 * advances it on a PLAYING tick), so the poll lands on the same ticks in every
 * replay of a seed. Same idiom as hazards.js and star4.js.
 */
const FINALE_POLL_MASK = 31;

/** Scratch for the altar's push-out. Written once per run, never read across. */
const ALTAR_FIX = { x: 0, y: 0 };

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

    // CURSE is one of the three rows the RUN reads for itself out of
    // save.data.shrine (shrine.js `scope: 'run'`). Its two per-level amounts are
    // DATA: read them off the row rather than repeating them here, or shrine.js
    // and this file can quietly disagree about what the card promised.
    const curseLv = save.data.shrine.curse || 0;
    const curseFx = (this.data.shrine.SHRINE_UPGRADES_BY_ID.curse || {}).effects || [];
    const perCount = (curseFx[0] && curseFx[0].perLevel) || 0;
    const perReward = (curseFx[1] && curseFx[1].perLevel) || 0;
    const curseReward = 1 + curseLv * perReward;

    this.difficultyMult = {
      hp: this.tier.hpMult,
      damage: this.tier.hpMult * 0.6 + 0.4,
      speed: this.tier.speedMult,
      count: 1 + curseLv * perCount,
      /**
       * GOLD AND STAR FRAGMENTS. Read by grantGold() and by the boss payout in
       * onEnemyDeath().
       *
       * THIS FIELD WAS COMPUTED AND READ BY NOTHING for the entire life of the
       * project. Curse's advertised "+8% all rewards per level" paid exactly
       * zero, which made a 34,000-gold row that doubles the enemy count a
       * strictly negative purchase; and every difficulty tier's rewardMult —
       * Kamige's x2.5, printed on the stage-select card as "REW x2.5" — paid
       * exactly zero with it. The only thing that ever read it was the test that
       * was supposed to prove it was alive, which asserted the field had been
       * ASSIGNED rather than that anything consumed it.
       */
      reward: this.tier.rewardMult * curseReward,
      /**
       * XP. Curse's half ONLY, deliberately. Curse's card names XP explicitly so
       * Curse pays on XP; a difficulty TIER's rewardMult does not, because
       * multiplying the XP curve by 2.5 on Kamige is a rewrite of level pacing
       * rather than a payout.
       */
      rewardXp: curseReward,
    };

    this.time = 0;
    this.realTime = 0;
    this.frameParity = 0;
    this.state = RUN_STATE.PLAYING;
    this.victory = false;
    this.bossActive = false;
    /** True while the live boss is an extra mini-boss rather than the signature. */
    this.miniBossActive = false;
    /** The entity the timeline spawned as the FINALE, and whether it is dead. */
    this.finalBossEntity = null;
    this.finalBossKilled = false;
    /** Latch: the finished-build early call fires at most once per run. */
    this.bossCalledEarly = false;
    /**
     * THE FINALE COUNTDOWN, in seconds of sim time, or -1 when nothing is
     * counting. Set by _startFinaleCountdown, drained by _tickFinale, read by the
     * HUD. It floors at 0 rather than going negative — see _tickFinale for why 0
     * is a state the player can actually be left sitting in.
     */
    this.finaleCountdown = -1;
    /** Latch: the countdown starts at most once per run, and never restarts. */
    this.finaleCountdownFired = false;
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
    this.stageEvents = new StageEventSystem(this);
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

    // REVIVES ARE COUNTED PER SOURCE, NOT AS A POOL. `_reviveCharges()` asks each
    // source how many charges it grants — the Shrine's Revival row is read
    // straight out of save.data.shrine.revival there — `revivesUsed` counts
    // charges SPENT per source, and `revivesLeftNow()` is the only number the HUD
    // may draw. There is deliberately no `revivesLeft` snapshot here: it was
    // assigned once at run start from `player.stats.revives`, read by nothing, and
    // was wrong anyway (that stat sees the Shrine row and Second Chance but not
    // Undying, Rei's S3 or Phoenix Heart).
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
    /**
     * WHICH LEVEL-UP SCREEN THIS IS, counted from zero. The weapon cadence in
     * rollUpgradeChoices() is a pure function of it, which is the entire reason
     * it is a counter of SCREENS SHOWN and not `stats.levelUps`: a reroll rolls
     * the same screen again, and if the cadence moved underneath it a reroll
     * could conjure a weapon card out of a screen that was not allowed one, or
     * delete the one the player was about to take.
     *
     * IT ADVANCES WHEN THE SCREEN IS DISMISSED, NOT WHEN IT OPENS — chooseUpgrade
     * and skipUpgrade, the only two ways out. It used to advance immediately
     * after the opening roll, which meant it named the NEXT screen for the entire
     * time the current one was on-screen, and that is the exact failure the
     * paragraph above warns about: every reroll and every banish re-rolled at a
     * cadence position one ahead of the screen the player was looking at, so a
     * reroll on screen 2 could hand out a weapon card that screen 2 was never
     * entitled to. The level-up screen's "next weapon offer in N levels" hint was
     * reading the same field and was off by one in both directions because of it.
     */
    this.levelUpIndex = 0;
    this.rerollsLeft = 0;
    this.banishesLeft = 0;
    this.banished = [];
    this.chestResult = null;
    /**
     * The weapon the pachinko parlour rolled, held between the screen opening
     * and the button being pressed. Kept OFF `chestResult` on purpose: that
     * object is what the UI reads, and a live weapon def on it is an invitation
     * for the screen to start granting things itself.
     */
    this.pachinkoPrize = null;
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

    // The stage's own static blockers. `stage.obstacles` had been a field that
    // NOTHING READ since it was written — five of seven stages were flat empty
    // floors and the other two only had geometry because a hazard dropped some.
    // The LOOK is set here; the SCATTER waits until the altar exists below,
    // because the altar is one of the two positions a piece may never land on.
    this.obstacleSet = this.data.stages.OBSTACLE_SETS[stage.obstacles] || null;
    this.obstacles.setStyle(this.obstacleSet);

    this.waveDirector.load(stage, this.data.waves.WAVES[stage.id] || []);

    this.rerollsLeft = this.data.upgrades.LEVELUP.freeRerolls + (save.data.shrine.rerolls || 0);
    this.banishesLeft = this.data.upgrades.LEVELUP.banishes + (save.data.shrine.banish || 0);

    this.player.xpToNext = this.xpNeeded(1);

    // The shrine/altar: one per stage, in a random location (SECTION 10).
    const a = runRng.angle(), d = runRng.range(700, 1500);
    this.altar = {
      x: clamp(this.player.x + Math.cos(a) * d, this.bounds.minX + 200, this.bounds.maxX - 200),
      y: clamp(this.player.y + Math.sin(a) * d, this.bounds.minY + 200, this.bounds.maxY - 200),
      used: false,
      /** Gold offers taken this visit. SHRINE_ALTAR.goldUses caps it. */
      goldUses: 0,
      sprite: atlas.ensure({ shape: 'triangle', color: '#ff5f7e', accent: '#3a0a18', size: 22, emoji: '⛩' }),
    };

    // Now that both keep-out positions are known, populate the map. AUTHORED
    // PIECES FIRST: a stage that is a place rather than a field — a courtyard
    // with a gate, a path and a fountain — puts its furniture where the design
    // says, and the scatter then fills the ground AROUND it, because scatter's
    // own `spacing` test measures against everything already down.
    if (this.obstacleSet) {
      this.obstacles.place(this.obstacleSet);
      this.obstacles.scatter(this.obstacleSet);
      // THE ALTAR IS PLACED BEFORE THE GEOMETRY IS, so on a stage whose layout
      // is AUTHORED rather than scattered it can land inside a wall — scatter's
      // `clearance` holds itself off the altar, but a wall written by hand knows
      // nothing about a position rolled sixteen lines earlier. Pushing it out
      // afterwards is the fix that cannot go stale as layouts change. Inside a
      // BUILDING is fine and even good: it is a reason to go in.
      if (this.obstacles.pushOut(this.altar.x, this.altar.y, 60, ALTAR_FIX)) {
        this.altar.x = ALTAR_FIX.x;
        this.altar.y = ALTAR_FIX.y;
      }
    }
    this.stageEvents.load(stage, this.data.stages.STAGE_EVENTS);

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
  /**
   * A PURE FUNCTION OF LEVEL. The HUD calls this every frame, the results screen
   * calls it after the run is over and the balance harness calls it with levels
   * this run never reached — so it may never read `this.time`, `this.player` or
   * anything else that moves. See the XP_CURVE comment in data/upgrades.js for
   * where the four constants came from and what they were measured against.
   *
   * The MAX_SAFE_INTEGER clamp is not defensive noise: with two compounding terms
   * the raw product reaches Infinity somewhere past level 1,400, and Infinity
   * would flow straight into the HUD's `xp / xpToNext` fill ratio. A finite
   * ceiling keeps every consumer in real numbers no matter what endless mode does.
   */
  xpNeeded(level) {
    const c = this.data.upgrades.XP_CURVE;
    let v = c.base * Math.pow(level, c.exponent);
    if (level > c.softCap) v *= Math.pow(c.softGrowth, level - c.softCap);
    if (level > c.hardCap) v *= Math.pow(c.hardGrowth, level - c.hardCap);
    return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(v));
  }

  grantXp(amount) {
    const p = this.player;
    // `rewardXp`, not `reward`: Curse pays on XP, difficulty tiers do not.
    const gained = amount * p.stats.xpMult * this.difficultyMult.rewardXp;
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
    const g = Math.round(amount * this.player.stats.goldMult * this.difficultyMult.reward *
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
    // And the broadphase margin with it, from the same array, in the same place,
    // for the same reason: everything downstream queries it and nothing may see
    // a stale one. Anything spawned LATER this tick raises it in spawn().
    this.enemies.refreshQueryPad();

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
      // A FREE PRESS IS A REAL THING. `flags.escapeFree` is how an escape says
      // "this press moved me and paid for nothing else" — cleared before every
      // cast, so only the ability that just ran can have set it.
      //
      // It exists because an escape is allowed to have no cooldown at all
      // (Torii Warp does), and everything below this line is per-press: the
      // i-frames, every onEscape relic (Anchor Gear detonates for 60, Kaio-ken
      // hands out a buff) and the cast event. At six presses a second a 0.5s
      // i-frame window is permanent invulnerability — DECISIONS.md §28's
      // infinite loop, arriving through the front door rather than through the
      // ZERO COOLDOWN evolution it was written to stop. An escape that wants a
      // free press meters its own payload and declares the free ones here.
      this.player.flags.escapeFree = false;
      if (abilities.castEscape(this)) {
        this.player.escape.use();
        if (!this.player.flags.escapeFree) {
          applyInvuln(this.player.st, this.escapeDef.iframes || 0.4);
          audio.play('escape');
          events.emit(EV.ESCAPE_CAST, this.escapeDef.id);
          this.relicHooks.fire('onEscape');
        }
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
    // After the hazards, so an event that started this tick is already placed
    // when the wave director decides what to walk on next to it.
    this.stageEvents.update(dt);
    this.waveDirector.update(dt);
    this.adaptive.update(dt);
    this.relicHooks.tick(dt);
    this.scheduler.tick(dt);

    // --- altar ----------------------------------------------------------------
    // `pendingLevelUps === 0` is what makes the altar's repeat purchases legible:
    // buy a level-up, get the cards, THEN get offered the counter again. Without
    // it the offer screen would re-open on the very next tick and the level-up it
    // just sold you would queue up behind it, unseen.
    if (!this.altar.used && this.pendingLevelUps === 0 &&
        dist2(this.altar.x, this.altar.y, this.player.x, this.player.y) < 70 * 70) {
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

    // --- the finale countdown -------------------------------------------------
    // Deliberately BEFORE the level-up gate: _openLevelUp sets `state`, and the
    // top of this method returns early on it, so a call placed after the gate
    // would silently drop one tick on every single level-up.
    this._tickFinale(dt);

    // --- level-up gate --------------------------------------------------------
    if (this.pendingLevelUps > 0 && this.state === RUN_STATE.PLAYING) {
      this._openLevelUp();
    } else if (this.pendingChests.length > 0 && this.state === RUN_STATE.PLAYING) {
      this._openChest();
    }

    // --- run end --------------------------------------------------------------
    //
    // THE WIN IS LATCHED TO THE FINALE'S OWN ENTITY, not to "the boss controller
    // has nobody in it". BossController holds exactly one `active` boss and its
    // onDeath() nulls that slot for whichever boss just died — so a mini-boss
    // still standing when the finale walks on, and killed a moment later, used to
    // clear the slot and hand out a VICTORY with the real boss at full health.
    // That was reachable before this pass and it is very reachable now that the
    // closer mini-boss lands at 0.78. `stats.bosses > 0` did not catch it either:
    // mini-bosses count toward that.
    if (this.endless) {
      // No time limit; difficulty keeps climbing.
    } else if (this.finalBossKilled && !this.victory) {
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

  /**
   * THE BUILD IS FINISHED — its SHAPE, not its levels. Every weapon slot filled,
   * every one of those weapons evolved, and both upgrade buckets at their cap, so
   * nothing can be ADDED to this build any more.
   *
   * IT IS NOT "there are no cards left", and this comment used to claim it was.
   * A capped bucket only stops offering upgrades you do NOT hold — see the
   * `if (!owned)` in rollUpgradeChoices — so the three you hold in each bucket
   * keep offering LEVELS for a long time after this goes true. The comment on the
   * end-of-run top-up a few dozen lines below says so plainly: the pool runs dry
   * "somewhere past level-up 30 of a run that reaches 40".
   *
   * The predicate that actually means "the screen is gold and nothing else" is
   * nothingLeftToClaim(), and it is the one the finale countdown reads. This one
   * is kept because it is a legitimate second trigger for the same countdown and
   * because DECISIONS.md §47 named it.
   */
  buildComplete() {
    const w = this.weapons;
    // An empty slot is still something to earn, so a 3-weapon run does not count
    // as finished just because those three happen to be evolved.
    if (w.count < w.max) return false;
    for (const s of w.slots) if (!s.evolved) return false;
    const b = this.buildSlots();
    return b.used.offensive >= b.max.offensive && b.used.utility >= b.max.utility;
  }

  /**
   * BRING THE HEADLINER OUT EARLY.
   *
   * Play report: "make the final boss appear sooner if the player has evolved ALL
   * of their upgrades to max." They are right that it is dead time — a finished
   * build spends the rest of the timeline killing fodder for a level-up screen
   * that has nothing on it.
   *
   * This is deliberately NOT pullWaveForward(). That method refuses to move a
   * boss, a mid-boss or a calm, and that refusal is correct: it exists for the
   * AdaptiveDirector, which nudges the timeline every time a player looks bored,
   * and letting an automatic difficulty heuristic slide the finale around would
   * dismantle every pacing anchor in the stage. This is the one sanctioned
   * exception — player-earned, once per run, latched, and announced on screen so
   * it reads as the reward it is rather than a scheduling bug.
   *
   * The rest of the timeline is RETIRED rather than left to fire. A boss fight
   * with eleven authored spawn waves still landing on top of it is not a boss
   * fight, and there is nothing left in those waves the player has not finished
   * earning. The baseline trickle still holds the arena to SECTION 8's density
   * curve right up to the calm.
   */
  callBossEarly() {
    const wd = this.waveDirector;
    // Endless mode has no finale to bring forward — the whole point of it is that
    // the timeline never ends.
    if (this.bossCalledEarly || this.endless || wd.bossSpawned) return false;
    // Not on top of a fight already in progress. BossController holds one boss,
    // so the finale would take the slot and leave a live mid-boss standing there
    // with no AI. Nothing is latched on this path, so the next level-up — and
    // there is always another, even if every card on it is gold — tries again.
    if (this.boss.isActive) return false;

    let boss = null, calm = null;
    for (let i = wd.next; i < wd.timeline.length; i++) {
      const ev = wd.timeline[i];
      if (ev.fired) continue;
      if (ev.type === 'boss') boss = ev;
      else if (ev.type === 'calm') calm = ev;
    }
    if (!boss) return false;
    // Already effectively here; moving it would only shorten its own warning.
    if (boss.t - this.time <= EARLY_BOSS_LEAD + feel.preBossCalm + 4) return false;

    for (let i = wd.next; i < wd.timeline.length; i++) {
      const ev = wd.timeline[i];
      if (ev !== boss && ev !== calm) ev.fired = true;
    }
    if (calm) calm.t = this.time + EARLY_BOSS_LEAD;
    boss.t = this.time + EARLY_BOSS_LEAD + 5;
    wd.resort();
    this.bossCalledEarly = true;

    // Two lines, not three: `bark` spawns its own floater at -54 and emits
    // EV.BARK with the text, so this reads as a headline and a subtitle.
    const p = this.player;
    floaters.spawn(p.x, p.y - 104, 'NOTHING LEFT TO LEARN', '#ffd76a', 32, 3.4);
    this.bark('The headliner is coming out early.');
    audio.play('evolve');
    flash.fire('#ffd76a', 0.45, 2.0);
    shake.medium();
    return true;
  }

  /**
   * IS THERE ANYTHING LEFT IN THIS RUN TO CLAIM?
   *
   * TRUE means the next level-up screen will be `[{ kind: 'gold' }]` and nothing
   * else: every one of the five sources rollUpgradeChoices draws from is empty,
   * so the only thing levelling can still pay out is currency.
   *
   * THIS IS A STRONGER SIGNAL THAN buildComplete(), AND A DIFFERENT ONE.
   * buildComplete() asks whether the SHAPE of the build is finished. It says
   * nothing about the LEVELS of the upgrades in those capped buckets, so it goes
   * true while there are still real cards on the screen — and it also stays FALSE
   * forever in the one state that most needs catching: a weapon maxed out behind
   * an evolution requirement naming an upgrade your full buckets can no longer
   * accept. That run can never evolve it, never widen, never level anything, and
   * buildComplete() never fires for it.
   *
   * IT MIRRORS rollUpgradeChoices SOURCE BY SOURCE AND CONSUMES NO RNG. Calling
   * the roll itself to find out would advance runRng and desync every seeded
   * replay in the project — the balance sweep, the render smoke test, the ability
   * runtime suite — which is why this is a parallel predicate rather than a peek
   * at the real thing. If a card source is ever added to rollUpgradeChoices, it
   * has to be added here too, and the test below is what will say so.
   *
   * ONE DELIBERATE DIVERGENCE: the arsenal budget. _rollWeaponCard is passed
   * mayExpandArsenal(), which is a CADENCE — a screen paying gold only because
   * the next weapon slot has not been earned yet is not a run with nothing left,
   * it is a run WAITING, and the slot opens on its own as those gold screens
   * advance levelUpIndex. So this asks `!weapons.full` instead, which is the
   * permanent version of the same question.
   */
  nothingLeftToClaim() {
    const ws = this.weapons;
    const p = this.player;

    // 1 + 2. An evolve card and a build evolution are both real cards.
    if (ws.evolvable().length > 0) return false;
    if (this._availableEvolution()) return false;

    // 3 + 5. Any weapon card at all — a weapon you do not own while a slot is
    //        free, or a level on one you carry. See the budget note above.
    if (!ws.full) {
      for (const def of this.data.weapons.WEAPONS) {
        if (ws.has(def.id)) continue;
        if (this.banished.indexOf(def.id) >= 0) continue;
        return false;
      }
    }
    for (const w of ws.slots) {
      if (!ws.isMaxed(w) && !w.evolved) return false;
    }

    // 4. The stat pool, filtered exactly as rollUpgradeChoices filters it: a full
    //    bucket stops offering NEW upgrades from that bucket, but never stops
    //    offering to level the ones already taken.
    const B = this.data.upgrades.BUILD_SLOTS;
    const slots = this.buildSlots();
    for (const up of this.data.upgrades.UPGRADES) {
      if (this.banished.indexOf(up.id) >= 0) continue;
      if (p.isMaxed(up.id)) continue;
      if ((p.upgrades[up.id] || 0) > 0) return false;
      const bucket = B.bucketOf(up);
      if (slots.used[bucket] < slots.max[bucket]) return false;
    }
    return true;
  }

  /**
   * START THE CLOCK. Idempotent, because both triggers can and do go true on the
   * same tick — the level-up that maxes the last upgrade is also a tick the poll
   * can land on.
   */
  _startFinaleCountdown() {
    if (this.finaleCountdownFired || this.endless) return false;
    this.finaleCountdownFired = true;
    this.finaleCountdown = FINALE_COUNTDOWN;

    // Two lines, not three: `bark` spawns its own floater at -54 and emits
    // EV.BARK, so this reads as a headline and a subtitle — same shape as
    // callBossEarly's announcement, which lands again at the handover.
    const p = this.player;
    floaters.spawn(p.x, p.y - 104, 'NOTHING LEFT TO CLAIM', '#ffd76a', 32, 3.4);
    this.bark('One minute. Take every coin you can carry.');
    audio.play('bossIntro');
    flash.fire('#ffd76a', 0.45, 2.0);
    shake.medium();
    return true;
  }

  /**
   * Checked from the two paths that can complete a build — the level-up choice
   * and a chest reveal — rather than every frame. buildSlots() walks the whole
   * upgrade map, and nothing about a finished build can change in between.
   *
   * BOTH SIGNALS NOW START THE SAME COUNTDOWN rather than one of them calling the
   * boss outright. Two different leads — ten seconds for a finished build, sixty
   * for a dry card pool — for what the player experiences as one moment would
   * read as a bug, and the shorter of the two would win every race: on any run
   * that evolves its rack, buildComplete() goes true strictly BEFORE the pool
   * runs dry, so an immediate call there would mean the grind minute this whole
   * feature exists for never happened at all.
   */
  _maybeCallBossEarly() {
    if (this.finaleCountdownFired || this.bossCalledEarly || this.endless) return;
    if (this.waveDirector.bossSpawned || this.finalBossEntity || this.finalBossKilled) return;
    if (this.nothingLeftToClaim() || this.buildComplete()) this._startFinaleCountdown();
  }

  /**
   * THE COUNTDOWN, ticked once per sim step from update().
   *
   * DETERMINISM. Everything here reads `dt` and `frameParity`, both of which come
   * from the fixed 60Hz accumulator; nothing reads wall-clock time, and nothing
   * draws from runRng — nothingLeftToClaim() and callBossEarly() are both RNG-free
   * by construction. A seed therefore starts the countdown on the same tick and
   * lands the boss on the same tick at 30 FPS, at 144 FPS and at 100x headless.
   *
   * IT CANNOT DOUBLE-FIRE. Three latches, each covering a different way in:
   *   finaleCountdownFired   the countdown itself starts once, ever.
   *   bossCalledEarly        callBossEarly retimes the timeline once, ever.
   *   bossSpawned / finalBossEntity / finalBossKilled
   *                          the finale is already on the floor or already dead,
   *                          so there is nothing left to pull forward. This is
   *                          also what silently ENDS a countdown the authored
   *                          timeline overtook: a run that finishes its build at
   *                          duration-70s must not be left with a HUD clock
   *                          counting down to a boss that already walked on.
   *
   * THE CLOCK FLOORS AT ZERO rather than going negative, because the handover can
   * legitimately fail and the player can be left sitting at 0. callBossEarly
   * refuses while a mid-boss is alive — BossController holds exactly one boss, so
   * the finale would take the slot and leave the mid-boss standing there with no
   * AI — and it also refuses when the authored boss is already inside its own
   * lead-in, in which case the timeline delivers it unaided a moment later. Both
   * resolve on their own, so the call is simply retried every tick and the HUD
   * prints INCOMING with no number, which is honest: at that point nobody knows.
   */
  _tickFinale(dt) {
    if (this.endless) return;

    // The finale is here, or was here. Nothing to count down to.
    if (this.waveDirector.bossSpawned || this.finalBossEntity || this.finalBossKilled) {
      this.finaleCountdown = -1;
      return;
    }

    if (!this.finaleCountdownFired) {
      // Never shadow a call that already happened by some other route.
      if (this.bossCalledEarly) return;
      if ((this.frameParity & FINALE_POLL_MASK) !== 0) return;
      if (this.nothingLeftToClaim()) this._startFinaleCountdown();
      return;
    }
    if (this.finaleCountdown < 0) return;

    const before = this.finaleCountdown;
    this.finaleCountdown = Math.max(0, before - dt);
    // Two cues, on the two crossings a player actually plans around. Crossing
    // tests rather than equality tests, because the clock moves in 1/60ths and
    // will never land exactly on an integer.
    if (before > 30 && this.finaleCountdown <= 30) audio.play('telegraph');
    if (before > 10 && this.finaleCountdown <= 10) audio.play('telegraph');

    // The handover. Retried every tick, because callBossEarly can refuse.
    if (!this.bossCalledEarly && this.finaleCountdown <= FINALE_HANDOVER) {
      this.callBossEarly();
    }
  }

  // --- boss / elite spawning -------------------------------------------------
  /**
   * @param isMidBoss  a mid-boss rather than the stage's finale.
   * @param isMini     a mid-boss that is NOT the stage's signature (the halfway
   *                   anchor). Every stage now runs two or three of these fights;
   *                   `isMini` is what keeps the loot table honest — see
   *                   onEnemyDeath. Stored on the run rather than on the entity
   *                   because entities are pooled and enemy.js resets a fixed
   *                   field list, so a field it does not know about would survive
   *                   into whatever mob recycled that slot next.
   *
   * Exactly one boss is ever live at a time: the WaveDirector postpones a
   * mid-boss rather than spawning it on top of one that is still alive, which is
   * what makes a single run-scoped flag correct here. The final boss does not
   * touch it, so a mid-boss still standing when the finale arrives keeps its own.
   */
  spawnBoss(def, isMidBoss, isMini) {
    const a = runRng.angle();
    const x = clamp(this.player.x + Math.cos(a) * 520, this.bounds.minX + 200, this.bounds.maxX - 200);
    const y = clamp(this.player.y + Math.sin(a) * 520, this.bounds.minY + 200, this.bounds.maxY - 200);
    const e = this.boss.spawn(def, x, y, isMidBoss);
    if (e) {
      if (isMidBoss) this.miniBossActive = !!isMini;
      else this.finalBossEntity = e;
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
      // The radius grew after spawn() published it, so the broadphase margin has
      // to be told or an elite stops being hittable at its own edges.
      this.enemies.noteRadius(e);
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
      // A MINI-BOSS IS NOT A MID-BOSS FOR LOOT PURPOSES. Every stage now runs two
      // or three of these fights instead of one, and paying each of them the full
      // mid-boss table would have tripled the guaranteed relics (against three
      // relic slots), tripled the Gold Chests — 3-5 free upgrade grants apiece,
      // which is a straight refund on the XP curve this same pass just tightened
      // — and inflated the Star Fragment economy by half.
      //
      // So the stage's SIGNATURE mid-boss keeps the spec's payout exactly, and
      // the additional mini-bosses pay a floor chest, no guaranteed relic, and
      // FRAGMENT_AWARDS.miniBoss. The reward for a mini-boss is that it is a
      // fight; the loot ladder still reads mob < elite < mini-boss < mid-boss
      // < boss.
      const F = this.data.shrine.FRAGMENT_AWARDS;
      const mini = e.isMidBoss && this.miniBossActive;
      if (e === this.finalBossEntity) { this.finalBossKilled = true; this.finalBossEntity = null; }
      this.stats.bosses++;
      this.bossActive = false;
      this.boss.onDeath();
      this.pickups.dropChest(e.x, e.y, !mini);
      // Every BOSS guarantees a relic (SECTION 9).
      if (!mini) {
        const relicId = this._rollRelic();
        if (relicId) this.pickups.dropRelic(e.x + 60, e.y, relicId);
      }
      // The third and last thing `difficultyMult.reward` is for. Rounded, because
      // fragments are whole and the results screen rounds again anyway.
      const frag = Math.round((e.isBoss ? F.finalBoss : mini ? F.miniBoss : F.midBoss) *
                              this.difficultyMult.reward);
      this.pendingFragments = (this.pendingFragments || 0) + frag;
      save.data.stats.bossKills++;
      floaters.spawn(e.x, e.y, '+' + frag + '💎', '#ffd76a', 26, 2.0);

      // AND IT MAY HAVE BEEN CARRYING A WEAPON. Rolled on the same ladder as
      // everything else this branch pays out — mob < elite < mini-boss <
      // mid-boss < boss — and dropped to the LEFT of the chest so the two
      // rewards do not land on top of each other and read as one pickup.
      const D = this.data.upgrades.BOSS_WEAPON_DROP;
      const chance = (e.isBoss ? D.boss : mini ? D.miniBoss : D.midBoss) *
                     (1 + p.stats.luck * D.luckPerPoint);
      if (runRng.chance(chance)) this._dropWeaponCrate(e.x - 90, e.y + 20);
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
    // DECISIONS.md §29 — a fixed resolution order, and a hard cap of 3 per run.
    //
    // `revivesUsed` counts CHARGES SPENT per source, not "has this source been
    // touched". It used to be a boolean, which meant a source that grants more
    // than one revive only ever produced one: Second Chance goes to level 2 and
    // its own card says "+2 revives total", but the second level did nothing at
    // all — no error, no warning, and the HUD even drew two revive pips.
    const order = ['undying', 'second_chance', 'shrine_revival', 'rei_s3', 'phoenix_heart'];
    if (this.revivesSpent() < 3) {
      for (const k of order) {
        if ((this.revivesUsed[k] | 0) >= this._reviveCharges(k)) continue;
        this.revivesUsed[k] = (this.revivesUsed[k] | 0) + 1;
        this._revive(k);
        return;
      }
    }
    this._die(src);
  }

  /** Charges consumed so far, across every source. */
  revivesSpent() {
    let n = 0;
    for (const k in this.revivesUsed) n += this.revivesUsed[k] | 0;
    return n;
  }

  /** Charges remaining, for the HUD's revive pips. */
  revivesLeftNow() {
    let total = 0;
    for (const k of ['undying', 'second_chance', 'shrine_revival', 'rei_s3', 'phoenix_heart']) {
      total += this._reviveCharges(k);
    }
    return Math.max(0, Math.min(3, total) - this.revivesSpent());
  }

  /** How many revives this source grants in total. 0 if the player has none. */
  _reviveCharges(kind) {
    const p = this.player;
    switch (kind) {
      case 'undying': return p.flags.undying === true ? 1 : 0;
      case 'second_chance': return p.upgrades.second_chance | 0;
      case 'shrine_revival': return save.data.shrine.revival | 0;
      case 'rei_s3': return p.flags.reiRevive === true ? 1 : 0;
      case 'phoenix_heart': return p.evolutions.indexOf('phoenix_heart') >= 0 ? 1 : 0;
      default: return 0;
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
   * ONE WEAPON CARD PER SCREEN AT MOST, AND NOT ON MOST SCREENS.
   *
   * Weapons used to be weighted ABOVE stat cards and an empty slot reserved a
   * card outright, which meant two of the three cards were routinely weapons
   * and the arsenal was finished by minute six. WEAPON_OFFERS in
   * data/upgrades.js now owns that rhythm and the reasoning behind both of its
   * numbers; the shape of it here is:
   *
   *   - an evolve card, when one exists, IS this screen's weapon card
   *   - otherwise, every `everyNth` screen gets one weapon card
   *   - of those, only every `newEveryNth` may be a weapon you do not own
   *   - every other card on every screen is a generic stat upgrade
   *
   * The one exception is the very end of a run, where the stat pool has nothing
   * left in it: a screen with two blank spaces on it is worse than a screen
   * with two weapon levels on it, so the tail tops up from the weapon pool. The
   * cadence exists to stop weapons INTERRUPTING the stat pool, and by then
   * there is no stat pool left to interrupt.
   */
  rollUpgradeChoices() {
    const p = this.player;
    const n = p.flags.upgradeChoices || this.data.upgrades.LEVELUP.choices;
    const B = this.data.upgrades.BUILD_SLOTS;
    const WO = this.data.upgrades.WEAPON_OFFERS;
    const slots = this.buildSlots();
    const out = [];

    // 1. A maxed weapon waiting to evolve takes the first card, every time.
    //    ONE of them, not all of them: two evolve cards on one screen is two
    //    weapon cards, and the second one will still be there next level.
    const evolvable = this.weapons.evolvable();
    let hasWeaponCard = evolvable.length > 0;
    if (hasWeaponCard) {
      const w = evolvable[0];
      out.push({ kind: 'weaponEvo', w, evo: this.weapons.evolutionOf(w) });
    }

    // 2. A completed upgrade+relic recipe takes the next.
    const evo = this._availableEvolution();
    if (evo && out.length < n) out.push({ kind: 'evolution', evo });

    // 3. THE CADENCE. Screen 0 is both a weapon screen and an expansion screen,
    //    which is what keeps the level-1 signature nerf survivable — see
    //    WEAPON_OFFERS for the run that proved a thin opening feeds itself.
    if (!hasWeaponCard && out.length < n && this.levelUpIndex % WO.everyNth === 0) {
      const card = this._rollWeaponCard(this.mayExpandArsenal(), out);
      if (card) { out.push(card); hasWeaponCard = true; }
    }

    // 4. Everything else is a generic stat card, and they are the only things
    //    in this pool.
    const pool = [];
    const weights = [];
    const luck = 1 + p.stats.luck * 0.02;
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

    // 5. The stat pool ran dry. Fill the rest of the screen with weapons rather
    //    than hand back a short one. `n` is 3 or 4, so the guard is generous.
    //
    //    IT STILL OBEYS THE ARSENAL BUDGET, and that is not a detail. This path
    //    used to pass `true` outright, on the reasoning that a dry stat pool
    //    means the run is effectively over anyway. That was true at six and six
    //    and stopped being true the moment BUILD_SLOTS went to three and three:
    //    the pool now holds six upgrades total, so it runs dry once four of them
    //    are maxed — somewhere past level-up 30 of a run that reaches 40, with a
    //    quarter of the run still to play. The harness caught it. Full-length
    //    runs were finishing on 3.7 weapons against a cadence that permitted 3,
    //    because this loop was quietly handing out the fourth and fifth slots
    //    outside it — the new build cap had silently dismantled the new weapon
    //    cadence. A dry screen may still offer to LEVEL what you carry, forever.
    //    It may not widen the rack.
    const expand = this.mayExpandArsenal();
    while (out.length < n) {
      const card = this._rollWeaponCard(expand, out);
      if (!card) break;
      out.push(card);
    }

    // If literally everything is maxed, offer gold instead of a dead screen.
    if (out.length === 0) out.push({ kind: 'gold', amount: 120 });
    return out;
  }

  /**
   * MAY THE ARSENAL GET WIDER YET? A budget, not a birthday.
   *
   * This was `levelUpIndex % newEveryNth === 0` — a screen either landed exactly
   * on an expansion turn or it did not, and three separate things could eat the
   * one turn it got:
   *
   *   - a maxed weapon waiting to evolve takes the screen's weapon card, so a
   *     player sitting on an un-taken evolve card lost EVERY expansion turn it
   *     covered. With newEveryNth at 21 and a median run of 40 level-ups that
   *     is not an edge case, it is the difference between three weapons and two.
   *   - the weighted roll inside _rollWeaponCard can legitimately return a level
   *     on a weapon you own instead. Fine on its own — but the turn was spent.
   *   - a Gold Chest rolls up to five screens without ever advancing
   *     levelUpIndex, so a chest opened on an expansion turn granted five new
   *     weapons and one opened a level later granted none.
   *
   * Counting instead of scheduling fixes all three at once: the run is allowed
   * one weapon per `newEveryNth` level-ups plus the signature plus the one that
   * opens the run, and it stays allowed until it is claimed. Nothing can be
   * silently forfeited, and the chest self-limits because `weapons.count` moves
   * as it grants.
   *
   * A BOSS CRATE COUNTS AGAINST THIS, deliberately. The crate's reward is that
   * the weapon arrives NOW rather than at level-up 21 — it buys you time, not
   * width. Letting it stack on top would make the rack fill fastest exactly for
   * the players already killing bosses quickest, which is the runaway the whole
   * cadence exists to stop.
   */
  mayExpandArsenal() {
    const WO = this.data.upgrades.WEAPON_OFFERS;
    return this.weapons.count < 2 + Math.floor(this.levelUpIndex / WO.newEveryNth);
  }

  /**
   * ONE weapon card, or null when there is no weapon worth offering.
   *
   * @param allowNew  may this card be a weapon the player does not own yet?
   *                  False on an ordinary weapon screen, true on an expansion
   *                  screen and on the end-of-run top-up.
   * @param onScreen  the cards already chosen for this screen. The top-up path
   *                  calls this more than once and must not offer the same
   *                  weapon twice.
   *
   * An expansion screen with nothing left to expand into — every weapon owned,
   * or every one of them banished — falls through to a level rather than
   * wasting the screen's one weapon card on nothing.
   */
  _rollWeaponCard(allowNew, onScreen) {
    const pool = [];
    const weights = [];
    const luck = 1 + this.player.stats.luck * 0.02;
    const WO = this.data.upgrades.WEAPON_OFFERS;

    if (allowNew && !this.weapons.full) {
      for (const def of this.data.weapons.WEAPONS) {
        if (this.weapons.has(def.id)) continue;
        if (this.banished.indexOf(def.id) >= 0) continue;
        if (weaponOnScreen(onScreen, def.id)) continue;
        pool.push({ kind: 'newWeapon', def });
        weights.push((def.weight || 100) * luck);
      }
    }
    // Levels are always in the pool on an expansion screen too, at a weight
    // that loses most of the time. A fifth weapon at level 1 is not always
    // better than your third at level 5, and the roll should be able to say so.
    for (const w of this.weapons.slots) {
      if (this.weapons.isMaxed(w) || w.evolved) continue;
      if (weaponOnScreen(onScreen, w.id)) continue;
      pool.push({ kind: 'weapon', w, level: w.level + 1 });
      weights.push(WO.levelWeight * luck);
    }

    const i = runRng.weightedIndex(weights);
    return i >= 0 ? pool[i] : null;
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
    this.levelUpIndex++;
    this.state = RUN_STATE.PLAYING;
    audio.play('uiConfirm');
    this.relicHooks.fire('onLevelUp');
    this._maybeCallBossEarly();
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
    // THE ENTRY FEE IS RE-CHECKED HERE, not only in weapons.evolvable().
    //
    // rollUpgradeChoices() is the only thing that builds a `weaponEvo` card
    // today, and "the only caller" is a fact about this month's code rather than
    // about the design: a chest, a boss crate or a shrine boon that ever learned
    // to hand out an evolution would skip the fee in complete silence, and the
    // player would get an evolved weapon off max level alone. weapons.evolve()
    // deliberately stays a raw mutation — the perf tool and the render smoke
    // test both drive it with no build behind them — so the gate belongs on the
    // one path a PLAYER can reach, which is this one.
    const w = this.weapons.get(id);
    if (!w || !this.weapons.evoReady(w)) return false;
    if (!this.weapons.evolve(id)) return false;
    audio.play('evolve');
    flash.fire('#ffd76a', 0.5, 2.2);
    shake.big();
    camera.punch(feel.punchZoom * 1.6, 0.6);
    floaters.spawn(this.player.x, this.player.y - 76, this.weapons.evolutionOf(w).name,
                   '#ffd76a', 34, 2.6);
    particles.ring(this.player.x, this.player.y, 30, '#ffd76a', 560);
    return true;
  }

  // --- boss weapon drops --------------------------------------------------------
  /**
   * Put a weapon crate on the floor. Returns false when there is no weapon left
   * worth crating, in which case the boss simply pays its other rewards.
   */
  _dropWeaponCrate(x, y) {
    const def = this._rollWeaponDrop();
    if (!def) return false;
    // The crate may land somewhere other than asked — a boss can die against a
    // wall, and pickups are pushed clear of static geometry. The label follows
    // the crate, not the request.
    const p = this.pickups.dropWeapon(x, y, def);
    floaters.spawn(p ? p.x : x, (p ? p.y : y) - 46, 'WEAPON DROP', '#6ad8ff', 24, 2.4);
    audio.play('relic');
    return true;
  }

  /**
   * Which weapon a boss was carrying.
   *
   * TWO RULES, BOTH OF THEM THE POINT OF THE FEATURE:
   *
   *   - a weapon the player does not own is only eligible while a SLOT IS FREE.
   *     The crate is a reward, not a way around the five-slot cap.
   *   - a weapon the player DOES own is eligible only while it still has a
   *     level left in it. A crate carrying something already maxed or already
   *     evolved is a crate that does nothing, and the player would walk across
   *     an arena for it.
   *
   * Owned weapons are weighted below un-owned ones but not out of the running:
   * late in a run, with the rack full, they are the only thing a crate can be,
   * and a level on the weapon you actually built around is a real prize.
   */
  _rollWeaponDrop() {
    const all = this.data.weapons.WEAPONS;
    const weights = [];
    const luck = 1 + this.player.stats.luck * 0.02;
    for (const def of all) {
      if (this.banished.indexOf(def.id) >= 0) { weights.push(0); continue; }
      const w = this.weapons.get(def.id);
      if (!w) { weights.push(this.weapons.full ? 0 : (def.weight || 100) * luck); continue; }
      const spent = this.weapons.isMaxed(w) || w.evolved;
      weights.push(spent ? 0 : (def.weight || 100) * 0.6 * luck);
    }
    const i = runRng.weightedIndex(weights);
    return i >= 0 ? all[i] : null;
  }

  /**
   * The player walked onto a crate.
   *
   * The crate was rolled when the boss died and is collected some time later,
   * so the run can have moved underneath it: the free slot it was going to take
   * got taken, or the weapon it was going to level got maxed off a level-up
   * screen. Rather than eat the pickup and leave the player with a shrug, an
   * obsolete crate pays gold and says so.
   */
  takeWeaponDrop(def) {
    if (!def) return false;
    const w = this.weapons.get(def.id);
    if (!w) {
      if (!this.weapons.full && this.grantWeapon(def.id)) return true;
    } else if (!this.weapons.isMaxed(w) && !w.evolved) {
      if (this.levelWeapon(def.id)) return true;
    }
    const gold = this.data.upgrades.BOSS_WEAPON_DROP.consolationGold;
    this.grantGold(gold);
    floaters.spawn(this.player.x, this.player.y - 64,
                   'NO ROOM  +' + gold + ' ⭐', '#ffd76a', 20, 1.8);
    return false;
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
    this.levelUpIndex++;
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

    // A chest takes the best thing it is offered that it can actually grant,
    // and it PREFERS A STAT CARD.
    //
    // It used to take whichever of the three came first, which was fine while
    // every screen led with a weapon. Now that weapons are on a cadence, a Gold
    // Chest rolling five screens on one cadence position would have handed out
    // five weapon cards in a row and undone the whole rhythm in a single pickup
    // — the chest rolls five screens, but it is still ONE moment in the run.
    // A weapon is still perfectly reachable here; it just has to be the only
    // thing on offer, which at the end of a run it frequently is.
    const granted = [];
    for (let i = 0; i < count; i++) {
      const choices = this.rollUpgradeChoices();
      const pick = choices.find(IS_STAT_CARD) || choices.find(IS_WEAPON_CARD) || choices[0];
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
      // A chest that rolls a screen whose ONLY card is an evolve card used to
      // fall off the end of this chain and grant nothing at all — the pickup was
      // eaten and the player got a reveal panel with an empty row. It is safe to
      // apply now that evolveWeapon() checks the entry fee itself.
      else if (pick.kind === 'weaponEvo') {
        if (this.evolveWeapon(pick.w.id)) {
          granted.push(chestRow(this.weapons.iconOf(pick.w), this.weapons.nameOf(pick.w),
                                'EVOLVED'));
        }
      }
    }
    this.chestResult = { kind: 'chest', granted, gold: c.gold };
    this.state = RUN_STATE.CHEST;
    events.emit(EV.CHEST_OPENED, c.gold, granted);
    // A Gold Chest hands out 3-5 upgrades at once and is perfectly capable of
    // being the thing that finishes a build.
    this._maybeCallBossEarly();
  }

  closeChest() {
    this.chestResult = null;
    this.pachinkoPrize = null;
    this.state = RUN_STATE.PLAYING;
  }

  /**
   * THE PACHINKO PARLOUR PAYS OUT, AND THE PLAYER CHOOSES IN WHAT.
   *
   * Reached from the stage event of the same name (game/stageEvents.js), which
   * is rare, once per run, and placed against a building. Everything about it
   * that is a NUMBER lives on the STAGE_EVENTS entry; everything about it that
   * is a DECISION lives here, because a decision needs RUN_STATE and Run owns
   * that.
   *
   * THE PRIZE IS ROLLED NOW, NOT WHEN THE BUTTON IS PRESSED, and that is the
   * whole reason this method exists instead of the screen calling grantWeapon
   * directly. The player is choosing between two things and has to be able to
   * SEE both of them: "a free weapon" is not an offer, "MOONLIT FANG, new
   * weapon" is. It also means the roll cannot silently come back empty after
   * the choice has been made.
   *
   * `_rollWeaponDrop` is reused rather than re-implemented, and it already
   * encodes the two rules this needs: an unowned weapon is only eligible while
   * a slot is free (the parlour is a reward, not a way around the five-slot
   * cap), and an owned one only while it still has a level left in it.
   */
  openPachinko(def) {
    const R = (def && def.reward) || EMPTY_REWARD;
    const prize = this._rollWeaponDrop();
    this.pachinkoPrize = prize;

    let prizeName = '', prizeSub = '', prizeIcon = '🎁';
    if (prize) {
      const owned = this.weapons.get(prize.id);
      prizeIcon = prize.icon || '🎁';
      prizeName = prize.name;
      prizeSub = owned
        ? 'Lv ' + (owned.level + 1) + ' / ' + this.weapons.maxLevel(owned)
        : 'NEW WEAPON';
    }

    this.chestResult = {
      kind: 'pachinko',
      // Run gold, banked at the results screen like every other coin in a run,
      // plus the meta currency — which quests and achievements already grant
      // mid-run, so this is not a new path into the wallet.
      gold: R.gold || 0,
      fragments: R.starFragments || 0,
      prizeName, prizeSub, prizeIcon,
    };
    this.state = RUN_STATE.CHEST;
    audio.play('relic');
  }

  /**
   * Cash or prize. `option` is 'cash' or 'prize'.
   *
   * A prize button with nothing behind it is disabled on the screen, but the
   * check is repeated here for the same reason evolveWeapon re-checks its entry
   * fee: "the only caller is the UI" is a fact about this month's code, and a
   * silent no-op that eats a once-per-run reward is the worst possible way to
   * find out it stopped being true.
   */
  usePachinko(option) {
    const res = this.chestResult;
    if (!res || res.kind !== 'pachinko') return;
    if (option === 'prize' && this.pachinkoPrize) {
      // takeWeaponDrop pays a consolation in gold if the run moved underneath
      // the roll — a slot filled, a weapon maxed — so this cannot come out empty.
      this.takeWeaponDrop(this.pachinkoPrize);
    } else {
      if (res.gold) this.grantGold(res.gold);
      if (res.fragments) {
        addCurrency('starFragments', res.fragments);
        floaters.spawn(this.player.x, this.player.y - 78,
                       '+' + res.fragments + ' ✦', '#8ad8ff', 24, 2.0);
      }
    }
    audio.play('uiConfirm');
    this.closeChest();
  }

  /**
   * Altar: 25% of current HP for a random relic, or 200 gold for an upgrade.
   *
   * THE BLOOD OFFER IS STILL ONE-SHOT. The gold offer is not: it is a counter,
   * and it stays open for up to SHRINE_ALTAR.goldUses purchases (see the comment
   * on that constant — in-run gold had nothing else to buy in the entire game).
   * It closes the instant another purchase becomes impossible, whether that is
   * because the stock ran out or because the player can no longer pay, so the
   * offer screen never re-opens on someone it has nothing left to sell.
   */
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
      this.altar.goldUses++;
      if (this.altar.goldUses < (A.goldUses || 1) && this.stats.gold >= A.goldCost) {
        this.altar.used = false;
        floaters.spawn(this.altar.x, this.altar.y - 40,
                       (A.goldUses - this.altar.goldUses) + ' MORE', '#ffd76a', 20, 1.6);
      }
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
    // Not optional: the event system holds an ENEMY_KILLED subscription on the
    // global bus, and leaving it attached would keep this whole run — its pools,
    // its player, its data — alive and counting kills for the next one.
    this.stageEvents.clear();
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

/**
 * Is this weapon already on the screen being built? Guards the one path that
 * fills more than one weapon card at a time (the end-of-run top-up in
 * rollUpgradeChoices) from offering the same weapon twice.
 */
function weaponOnScreen(cards, id) {
  if (!cards) return false;
  for (const c of cards) {
    if (c.kind === 'newWeapon') { if (c.def.id === id) return true; }
    else if (c.kind === 'weapon' || c.kind === 'weaponEvo') { if (c.w.id === id) return true; }
  }
  return false;
}

// Chest reveal predicates. Module-level so the chest path allocates no closures,
// and so the ORDER of preference is stated once, in one readable place.
const IS_STAT_CARD = (c) => c.kind === 'upgrade';
const IS_WEAPON_CARD = (c) => c.kind === 'weapon' || c.kind === 'newWeapon';

/** Death slow-mo, expressed through the run's own time scale (deterministic). */
function setTimeoutLikeSlowmo(run) {
  run.setSlowmo(0.25, 1.2);
}
