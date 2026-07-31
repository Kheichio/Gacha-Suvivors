// GACHA SURVIVORS — EVOLUTIONS
// ============================================================================
// The endgame build payoff. SECTION 10 lines 1452-1473.
//
// A generic upgrade at MAX LEVEL + the matching relic in one of your 3 slots
// = the next chest offers an EVOLUTION instead of stat cards. Max level is
// per-upgrade (`maxLevel` in upgrades.js — Extra Shot is 4, Piercing Will 5,
// everything else here is 8), so this file never hardcodes a level number.
//
// EIGHT evolutions, not seven. DECISIONS.md §4: M6 says 7, SECTION 15 says 8,
// the spec names 8. Eight wins.
//
// `requires.relic` ids are the canonical ones from DECISIONS.md §11 —
// nichirin_blade_crimson, crown_of_the_world_eater, ashes_of_the_eternal_encore.
// tests/data.test.js asserts every one of them resolves against relics.js.
//
// No ref strings live here (DECISIONS.md §22) — refs.js owns them, keyed by id.
//
// ---------------------------------------------------------------------------
// THIS FILE AND WEAPON EVOLUTIONS ARE TWO DIFFERENT SYSTEMS. HOW THEY RELATE.
// ---------------------------------------------------------------------------
//
// Since the weapon overhaul there are two things in the game called an
// evolution, and confusing them is easy, so:
//
//   THIS FILE — BUILD evolutions. Eight of them, one per recipe, and a recipe is
//   a generic upgrade at MAX LEVEL plus a specific RELIC. What they change is the
//   character's kit: an execute, a revive, a beam from orbit, a permanent
//   warrior. They are recorded in `player.evolutions`, they are counted against
//   a hard-coded total of 8 by the results screen and two achievements, and they
//   are offered by run._availableEvolution() as a `kind: 'evolution'` card.
//
//   data/weapons.js — WEAPON evolutions. One per weapon, fifteen of them
//   counting the signature, and a recipe is that weapon at LEVEL 8 plus a named
//   generic upgrade a few levels deep (`evolution.requires`) — no relic. What
//   they change is the weapon: the timer comes off it and it becomes a standing
//   effect. They live in the WeaponSystem's own slot records, deliberately NOT
//   in `player.evolutions`, and they are offered as a `kind: 'weaponEvo'` card.
//
// The connective tissue is the generic upgrade pool, and that is on purpose. One
// upgrade now does up to three jobs at once: its own stat, its half of a build
// recipe here, and its half of a weapon recipe over there. Four upgrades pull
// double duty across both tables — Sharp Edge, Extra Shot, Piercing Will and
// Bloodthirst — which is a feature: the card that was already the best card in
// your build is now also the card that finishes a weapon.
//
// They cannot collide, because the two systems ask for different things from the
// same upgrade. A build recipe needs it MAXED and needs a relic on top; a weapon
// recipe needs two or three levels and nothing else. Paying one never accidentally
// pays the other, and paying both is a build worth planning.
// ============================================================================

/** Every 4th shot becomes a 16-projectile ring. Rei's penlight, weaponised. */
const ENCORE_BARRAGE = {
  id: 'encore_barrage', name: 'ENCORE BARRAGE',
  requires: { upgrade: 'extra_shot', relic: 'hoshiyomi_penlight' },
  desc: 'Every 4th auto-attack fires a full 360° ring of 16 projectiles.',
  icon: '💫',
  params: { everyNthShot: 4, ringCount: 16 },
  visual: { shape: 'star', color: '#ffd76a', accent: '#7a4d00', size: 16, glow: true },
  codex: 'Sixteen lights go up in the dark and every single one of them lands on beat. The crowd did that. You just stood there.',
};

/** Spec gives the 6s cadence and "screen-wide"; damage/width are authored here. */
const ORBITAL_RAILGUN = {
  id: 'orbital_railgun', name: 'ORBITAL RAILGUN',
  requires: { upgrade: 'piercing_will', relic: 'level_5_clearance' },
  desc: 'Every 6s a screen-wide beam drops from orbit for 220 damage. Pierces everything, 90px wide, aims itself down the busiest line.',
  icon: '🛰',
  // targeting: 'lineDensest' is the same spatial-hash line sweep the railgun
  // auto-attack uses (DECISIONS.md §16) — no new targeting mode is invented.
  params: { interval: 6, damage: 220, width: 90, pierceAll: true, targeting: 'lineDensest' },
  visual: { shape: 'capsule', color: '#ff9a3c', accent: '#4a1d00', size: 22, glow: true },
  codex: 'Clearance this high does not come with a supervisor. It comes with a firing solution and a very polite confirmation tone.',
};

/** Execute + heal. Bosses are excluded or a 25% execute would delete the run. */
const FEEDING_GROUNDS = {
  id: 'feeding_grounds', name: 'FEEDING GROUNDS',
  requires: { upgrade: 'bloodthirst', relic: 'chum_bucket' },
  desc: 'Enemies below 25% HP are executed on contact and heal you 1% max HP each, up to 15% per second. Bosses and elites are too big to swallow.',
  icon: '🦈',
  // The per-second heal cap is the only number the spec omits, and it has to
  // exist: 200 executable mobs on screen would otherwise be a full heal per frame.
  params: {
    executeThreshold: 0.25,
    healPercentMaxHp: 0.01,
    healCapPerSec: 0.15,
    excludeTypes: ['elite', 'midboss', 'boss'],
  },
  visual: { shape: 'ring', color: '#e0233f', accent: '#3a0008', size: 24, glow: true },
  codex: 'The water was fine. The water is still fine. The water is, if anything, extremely fine now.',
};

/**
 * DECISIONS.md §12: this was TOTAL CONCENTRATION, which collided with Rin's
 * passive `total_concentration` by NAME and by EFFECT (stand still 1.0s ->
 * empowered piercing hit). Renamed SUNLIT EDGE, and `replacesPassiveBonus`
 * makes the engine take max(8, passiveMult) instead of multiplying them.
 * Rin trades his 2.2x for 8x; everybody else gets 8x from nothing.
 */
const SUNLIT_EDGE = {
  id: 'sunlit_edge', name: 'SUNLIT EDGE',
  requires: { upgrade: 'sharp_edge', relic: 'nichirin_blade_crimson' },
  desc: 'Stand still 1.0s and your next attack deals 8x damage and pierces every enemy it touches. If you already have a stand-still bonus this REPLACES it instead of stacking — you keep the bigger multiplier, not both.',
  icon: '☀',
  params: { standStillTime: 1.0, damageMult: 8, piercesAll: true, replacesPassiveBonus: true },
  visual: { shape: 'crescent', color: '#ffb347', accent: '#7a2a00', size: 20, rotates: true, glow: true },
  codex: 'Breathe in. The blade goes the colour of noon. Breathe out. There is a corridor where the crowd used to be.',
};

/**
 * DECISIONS.md §28: a literal 0-second escape is an infinite buff loop (Kaio-ken
 * on tap). Floors at 0.6s and the card SAYS 0.6s — no lying to the player.
 * torii_warp and the_void are exempt from the FLOOR rather than from the
 * evolution: the parry window is mechanic-driven, and the warp already has no
 * cooldown at all (§53), so flooring either one at 0.6s would make this
 * evolution a downgrade. They take a flat -70% of whatever they have.
 * Escape charges (S5's two-charge Water Wheel) regenerate on the floored
 * cooldown and the cap stays at 2 — that is a charge rule, not an evolution param.
 */
const ZERO_COOLDOWN = {
  id: 'zero_cooldown', name: 'ZERO COOLDOWN',
  requires: { upgrade: 'quick_recovery', relic: 'singularity_patch' },
  desc: 'Your escape move comes back in 0.6s flat. Two escapes play by their own rules — the parry, and the warp that already has no cooldown — and get -70% instead.',
  icon: '⏱',
  params: { cooldownFloor: 0.6, exemptAbilities: ['torii_warp', 'the_void'], exemptReduction: 0.7 },
  visual: { shape: 'ring', color: '#8ef0ff', accent: '#0b3b48', size: 18, glow: true },
  codex: 'We tried an actual zero. The build ate itself, the frame counter filed a complaint, and someone in QA is still dashing. 0.6s. Let them cook, but on a timer.',
};

/** Flat immunity to chip damage. 10% of MAX HP, so it scales with Iron Body. */
const DRAGONHIDE = {
  id: 'dragonhide', name: 'DRAGONHIDE',
  requires: { upgrade: 'iron_body', relic: 'crown_of_the_world_eater' },
  desc: 'Any single hit worth less than 10% of your max HP does nothing at all. Not reduced. Nothing.',
  icon: '🐲',
  params: { ignoreThreshold: 0.10 },
  visual: { shape: 'hex', color: '#d2a24c', accent: '#4a2f00', size: 20, glow: false },
  codex: 'The World-Eater did not flinch at pebbles, gravel, cavalry, or one (1) very determined mascot. Neither do you now.',
};

/**
 * DECISIONS.md §29: revives are capped at 3 per run and resolve in a fixed
 * order — Undying -> Second Chance -> Shrine Revival -> Rei S3 -> Phoenix Heart.
 * Phoenix Heart is LAST, so it is the one that most often goes unused; that is
 * deliberate, it is also the one that turns the revive into an offensive turn.
 */
const PHOENIX_HEART = {
  id: 'phoenix_heart', name: 'PHOENIX HEART',
  requires: { upgrade: 'second_wind', relic: 'ashes_of_the_eternal_encore' },
  desc: 'One extra revive at 50% HP that detonates an 1100px nova for 500 damage and refills every cooldown. It counts toward the 3-revive cap and resolves LAST, after Undying, Second Chance, the Shrine, and Rei.',
  icon: '🔥',
  params: {
    revives: 1,
    reviveHpPercent: 0.5,
    novaRadius: 1100,
    novaDamage: 500,
    refillCooldowns: true,
    reviveCap: 3,
    reviveOrder: 5,
  },
  visual: { shape: 'ring', color: '#ff6a3d', accent: '#5a1500', size: 26, glow: true },
  codex: 'Death is a costume change. Loud one, though. Front row should have known better than to book the aisle seats.',
};

/**
 * DECISIONS.md §27: the warrior declares isMinion:true, which means it is a real
 * minion — it benefits from minion buffs (Grave Idol Mic) and it genuinely
 * switches off any "fight alone" bonus. The desc says so instead of hiding it.
 */
const FULL_SUSANOO = {
  id: 'full_susanoo', name: 'FULL SUSANOO',
  requires: { upgrade: 'guardian_plate', relic: 'susanoo_fragment' },
  desc: 'The ribcage stands all the way up. A permanent spectral warrior blocks one hit every 4s and cuts anything within 140px for 60 damage every 1.2s. It counts as a MINION — anything that pays you for fighting alone switches off.',
  icon: '👹',
  params: { blockInterval: 4, meleeRange: 140, meleeDamage: 60, swingInterval: 1.2, isMinion: true },
  visual: { shape: 'diamond', color: '#a86bff', accent: '#2a0d4a', size: 26, glow: true },
  codex: 'You asked for a shield. It grew a torso, then arms, then opinions, then a sword. Nobody asked for the sword. Nobody is complaining either.',
};

/** All 8, in the order SECTION 10 lists the recipes. */
export const EVOLUTIONS = [
  ENCORE_BARRAGE,
  ORBITAL_RAILGUN,
  FEEDING_GROUNDS,
  SUNLIT_EDGE,
  ZERO_COOLDOWN,
  DRAGONHIDE,
  PHOENIX_HEART,
  FULL_SUSANOO,
];

export const EVOLUTIONS_BY_ID = {
  encore_barrage: ENCORE_BARRAGE,
  orbital_railgun: ORBITAL_RAILGUN,
  feeding_grounds: FEEDING_GROUNDS,
  sunlit_edge: SUNLIT_EDGE,
  zero_cooldown: ZERO_COOLDOWN,
  dragonhide: DRAGONHIDE,
  phoenix_heart: PHOENIX_HEART,
  full_susanoo: FULL_SUSANOO,
};

/**
 * Reverse index for the level-up / chest path: an upgrade that just hit max
 * level asks "is there an evolution waiting on me?" in one lookup, no scan.
 * One evolution per upgrade — the 8 recipes use 8 distinct upgrades.
 */
export const EVOLUTION_BY_UPGRADE = {
  extra_shot: 'encore_barrage',
  piercing_will: 'orbital_railgun',
  bloodthirst: 'feeding_grounds',
  sharp_edge: 'sunlit_edge',
  quick_recovery: 'zero_cooldown',
  iron_body: 'dragonhide',
  second_wind: 'phoenix_heart',
  guardian_plate: 'full_susanoo',
};

/**
 * SECTION 10 line 1472: "Display evolution recipes in the pause menu so players
 * can HUNT them. A hidden recipe is a wasted recipe."
 *
 * Display names are carried here so the pause menu needs no joins. When
 * DEV_MODE is false the menu should prefer
 * displayName(EVOLUTIONS_BY_ID[id].requires.relic) and fall back to relicName —
 * three of these relics carry a shipName (DECISIONS.md §22).
 */
export const EVOLUTION_HINTS = [
  { id: 'encore_barrage',  upgradeName: 'Extra Shot',      relicName: 'Hoshiyomi Penlight',           resultName: 'ENCORE BARRAGE' },
  { id: 'orbital_railgun', upgradeName: 'Piercing Will',   relicName: 'Level 5 Clearance',            resultName: 'ORBITAL RAILGUN' },
  { id: 'feeding_grounds', upgradeName: 'Bloodthirst',     relicName: 'Chum Bucket',                  resultName: 'FEEDING GROUNDS' },
  { id: 'sunlit_edge',     upgradeName: 'Sharp Edge',      relicName: 'Nichirin Blade (Crimson)',     resultName: 'SUNLIT EDGE' },
  { id: 'zero_cooldown',   upgradeName: 'Quick Recovery',  relicName: 'Singularity Patch',            resultName: 'ZERO COOLDOWN' },
  { id: 'dragonhide',      upgradeName: 'Iron Body',       relicName: 'Crown of the World-Eater',     resultName: 'DRAGONHIDE' },
  { id: 'phoenix_heart',   upgradeName: 'Second Wind',     relicName: 'Ashes of the Eternal Encore',  resultName: 'PHOENIX HEART' },
  { id: 'full_susanoo',    upgradeName: 'Guardian Plate',  relicName: 'Susanoo Fragment',             resultName: 'FULL SUSANOO' },
];
