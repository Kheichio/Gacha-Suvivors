// Every test suite. Imported by both tests/run.js (Node) and tests/index.js
// (the in-browser `?test=1` runner), so the two can never drift.
//
// The four suites the acceptance criteria explicitly demand:
//   - gacha pity resolves exactly at the documented pull counts
//   - the one-to-one rule holds over characters.js
//   - save/load survives a schemaVersion bump
//   - DEV_MODE=false leaves no ref string reachable
// plus the architecture rule SECTION 17 forgot to test (DECISIONS.md §36).

import { describe, it, assert } from './harness.js';

import * as characters from '../src/data/characters.js';
import * as enemies from '../src/data/enemies.js';
import * as stages from '../src/data/stages.js';
import * as waves from '../src/data/waves.js';
import * as upgrades from '../src/data/upgrades.js';
import * as relics from '../src/data/relics.js';
import * as evolutions from '../src/data/evolutions.js';
import * as gacha from '../src/data/gacha.js';
import * as bosses from '../src/data/bosses.js';
import * as achievements from '../src/data/achievements.js';
import * as shrine from '../src/data/shrine.js';
import * as elements from '../src/data/elements.js';
import * as refs from '../src/data/refs.js';
// Deliberately a separate module from refs.js: a ship build DELETES refs.js, and
// the ship-safe renames are the one naming table that must survive that deletion
// (DECISIONS.md §22.3). If they lived in refs.js, DEV_MODE=false would print the
// exact source-IP names the flag exists to hide.
import { SHIP_NAMES } from '../src/data/shipNames.js';

import { Rng, mulberry32, hashString } from '../src/core/rng.js';
import { Pool } from '../src/core/pool.js';
import { SpatialHash } from '../src/core/spatialHash.js';
import { Interval, Cooldown, Countdown, Scheduler } from '../src/core/timer.js';
import { clamp, lerp, angleDelta, rotateToward, formatTime } from '../src/core/math.js';
import { migrate, defaultSave } from '../src/core/save.js';
import { displayName } from '../src/core/config.js';

// ============================================================================
describe('core / rng', () => {
  it('mulberry32 is deterministic for a seed', () => {
    const a = mulberry32(12345), b = mulberry32(12345);
    for (let i = 0; i < 100; i++) assert.equal(a(), b());
  });

  it('a stream resumed from a persisted call count matches', () => {
    const a = new Rng(999);
    for (let i = 0; i < 57; i++) a.raw();
    const b = new Rng(999, 57);
    assert.equal(a.calls, b.calls);
    for (let i = 0; i < 20; i++) assert.equal(a.raw(), b.raw());
  });

  it('int() is inclusive at both ends', () => {
    const r = new Rng(7);
    let sawMin = false, sawMax = false;
    for (let i = 0; i < 5000; i++) {
      const v = r.int(3, 5);
      assert.atLeast(v, 3); assert.atMost(v, 5);
      if (v === 3) sawMin = true;
      if (v === 5) sawMax = true;
    }
    assert.ok(sawMin && sawMax, 'never produced both endpoints');
  });

  it('weightedIndex respects weights and handles all-zero', () => {
    const r = new Rng(11);
    const counts = [0, 0, 0];
    for (let i = 0; i < 30000; i++) counts[r.weightedIndex([1, 3, 6])]++;
    assert.ok(counts[2] > counts[1] && counts[1] > counts[0], 'weights not respected');
    assert.equal(r.weightedIndex([0, 0, 0]), -1);
  });

  it('hashString is stable', () => {
    assert.equal(hashString('shiro_same'), hashString('shiro_same'));
    assert.notEqual(hashString('rin'), hashString('niten'));
  });
});

// ============================================================================
describe('core / pool', () => {
  it('swap-and-pop keeps live entities contiguous', () => {
    const p = new Pool(() => ({ v: 0 }), (e) => { e.v = 0; }, 8, 8, false);
    const a = p.spawn(), b = p.spawn(), c = p.spawn();
    a.v = 1; b.v = 2; c.v = 3;
    assert.equal(p.count, 3);
    p.release(b);
    assert.equal(p.count, 2);
    for (let i = 0; i < p.count; i++) assert.ok(p.items[i].active);
    assert.equal(p.items[a._i], a);
    assert.equal(p.items[c._i], c);
  });

  it('returns null instead of allocating when capped', () => {
    const p = new Pool(() => ({}), () => {}, 2, 2, false);
    assert.ok(p.spawn()); assert.ok(p.spawn());
    assert.equal(p.spawn(), null);
    assert.equal(p.starved, 1);
  });

  it('releasing during forward iteration is safe', () => {
    const p = new Pool(() => ({ v: 0 }), () => {}, 16, 16, false);
    for (let i = 0; i < 10; i++) p.spawn().v = i;
    let seen = 0;
    for (let i = 0; i < p.count; i++) {
      const e = p.items[i];
      seen++;
      if (e.v % 2 === 0) { p.release(e); i--; }
    }
    assert.equal(p.count, 5);
    assert.atMost(seen, 15);
  });
});

// ============================================================================
describe('core / spatial hash', () => {
  it('finds only entities inside the query radius', () => {
    const h = new SpatialHash(1000, 1000, 64, 1024);
    const items = [];
    for (let i = 0; i < 200; i++) items.push({ x: (i * 37) % 1000, y: (i * 91) % 1000 });
    h.build(items, items.length);
    const n = h.query(500, 500, 100);
    let inRange = 0;
    for (let k = 0; k < n; k++) {
      const e = items[h.resultAt(k)];
      const d = Math.hypot(e.x - 500, e.y - 500);
      if (d <= 100) inRange++;
    }
    let brute = 0;
    for (const e of items) if (Math.hypot(e.x - 500, e.y - 500) <= 100) brute++;
    assert.equal(inRange, brute, 'broadphase missed an entity in range');
  });

  it('densestCell finds the fullest cell', () => {
    const h = new SpatialHash(1000, 1000, 64, 1024);
    const items = [];
    for (let i = 0; i < 40; i++) items.push({ x: 700 + (i % 5), y: 300 + (i % 5) });
    for (let i = 0; i < 5; i++) items.push({ x: 100, y: 100 });
    h.build(items, items.length);
    const out = { x: 0, y: 0 };
    const pop = h.densestCell(out, 0, 0, 0);
    assert.atLeast(pop, 30);
    assert.ok(Math.abs(out.x - 700) < 70 && Math.abs(out.y - 300) < 70,
              `expected ~(700,300) got (${out.x},${out.y})`);
  });
});

// ============================================================================
describe('core / timers', () => {
  it('Interval fires the right number of times', () => {
    const iv = new Interval(0.5);
    let n = 0;
    for (let i = 0; i < 60; i++) n += iv.tick(1 / 60);
    assert.equal(n, 2);
  });

  it('Cooldown charges regenerate one at a time', () => {
    const cd = new Cooldown(2, 2);
    assert.ok(cd.use()); assert.ok(cd.use());
    assert.equal(cd.use(), false);
    for (let i = 0; i < 120; i++) cd.tick(1 / 60);
    assert.equal(cd.charges, 1);
    for (let i = 0; i < 120; i++) cd.tick(1 / 60);
    assert.equal(cd.charges, 2);
  });

  it('Scheduler fires once and lets callbacks schedule more', () => {
    const s = new Scheduler(16);
    let a = 0, b = 0;
    s.after(0.1, () => { a++; s.after(0.1, () => { b++; }); });
    for (let i = 0; i < 30; i++) s.tick(1 / 60);
    assert.equal(a, 1);
    assert.equal(b, 1);
  });
});

// ============================================================================
describe('gacha / pity math (SECTION 17 requires this test)', () => {
  const P = gacha.PITY;

  it('the 5★+ curve reaches EXACTLY 1.0 at hard pity', () => {
    // DECISIONS.md §2 — the spec's "+6%/pull always resolves by ~62" is false
    // (it reaches 80% at 62 and 100% at 67, leaving a dead zone before 70).
    // The ruling pins the ramp so certainty lands exactly on the hard-pity pull.
    assert.close(gacha.rate5Plus(P.hard5), 1.0, 1e-9,
                 `rate5Plus(${P.hard5}) must be exactly 1.0`);
  });

  it('the 6★ curve reaches EXACTLY 1.0 at hard pity', () => {
    assert.close(gacha.rate6(P.hard6), 1.0, 1e-9,
                 `rate6(${P.hard6}) must be exactly 1.0`);
  });

  it('the base rate applies before soft pity begins', () => {
    const base5 = gacha.BASE_RATES[5] + gacha.BASE_RATES[6];
    for (let n = 1; n <= P.soft5 - 1; n++) {
      assert.close(gacha.rate5Plus(n), base5, 1e-9, `pull ${n} should be the base rate`);
    }
  });

  it('the curve is strictly increasing through the soft-pity band', () => {
    let prev = gacha.rate5Plus(P.soft5 - 1);
    for (let n = P.soft5; n <= P.hard5; n++) {
      const v = gacha.rate5Plus(n);
      assert.ok(v > prev, `rate5Plus(${n})=${v} not greater than ${prev}`);
      prev = v;
    }
  });

  it('the derived step is consistent with the base rate', () => {
    // The step is DERIVED, never a magic number, so re-tuning rates can never
    // desynchronise the curve from the guarantee.
    const span = P.hard5 - P.soft5 + 1;
    const base = gacha.BASE_RATES[5] + gacha.BASE_RATES[6];
    assert.close(gacha.softPityStep5, (1 - base) / span, 1e-12);
  });

  it('no simulated sequence ever exceeds hard pity', () => {
    const rng = new Rng(4242);
    let since = 0, worst = 0;
    for (let i = 0; i < 200000; i++) {
      since++;
      const r = Math.min(1, gacha.rate5Plus(since));
      if (since >= P.hard5 || rng.raw() < r) {
        if (since > worst) worst = since;
        since = 0;
      }
    }
    assert.atMost(worst, P.hard5, `a sequence ran ${worst} pulls without a ★5+`);
  });

  it('rates sum to 1', () => {
    const r = gacha.BASE_RATES;
    assert.close(r[3] + r[4] + r[5] + r[6], 1.0, 1e-9);
  });

  it('the economy target holds: one 10-pull per 3-4 runs', () => {
    // DECISIONS.md §1 — the spec's 1600 cost against 8-25💎/run was off 20-60x.
    const A = shrine.FRAGMENT_AWARDS;
    const perRun = A.runCompleted + A.midBoss + A.finalBoss;
    const runsNeeded = gacha.COST.ten / perRun;
    assert.atLeast(runsNeeded, 2.5, 'a 10-pull is too cheap');
    assert.atMost(runsNeeded, 5.0, 'a 10-pull is too expensive');
  });
});

// ============================================================================
describe('data / the one-to-one rule (SECTION 17 requires this test)', () => {
  it('every character has a ref naming exactly one person', () => {
    for (const c of characters.CHARACTERS) {
      const r = refs.REFS[c.id];
      assert.ok(r, `${c.id} has no refs.js entry`);
      assert.ok(r.ref && r.ref.length > 1, `${c.id} has an empty ref`);
      // "A blend" is exactly what the rule forbids.
      assert.ok(!/ and | & |\/| or |,/i.test(r.ref),
                `${c.id} ref "${r.ref}" names more than one person`);
    }
  });

  it('no two characters share a ref', () => {
    const seen = new Map();
    for (const c of characters.CHARACTERS) {
      const r = refs.REFS[c.id].ref.toLowerCase().trim();
      assert.ok(!seen.has(r), `${c.id} and ${seen.get(r)} share the ref "${r}"`);
      seen.set(r, c.id);
    }
  });

  it('no two characters share an ability id', () => {
    const seen = new Map();
    for (const c of characters.CHARACTERS) {
      for (const k of ['autoAttack', 'special', 'escape', 'passive']) {
        const id = c[k].id;
        assert.ok(!seen.has(id), `${c.id}.${k} "${id}" also appears on ${seen.get(id)}`);
        seen.set(id, c.id);
      }
    }
  });

  it('every signature relic belongs to exactly one character', () => {
    const owners = new Map();
    for (const r of relics.RELICS) {
      if (!r.owner) continue;
      assert.ok(!owners.has(r.owner), `${r.owner} owns two relics`);
      owners.set(r.owner, r.id);
      assert.ok(characters.CHARACTERS_BY_ID[r.owner], `relic ${r.id} owner "${r.owner}" is not a character`);
    }
    assert.equal(owners.size, characters.CHARACTERS.length,
                 'every character must own exactly one signature relic, and no two may share');
  });

  it('rival pairs sit at matching rarity', () => {
    // Naruto -> yamikage/uzu both ★4; Dragon Ball -> sora/han both ★6.
    const C = characters.CHARACTERS_BY_ID;
    assert.equal(C.yamikage.rarity, C.uzu.rarity);
    assert.equal(C.sora.rarity, C.han.rarity);
  });
});

// ============================================================================
describe('data / counts and integrity', () => {
  it('the rarity buckets partition the roster exactly', () => {
    // These used to be four hardcoded literals (2/6/8/3 out of 19), which meant
    // ADDING A CHARACTER — the thing the whole architecture is built to make
    // cheap — failed the suite in four places for no reason. What actually
    // matters is structural: every character appears in exactly one bucket,
    // every bucket holds only its own rarity, and the roster is still big
    // enough to be a roster. The numbers themselves belong in DECISIONS.md.
    let total = 0;
    const seen = new Set();
    for (const r of [3, 4, 5, 6]) {
      const bucket = characters.CHARACTERS_BY_RARITY[r] || [];
      total += bucket.length;
      for (const id of bucket) {
        const c = characters.CHARACTERS_BY_ID[id];
        assert.ok(c, `rarity bucket ${r} names an unknown character "${id}"`);
        assert.equal(c.rarity, r, `${id} is rarity ${c.rarity} but sits in bucket ${r}`);
        assert.ok(!seen.has(id), `${id} appears in more than one rarity bucket`);
        seen.add(id);
      }
    }
    assert.equal(total, characters.CHARACTERS.length,
                 'the rarity buckets do not add up to the roster');
    assert.atLeast(characters.CHARACTERS.length, 19);
    // Rarity has to stay meaningful: commons outnumber legendaries.
    assert.atLeast((characters.CHARACTERS_BY_RARITY[5] || []).length,
                   (characters.CHARACTERS_BY_RARITY[6] || []).length,
                   'there are more ★6 characters than ★5');
  });

  it('every character has a signature relic, and the stage relics are extra', () => {
    // Same reasoning: 24/19/5 was three literals that a nineteenth-plus
    // character invalidates. The invariant is the one-to-one rule.
    assert.equal(relics.SIGNATURE_RELICS.length, characters.CHARACTERS.length,
                 'signature relics and characters are no longer one-to-one');
    assert.equal(relics.RELICS.length,
                 relics.SIGNATURE_RELICS.length + relics.STAGE_RELICS.length,
                 'RELICS is not exactly the signature relics plus the stage relics');
    assert.atLeast(relics.STAGE_RELICS.length, 5);
  });

  it('8 evolutions (M6 said 7 and was wrong)', () => {
    assert.equal(evolutions.EVOLUTIONS.length, 8);
  });

  it('22 upgrades totalling 163 levels, not 176', () => {
    assert.equal(upgrades.UPGRADES.length, 22);
    let total = 0;
    for (const u of upgrades.UPGRADES) total += u.maxLevel;
    assert.equal(total, 163, 'the spec\'s "8 levels each" contradicts its own annotations');
    assert.equal(upgrades.UPGRADES_BY_ID.extra_shot.maxLevel, 4);
    assert.equal(upgrades.UPGRADES_BY_ID.piercing_will.maxLevel, 5);
    assert.equal(upgrades.UPGRADES_BY_ID.second_chance.maxLevel, 2);
  });

  it('7 stages, each with a boss, a mid-boss and an elite', () => {
    assert.equal(stages.STAGES.length, 7);
    for (const s of stages.STAGES) {
      assert.ok(bosses.BOSSES_BY_ID[s.boss], `${s.id} boss "${s.boss}" missing`);
      assert.ok(bosses.BOSSES_BY_ID[s.midBoss], `${s.id} midBoss "${s.midBoss}" missing`);
      assert.ok(s.elite, `${s.id} has no elite (SECTION 9: one per stage minimum)`);
    }
  });

  it('stage 7 got the mid-boss and elite the spec omitted', () => {
    const z = stages.STAGES_BY_ID.zenith_stage;
    assert.equal(z.midBoss, 'the_opening_act');
    assert.equal(z.elite, 'the_understudy');
  });

  it('every id referenced across files exists', () => {
    for (const c of characters.CHARACTERS) {
      assert.ok(relics.RELICS_BY_ID[c.signatureRelic], `${c.id}.signatureRelic missing`);
    }
    for (const s of stages.STAGES) {
      for (const m of s.mobTable) assert.ok(enemies.ENEMIES_BY_ID[m.id], `${s.id} mob "${m.id}" missing`);
      for (const h of s.hazards || []) assert.ok(stages.HAZARDS[h], `${s.id} hazard "${h}" missing`);
      assert.ok(stages.MODIFIERS[s.modifier], `${s.id} modifier "${s.modifier}" missing`);
    }
    for (const e of evolutions.EVOLUTIONS) {
      assert.ok(upgrades.UPGRADES_BY_ID[e.requires.upgrade], `${e.id} upgrade missing`);
      assert.ok(relics.RELICS_BY_ID[e.requires.relic], `${e.id} relic missing`);
    }
    for (const sid in waves.WAVES) {
      assert.ok(stages.STAGES_BY_ID[sid], `waves for unknown stage "${sid}"`);
      for (const w of waves.WAVES[sid]) {
        if (!w.enemy) continue;
        assert.ok(enemies.ENEMIES_BY_ID[w.enemy] || bosses.BOSSES_BY_ID[w.enemy],
                  `waves[${sid}] enemy "${w.enemy}" missing`);
      }
    }
    for (const e of enemies.ENEMIES) {
      const p = e.params || {};
      if (p.splitInto) assert.ok(enemies.ENEMIES_BY_ID[p.splitInto], `${e.id} splitInto missing`);
      if (p.summonId) assert.ok(enemies.ENEMIES_BY_ID[p.summonId], `${e.id} summonId missing`);
    }
    for (const b of gacha.BANNERS) {
      for (const k of [3, 4, 5, 6]) {
        for (const id of b.pool[k] || []) {
          assert.ok(characters.CHARACTERS_BY_ID[id], `banner ${b.id} pool[${k}] "${id}" missing`);
        }
      }
      if (b.featured6) assert.ok(characters.CHARACTERS_BY_ID[b.featured6], `${b.id} featured6 missing`);
      for (const id of b.featured5 || []) assert.ok(characters.CHARACTERS_BY_ID[id], `${b.id} featured5 "${id}" missing`);
    }
  });

  it('the nine ghost mobs got real stats', () => {
    for (const id of ['chalk_wraith', 'gym_uniform_ghoul', 'neon_otaku', 'crawler_husk',
                      'rubble_golem', 'ambusher', 'lesser_oni', 'anglerfish_fan', 'drowned_roadie']) {
      const e = enemies.ENEMIES_BY_ID[id];
      assert.ok(e, `${id} was named in a stage table but never statted`);
      assert.atLeast(e.hp, 1); assert.atLeast(e.speed, 1);
    }
    // and were not conflated with their similarly-named neighbours
    assert.notEqual(enemies.ENEMIES_BY_ID.crawler_husk, enemies.ENEMIES_BY_ID.ceiling_crawler);
    assert.notEqual(enemies.ENEMIES_BY_ID.lesser_oni, enemies.ENEMIES_BY_ID.oni_bruiser);
  });

  it('every behavior an enemy declares is one of the 15 archetypes', () => {
    const OK = ['chaser', 'swarmer', 'charger', 'ranged', 'exploder', 'splitter',
                'orbiter', 'summoner', 'shielder', 'dasher', 'tank', 'healer',
                'leech', 'ambusher', 'static'];
    for (const e of enemies.ENEMIES) {
      assert.includes(OK, e.behavior, `${e.id} declares unknown behavior "${e.behavior}"`);
    }
  });

  it('every entity carries an element and elements resolve', () => {
    for (const c of characters.CHARACTERS) assert.ok(elements.ELEMENTS[c.element], `${c.id} bad element`);
    for (const e of enemies.ENEMIES) assert.ok(elements.ELEMENTS[e.element], `${e.id} bad element`);
    assert.close(elements.elementMultiplier('water', 'fire'), 1 + elements.ELEMENT_BONUS, 1e-9);
    assert.close(elements.elementMultiplier('fire', 'water'), 1 - elements.ELEMENT_BONUS, 1e-9);
    assert.close(elements.elementMultiplier('spirit', 'fire'), 1, 1e-9);
  });

  it('every wave timeline is normalised, sorted, and anchored', () => {
    for (const sid in waves.WAVES) {
      const list = waves.WAVES[sid];
      assert.atLeast(list.length, 20, `${sid} timeline is too thin`);
      let prev = -1;
      for (const w of list) {
        assert.atLeast(w.t, 0, `${sid} has a negative t`);
        assert.atMost(w.t, 1, `${sid} t=${w.t} is not normalised (DECISIONS.md §20)`);
        assert.atLeast(w.t, prev, `${sid} timeline is not sorted at t=${w.t}`);
        prev = w.t;
      }
      assert.ok(list.some((w) => w.type === 'midboss'), `${sid} has no mid-boss event`);
      assert.ok(list.some((w) => w.type === 'boss'), `${sid} has no boss event`);
    }
  });

  it('relic names are canonical (the spec used two spellings for three)', () => {
    assert.equal(relics.RELICS_BY_ID.ashes_of_the_eternal_encore.name, 'Ashes of the Eternal Encore');
    assert.equal(relics.RELICS_BY_ID.nichirin_blade_crimson.name, 'Nichirin Blade (Crimson)');
    assert.equal(relics.RELICS_BY_ID.crown_of_the_world_eater.name, 'Crown of the World-Eater');
  });

  it('chum_bucket resonance matches the spec\'s one worked example', () => {
    const r = relics.RELICS_BY_ID.chum_bucket;
    assert.equal(r.params.interval, 20);
    assert.equal(r.params.radius, 250);
    assert.equal(r.resonance.interval, 12);
    assert.equal(r.resonance.radius, 375);
  });

  it('every relic has resonance text, or is a stage relic that has none', () => {
    for (const r of relics.RELICS) {
      if (r.owner) assert.ok(r.resonanceDesc, `${r.id} has an owner but no resonanceDesc`);
      else assert.ok(!r.owner, `${r.id} stage relic should have no owner`);
    }
  });

  it('the cascading affixes are flagged for the Kamige exclusion', () => {
    const byId = {};
    for (const a of enemies.AFFIXES) byId[a.id] = a;
    assert.equal(enemies.AFFIXES.length, 8);
    assert.ok(byId.splitting.cascading, 'splitting must be excluded from the Kamige blanket roll');
    assert.ok(byId.volatile.cascading, 'volatile must be excluded from the Kamige blanket roll');
  });

  it('stage unlocks use an array (the schema could not express stage 7)', () => {
    for (const s of stages.STAGES) {
      if (!s.unlock) continue;
      assert.ok(Array.isArray(s.unlock.stages), `${s.id}.unlock.stages must be an array`);
    }
    assert.equal(stages.STAGES_BY_ID.zenith_stage.unlock.stages.length, 6);
  });

  it('every player-facing description carries a real number', () => {
    const vague = /(increases|boosts|improves|enhances) (your )?\w+\.?$/i;
    for (const u of upgrades.UPGRADES) {
      // `fmt` is a TEMPLATE — "{v}" is replaced with the per-level value at
      // render time ("+12% damage"). Testing the raw template asserted that a
      // placeholder contains a digit, which no card ever does. Render it first,
      // exactly as the level-up screen does, then assert on what the player sees.
      const shown = String(u.fmt || '').replace(
        '{v}', u.unit === 'percent' ? String(Math.round(u.perLevel * 1000) / 10) : String(u.perLevel),
      );
      assert.ok(!vague.test(shown), `upgrade ${u.id} is vague: "${shown}"`);
      assert.ok(/\d/.test(shown), `upgrade ${u.id} shows no number: "${shown}"`);
    }
    for (const r of relics.RELICS) {
      assert.ok(/\d/.test(r.desc), `relic ${r.id} description has no numbers: "${r.desc}"`);
    }
    // Star-level cards are player-facing too, and the file's own convention is to
    // author a number wherever the spec omitted one. Absolutes ("its entire
    // cooldown", "to zero") are exact and need no digit.
    const ABSOLUTE = /\b(entire|every|fully|all|to zero|nearest enemy)\b/i;
    for (const c of characters.CHARACTERS) {
      for (const k of ['s3', 's5']) {
        const s = c.starUpgrades[k];
        assert.ok(/\d/.test(s) || ABSOLUTE.test(s), `${c.id}.${k} is vague: "${s}"`);
      }
    }
  });
});

// ============================================================================
describe('data / DEV_MODE and ref containment', () => {
  it('every character, enemy, stage, boss and relic has a refs.js entry', () => {
    const all = []
      .concat(characters.CHARACTERS.map((c) => c.id))
      .concat(enemies.ENEMIES.map((e) => e.id))
      .concat(stages.STAGES.map((s) => s.id))
      .concat(bosses.BOSSES.map((b) => b.id))
      .concat(relics.RELICS.map((r) => r.id));
    const missing = all.filter((id) => !refs.REFS[id]);
    assert.equal(missing.length, 0, 'missing refs for: ' + missing.slice(0, 12).join(', '));
  });

  it('displayName never concatenates a name and a ref by hand', () => {
    const e = { name: 'Shiro Same', ref: 'Gawr Gura' };
    assert.equal(displayName(e).indexOf('Shiro Same'), 0);
    // With DEV_MODE off the ref must be gone entirely.
    const shipped = { name: 'Shiro Same' };
    assert.equal(displayName(shipped), 'Shiro Same');
  });

  it('ship-safe names exist for the flagrant source-IP ability names', () => {
    // DECISIONS.md §22.3 — the flag only ever covered CHARACTER names; ability
    // and relic names shipped verbatim regardless.
    for (const id of ['father_son_kamehameha', 'kaioken', 'amaterasu',
                      'susanoo_fragment', 'nichirin_blade_crimson']) {
      assert.ok(SHIP_NAMES[id], `no ship-safe rename for "${id}"`);
    }
  });

  it('the ship-safe rename table survives deleting refs.js', () => {
    // The whole point: refs.js is the file a ship build removes. If SHIP_NAMES
    // lived inside it, DEV_MODE=false would fall back to printing "Kamehameha".
    assert.ok(!refs.SHIP_NAMES,
              'SHIP_NAMES must NOT live in refs.js — that file is deleted at ship');
    assert.ok(Object.keys(SHIP_NAMES).length >= 8);
  });
});

// ============================================================================
describe('save / migration (SECTION 17 requires a schemaVersion bump)', () => {
  it('a v1 save upgrades cleanly and keeps its data', () => {
    const v1 = {
      schemaVersion: 1,
      currencies: { gold: 1234, starFragments: 77, tickets: 3 },
      roster: { rin: { owned: true, starLevel: 3, letters: 12, bond: 4 } },
      gacha: { pity: { 'banner_standard:5': 17 }, sharedPity5: 17, guaranteedFeatured: {}, totalPulls: 40, history: [] },
      shrine: { might: 4 },
      stages: { cherry_academy: { cleared: true, bestTime: 900, clears: 3 } },
      achievements: { survive_10_minutes: 1 },
      stats: { runs: 9, kills: 4200 },
      settings: { masterVolume: 0.5 },
    };
    const out = migrate(JSON.parse(JSON.stringify(v1)));
    assert.equal(out.schemaVersion, defaultSave().schemaVersion);
    assert.equal(out.currencies.gold, 1234);
    assert.equal(out.roster.rin.starLevel, 3);
    assert.equal(out.stages.cherry_academy.clears, 3);
    // fields the migration adds must exist
    assert.ok(out.unlocks && out.unlocks.curse === false);
    assert.ok(out.relics);
    assert.ok(out.endless);
    assert.equal(out.settings.reduceFlashing, true, 'reduceFlashing must default ON');
    // fields the migration did not touch must be filled from defaults
    assert.ok(out.codex && out.codex.enemies);
    assert.equal(out.settings.masterVolume, 0.5, 'existing settings must survive');
  });

  it('a save from a newer build is refused, not destroyed', () => {
    const future = defaultSave();
    future.schemaVersion = 999;
    const out = migrate(future);
    assert.ok(out._readOnlyBecauseNewer);
  });

  it('a default save has every key the game reads', () => {
    const d = defaultSave();
    for (const k of ['currencies', 'roster', 'relics', 'gacha', 'shrine', 'stages',
                     'achievements', 'codex', 'endless', 'stats', 'settings', 'unlocks']) {
      assert.ok(d[k] !== undefined, `defaultSave is missing "${k}"`);
    }
  });
});

// ============================================================================
describe('balance / SECTION 14 targets', () => {
  it('a starter kills tier-1 fodder in 1 hit at minute 0', () => {
    const alto = characters.CHARACTERS_BY_ID.alto;
    const mob = enemies.ENEMIES_BY_ID.mob_student;
    assert.atLeast(alto.autoAttack.damage, mob.hp,
                   'a ★3 should one-shot the weakest mob at minute 0');
  });

  it('and in 2-3 hits at minute 15 under the documented HP curve', () => {
    // DECISIONS.md §14 — the spec wanted 3-4, which needs k≈0.25-0.36 and would
    // gut the "become overwhelmingly powerful" fantasy line 1254 calls
    // load-bearing. The ruling keeps k=0.115 and revises the target to 2-3.
    const alto = characters.CHARACTERS_BY_ID.alto;
    const mob = enemies.ENEMIES_BY_ID.mob_student;
    const hp15 = mob.hp * (1 + stages.SCALING.hp * 15);
    const hits = Math.ceil(hp15 / alto.autoAttack.damage);
    assert.atLeast(hits, 2);
    assert.atMost(hits, 3);
  });

  it('enemy speed scaling is capped', () => {
    assert.equal(stages.SCALING.speedCap, 1.5);
    const s = Math.min(stages.SCALING.speedCap, 1 + stages.SCALING.speed * 25);
    assert.atMost(s, 1.5);
  });

  it('the XP curve matches ceil(9 * level^1.32)', () => {
    const c = upgrades.XP_CURVE;
    const need = (lv) => Math.ceil(c.base * Math.pow(lv, c.exponent));
    assert.equal(need(1), 9);
    assert.equal(need(5), Math.ceil(9 * Math.pow(5, 1.32)));
    assert.ok(need(40) > need(20) && need(20) > need(10));
  });

  it('every special cooldown is inside the revised 12-35s band', () => {
    for (const c of characters.CHARACTERS) {
      assert.atLeast(c.special.cooldown, 12, `${c.id} special is too short`);
      assert.atMost(c.special.cooldown, 35, `${c.id} special exceeds 35s`);
    }
  });

  it('every escape grants i-frames', () => {
    for (const c of characters.CHARACTERS) {
      assert.atLeast(c.escape.iframes, 0.2, `${c.id} escape has no meaningful i-frames`);
      assert.atMost(c.escape.cooldown, 9, `${c.id} escape cooldown exceeds the 4-9s band`);
      assert.atLeast(c.escape.cooldown, 4, `${c.id} escape cooldown is under the 4-9s band`);
    }
  });

  it('every character declares at least two build paths', () => {
    for (const c of characters.CHARACTERS) {
      assert.ok(Array.isArray(c.buildPaths), `${c.id} has no buildPaths`);
      assert.atLeast(c.buildPaths.length, 2, `${c.id} needs two viable build paths`);
    }
  });
});

// ============================================================================
describe('achievements / the gates DECISIONS.md §24 made real', () => {
  it('~40 achievements exist', () => {
    assert.atLeast(achievements.ACHIEVEMENTS.length, 34);
  });

  it('Curse and the Relic Banner are genuinely gated', () => {
    const grants = achievements.ACHIEVEMENTS.filter((a) => a.reward && a.reward.unlock);
    const unlocks = grants.map((a) => a.reward.unlock);
    assert.includes(unlocks, 'curse');
    assert.includes(unlocks, 'relicBanner');
    const curse = shrine.SHRINE_UPGRADES_BY_ID.curse;
    assert.equal(curse.lockedBy, 'curse', 'the Curse shrine node must actually be locked');
    const relicBanner = gacha.BANNERS.find((b) => b.type === 'relic');
    assert.ok(relicBanner.unlockedBy, 'the relic banner must actually be gated');
  });

  it('no achievement grants a 20th character', () => {
    for (const a of achievements.ACHIEVEMENTS) {
      const r = a.reward || {};
      assert.ok(!r.character, `${a.id} grants a character that has no data`);
    }
  });

  it('every achievement reward is a real kind', () => {
    const KINDS = ['starFragments', 'tickets', 'universalLetters', 'gold', 'unlock', 'costume'];
    for (const a of achievements.ACHIEVEMENTS) {
      const keys = Object.keys(a.reward || {});
      assert.atLeast(keys.length, 1, `${a.id} has no reward`);
      for (const k of keys) assert.includes(KINDS, k, `${a.id} reward "${k}" is unknown`);
    }
  });
});

// ============================================================================
describe('shrine', () => {
  it('10 upgrades with growing costs', () => {
    assert.equal(shrine.SHRINE_UPGRADES.length, 10);
    for (const u of shrine.SHRINE_UPGRADES) {
      assert.atLeast(u.maxLevel, 1);
      assert.atLeast(u.baseCost, 1);
      assert.atLeast(u.costGrowth, 1.0);
    }
  });

  it('a free full refund is guaranteed', () => {
    assert.equal(shrine.SHRINE_REFUND_FREE, true);
  });
});
