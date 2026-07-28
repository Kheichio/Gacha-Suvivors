// THE QUEST LEDGER — evaluate, pay out, and remember.
//
// Quests are DERIVED, not accumulated. Every counter a quest tracks is already
// somewhere in the save blob (lifetime kills, runs, bosses, roster size,
// stages cleared), so this module reads rather than writes — the only thing it
// persists is which quests have already paid out. That means a quest added in a
// later version retroactively credits the play you have already done, instead
// of starting from zero and silently punishing an existing save.
//
// Two counters did not exist yet and are recorded by the run itself:
// `bestLevel` (the highest player level reached in any single run) and
// `bestWeapons` (the most weapon slots filled in any single run). Both are
// per-run maxima, which no lifetime total can reconstruct.

import { save, addCurrency } from '../core/save.js';
import { events } from '../core/events.js';
import { QUESTS, QUESTS_BY_ID, TRACK_KINDS } from '../data/quests.js';

/** save.data.quests, created on demand so an old save needs no migration. */
function ledger() {
  if (!save.data.quests) save.data.quests = { claimed: {} };
  if (!save.data.quests.claimed) save.data.quests.claimed = {};
  return save.data.quests;
}

/** How many characters are owned right now. */
function ownedCount() {
  let n = 0;
  for (const k in save.data.roster) if (save.data.roster[k].owned) n++;
  return n;
}

function clearedCount() {
  let n = 0;
  for (const k in save.data.stages) if (save.data.stages[k].cleared) n++;
  return n;
}

/**
 * The current value of a tracked counter.
 * An unknown kind returns -1 rather than 0, so `progress()` can report it as
 * broken instead of as a quest that is merely not started yet.
 */
export function counter(kind) {
  const s = save.data.stats || {};
  switch (kind) {
    case 'runs': return s.runs | 0;
    case 'wins': return s.wins | 0;
    case 'kills': return s.kills | 0;
    case 'bossKills': return s.bossKills | 0;
    case 'owned': return ownedCount();
    case 'stagesCleared': return clearedCount();
    case 'bestLevel': return s.bestLevel | 0;
    case 'bestWeapons': return s.bestWeapons | 0;
    case 'weaponsEvolved': return s.weaponsEvolved | 0;
    default: return -1;
  }
}

/** {have, need, done, claimed, fraction} for one quest. */
export function progress(quest) {
  const have = counter(quest.track.kind);
  const need = quest.track.value;
  const claimed = !!ledger().claimed[quest.id];
  return {
    have: Math.max(0, have), need, claimed,
    done: have >= need,
    fraction: need > 0 ? Math.min(1, Math.max(0, have) / need) : 0,
    broken: have < 0,
  };
}

/** Every quest, in board order: unclaimed-and-complete first, then closest. */
export function board() {
  const rows = [];
  for (const q of QUESTS) {
    const p = progress(q);
    rows.push({ quest: q, ...p });
  }
  rows.sort((a, b) => {
    const rank = (r) => (r.done && !r.claimed ? 0 : r.claimed ? 2 : 1);
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return b.fraction - a.fraction;
  });
  return rows;
}

export function unclaimedCount() {
  let n = 0;
  for (const q of QUESTS) {
    const p = progress(q);
    if (p.done && !p.claimed) n++;
  }
  return n;
}

export function completedCount() {
  let n = 0;
  for (const q of QUESTS) if (ledger().claimed[q.id]) n++;
  return n;
}

/**
 * Pay out every quest whose counter is met and which has not paid before.
 *
 * There is no claim button, deliberately: a reward you earned but never found
 * the screen for is a reward the game failed to give you. Returns the quests it
 * just paid, so the caller can put them on screen.
 */
export function settle() {
  const paid = [];
  const L = ledger();
  for (const q of QUESTS) {
    if (L.claimed[q.id]) continue;
    const p = progress(q);
    if (p.broken || !p.done) continue;
    L.claimed[q.id] = 1;
    for (const kind in q.reward) addCurrency(kind, q.reward[kind]);
    paid.push(q);
    events.emit('quest:complete', q);
  }
  if (paid.length) save.save();
  return paid;
}

/**
 * Record the per-run maxima a lifetime total cannot reconstruct. Called once,
 * from the results payout, with the run summary.
 */
export function recordRun(summary) {
  const s = save.data.stats;
  if (!s) return;
  if ((summary.level | 0) > (s.bestLevel | 0)) s.bestLevel = summary.level | 0;
  const weapons = summary.weapons ? summary.weapons.length : 0;
  if (weapons > (s.bestWeapons | 0)) s.bestWeapons = weapons;
  let evolved = 0;
  for (const w of summary.weapons || []) if (w.evolved) evolved++;
  s.weaponsEvolved = (s.weaponsEvolved | 0) + evolved;
}

/** Boot-time integrity: every quest must track a counter this module resolves. */
export function validate() {
  const problems = [];
  for (const q of QUESTS) {
    if (!q.track || TRACK_KINDS.indexOf(q.track.kind) < 0) {
      problems.push(`quest ${q.id}: unknown track kind "${q.track && q.track.kind}"`);
    } else if (counter(q.track.kind) < 0) {
      problems.push(`quest ${q.id}: track kind "${q.track.kind}" has no resolver`);
    }
    if (!q.reward || Object.keys(q.reward).length === 0) {
      problems.push(`quest ${q.id}: pays nothing`);
    }
  }
  return problems;
}

export { QUESTS, QUESTS_BY_ID };
