// WEAPONS — the in-run arsenal. Pure data.
//
// WHY THIS EXISTS
// ---------------
// Before this file, a character's auto-attack was a fixed thing: one shape, one
// number, from the first second of a run to the last. Every generic upgrade in
// upgrades.js nudged a stat, so a 20-minute run's offensive progression was
// "the same swing, 60% larger". Nothing on screen ever changed.
//
// So: every character's signature attack now STARTS WEAK and is levelled like a
// weapon, and the player picks up to two more weapons alongside it. Each weapon
// has its own hand-authored 8-level path where every single level changes
// something you can SEE — a wider arc, another projectile, a faster swing — and
// a max-level EVOLUTION that turns it from something that fires every N seconds
// into something that is simply always on.
//
// THE SLOT CAP IS THE DESIGN. Five slots, no more, and the first one is spoken
// for. Without a cap the answer to every offer is "yes" and every run converges
// on the same nine weapons; with one, taking a weapon is a decision you have to
// defend for the rest of the run. Five (the signature plus four picks, out of
// fourteen) leaves ten of them on the table every single time — which is the
// number that makes two runs of the same character play differently.
//
// SCHEMA
// ------
//   id/name/icon    card face. `icon` also appears on the HUD weapon slot.
//   kind            the implementation key in game/abilities/weaponImpls.js.
//   tier            common | rare | epic — card frame colour and draw weight.
//   desc            one line, on the "NEW WEAPON" card.
//   levels[]        EIGHT rows of ABSOLUTE stats, not deltas. Absolute because a
//                   delta table cannot be read at a glance and this is the table
//                   the whole feel of the weapon lives in. `note` is the line the
//                   level-up card shows: what THIS level buys.
//   evolution       { name, icon, desc, stats, requires } — the always-on form.
//                   Its stats row is absolute too and always carries a very short
//                   interval, plus `persist` where the weapon becomes a standing
//                   effect rather than a repeated one. `requires` is the entry
//                   fee — see THE EVOLUTION REQUIREMENT below.
//   visual          the projectile/effect descriptor. Pre-rastered at boot by
//                   render/prewarm.js — never built inside a fire() path.
//
// STAT VOCABULARY (a weapon uses the subset its `kind` reads)
//   damage    per hit, before the player's damage multipliers
//   interval  seconds between activations, before cooldown/attack-speed stats
//   radius    reach: cone length, nova radius, orbit radius, blast radius
//   arc       cone width in radians
//   count     projectiles / orbs / lashes / shells
//   pierce    extra enemies a projectile passes through
//   speed     projectile speed
//   life      projectile lifetime in seconds
//   knockback impulse
//   duration  how long a spawned field or orbit lasts
//   persist   true on an evolution that maintains a permanent effect
//
// No ref strings live here (DECISIONS.md §22) and no character ids: the
// signature weapon reads its name off whichever character is playing.
//
// ---------------------------------------------------------------------------
// THE EVOLUTION REQUIREMENT — `evolution.requires`
// ---------------------------------------------------------------------------
//
// Play report: "make weapons require a specific atk/utl upgrade in order to be
// evolved". They are right, and the reason is that maxing a weapon was never a
// DECISION. Eight levels into a weapon and the evolve card simply turned up; the
// only thing standing between a player and every evolution in their rack was
// time. So a weapon that is maxed is now only half a recipe. The other half is a
// named generic upgrade, three levels deep, and the pair of them is what the
// player has to plan for.
//
// WHY THREE LEVELS AND NOT MAX. The relic recipes in data/evolutions.js already
// own "max out this upgrade" as their price, and they can afford it because they
// only ask it once. A weapon asks it five times over — one per slot — and there
// are only three offensive and three utility build slots to pay with
// (BUILD_SLOTS in upgrades.js). Demanding eight levels of five different
// upgrades is not a cost, it is a refusal. Three is deep enough that you feel it
// leave your build and shallow enough that a run can pay it more than twice.
// Extra Shot asks for TWO because it only has four levels in it at all; the rule
// is min(3, ceil(maxLevel / 2)) and every number below is that rule applied.
//
// WHY SOME WEAPONS SHARE ONE. Idol Orbit and Chain Lash both want Wide Reach;
// Return Cut and Meteor Call both want Long Haul. That is the point rather than
// a shortage of ideas — a build that commits to reach should be able to evolve
// the two weapons that ARE reach, and a rack of five weapons pointing at five
// unrelated upgrades could never evolve more than three of them. Sharing is what
// makes "an area build" or "a crit build" a thing you can actually finish.
//
// The relic-based EVOLUTIONS table is a different, older system and still works
// exactly as it did — see the header of data/evolutions.js for how the two
// relate now that they draw from the same upgrade pool.

/** Hard cap. Slot 0 is ALWAYS the character's own auto-attack. */
export const WEAPON_SLOTS = 5;

// ---------------------------------------------------------------------------
// THE SIGNATURE WEAPON — every character's own auto-attack, levelled.
// ---------------------------------------------------------------------------
//
// These are MULTIPLIERS on the character's authored auto-attack, not absolute
// numbers, because the shape and the base damage still belong to the character.
//
// LEVEL 1 IS THE NERF, AND IT IS CALIBRATED, NOT GUESSED. The first pass used
// 0.55 damage x 0.72 rate — a 40% DPS opener — and the balance harness was
// unambiguous: `node sim.js --char=alto --stage=1 --seed=42` went from 20.7 DPS
// / level 6 / 491 kills to 12.9 / level 4 / 228, i.e. the opening was so thin
// that the player never earned enough XP to reach the levels that fix it. A
// death spiral is not a difficulty curve. 0.70 x 0.85 is a nerf you feel and
// can still climb out of, and the curve above it is steeper to compensate.
//
// `rate` divides the interval, so 1.8 means "swings 1.8x as often".
export const SIGNATURE_LEVELS = [
  { damage: 0.75, rate: 0.88, area: 0.85, count: 0, pierce: 0,
    note: 'Your signature attack, at its weakest. Level it.' },
  { damage: 0.95, rate: 0.95, area: 0.94, count: 0, pierce: 0,
    note: '+27% damage, and it comes around sooner' },
  { damage: 1.18, rate: 1.03, area: 1.02, count: 0, pierce: 0,
    note: 'past full strength, with the reach to match' },
  { damage: 1.35, rate: 1.10, area: 1.10, count: 1, pierce: 0,
    note: '+1 projectile / +1 strike, and it is bigger' },
  { damage: 1.65, rate: 1.22, area: 1.20, count: 1, pierce: 1,
    note: 'it pierces now, and swings noticeably faster' },
  { damage: 2.00, rate: 1.38, area: 1.32, count: 1, pierce: 1,
    note: '+21% damage, +10% size, +13% rate' },
  { damage: 2.40, rate: 1.56, area: 1.44, count: 2, pierce: 1,
    note: 'a second extra projectile / strike' },
  { damage: 2.85, rate: 1.78, area: 1.58, count: 2, pierce: 2,
    note: 'MAXED. It can evolve now.' },
];

/**
 * The evolved signature. `rate` here is deliberately extreme — combined with the
 * character's own interval it lands between 0.10s and 0.25s, which is the point:
 * the attack stops being a thing that happens every few seconds and becomes a
 * thing that is simply happening. `persist` adds the standing aura that makes
 * the difference obvious even while you stand still.
 */
export const SIGNATURE_EVOLUTION = {
  name: 'PERPETUAL',
  icon: '♾',
  desc: 'Your signature attack stops taking breaks. It fires continuously, ' +
        'at triple size, and a standing halo of the same element burns anything ' +
        'that closes on you.',
  // The signature's entry fee is Rapid Fire, and it is the same for every
  // character in the roster on purpose. A per-character requirement would have
  // to live in characters.js, which means twenty-odd separate answers to a
  // question the player asks once — and the answer is the same one every time,
  // because PERPETUAL is not "your attack, bigger", it is "your attack, with the
  // gaps taken out". Rapid Fire is that sentence written as an upgrade. It also
  // costs you an offensive slot before the run has really started, which is the
  // trade: slot 0 is free, evolving slot 0 is not.
  requires: { upgrade: 'rapid_fire', level: 3 },
  stats: { damage: 3.40, rate: 3.20, area: 1.90, count: 3, pierce: 3, persist: true,
           auraRadius: 110, auraDps: 0.55 },
};

// ---------------------------------------------------------------------------
// THE PICKABLE WEAPONS
// ---------------------------------------------------------------------------
//
// The first eight are all the same SHAPE of thing: a timer runs out, a shape
// appears, the shape hurts. Levelling one changes how big the shape is and how
// often the timer runs out. That is a complete design for eight weapons and a
// dead end for fourteen — the ninth "fires a bigger cone more often" is a stat
// card wearing a weapon's frame.
//
// So the six below are deliberately not that. Each one asks a question the
// first eight never ask:
//
//   thorn_bed    where have you BEEN? (ground that persists and spreads)
//   arc_conduit  how many of them are TOUCHING? (a chain that gains per jump)
//   pod_volley   what happens AFTER the projectile? (it becomes more projectiles)
//   return_cut   is the throw the attack, or is the catch? (both, and the
//                catch is the bigger half)
//   dynamo_core  what has your WHOLE BUILD been doing? (a meter every kill in
//                the run fills, that pays out in one lump)
//   hollow_star  where will they be in a second? (it decides, then detonates
//                there)
//
// Two of them (dynamo_core, hollow_star) carry real downside: the coil's damage
// arrives in lumps you cannot time, and the star drags the crowd toward
// whatever it is anchored on — which, once it evolves, is you.

const BLADE_ARC = {
  id: 'blade_arc', name: 'Blade Arc', icon: '⚔', kind: 'arc', tier: 'common', weight: 100,
  desc: 'A short sword slash in front of you. Every level makes it longer, wider, faster and heavier.',
  visual: { shape: 'crescent', color: '#ffe86a', accent: '#7a4d00', size: 22, rotates: true, glow: true },
  levels: [
    { damage: 11, interval: 1.30, radius: 60,  arc: 1.35, count: 1, knockback: 60,
      note: 'a small swing, 60px, every 1.3s' },
    { damage: 15, interval: 1.30, radius: 74,  arc: 1.45, count: 1, knockback: 70,
      note: '+36% damage, reach 60 to 74px' },
    { damage: 20, interval: 1.10, radius: 86,  arc: 1.65, count: 1, knockback: 80,
      note: 'swings every 1.1s, and the arc widens' },
    { damage: 26, interval: 1.10, radius: 96,  arc: 1.80, count: 2, knockback: 90,
      note: 'a SECOND slash follows the first' },
    { damage: 34, interval: 0.92, radius: 108, arc: 2.00, count: 2, knockback: 110,
      note: 'faster, longer, and it throws things now' },
    { damage: 44, interval: 0.92, radius: 122, arc: 2.20, count: 2, knockback: 130,
      note: '+29% damage, reach 108 to 122px' },
    { damage: 56, interval: 0.74, radius: 134, arc: 2.45, count: 3, knockback: 150,
      note: 'THREE slashes, every 0.74s' },
    { damage: 72, interval: 0.62, radius: 150, arc: 2.70, count: 3, knockback: 175,
      note: 'MAXED. 150px, 2.7 radians, every 0.62s.' },
  ],
  evolution: {
    name: 'ENDLESS EDGE', icon: '🌀',
    // Every evolution carries its OWN visual. An evolution you cannot see is an
    // evolution you have to take on faith — the effects layer already draws a
    // different silhouette for the evolved tier, and this makes the projectiles
    // and trails change with it.
    visual: { shape: 'crescent', color: '#ffd76a', accent: '#7a3a00', size: 28, rotates: true, glow: true },
    desc: 'The swing never stops. A full 360 degree blade sweeps around you ' +
          'continuously at 190px, and anything it touches is thrown.',
    // The sword's own edge. Nothing else in the arsenal is this literally a
    // question of how sharp the thing is.
    requires: { upgrade: 'sharp_edge', level: 3 },
    stats: { damage: 78, interval: 0.16, radius: 190, arc: 6.283, count: 1, knockback: 190, spin: 5.2 },
  },
  codex: 'The first lesson is where to stand. The last lesson is that it stopped mattering.',
};

const IDOL_ORBIT = {
  id: 'idol_orbit', name: 'Idol Orbit', icon: '✦', kind: 'orbit', tier: 'common', weight: 100,
  desc: 'Shards that circle you and shred whatever walks into them. Grows into a wall of light.',
  visual: { shape: 'star', color: '#8ad8ff', accent: '#0b3d5c', size: 9, rotates: true, glow: true },
  levels: [
    { damage: 9,  interval: 3.4, count: 2, radius: 62,  duration: 2.2, speed: 3.0, pierce: 2,
      note: '2 shards, 2.2s, every 3.4s' },
    { damage: 12, interval: 3.4, count: 3, radius: 66,  duration: 2.4, speed: 3.2, pierce: 2,
      note: 'a THIRD shard joins the ring' },
    { damage: 16, interval: 3.2, count: 3, radius: 76,  duration: 2.8, speed: 3.6, pierce: 3,
      note: 'wider ring, spins faster, lasts longer' },
    { damage: 21, interval: 3.2, count: 4, radius: 82,  duration: 3.2, speed: 3.8, pierce: 3,
      note: 'a FOURTH shard' },
    { damage: 27, interval: 3.0, count: 5, radius: 90,  duration: 3.6, speed: 4.2, pierce: 4,
      note: 'FIVE shards at 90px' },
    { damage: 35, interval: 2.8, count: 6, radius: 98,  duration: 4.2, speed: 4.6, pierce: 4,
      note: 'SIX shards, on two counter-rotating rings' },
    { damage: 45, interval: 2.6, count: 7, radius: 108, duration: 5.0, speed: 5.0, pierce: 5,
      note: 'SEVEN shards, up almost all the time' },
    { damage: 58, interval: 2.4, count: 8, radius: 118, duration: 6.0, speed: 5.6, pierce: 6,
      note: 'MAXED. Eight shards, 118px, 6s of every 2.4s.' },
  ],
  evolution: {
    name: 'CONSTELLATION', icon: '🌟',
    visual: { shape: 'star', color: '#ffe9a3', accent: '#7a5a00', size: 11, rotates: true, glow: true },
    desc: 'Twelve shards on two counter-rotating rings. They never come down, ' +
          'they never stop turning, and each one passes through everything.',
    // Radius stays close to the maxed 118 rather than pushing further out: a
    // wider single ring passes OVER whatever is standing on you, which is how
    // the first draft of this evolution managed to be weaker than the level it
    // evolved from. The balance harness caught it; the fix is coverage, not
    // damage.
    // A ring is a radius, and Wide Reach is the upgrade that is only ever about
    // radius. Shared with Chain Lash, which is the same sentence with a different
    // shape on the end of it.
    requires: { upgrade: 'wide_reach', level: 3 },
    stats: { damage: 62, interval: 0.42, count: 12, radius: 122, duration: 1.0, speed: 6.2,
             pierce: 99, persist: true },
  },
  codex: 'Somebody in the front row worked out the rotation period and started clapping on it. Everyone else caught up by the second chorus.',
};

const KUNAI_FAN = {
  id: 'kunai_fan', name: 'Kunai Fan', icon: '🗡', kind: 'spread', tier: 'common', weight: 100,
  desc: 'Piercing knives at the nearest enemy. The fan widens and the knives stop stopping.',
  visual: { shape: 'shard', color: '#cfe0f5', accent: '#243050', size: 8, rotates: true },
  levels: [
    { damage: 8,  interval: 1.15, count: 1, arc: 0.00, speed: 520, pierce: 0, life: 1.1,
      note: 'one knife, every 1.15s' },
    { damage: 11, interval: 1.15, count: 2, arc: 0.16, speed: 540, pierce: 0, life: 1.2,
      note: 'TWO knives' },
    { damage: 14, interval: 1.00, count: 2, arc: 0.20, speed: 580, pierce: 1, life: 1.3,
      note: 'they PIERCE, and fly faster' },
    { damage: 18, interval: 1.00, count: 3, arc: 0.30, speed: 600, pierce: 1, life: 1.4,
      note: 'THREE knives in a fan' },
    { damage: 24, interval: 0.86, count: 4, arc: 0.40, speed: 640, pierce: 2, life: 1.5,
      note: 'FOUR knives, pierce 2' },
    { damage: 31, interval: 0.86, count: 5, arc: 0.52, speed: 680, pierce: 2, life: 1.7,
      note: 'FIVE knives, and the fan opens up' },
    { damage: 40, interval: 0.70, count: 6, arc: 0.64, speed: 720, pierce: 3, life: 1.9,
      note: 'SIX knives, every 0.7s' },
    { damage: 52, interval: 0.58, count: 7, arc: 0.78, speed: 780, pierce: 4, life: 2.1,
      note: 'MAXED. A seven-knife wall, every 0.58s.' },
  ],
  evolution: {
    name: 'THOUSAND EDGES', icon: '🌪',
    visual: { shape: 'shard', color: '#ffd76a', accent: '#4a3200', size: 9, rotates: true, glow: true },
    desc: 'A continuous rotating storm — ten knives in every direction, ten times ' +
          'a second, and nothing stops any of them.',
    // Count matters more than rate here. A three-knife volley spread across a
    // full circle covers three rays; a tight seven-knife fan into a crowd covers
    // far more, which is how the first draft of this evolution came out WEAKER
    // than level 8. Ten rays plus unlimited pierce fixes the coverage.
    // It is a knife that does not stop at the first body. Ask for the upgrade
    // that says exactly that.
    requires: { upgrade: 'piercing_will', level: 3 },
    stats: { damage: 46, interval: 0.11, count: 10, arc: 6.283, speed: 820, pierce: 99, life: 1.2 },
  },
  codex: 'Counted them once. Gave up at four hundred. The count was not the point.',
};

const STORM_RING = {
  id: 'storm_ring', name: 'Storm Ring', icon: '⚡', kind: 'nova', tier: 'rare', weight: 60,
  desc: 'A shock that detonates around you. Big, loud, and it does not care where you are facing.',
  visual: { shape: 'ring', color: '#8ef0ff', accent: '#0b3b48', size: 26, glow: true },
  levels: [
    { damage: 16, interval: 3.2, radius: 92,  knockback: 120, note: 'a 92px shock, every 3.2s' },
    { damage: 22, interval: 3.2, radius: 108, knockback: 140, note: '+38% damage, 92 to 108px' },
    { damage: 29, interval: 2.9, radius: 122, knockback: 160, note: 'faster, and it reaches further' },
    { damage: 38, interval: 2.9, radius: 140, knockback: 180, note: '140px — it clears your whole ring' },
    { damage: 50, interval: 2.6, radius: 156, knockback: 210, note: 'every 2.6s, and it staggers' },
    { damage: 65, interval: 2.4, radius: 174, knockback: 240, note: '+30% damage, 156 to 174px' },
    { damage: 84, interval: 2.1, radius: 194, knockback: 270, note: 'every 2.1s at 194px' },
    { damage: 110, interval: 1.8, radius: 218, knockback: 310, note: 'MAXED. 218px, every 1.8s.' },
  ],
  evolution: {
    name: 'PERMASTORM', icon: '🌩',
    visual: { shape: 'ring', color: '#ffffff', accent: '#2a5a7a', size: 30, glow: true },
    desc: 'The storm stops arriving and simply stays. A standing 230px field burns ' +
          'everything inside it, and the shock still lands on top.',
    // PERMASTORM is the fantasy of being dangerous to stand next to, and
    // Vengeance is the upgrade that already sells that fantasy. Both of them pay
    // out for letting the crowd close, which no other pairing in this file does.
    requires: { upgrade: 'vengeance', level: 3 },
    stats: { damage: 96, interval: 0.9, radius: 230, knockback: 260, persist: true,
             fieldDps: 46, fieldRadius: 230 },
  },
  codex: 'Health and safety asked for the storm to be scheduled. The storm declined.',
};

const SPIRIT_BELL = {
  id: 'spirit_bell', name: 'Spirit Bell', icon: '🔔', kind: 'wave', tier: 'rare', weight: 60,
  desc: 'A ring of sound that damages and SLOWS everything it washes over. Crowd control that also kills.',
  visual: { shape: 'ring', color: '#c9a6ff', accent: '#2a1140', size: 22, glow: true },
  levels: [
    { damage: 10, interval: 2.6, radius: 110, count: 1, slow: 0.22, slowTime: 1.4,
      note: 'one ring, 110px, slows 22%' },
    { damage: 14, interval: 2.6, radius: 128, count: 1, slow: 0.26, slowTime: 1.6,
      note: '+40% damage, and a deeper slow' },
    { damage: 18, interval: 2.4, radius: 146, count: 2, slow: 0.30, slowTime: 1.8,
      note: 'TWO rings per toll' },
    { damage: 24, interval: 2.4, radius: 166, count: 2, slow: 0.34, slowTime: 2.0,
      note: '166px, slows 34%' },
    { damage: 31, interval: 2.2, radius: 186, count: 3, slow: 0.38, slowTime: 2.2,
      note: 'THREE rings, every 2.2s' },
    { damage: 40, interval: 2.0, radius: 208, count: 3, slow: 0.42, slowTime: 2.4,
      note: '+29% damage, 186 to 208px' },
    { damage: 52, interval: 1.8, radius: 232, count: 4, slow: 0.46, slowTime: 2.6,
      note: 'FOUR rings — almost nothing moves' },
    { damage: 68, interval: 1.6, radius: 258, count: 4, slow: 0.52, slowTime: 3.0,
      note: 'MAXED. Four 258px rings, 52% slow.' },
  ],
  evolution: {
    name: 'STANDING RESONANCE', icon: '📢',
    visual: { shape: 'ring', color: '#ffd0ff', accent: '#3a1a5a', size: 26, glow: true },
    desc: 'The bell never stops ringing. A permanent 270px field holds everything ' +
          'in place at half speed while ring after ring rolls out of you.',
    // The bell's whole argument is that nothing gets to touch you: it holds the
    // ones it catches, and Phantom Step covers the ones it does not.
    requires: { upgrade: 'phantom_step', level: 3 },
    stats: { damage: 58, interval: 0.55, radius: 270, count: 2, slow: 0.55, slowTime: 1.2,
             persist: true, fieldDps: 30, fieldRadius: 270 },
  },
  codex: 'Perfect pitch, allegedly. Nobody in range has been able to confirm it.',
};

const WISP_FLOCK = {
  id: 'wisp_flock', name: 'Wisp Flock', icon: '🔥', kind: 'homing', tier: 'rare', weight: 60,
  desc: 'Foxfire that hunts on its own and sets what it finds alight. You never have to aim it.',
  visual: { shape: 'circle', color: '#ff9a3d', accent: '#5a1500', size: 9, glow: true },
  levels: [
    { damage: 9,  interval: 1.9, count: 1, speed: 300, turnRate: 3.4, burn: 4,  burnTime: 2.0, life: 2.4,
      note: 'one wisp, burns for 2s' },
    { damage: 12, interval: 1.9, count: 2, speed: 310, turnRate: 3.6, burn: 5,  burnTime: 2.2, life: 2.5,
      note: 'TWO wisps' },
    { damage: 16, interval: 1.7, count: 2, speed: 330, turnRate: 4.0, burn: 7,  burnTime: 2.4, life: 2.6,
      note: 'they turn harder and burn hotter' },
    { damage: 21, interval: 1.7, count: 3, speed: 340, turnRate: 4.2, burn: 9,  burnTime: 2.6, life: 2.8,
      note: 'THREE wisps' },
    { damage: 27, interval: 1.5, count: 4, speed: 360, turnRate: 4.6, burn: 12, burnTime: 2.8, life: 3.0,
      note: 'FOUR wisps, every 1.5s' },
    { damage: 35, interval: 1.5, count: 5, speed: 380, turnRate: 5.0, burn: 15, burnTime: 3.0, life: 3.2,
      note: 'FIVE wisps, and the burn doubles' },
    { damage: 45, interval: 1.3, count: 6, speed: 400, turnRate: 5.4, burn: 19, burnTime: 3.2, life: 3.4,
      note: 'SIX wisps, every 1.3s' },
    { damage: 58, interval: 1.1, count: 7, speed: 430, turnRate: 6.0, burn: 24, burnTime: 3.6, life: 3.6,
      note: 'MAXED. Seven hunting wisps.' },
  ],
  evolution: {
    name: 'WILDFIRE', icon: '🦊',
    visual: { shape: 'circle', color: '#ffe14a', accent: '#7a2000', size: 11, glow: true },
    desc: 'The flock never thins. Wisps pour out continuously, each one hotter ' +
          'than the last thing it burned.',
    // You never aim this weapon — the wisps do the looking. Keen Eye is the
    // upgrade about noticing where a thing is weakest, which is the job you have
    // already handed over.
    requires: { upgrade: 'keen_eye', level: 3 },
    stats: { damage: 46, interval: 0.22, count: 3, speed: 470, turnRate: 7.0,
             burn: 26, burnTime: 4.0, life: 3.4 },
  },
  codex: 'They are not tame, they are not yours, and they have decided to help. Do not ask follow-up questions.',
};

const CHAIN_LASH = {
  id: 'chain_lash', name: 'Chain Lash', icon: '〰', kind: 'lash', tier: 'common', weight: 100,
  desc: 'Two long lashes, left and right. Reaches further than anything else you own.',
  visual: { shape: 'capsule', color: '#e8e8f0', accent: '#2a2a3a', size: 12, rotates: true },
  levels: [
    { damage: 13, interval: 1.5, radius: 130, arc: 0.55, count: 2, knockback: 100,
      note: 'two 130px lashes, every 1.5s' },
    { damage: 18, interval: 1.5, radius: 150, arc: 0.60, count: 2, knockback: 115,
      note: '+38% damage, 130 to 150px' },
    { damage: 23, interval: 1.3, radius: 172, arc: 0.66, count: 2, knockback: 130,
      note: 'faster, and the reach keeps growing' },
    { damage: 30, interval: 1.3, radius: 192, arc: 0.74, count: 3, knockback: 145,
      note: 'a THIRD lash, behind you' },
    { damage: 39, interval: 1.15, radius: 214, arc: 0.82, count: 3, knockback: 165,
      note: '214px, every 1.15s' },
    { damage: 50, interval: 1.15, radius: 238, arc: 0.90, count: 4, knockback: 185,
      note: 'FOUR lashes — all four directions' },
    { damage: 64, interval: 0.95, radius: 262, arc: 1.00, count: 4, knockback: 210,
      note: '262px, every 0.95s' },
    { damage: 82, interval: 0.80, radius: 290, arc: 1.10, count: 4, knockback: 240,
      note: 'MAXED. Four 290px lashes, every 0.8s.' },
  ],
  evolution: {
    name: 'ENDLESS LASH', icon: '⛓',
    visual: { shape: 'capsule', color: '#ffd76a', accent: '#3a2a00', size: 14, rotates: true, glow: true },
    desc: 'Six chains, whipping without pause at 330px. Nothing gets close enough to matter.',
    // The reach weapon asks for the reach upgrade. Shared with Idol Orbit: an
    // area build should get to finish both of the weapons it is actually about.
    requires: { upgrade: 'wide_reach', level: 3 },
    stats: { damage: 70, interval: 0.18, radius: 330, arc: 1.15, count: 6, knockback: 250 },
  },
  codex: 'Range is a defensive stat if you are honest about what you are doing with it.',
};

const METEOR_CALL = {
  id: 'meteor_call', name: 'Meteor Call', icon: '☄', kind: 'mortar', tier: 'epic', weight: 25,
  desc: 'Shells that fall on the thickest part of the crowd and detonate. Fire-and-forget crowd removal.',
  visual: { shape: 'circle', color: '#ff7a3d', accent: '#4a1500', size: 13, glow: true },
  levels: [
    { damage: 26, interval: 3.0, count: 1, blast: 78,  range: 420, note: 'one shell, 78px blast' },
    { damage: 34, interval: 3.0, count: 1, blast: 92,  range: 460, note: '+31% damage, bigger blast' },
    { damage: 44, interval: 2.7, count: 2, blast: 100, range: 500, note: 'TWO shells per call' },
    { damage: 57, interval: 2.7, count: 2, blast: 112, range: 540, note: '112px blasts, further out' },
    { damage: 73, interval: 2.4, count: 3, blast: 124, range: 580, note: 'THREE shells, every 2.4s' },
    { damage: 94, interval: 2.4, count: 3, blast: 138, range: 620, note: '+29% damage, 124 to 138px' },
    { damage: 120, interval: 2.1, count: 4, blast: 152, range: 660, note: 'FOUR shells, every 2.1s' },
    { damage: 155, interval: 1.8, count: 5, blast: 170, range: 700, note: 'MAXED. Five 170px blasts.' },
  ],
  evolution: {
    name: 'STARFALL', icon: '💫',
    visual: { shape: 'star', color: '#ffd76a', accent: '#5a1500', size: 15, glow: true },
    desc: 'The sky stops taking turns. Shells land continuously across the whole ' +
          'screen and each one leaves burning ground.',
    // Everything this weapon does happens somewhere else. Long Haul is the only
    // upgrade in the pool whose entire subject is how far away "somewhere else"
    // is allowed to be.
    requires: { upgrade: 'long_haul', level: 3 },
    stats: { damage: 130, interval: 0.30, count: 2, blast: 165, range: 760,
             fieldDps: 36, fieldTime: 2.4 },
  },
  codex: 'We filed for permission. The reply asked us to stop filing and start aiming.',
};

// ---------------------------------------------------------------------------
// THORN BED — the only weapon that remembers where you have been.
// ---------------------------------------------------------------------------
// Nothing else in the arsenal cares about your feet. This one lays living
// ground under them: keep walking and you leave a TRAIL of beds behind you that
// keeps killing after you have gone; stand still and the bed you are standing on
// SPREADS instead, one ring wider every time it comes round.
//
// `count` is not projectiles here — it is how many times a single bed may
// thicken before it stops. That is the whole levelling curve: how much a patch
// of ground is worth for standing on it.
const THORN_BED = {
  id: 'thorn_bed', name: 'Thorn Bed', icon: '🌿', kind: 'bloom', tier: 'common', weight: 100,
  desc: 'Living ground grows under you. Walk and you leave a killing trail behind; ' +
        'stand still and the patch you are on spreads wider every second.',
  visual: { shape: 'diamond', color: '#7bf59a', accent: '#0f3a22', size: 10, rotates: true, glow: true },
  levels: [
    { damage: 7,  interval: 0.95, radius: 46,  duration: 2.0, count: 2,
      note: 'a 46px bed, twice a second, lasting 2s' },
    { damage: 10, interval: 0.95, radius: 52,  duration: 2.2, count: 2,
      note: '+43% damage, and the beds last longer' },
    { damage: 13, interval: 0.85, radius: 58,  duration: 2.6, count: 3,
      note: 'a standing bed thickens THREE times now' },
    { damage: 17, interval: 0.85, radius: 66,  duration: 3.0, count: 3,
      note: '66px, and the trail lingers for 3s' },
    { damage: 22, interval: 0.76, radius: 74,  duration: 3.4, count: 4,
      note: 'grows FOUR rings deep, every 0.76s' },
    { damage: 29, interval: 0.76, radius: 83,  duration: 3.9, count: 5,
      note: 'FIVE rings — standing still is a build' },
    { damage: 38, interval: 0.66, radius: 93,  duration: 4.5, count: 6,
      note: 'SIX rings, 93px, and 4.5s of trail' },
    { damage: 50, interval: 0.56, radius: 105, duration: 5.2, count: 7,
      note: 'MAXED. 105px beds, 7 rings, 5.2s each.' },
  ],
  evolution: {
    name: 'OVERGROWTH', icon: '🌾',
    visual: { shape: 'star', color: '#ffe14a', accent: '#3a3a00', size: 12, rotates: true, glow: true },
    desc: 'The ground never stops. Beds go down four times a second and a living ' +
          'seam runs under your feet between them, so there is no gap left to walk through.',
    // The only weapon whose output is a function of where your feet have been.
    // Swift Boots is the upgrade that changes where your feet have been.
    requires: { upgrade: 'swift_boots', level: 3 },
    stats: { damage: 44, interval: 0.30, radius: 118, duration: 5.0, count: 10, persist: true },
  },
  codex: 'Groundskeeping filed a complaint. The ground filed one back.',
};

// ---------------------------------------------------------------------------
// ARC CONDUIT — the only weapon that is worth MORE the more of them there are.
// ---------------------------------------------------------------------------
// Every other weapon divides its attention across a crowd. This one multiplies
// through it: the bolt hops from body to body and each hop lands HARDER than the
// last, so the eleventh link of a maxed chain hits for six times the first.
// A lone target is the worst case for it, which is exactly the shape no other
// weapon in the arsenal has.
const ARC_CONDUIT = {
  id: 'arc_conduit', name: 'Arc Conduit', icon: '🔗', kind: 'chain', tier: 'rare', weight: 60,
  desc: 'A bolt that hops from enemy to enemy and hits HARDER on every jump. ' +
        'Worthless on one target, devastating in a pack.',
  visual: { shape: 'shard', color: '#6ad8ff', accent: '#062f42', size: 9, rotates: true, glow: true },
  levels: [
    { damage: 12, interval: 1.60, count: 2,  radius: 150, range: 380, gain: 0.30, knockback: 20,
      note: '2 jumps, each +30% on the last' },
    { damage: 16, interval: 1.60, count: 3,  radius: 160, range: 400, gain: 0.30, knockback: 25,
      note: 'a THIRD jump, so the tail hits 1.9x' },
    { damage: 21, interval: 1.42, count: 3,  radius: 175, range: 430, gain: 0.36, knockback: 30,
      note: 'jumps reach further and gain +36%' },
    { damage: 27, interval: 1.42, count: 4,  radius: 190, range: 470, gain: 0.36, knockback: 35,
      note: 'a FOURTH jump' },
    { damage: 35, interval: 1.26, count: 5,  radius: 205, range: 510, gain: 0.42, knockback: 40,
      note: 'FIVE jumps, +42% each — the tail hits 3x' },
    { damage: 45, interval: 1.26, count: 6,  radius: 225, range: 560, gain: 0.48, knockback: 46,
      note: 'SIX jumps, and the gain climbs again' },
    { damage: 58, interval: 1.10, count: 8,  radius: 245, range: 610, gain: 0.54, knockback: 52,
      note: 'EIGHT jumps, every 1.1s' },
    { damage: 75, interval: 0.94, count: 10, radius: 270, range: 670, gain: 0.62, knockback: 60,
      note: 'MAXED. 10 jumps; the last one hits 6.2x.' },
  ],
  evolution: {
    name: 'LIVE WIRE', icon: '⛓',
    visual: { shape: 'shard', color: '#ffffff', accent: '#2a5a7a', size: 11, rotates: true, glow: true },
    // `loop` is the mechanical half of the evolution and the reason it beats the
    // maxed form even against a single enemy: when the wire runs out of fresh
    // bodies it doubles back onto one it has already burned rather than
    // grounding out, so the escalation never stops at the edge of the pack.
    desc: 'The wire refuses to ground out. Fourteen jumps, three times a second, ' +
          'and when it runs out of new bodies it doubles back onto the ones it has.',
    // This is the escalation weapon: the tail of the chain hits for six times
    // the head. Killing Blow is the escalation upgrade — the one that is
    // worthless on its own and enormous on top of something that already multiplies.
    requires: { upgrade: 'killing_blow', level: 3 },
    stats: { damage: 62, interval: 0.30, count: 14, radius: 300, range: 780, gain: 0.50,
             knockback: 70, loop: true },
  },
  codex: 'The safety briefing said do not stand next to each other. Nobody stands next to each other any more.',
};

// ---------------------------------------------------------------------------
// POD VOLLEY — the only weapon whose projectiles have children.
// ---------------------------------------------------------------------------
// Everything else in the arsenal ends when its shape ends. A pod drifts, slows,
// and BURSTS: the fuse is the weapon, not the flight. Levelling it buys shards,
// not reach — which means it gets better in exactly the situation a spread gets
// worse, i.e. surrounded.
const POD_VOLLEY = {
  id: 'pod_volley', name: 'Pod Volley', icon: '🌰', kind: 'shrapnel', tier: 'rare', weight: 60,
  desc: 'Seed pods drift out, slow to a stop and BURST into shards in every ' +
        'direction. The fuse is the weapon — every level buys more shrapnel.',
  visual: { shape: 'circle', color: '#ffb03d', accent: '#3a2000', size: 10, glow: true },
  levels: [
    { damage: 10, interval: 1.70, count: 2, shards: 3,  speed: 300, fuse: 0.60, blast: 40, pierce: 3,
      note: '2 pods, 3 shards each, every 1.7s' },
    { damage: 13, interval: 1.70, count: 2, shards: 4,  speed: 320, fuse: 0.58, blast: 46, pierce: 3,
      note: 'FOUR shards per pod, and a bigger burst' },
    { damage: 17, interval: 1.52, count: 3, shards: 4,  speed: 340, fuse: 0.56, blast: 52, pierce: 4,
      note: 'a THIRD pod, thrown further' },
    { damage: 22, interval: 1.52, count: 3, shards: 5,  speed: 360, fuse: 0.54, blast: 60, pierce: 4,
      note: 'FIVE shards, and a shorter fuse' },
    { damage: 29, interval: 1.36, count: 4, shards: 6,  speed: 385, fuse: 0.52, blast: 68, pierce: 5,
      note: 'FOUR pods, SIX shards — 24 fragments' },
    { damage: 37, interval: 1.36, count: 5, shards: 7,  speed: 410, fuse: 0.50, blast: 78, pierce: 6,
      note: 'FIVE pods, and the pods pierce more' },
    { damage: 48, interval: 1.18, count: 6, shards: 8,  speed: 440, fuse: 0.48, blast: 88, pierce: 7,
      note: 'SIX pods, EIGHT shards, every 1.18s' },
    { damage: 62, interval: 1.00, count: 7, shards: 10, speed: 470, fuse: 0.46, blast: 100, pierce: 9,
      note: 'MAXED. 7 pods, 70 shards, every second.' },
  ],
  evolution: {
    name: 'SEED STORM', icon: '💥',
    visual: { shape: 'star', color: '#ffd94a', accent: '#4a3200', size: 12, rotates: true, glow: true },
    // `ring` turns the aimed volley into a rotating full circle. A pod volley is
    // the one shape where "aim it at the crowd" is actively wrong once the shard
    // count is high — the shards go everywhere anyway, so the pods should too.
    desc: 'Pods pour out in every direction three times a second, pass through ' +
          'anything, and each one comes apart into twelve shards.',
    // TWO levels, not three, and that is the rule rather than a favour: Extra
    // Shot only has four levels in it at all, so min(3, ceil(4/2)) is 2. It is
    // the one upgrade that literally adds a projectile to the one weapon whose
    // projectiles have children.
    requires: { upgrade: 'extra_shot', level: 2 },
    stats: { damage: 52, interval: 0.34, count: 4, shards: 12, speed: 520, fuse: 0.42,
             blast: 118, pierce: 99, ring: true },
  },
  codex: 'Botany insists these are seeds. Botany has been asked to leave the range.',
};

// ---------------------------------------------------------------------------
// RETURN CUT — the only weapon with two damage windows per activation.
// ---------------------------------------------------------------------------
// The throw is the small half. The disc cuts on the way out, turns, cuts
// everything again on the way home for nearly double, and detonates when it
// reaches you — so the good position for this weapon is "crowd BETWEEN me and
// where I threw it", which is the opposite of every other ranged weapon here.
const RETURN_CUT = {
  id: 'return_cut', name: 'Return Cut', icon: '⟲', kind: 'boomerang', tier: 'common', weight: 100,
  desc: 'A disc that cuts on the way out and cuts harder on the way back, then ' +
        'detonates when you catch it. The catch is the bigger half.',
  visual: { shape: 'crescent', color: '#9fd3ff', accent: '#123a5c', size: 13, rotates: true, glow: true },
  levels: [
    { damage: 9,  interval: 1.45, count: 1, speed: 430, radius: 200, pierce: 2, blast: 30,
      arc: 0.30, knockback: 40, returnMult: 1.25,
      note: 'one disc, 200px out, catch hits 1.25x' },
    { damage: 12, interval: 1.45, count: 1, speed: 450, radius: 225, pierce: 3, blast: 34,
      arc: 0.34, knockback: 48, returnMult: 1.32,
      note: '+33% damage, and it throws further' },
    { damage: 16, interval: 1.30, count: 2, speed: 470, radius: 250, pierce: 3, blast: 39,
      arc: 0.40, knockback: 56, returnMult: 1.38,
      note: 'a SECOND disc, on a wider throw' },
    { damage: 21, interval: 1.30, count: 2, speed: 495, radius: 278, pierce: 4, blast: 45,
      arc: 0.46, knockback: 64, returnMult: 1.45,
      note: 'the catch detonation reaches 45px' },
    { damage: 27, interval: 1.16, count: 3, speed: 520, radius: 308, pierce: 5, blast: 52,
      arc: 0.55, knockback: 74, returnMult: 1.52,
      note: 'THREE discs, every 1.16s' },
    { damage: 35, interval: 1.16, count: 3, speed: 550, radius: 340, pierce: 6, blast: 60,
      arc: 0.64, knockback: 86, returnMult: 1.60,
      note: '340px out, and the catch hits 1.6x' },
    { damage: 45, interval: 1.00, count: 4, speed: 585, radius: 375, pierce: 7, blast: 69,
      arc: 0.74, knockback: 98, returnMult: 1.68,
      note: 'FOUR discs, every second' },
    { damage: 58, interval: 0.85, count: 5, speed: 620, radius: 415, pierce: 9, blast: 80,
      arc: 0.86, knockback: 112, returnMult: 1.78,
      note: 'MAXED. Five discs, 415px, catch at 1.78x.' },
  ],
  evolution: {
    name: 'ETERNAL RETURN', icon: '♾',
    visual: { shape: 'crescent', color: '#ff2d95', accent: '#4a0022', size: 16, rotates: true, glow: true },
    desc: 'Three discs leave you four times a second, pass through everything ' +
          'and are already coming back. Nothing survives being passed twice.',
    // KNOCKBACK GOES DOWN, and it is the only stat here that does. A disc that
    // throws what it touches is fine at one volley a second and actively
    // self-defeating at four: the first pass shoves the crowd out of the lane
    // the next three passes were going to use. The balance harness had this
    // evolution at 82% of its own level 8 until the shove came off it — an
    // evolution that scatters its own targets is a downgrade wearing gold.
    // The disc has to make the whole trip or the catch — the bigger half —
    // never happens. Long Haul is the throw, and it is the same upgrade Meteor
    // Call asks for: both weapons are about the distance between you and it.
    requires: { upgrade: 'long_haul', level: 3 },
    stats: { damage: 60, interval: 0.24, count: 3, speed: 700, radius: 460, pierce: 99, blast: 100,
             arc: 1.10, knockback: 40, returnMult: 2.05 },
  },
  codex: 'Throwing it is the easy part. Everyone learns that once.',
};

// ---------------------------------------------------------------------------
// DYNAMO CORE — the only weapon your OTHER weapons level up.
// ---------------------------------------------------------------------------
// The taps are almost decoration: small, constant, close range. What they really
// do is fill a meter — and so does every kill anywhere in the run, from any
// source. When the meter fills the core dumps everything at once. It is the one
// weapon whose damage output you cannot read off its own stat block, because
// half of it is a function of what the REST of the build is doing.
//
// `charge` is the cost, so it goes DOWN with level while everything else goes
// up: a maxed core needs a third fewer hits to pay out than a fresh one.
const DYNAMO_CORE = {
  id: 'dynamo_core', name: 'Dynamo Core', icon: '🔋', kind: 'siphon', tier: 'epic', weight: 25,
  desc: 'A close-range hum that charges off every hit you land and every kill ' +
        'anything in your build makes. When the meter fills, it all comes out at once.',
  visual: { shape: 'hex', color: '#ffd94a', accent: '#4a3200', size: 11, glow: true },
  levels: [
    { damage: 6,  interval: 0.55, radius: 100, charge: 46, blast: 150, surge: 60,  count: 3,
      note: 'a 100px hum; 46 charge pays 60' },
    { damage: 8,  interval: 0.55, radius: 112, charge: 44, blast: 165, surge: 84,  count: 3,
      note: '+33% hum, and the surge pays 84' },
    { damage: 11, interval: 0.50, radius: 124, charge: 42, blast: 182, surge: 115, count: 4,
      note: 'a FOURTH arc off the discharge' },
    { damage: 14, interval: 0.50, radius: 137, charge: 39, blast: 200, surge: 155, count: 4,
      note: 'fills sooner, and pays 155' },
    { damage: 18, interval: 0.45, radius: 152, charge: 36, blast: 220, surge: 205, count: 5,
      note: 'FIVE arcs, 220px discharge' },
    { damage: 23, interval: 0.45, radius: 168, charge: 33, blast: 242, surge: 270, count: 6,
      note: 'SIX arcs, and the meter is a third cheaper' },
    { damage: 30, interval: 0.40, radius: 186, charge: 30, blast: 266, surge: 355, count: 7,
      note: 'SEVEN arcs, humming every 0.4s' },
    { damage: 39, interval: 0.34, radius: 205, charge: 27, blast: 292, surge: 465, count: 8,
      note: 'MAXED. 27 charge buys a 465 discharge.' },
  ],
  evolution: {
    name: 'OVERLOAD', icon: '💢',
    visual: { shape: 'hex', color: '#fff3b0', accent: '#5a4a00', size: 14, glow: true },
    // `persist` is where the meter stops being invisible: the standing field's
    // radius and damage both read the LIVE charge, so a nearly-full core is
    // something you can see burning around you before it goes off.
    desc: 'The core never empties all the way. It hums as a standing field that ' +
          'burns harder the fuller it gets, then dumps the whole bank at once — ' +
          'up to four charges in a single 340px discharge with twelve arcs off it.',
    // The meter is fed by kills, from any source, anywhere in the run.
    // Bloodthirst is the other thing in the game that pays you per body rather
    // than per hit, and a build that wants one wants the other.
    requires: { upgrade: 'bloodthirst', level: 3 },
    // WHY THE HUM IS SLOWER THAN IT USED TO BE, AND HITS FOR MORE.
    //
    // This row read `damage: 34, interval: 0.16, charge: 20` and was reported
    // from play as "laggy ... too many visual problems ... shakes the screen too
    // much and is overall too annoying to use". That was not a rendering
    // problem, it was arithmetic: a 240px hum ticking 6.25 times a second banks
    // one point of charge per enemy it touches, so in any real crowd it cleared
    // a 20-point meter EVERY SINGLE TICK. Six full discharges a second — six
    // novas, seventy-five arc beams, six explosion samples and six
    // `shake.medium()` calls per second against a trauma decay of 1.02/s, which
    // pins the shake at maximum and simply leaves it there.
    //
    // 0.28 and 58 is the same DPS out of half as many ticks (34/0.16 = 212.5,
    // 58/0.28 = 207) and therefore half as many area scans, half as many damage
    // numbers and half as many charge events. `charge` halves with it, 20 -> 12,
    // so the meter still fills at the rate it always did. The impl then does the
    // rest: it will not pay out more than twice a second, and it pays whatever
    // it banked in the meantime out in ONE lump instead of four small ones.
    // Measured over the 6s/26-enemy harness case, total damage moved 620k -> 667k
    // while the discharge count went 37 -> 10. A nerf to noise, not to damage.
    stats: { damage: 58, interval: 0.28, radius: 240, charge: 12, blast: 340, surge: 540,
             count: 12, persist: true },
  },
  codex: 'It is not a battery. It is an opinion about where the energy should go.',
};

// ---------------------------------------------------------------------------
// HOLLOW STAR — the only weapon that MOVES the enemies before it hits them.
// ---------------------------------------------------------------------------
// Two stages, always: the star goes down and drags everything within reach into
// one heap, and then, a beat later, the heap is not there any more. Everything
// else in the arsenal takes the battlefield as it finds it. This one rearranges
// it first, which is why its collapse radius can be smaller than its pull radius
// and still hit more things.
const HOLLOW_STAR = {
  id: 'hollow_star', name: 'Hollow Star', icon: '🌑', kind: 'singularity', tier: 'epic', weight: 25,
  desc: 'A well opens in the crowd and drags everything nearby into one heap, ' +
        'then collapses on it. It rearranges the fight before it hits it.',
  visual: { shape: 'circle', color: '#c58cff', accent: '#25074a', size: 12, glow: true },
  levels: [
    { damage: 30,  interval: 3.40, radius: 120, duration: 0.90, blast: 110, count: 1,
      range: 320, pull: 140, knockback: 80,
      note: 'one well, 120px pull, collapses in 0.9s' },
    { damage: 40,  interval: 3.40, radius: 135, duration: 0.95, blast: 124, count: 1,
      range: 350, pull: 155, knockback: 95,
      note: '+33% damage, and it pulls harder' },
    { damage: 53,  interval: 3.10, radius: 150, duration: 1.00, blast: 138, count: 1,
      range: 385, pull: 170, knockback: 110,
      note: 'reaches further out, every 3.1s' },
    { damage: 69,  interval: 3.10, radius: 166, duration: 1.05, blast: 154, count: 2,
      range: 420, pull: 190, knockback: 125,
      note: 'a SECOND well, on the same cast' },
    { damage: 90,  interval: 2.80, radius: 184, duration: 1.10, blast: 172, count: 2,
      range: 460, pull: 210, knockback: 145,
      note: '184px pull, 172px collapse' },
    { damage: 116, interval: 2.80, radius: 203, duration: 1.15, blast: 191, count: 2,
      range: 505, pull: 235, knockback: 165,
      note: '+29% damage, and the drag is brutal' },
    { damage: 150, interval: 2.50, radius: 224, duration: 1.20, blast: 212, count: 3,
      range: 555, pull: 260, knockback: 190,
      note: 'THREE wells, every 2.5s' },
    { damage: 195, interval: 2.15, radius: 248, duration: 1.25, blast: 236, count: 3,
      range: 610, pull: 290, knockback: 220,
      note: 'MAXED. Three 248px wells, 236px collapse.' },
  ],
  evolution: {
    name: 'EVENT HORIZON', icon: '⚫',
    visual: { shape: 'ring', color: '#8b5cf6', accent: '#1a0a3a', size: 26, glow: true },
    // The drag is anchored on the PLAYER, and that is a real cost, not a
    // flourish: everything in the run is now walking toward you faster than it
    // chose to. The weapon that rearranges the fight starts rearranging it
    // around your own body.
    desc: 'Wells collapse every 0.7s — and the pull never lets up, anchored on ' +
          'YOU. Everything comes to you now, which is the deal you just took.',
    // EVENT HORIZON drags the whole fight onto your body. Lodestone is the other
    // upgrade in the game whose entire effect is "things come to you", and it is
    // the one that turns the drag from a cost into a harvest.
    requires: { upgrade: 'lodestone', level: 3 },
    stats: { damage: 168, interval: 0.70, radius: 270, duration: 0.55, blast: 260, count: 2,
             range: 690, pull: 340, knockback: 250, persist: true,
             dragRadius: 300, dragForce: 135 },
  },
  codex: 'Nothing in there is hollow. That is simply the shape the outside makes.',
};

export const WEAPONS = [
  BLADE_ARC, IDOL_ORBIT, KUNAI_FAN, STORM_RING,
  SPIRIT_BELL, WISP_FLOCK, CHAIN_LASH, METEOR_CALL,
  THORN_BED, ARC_CONDUIT, POD_VOLLEY, RETURN_CUT, DYNAMO_CORE, HOLLOW_STAR,
];

export const WEAPONS_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

/** Asserted in tests/weapons.js: every weapon carries exactly eight levels. */
export const TOTAL_WEAPON_LEVELS = WEAPONS.length * 8;

/**
 * Every visual this file declares, for the boot-time pre-raster.
 *
 * A weapon's effect descriptor MUST be baked at boot like everything else — the
 * first time a new weapon fires is exactly the moment you cannot afford to
 * rasterise 32 rotation steps.
 */
export function weaponVisuals() {
  const out = [];
  for (const w of WEAPONS) {
    if (w.visual) out.push(w.visual);
    // The evolved descriptor is a SEPARATE atlas entry, and the moment it is
    // first needed is the moment a player just evolved something — the single
    // worst frame in the run to rasterise 32 rotation steps on.
    if (w.evolution && w.evolution.visual) out.push(w.evolution.visual);
  }
  return out;
}
