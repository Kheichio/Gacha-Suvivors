// The seven stages, their hazards, their modifiers, and the difficulty ladder.
//
// Pure data. The WaveDirector, the hazard system and the results screen all read
// from here; nothing in this file knows how any of them work.
//
// Conventions used below:
//   duration        seconds. Timelines are authored in NORMALISED time elsewhere
//                   and scaled against this number (DECISIONS.md §20), so a stage
//                   length change never desyncs its mid-boss.
//   unlock.stages   ARRAY of stage ids that must be cleared (DECISIONS.md §33 —
//                   the single-`stage` form could not express Stage 7's "clear
//                   1–6"). An empty array means "available from the start".
//   midBoss         the SIGNATURE mid-boss: the one pinned to the halfway anchor,
//                   the one the stage-select screen previews, and the one that
//                   pays the full mid-boss loot table.
//   midBosses       the whole ladder for this stage, in the order it is fought.
//                   Play report: "add mini bosses to each stage." Every stage now
//                   runs two or three of these instead of one.
//
//                   THE LADDER IS SHARED. bosses.js defines seven mid-bosses and
//                   they happen to be a clean difficulty staircase — 1,100 /
//                   1,750 / 2,700 / 4,200 / 6,400 / 10,000 / 15,600 HP — with each
//                   stage's own sitting on exactly its own rung. So a stage
//                   borrows the rung BELOW its own for the opener and the rung
//                   ABOVE it for the closer, rather than inventing creatures that
//                   would need art, attacks, a codex entry and a name. Nothing is
//                   invented; the ids are reused across stages, which is also what
//                   the Zenith Stage's Grand Finale modifier has always done with
//                   the six stage bosses.
//
//                   WHERE a rung is fought now sets what it costs. game/boss.js
//                   reads MIDBOSS_HP_CURVE (below) instead of the flat +6%/min,
//                   because the flat curve made the EARLIEST mini-boss the
//                   hardest fight in the run — measured, and by 18x. The third
//                   stage now reads 1,097 -> 8,910 -> 42,504 across its three
//                   mid-boss beats: the opener got CHEAPER and the closer got
//                   eight times heavier, which is what "the ladder climbs" was
//                   always supposed to mean.
//
//                   The FINALE stands well clear of that staircase on purpose:
//                   game/boss.js applies `def.finaleHpMult` (10 on every stage
//                   boss and on nothing else) when the closer walks on, so the
//                   third stage's finale is 148,635 — 3.5x its own heaviest
//                   mid-boss. Every stage lands between 3.0x and 10.8x. `hp`
//                   itself still does not move: it is what the Grand Finale's x8
//                   elite pass multiplies, and that pass goes through
//                   Run.spawnElite / scaledHp, which never sees finaleHpMult.
//
//                   `midBosses` is a fallback list only — the authored timelines
//                   in waves.js are what actually place these fights, and the
//                   WaveDirector rebuilds this list from `midBoss` if it is absent.
//   mobTable[].weight   relative spawn share once the mob is eligible.
//   mobTable[].from     seconds into the run before this mob may appear at all.
//   hpMult/xpMult/goldMult  per-stage tuning knobs applied on top of SCALING.
//                   DECISIONS.md §14 makes these the intended TTK dial, so the
//                   global k values never have to be touched for one stage.
//   obstacles       which static-blocker set game/obstacles.js scatters at run
//                   start, by key into OBSTACLE_SETS below (DECISIONS.md §18 —
//                   steering avoidance, not pathfinding). This used to be one of
//                   three words — none | rubble | shifting_rooms — and NOTHING
//                   READ IT: five of seven stages were flat, empty floors and the
//                   two that were not only got geometry because a hazard happened
//                   to drop some. It is a real registry key now.
//   backdrop        key into BACKDROPS below. The GROUND render/stageBackdrop.js
//                   draws the stage on. It was a layered parallax diorama for one
//                   pass, and the play report on that was "maps have a lot of
//                   random things floating around the screen" — on a TOP-DOWN view
//                   a layer drawn further away than the floor is a layer drawn
//                   ABOVE the arena. It is one opaque patterned surface at 1:1
//                   scroll now, and nothing in it is off the floor.
//   events          the MINI EVENTS this stage may roll, by key into STAGE_EVENTS.
//                   Themed per stage exactly like `hazards` is, so a new event on
//                   an existing kind is a data-only addition.
//   music           optional. audio.js no-ops cleanly when the file is absent.

export const STAGES = [
  {
    id: 'cherry_academy',
    name: 'Cherry Blossom Academy',
    index: 0,
    duration: 15 * 60,
    difficultyStars: 1,
    // The starting stage: no prerequisites.
    unlock: { stages: [], cleared: true },
    palette: {
      bg: '#2b1233', accent: '#ff9ec4', fog: '#ff7f50', ground: '#3c1c3c',
      grid: '#572b52', hazard: '#ffd166',
    },
    ambience: {
      particleColor: '#ffc2dd', particleRate: 0.9, particleShape: 'crescent',
      vignette: 'rgba(58,20,42,0.34)',
    },
    // No hazard by design — this stage teaches.
    hazards: [],
    modifier: 'youth',
    mobTable: [
      { id: 'mob_student', weight: 45, from: 0 },
      { id: 'chibi_ghost', weight: 20, from: 120 },
      { id: 'chalk_wraith', weight: 16, from: 180 },
      { id: 'slime_kouhai', weight: 14, from: 240 },
      { id: 'cursed_desk', weight: 12, from: 300 },
      { id: 'gym_uniform_ghoul', weight: 10, from: 420 },
      // Late fodder that is FASTER than anything the stage has shown, and the
      // first mob in the game that punishes standing still. Both open past
      // minute eight of fifteen.
      { id: 'eraser_gremlin', weight: 12, from: 480 },
      { id: 'hall_monitor', weight: 8, from: 540 },
    ],
    elite: 'perfect_attendance_award',
    // The teaching stage gets TWO, not three: one mid-boss to learn the grammar
    // of a telegraphed fight on, and one late spike to prove it stuck. There is
    // also no rung below Delinquent Senpai to borrow — he is the bottom of the
    // whole ladder.
    midBoss: 'delinquent_senpai',
    midBosses: ['delinquent_senpai', 'mascot_prime'],
    boss: 'student_council_president',
    // "Unlocks Stage 2" is expressed by neon_akiba.unlock, not duplicated here.
    firstClearReward: { starFragments: 50 },
    // Tutorial stage: fodder dies a little faster than the curve says it should.
    hpMult: 0.9, xpMult: 1.0, goldMult: 1.0,
    obstacles: 'academy_courtyard',
    backdrop: 'school_courtyard',
    events: ['rooftop_confession', 'petal_drift'],
    // The clock tower, tolling three, the moment a boss arrives. `bossIntro`
    // plays everywhere and says "a boss is here"; this says WHERE you are, and
    // every stage gets to answer that differently.
    bossCue: 'clockTower',
    music: 'audio/stage1.ogg',
    codex: 'Three years of your life happen in this courtyard. The gate is at your ' +
      'back, the main doors are at the far end of the path, and the fountain has ' +
      'been broken and then repaired so many times that repairing it is a club. ' +
      'The benches are for confessions, the hedges are for eavesdropping on them, ' +
      'and the sunset is contractually obligated to be that colour. The petals ' +
      'fall at exactly the rate that makes a confession feel inevitable. Nobody ' +
      'has ever attended a class here. Nobody has ever questioned that.',
  },

  {
    id: 'neon_akiba',
    name: 'Neon Akiba District',
    index: 1,
    duration: 20 * 60,
    difficultyStars: 2,
    unlock: { stages: ['cherry_academy'], cleared: true },
    palette: {
      bg: '#0a0616', accent: '#ff2d95', fog: '#1b0f33', ground: '#120a24',
      grid: '#1f1140', hazard: '#ff2d95',
    },
    ambience: {
      particleColor: '#ff2d95', particleRate: 0.6, particleShape: 'diamond',
      vignette: 'rgba(6,2,16,0.55)',
    },
    hazards: ['traffic_lanes'],
    modifier: 'crowded_streets',
    mobTable: [
      { id: 'gacha_zombie', weight: 40, from: 0 },
      { id: 'neon_otaku', weight: 22, from: 60 },
      { id: 'camera_drone', weight: 18, from: 180 },
      { id: 'antifan_swarm', weight: 14, from: 300 },
      { id: 'mascot_suit', weight: 10, from: 420 },
      { id: 'courier_scooter', weight: 10, from: 600 },
      // The crowd this stage is named for, moving 30% faster. Latest gate here.
      { id: 'hype_marshal', weight: 6, from: 720 },
    ],
    elite: 'gacha_golem',
    midBoss: 'mascot_prime',
    midBosses: ['delinquent_senpai', 'mascot_prime', 'the_armored'],
    boss: 'the_algorithm',
    firstClearReward: { starFragments: 50, relic: 'neon_visor' },
    // Zombies queueing for capsules carry cash.
    hpMult: 1.0, xpMult: 1.0, goldMult: 1.1,
    obstacles: 'street_furniture',
    backdrop: 'wet_street',
    events: ['crowd_control', 'capsule_burst'],
    music: 'audio/stage2.ogg',
    codex: 'Six storeys of signage, all of it screaming, none of it in agreement. ' +
      'The rain never washes the street so much as it doubles the light. Every ' +
      'third door is a claw machine you will lose money to, every fourth is a maid ' +
      'cafe, and underneath all of it the trucks keep to the timetable of a city ' +
      'that never asked your permission. Bring coins. Bring reflexes.',
  },

  {
    id: 'wall_amaris',
    name: 'Ruins of Wall Amaris',
    index: 2,
    duration: 20 * 60,
    difficultyStars: 3,
    unlock: { stages: ['neon_akiba'], cleared: true },
    palette: {
      bg: '#1a1c20', accent: '#c8cdd4', fog: '#4a4f57', ground: '#2a2d33',
      grid: '#3a3f47', hazard: '#e07a3f',
    },
    ambience: {
      particleColor: '#9aa0a8', particleRate: 0.7, particleShape: 'square',
      vignette: 'rgba(18,20,24,0.50)',
    },
    hazards: ['collapsing_walls'],
    modifier: 'titans_shadow',
    mobTable: [
      { id: 'husk_wanderer', weight: 42, from: 0 },
      { id: 'crawler_husk', weight: 24, from: 90 },
      { id: 'sprinting_husk', weight: 18, from: 240 },
      { id: 'rubble_golem', weight: 16, from: 300 },
      // The stage is built entirely out of slow. One of these is not.
      { id: 'splinter_husk', weight: 14, from: 540 },
      // Weight 8 from minute twelve put twenty-plus mortars on the field at
      // once, because a Siege Husk under Titan's Shadow carries 420 effective
      // HP and simply outlives every husk around it. The salvo gate caps the
      // shell RATE; this is what stops the gate sitting pinned at its ceiling
      // for the last eight minutes of the stage. Matches the share the Zenith
      // Stage already gives it.
      { id: 'siege_husk', weight: 5, from: 780 },
    ],
    elite: 'abnormal',
    midBoss: 'the_armored',
    midBosses: ['mascot_prime', 'the_armored', 'the_twin_fangs'],
    boss: 'the_colossus',
    firstClearReward: { starFragments: 50, relic: 'anchor_gear' },
    // Titan's Shadow already doubles LARGE HP; the flat knob stays gentle.
    hpMult: 1.1, xpMult: 1.05, goldMult: 1.0,
    obstacles: 'rubble',
    backdrop: 'ruined_town',
    events: ['hold_the_breach', 'supply_cache'],
    music: 'audio/stage3.ogg',
    codex: 'It was a town. There were bakeries. The grey is not weather, it is what ' +
      'is left of the roofs, and the smoke has been going long enough that people ' +
      'just call it the sky now. Something very large stepped over the wall and ' +
      'nobody has finished a sentence since. Watch your footing: the rubble is on ' +
      'your side, right up until it boxes you in with the fast one.',
  },

  {
    id: 'hidden_ember',
    name: 'Hidden Ember Village',
    index: 3,
    duration: 20 * 60,
    difficultyStars: 3,
    unlock: { stages: ['wall_amaris'], cleared: true },
    palette: {
      bg: '#0b1020', accent: '#ffa53c', fog: '#25384d', ground: '#1a1410',
      grid: '#2c2117', hazard: '#8ea0aa',
    },
    ambience: {
      particleColor: '#ff9a3c', particleRate: 0.5, particleShape: 'circle',
      vignette: 'rgba(8,10,20,0.60)',
    },
    hazards: ['smoke_bombs'],
    modifier: 'shinobi_rules',
    mobTable: [
      { id: 'genin_shade', weight: 34, from: 0 },
      { id: 'kunai_bat', weight: 24, from: 60 },
      { id: 'crow_familiar', weight: 18, from: 150 },
      { id: 'trap_scroll', weight: 12, from: 240 },
      { id: 'ambusher', weight: 12, from: 360 },
      { id: 'ember_sprite', weight: 12, from: 480 },
      { id: 'censer_shade', weight: 10, from: 600 },
      { id: 'roofline_runner', weight: 8, from: 660 },
    ],
    elite: 'sealed_vessel',
    midBoss: 'the_twin_fangs',
    midBosses: ['the_armored', 'the_twin_fangs', 'the_drum_oni'],
    boss: 'the_sealed_beast',
    firstClearReward: { starFragments: 50, relic: 'nine_seal_ward' },
    hpMult: 1.1, xpMult: 1.05, goldMult: 1.05,
    obstacles: 'training_yard',
    backdrop: 'hidden_village',
    events: ['signal_lantern', 'smoke_and_steel'],
    music: 'audio/stage4.ogg',
    codex: 'A village that is technically hidden and practically the loudest place ' +
      'in the country. Every roof is a road, every lantern is a rendezvous, and ' +
      'somebody is always sprinting across the ceiling above your dinner. The mist ' +
      'is scheduled. So are the ambushes. Locals consider being stabbed out of a ' +
      'bush a perfectly warm way to say hello.',
  },

  {
    id: 'tatami_halls',
    name: 'The Endless Tatami Halls',
    index: 4,
    duration: 22 * 60,
    difficultyStars: 4,
    unlock: { stages: ['hidden_ember'], cleared: true },
    palette: {
      bg: '#0d0a24', accent: '#c8102e', fog: '#1a1442', ground: '#2a1c33',
      grid: '#3a2350', hazard: '#c8102e',
    },
    ambience: {
      particleColor: '#d8365a', particleRate: 0.45, particleShape: 'shard',
      vignette: 'rgba(10,6,26,0.62)',
    },
    hazards: ['shifting_rooms'],
    modifier: 'demon_moon',
    mobTable: [
      { id: 'lesser_oni', weight: 34, from: 0 },
      { id: 'blood_doll', weight: 18, from: 210 },
      { id: 'ceiling_crawler', weight: 16, from: 330 },
      { id: 'paper_lantern_wisp', weight: 14, from: 120 },
      { id: 'ronin_shade', weight: 12, from: 480 },
      // The only stage that fits a full-size oni. Late, and rare.
      { id: 'oni_bruiser', weight: 6, from: 660 },
      // All three past minute thirteen of twenty-two: the skill-check stage's
      // skill check.
      { id: 'mask_bearer', weight: 8, from: 780 },
      { id: 'sutra_chanter', weight: 6, from: 840 },
      { id: 'brazier_oni', weight: 5, from: 900 },
    ],
    elite: 'upper_rank_remnant',
    midBoss: 'the_drum_oni',
    midBosses: ['the_twin_fangs', 'the_drum_oni', 'tide_warden'],
    boss: 'kagutsuchi',
    firstClearReward: { starFragments: 50, relic: 'everblade_fragment' },
    // The skill-check stage, and two minutes longer than its neighbours.
    hpMult: 1.2, xpMult: 1.1, goldMult: 1.0,
    obstacles: 'shifting_rooms',
    backdrop: 'paper_halls',
    events: ['the_still_room', 'scattered_wards'],
    music: 'audio/stage5.ogg',
    codex: 'Rooms without a building. Staircases that arrive from underneath. Paper ' +
      'doors opening onto four hundred more paper doors, all tastefully appointed, ' +
      'all wrong. Someone is playing a stringed instrument somewhere and the ' +
      'architecture is listening. Do not get attached to the corridor you are ' +
      'standing in. It has other plans in about 45 seconds.',
  },

  {
    id: 'sunken_reef',
    name: 'Sunken Idol Reef',
    index: 5,
    duration: 20 * 60,
    difficultyStars: 4,
    unlock: { stages: ['tatami_halls'], cleared: true },
    palette: {
      bg: '#03101f', accent: '#46f0d0', fog: '#0a2c44', ground: '#062033',
      grid: '#0d3a52', hazard: '#3fa9ff',
    },
    ambience: {
      particleColor: '#4ff0d0', particleRate: 0.8, particleShape: 'circle',
      vignette: 'rgba(2,14,30,0.58)',
    },
    hazards: ['rising_tide'],
    modifier: 'deep_pressure',
    mobTable: [
      { id: 'anglerfish_fan', weight: 30, from: 0 },
      { id: 'jellyfish_chorus', weight: 20, from: 90 },
      { id: 'coral_crab', weight: 16, from: 180 },
      { id: 'drowned_roadie', weight: 16, from: 240 },
      { id: 'eel_swarm', weight: 12, from: 360 },
      // The rank-and-file siren, NOT the named elite (DECISIONS.md §30).
      { id: 'encore_siren', weight: 6, from: 540 },
      { id: 'bait_ball', weight: 12, from: 480 },
      { id: 'spine_urchin', weight: 8, from: 660 },
      { id: 'deep_watcher', weight: 7, from: 780 },
      { id: 'reef_bulwark', weight: 5, from: 840 },
    ],
    elite: 'elite_encore_siren',
    midBoss: 'tide_warden',
    midBosses: ['the_drum_oni', 'tide_warden', 'the_opening_act'],
    boss: 'the_kraken_producer',
    firstClearReward: { starFragments: 50, relic: 'abyssal_setlist' },
    // Deep Pressure already triples gold; the stage knob stays at 1.0.
    hpMult: 1.15, xpMult: 1.1, goldMult: 1.0,
    obstacles: 'coral_heads',
    backdrop: 'sunken_stadium',
    events: ['pearl_bed', 'feeding_frenzy'],
    music: 'audio/stage6.ogg',
    codex: 'The stadium sank with the lights still on. Forty thousand seats, coral ' +
      'through every one, and the jumbotron still loops a set list nobody swam away ' +
      'from. The fish learned the choreography. When the tide comes up everything ' +
      'goes slow and floaty and weirdly beautiful, which is a terrible time to be ' +
      'fighting a crab the size of a tour bus.',
  },

  {
    id: 'zenith_stage',
    name: 'The Zenith Stage',
    index: 6,
    duration: 25 * 60,
    difficultyStars: 5,
    // "Clear stages 1–6" — the reason unlock.stages is an array at all.
    unlock: {
      stages: ['cherry_academy', 'neon_akiba', 'wall_amaris', 'hidden_ember',
        'tatami_halls', 'sunken_reef'],
      cleared: true,
    },
    palette: {
      bg: '#060418', accent: '#7cf7d0', fog: '#16244a', ground: '#101030',
      grid: '#20305c', hazard: '#fff3a8',
    },
    ambience: {
      particleColor: '#a6ffe6', particleRate: 1.0, particleShape: 'star',
      vignette: 'rgba(10,4,30,0.50)',
    },
    hazards: ['spotlights'],
    modifier: 'grand_finale',
    // "Everything, mixed from all previous tables" — written out as a real table.
    // Every spawnable enemy in the game appears exactly once (48 entries; the three
    // split-children are spawned by their parents and are never rolled here).
    // Weights fall and `from` gates rise as the tier climbs, so the finale still
    // opens on fodder and ends on threats.
    mobTable: [
      // Tier 1 — the opening crowd.
      { id: 'mob_student', weight: 20, from: 0 },
      { id: 'gacha_zombie', weight: 18, from: 0 },
      { id: 'husk_wanderer', weight: 18, from: 0 },
      { id: 'chibi_ghost', weight: 14, from: 0 },
      { id: 'neon_otaku', weight: 12, from: 60 },
      { id: 'slime_kouhai', weight: 10, from: 60 },
      { id: 'chalk_wraith', weight: 10, from: 90 },
      { id: 'crow_familiar', weight: 10, from: 90 },
      // Tier 2 — the middle of the set.
      { id: 'antifan_swarm', weight: 14, from: 120 },
      { id: 'genin_shade', weight: 12, from: 150 },
      { id: 'kunai_bat', weight: 12, from: 150 },
      { id: 'camera_drone', weight: 11, from: 180 },
      { id: 'gym_uniform_ghoul', weight: 10, from: 180 },
      { id: 'crawler_husk', weight: 10, from: 210 },
      { id: 'jellyfish_chorus', weight: 10, from: 240 },
      { id: 'cursed_desk', weight: 9, from: 240 },
      { id: 'coral_crab', weight: 9, from: 300 },
      { id: 'anglerfish_fan', weight: 9, from: 300 },
      { id: 'lesser_oni', weight: 9, from: 330 },
      { id: 'mascot_suit', weight: 8, from: 360 },
      // Tier 3 — the encore.
      { id: 'sprinting_husk', weight: 8, from: 420 },
      { id: 'blood_doll', weight: 7, from: 450 },
      { id: 'ceiling_crawler', weight: 7, from: 480 },
      { id: 'eel_swarm', weight: 6, from: 510 },
      { id: 'rubble_golem', weight: 6, from: 540 },
      { id: 'drowned_roadie', weight: 6, from: 540 },
      { id: 'ronin_shade', weight: 6, from: 600 },
      { id: 'ambusher', weight: 5, from: 660 },
      { id: 'paper_lantern_wisp', weight: 5, from: 690 },
      { id: 'oni_bruiser', weight: 5, from: 720 },
      { id: 'trap_scroll', weight: 4, from: 780 },
      { id: 'encore_siren', weight: 4, from: 840 },
      // Tier 1 — the new fast ones, from minute seven.
      { id: 'eraser_gremlin', weight: 8, from: 420 },
      { id: 'splinter_husk', weight: 8, from: 450 },
      { id: 'bait_ball', weight: 8, from: 480 },
      { id: 'ember_sprite', weight: 7, from: 510 },
      // Tier 2 — the archetypes, introduced in the order the stages teach them.
      { id: 'hall_monitor', weight: 7, from: 600 },
      { id: 'courier_scooter', weight: 7, from: 630 },
      { id: 'censer_shade', weight: 6, from: 660 },
      { id: 'roofline_runner', weight: 6, from: 690 },
      { id: 'hype_marshal', weight: 5, from: 720 },
      // Tier 3 — the encore's encore.
      { id: 'siege_husk', weight: 5, from: 780 },
      { id: 'spine_urchin', weight: 5, from: 810 },
      { id: 'mask_bearer', weight: 4, from: 870 },
      { id: 'deep_watcher', weight: 4, from: 900 },
      { id: 'brazier_oni', weight: 4, from: 930 },
      { id: 'sutra_chanter', weight: 3, from: 960 },
      { id: 'reef_bulwark', weight: 3, from: 990 },
    ],
    // Both authored in DECISIONS.md §7 — the spec gave Stage 7 neither.
    elite: 'the_understudy',
    midBoss: 'the_opening_act',
    // The only stage whose ladder runs out at the top, because it OWNS the top.
    // So all three fights sit in the first half and escalate into the halfway
    // anchor; the back half is already carried by the Grand Finale modifier
    // walking a previous stage boss on as an elite every five minutes.
    midBosses: ['the_drum_oni', 'tide_warden', 'the_opening_act'],
    boss: 'the_final_form',
    // No relic: the reward is Endless Mode. Difficulty tiers unlock per-stage on
    // first clear everywhere (SECTION 7's own tier rule), so Encore is not listed
    // as a Stage 7 exclusive.
    firstClearReward: { starFragments: 200, unlocksEndless: true },
    hpMult: 1.3, xpMult: 1.15, goldMult: 1.15,
    obstacles: 'light_trusses',
    backdrop: 'zenith_deck',
    events: ['spotlight_check', 'stage_call'],
    music: 'audio/stage7.ogg',
    codex: 'The last venue. Floating slabs of every place you already survived hang ' +
      'on the horizon like tour posters, a million silhouettes are screaming in the ' +
      'dark, and the aurora is doing far too much. The spotlights are hunting for a ' +
      'headliner. They have narrowed it down to you and the thing wearing your face.',
  },
];

// -----------------------------------------------------------------------------
// HAZARDS — one signature environmental system per stage, as data.
// `telegraph` is seconds of warning before the hazard bites; 0 means the hazard
// is permanently visible and needs none. `kind` selects the handler in
// game/hazards.js, so a new hazard of an existing kind is a data-only addition.
// -----------------------------------------------------------------------------
export const HAZARDS = {
  traffic_lanes: {
    name: 'Traffic Lanes',
    kind: 'lanes',
    desc: 'Trucks barrel down 3 horizontal lanes. Heavy damage to you AND to enemies.',
    telegraph: 1.5,
    params: {
      lanes: 3, interval: 11, speed: 900, damage: 45, width: 140,
      damagesEnemies: true,
    },
  },

  collapsing_walls: {
    name: 'Collapsing Walls',
    kind: 'debris',
    desc: 'Three 170px rubble zones every 9s, 0.35s apart and never on your feet. ' +
      '60 damage, then 25s of cover that blocks enemies — and you.',
    // 1.5s, AND IT IS READ NOW. game/hazards.js hardcoded feel.telegraphLethal
    // (1.0s) and this field was decoration — the same dead-data failure the
    // header of that file documents for the hazard kinds themselves. The floor
    // is 170/168 (slowest character) + 0.07 accel + 0.25 reaction = 1.33s.
    telegraph: 1.5,
    params: {
      interval: 9, zones: 3, radius: 170, damage: 60, damagesEnemies: true,
      // NEVER ON YOUR FEET. The inner radius is wider than the blast, so a
      // volley is always something you route around rather than something you
      // are already standing in. It also has to be this wide for the spacing to
      // work: at 200px the two closest sectors were a 272px chord apart, which
      // is narrower than the 340px two 170px discs need to not overlap.
      minRange: 300, maxRange: 620, spacing: 340, stagger: 0.35,
      // The wreck is registered as a static blocker; enemies steer around it
      // rather than path around it (DECISIONS.md §18).
      obstacleRadius: 110, obstacleLifetime: 25, blocksPathing: true,
    },
  },

  smoke_bombs: {
    name: 'Smoke Bombs',
    kind: 'visibility',
    desc: 'Every 35s, 12s of smoke. You see 300px. The enemies do not care.',
    telegraph: 1.0,
    params: {
      interval: 35, duration: 12, visionRadius: 300, damage: 0,
      damagesEnemies: false,
    },
  },

  shifting_rooms: {
    name: 'Shifting Rooms',
    kind: 'reconfigure',
    desc: 'Every 45s the walls slide, new corridors form, and you are dropped ' +
      'somewhere else. The rumble is your 2s warning.',
    telegraph: 2.0,
    params: {
      interval: 45, wallCount: 14, repositionsPlayer: true,
      repositionsEnemies: false, blocksPathing: true,
    },
  },

  rising_tide: {
    name: 'Rising Tide',
    kind: 'cycle',
    desc: '60s tide cycle. High tide: everyone moves 20% slower and knockback is ' +
      'doubled. Low tide is your window.',
    telegraph: 3.0,
    params: {
      period: 60, highTideDuration: 30, moveMult: 0.8, knockbackMult: 2.0,
      appliesToEnemies: true,
    },
  },

  spotlights: {
    name: 'Spotlights',
    kind: 'zones',
    desc: 'Roaming 260px lights. Inside one you deal +50% damage — and every ranged ' +
      'enemy on the stage aims at you.',
    // Permanently visible, so no warning window: standing in one is a choice.
    telegraph: 0,
    params: {
      count: 3, radius: 260, speed: 70, damageMult: 1.5, marksPlayer: true,
      rangedAggroGlobal: true, damage: 0, damagesEnemies: false,
    },
  },
};

// -----------------------------------------------------------------------------
// BACKDROPS — the layered scenery each stage is drawn on.
//
// `kind` selects the BUILDER in render/stageBackdrop.js, exactly the way a
// hazard's `kind` selects its handler: the builder knows how to assemble a
// rooftop or a wet street out of renderer primitives, and everything about what
// COLOUR that rooftop is lives here. A stage that wanted an existing vocabulary
// in new colours would be a data-only addition.
//
// The colour roles are the same seven names for every kind, so the builders can
// read them generically and a re-skin never has to learn a new field:
//   far / farEdge / farLit   the distant silhouette layer and its lit trim
//   mid / midEdge            the near-scenery layer and its outline
//   tile / seam              the ground pattern and the lines between its cells
//   detail                   the small ground scatter (petals, ash, planks)
//   glow                     the one warm/bright accent a stage is lit by
//
// `density` scales how many elements the DISTANT layer places. It is a knob for
// "this stage feels cluttered" — the near layers are hand-composed per kind and
// the draw is culled against the view either way, so it is not a perf dial.
// -----------------------------------------------------------------------------
export const BACKDROPS = {
  /**
   * STAGE 1 — the school COURTYARD, and it is a plan rather than a texture.
   *
   * Every other kind in this table is a surface: a hash picks a tone, a district
   * hash picks a sheen, and the result is a convincing floor you could be
   * standing anywhere on. That is right for a rooftop and wrong for the first
   * place a player ever sees, because a courtyard is the one location in the
   * game that has a FRONT and a BACK — you come in at the gate and the building
   * is at the far end — and none of that survives being noise.
   *
   * So the `courtyard` case is keyed on the absolute cell indices instead. The
   * cell walk is anchored to the world origin (see `_ground`), so cell (i,j) is
   * always the world rect (i*200, j*200, 200, 200) in every run at every camera
   * position, and the seed only ever perturbs the grain INSIDE a cell. That
   * makes a fixed 20x20 plan expressible with no storage and no engine change.
   *
   * `tile` is now the paving, `mid` the grass, `far` the building floor and
   * `farLit` the tiled roofs — the roles are the same seven names every kind
   * uses, pointed at different materials.
   */
  school_courtyard: {
    kind: 'courtyard',
    desc: 'A paved path from the gate to the main doors, lawns and hedges either ' +
          'side, the fountain in the middle, and blossom over all of it.',
    far: '#4a2b48', farEdge: '#ff7f50', farLit: '#8a4668',
    mid: '#3d5a3a', midEdge: '#24371f',
    tile: '#6b5464', seam: '#4a3448',
    detail: '#ff9ec4', glow: '#ffd166',
    density: 1.0,
  },

  school_roof: {
    kind: 'rooftop',
    desc: 'Concrete roof bays, drainage channels, court paint, drifted petals.',
    far: '#331634', farEdge: '#ff7f50', farLit: '#ffd166',
    mid: '#7a4470', midEdge: '#3d1a3a',
    tile: '#43213f', seam: '#5a2e52',
    detail: '#ff9ec4', glow: '#ff7f50',
    density: 1.0,
  },

  wet_street: {
    kind: 'wet_street',
    desc: 'Poured asphalt, tyre lanes, kerbs, and puddles doubling the signs.',
    far: '#150c2b', farEdge: '#ff2d95', farLit: '#6ad8ff',
    mid: '#2a1a4a', midEdge: '#0a0616',
    tile: '#160d2c', seam: '#241546',
    detail: '#6ad8ff', glow: '#ff2d95',
    density: 1.1,
  },

  ruined_town: {
    kind: 'ruins',
    desc: 'Hand-laid flagstones, cracks, rubble, and stretches with no paving left.',
    far: '#1f2227', farEdge: '#0f1113', farLit: '#3a3f47',
    mid: '#33373e', midEdge: '#191b1f',
    tile: '#2d3037', seam: '#3a3f47',
    detail: '#585d66', glow: '#e07a3f',
    density: 1.0,
  },

  hidden_village: {
    kind: 'village',
    desc: 'Packed earth, raked yards, plank roads, and the pools the lanterns throw.',
    far: '#141a2a', farEdge: '#0a0e18', farLit: '#25384d',
    mid: '#241a12', midEdge: '#100c08',
    tile: '#1d1712', seam: '#2c2117',
    detail: '#3a2c1e', glow: '#ffa53c',
    density: 1.0,
  },

  paper_halls: {
    kind: 'halls',
    desc: 'Tatami without a building, bound in heri, edged by a polished engawa.',
    far: '#161036', farEdge: '#0d0a24', farLit: '#f2e6c0',
    mid: '#3a2350', midEdge: '#120c22',
    tile: '#2e2036', seam: '#4a2f60',
    detail: '#c8102e', glow: '#f2e6c0',
    density: 0.9,
  },

  sunken_stadium: {
    kind: 'reef',
    desc: 'Rippled seabed sand, caustics on the crests, a pitch still marked out.',
    far: '#07243a', farEdge: '#031420', farLit: '#0d3a52',
    mid: '#0a3048', midEdge: '#031420',
    tile: '#08263a', seam: '#0d3a52',
    detail: '#46f0d0', glow: '#3fa9ff',
    density: 1.1,
  },

  zenith_deck: {
    kind: 'zenith',
    desc: 'Polished stage boards, inlaid light strips, footlights, gaffer marks.',
    far: '#0e1a3a', farEdge: '#060418', farLit: '#7cf7d0',
    mid: '#20305c', midEdge: '#080a1a',
    tile: '#131338', seam: '#20305c',
    detail: '#fff3a8', glow: '#7cf7d0',
    density: 1.0,
  },
};

// -----------------------------------------------------------------------------
// OBSTACLE SETS — the static blockers scattered at run start.
//
// The brief was exact about the tuning: "things here and there", not a maze. In
// a 4000x4000 arena, ~20 pieces is one every 800px in each direction — you meet
// one every few seconds of running and never have to navigate a corridor.
// `spacing` keeps them from clumping into a wall and `clearance` is the radius
// held empty around the player's start AND the altar, because the two places a
// player is guaranteed to stand are the two places a blocker must never be.
//
// `forms` is a weighted roll of piece shapes. `w`/`h`/`r` are [min, max] ranges,
// and w/h are HALF-extents because that is what ObstacleField.addBox takes.
//
// `visual` is the sprite circular pieces blit. It is joined into the boot-time
// pre-raster by data/index.js allVisuals(), so adding a set here cannot cost a
// mid-run rasterisation — which is what tests/renderSmoke.js fails the build over.
// `box` is the fill/edge pair for rectangular pieces, which are primitives.
// `detail` picks the extra pass drawn on top of a box: slats | lattice | ribs |
// bolts | none.
// -----------------------------------------------------------------------------
export const OBSTACLE_SETS = {
  // Kept so a stage can honestly declare that it has none. Nothing uses it
  // today; every stage got geometry in this pass.
  none: { name: 'Open Ground', count: 0, spacing: 0, clearance: 0, forms: [] },

  /**
   * THE COURTYARD, AND IT IS PLACED RATHER THAN SCATTERED.
   *
   * Two things here are new and both are engine features this set is the first
   * user of (see game/obstacles.js):
   *
   *   `kinds`   a list of named LOOKS. Every other set has ONE — one sprite, one
   *             box fill, one detail pass — which is correct for "rubble" and
   *             useless for a place that has benches AND hedges AND a fountain
   *             in it. Each piece now carries a one-byte index into this list.
   *
   *   `layout`  literal pieces at absolute positions, as FRACTIONS of the arena
   *             so the plan survives ARENA_W changing. `scatter` is rejection
   *             sampling and can only say "things here and there"; a courtyard
   *             has a fountain in the MIDDLE of it, benches ALONG the path and
   *             hedges EDGING the lawns, and none of that is a random position.
   *
   * The layout is written against the same 20x20 cell plan the backdrop paints,
   * so the hedges sit on the grass and the benches sit beside the paving rather
   * than on it. Column 9-10 is the path (x 0.45-0.55); rows 0-1 and columns
   * 0-2 / 17-19 are buildings, which the backdrop draws and which the arena
   * edge already keeps the player out of.
   *
   * `count: 0`: nothing is scattered on top. A courtyard with random litter
   * blocking it is a courtyard nobody swept, and the whole point of this stage
   * is that it is the legible one.
   */
  academy_courtyard: {
    name: 'Academy Courtyard',
    count: 0, spacing: 260, clearance: 300, forms: [],
    // Kind 0 — the set's own look, and the fallback for anything unnamed.
    detail: 'slats',
    visual: { shape: 'hedge', color: '#3f7a46', accent: '#16301c', size: 32, flash: false },
    box: { color: '#6b4a2a', edge: '#241608' },
    kinds: [
      {
        id: 'hedge', detail: 'none',
        visual: { shape: 'hedge', color: '#3f7a46', accent: '#16301c', size: 32, flash: false },
        box: { color: '#2f6a38', edge: '#16301c' },
      },
      {
        id: 'fountain', detail: 'none',
        visual: { shape: 'fountain', color: '#9aa4b0', accent: '#2a3038', size: 32, flash: false },
        box: { color: '#8e98a6', edge: '#2a3038' },
      },
      {
        // A bench is a BOX, not a circle: it is wide and shallow, and a circular
        // hitbox round it would either swallow the path or miss the ends. Boxes
        // never blit a sprite (obstacles.js draws them as a rect plus a detail
        // pass), so the slats ARE the bench.
        id: 'bench', detail: 'slats',
        visual: { shape: 'hedge', color: '#6b4a2a', accent: '#241608', size: 32, flash: false },
        box: { color: '#6b4a2a', edge: '#241608' },
      },
      {
        id: 'planter', detail: 'bolts',
        visual: { shape: 'hedge', color: '#3f7a46', accent: '#16301c', size: 32, flash: false },
        box: { color: '#7a6a52', edge: '#2a2018' },
      },
    ],
    layout: [
      // THE FOUNTAIN, dead centre — which is also where the player spawns, so
      // it is offset a little up the path rather than exactly on 0.5/0.5.
      { kind: 'fountain', x: 0.50, y: 0.42, r: 0.042 },

      // BENCHES facing the path, in pairs, down its length.
      { kind: 'bench', x: 0.415, y: 0.30, w: 0.040, h: 0.011 },
      { kind: 'bench', x: 0.585, y: 0.30, w: 0.040, h: 0.011 },
      { kind: 'bench', x: 0.415, y: 0.58, w: 0.040, h: 0.011 },
      { kind: 'bench', x: 0.585, y: 0.58, w: 0.040, h: 0.011 },
      { kind: 'bench', x: 0.415, y: 0.74, w: 0.040, h: 0.011 },
      { kind: 'bench', x: 0.585, y: 0.74, w: 0.040, h: 0.011 },

      // HEDGES edging the four lawns. Two runs either side, set well off the
      // kerb so the path itself is never pinched — the horde steers rather than
      // pathfinds, and a corridor is the one shape that turns that into a wall.
      { kind: 'hedge', x: 0.30, y: 0.22, r: 0.030 },
      { kind: 'hedge', x: 0.30, y: 0.34, r: 0.030 },
      { kind: 'hedge', x: 0.30, y: 0.46, r: 0.030 },
      { kind: 'hedge', x: 0.70, y: 0.22, r: 0.030 },
      { kind: 'hedge', x: 0.70, y: 0.34, r: 0.030 },
      { kind: 'hedge', x: 0.70, y: 0.46, r: 0.030 },
      { kind: 'hedge', x: 0.30, y: 0.62, r: 0.030 },
      { kind: 'hedge', x: 0.30, y: 0.74, r: 0.030 },
      { kind: 'hedge', x: 0.30, y: 0.86, r: 0.030 },
      { kind: 'hedge', x: 0.70, y: 0.62, r: 0.030 },
      { kind: 'hedge', x: 0.70, y: 0.74, r: 0.030 },
      { kind: 'hedge', x: 0.70, y: 0.86, r: 0.030 },

      // PLANTERS flanking the main doors at the top of the path, and two more
      // just inside the gate, so both ends of the walk are announced.
      { kind: 'planter', x: 0.44, y: 0.13, w: 0.016, h: 0.016 },
      { kind: 'planter', x: 0.56, y: 0.13, w: 0.016, h: 0.016 },
      { kind: 'planter', x: 0.44, y: 0.855, w: 0.016, h: 0.016 },
      { kind: 'planter', x: 0.56, y: 0.855, w: 0.016, h: 0.016 },
    ],
  },

  rooftop_clutter: {
    name: 'Rooftop Clutter',
    count: 20, spacing: 250, clearance: 430,
    detail: 'slats',
    visual: { shape: 'circle', color: '#8a93a0', accent: '#1b1016', size: 32, flash: false },
    box: { color: '#7a5638', edge: '#1a1008' },
    // Desks that have been up here since before anyone can remember, plus the
    // water tanks nobody has ever seen a maintenance crew visit.
    forms: [
      { form: 'box', weight: 5, w: [46, 92], h: [26, 40] },
      { form: 'circle', weight: 2, r: [30, 44] },
    ],
  },

  street_furniture: {
    name: 'Street Furniture',
    count: 21, spacing: 230, clearance: 430,
    detail: 'lattice',
    visual: { shape: 'circle', color: '#3a2a6a', accent: '#0a0616', size: 32, flash: false },
    box: { color: '#2f1f5c', edge: '#0a0616' },
    // Vending machines, crash barriers, and the claw machine you will lose
    // money to. Denser than the rooftop because a city is denser than a roof —
    // but the BARRIERS are short. A headless sweep that walks a bot straight at
    // its objective got pinned against a 260px-long one for a whole event timer,
    // and while a player would sidestep, the arena that produces that is the
    // arena where the traffic lanes get to pin you against a wall as well.
    forms: [
      { form: 'box', weight: 6, w: [30, 54], h: [40, 72] },
      { form: 'box', weight: 3, w: [55, 95], h: [18, 24] },
      { form: 'circle', weight: 1, r: [26, 36] },
    ],
  },

  rubble: {
    name: 'Fallen Masonry',
    count: 26, spacing: 210, clearance: 430,
    detail: 'ribs',
    // The one set that predates this table, so it keeps the engine's own
    // hex chunk: the collapsing-walls hazard drops more of exactly these.
    visual: { shape: 'hex', color: '#5a5f6b', accent: '#0b0d16', size: 32, flash: false },
    box: { color: '#4b4f58', edge: '#191b1f' },
    forms: [
      { form: 'circle', weight: 5, r: [34, 58] },
      { form: 'box', weight: 3, w: [40, 96], h: [24, 36] },
    ],
  },

  training_yard: {
    name: 'Training Yard',
    count: 22, spacing: 240, clearance: 430,
    detail: 'bolts',
    visual: { shape: 'circle', color: '#6b4a2a', accent: '#140d06', size: 32, flash: false },
    box: { color: '#43301c', edge: '#100c08' },
    // Barrels, crates and the striking posts every genin has resented.
    forms: [
      { form: 'circle', weight: 4, r: [26, 40] },
      { form: 'box', weight: 3, w: [22, 30], h: [22, 30] },
      { form: 'box', weight: 2, w: [60, 110], h: [16, 22] },
    ],
  },

  shifting_rooms: {
    name: 'Sliding Walls',
    count: 18, spacing: 260, clearance: 430,
    detail: 'lattice',
    visual: { shape: 'square', color: '#4a2f60', accent: '#120c22', size: 32, flash: false },
    box: { color: '#4a2f60', edge: '#120c22' },
    // The opening layout only. The shifting-rooms hazard calls
    // ObstacleField.clear() and rebuilds its own corridors on top of this,
    // which is exactly the point of the stage — do not "fix" it.
    forms: [
      { form: 'box', weight: 5, w: [80, 190], h: [20, 26] },
      { form: 'box', weight: 5, w: [20, 26], h: [80, 190] },
    ],
  },

  coral_heads: {
    name: 'Coral Heads',
    count: 24, spacing: 230, clearance: 430,
    detail: 'none',
    visual: { shape: 'star', color: '#3c8f8a', accent: '#04222c', size: 32, flash: false },
    box: { color: '#0f4a4a', edge: '#031420' },
    // Coral through every one of forty thousand seats, and a couple of rows
    // that are still recognisably rows.
    forms: [
      { form: 'circle', weight: 6, r: [30, 52] },
      { form: 'box', weight: 2, w: [70, 140], h: [16, 22] },
    ],
  },

  light_trusses: {
    name: 'Light Trusses',
    count: 18, spacing: 280, clearance: 430,
    detail: 'ribs',
    visual: { shape: 'hex', color: '#8a93a8', accent: '#080a1a', size: 32, flash: false },
    box: { color: '#2b3a66', edge: '#080a1a' },
    // Rigging that came down, or never went up. Sparse: the finale is a
    // gauntlet and it needs its floor.
    forms: [
      { form: 'box', weight: 5, w: [90, 170], h: [16, 20] },
      { form: 'box', weight: 3, w: [16, 20], h: [90, 170] },
      { form: 'circle', weight: 2, r: [26, 38] },
    ],
  },
};

// -----------------------------------------------------------------------------
// STAGE EVENTS — the optional detours.
//
// Play report: "add random mini events to the maps that suit the map as well,
// simply going to one place, killing mobs inside a circle etc." Same shape as
// HAZARDS: `kind` selects the handler in game/stageEvents.js, so a new event on
// an existing kind is a data-only addition and needs no engine work at all.
//
// FOUR KINDS:
//   reach   a marked spot appears at range; stand in it to claim it.
//   cull    kill `need` enemies inside a marked circle before the timer runs out.
//   hold    survive `need` seconds inside a ring that shrinks as it counts.
//   gather  collect `need` scattered motes before they expire.
//
// REWARDS ARE DELIBERATELY MODEST AND SELF-SCALING. `xpLevels` is a fraction of
// the CURRENT level's requirement rather than a flat XP number — a flat number
// is a free level at minute two and a rounding error at minute eighteen, and
// this system fires six or seven times a run. Half a level plus pocket change
// is worth walking 900px for; it is not worth restructuring a build around.
//   xpLevels  fraction of xpNeeded(level) granted
//   gold      flat, before the player's own gold multipliers
//   chest     drop a normal chest at the marker
//   goldChest drop a GOLD chest instead (3-5 upgrades — reserved for the two
//             hardest events in the game)
//   healPct   fraction of max HP restored
//
// `params`:
//   range    [min, max] px from the player the marker is placed at
//   radius   the marked circle
//   need     seconds to claim (reach), kills (cull), seconds held (hold),
//            or motes (gather)
//   limit    seconds on the clock before it fails
// -----------------------------------------------------------------------------
export const STAGE_EVENTS = {
  // --- Stage 1: Cherry Blossom Academy ------------------------------------
  rooftop_confession: {
    name: 'Rooftop Confession',
    kind: 'reach',
    color: '#ff9ec4',
    objective: 'Get to the spot',
    desc: 'Somebody left a note under a brick. The sunset is already doing its part.',
    params: { range: [720, 1080], radius: 115, need: 1.6, limit: 45 },
    reward: { xpLevels: 0.5, gold: 45 },
  },
  petal_drift: {
    name: 'Petal Drift',
    kind: 'gather',
    color: '#ffc2dd',
    objective: 'Catch the petals',
    desc: 'The fall rate is contractually fixed. Catching them is not.',
    params: { range: [520, 900], radius: 380, need: 8, limit: 40 },
    reward: { xpLevels: 0.35, gold: 30, healPct: 0.2 },
  },

  // --- Stage 2: Neon Akiba District ---------------------------------------
  crowd_control: {
    name: 'Crowd Control',
    kind: 'cull',
    color: '#ff2d95',
    objective: 'Clear the crossing',
    desc: 'The intersection is jammed. Unjam it.',
    params: { range: [640, 980], radius: 330, need: 18, limit: 32 },
    reward: { xpLevels: 0.45, gold: 150 },
  },
  capsule_burst: {
    name: 'Capsule Burst',
    kind: 'gather',
    color: '#6ad8ff',
    objective: 'Grab the capsules',
    desc: 'A machine finally gave up its stock. It will not do it twice.',
    params: { range: [560, 940], radius: 400, need: 10, limit: 42 },
    reward: { xpLevels: 0.25, gold: 60, chest: true },
  },

  // --- Stage 3: Ruins of Wall Amaris --------------------------------------
  hold_the_breach: {
    name: 'Hold the Breach',
    kind: 'hold',
    color: '#e07a3f',
    objective: 'Hold the gap',
    desc: 'There is a hole in the wall the size of a bakery. Stand in it.',
    params: { range: [600, 940], radius: 300, need: 16, limit: 34 },
    reward: { xpLevels: 0.6, gold: 60, chest: true },
  },
  supply_cache: {
    name: 'Supply Cache',
    kind: 'reach',
    color: '#c8cdd4',
    objective: 'Reach the cache',
    desc: 'Somebody\'s gear is still exactly where they dropped it.',
    params: { range: [780, 1180], radius: 110, need: 1.4, limit: 42 },
    reward: { xpLevels: 0.3, gold: 40, chest: true, healPct: 0.3 },
  },

  // --- Stage 4: Hidden Ember Village --------------------------------------
  signal_lantern: {
    name: 'Signal Lantern',
    kind: 'reach',
    color: '#ffa53c',
    objective: 'Make the rendezvous',
    desc: 'A lantern went up on the far roof. Somebody wants a meeting, urgently.',
    params: { range: [820, 1200], radius: 110, need: 1.4, limit: 40 },
    reward: { xpLevels: 0.5, gold: 70 },
  },
  smoke_and_steel: {
    name: 'Smoke and Steel',
    kind: 'cull',
    color: '#8ea0aa',
    objective: 'Finish the ambush',
    desc: 'The whole ambush is inside that ring. Being stabbed out of a bush is how they say hello.',
    params: { range: [620, 960], radius: 320, need: 16, limit: 30 },
    reward: { xpLevels: 0.45, gold: 55, chest: true },
  },

  // --- Stage 5: The Endless Tatami Halls ----------------------------------
  the_still_room: {
    name: 'The Still Room',
    kind: 'hold',
    color: '#c8102e',
    objective: 'Stay in the room',
    desc: 'Exactly one room is not moving. Do not get attached — but do not leave either.',
    params: { range: [560, 900], radius: 290, need: 18, limit: 36 },
    reward: { xpLevels: 0.65, gold: 60, healPct: 0.25 },
  },
  scattered_wards: {
    name: 'Scattered Wards',
    kind: 'gather',
    color: '#f2e6c0',
    objective: 'Collect the wards',
    desc: 'Somebody sealed these doors properly once. The paper is all over the floor now.',
    params: { range: [540, 920], radius: 420, need: 9, limit: 42 },
    reward: { xpLevels: 0.7, gold: 40 },
  },

  // --- Stage 6: Sunken Idol Reef ------------------------------------------
  pearl_bed: {
    name: 'Pearl Bed',
    kind: 'gather',
    color: '#46f0d0',
    objective: 'Work the bed',
    desc: 'Something in row J has been making these for a very long time.',
    params: { range: [560, 940], radius: 420, need: 10, limit: 44 },
    reward: { xpLevels: 0.5, gold: 45 },
  },
  feeding_frenzy: {
    name: 'Feeding Frenzy',
    kind: 'cull',
    color: '#3fa9ff',
    objective: 'Break up the frenzy',
    desc: 'The fish learned the choreography. This part of it is teeth.',
    params: { range: [620, 980], radius: 330, need: 22, limit: 32 },
    reward: { xpLevels: 0.5, gold: 60, chest: true, healPct: 0.25 },
  },

  // --- Stage 7: The Zenith Stage ------------------------------------------
  spotlight_check: {
    name: 'Spotlight Check',
    kind: 'hold',
    color: '#fff3a8',
    objective: 'Hold the mark',
    desc: 'The light found you. It would like to know whether you are the headliner.',
    params: { range: [620, 1000], radius: 300, need: 20, limit: 38 },
    reward: { xpLevels: 0.7, gold: 90, goldChest: true },
  },
  stage_call: {
    name: 'Stage Call',
    kind: 'reach',
    color: '#7cf7d0',
    objective: 'Take your mark',
    desc: 'Marks, please. A million silhouettes are waiting in the dark.',
    params: { range: [860, 1250], radius: 110, need: 1.6, limit: 42 },
    reward: { xpLevels: 0.6, gold: 80, chest: true },
  },
};

/** The four handlers game/stageEvents.js implements. Used by data/index.js. */
export const STAGE_EVENT_KINDS = ['reach', 'cull', 'hold', 'gather'];

// -----------------------------------------------------------------------------
// MODIFIERS — one rule twist per stage. Every `params` key is consumed by the
// stat pipeline; none of them are cosmetic.
// -----------------------------------------------------------------------------
export const MODIFIERS = {
  youth: {
    name: 'Youth',
    desc: '+20% XP gain.',
    params: { xpMult: 1.2 },
  },

  crowded_streets: {
    name: 'Crowded Streets',
    desc: '+25% enemy count, -10% enemy HP.',
    params: { countMult: 1.25, hpMult: 0.9 },
  },

  titans_shadow: {
    name: "Titan's Shadow",
    desc: 'LARGE enemies have +100% HP and drop 3x XP. Bring an execute.',
    params: { sizeFilter: 'large', largeHpMult: 2.0, largeXpMult: 3.0 },
  },

  shinobi_rules: {
    name: 'Shinobi Rules',
    desc: 'Enemies move +20% faster. You dodge 15% of incoming hits.',
    params: { speedMult: 1.2, playerDodge: 0.15 },
  },

  demon_moon: {
    name: 'Demon Moon',
    desc: 'Enemies regenerate 1% of max HP per second. Burn them down or lose them.',
    params: { enemyRegenPct: 0.01 },
  },

  deep_pressure: {
    name: 'Deep Pressure',
    desc: 'Pickup radius halved. Gold is worth 3x.',
    params: { pickupRadiusMult: 0.5, goldMult: 3.0 },
  },

  grand_finale: {
    name: 'Grand Finale',
    desc: 'Every 5 minutes a previous stage boss walks on as an elite. All rewards +50%.',
    params: {
      bossEliteInterval: 300,
      // Boss statlines are built for a solo fight; as a mid-run elite they come in
      // at 45% HP so the finale stays a gauntlet and not six boss fights.
      bossEliteHpMult: 0.45,
      rewardMult: 1.5,
      pool: ['student_council_president', 'the_algorithm', 'the_colossus',
        'the_sealed_beast', 'kagutsuchi', 'the_kraken_producer'],
    },
  },
};

// -----------------------------------------------------------------------------
// DIFFICULTY TIERS — unlocked per-stage after that stage's first clear.
// Kamige's blanket affix roll excludes Splitting and Volatile; the roll table
// lives with the affixes, not here (DECISIONS.md §25).
// -----------------------------------------------------------------------------
export const DIFFICULTY_TIERS = [
  {
    id: 'debut', name: 'Debut',
    hpMult: 1.0, speedMult: 1.0, rewardMult: 1.0, eliteMult: 1,
    desc: 'The stage as written.',
  },
  {
    id: 'encore', name: 'Encore',
    hpMult: 1.5, speedMult: 1.25, rewardMult: 1.3, eliteMult: 1,
    desc: '+50% enemy HP, +25% speed, +30% rewards.',
  },
  {
    id: 'legend', name: 'Legend',
    hpMult: 2.5, speedMult: 1.5, rewardMult: 1.8, eliteMult: 2,
    desc: '+150% enemy HP, +50% speed, 2x elites, +80% rewards.',
  },
  {
    id: 'kamige', name: 'Kamige',
    hpMult: 5.0, speedMult: 1.5, rewardMult: 2.5, eliteMult: 2,
    allMobsAffixed: true,
    desc: '+400% enemy HP, +50% speed, 2x elites, every mob gets an affix, +150% rewards.',
  },
];

// -----------------------------------------------------------------------------
// SCALING — SECTION 8's formulas, as their coefficients. t is in MINUTES.
//   hp        base * (1 + hp * t)        * difficultyMult * stageMult
//   damage    base * (1 + damage * t)    * difficultyMult
//   speed     base * (1 + speed * t)     capped at speedCap
//   xp        base * (1 + xp * t)
//   spawnRate baseRate * (1 + spawnRate * t)
// k=0.115 for HP is deliberate and load-bearing: enemy HP must grow slower than
// player DPS or the power fantasy dies (DECISIONS.md §14). Retune stage hpMult,
// not this.
// -----------------------------------------------------------------------------
export const SCALING = {
  hp: 0.115,
  damage: 0.06,
  speed: 0.012,
  speedCap: 1.5,
  xp: 0.09,
  spawnRate: 0.18,
};

// -----------------------------------------------------------------------------
// MID-BOSS HP — [minutes into the run, multiplier on `def.hp`].
//
// THIS REPLACES THE FLAT +6%/MIN FOR MID-BOSSES, and it exists because that flat
// curve had the difficulty of a run running BACKWARDS. Play report: "mini bosses
// that spawn around the map are harder to kill than the final match boss."
// Measured, headlessly, four characters x three seeds on the 20-minute stage:
//
//   fight                      effective HP   MEDIAN TTK   implied single-target DPS
//   opener      (minute 5.2)          1,443       76.9s      19
//   signature   (minute 10.0)         2,800       16.4s     171
//   closer      (minute 15.6)         5,227        8.0s     653
//   FINALE      (minute 19.1)        21,450        4.2s   5,107
//
// Eighteen times the fight for a fifteenth of the health bar. The opener was the
// hardest thing in the run and the finale was the easiest, and on the two late
// stages — which borrow a 6,400-HP rung for their minute-4 opener — that same
// fight measured 361s and 644s. Player damage compounds ~270x across a run
// against an HP curve that grows 2.1x, and the pre-boss calm CLEARS THE FIELD,
// so every point of a build's area damage lands on the finale while a mid-boss
// soaks a fraction of it through a 200-enemy crowd.
//
// So "much more HP" cannot be a flat multiplier: it would double a fight that is
// already a ten-minute wall. It is a CURVE — an opener is cheap because nothing
// can kill it yet, a closer is ten times its base because by minute 16 the
// player deletes the old number in eight seconds. Re-measured on the same twelve
// samples, this table gives 36.1s / 27.5s / 33.5s against a 49.5s finale.
//
// Linear between points, flat outside them — the same shape as the WaveDirector's
// density curve. Retune THIS, not SCALING.hp: mid-bosses are the only thing that
// reads it, and fodder HP must keep growing slower than player DPS (§14).
// -----------------------------------------------------------------------------
export const MIDBOSS_HP_CURVE = [
  [0,   0.35],
  [4,   0.45],
  [6,   0.65],
  [8,   1.60],
  [10,  3.00],
  [13,  6.00],
  [16, 10.00],
  [20, 15.00],
  [25, 20.00],
];

// Written out literally rather than built by a loop — this file stays pure data.
export const STAGES_BY_ID = {
  cherry_academy: STAGES[0],
  neon_akiba: STAGES[1],
  wall_amaris: STAGES[2],
  hidden_ember: STAGES[3],
  tatami_halls: STAGES[4],
  sunken_reef: STAGES[5],
  zenith_stage: STAGES[6],
};
