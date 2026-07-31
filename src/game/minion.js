// Player-side minions: shadow clones, Deadbeats, zombie followers, foxfire
// wisps, the Full Susanoo warrior, decoys.
//
// DECISIONS.md §27: `isMinion` is what Niten's Dokkodo passive counts. Decoys,
// rifts, chum piles, torii gates and burning ground are PROPS and set it false;
// anything that fights alongside you sets it true. That single flag is what makes
// an otherwise undefined interaction ("does a Susanoo break Dokkodo?") answerable.

import { Pool } from '../core/pool.js';
import { runRng, fxRng } from '../core/rng.js';
import { atlas } from '../render/spriteAtlas.js';
import { particles } from '../render/particles.js';
import { clamp, dirTo, V, dist2, TAU, rotateToward } from '../core/math.js';
import { dealDamage, areaDamage, coneDamage, SRC } from './damage.js';
import { nearestTo } from './targeting.js';
import { applyTaunt } from './statusEffects.js';
import { CONFIG } from '../core/config.js';

export const MINION_ROLE = {
  MELEE: 0,        // chases and swings — zombies, Deadbeats
  MIRROR: 1,       // mirrors the player's auto-attack — shadow clones
  SEEKER: 2,       // flies at a target and detonates — foxfire wisps
  GUARD: 3,        // orbits the player and blocks/swings — Full Susanoo
  DECOY: 4,        // taunts, deals no damage, IS NOT A MINION (isMinion false)
};

function makeMinion() {
  return {
    active: false, _i: 0, uid: 0,
    role: 0, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    hp: 0, maxHp: 0, damage: 0, speed: 0, radius: 12,
    life: 0, permanent: false,
    attackCd: 0, attackInterval: 1,
    target: null, orbitAngle: 0, orbitRadius: 0,
    sprite: null, visual: null, scale: 1,
    isMinion: true,
    element: null,
    facing: 0,
    onExpire: null, tag: '',
    blockCd: 0, aiT: 0,
    ownerBonusShare: 1,
  };
}

function resetMinion(m) {
  m.target = null; m.sprite = null; m.visual = null; m.onExpire = null; m.tag = '';
}

/** Per-system, so a uid means the same thing on run 2 as on run 1. */
let uidCounter = 1;

export class MinionSystem {
  constructor(run) {
    this.run = run;
    this.pool = new Pool(makeMinion, resetMinion, 32, CONFIG.MAX_MINIONS, true);
    this._nextUid = uidCounter;
  }

  get items() { return this.pool.items; }
  get count() { return this.pool.count; }

  /** How many entities count for Niten's Dokkodo. Props are excluded. */
  get minionCount() {
    let n = 0;
    const items = this.pool.items;
    for (let i = 0; i < this.pool.count; i++) if (items[i].isMinion) n++;
    return n;
  }

  spawn(x, y, opts) {
    const o = opts || EMPTY;
    // Respect the cap, but let a fresh summon replace the oldest of its own tag
    // rather than silently failing (which reads as the ability not working).
    if (this.pool.count >= this.pool.max) {
      const items = this.pool.items;
      for (let i = 0; i < this.pool.count; i++) {
        if (items[i].tag === o.tag) { this.pool.release(items[i]); break; }
      }
    }
    const m = this.pool.spawn();
    if (!m) return null;
    m.uid = this._nextUid++;
    m.role = o.role || MINION_ROLE.MELEE;
    m.x = m.px = x; m.y = m.py = y;
    m.vx = 0; m.vy = 0;
    m.hp = m.maxHp = o.hp || 30;
    m.damage = o.damage || 10;
    m.speed = o.speed || 190;
    m.life = o.life || 0;
    m.permanent = !o.life;
    m.attackInterval = o.attackInterval || 0.8;
    m.attackCd = runRng.range(0, m.attackInterval);
    m.orbitAngle = o.orbitAngle !== undefined ? o.orbitAngle : runRng.angle();
    m.orbitRadius = o.orbitRadius || 62;
    m.visual = o.visual || DEFAULT_MINION_VISUAL;
    // A COPY OF SOMEBODY WEARS THAT SOMEBODY'S BODY.
    //
    // `o.sprite` is an ALREADY-REGISTERED atlas Sprite the caller hands over —
    // in practice `p.sprite`, the summoner's own pixel art. A clone drawn as a
    // coloured capsule is a pet; a clone drawn as a second copy of the character
    // is a clone, and that distinction is the entire read on a kit built out of
    // them. Nothing here learns whose sprite it is, so it stays generic.
    //
    // A pixel sprite is rastered at a whole-number upscale of its little grid,
    // so it needs `unit` to cancel the rounding exactly the way player.js does;
    // a shape sprite is already at its declared size and wants a plain 1.
    if (o.sprite) {
      m.sprite = o.sprite;
      m.scale = (o.sprite.unit || 1) * (o.spriteScale || 1);
    } else {
      m.sprite = atlas.ensure(m.visual);
      m.scale = 1;
    }
    m.radius = m.visual.size || 12;
    m.isMinion = o.isMinion !== false;      // props pass false explicitly
    m.element = o.element || null;
    m.onExpire = o.onExpire || null;
    m.tag = o.tag || '';
    m.blockCd = 0;
    m.aiT = 0;
    m.target = null;
    m.ownerBonusShare = o.bonusShare === undefined ? 1 : o.bonusShare;
    particles.burst(x, y, 6, m.visual.color, { speed: 130, life: 0.3, additive: true });
    return m;
  }

  /** How many of a given tag are alive — for the "max 4 zombies" caps. */
  countTag(tag) {
    let n = 0;
    const items = this.pool.items;
    for (let i = 0; i < this.pool.count; i++) if (items[i].tag === tag) n++;
    return n;
  }

  update(dt) {
    const run = this.run;
    const p = run.player;
    const items = this.pool.items;

    for (let i = 0; i < this.pool.count; i++) {
      const m = items[i];
      m.px = m.x; m.py = m.y;

      if (!m.permanent) {
        m.life -= dt;
        if (m.life <= 0) { this._expire(m); i--; continue; }
      }
      if (m.hp <= 0) { this._expire(m); i--; continue; }

      switch (m.role) {
        case MINION_ROLE.MIRROR: {
          // Drifts around the player, mirrors the auto-attack at a share of damage.
          m.orbitAngle += dt * 1.2;
          const tx = p.x + Math.cos(m.orbitAngle) * m.orbitRadius;
          const ty = p.y + Math.sin(m.orbitAngle) * m.orbitRadius;
          if (dirTo(m.x, m.y, tx, ty) > 3) {
            m.x += V.x * m.speed * dt;
            m.y += V.y * m.speed * dt;
          }
          m.attackCd -= dt;
          if (m.attackCd <= 0) {
            m.attackCd = m.attackInterval;
            const t = nearestTo(run, m.x, m.y, 420, null);
            if (t) {
              m.facing = Math.atan2(t.y - m.y, t.x - m.x);
              run.fireMirroredAuto(m, m.damage);
            }
          }
          // Clones taunt nearby enemies so they actually take pressure off you.
          m.aiT -= dt;
          if (m.aiT <= 0) {
            m.aiT = 1.5;
            const t = nearestTo(run, m.x, m.y, 160, null);
            if (t) applyTaunt(t.st, 1.6, m.x, m.y);
          }
          break;
        }

        case MINION_ROLE.SEEKER: {
          if (!m.target || !m.target.active || m.target.hp <= 0) {
            m.target = nearestTo(run, m.x, m.y, 600, null);
          }
          if (m.target) {
            const want = Math.atan2(m.target.y - m.y, m.target.x - m.x);
            m.facing = rotateToward(m.facing, want, 5 * dt);
            m.x += Math.cos(m.facing) * m.speed * dt;
            m.y += Math.sin(m.facing) * m.speed * dt;
            const rr = m.radius + m.target.radius;
            if (dist2(m.x, m.y, m.target.x, m.target.y) < rr * rr) {
              dealDamage(run, m.target, m.damage, SRC.MINION, { fromX: m.x, fromY: m.y, element: m.element });
              this._expire(m); i--; continue;
            }
          } else {
            // Orbit the player until something shows up.
            m.orbitAngle += dt * 2.4;
            m.x = p.x + Math.cos(m.orbitAngle) * m.orbitRadius;
            m.y = p.y + Math.sin(m.orbitAngle) * m.orbitRadius;
          }
          if ((run.frameParity & 1) === 0) particles.trail(m.x, m.y, -m.vx, -m.vy, m.visual.color, 0.28, 0.22);
          break;
        }

        case MINION_ROLE.GUARD: {
          // Full Susanoo: orbits close, blocks a hit every 4s, swings at anything near.
          m.orbitAngle += dt * 0.9;
          m.x = p.x + Math.cos(m.orbitAngle) * m.orbitRadius;
          m.y = p.y + Math.sin(m.orbitAngle) * m.orbitRadius;
          m.blockCd -= dt;
          if (m.blockCd <= 0 && p.st.shieldHits < 1) {
            m.blockCd = 4;
            p.st.shieldHits++;
          }
          m.attackCd -= dt;
          if (m.attackCd <= 0) {
            m.attackCd = m.attackInterval;
            const hits = coneDamage(run, m.x, m.y, m.orbitAngle, 2.6, 110, m.damage, SRC.MINION,
                                    { element: m.element });
            if (hits) particles.cone(m.x, m.y, m.orbitAngle, 2.6, 5, m.visual.color, { speed: 200, life: 0.22 });
          }
          break;
        }

        case MINION_ROLE.DECOY: {
          // A prop, not a minion. Taunts, takes no action, disappears on expiry.
          m.aiT -= dt;
          if (m.aiT <= 0) {
            m.aiT = 0.4;
            const hash = run.enemyHash;
            const es = run.enemies.items;
            const n = hash.query(m.x, m.y, 260);
            for (let k = 0; k < n; k++) {
              const e = es[hash.resultAt(k)];
              if (e && e.active) applyTaunt(e.st, 0.6, m.x, m.y);
            }
          }
          break;
        }

        default: { // MELEE
          if (!m.target || !m.target.active || m.target.hp <= 0 ||
              dist2(m.x, m.y, p.x, p.y) > 620 * 620) {
            m.target = nearestTo(run, m.x, m.y, 480, null);
          }
          const tx = m.target ? m.target.x : p.x;
          const ty = m.target ? m.target.y : p.y;
          const stopDist = m.target ? m.radius + m.target.radius : 70;
          if (dirTo(m.x, m.y, tx, ty) > stopDist) {
            m.x += V.x * m.speed * dt;
            m.y += V.y * m.speed * dt;
            m.facing = Math.atan2(V.y, V.x);
          }
          // A minion that wanders too far snaps back — nothing is more annoying
          // than a summon stuck three screens away.
          if (dist2(m.x, m.y, p.x, p.y) > 900 * 900) {
            m.x = p.x + fxRng.signed() * 60;
            m.y = p.y + fxRng.signed() * 60;
            m.px = m.x; m.py = m.y;
          }
          m.attackCd -= dt;
          if (m.attackCd <= 0 && m.target) {
            const rr = m.radius + m.target.radius + 18;
            if (dist2(m.x, m.y, m.target.x, m.target.y) < rr * rr) {
              m.attackCd = m.attackInterval;
              dealDamage(run, m.target, m.damage, SRC.MINION,
                         { fromX: m.x, fromY: m.y, element: m.element });
              particles.cone(m.x, m.y, m.facing, 0.9, 3, m.visual.color, { speed: 160, life: 0.18 });
            }
          }
          break;
        }
      }

      const b = run.bounds;
      m.x = clamp(m.x, b.minX, b.maxX);
      m.y = clamp(m.y, b.minY, b.maxY);
    }
  }

  _expire(m) {
    if (m.onExpire) m.onExpire(m, this.run);
    particles.burst(m.x, m.y, 6, m.visual.color, { speed: 140, life: 0.32 });
    this.pool.release(m);
  }

  /** Enemies can damage minions — Uzu's clones are individually killable. */
  damageMinionsNear(x, y, radius, amount) {
    const items = this.pool.items;
    for (let i = 0; i < this.pool.count; i++) {
      const m = items[i];
      if (m.role === MINION_ROLE.DECOY) continue;
      const rr = radius + m.radius;
      if (dist2(x, y, m.x, m.y) > rr * rr) continue;
      m.hp -= amount;
      if (m.hp <= 0) { this._expire(m); i--; }
    }
  }

  killAll(tag) {
    const items = this.pool.items;
    for (let i = 0; i < this.pool.count; i++) {
      if (!tag || items[i].tag === tag) { this._expire(items[i]); i--; }
    }
  }

  clear() { this.pool.clear(); }

  draw(r, alpha) {
    const items = this.pool.items;
    for (let i = 0; i < this.pool.count; i++) {
      const m = items[i];
      const x = m.px + (m.x - m.px) * alpha;
      const y = m.py + (m.y - m.py) * alpha;
      // Minions render at reduced alpha so they never get mistaken for the player.
      let a = m.role === MINION_ROLE.DECOY ? 0.55 : 0.85;
      // Blink out over the last second so the expiry is never a surprise.
      if (!m.permanent && m.life < 1.2) a *= 0.45 + 0.45 * Math.sin(m.life * 22);
      r.drawSprite(m.sprite, x, y, m.role === MINION_ROLE.SEEKER ? m.facing : 0, m.scale, a, false, 0);
    }
    r.setAlpha(1);
  }
}

const DEFAULT_MINION_VISUAL = { shape: 'capsule', color: '#9fd3ff', accent: '#123a5c', size: 11 };
const EMPTY = {};
