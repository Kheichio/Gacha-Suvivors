// ACHIEVEMENTS — 40 of them. SECTION 12 of the design spec (prompt lines 1587-1595).
//
// PURE DATA. The achievement watcher subscribes to core/events.js and tests each
// `condition` against the counters in the save blob (core/save.js: `stats`,
// `stages`, `roster`, `codex`, `gacha`). Nothing in this file knows how that works.
//
// No `ref`, `refSource` or `refNotes` strings live here — every ref string in the
// project is in src/data/refs.js, joined by id at display time (DECISIONS.md §22).
//
// ---------------------------------------------------------------------------
// DECISIONS.md §24 — THREE OF THESE GATES ARE REAL, NOT DECORATIVE
// ---------------------------------------------------------------------------
// The spec awards unlocks for three things that were never locked in the first
// place. The ruling was to make the gates real rather than delete the rewards:
//
//   * `kill_10000_enemies`     -> unlocks CURSE. shrine.js marks that upgrade
//                                 `lockedBy: 'curse'` and it is genuinely
//                                 unbuyable until this fires.
//   * `reach_level_60`         -> unlocks the Relic Banner. gacha.js sets
//                                 banner_relic.unlockedBy = 'reach_level_60'.
//                                 THAT STRING IS THIS ID. Do not rename it.
//   * `survive_stage_manager`  -> 200💎 + a costume tint, NOT "a secret character
//                                 slot". A 20th character with no data, no ref and
//                                 no rarity is a bug with a reward attached.
//
// Each `unlock` reward flips the matching flag in save.unlocks.
//
// ---------------------------------------------------------------------------
// SCHEMA
//   id         canonical id, stored in save.achievements as `id -> unlockedAt`.
//   name/icon  the toast face. One emoji, rasterised at boot with everything else.
//   desc       exactly what the player has to do. Real numbers, never "a lot of".
//   condition  { kind, value, target? }
//                kind    one of the 25 kinds below. Nothing else is evaluated.
//                value   the threshold the tracked counter must REACH (>=).
//                target  optional. Narrows what is counted — a stage id, boss id,
//                        difficulty tier id or character id. Absent means "any".
//                        One optional field rather than four typed ones, so adding
//                        a kind never changes the shape of the object.
//   reward     { starFragments } | { tickets } | { universalLetters } |
//              { unlock } | { costume } — and combinations of those keys.
//   hidden     true = the row reads ??? in the list until it fires. Hidden entries
//              are jokes and surprises only; nothing needed to finish the game is
//              hidden, and neither of the two real unlock gates is.
//   toast      OPTIONAL second line in the unlock toast. Authored where a joke
//              actually lands. The toast falls back to `desc` when it is absent.
//
// CONDITION KINDS (all 25 are used at least once below — none is dead code):
//   runTime runLevel runKills            per-run peaks
//   totalKills totalRuns totalWins       lifetime counters
//   bossKills noDamageBoss               boss records
//   stageCleared allStagesCleared        per-stage clears; target = tier for the
//                                        "all" form ("all 7 on Legend or higher")
//   difficultyCleared                    any stage on target tier
//   charactersOwned relicsOwned starLevel bondLevel   collection
//   pullsTotal lost5050 fanLettersSpent  gacha
//   goldTotal upgradeMaxed evolutionsFound            in-run economy
//   endlessTime characterWins codexEntries survivedStageManager
//
// ---------------------------------------------------------------------------
// PAYOUT: 2,120💎 + 11 pull tickets + 50 Universal Fan Letters across all 40 —
// roughly 150 pulls over the lifetime of a save. DECISIONS.md §1 prices
// achievements at 20-200💎 each and SECTION 5 says "be generous"; every award
// below sits inside that band. The two 200💎 payouts are the roster capstone and
// the Stage Manager, which is correct: they are the two hardest rows here.
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS = [
  // -------------------------------------------------------------------------
  // SURVIVAL — the spine of the list. 20 minutes needs Tatami Halls, the Zenith
  // Stage or Endless; every other stage ends when its boss dies before then.
  // -------------------------------------------------------------------------
  {
    id: 'survive_5_minutes', name: 'Cold Open', icon: '⏱',
    desc: 'Survive 5 minutes in a single run.',
    condition: { kind: 'runTime', value: 300 },
    // The first achievement most players will ever see. It pays a ticket rather
    // than fragments so the reward physically walks them to the gacha machine.
    reward: { tickets: 1 },
    hidden: false,
    toast: 'Five minutes in and still standing. The opening theme has not even finished. Here is a free pull.',
  },
  {
    id: 'survive_10_minutes', name: 'Overtime', icon: '⌛',
    desc: 'Survive 10 minutes in a single run.',
    condition: { kind: 'runTime', value: 600 },
    reward: { starFragments: 20 },
    hidden: false,
  },
  {
    id: 'survive_20_minutes', name: 'Season Finale', icon: '🎬',
    desc: 'Survive 20 minutes in a single run.',
    condition: { kind: 'runTime', value: 1200 },
    reward: { starFragments: 40 },
    hidden: false,
    toast: 'Twenty minutes on one life. Somewhere a producer is quietly greenlighting a second season.',
  },

  // -------------------------------------------------------------------------
  // LEVEL — a normal run produces 15-25 level-ups (SECTION 14), so 30 is already
  // a build and 60 is a project. That is the point: level 60 is a REAL gate.
  // -------------------------------------------------------------------------
  {
    id: 'reach_level_30', name: 'Power Creep', icon: '📈',
    desc: 'Reach level 30 in a single run.',
    condition: { kind: 'runLevel', value: 30 },
    reward: { starFragments: 25 },
    hidden: false,
    toast: 'Thirty levels. The upgrade screen has started offering you things you already have twice.',
  },
  {
    // DECISIONS.md §24 gate #2. gacha.js reads this exact id.
    id: 'reach_level_60', name: 'Main Character', icon: '🌟',
    desc: 'Reach level 60 in a single run. Unlocks the Signature Gear relic banner.',
    condition: { kind: 'runLevel', value: 60 },
    reward: { unlock: 'relicBanner' },
    hidden: false,
    toast: 'Level 60. The camera has stopped panning to anyone else. Signature Gear is open for business.',
  },

  // -------------------------------------------------------------------------
  // KILLS
  // -------------------------------------------------------------------------
  {
    id: 'kill_1000_in_a_run', name: 'Crowd Work', icon: '💀',
    desc: 'Kill 1,000 enemies in a single run.',
    condition: { kind: 'runKills', value: 1000 },
    reward: { starFragments: 25 },
    hidden: false,
  },
  {
    id: 'kill_3000_in_a_run', name: 'Bullet Heaven', icon: '☄',
    desc: 'Kill 3,000 enemies in a single run.',
    condition: { kind: 'runKills', value: 3000 },
    reward: { starFragments: 50 },
    hidden: false,
    toast: 'Three thousand in twenty minutes. You are no longer fighting a crowd, you are weather.',
  },
  {
    // DECISIONS.md §24 gate #1. shrine.js: curse.lockedBy === 'curse', and
    // save.unlocks.curse starts false. Until this fires the row is unbuyable.
    id: 'kill_10000_enemies', name: 'Ten Thousand Reasons', icon: '🔥',
    desc: 'Kill 10,000 enemies in total. Unlocks CURSE at the Shrine.',
    condition: { kind: 'totalKills', value: 10000 },
    reward: { unlock: 'curse' },
    hidden: false,
    toast: 'Ten thousand. The Shrine noticed, and it has an offer: +10% more of them, +8% more of everything they drop. Per level. Your call.',
  },

  // -------------------------------------------------------------------------
  // RUNS, WINS AND BOSSES
  // -------------------------------------------------------------------------
  {
    id: 'win_10_runs', name: 'Reliable Closer', icon: '🥇',
    desc: 'Win 10 runs.',
    condition: { kind: 'totalWins', value: 10 },
    reward: { starFragments: 40 },
    hidden: false,
  },
  {
    id: 'boss_kills_10', name: 'Arc Villain', icon: '👹',
    desc: 'Defeat 10 bosses.',
    condition: { kind: 'bossKills', value: 10 },
    reward: { starFragments: 30 },
    hidden: false,
    toast: "Ten bosses down. At this point you are the recurring problem in somebody else's story.",
  },
  {
    id: 'flawless_boss', name: 'Not a Scratch', icon: '🕊',
    desc: 'Defeat any boss without taking a single point of damage.',
    condition: { kind: 'noDamageBoss', value: 1 },
    reward: { starFragments: 50 },
    hidden: false,
  },
  {
    // `target` narrows the same kind to one boss. No new kind, no new field.
    id: 'flawless_final_form', name: 'Untouchable', icon: '👑',
    desc: 'Defeat THE FINAL FORM without taking a single point of damage.',
    condition: { kind: 'noDamageBoss', value: 1, target: 'the_final_form' },
    reward: { starFragments: 100 },
    hidden: false,
    toast: 'Seven phases, every telegraph read, not one hit taken. Roll credits. Roll them slowly.',
  },

  // -------------------------------------------------------------------------
  // FIRST CLEARS — one per stage. These stack ON TOP of the stage's own
  // firstClearReward in stages.js (50💎 + a relic); they are separate systems and
  // the results screen shows them on separate lines.
  // -------------------------------------------------------------------------
  {
    id: 'clear_cherry_academy', name: 'Graduation Day', icon: '🌸',
    desc: 'Clear Cherry Blossom Academy.',
    condition: { kind: 'stageCleared', value: 1, target: 'cherry_academy' },
    reward: { starFragments: 20 },
    hidden: false,
    toast: 'Three years of your life happened on that roof. Nobody ever attended a class.',
  },
  {
    id: 'clear_neon_akiba', name: 'Sold Out', icon: '🏮',
    desc: 'Clear the Neon Akiba District.',
    condition: { kind: 'stageCleared', value: 1, target: 'neon_akiba' },
    reward: { starFragments: 20 },
    hidden: false,
  },
  {
    id: 'clear_wall_amaris', name: 'Beyond the Wall', icon: '🧱',
    desc: 'Clear the Ruins of Wall Amaris.',
    condition: { kind: 'stageCleared', value: 1, target: 'wall_amaris' },
    reward: { starFragments: 20 },
    hidden: false,
    toast: 'It was a town. There were bakeries. You finished the sentence nobody else could.',
  },
  {
    id: 'clear_hidden_ember', name: 'Seal of Approval', icon: '🗝',
    desc: 'Clear Hidden Ember Village.',
    condition: { kind: 'stageCleared', value: 1, target: 'hidden_ember' },
    reward: { starFragments: 25 },
    hidden: false,
  },
  {
    id: 'clear_tatami_halls', name: 'Room Service', icon: '🎴',
    desc: 'Clear the Endless Tatami Halls.',
    condition: { kind: 'stageCleared', value: 1, target: 'tatami_halls' },
    reward: { starFragments: 25 },
    hidden: false,
    toast: 'The corridor had other plans. You had a schedule.',
  },
  {
    id: 'clear_sunken_reef', name: 'Encore, Underwater', icon: '🌊',
    desc: 'Clear the Sunken Idol Reef.',
    condition: { kind: 'stageCleared', value: 1, target: 'sunken_reef' },
    reward: { starFragments: 25 },
    hidden: false,
  },
  {
    // The Zenith Stage's own first clear already pays 200💎 and Endless Mode
    // (stages.js). This one pays tickets so the two rewards do not collide.
    id: 'clear_zenith_stage', name: 'Headliner', icon: '🎤',
    desc: 'Clear the Zenith Stage.',
    condition: { kind: 'stageCleared', value: 1, target: 'zenith_stage' },
    reward: { tickets: 10 },
    hidden: false,
    toast: 'The spotlights were hunting for a headliner. They found one. Ten pull tickets, on the house.',
  },

  // -------------------------------------------------------------------------
  // DIFFICULTY TIERS — tier ids from DIFFICULTY_TIERS in stages.js.
  // -------------------------------------------------------------------------
  {
    id: 'clear_encore_tier', name: 'Encore!', icon: '🎵',
    desc: 'Clear any stage on Encore difficulty.',
    condition: { kind: 'difficultyCleared', value: 1, target: 'encore' },
    reward: { starFragments: 30 },
    hidden: false,
  },
  {
    id: 'clear_kamige_tier', name: 'Kamige', icon: '🔱',
    desc: 'Clear any stage on Kamige difficulty.',
    condition: { kind: 'difficultyCleared', value: 1, target: 'kamige' },
    reward: { starFragments: 150 },
    hidden: false,
    toast: '+400% enemy HP, an affix on every single mob, and you cleared it. Kamige means god-tier. It was not talking about the game.',
  },
  {
    // The one place `allStagesCleared` earns its keep: clearing the Zenith Stage
    // already implies clearing 1-6, so the "all stages" form is only meaningful
    // with a tier attached. Legend or higher, all seven.
    id: 'all_stages_legend', name: 'The Whole Season', icon: '📅',
    desc: 'Clear all 7 stages on Legend difficulty or higher.',
    condition: { kind: 'allStagesCleared', value: 7, target: 'legend' },
    reward: { starFragments: 150 },
    hidden: false,
  },

  // -------------------------------------------------------------------------
  // COLLECTION
  // -------------------------------------------------------------------------
  {
    id: 'own_10_characters', name: 'Ensemble Cast', icon: '👥',
    desc: 'Own 10 characters.',
    // Verbatim from the spec: "Own 10 characters -> Universal Fan Letters x50".
    reward: { universalLetters: 50 },
    condition: { kind: 'charactersOwned', value: 10 },
    hidden: false,
    toast: 'Ten of them, milling about the studio, clicking on things. It is a workplace now.',
  },
  {
    id: 'own_all_characters', name: 'Full Roster', icon: '🎊',
    desc: 'Own all 19 characters.',
    condition: { kind: 'charactersOwned', value: 19 },
    reward: { starFragments: 200 },
    hidden: false,
    toast: 'All nineteen. Every desk taken, every idle animation running at once. Somebody put on a kettle.',
  },
  {
    id: 'own_all_relics', name: 'Signature Collection', icon: '🏛',
    desc: 'Own all 24 relics.',
    condition: { kind: 'relicsOwned', value: 24 },
    reward: { starFragments: 100 },
    hidden: false,
  },
  {
    id: 'star_level_5', name: 'Five Stars, No Notes', icon: '⭐',
    desc: 'Raise any character to Star Level 5.',
    condition: { kind: 'starLevel', value: 5 },
    reward: { starFragments: 60 },
    hidden: false,
    toast: 'S5. Two escape charges and an upgraded escape. You have made someone genuinely unfair.',
  },
  {
    id: 'bond_15', name: 'Best Friends', icon: '💞',
    desc: 'Reach Bond 15 with any character.',
    condition: { kind: 'bondLevel', value: 15 },
    reward: { starFragments: 40 },
    hidden: false,
    toast: 'Bond 15. New barks, a costume tint, and a running joke only the two of you understand.',
  },
  {
    // ~107 codex entries exist in total (35 enemies + 7 bosses + 7 mid-bosses +
    // 7 elites + the Stage Manager + 24 relics + 19 characters + 7 stages), so 75
    // is "you have seen most of the game" without demanding the last rare mob.
    id: 'codex_75', name: 'Lore Accurate', icon: '📚',
    desc: 'Record 75 codex entries.',
    condition: { kind: 'codexEntries', value: 75 },
    reward: { starFragments: 40 },
    hidden: false,
  },

  // -------------------------------------------------------------------------
  // GACHA
  // -------------------------------------------------------------------------
  {
    id: 'pulls_100', name: 'The Machine Is Rattling', icon: '🎰',
    desc: 'Make 100 pulls.',
    condition: { kind: 'pullsTotal', value: 100 },
    reward: { starFragments: 30 },
    hidden: false,
  },
  {
    id: 'fan_letters_500', name: 'Fan Mail', icon: '💌',
    desc: 'Spend 500 Fan Letters.',
    condition: { kind: 'fanLettersSpent', value: 500 },
    reward: { starFragments: 25 },
    hidden: false,
  },

  // -------------------------------------------------------------------------
  // IN-RUN ECONOMY AND BUILDS
  // -------------------------------------------------------------------------
  {
    // A full 20-minute run pays 250-450 gold (SECTION 14), so this lands around
    // run 200 unstacked — and far sooner with Fortune, Cursed Coin or Stage 6.
    id: 'gold_100000', name: 'Liquid Assets', icon: '💰',
    desc: 'Earn 100,000 gold in total.',
    condition: { kind: 'goldTotal', value: 100000 },
    reward: { starFragments: 40 },
    hidden: false,
  },
  {
    id: 'upgrade_maxed', name: 'Maxed Out', icon: '📐',
    desc: 'Take any upgrade to its final level in a single run.',
    condition: { kind: 'upgradeMaxed', value: 1 },
    reward: { starFragments: 20 },
    hidden: false,
  },
  {
    id: 'first_evolution', name: 'It Evolved', icon: '✨',
    desc: 'Discover your first evolution.',
    condition: { kind: 'evolutionsFound', value: 1 },
    reward: { starFragments: 25 },
    hidden: false,
    toast: 'A maxed upgrade, the right relic, and the screen went white for a second. There are seven more.',
  },
  {
    id: 'all_evolutions', name: 'The Full Recipe Book', icon: '🧬',
    desc: 'Discover all 8 evolutions.',
    condition: { kind: 'evolutionsFound', value: 8 },
    reward: { starFragments: 120 },
    hidden: false,
  },
  {
    id: 'endless_10_minutes', name: 'No Curtain Call', icon: '♾',
    desc: 'Survive 10 minutes in Endless Mode.',
    condition: { kind: 'endlessTime', value: 600 },
    reward: { starFragments: 50 },
    hidden: false,
  },

  // -------------------------------------------------------------------------
  // HIDDEN (5). Jokes and surprises only — nothing required to finish the game
  // is hidden, and neither real unlock gate is. These read as ??? until they
  // fire, which is the whole delivery mechanism for the punchline.
  // -------------------------------------------------------------------------
  {
    // DECISIONS.md §24 gate #3. NOT a secret character — 200💎 and a costume
    // tint. The Stage Manager arrives at duration + 3:00 with a clipboard and
    // 999,999 HP; you cannot kill him, you can only be inconvenient about it
    // (DECISIONS.md §21). Nekromina gets the costume because a stagehand's
    // blacks and a lanyard on the Grave Idol is the funniest possible trophy for
    // outlasting the crew.
    id: 'survive_stage_manager', name: 'Not In The Script', icon: '🧹',
    desc: 'Survive 60 seconds against the Stage Manager.',
    condition: { kind: 'survivedStageManager', value: 60 },
    reward: { starFragments: 200, costume: 'nekromina' },
    hidden: true,
    toast: 'No health bar. No telegraph. No interest in negotiating. Just a clipboard, a schedule, and you on it — for sixty entire seconds. Backstage blacks unlocked. You have earned the lanyard.',
  },
  {
    // The spec asks for this one by name: "a consolation gift, and a very funny
    // toast". Hidden on purpose — you cannot aim for it, it can only find you.
    // The last line is not a joke, it is the real mechanic: gacha.js sets
    // guaranteedOnLoss on every rate-up banner.
    id: 'lost_a_5050', name: 'That Was The Other Fifty', icon: '🪙',
    desc: 'Lose a 50/50.',
    condition: { kind: 'lost5050', value: 1 },
    reward: { starFragments: 100 },
    hidden: true,
    toast: 'The coin has no memory. It does not know you saved for six weeks, it will not apologise, and there is no manager to speak to. Here is 100💎 and a hug. The next ★6 is hers — guaranteed, in writing.',
  },
  {
    id: 'runs_100', name: 'The Lights Stay On', icon: '🌃',
    desc: 'Finish 100 runs.',
    condition: { kind: 'totalRuns', value: 100 },
    reward: { starFragments: 50 },
    hidden: true,
    toast: 'One hundred runs. Nobody at the studio bothers switching the lights off any more. They just leave them on for you.',
  },
  {
    id: 'pulls_500', name: 'Free-to-Play, Technically', icon: '🎫',
    desc: 'Make 500 pulls.',
    condition: { kind: 'pullsTotal', value: 500 },
    reward: { starFragments: 100 },
    hidden: true,
    toast: 'Five hundred pulls. Zero money. One increasingly concerned gacha machine.',
  },
  {
    id: 'win_with_mochi', name: "Nobody's Backup Dancer", icon: '🍡',
    desc: 'Win a run with Mochi.',
    condition: { kind: 'characterWins', value: 1, target: 'mochi' },
    reward: { starFragments: 75 },
    hidden: true,
    toast: 'A ★3 rice ball with an infinite stomach walked in and closed the show. Frame it. Show it to people who did not ask.',
  },
];

// Boot-time index. Not logic — an O(1) lookup so the watcher never scans the
// array on every event. Same pattern as UPGRADES_BY_ID in upgrades.js.
export const ACHIEVEMENTS_BY_ID = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);
