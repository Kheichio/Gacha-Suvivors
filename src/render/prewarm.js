// Boot-time sprite pre-raster. DECISIONS.md §35.1.
//
// This is the step that makes a 2,000-entity screen possible. Every distinct
// visual — every shape/colour/size/outline combination, every emoji, every
// rotation step, and a white-flash twin of each — is rasterised into an
// offscreen canvas here, at boot, once.
//
// After this runs, the per-entity draw loop calls nothing but drawImage. No
// fillText, no beginPath, no gradient construction, no shadowBlur.
//
// It yields to the event loop periodically so the boot bar actually animates
// instead of the tab locking for a second and then jumping to 100%.

import { atlas, digits } from './spriteAtlas.js';
import { particles } from './particles.js';
import { DEFAULT_VISUAL, DEFAULT_ENEMY_VISUAL } from '../game/projectile.js';
import { bossProjectileVisuals } from '../game/boss.js';
import { DEV_MODE } from '../core/config.js';

/** Visuals the engine creates itself and that no data file declares. */
const ENGINE_VISUALS = [
  DEFAULT_VISUAL,
  DEFAULT_ENEMY_VISUAL,
  // minion default
  { shape: 'capsule', color: '#9fd3ff', accent: '#123a5c', size: 11 },
  // The DEFAULT obstacle chunk — the one an ObstacleField draws before anybody
  // has given it a style, and the literal ObstacleField's own DEFAULT_STYLE
  // copies character for character. The seven PER-STAGE obstacle looks are not
  // listed here: they live on OBSTACLE_SETS in data/stages.js and arrive through
  // `data.allVisuals()` below, because a hand-kept second copy of a data table
  // is exactly the kind of list that goes stale the next time content lands.
  { shape: 'hex', color: '#4a4f63', accent: '#0b0d16', size: 32 },
  // the in-map altar
  { shape: 'triangle', color: '#ff5f7e', accent: '#3a0a18', size: 22, emoji: '⛩' },
];

/**
 * Particle colours are pre-rastered so the first explosion never hitches.
 *
 * Only the engine's own palette is listed by hand. Every colour that appears on
 * a character, enemy, weapon, relic or effect descriptor is HARVESTED from the
 * data layer below — an ability that bursts particles in its own colour is the
 * overwhelmingly common case, and a hand-kept list of those went stale the
 * moment content was added to it. `tests/renderSmoke.js` covers the remainder.
 */
const PARTICLE_COLORS = [
  '#ffffff', '#ffd76a', '#ffd94a', '#ff7a3d', '#ff5f7e', '#ff3a5e', '#ff2d95',
  '#c58cff', '#8b5cf6', '#6ad8ff', '#5fd0ff', '#5fd6ff', '#7bf59a', '#ffe14a',
  '#e8ecf5', '#8fa2c9', '#6b6f80', '#ffb03d', '#fff3b0', '#9fd3ff',
];

/**
 * Particle colours that live as literals in ability/weapon/boss code rather than
 * on a visual descriptor, so the harvest below cannot see them.
 *
 * These ARE hand-kept, and the renderSmoke pre-raster test is what keeps them
 * honest: burst a colour that is neither on a descriptor nor listed here and the
 * build fails naming the exact hex.
 */
const CODE_PARTICLE_COLORS = [
  '#180020', '#1a1a22', '#1b1f2a', '#2a2622', '#2b3a6b', '#2b6cff', '#2e7d64',
  '#3a3a48', '#3f4a3a', '#3fd0ff', '#4ee07a', '#5fa8ff', '#6a1b9a', '#6b6257',
  '#6bff9e', '#c3ccdd',
  '#7a6a58', '#7ad9ff', '#8a3ff0', '#8a7a5c', '#8fd0ff', '#8fe6a8', '#9fd6ff',
  '#a86bff',
  '#a99c8c', '#aeb8cc', '#b0271f', '#bfe6ff', '#c8102e', '#c8452c', '#c8a24a',
  '#c96a4a', '#c9a227', '#c9a6ff', '#c9c4bb', '#c9d2e4', '#c9d4ff', '#cfd6ff', '#d8d2c4',
  '#7ad4ff',
  '#dfe8ff', '#e0452c', '#e6d8ff', '#e8862c', '#e8ecf2', '#efe4ff', '#ff5a2c',
  '#ff8fc7', '#ff9a3c', '#ff9ecb', '#ff9f4d', '#ffb020', '#ffb3d9', '#ffcf4d',
  '#ffd0ff',
  '#ffd23f', '#ffd84a', '#ffe6a8',
  // Karin's blood red and Rima's arcane pink. Neither lands on a visual
  // descriptor the harvest can see — they are ability-module consts.
  '#c8203a', '#ff7ad0', '#ff5fa8',
];

const PARTICLE_SHAPES = ['circle', 'diamond', 'square', 'star', 'shard'];

/**
 * ONE-OFF particle sprites, as explicit [colour, shape] PAIRS.
 *
 * `PARTICLE_SHAPES` is baked as a CROSS PRODUCT against the whole harvested
 * palette — roughly four hundred colours — so a shape added there costs four
 * hundred rasters whether or not anything ever draws it in three hundred and
 * ninety of those colours. That price is right for `circle` and `shard`, which
 * every ability in the game bursts in its own tint, and wrong for a shape that
 * belongs to ONE character in FOUR known colours.
 *
 * So: bespoke shapes are listed as pairs and baked individually. Same guarantee,
 * six rasters instead of twelve hundred. `tests/renderSmoke.js` is what keeps
 * the list honest — burst a pair that is not here and the build fails naming it.
 */
const PARTICLE_PAIRS = [
  // Mirel's meadow: four ordinary flowers standing in green grass.
  ['#f2f6ff', 'flower'], ['#ff8fc7', 'flower'], ['#c8a24a', 'flower'],
  ['#c9a6ff', 'flower'], ['#8fe6a8', 'grass'],
  // ...and the page of the book that only makes the fruit better.
  ['#a86bff', 'grapes'],
  // Rima's charm scatters flowers; Nika's chompers bite in hexes. Neither shape
  // is in the cross product and neither ever will be — one character each.
  ['#ff7ad0', 'flower'], ['#7bf59a', 'hex'],
];

/**
 * Colours and shapes that belong to a STAGE or an AFFIX rather than to an entity.
 *
 * The harvest below walks visual descriptors, and a stage has none: its ambient
 * mote colour, its mote shape and the colour of each of its mini events are
 * plain fields on data/stages.js that no `visual` anywhere mentions. So every
 * one of them rasterised on first use — the ambient motes on the very first
 * frame of a stage, and an event's burst ring on the frame it was announced,
 * which is the single worst moment for a hitch because it is also the frame the
 * player is being asked to look somewhere else.
 *
 * `crescent` is the reason the SHAPES are collected too and not just the
 * colours: Stage 1's motes are crescents and that shape is not in the list
 * above, so harvesting its colour alone would have fixed nothing.
 */
function harvestLooseColors(data, colors, shapes) {
  const st = data && data.stages;
  if (!st) return;
  for (const s of st.STAGES || []) {
    const amb = s.ambience;
    if (!amb) continue;
    if (amb.particleColor) colors.add(amb.particleColor);
    if (amb.particleShape) shapes.add(amb.particleShape);
  }
  for (const id in st.STAGE_EVENTS || EMPTY_TABLE) {
    const c = st.STAGE_EVENTS[id].color;
    if (c) colors.add(c);
  }
  // Affixes are the same shape of problem for the same reason: `volatile` bursts
  // a ring in its own colour and that colour lives on the affix row, not on any
  // visual. Found by driving full-length runs headlessly, which is the only way
  // a late affix ever fires.
  const en = data.enemies;
  for (const a of (en && en.AFFIXES) || []) if (a.color) colors.add(a.color);
}

const EMPTY_TABLE = {};

/**
 * Ability and boss effects build these on demand; do it up front instead.
 *
 * THIS LIST IS KEPT HONEST BY A TEST, not by discipline. `tests/renderSmoke.js`
 * drives every character through its full kit with a full evolved arsenal and
 * fails if the atlas rasterises ANYTHING mid-run — so an ability added with a
 * new projectile descriptor breaks the build until its descriptor lands here.
 * Before that test existed, forty distinct visuals were rastering on the frame
 * they first appeared, which is a hitch at the exact moment the player casts
 * something for the first time.
 */
const EFFECT_VISUALS = [
  { shape: 'circle', color: '#8a7b63', accent: '#3a3226', size: 20 },
  { shape: 'shard', color: '#ffe86a', accent: '#7a4d00', size: 7, rotates: true, glow: true },
  { shape: 'crescent', color: '#5fd0ff', accent: '#0b3d5c', size: 26, rotates: true, glow: true },
  { shape: 'crescent', color: '#ffffff', accent: '#2a2a3a', size: 26, rotates: true },
  { shape: 'star', color: '#ffd76a', accent: '#6b4200', size: 15, glow: true },
  { shape: 'ring', color: '#ffd76a', accent: '#6b4200', size: 30, glow: true },

  // --- character kits (star3 .. star7) ------------------------------------
  { shape: 'capsule', color: '#7e8f5a', accent: '#2c1a30', size: 10 },
  { shape: 'capsule', color: '#8a5a2b', accent: '#3a2410', size: 14 },
  { shape: 'capsule', color: '#c9d6ff', accent: '#4b6cff', size: 15, glow: true },
  { shape: 'capsule', color: '#efe6f2', accent: '#8b0f2a', size: 12 },
  { shape: 'capsule', color: '#ff7a1a', accent: '#1b1b2b', size: 13 },
  // The transformation double — same silhouette as the clone above it, in the
  // other colour, so the two read as the same technique doing a different job.
  { shape: 'capsule', color: '#ffb3d9', accent: '#1b1b2b', size: 13, glow: true },
  { shape: 'circle', color: '#2a2118', accent: '#d62b3a', size: 11 },
  { shape: 'circle', color: '#5fd6ff', accent: '#0b3d5c', size: 9, glow: true },
  { shape: 'circle', color: '#7fd4ff', accent: '#0b3d5c', size: 9, emoji: '🐟', glow: true },
  { shape: 'circle', color: '#8a7f72', accent: '#3a332c', size: 15, emoji: '🪨' },
  { shape: 'circle', color: '#9aa3b8', accent: '#2b3040', size: 13, emoji: '⚒️' },
  { shape: 'circle', color: '#e8f0ff', accent: '#6b7285', size: 11, emoji: '🫖', glow: true },
  { shape: 'foxfire', color: '#bfe6ff', accent: '#2b6cff', size: 11, rotates: true, glow: true },
  { shape: 'circle', color: '#ffd76a', accent: '#7a5200', size: 6, glow: true, flash: false },
  { shape: 'circle', color: '#ffffff', accent: '#d63b4a', size: 12, emoji: '🍡', glow: true },
  { shape: 'crescent', color: '#5fd0ff', accent: '#1b5e7a', size: 16, rotates: true, glow: true },
  { shape: 'crescent', color: '#dff4ff', accent: '#3fb6c8', size: 16, glow: true },
  { shape: 'crescent', color: '#ff5f8f', accent: '#8b0f2a', size: 13, rotates: true, glow: true },
  { shape: 'crescent', color: '#ff7a3d', accent: '#ffd76a', size: 16, rotates: true, glow: true },
  { shape: 'cross', color: '#8fa0d8', accent: '#151b32', size: 8, rotates: true },
  { shape: 'cross', color: '#ff7a3d', accent: '#151b32', size: 9, rotates: true, glow: true },
  { shape: 'diamond', color: '#c3a8ff', accent: '#2a2436', size: 8, rotates: true, glow: true },
  { shape: 'ring', color: '#c58cff', accent: '#2a0d4a', size: 26, glow: true },
  { shape: 'shard', color: '#5fd0ff', accent: '#0a2b4a', size: 8, rotates: true, glow: true },
  { shape: 'shard', color: '#f2f6ff', accent: '#8fa2c9', size: 8, rotates: true, glow: true },
  { shape: 'shard', color: '#ff7a2f', accent: '#ffd24a', size: 8, rotates: true, glow: true },
  { shape: 'shard', color: '#ffe9a8', accent: '#8f5fd6', size: 9, rotates: true, glow: true },
  { shape: 'shard', color: '#ffffff', accent: '#c8a24a', size: 13, rotates: true, glow: true },
  { shape: 'ofuda', color: '#fff6e0', accent: '#e8452f', size: 10, rotates: true },
  { shape: 'star', color: '#c9d6ff', accent: '#4b6cff', size: 9, rotates: true, glow: true },
  { shape: 'torii', color: '#e8452f', accent: '#7a1a12', size: 26, glow: true, flash: false },
  { shape: 'triangle', color: '#f4f1ea', accent: '#c3a8ff', size: 9, rotates: true },

  // --- evolved-weapon and boss telegraph visuals ---------------------------
  { shape: 'crescent', color: '#ffd76a', accent: '#ff7a3d', size: 22, rotates: true, glow: true },
  { shape: 'triangle', color: '#ffb020', accent: '#e0452c', size: 11, rotates: true, glow: true },

  // --- the three newcomers' kits (game/abilities/star9.js) -----------------
  //
  // Field for field the same literals as the consts in that file. Registering at
  // ability-module scope alone is not enough here: whether that import has run
  // by the time the boot pass snapshots the atlas is an ORDERING accident, and
  // tests/renderSmoke.js fails the build the moment it goes the other way.
  // Listing them makes it the boot pass's job either way.
  { shape: 'shard', color: '#dfe8f5', accent: '#1b1f2a', size: 9, rotates: true, glow: true },
  { shape: 'shard', color: '#dfe8f5', accent: '#1b1f2a', size: 11, flash: false },
  { shape: 'circle', color: '#ff7ad0', accent: '#2a1a3a', size: 13, rotates: true, glow: true },
  { shape: 'shard', color: '#ff5fa8', accent: '#2a2233', size: 7, rotates: true, glow: true },
  { shape: 'triangle', color: '#6ad8ff', accent: '#2a2233', size: 11, rotates: true, glow: true },
  { shape: 'hex', color: '#7bf59a', accent: '#14301c', size: 13, flash: false },
  // ...and the two projectiles their signature relics throw (game/relicHooks.js).
  { shape: 'shard', color: '#dfe8f5', accent: '#1b1f2a', size: 9, rotates: true, glow: true },
  { shape: 'flower', color: '#ff7ad0', accent: '#2a1a3a', size: 11, rotates: true, glow: true },

  // --- PROPS: swung and dropped objects (effects.sweepSprite / fallSprite) --
  //
  // These are the only visuals in the game that are drawn as OBJECTS rather than
  // as energy, and they are deliberately `rotates: false`: `drawSpriteRotated`
  // reads frame 0 and turns on the context, so one frame is all any of them ever
  // needs — and a 44px girder baked at 32 steps with a flash twin is 3 MB of
  // atlas for a prop that appears nine times a run.
  //
  // `flash: false` on all of them for the same reason it is on pickups: none of
  // these can be hit, so the white twin is memory nothing will ever read. It IS
  // part of the atlas key, so an ability that omits it rasterises a second copy
  // mid-run — which is exactly what tests/renderSmoke.js fails the build over.
  { shape: 'scythe', color: '#dfe8f5', accent: '#8b0f2a', size: 30, flash: false },
  { shape: 'scythe', color: '#ffd76a', accent: '#8b0f2a', size: 30, flash: false },
  { shape: 'saucer', color: '#eaf2ff', accent: '#1e2440', size: 11, rotates: true },
  { shape: 'saucer', color: '#c9a227', accent: '#1e2440', size: 18, flash: false },
  { shape: 'girder', color: '#8a93a8', accent: '#12161f', size: 26, flash: false },
  { shape: 'girder', color: '#c9a227', accent: '#12161f', size: 44, flash: false },
  // The chain lash's link PAIR, in steel and in gold. Field for field the same
  // literals as CHAIN_STEEL / CHAIN_GOLD in game/abilities/weaponImpls.js — the
  // `size` there is the constant CHAIN_LINK_SIZE, which is 18. Both colours are
  // Chain Lash's own declared visual colours, so the particle harvest below
  // already knows them and this costs the palette nothing.
  { shape: 'chain', color: '#e8e8f0', accent: '#2a2a3a', size: 18, flash: false },
  { shape: 'chain', color: '#ffd76a', accent: '#3a2a00', size: 18, flash: false },
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * @param {object} data     the loaded data layer module
 * @param {(p:number)=>void} onProgress 0..1
 */
export async function prewarmAtlas(data, onProgress) {
  // Before rasterising anything: can this browser draw a colour emoji at all?
  // If not, every sprite must be built from its shape alone — and finding that
  // out AFTER baking 233 sprites means baking them all twice.
  atlas.probeEmoji();

  // THE FLAME SHEET. Eight tongues with the whole fire ramp baked into each one.
  // It is not a `visual` descriptor — it is its own little sheet — so it is baked
  // by hand here rather than pushed onto the list below. The contract is the same
  // as everything else's: nothing rasterises on the frame an ability first fires,
  // and tests/renderSmoke.js fails the build the day that stops being true.
  atlas.flameSprite();

  const visuals = [];

  // 1. everything the data layer declares
  for (const v of data.allVisuals()) visuals.push(v);

  // 2. everything the engine makes itself
  for (const v of ENGINE_VISUALS) visuals.push(v);
  for (const v of EFFECT_VISUALS) visuals.push(v);

  // 2b. the boss projectile descriptors, which are built from an ATTACK's own
  //     colour and radius and so cannot be written down anywhere. Harvested from
  //     the same builder the fight uses, which is what guarantees the key here
  //     and the key at 11 minutes into a boss phase are the same key.
  for (const v of bossProjectileVisuals(data.bosses && data.bosses.BOSSES)) visuals.push(v);

  // 3. rotation variants for anything a projectile might use — the atlas keys on
  //    `rotates`, so a rotating copy of a static visual is a separate sprite.
  const rotating = [];
  for (const v of visuals) {
    if (!v.rotates && (v.shape === 'shard' || v.shape === 'diamond' || v.shape === 'crescent')) {
      rotating.push(Object.assign({}, v, { rotates: true }));
    }
  }
  for (const v of rotating) visuals.push(v);

  // 3b. NO-FLASH variants, for the three families that go through pickup.js.
  //
  //     `pickup.js` strips the white-flash twin off every pickup, gem and
  //     dropped relic before it draws one — they can never be hit, so the twin
  //     is wasted memory. But stripping it makes a DIFFERENT atlas key from the
  //     one the data declares, so each of those was rasterising the first time
  //     it dropped, mid-run.
  //
  //     Deliberately NOT applied to every visual: doing that blanket added 15MB
  //     to the atlas to fix nine sprites. Only these three families reach that
  //     code path.
  const noFlash = [];
  const flashless = (list) => {
    for (const e of list || []) {
      const v = e && e.visual;
      if (v && v.flash !== false) noFlash.push(Object.assign({}, v, { flash: false }));
    }
  };
  flashless(data.upgrades && data.upgrades.PICKUPS);
  flashless(data.upgrades && data.upgrades.XP_GEMS);
  flashless(data.relics && data.relics.RELICS);
  for (const v of noFlash) visuals.push(v);

  // 3c. HARVEST the particle palette. Every colour and accent on every visual
  //     the game knows about, because abilities burst particles tinted to match
  //     whatever fired them. These sprites are 8px with no flash twin and no
  //     outline, so ~400 of them is a rounding error against the atlas total —
  //     far cheaper than one hitch on the first cast of an ability.
  const particleColors = new Set(PARTICLE_COLORS);
  const particleShapes = new Set(PARTICLE_SHAPES);
  for (const c of CODE_PARTICLE_COLORS) particleColors.add(c);
  for (const v of visuals) {
    if (v.color) particleColors.add(v.color);
    if (v.accent) particleColors.add(v.accent);
  }
  harvestLooseColors(data, particleColors, particleShapes);

  const total = visuals.length + particleColors.size * particleShapes.size + 12;
  let done = 0;
  const bump = async () => {
    done++;
    if (onProgress && (done % 20 === 0)) {
      onProgress(Math.min(1, done / total));
      await sleep(0);           // let the boot bar paint
    }
  };

  for (const v of visuals) {
    atlas.register(v);
    await bump();
  }

  // 4. particle sprites
  for (const c of particleColors) {
    for (const s of particleShapes) {
      particles.spriteFor(c, s);
      await bump();
    }
  }
  // 4b. and the bespoke ones, which are pairs rather than a cross product.
  for (const [c, s] of PARTICLE_PAIRS) {
    particles.spriteFor(c, s);
    await bump();
  }

  // 5. UI glyph sets used by the HUD and the results screen
  for (const spec of [
    ['#ffffff', 22], ['#ffd94a', 30], ['#c58cff', 19],
    ['#7bf59a', 22], ['#9fb0d0', 20], ['#ff6f91', 34],
    ['#ffffff', 33], ['#ffd94a', 45], ['#e8ecf5', 16], ['#ffd76a', 28],
    ['#8e97b5', 14], ['#ffffff', 64],
  ]) {
    digits.build(spec[0], spec[1], true);
    await bump();
  }

  if (onProgress) onProgress(1);

  if (DEV_MODE) {
    const s = atlas.stats();
    console.log(`[atlas] ${s.sprites} sprites, ~${s.mb} MB`);
    const problems = data.validate();
    if (problems.length) {
      console.warn('[data] %d integrity problem(s):', problems.length);
      for (const p of problems) console.warn('  ' + p);
    } else {
      console.log('[data] integrity OK');
    }
  }
}
