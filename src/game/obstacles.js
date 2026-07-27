// Static blockers + steering avoidance. DECISIONS.md §18.
//
// Two of seven stages need geometry the spec never acknowledged: Stage 3's
// collapsing walls "block enemy pathing", Stage 5's corridors "form". There is no
// tilemap, no nav mesh and no A* anywhere in the architecture, and `chaser` is
// defined as "moves directly at the player".
//
// This is deliberately NOT pathfinding. Enemies raycast one body-length ahead and
// add a lateral push; the player is hard-blocked. A chaser in a dead-end pocket
// will hug the wall rather than route around it — which is acceptable, readable,
// and costs 120 lines instead of a navigation subsystem.

import { feel } from '../core/feel.js';
import { clamp, dist2, normalize, V } from '../core/math.js';
import { particles } from '../render/particles.js';
import { atlas } from '../render/spriteAtlas.js';
import { runRng } from '../core/rng.js';

const MAX_OBSTACLES = 128;

export class ObstacleField {
  constructor(run) {
    this.run = run;
    this.count = 0;
    this.x = new Float32Array(MAX_OBSTACLES);
    this.y = new Float32Array(MAX_OBSTACLES);
    this.r = new Float32Array(MAX_OBSTACLES);
    this.hw = new Float32Array(MAX_OBSTACLES);   // half-width for boxes
    this.hh = new Float32Array(MAX_OBSTACLES);
    this.isBox = new Uint8Array(MAX_OBSTACLES);
    this.life = new Float32Array(MAX_OBSTACLES); // 0 = permanent
    this.fade = new Float32Array(MAX_OBSTACLES);
    this.sprite = null;
    this.color = '#4a4f63';
  }

  setStyle(color) { this.color = color; this.sprite = null; }

  addCircle(x, y, r, life) {
    if (this.count >= MAX_OBSTACLES) return -1;
    const i = this.count++;
    this.x[i] = x; this.y[i] = y; this.r[i] = r;
    this.isBox[i] = 0; this.life[i] = life || 0; this.fade[i] = 0;
    return i;
  }

  addBox(x, y, hw, hh, life) {
    if (this.count >= MAX_OBSTACLES) return -1;
    const i = this.count++;
    this.x[i] = x; this.y[i] = y;
    this.hw[i] = hw; this.hh[i] = hh;
    this.r[i] = Math.hypot(hw, hh);
    this.isBox[i] = 1; this.life[i] = life || 0; this.fade[i] = 0;
    return i;
  }

  clear() { this.count = 0; }

  removeAt(i) {
    const last = --this.count;
    if (i !== last) {
      this.x[i] = this.x[last]; this.y[i] = this.y[last]; this.r[i] = this.r[last];
      this.hw[i] = this.hw[last]; this.hh[i] = this.hh[last];
      this.isBox[i] = this.isBox[last]; this.life[i] = this.life[last];
      this.fade[i] = this.fade[last];
    }
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      if (this.fade[i] < 1) this.fade[i] = Math.min(1, this.fade[i] + dt * 3);
      if (this.life[i] > 0) {
        this.life[i] -= dt;
        if (this.life[i] <= 0) {
          particles.burst(this.x[i], this.y[i], 8, this.color, { speed: 120, life: 0.5, size: 0.7 });
          this.removeAt(i);
          i--;
        }
      }
    }
  }

  /** Signed penetration depth of a circle at (x, y, radius) into obstacle i. */
  _penetration(i, x, y, radius, out) {
    if (this.isBox[i]) {
      const dx = x - this.x[i], dy = y - this.y[i];
      const px = Math.abs(dx) - this.hw[i] - radius;
      const py = Math.abs(dy) - this.hh[i] - radius;
      if (px > 0 || py > 0) return 0;
      // Push out along the shallower axis.
      if (px > py) { out.x = Math.sign(dx) || 1; out.y = 0; return -px; }
      out.x = 0; out.y = Math.sign(dy) || 1;
      return -py;
    }
    const dx = x - this.x[i], dy = y - this.y[i];
    const d = Math.hypot(dx, dy);
    const pen = this.r[i] + radius - d;
    if (pen <= 0) return 0;
    if (d < 0.001) { out.x = 1; out.y = 0; return pen; }
    out.x = dx / d; out.y = dy / d;
    return pen;
  }

  /**
   * Hard-resolve a circle out of every obstacle it overlaps. Used for the player,
   * who genuinely cannot walk through a wall.
   * @returns true if it moved
   */
  resolve(ent, radius) {
    let moved = false;
    for (let i = 0; i < this.count; i++) {
      const pen = this._penetration(i, ent.x, ent.y, radius, PUSH);
      if (pen > 0) {
        ent.x += PUSH.x * pen;
        ent.y += PUSH.y * pen;
        moved = true;
      }
    }
    return moved;
  }

  /**
   * Soft steering for enemies: look one body-length ahead, and if that point is
   * inside an obstacle, add a lateral push. Cheap, allocation-free, and it reads
   * as "the horde flows around the rubble".
   */
  steer(e, dt) {
    if (this.count === 0) return;
    const speed = Math.hypot(e.vx, e.vy);
    if (speed < 1) {
      // Standing still inside geometry: just push out.
      for (let i = 0; i < this.count; i++) {
        const pen = this._penetration(i, e.x, e.y, e.radius, PUSH);
        if (pen > 0) { e.x += PUSH.x * pen; e.y += PUSH.y * pen; }
      }
      return;
    }
    const nx = e.vx / speed, ny = e.vy / speed;
    const look = feel.avoidanceLookahead + e.radius;
    const ax = e.x + nx * look, ay = e.y + ny * look;

    for (let i = 0; i < this.count; i++) {
      // Broad reject first — most obstacles are nowhere near.
      const dx = this.x[i] - e.x, dy = this.y[i] - e.y;
      const reach = this.r[i] + look + e.radius;
      if (dx * dx + dy * dy > reach * reach) continue;

      const pen = this._penetration(i, ax, ay, e.radius, PUSH);
      if (pen <= 0) continue;
      // Steer perpendicular to the obstacle normal, choosing the side that keeps
      // the enemy moving forward rather than reversing into the horde.
      const px = -PUSH.y, py = PUSH.x;
      const sideSign = (px * nx + py * ny) >= 0 ? 1 : -1;
      const f = feel.avoidanceForce * dt;
      e.x += px * sideSign * f + PUSH.x * f * 0.5;
      e.y += py * sideSign * f + PUSH.y * f * 0.5;

      // Then hard-resolve so nothing ends the tick inside a wall.
      const hard = this._penetration(i, e.x, e.y, e.radius * 0.8, PUSH);
      if (hard > 0) { e.x += PUSH.x * hard; e.y += PUSH.y * hard; }
    }
  }

  /** Does the segment (x0,y0)->(x1,y1) hit anything? Used for line-of-sight. */
  blocksLine(x0, y0, x1, y1) {
    if (this.count === 0) return false;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = 0; i < this.count; i++) {
      const ex = this.x[i] - x0, ey = this.y[i] - y0;
      let t = (ex * dx + ey * dy) / (len * len);
      t = clamp(t, 0, 1);
      const cx = x0 + dx * t, cy = y0 + dy * t;
      const ddx = this.x[i] - cx, ddy = this.y[i] - cy;
      const rr = this.isBox[i] ? Math.max(this.hw[i], this.hh[i]) : this.r[i];
      if (ddx * ddx + ddy * ddy < rr * rr) return true;
    }
    return false;
  }

  draw(r, alpha) {
    if (this.count === 0) return;
    if (!this.sprite) {
      this.sprite = atlas.register({ shape: 'hex', color: this.color, accent: '#0b0d16', size: 32 });
    }
    for (let i = 0; i < this.count; i++) {
      const f = this.fade[i];
      const dying = this.life[i] > 0 && this.life[i] < 1 ? this.life[i] : 1;
      if (this.isBox[i]) {
        r.drawRect(this.x[i] - this.hw[i], this.y[i] - this.hh[i],
                   this.hw[i] * 2, this.hh[i] * 2, this.color, f * dying);
        r.strokeRect(this.x[i] - this.hw[i], this.y[i] - this.hh[i],
                     this.hw[i] * 2, this.hh[i] * 2, '#0b0d16', 3, f * dying);
      } else {
        const s = (this.r[i] / 32) * f;
        r.drawSprite(this.sprite, this.x[i], this.y[i], 0, s, dying, false, 0);
      }
    }
    r.setAlpha(1);
  }
}

const PUSH = { x: 0, y: 0 };
