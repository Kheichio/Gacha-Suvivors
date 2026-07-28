// Enemies: the pooled entity, the 15 behaviour archetypes, and the scaling.
//
// SECTION 9's archetypes are reusable AI FUNCTIONS, not per-enemy code. Adding an
// enemy is a data object; adding an archetype is one entry in BEHAVIORS.
//
// Off-screen enemies (SECTION 1): rendering culled, AI cheapened to movement
// only, and anything drifting more than 1.5 screens away is teleported to the
// far side of the view (DECISIONS.md §19 — of the VIEW, not the arena, which is
// what makes a 4000x4000 bounded arena feel endless).

import { CONFIG } from '../core/config.js';
import { Pool } from '../core/pool.js';
import { runRng } from '../core/rng.js';
import { feel } from '../core/feel.js';
import { atlas } from '../render/spriteAtlas.js';
import { particles } from '../render/particles.js';
import { events, EV } from '../core/events.js';
import {
  clamp, dirTo, normalize, V, dist2, TAU, angleDelta, rotateToward, lerp,
} from '../core/math.js';
import { makeStatus, clearStatus, tickStatus, isStunned, speedMultiplier, MARK } from './statusEffects.js';
import { dealDamage, damagePlayer, areaDamage, SRC } from './damage.js';
import { SCALING } from '../data/stages.js';

/**
 * Per-SYSTEM, not per-module.
 *
 * `e.uid` is not just an identity: three behaviours read it as a seed —
 * the swarmer's wobble phase (`sin(aiT * 3.2 + e.uid)`), and the orbiter's and
 * ambusher's rotation direction (`e.uid & 1`). A module-level counter that
 * never resets meant the SECOND run in a process got a different swarm and a
 * different set of orbit directions from the first, on the same seed. That made
 * `node sim.js --all` measure a different game for every character after the
 * first — the same character on the same seed ranged from 185s to 307s — and
 * every number in BALANCE.md with it.
 */
let uidCounter = 1;

export function makeEnemy() {
  return {
    active: false, _i: 0, uid: 0,
    def: null, id: '',
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    kbx: 0, kby: 0,                       // knockback impulse, decays
    hp: 0, maxHp: 0, armor: 0, weight: 1,
    damage: 0, speed: 0, baseSpeed: 0,
    xp: 0, goldChance: 0,
    radius: 12, size: 'small',
    element: 'spirit',
    behavior: 'chaser',
    facing: 0, facingTarget: 0,
    visual: null, sprite: null,
    flashT: 0, lastHitAt: 0, lastLineStamp: 0,
    dying: false,
    isElite: false, isBoss: false, isMidBoss: false, isMinionTarget: false,
    knockbackImmune: false,
    shieldArc: 0, shieldReduction: 0,
    contactCd: 0,                         // per-enemy 0.5s contact tick
    st: makeStatus(),
    // behaviour scratch — every archetype reuses these three, so no archetype
    // ever needs to allocate a state object
    aiT: 0, aiT2: 0, aiState: 0,
    aiX: 0, aiY: 0, aiF: 0,
    params: null,
    affixes: null, affixT: 0, affixT2: 0,
    spawnT: 0,                            // spawn-in telegraph / fade
    offscreen: false,
    tier: 1,
    hpBarT: 0,
    // boss-only, present on every enemy so the shape never changes
    phase: 0, attackCd: 0, currentAttack: null, attackT: 0, bossDef: null,
    parts: null, partHp: null,
  };
}

function resetEnemy(e) {
  e.def = null; e.visual = null; e.sprite = null; e.params = null;
  e.affixes = null; e.bossDef = null; e.currentAttack = null;
  e.parts = null; e.partHp = null;
  clearStatus(e.st);
  e.dying = false;
  e.isElite = false; e.isBoss = false; e.isMidBoss = false;
  e.shieldArc = 0; e.shieldReduction = 0;
  e.knockbackImmune = false;
  e.kbx = 0; e.kby = 0;
  e.hpBarT = 0;
  e.phase = 0;
}

// --- scaling (SECTION 8) -----------------------------------------------------
export function scaledHp(base, minutes, difficultyMult, stageMult) {
  return base * (1 + SCALING.hp * minutes) * difficultyMult * stageMult;
}
export function scaledDamage(base, minutes, difficultyMult) {
  return base * (1 + SCALING.damage * minutes) * difficultyMult;
}
export function scaledSpeed(base, minutes, difficultyMult) {
  return base * Math.min(SCALING.speedCap, 1 + SCALING.speed * minutes) * difficultyMult;
}
export function scaledXp(base, minutes) {
  return base * (1 + SCALING.xp * minutes);
}

export class EnemySystem {
  constructor(run) {
    this.run = run;
    this.pool = new Pool(makeEnemy, resetEnemy, 512, CONFIG.MAX_ENEMIES, true);
    this.splitBudget = CONFIG.SPLIT_BUDGET_PER_RUN;
    // Restarts with the run. See the comment on uidCounter.
    this._nextUid = uidCounter;
  }

  get items() { return this.pool.items; }
  get count() { return this.pool.count; }

  /**
   * @param def    an entry from data/enemies.js (or data/bosses.js)
   * @param opts   {isElite, isBoss, isMidBoss, affixes, hpMult, speedMult, scale}
   */
  spawn(def, x, y, opts) {
    if (this.run.totalEntities() >= CONFIG.MAX_ENTITIES) return null;
    const e = this.pool.spawn();
    if (!e) return null;
    const o = opts || EMPTY;
    const run = this.run;
    const minutes = run.time / 60;

    e.uid = this._nextUid++;
    e.def = def; e.id = def.id;
    e.x = e.px = x; e.y = e.py = y;
    e.vx = 0; e.vy = 0; e.kbx = 0; e.kby = 0;
    e.behavior = def.behavior || 'chaser';
    e.params = def.params || EMPTY;
    e.size = def.size || 'small';
    e.element = def.element || 'spirit';
    e.tier = def.tier || 1;
    e.visual = def.visual;
    e.sprite = atlas.ensure(def.visual);
    e.radius = (def.visual && def.visual.size ? def.visual.size : 12) *
               (o.scale || 1) * feel.enemySizeMult;
    e.weight = def.weight || 1;
    e.goldChance = def.goldChance || 0;
    e.isElite = !!o.isElite;
    e.isBoss = !!o.isBoss;
    e.isMidBoss = !!o.isMidBoss;
    e.dying = false;
    e.contactCd = 0;
    e.aiT = runRng.range(0, 1); e.aiT2 = 0; e.aiState = 0;
    e.aiX = 0; e.aiY = 0; e.aiF = 0;
    e.flashT = 0;
    e.facing = e.facingTarget = runRng.angle();
    e.spawnT = o.telegraph || 0;
    e.phase = 0; e.attackCd = 1.2; e.attackT = 0; e.currentAttack = null;
    e.bossDef = (o.isBoss || o.isMidBoss) ? def : null;
    clearStatus(e.st);

    const dm = run.difficultyMult;
    const sm = run.stage.hpMult || 1;
    let hp = scaledHp(def.hp, minutes, dm.hp, sm) * (o.hpMult || 1);
    if (o.isElite) hp *= 8;                                   // SECTION 9
    // "Titan's Shadow": LARGE enemies +100% HP but 3x XP.
    if (run.modifier && run.modifier.params.largeHpMult && e.size === 'large') {
      hp *= run.modifier.params.largeHpMult;
    }
    if (run.modifier && run.modifier.params.hpMult) hp *= run.modifier.params.hpMult;
    e.hp = e.maxHp = hp;

    e.damage = scaledDamage(def.damage, minutes, dm.damage);
    e.baseSpeed = scaledSpeed(def.speed, minutes, dm.speed) * (o.speedMult || 1);
    if (run.modifier && run.modifier.params.enemySpeedMult) e.baseSpeed *= run.modifier.params.enemySpeedMult;
    e.speed = e.baseSpeed;
    e.armor = def.armor || 0;

    let xp = scaledXp(def.xp || 1, minutes);
    if (run.modifier && run.modifier.params.largeXpMult && e.size === 'large') xp *= run.modifier.params.largeXpMult;
    if (o.isElite) xp *= 6;
    e.xp = xp;

    if (e.behavior === 'shielder') {
      e.shieldArc = e.params.shieldArc || 1.6;
      e.shieldReduction = e.params.shieldReduction || 0.9;
    }
    if (e.size === 'large' || o.isBoss) e.knockbackImmune = o.isBoss || false;

    // affixes
    e.affixes = o.affixes || null;
    if (e.affixes) {
      for (const a of e.affixes) {
        if (a.id === 'colossal') { e.radius *= 2; e.damage *= 2; e.knockbackImmune = true; }
        if (a.id === 'frenzied') e.aiF = 0;
      }
    }

    events.emit(EV.ENEMY_SPAWNED, e);
    return e;
  }

  release(e) { this.pool.release(e); }
  clear() { this.pool.clear(); this.splitBudget = CONFIG.SPLIT_BUDGET_PER_RUN; }

  update(dt) {
    const run = this.run;
    const p = run.player;
    const items = this.pool.items;
    const cullX = run.camera.viewHalfW(0) * CONFIG.CULL_SCREENS;
    const cullY = run.camera.viewHalfH(0) * CONFIG.CULL_SCREENS;
    const viewX = run.camera.viewHalfW(120);
    const viewY = run.camera.viewHalfH(120);

    for (let i = 0; i < this.pool.count; i++) {
      const e = items[i];
      e.px = e.x; e.py = e.y;

      // spawn telegraph — enemy exists but is inert and drawn as a warning
      if (e.spawnT > 0) {
        e.spawnT -= dt;
        continue;
      }

      // --- status ------------------------------------------------------------
      const dot = tickStatus(e.st, dt, e.maxHp);
      if (dot > 0) {
        dealDamage(run, e, dot, SRC.DOT, { canCrit: false, knockback: 0, noNumber: run.enemies.count > 260 });
        if (!e.active || e.hp <= 0) { i--; continue; }
      }
      if (e.flashT > 0) e.flashT -= dt;
      if (e.hpBarT > 0) e.hpBarT -= dt;

      // "Demon Moon": enemies regenerate 1% max HP/s — unless Sunlight is on them.
      if (run.modifier && run.modifier.params.regenPerSec && e.st.noRegenT <= 0 && e.hp > 0) {
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * run.modifier.params.regenPerSec * dt);
      }

      // --- offscreen handling ------------------------------------------------
      const dx = e.x - p.x, dy = e.y - p.y;
      e.offscreen = Math.abs(dx) > viewX || Math.abs(dy) > viewY;
      if (Math.abs(dx) > cullX || Math.abs(dy) > cullY) {
        if (e.isBoss || e.isMidBoss || e.isElite) {
          // Bosses never get recycled — they walk back instead.
          this._moveToward(e, p.x, p.y, dt, 1.6);
          continue;
        }
        this._recycle(e, p, viewX, viewY);
        continue;
      }

      // --- knockback ---------------------------------------------------------
      if (e.kbx !== 0 || e.kby !== 0) {
        e.x += e.kbx * dt;
        e.y += e.kby * dt;
        const d = 1 - feel.knockbackDecay * dt;
        e.kbx *= d > 0 ? d : 0;
        e.kby *= d > 0 ? d : 0;
        if (Math.abs(e.kbx) < 3) e.kbx = 0;
        if (Math.abs(e.kby) < 3) e.kby = 0;
      }

      if (isStunned(e.st)) { continue; }

      e.speed = e.baseSpeed * speedMultiplier(e.st);
      // Frenzied affix: +80% move speed below 50% HP.
      if (e.affixes && e.hp < e.maxHp * 0.5) {
        for (const a of e.affixes) if (a.id === 'frenzied') { e.speed *= 1.8; break; }
      }

      // --- pull (chum bucket, iron sand, whirlpool) --------------------------
      if (e.st.pullT > 0 && e.st.pullForce > 0) {
        if (dirTo(e.x, e.y, e.st.pullX, e.st.pullY) > 4) {
          e.x += V.x * e.st.pullForce * dt;
          e.y += V.y * e.st.pullForce * dt;
        }
      }

      // --- behaviour ---------------------------------------------------------
      if (e.offscreen) {
        // Cheapened update: movement only, no AI targeting, no attacks.
        this._moveToward(e, p.x, p.y, dt, 1.0);
      } else {
        const fn = e.isBoss || e.isMidBoss ? null : BEHAVIORS[e.behavior];
        if (fn) fn(e, run, p, dt, this);
        else if (!e.isBoss && !e.isMidBoss) BEHAVIORS.chaser(e, run, p, dt, this);
      }

      // --- separation (SECTION 3: readable blobs, not a conga line) ----------
      if (!e.offscreen && !e.isBoss && e.behavior !== 'static') {
        this._separate(e, dt);
      }

      // --- obstacles ---------------------------------------------------------
      if (run.obstacles.count > 0 && !e.offscreen) run.obstacles.steer(e, dt);

      // --- arena bounds ------------------------------------------------------
      const b = run.bounds;
      if (e.x < b.minX) { e.x = b.minX; e.vx = Math.abs(e.vx); }
      else if (e.x > b.maxX) { e.x = b.maxX; e.vx = -Math.abs(e.vx); }
      if (e.y < b.minY) { e.y = b.minY; e.vy = Math.abs(e.vy); }
      else if (e.y > b.maxY) { e.y = b.maxY; e.vy = -Math.abs(e.vy); }

      // --- contact damage ----------------------------------------------------
      if (e.contactCd > 0) e.contactCd -= dt;
      if (!e.isBoss && !e.isMidBoss && e.contactCd <= 0 && !e.offscreen) {
        const r = e.radius + feel.playerHitRadius;
        if (dist2(e.x, e.y, p.x, p.y) < r * r && p.st.intangibleT <= 0) {
          damagePlayer(run, e.damage, SRC.CONTACT, { attacker: e, fromX: e.x, fromY: e.y });
          e.contactCd = feel.contactCooldown;
        }
      }

      // --- affix behaviour ---------------------------------------------------
      if (e.affixes) this._tickAffixes(e, run, p, dt);

      if (!e.active) i--;
    }
  }

  _recycle(e, p, viewX, viewY) {
    // Teleport to just off the opposite edge of the VIEW, keeping pressure up
    // without the player ever seeing a pop-in.
    const a = runRng.angle();
    const rx = viewX * 1.05, ry = viewY * 1.05;
    e.x = p.x + Math.cos(a) * rx;
    e.y = p.y + Math.sin(a) * ry;
    e.px = e.x; e.py = e.y;
    e.kbx = 0; e.kby = 0;
    const b = this.run.bounds;
    e.x = clamp(e.x, b.minX, b.maxX);
    e.y = clamp(e.y, b.minY, b.maxY);
  }

  _moveToward(e, tx, ty, dt, mult) {
    if (dirTo(e.x, e.y, tx, ty) > 1) {
      const s = e.speed * (mult || 1) * dt;
      e.x += V.x * s;
      e.y += V.y * s;
      e.vx = V.x * e.speed; e.vy = V.y * e.speed;
      e.facingTarget = Math.atan2(V.y, V.x);
    }
  }

  /** Soft separation. Sampled, not exhaustive — 6 neighbours is plenty. */
  _separate(e, dt) {
    const hash = this.run.enemyHash;
    const items = this.pool.items;
    const rad = feel.separationRadius + e.radius * 0.5;
    const n = hash.query(e.x, e.y, rad);
    let sx = 0, sy = 0, c = 0;
    for (let k = 0; k < n && c < 6; k++) {
      const o = items[hash.resultAt(k)];
      if (o === e || !o.active) continue;
      const dx = e.x - o.x, dy = e.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > rad * rad || d2 < 0.01) continue;
      const inv = 1 / Math.sqrt(d2);
      sx += dx * inv; sy += dy * inv;
      c++;
    }
    if (c > 0) {
      const f = feel.separationForce * dt / c;
      e.x += sx * f;
      e.y += sy * f;
    }
  }

  _tickAffixes(e, run, p, dt) {
    e.affixT -= dt;
    for (let i = 0; i < e.affixes.length; i++) {
      const a = e.affixes[i];
      switch (a.id) {
        case 'splitting':
          if (e.affixT <= 0) {
            const child = run.data.enemies.ENEMIES_BY_TIER[1];
            for (let k = 0; k < (a.params.count || 4) && this.splitBudget > 0; k++) {
              const def = run.data.enemies.ENEMIES_BY_ID[runRng.pick(child)];
              if (def) {
                this.spawn(def, e.x + runRng.signed() * 30, e.y + runRng.signed() * 30);
                this.splitBudget--;
              }
            }
            e.affixT = a.params.interval || 5;
          }
          break;
        case 'chilling':
          if (e.affixT <= 0) {
            run.hazards.spawnField(e.x, e.y, 46, 2.5, 'chill');
            e.affixT = 0.5;
          }
          break;
      }
    }
    if (e.affixT <= 0) e.affixT = 0.5;
  }

  /** Called from damage.js via run.onEnemyDeath. Splitters and Volatile live here. */
  onDeath(e, src) {
    const run = this.run;

    if (e.affixes) {
      for (const a of e.affixes) {
        if (a.id === 'volatile') {
          areaDamage(run, e.x, e.y, a.params.radius || 200, a.params.damage || 120,
                     SRC.HAZARD, { falloff: 0.4, canCrit: false });
          particles.ring(e.x, e.y, 20, '#ff6b3d', 380);
        }
      }
    }

    // splitter archetype
    if (e.behavior === 'splitter' && e.params.splitInto && this.splitBudget > 0) {
      const def = run.data.enemies.ENEMIES_BY_ID[e.params.splitInto];
      const n = e.params.splitCount || 2;
      if (def) {
        for (let i = 0; i < n && this.splitBudget > 0; i++) {
          const a = (i / n) * TAU + runRng.raw();
          const c = this.spawn(def, e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 18);
          if (c) { c.kbx = Math.cos(a) * 160; c.kby = Math.sin(a) * 160; this.splitBudget--; }
        }
      }
    }

    // exploder archetype detonates whether it died to you or to its own fuse
    if (e.behavior === 'exploder' && e.aiState === 1) {
      areaDamage(run, e.x, e.y, e.params.blastRadius || 90, e.damage * 2, SRC.HAZARD, { falloff: 0.5, canCrit: false });
    }

    this.release(e);
  }

  draw(r, alpha) {
    const items = this.pool.items;
    const run = this.run;
    for (let i = 0; i < this.pool.count; i++) {
      const e = items[i];
      const x = e.px + (e.x - e.px) * alpha;
      const y = e.py + (e.y - e.py) * alpha;

      if (e.spawnT > 0) {
        // Ambush telegraph — a shrinking ring where the enemy will land.
        const t = 1 - e.spawnT / (e.def.params && e.def.params.telegraph || feel.telegraphAmbush);
        r.strokeCircle(x, y, e.radius * (2.4 - t * 1.4), '#ffd23f', 3, 0.5 + t * 0.4);
        continue;
      }

      // Sprites are built around a 14px reference radius; scaling by the raw
      // hitbox radius made a 9px fodder enemy render at two-thirds size against
      // the player. Enemies are people too — they should read at roughly the
      // player's scale, with size class stepping up from there.
      //
      // `enemyDrawScale` then lifts the whole family: even at parity with the
      // player a rank-and-file enemy was too small to pick out of a horde of
      // two hundred. The ceiling moved with it, because bosses were already
      // pinned at the old 2.6 and would otherwise have stopped growing while
      // everything else caught up to them.
      // `sprite.unit` cancels the atlas's integer-upscale rounding, so a mob's
      // on-screen size follows its declared size and its hitbox rather than
      // whichever side of 0.5 its grid happened to land on. Small fodder gains
      // the most from that, which is exactly the class that read too small.
      const scale = e.sprite.unit * clamp(e.radius / 14, 0.85, 2.6) * feel.enemyDrawScale;
      // Idle bob, offset per entity so a pack does not pulse in lockstep.
      const anim = ((run.time * 5 + e.uid * 0.37) | 0) & 1;
      r.drawSprite(e.sprite, x, y, e.behavior === 'ranged' || e.isBoss ? e.facing : 0,
                   scale, 1, e.flashT > 0, anim);

      if (e.isElite || e.isBoss || e.isMidBoss) {
        // Gold outline + health bar + name plate (SECTION 9).
        r.strokeCircle(x, y, e.radius + 4, '#ffd76a', 2.5, 0.9);
      }
    }
    r.setAlpha(1);
  }
}

// --- the 15 behaviour archetypes --------------------------------------------
// Every one is a pure function of (enemy, run, player, dt, system). None of them
// allocates, and none of them knows which enemy id it is driving.

const BEHAVIORS = {
  chaser(e, run, p, dt, sys) {
    sys._moveToward(e, p.x, p.y, dt, 1);
  },

  swarmer(e, run, p, dt, sys) {
    // Chaser plus a gentle sine weave, so a pack reads as a shoal not a line.
    e.aiT += dt;
    const wobble = Math.sin(e.aiT * 3.2 + e.uid) * 0.35;
    if (dirTo(e.x, e.y, p.x, p.y) > 1) {
      const a = Math.atan2(V.y, V.x) + wobble;
      const s = e.speed * dt;
      e.x += Math.cos(a) * s;
      e.y += Math.sin(a) * s;
      e.facingTarget = a;
    }
  },

  charger(e, run, p, dt, sys) {
    const telegraph = e.params.telegraph || feel.telegraphCharge;
    const dashSpeed = e.params.dashSpeed || 240;
    const dashTime = e.params.dashTime || 0.5;
    switch (e.aiState) {
      case 0: // approach
        sys._moveToward(e, p.x, p.y, dt, 1);
        if (dist2(e.x, e.y, p.x, p.y) < 300 * 300) { e.aiState = 1; e.aiT = telegraph; }
        break;
      case 1: // telegraph — stop dead, so the tell is unmissable
        e.aiT -= dt;
        e.aiX = p.x; e.aiY = p.y;
        e.facingTarget = Math.atan2(p.y - e.y, p.x - e.x);
        if (e.aiT <= 0) { e.aiState = 2; e.aiT = dashTime; e.aiF = e.facingTarget; }
        break;
      case 2: // dash
        e.aiT -= dt;
        e.x += Math.cos(e.aiF) * dashSpeed * dt;
        e.y += Math.sin(e.aiF) * dashSpeed * dt;
        if (e.aiT <= 0) { e.aiState = 3; e.aiT = e.params.recover || 0.7; }
        break;
      default: // recover
        e.aiT -= dt;
        if (e.aiT <= 0) e.aiState = 0;
    }
  },

  ranged(e, run, p, dt, sys) {
    const range = e.params.range || 350;
    const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y));
    if (d > range * 1.15) sys._moveToward(e, p.x, p.y, dt, 1);
    else if (d < range * 0.7) {
      // back off
      if (dirTo(p.x, p.y, e.x, e.y) > 1) { e.x += V.x * e.speed * dt; e.y += V.y * e.speed * dt; }
    } else {
      // strafe, so a wall of shooters does not stand in a perfect arc
      const a = Math.atan2(p.y - e.y, p.x - e.x) + Math.PI / 2 * (e.uid & 1 ? 1 : -1);
      e.x += Math.cos(a) * e.speed * 0.5 * dt;
      e.y += Math.sin(a) * e.speed * 0.5 * dt;
    }
    e.facingTarget = Math.atan2(p.y - e.y, p.x - e.x);
    e.aiT -= dt;
    if (e.aiT <= 0 && d < range * 1.3) {
      e.aiT = e.params.fireInterval || 2.0;
      const n = e.params.projectiles || 1;
      const spread = e.params.spread || 0.35;
      for (let i = 0; i < n; i++) {
        const a = e.facingTarget + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0);
        run.enemyProjectiles.spawn(e.x, e.y, a, e.params.projectileSpeed || 240,
                                   e.damage, e.params.projectileLife || 3.2, e);
      }
    }
  },

  exploder(e, run, p, dt, sys) {
    const fuse = e.params.fuse || 3;
    const blast = e.params.blastRadius || 90;
    if (e.aiState === 0) {
      sys._moveToward(e, p.x, p.y, dt, 1.1);
      if (dist2(e.x, e.y, p.x, p.y) < (blast * 0.8) * (blast * 0.8)) {
        e.aiState = 1; e.aiT = fuse * 0.35;
      }
    } else {
      // visible fuse + beep; the enemy stops so the blast is dodgeable
      e.aiT -= dt;
      e.aiT2 += dt;
      if (e.aiT <= 0) {
        areaDamage(run, e.x, e.y, blast, e.damage * 2, SRC.HAZARD, { falloff: 0.45, canCrit: false });
        particles.ring(e.x, e.y, 16, e.visual.color, blast * 3);
        // Jellyfish Chorus chains: the blast can set off neighbours.
        if (e.params.chains) {
          const hash = run.enemyHash;
          const items = run.enemies.items;
          const n = hash.query(e.x, e.y, blast);
          for (let k = 0; k < n; k++) {
            const o = items[hash.resultAt(k)];
            if (o && o.active && o !== e && o.behavior === 'exploder' && o.aiState === 0) {
              o.aiState = 1; o.aiT = 0.35;
            }
          }
        }
        e.aiState = 0;
        dealDamage(run, e, e.maxHp * 10, SRC.HAZARD, { canCrit: false, noNumber: true });
      }
    }
  },

  splitter(e, run, p, dt, sys) { sys._moveToward(e, p.x, p.y, dt, 1); },

  orbiter(e, run, p, dt, sys) {
    const rad = e.params.orbitRadius || 120;
    const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y)) || 1;
    const toward = (d - rad) / rad;
    const ang = Math.atan2(p.y - e.y, p.x - e.x);
    const tangent = ang + Math.PI / 2 * (e.uid & 1 ? 1 : -1);
    const s = e.speed * dt;
    e.x += (Math.cos(tangent) * (1 - Math.abs(toward) * 0.5) + Math.cos(ang) * toward) * s;
    e.y += (Math.sin(tangent) * (1 - Math.abs(toward) * 0.5) + Math.sin(ang) * toward) * s;
    e.facingTarget = ang;
  },

  summoner(e, run, p, dt, sys) {
    // Drifts slowly; the threat is the stream of adds, so it stays reachable.
    sys._moveToward(e, p.x, p.y, dt, 0.35);
    e.aiT -= dt;
    if (e.aiT <= 0) {
      e.aiT = e.params.summonInterval || 4;
      const def = run.data.enemies.ENEMIES_BY_ID[e.params.summonId];
      if (def) {
        const n = e.params.summonCount || 4;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          sys.spawn(def, e.x + Math.cos(a) * 34, e.y + Math.sin(a) * 34);
        }
        particles.ring(e.x, e.y, 10, e.visual.color, 180);
      }
    }
  },

  shielder(e, run, p, dt, sys) {
    // DECISIONS.md §31 — the facing lags and the turn rate is capped, so
    // circling faster than 90 deg/s genuinely gets you behind the shield.
    sys._moveToward(e, p.x, p.y, dt, 0.85);
    e.aiT += dt;
    const lag = e.params.facingLag || feel.shielderFacingLag;
    if (e.aiT >= lag) {
      e.aiT = 0;
      e.aiF = Math.atan2(p.y - e.y, p.x - e.x);
    }
    const rate = (e.params.turnRate || feel.shielderTurnRate) * dt;
    e.facing = rotateToward(e.facing, e.aiF, rate);
    e.facingTarget = e.facing;
  },

  dasher(e, run, p, dt, sys) {
    e.aiT -= dt;
    if (e.aiT <= 0) {
      e.aiT = e.params.blinkInterval || 3;
      const d = e.params.blinkDist || 150;
      if (dirTo(e.x, e.y, p.x, p.y) > 1) {
        particles.burst(e.x, e.y, 6, e.visual.color, { speed: 120, life: 0.25 });
        e.x += V.x * d; e.y += V.y * d;
        e.px = e.x; e.py = e.y;
        particles.burst(e.x, e.y, 6, e.visual.color, { speed: 120, life: 0.25 });
      }
    } else {
      sys._moveToward(e, p.x, p.y, dt, 0.55);
    }
  },

  tank(e, run, p, dt, sys) {
    sys._moveToward(e, p.x, p.y, dt, 1);
    // Ground-slam AoE on a timer.
    if (e.params.slamInterval) {
      e.aiT -= dt;
      if (e.aiT <= 0 && dist2(e.x, e.y, p.x, p.y) < 220 * 220) {
        if (e.aiState === 0) {
          e.aiState = 1; e.aiT = feel.telegraphLethal;
          run.hazards.telegraph(e.x, e.y, e.params.slamRadius || 130, e.aiT, 'red', 'circle');
        } else {
          e.aiState = 0; e.aiT = e.params.slamInterval;
          areaDamage(run, e.x, e.y, e.params.slamRadius || 130, e.damage * 1.6, SRC.HAZARD, { falloff: 0.3, canCrit: false });
          particles.ring(e.x, e.y, 14, '#ff9a3d', 300);
        }
      }
    }
  },

  healer(e, run, p, dt, sys) {
    // Keeps its distance and heals allies — the "kill this first" enemy.
    const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y));
    if (d < 260) { if (dirTo(p.x, p.y, e.x, e.y) > 1) { e.x += V.x * e.speed * dt; e.y += V.y * e.speed * dt; } }
    else sys._moveToward(e, p.x, p.y, dt, 0.5);
    e.aiT -= dt;
    if (e.aiT <= 0) {
      e.aiT = 0.5;
      const rad = e.params.healRadius || 250;
      const amt = (e.params.healRate || 15) * 0.5;
      const hash = run.enemyHash;
      const items = run.enemies.items;
      const n = hash.query(e.x, e.y, rad);
      for (let k = 0; k < n; k++) {
        const o = items[hash.resultAt(k)];
        if (o && o.active && o !== e && o.hp < o.maxHp && o.st.noRegenT <= 0) {
          o.hp = Math.min(o.maxHp, o.hp + amt);
        }
      }
      particles.drift(e.x, e.y, '#7bf59a', { life: 0.6, size: 0.4 });
    }
  },

  leech(e, run, p, dt, sys) {
    if (e.aiState === 0) {
      sys._moveToward(e, p.x, p.y, dt, 1.15);
      const r = e.radius + feel.playerHitRadius;
      if (dist2(e.x, e.y, p.x, p.y) < r * r) {
        e.aiState = 1;
        e.aiX = p.x; e.aiY = p.y;      // where it attached
      }
    } else {
      // Attached: rides the player and drains until shaken off by moving 200px.
      e.x = p.x + Math.cos(e.aiT * 5) * 14;
      e.y = p.y + Math.sin(e.aiT * 5) * 14;
      e.aiT += dt;
      e.aiT2 -= dt;
      if (e.aiT2 <= 0) {
        e.aiT2 = 0.5;
        damagePlayer(run, (e.params.drainRate || 8) * 0.5, SRC.CONTACT, { attacker: e, ignoreIframes: true });
      }
      const shake = e.params.shakeOffDistance || 200;
      if (dist2(e.aiX, e.aiY, p.x, p.y) > shake * shake) {
        e.aiState = 0;
        e.kbx = (e.x - p.x) * 6; e.kby = (e.y - p.y) * 6;
      }
    }
  },

  /** DECISIONS.md §6 — declared by Ceiling Crawler, never defined in the spec. */
  ambusher(e, run, p, dt, sys) {
    // Spawned with a telegraph by the wave director; afterwards it is a fast chaser
    // that re-submerges if you outrun it, then drops on you again.
    e.aiT -= dt;
    if (e.aiState === 0) {
      sys._moveToward(e, p.x, p.y, dt, 1.25);
      if (e.aiT <= 0 && dist2(e.x, e.y, p.x, p.y) > 520 * 520) {
        e.aiState = 1; e.aiT = e.params.telegraph || feel.telegraphAmbush;
        const a = runRng.angle();
        e.aiX = p.x + Math.cos(a) * 140;
        e.aiY = p.y + Math.sin(a) * 140;
      }
    } else {
      if (e.aiT <= 0) {
        e.x = e.aiX; e.y = e.aiY; e.px = e.x; e.py = e.y;
        particles.ring(e.x, e.y, 10, e.visual.color, 200);
        e.aiState = 0; e.aiT = 4;
      }
    }
  },

  /** DECISIONS.md §6 — declared by Trap Scroll, never defined in the spec. */
  static(e, run, p, dt, sys) {
    // A visible, avoidable mine. It never moves; it detonates on proximity after
    // a telegraph, which is what makes it fair.
    if (e.aiState === 0) {
      const trigger = e.params.triggerRadius || 70;
      if (dist2(e.x, e.y, p.x, p.y) < trigger * trigger) {
        e.aiState = 1;
        e.aiT = e.params.fuse || 0.8;
        run.hazards.telegraph(e.x, e.y, e.params.blastRadius || 110, e.aiT, 'red', 'x');
      }
    } else {
      e.aiT -= dt;
      if (e.aiT <= 0) {
        areaDamage(run, e.x, e.y, e.params.blastRadius || 110, e.damage, SRC.HAZARD, { falloff: 0.3, canCrit: false });
        particles.ring(e.x, e.y, 18, '#ffd23f', 420);
        dealDamage(run, e, e.maxHp * 10, SRC.HAZARD, { canCrit: false, noNumber: true });
      }
    }
  },
};

const EMPTY = {};
export { BEHAVIORS };
