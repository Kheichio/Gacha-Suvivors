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
import { abilities as abilitiesDriver } from '../src/game/abilities/index.js';
import { damageNumbers } from '../src/render/damageNumbers.js';
import { dealDamage, SRC } from '../src/game/damage.js';

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
      // An evolution you cannot SEE is an evolution you have to take on faith.
      assert.ok(w.evolution.visual, w.id + ' evolves without changing how it looks');
      assert.ok(w.evolution.visual !== w.visual,
                w.id + ' evolves into the same visual it started with');
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

  it('every upgrade explains itself in plain English', () => {
    // The card used to print `codex`, which is the flavour gag. A card that
    // makes you laugh and leaves you unsure what you just took has failed at
    // its only job, so `desc` is now mandatory and must not BE the joke.
    const bad = [];
    for (const u of data.upgrades.UPGRADES) {
      if (!u.desc || u.desc.length < 24) bad.push(u.id + ': missing or trivial desc');
      else if (u.desc === u.codex) bad.push(u.id + ': desc is just the codex flavour');
      else if (!/[.!]$/.test(u.desc)) bad.push(u.id + ': desc is not a sentence');
    }
    assert.equal(bad.length, 0, bad.join('\n      '));
  });

  it('the pickup-radius upgrade is big enough to see', () => {
    // It was +22% of a ~48px base — about ten world pixels a level on a screen
    // showing 1280 of them. An upgrade whose whole effect is spatial has to
    // move the radius by an amount a player can actually perceive.
    const lode = data.upgrades.UPGRADES.find((u) => u.stat === 'pickupRadiusMult');
    assert.ok(lode, 'no pickup-radius upgrade found');
    assert.atLeast(lode.perLevel, 0.4,
                   'a pickup-radius level must move the ring visibly, got ' + lode.perLevel);
    // And at max it should be a large fraction of the screen, not a nudge.
    const base = data.characters.CHARACTERS[0].stats.pickupRadius;
    const maxed = base * (1 + lode.perLevel * lode.maxLevel);
    assert.atLeast(maxed, 200, `a maxed pickup radius of ${Math.round(maxed)}px is still small`);
  });

  it('health regen is large enough to notice, and announces itself', () => {
    // Reported as "feels like it doesn't do anything". Two halves: the number
    // was tiny, and nothing on screen ever said it had happened.
    const regen = data.upgrades.UPGRADES.find((u) => u.stat === 'regen');
    assert.ok(regen, 'no regen upgrade found');

    // THIS USED TO ASSERT perLevel >= 0.6, and that assertion is now wrong on
    // purpose. The row RAMPS: the first card is deliberately small because a flat
    // 0.7 HP/s from level one was the "too powerful low level" the owner reported,
    // and the eighth card is what restores the old maxed total. So the shape is
    // what gets guarded here, not the first number.
    //
    // The three clauses are what a flattening would have to survive:
    //   1. the ramp exists at all (a flat row would fail this),
    //   2. every card is worth strictly more than the one before it,
    //   3. the TOP of the curve did not quietly get nerfed along with the bottom.
    const totals = regen.levelTotals;
    assert.ok(totals && totals.length === regen.maxLevel,
              'the regen row must carry one accumulated total per level');
    assert.equal(regen.perLevel, totals[0],
                 'perLevel must stay equal to levelTotals[0] or the card prints a lie');
    let prev = 0;
    for (let lv = 1; lv <= regen.maxLevel; lv++) {
      const step = data.upgrades.deltaAt(regen, lv);
      assert.ok(step > prev,
                `regen level ${lv} gives ${step}, not more than the ${prev} before it — ` +
                'the ramp has been flattened back out');
      prev = step;
    }
    assert.atLeast(data.upgrades.totalAt(regen, regen.maxLevel), 5,
                   'a maxed regen build no longer reaches the power it used to');

    freshSave();
    const run = makeRun(2024);
    const p = run.player;
    for (let i = 0; i < regen.maxLevel; i++) p.addUpgrade(regen.id);
    assert.atLeast(p.stats.regen, 4, 'a maxed regen build barely heals');

    // It must actually restore HP, and it must emit countable feedback.
    p.hp = p.maxHp * 0.5;
    const before = p.hp;
    damageNumbers.clear();
    step(run, 120);                       // two seconds
    assert.ok(p.hp > before + 1, 'regen restored nothing over two seconds');
    assert.atLeast(damageNumbers.count, 1,
                   'regen healed silently — no floating number was produced');
    run.dispose();
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
describe('weapons / evolved auras do not hijack conditional abilities', () => {
  it('a permanent self-aura does not auto-detonate a fire-triggered escape', () => {
    // The evolved signature keeps a BURN field glued to the player. One escape
    // in the roster drops a pool that "ignites on any fire contact" — and with
    // a self-aura overlapping it from the instant it lands, plus every nearby
    // enemy set alight by that same aura, the ignition stopped being a
    // condition and became an unconditional rider on every dash. Reported from
    // play as the dash "spamming its passive".
    freshSave();
    const run = new Run(data, {
      characterId: 'akane', stageId: data.stages.STAGES[0].id, tierIndex: 0, seed: 808,
    });
    const p = run.player;
    run.weapons.slots[0].level = 8;
    assert.ok(run.weapons.evolve(run.weapons.slots[0].id), 'the signature refused to evolve');

    // Let the standing aura come up, then dash.
    step(run, 90);
    const auras = run.hazards.fields.items;
    let following = 0;
    for (let i = 0; i < run.hazards.fields.count; i++) {
      if (auras[i].followHost === p) following++;
    }
    assert.atLeast(following, 1, 'the evolved signature never spawned its standing aura');

    assert.ok(run.weapons.slots[0].evolved);
    const ctx = p.state(p.def.escape.id);
    run.player.escape.refill();
    assert.ok(abilitiesCast(run), 'the escape did not cast');
    step(run, 120);                       // two full seconds, well past the fuse

    assert.ok(ctx.puddle, "the pool self-ignited from the player's own aura");
    assert.ok(ctx.active, 'the escape ended early, which means it detonated');

    // AND the loop that made it "spam": igniting nulls the pool, and the next
    // tick used to rebuild it and reset the ability timer — detonate, rebuild,
    // detonate, forever, stacking a fresh burning-ground field every few frames.
    // A bounded field count is the assertion that catches it.
    assert.lessThan(run.hazards.fields.count, 5,
                    'hazard fields are piling up — the escape is rebuilding itself');
    run.dispose();
  });

  it('an escape that detonates its own pool ends, and does not rebuild it', () => {
    freshSave();
    const run = new Run(data, {
      characterId: 'akane', stageId: data.stages.STAGES[0].id, tierIndex: 0, seed: 4242,
    });
    const p = run.player;
    const ctx = p.state(p.def.escape.id);
    p.escape.refill();
    assert.ok(abilitiesCast(run), 'the escape did not cast');
    step(run, 30);
    assert.ok(ctx.puddle, 'no pool was dropped');

    // Force the condition the mechanic is actually for: burning ground that the
    // player did not bring with them, overlapping the pool.
    run.hazards.spawnField(ctx.puddle.x, ctx.puddle.y, 90, 3, 'burn', 10, '#ff7a2f');
    step(run, 90);

    assert.equal(ctx.puddle, null, 'placed fire failed to ignite the pool');
    assert.equal(ctx.active, false, 'the escape did not end after detonating');
    assert.lessThan(run.hazards.fields.count, 5, 'the escape rebuilt itself after detonating');
    run.dispose();
  });
});

/** Cast the equipped escape through the real driver, as the run would. */
function abilitiesCast(run) {
  return run.player.escape.use() && abilitiesDriver.castEscape(run);
}

// ---------------------------------------------------------------------------
describe('weapons / a boss can be killed at any moment, including its own', () => {
  it('killing a boss mid-attack does not crash its attack callbacks', () => {
    // A boss dies inside its own attack all the time once the player has five
    // levelled weapons — thorns, a burning field, a well-timed nova. `onDeath`
    // nulls `boss.active`, and every attack callback dereferences it, so the
    // `end()` that ran a few ticks later read `.st` off null and took the whole
    // frame down. Latent for the life of the project; it only started firing
    // when the arsenal got big enough to delete a boss mid-wind-up.
    freshSave();
    const failures = [];
    for (const stage of data.stages.STAGES.slice(0, 3)) {
      const bossId = stage.boss;
      const bossDef = data.bosses.BOSSES_BY_ID[bossId];
      if (!bossDef) continue;
      let run = null;
      try {
        run = new Run(data, {
          characterId: data.characters.CHARACTERS[0].id,
          stageId: stage.id, tierIndex: 0, seed: 31337,
        });
        run.spawnBoss(bossDef, false);
        // Drive until an attack is actually in progress, in both of its stages.
        for (const wantStage of [0, 1]) {
          let guard = 0;
          while ((!run.boss.current || run.boss.current.stage !== wantStage) && guard++ < 4000) {
            step(run, 1);
            if (!run.boss.active) break;
          }
          if (!run.boss.current || !run.boss.active) continue;

          // THE EXACT SITUATION: the killing blow lands INSIDE the attack's own
          // callback — thorns reflecting its damage, a field it is standing in —
          // so `onDeath()` has already nulled `active` while the attack record
          // is still live on the stack. Reproduced directly, because the
          // damage path that gets there is different for every boss.
          //
          // The assertion is simply THAT IT DOES NOT THROW: every attack
          // callback in boss.js dereferences `bc.active`, and one of them
          // reading `.st` off null is what took a whole frame down. Whether the
          // record is then cleared is incidental — `onDeath()` already does
          // that in real play; here it is put back deliberately.
          const c = run.boss.current;
          run.boss.onDeath();
          run.boss.current = c;
          c.t = (c.def.duration || 0) + 10;      // force it straight into end()
          run.boss._tickAttack(1 / 60);
          run.boss.update(1 / 60);               // and the frame after it
          break;
        }
        // And from the outside, which must also be survivable.
        run.spawnBoss(bossDef, false);
        if (run.boss.active) dealDamage(run, run.boss.active, 1e12, SRC.AUTO, { canCrit: false });
        step(run, 180);
      } catch (err) {
        failures.push(`${bossId}: ${(err && err.message) || String(err)}`);
      }
      if (run) run.dispose();
    }
    assert.equal(failures.length, 0, failures.join('\n      '));
  });
});

// ---------------------------------------------------------------------------
describe('weapons / a punch is a line, not a cone', () => {
  /** One stationary, unkillable enemy at an exact offset from the player. */
  function dummyAt(run, dx, dy) {
    const p = run.player;
    const e = run.enemies.spawn(data.enemies.ENEMIES[0], p.x + dx, p.y + dy, {});
    if (e) { e.hp = e.maxHp = 1e9; e.spawnT = 0; e.baseSpeed = 0; e.speed = 0; }
    run.enemyHash.build(run.enemies.items, run.enemies.count);
    return e;
  }

  it('ki punches hit what is in front and miss what is beside', () => {
    // It used to fire a 1.25-radian cone three times — a 72-degree sweep, which
    // is a sword swing, not a punch. Reported as "if its punches it should go in
    // a straight line not to the sides".
    freshSave();
    const run = new Run(data, {
      characterId: 'sora', stageId: data.stages.STAGES[0].id, tierIndex: 0, seed: 11,
    });
    const p = run.player;
    p.facing = 0;                                   // due east
    const front = dummyAt(run, 92, 0);
    const side = dummyAt(run, 0, 92);
    assert.ok(front && side, 'could not place the dummies');

    abilitiesDriver.fireAuto(run);
    for (let i = 0; i < 40; i++) run.scheduler.tick(CONFIG.TICK_DT);

    assert.lessThan(front.hp, front.maxHp, 'the punch missed a target directly ahead');
    assert.equal(side.hp, side.maxHp,
                 'the punch hit a target 90 degrees off the facing — it is still a cone');
    run.dispose();
  });

  it('the punch count and cadence scale with the signature level', () => {
    freshSave();
    const counts = [];
    const spans = [];
    for (const setup of [{ level: 1 }, { level: 8 }, { level: 8, evolved: true }]) {
      const run = new Run(data, {
        characterId: 'sora', stageId: data.stages.STAGES[0].id, tierIndex: 0, seed: 12,
      });
      const w = run.weapons.slots[0];
      w.level = setup.level;
      if (setup.evolved) assert.ok(run.weapons.evolve(w.id), 'the signature refused to evolve');
      run.weapons._rebuildMods();
      run.player.facing = 0;
      dummyAt(run, 92, 0);
      abilitiesDriver.fireAuto(run);
      // The first punch lands immediately; the rest are queued on the sim-time
      // scheduler, so the queue depth IS the extra punch count.
      const n = 1 + run.scheduler.count;
      // Drain the queue to find out how long the volley actually takes. Levels
      // buy CADENCE as well as count, and once the count is capped cadence is
      // the only thing left for the evolution to change — so measuring the
      // queue depth alone cannot see the last upgrade the player buys.
      let ticks = 0;
      while (run.scheduler.count > 0 && ticks < 600) { run.scheduler.tick(1 / 60); ticks++; }
      counts.push(n);
      spans.push(ticks / 60);
      run.dispose();
    }
    // Two, not one: a punch line catches a fraction of what the old cone did,
    // and opening the volley at a single jab put a six-star below every
    // three-star on the balance board. The floor is part of the repricing.
    assert.equal(counts[0], 2, 'a level-1 signature should open on a two-punch volley');
    assert.ok(counts[1] > counts[0], `level 8 threw ${counts[1]}, level 1 threw ${counts[0]}`);
    assert.ok(counts[2] >= counts[1], `evolved threw ${counts[2]}, maxed threw ${counts[1]}`);
    // FIVE, not four, and the cap above it is now eight. `rapid_fist` is the one
    // melee auto in the game that turns projectile count into strikes, and it
    // used to read the signature weapon's `mods.count` alone — so Extra Shot and
    // the shrine's Volley row, both of which feed the same stat, did nothing for
    // Sora at all. It reads `H.extraShots` now, which is that number PLUS those
    // two, and the old cap of 4 was already reached by the signature by itself,
    // so every point the player bought was swallowed by the clamp. This save is
    // fresh and holds neither upgrade, so what is measured here is the signature
    // alone: 2 + 3 = 5, with three punches of headroom left for the upgrades.
    assert.atMost(counts[2], 5, 'the volley grew past what the signature alone can buy');
    assert.equal(counts[2], 5, 'a maxed, evolved signature should reach a five-punch volley');
    // The cadence has to keep tightening after the count caps out, or the last
    // levels of the weapon buy the player nothing they can see.
    assert.ok(spans[2] < spans[1],
              `evolved volley took ${spans[2].toFixed(3)}s, maxed took ${spans[1].toFixed(3)}s ` +
              '— the evolution stopped tightening the cadence');
  });
});

// ---------------------------------------------------------------------------
// THE FINALE COUNTDOWN.
//
// The predicate Run.nothingLeftToClaim() is a hand-written MIRROR of
// rollUpgradeChoices — it has to be, because calling the real roll to ask the
// question would advance runRng and desync every seeded replay in the project.
// A mirror drifts. So the first test here does not assert the predicate on its
// own: it asserts that the predicate and the actual roll AGREE, which is the only
// assertion that fails when a sixth card source is added to one and not the
// other.
function finishTheBuild(run) {
  // Fill the rack, pay every evolution requirement, max and evolve everything.
  for (const def of W.WEAPONS) { if (run.weapons.full) break; run.weapons.add(def.id); }
  for (const w of run.weapons.slots) {
    w.level = run.weapons.maxLevel(w);
    const req = run.weapons.evoRequirement(w);
    if (req) {
      while (run.player.upgradeLevel(req.upgrade) < req.level) {
        if (!run.player.addUpgrade(req.upgrade)) break;
      }
    }
  }
  for (const w of run.weapons.slots.slice()) run.weapons.evolve(w.id);
  // Then max every upgrade the buckets will still accept, and everything held.
  const B = data.upgrades.BUILD_SLOTS;
  for (const up of data.upgrades.UPGRADES) {
    const slots = run.buildSlots();
    const bucket = B.bucketOf(up);
    const owned = run.player.upgradeLevel(up.id) > 0;
    if (!owned && slots.used[bucket] >= slots.max[bucket]) continue;
    while (!run.player.isMaxed(up.id)) { if (!run.player.addUpgrade(up.id)) break; }
  }
}

describe('weapons / the finale countdown', () => {
  it('a fresh run has plenty left to claim and never starts the countdown', () => {
    // The control. If this ever passes vacuously the test below proves nothing.
    freshSave();
    const run = makeRun(4242);
    assert.ok(!run.nothingLeftToClaim(),
              'a level-1 run reported that it had nothing left to claim');
    step(run, 200);
    assert.equal(run.finaleCountdownFired, false, 'the countdown started on a fresh run');
    assert.equal(run.finaleCountdown, -1, 'the countdown clock is running on a fresh run');
    run.dispose();
  });

  it('the predicate agrees with the roll: nothing left means a gold-only screen', () => {
    freshSave();
    const run = makeRun(777);
    finishTheBuild(run);
    assert.ok(run.nothingLeftToClaim(),
              'a fully finished build still reported something left to claim');
    const choices = run.rollUpgradeChoices();
    assert.equal(choices.length, 1, 'a finished build was offered ' + choices.length + ' cards');
    assert.equal(choices[0].kind, 'gold',
                 'the predicate and rollUpgradeChoices disagree — one of them grew a source');
    run.dispose();
  });

  it('it starts the clock, drains it, and hands over to callBossEarly exactly once', () => {
    freshSave();
    const run = makeRun(778);
    finishTheBuild(run);

    // The poll runs every 32 sim ticks, so 40 covers exactly one of them.
    step(run, 40);
    assert.ok(run.finaleCountdownFired, 'the countdown never started');
    assert.ok(run.finaleCountdown > 0, 'the clock started already expired');
    assert.ok(run.finaleCountdown <= 60, 'the clock started above one minute');
    assert.ok(!run.bossCalledEarly, 'the boss was called immediately instead of after the minute');

    const before = run.finaleCountdown;
    step(run, 60);
    assert.ok(run.finaleCountdown < before, 'the clock is not draining');

    // The last fifteen seconds ARE callBossEarly's own lead-in, so a clock set
    // inside that window must hand over on the very next tick.
    run.finaleCountdown = 12;
    run.player.hp = run.player.maxHp;
    step(run, 2);
    assert.ok(run.bossCalledEarly, 'the countdown never handed over to callBossEarly');

    // And it cannot start again, or call again.
    assert.equal(run.finaleCountdownFired, true);
    run._maybeCallBossEarly();
    assert.equal(run.finaleCountdown > 0, true, 'a second start reset the clock');
    run.dispose();
  });

  it('a finale already on the floor cancels the clock instead of counting to it', () => {
    freshSave();
    const run = makeRun(779);
    finishTheBuild(run);
    step(run, 40);
    assert.ok(run.finaleCountdownFired, 'the countdown never started');

    // The authored timeline got there first.
    run.waveDirector.bossSpawned = true;
    step(run, 2);
    assert.equal(run.finaleCountdown, -1,
                 'the HUD would still be counting down to a boss that already arrived');
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

  it('a maxed weapon is offered its evolution once the requirement is paid', () => {
    freshSave();
    const run = makeRun();
    const def = W.WEAPONS[1];
    run.weapons.add(def.id);
    const w = run.weapons.get(def.id);
    w.level = 8;

    // MAXED IS NO LONGER SUFFICIENT. Every weapon now names a generic upgrade it
    // has to be built into before it can evolve, which is the whole point of the
    // change — the evolve card is a reward for a committed build rather than an
    // automatic consequence of levelling. So the un-paid case is asserted first:
    // a maxed weapon whose requirement is unmet must NOT produce an evolve card.
    const req = run.weapons.evoRequirement(w);
    if (req) {
      const early = run.rollUpgradeChoices();
      assert.ok(!early.some((c) => c.kind === 'weaponEvo'),
                'an evolve card appeared before its required upgrade was taken');
      for (let i = 0; i < req.level; i++) run.player.addUpgrade(req.upgrade);
    }

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
    // The entry fee is now checked at the point of GRANT as well as the point of
    // offer, so it has to be paid before the card can apply.
    const evoReq = run.weapons.evoRequirement(w);
    if (evoReq) for (let i = 0; i < evoReq.level; i++) run.player.addUpgrade(evoReq.upgrade);
    run.levelUpChoices = [{ kind: 'weaponEvo', w, evo: run.weapons.evolutionOf(w) }];
    run.chooseUpgrade(0);
    assert.ok(w.evolved, 'weaponEvo card did not evolve it');
    run.dispose();
  });

  it('an evolve card cannot be APPLIED without its entry fee, only offered', () => {
    // The gate used to live only in rollUpgradeChoices -> weapons.evolvable().
    // That is airtight for as long as that function is the only thing that ever
    // builds a `weaponEvo` card — which is a fact about today's code, not about
    // the design. A chest, a boss crate or a shrine boon that learned to hand one
    // out would have skipped the fee in silence, and the player would have an
    // evolved weapon off max level alone. Reported from play as exactly that.
    freshSave();
    const run = makeRun();
    const def = W.WEAPONS[0];
    run.weapons.add(def.id);
    const w = run.weapons.get(def.id);
    w.level = 8;
    const req = run.weapons.evoRequirement(w);
    assert.ok(req, def.id + ' declares no evolution requirement, so this proves nothing');
    assert.equal(run.weapons.evoReady(w), false, 'the fee was already paid at run start');

    run.levelUpChoices = [{ kind: 'weaponEvo', w, evo: run.weapons.evolutionOf(w) }];
    run.chooseUpgrade(0);
    assert.equal(w.evolved, false, 'a maxed weapon evolved without paying its requirement');

    for (let i = 0; i < req.level; i++) run.player.addUpgrade(req.upgrade);
    run.levelUpChoices = [{ kind: 'weaponEvo', w, evo: run.weapons.evolutionOf(w) }];
    run.chooseUpgrade(0);
    assert.ok(w.evolved, 'paying the requirement did not let it evolve');
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
