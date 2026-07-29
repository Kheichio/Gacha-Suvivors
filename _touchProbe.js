// TOUCH PROBE — node _touchProbe.js
//
// WHY THIS EXISTS
// ---------------
// There is no finger on this machine. Every other test in the project drives
// the game through `input.press()` or by writing `input.moveX` directly, which
// is exactly the path a touchscreen does NOT take: a tap arrives as a
// touchstart/touchend pair on the canvas, is resolved to a control zone, and
// only then becomes something the toolkit can see. Nothing anywhere exercised
// that, which is how the lower-left 42% of every menu in the game came to be a
// virtual movement stick that swallowed taps without a sound.
//
// So this fakes just enough of a browser to attach the real input module to a
// real-shaped canvas, dispatches real touch events at it, and drives the real
// widget toolkit over the result. It asserts the four things a phone player
// actually needs:
//
//   1. a tap on a button fires that button — with no hover, ever
//   2. it fires exactly once, and not again on the next frame
//   3. a tap that slides off the button before lifting does NOT fire it
//   4. a tap in the bottom-left of a MENU is a tap, not a grab at a stick
//      that no menu reads (and the same tap DURING A RUN still is the stick)
//
// It is deliberately not wired into tests/run.js: it has to install globals
// before any module in the project is imported, and importing it from a suite
// that has already loaded src/core/config.js would silently test the desktop
// path instead. Run it on its own.

// --- a browser, for values of "browser" -------------------------------------
// Must be installed BEFORE the first import: config.js decides IS_BROWSER and
// IS_TOUCH at module-evaluation time and never asks again.
globalThis.window = {
  addEventListener() {}, removeEventListener() {},
  location: { search: '' },
  innerWidth: 844, innerHeight: 390, devicePixelRatio: 2,
};
// A 2D context that answers to anything. The sprite atlas bakes offscreen
// canvases the moment it is imported, and the HUD imports it transitively.
const stubCtx = () => new Proxy({
  canvas: { width: 1, height: 1 }, globalAlpha: 1, fillStyle: '', strokeStyle: '',
  lineWidth: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic',
  imageSmoothingEnabled: true, globalCompositeOperation: 'source-over',
}, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'measureText') return (s) => ({ width: String(s).length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'getLineDash') return () => [];
    if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; },
});
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById() { return null; }, querySelector() { return null; },
  createElement() { return { width: 0, height: 0, style: {}, getContext: stubCtx }; },
};
globalThis.navigator = { maxTouchPoints: 5, getGamepads: () => [] };

const { input } = await import('./src/core/input.js');
const { storage } = await import('./src/core/storage.js');
const { save } = await import('./src/core/save.js');
const { ui } = await import('./src/ui/widgets.js');

storage.useMemory();
save.load();

// --- the canvas -------------------------------------------------------------
// 844x390 CSS at dpr 2 — a phone held sideways, and the case where storing
// touch positions in canvas pixels and drawing them in CSS pixels produces a
// stick ring at twice the finger's position.
const CSS_W = 844, CSS_H = 390, DPR = 2;
const handlers = Object.create(null);
const canvas = {
  width: CSS_W * DPR, height: CSS_H * DPR, style: {},
  addEventListener(type, fn) { (handlers[type] || (handlers[type] = [])).push(fn); },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: CSS_W, height: CSS_H }),
};
input.attach(canvas);

const fire = (type, touches, changed) => {
  const e = { touches, changedTouches: changed || touches, preventDefault() {} };
  for (const fn of handlers[type] || []) fn(e);
};
const T = (id, x, y) => ({ identifier: id, clientX: x, clientY: y });

// --- a renderer, for values of "renderer" -----------------------------------
// The toolkit only ever asks it to paint. Nothing here is checked; what is
// being tested is which widget the toolkit decides was touched.
const noop = () => {};
const r = {
  w: CSS_W, h: CSS_H, dpr: DPR,
  ctx: { save: noop, restore: noop, beginPath: noop, moveTo: noop, arcTo: noop,
         closePath: noop, stroke: noop, fill: noop },
  canvas: { style: {} },
  _fill: '', _stroke: '', _alpha: 1,
  setScreenSpace: noop, setAlpha: noop, drawRect: noop, strokeRect: noop,
  drawRoundRect: noop, drawCircle: noop, strokeCircle: noop, drawArc: noop,
  drawWedge: noop, drawLine: noop, drawText: noop, clipRect: noop, unclip: noop,
  measureText: (s) => String(s).length * 7,
};

// --- the harness ------------------------------------------------------------
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log('  ok   ' + name); return; }
  failed++;
  console.log('  FAIL ' + name + (detail ? '\n         ' + detail : ''));
};

/**
 * One rendered frame of a two-button screen, exactly as a scene would draw it.
 * Returns which button the toolkit says fired.
 */
const BTN = { a: { x: 300, y: 60, w: 200, h: 56 },
              // Deliberately in the bottom-left: the region the old input layer
              // treated as a movement stick on every screen in the game.
              b: { x: 40, y: 300, w: 200, h: 56 } };
function frame(screen) {
  ui.begin(r, screen || 'probe');
  ui.focusGrid(1);
  let hitA = false, hitB = false;
  if (ui.button('a', BTN.a.x, BTN.a.y, BTN.a.w, BTN.a.h, 'A')) hitA = true;
  if (ui.button('b', BTN.b.x, BTN.b.y, BTN.b.w, BTN.b.h, 'B')) hitB = true;
  ui.end();
  input.endFrame();
  return hitA ? 'a' : hitB ? 'b' : null;
}

const centre = (k) => [BTN[k].x + BTN[k].w / 2, BTN[k].y + BTN[k].h / 2];

// 1. A TAP FIRES THE BUTTON UNDER IT. No mousemove has ever happened, so there
//    is no hover state anywhere and there never will be.
{
  const [x, y] = centre('a');
  fire('touchstart', [T(1, x, y)]);
  fire('touchend', [], [T(1, x, y)]);
  check('a tap on a button fires it', frame() === 'a');
}

// 2. ...ONCE.
check('the tap does not fire again on the next frame', frame() === null);

// 2b. AND THE POINTER GOES WITH THE FINGER. "It did not fire twice" is NOT
//     evidence of this — the press capture is cleared on release, so a pointer
//     parked forever on the widget it last touched passes that check while
//     leaving the button lit, hovered and cursor-hot for the rest of the
//     session, and leaving whatever sits at that coordinate on the NEXT screen
//     lit too. The symptom is hover, so hover is what is asserted.
check('the pointer is retired with the finger — nothing stays hovered',
      ui.hotId === null, `hotId=${ui.hotId}`);
{
  // A different screen, same stale coordinate: nothing there may be hot either.
  frame('probe2');
  check('...including on the screen the tap navigated to',
        ui.hotId === null, `hotId=${ui.hotId}`);
  frame();
}

// 3. A TAP THAT SPANS FRAMES. The press and the release land on different
//    frames, which is the common case for anything but a flick.
{
  const [x, y] = centre('a');
  fire('touchstart', [T(2, x, y)]);
  check('holding is not activating', frame() === null);
  check('...and still is not, a frame later', frame() === null);
  fire('touchend', [], [T(2, x, y)]);
  check('activation lands on the release', frame() === 'a');
  frame();
}

// 4. DRAG OFF TO CANCEL. Sliding away before letting go must not activate —
//    the UI finger has to be tracked by touchmove for this to be possible at all.
{
  const [x, y] = centre('a');
  fire('touchstart', [T(3, x, y)]);
  frame();
  fire('touchmove', [T(3, x, y + 200)], [T(3, x, y + 200)]);
  fire('touchend', [], [T(3, x, y + 200)]);
  check('sliding off the button cancels the tap', frame() === null);
  frame();
}

// 5. A CANCELLED TOUCH IS NOT A TAP. A system gesture stealing the finger must
//    not press whatever it was resting on.
{
  const [x, y] = centre('a');
  fire('touchstart', [T(4, x, y)]);
  frame();
  fire('touchcancel', [], [T(4, x, y)]);
  check('a cancelled touch activates nothing', frame() === null);
  frame();
}

// 6. THE REPORTED BUG. Bottom-left of a MENU: no control map is live, so this
//    is a UI tap like any other. Under the old hardcoded zone map it was the
//    virtual stick, on every screen, and the button never saw it.
{
  const [x, y] = centre('b');
  fire('touchstart', [T(5, x, y)]);
  fire('touchend', [], [T(5, x, y)]);
  check('a tap in the bottom-left of a menu presses the button there',
        frame() === 'b');
}

// 7. ...AND THE STICK STILL WORKS WHERE IT IS SUPPOSED TO. Publish a control
//    map the way the HUD does during a run and the same tap becomes movement.
{
  const L = {
    zoneX: 0, zoneY: 130, zoneW: 422, zoneH: 260, stickR: 66,
    specialX: 770, specialY: 320, specialR: 46,
    escapeX: 632, escapeY: 258, escapeR: 46,
    pauseX: 782, pauseY: 46, pauseR: 22,
  };
  // The map carries one frame past its last publish, which is the whole point:
  // touches arrive between frames, after the render that would refresh it.
  input.setTouchControls(L);
  input.endFrame();

  const [x, y] = centre('b');
  fire('touchstart', [T(6, x, y)]);
  check('during a run the same spot grabs the stick, not the button',
        frame() === null && input.touch.active);

  // The stick is measured in CSS pixels, so a finger 66px right of the base is
  // full deflection — not 33, which is what a canvas-pixel stick reported on a
  // 2x screen.
  fire('touchmove', [T(6, x + 66, y)], [T(6, x + 66, y)]);
  input.poll();
  check('full deflection is one stick radius of CSS travel',
        Math.abs(input.moveX - 1) < 1e-6 && Math.abs(input.moveY) < 1e-6,
        `moveX=${input.moveX.toFixed(3)} moveY=${input.moveY.toFixed(3)}`);
  fire('touchend', [], [T(6, x + 66, y)]);
  input.poll();
  check('letting go stops the player', input.moveX === 0 && !input.touch.active);

  // Stop publishing, exactly as leaving the run does, and the menu gets its
  // bottom-left corner back.
  input.endFrame();   // live <- fresh(false)
  frame();
  fire('touchstart', [T(7, x, y)]);
  fire('touchend', [], [T(7, x, y)]);
  check('leaving the run hands the corner back to the UI', frame() === 'b');
}

// 8. TWO FINGERS. One on the stick, one tapping a button — the case the old
//    "release when e.touches.length === 0" check could never resolve.
{
  const L = {
    zoneX: 0, zoneY: 130, zoneW: 422, zoneH: 260, stickR: 66,
    specialX: 770, specialY: 320, specialR: 46,
    escapeX: 632, escapeY: 258, escapeR: 46,
    pauseX: 782, pauseY: 46, pauseR: 22,
  };
  input.setTouchControls(L);
  input.endFrame();
  fire('touchstart', [T(8, 120, 340)]);              // left thumb: stick
  frame();
  const [ax, ay] = centre('a');
  fire('touchstart', [T(8, 120, 340), T(9, ax, ay)], [T(9, ax, ay)]);
  fire('touchend', [T(8, 120, 340)], [T(9, ax, ay)]);  // stick finger stays down
  check('a tap fires while the other thumb holds the stick',
        frame() === 'a' && input.touch.active);
  fire('touchend', [], [T(8, 120, 340)]);
  input.endFrame();
}

// 9. THE ABILITY BUTTONS. A tap on the published SPECIAL disc must produce the
//    press the simulation consumes, not a UI click.
{
  const L = {
    zoneX: 0, zoneY: 130, zoneW: 422, zoneH: 260, stickR: 66,
    specialX: 770, specialY: 320, specialR: 46,
    escapeX: 632, escapeY: 258, escapeR: 46,
    pauseX: 782, pauseY: 46, pauseR: 22,
  };
  input.setTouchControls(L);
  input.endFrame();
  fire('touchstart', [T(10, 770, 320)]);
  check('the SPECIAL button latches a press for the simulation',
        input.peek('special') && input.held('special'));
  fire('touchend', [], [T(10, 770, 320)]);
  check('...and releases it', !input.held('special'));
  input.endFrame();

  input.setTouchControls(L);
  input.endFrame();
  fire('touchstart', [T(11, 782, 46)]);
  check('the PAUSE button presses pause', input.pressed('pause'));
  fire('touchend', [], [T(11, 782, 46)]);
  input.endFrame();
}

// 10. UNDERSIZED TARGETS. A 28px stepper is under every platform's floor; a
//     touch 6px outside it is a touch its owner believes landed on it.
{
  const small = { x: 400, y: 200, w: 120, h: 28 };
  const tapAt = (x, y) => {
    fire('touchstart', [T(20, x, y)]);
    fire('touchend', [], [T(20, x, y)]);
    ui.begin(r, 'slop');
    ui.focusGrid(1);
    const hit = ui.button('s', small.x, small.y, small.w, small.h, 'S');
    ui.end();
    input.endFrame();
    frame('slop');
    return hit;
  };
  check('a touch just outside an undersized button still presses it',
        tapAt(460, small.y - 6));
  check('...but the slop stops at the platform minimum',
        !tapAt(460, small.y - 30));
}

// --- the HUD's half of the contract ----------------------------------------
// input.js owns no screen geometry; the HUD hands it some, by calling
// setTouchControls from _layoutTouch. So the map input resolves against IS the
// HUD's layout, and reading it back is the honest way to check that layout.
const { hud } = await import('./src/ui/hud.js');

// A renderer that notices what a real canvas silently discards: a NaN
// coordinate draws nothing, throws nothing, and fails no assertion anywhere.
let nan = 0, drawn = null;
const watch = {};
for (const k of Object.keys(r)) {
  const v = r[k];
  if (typeof v !== 'function' || k === 'measureText') { watch[k] = v; continue; }
  watch[k] = (...a) => {
    for (const q of a) if (typeof q === 'number' && !isFinite(q)) nan++;
    // Every geometry call in this renderer starts (x, y[, w, h]).
    if (drawn && typeof a[0] === 'number' && typeof a[1] === 'number') {
      const w = typeof a[2] === 'number' ? a[2] : 0, h = typeof a[3] === 'number' ? a[3] : 0;
      drawn.x0 = Math.min(drawn.x0, a[0]); drawn.y0 = Math.min(drawn.y0, a[1]);
      drawn.x1 = Math.max(drawn.x1, a[0] + Math.max(0, w));
      drawn.y1 = Math.max(drawn.y1, a[1] + Math.max(0, h));
    }
    return v.apply(r, a);
  };
}
watch.ctx = r.ctx; watch.canvas = r.canvas;

// 11. THE CONTROL GEOMETRY. Every one of these has to be reachable by a thumb
//     on a phone held sideways AND on a 1440p monitor with a touchscreen.
{
  const SIZES = [[844, 390], [1280, 720], [1920, 1080], [667, 375], [1024, 640], [2560, 1440]];
  const bad = [];
  for (const [W, H] of SIZES) {
    for (const scale of [0.8, 1.0, 1.4]) {
      save.data.settings.uiScale = scale;
      hud._layoutTouch(W, H);
      const c = input.touchControls;
      const tag = `${W}x${H}@${scale}`;
      const on = (x, y, rr) => x - rr >= 0 && y - rr >= 0 && x + rr <= W && y + rr <= H;
      if (!on(c.specialX, c.specialY, c.specialR)) bad.push(tag + ': SPECIAL off screen');
      if (!on(c.escapeX, c.escapeY, c.escapeR)) bad.push(tag + ': ESCAPE off screen');
      if (!on(c.pauseX, c.pauseY, c.pauseR)) bad.push(tag + ': PAUSE off screen');
      if (c.specialR * 2 < 44 || c.pauseR * 2 < 44) bad.push(tag + ': under the 44px floor');
      const d = Math.hypot(c.specialX - c.escapeX, c.specialY - c.escapeY);
      if (d < c.specialR + c.escapeR + 8) {
        bad.push(tag + `: the two ability buttons touch (${d.toFixed(0)}px between centres)`);
      }
      // The stick rectangle is tested AFTER the discs in _touchZone, so it may
      // overlap them on paper — but a button whose CENTRE is inside it would be
      // half stick, which is how a mis-sized layout hides a control.
      const inZone = (x, y) => x >= c.zoneX && x <= c.zoneX + c.zoneW &&
                               y >= c.zoneY && y <= c.zoneY + c.zoneH;
      if (inZone(c.specialX, c.specialY)) bad.push(tag + ': SPECIAL is inside the stick zone');
      if (inZone(c.escapeX, c.escapeY)) bad.push(tag + ': ESCAPE is inside the stick zone');
      if (inZone(c.pauseX, c.pauseY)) bad.push(tag + ': PAUSE is inside the stick zone');
    }
  }
  save.data.settings.uiScale = 1;
  check('the touch controls fit, clear each other and meet the 44px floor',
        bad.length === 0, bad.slice(0, 6).join('\n         '));
}

// A run, reduced to exactly what the HUD asks it. Both abilities are running —
// one with plenty left, one inside the warning band — so every branch of the
// duration bar is drawn.
const fakeRun = {
  time: 4.25,
  player: {
    def: {
      special: { id: 'sp', name: 'Overdrive Cascade' },
      escape: { id: 'es', name: 'Phase Step' },
    },
    abilityState: { sp: { active: true, t: 5.6, t0: 8 }, es: { active: true, t: 0.9, t0: 6 } },
    special: { progress: 0.42, charges: 1, maxCharges: 2, ready: false, remaining: 4.2 },
    escape: { progress: 1, charges: 2, maxCharges: 2, ready: true, remaining: 0 },
  },
};

// 12. THE TOUCH CONTROLS RENDER. Never exercised by tests/run.js — IS_TOUCH is
//     false under Node, so the whole block is dead code to every other suite.
{
  const bad = [];
  for (const [W, H] of [[844, 390], [1280, 720], [2560, 1440]]) {
    for (const scale of [0.8, 1.4]) {
      save.data.settings.uiScale = scale;
      hud._layoutTouch(W, H);
      ui.attach(watch);
      nan = 0; drawn = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
      hud._touchControls(watch, fakeRun, W, H, scale);
      if (nan) bad.push(`${W}x${H}@${scale}: ${nan} NaN draws`);
      if (drawn.x1 > W + 4 || drawn.y1 > H + 4 || drawn.x0 < -4 || drawn.y0 < -4) {
        bad.push(`${W}x${H}@${scale}: drew outside the viewport ` +
                 `(${drawn.x0.toFixed(0)},${drawn.y0.toFixed(0)})-(${drawn.x1.toFixed(0)},${drawn.y1.toFixed(0)})`);
      }
    }
  }
  save.data.settings.uiScale = 1;
  drawn = null;
  check('the touch controls render on screen, with no NaN geometry',
        bad.length === 0, bad.join('\n         '));
}

// 13. THE DURATION BARS. Report: "make the ability duration bar appear in the
//     middle of the screen and make it bigger". Middle means middle — and it
//     must not land on the build strip, which on a short viewport reaches most
//     of the way up to it.
{
  const bad = [];
  for (const [W, H] of [[844, 390], [1280, 720], [1920, 1080]]) {
    for (const scale of [0.8, 1.0, 1.4]) {
      save.data.settings.uiScale = scale;
      ui.attach(watch);
      // Where _buildStrip would have left it for a full five-weapon arsenal.
      hud._stripTop = H - Math.round(163 * scale);
      nan = 0; drawn = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
      hud._centerDurations(watch, fakeRun, W, H, scale);
      const tag = `${W}x${H}@${scale}`;
      if (nan) bad.push(`${tag}: ${nan} NaN draws`);
      if (drawn.x1 < drawn.x0) { bad.push(tag + ': drew nothing at all'); continue; }
      // Overlapping the build strip is only a fault when there was somewhere
      // else to go. On a 390px window at uiScale 1.4 the arsenal claims half the
      // screen on its own and no placement clears it; asserting otherwise would
      // be asserting that the HUD fits when it does not.
      const band = hud._stripTop - Math.round(H * 0.30);
      if (drawn.y1 - drawn.y0 <= band && drawn.y1 > hud._stripTop) {
        bad.push(tag + ': overlaps the build strip with room to spare');
      }
      if (drawn.x0 < 0 || drawn.x1 > W) bad.push(tag + ': runs off the side');
      // Horizontally centred, and wide: the complaint was that it was small and
      // in a corner, so a bar that drifted back to one would be no fix at all.
      const mid = (drawn.x0 + drawn.x1) / 2;
      if (Math.abs(mid - W / 2) > 4) bad.push(tag + `: not centred (mid ${mid.toFixed(0)} vs ${W / 2})`);
      if (drawn.x1 - drawn.x0 < Math.min(W * 0.4, 300)) {
        bad.push(tag + `: only ${(drawn.x1 - drawn.x0).toFixed(0)}px wide`);
      }
      if (drawn.y0 < H * 0.25) bad.push(tag + ': climbed into the top quarter');
    }
  }
  save.data.settings.uiScale = 1;
  drawn = null;
  check('the duration bars are centred, wide, and clear of the build strip',
        bad.length === 0, bad.join('\n         '));
}

console.log('');
if (failed === 0) console.log('  touch probe: all checks passed');
else console.log(`  touch probe: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
