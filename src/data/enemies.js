// ENEMIES — 51 types + the 8 elite affixes.
//
// SECTION 9 stats 23 of these; their stat lines are reproduced VERBATIM
// (hp / damage / speed / behavior). Nine more are named in stage mob tables with
// no stats anywhere and three are split-children that only ever appear on a
// parent's death — all twelve are authored here in full (DECISIONS.md §5),
// interpolated to sit inside the range their tier already occupies.
//
// SIXTEEN ARE NEW, and none of them is a recolour.
// -----------------------------------------------
// Play report: "make more unique mobs, quicker ones, different ability types,
// smaller ones, bigger ones, etc so that the gameplay feels more different and
// more challenging specifically for the later levels."
//
// So the additions are organised along the three axes that report names, and
// every one of them is gated LATE — every new row in a stage mob table opens
// after minute seven at the earliest, and most of them after minute ten, so the
// back half of a run stops being the front half with bigger numbers:
//
//   SPEED    Four tier-1 harassers at 124-142 base speed, which is faster than
//            anything below tier 3 was, and three tier-3 heavies at 22-36 —
//            slower than any existing threat. Both ends are new; the middle of
//            the roster was already crowded.
//   SIZE     Four mobs well UNDER the fodder grid (visual size 7-8 against the
//            old floor of 9) and four LARGE ones at 26-28. `size` drives the
//            sprite grid AND the hitbox, and on Stage 3 it also decides whether
//            "Titan's Shadow" doubles the HP — so it is never decoration.
//   ABILITY  Six new archetypes, in game/enemy.js: mortar, sower, conductor,
//            watcher, tethered, strafer. The reasoning for each is on the
//            BEHAVIORS block there; the short version is that the first fifteen
//            were all answers to "how does it come at you", and these six are
//            answers to "what does it take away" — range, floor, the crowd's
//            tempo, the option to stand still, the option to kill it first, and
//            the assumption that the screen shows you everything dangerous.
//
// FIELD CONVENTIONS
//   hp / damage / speed  base values at t=0. SECTION 8 scaling (enemyHp k=0.115,
//                        enemyDamage k=0.06, enemySpeed k=0.012 capped 1.5x) is
//                        applied at spawn time by the engine, never baked here.
//   weight               knockback resistance, not mass. 1 = shoved across the
//                        screen, 16 = barely nudges. `static` mobs use 99.
//   xp                   base gem value before xpValue(t) scaling.
//   goldChance           P(drop a coin) per kill, 0..1.
//   element              DECISIONS.md §26 — elements are a real ±15% system now,
//                        shown in the codex and on the damage number's tint.
//   size                 small | medium | large. Stage 3's "Titan's Shadow"
//                        modifier keys off `large`, so it is load-bearing.
//   params               ONLY the keys that enemy's archetype actually reads.
//   spawnable:false      split-children. Never rolled by a wave event or by the
//                        Splitting affix; reachable only via a parent's death.
//
// No `ref` strings live here. Every ref in the project is in src/data/refs.js,
// keyed by entity id (DECISIONS.md §22).

export const ENEMIES = [

  // ==========================================================================
  // TIER 1 — FODDER
  // They exist to be mowed down. By minute 12 a built player one-shots all of
  // these, which is the point (SECTION 8: "if minute 18 feels like minute 3,
  // you have failed").
  // ==========================================================================

  {
    id: 'mob_student', name: 'Mob Student', tier: 1,
    size: 'small',
    hp: 10, damage: 5, speed: 58, weight: 1, xp: 1, goldChance: 0.04,
    behavior: 'chaser',
    // Spirit is the neutral element both ways (§26) — the very first enemy in
    // the game must never teach the player a matchup they can't see yet.
    element: 'spirit',
    visual: { shape: 'circle', color: '#9aa3b8', accent: '#3a4155', emoji: '👤', size: 13 },
    params: {},
    codex: 'Has no name, no lines, and no idea why the trophy is glowing.',
  },

  {
    id: 'chibi_ghost', name: 'Chibi Ghost', tier: 1,
    size: 'small',
    hp: 8, damage: 4, speed: 70, weight: 1, xp: 1, goldChance: 0.03,
    behavior: 'swarmer',
    element: 'shadow',
    visual: { shape: 'circle', color: '#cfd6ff', accent: '#2a2f52', emoji: '👻', size: 12 },
    // sineAmp/sineFreq are the "floats, slight sine wave" from SECTION 9 —
    // a lateral wobble layered on top of the swarmer's flocking separation.
    params: { packSize: 10, sineAmp: 18, sineFreq: 2.2 },
    codex: 'Died of embarrassment in 1997. Still floating about it.',
  },

  {
    id: 'slime_kouhai', name: 'Slime Kouhai', tier: 1,
    size: 'small',
    hp: 12, damage: 5, speed: 52, weight: 1, xp: 1, goldChance: 0.05,
    behavior: 'swarmer',
    element: 'water',
    visual: { shape: 'circle', color: '#6fd3e8', accent: '#17516b', emoji: '💧', size: 13 },
    // "splits once into 2 tiny slimes" — splitDepth 1 means the children are
    // terminal. Depth is decremented per generation so no splitter can ever
    // become the unbounded cascade DECISIONS.md §25 is guarding against.
    params: { packSize: 8, splitInto: 'tiny_slime', splitCount: 2, splitDepth: 1 },
    codex: 'Calls you senpai while dissolving your shoes.',
  },

  {
    id: 'crow_familiar', name: 'Crow Familiar', tier: 1,
    size: 'small',
    hp: 9, damage: 6, speed: 95, weight: 1, xp: 1, goldChance: 0.04,
    behavior: 'orbiter',
    element: 'shadow',
    visual: { shape: 'triangle', color: '#25293a', accent: '#6f7ae0', emoji: '🐦', size: 11 },
    params: { orbitRadius: 120, orbitSpeed: 2.6 },
    codex: 'Delivers messages. None of them are for you.',
  },

  {
    id: 'gacha_zombie', name: 'Gacha-Addict Zombie', tier: 1,
    size: 'small',
    hp: 12, damage: 6, speed: 62, weight: 1, xp: 1, goldChance: 0.06,
    behavior: 'swarmer',
    element: 'shadow',
    visual: { shape: 'circle', color: '#8fa2c9', accent: '#2b3452', emoji: '🧟', size: 14 },
    params: { packSize: 12 },
    codex: 'Went 0-for-90 on a rate-up banner and simply never recovered.',
  },

  {
    id: 'husk_wanderer', name: 'Husk Wanderer', tier: 1,
    size: 'medium',
    hp: 20, damage: 8, speed: 40, weight: 3, xp: 2, goldChance: 0.05,
    behavior: 'chaser',
    element: 'spirit',
    visual: { shape: 'capsule', color: '#d8c2a6', accent: '#6a4a33', emoji: '🙂', size: 18 },
    params: {},
    codex: 'Walks at 40 pixels per second. Has all the time in the world.',
  },

  {
    id: 'chalk_wraith', name: 'Chalk Wraith', tier: 1,
    size: 'small',
    hp: 14, damage: 6, speed: 66, weight: 1, xp: 1, goldChance: 0.04,
    behavior: 'chaser',
    element: 'spirit',
    visual: { shape: 'circle', color: '#eef1f6', accent: '#8a939f', emoji: '🌫️', size: 13 },
    // The smear is a readable Stage-1 teaching hazard: it slows 18% for 3s so a
    // new player learns "don't stand in the coloured stuff" before Stage 2 makes
    // it lethal. Trail params are authored here, not in the archetype.
    params: { trailRadius: 26, trailDuration: 3, trailSlow: 0.18 },
    codex: 'Erased from the register, the yearbook, and the group chat.',
  },

  {
    id: 'neon_otaku', name: 'Neon Otaku', tier: 1,
    size: 'small',
    hp: 16, damage: 6, speed: 58, weight: 2, xp: 1, goldChance: 0.10,
    behavior: 'swarmer',
    element: 'lightning',
    visual: { shape: 'circle', color: '#ff7de3', accent: '#2a1140', emoji: '🛍️', size: 14 },
    // Slower and beefier than the other tier-1 swarmers (the bags), paid back
    // with the highest gold chance in the tier — Stage 2's crowd is the payday.
    params: { packSize: 14 },
    codex: 'Six bags of merch, zero peripheral vision.',
  },

  // --------------------------------------------------------------------------
  // TIER 1 — THE SMALL FAST ONES
  //
  // Four mobs that are deliberately BELOW the fodder floor in every dimension
  // except speed. `visual.size` 7-8 against tier 1's old floor of 9, and 124-142
  // base speed against its old ceiling of 95 — so they are the first thing in
  // the game that outruns the player's 165 once SECTION 8's speed scaling has
  // had ten minutes to work on them.
  //
  // They exist for the late game even though they are tier 1: every stage table
  // gates them past minute eight (see the `from` values in stages.js), where
  // their job is not damage but ATTENTION. A player at minute fourteen has one
  // build and four screens of things to look at, and a pack of these is the one
  // that arrives before you have finished looking at the others.
  //
  // Priced as fodder because they die as fodder: one hit each, xp 1, and a gold
  // chance at the bottom of the tier. A late mob should threaten, not pay.
  // --------------------------------------------------------------------------

  {
    id: 'eraser_gremlin', name: 'Eraser Gremlin', tier: 1,
    size: 'small',
    hp: 11, damage: 5, speed: 124, weight: 1, xp: 1, goldChance: 0.03,
    behavior: 'swarmer',
    element: 'spirit',
    visual: { shape: 'square', color: '#f2e9dc', accent: '#6a5f52', emoji: '🩹', size: 8 },
    // Tighter, faster wobble than the Chibi Ghost's: at this speed the ghost's
    // 2.2Hz weave reads as a wide arc and the pack stops looking like a pack.
    // `maxAlive` is the concurrency ceiling, enforced in game/enemy.js's spawn()
    // — the timeline may ask for 44 of these at once (waves.js) and it will get
    // 30. `pass*` is the run-THROUGH: at 88px it commits to a heading, crosses
    // at 1.7x for 0.45s and comes out the far side rather than parking on the
    // player. Play report: "too many at once causing lag ... make them go at the
    // player quicker so they dont stack on top of each other." Both halves.
    params: {
      packSize: 24, sineAmp: 10, sineFreq: 3.6, maxAlive: 30,
      passLock: 88, passSpeed: 1.7, passTime: 0.45, passRecover: 0.35,
    },
    codex: 'Removes what you wrote, then what you meant, then you.',
  },

  {
    id: 'splinter_husk', name: 'Splinter Husk', tier: 1,
    size: 'small',
    hp: 16, damage: 7, speed: 136, weight: 1, xp: 1, goldChance: 0.04,
    behavior: 'swarmer',
    element: 'spirit',
    visual: { shape: 'triangle', color: '#d0bda4', accent: '#5c4230', emoji: '😬', size: 8 },
    // The deliberate counterweight to Stage 3's entire thesis. That stage is
    // built out of 26-to-40 speed walls of Husk Wanderers and Crawler Husks; a
    // knee-high one at 136 is the same silhouette family arriving four times
    // sooner, which is a much nastier surprise than a new silhouette would be.
    params: {
      packSize: 26, maxAlive: 32,
      passLock: 90, passSpeed: 1.7, passTime: 0.5, passRecover: 0.35,
    },
    codex: 'Knee-high, mouth first, and it got here before the tall ones.',
  },

  {
    id: 'ember_sprite', name: 'Ember Sprite', tier: 1,
    size: 'small',
    hp: 10, damage: 9, speed: 130, weight: 1, xp: 2, goldChance: 0.05,
    behavior: 'exploder',
    element: 'fire',
    visual: { shape: 'diamond', color: '#ffb03d', accent: '#7a2f10', emoji: '🔥', size: 8, glow: true },
    // A Jellyfish Chorus costs 25 HP, 3 seconds of fuse and a 90px blast. This
    // costs 10 HP, half the fuse and a 56px blast, and it CANNOT chain — a fast
    // chaining exploder on a covered screen is a screen-wide detonation with a
    // 0.35s warning, which is the exact thing DECISIONS.md §25 keeps saying no
    // to. Small blast, short fuse, no chain: it is a mine that runs at you.
    // No pass-through: `exploder` owns aiState, and a mine that runs PAST you is
    // not the enemy this is. It gets the concurrency cap only — 34 fast
    // exploders arriving together (waves.js) is the one case where the count
    // alone is the problem.
    params: { fuse: 1.6, blastRadius: 56, blastDamage: 9, chains: false, maxAlive: 24 },
    codex: 'Small, bright, and briefly very close to your face.',
  },

  {
    id: 'bait_ball', name: 'Bait Ball', tier: 1,
    size: 'small',
    hp: 9, damage: 5, speed: 142, weight: 1, xp: 1, goldChance: 0.03,
    behavior: 'swarmer',
    element: 'water',
    visual: { shape: 'circle', color: '#9fe8ff', accent: '#0d4a63', emoji: '🐠', size: 7, glow: true },
    // The fastest and smallest thing in the game. Stage 6's high tide takes 20%
    // off everything's move speed, so this is tuned to still be a harasser at
    // 114 — the trough is when it becomes genuinely difficult to leave behind.
    // The fastest thing in the game, and the one the play report is loudest
    // about: waves.js asks for 52 of these at 0.89 of Stage 6 and 50 more at
    // 0.89 of Stage 7. 36 is the whole shoal's worth; the 37th simply does not
    // spawn. 142 * 1.7 * 0.55 = 133px of travel from a 96px lock, so it is
    // through and past before the second contact tick lands.
    params: {
      packSize: 34, sineAmp: 22, sineFreq: 3.0, maxAlive: 36,
      passLock: 96, passSpeed: 1.7, passTime: 0.55, passRecover: 0.35,
    },
    codex: 'Not a fish. Four hundred fish agreeing about a direction.',
  },

  // ==========================================================================
  // TIER 2 — PRESSURE
  // These require positioning. Every one of them punishes standing still.
  // ==========================================================================

  {
    id: 'cursed_desk', name: 'Cursed Desk', tier: 2,
    size: 'medium',
    hp: 40, damage: 14, speed: 45, weight: 4, xp: 4, goldChance: 0.09,
    behavior: 'charger',
    element: 'spirit',
    visual: { shape: 'square', color: '#a9743f', accent: '#4a2d16', emoji: '🪑', size: 17 },
    // SECTION 9's "45/240" = walk speed 45, dash speed 240, on the archetype's
    // standard 0.8s telegraph.
    params: { telegraph: 0.8, dashSpeed: 240, dashRange: 420, chargeCooldown: 3 },
    codex: 'One hundred years of carved initials. It remembers every one.',
  },

  {
    id: 'kunai_bat', name: 'Kunai Bat', tier: 2,
    size: 'small',
    hp: 28, damage: 9, speed: 80, weight: 2, xp: 4, goldChance: 0.08,
    behavior: 'ranged',
    element: 'steel',
    visual: { shape: 'triangle', color: '#4a4a63', accent: '#1b1c28', emoji: '🦇', size: 12 },
    params: { range: 350, fireInterval: 2.0, projectileCount: 3, spreadArc: 0.5, projectileSpeed: 330 },
    codex: 'Echolocates by throwing knives and listening for the scream.',
  },

  {
    id: 'camera_drone', name: 'Camera Drone', tier: 2,
    size: 'small',
    hp: 32, damage: 10, speed: 90, weight: 2, xp: 5, goldChance: 0.10,
    behavior: 'ranged',
    element: 'lightning',
    visual: { shape: 'hex', color: '#cfd8e8', accent: '#2b3a55', emoji: '📷', size: 13, glow: true },
    // A "slow tracking laser": low projectile speed, high homing — dodgeable by
    // moving, undodgeable by tanking. homing is turn rate in rad/s.
    params: { range: 350, fireInterval: 2.6, projectileCount: 1, projectileSpeed: 150, homing: 0.9 },
    codex: 'Filming this for the algorithm. You are not the main character.',
  },

  {
    id: 'mascot_suit', name: 'Mascot Suit', tier: 2,
    size: 'large',
    hp: 90, damage: 16, speed: 35, weight: 10, xp: 7, goldChance: 0.12,
    behavior: 'tank',
    element: 'spirit',
    visual: { shape: 'circle', color: '#ffd166', accent: '#5a3d0a', emoji: '🐻', size: 22 },
    params: {},
    codex: 'Nobody has seen the mascot’s operator since the summer festival.',
  },

  {
    id: 'jellyfish_chorus', name: 'Jellyfish Chorus', tier: 2,
    size: 'medium',
    hp: 25, damage: 22, speed: 55, weight: 1, xp: 5, goldChance: 0.09,
    behavior: 'exploder',
    element: 'water',
    visual: { shape: 'circle', color: '#b28cff', accent: '#3b1f6e', emoji: '🪼', size: 15, glow: true },
    // "chains": a blast lights the fuse of any other jellyfish caught in it,
    // 0.25s later. chainDelay is what makes the cascade readable instead of
    // a single instant screen-wide detonation.
    params: { fuse: 3, blastRadius: 90, blastDamage: 22, chains: true, chainDelay: 0.25 },
    codex: 'Drifts, hums, detonates. In that order, always on the beat.',
  },

  {
    id: 'genin_shade', name: 'Genin Shade', tier: 2,
    size: 'medium',
    hp: 35, damage: 12, speed: 70, weight: 2, xp: 5, goldChance: 0.09,
    behavior: 'dasher',
    element: 'shadow',
    visual: { shape: 'capsule', color: '#3b4a63', accent: '#12161f', emoji: '🥷', size: 15 },
    params: { blinkInterval: 3, blinkDist: 150 },
    codex: 'Failed the exam three times. Learned to blink instead.',
  },

  {
    id: 'coral_crab', name: 'Coral Crab', tier: 2,
    size: 'medium',
    hp: 60, damage: 13, speed: 45, weight: 6, xp: 6, goldChance: 0.11,
    behavior: 'shielder',
    element: 'water',
    visual: { shape: 'hex', color: '#ff8a6b', accent: '#6d2418', emoji: '🦀', size: 16 },
    // DECISIONS.md §31 — turnRate 1.57 rad/s (90°/s) + 0.4s facing lag. Without
    // these a shielder simply always faces you and "flank it" is a lie.
    params: { shieldArc: 1.6, shieldReduction: 0.9, turnRate: 1.57, facingLag: 0.4 },
    codex: 'Shield up front, opinions in the back.',
  },

  {
    id: 'antifan_swarm', name: 'Antifan Swarm', tier: 2,
    size: 'small',
    hp: 6, damage: 3, speed: 105, weight: 1, xp: 1, goldChance: 0.02,
    behavior: 'swarmer',
    element: 'shadow',
    visual: { shape: 'circle', color: '#6b7280', accent: '#171a20', emoji: '💬', size: 10 },
    params: {
      packSize: 25, maxAlive: 45,
      passLock: 76, passSpeed: 1.8, passTime: 0.6, passRecover: 0.4,
    },
    codex: 'Individually harmless. Statistically a wall of text.',
  },

  {
    id: 'gym_uniform_ghoul', name: 'Gym Uniform Ghoul', tier: 2,
    size: 'medium',
    hp: 34, damage: 11, speed: 58, weight: 2, xp: 4, goldChance: 0.07,
    behavior: 'chaser',
    element: 'spirit',
    visual: { shape: 'capsule', color: '#e7eaf0', accent: '#2f4f8a', emoji: '🏃', size: 15 },
    // "Endless laps, speeds up over time": +4.5 speed per second alive, capped
    // at 165 — it takes ~24s to become the fastest thing in Stage 1, which is
    // exactly long enough for the player to notice it happening.
    params: { rampPerSec: 4.5, speedCap: 165 },
    codex: 'Told to run laps until the teacher says stop. The teacher retired.',
  },

  {
    id: 'anglerfish_fan', name: 'Anglerfish Fan', tier: 2,
    size: 'medium',
    hp: 46, damage: 18, speed: 40, weight: 3, xp: 5, goldChance: 0.10,
    behavior: 'charger',
    element: 'light',
    visual: { shape: 'circle', color: '#26384a', accent: '#ffd75e', emoji: '🐟', size: 16, glow: true },
    // The lure is a soft 45px/s pull inside 260px — it never overrides input,
    // it just makes your retreat cost more than you budgeted for. Then the bite.
    params: { telegraph: 0.7, dashSpeed: 300, dashRange: 300, chargeCooldown: 3.5, lureRadius: 260, lurePull: 45 },
    codex: 'Front row seat, glowing penlight, terrible intentions.',
  },

  {
    id: 'crawler_husk', name: 'Crawler Husk', tier: 2,
    size: 'large',
    hp: 26, damage: 12, speed: 26, weight: 4, xp: 3, goldChance: 0.05,
    behavior: 'swarmer',
    element: 'spirit',
    visual: { shape: 'capsule', color: '#cbb49a', accent: '#5c4230', emoji: '😬', size: 20 },
    // Deliberately NOT ceiling_crawler. Slowest enemy in the game that still
    // moves, lowest HP of any large. Tagged `large` on purpose: Stage 3's
    // "Titan's Shadow" doubles its HP to 52 and triples its XP, which turns a
    // wall of these into the best XP event in the stage.
    params: { packSize: 18 },
    codex: 'Lost the legs, kept the smile, still arrives eventually.',
  },

  {
    id: 'lesser_oni', name: 'Lesser Oni', tier: 2,
    size: 'medium',
    hp: 75, damage: 18, speed: 78, weight: 4, xp: 7, goldChance: 0.12,
    behavior: 'chaser',
    element: 'fire',
    visual: { shape: 'capsule', color: '#e05a4a', accent: '#4d1410', emoji: '👹', size: 16 },
    // Deliberately NOT oni_bruiser: a third of the HP, 30 speed faster, no slam.
    // Stage 5 opens with these so the bruiser's silhouette already means danger.
    params: {},
    codex: 'Too small for the drum, too fast for your positioning.',
  },

  // --------------------------------------------------------------------------
  // TIER 2 — WHERE THE FIVE NEW BEHAVIOURS ARE TAUGHT
  //
  // Every new archetype gets a cheap, legible, single-idea introduction here
  // before its tier-3 version turns up and means it. That is the same courtesy
  // the roster already extends to the Lesser Oni before the Oni Bruiser and to
  // the Chalk Wraith's slow before the Chilling affix's — you learn the shape
  // while it costs you 14 HP, not 30.
  // --------------------------------------------------------------------------

  {
    id: 'hall_monitor', name: 'Hall Monitor', tier: 2,
    size: 'medium',
    hp: 58, damage: 14, speed: 44, weight: 4, xp: 5, goldChance: 0.10,
    behavior: 'watcher',
    element: 'spirit',
    visual: { shape: 'capsule', color: '#dfe4ee', accent: '#3a4a7a', emoji: '📋', size: 16 },
    // The teaching stage's version, and the numbers are the teaching version's:
    // 2.4s of patience is long enough to notice, a 96px stand radius is one
    // comfortable sidestep, and 1.5x on a 14-damage statline is a scare rather
    // than a third of a health bar. Stage 1's tier-2 comment has claimed since
    // the first build that "every one of them punishes standing still" — this is
    // the first one that literally does.
    params: {
      standRadius: 96, patience: 2.4, telegraph: 1.0,
      strikeRadius: 112, strikeMult: 1.5, cooldown: 3.0,
    },
    codex: 'Writing your name down. Has been for a while now. Move.',
  },

  {
    id: 'courier_scooter', name: 'Courier Scooter', tier: 2,
    size: 'medium',
    hp: 48, damage: 15, speed: 72, weight: 3, xp: 6, goldChance: 0.12,
    behavior: 'strafer',
    element: 'lightning',
    visual: { shape: 'triangle', color: '#ffd23f', accent: '#2a1140', emoji: '🛵', size: 15 },
    // Deliberately on the stage that already owns a lane hazard: by the time
    // this arrives the player has spent twelve minutes learning that a yellow
    // line across the street means MOVE, and the Courier borrows that alphabet
    // instead of inventing one. Its dash is 620 against the truck's 900, so the
    // lane it draws is the same idea at a speed you can still contest.
    params: {
      runInterval: 6, telegraph: 1.0, dashSpeed: 620, runTime: 1.7, recover: 0.9,
    },
    codex: 'Thirty seconds late. Taking the pavement. The pavement is where you are.',
  },

  {
    id: 'hype_marshal', name: 'Hype Marshal', tier: 2,
    size: 'medium',
    hp: 72, damage: 8, speed: 50, weight: 3, xp: 7, goldChance: 0.14,
    behavior: 'conductor',
    element: 'lightning',
    visual: { shape: 'capsule', color: '#ff7de3', accent: '#2a1140', emoji: '📣', size: 16 },
    // The lowest contact damage of any tier-2 that is not a swarm mote, on
    // purpose: nothing this thing does to you is done by this thing. Its whole
    // threat is the 40-strong Akiba crowd around it moving 30% faster and
    // hitting 25% harder, and the moment it dies that goes away over half a
    // second — which is the cleanest "kill that one first" lesson in the game
    // that does not involve a healing beam.
    params: { rallyRadius: 250, hasteMult: 1.30, empowerMult: 1.25 },
    codex: 'Has never once been in the fight. Is the reason the fight is like this.',
  },

  {
    id: 'censer_shade', name: 'Censer Shade', tier: 2,
    size: 'medium',
    hp: 62, damage: 10, speed: 40, weight: 4, xp: 6, goldChance: 0.11,
    behavior: 'sower',
    element: 'fire',
    visual: { shape: 'hex', color: '#c8a24a', accent: '#3a2417', emoji: '🕯️', size: 16 },
    // fieldDps is a FRACTION of the mob's scaled damage, not a flat number, so
    // the trail keeps pace with SECTION 8 without a second scaling curve. 0.55
    // of a 10-damage statline is 5.5/s: standing in one is a mistake you can
    // walk out of, and standing in three is not.
    params: {
      sowInterval: 2.4, fieldRadius: 60, fieldLife: 6,
      fieldKind: 'damage', fieldDps: 0.55,
    },
    codex: 'Walks the perimeter, swinging. The smoke stays exactly where it is put.',
  },

  {
    id: 'roofline_runner', name: 'Roofline Runner', tier: 2,
    size: 'small',
    hp: 44, damage: 16, speed: 84, weight: 2, xp: 6, goldChance: 0.10,
    behavior: 'strafer',
    element: 'shadow',
    visual: { shape: 'capsule', color: '#2f3a52', accent: '#8fa2c9', emoji: '🏃', size: 13 },
    // Faster and shorter-fused than the Courier: 700 down the lane on a 0.9s
    // telegraph. Stage 4's whole thesis is "nothing comes from where you are
    // looking", and this is the version of that which announces itself and is
    // still hard to be elsewhere for — which is the difference between a stage
    // that is unfair and a stage that is difficult.
    params: {
      runInterval: 5.5, telegraph: 0.9, dashSpeed: 700, runTime: 1.6, recover: 0.8,
    },
    codex: 'Uses the roofs as roads. There is no roof here. It has not noticed.',
  },

  // ==========================================================================
  // TIER 3 — THREATS
  // Mid-late game. Every one of these can end a careless run.
  // ==========================================================================

  {
    id: 'oni_bruiser', name: 'Oni Bruiser', tier: 3,
    size: 'large',
    hp: 220, damage: 28, speed: 48, weight: 12, xp: 16, goldChance: 0.22,
    behavior: 'tank',
    element: 'fire',
    visual: { shape: 'capsule', color: '#c4342b', accent: '#3d0d0a', emoji: '👹', size: 26 },
    params: { slamInterval: 5, slamRadius: 150, slamDamage: 34, telegraph: 0.9 },
    codex: 'Brings a club to a bullet fight and somehow it works.',
  },

  {
    id: 'blood_doll', name: 'Blood Doll', tier: 3,
    size: 'medium',
    hp: 80, damage: 15, speed: 60, weight: 3, xp: 10, goldChance: 0.16,
    behavior: 'splitter',
    element: 'shadow',
    visual: { shape: 'diamond', color: '#b8203f', accent: '#360a15', emoji: '🪆', size: 16 },
    // "splits into 3, then 2 each" = splitDepth 2. Generation 1 is 3 shards,
    // generation 2 is 6, and depth hits 0 so it stops there — 9 shards total,
    // bounded, and counted against the 400-child per-run budget (§25).
    params: { splitInto: 'blood_shard', splitCount: 3, splitDepth: 2 },
    codex: 'Cut it in three and each third still has opinions.',
  },

  {
    id: 'ronin_shade', name: 'Ronin Shade', tier: 3,
    size: 'medium',
    hp: 130, damage: 32, speed: 50, weight: 5, xp: 14, goldChance: 0.18,
    behavior: 'charger',
    element: 'steel',
    visual: { shape: 'capsule', color: '#4b5566', accent: '#0f1420', emoji: '🗡️', size: 17 },
    // SECTION 9's "50/300, long dash, leaves a slash": the dash line persists as
    // a 1.2s hazard, so the dodge is sideways-and-keep-going, never sideways-and-stop.
    params: { telegraph: 0.8, dashSpeed: 300, dashRange: 700, chargeCooldown: 4, slashDamage: 32, slashDuration: 1.2 },
    codex: 'One long step, one long cut, one long silence.',
  },

  {
    id: 'sprinting_husk', name: 'Sprinting Husk', tier: 3,
    size: 'large',
    hp: 70, damage: 24, speed: 145, weight: 3, xp: 12, goldChance: 0.16,
    behavior: 'chaser',
    element: 'spirit',
    visual: { shape: 'capsule', color: '#d8c2a6', accent: '#7a2f2f', emoji: '😀', size: 21 },
    // The tier-3 member of the same problem: 145 speed, `chaser`, and large
    // enough (radius 24) that twenty of them parked on the player is a wall of
    // sprites as well as a wall of hitboxes. Same treatment, wider lock because
    // it is six times the size of a Bait Ball.
    params: {
      maxAlive: 22,
      passLock: 110, passSpeed: 1.5, passTime: 0.7, passRecover: 0.5,
    },
    codex: 'There is no reason for it to run. It runs.',
  },

  {
    id: 'ceiling_crawler', name: 'Ceiling Crawler', tier: 3,
    size: 'medium',
    hp: 95, damage: 26, speed: 88, weight: 3, xp: 12, goldChance: 0.16,
    behavior: 'ambusher',
    element: 'shadow',
    visual: { shape: 'diamond', color: '#5a3b6e', accent: '#180d24', emoji: '🕷️', size: 15 },
    // Drops from above onto a shadow marker. 0.7s is the SECTION 8 `ambush`
    // pattern's telegraph; the drop itself does dropDamage in dropRadius.
    params: { telegraph: 0.7, spawnRange: 200, dropRadius: 90, dropDamage: 26 },
    codex: 'You have been looking at the floor this whole time.',
  },

  {
    id: 'paper_lantern_wisp', name: 'Paper Lantern Wisp', tier: 3,
    size: 'medium',
    hp: 110, damage: 10, speed: 30, weight: 4, xp: 13, goldChance: 0.20,
    behavior: 'summoner',
    element: 'fire',
    visual: { shape: 'circle', color: '#ffb84d', accent: '#6b3a10', emoji: '🏮', size: 18, glow: true },
    // summonCap is not in SECTION 9 but is required: four wisps left alive for
    // three minutes is 720 ghosts against a 2,500 entity cap (§25).
    params: { summonId: 'chibi_ghost', summonInterval: 4, summonCount: 4, summonCap: 16 },
    codex: 'Sheds ghosts the way a bad idea sheds followers.',
  },

  {
    id: 'encore_siren', name: 'Encore Siren', tier: 3,
    size: 'medium',
    hp: 160, damage: 12, speed: 40, weight: 4, xp: 14, goldChance: 0.20,
    behavior: 'healer',
    element: 'light',
    visual: { shape: 'capsule', color: '#ff9ecb', accent: '#4a1030', emoji: '🎤', size: 17, glow: true },
    // DECISIONS.md §30 — this is the tier-3 MOB. The Stage 6 named elite is a
    // separate entity, `elite_encore_siren`, and lives in bosses.js.
    params: { healRate: 15, healRadius: 250, healTickInterval: 0.5 },
    codex: 'Keeps everyone alive for one more chorus. Kill the chorus.',
  },

  {
    id: 'trap_scroll', name: 'Trap Scroll', tier: 3,
    size: 'small',
    hp: 30, damage: 40, speed: 0, weight: 99, xp: 6, goldChance: 0.10,
    behavior: 'static',
    element: 'fire',
    visual: { shape: 'square', color: '#f0e6d2', accent: '#b8332b', emoji: '📜', size: 14 },
    // Visible and avoidable is the whole design: 1s arm, 70px trigger, 0.5s of
    // screaming paper before it goes off. Weight 99 = a mine cannot be knocked back.
    params: { armTime: 1, triggerRadius: 70, fuse: 0.5, blastRadius: 110, blastDamage: 40 },
    codex: 'Beautiful calligraphy. It says "boom".',
  },

  {
    id: 'eel_swarm', name: 'Eel Swarm', tier: 3,
    size: 'small',
    hp: 45, damage: 8, speed: 100, weight: 2, xp: 9, goldChance: 0.14,
    behavior: 'leech',
    element: 'lightning',
    // `damage` is the per-second drain once attached (SECTION 9 writes it "8/s"),
    // mirrored into drainRate so the leech archetype never has to special-case it.
    visual: { shape: 'capsule', color: '#7de0c4', accent: '#12463b', emoji: '🐍', size: 12 },
    params: { drainRate: 8, attachRange: 40, shakeOffDistance: 200 },
    codex: 'Attaches, drains, and does not read the room. Move 200px.',
  },

  {
    id: 'rubble_golem', name: 'Rubble Golem', tier: 3,
    size: 'large',
    hp: 190, damage: 26, speed: 30, weight: 16, xp: 15, goldChance: 0.20,
    behavior: 'tank',
    element: 'steel',
    visual: { shape: 'hex', color: '#8d8f95', accent: '#2c2e33', emoji: '🧱', size: 24 },
    // Heaviest weight in the game — knockback builds simply do not move it, and
    // on Stage 3 it inherits "Titan's Shadow" for 380 effective HP. The wall you
    // were hiding behind is now the thing chasing you.
    params: {},
    codex: 'The wall got up. That was always a possibility.',
  },

  {
    id: 'ambusher', name: 'Ambusher', tier: 3,
    size: 'medium',
    hp: 85, damage: 24, speed: 96, weight: 3, xp: 12, goldChance: 0.16,
    behavior: 'ambusher',
    element: 'shadow',
    visual: { shape: 'diamond', color: '#3f5d3a', accent: '#111b0f', emoji: '🍃', size: 15 },
    // Spawns inside 150px of the player — ALWAYS with the 0.6s leaf-swirl
    // telegraph. `telegraphFx` names the particle burst; it is never optional
    // and never shortened, because an untelegraphed spawn-on-top is unfair.
    params: { telegraph: 0.6, spawnRange: 150, telegraphFx: 'leaf_swirl' },
    codex: 'Arrives in a swirl of leaves 0.6 seconds before it arrives.',
  },

  {
    id: 'drowned_roadie', name: 'Drowned Roadie', tier: 3,
    size: 'large',
    hp: 165, damage: 25, speed: 42, weight: 9, xp: 14, goldChance: 0.20,
    behavior: 'tank',
    element: 'steel',
    visual: { shape: 'square', color: '#56707a', accent: '#16262c', emoji: '🧰', size: 20 },
    // The flight-case slam is a smaller, faster oni slam: 130px, 30 damage,
    // every 4.5s on a 0.9s wind-up. Stage 6's low-tide phase doubles knockback,
    // so weight 9 is what stops him being punted across the reef.
    params: { slamInterval: 4.5, slamRadius: 130, slamDamage: 30, telegraph: 0.9 },
    codex: 'Still loading in. The case weighs more than you do.',
  },

  // --------------------------------------------------------------------------
  // TIER 3 — THE LATE ROSTER
  //
  // Every one of these is gated past minute ten in its stage's mob table and
  // every one of them asks the player to change something rather than to do more
  // of what they were already doing. Priced against the tier's existing shape:
  // 115-235 HP against the Oni Bruiser's 220 and the Blood Doll's 80, 20-30
  // damage against a tier that runs 8-40, 13-17 XP against 6-16. Nothing here
  // out-stats the Oni Bruiser; what they have instead is a rule.
  //
  // The three LARGE ones are 22-34 speed — slower than any existing threat and
  // slower than the Rubble Golem's 30 in two cases. That is the "slow heavies
  // that force routing around them" half of the request: they are not chasing
  // you down, they are occupying somewhere you wanted to be.
  // --------------------------------------------------------------------------

  {
    id: 'siege_husk', name: 'Siege Husk', tier: 3,
    size: 'large',
    hp: 210, damage: 24, speed: 22, weight: 15, xp: 16, goldChance: 0.22,
    behavior: 'mortar',
    element: 'steel',
    visual: { shape: 'hex', color: '#7d848f', accent: '#241f1a', emoji: '🪨', size: 27 },
    // The slowest thing in the game that still moves — 4 under the Crawler Husk,
    // which held that title — and the longest reach, at 560 against the Kunai
    // Bat's 350. Together those are the entire design: it cannot catch you and
    // it does not have to, and the safe distance you have been playing at for
    // three stages is inside its range. Weight 15 is a rung under the Rubble
    // Golem, so a knockback build shifts it and does not clear it.
    params: {
      range: 560, fireInterval: 5.4, telegraph: 1.45,
      blastRadius: 145, shellMult: 1.5, lead: 0.55,
      // THE TELEGRAPH IS AN ARITHMETIC RESULT, NOT A TASTE CALL. To leave a
      // 145px blast you must cover 145 + 9 (feel.playerHitRadius, which
      // enemyBlast() actually tests against) = 154px. The slowest character in
      // the roster runs 168px/s and nothing on this stage slows the player, so
      // that is 154/168 = 0.92s of running, plus feel.accelTime 0.07s to get up
      // to speed, plus 0.25s to notice a new mark on a covered screen: 1.24s
      // minimum. It shipped with 1.1 — short, for a mob the stage fields twenty
      // of. 1.45 clears the floor with 0.21s of margin and STILL punishes a
      // straight line: keep running and you finish 168 * (1.45 - 0.07) = 232px
      // out against a lead point 0.55 * 168 = 92px out, 140px apart, inside the
      // 154px blast. Cutting is still the answer. It is now a possible one.
      //
      // `scatter` spreads a salvo over ground instead of stacking it on one
      // point; `salvoSpacing` is the arena-wide floor between any two mortar
      // marks, which caps the whole stage at two shells a second however many
      // Siege Husks are standing. Both are read by the `mortar` archetype.
      scatter: 130, salvoSpacing: 0.5,
    },
    codex: 'Too slow to catch anybody. Has not needed to catch anybody in years.',
  },

  {
    id: 'mask_bearer', name: 'Mask Bearer', tier: 3,
    size: 'medium',
    hp: 115, damage: 26, speed: 66, weight: 4, xp: 14, goldChance: 0.20,
    behavior: 'tethered',
    element: 'shadow',
    visual: { shape: 'diamond', color: '#b0a0d8', accent: '#8ce8ff', emoji: '🎭', size: 17 },
    // 115 HP is soft for tier 3 and that is the point: alone it dies in a
    // second, and it is never alone. The 150px ward radius is deliberately
    // TIGHT — on Stage 5's covered screen a 250px ward would simply never drop
    // and the mob would read as invulnerable, which is a bug, not a mechanic.
    // 150px is roughly one nova, so the answer is a thing the player already
    // owns rather than a thing they have to go and get.
    params: { wardRadius: 150, wardReduction: 0.92 },
    codex: 'The mask is not on its face. The mask is what is holding the crowd together.',
  },

  {
    id: 'brazier_oni', name: 'Brazier Oni', tier: 3,
    size: 'large',
    hp: 235, damage: 20, speed: 34, weight: 13, xp: 16, goldChance: 0.21,
    behavior: 'sower',
    element: 'fire',
    visual: { shape: 'capsule', color: '#e0764a', accent: '#4d1410', emoji: '🔥', size: 26 },
    // The Censer Shade's idea at three times the size and half again the rate:
    // a 74px pool every 1.9s at 0.7x damage, live for 7 seconds, which means one
    // of these walking a straight line leaves roughly four pools of standing
    // fire behind it at all times. On the stage whose corridors move every 45
    // seconds, the floor it takes away is floor you were counting on.
    params: {
      sowInterval: 1.9, fieldRadius: 74, fieldLife: 7,
      fieldKind: 'damage', fieldDps: 0.7,
    },
    codex: 'Carries the coals in its hands. Puts them down wherever it likes.',
  },

  {
    id: 'sutra_chanter', name: 'Sutra Chanter', tier: 3,
    size: 'medium',
    hp: 150, damage: 9, speed: 34, weight: 4, xp: 15, goldChance: 0.21,
    behavior: 'conductor',
    element: 'spirit',
    visual: { shape: 'capsule', color: '#e8dcc0', accent: '#6a3a10', emoji: '📿', size: 17, glow: true },
    // Sits at 150 HP next to the Encore Siren's 160 on purpose: they are the
    // same job description from two directions — the Siren gives the crowd its
    // health back, this gives the crowd its tempo — and a player who has learned
    // to hunt one should recognise the priority of the other on sight. Under
    // "Demon Moon" the pair together is the hardest target-priority problem in
    // the game, which is exactly what a four-star stage is for.
    params: { rallyRadius: 280, hasteMult: 1.40, empowerMult: 1.35 },
    codex: 'One voice, forty demons, and not one of them tiring.',
  },

  {
    id: 'deep_watcher', name: 'Deep Watcher', tier: 3,
    size: 'medium',
    hp: 145, damage: 30, speed: 36, weight: 5, xp: 14, goldChance: 0.20,
    behavior: 'watcher',
    element: 'water',
    visual: { shape: 'circle', color: '#1e3346', accent: '#7de0c4', emoji: '👁️', size: 17, glow: true },
    // The Hall Monitor's lesson with the training wheels off: 2.0s of patience
    // instead of 2.4, an 88px stand radius instead of 96, and 1.6x off a
    // 30-damage statline. High tide slows the player 20%, so the reposition it
    // demands costs more on the crest than in the trough — which is how a stage
    // hazard is supposed to interact with a mob rather than just coexist.
    params: {
      standRadius: 88, patience: 2.0, telegraph: 1.0,
      strikeRadius: 128, strikeMult: 1.6, cooldown: 2.6,
    },
    codex: 'Ambush predators do not chase. They wait for you to stop being interesting.',
  },

  {
    id: 'spine_urchin', name: 'Spine Urchin', tier: 3,
    size: 'medium',
    hp: 125, damage: 22, speed: 28, weight: 6, xp: 13, goldChance: 0.19,
    behavior: 'mortar',
    element: 'water',
    visual: { shape: 'star', color: '#6a4a8f', accent: '#1a0d2a', emoji: '🦔', size: 16 },
    // The Siege Husk's shell at reef scale: shorter range, tighter blast,
    // quicker cycle. Two of them cross-covering a stretch of seabed is the
    // reason this stage's ring waves stopped being free, and unlike the Husk it
    // is soft enough (weight 6) that knockback genuinely relocates the problem.
    params: {
      range: 460, fireInterval: 4.0, telegraph: 1.25,
      blastRadius: 118, shellMult: 1.4, lead: 0.45,
      // The Siege Husk's arithmetic at reef scale: (118 + 9)/168 = 0.76s of
      // running + 0.07s of ramp + 0.25s to see it = 1.08s minimum against the
      // 1.0 it shipped with. 1.25 leaves it the same margin the Husk gets.
      // High tide slows the player 20%, which is exactly why this one gets the
      // margin rather than the floor.
      scatter: 105, salvoSpacing: 0.4,
    },
    codex: 'Sits perfectly still. Redecorates everywhere you were thinking of standing.',
  },

  {
    id: 'reef_bulwark', name: 'Reef Bulwark', tier: 3,
    size: 'large',
    hp: 230, damage: 28, speed: 30, weight: 16, xp: 17, goldChance: 0.22,
    behavior: 'tethered',
    element: 'steel',
    visual: { shape: 'hex', color: '#3c8f8a', accent: '#ffd76a', emoji: '🪸', size: 28 },
    // The Mask Bearer's rule on a body that can afford it: 230 HP, weight 16 —
    // tied with the Rubble Golem for the heaviest thing in the game — and a
    // 190px ward, because a large mob is genuinely harder to isolate and the
    // radius has to be worth clearing rather than trivial to leave. Reef high
    // tide doubles knockback, which is the one window where shoving its escort
    // out of the ward is easier than killing them.
    params: { wardRadius: 190, wardReduction: 0.94 },
    codex: 'Forty years of small things growing on it, and every one of them load-bearing.',
  },

  // ==========================================================================
  // SPLIT CHILDREN — spawnable:false
  // Never in a mob table, never rolled by the Splitting affix. They exist so a
  // splitter's death reads as an event instead of a disappearance.
  // ==========================================================================

  {
    id: 'tiny_slime', name: 'Tiny Slime', tier: 1, spawnable: false,
    size: 'small',
    hp: 5, damage: 3, speed: 66, weight: 1, xp: 1, goldChance: 0.01,
    behavior: 'swarmer',
    element: 'water',
    visual: { shape: 'circle', color: '#8ee6f2', accent: '#17516b', emoji: '💧', size: 9 },
    params: { packSize: 2 },
    codex: 'A kouhai’s kouhai. Deeply committed to the bit.',
  },

  {
    id: 'blood_shard', name: 'Blood Shard', tier: 1, spawnable: false,
    size: 'small',
    hp: 18, damage: 9, speed: 72, weight: 1, xp: 2, goldChance: 0.03,
    behavior: 'splitter',
    element: 'shadow',
    visual: { shape: 'diamond', color: '#e0435f', accent: '#360a15', size: 11 },
    // A shard inherits (parent depth − 1). The generation the Blood Doll makes
    // still has depth 1 and splits into 2; theirs is 0 and stops. splitDepth
    // here is only the value used if a shard were ever spawned standalone.
    params: { splitInto: 'blood_shard', splitCount: 2, splitDepth: 1 },
    codex: 'A smaller problem, and there are more of them now.',
  },

  {
    id: 'mascot_splinter', name: 'Mascot Splinter', tier: 1, spawnable: false,
    size: 'medium',
    hp: 28, damage: 11, speed: 50, weight: 3, xp: 3, goldChance: 0.08,
    behavior: 'chaser',
    element: 'spirit',
    // Spawned by Mascot Prime (the Stage 2 mid-boss) splitting into four.
    visual: { shape: 'circle', color: '#ffe08a', accent: '#5a3d0a', emoji: '🧸', size: 13 },
    params: {},
    codex: 'Technically still under warranty.',
  },

];

// ============================================================================
// ELITE AFFIXES
// Elites are tier-2/3 enemies with 8x HP, a gold outline, a health bar, a name
// plate, and 1–3 of these (SECTION 9). `cascading: true` marks the two that
// DECISIONS.md §25 excludes from the Kamige blanket-affix roll: applied to
// 2,000 mobs at once they are an unbounded spawn/damage cascade against a hard
// 60 FPS requirement.
// ============================================================================

export const AFFIXES = [
  {
    id: 'volatile', name: 'Volatile', color: '#ff6b3d',
    desc: 'Explodes on death for 120 damage in a 200px radius.',
    params: { damage: 120, radius: 200 },
    cascading: true,
  },
  {
    id: 'warded', name: 'Warded', color: '#7fb2ff',
    desc: 'Takes 60% less damage from the front. Get behind it.',
    // Given the same turn cap as a shielder (DECISIONS.md §31) — a front-arc
    // damage reduction that always faces you is not a mechanic, it is a debuff.
    params: { reduction: 0.6, arc: 2.09, turnRate: 1.57, facingLag: 0.4 },
    cascading: false,
  },
  {
    id: 'frenzied', name: 'Frenzied', color: '#ff4f7b',
    desc: '+80% move speed below 50% HP.',
    params: { speedMult: 1.8, hpThreshold: 0.5 },
    cascading: false,
  },
  {
    id: 'splitting', name: 'Splitting', color: '#9bff7d',
    desc: 'Spawns 4 tier-1 enemies every 5 seconds.',
    params: { interval: 5, count: 4, tier: 1 },
    cascading: true,
  },
  {
    id: 'chilling', name: 'Chilling', color: '#8ce8ff',
    desc: 'Leaves a frost trail. Standing in it slows you 35% for 1.5s.',
    // The slow/duration numbers are not in SECTION 9 (it says only "a slowing
    // frost trail"); 35% for 1.5s matches the chalk smear's teaching curve at
    // roughly double strength, which is where an elite modifier should sit.
    params: { slow: 0.35, slowDuration: 1.5, trailRadius: 60, trailLife: 4 },
    cascading: false,
  },
  {
    id: 'reflective', name: 'Reflective', color: '#d59bff',
    desc: 'Returns 15% of damage taken as a projectile, at most twice a second.',
    // The 0.5s floor is not in SECTION 9 and is required: one projectile per hit
    // on a 20-hits/second build blows past MAX_PROJECTILES (1,200) on its own.
    params: { fraction: 0.15, interval: 0.5, projectileSpeed: 260 },
    cascading: false,
  },
  {
    id: 'colossal', name: 'Colossal', color: '#ffd166',
    desc: '2x size, 2x contact damage, immune to knockback.',
    params: { sizeMult: 2, damageMult: 2, knockbackImmune: true },
    cascading: false,
  },
  {
    id: 'vampiric', name: 'Vampiric', color: '#ff2f5e',
    desc: 'Heals for 30% of the damage it deals.',
    params: { lifesteal: 0.3 },
    cascading: false,
  },
];

/** SECTION 9: elites are the same enemy with 8x HP. */
export const ELITE_HP_MULT = 8;

/** Elites roll 1–3 affixes (SECTION 9). */
export const ELITE_AFFIX_MIN = 1;
export const ELITE_AFFIX_MAX = 3;

/**
 * The pool the Kamige blanket-affix roll draws from (DECISIONS.md §25).
 * Derived from `cascading` rather than hand-listed so the two can never drift.
 * NOTE: §25 says "the seven non-cascading affixes"; 8 total − 2 cascading is 6.
 * The rule is what matters, not the count, so this is computed.
 */
export const KAMIGE_AFFIXES = AFFIXES.filter(a => !a.cascading);

/** id -> enemy. All 51, children included. */
export const ENEMIES_BY_ID = Object.fromEntries(ENEMIES.map(e => [e.id, e]));

/**
 * Wave-spawnable enemies grouped by tier — 12 / 17 / 19. The three split
 * children are excluded (spawnable:false) so no wave event and no Splitting
 * affix can roll a child that is only meant to appear on a parent's death.
 *
 * The Splitting affix rolls from tier 1, so everything added to that bucket is
 * something an elite may now shed four of every five seconds. All four of the
 * new tier-1 mobs are fodder-priced with no spawn behaviour of their own, which
 * is the property that bucket actually needs (DECISIONS.md §25) — an exploder
 * with `chains` or a summoner in there would be an unbounded cascade.
 */
export const ENEMIES_BY_TIER = {
  1: ENEMIES.filter(e => e.tier === 1 && e.spawnable !== false),
  2: ENEMIES.filter(e => e.tier === 2 && e.spawnable !== false),
  3: ENEMIES.filter(e => e.tier === 3 && e.spawnable !== false),
};
