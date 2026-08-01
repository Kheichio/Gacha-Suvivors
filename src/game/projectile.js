// Projectiles — player-side and enemy-side, both pooled.
//
// A projectile is a flat record with a `motion` tag rather than a subclass, so
// homing / bouncing / boomerang / orbiting are all the same update loop with a
// switch that never allocates. Behaviour extras (split on impact, stick and
// detonate, chain to a new target) are declared as flags on the record.

import { CONFIG } from '../core/config.js';
import { Pool } from '../core/pool.js';
import { runRng } from '../core/rng.js';
import { atlas } from '../render/spriteAtlas.js';
import { particles } from '../render/particles.js';
import { audio } from '../core/audio.js';
import {
  clamp, dirTo, V, dist2, TAU, angleDelta, rotateToward, normalize,
} from '../core/math.js';
import { dealDamage, damagePlayer, areaDamage, SRC } from './damage.js';
import { nearestTo } from './targeting.js';

export const MOTION = {
  STRAIGHT: 0, HOMING: 1, BOUNCE: 2, BOOMERANG: 3, ORBIT: 4,
  ARC: 5, STICK: 6, DRIFT_POP: 7,
};

function makeProjectile() {
  return {
    active: false, _i: 0, uid: 0,
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    angle: 0, speed: 0,
    damage: 0, radius: 6,
    life: 0, maxLife: 1,
    pierce: 0, hitCount: 0,
    motion: 0,
    element: null,
    sprite: null, visual: null, scale: 1,
    owner: null,                  // player or enemy that fired it
    fromEnemy: false,
    // per-motion scratch
    target: null, turnRate: 0,
    homeT: 0,
    bounces: 0, bounceRange: 0, bounceDamageMult: 1,
    originX: 0, originY: 0, returnT: 0,
    orbitAngle: 0, orbitRadius: 0, orbitSpeed: 0, orbitHost: null,
    arcT: 0, arcTotal: 0, arcX0: 0, arcY0: 0, arcX1: 0, arcY1: 0, arcHeight: 0,
    stickT: 0, stickHost: null, stickOffX: 0, stickOffY: 0,
    spin: 0,                      // rad/s added to `angle` every tick (tumbling paper)
    popT: 0, popCount: 0,
    // effects
    splitInto: 0, splitDamage: 0,
    aoeRadius: 0, aoeDamage: 0,
    knockback: 0,
    onHit: null, onExpire: null,
    tag: '',                      // free-form, for relic hooks
    hitStamp: 0,
    trailColor: null, trailT: 0,
    pierceBonusPerHit: 0,          // Level 5 Clearance
    accumulatedPierceBonus: 0,
  };
}

function resetProjectile(p) {
  p.target = null; p.owner = null; p.orbitHost = null; p.stickHost = null;
  p.onHit = null; p.onExpire = null; p.sprite = null; p.visual = null;
  p.element = null; p.trailColor = null; p.tag = '';
  p.accumulatedPierceBonus = 0; p.pierceBonusPerHit = 0;
}

/** Per-system, so a uid means the same thing on run 2 as on run 1. */
let uidCounter = 1;

export class ProjectileSystem {
  /** @param fromEnemy true for the enemy-owned pool. */
  constructor(run, fromEnemy, capacity) {
    this.run = run;
    this.fromEnemy = fromEnemy;
    this.pool = new Pool(makeProjectile, resetProjectile, 128, capacity || CONFIG.MAX_PROJECTILES, true);
    this._hitStamp = 0;
    this._nextUid = uidCounter;
  }

  get items() { return this.pool.items; }
  get count() { return this.pool.count; }

  /**
   * Fire. `opts` carries everything; nothing is inferred from a character id.
   * @returns the projectile, or null if the pool is exhausted.
   */
  fire(x, y, angle, opts) {
    const o = opts || EMPTY;
    const p = this.pool.spawn();
    if (!p) return null;
    p.uid = this._nextUid++;
    p.x = p.px = x; p.y = p.py = y;
    p.angle = angle;
    p.speed = o.speed || 420;
    p.vx = Math.cos(angle) * p.speed;
    p.vy = Math.sin(angle) * p.speed;
    p.damage = o.damage || 10;
    p.radius = o.radius || 7;
    p.maxLife = p.life = o.life || 2.2;
    p.pierce = o.pierce || 0;
    p.hitCount = 0;
    p.motion = o.motion || MOTION.STRAIGHT;
    p.element = o.element || null;
    p.fromEnemy = this.fromEnemy;
    p.owner = o.owner || null;
    p.knockback = o.knockback === undefined ? -1 : o.knockback;
    p.visual = o.visual || (this.fromEnemy ? DEFAULT_ENEMY_VISUAL : DEFAULT_VISUAL);
    p.sprite = atlas.ensure(p.visual);
    p.scale = (o.radius || 7) / (p.visual.size || 7);
    p.tag = o.tag || '';
    p.onHit = o.onHit || null;
    p.onExpire = o.onExpire || null;
    p.trailColor = o.trailColor || null;
    p.trailT = 0;
    // TUMBLE. `angle` is otherwise only ever the direction of travel, so a
    // projectile that is an OBJECT rather than a bolt — a thrown charm, a
    // tossed card — turns with the camera and reads as a decal. One multiply
    // per tick, and only for the projectiles that ask for it.
    p.spin = o.spin || 0;
    p.splitInto = o.splitInto || 0;
    p.splitDamage = o.splitDamage || 0;
    p.aoeRadius = o.aoeRadius || 0;
    p.aoeDamage = o.aoeDamage || 0;
    p.pierceBonusPerHit = o.pierceBonusPerHit || 0;
    p.accumulatedPierceBonus = 0;
    p.hitStamp = 0;

    switch (p.motion) {
      case MOTION.HOMING:
        p.target = o.target || null;
        p.turnRate = o.turnRate || 3.2;
        p.homeT = o.homeDelay || 0;
        break;
      case MOTION.BOUNCE:
        p.bounces = o.bounces || 3;
        p.bounceRange = o.bounceRange || 260;
        p.bounceDamageMult = o.bounceDamageMult || 1.15;
        break;
      case MOTION.BOOMERANG:
        p.originX = o.originX !== undefined ? o.originX : x;
        p.originY = o.originY !== undefined ? o.originY : y;
        p.returnT = o.outTime || 0.42;
        break;
      case MOTION.ORBIT:
        p.orbitHost = o.host || null;
        p.orbitAngle = o.orbitAngle || angle;
        p.orbitRadius = o.orbitRadius || 70;
        p.orbitSpeed = o.orbitSpeed || 3.0;
        break;
      case MOTION.ARC:
        p.arcX0 = x; p.arcY0 = y;
        p.arcX1 = o.targetX; p.arcY1 = o.targetY;
        p.arcTotal = o.flightTime || 1.0;
        p.arcT = 0;
        p.arcHeight = o.arcHeight || 90;
        p.life = p.maxLife = p.arcTotal + 0.05;
        break;
      case MOTION.STICK:
        p.stickT = o.stickTime || 0.8;
        p.stickHost = null;
        break;
      case MOTION.DRIFT_POP:
        p.popT = o.popTime || 0.7;
        p.popCount = o.popCount || 3;
        break;
    }
    return p;
  }

  /** Convenience for enemy shots — the enemy AI's only projectile call. */
  spawn(x, y, angle, speed, damage, life, owner) {
    return this.fire(x, y, angle, { speed, damage, life, owner, radius: 6 });
  }

  update(dt) {
    const run = this.run;
    const items = this.pool.items;
    const player = run.player;

    for (let i = 0; i < this.pool.count; i++) {
      const p = items[i];
      p.px = p.x; p.py = p.y;
      p.life -= dt;
      if (p.life <= 0) {
        if (p.onExpire) p.onExpire(p, run);
        this._expire(p);
        this.pool.release(p);
        i--;
        continue;
      }

      // --- motion ------------------------------------------------------------
      switch (p.motion) {
        case MOTION.HOMING: {
          if (p.homeT > 0) p.homeT -= dt;
          else {
            if (!p.target || !p.target.active || p.target.hp <= 0) {
              p.target = this.fromEnemy ? player : nearestTo(run, p.x, p.y, 420, null);
            }
            if (p.target) {
              const want = Math.atan2(p.target.y - p.y, p.target.x - p.x);
              p.angle = rotateToward(p.angle, want, p.turnRate * dt);
              p.vx = Math.cos(p.angle) * p.speed;
              p.vy = Math.sin(p.angle) * p.speed;
            }
          }
          p.x += p.vx * dt; p.y += p.vy * dt;
          break;
        }
        case MOTION.BOOMERANG: {
          p.returnT -= dt;
          if (p.returnT <= 0) {
            // Curve back through the enemies a second time (Yamikage's wire shuriken).
            const host = p.owner || player;
            if (host && dirTo(p.x, p.y, host.x, host.y) > 1) {
              p.angle = rotateToward(p.angle, Math.atan2(V.y, V.x), 7 * dt);
              p.vx = Math.cos(p.angle) * p.speed;
              p.vy = Math.sin(p.angle) * p.speed;
              if (dist2(p.x, p.y, host.x, host.y) < 26 * 26) { p.life = 0; }
            }
            p.hitStamp = 0;         // allow a second pass through the same enemies
          }
          p.x += p.vx * dt; p.y += p.vy * dt;
          break;
        }
        case MOTION.ORBIT: {
          const host = p.orbitHost || player;
          p.orbitAngle += p.orbitSpeed * dt;
          p.x = host.x + Math.cos(p.orbitAngle) * p.orbitRadius;
          p.y = host.y + Math.sin(p.orbitAngle) * p.orbitRadius;
          p.angle = p.orbitAngle + Math.PI / 2;
          break;
        }
        case MOTION.ARC: {
          p.arcT += dt;
          const t = clamp(p.arcT / p.arcTotal, 0, 1);
          p.x = p.arcX0 + (p.arcX1 - p.arcX0) * t;
          p.y = p.arcY0 + (p.arcY1 - p.arcY0) * t - Math.sin(t * Math.PI) * p.arcHeight;
          p.angle = t * TAU * 2;
          if (t >= 1) {
            // Land: explode at the telegraphed point.
            if (p.aoeRadius > 0) {
              areaDamage(run, p.arcX1, p.arcY1, p.aoeRadius, p.aoeDamage || p.damage,
                         this.fromEnemy ? SRC.BOSS : SRC.SPECIAL,
                         { falloff: 0.35, element: p.element });
              particles.ring(p.arcX1, p.arcY1, 14, p.visual.color, p.aoeRadius * 3.4);
              audio.play('explode');
            }
            if (this.fromEnemy) {
              const r = p.aoeRadius || p.radius;
              if (dist2(p.arcX1, p.arcY1, player.x, player.y) < r * r) {
                damagePlayer(run, p.damage, SRC.BOSS, { fromX: p.arcX1, fromY: p.arcY1 });
              }
            }
            p.life = 0;
          }
          break;
        }
        case MOTION.STICK: {
          if (p.stickHost) {
            if (!p.stickHost.active) { p.stickHost = null; }
            else { p.x = p.stickHost.x + p.stickOffX; p.y = p.stickHost.y + p.stickOffY; }
          } else {
            p.x += p.vx * dt; p.y += p.vy * dt;
          }
          if (p.stickHost || p.stickT < (p.maxLife - 0.05)) {
            p.stickT -= dt;
            if (p.stickT <= 0) {
              areaDamage(run, p.x, p.y, p.aoeRadius || 46, p.damage, SRC.AUTO,
                         { falloff: 0.2, element: p.element });
              particles.burst(p.x, p.y, 8, p.visual.color, { speed: 130, life: 0.3 });
              p.life = 0;
            }
          }
          break;
        }
        case MOTION.DRIFT_POP: {
          // Shiro Same's bubbles: drift, then POP into shrapnel.
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.vx *= 1 - 1.4 * dt; p.vy *= 1 - 1.4 * dt;
          p.popT -= dt;
          if (p.popT <= 0) { this._pop(p); p.life = 0; }
          break;
        }
        default:
          p.x += p.vx * dt; p.y += p.vy * dt;
      }

      if (p.spin) p.angle += p.spin * dt;

      // --- trail -------------------------------------------------------------
      if (p.trailColor) {
        p.trailT -= dt;
        if (p.trailT <= 0) {
          p.trailT = 0.03;
          particles.trail(p.x, p.y, -p.vx, -p.vy, p.trailColor, 0.3, 0.2);
        }
      }

      // --- collision ---------------------------------------------------------
      if (this.fromEnemy) {
        const r = p.radius + 9;
        if (dist2(p.x, p.y, player.x, player.y) < r * r && player.st.intangibleT <= 0) {
          damagePlayer(run, p.damage, SRC.BOSS, { fromX: p.x, fromY: p.y });
          if (p.aoeRadius > 0) particles.ring(p.x, p.y, 10, p.visual.color, p.aoeRadius * 3);
          p.life = 0;
        }
      } else if (p.motion !== MOTION.ARC) {
        if (this._hitEnemies(p, dt)) { i--; continue; }
      }

      // --- bounds ------------------------------------------------------------
      const b = run.bounds;
      if (p.x < b.minX - 200 || p.x > b.maxX + 200 || p.y < b.minY - 200 || p.y > b.maxY + 200) {
        this.pool.release(p); i--; continue;
      }
      if (!p.active) i--;
    }
  }

  /** @returns true if the projectile was released. */
  _hitEnemies(p, dt) {
    const run = this.run;
    const hash = run.enemyHash;
    const items = run.enemies.items;
    // The exact test below is `p.radius + e.radius`, so the broadphase margin
    // has to cover the largest enemy radius in the game or big targets stop
    // being hit by projectiles entirely — with no error anywhere.
    // The pad is `run.enemies.queryPad`, not a constant: this is the single
    // hottest broadphase in the game — 322 calls a tick gathering 16,158 indices
    // in a dense crowd — and the exact test on the next lines is
    // `p.radius + e.radius`, which for fodder is about 15px against a 147px
    // query. Sized to the crowd that is alive it gathers a quarter of that and
    // still covers the biggest thing on the field. 0.373ms -> 0.087ms per tick,
    // measured on 330 projectiles inside a 700-enemy, 300px-radius crowd.
    const n = hash.query(p.x, p.y, p.radius + run.enemies.queryPad);
    const stamp = ++this._hitStamp;

    for (let k = 0; k < n; k++) {
      const e = items[hash.resultAt(k)];
      if (!e || !e.active || e.hp <= 0 || e.spawnT > 0) continue;
      if (e.lastLineStamp === -p.uid) continue;          // already hit by this projectile
      const rr = p.radius + e.radius;
      if (dist2(p.x, p.y, e.x, e.y) > rr * rr) continue;

      // Level 5 Clearance: piercing attacks gain damage per enemy already pierced.
      const bonus = 1 + p.accumulatedPierceBonus;
      dealDamage(run, e, p.damage * bonus, SRC.AUTO, {
        fromX: p.px, fromY: p.py, element: p.element,
        knockback: p.knockback >= 0 ? p.knockback : undefined,
      });
      // Level 5 Clearance stacks per enemy already pierced. The relic layer owns
      // the increment so the number lives in one place (the relic's params).
      if (p.pierce > 0 && !this.fromEnemy) run.relicHooks.fire('onPierce', p, e);
      else if (p.pierceBonusPerHit) p.accumulatedPierceBonus += p.pierceBonusPerHit;

      if (p.aoeRadius > 0) {
        areaDamage(run, p.x, p.y, p.aoeRadius, p.aoeDamage || p.damage * 0.6, SRC.AUTO,
                   { falloff: 0.35, element: p.element });
        particles.burst(p.x, p.y, 6, p.visual.color, { speed: 160, life: 0.24 });
      }
      if (p.onHit) p.onHit(p, e, run);
      e.lastLineStamp = -p.uid;
      p.hitCount++;

      if (p.motion === MOTION.STICK && !p.stickHost) {
        p.stickHost = e;
        p.stickOffX = p.x - e.x; p.stickOffY = p.y - e.y;
        return false;
      }

      if (p.motion === MOTION.BOUNCE && p.bounces > 0) {
        p.bounces--;
        p.damage *= p.bounceDamageMult;
        const next = nearestTo(run, p.x, p.y, p.bounceRange, null);
        if (next && next !== e) {
          p.angle = Math.atan2(next.y - p.y, next.x - p.x);
          p.vx = Math.cos(p.angle) * p.speed;
          p.vy = Math.sin(p.angle) * p.speed;
          p.target = next;
          p.life = Math.max(p.life, 0.7);
          return false;
        }
        this.pool.release(p);
        return true;
      }

      if (p.hitCount > p.pierce) {
        if (p.splitInto > 0) this._split(p);
        this.pool.release(p);
        return true;
      }
    }
    return false;
  }

  _split(p) {
    for (let i = 0; i < p.splitInto; i++) {
      const a = p.angle + (i / p.splitInto - 0.5) * 1.4;
      this.fire(p.x, p.y, a, {
        speed: p.speed * 0.75, damage: p.splitDamage || p.damage * 0.5,
        life: 0.6, radius: p.radius * 0.7, visual: p.visual,
        element: p.element, owner: p.owner,
      });
    }
  }

  _pop(p) {
    const n = p.popCount;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + runRng.raw();
      this.fire(p.x, p.y, a, {
        speed: 360, damage: p.splitDamage || p.damage * 0.7,
        life: 0.5, radius: p.radius * 0.55, visual: p.visual,
        element: p.element, owner: p.owner, tag: p.tag + '_shard',
      });
    }
    particles.burst(p.x, p.y, 5, p.visual.color, { speed: 120, life: 0.24 });
  }

  _expire(p) {
    if (p.aoeRadius > 0 && p.motion !== MOTION.ARC && p.motion !== MOTION.STICK) {
      areaDamage(this.run, p.x, p.y, p.aoeRadius, p.aoeDamage || p.damage,
                 this.fromEnemy ? SRC.BOSS : SRC.AUTO, { falloff: 0.4, element: p.element });
    }
  }

  clear() { this.pool.clear(); }

  draw(r, alpha) {
    const items = this.pool.items;
    for (let i = 0; i < this.pool.count; i++) {
      const p = items[i];
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha;
      r.drawSprite(p.sprite, x, y, p.angle, p.scale, 1, false, 0);
    }
    r.setAlpha(1);
  }
}

// Bright and saturated for the player; cool-toned for enemies (SECTION 1's
// readability rule, applied as a default rather than remembered per call site).
const DEFAULT_VISUAL = { shape: 'shard', color: '#ffe86a', accent: '#7a4d00', size: 7, rotates: true, glow: true };
const DEFAULT_ENEMY_VISUAL = { shape: 'diamond', color: '#ff6f91', accent: '#3a0a18', size: 6, rotates: true };

export { DEFAULT_VISUAL, DEFAULT_ENEMY_VISUAL };
const EMPTY = {};
