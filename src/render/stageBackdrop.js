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
/**
 * THE COURTYARD'S PAVING TONES, and the reason they exist as their own pair.
 *
 * Every other kind varies its ground through `tone3(d, a)`, which picks between
 * `d.tile`, `d.mid` and `d.far`. That works because those three are three shades
 * of ONE surface everywhere else in this file. The courtyard repurposes the
 * roles — `mid` is grass, `far` is the school building — so `tone3` on a paving
 * slab returned lawn green and brick purple at random, and the path came out
 * looking like a bag of sweets. These two are the paving's own light and dark,
 * mixed off `tile` at module scope so the variation can only ever be grain.
 */
const PAVE_LIT = '#7d6576';
const PAVE_DARK = '#584154';

/**
 * STAGE 3's PAVING TONES, and they exist for exactly the reason the courtyard's
 * pair above does — the town made the same mistake, and it took a 1:1 render of
 * a street to see it.
 *
 * `ruined_town` repurposes `far` as PACKED EARTH INSIDE A HOUSE PLOT, and then
 * paved its roads and its market square with `tone3`, which returns `far` for
 * one hash byte in twelve. So one sett in twelve, and one 188px square slab in
 * twelve, came out the colour of bare soil: scattered across the whole map that
 * does not read as a worn stone, it reads as HOLES punched in the road.
 *
 * `pave` is `tone3` with the third tone replaced by two of the paving's own:
 *   RELAID  lift(mid, 0.08)   a sett somebody put back, still pale
 *   WORN    sink(tile, 0.18)  one nobody did — darker, more saturated, rotated
 *                             cool, which is what a shadow does in this project
 *                             and what shade()-toward-black does not
 * Both are mixed off `tile`/`mid` at module scope, so the variation on a street
 * can only ever be grain and can never be another material.
 */
const COBBLE_RELAID = '#42474f';
const COBBLE_WORN = '#23272f';
function pave(d, a) {
  if (a < 0.62) return d.tile;
  if (a < 0.84) return d.mid;
  return a < 0.93 ? COBBLE_RELAID : COBBLE_WORN;
}

/**
 * The colour of a burnt-out patch of ground on Stage 3 — `midEdge` (#191b1f,
 * the arena apron) mixed 22% toward the fallen-roof-tile terracotta. Soot on
 * stone is brown-black, never neutral black, and this is the one place on the
 * map where that distinction is doing the whole job: a neutral blot at the
 * alpha a scorch mark needs is indistinguishable from a hole in the road.
 */
const SCORCH = '#2e2423';

const GRID = {
  // 200 makes the arena exactly a 20x20 board, which is what lets the courtyard
  // plan below be written as whole-cell rows and columns instead of fractions.
  courtyard: { cell: 200, joints: false },
  // Akihabara is the same 20x20 board for the same reason, and `joints: false`
  // because a road is POURED. A mortar grid ruled across tarmac is the single
  // most obvious tell that a street was drawn by a spreadsheet.
  akiba: { cell: 200, joints: false },
  rooftop: { cell: 200, joints: true },
  wet_street: { cell: 220, joints: false },
  ruins: { cell: 210, joints: true },
  // Stage 3's town is the same 20x20 board the courtyard and Akihabara use, for
  // the same reason: the obstacle layout is written in whole cells and a street
  // has to land on the same world coordinate the houses were placed against.
  // `joints: false` because the shared mortar grid draws ONE 200px lattice
  // across the whole map, and this floor is three different laid surfaces —
  // cobbled road, dressed square, bare earth inside a plot. Each lays its own.
  ruined_town: { cell: 200, joints: false },
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
          // STAGE 2 — AKIHABARA, AS A STREET PLAN.
          //
          // Same technique as the courtyard and for the same reason: the cell
          // walk is anchored to the world origin, so cell (i,j) is always the
          // world rect (i*200, j*200, 200, 200) and a fixed 20x20 plan costs no
          // storage. The seed still picks every shopfront's colour and every
          // stain on the tarmac; it cannot move a road.
          //
          //     j,i <= 2 or >= 17   the RING ROAD, all the way round
          //     i = 8..11           the NORTH-SOUTH avenue
          //     j = 8..11           the EAST-WEST avenue
          //     everything else     four CITY BLOCKS, solid
          //
          // The blocks are solid, and the ring road is 600px wide with the two
          // avenues at 800 — which is the trade this layout is built on. A
          // bullet heaven needs somewhere to run, and a city that is mostly
          // building is a corridor maze the steering AI cannot cope with. Four
          // 1000x1000 blocks is 25% of the arena; the other 75% is street.
          //
          // The three horizontal road centres — 0.075, 0.5, 0.925 of the arena —
          // are the SAME NUMBERS the traffic hazard's `laneY` carries, so a car
          // is always on tarmac. Change one and change the other.
          // ================================================================
          case 'akiba': {
            const ring = i <= 2 || i >= 17 || j <= 2 || j >= 17;
            const aveNS = i >= 8 && i <= 11;
            const aveEW = j >= 8 && j <= 11;
            const road = ring || aveNS || aveEW;
            // Is (bi,bj) a BLOCK cell? One predicate, used by the shopfronts and
            // by the kerbs, so a frontage and the pavement in front of it can
            // never disagree about where the building ends.
            const blockAt = (bi, bj) => !(bi <= 2 || bi >= 17 || bj <= 2 || bj >= 17 ||
                                          (bi >= 8 && bi <= 11) || (bj >= 8 && bj <= 11));

            if (!road) {
              // --- A CITY BLOCK -----------------------------------------------
              r.drawRect(x, y, cell, cell, d.far, 1);
              // Unit-to-unit brightness, at DISTRICT scale so it comes in
              // stretches of frontage rather than as a chequerboard.
              if (dq > 0.55) r.drawRect(x + 4, y + 4, cell - 8, cell - 8, d.farLit, 0.5);
              // Lit windows. `a` is the cell's own grain, so a block has a
              // scatter of them rather than a grid.
              for (let k = 0; k < 3; k++) {
                if (((h >>> (k * 3)) & 7) < 3) continue;
                r.drawRect(x + 24 + k * 52, y + 42 + ((k * 37) % 90), 26, 18,
                           d.glow, 0.20 + 0.16 * ((k + a) % 1));
              }
              // Alley seams, so 1000px of building is not one flat slab.
              if (i % 3 === 0) r.drawRect(x, y, 5, cell, d.seam, 0.55);
              if (j % 3 === 0) r.drawRect(x, y, cell, 5, d.seam, 0.55);

              // SIGNAGE, ON THE STREET SIDE AND NOWHERE ELSE.
              //
              // The first pass hung a sign band on every cell of every block,
              // and the result was a grid of neon boxes rather than a city: a
              // block's interior cells are the MASS of the building and nobody
              // can see them, while the cells that front a road are the only
              // thing the player ever looks at. So a face gets a sign when the
              // neighbour on that side is not a block — which is exactly the
              // test the kerb below uses from the other side of the same line.
              const lit = ((h >>> 4) & 1) ? d.glow : d.farEdge;
              if (!blockAt(i, j - 1)) r.drawRect(x + 6, y, cell - 12, 9, lit, 0.62);
              if (!blockAt(i, j + 1)) r.drawRect(x + 6, y + cell - 9, cell - 12, 9, lit, 0.62);
              if (!blockAt(i - 1, j)) r.drawRect(x, y + 6, 9, cell - 12, lit, 0.62);
              if (!blockAt(i + 1, j)) r.drawRect(x + cell - 9, y + 6, 9, cell - 12, lit, 0.62);
              // And a doorway in the middle of one frontage cell in three, so
              // the parade has entrances in it rather than being a lit wall.
              if (bq > 0.62) {
                if (!blockAt(i, j + 1)) r.drawRect(x + cell * 0.38, y + cell - 22, cell * 0.24, 22, d.seam, 0.85);
                else if (!blockAt(i, j - 1)) r.drawRect(x + cell * 0.38, y, cell * 0.24, 22, d.seam, 0.85);
                else if (!blockAt(i - 1, j)) r.drawRect(x, y + cell * 0.38, 22, cell * 0.24, d.seam, 0.85);
                else if (!blockAt(i + 1, j)) r.drawRect(x + cell - 22, y + cell * 0.38, 22, cell * 0.24, d.seam, 0.85);
              }
              break;
            }

            // --- TARMAC ------------------------------------------------------
            r.drawRect(x, y, cell, cell, d.tile, 1);
            // Wet patches — this is a rain-slick street and the reflections are
            // most of what says so. District-scale, so they pool rather than
            // speckle.
            if (dq > 0.60) r.drawRect(x + 6, y + 6, cell - 12, cell - 12, d.mid, 0.22);
            // The neon, lying in the water. Gated on the DISTRICT as well as the
            // cell: on the cell alone this fired on ~60% of road cells and the
            // street came out speckled with pink dashes that read as litter
            // rather than as reflections. Long and faint, so it is a smear of
            // light on wet tarmac and not a painted mark.
            if (dq > 0.60 && bq > this.sLot) {
              r.drawRect(x + c * (cell - 60) + 12, y + bq * (cell - 30) + 8, 46, 6,
                         d.glow, 0.13);
            }

            // --- KERBS AND PAVEMENT ------------------------------------------
            // Drawn on the ROAD side of the boundary, so the pavement belongs to
            // the street and the block keeps its full footprint. A kerb only
            // exists where a road cell actually touches a block cell.
            //
            // PAVE is 30 rather than the 14 a real kerb stone would be, because
            // this strip has to be wide enough to stand a lamp post and a bin ON
            // — the obstacle layout puts them 24px off the block edge, and street
            // furniture floating on tarmac reads as litter rather than as a
            // street. The 4px lip is the kerb proper.
            const PAVE = 30;
            if (blockAt(i, j - 1)) { r.drawRect(x, y, cell, PAVE, d.midEdge, 0.95); r.drawRect(x, y + PAVE, cell, 4, d.detail, 0.35); }
            if (blockAt(i, j + 1)) { r.drawRect(x, y + cell - PAVE, cell, PAVE, d.midEdge, 0.95); r.drawRect(x, y + cell - PAVE - 4, cell, 4, d.detail, 0.35); }
            if (blockAt(i - 1, j)) { r.drawRect(x, y, PAVE, cell, d.midEdge, 0.95); r.drawRect(x + PAVE, y, 4, cell, d.detail, 0.35); }
            if (blockAt(i + 1, j)) { r.drawRect(x + cell - PAVE, y, PAVE, cell, d.midEdge, 0.95); r.drawRect(x + cell - PAVE - 4, y, 4, cell, d.detail, 0.35); }

            // --- LANE PAINT --------------------------------------------------
            // A dashed centre line down each carriageway, and a zebra where the
            // two avenues cross. Both are keyed on i or j ALONE, so they run the
            // whole length of a road and land at fixed world coordinates.
            const centreEW = j === 1 || j === 9 || j === 18;
            const centreNS = i === 1 || i === 9 || i === 18;
            if (centreEW && !(aveNS && aveEW)) {
              for (let k = 0; k < 3; k++) {
                r.drawRect(x + 18 + k * 64, y + cell - 4, 38, 7, d.detail, 0.55);
              }
            }
            if (centreNS && !(aveNS && aveEW)) {
              for (let k = 0; k < 3; k++) {
                r.drawRect(x + cell - 4, y + 18 + k * 64, 7, 38, d.detail, 0.55);
              }
            }
            // THE CROSSING. Only where the two avenues actually meet, so it is
            // one place on the map and it is the middle of it — and only on the
            // four ARMS of that junction, which is the other half of the same
            // point. Painting the whole 800px square gave the middle of the map
            // a chessboard the size of a football pitch; a zebra is the bit you
            // walk ACROSS, so the stripes run perpendicular to the road they
            // cross and the corners of the junction stay bare tarmac.
            if (aveNS && aveEW) {
              const armNS = i === 8 || i === 11;
              const armEW = j === 8 || j === 11;
              if (armEW && !armNS) {
                for (let k = 0; k < 5; k++) r.drawRect(x + 12 + k * 38, y + 14, 22, cell - 28, d.detail, 0.26);
              } else if (armNS && !armEW) {
                for (let k = 0; k < 5; k++) r.drawRect(x + 14, y + 12 + k * 38, cell - 28, 22, d.detail, 0.26);
              }
            }
            break;
          }
          // ================================================================
          // STAGE 1 — THE SCHOOL COURTYARD, AS A PLAN.
          //
          // The arena is exactly twenty cells square, so the layout is written
          // in whole rows and columns and lands at the same world coordinates in
          // every run. The seed still perturbs every cell's GRAIN; it simply
          // cannot move a building. Reading it as a map, north at the top:
          //
          //     j = 0..2     MAIN BUILDING interior, full width
          //     j = 3        its south wall, doors at i = 9..10
          //     j = 4..15    the courtyard
          //       i = 0..2   WEST WING interior     i = 17..19  EAST WING
          //       i = 3      west wing's east wall, door at j = 9..10
          //       i = 16     east wing's west wall, door at j = 9..10
          //       i = 9..10  the main path, gate to doors
          //       j = 9..10  the cross path, west door to east door
          //       else       lawn
          //     j = 16..17   the courtyard's south lawn
          //     j = 18..19   the perimeter wall, gate at i = 9..10
          //
          // THE BUILDINGS ARE WALKABLE. Their floors are painted here and their
          // walls are real obstacles in OBSTACLE_SETS.academy_courtyard, with a
          // gap at every door. That is the whole reason the plan grew a cross
          // path: three ways in, three ways to be cut off, and a horde that has
          // to funnel through a doorway to reach you.
          //
          // NOTHING IN THIS CASE CALLS tone3(). It is the one kind that must
          // not: `tone3` picks between `d.tile`, `d.mid` and `d.far`, and this
          // backdrop repurposes `mid` as GRASS and `far` as BUILDING — so the
          // paving came out with random green and purple slabs in it, which is
          // exactly what it looked like. Paving varies within the paving family
          // and nowhere else.
          // ================================================================
          case 'courtyard': {
            const mainPath = i >= 9 && i <= 10;
            const crossPath = j >= 9 && j <= 10;
            const westIn = i <= 2, eastIn = i >= 17;
            const northIn = j <= 2;
            const westWall = i === 3, eastWall = i === 16, southWall = j === 3;
            const perim = j >= 18;
            // The doors: one in each of the three walls, and each one lines up
            // with the path that leads to it.
            const doorN = southWall && mainPath;
            const doorW = westWall && crossPath;
            const doorE = eastWall && crossPath;

            // --- interiors -------------------------------------------------
            if (northIn || ((westIn || eastIn) && j >= 4 && j <= 15)) {
              // A classroom floor: boards running one way, a darker grout grid,
              // and the occasional desk-shaped scuff. Deliberately calmer than
              // the courtyard — inside is where you go to stop being shot at.
              r.drawRect(x, y, cell, cell, d.far, 1);
              r.drawRect(x + 3, y + 3, cell - 6, cell - 6, d.farLit, 0.30);
              for (let k = 0; k < 4; k++) {
                const bx = x + 6 + k * (cell - 12) / 4;
                r.drawLine(bx, y + 4, bx, y + cell - 4, d.seam, 2, 0.34);
              }
              if (bq > this.sSome) {
                r.drawRect(x + c * (cell - 46) + 14, y + bq * (cell - 40) + 12, 30, 22, d.seam, 0.45);
              }
              break;
            }

            // --- the three interior walls ----------------------------------
            if (southWall || westWall || eastWall) {
              if (doorN || doorW || doorE) {
                // A DOORWAY. Paved through, with a threshold and a lit frame on
                // both jambs, so the gap reads as a way in rather than as a hole
                // somebody forgot to wall up.
                r.drawRect(x, y, cell, cell, d.tile, 1);
                r.drawRect(x + 6, y + 6, cell - 12, cell - 12, d.seam, 0.55);
                if (southWall) {
                  r.drawRect(x, y, cell, 10, d.glow, 0.40);
                  r.drawRect(x, y + cell - 10, cell, 10, d.glow, 0.40);
                } else {
                  r.drawRect(x, y, 10, cell, d.glow, 0.40);
                  r.drawRect(x + cell - 10, y, 10, cell, d.glow, 0.40);
                }
                break;
              }
              // The wall itself: face, capping course along the courtyard side,
              // and a pilaster every other cell so a long run has rhythm in it.
              r.drawRect(x, y, cell, cell, d.far, 1);
              if (southWall) {
                r.drawRect(x, y + cell - 16, cell, 16, d.farLit, 0.9);
                if (i % 2 === 0) r.drawRect(x + cell * 0.5 - 12, y + 10, 24, cell - 30, d.farLit, 0.38);
              } else {
                const inner = westWall ? x + cell - 16 : x;
                r.drawRect(inner, y, 16, cell, d.farLit, 0.9);
                if (j % 2 === 0) r.drawRect(x + 10, y + cell * 0.5 - 12, cell - 30, 24, d.farLit, 0.38);
              }
              break;
            }

            // --- the perimeter wall and the main gate ----------------------
            if (perim) {
              if (mainPath) {
                r.drawRect(x, y, cell, cell, d.tile, 1);
                r.drawRect(x + 10, y + 8, cell - 20, cell - 16, PAVE_LIT, 0.55);
              } else {
                r.drawRect(x, y, cell, cell, d.far, 1);
                r.drawRect(x, y, cell, 18, d.farLit, 0.85);
                r.drawRect(x + 8, y + 34, cell - 16, cell - 56, d.midEdge, 0.30);
                if (i % 3 === 1) {
                  r.drawRect(x + cell * 0.5 - 14, y + 18, 28, cell - 30, d.farLit, 0.42);
                }
              }
              if (j === 18 && (i === 8 || i === 11)) {
                const px = x + (i === 8 ? cell - 52 : 12);
                r.drawRect(px, y - 6, 40, cell + 6, d.farLit, 1);
                r.drawRect(px, y - 6, 40, 14, d.glow, 0.65);
                r.drawRect(px + 6, y + 30, 28, cell - 44, d.far, 0.5);
                r.drawRect(i === 8 ? px + 40 : x - 28, y - 6, 44, 16, d.farLit, 0.9);
              }
              break;
            }

            // --- paving ----------------------------------------------------
            if (mainPath || crossPath) {
              // Slabs, in the PAVING family only. `a` and `bq` choose between
              // three tones derived from `d.tile` at module scope, so the
              // variation is grain rather than a different material.
              r.drawRect(x, y, cell, cell, d.seam, 1);
              const t1 = a < 0.55 ? d.tile : (a < 0.86 ? PAVE_LIT : PAVE_DARK);
              const t2 = bq < 0.55 ? d.tile : (bq < 0.86 ? PAVE_LIT : PAVE_DARK);
              if (mainPath) {
                r.drawRect(x + 5, y + 5, cell * 0.5 - 8, cell - 10, t1, 1);
                r.drawRect(x + cell * 0.5 + 3, y + 5, cell * 0.5 - 8, cell - 10, t2, 1);
              } else {
                r.drawRect(x + 5, y + 5, cell - 10, cell * 0.5 - 8, t1, 1);
                r.drawRect(x + 5, y + cell * 0.5 + 3, cell - 10, cell * 0.5 - 8, t2, 1);
              }
              // KERBS, on the outer edge of each run only — the line that says
              // "stay on the path", and the reason a path reads as a path from
              // above. A cell that is on BOTH runs is the crossing and gets none.
              if (mainPath && !crossPath) {
                if (i === 9) r.drawRect(x, y, 5, cell, d.farLit, 0.5);
                if (i === 10) r.drawRect(x + cell - 5, y, 5, cell, d.farLit, 0.5);
              } else if (crossPath && !mainPath) {
                if (j === 9) r.drawRect(x, y, cell, 5, d.farLit, 0.5);
                if (j === 10) r.drawRect(x, y + cell - 5, cell, 5, d.farLit, 0.5);
              }
              if (bq > this.sSome) {
                r.drawRect(x + c * (cell - 30) + 8, y + bq * (cell - 30) + 8, 7, 5, this.litter, 0.9);
              }
              break;
            }

            // --- lawn ------------------------------------------------------
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
          // STAGE 3 — A TIMBER-FRAMED TOWN SOMETHING STEPPED OVER, AS A PLAN.
          //
          // This stage used to draw the generic `ruins` surface below, which is
          // a very good FLOOR and not a PLACE. A hash can say "old paving with
          // some of it missing"; it cannot say "this is the market square, that
          // is a house plot, and the 400px between them is a street" — and the
          // whole promise of Stage 3 is a town, with bakeries in it.
          //
          // So it is a fixed plan, on the same 20x20 board the courtyard and
          // Akihabara use, and OBSTACLE_SETS.wall_amaris_ruins is authored
          // against these exact cells:
          //
          //     0-1, 5-6, 9-10, 13-14, 18-19   STREET, on both axes, 400px
          //     2-4, 7-8, 11-12, 15-17         HOUSE BLOCK, where both axes are
          //     7..12 on BOTH axes             the MARKET SQUARE — 1200px, and
          //                                    it overrides the four blocks
          //                                    that would sit inside it
          //
          // Twelve plots ringing a square, which is what a market town is, and
          // the player spawns dead centre of the square.
          //
          // THREE SURFACES OUT OF ONE WALK. The square is DRESSED stone — one
          // 188px slab to a cell. The streets are COBBLED — four 94px setts to
          // a cell, so the road reads as the rough surface and the market as
          // the formal one without a second pass. A plot is bare EARTH, because
          // its walls are obstacles standing on top of this and what is drawn
          // here is the yard, the passage, and the floor of the room whose roof
          // is now in the street.
          //
          // And all of it is sooted, scorched and covered in fallen roof tile,
          // which is the only warm colour on the map and the thing that says
          // which country the town was in. Nothing is drawn off the floor.
          // ================================================================
          case 'ruined_town': {
            // The plan, as one predicate each. `band` is true for the columns
            // and rows a block occupies; a cell is a block only where BOTH axes
            // are a band and it is not inside the square. The kerbs below test
            // the same predicate from the road side, exactly the way
            // Akihabara's do — a pavement drawn on the wrong side of that line
            // is a house with its doorstep in the carriageway.
            const band = (k) => (k >= 2 && k <= 4) || k === 7 || k === 8 ||
                                k === 11 || k === 12 || (k >= 15 && k <= 17);
            const sqAt = (bi, bj) => bi >= 7 && bi <= 12 && bj >= 7 && bj <= 12;
            const blockAt = (bi, bj) => band(bi) && band(bj) && !sqAt(bi, bj);
            const inSquare = sqAt(i, j);
            // Soot, at DISTRICT scale, because smoke does not stop at a
            // property line. It is the one treatment here that crosses the
            // street/plot boundary, and it is what stops the plan reading as a
            // clean architectural drawing of a town that is supposed to be
            // ruined.
            const sooty = dq < 0.34;
            // What is still alight. Slow — a fire seen from directly overhead
            // is a pool of light on the ground, not a flicker — and phased per
            // district so the map is never uniformly lit.
            const pulse = 0.5 + 0.5 * Math.sin(t * 0.9 + dq * 6.283);

            if (blockAt(i, j)) {
              // --- A HOUSE PLOT -------------------------------------------
              r.drawRect(x, y, cell, cell, d.far, 1);
              if (sooty) r.drawRect(x, y, cell, cell, d.midEdge, 0.55);
              // FALLEN ROOF TILE — three chips of terracotta per plot cell. A
              // steep tiled roof is the entire silhouette of one of these
              // houses, so when the roof comes off this is what is on the
              // ground, and it is the only warm thing lying on the map.
              for (let k = 0; k < 3; k++) {
                const tq = ((h >>> (k * 5)) & 31) / 31;
                r.drawRect(x + 14 + tq * (cell - 48),
                           y + 12 + ((k * 61 + a * 40) % (cell - 40)),
                           16 + tq * 12, 9, d.farLit, 0.50 + tq * 0.28);
              }
              // A frame member, burnt through and lying flat, at the angle this
              // cell owns. Keyed on the cell's own grain rather than on a
              // district, so a run of plots is a jumble and not a fence.
              const ba = a * 6.283;
              const mx = x + cell * 0.5, my = y + cell * 0.5;
              r.drawLine(mx - Math.cos(ba) * cell * 0.34, my - Math.sin(ba) * cell * 0.34,
                         mx + Math.cos(ba) * cell * 0.34, my + Math.sin(ba) * cell * 0.34,
                         d.farEdge, 7, 0.85);
              if (bq > this.sSome) {
                r.drawRect(x + c * (cell - 22) + 6, y + a * (cell - 22) + 6, 7, 7,
                           this.litter, 0.50);
              }
              break;
            }

            // --- PAVING ---------------------------------------------------
            // Mortar first, slabs inset off it — the same construction every
            // laid surface in this file uses.
            r.drawRect(x, y, cell, cell, d.seam, 1);
            if (inSquare) {
              r.drawRect(x + 6, y + 6, cell - 12, cell - 12, pave(d, a), 1);
              // A 188px dressed slab is big enough to have cracked, and every
              // one of them has. One crack per cell, at the cell's own angle.
              const sa = bq * 6.283;
              const cx2 = x + cell * 0.5, cy2 = y + cell * 0.5;
              r.drawLine(cx2 - Math.cos(sa) * cell * 0.40, cy2 - Math.sin(sa) * cell * 0.40,
                         cx2 + Math.cos(sa) * cell * 0.32, cy2 + Math.sin(sa) * cell * 0.32,
                         d.midEdge, 3, 0.60);
              // THE STALL PITCHES — the reason this is a MARKET square and not
              // just the widest paving on the map.
              //
              // A 1200px expanse of 188px slabs with one hairline crack each is
              // the flattest surface in the game, and the player spawns dead
              // centre of it and fights there for the first minute of the run.
              // A market town's square is not blank: the pitches are let, they
              // are marked out on the stone, and centuries of boots wear the
              // rectangle in. Two rules and a worn floor, drawn FLAT — a stall
              // with any height to it would be a thing hovering over the arena,
              // which is the bug that cost this file its parallax layer.
              //
              // Keyed on `bq` and NOT on `a`, which is the byte the slab tone
              // above already spent: keying both on one byte would make every
              // pitch land on the same colour of stone, and a market that only
              // ever lets its dark slabs is a pattern, not a place.
              if (bq > 0.45) {
                const pw = cell * 0.56, ph = cell * 0.40;
                const px = x + 18 + c * (cell - pw - 36);
                const py = y + 18 + a * (cell - ph - 36);
                r.drawRect(px, py, pw, ph, COBBLE_WORN, 0.60);
                r.drawRect(px, py, pw, 3, d.detail, 0.30);
                r.drawRect(px, py + ph - 3, pw, 3, d.detail, 0.30);
              }
            } else {
              // Cobbles: four setts to a cell, each taking its own tone, so the
              // road has grain at half the scale of the square's slabs.
              const half = cell * 0.5;
              r.drawRect(x + 4, y + 4, half - 6, half - 6, pave(d, a), 1);
              r.drawRect(x + half + 2, y + 4, half - 6, half - 6, pave(d, bq), 1);
              r.drawRect(x + 4, y + half + 2, half - 6, half - 6, pave(d, c), 1);
              r.drawRect(x + half + 2, y + half + 2, half - 6, half - 6,
                         pave(d, (a + c) * 0.5), 1);
              // THE GUTTER — the Rinnstein down the centre line of each street
              // band, keyed on i or j ALONE so it runs the whole length of the
              // road and lands at a fixed world coordinate with no second pass.
              // The bands are pairs (0-1, 5-6, 9-10, 13-14, 18-19), so the
              // centre line is their shared edge and the LOWER cell draws it.
              if (i === 0 || i === 5 || i === 9 || i === 13 || i === 18) {
                r.drawRect(x + cell - 7, y, 14, cell, d.seam, 0.85);
                r.drawRect(x + cell - 4, y, 8, cell, d.midEdge, 0.55);
              }
              if (j === 0 || j === 5 || j === 9 || j === 13 || j === 18) {
                r.drawRect(x, y + cell - 7, cell, 14, d.seam, 0.85);
                r.drawRect(x, y + cell - 4, cell, 8, d.midEdge, 0.55);
              }
            }
            if (sooty) r.drawRect(x, y, cell, cell, d.midEdge, 0.30);

            // --- KERBS ----------------------------------------------------
            // Drawn on the ROAD side of every frontage, so the pavement belongs
            // to the street and the plot keeps its whole footprint. 22px of
            // lime dust with a 4px lip: on a stage where a house wall can be
            // 400px down the block, this line is the only thing on the floor
            // that says where somebody's front door used to be.
            const KERB = 22;
            if (blockAt(i, j - 1)) {
              r.drawRect(x, y, cell, KERB, d.detail, 0.26);
              r.drawRect(x, y + KERB, cell, 4, d.detail, 0.45);
            }
            if (blockAt(i, j + 1)) {
              r.drawRect(x, y + cell - KERB, cell, KERB, d.detail, 0.26);
              r.drawRect(x, y + cell - KERB - 4, cell, 4, d.detail, 0.45);
            }
            if (blockAt(i - 1, j)) {
              r.drawRect(x, y, KERB, cell, d.detail, 0.26);
              r.drawRect(x + KERB, y, 4, cell, d.detail, 0.45);
            }
            if (blockAt(i + 1, j)) {
              r.drawRect(x + cell - KERB, y, KERB, cell, d.detail, 0.26);
              r.drawRect(x + cell - KERB - 4, y, 4, cell, d.detail, 0.45);
            }

            // --- WHAT THE FIRE LEFT ---------------------------------------
            // A scorch mark is a SOOT BLOT WITH A WARM CORE, and both halves are
            // FLAT ON THE PAVING. The stage's hazard lights real fires on top of
            // this; these are the ones that have already burnt out, and they are
            // what makes a fresh one read as "here we go again" instead of as a
            // decal that arrived from nowhere.
            //
            // THE SOOT IS 0.55 OF A CHARRED BROWN, not 0.80 of `midEdge`. The
            // first version was 80% of near-black (#191b1f) over a #2d3037
            // street, which arrives at (24,26,31) — darker than anything else on
            // the map including the plot earth. Rendered wide and looked at,
            // fourteen percent of every cell on the map was a hard black
            // rectangle, and the street read as paving with holes punched
            // through it rather than as paving somebody set fire to. Soot on
            // stone is brown-black and it FEATHERS, so this is a big soft blot
            // with a smaller, harder centre inside it, and the burnt core is
            // warm because the thing that made it was.
            if (c > this.sFew) {
              const sx = x + bq * (cell - 78) + 18, sy = y + a * (cell - 78) + 18;
              const sw = 42 + c * 22, sh = 30 + bq * 18;
              r.drawRect(sx, sy, sw, sh, SCORCH, 0.55);
              r.drawRect(sx + 7, sy + 6, sw - 14, sh - 12, SCORCH, 0.45);
              r.drawRect(sx + 6, sy + 5, 28 + c * 14, 18 + bq * 10, d.glow,
                         0.11 + 0.07 * pulse * flashK);
            }
            // And one district in seven is still properly alight underfoot.
            if (dq > 0.86) {
              r.drawRect(x + 12, y + 12, cell - 24, cell - 24, d.glow,
                         0.05 + 0.05 * pulse * flashK);
            }
            // Ash. It has been falling long enough that people call it the sky.
            if (bq > this.sSome) {
              r.drawRect(x + c * (cell - 20) + 6, y + a * (cell - 20) + 6, 7, 7,
                         this.litter, 0.45);
            }
            break;
          }

          // ================================================================
          // THE GENERIC RUIN FLOOR — old hand-laid flagstone with some of the
          // paving gone. Stage 3 used to be drawn on it and is not any more;
          // it stays because it is ALSO the `default:`, so a stage with an
          // unknown `kind` gets a dull floor rather than no floor.
          // data/index.js validate() reports the key.
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
