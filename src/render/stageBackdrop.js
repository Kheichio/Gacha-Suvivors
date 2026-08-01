// The stage's GROUND — the surface the player is standing on, and nothing else.
//
// WHAT THIS REPLACED, AND WHY
// ---------------------------
// The first version of this file was a parallax diorama. A floor, plus a "far"
// layer of silhouettes at k = 0.26, a "mid" layer of near scenery at k = 0.58,
// a drifting mist band, a few pinned pieces at their own rates — a moon, a
// wall, an aurora — and an ambient mote emitter on top of all of it. It was
// built to fix a real problem (seven stages that were the same 128px grid in
// four different hex codes) and it did fix that one. It created a worse one.
//
// Play report: "maps have a lot of random things floating around the screen, it
// feels cluttering, remove it."
//
// That is not a tuning note, it is a geometry note, and it is correct. THIS
// GAME IS TOP-DOWN. A parallax layer's whole claim is "I am further from the
// camera than the floor is". On a side-on view further away means BEHIND, which
// is scenery. Looking straight down it means ABOVE, which is an object in the
// air over the arena — and the low alpha those layers needed in order to stay
// out of the way of the horde is exactly what turned them into ghosts hovering
// over the play space. Something drawn at 0.26x scroll IS a thing hovering over
// the map. There is no alpha, no colour and no density knob that fixes that,
// because the depth is the bug.
//
// So there are no depth layers here any more, no drift, no motes, and nothing
// translucent that is not lying flat on the floor. There is ONE surface, it
// scrolls 1:1 with the world, and it is opaque. Everything that used to be a
// silhouette on the horizon is now something underfoot: the roof is concrete
// bays, drainage channels and court paint; the street is poured asphalt, lane
// markings and puddles holding a sign you never see directly; the ruins are
// hand-laid flagstones with the paving missing in places; the village is packed
// earth crossed by the plank roads it actually uses as roads; the halls are
// tatami and the polished engawa between the rooms; the reef is rippled sand
// over a pitch that is still marked out under the silt; the finale is stage
// boards with the light strips let into them.
//
// HOW IT WORKS
// ------------
// A cell walk over the visible window with a hash per cell. There is no element
// list and no storage of any kind: the ground at (3800, 3800) costs exactly
// what the ground at (0, 0) costs, the pattern for a given cell is identical
// forever — so the floor does not shimmer when the camera moves, which is the
// single most nauseating bug this layer can have — and the entire backdrop is
// reconstructed from three integers.
//
// TWO SCALES OUT OF ONE WALK, and this is the load-bearing trick now that the
// depth layers are gone. A floor made only of per-cell noise reads as wallpaper:
// every part of it is equally average, so 4000px of it is the same 200px of it.
// So each cell hashes TWICE — once for itself, and once for the DISTRICT (a 3x3
// block) it belongs to. The district picks the treatment (this is the swept half
// of the roof; this is where the paving has gone; this room's mats are older),
// the cell picks the grain. And anything that has to run in a straight line for
// longer than one cell — a gutter, a kerb, a boardwalk, a light strip — is keyed
// on ix ALONE or iy ALONE, so it lines up across every cell it crosses for free,
// with no second pass and not one stored element.
//
// The nine colour roles in data/stages.js are still the same nine roles. What
// they describe is a ground now; the BACKDROPS block there says which is which.
//
// EVERYTHING IS A RENDERER PRIMITIVE. No atlas entries, so there is nothing here
// that can rasterise mid-run (tests/renderSmoke.js fails the build over that),
// and no gradients, which are per-frame allocation and the single most expensive
// thing you can put in a Canvas 2D draw loop. NOTHING in the draw path allocates
// and nothing in it moves: the only animation left is a slow brightness pulse on
// the handful of things that are genuinely lit — neon in standing water, a
// caustic, a footlight, a strip in the deck — and `reduceFlashing` flattens it.

import { save } from '../core/save.js';

/** Deterministic 2D integer hash. The ground's entire memory. */
function hash2(ix, iy) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Pick one of three surface tones from a hash byte, weighted so the base tone
 * dominates. An even split between two colours reads as a chessboard, which is
 * a thing no real floor has ever been; the point of the second and third tones
 * is patch repairs, replaced slabs and worn patches, and those are a minority
 * of any surface or they are not repairs.
 */
function tone3(d, a) { return a < 0.70 ? d.tile : (a < 0.92 ? d.mid : d.far); }

/**
 * Per-kind paving grid.
 *
 * `cell` is the paving unit in WORLD px, and it is per kind because the unit has
 * to be the size of the real thing — a tatami mat and a stage board are the same
 * rectangle right up until one of them is the wrong size, and then neither reads
 * as what it is.
 *
 * `joints` draws the cell grid as mortar and insets each slab off it. Surfaces
 * that are POURED rather than laid — asphalt, packed earth, seabed sand — turn
 * it off: a regular grid ruled across them was the old backdrop's most obvious
 * tell that you were looking at a spreadsheet rather than at a place.
 */
const GRID = {
  // 200 makes the arena exactly a 20x20 board, which is what lets the courtyard
  // plan below be written as whole-cell rows and columns instead of fractions.
  courtyard: { cell: 200, joints: false },
  rooftop: { cell: 200, joints: true },
  wet_street: { cell: 220, joints: false },
  ruins: { cell: 210, joints: true },
  village: { cell: 190, joints: false },
  halls: { cell: 200, joints: true },
  reef: { cell: 200, joints: false },
  zenith: { cell: 240, joints: true },
};

export class StageBackdrop {
  /**
   * @param stage    the STAGES entry
   * @param bounds   run.bounds
   * @param backdrops the BACKDROPS table from data/stages.js
   * @param seed     the RUN seed. Deliberately NOT drawn from runRng: the
   *                 backdrop is built by the scene, after Run's constructor has
   *                 already stepped the run stream, and pulling from it here
   *                 would mean the SCENE decided where the altar and the first
   *                 wave landed. A replay must not depend on whether anybody
   *                 was looking.
   */
  constructor(stage, bounds, backdrops, seed) {
    const def = (backdrops && backdrops[stage.backdrop]) || FALLBACK;
    this.stageId = stage.id;
    this.def = def;
    this.kind = def.kind;
    this.pal = stage.palette;
    this.bounds = bounds;

    // THE STAGE'S LITTER COLOUR, which used to be its ambient PARTICLE colour.
    //
    // `ambience.particleColor` fed an emitter that spat a drifting mote across
    // the screen every fourth frame for the whole run, and that emitter was a
    // good third of the "things floating around" report by itself. The colour
    // survives the emitter because the idea was right and only the altitude was
    // wrong: petals, ash, dropped flyers and shredded wards belong ON the floor,
    // at a world position that never moves, where they read as litter somebody
    // has to sweep up rather than as weather.
    this.litter = (stage.ambience && stage.ambience.particleColor) || def.detail;

    // WHY THERE IS NO Rng IN HERE ANY MORE.
    //
    // The old constructor pulled hundreds of numbers from a private seeded
    // stream to scatter its element lists. A hashed cell walk has no lists to
    // scatter, so the only thing the run seed still has to do is move the
    // pattern's origin — two integers, folded into every hash. Same guarantee as
    // before (a replay draws the same floor, two runs of a stage are not
    // pixel-identical) with nothing left that can get out of step, and no
    // renderer anywhere near runRng.
    this.ox = (seed | 0) & 0x3ff;
    this.oy = ((seed | 0) >>> 10) & 0x3ff;

    const g = GRID[def.kind] || GRID.ruins;
    this.cell = g.cell;
    this.joints = g.joints;

    // THE SCATTER THRESHOLDS, resolved once, from `density` in data/stages.js.
    //
    // That knob used to set how many elements the distant layer placed, and its
    // one-line description was "a knob for 'this stage feels cluttered'". There
    // is no distant layer left, but the sentence is still the right sentence —
    // so it now points at the only clutter that remains, which is the loose
    // stuff lying on the floor. A hash byte is compared against these, so a
    // HIGHER density has to produce a LOWER threshold; getting that backwards is
    // invisible until you notice the sparse stage is the busy one.
    const k = def.density === undefined ? 1 : def.density;
    this.sLot = 1 - Math.min(0.95, 0.55 * k);    // ~45% of cells: petals, ash
    this.sSome = 1 - Math.min(0.95, 0.34 * k);   // ~34%: rubble, gravel
    this.sFew = 1 - Math.min(0.95, 0.14 * k);    // ~14%: the one dropped flyer
  }

  // ==========================================================================
  // DRAW
  // ==========================================================================
  /**
   * @param r     the renderer
   * @param run   for sim time — the only thing left that needs it
   * @param cx,cy the interpolated camera centre, in world space
   */
  draw(r, run, cx, cy) {
    const t = run.time;
    // Flashing is REDUCED, not removed: a lit thing that is completely static
    // reads as broken rather than as calm. The pulse depth drops to a fifth.
    const flashK = save.data.settings.reduceFlashing ? 0.2 : 1;

    this._floor(r, cx, cy);
    this._ground(r, cx, cy, t, flashK);
    this._boundary(r, cx, cy, t);
    r.setAlpha(1);
  }

  /**
   * The arena floor, clipped to what is actually on screen.
   *
   * This is the OPAQUE bed everything else is drawn onto, and for the kinds that
   * inset their slabs off a joint grid it is also the mortar showing through.
   * The old version filled all 4000x4000 of it every frame; Canvas clips that
   * itself, so it was not a correctness bug, but it is the one draw in the scene
   * whose size is unrelated to the window. Outside the arena stays the clear
   * colour, which is how the boundary reads as an edge and not as a line painted
   * on a floor that continues.
   */
  _floor(r, cx, cy) {
    const b = this.bounds;
    const x0 = Math.max(b.minX, r.cullMinX), x1 = Math.min(b.maxX, r.cullMaxX);
    const y0 = Math.max(b.minY, r.cullMinY), y1 = Math.min(b.maxY, r.cullMaxY);
    if (x1 <= x0 || y1 <= y0) return;
    r.drawRect(x0, y0, x1 - x0, y1 - y0, this.pal.ground || this.pal.bg, 1);
  }

  /**
   * THE SURFACE.
   *
   * Budgeted at 3-5 primitives per cell, almost all of them fillRect. At a 200px
   * cell and the 1280x720 of world the camera always shows, that is an 8x5 walk
   * — about 40 cells, so 120-200 calls, plus at most fifteen joint lines. It is
   * flat in the entity count by construction: a 2,000-strong horde does not add
   * a single call here.
   *
   * CLIPPED TO THE ARENA, once, for the whole pass. A cell is a fixed size and
   * the arena is not a whole number of them — Stage 7's deck is 240px boards
   * across 4000px — so the last row and column always overhang. One
   * save/clip/restore per frame is cheaper and far more robust than clamping
   * every primitive in seven different vocabularies, and it is what lets the
   * boundary sit on a hard edge.
   *
   * The walk is indexed from the WORLD ORIGIN and only its start and end are
   * clamped to the arena. Clamping the start position instead — which is what
   * this did before — shifts the grid's phase whenever the camera reaches an
   * edge, and a floor whose pattern slides sideways as you approach a wall is a
   * floor that is obviously not a floor.
   */
  _ground(r, cx, cy, t, flashK) {
    const b = this.bounds;
    const cell = this.cell;
    const d = this.def;
    const i0 = Math.floor(Math.max(cx - r.halfW, b.minX) / cell);
    const i1 = Math.floor(Math.min(cx + r.halfW, b.maxX - 1) / cell);
    const j0 = Math.floor(Math.max(cy - r.halfH, b.minY) / cell);
    const j1 = Math.floor(Math.min(cy + r.halfH, b.maxY - 1) / cell);
    if (i1 < i0 || j1 < j0) return;
    r.clipRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);

    // The mortar, as full-span lines rather than per-cell strokes: fifteen calls
    // for the whole screen instead of eighty, and they cannot disagree at a
    // shared edge the way two neighbouring cells drawing their own borders can.
    if (this.joints) {
      const gx0 = i0 * cell, gx1 = (i1 + 1) * cell;
      const gy0 = j0 * cell, gy1 = (j1 + 1) * cell;
      for (let i = i0; i <= i1 + 1; i++) r.drawLine(i * cell, gy0, i * cell, gy1, d.seam, 3, 0.55);
      for (let j = j0; j <= j1 + 1; j++) r.drawLine(gx0, j * cell, gx1, j * cell, d.seam, 3, 0.55);
    }

    const kind = this.kind;
    const ox = this.ox, oy = this.oy;
    for (let j = j0; j <= j1; j++) {
      const y = j * cell;
      for (let i = i0; i <= i1; i++) {
        const x = i * cell;
        const h = hash2(i + ox, j + oy);
        const a = (h & 255) / 255;
        const bq = ((h >>> 8) & 255) / 255;
        const c = ((h >>> 16) & 255) / 255;
        // The district. Same hash, one scale up, offset onto its own patch of
        // the number line so a 3x3 block never agrees with the cell at its
        // corner. This is the whole reason the floor has large shapes on it.
        const dq = (hash2(Math.floor(i / 3) + ox, Math.floor(j / 3) + oy + 977) & 255) / 255;

        switch (kind) {
          // ================================================================
          // STAGE 1 — THE SCHOOL COURTYARD, AS A PLAN.
          //
          // The arena is exactly twenty cells square, so the layout is written
          // in whole rows and columns and lands at the same world coordinates in
          // every run. Reading it as a map, north at the top:
          //
          //     j = 0..1     the MAIN BUILDING, full width, with the doors
          //                  centred on the path
          //     j = 2..17    the courtyard proper
          //       i = 0..1   the WEST BLOCK      i = 18..19  the EAST BLOCK
          //       i = 9..10  the PATH, gate to doors
          //       else       lawn
          //     j = 18..19   the GATE WALL, with the opening on the path
          //
          // The side blocks are TWO cells and not three. Three was the first
          // draft and it reads better on paper: a deeper building, a tighter
          // court. Measured, it spends 30% of the arena on scenery the player
          // can never stand on — and the soft edge already takes 120px off every
          // wall on top of that. Two cells is 400px a side, which still frames
          // the court and leaves the lawns big enough to fight a horde on.
          //
          // The seed still perturbs every cell's grain through `a`/`bq`/`c`; it
          // simply cannot move a building. That split — fixed geometry, rolled
          // texture — is the whole idea, and it is why this needed no storage.
          // ================================================================
          case 'courtyard': {
            const path = i >= 9 && i <= 10;
            const west = i <= 1, east = i >= 18;
            const bldg = j <= 1 || (j >= 2 && j <= 17 && (west || east));
            const wall = j >= 18;

            if (bldg) {
              // FLOORPLATE, then the roof panel inset off it, so each block
              // reads as a solid mass with an edge rather than as dark ground.
              r.drawRect(x, y, cell, cell, d.far, 1);
              r.drawRect(x + 6, y + 6, cell - 12, cell - 12, d.farLit, 0.55);
              // Windows: two per cell along the face that looks INTO the court,
              // which is the only face the player can ever see.
              const lit = a > 0.66;
              const wc = lit ? d.glow : d.midEdge;
              if (j <= 1) {
                r.drawRect(x + 26, y + cell - 46, 44, 26, wc, lit ? 0.55 : 0.8);
                r.drawRect(x + cell - 70, y + cell - 46, 44, 26, wc, lit ? 0.5 : 0.8);
              } else if (west) {
                r.drawRect(x + cell - 40, y + 30, 26, 44, wc, lit ? 0.55 : 0.8);
                r.drawRect(x + cell - 40, y + cell - 82, 26, 44, wc, lit ? 0.5 : 0.8);
              } else {
                r.drawRect(x + 14, y + 30, 26, 44, wc, lit ? 0.55 : 0.8);
                r.drawRect(x + 14, y + cell - 82, 26, 44, wc, lit ? 0.5 : 0.8);
              }
              // THE MAIN DOORS, exactly once, where the path meets the building
              // — plus the porch that steps out in front of them. The porch is
              // what makes this read as the WAY IN rather than as a lit panel:
              // it breaks the building's straight lower edge at exactly the two
              // cells the path arrives at, which is the only place the eye is
              // already looking.
              if (j === 1 && path) {
                r.drawRect(x, y + cell - 60, cell, 60, d.seam, 1);
                r.drawRect(x + 6, y + cell - 52, cell - 12, 52, d.glow, 0.34);
                r.drawRect(x + cell * 0.5 - 3, y + cell - 52, 6, 52, d.far, 0.9);
                // the porch roof, standing one step proud into the courtyard
                r.drawRect(x, y + cell, cell, 22, d.farLit, 1);
                r.drawRect(x, y + cell + 18, cell, 5, d.midEdge, 0.8);
                // and a pillar at each outer corner of the pair
                if (i === 9) r.drawRect(x + 4, y + cell, 16, 22, d.far, 1);
                if (i === 10) r.drawRect(x + cell - 20, y + cell, 16, 22, d.far, 1);
              }
              break;
            }

            if (wall) {
              // The perimeter wall and its capping course. The GATE is the one
              // gap in it, and it is on the path because that is how you get in.
              if (path) {
                // The gateway itself: paving continuing out under the arch.
                r.drawRect(x, y, cell, cell, d.tile, 1);
                r.drawRect(x + 10, y + 8, cell - 20, cell - 16, tone3(d, a), 0.8);
              } else {
                // The perimeter wall: a capping course along the top, the wall
                // face under it, and the buttress every third cell that stops
                // four hundred pixels of flat rectangle reading as a moat.
                r.drawRect(x, y, cell, cell, d.far, 1);
                r.drawRect(x, y, cell, 18, d.farLit, 0.85);
                r.drawRect(x + 8, y + 34, cell - 16, cell - 56, d.midEdge, 0.30);
                if (i % 3 === 1) {
                  r.drawRect(x + cell * 0.5 - 14, y + 18, 28, cell - 30, d.farLit, 0.42);
                }
              }
              // THE GATE. Two piers with a lintel across them, drawn on the
              // cells either side of the opening. It is the loudest thing on the
              // bottom wall on purpose — it is the one gap in four thousand
              // pixels of perimeter, and the player arrives facing it.
              if (j === 18 && (i === 8 || i === 11)) {
                const px = x + (i === 8 ? cell - 52 : 12);
                r.drawRect(px, y - 6, 40, cell + 6, d.farLit, 1);
                r.drawRect(px, y - 6, 40, 14, d.glow, 0.65);
                r.drawRect(px + 6, y + 30, 28, cell - 44, d.far, 0.5);
                // the lintel, reaching in over the opening from both sides
                r.drawRect(i === 8 ? px + 40 : x - 40 + 12, y - 6, 44, 16, d.farLit, 0.9);
              }
              break;
            }

            if (path) {
              // PAVING. Two slabs across the cell with a real joint between
              // them, so the path has a direction of travel in it.
              r.drawRect(x, y, cell, cell, d.tile, 1);
              r.drawRect(x + 5, y + 5, cell * 0.5 - 8, cell - 10, tone3(d, a), 1);
              r.drawRect(x + cell * 0.5 + 3, y + 5, cell * 0.5 - 8, cell - 10, tone3(d, bq), 1);
              r.drawRect(x, y + cell - 4, cell, 4, d.seam, 0.8);
              // A kerb down both edges — the line that says "stay on the path",
              // which is the whole reason a path reads as a path from above.
              if (i === 9) r.drawRect(x, y, 6, cell, d.farLit, 0.55);
              if (i === 10) r.drawRect(x + cell - 6, y, 6, cell, d.farLit, 0.55);
              if (bq > this.sSome) {
                r.drawRect(x + c * (cell - 30) + 8, y + bq * (cell - 30) + 8, 7, 5, this.litter, 0.9);
              }
              break;
            }

            // LAWN. A district-wide mow direction, a per-cell grain, and the
            // blossom that has drifted onto it.
            r.drawRect(x, y, cell, cell, d.mid, 1);
            r.drawRect(x + 3, y + 3, cell - 6, cell - 6, dq > 0.5 ? d.mid : d.midEdge, 0.35);
            for (let k = 0; k < 3; k++) {
              const gy = y + 24 + k * 58 + (a * 18 | 0);
              r.drawLine(x + 8, gy, x + cell - 8, gy, d.midEdge, 2, 0.28);
            }
            if (bq > this.sSome) {
              r.drawRect(x + c * (cell - 26) + 8, y + bq * (cell - 26) + 8, 6, 5, this.litter, 0.85);
              r.drawRect(x + bq * (cell - 36) + 12, y + c * (cell - 36) + 18, 5, 4, this.litter, 0.55);
            }
            break;
          }

          // ================================================================
          // STAGE 1's PREVIOUS LOOK — a school roof at the hour when a
          // confession feels inevitable. Kept: it is a good surface, and the
          // rooftop confession event still names it.
          // ================================================================
          case 'rooftop': {
            r.drawRect(x + 4, y + 4, cell - 8, cell - 8, tone3(d, a), 1);
            // The sunlit half of the roof. A DISTRICT-wide sheen, not a
            // per-cell one, because light has a shape and noise does not.
            if (dq > 0.62) r.drawRect(x + 4, y + 4, cell - 8, cell - 8, d.farLit, 0.10);
            // The channel, keyed on iy alone so it runs the length of the roof.
            if (j % 3 === 0) {
              r.drawRect(x, y + cell - 20, cell, 20, d.far, 1);
              r.drawRect(x, y + cell - 20, cell, 4, d.midEdge, 0.7);
            }
            // The court line, keyed on ix alone for exactly the same reason.
            if (i % 5 === 2) r.drawRect(x + cell * 0.5 - 3, y, 6, cell, d.farLit, 0.28);
            if (bq > this.sLot) {
              r.drawRect(x + c * (cell - 30) + 8, y + bq * (cell - 30) + 8, 7, 5, this.litter, 0.85);
              r.drawRect(x + bq * (cell - 40) + 14, y + c * (cell - 40) + 20, 5, 4, this.litter, 0.55);
            }
            break;
          }

          // ================================================================
          // STAGE 2 — six storeys of signage, and you are looking at the road.
          // The signs are only ever visible as what they do to the wet, which
          // is the only honest way to draw them from directly overhead.
          // ================================================================
          case 'wet_street': {
            // The one kind that does not use tone3. This palette's `far` and
            // `tile` are two hex digits apart, so the generic ramp produces a
            // uniformly black road — the second tone has to come from `seam` to
            // read as a patch repair at all, and a city street is mostly patch.
            r.drawRect(x, y, cell, cell, a < 0.62 ? d.tile : (a < 0.90 ? d.seam : d.mid), 1);
            // The rain never washes this street so much as it doubles the light.
            // A DISTRICT-wide sheen is the sign hanging above you, and from
            // directly overhead that is the only honest way to draw one.
            if (dq > 0.66) r.drawRect(x, y, cell, cell, d.farLit, 0.05);
            // A carriageway: tyre lanes polished into it, dashes down the middle
            // of one row, the kerb two rows later.
            if (j % 4 === 1) {
              r.drawRect(x, y + cell * 0.20, cell, 18, d.midEdge, 0.45);
              r.drawRect(x, y + cell * 0.72, cell, 18, d.midEdge, 0.45);
              r.drawRect(x + cell * 0.18, y + cell * 0.5 - 4, cell * 0.44, 8, d.farLit, 0.50);
            }
            if (j % 4 === 3) {
              r.drawRect(x, y + cell - 26, cell, 26, d.mid, 1);
              r.drawRect(x, y + cell - 26, cell, 5, d.farEdge, 0.35);
            }
            // The crossing, on the districts that are junctions.
            if (dq < 0.20 && (i & 1) === 0) {
              for (let p = 0; p < 3; p++) {
                r.drawRect(x + 10 + p * (cell / 3), y + 18, cell / 6, cell - 36, d.farLit, 0.28);
              }
            }
            if (a > 0.93) {
              r.drawCircle(x + cell * 0.5, y + cell * 0.5, 26, d.midEdge, 0.9);
              r.strokeCircle(x + cell * 0.5, y + cell * 0.5, 26, d.mid, 3, 0.7);
            }
            // Standing water, and the sign doubled in it. The pool has to be
            // drawn in the DARKEST role on the stage or it disappears into the
            // asphalt, and then the reflection has nothing to sit in.
            if (bq > 0.72) {
              const pw = 60 + c * 70, ph = 34 + a * 30;
              const px = x + c * (cell - pw), py = y + a * (cell - ph);
              r.drawRect(px, py, pw, ph, d.midEdge, 0.85);
              const pulse = 0.5 + 0.5 * Math.sin(t * 1.3 + a * 6.283);
              r.drawRect(px + 8, py + 6, pw - 16, 6, d.glow, 0.26 + pulse * 0.22 * flashK);
              r.drawRect(px + 12, py + ph - 12, pw - 24, 4, d.detail, 0.30);
            }
            if (c > this.sFew) r.drawRect(x + a * (cell - 18) + 6, y + bq * (cell - 18) + 6, 12, 8, this.litter, 0.35);
            break;
          }

          // ================================================================
          // STAGE 4 — technically hidden, practically the loudest place in the
          // country. Packed earth, and the plank roads it uses as roads.
          // ================================================================
          case 'village': {
            r.drawRect(x, y, cell, cell, tone3(d, a), 1);
            if (i % 4 === 1) {
              // The boardwalk. Three seams is enough to say "boards"; four says
              // "ladder", which is a different building entirely.
              r.drawRect(x + 26, y, cell - 52, cell, d.mid, 1);
              r.drawRect(x + 26, y, 4, cell, d.midEdge, 0.8);
              r.drawRect(x + cell - 30, y, 4, cell, d.midEdge, 0.8);
              for (let p = 1; p < 4; p++) {
                r.drawLine(x + 26, y + (cell * p) / 4, x + cell - 26, y + (cell * p) / 4, d.midEdge, 2, 0.45);
              }
            } else if (dq > 0.70) {
              // The raked yard — the one outdoor surface in the game that is
              // deliberately regular, so it is the one place straight lines on
              // bare earth are not a mistake.
              for (let p = 0; p < 3; p++) {
                const ry = y + cell * (0.25 + p * 0.25);
                r.drawLine(x, ry, x + cell, ry, d.seam, 2, 0.35);
              }
            }
            if (bq > 0.86) {
              r.drawCircle(x + c * (cell - 60) + 30, y + a * (cell - 60) + 30, 17 + c * 8, d.seam, 1);
            }
            // A lantern, drawn as the only part of a lantern that reaches the
            // floor. Every lantern here is a rendezvous; none of them are in
            // the air over the arena.
            if (c > 0.93) {
              const lx = x + a * (cell - 80) + 40, ly = y + bq * (cell - 80) + 40;
              r.drawCircle(lx, ly, 62, d.glow, 0.10);
              r.drawCircle(lx, ly, 24, d.glow, 0.16);
            } else if (a > this.sFew) {
              r.drawRect(x + bq * (cell - 16) + 6, y + c * (cell - 16) + 6, 8, 6, this.litter, 0.45);
            }
            break;
          }

          // ================================================================
          // STAGE 5 — rooms without a building. Tatami, and the polished
          // walkway between one room and the next one, which is elsewhere.
          // ================================================================
          case 'halls': {
            // Mats are 2:1 and every other room lays them the other way round.
            // That alternation is the entire visual grammar of a tatami floor
            // and the only reason a grid of rectangles reads as one.
            const half = cell * 0.5;
            const face = dq > 0.80 ? d.mid : d.tile;
            // The heri: the cloth binding on a mat's long edges. Without it a
            // mat is a rectangle. One district in ten is bound in crimson.
            const heri = dq > 0.90 ? d.detail : d.midEdge;
            if (((i + j) & 1) === 0) {
              r.drawRect(x + 4, y + 4, cell - 8, half - 6, face, 1);
              r.drawRect(x + 4, y + half + 2, cell - 8, half - 6, face, 1);
              r.drawRect(x + 4, y + 4, cell - 8, 5, heri, 0.9);
              r.drawRect(x + 4, y + half + 2, cell - 8, 5, heri, 0.9);
            } else {
              r.drawRect(x + 4, y + 4, half - 6, cell - 8, face, 1);
              r.drawRect(x + half + 2, y + 4, half - 6, cell - 8, face, 1);
              r.drawRect(x + 4, y + 4, 5, cell - 8, heri, 0.9);
              r.drawRect(x + half + 2, y + 4, 5, cell - 8, heri, 0.9);
            }
            // The engawa, keyed on iy alone so it is a corridor rather than a
            // plank — which is the only way a walkway between rooms makes sense
            // in a building that does not have any.
            if (j % 6 === 4) {
              r.drawRect(x, y + cell - 34, cell, 34, d.far, 1);
              r.drawRect(x, y + cell - 34, cell, 4, d.farLit, 0.20);
              r.drawLine(x + cell * 0.5, y + cell - 34, x + cell * 0.5, y + cell, d.midEdge, 2, 0.5);
            }
            // Paper. Somebody sealed these doors properly once.
            if (a > this.sFew) r.drawRect(x + c * (cell - 26) + 8, y + bq * (cell - 26) + 8, 14, 10, this.litter, 0.5);
            break;
          }

          // ================================================================
          // STAGE 6 — the stadium sank with the lights still on, and the pitch
          // is still marked out under the silt.
          // ================================================================
          case 'reef': {
            r.drawRect(x, y, cell, cell, tone3(d, a), 1);
            // Ripples, phase-shifted by the cell's own hash so the crests never
            // line up into a corduroy running across the whole screen.
            const ry = y + cell * (0.28 + a * 0.34);
            r.drawArc(x + cell * 0.5, ry + cell * 0.55, cell * 0.62, 3.62, 5.80, d.seam, 4, 0.42);
            if (a > 0.40) {
              r.drawArc(x + cell * 0.5, ry + cell * 0.88, cell * 0.52, 3.72, 5.70, d.seam, 3, 0.26);
            }
            if (j % 6 === 2) r.drawRect(x, y + cell * 0.5 - 4, cell, 8, d.farLit, 0.22);
            if (dq > 0.86 && i % 3 === 0) r.drawRect(x + cell * 0.5 - 4, y, 8, cell, d.farLit, 0.18);
            if (bq > this.sSome) {
              r.drawRect(x + c * (cell - 24) + 8, y + a * (cell - 24) + 8, 10, 8, this.litter, 0.45);
            }
            // Caustics. A caustic is LIGHT LANDING ON SAND, so it is drawn ON
            // the ripple it lands on — the same arc, fatter and brighter — and
            // not as a shape of its own. A disc of brightness floating over the
            // sand is a bubble; a bright crest is a seabed in sunlight, and the
            // difference is entirely whether it shares geometry with the floor.
            if (c > 0.55) {
              const pulse = 0.5 + 0.5 * Math.sin(t * 1.1 + a * 6.283);
              r.drawArc(x + cell * 0.5, ry + cell * 0.55, cell * 0.62, 3.75, 5.66,
                        d.glow, 8, 0.06 + pulse * 0.07 * flashK);
            }
            break;
          }

          // ================================================================
          // STAGE 7 — the last venue. The floor of a venue is the one surface
          // in this game that is supposed to look manufactured.
          // ================================================================
          case 'zenith': {
            r.drawRect(x + 3, y + 3, cell - 6, cell - 6, tone3(d, a), 1);
            r.drawRect(x + 3, y + 3, cell - 6, 4, d.farEdge, 0.25);
            // The boards themselves. Without these the deck is a blue field
            // with a grid on it; a venue floor is LAID, and the direction it
            // was laid in is most of what says so.
            for (let p = 1; p < 3; p++) {
              const by = y + (cell * p) / 3;
              r.drawLine(x + 3, by, x + cell - 3, by, d.farEdge, 2, 0.32);
            }
            // The inlaid strips, keyed on ix alone so each is a RUN of light
            // let into the deck rather than a board that happens to be bright,
            // and phased per district so the deck is never uniformly on.
            if (i % 3 === 1) {
              const pulse = 0.5 + 0.5 * Math.sin(t * 1.0 + dq * 6.283);
              r.drawRect(x + cell * 0.5 - 5, y, 10, cell, d.farLit, 0.16 + pulse * 0.14 * flashK);
            }
            if (j % 7 === 3) {
              r.drawRect(x, y + cell - 30, cell, 30, d.glow, 0.10);
              r.drawRect(x, y + cell - 30, cell, 3, d.glow, 0.28);
            }
            // Somebody's mark, taped down before the doors opened.
            if (a > this.sFew) {
              const gx = x + c * (cell - 70) + 24, gy = y + bq * (cell - 70) + 24;
              r.drawRect(gx, gy + 19, 44, 6, this.litter, 0.55);
              r.drawRect(gx + 19, gy, 6, 44, this.litter, 0.55);
            }
            break;
          }

          // ================================================================
          // STAGE 3 — it was a town. There were bakeries. Also the fallback,
          // because a stage with an unknown `kind` should be a dull floor
          // rather than no floor; data/index.js validate() reports the key.
          // ================================================================
          case 'ruins':
          default: {
            // The joint width is HASHED. A paving grid with a constant gutter
            // reads as tiling; this floor is meant to read as something laid by
            // hand a very long time ago and walked on ever since.
            const g = 5 + a * 9;
            r.drawRect(x + g, y + g, cell - g * 2, cell - g * 2, tone3(d, bq), 1);
            // The districts where the paving is simply gone.
            if (dq < 0.20) {
              r.drawRect(x + 4, y + 4, cell - 8, cell - 8, d.far, 0.85);
              if (c > 0.5) {
                r.drawRect(x + 20 + c * 40, y + 30 + a * 50, 40 + bq * 40, 12, d.midEdge, 0.5);
              }
            }
            // A crack, at the angle this cell owns, through the middle of it.
            const ang = a * 6.283;
            const mx = x + cell * 0.5, my = y + cell * 0.5;
            r.drawLine(mx - Math.cos(ang) * cell * 0.42, my - Math.sin(ang) * cell * 0.42,
                       mx + Math.cos(ang) * cell * 0.34, my + Math.sin(ang) * cell * 0.34,
                       d.far, 3, 0.55);
            if (c > this.sSome) {
              const rx = x + bq * (cell - 50) + 12, ry = y + c * (cell - 50) + 12;
              r.drawRect(rx, ry, 24 + a * 16, 14 + bq * 10, d.mid, 1);
              r.drawRect(rx, ry, 24 + a * 16, 4, d.seam, 0.7);
            }
            // Ash. It has been falling long enough that people call it the sky.
            if (bq > this.sSome) r.drawRect(x + c * (cell - 20) + 6, y + a * (cell - 20) + 6, 7, 7, this.litter, 0.45);
            break;
          }
        }
      }
    }
    r.unclip();
  }

  /**
   * THE ARENA EDGE.
   *
   * Now that the floor is opaque and there is no horizon, this is the ONLY
   * thing telling you the world stops — so it is deliberately louder than the
   * single 6px stroke it started as, and it is built out of the ground's own
   * colours so it reads as a kerb rather than as UI painted over one.
   *
   * Four parts, in the order they matter: a SOLID APRON just inside the line, an
   * accent rail along the apron's inner lip, the hard rule on the boundary
   * itself, and hatching on the side you are standing on. The apron is the part
   * that does the work — a stroke at the extreme edge of the screen is exactly
   * where a player is not looking when they back into it.
   *
   * Every fill here is clamped to the VISIBLE span rather than run along all
   * 4000px of wall. Canvas would clip the rest, but a fill whose size is
   * unrelated to the window is a fill nobody can reason about.
   */
  _boundary(r, cx, cy, t) {
    const b = this.bounds;
    const d = this.def;
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const accent = this.pal.accent || '#ff2d95';
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
    const near = 340;
    const APRON = 34;

    const x0 = Math.max(b.minX, cx - r.halfW), x1 = Math.min(b.maxX, cx + r.halfW);
    const y0 = Math.max(b.minY, cy - r.halfH), y1 = Math.min(b.maxY, cy + r.halfH);
    const leftNear = cx - r.halfW < b.minX + near;
    const rightNear = cx + r.halfW > b.maxX - near;
    const topNear = cy - r.halfH < b.minY + near;
    const botNear = cy + r.halfH > b.maxY - near;

    if (x1 > x0 && y1 > y0) {
      if (leftNear) {
        r.drawRect(b.minX, y0, APRON, y1 - y0, d.midEdge, 0.92);
        r.drawRect(b.minX + APRON, y0, 4, y1 - y0, accent, 0.20 + pulse * 0.10);
      }
      if (rightNear) {
        r.drawRect(b.maxX - APRON, y0, APRON, y1 - y0, d.midEdge, 0.92);
        r.drawRect(b.maxX - APRON - 4, y0, 4, y1 - y0, accent, 0.20 + pulse * 0.10);
      }
      if (topNear) {
        r.drawRect(x0, b.minY, x1 - x0, APRON, d.midEdge, 0.92);
        r.drawRect(x0, b.minY + APRON, x1 - x0, 4, accent, 0.20 + pulse * 0.10);
      }
      if (botNear) {
        r.drawRect(x0, b.maxY - APRON, x1 - x0, APRON, d.midEdge, 0.92);
        r.drawRect(x0, b.maxY - APRON - 4, x1 - x0, 4, accent, 0.20 + pulse * 0.10);
      }
    }

    r.strokeRect(b.minX, b.minY, w, h, accent, 7, 0.55);

    // Hatching, but only along the edges the camera can currently see — four
    // full runs of ticks across a 4000px arena is 160 lines nobody looks at.
    const step = 90;
    if (leftNear || rightNear || topNear || botNear) {
      if (leftNear) {
        for (let y = Math.floor(y0 / step) * step; y < y1; y += step) {
          r.drawLine(b.minX, y, b.minX + APRON, y + APRON, accent, 2, 0.34);
        }
      }
      if (rightNear) {
        for (let y = Math.floor(y0 / step) * step; y < y1; y += step) {
          r.drawLine(b.maxX, y, b.maxX - APRON, y + APRON, accent, 2, 0.34);
        }
      }
      if (topNear) {
        for (let x = Math.floor(x0 / step) * step; x < x1; x += step) {
          r.drawLine(x, b.minY, x + APRON, b.minY + APRON, accent, 2, 0.34);
        }
      }
      if (botNear) {
        for (let x = Math.floor(x0 / step) * step; x < x1; x += step) {
          r.drawLine(x, b.maxY, x + APRON, b.maxY - APRON, accent, 2, 0.34);
        }
      }
    }
  }
}

/**
 * What a stage gets if its `backdrop` key is missing or unknown. data/index.js
 * validate() reports that as a problem; this is what keeps it a dull floor
 * rather than a crashed one.
 */
const FALLBACK = {
  kind: 'ruins',
  far: '#1f2227', farEdge: '#0f1113', farLit: '#3a3f47',
  mid: '#33373e', midEdge: '#191b1f',
  tile: '#2d3037', seam: '#3a3f47',
  detail: '#585d66', glow: '#e07a3f',
  density: 1,
};
