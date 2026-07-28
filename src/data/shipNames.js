// =============================================================================
// src/data/shipNames.js — SHIP-SAFE RENAMES. DECISIONS.md §22.3.
// =============================================================================
//
// WHY THIS IS ITS OWN FILE, AND NOT PART OF refs.js.
//
// §22.1 rules that every `ref` / `refSource` / `refNotes` string lives in
// `src/data/refs.js` and that **a ship build deletes that one file**. §22.3
// rules that every ability and relic carries a `shipName` which `DEV_MODE=false`
// displays instead of the source-IP name.
//
// Those two rulings fight each other the moment the rename table lives inside
// the deleted file: delete refs.js and every ability falls back to `name`, which
// is exactly the string §22 exists to keep off the screen — AMATERASU,
// FATHER-SON KAMEHAMEHA, SHINIGAMI EYES, Niten Ichi-ryu. The mitigation would
// evaporate at precisely the moment it is needed.
//
// So: a ref is an attribution and is deleted at ship time. A shipName is a
// DISPLAY name and must survive. Different lifetimes, different files. This one
// is never deleted, and `src/data/index.js` imports it statically (refs.js stays
// behind a try/catch because its absence is expected).
//
// Relics additionally carry `shipName` inline on the relic object in relics.js —
// that is the field §22.3 names, and the values there and here must agree.
// tests/refs.test.js asserts it. Abilities are nested inside a character object
// and are joined from this table at boot instead, so characters.js stays a flat
// content file.
//
// SCOPE. Abilities and relics only: character, stage, enemy and boss GAME names
// were authored safe from the start (spec line 333, "shipping name — always safe
// to display"), so they need no entry.
//
// INCLUSION TEST. The name is a proper noun or a coined technique title lifted
// from the source. Generic English (Feeding Frenzy, Broadside, Barrel Roll,
// Rebirth Nova) stays. Real-world public-domain vocabulary (ofuda, torii, kunai,
// genin, Inari, Kagutsuchi) stays. Historical fact (Ichijoji, Dokkodo) would
// also qualify to stay, but §22.3 explicitly names Niten Ichi-ryu for renaming,
// so Niten's three history-derived names are treated consistently.
//
// This file contains no attributions — a name on the left, a name on the right,
// and neither says what it came from. That is what makes it safe to keep.
// =============================================================================

export const SHIP_NAMES = {
  // Mochi
  puu: 'Spit Take',
  secret_technique_108: 'Hidden Trick No. 108',
  secret_technique_109: 'The 109th Hidden Trick',

  // Alto
  vertical_arc: 'Rising Cross',
  starburst_stream: 'Blade Cascade',
  switch: 'Swap!',
  beater: 'Grinder',
  dual_blades: 'Rare Skill: Twin Blades',

  // Hoshino Rei
  hoshiyomi: 'Star Gazers',
  hoshiyomi_penlight: 'Star Gazer Penlight',

  // Yamikage
  amaterasu: 'Blackflame',
  body_flicker: 'Flashstep',
  sharingan: 'Foresight Eye',
  susanoo_fragment: 'Guardian Ribcage',
  // Not an ability id — the named VFX on Body Flicker's afterimage. Pre-authored
  // in DECISIONS.md §22.3, so it is carried verbatim and keyed by its own term.
  chidori: 'Thousand Birds',

  // Uzu
  kage_bunshin_barrage: 'Clone Barrage',
  shadow_clone_jutsu: 'Clone Legion',
  substitution_jutsu: 'Log Swap',
  nine_tails_chakra: 'Ninefold Cloak',
  // Not an ability id — the S3 upgrade's named slam. Pre-authored in §22.3.
  rasengan: 'Spiral Sphere',

  // Captain Yuli
  thunder_spear: 'Lightning Lance',

  // Unit-09
  super_ai_mode: 'Overclock Mode',

  // Rin
  water_surface_slash: 'First Form: Tidecut',
  hinokami_kagura: 'Sunfire Dance',
  water_wheel: 'Second Form: Wheel of Tides',
  total_concentration: 'Full Focus Breathing',
  nichirin_blade_crimson: 'Sunsteel Edge (Crimson)',

  // Niten
  niten_ichiryu: 'Two Skies Style',
  battle_of_ichijoji: 'The Hundred-Blade Stand',
  dokkodo: 'The Way of Walking Alone',
  two_heavens_as_one: 'Two Skies As One',

  // Reika
  iron_sand_storm: 'Ferrite Storm',
  level_5_clearance: 'Rank Five Clearance',

  // Nekromina
  summon_deadbeats: 'Summon: The Backbeat Choir',

  // Kira
  shinigami_eyes: "Reaper's Sight",
  just_as_planned: 'Not A Suspect',

  // Sora
  spirit_bomb: 'Gathered Light',
  ultra_instinct: 'Silver Reflex',
  zenkai: 'Comeback Instinct',
  kaioken: 'Crimson Multiplier',

  // Mirel — the only two names on the five new characters that are lifted from
  // a source rather than invented. Both are the source's own TECHNIQUE terms
  // ("ordinary offensive magic", "mana suppression"), never a person's name, so
  // they qualify under the inclusion test above exactly the way Niten Ichi-ryu
  // does. The other eighteen new ability names are original English and stay.
  ordinary_offensive_magic: 'Common Attack Magic',
  mana_suppression: 'Presence Dampening',

  // Han
  masenko: 'Brow Blast',
  father_son_kamehameha: 'Father-Son Beam',
  great_saiyaman_pose: 'The Justice Pose',
  hidden_potential: 'Latent Power',
  the_cell_games: 'The Last Tournament',
};

/** Total lookup: an id with no rename keeps its authored name. */
export function shipNameOf(id) {
  return SHIP_NAMES[id];
}
