// Target selection. DECISIONS.md §16.
//
// The spec declares 8 targeting modes and then uses six more in prose. Rather
// than hardcoding a mode per character, everything is parameterised:
//     targeting: { mode, count, filter, range }
// so "nearest x3" and "nearest unmarked" are the same mode with different params
// and adding a character never adds a mode.
//
// Every mode goes through the spatial hash. None is O(n).

import { V, dist2, clamp, TAU } from '../core/math.js';
import { runRng } from '../core/rng.js';
import { MARK } from './statusEffects.js';
import { isUntargetable } from './statusEffects.js';

export const MODES = [
  'nearest', 'lowestHp', 'highestHp', 'randomInRange', 'facing', 'facingAuto',
  'aroundSelf', 'mouseAim', 'densestCluster', 'nearestN', 'lineDensest',
];

/** Reusable output. `targets` is truncated and refilled; never reallocated. */
export const targetResult = {
  target: null,
  targets: [],
  x: 0, y: 0,
  angle: 0,
  count: 0,
  found: false,
};

const DEFAULT_RANGE = 900;

function eligible(e, filter) {
  if (!e || !e.active || e.hp <= 0 || e.dying) return false;
  if (isUntargetable(e.st)) return false;
  if (filter === 'unmarked' && e.st.markKind !== MARK.NONE) return false;
  if (filter === 'marked' && e.st.markKind === MARK.NONE) return false;
  if (filter === 'large' && e.size !== 'large') return false;
  if (filter === 'elite' && !e.isElite && !e.isBoss) return false;
  if (filter === 'notBoss' && e.isBoss) return false;
  return true;
}

/**
 * Resolve a targeting spec against the run.
 *
 * @param {object} run
 * @param {object} origin  {x, y, facing}
 * @param {object} spec    {mode, count, filter, range}
 * @returns {object} targetResult — read it immediately
 */
export function resolveTarget(run, origin, spec) {
  const r = targetResult;
  r.target = null;
  r.targets.length = 0;
  r.count = 0;
  r.found = false;
  r.x = origin.x; r.y = origin.y;
  r.angle = origin.facing || 0;

  const mode = (spec && spec.mode) || 'nearest';
  const filter = spec && spec.filter;
  const range = (spec && spec.range) || DEFAULT_RANGE;
  const hash = run.enemyHash;
  const items = run.enemies.items;

  switch (mode) {
    case 'facing': {
      // Pure directional — the player's own facing, no search at all.
      r.angle = origin.facing || 0;
      r.x = origin.x + Math.cos(r.angle) * range * 0.5;
      r.y = origin.y + Math.sin(r.angle) * range * 0.5;
      r.found = true;
      return r;
    }

    case 'aroundSelf': {
      r.x = origin.x; r.y = origin.y;
      r.angle = origin.facing || 0;
      r.found = true;
      return r;
    }

    case 'mouseAim': {
      // DECISIONS.md §17 — the aim abstraction already resolved pad/touch/mouse.
      const a = run.aimAngle();
      r.angle = a;
      r.x = origin.x + Math.cos(a) * range * 0.5;
      r.y = origin.y + Math.sin(a) * range * 0.5;
      r.found = true;
      return r;
    }

    case 'densestCluster': {
      const pop = hash.densestCell(V, origin.x, origin.y, range);
      if (pop > 0) {
        r.x = V.x; r.y = V.y;
        r.angle = Math.atan2(r.y - origin.y, r.x - origin.x);
        r.count = pop;
        r.found = true;
        // Also hand back a representative enemy so on-hit effects have a subject.
        r.target = nearestTo(run, r.x, r.y, 200, filter);
        return r;
      }
      return fallbackNearest(run, origin, range, filter, r);
    }

    case 'lineDensest': {
      // Reika's railgun: the line through the most enemies. Sampling 16 angles
      // through the hash is ~40x cheaper than the exact optimum and visually
      // indistinguishable — it always picks a line a human would call "the good one".
      return bestLine(run, origin, range, filter, r);
    }

    case 'lowestHp':
    case 'highestHp': {
      const wantLow = mode === 'lowestHp';
      let best = null, bestV = wantLow ? Infinity : -Infinity;
      const n = hash.query(origin.x, origin.y, range);
      for (let k = 0; k < n; k++) {
        const e = items[hash.resultAt(k)];
        if (!eligible(e, filter)) continue;
        if (dist2(origin.x, origin.y, e.x, e.y) > range * range) continue;
        const v = e.hp;
        if (wantLow ? v < bestV : v > bestV) { bestV = v; best = e; }
      }
      return finish(r, best, origin);
    }

    case 'randomInRange': {
      const n = hash.query(origin.x, origin.y, range);
      // Reservoir sampling — one pass, no candidate array, no allocation.
      let chosen = null, seen = 0;
      for (let k = 0; k < n; k++) {
        const e = items[hash.resultAt(k)];
        if (!eligible(e, filter)) continue;
        if (dist2(origin.x, origin.y, e.x, e.y) > range * range) continue;
        seen++;
        if (runRng.raw() < 1 / seen) chosen = e;
      }
      if (!chosen && filter) return resolveTarget(run, origin, { mode: 'randomInRange', range });
      return finish(r, chosen, origin);
    }

    case 'nearestN': {
      const want = clamp((spec && spec.count) || 3, 1, 12);
      collectNearest(run, origin, range, filter, want, r.targets);
      r.count = r.targets.length;
      r.target = r.targets[0] || null;
      if (r.target) {
        r.x = r.target.x; r.y = r.target.y;
        r.angle = Math.atan2(r.y - origin.y, r.x - origin.x);
        r.found = true;
      }
      return r;
    }

    case 'facingAuto': {
      // Rin: aim in the facing direction, but auto-turn onto the nearest target.
      const t = nearestTo(run, origin.x, origin.y, range, filter);
      if (t) return finish(r, t, origin);
      r.angle = origin.facing || 0;
      r.x = origin.x + Math.cos(r.angle) * range * 0.5;
      r.y = origin.y + Math.sin(r.angle) * range * 0.5;
      r.found = true;
      return r;
    }

    case 'nearest':
    default:
      return fallbackNearest(run, origin, range, filter, r);
  }
}

function finish(r, target, origin) {
  if (!target) { r.found = false; return r; }
  r.target = target;
  r.x = target.x; r.y = target.y;
  r.angle = Math.atan2(target.y - origin.y, target.x - origin.x);
  r.count = 1;
  r.found = true;
  return r;
}

function fallbackNearest(run, origin, range, filter, r) {
  let t = nearestTo(run, origin.x, origin.y, range, filter);
  // A filtered search that finds nothing falls back to unfiltered, so a
  // character whose filter is exhausted still shoots rather than standing idle.
  if (!t && filter) t = nearestTo(run, origin.x, origin.y, range, null);
  return finish(r, t, origin);
}

/** The workhorse. Expanding-radius search so a crowded screen exits early. */
export function nearestTo(run, x, y, maxRange, filter) {
  const hash = run.enemyHash;
  const items = run.enemies.items;
  let best = null, bestD = Infinity;
  // Two rings: a tight one first (usually a hit), then the full range.
  const rings = maxRange > 260 ? TWO_RINGS : ONE_RING;
  for (let ri = 0; ri < rings.length; ri++) {
    const rad = Math.min(maxRange, maxRange * rings[ri]);
    const n = hash.query(x, y, rad);
    for (let k = 0; k < n; k++) {
      const e = items[hash.resultAt(k)];
      if (!eligible(e, filter)) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d < bestD && d <= rad * rad) { bestD = d; best = e; }
    }
    if (best) return best;
  }
  return best;
}
const ONE_RING = [1];
const TWO_RINGS = [0.32, 1];

/** Fill `out` with the N nearest eligible enemies, sorted by distance. */
export function collectNearest(run, origin, range, filter, want, out) {
  out.length = 0;
  const hash = run.enemyHash;
  const items = run.enemies.items;
  const n = hash.query(origin.x, origin.y, range);
  // Insertion into a bounded list — no sort, no allocation. want is <= 12.
  const d = SCRATCH_D;
  let count = 0;
  for (let k = 0; k < n; k++) {
    const e = items[hash.resultAt(k)];
    if (!eligible(e, filter)) continue;
    const dd = dist2(origin.x, origin.y, e.x, e.y);
    if (dd > range * range) continue;
    if (count < want) {
      let i = count++;
      while (i > 0 && d[i - 1] > dd) { d[i] = d[i - 1]; out[i] = out[i - 1]; i--; }
      d[i] = dd; out[i] = e;
      out.length = count;
    } else if (dd < d[count - 1]) {
      let i = count - 1;
      while (i > 0 && d[i - 1] > dd) { d[i] = d[i - 1]; out[i] = out[i - 1]; i--; }
      d[i] = dd; out[i] = e;
    }
  }
  return out;
}
const SCRATCH_D = new Float64Array(16);

/**
 * Reika's railgun line. Samples 16 candidate angles and scores each by how many
 * enemies fall within the beam's half-width, weighted toward closer targets so
 * she does not aim at a distant blob while something is eating her.
 */
function bestLine(run, origin, range, filter, r) {
  const hash = run.enemyHash;
  const items = run.enemies.items;
  const halfWidth = 22;
  const n = hash.query(origin.x, origin.y, range);
  const SAMPLES = 16;
  let bestScore = 0, bestAngle = origin.facing || 0;

  for (let s = 0; s < SAMPLES; s++) {
    const a = (s / SAMPLES) * TAU;
    const dx = Math.cos(a), dy = Math.sin(a);
    let score = 0;
    for (let k = 0; k < n; k++) {
      const e = items[hash.resultAt(k)];
      if (!eligible(e, filter)) continue;
      const ex = e.x - origin.x, ey = e.y - origin.y;
      const proj = ex * dx + ey * dy;
      if (proj < 0 || proj > range) continue;
      const perp = Math.abs(ex * dy - ey * dx);
      if (perp > halfWidth + e.radius) continue;
      score += 1 + (e.isElite || e.isBoss ? 4 : 0) - proj / range * 0.3;
    }
    if (score > bestScore) { bestScore = score; bestAngle = a; }
  }

  if (bestScore <= 0) {
    const t = nearestTo(run, origin.x, origin.y, range, filter);
    if (t) return finish(r, t, origin);
    r.angle = origin.facing || 0;
    r.found = true;
    r.x = origin.x + Math.cos(r.angle) * range;
    r.y = origin.y + Math.sin(r.angle) * range;
    return r;
  }

  r.angle = bestAngle;
  r.x = origin.x + Math.cos(bestAngle) * range;
  r.y = origin.y + Math.sin(bestAngle) * range;
  r.count = bestScore | 0;
  r.found = true;
  r.target = nearestTo(run, origin.x, origin.y, range, filter);
  return r;
}

/**
 * "Most valuable" target — used by auto-aim when the setting prefers threats
 * over proximity. Elites and bosses outrank fodder inside a reasonable radius.
 */
export function bestValueTarget(run, x, y, range) {
  const hash = run.enemyHash;
  const items = run.enemies.items;
  const n = hash.query(x, y, range);
  let best = null, bestScore = -Infinity;
  for (let k = 0; k < n; k++) {
    const e = items[hash.resultAt(k)];
    if (!eligible(e, null)) continue;
    const d = Math.sqrt(dist2(x, y, e.x, e.y));
    if (d > range) continue;
    const value = (e.isBoss ? 900 : e.isElite ? 300 : e.maxHp * 0.4) - d * 0.6;
    if (value > bestScore) { bestScore = value; best = e; }
  }
  return best;
}
