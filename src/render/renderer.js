// Narrow immediate-mode renderer. DECISIONS.md §35.3.
//
// The gameplay layer knows exactly these calls:
//     beginFrame / setCamera / drawSprite / drawRect / drawLine / drawArc /
//     drawText / drawGlyphs / endFrame
// and nothing about Canvas. Swapping in a WebGL/PixiJS backend later touches
// this file and its three siblings; zero gameplay files.
//
// HARD RULES INSIDE THE PER-ENTITY LOOP (drawSprite):
//   no beginPath, no fillText, no shadowBlur, no save()/restore(),
//   no filter, no gradient construction, no allocation.
// Everything expensive was already paid for in spriteAtlas at boot.

import { CONFIG } from '../core/config.js';
import { atlas, digits } from './spriteAtlas.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    // alpha:false lets the compositor skip a blend of the whole backbuffer.
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.dpr = 1;
    this.w = 0; this.h = 0;

    // camera state, resolved once per frame
    this.camX = 0; this.camY = 0; this.camScale = 1;
    this.halfW = 0; this.halfH = 0;
    this.cullMinX = 0; this.cullMaxX = 0; this.cullMinY = 0; this.cullMaxY = 0;

    // per-frame draw-state cache — avoids redundant context property writes,
    // which are surprisingly expensive in Canvas 2D
    this._alpha = 1;
    this._fill = '';
    this._stroke = '';
    this._lineW = -1;
    this._font = '';
    this._align = '';
    this._baseline = '';
    this._comp = 'source-over';

    this.stats = { sprites: 0, culled: 0, rects: 0, texts: 0, arcs: 0 };
  }

  resize(cssW, cssH, dpr) {
    this.dpr = Math.min(dpr || 1, CONFIG.MAX_DPR);
    this.w = cssW; this.h = cssH;
    this.canvas.width = Math.max(1, Math.round(cssW * this.dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * this.dpr));
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    // OFF. Every entity is pixel art; smoothing turns a 20px sprite scaled to
    // 44px into a soft blur and the whole game stops reading as a sprite game.
    this.ctx.imageSmoothingEnabled = false;
  }

  // --- frame -----------------------------------------------------------------
  beginFrame(clearColor) {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._alpha = 1; c.globalAlpha = 1;
    this._comp = 'source-over'; c.globalCompositeOperation = 'source-over';
    this._fill = clearColor || '#05060d';
    c.fillStyle = this._fill;
    c.fillRect(0, 0, this.w, this.h);
    this.stats.sprites = 0; this.stats.culled = 0;
    this.stats.rects = 0; this.stats.texts = 0; this.stats.arcs = 0;
  }

  /**
   * Bake the camera into the transform ONCE per frame, then feed world
   * coordinates straight into drawImage. No per-entity translate/rotate.
   */
  setCamera(cx, cy, scale) {
    this.camX = cx; this.camY = cy; this.camScale = scale;
    const c = this.ctx;
    // world -> screen:  s = (world - camera) * scale + viewport/2
    // The camera translation is baked into the matrix's e/f terms. Omitting it
    // draws every entity at its raw world coordinate — for a 4000x4000 arena
    // that is thousands of pixels off-screen, with no error and no warning.
    const k = this.dpr * scale;
    c.setTransform(k, 0, 0, k,
                   this.dpr * this.w / 2 - cx * k,
                   this.dpr * this.h / 2 - cy * k);
    this.halfW = this.w / (2 * scale);
    this.halfH = this.h / (2 * scale);
    // Cull box in world space, with a generous margin for large sprites.
    const m = 96;
    this.cullMinX = cx - this.halfW - m; this.cullMaxX = cx + this.halfW + m;
    this.cullMinY = cy - this.halfH - m; this.cullMaxY = cy + this.halfH + m;
  }

  /** Reset to screen space for HUD/UI. */
  setScreenSpace() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  endFrame() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._alpha = 1;
  }

  // --- state (cached) --------------------------------------------------------
  setAlpha(a) {
    if (a !== this._alpha) { this._alpha = a; this.ctx.globalAlpha = a; }
  }
  setFill(color) {
    if (color !== this._fill) { this._fill = color; this.ctx.fillStyle = color; }
  }
  setStroke(color, width) {
    if (color !== this._stroke) { this._stroke = color; this.ctx.strokeStyle = color; }
    if (width !== undefined && width !== this._lineW) { this._lineW = width; this.ctx.lineWidth = width; }
  }
  setComposite(mode) {
    if (mode !== this._comp) { this._comp = mode; this.ctx.globalCompositeOperation = mode; }
  }

  // --- the hot path ----------------------------------------------------------
  /**
   * The one call the per-entity loop makes. `sprite` is an atlas Sprite.
   *
   * Rotation comes from the atlas (32 pre-rastered steps) rather than a
   * ctx.rotate, so this never touches the transform stack. `scale` and `flash`
   * are the only per-draw variation.
   *
   * @param sprite atlas Sprite
   * @param x,y    world position (sprite centre)
   * @param rot    radians; snapped to an atlas step
   * @param scale  1 = the size it was rastered at
   * @param alpha  0..1
   * @param flash  true -> the pre-rastered white silhouette
   * @param anim   animation frame index for sheet-backed sprites
   */
  drawSprite(sprite, x, y, rot, scale, alpha, flash, anim) {
    if (x < this.cullMinX || x > this.cullMaxX || y < this.cullMinY || y > this.cullMaxY) {
      this.stats.culled++;
      return;
    }
    const img = flash ? sprite.flashAt(rot || 0, anim || 0) : sprite.frameAt(rot || 0, anim || 0);
    if (!img) return;
    const s = scale === undefined ? 1 : scale;
    const w = sprite.w * s, h = sprite.h * s;
    if (alpha !== undefined && alpha !== this._alpha) { this._alpha = alpha; this.ctx.globalAlpha = alpha; }
    // (v + 0.5) | 0 rounding at draw time keeps sprites off half-pixels, which is
    // the difference between crisp and mushy at integer zooms.
    this.ctx.drawImage(img, ((x - w * 0.5) * 8 + 0.5 | 0) / 8, ((y - h * 0.5) * 8 + 0.5 | 0) / 8, w, h);
    this.stats.sprites++;
  }

  /** Same, but with an explicit rotation for sprites the atlas did not pre-rotate. */
  drawSpriteRotated(sprite, x, y, rot, scale, alpha, flash) {
    if (x < this.cullMinX || x > this.cullMaxX || y < this.cullMinY || y > this.cullMaxY) { this.stats.culled++; return; }
    const img = flash ? sprite.flashAt(0, 0) : sprite.frameAt(0, 0);
    if (!img) return;
    const c = this.ctx;
    const s = scale === undefined ? 1 : scale;
    if (alpha !== undefined && alpha !== this._alpha) { this._alpha = alpha; c.globalAlpha = alpha; }
    c.translate(x, y);
    c.rotate(rot);
    c.drawImage(img, -sprite.w * s * 0.5, -sprite.h * s * 0.5, sprite.w * s, sprite.h * s);
    c.rotate(-rot);
    c.translate(-x, -y);
    this.stats.sprites++;
  }

  // --- primitives (UI, telegraphs, hazards — NOT the entity loop) ------------
  drawRect(x, y, w, h, color, alpha) {
    this.setAlpha(alpha === undefined ? 1 : alpha);
    this.setFill(color);
    this.ctx.fillRect(x, y, w, h);
    this.stats.rects++;
  }

  strokeRect(x, y, w, h, color, width, alpha) {
    this.setAlpha(alpha === undefined ? 1 : alpha);
    this.setStroke(color, width);
    this.ctx.strokeRect(x, y, w, h);
    this.stats.rects++;
  }

  drawRoundRect(x, y, w, h, r, color, alpha) {
    const c = this.ctx;
    this.setAlpha(alpha === undefined ? 1 : alpha);
    this.setFill(color);
    c.beginPath();
    const rr = Math.min(r, w / 2, h / 2);
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
    c.fill();
    this.stats.rects++;
  }

  drawCircle(x, y, r, color, alpha) {
    const c = this.ctx;
    this.setAlpha(alpha === undefined ? 1 : alpha);
    this.setFill(color);
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    this.stats.arcs++;
  }

  strokeCircle(x, y, r, color, width, alpha) {
    const c = this.ctx;
    this.setAlpha(alpha === undefined ? 1 : alpha);
    this.setStroke(color, width);
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.stroke();
    this.stats.arcs++;
  }

  drawArc(x, y, r, a0, a1, color, width, alpha) {
    const c = this.ctx;
    this.setAlpha(alpha === undefined ? 1 : alpha);
    this.setStroke(color, width);
    c.beginPath();
    c.arc(x, y, r, a0, a1);
    c.stroke();
    this.stats.arcs++;
  }

  /** Filled pie wedge — melee arcs and radial cooldown sweeps. */
  drawWedge(x, y, r, a0, a1, color, alpha) {
    const c = this.ctx;
    this.setAlpha(alpha === undefined ? 1 : alpha);
    this.setFill(color);
    c.beginPath();
    c.moveTo(x, y);
    c.arc(x, y, r, a0, a1);
    c.closePath();
    c.fill();
    this.stats.arcs++;
  }

  drawLine(x0, y0, x1, y1, color, width, alpha) {
    const c = this.ctx;
    this.setAlpha(alpha === undefined ? 1 : alpha);
    this.setStroke(color, width);
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
  }

  /** A thick beam with soft ends — railguns, Kamehameha, breath cones. */
  drawBeam(x0, y0, x1, y1, width, color, alpha) {
    const c = this.ctx;
    this.setAlpha(alpha === undefined ? 1 : alpha);
    this.setStroke(color, width);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
    c.lineCap = 'butt';
    this._lineW = width;
  }

  // --- text ------------------------------------------------------------------
  /** UI text. Never call this per entity — use drawGlyphs for damage numbers. */
  drawText(str, x, y, opts) {
    const o = opts || EMPTY;
    const c = this.ctx;
    const size = o.size || 16;
    const weight = o.weight || 600;
    const font = `${weight} ${size}px ${o.family || UI_FONT}`;
    if (font !== this._font) { this._font = font; c.font = font; }
    const align = o.align || 'left';
    if (align !== this._align) { this._align = align; c.textAlign = align; }
    const baseline = o.baseline || 'alphabetic';
    if (baseline !== this._baseline) { this._baseline = baseline; c.textBaseline = baseline; }
    this.setAlpha(o.alpha === undefined ? 1 : o.alpha);
    if (o.outline) {
      this.setStroke(o.outlineColor || 'rgba(4,6,14,0.9)', o.outlineWidth || Math.max(2, size * 0.18));
      c.lineJoin = 'round';
      c.strokeText(str, x, y);
    }
    // `o.fill` is a CanvasGradient or CanvasPattern the CALLER built and cached.
    // The draw-state cache compares by identity, which works for objects exactly
    // as well as it does for colour strings — so handing the same gradient in on
    // every frame costs one comparison and no context write. Nothing in here may
    // BUILD one: gradients are allocations, and the callers that want them (the
    // wordmark, the hub's hero plate) rebuild theirs only on a resize.
    this.setFill(o.fill || o.color || '#e8ecf5');
    c.fillText(str, x, y);
    this.stats.texts++;
  }

  measureText(str, size, weight, family) {
    const c = this.ctx;
    const font = `${weight || 600} ${size || 16}px ${family || UI_FONT}`;
    if (font !== this._font) { this._font = font; c.font = font; }
    return c.measureText(str).width;
  }

  /**
   * Blit a pre-rastered glyph run. This is how damage numbers are drawn — 60 of
   * them, every frame, with zero text shaping.
   * @param str the string (digits, +, -, !, x, %, K, M, .)
   * @param set a DigitAtlas set from digits.get(...)
   */
  drawGlyphs(str, x, y, set, scale, alpha, centered) {
    const c = this.ctx;
    if (alpha !== undefined && alpha !== this._alpha) { this._alpha = alpha; c.globalAlpha = alpha; }
    let total = 0;
    for (let i = 0; i < str.length; i++) {
      const g = set.glyphs.get(str[i]);
      if (g) total += g.width * scale * 0.72;
    }
    let px = centered ? x - total / 2 : x;
    const py = y - set.h * scale * 0.5;
    for (let i = 0; i < str.length; i++) {
      const g = set.glyphs.get(str[i]);
      if (!g) continue;
      const w = g.width * scale, h = g.height * scale;
      c.drawImage(g, px - (g.width * scale - g.width * scale * 0.72) * 0.5, py, w, h);
      px += g.width * scale * 0.72;
    }
  }

  /** Full-screen tint. Used for special-ability colour grades and vignettes. */
  overlay(color, alpha, composite) {
    this.setScreenSpace();
    if (composite) this.setComposite(composite);
    this.setAlpha(alpha);
    this.setFill(color);
    this.ctx.fillRect(0, 0, this.w, this.h);
    if (composite) this.setComposite('source-over');
    this.setAlpha(1);
  }

  /** A radial vignette. Built once per colour and cached — never per frame. */
  vignette(color, strength) {
    if (strength <= 0.001) return;
    const key = color + '|' + this.w + 'x' + this.h;
    let g = this._vigCache && this._vigCache.key === key ? this._vigCache.g : null;
    if (!g) {
      const c = this.ctx;
      const r = Math.hypot(this.w, this.h) * 0.5;
      g = c.createRadialGradient(this.w / 2, this.h / 2, r * 0.42, this.w / 2, this.h / 2, r);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, color);
      this._vigCache = { key, g };
    }
    this.setScreenSpace();
    this.setAlpha(strength);
    this.ctx.fillStyle = g;
    this._fill = '';
    this.ctx.fillRect(0, 0, this.w, this.h);
    this.setAlpha(1);
  }

  clipRect(x, y, w, h) {
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
  }
  unclip() { this.ctx.restore(); this._fill = ''; this._stroke = ''; this._font = ''; this._alpha = this.ctx.globalAlpha; }
}

const EMPTY = {};

// TYPOGRAPHY. THREE FACES, ZERO DOWNLOADS.
//
// SECTION 1 is absolute about this: no build step, no dependencies, and the
// "no network requests" test greps every source file and index.html for a
// remote font. That rules out the obvious answer (a webfont) and it also rules
// out the clever one (a base64 @font-face), because a display face embedded as
// a data: URI is 40-90KB of unreadable payload sitting in a repository that
// otherwise has none — a dependency in everything but name, and one nobody can
// diff. So the game buys its typography from fonts the machine already has.
//
// The whole complaint about the old screen was that it "reads as a settings
// dialog", and the reason is that it had ONE face at ONE weight everywhere.
// Two faces fixes most of that on its own, so:
//
//   DISPLAY_FONT — a CONDENSED grotesque for titles, wordmarks and card labels.
//     Bahnschrift is the anchor: it ships with Windows 10 and 11, it is a real
//     DIN, and condensed-heavy-uppercase is the register this genre's menus are
//     actually written in. macOS answers with DIN Alternate / Avenir Next
//     Condensed, Android and most Linux desktops with Roboto Condensed, and the
//     tail (Franklin Gothic Medium, Arial Narrow) is present essentially
//     everywhere else. Every entry is condensed or semi-condensed, so the face
//     may change from machine to machine but the VOICE does not.
//
//   UI_FONT — a humanist UI grotesque for body copy. Note "Segoe UI Variable
//     TEXT", not Display: Windows 11 ships optical sizes and the Display cut is
//     tightly spaced for headlines, which is precisely wrong for the 12px
//     subtitles that carry most of this game's information.
//
//   MONO_FONT — tabular figures for counters, keycaps and stat tables.
//
// A face swap can only ever make text NARROWER here (every display fallback is
// condensed relative to the UI stack, and fitSize/ellipsize measure in the UI
// stack), so a title that fitted its box before still fits it.
export const DISPLAY_FONT = 'Bahnschrift,"DIN Alternate","Avenir Next Condensed","Roboto Condensed","Segoe UI Variable Display","Franklin Gothic Medium","Arial Narrow",system-ui,sans-serif';
export const UI_FONT = '"Segoe UI Variable Text","Segoe UI",Inter,"SF Pro Text",system-ui,-apple-system,"Helvetica Neue",Arial,"Noto Sans",sans-serif';
export const MONO_FONT = 'ui-monospace,"Cascadia Mono","JetBrains Mono","IBM Plex Mono",Consolas,"SF Mono",Menlo,monospace';

/** Set by main.js once the canvas exists. */
export let renderer = null;
export function initRenderer(canvas) {
  renderer = new Renderer(canvas);
  return renderer;
}
