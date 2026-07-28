// THE WEAPON SYSTEM, EXECUTED.
//
// Registering a weapon proves nothing; this suite fires every one of them, at
// every level and in its evolved form, into a live run full of enemies and
// asserts that damage actually lands. The failure modes it exists to catch are
// all silent ones:
//
//   - a weapon whose `kind` has no implementation (it simply never fires, and
//     the player's third slot is dead for the whole run)
//   - a level row missing a field the impl reads (NaN damage, no error)
//   - an evolution whose `persist` never runs, so "always active" is a lie
//   - the signature nerf failing to apply, or failing to scale back up
//   - the slot cap not holding, which is the whole design
//   - a level-up screen that can be handed a card kind it cannot render

import { describe, it, assert } from './harness.js';
import * as data from '../src/data/index.js';
import { Run, RUN_STATE } from '../src/game/run.js';
import { save } from '../src/core/save.js';
import { storage } from '../src/core/storage.js';
import { camera } from '../src/render/camera.js';
import { CONFIG } from '../src/core/config.js';
import { WEAPON_IMPLS } from '../src/game/abilities/weaponImpls.js';
import { SIGNATURE_ID } from '../src/game/weapons.js';

const DT = CONFIG.TICK_DT;
const W = data.weapons;

function freshSave() {
  storage.useMemory();
  save.load();
  save.data.shrine = {};
  for (const c of data.characters.CHARACTERS) {
    save.data.roster[c.id] = { owned: true, starLevel: 1, letters: 0, bond: 0, runs: 0, kills: 0 };
  }
}

function makeRun(seed) {
  camera.resize(CONFIG.BASE_W, CONFIG.BASE_H);
  return new Run(data, {
    characterId: data.characters.CHARACTERS[0].id,
    stageId: data.stages.STAGES[0].id,
    tierIndex: 0,
    seed: seed || 909,
  });
}

function step(run, ticks) {
  for (let i = 0; i < ticks; i++) {
    if (run.state !== RUN_STATE.PLAYING) run.state = RUN_STATE.PLAYING;
    run.update(DT);
  }
}

/** Park a wall of enemies right on top of the player so every shape connects. */
function surround(run, n) {
  const p = run.player;
  const def = data.enemies.ENEMIES[0];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const d = 40 + (i % 4) * 22;
    const e = run.enemies.spawn(def, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, {});
    if (e) { e.hp = e.maxHp = 1e7; e.spawnT = 0; e.baseSpeed = 0; e.speed = 0; }
  }
  run.enemyHash.build(run.enemies.items, run.enemies.count);
}

// ---------------------------------------------------------------------------
describe('weapons / data integrity', () => {
  it('every weapon has an implementation for its kind', () => {
    const missing = W.WEAPONS.filter((w) => !WEAPON_IMPLS[w.kind]).map((w) => w.id + ':' + w.kind);
    assert.equal(missing.length, 0, 'weapons with no impl: ' + missing.join(', '));
  });

  it('every weapon has exactly 8 levels, an evolution and a visual', () => {
    for (const w of W.WEAPONS) {
      assert.equal(w.levels.length, 8, w.id + ' must have 8 levels');
      assert.ok(w.evolution && w.evolution.stats, w.id + ' has no evolution stats');
      assert.ok(w.visual, w.id + ' has no visual to pre-raster');
      for (let i = 0; i < w.levels.length; i++) {
        const L = w.levels[i];
        assert.ok(L.note && L.note.length > 4, `${w.id} level ${i + 1} has no note`);
        assert.ok(L.damage > 0, `${w.id} level ${i + 1} has no damage`);
        assert.ok(L.interval > 0, `${w.id} level ${i + 1} has no interval`);
      }
    }
  });

  it('every weapon level is a strict improvement on the one before it', () => {
    // A level that does not measurably change anything is a level-up the player
    // spent a choice on and got nothing for. SECTION 10's rule, applied here.
    const flat = [];
    for (const w of W.WEAPONS) {
      for (let i = 1; i < w.levels.length; i++) {
        const a = w.levels[i - 1], b = w.levels[i];
        let better = b.damage > a.damage || b.interval < a.interval;
        for (const k of ['radius', 'count', 'pierce', 'arc', 'speed', 'blast',
                         'duration', 'burn', 'slow', 'knockback', 'range']) {
          if (b[k] !== undefined && a[k] !== undefined && b[k] > a[k]) better = true;
        }
        if (!better) flat.push(`${w.id} level ${i + 1}`);
      }
    }
    assert.equal(flat.length, 0, 'levels that change nothing: ' + flat.join(', '));
  });

  it('the signature curve starts as a real nerf and ends far above it', () => {
    const L = W.SIGNATURE_LEVELS;
    assert.equal(L.length, 8);
    // The nerf is judged on DPS, not on damage alone — damage and rate are two
    // halves of the same number and either one on its own is easy to fool.
    const dps1 = L[0].damage * L[0].rate;
    assert.ok(dps1 < 0.7, 'level 1 must be a genuine nerf; DPS ratio is ' + dps1.toFixed(2));
    assert.ok(L[0].damage < 1, 'level 1 must hit softer than the authored value');
    assert.ok(L[0].rate < 1, 'level 1 must swing slower than the authored interval');
    assert.ok(L[0].area < 1, 'level 1 must cover less ground');
    assert.ok(L[7].damage > 2, 'a maxed signature must far exceed the old baseline');
    for (let i = 1; i < L.length; i++) {
      assert.ok(L[i].damage > L[i - 1].damage, 'signature damage must climb every level');
      assert.ok(L[i].rate >= L[i - 1].rate, 'signature rate must never regress');
    }
    assert.ok(W.SIGNATURE_EVOLUTION.stats.rate > L[7].rate * 1.5,
              'the evolution must read as continuous, not merely faster');
  });
});

// ---------------------------------------------------------------------------
describe('weapons / live execution', () => {
  it('EVERY weapon at EVERY level fires and deals damage', () => {
    freshSave();
    const failures = [];
    for (const def of W.WEAPONS) {
      for (let lvl = 1; lvl <= 8; lvl++) {
        let run = null;
        try {
          run = makeRun(1000 + lvl);
          const w = run.weapons.add(def.id);
          assert.ok(w, def.id + ' could not be added');
          w.level = lvl;
          surround(run, 26);
          const before = run.stats.damageDealt;
          step(run, 300);          // 5 seconds — longer than any interval here
          if (run.stats.damageDealt <= before) {
            failures.push(`${def.id} Lv${lvl} dealt no damage in 5s`);
          }
        } catch (e) {
          failures.push(`${def.id} Lv${lvl}: ${(e && e.stack) || String(e)}`);
        }
        if (run) run.dispose();
      }
    }
    assert.equal(failures.length, 0, failures.slice(0, 8).join('\n      '));
  });

  it('EVERY weapon evolves, runs its always-on form, and hits harder for it', () => {
    freshSave();
    const failures = [];
    for (const def of W.WEAPONS) {
      let maxed = null, evolved = null;
      try {
        // maxed, un-evolved
        let run = makeRun(77);
        let w = run.weapons.add(def.id);
        w.level = 8;
        surround(run, 26);
        step(run, 360);
        maxed = run.stats.damageDealt;
        run.dispose();

        // evolved
        run = makeRun(77);
        w = run.weapons.add(def.id);
        w.level = 8;
        assert.ok(run.weapons.evolve(def.id), def.id + ' refused to evolve at max level');
        assert.ok(w.evolved, def.id + ' did not record the evolution');
        surround(run, 26);
        step(run, 360);
        evolved = run.stats.damageDealt;
        run.dispose();

        if (!(evolved > maxed)) {
          failures.push(`${def.id}: evolved ${Math.round(evolved)} <= maxed ${Math.round(maxed)}`);
        }
      } catch (e) {
        failures.push(`${def.id}: ${(e && e.stack) || String(e)}`);
      }
    }
    assert.equal(failures.length, 0, failures.slice(0, 8).join('\n      '));
  });

  it('a weapon cannot evolve before it is maxed', () => {
    freshSave();
    const run = makeRun();
    const def = W.WEAPONS[0];
    run.weapons.add(def.id);
    assert.equal(run.weapons.evolve(def.id), false, 'evolved at level 1');
    run.weapons.get(def.id).level = 8;
    assert.equal(run.weapons.evolve(def.id), true, 'refused to evolve at max');
    assert.equal(run.weapons.evolve(def.id), false, 'evolved twice');
    run.dispose();
  });
});

// ---------------------------------------------------------------------------
describe('weapons / the three-slot cap', () => {
  it('the signature occupies slot 0 and only two more will fit', () => {
    freshSave();
    const run = makeRun();
    assert.equal(run.weapons.count, 1, 'the signature must be there from tick zero');
    assert.equal(run.weapons.slots[0].id, SIGNATURE_ID);
    assert.equal(run.weapons.slots[0].signature, true);

    const taken = [];
    for (const def of W.WEAPONS) if (run.weapons.add(def.id)) taken.push(def.id);
    assert.equal(taken.length, W.WEAPON_SLOTS - 1,
                 'took ' + taken.length + ' weapons past the signature');
    assert.equal(run.weapons.count, W.WEAPON_SLOTS);
    assert.ok(run.weapons.full);
    run.dispose();
  });

  it('a full arsenal stops being offered NEW weapons but keeps offering levels', () => {
    freshSave();
    const run = makeRun();
    for (const def of W.WEAPONS) run.weapons.add(def.id);
    assert.ok(run.weapons.full);
    let sawNew = false, sawLevel = false;
    for (let i = 0; i < 200; i++) {
      for (const c of run.rollUpgradeChoices()) {
        if (c.kind === 'newWeapon') sawNew = true;
        if (c.kind === 'weapon') sawLevel = true;
      }
    }
    assert.equal(sawNew, false, 'offered a new weapon with every slot full');
    assert.ok(sawLevel, 'never offered to level a weapon it already had');
    run.dispose();
  });

  it('weapon levels never leak into player.upgrades', () => {
    // Nine other systems walk that map — a character passive sums it, the build
    // slots count it, the results screen renders it. None of them would throw.
    freshSave();
    const run = makeRun();
    for (const def of W.WEAPONS) run.weapons.add(def.id);
    for (const w of run.weapons.slots) { w.level = 8; run.weapons.evolve(w.id); }
    for (const id in run.player.upgrades) {
      assert.ok(data.upgrades.UPGRADES_BY_ID[id], 'unknown id in player.upgrades: ' + id);
    }
    assert.equal(run.player.evolutions.length, 0,
                 'weapon evolutions must not count toward the 8 build evolutions');
    run.dispose();
  });
});

// ---------------------------------------------------------------------------
describe('weapons / the signature nerf and its climb', () => {
  it('a level-1 signature does markedly less damage than a maxed one', () => {
    freshSave();
    const sample = (level, evolved) => {
      const run = makeRun(31);
      const w = run.weapons.slots[0];
      w.level = level;
      if (evolved) w.evolved = true;
      run.weapons._rebuildMods();
      surround(run, 26);
      step(run, 420);
      const d = run.stats.damageDealt;
      run.dispose();
      return d;
    };
    const lo = sample(1, false);
    const hi = sample(8, false);
    const evo = sample(8, true);
    assert.ok(lo > 0, 'a level-1 signature must still do something');
    assert.ok(hi > lo * 2.5, `maxed ${Math.round(hi)} should dwarf level 1 ${Math.round(lo)}`);
    assert.ok(evo > hi, `evolved ${Math.round(evo)} should beat maxed ${Math.round(hi)}`);
  });

  it('the signature level scales area, projectile count and pierce, not just damage', () => {
    freshSave();
    const run = makeRun();
    const p = run.player;
    const w = run.weapons.slots[0];

    w.level = 1; run.weapons._rebuildMods();
    p.autoScope = true;
    const a1 = run.data.upgrades ? p.stats.areaMult : 1;   // keep the read honest
    const area1 = areaProbe(run, p, 100);
    const shots1 = shotProbe(p);
    const pierce1 = pierceProbe(p);
    p.autoScope = false;

    w.level = 8; run.weapons._rebuildMods();
    p.autoScope = true;
    const area8 = areaProbe(run, p, 100);
    const shots8 = shotProbe(p);
    const pierce8 = pierceProbe(p);
    p.autoScope = false;

    assert.ok(area8 > area1, `area ${area8} should exceed ${area1}`);
    assert.ok(shots8 > shots1, `extra shots ${shots8} should exceed ${shots1}`);
    assert.ok(pierce8 > pierce1, `pierce ${pierce8} should exceed ${pierce1}`);
    assert.ok(a1 >= 0);
    run.dispose();
  });

  it('the signature bonuses do NOT leak into specials and escapes', () => {
    // helpers.area() is shared by all four pillars. If the scope flag were
    // sticky, every special in the game would silently inherit the weapon level.
    freshSave();
    const run = makeRun();
    const p = run.player;
    run.weapons.slots[0].level = 8;
    run.weapons._rebuildMods();
    assert.equal(p.autoScope, false, 'the auto scope must not be set outside a fire()');
    const outside = areaProbe(run, p, 100);
    step(run, 240);                       // plenty of real auto-attacks
    assert.equal(p.autoScope, false, 'the auto scope leaked past a fire()');
    assert.equal(areaProbe(run, p, 100), outside, 'area changed outside an auto-attack');
    run.dispose();
  });
});

// ---------------------------------------------------------------------------
describe('weapons / the level-up offer', () => {
  it('weapons really are offered, and every offered kind is one the UI can draw', () => {
    freshSave();
    const run = makeRun(5150);
    const KNOWN = ['upgrade', 'evolution', 'gold', 'weapon', 'newWeapon', 'weaponEvo'];
    const seen = Object.create(null);
    for (let i = 0; i < 300; i++) {
      for (const c of run.rollUpgradeChoices()) {
        assert.ok(KNOWN.indexOf(c.kind) >= 0, 'unrenderable choice kind: ' + c.kind);
        seen[c.kind] = (seen[c.kind] || 0) + 1;
      }
    }
    assert.ok(seen.newWeapon > 0, 'never offered a new weapon');
    assert.ok(seen.weapon > 0, 'never offered a weapon level');
    assert.ok(seen.upgrade > 0, 'stat upgrades stopped being offered');
    run.dispose();
  });

  it('a maxed weapon is always offered its evolution', () => {
    freshSave();
    const run = makeRun();
    const def = W.WEAPONS[1];
    run.weapons.add(def.id);
    run.weapons.get(def.id).level = 8;
    const choices = run.rollUpgradeChoices();
    assert.equal(choices[0].kind, 'weaponEvo', 'the evolve card must take the first slot');
    assert.equal(choices[0].w.id, def.id);
    run.dispose();
  });

  it('choosing each weapon card kind applies it', () => {
    freshSave();
    const run = makeRun();
    const def = W.WEAPONS[2];

    run.levelUpChoices = [{ kind: 'newWeapon', def }];
    run.chooseUpgrade(0);
    assert.ok(run.weapons.has(def.id), 'newWeapon card did not grant the weapon');

    const w = run.weapons.get(def.id);
    run.levelUpChoices = [{ kind: 'weapon', w, level: 2 }];
    run.chooseUpgrade(0);
    assert.equal(w.level, 2, 'weapon card did not level it');

    w.level = 8;
    run.levelUpChoices = [{ kind: 'weaponEvo', w, evo: run.weapons.evolutionOf(w) }];
    run.chooseUpgrade(0);
    assert.ok(w.evolved, 'weaponEvo card did not evolve it');
    run.dispose();
  });

  it('the run summary reports the arsenal', () => {
    freshSave();
    const run = makeRun();
    run.weapons.add(W.WEAPONS[0].id);
    const s = run.summary();
    assert.ok(Array.isArray(s.weapons), 'summary has no weapons array');
    assert.equal(s.weapons.length, 2);
    assert.ok(s.weapons[0].signature, 'slot 0 of the summary is not the signature');
    assert.ok(s.weapons[0].name && s.weapons[0].name.length > 0, 'the signature has no name');
    run.dispose();
  });
});

// The three probes read the shared helpers exactly the way an ability would, so
// they measure the real pipeline rather than a copy of its arithmetic.
import { area as helperArea, extraShots, pierce as helperPierce } from '../src/game/abilities/helpers.js';
function areaProbe(run, p, base) { return helperArea(p, base); }
function shotProbe(p) { return extraShots(p); }
function pierceProbe(p) { return helperPierce(p, 0); }
