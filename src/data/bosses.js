// =============================================================================
// bosses.js — 7 stage bosses, 7 mid-bosses, 7 named elites, 1 sweeper.
// Plain data. No functions, no logic, no imports.
// =============================================================================
//
// WHAT A BOSS OWES THE PLAYER (SECTION 9, "--- BOSSES ---"):
//   - a health bar with NAMED phases
//   - at least 3 distinct attacks
//   - a 0.8-1.2s telegraph on everything lethal
//   - an intro card: name + epithet + a one-line quote
//   - a death animation with slow-mo
//   - a guaranteed drop of 1 relic + 1 chest + Star Fragments
//   - NO CONTACT DAMAGE. Bosses hurt you with attacks you can read. That single
//     rule is the whole difference between "hard" and "unfair".
//
// TELEGRAPH LANGUAGE (consistent across the entire game):
//   red    = damage zone, get out          yellow = wind-up, it comes from here
//   blue   = safe zone, stand here         white  = unavoidable, ESCAPE NOW
// Every colour is paired with a SHAPE (TELEGRAPH_SHAPES) so nothing is conveyed
// by colour alone — SECTION 13 accessibility, and it is not optional.
//
// HP LADDER. Boss HP scales geometrically with stage index (~1.57x per stage)
// from 2,500 to 38,000, which holds the SECTION 14 target of a 25-50s TTK for an
// average build as player power compounds across the campaign:
//   S1 2,500  S2 4,000  S3 6,300  S4 9,800  S5 15,200  S6 24,000  S7 38,000
// Mid-bosses sit at ~42% of their stage boss. Named elites at ~15%.
// Implied single-target DPS to hit a 40s kill: 63 (S1) rising to 950 (S7).
//
// STAR FRAGMENT AWARDS are fixed by DECISIONS.md §1 and are not tunable here:
// final boss 20, mid-boss 10. Named elites award 0 (they pay in chests) so the
// Stage 7 "Grand Finale" modifier — which respawns old bosses as elites every
// 5 minutes — cannot print currency. Each boss carries an `asElite` block that
// states exactly what it becomes in that mode.
//
// SCHEMA EXTENSIONS used below, beyond the base fields:
//   telegraphFloor  Enrage may shorten cooldowns but never pushes a telegraph
//                   under this. 0.8s is the spec's floor and it is load-bearing.
//   safeColor       On an attack that leaves a gap or a safe island, the colour
//                   the safe geometry is painted (always 'blue').
//   parts[]         Independently destructible pieces with their own HP bars.
//   mechanic        An encounter rule that is not an attack (twin revive, the
//                   unkillable sweeper, the three-mid-boss opener).
//   stances[]       Kagutsuchi only — movesets cycled on a timer, orthogonal to
//                   the HP phases.
//   death           Slow-mo parameters for the mandated death animation.
//   asElite         What this boss becomes when re-spawned as a Stage 7 elite.
//   behavior/affixes Elites and the sweeper only; bosses are script-driven.
//
// Per DECISIONS.md §22 this file contains no source-attribution fields of any
// kind. Those live in exactly one file and are keyed by the ids used here.
// =============================================================================

export const TELEGRAPH_COLORS = {
  red: '#ff3a5e',
  yellow: '#ffd23f',
  blue: '#4fc3ff',
  white: '#ffffff',
};

// Colour is never the only channel. Every telegraph also draws this glyph.
export const TELEGRAPH_SHAPES = {
  red: 'x',
  yellow: 'arrow',
  blue: 'circle',
  white: 'bang',
};

// The complete set the engine implements. Exported so tests can assert that no
// entry below invents a kind the renderer and the attack runner cannot serve.
export const ATTACK_KINDS = [
  'lineSweep', 'radialBurst', 'homingProjectile', 'groundSlam', 'chargeDash',
  'summonAdds', 'aoeCircle', 'coneBreath', 'beamContinuous', 'shrinkingRing',
  'rotatingSweep', 'grabQte', 'projectileSpread', 'mirrorPlayer', 'tentacleSlam',
  'steamVent', 'tailSweep', 'drumRotate', 'spawnHazard', 'shieldPhase',
  'weakPoint',
];

// -----------------------------------------------------------------------------
// STAGE 1 BOSS — CHERRY BLOSSOM ACADEMY
// -----------------------------------------------------------------------------
const STUDENT_COUNCIL_PRESIDENT = {
  id: 'student_council_president',
  name: 'THE STUDENT COUNCIL PRESIDENT',
  epithet: 'Attendance Is Mandatory',
  kind: 'boss',
  stage: 'cherry_academy',
  quote: '"You are four minutes late. I have prepared a form for that."',
  hp: 2500, damage: 0, speed: 40, weight: 99, xp: 300, size: 'large',
  element: 'light',
  contactDamage: false,
  telegraphFloor: 0.8,
  visual: {
    shape: 'star', color: '#ffb3d1', accent: '#3b1526', size: 84,
    emoji: '📋', outline: true, rotates: false, glow: true,
  },
  reward: { starFragments: 20, relic: true, chest: 'gold' },
  death: { slowMoScale: 0.25, slowMoDuration: 1.4, shake: 'big' },
  asElite: { hpMult: 0.35, reward: { starFragments: 0, relic: false, chest: 'silver' } },
  barks: {
    intro: 'Rooftop access requires a signed permission slip.',
    phase2: 'Committee! Formation three!',
    phase3: 'DETENTION. ALL OF YOU. INDEFINITELY.',
    death: 'Fine. Fine! I will... amend the schedule.',
  },
  phases: [
    { name: 'Paperwork', hpFrom: 1.0, hpTo: 0.66, speedMult: 1.0,
      attacks: ['paperwork_barrage', 'chalk_cleave'] },
    { name: 'The Disciplinary Committee', hpFrom: 0.66, hpTo: 0.33, speedMult: 1.05,
      attacks: ['paperwork_barrage', 'chalk_cleave', 'committee_summon'] },
    { name: 'DETENTION', hpFrom: 0.33, hpTo: 0.0, speedMult: 1.25, enrage: true,
      attacks: ['paperwork_barrage', 'roll_call_sweep', 'red_tape_ring', 'committee_summon'] },
  ],
  attacks: {
    paperwork_barrage: {
      name: 'Paperwork Barrage', kind: 'homingProjectile', telegraph: 0.9,
      telegraphColor: 'yellow', cooldown: 5.0, damage: 14,
      params: { count: 8, speed: 165, turnRate: 1.3, life: 5.5, spread: 1.4 },
      desc: 'Eight forms, in triplicate. They already know your name.',
    },
    chalk_cleave: {
      name: 'Blackboard Cleave', kind: 'lineSweep', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 7, damage: 22,
      params: { columns: 1, width: 150, sweepSpeed: 430, axis: 'horizontal' },
      desc: 'One chalk-dust guillotine wipes the roof clean, left to right.',
    },
    committee_summon: {
      name: 'The Disciplinary Committee', kind: 'summonAdds', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 14, damage: 0,
      params: {
        spawns: [{ enemy: 'mob_student', count: 10 }, { enemy: 'cursed_desk', count: 3 }],
        radius: 260, pattern: 'ring',
      },
      desc: 'Ten students and three desks file in. Attendance is, of course, perfect.',
    },
    roll_call_sweep: {
      name: 'Roll Call', kind: 'rotatingSweep', telegraph: 1.0,
      telegraphColor: 'yellow', cooldown: 9, damage: 26,
      params: { arms: 2, length: 520, angularSpeed: 1.5, duration: 5, width: 70 },
      desc: 'Two clipboard beams sweep at 86 deg/s. Walk with them, not against them.',
    },
    red_tape_ring: {
      name: 'Red Tape', kind: 'shrinkingRing', telegraph: 1.2,
      telegraphColor: 'red', safeColor: 'blue', cooldown: 18, damage: 34,
      params: {
        startRadius: 620, endRadius: 190, closeTime: 6, gapCount: 1, gapArc: 0.55,
        tickDamage: 34, tickRate: 0.5,
      },
      desc: 'Tape closes from 620px to 190px over 6s. Exactly one gap. Find it.',
    },
  },
};

// -----------------------------------------------------------------------------
// STAGE 2 BOSS — NEON AKIBA DISTRICT
// -----------------------------------------------------------------------------
const THE_ALGORITHM = {
  id: 'the_algorithm',
  name: 'THE ALGORITHM',
  epithet: 'It Knows What You Want',
  kind: 'boss',
  stage: 'neon_akiba',
  quote: '"Users who died to this also died to..."',
  hp: 4000, damage: 0, speed: 34, weight: 99, xp: 400, size: 'large',
  element: 'lightning',
  contactDamage: false,
  telegraphFloor: 0.8,
  visual: {
    shape: 'hex', color: '#ff2d95', accent: '#2a0a1e', size: 96,
    emoji: '👁', outline: true, rotates: false, glow: true,
  },
  reward: { starFragments: 20, relic: true, chest: 'gold' },
  death: { slowMoScale: 0.25, slowMoDuration: 1.4, shake: 'big' },
  asElite: { hpMult: 0.35, reward: { starFragments: 0, relic: false, chest: 'silver' } },
  barks: {
    intro: 'Based on your recent activity, we think you will love dying here.',
    phase2: 'Because you watched: everything.',
    phase3: 'ENGAGEMENT IS UP. ENGAGEMENT IS UP. ENGAGEMENT IS UP.',
    death: 'Recommendation... withdrawn.',
  },
  phases: [
    { name: 'Infinite Scroll', hpFrom: 1.0, hpTo: 0.66, speedMult: 1.0,
      attacks: ['scroll_lasers', 'subscribe_popups'] },
    { name: 'Recommended For You', hpFrom: 0.66, hpTo: 0.33, speedMult: 1.0,
      attacks: ['scroll_lasers', 'subscribe_popups', 'mirror_build'] },
    { name: 'ENGAGEMENT', hpFrom: 0.33, hpTo: 0.0, speedMult: 1.3, enrage: true,
      attacks: ['scroll_lasers', 'subscribe_popups', 'mirror_build', 'feed_collapse'] },
  ],
  attacks: {
    scroll_lasers: {
      name: 'Infinite Scroll', kind: 'lineSweep', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 6, damage: 38,
      params: { columns: 4, width: 110, sweepSpeed: 520, axis: 'vertical' },
      desc: 'Four columns of feed sweep down the arena.',
    },
    subscribe_popups: {
      name: 'SUBSCRIBE', kind: 'homingProjectile', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 4.5, damage: 26,
      params: { count: 6, speed: 190, turnRate: 1.6, life: 6 },
      desc: 'Six UI elements peel off the interface and come for you personally.',
    },
    mirror_build: {
      name: 'Recommended For You', kind: 'mirrorPlayer', telegraph: 1.0,
      telegraphColor: 'yellow', cooldown: 16, damage: 0,
      params: { powerMult: 0.7, duration: 8, source: 'autoAttack', copiesUpgrades: true, copiesRelics: false },
      desc: 'It fires your own auto-attack back at you for 8s at 70% power.',
    },
    feed_collapse: {
      name: 'FEED COLLAPSE', kind: 'radialBurst', telegraph: 1.2,
      telegraphColor: 'red', safeColor: 'blue', cooldown: 20, damage: 44,
      params: { rings: 3, projectiles: 24, speed: 240, gapArc: 0.5, ringDelay: 0.8 },
      desc: 'Three rings collapse inward, 0.8s apart. Each has one gap. They do not line up.',
    },
  },
};

// -----------------------------------------------------------------------------
// STAGE 3 BOSS — RUINS OF WALL AMARIS
// You do not fight the body. You fight the HANDS, ride a vent to the nape, and
// hit the only thing on it that bleeds.
// -----------------------------------------------------------------------------
const THE_COLOSSUS = {
  id: 'the_colossus',
  name: 'THE COLOSSUS',
  epithet: 'The Wall Was Never The Problem',
  kind: 'boss',
  stage: 'wall_amaris',
  quote: '"It does not speak. The steam arrives first, and that is the warning."',
  hp: 6300, damage: 0, speed: 26, weight: 99, xp: 560, size: 'large',
  element: 'steel',
  contactDamage: false,
  telegraphFloor: 0.8,
  visual: {
    shape: 'square', color: '#c96a4a', accent: '#2b1a16', size: 140,
    emoji: '🖐', outline: true, rotates: false, glow: false,
  },
  reward: { starFragments: 20, relic: true, chest: 'gold' },
  death: { slowMoScale: 0.2, slowMoDuration: 1.8, shake: 'big' },
  asElite: { hpMult: 0.35, reward: { starFragments: 0, relic: false, chest: 'silver' } },
  // Hands are killable and stay down for 15s; the nape is the only permanent HP.
  parts: [
    { id: 'left_hand', name: 'Left Hand', hp: 1900, role: 'limb',
      onDestroy: { disablesAttack: 'ground_slam', forSeconds: 15 } },
    { id: 'right_hand', name: 'Right Hand', hp: 1900, role: 'limb',
      onDestroy: { disablesAttack: 'the_grab', forSeconds: 15 } },
    { id: 'nape', name: 'The Nape', hp: 2500, role: 'weakPoint',
      reachable: 'steam_vent_lift', damageMult: 3.0 },
  ],
  mechanic: {
    kind: 'climbToNape',
    params: { liftSource: 'steam_blast', liftDuration: 2.0, liftHeightFrames: 6, nape: 'nape' },
  },
  barks: {
    intro: '(the sky goes white with steam)',
    phase2: '(a vent opens. it is not aiming at you. it is aiming at where you were)',
    phase3: '(every vent opens at once)',
    death: '(the steam stops. the quiet is the loudest part)',
  },
  phases: [
    { name: 'The Hands', hpFrom: 1.0, hpTo: 0.66, speedMult: 1.0,
      attacks: ['ground_slam', 'steam_blast'] },
    { name: 'Steam Ascent', hpFrom: 0.66, hpTo: 0.33, speedMult: 1.1,
      attacks: ['ground_slam', 'steam_blast', 'the_grab', 'nape_exposed'] },
    { name: 'FULL PRESSURE', hpFrom: 0.33, hpTo: 0.0, speedMult: 1.2, enrage: true,
      attacks: ['ground_slam', 'steam_blast', 'the_grab', 'heat_wave', 'nape_exposed'] },
  ],
  attacks: {
    ground_slam: {
      name: 'Palm Strike', kind: 'groundSlam', telegraph: 1.1,
      telegraphColor: 'red', cooldown: 6.5, damage: 36,
      params: { radius: 300, shockwaves: 2, waveSpeed: 420, waveWidth: 90, hand: 'alternating' },
      desc: 'A palm the size of a house. Two shockwaves ripple out at 420px/s.',
    },
    steam_blast: {
      name: 'Steam Vent', kind: 'steamVent', telegraph: 1.0,
      telegraphColor: 'red', safeColor: 'blue', cooldown: 8, damage: 30,
      params: { vents: 5, radius: 150, riseTime: 1.4, liftDuration: 2.0, climbable: true },
      desc: 'Five vents blow. Stand in one AFTER it fires and the updraft carries you to the nape.',
    },
    the_grab: {
      name: 'The Grab', kind: 'grabQte', telegraph: 1.2,
      telegraphColor: 'yellow', cooldown: 22, damage: 45,
      // DECISIONS.md §17: never a keyboard-only mash. Any ability key, any
      // gamepad face button, or a screen tap all count as one input.
      params: { mashCount: 8, window: 2.5, anyInput: true, reach: 340, crushDamage: 45 },
      desc: 'A fist closes around you. 8 inputs in 2.5s to break out — any key, any button, any tap.',
    },
    heat_wave: {
      name: 'Heat Wave', kind: 'coneBreath', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 10, damage: 34,
      params: { angle: 1.1, range: 760, duration: 1.6, tickRate: 0.25 },
      desc: 'Exposed muscle vents a 760px cone of live steam for 1.6s.',
    },
    nape_exposed: {
      name: 'Nape Exposed', kind: 'weakPoint', telegraph: 0,
      telegraphColor: 'blue', cooldown: 0, damage: 0,
      params: { multiplier: 3.0, window: 6, requires: 'steam_vent_lift', part: 'nape' },
      desc: 'Ride a vent up and the nape takes 3x for 6 seconds. This is the whole fight.',
    },
  },
};

// -----------------------------------------------------------------------------
// STAGE 4 BOSS — HIDDEN EMBER VILLAGE
// Nine destructible tails. Each one you take is a permanent buff for the rest of
// the fight AND a permanent enrage for the boss. The fight is a bet you keep
// making. telegraphFloor is what stops the ninth enrage from becoming unreadable.
// -----------------------------------------------------------------------------
const THE_SEALED_BEAST = {
  id: 'the_sealed_beast',
  name: 'THE SEALED BEAST',
  epithet: 'Nine Tails, Nine Chains',
  kind: 'boss',
  stage: 'hidden_ember',
  quote: '"CHAINS. AGAIN. YOU PEOPLE HAVE NO OTHER IDEAS."',
  hp: 9800, damage: 0, speed: 30, weight: 99, xp: 760, size: 'large',
  element: 'fire',
  contactDamage: false,
  telegraphFloor: 0.8,
  visual: {
    shape: 'diamond', color: '#ff6a1f', accent: '#3a1206', size: 128,
    emoji: '🦊', outline: true, rotates: false, glow: true,
  },
  reward: { starFragments: 20, relic: true, chest: 'gold' },
  death: { slowMoScale: 0.22, slowMoDuration: 1.6, shake: 'big' },
  asElite: { hpMult: 0.35, reward: { starFragments: 0, relic: false, chest: 'silver' } },
  // 9 tails x 400 = 3,600 + a 6,200 core = 9,800 total.
  parts: [
    { id: 'tail_1', name: 'First Tail', hp: 400, role: 'destructible',
      onDestroy: { playerBuff: { damageMult: 0.06 }, enrage: true },
      buffText: '+6% damage' },
    { id: 'tail_2', name: 'Second Tail', hp: 400, role: 'destructible',
      onDestroy: { playerBuff: { attackSpeedMult: 0.06 }, enrage: true },
      buffText: '+6% attack speed' },
    { id: 'tail_3', name: 'Third Tail', hp: 400, role: 'destructible',
      onDestroy: { playerBuff: { moveSpeedMult: 0.08 }, enrage: true },
      buffText: '+8% move speed' },
    { id: 'tail_4', name: 'Fourth Tail', hp: 400, role: 'destructible',
      onDestroy: { playerBuff: { armor: 1 }, enrage: true },
      buffText: '+1 armor' },
    { id: 'tail_5', name: 'Fifth Tail', hp: 400, role: 'destructible',
      onDestroy: { playerBuff: { areaMult: 0.12 }, enrage: true },
      buffText: '+12% area' },
    { id: 'tail_6', name: 'Sixth Tail', hp: 400, role: 'destructible',
      onDestroy: { playerBuff: { cooldownMult: -0.08 }, enrage: true },
      buffText: '-8% cooldowns' },
    { id: 'tail_7', name: 'Seventh Tail', hp: 400, role: 'destructible',
      onDestroy: { playerBuff: { regen: 0.6 }, enrage: true },
      buffText: '+0.6 HP/s' },
    { id: 'tail_8', name: 'Eighth Tail', hp: 400, role: 'destructible',
      onDestroy: { playerBuff: { critChance: 0.05 }, enrage: true },
      buffText: '+5% crit chance' },
    { id: 'tail_9', name: 'Ninth Tail', hp: 400, role: 'destructible',
      onDestroy: { playerBuff: { damageMult: 0.10 }, enrage: true, breaksLastChain: true },
      buffText: '+10% damage — and the last chain goes with it' },
    { id: 'core', name: 'The Beast', hp: 6200, role: 'core' },
  ],
  mechanic: {
    kind: 'destructibleTails',
    // Compounding, so 9 tails is roughly +36% speed / +54% attack rate / +45%
    // damage on the boss. Steep on purpose — the buffs you took are steeper.
    params: { perTailEnrage: { speedMult: 0.04, attackRateMult: 0.06, damageMult: 0.05 } },
  },
  barks: {
    intro: 'NINE. COUNT THEM. THEN COUNT WHAT IS LEFT.',
    phase2: 'YOU TOOK ONE. GOOD. TAKE ANOTHER. SEE WHAT HAPPENS.',
    phase3: 'NO MORE SEALS. NO MORE MANNERS.',
    death: 'Hah. HAH! Fine. Keep the tails, kid.',
  },
  phases: [
    { name: 'Bound', hpFrom: 1.0, hpTo: 0.66, speedMult: 1.0,
      attacks: ['tail_sweep', 'seal_slam'] },
    { name: 'Straining The Seals', hpFrom: 0.66, hpTo: 0.33, speedMult: 1.12,
      attacks: ['tail_sweep', 'seal_slam', 'foxfire_beam', 'foxfire_summon'] },
    { name: 'NINE TAILS UNBOUND', hpFrom: 0.33, hpTo: 0.0, speedMult: 1.3, enrage: true,
      attacks: ['tail_sweep', 'seal_slam', 'foxfire_beam', 'foxfire_summon', 'chain_lash'] },
  ],
  attacks: {
    tail_sweep: {
      name: 'Tail Sweep', kind: 'tailSweep', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 6, damage: 32,
      params: { tails: 3, arc: 2.4, reach: 560, sweepTime: 0.9, knockback: 520 },
      desc: 'Three tails scythe a 560px arc. Heavy knockback — mind what is behind you.',
    },
    seal_slam: {
      name: 'Seal Slam', kind: 'groundSlam', telegraph: 1.1,
      telegraphColor: 'red', cooldown: 8, damage: 38,
      params: { radius: 340, shockwaves: 3, waveSpeed: 460, waveWidth: 80 },
      desc: 'It throws itself against the seals. Three rings at 460px/s.',
    },
    foxfire_beam: {
      name: 'Foxfire Beam', kind: 'beamContinuous', telegraph: 1.2,
      telegraphColor: 'red', cooldown: 15, damage: 18,
      params: { chargeTime: 1.2, width: 180, length: 1600, duration: 2.4, tickRate: 0.2, turnRate: 0.35 },
      desc: 'A 1,600px beam that tracks at 20 deg/s. Outrun it sideways, never backwards.',
    },
    foxfire_summon: {
      name: 'Foxfire', kind: 'summonAdds', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 18, damage: 0,
      // Wisps stand in for foxfire — they are the game's existing fire-spirit mob.
      params: {
        spawns: [{ enemy: 'paper_lantern_wisp', count: 3 }, { enemy: 'genin_shade', count: 6 }],
        radius: 300, pattern: 'ring',
      },
      desc: 'It spits burning motes. They land, and they stand up.',
    },
    chain_lash: {
      name: 'Chain Lash', kind: 'rotatingSweep', telegraph: 1.0,
      telegraphColor: 'yellow', cooldown: 11, damage: 30,
      params: { arms: 4, length: 600, angularSpeed: 1.2, duration: 6, width: 60 },
      desc: 'The broken chains are still attached, and now they are weapons.',
    },
  },
};

// -----------------------------------------------------------------------------
// STAGE 5 BOSS — THE ENDLESS TATAMI HALLS
// The skill-check boss. Three complete movesets on a rotating stance timer,
// signalled by eye colour.
//
// JUDGEMENT CALL, and an important one: the spec's eye colours (red = charge,
// blue = ranged fan, white = arena slash) collide with the global telegraph
// language, where blue means "safe". They are kept as SEPARATE channels. The eye
// is a STANCE readout with its own icon (`stanceIcon`); the attacks it launches
// still telegraph in the standard language. Nothing is ever conveyed by colour
// alone in either channel.
// -----------------------------------------------------------------------------
const KAGUTSUCHI = {
  id: 'kagutsuchi',
  name: 'KAGUTSUCHI',
  epithet: 'Upper Rank of the Flame',
  kind: 'boss',
  stage: 'tatami_halls',
  quote: '"Four arms. Two blades. Two whips. Watch my eyes and none of it matters."',
  hp: 15200, damage: 0, speed: 62, weight: 99, xp: 1000, size: 'large',
  element: 'fire',
  contactDamage: false,
  telegraphFloor: 0.8,
  visual: {
    shape: 'cross', color: '#ff3b2e', accent: '#2a0505', size: 104,
    emoji: '👹', outline: true, rotates: false, glow: true,
  },
  reward: { starFragments: 20, relic: true, chest: 'gold' },
  death: { slowMoScale: 0.18, slowMoDuration: 2.0, shake: 'big' },
  asElite: { hpMult: 0.35, reward: { starFragments: 0, relic: false, chest: 'silver' } },
  stances: [
    { id: 'red_eye', name: 'Red Eye — Rush', eyeColor: 'red', stanceIcon: 'blade',
      duration: 9, attacks: ['flame_rush', 'quad_cleave'] },
    { id: 'blue_eye', name: 'Blue Eye — Fan', eyeColor: 'blue', stanceIcon: 'fan',
      duration: 9, attacks: ['crimson_fan', 'ember_rain'] },
    { id: 'white_eye', name: 'White Eye — Severance', eyeColor: 'white', stanceIcon: 'moon',
      duration: 6, attacks: ['world_severing_slash'] },
  ],
  mechanic: {
    kind: 'stanceCycle',
    params: { order: 'sequential', switchTelegraph: 1.0, switchTelegraphColor: 'yellow' },
  },
  barks: {
    intro: 'You will learn three things about me. You get one mistake each.',
    phase2: 'The whips now. Try to keep your feet.',
    phase3: 'ALL FOUR ARMS. NO MORE LESSONS.',
    death: 'Good. That was... good. Go on, then.',
  },
  phases: [
    { name: 'First Form — Two Blades', hpFrom: 1.0, hpTo: 0.66, speedMult: 1.0,
      stances: ['red_eye', 'blue_eye'],
      attacks: ['flame_rush', 'quad_cleave', 'crimson_fan', 'ember_rain'] },
    { name: 'Second Form — Two Whips', hpFrom: 0.66, hpTo: 0.33, speedMult: 1.12,
      stances: ['red_eye', 'blue_eye', 'white_eye'],
      attacks: ['flame_rush', 'quad_cleave', 'crimson_fan', 'ember_rain',
                'world_severing_slash', 'severing_wheel'] },
    { name: 'FINAL FORM — ALL FOUR ARMS', hpFrom: 0.33, hpTo: 0.0, speedMult: 1.28, enrage: true,
      stances: ['red_eye', 'blue_eye', 'white_eye'], stanceDurationMult: 0.6,
      attacks: ['flame_rush', 'quad_cleave', 'crimson_fan', 'ember_rain',
                'world_severing_slash', 'severing_wheel'] },
  ],
  attacks: {
    flame_rush: {
      name: 'Flame Rush', kind: 'chargeDash', telegraph: 0.9,
      telegraphColor: 'yellow', cooldown: 4.5, damage: 40,
      params: { dashes: 3, speed: 1150, distance: 620, turnBetween: true,
                trail: 'burning', trailDps: 14, trailLife: 3 },
      desc: 'Three dashes at 1,150px/s, re-aiming between each. The floor keeps burning for 3s.',
    },
    quad_cleave: {
      name: 'Quad Cleave', kind: 'aoeCircle', telegraph: 0.9,
      telegraphColor: 'red', cooldown: 6, damage: 44,
      params: { radius: 260, hits: 4, hitInterval: 0.18, followsBoss: true },
      desc: 'Four arms, four overlapping cuts, 0.18s apart. Leaving late counts as staying.',
    },
    crimson_fan: {
      name: 'Crimson Fan', kind: 'projectileSpread', telegraph: 1.0,
      telegraphColor: 'yellow', cooldown: 5, damage: 26,
      params: { count: 11, arc: 1.6, speed: 330, life: 3.2, waves: 3, waveDelay: 0.5, rotatePerWave: 0.14 },
      desc: 'Three waves of 11, each rotated 8 degrees. The safe lane moves every time.',
    },
    ember_rain: {
      name: 'Ember Rain', kind: 'spawnHazard', telegraph: 1.0,
      telegraphColor: 'red', safeColor: 'blue', cooldown: 9, damage: 22,
      params: { zones: 9, radius: 130, delay: 1.0, life: 4, tickDps: 22, safeFraction: 0.4 },
      desc: 'Nine burning circles land 1s after they are painted. 40% of the floor stays clean.',
    },
    world_severing_slash: {
      name: 'World-Severing Slash', kind: 'lineSweep', telegraph: 1.2,
      telegraphColor: 'white', cooldown: 20, damage: 90,
      params: { columns: 1, width: 4000, sweepSpeed: 0, axis: 'arena',
                unavoidable: true, iframeWindow: 0.35 },
      desc: 'The whole hall is cut. There is no outside. Escape-move through it — 0.35s window.',
    },
    severing_wheel: {
      name: 'Severing Wheel', kind: 'rotatingSweep', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 12, damage: 38,
      params: { arms: 4, length: 480, angularSpeed: 2.2, duration: 4, width: 64, reverses: true },
      desc: 'Four whips at 126 deg/s, and halfway through they reverse.',
    },
  },
};

// -----------------------------------------------------------------------------
// STAGE 6 BOSS — SUNKEN IDOL REEF
// Eight tentacles, eight health bars, eight attacks. Kill an arm, delete the
// attack bolted to it — the fight gets quieter the harder you work. Then the
// stage itself goes down the drain.
// -----------------------------------------------------------------------------
const THE_KRAKEN_PRODUCER = {
  id: 'the_kraken_producer',
  name: 'THE KRAKEN PRODUCER',
  epithet: 'Eight Arms, One Vision',
  kind: 'boss',
  stage: 'sunken_reef',
  quote: '"Take five, everyone! Not you. You I have notes for."',
  hp: 24000, damage: 0, speed: 18, weight: 99, xp: 1300, size: 'large',
  element: 'water',
  contactDamage: false,
  telegraphFloor: 0.8,
  visual: {
    shape: 'circle', color: '#8b3fd6', accent: '#150726', size: 150,
    emoji: '🐙', outline: true, rotates: false, glow: true,
  },
  reward: { starFragments: 20, relic: true, chest: 'gold' },
  death: { slowMoScale: 0.2, slowMoDuration: 2.0, shake: 'big' },
  asElite: { hpMult: 0.35, reward: { starFragments: 0, relic: false, chest: 'silver' } },
  // 8 arms x 1,450 = 11,600 + a 12,400 core = 24,000. Each arm owns one attack.
  parts: [
    { id: 'arm_monitor', name: 'Monitor Mix', hp: 1450, role: 'limb',
      onDestroy: { removesAttack: 'monitor_slam' } },
    { id: 'arm_foh', name: 'Front Of House', hp: 1450, role: 'limb',
      onDestroy: { removesAttack: 'feedback_wail' } },
    { id: 'arm_lighting', name: 'Lighting Cue', hp: 1450, role: 'limb',
      onDestroy: { removesAttack: 'spotlight_sweep' } },
    { id: 'arm_pyro', name: 'Pyro', hp: 1450, role: 'limb',
      onDestroy: { removesAttack: 'pyro_cue' } },
    { id: 'arm_backing', name: 'Backing Track', hp: 1450, role: 'limb',
      onDestroy: { removesAttack: 'backing_track' } },
    { id: 'arm_haze', name: 'Haze Machine', hp: 1450, role: 'limb',
      onDestroy: { removesAttack: 'ink_curtain' } },
    { id: 'arm_merch', name: 'Merch Table', hp: 1450, role: 'limb',
      onDestroy: { removesAttack: 'merch_barrage' } },
    { id: 'arm_stagedive', name: 'Stage Left', hp: 1450, role: 'limb',
      onDestroy: { removesAttack: 'stage_dive' } },
    { id: 'core', name: 'The Producer', hp: 12400, role: 'core' },
  ],
  mechanic: {
    kind: 'tentacleBars',
    params: { arms: 8, coreExposedAfter: 'all_arms_destroyed', coreDamageMult: 2.5 },
  },
  barks: {
    intro: 'Places! PLACES! We are already behind!',
    phase2: 'That was one of my ARMS. Do you know what those cost?',
    phase3: 'Encore! ENCORE! Nobody leaves!',
    death: 'Cut... cut the feed... and tell them it was... a triumph...',
  },
  phases: [
    { name: 'Soundcheck', hpFrom: 1.0, hpTo: 0.75, speedMult: 1.0,
      attacks: ['monitor_slam', 'merch_barrage', 'feedback_wail', 'pyro_cue'] },
    { name: 'The Set', hpFrom: 0.75, hpTo: 0.45, speedMult: 1.05,
      attacks: ['monitor_slam', 'merch_barrage', 'feedback_wail', 'pyro_cue',
                'spotlight_sweep', 'backing_track'] },
    { name: 'Encore', hpFrom: 0.45, hpTo: 0.2, speedMult: 1.12,
      attacks: ['monitor_slam', 'merch_barrage', 'feedback_wail', 'pyro_cue',
                'spotlight_sweep', 'backing_track', 'ink_curtain', 'stage_dive'] },
    { name: 'THE WHIRLPOOL', hpFrom: 0.2, hpTo: 0.0, speedMult: 1.2, enrage: true,
      attacks: ['whirlpool_finale', 'monitor_slam', 'feedback_wail', 'stage_dive', 'core_exposed'] },
  ],
  attacks: {
    monitor_slam: {
      name: 'Monitor Slam', kind: 'tentacleSlam', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 5, damage: 34,
      params: { arms: 2, reach: 620, radius: 120, slamTime: 0.5 },
      desc: 'Two arms come down at once, 620px out. The impact circles are 120px.',
    },
    feedback_wail: {
      name: 'Feedback Wail', kind: 'radialBurst', telegraph: 1.0,
      telegraphColor: 'red', safeColor: 'blue', cooldown: 8, damage: 30,
      params: { rings: 2, projectiles: 18, speed: 260, gapArc: 0.6, ringDelay: 0.7 },
      desc: 'Two rings of sound, one gap each, 0.7s apart.',
    },
    spotlight_sweep: {
      name: 'Lighting Cue', kind: 'beamContinuous', telegraph: 1.1,
      telegraphColor: 'red', cooldown: 12, damage: 16,
      params: { beams: 2, width: 140, length: 1400, duration: 3.0, tickRate: 0.2,
                turnRate: 0.5, chargeTime: 1.1 },
      desc: 'Two follow-spots, 1,400px long, tracking at 29 deg/s for 3s.',
    },
    pyro_cue: {
      name: 'Pyro Cue', kind: 'spawnHazard', telegraph: 1.0,
      telegraphColor: 'red', safeColor: 'blue', cooldown: 9, damage: 28,
      params: { zones: 8, radius: 150, delay: 1.0, life: 3.5, tickDps: 28 },
      desc: 'Eight charges go off 1s after they are marked. They burn for 3.5s.',
    },
    backing_track: {
      name: 'Backing Track', kind: 'summonAdds', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 16, damage: 0,
      params: {
        spawns: [{ enemy: 'eel_swarm', count: 8 }, { enemy: 'jellyfish_chorus', count: 6 }],
        radius: 420, pattern: 'ring',
      },
      desc: 'The backing band comes in on the two. Nobody told them the venue flooded.',
    },
    ink_curtain: {
      name: 'Ink Curtain', kind: 'coneBreath', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 7, damage: 26,
      params: { angle: 1.3, range: 900, duration: 1.8, tickRate: 0.3, visionRadius: 280 },
      desc: 'A 900px cone of ink. Inside it you can see 280px and that is all.',
    },
    merch_barrage: {
      name: 'Merch Barrage', kind: 'projectileSpread', telegraph: 0.9,
      telegraphColor: 'yellow', cooldown: 6, damage: 22,
      params: { count: 14, arc: 2.2, speed: 300, life: 3.4, waves: 2, waveDelay: 0.45 },
      desc: 'Fourteen tour shirts a wave, twice. They are not even your size.',
    },
    stage_dive: {
      name: 'Stage Dive', kind: 'groundSlam', telegraph: 1.1,
      telegraphColor: 'red', cooldown: 10, damage: 40,
      params: { radius: 380, shockwaves: 2, waveSpeed: 440, waveWidth: 100 },
      desc: 'It goes up. It comes down. Two waves at 440px/s.',
    },
    whirlpool_finale: {
      name: 'THE WHIRLPOOL', kind: 'shrinkingRing', telegraph: 1.2,
      telegraphColor: 'red', safeColor: 'blue', cooldown: 0, damage: 45,
      params: { startRadius: 900, endRadius: 260, closeTime: 45, tickDamage: 45,
                tickRate: 0.5, pullForce: 180, platform: true },
      desc: 'The arena becomes a platform and the platform shrinks 900px to 260px over 45s.',
    },
    core_exposed: {
      name: 'Core Exposed', kind: 'weakPoint', telegraph: 0,
      telegraphColor: 'blue', cooldown: 0, damage: 0,
      params: { multiplier: 2.5, part: 'core', requires: 'all_arms_destroyed' },
      desc: 'Every arm down means the headset comes off. 2.5x to the core.',
    },
  },
};

// -----------------------------------------------------------------------------
// STAGE 7 BOSS — THE ZENITH STAGE
// Six pastiche phases, one per boss you already beat, and then it stops
// pretending. The last phase is your own character at 120% — your auto, your
// special, your escape, your upgrades. This is the payoff the whole game has
// been setting up: the final skill check is whether you understand your own kit
// better than something that has been watching you use it for six stages.
// -----------------------------------------------------------------------------
const THE_FINAL_FORM = {
  id: 'the_final_form',
  name: 'THE FINAL FORM',
  epithet: 'You, But It Practiced',
  kind: 'boss',
  stage: 'zenith_stage',
  quote: '"You got this far by being you. Let us see how that goes when I am you too."',
  hp: 38000, damage: 0, speed: 78, weight: 99, xp: 1800, size: 'large',
  element: 'shadow',
  contactDamage: false,
  telegraphFloor: 0.8,
  visual: {
    shape: 'star', color: '#ffffff', accent: '#12071f', size: 110,
    emoji: '🎭', outline: true, rotates: false, glow: true,
  },
  reward: { starFragments: 20, relic: true, chest: 'gold' },
  death: { slowMoScale: 0.15, slowMoDuration: 2.6, shake: 'big' },
  // It is the finale; it never spawns as somebody else's elite.
  asElite: null,
  mechanic: {
    kind: 'mirrorFinale',
    params: {
      pastichePhases: ['student_council_president', 'the_algorithm', 'the_colossus',
                       'the_sealed_beast', 'kagutsuchi', 'the_kraken_producer'],
      mirrorsCharacter: true, powerMult: 1.2, copiesUpgrades: true, copiesRelics: false,
    },
  },
  barks: {
    intro: 'I have been every one of them tonight. You were there for all of it.',
    phase2: 'Recommended for you: this exact fight, again, forever.',
    phase3: 'Bigger. You always respected bigger.',
    phase4: 'Nine of something. That worked on you once.',
    phase5: 'Watch my eyes. You know this part.',
    phase6: 'Places, everyone. Last number.',
    phase7: 'Nice build. Mind if I borrow it?',
    death: 'Oh. That is how you were supposed to use it. Good. Good.',
  },
  phases: [
    { name: 'Overture: The President', hpFrom: 1.0, hpTo: 0.857, speedMult: 1.0,
      attacks: ['echo_paperwork', 'echo_committee'] },
    { name: 'Second Movement: The Feed', hpFrom: 0.857, hpTo: 0.714, speedMult: 1.03,
      attacks: ['echo_scroll', 'echo_paperwork'] },
    { name: 'Third Movement: The Wall', hpFrom: 0.714, hpTo: 0.571, speedMult: 1.06,
      attacks: ['echo_slam', 'echo_grab'] },
    { name: 'Fourth Movement: The Beast', hpFrom: 0.571, hpTo: 0.429, speedMult: 1.09,
      attacks: ['echo_tails', 'echo_foxfire'] },
    { name: 'Fifth Movement: The Flame', hpFrom: 0.429, hpTo: 0.286, speedMult: 1.12,
      attacks: ['echo_fan', 'echo_severance'] },
    { name: 'Sixth Movement: The Producer', hpFrom: 0.286, hpTo: 0.143, speedMult: 1.15,
      attacks: ['echo_tentacles', 'echo_whirlpool'] },
    { name: 'FINALE: YOU', hpFrom: 0.143, hpTo: 0.0, speedMult: 1.2, enrage: true,
      attacks: ['mirror_auto', 'mirror_special', 'mirror_escape', 'curtain_call'] },
  ],
  attacks: {
    echo_paperwork: {
      name: 'Echo: Paperwork', kind: 'homingProjectile', telegraph: 0.9,
      telegraphColor: 'yellow', cooldown: 4.5, damage: 30,
      params: { count: 10, speed: 200, turnRate: 1.4, life: 5, spread: 1.4 },
      desc: 'Ten forms. It got faster at this than she ever was.',
    },
    echo_committee: {
      name: 'Echo: The Committee', kind: 'summonAdds', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 20, damage: 0,
      params: {
        spawns: [{ enemy: 'mob_student', count: 14 }, { enemy: 'husk_wanderer', count: 10 },
                 { enemy: 'genin_shade', count: 6 }],
        radius: 520, pattern: 'ring',
      },
      desc: 'Everyone you have already killed, remembered slightly wrong.',
    },
    echo_scroll: {
      name: 'Echo: Infinite Scroll', kind: 'lineSweep', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 5.5, damage: 42,
      params: { columns: 5, width: 110, sweepSpeed: 560, axis: 'vertical' },
      desc: 'Five columns now. It added one.',
    },
    echo_slam: {
      name: 'Echo: Palm Strike', kind: 'groundSlam', telegraph: 1.1,
      telegraphColor: 'red', cooldown: 6, damage: 46,
      params: { radius: 340, shockwaves: 3, waveSpeed: 470, waveWidth: 90 },
      desc: 'Three shockwaves at 470px/s from a hand that is only pretending to be that big.',
    },
    echo_grab: {
      name: 'Echo: The Grab', kind: 'grabQte', telegraph: 1.2,
      telegraphColor: 'yellow', cooldown: 24, damage: 55,
      params: { mashCount: 8, window: 2.5, anyInput: true, reach: 380, crushDamage: 55 },
      desc: 'You have done this before. 8 inputs, 2.5s, anything you can press.',
    },
    echo_tails: {
      name: 'Echo: Nine Tails', kind: 'tailSweep', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 5.5, damage: 40,
      params: { tails: 9, arc: 2.6, reach: 640, sweepTime: 0.85, knockback: 560 },
      desc: 'All nine at once. It never had to earn them.',
    },
    echo_foxfire: {
      name: 'Echo: Foxfire Beam', kind: 'beamContinuous', telegraph: 1.2,
      telegraphColor: 'red', cooldown: 14, damage: 20,
      params: { chargeTime: 1.2, width: 200, length: 1800, duration: 2.4, tickRate: 0.2, turnRate: 0.4 },
      desc: '1,800px, tracking at 23 deg/s. Sideways. Always sideways.',
    },
    echo_fan: {
      name: 'Echo: Crimson Fan', kind: 'projectileSpread', telegraph: 1.0,
      telegraphColor: 'yellow', cooldown: 5, damage: 30,
      params: { count: 13, arc: 1.7, speed: 350, life: 3.2, waves: 3, waveDelay: 0.45, rotatePerWave: 0.14 },
      desc: 'Thirteen a wave, three waves, rotating. The lane still moves.',
    },
    echo_severance: {
      name: 'Echo: World-Severing Slash', kind: 'lineSweep', telegraph: 1.2,
      telegraphColor: 'white', cooldown: 16, damage: 96,
      params: { columns: 1, width: 4000, sweepSpeed: 0, axis: 'arena',
                unavoidable: true, iframeWindow: 0.35 },
      desc: 'The whole stage, cut. Escape through it. You have 0.35s and you know it.',
    },
    echo_tentacles: {
      name: 'Echo: Eight Arms', kind: 'tentacleSlam', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 5, damage: 40,
      params: { arms: 4, reach: 700, radius: 130, slamTime: 0.5 },
      desc: 'Four arms it does not have, reaching 700px anyway.',
    },
    echo_whirlpool: {
      name: 'Echo: The Whirlpool', kind: 'shrinkingRing', telegraph: 1.2,
      telegraphColor: 'red', safeColor: 'blue', cooldown: 26, damage: 44,
      params: { startRadius: 880, endRadius: 300, closeTime: 8, gapCount: 2,
                gapArc: 0.45, pullForce: 170 },
      desc: '880px to 300px in 8 seconds. Two gaps, and they drift.',
    },
    mirror_auto: {
      name: 'Your Auto-Attack', kind: 'mirrorPlayer', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 0, damage: 0,
      params: { powerMult: 1.2, source: 'autoAttack', copiesUpgrades: true, copiesRelics: false },
      desc: 'Your auto-attack, every upgrade you took, at 120%. It fires it better than you do.',
    },
    mirror_special: {
      name: 'Your Special', kind: 'mirrorPlayer', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 14, damage: 0,
      params: { powerMult: 1.2, source: 'special', copiesUpgrades: true, copiesRelics: false },
      desc: 'Your special, at 120%, on a 14s cooldown it does not have to earn.',
    },
    mirror_escape: {
      name: 'Your Escape', kind: 'mirrorPlayer', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 5, damage: 0,
      params: { powerMult: 1.2, source: 'escape', copiesIframes: true, copiesUpgrades: true },
      desc: 'It has your escape move and it uses it to close, not to run.',
    },
    curtain_call: {
      name: 'CURTAIN CALL', kind: 'radialBurst', telegraph: 1.2,
      telegraphColor: 'white', cooldown: 22, damage: 70,
      params: { rings: 4, projectiles: 26, speed: 330, gapArc: 0.4, ringDelay: 0.55 },
      desc: 'Four rings, 0.55s apart, gaps too tight to walk. This is what escape is for.',
    },
  },
};

// =============================================================================
// MID-BOSSES — one per stage, at the halfway mark (0.50 * duration,
// DECISIONS.md §20). Same rules as bosses: no contact damage, named phases,
// readable telegraphs. They pay 10 Star Fragments and a silver chest; the relic
// stays a full-boss reward so the mid-boss never trivialises the drop table.
// =============================================================================

// -----------------------------------------------------------------------------
// STAGE 1 MID-BOSS
// -----------------------------------------------------------------------------
const DELINQUENT_SENPAI = {
  id: 'delinquent_senpai',
  name: 'DELINQUENT SENPAI',
  epithet: 'Third Year, Fourth Time',
  kind: 'midboss',
  stage: 'cherry_academy',
  quote: '"You are in my spot. That was my spot. I had a whole thing planned for it."',
  hp: 1100, damage: 0, speed: 44, weight: 60, xp: 120, size: 'large',
  element: 'steel',
  contactDamage: false,
  telegraphFloor: 0.8,
  visual: {
    shape: 'capsule', color: '#ffcf5c', accent: '#3a2a08', size: 54,
    emoji: '🥊', outline: true, rotates: false, glow: false,
  },
  reward: { starFragments: 10, relic: false, chest: 'silver' },
  death: { slowMoScale: 0.35, slowMoDuration: 0.9, shake: 'medium' },
  barks: {
    intro: 'Nobody comes up here. That is the point of up here.',
    phase2: 'Okay. OKAY. Now I am doing it properly.',
    death: 'Tch. Take the roof. It leaks anyway.',
  },
  phases: [
    { name: 'Loitering', hpFrom: 1.0, hpTo: 0.5, speedMult: 1.0,
      attacks: ['hallway_charge', 'desk_toss'] },
    { name: 'Actually Trying', hpFrom: 0.5, hpTo: 0.0, speedMult: 1.25, enrage: true,
      attacks: ['hallway_charge', 'desk_toss', 'pipe_spin', 'bad_influence'] },
  ],
  attacks: {
    hallway_charge: {
      name: 'Hallway Charge', kind: 'chargeDash', telegraph: 0.9,
      telegraphColor: 'yellow', cooldown: 5, damage: 26,
      params: { dashes: 1, speed: 980, distance: 700, turnBetween: false },
      desc: 'Straight line, 700px, 980px/s. He telegraphs it because he wants you to see it coming.',
    },
    desk_toss: {
      name: 'Desk Toss', kind: 'projectileSpread', telegraph: 0.9,
      telegraphColor: 'yellow', cooldown: 6, damage: 20,
      params: { count: 5, arc: 0.9, speed: 340, life: 2.6 },
      desc: 'Five desks in a narrow fan. School property, technically.',
    },
    pipe_spin: {
      name: 'Pipe Spin', kind: 'rotatingSweep', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 8, damage: 22,
      params: { arms: 1, length: 190, angularSpeed: 3.4, duration: 2.2, width: 70, followsBoss: true },
      desc: 'A 190px pipe at 195 deg/s for 2.2s. Just back off; it is not complicated.',
    },
    bad_influence: {
      name: 'Bad Influence', kind: 'summonAdds', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 14, damage: 0,
      params: { spawns: [{ enemy: 'mob_student', count: 8 }], radius: 220, pattern: 'cluster' },
      desc: 'Eight underclassmen who owe him something and do not remember what.',
    },
  },
};

// -----------------------------------------------------------------------------
// STAGE 2 MID-BOSS — dies into four smaller ones, which is the joke and the fight
// -----------------------------------------------------------------------------
const MASCOT_PRIME = {
  id: 'mascot_prime',
  name: 'MASCOT PRIME',
  epithet: 'Beloved By Contract',
  kind: 'midboss',
  stage: 'neon_akiba',
  quote: '"♪ hello hello hello hello ♪"',
  hp: 1750, damage: 0, speed: 40, weight: 75, xp: 180, size: 'large',
  element: 'spirit',
  contactDamage: false,
  telegraphFloor: 0.8,
  visual: {
    shape: 'circle', color: '#ffd23f', accent: '#4a2c00', size: 66,
    emoji: '🧸', outline: true, rotates: false, glow: false,
  },
  reward: { starFragments: 10, relic: false, chest: 'silver' },
  death: { slowMoScale: 0.35, slowMoDuration: 0.9, shake: 'medium' },
  // Splinters are a canonical split-child (DECISIONS.md §5), not a boss.
  onDeath: { split: { enemy: 'mascot_splinter', count: 4, hpFraction: 0.12, scatterRadius: 220 } },
  barks: {
    intro: 'Available for birthdays, openings, and this.',
    phase2: 'THE SUIT DOES NOT COME OFF. THE SUIT HAS NEVER COME OFF.',
    death: '♪ byeee ♪ (it splits into four and none of them are done)',
  },
  phases: [
    { name: 'Sponsored Content', hpFrom: 1.0, hpTo: 0.5, speedMult: 1.0,
      attacks: ['merch_hug', 'balloon_barrage'] },
    { name: 'PRIME TIME', hpFrom: 0.5, hpTo: 0.0, speedMult: 1.22, enrage: true,
      attacks: ['merch_hug', 'balloon_barrage', 'photo_op', 'mascot_stampede'] },
  ],
  attacks: {
    merch_hug: {
      name: 'Merch Hug', kind: 'aoeCircle', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 6, damage: 24,
      params: { radius: 210, followsBoss: true, knockback: 400 },
      desc: 'A 210px hug with 400 knockback. It is affectionate and it is a problem.',
    },
    balloon_barrage: {
      name: 'Balloon Barrage', kind: 'projectileSpread', telegraph: 0.9,
      telegraphColor: 'yellow', cooldown: 5, damage: 18,
      params: { count: 9, arc: 2.6, speed: 250, life: 4, bounces: 2 },
      desc: 'Nine balloons that bounce twice off the scenery. They come back.',
    },
    photo_op: {
      name: 'Photo Op', kind: 'chargeDash', telegraph: 0.9,
      telegraphColor: 'yellow', cooldown: 8, damage: 22,
      params: { dashes: 2, speed: 820, distance: 520, turnBetween: true },
      desc: 'Two 520px lunges, re-aiming between. It wants to be in frame with you.',
    },
    mascot_stampede: {
      name: 'Mascot Stampede', kind: 'summonAdds', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 15, damage: 0,
      params: {
        spawns: [{ enemy: 'mascot_suit', count: 4 }, { enemy: 'antifan_swarm', count: 20 }],
        radius: 340, pattern: 'ring',
      },
      desc: 'Four more suits and twenty people with opinions about them.',
    },
  },
};

// -----------------------------------------------------------------------------
// STAGE 3 MID-BOSS — immune everywhere but the nape.
// DECISIONS.md §31: a shield that always faces you is not a shield, it is a
// wall. 90 deg/s turn cap and a 0.4s facing lag mean circling actually works.
// -----------------------------------------------------------------------------
const THE_ARMORED = {
  id: 'the_armored',
  name: 'THE ARMORED',
  epithet: 'Plated Everywhere That Matters',
  kind: 'midboss',
  stage: 'wall_amaris',
  quote: '"It turns to face you. Slowly. That is the entire fight and it is enough."',
  hp: 2700, damage: 0, speed: 36, weight: 95, xp: 260, size: 'large',
  element: 'steel',
  contactDamage: false,
  telegraphFloor: 0.8,
  visual: {
    shape: 'hex', color: '#9aa4ad', accent: '#22262b', size: 76,
    emoji: '🛡', outline: true, rotates: false, glow: false,
  },
  reward: { starFragments: 10, relic: false, chest: 'silver' },
  death: { slowMoScale: 0.3, slowMoDuration: 1.2, shake: 'medium' },
  mechanic: {
    kind: 'napeOnly',
    params: { turnRate: 1.5708, facingLag: 0.4, immuneElsewhere: true, chipDamage: 0 },
  },
  barks: {
    intro: '(the plates settle. it has all night.)',
    phase2: '(something under the plating is not enjoying this)',
    death: '(the armor stays standing for a second longer than the rest of it)',
  },
  phases: [
    { name: 'Hardened', hpFrom: 1.0, hpTo: 0.5, speedMult: 1.0,
      attacks: ['exposed_nape', 'hardening_charge', 'plate_shockwave'] },
    { name: 'Cracked Plating', hpFrom: 0.5, hpTo: 0.0, speedMult: 1.18, enrage: true,
      attacks: ['exposed_nape', 'hardening_charge', 'plate_shockwave', 'shoulder_guard', 'plate_shatter'] },
  ],
  attacks: {
    exposed_nape: {
      name: 'The Nape', kind: 'weakPoint', telegraph: 0,
      telegraphColor: 'blue', cooldown: 0, damage: 0,
      params: {
        multiplier: 5.0, arc: 1.05, facing: 'rear',
        turnRate: 1.5708, facingLag: 0.4, immuneElsewhere: true, chipDamage: 0,
      },
      desc: 'Immune except the nape: a 60 degree rear arc at 5x. It turns at 90 deg/s with 0.4s of lag. Outrun the turn.',
    },
    hardening_charge: {
      name: 'Hardening Charge', kind: 'chargeDash', telegraph: 1.0,
      telegraphColor: 'yellow', cooldown: 6, damage: 34,
      params: { dashes: 1, speed: 1050, distance: 820, unstoppable: true, breaksObstacles: true },
      desc: '820px at 1,050px/s, straight through the rubble. It does not steer and it does not need to.',
    },
    plate_shockwave: {
      name: 'Plate Shockwave', kind: 'groundSlam', telegraph: 1.1,
      telegraphColor: 'red', cooldown: 7, damage: 30,
      params: { radius: 300, shockwaves: 2, waveSpeed: 430, waveWidth: 85 },
      desc: 'Two rings at 430px/s. The gap between them is 0.5s wide.',
    },
    shoulder_guard: {
      name: 'Shoulder Guard', kind: 'shieldPhase', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 16, damage: 0,
      params: { duration: 5, frontArc: 2.1, reduction: 1.0, turnRate: 1.5708, facingLag: 0.4 },
      desc: 'It braces for 5s. The front 120 degrees take nothing. The nape is still the nape.',
    },
    plate_shatter: {
      name: 'Plate Shatter', kind: 'radialBurst', telegraph: 1.0,
      telegraphColor: 'red', safeColor: 'blue', cooldown: 12, damage: 32,
      params: { rings: 1, projectiles: 20, speed: 300, gapArc: 0.45 },
      desc: 'Cracked armor sheds twenty shards. One gap, and the gap points behind it.',
    },
  },
};

// -----------------------------------------------------------------------------
// STAGE 4 MID-BOSS — two entities, one problem.
// Kill one and the other brings it back at 50% unless both die within 5s.
// -----------------------------------------------------------------------------
const THE_TWIN_FANGS = {
  id: 'the_twin_fangs',
  name: 'THE TWIN FANGS',
  epithet: 'Kill Us Together Or Not At All',
  kind: 'midboss',
  stage: 'hidden_ember',
  quote: '"You can kill one of us. You will have about five seconds to enjoy it."',
  hp: 4200, damage: 0, speed: 96, weight: 45, xp: 420, size: 'large',
  element: 'shadow',
  contactDamage: false,
  telegraphFloor: 0.8,
  visual: {
    shape: 'shard', color: '#7b5cff', accent: '#160a33', size: 46,
    emoji: '🗡', outline: true, rotates: false, glow: true,
  },
  reward: { starFragments: 10, relic: false, chest: 'silver' },
  death: { slowMoScale: 0.3, slowMoDuration: 1.2, shake: 'medium' },
  mechanic: {
    kind: 'twinRevive',
    params: { count: 2, hpEach: 2100, reviveWindow: 5, reviveHp: 0.5 },
  },
  parts: [
    { id: 'fang_left', name: 'The Left Fang', hp: 2100, role: 'twin' },
    { id: 'fang_right', name: 'The Right Fang', hp: 2100, role: 'twin' },
  ],
  barks: {
    intro: 'Two of us. One of you. We have done the arithmetic.',
    phase2: 'BROTHER. GET UP. GET UP, YOU ARE EMBARRASSING US.',
    death: 'Together... after all... fine...',
  },
  phases: [
    { name: 'Two Fangs', hpFrom: 1.0, hpTo: 0.5, speedMult: 1.0,
      attacks: ['crossing_fangs', 'kunai_web', 'blood_bond'] },
    { name: 'ONE FANG', hpFrom: 0.5, hpTo: 0.0, speedMult: 1.3, enrage: true,
      attacks: ['crossing_fangs', 'kunai_web', 'pincer_line', 'survivors_rage'] },
  ],
  attacks: {
    crossing_fangs: {
      name: 'Crossing Fangs', kind: 'chargeDash', telegraph: 0.9,
      telegraphColor: 'yellow', cooldown: 4, damage: 28,
      params: { dashes: 2, speed: 1150, distance: 640, turnBetween: true, crossPattern: true },
      desc: 'They dash through each other. Twice. The crossing point is the dangerous part.',
    },
    kunai_web: {
      name: 'Kunai Web', kind: 'projectileSpread', telegraph: 0.9,
      telegraphColor: 'yellow', cooldown: 5, damage: 20,
      params: { count: 7, arc: 1.1, speed: 420, life: 2.4, fromBoth: true },
      desc: 'Seven from each of them at once, and they aim where you are going.',
    },
    pincer_line: {
      name: 'Pincer Line', kind: 'lineSweep', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 8, damage: 30,
      params: { columns: 2, width: 120, sweepSpeed: 600, axis: 'betweenTwins' },
      desc: 'A wire strung between the two of them, sweeping at 600px/s. Do not be between them.',
    },
    blood_bond: {
      name: 'Blood Bond', kind: 'shieldPhase', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 14, damage: 0,
      params: { duration: 4, reduction: 0.6, linked: true, breaksAtDistance: 520 },
      desc: 'Within 520px of each other they take 60% less for 4s. Split them and the bond snaps.',
    },
    survivors_rage: {
      name: "Survivor's Rage", kind: 'radialBurst', telegraph: 1.0,
      telegraphColor: 'red', safeColor: 'blue', cooldown: 6, damage: 36,
      params: { rings: 2, projectiles: 16, speed: 340, gapArc: 0.5, ringDelay: 0.6 },
      desc: 'Only fires while one of them is down and the 5s revive clock is running.',
    },
  },
};

// -----------------------------------------------------------------------------
// STAGE 5 MID-BOSS — six drums on his back, six room rotations.
// Break the drums and the hall stops moving.
// -----------------------------------------------------------------------------
const THE_DRUM_ONI = {
  id: 'the_drum_oni',
  name: 'THE DRUM ONI',
  epithet: 'He Sets The Tempo',
  kind: 'midboss',
  stage: 'tatami_halls',
  quote: '"Every room in this castle turns when I say so. Try to keep the beat."',
  hp: 6400, damage: 0, speed: 42, weight: 90, xp: 640, size: 'large',
  element: 'spirit',
  contactDamage: false,
  telegraphFloor: 0.8,
  visual: {
    shape: 'circle', color: '#e0443c', accent: '#2b0d0c', size: 78,
    emoji: '🥁', outline: true, rotates: false, glow: false,
  },
  reward: { starFragments: 10, relic: false, chest: 'silver' },
  death: { slowMoScale: 0.3, slowMoDuration: 1.2, shake: 'medium' },
  // 6 drums x 220 = 1,320 + a 5,080 core = 6,400. Each drum is one rotation.
  parts: [
    { id: 'drum_1', name: 'First Drum', hp: 220, role: 'destructible', onDestroy: { removesRotation: 1 } },
    { id: 'drum_2', name: 'Second Drum', hp: 220, role: 'destructible', onDestroy: { removesRotation: 1 } },
    { id: 'drum_3', name: 'Third Drum', hp: 220, role: 'destructible', onDestroy: { removesRotation: 1 } },
    { id: 'drum_4', name: 'Fourth Drum', hp: 220, role: 'destructible', onDestroy: { removesRotation: 1 } },
    { id: 'drum_5', name: 'Fifth Drum', hp: 220, role: 'destructible', onDestroy: { removesRotation: 1 } },
    { id: 'drum_6', name: 'Sixth Drum', hp: 220, role: 'destructible', onDestroy: { removesRotation: 1 } },
    { id: 'core', name: 'The Drum Oni', hp: 5080, role: 'core' },
  ],
  barks: {
    intro: 'One. Two. One two three four.',
    phase2: 'DOUBLE TIME. KEEP UP OR DO NOT.',
    death: '...and that is the last bar. Ha. Not bad.',
  },
  phases: [
    { name: 'Downbeat', hpFrom: 1.0, hpTo: 0.5, speedMult: 1.0,
      attacks: ['taiko_shockwave', 'bachi_slam', 'drum_rotate'] },
    { name: 'DOUBLE TIME', hpFrom: 0.5, hpTo: 0.0, speedMult: 1.3, enrage: true,
      attacks: ['taiko_shockwave', 'bachi_slam', 'drum_rotate', 'rhythm_lines'] },
  ],
  attacks: {
    drum_rotate: {
      name: 'Turn The Hall', kind: 'drumRotate', telegraph: 1.2,
      telegraphColor: 'yellow', cooldown: 16, damage: 0,
      params: { rotationDeg: 90, rotateTime: 2.0, repositionPlayer: true, drums: 6 },
      desc: 'One drum hit turns the hall 90 degrees over 2s, and takes you with it.',
    },
    taiko_shockwave: {
      name: 'Taiko Shockwave', kind: 'radialBurst', telegraph: 1.0,
      telegraphColor: 'red', safeColor: 'blue', cooldown: 6, damage: 30,
      params: { rings: 3, projectiles: 14, speed: 290, gapArc: 0.55, ringDelay: 0.55 },
      desc: 'Three rings on the beat, 0.55s apart. The gaps are on the beat too.',
    },
    bachi_slam: {
      name: 'Bachi Slam', kind: 'groundSlam', telegraph: 1.1,
      telegraphColor: 'red', cooldown: 7, damage: 34,
      params: { radius: 290, shockwaves: 2, waveSpeed: 420, waveWidth: 80 },
      desc: 'Both drumsticks into the tatami. Two waves at 420px/s.',
    },
    rhythm_lines: {
      name: 'Rhythm Lines', kind: 'lineSweep', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 9, damage: 28,
      params: { columns: 3, width: 130, sweepSpeed: 480, axis: 'alternating' },
      desc: 'Three bars of floor light up and slam shut, alternating axis each time.',
    },
  },
};

// -----------------------------------------------------------------------------
// STAGE 6 MID-BOSS — the flanking exam. Same 90 deg/s cap as every shielder.
// -----------------------------------------------------------------------------
const TIDE_WARDEN = {
  id: 'tide_warden',
  name: 'TIDE WARDEN',
  epithet: 'Shell Side Forward',
  kind: 'midboss',
  stage: 'sunken_reef',
  quote: '"It does not blink. Crabs cannot. Somehow that makes it worse."',
  hp: 10000, damage: 0, speed: 34, weight: 96, xp: 900, size: 'large',
  element: 'water',
  contactDamage: false,
  telegraphFloor: 0.8,
  visual: {
    shape: 'hex', color: '#ff7a4d', accent: '#2a1008', size: 88,
    emoji: '🦀', outline: true, rotates: false, glow: false,
  },
  reward: { starFragments: 10, relic: false, chest: 'silver' },
  death: { slowMoScale: 0.3, slowMoDuration: 1.2, shake: 'medium' },
  mechanic: {
    kind: 'frontalShield',
    params: { frontArc: 2.0, reduction: 0.9, turnRate: 1.5708, facingLag: 0.4 },
  },
  barks: {
    intro: '(it plants itself between you and the stadium. it was told to.)',
    phase2: '(the shell has a crack in it now and it knows)',
    death: '(it settles, shell down, like it is finally off shift)',
  },
  phases: [
    { name: 'High Tide', hpFrom: 1.0, hpTo: 0.5, speedMult: 1.0,
      attacks: ['bulwark_shell', 'claw_slam', 'bubble_volley'] },
    { name: 'SHELL CRACKED', hpFrom: 0.5, hpTo: 0.0, speedMult: 1.2, enrage: true,
      attacks: ['bulwark_shell', 'claw_slam', 'bubble_volley', 'undertow', 'sea_king_call'] },
  ],
  attacks: {
    bulwark_shell: {
      name: 'Bulwark Shell', kind: 'shieldPhase', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 0, damage: 0,
      params: { permanent: true, frontArc: 2.0, reduction: 0.9, turnRate: 1.5708, facingLag: 0.4 },
      desc: 'The front 115 degrees take 90% less. It turns at 90 deg/s with 0.4s of lag. Circle faster than that.',
    },
    claw_slam: {
      name: 'Claw Slam', kind: 'groundSlam', telegraph: 1.1,
      telegraphColor: 'red', cooldown: 6, damage: 36,
      params: { radius: 320, shockwaves: 2, waveSpeed: 450, waveWidth: 90 },
      desc: 'Two waves at 450px/s from a claw that does not care which way it is facing.',
    },
    bubble_volley: {
      name: 'Bubble Volley', kind: 'projectileSpread', telegraph: 0.9,
      telegraphColor: 'yellow', cooldown: 5, damage: 24,
      params: { count: 12, arc: 1.9, speed: 270, life: 4.5, popRadius: 70 },
      desc: 'Twelve bubbles that pop for 70px when they expire. The volley is not the problem; the pop is.',
    },
    undertow: {
      name: 'Undertow', kind: 'shrinkingRing', telegraph: 1.2,
      telegraphColor: 'red', safeColor: 'blue', cooldown: 18, damage: 30,
      params: { startRadius: 760, endRadius: 240, closeTime: 5, gapCount: 2, gapArc: 0.5, pullForce: 140 },
      desc: '760px to 240px in 5s with a 140 pull. Two gaps, and the current fights you toward neither.',
    },
    sea_king_call: {
      name: 'Sea King Call', kind: 'summonAdds', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 15, damage: 0,
      params: {
        spawns: [{ enemy: 'coral_crab', count: 5 }, { enemy: 'eel_swarm', count: 6 }],
        radius: 380, pattern: 'ring',
      },
      desc: 'Five more shields and six things that latch on. Deal with the shields.',
    },
  },
};

// -----------------------------------------------------------------------------
// STAGE 7 MID-BOSS — DECISIONS.md §7. Stage 7 had no mid-boss and SECTION 2
// promises one at every halfway mark, so here is one that could only exist in a
// finale: three mid-bosses you already beat, at once, at 60% each.
//
// Budget: a solo Stage 7 mid-boss would carry 8,667 HP apiece across three
// bodies (26,000 total). At 60% each that is 5,200 apiece = 15,600 — exactly the
// 42%-of-boss mid-boss budget the rest of the ladder uses.
// -----------------------------------------------------------------------------
const THE_OPENING_ACT = {
  id: 'the_opening_act',
  name: 'THE OPENING ACT',
  epithet: 'Please Welcome To The Stage',
  kind: 'midboss',
  stage: 'zenith_stage',
  quote: '"You have met all three of us. Never at the same time. That was our mistake."',
  hp: 15600, damage: 0, speed: 40, weight: 90, xp: 1600, size: 'large',
  element: 'light',
  contactDamage: false,
  telegraphFloor: 0.8,
  visual: {
    shape: 'ring', color: '#ffe066', accent: '#3a2f05', size: 92,
    emoji: '🎪', outline: true, rotates: false, glow: true,
  },
  reward: { starFragments: 10, relic: false, chest: 'silver' },
  death: { slowMoScale: 0.28, slowMoDuration: 1.4, shake: 'big' },
  mechanic: {
    kind: 'multiSpawn',
    params: {
      members: ['mascot_prime', 'the_armored', 'the_drum_oni'],
      hpMult: 0.6, hpEach: 5200, simultaneous: true, sharedHealthBar: false, allMustDie: true,
    },
  },
  barks: {
    intro: 'Three acts, no interval, and the interval was the only part you liked.',
    phase2: 'One down. The other two would like a word about that.',
    death: 'Curtain. Curtain! Somebody bring the curtain.',
  },
  phases: [
    { name: 'Three Acts', hpFrom: 1.0, hpTo: 0.34, speedMult: 1.0,
      attacks: ['curtain_up', 'house_lights', 'intermission'] },
    { name: 'THE LAST ONE STANDING', hpFrom: 0.34, hpTo: 0.0, speedMult: 1.25, enrage: true,
      attacks: ['house_lights', 'standing_ovation', 'intermission'] },
  ],
  attacks: {
    curtain_up: {
      name: 'Curtain Up', kind: 'summonAdds', telegraph: 1.0,
      telegraphColor: 'yellow', cooldown: 0, damage: 0,
      params: {
        once: true, radius: 520, pattern: 'ring',
        spawns: [
          { boss: 'mascot_prime', count: 1, hpMult: 0.6 },
          { boss: 'the_armored', count: 1, hpMult: 0.6 },
          { boss: 'the_drum_oni', count: 1, hpMult: 0.6 },
        ],
      },
      desc: 'All three walk on together at 60% HP. 5,200 each. No, they do not take turns.',
    },
    house_lights: {
      name: 'House Lights', kind: 'rotatingSweep', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 10, damage: 34,
      params: { arms: 3, length: 640, angularSpeed: 1.3, duration: 6, width: 74 },
      desc: 'Three follow-spots at 74 deg/s for 6s. The venue is attacking you now as well.',
    },
    standing_ovation: {
      name: 'Standing Ovation', kind: 'radialBurst', telegraph: 1.1,
      telegraphColor: 'red', safeColor: 'blue', cooldown: 14, damage: 36,
      params: { rings: 2, projectiles: 22, speed: 310, gapArc: 0.5, ringDelay: 0.7 },
      desc: 'A million silhouettes clap at once. Two rings, one gap each.',
    },
    intermission: {
      name: 'Intermission', kind: 'shieldPhase', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 22, damage: 0,
      params: { duration: 4, reduction: 0.5, appliesTo: 'survivors', triggerOnMemberDeath: true },
      desc: 'Lose one and the other two get 4s at 50% reduction. Kill them close together.',
    },
  },
};

// =============================================================================
// NAMED ELITES — one per stage (SECTION 9's "one per stage minimum").
// Unlike bosses these ARE enemies: they declare a behavior archetype from the
// 15-entry list (DECISIONS.md §6), they can roll affixes, and most of them do
// contact damage. They always drop a chest and never Star Fragments — the
// fragment economy is fixed by DECISIONS.md §1 and elites are not in it. That
// also keeps the Stage 7 "Grand Finale" modifier from printing currency.
// Affix ids are lowercase forms of the SECTION 9 affix table.
// =============================================================================

const PERFECT_ATTENDANCE_AWARD = {
  id: 'perfect_attendance_award',
  name: 'THE PERFECT ATTENDANCE AWARD',
  epithet: 'Nobody Has Ever Won It',
  kind: 'elite',
  stage: 'cherry_academy',
  quote: '"Zero absences. Zero. Not one. Not ever. Not once."',
  hp: 380, damage: 12, speed: 30, weight: 6, xp: 60, size: 'medium',
  element: 'light',
  behavior: 'summoner',
  contactDamage: true,
  telegraphFloor: 0.8,
  visual: {
    shape: 'star', color: '#ffd75e', accent: '#4a3300', size: 30,
    emoji: '🏆', outline: true, rotates: false, glow: true,
  },
  reward: { starFragments: 0, relic: false, chest: 'silver' },
  affixes: ['warded'],
  barks: { intro: 'Present. Present. Present. Present.' },
  phases: [
    { name: 'On The Register', hpFrom: 1.0, hpTo: 0.0, speedMult: 1.0,
      attacks: ['roll_call_summon', 'gleam'] },
  ],
  attacks: {
    roll_call_summon: {
      name: 'Roll Call', kind: 'summonAdds', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 6, damage: 0,
      params: { spawns: [{ enemy: 'mob_student', count: 6 }], radius: 180, pattern: 'ring' },
      desc: 'Six students every 6 seconds. It will do this until one of you stops.',
    },
    gleam: {
      name: 'Gleam', kind: 'aoeCircle', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 7, damage: 18,
      params: { radius: 170, followsBoss: true },
      desc: 'A 170px flash of polished brass. Deeply undeserved.',
    },
  },
};

// The comedy elite. No attacks, no contact damage, runs for its life, and pays
// out in upgrade capsules. Fleeing is expressed as a very wide orbit so no new
// behavior archetype is needed (DECISIONS.md §6 fixes the list at 15).
const GACHA_GOLEM = {
  id: 'gacha_golem',
  name: 'THE GACHA GOLEM',
  epithet: 'Ten-Pull Guaranteed',
  kind: 'elite',
  stage: 'neon_akiba',
  quote: '"It is running. It is running away. It is running away with your capsules."',
  hp: 1200, damage: 0, speed: 128, weight: 3, xp: 140, size: 'medium',
  element: 'steel',
  behavior: 'orbiter',
  contactDamage: false,
  telegraphFloor: 0.8,
  visual: {
    shape: 'square', color: '#ff5ea8', accent: '#2a0a1a', size: 34,
    emoji: '🎰', outline: true, rotates: false, glow: true,
  },
  reward: { starFragments: 0, relic: false, chest: 'gold', capsules: 3 },
  affixes: ['warded', 'frenzied'],
  barks: { intro: 'Ka-CHUNK. (it does not want to talk about it)' },
  phases: [
    { name: 'Rate-Up Fleeing', hpFrom: 1.0, hpTo: 0.0, speedMult: 1.0, attacks: [] },
  ],
  // Deliberately empty. The three-attack rule is a BOSS rule; this thing's whole
  // joke is that it never fights back, and 1,200 HP at 128px/s is the fight.
  attacks: {},
  flee: { orbitRadius: 520, orbitSpeed: 128, panicRadius: 300, panicSpeedMult: 1.35 },
};

const ABNORMAL = {
  id: 'abnormal',
  name: 'ABNORMAL',
  epithet: 'It Is Not Looking At Anyone Else',
  kind: 'elite',
  stage: 'wall_amaris',
  quote: '"It sprints past everything else in the ruin. It has chosen you specifically."',
  hp: 950, damage: 34, speed: 168, weight: 4, xp: 200, size: 'medium',
  element: 'spirit',
  behavior: 'chaser',
  contactDamage: true,
  telegraphFloor: 0.8,
  visual: {
    shape: 'capsule', color: '#d8b48c', accent: '#2b1d12', size: 32,
    emoji: '😀', outline: true, rotates: false, glow: false,
  },
  reward: { starFragments: 0, relic: false, chest: 'silver' },
  affixes: ['frenzied'],
  barks: { intro: '(it is smiling. that is just its face. that does not help.)' },
  phases: [
    { name: 'Beelining', hpFrom: 1.0, hpTo: 0.0, speedMult: 1.0,
      attacks: ['nape_weak_point', 'erratic_sprint'] },
  ],
  attacks: {
    nape_weak_point: {
      name: 'Nape', kind: 'weakPoint', telegraph: 0,
      telegraphColor: 'blue', cooldown: 0, damage: 0,
      // Not a shielder, so DECISIONS.md §31's 90 deg/s cap does not apply — it
      // turns at 149 deg/s. Flanking it is a real ask, which is the point.
      params: { multiplier: 3.0, arc: 1.2, facing: 'rear', turnRate: 2.6, facingLag: 0.25 },
      desc: 'A 69 degree rear arc takes 3x. It turns at 149 deg/s, so you get one clean pass.',
    },
    erratic_sprint: {
      name: 'Erratic Sprint', kind: 'chargeDash', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 3.5, damage: 34,
      params: { dashes: 1, speed: 900, distance: 520, erratic: true, turnBetween: true },
      desc: '520px at 900px/s, on a line that is only mostly toward you.',
    },
  },
};

const SEALED_VESSEL = {
  id: 'sealed_vessel',
  name: 'THE SEALED VESSEL',
  epithet: 'One Seal At A Time',
  kind: 'elite',
  stage: 'hidden_ember',
  quote: '"Do you know how many seals are on me? Neither do I. Let us find out."',
  hp: 1500, damage: 18, speed: 26, weight: 8, xp: 300, size: 'medium',
  element: 'spirit',
  behavior: 'summoner',
  contactDamage: true,
  telegraphFloor: 0.8,
  visual: {
    shape: 'diamond', color: '#b58cff', accent: '#1c1030', size: 34,
    emoji: '📿', outline: true, rotates: false, glow: true,
  },
  reward: { starFragments: 0, relic: false, chest: 'silver' },
  affixes: ['warded', 'chilling'],
  barks: { intro: 'That is one. There are more. There are so many more.' },
  phases: [
    { name: 'Bound In Paper', hpFrom: 1.0, hpTo: 0.0, speedMult: 1.0,
      attacks: ['break_seal', 'chain_lash', 'unseal_shades'] },
  ],
  attacks: {
    break_seal: {
      name: 'Break A Seal', kind: 'aoeCircle', telegraph: 1.0,
      telegraphColor: 'yellow', cooldown: 12, damage: 0,
      // A zero-damage arena-wide pulse carrying a buff payload instead of damage.
      // Kill it fast or the run gets ugly — five stacks is +50% enemy damage.
      params: {
        radius: 4000, global: true,
        buff: { damageMult: 0.10, speedMult: 0.08, stacks: true, maxStacks: 5, appliesTo: 'allEnemies' },
      },
      desc: 'Every 12s: +10% damage and +8% speed to EVERY enemy on screen. Stacks 5 times.',
    },
    chain_lash: {
      name: 'Chain Lash', kind: 'rotatingSweep', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 8, damage: 26,
      params: { arms: 2, length: 320, angularSpeed: 1.8, duration: 2.5, width: 56 },
      desc: 'Two chains, 320px, 103 deg/s. It is not trying to hit you, only to keep you off.',
    },
    unseal_shades: {
      name: 'Unseal', kind: 'summonAdds', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 14, damage: 0,
      params: {
        spawns: [{ enemy: 'genin_shade', count: 4 }, { enemy: 'ambusher', count: 2 }],
        radius: 260, pattern: 'ring',
      },
      desc: 'Whatever was in the last seal is out now and it is behind you.',
    },
  },
};

const UPPER_RANK_REMNANT = {
  id: 'upper_rank_remnant',
  name: 'UPPER RANK REMNANT',
  epithet: 'A Number Nobody Remembers',
  kind: 'elite',
  stage: 'tatami_halls',
  quote: '"I was Upper Rank... something. It will come to me. Hold still."',
  hp: 2300, damage: 30, speed: 88, weight: 5, xp: 460, size: 'medium',
  element: 'shadow',
  behavior: 'dasher',
  contactDamage: true,
  telegraphFloor: 0.8,
  visual: {
    shape: 'crescent', color: '#ff4f8b', accent: '#25060f', size: 32,
    emoji: '🌙', outline: true, rotates: false, glow: true,
  },
  reward: { starFragments: 0, relic: false, chest: 'silver' },
  affixes: ['frenzied', 'reflective'],
  barks: { intro: 'Oh, this one has a dash. Everyone has a dash now.' },
  // Fires as a speech bubble every time it dodges. Cocky, never cruel.
  taunts: [
    'Was that it?',
    'I have seen better footwork from a door.',
    'Do that again, but slower, so I can enjoy it.',
    'You are telegraphing. That is MY job.',
    'Honestly? Close. Genuinely close.',
  ],
  phases: [
    { name: 'Still Here Somehow', hpFrom: 1.0, hpTo: 0.0, speedMult: 1.0,
      attacks: ['mimic_escape', 'remnant_fan', 'blood_slash'] },
  ],
  attacks: {
    mimic_escape: {
      name: 'Mimic', kind: 'mirrorPlayer', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 5, damage: 0,
      params: { powerMult: 1.0, source: 'escape', copiesIframes: true, tauntChance: 1.0 },
      desc: 'It uses YOUR escape move, i-frames and all, and then it comments on it.',
    },
    remnant_fan: {
      name: 'Remnant Fan', kind: 'projectileSpread', telegraph: 0.9,
      telegraphColor: 'yellow', cooldown: 4.5, damage: 24,
      params: { count: 7, arc: 1.3, speed: 360, life: 2.8 },
      desc: 'Seven blades in a 74 degree fan. Half-remembered, still sharp.',
    },
    blood_slash: {
      name: 'Blood Slash', kind: 'lineSweep', telegraph: 1.0,
      telegraphColor: 'red', cooldown: 7, damage: 30,
      params: { columns: 1, width: 110, sweepSpeed: 640, axis: 'toPlayer' },
      desc: 'One 110px line at 640px/s, drawn straight through wherever you are standing.',
    },
  },
};

// DECISIONS.md §30: this is NOT the tier-3 `encore_siren` mob. Different id,
// different stats, and this one shields as well as heals.
const ELITE_ENCORE_SIREN = {
  id: 'elite_encore_siren',
  name: 'THE ENCORE SIREN',
  epithet: 'One More Song',
  kind: 'elite',
  stage: 'sunken_reef',
  quote: '"They came to see ME. You are the opening act and you are running long."',
  hp: 3600, damage: 22, speed: 40, weight: 5, xp: 720, size: 'medium',
  element: 'water',
  behavior: 'healer',
  contactDamage: true,
  telegraphFloor: 0.8,
  visual: {
    shape: 'ring', color: '#5fd6ff', accent: '#062a3d', size: 34,
    emoji: '🎤', outline: true, rotates: false, glow: true,
  },
  reward: { starFragments: 0, relic: false, chest: 'silver' },
  affixes: ['warded', 'vampiric'],
  barks: { intro: 'One more song. One more. One more. One more.' },
  phases: [
    { name: 'The Long Note', hpFrom: 1.0, hpTo: 0.0, speedMult: 1.0,
      attacks: ['encore_song', 'sonic_wave', 'feedback_screech'] },
  ],
  attacks: {
    encore_song: {
      name: 'Encore', kind: 'shieldPhase', telegraph: 1.0,
      telegraphColor: 'yellow', cooldown: 10, damage: 0,
      params: {
        duration: 6, radius: 300, healPerSecond: 22, shieldPercent: 0.25,
        appliesTo: 'allies', interruptDamage: 300, interruptWindow: 2,
      },
      desc: 'Heals 22/s and shields 25% inside 300px. Deal 300 damage in 2s to cut the song.',
    },
    sonic_wave: {
      name: 'Sonic Wave', kind: 'radialBurst', telegraph: 1.0,
      telegraphColor: 'red', safeColor: 'blue', cooldown: 7, damage: 26,
      params: { rings: 2, projectiles: 16, speed: 280, gapArc: 0.6, ringDelay: 0.6 },
      desc: 'Two rings, one gap each, 0.6s apart. She is not even looking at you.',
    },
    feedback_screech: {
      name: 'Feedback Screech', kind: 'coneBreath', telegraph: 0.9,
      telegraphColor: 'red', cooldown: 9, damage: 24,
      params: { angle: 1.2, range: 620, duration: 1.4, tickRate: 0.25 },
      desc: 'A 620px cone of blown monitor for 1.4s. The reef does not have a sound engineer.',
    },
  },
};

// DECISIONS.md §7. Stage 7's missing named elite, and the tell for the Final
// Form: your own silhouette, auto-attack only, 60% power. No contact damage —
// it is a rehearsal, and rehearsals are readable.
const THE_UNDERSTUDY = {
  id: 'the_understudy',
  name: 'THE UNDERSTUDY',
  epithet: 'Same Costume, No Lines',
  kind: 'elite',
  stage: 'zenith_stage',
  quote: '"It has your silhouette. It is holding your weapon. It says nothing at all."',
  hp: 5600, damage: 0, speed: 165, weight: 6, xp: 1100, size: 'medium',
  element: 'shadow',
  behavior: 'chaser',
  contactDamage: false,
  telegraphFloor: 0.8,
  visual: {
    shape: 'capsule', color: '#2a2438', accent: '#ffffff', size: 30,
    emoji: '🕴', outline: true, rotates: false, glow: false,
  },
  reward: { starFragments: 0, relic: false, chest: 'gold' },
  // No affixes. Wearing your build is the affix.
  affixes: [],
  barks: { intro: '(it stands where you stood four seconds ago and copies the pose)' },
  phases: [
    { name: 'Understudy', hpFrom: 1.0, hpTo: 0.0, speedMult: 1.0, attacks: ['mirror_auto_60'] },
  ],
  attacks: {
    mirror_auto_60: {
      name: 'Your Auto-Attack', kind: 'mirrorPlayer', telegraph: 0.8,
      telegraphColor: 'yellow', cooldown: 0, damage: 0,
      params: { powerMult: 0.6, source: 'autoAttack', copiesUpgrades: true, copiesRelics: false },
      desc: 'Your auto-attack at 60%, with your upgrades but not your relics. It moves at 165px/s. So do you.',
    },
  },
};

// =============================================================================
// THE SWEEPER — DECISIONS.md §13 (this, not either Director, is what SECTION 2
// means) and §21 (spawns at duration + 180s if the final boss is still alive).
// Unkillable, accelerating, one-shot. Surviving him 60s is a hidden achievement
// worth 200 fragments and a costume tint (DECISIONS.md §24).
//
// JUDGEMENT CALL: he deals his one-shot through a permanently telegraphed white
// aura rather than through contactDamage, so all damage in the game still comes
// from one readable, single-choke-point source. Same outcome, no silent touch.
// =============================================================================
const STAGE_MANAGER = {
  id: 'stage_manager',
  name: 'THE STAGE MANAGER',
  epithet: "That's A Wrap",
  kind: 'sweeper',
  stage: null,
  quote: '"That\'s a wrap."',
  hp: 999999, damage: 99999, speed: 90, weight: 999, xp: 0, size: 'large',
  element: 'shadow',
  behavior: 'chaser',
  contactDamage: false,
  invulnerable: true,
  telegraphFloor: 0.8,
  visual: {
    shape: 'capsule', color: '#e8e8ea', accent: '#101014', size: 46,
    emoji: '📋', outline: true, rotates: false, glow: false,
  },
  reward: { starFragments: 0, relic: false, chest: null },
  mechanic: {
    kind: 'unkillableSweeper',
    params: {
      invulnerable: true, spawnAfterSeconds: 180, spawnRelativeTo: 'stageDuration',
      startSpeed: 90, accelPerSecond: 6, maxSpeed: 420,
      oneShot: true, ignoresObstacles: true, ignoresKnockback: true, ignoresStatusEffects: true,
    },
  },
  // Cross-reference only — achievements.js OWNS this row. The id, name and reward
  // below must match `survive_stage_manager` there exactly; tests/data.test.js
  // asserts it, because a sweeper pointing at an achievement id that does not
  // exist means the hidden reward can never pay out.
  achievement: {
    id: 'survive_stage_manager',
    name: 'Not In The Script',
    condition: 'Survive 60 seconds with The Stage Manager on screen',
    reward: { starFragments: 200, costume: 'nekromina' },
  },
  barks: {
    intro: "That's a wrap.",
    phase2: 'We are into overtime. Somebody is paying for this.',
    phase3: 'I said. That is. A WRAP.',
  },
  // Phases are keyed on time-on-screen, not HP — he does not have HP in any
  // sense that matters. Named anyway, because the health bar still says so.
  phases: [
    { name: 'Places, Please', timeFrom: 0, timeTo: 20, speedMult: 1.0, attacks: ['call_time'] },
    { name: 'We Are Over Time', timeFrom: 20, timeTo: 45, speedMult: 1.6, attacks: ['call_time'] },
    { name: "THAT'S A WRAP", timeFrom: 45, timeTo: 9999, speedMult: 2.6, enrage: true, attacks: ['call_time'] },
  ],
  attacks: {
    call_time: {
      name: 'Call Time', kind: 'aoeCircle', telegraph: 0.8,
      telegraphColor: 'white', cooldown: 0, damage: 99999,
      params: { radius: 46, followsBoss: true, permanent: true, oneShot: true },
      desc: 'A 46px white ring that never switches off. Touching it ends the run. Run.',
    },
  },
};

// =============================================================================
// EXPORTS
// =============================================================================

export const BOSSES = [
  // 7 stage bosses, in stage order
  STUDENT_COUNCIL_PRESIDENT, THE_ALGORITHM, THE_COLOSSUS, THE_SEALED_BEAST,
  KAGUTSUCHI, THE_KRAKEN_PRODUCER, THE_FINAL_FORM,
  // 7 mid-bosses, in stage order
  DELINQUENT_SENPAI, MASCOT_PRIME, THE_ARMORED, THE_TWIN_FANGS, THE_DRUM_ONI,
  TIDE_WARDEN, THE_OPENING_ACT,
  // 7 named elites, in stage order
  PERFECT_ATTENDANCE_AWARD, GACHA_GOLEM, ABNORMAL, SEALED_VESSEL,
  UPPER_RANK_REMNANT, ELITE_ENCORE_SIREN, THE_UNDERSTUDY,
  // the sweeper
  STAGE_MANAGER,
];

export const BOSSES_BY_ID = {
  student_council_president: STUDENT_COUNCIL_PRESIDENT,
  the_algorithm: THE_ALGORITHM,
  the_colossus: THE_COLOSSUS,
  the_sealed_beast: THE_SEALED_BEAST,
  kagutsuchi: KAGUTSUCHI,
  the_kraken_producer: THE_KRAKEN_PRODUCER,
  the_final_form: THE_FINAL_FORM,
  delinquent_senpai: DELINQUENT_SENPAI,
  mascot_prime: MASCOT_PRIME,
  the_armored: THE_ARMORED,
  the_twin_fangs: THE_TWIN_FANGS,
  the_drum_oni: THE_DRUM_ONI,
  tide_warden: TIDE_WARDEN,
  the_opening_act: THE_OPENING_ACT,
  perfect_attendance_award: PERFECT_ATTENDANCE_AWARD,
  gacha_golem: GACHA_GOLEM,
  abnormal: ABNORMAL,
  sealed_vessel: SEALED_VESSEL,
  upper_rank_remnant: UPPER_RANK_REMNANT,
  elite_encore_siren: ELITE_ENCORE_SIREN,
  the_understudy: THE_UNDERSTUDY,
  stage_manager: STAGE_MANAGER,
};

export const BOSS_IDS = [
  'student_council_president', 'the_algorithm', 'the_colossus', 'the_sealed_beast',
  'kagutsuchi', 'the_kraken_producer', 'the_final_form',
];

export const MIDBOSS_IDS = [
  'delinquent_senpai', 'mascot_prime', 'the_armored', 'the_twin_fangs',
  'the_drum_oni', 'tide_warden', 'the_opening_act',
];

export const NAMED_ELITE_IDS = [
  'perfect_attendance_award', 'gacha_golem', 'abnormal', 'sealed_vessel',
  'upper_rank_remnant', 'elite_encore_siren', 'the_understudy',
];

export const SWEEPER_ID = 'stage_manager';

// Stage -> its three hand-authored encounters. stages.js reads this rather than
// repeating the ids, so a rename can only ever break in one place.
export const ENCOUNTERS_BY_STAGE = {
  cherry_academy: { boss: 'student_council_president', midBoss: 'delinquent_senpai', elite: 'perfect_attendance_award' },
  neon_akiba:     { boss: 'the_algorithm',             midBoss: 'mascot_prime',      elite: 'gacha_golem' },
  wall_amaris:    { boss: 'the_colossus',              midBoss: 'the_armored',       elite: 'abnormal' },
  hidden_ember:   { boss: 'the_sealed_beast',          midBoss: 'the_twin_fangs',    elite: 'sealed_vessel' },
  tatami_halls:   { boss: 'kagutsuchi',                midBoss: 'the_drum_oni',      elite: 'upper_rank_remnant' },
  sunken_reef:    { boss: 'the_kraken_producer',       midBoss: 'tide_warden',       elite: 'elite_encore_siren' },
  zenith_stage:   { boss: 'the_final_form',            midBoss: 'the_opening_act',   elite: 'the_understudy' },
};
