// Procedural pixel-art sprite generator.
//
// This replaces "emoji composited over a coloured blob" with actual sprites:
// chunky, outlined, readable at a glance in a crowd of two hundred, and
// generated entirely in code so the project keeps its zero-asset promise.
//
// HOW IT WORKS
// ------------
// Everything is drawn into a small integer pixel grid (characters 24x34,
// portraits 32x32, rank-and-file enemies 24x28 up to 34x40, bosses up to 64x64)
// and then blitted at whatever scale the world needs with smoothing OFF. That is
// what makes it read as a sprite game rather than as vector art — the pixels
// stay square.
//
// EVERY COORDINATE IS DERIVED FROM THE GRID (see humanMetrics). The first cut of
// this file pinned the head to y=7 and the boots to y=24, so growing the grid
// only added transparent padding: the figure stayed 20x26 inside a bigger box
// and the fill ratio fell straight through tests/pixelArt.js's 12% floor. Body
// plans now scale, which is what let the character grid grow to 24x34 and spend
// the extra pixels on jaw, shoulders, garment, hands and boots instead of air.
//
// Sprites are PARAMETRIC, not hand-drawn grids. A descriptor names a body plan
// and a pile of features:
//
//     { body:'humanoid', hair:'drills', hairColor:'#9fe8ff', outfit:'#5fd6ff',
//       skin:'#ffd9c0', weapon:'trident', ears:'fin', coat:'#3a9fd0',
//       scarf:'#ffe9a3', pauldrons:'#0b3d5c', halo:'#ff7ab8', wings:'feather',
//       tails:4, aura:'#ffd76a' }
//
// and the builder assembles hair (back mass and front fringe as separate
// layers), head, face, torso, coat, arms, hands, legs, boots, headgear, wings,
// tails, aura and weapon, then outlines the finished silhouette. 19 characters
// and 35 enemies from one file, each individually recognisable, and adding one
// is still six lines of data.
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
 * The bottom margin is deliberate: `bottom` is h-3, so outline() can put a row
 * at h-2 and shifted(1) still has h-1 to land in. The old plan put the boots on
 * the last row and lost their underside outline on every single character.
 */
function humanMetrics(W, H) {
  const cx = W >> 1;
  const headR = Math.max(3, Math.round(W * 0.21));
  const headY = Math.max(headR + 3, Math.round(H * 0.235));
  const chinY = headY + headR - 1;
  const shoulderY = Math.min(chinY + 2, H - 9);
  const hipY = Math.max(shoulderY + 5, Math.round(H * 0.655));
  const bottom = H - 3;
  const bootY = Math.max(hipY + 2, bottom - 1);
  const halfTop = Math.max(3, Math.round(W * 0.185));
  const halfBot = Math.max(2, halfTop - 1);
  const armOut = halfTop + 1;
  // The weapon column sits clear of the widest garment (a coat hem reaches
  // halfTop+2), so a blade is never swallowed by the silhouette it hangs off.
  const wx = Math.min(cx + armOut + 3, W - 3);       // right-hand weapon column
  const lx = W - 1 - wx;                              // its exact mirror
  return { W, H, cx, headR, headY, chinY, shoulderY, hipY, bootY, bottom,
           halfTop, halfBot, armOut, wx, lx };
}

function humanPalette(d) {
  const outfit = d.outfit || '#5f7fd6';
  const accent = d.accent || shade(outfit, -0.45);
  return {
    skin: ramp(d.skin || SKIN_DEFAULT),
    cloth: ramp(outfit),
    trim: ramp(accent),
    hair: ramp(d.hairColor || '#2b2b3a'),
    coat: slotRamp(d.coat, accent),
    metal: ramp(d.weaponColor || '#d8e2f0'),
    eyes: d.eyes || '#1a1a2e',
    glow: d.eyeGlow || null,
  };
}

/**
 * The humanoid — every playable character and most humanoid enemies.
 *
 * Layered back-to-front so the parts occlude each other correctly: a long coat
 * has to sit over the torso but under the arms, and a fringe has to sit over
 * the face but under a horn.
 */
function drawHumanoid(b, d) {
  const m = humanMetrics(b.w, b.h);
  const P = humanPalette(d);
  drawAura(b, m, P, d);
  drawWings(b, m, P, d);
  drawTails(b, m, P, d);
  if (d.cape) drawCape(b, m, P, d);
  drawHairBack(b, m, P, d);
  drawLegs(b, m, P, d);
  drawTorso(b, m, P, d);
  if (d.coat) drawCoat(b, m, P, d);
  drawArms(b, m, P, d);
  if (d.pauldrons) drawPauldrons(b, m, P, d);
  if (d.scarf) drawScarf(b, m, P, d);
  drawHairCap(b, m, P, d);
  drawHead(b, m, P, d);
  drawFace(b, m, P, d);
  drawHairFront(b, m, P, d);
  drawHeadgear(b, m, P, d);
  drawWeapon(b, m, P, d);
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
  ];
  for (let i = 0; i < pts.length; i++) {
    const x = clamp(pts[i][0], 0, W - 1);
    b.set(x, pts[i][1], i % 2 ? a.lite : a.base);
  }
}

/** feather | mech | energy | dragon. Three silhouettes, not one shape recoloured. */
function drawWings(b, m, P, d) {
  const kind = d.wings === true ? 'feather' : d.wings;
  if (!kind) return;
  const c = slotRamp(d.wingColor, d.accent || '#e8e8f0');
  const { cx, shoulderY, armOut, hipY, W } = m;
  const span = Math.max(3, Math.round(W * 0.17));
  const top = shoulderY - 2;
  const h = hipY - top;
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? cx - armOut - span : cx + armOut + 1;
    if (kind === 'mech') {
      // Hard panels with a lit leading edge and a vent gap. Machines, not birds.
      b.rect(x0, top, span, 2, c.base);
      b.rect(x0 + (s < 0 ? 0 : span - 2), top + 2, 2, h - 2, c.dark);
      b.hline(x0, top, span, c.lite);
      b.set(x0 + (span >> 1), top + 4, mixHex(c.lite, '#ffffff', 0.5));
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
    } else {
      // Feathers: a stepped trailing edge, three visible rows of primaries.
      for (let j = 0; j < h; j++) {
        const w = Math.max(1, span - Math.abs(j - ((h / 3) | 0)) / 2 | 0);
        b.hline(s < 0 ? x0 + span - w : x0, top + j, w, j % 3 === 0 ? c.lite : c.base);
      }
      b.vline(s < 0 ? x0 : x0 + span - 1, top + 1, h - 2, c.dark);
    }
  }
}

/** One to four tails, fanned out behind the hips. */
function drawTails(b, m, P, d) {
  const n = Math.min(d.tails || 0, 4);
  if (!n) return;
  const c = slotRamp(d.tailColor, d.accent || '#d8a05a');
  const { cx, hipY, armOut, bottom } = m;
  const len = Math.max(4, Math.round((bottom - hipY) * 1.4));
  for (let i = 0; i < n; i++) {
    const s = i % 2 === 0 ? 1 : -1;
    const off = armOut + 1 + ((i / 2) | 0) * 2;
    const y = hipY - 2 + ((i / 2) | 0);
    b.ellipse(cx + s * off, y + (len >> 1) - 2, 2, (len >> 1), c.base);
    b.set(cx + s * off, y - 1, c.lite);                       // root
    b.set(cx + s * off, y + len - 4, mixHex(c.lite, '#ffffff', 0.45));   // pale tip
  }
}

function drawCape(b, m, P, d) {
  const c = typeof d.cape === 'string' ? ramp(d.cape) : P.trim;
  const { cx, shoulderY, halfTop, bootY } = m;
  const h = bootY - shoulderY;
  b.taper(cx - halfTop - 1, shoulderY, halfTop * 2 + 3, halfTop * 2 + 7, h, c.dark);
  b.hline(cx - halfTop - 1, shoulderY, halfTop * 2 + 3, c.base);
  // A ragged hem, so the cape ends in cloth rather than in a ruler line.
  for (let i = -halfTop - 3; i <= halfTop + 3; i += 2) b.set(cx + i, shoulderY + h, c.deep);
}

function drawLegs(b, m, P, d) {
  const { cx, hipY, bootY, bottom, halfTop } = m;
  const legW = Math.max(2, Math.round(halfTop * 0.78));
  const legTop = hipY + 1;
  const legH = Math.max(2, bootY - legTop);
  const lc = typeof d.legColor === 'string' ? ramp(d.legColor) : P.cloth;
  b.rect(cx - legW, legTop, legW, legH, lc.dark);
  b.rect(cx + 1, legTop, legW, legH, lc.dark);
  const kneeY = legTop + Math.max(1, (legH / 2) | 0);
  b.hline(cx - legW, kneeY, legW, lc.base);
  b.hline(cx + 1, kneeY, legW, lc.base);
  // Boots with a hard sole one pixel wider than the boot — the ground contact
  // that stops the figure looking like it is hovering.
  const bw = legW + 1, bh = bottom - bootY + 1;
  const boot = typeof d.boots === 'string' ? ramp(d.boots) : P.trim;
  b.rect(cx - bw, bootY, bw, bh, boot.base);
  b.rect(cx + 1, bootY, bw, bh, boot.base);
  b.hline(cx - bw - 1, bottom, bw + 1, boot.deep);
  b.hline(cx + 1, bottom, bw + 1, boot.deep);
}

function drawTorso(b, m, P, d) {
  const { cx, shoulderY, hipY, halfTop, halfBot } = m;
  const h = hipY - shoulderY + 1;
  const chestH = Math.max(2, h - 3);
  // Chest block then a narrower waist block: a defined garment silhouette
  // rather than one flat slab, and symmetric on an odd width.
  b.rect(cx - halfTop, shoulderY, halfTop * 2 + 1, chestH, P.cloth.base);
  b.rect(cx - halfBot, shoulderY + chestH, halfBot * 2 + 1, h - chestH, P.cloth.base);
  // A yoke one pixel proud of the chest on each side. Two rows of it is the
  // difference between "a person" and "a bottle" at this size.
  b.rect(cx - halfTop - 1, shoulderY, halfTop * 2 + 3, 2, P.cloth.base);
  b.hline(cx - halfTop, shoulderY, halfTop * 2 + 1, P.cloth.lite);
  b.vline(cx, shoulderY + 1, h - 2, P.cloth.dark);          // centre closure seam
  if (d.skirt) {
    const sk = slotRamp(d.skirt, d.accent || '#8a8fa8');
    b.taper(cx - halfBot - 1, hipY, halfBot * 2 + 3, halfBot * 2 + 5, 3, sk.base);
    b.hline(cx - halfBot - 2, hipY + 2, halfBot * 2 + 5, sk.dark);
  }
  if (d.sash) {
    const s = slotRamp(d.sash, d.accent || '#c8342a');
    b.rect(cx - halfBot, hipY - 2, halfBot * 2 + 1, 2, s.base);
    b.hline(cx - halfBot, hipY - 2, halfBot * 2 + 1, s.lite);
    b.rect(cx - 1, hipY - 2, 3, 2, s.dark);                 // the knot
    b.vline(cx - halfBot, hipY, 3, s.base);                 // one hanging end
  } else if (d.belt !== false) {
    b.hline(cx - halfBot, hipY - 1, halfBot * 2 + 1, P.trim.base);
    b.set(cx, hipY - 1, P.trim.lite);
  }
  if (d.chest) {
    // A crest, not a dot: a 3-wide diamond mid-chest reads at any zoom.
    const y = shoulderY + 2;
    b.hline(cx - 1, y, 3, d.chest);
    b.set(cx, y - 1, d.chest);
    b.set(cx, y + 1, d.chest);
    b.set(cx, y, shade(d.chest, 0.45));
  }
}

/**
 * A long coat / haori. It has to read as a SEPARATE garment, so it is drawn
 * over the torso and then the torso colour is put back down the middle as the
 * shirt showing through the open front.
 */
function drawCoat(b, m, P, d) {
  const { cx, shoulderY, hipY, bootY, halfTop } = m;
  const hem = Math.min(bootY - 1, hipY + Math.round((bootY - hipY) * 0.8));
  const c = P.coat;
  b.taper(cx - halfTop - 1, shoulderY, halfTop * 2 + 3, halfTop * 2 + 5, hem - shoulderY + 1, c.base);
  b.hline(cx - halfTop - 1, shoulderY, halfTop * 2 + 3, c.lite);
  // the shirt in the open front
  b.rect(cx - 1, shoulderY, 3, hipY - shoulderY, P.cloth.base);
  b.vline(cx, shoulderY, hipY - shoulderY, P.cloth.dark);
  // lapels and a split hem, so the coat has edges of its own
  b.vline(cx - 2, shoulderY, 3, c.dark);
  b.vline(cx + 2, shoulderY, 3, c.dark);
  b.hline(cx - halfTop - 2, hem, halfTop * 2 + 5, c.deep);
  b.set(cx, hem, c.deep);
  b.set(cx, hem - 1, c.deep);
  if (d.coatTrim) {
    b.vline(cx - halfTop - 1, shoulderY + 1, hem - shoulderY - 1, d.coatTrim);
    b.vline(cx + halfTop + 1, shoulderY + 1, hem - shoulderY - 1, d.coatTrim);
  }
}

function drawArms(b, m, P, d) {
  const { cx, shoulderY, hipY, armOut } = m;
  const top = shoulderY + 1;
  const h = Math.max(3, hipY - top + 1);
  const c = typeof d.sleeve === 'string' ? ramp(d.sleeve) : P.cloth;
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - armOut : cx + armOut - 1;
    b.rect(x, top, 2, h, c.dark);
    b.set(s < 0 ? x : x + 1, top, c.base);                  // deltoid catch-light
  }
  if (d.gauntlets) {
    const g = slotRamp(d.gauntlets, d.accent || '#9aa7bd');
    for (const s of [-1, 1]) {
      const x = s < 0 ? cx - armOut : cx + armOut - 1;
      b.rect(x, hipY - 2, 2, 3, g.base);
      b.set(s < 0 ? x - 1 : x + 2, hipY - 2, g.lite);       // the cuff flare
      b.hline(x, hipY - 2, 2, g.lite);
    }
  }
  const handY = hipY + 1;
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - armOut : cx + armOut - 1;
    b.rect(x, handY, 2, 2, P.skin.base);
    b.set(s < 0 ? x : x + 1, handY + 1, P.skin.dark);
  }
}

function drawPauldrons(b, m, P, d) {
  const c = slotRamp(d.pauldrons, d.accent || '#9aa7bd');
  const { cx, shoulderY, armOut } = m;
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - armOut - 1 : cx + armOut - 1;
    b.rect(x, shoulderY, 3, 3, c.base);
    b.hline(x, shoulderY, 3, c.lite);
    b.hline(x, shoulderY + 3, 3, c.deep);
    b.set(s < 0 ? x : x + 2, shoulderY + 1, c.lite);        // outer rivet
  }
}

/** A collar or a scarf, with one trailing end so it is never symmetric. */
function drawScarf(b, m, P, d) {
  const c = slotRamp(d.scarf, d.accent || '#c8342a');
  const { cx, chinY, shoulderY, headR, armOut, hipY } = m;
  const y = chinY;
  b.hline(cx - headR + 1, y, headR * 2 - 1, c.base);
  b.hline(cx - headR, y + 1, headR * 2 + 1, c.base);
  b.hline(cx - headR + 1, y, headR * 2 - 1, c.lite);
  b.set(cx - 1, y + 1, c.deep);
  b.set(cx + 1, y + 1, c.deep);
  // the tail, whipping out to one side
  const tx = cx - armOut - 1;
  const len = Math.min(hipY - shoulderY + 2, 8);
  for (let j = 0; j < len; j++) b.set(tx - ((j / 3) | 0), shoulderY + 1 + j, j & 1 ? c.dark : c.base);
}

function drawHead(b, m, P, d) {
  const { cx, headY, headR, chinY, shoulderY } = m;
  b.rect(cx - 1, chinY, 3, Math.max(1, shoulderY - chinY + 1), P.skin.dark);   // neck
  b.ellipse(cx, headY, headR - 1, headR - 1, P.skin.base);
  b.hline(cx - 1, chinY, 3, P.skin.base);                                      // chin
  b.hline(cx - headR + 3, headY - headR + 2, headR * 2 - 5, P.skin.lite);      // brow light
  // Jaw corners in shadow — the difference between a face and a circle.
  b.set(cx - headR + 2, chinY - 1, P.skin.dark);
  b.set(cx + headR - 2, chinY - 1, P.skin.dark);
}

function drawFace(b, m, P, d) {
  const { cx, headY, headR, chinY } = m;
  const eyeY = headY;
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - 3 : cx + 2;
    b.rect(x, eyeY, 2, 2, P.eyes);
    b.set(s < 0 ? x : x + 1, eyeY, EYE_WHITE);              // catch-light
    b.hline(x, eyeY - 1, 2, P.hair.dark);                   // lash line
    if (P.glow) b.set(s < 0 ? x + 1 : x, eyeY + 2, P.glow);
  }
  b.set(cx, chinY - 1, P.skin.deep);                        // mouth
  if (d.mask) {
    // A lower-face wrap. Covers the mouth, leaves the eyes doing all the work.
    const mc = slotRamp(d.mask, d.accent || '#243050');
    b.rect(cx - headR + 2, eyeY + 2, headR * 2 - 3, chinY - eyeY - 1, mc.base);
    b.hline(cx - headR + 2, eyeY + 2, headR * 2 - 3, mc.lite);
  }
  if (d.visor) {
    const vc = slotRamp(d.visor, '#8ad8ff');
    b.rect(cx - headR + 1, eyeY - 1, headR * 2 - 1, 3, vc.dark);
    b.hline(cx - headR + 1, eyeY, headR * 2 - 1, vc.base);
    b.set(cx - headR + 2, eyeY - 1, vc.lite);
    b.set(cx + headR - 2, eyeY + 1, vc.lite);
  }
}

// ---------------------------------------------------------------------------
// HAIR. THREE passes — the mass behind the head, the cap UNDER the face, then
// the fringe on top of it. The order matters: a fringe drawn beneath the face is
// invisible, and a cap drawn over it paints out the eyes, which is exactly what
// a single-pass hair routine does. Eight styles was never going to separate 19
// characters; there are twenty here.
// ---------------------------------------------------------------------------

function drawHairBack(b, m, P, d) {
  const style = d.hair || 'short';
  const hc = P.hair;
  const { cx, headY, headR, chinY, shoulderY, hipY, bootY } = m;
  const top = headY - headR;
  const side = headR;
  switch (style) {
    case 'long':
      b.taper(cx - side - 1, top + 1, side * 2 + 3, side * 2 + 3, hipY - top, hc.base);
      b.vline(cx - side - 1, top + 3, hipY - top - 4, hc.dark);
      b.vline(cx + side + 1, top + 3, hipY - top - 4, hc.dark);
      break;
    case 'bangs':   // long and straight, curtained past the shoulders
      b.pair(cx, side, top + 1, 2, chinY - top + 6, hc.base);
      b.pair(cx, side + 1, top + 3, 1, chinY - top + 3, hc.dark);
      b.taper(cx - side, top, side * 2 + 1, side * 2 + 1, 4, hc.base);
      break;
    case 'bob':
      b.taper(cx - side - 1, top + 1, side * 2 + 3, side * 2 + 1, chinY - top + 1, hc.base);
      b.pair(cx, side, chinY, 2, 2, hc.dark);               // the inward curl
      break;
    case 'wave':
      for (let j = 0; j <= chinY + 3 - top; j++) {
        const w = side + 1 + ((j >> 1) & 1);
        b.pair(cx, w - 1, top + 1 + j, 2, 1, j & 1 ? hc.base : hc.dark);
      }
      break;
    case 'twin':
      b.pair(cx, side, top + 2, 3, 3, hc.base);             // the bunches
      b.pair(cx, side + 1, top + 5, 2, shoulderY - top, hc.base);
      b.pair(cx, side + 2, top + 6, 1, shoulderY - top - 2, hc.dark);
      break;
    case 'drills': {
      // Twin drills: each ringlet is a stack of shrinking blocks, which is the
      // only way a curl reads at this size.
      const rows = Math.max(3, ((hipY - chinY) / 2) | 0);
      for (let i = 0; i < rows; i++) {
        const w = Math.max(2, 5 - i);
        b.pair(cx, side, chinY - 2 + i * 2, w, 2, i & 1 ? hc.base : hc.dark);
      }
      b.pair(cx, side - 1, top + 2, 3, 3, hc.base);
      break;
    }
    case 'ponytail':
      b.rect(cx + side, top + 2, 2, 3, hc.base);
      b.rect(cx + side + 1, top + 4, 2, hipY - top - 4, hc.base);
      b.vline(cx + side + 2, top + 6, hipY - top - 8, hc.lite);
      break;
    case 'sidetail':
      b.rect(cx - side - 2, top + 3, 3, 3, hc.base);
      b.rect(cx - side - 2, top + 5, 2, bootY - top - 8, hc.base);
      b.vline(cx - side - 2, top + 7, 4, hc.lite);
      break;
    case 'braid': {
      // Segmented, with a notch every other row — that is what says "braid".
      const len = bootY - chinY;
      for (let j = 0; j < len; j++) {
        b.rect(cx - side - 2, chinY - 2 + j, 2, 1, j % 3 === 2 ? hc.deep : hc.base);
      }
      b.rect(cx - side - 2, bootY - 3, 2, 2, P.trim.base);   // the tie
      b.taper(cx - side, top, side * 2 + 1, side * 2 + 1, 3, hc.base);
      break;
    }
    case 'topknot':
      b.rect(cx - 2, top - 3, 5, 3, hc.base);
      b.hline(cx - 2, top - 3, 5, hc.lite);
      b.rect(cx - 1, top - 1, 3, 2, P.trim.base);            // the band
      b.rect(cx + side - 1, top - 2, 2, 5, hc.dark);
      break;
    case 'hood':
      b.taper(cx - side - 2, top - 2, side * 2 + 5, side * 2 + 7, chinY - top + 4, hc.base);
      break;
    case 'plume':
      for (let i = 0; i < 3; i++) {
        b.spike(cx + side - 1 + i, top - i, 3, 5 + i, -1, i & 1 ? hc.lite : hc.base);
      }
      break;
    case 'wild':
      b.pair(cx, side, top + 1, 2, 5, hc.base);
      b.pair(cx, side + 1, top + 3, 1, 3, hc.dark);
      break;
    default:
      break;
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
  const top = headY - headR;
  b.ellipse(cx, headY - 1, headR, headR - 1, hc.base);
  b.hline(cx - headR + 2, top, headR * 2 - 3, hc.lite);      // lit top
  b.hline(cx - headR + 1, top + 1, headR * 2 - 1, hc.lite);
  b.hline(cx - headR, headY, 2, hc.dark);                    // temple shadow
  b.hline(cx + headR - 1, headY, 2, hc.dark);
}

function drawHairFront(b, m, P, d) {
  const style = d.hair || 'short';
  if (style === 'none') return;
  const hc = P.hair;
  const { cx, headY, headR } = m;
  const top = headY - headR;

  if (style === 'hood') {
    // Under a hood there is no face — just two lit points. Its own read.
    b.ellipse(cx, headY, headR - 1, headR - 1, '#141420');
    b.set(cx - 3, headY, d.eyeGlow || '#ff5f7e');
    b.set(cx + 2, headY, d.eyeGlow || '#ff5f7e');
    b.taper(cx - headR - 1, top - 2, headR * 2 + 3, headR * 2 + 3, 4, hc.base);
    b.hline(cx - headR + 1, top - 2, headR * 2 - 1, hc.lite);
    return;
  }

  switch (style) {
    case 'spiky':
      for (let i = -headR + 1; i <= headR - 1; i += 2) {
        b.spike(cx + i - 1, top - 1, 3, 3, -1, i & 1 ? hc.base : hc.lite);
      }
      break;
    case 'flame':
      // Tall swept spikes, taller in the middle — a whole silhouette on its own.
      for (let i = 0; i < 5; i++) {
        const dx = -headR + 1 + i * ((headR * 2 - 2) / 4 | 0);
        const h = 3 + Math.round(3 * (1 - Math.abs(i - 2) / 2.4));
        b.spike(cx + dx - 1, top, 3, h, -1, i & 1 ? hc.lite : hc.base);
      }
      break;
    case 'wild':
      for (let i = -headR; i <= headR; i += 2) {
        b.spike(cx + i - 1, top, 3, 2 + (i & 3), -1, hc.base);
      }
      b.set(cx - headR - 1, headY - 2, hc.dark);
      b.set(cx + headR + 1, headY - 1, hc.dark);
      break;
    case 'ahoge':
      // One tall antenna strand with a hook at the tip. Instantly identifying.
      b.vline(cx + 1, top - 4, 4, hc.base);
      b.set(cx + 2, top - 4, hc.lite);
      b.set(cx + 3, top - 3, hc.lite);
      b.hline(cx - headR + 2, headY - 2, headR * 2 - 3, hc.base);
      break;
    case 'plume':
      for (let i = 0; i < 3; i++) b.spike(cx - 2 + i * 2, top - 1 - i, 3, 4 + i, -1, hc.lite);
      break;
    case 'buzz':
      b.hline(cx - headR + 2, headY - 2, headR * 2 - 3, hc.dark);
      break;
    case 'bowl':
      // A blunt fringe straight across at brow level, sides squared off.
      b.rect(cx - headR, headY - 2, headR * 2 + 1, 2, hc.base);
      b.hline(cx - headR, headY - 2, headR * 2 + 1, hc.lite);
      b.pair(cx, headR - 1, headY - 1, 2, 3, hc.dark);
      break;
    case 'bangs':
      b.rect(cx - headR + 1, headY - 2, headR * 2 - 1, 2, hc.base);
      b.rect(cx - headR + 1, headY - 2, 3, 4, hc.dark);      // the eye-covering lock
      b.hline(cx - headR + 1, headY - 2, headR * 2 - 1, hc.lite);
      break;
    case 'twin':
    case 'drills':
      b.hline(cx - headR + 1, headY - 2, headR * 2 - 1, hc.base);
      b.set(cx - 1, headY - 1, hc.dark);
      b.set(cx + 1, headY - 1, hc.dark);
      break;
    case 'braid':
      b.hline(cx - headR + 1, headY - 2, headR * 2 - 1, hc.lite);   // crown braid
      for (let i = -headR + 1; i <= headR - 1; i += 2) b.set(cx + i, headY - 2, hc.deep);
      break;
    case 'topknot':
      b.hline(cx - headR + 2, headY - 2, headR * 2 - 3, hc.dark);
      b.set(cx - headR + 1, headY - 1, hc.base);
      break;
    case 'wave':
      for (let i = -headR + 1; i <= headR - 1; i++) {
        b.set(cx + i, headY - 2 + (i & 1), hc.base);
      }
      break;
    default:   // short, long, bob, ponytail, sidetail
      b.hline(cx - headR + 1, headY - 2, headR * 2 - 1, hc.base);
      b.hline(cx - headR + 1, headY - 3, headR * 2 - 1, hc.lite);
      b.set(cx - headR + 1, headY - 1, hc.dark);
      break;
  }
}

/** Ears, horns, crowns, hats, halos — the silhouette above the shoulders. */
function drawHeadgear(b, m, P, d) {
  const { cx, headY, headR } = m;
  const hc = P.hair, t = P.trim;
  const top = headY - headR;
  switch (d.ears) {
    case 'fox':
      for (const s of [-1, 1]) {
        b.spike(cx + s * (headR - 1) - 1, top - 1, 3, 4, -1, hc.base);
        b.set(cx + s * (headR - 1), top - 2, mixHex(hc.lite, '#ffffff', 0.4));
      }
      break;
    case 'cat':
      for (const s of [-1, 1]) {
        b.spike(cx + s * (headR - 1) - 1, top, 3, 3, -1, hc.base);
        b.set(cx + s * (headR - 1), top - 1, hc.lite);
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
        b.rect(cx + s * (headR + 2) - 1, headY - 3, 3, 3, t.base);
        b.set(cx + s * (headR + 2), headY - 2, t.lite);
        b.vline(cx + s * (headR + 2), headY + 1, 5, t.dark);
        b.set(cx + s * (headR + 3), headY + 5, t.base);
      }
      break;
    case 'fin':
      // A swept dorsal fin standing on the crown, plus two side fins. Widest at
      // the base and leaning back, or it reads as a party hat.
      for (let j = 0; j < 4; j++) b.hline(cx - 3 + j, top - j, Math.max(1, 6 - j * 2), t.base);
      b.line(cx + 3, top, cx, top - 3, t.lite);
      for (const s of [-1, 1]) b.spike(cx + s * (headR + 1) - 1, headY, 3, 3, 1, t.dark);
      break;
    case 'horns':
      for (const s of [-1, 1]) {
        b.set(cx + s * (headR - 1), top - 1, t.lite);
        b.set(cx + s * headR, top - 2, t.lite);
        b.set(cx + s * headR, top - 3, t.base);
      }
      break;
    case 'greatHorns':
      // Swept back and out, reaching the top rows of the grid. Boss energy.
      for (const s of [-1, 1]) {
        b.line(cx + s * (headR - 1), top, cx + s * (headR + 3), top - 4, t.base);
        b.line(cx + s * (headR - 1), top + 1, cx + s * (headR + 3), top - 3, t.lite);
        b.set(cx + s * (headR + 4), top - 5, mixHex(t.lite, '#ffffff', 0.4));
      }
      break;
    default:
      break;
  }
  if (d.crown) {
    const c = slotRamp(d.crown, d.accent || '#ffd76a');
    const y = Math.max(0, top - 2);
    b.hline(cx - headR + 1, y + 1, headR * 2 - 1, c.base);
    for (let i = -headR + 1; i <= headR - 1; i += 2) b.set(cx + i, y, c.lite);
    b.set(cx, y - 1, c.lite);
  }
  if (d.hat === 'tricorn') {
    const c = slotRamp(d.hatColor, '#241826');
    const y = Math.max(1, top - 2);
    b.hline(cx - headR - 2, y + 2, headR * 2 + 5, c.base);       // the brim
    b.hline(cx - headR - 1, y + 1, headR * 2 + 3, c.dark);
    b.taper(cx - headR + 1, y - 1, headR * 2 - 1, headR * 2 - 1, 2, c.base);
    b.hline(cx - headR + 2, y - 1, headR * 2 - 3, P.trim.base);  // the band
    b.set(cx + headR - 1, y, P.trim.lite);                       // the cockade
  }
  if (d.halo) {
    // The old halo drew at y = headY - 8, which on a 26-row grid is y = -1: it
    // was clipped away on every frame. Anchored to the head now, and drawn as a
    // ring rather than a bar so it reads as a halo and not as a hat.
    const c = typeof d.halo === 'string' ? d.halo : '#ffe9a3';
    const y = Math.max(0, top - (d.hair === 'ahoge' ? 5 : 3));
    b.hline(cx - headR + 2, y, headR * 2 - 3, c);
    b.set(cx - headR + 1, y + 1, shade(c, -0.2));
    b.set(cx + headR - 1, y + 1, shade(c, -0.2));
  }
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
      b.hline(wx - 2, hipY, 5, gold.base);                   // crossguard
      b.set(wx, hipY, gold.lite);
      b.vline(wx, hipY + 1, 3, grip.base);
      b.set(wx, hipY + 4, gold.lite);                        // pommel
      break;
    }
    case 'sword': {
      const h = hipY - shoulderY + 4;
      b.rect(wx - 1, shoulderY - 3, 2, h, met.base);
      b.vline(wx - 1, shoulderY - 3, h, met.lite);
      b.set(wx - 1, shoulderY - 4, met.lite);
      b.hline(wx - 2, hipY + 1, 4, gold.base);               // basket hilt
      b.vline(wx - 2, hipY + 1, 3, gold.base);
      b.vline(wx, hipY + 2, 3, grip.base);
      break;
    }
    case 'katana': {
      // A long single edge with a slight bend, tip well inside the grid.
      b.blade(wx - 3, hand - 1, wx - 1, headY + 1, met.lite, met.base);
      b.blade(wx - 1, headY + 1, wx, top + 1, met.lite, met.base);
      b.hline(wx - 4, hand, 4, '#2a2a3a');                   // tsuba
      b.vline(wx - 4, hand + 1, 3, grip.base);               // hilt wrap
      b.set(wx - 4, hand + 4, gold.base);
      break;
    }
    case 'dual': {
      const h = hipY - shoulderY + 3;
      b.rect(wx - 1, shoulderY - 2, 2, h, met.base);
      b.vline(wx - 1, shoulderY - 2, h, met.lite);
      b.hline(wx - 2, hipY + 1, 4, grip.base);
      b.rect(lx, shoulderY, 2, h - 2, met.base);
      b.vline(lx, shoulderY, h - 2, met.lite);
      b.hline(lx - 1, hipY + 1, 4, grip.base);
      break;
    }
    case 'scythe': {
      b.vline(wx, top + 2, bottom - top - 3, grip.base);
      b.vline(wx + 1, top + 3, bottom - top - 5, grip.dark);
      // the blade sweeps back over the head, which is the whole silhouette
      b.line(wx, top + 2, cx + 1, top, met.lite);
      b.line(wx, top + 3, cx + 1, top + 1, met.base);
      b.line(cx + 1, top, cx, top + 2, met.lite);
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
      b.spike(wx - 1, top + 3, 3, 4, -1, met.lite);
      b.set(wx, top, met.base);
      b.hline(wx - 1, top + 4, 3, gold.base);
      break;
    }
    case 'staff': {
      b.vline(wx, top + 3, bottom - top - 4, grip.base);
      b.vline(wx + 1, top + 4, bottom - top - 6, grip.dark);
      b.ellipse(wx, top + 1, 2, 2, gold.base);
      b.set(wx - 1, top, mixHex(gold.lite, '#ffffff', 0.5));
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
      b.vline(wx - 3, shoulderY + 2, hipY - shoulderY, gold.base);      // spine
      b.hline(wx - 2, shoulderY + 2, 4, '#3a3a4a');
      b.set(wx, shoulderY + 4, gold.lite);                   // the clasp
      b.vline(wx + 1, shoulderY + 3, hipY - shoulderY - 2, '#e8e4dc');  // page block
      break;
    }
    case 'mic': {
      b.vline(wx, shoulderY + 2, hipY - shoulderY, '#3a3a4a');
      b.ellipse(wx, shoulderY, 2, 2, met.lite);
      b.set(wx - 1, shoulderY - 1, '#ffffff');
      for (let j = 0; j < 5; j++) b.set(wx + 1 + (j & 1), hipY + 1 + j, gold.base);  // the cable
      break;
    }
    case 'fan': {
      const h = hipY - shoulderY + 4;
      b.taper(wx - 3, shoulderY - 2, 5, 1, h, gold.base);
      for (let j = 0; j < h; j += 2) b.hline(wx - 3 + (j >> 1), shoulderY - 2 + j, Math.max(1, 5 - j), gold.lite);
      b.set(wx - 1, hipY + 2, grip.base);
      break;
    }
    case 'chakram': {
      const r = Math.max(2, headR - 1);
      b.ellipse(wx - 1, hipY - 2, r, r, met.base);
      b.ellipse(wx - 1, hipY - 2, r - 2, r - 2, gold.dark);
      b.set(wx - 1, hipY - 2 - r, met.lite);
      break;
    }
    case 'hammer': {
      b.vline(wx, shoulderY + 1, bottom - shoulderY - 2, grip.base);
      b.rect(wx - 2, shoulderY - 3, 5, 4, met.base);
      b.hline(wx - 2, shoulderY - 3, 5, met.lite);
      b.hline(wx - 2, shoulderY, 5, met.deep);
      b.vline(wx - 2, shoulderY - 2, 2, gold.base);
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
        b.line(wx - 2 + i, hipY + 1, wx + i, hipY + 5, met.lite);
      }
      b.rect(wx - 3, hipY - 1, 4, 2, gold.base);             // the knuckle plate
      break;
    }
    case 'orb': {
      b.ellipse(wx, shoulderY + 2, 3, 3, gold.base);
      b.ellipse(wx, shoulderY + 2, 1, 1, mixHex(gold.lite, '#ffffff', 0.6));
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
// THE PORTRAIT — a head-and-shoulders bust for the HUD, on its own 32x32 grid.
// Dramatically more detail than the world sprite can carry: big irises with
// catch-lights, brows, a nose, a mouth, layered hair with a highlight band, and
// whatever signature feature the character has above the neck.
// ---------------------------------------------------------------------------
function drawPortrait(b, d) {
  const W = b.w, H = b.h;
  const cx = W >> 1;
  const P = humanPalette(d);
  const hc = P.hair;
  const headY = Math.round(H * 0.40);
  const rx = Math.max(4, Math.round(W * 0.28));
  const ry = Math.max(4, Math.round(H * 0.26));
  const chinY = headY + ry;
  const shoulderY = Math.min(H - 6, chinY + 4);
  const eyeY = headY;
  const eyeW = Math.max(3, rx - 4);
  const eyeIn = Math.max(2, (rx / 4.5) | 0);
  const noseY = eyeY + eyeW;
  const mouthY = chinY - 2;
  const top = headY - ry - 1;
  const style = d.hair || 'short';

  // --- everything behind the head ------------------------------------------
  if (d.aura) {
    const a = slotRamp(d.aura, d.accent || '#ffe9a3');
    for (let i = 0; i < 6; i++) {
      b.set(2 + (i % 3) * 2, 3 + i * 2, i & 1 ? a.lite : a.base);
      b.set(W - 3 - (i % 3) * 2, 4 + i * 2, i & 1 ? a.base : a.lite);
    }
  }
  const backLen = ({ long: 14, bangs: 13, bob: 6, wave: 9, twin: 12, drills: 12,
                     sidetail: 12, ponytail: 10, braid: 12 })[style] || 0;
  if (backLen) {
    b.pair(cx, rx - 1, headY - ry + 2, 3, backLen, hc.base);
    b.pair(cx, rx + 1, headY - ry + 4, 1, backLen - 3, hc.dark);
  }
  if (style === 'drills') {
    for (let i = 0; i < 4; i++) {
      b.pair(cx, rx - 1, chinY - 4 + i * 3, Math.max(2, 5 - i), 3, i & 1 ? hc.base : hc.dark);
    }
  }
  if (style === 'twin') b.pair(cx, rx, headY - ry + 1, 4, 4, hc.base);
  if (style === 'ponytail') b.rect(cx + rx - 1, headY - ry + 2, 4, 14, hc.base);
  if (style === 'sidetail') b.rect(cx - rx - 2, headY - ry + 4, 4, 14, hc.base);
  if (style === 'braid') {
    for (let j = 0; j < 14; j++) b.rect(cx - rx - 2, chinY - 8 + j, 3, 1, j % 3 === 2 ? hc.deep : hc.base);
  }

  // --- shoulders, collar and outfit ----------------------------------------
  const shBot = (W >> 1) - 3;
  const shTop = Math.max(5, shBot - 4);
  b.taper(cx - shTop, shoulderY, shTop * 2 + 1, shBot * 2 + 1, H - shoulderY, P.cloth.base);
  b.hline(cx - shTop + 1, shoulderY, shTop * 2 - 1, P.cloth.lite);
  if (d.coat) {
    b.rect(cx - shBot, shoulderY + 2, 5, H - shoulderY - 2, P.coat.base);
    b.rect(cx + shBot - 4, shoulderY + 2, 5, H - shoulderY - 2, P.coat.base);
    b.vline(cx - shBot + 5, shoulderY + 2, H - shoulderY - 2, P.coat.lite);
    b.vline(cx + shBot - 5, shoulderY + 2, H - shoulderY - 2, P.coat.lite);
  }
  if (d.pauldrons) {
    const pc = slotRamp(d.pauldrons, d.accent || '#9aa7bd');
    b.pair(cx, shTop + 1, shoulderY, 6, 4, pc.base);
    b.pair(cx, shTop + 1, shoulderY, 6, 1, pc.lite);
    b.pair(cx, shTop + 3, shoulderY + 2, 2, 1, pc.deep);
  }
  // neck
  b.rect(cx - 3, chinY, 7, shoulderY - chinY + 1, P.skin.dark);
  b.hline(cx - 3, chinY + 1, 7, P.skin.deep);
  if (d.scarf) {
    const sc = slotRamp(d.scarf, d.accent || '#c8342a');
    b.rect(cx - 6, chinY + 1, 13, 3, sc.base);
    b.hline(cx - 6, chinY + 1, 13, sc.lite);
    b.rect(cx - 8, chinY + 3, 3, 6, sc.dark);                 // the trailing end
  } else {
    b.hline(cx - 6, shoulderY, 13, P.trim.base);              // collar
    b.set(cx, shoulderY + 1, P.trim.lite);
    b.set(cx - 4, shoulderY + 1, P.trim.dark);
    b.set(cx + 4, shoulderY + 1, P.trim.dark);
  }
  if (d.chest) {
    // The character's crest, moved from mid-chest (cropped away by a bust) up
    // onto the collarbone, so a portrait still carries the badge.
    b.hline(cx - 1, shoulderY + 2, 3, d.chest);
    b.set(cx, shoulderY + 1, d.chest);
    b.set(cx, shoulderY + 3, d.chest);
    b.set(cx, shoulderY + 2, shade(d.chest, 0.45));
  }

  // --- the crown of hair, UNDER the face -----------------------------------
  // Highlights are drawn as smaller ELLIPSES, never as flat hlines: an hline
  // wider than the dome it sits on leaves a notch of background inside the
  // silhouette, which outline() then fills with a black bar through the skull.
  if (style !== 'none') {
    b.ellipse(cx, headY - 1, rx + 1, ry + 1, hc.base);
    b.ellipse(cx, headY - 3, rx - 1, ry - 2, hc.lite);
    b.ellipse(cx, headY + 1, rx + 1, ry - 1, hc.base);
  }

  // --- head ----------------------------------------------------------------
  b.ellipse(cx, headY, rx, ry, P.skin.base);
  b.taper(cx - rx + 3, headY + ry - 4, rx * 2 - 5, 5, 5, P.skin.base);
  b.hline(cx - rx + 4, headY - ry + 1, rx * 2 - 7, P.skin.lite);
  b.hline(cx - rx + 2, headY + ry - 3, 2, P.skin.dark);       // jaw shadow
  b.hline(cx + rx - 3, headY + ry - 3, 2, P.skin.dark);
  b.set(cx - 2, chinY, P.skin.dark);
  b.set(cx + 2, chinY, P.skin.dark);

  // --- the face, which is the whole reason a portrait exists ---------------
  const iris = ramp(P.eyes);
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - eyeIn - eyeW : cx + eyeIn + 1;
    b.hline(x, eyeY - 2, eyeW, hc.dark);                      // brow
    b.hline(x + (s < 0 ? 0 : 1), eyeY - 3, eyeW - 1, hc.deep);
    b.hline(x, eyeY - 1, eyeW, hc.base);                      // lash line
    b.set(s < 0 ? x - 1 : x + eyeW, eyeY - 1, hc.dark);
    b.rect(x, eyeY, eyeW, eyeW, EYE_WHITE);                   // sclera
    b.rect(x + 1, eyeY, eyeW - 2, eyeW, iris.base);           // iris
    b.rect(x + 1, eyeY + 1, eyeW - 2, eyeW - 3, iris.deep);   // pupil
    b.hline(x + 1, eyeY + eyeW - 1, eyeW - 2, iris.lite);     // lit lower rim
    b.set(s < 0 ? x + 1 : x + eyeW - 2, eyeY, '#ffffff');     // catch-light
    b.hline(x, eyeY + eyeW, eyeW, P.skin.dark);               // under-eye line
    if (P.glow) b.hline(x, eyeY + eyeW + 1, eyeW, P.glow);
  }
  b.set(cx, noseY - 1, P.skin.dark);                          // nose
  b.set(cx - 1, noseY, P.skin.deep);
  b.hline(cx - 1, mouthY, 3, P.skin.deep);                    // mouth
  b.set(cx, mouthY + 1, mixHex(P.skin.dark, '#c05a5a', 0.4));
  const blush = mixHex(P.skin.base, '#ff8a9a', 0.45);
  b.hline(cx - rx + 2, noseY - 1, 2, blush);                  // cheeks
  b.hline(cx + rx - 3, noseY - 1, 2, blush);

  if (d.mask) {
    const mc = slotRamp(d.mask, d.accent || '#243050');
    b.rect(cx - rx + 3, noseY - 1, rx * 2 - 5, chinY - noseY + 2, mc.base);
    b.hline(cx - rx + 3, noseY - 1, rx * 2 - 5, mc.lite);
  }
  if (d.visor) {
    const vc = slotRamp(d.visor, '#8ad8ff');
    b.rect(cx - rx + 1, eyeY - 1, rx * 2 - 1, eyeW + 2, vc.dark);
    b.hline(cx - rx + 1, eyeY + 1, rx * 2 - 1, vc.base);
    b.hline(cx - rx + 2, eyeY - 1, 3, vc.lite);
    b.set(cx + rx - 3, eyeY + eyeW, vc.lite);
  }

  // --- the fringe, over the face but never over the eyes -------------------
  if (style !== 'none') {
    const fTop = headY - ry + 1;
    const fH = Math.max(2, ry - 4);
    b.rect(cx - rx + 2, fTop, rx * 2 - 3, fH, hc.base);
    b.hline(cx - rx + 3, fTop, rx * 2 - 5, hc.lite);
    b.hline(cx - rx + 2, fTop + fH - 1, rx * 2 - 3, hc.dark);
    if (style === 'buzz') {
      b.rect(cx - rx + 3, fTop + 1, rx * 2 - 5, fH - 1, P.skin.base);
      b.hline(cx - rx + 3, fTop + 1, rx * 2 - 5, P.skin.lite);
    } else if (style === 'bowl' || style === 'bangs') {
      b.rect(cx - rx, fTop, rx * 2 + 1, fH + 1, hc.base);
      b.hline(cx - rx, fTop, rx * 2 + 1, hc.lite);
      b.hline(cx - rx, fTop + fH, rx * 2 + 1, hc.dark);
      if (style === 'bangs') b.rect(cx - rx, fTop, 4, fH + eyeW, hc.dark);
    } else if (style === 'spiky' || style === 'wild' || style === 'flame' || style === 'plume') {
      const n = style === 'plume' ? 3 : 5;
      for (let i = 0; i < n; i++) {
        const dx = -rx + 1 + Math.round(i * (rx * 2 - 2) / (n - 1));
        const h = style === 'flame' ? 4 + Math.round(4 * (1 - Math.abs(i - 2) / 2.4))
                : style === 'plume' ? 8 : style === 'wild' ? 3 + (i & 3) : 5;
        b.spike(cx + dx - 1, fTop, 3, h, -1, i & 1 ? hc.lite : hc.base);
      }
    } else if (style === 'ahoge') {
      b.vline(cx + 2, top - 5, 6, hc.base);
      b.set(cx + 3, top - 5, hc.lite);
      b.set(cx + 4, top - 4, hc.lite);
    } else if (style === 'topknot') {
      b.rect(cx - 3, top - 5, 7, 4, hc.base);
      b.hline(cx - 3, top - 5, 7, hc.lite);
      b.rect(cx - 2, top - 1, 5, 2, P.trim.base);
    } else {
      // A parted fringe: a lit strand, and two locks down past the temples.
      b.rect(cx - rx + 2, fTop, 3, fH + 3, hc.dark);
      b.rect(cx + rx - 4, fTop, 3, fH + 2, hc.dark);
      b.hline(cx - 2, fTop, 5, mixHex(hc.lite, '#ffffff', 0.3));
    }
  }

  // --- the signature above the hairline ------------------------------------
  const t = P.trim;
  if (d.ears === 'fox' || d.ears === 'cat') {
    const h = d.ears === 'fox' ? 7 : 5;
    for (const s of [-1, 1]) {
      b.spike(cx + s * (rx - 2) - 2, top, 5, h, -1, hc.base);
      b.spike(cx + s * (rx - 2) - 1, top - 1, 3, h - 2, -1, mixHex(hc.lite, '#ff9ecb', 0.4));
    }
  } else if (d.ears === 'long') {
    // Long drooping mascot ears — they hang beside the head rather than stand.
    for (const s of [-1, 1]) {
      b.ellipse(cx + s * (rx + 2), headY - 2, 2, 7, P.skin.base);
      b.vline(cx + s * (rx + 2), headY - 7, 4, P.skin.lite);
      b.set(cx + s * (rx + 2), headY + 5, t.base);
    }
  } else if (d.ears === 'elf') {
    for (const s of [-1, 1]) {
      b.line(cx + s * rx, headY, cx + s * (rx + 3), headY - 5, P.skin.base);
      b.line(cx + s * rx, headY + 1, cx + s * (rx + 2), headY - 3, P.skin.lite);
    }
  } else if (d.ears === 'ribbon') {
    for (const s of [-1, 1]) {
      b.rect(cx + s * (rx + 1) - 2, headY - 4, 5, 5, t.base);
      b.rect(cx + s * (rx + 1) - 1, headY - 3, 3, 3, t.lite);
      b.vline(cx + s * (rx + 1), headY + 2, 7, t.dark);
    }
  } else if (d.ears === 'fin') {
    b.spike(cx - 4, top - 5, 9, 7, 1, t.base);
    b.line(cx + 3, top - 5, cx + 4, top - 1, t.lite);
  } else if (d.ears === 'horns') {
    for (const s of [-1, 1]) {
      b.line(cx + s * (rx - 2), top, cx + s * (rx - 1), top - 4, t.lite);
      b.line(cx + s * (rx - 1), top, cx + s * rx, top - 3, t.base);
    }
  } else if (d.ears === 'greatHorns') {
    for (const s of [-1, 1]) {
      b.blade(cx + s * (rx - 2), top + 1, cx + s * (rx + 3), top - 6, t.lite, t.base);
      b.set(cx + s * (rx + 4), top - 7, mixHex(t.lite, '#ffffff', 0.5));
    }
  }
  if (d.crown) {
    const c = slotRamp(d.crown, d.accent || '#ffd76a');
    b.hline(cx - rx + 2, top - 1, rx * 2 - 3, c.base);
    for (let i = -rx + 2; i <= rx - 2; i += 3) b.set(cx + i, top - 2, c.lite);
    b.set(cx, top - 3, c.lite);
  }
  if (d.hat === 'tricorn') {
    const c = slotRamp(d.hatColor, '#241826');
    b.hline(cx - rx - 3, top, rx * 2 + 7, c.base);
    b.hline(cx - rx - 2, top - 1, rx * 2 + 5, c.dark);
    b.taper(cx - rx + 2, top - 4, rx * 2 - 3, rx * 2 - 3, 3, c.base);
    b.hline(cx - rx + 3, top - 4, rx * 2 - 5, t.base);
    b.set(cx + rx - 3, top - 3, t.lite);
  }
  if (d.halo) {
    const c = typeof d.halo === 'string' ? d.halo : '#ffe9a3';
    const y = Math.max(0, top - (d.hair === 'ahoge' ? 7 : 4));
    b.hline(cx - rx + 3, y, rx * 2 - 5, c);
    b.set(cx - rx + 2, y + 1, shade(c, -0.25));
    b.set(cx + rx - 2, y + 1, shade(c, -0.25));
  }
}

/** A soft round creature — slimes, ghosts, mochi, wisps. */
function drawBlob(b, d) {
  const cx = b.w >> 1, cy = b.h >> 1;
  const c = ramp(d.outfit || '#7fd6a0');
  const t = ramp(d.accent || shade(d.outfit || '#7fd6a0', -0.5));
  const r = Math.max(3, Math.min(cx, cy) - 2);
  const eyeR = Math.max(1, r >> 2);
  b.ellipse(cx, cy + 1, r, r - 1, c.base);
  b.hline(cx - (r >> 1), cy - r + 1, r, c.lite);
  // a squashed base, so it sits on the ground instead of floating
  b.hline(cx - r + 1, cy + r - 1, r * 2 - 1, c.dark);
  const eyeC = d.eyes || '#1a1a2e';
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - eyeR - 1 : cx + 1;
    b.rect(x, cy - 1, eyeR + 1, eyeR + 1, eyeC);
    b.set(s < 0 ? x : x + eyeR, cy - 1, EYE_WHITE);
    b.set(x + (eyeR >> 1), cy + eyeR + 2, mixHex(c.base, '#ff7a8f', 0.5));   // blush
  }
  // a mouth, which is what turns a circle into a creature
  b.hline(cx - 1, cy + eyeR + 2, 3, t.deep);
  b.set(cx, cy + eyeR + 3, t.deep);
  if (d.chest) {
    b.hline(cx - 1, cy - r + 2, 3, d.chest);
    b.set(cx, cy - r + 1, d.chest);
  }
  if (d.ears === 'long') {
    for (const s of [-1, 1]) {
      b.ellipse(cx + s * (r - 2), cy - r, 1, 3, c.base);
      b.set(cx + s * (r - 2), cy - r - 2, t.base);
    }
  } else if (d.ears === 'horns') {
    for (const s of [-1, 1]) b.spike(cx + s * (r - 2) - 1, cy - r, 3, 3, -1, t.base);
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
  b.vline(cx - headR, headY + headR, hemY - headY - headR - 1, c.dark);
  b.vline(cx + headR, headY + headR, hemY - headY - headR - 1, c.dark);
  // sleeves, hanging where arms would be
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - half + 1 : cx + half - 2;
    b.rect(x, headY + headR + 1, 2, Math.max(2, (hemY - headY) >> 1), c.dark);
    b.set(s < 0 ? x : x + 1, headY + headR + 1, c.lite);
  }
  // A torn hem, alternating tongues, which is the read for "no feet".
  for (let i = -half; i <= half; i += 2) b.vline(cx + i, hemY - 1, 2, c.dark);
  const eyeC = d.eyes || '#ff5f7e';
  for (const s of [-1, 1]) {
    const x = s < 0 ? cx - headR + 1 : cx + headR - 2;
    b.rect(x, headY - 1, 2, 3, '#141420');                     // hollow socket
    b.rect(x, headY, 2, 2, eyeC);
  }
  b.hline(cx - 1, headY + headR - 2, 3, '#141420');            // a gasping mouth
  if (d.chest) b.hline(cx - 1, headY + headR + 2, 3, d.chest);
  if (d.halo) b.hline(cx - headR + 2, Math.max(0, top - 2), headR * 2 - 3, typeof d.halo === 'string' ? d.halo : '#ffe9a3');
  if (d.ears === 'horns') {
    for (const s of [-1, 1]) b.spike(cx + s * (headR - 1) - 1, top, 3, 3, -1, t.base);
  }
  // trailing wisps, so it reads as drifting rather than standing
  b.set(cx - half - 2, headY + headR + 1, c.lite);
  b.set(cx + half + 2, headY + headR + 3, c.lite);
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
  }
  for (let i = -half + 2; i <= half - 2; i += 3) {
    b.set(cx + i, bodyTop - 1, t.lite);
    b.set(cx + i, bodyTop, t.base);
  }
  // head, low and forward
  b.ellipse(cx, headY, headR, headR - 1, c.base);
  b.hline(cx - headR + 2, headY - headR + 1, headR * 2 - 3, c.lite);
  b.taper(cx - 2, headY + 1, 5, 3, 3, c.dark);                 // muzzle
  const eyeC = d.eyes || '#ffd23f';
  b.rect(cx - headR + 1, headY, 2, 2, eyeC);
  b.rect(cx + headR - 2, headY, 2, 2, eyeC);
  for (let i = -1; i <= 1; i++) b.set(cx + i, headY + 3, '#e8e4dc');   // teeth
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
      b.rect(s < 0 ? cx - half - 1 : cx + half - 1, bodyTop, 3, 4, pc.base);
      b.hline(s < 0 ? cx - half - 1 : cx + half - 1, bodyTop, 3, pc.lite);
    }
  }
  // four stubby limbs, the front pair planted forward
  const legH = Math.max(2, bottom - legTop + 1);
  for (const s of [-1, 1]) {
    b.rect(s < 0 ? cx - half : cx + half - 2, legTop, 3, legH, c.dark);
    b.rect(s < 0 ? cx - half + 4 : cx + half - 6, legTop, 3, legH, c.deep);
    b.hline(s < 0 ? cx - half - 1 : cx + half - 2, bottom, 4, t.deep);      // paw
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
  // the lens, and a sensor strip across the brow
  b.ellipse(cx, cy, 3, 3, t.dark);
  b.ellipse(cx, cy, 2, 2, t.base);
  b.set(cx - 1, cy - 1, mixHex(t.lite, '#ffffff', 0.5));
  b.hline(cx - 3, top + 1, 7, t.dark);
  b.set(cx, top + 1, t.lite);
  // struts / manipulators
  for (const s of [-1, 1]) {
    b.rect(s < 0 ? cx - half - 2 : cx + half + 1, top + 3, 2, botY - top - 6, c.dark);
    b.set(s < 0 ? cx - half - 2 : cx + half + 2, cy + 2, t.base);
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
  b.ellipse(cx, headY, headR, headR - 1, c.lite);                              // head
  b.hline(cx - headR + 2, headY - headR, headR * 2 - 3, c.lite);
  const eyeC = d.eyes || '#ff3a5e';
  b.rect(cx - headR + 1, headY, Math.max(2, headR - 2), 2, eyeC);
  b.rect(cx + 2, headY, Math.max(2, headR - 2), 2, eyeC);
  for (const s of [-1, 1]) {                                                   // arms
    const x = s < 0 ? cx - half - 5 : cx + half - 1;
    b.taper(x, torsoY + 2, 6, 5, Math.round(H * 0.34), c.dark);
    b.rect(s < 0 ? x : x + 1, torsoY + 2 + Math.round(H * 0.34), 5, 4, c.deep); // fists
  }
  for (const s of [-1, 1]) {                                                   // legs
    b.rect(s < 0 ? cx - half + 1 : cx + 2, legY, Math.max(4, half - 3), H - 3 - legY, c.dark);
    b.hline(s < 0 ? cx - half : cx + 2, H - 3, Math.max(5, half - 2), c.deep);
  }
  if (d.ears === 'horns' || d.ears === 'greatHorns') {
    for (const s of [-1, 1]) {
      b.blade(cx + s * (headR - 1), headY - headR + 1, cx + s * (headR + 5), headY - headR - 5, t.lite, t.base);
    }
  }
  if (d.chest) {
    b.ellipse(cx, torsoY + Math.round(torsoH * 0.35), 3, 3, d.chest);
    b.set(cx - 1, torsoY + Math.round(torsoH * 0.35) - 1, mixHex(d.chest, '#ffffff', 0.55));
  }
  b.hline(cx - half + 2, torsoY + torsoH - 2, half * 2 - 3, t.dark);           // belt
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

/** Default grid size per body plan. */
const BODY_SIZE = {
  humanoid: [24, 34],
  portrait: [32, 32],
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
