// Object pools. Zero allocation in the hot loop is a hard rule, not an aspiration.
//
// Every pooled entity has `active` and `_i` (its index in the dense array).
// Iterate with `for (let i = 0; i < pool.count; i++)` over `pool.items` — the
// live entities are always the first `count` slots, so iteration is contiguous
// and never touches a dead object.

export class Pool {
  /**
   * @param {() => object} factory  allocates one entity. Called `initial` times
   *                                at boot and never again if `grow` is false.
   * @param {(e:object)=>void} reset  wipes an entity when it is released.
   */
  constructor(factory, reset, initial = 64, max = 100000, grow = true) {
    this.factory = factory;
    this.reset = reset;
    this.max = max;
    this.grow = grow;
    /** Dense array. items[0 .. count-1] are live. */
    this.items = new Array(initial);
    this.count = 0;
    this.capacity = initial;
    /** Diagnostics for the F3 overlay. */
    this.peak = 0;
    this.starved = 0;
    for (let i = 0; i < initial; i++) {
      const e = factory();
      e.active = false;
      e._i = i;
      this.items[i] = e;
    }
  }

  /**
   * Take an entity. Returns null when the pool is exhausted and cannot grow —
   * callers MUST null-check. A silent null is always better than a stutter.
   */
  spawn() {
    if (this.count >= this.capacity) {
      if (!this.grow || this.capacity >= this.max) { this.starved++; return null; }
      this._expand(Math.min(this.max, this.capacity * 2 || 16));
    }
    const e = this.items[this.count];
    e.active = true;
    e._i = this.count;
    this.count++;
    if (this.count > this.peak) this.peak = this.count;
    return e;
  }

  /**
   * Release an entity. Swap-and-pop: the last live entity moves into the freed
   * slot, so `count` shrinks and iteration stays contiguous.
   *
   * Safe to call during a forward `for` loop as long as the caller decrements
   * its index (the standard `if (!e.active) { i--; continue; }` shape).
   */
  release(e) {
    if (!e.active) return;
    e.active = false;
    this.reset(e);
    const i = e._i;
    const last = this.count - 1;
    if (i !== last) {
      const swap = this.items[last];
      this.items[last] = e;
      this.items[i] = swap;
      swap._i = i;
      e._i = last;
    }
    this.count--;
  }

  /** Release everything. Used between runs. */
  clear() {
    for (let i = 0; i < this.count; i++) {
      const e = this.items[i];
      e.active = false;
      this.reset(e);
    }
    this.count = 0;
  }

  /** Release the oldest live entity — the "drop oldest first" particle rule. */
  releaseOldest() {
    if (this.count > 0) this.release(this.items[0]);
  }

  _expand(newCap) {
    for (let i = this.capacity; i < newCap; i++) {
      const e = this.factory();
      e.active = false;
      e._i = i;
      this.items[i] = e;
    }
    this.capacity = newCap;
  }

  get free() { return this.capacity - this.count; }
}

/**
 * A tiny free-list for arrays we need transiently (targeting candidate lists,
 * spatial-hash query results). Avoids `[]` in the hot loop.
 */
export class ArrayPool {
  constructor(initial = 16) {
    this.free = [];
    for (let i = 0; i < initial; i++) this.free.push([]);
  }
  take() {
    const a = this.free.pop() || [];
    a.length = 0;
    return a;
  }
  give(a) {
    if (!a) return;
    a.length = 0;
    if (this.free.length < 256) this.free.push(a);
  }
}

export const scratchArrays = new ArrayPool(32);
