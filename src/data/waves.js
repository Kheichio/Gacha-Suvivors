// ============================================================================
// WAVES — the seven hand-authored spawn timelines.
//
// DECISIONS.md §20: timelines are authored in NORMALISED TIME (0.0–1.0 of the
// stage's own duration) and scaled at load, because the stages run 15/20/22/25
// minutes. Nothing in here is a clock reading. `t: 0.50` is "halfway", always.
//
// FIXED ANCHORS (§20) — the WaveDirector re-anchors these three exactly, so the
// numbers written here for the last two entries are placeholders that only have
// to sort last:
//   mid-boss    t = 0.50                 (literal; written as 0.50 below)
//   calm        t = duration - 60s       (written as 0.955, 5s of nothing)
//   final boss  t = duration - 55s       (written as 0.960)
// Every stage's array therefore ends with a `calm` then a `boss`, in that order.
//
// MINI-BOSSES (play report: "add mini bosses to each stage")
// ----------------------------------------------------------
// Every stage now carries TWO or THREE `midboss` events instead of one:
//
//   ~0.26   the OPENER — the rung below this stage's own on the shared mid-boss
//           ladder. First real telegraphed fight of the run, right after the
//           0.25 first-elite beat has taught the shape of one.
//    0.50   the SIGNATURE — the stage's own, from stages.js `midBoss`. This is
//           the one the director pins to the halfway anchor, the only one that
//           clears the screen on arrival, and the only one that pays the full
//           mid-boss loot table (Gold Chest + guaranteed relic + 10💎).
//   ~0.78   the CLOSER — the rung above. It lands in the fully-covered phase at
//           roughly 60% of the stage boss's effective HP and it is meant to
//           frighten you.
//
// The director picks the anchor by proximity to 0.50, so ordering here is what
// decides which fight is the signature. Everything else spawns as a mini-boss:
// no screen clear, a floor chest instead of a Gold Chest, no guaranteed relic,
// and FRAGMENT_AWARDS.miniBoss. The ladder itself and the reasoning for reusing
// ids across stages live in stages.js on the `midBosses` field.
//
// THE BACK HALF (play report: "more challenging specifically for the later
// levels")
// ---------------------------------------------------------------------------
// Every stage's t > 0.5 region now also carries that stage's share of the
// sixteen enemies added in this pass, and every one of those entries is an
// ADDITION rather than a replacement — the old timeline is untouched, because
// the complaint was that the late game felt like the early game, not that the
// early game was wrong. Placement follows two rules:
//
//   * A new mob's FIRST appearance is small, alone, and in open floor, so the
//     rule it brings is legible once before it is legible in a crowd. Four Hall
//     Monitors at 0.57 teach that standing still has a timer; eight at 0.93 mean
//     there is no corner left.
//   * A new mob is placed where the STAGE argues with it. Couriers on the stage
//     with lanes, urchins on the stage that is tide-locked, braziers on the stage
//     whose corridors move, mortars on the stage built out of slow. A mob that
//     would play identically on any stage is placed on Stage 7, which is the
//     stage whose whole character is that everything shows up.
//
// DENSITY SHAPE (SECTION 8, normalised):
//   0.00–0.10  15–30 on screen, one mob type, teaching
//   0.10–0.25  40–70, second type, first ring wave ~0.18
//   0.25       FIRST ELITE (drops a chest)
//   0.26       MINI-BOSS (opener)
//   0.25–0.45  80–130, three types mixing, a swarm every ~45s
//   0.50       MID-BOSS (the engine clears the screen first)
//   0.50–0.75  140–220, elite packs, two elites at ~0.65
//   0.75–0.95  250–400, the fully-covered phase
//   0.78       MINI-BOSS (closer)
//   0.955 calm / 0.960 final boss
//
// FIELDS
//   t         0.0–1.0, ascending. Asserted sorted by tests/data.test.js.
//   type      spawn | swarm | ring | elite | midboss | boss | event | calm
//   enemy     an enemy/elite/boss id; absent on `calm` and `event`
//   count     how many
//   pattern   edge_random | edge_side | ring | cluster | chase_line | ambush |
//             scatter_interior
//   duration  seconds to spread the spawns over (0 = instantaneous burst)
//   side      'left'|'right'|'top'|'bottom', only with pattern 'edge_side'
//   modifiers optional { hpMult, speedMult, affix } — affix ids come from the
//             SECTION 9 elite affix table
//   event     only on type 'event': the id of the stage's OWN hazard (it must
//             appear in that stage's `hazards` array). An `event` entry is a
//             pacing cue asking the hazard to fire on the beat — it never
//             introduces a mechanic the stage does not already own.
//
// Every id used here is on the canonical list. Split children (tiny_slime,
// blood_shard, mascot_splinter) are deliberately absent: they are spawned by
// their parents, never by the timeline.
// ============================================================================

export const WAVES = {

  // --------------------------------------------------------------------------
  // STAGE 1 — CHERRY BLOSSOM ACADEMY  (15 min, ★)
  // Character: the tutorial. Gentle ramp, generous gaps, one idea at a time.
  // It is the only stage with mid-timeline `calm` beats — the player is being
  // taught to read a lull as "spend your level-ups now". Counts stay deliberately
  // under the standard curve; SECTION 8 says tune per stage and this is the
  // stage that gets tuned DOWN.
  // --------------------------------------------------------------------------
  cherry_academy: [
    { t: 0.00, type: 'spawn', enemy: 'mob_student', count: 14, pattern: 'edge_random', duration: 8 },
    { t: 0.03, type: 'spawn', enemy: 'mob_student', count: 16, pattern: 'edge_random', duration: 12 },
    // First edge_side of the game, from one side only, with nothing behind you.
    { t: 0.07, type: 'spawn', enemy: 'mob_student', count: 20, pattern: 'edge_side', side: 'left', duration: 10 },
    { t: 0.10, type: 'calm', duration: 4 },
    { t: 0.11, type: 'spawn', enemy: 'chibi_ghost', count: 18, pattern: 'edge_random', duration: 10 },
    { t: 0.14, type: 'swarm', enemy: 'chibi_ghost', count: 24, pattern: 'cluster', duration: 4 },
    { t: 0.17, type: 'spawn', enemy: 'mob_student', count: 26, pattern: 'edge_random', duration: 12 },
    { t: 0.18, type: 'ring', enemy: 'chalk_wraith', count: 16, pattern: 'ring', duration: 0 },
    { t: 0.21, type: 'spawn', enemy: 'slime_kouhai', count: 14, pattern: 'edge_random', duration: 10 },
    { t: 0.24, type: 'spawn', enemy: 'mob_student', count: 30, pattern: 'edge_random', duration: 12 },
    { t: 0.25, type: 'elite', enemy: 'perfect_attendance_award', count: 1, pattern: 'cluster' },
    { t: 0.27, type: 'spawn', enemy: 'chibi_ghost', count: 26, pattern: 'edge_random', duration: 10 },
    { t: 0.30, type: 'spawn', enemy: 'slime_kouhai', count: 18, pattern: 'cluster', duration: 6 },
    { t: 0.33, type: 'swarm', enemy: 'chibi_ghost', count: 30, pattern: 'cluster', duration: 4 },
    { t: 0.35, type: 'spawn', enemy: 'gym_uniform_ghoul', count: 10, pattern: 'edge_random', duration: 8 },
    { t: 0.37, type: 'spawn', enemy: 'mob_student', count: 34, pattern: 'edge_random', duration: 14 },
    { t: 0.39, type: 'ring', enemy: 'chalk_wraith', count: 20, pattern: 'ring', duration: 0 },
    { t: 0.41, type: 'calm', duration: 4 },
    // Cursed Desks arrive alone and in the open so the 0.8s charge telegraph is
    // legible before they are ever mixed into a crowd.
    { t: 0.42, type: 'spawn', enemy: 'cursed_desk', count: 6, pattern: 'scatter_interior', duration: 4 },
    { t: 0.44, type: 'swarm', enemy: 'slime_kouhai', count: 22, pattern: 'cluster', duration: 5 },
    { t: 0.46, type: 'spawn', enemy: 'mob_student', count: 36, pattern: 'edge_random', duration: 12 },
    { t: 0.48, type: 'spawn', enemy: 'gym_uniform_ghoul', count: 12, pattern: 'edge_side', side: 'right', duration: 8 },
    { t: 0.50, type: 'midboss', enemy: 'delinquent_senpai', count: 1 },
    { t: 0.53, type: 'spawn', enemy: 'mob_student', count: 30, pattern: 'edge_random', duration: 12 },
    { t: 0.56, type: 'spawn', enemy: 'chibi_ghost', count: 30, pattern: 'edge_random', duration: 10 },
    // THE BACK HALF, from here on, is where this pass lives (play report: "more
    // challenging specifically for the later levels"). Hall Monitors arrive in
    // the open and in small numbers, because the thing they teach — that
    // standing still now has a timer on it — has to be legible the first time.
    { t: 0.57, type: 'spawn', enemy: 'hall_monitor', count: 4, pattern: 'scatter_interior', duration: 4 },
    { t: 0.59, type: 'ring', enemy: 'chalk_wraith', count: 24, pattern: 'ring', duration: 0 },
    { t: 0.61, type: 'spawn', enemy: 'gym_uniform_ghoul', count: 14, pattern: 'edge_random', duration: 8 },
    { t: 0.63, type: 'swarm', enemy: 'slime_kouhai', count: 26, pattern: 'cluster', duration: 5 },
    { t: 0.65, type: 'elite', enemy: 'perfect_attendance_award', count: 2, pattern: 'cluster' },
    // The first genuinely fast thing this stage has ever produced: 124 base
    // against a roof full of 40-to-66 speed fodder. It arrives from the edge so
    // the player watches it overtake the crowd it came in with.
    { t: 0.66, type: 'spawn', enemy: 'eraser_gremlin', count: 26, pattern: 'edge_random', duration: 8 },
    { t: 0.68, type: 'spawn', enemy: 'mob_student', count: 40, pattern: 'edge_random', duration: 14 },
    { t: 0.71, type: 'spawn', enemy: 'cursed_desk', count: 8, pattern: 'scatter_interior', duration: 5 },
    { t: 0.74, type: 'swarm', enemy: 'chibi_ghost', count: 36, pattern: 'cluster', duration: 4 },
    { t: 0.75, type: 'swarm', enemy: 'eraser_gremlin', count: 34, pattern: 'cluster', duration: 3 },
    { t: 0.76, type: 'spawn', enemy: 'mob_student', count: 48, pattern: 'edge_random', duration: 14 },
    { t: 0.79, type: 'spawn', enemy: 'gym_uniform_ghoul', count: 18, pattern: 'edge_side', side: 'top', duration: 8 },
    // CLOSER. The sports-day mascot suit, still walking, twelve minutes in — and
    // at 2,700 effective HP against a 4,200 stage boss it is the first thing on
    // this stage that a player cannot simply out-damage while ignoring it.
    { t: 0.80, type: 'midboss', enemy: 'mascot_prime', count: 1 },
    { t: 0.82, type: 'ring', enemy: 'chalk_wraith', count: 30, pattern: 'ring', duration: 0 },
    // Six monitors scattered through the interior turns the last four minutes
    // into a stage with no safe corner in it, which is a thing this stage has
    // never had and the reason it stopped being minute three with bigger numbers.
    { t: 0.83, type: 'spawn', enemy: 'hall_monitor', count: 6, pattern: 'scatter_interior', duration: 4 },
    { t: 0.84, type: 'swarm', enemy: 'chibi_ghost', count: 40, pattern: 'cluster', duration: 4 },
    { t: 0.86, type: 'spawn', enemy: 'slime_kouhai', count: 30, pattern: 'edge_random', duration: 10 },
    { t: 0.88, type: 'elite', enemy: 'perfect_attendance_award', count: 1, pattern: 'cluster', modifiers: { affix: 'frenzied' } },
    { t: 0.90, type: 'spawn', enemy: 'mob_student', count: 55, pattern: 'edge_random', duration: 12 },
    { t: 0.91, type: 'swarm', enemy: 'eraser_gremlin', count: 44, pattern: 'cluster', duration: 3 },
    { t: 0.92, type: 'swarm', enemy: 'gym_uniform_ghoul', count: 24, pattern: 'cluster', duration: 6 },
    { t: 0.93, type: 'spawn', enemy: 'hall_monitor', count: 8, pattern: 'scatter_interior', duration: 5 },
    { t: 0.94, type: 'ring', enemy: 'chalk_wraith', count: 34, pattern: 'ring', duration: 0 },
    // Anchors: re-timed by the director to duration-60s and duration-55s.
    { t: 0.955, type: 'calm', duration: 5 },
    { t: 0.960, type: 'boss', enemy: 'student_council_president', count: 1 },
  ],

  // --------------------------------------------------------------------------
  // STAGE 2 — NEON AKIBA DISTRICT  (20 min, ★★)
  // Character: dense and FAST. Short spread durations, chase_lines down the
  // street, constant ranged chip from Camera Drones, and nine Antifan Swarm
  // packs growing 25 → 60 (SECTION 9: "spawns 25 at a time"). The Gacha Golem
  // elite runs away, so its waves are always paired with pressure that punishes
  // chasing it.
  // "Crowded Streets" (+25% count, −10% HP) is applied by the stage, not here.
  // --------------------------------------------------------------------------
  neon_akiba: [
    { t: 0.00, type: 'spawn', enemy: 'gacha_zombie', count: 18, pattern: 'edge_random', duration: 8 },
    { t: 0.04, type: 'spawn', enemy: 'gacha_zombie', count: 26, pattern: 'edge_side', side: 'left', duration: 8 },
    // Traffic taught early, while the street is still empty enough to watch it.
    { t: 0.08, type: 'event', event: 'traffic_lanes', duration: 6 },
    { t: 0.10, type: 'spawn', enemy: 'neon_otaku', count: 20, pattern: 'edge_random', duration: 8 },
    { t: 0.12, type: 'swarm', enemy: 'antifan_swarm', count: 25, pattern: 'cluster', duration: 3 },
    { t: 0.15, type: 'spawn', enemy: 'gacha_zombie', count: 32, pattern: 'edge_random', duration: 10 },
    { t: 0.16, type: 'spawn', enemy: 'camera_drone', count: 8, pattern: 'scatter_interior', duration: 4 },
    { t: 0.18, type: 'ring', enemy: 'neon_otaku', count: 24, pattern: 'ring', duration: 0 },
    { t: 0.21, type: 'swarm', enemy: 'antifan_swarm', count: 25, pattern: 'cluster', duration: 3 },
    { t: 0.23, type: 'spawn', enemy: 'gacha_zombie', count: 36, pattern: 'chase_line', duration: 10 },
    { t: 0.25, type: 'elite', enemy: 'gacha_golem', count: 1, pattern: 'cluster' },
    // OPENER. The same guy from the school roof, now working the arcade door.
    { t: 0.26, type: 'midboss', enemy: 'delinquent_senpai', count: 1 },
    { t: 0.27, type: 'spawn', enemy: 'camera_drone', count: 10, pattern: 'scatter_interior', duration: 5 },
    { t: 0.29, type: 'spawn', enemy: 'neon_otaku', count: 28, pattern: 'edge_random', duration: 8 },
    { t: 0.31, type: 'spawn', enemy: 'mascot_suit', count: 5, pattern: 'edge_random', duration: 6 },
    { t: 0.33, type: 'swarm', enemy: 'antifan_swarm', count: 30, pattern: 'cluster', duration: 3 },
    { t: 0.35, type: 'event', event: 'traffic_lanes', duration: 8 },
    { t: 0.36, type: 'spawn', enemy: 'gacha_zombie', count: 44, pattern: 'chase_line', duration: 12 },
    { t: 0.39, type: 'spawn', enemy: 'camera_drone', count: 12, pattern: 'scatter_interior', duration: 6 },
    { t: 0.41, type: 'ring', enemy: 'neon_otaku', count: 30, pattern: 'ring', duration: 0 },
    { t: 0.43, type: 'swarm', enemy: 'antifan_swarm', count: 35, pattern: 'cluster', duration: 3 },
    { t: 0.45, type: 'spawn', enemy: 'mascot_suit', count: 7, pattern: 'edge_side', side: 'right', duration: 6 },
    { t: 0.47, type: 'spawn', enemy: 'gacha_zombie', count: 48, pattern: 'edge_random', duration: 12 },
    { t: 0.50, type: 'midboss', enemy: 'mascot_prime', count: 1 },
    { t: 0.53, type: 'swarm', enemy: 'antifan_swarm', count: 35, pattern: 'cluster', duration: 3 },
    { t: 0.55, type: 'spawn', enemy: 'camera_drone', count: 16, pattern: 'scatter_interior', duration: 6 },
    // Couriers debut in fours, on the stage that has already spent eleven
    // minutes teaching that a yellow line across the street means MOVE. Same
    // alphabet, new sentence.
    { t: 0.56, type: 'spawn', enemy: 'courier_scooter', count: 4, pattern: 'edge_random', duration: 4 },
    { t: 0.58, type: 'spawn', enemy: 'gacha_zombie', count: 52, pattern: 'edge_random', duration: 12 },
    { t: 0.61, type: 'ring', enemy: 'mascot_suit', count: 10, pattern: 'ring', duration: 0 },
    // Two marshals into a ring of Mascot Suits and forty Antifans: the crowd
    // this stage is named for, 30% faster and hitting 25% harder, until you go
    // and find the two things in the middle of it holding the beat.
    { t: 0.62, type: 'spawn', enemy: 'hype_marshal', count: 2, pattern: 'scatter_interior', duration: 3 },
    { t: 0.63, type: 'swarm', enemy: 'antifan_swarm', count: 40, pattern: 'cluster', duration: 3 },
    { t: 0.65, type: 'elite', enemy: 'gacha_golem', count: 2, pattern: 'cluster' },
    { t: 0.68, type: 'spawn', enemy: 'neon_otaku', count: 38, pattern: 'edge_random', duration: 10 },
    // Six couriers lining up while the trucks are running: two sets of lanes,
    // one of which turns to follow you.
    { t: 0.69, type: 'spawn', enemy: 'courier_scooter', count: 6, pattern: 'edge_random', duration: 5 },
    { t: 0.70, type: 'event', event: 'traffic_lanes', duration: 10 },
    { t: 0.71, type: 'spawn', enemy: 'gacha_zombie', count: 58, pattern: 'chase_line', duration: 12 },
    { t: 0.74, type: 'spawn', enemy: 'camera_drone', count: 20, pattern: 'scatter_interior', duration: 6 },
    { t: 0.75, type: 'spawn', enemy: 'hype_marshal', count: 3, pattern: 'scatter_interior', duration: 3 },
    { t: 0.76, type: 'swarm', enemy: 'antifan_swarm', count: 45, pattern: 'cluster', duration: 3 },
    // CLOSER. A promotional mech wheeled out for a store opening. It is armoured,
    // it is slow, and the street is already full.
    { t: 0.78, type: 'midboss', enemy: 'the_armored', count: 1 },
    { t: 0.79, type: 'spawn', enemy: 'neon_otaku', count: 46, pattern: 'edge_random', duration: 10 },
    { t: 0.81, type: 'ring', enemy: 'neon_otaku', count: 40, pattern: 'ring', duration: 0 },
    { t: 0.83, type: 'spawn', enemy: 'mascot_suit', count: 12, pattern: 'edge_side', side: 'bottom', duration: 6 },
    { t: 0.84, type: 'spawn', enemy: 'courier_scooter', count: 8, pattern: 'edge_random', duration: 5 },
    { t: 0.85, type: 'swarm', enemy: 'antifan_swarm', count: 50, pattern: 'cluster', duration: 3 },
    // A Frenzied golem below half HP outruns almost everything. That is the joke.
    { t: 0.87, type: 'elite', enemy: 'gacha_golem', count: 1, pattern: 'cluster', modifiers: { affix: 'frenzied' } },
    { t: 0.89, type: 'spawn', enemy: 'gacha_zombie', count: 70, pattern: 'edge_random', duration: 12 },
    { t: 0.90, type: 'spawn', enemy: 'hype_marshal', count: 4, pattern: 'scatter_interior', duration: 3 },
    { t: 0.91, type: 'spawn', enemy: 'camera_drone', count: 24, pattern: 'scatter_interior', duration: 6 },
    { t: 0.92, type: 'spawn', enemy: 'courier_scooter', count: 10, pattern: 'edge_random', duration: 5 },
    { t: 0.93, type: 'swarm', enemy: 'antifan_swarm', count: 60, pattern: 'cluster', duration: 2 },
    { t: 0.94, type: 'ring', enemy: 'neon_otaku', count: 48, pattern: 'ring', duration: 0 },
    { t: 0.955, type: 'calm', duration: 5 },
    { t: 0.960, type: 'boss', enemy: 'the_algorithm', count: 1 },
  ],

  // --------------------------------------------------------------------------
  // STAGE 3 — RUINS OF WALL AMARIS  (20 min, ★★★)
  // Character: BIG and SLOW. Husk Wanderers arrive as walls from one side with
  // long spread durations — a tide, not a burst. The tension is the Sprinting
  // Husk terror spike: a small `ambush` group at 145 speed dropped into an
  // otherwise sluggish screen, escalating from 3 to 16 across the run. Rubble
  // Golems carry an explicit hpMult so "Titan's Shadow" (+100% HP on large
  // enemies, 3x XP) has something worth executing.
  // Deliberate deviation from the shared curve: where it asks for a `swarm`
  // burst every ~45s this stage sends an edge_side wall instead. A 14-second
  // wall of 80 Husk Wanderers IS this stage's swarm; a cluster pop would read
  // as the wrong stage.
  // --------------------------------------------------------------------------
  wall_amaris: [
    { t: 0.00, type: 'spawn', enemy: 'husk_wanderer', count: 20, pattern: 'edge_random', duration: 10 },
    { t: 0.04, type: 'spawn', enemy: 'husk_wanderer', count: 26, pattern: 'edge_side', side: 'left', duration: 12 },
    { t: 0.08, type: 'spawn', enemy: 'husk_wanderer', count: 30, pattern: 'edge_random', duration: 12 },
    { t: 0.11, type: 'spawn', enemy: 'crawler_husk', count: 14, pattern: 'edge_random', duration: 8 },
    { t: 0.13, type: 'spawn', enemy: 'husk_wanderer', count: 36, pattern: 'edge_side', side: 'right', duration: 12 },
    { t: 0.16, type: 'spawn', enemy: 'crawler_husk', count: 18, pattern: 'scatter_interior', duration: 8 },
    { t: 0.18, type: 'ring', enemy: 'husk_wanderer', count: 28, pattern: 'ring', duration: 0 },
    // First terror spike. Three of them, so the player learns the silhouette
    // while it is still survivable.
    { t: 0.20, type: 'spawn', enemy: 'sprinting_husk', count: 3, pattern: 'ambush', duration: 0 },
    { t: 0.22, type: 'spawn', enemy: 'husk_wanderer', count: 40, pattern: 'edge_random', duration: 12 },
    { t: 0.25, type: 'elite', enemy: 'abnormal', count: 1, pattern: 'cluster' },
    // OPENER. Something enormous in a costume that has not been a costume for a
    // long time. The rung below The Armored, and the first thing here that
    // telegraphs instead of simply walking at you.
    { t: 0.26, type: 'midboss', enemy: 'mascot_prime', count: 1 },
    { t: 0.27, type: 'spawn', enemy: 'crawler_husk', count: 22, pattern: 'edge_random', duration: 8 },
    { t: 0.30, type: 'spawn', enemy: 'husk_wanderer', count: 44, pattern: 'edge_side', side: 'top', duration: 14 },
    { t: 0.32, type: 'spawn', enemy: 'rubble_golem', count: 4, pattern: 'scatter_interior', duration: 6, modifiers: { hpMult: 1.15 } },
    { t: 0.34, type: 'event', event: 'collapsing_walls', duration: 8 },
    { t: 0.35, type: 'swarm', enemy: 'crawler_husk', count: 26, pattern: 'cluster', duration: 5 },
    { t: 0.38, type: 'spawn', enemy: 'sprinting_husk', count: 6, pattern: 'ambush', duration: 0 },
    { t: 0.40, type: 'spawn', enemy: 'husk_wanderer', count: 50, pattern: 'edge_random', duration: 14 },
    { t: 0.43, type: 'ring', enemy: 'crawler_husk', count: 24, pattern: 'ring', duration: 0 },
    { t: 0.45, type: 'spawn', enemy: 'rubble_golem', count: 6, pattern: 'edge_random', duration: 6, modifiers: { hpMult: 1.15 } },
    { t: 0.47, type: 'spawn', enemy: 'husk_wanderer', count: 54, pattern: 'edge_side', side: 'bottom', duration: 14 },
    { t: 0.50, type: 'midboss', enemy: 'the_armored', count: 1 },
    { t: 0.53, type: 'spawn', enemy: 'husk_wanderer', count: 50, pattern: 'edge_random', duration: 12 },
    // The stage is a tide of 26-to-40 speed walls. This is the same silhouette
    // family at 136, from one side, arriving four times sooner than the wall it
    // came in with — which is a far worse surprise than a new shape would be.
    { t: 0.54, type: 'spawn', enemy: 'splinter_husk', count: 26, pattern: 'edge_side', side: 'left', duration: 6 },
    { t: 0.56, type: 'spawn', enemy: 'sprinting_husk', count: 8, pattern: 'ambush', duration: 0 },
    { t: 0.58, type: 'spawn', enemy: 'crawler_husk', count: 30, pattern: 'scatter_interior', duration: 8 },
    { t: 0.60, type: 'spawn', enemy: 'rubble_golem', count: 8, pattern: 'edge_random', duration: 6, modifiers: { hpMult: 1.25 } },
    // Siege Husks are placed with scatter_interior, never at the edge: the whole
    // point of a 560px mortar is that it is already inside the space you were
    // going to retreat into. Titan's Shadow doubles them to 420 effective HP, so
    // three is a commitment.
    { t: 0.61, type: 'spawn', enemy: 'siege_husk', count: 3, pattern: 'scatter_interior', duration: 5 },
    { t: 0.62, type: 'event', event: 'collapsing_walls', duration: 10 },
    { t: 0.63, type: 'ring', enemy: 'husk_wanderer', count: 44, pattern: 'ring', duration: 0 },
    { t: 0.65, type: 'elite', enemy: 'abnormal', count: 2, pattern: 'cluster' },
    { t: 0.68, type: 'spawn', enemy: 'husk_wanderer', count: 60, pattern: 'edge_side', side: 'left', duration: 14 },
    { t: 0.69, type: 'swarm', enemy: 'splinter_husk', count: 34, pattern: 'cluster', duration: 3 },
    { t: 0.71, type: 'swarm', enemy: 'crawler_husk', count: 34, pattern: 'cluster', duration: 5 },
    { t: 0.73, type: 'spawn', enemy: 'sprinting_husk', count: 10, pattern: 'ambush', duration: 0 },
    { t: 0.74, type: 'spawn', enemy: 'siege_husk', count: 4, pattern: 'edge_random', duration: 5 },
    { t: 0.76, type: 'spawn', enemy: 'husk_wanderer', count: 70, pattern: 'edge_random', duration: 14 },
    // CLOSER. Two of them, fast, into the one stage built entirely out of slow.
    { t: 0.77, type: 'midboss', enemy: 'the_twin_fangs', count: 1 },
    { t: 0.78, type: 'spawn', enemy: 'rubble_golem', count: 10, pattern: 'scatter_interior', duration: 6, modifiers: { hpMult: 1.25 } },
    { t: 0.81, type: 'ring', enemy: 'crawler_husk', count: 36, pattern: 'ring', duration: 0 },
    { t: 0.82, type: 'spawn', enemy: 'splinter_husk', count: 44, pattern: 'edge_random', duration: 6 },
    { t: 0.83, type: 'spawn', enemy: 'sprinting_husk', count: 12, pattern: 'ambush', duration: 0 },
    { t: 0.85, type: 'spawn', enemy: 'husk_wanderer', count: 80, pattern: 'edge_side', side: 'right', duration: 14 },
    { t: 0.86, type: 'spawn', enemy: 'siege_husk', count: 6, pattern: 'scatter_interior', duration: 5 },
    { t: 0.87, type: 'elite', enemy: 'abnormal', count: 1, pattern: 'cluster', modifiers: { affix: 'colossal' } },
    { t: 0.89, type: 'swarm', enemy: 'crawler_husk', count: 40, pattern: 'cluster', duration: 5 },
    { t: 0.91, type: 'spawn', enemy: 'husk_wanderer', count: 90, pattern: 'edge_random', duration: 14 },
    { t: 0.92, type: 'swarm', enemy: 'splinter_husk', count: 54, pattern: 'cluster', duration: 3 },
    { t: 0.93, type: 'spawn', enemy: 'sprinting_husk', count: 16, pattern: 'ambush', duration: 0 },
    { t: 0.94, type: 'ring', enemy: 'husk_wanderer', count: 60, pattern: 'ring', duration: 0 },
    { t: 0.955, type: 'calm', duration: 5 },
    { t: 0.960, type: 'boss', enemy: 'the_colossus', count: 1 },
  ],

  // --------------------------------------------------------------------------
  // STAGE 4 — HIDDEN EMBER VILLAGE  (20 min, ★★★)
  // Character: nothing comes from where you are looking. `ambush` is the stage's
  // signature pattern (always 0.7s telegraphed) and it scales from 4 to 24.
  // Trap Scrolls are laid with scatter_interior at duration 0 so the floor fills
  // up with mines that punish standing still; Kunai Bats and Crow Familiars
  // punish standing anywhere predictable. Smoke events are placed just BEFORE
  // ambush waves on purpose.
  // --------------------------------------------------------------------------
  hidden_ember: [
    { t: 0.00, type: 'spawn', enemy: 'genin_shade', count: 12, pattern: 'edge_random', duration: 8 },
    { t: 0.04, type: 'spawn', enemy: 'genin_shade', count: 18, pattern: 'edge_side', side: 'top', duration: 10 },
    { t: 0.08, type: 'spawn', enemy: 'genin_shade', count: 22, pattern: 'edge_random', duration: 10 },
    { t: 0.10, type: 'event', event: 'smoke_bombs', duration: 8 },
    { t: 0.11, type: 'spawn', enemy: 'kunai_bat', count: 12, pattern: 'edge_random', duration: 8 },
    { t: 0.13, type: 'spawn', enemy: 'crow_familiar', count: 14, pattern: 'edge_random', duration: 6 },
    // First ambush is small and immediately after smoke, so the leaf swirl reads
    // as "the smoke means something".
    { t: 0.15, type: 'spawn', enemy: 'ambusher', count: 4, pattern: 'ambush', duration: 0 },
    { t: 0.18, type: 'ring', enemy: 'kunai_bat', count: 18, pattern: 'ring', duration: 0 },
    { t: 0.20, type: 'spawn', enemy: 'genin_shade', count: 24, pattern: 'edge_random', duration: 10 },
    { t: 0.22, type: 'spawn', enemy: 'trap_scroll', count: 8, pattern: 'scatter_interior', duration: 0 },
    { t: 0.25, type: 'elite', enemy: 'sealed_vessel', count: 1, pattern: 'cluster' },
    // OPENER. Armoured, slow, and completely unbothered by a stage whose entire
    // thesis is hitting things from behind.
    { t: 0.26, type: 'midboss', enemy: 'the_armored', count: 1 },
    { t: 0.27, type: 'spawn', enemy: 'ambusher', count: 6, pattern: 'ambush', duration: 0 },
    { t: 0.29, type: 'spawn', enemy: 'genin_shade', count: 28, pattern: 'edge_random', duration: 10 },
    { t: 0.31, type: 'spawn', enemy: 'crow_familiar', count: 20, pattern: 'edge_random', duration: 6 },
    { t: 0.33, type: 'event', event: 'smoke_bombs', duration: 10 },
    { t: 0.34, type: 'swarm', enemy: 'genin_shade', count: 30, pattern: 'cluster', duration: 4 },
    { t: 0.36, type: 'spawn', enemy: 'kunai_bat', count: 22, pattern: 'scatter_interior', duration: 8 },
    { t: 0.38, type: 'spawn', enemy: 'trap_scroll', count: 12, pattern: 'scatter_interior', duration: 0 },
    { t: 0.40, type: 'spawn', enemy: 'ambusher', count: 8, pattern: 'ambush', duration: 0 },
    { t: 0.43, type: 'ring', enemy: 'crow_familiar', count: 26, pattern: 'ring', duration: 0 },
    { t: 0.47, type: 'swarm', enemy: 'ambusher', count: 12, pattern: 'ambush', duration: 3 },
    { t: 0.50, type: 'midboss', enemy: 'the_twin_fangs', count: 1 },
    { t: 0.53, type: 'spawn', enemy: 'genin_shade', count: 36, pattern: 'edge_random', duration: 10 },
    // Censer Shades placed among the mines, on purpose: Trap Scrolls take the
    // floor away in circles you can count, and these take it away in a line that
    // keeps moving. The stage's answer to "just stand between the scrolls".
    { t: 0.54, type: 'spawn', enemy: 'censer_shade', count: 4, pattern: 'scatter_interior', duration: 4 },
    { t: 0.55, type: 'spawn', enemy: 'kunai_bat', count: 26, pattern: 'scatter_interior', duration: 8 },
    { t: 0.57, type: 'spawn', enemy: 'ambusher', count: 14, pattern: 'ambush', duration: 0 },
    { t: 0.58, type: 'spawn', enemy: 'roofline_runner', count: 4, pattern: 'edge_random', duration: 4 },
    { t: 0.59, type: 'spawn', enemy: 'trap_scroll', count: 16, pattern: 'scatter_interior', duration: 0 },
    { t: 0.61, type: 'event', event: 'smoke_bombs', duration: 12 },
    { t: 0.62, type: 'ring', enemy: 'genin_shade', count: 32, pattern: 'ring', duration: 0 },
    // Ember Sprites are a 1.6s fuse at 130 speed and they do NOT chain — a
    // cluster of them is a wall of small detonations you walk backwards out of,
    // which is the fast counterpart to a floor of static mines.
    { t: 0.63, type: 'swarm', enemy: 'ember_sprite', count: 18, pattern: 'cluster', duration: 3 },
    { t: 0.65, type: 'elite', enemy: 'sealed_vessel', count: 2, pattern: 'cluster' },
    { t: 0.68, type: 'swarm', enemy: 'crow_familiar', count: 34, pattern: 'cluster', duration: 4 },
    { t: 0.69, type: 'spawn', enemy: 'censer_shade', count: 6, pattern: 'scatter_interior', duration: 4 },
    { t: 0.70, type: 'spawn', enemy: 'ambusher', count: 16, pattern: 'ambush', duration: 0 },
    { t: 0.73, type: 'spawn', enemy: 'genin_shade', count: 44, pattern: 'edge_random', duration: 10 },
    { t: 0.74, type: 'spawn', enemy: 'roofline_runner', count: 6, pattern: 'edge_random', duration: 4 },
    { t: 0.75, type: 'spawn', enemy: 'kunai_bat', count: 32, pattern: 'scatter_interior', duration: 8 },
    { t: 0.77, type: 'spawn', enemy: 'trap_scroll', count: 20, pattern: 'scatter_interior', duration: 0 },
    // CLOSER. A drum you can hear four minutes before you see it, arriving onto a
    // floor that is by now mostly mines.
    { t: 0.78, type: 'midboss', enemy: 'the_drum_oni', count: 1 },
    { t: 0.79, type: 'spawn', enemy: 'ambusher', count: 18, pattern: 'ambush', duration: 0 },
    // Straight after the closer, and straight before the smoke: the one window
    // where the floor is on fire and you cannot see 300px of it.
    { t: 0.80, type: 'swarm', enemy: 'ember_sprite', count: 26, pattern: 'cluster', duration: 3 },
    { t: 0.81, type: 'ring', enemy: 'genin_shade', count: 40, pattern: 'ring', duration: 0 },
    { t: 0.83, type: 'event', event: 'smoke_bombs', duration: 14 },
    { t: 0.84, type: 'swarm', enemy: 'crow_familiar', count: 40, pattern: 'cluster', duration: 4 },
    { t: 0.85, type: 'spawn', enemy: 'censer_shade', count: 8, pattern: 'scatter_interior', duration: 4 },
    { t: 0.86, type: 'spawn', enemy: 'genin_shade', count: 52, pattern: 'edge_random', duration: 10 },
    { t: 0.87, type: 'spawn', enemy: 'roofline_runner', count: 8, pattern: 'edge_random', duration: 4 },
    // Vampiric on a Sealed Vessel is nasty: it heals off the buffed screen it made.
    { t: 0.88, type: 'elite', enemy: 'sealed_vessel', count: 1, pattern: 'cluster', modifiers: { affix: 'vampiric' } },
    { t: 0.90, type: 'spawn', enemy: 'ambusher', count: 24, pattern: 'ambush', duration: 0 },
    { t: 0.92, type: 'spawn', enemy: 'kunai_bat', count: 40, pattern: 'scatter_interior', duration: 8 },
    { t: 0.93, type: 'swarm', enemy: 'ember_sprite', count: 34, pattern: 'cluster', duration: 3 },
    { t: 0.94, type: 'ring', enemy: 'genin_shade', count: 48, pattern: 'ring', duration: 0 },
    { t: 0.955, type: 'calm', duration: 5 },
    { t: 0.960, type: 'boss', enemy: 'the_sealed_beast', count: 1 },
  ],

  // --------------------------------------------------------------------------
  // STAGE 5 — THE ENDLESS TATAMI HALLS  (22 min, ★★★★)
  // Character: the skill check. Rings and tight clusters instead of soft edge
  // washes — every wave has a correct place to stand and a wrong one. Paper
  // Lantern Wisps (summoners) force target priority; "Demon Moon" regen means
  // anything you leave alive comes back, so the timeline never gives a clean
  // reset. Shifting-room cues sit on the 45s hazard cycle.
  // Judgement call: `oni_bruiser` has no stage table anywhere in SECTION 7, so
  // it debuts here in the covered phase — it is the only oni-themed stage, and
  // a tier-3 tank is exactly the pressure this phase wants. It stays distinct
  // from `lesser_oni` (DECISIONS.md §5).
  // The literal spawn counts here read LOW against the 250–400 covered-phase
  // target on purpose: Blood Doll splits 1 → 3 → 2 each, so the 44 dolls after
  // t=0.85 become ~260 bodies on their own, and every Paper Lantern Wisp adds 4
  // chibi ghosts every 4s. Do not "fix" these numbers upward without re-running
  // the entity-cap check (DECISIONS.md §25, cap 2,500).
  // --------------------------------------------------------------------------
  tatami_halls: [
    { t: 0.00, type: 'spawn', enemy: 'lesser_oni', count: 12, pattern: 'edge_random', duration: 8 },
    { t: 0.05, type: 'spawn', enemy: 'lesser_oni', count: 18, pattern: 'edge_random', duration: 10 },
    // The stage states its thesis in the first minute: a ring, early, cleanly.
    { t: 0.08, type: 'ring', enemy: 'lesser_oni', count: 18, pattern: 'ring', duration: 0 },
    { t: 0.10, type: 'spawn', enemy: 'ceiling_crawler', count: 5, pattern: 'ambush', duration: 0 },
    { t: 0.13, type: 'spawn', enemy: 'lesser_oni', count: 22, pattern: 'edge_random', duration: 10 },
    { t: 0.15, type: 'event', event: 'shifting_rooms', duration: 6 },
    { t: 0.16, type: 'spawn', enemy: 'blood_doll', count: 6, pattern: 'cluster', duration: 4 },
    { t: 0.18, type: 'ring', enemy: 'lesser_oni', count: 24, pattern: 'ring', duration: 0 },
    { t: 0.21, type: 'spawn', enemy: 'ceiling_crawler', count: 8, pattern: 'ambush', duration: 0 },
    { t: 0.23, type: 'swarm', enemy: 'lesser_oni', count: 28, pattern: 'cluster', duration: 4 },
    { t: 0.25, type: 'elite', enemy: 'upper_rank_remnant', count: 1, pattern: 'cluster' },
    // OPENER. Two blades that will not stay on the same side of you, in corridors
    // that will not stay where they were.
    { t: 0.26, type: 'midboss', enemy: 'the_twin_fangs', count: 1 },
    { t: 0.27, type: 'spawn', enemy: 'paper_lantern_wisp', count: 3, pattern: 'scatter_interior', duration: 4 },
    { t: 0.29, type: 'spawn', enemy: 'blood_doll', count: 8, pattern: 'cluster', duration: 4 },
    { t: 0.32, type: 'ring', enemy: 'ceiling_crawler', count: 12, pattern: 'ring', duration: 0 },
    { t: 0.34, type: 'event', event: 'shifting_rooms', duration: 6 },
    { t: 0.35, type: 'spawn', enemy: 'ronin_shade', count: 4, pattern: 'edge_side', side: 'left', duration: 4 },
    { t: 0.38, type: 'swarm', enemy: 'lesser_oni', count: 34, pattern: 'cluster', duration: 4 },
    { t: 0.40, type: 'spawn', enemy: 'paper_lantern_wisp', count: 4, pattern: 'scatter_interior', duration: 4 },
    { t: 0.42, type: 'ring', enemy: 'blood_doll', count: 12, pattern: 'ring', duration: 0 },
    { t: 0.44, type: 'spawn', enemy: 'ceiling_crawler', count: 14, pattern: 'ambush', duration: 0 },
    { t: 0.48, type: 'spawn', enemy: 'ronin_shade', count: 6, pattern: 'edge_side', side: 'right', duration: 4 },
    { t: 0.50, type: 'midboss', enemy: 'the_drum_oni', count: 1 },
    { t: 0.53, type: 'ring', enemy: 'lesser_oni', count: 36, pattern: 'ring', duration: 0 },
    { t: 0.55, type: 'spawn', enemy: 'paper_lantern_wisp', count: 5, pattern: 'scatter_interior', duration: 4 },
    // Wisps, then a Chanter. The stage's target-priority problem now has two
    // correct answers at once and no time to do both: the wisps are making
    // bodies and the chanter is making them fast.
    { t: 0.56, type: 'spawn', enemy: 'sutra_chanter', count: 2, pattern: 'scatter_interior', duration: 3 },
    { t: 0.57, type: 'spawn', enemy: 'blood_doll', count: 14, pattern: 'cluster', duration: 4 },
    { t: 0.59, type: 'spawn', enemy: 'ceiling_crawler', count: 16, pattern: 'ambush', duration: 0 },
    { t: 0.61, type: 'event', event: 'shifting_rooms', duration: 8 },
    // Mask Bearers arrive by CLUSTER, never scattered: a warded mob alone in
    // open floor is a warded mob with nothing warding it, which teaches the
    // mechanic backwards. They come in with their own escort.
    { t: 0.62, type: 'spawn', enemy: 'mask_bearer', count: 4, pattern: 'cluster', duration: 4 },
    { t: 0.63, type: 'spawn', enemy: 'ronin_shade', count: 8, pattern: 'edge_random', duration: 4 },
    { t: 0.65, type: 'elite', enemy: 'upper_rank_remnant', count: 2, pattern: 'cluster' },
    { t: 0.68, type: 'swarm', enemy: 'lesser_oni', count: 44, pattern: 'cluster', duration: 4 },
    // Braziers into a stage whose corridors move every 45 seconds. The floor you
    // were routing around is about to be somewhere else, and still on fire.
    { t: 0.69, type: 'spawn', enemy: 'brazier_oni', count: 2, pattern: 'edge_random', duration: 4 },
    { t: 0.70, type: 'ring', enemy: 'blood_doll', count: 16, pattern: 'ring', duration: 0 },
    { t: 0.72, type: 'spawn', enemy: 'paper_lantern_wisp', count: 6, pattern: 'scatter_interior', duration: 4 },
    { t: 0.73, type: 'spawn', enemy: 'sutra_chanter', count: 3, pattern: 'scatter_interior', duration: 3 },
    { t: 0.75, type: 'spawn', enemy: 'oni_bruiser', count: 4, pattern: 'edge_random', duration: 5 },
    { t: 0.76, type: 'spawn', enemy: 'mask_bearer', count: 6, pattern: 'cluster', duration: 4 },
    { t: 0.77, type: 'spawn', enemy: 'ceiling_crawler', count: 20, pattern: 'ambush', duration: 0 },
    // CLOSER. A shelled thing that does not care which way the rooms are facing.
    { t: 0.78, type: 'midboss', enemy: 'tide_warden', count: 1 },
    { t: 0.79, type: 'ring', enemy: 'lesser_oni', count: 50, pattern: 'ring', duration: 0 },
    { t: 0.81, type: 'spawn', enemy: 'ronin_shade', count: 10, pattern: 'edge_side', side: 'top', duration: 4 },
    { t: 0.83, type: 'event', event: 'shifting_rooms', duration: 8 },
    { t: 0.84, type: 'spawn', enemy: 'brazier_oni', count: 3, pattern: 'edge_random', duration: 4 },
    { t: 0.85, type: 'swarm', enemy: 'blood_doll', count: 20, pattern: 'cluster', duration: 4 },
    { t: 0.86, type: 'spawn', enemy: 'mask_bearer', count: 8, pattern: 'cluster', duration: 4 },
    { t: 0.87, type: 'spawn', enemy: 'oni_bruiser', count: 6, pattern: 'edge_random', duration: 5 },
    // Warded + a teleporting elite = you must actually chase it down and flank.
    { t: 0.89, type: 'elite', enemy: 'upper_rank_remnant', count: 1, pattern: 'cluster', modifiers: { affix: 'warded' } },
    { t: 0.90, type: 'spawn', enemy: 'sutra_chanter', count: 4, pattern: 'scatter_interior', duration: 3 },
    { t: 0.91, type: 'spawn', enemy: 'lesser_oni', count: 60, pattern: 'edge_random', duration: 10 },
    { t: 0.92, type: 'spawn', enemy: 'brazier_oni', count: 4, pattern: 'edge_random', duration: 4 },
    { t: 0.93, type: 'ring', enemy: 'ceiling_crawler', count: 26, pattern: 'ring', duration: 0 },
    { t: 0.94, type: 'swarm', enemy: 'blood_doll', count: 24, pattern: 'cluster', duration: 3 },
    { t: 0.955, type: 'calm', duration: 5 },
    { t: 0.960, type: 'boss', enemy: 'kagutsuchi', count: 1 },
  ],

  // --------------------------------------------------------------------------
  // STAGE 6 — SUNKEN IDOL REEF  (20 min, ★★★★)
  // Character: pacing is tide-locked. The RISING TIDE hazard cycles every 60s,
  // and 60s of a 1200s stage is exactly 0.05 of normalised time — so every
  // multiple of 0.05 is a tide crest and every crest gets the heavy wave. High
  // tide slows everything and doubles knockback, which is when a wall of
  // Jellyfish Chorus exploders or a ring of Anglerfish Fans is survivable; the
  // troughs in between carry the fast Eel Swarm leeches. Coral Crabs (flankable
  // per DECISIONS.md §31) arrive from one side so flanking has an answer.
  // --------------------------------------------------------------------------
  sunken_reef: [
    { t: 0.00, type: 'spawn', enemy: 'anglerfish_fan', count: 14, pattern: 'edge_random', duration: 8 },
    { t: 0.05, type: 'spawn', enemy: 'anglerfish_fan', count: 20, pattern: 'edge_random', duration: 10 },
    { t: 0.08, type: 'spawn', enemy: 'drowned_roadie', count: 10, pattern: 'edge_random', duration: 8 },
    { t: 0.10, type: 'event', event: 'rising_tide', duration: 8 },
    { t: 0.11, type: 'spawn', enemy: 'jellyfish_chorus', count: 8, pattern: 'scatter_interior', duration: 6 },
    { t: 0.13, type: 'spawn', enemy: 'anglerfish_fan', count: 24, pattern: 'edge_random', duration: 8 },
    { t: 0.15, type: 'swarm', enemy: 'eel_swarm', count: 18, pattern: 'cluster', duration: 4 },
    { t: 0.18, type: 'ring', enemy: 'jellyfish_chorus', count: 14, pattern: 'ring', duration: 0 },
    { t: 0.20, type: 'spawn', enemy: 'coral_crab', count: 6, pattern: 'edge_side', side: 'left', duration: 6 },
    { t: 0.23, type: 'spawn', enemy: 'drowned_roadie', count: 16, pattern: 'edge_random', duration: 8 },
    { t: 0.25, type: 'elite', enemy: 'elite_encore_siren', count: 1, pattern: 'cluster' },
    // OPENER. A drum, underwater, on the beat the tide is already keeping.
    { t: 0.26, type: 'midboss', enemy: 'the_drum_oni', count: 1 },
    { t: 0.27, type: 'spawn', enemy: 'anglerfish_fan', count: 30, pattern: 'edge_random', duration: 8 },
    { t: 0.29, type: 'swarm', enemy: 'eel_swarm', count: 22, pattern: 'cluster', duration: 4 },
    { t: 0.30, type: 'event', event: 'rising_tide', duration: 10 },
    { t: 0.32, type: 'spawn', enemy: 'jellyfish_chorus', count: 16, pattern: 'scatter_interior', duration: 6 },
    { t: 0.35, type: 'spawn', enemy: 'coral_crab', count: 8, pattern: 'edge_side', side: 'right', duration: 6 },
    { t: 0.37, type: 'spawn', enemy: 'encore_siren', count: 2, pattern: 'scatter_interior', duration: 4 },
    { t: 0.40, type: 'ring', enemy: 'anglerfish_fan', count: 30, pattern: 'ring', duration: 0 },
    { t: 0.43, type: 'swarm', enemy: 'eel_swarm', count: 26, pattern: 'cluster', duration: 4 },
    { t: 0.45, type: 'spawn', enemy: 'jellyfish_chorus', count: 20, pattern: 'cluster', duration: 5 },
    { t: 0.47, type: 'spawn', enemy: 'drowned_roadie', count: 22, pattern: 'edge_random', duration: 8 },
    { t: 0.50, type: 'midboss', enemy: 'tide_warden', count: 1 },
    { t: 0.53, type: 'spawn', enemy: 'anglerfish_fan', count: 36, pattern: 'edge_random', duration: 8 },
    // Urchins go down on the seabed and stay there. Everything else on this
    // stage is tide-locked and mobile; this is the first thing that makes a
    // patch of reef permanently expensive.
    { t: 0.54, type: 'spawn', enemy: 'spine_urchin', count: 4, pattern: 'scatter_interior', duration: 4 },
    { t: 0.55, type: 'spawn', enemy: 'jellyfish_chorus', count: 24, pattern: 'scatter_interior', duration: 6 },
    { t: 0.57, type: 'spawn', enemy: 'encore_siren', count: 3, pattern: 'scatter_interior', duration: 4 },
    // Deliberately in a TROUGH, not on a crest: at 142 base speed the bait ball
    // is the one wave here that is worse when everything is moving normally.
    { t: 0.58, type: 'swarm', enemy: 'bait_ball', count: 30, pattern: 'cluster', duration: 3 },
    { t: 0.59, type: 'swarm', enemy: 'eel_swarm', count: 30, pattern: 'cluster', duration: 4 },
    { t: 0.60, type: 'event', event: 'rising_tide', duration: 12 },
    { t: 0.62, type: 'spawn', enemy: 'coral_crab', count: 12, pattern: 'edge_side', side: 'bottom', duration: 6 },
    { t: 0.63, type: 'spawn', enemy: 'deep_watcher', count: 3, pattern: 'scatter_interior', duration: 4 },
    { t: 0.65, type: 'elite', enemy: 'elite_encore_siren', count: 2, pattern: 'cluster' },
    { t: 0.68, type: 'spawn', enemy: 'drowned_roadie', count: 30, pattern: 'edge_random', duration: 8 },
    // Bulwarks come in from the edge with the roadies, so the escort holding
    // their ward up is the wave they arrived with rather than a coincidence.
    { t: 0.69, type: 'spawn', enemy: 'reef_bulwark', count: 2, pattern: 'edge_random', duration: 4 },
    { t: 0.70, type: 'ring', enemy: 'jellyfish_chorus', count: 26, pattern: 'ring', duration: 0 },
    { t: 0.72, type: 'spawn', enemy: 'anglerfish_fan', count: 44, pattern: 'edge_random', duration: 8 },
    { t: 0.73, type: 'swarm', enemy: 'bait_ball', count: 40, pattern: 'cluster', duration: 3 },
    { t: 0.75, type: 'swarm', enemy: 'eel_swarm', count: 36, pattern: 'cluster', duration: 4 },
    { t: 0.76, type: 'spawn', enemy: 'spine_urchin', count: 6, pattern: 'scatter_interior', duration: 4 },
    { t: 0.77, type: 'spawn', enemy: 'coral_crab', count: 14, pattern: 'edge_random', duration: 6 },
    // CLOSER. The support act, sixteen minutes in, on a stage that sank with the
    // lights still on. The hardest thing on the ladder outside the Zenith Stage.
    { t: 0.78, type: 'midboss', enemy: 'the_opening_act', count: 1 },
    { t: 0.80, type: 'spawn', enemy: 'jellyfish_chorus', count: 30, pattern: 'scatter_interior', duration: 6 },
    { t: 0.81, type: 'spawn', enemy: 'deep_watcher', count: 5, pattern: 'scatter_interior', duration: 4 },
    { t: 0.82, type: 'spawn', enemy: 'encore_siren', count: 4, pattern: 'scatter_interior', duration: 4 },
    { t: 0.84, type: 'spawn', enemy: 'drowned_roadie', count: 38, pattern: 'edge_random', duration: 8 },
    { t: 0.85, type: 'ring', enemy: 'anglerfish_fan', count: 48, pattern: 'ring', duration: 0 },
    { t: 0.86, type: 'spawn', enemy: 'reef_bulwark', count: 3, pattern: 'edge_random', duration: 4 },
    { t: 0.87, type: 'elite', enemy: 'elite_encore_siren', count: 1, pattern: 'cluster', modifiers: { affix: 'vampiric' } },
    { t: 0.88, type: 'swarm', enemy: 'eel_swarm', count: 44, pattern: 'cluster', duration: 3 },
    { t: 0.89, type: 'swarm', enemy: 'bait_ball', count: 52, pattern: 'cluster', duration: 2 },
    { t: 0.90, type: 'spawn', enemy: 'jellyfish_chorus', count: 36, pattern: 'cluster', duration: 5 },
    { t: 0.92, type: 'spawn', enemy: 'anglerfish_fan', count: 56, pattern: 'edge_random', duration: 8 },
    { t: 0.93, type: 'spawn', enemy: 'spine_urchin', count: 8, pattern: 'scatter_interior', duration: 4 },
    { t: 0.94, type: 'ring', enemy: 'jellyfish_chorus', count: 30, pattern: 'ring', duration: 0 },
    { t: 0.955, type: 'calm', duration: 5 },
    { t: 0.960, type: 'boss', enemy: 'the_kraken_producer', count: 1 },
  ],

  // --------------------------------------------------------------------------
  // STAGE 7 — THE ZENITH STAGE  (25 min, ★★★★★)
  // Character: an escalating recap. The mob mix walks the whole game in order —
  // academy, Akiba, the wall, the village, the halls, the reef — and then all of
  // it at once from 0.85.
  // "Grand Finale" (SECTION 7): a previous stage's BOSS spawns as an elite every
  // 5 minutes. 5 min of 25 = 0.20, so the four explicit recap elites sit at
  // t = 0.20 / 0.40 / 0.60 / 0.80 and the mid-boss covers 0.50.
  // Judgement call: six bosses, four slots. Chosen for what actually works as a
  // roaming elite — `the_kraken_producer` is eight independent tentacle bars and
  // `student_council_president` is the tutorial boss, so both are left to their
  // own stages. THE UNDERSTUDY (DECISIONS.md §7) fills the 0.25 first-elite beat
  // and the 0.65 double-elite beat.
  // --------------------------------------------------------------------------
  zenith_stage: [
    { t: 0.00, type: 'spawn', enemy: 'mob_student', count: 20, pattern: 'edge_random', duration: 8 },
    { t: 0.05, type: 'spawn', enemy: 'mob_student', count: 26, pattern: 'edge_random', duration: 10 },
    { t: 0.07, type: 'spawn', enemy: 'gacha_zombie', count: 28, pattern: 'edge_random', duration: 10 },
    { t: 0.09, type: 'event', event: 'spotlights', duration: 10 },
    { t: 0.13, type: 'spawn', enemy: 'neon_otaku', count: 26, pattern: 'edge_random', duration: 8 },
    { t: 0.15, type: 'spawn', enemy: 'camera_drone', count: 10, pattern: 'scatter_interior', duration: 5 },
    // MINI-BOSS 1 of 3. The finale is the one stage that owns the top of the
    // ladder, so all three fights climb into the halfway anchor instead of
    // straddling it — the back half is already carrying a recap boss every five
    // minutes from the Grand Finale modifier.
    { t: 0.16, type: 'midboss', enemy: 'the_drum_oni', count: 1 },
    { t: 0.18, type: 'ring', enemy: 'chibi_ghost', count: 32, pattern: 'ring', duration: 0 },
    // Grand Finale recap #1.
    { t: 0.20, type: 'elite', enemy: 'the_algorithm', count: 1, pattern: 'cluster' },
    { t: 0.22, type: 'spawn', enemy: 'husk_wanderer', count: 36, pattern: 'edge_side', side: 'left', duration: 12 },
    { t: 0.24, type: 'spawn', enemy: 'crawler_husk', count: 20, pattern: 'scatter_interior', duration: 8 },
    { t: 0.25, type: 'elite', enemy: 'the_understudy', count: 1, pattern: 'cluster' },
    { t: 0.28, type: 'swarm', enemy: 'antifan_swarm', count: 35, pattern: 'cluster', duration: 3 },
    { t: 0.32, type: 'spawn', enemy: 'rubble_golem', count: 6, pattern: 'edge_random', duration: 6 },
    { t: 0.35, type: 'ring', enemy: 'husk_wanderer', count: 40, pattern: 'ring', duration: 0 },
    // MINI-BOSS 2 of 3.
    { t: 0.36, type: 'midboss', enemy: 'tide_warden', count: 1 },
    { t: 0.37, type: 'event', event: 'spotlights', duration: 12 },
    // Grand Finale recap #2.
    { t: 0.40, type: 'elite', enemy: 'the_colossus', count: 1, pattern: 'cluster' },
    { t: 0.42, type: 'spawn', enemy: 'genin_shade', count: 28, pattern: 'edge_random', duration: 8 },
    { t: 0.44, type: 'spawn', enemy: 'kunai_bat', count: 22, pattern: 'scatter_interior', duration: 8 },
    { t: 0.46, type: 'swarm', enemy: 'ambusher', count: 12, pattern: 'ambush', duration: 3 },
    // MINI-BOSS 3 of 3 — and the SIGNATURE, on the halfway anchor.
    { t: 0.50, type: 'midboss', enemy: 'the_opening_act', count: 1 },
    { t: 0.55, type: 'spawn', enemy: 'lesser_oni', count: 32, pattern: 'edge_random', duration: 8 },
    // THE SECOND RECAP, and the one this pass added: the finale walks the six
    // new archetypes past the player in stage order, exactly the way the block
    // above walks the six stages' fodder past them. By 0.81 all six are on
    // screen together — mortars covering the floor the sowers are burning, a
    // conductor in the middle of it, a watcher on every corner you might retreat
    // to, warded mobs you cannot kill first and strafers already lined up.
    { t: 0.56, type: 'spawn', enemy: 'hall_monitor', count: 6, pattern: 'scatter_interior', duration: 4 },
    { t: 0.57, type: 'spawn', enemy: 'ceiling_crawler', count: 14, pattern: 'ambush', duration: 0 },
    { t: 0.58, type: 'spawn', enemy: 'courier_scooter', count: 6, pattern: 'edge_random', duration: 4 },
    { t: 0.59, type: 'ring', enemy: 'blood_doll', count: 16, pattern: 'ring', duration: 0 },
    // Grand Finale recap #3.
    { t: 0.60, type: 'elite', enemy: 'the_sealed_beast', count: 1, pattern: 'cluster' },
    { t: 0.61, type: 'spawn', enemy: 'siege_husk', count: 4, pattern: 'scatter_interior', duration: 5 },
    { t: 0.63, type: 'spawn', enemy: 'paper_lantern_wisp', count: 5, pattern: 'scatter_interior', duration: 4 },
    { t: 0.64, type: 'spawn', enemy: 'censer_shade', count: 6, pattern: 'scatter_interior', duration: 4 },
    { t: 0.65, type: 'elite', enemy: 'the_understudy', count: 2, pattern: 'cluster' },
    { t: 0.66, type: 'spawn', enemy: 'hype_marshal', count: 3, pattern: 'scatter_interior', duration: 3 },
    { t: 0.68, type: 'spawn', enemy: 'ronin_shade', count: 8, pattern: 'edge_side', side: 'right', duration: 4 },
    { t: 0.69, type: 'spawn', enemy: 'mask_bearer', count: 6, pattern: 'cluster', duration: 4 },
    { t: 0.70, type: 'spawn', enemy: 'oni_bruiser', count: 6, pattern: 'edge_random', duration: 5 },
    { t: 0.71, type: 'spawn', enemy: 'roofline_runner', count: 8, pattern: 'edge_random', duration: 4 },
    { t: 0.72, type: 'spawn', enemy: 'jellyfish_chorus', count: 24, pattern: 'scatter_interior', duration: 6 },
    { t: 0.73, type: 'spawn', enemy: 'spine_urchin', count: 6, pattern: 'scatter_interior', duration: 4 },
    { t: 0.74, type: 'swarm', enemy: 'eel_swarm', count: 34, pattern: 'cluster', duration: 4 },
    { t: 0.75, type: 'spawn', enemy: 'brazier_oni', count: 3, pattern: 'edge_random', duration: 4 },
    { t: 0.76, type: 'spawn', enemy: 'coral_crab', count: 12, pattern: 'edge_side', side: 'bottom', duration: 6 },
    { t: 0.77, type: 'spawn', enemy: 'sutra_chanter', count: 3, pattern: 'scatter_interior', duration: 3 },
    { t: 0.78, type: 'spawn', enemy: 'anglerfish_fan', count: 44, pattern: 'edge_random', duration: 8 },
    { t: 0.79, type: 'spawn', enemy: 'deep_watcher', count: 5, pattern: 'scatter_interior', duration: 4 },
    // Grand Finale recap #4.
    { t: 0.80, type: 'elite', enemy: 'kagutsuchi', count: 1, pattern: 'cluster' },
    { t: 0.81, type: 'spawn', enemy: 'reef_bulwark', count: 3, pattern: 'edge_random', duration: 4 },
    { t: 0.82, type: 'spawn', enemy: 'encore_siren', count: 4, pattern: 'scatter_interior', duration: 4 },
    { t: 0.83, type: 'event', event: 'spotlights', duration: 14 },
    { t: 0.84, type: 'spawn', enemy: 'drowned_roadie', count: 40, pattern: 'edge_random', duration: 8 },
    // From here every stage in the game is on screen at the same time.
    // ...and then the four small fast ones, one from each stage that owns one,
    // over the last four minutes. Nothing here is worth XP. All of it arrives
    // before you have finished looking at the thing that is.
    { t: 0.85, type: 'swarm', enemy: 'eraser_gremlin', count: 40, pattern: 'cluster', duration: 3 },
    { t: 0.86, type: 'swarm', enemy: 'antifan_swarm', count: 60, pattern: 'cluster', duration: 3 },
    { t: 0.87, type: 'ring', enemy: 'mob_student', count: 60, pattern: 'ring', duration: 0 },
    { t: 0.88, type: 'spawn', enemy: 'sprinting_husk', count: 20, pattern: 'ambush', duration: 0 },
    { t: 0.89, type: 'swarm', enemy: 'bait_ball', count: 50, pattern: 'cluster', duration: 3 },
    { t: 0.90, type: 'spawn', enemy: 'gacha_zombie', count: 70, pattern: 'chase_line', duration: 12 },
    { t: 0.91, type: 'swarm', enemy: 'splinter_husk', count: 50, pattern: 'cluster', duration: 3 },
    { t: 0.92, type: 'ring', enemy: 'lesser_oni', count: 60, pattern: 'ring', duration: 0 },
    { t: 0.925, type: 'swarm', enemy: 'ember_sprite', count: 30, pattern: 'cluster', duration: 3 },
    { t: 0.93, type: 'swarm', enemy: 'blood_doll', count: 26, pattern: 'cluster', duration: 3 },
    { t: 0.94, type: 'spawn', enemy: 'husk_wanderer', count: 90, pattern: 'edge_random', duration: 12 },
    { t: 0.955, type: 'calm', duration: 5 },
    { t: 0.960, type: 'boss', enemy: 'the_final_form', count: 1 },
  ],

};

export const SPAWN_PATTERNS = ['edge_random', 'edge_side', 'ring', 'cluster',
                               'chase_line', 'ambush', 'scatter_interior'];

export const WAVE_TYPES = ['spawn', 'swarm', 'ring', 'elite', 'midboss', 'boss',
                           'event', 'calm'];
