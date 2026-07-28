// Procedural pixel-art sprite generator.
//
// This replaces "emoji composited over a coloured blob" with actual sprites:
// chunky, outlined, readable at a glance in a crowd of two hundred, and
// generated entirely in code so the project keeps its zero-asset promise.
//
// HOW IT WORKS
// ------------
// Everything is drawn into a small integer pixel grid (characters 30x42,
// portraits 40x40, rank-and-file enemies 24x28 up to 34x40, bosses up to 64x64)
// and then blitted at whatever scale the world needs with smoothing OFF. That is
// what makes it read as a sprite game rather than as vector art — the pixels
// stay square.
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
// wings, tails, aura and weapon, then outlines the finished silhouette. 19
// characters and 35 enemies from one file, each individually recognisable, and
// adding one is still six lines of data.
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
  /** One-pixel top-left highlight and bottom-right shadow. Cheap volume. */
  shadeEdges(lightAmt, darkAmt) {
    const src = this.px.slice();
    const at = (x, y) => (x < 0 || y < 0 || x >= this.w || y >= this.h) ? null : src[y * this.w + x];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = at(x, y);
        if (!c || c === OUTLINE) continue;
        const up = at(x, y - 1), dn = at(x, y + 1);
        if (!up || up === OUTLINE) this.set(x, y, shade(c, lightAmt));
        else if (!dn || dn === OUTLINE) this.set(x, y, shade(c, -darkAmt));
      }
    }
  }
}

const OUTLINE = '#0a0c14';

// ---------------------------------------------------------------------------
// Palette derivation. A descriptor gives one or two colours; everything else —
// shadows, highlights, trim — is derived so a new sprite is never a colour
// matching exercise.
// ---------------------------------------------------------------------------
function ramp(base) {
  return {
    lite: shade(base, 0.34),
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
function drawHumanoid(b, d) {
  const m = humanMetrics(b.w, b.h, d);
  const P = humanPalette(d);
  drawAura(b, m, P, d);
  drawBackProp(b, m, P, d);
  drawWings(b, m, P, d);
  drawTails(b, m, P, d);
  if (d.cape) drawCape(b, m, P, d);
  drawHairBack(b, m, P, d);
  drawLegs(b, m, P, d);
  drawTorso(b, m, P, d);
  if (d.coat) drawCoat(b, m, P, d);
  if (d.backpack) drawStraps(b, m, P, d);
  drawArms(b, m, P, d);
  if (d.harness) drawHarness(b, m, P, d);
  if (d.pauldrons || d.pauldron) drawPauldrons(b, m, P, d);
  drawHairCap(b, m, P, d);
  drawHead(b, m, P, d);
  drawNeckwear(b, m, P, d);
  drawFace(b, m, P, d);
  drawHairFront(b, m, P, d);
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

function drawLegs(b, m, P, d) {
  const { cx, hipY, kneeY, bootY, bottom, halfBot } = m;
  // Narrow enough to leave a clear column between the outside of the boot and
  // the hand hanging beside it. At the old width the two touched, and every
  // character grew a solid horizontal bar across the hips that read as a tray.
  const legW = Math.max(2, halfBot - 1);
  const legTop = hipY + 1;
  const legH = Math.max(2, bootY - legTop);
  const lc = typeof d.legColor === 'string' ? ramp(d.legColor) : P.cloth;
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - legW : cx + 1;
    b.rect(x, legTop, legW, legH, lc.dark);
    b.vline(s < 0 ? x : x + legW - 1, legTop, legH, lc.deep);   // outer shadow
    b.vline(s < 0 ? x + legW - 1 : x, legTop, legH, lc.base);   // inner light
    b.hline(x, kneeY, legW, lc.base);                            // knee break
  }
  if (d.barefoot) {
    // No boots at all: bare feet, with toes. The absence of footwear is a
    // character note for one of the cast, so it has to be drawn, not omitted.
    const fw = legW + 1;
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - fw : cx + 1;
      b.rect(x, bootY, fw, bottom - bootY + 1, P.skin.dark);
      b.hline(x, bootY, fw, P.skin.base);
      b.hline(s < 0 ? x - 1 : x, bottom - 1, fw + 1, P.skin.base);
      b.hline(s < 0 ? x - 1 : x, bottom, fw + 1, P.skin.deep);
      for (let i = 0; i < fw; i += 2) b.set((s < 0 ? x - 1 : x) + i, bottom - 1, P.skin.lite);
    }
    return;
  }
  // Boots with a hard sole one pixel wider than the boot — the ground contact
  // that stops the figure looking like it is hovering — a cuff, a strap and a
  // toe box, which is what separates one character's legs from another's.
  const bw = legW + 1;
  const boot = typeof d.boots === 'string' ? ramp(d.boots) : P.trim;
  const shaftTop = d.bootHeight === 'thigh' ? legTop
                 : d.bootHeight === 'knee' ? kneeY : bootY;
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - bw : cx + 1;
    b.rect(x, shaftTop, bw, bottom - shaftTop + 1, boot.base);
    b.hline(x, shaftTop, bw, boot.lite);                       // the cuff
    b.hline(x, shaftTop + 1, bw, boot.dark);
    b.vline(s < 0 ? x : x + bw - 1, shaftTop + 2, bottom - shaftTop - 1, boot.deep);
    b.hline(x + 1, bootY + 1, bw - 2, boot.dark);              // the ankle strap
    b.hline(s < 0 ? x - 1 : x, bottom - 1, bw + 1, boot.base); // the toe box
    b.hline(s < 0 ? x - 1 : x, bottom, bw + 1, boot.deep);     // the sole
  }
}

function drawTorso(b, m, P, d) {
  const { cx, chinY, shoulderY, hipY, halfTop, halfBot } = m;
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
  if (d.skirt) {
    const sk = slotRamp(d.skirt, d.accent || '#8a8fa8');
    b.taper(cx - halfBot - 2, hipY, halfBot * 2 + 5, halfBot * 2 + 7, 4, sk.base);
    b.hline(cx - halfBot - 3, hipY + 3, halfBot * 2 + 7, sk.dark);
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
  // the shirt in the open front
  b.rect(cx - 1, top, 3, hipY - top, P.cloth.base);
  b.vline(cx, top, hipY - top, P.cloth.dark);
  // lapels and a split hem, so the coat has edges of its own
  b.vline(cx - 2, top, 4, c.dark);
  b.vline(cx + 2, top, 4, c.dark);
  b.set(cx - 3, top + 1, c.lite);
  b.set(cx + 3, top + 1, c.lite);
  b.hline(cx - halfTop - 3, hem, halfTop * 2 + 7, c.deep);
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
  const handY = hipY + 1;
  const gl = d.gloves ? slotRamp(d.gloves, d.accent || '#2b2b3a') : P.skin;
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - armOut : cx + armOut - armW + 1;
    b.rect(x, handY, armW, 3, gl.base);
    b.hline(x, handY, armW, gl.lite);
    b.hline(x, handY + 2, armW, gl.dark);
    b.set(s < 0 ? x + armW - 1 : x, handY + 1, gl.dark);      // the knuckle break
  }
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
  const { cx, headY, headR, chinY, shoulderY, hipY, bootY } = m;
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
    case 'drills': {
      // Twin drills: each ringlet is a stack of shrinking blocks, which is the
      // only way a curl reads at this size.
      const rows = Math.max(3, ((hipY - chinY) / 2) | 0);
      for (let i = 0; i < rows; i++) {
        const w = Math.max(2, 6 - i);
        b.pair(cx, side, chinY - 3 + i * 2, w, 2, i & 1 ? hc.base : hc.dark);
        b.pair(cx, side, chinY - 3 + i * 2, 1, 1, hc.lite);
      }
      b.pair(cx, side - 1, top + 2, 3, 4, hc.base);
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
      // UNEVEN heights with a shadow notch between each pair of locks. Six
      // identical spikes at a two-column pitch merge into one serrated block,
      // which is not spiky hair — it is a crown, and it was on four characters.
      const hs = [4, 6, 3, 5, 3, 6];
      for (let k = 0, i = -headR + 1; i <= headR - 1; i += 2, k++) {
        const h = hs[k % hs.length];
        b.spike(cx + i - 1, top + 1, 3, h, -1, k & 1 ? hc.base : hc.lite);
        if (k) b.vline(cx + i - 1, top + 2 - Math.min(h, hs[(k - 1) % hs.length]),
                       Math.min(h, hs[(k - 1) % hs.length]), hc.deep);
      }
      b.hline(cx - headR + 1, brow, headR * 2 - 1, hc.base);
      b.hline(cx - headR + 1, brow - 1, headR * 2 - 1, hc.lite);
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
  const { cx, headY, headR } = m;
  const hc = P.hair, t = P.trim;
  // Beast ears default to the hair, because that is what they usually are — but
  // one of the cast has pink hair and GOLD ears, and there is no way to say that
  // without a slot of their own.
  const ec = d.earColor ? slotRamp(d.earColor, hc.base) : hc;
  const top = headY - headR;
  switch (d.ears) {
    case 'fox':
      // Wide at the base and only five rows tall. Taller and narrower than this
      // and they stop reading as a fox and start reading as a rabbit.
      for (const s of [-1, 1]) {
        b.spike(cx + s * (headR - 1) - 2, top, 5, 5, -1, ec.base);
        b.spike(cx + s * (headR - 1) - 1, top - 1, 3, 3, -1, mixHex(ec.lite, '#ffc4e0', 0.5));
        b.set(cx + s * (headR - 1), top - 4, mixHex(ec.lite, WHITE, 0.4));
      }
      break;
    case 'cat':
      for (const s of [-1, 1]) {
        b.spike(cx + s * (headR - 1) - 1, top, 3, 4, -1, ec.base);
        b.set(cx + s * (headR - 1), top - 1, ec.lite);
      }
      break;
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
    const c = slotRamp(d.hatColor, '#241826');
    const y = Math.max(1, top - 3);
    b.hline(cx - headR - 3, y + 3, headR * 2 + 7, c.base);     // the brim
    b.hline(cx - headR - 2, y + 2, headR * 2 + 5, c.dark);
    b.set(cx - headR - 4, y + 2, c.base);                      // the two upswept corners
    b.set(cx + headR + 3, y + 2, c.base);
    b.taper(cx - headR + 1, y, headR * 2 - 1, headR * 2 - 1, 3, c.base);
    b.hline(cx - headR + 2, y, headR * 2 - 3, P.trim.base);    // the band
    b.set(cx + headR - 1, y + 1, P.trim.lite);                 // the cockade
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
    // A feather off the side of whatever hat is on. Drawn last so it clears the
    // brim, and swept, because a vertical plume reads as an antenna.
    const c = slotRamp(d.hatPlume, '#f4f1ea');
    const y = Math.max(2, top - 3);
    for (let j = 0; j < 6; j++) {
      const w = Math.max(1, 3 - (j >> 1));
      b.hline(cx + headR - 1 + (j >> 1), y - j, w, j & 1 ? c.base : c.lite);
    }
    b.set(cx + headR + 2, y - 6, mixHex(c.lite, WHITE, 0.5));
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
      // A curve, not a straight edge, and a knuckle bow. Both are what stop a
      // sabre from reading as the same prop as everyone else's sword.
      b.blade(wx - 3, hipY + 2, wx - 2, shoulderY + 1, met.lite, met.base);
      b.blade(wx - 2, shoulderY + 1, wx, top + 4, met.lite, met.base);
      b.set(wx, top + 3, mixHex(met.lite, WHITE, 0.5));
      b.hline(wx - 4, hipY + 2, 4, gold.base);
      b.vline(wx - 4, hipY + 3, 3, gold.dark);
      b.vline(wx - 3, hipY + 3, 3, grip.base);
      b.set(wx - 3, hipY + 6, gold.lite);
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
      const r = Math.max(2, headR - 2);
      b.ellipse(wx - 1, hipY - 2, r, r, met.base);
      b.ellipse(wx - 1, hipY - 2, r - 2, r - 2, gold.dark);
      b.set(wx - 1, hipY - 2 - r, met.lite);
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
                     sidetail: 15, ponytail: 13, braid: 15, ducktail: 7 })[style] || 0;
  if (backLen) {
    b.pair(cx, rx - 1, headY - ry + 3, 4, backLen, hc.base);
    b.pair(cx, rx + 2, headY - ry + 5, 1, backLen - 4, hc.dark);
    b.pair(cx, rx - 1, headY - ry + 6, 1, backLen - 6, hc.lite);
  }
  if (style === 'drills') {
    for (let i = 0; i < 5; i++) {
      b.pair(cx, rx - 1, chinY - 6 + i * 4, Math.max(2, 6 - i), 4, i & 1 ? hc.base : hc.dark);
      b.pair(cx, rx - 1, chinY - 6 + i * 4, 1, 1, hc.lite);
    }
  }
  if (style === 'twin') {
    b.pair(cx, rx, headY - ry + 1, 5, 5, hc.base);
    b.pair(cx, rx, headY - ry + 6, 5, 2, tie.base);
    b.pair(cx, rx + 1, headY - ry + 5, 3, 1, tie.lite);
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

  // --- the signature above the hairline ------------------------------------
  const t = P.trim;
  if (d.ears === 'fox' || d.ears === 'cat') {
    const ec = d.earColor ? slotRamp(d.earColor, hc.base) : hc;
    const h = d.ears === 'fox' ? 9 : 6;
    for (const s of [-1, 1]) {
      b.spike(cx + s * (rx - 2) - 3, top + 1, 7, h, -1, ec.base);
      b.spike(cx + s * (rx - 2) - 2, top, 5, h - 3, -1, mixHex(ec.lite, '#ff9ecb', 0.4));
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
    } else {
      b.rect(x, y, 5, 3, c.base);
      b.hline(x, y, 5, c.lite);
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
    const c = slotRamp(d.hatColor, '#241826');
    b.hline(cx - rx - 4, top, rx * 2 + 9, c.base);
    b.hline(cx - rx - 3, top - 1, rx * 2 + 7, c.dark);
    b.set(cx - rx - 5, top - 1, c.base);
    b.set(cx + rx + 4, top - 1, c.base);
    b.taper(cx - rx + 2, top - 5, rx * 2 - 3, rx * 2 - 3, 4, c.base);
    b.hline(cx - rx + 3, top - 5, rx * 2 - 5, t.base);
    b.set(cx + rx - 4, top - 4, t.lite);
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
  const eyeC = d.eyes || '#1a1a2e';
  const eyeY = by - 2;
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - eyeR - 2 : cx + 2;
    b.rect(x, eyeY, eyeR + 1, eyeR + 2, eyeC);
    b.set(s < 0 ? x : x + eyeR, eyeY, EYE_WHITE);
    b.set(x + (eyeR >> 1), eyeY + eyeR + 4, mixHex(c.base, '#ff7a8f', 0.5));   // blush
  }
  // A mouth, which is what turns a circle into a creature.
  b.hline(cx - 1, eyeY + eyeR + 3, 3, t.deep);
  b.set(cx, eyeY + eyeR + 4, t.deep);
  b.set(cx - 2, eyeY + eyeR + 2, t.dark);
  b.set(cx + 2, eyeY + eyeR + 2, t.dark);
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
function drawBeast(b, d) {
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
  // four stubby limbs, the front pair planted forward
  const legH = Math.max(2, bottom - legTop + 1);
  for (const s of [-1, 1]) {
    b.rect(s < 0 ? cx - half : cx + half - 2, legTop, 3, legH, c.dark);
    b.rect(s < 0 ? cx - half + 4 : cx + half - 6, legTop, 3, legH, c.deep);
    b.hline(s < 0 ? cx - half - 1 : cx + half - 2, bottom, 4, t.deep);      // paw
    for (let i = 0; i < 3; i++) b.set((s < 0 ? cx - half - 1 : cx + half - 2) + i, bottom - 1, t.dark);
  }
  if (d.tails) {
    b.line(cx + half, bodyTop + 3, cx + half + 3, bodyTop - 2, c.base);
    b.set(cx + half + 3, bodyTop - 3, c.lite);
  }
}

/** A machine — drones, golems, mechs. Hard edges, a single lens. */
function drawMech(b, d) {
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
  // legs
  const legH = Math.max(1, bottom - botY);
  b.rect(cx - half + 1, botY + 1, 3, legH, c.deep);
  b.rect(cx + half - 3, botY + 1, 3, legH, c.deep);
  b.hline(cx - half, bottom, 4, c.dark);
  b.hline(cx + half - 3, bottom, 4, c.dark);
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
function drawTitan(b, d) {
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
  for (const s of [-1, 1]) {                                                   // legs
    b.rect(s < 0 ? cx - half + 1 : cx + 2, legY, Math.max(4, half - 3), H - 3 - legY, c.dark);
    b.vline(s < 0 ? cx - half + 1 : cx + 2, legY, H - 3 - legY, c.base);
    b.hline(s < 0 ? cx - half : cx + 2, H - 3, Math.max(5, half - 2), c.deep);
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
  humanoid: [30, 42],
  portrait: [40, 40],
  blob: [18, 18],
  ghost: [22, 24],
  beast: [24, 24],
  mech: [20, 18],
  titan: [56, 56],
};

/**
 * Build just the pixel buffer, with no canvas involved.
 *
 * Exists so the art can be TESTED headlessly: a sprite that renders to nothing,
 * or that is pixel-identical to another character, is invisible to every other
 * check in the project (both draw fine, both throw nothing).
 */
export function buildBuffer(d) {
  const plan = BODIES[d.body] || drawHumanoid;
  const size = BODY_SIZE[d.body] || BODY_SIZE.humanoid;
  const b = new PixelBuf(d.gridW || size[0], d.gridH || size[1]);
  plan(b, d);
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
export function buildPixelSprite(d, makeCanvas) {
  const plan = BODIES[d.body] || drawHumanoid;
  const size = BODY_SIZE[d.body] || BODY_SIZE.humanoid;
  const W = d.gridW || size[0];
  const H = d.gridH || size[1];

  const base = new PixelBuf(W, H);
  plan(base, d);
  base.shadeEdges(0.22, 0.28);
  base.outline(d.outlineColor || OUTLINE);

  // Two-frame idle bob. A static sprite in a field of moving ones reads as a
  // bug; one pixel of vertical travel is enough to make it feel alive. The body
  // plans leave the last row of the grid empty so the bob has room to move into.
  const frames = [base, d.noBob ? base : base.shifted(1)];

  const out = [];
  for (const buf of frames) {
    const cv = makeCanvas(W, H);
    const ctx = cv.getContext('2d');
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = buf.get(x, y);
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    out.push(cv);
  }
  return { frames: out, w: W, h: H };
}

/**
 * A white silhouette of a sprite — the hit-flash twin, generated from the same
 * buffer rather than re-derived, so it can never drift from the sprite.
 */
export function buildFlashFrames(d, makeCanvas) {
  const plan = BODIES[d.body] || drawHumanoid;
  const size = BODY_SIZE[d.body] || BODY_SIZE.humanoid;
  const W = d.gridW || size[0];
  const H = d.gridH || size[1];
  const base = new PixelBuf(W, H);
  plan(base, d);
  base.outline(OUTLINE);

  const out = [];
  for (const buf of [base, d.noBob ? base : base.shifted(1)]) {
    const cv = makeCanvas(W, H);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) if (buf.get(x, y)) ctx.fillRect(x, y, 1, 1);
    }
    out.push(cv);
  }
  return out;
}

export { PixelBuf, OUTLINE, ramp, BODY_SIZE };
