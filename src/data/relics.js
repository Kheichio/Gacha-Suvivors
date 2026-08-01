// src/data/relics.js
// GACHA SURVIVORS — the 30 relics (25 signature + 5 stage).
//
// SECTION 11 rules that are load-bearing here:
//   - Every relic is tied to a character but usable by ANYONE.
//   - Only 3 slots per run. Finding a 4th is a swap decision, not a pickup.
//   - "Relics are NOT stat sticks. Every one must change a decision the player
//     makes." Every desc below states the decision in real numbers.
//
// RESONANCE (DECISIONS.md §10 — the spec left this unformulated).
// Resonance fires when you are playing the relic's owner: the effect is 50%
// stronger. The formula is PER-PARAM and DIRECTION-AWARE:
//
//     up:   v * RESONANCE_MULT        down: v / RESONANCE_MULT
//
// Every signature relic below carries a FULLY RESOLVED `resonance` block rather
// than leaving the engine to compute it. Two reasons: (1) the spec's one worked
// example (Chum Bucket) lists every param including the ones that land on the
// default value, so "resolved set" is the shape the spec itself demonstrates,
// and (2) `resonanceDesc` is written off the resolved numbers, so the card text
// can never drift from what the engine applies. `tests/data.test.js` asserts
// each block against RESONANCE_MULT / RESONANCE_DIRECTION and lists the
// deliberate exceptions, which are commented inline wherever they occur.
//
// Stage relics belong to a PLACE, not a person, so they can never resonate:
// `resonance: null`, `resonanceDesc: null`, `owner: null`, `stageOwner` set.
//
// Source-attribution strings live in exactly one file, src/data/refs.js, keyed
// by relic id (DECISIONS.md §22). None appear here. `shipName` is the
// DEV_MODE=false display name from that same ruling, not an attribution.

export const RELIC_SLOTS = 3;      // SECTION 11: three slots, forever. The 4th is a choice.
export const RESONANCE_MULT = 1.5; // "50% stronger" — SECTION 11.

// Direction table. Keyed by exact param name; anything unlisted uses `default`.
//   'down'    — smaller is better (waits, costs, gates you have to climb to)
//   'up'      — bigger is better (everything else)
//   'context' — the engine LEAVES IT ALONE unless the relic names it in its own
//               `resonance` block. Used for HP gates: on a relic like Crown of
//               the World-Eater the gate IS the relic's identity and the risk it
//               asks you to hold, so resonance strengthens the payout instead of
//               quietly deleting the condition.
//
// DECISIONS.md §10 names interval / cooldown / chargeTime / threshold / default.
// everyNth, stacksRequired and hpCostPct are added here because the default 'up'
// would make a relic WORSE on its own owner (a boulder every 12 swings instead
// of every 8), which inverts the whole point of resonance. Naming them in the
// table keeps that fact in one readable place instead of buried in 19 override
// blocks.
export const RESONANCE_DIRECTION = {
  interval: 'down',
  cooldown: 'down',
  chargeTime: 'down',
  everyNth: 'down',
  stacksRequired: 'down',
  hpCostPct: 'down',
  duration: 'up',
  threshold: 'context',
  default: 'up',
};

// Drop weights (DECISIONS.md §9: all 24 relics are always in the in-run drop
// pool; the Relic Banner grants a permanent +3x weight on one of them rather
// than gating it). Weighted by rarity so legendaries stay a chase.
//   rare 220 | epic 140 | legendary 100

// ---------------------------------------------------------------------------
// SIGNATURE RELICS (25)
// ---------------------------------------------------------------------------

const SECRET_TECHNIQUE_109 = {
  id: 'secret_technique_109',
  name: 'The 109th Secret Technique',
  shipName: 'The 109th Hidden Trick', // DECISIONS.md §22.3
  owner: 'mochi',
  stageOwner: null,
  rarity: 'rare',
  icon: '🪨',
  desc: 'Every 8th auto-attack spits a boulder instead: 4x damage and 400px of knockback.',
  resonanceDesc: 'RESONANCE: every 5th auto-attack, 6x damage, 600px knockback.',
  hooks: ['onNthAutoAttack'],
  params: { everyNth: 8, damageMult: 4, knockback: 400 },
  // everyNth resonates DOWN: 8/1.5 = 5.33, rounded to 5 swings.
  resonance: { everyNth: 5, damageMult: 6, knockback: 600 },
  visual: { shape: 'circle', color: '#8c7a6b', accent: '#3a2f27', size: 12 },
  dropWeight: 220,
  codex: 'Techniques 1 through 108 are classified. 109 is a rock. It works every time.',
};

const DUAL_BLADES = {
  id: 'dual_blades',
  name: 'Unique Skill: Dual Blades',
  shipName: 'Rare Skill: Twin Blades', // DECISIONS.md §22.3
  owner: 'alto',
  stageOwner: null,
  rarity: 'rare',
  icon: '⚔️',
  desc: 'Every 4th auto-attack swings twice. The second swing is a full-damage copy and rolls its own crit.',
  resonanceDesc: 'RESONANCE: every 3rd auto-attack swings three times.',
  hooks: ['onNthAutoAttack'],
  params: { everyNth: 4, extraSwings: 1 },
  // 4/1.5 = 2.67 -> 3; extraSwings 1*1.5 = 1.5 -> 2.
  resonance: { everyNth: 3, extraSwings: 2 },
  visual: { shape: 'shard', color: '#1b1f2a', accent: '#39d7ff', size: 12 },
  dropWeight: 220,
  codex: 'The system granted one sword. He read the rest of the terms of service.',
};

const HOSHIYOMI_PENLIGHT = {
  id: 'hoshiyomi_penlight',
  name: 'Hoshiyomi Penlight',
  shipName: 'Star Gazer Penlight', // DECISIONS.md §22.3
  owner: 'hoshino_rei',
  stageOwner: null,
  rarity: 'epic',
  icon: '🔦',
  desc: 'Auras are 40% larger and pulse 25% faster. Every aura in the game, not just hers.',
  resonanceDesc: 'RESONANCE: auras +60% size, +37.5% pulse rate.',
  hooks: ['onRunStart'],
  // Bonuses are stored as FRACTIONS, never as finished multipliers, so the
  // default *1.5 makes the bonus 50% stronger (+40% -> +60%) instead of
  // compounding the whole multiplier (which would read +110%).
  params: { auraSize: 0.40, auraPulseRate: 0.25 },
  resonance: { auraSize: 0.60, auraPulseRate: 0.375 },
  visual: { shape: 'star', color: '#3b6fe0', accent: '#eaf2ff', size: 12, glow: true },
  dropWeight: 140,
  codex: 'Hold it up. The whole arena is now the front row.',
};

const SUSANOO_FRAGMENT = {
  id: 'susanoo_fragment',
  name: 'Susanoo Fragment',
  shipName: 'Guardian Ribcage', // DECISIONS.md §22
  owner: 'yamikage',
  stageOwner: null,
  rarity: 'rare',
  icon: '🦴',
  desc: 'Every 12s a spectral ribcage forms and fully blocks the next hit you take. Warning: it evolves into FULL SUSANOO, which is a minion — running it on Niten switches his Dokkōdō off.',
  resonanceDesc: 'RESONANCE: every 8s, blocks the next 2 hits.',
  hooks: ['onInterval', 'onDamageTaken'],
  params: { interval: 12, blocks: 1 },
  // 12/1.5 = 8 exactly; blocks 1*1.5 = 1.5 -> 2.
  resonance: { interval: 8, blocks: 2 },
  visual: { shape: 'ring', color: '#7a4bd6', accent: '#1a0e2e', size: 14, glow: true },
  dropWeight: 220,
  codex: 'A rib. Just the one. It is still more armour than he has ever worn.',
};

const NINE_TAILS_CHAKRA = {
  id: 'nine_tails_chakra',
  name: 'Nine-Tails Chakra',
  shipName: 'Ninefold Cloak', // DECISIONS.md §22.3
  owner: 'uzu',
  stageOwner: null,
  rarity: 'epic',
  icon: '🦊',
  desc: 'Below 50% HP: +40% attack speed and a burning chakra cloak dealing 36 damage/s to enemies within 90px. Staying hurt is the build.',
  resonanceDesc: 'RESONANCE: +60% attack speed, 135px cloak at 54 damage/s.',
  hooks: ['onLowHp', 'onTick'],
  // `threshold` is 'context' — it stays at 50%. Resonance pays out harder rather
  // than widening the gate, because the gate is the risk this relic sells.
  // Cloak damage is not stated anywhere in the spec; 36/s chosen so resonance
  // lands on a clean 54.
  params: { threshold: 0.50, attackSpeed: 0.40, cloakRadius: 90, cloakDps: 36 },
  resonance: { threshold: 0.50, attackSpeed: 0.60, cloakRadius: 135, cloakDps: 54 },
  visual: { shape: 'circle', color: '#ff7a1a', accent: '#b32d00', size: 13, glow: true },
  dropWeight: 140,
  codex: 'The tenant pays no rent and shouts constantly, but he does help with the fighting.',
};

const THUNDER_SPEAR = {
  id: 'thunder_spear',
  name: 'Thunder Spear',
  shipName: 'Lightning Lance', // DECISIONS.md §22.3
  owner: 'captain_yuli',
  stageOwner: null,
  rarity: 'rare',
  icon: '⚡',
  desc: 'Every 6th attack detonates for 120 damage in a 100px blast. Melee characters get an AoE they have to count to.',
  resonanceDesc: 'RESONANCE: every 4th attack, 180 damage in a 150px blast.',
  hooks: ['onNthAutoAttack'],
  // 6/1.5 = 4 exactly. Blast damage is unstated in the spec; 120 chosen to sit
  // just under Yuli's own Nape Strike so it never outshines the special.
  params: { everyNth: 6, radius: 100, damage: 120 },
  resonance: { everyNth: 4, radius: 150, damage: 180 },
  visual: { shape: 'triangle', color: '#d9e6ff', accent: '#2b3a57', size: 12 },
  dropWeight: 220,
  codex: 'Standard issue. Aim for the nape. Do not aim for anything that is not the nape.',
};

const INARIS_BLESSING = {
  id: 'inaris_blessing',
  name: 'Inari\'s Blessing',
  shipName: null,
  owner: 'kagura',
  stageOwner: null,
  rarity: 'epic',
  icon: '⛩️',
  desc: 'Burn and DoT effects deal +50% damage and last +2s. Turns Stage 5\'s regenerating demons from a wall into a snack.',
  resonanceDesc: 'RESONANCE: DoTs +75% damage, +3s duration.',
  hooks: ['onHit', 'onTick'],
  params: { dotDamage: 0.50, dotDuration: 2 },
  resonance: { dotDamage: 0.75, dotDuration: 3 },
  visual: { shape: 'diamond', color: '#ff9ec4', accent: '#c8102e', size: 12 },
  dropWeight: 140,
  codex: 'The fox deity blesses the fire, the rice harvest, and absolutely nothing you asked for.',
};

const SINGULARITY_PATCH = {
  id: 'singularity_patch',
  name: 'Singularity Patch',
  shipName: null,
  owner: 'unit_09',
  stageOwner: null,
  rarity: 'epic',
  icon: '💾',
  desc: 'At 6+ stacks of any buff, +30% damage and your outline glows hot pink. Bento boxes, auras and level-up buffs all count — go collect.',
  resonanceDesc: 'RESONANCE: 4+ stacks, +45% damage.',
  hooks: ['onBuffStack'],
  // stacksRequired resonates DOWN: 6/1.5 = 4 exactly.
  params: { stacksRequired: 6, damage: 0.30 },
  resonance: { stacksRequired: 4, damage: 0.45 },
  visual: { shape: 'square', color: '#ff4fd8', accent: '#1b1030', size: 12, glow: true },
  dropWeight: 140,
  codex: 'Patch notes: fixed an issue where the user was not, in fact, a superintelligence.',
};

const NICHIRIN_BLADE_CRIMSON = {
  id: 'nichirin_blade_crimson',
  name: 'Nichirin Blade (Crimson)', // canonical spelling — DECISIONS.md §11
  shipName: 'Sunsteel Edge (Crimson)', // DECISIONS.md §22
  owner: 'rin',
  stageOwner: null,
  rarity: 'legendary',
  icon: '🗡️',
  desc: 'Attacks apply SUNLIGHT: elites and bosses cannot regenerate, and the target burns for 4% of its max HP per second for 4s. Percentage damage — it does not care how much HP scaling has happened.',
  resonanceDesc: 'RESONANCE: 6% max HP per second for 6s.',
  hooks: ['onHit'],
  params: { hpPctPerSecond: 0.04, duration: 4 },
  resonance: { hpPctPerSecond: 0.06, duration: 6 },
  visual: { shape: 'shard', color: '#e23b3b', accent: '#1a0a0a', size: 13, glow: true },
  dropWeight: 100,
  // Feeds the SUNLIT EDGE evolution (Sharp Edge maxed + this relic) —
  // renamed from TOTAL CONCENTRATION per DECISIONS.md §12.
  codex: 'It is not on fire. It has simply come to an agreement with the sun.',
};

const TWO_HEAVENS_AS_ONE = {
  id: 'two_heavens_as_one',
  name: 'Two Heavens As One',
  shipName: 'Two Skies As One', // DECISIONS.md §22
  owner: 'niten',
  stageOwner: null,
  rarity: 'legendary',
  icon: '🌓',
  desc: 'Every 2nd auto-attack is a guaranteed crit. Niten already alternates long sword and short sword, so every short thrust crits forever. Be warned: FULL SUSANOO counts as a minion, so evolving Susanoo Fragment switches his Dokkōdō passive off — you cannot run both halves of the sword-saint build.',
  resonanceDesc: 'RESONANCE: every auto-attack is a guaranteed crit.',
  hooks: ['onNthAutoAttack', 'onCrit'],
  params: { everyNth: 2, critChance: 1.0 },
  // 2/1.5 = 1.33 -> 1. critChance is already 1.0 and clamps there rather than
  // scaling to 1.5 — the only capped param in the file.
  // The minion warning is DECISIONS.md §27, said out loud on purpose.
  resonance: { everyNth: 1, critChance: 1.0 },
  visual: { shape: 'cross', color: '#e8e2d4', accent: '#8c1c1c', size: 13 },
  dropWeight: 100,
  codex: 'Two swords, one man, no school, no students, no friends. He seems fine about it.',
};

const CHUM_BUCKET = {
  id: 'chum_bucket',
  name: 'Chum Bucket',
  shipName: null,
  owner: 'shiro_same',
  stageOwner: null,
  rarity: 'legendary',
  icon: '🪣',
  desc: 'Every 20s, drop a chum pile that pulls enemies within 250px toward it. Crowd control you place, not crowd control you aim.',
  resonanceDesc: 'RESONANCE: 12s cooldown, 375px radius.',
  hooks: ['onInterval'],
  params: { interval: 20, radius: 250 },
  // THE one worked example in SECTION 11, reproduced verbatim. `interval: 12` is
  // a deliberate override — the default 20/1.5 would give 13.3s. `radius: 375`
  // is exactly the default 250*1.5, which is why the spec's own example is the
  // proof that a resonance block lists the FULL resolved set.
  // The chum pile is a PROP, not a minion (DECISIONS.md §27) — it does not turn
  // off Niten's Dokkōdō.
  resonance: { interval: 12, radius: 375 },
  visual: { shape: 'hex', color: '#5fd6ff', accent: '#0b3d5c', size: 13 },
  dropWeight: 100,
  codex: 'Chumbuds assemble. Chumbuds immediately regret assembling.',
};

const LEVEL_5_CLEARANCE = {
  id: 'level_5_clearance',
  name: 'Level 5 Clearance',
  shipName: 'Rank Five Clearance', // DECISIONS.md §22
  owner: 'reika',
  stageOwner: null,
  rarity: 'legendary',
  icon: '🪪',
  desc: 'Piercing attacks gain +12% damage per enemy already pierced. Uncapped — line up the horde and the last one in the row takes the worst of it.',
  resonanceDesc: 'RESONANCE: +18% damage per enemy pierced.',
  hooks: ['onPierce'],
  params: { damagePerPierce: 0.12 },
  resonance: { damagePerPierce: 0.18 },
  visual: { shape: 'square', color: '#ffb02e', accent: '#2b2b2b', size: 12 },
  dropWeight: 100,
  codex: 'Seven people in the city hold this badge. One of them flicks coins at things.',
};

const GRAVE_IDOL_MIC = {
  id: 'grave_idol_mic',
  name: 'Grave Idol Mic',
  shipName: null,
  owner: 'nekromina',
  stageOwner: null,
  rarity: 'epic',
  icon: '🎤',
  desc: 'Minion cap +3 and minions gain +25% attack speed. Minions are minions: this switches Niten\'s Dokkōdō off.',
  resonanceDesc: 'RESONANCE: minion cap +5, minions +37.5% attack speed.',
  hooks: ['onRunStart'],
  // 3*1.5 = 4.5, rounded to 5 (round-half-up, matching JS Math.round).
  params: { minionCap: 3, minionAttackSpeed: 0.25 },
  resonance: { minionCap: 5, minionAttackSpeed: 0.375 },
  visual: { shape: 'capsule', color: '#ff5fa2', accent: '#1a0b14', size: 12 },
  dropWeight: 140,
  codex: 'She signed the Deadbeats to a lifetime contract. The timing of that was deliberate.',
};

const ASHES_OF_THE_ETERNAL_ENCORE = {
  id: 'ashes_of_the_eternal_encore',
  name: 'Ashes of the Eternal Encore', // canonical spelling — DECISIONS.md §11
  shipName: null,
  owner: 'hikari',
  stageOwner: null,
  rarity: 'legendary',
  icon: '🪶',
  desc: 'Grants 1 extra revive, and every revive also gives +100% damage for 10s. Dying becomes an opener.',
  resonanceDesc: 'RESONANCE: 2 extra revives and +150% damage for 15s (the run cap is still 3 revives).',
  hooks: ['onRevive'],
  params: { extraRevives: 1, damage: 1.00, duration: 10 },
  // extraRevives 1*1.5 = 1.5 -> 2. DECISIONS.md §29 hard-caps revives at 3 per
  // run across every source, so the resonance text says so rather than promising
  // a number the engine will silently refuse.
  resonance: { extraRevives: 2, damage: 1.50, duration: 15 },
  visual: { shape: 'shard', color: '#ff8a00', accent: '#ffd76a', size: 13, glow: true },
  dropWeight: 100,
  codex: 'She has died more times than anyone in the building and is still the cheeriest person in it.',
};

const CAPTAINS_RUM = {
  id: 'captains_rum',
  name: 'Captain\'s Rum',
  shipName: null,
  owner: 'akane',
  stageOwner: null,
  rarity: 'epic',
  icon: '🥃',
  desc: 'Every 45s you take a swig: heal 20% max HP and gain +40% damage for 8s. You do not choose when — you choose whether to be in trouble when it lands.',
  resonanceDesc: 'RESONANCE: every 30s — heal 30% max HP, +60% damage for 12s.',
  hooks: ['onInterval'],
  params: { interval: 45, healPct: 0.20, damage: 0.40, duration: 8 },
  // 45/1.5 = 30 exactly.
  resonance: { interval: 30, healPct: 0.30, damage: 0.60, duration: 12 },
  visual: { shape: 'capsule', color: '#c62828', accent: '#f4c542', size: 12 },
  dropWeight: 140,
  codex: 'Medicinal. Prescribed by the captain. The captain is not a doctor. Ahoy.',
};

const POTATO_CHIP_GAMBIT = {
  id: 'potato_chip_gambit',
  name: 'Potato Chip Gambit',
  shipName: null,
  owner: 'kira',
  stageOwner: null,
  rarity: 'legendary',
  icon: '🥔',
  desc: 'Every 30s, the next name you write marks 6 enemies at once. He eats one potato chip. It takes four seconds and he does not break eye contact.',
  resonanceDesc: 'RESONANCE: every 20s, the next name marks 9 enemies.',
  hooks: ['onInterval', 'onAutoAttack'],
  params: { interval: 30, marks: 6 },
  // 30/1.5 = 20 exactly; 6*1.5 = 9.
  resonance: { interval: 20, marks: 9 },
  visual: { shape: 'square', color: '#f2c14e', accent: '#2a1a0d', size: 12 },
  dropWeight: 100,
  codex: 'The chip is a decoy. The chip is always a decoy. He has never once simply eaten a chip.',
};

const CROWN_OF_THE_WORLD_EATER = {
  id: 'crown_of_the_world_eater',
  name: 'Crown of the World-Eater', // canonical spelling — DECISIONS.md §11
  shipName: null,
  owner: 'sovereign_alicia',
  stageOwner: null,
  rarity: 'legendary',
  icon: '👑',
  desc: 'While above 80% HP, +35% to all damage. A relic that pays you for never getting touched, on a roster built around getting touched.',
  resonanceDesc: 'RESONANCE: +52.5% all damage above 80% HP.',
  hooks: ['onHighHp'],
  // `threshold` is 'context' and stays at 80%. Dropping the gate to ~53% would
  // make it an unconditional damage buff — a stat stick, which SECTION 11 bans.
  params: { threshold: 0.80, damage: 0.35 },
  resonance: { threshold: 0.80, damage: 0.525 },
  visual: { shape: 'star', color: '#ffd166', accent: '#8c2f00', size: 13, glow: true },
  dropWeight: 100,
  codex: 'She does not eat worlds. She reviews them, live, at 6am, in a booming voice.',
};

const KAIOKEN = {
  id: 'kaioken',
  name: 'Kaio-ken',
  shipName: 'Crimson Multiplier', // DECISIONS.md §22
  owner: 'sora',
  stageOwner: null,
  rarity: 'legendary',
  icon: '💢',
  desc: 'Your escape move grants +50% damage and +30% attack speed for 6s and costs 10% of your max HP. Every panic button becomes an attack button, and the panic gets more expensive.',
  resonanceDesc: 'RESONANCE: +75% damage, +45% attack speed for 9s, costs 7% max HP.',
  hooks: ['onEscape'],
  params: { damage: 0.50, attackSpeed: 0.30, duration: 6, hpCostPct: 0.10 },
  // hpCostPct is a COST and resonates DOWN like a cooldown: 0.10/1.5 = 0.0667,
  // rounded to 0.07 so the card can print a whole percent.
  // The ZERO COOLDOWN evolution cannot farm this forever — DECISIONS.md §28
  // floors the escape cooldown at 0.6s specifically to kill that loop.
  resonance: { damage: 0.75, attackSpeed: 0.45, duration: 9, hpCostPct: 0.07 },
  visual: { shape: 'ring', color: '#ff2d2d', accent: '#ffe08a', size: 13, glow: true },
  dropWeight: 100,
  codex: 'The multiplier is fine. The part where it injures the user is, apparently, also fine.',
};

const THE_CELL_GAMES = {
  id: 'the_cell_games',
  name: 'The Cell Games',
  shipName: 'The Last Tournament', // DECISIONS.md §22.3
  owner: 'han',
  stageOwner: null,
  rarity: 'epic',
  icon: '🏟️',
  desc: 'Dropping below 25% HP instantly fills your Rage or special meter and grants 2s of invulnerability. Once every 90s. On anyone else it is a panic button; on Han it is the whole gameplan.',
  resonanceDesc: 'RESONANCE: 3s invulnerability, every 60s.',
  hooks: ['onLowHp', 'onDamageTaken'],
  // `threshold` is 'context' and stays at 25% — the relic is a promise about the
  // worst moment of the run, not a discount on reaching it. 90/1.5 = 60 exactly.
  params: { threshold: 0.25, invulnDuration: 2, cooldown: 90 },
  resonance: { threshold: 0.25, invulnDuration: 3, cooldown: 60 },
  visual: { shape: 'ring', color: '#8a5cd6', accent: '#ffd93d', size: 13, glow: true },
  dropWeight: 140,
  codex: 'He asked, very politely, several times, for all of this to stop.',
};

const EXCLUSIVE_CONTRACT = {
  id: 'exclusive_contract',
  name: 'The Exclusive Contract',
  shipName: null,
  owner: 'yukine',
  stageOwner: null,
  rarity: 'legendary',
  icon: '📜',
  desc: 'Every 35s you sign: +45% damage for 8s, and then -20% damage for the 8s after it. There is always a clause, and you are the one who has to plan around it.',
  resonanceDesc: 'RESONANCE: every 23s — +67.5% damage for 12s, then -13% for 12s.',
  hooks: ['onInterval', 'onTick'],
  // `penalty` is a COST and resonates DOWN like a cooldown (0.20/1.5 = 0.133,
  // rounded to 0.13 so the card can print a whole percent). Everything else
  // takes the default *1.5. 35/1.5 = 23.3 -> 23.
  params: { interval: 35, bonus: 0.45, duration: 8, penalty: 0.20 },
  resonance: { interval: 23, bonus: 0.675, duration: 12, penalty: 0.13 },
  visual: { shape: 'square', color: '#f4f1ea', accent: '#3fb6c8', size: 12 },
  dropWeight: 100,
  codex: 'Clause four is four pages long. Nobody has ever finished clause four.',
};

const ANNOTATED_MANUAL = {
  id: 'annotated_manual',
  name: 'The Annotated Manual',
  shipName: null,
  owner: 'wren',
  stageOwner: null,
  rarity: 'epic',
  icon: '📓',
  desc: 'Every kill refunds 0.4s from every cooldown you have — special, escape and relic timers alike. Kill efficiently and your kit is never actually down.',
  resonanceDesc: 'RESONANCE: 0.6s off every cooldown per kill.',
  hooks: ['onKill'],
  params: { refund: 0.4 },
  resonance: { refund: 0.6 },
  visual: { shape: 'square', color: '#c3a8ff', accent: '#2a2436', size: 12 },
  dropWeight: 140,
  codex: 'Every page corrected in a neat hand. Several corrections correct her teacher.',
};

const CHIPPED_GREATAXE = {
  id: 'chipped_greataxe',
  name: 'The Chipped Greataxe',
  shipName: null,
  owner: 'brant',
  stageOwner: null,
  rarity: 'epic',
  icon: '🪓',
  desc: 'Your first attack within 2s of using your escape deals 250% damage and knocks back 500px. Every panic becomes an opening, if you swing on the way out.',
  resonanceDesc: 'RESONANCE: 375% damage and 750px of knockback, within 3s.',
  hooks: ['onEscape', 'onAutoAttack'],
  params: { window: 2, damageMult: 2.5, knockback: 500 },
  resonance: { window: 3, damageMult: 3.75, knockback: 750 },
  visual: { shape: 'shard', color: '#b8c2ce', accent: '#4a3020', size: 13 },
  dropWeight: 140,
  codex: 'Too big for him. Notched down the whole edge. He has never once let go of it.',
};

const CRACKED_TEACUP = {
  id: 'cracked_teacup',
  name: 'The Cracked Teacup',
  shipName: null,
  owner: 'aoi',
  stageOwner: null,
  rarity: 'legendary',
  icon: '🍵',
  desc: 'Every 20s you drop something: 120 damage in a 140px shatter at your feet, and 5 of your own HP. It can never kill you, and you always know exactly where you are standing.',
  resonanceDesc: 'RESONANCE: every 13s — 180 damage in 210px, and only 3 HP.',
  hooks: ['onInterval'],
  // `selfDamage` is a COST and resonates DOWN (5/1.5 = 3.33 -> 3). 20/1.5 = 13.3
  // -> 13; the rest take the default *1.5.
  params: { interval: 20, radius: 140, damage: 120, selfDamage: 5 },
  resonance: { interval: 13, radius: 210, damage: 180, selfDamage: 3 },
  visual: { shape: 'circle', color: '#eaf2ff', accent: '#1e2440', size: 12, glow: true },
  dropWeight: 100,
  codex: 'It was a very good cup. It is still, technically, a very good cup.',
};

const FIELD_OF_FLOWERS = {
  id: 'field_of_flowers',
  name: 'A Field of Flowers',
  shipName: null,
  owner: 'mirel',
  stageOwner: null,
  rarity: 'legendary',
  icon: '🌼',
  desc: 'Every 25s a 240px meadow blooms where you stand and lasts 8s: everything inside it is 30% slower and you heal 3 HP/s. It is not a combat spell. Use it anyway.',
  resonanceDesc: 'RESONANCE: every 17s — a 360px meadow for 12s, 45% slow, 4.5 HP/s.',
  hooks: ['onInterval'],
  // 25/1.5 = 16.67 -> 17. Everything else is the default *1.5.
  params: { interval: 25, radius: 240, duration: 8, healPerSecond: 3, slow: 0.30 },
  resonance: { interval: 17, radius: 360, duration: 12, healPerSecond: 4.5, slow: 0.45 },
  visual: { shape: 'star', color: '#8fe6a8', accent: '#c8a24a', size: 12, glow: true },
  dropWeight: 100,
  codex: 'It does nothing but flowers. She learned it anyway. That took eleven years.',
};

const THE_CONTINGENCY_PLAN = {
  id: 'the_contingency_plan',
  name: 'The Contingency Plan',
  shipName: null,
  owner: 'pekora',
  stageOwner: null,
  rarity: 'legendary',
  icon: '🥕',
  desc: 'Once every 40s the next hit that lands on you does not: it is copied straight back onto whatever threw it at 300%, and a mine drops where you were standing for 100 damage in a 130px blast. You cannot choose when it spends — you choose what you are standing next to.',
  resonanceDesc: 'RESONANCE: every 27s — the hit comes back at 450%, and the mine deals 150 in a 195px blast.',
  hooks: ['onDamageTaken'],
  // `cooldown`, not `interval`, and for the same reason The Cell Games uses one:
  // this is a gate on the worst moment of a run rather than a metronome, and the
  // player is never told which hit will be the one it eats. It resonates DOWN —
  // 40/1.5 = 26.67, rounded to 27 so the card can print a whole second.
  params: { cooldown: 40, reflect: 3.0, damage: 100, radius: 130 },
  resonance: { cooldown: 27, reflect: 4.5, damage: 150, radius: 195 },
  visual: { shape: 'shard', color: '#ff8f2e', accent: '#1e2f5c', size: 13, glow: true },
  dropWeight: 100,
  codex: 'Plan A was better. Plan A is always better. Plan A has never once been attempted.',
};

// ---------------------------------------------------------------------------
// STAGE RELICS (5) — first-clear rewards.
// owner: null + stageOwner. No resonance: a place cannot be your main.
// ---------------------------------------------------------------------------

const NEON_VISOR = {
  id: 'neon_visor',
  name: 'Neon Visor',
  shipName: null,
  owner: null,
  stageOwner: 'neon_akiba',
  rarity: 'rare',
  icon: '🥽',
  desc: 'Enemies inside the camera view take +10% damage, and smoke and darkness hazards no longer obscure you. Fight where you can see, not where it is safe.',
  resonanceDesc: null,
  hooks: ['onHit', 'onRunStart'],
  params: { onScreenDamage: 0.10 },
  resonance: null,
  visual: { shape: 'capsule', color: '#00e5ff', accent: '#12002e', size: 12, glow: true },
  dropWeight: 220,
  codex: 'Prescription: none. Function: fog is now somebody else\'s problem. Nobody knows who built it.',
};

const ANCHOR_GEAR = {
  id: 'anchor_gear',
  name: 'Anchor Gear',
  shipName: null,
  owner: null,
  stageOwner: 'wall_amaris',
  rarity: 'rare',
  icon: '⚓',
  desc: 'Your escape move travels 60% farther and deals 70 damage to everything along the path. Escapes stop being retreats.',
  resonanceDesc: null,
  hooks: ['onEscape'],
  // Path damage is unstated in SECTION 11; 70 chosen to sit between Mochi's rift
  // (20) and Yamikage's Chidori afterimage (60) so it never eclipses an escape
  // that already deals damage.
  params: { escapeDistance: 0.60, pathDamage: 70 },
  resonance: null,
  visual: { shape: 'cross', color: '#9aa5b1', accent: '#2f3b46', size: 12 },
  dropWeight: 220,
  codex: 'Gas, blades, and a comprehensive disregard for the concept of ground.',
};

const NINE_SEAL_WARD = {
  id: 'nine_seal_ward',
  name: 'Nine-Seal Ward',
  shipName: null,
  owner: null,
  stageOwner: 'hidden_ember',
  rarity: 'epic',
  icon: '📿',
  desc: 'The first hit you take every 10s is fully negated. Rewards trading one hit deliberately instead of avoiding all of them.',
  resonanceDesc: null,
  hooks: ['onDamageTaken', 'onInterval'],
  params: { interval: 10 },
  resonance: null,
  visual: { shape: 'ring', color: '#7b4bff', accent: '#f0e6ff', size: 13 },
  dropWeight: 140,
  codex: 'Eight trigrams, one seal, and a very firm opinion about your personal space.',
};

const EVERBLADE_FRAGMENT = {
  id: 'everblade_fragment',
  name: 'Everblade Fragment',
  shipName: null,
  owner: null,
  stageOwner: 'tatami_halls',
  rarity: 'epic',
  icon: '💠',
  desc: 'Killing an elite refunds 100% of every cooldown you have — special, escape and relic timers alike. Suddenly elites are targets you save your kit for.',
  resonanceDesc: null,
  hooks: ['onEliteKill'],
  params: { refundPct: 1.0 },
  resonance: null,
  visual: { shape: 'shard', color: '#ff3b5c', accent: '#2b0710', size: 12, glow: true },
  dropWeight: 140,
  codex: 'Ore that remembers sunlight. Chip it and it turns scarlet and slightly smug.',
};

const ABYSSAL_SETLIST = {
  id: 'abyssal_setlist',
  name: 'Abyssal Setlist',
  shipName: null,
  owner: null,
  stageOwner: 'sunken_reef',
  rarity: 'legendary',
  icon: '🎼',
  desc: 'Every 30s your next attack is a guaranteed crit dealing 400% damage. Hold it. Hold it. Do not waste it on a slime.',
  resonanceDesc: null,
  hooks: ['onInterval', 'onAutoAttack'],
  params: { interval: 30, critMult: 4.0 },
  resonance: null,
  visual: { shape: 'crescent', color: '#2ee6c8', accent: '#04263a', size: 13, glow: true },
  dropWeight: 100,
  codex: 'Track seven runs nine minutes and ends a civilisation. The crowd knows. The crowd waits.',
};

/**
 * KARIN. The one relic on the roster that pays for WALKING.
 *
 * Her whole kit is a retrieval loop, so her signature has to reward the half of
 * it a player is most likely to skip: going back for a blade that landed
 * somewhere inconvenient. `onInterval` rather than a pickup hook because the
 * hook layer has no "picked up your own prop" event and inventing one for a
 * single relic is the wrong shape — a slow drip that is only ever worth
 * anything if she is moving is the same incentive with none of the plumbing.
 */
const THE_LONG_WAY_ROUND = {
  id: 'the_long_way_round',
  name: 'The Long Way Round',
  owner: 'karin',
  stageOwner: null,
  rarity: 'rare',
  icon: '🔁',
  desc: 'Every 6s, if you have moved at all, throw 2 extra blades at the nearest thing for 60% damage.',
  resonanceDesc: 'RESONANCE: every 4s, and 3 blades instead of 2.',
  hooks: ['onInterval'],
  params: { interval: 6, count: 2, damageMult: 0.6 },
  resonance: { interval: 4, count: 3, damageMult: 0.6 },
  visual: { shape: 'shard', color: '#dfe8f5', accent: '#1b1f2a', size: 12 },
  dropWeight: 200,
  codex: 'She has never once thrown a knife she did not intend to go and get back.',
};

/**
 * RIMA. A ★6 signature, so it is allowed to be a rule rather than a proc: the
 * orb's return trip is the half of her auto that a careless player wastes, and
 * this makes the return the part that pays.
 */
const THE_NINTH_TAIL = {
  id: 'the_ninth_tail',
  name: 'The Ninth Tail',
  owner: 'rima',
  stageOwner: null,
  rarity: 'legendary',
  icon: '🦊',
  desc: 'Every 5th kill releases a homing wisp for 120 damage. Kills also heal you for 2 HP.',
  resonanceDesc: 'RESONANCE: every 3rd kill, 200 damage, and 4 HP a kill.',
  hooks: ['onInterval'],
  params: { interval: 5, damage: 120, heal: 2 },
  resonance: { interval: 3, damage: 200, heal: 4 },
  visual: { shape: 'flower', color: '#ff7ad0', accent: '#2a1a3a', size: 13, glow: true },
  dropWeight: 90,
  codex: 'Eight of them are hers. Nobody has ever been rude enough to ask about the ninth.',
};

/**
 * NIKA. Priced against her own cooldown: SWITCHEROO is twelve seconds, the
 * shortest special on the roster, so a relic that fires on the swap fires more
 * often on her than it would on anybody else — which is exactly what a signature
 * relic is for.
 */
const THE_LOOSE_CANNON = {
  id: 'the_loose_cannon',
  name: 'The Loose Cannon',
  owner: 'nika',
  stageOwner: null,
  rarity: 'rare',
  icon: '🧨',
  desc: 'Every special detonates a 220px blast for 180 damage where you are standing. You are immune to it.',
  resonanceDesc: 'RESONANCE: 300px and 300 damage.',
  hooks: ['onSpecial'],
  params: { radius: 220, damage: 180 },
  resonance: { radius: 300, damage: 300 },
  visual: { shape: 'triangle', color: '#ff5fa8', accent: '#2a2233', size: 12, glow: true },
  dropWeight: 190,
  codex: 'The safety was the first thing to go, and it went for parts.',
};

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------

export const RELICS = [
  THE_LONG_WAY_ROUND,
  THE_NINTH_TAIL,
  THE_LOOSE_CANNON,
  SECRET_TECHNIQUE_109,
  DUAL_BLADES,
  HOSHIYOMI_PENLIGHT,
  SUSANOO_FRAGMENT,
  NINE_TAILS_CHAKRA,
  THUNDER_SPEAR,
  INARIS_BLESSING,
  SINGULARITY_PATCH,
  NICHIRIN_BLADE_CRIMSON,
  TWO_HEAVENS_AS_ONE,
  CHUM_BUCKET,
  LEVEL_5_CLEARANCE,
  GRAVE_IDOL_MIC,
  ASHES_OF_THE_ETERNAL_ENCORE,
  CAPTAINS_RUM,
  POTATO_CHIP_GAMBIT,
  CROWN_OF_THE_WORLD_EATER,
  KAIOKEN,
  THE_CELL_GAMES,
  EXCLUSIVE_CONTRACT,
  ANNOTATED_MANUAL,
  CHIPPED_GREATAXE,
  CRACKED_TEACUP,
  FIELD_OF_FLOWERS,
  THE_CONTINGENCY_PLAN,
  NEON_VISOR,
  ANCHOR_GEAR,
  NINE_SEAL_WARD,
  EVERBLADE_FRAGMENT,
  ABYSSAL_SETLIST,
];

// Written out rather than derived, per the "plain data, no logic" rule.
export const RELICS_BY_ID = {
  the_long_way_round: THE_LONG_WAY_ROUND,
  the_ninth_tail: THE_NINTH_TAIL,
  the_loose_cannon: THE_LOOSE_CANNON,
  secret_technique_109: SECRET_TECHNIQUE_109,
  dual_blades: DUAL_BLADES,
  hoshiyomi_penlight: HOSHIYOMI_PENLIGHT,
  susanoo_fragment: SUSANOO_FRAGMENT,
  nine_tails_chakra: NINE_TAILS_CHAKRA,
  thunder_spear: THUNDER_SPEAR,
  inaris_blessing: INARIS_BLESSING,
  singularity_patch: SINGULARITY_PATCH,
  nichirin_blade_crimson: NICHIRIN_BLADE_CRIMSON,
  two_heavens_as_one: TWO_HEAVENS_AS_ONE,
  chum_bucket: CHUM_BUCKET,
  level_5_clearance: LEVEL_5_CLEARANCE,
  grave_idol_mic: GRAVE_IDOL_MIC,
  ashes_of_the_eternal_encore: ASHES_OF_THE_ETERNAL_ENCORE,
  captains_rum: CAPTAINS_RUM,
  potato_chip_gambit: POTATO_CHIP_GAMBIT,
  crown_of_the_world_eater: CROWN_OF_THE_WORLD_EATER,
  kaioken: KAIOKEN,
  the_cell_games: THE_CELL_GAMES,
  exclusive_contract: EXCLUSIVE_CONTRACT,
  annotated_manual: ANNOTATED_MANUAL,
  chipped_greataxe: CHIPPED_GREATAXE,
  cracked_teacup: CRACKED_TEACUP,
  field_of_flowers: FIELD_OF_FLOWERS,
  the_contingency_plan: THE_CONTINGENCY_PLAN,
  neon_visor: NEON_VISOR,
  anchor_gear: ANCHOR_GEAR,
  nine_seal_ward: NINE_SEAL_WARD,
  everblade_fragment: EVERBLADE_FRAGMENT,
  abyssal_setlist: ABYSSAL_SETLIST,
};

// 25 signature relics, in roster order (3★ -> 6★). Captain's Rum sits in the
// ★6 run now rather than the ★5 one — the relic did not change, its owner's
// rarity did, and this list is ordered by owner so that a reader can check the
// one-to-one rule by counting rows against the roster.
export const SIGNATURE_RELICS = [
  'the_long_way_round',
  'the_ninth_tail',
  'the_loose_cannon',
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
  'potato_chip_gambit',
  'exclusive_contract',
  'annotated_manual',
  'chipped_greataxe',
  'crown_of_the_world_eater',
  'kaioken',
  'the_cell_games',
  'cracked_teacup',
  'field_of_flowers',
  'captains_rum',
  'the_contingency_plan',
];

// 5 stage relics, in stage order (stages 2-6; stages 1 and 7 award no relic).
export const STAGE_RELICS = [
  'neon_visor',
  'anchor_gear',
  'nine_seal_ward',
  'everblade_fragment',
  'abyssal_setlist',
];
