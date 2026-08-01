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
     * How `frames` splits: [0, idleFrames) is the standing bob and everything
     * after it is the walk cycle. `walkFrames` is 0, 2 or 4 — always a power of
     * two, because `animIndexFor` picks a beat with a mask rather than a modulo
     * and it runs once per entity per frame with two thousand entities up.
     */
    this.idleFrames = 1;
    this.walkFrames = 0;
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

  /**
   * WHICH FRAME AN ENTITY IS ON — walking or standing. One compare, one
   * multiply-add-truncate, one mask.
   *
   * It lives on the Sprite rather than in each caller because the sprite is the
   * only thing that knows how many walk frames it was baked with, and because
   * three call sites (player, enemy, minion) would otherwise each carry their
   * own copy of the same off-by-one.
   *
   * IT TAKES A SQUARED SPEED, and that is not a micro-optimisation: this runs
   * once per entity per frame against a 2,000-entity target, and a Math.hypot
   * there is 2,000 square roots a frame for a number that is only ever compared
   * against a constant. The constant squares just as well as the speed does.
   *
   * The unit is PIXELS PER 60Hz TICK, squared, because the callers hand in
   * `x - px` rather than a velocity field. That is deliberate — `enemy.js`
   * maintains `e.vx` in `_moveToward` but the `ranged` behaviour's back-off
   * (enemy.js:640) and the ambusher's two teleports write `e.x` directly and
   * leave `e.vx` stale, so a strafing enemy would moonwalk. The interpolation
   * delta is exact for every movement path there is, including knockback, pull
   * and separation, and the draw loop has already computed it.
   *
   * `phase` is any per-entity constant. Without it a pack of forty spawned in
   * the same wave marches in perfect lockstep, which looks worse than no walk
   * cycle at all.
   */
  animIndexFor(time, step2, phase) {
    if (this.walkFrames > 1 && step2 > WALK_STEP2) {
      return this.idleFrames + ((((time * WALK_HZ + phase) | 0) & (this.walkFrames - 1)));
    }
    if (this.idleFrames < 2) return 0;
    return ((time * IDLE_HZ + phase) | 0) & 1;
  }
}

/** Standing bob rate, walk rate, and the step² above which a thing is walking. */
const IDLE_HZ = 4;
// 10Hz over a four-beat cycle is 2.5 strides a second, which is what a figure
// crossing an arena at 165 px/s actually does. Slower reads as wading.
const WALK_HZ = 10;
// 8 px/s — the same threshold player.js used for its fast bob — expressed as a
// per-tick displacement and squared: (8/60)^2 = 0.0178.
const WALK_STEP2 = 0.0178;

/**
 * The most atlas any ONE pixel sprite may spend, across all of its frames and
 * their flash twins.
 *
 * 1.5 MB is not arbitrary: it is the point at which trimming the raster upscale
 * pays for a walk cycle exactly. See registerPixel.
 */
const RASTER_BUDGET = 1.5 * 1048576;

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

/**
 * The three leaves off a carrot's shoulder, as subpaths on the CURRENT path.
 *
 * Shared by `SHAPES.carrot` and its overlay rather than written twice: the shape
 * needs them so the outline pass puts them in the silhouette, and the overlay
 * needs the identical geometry so it can fill exactly those pixels green. Two
 * copies of this would drift by a pixel and leave an orange rim on every leaf.
 */
function carrotFronds(ctx, cx, cy, r) {
  for (let i = -1; i <= 1; i++) {
    // Spread wide and run LONG — 0.8r, not half that. `register` strokes every
    // shape at `size * 0.14` centred on the boundary, so a leaf shorter than
    // about 0.6r arrives as pure outline with no green left inside it, and the
    // three of them merge into one dark blob on the back of the root.
    const a = Math.PI + i * 0.62;
    const bx = cx - r * 0.34, by = cy + i * r * 0.20;
    const tx = bx + Math.cos(a) * r * 0.80, ty = by + Math.sin(a) * r * 0.80;
    ctx.moveTo(bx, by - r * 0.17);
    ctx.lineTo(tx, ty);
    ctx.lineTo(bx, by + r * 0.17);
    ctx.closePath();
  }
}

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

  // --- props ----------------------------------------------------------------
  // The three below are PROPS rather than projectile silhouettes: they are meant
  // to be blitted large and rotated at runtime by `effects.sweepSprite` /
  // `effects.fallSprite`, so each one is authored to fit inside radius `r` (the
  // atlas canvas is only `(size + pad) * 2` across, and anything poking past `r`
  // is clipped the moment it turns).

  /**
   * A SCYTHE, laid along +X the way `shard` and `crescent` are.
   *
   * Two subpaths, exactly like `cross`: a haft running back to the butt, and a
   * crescent blade hooking forward off the neck. One closed shape has to carry
   * the whole read at 30px, and the read is "long stick, big hook" — so the hook
   * is oversized against the haft, which is the opposite of a real scythe and the
   * only reason the silhouette survives the outline pass at this size.
   */
  scythe(ctx, cx, cy, r) {
    const t = r * 0.095;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.84, cy + r * 0.46 - t);
    ctx.lineTo(cx + r * 0.24, cy - r * 0.28 - t);
    ctx.lineTo(cx + r * 0.24, cy - r * 0.28 + t);
    ctx.lineTo(cx - r * 0.84, cy + r * 0.46 + t);
    ctx.closePath();
    const bx = cx + r * 0.10, by = cy - r * 0.24, br = r * 0.70;
    const a0 = -1.45, a1 = 0.55;
    const sx = bx + Math.cos(a0) * br, sy = by + Math.sin(a0) * br;
    ctx.moveTo(sx, sy);
    ctx.arc(bx, by, br, a0, a1);
    ctx.quadraticCurveTo(bx + br * 0.20, by - br * 0.08, sx, sy);
    ctx.closePath();
  },

  /** A thrown saucer: a disc seen at a shallow angle. Long axis is +X. */
  saucer(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.46, 0, 0, TAU);
    ctx.closePath();
  },

  /** A lighting-rig truss section — two chords and an X brace. Lies along +X. */
  girder(ctx, cx, cy, r) {
    const L = r * 0.92, h = r * 0.34, t = r * 0.11;
    ctx.beginPath();
    ctx.rect(cx - L, cy - h, L * 2, t);
    ctx.rect(cx - L, cy + h - t, L * 2, t);
    ctx.moveTo(cx - L * 0.88, cy - h + t);
    ctx.lineTo(cx - L * 0.58, cy - h + t);
    ctx.lineTo(cx + L * 0.04, cy + h - t);
    ctx.lineTo(cx - L * 0.26, cy + h - t);
    ctx.closePath();
    ctx.moveTo(cx + L * 0.26, cy - h + t);
    ctx.lineTo(cx + L * 0.56, cy - h + t);
    ctx.lineTo(cx - L * 0.06, cy + h - t);
    ctx.lineTo(cx - L * 0.36, cy + h - t);
    ctx.closePath();
  },

  /**
   * TWO INTERLOCKING CHAIN LINKS, laid end to end along +X.
   *
   * THE UNIT OF A CHAIN IS A PAIR, NOT A LINK, and that is the whole trick. A
   * real chain alternates — one link lying flat, the next rolled a quarter turn
   * and seen on its edge — and it is that alternation, not the ring shape, that
   * stops a row of ovals reading as beads on a string. A pair authored
   * [face, edge] and repeated gives face, edge, face, edge across pair
   * boundaries for free, so a whole chain costs one sprite and one blit per
   * pair rather than two of each.
   *
   * Both links are the same LENGTH along the chain and differ only ACROSS it,
   * which is what "the same ring, rolled" actually looks like. They overlap by
   * about a fifth of a link in the middle, so the pair is joined metal rather
   * than two ovals that happen to be adjacent — and because the atlas strokes
   * the whole path with the accent, both outlines are drawn through the overlap,
   * which is exactly how you draw two rings passing through each other.
   *
   * THE PROPORTIONS ARE SET BY THE OUTLINE, NOT BY WHAT A LINK LOOKS LIKE.
   * `register` strokes every shape at `size * 0.14`, centred on the boundary, so
   * a band of metal costs 0.14r of stroke before ANY of it is fill: a ring whose
   * wall is 0.20r wide arrives with 0.06r of colour in it and reads as a smudge.
   * The face-on ring's wall is therefore 0.26r, which survives with 0.12r of
   * metal showing, and the edge-on link is drawn SOLID — no hole at all. That is
   * not a compromise, it is what an edge-on link actually is: you are looking at
   * the rim of the wire, and there is nothing to see through.
   *
   * The face ring is an outer ellipse with a REVERSE-WOUND inner ellipse punched
   * out of it — the same nonzero-winding hole `ring` uses. Every subpath opens
   * with an explicit moveTo to its own start point so `ellipse` never draws a
   * connecting hairline in from the previous subpath (`ring` does; at 26px
   * nobody ever noticed, and at chain sizes they would).
   *
   * THE SPAN IS EXACTLY +/- r ALONG X. Callers size a pair by dividing the world
   * length they want by `2 * size` — see CHAIN_SCALE_PER_PX in weaponImpls.js.
   * Changing the 0.46 / 0.54 pair below without keeping that true silently
   * changes how long every chain in the game is.
   */
  chain(ctx, cx, cy, r) {
    const ax = cx - r * 0.46, bx = cx + r * 0.46;
    const half = r * 0.54;
    ctx.beginPath();
    // FACE-ON: the fat ring, with a hole you can see the stage through.
    ctx.moveTo(ax + half, cy);
    ctx.ellipse(ax, cy, half, r * 0.46, 0, 0, TAU);
    ctx.moveTo(ax + half - r * 0.26, cy);
    ctx.ellipse(ax, cy, half - r * 0.26, r * 0.20, 0, 0, TAU, true);
    // EDGE-ON: the same link rolled a quarter turn. Same length, a third of the
    // height, and solid — a link seen on its edge has no hole facing you.
    ctx.moveTo(bx + half, cy);
    ctx.ellipse(bx, cy, half, r * 0.17, 0, 0, TAU);
    ctx.closePath();
  },

  /**
   * A STONE FOUNTAIN, seen from above: an outer basin, a rim, and a pedestal
   * with a spout bowl on it.
   *
   * Obstacle sprites are drawn with `rot = 0` always (obstacles.js) and scaled by
   * `r / 32`, so this is authored UPRIGHT and top-down rather than pointing +X
   * like a projectile. The rim is 0.30r wide, not the 0.18 that looks right on
   * paper: the atlas strokes at `size * 0.14` centred on the boundary, so a
   * thinner ring arrives as pure outline with no stone left in it.
   */
  fountain(ctx, cx, cy, r) {
    // A SCALLOPED basin rim, not a plain circle. The first pass was three
    // concentric arcs, and three concentric arcs at 64px with a 4.5px outline on
    // each is a blur — every edge in it was a soft curve of the same weight, so
    // there was nothing for the eye to catch. Twelve scallops give the outer
    // wall a hard, repeating silhouette that survives the outline pass, and the
    // straight-edged inner ring under it gives the shape a second, DIFFERENT
    // rhythm so the two rings cannot merge into one grey doughnut.
    ctx.beginPath();
    const N = 12;
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * TAU;
      const rr = r * (k & 1 ? 0.90 : 1.0);
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    // ...punched out to a rim of real thickness. 0.72 leaves 0.28r of stone,
    // which is just over the 0.26r the atlas's own stroke needs to survive.
    ctx.moveTo(cx + r * 0.72, cy);
    ctx.arc(cx, cy, r * 0.72, 0, TAU, true);
    // The pedestal, as an OCTAGON. A circle inside a circle inside a circle is
    // the thing that read as blurry; a flat-sided plinth is instantly masonry.
    ctx.moveTo(cx + r * 0.44, cy);
    for (let k = 1; k <= 8; k++) {
      const a = (k / 8) * TAU;
      ctx.lineTo(cx + Math.cos(a) * r * 0.44, cy + Math.sin(a) * r * 0.44);
    }
    ctx.closePath();
    ctx.moveTo(cx + r * 0.28, cy);
    ctx.arc(cx, cy, r * 0.28, 0, TAU, true);
    ctx.moveTo(cx + r * 0.15, cy);
    ctx.arc(cx, cy, r * 0.15, 0, TAU);                // the spout
    ctx.closePath();
  },

  /**
   * A CHERRY TREE FROM ABOVE — the canopy, in blossom.
   *
   * The stage is named for these and did not have one. It has to separate from
   * `hedge` at a glance and from more than the colour: a hedge is CLIPPED, so
   * its outline is a shallow, regular scallop, and this is not clipped at all.
   * Five overlapping lobes of different sizes on a fixed pattern give it a
   * lumpy, asymmetric crown, and the trunk shows as a hole punched through the
   * middle — which is the one cue that says "seen from above" rather than
   * "a pink bush".
   */
  sakura(ctx, cx, cy, r) {
    // ONE CONTINUOUS OUTLINE, not a pile of overlapping circles.
    //
    // The first draft was six arcs in one path and it came back looking like a
    // cut flower: `stroke()` strokes EVERY subpath, including the parts buried
    // inside the union, so each lobe drew its own full dark ring through the
    // middle of its neighbours. Anything built out of overlapping subpaths has
    // to be a shape the outline can trace in one go — which is exactly why
    // `hedge` above is a single closed curve and not eleven circles.
    //
    // So: a radius function. Five big lobes, an irregular second harmonic on top
    // so no two are the same size, and a fixed phase — an obstacle that is a
    // different shape on a replay of the same seed is an obstacle that spent the
    // run stream on being pretty.
    const N = 44;
    ctx.beginPath();
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * TAU;
      const rr = r * (0.80 + 0.16 * Math.cos(a * 5 + 0.6) + 0.06 * Math.cos(a * 3 - 1.7));
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    // The trunk, reverse-wound so it is a hole rather than a disc — and a hole
    // is the one cue that says "canopy seen from above" and not "pink bush".
    ctx.moveTo(cx + r * 0.14, cy);
    ctx.arc(cx, cy, r * 0.14, 0, TAU, true);
    ctx.closePath();
  },

  /**
   * A CLIPPED HEDGE, top-down: a rounded mass with a bitten outline.
   *
   * A circle would read as a boulder and a rectangle as a wall. What says
   * "planted, and somebody trims it" is that the silhouette is *nearly* round
   * and then interrupted — eight lobes on a fixed pattern, so it is a shrub
   * rather than a cog, and fixed rather than rolled because an obstacle that is
   * a different shape on a replay of the same seed is an obstacle that spent the
   * run stream on being pretty.
   */
  hedge(ctx, cx, cy, r) {
    ctx.beginPath();
    const N = 11;
    const bump = [1.0, 0.84, 0.97, 0.80, 1.0, 0.87, 0.93, 0.79, 1.0, 0.86, 0.95];
    for (let i = 0; i < N; i++) {
      const a = i * TAU / N;
      const rr = r * bump[i];
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else {
        const am = a - TAU / N * 0.5;
        const rm = r * 1.03;
        ctx.quadraticCurveTo(cx + Math.cos(am) * rm, cy + Math.sin(am) * rm, x, y);
      }
    }
    ctx.closePath();
  },

  /**
   * A DAGGER. Points +X: blade, then a crossguard, a grip and a pommel.
   *
   * `shard` was standing in for this and a shard is a projectile silhouette —
   * a leaf. What makes a dagger a dagger at nine pixels is not the blade, it is
   * the CROSSGUARD: one hard notch three quarters of the way down that breaks
   * the taper. Everything here exists to keep that notch legible after the
   * atlas's `size * 0.14` outline has eaten into both sides of it, which is why
   * the guard is 0.44r deep against a blade that is only 0.30r.
   */
  dagger(ctx, cx, cy, r) {
    ctx.beginPath();
    // the blade — a long triangle with a slight belly, tip at +X
    ctx.moveTo(cx + r, cy);
    ctx.lineTo(cx - r * 0.04, cy - r * 0.30);
    ctx.lineTo(cx - r * 0.20, cy - r * 0.24);
    ctx.lineTo(cx - r * 0.20, cy + r * 0.24);
    ctx.lineTo(cx - r * 0.04, cy + r * 0.30);
    ctx.closePath();
    // the crossguard — the one hard horizontal in the whole shape
    ctx.moveTo(cx - r * 0.32, cy - r * 0.44);
    ctx.lineTo(cx - r * 0.18, cy - r * 0.44);
    ctx.lineTo(cx - r * 0.18, cy + r * 0.44);
    ctx.lineTo(cx - r * 0.32, cy + r * 0.44);
    ctx.closePath();
    // the grip
    ctx.moveTo(cx - r * 0.78, cy - r * 0.15);
    ctx.lineTo(cx - r * 0.32, cy - r * 0.15);
    ctx.lineTo(cx - r * 0.32, cy + r * 0.15);
    ctx.lineTo(cx - r * 0.78, cy + r * 0.15);
    ctx.closePath();
    // the pommel
    ctx.moveTo(cx - r * 0.78, cy - r * 0.27);
    ctx.lineTo(cx - r * 0.94, cy - r * 0.20);
    ctx.lineTo(cx - r * 0.94, cy + r * 0.20);
    ctx.lineTo(cx - r * 0.78, cy + r * 0.27);
    ctx.closePath();
  },

  /**
   * A ROCKET. Points +X: nose cone, body, two fins and a flared skirt.
   *
   * `triangle` was standing in for this, which is a dart. A rocket needs THREE
   * things and a triangle has none of them — a blunt body that does not taper,
   * fins that break the silhouette outward at the back, and a nozzle that is
   * wider than the body it hangs off. The fins are drawn as part of the same
   * path so the outline wraps them into the shape.
   */
  rocket(ctx, cx, cy, r) {
    ctx.beginPath();
    // nose cone into a parallel body
    ctx.moveTo(cx + r, cy);
    ctx.lineTo(cx + r * 0.34, cy - r * 0.30);
    ctx.lineTo(cx - r * 0.52, cy - r * 0.30);
    ctx.lineTo(cx - r * 0.52, cy + r * 0.30);
    ctx.lineTo(cx + r * 0.34, cy + r * 0.30);
    ctx.closePath();
    // two fins, swept back off the body
    ctx.moveTo(cx - r * 0.16, cy - r * 0.30);
    ctx.lineTo(cx - r * 0.34, cy - r * 0.66);
    ctx.lineTo(cx - r * 0.60, cy - r * 0.62);
    ctx.lineTo(cx - r * 0.46, cy - r * 0.30);
    ctx.closePath();
    ctx.moveTo(cx - r * 0.16, cy + r * 0.30);
    ctx.lineTo(cx - r * 0.34, cy + r * 0.66);
    ctx.lineTo(cx - r * 0.60, cy + r * 0.62);
    ctx.lineTo(cx - r * 0.46, cy + r * 0.30);
    ctx.closePath();
    // the nozzle, wider than the body
    ctx.moveTo(cx - r * 0.52, cy - r * 0.24);
    ctx.lineTo(cx - r * 0.86, cy - r * 0.40);
    ctx.lineTo(cx - r * 0.86, cy + r * 0.40);
    ctx.lineTo(cx - r * 0.52, cy + r * 0.24);
    ctx.closePath();
  },

  /**
   * A SPELL ORB — a sphere with a comet swirl wound through it.
   *
   * `circle` was standing in for this, and a circle with a glow is a bullet. An
   * orb has to read as a THING SPINNING: the outer disc, a crescent bitten out
   * of the upper left where the light is, and a wound tail that says which way
   * it is turning. The crescent and the tail are reverse-wound holes, so the
   * outline traces them and the stage shows through — which is the difference
   * between a marble and a ball of light.
   */
  orb(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, TAU);
    // the bite: an off-centre disc punched out of the upper left
    ctx.moveTo(cx - r * 0.30 + r * 0.46, cy - r * 0.30);
    ctx.arc(cx - r * 0.30, cy - r * 0.30, r * 0.46, 0, TAU, true);
    // and a small counter-eye lower right, so the two holes spiral
    ctx.moveTo(cx + r * 0.42 + r * 0.17, cy + r * 0.36);
    ctx.arc(cx + r * 0.42, cy + r * 0.36, r * 0.17, 0, TAU, true);
    ctx.closePath();
  },

  /**
   * A CAR, TOP-DOWN, pointing +X. Body, cabin, bonnet, four wheels.
   *
   * The wheels are the whole read. A top-down car without them is a lozenge,
   * and a lozenge travelling down a road is a bus, a barrier or a shadow. They
   * stand PROUD of the body on both sides so the outline picks them up — which
   * is also true of a real car seen from above and is the cheapest possible way
   * to say "this is a vehicle and it is pointed that way".
   */
  car(ctx, cx, cy, r) {
    ctx.beginPath();
    // the body — a rounded wedge, blunter at the back than the front
    ctx.moveTo(cx + r * 0.94, cy - r * 0.30);
    ctx.quadraticCurveTo(cx + r, cy, cx + r * 0.94, cy + r * 0.30);
    ctx.lineTo(cx - r * 0.86, cy + r * 0.38);
    ctx.quadraticCurveTo(cx - r, cy, cx - r * 0.86, cy - r * 0.38);
    ctx.closePath();
    // four wheels, standing proud of the body on both sides
    for (const sx of [0.50, -0.52]) {
      for (const sy of [-1, 1]) {
        ctx.moveTo(cx + r * sx - r * 0.17, cy + sy * r * 0.34);
        ctx.rect(cx + r * sx - r * 0.17, cy + sy * r * 0.34 - r * 0.10, r * 0.34, r * 0.20);
      }
    }
    ctx.closePath();
  },

  /**
   * A STREET LAMP, seen from above: the post, the arm, and the lamp head.
   *
   * From directly overhead a lamppost is a dot, which is useless — so this is
   * drawn the way a top-down game actually draws one, at a slight lean, with
   * the head offset from the base. The offset IS the shape: base at centre,
   * head up and left, a visible arm between them.
   */
  lamppost(ctx, cx, cy, r) {
    ctx.beginPath();
    // the base plinth
    ctx.moveTo(cx + r * 0.30, cy + r * 0.62);
    ctx.arc(cx, cy + r * 0.52, r * 0.30, 0, TAU);
    // the column, leaning up-left
    ctx.moveTo(cx - r * 0.10, cy + r * 0.52);
    ctx.lineTo(cx - r * 0.40, cy - r * 0.42);
    ctx.lineTo(cx - r * 0.18, cy - r * 0.46);
    ctx.lineTo(cx + r * 0.12, cy + r * 0.52);
    ctx.closePath();
    // the arm and the lamp head
    ctx.moveTo(cx - r * 0.36, cy - r * 0.34);
    ctx.lineTo(cx + r * 0.30, cy - r * 0.56);
    ctx.lineTo(cx + r * 0.30, cy - r * 0.40);
    ctx.lineTo(cx - r * 0.32, cy - r * 0.20);
    ctx.closePath();
    ctx.moveTo(cx + r * 0.62, cy - r * 0.48);
    ctx.arc(cx + r * 0.38, cy - r * 0.48, r * 0.24, 0, TAU);
    ctx.closePath();
  },

  /** A STREET BIN: a drum with a lid rim and a slot in it. */
  bin(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.78, cy);
    ctx.ellipse(cx, cy, r * 0.78, r * 0.86, 0, 0, TAU);
    // the rim, punched out so the drum reads as open
    ctx.moveTo(cx + r * 0.54, cy);
    ctx.ellipse(cx, cy, r * 0.54, r * 0.60, 0, 0, TAU, true);
    // the slot across the middle
    ctx.moveTo(cx - r * 0.40, cy - r * 0.12);
    ctx.lineTo(cx + r * 0.40, cy - r * 0.12);
    ctx.lineTo(cx + r * 0.40, cy + r * 0.12);
    ctx.lineTo(cx - r * 0.40, cy + r * 0.12);
    ctx.closePath();
  },

  /**
   * A PACHINKO CABINET, seen head on: the case, the glass, the pin field and
   * the tray at the bottom.
   *
   * It is authored UPRIGHT rather than +X, like every other obstacle-and-prop
   * shape here, and the pin field is drawn as REAL HOLES rather than as painted
   * dots — the stage shows through them, which at this size is the only thing
   * that distinguishes a game cabinet from a vending machine.
   */
  pachinko(ctx, cx, cy, r) {
    ctx.beginPath();
    // the cabinet
    ctx.moveTo(cx - r * 0.72, cy - r);
    ctx.lineTo(cx + r * 0.72, cy - r);
    ctx.lineTo(cx + r * 0.72, cy + r);
    ctx.lineTo(cx - r * 0.72, cy + r);
    ctx.closePath();
    // the glass, punched out
    ctx.moveTo(cx - r * 0.54, cy - r * 0.80);
    ctx.lineTo(cx - r * 0.54, cy + r * 0.34);
    ctx.lineTo(cx + r * 0.54, cy + r * 0.34);
    ctx.lineTo(cx + r * 0.54, cy - r * 0.80);
    ctx.closePath();
    // the pin field, as holes in the case around the glass
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const px = cx - r * 0.40 + i * r * 0.27 + (j & 1 ? r * 0.13 : 0);
        const py = cy - r * 0.62 + j * r * 0.24;
        ctx.moveTo(px + r * 0.05, py);
        ctx.arc(px, py, r * 0.05, 0, TAU);
      }
    }
    // the tray
    ctx.moveTo(cx - r * 0.60, cy + r * 0.50);
    ctx.lineTo(cx + r * 0.60, cy + r * 0.50);
    ctx.lineTo(cx + r * 0.50, cy + r * 0.84);
    ctx.lineTo(cx - r * 0.50, cy + r * 0.84);
    ctx.closePath();
  },

  /**
   * A CARROT. Tapers to a point along +X, fronds trailing off the back.
   *
   * The character who throws these had them drawn as `triangle` — an orange
   * wedge — which is a perfectly good projectile silhouette and says nothing at
   * all about what she is throwing. Every single thing in her kit is a carrot;
   * it is the joke, the epithet and the weapon, and it was reading as a dart.
   *
   * THE FRONDS ARE IN THE MAIN PATH, not in the overlay, and that is the whole
   * design. `register` fills the path and then strokes it with the accent, so
   * anything outside the path is a coloured smudge with no outline — and at the
   * nine-pixel size the barrage bakes at, the outline IS the silhouette. Leaves
   * that are part of the stroked path survive being three pixels long; leaves
   * painted afterwards do not. The overlay then only has to recolour them, which
   * is the cheap half.
   *
   * The taper is deliberately blunt at the shoulder (0.40r) rather than smoothly
   * conical: a cone with leaves on it is a party hat, and what separates a
   * carrot from a cone is that the shoulder is nearly as wide as it is deep.
   */
  carrot(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx + r, cy);
    ctx.quadraticCurveTo(cx + r * 0.16, cy - r * 0.50, cx - r * 0.30, cy - r * 0.56);
    ctx.quadraticCurveTo(cx - r * 0.52, cy, cx - r * 0.30, cy + r * 0.56);
    ctx.quadraticCurveTo(cx + r * 0.16, cy + r * 0.50, cx + r, cy);
    ctx.closePath();
    carrotFronds(ctx, cx, cy, r);
  },

  /**
   * A FLOWER seen from above: five petals round a centre.
   *
   * The meadow was seeding `star` particles and calling them flowers. A star is
   * a five-pointed shape with CONCAVE sides and points that meet at the middle,
   * which is a sparkle; a flower is five CONVEX lobes that meet at a disc. That
   * distinction is the entire difference between a field of flowers and a field
   * of glitter, and it costs one quadratic per petal.
   */
  flower(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * TAU / 5;
      const px = cx + Math.cos(a) * r * 0.60, py = cy + Math.sin(a) * r * 0.60;
      const w = r * 0.46;
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(px - Math.sin(a) * w, py + Math.cos(a) * w,
                           cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.quadraticCurveTo(px + Math.sin(a) * w, py - Math.cos(a) * w, cx, cy);
      ctx.closePath();
    }
  },

  /** A tuft of grass: three blades off one root, leaning apart. */
  grass(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) {
      const lean = i * r * 0.52;
      const w = r * 0.17;
      ctx.moveTo(cx + lean * 0.2 - w, cy + r);
      ctx.quadraticCurveTo(cx + lean * 0.5, cy, cx + lean, cy - r * 0.9);
      ctx.quadraticCurveTo(cx + lean * 0.5 + w, cy, cx + lean * 0.2 + w, cy + r);
      ctx.closePath();
    }
  },

  /** A small bunch of grapes — six berries in a triangle, on a stem. */
  grapes(ctx, cx, cy, r) {
    const b = r * 0.30;
    const rows = [[-1, 0, 1], [-0.5, 0.5], [0]];
    ctx.beginPath();
    ctx.rect(cx - r * 0.07, cy - r, r * 0.14, r * 0.4);
    for (let j = 0; j < rows.length; j++) {
      for (const k of rows[j]) {
        const x = cx + k * b * 1.7, y = cy - r * 0.44 + j * b * 1.55;
        ctx.moveTo(x + b, y);
        ctx.arc(x, y, b, 0, TAU);
      }
    }
    ctx.closePath();
  },

  /**
   * A SPELL SIGIL — a ring with four cardinal ticks and an inner ring.
   *
   * THE COLLECTION casts twenty spells in ten seconds and, before this, every
   * one of them announced itself with the same shockwave in a different colour.
   * Colour alone is not an identity at that cadence on a stage that is already
   * four colours; a stamped glyph at the cast point is. It is deliberately
   * generic — the caller tints it per page — because what has to read is "that
   * was a DIFFERENT page", not which one.
   */
  sigil(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.moveTo(cx + r * 0.74, cy);
    ctx.arc(cx, cy, r * 0.74, 0, TAU, true);
    const t = r * 0.13;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const c = Math.cos(a), s = Math.sin(a);
      const px = cx + c * r * 0.50, py = cy + s * r * 0.50;
      ctx.moveTo(px - c * r * 0.30 - s * t, py - s * r * 0.30 + c * t);
      ctx.lineTo(px + c * r * 0.30 - s * t, py + s * r * 0.30 + c * t);
      ctx.lineTo(px + c * r * 0.30 + s * t, py + s * r * 0.30 - c * t);
      ctx.lineTo(px - c * r * 0.30 + s * t, py - s * r * 0.30 - c * t);
      ctx.closePath();
    }
    ctx.moveTo(cx + r * 0.24, cy);
    ctx.arc(cx, cy, r * 0.24, 0, TAU);
  },

  /**
   * A TORII GATE, seen head on, as one closed silhouette: two pillars leaning
   * inward off their footing stones, the curved KASAGI with its ends swept up,
   * the straight NUKI below it, and the GAKUZUKA tablet standing between them.
   *
   * Five subpaths in one path, exactly like `cross` and `girder`, so the shared
   * fill and the shared outline treat the whole gate as one object — a gate
   * whose lintel is outlined separately from its pillars reads as scaffolding.
   * The upswept ends stop at 0.96r rather than r: the atlas canvas is only
   * (size + pad) across and the outline is drawn ON the edge, so the last 4% is
   * the room that stroke needs.
   */
  torii(ctx, cx, cy, r) {
    ctx.beginPath();
    // the two hashira, and the stone each one stands on
    for (let s = -1; s <= 1; s += 2) {
      ctx.moveTo(cx + s * r * 0.78, cy + r * 0.86);
      ctx.lineTo(cx + s * r * 0.70, cy - r * 0.62);
      ctx.lineTo(cx + s * r * 0.50, cy - r * 0.62);
      ctx.lineTo(cx + s * r * 0.54, cy + r * 0.86);
      ctx.closePath();
      ctx.rect(cx + s * r * 0.66 - r * 0.20, cy + r * 0.74, r * 0.40, r * 0.12);
    }
    // the nuki: straight, and proud of the pillars on both sides
    ctx.rect(cx - r * 0.86, cy - r * 0.30, r * 1.72, r * 0.16);
    // the gakuzuka tablet, between the two lintels
    ctx.rect(cx - r * 0.13, cy - r * 0.60, r * 0.26, r * 0.32);
    // the kasagi: one beam of even thickness whose ends lift above its middle
    ctx.moveTo(cx - r * 0.96, cy - r * 0.86);
    ctx.quadraticCurveTo(cx, cy - r * 0.52, cx + r * 0.96, cy - r * 0.86);
    ctx.lineTo(cx + r * 0.96, cy - r * 0.72);
    ctx.quadraticCurveTo(cx, cy - r * 0.38, cx - r * 0.96, cy - r * 0.72);
    ctx.closePath();
  },

  /**
   * An OFUDA — a paper charm: a narrow strip with a swallow-tailed foot. It is
   * drawn upright rather than along +X like the projectile silhouettes, because
   * it is given a `spin` and tumbles through its own flight anyway.
   */
  ofuda(ctx, cx, cy, r) {
    const w = r * 0.50, h = r * 0.94;
    ctx.beginPath();
    ctx.moveTo(cx - w, cy - h);
    ctx.lineTo(cx + w, cy - h);
    ctx.lineTo(cx + w, cy + h * 0.60);
    ctx.lineTo(cx, cy + h);
    ctx.lineTo(cx - w, cy + h * 0.60);
    ctx.closePath();
  },

  /** A KITSUNEBI flame, laid along +X like `shard` so it leans into its travel. */
  foxfire(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx + r, cy);
    ctx.quadraticCurveTo(cx + r * 0.10, cy - r * 0.86, cx - r * 0.52, cy - r * 0.42);
    ctx.quadraticCurveTo(cx - r * 0.92, cy - r * 0.16, cx - r * 0.72, cy);
    ctx.quadraticCurveTo(cx - r * 0.92, cy + r * 0.16, cx - r * 0.52, cy + r * 0.42);
    ctx.quadraticCurveTo(cx + r * 0.10, cy + r * 0.86, cx + r, cy);
    ctx.closePath();
  },
};

// --- material layers ---------------------------------------------------------
//
// A shape painter builds ONE path, which the atlas then fills with one gradient
// and strokes with one accent. That is the right economy for a projectile and
// the wrong one for an object made of two materials — a vermilion frame with a
// hole full of spirit light in it, or paper with ink on it. A painter may
// therefore declare an `underlay` (painted before the shape) and an `overlay`
// (painted after it). Both run at BOOT, inside the same offscreen raster as
// everything else in this file, so the per-entity draw loop still calls nothing
// but drawImage — and both are skipped for the white-flash twin, which has to
// stay a clean silhouette of the shape itself.

/** The warp portal standing between the pillars. */
SHAPES.torii.underlay = function (ctx, cx, cy, r) {
  const gy = cy + r * 0.16, rx = r * 0.50, ry = r * 0.62;
  const g = ctx.createRadialGradient(cx, gy - ry * 0.15, r * 0.05, cx, gy, ry);
  g.addColorStop(0, 'rgba(255,255,255,0.92)');
  g.addColorStop(0.35, 'rgba(190,236,255,0.60)');
  g.addColorStop(0.75, 'rgba(120,190,255,0.26)');
  g.addColorStop(1, 'rgba(120,190,255,0)');
  ctx.beginPath();
  ctx.ellipse(cx, gy, rx, ry, 0, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  // Three shimmer bands across it. A plain glowing disc reads as a lamp; bands
  // read as a surface with something on the other side of it.
  for (let i = 0; i < 3; i++) {
    const t = (i + 1) / 4;
    const yy = gy - ry + ry * 2 * t;
    const w = rx * (0.94 - Math.abs(t - 0.5) * 0.9);
    ctx.beginPath();
    ctx.ellipse(cx, yy, w, Math.max(0.6, r * 0.035), 0, 0, TAU);
    ctx.fillStyle = i === 1 ? 'rgba(255,255,255,0.55)' : 'rgba(214,244,255,0.32)';
    ctx.fill();
  }
};

/** Lacquer highlights, and two strokes of ink on the name board. */
SHAPES.torii.overlay = function (ctx, cx, cy, r) {
  ctx.fillStyle = 'rgba(255,236,206,0.50)';
  ctx.fillRect(cx - r * 0.84, cy - r * 0.295, r * 1.68, r * 0.045);   // lit top of the nuki
  ctx.fillRect(cx - r * 0.53, cy - r * 0.58, r * 0.03, r * 1.40);     // inboard face, left pillar
  ctx.fillRect(cx + r * 0.50, cy - r * 0.58, r * 0.03, r * 1.40);     // ...and right
  ctx.fillStyle = 'rgba(28,12,16,0.62)';
  ctx.fillRect(cx - r * 0.09, cy - r * 0.53, r * 0.18, r * 0.045);
  ctx.fillRect(cx - r * 0.09, cy - r * 0.44, r * 0.18, r * 0.045);
  ctx.fillRect(cx - r * 0.02, cy - r * 0.53, r * 0.04, r * 0.20);
};

/** The kanji column inked down the charm, and the vermilion seal under it. */
SHAPES.ofuda.overlay = function (ctx, cx, cy, r, color, accent) {
  const w = r * 0.28, t = Math.max(1, r * 0.09);
  ctx.fillStyle = 'rgba(24,10,14,0.74)';
  ctx.fillRect(cx - t * 0.5, cy - r * 0.62, t, r * 1.06);
  ctx.fillRect(cx - w, cy - r * 0.44, w * 2, t);
  ctx.fillRect(cx - w * 0.72, cy - r * 0.12, w * 1.44, t);
  ctx.fillRect(cx - w, cy + r * 0.20, w * 2, t);
  ctx.fillStyle = accent || '#e8452f';
  ctx.fillRect(cx - r * 0.15, cy + r * 0.42, r * 0.30, r * 0.20);
};

/**
 * The green top, and the grooves that stop the root reading as a cone.
 *
 * Both are painted over a shape that has ALREADY been filled orange and stroked,
 * so the leaves keep the outline the main path gave them and only change colour.
 * The grooves are drawn as short arcs bowing toward the tip because that is the
 * direction a real carrot's rings curve; straight ticks read as a screw thread.
 */
SHAPES.carrot.overlay = function (ctx, cx, cy, r, color, accent) {
  // The grooves are a DETAIL and they are gated on size. Below about eleven the
  // stroke is already a third of the root's depth, and three more bars across it
  // is not texture, it is a barcode.
  if (r >= 11) {
    ctx.strokeStyle = accent || 'rgba(122,52,12,0.6)';
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.globalAlpha = 0.42;
    for (let i = 0; i < 3; i++) {
      const x = cx + r * (0.44 - i * 0.30);
      const h = r * (0.14 + i * 0.08);
      ctx.beginPath();
      ctx.moveTo(x, cy - h);
      ctx.quadraticCurveTo(x + r * 0.10, cy, x, cy + h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  carrotFronds(ctx, cx, cy, r);
  ctx.fillStyle = '#4fae4a';
  ctx.fill();
  // One lit leaf, so the top has a form instead of being a green blob.
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.34, cy - r * 0.34);
  ctx.lineTo(cx - r * 0.98, cy - r * 0.56);
  ctx.lineTo(cx - r * 0.38, cy - r * 0.10);
  ctx.closePath();
  ctx.fillStyle = '#8fd96a';
  ctx.fill();
};

/**
 * THE WATER, and the hard edges the stone version could not carry.
 *
 * The overlay is where the detail has to live, because the shape path is filled
 * with ONE gradient and stroked with ONE accent — so every extra ring in the
 * path cost another 4.5px of soft outline and bought nothing. Here the water
 * gets: a flat body, EIGHT radial jets (hard, straight, alternating length), a
 * bright inner ring at the pedestal's foot, a rim highlight on the upper left
 * and a rim shadow on the lower right. All of them are straight lines or hard
 * arcs, which is exactly what the first version had none of.
 */
SHAPES.fountain.overlay = function (ctx, cx, cy, r, color, accent) {
  // the water body
  ctx.fillStyle = 'rgba(96,168,214,0.72)';
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.72, cy);
  ctx.arc(cx, cy, r * 0.72, 0, TAU);
  ctx.moveTo(cx + r * 0.44, cy);
  ctx.arc(cx, cy, r * 0.44, 0, TAU, true);
  ctx.fill();
  // eight jets thrown out from the spout across the water
  ctx.strokeStyle = 'rgba(226,246,255,0.85)';
  ctx.lineWidth = Math.max(1, r * 0.055);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + 0.2;
    const r0 = r * 0.46, r1 = r * (k & 1 ? 0.62 : 0.70);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }
  // the ring of foam where the water meets the plinth
  ctx.strokeStyle = 'rgba(236,250,255,0.75)';
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.50, 0, TAU);
  ctx.stroke();
  // rim light upper-left, rim shadow lower-right: the two arcs that give the
  // basin a direction of light and stop it reading as a flat washer.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(1, r * 0.09);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.80, Math.PI * 1.02, Math.PI * 1.62);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(20,14,26,0.42)';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.80, Math.PI * 0.06, Math.PI * 0.60);
  ctx.stroke();
  // the spout itself, brightest thing on the prop
  ctx.fillStyle = 'rgba(240,252,255,0.95)';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.13, 0, TAU);
  ctx.fill();
};

/** A steel fuller down the blade and a lit edge, so it reads as forged. */
SHAPES.dagger.overlay = function (ctx, cx, cy, r, color, accent) {
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.86, cy);
  ctx.lineTo(cx - r * 0.10, cy);
  ctx.stroke();
  ctx.fillStyle = accent || 'rgba(30,20,26,0.6)';
  ctx.fillRect(cx - r * 0.72, cy - r * 0.10, r * 0.36, r * 0.20);   // grip wrap
};

/** A hot nozzle and a warhead band — the two things that say "this explodes". */
SHAPES.rocket.overlay = function (ctx, cx, cy, r, color, accent) {
  ctx.fillStyle = 'rgba(255,220,120,0.9)';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.60, cy - r * 0.22);
  ctx.lineTo(cx - r * 0.84, cy - r * 0.34);
  ctx.lineTo(cx - r * 0.84, cy + r * 0.34);
  ctx.lineTo(cx - r * 0.60, cy + r * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = accent || 'rgba(24,18,32,0.75)';
  ctx.fillRect(cx + r * 0.10, cy - r * 0.30, r * 0.16, r * 0.60);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(cx - r * 0.40, cy - r * 0.26, r * 0.50, r * 0.09);   // body highlight
};

/** The core, and a wound tail of light — the orb is spinning, not floating. */
SHAPES.orb.overlay = function (ctx, cx, cy, r, color, accent) {
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(cx + r * 0.10, cy + r * 0.06, r * 0.26, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = Math.max(1, r * 0.11);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.66, Math.PI * 0.15, Math.PI * 1.05);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.88, Math.PI * 0.55, Math.PI * 1.45);
  ctx.stroke();
};

/** Windscreen, roof and two headlights — the top-down car's whole identity. */
SHAPES.car.overlay = function (ctx, cx, cy, r, color, accent) {
  ctx.fillStyle = 'rgba(18,26,44,0.85)';
  ctx.beginPath();                                   // windscreen
  ctx.moveTo(cx + r * 0.46, cy - r * 0.26);
  ctx.lineTo(cx + r * 0.20, cy - r * 0.30);
  ctx.lineTo(cx + r * 0.20, cy + r * 0.30);
  ctx.lineTo(cx + r * 0.46, cy + r * 0.26);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.16)';          // roof
  ctx.fillRect(cx - r * 0.34, cy - r * 0.26, r * 0.50, r * 0.52);
  ctx.fillStyle = 'rgba(255,244,190,0.95)';          // headlights
  ctx.fillRect(cx + r * 0.80, cy - r * 0.26, r * 0.14, r * 0.14);
  ctx.fillRect(cx + r * 0.80, cy + r * 0.12, r * 0.14, r * 0.14);
  ctx.fillStyle = 'rgba(255,90,90,0.9)';             // tail lights
  ctx.fillRect(cx - r * 0.90, cy - r * 0.28, r * 0.10, r * 0.14);
  ctx.fillRect(cx - r * 0.90, cy + r * 0.14, r * 0.10, r * 0.14);
};

/** The bulb, lit. It is the one part of a lamppost anybody looks at. */
SHAPES.lamppost.overlay = function (ctx, cx, cy, r, color, accent) {
  ctx.fillStyle = 'rgba(255,230,150,0.95)';
  ctx.beginPath();
  ctx.arc(cx + r * 0.38, cy - r * 0.48, r * 0.14, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,230,150,0.20)';
  ctx.beginPath();
  ctx.arc(cx + r * 0.38, cy - r * 0.48, r * 0.34, 0, TAU);
  ctx.fill();
};

/** A liner and two hoops, so the drum is a bin and not a barrel. */
SHAPES.bin.overlay = function (ctx, cx, cy, r, color, accent) {
  ctx.fillStyle = 'rgba(30,40,30,0.55)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 0.50, r * 0.56, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = accent || 'rgba(20,24,30,0.7)';
  ctx.lineWidth = Math.max(1, r * 0.07);
  for (const rr of [0.66, 0.74]) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * rr, r * (rr + 0.08), 0, 0, TAU);
    ctx.stroke();
  }
};

/** The lit playfield and a tray full of the things you came for. */
SHAPES.pachinko.overlay = function (ctx, cx, cy, r, color, accent) {
  const g = ctx.createLinearGradient(cx, cy - r * 0.8, cx, cy + r * 0.34);
  g.addColorStop(0, 'rgba(120,220,255,0.55)');
  g.addColorStop(1, 'rgba(255,110,190,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r * 0.54, cy - r * 0.80, r * 1.08, r * 1.14);
  ctx.fillStyle = 'rgba(255,240,180,0.95)';
  for (let k = 0; k < 5; k++) {
    ctx.beginPath();
    ctx.arc(cx - r * 0.34 + k * r * 0.17, cy + r * 0.66, r * 0.07, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(cx - r * 0.54, cy - r * 0.80, r * 0.16, r * 1.14);
};

/** Blossom: two lit clumps, one shaded, and the trunk showing through. */
SHAPES.sakura.overlay = function (ctx, cx, cy, r, color, accent) {
  ctx.fillStyle = 'rgba(255,255,255,0.26)';
  ctx.beginPath();
  ctx.arc(cx - r * 0.36, cy - r * 0.34, r * 0.30, 0, TAU);
  ctx.arc(cx + r * 0.30, cy - r * 0.18, r * 0.22, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(120,40,80,0.22)';
  ctx.beginPath();
  ctx.arc(cx + r * 0.24, cy + r * 0.42, r * 0.30, 0, TAU);
  ctx.fill();
  // A few darker petal clusters, so the canopy has texture rather than being
  // one flat pink coin with a hole in it.
  ctx.fillStyle = 'rgba(214,110,158,0.55)';
  for (let k = 0; k < 5; k++) {
    const a = k * 1.9 + 0.6;
    const d = r * (0.34 + 0.22 * (k & 1));
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * 0.11, 0, TAU);
    ctx.fill();
  }
  // the trunk in the hole
  ctx.fillStyle = '#5c3a2c';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.12, 0, TAU);
  ctx.fill();
};

/** Two lighter clumps of foliage, so the mass has a top and not just an edge. */
SHAPES.hedge.overlay = function (ctx, cx, cy, r, color) {
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.arc(cx - r * 0.26, cy - r * 0.30, r * 0.34, 0, TAU);
  ctx.arc(cx + r * 0.22, cy - r * 0.10, r * 0.24, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.arc(cx + r * 0.18, cy + r * 0.36, r * 0.30, 0, TAU);
  ctx.fill();
};

/** The white-hot heart of the flame. */
SHAPES.foxfire.overlay = function (ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.62, cy);
  ctx.quadraticCurveTo(cx, cy - r * 0.44, cx - r * 0.34, cy - r * 0.16);
  ctx.quadraticCurveTo(cx - r * 0.46, cy, cx - r * 0.34, cy + r * 0.16);
  ctx.quadraticCurveTo(cx, cy + r * 0.44, cx + r * 0.62, cy);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fill();
};

// --- the flame sheet ---------------------------------------------------------
// The one ANIMATED, pre-rastered thing in the atlas that is not an entity.
//
// A breath weapon cannot be built the way the effect layer builds everything
// else. `effects.js` draws from arcs, wedges and beams, and a wedge is exactly
// what made the dragon's breath read as a targeting cone rather than as fire:
// hard edges, one flat fill, a shape that is switched on instead of poured.
// Fire needs a white-hot core bleeding out through yellow into orange and dying
// red at its edge, and it needs to be a DIFFERENT SHAPE every frame. Both of
// those are gradients and paths — the two things that may never happen inside a
// draw — so they happen here, once, at boot.

/** Tongues in the sheet, and the box each is baked into. */
const FLAME_FRAMES = 8;
const FLAME_DIM = 128;

/**
 * ONE TONGUE OF FIRE, pointing +X, centred in a FLAME_DIM box.
 *
 * The outline is a polar sweep with two sine harmonics riding on it, both keyed
 * to the frame index and turning at different rates — so the licks CRAWL around
 * the tongue from frame to frame instead of the whole shape pulsing in and out,
 * which is the difference between fire and a throbbing balloon.
 *
 * The colour is one radial ramp whose centre is pushed BACKWARD, toward the
 * mouth: white at the root, yellow, orange, then deep red running out to
 * nothing at the tip. It is drawn additively at runtime, so overlapping tongues
 * blow their shared area out to white on their own — which is exactly what the
 * inside of a flame does, for free, with no per-frame gradient anywhere.
 */
function paintFlameFrame(ctx, dim, f, total) {
  const cx = dim * 0.5, cy = dim * 0.5, R = dim * 0.5;
  const ph = (f / total) * TAU;

  ctx.beginPath();
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI + (i / N) * TAU;
    const c = Math.cos(a), s = Math.sin(a);
    // An egg, long on +X: blunt at the root, drawn out at the tip.
    const stretch = 0.62 + 0.38 * c;
    // The licks: one harmonic crawling forward, one crawling back.
    const lick = 1 + 0.17 * Math.sin(a * 5 + ph * 2) + 0.11 * Math.sin(a * 9 - ph * 3);
    const rr = R * 0.94 * stretch * lick;
    const x = cx + c * rr, y = cy + s * rr * 0.72;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();

  const g = ctx.createRadialGradient(cx - R * 0.34, cy, R * 0.04, cx - R * 0.16, cy, R * 0.98);
  g.addColorStop(0.00, 'rgba(255,255,246,0.98)');   // the white-hot core
  g.addColorStop(0.16, 'rgba(255,244,178,0.90)');
  g.addColorStop(0.36, 'rgba(255,186,60,0.74)');
  g.addColorStop(0.62, 'rgba(240,108,26,0.46)');
  g.addColorStop(0.84, 'rgba(196,42,14,0.22)');
  g.addColorStop(1.00, 'rgba(120,14,4,0)');         // it dies out, it does not stop
  ctx.fillStyle = g;
  ctx.fill();

  // THREE TIP TONGUES. The body above is a lit mass; these are what make it read
  // as fire rather than as a glowing cloud, and they are what move furthest
  // between one frame and the next.
  for (let k = 0; k < 3; k++) {
    const a = (k - 1) * 0.42 + 0.16 * Math.sin(ph + k * 2.1);
    const len = R * (0.55 + 0.18 * Math.sin(ph * 1.7 + k * 1.3));
    const w = R * (0.15 + 0.05 * Math.cos(ph + k));
    const bx = cx + Math.cos(a) * R * 0.12, by = cy + Math.sin(a) * R * 0.10;
    ctx.beginPath();
    ctx.moveTo(bx, by - w);
    ctx.quadraticCurveTo(bx + len * 0.6, by - w * 0.5, bx + len, by);
    ctx.quadraticCurveTo(bx + len * 0.6, by + w * 0.5, bx, by + w);
    ctx.closePath();
    ctx.fillStyle = k === 1 ? 'rgba(255,238,170,0.55)' : 'rgba(255,150,44,0.42)';
    ctx.fill();
  }
}

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
    //
    // AND THEN SPEND WHAT IS LEFT OF THE BUDGET ON FRAMES, NOT ON MAGNIFICATION.
    // The upscale buys SOURCE RESOLUTION and never on-screen size — `unit` below
    // divides it straight back out — so its only job is to keep a grid pixel an
    // integral number of screen pixels. On a boss it does not even do that: the
    // twelve bosses in the game render 653-1166 world px from a 48-64 row grid,
    // which is 12-18 screen pixels per GRID pixel, so the browser is already
    // upscaling well past the 4x-7x raster and the extra megabytes buy nothing
    // anybody can see. Measured, they buy 15.3 MB of a 19.5 MB pixel atlas.
    //
    // Trimming that until each sprite fits RASTER_BUDGET is what pays for the
    // walk cycle: the two changes together move the pixel atlas 19.46 -> 19.83
    // MB, +1.9%, for a four-beat walk on every character and legged enemy.
    const n = built.frames.length;
    let scale = Math.max(1, Math.round((size * 2.6) / built.h));
    while (scale > 1 &&
           built.w * scale * built.h * scale * 4 * n * 2 > RASTER_BUDGET) scale--;
    const W = built.w * scale, H = built.h * scale;

    const sp = new Sprite(key, W, H, W / 2, H / 2);
    sp.rotSteps = 1;
    sp.animFrames = n;
    sp.idleFrames = built.idle || 1;
    sp.walkFrames = n - sp.idleFrames;
    sp.pixel = true;
    // The correction from the rounded raster back to `size * 2.6` — see the
    // Sprite constructor. Drawers multiply their gameplay scale by this, and the
    // integer upscale stops leaking into how big things look.
    sp.unit = (size * 2.6) / H;
    sp.grid = built.h;

    for (let i = 0; i < n; i++) {
      sp.frames.push(upscale(built.frames[i], W, H));
      sp.flash.push(upscale(flashFrames[i], W, H));
    }

    this.map.set(key, sp);
    this.count++;
    this.bytes += W * H * 4 * n * 2;
    return sp;
  }

  /**
   * THE FLAME SHEET, rastered once and handed out forever.
   *
   * Deliberately ONE rotation step and FLAME_FRAMES animation frames: a plume
   * aims wherever its owner is looking, and a snapped angle would make the whole
   * jet jump sideways as she turns, so the rotation is done on the context by
   * `drawSpriteRotated` — the same path the swung props already take — while the
   * SHAPE comes from the sheet. Eight 128px frames is ~512KB, against 32 baked
   * rotation steps of the same thing at 2MB that would still look snapped.
   *
   * No white-flash twin: fire cannot be hit, so the twin would be memory nothing
   * will ever read (`flashAt` falls through to frame 0 for anyone who asks).
   */
  flameSprite() {
    const key = 'flame|' + FLAME_FRAMES + '|' + FLAME_DIM;
    const hit = this.map.get(key);
    if (hit) return hit;
    const sp = new Sprite(key, FLAME_DIM, FLAME_DIM, FLAME_DIM / 2, FLAME_DIM / 2);
    sp.rotSteps = 1;
    sp.animFrames = FLAME_FRAMES;
    for (let i = 0; i < FLAME_FRAMES; i++) {
      const cv = makeCanvas(FLAME_DIM, FLAME_DIM);
      paintFlameFrame(cv.getContext('2d'), FLAME_DIM, i, FLAME_FRAMES);
      sp.frames.push(cv);
    }
    this.map.set(key, sp);
    this.count++;
    this.bytes += FLAME_DIM * FLAME_DIM * 4 * FLAME_FRAMES;
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
    // Material that is not the silhouette — see the material layers below the
    // SHAPES table. Never for the flash twin: that has to stay a white stamp of
    // the shape, or a hit flash lights up the hole in the middle of a gate.
    if (!asFlash && painter.underlay) painter.underlay(ctx, cx, cy, size, color, accent);
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
      if (painter.overlay) painter.overlay(ctx, cx, cy, size, color, accent);
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
