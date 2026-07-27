// Procedural pixel-art sprite generator.
//
// This replaces "emoji composited over a coloured blob" with actual sprites:
// chunky, outlined, readable at a glance in a crowd of two hundred, and
// generated entirely in code so the project keeps its zero-asset promise.
//
// HOW IT WORKS
// ------------
// Everything is drawn into a small integer pixel grid (characters are 20x26,
// most enemies 16x18, bosses up to 56x56) and then blitted at whatever scale
// the world needs with smoothing OFF. That is what makes it read as a sprite
// game rather than as vector art — the pixels stay square.
//
// Sprites are PARAMETRIC, not hand-drawn grids. A descriptor names a body plan
// and a handful of features:
//
//     { body:'humanoid', hair:'twin', hairColor:'#9fe8ff', outfit:'#5fd6ff',
//       skin:'#ffd9c0', weapon:'trident', ears:'none', cape:false }
//
// and the builder assembles head, hair, torso, arms, legs, weapon and outline.
// 19 characters and 35 enemies from ~200 lines of drawing code, each still
// individually recognisable, and adding one is six lines of data.
//
// READABILITY RULES (SECTION 1) baked in, not left to the author:
//   - every sprite gets a hard 1px dark outline, so it separates from any
//     background and from the horde behind it
//   - enemies are cool-toned and desaturated; players are bright and saturated
//   - a 2-frame idle bob, because a static sprite in a moving field looks broken

import { shade, mixHex, clamp, TAU } from '../core/math.js';

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
  /** A soft-shouldered trapezoid — torsos, capes, robes. */
  taper(x, y, topW, botW, h, c) {
    for (let j = 0; j < h; j++) {
      const t = h <= 1 ? 0 : j / (h - 1);
      const w = Math.round(topW + (botW - topW) * t);
      this.hline(x + Math.round((topW - w) / 2), y + j, w, c);
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

// ---------------------------------------------------------------------------
// BODY PLANS
// ---------------------------------------------------------------------------

/**
 * The humanoid — every playable character and most humanoid enemies.
 * Grid is 20x26 with the figure centred on x=10 and standing on y=25.
 */
function drawHumanoid(b, d) {
  const cx = (b.w / 2) | 0;
  const skin = ramp(d.skin || SKIN_DEFAULT);
  const cloth = ramp(d.outfit || '#5f7fd6');
  const trim = ramp(d.accent || shade(d.outfit || '#5f7fd6', -0.45));
  const hairC = ramp(d.hairColor || '#2b2b3a');

  const headY = 7;         // centre of the head
  const headR = 4;

  // --- cape / tails behind the body ---------------------------------------
  if (d.cape) {
    b.taper(cx - 5, headY + 3, 10, 12, 14, trim.dark);
  }
  if (d.tails) {
    // Fox tails, dragon tail, coat tails — a fan of soft shapes behind.
    const n = Math.min(d.tails, 4);
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const off = 4 + ((i / 2) | 0) * 3;
      b.ellipse(cx + side * off, headY + 11 + ((i / 2) | 0), 2, 5, trim.base);
    }
  }
  if (d.wings) {
    for (const s of [-1, 1]) {
      b.taper(cx + s * 7 - 2, headY + 2, 4, 7, 9, trim.base);
    }
  }

  // --- legs ----------------------------------------------------------------
  const legTop = 18;
  b.rect(cx - 3, legTop, 2, 6, cloth.dark);
  b.rect(cx + 1, legTop, 2, 6, cloth.dark);
  b.rect(cx - 4, 24, 3, 2, trim.deep);      // boots
  b.rect(cx + 1, 24, 3, 2, trim.deep);

  // --- torso ---------------------------------------------------------------
  b.taper(cx - 4, 12, 8, 7, 7, cloth.base);
  b.hline(cx - 3, 12, 6, cloth.lite);        // collar highlight
  if (d.belt !== false) b.hline(cx - 3, 17, 6, trim.base);
  if (d.chest) b.set(cx, 14, d.chest);       // gem / emblem

  // --- arms ----------------------------------------------------------------
  b.rect(cx - 6, 13, 2, 5, cloth.dark);
  b.rect(cx + 4, 13, 2, 5, cloth.dark);
  b.rect(cx - 6, 18, 2, 2, skin.base);       // hands
  b.rect(cx + 4, 18, 2, 2, skin.base);

  // --- head ----------------------------------------------------------------
  b.ellipse(cx, headY, headR, headR, skin.base);
  b.hline(cx - 2, headY - headR, 4, skin.lite);

  // --- eyes: the single most identity-carrying pixels on the sprite --------
  const eyeC = d.eyes || '#1a1a2e';
  b.set(cx - 2, headY, eyeC);
  b.set(cx + 1, headY, eyeC);
  if (d.eyeGlow) {
    b.set(cx - 2, headY - 1, d.eyeGlow);
    b.set(cx + 1, headY - 1, d.eyeGlow);
  }

  // --- hair ----------------------------------------------------------------
  drawHair(b, cx, headY, headR, d.hair || 'short', hairC, d);

  // --- ears ----------------------------------------------------------------
  if (d.ears === 'fox' || d.ears === 'cat') {
    for (const s of [-1, 1]) {
      b.set(cx + s * 4, headY - 5, hairC.base);
      b.set(cx + s * 4, headY - 6, hairC.base);
      b.set(cx + s * 3, headY - 5, hairC.lite);
    }
  } else if (d.ears === 'horns') {
    for (const s of [-1, 1]) {
      b.set(cx + s * 4, headY - 5, trim.lite);
      b.set(cx + s * 5, headY - 6, trim.lite);
      b.set(cx + s * 5, headY - 7, trim.base);
    }
  }
  if (d.halo) {
    b.hline(cx - 3, headY - 8, 6, d.halo);
  }

  // --- weapon --------------------------------------------------------------
  drawWeapon(b, cx, d);
}

function drawHair(b, cx, headY, headR, style, hairC, d) {
  const top = headY - headR;
  switch (style) {
    case 'spiky':
      b.hline(cx - 4, top, 8, hairC.base);
      b.hline(cx - 4, top - 1, 8, hairC.base);
      for (let i = -4; i <= 3; i += 2) {
        b.set(cx + i, top - 2, hairC.base);
        b.set(cx + i, top - 3, hairC.dark);
      }
      break;
    case 'long':
      b.hline(cx - 4, top - 1, 8, hairC.base);
      b.hline(cx - 5, top, 10, hairC.base);
      for (const s of [-1, 1]) b.rect(cx + (s < 0 ? -5 : 4), top + 1, 1, 10, hairC.base);
      break;
    case 'twin':
      b.hline(cx - 4, top - 1, 8, hairC.base);
      b.hline(cx - 4, top, 8, hairC.lite);
      for (const s of [-1, 1]) {
        b.ellipse(cx + s * 6, headY + 1, 1, 4, hairC.base);
        b.set(cx + s * 6, headY - 3, hairC.lite);
      }
      break;
    case 'bob':
      b.hline(cx - 4, top - 1, 8, hairC.base);
      b.hline(cx - 5, top, 10, hairC.base);
      for (const s of [-1, 1]) b.rect(cx + (s < 0 ? -5 : 4), top + 1, 1, 5, hairC.dark);
      break;
    case 'hood':
      b.taper(cx - 5, top - 2, 10, 12, 8, hairC.base);
      b.ellipse(cx, headY, headR - 1, headR - 1, '#141420');   // shadowed face
      b.set(cx - 2, headY, d.eyeGlow || '#ff5f7e');
      b.set(cx + 1, headY, d.eyeGlow || '#ff5f7e');
      break;
    case 'ponytail':
      b.hline(cx - 4, top - 1, 8, hairC.base);
      b.hline(cx - 4, top, 8, hairC.lite);
      b.rect(cx + 4, top + 1, 2, 8, hairC.base);
      break;
    case 'none':
      break;
    default: // short
      b.hline(cx - 4, top - 1, 8, hairC.base);
      b.hline(cx - 5, top, 10, hairC.base);
      b.hline(cx - 4, top + 1, 3, hairC.dark);
      break;
  }
}

function drawWeapon(b, cx, d) {
  const w = d.weapon;
  if (!w || w === 'none') return;
  const m = ramp(d.weaponColor || '#d8e2f0');
  switch (w) {
    case 'sword':
      b.vline(cx + 6, 8, 9, m.base);
      b.vline(cx + 7, 8, 9, m.lite);
      b.hline(cx + 5, 17, 4, '#7a5a3a');
      break;
    case 'dual':
      b.vline(cx + 6, 8, 9, m.base);
      b.vline(cx - 7, 10, 8, m.base);
      b.hline(cx + 5, 17, 3, '#7a5a3a');
      break;
    case 'katana':
      b.line(cx + 5, 18, cx + 9, 7, m.lite);
      b.line(cx + 6, 18, cx + 10, 7, m.base);
      b.set(cx + 5, 19, '#2a2a3a');
      break;
    case 'scythe':
      b.vline(cx + 6, 6, 14, '#5a4a3a');
      b.line(cx + 6, 6, cx + 9, 8, m.lite);
      b.line(cx + 6, 7, cx + 9, 9, m.base);
      break;
    case 'trident':
      b.vline(cx + 6, 7, 13, '#8a7a5a');
      b.hline(cx + 4, 7, 5, m.base);
      for (const i of [4, 6, 8]) b.vline(cx + i, 5, 2, m.lite);
      break;
    case 'staff':
      b.vline(cx + 6, 6, 14, '#6a5a4a');
      b.ellipse(cx + 6, 5, 2, 2, d.accent || '#c58cff');
      break;
    case 'gun':
      b.hline(cx + 5, 15, 5, m.dark);
      b.set(cx + 5, 16, m.base);
      break;
    case 'book':
      b.rect(cx + 4, 14, 4, 5, '#1a1a26');
      b.vline(cx + 4, 14, 5, '#c8342a');
      break;
    case 'mic':
      b.vline(cx + 6, 12, 6, '#3a3a4a');
      b.ellipse(cx + 6, 11, 2, 2, m.lite);
      break;
    case 'fan':
      b.taper(cx + 4, 12, 2, 7, 5, d.accent || '#ff5fa2');
      break;
  }
}

/** A soft round creature — slimes, ghosts, mochi, wisps. */
function drawBlob(b, d) {
  const cx = (b.w / 2) | 0, cy = (b.h / 2) | 0;
  const c = ramp(d.outfit || '#7fd6a0');
  const r = Math.min(cx, cy) - 2;
  b.ellipse(cx, cy + 1, r, r - 1, c.base);
  b.hline(cx - 2, cy - r + 1, 5, c.lite);
  const eyeC = d.eyes || '#1a1a2e';
  b.set(cx - 2, cy, eyeC); b.set(cx - 2, cy + 1, eyeC);
  b.set(cx + 2, cy, eyeC); b.set(cx + 2, cy + 1, eyeC);
  if (d.chest) b.set(cx, cy - 2, d.chest);
  if (d.ears === 'long') {
    for (const s of [-1, 1]) b.ellipse(cx + s * (r - 1), cy - r + 1, 1, 3, c.base);
  }
}

/** A hovering wraith — ghosts, wisps, spirits. No legs; a ragged hem. */
function drawGhost(b, d) {
  const cx = (b.w / 2) | 0;
  const c = ramp(d.outfit || '#b9c4de');
  const top = 3;
  b.ellipse(cx, top + 4, 5, 4, c.base);
  b.taper(cx - 5, top + 6, 10, 12, 8, c.base);
  // ragged hem
  for (let i = -6; i <= 5; i++) {
    if (((i + 6) & 1) === 0) b.set(cx + i, top + 14, c.base);
  }
  b.hline(cx - 3, top, 6, c.lite);
  const eyeC = d.eyes || '#ff5f7e';
  b.set(cx - 2, top + 4, eyeC);
  b.set(cx + 1, top + 4, eyeC);
}

/** A four-legged or hunched beast — oni, husks, crawlers. */
function drawBeast(b, d) {
  const cx = (b.w / 2) | 0;
  const c = ramp(d.outfit || '#a05f5f');
  const t = ramp(d.accent || '#3a2020');
  b.taper(cx - 6, 6, 12, 10, 9, c.base);      // hunched body
  b.ellipse(cx, 5, 4, 3, c.base);             // head, low and forward
  b.hline(cx - 3, 2, 6, c.lite);
  const eyeC = d.eyes || '#ffd23f';
  b.set(cx - 2, 5, eyeC); b.set(cx + 1, 5, eyeC);
  if (d.ears === 'horns') {
    for (const s of [-1, 1]) { b.set(cx + s * 4, 1, t.lite); b.set(cx + s * 5, 0, t.lite); }
  }
  // limbs
  for (const s of [-1, 1]) {
    b.rect(cx + (s < 0 ? -7 : 5), 14, 2, 4, c.dark);
    b.rect(cx + (s < 0 ? -4 : 2), 15, 2, 4, c.dark);
  }
}

/** A machine — drones, golems, mechs. Hard edges, a single lens. */
function drawMech(b, d) {
  const cx = (b.w / 2) | 0, cy = (b.h / 2) | 0;
  const c = ramp(d.outfit || '#9aa7bd');
  const t = ramp(d.accent || '#ff5f7e');
  b.rect(cx - 5, cy - 4, 10, 9, c.base);
  b.hline(cx - 5, cy - 4, 10, c.lite);
  b.hline(cx - 5, cy + 4, 10, c.deep);
  b.ellipse(cx, cy, 2, 2, t.base);            // lens
  b.set(cx, cy - 1, t.lite);
  for (const s of [-1, 1]) {
    b.rect(cx + (s < 0 ? -7 : 5), cy - 2, 2, 5, c.dark);
  }
  if (d.wings) for (const s of [-1, 1]) b.hline(cx + s * 6 - 1, cy - 5, 3, c.lite);
}

/** A boss — a bigger humanoid or beast with a heavier silhouette. */
function drawTitan(b, d) {
  const cx = (b.w / 2) | 0;
  const c = ramp(d.outfit || '#8a5f8f');
  const t = ramp(d.accent || '#ffd23f');
  const H = b.h;
  b.taper(cx - 10, H * 0.30, 20, 16, H * 0.45, c.base);        // torso
  b.ellipse(cx, H * 0.22, 7, 6, c.lite);                        // head
  b.hline(cx - 5, H * 0.14, 10, c.lite);
  const eyeC = d.eyes || '#ff3a5e';
  b.rect(cx - 4, H * 0.22, 3, 2, eyeC);
  b.rect(cx + 2, H * 0.22, 3, 2, eyeC);
  for (const s of [-1, 1]) {                                    // arms
    b.taper(cx + s * 12 - 2, H * 0.32, 5, 4, H * 0.34, c.dark);
  }
  for (const s of [-1, 1]) {                                    // legs
    b.rect(cx + (s < 0 ? -7 : 2), H * 0.74, 5, H * 0.24, c.dark);
  }
  if (d.ears === 'horns') {
    for (const s of [-1, 1]) {
      b.line(cx + s * 6, H * 0.15, cx + s * 9, H * 0.04, t.lite);
    }
  }
  if (d.cape) b.taper(cx - 12, H * 0.28, 24, 28, H * 0.5, shade(c.deep, -0.2));
  if (d.chest) b.ellipse(cx, H * 0.45, 3, 3, d.chest);
}

const BODIES = {
  humanoid: drawHumanoid,
  blob: drawBlob,
  ghost: drawGhost,
  beast: drawBeast,
  mech: drawMech,
  titan: drawTitan,
};

export const BODY_PLANS = Object.keys(BODIES);

/** Default grid size per body plan. */
const BODY_SIZE = {
  humanoid: [20, 26],
  blob: [16, 16],
  ghost: [18, 20],
  beast: [20, 20],
  mech: [18, 16],
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
  // bug; one pixel of vertical travel is enough to make it feel alive.
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

export { PixelBuf, OUTLINE, ramp };
