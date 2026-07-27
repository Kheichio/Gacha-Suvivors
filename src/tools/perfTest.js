// `?perf=1` — the honest version of "60 FPS with 2,000 entities".
//
// DECISIONS.md §35.4. The F3 overlay reports 60 FPS on an idle title screen, so
// the acceptance criterion gets marked PASS while being false. This spawns 2,500
// entities on a real stage, runs the real simulation and the real renderer for
// 10 seconds, and asserts p95 frame time < 16.6ms — then prints a PASS/FAIL line
// that cannot be misread.
//
// PINNED REFERENCE (the spec's "mid-range laptop" is undefined, and Intel UHD
// 620 vs Iris Xe is ~2x from the GPU alone):
//     1920x1080 at 100% browser zoom, integrated-GPU class hardware
//     (Intel Iris Xe / Apple M1 / Ryzen 5000U), Chrome or Edge, on battery-saver
//     OFF. Report the machine alongside the number or the number means nothing.

import { Run, RUN_STATE } from '../game/run.js';
import { CONFIG } from '../core/config.js';
import { save } from '../core/save.js';
import { storage } from '../core/storage.js';
import { camera } from '../render/camera.js';
import { runRng } from '../core/rng.js';
import { atlas } from '../render/spriteAtlas.js';
import { particles } from '../render/particles.js';
import { damageNumbers } from '../render/damageNumbers.js';
import { input } from '../core/input.js';
import { TAU } from '../core/math.js';

const TARGET_ENTITIES = 2500;
const DURATION = 10;
const BUDGET_MS = 16.6;

export function runPerfTest(game, data) {
  storage.useMemory();
  save.load();
  for (const c of data.characters.CHARACTERS) {
    save.data.roster[c.id] = { owned: true, starLevel: 5, letters: 0, bond: 0, runs: 0, kills: 0 };
  }

  const stage = data.stages.STAGES[data.stages.STAGES.length - 1];   // the busiest one
  const run = new Run(data, {
    characterId: data.characters.CHARACTERS_BY_RARITY[5][0],
    stageId: stage.id,
    tierIndex: 0,
    seed: 20260727,
  });

  // Jump to the late game, where the density curve actually lives, and give the
  // player a real build so the projectile count is representative.
  run.time = stage.duration * 0.85;
  for (const id of ['extra_shot', 'sharp_edge', 'rapid_fire', 'wide_reach', 'piercing_will']) {
    const up = data.upgrades.UPGRADES_BY_ID[id];
    for (let i = 0; i < up.maxLevel; i++) run.player.addUpgrade(id);
  }
  run.player.level = 60;

  // Fill the arena.
  const pool = stage.mobTable.map((m) => data.enemies.ENEMIES_BY_ID[m.id]).filter(Boolean);
  let spawned = 0;
  for (let i = 0; i < TARGET_ENTITIES && spawned < TARGET_ENTITIES; i++) {
    const def = pool[i % pool.length];
    const a = runRng.angle();
    const d = runRng.range(60, 1400);
    const e = run.enemies.spawn(def, run.player.x + Math.cos(a) * d, run.player.y + Math.sin(a) * d);
    if (!e) break;
    spawned++;
  }
  // A handful of elites, because gold outlines and health bars cost draw calls.
  for (let i = 0; i < 8; i++) run.spawnElite(pool[i % pool.length]);

  const state = {
    frames: 0,
    times: new Float32Array(1200),
    t: 0,
    done: false,
    peakEntities: 0,
    spawned,
    startedAt: performance.now(),
  };

  const originalUpdate = game.running;
  const hud = { draw() {} };

  // Take over the loop for the duration of the test.
  const prevScene = { update: null };
  const sceneMod = { update: null };

  let last = performance.now();
  function loop(now) {
    if (state.done) return;
    requestAnimationFrame(loop);
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    state.t += dt;

    // sim
    let acc = dt;
    let steps = 0;
    while (acc >= CONFIG.TICK_DT && steps < 5) {
      // Keep the arena topped up as things die.
      if (run.enemies.count < TARGET_ENTITIES * 0.92) {
        const def = pool[(state.frames + steps) % pool.length];
        const a = runRng.angle();
        run.enemies.spawn(def, run.player.x + Math.cos(a) * 900, run.player.y + Math.sin(a) * 900);
      }
      input.moveX = Math.cos(state.t * 0.7);
      input.moveY = Math.sin(state.t * 0.9);
      if (run.state === RUN_STATE.LEVEL_UP) run.chooseUpgrade(0);
      if (run.state === RUN_STATE.CHEST) run.closeChest();
      if (run.state === RUN_STATE.RELIC_SWAP) run.resolveRelicSwap(0);
      run.update(CONFIG.TICK_DT);
      particles.update(CONFIG.TICK_DT);
      damageNumbers.update(CONFIG.TICK_DT);
      acc -= CONFIG.TICK_DT;
      steps++;
    }

    // render
    const r = game.renderer;
    r.beginFrame(run.stage.palette.bg);
    r.setCamera(camera.renderX(1), camera.renderY(1), camera.scale);
    run.hazards.drawUnder(r, 1);
    run.pickups.draw(r, 1);
    run.minions.draw(r, 1);
    run.enemies.draw(r, 1);
    run.player.draw(r, 1);
    run.projectiles.draw(r, 1);
    run.enemyProjectiles.draw(r, 1);
    particles.draw(r, 1);
    run.hazards.drawOver(r, 1);
    damageNumbers.draw(r);
    r.setScreenSpace();
    drawReadout(r, run, state);
    r.endFrame();

    const total = run.totalEntities();
    if (total > state.peakEntities) state.peakEntities = total;
    if (state.frames < state.times.length) state.times[state.frames] = dt * 1000;
    state.frames++;

    if (state.t >= DURATION) {
      state.done = true;
      report(run, state, r);
    }
  }
  requestAnimationFrame(loop);
}

function drawReadout(r, run, state) {
  const w = 420;
  r.drawRect(12, 12, w, 96, 'rgba(6,8,16,0.9)', 1);
  r.drawText('PERF TEST — ?perf=1', 24, 36, { size: 16, color: '#ffd76a', weight: 800 });
  r.drawText(`entities ${run.totalEntities()} (peak ${state.peakEntities})`, 24, 58,
             { size: 13, color: '#9fb0d0' });
  r.drawText(`elapsed ${state.t.toFixed(1)} / ${DURATION}s   frames ${state.frames}`, 24, 76,
             { size: 13, color: '#9fb0d0' });
  r.drawText(`enemies ${run.enemies.count}  proj ${run.projectiles.count}  fx ${run.hazards.fields.count}`,
             24, 94, { size: 12, color: '#5f6b8c' });
}

function report(run, state, r) {
  const n = Math.min(state.frames, state.times.length);
  const arr = Array.prototype.slice.call(state.times, 0, n).sort((a, b) => a - b);
  const p50 = arr[Math.floor(n * 0.50)];
  const p95 = arr[Math.floor(n * 0.95)];
  const p99 = arr[Math.floor(n * 0.99)];
  const avg = arr.reduce((a, b) => a + b, 0) / n;
  const pass = p95 < BUDGET_MS;

  const lines = [
    '',
    '  ══════════════════════════════════════════════════════════',
    `   PERF TEST — ${pass ? 'PASS' : 'FAIL'}`,
    '  ══════════════════════════════════════════════════════════',
    `   entities peak     ${state.peakEntities}   (target ${TARGET_ENTITIES})`,
    `   frames            ${n} over ${DURATION}s`,
    `   frame time  avg   ${avg.toFixed(2)} ms   (${(1000 / avg).toFixed(0)} fps)`,
    `               p50   ${p50.toFixed(2)} ms`,
    `               p95   ${p95.toFixed(2)} ms   <- the acceptance number`,
    `               p99   ${p99.toFixed(2)} ms`,
    `   budget            ${BUDGET_MS} ms`,
    `   sprites in atlas  ${atlas.stats().sprites} (~${atlas.stats().mb} MB)`,
    `   lazy atlas misses ${atlas.stats().lazyMisses}   (should be 0)`,
    `   pool starvation   enemies ${run.enemies.pool.starved}, proj ${run.projectiles.pool.starved}`,
    '  ══════════════════════════════════════════════════════════',
    '   Report the machine with the number or the number means nothing.',
    '   Reference: 1920x1080, integrated-GPU class (Iris Xe / M1 / 5000U).',
    '',
  ];
  for (const l of lines) console.log(pass ? l : '%c' + l, pass ? '' : 'color:#ff6f91');

  // And on screen, because a console the tester never opens is not a result.
  const draw = () => {
    r.beginFrame('#05060d');
    r.setScreenSpace();
    const cx = r.w / 2;
    r.drawText(pass ? 'PERF: PASS' : 'PERF: FAIL', cx, r.h * 0.3,
               { size: 56, color: pass ? '#7bf59a' : '#ff6f91', align: 'center', weight: 800 });
    let y = r.h * 0.3 + 60;
    for (const l of lines.slice(4, 14)) {
      r.drawText(l.trim(), cx, y, { size: 16, color: '#e8ecf5', align: 'center',
                                    family: 'ui-monospace,Consolas,monospace' });
      y += 24;
    }
    r.endFrame();
  };
  draw();
  setTimeout(draw, 60);
}
