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
// THE SLOT CAP IS THE DESIGN. Three weapons, no more. Without a cap the answer
// to every offer is "yes" and every run converges on the same nine weapons; with
// one, taking a weapon is a decision you have to defend for the rest of the run.
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
//   evolution       { name, icon, desc, stats } — the always-on form. Its stats
//                   row is absolute too and always carries a very short
//                   interval, plus `persist` where the weapon becomes a standing
//                   effect rather than a repeated one.
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

/** Hard cap. The signature weapon occupies one of these. */
export const WEAPON_SLOTS = 3;

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
  stats: { damage: 3.40, rate: 3.20, area: 1.90, count: 3, pierce: 3, persist: true,
           auraRadius: 110, auraDps: 0.55 },
};

// ---------------------------------------------------------------------------
// THE EIGHT PICKABLE WEAPONS
// ---------------------------------------------------------------------------

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
    desc: 'The swing never stops. A full 360 degree blade sweeps around you ' +
          'continuously at 190px, and anything it touches is thrown.',
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
    desc: 'Twelve shards on two counter-rotating rings. They never come down, ' +
          'they never stop turning, and each one passes through everything.',
    // Radius stays close to the maxed 118 rather than pushing further out: a
    // wider single ring passes OVER whatever is standing on you, which is how
    // the first draft of this evolution managed to be weaker than the level it
    // evolved from. The balance harness caught it; the fix is coverage, not
    // damage.
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
    desc: 'A continuous rotating storm — ten knives in every direction, ten times ' +
          'a second, and nothing stops any of them.',
    // Count matters more than rate here. A three-knife volley spread across a
    // full circle covers three rays; a tight seven-knife fan into a crowd covers
    // far more, which is how the first draft of this evolution came out WEAKER
    // than level 8. Ten rays plus unlimited pierce fixes the coverage.
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
    desc: 'The storm stops arriving and simply stays. A standing 230px field burns ' +
          'everything inside it, and the shock still lands on top.',
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
    desc: 'The bell never stops ringing. A permanent 270px field holds everything ' +
          'in place at half speed while ring after ring rolls out of you.',
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
    desc: 'The flock never thins. Wisps pour out continuously, each one hotter ' +
          'than the last thing it burned.',
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
    desc: 'Six chains, whipping without pause at 330px. Nothing gets close enough to matter.',
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
    desc: 'The sky stops taking turns. Shells land continuously across the whole ' +
          'screen and each one leaves burning ground.',
    stats: { damage: 130, interval: 0.30, count: 2, blast: 165, range: 760,
             fieldDps: 36, fieldTime: 2.4 },
  },
  codex: 'We filed for permission. The reply asked us to stop filing and start aiming.',
};

export const WEAPONS = [
  BLADE_ARC, IDOL_ORBIT, KUNAI_FAN, STORM_RING,
  SPIRIT_BELL, WISP_FLOCK, CHAIN_LASH, METEOR_CALL,
];

export const WEAPONS_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

/** Asserted in tests/weapons.js: eight weapons, eight levels each. */
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
  for (const w of WEAPONS) if (w.visual) out.push(w.visual);
  return out;
}
