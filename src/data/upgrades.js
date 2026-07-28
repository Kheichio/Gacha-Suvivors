// GENERIC LEVEL-UP UPGRADES, IN-RUN PICKUPS, XP GEMS AND CHEST TABLES.
// Pure data. No functions, no logic (the two `Object.fromEntries` lookups at the
// bottom are boot-time index builds, not runtime behaviour).
//
// SPEC: SECTION 10 (prompt lines 1387-1473). Every number here is verbatim from
// lines 1408-1450 unless a DECISIONS.md ruling is cited inline.
//
// TOTAL UPGRADE LEVELS = 163, not 176 (DECISIONS.md §4). The three annotated
// maxLevel overrides are what make the difference:
//     22 x 8 = 176,  minus extra_shot (-4), piercing_will (-3), second_chance (-6).
//
// Evolution recipes (which max-level upgrade pairs with which relic) live in
// src/data/evolutions.js. They are NOT duplicated here — one source of truth.
//
// ---------------------------------------------------------------------------
// UPGRADE SCHEMA
//   id          canonical id, consumed by engine code. Never rename.
//   name/icon   card face.
//   maxLevel    per-upgrade, NOT a global 8.
//   tier        common | rare | epic — drives card frame colour and draw weight.
//   stat        the single stat key the engine applies this to.
//   perLevel    the amount applied per level. Signed (see quick_recovery).
//   mode        how perLevel folds into the stat:
//                 'add'  additive into a multiplier bucket:  final = base * (1 + Σ)
//                 'mult' true multiplicative:                final = base * Π(1 + v)
//                 'flat' straight onto the raw stat:         final = base + Σ
//               No generic upgrade uses 'mult'; relics do. Kept for one shared
//               stat-application path (DECISIONS.md §36 — no special-casing).
//   unit        'percent' -> the card shows perLevel * 100 and a % sign.
//               'flat'    -> the card shows perLevel as-is.
//   decimals    digits after the point on the card. Defaults to 0.
//   cap         hard ceiling on the ACCUMULATED stat, in stat units. Present only
//               where the spec states one (dodge 60%, momentum +30%).
//   desc        PLAIN ENGLISH: what this actually does to the game, in one
//               sentence, with no joke in it. This is what the level-up card
//               shows. `codex` is the joke, and it stays in the Codex — a card
//               that makes you laugh and leaves you unsure what you just took
//               is a card that failed at its only job.
//   fmt         per-level phrase.   {v} = the per-level display value.
//   totalFmt    running-total phrase. {v} = the accumulated display value.
//               Rendered as:  "<fmt> (now <totalFmt>)"
//               e.g. "+12% damage (now +36% total)"  — SECTION 10 line 1401-1402.
//               Every upgrade carries its own totalFmt so the renderer never has
//               to special-case a sign, a plural or a noun.
//   weight      draw weight in the level-up pool.
//   codex       flavour. SECTION 19 voice: warm, punchy, never mean.
// ---------------------------------------------------------------------------
// Draw weights by tier: common 100, rare 60, epic 25. second_chance is pinned to
// 12 because the spec says outright that it "appears rarely" (line 1428).

export const UPGRADES = [
  {
    id: 'sharp_edge', name: 'Sharp Edge', icon: '⚔',
    maxLevel: 8, tier: 'common',
    stat: 'damageMult', perLevel: 0.12, mode: 'add', unit: 'percent',
    fmt: '+{v}% damage', totalFmt: '+{v}% total',
    desc: 'Everything you own hits harder — every weapon, every ability, every tick of burn.',
    weight: 100,
    codex: 'Sharpened during a five-minute training montage. Worth every second.',
  },
  {
    id: 'rapid_fire', name: 'Rapid Fire', icon: '⏩',
    maxLevel: 8, tier: 'common',
    stat: 'attackSpeedMult', perLevel: 0.09, mode: 'add', unit: 'percent',
    fmt: '+{v}% attack speed', totalFmt: '+{v}% total',
    desc: 'Shortens the wait between activations on your auto-attack AND on every weapon you carry.',
    weight: 100,
    codex: 'Same swing, less waiting. Your wrists are a problem for future you.',
  },
  {
    // maxLevel 4 — the spec calls this one out inline: "only 4 levels, this one
    // is huge" (line 1410). Epic tier, epic weight.
    id: 'extra_shot', name: 'Extra Shot', icon: '🔱',
    maxLevel: 4, tier: 'epic',
    stat: 'projectileCount', perLevel: 1, mode: 'flat', unit: 'flat',
    fmt: '+{v} projectile', totalFmt: '+{v} total',
    desc: 'One more shot from anything that fires shots — your auto-attack and every projectile weapon. Melee and field weapons are unaffected.',
    weight: 25,
    codex: 'Nobody agreed to this many projectiles. Nobody can stop them either.',
  },
  {
    id: 'wide_reach', name: 'Wide Reach', icon: '💥',
    maxLevel: 8, tier: 'common',
    stat: 'areaMult', perLevel: 0.14, mode: 'add', unit: 'percent',
    fmt: '+{v}% attack size', totalFmt: '+{v}% total',
    desc: 'Every swing arc, blast radius, orbit ring and aura gets physically bigger, so each one catches more enemies.',
    weight: 100,
    codex: 'Everything you do is simply bigger now. No notes.',
  },
  {
    id: 'long_haul', name: 'Long Haul', icon: '🏹',
    maxLevel: 8, tier: 'common',
    stat: 'projectileSpeedMult', perLevel: 0.18, mode: 'add', unit: 'percent',
    fmt: '+{v}% projectile speed & range', totalFmt: '+{v}% total',
    desc: 'Shots fly faster and live longer, so they reach further before they expire. Nothing melee changes.',
    weight: 100,
    codex: 'Your attacks commute now. They arrive on time and slightly angry.',
  },
  {
    // maxLevel 5 — annotated inline at line 1413.
    id: 'piercing_will', name: 'Piercing Will', icon: '🗡',
    maxLevel: 5, tier: 'rare',
    stat: 'pierce', perLevel: 1, mode: 'flat', unit: 'flat',
    fmt: '+{v} pierce', totalFmt: '+{v} pierce total',
    desc: 'Your shots pass through one more enemy each instead of stopping at the first. Best where the crowd is deep.',
    weight: 60,
    codex: 'It goes through. Then it keeps going through. That is the whole pitch.',
  },
  {
    id: 'keen_eye', name: 'Keen Eye', icon: '👁',
    maxLevel: 8, tier: 'common',
    stat: 'critChance', perLevel: 0.05, mode: 'flat', unit: 'percent',
    fmt: '+{v}% crit chance', totalFmt: '+{v}% total',
    desc: 'How often a hit crits. A crit deals your crit damage instead of normal damage and shows a bigger number.',
    weight: 100,
    codex: 'You have started noticing where things are weakest. Rude, honestly.',
  },
  {
    id: 'killing_blow', name: 'Killing Blow', icon: '💢',
    maxLevel: 8, tier: 'rare',
    stat: 'critMult', perLevel: 0.25, mode: 'flat', unit: 'percent',
    fmt: '+{v}% crit damage', totalFmt: '+{v}% total',
    desc: 'How hard a crit lands. Worthless on its own — pair it with crit chance.',
    weight: 60,
    codex: 'The crit was already lethal. This part is purely for the camera.',
  },
  {
    id: 'swift_boots', name: 'Swift Boots', icon: '👟',
    maxLevel: 8, tier: 'common',
    stat: 'moveSpeedMult', perLevel: 0.08, mode: 'add', unit: 'percent',
    fmt: '+{v}% move speed', totalFmt: '+{v}% total',
    desc: 'You walk faster. In a game where not being touched is the whole defence, this is a defensive stat.',
    weight: 100,
    codex: 'Broken in by roughly nine thousand consecutive tutorial laps.',
  },
  {
    id: 'iron_body', name: 'Iron Body', icon: '💪',
    maxLevel: 8, tier: 'common',
    stat: 'maxHp', perLevel: 18, mode: 'flat', unit: 'flat',
    fmt: '+{v} max HP', totalFmt: '+{v} max HP total',
    desc: 'Raises your maximum HP and HEALS you by the amount gained, right now.',
    weight: 100,
    codex: 'Eighteen more HP. Eighteen more chances to say "I meant to do that".',
  },
  {
    id: 'second_wind', name: 'Second Wind', icon: '🌿',
    maxLevel: 8, tier: 'common',
    stat: 'regen', perLevel: 0.4, mode: 'flat', unit: 'flat', decimals: 1,
    fmt: '+{v} HP/s regeneration', totalFmt: '+{v} HP/s total',
    desc: 'You heal continuously, in and out of combat. Small per second, enormous over fifteen minutes.',
    weight: 100,
    codex: 'The training arc pays out slowly, but it never once stops paying.',
  },
  {
    id: 'guardian_plate', name: 'Guardian Plate', icon: '🛡',
    maxLevel: 8, tier: 'rare',
    stat: 'armor', perLevel: 1, mode: 'flat', unit: 'flat',
    fmt: '+{v} armor', totalFmt: '+{v} armor total',
    desc: 'Subtracts a flat amount from every hit you take. Strongest against swarms of small hits, weakest against one big one.',
    weight: 60,
    codex: 'One point of armor. Flat, unglamorous, and quietly undefeated.',
  },
  {
    // 0.22 -> 0.60 per level.
    //
    // The old number was a fifth of a base radius of ~48px — about TEN PIXELS
    // per level, on a screen showing 1280 world px. Nobody could see it, so an
    // upgrade whose entire job is a spatial effect read as doing nothing at all.
    // At 0.60 a maxed Lodestone takes the radius from ~48px to ~278px, which is
    // a fifth of the screen: gems visibly leap at you, and the ring the HUD
    // draws around the player grows every single time you take it.
    id: 'lodestone', name: 'Lodestone', icon: '🧲',
    maxLevel: 8, tier: 'common',
    stat: 'pickupRadiusMult', perLevel: 0.60, mode: 'add', unit: 'percent',
    fmt: '+{v}% pickup radius', totalFmt: '+{v}% total',
    desc: 'Widens the ring around you that yanks XP gems and gold in. The ring is drawn on the ground — watch it grow.',
    weight: 100,
    codex: 'Loot comes to you now. This is the correct relationship with loot.',
  },
  {
    id: 'scholar', name: 'Scholar', icon: '📖',
    maxLevel: 8, tier: 'common',
    stat: 'xpMult', perLevel: 0.12, mode: 'add', unit: 'percent',
    fmt: '+{v}% XP gain', totalFmt: '+{v}% total',
    desc: 'Every gem is worth more, so you level up sooner and get more choices than you otherwise would.',
    weight: 100,
    codex: 'Reads enemy weaknesses aloud mid-fight. To nobody. Constantly.',
  },
  {
    id: 'cursed_coin', name: 'Cursed Coin', icon: '🪙',
    maxLevel: 8, tier: 'common',
    stat: 'goldMult', perLevel: 0.20, mode: 'add', unit: 'percent',
    fmt: '+{v}% gold gain', totalFmt: '+{v}% total',
    desc: 'More gold from this run, which you spend at the Shrine between runs. Does nothing for the run itself.',
    weight: 100,
    codex: 'The coin is not actually cursed. Legal made us say that.',
  },
  {
    id: 'four_leaf', name: 'Four-Leaf', icon: '🍀',
    maxLevel: 8, tier: 'rare',
    // luck feeds chest quality (CHEST_TABLE) and rare drop rates.
    stat: 'luck', perLevel: 1, mode: 'flat', unit: 'flat',
    fmt: '+{v} luck', totalFmt: '+{v} luck total',
    desc: 'Better chest contents, better relic rolls, and slightly better odds on every drop the game rolls for.',
    weight: 60,
    codex: 'Statistically modest. Emotionally load-bearing.',
  },
  {
    // perLevel is NEGATIVE and the fmt strings carry no leading '+', so the value
    // prints its own sign: "-8% all cooldowns (now -24% total)".
    id: 'quick_recovery', name: 'Quick Recovery', icon: '⏱',
    maxLevel: 8, tier: 'rare',
    stat: 'cooldownMult', perLevel: -0.08, mode: 'add', unit: 'percent',
    fmt: '{v}% all cooldowns', totalFmt: '{v}% total',
    desc: 'Your SPECIAL and your ESCAPE come back sooner. Does not speed up weapons — that is Rapid Fire.',
    weight: 60,
    codex: 'The cooldown bar has been downgraded to more of a cooldown suggestion.',
  },
  {
    id: 'phantom_step', name: 'Phantom Step', icon: '👻',
    maxLevel: 8, tier: 'rare',
    stat: 'dodge', perLevel: 0.05, mode: 'flat', unit: 'percent',
    cap: 0.60,          // spec line 1425: "cap 60%" — other sources stack into it
    fmt: '+{v}% dodge chance', totalFmt: '+{v}% total, cap 60%',
    desc: 'A chance for an incoming hit to deal nothing at all. Hard-capped at 60% however many sources you stack.',
    weight: 60,
    codex: 'Technically you were never there. Several enemies quietly disagree.',
  },
  {
    id: 'bloodthirst', name: 'Bloodthirst', icon: '🩸',
    maxLevel: 8, tier: 'rare',
    stat: 'lifesteal', perLevel: 0.015, mode: 'flat', unit: 'percent', decimals: 1,
    fmt: '+{v}% lifesteal', totalFmt: '+{v}% total',
    desc: 'You heal for a slice of all damage you deal. Scales with how much you are killing, not with how big your hits are.',
    weight: 60,
    codex: 'Healthcare, but you have to hit something first.',
  },
  {
    id: 'vengeance', name: 'Vengeance', icon: '🪞',
    maxLevel: 8, tier: 'rare',
    stat: 'thorns', perLevel: 0.12, mode: 'flat', unit: 'percent',
    fmt: 'reflect {v}% of contact damage', totalFmt: 'reflecting {v}% total',
    desc: 'Anything that touches you takes a share of the damage it dealt. Only contact damage — not ranged shots or hazards.',
    weight: 60,
    codex: 'You never hit back. You just stood there being extremely pointy.',
  },
  {
    // maxLevel 2 and weight 12 — both stated inline at line 1428 ("max 2 levels,
    // appears rarely"). Revives are hard-capped at 3 per run across ALL sources
    // and resolve in a fixed order — DECISIONS.md §29.
    id: 'second_chance', name: 'Second Chance', icon: '💫',
    maxLevel: 2, tier: 'epic',
    stat: 'revives', perLevel: 1, mode: 'flat', unit: 'flat',
    fmt: '+{v} revive at 50% HP', totalFmt: '+{v} revives total',
    desc: 'When you would die, you stand back up at half HP with two seconds of invulnerability instead. Three revives per run, from all sources combined.',
    weight: 12,
    codex: 'The screen goes white, the music swells, and you get up. Twice, max.',
  },
  {
    id: 'momentum', name: 'Momentum', icon: '🌀',
    maxLevel: 8, tier: 'rare',
    // +3% damage per second of continuous movement, per level. The accumulated
    // in-combat bonus is capped at +30% (line 1429) — the cap is on the running
    // bonus, not on the upgrade's own 8 levels.
    stat: 'momentumBonus', perLevel: 0.03, mode: 'flat', unit: 'percent',
    cap: 0.30,
    fmt: '+{v}% damage per second moving', totalFmt: '+{v}% per second, cap +30%',
    desc: 'Damage builds while you keep moving and resets the moment you stop. Caps at +30% and rewards kiting.',
    weight: 60,
    codex: 'Keep running. The anime only looks good when you are already moving.',
  },
];

/** DECISIONS.md §4. Asserted in tests/data.test.js against the sum of maxLevel. */
export const TOTAL_UPGRADE_LEVELS = 163;

// ---------------------------------------------------------------------------
// IN-RUN MAP PICKUPS — spawned by the world, not offered on level-up.
// SECTION 10 lines 1431-1444.
//
//   effect     the handler key the pickup system dispatches on.
//   value      the effect's magnitude. Where `valueMax` is also present the
//              engine rolls uniformly in [value, valueMax] (coin_pile only).
//   duration   seconds, for the two timed buffs.
//   weight     draw weight in the world-object spawn roll. weight 0 = never
//              rolled; placed or awarded by another system.
// ---------------------------------------------------------------------------

export const PICKUPS = [
  {
    id: 'heart', name: 'Heart', emoji: '❤', effect: 'healPercent', value: 0.20,
    weight: 22, desc: 'Heals 20% of your max HP.',
    visual: { shape: 'circle', color: '#ff5f7e', accent: '#ffd0d8', size: 11, emoji: '❤' },
  },
  {
    id: 'magnet', name: 'Magnet', emoji: '🧲', effect: 'magnetAll', value: 1,
    weight: 14, desc: 'Pulls every XP gem on the map straight to you.',
    visual: { shape: 'circle', color: '#5fa8ff', accent: '#e8f4ff', size: 11, emoji: '🧲' },
  },
  {
    id: 'bomb', name: 'Bomb', emoji: '💣', effect: 'nukeScreen', value: 1,
    weight: 8, desc: 'Kills every non-elite enemy on screen. They still drop their XP.',
    visual: { shape: 'circle', color: '#4a4f5e', accent: '#ff9a4d', size: 12, emoji: '💣' },
  },
  {
    id: 'coin_pile', name: 'Coin Pile', emoji: '💰', effect: 'gold', value: 15, valueMax: 60,
    weight: 20, desc: '15–60 gold.',
    visual: { shape: 'circle', color: '#ffcf4d', accent: '#fff3c4', size: 11, emoji: '💰' },
  },
  {
    id: 'bento_box', name: 'Bento Box', emoji: '🍱', effect: 'buffDamage', value: 0.10,
    duration: 60, stacks: true,
    weight: 12, desc: '+10% damage for 60s. Stacks, and the timer is shown.',
    visual: { shape: 'square', color: '#ff9f4d', accent: '#ffe3c4', size: 11, emoji: '🍱' },
  },
  {
    id: 'hourglass', name: 'Hourglass', emoji: '⏳', effect: 'slowEnemies', value: 0.50,
    duration: 8,
    weight: 9, desc: 'Slows every enemy 50% for 8s.',
    visual: { shape: 'diamond', color: '#c9a6ff', accent: '#f0e6ff', size: 11, emoji: '⏳' },
  },
  {
    id: 'chest', name: 'Chest', emoji: '📦', effect: 'chest', value: 1, chestType: 'normal',
    weight: 5, desc: '1, 3 or 5 upgrades. Slot machine included.',
    visual: { shape: 'square', color: '#b07a45', accent: '#ffd166', size: 13, emoji: '📦' },
  },
  {
    // Silver Chests are the mid-boss and named-elite payout. bosses.js awards
    // `chest: 'silver'` on all 7 mid-bosses, 6 named elites and every boss's
    // `asElite` block — 18 references that had no payout row until now. Never
    // rolls from the world table, exactly like the Gold Chest.
    id: 'silver_chest', name: 'Silver Chest', emoji: '📦', effect: 'chest', value: 1, chestType: 'silver',
    weight: 0, desc: '1, 3 or 5 upgrades, weighted well above a floor chest.',
    visual: { shape: 'square', color: '#c8cdd6', accent: '#eef2f7', size: 13, emoji: '📦' },
  },
  {
    // Gold Chests are boss / treasure-carrier only (line 1449), so they never
    // roll from the world table — weight 0.
    id: 'gold_chest', name: 'Gold Chest', emoji: '📦', effect: 'chest', value: 1, chestType: 'gold',
    weight: 0, desc: '3–5 upgrades, or a 25% chance of a relic instead.',
    visual: { shape: 'square', color: '#ffd166', accent: '#fff3c4', size: 14, emoji: '📦', glow: true },
  },
  {
    // One per stage, random location, placed by the stage loader — never rolled.
    // Costs live in SHRINE_ALTAR below so the UI and the handler read one number.
    id: 'shrine', name: 'Shrine', emoji: '⛩', effect: 'shrine', value: 0, perStage: 1,
    weight: 0,
    desc: 'Offer 25% of your current HP for a random relic, or 200 gold for a guaranteed upgrade.',
    visual: { shape: 'triangle', color: '#e2453f', accent: '#ffe08a', size: 20, emoji: '⛩' },
  },
  {
    // A fleeing enemy rather than a ground pickup, but it is authored here
    // because it is a world-spawned reward object with a spawn weight.
    id: 'treasure_carrier', name: 'Treasure Carrier', emoji: '🎁', effect: 'treasureCarrier',
    value: 1, hp: 500, despawnAfter: 20, dropChest: 'gold',
    weight: 2, desc: '500 HP, runs away, gone in 20s. Kill it for a Gold Chest.',
    visual: { shape: 'capsule', color: '#ffd166', accent: '#ff6fa5', size: 14, emoji: '🎁' },
  },
];

// XP gems. Values are verbatim from line 1391. Size scales with value so a gold
// gem reads as "go get that" from across the arena.
export const XP_GEMS = [
  { id: 'gem_blue',  value: 1,   visual: { shape: 'diamond', color: '#5fd0ff', size: 5 } },
  { id: 'gem_green', value: 5,   visual: { shape: 'diamond', color: '#6bff9e', size: 6 } },
  { id: 'gem_red',   value: 25,  visual: { shape: 'diamond', color: '#ff5f6e', size: 7 } },
  { id: 'gem_gold',  value: 100, visual: { shape: 'diamond', color: '#ffd24a', accent: '#fff3c4', size: 9, glow: true } },
];

// Chest payout tables, lines 1446-1450. Chances are the base roll; luck (the
// Four-Leaf stat) shifts weight toward the richer rows.
//
// `silver` is not in the spec's two-tier list — it is required by bosses.js,
// which awards `chest: 'silver'` on every mid-boss, every named elite and every
// boss's `asElite` block (18 references) and would otherwise resolve to nothing.
// Priced strictly between the other two so the ladder reads
// floor chest < mid-boss/elite < boss, and it carries no relic chance: the relic
// stays a full-boss reward (bosses.js header) so a mid-boss never trivialises it.
export const CHEST_TABLE = {
  normal: [
    { upgrades: 1, chance: 0.65 },
    { upgrades: 3, chance: 0.30 },
    { upgrades: 5, chance: 0.05 },
  ],
  silver: [
    { upgrades: 1, chance: 0.25 },
    { upgrades: 3, chance: 0.60 },
    { upgrades: 5, chance: 0.15 },
  ],
  gold: [
    { upgrades: 3, chance: 0.55 },
    { upgrades: 5, chance: 0.45 },
  ],
  /** A Gold Chest rolls this first; on a hit it awards a relic instead of stats. */
  goldRelicChance: 0.25,
};

/** xpNeeded(level) = ceil(base * level^exponent). Line 1394. */
export const XP_CURVE = { base: 9, exponent: 1.32 };

// Level-up presentation. `banishes` starts at 0: the spec lists BANISH as a
// feature (line 1404) but grants none at run start — Shrine upgrades award them,
// exactly as they award extra rerolls. A character passive may raise `choices`
// to 4 from its own data object (DECISIONS.md §36 — no per-character branches).
/**
 * BUILD SLOTS — how many DISTINCT upgrades you may hold in one run.
 *
 * Without a cap the level-up screen is not a decision: take everything, in any
 * order, and every run converges on the same maxed-out list. The cap is what
 * turns "which upgrade" into "which BUILD", and it is why the genre's runs
 * differ from each other at all.
 *
 * Once you are full, the pool only offers upgrades you ALREADY hold (so you can
 * still level them) plus any evolution you have qualified for — you can always
 * keep improving, you just cannot keep widening.
 *
 * OFFENSIVE and UTILITY are counted separately so a damage build cannot crowd
 * out every defensive option and leave the player with no way to survive.
 */
export const BUILD_SLOTS = {
  offensive: 6,
  utility: 6,
  /** Which bucket each upgrade counts against. */
  bucketOf(upgrade) {
    return OFFENSIVE_STATS.indexOf(upgrade.stat) >= 0 ? 'offensive' : 'utility';
  },
};

const OFFENSIVE_STATS = [
  'damageMult', 'attackSpeedMult', 'projectileCount', 'areaMult',
  'projectileSpeedMult', 'pierce', 'critChance', 'critMult', 'momentumBonus',
];

export const LEVELUP = { choices: 3, freeRerolls: 1, banishes: 0, skipGold: 30 };

/** The ⛩ interactable's two offers. Lines 1439-1441. */
export const SHRINE_ALTAR = {
  hpCostPercent: 0.25,   // of CURRENT hp, not max — the risk is the point
  goldCost: 200,
};

// Boot-time indexes. Not logic — just O(1) lookup instead of a linear scan in
// the level-up path.
export const UPGRADES_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
export const PICKUPS_BY_ID = Object.fromEntries(PICKUPS.map((p) => [p.id, p]));
