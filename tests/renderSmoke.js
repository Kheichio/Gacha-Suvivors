// Headless render smoke test.
//
// WHY THIS EXISTS
// ---------------
// Rendering is the one layer that cannot be verified by ordinary tests. A wrong
// camera transform, an inverted y-axis, a z-order mistake, an alpha of 0 on
// every enemy — all of them produce ZERO console errors, throw nothing, and pass
// every assertion you can write about game state. The result is a black screen
// that reports itself as working.
//
// A screenshot is the real answer. Absent one, this is the next best thing: it
// drives the actual render path against a RECORDING canvas context and asserts
// the things a black screen would fail:
//
//   1. render() does not throw, for every scene
//   2. it actually issues draw calls (a silent no-op is the classic failure)
//   3. those calls land INSIDE the viewport, not off at x = -40000
//   4. entities are drawn at a plausible on-screen scale
//   5. nothing is drawn fully transparent
//
// It cannot tell you whether the game looks good. It can tell you the screen is
// not black, which is the failure that costs a day.

import { describe, it, assert } from './harness.js';

// --- recording canvas -------------------------------------------------------
class RecordingCtx {
  constructor(w, h) {
    this.canvas = { width: w, height: h };
    this.reset();
    // Transform state, tracked so we can resolve where a draw actually landed.
    this._m = [1, 0, 0, 1, 0, 0];
    this._stack = [];
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.lineWidth = 1;
    this.font = '';
    this.textAlign = 'left';
    this.textBaseline = 'alphabetic';
    this.imageSmoothingEnabled = true;
    this.lineCap = 'butt';
    this.lineJoin = 'miter';
  }

  reset() {
    this.calls = { drawImage: 0, fillRect: 0, fillText: 0, strokeText: 0, arc: 0, fill: 0, stroke: 0 };
    this.drawn = [];          // {x, y, w, h, alpha}
    this.zeroAlphaDraws = 0;
    this.offscreenDraws = 0;
    /**
     * Draws with a NaN coordinate or size. A real canvas silently discards
     * these, so a `const w` shadowed by a loop variable — which is exactly how
     * one of the HUD panels lost its width — renders as nothing at all, with no
     * error and no failing assertion anywhere.
     */
    this.nanDraws = 0;
  }

  _record(rec) {
    this.drawn.push(rec);
    if (!isFinite(rec.x) || !isFinite(rec.y) || !isFinite(rec.w) || !isFinite(rec.h)) {
      this.nanDraws++;
    }
  }

  _apply(x, y) {
    const m = this._m;
    return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
  }

  setTransform(a, b, c, d, e, f) { this._m = [a, b, c, d, e, f]; }
  getTransform() { const m = this._m; return { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }; }
  save() { this._stack.push(this._m.slice()); }
  restore() { if (this._stack.length) this._m = this._stack.pop(); }
  translate(x, y) { const p = this._apply(x, y); this._m[4] = p.x; this._m[5] = p.y; }
  scale(x, y) { this._m[0] *= x; this._m[3] *= y; }
  rotate() { /* magnitude unaffected for our purposes */ }

  drawImage(img, x, y, w, h) {
    this.calls.drawImage++;
    if (x === undefined) return;
    const p = this._apply(x, y);
    const sw = (w === undefined ? (img && img.width) || 0 : w) * this._m[0];
    const sh = (h === undefined ? (img && img.height) || 0 : h) * this._m[3];
    this._record({ x: p.x, y: p.y, w: sw, h: sh, alpha: this.globalAlpha });
    if (this.globalAlpha <= 0.001) this.zeroAlphaDraws++;
    // Off-screen by a wide margin means a broken transform, not culling —
    // the renderer culls before it ever reaches drawImage.
    if (p.x < -4000 || p.x > this.canvas.width + 4000 ||
        p.y < -4000 || p.y > this.canvas.height + 4000) this.offscreenDraws++;
  }

  fillRect(x, y, w, h) {
    this.calls.fillRect++;
    const p = this._apply(x, y);
    this._record({ x: p.x, y: p.y, w: w * this._m[0], h: h * this._m[3], alpha: this.globalAlpha });
  }

  // Text position is checked for NaN as well as geometry: a label drawn at a
  // NaN x simply does not appear, and nothing anywhere reports it.
  fillText(s, x, y) { this.calls.fillText++; if (!isFinite(x) || !isFinite(y)) this.nanDraws++; }
  strokeText(s, x, y) { this.calls.strokeText++; if (!isFinite(x) || !isFinite(y)) this.nanDraws++; }
  strokeRect(x, y, w, h) {
    this.calls.stroke++;
    if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) this.nanDraws++;
  }
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  arc() { this.calls.arc++; }
  arcTo() {}
  rect() {}
  quadraticCurveTo() {}
  clip() {}
  fill() { this.calls.fill++; }
  stroke() { this.calls.stroke++; }
  measureText(s) { return { width: String(s).length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }; }
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createPattern() { return null; }
  getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
  putImageData() {}
  // Real-canvas methods the menus legitimately use. Missing them here is a
  // stub gap, not a game bug — but leaving them out makes the test lie.
  setLineDash() {}
  getLineDash() { return []; }
  ellipse() { this.calls.arc++; }
  bezierCurveTo() {}
  roundRect() { this.calls.fillRect++; }
  clearRect() {}
  transform() {}
  resetTransform() { this._m = [1, 0, 0, 1, 0, 0]; }
  isPointInPath() { return false; }
}

const W = 1600, H = 900;
let ctx = null;

/** Nearest live enemy to the player — used to drive the bot toward the crowd. */
function nearestEnemy(r) {
  const items = r.enemies.items;
  let best = null, bestD = Infinity;
  for (let i = 0; i < r.enemies.count; i++) {
    const e = items[i];
    if (!e.active || e.hp <= 0 || e.spawnT > 0) continue;
    const d = (e.x - r.player.x) ** 2 + (e.y - r.player.y) ** 2;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// The renderer, data, run and scenes are imported lazily so that if one of them
// throws at import time the failure is reported as a test, not a crash.
let renderer, data, Run, RUN_STATE, camera, input, ACT, save, storage, sceneManager, runScene, w;
let importError = null;

try {
  const rend = await import('../src/render/renderer.js');
  const canvas = { width: W, height: H, style: {},
                   getContext: () => (ctx = ctx || new RecordingCtx(W, H)),
                   addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) };
  renderer = rend.initRenderer(canvas);
  renderer.resize(W, H, 1);

  data = await import('../src/data/index.js');
  const runMod = await import('../src/game/run.js');
  Run = runMod.Run; RUN_STATE = runMod.RUN_STATE;
  camera = (await import('../src/render/camera.js')).camera;
  const inputMod = await import('../src/core/input.js');
  input = inputMod.input; ACT = inputMod.ACT;
  save = (await import('../src/core/save.js')).save;
  storage = (await import('../src/core/storage.js')).storage;
  runScene = (await import('../src/scenes/runScene.js')).runScene;
  sceneManager = (await import('../src/scenes/sceneManager.js')).sceneManager;
  w = await import('../src/ui/widgets.js');
} catch (e) {
  importError = e;
}

describe('render / the screen is not black', () => {
  it('the render layer imports', () => {
    assert.ok(!importError, importError ? String(importError.stack || importError) : '');
  });

  if (importError) return;

  let run = null;

  it('a run builds and simulates 10 seconds without throwing', () => {
    storage.useMemory();
    save.load();
    for (const c of data.characters.CHARACTERS) {
      save.data.roster[c.id] = { owned: true, starLevel: 5, letters: 0, bond: 0, runs: 0, kills: 0 };
    }
    camera.resize(W, H);
    run = new Run(data, {
      characterId: data.characters.CHARACTERS_BY_RARITY[5][0],
      stageId: data.stages.STAGES[1].id,
      tierIndex: 0,
      seed: 99,
    });
    for (let i = 0; i < 600; i++) {
      if (run.state === RUN_STATE.LEVEL_UP) { run.chooseUpgrade(0); continue; }
      if (run.state === RUN_STATE.CHEST) { run.closeChest(); continue; }
      if (run.state === RUN_STATE.RELIC_SWAP) { run.resolveRelicSwap(0); continue; }
      input.moveX = Math.cos(i * 0.03);
      input.moveY = Math.sin(i * 0.04);
      run.update(1 / 60);
    }
    assert.atLeast(run.enemies.count, 5, 'no enemies spawned in 10 seconds');
  });

  it('the run renders without throwing', () => {
    ctx.reset();
    runScene.manager = sceneManager;
    runScene.run = run;
    runScene.render(renderer, 0.5);
    assert.ok(true);
  });

  it('it actually issues draw calls — a silent no-op is the classic black screen', () => {
    const total = ctx.calls.drawImage + ctx.calls.fillRect + ctx.calls.fill;
    assert.atLeast(total, 50, `only ${total} draw operations for a screen with ${run.enemies.count} enemies`);
    assert.atLeast(ctx.calls.drawImage, run.enemies.count * 0.5,
                   'far fewer sprites drawn than there are enemies alive');
  });

  it('draws land inside the viewport, not off in world space', () => {
    // The single most common camera bug: forgetting setCamera, so every entity
    // is drawn at its raw world coordinate, thousands of pixels off-screen.
    assert.equal(ctx.offscreenDraws, 0,
                 `${ctx.offscreenDraws} of ${ctx.drawn.length} draws landed >4000px outside the viewport`);
    let inside = 0;
    for (const d of ctx.drawn) {
      if (d.x > -200 && d.x < W + 200 && d.y > -200 && d.y < H + 200) inside++;
    }
    assert.atLeast(inside / Math.max(1, ctx.drawn.length), 0.5,
                   'over half of all draws fell outside the viewport');
  });

  it('sprites are drawn at a plausible on-screen size', () => {
    // Catches a camera scale of 0 (everything invisible) and a runaway scale
    // (one enemy fills the screen) — both render without any error.
    let sized = 0, bad = 0;
    for (const d of ctx.drawn) {
      if (d.w <= 0 || d.h <= 0) continue;
      sized++;
      if (d.w > W * 1.5 || d.h > H * 1.5 || d.w < 0.5) bad++;
    }
    assert.atLeast(sized, 20, 'nothing was drawn with a non-zero size');
    assert.lessThan(bad / sized, 0.25, 'a quarter of sprites are absurdly sized');
  });

  it('nothing is drawn fully transparent', () => {
    // alpha:0 on every entity is invisible, throws nothing, and passes every
    // state assertion.
    assert.lessThan(ctx.zeroAlphaDraws / Math.max(1, ctx.drawn.length), 0.2,
                    'a fifth of all draws had alpha 0');
  });

  it('the camera followed the player rather than sitting at the origin', () => {
    const dx = Math.abs(camera.x - run.player.x);
    const dy = Math.abs(camera.y - run.player.y);
    assert.lessThan(dx, 400, 'camera did not track the player horizontally');
    assert.lessThan(dy, 400, 'camera did not track the player vertically');
    assert.ok(camera.scale > 0.05 && camera.scale < 20, `implausible camera scale ${camera.scale}`);
  });

  it('the HUD draws text', () => {
    // The HUD is the one layer that legitimately uses fillText.
    assert.atLeast(ctx.calls.fillText, 5, 'the HUD rendered no text at all');
  });

  it('no upgrade card text overflows its card, at any UI scale', () => {
    // Card text was measured at one size/weight and drawn at another (and the
    // UI scale was ignored entirely), so descriptions spilled out of the cards.
    const CARD_W = 250;
    const failures = [];
    for (const uiScale of [0.8, 1.0, 1.2, 1.4]) {
      w.ui.scale = uiScale;
      for (const up of data.upgrades.UPGRADES) {
        // Name: must fit on one line after fitting/ellipsizing.
        const size = w.fitSize(renderer, up.name, CARD_W - 26, 20, 800);
        const txt = w.ellipsize(renderer, up.name, CARD_W - 26, size, 800);
        const nameW = renderer.measureText(txt, size * uiScale, 800);
        if (nameW > CARD_W - 24) {
          failures.push(`@${uiScale} ${up.id} name ${nameW.toFixed(0)}px > ${CARD_W - 24}`);
        }
        // Description: every wrapped line must fit.
        for (const line of w.wrapText(renderer, up.codex || up.desc || '', CARD_W - 30, 12, 600)) {
          const lw = renderer.measureText(line, 12 * uiScale, 600);
          if (lw > CARD_W - 28) {
            failures.push(`@${uiScale} ${up.id} desc line ${lw.toFixed(0)}px > ${CARD_W - 28}`);
          }
        }
      }
    }
    w.ui.scale = 1;
    assert.equal(failures.length, 0, failures.slice(0, 10).join('\n      '));
  });

  it('no weapon card text overflows its card, at any UI scale', () => {
    // The weapon card is a different, wider shape than the upgrade card, and it
    // carries strings the upgrade card never had: an evolution name, a
    // per-level note, and a stat table pinned to the right edge. Same failure
    // mode, so the same check.
    const W_CARD = 306;
    const ICON_PLATE = 20 + 62 + 14;             // padding + plate + gutter
    const NAME_W = W_CARD - ICON_PLATE - 18;
    const BODY_W = W_CARD - 32;
    const failures = [];
    for (const uiScale of [0.8, 1.0, 1.2, 1.4]) {
      w.ui.scale = uiScale;
      const names = [];
      for (const wp of data.weapons.WEAPONS) {
        names.push(wp.name);
        names.push(wp.evolution.name);
        for (const lv of wp.levels) {
          for (const line of w.wrapText(renderer, lv.note, BODY_W, 13, 600)) {
            if (renderer.measureText(line, 13 * uiScale, 600) > BODY_W + 1) {
              failures.push(`@${uiScale} ${wp.id} note "${line}" overflows`);
            }
          }
        }
        for (const src of [wp.desc, wp.evolution.desc]) {
          for (const line of w.wrapText(renderer, src, BODY_W, 13, 600)) {
            if (renderer.measureText(line, 13 * uiScale, 600) > BODY_W + 1) {
              failures.push(`@${uiScale} ${wp.id} desc "${line}" overflows`);
            }
          }
        }
      }
      names.push(data.weapons.SIGNATURE_EVOLUTION.name);
      for (const n of names) {
        const size = w.fitSize(renderer, n, NAME_W, 20, 800);
        const txt = w.ellipsize(renderer, n, NAME_W, size, 800);
        if (renderer.measureText(txt, size * uiScale, 800) > NAME_W + 1) {
          failures.push(`@${uiScale} weapon name "${n}" overflows`);
        }
      }
    }
    w.ui.scale = 1;
    assert.equal(failures.length, 0, failures.slice(0, 10).join('\n      '));
  });

  it('the freeze screens render', () => {
    for (const state of [RUN_STATE.LEVEL_UP, RUN_STATE.PAUSED]) {
      ctx.reset();
      run.state = state;
      if (state === RUN_STATE.LEVEL_UP) run.levelUpChoices = run.rollUpgradeChoices();
      runScene.render(renderer, 0.5);
      const total = ctx.calls.drawImage + ctx.calls.fillRect + ctx.calls.fill;
      assert.atLeast(total, 20, `state ${state} rendered almost nothing`);
    }
    run.state = RUN_STATE.PLAYING;
  });

  it('a boss renders, including its health bar', () => {
    ctx.reset();
    const stage = run.stage;
    const bossDef = data.bosses.BOSSES_BY_ID[stage.boss];
    run.spawnBoss(bossDef, false);
    for (let i = 0; i < 240; i++) run.update(1 / 60);
    runScene.render(renderer, 0.5);
    assert.ok(run.boss.active, 'the boss did not survive 4 seconds of its own fight');
    assert.atLeast(ctx.calls.drawImage, 10);
    assert.atLeast(ctx.calls.fillRect, 5, 'the boss health bar did not draw');
  });

  // The three tests below hand the player a FULL, EVOLVED five-weapon arsenal,
  // which deletes a boss in under two seconds. They run last, after anything
  // that needs the player to still be beatable.
  it('the HUD renders a FULL, EVOLVED arsenal — slots, placeholders and portrait', () => {
    // The build strip draws every position it could ever hold, not just the
    // ones that are filled, and the portrait is its own atlas entry. Both are
    // the kind of layout that renders "fine" while being wrong.
    ctx.reset();
    run.weapons.slots[0].level = 8;
    run.weapons.evolve(run.weapons.slots[0].id);
    for (const def of data.weapons.WEAPONS) {
      const rec = run.weapons.add(def.id);
      if (!rec) break;
      rec.level = 8;
      run.weapons.evolve(def.id);
    }
    assert.equal(run.weapons.count, data.weapons.WEAPON_SLOTS, 'the arsenal did not fill');
    runScene.render(renderer, 0.5);
    assert.equal(ctx.nanDraws, 0, `${ctx.nanDraws} HUD draws had a NaN coordinate or size`);
    assert.atLeast(ctx.calls.fillText, 20, 'the enlarged build strip drew almost no text');
  });

  it('the TAB stat sheet renders the arsenal without a NaN width', () => {
    // The exact bug this guards: `for (const w of run.weapons.slots)` inside a
    // function whose panel width is also `w`. Legal JS, silently NaN, invisible.
    ctx.reset();
    input.down[ACT.STATS] = true;
    runScene.render(renderer, 0.5);
    input.down[ACT.STATS] = false;
    assert.equal(ctx.nanDraws, 0, `${ctx.nanDraws} stat-sheet draws had a NaN coordinate or size`);
    assert.atLeast(ctx.calls.fillText, 30, 'the stat sheet drew almost no text');
  });

  it('every weapon level-up card kind renders', () => {
    // levelUpScreen._card reads `choice.up.tier` unconditionally after its two
    // early-returns, so a card kind with no branch throws inside the render loop
    // and blanks the whole screen.
    const wsys = run.weapons;
    const kinds = [
      { kind: 'newWeapon', def: data.weapons.WEAPONS[0] },
      { kind: 'weapon', w: wsys.slots[1], level: 3 },
      { kind: 'weaponEvo', w: wsys.slots[1], evo: wsys.evolutionOf(wsys.slots[1]) },
      { kind: 'gold', amount: 120 },
    ];
    run.state = RUN_STATE.LEVEL_UP;
    for (const choice of kinds) {
      ctx.reset();
      run.levelUpChoices = [choice];
      runScene.render(renderer, 0.5);
      assert.atLeast(ctx.calls.fillText, 3, `the ${choice.kind} card drew no text`);
      assert.equal(ctx.nanDraws, 0, `the ${choice.kind} card produced a NaN draw`);
    }
    run.levelUpChoices = null;
    run.state = RUN_STATE.PLAYING;
  });

  it('every character renders its own auto-attack without throwing', () => {
    // The highest-value sweep here: 19 characters x their full kit, driven for
    // 3 seconds each, rendered. Catches an ability that throws only when it
    // finds a target, which no import test reaches.
    const failures = [];
    for (const c of data.characters.CHARACTERS) {
      try {
        const r2 = new Run(data, { characterId: c.id, stageId: data.stages.STAGES[0].id, tierIndex: 0, seed: 5 });
        for (let i = 0; i < 180; i++) {
          if (r2.state === RUN_STATE.LEVEL_UP) { r2.chooseUpgrade(0); continue; }
          if (r2.state === RUN_STATE.CHEST) { r2.closeChest(); continue; }
          if (r2.state === RUN_STATE.RELIC_SWAP) { r2.resolveRelicSwap(0); continue; }
          input.moveX = Math.cos(i * 0.05); input.moveY = Math.sin(i * 0.05);
          // Fire the special and escape so their cast/tick/end paths all run.
          if (i === 60) input.press(ACT.SPECIAL);
          if (i === 90) input.press(ACT.ESCAPE);
          r2.update(1 / 60);
          input._pressed[ACT.SPECIAL] = false; input._latched[ACT.SPECIAL] = false;
          input._pressed[ACT.ESCAPE] = false; input._latched[ACT.ESCAPE] = false;
        }
        ctx.reset();
        runScene.run = r2;
        runScene.render(renderer, 0.5);
        if (ctx.calls.drawImage + ctx.calls.fillRect < 20) failures.push(c.id + ' (drew nothing)');
        r2.dispose();
      } catch (e) {
        failures.push(c.id + ': ' + (e && e.message ? e.message : String(e)));
      }
    }
    runScene.run = run;
    assert.equal(failures.length, 0,
                 'characters that failed to simulate+render:\n      ' + failures.join('\n      '));
  });

  it('every character deals damage with its auto-attack', () => {
    // A pillar that resolves, runs, and does nothing is the silent failure the
    // registry coverage test cannot see.
    //
    // The bot walks TOWARD the crowd rather than standing still: the melee
    // characters have an 85-110px reach, and a stationary test would report
    // every one of them as broken purely because fodder had not arrived yet.
    const dead = [];
    for (const c of data.characters.CHARACTERS) {
      const r2 = new Run(data, { characterId: c.id, stageId: data.stages.STAGES[0].id, tierIndex: 0, seed: 11 });
      for (let i = 0; i < 1800; i++) {
        if (r2.state === RUN_STATE.LEVEL_UP) { r2.chooseUpgrade(0); continue; }
        if (r2.state === RUN_STATE.CHEST) { r2.closeChest(); continue; }
        if (r2.state === RUN_STATE.RELIC_SWAP) { r2.resolveRelicSwap(0); continue; }
        const t = nearestEnemy(r2);
        if (t) {
          const dx = t.x - r2.player.x, dy = t.y - r2.player.y;
          const d = Math.hypot(dx, dy) || 1;
          input.moveX = dx / d; input.moveY = dy / d;
        } else { input.moveX = 0; input.moveY = 0; }
        r2.update(1 / 60);
        if (r2.stats.damageDealt > 0) break;
      }
      if (r2.stats.damageDealt <= 0) dead.push(c.id);
      r2.dispose();
    }
    input.moveX = 0; input.moveY = 0;
    assert.equal(dead.length, 0,
                 'characters whose auto-attack dealt zero damage in 30s: ' + dead.join(', '));
  });

  it('every meta screen enters, updates and renders', async () => {
    // Nine screens that a player reaches before ever starting a run. Each is
    // driven through enter -> update -> render and checked for the same black-
    // screen signature: it must issue real draw calls and land them on screen.
    await sceneManager.init(data);
    const failures = [];
    const SCREENS = ['hub', 'stageSelect', 'roster', 'shrine', 'gacha',
                     'codex', 'achievements', 'settings'];
    for (const id of SCREENS) {
      const scene = sceneManager.scenes[id];
      if (!scene) { failures.push(id + ': not registered'); continue; }
      try {
        scene.manager = sceneManager;
        if (scene.enter) scene.enter({}, sceneManager);
        for (let i = 0; i < 8; i++) if (scene.update) scene.update(1 / 60);
        ctx.reset();
        renderer.beginFrame('#05060d');
        scene.render(renderer, 1);
        renderer.endFrame();
        const total = ctx.calls.drawImage + ctx.calls.fillRect + ctx.calls.fill + ctx.calls.arc;
        if (total < 10) failures.push(`${id}: only ${total} draw ops`);
        if (ctx.calls.fillText < 2) failures.push(`${id}: rendered no text`);
        // A NaN coordinate is discarded by a real canvas: the widget is simply
        // absent, with no error. It is the single most common way a layout
        // rewrite loses a panel.
        if (ctx.nanDraws > 0) failures.push(`${id}: ${ctx.nanDraws} draws at a NaN position/size`);
        if (scene.exit) scene.exit();
      } catch (e) {
        failures.push(`${id}: ${(e && e.message) || String(e)}`);
      }
    }
    assert.equal(failures.length, 0, 'meta screens that failed:\n      ' + failures.join('\n      '));
  });

  it('the results screen renders a finished run', () => {
    const scene = sceneManager.scenes.results;
    assert.ok(scene, 'results scene is not registered');
    sceneManager.shared.lastResult = run.summary();
    scene.manager = sceneManager;
    if (scene.enter) scene.enter({}, sceneManager);
    for (let i = 0; i < 30; i++) if (scene.update) scene.update(1 / 60);
    ctx.reset();
    renderer.beginFrame('#05060d');
    scene.render(renderer, 1);
    renderer.endFrame();
    assert.atLeast(ctx.calls.fillRect + ctx.calls.fill, 10, 'results screen drew almost nothing');
    assert.atLeast(ctx.calls.fillText, 8, 'results screen rendered no text');
    if (scene.exit) scene.exit();
  });

  it('a gacha pull resolves end to end and persists before revealing', () => {
    // The anti-save-scum contract: the meta RNG position must be written to
    // storage BEFORE the caller can see a result.
    const banner = data.gacha.BANNERS.find((b) => b.type === 'standard');
    save.data.currencies.starFragments = 100000;
    const before = save.data.gacha.totalPulls;
    const res = sceneManager.gacha.pull(banner, 10);
    assert.ok(!res.error, res.error || '');
    assert.equal(res.results.length, 10);
    assert.equal(save.data.gacha.totalPulls, before + 10);
    // 10-pull guarantee: at least one ★4 or better.
    assert.ok(res.results.some((r) => r.rarity >= 4), 'the 10-pull guarantee did not hold');
    // The persisted stream position must already reflect the pull.
    const raw = JSON.parse(storage.read('gachaSurvivors.save.v1'));
    assert.equal(raw.gacha.totalPulls, before + 10,
                 'the pull was revealed before it was persisted — that is save-scummable');
  });

  it('EVERY banner can be pulled without throwing', () => {
    // The relic banner used to reach the character-rarity roll, spend the
    // player's fragments, and THEN throw on `banner.pool[3][0]` — because it has
    // only `pool.relics`. Testing one banner hid it.
    const failures = [];
    for (const banner of data.gacha.BANNERS) {
      save.data.currencies.starFragments = 1e9;
      save.data.gacha.beginnerUsed = false;
      save.data.unlocks.relicBanner = true;
      try {
        const res = sceneManager.gacha.pull(banner, 1);
        if (res.error) continue;                       // a clean refusal is fine
        if (!res.results.length) failures.push(`${banner.id}: succeeded but returned nothing`);
        for (const r of res.results) {
          if (!r.id) failures.push(`${banner.id}: a result had no id`);
        }
      } catch (e) {
        failures.push(`${banner.id} THREW: ${(e && e.message) || String(e)}`);
      }
    }
    assert.equal(failures.length, 0, failures.join('\n      '));
  });

  it('a refused pull never spends currency', () => {
    // The ordering rule: every refusal must happen before spendCurrency.
    const failures = [];
    for (const banner of data.gacha.BANNERS) {
      save.data.currencies.starFragments = 0;
      save.data.currencies.tickets = 0;
      const before = save.data.currencies.starFragments;
      let res;
      try { res = sceneManager.gacha.pull(banner, 10); }
      catch (e) { failures.push(`${banner.id} threw on a broke wallet`); continue; }
      if (!res.error) failures.push(`${banner.id}: pulled with 0 fragments`);
      if (save.data.currencies.starFragments !== before) {
        failures.push(`${banner.id}: spent ${before - save.data.currencies.starFragments} on a refused pull`);
      }
    }
    assert.equal(failures.length, 0, failures.join('\n      '));
  });

  it('a discounted banner lists its FULL price, so the discount applies once', () => {
    // The bug this locks down: the beginner banner stored costTen: 108 — already
    // 135 minus 20% — and cost() then applied `discount` again, charging 86 for
    // a banner whose own description promised 108.
    const failures = [];
    for (const banner of data.gacha.BANNERS) {
      if (!banner.discount) continue;
      if (banner.costTen !== undefined && banner.costTen < data.gacha.COST.ten) {
        failures.push(`${banner.id}: costTen ${banner.costTen} is below the ${data.gacha.COST.ten} ` +
                      `list price AND carries discount ${banner.discount} — that discounts twice`);
      }
      if (banner.costSingle !== undefined && banner.costSingle < data.gacha.COST.single) {
        failures.push(`${banner.id}: costSingle ${banner.costSingle} is pre-discounted`);
      }
    }
    assert.equal(failures.length, 0, failures.join('\n      '));
  });

  it('an "X instead of Y" price in a description is the price actually charged', () => {
    // Only this explicit phrasing is checked. Descriptions also quote pity pull
    // counts and rates, and a looser scan flags those as prices.
    const failures = [];
    for (const banner of data.gacha.BANNERS) {
      const text = (banner.desc || '') + ' ' + (banner.subDesc || '');
      const m = /\bfor\s+(\d{1,5})\s+instead of\s+(\d{1,5})/i.exec(text);
      if (!m) continue;
      const promised = +m[1];
      const charged = sceneManager.gacha.cost(banner, banner.pulls || 10);
      if (promised !== charged) {
        failures.push(`${banner.id}: promises ${promised}, engine charges ${charged}`);
      }
      const list = +m[2];
      if (list <= promised) failures.push(`${banner.id}: "instead of ${list}" is not a saving`);
    }
    assert.equal(failures.length, 0, failures.join('\n      '));
  });

  it('quoted pity pull counts match the real pity constants', () => {
    // "Guaranteed ★6 by pull 70" has to be true, or the counter on screen and
    // the sentence above it disagree.
    const failures = [];
    for (const banner of data.gacha.BANNERS) {
      const text = (banner.desc || '') + ' ' + (banner.subDesc || '');
      for (const m of text.matchAll(/★(\d)\s*by pull\s*(\d{1,3})/g)) {
        const rarity = +m[1], pull = +m[2];
        const expected = rarity >= 6 ? data.gacha.PITY.hard6 : data.gacha.PITY.hard5;
        if (pull !== expected) {
          failures.push(`${banner.id}: says ★${rarity} by pull ${pull}, real hard pity is ${expected}`);
        }
      }
    }
    assert.equal(failures.length, 0, failures.join('\n      '));
  });

  it('the relic banner is reachable once its achievement unlocks it', () => {
    const banner = data.gacha.BANNERS.find((b) => b.type === 'relic');
    assert.ok(banner, 'no relic banner');
    save.data.unlocks.relicBanner = false;
    save.data.achievements = {};
    assert.equal(sceneManager.gacha.isUnlocked(banner), false, 'relic banner starts unlocked');
    // The achievement's reward writes `unlocks.relicBanner`; the banner's
    // `unlockedBy` names the achievement id. Either spelling must open it.
    save.data.unlocks.relicBanner = true;
    assert.ok(sceneManager.gacha.isUnlocked(banner),
              'the achievement grants unlocks.relicBanner but the banner stayed locked');
    save.data.unlocks.relicBanner = false;
    save.data.achievements[banner.unlockedBy] = Date.now();
    assert.ok(sceneManager.gacha.isUnlocked(banner),
              'unlockedBy names an achievement id and that did not open it either');
  });

  it('banking a relic gives it a real in-run drop advantage', () => {
    save.data.currencies.starFragments = 1e9;
    save.data.unlocks.relicBanner = true;
    save.data.relics = {};
    const banner = data.gacha.BANNERS.find((b) => b.type === 'relic');
    const res = sceneManager.gacha.pull(banner, 1);
    assert.ok(!res.error, res.error || '');
    assert.equal(res.results.length, 1);
    const id = res.results[0].id;
    assert.ok(data.relics.RELICS_BY_ID[id], `pulled "${id}" which is not a relic`);
    assert.ok(save.data.relics[id].banked, 'the relic was not banked');
  });

  it('hard pity actually delivers a ★5 in a real pull sequence', () => {
    const banner = data.gacha.BANNERS.find((b) => b.type === 'standard');
    save.data.currencies.starFragments = 1e9;
    save.data.gacha.sharedPity5 = 0;
    save.data.gacha.pity = {};
    let pulls = 0, got5 = false;
    while (pulls < data.gacha.PITY.hard5 && !got5) {
      const res = sceneManager.gacha.pull(banner, 1);
      pulls++;
      if (res.results[0].rarity >= 5) got5 = true;
    }
    assert.ok(got5, `no ★5 within ${data.gacha.PITY.hard5} pulls — hard pity did not fire`);
  });

  it('melee characters connect within the first 20 seconds', () => {
    // Enemies spawn just off-screen and walk in. If the camera shows too much
    // world, first contact is 18 seconds away and every melee character has a
    // dead opening — which no error and no other test would ever surface.
    const slow = [];
    for (const c of data.characters.CHARACTERS) {
      const mode = c.autoAttack.targeting && c.autoAttack.targeting.mode;
      if (mode !== 'facing' && mode !== 'facingAuto' && mode !== 'aroundSelf') continue;
      const r2 = new Run(data, { characterId: c.id, stageId: data.stages.STAGES[0].id, tierIndex: 0, seed: 3 });
      let firstHit = -1;
      for (let i = 0; i < 1200; i++) {
        if (r2.state !== RUN_STATE.PLAYING) { r2.state = RUN_STATE.PLAYING; }
        input.moveX = 0; input.moveY = 0;
        r2.update(1 / 60);
        if (r2.stats.damageDealt > 0) { firstHit = r2.time; break; }
      }
      if (firstHit < 0 || firstHit > 20) slow.push(`${c.id} (${firstHit < 0 ? 'never' : firstHit.toFixed(1) + 's'})`);
      r2.dispose();
    }
    assert.equal(slow.length, 0,
                 'melee characters standing still hit nothing for 20s: ' + slow.join(', '));
  });
});
