// Follow camera with deadzone, lookahead, punch-out zoom and screen shake.
//
// Per SECTION 3: 24px deadzone, 0.15 lerp, up to 40px lookahead, and a punch-OUT
// (1.0 -> 1.06) on special. Never zoom in during combat — readability wins.

import { CONFIG } from '../core/config.js';
import { clamp, damp, lerp, easeOutCubic } from '../core/math.js';
import { feel } from '../core/feel.js';

export class Camera {
  constructor() {
    this.x = 0; this.y = 0;         // world-space centre
    this.px = 0; this.py = 0;       // previous, for render interpolation
    this.zoom = 1;
    this.targetZoom = 1;
    this.baseZoom = 1;

    this.vw = CONFIG.BASE_W; this.vh = CONFIG.BASE_H;   // viewport in CSS px
    this.shakeX = 0; this.shakeY = 0;

    this.lookX = 0; this.lookY = 0;
    this._punchT = 0; this._punchDur = 0; this._punchAmt = 0;
    this.bounds = { minX: 0, minY: 0, maxX: CONFIG.ARENA_W, maxY: CONFIG.ARENA_H };
    this.clampToBounds = true;
  }

  resize(vw, vh) {
    this.vw = vw; this.vh = vh;
    // Keep a consistent amount of world visible regardless of window size, so a
    // wide monitor is not a gameplay advantage.
    this.baseZoom = Math.max(vw / CONFIG.BASE_W, vh / CONFIG.BASE_H);
  }

  setBounds(minX, minY, maxX, maxY) {
    this.bounds.minX = minX; this.bounds.minY = minY;
    this.bounds.maxX = maxX; this.bounds.maxY = maxY;
  }

  snapTo(x, y) {
    this.x = this.px = x;
    this.y = this.py = y;
    this.lookX = 0; this.lookY = 0;
  }

  /** Punch OUT to `amt` extra zoom over `dur` seconds, then ease back. */
  punch(amt = 0.06, dur = 0.4) {
    this._punchAmt = Math.max(this._punchAmt, amt);
    this._punchDur = dur;
    this._punchT = dur;
  }

  /** Sustained zoom override — Alicia's dragon form pulls out to 0.9. */
  setZoomTarget(z) { this.targetZoom = z; }

  /**
   * @param {number} dt sim seconds
   * @param {object} target {x, y, vx, vy}
   */
  update(dt, target) {
    this.px = this.x; this.py = this.y;
    if (!target) return;

    const dz = feel.cameraDeadzone;
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const d = Math.hypot(dx, dy);

    // Lookahead in the movement direction, smoothed so it does not snap.
    const speed = Math.hypot(target.vx || 0, target.vy || 0);
    const ahead = speed > 8 ? feel.cameraLookahead : 0;
    const nx = speed > 1 ? (target.vx || 0) / speed : 0;
    const ny = speed > 1 ? (target.vy || 0) / speed : 0;
    this.lookX = damp(this.lookX, nx * ahead, 0.06, dt);
    this.lookY = damp(this.lookY, ny * ahead, 0.06, dt);

    if (d > dz) {
      const pull = (d - dz) / d;
      const tx = this.x + dx * pull + this.lookX;
      const ty = this.y + dy * pull + this.lookY;
      this.x = damp(this.x, tx, feel.cameraLerp, dt);
      this.y = damp(this.y, ty, feel.cameraLerp, dt);
    } else {
      this.x = damp(this.x, this.x + this.lookX, feel.cameraLerp * 0.5, dt);
      this.y = damp(this.y, this.y + this.lookY, feel.cameraLerp * 0.5, dt);
    }

    // punch-out
    let punch = 0;
    if (this._punchT > 0) {
      this._punchT -= dt;
      const t = clamp(1 - this._punchT / this._punchDur, 0, 1);
      // Out fast, back slow.
      punch = this._punchAmt * (t < 0.3 ? easeOutCubic(t / 0.3) : 1 - easeOutCubic((t - 0.3) / 0.7));
      if (this._punchT <= 0) this._punchAmt = 0;
    }
    this.zoom = damp(this.zoom, this.targetZoom, 0.08, dt) * (1 + punch);

    if (this.clampToBounds) this._clamp();
  }

  _clamp() {
    const hw = this.vw / (2 * this.baseZoom * this.zoom);
    const hh = this.vh / (2 * this.baseZoom * this.zoom);
    const b = this.bounds;
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    if (w > hw * 2) this.x = clamp(this.x, b.minX + hw, b.maxX - hw);
    else this.x = (b.minX + b.maxX) / 2;
    if (h > hh * 2) this.y = clamp(this.y, b.minY + hh, b.maxY - hh);
    else this.y = (b.minY + b.maxY) / 2;
  }

  /** Interpolated centre for rendering. `alpha` is the accumulator remainder. */
  renderX(alpha) { return lerp(this.px, this.x, alpha) + this.shakeX; }
  renderY(alpha) { return lerp(this.py, this.y, alpha) + this.shakeY; }

  get scale() { return this.baseZoom * this.zoom; }

  /** World -> screen. Only used by UI code, never per entity. */
  toScreen(wx, wy, alpha, out) {
    const s = this.scale;
    out.x = (wx - this.renderX(alpha)) * s + this.vw / 2;
    out.y = (wy - this.renderY(alpha)) * s + this.vh / 2;
    return out;
  }

  /** Screen -> world. Used for mouse aim. */
  toWorld(sx, sy, alpha, out) {
    const s = this.scale;
    out.x = (sx - this.vw / 2) / s + this.renderX(alpha);
    out.y = (sy - this.vh / 2) / s + this.renderY(alpha);
    return out;
  }

  /** Half-extents of the visible world, plus a margin. For culling. */
  viewHalfW(margin = 0) { return this.vw / (2 * this.scale) + margin; }
  viewHalfH(margin = 0) { return this.vh / (2 * this.scale) + margin; }
}

export const camera = new Camera();
