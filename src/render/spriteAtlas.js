// The renderer's ONLY source of pixels. DECISIONS.md §35.
//
// Everything — every shape variant, every emoji, every rotation step, every
// white-flash variant — is rasterised to an offscreen canvas at boot. The
// per-entity draw loop then calls nothing but `drawImage`.
//
// This is not an optimisation to add later. `fillText('🧟')` per entity per
// frame is among the most expensive Canvas 2D operations there is; the naive
// reading of "emoji + procedurally drawn shapes" walls at 300-800 entities
// against a 2,000-entity target. Pre-rastering also makes the real-art drop-in
// a genuine no-op: point `sheet` at a PNG and nothing else changes.
//
// DROP-IN PATH FOR REAL ART
// -------------------------
//   visual: { sheet: 'art/enemies/oni.png', frames: 4, size: 40 }
// `register()` loads the image, slices it into `frames` columns, and produces
// exactly the same Sprite object a procedural shape produces. Gameplay code
// never learns the difference.

import { CONFIG } from '../core/config.js';
import { TAU, shade, withAlpha } from '../core/math.js';
import { buildPixelSprite, buildFlashFrames } from './pixelArt.js';

/**
 * Blow a small pixel grid up to a target size with NEAREST-NEIGHBOUR sampling.
 * `imageSmoothingEnabled = false` is the whole point: with smoothing on, a 20px
 * sprite scaled to 44px is a soft blur, and the game stops looking like a
 * sprite game.
 */
function upscale(src, w, h) {
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (ctx.mozImageSmoothingEnabled !== undefined) ctx.mozImageSmoothingEnabled = false;
  if (ctx.webkitImageSmoothingEnabled !== undefined) ctx.webkitImageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, w, h);
  return cv;
}

/** One rasterised visual. `frames[i]` is a canvas; `flash[i]` its white twin. */
class Sprite {
  constructor(key, w, h, cx, cy) {
    this.key = key;
    this.w = w; this.h = h;
    this.cx = cx; this.cy = cy;   // pivot, in pixels from the top-left
    this.frames = [];
    this.flash = [];
    this.rotSteps = 1;
    this.animFrames = 1;
    /**
     * The draw scale at which this sprite renders at its DECLARED size.
     *
     * Pixel sprites are rastered at a whole-number upscale of their little
     * grid, and `Math.round` makes that a lottery: at `size` 16 a 26-row grid
     * lands on 2x and a 34-row grid on 1x, so growing the art grid by 57% used
     * to make the sprite on screen 35% SMALLER. Two characters with the same
     * declared size could differ by a factor of two for no reason a designer
     * could see. Multiplying a gameplay scale by this cancels the rounding out.
     */
    this.unit = 1;
  }
  /** Canvas for a given rotation (radians) and animation frame. */
  frameAt(rot, animIndex) {
    let i = 0;
    if (this.rotSteps > 1) {
      i = ((rot % TAU) + TAU) % TAU / TAU * this.rotSteps;
      i = (i + 0.5) | 0;
      if (i >= this.rotSteps) i = 0;
    }
    if (this.animFrames > 1) i = i * this.animFrames + (animIndex % this.animFrames);
    return this.frames[i] || this.frames[0];
  }
  flashAt(rot, animIndex) {
    let i = 0;
    if (this.rotSteps > 1) {
      i = ((rot % TAU) + TAU) % TAU / TAU * this.rotSteps;
      i = (i + 0.5) | 0;
      if (i >= this.rotSteps) i = 0;
    }
    if (this.animFrames > 1) i = i * this.animFrames + (animIndex % this.animFrames);
    return this.flash[i] || this.flash[0] || this.frames[0];
  }
}

function makeCanvas(w, h) {
  // A REAL canvas element first, OffscreenCanvas only as a fallback.
  //
  // OffscreenCanvas resolves fonts against a different context than the
  // document, and colour-emoji support there is inconsistent across browsers —
  // the glyph silently rasterises to nothing. Since every entity in this game
  // is an emoji composited over a shape, that failure mode is "the game has no
  // character sprites", with no error anywhere. A document canvas is ~identical
  // in cost at boot and gets the same font stack the page has.
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w); c.height = Math.max(1, h);
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    try { return new OffscreenCanvas(Math.max(1, w), Math.max(1, h)); } catch (e) { /* fall through */ }
  }
  // Headless: a stub that satisfies the API without drawing anything.
  return {
    width: Math.max(1, w), height: Math.max(1, h),
    getContext: () => STUB_CTX,
  };
}

const STUB_CTX = new Proxy({}, {
  get(_, prop) {
    if (prop === 'canvas') return { width: 1, height: 1 };
    if (prop === 'measureText') return () => ({ width: 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
    if (prop === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
      return () => ({ addColorStop() {} });
    }
    return () => {};
  },
  set() { return true; },
});

// --- shape painters ----------------------------------------------------------
// Each paints centred at (cx, cy) with radius r into a 2D context.
const SHAPES = {
  circle(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.closePath();
  },
  capsule(ctx, cx, cy, r) {
    const h = r * 0.75;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.62, cy - h);
    ctx.arcTo(cx + r * 0.62, cy - h, cx + r * 0.62, cy + h, r * 0.62);
    ctx.arcTo(cx + r * 0.62, cy + h, cx - r * 0.62, cy + h, r * 0.62);
    ctx.arcTo(cx - r * 0.62, cy + h, cx - r * 0.62, cy - h, r * 0.62);
    ctx.arcTo(cx - r * 0.62, cy - h, cx + r * 0.62, cy - h, r * 0.62);
    ctx.closePath();
  },
  diamond(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.78, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r * 0.78, cy);
    ctx.closePath();
  },
  square(ctx, cx, cy, r) {
    const s = r * 0.86;
    ctx.beginPath();
    ctx.rect(cx - s, cy - s, s * 2, s * 2);
    ctx.closePath();
  },
  star(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rr = i % 2 === 0 ? r : r * 0.44;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  },
  triangle(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx + r, cy);
    ctx.lineTo(cx - r * 0.7, cy - r * 0.82);
    ctx.lineTo(cx - r * 0.7, cy + r * 0.82);
    ctx.closePath();
  },
  hex(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  },
  cross(ctx, cx, cy, r) {
    const t = r * 0.36;
    ctx.beginPath();
    ctx.rect(cx - t, cy - r, t * 2, r * 2);
    ctx.rect(cx - r, cy - t, r * 2, t * 2);
    ctx.closePath();
  },
  /** A tapered shard — the default projectile silhouette. Points +X. */
  shard(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx + r, cy);
    ctx.quadraticCurveTo(cx, cy - r * 0.5, cx - r, cy);
    ctx.quadraticCurveTo(cx, cy + r * 0.5, cx + r, cy);
    ctx.closePath();
  },
  /** A crescent slash arc. Points +X. */
  crescent(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx - r * 0.3, cy, r, -1.0, 1.0);
    ctx.quadraticCurveTo(cx + r * 0.15, cy, cx - r * 0.3 + Math.cos(-1.0) * r, cy + Math.sin(-1.0) * r);
    ctx.closePath();
  },
  ring(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.arc(cx, cy, r * 0.68, 0, TAU, true);
    ctx.closePath();
  },
};

/** Stable key for a visual descriptor. Boot-time only — allocates a string. */
export function visualKey(v) {
  if (!v) return 'circle|#ffffff||12|1||0';
  return [
    v.sheet || v.shape || 'circle',
    v.color || '#ffffff',
    v.accent || '',
    Math.round(v.size || 12),
    v.outline === false ? 0 : 1,
    v.emoji || '',
    v.rotates ? 1 : 0,
    v.glow ? 1 : 0,
    v.flash === false ? 0 : 1,
  ].join('|');
}

class SpriteAtlas {
  constructor() {
    this.map = new Map();
    this.bytes = 0;
    this.count = 0;
    this.lazyMisses = 0;
    this.emojiSupported = true;
  }

  has(key) { return this.map.has(key); }
  get(key) { return this.map.get(key); }

  /**
   * Can this browser actually rasterise a colour emoji?
   *
   * Every entity is an emoji over a shape, so if the glyph draws nothing the
   * game appears to have no character sprites at all — with no error, no
   * warning, and a passing test suite. This draws one to an offscreen canvas
   * and reads the pixels back. Run once, at boot, before the prewarm pass.
   *
   * When it fails, emoji are dropped entirely and the procedural shapes carry
   * the read on their own (they are already colour-coded and outlined), which
   * is a legible game rather than a blank one.
   */
  probeEmoji() {
    if (this._emojiProbed) return this.emojiSupported;
    this._emojiProbed = true;
    try {
      const cv = makeCanvas(32, 32);
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, 32, 32);
      ctx.font = '24px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🦈', 16, 16);
      const d = ctx.getImageData(0, 0, 32, 32).data;
      let lit = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) lit++;
      // A rendered glyph covers a large fraction of a 32px box; a tofu box or
      // nothing at all covers almost none.
      this.emojiSupported = lit > 40;
    } catch (e) {
      this.emojiSupported = false;
    }
    if (!this.emojiSupported) {
      console.warn('[atlas] colour emoji did not rasterise; falling back to procedural shapes only');
    }
    return this.emojiSupported;
  }

  /**
   * Rasterise a visual descriptor. Idempotent — returns the cached Sprite if the
   * key already exists.
   *
   * @param {object} v {shape|sheet, color, accent, size, outline, emoji, rotates, glow, frames}
   */
  /**
   * Rasterise a PIXEL-ART sprite from a descriptor (see data/sprites.js).
   * `size` is the desired on-screen radius; the little grid is scaled to fit.
   */
  registerPixel(descriptor, size) {
    const key = 'px|' + (descriptor.id || descriptor.body) + '|' + Math.round(size);
    const hit = this.map.get(key);
    if (hit) return hit;

    const built = buildPixelSprite(descriptor, makeCanvas);
    const flashFrames = buildFlashFrames(descriptor, makeCanvas);

    // Scale the grid up by a WHOLE NUMBER. A sprite drawn at 2.37x is mush; at
    // 2x it still looks drawn. This is the difference between pixel art and a
    // blurry approximation of pixel art.
    //
    // 2.6 rather than 2.2: entities read slightly small on a 1080p screen, and
    // because the scale is rounded to an integer this is a genuine step up for
    // most sprites rather than a fractional nudge.
    const scale = Math.max(1, Math.round((size * 2.6) / built.h));
    const W = built.w * scale, H = built.h * scale;

    const sp = new Sprite(key, W, H, W / 2, H / 2);
    sp.rotSteps = 1;
    sp.animFrames = built.frames.length;
    sp.pixel = true;
    // The correction from the rounded raster back to `size * 2.6` — see the
    // Sprite constructor. Drawers multiply their gameplay scale by this, and the
    // integer upscale stops leaking into how big things look.
    sp.unit = (size * 2.6) / H;
    sp.grid = built.h;

    for (let i = 0; i < built.frames.length; i++) {
      sp.frames.push(upscale(built.frames[i], W, H));
      sp.flash.push(upscale(flashFrames[i], W, H));
    }

    this.map.set(key, sp);
    this.count++;
    this.bytes += W * H * 4 * built.frames.length * 2;
    return sp;
  }

  register(v) {
    // A visual carrying a `pixel` descriptor becomes a real sprite rather than a
    // shape. This is the hook that turns the game from geometry into art.
    if (v && v.pixel) {
      const sp = this.registerPixel(v.pixel, v.size || 14);
      // ALSO file it under its visualKey. registerPixel keys on
      // 'px|id|size', so `ensure()` — which only ever computes a visualKey —
      // could never hit for a character, enemy or boss: every single enemy
      // spawn allocated a joined key string, missed, and bumped `lazyMisses`,
      // which the perf harness asserts is zero.
      const vk = visualKey(v);
      if (!this.map.has(vk)) this.map.set(vk, sp);
      return sp;
    }

    const key = visualKey(v);
    const hit = this.map.get(key);
    if (hit) return hit;

    const size = Math.max(3, Math.round(v.size || 12));
    const outline = v.outline === false ? 0 : Math.max(1.5, size * 0.14);
    const glow = v.glow ? size * 0.5 : 0;
    const pad = Math.ceil(outline + glow + 2);
    const dim = (size + pad) * 2;

    // Rotation steps scale DOWN with sprite size, because memory scales up with
    // its square. 32 steps of a 96px boss is 32 x 200x200x4 x 2 (flash twin) =
    // ~10 MB for one entity — the whole atlas ballooned to 79 MB that way.
    // Large sprites are few and rotate slowly, so they take the runtime
    // ctx.rotate path (drawSpriteRotated) instead; small ones — projectiles,
    // which are the numerous, fast-spinning case — keep the full 32.
    const rotSteps = !v.rotates ? 1
      : size <= 14 ? CONFIG.ATLAS_ROTATION_STEPS
      : size <= 28 ? CONFIG.ATLAS_ROTATION_STEPS / 2
      : size <= 48 ? 8
      : 1;

    // The white-flash twin only exists for things that can be hit. Pickups,
    // gems, obstacles and particles never flash, and skipping their twin halves
    // their footprint for free.
    const wantFlash = v.flash !== false;

    const sp = new Sprite(key, dim, dim, dim / 2, dim / 2);
    sp.rotSteps = rotSteps;

    for (let i = 0; i < rotSteps; i++) {
      const rot = (i / rotSteps) * TAU;
      sp.frames.push(this._paint(v, dim, size, outline, glow, rot, false));
      if (wantFlash) sp.flash.push(this._paint(v, dim, size, outline, glow, rot, true));
    }

    this.map.set(key, sp);
    this.count++;
    this.bytes += dim * dim * 4 * rotSteps * (wantFlash ? 2 : 1);
    return sp;
  }

  /**
   * True when this sprite's rotation must be done at draw time rather than read
   * from a pre-rastered step. Callers that care about exact angles on large
   * sprites check this and use `drawSpriteRotated`.
   */
  needsRuntimeRotation(sprite) { return sprite.rotSteps === 1; }

  _paint(v, dim, size, outline, glow, rot, asFlash) {
    const cv = makeCanvas(dim, dim);
    const ctx = cv.getContext('2d');
    const cx = dim / 2, cy = dim / 2;

    if (rot) { ctx.translate(cx, cy); ctx.rotate(rot); ctx.translate(-cx, -cy); }

    const color = asFlash ? '#ffffff' : (v.color || '#ffffff');
    const accent = asFlash ? '#ffffff' : (v.accent || shade(v.color || '#ffffff', -0.45));

    if (glow > 0 && !asFlash) {
      const g = ctx.createRadialGradient(cx, cy, size * 0.4, cx, cy, size + glow);
      g.addColorStop(0, withAlpha(color, 0.55));
      g.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, dim, dim);
    }

    const painter = SHAPES[v.shape] || SHAPES.circle;
    painter(ctx, cx, cy, size);

    if (asFlash) {
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    } else {
      // A cheap two-stop vertical gradient reads as volume without any per-frame cost.
      const g = ctx.createLinearGradient(0, cy - size, 0, cy + size);
      g.addColorStop(0, shade(color, 0.24));
      g.addColorStop(1, shade(color, -0.16));
      ctx.fillStyle = g;
      ctx.fill();
      if (outline) {
        ctx.lineWidth = outline;
        ctx.strokeStyle = accent;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    }

    if (v.emoji && this.emojiSupported) {
      const fs = Math.round(size * 1.62);
      ctx.font = `${fs}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (asFlash) {
        // A white silhouette of the glyph: draw it, then punch the colour out.
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillText(v.emoji, cx, cy + fs * 0.04);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.fillText(v.emoji, cx, cy + fs * 0.04);
      }
    }

    if (asFlash) {
      // Force everything drawn to pure white while preserving alpha.
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, dim, dim);
      ctx.globalCompositeOperation = 'source-over';
    }

    return cv;
  }

  /**
   * Late registration. Legal, but a dev-mode warning: anything hit here was
   * missed by the boot pass and will cause a raster hitch mid-run.
   */
  ensure(v) {
    const key = visualKey(v);
    const hit = this.map.get(key);
    if (hit) return hit;
    this.lazyMisses++;
    return this.register(v);
  }

  /**
   * Real-art drop-in. Loads a sheet, slices it into `frames` columns, and
   * produces the same Sprite shape a procedural visual produces.
   * Missing files resolve to the procedural fallback — never a crash.
   */
  async registerSheet(v) {
    const key = visualKey(v);
    if (this.map.has(key)) return this.map.get(key);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = v.sheet;
      });
      const frames = Math.max(1, v.frames || 1);
      const fw = (img.width / frames) | 0, fh = img.height;
      const sp = new Sprite(key, fw, fh, fw / 2, fh / 2);
      sp.animFrames = frames;
      for (let f = 0; f < frames; f++) {
        const cv = makeCanvas(fw, fh);
        cv.getContext('2d').drawImage(img, f * fw, 0, fw, fh, 0, 0, fw, fh);
        sp.frames.push(cv);
        const fl = makeCanvas(fw, fh);
        const fc = fl.getContext('2d');
        fc.drawImage(cv, 0, 0);
        fc.globalCompositeOperation = 'source-atop';
        fc.fillStyle = '#ffffff';
        fc.fillRect(0, 0, fw, fh);
        sp.flash.push(fl);
      }
      this.map.set(key, sp);
      this.count++;
      return sp;
    } catch (e) {
      console.warn('[atlas] sheet missing, using procedural fallback:', v.sheet);
      const fallback = Object.assign({}, v);
      delete fallback.sheet;
      return this.register(fallback);
    }
  }

  /** Bulk pre-raster at boot. `visuals` is any iterable of visual descriptors. */
  prewarm(visuals, onProgress) {
    let i = 0;
    const total = visuals.length;
    for (const v of visuals) {
      if (v) this.register(v);
      if (onProgress && (++i % 24 === 0)) onProgress(i / total);
    }
    if (onProgress) onProgress(1);
  }

  stats() {
    return { sprites: this.count, mb: (this.bytes / 1048576).toFixed(1), lazyMisses: this.lazyMisses };
  }
}

export const atlas = new SpriteAtlas();
export { makeCanvas, SHAPES, Sprite };

// --- the bitmap digit atlas --------------------------------------------------
// Damage numbers are the highest-count text in the game (60 on screen, each
// changing every frame). `fillText` for those is a non-starter; digits are
// pre-rendered once per colour and blitted.

const DIGIT_GLYPHS = '0123456789+-!x%KM.';

export class DigitAtlas {
  constructor() {
    this.sets = new Map();  // colorKey -> { glyphs: Map<char, canvas>, h, spacing }
  }

  build(color, fontPx, bold = true) {
    const key = color + '|' + fontPx + '|' + (bold ? 1 : 0);
    if (this.sets.has(key)) return this.sets.get(key);

    const probe = makeCanvas(8, 8).getContext('2d');
    const font = `${bold ? '800 ' : ''}${fontPx}px "Segoe UI Variable Display","Segoe UI",Inter,system-ui,sans-serif`;
    probe.font = font;

    const glyphs = new Map();
    const pad = Math.ceil(fontPx * 0.28);
    const h = Math.ceil(fontPx * 1.35) + pad * 2;
    let spacing = 0;

    for (const ch of DIGIT_GLYPHS) {
      const w = Math.ceil(probe.measureText(ch).width) + pad * 2;
      const cv = makeCanvas(w, h);
      const ctx = cv.getContext('2d');
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // A hard dark stroke is what keeps numbers legible over a full screen of enemies.
      ctx.lineWidth = Math.max(2, fontPx * 0.22);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(4,6,14,0.92)';
      ctx.strokeText(ch, w / 2, h / 2);
      ctx.fillStyle = color;
      ctx.fillText(ch, w / 2, h / 2);
      glyphs.set(ch, cv);
      if (/[0-9]/.test(ch)) spacing = Math.max(spacing, w - pad * 1.5);
    }
    const set = { glyphs, h, spacing, pad };
    this.sets.set(key, set);
    return set;
  }

  get(color, fontPx, bold) {
    return this.sets.get(color + '|' + fontPx + '|' + (bold ? 1 : 0)) || this.build(color, fontPx, bold);
  }
}

export const digits = new DigitAtlas();
