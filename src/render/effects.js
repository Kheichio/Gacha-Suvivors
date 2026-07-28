// Animated ability effects. Pooled, capped, allocation-free, sim-time driven.
//
// WHY THIS EXISTS
// ---------------
// Everything an ability could show used to be a SINGLE FRAME. `meleeArc` pushed
// one wedge into `run.overlays`, the scene drew it as a flat pie slice, and the
// next tick cleared it — so a sword swing was a triangle that blinked. `nova`
// fired one particle ring. `dash` dropped eight static dots. Nothing swept,
// nothing expanded, nothing had a wind-up or a follow-through.
//
// The fix is not "more particles". A particle is a dot with a velocity; it can
// never know that it is the leading edge of a blade that is one third of the way
// through its arc. An EFFECT does: it stores its own age and its own lifetime and
// interpolates every number it draws from that pair. That single property — time
// parameterisation — is the entire difference between an animation and a flash.
//
// WHAT AN EFFECT IS
// -----------------
// Sixteen numbers, two colour references and a kind tag. Behaviour variety comes
// from the kind's draw function reading those numbers against `age / life`, not
// from per-instance closures or descriptors. Nothing here allocates after boot.
//
// THIS FILE REGISTERS NO SPRITES, DELIBERATELY.
// Every effect is drawn from renderer primitives (arcs, wedges, beams, discs,
// lines) that already exist. A new atlas visual would have to be a module-level
// constant pre-rastered by the boot pass, and a `rotates` shape at these sizes
// bakes 32 rotation steps and a white twin apiece; a swing that has to look
// different every frame is exactly the case pre-rastering cannot serve. Vector
// primitives cost a few dozen path ops per effect and are free to animate.
//
// DETERMINISM: the only randomness is one `fxRng` draw per spawn, stored as a
// per-instance phase. `fxRng` is the throwaway cosmetic stream — consuming the
// run stream here would desynchronise seeded replays and the balance harness.

import { Pool } from '../core/pool.js';
import { fxRng } from '../core/rng.js';
import { save } from '../core/save.js';
import { TAU, easeOutCubic, mixHex } from '../core/math.js';

/** Hard cap. Oldest is dropped first, exactly like the particle pool. */
const MAX_EFFECTS = 160;

/**
 * VISUAL TIER. `normal` is the base look; `evolved` must read as a DIFFERENT
 * THING at a glance, not the same thing brighter — a counter-rotating second
 * blade, a gold outer rim, a double pulse, spokes that linger.
 */
export const FX_TIER = { NORMAL: 0, EVOLVED: 1 };

const K_SLASH = 0, K_SHOCK = 1, K_BEAM = 2, K_BURST = 3, K_IMPACT = 4, K_AFTER = 5;

const WHITE = '#ffffff';
/** The evolved tier's signature rim colour. One constant, used by every kind. */
const GOLD = '#ffd76a';

const EMPTY = {};

// --- tuning ------------------------------------------------------------------
/** Fraction of a slash's life spent cocking back before the whip-through. */
const WINDUP = 0.17;
/** Trail segments behind a slash's leading edge. */
const SEGS = 5;
/** Beam core ripple, in Hz and in fraction of alpha. */
const FLICKER_HZ = 13;
const FLICKER_AMP = 0.16;

/**
 * Normalise whatever a caller put in `opts.tier` into 0 or 1.
 * Accepts 0/1, 'normal'/'evolved', false/true, or `opts.evolved`.
 */
export function tierOf(opts) {
  const o = opts || EMPTY;
  const t = o.tier;
  if (t === undefined || t === null) return o.evolved ? 1 : 0;
  if (t === 'evolved' || t === 1 || t === true) return 1;
  return 0;
}

/**
 * A brightened twin of a colour, cached forever. Mixing allocates a string, so
 * it happens once per distinct colour and never inside a draw.
 */
const HOT = new Map();
function hotOf(color) {
  if (typeof color !== 'string' || color.charCodeAt(0) !== 35 || color.length < 7) return WHITE;
  let h = HOT.get(color);
  if (!h) { h = mixHex(color, WHITE, 0.55); HOT.set(color, h); }
  return h;
}

function makeEffect() {
  return {
    active: false, _i: 0,
    kind: 0, tier: 0,
    x: 0, y: 0, x1: 0, y1: 0,
    a0: 0, arc: 1, spin: 1,
    r0: 0, r1: 0, w0: 2,
    age: 0, pAge: 0, life: 0.3,
    alpha: 1, count: 10, phase: 0, extra: 0,
    color: WHITE, color2: WHITE,
  };
}

function resetEffect(e) { e.color = WHITE; e.color2 = WHITE; }

const finite = (v) => typeof v === 'number' && v - v === 0;

export class EffectSystem {
  constructor(max = MAX_EFFECTS) {
    this.pool = new Pool(makeEffect, resetEffect, Math.min(48, max), max, true);
    this.max = max;
  }

  _take() {
    if (this.pool.count >= this.max) this.pool.releaseOldest();
    return this.pool.spawn();
  }

  /** Shared spawn spine: geometry validation, tier, colours, phase, lifetime. */
  _begin(kind, x, y, color, o, defaultLife) {
    if (!finite(x) || !finite(y)) return null;
    const e = this._take();
    if (!e) return null;
    e.kind = kind;
    e.tier = tierOf(o);
    e.x = x; e.y = y;
    e.x1 = x; e.y1 = y;
    e.a0 = 0; e.arc = 1; e.spin = 1;
    e.r0 = 0; e.r1 = 0; e.w0 = 2;
    e.count = 10; e.extra = 0;
    e.age = 0; e.pAge = 0;
    e.life = o.life > 0 ? o.life : defaultLife;
    e.alpha = o.alpha > 0 ? o.alpha : 1;
    e.color = (typeof color === 'string' && color) ? color : WHITE;
    e.color2 = o.color2 || (e.tier ? GOLD : hotOf(e.color));
    // ONE cosmetic random per spawn, from the throwaway stream.
    e.phase = fxRng.raw() * TAU;
    return e;
  }

  /**
   * THE SWING. The single most-used effect in the game.
   *
   * The wedge is not stamped: the blade cocks back, whips through `arc` over its
   * life, and drags a tapering trail behind a bright leading edge. `opts.sweep`
   * (+1 / -1) picks the direction so a combo alternates instead of repeating.
   *
   * @param {number} angle  centre of the cone, radians
   * @param {number} arc    total angular width, radians
   * @param {number} radius reach in world px
   */
  slash(x, y, angle, arc, radius, color, opts) {
    const o = opts || EMPTY;
    if (!finite(angle) || !(radius > 0)) return null;
    const e = this._begin(K_SLASH, x, y, color, o, 0.24);
    if (!e) return null;
    e.a0 = angle;
    e.arc = finite(arc) && Math.abs(arc) > 0.03 ? Math.abs(arc) : 0.7;
    e.r0 = radius;
    e.spin = o.sweep < 0 ? -1 : 1;
    e.w0 = o.width > 0 ? o.width : Math.max(3, radius * 0.15);
    return e;
  }

  /**
   * AN EXPANDING RING. Grows from a small radius to `radius` over its life,
   * thinning and fading as it goes. `opts.double` (implied by the evolved tier)
   * chases it with a second, offset pulse.
   */
  shockwave(x, y, radius, color, opts) {
    const o = opts || EMPTY;
    if (!(radius > 0)) return null;
    const e = this._begin(K_SHOCK, x, y, color, o, 0.42);
    if (!e) return null;
    e.r0 = o.from > 0 ? o.from : radius * 0.18;
    e.r1 = radius;
    e.w0 = o.width > 0 ? o.width : Math.max(3, radius * 0.10);
    e.count = o.spokes > 2 ? (o.spokes | 0) : 12;
    e.extra = (o.double || e.tier) ? 1 : 0;
    return e;
  }

  /** A channelled beam: soft outer, body, white-hot core, ripple, fade-out. */
  beam(x0, y0, x1, y1, width, color, opts) {
    const o = opts || EMPTY;
    if (!finite(x1) || !finite(y1)) return null;
    const e = this._begin(K_BEAM, x0, y0, color, o, 0.22);
    if (!e) return null;
    e.x1 = x1; e.y1 = y1;
    e.w0 = width > 0 ? width : 6;
    return e;
  }

  /** Radial spokes flung outward — the "something just went off here" read. */
  burstRing(x, y, radius, color, opts) {
    const o = opts || EMPTY;
    if (!(radius > 0)) return null;
    const e = this._begin(K_BURST, x, y, color, o, 0.34);
    if (!e) return null;
    e.r0 = radius * 0.28;
    e.r1 = radius;
    e.a0 = finite(o.angle) ? o.angle : 0;
    const n = o.spokes | 0;
    e.count = n >= 3 ? (n > 32 ? 32 : n) : 12;
    e.w0 = o.width > 0 ? o.width : Math.max(2, radius * 0.05);
    return e;
  }

  /** Hit feedback: a core flash, radial spikes and a ring, all in ~0.2s. */
  impact(x, y, color, opts) {
    const o = opts || EMPTY;
    const e = this._begin(K_IMPACT, x, y, color, o, 0.22);
    if (!e) return null;
    e.r0 = o.size > 0 ? o.size : 16;
    return e;
  }

  /** A dash ghost: a fading silhouette with a streak pointing back down the path. */
  afterimage(x, y, angle, size, color, opts) {
    const o = opts || EMPTY;
    const e = this._begin(K_AFTER, x, y, color, o, 0.30);
    if (!e) return null;
    e.a0 = finite(angle) ? angle : 0;
    e.r0 = size > 0 ? size : 14;
    return e;
  }

  update(dt) {
    const items = this.pool.items;
    for (let i = 0; i < this.pool.count; i++) {
      const e = items[i];
      e.pAge = e.age;
      e.age += dt;
      if (e.age >= e.life) { this.pool.release(e); i--; }
    }
  }

  /**
   * One additive pass. `alpha` is the render interpolation factor, applied to
   * the effect's AGE — which is what keeps a sweep silky at 144Hz instead of
   * stepping once per 60Hz sim tick.
   */
  draw(r, alpha) {
    const n = this.pool.count;
    if (n === 0) return;
    const items = this.pool.items;
    // Photosensitivity floor: the beam ripple is the only fast oscillation here,
    // and `reduceFlashing` takes it to zero rather than merely slowing it.
    const s = save.data && save.data.settings;
    flick = (s && s.reduceFlashing) ? 0 : FLICKER_AMP;

    r.setComposite('lighter');
    for (let i = 0; i < n; i++) {
      const e = items[i];
      const age = e.pAge + (e.age - e.pAge) * alpha;
      const t = age <= 0 ? 0 : (age >= e.life ? 1 : age / e.life);
      switch (e.kind) {
        case K_SLASH:  drawSlash(r, e, t); break;
        case K_SHOCK:  drawShock(r, e, t); break;
        case K_BEAM:   drawBeam(r, e, t, age); break;
        case K_BURST:  drawBurst(r, e, t); break;
        case K_IMPACT: drawImpact(r, e, t); break;
        case K_AFTER:  drawAfter(r, e, t); break;
      }
    }
    r.setComposite('source-over');
    r.setAlpha(1);
  }

  clear() { this.pool.clear(); }
  get count() { return this.pool.count; }
}

/** Beam ripple amplitude for this frame. Module-level so draw never allocates. */
let flick = FLICKER_AMP;

// --- primitives --------------------------------------------------------------
// `ctx.arc` sweeps from the LOWER angle to the higher one; handing it a reversed
// pair silently draws the long way round the circle, which is how a 40-degree
// swing becomes a 320-degree one. Both helpers order their arguments.

function band(r, x, y, rad, a, b, color, w, al) {
  if (!(rad > 0) || !(w > 0.05) || !(al > 0.004)) return;
  const A = al > 1 ? 1 : al;
  if (a <= b) r.drawArc(x, y, rad, a, b, color, w, A);
  else r.drawArc(x, y, rad, b, a, color, w, A);
}

function pie(r, x, y, rad, a, b, color, al) {
  if (!(rad > 0) || !(al > 0.004)) return;
  const A = al > 1 ? 1 : al;
  if (a <= b) r.drawWedge(x, y, rad, a, b, color, A);
  else r.drawWedge(x, y, rad, b, a, color, A);
}

function disc(r, x, y, rad, color, al) {
  if (!(rad > 0.2) || !(al > 0.004)) return;
  r.drawCircle(x, y, rad, color, al > 1 ? 1 : al);
}

function hoop(r, x, y, rad, color, w, al) {
  if (!(rad > 0.2) || !(w > 0.05) || !(al > 0.004)) return;
  r.strokeCircle(x, y, rad, color, w, al > 1 ? 1 : al);
}

function streak(r, x0, y0, x1, y1, color, w, al) {
  if (!(w > 0.05) || !(al > 0.004)) return;
  r.drawLine(x0, y0, x1, y1, color, w, al > 1 ? 1 : al);
}

// --- the kinds ---------------------------------------------------------------

/**
 * THE SWING.
 *
 * Three things make this read as a blade rather than a shape:
 *   1. the wind-up — the leading edge cocks BACKWARD for the first sixth of the
 *      life, so the whip-through has something to whip out of;
 *   2. the trail — five bands behind the head, each thinner, dimmer and very
 *      slightly closer in, which is what sells rotational speed;
 *   3. the swept pie only ever covers the part of the arc already travelled, so
 *      the damaged area reveals itself instead of appearing all at once.
 */
function drawSlash(r, e, t) {
  const fade = 1 - t * t;
  if (fade <= 0.01) return;
  const A = e.alpha * fade;
  const rad = e.r0;
  const spin = e.spin;
  const start = e.a0 - spin * e.arc * 0.5;

  const u = t < WINDUP ? -0.18 * (1 - t / WINDUP)
                       : easeOutCubic((t - WINDUP) / (1 - WINDUP));
  const head = start + spin * e.arc * u;

  // Everything the swing has covered so far.
  pie(r, e.x, e.y, rad * 0.99, start, head, e.color, 0.17 * A);

  const trail = e.arc * (0.62 - 0.30 * t);
  for (let i = 0; i < SEGS; i++) {
    const f = i / SEGS;
    const s0 = head - spin * trail * ((i + 1) / SEGS);
    const s1 = head - spin * trail * (i / SEGS);
    band(r, e.x, e.y, rad * (0.995 - f * 0.05), s0, s1,
         e.color, e.w0 * (1 - f * 0.78), A * (1 - f) * 0.9);
  }

  // The leading edge and the blade behind it.
  band(r, e.x, e.y, rad, head - spin * 0.10, head, e.color2, e.w0 * 1.25, A * 1.15);
  const c = Math.cos(head), s = Math.sin(head);
  streak(r, e.x + c * rad * 0.30, e.y + s * rad * 0.30,
         e.x + c * rad * 1.04, e.y + s * rad * 1.04,
         e.color2, e.w0 * 0.70, A * 0.85);

  if (!e.tier) return;

  // EVOLVED: a SECOND blade running the other way, a gold rim outside the reach
  // and a bright inner rail. Two crossing arcs is a different silhouette, which
  // is the point — an evolution has to be recognisable in one frame.
  const head2 = e.a0 + spin * e.arc * 0.5 - spin * e.arc * u;
  for (let i = 0; i < 3; i++) {
    const f = i / 3;
    const s0 = head2 + spin * trail * ((i + 1) / 3);
    const s1 = head2 + spin * trail * (i / 3);
    band(r, e.x, e.y, rad * (0.80 - f * 0.04), s0, s1,
         GOLD, e.w0 * 0.55 * (1 - f * 0.7), A * (1 - f) * 0.8);
  }
  band(r, e.x, e.y, rad * 1.10, start, head, GOLD, 2.4, A * 0.65);
  band(r, e.x, e.y, rad * 0.52, start, head, e.color2, 1.8, A * 0.45);
  disc(r, e.x + c * rad, e.y + s * rad, e.w0 * 0.62 * (0.6 + fade * 0.6), WHITE, A * 0.9);
  const c2 = Math.cos(head2), s2 = Math.sin(head2);
  disc(r, e.x + c2 * rad * 0.8, e.y + s2 * rad * 0.8, e.w0 * 0.4, GOLD, A * 0.8);
}

/** One expanding, thinning, fading ring. Shared by the pulse and its echo. */
function pulse(r, e, tt, amp) {
  if (tt <= 0 || tt >= 1) return;
  const k = easeOutCubic(tt);
  const rad = e.r0 + (e.r1 - e.r0) * k;
  const fade = (1 - tt) * amp;
  if (fade <= 0.005) return;
  const w = e.w0 * (1 - tt * 0.82);
  hoop(r, e.x, e.y, rad, e.color, w, fade * 0.85);
  hoop(r, e.x, e.y, rad * 0.93, e.color2, w * 0.42, fade * 0.55);
  if (tt < 0.55) disc(r, e.x, e.y, rad, e.color, fade * 0.10 * (1 - tt / 0.55));
}

function drawShock(r, e, t) {
  pulse(r, e, t, e.alpha);
  // The double pulse: a second ring a quarter of a lifetime behind the first.
  if (e.extra) pulse(r, e, t - 0.24, e.alpha * 0.75);
  if (!e.tier) return;

  const k = easeOutCubic(t);
  const rad = e.r0 + (e.r1 - e.r0) * k;
  const fade = (1 - t) * e.alpha;
  if (fade <= 0.01) return;
  hoop(r, e.x, e.y, rad * 1.07, GOLD, 2.2, fade * 0.6);
  const n = e.count;
  const base = e.phase + t * 1.4;
  const out = 14 + 26 * k;
  for (let i = 0; i < n; i++) {
    const a = base + i * TAU / n;
    const c = Math.cos(a), s = Math.sin(a);
    streak(r, e.x + c * rad, e.y + s * rad,
           e.x + c * (rad + out), e.y + s * (rad + out),
           GOLD, 2.4 * (1 - t), fade * 0.7);
  }
}

function drawBeam(r, e, t, age) {
  const rise = 0.10;
  const A = e.alpha * (t < rise ? 0.35 + 0.65 * (t / rise)
                                : Math.pow(1 - (t - rise) / (1 - rise), 1.3));
  if (A <= 0.01) return;
  const fl = 1 + flick * Math.sin(age * FLICKER_HZ * TAU + e.phase);
  const w = e.w0 * (1 - t * 0.30);
  if (!(w > 0.2)) return;

  r.drawBeam(e.x, e.y, e.x1, e.y1, w * 2.7, e.color, Math.min(1, A * 0.24 * fl));
  r.drawBeam(e.x, e.y, e.x1, e.y1, w * 1.35, e.color, Math.min(1, A * 0.50));
  r.drawBeam(e.x, e.y, e.x1, e.y1, Math.max(1, w * 0.42), e.color2, Math.min(1, A * 0.95 * fl));
  disc(r, e.x, e.y, w * 0.85, e.color2, A * 0.60);
  disc(r, e.x1, e.y1, w * (0.9 + t * 0.9), e.color2, A * 0.45);

  if (!e.tier) return;
  // EVOLVED: two rails flanking the core plus a bright node running its length.
  const dx = e.x1 - e.x, dy = e.y1 - e.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  const nx = -dy / len, ny = dx / len;
  const off = w * 1.15;
  streak(r, e.x + nx * off, e.y + ny * off, e.x1 + nx * off, e.y1 + ny * off, GOLD, 2.2, A * 0.55);
  streak(r, e.x - nx * off, e.y - ny * off, e.x1 - nx * off, e.y1 - ny * off, GOLD, 2.2, A * 0.55);
  disc(r, e.x + dx * t, e.y + dy * t, w * 1.1, WHITE, A * 0.8);
}

function drawBurst(r, e, t) {
  const A = e.alpha * (1 - t);
  if (A <= 0.01) return;
  const k = easeOutCubic(t);
  const span = e.r1 - e.r0;
  const inner = e.r0 + span * k * 0.55;
  const outer = e.r0 + span * k;
  const n = e.count;
  const base = e.a0 + e.phase * 0.02;
  const w = e.w0 * (1 - t * 0.7);
  for (let i = 0; i < n; i++) {
    const a = base + i * TAU / n;
    const c = Math.cos(a), s = Math.sin(a);
    streak(r, e.x + c * inner, e.y + s * inner, e.x + c * outer, e.y + s * outer,
           e.color, w, A * 0.9);
  }
  if (!e.tier) return;
  // EVOLVED: an interleaved gold set that outruns the first, under a thin rim.
  const half = Math.PI / n;
  for (let i = 0; i < n; i++) {
    const a = base + half + i * TAU / n;
    const c = Math.cos(a), s = Math.sin(a);
    streak(r, e.x + c * inner * 1.15, e.y + s * inner * 1.15,
           e.x + c * outer * 1.28, e.y + s * outer * 1.28, GOLD, w * 0.7, A * 0.7);
  }
  hoop(r, e.x, e.y, outer, GOLD, 1.8, A * 0.5);
}

function drawImpact(r, e, t) {
  const A = e.alpha * (1 - t) * (1 - t);
  if (A <= 0.01) return;
  const k = easeOutCubic(t);
  const R = e.r0;
  disc(r, e.x, e.y, R * 0.55 * (1 - t), e.color2, A * 1.2);
  const n = e.tier ? 8 : 4;
  const w = Math.max(1, R * 0.16 * (1 - t));
  const i0 = R * (0.25 + k * 0.35), i1 = R * (0.55 + k * 1.15);
  for (let i = 0; i < n; i++) {
    const a = e.phase + i * TAU / n;
    const c = Math.cos(a), s = Math.sin(a);
    streak(r, e.x + c * i0, e.y + s * i0, e.x + c * i1, e.y + s * i1, e.color, w, A);
  }
  hoop(r, e.x, e.y, R * (0.35 + k * 1.05), e.color, Math.max(0.7, R * 0.10 * (1 - t)), A * 0.7);
  if (e.tier) hoop(r, e.x, e.y, R * (0.35 + k * 1.55), GOLD, 1.8, A * 0.55);
}

function drawAfter(r, e, t) {
  const A = e.alpha * (1 - t);
  if (A <= 0.01) return;
  const R = e.r0 * (1 - t * 0.42);
  if (!(R > 0.3)) return;
  disc(r, e.x, e.y, R, e.color, A * A * 0.34);
  hoop(r, e.x, e.y, R * (1 + t * 0.40), e.color2, 1.6, A * 0.60);
  const c = Math.cos(e.a0), s = Math.sin(e.a0);
  const tail = R * (1.4 + t * 1.6);
  streak(r, e.x - c * R * 0.2, e.y - s * R * 0.2, e.x - c * tail, e.y - s * tail,
         e.color, R * 0.55 * (1 - t), A * 0.30);
  if (!e.tier) return;
  // EVOLVED: the ghosts PERSIST as gold outlines with a spark at the tail.
  hoop(r, e.x, e.y, R * (1 + t * 0.9), GOLD, 1.4, A * 0.5);
  disc(r, e.x - c * tail, e.y - s * tail, R * 0.22 * (1 - t), GOLD, A * 0.7);
}

export const effects = new EffectSystem();
