// Immediate-mode UI toolkit.
//
// Every menu in the game is built from these. The important property is that
// KEYBOARD, MOUSE AND GAMEPAD all drive the same focus model — SECTION 13 makes
// all three navigable a requirement, and the only way that survives ten screens
// is if no screen implements navigation itself.
//
// Usage per screen:
//     ui.begin(r, 'screenId');            // screenId resets focus on a new screen
//     ui.focusGrid(cols);                 // declare the layout for arrow keys
//     if (ui.button('play', x, y, w, h, 'PLAY')) { ... }
//     ui.end();

import { input, ACT } from '../core/input.js';
import { audio } from '../core/audio.js';
import { save } from '../core/save.js';
import { clamp, lerp, easeOutCubic, TAU } from '../core/math.js';
import { UI_FONT, MONO_FONT } from '../render/renderer.js';

// Contrast matters more than mood here. The first pass was near-black panels
// with dim slate text — legible in isolation, mush on top of a screen full of
// particles and damage numbers. Panels are lighter and more opaque, borders are
// visible rather than implied, and the three text tiers are far enough apart
// that "dim" still reads at a glance.
export const PALETTE = {
  bg: '#05060d',
  panel: 'rgba(30,37,58,0.96)',
  panelSolid: '#1e253a',
  panelHi: 'rgba(52,64,96,0.98)',
  panelPress: 'rgba(70,86,128,0.99)',
  border: 'rgba(150,170,225,0.45)',
  borderHot: 'rgba(255,220,120,0.95)',
  text: '#f4f7ff',
  textDim: '#b9c4de',
  textFaint: '#8994b3',
  accent: '#ffd76a',
  accent2: '#6ad8ff',
  pink: '#ff5fa2',
  good: '#7bf59a',
  bad: '#ff6f91',
  gold: '#ffd76a',
  gem: '#6ad8ff',
};

export const RARITY_COLOR = { 3: '#6ad8ff', 4: '#c58cff', 5: '#ffd76a', 6: '#ff5fa2' };
export const RARITY_NAME = { 3: '★3', 4: '★4', 5: '★5', 6: '★6' };

class UI {
  constructor() {
    this.r = null;
    this.focus = 0;
    this.itemCount = 0;
    this.cols = 1;
    this.ids = [];
    this.scale = 1;
    this.hotId = null;
    this.time = 0;
    this._navCooldown = 0;
    this._lastScreen = '';
    this._tooltip = null;
    /** Cursor position in CSS pixels, resolved once per frame in begin(). */
    this.mx = -10000; this.my = -10000;
    /**
     * PRESS CAPTURE. The id the left button went down on, kept across frames so
     * a click only counts when it is released on the SAME widget it started on.
     * Activating on mouse-DOWN — which is what this toolkit used to do — means
     * no drag-off cancel and, worse, every widget under the cursor firing on the
     * same frame because nothing consumed the flag.
     */
    this._pressId = null;
    this._pressUsed = false;
    this._clickUsed = false;
    this._wantPointer = false;
    this._cursor = '';
    /** Per-list drag state for the scrollbars, keyed by list id. */
    this._drag = null;
  }

  begin(r, screenId) {
    this.r = r;
    r.setScreenSpace();
    this.scale = save.data.settings.uiScale || 1;
    this.mx = input.mouseInside ? input.mouseX / (r.dpr || 1) : -10000;
    this.my = input.mouseInside ? input.mouseY / (r.dpr || 1) : -10000;
    // Did the pointer move since the last frame? Answered once, here, so every
    // button in the frame sees the same answer.
    this._mouseMoved = (input.mouseX !== this._lastMx || input.mouseY !== this._lastMy);
    this._lastMx = input.mouseX;
    this._lastMy = input.mouseY;
    if (screenId !== this._lastScreen) {
      this._lastScreen = screenId;
      this.focus = 0;
      this._pressId = null;
    }
    this.itemCount = 0;
    this.ids.length = 0;
    this.hotId = null;
    this._tooltip = null;
    this._pressUsed = false;
    this._clickUsed = false;
    this._wantPointer = false;
  }

  /** Is the cursor inside this rect? Screen space, DPR already divided out. */
  pointIn(x, y, w, h) {
    return this.mx >= x && this.mx <= x + w && this.my >= y && this.my <= y + h;
  }

  /**
   * Claim this frame's click so nothing drawn afterwards also fires on it.
   * Scenes that hit-test by hand (the hub's cast, the codex grid) call this.
   */
  consumeClick() {
    if (this._clickUsed) return false;
    this._clickUsed = true;
    return true;
  }

  get clickConsumed() { return this._clickUsed; }

  /** Mark the cursor as being over something interactive, for the pointer shape. */
  markHot() { this._wantPointer = true; }

  /**
   * Bind the renderer WITHOUT touching focus state. The HUD draws every frame
   * and has no focusable elements; if it called begin() with its own screen id
   * it would reset the focus index of whatever menu is open on top of it, every
   * single frame, making that menu unnavigable.
   */
  attach(r) {
    this.r = r;
    this.scale = save.data.settings.uiScale || 1;
    this.mx = input.mouseInside ? input.mouseX / (r.dpr || 1) : -10000;
    this.my = input.mouseInside ? input.mouseY / (r.dpr || 1) : -10000;
  }

  /** Reset focus for a new screen without dropping the renderer binding. */
  resetFocus(screenId) {
    this._lastScreen = screenId;
    this.focus = 0;
    this.itemCount = 0;
  }

  tick(dt) {
    this.time += dt;
    if (this._navCooldown > 0) this._navCooldown -= dt;
  }

  /** Declare the grid shape so arrows/stick move sensibly. */
  focusGrid(cols) { this.cols = Math.max(1, cols); }

  /** Called at the end of a screen; resolves navigation for the NEXT frame. */
  end() {
    // A press that was released anywhere — on the widget or off it — is over.
    if (input.mouseReleased) this._pressId = null;
    if (this._drag && !input.mouseDown) this._drag = null;
    this._applyCursor();

    const n = this.itemCount;
    if (n === 0) return;
    if (this._navCooldown > 0) return;
    let moved = 0;
    if (input.pressed(ACT.RIGHT)) moved = 1;
    else if (input.pressed(ACT.LEFT)) moved = -1;
    else if (input.pressed(ACT.DOWN)) moved = this.cols;
    else if (input.pressed(ACT.UP)) moved = -this.cols;
    if (moved !== 0) {
      this.focus = (this.focus + moved + n * 4) % n;
      this._navCooldown = 0.12;
      audio.play('uiMove');
    }
    this.focus = clamp(this.focus, 0, n - 1);
    if (this._tooltip) this._drawTooltip();
  }

  /**
   * The pointer shape. Nothing in this project ever set it, so a button, a
   * slider and a scrollbar all looked exactly as clickable as empty background.
   */
  _applyCursor() {
    const cv = this.r && this.r.canvas;
    if (!cv || !cv.style) return;
    const want = this._drag ? 'grabbing' : this._wantPointer ? 'pointer' : 'default';
    if (want !== this._cursor) { this._cursor = want; cv.style.cursor = want; }
  }

  /** True on the frame the focused item is activated by any device. */
  activated(index) {
    return this.focus === index &&
      (input.pressed(ACT.CONFIRM) || input.pressed(ACT.SPECIAL));
  }

  backPressed() { return input.pressed(ACT.PAUSE) || input.pressed(ACT.BACK); }

  // --- primitives ------------------------------------------------------------
  /**
   * A chunky bevelled plate, not a rounded card.
   *
   * The genre's UI language is heavy metal plates with hard edges: a bright top
   * bevel, a dark bottom one, and a thick outer rule. Rounded translucent cards
   * read as a web app, which is exactly what the first pass looked like.
   */
  panel(x, y, w, h, opts) {
    const o = opts || EMPTY;
    const r = this.r;
    const alpha = o.alpha === undefined ? 1 : o.alpha;
    const rad = o.radius === undefined ? 6 : o.radius;

    // body
    r.drawRoundRect(x, y, w, h, rad, o.color || PALETTE.panel, alpha);

    if (o.border !== false) {
      const bc = o.borderColor || PALETTE.border;
      const bw = o.borderWidth || 2;
      // Hard outer rule.
      const c = r.ctx;
      c.save();
      c.beginPath();
      const rr = Math.min(rad, w / 2, h / 2);
      c.moveTo(x + rr, y);
      c.arcTo(x + w, y, x + w, y + h, rr);
      c.arcTo(x + w, y + h, x, y + h, rr);
      c.arcTo(x, y + h, x, y, rr);
      c.arcTo(x, y, x + w, y, rr);
      c.closePath();
      c.globalAlpha = alpha;
      c.strokeStyle = bc;
      c.lineWidth = bw;
      c.stroke();
      c.restore();
      r._fill = ''; r._stroke = ''; r._alpha = 1;

      // Bevel: light along the top, dark along the bottom. Two rects, and the
      // panel suddenly has depth.
      if (o.bevel !== false) {
        r.drawRect(x + rr, y + bw * 0.5, w - rr * 2, 2, 'rgba(255,255,255,0.20)', alpha);
        r.drawRect(x + rr, y + h - bw * 0.5 - 2, w - rr * 2, 2, 'rgba(0,0,0,0.42)', alpha);
      }
    }
  }

  /**
   * Corner brackets — the "targeting reticle" frame used on focused cards and
   * boss callouts. Cheap, and it makes a selection unmistakable.
   */
  brackets(x, y, w, h, color, len, width) {
    const r = this.r;
    const L = len || Math.min(18, w * 0.22);
    const t = width || 3;
    const c = color || PALETTE.accent;
    for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const px = x + sx * w, py = y + sy * h;
      const dx = sx ? -1 : 1, dy = sy ? -1 : 1;
      r.drawRect(px - (sx ? t : 0), py - (sy ? t : 0), t, dy * L, c, 1);
      r.drawRect(px - (sx ? 0 : 0), py - (sy ? t : 0), dx * L, t, c, 1);
    }
  }

  title(text, x, y, opts) {
    const o = opts || EMPTY;
    this.r.drawText(text, x, y, {
      size: (o.size || 34) * this.scale, color: o.color || PALETTE.text,
      weight: 800, align: o.align || 'left', baseline: 'middle', outline: o.outline,
    });
  }

  text(text, x, y, opts) {
    const o = opts || EMPTY;
    this.r.drawText(text, x, y, {
      // Bumped a step: 15px of dim slate over a busy background is not readable,
      // and menu text is nowhere near the hot loop so the cost is nil.
      size: (o.size || 16) * this.scale, color: o.color || PALETTE.textDim,
      weight: o.weight || 600, align: o.align || 'left', baseline: o.baseline || 'middle',
      family: o.mono ? MONO_FONT : UI_FONT, alpha: o.alpha, outline: o.outline,
    });
  }

  /**
   * A focusable button. Returns true on activation (click, Enter, gamepad A).
   * `id` only needs to be unique within the screen.
   */
  button(id, x, y, w, h, label, opts) {
    const o = opts || EMPTY;
    const idx = this.itemCount++;
    this.ids.push(id);
    const r = this.r;
    // `o.clip` is the rect a scrolling parent is clipping to. clipRect() clips
    // DRAWING only — without this the shrine's overflowing cards stayed fully
    // clickable while being invisible, so clicking empty space spent gold.
    const clip = o.clip;
    const visible = !clip || (x + w > clip.x && x < clip.x + clip.w &&
                              y + h > clip.y && y < clip.y + clip.h);
    const hover = visible && this.pointIn(x, y, w, h) &&
                  (!clip || this.pointIn(clip.x, clip.y, clip.w, clip.h));
    // `_mouseMoved` is computed ONCE PER FRAME in begin(). It used to be
    // recomputed here and the previous position stored per button — so after the
    // first button of a frame, `mouseX !== _lastMx` was always false and NO
    // OTHER BUTTON could ever take focus by hover. Every screen with more than
    // one control was effectively keyboard-only.
    if (hover && this._mouseMoved && this.focus !== idx) {
      this.focus = idx;
      audio.play('uiMove');
    }
    const focused = this.focus === idx;
    const disabled = !!o.disabled;
    if (hover && !disabled) { this._wantPointer = true; this.hotId = id; }

    // Press capture: remember which widget the button went DOWN on.
    if (hover && !disabled && input.mouseClicked && !this._pressUsed) {
      this._pressUsed = true;
      this._pressId = id;
    }
    const held = this._pressId === id && input.mouseDown && hover;

    const pulse = focused ? 0.5 + 0.5 * Math.sin(this.time * 5) : 0;

    // `invisible` = hit region + focus only, no chrome. Callers that have ALREADY
    // drawn their own visuals (the level-up cards, the relic swap slots) need
    // this: the panel below is 92% opaque, so painting it over a finished card
    // buries the card. That is what made every upgrade card look greyed out.
    if (!o.invisible) {
      // A held button sinks: the only press feedback the toolkit had was none.
      const oy = held ? 1 : 0;
      this.panel(x, y + oy, w, h, {
        color: disabled ? 'rgba(14,18,32,0.5)' : held ? PALETTE.panelPress
             : focused ? PALETTE.panelHi : PALETTE.panel,
        borderColor: disabled ? PALETTE.border : focused ? PALETTE.borderHot : PALETTE.border,
        borderWidth: focused ? 2 : 1.5,
        radius: o.radius === undefined ? 10 : o.radius,
      });
      if (focused && !disabled) {
        r.drawRoundRect(x, y + oy, w, h, o.radius === undefined ? 10 : o.radius, PALETTE.accent, 0.10 + pulse * 0.08);
      }
    } else if (focused && !disabled) {
      // Still show focus — just as a ring around the caller's art, not over it.
      r.strokeRect(x - 3, y - 3, w + 6, h + 6, PALETTE.accent, 3, 0.55 + pulse * 0.45);
    }

    if (label && !o.invisible) {
      this.text(label, o.textAlign === 'left' ? x + 14 : x + w / 2, y + h / 2 + (held ? 1 : 0), {
        size: o.size || 16,
        color: disabled ? PALETTE.textFaint : focused ? PALETTE.accent : PALETTE.text,
        weight: 700, align: o.textAlign || 'center',
      });
    }
    if (o.sub) {
      this.text(o.sub, x + w / 2, y + h - 12, { size: 11, color: PALETTE.textFaint, align: 'center' });
    }
    if (o.tooltip && focused) this._tooltip = { text: o.tooltip, x, y: y + h + 8, above: y - 8 };

    if (disabled) return false;
    // Activate on RELEASE, over the widget the press started on, once per frame.
    const released = hover && input.mouseReleased && this._pressId === id;
    const clicked = (!this._clickUsed && released) || this.activated(idx);
    if (clicked) { this._clickUsed = true; audio.play('uiConfirm'); }
    return clicked;
  }

  /**
   * An EMPTY SLOT — a dashed outline standing in for something not yet owned.
   *
   * The genre's build screens live or die on "how many more of these can I
   * have?", and a grid that only draws what you hold cannot answer it. Every
   * capped collection in this game (weapons, upgrades, relics) draws its
   * maximum, with the unfilled positions showing as these.
   */
  slot(x, y, w, h, opts) {
    const o = opts || EMPTY;
    const r = this.r;
    r.drawRoundRect(x, y, w, h, o.radius === undefined ? 6 : o.radius, o.color || 'rgba(10,13,24,0.55)', 1);
    const dash = 5, gap = 4, col = o.borderColor || 'rgba(150,170,225,0.28)';
    for (let i = 0; i < w; i += dash + gap) {
      const len = Math.min(dash, w - i);
      r.drawRect(x + i, y, len, 1.5, col, 1);
      r.drawRect(x + i, y + h - 1.5, len, 1.5, col, 1);
    }
    for (let i = 0; i < h; i += dash + gap) {
      const len = Math.min(dash, h - i);
      r.drawRect(x, y + i, 1.5, len, col, 1);
      r.drawRect(x + w - 1.5, y + i, 1.5, len, col, 1);
    }
    if (o.label) {
      this.text(o.label, x + w / 2, y + h / 2, {
        size: o.size || 10, color: o.labelColor || 'rgba(150,170,225,0.45)',
        align: 'center', baseline: 'middle', weight: 800, mono: true,
      });
    }
  }

  /**
   * A real, draggable scrollbar. Returns the (possibly changed) scroll value.
   *
   * Every scrolling surface in the game used to draw a 3px painted rectangle
   * that was not clickable, not draggable and had no track — so a mouse without
   * a wheel could not reach half the settings screen at all.
   */
  scrollbar(id, x, y, w, h, scroll, visible, total) {
    const r = this.r;
    const maxScroll = Math.max(0, total - visible);
    if (maxScroll <= 0) return 0;
    r.drawRoundRect(x, y, w, h, w / 2, 'rgba(4,6,14,0.6)', 1);
    const thumbH = Math.max(28, h * (visible / total));
    const t = clamp(scroll / maxScroll, 0, 1);
    const ty = y + (h - thumbH) * t;
    const over = this.pointIn(x - 4, y, w + 8, h);
    const dragging = this._drag === id;
    if (over) this._wantPointer = true;
    if (over && input.mouseClicked && !this._pressUsed) {
      this._pressUsed = true;
      this._drag = id;
      this._dragOff = (this.my >= ty && this.my <= ty + thumbH) ? this.my - ty : thumbH / 2;
    }
    let out = scroll;
    if (dragging && input.mouseDown) {
      const span = Math.max(1, h - thumbH);
      out = clamp((this.my - this._dragOff - y) / span, 0, 1) * maxScroll;
    }
    r.drawRoundRect(x, ty, w, thumbH, w / 2,
                    dragging ? PALETTE.accent : over ? PALETTE.textDim : PALETTE.textFaint, 1);
    return out;
  }

  /**
   * A chunky segmented bar with a hard frame, an inner bevel, and an optional
   * delayed white "ghost" showing damage just taken.
   *
   * Square, not pill-shaped: rounded bars read as a progress indicator, hard
   * ones read as a health gauge. The segment ticks make it possible to judge
   * "how much HP is that" without reading the number.
   */
  bar(x, y, w, h, frac, color, opts) {
    const o = opts || EMPTY;
    const r = this.r;
    const f = clamp(frac, 0, 1);

    // Recessed well.
    r.drawRect(x - 2, y - 2, w + 4, h + 4, '#05070e', 1);
    r.drawRect(x, y, w, h, o.bg || '#131826', 1);

    if (o.ghost !== undefined && o.ghost > f) {
      r.drawRect(x, y, w * clamp(o.ghost, 0, 1), h, o.ghostColor || 'rgba(255,255,255,0.45)', 1);
    }
    if (f > 0.001) {
      const fw = Math.max(2, w * f);
      r.drawRect(x, y, fw, h, color, 1);
      // Top highlight / bottom shade — the fill reads as a solid bar of metal.
      r.drawRect(x, y, fw, Math.max(1, h * 0.28), 'rgba(255,255,255,0.28)', 1);
      r.drawRect(x, y + h - Math.max(1, h * 0.24), fw, Math.max(1, h * 0.24), 'rgba(0,0,0,0.30)', 1);
    }

    // Segment ticks, so the eye can measure it without the number.
    if (o.segments !== false && w > 60) {
      const n = o.segments || 10;
      for (let i = 1; i < n; i++) {
        r.drawRect(x + (w / n) * i, y, 1, h, 'rgba(5,7,14,0.55)', 1);
      }
    }

    // Hard outer rule.
    r.strokeRect(x - 1, y - 1, w + 2, h + 2, o.frame || 'rgba(160,180,230,0.55)', 2, 1);

    if (o.label) {
      this.text(o.label, x + w / 2, y + h / 2 + 1, {
        size: o.labelSize || 12, color: '#ffffff', align: 'center', weight: 800, outline: true,
      });
    }
  }

  /** A radial cooldown sweep — the SPECIAL and ESCAPE HUD icons. */
  radial(x, y, radius, frac, color, opts) {
    const o = opts || EMPTY;
    const r = this.r;
    r.drawCircle(x, y, radius, o.bg || 'rgba(6,8,16,0.85)', 1);
    if (frac < 1) {
      r.drawWedge(x, y, radius, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(frac, 0, 1),
                  o.fill || 'rgba(255,255,255,0.14)', 1);
    } else {
      // Ready state PULSES — the player must never have to think about it.
      const p = 0.55 + 0.45 * Math.sin(this.time * 6);
      r.strokeCircle(x, y, radius + 2 + p * 2, color, 2.5, 0.4 + p * 0.5);
      r.drawCircle(x, y, radius, color, 0.16 + p * 0.08);
    }
    r.strokeCircle(x, y, radius, frac >= 1 ? color : PALETTE.border, 2.5, 1);
    if (o.icon) {
      this.text(o.icon, x, y + 1, { size: radius * 0.95, align: 'center' , color: frac >= 1 ? PALETTE.text : PALETTE.textFaint });
    }
    if (o.charges !== undefined && o.maxCharges > 1) {
      this.text(o.charges + '', x + radius * 0.72, y + radius * 0.72, {
        size: 13, color: PALETTE.accent, weight: 800, align: 'center', outline: true,
      });
    }
    if (o.key) {
      this.text(o.key, x, y + radius + 12, { size: 10, color: PALETTE.textFaint, align: 'center', mono: true });
    }
  }

  /**
   * A rarity card. The rarity has to be readable from across the room, so it is
   * carried by FOUR cues at once, not just a border colour: a rarity-tinted
   * body, a solid header band, a star pip row, and — for ★5/★6 — an animated
   * bracket frame. Colour alone fails the accessibility rule and also just
   * reads badly.
   */
  card(x, y, w, h, rarity, opts) {
    const o = opts || EMPTY;
    const col = RARITY_COLOR[rarity] || PALETTE.border;
    const r = this.r;

    // Body, tinted toward the rarity so even a glance separates ★3 from ★5.
    const body = o.color || mixHexSafe(PALETTE.panelSolid, col, rarity >= 5 ? 0.16 : 0.09);
    this.panel(x, y, w, h, {
      color: body,
      borderColor: o.focused ? PALETTE.borderHot : col,
      borderWidth: o.focused ? 3 : 2,
      radius: 6,
    });

    // Solid header band — the strongest single rarity cue on the card.
    const bandH = Math.max(6, Math.min(10, h * 0.045));
    r.drawRect(x + 3, y + 3, w - 6, bandH, col, 0.95);

    // Star pips, bottom-left. Countable, so rarity survives colourblindness.
    const pipY = y + h - 12;
    for (let i = 0; i < rarity; i++) {
      r.drawRect(x + 8 + i * 7, pipY, 5, 5, col, 1);
    }

    if (rarity >= 5 || o.focused) {
      const p = 0.55 + 0.45 * Math.sin(this.time * 3 + x * 0.01);
      this.brackets(x, y, w, h, o.focused ? PALETTE.borderHot : col, 16, 3);
      if (rarity >= 6) r.strokeRect(x - 3, y - 3, w + 6, h + 6, col, 2, p * 0.7);
    }
    return col;
  }

  /** A labelled stat row for the character sheet / TAB overlay. */
  statRow(label, value, x, y, w, opts) {
    const o = opts || EMPTY;
    this.text(label, x, y, { size: 13, color: PALETTE.textDim });
    this.text(value, x + w, y, { size: 13, color: o.color || PALETTE.text, align: 'right', weight: 700, mono: true });
  }

  /** A currency pill (gold / fragments / tickets / letters). */
  currency(x, y, icon, amount, color) {
    const r = this.r;
    const text = formatCount(amount);
    const w = r.measureText(text, 15, 700) + 42;
    this.panel(x, y, w, 28, { radius: 14, color: 'rgba(10,13,24,0.9)' });
    this.text(icon, x + 15, y + 14, { size: 15, align: 'center' });
    this.text(text, x + w - 12, y + 14, { size: 15, color: color || PALETTE.text, align: 'right', weight: 700, mono: true });
    return w;
  }

  /**
   * A scrollable list. Returns the index the user activated, or -1.
   *
   * Three things were wrong with the original and all three were load-bearing:
   * the wheel scrolled it from ANYWHERE on the screen (so reading the gacha's
   * banner panel silently scrolled the history beside it), hover re-asserted
   * focus every frame with no moved-guard (so keyboard navigation was dead
   * while the cursor merely rested on a row), and the scrollbar was a painted
   * 3px rectangle — there was no keyboard, gamepad or drag path to page 2 of
   * anything.
   */
  list(id, x, y, w, h, items, rowH, renderRow, state) {
    const r = this.r;
    const visible = Math.max(1, Math.floor(h / rowH));
    const maxScroll = Math.max(0, items.length - visible);
    const barW = items.length > visible ? 12 : 0;
    const listW = w - barW;
    state.scroll = clamp(state.scroll || 0, 0, maxScroll);

    // Wheel only when the cursor is actually over this list.
    if (input.wheel && this.pointIn(x, y, w, h)) {
      state.scroll = clamp(state.scroll + input.wheel, 0, maxScroll);
    }

    // Keyboard/gamepad: the focused row scrolls itself into view. Without this
    // a 100-row list is unreachable past its first page without a mouse wheel.
    const first = this.itemCount;
    if (state._kbTarget !== undefined && state._kbTarget >= 0) {
      if (state._kbTarget < state.scroll) state.scroll = state._kbTarget;
      else if (state._kbTarget >= state.scroll + visible) state.scroll = state._kbTarget - visible + 1;
      state.scroll = clamp(state.scroll, 0, maxScroll);
    }

    r.clipRect(x, y, listW, h);
    let activated = -1;
    let focusedRow = -1;
    for (let i = 0; i < visible && i + state.scroll < items.length; i++) {
      const idx = i + state.scroll;
      const ry = y + i * rowH;
      const idx2 = this.itemCount++;
      const hover = this.pointIn(x, ry, listW, rowH) && this.pointIn(x, y, listW, h);
      if (hover) this._wantPointer = true;
      if (hover && this._mouseMoved) this.focus = idx2;
      if (hover && input.mouseClicked && !this._pressUsed) { this._pressUsed = true; this._pressId = id + ':' + idx; }
      if (hover && input.mouseReleased && this._pressId === id + ':' + idx && !this._clickUsed) {
        this._clickUsed = true; activated = idx; audio.play('uiConfirm');
      }
      const focused = this.focus === idx2;
      if (focused) focusedRow = idx;
      if (focused && (input.pressed(ACT.CONFIRM) || input.pressed(ACT.SPECIAL))) {
        activated = idx; audio.play('uiConfirm');
      }
      renderRow(items[idx], x, ry, listW, rowH - 4, focused, idx);
    }
    r.unclip();

    // Remember where the keyboard cursor sits so the NEXT frame can follow it
    // after ui.end() has moved the focus index.
    state._kbFocusBase = first;
    state._kbTarget = focusedRow >= 0 && !this._mouseMoved
      ? clamp(this.focus - first + state.scroll, 0, Math.max(0, items.length - 1))
      : -1;

    if (barW) {
      state.scroll = this.scrollbar(id + ':bar', x + w - barW + 2, y, 8, h,
                                    state.scroll, visible, items.length);
      state.scroll = clamp(Math.round(state.scroll), 0, maxScroll);
    }
    return activated;
  }

  /** A back affordance every screen must have (SECTION 13). */
  backButton(x, y) {
    // 34px was under every platform's minimum touch target and read as a hint
    // rather than a control.
    const hit = this.button('__back', x, y, 108, 40, '‹ BACK', { size: 15 });
    return hit || this.backPressed();
  }

  _drawTooltip() {
    const t = this._tooltip;
    const r = this.r;
    const W = Math.min(330, r.w - 16);
    const lines = wrapText(r, t.text, W - 24, 13);
    const h = lines.length * 17 + 16;
    const x = clamp(t.x, 8, Math.max(8, r.w - W - 8));
    // Flip above the widget when there is no room below. The original never
    // clamped Y at all, so every tooltip in the lower third — including the
    // roster's star-up explainer — rendered off the bottom of the screen.
    const y = (t.y + h > r.h - 8 && t.above !== undefined)
      ? Math.max(8, t.above - h) : clamp(t.y, 8, Math.max(8, r.h - h - 8));
    this.panel(x, y, W, h, { color: 'rgba(6,8,16,0.98)', radius: 8 });
    for (let i = 0; i < lines.length; i++) {
      this.text(lines[i], x + 12, y + 16 + i * 17, { size: 13, color: PALETTE.textDim });
    }
  }
}

/**
 * Wrap text to a pixel width.
 *
 * Measures at the SAME size and weight the text will actually be drawn at,
 * including the UI scale. Measuring at 12px/500 and then drawing at 12 * uiScale
 * with weight 600 is why card descriptions spilled out of their cards — the
 * measurement was of a different, narrower string than the one rendered.
 */
export function wrapText(r, text, maxWidth, size, weight) {
  const s = (size || 15) * (ui.scale || 1);
  const wgt = weight || 600;
  const words = String(text).split(/\s+/);
  const out = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (r.measureText(test, s, wgt) > maxWidth && line) { out.push(line); line = w; }
    else line = test;
  }
  if (line) out.push(line);
  return out;
}

/**
 * The largest font size at or below `size` that fits `text` into `maxWidth`.
 * For single-line labels that must not wrap — names, big numbers, buttons.
 */
export function fitSize(r, text, maxWidth, size, weight) {
  const wgt = weight || 700;
  let s = size;
  while (s > 8) {
    if (r.measureText(text, s * (ui.scale || 1), wgt) <= maxWidth) break;
    s -= 1;
  }
  return s;
}

/** Truncate with an ellipsis when even the minimum size will not fit. */
export function ellipsize(r, text, maxWidth, size, weight) {
  const s = size * (ui.scale || 1);
  const wgt = weight || 700;
  if (r.measureText(text, s, wgt) <= maxWidth) return text;
  let t = String(text);
  while (t.length > 1 && r.measureText(t + '…', s, wgt) > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

/** Blend two colours; tolerates rgba() inputs by falling back to the first. */
function mixHexSafe(a, b, t) {
  if (typeof a !== 'string' || a[0] !== '#' || typeof b !== 'string' || b[0] !== '#') return a;
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const mix = (sa, sb) => Math.round(sa + (sb - sa) * t);
  const rr = mix((pa >> 16) & 255, (pb >> 16) & 255);
  const gg = mix((pa >> 8) & 255, (pb >> 8) & 255);
  const bb = mix(pa & 255, pb & 255);
  return '#' + ((1 << 24) | (rr << 16) | (gg << 8) | bb).toString(16).slice(1);
}

export function formatCount(n) {
  if (n < 10000) return String(Math.round(n));
  if (n < 1e6) return (n / 1000).toFixed(1) + 'K';
  return (n / 1e6).toFixed(2) + 'M';
}

const EMPTY = {};
export const ui = new UI();
