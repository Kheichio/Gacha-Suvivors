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
    /**
     * THE LONGEST HALF-EXTENT — how far along this piece an escape may cost.
     *
     * Kept as its own array rather than recomputed as `max(hw, hh)` in the
     * steering loop because that loop runs for every enemy against every piece
     * every tick, and this is pure geometry: it can only change when a piece is
     * added or removed. Do NOT fold a `feel` constant into it — those move under
     * the F4 sliders and a cached copy would go stale until the next stage load.
     */
    this.ext = new Float32Array(MAX_OBSTACLES);
    this.isBox = new Uint8Array(MAX_OBSTACLES);
    this.life = new Float32Array(MAX_OBSTACLES); // 0 = permanent
    this.fade = new Float32Array(MAX_OBSTACLES);
    /**
     * WHICH LOOK EACH PIECE WEARS. Index into `this.kinds`; 0 is the set's own.
     *
     * The look used to be four scalars on the FIELD — one sprite, one box fill,
     * one edge, one detail — so every blocker on a stage was the same object in
     * the same colour. That is right for "rubble" and wrong the moment a stage
     * wants furniture: a courtyard has benches AND hedges AND a fountain, and
     * with a per-field look the only way to say that is to pick one and lie
     * about the other two. One byte per piece buys the whole vocabulary.
     */
    this.kind = new Uint8Array(MAX_OBSTACLES);
    this.kinds = [DEFAULT_STYLE];
    this.sprites = [null];
    this.style = DEFAULT_STYLE;
    /**
     * THE DEEPEST A BODY CAN BE BURIED IN ANYTHING ON THIS FIELD — the largest
     * SHORT half-extent, over every piece.
     *
     * Not a drawing or a collision number: it is what enemy.js asks to decide
     * whether an OFF-SCREEN enemy still needs steering. Off-screen AI is
     * deliberately cheapened to movement only (SECTION 1) and that is right for
     * a 60px chunk of rubble — a mob cannot bury itself in one far enough to
     * matter, and the drop it makes when it comes back into view is a few
     * pixels. It stops being right when a piece is deeper than the off-screen
     * band is tall: Akihabara's blocks are 1000px square against a 480px
     * half-view, so a mob crosses one entirely out of sight and then, on the
     * frame it enters the view, is depenetrated 516px sideways in a single tick.
     */
    this.deepest = 0;
  }

  /** The look for piece `i`, always defined — an unknown index falls back. */
  _kind(i) { return this.kinds[this.kind[i]] || this.kinds[0] || DEFAULT_STYLE; }

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
    // Kind 0 is the set itself, so every existing stage — which names no kinds
    // at all — keeps drawing exactly what it drew before, and `scatter` can go
    // on placing pieces without saying which look they wear.
    this.kinds = [this.style];
    if (set && set.kinds) for (const k of set.kinds) this.kinds.push(k);
    this.sprites = new Array(this.kinds.length).fill(null);
  }

  /** Index of a named kind from the set, or 0 (the set's own look). */
  kindIndex(name) {
    if (!name) return 0;
    for (let i = 1; i < this.kinds.length; i++) if (this.kinds[i].id === name) return i;
    return 0;
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

  addCircle(x, y, r, life, kind) {
    if (this.count >= MAX_OBSTACLES) return -1;
    const i = this.count++;
    this.x[i] = x; this.y[i] = y; this.r[i] = r;
    this.ext[i] = r;
    if (r > this.deepest) this.deepest = r;
    this.isBox[i] = 0; this.life[i] = life || 0; this.fade[i] = 0;
    this.kind[i] = kind || 0;
    return i;
  }

  addBox(x, y, hw, hh, life, kind) {
    if (this.count >= MAX_OBSTACLES) return -1;
    const i = this.count++;
    this.x[i] = x; this.y[i] = y;
    this.hw[i] = hw; this.hh[i] = hh;
    this.r[i] = Math.hypot(hw, hh);
    this.ext[i] = hw > hh ? hw : hh;
    // The SHORT axis, deliberately: a 1800x200 courtyard wall can only ever
    // bury a body 100px deep, however long it is.
    const short = hw < hh ? hw : hh;
    if (short > this.deepest) this.deepest = short;
    this.isBox[i] = 1; this.life[i] = life || 0; this.fade[i] = 0;
    this.kind[i] = kind || 0;
    return i;
  }

  /**
   * PLACE A SET'S AUTHORED PIECES, at absolute world positions.
   *
   * `scatter` is rejection sampling — right for "things here and there", and no
   * use at all for a stage that is supposed to be a PLACE. A courtyard has a
   * fountain in the middle of it, not a fountain somewhere; the gate is at the
   * bottom because that is where you come in. Rolled positions cannot say any of
   * that, so a set may also carry a `layout` array of literal pieces, and the
   * two compose: authored first, then scatter fills the leftover ground around
   * them (its own `spacing` check then keeps the litter off the furniture).
   *
   * Coordinates are FRACTIONS of the arena, not pixels. The arena is 4000x4000
   * today and that is a tuning constant in core/config.js, not a promise — a
   * layout written in pixels would silently re-centre itself the day it changes.
   */
  place(set) {
    if (!set || !set.layout || !set.layout.length) return 0;
    const b = this.run.bounds;
    const W = b.maxX - b.minX, H = b.maxY - b.minY;
    let placed = 0;
    for (const p of set.layout) {
      const x = b.minX + W * p.x, y = b.minY + H * p.y;
      const k = this.kindIndex(p.kind);
      const idx = p.w !== undefined
        ? this.addBox(x, y, p.w * W * 0.5, p.h * H * 0.5, 0, k)
        : this.addCircle(x, y, p.r * W, 0, k);
      if (idx < 0) break;
      this.fade[idx] = 1;             // authored geometry has always been there
      placed++;
    }
    return placed;
  }

  clear() { this.count = 0; this.deepest = 0; }

  /** Rebuild `deepest` after a removal. O(count) and only on the rare path. */
  _remeasure() {
    let d = 0;
    for (let i = 0; i < this.count; i++) {
      const short = this.isBox[i]
        ? (this.hw[i] < this.hh[i] ? this.hw[i] : this.hh[i])
        : this.r[i];
      if (short > d) d = short;
    }
    this.deepest = d;
  }

  removeAt(i) {
    const last = --this.count;
    if (i !== last) {
      this.x[i] = this.x[last]; this.y[i] = this.y[last]; this.r[i] = this.r[last];
      this.hw[i] = this.hw[last]; this.hh[i] = this.hh[last];
      this.ext[i] = this.ext[last];
      this.isBox[i] = this.isBox[last]; this.life[i] = this.life[last];
      this.fade[i] = this.fade[last];
      // Swap-and-pop compaction. Forget this line and a surviving piece
      // silently inherits the dead one's appearance.
      this.kind[i] = this.kind[last];
    }
    this._remeasure();
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
          const k = this._kind(i);
          particles.burst(this.x[i], this.y[i], 8,
                          (k.visual || DEFAULT_STYLE.visual).color,
                          { speed: 120, life: 0.5, size: 0.7 });
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
   * for BOTH forms — the circle's own radius, and `hypot(hw, hh)` for a box, set
   * in addBox — so one squared-distance compare rules a piece out without ever
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
   * position of whatever produced it — an enemy that died, an event marker, a
   * boss that fell over — and not one of those is obliged to have been standing
   * somewhere the player can reach. enemy.js only steers what is ON SCREEN, and
   * even that is a soft lateral push rather than a block, so a mob killed by an
   * off-screen orbital dies inside a wall as often as not.
   *
   * For an XP gem that was merely ugly: the magnet drags it out through the wall.
   * For everything else it was a LOST DROP. A chest, a relic, a weapon crate and
   * a heart are all collected by TOUCHING them, and the player is hard-resolved
   * out of static geometry at `radius + 6` — so a chest at the centre of even a
   * small scattered box sits ~37px from the closest the player can stand and
   * needs to be inside 35. It could be seen and it could never be taken.
   *
   * Three tiers, cheapest first, because this runs on EVERY drop:
   *
   *   1. One broad-phase pass. Nothing overlaps -> return false, nothing written.
   *      This is the answer for the overwhelming majority of drops.
   *   2. Relaxation. _penetration already exits a box along its SHALLOWER axis
   *      and a circle along its radius, which is the shortest way out and stays
   *      correct at any depth — so "deep inside a large wall" is handled by a
   *      single push, not by iteration. The passes exist for the other case:
   *      leaving one piece can enter its neighbour, and hazard-dropped rubble
   *      does pile up.
   *   3. A ring search around the ORIGINAL point, for a pocket walled in on every
   *      side. Fixed directions from a table — no RNG, no wall clock, no trig —
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

    // Tier 2 — relax. The extra 0.5px per push is slop: landing EXACTLY on the
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

    // Tier 3 — boxed in. Walk a ring outward from where it wanted to be, so the
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
   * SOFT STEERING FOR ENEMIES — still not pathfinding, but it ROUTES.
   *
   * This used to look one flat body-length ahead and add a lateral push, which
   * is exactly right for a 60px chunk of rubble and useless against a 1000px
   * city block: 46px of warning is 6% of one face, and the 500px mid-face-to-
   * corner traverse an escape costs was re-decided from scratch every tick from
   * a dot product that is exactly 0 at a face centre. The horde dithered
   * +/-3.33px a tick, integrated to nothing, and ground along the wall.
   *
   * Three things fix that, none of them a nav mesh (DECISIONS.md §18 still
   * stands — no A*, no graph, no per-stage authoring):
   *
   *   HEADING FROM THE ACTUAL STEP. `e.vx/e.vy` are written by exactly one
   *   function in enemy.js (`_moveToward`) and the swarmer, the charger's dash,
   *   the ranged back-off, the orbiter and every teleport move `e.x/e.y`
   *   directly — so on Akihabara, where swarmers are 76 of the 130 mob-table
   *   weight, most of the crowd read a velocity of (0,0), failed the "am I
   *   moving" test and got no avoidance at all. `e.x - e.px` is the step the
   *   enemy ACTUALLY took this tick (enemy.js stamps px/py at the top of the
   *   tick, and steer runs after the behaviour, the pull and the separation),
   *   so it is true for every archetype. vx/vy remain the fallback for the tick
   *   a teleport re-stamps px/py.
   *
   *   LOOKAHEAD THAT SCALES WITH THE PIECE. See feel.avoidanceSizeScale: a
   *   lamp post is seen from 72px, a city block from 287.
   *
   *   A COMMITTED SIDE. Once a mob picks a way round a piece it KEEPS that
   *   choice until the traverse should be over (feel.avoidanceCommitScale),
   *   which is what turns a stateless nudge into wall-following. `+t` is
   *   perp(outward normal) and therefore circulates the piece the same way on
   *   every face, so the commitment survives the 90-degree normal flip at a
   *   corner — the flip that used to make a mob dither "north around" against
   *   "east around" forever on a perfect square.
   *
   * And the push itself is a SLIDE, not a nudge: the component of the step that
   * drove into the surface is removed, and the tangential component is topped up
   * to the mob's own pace on the committed side. Before, nothing ever cancelled
   * the inward chase, so a mob against a face was a spring held shut.
   *
   * Still O(obstacles) behind the same squared broad reject, still
   * allocation-free, still deterministic — the only tiebreak is `e.uid & 1`,
   * never runRng, so a replayed seed splits the horde the same way.
   */
  steer(e, dt) {
    if (this.count === 0) return;
    if (e.avoidT > 0) e.avoidT -= dt;

    // The step this enemy actually took, then vx/vy for the tick a teleport
    // re-stamped px/py and left the delta at zero.
    let mx = e.x - e.px, my = e.y - e.py;
    let mag = Math.hypot(mx, my);
    const floor = STEER_MIN_SPEED * dt;
    if (mag < floor) {
      const sp = Math.hypot(e.vx, e.vy);
      if (sp > STEER_MIN_SPEED) { mx = e.vx * dt; my = e.vy * dt; mag = sp * dt; }
    }
    if (mag < floor) {
      // Standing still inside geometry: just push out.
      for (let i = 0; i < this.count; i++) {
        const pen = this._penetration(i, e.x, e.y, e.radius, PUSH);
        if (pen > 0) { e.x += PUSH.x * pen; e.y += PUSH.y * pen; }
      }
      return;
    }
    const hx = mx / mag, hy = my / mag;
    const lookBase = e.radius + feel.avoidanceLookahead;
    const sizeScale = feel.avoidanceSizeScale;
    const cap = feel.avoidanceForce * dt;

    for (let i = 0; i < this.count; i++) {
      const look = lookBase + sizeScale * this.ext[i];
      // Broad reject first — most obstacles are nowhere near.
      const dx = this.x[i] - e.x, dy = this.y[i] - e.y;
      const reach = this.r[i] + look + e.radius;
      if (dx * dx + dy * dy > reach * reach) continue;

      const pen = this._penetration(i, e.x + hx * look, e.y + hy * look, e.radius, PUSH);
      if (pen <= 0) continue;

      /**
       * THE NORMAL COMES FROM WHERE THE ENEMY IS, NOT FROM WHERE THE PROBE IS.
       *
       * The probe answers "is my way blocked, and how badly" — that is all it is
       * for. The SURFACE a mob slides along is the one nearest its own body, and
       * on a big box those are not the same face. A mob pinned to the west side
       * of a 1000x1000 block, 300px north of centre, throws its probe 287px
       * along a heading that points south-east: the probe lands deep inside on
       * the diagonal, `_penetration`'s shallower-axis rule calls that a NORTH
       * face, and the tangent comes back east — straight into the wall the mob
       * is already touching. Measured: 0.26px of useless motion a tick against a
       * 1.03px step, i.e. a dead stop 160px short of the corner.
       *
       * Computed here rather than by changing _penetration, which pushOut, the
       * altar, every drop and the player's hard block all depend on.
       */
      const ex = e.x - this.x[i], ey = e.y - this.y[i];
      let nx, ny;
      if (this.isBox[i]) {
        const ox = (ex < 0 ? -ex : ex) - this.hw[i];
        const oy = (ey < 0 ? -ey : ey) - this.hh[i];
        if (ox > oy) { nx = ex < 0 ? -1 : 1; ny = 0; }
        else { nx = 0; ny = ey < 0 ? -1 : 1; }
      } else {
        const d = Math.hypot(ex, ey);
        // Dead centre of a circle: back the way we came, so the mob leaves the
        // way it entered instead of picking a normal out of a divide by zero.
        if (d < 0.001) { nx = -hx; ny = -hy; } else { nx = ex / d; ny = ey / d; }
      }
      const tx = -ny, ty = nx;                // +t circulates the piece one way

      // --- which way round, and hold it ------------------------------------
      // Keyed on WHERE the piece is, not on its slot: removeAt() swap-and-pops,
      // so slot 5 becomes a different obstacle the moment a rubble pile expires
      // and a mob would inherit a commitment made against something else.
      //
      // ONLY A PIECE THE MOB CANNOT SEE PAST gets to own that one slot. There is
      // exactly one commitment per enemy, and a lamp post 2px off a city block's
      // pavement would otherwise overwrite the block's every tick and hand it
      // back thrashed. A piece smaller than the mob's own probe budget does not
      // need the memory anyway: it is gone in a body-length, and the stateless
      // rule below is stable over that distance.
      const key = this.x[i] * KEY_MUL + this.y[i];
      const worthHolding = this.ext[i] > lookBase;
      const mine = worthHolding && e.avoidT > 0 && e.avoidKey === key;
      let side;
      if (mine) {
        side = e.avoidSide;
      } else {
        // NEAREST WAY OUT, not "whichever side the player happens to be on".
        // `off` is how far along the tangent the mob already is from the piece's
        // centre, so its sign points at the closer corner — and it only grows
        // once the mob starts moving, which means re-deciding later agrees with
        // itself instead of reversing. It is identically 0 for a circle (the
        // normal is radial), which is correct: nothing about a lamp post says
        // which way round it, so the heading does.
        const off = ex * tx + ey * ty;
        side = off > 1 ? 1 : off < -1 ? -1 : 0;
        if (side === 0) {
          // Dead square-on. Keep going the way the step already leans, and if
          // that is 0 too, split the horde by parity — two streams round a
          // block read far better than one conga line, and `uid & 1` costs no
          // RNG, which a seeded replay would notice.
          const along = tx * hx + ty * hy;
          side = along > 0.02 ? 1 : along < -0.02 ? -1 : ((e.uid & 1) ? 1 : -1);
        }
        // Claim the slot only if it is free. Whichever big piece got there
        // first keeps it until it stops blocking, which is what makes a mob
        // finish rounding one block before it starts negotiating the next.
        if (worthHolding && e.avoidT <= 0) { e.avoidKey = key; e.avoidSide = side; }
      }
      if (mine || (worthHolding && e.avoidKey === key)) {
        // REFRESHED EVERY BLOCKED TICK, not counted down from the decision. The
        // commitment has to last until the mob CLEARS the piece, and a timer
        // that expires mid-traverse is worse than none at all: `off` is measured
        // from the piece's centre, so a mob halfway along the north face after
        // rounding the north-west corner re-decides "the west corner is nearer"
        // — which is true, and is the corner it just came from. It would turn
        // round and walk back.
        //
        // The window only matters once the mob is CLEAR: it is how long the same
        // side is remembered across the gap between two encounters with the same
        // piece (rounding a corner is exactly that gap), and how long before a
        // mob that has genuinely left is free to choose afresh.
        // How far there is to slide: for a box, the half-extent of the axis the
        // normal is NOT on — and `nx` is exactly 0 or exactly +/-1 for a box, so
        // that test is safe. A circle has no hh at all (the array is never
        // written for one) and its own radius is the answer.
        const tan = this.isBox[i] ? (nx !== 0 ? this.hh[i] : this.hw[i]) : this.r[i];
        e.avoidT = feel.avoidanceCommitScale * (tan + e.radius) /
                   (feel.avoidanceForce + mag / dt);
      }

      // --- slide along the surface -----------------------------------------
      // `ramp` is 0 the instant the probe first clips the piece and 1 when the
      // body is against it, so a mob arcs into the turn instead of snapping
      // sideways the moment a corner enters its 287px probe.
      //
      // CLAMPED, because the ratio only tops out at 1 for a body OUTSIDE the
      // piece. A mob that is already inside one — recycled into a building, or
      // dropped there by a summoner — probes from the middle and reads 516/303,
      // and an over-unity slide would fling it out sideways instead of letting
      // the hard-resolve below walk it out the short way.
      const span = e.radius + look;
      const ramp = pen < span ? pen / span : 1;
      const into = mx * nx + my * ny;
      if (into < 0) { e.x -= nx * into * ramp; e.y -= ny * into * ramp; }
      // Top the tangential motion up to the mob's own pace (capped by
      // avoidanceForce) on the committed side. A TOP-UP and not an addition:
      // a mob already sliding that way keeps its own speed rather than being
      // flung along the wall at twice it.
      const want = side * (mag < cap ? mag : cap) * ramp;
      const add = want - (mx * tx + my * ty);
      if (side > 0 ? add > 0 : add < 0) { e.x += tx * add; e.y += ty * add; }

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
    for (let i = 0; i < this.count; i++) {
      const x = this.x[i], y = this.y[i];
      if (x + this.r[i] < r.cullMinX || x - this.r[i] > r.cullMaxX ||
          y + this.r[i] < r.cullMinY || y - this.r[i] > r.cullMaxY) continue;
      const f = this.fade[i];
      const dying = this.life[i] > 0 && this.life[i] < 1 ? this.life[i] : 1;
      const a = f * dying;
      // The look is resolved PER PIECE now. `_kind` never returns undefined, so
      // a layout naming a kind the set does not declare draws as the set's own
      // rather than throwing halfway through the frame.
      const ki = this.kind[i];
      const k = this._kind(i);
      const box = k.box || DEFAULT_STYLE.box;
      const edge = box.edge || '#0b0d16';
      if (this.isBox[i]) {
        const hw = this.hw[i], hh = this.hh[i];
        // A kind may set `box.color` to null to declare itself PAINTED BY THE
        // FLOOR. Akihabara's city blocks are 1000px square and the backdrop
        // already draws everything on them — shop units, signage, lit windows,
        // alley seams — so filling them here would replace a city block with a
        // flat slab. Those pieces contribute collision and an outline, and the
        // outline is not decoration: it is the only thing telling the player
        // where the building's footprint actually ends.
        if (box.color) r.drawRect(x - hw, y - hh, hw * 2, hh * 2, box.color, a);
        r.strokeRect(x - hw, y - hh, hw * 2, hh * 2, edge, 3, a);
        const detail = k.detail || 'none';
        if (detail !== 'none') this._detail(r, x, y, hw, hh, a, detail, edge);
      } else {
        // Sprites are resolved lazily and cached per kind, not per piece: a
        // courtyard with sixteen hedges must call `ensure` once, not sixteen
        // times a frame.
        let sp = this.sprites[ki];
        if (!sp) sp = this.sprites[ki] = atlas.ensure(k.visual || DEFAULT_STYLE.visual);
        const s = (this.r[i] / 32) * f;
        r.drawSprite(sp, x, y, 0, s, dying, false, 0);
        // A hard rim under the sprite. The sprite's own outline is 14% of its
        // radius, which reads at 32px and disappears at 58 — and a blocker whose
        // edge you cannot find is a blocker you keep walking into.
        r.strokeCircle(x, y, this.r[i], edge, 2, a * 0.7);
      }
    }
    r.setAlpha(1);
  }

  /** The two-or-three-line pass that gives a rectangle a material. */
  _detail(r, x, y, hw, hh, a, detail, c) {
    const al = a * 0.55;
    switch (detail) {
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

/**
 * Under this many px/s an enemy counts as STANDING STILL and is only pushed out
 * of geometry, never steered. 4 rather than 1 because the step steer() reads is
 * the real displacement, which a stationary mob still collects from separation
 * jitter — and a heading derived from jitter is a heading pointing nowhere.
 */
const STEER_MIN_SPEED = 4;

/**
 * Packs a piece's centre into one number, so a committed avoidance can name the
 * obstacle it committed against with a single float on the pooled enemy rather
 * than a slot index (which swap-and-pop reassigns) or a pair of coordinates
 * (which is two more fields on 2,200 preallocated enemies). 9973 is larger than
 * the 4,000px arena on either axis, so no two pieces in a legal layout collide.
 */
const KEY_MUL = 9973;

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
 * is 26 — the first ring already clears it, because escaping a long wall never
 * means walking its length.
 */
const RING_STEPS = 8;
const RING_GAP = 44;
