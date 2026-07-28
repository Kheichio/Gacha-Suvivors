// SPRITE DESCRIPTORS — the art layer.
//
// This is the file an artist replaces. Each entry names a body plan and a
// handful of features; `render/pixelArt.js` assembles the actual pixels. Swapping
// any entry for `{ sheet: 'art/rin.png', frames: 4 }` later changes nothing else.
//
// The 19 characters are hand-authored because they are what the player looks at
// for twenty minutes. Every one is directed off its own entry in characters.js —
// element, archetype, epithet, weapon, palette — and NO TWO SHARE A SILHOUETTE.
// The rule the first pass broke was that a palette swap is not a character: the
// whole roster was one 20x26 stick figure in nineteen colours. Now each one owns
// a distinct combination of hair style, headgear, garment layer, wings/tails and
// weapon, so you can name them from the silhouette alone with the colour off.
//
// Enemies derive from behaviour + tier + element, with overrides only where a
// mob has a specific silhouette worth protecting.
//
// Palettes come from each character's own `refNotes` in refs.js — the whole
// point of that field is that it tells you what to draw.

/**
 * id -> descriptor.
 * Body plans: humanoid | portrait | blob | ghost | beast | mech | titan
 *
 * Feature vocabulary the humanoid plan understands:
 *   hair       short spiky flame wild bowl bangs bob wave long twin drills
 *              ponytail sidetail braid topknot buzz ahoge plume hood none
 *   ears       fox cat elf ribbon fin horns greatHorns
 *   headgear   crown, hat:'tricorn', halo
 *   face       eyes, eyeGlow, visor, mask
 *   garment    coat, coatTrim, skirt, sash, belt, scarf, pauldrons, gauntlets,
 *              boots, sleeve, legColor, chest (crest)
 *   extras     cape, wings (feather|mech|energy|dragon), tails 1-4, aura
 *   weapon     greatsword sword katana dual scythe trident spear staff gun book
 *              mic fan chakram hammer bow claws orb whip cards none
 */
export const CHARACTER_SPRITES = {
  // ★3 ----------------------------------------------------------------------
  // The mascot. A soft white rice-cake blob with a red seal on its brow, long
  // drooping ears and a mouth that is clearly too big for it.
  // `skin` and `hair` are ignored by the blob plan; they are here so the HUD
  // portrait of a mascot is a white bald mascot head and not a peach-skinned
  // person with a haircut.
  mochi: {
    body: 'blob', outfit: '#f4f1ea', accent: '#d64545', eyes: '#1a1a2e',
    chest: '#d64545', ears: 'long', skin: '#f4f1ea', hair: 'none',
    gridW: 20, gridH: 20,
  },
  // The solo duelist: black long coat with cyan trim, twin blades out to both
  // sides, gauntlets. Steel element, so the metal is cold white.
  alto: {
    body: 'humanoid', hair: 'spiky', hairColor: '#14141c', skin: '#f0c9a8',
    outfit: '#2b3242', accent: '#3fd0ff', eyes: '#2a2a3a',
    coat: '#101018', coatTrim: '#3fd0ff', gauntlets: '#3fd0ff',
    boots: '#14141c', weapon: 'dual', weaponColor: '#cfe6ff',
  },

  // ★4 ----------------------------------------------------------------------
  // Stage idol, light element: navy stage dress, twin drills, a short cape, a
  // gold star crest and the mic she never puts down. Star motes orbit her.
  hoshino_rei: {
    body: 'humanoid', hair: 'drills', hairColor: '#1d2445', skin: '#f7d3b4',
    outfit: '#1b2a5e', accent: '#6ad8ff', eyes: '#4aa8ff',
    cape: '#121c44', skirt: '#2a3a78', sash: '#6ad8ff', chest: '#ffe14a',
    aura: '#ffe14a', weapon: 'mic', weaponColor: '#e8ecf5',
  },
  // The avenger. Everything about him is concealment: a red scarf, a face wrap,
  // a curtain of hair over one eye, and a katana. Shadow element, red eyes.
  yamikage: {
    body: 'humanoid', hair: 'bangs', hairColor: '#1a1d2e', skin: '#eec6a4',
    outfit: '#243050', accent: '#e8e8f0', eyes: '#ff3a3a', eyeGlow: '#ff6f6f',
    mask: '#1c2740', scarf: '#c81e3a', gauntlets: '#3a4668', boots: '#1c2740',
    weapon: 'katana', weaponColor: '#dfe8f5',
  },
  // His opposite number in every way: blond and wild instead of dark and
  // curtained, bare-faced, unarmed, orange, and trailing three spirit tails.
  uzu: {
    // A shade deeper than Sora's gi on purpose: they are the only two orange
    // characters and they sit next to each other on the roster grid.
    body: 'humanoid', hair: 'wild', hairColor: '#f5d14a', skin: '#f5cba0',
    outfit: '#ef7318', accent: '#1a1d2e', eyes: '#4aa8ff',
    sash: '#1a1d2e', chest: '#e8e8f0', tails: 3, tailColor: '#ff6a1a',
    gauntlets: '#1a1d2e', weapon: 'none',
  },
  // Military short back and sides, olive uniform, harness straps, survey cape,
  // twin blades. Steel. The only buzz cut on the roster.
  captain_yuli: {
    body: 'humanoid', hair: 'buzz', hairColor: '#15151f', skin: '#f0cba8',
    outfit: '#4a4636', accent: '#d8d2c4', eyes: '#3a4050',
    cape: '#5c6a4a', sash: '#6a6250', gauntlets: '#6a6250', boots: '#3a3628',
    chest: '#8ab0d8', weapon: 'dual', weaponColor: '#cfd8e6',
  },
  // Shrine fox: white robe over a red hakama, four tails, fox ears, a war fan.
  kagura: {
    body: 'humanoid', hair: 'long', hairColor: '#ff9ecb', skin: '#fadbc4',
    outfit: '#f4f1ea', accent: '#d64545', eyes: '#ffd23f',
    coat: '#d64545', coatTrim: '#f4f1ea', sash: '#d64545',
    ears: 'fox', tails: 4, tailColor: '#ff9ecb', weapon: 'fan',
  },
  // A stream overlay given a body: ribbon aerials, a pink status halo that is
  // actually visible, a chest indicator, and pixel motes shedding off her.
  unit_09: {
    body: 'humanoid', hair: 'ahoge', hairColor: '#8a6a4a', skin: '#fbdcc4',
    outfit: '#f7f2f4', accent: '#ff7ab8', eyes: '#ff7ab8',
    ears: 'ribbon', halo: '#ff7ab8', chest: '#ff7ab8', aura: '#ff7ab8',
    skirt: '#e8dce4', boots: '#ff7ab8', weapon: 'none',
  },

  // ★5 ----------------------------------------------------------------------
  // Water breathing: dark uniform under a green patterned haori, a low ponytail,
  // and a blade that runs pale blue.
  rin: {
    body: 'humanoid', hair: 'ponytail', hairColor: '#7a2f2a', skin: '#f4cda6',
    outfit: '#1c2a20', accent: '#3f7a4a', eyes: '#c25a3a',
    coat: '#2e7d64', coatTrim: '#1c2a20', sash: '#2a4a34', boots: '#14201a',
    weapon: 'katana', weaponColor: '#8ad8ff',
  },
  // The ronin: topknot, worn kimono, a crimson obi, and TWO swords, because the
  // whole style is two swords. No belt — the obi does that job.
  niten: {
    body: 'humanoid', hair: 'topknot', hairColor: '#2a241e', skin: '#d9ab7e',
    outfit: '#2e2a26', accent: '#8a1f1f', eyes: '#1a1a1a',
    coat: '#3f3a32', coatTrim: '#8a1f1f', sash: '#8a1f1f', belt: false,
    boots: '#4a4238', weapon: 'dual', weaponColor: '#e0e6ee',
  },
  // Deep-sea: a dorsal fin on the crown, a shark tail, a hoodie over the swim
  // suit, white twintails, and a gold trident.
  shiro_same: {
    body: 'humanoid', hair: 'twin', hairColor: '#dff4ff', skin: '#fbe0cc',
    outfit: '#5fd6ff', accent: '#0b3d5c', eyes: '#4a7f9c',
    coat: '#2f8fc4', coatTrim: '#dff4ff', ears: 'fin',
    tails: 1, tailColor: '#4ab6e0', weapon: 'trident', weaponColor: '#ffe9a3',
  },
  // Electromaster: school uniform, brown bob, a red ribbon at the collar, the
  // flicked coin as her chest crest, and static motes instead of a weapon.
  reika: {
    body: 'humanoid', hair: 'bob', hairColor: '#7a5a3a', skin: '#fbdcc0',
    outfit: '#e8e4dc', accent: '#8a6a4a', eyes: '#c8a05a',
    scarf: '#c8503a', skirt: '#3a4a6a', chest: '#ffe14a', aura: '#7ad9ff',
    boots: '#2e3648', weapon: 'none',
  },
  // Grave idol: pink side-tail, small horns, a black tailcoat, red gauntlets,
  // and a scythe that sweeps back over her head.
  nekromina: {
    body: 'humanoid', hair: 'sidetail', hairColor: '#ff9ecb', skin: '#f2d0bc',
    outfit: '#1a1420', accent: '#c8203a', eyes: '#ff3a5e', eyeGlow: '#ff7a90',
    ears: 'horns', cape: '#3a0d1c', sash: '#c8203a', gauntlets: '#c8203a',
    weapon: 'scythe', weaponColor: '#dfe8f5',
  },
  // Phoenix: a feathered crest instead of hair, burning wings, two tail plumes,
  // and embers coming off her. Fire, and it should look like it.
  hikari: {
    body: 'humanoid', hair: 'plume', hairColor: '#ff7a2b', skin: '#fbdcc4',
    outfit: '#ff9a3d', accent: '#ffd23f', eyes: '#ffb03d',
    wings: 'feather', wingColor: '#ffb84a', tails: 2, tailColor: '#ff6a1a',
    aura: '#ffd23f', chest: '#ffd23f', boots: '#c8502a', weapon: 'none',
  },
  // Pirate captain: tricorn, gold epaulettes, a long red coat, a gold sash and
  // a curved cutlass. Wavy black hair under the hat.
  akane: {
    body: 'humanoid', hair: 'wave', hairColor: '#1a1420', skin: '#fbdcc4',
    outfit: '#c8203a', accent: '#ffd23f', eyes: '#e0405f',
    hat: 'tricorn', hatColor: '#241826', coat: '#8f1428', coatTrim: '#ffd23f',
    pauldrons: '#ffd23f', sash: '#ffd23f', boots: '#3a2418',
    weapon: 'sword', weaponColor: '#ffe9a3',
  },
  // The administrator. Neat, buttoned, entirely unremarkable — and carrying a
  // black tome with a red spine. Shadow element, so the blazer is nearly black.
  kira: {
    body: 'humanoid', hair: 'short', hairColor: '#6a4a2e', skin: '#f7d8bc',
    outfit: '#e8e4dc', accent: '#8a2020', eyes: '#7a4a2a',
    coat: '#22252f', coatTrim: '#8a2020', scarf: '#8a2020', chest: '#c8102e',
    boots: '#1a1a22', weapon: 'book', weaponColor: '#c8102e',
  },

  // ★6 ----------------------------------------------------------------------
  // The dragon queen. Every headgear slot at once — crown over great horns —
  // plus membrane wings, two tails, pauldrons, a cape and a gold mote field.
  sovereign_alicia: {
    body: 'humanoid', hair: 'braid', hairColor: '#ffd76a', skin: '#fbdcc4',
    outfit: '#ff8a3d', accent: '#ffb03d', eyes: '#ff8a3d', eyeGlow: '#ffd76a',
    ears: 'greatHorns', crown: '#ffd76a', wings: 'dragon', wingColor: '#c8452c',
    tails: 2, tailColor: '#e0452c', cape: '#8a2a18', pauldrons: '#e0452c',
    gauntlets: '#e0452c', sash: '#ffd76a', chest: '#e0452c', aura: '#ffd76a',
    boots: '#8a2a18', weapon: 'none',
  },
  // Orange gi, blue undershirt and wristbands, and hair that goes straight up.
  // Unarmed, silver-eyed, standing in a column of white ki motes.
  sora: {
    body: 'humanoid', hair: 'flame', hairColor: '#15151f', skin: '#f5cba0',
    outfit: '#ff8a2b', accent: '#3f6ad8', eyes: '#2a2a3a', eyeGlow: '#dfe8f5',
    sash: '#3f6ad8', sleeve: '#ff7a1a', gauntlets: '#3f6ad8', chest: '#e8e8f0',
    boots: '#3f6ad8', aura: '#f2f6ff', weapon: 'none',
  },
  // His counterweight: purple gi, a white cape, GLASSES, a gold sash, and a gold
  // rage aura. Bowl cut. Nothing about him overlaps Sora's read.
  han: {
    body: 'humanoid', hair: 'bowl', hairColor: '#15151f', skin: '#f5cba0',
    outfit: '#8a5fd6', accent: '#ffd84a', eyes: '#2a2a3a',
    visor: '#8ad8ff', cape: '#e8e4dc', sash: '#ffd84a', chest: '#ffd84a',
    gauntlets: '#3f6ad8', boots: '#3f6ad8', aura: '#ffd84a', weapon: 'none',
  },
};

// ---------------------------------------------------------------------------
// PORTRAITS
// ---------------------------------------------------------------------------

/**
 * The atlas size the HUD should pass to `atlas.registerPixel(portraitFor(def), n)`.
 * 26 puts the 32x32 grid at round(26 * 2.6 / 32) = 2x — a clean integer upscale,
 * which is the only kind that stays pixel art.
 */
export const PORTRAIT_SIZE = 26;

/**
 * A head-and-shoulders bust descriptor for a character, or null.
 *
 * Two things here are load-bearing:
 *
 * 1. `id` MUST differ from the character id. The atlas keys pixel sprites on
 *    'px|' + descriptor.id + '|' + round(size), so reusing the plain id would
 *    hand back the cached WORLD sprite at portrait size and nobody would ever
 *    see an error — just the wrong picture.
 * 2. The colours are lifted from the same CHARACTER_SPRITES entry rather than
 *    re-typed, so a recolour can never leave the portrait and the world sprite
 *    disagreeing about what the character wears.
 */
export function portraitFor(def) {
  if (!def) return null;
  const src = CHARACTER_SPRITES[def.id];
  if (!src) return null;
  return Object.assign({}, src, {
    id: def.id + '_portrait',
    body: 'portrait',
    // A bust does not bob — it is framed art, not a thing standing in a field.
    noBob: true,
    gridW: undefined, gridH: undefined,
    // Below-the-neck kit that a bust crops out anyway; dropping it keeps the
    // portrait from drawing a trident through its own shoulder. `chest` stays —
    // the bust re-sites the crest onto the collarbone.
    weapon: 'none', wings: null, tails: 0, cape: null, skirt: null,
    sash: null, gauntlets: null, boots: null, belt: undefined,
  });
}

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
 * Behaviour -> extra features. The body plan says WHAT it is; this says how it
 * carries itself, so two chasers and a dasher do not all resolve to the same
 * bald humanoid. Cheaper than an override per enemy and it applies to content
 * added later for free.
 */
const BEHAVIOR_STYLE = {
  chaser:   { hair: 'wild', gauntlets: true },
  dasher:   { hair: 'ponytail', weapon: 'claws', sash: true },
  ranged:   { weapon: 'gun', wings: 'mech' },
  charger:  { ears: 'horns', tails: 1 },
  tank:     { ears: 'greatHorns', pauldrons: true },
  shielder: { pauldrons: true },
  ambusher: { hair: 'hood', weapon: 'claws' },
  summoner: { halo: '#c58cff' },
  healer:   { halo: '#7bf59a' },
  orbiter:  { ears: 'horns' },
  exploder: { chest: '#ff7a3d' },
  splitter: { chest: '#7bf59a' },
  leech:    { ears: 'long' },
  swarmer:  {},
  static:   { noBob: true, halo: '#ff3a5e' },
};

/**
 * Enemies are COOL-TONED and desaturated against bright saturated players —
 * SECTION 1's readability rule, applied as a transform rather than remembered
 * per entry.
 */
function enemyDescriptor(def) {
  const spec = ENEMY_OVERRIDES[def.id] || {};
  const body = spec.body || BODY_FOR_BEHAVIOR[def.behavior] || 'humanoid';
  const style = BEHAVIOR_STYLE[def.behavior] || {};
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
    eyes: '#ffd23f',
    hair: 'short',
    weapon: 'none',
  }, style, {
    // Fodder used to render on a 16x18 grid against the player's 20x26, which
    // read as "the enemies are tiny". Now that the player stands on a 24x34
    // grid, a rank-and-file enemy matches it — it is a person too — and medium
    // and large step up from there. Chunky reads at a glance; small reads as
    // noise once there are two hundred of them.
    gridW: big ? 34 : medium ? 28 : 24,
    gridH: big ? 40 : medium ? 33 : 28,
  }, spec);
}

/** Only where a mob has a silhouette worth protecting. */
const ENEMY_OVERRIDES = {
  chibi_ghost:        { body: 'ghost', eyes: '#e8ecf5' },
  slime_kouhai:       { body: 'blob' },
  tiny_slime:         { body: 'blob', gridW: 13, gridH: 13 },
  crow_familiar:      { body: 'ghost', eyes: '#ff3a5e', ears: 'horns' },
  husk_wanderer:      { body: 'humanoid', hair: 'none', eyes: '#e8ecf5' },
  crawler_husk:       { body: 'beast', eyes: '#e8ecf5' },
  sprinting_husk:     { body: 'humanoid', hair: 'none', eyes: '#ff3a5e', weapon: 'none' },
  mob_student:        { body: 'humanoid', hair: 'bowl', weapon: 'none', scarf: true },
  gym_uniform_ghoul:  { body: 'humanoid', hair: 'buzz', eyes: '#7bf59a', sash: true },
  chalk_wraith:       { body: 'ghost', eyes: '#f4f1ea' },
  neon_otaku:         { body: 'humanoid', hair: 'bob', visor: '#7ad9ff', weapon: 'none' },
  gacha_zombie:       { body: 'humanoid', hair: 'short', eyes: '#7bf59a', coat: '#3a4260' },
  cursed_desk:        { body: 'mech', eyes: '#ff3a5e', noBob: true },
  kunai_bat:          { body: 'ghost', eyes: '#ffd23f', ears: 'horns' },
  camera_drone:       { body: 'mech', wings: 'mech' },
  mascot_suit:        { body: 'blob', gridW: 24, gridH: 24, ears: 'long' },
  mascot_splinter:    { body: 'blob', gridW: 14, gridH: 14 },
  jellyfish_chorus:   { body: 'ghost', eyes: '#c58cff' },
  genin_shade:        { body: 'humanoid', hair: 'hood', mask: true, weapon: 'claws' },
  coral_crab:         { body: 'beast', ears: 'horns', pauldrons: true },
  antifan_swarm:      { body: 'ghost', eyes: '#ff3a5e' },
  anglerfish_fan:     { body: 'beast', eyes: '#ffe14a', ears: 'greatHorns' },
  lesser_oni:         { body: 'beast', ears: 'horns' },
  oni_bruiser:        { body: 'beast', ears: 'greatHorns', gridW: 30, gridH: 30 },
  blood_doll:         { body: 'humanoid', hair: 'twin', eyes: '#ff3a5e', skirt: '#7a1f2b' },
  blood_shard:        { body: 'blob', gridW: 13, gridH: 13 },
  ronin_shade:        { body: 'humanoid', hair: 'topknot', weapon: 'katana', sash: true },
  ceiling_crawler:    { body: 'beast', eyes: '#ff3a5e' },
  paper_lantern_wisp: { body: 'ghost', eyes: '#ffd23f', halo: '#ffd23f' },
  encore_siren:       { body: 'humanoid', hair: 'drills', weapon: 'mic', skirt: '#3a2a5a' },
  trap_scroll:        { body: 'mech', gridW: 16, gridH: 16, noBob: true },
  eel_swarm:          { body: 'ghost', eyes: '#7bf59a' },
  rubble_golem:       { body: 'beast', gridW: 30, gridH: 30, pauldrons: true },
  ambusher:           { body: 'humanoid', hair: 'hood', weapon: 'claws' },
  drowned_roadie:     { body: 'humanoid', hair: 'none', eyes: '#7bf59a', coat: '#2a3a44' },
};

/** Bosses are titans unless they are clearly something else. Grids unchanged. */
const BOSS_OVERRIDES = {
  the_algorithm:      { body: 'mech', gridW: 48, gridH: 48, eyes: '#ff2d95' },
  the_colossus:       { body: 'titan', gridW: 64, gridH: 64 },
  the_kraken_producer:{ body: 'blob', gridW: 56, gridH: 56 },
  gacha_golem:        { body: 'mech', gridW: 32, gridH: 32 },
  camera_drone_elite: { body: 'mech' },
  stage_manager:      { body: 'humanoid', hair: 'short', gridW: 22, gridH: 30,
                        outfit: '#14141c', eyes: '#ff3a5e', eyeGlow: '#ff6f6f',
                        coat: '#0d0d14', gauntlets: '#3a3a4a', weapon: 'whip' },
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

export { ENEMY_OVERRIDES, BOSS_OVERRIDES, BODY_FOR_BEHAVIOR, BEHAVIOR_STYLE };
