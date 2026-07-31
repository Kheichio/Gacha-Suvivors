// Static blockers + steering avoidance. DECISIONS.md §18.
//
// Two of seven stages needed geometry the spec never acknowledged: Stage 3's
// collapsing walls "block enemy pathing", Stage 5's corridors "form". There is no
// tilemap, no nav mesh and no A* anywhere in the architecture, and `chaser` is
// defined as "moves directly at the player".
//
// This is deliberately NOT pathfinding. Enemies raycast one body-length ahead and
// add a lateral push; the player is hard-blocked. A chaser in a dead-end pocket
// will hug the wall rather than route around it — which is acceptable, readable,
// and costs 120 lines instead of a navigation subsystem.
//
// ALL SEVEN STAGES NOW SCATTER SOMETHING. `stage.obstacles` had existed since the
// data layer was written and nothing had ever read it, so five stages were flat
// empty floors and the other two only had geometry because a hazard happened to
// drop some. scatter() below is what makes that field mean something, and the
// steering approximation above is exactly why it stays SPARSE.

import { feel } from '../core/feel.js';
import { clamp, dist2, normalize, V } from '../core/math.js';
import { particles } from '../render/particles.js';
import { atlas } from '../render/spriteAtlas.js';
import { runRng } from '../core/rng.js';

const MAX_OBSTACLES = 128;

/**
 * The look a field falls back to when nobody has given it one — the engine's
 * own grey hex chunk. Written out as a literal that MATCHES the entry in
 * prewarm.js ENGINE_VISUALS exactly, because the atlas keys on every field
 * including `flash`, and a descriptor that differs by one character is a second
 * sprite rasterised on the frame the first blocker appears.
 */
const DEFAULT_STYLE = {
  name: 'Debris',
  detail: 'none',
  visual: { shape: 'hex', color: '#4a4f63', accent: '#0b0d16', size: 32 },
  box: { color: '#4a4f63', edge: '#0b0d16' },
};

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
    this.style = DEFAULT_STYLE;
    this.color = DEFAULT_STYLE.box.color;
    this.edge = DEFAULT_STYLE.box.edge;
    this.detail = 'none';
  }

  /**
   * Give the field a per-stage LOOK, from an OBSTACLE_SETS entry.
   *
   * Every stage's blockers used to draw as the same grey hexagon tinted to the
   * stage's grid colour, so rubble, desks, coral and a fallen light truss were
   * one silhouette in seven shades. A set brings its own sprite, its own box
   * fill/edge pair, and a `detail` pass drawn on top of rectangles.
   *
   * A null set is legal and means DEFAULT_STYLE — the hazard-dropped rubble on a
   * stage that declares no set of its own still has to look like something.
   *
   * @param set an OBSTACLE_SETS entry, or null
   */
  setStyle(set) {
    this.style = (set && set.visual) ? set : DEFAULT_STYLE;
    const box = (set && set.box) || DEFAULT_STYLE.box;
    this.color = box.color;
    this.edge = box.edge || '#0b0d16';
    this.detail = (set && set.detail) || 'none';
    this.sprite = null;
  }

  /**
   * SCATTER THE STAGE'S OWN BLOCKERS, once, at run start.
   *
   * The brief for this was precise — "things here and there", not a maze — so
   * the tuning is deliberately sparse: ~20 pieces across 4000x4000 is one every
   * 800px on a side. You meet one every few seconds of running and you are never
   * asked to navigate a corridor, which matters because DECISIONS.md §18 gave
   * the horde STEERING and not pathfinding: a chaser in a dead-end pocket hugs
   * the wall instead of routing around it, and a dense layout would turn that
   * acceptable approximation into the whole experience.
   *
   * `clearance` is held empty around BOTH the player's start and the altar. They
   * are the two positions in the arena a player is guaranteed to stand in, and a
   * blocker on either is the difference between "the map has furniture" and "the
   * game spawned me inside a wall".
   *
   * Rejection sampling with a hard attempt cap rather than a lattice: a lattice
   * reads as a grid the moment you have seen it twice, and the cap means a set
   * that asks for more pieces than will fit quietly places fewer instead of
   * spinning.
   */
  scatter(set) {
    if (!set || !set.count || !set.forms || !set.forms.length) return 0;
    const run = this.run;
    const b = run.bounds;
    const margin = 140;
    const clear2 = (set.clearance || 400) * (set.clearance || 400);
    const spacing2 = (set.spacing || 200) * (set.spacing || 200);
    const px = run.player.x, py = run.player.y;
    // The altar is placed before this runs; guard anyway so an ordering change
    // downgrades to "one fewer keep-out zone" rather than a crash.
    const ax = run.altar ? run.altar.x : px;
    const ay = run.altar ? run.altar.y : py;

    // Weights are read into a module-level scratch array rather than mapped into
    // a fresh one. Not a hot path, but the discipline is the point: a `.map()`
    // here is the one that gets copy-pasted into a hot path later.
    WEIGHTS.length = 0;
    for (const f of set.forms) WEIGHTS.push(f.weight || 1);

    let placed = 0;
    const want = Math.min(set.count, MAX_OBSTACLES - this.count);
    for (let attempt = 0; attempt < want * 12 && placed < want; attempt++) {
      const x = runRng.range(b.minX + margin, b.maxX - margin);
      const y = runRng.range(b.minY + margin, b.maxY - margin);
      if (dist2(x, y, px, py) < clear2) continue;
      if (dist2(x, y, ax, ay) < clear2) continue;
      let crowded = false;
      for (let i = 0; i < this.count; i++) {
        if (dist2(x, y, this.x[i], this.y[i]) < spacing2) { crowded = true; break; }
      }
      if (crowded) continue;

      const fi = runRng.weightedIndex(WEIGHTS);
      const form = set.forms[fi < 0 ? 0 : fi];
      const idx = form.form === 'box'
        ? this.addBox(x, y, runRng.range(form.w[0], form.w[1]), runRng.range(form.h[0], form.h[1]))
        : this.addCircle(x, y, runRng.range(form.r[0], form.r[1]));
      if (idx < 0) break;
      // Scattered geometry has always been there; it must not fade in.
      this.fade[idx] = 1;
      placed++;
    }
    return placed;
  }

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
          // The VISUAL's colour, not the box fill. Particle sprites are
          // pre-rastered from the colours the atlas already knows about, and
          // the box fill is a raw hex on a data table that the harvest in
          // prewarm.js never sees — bursting it would rasterise a particle
          // sheet on the frame a piece of rubble crumbles.
          particles.burst(this.x[i], this.y[i], 8, this.style.visual.color, { speed: 120, life: 0.5, size: 0.7 });
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
   * IS A CIRCLE AT (x, y, radius) INSIDE ANYTHING?
   *
   * The broad reject is the whole method. `this.r[i]` is a valid bounding radius
   * for BOTH forms â€” the circle's own radius, and `hypot(hw, hh)` for a box, set
   * in addBox â€” so one squared-distance compare rules a piece out without ever
   * entering _penetration. For a point in open ground on a full field that is 128
   * multiplies and no branch taken, which is what makes it affordable on the drop
   * path.
   */
  overlaps(x, y, radius) {
    for (let i = 0; i < this.count; i++) {
      const dx = x - this.x[i], dy = y - this.y[i];
      const reach = this.r[i] + radius;
      if (dx * dx + dy * dy > reach * reach) continue;
      if (this._penetration(i, x, y, radius, PUSH) > 0) return true;
    }
    return false;
  }

  /**
   * PUSH A POINT OUT OF THE GEOMETRY, TO THE NEAREST FREE SPOT.
   *
   * NOTHING MAY REST ON A WALL. Everything the game drops is spawned at the
   * position of whatever produced it â€” an enemy that died, an event marker, a
   * boss that fell over â€” and not one of those is obliged to have been standing
   * somewhere the player can reach. enemy.js only steers what is ON SCREEN, and
   * even that is a soft lateral push rather than a block, so a mob killed by an
   * off-screen orbital dies inside a wall as often as not.
   *
   * For an XP gem that was merely ugly: the magnet drags it out through the wall.
   * For everything else it was a LOST DROP. A chest, a relic, a weapon crate and
   * a heart are all collected by TOUCHING them, and the player is hard-resolved
   * out of static geometry at `radius + 6` â€” so a chest at the centre of even a
   * small scattered box sits ~37px from the closest the player can stand and
   * needs to be inside 35. It could be seen and it could never be taken.
   *
   * Three tiers, cheapest first, because this runs on EVERY drop:
   *
   *   1. One broad-phase pass. Nothing overlaps -> return false, nothing written.
   *      This is the answer for the overwhelming majority of drops.
   *   2. Relaxation. _penetration already exits a box along its SHALLOWER axis
   *      and a circle along its radius, which is the shortest way out and stays
   *      correct at any depth â€” so "deep inside a large wall" is handled by a
   *      single push, not by iteration. The passes exist for the other case:
   *      leaving one piece can enter its neighbour, and hazard-dropped rubble
   *      does pile up.
   *   3. A ring search around the ORIGINAL point, for a pocket walled in on every
   *      side. Fixed directions from a table â€” no RNG, no wall clock, no trig â€”
   *      so a replayed seed puts the drop in exactly the same place.
   *
   * @param x,y     where the drop wanted to land
   * @param radius  clearance to hold off the surface (the drop's own radius)
   * @param out     {x, y} scratch, written with the corrected position
   * @returns true if it had to move, in which case `out` holds the new position
   */
  pushOut(x, y, radius, out) {
    out.x = x; out.y = y;
    if (this.count === 0) return false;
    if (!this.overlaps(x, y, radius)) return false;

    // Tier 2 â€” relax. The extra 0.5px per push is slop: landing EXACTLY on the
    // surface leaves the next compare at the mercy of float error.
    let px = x, py = y;
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (let i = 0; i < this.count; i++) {
        const dx = px - this.x[i], dy = py - this.y[i];
        const reach = this.r[i] + radius;
        if (dx * dx + dy * dy > reach * reach) continue;
        const pen = this._penetration(i, px, py, radius, PUSH);
        if (pen > 0) {
          px += PUSH.x * (pen + 0.5);
          py += PUSH.y * (pen + 0.5);
          moved = true;
        }
      }
      if (!moved) { out.x = px; out.y = py; return true; }
    }

    // Tier 3 â€” boxed in. Walk a ring outward from where it wanted to be, so the
    // drop still lands as close as possible to the kill that paid for it.
    for (let step = 1; step <= RING_STEPS; step++) {
      const rad = radius + step * RING_GAP;
      for (let k = 0; k < RING.length; k += 2) {
        const cx = x + RING[k] * rad, cy = y + RING[k + 1] * rad;
        if (!this.overlaps(cx, cy, radius)) { out.x = cx; out.y = cy; return true; }
      }
    }
    // Nothing free inside RING_STEPS * RING_GAP. Keep the RELAXED position: one
    // wall out beats dead centre even when it is not clear of everything.
    out.x = px; out.y = py;
    return true;
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

  /**
   * CULLED, and styled per stage.
   *
   * The cull is not an optimisation flourish: every stage now scatters ~20
   * permanent blockers and the collapsing-walls hazard adds more on top, and
   * `drawRect` on a box 3,000px behind the camera still pays for a fillRect and
   * a stroke. drawSprite culls itself; primitives do not.
   *
   * `detail` is the whole reason a desk and a fallen truss no longer look alike:
   * the box itself is a rectangle either way, and the two or three lines drawn
   * inside it are what say "drawers", "shutter", "bracing" or "crate".
   */
  draw(r, alpha) {
    if (this.count === 0) return;
    if (!this.sprite) this.sprite = atlas.ensure(this.style.visual);
    const detail = this.detail;
    for (let i = 0; i < this.count; i++) {
      const x = this.x[i], y = this.y[i];
      if (x + this.r[i] < r.cullMinX || x - this.r[i] > r.cullMaxX ||
          y + this.r[i] < r.cullMinY || y - this.r[i] > r.cullMaxY) continue;
      const f = this.fade[i];
      const dying = this.life[i] > 0 && this.life[i] < 1 ? this.life[i] : 1;
      const a = f * dying;
      if (this.isBox[i]) {
        const hw = this.hw[i], hh = this.hh[i];
        r.drawRect(x - hw, y - hh, hw * 2, hh * 2, this.color, a);
        r.strokeRect(x - hw, y - hh, hw * 2, hh * 2, this.edge, 3, a);
        if (detail !== 'none') this._detail(r, x, y, hw, hh, a);
      } else {
        const s = (this.r[i] / 32) * f;
        r.drawSprite(this.sprite, x, y, 0, s, dying, false, 0);
        // A hard rim under the sprite. The sprite's own outline is 14% of its
        // radius, which reads at 32px and disappears at 58 — and a blocker whose
        // edge you cannot find is a blocker you keep walking into.
        r.strokeCircle(x, y, this.r[i], this.edge, 2, a * 0.7);
      }
    }
    r.setAlpha(1);
  }

  /** The two-or-three-line pass that gives a rectangle a material. */
  _detail(r, x, y, hw, hh, a) {
    const c = this.edge;
    const al = a * 0.55;
    switch (this.detail) {
      case 'slats': {
        // Drawer fronts / vent fins: horizontal rules down the face.
        const n = Math.min(3, Math.max(1, (hh / 12) | 0));
        for (let k = 1; k <= n; k++) {
          const yy = y - hh + (hh * 2) * (k / (n + 1));
          r.drawLine(x - hw + 4, yy, x + hw - 4, yy, c, 2, al);
        }
        break;
      }
      case 'lattice':
        // A shutter or a paper screen: one cross, always centred.
        r.drawLine(x, y - hh + 3, x, y + hh - 3, c, 2, al);
        r.drawLine(x - hw + 3, y, x + hw - 3, y, c, 2, al);
        break;
      case 'ribs':
        // Structural bracing: the diagonals of the box.
        r.drawLine(x - hw + 4, y - hh + 4, x + hw - 4, y + hh - 4, c, 2, al);
        r.drawLine(x + hw - 4, y - hh + 4, x - hw + 4, y + hh - 4, c, 2, al);
        break;
      case 'bolts':
        // Crate corners. Four dots is cheaper than a border and reads as wood.
        r.drawCircle(x - hw + 6, y - hh + 6, 2.5, c, al);
        r.drawCircle(x + hw - 6, y - hh + 6, 2.5, c, al);
        r.drawCircle(x - hw + 6, y + hh - 6, 2.5, c, al);
        r.drawCircle(x + hw - 6, y + hh - 6, 2.5, c, al);
        break;
    }
  }
}

const PUSH = { x: 0, y: 0 };

/** Scratch for the weighted form roll in scatter(). Never read across calls. */
const WEIGHTS = [];

/**
 * The eight directions pushOut's ring fallback tries, as unit vectors.
 *
 * A table rather than Math.cos/Math.sin in the loop. This is SIM code and the
 * run has to replay identically from a seed, so the constants are written out
 * rather than computed; the path is rare enough that 128 bytes of literal is
 * free either way.
 */
const RING = [
  1, 0,
  0.7071067811865476, 0.7071067811865476,
  0, 1,
  -0.7071067811865476, 0.7071067811865476,
  -1, 0,
  -0.7071067811865476, -0.7071067811865476,
  0, -1,
  0.7071067811865476, -0.7071067811865476,
];
/**
 * Eight rings 44px apart reaches 352px from the original point. The widest thing
 * on any stage is the shifting-rooms slab at 220 half-extents, and its SHORT axis
 * is 26 â€” the first ring already clears it, because escaping a long wall never
 * means walking its length.
 */
const RING_STEPS = 8;
const RING_GAP = 44;
