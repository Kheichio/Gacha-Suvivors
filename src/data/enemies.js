// ENEMIES — 35 types + the 8 elite affixes.
//
// SECTION 9 stats 23 of these; their stat lines are reproduced VERBATIM
// (hp / damage / speed / behavior). Nine more are named in stage mob tables with
// no stats anywhere and three are split-children that only ever appear on a
// parent's death — all twelve are authored here in full (DECISIONS.md §5),
// interpolated to sit inside the range their tier already occupies.
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
    params: { packSize: 25 },
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
    params: {},
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

/** id -> enemy. All 35, children included. */
export const ENEMIES_BY_ID = Object.fromEntries(ENEMIES.map(e => [e.id, e]));

/**
 * Wave-spawnable enemies grouped by tier — 8 / 12 / 12. The three split
 * children are excluded (spawnable:false) so no wave event and no Splitting
 * affix can roll a child that is only meant to appear on a parent's death.
 */
export const ENEMIES_BY_TIER = {
  1: ENEMIES.filter(e => e.tier === 1 && e.spawnable !== false),
  2: ENEMIES.filter(e => e.tier === 2 && e.spawnable !== false),
  3: ENEMIES.filter(e => e.tier === 3 && e.spawnable !== false),
};
