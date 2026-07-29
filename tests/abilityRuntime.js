// Live ability execution.
//
// `abilityCoverage.js` proves every pillar is REGISTERED. This proves every
// pillar RUNS — which is a different question, and the one that catches the
// failures that matter:
//
//   - a special whose cast() works but whose tick() throws two seconds later
//   - an end() that throws when the duration expires
//   - an S3 or S5 branch that is dead code at star 1 and broken at star 5
//   - an escape that grants no i-frames, making it a worse dodge than walking
//
// Everything here runs at STAR LEVEL 5, so `ctx.s3` and `ctx.s5` are true and
// the upgrade branches actually execute. At star 1 roughly a third of the
// ability code in this project never runs at all.

import { describe, it, assert } from './harness.js';
import * as data from '../src/data/index.js';
import { Run, RUN_STATE } from '../src/game/run.js';
import { input, ACT } from '../src/core/input.js';
import { save } from '../src/core/save.js';
import { storage } from '../src/core/storage.js';
import { camera } from '../src/render/camera.js';
import { CONFIG } from '../src/core/config.js';

const DT = CONFIG.TICK_DT;
let lastManager = null;

function freshSave(star) {
  storage.useMemory();
  save.load();
  save.data.shrine = {};
  for (const c of data.characters.CHARACTERS) {
    save.data.roster[c.id] = { owned: true, starLevel: star, letters: 0, bond: 0, runs: 0, kills: 0 };
  }
}

function makeRun(charId, seed) {
  camera.resize(CONFIG.BASE_W, CONFIG.BASE_H);
  return new Run(data, {
    characterId: charId,
    stageId: data.stages.STAGES[0].id,
    tierIndex: 0,
    seed: seed || 4242,
  });
}

/** Advance, auto-resolving any screen that would otherwise freeze the sim. */
function step(run, ticks) {
  for (let i = 0; i < ticks; i++) {
    if (run.state === RUN_STATE.LEVEL_UP) { run.chooseUpgrade(0); continue; }
    if (run.state === RUN_STATE.CHEST) { run.closeChest(); continue; }
    if (run.state === RUN_STATE.RELIC_SWAP) { run.resolveRelicSwap(0); continue; }
    if (run.state !== RUN_STATE.PLAYING) run.state = RUN_STATE.PLAYING;
    run.update(DT);
  }
}

function press(action) { input.press(action); }
function clearPresses() {
  for (const a of [ACT.SPECIAL, ACT.ESCAPE]) { input._pressed[a] = false; input._latched[a] = false; }
}

describe('abilities / live execution at star 5 (S3 + S5 branches active)', () => {
  it('every special casts, ticks for its full duration, and ends — without throwing', () => {
    freshSave(5);
    const failures = [];
    for (const c of data.characters.CHARACTERS) {
      let run = null;
      try {
        run = makeRun(c.id);
        assert.equal(run.player.starLevel, 5, 'star level did not reach the player');
        // Let enemies arrive so targeting has something to find.
        input.moveX = 0; input.moveY = 0;
        step(run, 900);

        const before = run.player.special.charges;
        press(ACT.SPECIAL);
        step(run, 1);
        clearPresses();
        if (run.player.special.charges === before) {
          failures.push(`${c.id}: special did not consume a charge (cast returned false)`);
        }
        // Drive well past the longest special duration so tick() and end() run.
        step(run, 900);
      } catch (e) {
        failures.push(`${c.id}: ${(e && e.message) || String(e)}`);
      }
      if (run) run.dispose();
    }
    clearPresses();
    assert.equal(failures.length, 0, 'specials that failed:\n      ' + failures.join('\n      '));
  });

  it('every escape casts and grants real i-frames', () => {
    // SECTION 4: "Every character MUST have one — it is the skill-expression
    // button", and SECTION 17: "Every escape move grants i-frames and reliably
    // escapes a full surround."
    //
    // Untargetable and intangible count: Kira's Just As Planned makes enemies
    // lose track of him and Nekromina's Phase Out walks through them. Both are
    // stronger than i-frames, not weaker.
    freshSave(5);
    const failures = [];
    for (const c of data.characters.CHARACTERS) {
      let run = null;
      try {
        run = makeRun(c.id);
        input.moveX = 0; input.moveY = 0;
        step(run, 600);

        const before = run.player.escape.charges;
        run.player.st.invulnT = 0;
        run.player.st.untargetableT = 0;
        run.player.st.intangibleT = 0;
        press(ACT.ESCAPE);
        step(run, 1);
        clearPresses();

        if (run.player.escape.charges === before) {
          failures.push(`${c.id}: escape did not fire`);
        } else {
          const st = run.player.st;
          const protectedFor = Math.max(st.invulnT, st.untargetableT, st.intangibleT);
          if (protectedFor <= 0) {
            failures.push(`${c.id}: escape granted NO i-frames, untargetability or intangibility`);
          }
        }
        step(run, 600);   // let its tick/end run too
      } catch (e) {
        failures.push(`${c.id}: ${(e && e.message) || String(e)}`);
      }
      if (run) run.dispose();
    }
    clearPresses();
    assert.equal(failures.length, 0, 'escapes that failed:\n      ' + failures.join('\n      '));
  });

  it('S5 grants a second escape charge', () => {
    // SECTION 4: "S5: ESCAPE UPGRADE — the escape move gains an extra effect +
    // charges go 1 -> 2". A silent failure here costs the player half of the
    // most valuable star level in the game.
    freshSave(5);
    const bad = [];
    for (const c of data.characters.CHARACTERS) {
      const run = makeRun(c.id);
      if (run.player.escape.maxCharges < 2) bad.push(`${c.id} (${run.player.escape.maxCharges})`);
      run.dispose();
    }
    assert.equal(bad.length, 0, 'characters without 2 escape charges at S5: ' + bad.join(', '));
  });

  it('star levels actually change the numbers', () => {
    // S2 and S4 grant HP and auto-attack damage; if the pipeline drops them the
    // whole dupe economy is cosmetic.
    for (const c of data.characters.CHARACTERS.slice(0, 6)) {
      freshSave(1);
      const s1 = makeRun(c.id);
      const hp1 = s1.player.maxHp;
      const dmg1 = s1.player.autoDamageMultiplier();
      s1.dispose();

      freshSave(5);
      const s5 = makeRun(c.id);
      const hp5 = s5.player.maxHp;
      const dmg5 = s5.player.autoDamageMultiplier();
      s5.dispose();

      assert.ok(hp5 > hp1, `${c.id}: S5 max HP (${hp5.toFixed(0)}) not above S1 (${hp1.toFixed(0)})`);
      assert.ok(dmg5 > dmg1, `${c.id}: S5 auto damage not above S1`);
    }
  });

  it('every passive survives a long run without throwing', () => {
    // Passives are the ones that accumulate — "+0.5% per kill, uncapped",
    // "every 25 kills raise a zombie", "+2% per level". They break late, not
    // early, so a short test never reaches the failure.
    freshSave(5);
    const failures = [];
    for (const c of data.characters.CHARACTERS) {
      let run = null;
      try {
        run = makeRun(c.id, 909);
        for (let i = 0; i < 5400; i++) {   // 90 simulated seconds
          if (run.state === RUN_STATE.LEVEL_UP) { run.chooseUpgrade(0); continue; }
          if (run.state === RUN_STATE.CHEST) { run.closeChest(); continue; }
          if (run.state === RUN_STATE.RELIC_SWAP) { run.resolveRelicSwap(0); continue; }
          if (run.state === RUN_STATE.DEFEAT || run.state === RUN_STATE.VICTORY) break;
          input.moveX = Math.cos(i * 0.02);
          input.moveY = Math.sin(i * 0.017);
          if (i % 240 === 0) press(ACT.SPECIAL);
          if (i % 150 === 0) press(ACT.ESCAPE);
          run.update(DT);
          clearPresses();
        }
      } catch (e) {
        failures.push(`${c.id}: ${(e && e.message) || String(e)}`);
      }
      if (run) run.dispose();
    }
    clearPresses();
    assert.equal(failures.length, 0, 'passives that failed over 90s:\n      ' + failures.join('\n      '));
  });

  it('no kit drains its own owner to nothing', () => {
    // Several abilities charge HP to fire — that is a legitimate design. What is
    // NEVER legitimate is a self-cost that outruns the run: aoi's fumbled tray
    // charged a flat 3 HP every 3.6s against a 138 pool with no regen, clamped
    // at a floor of 1. It never "killed" her, so nothing threw and no assertion
    // caught it; she simply sat at 1 HP from minute three onward and died to the
    // first thing that touched her. The balance sweep found it — a six-star
    // below every three-star on the board — which is far too late and depends on
    // someone reading the table.
    //
    // The enemies are what makes this readable: with nothing attacking, any HP
    // lost is self-inflicted by definition, so the threshold needs no tuning.
    freshSave(5);
    const drained = [];
    for (const c of data.characters.CHARACTERS) {
      const run = makeRun(c.id, 4242);
      run.enemies.clear();
      let low = 1;
      // FOUR simulated minutes, because a drain is a RATE and a short window
      // cannot see one. At 60s the real bug had only taken aoi to 65% of her
      // pool — comfortably inside any sane threshold — and the test passed with
      // the defect fully present. It bottoms out at 166s.
      for (let i = 0; i < 14400; i++) {
        if (run.state === RUN_STATE.LEVEL_UP) { run.chooseUpgrade(0); continue; }
        if (run.state === RUN_STATE.CHEST) { run.closeChest(); continue; }
        if (run.state === RUN_STATE.RELIC_SWAP) { run.resolveRelicSwap(0); continue; }
        if (run.state === RUN_STATE.DEFEAT || run.state === RUN_STATE.VICTORY) break;
        run.enemies.clear();                 // keep the arena empty as waves land
        if (i % 240 === 0) press(ACT.SPECIAL);
        if (i % 150 === 0) press(ACT.ESCAPE);
        run.update(DT);
        clearPresses();
        low = Math.min(low, run.player.hp / run.player.maxHp);
      }
      // A quarter of the pool is generous: it leaves room for a real HP-cost
      // design and still catches anything that grinds itself down to a sliver.
      if (low < 0.25) drained.push(`${c.id}: fell to ${(low * 100).toFixed(0)}% of max, alone`);
      run.dispose();
    }
    clearPresses();
    assert.equal(drained.length, 0,
                 'kits that drain their own owner with no enemies present:\n      ' +
                 drained.join('\n      '));
  });

  it('every relic can be equipped and fires without throwing', () => {
    // Relics are hooked into the damage path, the interval tick and the HP
    // thresholds. A relic that throws takes the whole run down with it.
    freshSave(5);
    const failures = [];
    for (const relic of data.relics.RELICS) {
      let run = null;
      try {
        // Play the OWNER where there is one, so the resonance branch runs too.
        const charId = relic.owner || data.characters.CHARACTERS_BY_RARITY[5][0];
        run = makeRun(charId, 77);
        run.player.relics.length = 0;
        run.player.addRelic(relic.id);
        if (relic.owner && !run.player.resonatesWith(relic.id)) {
          failures.push(`${relic.id}: owner ${relic.owner} does not resonate with it`);
        }
        for (let i = 0; i < 3600; i++) {   // 60s — long enough for a 45s interval
          if (run.state === RUN_STATE.LEVEL_UP) { run.chooseUpgrade(0); continue; }
          if (run.state === RUN_STATE.CHEST) { run.closeChest(); continue; }
          if (run.state === RUN_STATE.RELIC_SWAP) { run.resolveRelicSwap(0); continue; }
          if (run.state === RUN_STATE.DEFEAT) break;
          input.moveX = Math.cos(i * 0.03); input.moveY = Math.sin(i * 0.03);
          if (i % 300 === 0) { press(ACT.SPECIAL); press(ACT.ESCAPE); }
          run.update(DT);
          clearPresses();
        }
      } catch (e) {
        failures.push(`${relic.id}: ${(e && e.message) || String(e)}`);
      }
      if (run) run.dispose();
    }
    clearPresses();
    assert.equal(failures.length, 0, 'relics that failed:\n      ' + failures.join('\n      '));
  });

  it('every evolution applies and runs without throwing', () => {
    freshSave(5);
    const failures = [];
    for (const evo of data.evolutions.EVOLUTIONS) {
      let run = null;
      try {
        run = makeRun(data.characters.CHARACTERS_BY_RARITY[5][0], 31);
        run.player.addRelic(evo.requires.relic);
        const up = data.upgrades.UPGRADES_BY_ID[evo.requires.upgrade];
        for (let i = 0; i < up.maxLevel; i++) run.player.addUpgrade(evo.requires.upgrade);
        run.grantEvolution(evo.id);
        if (run.player.evolutions.indexOf(evo.id) < 0) failures.push(`${evo.id}: was not recorded`);
        for (let i = 0; i < 1800; i++) {   // 30s, past the 6s railgun interval
          if (run.state === RUN_STATE.LEVEL_UP) { run.chooseUpgrade(0); continue; }
          if (run.state === RUN_STATE.CHEST) { run.closeChest(); continue; }
          if (run.state === RUN_STATE.RELIC_SWAP) { run.resolveRelicSwap(0); continue; }
          if (run.state === RUN_STATE.DEFEAT) break;
          input.moveX = Math.cos(i * 0.04); input.moveY = Math.sin(i * 0.04);
          if (i % 200 === 0) press(ACT.ESCAPE);
          run.update(DT);
          clearPresses();
        }
      } catch (e) {
        failures.push(`${evo.id}: ${(e && e.message) || String(e)}`);
      }
      if (run) run.dispose();
    }
    clearPresses();
    assert.equal(failures.length, 0, 'evolutions that failed:\n      ' + failures.join('\n      '));
  });

  it('ZERO COOLDOWN floors the escape at 0.6s rather than literally zero', () => {
    // DECISIONS.md §28. A literal zero plus Sora's Kaio-ken relic (a buff on
    // every escape) is an infinite buff loop.
    freshSave(5);
    const evo = data.evolutions.EVOLUTIONS_BY_ID.zero_cooldown;
    const run = makeRun(data.characters.CHARACTERS_BY_RARITY[5][0], 5);
    run.player.addRelic(evo.requires.relic);
    const up = data.upgrades.UPGRADES_BY_ID[evo.requires.upgrade];
    for (let i = 0; i < up.maxLevel; i++) run.player.addUpgrade(evo.requires.upgrade);
    run.grantEvolution(evo.id);
    const cd = run.player.escape.duration;
    assert.ok(cd > 0, 'escape cooldown became literally zero — that is the infinite loop');
    assert.close(cd, evo.params.cooldownFloor, 0.001,
                 `escape cooldown is ${cd}, expected the ${evo.params.cooldownFloor}s floor`);
    run.dispose();
  });

  it('a press made on a frame that runs NO sim step is not lost', () => {
    // THE responsiveness bug. The sim is a 60Hz accumulator; on a 144Hz display
    // ~58% of render frames complete without executing a single sim step. A
    // one-frame `_pressed` flag set on such a frame is cleared by endFrame()
    // before any sim step can read it — over half of all ability inputs
    // silently discarded, which is exactly what "abilities aren't responsive"
    // feels like. The latch has to survive until the sim consumes it.
    freshSave(5);
    const run = makeRun('rin', 8);
    step(run, 600);
    run.player.special.refill();

    // Simulate the press landing on a frame with zero sim steps.
    press(ACT.SPECIAL);
    input.endFrame();          // the render frame ends...
    input.ageLatches(0.007);   // ...144Hz worth of real time, still no sim step
    assert.equal(input.pressed(ACT.SPECIAL), false, 'the one-frame flag should be gone');
    assert.ok(input.peek(ACT.SPECIAL), 'the latch must survive endFrame');

    const before = run.player.special.charges;
    step(run, 1);              // NOW the sim finally runs
    assert.ok(run.player.special.charges < before,
              'the special did not fire — the press was dropped between frames');
    clearPresses();
    run.dispose();
  });

  it('a latched press expires rather than firing much later', () => {
    // The other half of the contract: a press made during a long pause must not
    // fire out of nowhere when play resumes.
    freshSave(5);
    const run = makeRun('rin', 9);
    step(run, 600);
    run.player.special.refill();

    press(ACT.SPECIAL);
    input.endFrame();
    input.ageLatches(0.5);     // half a second with no sim step
    assert.equal(input.peek(ACT.SPECIAL), false, 'a stale latch should have expired');

    const before = run.player.special.charges;
    step(run, 1);
    assert.equal(run.player.special.charges, before, 'an expired press still fired');
    clearPresses();
    run.dispose();
  });

  it('dying leaves the run scene and reaches the results screen', async () => {
    // "When you die you are stuck on the death screen." The end-of-run
    // transition is driven from runScene.update, which runs inside the
    // fixed-timestep loop — so anything that stalls the sim strands the player
    // on the death card with no way out.
    const { sceneManager } = await import('../src/scenes/sceneManager.js');
    const { runScene } = await import('../src/scenes/runScene.js');
    const main = await import('../src/main.js');

    freshSave(1);
    await sceneManager.init(data);
    sceneManager.shared.characterId = 'mochi';
    sceneManager.shared.stageId = data.stages.STAGES[0].id;
    sceneManager.shared.tierIndex = 0;
    sceneManager.shared.seed = 1234;

    sceneManager.current = runScene;
    sceneManager.currentId = 'run';
    runScene.enter({}, sceneManager);

    // Kill the player outright.
    runScene.run.player.hp = 1;
    runScene.run.player.st.invulnT = 0;
    runScene.run.player.iframeT = 0;
    runScene.run.onPlayerLethal(0, {});
    // Undying / Second Chance may revive; keep killing until he stays down.
    let guard = 0;
    while (!runScene.run.player.dead && guard++ < 8) {
      runScene.run.player.hp = 0;
      runScene.run.onPlayerLethal(0, {});
    }
    assert.ok(runScene.run.player.dead, 'the player did not die');
    assert.equal(runScene.run.state, RUN_STATE.DEFEAT);

    // Drive it exactly as main.js does — and with the SIM COMPLETELY FROZEN, to
    // prove the transition does not depend on it. This is the actual failure
    // being guarded: a stalled sim used to strand the player here forever.
    main.setTimeScale(0);
    let reached = '';
    for (let i = 0; i < 600; i++) {
      sceneManager.updateRealtime(1 / 60);   // real time keeps flowing...
      // ...but no sim step ever runs.
      if (sceneManager.currentId === 'results' || sceneManager._pending) {
        reached = sceneManager._pending ? sceneManager._pending.id : sceneManager.currentId;
        break;
      }
    }
    main.setTimeScale(1);
    assert.equal(reached, 'results',
                 'never left the death screen — the player is stuck with no way out');

    // Finish the transition WITHOUT EVER CALLING update(). The cross-fade used
    // to tick on sim time, so initiating the switch in real time still left the
    // player stranded mid-fade — the death screen "had no way out" even though
    // the decision to leave had already been made.
    for (let i = 0; i < 240 && sceneManager.currentId !== 'results'; i++) {
      sceneManager.updateRealtime(1 / 60);
    }
    assert.equal(sceneManager.currentId, 'results', 'the results scene never became current');
    assert.ok(sceneManager.shared.lastResult, 'no run summary was handed to results');
    assert.equal(main.game.timeScale, 1, 'time scale was left slowed after death');
  });

  it('the magnet actually delivers every gem to the player', () => {
    // The bug: magnet acceleration accumulated with no damping, so gems built
    // speed, overshot, and ORBITED the player forever — "crystals fly around
    // the screen but never reach you". They also tunnelled straight through the
    // 16px collection window at 1500 px/s.
    freshSave(1);
    const run = makeRun('rin', 55);
    run.pickups.clear();
    // Scatter gems all around, including far out and directly on top.
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const d = 120 + (i % 5) * 160;
      run.pickups.dropGem(run.player.x + Math.cos(a) * d, run.player.y + Math.sin(a) * d, 5);
    }
    const dropped = run.pickups.count;
    assert.atLeast(dropped, 30, 'gems did not spawn');

    run.pickups.magnetAll();
    const xpBefore = run.player.xp + run.player.level * 1000;
    // Freeze the player so this measures the magnet, not the player chasing.
    for (let i = 0; i < 300; i++) {   // 5 seconds
      input.moveX = 0; input.moveY = 0;
      run.pickups.update(DT);
    }
    let gemsLeft = 0;
    for (let i = 0; i < run.pickups.count; i++) {
      const g = run.pickups.items[i];
      if (g.kind === 0 || g.kind === 1) gemsLeft++;
    }
    assert.equal(gemsLeft, 0, `${gemsLeft} of ${dropped} gems never arrived — they are orbiting`);
    assert.ok(run.player.xp + run.player.level * 1000 > xpBefore, 'no XP was actually credited');
    run.dispose();
  });

  it('gems inside the pickup radius are collected without a magnet', () => {
    freshSave(1);
    const run = makeRun('rin', 56);
    run.pickups.clear();
    for (let i = 0; i < 12; i++) {
      run.pickups.dropGem(run.player.x + (i - 6) * 4, run.player.y + 10, 3);
    }
    for (let i = 0; i < 240; i++) { input.moveX = 0; input.moveY = 0; run.pickups.update(DT); }
    let left = 0;
    for (let i = 0; i < run.pickups.count; i++) {
      const g = run.pickups.items[i];
      if (g.kind === 0 || g.kind === 1) left++;
    }
    assert.equal(left, 0, `${left} gems sat inside the pickup radius uncollected`);
    run.dispose();
  });

  it('the build-slot cap stops offering NEW upgrades but keeps levelling old ones', () => {
    // Without a cap the level-up screen is not a decision — every run converges
    // on the same maxed list.
    freshSave(1);
    const run = makeRun('rin', 57);
    const B = data.upgrades.BUILD_SLOTS;

    // Fill the offensive bucket.
    const offensive = data.upgrades.UPGRADES.filter((u) => B.bucketOf(u) === 'offensive');
    for (let i = 0; i < B.offensive; i++) run.player.addUpgrade(offensive[i].id);
    const slots = run.buildSlots();
    assert.equal(slots.used.offensive, B.offensive, 'the bucket did not fill');

    // Roll many times; no NEW offensive upgrade may be offered.
    const held = Object.keys(run.player.upgrades);
    for (let n = 0; n < 200; n++) {
      for (const ch of run.rollUpgradeChoices()) {
        if (ch.kind !== 'upgrade') continue;
        if (B.bucketOf(ch.up) !== 'offensive') continue;
        assert.includes(held, ch.up.id,
                        `offered NEW offensive upgrade "${ch.up.id}" with the bucket full`);
      }
    }

    // And an already-held upgrade must still be offerable, or the player is
    // locked out of improving at all.
    let sawHeld = false;
    for (let n = 0; n < 200 && !sawHeld; n++) {
      for (const ch of run.rollUpgradeChoices()) {
        if (ch.kind === 'upgrade' && held.indexOf(ch.up.id) >= 0) sawHeld = true;
      }
    }
    assert.ok(sawHeld, 'a full build can never level anything up again');
    run.dispose();
  });

  it('the utility bucket is capped independently of the offensive one', () => {
    // So a damage build cannot crowd out every defensive option.
    freshSave(1);
    const run = makeRun('rin', 58);
    const B = data.upgrades.BUILD_SLOTS;
    const offensive = data.upgrades.UPGRADES.filter((u) => B.bucketOf(u) === 'offensive');
    for (let i = 0; i < B.offensive; i++) run.player.addUpgrade(offensive[i].id);

    let sawUtility = false;
    for (let n = 0; n < 120 && !sawUtility; n++) {
      for (const ch of run.rollUpgradeChoices()) {
        if (ch.kind === 'upgrade' && B.bucketOf(ch.up) === 'utility') sawUtility = true;
      }
    }
    assert.ok(sawUtility, 'a full offensive bucket blocked utility upgrades too');
    run.dispose();
  });

  it('EVERY upgrade measurably changes the player', () => {
    // The bug this exists to prevent: `lodestone` declared stat
    // `pickupRadiusMult` while the pipeline only knew `pickupRadius`, so it
    // wrote to a field nothing read. Lodestone and Swift Boots did NOTHING for
    // the entire life of the project — no error, no warning, no failing test,
    // and the only symptom was a player noticing their pickup range never grew.
    freshSave(1);
    const dead = [];
    for (const up of data.upgrades.UPGRADES) {
      const run = makeRun('rin', 60);
      const before = JSON.stringify(run.player.stats);
      for (let i = 0; i < up.maxLevel; i++) run.player.addUpgrade(up.id);
      const after = JSON.stringify(run.player.stats);
      if (before === after) dead.push(`${up.id} (stat "${up.stat}")`);
      run.dispose();
    }
    assert.equal(dead.length, 0,
                 'upgrades that change NOTHING:\n      ' + dead.join('\n      '));
  });

  it('every upgrade stat is a real stat, not an invented field', () => {
    freshSave(1);
    const run = makeRun('rin', 61);
    const known = Object.keys(run.player.stats);
    const bridged = ['pickupRadiusMult', 'moveSpeedMult', 'maxHpMult', 'armorMult', 'regenMult'];
    // Shrine rows consumed directly by run.js (rerolls, banishes, enemy count)
    // never touch the stat pipeline. Those are legitimate — they are read from
    // save.data.shrine at run start — but they must be DECLARED as such so this
    // test can tell them apart from a typo that silently does nothing.
    const runScoped = ['freeRerolls', 'banishes', 'countMult'];
    const bad = [];
    for (const up of data.upgrades.UPGRADES) {
      if (known.indexOf(up.stat) < 0 && bridged.indexOf(up.stat) < 0) {
        bad.push(`${up.id} -> "${up.stat}"`);
      }
    }
    for (const sh of data.shrine.SHRINE_UPGRADES) {
      if (!sh.stat) continue;
      if (known.indexOf(sh.stat) >= 0 || bridged.indexOf(sh.stat) >= 0) continue;
      if (runScoped.indexOf(sh.stat) >= 0) continue;
      bad.push(`shrine ${sh.id} -> "${sh.stat}"`);
    }
    run.dispose();
    assert.equal(bad.length, 0, 'stats nothing reads:\n      ' + bad.join('\n      '));
  });

  it('the run-scoped shrine upgrades really are applied somewhere', () => {
    // The flip side: exempting them from the stat check must not become a place
    // for a genuinely dead upgrade to hide.
    freshSave(1);
    save.data.shrine = { rerolls: 3, banish: 3, curse: 5 };
    const run = makeRun('rin', 65);
    assert.atLeast(run.rerollsLeft, 3, 'Shrine Rerolls granted no rerolls');
    assert.atLeast(run.banishesLeft, 3, 'Shrine Banish granted no banishes');
    assert.ok(run.difficultyMult.count > 1, 'Shrine Curse did not raise enemy count');
    assert.ok(run.difficultyMult.reward > 1, 'Shrine Curse did not raise rewards');
    run.dispose();
    save.data.shrine = {};
  });

  it('EVERY shrine row measurably changes the run', () => {
    // The Lodestone bug, one layer up. A shrine row whose stat key nothing reads
    // takes real gold, forever, and does nothing — with no error, no warning and
    // no failing test, which is exactly how Lodestone and Swift Boots survived
    // the entire life of the project. The row above exempts the run-scoped stats
    // from the key check; this one closes the loophole from the other side by
    // asking what actually MOVED, so a row cannot be dead in either direction.
    freshSave(1);
    const base = makeRun('rin', 70);
    const before = JSON.stringify(base.player.stats);
    const beforeRun = [base.rerollsLeft, base.banishesLeft,
                       base.difficultyMult.count, base.difficultyMult.reward].join('|');
    base.dispose();

    const dead = [];
    let seed = 71;
    for (const u of data.shrine.SHRINE_UPGRADES) {
      save.data.shrine = {};
      save.data.shrine[u.id] = u.maxLevel;
      const run = makeRun('rin', seed++);
      const after = JSON.stringify(run.player.stats);
      const afterRun = [run.rerollsLeft, run.banishesLeft,
                        run.difficultyMult.count, run.difficultyMult.reward].join('|');
      if (before === after && beforeRun === afterRun) dead.push(u.id);
      run.dispose();
    }
    save.data.shrine = {};
    assert.equal(dead.length, 0,
                 'shrine rows that change NOTHING: ' + dead.join(', '));
  });

  it('Lodestone actually widens the pickup radius', () => {
    // The reported symptom, asserted directly.
    freshSave(1);
    const run = makeRun('rin', 62);
    const base = run.player.stats.pickupRadius;
    const up = data.upgrades.UPGRADES_BY_ID.lodestone;
    for (let i = 0; i < up.maxLevel; i++) run.player.addUpgrade('lodestone');
    const grown = run.player.stats.pickupRadius;
    assert.ok(grown > base * 1.5,
              `pickup radius went ${base.toFixed(0)} -> ${grown.toFixed(0)} at max Lodestone`);

    // And the wider radius must actually collect from further away.
    run.pickups.clear();
    const d = base * 1.35;    // outside the base radius, inside the upgraded one
    run.pickups.dropGem(run.player.x + d, run.player.y, 5);
    for (let i = 0; i < 300; i++) { input.moveX = 0; input.moveY = 0; run.pickups.update(DT); }
    let left = 0;
    for (let i = 0; i < run.pickups.count; i++) if (run.pickups.items[i].kind === 0) left++;
    assert.equal(left, 0, 'a gem inside the UPGRADED radius was never picked up');
    run.dispose();
  });

  it('Swift Boots actually makes you faster', () => {
    freshSave(1);
    const run = makeRun('rin', 63);
    const base = run.player.stats.moveSpeed;
    const up = data.upgrades.UPGRADES_BY_ID.swift_boots;
    for (let i = 0; i < up.maxLevel; i++) run.player.addUpgrade('swift_boots');
    assert.ok(run.player.stats.moveSpeed > base * 1.3,
              `move speed went ${base.toFixed(0)} -> ${run.player.stats.moveSpeed.toFixed(0)}`);
    run.dispose();
  });

  it('percentage stats add rather than compound', () => {
    // Three sources of +22% should be +66%, not 1.22^3 = +82%.
    freshSave(1);
    const run = makeRun('rin', 64);
    const base = run.player.stats.pickupRadius;
    run.player.addUpgrade('lodestone');
    run.player.addUpgrade('lodestone');
    run.player.addUpgrade('lodestone');
    const per = data.upgrades.UPGRADES_BY_ID.lodestone.perLevel;
    assert.close(run.player.stats.pickupRadius, base * (1 + per * 3), 0.5,
                 'percentage stats are compounding instead of summing');
    run.dispose();
  });

  it('DYING still banks every coin and fragment earned', async () => {
    // SECTION 2: "Dying = run ends, but you KEEP all currency earned (never
    // punish the player by voiding their run rewards — this is a roguelite, not
    // a punishment box)." If this fails, meta progression is unreachable.
    const { sceneManager } = await import('../src/scenes/sceneManager.js');
    const { runScene } = await import('../src/scenes/runScene.js');
    const { storage } = await import('../src/core/storage.js');

    freshSave(1);
    await sceneManager.init(data);
    save.data.currencies.gold = 0;
    save.data.currencies.starFragments = 0;
    save.save();

    sceneManager.shared.characterId = 'mochi';
    sceneManager.shared.stageId = data.stages.STAGES[0].id;
    sceneManager.shared.tierIndex = 0;
    sceneManager.shared.seed = 4242;
    sceneManager.current = runScene;
    sceneManager.currentId = 'run';
    runScene.enter({}, sceneManager);

    // Earn something, then die.
    runScene.run.grantGold(250);
    runScene.run.pendingFragments = 30;
    const earnedGold = runScene.run.stats.gold;
    assert.atLeast(earnedGold, 250, 'gold was not credited to the run');

    runScene.run.player.hp = 0;
    runScene.run.player.st.invulnT = 0;
    runScene.run.player.iframeT = 0;
    let guard = 0;
    while (!runScene.run.player.dead && guard++ < 8) {
      runScene.run.player.hp = 0;
      runScene.run.onPlayerLethal(0, {});
    }
    assert.ok(runScene.run.player.dead, 'the player did not die');

    for (let i = 0; i < 600 && sceneManager.currentId !== 'results'; i++) {
      sceneManager.updateRealtime(1 / 60);
    }
    assert.equal(sceneManager.currentId, 'results', 'never reached the results screen');

    // IN MEMORY
    assert.atLeast(save.data.currencies.gold, earnedGold,
                   `gold was voided on death: have ${save.data.currencies.gold}, earned ${earnedGold}`);
    assert.atLeast(save.data.currencies.starFragments, 30,
                   'star fragments were voided on death');

    // AND ON DISK — crediting in memory without persisting is the same bug from
    // the player's point of view: it is gone the moment they reload.
    const raw = storage.read('gachaSurvivors.save.v1');
    assert.ok(raw, 'nothing was written to storage at all');
    const disk = JSON.parse(raw);
    assert.atLeast(disk.currencies.gold, earnedGold,
                   `gold reached memory but NOT disk (disk has ${disk.currencies.gold})`);
    assert.atLeast(disk.currencies.starFragments, 30,
                   'fragments reached memory but not disk');
    lastManager = sceneManager;
  });

  it('the results payout cannot double-pay on a re-entry', () => {
    // The other half: a guard that is too weak pays twice, which is just as
    // broken in the other direction.
    // Uses whatever the previous test left current.
    const before = save.data.currencies.gold;
    const mgr = lastManager;
    if (!mgr || !mgr.scenes.results) return;
    mgr.scenes.results.enter({}, mgr);
    mgr.scenes.results.enter({}, mgr);
    assert.equal(save.data.currencies.gold, before,
                 're-entering results paid the run out again');
  });

  it('a seeded run is reproducible', () => {
    // The whole determinism contract: same seed, same outcome. If this fails,
    // the balance harness is measuring noise and replays are impossible.
    freshSave(3);
    const a = makeRun('rin', 13579);
    step(a, 3000);
    const sa = a.summary();
    a.dispose();

    freshSave(3);
    const b = makeRun('rin', 13579);
    step(b, 3000);
    const sb = b.summary();
    b.dispose();

    assert.equal(sa.kills, sb.kills, 'same seed produced different kill counts');
    assert.close(sa.damageDealt, sb.damageDealt, 0.01, 'same seed produced different damage');
    assert.equal(sa.level, sb.level, 'same seed produced different levels');
  });

  it('a seed still reproduces after a DIFFERENT run has been played', () => {
    // The test above replays back to back from a clean-ish process, which is
    // exactly the case module-level state survives. Two things did:
    //
    //   - the camera kept its zoom and punch timers, and enemy.js derives its
    //     cull distance from camera.scale, so run 2 could see further than run 1
    //   - `nextUid` was a module counter, and three behaviours read e.uid as a
    //     SEED (swarmer wobble phase, orbiter and ambusher rotation direction),
    //     so run 2's horde moved differently from run 1's
    //
    // Neither threw. Both silently made `node sim.js --all` measure a different
    // game for every character after the first: the same character on the same
    // seed came out anywhere from 185s to 307s, and every number in BALANCE.md
    // inherited that noise.
    freshSave(3);
    const a = makeRun('kagura', 24680);
    step(a, 1800);
    const sa = a.summary();
    a.dispose();

    // Churn: a different character, a different seed, a different stage — the
    // shape of a sweep. Then replay the first run and demand it match.
    freshSave(3);
    const noise = new Run(data, {
      characterId: 'sovereign_alicia', stageId: data.stages.STAGES[2].id,
      tierIndex: 1, seed: 111,
    });
    step(noise, 1800);
    noise.dispose();

    freshSave(3);
    const b = makeRun('kagura', 24680);
    step(b, 1800);
    const sb = b.summary();
    b.dispose();

    assert.equal(sa.kills, sb.kills, 'an intervening run changed the replay of a seeded run');
    assert.close(sa.damageDealt, sb.damageDealt, 0.01, 'an intervening run changed the damage dealt');
    assert.equal(sa.level, sb.level, 'an intervening run changed the level reached');
  });
});
