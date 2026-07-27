// SPRITE DESCRIPTORS — the art layer.
//
// This is the file an artist replaces. Each entry names a body plan and a
// handful of features; `render/pixelArt.js` assembles the actual pixels. Swapping
// any entry for `{ sheet: 'art/rin.png', frames: 4 }` later changes nothing else.
//
// The 19 characters are hand-authored because they are what the player looks at
// for twenty minutes. Enemies derive from behaviour + tier + element, with
// overrides only where a mob has a specific silhouette worth protecting.
//
// Palettes come from each character's own `refNotes` in refs.js — the whole
// point of that field is that it tells you what to draw.

/** id -> descriptor. Body plans: humanoid | blob | ghost | beast | mech | titan */
export const CHARACTER_SPRITES = {
  // ★3 ----------------------------------------------------------------------
  mochi: {
    body: 'blob', outfit: '#f4f1ea', accent: '#d64545', eyes: '#1a1a2e',
    chest: '#d64545', ears: 'long', gridW: 16, gridH: 16,
  },
  alto: {
    body: 'humanoid', hair: 'spiky', hairColor: '#14141c', skin: '#f0c9a8',
    outfit: '#16161f', accent: '#3fd0ff', eyes: '#2a2a3a',
    weapon: 'dual', weaponColor: '#cfe6ff', cape: true,
  },

  // ★4 ----------------------------------------------------------------------
  hoshino_rei: {
    body: 'humanoid', hair: 'bob', hairColor: '#1d2445', skin: '#f7d3b4',
    outfit: '#1b2a5e', accent: '#6ad8ff', eyes: '#4aa8ff',
    weapon: 'mic', cape: true, chest: '#ffe14a',
  },
  yamikage: {
    body: 'humanoid', hair: 'spiky', hairColor: '#1a1d2e', skin: '#eec6a4',
    outfit: '#243050', accent: '#e8e8f0', eyes: '#ff3a3a', eyeGlow: '#ff6f6f',
    weapon: 'katana', weaponColor: '#dfe8f5',
  },
  uzu: {
    body: 'humanoid', hair: 'spiky', hairColor: '#f5d14a', skin: '#f5cba0',
    outfit: '#ff8a2b', accent: '#1a1d2e', eyes: '#4aa8ff',
    weapon: 'none', chest: '#e8e8f0',
  },
  captain_yuli: {
    body: 'humanoid', hair: 'bob', hairColor: '#15151f', skin: '#f0cba8',
    outfit: '#4a4636', accent: '#f0f0f0', eyes: '#3a4050',
    weapon: 'dual', weaponColor: '#cfd8e6', cape: true,
  },
  kagura: {
    body: 'humanoid', hair: 'long', hairColor: '#ff9ecb', skin: '#fadbc4',
    outfit: '#f4f1ea', accent: '#d64545', eyes: '#ffd23f',
    ears: 'fox', tails: 4, weapon: 'fan',
  },
  unit_09: {
    body: 'humanoid', hair: 'long', hairColor: '#8a6a4a', skin: '#fbdcc4',
    outfit: '#f7f2f4', accent: '#ff7ab8', eyes: '#ff7ab8',
    weapon: 'none', chest: '#ff7ab8', halo: '#ff7ab8',
  },

  // ★5 ----------------------------------------------------------------------
  rin: {
    body: 'humanoid', hair: 'ponytail', hairColor: '#7a2f2a', skin: '#f4cda6',
    outfit: '#1c2a20', accent: '#3f7a4a', eyes: '#c25a3a',
    weapon: 'katana', weaponColor: '#8ad8ff',
  },
  niten: {
    body: 'humanoid', hair: 'ponytail', hairColor: '#2a241e', skin: '#d9ab7e',
    outfit: '#2e2a26', accent: '#8a1f1f', eyes: '#1a1a1a',
    weapon: 'dual', weaponColor: '#e0e6ee', belt: false,
  },
  shiro_same: {
    body: 'humanoid', hair: 'twin', hairColor: '#dff4ff', skin: '#fbe0cc',
    outfit: '#5fd6ff', accent: '#0b3d5c', eyes: '#4a7f9c',
    weapon: 'trident', weaponColor: '#ffe9a3',
  },
  reika: {
    body: 'humanoid', hair: 'bob', hairColor: '#7a5a3a', skin: '#fbdcc0',
    outfit: '#e8e4dc', accent: '#8a6a4a', eyes: '#c8a05a',
    weapon: 'none', chest: '#ffe14a',
  },
  nekromina: {
    body: 'humanoid', hair: 'long', hairColor: '#ff9ecb', skin: '#f2d0bc',
    outfit: '#1a1420', accent: '#c8203a', eyes: '#ff3a5e', eyeGlow: '#ff7a90',
    weapon: 'scythe', weaponColor: '#dfe8f5', cape: true,
  },
  hikari: {
    body: 'humanoid', hair: 'spiky', hairColor: '#ff7a2b', skin: '#fbdcc4',
    outfit: '#ff9a3d', accent: '#ffd23f', eyes: '#ffb03d',
    wings: true, weapon: 'none',
  },
  akane: {
    body: 'humanoid', hair: 'twin', hairColor: '#1a1420', skin: '#fbdcc4',
    outfit: '#c8203a', accent: '#ffd23f', eyes: '#e0405f',
    weapon: 'sword', weaponColor: '#ffe9a3', cape: true,
  },
  kira: {
    body: 'humanoid', hair: 'short', hairColor: '#6a4a2e', skin: '#f7d8bc',
    outfit: '#2a2f3e', accent: '#8a2020', eyes: '#7a4a2a',
    weapon: 'book',
  },

  // ★6 ----------------------------------------------------------------------
  sovereign_alicia: {
    body: 'humanoid', hair: 'long', hairColor: '#ffd76a', skin: '#fbdcc4',
    outfit: '#ff8a3d', accent: '#ffb03d', eyes: '#ff8a3d', eyeGlow: '#ffd76a',
    ears: 'horns', tails: 2, wings: true, weapon: 'none',
  },
  sora: {
    body: 'humanoid', hair: 'spiky', hairColor: '#15151f', skin: '#f5cba0',
    outfit: '#ff8a2b', accent: '#3f6ad8', eyes: '#2a2a3a',
    weapon: 'none', belt: true,
  },
  han: {
    body: 'humanoid', hair: 'spiky', hairColor: '#15151f', skin: '#f5cba0',
    outfit: '#8a5fd6', accent: '#3f6ad8', eyes: '#2a2a3a',
    weapon: 'none',
  },
};

// ---------------------------------------------------------------------------
// ENEMIES
// ---------------------------------------------------------------------------

/** Behaviour -> body plan. The silhouette should telegraph how a thing moves. */
const BODY_FOR_BEHAVIOR = {
  chaser: 'humanoid', swarmer: 'blob', charger: 'beast', ranged: 'mech',
  exploder: 'blob', splitter: 'blob', orbiter: 'ghost', summoner: 'ghost',
  shielder: 'beast', dasher: 'humanoid', tank: 'beast', healer: 'ghost',
  leech: 'blob', ambusher: 'beast', static: 'mech',
};

/**
 * Enemies are COOL-TONED and desaturated against bright saturated players —
 * SECTION 1's readability rule, applied as a transform rather than remembered
 * per entry.
 */
function enemyDescriptor(def) {
  const spec = ENEMY_OVERRIDES[def.id] || {};
  const body = spec.body || BODY_FOR_BEHAVIOR[def.behavior] || 'humanoid';
  const tint = def.visual && def.visual.color ? def.visual.color : '#8fa2c9';
  const accent = def.visual && def.visual.accent ? def.visual.accent : '#2b3452';
  const big = def.size === 'large';
  const medium = def.size === 'medium';
  return Object.assign({
    body,
    outfit: tint,
    accent,
    hairColor: accent,
    skin: '#c9b8a8',
    eyes: spec.eyes || '#ffd23f',
    hair: spec.hair || 'short',
    weapon: spec.weapon || 'none',
    // Fodder used to render on a 16x18 grid against the player's 20x26, which
    // read as "the enemies are tiny". A rank-and-file enemy should be roughly
    // the player's size — it is a person too — with medium and large stepping up
    // from there rather than the player towering over everything.
    gridW: big ? 30 : medium ? 24 : 20,
    gridH: big ? 34 : medium ? 28 : 24,
  }, spec);
}

/** Only where a mob has a silhouette worth protecting. */
const ENEMY_OVERRIDES = {
  chibi_ghost:        { body: 'ghost', eyes: '#e8ecf5' },
  slime_kouhai:       { body: 'blob' },
  tiny_slime:         { body: 'blob', gridW: 11, gridH: 11 },
  crow_familiar:      { body: 'ghost', eyes: '#ff3a5e' },
  husk_wanderer:      { body: 'humanoid', hair: 'none', eyes: '#e8ecf5' },
  crawler_husk:       { body: 'beast', eyes: '#e8ecf5' },
  sprinting_husk:     { body: 'humanoid', hair: 'none', eyes: '#ff3a5e' },
  mob_student:        { body: 'humanoid', hair: 'short' },
  gym_uniform_ghoul:  { body: 'humanoid', hair: 'short', eyes: '#7bf59a' },
  chalk_wraith:       { body: 'ghost', eyes: '#f4f1ea' },
  neon_otaku:         { body: 'humanoid', hair: 'short' },
  gacha_zombie:       { body: 'humanoid', hair: 'short', eyes: '#7bf59a' },
  cursed_desk:        { body: 'mech', eyes: '#ff3a5e' },
  kunai_bat:          { body: 'ghost', eyes: '#ffd23f' },
  camera_drone:       { body: 'mech', wings: true },
  mascot_suit:        { body: 'blob', gridW: 20, gridH: 20 },
  mascot_splinter:    { body: 'blob', gridW: 12, gridH: 12 },
  jellyfish_chorus:   { body: 'ghost', eyes: '#c58cff' },
  genin_shade:        { body: 'humanoid', hair: 'hood' },
  coral_crab:         { body: 'beast', ears: 'horns' },
  antifan_swarm:      { body: 'ghost', eyes: '#ff3a5e' },
  anglerfish_fan:     { body: 'beast', eyes: '#ffe14a' },
  lesser_oni:         { body: 'beast', ears: 'horns' },
  oni_bruiser:        { body: 'beast', ears: 'horns', gridW: 26, gridH: 26 },
  blood_doll:         { body: 'humanoid', hair: 'twin', eyes: '#ff3a5e' },
  blood_shard:        { body: 'blob', gridW: 11, gridH: 11 },
  ronin_shade:        { body: 'humanoid', hair: 'ponytail', weapon: 'katana' },
  ceiling_crawler:    { body: 'beast', eyes: '#ff3a5e' },
  paper_lantern_wisp: { body: 'ghost', eyes: '#ffd23f' },
  encore_siren:       { body: 'humanoid', hair: 'long', weapon: 'mic' },
  trap_scroll:        { body: 'mech', gridW: 14, gridH: 14, noBob: true },
  eel_swarm:          { body: 'ghost', eyes: '#7bf59a' },
  rubble_golem:       { body: 'beast', gridW: 26, gridH: 26 },
  ambusher:           { body: 'humanoid', hair: 'hood' },
  drowned_roadie:     { body: 'humanoid', hair: 'none', eyes: '#7bf59a' },
};

/** Bosses are titans unless they are clearly something else. */
const BOSS_OVERRIDES = {
  the_algorithm:      { body: 'mech', gridW: 48, gridH: 48, eyes: '#ff2d95' },
  the_colossus:       { body: 'titan', gridW: 64, gridH: 64 },
  the_kraken_producer:{ body: 'blob', gridW: 56, gridH: 56 },
  gacha_golem:        { body: 'mech', gridW: 32, gridH: 32 },
  camera_drone_elite: { body: 'mech' },
  stage_manager:      { body: 'humanoid', hair: 'short', gridW: 22, gridH: 30,
                        outfit: '#14141c', eyes: '#ff3a5e', eyeGlow: '#ff6f6f' },
};

function bossDescriptor(def) {
  const spec = BOSS_OVERRIDES[def.id] || {};
  const tint = def.visual && def.visual.color ? def.visual.color : '#8a5f8f';
  const accent = def.visual && def.visual.accent ? def.visual.accent : '#ffd23f';
  return Object.assign({
    body: 'titan',
    outfit: tint,
    accent,
    eyes: '#ff3a5e',
    ears: 'horns',
    cape: true,
    chest: accent,
    gridW: 56, gridH: 56,
  }, spec);
}

/**
 * Resolve a sprite descriptor for any entity, or null when it should keep its
 * procedural shape (projectiles, gems, pickups — those read better as clean
 * geometry than as tiny sprites).
 */
export function spriteFor(kind, def) {
  if (!def) return null;
  if (kind === 'character') {
    const d = CHARACTER_SPRITES[def.id];
    return d ? Object.assign({ id: def.id }, d) : null;
  }
  if (kind === 'enemy') return Object.assign({ id: def.id }, enemyDescriptor(def));
  if (kind === 'boss') return Object.assign({ id: def.id }, bossDescriptor(def));
  return null;
}

export { ENEMY_OVERRIDES, BOSS_OVERRIDES, BODY_FOR_BEHAVIOR };
