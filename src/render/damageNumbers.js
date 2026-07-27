// Damage numbers: pooled, capped at 60, aggregated, and drawn from a bitmap
// digit atlas rather than fillText.
//
// SPEC: white normal, yellow crit (bigger, pops harder), purple DoT. If the same
// enemy is hit 5 times in 200ms, stack into one number.
//
// Aggregation is not just a visual nicety — it is what keeps the cap meaningful
// when a piercing railgun hits 40 enemies in one tick.

import { CONFIG } from '../core/config.js';
import { Pool } from '../core/pool.js';
import { feel } from '../core/feel.js';
import { save } from '../core/save.js';
import { fxRng } from '../core/rng.js';
import { digits } from './spriteAtlas.js';
import { easeOutCubic, easeOutBack, formatNumber } from '../core/math.js';

export const DMG_KIND = { NORMAL: 0, CRIT: 1, DOT: 2, HEAL: 3, MISS: 4, EXECUTE: 5 };

const KIND_COLOR = ['#ffffff', '#ffd94a', '#c58cff', '#7bf59a', '#9fb0d0', '#ff6f91'];
const KIND_SIZE  = [22, 30, 19, 22, 20, 34];

function makeNumber() {
  return {
    active: false, _i: 0,
    x: 0, y: 0, vx: 0, vy: 0,
    value: 0, kind: 0,
    life: 0, maxLife: 1,
    ownerId: -1, born: 0,
    text: '', scale: 1,
  };
}

export class DamageNumbers {
  constructor(max = CONFIG.MAX_DAMAGE_NUMBERS) {
    this.pool = new Pool(makeNumber, (n) => { n.text = ''; n.ownerId = -1; }, max, max, false);
    this.max = max;
    this.time = 0;
    this._sets = new Map();
  }

  _set(kind, sizePx) {
    const color = KIND_COLOR[kind];
    const key = kind + '|' + sizePx;
    let s = this._sets.get(key);
    if (!s) { s = digits.build(color, sizePx, true); this._sets.set(key, s); }
    return s;
  }

  /** Pre-raster every glyph set at boot so nothing rasterises mid-run. */
  prewarm() {
    for (let k = 0; k < KIND_COLOR.length; k++) {
      this._set(k, KIND_SIZE[k]);
      this._set(k, Math.round(KIND_SIZE[k] * feel.dmgNumberCritScale));
    }
  }

  /**
   * @param ownerId a stable per-entity id used for stacking. Pass -1 to opt out.
   */
  spawn(x, y, value, kind, ownerId) {
    const mode = save.data.settings.damageNumbers;
    if (mode === 'off') return;
    if (mode === 'crits' && kind !== DMG_KIND.CRIT && kind !== DMG_KIND.EXECUTE) return;

    // Aggregate: same owner, same kind, inside the stack window.
    if (ownerId !== undefined && ownerId >= 0) {
      const items = this.pool.items;
      for (let i = 0; i < this.pool.count; i++) {
        const n = items[i];
        if (n.ownerId === ownerId && n.kind === kind &&
            this.time - n.born < feel.dmgNumberStackWindow) {
          n.value += value;
          n.text = this._format(n.value, kind);
          n.life = Math.max(n.life, n.maxLife * 0.72);
          n.scale = 1.28;              // a little pop on each merge
          n.born = this.time;
          return;
        }
      }
    }

    let n = this.pool.spawn();
    if (!n) {
      // At the cap, replace the oldest — a fresh hit matters more than a fading one.
      this.pool.releaseOldest();
      n = this.pool.spawn();
      if (!n) return;
    }
    n.x = x + fxRng.signed() * feel.dmgNumberSpread;
    n.y = y - 6;
    n.vx = fxRng.signed() * 22;
    n.vy = -feel.dmgNumberRise * (kind === DMG_KIND.CRIT ? 1.4 : 1);
    n.value = value;
    n.kind = kind;
    n.ownerId = ownerId === undefined ? -1 : ownerId;
    n.maxLife = n.life = feel.dmgNumberLife * (kind === DMG_KIND.CRIT ? 1.2 : 1);
    n.born = this.time;
    n.text = this._format(value, kind);
    n.scale = kind === DMG_KIND.CRIT ? 1.5 : 1;
  }

  _format(v, kind) {
    if (kind === DMG_KIND.MISS) return 'MISS';
    if (kind === DMG_KIND.HEAL) return '+' + Math.round(v);
    if (kind === DMG_KIND.EXECUTE) return 'x';
    return formatNumber(v);
  }

  update(dt) {
    this.time += dt;
    const items = this.pool.items;
    for (let i = 0; i < this.pool.count; i++) {
      const n = items[i];
      n.life -= dt;
      if (n.life <= 0) { this.pool.release(n); i--; continue; }
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      n.vy += 150 * dt;           // arc back down
      n.vx *= 1 - 3 * dt;
      if (n.scale > 1) n.scale = Math.max(1, n.scale - dt * 3.2);
    }
  }

  draw(r) {
    const items = this.pool.items;
    for (let i = 0; i < this.pool.count; i++) {
      const n = items[i];
      const t = 1 - n.life / n.maxLife;
      const alpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
      // A short overshoot on birth is what makes crits "pop harder".
      const pop = t < 0.16 ? easeOutBack(t / 0.16) : 1;
      const size = KIND_SIZE[n.kind];
      const set = this._set(n.kind, size);
      const scale = n.scale * pop * (n.kind === DMG_KIND.CRIT ? 1.06 : 1) * 0.045;
      r.drawGlyphs(n.text, n.x, n.y, set, scale * 22, alpha, true);
    }
    r.setAlpha(1);
  }

  clear() { this.pool.clear(); }
  get count() { return this.pool.count; }
}

export const damageNumbers = new DamageNumbers();

// --- floating text -----------------------------------------------------------
// Non-numeric callouts: "LEVEL UP!", ability names, barks, "RESONANCE".
// Low volume (a handful on screen), so real text rendering is fine here.

const MAX_FLOATERS = 24;

class FloatingText {
  constructor() {
    this.items = [];
    for (let i = 0; i < MAX_FLOATERS; i++) {
      this.items.push({ active: false, x: 0, y: 0, vy: 0, text: '', color: '#fff', size: 20, life: 0, maxLife: 1, follow: null, ox: 0, oy: 0 });
    }
  }
  spawn(x, y, text, color, size, life, follow) {
    let slot = null;
    for (const it of this.items) if (!it.active) { slot = it; break; }
    if (!slot) { slot = this.items[0]; }        // oldest-ish; fine at this volume
    slot.active = true;
    slot.x = x; slot.y = y; slot.vy = -34;
    slot.text = text; slot.color = color || '#ffffff';
    slot.size = size || 20;
    slot.maxLife = slot.life = life || 1.2;
    slot.follow = follow || null;
    slot.ox = 0; slot.oy = follow ? -34 : 0;
    return slot;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.life -= dt;
      if (it.life <= 0) { it.active = false; it.follow = null; continue; }
      if (it.follow && it.follow.active) { it.x = it.follow.x; it.y = it.follow.y + it.oy; it.oy -= 14 * dt; }
      else { it.follow = null; it.y += it.vy * dt; it.vy *= 1 - 2.2 * dt; }
    }
  }
  draw(r) {
    for (const it of this.items) {
      if (!it.active) continue;
      const t = 1 - it.life / it.maxLife;
      const a = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;
      const pop = t < 0.14 ? easeOutBack(t / 0.14) : 1;
      r.drawText(it.text, it.x, it.y, {
        size: it.size * pop, color: it.color, align: 'center', baseline: 'middle',
        weight: 800, outline: true, alpha: a,
      });
    }
  }
  clear() { for (const it of this.items) { it.active = false; it.follow = null; } }
}

export const floaters = new FloatingText();
