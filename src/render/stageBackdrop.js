// The per-stage layered backdrop.
//
// WHAT THIS REPLACED
// ------------------
// One function in runScene.js drew a flat ground rect, a 128px grid, a border
// and a mote — for every stage. Seven stages, four hex codes of difference. A
// rooftop at sunset, a flooded stadium and the inside of a paper maze were the
// same screen with the tint changed, and because the grid is aligned to world
// space and nothing else moves, sprinting across 4000px of arena read as
// standing still on a treadmill.
//
// HOW IT WORKS
// ------------
// Three depth layers, drawn floor-upward:
//
//   ground   k = 1. The floor you are standing on. PROCEDURAL, not a list:
//            it is a cell walk over the visible window with a hash per cell, so
//            it costs the same at (0,0) as at (4000,4000) and needs no storage.
//   far      k ~ 0.26. Distant silhouettes. Moves at a quarter of your speed.
//   mid      k ~ 0.58. Near scenery. Moves at a bit over half.
//
// A layer's element list is BUILT ONCE per run from a private seeded Rng and
// then only read. draw() allocates nothing: no object literals, no closures, no
// array methods that take one.
//
// THE FAR AND MID LAYERS TILE, and this is the load-bearing trick.
//
// A parallax layer at k shows you 1/k as much of its own coordinate space as the
// ground does — at k = 0.26 the camera can see anchors nearly four screens wide
// in every direction. Scattering elements over a field that large means either
// hundreds of them or visible bald patches, and the field has to be bigger than
// the arena on top of that or the scenery runs out at the edges. So each layer
// instead holds a handful of elements inside ONE TILE, and the draw walks the
// tiles that intersect the view. Coverage is exact everywhere, the list stays
// tiny, and a drifting layer (mist, aurora) wraps for free because the tile
// period is already the wrap period.
//
// Culling is per ITEM, not per primitive: an item carries the half-extents of
// everything inside it, and a rejected item skips its whole parts list. That is
// what keeps the worst case near 200 primitive calls with a 2,000-entity horde
// on screen — a few hundred, as budgeted, not a few thousand.
//
// EVERYTHING IS A RENDERER PRIMITIVE. No atlas entries, so there is nothing here
// that can rasterise mid-run (tests/renderSmoke.js fails the build over that),
// and no gradients, which are per-frame allocation and the single most expensive
// thing you can put in a Canvas 2D draw loop.

import { Rng, fxRng } from '../core/rng.js';
import { particles } from './particles.js';
import { save } from '../core/save.js';

// --- primitive kinds ---------------------------------------------------------
const RECT = 0, ROUND = 1, CIRCLE = 2, RING = 3, LINE = 4, BEAM = 5, FRAME = 6;

// The two tiled layers. Both `k` values are chosen so that a full sprint across
// the arena visibly slides them against each other; anything above ~0.75 reads
// as the ground and anything below ~0.15 reads as painted-on.
const FAR_K = 0.26, FAR_TILE = 3400;
const MID_K = 0.58, MID_TILE = 1500;

/** Deterministic 2D integer hash. The ground layer's entire memory. */
function hash2(ix, iy) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Apply a backdrop's `density` knob to a base element count. Never below one:
 * a stage tuned sparse should feel sparse, not empty, and a layer with no items
 * at all is a parallax layer that cannot prove it exists.
 */
function dens(n, d) { return Math.max(1, Math.round(n * (d.density || 1))); }

// --- build-time helpers ------------------------------------------------------
// These allocate freely. They run once, inside the constructor, and never again.

function layer(k, tile, drift) {
  return { k, tile, drift: drift || 0, items: [] };
}

function item(lay, x, y) {
  const it = { x, y, ex: 0, ey: 0, parts: [] };
  lay.items.push(it);
  return it;
}

/**
 * Grow an item's cull box to contain a part. Getting this wrong is invisible:
 * the item simply pops in and out at the screen edge, which nothing reports.
 */
function fit(it, x0, y0, x1, y1) {
  it.ex = Math.max(it.ex, Math.abs(x0), Math.abs(x1));
  it.ey = Math.max(it.ey, Math.abs(y0), Math.abs(y1));
}

function pRect(it, x, y, w, h, color, alpha, pulse) {
  it.parts.push({ t: RECT, x, y, w, h, r: 0, width: 0, color, alpha, pulse: pulse || 0 });
  fit(it, x, y, x + w, y + h);
}
function pRound(it, x, y, w, h, rad, color, alpha, pulse) {
  it.parts.push({ t: ROUND, x, y, w, h, r: rad, width: 0, color, alpha, pulse: pulse || 0 });
  fit(it, x, y, x + w, y + h);
}
function pCircle(it, x, y, rad, color, alpha, pulse) {
  it.parts.push({ t: CIRCLE, x, y, w: 0, h: 0, r: rad, width: 0, color, alpha, pulse: pulse || 0 });
  fit(it, x - rad, y - rad, x + rad, y + rad);
}
function pRing(it, x, y, rad, width, color, alpha, pulse) {
  it.parts.push({ t: RING, x, y, w: 0, h: 0, r: rad, width, color, alpha, pulse: pulse || 0 });
  fit(it, x - rad, y - rad, x + rad, y + rad);
}
function pLine(it, x, y, dx, dy, width, color, alpha, pulse) {
  it.parts.push({ t: LINE, x, y, w: dx, h: dy, r: 0, width, color, alpha, pulse: pulse || 0 });
  fit(it, x, y, x + dx, y + dy);
}
function pBeam(it, x, y, dx, dy, width, color, alpha, pulse) {
  it.parts.push({ t: BEAM, x, y, w: dx, h: dy, r: 0, width, color, alpha, pulse: pulse || 0 });
  fit(it, x - width, y - width, x + dx + width, y + dy + width);
}
function pFrame(it, x, y, w, h, width, color, alpha) {
  it.parts.push({ t: FRAME, x, y, w, h, r: 0, width, color, alpha, pulse: 0 });
  fit(it, x, y, x + w, y + h);
}

export class StageBackdrop {
  /**
   * @param stage    the STAGES entry
   * @param bounds   run.bounds
   * @param backdrops the BACKDROPS table from data/stages.js
   * @param seed     the RUN seed. Deliberately fed to a PRIVATE Rng rather than
   *                 drawn from runRng: the backdrop is built by the scene, after
   *                 Run's constructor has already stepped the run stream, and
   *                 pulling from it here would mean the SCENE decided where the
   *                 altar and the first wave landed. A replay must not depend on
   *                 whether anybody was looking.
   */
  constructor(stage, bounds, backdrops, seed) {
    const def = (backdrops && backdrops[stage.backdrop]) || FALLBACK;
    this.stageId = stage.id;
    this.def = def;
    this.kind = def.kind;
    this.pal = stage.palette;
    this.bounds = bounds;
    this.ambience = stage.ambience;

    const rng = new Rng((seed ^ 0x51ed270b) >>> 0);
    this.far = layer(FAR_K, FAR_TILE, 0);
    this.mid = layer(MID_K, MID_TILE, 0);
    /** Items pinned to an absolute anchor rather than tiled — a moon is one moon. */
    this.fixed = [];
    /** A third tiled layer, only built by the kinds that drift something. */
    this.mist = null;
    this.cell = 200;

    switch (def.kind) {
      case 'rooftop': this._rooftop(def, rng); break;
      case 'wet_street': this._wetStreet(def, rng); break;
      case 'ruins': this._ruins(def, rng); break;
      case 'village': this._village(def, rng); break;
      case 'halls': this._halls(def, rng); break;
      case 'reef': this._reef(def, rng); break;
      case 'zenith': this._zenith(def, rng); break;
      default: this._ruins(def, rng); break;
    }
  }

  /** A fixed item, anchored in world space and moved at its own parallax rate. */
  _pin(k, x, y) {
    const it = { k, x, y, ex: 0, ey: 0, parts: [], drift: 0, span: 0 };
    this.fixed.push(it);
    return it;
  }

  // ==========================================================================
  // STAGE 1 — a school roof at the hour when a confession feels inevitable.
  // ==========================================================================
  _rooftop(d, rng) {
    this.cell = 200;
    // FAR: the rest of the school, and the town past it. Dark blocks with a
    // sunset line along every parapet and a handful of lit windows.
    for (let i = 0, n = dens(3, d); i < n; i++) {
      const it = item(this.far, rng.range(0, FAR_TILE), rng.range(0, FAR_TILE));
      const w = rng.range(300, 470), h = rng.range(210, 330);
      pRound(it, -w / 2, -h / 2, w, h, 10, d.far, 0.72);
      pRect(it, -w / 2, -h / 2, w, 7, d.farEdge, 0.42);
      for (let j = 0; j < 4; j++) {
        const wx = -w / 2 + 22 + rng.range(0, w - 60);
        const wy = -h / 2 + 30 + rng.range(0, h - 70);
        pRect(it, wx, wy, 15, 11, d.farLit, 0.30, j === 0 ? 0.5 : 0);
      }
    }
    // MID: the chain-link fence you lean on dramatically, and the stair huts.
    for (let i = 0; i < 2; i++) {
      const it = item(this.mid, rng.range(0, MID_TILE), rng.range(0, MID_TILE));
      if (i === 0) {
        const run = rng.range(360, 520);
        pLine(it, -run / 2, -46, run, 0, 3, d.mid, 0.60);
        pLine(it, -run / 2, 6, run, 0, 3, d.mid, 0.60);
        for (let p = 0; p <= 5; p++) {
          pLine(it, -run / 2 + (run * p) / 5, -52, 0, 62, 3, d.mid, 0.55);
        }
        // Four diagonals is enough to say "mesh" without drawing mesh.
        for (let p = 0; p < 4; p++) {
          const x = -run / 2 + (run * (p + 0.5)) / 5;
          pLine(it, x, -46, run / 10, 52, 1.5, d.mid, 0.22);
        }
      } else {
        const w = rng.range(90, 150), h = rng.range(70, 110);
        pRect(it, -w / 2, -h / 2, w, h, d.mid, 0.38);
        pFrame(it, -w / 2, -h / 2, w, h, 3, d.midEdge, 0.55);
      }
    }
  }

  // ==========================================================================
  // STAGE 2 — six storeys of signage doubled in the wet.
  // ==========================================================================
  _wetStreet(d, rng) {
    this.cell = 220;
    // FAR: sign towers. Stacked coloured bars over a dark block, plus the soft
    // bloom each one throws down onto the street.
    for (let i = 0, n = dens(4, d); i < n; i++) {
      const it = item(this.far, rng.range(0, FAR_TILE), rng.range(0, FAR_TILE));
      const w = rng.range(70, 130), h = rng.range(220, 380);
      pRound(it, -w / 2, -h / 2, w, h, 5, d.far, 0.78);
      const bars = 3 + ((rng.raw() * 3) | 0);
      for (let j = 0; j < bars; j++) {
        const c = j % 2 === 0 ? d.farEdge : d.farLit;
        pRect(it, -w / 2 + 8, -h / 2 + 16 + j * (h / bars), w - 16, 12, c, 0.55, 0.45);
      }
      // The bloom: one big soft disc, one tight core. Two calls, and it is the
      // difference between "a sign" and "a sign that is ON".
      pCircle(it, 0, h / 2 - 20, w * 1.5, d.glow, 0.055, 0.6);
      pCircle(it, 0, h / 2 - 20, w * 0.55, d.glow, 0.09, 0.6);
    }
    // MID: kerb lines and crash barriers along the lane edges.
    for (let i = 0; i < 2; i++) {
      const it = item(this.mid, rng.range(0, MID_TILE), rng.range(0, MID_TILE));
      const run = rng.range(420, 700);
      pRect(it, -run / 2, -5, run, 10, d.mid, 0.55);
      pRect(it, -run / 2, -5, run, 3, d.detail, 0.28);
      for (let p = 0; p < 5; p++) {
        pRect(it, -run / 2 + (run * p) / 5 + 8, -18, 6, 14, d.mid, 0.45);
      }
    }
  }

  // ==========================================================================
  // STAGE 3 — it was a town. There were bakeries.
  // ==========================================================================
  _ruins(d, rng) {
    this.cell = 210;
    // THE WALL. One wall, so it is pinned rather than tiled, and it is nearly
    // static (k = 0.12) because a thing that big does not move when you do.
    const wall = this._pin(0.12, (this.bounds.minX + this.bounds.maxX) / 2,
                           this.bounds.minY - 900);
    pRect(wall, -3000, -260, 6000, 520, d.far, 0.85);
    pRect(wall, -3000, -260, 6000, 10, d.farLit, 0.35);
    for (let i = 0; i < 14; i++) {
      // Battlements, and one of them is a hole the size of a bakery.
      const x = -2800 + i * 400;
      if (i === 6) continue;
      pRect(wall, x, -320, 220, 70, d.far, 0.85);
    }
    // FAR: broken roof lines — angular silhouettes with a snapped ridge.
    for (let i = 0, n = dens(4, d); i < n; i++) {
      const it = item(this.far, rng.range(0, FAR_TILE), rng.range(0, FAR_TILE));
      const w = rng.range(220, 380), h = rng.range(110, 190);
      pRect(it, -w / 2, -h / 2, w, h, d.far, 0.66);
      pLine(it, -w / 2, -h / 2, w * 0.55, -rng.range(30, 70), 5, d.farEdge, 0.7);
      pLine(it, -w / 2 + w * 0.62, -h / 2 - rng.range(10, 40), w * 0.38, rng.range(20, 50),
            5, d.farEdge, 0.7);
    }
    // MID: rubble mounds and the stubs of walls that used to be houses.
    for (let i = 0; i < 3; i++) {
      const it = item(this.mid, rng.range(0, MID_TILE), rng.range(0, MID_TILE));
      if (i === 2) {
        const rad = rng.range(48, 88);
        pCircle(it, 0, 0, rad, d.mid, 0.34);
        pRing(it, 0, 0, rad, 2, d.midEdge, 0.45);
      } else {
        const w = rng.range(120, 240);
        pRect(it, -w / 2, -14, w, 28, d.mid, 0.42);
        pRect(it, -w / 2, -14, w, 5, d.midEdge, 0.55);
      }
    }
  }

  // ==========================================================================
  // STAGE 4 — technically hidden, practically the loudest place in the country.
  // ==========================================================================
  _village(d, rng) {
    this.cell = 190;
    // FAR: the ridge the village is hidden behind.
    for (let i = 0, n = dens(3, d); i < n; i++) {
      const it = item(this.far, rng.range(0, FAR_TILE), rng.range(0, FAR_TILE));
      const w = rng.range(380, 620), h = rng.range(150, 240);
      pRound(it, -w / 2, -h / 2, w, h, 40, d.far, 0.70);
      pRect(it, -w / 2, -h / 2, w, 6, d.farLit, 0.30);
    }
    // MID: plank roofs used as roads, and the lanterns that are all rendezvous.
    for (let i = 0; i < 3; i++) {
      const it = item(this.mid, rng.range(0, MID_TILE), rng.range(0, MID_TILE));
      if (i === 2) {
        pCircle(it, 0, 0, 46, d.glow, 0.07, 0.55);
        pCircle(it, 0, 0, 13, d.glow, 0.34, 0.55);
        pRing(it, 0, 0, 15, 2, d.midEdge, 0.6);
      } else {
        const w = rng.range(150, 260), h = rng.range(80, 130);
        pRect(it, -w / 2, -h / 2, w, h, d.mid, 0.45);
        pFrame(it, -w / 2, -h / 2, w, h, 3, d.midEdge, 0.6);
        for (let p = 1; p < 4; p++) {
          pLine(it, -w / 2, -h / 2 + (h * p) / 4, w, 0, 2, d.midEdge, 0.30);
        }
      }
    }
    // The mist is scheduled. A drifting layer wraps on the tile period for free.
    this.mist = layer(0.40, 1200, 26);
    for (let i = 0; i < 2; i++) {
      const it = item(this.mist, rng.range(0, 1200), rng.range(0, 1200));
      const w = rng.range(700, 1100), h = rng.range(90, 170);
      pRound(it, -w / 2, -h / 2, w, h, h / 2, d.farLit, 0.10, 0);
    }
  }

  // ==========================================================================
  // STAGE 5 — rooms without a building. Do not get attached to this corridor.
  // ==========================================================================
  _halls(d, rng) {
    this.cell = 180;
    // The moon. Exactly one, so it is pinned, and at k = 0.06 it barely moves —
    // which is what a moon does.
    const moon = this._pin(0.06, (this.bounds.minX + this.bounds.maxX) / 2 + 700,
                           (this.bounds.minY + this.bounds.maxY) / 2 - 620);
    pCircle(moon, 0, 0, 300, d.farLit, 0.05);
    pCircle(moon, 0, 0, 150, d.farLit, 0.22);
    pRing(moon, 0, 0, 152, 3, d.farLit, 0.5);
    // A demon moon has a stain on it.
    pCircle(moon, -44, -30, 34, d.detail, 0.12);
    pCircle(moon, 52, 40, 24, d.detail, 0.10);

    // FAR: four hundred more paper doors, receding.
    for (let i = 0, m = dens(3, d); i < m; i++) {
      const it = item(this.far, rng.range(0, FAR_TILE), rng.range(0, FAR_TILE));
      const n = 4 + ((rng.raw() * 3) | 0);
      for (let j = 0; j < n; j++) {
        pRect(it, -n * 46 + j * 92, -110, 84, 220, d.far, 0.55);
        pFrame(it, -n * 46 + j * 92, -110, 84, 220, 2, d.farLit, 0.16);
      }
    }
    // MID: the sliding-door frames themselves, latticed.
    for (let i = 0; i < 2; i++) {
      const it = item(this.mid, rng.range(0, MID_TILE), rng.range(0, MID_TILE));
      const w = rng.range(150, 250), h = rng.range(120, 190);
      pRect(it, -w / 2, -h / 2, w, h, d.mid, 0.30);
      pFrame(it, -w / 2, -h / 2, w, h, 4, d.midEdge, 0.75);
      pLine(it, 0, -h / 2, 0, h, 3, d.midEdge, 0.55);
      pLine(it, -w / 2, 0, w, 0, 3, d.midEdge, 0.45);
    }
  }

  // ==========================================================================
  // STAGE 6 — the stadium sank with the lights still on.
  // ==========================================================================
  _reef(d, rng) {
    this.cell = 200;
    // FAR: seating tiers. Forty thousand seats, drawn as the rows they are.
    for (let i = 0, n = dens(3, d); i < n; i++) {
      const it = item(this.far, rng.range(0, FAR_TILE), rng.range(0, FAR_TILE));
      const w = rng.range(420, 700);
      for (let j = 0; j < 6; j++) {
        pRect(it, -w / 2 + j * 5, -120 + j * 34, w - j * 10, 22, d.far, 0.60);
        pRect(it, -w / 2 + j * 5, -120 + j * 34, w - j * 10, 4, d.farLit, 0.28);
      }
    }
    // MID: kelp. Three segments each, leaning, because straight kelp is a pole.
    for (let i = 0; i < 4; i++) {
      const it = item(this.mid, rng.range(0, MID_TILE), rng.range(0, MID_TILE));
      let x = 0, y = 0;
      const lean = rng.range(-26, 26);
      for (let j = 0; j < 3; j++) {
        const dy = -rng.range(50, 80);
        pLine(it, x, y, lean, dy, 5 - j, d.detail, 0.34 - j * 0.06);
        x += lean; y += dy;
      }
    }
  }

  // ==========================================================================
  // STAGE 7 — the last venue, and the aurora is doing far too much.
  // ==========================================================================
  _zenith(d, rng) {
    this.cell = 240;
    // The aurora. Pinned, wide, slow, and the one thing on this stage that is
    // allowed to breathe — `reduceFlashing` flattens the pulse, not the band.
    const aur = this._pin(0.10, (this.bounds.minX + this.bounds.maxX) / 2,
                          (this.bounds.minY + this.bounds.maxY) / 2 - 520);
    for (let i = 0; i < 3; i++) {
      pRound(aur, -2600, -180 + i * 96, 5200, 62, 31, i === 1 ? d.farLit : d.detail,
             0.075, 0.5);
    }
    // FAR: floating slabs of every place you already survived.
    for (let i = 0, n = dens(4, d); i < n; i++) {
      const it = item(this.far, rng.range(0, FAR_TILE), rng.range(0, FAR_TILE));
      const w = rng.range(180, 330), h = rng.range(60, 110);
      pRound(it, -w / 2, -h / 2, w, h, 8, d.far, 0.78);
      pRect(it, -w / 2, -h / 2, w, 5, d.farLit, 0.30);
      pRect(it, -w / 2 + 12, h / 2, w - 24, 16, d.far, 0.35);
    }
    // MID: light trusses, and the beam each one is throwing at the floor.
    for (let i = 0; i < 2; i++) {
      const it = item(this.mid, rng.range(0, MID_TILE), rng.range(0, MID_TILE));
      const run = rng.range(260, 420);
      pRect(it, -run / 2, -8, run, 16, d.mid, 0.65);
      pRect(it, -run / 2, -8, run, 3, d.midEdge, 0.6);
      for (let p = 0; p < 5; p++) {
        pLine(it, -run / 2 + (run * p) / 5, -8, run / 5, 16, 2, d.midEdge, 0.5);
      }
      pBeam(it, 0, 10, 0, 120, 34, d.glow, 0.05, 0.5);
    }
  }

  // ==========================================================================
  // DRAW
  // ==========================================================================
  /**
   * @param r     the renderer
   * @param run   for sim time, frame parity and the ambience descriptor
   * @param cx,cy the interpolated camera centre, in world space
   */
  draw(r, run, cx, cy) {
    const t = run.time;
    // Flashing is REDUCED, not removed: a sign that is completely static reads
    // as broken rather than as calm. The pulse depth drops to a fifth.
    const flashK = save.data.settings.reduceFlashing ? 0.2 : 1;

    this._floor(r, cx, cy);
    this._ground(r, cx, cy, t, flashK);
    this._tiled(r, this.far, cx, cy, t, flashK);
    for (let i = 0; i < this.fixed.length; i++) this._pinned(r, this.fixed[i], cx, cy, t, flashK);
    if (this.mist) this._tiled(r, this.mist, cx, cy, t, flashK);
    this._tiled(r, this.mid, cx, cy, t, flashK);
    this._boundary(r, cx, cy, t);
    this._ambient(r, run, cx, cy);
    r.setAlpha(1);
  }

  /**
   * The arena floor, clipped to what is actually on screen.
   *
   * The old version filled all 4000x4000 of it every frame. Canvas clips that
   * itself, so it was not a correctness bug — but it is also the one draw in the
   * whole scene whose size is unrelated to the window, and filling the visible
   * intersection instead means the same pixels for a rect the renderer can
   * reason about. Outside the arena stays the clear colour, which is how the
   * boundary reads as an edge and not as a line painted on a floor.
   */
  _floor(r, cx, cy) {
    const b = this.bounds;
    const x0 = Math.max(b.minX, r.cullMinX), x1 = Math.min(b.maxX, r.cullMaxX);
    const y0 = Math.max(b.minY, r.cullMinY), y1 = Math.min(b.maxY, r.cullMaxY);
    if (x1 <= x0 || y1 <= y0) return;
    r.drawRect(x0, y0, x1 - x0, y1 - y0, this.pal.ground || this.pal.bg, 1);
  }

  /**
   * THE GROUND DETAIL LAYER.
   *
   * A cell walk over the visible window, hashed per cell. No list, no storage,
   * identical output for the same cell forever — so the floor does not shimmer
   * when the camera moves, which a per-frame random would do and which is the
   * single most nauseating bug this kind of layer can have.
   *
   * Budgeted at 2-3 primitives per cell. At a 200px cell and a 1280x720 design
   * viewport that is ~35 cells, so ~90 calls, plus the seams.
   *
   * CLIPPED TO THE ARENA, once, for the whole layer. A cell is a fixed size and
   * the arena is not a whole number of them — Stage 7's deck is 240px panels
   * across 4000px — so the last row and column always overhang, and the camera
   * can see up to a full screen past the edge. One save/clip/restore per frame
   * is cheaper and far more robust than clamping every primitive in seven
   * different vocabularies. The FAR and MID layers are deliberately left
   * unclipped: scenery continuing past the boundary is what makes the boundary
   * read as "the floor stops here" rather than "the world stops here".
   */
  _ground(r, cx, cy, t, flashK) {
    const b = this.bounds;
    const cell = this.cell;
    const d = this.def;
    const x0 = Math.max(Math.floor((cx - r.halfW) / cell) * cell, b.minX);
    const y0 = Math.max(Math.floor((cy - r.halfH) / cell) * cell, b.minY);
    const x1 = Math.min(cx + r.halfW + cell, b.maxX);
    const y1 = Math.min(cy + r.halfH + cell, b.maxY);
    if (x1 <= x0 || y1 <= y0) return;
    r.clipRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);

    // Seams first, under everything the cells draw.
    for (let x = x0; x <= x1; x += cell) r.drawLine(x, y0, x, y1, d.seam, 1, 0.30);
    for (let y = y0; y <= y1; y += cell) r.drawLine(x0, y, x1, y, d.seam, 1, 0.30);

    const kind = this.kind;
    for (let y = y0; y < y1; y += cell) {
      for (let x = x0; x < x1; x += cell) {
        const ix = Math.round(x / cell), iy = Math.round(y / cell);
        const h = hash2(ix, iy);
        const a = (h & 255) / 255;
        const bq = ((h >>> 8) & 255) / 255;
        const c = ((h >>> 16) & 255) / 255;
        switch (kind) {
          case 'rooftop':
            // Alternating roof tiles, a drainage channel, and the petals that
            // fall at exactly the rate that makes a confession inevitable.
            if (((ix + iy) & 1) === 0) r.drawRect(x, y, cell, cell, d.tile, 0.55);
            if (a < 0.34) {
              r.drawCircle(x + bq * cell, y + c * cell, 4, d.detail, 0.45);
            }
            if (a > 0.88) r.drawLine(x, y + cell * 0.5, x + cell, y + cell * 0.5, d.seam, 3, 0.35);
            break;

          case 'wet_street':
            // Signage smeared down the wet asphalt, kerb stripes, puddles.
            r.drawRect(x + bq * (cell - 30), y + 6, 24, cell - 12,
                       a < 0.5 ? d.glow : d.detail, 0.055 + c * 0.05);
            if ((iy & 2) === 0) r.drawLine(x, y + 6, x + cell, y + 6, d.seam, 4, 0.40);
            if (a > 0.78) {
              const rad = 22 + c * 26;
              r.drawCircle(x + cell * 0.5, y + cell * 0.5, rad, d.mid, 0.30);
              r.strokeCircle(x + cell * 0.5, y + cell * 0.5, rad, d.detail, 1.5, 0.18);
            }
            break;

          case 'ruins': {
            // Cracked flagstones and drifting ash.
            const mx = x + cell * 0.5, my = y + cell * 0.5;
            const ang = a * 6.283;
            r.drawLine(mx - Math.cos(ang) * cell * 0.4, my - Math.sin(ang) * cell * 0.4,
                       mx + Math.cos(ang) * cell * 0.3, my + Math.sin(ang) * cell * 0.3,
                       d.seam, 2, 0.45);
            if (bq > 0.6) {
              r.drawLine(mx, my, mx + Math.cos(ang + 1.9) * cell * 0.3,
                         my + Math.sin(ang + 1.9) * cell * 0.3, d.seam, 2, 0.3);
            }
            if (c > 0.7) r.drawRect(x + 10, y + bq * cell * 0.6, cell - 20, 16, d.detail, 0.10);
            break;
          }

          case 'village':
            // Packed earth, and the plank roofs that are also the roads.
            if (a < 0.45) {
              const pw = cell - 24;
              r.drawRect(x + 12, y + 12, pw, cell - 24, d.detail, 0.16);
              for (let p = 1; p < 4; p++) {
                r.drawLine(x + 12, y + 12 + (cell - 24) * (p / 4), x + 12 + pw,
                           y + 12 + (cell - 24) * (p / 4), d.seam, 2, 0.35);
              }
            } else if (bq > 0.72) {
              r.drawCircle(x + bq * cell, y + c * cell, 6 + c * 5, d.tile, 0.6);
            }
            break;

          case 'halls': {
            // Tatami. Mats are 2:1 and they alternate orientation, which is the
            // entire visual grammar of a tatami room.
            const half = cell * 0.5;
            if (((ix + iy) & 1) === 0) {
              r.drawRect(x + 3, y + 3, cell - 6, half - 6, d.tile, 0.75);
              r.strokeRect(x + 3, y + 3, cell - 6, half - 6, d.seam, 2, 0.55);
              r.drawRect(x + 3, y + half + 3, cell - 6, half - 6, d.tile, 0.75);
            } else {
              r.drawRect(x + 3, y + 3, half - 6, cell - 6, d.tile, 0.75);
              r.strokeRect(x + 3, y + 3, half - 6, cell - 6, d.seam, 2, 0.55);
              r.drawRect(x + half + 3, y + 3, half - 6, cell - 6, d.tile, 0.75);
            }
            break;
          }

          case 'reef': {
            // Sand ripples, and the caustics the surface throws down.
            const my = y + cell * (0.3 + a * 0.4);
            r.drawArc(x + cell * 0.5, my + cell * 0.5, cell * 0.6, 3.6, 5.8, d.seam, 3, 0.40);
            r.drawArc(x + cell * 0.5, my + cell * 0.75, cell * 0.5, 3.7, 5.7, d.seam, 2, 0.25);
            if (bq > 0.62) {
              const pulse = 0.5 + 0.5 * Math.sin(t * 1.4 + a * 6.283);
              r.drawArc(x + cell * 0.5, my, cell * 0.45, 3.5, 5.9, d.detail, 2,
                        (0.10 + pulse * 0.14 * flashK));
            }
            break;
          }

          case 'zenith':
            // Polished deck panels, a few of them lit from underneath.
            r.strokeRect(x + 4, y + 4, cell - 8, cell - 8, d.seam, 2, 0.40);
            if (a > 0.66) {
              const pulse = 0.5 + 0.5 * Math.sin(t * 1.1 + bq * 6.283);
              r.drawRect(x + 4, y + cell * 0.5 - 3, cell - 8, 6, d.detail,
                         0.06 + pulse * 0.07 * flashK);
            }
            break;
        }
      }
    }
    r.unclip();
  }

  /**
   * Draw one tiled layer. The outer loop is over TILES, the middle over items,
   * and the parts list is only touched for an item that survived its cull test.
   */
  _tiled(r, lay, cx, cy, t, flashK) {
    const k = lay.k, tile = lay.tile;
    // What range of ANCHORS can land inside the view at this parallax rate?
    // drawn = cx + (anchor - cx) * k, so anchor = cx + (drawn - cx) / k.
    const reach = Math.max(r.halfW, r.halfH) / k + 400;
    const shift = lay.drift ? (t * lay.drift) % tile : 0;
    const t0x = Math.floor((cx - reach + shift) / tile);
    const t1x = Math.floor((cx + reach + shift) / tile);
    const t0y = Math.floor((cy - reach) / tile);
    const t1y = Math.floor((cy + reach) / tile);
    const items = lay.items;

    for (let tj = t0y; tj <= t1y; tj++) {
      for (let ti = t0x; ti <= t1x; ti++) {
        const ox = ti * tile - shift, oy = tj * tile;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const dx = cx + (ox + it.x - cx) * k;
          const dy = cy + (oy + it.y - cy) * k;
          if (dx + it.ex < r.cullMinX || dx - it.ex > r.cullMaxX ||
              dy + it.ey < r.cullMinY || dy - it.ey > r.cullMaxY) continue;
          this._parts(r, it, dx, dy, t, flashK);
        }
      }
    }
  }

  /** A pinned item — one moon, one wall, one aurora. */
  _pinned(r, it, cx, cy, t, flashK) {
    const dx = cx + (it.x - cx) * it.k;
    const dy = cy + (it.y - cy) * it.k;
    if (dx + it.ex < r.cullMinX || dx - it.ex > r.cullMaxX ||
        dy + it.ey < r.cullMinY || dy - it.ey > r.cullMaxY) return;
    this._parts(r, it, dx, dy, t, flashK);
  }

  /** The one place a backdrop primitive is actually issued. */
  _parts(r, it, dx, dy, t, flashK) {
    const parts = it.parts;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      // A pulse never reaches zero: alpha 0 draws are what the render smoke test
      // calls a black screen, and a sign that blinks fully off reads as a bug.
      const a = p.pulse
        ? p.alpha * (1 - p.pulse * flashK * 0.5 * (1 - Math.sin(t * 1.7 + i * 1.31)))
        : p.alpha;
      const x = dx + p.x, y = dy + p.y;
      switch (p.t) {
        case RECT: r.drawRect(x, y, p.w, p.h, p.color, a); break;
        case ROUND: r.drawRoundRect(x, y, p.w, p.h, p.r, p.color, a); break;
        case CIRCLE: r.drawCircle(x, y, p.r, p.color, a); break;
        case RING: r.strokeCircle(x, y, p.r, p.color, p.width, a); break;
        case LINE: r.drawLine(x, y, x + p.w, y + p.h, p.color, p.width, a); break;
        case BEAM: r.drawBeam(x, y, x + p.w, y + p.h, p.width, p.color, a); break;
        case FRAME: r.strokeRect(x, y, p.w, p.h, p.color, p.width, a); break;
      }
    }
  }

  /**
   * THE ARENA EDGE.
   *
   * An invisible wall feels broken, so this is deliberately louder than the old
   * single 6px stroke: a hard rule on the boundary itself, a hatched warning
   * band on the INSIDE of it (the side you are on), and corner brackets. The
   * band is the part that matters — a line at the extreme edge of the screen is
   * exactly where a player is not looking when they back into it.
   */
  _boundary(r, cx, cy, t) {
    const b = this.bounds;
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const accent = this.pal.accent || '#ff2d95';
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);

    r.strokeRect(b.minX, b.minY, w, h, accent, 7, 0.55);
    r.strokeRect(b.minX + 26, b.minY + 26, w - 52, h - 52, accent, 2, 0.18 + pulse * 0.08);

    // Hatching, but only along the edges the camera can currently see — four
    // full runs of ticks across a 4000px arena is 160 lines nobody looks at.
    const step = 90;
    const near = 340;
    if (cx - r.halfW < b.minX + near || cx + r.halfW > b.maxX - near ||
        cy - r.halfH < b.minY + near || cy + r.halfH > b.maxY - near) {
      const y0 = Math.max(b.minY, cy - r.halfH), y1 = Math.min(b.maxY, cy + r.halfH);
      const x0 = Math.max(b.minX, cx - r.halfW), x1 = Math.min(b.maxX, cx + r.halfW);
      if (cx - r.halfW < b.minX + near) {
        for (let y = Math.floor(y0 / step) * step; y < y1; y += step) {
          r.drawLine(b.minX, y, b.minX + 24, y + 24, accent, 2, 0.30);
        }
      }
      if (cx + r.halfW > b.maxX - near) {
        for (let y = Math.floor(y0 / step) * step; y < y1; y += step) {
          r.drawLine(b.maxX, y, b.maxX - 24, y + 24, accent, 2, 0.30);
        }
      }
      if (cy - r.halfH < b.minY + near) {
        for (let x = Math.floor(x0 / step) * step; x < x1; x += step) {
          r.drawLine(x, b.minY, x + 24, b.minY + 24, accent, 2, 0.30);
        }
      }
      if (cy + r.halfH > b.maxY - near) {
        for (let x = Math.floor(x0 / step) * step; x < x1; x += step) {
          r.drawLine(x, b.maxY, x + 24, b.maxY - 24, accent, 2, 0.30);
        }
      }
    }
  }

  /**
   * Ambient motes.
   *
   * Moved here from runScene along with a fix: it used Math.random() for the
   * spawn position. Cosmetic or not, the house rule is that anything the
   * simulation does not own draws from fxRng, and "it is only a particle" is how
   * a Math.random() ends up somewhere that matters later.
   */
  _ambient(r, run, cx, cy) {
    const amb = this.ambience;
    if (!amb || (run.frameParity & 3) !== 0) return;
    MOTE_OPTS.shape = amb.particleShape || 'circle';
    particles.drift(
      cx + fxRng.signed() * r.halfW,
      cy + fxRng.signed() * r.halfH,
      amb.particleColor || this.pal.accent,
      MOTE_OPTS);
  }
}

/**
 * The mote options bag, as a MODULE-LEVEL CONSTANT that is mutated in place
 * rather than rebuilt — this is called every fourth frame for the whole run and
 * an object literal here is 15 allocations a second for the garbage collector to
 * find in the middle of a horde.
 */
const MOTE_OPTS = { life: 2.2, size: 0.35, speed: 12, shape: 'circle' };

/**
 * What a stage gets if its `backdrop` key is missing or unknown. data/index.js
 * validate() reports that as a problem; this is what keeps it a dull stage
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
