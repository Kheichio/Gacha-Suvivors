// Sim-time timers and cooldowns.
//
// Everything here counts in SIMULATION seconds, never wall-clock. That is what
// makes the 100x headless harness and the seeded replay produce identical
// results to a real 60Hz session.

/**
 * A repeating interval. `tick(dt)` returns how many periods completed.
 *
 * EPS exists for a real reason: 30 accumulations of 1/60 sum to
 * 0.49999999999999994, not 0.5. Without the tolerance an "every 0.5s" attack
 * fires 3 times in 2 seconds instead of 4, and a 20-minute run silently loses
 * ~1% of every character's DPS to floating-point drift.
 */
const EPS = 1e-9;

export class Interval {
  constructor(period, jitterPhase = 0) {
    this.period = period;
    this.t = period * jitterPhase; // stagger identical timers so they don't spike together
  }
  set(period) { this.period = period; return this; }
  reset(phase = 0) { this.t = this.period * phase; }
  /** Advance; returns the number of completed periods (usually 0 or 1). */
  tick(dt) {
    if (this.period <= 0) return 0;
    this.t += dt;
    if (this.t + EPS < this.period) return 0;
    let n = 0;
    // Cap catch-up so a long pause cannot dump 400 shots in one frame.
    while (this.t + EPS >= this.period && n < 4) { this.t -= this.period; n++; }
    if (this.t > this.period) this.t = 0;
    if (this.t < 0) this.t = 0;
    return n;
  }
  get progress() { return this.period > 0 ? this.t / this.period : 1; }
}

/** A cooldown with optional charges. The escape-move primitive. */
export class Cooldown {
  constructor(duration, charges = 1) {
    this.duration = duration;
    this.maxCharges = charges;
    this.charges = charges;
    this.t = 0;
  }
  configure(duration, charges) {
    this.duration = duration;
    if (charges !== undefined && charges !== this.maxCharges) {
      const gained = charges - this.maxCharges;
      this.maxCharges = charges;
      this.charges = Math.min(charges, this.charges + Math.max(0, gained));
    }
    return this;
  }
  get ready() { return this.charges > 0; }
  /** Progress toward the NEXT charge, 0..1. Drives the radial HUD sweep. */
  get progress() {
    if (this.charges >= this.maxCharges) return 1;
    return this.duration > 0 ? 1 - this.t / this.duration : 1;
  }
  get remaining() { return this.charges >= this.maxCharges ? 0 : this.t; }

  /** Consume a charge. Returns false if none were available. */
  use() {
    if (this.charges <= 0) return false;
    const wasFull = this.charges === this.maxCharges;
    this.charges--;
    if (wasFull) this.t = this.duration;
    return true;
  }
  tick(dt) {
    if (this.charges >= this.maxCharges) { this.t = 0; return; }
    this.t -= dt;
    // Same floating-point tolerance as Interval — a 2s cooldown must be ready
    // after 120 ticks of 1/60, not 121.
    while (this.t <= EPS && this.charges < this.maxCharges) {
      this.charges++;
      this.t += this.duration;
    }
    if (this.charges >= this.maxCharges) this.t = 0;
  }
  /** Fully refund — the Everblade Fragment relic. */
  refill() { this.charges = this.maxCharges; this.t = 0; }
  /** Reduce the remaining wait by `sec`. */
  reduce(sec) {
    this.t -= sec;
    while (this.t <= EPS && this.charges < this.maxCharges) { this.charges++; this.t += this.duration; }
    if (this.charges >= this.maxCharges) this.t = 0;
  }
  reset() { this.charges = this.maxCharges; this.t = 0; }
}

/** A one-shot countdown. `expired` latches once it hits zero. */
export class Countdown {
  constructor(duration = 0) { this.duration = duration; this.t = duration; }
  start(duration) { this.duration = duration; this.t = duration; return this; }
  stop() { this.t = 0; this.duration = 0; }
  get active() { return this.t > 0; }
  get progress() { return this.duration > 0 ? 1 - this.t / this.duration : 1; }
  /** Advance; returns true on the tick it expires (exactly once). */
  tick(dt) {
    if (this.t <= 0) return false;
    this.t -= dt;
    if (this.t <= 0) { this.t = 0; return true; }
    return false;
  }
}

/**
 * A pooled deferred-callback scheduler for sim-time delays ("explode in 0.8s").
 * Fixed capacity, no allocation, and it is cleared with the run.
 */
export class Scheduler {
  constructor(capacity = 512) {
    this.t = new Float32Array(capacity);
    this.fn = new Array(capacity);
    this.a = new Array(capacity);
    this.b = new Array(capacity);
    this.count = 0;
    this.capacity = capacity;
    this.dropped = 0;
  }
  /** Run `fn(a, b)` after `delay` sim-seconds. */
  after(delay, fn, a, b) {
    if (this.count >= this.capacity) { this.dropped++; return false; }
    const i = this.count++;
    this.t[i] = delay; this.fn[i] = fn; this.a[i] = a; this.b[i] = b;
    return true;
  }
  tick(dt) {
    for (let i = 0; i < this.count; i++) {
      this.t[i] -= dt;
      if (this.t[i] > 0) continue;
      const fn = this.fn[i], a = this.a[i], b = this.b[i];
      // swap-and-pop before firing, so a callback may schedule more work safely
      const last = --this.count;
      this.t[i] = this.t[last]; this.fn[i] = this.fn[last];
      this.a[i] = this.a[last]; this.b[i] = this.b[last];
      this.fn[last] = null; this.a[last] = null; this.b[last] = null;
      i--;
      fn(a, b);
    }
  }
  clear() {
    for (let i = 0; i < this.count; i++) { this.fn[i] = null; this.a[i] = null; this.b[i] = null; }
    this.count = 0;
  }
}
