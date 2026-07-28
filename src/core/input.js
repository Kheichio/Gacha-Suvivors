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

    // Touch state
    this.touch = {
      stickId: -1, stickBaseX: 0, stickBaseY: 0, stickX: 0, stickY: 0, active: false,
      buttons: { special: false, escape: false },
      taps: [],
    };

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
    const touchPos = (t) => {
      const r = canvas.getBoundingClientRect();
      return { x: (t.clientX - r.left) * (canvas.width / r.width),
               y: (t.clientY - r.top) * (canvas.height / r.height) };
    };
    canvas.addEventListener('touchstart', (e) => {
      this.lastDevice = 'touch';
      for (const t of e.changedTouches) {
        const p = touchPos(t);
        const zone = this._touchZone(p.x, p.y, canvas.width, canvas.height);
        if (zone === 'stick' && this.touch.stickId < 0) {
          this.touch.stickId = t.identifier;
          this.touch.stickBaseX = p.x; this.touch.stickBaseY = p.y;
          this.touch.stickX = p.x; this.touch.stickY = p.y;
          this.touch.active = true;
        } else if (zone === 'special') {
          this.touch.buttons.special = true;
          if (!this.down[ACT.SPECIAL]) { this._pressed[ACT.SPECIAL] = true; this._latch(ACT.SPECIAL); }
          this.down[ACT.SPECIAL] = true;
        } else if (zone === 'escape') {
          this.touch.buttons.escape = true;
          if (!this.down[ACT.ESCAPE]) { this._pressed[ACT.ESCAPE] = true; this._latch(ACT.ESCAPE); }
          this.down[ACT.ESCAPE] = true;
        } else {
          this.touch.taps.push(p);
          this.mouseX = p.x; this.mouseY = p.y;
          this.mouseClicked = true; this.mouseDown = true; this._uiTap = true;
          this.mouseInside = true;
        }
      }
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.stickId) {
          const p = touchPos(t);
          this.touch.stickX = p.x; this.touch.stickY = p.y;
        }
      }
      e.preventDefault();
    }, { passive: false });

    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.stickId) {
          this.touch.stickId = -1; this.touch.active = false;
        }
      }
      if (e.touches.length === 0) {
        if (this.touch.buttons.special) { this.down[ACT.SPECIAL] = false; this._released[ACT.SPECIAL] = true; }
        if (this.touch.buttons.escape) { this.down[ACT.ESCAPE] = false; this._released[ACT.ESCAPE] = true; }
        this.touch.buttons.special = false; this.touch.buttons.escape = false;
        // A tap on the UI is a full press-and-release, so menus that activate on
        // release still work under a finger.
        if (this._uiTap) { this._uiTap = false; this.mouseDown = false; this.mouseReleased = true; }
      }
      e.preventDefault();
    };
    canvas.addEventListener('touchend', endTouch, { passive: false });
    canvas.addEventListener('touchcancel', endTouch, { passive: false });

    window.addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this.padIndex = -1; });
  }

  /** Touch layout: stick bottom-left, two buttons bottom-right, HUD-clear. */
  _touchZone(x, y, w, h) {
    const r = Math.min(w, h) * 0.13;
    if (y > h * 0.45) {
      if (x < w * 0.42) return 'stick';
      const bx = w - r * 1.5, by = h - r * 1.5;
      const bx2 = w - r * 3.4, by2 = h - r * 1.2;
      if ((x - bx) ** 2 + (y - by) ** 2 < r * r) return 'special';
      if ((x - bx2) ** 2 + (y - by2) ** 2 < r * r) return 'escape';
    }
    return 'ui';
  }

  releaseAll() {
    for (const k of Object.keys(this.down)) {
      if (this.down[k]) this._released[k] = true;
      this.down[k] = false;
    }
    this.mouseDown = false;
    this.touch.stickId = -1; this.touch.active = false;
    this.touch.buttons.special = false; this.touch.buttons.escape = false;
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
      const maxR = 90;
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
  }
}

export const input = new Input();
