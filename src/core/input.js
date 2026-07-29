// Unified input: keyboard, mouse, gamepad, touch.
//
// Gameplay only ever reads the resolved state — `input.moveX/moveY`, `input.aimX/aimY`,
// `input.pressed(ACTION)`. Which device produced it is this module's problem.
//
// DECISIONS.md §17: `aimVector()` is the single abstraction that makes cursor-
// placed abilities work on a gamepad and on touch.

import { IS_BROWSER, IS_TOUCH } from './config.js';
import { clamp, normalize, V } from './math.js';

export const ACT = {
  UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right',
  SPECIAL: 'special', ESCAPE: 'escape',
  PAUSE: 'pause', CONFIRM: 'confirm', BACK: 'back',
  DEBUG: 'debug', STATS: 'stats', FEEL: 'feel',
};

const KEYMAP = {
  KeyW: ACT.UP, ArrowUp: ACT.UP,
  KeyS: ACT.DOWN, ArrowDown: ACT.DOWN,
  KeyA: ACT.LEFT, ArrowLeft: ACT.LEFT,
  KeyD: ACT.RIGHT, ArrowRight: ACT.RIGHT,
  Space: ACT.ESCAPE,
  KeyE: ACT.SPECIAL,
  Escape: ACT.PAUSE,
  Enter: ACT.CONFIRM,
  Backspace: ACT.BACK,
  F3: ACT.DEBUG,
  F4: ACT.FEEL,
  Tab: ACT.STATS,
};

// Standard Gamepad mapping indices.
const PAD_BUTTON = {
  0: ACT.ESCAPE,   // A / Cross
  1: ACT.SPECIAL,  // B / Circle
  2: ACT.SPECIAL,  // X / Square (alt)
  9: ACT.PAUSE,    // Start
  8: ACT.BACK,     // Select
  12: ACT.UP, 13: ACT.DOWN, 14: ACT.LEFT, 15: ACT.RIGHT,
};

const DEADZONE = 0.22;

class Input {
  constructor() {
    this.down = Object.create(null);      // action -> true while held
    this._pressed = Object.create(null);  // action -> true for one frame
    this._released = Object.create(null);
    /**
     * LATCHED presses, for the fixed-timestep simulation.
     *
     * `_pressed` lives exactly one RENDER frame. The sim runs on a 60Hz
     * accumulator, so on a 144Hz display the sim loop executes ZERO times on
     * roughly 58% of frames — and any press made on one of those frames is
     * cleared by endFrame() before a single sim step ever sees it. That is over
     * half of all ability inputs silently discarded, which reads as "the
     * abilities aren't very responsive".
     *
     * A latch survives until the sim actually CONSUMES it (or ages out, so a
     * press made during a pause cannot fire a second later out of nowhere).
     */
    this._latched = Object.create(null);
    this._latchAge = Object.create(null);

    this.moveX = 0; this.moveY = 0;
    /** Aim direction, unit length. Falls back to move direction, then facing. */
    this.aimX = 1; this.aimY = 0;
    this.hasExplicitAim = false;

    this.mouseX = 0; this.mouseY = 0;       // canvas pixels
    this.mouseWorldX = 0; this.mouseWorldY = 0;
    this.mouseDown = false;
    /**
     * LEFT-BUTTON press edge. This used to be set for ANY button, which meant a
     * right-click both activated whatever the cursor was over AND — because
     * button 2 also maps to ACT.SPECIAL, which the UI treats as CONFIRM —
     * activated the keyboard-focused widget at the same time. One right-click,
     * two menu actions, neither of them asked for.
     */
    this.mouseClicked = false;
    /** LEFT-BUTTON release edge. Menus activate on this, not on the press. */
    this.mouseReleased = false;
    /** False once the pointer leaves the canvas, so nothing stays hovered. */
    this.mouseInside = true;
    this.wheel = 0;
    /** Wheel travel in notches this frame, unclamped. `wheel` is the clamped one. */
    this.wheelRaw = 0;

    this.lastDevice = IS_TOUCH ? 'touch' : 'keyboard';
    this.padIndex = -1;

    /**
     * Touch state. Every position in here is CSS PIXELS, deliberately.
     *
     * It used to be canvas pixels — the same space as `mouseX/mouseY` — and the
     * HUD then drew the stick ring straight from `stickBaseX/stickBaseY` into a
     * screen-space pass measured in CSS pixels. On a desktop (dpr 1) the two
     * agree and nobody noticed. On a phone (dpr 2, 3) the ring rendered at two
     * or three times the finger's position, usually off the bottom-right corner
     * of the screen, while the stick itself worked fine. That is most of what
     * "the controls feel janky" was.
     */
    this.touch = {
      stickId: -1, stickBaseX: 0, stickBaseY: 0, stickX: 0, stickY: 0,
      /** Travel, in CSS px, that counts as full deflection. Published by the HUD. */
      stickR: 90,
      active: false,
      /** The finger that owns the UI pointer, or -1. One at a time, by design. */
      uiId: -1,
      buttons: { special: false, escape: false },
      specialId: -1, escapeId: -1, pauseId: -1,
      taps: [],
    };
    /** Recycled tap records — see _pushTap(). */
    this._tapPool = [];

    /**
     * THE IN-RUN TOUCH CONTROL MAP, in CSS pixels.
     *
     * This used to be a hardcoded screen region inside _touchZone(): the lower
     * left 42% of the viewport was the virtual stick, ALWAYS, on every screen.
     * On the hub that region covers four of the six destination cards and half
     * the SETTINGS bar, so tapping them grabbed a movement stick that no menu
     * reads and the buttons simply did nothing. It is the whole of "buttons are
     * not pressable on mobile".
     *
     * A control map is a property of whatever is drawing those controls, so the
     * HUD publishes it — every frame it draws them, and only while a run is
     * actually being played. `live` carries one frame past the last publish (see
     * endFrame) because touches arrive BETWEEN frames, after the render that
     * would have refreshed it. Everywhere else, and in every menu that opens on
     * top of a run, every touch is a UI touch.
     */
    this.touchControls = {
      live: false, fresh: false,
      zoneX: 0, zoneY: 0, zoneW: 0, zoneH: 0, stickR: 90,
      specialX: 0, specialY: 0, specialR: 0,
      escapeX: 0, escapeY: 0, escapeR: 0,
      pauseX: 0, pauseY: 0, pauseR: 0,
    };
    /** Retire the touch pointer at the end of the frame that consumes its release. */
    this._dropPointer = false;

    this._canvas = null;
    this._bound = false;
  }

  attach(canvas) {
    if (!IS_BROWSER || this._bound) return;
    this._canvas = canvas;
    this._bound = true;

    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'F3' || e.code === 'F4') {
        e.preventDefault();
      }
      if (!a) return;
      this.lastDevice = 'keyboard';
      if (!this.down[a]) { this._pressed[a] = true; this._latch(a); }
      this.down[a] = true;
    }, { passive: false });

    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      this.down[a] = false;
      this._released[a] = true;
    });

    window.addEventListener('blur', () => this.releaseAll());

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = (e.clientX - r.left) * (canvas.width / r.width);
      this.mouseY = (e.clientY - r.top) * (canvas.height / r.height);
      this.mouseInside = true;
      this.lastDevice = 'mouse';
    });
    // Without this the cursor's LAST position keeps hovering (and keeps
    // focusing) a widget forever after the pointer leaves the window.
    canvas.addEventListener('mouseleave', () => {
      this.mouseInside = false;
      this.mouseDown = false;
      this.mouseX = -10000; this.mouseY = -10000;
    });
    canvas.addEventListener('mouseenter', () => { this.mouseInside = true; });
    canvas.addEventListener('mousedown', (e) => {
      this.lastDevice = 'mouse';
      if (e.button === 0) { this.mouseDown = true; this.mouseClicked = true; }
      if (e.button === 2) { if (!this.down[ACT.SPECIAL]) { this._pressed[ACT.SPECIAL] = true; this._latch(ACT.SPECIAL); } this.down[ACT.SPECIAL] = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouseDown = false; this.mouseReleased = true; }
      if (e.button === 2) { this.down[ACT.SPECIAL] = false; this._released[ACT.SPECIAL] = true; }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      // One notch per EVENT discards magnitude, and a trackpad flick sends 3-5
      // events — which is how a single gesture used to jump the codex to its
      // last page. Accumulate raw, then clamp per frame in endFrame().
      this.wheelRaw += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    // --- touch --------------------------------------------------------------
    //
    // TOUCH IS A DEVICE, NOT A MOUSE EMULATOR.
    //
    // It used to be emulated, and the emulation leaked in three places which
    // between them made the game unplayable on a phone:
    //
    //   1. The control map was a hardcoded screen region that applied on EVERY
    //      screen — see `touchControls` above. That is the reported bug.
    //   2. Stick coordinates were stored in canvas pixels and drawn in CSS
    //      pixels — see `touch` above.
    //   3. A UI touch was tracked by one boolean, released only when the LAST
    //      finger left the glass, and never followed by touchmove. So a tap
    //      taken while the other thumb rested on the stick never released at
    //      all, and nothing — scrollbar, slider, list — could be dragged.
    //
    // What a menu reads is still `mouseX/mouseY/mouseClicked/mouseReleased`,
    // because a tap IS a press and a release at the same point and that is
    // exactly what the toolkit's press-capture wants. What the toolkit must not
    // need is a pointer that exists BETWEEN taps — there is no such thing on a
    // touchscreen — so the pointer is retired at the end of the frame that
    // consumes the release. See `_dropPointer` in endFrame().
    const touchPos = (t) => {
      const b = canvas.getBoundingClientRect();
      TP.x = t.clientX - b.left;
      TP.y = t.clientY - b.top;
      TP.k = b.width > 0 ? canvas.width / b.width : 1;
      return TP;
    };
    const setPointer = (p) => {
      this.mouseX = p.x * p.k; this.mouseY = p.y * p.k;
      this.mouseInside = true;
    };

    canvas.addEventListener('touchstart', (e) => {
      this.lastDevice = 'touch';
      for (const t of e.changedTouches) {
        const p = touchPos(t);
        const zone = this._touchZone(p.x, p.y);
        if (zone === 'stick') {
          // A second finger in the stick zone is ignored outright. Letting it
          // fall through to the UI branch below would drag the menu pointer
          // across the play field while the player is merely walking.
          if (this.touch.stickId >= 0) continue;
          this.touch.stickId = t.identifier;
          this.touch.stickBaseX = p.x; this.touch.stickBaseY = p.y;
          this.touch.stickX = p.x; this.touch.stickY = p.y;
          this.touch.stickR = this.touchControls.stickR || 90;
          this.touch.active = true;
        } else if (zone === 'special') {
          this.touch.buttons.special = true; this.touch.specialId = t.identifier;
          if (!this.down[ACT.SPECIAL]) { this._pressed[ACT.SPECIAL] = true; this._latch(ACT.SPECIAL); }
          this.down[ACT.SPECIAL] = true;
        } else if (zone === 'escape') {
          this.touch.buttons.escape = true; this.touch.escapeId = t.identifier;
          if (!this.down[ACT.ESCAPE]) { this._pressed[ACT.ESCAPE] = true; this._latch(ACT.ESCAPE); }
          this.down[ACT.ESCAPE] = true;
        } else if (zone === 'pause') {
          this.touch.pauseId = t.identifier;
          if (!this.down[ACT.PAUSE]) { this._pressed[ACT.PAUSE] = true; this._latch(ACT.PAUSE); }
          this.down[ACT.PAUSE] = true;
        } else if (this.touch.uiId < 0) {
          this.touch.uiId = t.identifier;
          this._pushTap(p.x, p.y);
          setPointer(p);
          this.mouseClicked = true; this.mouseDown = true;
        }
      }
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.stickId) {
          const p = touchPos(t);
          this.touch.stickX = p.x; this.touch.stickY = p.y;
        } else if (t.identifier === this.touch.uiId) {
          // Following the UI finger is what gives touch a DRAG: a scrollbar
          // thumb tracks it, and sliding off a button before letting go cancels
          // the press exactly the way a mouse does.
          setPointer(touchPos(t));
        }
      }
      e.preventDefault();
    }, { passive: false });

    /**
     * A finger left the glass. `cancelled` is a system gesture stealing the
     * touch rather than the player letting go — it must NOT activate whatever
     * the finger happened to be resting on, so it releases the press without
     * ever raising the release edge menus fire on.
     */
    const endTouch = (e, cancelled) => {
      for (const t of e.changedTouches) {
        const id = t.identifier;
        if (id === this.touch.stickId) { this.touch.stickId = -1; this.touch.active = false; }
        if (id === this.touch.specialId) {
          this.touch.specialId = -1; this.touch.buttons.special = false;
          this.down[ACT.SPECIAL] = false; this._released[ACT.SPECIAL] = true;
        }
        if (id === this.touch.escapeId) {
          this.touch.escapeId = -1; this.touch.buttons.escape = false;
          this.down[ACT.ESCAPE] = false; this._released[ACT.ESCAPE] = true;
        }
        if (id === this.touch.pauseId) {
          this.touch.pauseId = -1;
          this.down[ACT.PAUSE] = false; this._released[ACT.PAUSE] = true;
        }
        if (id === this.touch.uiId) {
          this.touch.uiId = -1;
          this.mouseDown = false;
          if (!cancelled) this.mouseReleased = true;
          this._dropPointer = true;
        }
      }
      e.preventDefault();
    };
    canvas.addEventListener('touchend', (e) => endTouch(e, false), { passive: false });
    canvas.addEventListener('touchcancel', (e) => endTouch(e, true), { passive: false });

    window.addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this.padIndex = -1; });
  }

  /**
   * PUBLISH THE IN-RUN CONTROL MAP. Called by whoever draws those controls, on
   * every frame it draws them; anything that stops drawing them stops owning
   * touch a frame later. Fields are copied rather than the record kept by
   * reference so the caller is free to reuse its own layout scratch.
   */
  setTouchControls(L) {
    const c = this.touchControls;
    c.zoneX = L.zoneX; c.zoneY = L.zoneY; c.zoneW = L.zoneW; c.zoneH = L.zoneH;
    c.stickR = L.stickR;
    c.specialX = L.specialX; c.specialY = L.specialY; c.specialR = L.specialR;
    c.escapeX = L.escapeX; c.escapeY = L.escapeY; c.escapeR = L.escapeR;
    c.pauseX = L.pauseX; c.pauseY = L.pauseY; c.pauseR = L.pauseR;
    c.fresh = true;
  }

  /**
   * Which control a touch belongs to, in CSS pixels.
   *
   * The default is 'ui' and always has been reachable only by falling off the
   * end — what changed is that with no live control map there is nothing to
   * fall off, so every touch on every menu is a UI touch. The buttons are
   * tested before the stick region so a thumb landing on one inside the stick's
   * generous rectangle still presses the button.
   */
  _touchZone(x, y) {
    const c = this.touchControls;
    if (!c.live) return 'ui';
    if (inCircle(x, y, c.specialX, c.specialY, c.specialR)) return 'special';
    if (inCircle(x, y, c.escapeX, c.escapeY, c.escapeR)) return 'escape';
    if (inCircle(x, y, c.pauseX, c.pauseY, c.pauseR)) return 'pause';
    if (x >= c.zoneX && x <= c.zoneX + c.zoneW &&
        y >= c.zoneY && y <= c.zoneY + c.zoneH) return 'stick';
    return 'ui';
  }

  /**
   * Record a tap position for anyMash(). Pooled: the position record handed
   * around by the touch handlers is a shared one, so pushing it would give
   * every entry in the list the LAST finger's coordinates.
   */
  _pushTap(x, y) {
    const n = this.touch.taps.length;
    const rec = this._tapPool[n] || (this._tapPool[n] = { x: 0, y: 0 });
    rec.x = x; rec.y = y;
    this.touch.taps.push(rec);
  }

  releaseAll() {
    for (const k of Object.keys(this.down)) {
      if (this.down[k]) this._released[k] = true;
      this.down[k] = false;
    }
    this.mouseDown = false;
    this.touch.stickId = -1; this.touch.active = false;
    this.touch.buttons.special = false; this.touch.buttons.escape = false;
    this.touch.specialId = -1; this.touch.escapeId = -1; this.touch.pauseId = -1;
    // A finger that vanished with the window is not a finger that let go: drop
    // the pointer without raising the release edge menus activate on.
    if (this.touch.uiId >= 0) { this.touch.uiId = -1; this._dropPointer = true; }
  }

  /** Called once per frame BEFORE the sim steps. */
  poll() {
    this._pollGamepad();

    // Clamp the frame's wheel travel. Every consumer multiplies this by its own
    // row height / page size, so an unclamped trackpad flick used to skip whole
    // pages of content in one gesture.
    this.wheel = clamp(this.wheelRaw, -3, 3);

    let mx = 0, my = 0;
    if (this.down[ACT.LEFT]) mx -= 1;
    if (this.down[ACT.RIGHT]) mx += 1;
    if (this.down[ACT.UP]) my -= 1;
    if (this.down[ACT.DOWN]) my += 1;

    if (this._padLX || this._padLY) { mx = this._padLX; my = this._padLY; }

    if (this.touch.active) {
      const dx = this.touch.stickX - this.touch.stickBaseX;
      const dy = this.touch.stickY - this.touch.stickBaseY;
      // The travel that means "full speed" is the radius the HUD DREW, not a
      // hardcoded 90. They disagreed: the ring was 62px across and the stick
      // needed 90px of travel, so the knob pinned itself to the edge of its own
      // ring at two thirds speed and the last third was invisible.
      const maxR = this.touch.stickR || 90;
      const l = Math.hypot(dx, dy);
      if (l > 4) { const s = Math.min(1, l / maxR) / l; mx = dx * s; my = dy * s; }
      else { mx = 0; my = 0; }
    }

    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    this.moveX = mx; this.moveY = my;

    // Aim resolution: right stick > mouse > movement > last aim.
    this.hasExplicitAim = false;
    if (Math.abs(this._padRX) + Math.abs(this._padRY) > DEADZONE) {
      normalize(this._padRX, this._padRY);
      this.aimX = V.x; this.aimY = V.y; this.hasExplicitAim = true;
    } else if (this.lastDevice === 'mouse') {
      this.hasExplicitAim = true; // world aim resolved by the caller via setMouseWorld
    } else if (l > 0.01) {
      this.aimX = mx / (l || 1); this.aimY = my / (l || 1);
    }
  }

  /** The camera calls this after unprojecting the cursor. */
  setMouseWorld(wx, wy, playerX, playerY) {
    this.mouseWorldX = wx; this.mouseWorldY = wy;
    if (this.lastDevice === 'mouse') {
      const len = normalize(wx - playerX, wy - playerY);
      if (len > 1) { this.aimX = V.x; this.aimY = V.y; }
    }
  }

  _pollGamepad() {
    this._padLX = 0; this._padLY = 0; this._padRX = 0; this._padRY = 0;
    if (!IS_BROWSER || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let pad = this.padIndex >= 0 ? pads[this.padIndex] : null;
    if (!pad) { for (const p of pads) if (p && p.connected) { pad = p; this.padIndex = p.index; break; } }
    if (!pad) return;

    const ax = pad.axes;
    const dz = (v) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));
    this._padLX = dz(ax[0] || 0); this._padLY = dz(ax[1] || 0);
    this._padRX = dz(ax[2] || 0); this._padRY = dz(ax[3] || 0);
    if (this._padLX || this._padLY || this._padRX || this._padRY) this.lastDevice = 'gamepad';

    if (!this._padPrev) this._padPrev = [];
    for (let i = 0; i < pad.buttons.length; i++) {
      const p = pad.buttons[i].pressed;
      const a = PAD_BUTTON[i];
      if (a) {
        if (p && !this._padPrev[i]) { this._pressed[a] = true; this._latch(a); this.lastDevice = 'gamepad'; }
        if (!p && this._padPrev[i]) this._released[a] = true;
        // Don't let a released pad button clear a held keyboard key.
        if (p) this.down[a] = true;
        else if (this._padPrev[i]) this.down[a] = false;
      }
      this._padPrev[i] = p;
    }
    // Any face button doubles as CONFIRM and as the QTE mash input.
    if (pad.buttons[0] && pad.buttons[0].pressed && !this._padConfirmPrev) this._pressed[ACT.CONFIRM] = true;
    this._padConfirmPrev = pad.buttons[0] ? pad.buttons[0].pressed : false;
  }

  /** True for exactly one RENDER frame after the action goes down. UI only. */
  pressed(action) { return !!this._pressed[action]; }
  released(action) { return !!this._released[action]; }
  held(action) { return !!this.down[action]; }

  /**
   * SIMULATION-side press read. Returns true once and clears the latch.
   *
   * Use this — never `pressed()` — for anything driven from a fixed-timestep
   * update, or the input is dropped on every frame that happens not to run a
   * sim step. Menus are drawn every frame and can keep using pressed().
   */
  consume(action) {
    if (!this._latched[action]) return false;
    this._latched[action] = false;
    return true;
  }

  /** Is a latched press waiting, without consuming it? */
  peek(action) { return !!this._latched[action]; }

  /** Set a latch. Called from every device path alongside `_pressed`. */
  _latch(action) {
    this._latched[action] = true;
    this._latchAge[action] = 0;
  }

  /**
   * Inject a press synthetically — the balance harness's scripted bot and the
   * runtime tests. Public so nothing outside this file has to know that a press
   * is two pieces of state; poking `_pressed` alone would be invisible to the
   * simulation, which is the exact bug the latch exists to fix.
   */
  press(action) {
    this._pressed[action] = true;
    this._latch(action);
  }

  /** Expire stale latches so a press made during a pause cannot fire later. */
  ageLatches(dtReal) {
    for (const k in this._latched) {
      if (!this._latched[k]) continue;
      this._latchAge[k] += dtReal;
      if (this._latchAge[k] > 0.25) this._latched[k] = false;
    }
  }

  /** Any input at all — the QTE mash detector (DECISIONS.md §17). */
  anyMash() {
    return this._pressed[ACT.SPECIAL] || this._pressed[ACT.ESCAPE] ||
           this._pressed[ACT.CONFIRM] || this.mouseClicked || this.touch.taps.length > 0;
  }

  /** Called once per frame AFTER everything has read the state. */
  endFrame() {
    for (const k in this._pressed) this._pressed[k] = false;
    for (const k in this._released) this._released[k] = false;
    this.mouseClicked = false;
    this.mouseReleased = false;
    this.wheel = 0;
    this.wheelRaw = 0;
    this.touch.taps.length = 0;

    /**
     * RETIRE THE TOUCH POINTER, one frame late and deliberately so.
     *
     * There is no cursor between taps, and leaving `mouseX/mouseY` parked where
     * the last finger was means the widget under that point stays hovered,
     * highlighted and focused forever — including on the next screen, which is
     * how a tap on PLAY used to land the player on a hub whose card under the
     * old finger position was already lit. Clearing it in the touchend handler
     * instead is wrong in the other direction: the release edge is consumed by
     * the render pass AFTER the event, and a widget whose hover has already
     * gone never sees it. So the pointer dies here, at the end of the frame
     * that read the release.
     */
    if (this._dropPointer) {
      this._dropPointer = false;
      this.mouseInside = false;
      this.mouseX = -10000; this.mouseY = -10000;
    }

    // The control map carries exactly one frame past its last publish. Touches
    // arrive BETWEEN frames — after the render that would have refreshed it —
    // so a map cleared at the top of the frame would be dead for every touch
    // that actually happens.
    this.touchControls.live = this.touchControls.fresh;
    this.touchControls.fresh = false;
  }
}

/** True if (x, y) is inside a circle. Zero radius is never inside anything. */
function inCircle(x, y, cx, cy, r) {
  if (!(r > 0)) return false;
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * A touch position, in BOTH spaces at once, written into a module-level record.
 *
 * `x`/`y` are CSS pixels — the space the HUD lays its controls out in and the
 * space widget rects live in — and `k` converts them to the canvas pixels that
 * `mouseX/mouseY` have always been measured in. One record rather than an
 * object per event: a two-finger drag is two events per finger per frame, and
 * this is the one part of the input layer that runs on a real gesture stream.
 * It is read immediately by its single caller and never held.
 */
const TP = { x: 0, y: 0, k: 1 };

export const input = new Input();
