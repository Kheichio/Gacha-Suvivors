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

/** Particle colours are pre-rastered so the first explosion never hitches. */
const PARTICLE_COLORS = [
  '#ffffff', '#ffd76a', '#ffd94a', '#ff7a3d', '#ff5f7e', '#ff3a5e', '#ff2d95',
  '#c58cff', '#8b5cf6', '#6ad8ff', '#5fd0ff', '#5fd6ff', '#7bf59a', '#ffe14a',
  '#e8ecf5', '#8fa2c9', '#6b6f80', '#ffb03d', '#fff3b0', '#9fd3ff',
];
const PARTICLE_SHAPES = ['circle', 'diamond', 'square', 'star'];

/** Ability and boss effects build these on demand; do it up front instead. */
const EFFECT_VISUALS = [
  { shape: 'circle', color: '#8a7b63', accent: '#3a3226', size: 20 },
  { shape: 'shard', color: '#ffe86a', accent: '#7a4d00', size: 7, rotates: true, glow: true },
  { shape: 'crescent', color: '#5fd0ff', accent: '#0b3d5c', size: 26, rotates: true, glow: true },
  { shape: 'crescent', color: '#ffffff', accent: '#2a2a3a', size: 26, rotates: true },
  { shape: 'star', color: '#ffd76a', accent: '#6b4200', size: 15, glow: true },
  { shape: 'ring', color: '#ffd76a', accent: '#6b4200', size: 30, glow: true },
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

  const total = visuals.length + PARTICLE_COLORS.length * PARTICLE_SHAPES.length + 12;
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
  for (const c of PARTICLE_COLORS) {
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
