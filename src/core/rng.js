// Seedable RNG. ALL randomness in the game routes through one of two streams.
//
//   run  — seeded per run. Reproducible for debugging and for the sim harness.
//   meta — gacha pulls. Seeded from a PERSISTED call counter, so reloading the
//          page cannot re-roll a pull. See SECTION 6 anti-save-scum.
//
// mulberry32: 32-bit, fast, good enough distribution, and its entire state is a
// single integer — which is what makes the meta stream persistable.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 32-bit hash of a string — for turning a name into a seed. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed = 1, calls = 0) {
    this.seed = seed >>> 0;
    this.calls = 0;
    this._next = mulberry32(this.seed);
    // Replay the persisted call count so the stream resumes exactly where it left off.
    for (let i = 0; i < calls; i++) this.raw();
  }

  /** Restart from a seed, discarding position. */
  reseed(seed, calls = 0) {
    this.seed = seed >>> 0;
    this.calls = 0;
    this._next = mulberry32(this.seed);
    for (let i = 0; i < calls; i++) this.raw();
    return this;
  }

  /** [0, 1). The only entropy source; everything else is built on it. */
  raw() { this.calls++; return this._next(); }

  /** [0, 1) — alias that reads better at call sites. */
  next() { return this.raw(); }

  /** [min, max) float. */
  range(min, max) { return min + this.raw() * (max - min); }

  /** [min, max] integer, inclusive both ends. */
  int(min, max) { return min + ((this.raw() * (max - min + 1)) | 0); }

  /** True with probability p. */
  chance(p) { return this.raw() < p; }

  /** [-1, 1). */
  signed() { return this.raw() * 2 - 1; }

  /** A random angle in radians. */
  angle() { return this.raw() * Math.PI * 2; }

  /** Uniform point on a unit circle, written into out.{x,y}. No allocation. */
  onCircle(out) {
    const a = this.angle();
    out.x = Math.cos(a); out.y = Math.sin(a);
    return out;
  }

  /** Uniform point INSIDE a unit disc (sqrt-corrected), into out.{x,y}. */
  inDisc(out) {
    const a = this.angle();
    const r = Math.sqrt(this.raw());
    out.x = Math.cos(a) * r; out.y = Math.sin(a) * r;
    return out;
  }

  /** A random element. Returns undefined for an empty array. */
  pick(arr) { return arr.length ? arr[(this.raw() * arr.length) | 0] : undefined; }

  /**
   * Weighted pick. `weights[i]` corresponds to `arr[i]`.
   * Returns the index, or -1 if every weight is zero.
   */
  weightedIndex(weights) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    if (total <= 0) return -1;
    let r = this.raw() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** In-place Fisher-Yates. Mutates `arr`, returns it. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (this.raw() * (i + 1)) | 0;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /**
   * Pick `n` distinct elements from `arr` into `out` (an array that gets
   * truncated and refilled). Allocation-free after the first call.
   */
  sample(arr, n, out) {
    out.length = 0;
    const count = Math.min(n, arr.length);
    if (count === arr.length) { for (let i = 0; i < arr.length; i++) out.push(arr[i]); return this.shuffle(out); }
    // Partial selection sampling — fine for the small n we ever use (<= 8).
    for (let i = 0; i < arr.length && out.length < count; i++) {
      const remaining = arr.length - i;
      const needed = count - out.length;
      if (this.raw() < needed / remaining) out.push(arr[i]);
    }
    return out;
  }

  /** Serialise position for the save blob. */
  toJSON() { return { seed: this.seed, calls: this.calls }; }
}

// --- the two streams ---------------------------------------------------------

/** Reseeded at the start of every run. Never persisted. */
export const runRng = new Rng(1);

/** Gacha only. Seed + call count are persisted BEFORE results are shown. */
export const metaRng = new Rng(0x9e3779b9);

/**
 * A throwaway stream for cosmetic randomness that must NOT perturb the run
 * stream (particle jitter, bark selection, idle animation offsets). Keeping this
 * separate is what lets a seed reproduce a run even when the renderer differs.
 */
export const fxRng = new Rng(0xcafebabe);

export function seedRun(seed) {
  runRng.reseed(seed >>> 0);
  fxRng.reseed((seed ^ 0x5bf03635) >>> 0);
  return runRng;
}
