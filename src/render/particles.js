// Pooled particles, capped at 800, oldest dropped first.
//
// Particles never allocate and never branch per-type in the update loop: a
// particle is 12 numbers and one atlas sprite reference. Behaviour variety comes
// from the initial velocity/drag/gravity the emitter sets, not from a type tag.

import { CONFIG } from '../core/config.js';
import { Pool } from '../core/pool.js';
import { feel } from '../core/feel.js';
import { fxRng } from '../core/rng.js';
import { atlas } from './spriteAtlas.js';
import { effects } from './effects.js';
import { TAU, easeOutCubic } from '../core/math.js';

// --- presentation curves -----------------------------------------------------
// Three cheap upgrades over "shrink linearly and fade out", all of them paid for
// with arithmetic on numbers the particle already stores.

/** Fraction of a life spent popping OUT before the shrink begins. */
const POP = 0.16;
/**
 * Speed² above which a particle gets velocity-aligned ghosts behind it. A dot
 * moving 400 px/s covers seven pixels between frames, and the eye reads that as
 * a stutter; two trailing copies read it as a streak. Squared so the test is a
 * comparison and not a square root.
 */
const STREAK_SPEED2 = 260 * 260;
/** How far apart the ghosts sit, in world px at scale 1. */
const STREAK_PX = 9;
/**
 * Above this many live particles the extra passes are dropped entirely. A
 * screen already carrying 320 particles does not need bloom on any of them, and
 * the cap is what keeps a worst-case explosion from tripling the draw count.
 */
const RICH_LIMIT = 320;

function makeParticle() {
  return {
    active: false, _i: 0,
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    life: 0, maxLife: 1,
    size: 1, sizeEnd: 0,
    rot: 0, spin: 0,
    drag: 5, grav: 0,
    alpha: 1, alphaEnd: 0,
    sprite: null,
    additive: false,
  };
}

function resetParticle(p) { p.sprite = null; }

export class ParticleSystem {
  constructor(max = CONFIG.MAX_PARTICLES) {
    this.pool = new Pool(makeParticle, resetParticle, Math.min(256, max), max, true);
    this.max = max;
    /** Pre-rastered particle sprites, keyed by colour. Built lazily at boot. */
    this._sprites = new Map();
  }

  spriteFor(color, shape) {
    const key = color + '|' + (shape || 'circle');
    let s = this._sprites.get(key);
    if (!s) {
      // flash:false — a particle is never hit, so it never needs the white twin.
      s = atlas.register({ shape: shape || 'circle', color, size: 8, outline: false, flash: false });
      this._sprites.set(key, s);
    }
    return s;
  }

  _take() {
    if (this.pool.count >= this.max) this.pool.releaseOldest();
    return this.pool.spawn();
  }

  /** The general emitter. All the named helpers below funnel into this. */
  emit(x, y, vx, vy, o) {
    const p = this._take();
    if (!p) return null;
    p.x = p.px = x; p.y = p.py = y;
    p.vx = vx; p.vy = vy;
    p.maxLife = p.life = o.life || feel.particleLife;
    p.size = o.size || 1;
    p.sizeEnd = o.sizeEnd === undefined ? 0 : o.sizeEnd;
    p.rot = o.rot || 0;
    p.spin = o.spin || 0;
    p.drag = o.drag === undefined ? feel.particleDrag : o.drag;
    p.grav = o.grav || 0;
    p.alpha = o.alpha === undefined ? 1 : o.alpha;
    p.alphaEnd = o.alphaEnd === undefined ? 0 : o.alphaEnd;
    p.sprite = o.sprite || this.spriteFor(o.color || '#ffffff', o.shape);
    p.additive = !!o.additive;
    return p;
  }

  /** SPEC: small enemies pop into 4 particles. */
  burst(x, y, count, color, opts) {
    const o = opts || EMPTY;
    const speed = o.speed || 130;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + fxRng.raw() * 0.7;
      const s = speed * (0.55 + fxRng.raw() * 0.75);
      this.emit(x, y, Math.cos(a) * s, Math.sin(a) * s, {
        color, life: (o.life || 0.42) * (0.7 + fxRng.raw() * 0.6),
        size: o.size || 0.55, sizeEnd: 0.05,
        drag: o.drag === undefined ? 6 : o.drag,
        shape: o.shape, additive: o.additive,
      });
    }
  }

  /** SPEC: elites explode with a ring. Even spacing, uniform speed — reads as a shockwave. */
  ring(x, y, count, color, radiusSpeed, opts) {
    const o = opts || EMPTY;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU;
      this.emit(x, y, Math.cos(a) * radiusSpeed, Math.sin(a) * radiusSpeed, {
        color, life: o.life || 0.5,
        size: o.size || 0.7, sizeEnd: 0.1,
        drag: o.drag === undefined ? 2.4 : o.drag,
        shape: o.shape || 'diamond', additive: true,
      });
    }
  }

  /** A directional cone — muzzle flashes, blood, impact spray. */
  cone(x, y, angle, spread, count, color, opts) {
    const o = opts || EMPTY;
    const speed = o.speed || 200;
    for (let i = 0; i < count; i++) {
      const a = angle + (fxRng.raw() - 0.5) * spread;
      const s = speed * (0.5 + fxRng.raw());
      this.emit(x, y, Math.cos(a) * s, Math.sin(a) * s, {
        color, life: (o.life || 0.3) * (0.6 + fxRng.raw() * 0.8),
        size: o.size || 0.5, sizeEnd: 0.05, drag: 8,
        shape: o.shape, additive: o.additive,
      });
    }
  }

  /** Slow drifting motes — ambient stage atmosphere, aura fields, spirit bomb. */
  drift(x, y, color, opts) {
    const o = opts || EMPTY;
    const a = fxRng.angle();
    const s = o.speed || 18;
    return this.emit(x, y, Math.cos(a) * s, Math.sin(a) * s, {
      color, life: o.life || 1.4, size: o.size || 0.4, sizeEnd: o.sizeEnd || 0.1,
      drag: 0.6, grav: o.grav || -12, alpha: o.alpha || 0.7,
      shape: o.shape, additive: true,
    });
  }

  /** A trailing spark that inherits the emitter's motion — dashes, projectiles. */
  trail(x, y, vx, vy, color, size, life) {
    return this.emit(x, y, vx * 0.25 + fxRng.signed() * 14, vy * 0.25 + fxRng.signed() * 14, {
      color, life: life || 0.24, size: size || 0.4, sizeEnd: 0.02, drag: 9, additive: true,
    });
  }

  /**
   * Also ticks the animated effect layer.
   *
   * `effects` is a sibling presentation system with exactly the same lifecycle:
   * it must advance on every sim step the particles advance on, freeze wherever
   * they freeze, and be wiped whenever they are wiped. Every one of those call
   * sites already calls into here, so hanging the effect tick off this one
   * function is what keeps the two layers from ever drifting apart.
   */
  update(dt) {
    const items = this.pool.items;
    for (let i = 0; i < this.pool.count; i++) {
      const p = items[i];
      p.px = p.x; p.py = p.y;
      p.life -= dt;
      if (p.life <= 0) { this.pool.release(p); i--; continue; }
      const d = 1 - p.drag * dt;
      p.vx *= d > 0 ? d : 0;
      p.vy *= d > 0 ? d : 0;
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    effects.update(dt);
  }

  draw(r, alpha) {
    const items = this.pool.items;
    // Extra passes are a luxury; a crowded screen gets the plain one.
    const rich = this.pool.count < RICH_LIMIT;
    // Two passes so the composite mode flips exactly twice per frame, not per particle.
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) r.setComposite('lighter');
      for (let i = 0; i < this.pool.count; i++) {
        const p = items[i];
        if ((pass === 1) !== p.additive) continue;
        const t = 1 - p.life / p.maxLife;
        const e = easeOutCubic(t);
        // SIZE CURVE, not a linear fade: a fast pop out to 1.15x over the first
        // sixth of the life, then an eased settle. A dot that only ever shrinks
        // reads as something disappearing; a dot that pops reads as an impact.
        const curve = t < POP ? 0.50 + 0.65 * (t / POP)
                              : 1.15 - 0.15 * ((t - POP) / (1 - POP));
        const s = (p.size + (p.sizeEnd - p.size) * e) * curve;
        if (s <= 0.02) continue;
        // Alpha holds and then drops, rather than bleeding away from frame one.
        const a = p.alpha + (p.alphaEnd - p.alpha) * (t * t);
        const x = p.px + (p.x - p.px) * alpha;
        const y = p.py + (p.y - p.py) * alpha;
        if (rich && pass === 1 && s >= 0.25) {
          // Additive layering: a wide, dim copy under the bright one. One extra
          // blit buys a soft halo that no single sprite size can express.
          r.drawSprite(p.sprite, x, y, p.rot, s * 2.05, a * 0.20, false, 0);
        }
        r.drawSprite(p.sprite, x, y, p.rot, s, a, false, 0);
        // VELOCITY-ALIGNED STRETCH. Two ghosts spaced back along the particle's
        // own motion vector, so a fast spark is a streak pointing where it came
        // from instead of a round dot in a different place each frame.
        const v2 = p.vx * p.vx + p.vy * p.vy;
        if (rich && v2 > STREAK_SPEED2 && a > 0.12) {
          const k = STREAK_PX * s / Math.sqrt(v2);
          const gx = p.vx * k, gy = p.vy * k;
          r.drawSprite(p.sprite, x - gx, y - gy, p.rot, s * 0.78, a * 0.55, false, 0);
          r.drawSprite(p.sprite, x - gx * 2, y - gy * 2, p.rot, s * 0.52, a * 0.28, false, 0);
        }
      }
      if (pass === 1) r.setComposite('source-over');
    }
    r.setAlpha(1);
  }

  clear() { this.pool.clear(); effects.clear(); }
  get count() { return this.pool.count; }
}

const EMPTY = {};
export const particles = new ParticleSystem();
