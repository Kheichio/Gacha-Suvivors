// Bootstrap, fixed-timestep game loop, scene manager.
//
// THE LOOP (SECTION 1): fixed 60Hz simulation with an accumulator; rendering
// decoupled and interpolated. The sim never sees wall-clock time, which is what
// makes a seed reproduce a run identically at 30 FPS, at 144 FPS, and at 100x in
// the headless harness.
//
// HITSTOP AND DETERMINISM (DECISIONS.md §34): hitstop consumes REAL time without
// feeding the accumulator. The sim still advances in whole TICK_DT steps, in the
// same order, so a seed replays identically — hitstop changes how long a tick
// takes to arrive, never what happens inside it.

import { CONFIG, DEV_MODE, SIM_MODE, PERF_MODE, TEST_MODE, QUERY, IS_BROWSER } from './core/config.js';
import { input, ACT } from './core/input.js';
import { audio } from './core/audio.js';
import { save } from './core/save.js';
import { attachAdmin } from './core/admin.js';
import { events, EV } from './core/events.js';
import { initRenderer } from './render/renderer.js';
import { camera } from './render/camera.js';
import { shake, flash } from './render/screenShake.js';
import { particles } from './render/particles.js';
import { damageNumbers, floaters } from './render/damageNumbers.js';
import { atlas } from './render/spriteAtlas.js';
import { debugOverlay } from './render/debug.js';
import { prewarmAtlas } from './render/prewarm.js';
import { sceneManager } from './scenes/sceneManager.js';

const bootEl = () => document.getElementById('boot');
const bootMsg = (m) => { const e = document.getElementById('bootmsg'); if (e) e.textContent = m; };
const bootProgress = (p) => {
  const e = document.querySelector('#bootbar i');
  if (e) e.style.width = Math.round(p * 100) + '%';
};

export const game = {
  renderer: null,
  canvas: null,
  running: false,
  /** Total SIM seconds since boot. Never wall-clock. */
  time: 0,
  /** Frame counter, for cheap modulo scheduling. */
  frame: 0,
  /** 1.0 normally; hitstop and slow-mo scale this. */
  timeScale: 1,
  hitstopRemaining: 0,
  hitstopScale: 1,
  paused: false,
  /** Rolling perf numbers for the F3 overlay. */
  perf: { fps: 0, frameMs: 0, simMs: 0, renderMs: 0, steps: 0, p95: 0 },
  _frameTimes: new Float32Array(120),
  _ftIndex: 0,
};

/** Trigger hitstop. Sim-event driven, so it stays deterministic. */
export function hitstop(duration, scale) {
  game.hitstopRemaining = Math.max(game.hitstopRemaining, duration);
  game.hitstopScale = scale === undefined ? 0.35 : scale;
}

/** Sustained slow-motion (boss death, level-up freeze). */
export function setTimeScale(s) { game.timeScale = s; }

// --- resize ------------------------------------------------------------------
function resize() {
  if (!game.canvas) return;
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  game.renderer.resize(w, h, dpr);
  camera.resize(w, h);
  sceneManager.onResize(w, h);
}

// --- the loop ----------------------------------------------------------------
let lastTime = 0;
let accumulator = 0;

function frame(now) {
  if (!game.running) return;
  requestAnimationFrame(frame);

  const tStart = now;
  let dtReal = (now - lastTime) / 1000;
  lastTime = now;
  // A tab that was backgrounded returns a huge dt. Clamp rather than simulating
  // four minutes in one frame.
  if (dtReal > 0.25) dtReal = 0.25;
  if (dtReal < 0) dtReal = 0;

  input.poll();

  // Hitstop eats real time without producing sim ticks.
  let fed = dtReal * game.timeScale;
  if (game.hitstopRemaining > 0) {
    game.hitstopRemaining -= dtReal;
    fed *= game.hitstopScale;
    if (game.hitstopRemaining <= 0) { game.hitstopRemaining = 0; game.hitstopScale = 1; }
  }
  accumulator += fed;

  const simStart = performance.now();
  let steps = 0;
  while (accumulator >= CONFIG.TICK_DT && steps < CONFIG.MAX_STEPS_PER_FRAME) {
    step(CONFIG.TICK_DT);
    accumulator -= CONFIG.TICK_DT;
    steps++;
  }
  // If we blew the step budget, drop the backlog instead of spiralling.
  if (steps >= CONFIG.MAX_STEPS_PER_FRAME) accumulator = 0;
  const simEnd = performance.now();

  // Real-time scene work, OUTSIDE the fixed-step loop: transitions the player
  // depends on must not stall when the sim does.
  sceneManager.updateRealtime(dtReal);

  const alpha = accumulator / CONFIG.TICK_DT;
  render(alpha);
  const renderEnd = performance.now();

  input.endFrame();
  // Latched presses survive endFrame so a fixed-timestep sim can consume them
  // on a later frame; age them out so one made during a pause cannot fire late.
  input.ageLatches(dtReal);
  save.tick(dtReal);

  // rolling perf
  game.perf.steps = steps;
  game.perf.simMs = simEnd - simStart;
  game.perf.renderMs = renderEnd - simEnd;
  game.perf.frameMs = renderEnd - tStart + (tStart - now);
  const ft = dtReal * 1000;
  game._frameTimes[game._ftIndex] = ft;
  game._ftIndex = (game._ftIndex + 1) % game._frameTimes.length;
  game.perf.fps = ft > 0 ? 1000 / ft : 0;
  game.frame++;
  if ((game.frame & 15) === 0) game.perf.p95 = percentile95(game._frameTimes);
}

function percentile95(arr) {
  // Copy into a reused scratch so this never allocates per call.
  if (!percentile95._s) percentile95._s = new Float32Array(arr.length);
  const s = percentile95._s;
  s.set(arr);
  Array.prototype.sort.call(s, (a, b) => a - b);
  return s[Math.floor(s.length * 0.95)];
}

function step(dt) {
  game.time += dt;
  sceneManager.update(dt);
  particles.update(dt);
  damageNumbers.update(dt);
  floaters.update(dt);
  shake.update(dt);
  flash.update(dt);
}

function render(alpha) {
  const r = game.renderer;
  r.beginFrame(sceneManager.clearColor());
  sceneManager.render(r, alpha);
  if (debugOverlay.visible) debugOverlay.draw(r, game);
  r.endFrame();
}

// --- global keys -------------------------------------------------------------
function bindGlobalKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') { debugOverlay.toggle(); e.preventDefault(); }
    if (e.code === 'F4' && DEV_MODE) { debugOverlay.toggleFeelPanel(); e.preventDefault(); }
  });
  // Audio can only start from a gesture.
  const kick = () => { audio.init(); audio.resume(); };
  window.addEventListener('pointerdown', kick, { once: true });
  window.addEventListener('keydown', kick, { once: true });
  window.addEventListener('touchstart', kick, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { input.releaseAll(); audio.setMuted(true); }
    else { audio.setMuted(false); lastTime = performance.now(); }
  });
}

// --- boot --------------------------------------------------------------------
export async function boot() {
  const canvas = document.getElementById('game');
  game.canvas = canvas;
  game.renderer = initRenderer(canvas);

  bootMsg('loading save…');
  save.load();
  bootProgress(0.08);

  bootMsg('loading content…');
  // Data is loaded dynamically so a single malformed data file reports cleanly
  // instead of taking the whole module graph down at parse time.
  const data = await import('./data/index.js');
  bootProgress(0.2);

  bootMsg('rasterising sprites…');
  // THE critical boot step: everything the renderer will ever draw is baked into
  // offscreen canvases here, so the hot loop only ever calls drawImage.
  await prewarmAtlas(data, (p) => bootProgress(0.2 + p * 0.6));
  damageNumbers.prewarm();
  bootProgress(0.84);

  bootMsg('starting…');
  input.attach(canvas);
  bindGlobalKeys();
  window.addEventListener('resize', resize);
  resize();

  await sceneManager.init(data);
  // The testing console, on `window.gs`. Attached AFTER the scene manager so
  // `gs.run()` can reach the live run, and deliberately not gated on DEV_MODE:
  // DEV_MODE is what hides the ref names, so gating on it would mean the one
  // build worth testing is the build that cannot be tested. Deleting this line
  // and src/core/admin.js removes it entirely.
  attachAdmin(data, sceneManager);
  bootProgress(1);

  const b = bootEl();
  if (b) { b.classList.add('done'); setTimeout(() => b.remove(), 400); }

  game.running = true;
  lastTime = performance.now();

  if (PERF_MODE) {
    const { runPerfTest } = await import('./tools/perfTest.js');
    runPerfTest(game, data);
  } else if (TEST_MODE) {
    const { runAllTests } = await import('../tests/index.js');
    runAllTests();
  } else {
    sceneManager.go(QUERY.scene || 'hub', QUERY);
  }

  requestAnimationFrame(frame);
}

if (IS_BROWSER && !SIM_MODE) {
  boot().catch((e) => {
    console.error(e);
    const f = document.getElementById('fatal');
    const m = document.getElementById('fatalmsg');
    if (m) m.textContent = (e && e.stack) || String(e);
    if (f) f.style.display = 'block';
  });
} else if (IS_BROWSER && SIM_MODE) {
  // In-browser headless harness: ?sim=1&char=rin&stage=2&seed=42
  import('./tools/simHarness.js').then((m) => m.runFromQuery(QUERY));
}
