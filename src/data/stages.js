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
//                   Combined with the boss HP-over-time scaling in game/boss.js
//                   the fights land at roughly 1.8x each other. Wall Amaris:
//                   2,526 -> 4,752 -> 8,944 -> 14,913 for the finale.
//
//                   `midBosses` is a fallback list only — the authored timelines
//                   in waves.js are what actually place these fights, and the
//                   WaveDirector rebuilds this list from `midBoss` if it is absent.
//   mobTable[].weight   relative spawn share once the mob is eligible.
//   mobTable[].from     seconds into the run before this mob may appear at all.
//   hpMult/xpMult/goldMult  per-stage tuning knobs applied on top of SCALING.
//                   DECISIONS.md §14 makes these the intended TTK dial, so the
//                   global k values never have to be touched for one stage.
//   obstacles       which static-blocker set game/obstacles.js registers for this
//                   stage: none | rubble | shifting_rooms (DECISIONS.md §18 —
//                   steering avoidance, not pathfinding).
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
    obstacles: 'none',
    music: 'audio/stage1.ogg',
    codex: 'Three years of your life happen on this roof. The fence is for leaning ' +
      'on dramatically, the desk has been up here since before anyone can remember, ' +
      'and the sunset is contractually obligated to be that colour. The petals fall ' +
      'at exactly the rate that makes a confession feel inevitable. Nobody has ever ' +
      'attended a class here. Nobody has ever questioned that.',
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
    ],
    elite: 'gacha_golem',
    midBoss: 'mascot_prime',
    midBosses: ['delinquent_senpai', 'mascot_prime', 'the_armored'],
    boss: 'the_algorithm',
    firstClearReward: { starFragments: 50, relic: 'neon_visor' },
    // Zombies queueing for capsules carry cash.
    hpMult: 1.0, xpMult: 1.0, goldMult: 1.1,
    obstacles: 'none',
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
    ],
    elite: 'abnormal',
    midBoss: 'the_armored',
    midBosses: ['mascot_prime', 'the_armored', 'the_twin_fangs'],
    boss: 'the_colossus',
    firstClearReward: { starFragments: 50, relic: 'anchor_gear' },
    // Titan's Shadow already doubles LARGE HP; the flat knob stays gentle.
    hpMult: 1.1, xpMult: 1.05, goldMult: 1.0,
    obstacles: 'rubble',
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
    ],
    elite: 'sealed_vessel',
    midBoss: 'the_twin_fangs',
    midBosses: ['the_armored', 'the_twin_fangs', 'the_drum_oni'],
    boss: 'the_sealed_beast',
    firstClearReward: { starFragments: 50, relic: 'nine_seal_ward' },
    hpMult: 1.1, xpMult: 1.05, goldMult: 1.05,
    obstacles: 'none',
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
    ],
    elite: 'upper_rank_remnant',
    midBoss: 'the_drum_oni',
    midBosses: ['the_twin_fangs', 'the_drum_oni', 'tide_warden'],
    boss: 'kagutsuchi',
    firstClearReward: { starFragments: 50, relic: 'everblade_fragment' },
    // The skill-check stage, and two minutes longer than its neighbours.
    hpMult: 1.2, xpMult: 1.1, goldMult: 1.0,
    obstacles: 'shifting_rooms',
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
    ],
    elite: 'elite_encore_siren',
    midBoss: 'tide_warden',
    midBosses: ['the_drum_oni', 'tide_warden', 'the_opening_act'],
    boss: 'the_kraken_producer',
    firstClearReward: { starFragments: 50, relic: 'abyssal_setlist' },
    // Deep Pressure already triples gold; the stage knob stays at 1.0.
    hpMult: 1.15, xpMult: 1.1, goldMult: 1.0,
    obstacles: 'none',
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
    // Every spawnable enemy in the game appears exactly once (32 entries; the three
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
    obstacles: 'none',
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
    desc: 'Rubble drops every 9s: 60 damage in a 170px zone, then 25s of cover that ' +
      'blocks enemies — and you.',
    telegraph: 1.2,
    params: {
      interval: 9, zones: 3, radius: 170, damage: 60, damagesEnemies: true,
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
