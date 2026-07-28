// THE QUEST LEDGER, EXECUTED.
//
// The failure modes this guards are all silent ones:
//   - a quest tracking a counter nothing resolves, so it can never complete
//   - a quest paying out twice, or paying out again on every scene change
//   - the first-run quest not covering a 10-pull, which is the entire reason
//     the starting grant was cut from two 10-pulls to one character
//   - a fresh save that cannot reach its first pull at all

import { describe, it, assert } from './harness.js';
import * as data from '../src/data/index.js';
import { save } from '../src/core/save.js';
import { storage } from '../src/core/storage.js';
import * as quests from '../src/game/quests.js';

const Q = data.quests;

function freshSave() {
  storage.useMemory();
  save.load();
  save.data.stats.runs = 0;
  save.data.stats.wins = 0;
  save.data.stats.kills = 0;
  save.data.stats.bossKills = 0;
  save.data.stats.bestLevel = 0;
  save.data.stats.bestWeapons = 0;
  save.data.stats.weaponsEvolved = 0;
  save.data.roster = {};
  save.data.stages = {};
  save.data.quests = { claimed: {} };
  save.data.currencies = { gold: 0, starFragments: 0, tickets: 0, universalLetters: 0 };
}

describe('quests / data integrity', () => {
  it('every quest tracks a counter the ledger can actually resolve', () => {
    freshSave();
    const problems = quests.validate();
    assert.equal(problems.length, 0, problems.join('\n      '));
  });

  it('every quest pays something and says what it pays', () => {
    for (const q of Q.QUESTS) {
      assert.ok(q.reward && Object.keys(q.reward).length > 0, q.id + ' pays nothing');
      assert.ok(q.rewardText && q.rewardText.length > 3, q.id + ' does not say what it pays');
      assert.ok(q.desc && /[.!]$/.test(q.desc), q.id + ' has no imperative description');
      assert.ok(Q.QUEST_TIERS.indexOf(q.tier) >= 0, q.id + ' has an unknown tier ' + q.tier);
    }
  });

  it('quest ids are unique', () => {
    const seen = Object.create(null);
    for (const q of Q.QUESTS) {
      assert.ok(!seen[q.id], 'duplicate quest id ' + q.id);
      seen[q.id] = 1;
    }
  });

  it('the first quest covers exactly one 10-pull', () => {
    // This is the load-bearing number of the whole opening: the starting grant
    // was cut from two 10-pulls to one character precisely because the first
    // run is supposed to buy the first pull.
    const first = Q.QUESTS_BY_ID.first_run;
    assert.ok(first, 'there is no first-run quest');
    assert.equal(first.track.kind, 'runs');
    assert.equal(first.track.value, 1, 'the first quest must land after ONE run');
    const tenPull = data.gacha.BANNERS.find((b) => b.type === 'standard').costTen;
    assert.atLeast(first.reward.starFragments, tenPull,
                   `pays ${first.reward.starFragments}, a 10-pull costs ${tenPull}`);
  });

  it('a fresh save starts with nothing to pull with', () => {
    // If the grant still handed over fragments, the first quest would be paying
    // for something the player already had.
    assert.equal(Q.STARTING_GRANT.starFragments, 0);
    assert.equal(Q.STARTING_GRANT.characters, 1);
    assert.equal(Q.STARTING_GRANT.fromRarity, 3);
  });
});

describe('quests / settling', () => {
  it('nothing pays out on a completely fresh save', () => {
    freshSave();
    const paid = quests.settle();
    assert.equal(paid.length, 0, 'paid out ' + paid.map((q) => q.id).join(', ') + ' for doing nothing');
    assert.equal(save.data.currencies.starFragments, 0);
  });

  it('finishing one run pays the first quest, once and only once', () => {
    freshSave();
    save.data.stats.runs = 1;

    const paid = quests.settle();
    const ids = paid.map((q) => q.id);
    assert.ok(ids.indexOf('first_run') >= 0, 'the first-run quest did not pay: ' + ids.join(','));
    const after = save.data.currencies.starFragments;
    assert.atLeast(after, 135, 'not enough for a 10-pull after the first run');

    // Settle again, and again — the ledger must not re-pay.
    quests.settle();
    quests.settle();
    assert.equal(save.data.currencies.starFragments, after, 'a quest paid out more than once');
  });

  it('a quest completed before it existed still credits retroactively', () => {
    // Quests are DERIVED from lifetime counters, so a save that has already
    // done the work gets paid the moment the ledger first runs.
    freshSave();
    save.data.stats.runs = 40;
    save.data.stats.kills = 50000;
    const paid = quests.settle();
    const ids = paid.map((q) => q.id);
    assert.ok(ids.indexOf('first_run') >= 0);
    assert.ok(ids.indexOf('five_runs') >= 0);
    assert.ok(ids.indexOf('twenty_runs') >= 0);
    assert.ok(ids.indexOf('ten_thousand') >= 0, 'a long-completed kill quest did not credit');
  });

  it('progress reports honest fractions and never exceeds 1', () => {
    freshSave();
    save.data.stats.kills = 400;
    const q = Q.QUESTS_BY_ID.first_thousand;
    const p = quests.progress(q);
    assert.equal(p.have, 400);
    assert.equal(p.need, 1000);
    assert.equal(p.done, false);
    assert.close(p.fraction, 0.4, 1e-9);

    save.data.stats.kills = 99999;
    const p2 = quests.progress(q);
    assert.equal(p2.done, true);
    assert.equal(p2.fraction, 1, 'fraction ran past 1');
  });

  it('recordRun captures the per-run maxima a lifetime total cannot', () => {
    freshSave();
    quests.recordRun({ level: 12, weapons: [{ evolved: false }, { evolved: true }] });
    assert.equal(save.data.stats.bestLevel, 12);
    assert.equal(save.data.stats.bestWeapons, 2);
    assert.equal(save.data.stats.weaponsEvolved, 1);

    // A worse run must not lower a best.
    quests.recordRun({ level: 4, weapons: [{ evolved: true }] });
    assert.equal(save.data.stats.bestLevel, 12, 'bestLevel regressed');
    assert.equal(save.data.stats.bestWeapons, 2, 'bestWeapons regressed');
    assert.equal(save.data.stats.weaponsEvolved, 2, 'evolutions must accumulate, not peak');
  });

  it('the board orders ready-to-pay first and completed last', () => {
    freshSave();
    save.data.stats.runs = 1;
    const rows = quests.board();
    assert.atLeast(rows.length, Q.QUESTS.length);
    assert.equal(rows[0].done && !rows[0].claimed, true, 'a completed quest is not at the top');
    quests.settle();
    const after = quests.board();
    assert.equal(after[after.length - 1].claimed, true, 'a paid quest is not at the bottom');
  });
});

describe('gacha / the rates were tightened', () => {
  it('a ★5 is meaningfully rarer than it was', () => {
    // Play feedback: "make it harder to pull 5 star units, they are strong and
    // too easy to get." 16% base put one in essentially every 10-pull.
    const r = data.gacha.BASE_RATES;
    assert.lessThan(r[5], 0.10, `★5 base rate is ${r[5]}, still too generous`);
    assert.close(r[3] + r[4] + r[5] + r[6], 1.0, 1e-9, 'rates no longer sum to 1');
    assert.atLeast(data.gacha.PITY.hard5, 50, 'hard pity still arrives almost immediately');
    assert.ok(data.gacha.PITY.soft5 < data.gacha.PITY.hard5);
    assert.ok(data.gacha.PITY.soft6 < data.gacha.PITY.hard6);
  });

  it('a 10-pull is no longer a formality', () => {
    // The chance of at least one ★5+ in ten pulls, at the base rate.
    const base = data.gacha.BASE_RATES[5] + data.gacha.BASE_RATES[6];
    const noneInTen = Math.pow(1 - base, 10);
    assert.atLeast(noneInTen, 0.30,
                   'ten pulls still almost guarantees a ★5 (' +
                   Math.round((1 - noneInTen) * 100) + '% chance of one)');
  });
});
