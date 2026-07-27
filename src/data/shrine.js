// THE SHRINE — 10 permanent meta upgrades bought with GOLD, plus bond levels and
// the SECTION 5 currency award table.
//
// SPEC: SECTION 12 (prompt lines 1573-1597). Every level count and every stated
// per-level value is verbatim from lines 1574-1585. SECTION 5's award numbers are
// verbatim from DECISIONS.md §1's resolved table.
//
// PURE DATA. The shrine screen and the run-setup stat pipeline read this file;
// nothing here knows how either works. No ref strings live here (DECISIONS.md §22).
//
// ---------------------------------------------------------------------------
// UPGRADE SCHEMA
//   id/name/icon  card face. Ids are consumed by save.shrine (`id -> level`).
//   maxLevel      levels purchasable. Verbatim from the spec.
//   stat          the single stat key the engine applies this to. Deliberately
//                 reuses the keys already live in the stat pipeline (upgrades.js
//                 and the MODIFIERS params in stages.js) rather than inventing
//                 synonyms — `goldMult` is the same bucket Cursed Coin feeds.
//   perLevel      amount applied per level.
//   mode          'add'  additive into a multiplier bucket: final = base * (1 + Σ)
//                 'flat' straight onto the raw stat:        final = base + Σ
//                 Same two modes as upgrades.js, same shared application path
//                 (DECISIONS.md §36 — no per-upgrade branching anywhere).
//   effects       ONLY on an upgrade that moves two stats at once. Exactly one
//                 does: Curse. When `effects` is present the engine applies every
//                 entry and ignores stat/perLevel/mode, which are then absent.
//   baseCost      gold for level 1.
//   costGrowth    geometric growth. Cost of level n (1-indexed) is
//                 round(baseCost * costGrowth^(n-1)).
//   desc          what it does, in real numbers.
//   fmt           running-total phrase for the card. {v} = accumulated display
//                 value, i.e. perLevel * level, percentages already × 100.
//                 {v2} is the second entry of `effects`, and only Curse uses it.
//   warning       optional second line on the card, rendered in the caution
//                 colour. Only Curse carries one, and it is not decoration —
//                 SECTION 12 orders that row labelled honestly.
//   lockedBy      optional save.unlocks flag that must be true to buy this at all.
//                 Curse alone carries one (DECISIONS.md §24).
//
// COSTS. Might's curve is the spec's, verbatim: 100 * 1.55^n, ~14,370 gold for all
// ten levels. Everything else is priced against that anchor and against SECTION
// 14's "a full 20-minute run awards 250-450 gold":
//   - Vitality matches Might exactly. They are the two core 10-level rows and one
//     being cheaper would just tell players which to buy first.
//   - Fortune and Insight are the cheapest per level because they compound into
//     everything else; making them expensive taxes the player twice.
//   - Rerolls and Banish double each level — 3 levels, 2,800 gold, and the last
//     one should sting.
//   - Revival is the spec's stated "expensive": 2,500 then 6,000.
//   - Curse is cheap on purpose. It is a handicap you are choosing.
// Everything, every row, every level: ~65,700 gold. With Fortune, Cursed Coin and
// Deep Pressure stacking that is a long meta arc, not a wall — and the refund is
// free, so no purchase is ever a mistake you are stuck with.
// ---------------------------------------------------------------------------

export const SHRINE_UPGRADES = [
  {
    id: 'might', name: 'Might', icon: '⚔', maxLevel: 10,
    stat: 'damageMult', perLevel: 0.02, mode: 'add',
    baseCost: 100, costGrowth: 1.55,
    desc: '+2% damage per level.',
    fmt: '+{v}% damage',
  },
  {
    // `maxHpMult` is the multiplicative sibling of the flat `maxHp` Iron Body
    // feeds. A percentage has to scale with the character, or +3% of Mochi's 100
    // and +3% of a 6-star's pool would be the same upgrade wearing two hats.
    id: 'vitality', name: 'Vitality', icon: '❤', maxLevel: 10,
    stat: 'maxHpMult', perLevel: 0.03, mode: 'add',
    baseCost: 100, costGrowth: 1.55,
    desc: '+3% max HP per level.',
    fmt: '+{v}% max HP',
  },
  {
    id: 'alacrity', name: 'Alacrity', icon: '👟', maxLevel: 5,
    stat: 'moveSpeedMult', perLevel: 0.02, mode: 'add',
    baseCost: 150, costGrowth: 1.60,
    desc: '+2% move speed per level.',
    fmt: '+{v}% move speed',
  },
  {
    id: 'fortune', name: 'Fortune', icon: '🪙', maxLevel: 8,
    stat: 'goldMult', perLevel: 0.03, mode: 'add',
    baseCost: 120, costGrowth: 1.50,
    desc: '+3% gold gain per level.',
    fmt: '+{v}% gold',
  },
  {
    id: 'insight', name: 'Insight', icon: '📖', maxLevel: 8,
    stat: 'xpMult', perLevel: 0.02, mode: 'add',
    baseCost: 120, costGrowth: 1.50,
    desc: '+2% XP gain per level.',
    fmt: '+{v}% XP',
  },
  {
    // `freeRerolls` is the same key LEVELUP starts at 1 in upgrades.js.
    id: 'rerolls', name: 'Rerolls', icon: '🔄', maxLevel: 3,
    stat: 'freeRerolls', perLevel: 1, mode: 'flat',
    baseCost: 400, costGrowth: 2.00,
    desc: '+1 level-up reroll per level.',
    fmt: '+{v} rerolls',
  },
  {
    // LEVELUP.banishes starts at 0 — the spec lists Banish as a feature but
    // grants none at run start, so this row is the only source of the first one.
    id: 'banish', name: 'Banish', icon: '🚫', maxLevel: 3,
    stat: 'banishes', perLevel: 1, mode: 'flat',
    baseCost: 400, costGrowth: 2.00,
    desc: '+1 level-up banish per level. Removes an upgrade from the pool for the whole run.',
    fmt: '+{v} banishes',
  },
  {
    // `revives` is Second Chance's key. Revives are hard-capped at 3 per run
    // across ALL sources and resolve in a fixed order (DECISIONS.md §29), so
    // buying both levels here does not make you immortal — it makes you punctual.
    id: 'revival', name: 'Revival', icon: '💫', maxLevel: 2,
    stat: 'revives', perLevel: 1, mode: 'flat',
    baseCost: 2500, costGrowth: 2.40,
    desc: '+1 starting revive per level. Max 3 revives per run from all sources.',
    fmt: '+{v} starting revives',
  },
  {
    id: 'greed', name: 'Greed', icon: '🍀', maxLevel: 5,
    stat: 'luck', perLevel: 1, mode: 'flat',
    baseCost: 250, costGrowth: 1.70,
    desc: '+1 starting luck per level. Luck raises chest quality and rare drop rates.',
    fmt: '+{v} starting luck',
  },
  {
    // The spec's instruction on this row is a design brief, not flavour: "the
    // best value upgrade for good players and a trap for bad ones. Label it
    // honestly." So the desc states BOTH halves in plain numbers, in that order —
    // the cost first, the payoff second — and `warning` puts the trap on the card
    // where the player cannot miss it. The refund below is free for exactly this.
    //
    // Two stats, so this is the one row that uses `effects`. Keys are the ones
    // already consumed by the stat pipeline via MODIFIERS/DIFFICULTY_TIERS params.
    //
    // DECISIONS.md §24: `lockedBy` is a REAL gate. save.unlocks.curse starts false
    // and is only flipped by the `kill_10000_enemies` achievement. Until then this
    // row renders locked with the achievement named on it.
    id: 'curse', name: 'Curse', icon: '🩸', maxLevel: 5,
    effects: [
      { stat: 'countMult', perLevel: 0.10, mode: 'add' },
      { stat: 'rewardMult', perLevel: 0.08, mode: 'add' },
    ],
    baseCost: 300, costGrowth: 1.50,
    desc: '+10% enemy count AND +8% all rewards per level. At level 5 that is half again as many enemies for +40% gold, XP and Star Fragments.',
    fmt: '+{v}% enemies, +{v2}% rewards',
    warning: 'This makes the game harder. That is the entire point — it pays you for the risk. If you are dying already, refund it. The refund is free.',
    lockedBy: 'curse',
  },
];

/**
 * ALWAYS a full refund button, always free (SECTION 12 line 1586: "Let players
 * experiment"). Every level ever bought returns 100% of its gold, so the Shrine
 * is a sandbox rather than a commitment — which is the only reason Curse can be
 * an honest offer instead of a trap.
 */
export const SHRINE_REFUND_FREE = true;

// ---------------------------------------------------------------------------
// BOND LEVELS — SECTION 12 line 1596. Playing a character raises their bond.
// The `reward.kind` selects the handler; `stat`/`value` parameterise it, so a new
// bond tier is a data addition. Bond is per character, stored in
// save.roster[id].bond.
// ---------------------------------------------------------------------------

export const BOND_LEVELS = [
  {
    level: 5, reward: { kind: 'stat', stat: 'maxHp', value: 0.05 },
    desc: '+5% max HP with this character.',
  },
  {
    level: 10, reward: { kind: 'barks' },
    desc: 'A new bark set.',
  },
  {
    level: 15, reward: { kind: 'costume' },
    desc: 'A costume tint.',
  },
];

/** +1 bond for finishing a run with them. Win or lose — losing is still playing. */
export const BOND_PER_RUN = 1;

/** +1 more per boss killed in that run, mid-bosses included. */
export const BOND_PER_BOSS = 1;

// ---------------------------------------------------------------------------
// SECTION 5 — STAR FRAGMENT AWARD TABLE, as resolved by DECISIONS.md §1.
//
// These numbers are LOAD-BEARING and were not touched: they appear in SECTION 14's
// balance targets and on the results screen. The 20-60x economy error was in the
// pull PRICE, which §1 moved to 15 / 135 in gacha.js. A completed 20-minute run
// with both bosses pays 8 + 10 + 20 = 38💎; 3-4 runs is ~114-152💎, which is the
// spec's "one 10-pull per 3-4 completed runs" target hit on the nose.
//
// Note runFailed: dying still pays 4💎. SECTION 12: "Make losing feel like
// progress, because it is."
// ---------------------------------------------------------------------------

export const FRAGMENT_AWARDS = {
  runCompleted: 8,
  runFailed: 4,
  midBoss: 10,
  finalBoss: 20,
  firstClear: 50,
  dailyFirstWin: 30,
};

// Boot-time index. Not logic — an O(1) lookup instead of a linear scan every time
// the shrine screen prices a row. Same pattern as UPGRADES_BY_ID in upgrades.js.
export const SHRINE_UPGRADES_BY_ID = Object.fromEntries(
  SHRINE_UPGRADES.map((u) => [u.id, u]),
);
