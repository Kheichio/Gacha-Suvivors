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
import { TAU, easeOutCubic } from '../core/math.js';

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
  }

  draw(r, alpha) {
    const items = this.pool.items;
    // Two passes so the composite mode flips exactly twice per frame, not per particle.
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) r.setComposite('lighter');
      for (let i = 0; i < this.pool.count; i++) {
        const p = items[i];
        if ((pass === 1) !== p.additive) continue;
        const t = 1 - p.life / p.maxLife;
        const e = easeOutCubic(t);
        const s = p.size + (p.sizeEnd - p.size) * e;
        if (s <= 0.01) continue;
        const a = p.alpha + (p.alphaEnd - p.alpha) * e;
        const x = p.px + (p.x - p.px) * alpha;
        const y = p.py + (p.y - p.py) * alpha;
        r.drawSprite(p.sprite, x, y, p.rot, s, a, false, 0);
      }
      if (pass === 1) r.setComposite('source-over');
    }
    r.setAlpha(1);
  }

  clear() { this.pool.clear(); }
  get count() { return this.pool.count; }
}

const EMPTY = {};
export const particles = new ParticleSystem();
