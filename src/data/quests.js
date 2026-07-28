// QUESTS — the between-runs reward ladder. Pure data.
//
// WHY THIS EXISTS
// ---------------
// A fresh save used to hand you both ★3 starters and 300 fragments — two
// 10-pulls, before you had played a single second. That is the whole opening of
// the game given away for nothing, and it left the first run with no stake in it
// at all: you had already seen the gacha, so finishing a run rewarded you with a
// number going up in a menu you had stopped caring about.
//
// Now you start with ONE character, no fragments, and the pulls are something
// you earn. The first quest pays out exactly one 10-pull for finishing your
// first run — win or lose, because a new player losing their first run is the
// expected outcome and punishing it teaches nothing.
//
// SCHEMA
//   id            canonical, persisted in save.data.quests.claimed. Never rename.
//   name/icon     card face.
//   desc          what to do, in the imperative.
//   track         { kind, value } — the counter and the target. `kind` is
//                 resolved in game/quests.js against the save blob; a kind with
//                 no resolver is a hard error at boot, not a quest that can
//                 never complete.
//   reward        { starFragments?, gold?, tickets?, universalLetters? }
//   rewardText    the payout in words, for the card. Written, not generated, so
//                 it can say WHY the number is what it is.
//   tier          the band it belongs to, for grouping on the quest board.
//
// Quests complete and pay out AUTOMATICALLY the moment their counter is met —
// there is no claim button. A reward you have earned but not noticed a button
// for is a reward the game failed to give you.

export const QUEST_TIERS = ['Opening', 'Career', 'Mastery'];

export const QUESTS = [
  // --- Opening: the first hour ------------------------------------------------
  {
    id: 'first_run', name: 'Opening Night', icon: '🎬', tier: 'Opening',
    desc: 'Finish a run. Win or lose — both count.',
    track: { kind: 'runs', value: 1 },
    reward: { starFragments: 135 },
    rewardText: '135 💎 — exactly one 10-pull, and the pity counter to go with it',
  },
  {
    id: 'first_clear', name: 'Curtain Call', icon: '🏆', tier: 'Opening',
    desc: 'Clear a stage. Kill the boss at the end of it.',
    track: { kind: 'wins', value: 1 },
    reward: { starFragments: 150, gold: 400 },
    rewardText: '150 💎 and 400 ⭐',
  },
  {
    id: 'first_evolution', name: 'It Never Stops', icon: '♾', tier: 'Opening',
    desc: 'Take a weapon to max level and evolve it.',
    track: { kind: 'weaponsEvolved', value: 1 },
    reward: { starFragments: 90 },
    rewardText: '90 💎',
  },
  {
    id: 'first_thousand', name: 'Warmed Up', icon: '☠', tier: 'Opening',
    desc: 'Kill 1,000 enemies. It goes faster than you think.',
    track: { kind: 'kills', value: 1000 },
    reward: { gold: 600 },
    rewardText: '600 ⭐ toward the Shrine',
  },
  {
    id: 'full_arsenal', name: 'Fully Loaded', icon: '⚔', tier: 'Opening',
    desc: 'Fill all five weapon slots in a single run.',
    track: { kind: 'bestWeapons', value: 5 },
    reward: { starFragments: 105 },
    rewardText: '105 💎',
  },

  // --- Career: the first evening ----------------------------------------------
  {
    id: 'five_runs', name: 'Regular Booking', icon: '📅', tier: 'Career',
    desc: 'Finish five runs.',
    track: { kind: 'runs', value: 5 },
    reward: { starFragments: 135, gold: 500 },
    rewardText: 'another 10-pull, and 500 ⭐',
  },
  {
    id: 'three_owned', name: 'An Ensemble', icon: '🎴', tier: 'Career',
    desc: 'Have three characters on the roster.',
    track: { kind: 'owned', value: 3 },
    reward: { universalLetters: 20 },
    rewardText: '20 💌 — universal letters raise anyone\'s star level',
  },
  {
    id: 'boss_hunter', name: 'Headliner', icon: '👹', tier: 'Career',
    desc: 'Kill ten bosses.',
    track: { kind: 'bossKills', value: 10 },
    reward: { starFragments: 180, tickets: 1 },
    rewardText: '180 💎 and a 🎟 ticket',
  },
  {
    id: 'level_thirty', name: 'Deep Cut', icon: '📈', tier: 'Career',
    desc: 'Reach player level 30 inside one run.',
    track: { kind: 'bestLevel', value: 30 },
    reward: { starFragments: 120 },
    rewardText: '120 💎',
  },
  {
    id: 'two_stages', name: 'Touring', icon: '🎭', tier: 'Career',
    desc: 'Clear two different stages.',
    track: { kind: 'stagesCleared', value: 2 },
    reward: { starFragments: 150, gold: 800 },
    rewardText: '150 💎 and 800 ⭐',
  },

  // --- Mastery: the long tail --------------------------------------------------
  {
    id: 'twenty_runs', name: 'Resident Act', icon: '🌟', tier: 'Mastery',
    desc: 'Finish twenty runs.',
    track: { kind: 'runs', value: 20 },
    reward: { starFragments: 270 },
    rewardText: '270 💎 — two 10-pulls',
  },
  {
    id: 'six_owned', name: 'A Real Roster', icon: '👥', tier: 'Mastery',
    desc: 'Have six characters.',
    track: { kind: 'owned', value: 6 },
    reward: { universalLetters: 40, tickets: 2 },
    rewardText: '40 💌 and 2 🎟',
  },
  {
    id: 'ten_thousand', name: 'Bodycount', icon: '💀', tier: 'Mastery',
    desc: 'Kill 10,000 enemies across every run.',
    track: { kind: 'kills', value: 10000 },
    reward: { starFragments: 200, gold: 2000 },
    rewardText: '200 💎 and 2,000 ⭐',
  },
  {
    id: 'three_evolutions', name: 'Perpetual Motion', icon: '🌀', tier: 'Mastery',
    desc: 'Evolve ten weapons, across any number of runs.',
    track: { kind: 'weaponsEvolved', value: 10 },
    reward: { starFragments: 240 },
    rewardText: '240 💎',
  },
  {
    id: 'five_stages', name: 'The Whole Circuit', icon: '🗺', tier: 'Mastery',
    desc: 'Clear five different stages.',
    track: { kind: 'stagesCleared', value: 5 },
    reward: { starFragments: 400, tickets: 3 },
    rewardText: '400 💎 and 3 🎟',
  },
];

export const QUESTS_BY_ID = Object.fromEntries(QUESTS.map((q) => [q.id, q]));

/** Every counter a quest is allowed to track. game/quests.js must resolve all of them. */
export const TRACK_KINDS = [
  'runs', 'wins', 'kills', 'bossKills', 'owned', 'stagesCleared',
  'bestLevel', 'bestWeapons', 'weaponsEvolved',
];

/**
 * The starting grant, now that the game no longer hands over two 10-pulls before
 * the player has done anything. ONE character from the ★3 pool and no
 * fragments — the first quest pays for the first pull.
 */
export const STARTING_GRANT = { characters: 1, fromRarity: 3, starFragments: 0 };
