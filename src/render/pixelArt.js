// Procedural pixel-art sprite generator.
//
// This replaces "emoji composited over a coloured blob" with actual sprites:
// chunky, outlined, readable at a glance in a crowd of two hundred, and
// generated entirely in code so the project keeps its zero-asset promise.
//
// HOW IT WORKS
// ------------
// Everything is drawn into a small integer pixel grid (characters 30x42, up to
// 40x54 for the two the briefs load hardest, portraits 40x40, rank-and-file
// enemies 24x28 up to 34x40, bosses up to 64x64) and then blitted at whatever
// scale the world needs with smoothing OFF. That is what makes it read as a
// sprite game rather than as vector art — the pixels stay square.
//
// WHY THE GRID GREW (24x34 -> 30x42, 32x32 -> 40x40)
// --------------------------------------------------
// It used to be that a bigger grid meant a bigger sprite on screen, so detail
// cost legibility. It no longer does: `spriteAtlas.registerPixel` bakes a
// `sprite.unit` that cancels the integer-upscale rounding, and every drawer
// multiplies by it. A finer grid is therefore FREE DETAIL at an unchanged
// on-screen size, and 30x42 is the first size where a face has room for a brow,
// an iris and a mouth at once, a garment can have a hem and a fold, and an
// accessory the size of an earring survives the outline pass.
//
// EVERY COORDINATE IS DERIVED FROM THE GRID (see humanMetrics). The first cut of
// this file pinned the head to y=7 and the boots to y=24, so growing the grid
// only added transparent padding: the figure stayed 20x26 inside a bigger box
// and the fill ratio fell straight through tests/pixelArt.js's 12% floor. Body
// plans scale, which is what lets the grid grow and spend the extra pixels on
// jaw, shoulders, garment, hands and boots instead of air.
//
// Sprites are PARAMETRIC, not hand-drawn grids. A descriptor names a body plan
// and a pile of features:
//
//     { body:'humanoid', hair:'drills', hairColor:'#9fe8ff', outfit:'#5fd6ff',
//       skin:'#ffd9c0', weapon:'trident', ears:'fin', coat:'#3a9fd0',
//       scarf:'#ffe9a3', pauldrons:'#0b3d5c', halo:'#ff7ab8', wings:'feather',
//       tails:4, aura:'#ffd76a' }
//
// and the builder assembles hair (back mass, crown and front fringe as separate
// layers), head, face, torso, coat, arms, hands, legs, boots, headgear, trinkets,
// wings, tails, aura and weapon, then outlines the finished silhouette. 25
// characters and 35 enemies from one file, each individually recognisable, and
// adding one is still six lines of data.
//
// `drake` is the one body plan that is not a person, a mob or a machine. It
// exists because a character TRANSFORMS, and a transformation drawn as the same
// figure with wings switched on is a status effect: the plan shares no code and
// no proportion with the humanoid, so the two silhouettes have nothing in common
// with the colour turned off. That is the only test a transformation has to pass.
//
// READABILITY RULES (SECTION 1) baked in, not left to the author:
//   - every sprite gets a hard 1px dark outline, so it separates from any
//     background and from the horde behind it
//   - enemies are cool-toned and desaturated; players are bright and saturated
//   - a 2-frame idle bob, because a static sprite in a moving field looks broken
//   - the figure stops one row short of the bottom of its grid, so the outline
//     AND the +1 bob frame both have somewhere to go. Without that margin the
//     boots' underside outline was silently clipped on every character.

import { shade, mixHex, clamp } from '../core/math.js';

// ---------------------------------------------------------------------------
// A tiny pixel buffer. Everything is plotted here first, then flushed to a
// canvas in one pass, so overlapping parts compose correctly and the outline
// can be computed from the finished silhouette.
// ---------------------------------------------------------------------------
class PixelBuf {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.px = new Array(w * h).fill(null);
  }
  set(x, y, c) {
    if (!c) return;
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.px[y * this.w + x];
  }
  /** Plot at x and its mirror about the vertical centre — symmetry for free. */
  sym(cx, x, y, c) {
    this.set(cx + x, y, c);
    this.set(cx - x - 1, y, c);
  }
  /** The same block on both sides of column `cx`. Odd-width-friendly mirror. */
  pair(cx, dx, y, w, h, c) {
    this.rect(cx + dx, y, w, h, c);
    this.rect(cx - dx - w + 1, y, w, h, c);
  }
  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  hline(x, y, w, c) { for (let i = 0; i < w; i++) this.set(x + i, y, c); }
  vline(x, y, h, c) { for (let j = 0; j < h; j++) this.set(x, y + j, c); }
  /** Filled ellipse — heads, blobs, orbs. */
  ellipse(cx, cy, rx, ry, c) {
    for (let y = -ry; y <= ry; y++) {
      for (let x = -rx; x <= rx; x++) {
        if ((x * x) / (rx * rx + 0.0001) + (y * y) / (ry * ry + 0.0001) <= 1.05) {
          this.set(cx + x, cy + y, c);
        }
      }
    }
  }
  /** A soft-shouldered trapezoid — torsos, capes, robes, coat hems. */
  taper(x, y, topW, botW, h, c) {
    for (let j = 0; j < h; j++) {
      const t = h <= 1 ? 0 : j / (h - 1);
      const w = Math.round(topW + (botW - topW) * t);
      this.hline(x + Math.round((topW - w) / 2), y + j, w, c);
    }
  }
  /** A triangle standing on its base — horns, ears, fins, spikes. */
  spike(x, y, w, h, dir, c) {
    for (let j = 0; j < h; j++) {
      const ww = Math.max(1, Math.round(w * (1 - j / h)));
      this.hline(x + ((w - ww) >> 1), y + dir * j, ww, c);
    }
  }
  line(x0, y0, x1, y1, c) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    for (let n = 0; n < 200; n++) {
      this.set(x, y, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }
  /** A 2px-thick blade along a line — the spine dark, the edge bright. */
  blade(x0, y0, x1, y1, edge, spine) {
    this.line(x0, y0, x1, y1, spine);
    this.line(x0 + 1, y0, x1 + 1, y1, edge);
  }
  /**
   * Repaint an EXISTING garment in a second colour on a checker.
   *
   * Patterns have to be applied after the garment rather than drawn as part of
   * it, because the thing that makes a pattern read is that it stops exactly at
   * the garment's own edge — including the ragged edge the hem and the open
   * front leave behind. Matching on the source ramp is what guarantees that: the
   * shirt showing through an open coat, and the outline, are never touched.
   */
  patternCheck(x, y, w, h, from, to, size) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const p = this.get(x + i, y + j);
        if (p !== from.base && p !== from.lite && p !== from.dark) continue;
        if ((((i / size) | 0) + ((j / size) | 0)) & 1) continue;
        this.set(x + i, y + j, p === from.lite ? shade(to, 0.25) : to);
      }
    }
  }
  /**
   * Recolour one ramp into another over a rectangle. Hair that fades to a second
   * colour at the tips is one draw pass plus this, rather than every hair style
   * having to learn about gradients.
   */
  retint(x, y, w, h, from, to) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const p = this.get(x + i, y + j);
        if (p === from.base) this.set(x + i, y + j, to.base);
        else if (p === from.lite) this.set(x + i, y + j, to.lite);
        else if (p === from.spec) this.set(x + i, y + j, to.spec);
        else if (p === from.dark) this.set(x + i, y + j, to.dark);
        else if (p === from.deep) this.set(x + i, y + j, to.deep);
      }
    }
  }
  /** Shift the whole buffer — used for the idle bob frame. */
  shifted(dy) {
    const out = new PixelBuf(this.w, this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.get(x, y);
        if (c) out.set(x, y + dy, c);
      }
    }
    return out;
  }
  /**
   * Wrap the finished silhouette in a hard outline. This is the single biggest
   * readability win in the whole renderer — without it, a dark enemy on a dark
   * stage simply disappears.
   */
  outline(color) {
    const add = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) ||
            this.get(x, y - 1) || this.get(x, y + 1)) {
          add.push(x, y);
        }
      }
    }
    for (let i = 0; i < add.length; i += 2) this.set(add[i], add[i + 1], color);
  }
  /**
   * THE LIGHT PASS. One key light, from the UPPER LEFT.
   *
   * The old pass only ever looked UP and DOWN. Its own comment promised a
   * "top-left highlight" and the code never read a horizontal neighbour, so
   * every sprite in the game was lit from directly overhead — which is the one
   * direction that gives a figure no volume at all. Both sides of an arm got
   * the same tone, both sides of every fold, every boot, every hair lock; the
   * whole roster came out flat-shaded with a lit hat brim on top. The reference
   * sheet is lit from the upper left and it is the HORIZONTAL half of that key
   * which does all the work.
   *
   *   nothing (or outline) ABOVE  -> the full highlight
   *   nothing to the LEFT         -> 60% of it, as a rim light
   *   nothing BELOW               -> the full shadow
   *   nothing to the RIGHT        -> 55% of it, as a terminator
   *
   * Every branch reads `src` — the buffer as it was on entry — and the chain is
   * `else if` on purpose. A corner pixel has nothing above AND nothing to the
   * left, and applying both rules compounds it to white: the figure grows a
   * bright fringe all down its lit side and stops having an outline.
   */
  shadeEdges(lightAmt, darkAmt) {
    const src = this.px.slice();
    const W = this.w, H = this.h;
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? null : src[y * W + x];
    const open = (c) => !c || c === OUTLINE;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = at(x, y);
        if (!c || c === OUTLINE) continue;
        if (open(at(x, y - 1))) this.set(x, y, shade(c, lightAmt));
        else if (open(at(x - 1, y))) this.set(x, y, shade(c, lightAmt * 0.6));
        else if (open(at(x, y + 1))) this.set(x, y, shade(c, -darkAmt));
        else if (open(at(x + 1, y))) this.set(x, y, shade(c, -darkAmt * 0.55));
      }
    }
  }

  /**
   * A CONTACT SHADOW — one row of whatever is already there, darkened.
   *
   * This is what separates garment layers, and it reads the buffer rather than
   * taking a colour, which is the entire point. A coat hem falls across a leg on
   * one character, a boot cuff on another, a cape on a third and bare skin on a
   * fourth; the shadow has to be THAT surface's own shade or it is a black
   * stripe painted across the figure. Called by the garment that CASTS it, right
   * after it draws its own hem, so no layer ever has to know what is under it.
   *
   * It runs before shadeEdges, and shadeEdges only touches pixels with an open
   * neighbour, so a shadow row in the middle of the silhouette survives intact.
   */
  castShadow(x, y, w, amt) {
    const a = amt === undefined ? 0.30 : amt;
    for (let i = 0; i < w; i++) {
      const c = this.get(x + i, y);
      if (!c || c === OUTLINE) continue;
      this.set(x + i, y, shade(c, -a));
    }
  }

  /**
   * A HAIR LOCK — a wedge with a lit leading edge, a body, a shadowed trailing
   * edge and a dark root notch, drawn as ONE shape.
   *
   * `spike()` is the primitive this replaces, for hair and only for hair. A
   * spike is a triangle in one colour, and a row of triangles is a comb — which
   * is exactly what four characters on the roster were wearing. What makes the
   * reference sheet's hair read as VOLUME is that each lock carries three tones
   * ACROSS its width and overlaps the one behind it, so the eye can see one
   * lock passing in front of another. Three tones per lock plus stepped heights
   * plus alternating lean is the whole recipe; any one of them alone is a comb.
   *
   * `lean` is how far the tip drifts sideways over the lock's height, and its
   * SIGN also picks which edge is lit — a lock leaning left catches the light on
   * its left face, which is the only reading consistent with the upper-left key
   * shadeEdges applies afterwards.
   */
  hairLock(x, y, w, h, lean, c, bright) {
    for (let j = 0; j < h; j++) {
      const t = j / Math.max(1, h - 1);
      const ww = Math.max(1, Math.round(w * (1 - t * 0.72)));
      const xx = x + ((w - ww) >> 1) + Math.round(lean * t);
      this.hline(xx, y - j, ww, c.base);
      this.set(lean >= 0 ? xx : xx + ww - 1, y - j, bright ? c.spec : c.lite);
      if (ww > 2) this.set(lean >= 0 ? xx + ww - 1 : xx, y - j, c.dark);
    }
    this.hline(x, y + 1, w, c.deep);            // the root the next lock hides
  }
}

const OUTLINE = '#0a0c14';

// ---------------------------------------------------------------------------
// Palette derivation. A descriptor gives one or two colours; everything else —
// shadows, highlights, trim — is derived so a new sprite is never a colour
// matching exercise.
// ---------------------------------------------------------------------------
/**
 * FIVE TONES PER MATERIAL, NOT FOUR.
 *
 * The reference sheet in `Example Folder/` runs a distinct SPECULAR on every
 * material — a near-white sliver on the shirt, on the hair, on the sword —
 * sitting ABOVE the light tone rather than being it. Forty call sites in this
 * file were already hand-rolling `mixHex(c.lite, WHITE, 0.35)` to get one,
 * which is a duplicated formula and, worse, a tone `retint()` cannot carry: a
 * character with `hairTip` had every hand-rolled highlight in her hair left
 * behind in the ORIGINAL colour when the gradient recoloured everything else.
 *
 * The band spacing is deliberately uneven — 0.34 then 0.36 of the remainder on
 * the light side, 0.30 then 0.52 on the dark — so the highlight reads as a hit
 * of light and the shadow as a fall-off. An evenly spaced ramp reads as a
 * gradient, and a gradient is the one thing pixel art must never look like.
 */
function ramp(base) {
  const lite = shade(base, 0.34);
  return {
    spec: mixHex(lite, '#ffffff', 0.36),
    lite,
    base,
    dark: shade(base, -0.30),
    deep: shade(base, -0.52),
  };
}

const SKIN_DEFAULT = '#f2c9a8';
const EYE_WHITE = '#f4f7ff';
const WHITE = '#ffffff';

/**
 * A feature slot that may be either a colour or a bare `true` meaning "yes, in
 * the obvious colour". Descriptors written by hand use both, and `ramp(true)`
 * dies inside hexToInt with a TypeError that names neither the feature nor the
 * entity — so every optional-colour slot goes through here.
 */
function slotRamp(v, fallback) {
  return ramp(typeof v === 'string' ? v : fallback);
}

// ---------------------------------------------------------------------------
// BODY PLANS
// ---------------------------------------------------------------------------

/**
 * Every landmark on the humanoid, as a function of the grid. Change BODY_SIZE
 * and the figure grows to fill it instead of floating in a corner.
 *
 * `young` is a real proportion change, not a scale: a bigger head on a narrower
 * frame. Two of the cast are written up as children and one of them stands
 * beside his father in the same roster grid, so "small and young" has to survive
 * being the same number of pixels tall as everyone else.
 *
 * The bottom margin is deliberate: `bottom` is h-3, so outline() can put a row
 * at h-2 and shifted(1) still has h-1 to land in. The old plan put the boots on
 * the last row and lost their underside outline on every single character.
 */
// ---------------------------------------------------------------------------
// THE WALK CYCLE
//
// A four-beat walk, front-on, sitting on top of the two-frame idle bob that was
// already here. FRONT-ON is the constraint that shapes all of it: there is no
// "forward" on the screen, so a stride cannot be drawn as travel. What a
// front-facing walk actually shows is three things —
//
//   1. the feet move APART and back TOGETHER,
//   2. one foot leaves the ground on each half-stride,
//   3. the whole body drops on the contact and rises on the pass.
//
// Any two of those read as a twitch. All three read as walking.
//
//   beat 0  CONTACT  left foot forward, right trailing, body low
//   beat 1  PASS     feet together, LEFT foot lifted, body high
//   beat 2  CONTACT  right foot forward, left trailing, body low
//   beat 3  PASS     feet together, RIGHT foot lifted, body high
//
// (3) is free: it is the existing `shifted(1)` applied to the contact beats, so
// the frame budget buys legs and nothing else. And all four beats are genuinely
// distinct pixels, which matters because a symmetric front-on figure makes that
// easy to get wrong — beats 0 and 2 differ because the legs occupy different
// COLUMNS, beats 1 and 3 because a different foot is off the floor.
//
// `l` / `r` are the swing of each leg: +1 forward, -1 trailing, 0 under the
// hip. `lift` names the side whose foot is off the ground (-1 left, +1 right,
// 0 neither); it raises that foot and takes the same rows out of the shin, so
// the leg stays joined to the hip and never grows. `bob` says whether the
// finished frame gets the +1 whole-buffer shift.
// ---------------------------------------------------------------------------
const POSE_IDLE = { l: 0, r: 0, lift: 0, bob: 0 };
const WALK_POSES = [
  { l:  1, r: -1, lift:  0, bob: 1 },
  { l:  0, r:  0, lift: -1, bob: 0 },
  { l: -1, r:  1, lift:  0, bob: 1 },
  { l:  0, r:  0, lift:  1, bob: 0 },
];

/**
 * How many WALK frames each body plan gets, on top of its two idle frames.
 *
 * `blob` and `ghost` are 0 because they have no legs — the ghost's whole read is
 * a torn hem where feet would be, and giving it a gait would be a bug. `titan`
 * and `drake` get 2 rather than 4, and that is a read as much as a budget: a
 * boss has one stride to every two of a person's, so it takes only the CONTACT
 * beats and skips the passing lift entirely. Nothing weighing that much picks a
 * foot up cleanly. It also happens to be where the memory is — see the raster
 * budget in spriteAtlas.registerPixel.
 *
 * MUST STAY A POWER OF TWO (0, 2 or 4). `Sprite.animIndexFor` selects a beat
 * with a mask rather than a modulo because it runs once per entity per frame
 * with two thousand entities on screen.
 */
const FRAME_PLAN = {
  humanoid: 4, beast: 4, mech: 4,
  titan: 2, drake: 2,
  blob: 0, ghost: 0, portrait: 0,
};

function humanMetrics(W, H, d) {
  const young = !!(d && d.young);
  const cx = W >> 1;
  const headR = Math.max(3, Math.round(W * (young ? 0.235 : 0.21)));
  const headY = Math.max(headR + 4, Math.round(H * 0.235));
  const chinY = headY + headR - 1;
  const shoulderY = Math.min(chinY + 2, H - 12);
  const hipY = Math.max(shoulderY + 6, Math.round(H * 0.655));
  const bottom = H - 3;
  // Boots are a quarter of the leg rather than the last two rows. At 24x34 there
  // was only ever room for a sole; at 30x42 a boot can have a cuff, a strap and
  // a toe, which is most of what tells two characters' legs apart.
  const bootY = Math.max(hipY + 3, bottom - Math.max(2, Math.round(H * 0.095)));
  const kneeY = hipY + Math.max(1, Math.round((bootY - hipY) * 0.5));
  const halfTop = Math.max(3, Math.round(W * (young ? 0.16 : 0.185)));
  const halfBot = Math.max(2, halfTop - 1);
  const armW = Math.max(2, Math.round(W * 0.095));
  // halfTop + 2, not + 1: at +1 an arm overlapped the torso by two of its three
  // columns and the whole figure came out as one slab with a head on it. Arms
  // have to break the silhouette or there is no silhouette.
  const armOut = halfTop + 2;
  const elbowY = shoulderY + Math.max(2, Math.round((hipY - shoulderY) * 0.5));
  // The weapon column sits clear of the widest garment (a coat hem reaches
  // halfTop+3), so a blade is never swallowed by the silhouette it hangs off,
  // and two columns short of the edge so its own outline is never clipped.
  const wx = Math.min(cx + armOut + armW, W - 3);      // right-hand weapon column
  const lx = W - 1 - wx;                               // its exact mirror
  return { W, H, cx, headR, headY, chinY, shoulderY, hipY, kneeY, bootY, bottom,
           halfTop, halfBot, armW, armOut, elbowY, wx, lx, young };
}

function humanPalette(d) {
  const outfit = d.outfit || '#5f7fd6';
  const accent = d.accent || shade(outfit, -0.45);
  return {
    skin: ramp(d.skin || SKIN_DEFAULT),
    cloth: ramp(outfit),
    trim: ramp(accent),
    hair: ramp(d.hairColor || '#2b2b3a'),
    tip: d.hairTip ? ramp(d.hairTip) : null,
    coat: slotRamp(d.coat, accent),
    metal: ramp(d.weaponColor || '#d8e2f0'),
    eyes: d.eyes || '#1a1a2e',
    glow: d.eyeGlow || null,
  };
}

/**
 * The humanoid — every playable character and most humanoid enemies.
 *
 * Layered back-to-front so the parts occlude each other correctly: a prop
 * strapped to the back has to sit behind the hair, a long coat over the torso
 * but under the arms, a fringe over the face but under a horn, and a collar over
 * the neck the head draws — which it did not, before, so every scarf on the
 * roster had a skin-coloured stripe punched through its middle.
 */
function drawHumanoid(b, d, pose) {
  const m = humanMetrics(b.w, b.h, d);
  // The pose rides on the metrics object rather than on an argument, because
  // exactly two of the eighteen routines below care about it and the other
  // sixteen would have to grow a parameter they ignore in order to pass it on.
  m.pose = pose || POSE_IDLE;
  const P = humanPalette(d);
  drawAura(b, m, P, d);
  drawBackProp(b, m, P, d);
  drawWings(b, m, P, d);
  if (d.cape) drawCape(b, m, P, d);
  if (d.hoodDown) drawHoodDown(b, m, P, d);
  drawHairBack(b, m, P, d);
  // AFTER the back hair and not before it. A tail fan roots at the hip and
  // sweeps out to the edge of the grid; a long back mass â€” `long`, `twinLong`,
  // `lowTwin`, `drills` â€” occupies exactly those columns for exactly those
  // rows, so tails drawn first are simply painted out. On the one character who
  // has NINE of them that is the whole design gone: at 38x54 only 29 pixels of
  // a nine-tail fan survived the hair. Nothing else on the roster overlaps at
  // all (the styles that reach the hip belong to characters with one tail on
  // the far side, or none), so this costs two other sprites nine pixels and
  // four pixels respectively and buys back a signature.
  drawTails(b, m, P, d);
  drawLegs(b, m, P, d);
  drawTorso(b, m, P, d);
  if (d.coat) drawCoat(b, m, P, d);
  // The apron goes on over the dress and under the arms, which is the order the
  // garments are actually put on. Drawn after the coat so a character wearing
  // both reads as an apron over a coat rather than the other way round.
  if (d.pinafore) drawPinafore(b, m, P, d);
  if (d.backpack) drawStraps(b, m, P, d);
  drawArms(b, m, P, d);
  if (d.shoulderCape) drawShoulderCape(b, m, P, d);
  if (d.harness) drawHarness(b, m, P, d);
  if (d.pauldrons || d.pauldron) drawPauldrons(b, m, P, d);
  drawHairCap(b, m, P, d);
  drawHead(b, m, P, d);
  drawNeckwear(b, m, P, d);
  drawFace(b, m, P, d);
  drawHairFront(b, m, P, d);
  // AFTER the fringe and BEFORE the hat, which is the only slot where a strap
  // is visible at all: the eyepatch itself is drawn with the face, and the
  // fringe is drawn on top of the face, so a strap plotted with the patch was
  // painted out by the hair on every character who wore one. It also has to be
  // under the headgear — a band crossing a hat brim is not a strap, it is a
  // mistake.
  if (d.eyepatchStrap) drawEyepatchStrap(b, m, P, d);
  drawHeadgear(b, m, P, d);
  drawTrinkets(b, m, P, d);
  drawWeapon(b, m, P, d);
  if (d.hologram) drawHologram(b, m, P, d);
}

/** Floating motes. The 6-star cast reads as lit from inside without smudging. */
function drawAura(b, m, P, d) {
  if (!d.aura) return;
  const a = slotRamp(d.aura, d.accent || '#ffe9a3');
  const { cx, headY, headR, hipY, W } = m;
  const far = headR + 4, near = headR + 2;
  const pts = [
    [cx - far, headY - 1], [cx + far, headY + 1],
    [cx - near - 2, headY + headR + 2], [cx + near + 2, headY + headR + 1],
    [cx - far + 1, hipY + 3], [cx + far - 1, hipY + 2],
    [cx - 2, headY - headR - 3], [cx + 3, headY - headR - 2],
    [cx - far - 1, hipY - 5], [cx + far + 1, hipY - 4],
  ];
  for (let i = 0; i < pts.length; i++) {
    const x = clamp(pts[i][0], 0, W - 1);
    b.set(x, pts[i][1], i % 3 === 0 ? mixHex(a.lite, WHITE, 0.4) : i % 2 ? a.lite : a.base);
  }
}

/**
 * Something carried on the back — a crate, a case, a pack. Drawn before every
 * other layer so only its corners clear the shoulders, which is exactly how a
 * big object worn behind a person reads from the front.
 */
function drawBackProp(b, m, P, d) {
  if (d.hipWings) {
    // Small wing ornaments hung at the hips rather than the shoulders. They read
    // as jewellery, not flight, which is the distinction the brief draws.
    const c = slotRamp(d.hipWings, d.accent || '#e8c34a');
    const { cx, hipY, halfBot } = m;
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - halfBot - 4 : cx + halfBot + 1;
      for (let j = 0; j < 4; j++) {
        b.hline(s < 0 ? x + j : x, hipY - 2 + j, 4 - j, j & 1 ? c.base : c.lite);
      }
      b.set(s < 0 ? x : x + 3, hipY - 2, mixHex(c.lite, WHITE, 0.4));
    }
  }
  if (!d.backpack) return;
  const c = slotRamp(d.backpackColor, '#7a5330');
  const { cx, shoulderY, hipY, halfTop } = m;
  // Wider than the coat hem and taller than the shoulders, or the garment drawn
  // on top of it swallows the thing whole and the character loses their prop.
  const w = halfTop * 2 + 11;
  const h = hipY - shoulderY + 11;
  const x = cx - (w >> 1), y = shoulderY - 6;
  b.rect(x, y, w, h, c.base);
  b.hline(x, y, w, c.lite);
  b.hline(x, y + h - 1, w, c.deep);
  b.vline(x, y, h, c.dark);
  b.vline(x + w - 1, y, h, c.dark);
  // Plank seams and corner braces: without them a crate is just a rounded
  // rectangle behind the figure and reads as a cape.
  for (let j = 4; j < h - 2; j += 4) b.hline(x + 1, y + j, w - 2, c.dark);
  b.rect(x + 1, y + 1, 2, 2, c.lite);
  b.rect(x + w - 3, y + 1, 2, 2, c.lite);
  b.rect(x + 1, y + h - 3, 2, 2, c.deep);
  b.rect(x + w - 3, y + h - 3, 2, 2, c.deep);
}

/** The shoulder straps that hold a back prop on. Over the garment, under the arms. */
function drawStraps(b, m, P, d) {
  const c = slotRamp(d.strapColor, '#3a2a1c');
  const { cx, shoulderY, hipY } = m;
  for (const s of [-1, 1]) {
    b.line(cx + s * 3, shoulderY, cx + s * 2, hipY - 2, c.base);
    b.set(cx + s * 3, shoulderY, c.lite);
  }
  b.hline(cx - 3, shoulderY + 4, 7, c.dark);   // the chest strap that joins them
}

/** feather | mech | energy | dragon. Four silhouettes, not one shape recoloured. */
function drawWings(b, m, P, d) {
  const kind = d.wings === true ? 'feather' : d.wings;
  if (!kind) return;
  const c = slotRamp(d.wingColor, d.accent || '#e8e8f0');
  const { cx, shoulderY, armOut, hipY, W } = m;
  const span = Math.max(3, Math.round(W * 0.17));
  const top = shoulderY - 3;
  const h = hipY - top;
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? cx - armOut - span : cx + armOut + 1;
    if (kind === 'mech') {
      // Hard panels with a lit leading edge and a vent gap. Machines, not birds.
      b.rect(x0, top, span, 2, c.base);
      b.rect(x0 + (s < 0 ? 0 : span - 2), top + 2, 2, h - 2, c.dark);
      b.hline(x0, top, span, c.lite);
      b.set(x0 + (span >> 1), top + 4, mixHex(c.lite, WHITE, 0.5));
    } else if (kind === 'energy') {
      // Struck-through streaks with deliberate gaps, so it reads as light.
      for (let j = 0; j < h; j += 2) {
        const w = Math.max(1, span - ((j / 2) | 0));
        b.hline(s < 0 ? x0 + span - w : x0, top + j, w, j & 2 ? c.lite : c.base);
      }
    } else if (kind === 'dragon') {
      // Membrane plus visible finger struts — the giveaway that it is not a bird.
      b.taper(x0, top, span, span, h, c.dark);
      for (let j = 0; j < h; j += 3) b.hline(x0, top + j, span, c.base);
      b.vline(s < 0 ? x0 : x0 + span - 1, top, h, c.lite);
      for (let j = 2; j < h; j += 4) b.set(s < 0 ? x0 : x0 + span - 1, top + j, c.deep);
    } else {
      // Feathers in three ranks: coverts, secondaries, then a stepped row of
      // primaries. One taper does not read as a wing; the steps do.
      for (let j = 0; j < h; j++) {
        const w = Math.max(1, span - (Math.abs(j - ((h / 3) | 0)) / 2 | 0));
        b.hline(s < 0 ? x0 + span - w : x0, top + j, w, j % 3 === 0 ? c.lite : c.base);
      }
      b.vline(s < 0 ? x0 : x0 + span - 1, top + 1, h - 2, c.dark);
      for (let j = h - 5; j < h; j += 2) {
        b.set(s < 0 ? x0 + 1 : x0 + span - 2, top + j, mixHex(c.lite, WHITE, 0.35));
      }
    }
  }
}

/**
 * Tails. Up to NINE, because one of the cast is defined by having nine of them
 * and four read as "some tails" rather than as the number that matters.
 *
 * They fan down-and-out from the hips with alternating tones, so adjacent tails
 * separate at a size where they are three pixels wide. `tail:'scaled'` is the
 * other case entirely: one heavy segmented tail, drawn instead of the fan.
 */
function drawTails(b, m, P, d) {
  const { cx, hipY, armOut, bottom, W } = m;
  const c = slotRamp(d.tailColor, d.accent || '#d8a05a');
  if (d.tail === 'scaled') {
    const y0 = hipY - 1;
    for (let j = 0; j < 10; j++) {
      const x = clamp(cx + armOut + 1 + ((j * 3) >> 2), 1, W - 3);
      const y = Math.min(bottom, y0 + j);
      const w = Math.max(1, 3 - (j >> 2));
      b.hline(x, y, w, j & 1 ? c.base : c.dark);
      if (j % 3 === 0) b.set(x, y, c.lite);        // the scale ridge, every third
    }
    b.set(clamp(cx + armOut + 8, 1, W - 2), Math.min(bottom, y0 + 9), c.lite);
    return;
  }
  const n = Math.min(d.tails || 0, 9);
  if (!n) return;
  const len = Math.max(4, Math.round((bottom - hipY) * 1.2));
  for (let i = 0; i < n; i++) {
    const s = i % 2 === 0 ? 1 : -1;
    const k = (i / 2) | 0;
    const rootX = cx + s * (armOut - 1);
    const tipX = clamp(cx + s * (armOut + 3 + k * 2), 1, W - 2);
    const tipY = clamp(hipY - 5 + k * 4, 1, bottom);
    const tone = k & 1 ? c.dark : c.base;
    b.line(rootX, hipY, tipX, tipY, tone);
    b.line(rootX, hipY + 1, tipX, tipY + 1, tone);
    b.line(rootX, hipY + 2, tipX, tipY + 2, c.deep);
    b.set(rootX, hipY - 1, c.lite);
    b.set(tipX, tipY, mixHex(c.lite, WHITE, 0.5));      // the pale tip
    b.set(tipX, tipY + 1, mixHex(c.lite, WHITE, 0.3));
  }
  if (n === 1) {
    // A lone tail gets thickness instead of company, or it reads as a rope.
    b.ellipse(cx + armOut + 2, hipY + (len >> 1) - 2, 2, len >> 1, c.base);
    b.set(cx + armOut + 2, hipY + len - 4, mixHex(c.lite, WHITE, 0.45));
  }
}

function drawCape(b, m, P, d) {
  const c = typeof d.cape === 'string' ? ramp(d.cape) : P.trim;
  const { cx, shoulderY, halfTop, bootY } = m;
  const h = bootY - shoulderY;
  b.taper(cx - halfTop - 2, shoulderY, halfTop * 2 + 5, halfTop * 2 + 9, h, c.dark);
  b.hline(cx - halfTop - 1, shoulderY, halfTop * 2 + 3, c.base);
  // Two lit folds falling from the shoulders. A cape with no folds is a board.
  b.line(cx - halfTop, shoulderY + 2, cx - halfTop - 2, shoulderY + h - 2, c.base);
  b.line(cx + halfTop, shoulderY + 2, cx + halfTop + 2, shoulderY + h - 2, c.deep);
  // A ragged hem, so the cape ends in cloth rather than in a ruler line.
  for (let i = -halfTop - 4; i <= halfTop + 4; i += 2) b.set(cx + i, shoulderY + h, c.deep);
}

/**
 * A hood worn DOWN — the bunched cowl of a hooded garment lying behind the neck
 * and spilling over the shoulders.
 *
 * `hair:'hood'` is the opposite case and the only one the vocabulary had: a hood
 * UP, with no face under it, which is a whole different character note. Two of
 * the briefs ask for a hoodie on somebody whose face is the entire point, and
 * with only the up-hood available the previous pass just wrote `coat` and lost
 * the garment. The cowl is drawn WIDER THAN THE HEAD and taller than the
 * shoulders on purpose: the only part of a down hood that is ever visible from
 * the front is the bunched roll either side of the jaw, so if it does not clear
 * the head it is not there at all.
 */
function drawHoodDown(b, m, P, d) {
  const c = slotRamp(d.hoodDown, d.outfit || '#e8e4dc');
  const { cx, chinY, shoulderY, headR, halfTop } = m;
  const wTop = headR + 2, wBot = halfTop + 3;
  const top = Math.max(0, chinY - 3);
  const h = Math.max(4, shoulderY - top + 5);
  b.taper(cx - wTop, top, wTop * 2 + 1, wBot * 2 + 1, h, c.base);
  b.hline(cx - wTop + 1, top, wTop * 2 - 1, c.lite);
  b.hline(cx - wBot + 1, top + h - 1, wBot * 2 - 1, c.deep);
  // Two gathers where the cloth rolls over on itself. Without them the shape is
  // a collar — flat, symmetrical and obviously sewn on rather than folded down.
  for (const s of [-1, 1]) {
    b.vline(cx + s * (wTop - 1), top + 1, h - 3, c.dark);
    b.set(cx + s * wTop, top + 2, c.lite);
    b.set(cx + s * (wTop - 2), top + h - 3, c.deep);
  }
}

function drawLegs(b, m, P, d) {
  const { cx, hipY, kneeY, bootY, bottom, halfBot } = m;
  const pose = m.pose || POSE_IDLE;
  // Narrow enough to leave a clear column between the outside of the boot and
  // the hand hanging beside it. At the old width the two touched, and every
  // character grew a solid horizontal bar across the hips that read as a tray.
  const legW = Math.max(2, halfBot - 1);
  const legTop = hipY + 1;
  const legH = Math.max(2, bootY - legTop);
  const lc = typeof d.legColor === 'string' ? ramp(d.legColor) : P.cloth;
  for (const s of [-1, 1]) {
    // THE STRIDE. `sw` swings the foot one column outboard (forward) or inboard
    // (trailing); `up` lifts it clear of the ground on the passing beat and
    // takes the same two rows OUT OF THE SHIN, so the leg never detaches from
    // the hip and the figure never gets taller.
    const sw = s < 0 ? pose.l : pose.r;
    const up = pose.lift === s ? 2 : 0;
    const dx = s * sw;
    const x = (s < 0 ? cx - legW : cx + 1) + dx;
    const h = Math.max(2, legH - up);
    b.rect(x, legTop, legW, h, lc.dark);
    b.vline(s < 0 ? x : x + legW - 1, legTop, h, lc.deep);      // outer shadow
    b.vline(s < 0 ? x + legW - 1 : x, legTop, h, lc.base);      // inner light
    if (kneeY - up >= legTop) b.hline(x, kneeY - up, legW, lc.base);   // knee break
  }
  if (d.barefoot) {
    // No boots at all: bare feet, with toes. The absence of footwear is a
    // character note for one of the cast, so it has to be drawn, not omitted.
    const fw = legW + 1;
    for (const s of [-1, 1]) {
      const sw = s < 0 ? pose.l : pose.r;
      const up = pose.lift === s ? 2 : 0;
      const x = (s < 0 ? cx - fw : cx + 1) + s * sw;
      const top = bootY - up, bot = bottom - up;
      b.rect(x, top, fw, bot - top + 1, P.skin.dark);
      b.hline(x, top, fw, P.skin.base);
      b.hline(s < 0 ? x - 1 : x, bot - 1, fw + 1, sw > 0 ? P.skin.lite : P.skin.base);
      b.hline(s < 0 ? x - 1 : x, bot, fw + 1, P.skin.deep);
      for (let i = 0; i < fw; i += 2) b.set((s < 0 ? x - 1 : x) + i, bot - 1, P.skin.lite);
    }
    return;
  }
  // Boots with a hard sole one pixel wider than the boot — the ground contact
  // that stops the figure looking like it is hovering — a cuff, a strap and a
  // toe box, which is what separates one character's legs from another's.
  const bw = legW + 1;
  const boot = typeof d.boots === 'string' ? ramp(d.boots) : P.trim;
  const shaftTop0 = d.bootHeight === 'thigh' ? legTop
                  : d.bootHeight === 'knee' ? kneeY : bootY;
  for (const s of [-1, 1]) {
    const sw = s < 0 ? pose.l : pose.r;
    const up = pose.lift === s ? 2 : 0;
    const x = (s < 0 ? cx - bw : cx + 1) + s * sw;
    const shaftTop = shaftTop0 - up;
    const bot = bottom - up;
    b.rect(x, shaftTop, bw, bot - shaftTop + 1, boot.base);
    b.hline(x, shaftTop, bw, boot.lite);                       // the cuff
    b.hline(x, shaftTop + 1, bw, boot.dark);
    b.castShadow(x, shaftTop + 2, bw, 0.22);                   // the cuff's shadow
    b.vline(s < 0 ? x : x + bw - 1, shaftTop + 2, bot - shaftTop - 1, boot.deep);
    b.hline(x + 1, bootY + 1 - up, bw - 2, boot.dark);         // the ankle strap
    // THE FOOT, which is where a walk is either legible or it is not.
    //
    // Two rows of sole was a shoe seen edge-on, and at this size that reads as a
    // peg: a walk cycle on a peg is a sprite vibrating. A foot needs three
    // things — a toe box wider than the boot, an INSTEP that catches the light,
    // and a hard `deep` sole that is the sprite's one contact with the ground.
    // The instep is also what carries the stride: the forward foot gets the
    // brightest tone, the trailing foot loses it entirely, so on a contact beat
    // the two feet read as being at different DISTANCES even though they are one
    // column apart — which is the only depth cue a front-on figure has.
    const fx = s < 0 ? x - 1 : x;
    b.hline(fx, bot - 1, bw + 1, sw > 0 ? boot.lite : sw < 0 ? boot.dark : boot.base);
    b.hline(fx, bot, bw + 1, boot.deep);                       // the sole
    b.set(s < 0 ? fx : fx + bw, bot - 1, boot.deep);           // the outer toe
  }
}

function drawTorso(b, m, P, d) {
  const { cx, chinY, shoulderY, hipY, kneeY, bootY, bottom, halfTop, halfBot } = m;
  const h = hipY - shoulderY + 1;
  const chestH = Math.max(2, h - 4);
  // Chest block then a narrower waist block: a defined garment silhouette
  // rather than one flat slab, and symmetric on an odd width.
  b.rect(cx - halfTop, shoulderY, halfTop * 2 + 1, chestH, P.cloth.base);
  b.rect(cx - halfBot, shoulderY + chestH, halfBot * 2 + 1, h - chestH, P.cloth.base);
  // A yoke one pixel proud of the chest on each side. Two rows of it is the
  // difference between "a person" and "a bottle" at this size.
  b.rect(cx - halfTop - 1, shoulderY, halfTop * 2 + 3, 2, P.cloth.base);
  b.hline(cx - halfTop, shoulderY, halfTop * 2 + 1, P.cloth.lite);
  b.vline(cx, shoulderY + 1, h - 2, P.cloth.dark);          // centre closure seam
  // Folds. One lit column inboard of the left edge and one shadow column
  // inboard of the right: cloth curving round a body, for two draw calls.
  b.vline(cx - halfTop + 1, shoulderY + 2, h - 5, P.cloth.lite);
  b.vline(cx + halfTop - 1, shoulderY + 2, h - 5, P.cloth.deep);
  b.set(cx - halfTop + 2, hipY - 3, P.cloth.lite);
  b.set(cx + halfTop - 2, hipY - 4, P.cloth.deep);
  if (d.underLayer) {
    // A second garment showing at the neck and nowhere else, which is how a
    // layered top actually reads at this scale.
    const u = slotRamp(d.underLayer, d.accent || '#3f6ad8');
    b.hline(cx - 2, shoulderY, 5, u.base);
    b.hline(cx - 1, shoulderY + 1, 3, u.base);
    b.set(cx, shoulderY + 2, u.dark);
    b.set(cx - 2, shoulderY, u.lite);
  }
  if (d.hakama) {
    // A HAKAMA â€” the long pleated DIVIDED skirt of a shrine garment.
    //
    // `skirt` is the other one and this is not a length setting on it: that is
    // four rows of taper at the hip with three pleat ticks in it, which is a
    // mini, which is correct for the two school uniforms that wear it and
    // completely wrong for a garment that falls to the ankle and is the single
    // loudest colour on the figure. Written as `skirt`, a shrine outfit comes
    // out as a school uniform in an unusual colour, which is what it was.
    //
    // Three things make it a hakama and not merely a long skirt. It starts
    // ABOVE the hip, at the bottom of the ribs, because that is where the ties
    // sit and it is what makes the torso above it read as short. It is PLEATED
    // with hard creases running the whole drop rather than three ticks at the
    // waist. And it is DIVIDED â€” a shadow seam down the centre from the knee to
    // the hem, which is the detail that says these are trousers rather than a
    // tube, and the only one of the three that costs a single draw call.
    const hk = slotRamp(d.hakama, d.accent || '#c8342a');
    const hTop = Math.max(shoulderY + 2, hipY - 5);
    const hem = Math.min(bottom - 2, bootY + 1);
    const hh = Math.max(6, hem - hTop + 1);
    const wTop = halfBot + 1, wBot = halfBot + 4;
    b.taper(cx - wTop, hTop, wTop * 2 + 1, wBot * 2 + 1, hh, hk.base);
    b.hline(cx - wTop, hTop, wTop * 2 + 1, hk.lite);           // the waist ties
    // The pleats. Kept inside the NARROWEST row of the taper, because the
    // garment only ever widens downward â€” a crease plotted at the hem's width
    // hangs off the waist in mid-air and outline() then wraps it.
    for (let i = -wTop + 1; i <= wTop - 1; i += 3) {
      b.vline(cx + i, hTop + 1, hh - 2, hk.dark);
      b.set(cx + i - 1, hTop + 1, hk.lite);
    }
    b.vline(cx, kneeY, hem - kneeY, hk.deep);                  // DIVIDED
    b.vline(cx - wTop + 1, hTop + 2, hh - 4, hk.lite);         // the lit fold
    b.vline(cx + wTop - 1, hTop + 2, hh - 4, hk.deep);
    b.hline(cx - wBot + 1, hem - 1, wBot * 2 - 1, hk.dark);
    b.hline(cx - wBot, hem, wBot * 2 + 1, hk.deep);            // the hem
  }
  if (d.skirt) {
    const sk = slotRamp(d.skirt, d.accent || '#8a8fa8');
    b.taper(cx - halfBot - 2, hipY, halfBot * 2 + 5, halfBot * 2 + 7, 4, sk.base);
    b.hline(cx - halfBot - 3, hipY + 3, halfBot * 2 + 7, sk.dark);
    b.castShadow(cx - halfBot - 3, hipY + 4, halfBot * 2 + 7, 0.32);   // onto the legs
    // Pleats: three dark ticks, which is the whole reason a skirt is not a cone.
    for (let i = -halfBot; i <= halfBot; i += 3) b.vline(cx + i, hipY + 1, 3, sk.dark);
    if (d.shorts) {
      const sh = slotRamp(d.shorts, shade(typeof d.skirt === 'string' ? d.skirt : '#3a3a4a', -0.4));
      b.rect(cx - halfBot, hipY + 4, halfBot * 2 + 1, 2, sh.base);
      b.set(cx, hipY + 4, sh.lite);
    }
  }
  if (d.sash) {
    // A proper obi: three rows, a knot that is visibly a knot, and one end
    // hanging free so it is never left-right symmetric.
    const s = slotRamp(d.sash, d.accent || '#c8342a');
    const oy = hipY - 3;
    b.rect(cx - halfBot, oy, halfBot * 2 + 1, 3, s.base);
    b.hline(cx - halfBot, oy, halfBot * 2 + 1, s.lite);
    b.hline(cx - halfBot, oy + 2, halfBot * 2 + 1, s.dark);
    b.rect(cx - 2, oy - 1, 4, 5, s.dark);
    b.hline(cx - 2, oy - 1, 4, s.lite);
    b.set(cx - 1, oy + 1, s.base);
    b.rect(cx - halfBot, oy + 3, 2, 4, s.base);
    b.set(cx - halfBot, oy + 6, s.deep);
    if (d.sashBuckle) {
      // A plate over the knot. A wide sash with nothing on it is a bandage, and
      // the one thing that says the wearer's belt has FITTINGS — that somebody
      // paid for this outfit — is a hard-edged rectangle of metal sitting on
      // soft cloth. It goes over the knot, not beside it: the knot is already
      // the only place the eye stops on the whole waist.
      const k = slotRamp(d.sashBuckle, d.accent || '#e8c34a');
      b.rect(cx - 2, oy, 5, 3, k.base);
      b.hline(cx - 2, oy, 5, k.lite);
      b.hline(cx - 2, oy + 2, 5, k.dark);
      b.set(cx, oy + 1, k.deep);
      b.set(cx - 2, oy, mixHex(k.lite, WHITE, 0.5));
    }
  } else if (d.belt !== false) {
    b.hline(cx - halfBot, hipY - 1, halfBot * 2 + 1, P.trim.base);
    b.hline(cx - halfBot, hipY - 2, halfBot * 2 + 1, P.trim.dark);
    b.rect(cx - 1, hipY - 2, 3, 2, P.trim.lite);              // the buckle
    b.set(cx, hipY - 1, P.trim.deep);
  }
  if (d.chest) {
    // A crest, not a dot: a 5-tall diamond mid-chest reads at any zoom.
    const y = shoulderY + 3;
    b.hline(cx - 2, y, 5, d.chest);
    b.hline(cx - 1, y - 1, 3, d.chest);
    b.hline(cx - 1, y + 1, 3, d.chest);
    b.set(cx, y - 2, d.chest);
    b.set(cx, y + 2, d.chest);
    b.set(cx, y, shade(d.chest, 0.45));
    b.set(cx - 1, y - 1, shade(d.chest, 0.3));
  }
  if (d.tie) {
    // A school tie. Knot at the collar, blade widening down the shirt.
    const t = slotRamp(d.tie, d.accent || '#8a2020');
    b.rect(cx - 1, chinY + 1, 3, 2, t.base);
    b.hline(cx - 1, chinY + 1, 3, t.lite);
    b.taper(cx - 1, shoulderY + 1, 3, 3, hipY - shoulderY - 3, t.base);
    b.vline(cx, shoulderY + 1, hipY - shoulderY - 3, t.lite);
    b.hline(cx - 1, hipY - 3, 3, t.deep);
  }
}

/**
 * A long coat / haori. It has to read as a SEPARATE garment, so it is drawn
 * over the torso and then the torso colour is put back down the middle as the
 * shirt showing through the open front.
 */
function drawCoat(b, m, P, d) {
  const { cx, shoulderY, hipY, bootY, halfTop } = m;
  const hem = Math.min(bootY - 1, hipY + Math.round((bootY - hipY) * 0.85));
  const c = P.coat;
  const top = shoulderY, height = hem - shoulderY + 1;
  b.taper(cx - halfTop - 1, top, halfTop * 2 + 3, halfTop * 2 + 7, height, c.base);
  b.hline(cx - halfTop - 1, top, halfTop * 2 + 3, c.lite);
  if (d.coatPattern === 'check') {
    // Applied over the finished garment so the check stops at the hem and at the
    // open front instead of being clipped by a rectangle that knows neither.
    const alt = typeof d.coatPattern2 === 'string' ? d.coatPattern2 : shade(c.base, -0.62);
    b.patternCheck(cx - halfTop - 4, top, halfTop * 2 + 9, height, c, alt, 2);
  } else if (d.coatPattern === 'stripe') {
    for (let j = top + 2; j <= hem; j += 3) {
      b.hline(cx - halfTop - 3, j, halfTop * 2 + 7, c.deep);
    }
  }
  // The shirt in the open front. Three columns is the whole of it on an
  // ordinary coat, and stays three on every grid the roster and the horde use —
  // `halfTop - 3` is exactly 3 at both the 26- and 30-wide grids. It only opens
  // up on a coat that has been given real lapels, because a peaked lapel folded
  // back off a three-pixel gap has nowhere to fold back TO.
  const openW = d.coatLapels ? Math.max(3, halfTop - 2) : 3;
  const openH = openW >> 1;
  b.rect(cx - openH, top, openW, hipY - top, P.cloth.base);
  b.vline(cx, top, hipY - top, P.cloth.dark);
  if (d.coatLapels) {
    // BROAD NOTCHED LAPELS. The thin two-column edging below is all an ordinary
    // coat needs; a dress coat's collar is a third of the garment and has to be
    // drawn as one. It is a wedge: widest at the shoulder, narrowing to nothing
    // about halfway to the hip, with a lit inner fold and a dark outer break so
    // the cloth reads as TURNED BACK rather than as a stripe painted on the
    // front. The standing collar behind the neck is the other half of the read —
    // without it the lapels start in mid-air and the coat has no neck at all.
    const lc = slotRamp(d.coatLapels, d.coatTrim || c.lite);
    const depth = Math.max(5, Math.round((hipY - top) * 0.52));
    for (const s of [-1, 1]) {
      for (let j = 0; j < depth; j++) {
        const w = Math.max(1, 4 - Math.round((j * 3) / depth));
        const x = s < 0 ? cx - openH - w : cx + openH + 1;
        b.rect(x, top + j, w, 1, lc.base);
        b.set(s < 0 ? x : x + w - 1, top + j, lc.dark);        // the outer break
        b.set(s < 0 ? x + w - 1 : x, top + j, lc.lite);        // the inner fold
      }
      // The collar, standing up either side of the neck, and its peak.
      b.rect(s < 0 ? cx - openH - 4 : cx + openH + 1, top - 2, 4, 2, lc.base);
      b.hline(s < 0 ? cx - openH - 4 : cx + openH + 1, top - 2, 4, lc.lite);
      b.set(s < 0 ? cx - openH - 5 : cx + openH + 4, top - 1, lc.dark);
    }
  } else {
    // lapels and a split hem, so the coat has edges of its own
    b.vline(cx - 2, top, 4, c.dark);
    b.vline(cx + 2, top, 4, c.dark);
    b.set(cx - 3, top + 1, c.lite);
    b.set(cx + 3, top + 1, c.lite);
  }
  if (d.coatButtons) {
    // A DOUBLE row of buttons. A single centre row of dots is a seam at this
    // size — nothing on a garment comes in pairs except buttons, so two columns
    // either side of the opening is the only spelling of "military coat" that
    // survives the outline pass.
    const bc = slotRamp(d.coatButtons, d.accent || '#e8c34a');
    for (let y = top + 3; y < hipY - 1; y += 4) {
      for (const s of [-1, 1]) {
        // Two pixels square, not one. A single pixel of gold on a red coat is
        // noise the outline pass does not even reach; two with a lit corner and
        // a shadowed one is a sphere, and a column of spheres is a button row.
        const x = cx + s * (openH + 2) - (s < 0 ? 1 : 0);
        b.rect(x, y, 2, 2, bc.base);
        b.set(x, y, bc.lite);
        b.set(x + 1, y + 1, bc.dark);
      }
    }
  }
  b.hline(cx - halfTop - 3, hem, halfTop * 2 + 7, c.deep);
  // The shadow the hem throws onto whatever is under it. This is the single
  // clearest thing the reference sheet does that this file did not: every
  // garment edge on it has a dark line BELOW the edge, on the next layer down,
  // and it is that line rather than the colour change which makes the layers
  // read as separate pieces of cloth instead of as one painted surface.
  b.castShadow(cx - halfTop - 3, hem + 1, halfTop * 2 + 7, 0.34);
  b.set(cx, hem, c.deep);
  b.set(cx, hem - 1, c.deep);
  // Two fold creases in the skirt of the coat.
  b.line(cx - halfTop, hipY - 1, cx - halfTop - 2, hem - 1, c.deep);
  b.line(cx + halfTop, hipY - 1, cx + halfTop + 2, hem - 1, c.deep);
  if (d.coatTrim) {
    b.vline(cx - halfTop - 1, top + 1, hem - top - 1, d.coatTrim);
    b.vline(cx + halfTop + 1, top + 1, hem - top - 1, d.coatTrim);
    b.hline(cx - halfTop - 3, hem - 1, halfTop * 2 + 7, d.coatTrim);
  }
  if (d.coatRagged) {
    // A torn hem. Threads hanging a row or two below the finished edge, rather
    // than pixels bitten out of it — the buffer has no eraser, and adding cloth
    // below the line reads as "this has been shredded" every bit as well as
    // removing cloth above it would, because outline() then wraps the tatters
    // and the SILHOUETTE goes ragged, which is where the read actually lives.
    // Only the outer band gets them: the hem's middle hangs over the legs, and a
    // strip of coat dangling down a shin looks like damage to the renderer.
    for (let i = halfTop - 1; i <= halfTop + 3; i += 2) {
      for (const s of [-1, 1]) b.set(cx + s * i, hem + 1, c.base);
    }
    b.set(cx - halfTop - 1, hem + 2, c.dark);
    b.set(cx + halfTop + 1, hem + 2, c.dark);
  }
}

/**
 * A PINAFORE — a bib panel over the chest on two shoulder straps, an apron over
 * the skirt with a frilled hem, and the bow of its waist tie showing past both
 * hips.
 *
 * This exists because `coat` was standing in for it, and a coat is not an apron:
 * a coat has lapels, an open front and a hem that reaches the boot, and all
 * three of those are exactly wrong. The bib is deliberately NARROWER than the
 * chest so the dress shows on either side of it — an apron the full width of the
 * torso is just a second shirt in a lighter colour, which is precisely what the
 * stand-in looked like.
 *
 * The bow is the one part that cannot be drawn where it belongs. It is tied at
 * the BACK of the waist, and every column between the hips is occupied by an arm
 * hanging over it, so what gets drawn is what a back bow actually shows from the
 * front: the loops standing proud of the hips just outside the arms, and the two
 * ribbon ends falling past them.
 */
function drawPinafore(b, m, P, d) {
  const c = slotRamp(d.pinafore, '#f4f1ea');
  const frill = d.pinaforeTrim ? slotRamp(d.pinaforeTrim, c.dark) : c;
  const { cx, shoulderY, hipY, halfTop, halfBot, armOut } = m;
  const bw = Math.max(2, halfTop - 2);
  const bibTop = shoulderY + 2;
  const bibH = Math.max(3, hipY - bibTop - 2);
  b.rect(cx - bw, bibTop, bw * 2 + 1, bibH, c.base);
  b.hline(cx - bw, bibTop, bw * 2 + 1, c.lite);
  b.vline(cx + bw, bibTop + 1, bibH - 1, c.dark);
  b.vline(cx - bw, bibTop + 1, bibH - 1, c.base);
  // The straps, set in from the bib's own corners and running back over the
  // shoulder. Without them the bib is a panel sewn to the front of the dress.
  for (const s of [-1, 1]) {
    b.vline(cx + s * bw, shoulderY - 1, 3, c.base);
    b.set(cx + s * bw, shoulderY - 1, c.lite);
    b.set(cx + s * (bw - 1), bibTop, c.lite);
  }
  // The waist tie, holding the apron on.
  b.hline(cx - bw - 1, hipY - 2, bw * 2 + 3, c.base);
  b.hline(cx - bw - 1, hipY - 1, bw * 2 + 3, c.dark);
  // The apron skirt: SHORTER than the dress under it, and finished with a frill
  // of alternating pixels rather than a ruled line, which is the whole
  // difference between an apron and a tablecloth.
  const aw = halfBot + 2;
  b.taper(cx - aw, hipY, aw * 2 + 1, aw * 2 + 3, 3, c.base);
  b.hline(cx - aw + 1, hipY, aw * 2 - 1, c.lite);
  for (let i = -aw - 1; i <= aw + 1; i++) {
    b.set(cx + i, hipY + 3, i & 1 ? frill.base : frill.dark);
  }
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - armOut - 3 : cx + armOut + 1;
    b.rect(x, hipY, 3, 4, c.base);                      // a loop of the bow
    b.hline(x, hipY, 3, c.lite);
    b.hline(x, hipY + 3, 3, c.dark);
    b.set(s < 0 ? x + 2 : x, hipY + 1, c.deep);         // where it gathers
    b.rect(s < 0 ? x + 1 : x, hipY + 4, 2, 3, c.base);  // and the end it trails
    b.hline(s < 0 ? x + 1 : x, hipY + 6, 2, c.deep);
  }
}

function drawArms(b, m, P, d) {
  const { cx, shoulderY, hipY, elbowY, armOut, armW } = m;
  const top = shoulderY + 1;
  const h = Math.max(3, hipY - top + 1);
  const detached = !!d.detachedSleeves;
  const c = detached ? slotRamp(d.detachedSleeves, d.outfit || '#5f7fd6')
          : typeof d.sleeve === 'string' ? ramp(d.sleeve) : P.cloth;
  const sleeveTop = detached ? top + 3 : top;
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - armOut : cx + armOut - armW + 1;
    if (detached) {
      // The gap is the feature: a bare shoulder, then a sleeve that starts
      // partway down the arm and is obviously not attached to anything.
      b.rect(x, top, armW, 3, P.skin.base);
      b.hline(x, top, armW, P.skin.lite);
    }
    b.rect(x, sleeveTop, armW, hipY - sleeveTop + 1, c.dark);
    b.vline(s < 0 ? x : x + armW - 1, sleeveTop, hipY - sleeveTop + 1, c.base);
    // A shadow seam down the INNER edge, where the arm meets the torso. Without
    // it an arm in the same cloth as the shirt is not an arm, it is more shirt.
    b.vline(s < 0 ? x + armW - 1 : x, sleeveTop, hipY - sleeveTop + 1, c.deep);
    b.hline(x, sleeveTop, armW, c.base);                      // deltoid catch-light
    b.hline(x, elbowY, armW, c.deep);                         // elbow break
    if (detached) {
      b.hline(x, sleeveTop, armW, c.lite);
      b.hline(x, hipY, armW, c.lite);                         // the flared cuff
      b.set(s < 0 ? x - 1 : x + armW, hipY, c.base);
    }
  }
  if (d.armWraps) {
    // Bandage wraps on the forearms only: pale, with a notch every other row so
    // it reads as wound cloth rather than as a white sleeve.
    const w = slotRamp(d.armWraps, '#e8e8f0');
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - armOut : cx + armOut - armW + 1;
      b.rect(x, elbowY + 1, armW, hipY - elbowY, w.base);
      for (let j = elbowY + 2; j <= hipY; j += 2) b.hline(x, j, armW, w.dark);
      b.set(s < 0 ? x : x + armW - 1, elbowY + 1, w.lite);
    }
  }
  if (d.armWings) {
    // Feather accents jutting off the forearms. Not wings — the brief is very
    // specific that they are worn, so they hang off the arm and go no higher.
    const c2 = slotRamp(d.armWings, d.accent || '#ffb84a');
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - armOut - 3 : cx + armOut + 1;
      for (let j = 0; j < 5; j++) {
        const w = Math.max(1, 3 - (j >> 1));
        b.hline(s < 0 ? x + 3 - w : x, elbowY - 1 + j, w, j & 1 ? c2.base : c2.lite);
      }
      b.set(s < 0 ? x : x + 2, elbowY + 1, c2.deep);
    }
  }
  if (d.gauntlets) {
    const g = slotRamp(d.gauntlets, d.accent || '#9aa7bd');
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - armOut : cx + armOut - armW + 1;
      b.rect(x, hipY - 3, armW, 4, g.base);
      b.hline(x, hipY - 3, armW, g.lite);
      b.set(s < 0 ? x - 1 : x + armW, hipY - 3, g.lite);      // the cuff flare
      b.hline(x, hipY - 1, armW, g.deep);
    }
  }
  if (d.coatCuffs) {
    // A COAT CUFF: the wide funnel a dress-coat sleeve is turned back into.
    //
    // Not `cuffs`, which is two rows of a narrow band belonging to nobody's
    // sleeve. This one belongs to the garment, so it is FOUR rows deep, takes
    // the coat's own colour by default, stands a pixel proud on BOTH sides
    // rather than only outboard, and carries the coat's trim along its lip. At
    // 30x42 the two are the same six pixels and telling them apart is the
    // difference between a maid and a captain, which is why they are separate
    // features rather than one feature with a size.
    const cc = slotRamp(d.coatCuffs, typeof d.coat === 'string' ? d.coat : (d.accent || '#c8203a'));
    const lip = slotRamp(d.coatTrim, mixHex(cc.lite, WHITE, 0.35));
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - armOut - 1 : cx + armOut - armW;
      const w = armW + 2;
      b.rect(x, hipY - 3, w, 4, cc.base);
      b.hline(x, hipY - 3, w, cc.lite);
      b.hline(x, hipY, w, lip.base);
      b.set(s < 0 ? x : x + w - 1, hipY, lip.lite);
      b.vline(s < 0 ? x : x + w - 1, hipY - 2, 2, cc.deep);
    }
  }
  if (d.cuffs) {
    // DETACHED CUFFS: a band at the wrist that is not the bottom of a sleeve.
    // Two things make it read as its own garment at 30x42 — it is a pixel PROUD
    // of the arm on the outboard side, which no sleeve ever is, and it sits
    // below the sleeve's own hem with the lit row on top, so there is a visible
    // step where one ends and the other begins. Drawn after `detachedSleeves`
    // on purpose: a character can wear both, and the cuff is the outer layer.
    const cf = slotRamp(d.cuffs, '#f4f1ea');
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - armOut - 1 : cx + armOut - armW + 1;
      b.rect(x, hipY - 1, armW + 1, 2, cf.base);
      b.hline(x, hipY - 1, armW + 1, cf.lite);
      b.hline(x, hipY, armW + 1, cf.dark);
      b.set(s < 0 ? x : x + armW, hipY + 1, cf.deep);
    }
  }
  // THE ARM SWING, and it is CONTRALATERAL — the hand on the same side as the
  // forward leg swings BACK. That is the only thing separating a walk from a
  // shuffle, and getting it the wrong way round is instantly, unaccountably
  // wrong to look at even though nobody can say why.
  //
  // Front-on there is nowhere for a hand to swing TO, so what gets drawn is the
  // one row of travel and the tone that comes with it: the forward hand drops a
  // row into the light, the back hand rises a row and loses it. The dropped hand
  // leaves a one-row gap where the sleeve used to end, which is filled with the
  // sleeve's own shadow — a detached hand floating below a cuff is the single
  // most obvious way this can go wrong.
  const pose = m.pose || POSE_IDLE;
  const handY = hipY + 1;
  const gl = d.gloves ? slotRamp(d.gloves, d.accent || '#2b2b3a') : P.skin;
  for (const s of [-1, 1]) {
    const sw = -(s < 0 ? pose.l : pose.r);
    const x = s < 0 ? cx - armOut : cx + armOut - armW + 1;
    const y = handY + sw;
    if (sw > 0) b.hline(x, handY, armW, c.deep);               // the wrist
    b.rect(x, y, armW, 3, gl.base);
    b.hline(x, y, armW, sw > 0 ? gl.lite : gl.base);
    b.hline(x, y + 2, armW, sw < 0 ? gl.deep : gl.dark);
    b.set(s < 0 ? x + armW - 1 : x, y + 1, gl.dark);           // the knuckle break
  }
}

/**
 * A SHORT SHOULDER CAPE — a mantle worn OPEN over the shoulders and upper arms,
 * stopping well above the waist.
 *
 * `cape` is the other garment and not a longer version of this one: it hangs
 * from the shoulders to the boot and its whole read is a tall triangle behind
 * the legs. A mantle's read is the opposite — a hard horizontal hem across the
 * upper arm, high enough that the figure's waist is still visible under it.
 *
 * It is drawn as a yoke plus two panels rather than as one slab, because a
 * mantle closed across the chest covers exactly the rows a coat keeps its
 * buttons and its crest on, and a uniform whose front is hidden by its own
 * cloak is a cloak.
 */
function drawShoulderCape(b, m, P, d) {
  const c = slotRamp(d.shoulderCape, d.accent || '#e8e4dc');
  const { cx, shoulderY, hipY, halfTop, armOut } = m;
  const w = armOut + 2;
  const h = Math.max(4, Math.round((hipY - shoulderY) * 0.42));
  b.rect(cx - w, shoulderY - 1, w * 2 + 1, 2, c.base);            // the yoke
  b.hline(cx - w + 1, shoulderY - 1, w * 2 - 1, c.lite);
  const pw = Math.max(3, w - halfTop + 3);
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - w : cx + halfTop - 2;
    b.rect(x, shoulderY + 1, pw, h, c.base);
    b.vline(s < 0 ? x : x + pw - 1, shoulderY + 1, h, c.dark);    // the outer fold
    b.vline(s < 0 ? x + pw - 1 : x, shoulderY + 1, h, c.deep);    // the inner break
    b.hline(x, shoulderY + h, pw, c.dark);
    // A scalloped hem. A mantle that ends in a ruled line is a shelf.
    for (let i = 0; i < pw; i += 2) b.set(x + i, shoulderY + h + 1, c.deep);
    b.set(s < 0 ? x + 1 : x + pw - 2, shoulderY + 2, c.lite);
  }
}

/**
 * The strap of an eyepatch, running back over the temple and up across the
 * skull.
 *
 * It is DIAGONAL on purpose. A dark band straight across the brow is a
 * headband — there is a whole feature by that name six functions down — and the
 * only thing that separates the two at this size is the angle, so the strap
 * climbs a row for every two or three columns it travels and finishes above the
 * ear rather than beside it. The far side gets one short segment where the
 * strap comes back over the crown, which costs three pixels and is what makes
 * it read as something that goes AROUND a head.
 */
function drawEyepatchStrap(b, m, P, d) {
  const c = slotRamp(d.eyepatchStrap,
                     typeof d.eyepatchColor === 'string' ? d.eyepatchColor : '#14141c');
  const { cx, headY, headR } = m;
  const s = d.eyepatch === 'right' ? 1 : -1;
  const top = headY - headR;
  const x0 = cx + s * (headR - 3);            // the patch's outer edge
  const x1 = cx + s * headR;                  // the temple
  const x2 = cx + s * Math.max(1, headR - 3); // where it passes over the skull
  b.line(x0, headY - 3, x1, headY - 4, c.base);
  b.line(x0, headY - 2, x1, headY - 3, c.dark);
  b.line(x1, headY - 4, x2, top + 1, c.base);
  b.line(x1 - s, headY - 4, x2 - s, top + 1, c.dark);
  b.rect(x1 - (s < 0 ? 0 : 1), headY - 5, 2, 2, c.lite);          // the buckle
  b.set(x1 - (s < 0 ? 0 : 1), headY - 5, mixHex(c.lite, WHITE, 0.4));
  // and the far side, where it comes back over the crown
  b.line(cx - s * Math.max(1, headR - 4), top, cx - s * (headR - 1), top + 2, c.dark);
}

/** Rigging worn over the garment: shoulder straps, a chest strap, hip canisters. */
function drawHarness(b, m, P, d) {
  const c = slotRamp(d.harness, '#6a6250');
  const { cx, shoulderY, hipY, halfTop, halfBot } = m;
  for (const s of [-1, 1]) {
    b.vline(cx + s * 3, shoulderY, hipY - shoulderY - 1, c.base);
    b.set(cx + s * 3, shoulderY, c.lite);
    b.line(cx + s * 3, shoulderY + 4, cx + s * (halfTop - 1), hipY - 2, c.dark);
  }
  b.hline(cx - halfTop + 1, shoulderY + 4, halfTop * 2 - 1, c.dark);
  b.rect(cx - 1, shoulderY + 4, 3, 2, c.lite);                 // the buckle
  for (const s of [-1, 1]) {
    // Hip canisters. They are what makes the silhouette read as rigged rather
    // than merely belted, and they are the only thing below the waist doing it.
    const x = s < 0 ? cx - halfBot - 3 : cx + halfBot + 1;
    b.rect(x, hipY, 2, 5, c.base);
    b.hline(x, hipY, 2, c.lite);
    b.hline(x, hipY + 4, 2, c.deep);
  }
}

/**
 * Shoulder armour. `pauldron:'left'|'right'` puts it on ONE side, on purpose —
 * a single asymmetric shoulder pad is a whole costume in one feature, and the
 * mirrored pair it used to force made two very different designs look alike.
 * The SIDE lives in `pauldron` and the COLOUR in `pauldrons`, so neither slot
 * ever has to be parsed as the other.
 */
function drawPauldrons(b, m, P, d) {
  const which = d.pauldron;
  const c = slotRamp(d.pauldrons, d.accent || '#9aa7bd');
  const { cx, shoulderY, armOut } = m;
  const sides = which === 'left' ? [-1] : which === 'right' ? [1] : [-1, 1];
  for (const s of sides) {
    const x = s < 0 ? cx - armOut - 2 : cx + armOut - 1;
    b.rect(x, shoulderY - 1, 4, 4, c.base);
    b.hline(x, shoulderY - 1, 4, c.lite);
    b.hline(x, shoulderY + 3, 4, c.deep);
    b.hline(x + (s < 0 ? 0 : 1), shoulderY + 4, 3, c.dark);    // the second lame
    b.set(s < 0 ? x : x + 3, shoulderY, c.lite);               // outer rivet
  }
}

/** Collars, scarves, cravats. Drawn AFTER the head, so the neck cannot cut it. */
function drawNeckwear(b, m, P, d) {
  const { cx, chinY, shoulderY, headR, armOut, hipY } = m;
  if (d.highCollar) {
    // A stand collar reaching the jaw. It is most of the read on a character
    // whose whole design note is "concealed", and it costs six rows.
    const c = slotRamp(d.highCollar, d.outfit || '#243050');
    const w = headR * 2 - 1;
    b.rect(cx - headR + 1, chinY, w, shoulderY - chinY + 3, c.base);
    b.hline(cx - headR + 1, chinY, w, c.lite);
    b.vline(cx - headR + 1, chinY - 1, 3, c.base);             // the two peaks
    b.vline(cx + headR - 1, chinY - 1, 3, c.base);
    b.set(cx - headR + 1, chinY - 1, c.lite);
    b.set(cx + headR - 1, chinY - 1, c.lite);
    b.vline(cx, chinY + 1, shoulderY - chinY + 2, c.dark);
  }
  if (d.neckBow) {
    // A ribbon tied in a BOW at the throat. Three garments live in exactly this
    // six-pixel window and none of them may be drawn as either of the others:
    // `scarf` is wrapped cloth with one long end whipping out to the side,
    // `tie` is a knot with a single blade running down the shirt, and this is a
    // short ribbon with two LOOPS and two stubby tails. Two of the cast were
    // wearing a scarf because a bow was the one the vocabulary could not say.
    const c = slotRamp(d.neckBow, d.accent || '#c8342a');
    const y = chinY + 1;
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - 4 : cx + 2;
      b.rect(x, y, 2, 2, c.base);                              // the loops
      b.hline(x, y, 2, c.lite);
      b.set(s < 0 ? x : x + 1, y + 1, c.dark);
    }
    b.rect(cx - 1, y, 3, 2, c.base);                           // the knot
    b.set(cx, y, mixHex(c.lite, WHITE, 0.35));
    b.set(cx, y + 1, c.deep);
    b.set(cx - 1, y + 2, c.dark);                              // the two tails
    b.set(cx + 1, y + 2, c.dark);
    b.set(cx - 1, y + 3, c.deep);
    b.set(cx + 1, y + 3, c.deep);
  }
  if (!d.scarf) return;
  const c = slotRamp(d.scarf, d.accent || '#c8342a');
  const y = chinY;
  // Narrower than the head, not wider: a neckpiece that reaches past the jaw on
  // both sides stops being neckwear and becomes a bib.
  b.hline(cx - headR + 2, y, headR * 2 - 3, c.base);
  b.hline(cx - headR + 1, y + 1, headR * 2 - 1, c.base);
  b.hline(cx - headR + 2, y + 2, headR * 2 - 3, c.dark);
  b.hline(cx - headR + 2, y, headR * 2 - 3, c.lite);
  b.set(cx - 1, y + 1, c.deep);
  b.set(cx + 1, y + 1, c.deep);
  b.rect(cx - 1, y + 1, 3, 2, c.base);                         // the knot
  // the tail, whipping out to one side
  const tx = cx - armOut - 1;
  const len = Math.min(hipY - shoulderY + 3, 10);
  for (let j = 0; j < len; j++) b.set(tx - ((j / 3) | 0), shoulderY + 1 + j, j & 1 ? c.dark : c.base);
}

function drawHead(b, m, P, d) {
  const { cx, headY, headR, chinY, shoulderY } = m;
  const nw = headR >= 7 ? 5 : 3;
  b.rect(cx - (nw >> 1), chinY, nw, Math.max(1, shoulderY - chinY + 1), P.skin.dark);
  b.hline(cx - (nw >> 1), chinY, nw, P.skin.base);
  b.ellipse(cx, headY, headR - 1, headR - 1, P.skin.base);
  // A tapered jaw drawn explicitly rather than left to the ellipse: a circle
  // with eyes on it is a smiley, and three hlines is the whole difference.
  const jw = Math.max(2, headR - 2);
  b.hline(cx - jw, chinY - 2, jw * 2 + 1, P.skin.base);
  b.hline(cx - jw + 1, chinY - 1, jw * 2 - 1, P.skin.base);
  b.hline(cx - 1, chinY, 3, P.skin.base);
  b.hline(cx - headR + 3, headY - headR + 2, headR * 2 - 5, P.skin.lite);   // brow light
  // The shadow the jaw casts down the neck. Without it the head and the neck are
  // one continuous column of the same skin tone and the chin has no underside.
  b.castShadow(cx - (nw >> 1), chinY + 1, nw, 0.30);
  b.set(cx - headR + 2, chinY - 1, P.skin.dark);               // jaw corners
  b.set(cx + headR - 2, chinY - 1, P.skin.dark);
  // Ear nubs. Small, but earrings have to hang off something.
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - headR + 1 : cx + headR - 2;
    b.vline(x, headY, 2, P.skin.base);
    b.set(x, headY + 1, P.skin.dark);
  }
}

function drawFace(b, m, P, d) {
  const { cx, headY, headR, chinY } = m;
  const big = headR >= 5;
  const eyeW = big ? 3 : 2;
  const eyeH = big ? 3 : 2;
  const eyeY = headY - 1;
  const inset = 1;
  const iris = ramp(P.eyes);
  const covered = d.eyepatch ? (d.eyepatch === 'right' ? 1 : -1) : 0;
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - inset - eyeW : cx + inset + 1;
    // THE SCLERA HAS TO SURVIVE. The first version painted the iris across the
    // whole eye and then lit its bottom row, which left no white anywhere: two
    // dark blocks in a skin-coloured oval, invisible on nine of the roster. The
    // iris now takes the OUTER two columns and the white stays, so every eye
    // reads at a glance and the eye colour is still legible inside it.
    b.hline(x, eyeY - 1, eyeW, P.hair.deep);                   // lash line
    b.set(s < 0 ? x - 1 : x + eyeW, eyeY - 1, P.hair.deep);    // the outer corner
    b.rect(x, eyeY, eyeW, eyeH, EYE_WHITE);
    const ix = s < 0 ? x : x + eyeW - 2;
    b.rect(ix, eyeY, 2, eyeH, iris.base);
    b.set(ix + (s < 0 ? 0 : 1), eyeY + 1, iris.deep);          // pupil
    b.set(ix + (s < 0 ? 0 : 1), eyeY, WHITE);                  // catch-light
    b.set(ix + (s < 0 ? 1 : 0), eyeY + eyeH - 1, iris.lite);   // lit lower rim
    if (d.eyeSigil) {
      // A mark orbiting the pupil. At three pixels across, one contrasting dot
      // off-centre is the only "this eye is doing something" that survives.
      const sg = typeof d.eyeSigil === 'string' ? d.eyeSigil : '#14141c';
      b.set(ix + (s < 0 ? 1 : 0), eyeY, sg);
    }
    if (P.glow) b.set(s < 0 ? x + eyeW - 1 : x, eyeY + eyeH, P.glow);
  }
  // Nose and mouth. Two pixels each, and no wider — a 3px mouth plus a 2px
  // blush on each cheek joined up into one line straight across the face.
  b.set(cx, chinY - 3, P.skin.dark);
  b.set(cx - 1, chinY - 1, mixHex(P.skin.deep, '#c05a5a', 0.5));
  b.set(cx, chinY - 1, P.skin.deep);
  if (d.blush !== false) {
    const bl = mixHex(P.skin.base, '#ff8a9a', 0.4);
    b.set(cx - headR + 2, chinY - 2, bl);
    b.set(cx + headR - 2, chinY - 2, bl);
  }
  if (d.whiskers) {
    // Three marks per cheek. Two is a smudge and four is a grille; three is the
    // thing being referenced and it has to be countable.
    const wc = typeof d.whiskers === 'string' ? d.whiskers : mixHex(P.skin.dark, '#7a4a2a', 0.6);
    for (const s of [-1, 1]) {
      // Inset by one more than looks right on paper: at row chinY-1 the jaw has
      // already tapered, and a whisker one column wider hangs off the face.
      const x = s < 0 ? cx - headR + 3 : cx + headR - 4;
      for (let k = 0; k < 3; k++) b.hline(x, eyeY + eyeH + k, 2, wc);
    }
  }
  if (covered) {
    // The patch covers one eye entirely, and the strap runs back to the temple
    // on that side only — a strap across both eyes is a blindfold.
    const c = slotRamp(d.eyepatchColor, '#14141c');
    const s = covered;
    const x = s < 0 ? cx - inset - eyeW - 1 : cx + inset;
    b.rect(x, eyeY - 2, eyeW + 2, eyeH + 2, c.base);
    b.hline(x, eyeY - 2, eyeW + 2, c.lite);
    b.hline(x, eyeY + eyeH - 1, eyeW + 2, c.deep);
    b.set(x + 1, eyeY, mixHex(c.lite, WHITE, 0.35));
    b.hline(s < 0 ? cx - headR + 1 : cx + inset + eyeW + 1, eyeY - 2,
            headR - inset - eyeW + 1, c.dark);
  }
  if (d.mask) {
    // A lower-face wrap. Covers the mouth, leaves the eyes doing all the work.
    const mc = slotRamp(d.mask, d.accent || '#243050');
    b.rect(cx - headR + 2, eyeY + eyeH, headR * 2 - 3, chinY - eyeY - eyeH + 1, mc.base);
    b.hline(cx - headR + 2, eyeY + eyeH, headR * 2 - 3, mc.lite);
    b.hline(cx - headR + 2, chinY, headR * 2 - 3, mc.dark);
  }
  if (d.visor) {
    const vc = slotRamp(d.visor, '#8ad8ff');
    b.rect(cx - headR + 1, eyeY - 1, headR * 2 - 1, eyeH + 1, vc.dark);
    b.hline(cx - headR + 1, eyeY, headR * 2 - 1, vc.base);
    b.set(cx - headR + 2, eyeY - 1, vc.lite);
    b.set(cx + headR - 2, eyeY + 1, vc.lite);
    b.hline(cx - 1, eyeY, 3, vc.deep);                         // the bridge
  }
}

// ---------------------------------------------------------------------------
// HAIR. THREE passes — the mass behind the head, the cap UNDER the face, then
// the fringe on top of it. The order matters: a fringe drawn beneath the face is
// invisible, and a cap drawn over it paints out the eyes, which is exactly what
// a single-pass hair routine does. Every pass uses at least three tones of the
// ramp, because two tones is a helmet.
// ---------------------------------------------------------------------------

function drawHairBack(b, m, P, d) {
  const style = d.hair || 'short';
  const hc = P.hair;
  const { cx, headY, headR, chinY, shoulderY, hipY, bootY, bottom, armOut, W } = m;
  const top = headY - headR;
  const side = headR;
  const tie = d.hairTie ? slotRamp(d.hairTie, d.accent || '#c8203a') : P.trim;
  switch (style) {
    case 'long':
      b.taper(cx - side - 1, top + 1, side * 2 + 3, side * 2 + 5, hipY - top, hc.base);
      b.vline(cx - side - 1, top + 3, hipY - top - 4, hc.dark);
      b.vline(cx + side + 1, top + 3, hipY - top - 4, hc.dark);
      b.vline(cx - side, top + 5, hipY - top - 8, hc.lite);    // one lit strand
      for (let i = -side - 1; i <= side + 1; i += 3) b.set(cx + i, hipY, hc.deep);
      break;
    case 'bangs':   // long and straight, curtained past the shoulders
      b.pair(cx, side, top + 1, 2, chinY - top + 8, hc.base);
      b.pair(cx, side + 1, top + 3, 1, chinY - top + 5, hc.dark);
      b.pair(cx, side - 1, top + 4, 1, chinY - top + 4, hc.lite);
      b.taper(cx - side, top, side * 2 + 1, side * 2 + 1, 4, hc.base);
      break;
    case 'bob':
      b.taper(cx - side - 1, top + 1, side * 2 + 3, side * 2 + 1, chinY - top + 2, hc.base);
      b.pair(cx, side, chinY - 1, 2, 3, hc.dark);              // the inward curl
      b.pair(cx, side - 1, top + 3, 1, 4, hc.lite);
      break;
    case 'wave':
      for (let j = 0; j <= chinY + 4 - top; j++) {
        const w = side + 1 + ((j >> 1) & 1);
        b.pair(cx, w - 1, top + 1 + j, 2, 1, j & 1 ? hc.base : hc.dark);
        if (j % 4 === 1) b.pair(cx, w - 2, top + 1 + j, 1, 1, hc.lite);
      }
      break;
    case 'twin':
      b.pair(cx, side, top + 2, 3, 4, hc.base);                // the bunches
      b.pair(cx, side + 1, top + 6, 2, shoulderY - top + 4, hc.base);
      b.pair(cx, side + 2, top + 7, 1, shoulderY - top + 2, hc.dark);
      b.pair(cx, side, top + 8, 1, shoulderY - top, hc.lite);
      b.pair(cx, side, top + 5, 3, 2, tie.base);               // the ribbons
      b.pair(cx, side + 1, top + 4, 2, 1, tie.lite);
      break;
    case 'twinLong': {
      // LONG twin-tails: the same pair of bunches at the temples as `twin`, and
      // then two heavy falls that keep going, past the hip and down to the boot.
      //
      // `twin` stops at the shoulder, which is the correct read for the one
      // small character who wears it and completely wrong for a brief that
      // leads with the word LONG. Rather than lengthening `twin` and quietly
      // restyling somebody else, this is its own case, and it earns the split by
      // doing three things `twin` does not: the fall SWINGS OUT past the arms
      // (a tail hanging where an elbow already is gets chopped in half), it
      // keeps a lit thread and a dark seam down its whole length instead of two
      // flat columns, and it ends in a point rather than a squared-off stub.
      const bunchY = top + 2;
      b.pair(cx, side, bunchY, 4, 5, hc.base);                 // the bunches
      b.pair(cx, side + 1, bunchY + 1, 2, 3, hc.lite);
      b.pair(cx, side, bunchY + 4, 4, 1, hc.dark);
      b.pair(cx, side, bunchY + 5, 4, 2, tie.base);            // the ribbons
      b.pair(cx, side + 1, bunchY + 5, 2, 1, tie.lite);
      b.pair(cx, side, bunchY + 6, 4, 1, tie.dark);
      b.pair(cx, side + 3, bunchY + 4, 2, 3, tie.base);        // a loop standing out
      b.pair(cx, side + 3, bunchY + 4, 1, 1, tie.lite);
      const y0 = bunchY + 7;
      const outer = Math.max(side, armOut + 2);
      const len = Math.max(8, Math.min(bottom - 2, bootY) - y0);
      for (let j = 0; j <= len; j++) {
        const y = y0 + j;
        if (y > bottom) break;
        const t = j / len;
        // Out to the arm's outside over the first third, then a slow drift back
        // in: hair falling dead straight from a bunch is a curtain rod.
        const dx = side + Math.round((outer - side) * Math.min(1, t * 3))
                        - (t > 0.72 ? 1 : 0);
        const w = Math.max(2, Math.round(3.6 - 1.6 * t));
        b.pair(cx, dx, y, w, 1, hc.base);
        b.pair(cx, dx + w - 1, y, 1, 1, hc.dark);              // the outer seam
        // A NEAR-WHITE thread, not hc.lite. Three of the falls on this roster
        // are on hair dark enough that the whole ramp is within a few points of
        // black, and a highlight the ramp derives is then a highlight nobody
        // can see: the tail comes out as a solid slab the width of an arm.
        if (j % 5 !== 4) b.pair(cx, dx, y, 1, 1, mixHex(hc.lite, WHITE, 0.22));
        if (j % 7 === 6) b.pair(cx, dx + 1, y, 1, 1, hc.deep); // a strand break
      }
      const tipY = Math.min(bottom, y0 + len + 1);
      b.pair(cx, outer - 1, tipY, 2, 1, hc.dark);
      b.pair(cx, outer - 1, Math.min(bottom, tipY + 1), 1, 1, hc.deep);
      break;
    }
    case 'drills': {
      // TWIN DRILLS. The only pair in the whole cast, and half the silhouette of
      // the character who wears them, so this style gets more code than any
      // other and earns it.
      //
      // The previous pass stacked shrinking blocks all anchored to the same
      // outer column. That is not a ringlet, it is a triangle: it read as a
      // spear of hair taped to the head. A corkscrew only reads when three
      // things happen at once — the SILHOUETTE scallops on the coil's pitch, a
      // LIT THREAD wraps across the width and resets, and a DARK SEAM marks the
      // row where the coil passes behind itself. Any two of the three gives you
      // a cone with stripes painted on it.
      //
      // The drill also has to swing OUTWARD as it falls, and not for style: the
      // arms hang over columns armOut-armW+1..armOut from the shoulder down, so
      // a drill that stays where the temple put it is chopped in half by an
      // elbow and the character loses the read they were built around.
      //
      // The bunch and the ribbon both sit at `side` and not inboard of it. One
      // column further in and drawHairCap's crown ellipse — which runs the full
      // width of the head and is drawn AFTER this pass — paints over most of
      // both, which is how a character whose brief names the colour of her
      // ribbons ended up with two pixels of them showing.
      const bunchY = top + 2;
      b.pair(cx, side, bunchY, 5, 5, hc.base);                 // the bunch
      b.pair(cx, side + 1, bunchY + 1, 2, 3, hc.lite);
      b.pair(cx, side, bunchY + 4, 5, 1, hc.dark);
      // The RIBBON that ties it: `drills` ignored hairTie entirely, so the one
      // pair of drills in the cast was tied with nothing at all. A band, and one
      // loop standing off the outboard side so it reads as a bow and not a cuff.
      b.pair(cx, side, bunchY + 5, 5, 2, tie.base);
      b.pair(cx, side + 1, bunchY + 5, 2, 1, tie.lite);
      b.pair(cx, side, bunchY + 6, 5, 1, tie.dark);
      b.pair(cx, side + 4, bunchY + 3, 2, 3, tie.base);
      b.pair(cx, side + 4, bunchY + 3, 1, 1, tie.lite);
      const y0 = bunchY + 7;
      const outer = Math.max(side, armOut + 1);
      const len = Math.max(8, Math.min(bottom - 2, hipY + 2) - y0);
      for (let j = 0; j <= len; j++) {
        const y = y0 + j;
        if (y > bottom) break;
        const t = j / len;
        const k = j & 3;
        const dx = side + Math.round((outer - side) * Math.min(1, t * 3));
        // The +1 on the middle two rows of every turn is the scallop: it is what
        // puts the coil into the outline, where it survives being three colours
        // deep in a crowd of two hundred.
        const w = Math.min(Math.max(2, Math.round(6 - 4 * t)) + (k === 1 || k === 2 ? 1 : 0),
                           Math.max(2, W - 1 - cx - dx));
        b.pair(cx, dx, y, w, 1, k === 0 ? hc.dark : hc.base);
        b.pair(cx, dx + Math.min(w - 1, k), y, 1, 1, k === 0 ? hc.deep : hc.lite);
        if (k === 3) b.pair(cx, dx, y, 1, 1, hc.deep);
      }
      const tipY = Math.min(bottom, y0 + len + 1);
      b.pair(cx, outer, tipY, 2, 1, hc.dark);
      b.pair(cx, outer, Math.min(bottom, tipY + 1), 1, 1, hc.deep);
      break;
    }
    case 'lowTwin': {
      // Two tails gathered LOW, at the nape, rather than high at the temples.
      // Genuinely a different silhouette from `twin` and not a variant of it:
      // the mass sits BEHIND THE JAW and falls straight, so the head reads small
      // and the hair reads heavy, which is the whole note on the one character
      // who wears it. Drawn with `twin` next to it in the roster grid, the two
      // are told apart by where the ties are and nothing else, so the ties are
      // the loudest thing in here.
      //
      // The mass starts BELOW the crown and widens downward. Squared off level
      // with the top of the skull it reads as a flat slab with a face under it,
      // which on the one character in the cast whose hair, robe and skin are all
      // within two shades of white is the difference between a person and a box.
      b.taper(cx - side, top + 2, side * 2 + 1, side * 2 + 5, chinY - top - 1, hc.base);
      b.vline(cx - side - 1, top + 4, chinY - top - 4, hc.dark);
      b.vline(cx + side + 1, top + 4, chinY - top - 4, hc.dark);
      b.vline(cx - side, top + 5, chinY - top - 6, hc.lite);
      b.pair(cx, side - 1, chinY - 2, 3, 1, tie.lite);         // the two low ties
      b.pair(cx, side - 1, chinY - 1, 3, 3, tie.base);
      b.pair(cx, side - 1, chinY + 1, 3, 1, tie.dark);
      const fall = Math.max(6, bootY - chinY);
      const out = Math.max(side - 1, armOut + 2);
      for (let j = 0; j < fall; j++) {
        const y = chinY + 2 + j;
        if (y > bottom) break;
        const dx = (side - 1) + Math.round((out - side + 1) * Math.min(1, j / 3));
        const w = Math.max(2, 4 - ((j * 2 / fall) | 0));
        b.pair(cx, dx, y, w, 1, j % 4 === 0 ? hc.dark : hc.base);
        if (j % 4 === 2) b.pair(cx, dx, y, 1, 1, hc.lite);
      }
      b.pair(cx, out, Math.min(bottom, chinY + 2 + fall), 2, 1, hc.deep);
      break;
    }
    case 'ponytail':
      b.rect(cx + side, top + 2, 3, 4, hc.base);
      b.rect(cx + side + 1, top + 5, 3, hipY - top - 5, hc.base);
      b.vline(cx + side + 3, top + 7, hipY - top - 9, hc.lite);
      b.vline(cx + side + 1, top + 7, hipY - top - 9, hc.dark);
      b.rect(cx + side, top + 4, 3, 2, tie.base);              // the tie
      b.set(cx + side + 2, hipY - 1, hc.deep);
      break;
    case 'sidetail':
      b.rect(cx - side - 3, top + 3, 4, 4, hc.base);
      b.rect(cx - side - 3, top + 6, 3, bootY - top - 10, hc.base);
      b.vline(cx - side - 3, top + 8, 6, hc.lite);
      b.vline(cx - side - 1, top + 8, bootY - top - 14, hc.dark);
      b.rect(cx - side - 3, top + 5, 3, 2, tie.base);
      break;
    case 'braid': {
      // Segmented, with a notch every other row — that is what says "braid".
      const len = bootY - chinY;
      for (let j = 0; j < len; j++) {
        b.rect(cx - side - 3, chinY - 3 + j, 3, 1, j % 3 === 2 ? hc.deep : hc.base);
        if (j % 3 === 0) b.set(cx - side - 3, chinY - 3 + j, hc.lite);
      }
      b.rect(cx - side - 3, bootY - 4, 3, 2, tie.base);        // the tie
      b.taper(cx - side, top, side * 2 + 1, side * 2 + 1, 3, hc.base);
      break;
    }
    case 'topknot':
      b.rect(cx - 2, top - 4, 5, 4, hc.base);
      b.hline(cx - 2, top - 4, 5, hc.lite);
      b.hline(cx - 2, top - 1, 5, hc.dark);
      b.rect(cx - 1, top - 1, 3, 2, tie.base);                 // the band
      b.rect(cx + side - 1, top - 2, 2, 6, hc.dark);           // the loose fall
      b.set(cx + side + 1, top + 1, hc.base);
      break;
    case 'hood':
      b.taper(cx - side - 2, top - 2, side * 2 + 5, side * 2 + 9, chinY - top + 5, hc.base);
      b.vline(cx - side - 2, top + 2, chinY - top, hc.dark);
      b.vline(cx + side + 2, top + 2, chinY - top, hc.dark);
      break;
    case 'plume':
      for (let i = 0; i < 4; i++) {
        b.spike(cx + side - 2 + i, top - i, 3, 6 + i, -1, i & 1 ? hc.lite : hc.base);
        b.spike(cx - side - 1 + i, top - 1 - i, 3, 5 + i, -1, i & 1 ? hc.base : hc.dark);
      }
      break;
    case 'ducktail': {
      // Swept back and up. The read has to come from behind the skull, because
      // the front of this haircut is an ordinary parted fringe.
      b.taper(cx - side - 1, top + 1, side * 2 + 3, side * 2 + 1, chinY - top, hc.base);
      b.vline(cx - side - 1, top + 3, chinY - top - 4, hc.dark);
      b.vline(cx + side + 1, top + 3, chinY - top - 4, hc.dark);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          b.spike(cx + s * (side - 1 + i * 2) - 1, top + 3 + i, 3, 4 + i, -1,
                  i & 1 ? hc.lite : hc.base);
        }
      }
      break;
    }
    case 'undercut':
      // Deliberately almost nothing: the whole point of the cut is that there is
      // no mass at the back, and the silhouette has to say so.
      b.taper(cx - side, top + 1, side * 2 + 1, side * 2 - 1, 4, hc.base);
      break;
    case 'wild':
      b.pair(cx, side, top + 1, 2, 6, hc.base);
      b.pair(cx, side + 1, top + 3, 1, 4, hc.dark);
      b.pair(cx, side - 1, top + 2, 1, 3, hc.lite);
      break;
    default:
      break;
  }
  if (P.tip) {
    // Gradient tips. Applied to the finished back mass so every style inherits
    // it, rather than each style having to grow its own two-colour path.
    b.retint(0, chinY + 2, m.W, m.H - chinY - 2, hc, P.tip);
  }
}

/**
 * The crown of hair, drawn UNDER the face. It is one pixel wider and one row
 * higher than the face ellipse, so a hair rim survives around the temples no
 * matter which style sits on top of it.
 */
function drawHairCap(b, m, P, d) {
  const style = d.hair || 'short';
  if (style === 'none' || style === 'hood') return;
  const hc = P.hair;
  const { cx, headY, headR } = m;
  b.ellipse(cx, headY - 1, headR, headR - 1, hc.base);
  // THE SHINE IS AN ELLIPSE, NEVER AN HLINE. A horizontal band across the top
  // of a dome extends past the dome's own silhouette, and outline() then wraps
  // the overhang: every dark-haired character came out wearing a flat grey bar
  // above the skull. An offset ellipse also reads correctly — an anime hair
  // highlight is an arc catching one light, not a stripe painted all the way
  // round the head.
  const r1 = Math.max(1, headR - 3), r2 = Math.max(1, headR - 5);
  b.ellipse(cx - 1, headY - 3, r1, Math.max(1, headR - 4), hc.lite);
  b.ellipse(cx - 1, headY - 4, r2, r2, mixHex(hc.lite, WHITE, 0.25));
  b.ellipse(cx + headR - 3, headY - 1, r2, Math.max(1, headR - 3), hc.dark);
  b.hline(cx - headR, headY - 1, 2, hc.dark);                  // temple shadow
  b.hline(cx + headR - 1, headY - 1, 2, hc.dark);
  b.set(cx - headR, headY, hc.deep);
  b.set(cx + headR - 1, headY, hc.deep);
}

function drawHairFront(b, m, P, d) {
  const style = d.hair || 'short';
  if (style === 'none') return;
  const hc = P.hair;
  const { cx, headY, headR } = m;
  const top = headY - headR;
  const brow = headY - 3;          // the fringe stops here, clear of the eyes

  if (style === 'hood') {
    // Under a hood there is no face — just two lit points. Its own read.
    b.ellipse(cx, headY, headR - 1, headR - 1, '#141420');
    b.set(cx - 3, headY, d.eyeGlow || '#ff5f7e');
    b.set(cx + 2, headY, d.eyeGlow || '#ff5f7e');
    b.taper(cx - headR - 1, top - 2, headR * 2 + 3, headR * 2 + 3, 5, hc.base);
    b.hline(cx - headR + 1, top - 2, headR * 2 - 1, hc.lite);
    b.hline(cx - headR - 1, top + 2, headR * 2 + 3, hc.dark);
    return;
  }

  switch (style) {
    case 'spiky': {
      // OVERLAPPING WEDGES, not a row of triangles.
      //
      // Six identical spikes at a two-column pitch merged into one serrated
      // block, which is not spiky hair — it is a crown, and it was on four
      // characters. The reference sheet draws this hair as a pile of locks that
      // LEAN IN DIFFERENT DIRECTIONS and pass in front of one another, so the
      // silhouette has notches cut into it and each lock has a lit face and a
      // shadowed one. `hairLock` is that wedge; the lean array is what stops the
      // six of them agreeing with each other.
      //
      // Heights are capped at 6. `top` is `headY - headR`, which on the 30x42
      // grid is row 4, so a lock rooted at top+1 and 6 rows tall lands exactly
      // on row 0 — one taller and the tallest lock in the design is silently
      // clipped off by the edge of the buffer.
      const hs = [4, 6, 3, 6, 4, 6];
      const lean = [-1, 1, -1, 2, -1, 1];
      for (let k = 0, i = -headR + 1; i <= headR - 1; i += 2, k++) {
        b.hairLock(cx + i - 1, top + 1, 4, hs[k % hs.length],
                   lean[k % lean.length], hc, k & 1);
      }
      b.hline(cx - headR + 1, brow, headR * 2 - 1, hc.base);
      b.hline(cx - headR + 1, brow - 1, headR * 2 - 1, hc.lite);
      b.set(cx + 1, brow - 1, hc.spec);
      break;
    }
    case 'flame':
      // Tall swept spikes, taller in the middle — a whole silhouette on its own.
      for (let i = 0; i < 5; i++) {
        const dx = -headR + 1 + i * ((headR * 2 - 2) / 4 | 0);
        const h = 4 + Math.round(4 * (1 - Math.abs(i - 2) / 2.4));
        b.spike(cx + dx - 1, top, 3, h, -1, i & 1 ? hc.lite : hc.base);
      }
      b.hline(cx - headR + 1, brow, headR * 2 - 1, hc.base);
      b.set(cx - headR + 1, brow, hc.dark);
      break;
    case 'wild':
      for (let i = -headR; i <= headR; i += 2) {
        b.spike(cx + i - 1, top, 3, 3 + (i & 3), -1, i & 1 ? hc.base : hc.lite);
      }
      b.set(cx - headR - 1, headY - 2, hc.dark);
      b.set(cx + headR + 1, headY - 1, hc.dark);
      b.hline(cx - headR + 1, brow, headR * 2 - 1, hc.base);
      break;
    case 'ahoge':
      // One tall antenna strand with a hook at the tip. Instantly identifying.
      b.vline(cx + 1, top - 5, 5, hc.base);
      b.set(cx + 2, top - 5, hc.lite);
      b.set(cx + 3, top - 4, hc.lite);
      b.hline(cx - headR + 2, brow, headR * 2 - 3, hc.base);
      b.hline(cx - headR + 2, brow - 1, headR * 2 - 3, hc.lite);
      b.pair(cx, headR - 2, brow, 2, 3, hc.dark);
      break;
    case 'plume':
      for (let i = 0; i < 4; i++) b.spike(cx - 3 + i * 2, top - 1 - i, 3, 5 + i, -1, i & 1 ? hc.lite : hc.base);
      b.hline(cx - headR + 2, brow, headR * 2 - 3, hc.base);
      break;
    case 'buzz':
      b.hline(cx - headR + 2, brow, headR * 2 - 3, hc.dark);
      b.hline(cx - headR + 2, brow - 1, headR * 2 - 3, hc.base);
      break;
    case 'bowl':
      // A blunt fringe straight across at brow level, sides squared off.
      b.rect(cx - headR, brow - 1, headR * 2 + 1, 2, hc.base);
      b.hline(cx - headR, brow - 1, headR * 2 + 1, hc.lite);
      b.pair(cx, headR - 1, brow, 2, 4, hc.dark);
      break;
    case 'bangs':
      b.rect(cx - headR + 1, brow - 1, headR * 2 - 1, 2, hc.base);
      b.rect(cx - headR + 1, brow - 1, 4, 6, hc.dark);         // the eye-covering lock
      b.hline(cx - headR + 1, brow - 1, headR * 2 - 1, hc.lite);
      b.set(cx - headR + 1, brow + 2, hc.base);
      break;
    case 'twin':
    case 'twinLong':
    case 'drills':
      b.hline(cx - headR + 1, brow, headR * 2 - 1, hc.base);
      b.hline(cx - headR + 1, brow - 1, headR * 2 - 1, hc.lite);
      b.set(cx - 1, brow + 1, hc.dark);
      b.set(cx + 1, brow + 1, hc.dark);
      b.pair(cx, headR - 2, brow, 2, 4, hc.dark);              // temple locks
      break;
    case 'braid':
      b.hline(cx - headR + 1, brow, headR * 2 - 1, hc.lite);   // crown braid
      for (let i = -headR + 1; i <= headR - 1; i += 2) b.set(cx + i, brow, hc.deep);
      b.hline(cx - headR + 1, brow - 1, headR * 2 - 1, hc.base);
      break;
    case 'topknot':
      b.hline(cx - headR + 2, brow, headR * 2 - 3, hc.dark);
      b.hline(cx - headR + 2, brow - 1, headR * 2 - 3, hc.base);
      b.set(cx - headR + 1, brow + 1, hc.base);
      b.set(cx + headR - 1, brow + 1, hc.base);
      break;
    case 'wave':
      for (let i = -headR + 1; i <= headR - 1; i++) {
        b.set(cx + i, brow + (i & 1), hc.base);
        b.set(cx + i, brow - 1 + (i & 1), hc.lite);
      }
      break;
    case 'ducktail':
      b.rect(cx - headR + 1, brow - 1, headR * 2 - 1, 2, hc.base);
      b.hline(cx - headR + 1, brow - 1, headR * 2 - 1, hc.lite);
      b.pair(cx, headR - 1, brow - 1, 2, headR + 1, hc.dark);  // the two forelocks
      b.set(cx, brow, hc.dark);                                // the centre part
      break;
    case 'undercut':
      // A block on top and shaved down both sides. The haircut IS the read.
      b.rect(cx - headR + 1, brow - 2, headR * 2 - 1, 3, hc.base);
      b.hline(cx - headR + 1, brow - 2, headR * 2 - 1, hc.lite);
      b.pair(cx, headR - 1, brow, 2, headR, hc.deep);
      b.hline(cx - 2, brow, 5, hc.dark);
      break;
    default:   // short, long, bob, ponytail, sidetail
      b.hline(cx - headR + 1, brow, headR * 2 - 1, hc.base);
      b.hline(cx - headR + 1, brow - 1, headR * 2 - 1, hc.lite);
      // A jagged lower edge. Two flat rows of hair is a swimming cap; a few
      // strands hanging one row lower is a fringe.
      for (let i = -headR + 2; i <= headR - 2; i += 3) b.set(cx + i, brow + 1, hc.dark);
      b.set(cx - headR + 1, brow + 1, hc.dark);
      b.set(cx + headR - 2, brow + 1, hc.dark);
      b.set(cx + 1, brow - 1, mixHex(hc.lite, WHITE, 0.35));
      break;
  }

  if (d.hairStreak) {
    // ONE dyed lock in the fringe. `hairTip` is the other half of this problem —
    // it gradients the WHOLE mass to a second colour — and a brief that asks for
    // a single streak was getting either the whole head recoloured or nothing at
    // all. Two columns wide and four rows long: at one column it is a scratch,
    // and it has to hang past the fringe or it looks like a highlight.
    const sc = slotRamp(d.hairStreak, d.accent || '#3fb6c8');
    const x = cx + headR - 4;
    b.vline(x, brow - 2, 4, sc.base);
    b.vline(x + 1, brow - 2, 5, sc.dark);
    b.set(x, brow - 2, sc.lite);
    b.set(x + 1, brow + 3, sc.deep);
  }
  if (d.sideBraid) {
    // A short braid at one temple, hanging in front of the ear, on a head whose
    // main style is something else entirely. What says "braid" is the notch
    // every third row, not the length, so a ten-row one works exactly as well as
    // the full-length `braid` style and does not cost the character their cut.
    const bc = typeof d.sideBraid === 'string' ? ramp(d.sideBraid) : hc;
    const bt = d.hairTie ? slotRamp(d.hairTie, d.accent || '#c8203a') : P.trim;
    const x = cx - headR;
    const len = headR + 3;
    for (let j = 0; j < len; j++) {
      b.rect(x, brow + j, 2, 1, j % 3 === 2 ? bc.deep : bc.base);
      if (j % 3 === 0) b.set(x, brow + j, bc.lite);
    }
    b.rect(x, brow + len, 2, 1, bt.base);
    b.set(x, brow + len, bt.lite);
  }
  if (d.scar) {
    // The fringe parts around it. A scar drawn on top of hair is a smudge; a
    // scar in a window of bare forehead is a scar.
    const x = cx + (d.scar === 'left' ? -4 : 2);
    const y = top + 2;
    b.rect(x, y, 3, 3, P.skin.base);
    b.hline(x, y, 3, P.skin.lite);
    const sc = mixHex(P.skin.dark, '#b8452c', 0.7);
    b.set(x + 2, y, sc);
    b.set(x + 1, y + 1, sc);
    b.set(x + 1, y + 2, sc);
    b.set(x, y + 2, mixHex(sc, P.skin.base, 0.4));
  }
}

/** Ears, horns, crowns, hats, halos — the silhouette above the shoulders. */
function drawHeadgear(b, m, P, d) {
  const { cx, headY, headR, hipY, bottom, armOut, W } = m;
  const hc = P.hair, t = P.trim;
  // Beast ears default to the hair, because that is what they usually are — but
  // one of the cast has pink hair and GOLD ears, and there is no way to say that
  // without a slot of their own.
  const ec = d.earColor ? slotRamp(d.earColor, hc.base) : hc;
  // The inner fur used to be a hard-coded pink mix, which is right for exactly
  // one of the two foxes on the roster. The other one's brief names the colour —
  // pale blue — and there was no way to say it without repainting both.
  const ei = d.earInner ? slotRamp(d.earInner, ec.lite).base : mixHex(ec.lite, '#ffc4e0', 0.5);
  const top = headY - headR;
  switch (d.ears) {
    case 'fox':
      // Wide at the base and only five rows tall. Taller and narrower than this
      // and they stop reading as a fox and start reading as a rabbit.
      for (const s of [-1, 1]) {
        b.spike(cx + s * (headR - 1) - 2, top, 5, 5, -1, ec.base);
        b.spike(cx + s * (headR - 1) - 1, top - 1, 3, 3, -1, ei);
        b.set(cx + s * (headR - 1), top - 4, mixHex(ec.lite, WHITE, 0.4));
      }
      break;
    case 'cat':
      for (const s of [-1, 1]) {
        b.spike(cx + s * (headR - 1) - 1, top, 3, 4, -1, ec.base);
        b.set(cx + s * (headR - 1), top - 2, ei);
        b.set(cx + s * (headR - 1), top - 1, ec.lite);
      }
      break;
    // NOTE: `rabbit` is deliberately NOT in this switch. See the bottom of the
    // function — it is the one pair of ears that has to be drawn over the hat.
    case 'elf':
      for (const s of [-1, 1]) {
        b.line(cx + s * headR, headY, cx + s * (headR + 2), headY - 3, P.skin.base);
        b.set(cx + s * (headR + 1), headY - 1, P.skin.lite);
      }
      break;
    case 'ribbon':
      // Broadcast ribbon-ears: a loop each side with a streamer trailing down.
      for (const s of [-1, 1]) {
        b.rect(cx + s * (headR + 2) - 1, headY - 4, 4, 5, t.base);
        b.rect(cx + s * (headR + 2), headY - 3, 2, 3, t.lite);
        b.vline(cx + s * (headR + 2), headY + 1, 6, t.dark);
        b.set(cx + s * (headR + 3), headY + 6, t.base);
      }
      break;
    case 'fin':
      // A swept dorsal fin standing on the crown, plus two side fins. Widest at
      // the base and leaning back, or it reads as a party hat.
      for (let j = 0; j < 5; j++) b.hline(cx - 3 + j, top - j, Math.max(1, 7 - j * 2), t.base);
      b.line(cx + 3, top, cx, top - 4, t.lite);
      b.set(cx - 1, top - 2, mixHex(t.lite, WHITE, 0.4));
      for (const s of [-1, 1]) b.spike(cx + s * (headR + 1) - 1, headY, 3, 4, 1, t.dark);
      break;
    case 'horns':
      for (const s of [-1, 1]) {
        b.set(cx + s * (headR - 1), top - 1, t.lite);
        b.set(cx + s * headR, top - 2, t.lite);
        b.set(cx + s * headR, top - 3, t.base);
        b.set(cx + s * (headR + 1), top - 4, t.base);
      }
      break;
    case 'greatHorns':
      // Swept back and out, reaching the top rows of the grid. Boss energy —
      // and TWO pixels thick, because a 1px diagonal aliases into a dotted line
      // and the whole read collapses into a pair of antennae.
      for (const s of [-1, 1]) {
        b.blade(cx + s * (headR - 1), top + 1, cx + s * (headR + 4), top - 4, t.lite, t.base);
        b.line(cx + s * (headR - 1), top + 2, cx + s * (headR + 4), top - 3, t.dark);
        b.set(cx + s * (headR + 5), top - 5, mixHex(t.lite, WHITE, 0.4));
      }
      break;
    default:
      break;
  }
  if (d.headband) {
    // A band across the brow with a metal plate on it. The plate is the point —
    // a plain band is a sweatband.
    const c = slotRamp(d.headband, d.accent || '#1a1d2e');
    const pl = slotRamp(d.headbandPlate, '#b9c4de');
    const y = headY - headR + 2;
    b.hline(cx - headR, y, headR * 2 + 1, c.base);
    b.hline(cx - headR, y + 1, headR * 2 + 1, c.dark);
    b.rect(cx - 3, y - 1, 7, 3, pl.base);
    b.hline(cx - 3, y - 1, 7, pl.lite);
    b.hline(cx - 3, y + 1, 7, pl.dark);
    b.set(cx, y, pl.deep);                                     // the engraving
    b.vline(cx - headR, y + 2, 4, c.dark);                     // the trailing tail
  }
  if (d.headdress) {
    // A FRILLED HEADDRESS — the little servant's cap. It is not a headband and
    // must never be drawn as one: a headband crosses the BROW and is the flat
    // dark bar a fighter ties on, whereas this sits ON TOP OF THE HAIR, is pale,
    // has a scalloped upper edge, and hangs a short ribbon at each side. The
    // previous pass used `headband` for it and got a sweatband on a maid.
    //
    // The frill is the entire read. A plain white band across the crown at this
    // size is a bandage, so the upper edge alternates a lit pixel and a base
    // pixel with every fourth scallop standing a row taller — irregular on
    // purpose, because an even comb of teeth reads as a crown.
    const c = slotRamp(d.headdress, '#f4f1ea');
    const r = slotRamp(d.headdressRibbon, typeof d.headdress === 'string' ? d.headdress : '#f4f1ea');
    const y = Math.max(2, top);
    const x = cx - headR + 1;
    const w = headR * 2 - 1;
    b.rect(x, y, w, 2, c.base);
    b.hline(x, y + 1, w, c.dark);
    for (let i = 0; i < w; i++) {
      b.set(x + i, y - 1, i & 1 ? c.base : c.lite);
      if ((i & 3) === 1) b.set(x + i, y - 2, mixHex(c.lite, WHITE, 0.5));
    }
    // The two short ribbon tails, which are what give the cap a silhouette of
    // its own instead of a rounded lump the same shape as the skull under it.
    for (const s of [-1, 1]) {
      const rx2 = s < 0 ? x - 2 : x + w;
      b.rect(rx2, y, 2, 2, r.base);
      b.hline(rx2, y, 2, r.lite);
      b.set(s < 0 ? rx2 : rx2 + 1, y + 2, r.dark);
      b.set(s < 0 ? rx2 : rx2 + 1, y + 3, r.deep);
    }
  }
  if (d.crown) {
    // A narrow band with three TALL points, not a wide bar with a bumpy top.
    // Full-width, a crown sits on the skull like a roof and reads as headgear
    // the character is standing under rather than wearing.
    const c = slotRamp(d.crown, d.accent || '#ffd76a');
    const y = Math.max(1, top - 1);
    b.hline(cx - headR + 2, y, headR * 2 - 3, c.base);
    b.hline(cx - headR + 2, y + 1, headR * 2 - 3, c.dark);
    b.spike(cx - 1, y - 1, 3, 3, -1, c.lite);
    for (const s of [-1, 1]) b.spike(cx + s * (headR - 2) - 1, y - 1, 3, 2, -1, c.base);
    b.set(cx, y, mixHex(c.lite, WHITE, 0.5));
  }
  if (d.hat === 'tricorn') {
    // THE HAT IS THE CHARACTER. The previous version was a flat bar with a
    // three-row lump behind it — a fedora, drawn wide — and on the one person in
    // the cast whose brief leads with the word "huge" that is the single biggest
    // thing the art got wrong.
    //
    // What makes a tricorn a tricorn is not the brim, it is that the brim is
    // COCKED UP against the crown at three points, so the outline goes up, out,
    // up again and back. Two of those points face the viewer. They are drawn as
    // near-vertical flares standing four rows off the brim line rather than as
    // diagonals, because a diagonal at this size aliases into a stair and reads
    // as a pair of wings.
    //
    // The crown then has to be TALLER than the flares or the hat collapses back
    // into a brim with two horns on it, and the gold has to run along the brim
    // EDGE and not only round the band: a plain dark brim on dark hair loses its
    // lower silhouette entirely, and the trim line is what puts it back.
    const c = slotRamp(d.hatColor, '#241826');
    const g = slotRamp(d.hatTrim, d.accent || '#e8c34a');
    const bw = headR + 4;                                      // the brim's reach
    const crownH = Math.max(5, headR);
    // The brim line is pinned to the CROWN'S height and not to the head's: at
    // `top + 1` the dome ran off the top of the buffer and what was left was a
    // flat cap with a peak, which is a different hat entirely.
    const y = Math.max(crownH + 1, top + 1);
    // The crown, doming out toward the brim, and NARROW at the top. Started
    // wide it merges with the cocked corners into one red slab five columns
    // taller than the head, which is a bearskin: the gap of background between
    // the crown and each corner is the whole reason the outline has three peaks
    // in it instead of one.
    b.taper(cx - headR + 4, y - crownH, headR * 2 - 7, headR * 2 - 3, crownH, c.base);
    b.hline(cx - headR + 6, y - crownH, headR * 2 - 11, c.lite);
    b.vline(cx + headR - 5, y - crownH + 2, crownH - 3, c.deep);
    // the two cocked front corners, standing up against the crown and leaning
    // in as they rise — which is what a brim pinned to a crown actually does
    for (const s of [-1, 1]) {
      for (let j = 0; j < 5; j++) {
        const x = s < 0 ? cx - bw + (j >> 1) : cx + bw - 1 - (j >> 1);
        b.rect(x, y - j, 2, 1, j & 1 ? c.base : c.lite);
      }
      b.set(s < 0 ? cx - bw + 2 : cx + bw - 2, y - 5, c.dark);  // the point
    }
    // the band round the base of the crown
    b.hline(cx - headR + 2, y - 2, headR * 2 - 3, g.base);
    b.hline(cx - headR + 2, y - 1, headR * 2 - 3, g.dark);
    // the brim: red, with the gold piping along its LOWER edge. Along the top
    // it was simply a gold bar with a hat behind it — the piping is supposed to
    // put the brim's underside back into the silhouette, and it can only do
    // that from underneath.
    b.hline(cx - bw, y, bw * 2 + 1, c.base);
    b.hline(cx - bw + 1, y + 1, bw * 2 - 1, c.dark);
    b.hline(cx - bw + 2, y + 2, bw * 2 - 3, g.dark);
    for (let i = -bw + 2; i <= bw - 2; i += 2) b.set(cx + i, y + 2, g.base);
    // and the cockade, pinned to the left corner where the plume roots
    b.rect(cx - bw + 1, y - 4, 3, 3, g.base);
    b.hline(cx - bw + 1, y - 4, 3, g.lite);
    b.set(cx - bw + 2, y - 3, mixHex(g.lite, WHITE, 0.55));
  }
  if (d.hat === 'beret') {
    // A soft cap SLUMPED to one side, with the far edge overhanging the ear and
    // the near edge riding up on the hair. The tilt is the entire feature — a
    // beret drawn level is a bowl, and a bowl on top of a head is a helmet.
    const c = slotRamp(d.hatColor, '#f4f1ea');
    const y = Math.max(2, top);
    b.ellipse(cx + 1, y, headR - 1, 2, c.base);
    b.hline(cx - headR + 3, y - 2, headR * 2 - 4, c.lite);
    b.hline(cx - headR + 1, y + 1, headR * 2 - 1, c.dark);     // the band on the hair
    b.set(cx + headR - 1, y + 1, c.deep);                      // the overhanging edge
    b.set(cx + headR, y, c.dark);
    b.set(cx + 1, y - 3, c.lite);                              // the stalk
    b.set(cx - headR + 3, y - 1, mixHex(c.lite, WHITE, 0.5));
  }
  if (d.hat === 'topHat') {
    // Tiny, and pinned on at an angle — a full-size top hat on this head is a
    // chimney. The tilt is the whole joke, so the crown is offset from the brim.
    const c = slotRamp(d.hatColor, '#1a1420');
    const y = Math.max(1, top - 1);
    b.hline(cx - 2, y + 1, 8, c.base);                         // the brim, off-centre
    b.hline(cx - 2, y + 2, 8, c.deep);
    b.rect(cx, y - 3, 5, 4, c.base);
    b.hline(cx, y - 3, 5, c.dark);                             // NOT lite: a lit
    b.set(cx + 3, y - 3, c.lite);                              // top row on a
    b.hline(cx, y, 5, P.trim.base);                            // black hat reads
  }                                                            // as a white cap
  if (d.hatPlume) {
    // An OSTRICH PLUME, not a feather: it roots at the band, sweeps up and back
    // over the crown, and then droops at the tip. Six rows of a shrinking hline
    // was a quill, and a quill on a hat that size is a pen.
    //
    // Three things do the work. The spine CURVES — it climbs fast, slows, and
    // falls away at the end — so the plume has a bend in it and not a lean. The
    // barbs hang BELOW the spine on the outboard side only, which is the whole
    // difference between a feather and a leaf. And the tip curls back inboard,
    // because a plume that ends pointing at the sky is stiff, and the one thing
    // a plume must never look like is stiff.
    const c = slotRamp(d.hatPlume, '#f4f1ea');
    const len = Math.max(8, headR + 5);
    const x0 = cx + headR - 1, y0 = Math.max(3, top + 1);
    let px = x0, py = y0;
    for (let j = 0; j < len; j++) {
      const t = j / (len - 1);
      px = Math.min(W - 3, x0 + Math.round(len * 0.7 * Math.sin(t * 1.45)));
      py = y0 - Math.round((len - 2) * (t < 0.7 ? t / 0.7 : 1 - (t - 0.7) * 0.8));
      // The vane is drawn as a solid run and NOT as scattered barbs. Single
      // pixels stepped diagonally off a spine came out as television static:
      // at this size a feather is a mass with a lit spine and a shadowed
      // underside, and the wispiness has to live at the tip or nowhere.
      const vane = Math.max(2, 4 - ((j * 3 / len) | 0));
      b.hline(px, py, vane, c.base);
      b.set(px, py, c.lite);                                   // the lit spine
      b.set(px + vane - 1, py + 1, c.dark);                    // the underside
      if (j === 0) b.set(px - 1, py + 1, c.deep);              // where it is pinned
    }
    b.set(px + 1, py - 1, mixHex(c.lite, WHITE, 0.6));         // the curled tip
    b.set(px + 2, py, c.base);
    b.set(px + 3, py + 1, c.dark);
  }
  if (d.ears === 'rabbit') {
    // ENORMOUS rabbit ears, and they ARE the silhouette — if they do not read
    // from across an arena the design has failed, which is a direct quote from
    // the brief they were written for.
    //
    // They cannot stand up. Every landmark on this body plan is derived from the
    // grid, the crown sits at 0.235H, and that leaves four rows of air above the
    // skull no matter how tall the grid is made — an upright ear long enough to
    // matter would simply be clipped off by the top of the buffer. So they do
    // what the brief actually asks for instead: a few rows of upright root off
    // the crown, a rounded bend, and then a FALL that runs outside the arms all
    // the way past the hip. Forty rows of ear in the outline, hanging where
    // nothing else in the cast has anything.
    //
    // The pink inner fur is a column INSET from the outer edge rather than a
    // second shape: an ear that is two colours side by side is two ears.
    //
    // And this is drawn AFTER the hats rather than with the other ears, which is
    // the only ordering that works: every other pair in the switch above is
    // shorter than the headgear that goes on over them, and these are eight
    // times the height of the head. A cap drawn on top of them saws them off at
    // the scalp, and a rabbit in a cap wears the cap BETWEEN her ears anyway.
    // Rooted near the OUTSIDE of the crown rather than near the middle of it.
    // Started inboard, the fold across the top is seven pixels of horizontal
    // bar with a thirty-row leg hanging off one end, which is a shepherd's
    // crook; started here the two legs of the fold are comparable and the ear
    // reads as cloth-soft cartilage doubling over on itself.
    const rootDX = Math.max(1, headR - 2);
    const bendY = Math.max(1, headY - headR - 3);
    // armOut + 4 and not + 3: the weapon column sits at armOut + armW, and an
    // ear one pixel inboard of a held prop is an ear with a bite out of it.
    const outDX = Math.min(Math.max(headR + 2, armOut + 4), (W >> 1) - 5);
    // Stopped just past the hip rather than most of the way to the boot. Run to
    // the ankle it fights whatever is in the hand for a dozen rows, and "past
    // the waist" is what the brief asks for anyway — the ear is already the
    // tallest thing on the figure by a factor of four.
    const fallTo = Math.min(bottom - 3, hipY + Math.round((bottom - hipY) * 0.30));
    const rootY = headY - headR + 2;
    const rise = Math.max(2, rootY - bendY);
    const bx = rootDX + Math.round((outDX - rootDX) * 0.6);
    const fall = Math.max(6, fallTo - bendY);
    for (const s of [-1, 1]) {
      // the upright root, leaning outward as it rises off the crown
      for (let j = 0; j <= rise; j++) {
        const dx = rootDX + Math.round((bx - rootDX) * (j / rise));
        const x = s < 0 ? cx - dx - 4 : cx + dx;
        b.rect(x, rootY - j, 4, 1, ec.base);
        b.rect(x + 1, rootY - j, 2, 1, ei);
      }
      // The bend over the top, one row narrower than the row under it so the
      // corner comes out ROUNDED. Square, it reads as a bracket, and a pair of
      // brackets standing either side of a figure looks like a picture frame
      // rather than like anything growing out of her head.
      const bw = outDX - bx + 4;
      b.rect(s < 0 ? cx - outDX - 4 : cx + bx + 1, bendY, bw - 1, 1, ec.lite);
      b.rect(s < 0 ? cx - outDX - 4 : cx + bx, bendY + 1, bw, 1, ec.base);
      // and the fall, running outside the arms, tapering as it goes
      for (let j = 2; j <= fall; j++) {
        const y = bendY + j;
        const u = j / fall;
        // A slow lean OUTWARD, in two steps. Dead vertical, an ear thirty rows
        // long is a ski pole leaning against her.
        const dx = outDX + (u > 0.35 ? 1 : 0) + (u > 0.75 ? 1 : 0);
        const w = u > 0.85 ? 2 : u > 0.45 ? 3 : 4;
        const x = s < 0 ? cx - dx - w : cx + dx;
        b.rect(x, y, w, 1, ec.base);
        b.set(s < 0 ? x + w - 1 : x, y, ec.dark);              // the inner edge
        // The lining is CONTINUOUS and stops halfway down. Broken up it reads
        // as a dashed line, and run the full length it reads as a stripe — a
        // white bar with a pink stripe down it is a ribbon. What is actually
        // pink on a rabbit is the inside of the funnel at the top; the last
        // third of the ear is fur on both faces.
        if (u < 0.45) b.rect(x + 1, y, Math.max(1, w - 2), 1, ei);
        if (j % 6 === 5) b.set(s < 0 ? x : x + w - 1, y, ec.lite);
      }
      b.rect(s < 0 ? cx - outDX - 3 : cx + outDX + 1, bendY + fall + 1, 2, 1, ec.dark);
    }
  }
  if (d.halo) {
    // The old halo drew at y = headY - 8, which on a 26-row grid is y = -1: it
    // was clipped away on every frame. Anchored to the head now, and drawn as a
    // ring rather than a bar so it reads as a halo and not as a hat.
    const c = typeof d.halo === 'string' ? d.halo : '#ffe9a3';
    const y = Math.max(0, top - (d.hair === 'ahoge' ? 6 : 4));
    b.hline(cx - headR + 2, y, headR * 2 - 3, c);
    b.set(cx - headR + 1, y + 1, shade(c, -0.2));
    b.set(cx + headR - 1, y + 1, shade(c, -0.2));
    b.set(cx - headR + 2, y, mixHex(c, WHITE, 0.5));
  }
}

/** Earrings, hairpins, sparks — the small things a 24-wide grid could not hold. */
function drawTrinkets(b, m, P, d) {
  const { cx, headY, headR, W } = m;
  if (d.earrings) {
    // Rectangular drops hanging clear of the jaw, with a coloured motif on the
    // face of each. They are two pixels wide and they are the single most
    // specific thing about one character in the roster.
    const c = slotRamp(d.earrings, '#f4f1ea');
    const c2 = slotRamp(d.earringsMotif, d.accent || '#d64545');
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - headR - 1 : cx + headR;
      b.set(x + (s < 0 ? 1 : 0), headY + 1, c.dark);           // the hook
      b.rect(x, headY + 2, 2, 4, c.base);
      b.hline(x, headY + 2, 2, c.lite);
      b.hline(x, headY + 4, 2, c2.base);                       // the motif band
      b.hline(x, headY + 5, 2, c.dark);
    }
  }
  if (d.hairpin) {
    const c = slotRamp(d.hairpinColor, d.accent || '#ffe14a');
    const x = cx - headR + 1, y = headY - headR + 2;
    if (d.hairpin === 'star') {
      b.set(x + 1, y - 1, c.lite);
      b.hline(x, y, 3, c.base);
      b.set(x + 1, y + 1, c.base);
      b.set(x, y + 1, c.dark);
      b.set(x + 2, y + 1, c.dark);
      b.set(x + 1, y, mixHex(c.lite, WHITE, 0.6));
    } else if (d.hairpin === 'bell') {
      // A BELL, and a LARGE one: the big cast ornament worn on the crown rather
      // than the flat 3x2 bar the default draws. It ignores the shared pin
      // position on purpose â€” that sits at the left temple, which is exactly
      // where a pair of hair ribbons already is, and a gold bar under a gold
      // ribbon is one gold shape. On the crown, between the ears, it has the
      // whole top of the skull to itself.
      //
      // What makes it a bell and not a coin is that it is ROUND with a hard
      // SLIT across its mouth and a clapper showing under the slit, and that
      // the light sits on the shoulder of the dome rather than along its top
      // row, so the shape comes out as a sphere.
      const bx = cx - 2, by = headY - headR + 1;
      b.ellipse(bx + 1, by + 2, 3, 3, c.base);
      b.hline(bx, by, 4, c.lite);                              // the crown loop
      b.hline(bx - 1, by + 3, 6, c.dark);                      // the mouth slit
      b.hline(bx, by + 4, 4, c.deep);
      b.set(bx + 1, by + 1, mixHex(c.lite, WHITE, 0.6));
      b.set(bx + 2, by + 5, c.dark);                           // the clapper
    } else {
      b.rect(x, y, 3, 2, c.base);
      b.hline(x, y, 3, c.lite);
    }
  }
  if (d.sparks) {
    // Arcs coming off the hair. Deliberately asymmetric and off the silhouette,
    // so they read as discharge rather than as more hair.
    const c = slotRamp(d.sparks, '#7ad9ff');
    const y = headY - headR;
    const pts = [[-headR - 1, y + 1], [-headR - 2, y + 2], [-headR - 2, y + 4],
                 [headR + 1, y], [headR + 2, y + 1], [headR + 1, y + 3],
                 [-1, y - 2], [2, y - 3]];
    for (let i = 0; i < pts.length; i++) {
      b.set(clamp(cx + pts[i][0], 0, W - 1), pts[i][1], i & 1 ? c.base : mixHex(c.lite, WHITE, 0.4));
    }
  }
}

/** A floating interface panel. Translucent, so only its frame and rows are lit. */
function drawHologram(b, m, P, d) {
  const c = slotRamp(d.hologram, '#4ad8ff');
  const { cx, headY, headR, armOut } = m;
  const x = Math.max(1, cx - armOut - 5);
  const y = Math.max(1, headY - headR - 1);
  const w = 5, h = 8;
  b.hline(x, y, w, c.lite);
  b.hline(x, y + h - 1, w, c.dark);
  b.vline(x, y, h, c.base);
  b.vline(x + w - 1, y, h, c.base);
  for (let j = 2; j < h - 1; j += 2) b.hline(x + 1, y + j, w - 3, c.dark);
  b.set(x + w - 2, y + 1, mixHex(c.lite, WHITE, 0.6));
  b.set(x + w, y + h - 2, c.dark);                             // the anchor beam
  b.set(x + w + 1, y + h, c.base);
}

// ---------------------------------------------------------------------------
// WEAPONS. Held to the side, sized to matter, and every coordinate relative to
// the grid — the old katana put its tip at cx+10 on a 20-wide grid, i.e. two
// columns past the right edge, and the whole point of the blade was clipped.
// ---------------------------------------------------------------------------
function drawWeapon(b, m, P, d) {
  const w = d.weapon;
  if (!w || w === 'none') return;
  const met = P.metal;
  const grip = slotRamp(d.gripColor, '#6a4a32');
  const gold = slotRamp(d.accent, '#e8c34a');
  const { cx, wx, lx, headY, headR, shoulderY, hipY, bottom, W } = m;
  const top = Math.max(1, headY - headR - 1);
  const hand = hipY + 1;
  const low = Math.min(bottom - 1, hipY + 6);
  const right = Math.min(wx + 2, W - 2);

  switch (w) {
    case 'greatsword': {
      const h = hipY - top - 1;
      b.rect(wx - 1, top + 1, 3, h, met.base);
      b.vline(wx - 1, top + 1, h, met.lite);
      b.vline(wx + 1, top + 1, h, met.dark);
      b.set(wx, top, met.lite);                              // the point
      b.vline(wx, top + 2, h - 2, met.dark);                 // the fuller
      b.hline(wx - 2, hipY, 5, gold.base);                   // crossguard
      b.set(wx, hipY, gold.lite);
      b.vline(wx, hipY + 1, 3, grip.base);
      b.set(wx, hipY + 4, gold.lite);                        // pommel
      break;
    }
    case 'sword': {
      const h = hipY - shoulderY + 5;
      b.rect(wx - 1, shoulderY - 4, 2, h, met.base);
      b.vline(wx - 1, shoulderY - 4, h, met.lite);
      b.set(wx - 1, shoulderY - 5, met.lite);
      b.hline(wx - 2, hipY + 1, 4, gold.base);               // basket hilt
      b.vline(wx - 2, hipY + 1, 3, gold.base);
      b.vline(wx, hipY + 2, 3, grip.base);
      break;
    }
    case 'cutlass': {
      // A SABRE, and the only thing that makes a sabre one is the curve.
      //
      // Two straight segments with a kink in the middle is what this used to be,
      // and a kink is not a curve — it reads as a sword somebody has bent. The
      // blade is sampled a row at a time off a quadratic instead, so the offset
      // grows slowly at the hilt and fast at the point and the outline comes out
      // genuinely convex. It also widens toward the last third and then cuts
      // back to the point, which is the clipped tip a naval cutlass has and the
      // second thing that separates it from a straight blade at this size.
      //
      // The other half of the read is the KNUCKLE BOW: a solid guard sweeping
      // from the langet forward and back down to the pommel, enclosing the whole
      // hand. Nothing else on the roster has a closed loop of metal at the hip.
      const hiltY = Math.min(bottom - 3, hipY + 3);
      const tipY = Math.max(top + 1, headY - headR - 2);
      const len = Math.max(6, hiltY - 3 - tipY);
      const gx = Math.max(2, wx - 4);
      const bow = Math.max(3, Math.round(W * 0.11));
      let bx = gx, by = hiltY - 3;
      for (let j = 0; j <= len; j++) {
        const t = j / len;
        bx = gx + Math.round(bow * t * t);
        by = hiltY - 3 - j;
        const w = t > 0.88 ? 1 : t > 0.5 ? 3 : 2;
        b.hline(bx, by, w, met.base);
        b.set(bx + w - 1, by, met.lite);                       // the cutting edge
        if (j % 4 === 1) b.set(bx, by, met.dark);              // the fuller
      }
      b.set(bx, by - 1, mixHex(met.lite, WHITE, 0.6));         // the point
      // the grip, the langet, and the bow closing round the hand
      b.vline(gx, hiltY - 2, 5, grip.base);
      b.vline(gx + 1, hiltY - 2, 5, grip.dark);
      b.hline(gx - 1, hiltY - 3, 4, gold.base);
      b.set(gx - 1, hiltY - 3, gold.lite);
      b.vline(gx + 2, hiltY - 2, 5, gold.base);
      b.set(gx + 2, hiltY - 2, gold.lite);
      b.hline(gx - 1, hiltY + 2, 4, gold.base);                // the pommel cap
      b.set(gx, hiltY + 2, mixHex(gold.lite, WHITE, 0.4));
      break;
    }
    case 'carrot': {
      // A carrot, PLANTED POINT-DOWN in the ground beside her, which is one of
      // the three things the brief says she does with them and the only one a
      // standing idle can show.
      //
      // Low on purpose, and that is not a style choice. The one character who
      // carries this also has ears that hang from above the skull to past the
      // hip on the outside of the arms, and the weapon column runs straight
      // through them: held at chest height the prop takes a bite out of the
      // single feature her whole silhouette is built on. Below the ear tip
      // there is clear grid, so that is where it goes.
      //
      // Three things stop it reading as a traffic cone. The notch rings, which
      // are the only thing on a smooth orange wedge that says "root vegetable".
      // The fronds, which have to be a spray of separate stalks and not a green
      // block, or it is a carrot in a hat. And the cut shoulder at the top, a
      // pixel wider than the body, which is where a real one leaves the leaves.
      const leaf = slotRamp(d.gripColor, '#4fae4a');
      const y1 = bottom;
      const y0 = Math.max(hipY + 5, y1 - Math.round(m.H * 0.26));
      const h = Math.max(5, y1 - y0);
      const cw = Math.max(3, Math.round(W * 0.12));
      const cxx = Math.min(wx, W - cw - 2);
      b.taper(cxx - (cw >> 1), y0, cw, 1, h, met.base);
      b.vline(cxx - (cw >> 1), y0 + 1, h - 3, met.lite);       // the lit side
      b.vline(cxx + (cw >> 1), y0 + 1, h - 4, met.dark);
      for (let j = 2; j < h - 1; j += 2) {
        // the notch rings, alternating sides so they read as a spiral
        const ww = Math.max(1, Math.round(cw * (1 - j / h)));
        b.set(cxx - (ww >> 1) + (j & 2 ? 1 : 0), y0 + j, met.deep);
      }
      b.hline(cxx - (cw >> 1) - 1, y0, cw + 2, met.lite);      // the cut shoulder
      b.hline(cxx - (cw >> 1) - 1, y0 + 1, cw + 2, met.base);
      b.set(cxx, y1, mixHex(met.lite, WHITE, 0.3));            // the root tip
      for (let i = -1; i <= 1; i++) {
        const hh = 3 + (i === 0 ? 2 : 0);
        for (let j = 0; j < hh; j++) {
          b.set(cxx + i * 2 + ((i * j) >> 1), y0 - 1 - j, j & 1 ? leaf.base : leaf.lite);
        }
        b.set(cxx + i * 2 + ((i * hh) >> 1), y0 - 1 - hh, leaf.dark);
      }
      break;
    }
    case 'katana': {
      // A long single edge with a slight bend, tip well inside the grid.
      b.blade(wx - 3, hand - 1, wx - 1, headY + 1, met.lite, met.base);
      b.blade(wx - 1, headY + 1, wx, top + 1, met.lite, met.base);
      b.hline(wx - 4, hand, 4, '#2a2a3a');                   // tsuba
      b.vline(wx - 4, hand + 1, 4, grip.base);               // hilt wrap
      b.set(wx - 4, hand + 2, grip.dark);
      b.set(wx - 4, hand + 5, gold.base);
      break;
    }
    case 'daisho': {
      // Long in the right hand, short in the left, both out at once. The length
      // difference IS the school being referenced, so it has to be obvious.
      b.blade(wx - 3, hand, wx - 1, headY, met.lite, met.base);
      b.blade(wx - 1, headY, wx, top + 2, met.lite, met.base);
      b.hline(wx - 4, hand + 1, 4, '#2a2a3a');
      b.vline(wx - 4, hand + 2, 3, grip.base);
      b.blade(lx, hand, lx + 1, shoulderY + 1, met.lite, met.dark);
      b.hline(lx - 1, hand + 1, 4, '#2a2a3a');
      b.vline(lx + 1, hand + 2, 3, grip.base);
      break;
    }
    case 'dual': {
      const h = hipY - shoulderY + 4;
      b.rect(wx - 1, shoulderY - 3, 2, h, met.base);
      b.vline(wx - 1, shoulderY - 3, h, met.lite);
      b.hline(wx - 2, hipY + 1, 4, grip.base);
      b.rect(lx, shoulderY - 1, 2, h - 2, met.base);
      b.vline(lx, shoulderY - 1, h - 2, met.lite);
      b.hline(lx - 1, hipY + 1, 4, grip.base);
      break;
    }
    case 'dualRev': {
      // One blade up, one held REVERSED with the guard at the top and the point
      // running past the boot. Two swords out is common; that grip is not.
      b.rect(wx - 1, top + 2, 2, hipY - top, met.base);
      b.vline(wx - 1, top + 2, hipY - top, met.lite);
      b.set(wx - 1, top + 1, met.lite);
      b.hline(wx - 2, hipY + 1, 4, gold.base);
      b.vline(wx, hipY + 2, 3, grip.base);
      b.hline(lx - 1, shoulderY, 4, gold.base);
      b.vline(lx, shoulderY - 3, 3, grip.base);
      b.rect(lx, shoulderY + 1, 2, bottom - shoulderY - 2, met.base);
      b.vline(lx + 1, shoulderY + 1, bottom - shoulderY - 2, met.lite);
      b.set(lx, bottom - 1, met.dark);
      break;
    }
    case 'mirror': {
      // A polished disc with a handle. The highlight arc is the whole prop: an
      // unlit circle at this size is a shield.
      const mxc = Math.min(wx, W - 5);
      const r = 3;
      b.ellipse(mxc, hipY - 4, r, r, gold.base);
      b.ellipse(mxc, hipY - 4, r - 1, r - 1, met.base);
      b.set(mxc - 1, hipY - 6, WHITE);
      b.set(mxc - 2, hipY - 5, mixHex(met.lite, WHITE, 0.6));
      b.set(mxc + 1, hipY - 2, met.dark);
      b.vline(mxc, hipY - 1, 4, grip.base);                  // the handle
      b.hline(mxc - 1, hipY + 3, 3, gold.base);
      break;
    }
    case 'scythe': {
      b.vline(wx, top + 2, bottom - top - 3, grip.base);
      b.vline(wx + 1, top + 3, bottom - top - 5, grip.dark);
      // the blade sweeps back over the head, which is the whole silhouette
      b.line(wx, top + 2, cx + 1, top, met.lite);
      b.line(wx, top + 3, cx + 1, top + 1, met.base);
      b.line(cx + 1, top, cx, top + 2, met.lite);
      b.line(cx + 2, top + 1, cx + 4, top + 3, met.dark);
      b.set(wx, bottom - 2, gold.base);
      break;
    }
    case 'trident': {
      b.vline(wx, headY + 1, bottom - headY - 2, grip.base);
      b.hline(wx - 2, headY + 1, 5, met.base);
      for (const i of [-2, 0, 2]) {
        b.vline(wx + i, top + 1, headY - top, met.lite);
        b.set(wx + i, top, met.base);
      }
      b.set(wx, headY + 3, gold.base);
      break;
    }
    case 'spear': {
      b.vline(wx, top + 4, bottom - top - 5, grip.base);
      b.spike(wx - 1, top + 3, 3, 5, -1, met.lite);
      b.set(wx, top, met.base);
      b.hline(wx - 1, top + 4, 3, gold.base);
      break;
    }
    case 'staff': {
      b.vline(wx, top + 3, bottom - top - 4, grip.base);
      b.vline(wx + 1, top + 4, bottom - top - 6, grip.dark);
      b.ellipse(wx, top + 1, 2, 2, gold.base);
      b.set(wx - 1, top, mixHex(gold.lite, WHITE, 0.5));
      b.hline(wx - 2, top + 3, 5, gold.dark);                // the ring under the orb
      break;
    }
    case 'gun': {
      // A long flintlock: barrel, lock, flared grip.
      b.hline(wx - 3, hipY - 1, Math.min(6, right - wx + 4), met.dark);
      b.hline(wx - 3, hipY - 2, Math.min(5, right - wx + 3), met.base);
      b.set(wx - 4, hipY - 3, met.lite);                     // the cock
      b.rect(wx - 4, hipY, 2, 3, grip.base);
      b.set(wx - 3, hipY + 3, grip.dark);
      break;
    }
    case 'book': {
      b.rect(wx - 3, shoulderY + 2, 5, hipY - shoulderY, '#14141e');
      b.vline(wx - 3, shoulderY + 2, hipY - shoulderY, '#26262e');      // spine
      b.hline(wx - 2, shoulderY + 2, 4, '#3a3a4a');
      b.set(wx, shoulderY + 4, gold.lite);                   // the clasp
      b.vline(wx + 1, shoulderY + 3, hipY - shoulderY - 2, '#e8e4dc');  // page block
      break;
    }
    case 'mic': {
      b.vline(wx, shoulderY + 2, hipY - shoulderY, '#3a3a4a');
      b.ellipse(wx, shoulderY, 2, 2, met.lite);
      b.set(wx - 1, shoulderY - 1, WHITE);
      for (let j = 0; j < 5; j++) b.set(wx + 1 + (j & 1), hipY + 1 + j, gold.base);  // the cable
      break;
    }
    case 'fan': {
      const h = hipY - shoulderY + 5;
      b.taper(wx - 3, shoulderY - 3, 5, 1, h, gold.base);
      for (let j = 0; j < h; j += 2) b.hline(wx - 3 + (j >> 1), shoulderY - 3 + j, Math.max(1, 5 - j), gold.lite);
      b.set(wx - 1, hipY + 2, grip.base);
      break;
    }
    case 'chakram': {
      // A thrown ring, drawn IN THE AIR beside the head rather than resting at
      // the hip. Two reasons, and the second is the load-bearing one: a disc is
      // a weapon that has left the hand, so a disc parked at the waist reads as
      // a shield; and at hip height on a 30-wide grid the only columns available
      // are the ones the one character who throws it needs for her hair, so the
      // prop and her whole silhouette were fighting over the same eight pixels.
      const r = Math.max(2, headR - 3);
      const mx = Math.min(wx, W - r - 2);
      const my = Math.max(r + 1, top);
      b.ellipse(mx, my, r, r, met.base);
      b.ellipse(mx, my, r - 1, r - 1, gold.dark);
      b.set(mx - 1, my - r, mixHex(met.lite, WHITE, 0.5));
      b.set(mx + r, my + 1, met.dark);
      // Two motes falling away underneath it, so the ring reads as something
      // that has just left a hand rather than as jewellery hung in mid-air.
      b.set(mx, my + r + 2, met.lite);
      b.set(mx + 1, my + r + 4, met.base);
      break;
    }
    case 'axe': {
      // A two-handed axe: a long haft and a broad crescent bit with a horn top
      // and bottom. The bit has to be WIDE — a narrow head on a long stick is a
      // spear — and the whole note on the character who carries this is that the
      // thing is far too big for the person holding it, so it is drawn as such.
      // The head sits ABOVE the shoulder, not on it. Dropped level with the
      // shoulder it lands on top of a pauldron, and two adjacent greys with a
      // shared outline are one grey shape: the character was carrying a
      // slightly larger shoulder plate rather than an axe.
      const hy = Math.max(top + 4, shoulderY - 4);
      b.vline(wx, top + 2, bottom - top - 3, grip.base);
      b.vline(wx + 1, top + 3, bottom - top - 6, grip.dark);
      b.hline(wx - 1, bottom - 2, 3, gold.base);             // the butt cap
      for (let j = 0; j < 8; j++) {
        // How far the outer edge stands off the haft, and how much of that run
        // is solid. They are not the same number: the two HORNS curve away and
        // stop short of the haft, and only the middle of the bit reaches back to
        // the eye. That gap is the difference between an axe and a leaf blade.
        const o = j < 2 ? 3 + 2 * j : j > 5 ? 3 + 2 * (7 - j) : 7;
        const bw = j < 3 ? 2 + 2 * j : j > 4 ? 2 + 2 * (7 - j) : 7;
        b.hline(wx - o, hy + j, bw, j & 1 ? met.base : met.lite);
      }
      b.vline(wx - 1, hy + 3, 2, met.deep);                  // the eye
      b.vline(wx - 7, hy + 3, 2, mixHex(met.lite, WHITE, 0.5));   // the lit edge
      b.hline(wx - 2, hy - 1, 3, gold.base);                 // the langets
      b.hline(wx - 2, hy + 8, 3, gold.dark);
      break;
    }
    case 'hammer': {
      b.vline(wx, shoulderY + 1, bottom - shoulderY - 2, grip.base);
      b.rect(wx - 2, shoulderY - 4, 5, 5, met.base);
      b.hline(wx - 2, shoulderY - 4, 5, met.lite);
      b.hline(wx - 2, shoulderY, 5, met.deep);
      b.vline(wx - 2, shoulderY - 3, 2, gold.base);
      break;
    }
    case 'bow': {
      b.line(wx, top + 2, wx + 1, headY + 2, met.base);
      b.line(wx + 1, headY + 2, wx, hipY + 3, met.base);
      b.set(wx + 1, top + 3, met.lite);
      b.line(wx, top + 2, wx, hipY + 3, '#e8e4dc');          // the string
      b.set(wx - 1, headY + 3, gold.base);                   // the grip wrap
      break;
    }
    case 'claws': {
      for (let i = 0; i < 3; i++) {
        b.line(wx - 2 + i, hipY + 1, wx + i, hipY + 6, met.lite);
      }
      b.rect(wx - 3, hipY - 1, 4, 2, gold.base);             // the knuckle plate
      break;
    }
    case 'orb': {
      b.ellipse(wx, shoulderY + 2, 3, 3, gold.base);
      b.ellipse(wx, shoulderY + 2, 1, 1, mixHex(gold.lite, WHITE, 0.6));
      b.set(wx - 3, shoulderY - 1, gold.lite);
      b.set(wx + 3, shoulderY + 5, gold.lite);
      break;
    }
    case 'whip': {
      let x = wx, y = shoulderY;
      for (let j = 0; j < low - shoulderY + 4; j++) {
        b.set(clamp(x, 0, W - 1), y, j & 1 ? met.base : met.dark);
        y++;
        x += (j >> 1) & 1 ? 1 : -1;
      }
      b.rect(wx - 1, shoulderY - 2, 2, 3, grip.base);
      break;
    }
    case 'cards': {
      for (let i = 0; i < 3; i++) {
        b.rect(wx - 2 + i, hipY - 4 - i * 2, 3, 5, i & 1 ? '#e8e4dc' : met.lite);
        b.set(wx - 1 + i, hipY - 3 - i * 2, gold.base);
      }
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// THE PORTRAIT — a head-and-shoulders bust for the HUD, on its own 40x40 grid.
//
// This is the single most-looked-at piece of art in the game: it sits beside the
// HP bar for a whole twenty-minute run. Everything the world sprite cannot
// afford goes here — a real iris with a catch-light and a lit lower rim, brows
// that carry expression, a nose, a mouth, hair with a highlight band and a
// shadow band, the collar of the actual outfit, and whichever signature sits
// above the neck. 32x32 could not fit an eye big enough to have an iris colour;
// 40x40 can, which is the entire reason for the change.
// ---------------------------------------------------------------------------
function drawPortrait(b, d) {
  const W = b.w, H = b.h;
  const cx = W >> 1;
  const P = humanPalette(d);
  const hc = P.hair;
  const young = !!d.young;
  const rx = Math.max(5, Math.round(W * (young ? 0.28 : 0.26)));
  const ry = Math.max(5, Math.round(H * (young ? 0.30 : 0.28)));
  const headY = Math.round(H * 0.375);
  const chinY = headY + ry;
  const shoulderY = Math.min(H - 8, chinY + 4);
  const top = headY - ry;
  const eyeH = Math.max(3, Math.round(ry * 0.45));
  const eyeW = Math.max(3, Math.round(rx * 0.6));
  const eyeIn = Math.max(1, Math.round(rx * 0.22));
  const eyeY = headY;
  const noseY = eyeY + eyeH + 1;
  const mouthY = chinY - 3;
  const browY = eyeY - 4;
  const style = d.hair || 'short';
  const tie = d.hairTie ? slotRamp(d.hairTie, d.accent || '#c8203a') : P.trim;

  // --- everything behind the head ------------------------------------------
  if (d.aura) {
    const a = slotRamp(d.aura, d.accent || '#ffe9a3');
    for (let i = 0; i < 8; i++) {
      b.set(2 + (i % 3) * 2, 3 + i * 2, i & 1 ? a.lite : a.base);
      b.set(W - 3 - (i % 3) * 2, 4 + i * 2, i & 1 ? a.base : a.lite);
    }
  }
  if (d.wings) {
    // Only the leading edge of a wing makes it into a bust, which is enough:
    // the viewer already knows the world sprite has them.
    const wc = slotRamp(d.wingColor, d.accent || '#e8e8f0');
    for (const s of [-1, 1]) {
      const x = s < 0 ? 1 : W - 5;
      b.taper(x, shoulderY - 6, 4, 4, H - shoulderY + 6, wc.dark);
      b.vline(s < 0 ? x : x + 3, shoulderY - 5, H - shoulderY + 4, wc.base);
      b.set(s < 0 ? x : x + 3, shoulderY - 6, wc.lite);
    }
  }
  const backLen = ({ long: 18, bangs: 17, bob: 8, wave: 12, twin: 16, drills: 15,
                     sidetail: 15, ponytail: 13, braid: 15, ducktail: 7,
                     lowTwin: 16, twinLong: 18 })[style] || 0;
  if (backLen) {
    b.pair(cx, rx - 1, headY - ry + 3, 4, backLen, hc.base);
    b.pair(cx, rx + 2, headY - ry + 5, 1, backLen - 4, hc.dark);
    b.pair(cx, rx - 1, headY - ry + 6, 1, backLen - 6, hc.lite);
  }
  if (style === 'drills') {
    // The same three cues as the world sprite — a scalloped edge, a lit thread
    // wrapping the coil and a dark seam where it tucks behind itself — with the
    // room a 40x40 grid buys to actually resolve them. The stacked blocks this
    // replaced were a staircase, and a staircase is what a drill looks like only
    // if you have never seen one.
    const dTop = chinY - 7, dBot = H - 2;
    const dLen = Math.max(8, dBot - dTop);
    for (let j = 0; j <= dLen; j++) {
      const y = dTop + j;
      if (y >= H) break;
      const t = j / dLen;
      const k = j & 3;
      const dx = rx - 1 + Math.round(3 * Math.min(1, t * 2.5));
      const w = Math.min(Math.max(3, Math.round(8 - 5 * t)) + (k === 1 || k === 2 ? 1 : 0),
                         Math.max(3, W - 1 - cx - dx));
      b.pair(cx, dx, y, w, 1, k === 0 ? hc.dark : hc.base);
      b.pair(cx, dx + Math.min(w - 1, k), y, 1, 1, k === 0 ? hc.deep : hc.lite);
      if (k === 3) b.pair(cx, dx, y, 1, 1, hc.deep);
    }
  }
  if (style === 'lowTwin') {
    // Gathered at the NAPE, which on a bust is the one place a hairstyle is
    // fully in frame — so the ties are drawn big and the fall is drawn straight.
    b.pair(cx, rx - 1, chinY - 5, 5, 2, tie.lite);
    b.pair(cx, rx - 1, chinY - 3, 5, 3, tie.base);
    b.pair(cx, rx - 1, chinY, 5, 1, tie.dark);
    b.pair(cx, rx - 1, chinY + 1, 5, H - chinY - 1, hc.base);
    b.pair(cx, rx + 2, chinY + 3, 1, H - chinY - 5, hc.dark);
    b.pair(cx, rx - 1, chinY + 4, 1, H - chinY - 7, hc.lite);
  }
  if (style === 'twin' || style === 'twinLong') {
    b.pair(cx, rx, headY - ry + 1, 5, 5, hc.base);
    b.pair(cx, rx, headY - ry + 6, 5, 2, tie.base);
    b.pair(cx, rx + 1, headY - ry + 5, 3, 1, tie.lite);
  }
  if (style === 'twinLong') {
    // The two falls, running straight off the bottom of the frame. A bust is
    // the one crop where LONG hair cannot be shown as long, so what sells it
    // instead is that the tails leave the picture rather than ending in it —
    // and the swing outward, which is what tells them from a pair of curtains.
    const fTop = headY - ry + 8;
    for (let j = 0; fTop + j < H; j++) {
      const dx = rx + Math.min(3, j >> 2);
      b.pair(cx, dx, fTop + j, 4, 1, hc.base);
      b.pair(cx, dx, fTop + j, 1, 1, mixHex(hc.lite, WHITE, 0.22));
      b.pair(cx, dx + 3, fTop + j, 1, 1, hc.dark);
      if (j % 6 === 5) b.pair(cx, dx + 2, fTop + j, 2, 1, hc.deep);
    }
  }
  if (style === 'ponytail') {
    b.rect(cx + rx - 1, headY - ry + 3, 5, 18, hc.base);
    b.vline(cx + rx + 3, headY - ry + 6, 12, hc.lite);
    b.rect(cx + rx - 1, headY - ry + 5, 5, 2, tie.base);
  }
  if (style === 'sidetail') {
    b.rect(cx - rx - 3, headY - ry + 5, 5, 18, hc.base);
    b.vline(cx - rx - 3, headY - ry + 8, 10, hc.lite);
    b.rect(cx - rx - 3, headY - ry + 6, 5, 2, tie.base);
  }
  if (style === 'braid') {
    for (let j = 0; j < 18; j++) {
      b.rect(cx - rx - 3, chinY - 10 + j, 4, 1, j % 3 === 2 ? hc.deep : hc.base);
      if (j % 3 === 0) b.set(cx - rx - 3, chinY - 10 + j, hc.lite);
    }
  }
  if (style === 'ducktail') {
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        b.spike(cx + s * (rx - 2 + i * 3) - 2, top + 4 + i * 2, 5, 6 + i * 2, -1,
                i & 1 ? hc.lite : hc.base);
      }
    }
  }
  if (P.tip) b.retint(0, chinY, W, H - chinY, hc, P.tip);
  if (d.hoodDown) {
    // Drawn BEFORE the shoulders, so all that survives is the roll of cloth
    // standing proud of the jaw on each side — which is the only part of a hood
    // worn down that a head-and-shoulders crop can honestly show.
    const c = slotRamp(d.hoodDown, d.outfit || '#e8e4dc');
    const y = chinY - 4;
    b.taper(cx - rx - 3, y, rx * 2 + 7, rx * 2 + 11, H - y, c.base);
    b.hline(cx - rx - 2, y, rx * 2 + 5, c.lite);
    for (const s of [-1, 1]) {
      b.vline(cx + s * (rx + 2), y + 1, H - y - 2, c.dark);
      b.set(cx + s * (rx + 3), y + 3, c.lite);
    }
  }

  // --- shoulders, collar and outfit ----------------------------------------
  const shBot = (W >> 1) - 3;
  const shTop = Math.max(5, shBot - 5);
  b.taper(cx - shTop, shoulderY, shTop * 2 + 1, shBot * 2 + 1, H - shoulderY, P.cloth.base);
  b.hline(cx - shTop + 1, shoulderY, shTop * 2 - 1, P.cloth.lite);
  b.hline(cx - shTop - 2, H - 2, shTop * 2 + 5, P.cloth.dark);
  if (d.coat) {
    b.rect(cx - shBot, shoulderY + 2, 6, H - shoulderY - 2, P.coat.base);
    b.rect(cx + shBot - 5, shoulderY + 2, 6, H - shoulderY - 2, P.coat.base);
    b.vline(cx - shBot + 6, shoulderY + 2, H - shoulderY - 2, P.coat.lite);
    b.vline(cx + shBot - 6, shoulderY + 2, H - shoulderY - 2, P.coat.lite);
    if (d.coatPattern === 'check') {
      const alt = typeof d.coatPattern2 === 'string' ? d.coatPattern2 : shade(P.coat.base, -0.62);
      b.patternCheck(0, shoulderY, W, H - shoulderY, P.coat, alt, 2);
    }
    if (d.coatTrim) {
      b.vline(cx - shBot, shoulderY + 2, H - shoulderY - 2, d.coatTrim);
      b.vline(cx + shBot, shoulderY + 2, H - shoulderY - 2, d.coatTrim);
    }
    if (d.coatLapels) {
      // The lapels are the ONE part of a long coat a bust can show properly,
      // and they are the reason the feature exists — a peaked collar is a face
      // frame, so a portrait that crops it out has thrown away the thing the
      // world sprite could only hint at.
      const lc = slotRamp(d.coatLapels, d.coatTrim || P.coat.lite);
      for (const s of [-1, 1]) {
        for (let j = 0; j < H - shoulderY - 1; j++) {
          const w = Math.max(2, 5 - ((j * 4 / Math.max(1, H - shoulderY)) | 0));
          const x = s < 0 ? cx - 4 - w : cx + 5;
          b.rect(x, shoulderY + 1 + j, w, 1, lc.base);
          b.set(s < 0 ? x : x + w - 1, shoulderY + 1 + j, lc.dark);
          b.set(s < 0 ? x + w - 1 : x, shoulderY + 1 + j, lc.lite);
        }
        b.rect(s < 0 ? cx - 9 : cx + 5, shoulderY - 2, 5, 3, lc.base);   // the collar
        b.hline(s < 0 ? cx - 9 : cx + 5, shoulderY - 2, 5, lc.lite);
      }
    }
    if (d.coatButtons) {
      const bc = slotRamp(d.coatButtons, d.accent || '#e8c34a');
      for (let y = shoulderY + 4; y < H - 1; y += 5) {
        for (const s of [-1, 1]) {
          b.rect(cx + s * 4 - (s < 0 ? 1 : 0), y, 2, 2, bc.base);
          b.set(cx + s * 4 - (s < 0 ? 1 : 0), y, bc.lite);
        }
      }
    }
  }
  if (d.shoulderCape) {
    // A bust is almost entirely shoulder, so the mantle that the world sprite
    // can only afford as a hem is most of the picture here — and it stays OPEN
    // down the middle for the same reason it does there: the buttons and the
    // crest live in those columns.
    const c = slotRamp(d.shoulderCape, d.accent || '#e8e4dc');
    b.rect(cx - shBot, shoulderY, shBot * 2 + 1, 2, c.base);
    b.hline(cx - shBot + 1, shoulderY, shBot * 2 - 1, c.lite);
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - shBot - 1 : cx + 4;
      const w = shBot - 2;
      b.rect(x, shoulderY + 2, w, H - shoulderY - 3, c.base);
      b.vline(s < 0 ? x : x + w - 1, shoulderY + 2, H - shoulderY - 3, c.dark);
      b.vline(s < 0 ? x + w - 1 : x, shoulderY + 2, H - shoulderY - 3, c.deep);
      for (let i = 0; i < w; i += 2) b.set(x + i, H - 2, c.deep);
    }
  }
  if (d.pinafore) {
    // The bib and its two straps are the whole of an apron that survives a bust,
    // and they have to: a maid uniform with the pinafore cropped out of the
    // portrait is a navy dress, which is a different character.
    const c = slotRamp(d.pinafore, '#f4f1ea');
    const bw = Math.max(3, shTop - 6);
    b.rect(cx - bw, shoulderY + 2, bw * 2 + 1, H - shoulderY - 2, c.base);
    b.hline(cx - bw, shoulderY + 2, bw * 2 + 1, c.lite);
    b.vline(cx + bw, shoulderY + 3, H - shoulderY - 3, c.dark);
    for (const s of [-1, 1]) {
      b.vline(cx + s * bw, shoulderY - 1, 4, c.base);
      b.set(cx + s * bw, shoulderY - 1, c.lite);
    }
  }
  if (d.pauldrons || d.pauldron) {
    const pc = slotRamp(d.pauldrons, d.accent || '#9aa7bd');
    const sides = d.pauldron === 'left' ? [-1] : d.pauldron === 'right' ? [1] : [-1, 1];
    for (const s of sides) {
      const x = s < 0 ? cx - shTop - 6 : cx + shTop + 1;
      b.rect(x, shoulderY - 1, 6, 5, pc.base);
      b.hline(x, shoulderY - 1, 6, pc.lite);
      b.hline(x, shoulderY + 3, 6, pc.deep);
      b.hline(x + (s < 0 ? 1 : 0), shoulderY + 4, 5, pc.dark);
    }
  }
  // neck
  b.rect(cx - 3, chinY - 1, 7, shoulderY - chinY + 2, P.skin.dark);
  b.hline(cx - 3, chinY + 1, 7, P.skin.deep);
  b.set(cx - 3, chinY - 1, P.skin.base);
  b.set(cx + 3, chinY - 1, P.skin.base);
  if (d.highCollar) {
    const c = slotRamp(d.highCollar, d.outfit || '#243050');
    b.rect(cx - 6, chinY, 13, shoulderY - chinY + 4, c.base);
    b.hline(cx - 6, chinY, 13, c.lite);
    b.vline(cx - 6, chinY - 3, 4, c.base);
    b.vline(cx + 6, chinY - 3, 4, c.base);
    b.set(cx - 6, chinY - 3, c.lite);
    b.set(cx + 6, chinY - 3, c.lite);
    b.vline(cx, chinY + 2, shoulderY - chinY + 2, c.dark);
  } else if (d.scarf) {
    const sc = slotRamp(d.scarf, d.accent || '#c8342a');
    b.rect(cx - 7, chinY + 1, 15, 4, sc.base);
    b.hline(cx - 7, chinY + 1, 15, sc.lite);
    b.hline(cx - 7, chinY + 4, 15, sc.dark);
    b.rect(cx - 2, chinY + 2, 4, 3, sc.dark);                 // the knot
    b.rect(cx - 9, chinY + 4, 4, 8, sc.dark);                 // the trailing end
    b.set(cx - 9, chinY + 11, sc.deep);
  } else {
    b.hline(cx - 7, shoulderY, 15, P.trim.base);              // collar
    b.hline(cx - 7, shoulderY + 1, 15, P.trim.dark);
    b.set(cx, shoulderY + 1, P.trim.lite);
    b.set(cx - 5, shoulderY + 1, P.trim.deep);
    b.set(cx + 5, shoulderY + 1, P.trim.deep);
  }
  if (d.neckBow) {
    // Drawn AFTER the collar rather than instead of it: the ribbon is tied over
    // whatever the character's neckline already is, and at bust scale there is
    // finally room for two loops, a knot and two ends that are all separable.
    const c = slotRamp(d.neckBow, d.accent || '#c8342a');
    const y = chinY + 2;
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - 7 : cx + 3;
      b.rect(x, y, 4, 4, c.base);
      b.hline(x, y, 4, c.lite);
      b.hline(x, y + 3, 4, c.dark);
      b.set(s < 0 ? x : x + 3, y + 1, c.deep);
    }
    b.rect(cx - 2, y, 5, 4, c.base);                          // the knot
    b.hline(cx - 2, y, 5, mixHex(c.lite, WHITE, 0.3));
    b.hline(cx - 2, y + 3, 5, c.dark);
    b.set(cx, y + 1, c.deep);
    b.rect(cx - 2, y + 4, 2, 3, c.base);                      // the two ends
    b.rect(cx + 1, y + 4, 2, 3, c.base);
    b.hline(cx - 2, y + 6, 2, c.deep);
    b.hline(cx + 1, y + 6, 2, c.deep);
  }
  if (d.tie) {
    const t = slotRamp(d.tie, d.accent || '#8a2020');
    b.rect(cx - 2, shoulderY - 1, 5, 3, t.base);
    b.hline(cx - 2, shoulderY - 1, 5, t.lite);
    b.taper(cx - 2, shoulderY + 2, 5, 5, H - shoulderY - 2, t.base);
    b.vline(cx, shoulderY + 2, H - shoulderY - 2, t.lite);
  }
  if (d.chest) {
    // The character's crest, moved from mid-chest (cropped away by a bust) up
    // onto the collarbone, so a portrait still carries the badge.
    b.hline(cx - 2, shoulderY + 4, 5, d.chest);
    b.hline(cx - 1, shoulderY + 3, 3, d.chest);
    b.hline(cx - 1, shoulderY + 5, 3, d.chest);
    b.set(cx, shoulderY + 2, d.chest);
    b.set(cx, shoulderY + 6, d.chest);
    b.set(cx, shoulderY + 4, shade(d.chest, 0.45));
  }

  // --- the crown of hair, UNDER the face -----------------------------------
  // Highlights are drawn as smaller ELLIPSES, never as flat hlines: an hline
  // wider than the dome it sits on leaves a notch of background inside the
  // silhouette, which outline() then fills with a black bar through the skull.
  if (style !== 'none') {
    b.ellipse(cx, headY - 1, rx + 2, ry + 1, hc.base);
    b.ellipse(cx, headY - 4, rx - 1, ry - 3, hc.lite);
    b.ellipse(cx, headY - 5, rx - 4, ry - 6, mixHex(hc.lite, WHITE, 0.35));
    b.ellipse(cx, headY + 2, rx + 2, ry - 2, hc.base);
    b.vline(cx - rx - 1, headY - 2, 6, hc.dark);
    b.vline(cx + rx + 1, headY - 2, 6, hc.dark);
  }

  // --- head ----------------------------------------------------------------
  b.ellipse(cx, headY, rx, ry, P.skin.base);
  b.taper(cx - rx + 3, chinY - 5, rx * 2 - 5, 5, 6, P.skin.base);
  b.hline(cx - rx + 4, headY - ry + 1, rx * 2 - 7, P.skin.lite);
  if (style !== 'none') {
    // The crown of hair is drawn UNDER the face, and the face ellipse is taller
    // than the crown's apex is wide: the top row of the skull pokes straight
    // through the hair, so every single portrait in the game had a five-pixel
    // BALD SPOT at the crown. Putting the apex back has to be an hline and not
    // another ellipse, but nine columns is comfortably inside the fifteen the
    // crown already occupies on that row, so outline() never sees it — which is
    // the whole reason the highlights above are ellipses and this is allowed to
    // be a bar.
    b.hline(cx - 4, headY - ry, 9, hc.base);
  }
  b.hline(cx - rx + 2, chinY - 4, 3, P.skin.dark);            // jaw shadow
  b.hline(cx + rx - 4, chinY - 4, 3, P.skin.dark);
  b.set(cx - 3, chinY, P.skin.dark);
  b.set(cx + 3, chinY, P.skin.dark);
  // Ear nubs, so earrings have somewhere to hang from.
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - rx : cx + rx - 1;
    b.rect(x, headY + 1, 2, 4, P.skin.base);
    b.vline(s < 0 ? x : x + 1, headY + 2, 3, P.skin.dark);
  }

  // --- the face, which is the whole reason a portrait exists ---------------
  const iris = ramp(P.eyes);
  const covered = d.eyepatch ? (d.eyepatch === 'right' ? 1 : -1) : 0;
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - eyeIn - eyeW : cx + eyeIn + 1;
    b.hline(x, browY, eyeW, hc.dark);                         // brow
    b.hline(x + (s < 0 ? 0 : 1), browY - 1, eyeW - 1, hc.deep);
    b.set(s < 0 ? x - 1 : x + eyeW, browY + 1, hc.dark);      // the outer lift
    b.hline(x, eyeY - 2, eyeW, hc.base);                      // upper lid
    b.hline(x, eyeY - 1, eyeW, hc.deep);                      // lash line
    b.set(s < 0 ? x - 1 : x + eyeW, eyeY - 1, hc.deep);
    b.rect(x, eyeY, eyeW, eyeH, EYE_WHITE);                   // sclera
    b.rect(x + 1, eyeY, eyeW - 2, eyeH, iris.base);           // iris
    b.rect(x + 2, eyeY + 1, Math.max(1, eyeW - 4), eyeH - 2, iris.deep);   // pupil
    b.hline(x + 1, eyeY + eyeH - 1, eyeW - 2, iris.lite);     // lit lower rim
    b.rect(s < 0 ? x + 1 : x + eyeW - 3, eyeY, 2, 2, WHITE);  // catch-light
    b.set(s < 0 ? x + eyeW - 2 : x + 1, eyeY + eyeH - 2, mixHex(iris.lite, WHITE, 0.6));
    b.hline(x, eyeY + eyeH, eyeW, P.skin.dark);               // under-eye line
    if (d.eyeSigil) {
      // Three marks orbiting the pupil. There is finally room for all three, and
      // three is the number that makes the eye read as a sigil and not a defect.
      const sg = typeof d.eyeSigil === 'string' ? d.eyeSigil : '#14141c';
      b.set(x + 1, eyeY, sg);
      b.set(x + eyeW - 2, eyeY + 1, sg);
      b.set(x + 2, eyeY + eyeH - 1, sg);
    }
    if (P.glow) b.hline(x, eyeY + eyeH + 1, eyeW, P.glow);
  }
  b.set(cx, noseY - 1, P.skin.dark);                          // nose
  b.set(cx - 1, noseY, P.skin.deep);
  b.hline(cx - 1, mouthY, 3, P.skin.deep);                    // mouth
  b.set(cx, mouthY + 1, mixHex(P.skin.dark, '#c05a5a', 0.4));
  b.set(cx - 2, mouthY, mixHex(P.skin.dark, '#c05a5a', 0.3));
  const blush = mixHex(P.skin.base, '#ff8a9a', 0.45);
  b.hline(cx - rx + 2, noseY - 1, 3, blush);                  // cheeks
  b.hline(cx + rx - 4, noseY - 1, 3, blush);
  if (d.whiskers) {
    const wc = typeof d.whiskers === 'string' ? d.whiskers : mixHex(P.skin.dark, '#7a4a2a', 0.65);
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - rx + 2 : cx + rx - 5;
      for (let k = 0; k < 3; k++) b.hline(x, noseY - 1 + k, 3, wc);
    }
  }
  if (covered) {
    const c = slotRamp(d.eyepatchColor, '#14141c');
    const s = covered;
    const x = s < 0 ? cx - eyeIn - eyeW - 1 : cx + eyeIn;
    b.rect(x, browY + 1, eyeW + 2, eyeH + 3, c.base);
    b.hline(x, browY + 1, eyeW + 2, c.lite);
    b.hline(x, browY + eyeH + 3, eyeW + 2, c.deep);
    b.rect(x + 2, eyeY, 2, 2, mixHex(c.lite, WHITE, 0.4));
    b.hline(s < 0 ? cx - rx + 1 : cx + eyeIn + eyeW + 1, browY + 2, rx - eyeIn - eyeW + 2, c.dark);
  }

  if (d.mask) {
    const mc = slotRamp(d.mask, d.accent || '#243050');
    b.rect(cx - rx + 3, noseY - 1, rx * 2 - 5, chinY - noseY + 2, mc.base);
    b.hline(cx - rx + 3, noseY - 1, rx * 2 - 5, mc.lite);
    b.hline(cx - rx + 3, chinY, rx * 2 - 5, mc.dark);
  }
  if (d.visor) {
    const vc = slotRamp(d.visor, '#8ad8ff');
    b.rect(cx - rx + 1, eyeY - 2, rx * 2 - 1, eyeH + 3, vc.dark);
    b.hline(cx - rx + 1, eyeY + 1, rx * 2 - 1, vc.base);
    b.hline(cx - rx + 2, eyeY - 2, 4, vc.lite);
    b.set(cx + rx - 3, eyeY + eyeH, vc.lite);
    b.hline(cx - 1, eyeY, 3, vc.deep);                        // the bridge
  }

  // --- the fringe, over the face but never over the eyes -------------------
  if (style !== 'none') {
    const fTop = headY - ry + 1;
    const fH = Math.max(2, browY - fTop - 1);
    b.rect(cx - rx + 2, fTop, rx * 2 - 3, fH, hc.base);
    b.hline(cx - rx + 3, fTop, rx * 2 - 5, hc.lite);
    b.hline(cx - rx + 2, fTop + fH - 1, rx * 2 - 3, hc.dark);
    if (style === 'buzz' || style === 'undercut') {
      b.rect(cx - rx + 3, fTop + 1, rx * 2 - 5, fH - 1, hc.dark);
      b.hline(cx - rx + 3, fTop + 1, rx * 2 - 5, hc.base);
      if (style === 'undercut') {
        b.pair(cx, rx - 2, fTop + 2, 2, fH + 4, hc.deep);     // the shaved sides
        b.rect(cx - rx + 4, fTop - 1, rx * 2 - 7, 3, hc.base);
      }
    } else if (style === 'bowl' || style === 'bangs') {
      b.rect(cx - rx, fTop, rx * 2 + 1, fH + 1, hc.base);
      b.hline(cx - rx, fTop, rx * 2 + 1, hc.lite);
      b.hline(cx - rx, fTop + fH, rx * 2 + 1, hc.dark);
      if (style === 'bangs') b.rect(cx - rx, fTop, 5, fH + eyeH + 4, hc.dark);
    } else if (style === 'spiky' || style === 'wild' || style === 'flame' ||
               style === 'plume' || style === 'ducktail') {
      const n = style === 'plume' ? 4 : 5;
      for (let i = 0; i < n; i++) {
        const dx = -rx + 1 + Math.round(i * (rx * 2 - 2) / (n - 1));
        const h = style === 'flame' ? 6 + Math.round(6 * (1 - Math.abs(i - 2) / 2.4))
                : style === 'plume' ? 10 : style === 'wild' ? 4 + (i & 3)
                : style === 'ducktail' ? 5 : 7;
        b.spike(cx + dx - 2, fTop + 2, 5, h, -1, i & 1 ? hc.lite : hc.base);
      }
      if (style === 'ducktail') b.pair(cx, rx - 3, fTop, 3, fH + 6, hc.dark);
    } else if (style === 'ahoge') {
      b.vline(cx + 2, top - 6, 7, hc.base);
      b.set(cx + 3, top - 6, hc.lite);
      b.set(cx + 4, top - 5, hc.lite);
      b.pair(cx, rx - 4, fTop, 3, fH + 4, hc.dark);
    } else if (style === 'topknot') {
      b.rect(cx - 4, top - 6, 9, 5, hc.base);
      b.hline(cx - 4, top - 6, 9, hc.lite);
      b.rect(cx - 3, top - 1, 7, 2, tie.base);
    } else {
      // A parted fringe: a lit strand, and two locks down past the temples.
      b.rect(cx - rx + 2, fTop, 4, fH + 4, hc.dark);
      b.rect(cx + rx - 5, fTop, 4, fH + 3, hc.dark);
      b.hline(cx - 3, fTop, 7, mixHex(hc.lite, WHITE, 0.3));
      b.hline(cx - 2, fTop + 1, 5, mixHex(hc.lite, WHITE, 0.15));
    }
    if (d.hairStreak) {
      const sc = slotRamp(d.hairStreak, d.accent || '#3fb6c8');
      const x = cx + rx - 7;
      b.rect(x, fTop, 3, fH + 4, sc.base);
      b.vline(x + 2, fTop, fH + 5, sc.dark);
      b.hline(x, fTop, 3, sc.lite);
      b.set(x + 1, fTop + fH + 4, sc.deep);
    }
    if (d.sideBraid) {
      const bc = typeof d.sideBraid === 'string' ? ramp(d.sideBraid) : hc;
      const bt = d.hairTie ? slotRamp(d.hairTie, d.accent || '#c8203a') : P.trim;
      const x = cx - rx - 1;
      const len = ry + 6;
      for (let j = 0; j < len; j++) {
        b.rect(x, fTop + 2 + j, 3, 1, j % 3 === 2 ? bc.deep : bc.base);
        if (j % 3 === 0) b.hline(x, fTop + 2 + j, 2, bc.lite);
      }
      b.rect(x, fTop + 2 + len, 3, 2, bt.base);
      b.hline(x, fTop + 2 + len, 3, bt.lite);
    }
    if (d.scar) {
      const x = cx + (d.scar === 'left' ? -6 : 3);
      const y = fTop + 1;
      b.rect(x, y, 4, 5, P.skin.base);
      b.hline(x, y, 4, P.skin.lite);
      const sc = mixHex(P.skin.dark, '#b8452c', 0.7);
      b.set(x + 3, y, sc); b.set(x + 2, y + 1, sc);
      b.set(x + 2, y + 2, sc); b.set(x + 1, y + 3, sc);
      b.set(x + 1, y + 4, mixHex(sc, P.skin.base, 0.4));
    }
  }

  if (covered && d.eyepatchStrap) {
    // AFTER the fringe, for the same reason it is after the fringe on the world
    // sprite: the patch is painted with the face and the hair is painted over
    // the face, so a strap drawn with the patch is a strap nobody ever sees.
    // Diagonal, again — a level band across a brow is a headband.
    const c = slotRamp(d.eyepatchStrap,
                       typeof d.eyepatchColor === 'string' ? d.eyepatchColor : '#14141c');
    const s = covered;
    const x0 = cx + s * (eyeIn + eyeW + 1);
    b.blade(x0, browY + 2, cx + s * (rx + 1), browY - 1, c.base, c.dark);
    b.blade(cx + s * (rx + 1), browY - 1, cx + s * (rx - 3), top + 1, c.base, c.dark);
    b.rect(cx + s * rx - (s < 0 ? 1 : 0), browY - 2, 3, 3, c.base);   // the buckle
    b.hline(cx + s * rx - (s < 0 ? 1 : 0), browY - 2, 3, c.lite);
    b.set(cx + s * rx, browY - 1, mixHex(c.lite, WHITE, 0.4));
    b.blade(cx - s * (rx - 4), top, cx - s * (rx - 1), top + 3, c.dark, c.deep);
  }

  // --- the signature above the hairline ------------------------------------
  const t = P.trim;
  if (d.ears === 'fox' || d.ears === 'cat') {
    const ec = d.earColor ? slotRamp(d.earColor, hc.base) : hc;
    const ei = d.earInner ? slotRamp(d.earInner, ec.lite).base : mixHex(ec.lite, '#ff9ecb', 0.4);
    const h = d.ears === 'fox' ? 9 : 6;
    for (const s of [-1, 1]) {
      b.spike(cx + s * (rx - 2) - 3, top + 1, 7, h, -1, ec.base);
      b.spike(cx + s * (rx - 2) - 2, top, 5, h - 3, -1, ei);
      b.set(cx + s * (rx - 2), top - h + 2, mixHex(ec.lite, WHITE, 0.4));
    }
  } else if (d.ears === 'long') {
    // Long drooping mascot ears — they hang beside the head rather than stand.
    for (const s of [-1, 1]) {
      b.ellipse(cx + s * (rx + 3), headY - 2, 2, 9, P.skin.base);
      b.vline(cx + s * (rx + 3), headY - 10, 5, P.skin.lite);
      b.set(cx + s * (rx + 3), headY + 6, t.base);
    }
  } else if (d.ears === 'elf') {
    for (const s of [-1, 1]) {
      b.line(cx + s * rx, headY, cx + s * (rx + 4), headY - 6, P.skin.base);
      b.line(cx + s * rx, headY + 1, cx + s * (rx + 3), headY - 4, P.skin.lite);
    }
  } else if (d.ears === 'ribbon') {
    for (const s of [-1, 1]) {
      b.rect(cx + s * (rx + 2) - 3, headY - 5, 7, 7, t.base);
      b.rect(cx + s * (rx + 2) - 2, headY - 4, 5, 5, t.lite);
      b.rect(cx + s * (rx + 2) - 1, headY - 3, 3, 3, t.base);
      b.vline(cx + s * (rx + 2), headY + 3, 9, t.dark);
      b.set(cx + s * (rx + 3), headY + 11, t.base);
    }
  } else if (d.ears === 'fin') {
    b.spike(cx - 5, top - 7, 11, 9, 1, t.base);
    b.line(cx + 4, top - 7, cx + 5, top - 1, t.lite);
    b.set(cx - 1, top - 5, mixHex(t.lite, WHITE, 0.4));
  } else if (d.ears === 'horns') {
    for (const s of [-1, 1]) {
      b.line(cx + s * (rx - 2), top + 1, cx + s * (rx - 1), top - 5, t.lite);
      b.line(cx + s * (rx - 1), top + 1, cx + s * rx, top - 4, t.base);
    }
  } else if (d.ears === 'greatHorns') {
    for (const s of [-1, 1]) {
      b.blade(cx + s * (rx - 2), top + 2, cx + s * (rx + 4), top - 8, t.lite, t.base);
      b.set(cx + s * (rx + 5), top - 9, mixHex(t.lite, WHITE, 0.5));
    }
  }
  if (d.earrings) {
    const c = slotRamp(d.earrings, '#f4f1ea');
    const c2 = slotRamp(d.earringsMotif, d.accent || '#d64545');
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - rx - 2 : cx + rx;
      b.set(x + (s < 0 ? 1 : 0), headY + 3, c.dark);
      b.rect(x, headY + 4, 3, 6, c.base);
      b.hline(x, headY + 4, 3, c.lite);
      b.rect(x, headY + 6, 3, 2, c2.base);
      b.hline(x, headY + 9, 3, c.dark);
    }
  }
  if (d.hairpin) {
    const c = slotRamp(d.hairpinColor, d.accent || '#ffe14a');
    const x = cx - rx + 2, y = top + 3;
    if (d.hairpin === 'star') {
      b.set(x + 2, y - 2, c.lite);
      b.hline(x, y, 5, c.base);
      b.vline(x + 2, y - 1, 4, c.base);
      b.set(x + 1, y + 1, c.dark);
      b.set(x + 3, y + 1, c.dark);
      b.set(x + 2, y, mixHex(c.lite, WHITE, 0.7));
    } else if (d.hairpin === 'bell') {
      // The same ornament as the world sprite with the rows a 40x40 bust can
      // spend on it: a real dome, a real slit and a clapper that is its own
      // shape rather than one pixel. Sited on the crown for the same reason â€”
      // the temple is where the hair ties are.
      const bx = cx - 3, by = top + 1;
      b.ellipse(bx + 2, by + 3, 4, 4, c.base);
      b.hline(bx, by, 6, c.lite);                              // the crown loop
      b.hline(bx - 1, by + 4, 8, c.dark);                      // the mouth slit
      b.hline(bx, by + 6, 6, c.deep);
      b.rect(bx + 1, by + 1, 2, 2, mixHex(c.lite, WHITE, 0.6));
      b.vline(bx + 2, by + 7, 2, c.dark);                      // the clapper
    } else {
      b.rect(x, y, 5, 3, c.base);
      b.hline(x, y, 5, c.lite);
    }
  }
  if (style === 'drills') {
    // The ribbons, drawn LATE and AT THE ROOT OF THE FALL. In the back-hair pass
    // they sat under the crown ellipse and half of each one was painted out by
    // the very hair it is supposed to be tying; up at the temple they read as a
    // pair of handlebars growing out of the head. They belong exactly where the
    // coil starts, which is level with the jaw.
    const ry0 = chinY - 9;
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - rx - 3 : cx + rx - 1;
      b.rect(x, ry0 + 2, 4, 3, tie.base);                              // the knot
      b.hline(x, ry0 + 2, 4, tie.lite);
      b.hline(x, ry0 + 4, 4, tie.dark);
      b.rect(x, ry0, 4, 2, tie.base);                                  // two loops
      b.rect(x, ry0 + 5, 4, 2, tie.base);
      b.hline(x, ry0, 4, tie.lite);
      b.hline(x, ry0 + 6, 4, tie.deep);
      b.set(s < 0 ? x + 3 : x, ry0 + 3, tie.deep);
    }
  }
  if (d.headdress) {
    // The frilled cap, sitting on top of the hair and NOT across the brow. On a
    // bust it is in frame and unmissable, so the scallops get a full pixel of
    // travel each instead of the single lit row the world sprite can afford.
    const c = slotRamp(d.headdress, '#f4f1ea');
    const r = slotRamp(d.headdressRibbon, typeof d.headdress === 'string' ? d.headdress : '#f4f1ea');
    const y = Math.max(3, top + 1);
    const x = cx - rx + 1;
    const w = rx * 2 - 1;
    b.rect(x, y, w, 3, c.base);
    b.hline(x, y + 2, w, c.dark);
    for (let i = 0; i < w; i++) {
      b.set(x + i, y - 1, i & 1 ? c.base : c.lite);
      if ((i & 3) === 1) b.vline(x + i, y - 3, 2, mixHex(c.lite, WHITE, 0.45));
    }
    for (const s of [-1, 1]) {
      const rx2 = s < 0 ? x - 3 : x + w;
      b.rect(rx2, y, 3, 3, r.base);
      b.hline(rx2, y, 3, r.lite);
      b.rect(s < 0 ? rx2 : rx2 + 1, y + 3, 2, 3, r.dark);
      b.hline(s < 0 ? rx2 : rx2 + 1, y + 5, 2, r.deep);
    }
  }
  if (d.headband) {
    const c = slotRamp(d.headband, d.accent || '#1a1d2e');
    const pl = slotRamp(d.headbandPlate, '#b9c4de');
    const y = top + 4;
    b.hline(cx - rx, y, rx * 2 + 1, c.base);
    b.hline(cx - rx, y + 1, rx * 2 + 1, c.dark);
    b.rect(cx - 5, y - 2, 11, 5, pl.base);
    b.hline(cx - 5, y - 2, 11, pl.lite);
    b.hline(cx - 5, y + 2, 11, pl.dark);
    b.hline(cx - 2, y, 5, pl.deep);                           // the engraving
    b.rect(cx - rx - 1, y + 2, 2, 6, c.dark);                 // the trailing tail
  }
  if (d.sparks) {
    const c = slotRamp(d.sparks, '#7ad9ff');
    const pts = [[-rx - 2, top + 4], [-rx - 4, top + 6], [-rx - 3, top + 9],
                 [rx + 2, top + 3], [rx + 4, top + 5], [rx + 3, top + 8],
                 [-2, top - 2], [3, top - 3]];
    for (let i = 0; i < pts.length; i++) {
      b.set(clamp(cx + pts[i][0], 0, W - 1), Math.max(0, pts[i][1]),
            i & 1 ? c.base : mixHex(c.lite, WHITE, 0.4));
    }
  }
  if (d.crown) {
    const c = slotRamp(d.crown, d.accent || '#ffd76a');
    b.hline(cx - rx + 2, top - 1, rx * 2 - 3, c.base);
    b.hline(cx - rx + 2, top, rx * 2 - 3, c.dark);
    for (let i = -rx + 2; i <= rx - 2; i += 3) b.set(cx + i, top - 2, c.lite);
    b.set(cx, top - 3, c.lite);
    b.set(cx, top - 1, mixHex(c.lite, WHITE, 0.6));
  }
  if (d.hat === 'tricorn') {
    // The same hat as the world sprite and built out of the same three parts —
    // a domed crown, a wide brim, and two corners cocked up against it — with
    // the rows a 40x40 bust can spend on making each of them unmistakable.
    // Anchored BELOW the crown of the head rather than above it: the old
    // portrait put the hat's own crown at top-5, which on this grid is row -1,
    // so the tallest thing on the character was drawn outside the buffer.
    const c = slotRamp(d.hatColor, '#241826');
    const g = slotRamp(d.hatTrim, d.accent || '#e8c34a');
    const y = Math.max(7, top + 2);
    const bw = rx + 5;
    const crownH = 6;
    b.taper(cx - rx + 3, y - crownH, rx * 2 - 5, rx * 2 + 1, crownH, c.base);
    b.hline(cx - rx + 5, y - crownH, rx * 2 - 9, c.lite);
    b.vline(cx + rx - 4, y - crownH + 2, crownH - 2, c.deep);
    b.hline(cx - bw, y, bw * 2 + 1, c.base);                   // the brim
    b.hline(cx - bw + 2, y + 1, bw * 2 - 3, c.dark);
    b.hline(cx - rx + 1, y + 2, rx * 2 - 1, c.deep);
    for (const s of [-1, 1]) {                                 // the cocked corners
      const x = s < 0 ? cx - bw : cx + bw - 2;
      for (let j = 1; j <= 6; j++) {
        b.rect(x + (s < 0 ? (j >> 2) : -(j >> 2)), y - j, 3, 1, j & 1 ? c.base : c.lite);
      }
      b.hline(s < 0 ? x : x + 1, y - 7, 2, c.dark);
    }
    b.hline(cx - rx + 3, y - 2, rx * 2 - 5, g.base);           // the band
    b.hline(cx - rx + 4, y - 3, rx * 2 - 7, g.dark);
    b.hline(cx - bw, y, bw * 2 + 1, g.dark);                   // the brim piping
    for (let i = -bw; i <= bw; i += 2) b.set(cx + i, y, g.base);
    b.rect(cx - bw + 1, y - 5, 4, 4, g.base);                  // the cockade
    b.hline(cx - bw + 1, y - 5, 4, g.lite);
    b.rect(cx - bw + 2, y - 4, 2, 2, mixHex(g.lite, WHITE, 0.55));
  }
  if (d.hat === 'beret') {
    // SMALL, and set off-centre. Sized off `rx` like the other headgear it came
    // out as a white dome the width of the skull, which on a character who also
    // has two white ears either side of the frame is one continuous pale mass
    // with a face cut out of the middle of it. A beret only reads as soft
    // because you can see the hair it is NOT covering.
    const c = slotRamp(d.hatColor, '#f4f1ea');
    const y = Math.max(4, top + 3);
    b.ellipse(cx + 3, y, rx - 4, 2, c.base);
    b.ellipse(cx + 2, y - 1, Math.max(1, rx - 7), 1, c.lite);
    b.hline(cx - rx + 5, y + 2, rx * 2 - 9, c.dark);           // the band on the hair
    b.set(cx + rx - 2, y + 1, c.deep);                         // the overhanging edge
    b.set(cx + rx - 1, y, c.dark);
    b.rect(cx + 2, y - 4, 2, 2, c.base);                       // the stalk
    b.set(cx + 2, y - 4, mixHex(c.lite, WHITE, 0.5));
  }
  if (d.hat === 'topHat') {
    const c = slotRamp(d.hatColor, '#1a1420');
    b.hline(cx - 1, top - 1, 11, c.base);
    b.hline(cx - 1, top, 11, c.deep);
    b.rect(cx + 1, top - 6, 7, 6, c.base);
    b.hline(cx + 1, top - 6, 7, c.lite);
    b.hline(cx + 1, top - 2, 7, t.base);
    b.set(cx + 6, top - 5, mixHex(c.lite, WHITE, 0.4));
  }
  if (d.hatPlume) {
    const c = slotRamp(d.hatPlume, '#f4f1ea');
    for (let j = 0; j < 9; j++) {
      const w = Math.max(1, 4 - (j >> 1));
      b.hline(cx + rx - 2 + (j >> 1), Math.max(0, top - 2 - j), w, j & 1 ? c.base : c.lite);
    }
    b.set(cx + rx + 3, Math.max(0, top - 10), mixHex(c.lite, WHITE, 0.5));
  }
  if (d.ears === 'rabbit') {
    // Drawn after the headgear for the same reason as on the world sprite: they
    // are taller than the frame and a cap on top of them cuts them off.
    //
    // On a bust there is finally room to show what the world sprite can only
    // imply — the ears go up off the crown, turn over at the top edge, and come
    // straight back down the OUTSIDE of the picture past the shoulders. They
    // run off the bottom on purpose: an ear that stops inside the frame is an
    // ear with a length, and the whole point of these is that they read as
    // having none.
    const ec = d.earColor ? slotRamp(d.earColor, hc.base) : hc;
    const ei = d.earInner ? slotRamp(d.earInner, ec.lite).base : mixHex(ec.lite, '#ff9ecb', 0.4);
    const outX = Math.max(1, cx - rx - 5);
    for (const s of [-1, 1]) {
      const x = s < 0 ? outX : W - outX - 3;
      for (let j = 0; j < 5; j++) {                            // the root
        const rxx = cx + s * (rx - 5 + j) - (s < 0 ? 4 : 0);
        b.rect(rxx, Math.max(0, top + 2 - j), 5, 1, ec.base);
        b.rect(rxx + 1, Math.max(0, top + 2 - j), 2, 1, ei);
      }
      b.rect(s < 0 ? outX : W - outX - 5, 0, 5, 2, ec.lite);   // the turn
      for (let y = 1; y < H; y++) {                            // the fall
        b.rect(x, y, 3, 1, ec.base);
        b.set(s < 0 ? x + 2 : x, y, ec.dark);
        // Pink for the top half only, exactly as on the world sprite: lined all
        // the way down, two ears at the edges of a bust read as a striped
        // border somebody has put the portrait inside.
        if (y < H * 0.45 && y % 4 !== 3) b.set(s < 0 ? x : x + 2, y, ei);
        if (y % 9 === 8) b.set(s < 0 ? x + 2 : x, y, ec.lite);
      }
    }
  }
  if (d.halo) {
    const c = typeof d.halo === 'string' ? d.halo : '#ffe9a3';
    const y = Math.max(0, top - (d.hair === 'ahoge' ? 8 : 5));
    b.hline(cx - rx + 3, y, rx * 2 - 5, c);
    b.set(cx - rx + 2, y + 1, shade(c, -0.25));
    b.set(cx + rx - 2, y + 1, shade(c, -0.25));
    b.set(cx - rx + 4, y, mixHex(c, WHITE, 0.5));
  }
}

/** A soft round creature — slimes, ghosts, mascots, wisps. */
function drawBlob(b, d) {
  const cx = b.w >> 1, cy = b.h >> 1;
  const c = ramp(d.outfit || '#7fd6a0');
  const t = ramp(d.accent || shade(d.outfit || '#7fd6a0', -0.5));
  // A blob normally fills its grid, which leaves an ear nowhere to go — so the
  // dome gives up two pixels of radius and sits two rows lower when there are
  // ears to draw. Anchoring the ears to the top of the grid instead just left
  // them hovering above the head with nothing holding them up.
  const longEars = d.ears === 'long';
  const r = Math.max(3, Math.min(cx, cy) - 2 - (longEars ? 2 : 0));
  const by = cy + (longEars ? 2 : 1);
  const eyeR = Math.max(1, r >> 2);
  b.ellipse(cx, by, r, r - 1, c.base);
  // Three tones on the dome: a broad top light, a rim light on the upper left,
  // and a contact shadow. One flat fill reads as a bubble, not as a body.
  b.ellipse(cx, by - 2, r - 2, r - 3, c.lite);
  b.ellipse(cx - (r >> 2), by - 1 - (r >> 1), Math.max(1, r >> 2), Math.max(1, r >> 2),
            mixHex(c.lite, WHITE, 0.55));
  b.hline(cx - r + 1, by + r - 2, r * 2 - 1, c.dark);
  b.hline(cx - r + 2, by + r - 1, r * 2 - 3, c.deep);
  // THE FACE IS A FRACTION OF THE DOME, NOT A FIXED NUMBER OF PIXELS.
  //
  // The eye BLOCK already scaled off `r` while its catch-light, its mouth and
  // its blush were pinned at one pixel each. That is invisible at the 18x18 a
  // swarmer is drawn on and ruinous at the 40x40 the HUD bust uses, where a
  // 1px gleam inside a 7px eye is a speck and the creature reads as a dome with
  // two holes punched in it. Everything below derives from `r`, so the same
  // face arrives at every size the grid is ever set to.
  const eyeC = d.eyes || '#1a1a2e';
  const eyeW = Math.max(2, Math.round(r * 0.30));
  const eyeH = Math.max(3, Math.round(r * 0.40));
  const eyeGap = Math.max(1, Math.round(r * 0.17));
  const eyeY = by - Math.max(2, Math.round(r * 0.22));
  const gleam = Math.max(1, Math.round(eyeW * 0.5));
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - eyeGap - eyeW : cx + eyeGap + 1;
    b.rect(x, eyeY, eyeW, eyeH, eyeC);
    // The catch-light goes in the OUTER upper corner and is sized off the eye.
    // This one block is the whole difference between an eye and a hole.
    b.rect(s < 0 ? x : x + eyeW - gleam, eyeY, gleam, gleam, EYE_WHITE);
    b.set(s < 0 ? x + eyeW - 1 : x, eyeY + eyeH - 1, mixHex(eyeC, WHITE, 0.32));
  }
  // Blush, outboard of each eye and never touching it.
  const bw = Math.max(1, Math.round(r * 0.20));
  const blush = mixHex(c.base, '#ff7a8f', 0.5);
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - eyeGap - eyeW - bw : cx + eyeGap + eyeW + 1;
    b.rect(x, eyeY + eyeH, bw, Math.max(1, Math.round(bw * 0.6)), blush);
  }
  // A mouth, which is what turns a circle into a creature. Two shoulders and a
  // dip rather than a bar, so it still has a SHAPE when it is three pixels wide.
  const mw = Math.max(1, Math.round(r * 0.22));
  const my = eyeY + eyeH + Math.max(1, Math.round(r * 0.14));
  b.hline(cx - mw, my, mw * 2 + 1, t.deep);
  b.hline(cx - (mw >> 1), my + 1, (mw >> 1) * 2 + 1, t.deep);
  b.set(cx, my + Math.max(1, Math.round(mw * 0.6)) + 1, t.dark);
  b.set(cx - mw - 1, my, t.dark);
  b.set(cx + mw + 1, my, t.dark);
  if (d.chest) {
    // A faceted gem, not a dot: a lit top-left and a dark lower-right make three
    // pixels look cut rather than painted on.
    const y = by - r + 2;
    b.hline(cx - 1, y, 3, d.chest);
    b.set(cx, y - 1, d.chest);
    b.set(cx, y + 1, d.chest);
    b.set(cx - 1, y, mixHex(d.chest, WHITE, 0.55));
    b.set(cx + 1, y, shade(d.chest, -0.35));
  }
  if (longEars) {
    // Rooted inside the dome and leaning outward as they rise, two pixels thick,
    // with a coloured tip. Thickness and lean are what stop them reading as a
    // pair of antennae.
    for (const s of [-1, 1]) {
      const rootX = cx + s * ((r >> 1) + 1);
      for (let j = 0; j < r; j++) {
        const x = rootX + s * ((j * 3) >> 2);
        const y = by - r + 2 - j;
        b.set(x, y, j & 1 ? c.base : c.lite);
        b.set(x + s, y, c.base);
        if (j === r - 1) b.set(x + s, y - 1, t.base);
      }
    }
  } else if (d.ears === 'horns') {
    for (const s of [-1, 1]) b.spike(cx + s * (r - 2) - 1, by - r - 1, 3, 3, -1, t.base);
  }
}

/** A hovering wraith — ghosts, wisps, spirits. No legs; a ragged hem. */
function drawGhost(b, d) {
  const W = b.w, H = b.h;
  const cx = W >> 1;
  const c = ramp(d.outfit || '#b9c4de');
  const t = ramp(d.accent || shade(d.outfit || '#b9c4de', -0.5));
  const top = 2;
  const headR = Math.max(3, Math.round(W * 0.25));
  const headY = top + headR;
  const hemY = H - 3;
  // A cowl, not a balloon: the skirt flares to two thirds of the grid, so the
  // silhouette still has shoulders instead of being a wall of colour.
  const half = Math.max(headR + 1, Math.round(W * 0.35));
  b.ellipse(cx, headY, headR, headR - 1, c.base);
  b.taper(cx - headR, headY + headR - 3, headR * 2 + 1, half * 2 + 1,
          hemY - headY - headR + 3, c.base);
  b.hline(cx - headR + 2, top, headR * 2 - 3, c.lite);
  b.hline(cx - headR + 1, top + 1, headR * 2 - 1, c.lite);
  b.vline(cx - headR, headY + headR, hemY - headY - headR - 1, c.dark);
  b.vline(cx + headR, headY + headR, hemY - headY - headR - 1, c.dark);
  // Vertical folds in the shroud, so the mass is not one flat panel.
  for (let i = -half + 3; i <= half - 3; i += 4) {
    b.vline(cx + i, headY + headR + 2, hemY - headY - headR - 3, c.dark);
  }
  // sleeves, hanging where arms would be
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - half + 1 : cx + half - 2;
    b.rect(x, headY + headR + 1, 2, Math.max(2, (hemY - headY) >> 1), c.dark);
    b.set(s < 0 ? x : x + 1, headY + headR + 1, c.lite);
  }
  // A torn hem, alternating tongues, which is the read for "no feet".
  for (let i = -half; i <= half; i += 2) b.vline(cx + i, hemY - 1, 2, c.dark);
  for (let i = -half + 1; i <= half - 1; i += 2) b.set(cx + i, hemY, c.deep);
  const eyeC = d.eyes || '#ff5f7e';
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - headR + 1 : cx + headR - 3;
    b.rect(x, headY - 1, 3, 4, '#141420');                     // hollow socket
    b.rect(x, headY, 2, 2, eyeC);
    b.set(s < 0 ? x : x + 1, headY, mixHex(eyeC, WHITE, 0.5));
  }
  b.hline(cx - 1, headY + headR - 2, 3, '#141420');            // a gasping mouth
  b.set(cx, headY + headR - 1, '#141420');
  if (d.chest) b.hline(cx - 1, headY + headR + 2, 3, d.chest);
  if (d.halo) b.hline(cx - headR + 2, Math.max(0, top - 2), headR * 2 - 3, typeof d.halo === 'string' ? d.halo : '#ffe9a3');
  if (d.ears === 'horns') {
    for (const s of [-1, 1]) b.spike(cx + s * (headR - 1) - 1, top, 3, 3, -1, t.base);
  }
  // trailing wisps, so it reads as drifting rather than standing
  b.set(cx - half - 2, headY + headR + 1, c.lite);
  b.set(cx + half + 2, headY + headR + 3, c.lite);
  b.set(cx - half - 3, headY + headR + 4, c.base);
}

/** A four-legged or hunched beast — oni, husks, crawlers. */
function drawBeast(b, d, pose) {
  const W = b.w, H = b.h;
  const cx = W >> 1;
  const c = ramp(d.outfit || '#a05f5f');
  const t = ramp(d.accent || '#3a2020');
  const bottom = H - 3;
  const half = Math.max(4, Math.round(W * 0.30));
  const headR = Math.max(3, Math.round(W * 0.19));
  // A beast is mostly BODY. The first pass gave it a short barrel on stilts;
  // the mass runs to three quarters of the grid and the legs are stubs.
  const bodyTop = Math.max(headR + 2, Math.round(H * 0.30));
  const legTop = Math.round(H * 0.78);
  const headY = Math.max(headR, bodyTop - 2);
  b.taper(cx - half, bodyTop, half * 2 + 1, half * 2 - 5, legTop - bodyTop, c.base);
  b.hline(cx - half + 1, bodyTop, half * 2 - 1, c.lite);
  b.hline(cx - half + 2, legTop - 1, half * 2 - 3, c.deep);
  // ribs and a ridge of plates down the spine — "armoured animal" in six pixels
  for (let j = 3; j < legTop - bodyTop - 2; j += 3) {
    b.hline(cx - half + 2, bodyTop + j, half * 2 - 3, c.dark);
    b.set(cx - half + 2, bodyTop + j, c.deep);
    b.set(cx + half - 2, bodyTop + j, c.deep);
  }
  for (let i = -half + 2; i <= half - 2; i += 3) {
    b.set(cx + i, bodyTop - 1, t.lite);
    b.set(cx + i, bodyTop, t.base);
  }
  // head, low and forward
  b.ellipse(cx, headY, headR, headR - 1, c.base);
  b.hline(cx - headR + 2, headY - headR + 1, headR * 2 - 3, c.lite);
  b.taper(cx - 2, headY + 1, 5, 3, 4, c.dark);                 // muzzle
  const eyeC = d.eyes || '#ffd23f';
  b.rect(cx - headR + 1, headY, 2, 2, eyeC);
  b.rect(cx + headR - 2, headY, 2, 2, eyeC);
  b.set(cx - headR + 1, headY, mixHex(eyeC, WHITE, 0.5));
  b.set(cx + headR - 1, headY, mixHex(eyeC, WHITE, 0.5));
  // A jaw of teeth rather than three white dots: the alternating row is what
  // makes it read as a mouth at fodder size.
  for (let i = -2; i <= 2; i++) b.set(cx + i, headY + 3, i & 1 ? '#c8c2ba' : '#e8e4dc');
  b.hline(cx - 2, headY + 4, 5, t.deep);
  if (d.ears === 'horns' || d.ears === 'greatHorns') {
    const big = d.ears === 'greatHorns';
    for (const s of [-1, 1]) {
      b.spike(cx + s * (headR - 1) - 1, headY - headR, 3, big ? 5 : 3, -1, t.lite);
      if (big) b.blade(cx + s * headR, headY - headR, cx + s * (headR + 3), headY - headR - 5, t.lite, t.base);
    }
  }
  if (d.pauldrons) {
    const pc = slotRamp(d.pauldrons, d.accent || '#9aa7bd');
    for (const s of [-1, 1]) {
      b.rect(s < 0 ? cx - half - 1 : cx + half - 1, bodyTop, 3, 5, pc.base);
      b.hline(s < 0 ? cx - half - 1 : cx + half - 1, bodyTop, 3, pc.lite);
      b.hline(s < 0 ? cx - half - 1 : cx + half - 1, bodyTop + 4, 3, pc.deep);
    }
  }
  // FOUR STUBBY LIMBS, and on a quadruped they move in DIAGONAL PAIRS — near
  // fore with off hind. That is what separates an animal's gait from a person's
  // at any size, and it costs nothing: the hind leg on side `s` takes that
  // side's pose and the forelimb takes the OPPOSITE side's, out of the same
  // four-beat table the humanoid uses.
  const p = pose || POSE_IDLE;
  const legH = Math.max(2, bottom - legTop + 1);
  for (const s of [-1, 1]) {
    const hSw = s < 0 ? p.l : p.r;                  // hind, this side
    const fSw = s < 0 ? p.r : p.l;                  // fore, its diagonal partner
    const hUp = p.lift === s ? 1 : 0;
    const fUp = p.lift === -s ? 1 : 0;
    const hx = (s < 0 ? cx - half : cx + half - 2) + s * hSw;
    const fx = (s < 0 ? cx - half + 4 : cx + half - 6) + s * fSw;
    const px = hx - (s < 0 ? 1 : 0);
    b.rect(hx, legTop, 3, Math.max(2, legH - hUp), c.dark);
    b.rect(fx, legTop, 3, Math.max(2, legH - fUp), c.deep);
    b.hline(px, bottom - hUp, 4, t.deep);                                  // paw
    for (let i = 0; i < 3; i++) b.set(px + i, bottom - 1 - hUp, t.dark);
    b.hline(fx, bottom - fUp, 3, t.dark);                                  // fore paw
  }
  if (d.tails) {
    b.line(cx + half, bodyTop + 3, cx + half + 3, bodyTop - 2, c.base);
    b.set(cx + half + 3, bodyTop - 3, c.lite);
  }
}

/**
 * A DRAKE — a full dragon, front-on, wings spread.
 *
 * This is not the humanoid plan with wings turned on, and the difference is the
 * entire point. A transformation whose sprite is the same person with something
 * bolted to her back is not a transformation, it is a status effect: what has to
 * change is the SILHOUETTE, so nothing in here is shared with the humanoid at
 * all. The proportions are an animal's — a head half the width of the chest, no
 * shoulders, a barrel that hangs between the forelimbs rather than sitting on
 * top of the hips, digitigrade hind legs, and a tail that is a third of the
 * grid on its own.
 *
 * FRONT-ON, and symmetric except for the tail, because that is the convention
 * every other body plan in this file follows and a run of sprites that suddenly
 * turns side-on reads as a bug in the renderer. The tail is what breaks the
 * mirror, exactly as it does on the humanoid.
 *
 * The wings are drawn FIRST and the body over the top, so what survives is the
 * span either side of the animal and nothing across its chest — which is how a
 * pair of wings actually reads from the front, and is also what stops the
 * membrane eating the one part of the sprite the player looks at.
 */
function drawDrake(b, d, pose) {
  const W = b.w, H = b.h;
  const cx = W >> 1;
  const c = ramp(d.outfit || '#c8452c');
  const t = ramp(d.accent || '#ffd76a');                       // horn, claw, spine
  const wing = slotRamp(d.wingColor, shade(d.outfit || '#c8452c', -0.45));
  const belly = slotRamp(d.underLayer, mixHex(d.outfit || '#c8452c', '#ffd76a', 0.45));
  const bottom = H - 3;
  const headR = Math.max(4, Math.round(W * 0.135));
  // headR + 6, not headR + 3: the horns sweep five rows ABOVE the skull and
  // they are the second-loudest thing on the animal. Anchored any higher and
  // the buffer simply cuts them off, which is how the first pass ended up with
  // a dragon wearing two stubs.
  const headY = Math.max(headR + 6, Math.round(H * 0.24));
  const bodyTop = Math.max(headY + headR + 1, Math.round(H * 0.42));
  const hipY = Math.round(H * 0.70);
  const half = Math.max(6, Math.round(W * 0.19));
  const spanX = Math.min((W >> 1) - 3, Math.round(W * 0.44));

  if (d.aura) {
    const a = slotRamp(d.aura, d.accent || '#ffe9a3');
    for (let i = 0; i < 10; i++) {
      b.set(1 + (i % 3), 4 + i * 3, i & 1 ? a.lite : a.base);
      b.set(W - 2 - (i % 3), 6 + i * 3, i & 1 ? a.base : a.lite);
    }
  }

  // --- the wings ------------------------------------------------------------
  // A membrane hung off a leading edge, with FINGER STRUTS and a scalloped
  // trailing edge. All three are load-bearing: a plain filled triangle is a
  // cape, struts alone are an umbrella, and it is the scallops between the
  // fingers that say "bat" rather than "bird" — which is the whole reason this
  // is not the feather wing the humanoid plan already has.
  for (const s of [-1, 1]) {
    const rootX = cx + s * (half - 2), rootY = bodyTop - 1;
    const tipX = cx + s * spanX, tipY = 2;
    const n = Math.max(4, Math.abs(tipX - rootX));
    const deep = Math.max(6, hipY - tipY - 6);
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = rootX + s * i;
      const y = Math.round(rootY + (tipY - rootY) * u);
      const g = u < 0.72 ? u / 0.72 : 1 - (u - 0.72) / 0.28 * 0.62;
      const drop = Math.max(2, Math.round(3 + (deep - 3) * g) - (i % 5 >= 3 ? 2 : 0));
      b.vline(x, y, drop, wing.dark);
      if (i % 5 === 0) {
        b.vline(x, y, drop, wing.base);                        // a finger
        b.set(x, y + drop - 1, wing.lite);                     // and its claw
      }
      b.set(x, y, wing.base);                                  // the leading edge
      b.set(x, y + 1, wing.lite);
    }
    b.set(tipX, tipY - 1, t.lite);                             // the wing claw
    b.set(tipX - s, tipY - 2, t.base);
  }

  // --- the tail -------------------------------------------------------------
  // The one asymmetry, and it earns its place: a long segmented sweep with a
  // lit ridge and spines standing off the upper edge, finishing in a fin.
  {
    const n = Math.max(12, Math.round(W * 0.42));
    let tx = cx + half - 3, ty = hipY - 1;
    for (let j = 0; j <= n; j++) {
      const u = j / n;
      tx = clamp(cx + half - 3 + Math.round(W * 0.30 * Math.sin(u * 1.5)), 1, W - 4);
      ty = clamp(hipY - 1 + Math.round((bottom - hipY + 3) * Math.pow(u, 1.25)), 1, bottom);
      const w = Math.max(1, Math.round(5 - 4 * u));
      b.rect(tx, ty, w, 1, j & 1 ? c.base : c.dark);
      b.set(tx, ty, c.lite);                                   // the scale ridge
      if (j % 3 === 0) b.set(tx + w - 1, ty, c.deep);
      if (j % 3 === 1 && u < 0.75) b.set(tx + w, ty - 1, t.base);   // dorsal spines
    }
    for (let j = 0; j < 4; j++) b.hline(tx, ty - 1 + j, Math.max(1, 3 - Math.abs(j - 1)), t.base);
    b.set(tx + 1, ty, mixHex(t.lite, WHITE, 0.4));
  }

  // --- the barrel -----------------------------------------------------------
  const bodyH = Math.max(6, hipY - bodyTop + 4);
  b.taper(cx - half, bodyTop, half * 2 + 1, half * 2 - 7, bodyH, c.base);
  b.hline(cx - half + 1, bodyTop, half * 2 - 1, c.lite);
  b.vline(cx - half + 1, bodyTop + 2, bodyH - 4, c.lite);
  b.vline(cx + half - 1, bodyTop + 2, bodyH - 4, c.deep);
  // The BELLY SCUTES: pale horizontal bands down the middle, narrowing toward
  // the haunch. They are the difference between a dragon and a lizard-coloured
  // barrel, and they are also the only pale mass on the whole animal, so they
  // are what stops it going to one solid tone at a distance.
  for (let j = 2; j < bodyH - 2; j += 2) {
    const w = Math.max(4, half - 1 - (j >> 2));
    b.hline(cx - (w >> 1), bodyTop + j, w, (j >> 1) & 1 ? belly.base : belly.lite);
    b.set(cx - (w >> 1), bodyTop + j, belly.dark);
  }
  b.hline(cx - half + 4, bodyTop + bodyH - 1, half * 2 - 7, c.deep);
  if (d.chest) {
    const y = bodyTop + 2;
    b.hline(cx - 2, y, 5, d.chest);
    b.hline(cx - 1, y - 1, 3, d.chest);
    b.hline(cx - 1, y + 1, 3, d.chest);
    b.set(cx, y - 2, d.chest);
    b.set(cx, y + 2, d.chest);
    b.set(cx - 1, y, mixHex(d.chest, WHITE, 0.55));
  }

  // --- the limbs ------------------------------------------------------------
  // Diagonal pairs, like the beast: the forelimb on one side moves with the hind
  // leg on the other. A drake gets only the two CONTACT beats (see FRAME_PLAN),
  // so `lift` is never set here and the whole gait lives in the swing.
  const p = pose || POSE_IDLE;
  for (const s of [-1, 1]) {
    const hSw = s < 0 ? p.l : p.r;
    const fSw = s < 0 ? p.r : p.l;
    const hStep = s * hSw * 2, fStep = s * fSw;
    // forelimb: a short bent arm hanging off the shoulder, claws forward
    const x = (s < 0 ? cx - half - 2 : cx + half - 1) + fStep;
    const fh = Math.max(5, Math.round(H * 0.16));
    b.rect(x, bodyTop + 1, 3, fh, c.dark);
    b.vline(s < 0 ? x : x + 2, bodyTop + 1, fh, c.deep);
    b.hline(x, bodyTop + 1, 3, c.base);
    b.rect(s < 0 ? x - 1 : x, bodyTop + fh, 4, 3, c.base);
    for (let i = 0; i < 3; i++) b.set((s < 0 ? x - 1 : x) + i, bodyTop + fh + 3, t.lite);
    // hind leg: a heavy haunch, a shin tucked under it, a three-clawed foot.
    // The haunch stays put and only the shin and foot travel — a digitigrade
    // leg bends at the hock, so the mass above it does not move with the step.
    const hx = s < 0 ? cx - half + 1 : cx + half - 6;
    b.rect(hx, hipY - 6, 6, 8, c.base);
    b.hline(hx, hipY - 6, 6, c.lite);
    b.hline(hx, hipY + 1, 6, c.deep);
    b.vline(s < 0 ? hx : hx + 5, hipY - 5, 7, c.dark);
    const sx = (s < 0 ? cx - half + 2 : cx + half - 5) + hStep;
    b.rect(sx, hipY + 2, 4, Math.max(2, bottom - hipY - 3), c.dark);
    b.vline(s < 0 ? sx : sx + 3, hipY + 2, Math.max(2, bottom - hipY - 3), c.deep);
    const fx = s < 0 ? sx - 2 : sx - 1;
    b.rect(fx, bottom - 1, 6, 2, c.base);
    b.hline(fx, bottom, 6, c.dark);
    for (let i = 0; i < 3; i++) b.set(fx + i * 2, bottom, t.lite);
  }

  // --- the neck and the head ------------------------------------------------
  const neckTop = headY + headR - 2;
  const neckH = Math.max(2, bodyTop - neckTop + 2);
  b.taper(cx - 4, neckTop, 9, 15, neckH, c.base);
  b.vline(cx - 4, neckTop + 1, neckH - 1, c.dark);
  b.vline(cx + 4, neckTop + 1, neckH - 1, c.deep);
  for (let j = 1; j < neckH; j += 2) b.hline(cx - 2, neckTop + j, 5, belly.base);
  // The crest, drawn BEFORE the skull so only the points clear it.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      b.spike(cx + s * (headR - 2 + i * 2) - 1, headY - headR + 1 + i, 3, 4 - i, -1, t.dark);
    }
  }
  b.ellipse(cx, headY, headR + 1, headR - 1, c.base);
  b.hline(cx - headR + 2, headY - headR + 1, headR * 2 - 3, c.lite);
  b.hline(cx - headR, headY - 2, headR * 2 + 1, c.dark);       // the brow ridge
  // The MUZZLE. A dragon's head is mostly snout, and without one this is a
  // horned cat: it drops clear of the skull, narrows, and ends in a jaw.
  const snoutY = headY + 1;
  const snoutH = Math.max(4, headR);
  b.taper(cx - 4, snoutY, 9, 5, snoutH, c.base);
  b.hline(cx - 3, snoutY, 7, c.lite);
  b.set(cx - 2, snoutY + 2, c.deep);                           // the nostrils
  b.set(cx + 2, snoutY + 2, c.deep);
  const jawY = snoutY + snoutH - 1;
  b.hline(cx - 2, jawY, 5, c.deep);
  for (let i = -2; i <= 2; i++) b.set(cx + i, jawY - 1, i & 1 ? '#c8c2ba' : '#e8e4dc');
  // The EYES, set into a dark socket and deliberately oversized. Two pixels of
  // iris in a two-pixel socket is a rivet: on a face this wide the eye has to
  // be a SLIT with a lit outer corner or the head reads as armour plate with a
  // mouth in it, and the whole point of a transformation is that something is
  // looking at you.
  const eyeC = d.eyes || '#ffd23f';
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - headR - 1 : cx + headR - 3;
    b.rect(x, headY - 2, 4, 4, '#14141c');
    b.rect(s < 0 ? x : x + 1, headY - 1, 3, 2, eyeC);
    b.set(s < 0 ? x : x + 3, headY - 1, mixHex(eyeC, WHITE, 0.6));
    b.set(s < 0 ? x + 2 : x + 1, headY, shade(eyeC, -0.55));   // the slit pupil
    if (d.eyeGlow) b.hline(s < 0 ? x : x + 1, headY + 2, 3, d.eyeGlow);
    b.spike(cx + s * (headR + 1) - 1, headY + 2, 3, 3, 1, t.dark);   // the cheek spike
  }
  // GREAT HORNS, two pixels thick and swept back and out, plus a smaller pair
  // under them. One pair reads as a bull; two reads as a dragon.
  for (const s of [-1, 1]) {
    const x0 = cx + s * (headR - 1), y0 = headY - headR + 1;
    const x1 = cx + s * Math.min(headR + 6, (W >> 1) - 2), y1 = Math.max(1, y0 - 6);
    b.blade(x0, y0, x1, y1, t.lite, t.base);
    b.line(x0, y0 + 1, x1, y1 + 1, t.dark);
    b.set(x1 + s, Math.max(0, y1 - 1), mixHex(t.lite, WHITE, 0.5));
    b.blade(cx + s * headR, headY - 3, cx + s * (headR + 4), headY - 6, t.base, t.dark);
  }
}

/** A machine — drones, golems, mechs. Hard edges, a single lens. */
function drawMech(b, d, pose) {
  const W = b.w, H = b.h;
  const cx = W >> 1;
  const c = ramp(d.outfit || '#9aa7bd');
  const t = ramp(d.accent || '#ff5f7e');
  const half = Math.max(3, Math.round(W * 0.30));
  // Anchored to the grid rather than centred on it, so a taller grid gets a
  // taller chassis instead of a small box floating in the middle of one.
  const top = Math.max(1, Math.round(H * 0.16));
  const botY = Math.round(H * 0.74);
  const cy = (top + botY) >> 1;
  const bottom = H - 3;
  b.rect(cx - half, top, half * 2 + 1, botY - top + 1, c.base);
  b.hline(cx - half, top, half * 2 + 1, c.lite);
  b.hline(cx - half, botY, half * 2 + 1, c.deep);
  b.vline(cx - half, top + 1, botY - top - 1, c.dark);
  b.vline(cx + half, top + 1, botY - top - 1, c.dark);
  // panel seams, so the chassis is not one flat plate
  b.hline(cx - half + 1, top + 2, half * 2 - 1, c.dark);
  b.hline(cx - half + 1, botY - 2, half * 2 - 1, c.dark);
  for (let j = top + 4; j < botY - 3; j += 4) {
    b.set(cx - half + 1, j, c.lite);
    b.set(cx + half - 1, j, c.lite);
  }
  // Chamfered corners. A perfect rectangle reads as a crate; four cut corners
  // read as a machined housing, and it costs four pixels.
  b.set(cx - half, top, c.dark);
  b.set(cx + half, top, c.dark);
  b.set(cx - half, botY, c.deep);
  b.set(cx + half, botY, c.deep);
  // the lens, and a sensor strip across the brow
  b.ellipse(cx, cy, 3, 3, t.dark);
  b.ellipse(cx, cy, 2, 2, t.base);
  b.set(cx - 1, cy - 1, mixHex(t.lite, WHITE, 0.5));
  b.hline(cx - 3, top + 1, 7, t.dark);
  b.set(cx, top + 1, t.lite);
  // struts / manipulators
  for (const s of [-1, 1]) {
    b.rect(s < 0 ? cx - half - 2 : cx + half + 1, top + 3, 2, botY - top - 6, c.dark);
    b.set(s < 0 ? cx - half - 2 : cx + half + 2, cy + 2, t.base);
    b.set(s < 0 ? cx - half - 2 : cx + half + 2, top + 3, c.lite);
  }
  // LEGS, and they walk — but as a PISTON STROKE, not a stride. No knee break,
  // no roll, no tone change on the forward foot: the whole leg travels a column
  // and the foot lifts a row, and that is all. Which is exactly what makes it
  // read as a machine standing next to a person who does have a gait.
  const p = pose || POSE_IDLE;
  const legH = Math.max(1, bottom - botY);
  for (const s of [-1, 1]) {
    const sw = s < 0 ? p.l : p.r;
    const up = p.lift === s ? 1 : 0;
    const x = (s < 0 ? cx - half + 1 : cx + half - 3) + s * sw;
    b.rect(x, botY + 1, 3, Math.max(1, legH - up), c.deep);
    b.hline(x - (s < 0 ? 1 : 0), bottom - up, 4, c.dark);
  }
  if (d.wings) {
    // Anchored to the grid edge rather than to `half`, so the rotor booms stay
    // inside the buffer (and keep their outline) on every mech grid size.
    for (const s of [-1, 1]) {
      const x = s < 0 ? 1 : W - 5;
      b.rect(x, top + 1, 4, 2, c.lite);
      b.hline(x, top + 2, 4, c.dark);
      b.set(s < 0 ? x : x + 3, top + 3, t.base);
    }
  }
  if (d.halo) b.hline(cx - 3, Math.max(0, top - 3), 7, typeof d.halo === 'string' ? d.halo : '#ffe9a3');
}

/** A boss — a bigger humanoid or beast with a heavier silhouette. */
function drawTitan(b, d, pose) {
  const W = b.w, H = b.h;
  const cx = W >> 1;
  const c = ramp(d.outfit || '#8a5f8f');
  const t = ramp(d.accent || '#ffd23f');
  const half = Math.max(6, Math.round(W * 0.19));
  const headR = Math.max(4, Math.round(W * 0.13));
  const headY = Math.round(H * 0.22);
  const torsoY = Math.round(H * 0.30);
  const torsoH = Math.round(H * 0.45);
  const legY = Math.round(H * 0.74);
  if (d.cape) b.taper(cx - half - 4, torsoY - 2, half * 2 + 9, half * 2 + 15, Math.round(H * 0.55), shade(c.deep, -0.2));
  b.taper(cx - half, torsoY, half * 2 + 1, half * 2 - 5, torsoH, c.base);      // torso
  b.hline(cx - half + 1, torsoY, half * 2 - 1, c.lite);
  // Slab musculature: a sternum line and three rib bands. A boss that is one
  // flat trapezoid reads as a background prop no matter how large it is.
  b.vline(cx, torsoY + 3, torsoH - 6, c.dark);
  for (let j = Math.round(torsoH * 0.25); j < torsoH - 4; j += Math.max(3, torsoH >> 3)) {
    b.hline(cx - half + 3, torsoY + j, half * 2 - 5, c.dark);
  }
  b.ellipse(cx, headY, headR, headR - 1, c.lite);                              // head
  b.hline(cx - headR + 2, headY - headR, headR * 2 - 3, c.lite);
  b.taper(cx - 3, headY + headR - 3, 7, 3, 4, c.dark);                         // the jaw
  const eyeC = d.eyes || '#ff3a5e';
  b.rect(cx - headR + 1, headY, Math.max(2, headR - 2), 2, eyeC);
  b.rect(cx + 2, headY, Math.max(2, headR - 2), 2, eyeC);
  b.set(cx - headR + 1, headY, mixHex(eyeC, WHITE, 0.5));
  b.set(cx + headR - 1, headY, mixHex(eyeC, WHITE, 0.5));
  for (const s of [-1, 1]) {                                                   // arms
    const x = s < 0 ? cx - half - 5 : cx + half - 1;
    b.taper(x, torsoY + 2, 6, 5, Math.round(H * 0.34), c.dark);
    b.vline(s < 0 ? x : x + 5, torsoY + 3, Math.round(H * 0.30), c.deep);
    b.rect(s < 0 ? x : x + 1, torsoY + 2 + Math.round(H * 0.34), 5, 5, c.deep); // fists
    b.hline(s < 0 ? x : x + 1, torsoY + 2 + Math.round(H * 0.34), 5, c.dark);
  }
  // LEGS, with the two-beat trudge a thing this size gets. The titan takes only
  // the CONTACT beats — feet apart, then apart the other way — and skips the
  // passing lift entirely, which is both the correct read (nothing weighing this
  // much picks a foot up cleanly) and where all the atlas memory is: a boss is
  // rastered at 168-224px square, so every extra frame here costs 40x what one
  // costs on a character.
  //
  // The stride is TWO columns, not one. A boss grid is 56-64 wide against the
  // humanoid's 30, so a one-column step is half the relative travel and reads as
  // a wobble rather than a walk.
  const p = pose || POSE_IDLE;
  const tLegW = Math.max(4, half - 3);
  const tLegH = Math.max(2, H - 3 - legY);
  for (const s of [-1, 1]) {                                                   // legs
    const sw = s < 0 ? p.l : p.r;
    const x = (s < 0 ? cx - half + 1 : cx + 2) + s * sw * 2;
    b.rect(x, legY, tLegW, tLegH, c.dark);
    b.vline(x, legY, tLegH, c.base);
    b.hline(x - (s < 0 ? 1 : 0), H - 3, Math.max(5, half - 2), c.deep);
  }
  if (d.ears === 'horns' || d.ears === 'greatHorns') {
    for (const s of [-1, 1]) {
      b.blade(cx + s * (headR - 1), headY - headR + 1, cx + s * (headR + 5), headY - headR - 5, t.lite, t.base);
    }
  }
  if (d.chest) {
    b.ellipse(cx, torsoY + Math.round(torsoH * 0.35), 3, 3, d.chest);
    b.set(cx - 1, torsoY + Math.round(torsoH * 0.35) - 1, mixHex(d.chest, WHITE, 0.55));
  }
  b.hline(cx - half + 2, torsoY + torsoH - 2, half * 2 - 3, t.dark);           // belt
  b.rect(cx - 2, torsoY + torsoH - 3, 5, 3, t.base);                           // the buckle
}

const BODIES = {
  humanoid: drawHumanoid,
  portrait: drawPortrait,
  blob: drawBlob,
  ghost: drawGhost,
  beast: drawBeast,
  mech: drawMech,
  titan: drawTitan,
  drake: drawDrake,
};

export const BODY_PLANS = Object.keys(BODIES);

/**
 * Default grid size per body plan.
 *
 * The humanoid and the portrait are deliberately larger than the on-screen size
 * needs: `spriteAtlas` bakes a `unit` that divides the integer upscale back out,
 * so these numbers buy detail and nothing else.
 */
const BODY_SIZE = {
  // 40x56 rather than 30x42. The reference sheet in `Example Folder/` puts a
  // roughly 64px figure in its frame, and at 42 rows a leg is six rows of shin
  // and five of boot — enough for a stride and not enough for a calf, an ankle
  // and a foot that are three different shapes. At 56 rows it is, which is what
  // the walk cycle actually needs to read.
  //
  // It costs NOTHING on screen: `spriteAtlas.registerPixel` bakes a `unit` that
  // divides the grid back out, so a 40x56 character renders at exactly the same
  // 39x54 world px a 30x42 one does. Measured fill after the change: min 44.6%
  // (sora), mean 54.5%, max 74.3% (pekora) — the 12%/92% band in
  // tests/pixelArt.js is untouched.
  //
  // WHAT IT DOES COST is a visual pass: several hundred offsets in this file are
  // absolute literals rather than derived from `m`, so every belt buckle, button
  // and hairpin arrives 25% smaller relative to the figure. That is a day of
  // looking at sprites, not a refactor, and it must not be attempted in the same
  // change as the walk cycle or neither can be judged.
  humanoid: [40, 56],
  portrait: [40, 40],
  blob: [18, 18],
  ghost: [22, 24],
  beast: [24, 24],
  mech: [20, 18],
  titan: [56, 56],
  // Wider than it is tall, which nothing else here is: a spread wing is the
  // widest thing in the game and a square grid would either clip the span or
  // waste a third of the buffer on air above the horns.
  drake: [52, 46],
};

/**
 * Build just the pixel buffer, with no canvas involved.
 *
 * Exists so the art can be TESTED headlessly: a sprite that renders to nothing,
 * or that is pixel-identical to another character, is invisible to every other
 * check in the project (both draw fine, both throw nothing).
 */
export function buildBuffer(d, pose) {
  const plan = BODIES[d.body] || drawHumanoid;
  const size = BODY_SIZE[d.body] || BODY_SIZE.humanoid;
  const b = new PixelBuf(d.gridW || size[0], d.gridH || size[1]);
  plan(b, d, pose || POSE_IDLE);
  b.shadeEdges(0.22, 0.28);
  b.outline(d.outlineColor || OUTLINE);
  return b;
}

/**
 * Build a pixel sprite. Returns { frames: [ImageData-backed canvases], w, h }.
 *
 * @param d descriptor — see the module header
 * @param makeCanvas the atlas's canvas factory (so this stays headless-safe)
 */
/**
 * THE FRAME LAYOUT, and it is ALWAYS idle-first.
 *
 *   [0]            the standing pose
 *   [1]            the same pose bobbed a pixel      (omitted when noBob)
 *   [2 .. 2+n)     the walk beats                    (omitted when n is 0)
 *
 * `spriteAtlas` publishes the split as `sprite.idleFrames` / `sprite.walkFrames`
 * so the entity loop can pick a frame with one compare and one mask; nothing
 * outside this file ever needs to know what a pose is.
 *
 * A `noBob` descriptor returns ONE entry, which is a fix rather than a tidy-up:
 * the old line was `[base, d.noBob ? base : base.shifted(1)]`, so a bust put the
 * SAME buffer in both slots and the loop below then rastered it into two
 * separate canvases. Twenty-seven sprites — all 25 HUD portraits plus the two
 * `noBob` enemies — carried a byte-identical duplicate frame and a duplicate
 * flash twin that `frameAt` could never tell apart: 1.24 MB of atlas, 6% of the
 * whole pixel budget, spent on nothing.
 */
function framePlan(d) {
  if (d.noBob) return [null];
  const walk = FRAME_PLAN[d.body || 'humanoid'];
  const out = [null, 'bob'];
  if (walk === 4) out.push(WALK_POSES[0], WALK_POSES[1], WALK_POSES[2], WALK_POSES[3]);
  else if (walk === 2) out.push(WALK_POSES[0], WALK_POSES[2]);
  return out;
}

/** Run one body plan into one buffer, in one pose, finished and outlined. */
function buildPose(d, W, H, pose, shaded) {
  const plan = BODIES[d.body] || drawHumanoid;
  const buf = new PixelBuf(W, H);
  plan(buf, d, pose || POSE_IDLE);
  if (shaded) buf.shadeEdges(0.22, 0.28);
  buf.outline(shaded ? (d.outlineColor || OUTLINE) : OUTLINE);
  return buf;
}

/**
 * Hex -> packed 0xAABBGGRR, memoised. Boot-time only.
 *
 * The little-endian channel order is not a mistake: a Uint32Array view over an
 * ImageData's buffer writes bytes in R,G,B,A order on a little-endian machine,
 * which every machine that will ever run this is.
 */
const RGBA_CACHE = new Map();
function rgba(hex) {
  let v = RGBA_CACHE.get(hex);
  if (v === undefined) {
    const n = parseInt(hex.charAt(0) === '#' ? hex.slice(1) : hex, 16);
    v = (255 << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255);
    RGBA_CACHE.set(hex, v);
  }
  return v;
}

/**
 * Flush a finished buffer into a canvas IN ONE CALL.
 *
 * This used to be a `fillStyle = c; fillRect(x, y, 1, 1)` per pixel, and a
 * fillStyle write is a string parse — the most expensive thing in the whole
 * boot path, paid 1,400 times per frame per sprite. That was tolerable at four
 * canvases per sprite and is not at twelve, so the pixels go through a typed
 * array and one putImageData instead: about fifty times faster, and it makes
 * the walk cycle free at boot rather than a third of a second of it.
 *
 * The fillRect path stays as the fallback for the headless stub context, which
 * has no ImageData to construct.
 */
function blit(buf, W, H, makeCanvas, white) {
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');
  if (typeof ImageData !== 'undefined') {
    const px = new Uint32Array(W * H);
    const solid = 0xffffffff;
    for (let i = 0, n = W * H; i < n; i++) {
      const c = buf.px[i];
      if (c) px[i] = white ? solid : rgba(c);
    }
    ctx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer), W, H), 0, 0);
    return cv;
  }
  if (white) ctx.fillStyle = '#ffffff';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = buf.get(x, y);
      if (!c) continue;
      if (!white) ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return cv;
}

export function buildPixelSprite(d, makeCanvas) {
  const size = BODY_SIZE[d.body] || BODY_SIZE.humanoid;
  const W = d.gridW || size[0];
  const H = d.gridH || size[1];
  const poses = framePlan(d);

  const out = [];
  let base = null;
  for (let i = 0; i < poses.length; i++) {
    const p = poses[i];
    let buf;
    if (p === 'bob') {
      // The idle bob. A static sprite in a field of moving ones reads as a bug;
      // one pixel of vertical travel is enough to make it feel alive, and the
      // body plans leave the last row of the grid empty so it has room to go.
      buf = base.shifted(1);
    } else {
      buf = buildPose(d, W, H, p, true);
      if (i === 0) base = buf;
      // The contact beats take the SAME +1 shift the bob does. That is the
      // whole of the walk's vertical oscillation and it is free — no second
      // plan run, no second buffer, just the shift that was already here.
      if (p && p.bob) buf = buf.shifted(1);
    }
    out.push(blit(buf, W, H, makeCanvas, false));
  }
  return { frames: out, w: W, h: H, idle: d.noBob ? 1 : 2 };
}

/**
 * A white silhouette of a sprite — the hit-flash twin, generated from the same
 * buffer rather than re-derived, so it can never drift from the sprite.
 */
export function buildFlashFrames(d, makeCanvas) {
  const size = BODY_SIZE[d.body] || BODY_SIZE.humanoid;
  const W = d.gridW || size[0];
  const H = d.gridH || size[1];
  // THE SAME POSE LIST, not a similar one. `Sprite.flashAt` indexes the flash
  // array with the identical index `frameAt` uses, so a twin that is one frame
  // short reads `frames[0]` on the last beat and a walking enemy snaps back to
  // its idle pose for one frame every time it is hit.
  const poses = framePlan(d);

  const out = [];
  let base = null;
  for (let i = 0; i < poses.length; i++) {
    const p = poses[i];
    let buf;
    if (p === 'bob') buf = base.shifted(1);
    else {
      // Deliberately UNSHADED: the twin is a solid white silhouette, so the
      // light pass would be thrown away and it is the most expensive thing in
      // the builder.
      buf = buildPose(d, W, H, p, false);
      if (i === 0) base = buf;
      if (p && p.bob) buf = buf.shifted(1);
    }
    out.push(blit(buf, W, H, makeCanvas, true));
  }
  return out;
}

export { PixelBuf, OUTLINE, ramp, BODY_SIZE, WALK_POSES, framePlan };
