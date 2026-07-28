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
import { DEV_MODE } from '../core/config.js';

/** Visuals the engine creates itself and that no data file declares. */
const ENGINE_VISUALS = [
  DEFAULT_VISUAL,
  DEFAULT_ENEMY_VISUAL,
  // minion default
  { shape: 'capsule', color: '#9fd3ff', accent: '#123a5c', size: 11 },
  // obstacle chunk
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
  '#7a6a58', '#7ad9ff', '#8a7a5c', '#8fd0ff', '#8fe6a8', '#9fd6ff', '#a86bff',
  '#a99c8c', '#aeb8cc', '#b0271f', '#bfe6ff', '#c8102e', '#c8452c', '#c8a24a',
  '#c96a4a', '#c9a227', '#c9a6ff', '#c9c4bb', '#c9d2e4', '#cfd6ff', '#d8d2c4',
  '#dfe8ff', '#e0452c', '#e6d8ff', '#e8862c', '#e8ecf2', '#efe4ff', '#ff5a2c',
  '#ff8fc7', '#ff9a3c', '#ff9ecb', '#ff9f4d', '#ffb020', '#ffcf4d', '#ffd0ff',
  '#ffd23f', '#ffd84a', '#ffe6a8',
];

const PARTICLE_SHAPES = ['circle', 'diamond', 'square', 'star', 'shard'];

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
  { shape: 'circle', color: '#2a2118', accent: '#d62b3a', size: 11 },
  { shape: 'circle', color: '#5fd6ff', accent: '#0b3d5c', size: 9, glow: true },
  { shape: 'circle', color: '#7fd4ff', accent: '#0b3d5c', size: 9, emoji: '🐟', glow: true },
  { shape: 'circle', color: '#8a7f72', accent: '#3a332c', size: 15, emoji: '🪨' },
  { shape: 'circle', color: '#9aa3b8', accent: '#2b3040', size: 13, emoji: '⚒️' },
  { shape: 'circle', color: '#e8f0ff', accent: '#6b7285', size: 11, emoji: '🫖', glow: true },
  { shape: 'circle', color: '#eaf2ff', accent: '#1e2440', size: 10, rotates: true },
  { shape: 'circle', color: '#ffb03d', accent: '#7a3b00', size: 10, glow: true },
  { shape: 'circle', color: '#ffd76a', accent: '#7a5200', size: 6, glow: true, flash: false },
  { shape: 'circle', color: '#ffffff', accent: '#d63b4a', size: 12, emoji: '🍡', glow: true },
  { shape: 'crescent', color: '#5fd0ff', accent: '#1b5e7a', size: 16, rotates: true, glow: true },
  { shape: 'crescent', color: '#dff4ff', accent: '#3fb6c8', size: 16, glow: true },
  { shape: 'crescent', color: '#ff5f8f', accent: '#8b0f2a', size: 13, rotates: true, glow: true },
  { shape: 'crescent', color: '#ff7a3d', accent: '#ffd76a', size: 16, rotates: true, glow: true },
  { shape: 'cross', color: '#8fa0d8', accent: '#151b32', size: 8, rotates: true },
  { shape: 'cross', color: '#c81e3a', accent: '#151b32', size: 9, rotates: true, glow: true },
  { shape: 'diamond', color: '#c3a8ff', accent: '#2a2436', size: 8, rotates: true, glow: true },
  { shape: 'ring', color: '#c58cff', accent: '#2a0d4a', size: 26, glow: true },
  { shape: 'shard', color: '#5fd0ff', accent: '#0a2b4a', size: 8, rotates: true, glow: true },
  { shape: 'shard', color: '#f2f6ff', accent: '#8fa2c9', size: 8, rotates: true, glow: true },
  { shape: 'shard', color: '#ff7a2f', accent: '#ffd24a', size: 8, rotates: true, glow: true },
  { shape: 'shard', color: '#ffe9a8', accent: '#8f5fd6', size: 9, rotates: true, glow: true },
  { shape: 'shard', color: '#ffffff', accent: '#c8a24a', size: 13, rotates: true, glow: true },
  { shape: 'square', color: '#fff6e0', accent: '#e8452f', size: 8, rotates: true },
  { shape: 'star', color: '#c9d6ff', accent: '#4b6cff', size: 9, rotates: true, glow: true },
  { shape: 'triangle', color: '#e8452f', accent: '#ffd8c2', size: 20, glow: true },
  { shape: 'triangle', color: '#f4f1ea', accent: '#c3a8ff', size: 9, rotates: true },

  // --- evolved-weapon and boss telegraph visuals ---------------------------
  { shape: 'crescent', color: '#ffd76a', accent: '#ff7a3d', size: 22, rotates: true, glow: true },
  { shape: 'triangle', color: '#ffb020', accent: '#e0452c', size: 11, rotates: true, glow: true },
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

  const visuals = [];

  // 1. everything the data layer declares
  for (const v of data.allVisuals()) visuals.push(v);

  // 2. everything the engine makes itself
  for (const v of ENGINE_VISUALS) visuals.push(v);
  for (const v of EFFECT_VISUALS) visuals.push(v);

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
  for (const c of CODE_PARTICLE_COLORS) particleColors.add(c);
  for (const v of visuals) {
    if (v.color) particleColors.add(v.color);
    if (v.accent) particleColors.add(v.accent);
  }

  const total = visuals.length + particleColors.size * PARTICLE_SHAPES.length + 12;
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
    for (const s of PARTICLE_SHAPES) {
      particles.spriteFor(c, s);
      await bump();
    }
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
