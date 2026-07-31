// Uniform-grid spatial hash. Every broadphase in the game goes through this —
// never an O(n^2) loop. Cell size ~64px (CONFIG.SPATIAL_CELL).
//
// Storage is a flat Int32Array bucket structure rebuilt every tick:
//   - `cellStart[c]` .. `cellStart[c+1]` indexes into `entries`
//   - `entries[k]` is an index into the caller's dense entity array
// Rebuilding from scratch each tick is cheaper than incremental updates at our
// entity counts and has zero allocation after construction.

import { CONFIG } from './config.js';

export class SpatialHash {
  constructor(worldW, worldH, cell = CONFIG.SPATIAL_CELL, maxEntries = 4096) {
    this.cell = cell;
    this.invCell = 1 / cell;
    this.resize(worldW, worldH);
    this.entries = new Int32Array(maxEntries);
    this.maxEntries = maxEntries;
    this.counts = new Int32Array(this.cols * this.rows);
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
    this.cursor = new Int32Array(this.cols * this.rows);
    this.n = 0;
    // Query scratch — reused, never reallocated.
    this._resultIdx = new Int32Array(1024);
    this._resultCount = 0;
  }

  resize(worldW, worldH) {
    this.w = worldW; this.h = worldH;
    this.cols = Math.max(1, Math.ceil(worldW * this.invCell));
    this.rows = Math.max(1, Math.ceil(worldH * this.invCell));
    const nc = this.cols * this.rows;
    if (!this.counts || this.counts.length !== nc) {
      this.counts = new Int32Array(nc);
      this.cellStart = new Int32Array(nc + 1);
      this.cursor = new Int32Array(nc);
    }
  }

  _cellOf(x, y) {
    let cx = (x * this.invCell) | 0;
    let cy = (y * this.invCell) | 0;
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  /**
   * Rebuild from a dense entity array. Two passes: count, then scatter.
   * @param {Array} items dense array of entities with .x/.y
   * @param {number} count how many of them are live
   */
  build(items, count) {
    const nc = this.cols * this.rows;
    this.counts.fill(0, 0, nc);
    if (count > this.maxEntries) {
      this.entries = new Int32Array(Math.max(count * 2, this.maxEntries * 2));
      this.maxEntries = this.entries.length;
    }
    this.n = count;
    // pass 1 — histogram
    for (let i = 0; i < count; i++) {
      const e = items[i];
      this.counts[this._cellOf(e.x, e.y)]++;
    }
    // prefix sum
    let acc = 0;
    for (let c = 0; c < nc; c++) {
      this.cellStart[c] = acc;
      this.cursor[c] = acc;
      acc += this.counts[c];
    }
    this.cellStart[nc] = acc;
    // pass 2 — scatter
    for (let i = 0; i < count; i++) {
      const e = items[i];
      const c = this._cellOf(e.x, e.y);
      this.entries[this.cursor[c]++] = i;
    }
  }

  /**
   * Collect indices within `radius` of (x, y) into the internal result buffer.
   * Returns the count; read via `hash.resultAt(k)`. Cell-level only — the caller
   * still does the exact circle test. That is the point of a broadphase.
   */
  query(x, y, radius) {
    const r = radius;
    let cx0 = (((x - r) * this.invCell) | 0), cx1 = (((x + r) * this.invCell) | 0);
    let cy0 = (((y - r) * this.invCell) | 0), cy1 = (((y + r) * this.invCell) | 0);
    if (cx0 < 0) cx0 = 0; if (cy0 < 0) cy0 = 0;
    if (cx1 >= this.cols) cx1 = this.cols - 1;
    if (cy1 >= this.rows) cy1 = this.rows - 1;

    let out = this._resultIdx;
    let n = 0;
    const cap = out.length;
    for (let cy = cy0; cy <= cy1; cy++) {
      const row = cy * this.cols;
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = row + cx;
        const s = this.cellStart[c], e = this.cellStart[c + 1];
        for (let k = s; k < e; k++) {
          if (n >= cap) {
            // Grow once and keep going rather than silently truncating.
            const bigger = new Int32Array(cap * 2);
            bigger.set(out);
            this._resultIdx = out = bigger;
          }
          out[n++] = this.entries[k];
        }
      }
    }
    this._resultCount = n;
    return n;
  }

  /**
   * SOFT SEPARATION, RESOLVED INSIDE THE HASH.
   *
   * `query` materialises every index in the covered cells before the caller has
   * looked at the first one. That is exactly right for a hit test, which has to
   * see everything in range or it misses, and exactly wrong for a SAMPLE: the
   * crowd-separation pass wants six neighbours and does not care which six, and
   * in a fifty-strong pack of fast swarm mobs the GATHER is the entire cost.
   * Measured on 700 enemies squeezed into a 200px disc: 44,554 indices written
   * per tick to use six of them per enemy, and 85,482 at 140px.
   *
   * So the exact test moves in here and the walk stops the moment it has
   * `maxNeighbours`. Same cells in the same order, same rejection tests, same
   * accumulation order â€” the displacement is bit-identical to the old
   * query-then-filter loop (verified: max position delta 0.0 across every
   * density from 1400px down to 140px) â€” but nothing is written to the result
   * buffer and the cost stops scaling with density. 0.263ms -> 0.191ms at 200px,
   * 0.353ms -> 0.204ms at 140px.
   *
   * Writes the summed unit push into `out.x`/`out.y`; returns how many
   * neighbours contributed. 0 means `out` was not written.
   */
  separationPush(items, self, radius, maxNeighbours, out) {
    const r2 = radius * radius;
    const x = self.x, y = self.y;
    let cx0 = (((x - radius) * this.invCell) | 0), cx1 = (((x + radius) * this.invCell) | 0);
    let cy0 = (((y - radius) * this.invCell) | 0), cy1 = (((y + radius) * this.invCell) | 0);
    if (cx0 < 0) cx0 = 0; if (cy0 < 0) cy0 = 0;
    if (cx1 >= this.cols) cx1 = this.cols - 1;
    if (cy1 >= this.rows) cy1 = this.rows - 1;
    let sx = 0, sy = 0, c = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      const row = cy * this.cols;
      for (let cx = cx0; cx <= cx1; cx++) {
        const cell = row + cx;
        const s = this.cellStart[cell], e = this.cellStart[cell + 1];
        for (let k = s; k < e; k++) {
          const o = items[this.entries[k]];
          if (o === self || !o.active) continue;
          const dx = x - o.x, dy = y - o.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2 || d2 < 0.01) continue;
          const inv = 1 / Math.sqrt(d2);
          sx += dx * inv; sy += dy * inv;
          if (++c >= maxNeighbours) { out.x = sx; out.y = sy; return c; }
        }
      }
    }
    if (c > 0) { out.x = sx; out.y = sy; }
    return c;
  }

  resultAt(k) { return this._resultIdx[k]; }

  /** How many entities sit in the cell containing (x, y). Used by densestCluster. */
  densityAt(x, y) {
    const c = this._cellOf(x, y);
    return this.cellStart[c + 1] - this.cellStart[c];
  }

  /**
   * Find the fullest occupied cell and write its centre into `out`.
   * Returns the population, or 0 if the grid is empty.
   * This is the `densestCluster` targeting mode.
   */
  densestCell(out, originX, originY, maxRadius) {
    const nc = this.cols * this.rows;
    let best = 0, bestC = -1, bestD2 = Infinity;
    const maxR2 = maxRadius > 0 ? maxRadius * maxRadius : Infinity;
    for (let c = 0; c < nc; c++) {
      const pop = this.cellStart[c + 1] - this.cellStart[c];
      if (pop === 0 || pop < best) continue;
      const cx = (c % this.cols + 0.5) * this.cell;
      const cy = ((c / this.cols) | 0) + 0.5;
      const wy = cy * this.cell;
      const dx = cx - originX, dy = wy - originY;
      const d2 = dx * dx + dy * dy;
      if (d2 > maxR2) continue;
      // Prefer higher population; break ties by proximity so the aim is stable.
      if (pop > best || d2 < bestD2) { best = pop; bestC = c; bestD2 = d2; }
    }
    if (bestC < 0) return 0;
    out.x = (bestC % this.cols + 0.5) * this.cell;
    out.y = (((bestC / this.cols) | 0) + 0.5) * this.cell;
    return best;
  }
}
