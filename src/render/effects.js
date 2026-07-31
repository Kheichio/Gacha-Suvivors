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
// The three SPRITE kinds at the bottom (`sweepSprite`, `fallSprite`,
// `chainLash`) do not break that rule: the caller hands over an
// ALREADY-REGISTERED atlas Sprite and this file only blits it. They exist
// because three things in the game are not energy and cannot be drawn as energy
// — a scythe swinging through 180 degrees, a lighting truss falling out of the
// ceiling, and a chain. Every one of them is the same object in every frame,
// only somewhere else, which is exactly what pre-rastering IS for. They are
// blitted in a second, SOURCE-OVER pass after the additive one, because an
// object lit additively over a dark stage is a white smear.
//
// `flameCone` is a fourth sprite kind and the one exception to that pass: it is
// blitted with everything else in the ADDITIVE block. A scythe composited
// additively is a white smear, and a flame composited normally is a sticker —
// each is drawn the way the thing it depicts actually behaves. It exists for the
// same reason the props do: a tongue of fire has a hot core, a colour ramp and a
// ragged silhouette, none of which can be assembled out of arcs and wedges, and
// all of which are free once they are baked (see `atlas.flameSprite`).
//
// THE CHAIN IS THE INTERESTING ONE, because the object that repeats is not the
// whole weapon but one LINK PAIR of it, and what has to be animated is not the
// object at all — it is the DELAY between one end of the chain and the other.
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
/** The PROP kinds. All four blit in the second, source-over pass. */
const K_SWEEP = 6, K_FALL = 7, K_CHAIN = 8, K_GHOST = 10;
/** FIRE. A sprite kind too, but drawn additively with the rest of the energy. */
const K_FLAME = 9;
/** How fast the flame sheet cycles, in frames per unit of an effect's life. */
const FLAME_HZ = 34;

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

// --- the chain ---------------------------------------------------------------
// Every number here is a fraction of the effect's OWN LIFE or of its OWN REACH,
// so a 130px lash at level 1 and a 330px ENDLESS LASH move identically, and
// nothing reads wall-clock time.
/** Layout scratch size. A caller asking for more pairs than this is clamped. */
const CHAIN_MAX_PAIRS = 12;
/** How far behind the hand the TIP runs, in fractions of a life. The whip. */
const CHAIN_LAG = 0.22;
/** When the HAND finishes its sweep. Early, so the lagged tip finishes in time. */
const CHAIN_SWEEP_END = 0.62;
/** Lateral slack at mid-chain, as a fraction of the deployed length. */
const CHAIN_SAG = 0.14;

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
    /** An atlas Sprite, for the two sprite kinds. Null for every other kind. */
    sprite: null,
  };
}

function resetEffect(e) { e.color = WHITE; e.color2 = WHITE; e.sprite = null; }

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
    e.sprite = null;
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

  /**
   * A HELD PROP SWUNG THROUGH AN ARC.
   *
   * `slash` draws the ENERGY of a swing. This draws the THING doing the swinging,
   * and the two are meant to be fired together: the sprite is the object, the
   * slash is what the object did to the air. The prop is blitted at the leading
   * edge with a short chain of fading ghosts behind it, each one aligned along
   * its own radius so the haft always points back at the pivot — which is what
   * makes a scythe read as a scythe rather than as a blade sliding sideways.
   *
   * @param sprite an atlas Sprite, already registered. Its +X must be the
   *               direction pointing AWAY from the wielder (see SHAPES.scythe).
   * @param opts   .sweep (+1/-1) .scale .ghosts .life .alpha
   */
  sweepSprite(x, y, angle, arc, radius, sprite, opts) {
    const o = opts || EMPTY;
    if (!sprite || !finite(angle) || !(radius > 0)) return null;
    const e = this._begin(K_SWEEP, x, y, o.color || WHITE, o, 0.26);
    if (!e) return null;
    e.sprite = sprite;
    e.a0 = angle;
    e.arc = finite(arc) && Math.abs(arc) > 0.03 ? Math.abs(arc) : Math.PI;
    e.r0 = radius;
    e.spin = o.sweep < 0 ? -1 : 1;
    e.w0 = o.scale > 0 ? o.scale : 1;
    e.count = o.ghosts >= 0 ? (o.ghosts | 0) : 4;
    return e;
  }

  /**
   * A PROP DROPPING ONTO A POINT from off the top of the screen.
   *
   * Accelerating, spinning, with a shadow on the ground that tightens as it
   * arrives — the shadow is the important half, because it is the only part the
   * player can read while looking at their own feet.
   *
   * @param opts .from (px above the target it starts) .scale .angle .spin .life
   */
  fallSprite(x, y, sprite, opts) {
    const o = opts || EMPTY;
    if (!sprite || !finite(x) || !finite(y)) return null;
    const e = this._begin(K_FALL, x, y, o.color || WHITE, o, 0.4);
    if (!e) return null;
    e.sprite = sprite;
    e.r0 = o.from > 0 ? o.from : 260;
    e.w0 = o.scale > 0 ? o.scale : 1;
    e.a0 = finite(o.angle) ? o.angle : 0;
    e.spin = finite(o.spin) ? o.spin : 0;
    return e;
  }

  /**
   * A BODY THAT IS THERE FOR A MOMENT — a clone, an afterimage, a double.
   *
   * `afterimage` already exists and draws a streak of ENERGY where something
   * passed. This is the other thing: an actual figure, standing at a place,
   * doing something, and then gone. The difference matters for a kit whose whole
   * identity is that there are suddenly more of you — three particle bursts say
   * "something happened here", and three copies of the character say who.
   *
   * It POPS IN and FADES OUT rather than simply fading: a clone that eases in
   * reads as a ghost, and these are supposed to be solid enough to hit things.
   *
   * @param sprite an already-registered atlas Sprite — normally `p.sprite`
   * @param opts   .scale (multiplied by the sprite's own `unit` by the CALLER,
   *               which is the only place that knows the draw convention)
   *               .life .alpha .angle
   */
  ghostSprite(x, y, sprite, opts) {
    const o = opts || EMPTY;
    if (!sprite) return null;
    const e = this._begin(K_GHOST, x, y, o.color || WHITE, o, 0.26);
    if (!e) return null;
    e.sprite = sprite;
    e.a0 = finite(o.angle) ? o.angle : 0;
    e.w0 = o.scale > 0 ? o.scale : 1;
    return e;
  }

  /**
   * A BREATH OF FIRE — one puff of a plume that fills a cone.
   *
   * ONE INSTANCE IS NOT THE WHOLE JET. Its wave front leaves the mouth and races
   * the length of the cone inside its own lifetime, so a caller that spawns one
   * every few frames gets a continuous stream with something visibly travelling
   * down it. A held cone drawn as one static shape has no direction in it, which
   * is the entire reason the wedge it replaces read as a targeting overlay.
   *
   * @param angle  centre of the cone, radians
   * @param arc    total angular width, radians — the SAME number the damage uses
   * @param radius reach in world px, measured from (x, y)
   * @param sprite the flame sheet, from `atlas.flameSprite()`
   * @param opts   .life .alpha .width (a blanket scale on every tongue) .stations
   */
  flameCone(x, y, angle, arc, radius, sprite, opts) {
    const o = opts || EMPTY;
    if (!sprite || !finite(angle) || !(radius > 0)) return null;
    const e = this._begin(K_FLAME, x, y, o.color || WHITE, o, 0.30);
    if (!e) return null;
    e.sprite = sprite;
    e.a0 = angle;
    e.arc = finite(arc) && Math.abs(arc) > 0.03 ? Math.abs(arc) : 0.8;
    e.r0 = radius;
    e.w0 = o.width > 0 ? o.width : 1;
    e.count = o.stations >= 2 ? (o.stations | 0) : 5;
    return e;
  }

  /**
   * A CHAIN, WHIPPED OUT AND REELED BACK IN.
   *
   * `slash` draws the ENERGY of a swing; `sweepSprite` swings one rigid prop
   * through an arc. A chain is neither. It is many small rigid objects only
   * loosely attached to each other, so the thing to animate is not the object,
   * it is the DELAY between one end of it and the other.
   *
   * Three behaviours, every one of them parameterised off `age / life` alone:
   *   PAY OUT   the chain leaves the fist coiled and is flung PAST full reach,
   *             so it cracks instead of simply existing at its own length;
   *   LAG       every link takes the angle the HAND had `CHAIN_LAG * f` of a
   *             lifetime ago (`f` = how far along the chain it sits), so the
   *             swing arrives at the tip LAST and the body trails behind it in
   *             a bow — this is the whole difference between a chain and a
   *             stick, and it is one subtraction;
   *   REEL IN   the deployed length collapses at the end, and because links are
   *             measured back FROM THE TIP they are drawn into the fist in
   *             order rather than all blinking out at once.
   *
   * @param sprite an atlas Sprite of ONE LINK PAIR laid along +X and spanning
   *               the full +/- r of its painter (see SHAPES.chain).
   * @param opts   .pairs how many link pairs a FULL-REACH chain is made of
   *               .scale the sprite scale PER WORLD PIXEL of link length. The
   *                      caller owns it because only the caller knows what
   *                      `size` the pair was baked at — same division of labour
   *                      as the scythe's SCYTHE_UNIT.
   *               .width glow thickness  .sweep +1/-1  .life .alpha .tier .color2
   */
  chainLash(x, y, angle, arc, radius, color, sprite, opts) {
    const o = opts || EMPTY;
    if (!sprite || !finite(angle) || !(radius > 0)) return null;
    const e = this._begin(K_CHAIN, x, y, color, o, 0.30);
    if (!e) return null;
    e.sprite = sprite;
    e.a0 = angle;
    e.arc = finite(arc) && Math.abs(arc) > 0.03 ? Math.abs(arc) : 0.7;
    e.r0 = radius;
    e.spin = o.sweep < 0 ? -1 : 1;
    e.w0 = o.width > 0 ? o.width : Math.max(3, radius * 0.045);
    const n = o.pairs | 0;
    e.count = n < 2 ? 5 : (n > CHAIN_MAX_PAIRS ? CHAIN_MAX_PAIRS : n);
    // `extra` carries the per-pixel link scale for this kind. It is otherwise
    // the shockwave's double-pulse flag, and no effect is ever both.
    e.extra = o.scale > 0 ? o.scale : 1 / Math.max(1, sprite.w);
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
        case K_CHAIN:  drawChainGlow(r, e, t); break;
        case K_FLAME:  drawFlame(r, e, t); break;
      }
    }
    r.setComposite('source-over');
    r.setAlpha(1);

    // SECOND PASS: the sprite kinds, source-over. A solid object blitted
    // additively over a dark stage is a white smear, so a scythe and a falling
    // truss have to be composited normally — and doing it in one block flips the
    // composite twice per frame rather than twice per effect.
    for (let i = 0; i < n; i++) {
      const e = items[i];
      // Fire carries a sprite too, but it was already blitted additively in the
      // pass above. This pass is for the PROPS alone.
      if (!e.sprite || e.kind === K_FLAME) continue;
      const age = e.pAge + (e.age - e.pAge) * alpha;
      const t = age <= 0 ? 0 : (age >= e.life ? 1 : age / e.life);
      if (e.kind === K_SWEEP) drawSweep(r, e, t);
      else if (e.kind === K_FALL) drawFall(r, e, t);
      else if (e.kind === K_CHAIN) drawChainLinks(r, e, t);
      else if (e.kind === K_GHOST) drawGhostBody(r, e, t);
    }
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

// --- the sprite kinds --------------------------------------------------------
// Both blit through `drawSpriteRotated`, which reads frame 0 and rotates on the
// context. That is the RIGHT path for a prop: the atlas gives a `rotates: false`
// visual exactly one frame instead of 32, and a prop turning through 180 degrees
// in a quarter of a second needs a continuous angle anyway, not a snapped step.

/**
 * THE SWING, as an object.
 *
 * Shares `drawSlash`'s wind-up so the prop and the energy arc cock back together
 * — they are one motion drawn twice, and a prop that starts moving a frame before
 * its own slash does reads as two separate things happening at once.
 */
function drawSweep(r, e, t) {
  const fade = 1 - t * t;
  if (fade <= 0.02) return;
  const u = t < WINDUP ? -0.18 * (1 - t / WINDUP)
                       : easeOutCubic((t - WINDUP) / (1 - WINDUP));
  const start = e.a0 - e.spin * e.arc * 0.5;
  const head = start + e.spin * e.arc * u;
  const n = e.count;
  // Back to front, so the leading edge lands on top of its own ghosts.
  for (let i = n; i >= 0; i--) {
    const a = head - e.spin * e.arc * 0.11 * i;
    const al = e.alpha * fade * (i === 0 ? 1 : 0.34 * (1 - i / (n + 1)));
    if (al <= 0.012) continue;
    r.drawSpriteRotated(e.sprite,
                        e.x + Math.cos(a) * e.r0, e.y + Math.sin(a) * e.r0,
                        a, e.w0 * (1 - i * 0.05), al > 1 ? 1 : al, false);
  }
}

/**
 * THE DROP.
 *
 * `t * t` rather than `t`, because a truss that descends at a constant rate
 * looks like it is being lowered on a winch. The shadow is drawn first and
 * tightens all the way in: it is the only part of this the player can read
 * without looking up.
 */
function drawFall(r, e, t) {
  const k = t * t;
  const drop = e.r0 * (1 - k);
  const A = e.alpha * (t < 0.86 ? 1 : Math.max(0, 1 - (t - 0.86) / 0.14));
  if (A <= 0.012) return;
  const sh = 0.45 + 0.55 * k;
  r.drawCircle(e.x, e.y, e.sprite.w * e.w0 * 0.42 * sh, '#000000', 0.20 + 0.28 * k);
  r.drawSpriteRotated(e.sprite, e.x, e.y - drop,
                      e.a0 + e.spin * t, e.w0, A, false);
}

// --- THE CHAIN ---------------------------------------------------------------

/**
 * HOW FAR THE CHAIN IS PAID OUT, as a fraction of the reach.
 *
 * Coiled at the fist, flung out PAST full reach (the overshoot is the crack),
 * settled back onto the radius the damage actually used, then reeled in. It is
 * deliberately at full length by about a fifth of the life: the cone was
 * resolved on the frame this spawned, and a visual that arrives late is a
 * visual that lies about what was hit.
 *
 * Piecewise and continuous: 1.06 at 0.26, 1.00 at 0.60, 0 at 1.
 */
function chainExtend(tt) {
  if (tt <= 0 || tt >= 1) return 0;
  if (tt < 0.26) { const k = tt / 0.26; return 1.06 * k * (2 - k); }
  if (tt < 0.60) return 1.06 - 0.06 * ((tt - 0.26) / 0.34);
  const k = (tt - 0.60) / 0.40;
  return 1 - k * k;
}

/**
 * THE HAND'S ANGLE through the swing, 0..1 of `arc`.
 *
 * The same cock-back-then-whip-through shape `drawSlash` uses, so a lash and a
 * sword agree about what a swing is — but it finishes at CHAIN_SWEEP_END rather
 * than at the end of the life, because the tip reads this function CHAIN_LAG
 * late and still has to get all the way round before the chain is gone.
 *
 * Evaluated at NEGATIVE times by the links the flick has not reached yet, which
 * is why the wind-up branch clamps: those links simply hang, fully cocked.
 */
function chainSweep(tt) {
  if (tt <= WINDUP) return -0.20 * (1 - (tt > 0 ? tt : 0) / WINDUP);
  const k = (tt - WINDUP) / (CHAIN_SWEEP_END - WINDUP);
  return k >= 1 ? 1 : easeOutCubic(k);
}

// Layout scratch, module level for the same reason every options bag in the
// ability layer is: a weapon that spawns six of these five times a second must
// not allocate. Index 0 is the TIP; the last entry is nearest the fist.
const CHAIN_CX = new Float64Array(CHAIN_MAX_PAIRS + 1);
const CHAIN_CY = new Float64Array(CHAIN_MAX_PAIRS + 1);

/**
 * WHERE EVERY JOINT OF ONE LASH IS, THIS FRAME. Returns how many were written.
 *
 * Joints are stepped BACK FROM THE TIP in fixed world-space intervals, not
 * spread evenly across whatever length is currently deployed, and that one
 * choice is what makes the links TRAVEL. Measured from the tip, every link moves
 * outward as the chain pays out and a new one appears at the fist the moment
 * there is room for it — chain coming off a coil. Spread them evenly instead and
 * the links sit still and stretch, which is a rubber band.
 *
 * On top of the angular lag the chain BOWS: zero at both ends, largest at
 * mid-chain, largest mid-swing, and displaced AGAINST the direction of travel so
 * the belly trails rather than leads. That is the slack a real chain carries,
 * and it is the difference between a curve and a spiral.
 *
 * Called independently by both passes rather than cached between them: the two
 * passes are separated by every other effect in the pool, so one shared buffer
 * would be somebody else's chain by the time the second pass arrived. It is pure
 * and cheap, and being pure is what keeps the two passes agreeing.
 */
function layoutChain(e, t) {
  const R = e.r0;
  const L = R * chainExtend(t);
  if (!(L > 2)) return 0;
  const step = R / e.count;
  const start = e.a0 - e.spin * e.arc * 0.5;
  const bow = -e.spin * CHAIN_SAG * L * (4 * t * (1 - t));
  let n = 0;
  for (let j = 0; j < e.count; j++) {
    const d = L - j * step;
    if (d < step * 0.45) break;             // the rest is still in the fist
    const f = d / R;
    const a = start + e.spin * e.arc * chainSweep(t - CHAIN_LAG * f);
    const off = bow * Math.sin(Math.PI * (d / L));
    const c = Math.cos(a), s = Math.sin(a);
    CHAIN_CX[n] = e.x + c * d - s * off;
    CHAIN_CY[n] = e.y + s * d + c * off;
    n++;
  }
  return n;
}

/**
 * THE ADDITIVE HALF: what the chain did to the air.
 *
 * The faint wedge is the honest part of this — it is the cone `coneDamage`
 * already resolved, at its real radius, from the first frame. Everything else is
 * theatre laid over it, so the wedge stays quiet enough to read as "this is what
 * was inside it" and never bright enough to compete with the iron.
 */
function drawChainGlow(r, e, t) {
  const fade = 1 - t * t;
  if (fade <= 0.01) return;
  const A = e.alpha * fade;
  const start = e.a0 - e.spin * e.arc * 0.5;
  const head = start + e.spin * e.arc * chainSweep(t - CHAIN_LAG);
  pie(r, e.x, e.y, e.r0 * 0.99, start, head, e.color, 0.08 * A);

  const n = layoutChain(e, t);
  if (n === 0) return;
  // A hot spine threaded through the joints, so a chain whose links are a link
  // apart at full stretch still reads as one continuous object.
  let px = e.x, py = e.y;
  for (let j = n - 1; j >= 0; j--) {
    const x = CHAIN_CX[j], y = CHAIN_CY[j];
    streak(r, px, py, x, y, e.color, e.w0 * (0.45 + 0.55 * (1 - j / n)), A * 0.28);
    px = x; py = y;
  }
  // THE TIP: where the weight is, and the only part of a whip that ever
  // actually hits anything.
  disc(r, CHAIN_CX[0], CHAIN_CY[0], e.w0 * (0.9 + fade * 0.8), e.color2, A * 0.70);
  if (!e.tier) return;
  // EVOLVED: a white-hot tip and a gold rim outside the reach.
  disc(r, CHAIN_CX[0], CHAIN_CY[0], e.w0 * 0.50, WHITE, A * 0.85);
  band(r, e.x, e.y, e.r0 * 1.05, start, head, GOLD, 2.2, A * 0.45);
}

/**
 * THE SOURCE-OVER HALF: the iron itself.
 *
 * One pair sprite per GAP between joints, scaled to the gap it has to fill —
 * which is what keeps the links joined through the bow, through the retraction,
 * and across the short stub between the fist and the first joint, none of which
 * are `step` long. Drawn fist-outward so each pair overlaps the one before it
 * and the boundaries read as interlocked rather than butted.
 */
function drawChainLinks(r, e, t) {
  const A = e.alpha * (t < 0.76 ? 1 : 1 - (t - 0.76) / 0.24);
  if (A <= 0.02) return;
  const n = layoutChain(e, t);
  if (n === 0) return;
  const unit = e.extra;
  let px = e.x, py = e.y;
  for (let j = n - 1; j >= 0; j--) {
    const x = CHAIN_CX[j], y = CHAIN_CY[j];
    const dx = x - px, dy = y - py;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0.5) {
      r.drawSpriteRotated(e.sprite, (x + px) * 0.5, (y + py) * 0.5,
                          Math.atan2(dy, dx), len * unit, A > 1 ? 1 : A, false);
    }
    px = x; py = y;
  }
}

/**
 * A CLONE, FOR AS LONG AS IT IS THERE.
 *
 * Popped in over the first eighth of its life and faded out across the rest, so
 * it lands with weight and leaves like smoke. The scale overshoot on arrival is
 * small on purpose — a clone that balloons reads as a summon effect rather than
 * as a person who was already mid-swing when they appeared.
 */
function drawGhostBody(r, e, t) {
  const sp = e.sprite;
  if (!sp) return;
  const pop = t < 0.12 ? t / 0.12 : 1;
  const A = e.alpha * (t < 0.12 ? pop : Math.pow(1 - (t - 0.12) / 0.88, 1.3));
  if (A <= 0.02) return;
  const s = e.w0 * (0.62 + 0.44 * pop);
  r.drawSpriteRotated(sp, e.x, e.y, e.a0, s, A > 1 ? 1 : A, false);
}

/**
 * THE BREATH.
 *
 * Everything here is placed against THE CONE'S OWN GEOMETRY rather than against
 * a shape that merely resembles one: each station sits at a distance down the
 * axis, each lobe at a fraction of the half-angle, and the tongue drawn there is
 * scaled to the width the cone actually has at that distance. The fire therefore
 * FILLS THE HITBOX instead of approximating it, and it widens as the cone widens
 * without anybody maintaining a second set of numbers.
 *
 * Three layers, in the order they are drawn:
 *   1. the plume — stations of one to three tongues, wandering across the cone,
 *      hottest at the root and dimmest at the tip (the ramp itself is baked into
 *      the sprite, so "cooler" is alpha and overlap, never a new gradient);
 *   2. the muzzle — a bright tongue pinned in her mouth that does NOT travel,
 *      because a breath has to look like it is coming out of something;
 *   3. the heat shimmer — two very wide, very dim tongues turning slowly against
 *      each other at the tip, which is as close to a refraction wobble as a 2D
 *      canvas gets for the price of two blits.
 * The rising embers are particles and belong to the caller: they outlive any one
 * puff, so they cannot be owned by one.
 */
function drawFlame(r, e, t) {
  const sp = e.sprite;
  if (!sp || !(sp.w > 0)) return;
  // In hard, out soft: a jet lights instantly and trails away.
  const A = e.alpha * (t < 0.14 ? t / 0.14 : Math.pow(1 - (t - 0.14) / 0.86, 1.4));
  if (A <= 0.012) return;
  // The front leaves fast and decelerates. Linear would be a conveyor belt.
  const front = 0.06 + 0.98 * easeOutCubic(t);
  const half = e.arc * 0.5;
  const spread = Math.sin(half);
  const unit = 1 / sp.w;
  const n = e.count;
  const frame = (t * FLAME_HZ + e.phase * 2) | 0;

  for (let i = 0; i < n; i++) {
    const d = front - i * (0.86 / n);
    if (d <= 0.05 || d > 1.02) continue;
    const dist = d * e.r0;
    const wide = spread * dist;              // the room the cone has here
    const heat = 1 - 0.45 * d;               // and how hot it still is
    const lobes = d < 0.30 ? 1 : d < 0.62 ? 2 : 3;
    for (let k = 0; k < lobes; k++) {
      const u = lobes === 1 ? 0 : (k / (lobes - 1)) * 2 - 1;
      // The licks WANDER across the cone rather than sitting in three lanes.
      const wob = 0.16 * Math.sin(e.phase + d * 9 + k * 2.3 + t * 7);
      const a = e.a0 + (u * 0.74 + wob) * half;
      const size = (wide * 1.9 / lobes + e.r0 * 0.10) * e.w0;
      if (!(size > 1)) continue;
      r.drawSpriteRotated(sp, e.x + Math.cos(a) * dist, e.y + Math.sin(a) * dist,
                          a, size * unit,
                          Math.min(1, A * heat * (lobes === 1 ? 1 : 0.82)),
                          false, frame + i * 3 + k);
    }
  }

  const m = (e.r0 * 0.13 + 10) * e.w0;
  r.drawSpriteRotated(sp, e.x, e.y, e.a0, m * unit, Math.min(1, A * 1.15), false, frame);

  const tipD = e.r0 * (0.86 + 0.06 * Math.sin(e.phase + t * 5));
  const tw = spread * tipD * 2.6 * e.w0;
  const swirl = e.phase + t * 2.2;
  r.drawSpriteRotated(sp, e.x + Math.cos(e.a0) * tipD, e.y + Math.sin(e.a0) * tipD,
                      e.a0 + 0.22 * Math.sin(swirl), tw * unit, A * 0.16, false, frame + 2);
  r.drawSpriteRotated(sp, e.x + Math.cos(e.a0) * tipD * 0.92, e.y + Math.sin(e.a0) * tipD * 0.92,
                      e.a0 - 0.22 * Math.sin(swirl * 0.7), tw * 0.80 * unit, A * 0.12, false, frame + 5);
}

export const effects = new EffectSystem();
