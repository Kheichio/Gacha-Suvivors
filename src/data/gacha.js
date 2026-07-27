// GACHA — banners, rates, pity, duplicates, pull presentation.
//
// This file is the single source of truth for every number the pull screen
// shows. Five DECISIONS.md rulings land here and each one is marked at the
// point it applies:
//   §1 pull cost (15 / 135, not 160 / 1600)
//   §2 soft pity is derived so it reaches certainty EXACTLY at hard pity
//   §3 FIX B rates (35/48/16/1) + the retuned pity thresholds, and FIX C
//   §8 banners with no ★6 normalise weights instead of carrying a second table
//   §9 relics always drop in-run; this banner buys weight, not access
//
// Exception to the "plain data only" rule: `rate5Plus` and `rate6` are the ONLY
// functions in this file, and they exist so the pity curve can never be typed in
// by hand. tests/pity.test.js asserts against them directly.

// -----------------------------------------------------------------------------
// RATES
// -----------------------------------------------------------------------------

/**
 * DECISIONS.md §3 — FIX B. The roster ships only two ★3 characters, so the
 * spec's 60/32/7.2/0.8 curve returns Mochi or Alto for 3 pulls in 5. FIX A
 * (invent two more ★3s) was rejected because it means authoring two characters,
 * and therefore two source-material homages the owner never approved, under a
 * roster he curated deliberately. These are the rates the pool can support.
 */
export const BASE_RATES = { 3: 0.35, 4: 0.48, 5: 0.16, 6: 0.01 };

/** Combined ★5-or-better floor. Every pity formula ramps up from here. */
export const BASE_RATE_5_PLUS = BASE_RATES[5] + BASE_RATES[6];

// -----------------------------------------------------------------------------
// PITY (DECISIONS.md §2 + §3)
// -----------------------------------------------------------------------------

/**
 * The spec's "+6%/pull from pull 51 always resolves by ~62" is arithmetically
 * false: it reaches 100% at 67 and leaves a three-pull dead zone before hard
 * pity at 70, where the ramp does nothing and the guarantee does everything.
 *
 * Thresholds retuned against the FIX B curve (§3). ★6 pity applies to rate-up
 * banners only — no other banner contains a ★6.
 */
export const PITY = {
  soft5: 25,
  hard5: 40,
  soft6: 55,
  hard6: 70,
};

/**
 * k is DERIVED, never a magic number. Re-tuning BASE_RATES or PITY moves the
 * ramp with it, so the curve can never desynchronise from the guarantee.
 *
 * The denominator is (hard - soft + 1) because the soft-pity pull ITSELF gets
 * the first increment — matching the spec's "starting at pull 51 without a ★5
 * or higher, the rate increases by +6% per pull". That puts exactly 16
 * increments on the hard-pity pull, where the sum is base + (1 - base) = 1.0.
 *
 * Current values: 5.1875%/pull and 6.1875%/pull — both ramps are 16 pulls wide,
 * and both sit within spitting distance of the spec's intended 6% feel.
 */
export const softPityStep5 = (1 - (BASE_RATES[5] + BASE_RATES[6])) / (PITY.hard5 - PITY.soft5 + 1);
export const softPityStep6 = (1 - BASE_RATES[6]) / (PITY.hard6 - PITY.soft6 + 1);

/**
 * Combined ★5-or-better chance for this pull.
 * @param {number} pullsSince 1-based index of this pull within the current dry
 *   streak (increment the counter, THEN roll). 1 = first pull since the last ★5+.
 * @returns {number} 0..1, exactly 1.0 at PITY.hard5.
 */
export function rate5Plus(pullsSince) {
  const n = Math.max(0, Math.floor(pullsSince));
  // Pinned rather than computed: the derivation already lands on 1.0 here, but
  // float error must never be the reason a guarantee doesn't fire.
  if (n >= PITY.hard5) return 1;
  if (n < PITY.soft5) return BASE_RATES[5] + BASE_RATES[6];
  return Math.min(1, (BASE_RATES[5] + BASE_RATES[6]) + (n - PITY.soft5 + 1) * softPityStep5);
}

/**
 * ★6 chance for this pull. Rate-up banners only; every other banner normalises
 * this weight away (§8).
 * @param {number} pullsSince 1-based index within the current ★6 dry streak.
 * @returns {number} 0..1, exactly 1.0 at PITY.hard6.
 */
export function rate6(pullsSince) {
  const n = Math.max(0, Math.floor(pullsSince));
  if (n >= PITY.hard6) return 1;
  if (n < PITY.soft6) return BASE_RATES[6];
  return Math.min(1, BASE_RATES[6] + (n - PITY.soft6 + 1) * softPityStep6);
}

/**
 * Which banner types share one ★5 counter (SECTION 6: "stored PER BANNER TYPE,
 * except the 5★ counter which is shared between Standard and Rate-Up").
 * A banner whose `pity5Key` is 'shared' reads/writes save.gacha.sharedPity5;
 * anything else keys into save.gacha.pity[bannerId].
 */
export const PITY_SHARED_5_TYPES = ['standard', 'rateup'];

// -----------------------------------------------------------------------------
// COSTS (DECISIONS.md §1)
// -----------------------------------------------------------------------------

/**
 * The spec's 160 / 1600 against 8–25💎 per run missed the stated "one 10-pull
 * per 3–4 runs" target by 20–60x. The ruling: the reward numbers are
 * load-bearing (they appear on the results screen and in the balance targets),
 * the price is a pure pacing dial. A completed run pays 38; 3–4 runs ≈ 114–152.
 * The ten-pull carries the genre-standard 10% bulk discount.
 */
export const COST = { single: 15, ten: 135, currency: 'starFragments' };

/** Pull Tickets are whole pulls, not a currency you convert. */
export const TICKET_COST = { single: 1, ten: 10, currency: 'tickets' };

/**
 * SECTION 5's "Gold Tickets — a slow, F2P-friendly pull path". The spec names
 * the path and never prices it. At 250–450 gold per run this is one extra pull
 * per ~3 runs, which is slower than the fragment path by design.
 */
export const GOLD_TICKET = { cost: 1000, currency: 'gold', grants: 1 };

/**
 * SECTION 5 says Universal Fan Letters come "from milestone pity" and never
 * says at what interval. Every 50 pulls on any banner pays 25 universal
 * letters — worth 12 character-specific letters at UNIVERSAL_RATIO, i.e. a
 * little over half an S1->S2 (20) per 50 pulls.
 */
export const MILESTONE_LETTERS = { everyPulls: 50, universalLetters: 25 };

// -----------------------------------------------------------------------------
// POOLS
// -----------------------------------------------------------------------------
// Declared once and shared across banners — a character added to the roster
// must not need editing in four places.

const POOL_3 = ['mochi', 'alto'];
const POOL_4 = ['hoshino_rei', 'yamikage', 'uzu', 'captain_yuli', 'kagura', 'unit_09'];
const POOL_5 = ['rin', 'niten', 'shiro_same', 'reika', 'nekromina', 'hikari', 'akane', 'kira'];

/**
 * The full ★6 roster, shared by both rate-up banners.
 *
 * It has to be the FULL roster, not just the featured one, for three reasons —
 * each of which was a live bug when the two rate-ups carried a single-entry pool:
 *
 *   1. Han appeared in no banner pool anywhere and was literally unobtainable,
 *      despite his own special text ("if you also own Sora...") assuming he is not.
 *   2. `rateUpChance: 0.5` was decorative. Losing the coin flip draws from the
 *      non-featured ★6s, and that set was empty — so you could not lose.
 *   3. `guaranteedOnLoss` and the `lost_a_5050` achievement both hang off a loss
 *      that could never happen.
 *
 * `featured6` still does the rate-up work: half of all ★6s are the featured one,
 * the other half roll this list. Which is what the banner copy already promised.
 */
const POOL_6 = ['sovereign_alicia', 'sora', 'han'];

// -----------------------------------------------------------------------------
// BANNERS
// -----------------------------------------------------------------------------

export const BANNERS = [
  {
    id: 'banner_standard',
    name: 'Debut Stage',
    type: 'standard',
    desc: 'Always available. Every ★3, ★4 and ★5 in the game.',
    // Real number, not the round one: proportional normalisation over {3,4,5}
    // puts ★5 at 0.16/0.99 = 16.2%, not the 17% a straight ★6->★5 hand-off
    // would give. The copy states what the code actually rolls.
    subDesc: 'No ★6 in the pool, so their 1% is shared out. ★5 lands at 16.2% here.',
    featured6: null,
    featured5: [],
    pool: { 3: POOL_3, 4: POOL_4, 5: POOL_5, 6: [] },
    costSingle: 15,
    costTen: 135,
    currency: 'starFragments',
    // DECISIONS.md §8: no ★6 exist here, so the 1% is redistributed by
    // normalising weights over the rarities actually present. Do NOT write a
    // second hardcoded rate table.
    normalizeRates: true,
    pity5Key: 'shared',
    pity6Key: null,
    tenPullGuarantee: 4,
    inRotation: false,
    art: { color: '#6ad8ff', accent: '#123' },
  },

  {
    id: 'banner_dragon_queen',
    name: 'Sovereign of Cinders',
    type: 'rateup',
    desc: 'Rate-up: ★6 Sovereign Alicia. Half of every ★5 you pull here is Rin, Reika or Hikari.',
    subDesc: 'Win the ★6 coin flip and she is yours. Lose it and the next ★6 is hers, guaranteed.',
    featured6: 'sovereign_alicia',
    featured5: ['rin', 'reika', 'hikari'],
    pool: { 3: POOL_3, 4: POOL_4, 5: POOL_5, 6: POOL_6 },
    costSingle: 15,
    costTen: 135,
    currency: 'starFragments',
    normalizeRates: false,
    /** The 50/50: a won ★6 is the featured one half the time. */
    rateUpChance: 0.5,
    /** Lose it and the next ★6 is featured, no questions asked. Stored per
     *  banner as save.gacha.guaranteedFeatured[bannerId]. */
    guaranteedOnLoss: true,
    /** Same split one rarity down: half of all ★5s come from featured5,
     *  uniformly among the three. The other half rolls the full ★5 pool. */
    rateUp5Chance: 0.5,
    pity5Key: 'shared',
    pity6Key: 'banner',
    tenPullGuarantee: 4,
    inRotation: true,
    art: { color: '#ff6a3d', accent: '#2a0b12' },
  },

  {
    // The second half of the rotation. Its featured5 list is disjoint from
    // Sovereign of Cinders on purpose — with eight ★5s, two non-overlapping
    // rate-ups is exactly what the roster supports, and a player who wants a
    // specific ★5 always has one banner that favours it.
    id: 'banner_tournament_arc',
    name: 'Tournament Arc',
    type: 'rateup',
    desc: 'Rate-up: ★6 Sora. Half of every ★5 you pull here is Niten, Shiro-Same or Akane.',
    subDesc: 'Guaranteed ★6 by pull 70, guaranteed ★5 by pull 40. The counters stay on screen.',
    featured6: 'sora',
    featured5: ['niten', 'shiro_same', 'akane'],
    pool: { 3: POOL_3, 4: POOL_4, 5: POOL_5, 6: POOL_6 },
    costSingle: 15,
    costTen: 135,
    currency: 'starFragments',
    normalizeRates: false,
    rateUpChance: 0.5,
    guaranteedOnLoss: true,
    rateUp5Chance: 0.5,
    pity5Key: 'shared',
    pity6Key: 'banner',
    tenPullGuarantee: 4,
    inRotation: true,
    art: { color: '#ffb63d', accent: '#231206' },
  },

  {
    id: 'banner_beginner',
    name: 'First Impressions',
    type: 'beginner',
    desc: 'One time only. 10 pulls for 108 instead of 135, with a ★5 guaranteed inside.',
    subDesc: 'No ★6 here. Nobody meets the dragon on day one.',
    featured6: null,
    featured5: [],
    pool: { 3: POOL_3, 4: POOL_4, 5: POOL_5, 6: [] },
    oneTime: true,
    pulls: 10,
    discount: 0.20,
    /** Guaranteed ★5 by the 10th pull of this banner, no exceptions. */
    guarantee5Within: 10,
    // FULL price here, NOT the discounted price. GachaEngine.cost() applies
    // `discount` itself, so pre-discounting these charged 86 for a banner whose
    // own description promises 108. List price + discount = the number shown.
    costSingle: 15,
    costTen: 135,
    currency: 'starFragments',
    // Same reason as Standard: no ★6 in the pool, so normalise (§8).
    normalizeRates: true,
    // NOT shared — SECTION 6 shares the ★5 counter between Standard and Rate-Up
    // only, and this banner's guarantee is its own mechanism anyway.
    pity5Key: 'banner',
    pity6Key: null,
    tenPullGuarantee: 4,
    inRotation: false,
    art: { color: '#9dffb0', accent: '#0f2418' },
  },

  {
    id: 'banner_relic',
    name: 'Signature Gear',
    type: 'relic',
    // DECISIONS.md §9: relics are ALWAYS in the in-run drop pool — M6 ships
    // before M7 and all 8 evolutions need a specific relic, so gating them
    // behind the gacha would make evolutions unreachable for a whole milestone.
    // This banner does not gate them. It buys drop weight, not access.
    desc: 'Every relic already drops in runs. Bank one here and it drops 3x as often.',
    subDesc: 'Plus one guaranteed drop of it on your very next run.',
    featured6: null,
    featured5: [],
    pool: {
      relics: [
        // 19 signature relics, one per character.
        'secret_technique_109',
        'dual_blades',
        'hoshiyomi_penlight',
        'susanoo_fragment',
        'nine_tails_chakra',
        'thunder_spear',
        'inaris_blessing',
        'singularity_patch',
        'nichirin_blade_crimson',
        'two_heavens_as_one',
        'chum_bucket',
        'level_5_clearance',
        'grave_idol_mic',
        'ashes_of_the_eternal_encore',
        'captains_rum',
        'potato_chip_gambit',
        'crown_of_the_world_eater',
        'kaioken',
        'the_cell_games',
        // 5 stage relics.
        'neon_visor',
        'anchor_gear',
        'nine_seal_ward',
        'everblade_fragment',
        'abyssal_setlist',
      ],
    },
    /** Permanent multiplier on that relic's in-run drop weight once banked. */
    dropWeightBonus: 3,
    /** And it is handed to you outright at the start of the next run. */
    guaranteedDropNextRun: true,
    /** Draws uniformly from relics not yet banked, so there are no dud pulls
     *  and no refund currency to invent. */
    preferUnbanked: true,
    /** All 24 banked = the banner has nothing left to sell and retires itself. */
    completesAt: 24,
    // Premium against the character banners: a bank is permanent and stacks
    // across every future run, where a character dupe is 40 letters.
    costSingle: 25,
    costTen: 225,
    currency: 'starFragments',
    normalizeRates: false,
    pity5Key: null,
    pity6Key: null,
    // DECISIONS.md §24: this gate is real, not decorative. Locked until the
    // player actually reaches level 60 in a single run.
    unlockedBy: 'reach_level_60',
    inRotation: false,
    art: { color: '#ffd76a', accent: '#2a2210' },
  },
];

// -----------------------------------------------------------------------------
// DUPLICATES & STAR LEVELS
// -----------------------------------------------------------------------------

/** Fan Letters paid out by a duplicate, by rarity (SECTION 6). */
export const DUPE_LETTERS = { 3: 5, 4: 15, 5: 40, 6: 100 };

/** Letters to reach a star level: 2 = S1->S2, 3 = S2->S3, and so on. */
export const STAR_COSTS = { 2: 20, 3: 50, 4: 100, 5: 200 };

/** Universal Fan Letters substitute for character-specific ones at 2:1. */
export const UNIVERSAL_RATIO = 2;

/**
 * FIX C (SECTION 18), which ships regardless of which of A/B was taken: once a
 * ★3 is at S5, further dupes of them convert to UNIVERSAL letters at full value
 * instead of becoming dead currency. With only two ★3s in the pool this trips
 * early and often, and it is the difference between an overflow and a shrug.
 */
export const THREE_STAR_OVERFLOW = true;

/** Star level bonuses (SECTION 4). S3 and S5 are per-character upgrades that
 *  live in the character's own data; here they are just the trigger flags. */
export const STAR_BONUSES = {
  2: { hp: 0.08, autoDamage: 0.08 },
  3: { specialUpgrade: true },
  4: { hp: 0.15, autoDamage: 0.15, cooldown: -0.10 },
  5: { escapeUpgrade: true, escapeCharges: 2 },
};

/** Every 10-pull contains at least one ★4 or better. */
export const TEN_PULL_GUARANTEE = 4;

/** Rolling pull log length. Matches save.gacha.history. */
export const PULL_HISTORY_MAX = 100;

// -----------------------------------------------------------------------------
// PRESENTATION (SECTION 6 — "the pull animation IS the reward")
// -----------------------------------------------------------------------------

export const PULL_PRESENTATION = {
  /** Beam colour is set by the HIGHEST rarity in the batch, not the first. */
  beamColor: { 3: '#6ad8ff', 4: '#c58cff', 5: '#ffd76a', 6: 'rainbow' },
  /** Seconds of held silence before a ★6 lands. The pause is the whole trick. */
  holdBeat: { 6: 0.9 },
  /** Non-negotiable. Skip is live on frame 1, not after the animation "commits". */
  skippableFromFirstFrame: true,
  /** Rift charge-up, matched to the gachaCharge cue in core/audio.js. */
  chargeTime: 1.5,
  /** 10-pulls play ONE combined beam, then reveal cards at this cadence. */
  revealInterval: 0.35,
  /** Screen shake multiplier by rarity. ★6 only per SECTION 6; ★5 gets a nudge. */
  shake: { 5: 0.35, 6: 1.0 },
  /** Cue ids in core/audio.js. */
  sfx: { charge: 'gachaCharge', 3: 'gacha3', 4: 'gacha4', 5: 'gacha5', 6: 'gacha6' },
  /** New characters get a full-screen splash with epithet + spawn bark. */
  newCharacterSplash: true,
  /** Dupes tick "+40" up over this many seconds instead of popping. */
  dupeCounterTick: 0.6,
  /** SECTION 6: hiding the pity counter is hostile, showing it is delightful. */
  showPityCounter: true,
  pityLabel5: '{n}/{max} to guaranteed ★5',
  pityLabel6: '{n}/{max} to guaranteed ★6',
};
