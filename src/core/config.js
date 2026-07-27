// Global configuration + the DEV_MODE flag.
// One flag, one helper, one flip to ship. See DECISIONS.md §22.

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

function readQuery() {
  if (!IS_BROWSER) {
    // Node: allow `node sim.js --char=rin --seed=42` style flags.
    const q = Object.create(null);
    const argv = (typeof process !== 'undefined' && process.argv) ? process.argv.slice(2) : [];
    for (const a of argv) {
      const m = /^--?([\w.]+)(?:=(.*))?$/.exec(a);
      if (m) q[m[1]] = m[2] === undefined ? '1' : m[2];
    }
    return q;
  }
  const q = Object.create(null);
  const sp = new URLSearchParams(window.location.search);
  for (const [k, v] of sp) q[k] = v;
  return q;
}

export const QUERY = readQuery();

const flag = (name, dflt) => {
  const v = QUERY[name];
  if (v === undefined) return dflt;
  return v !== '0' && v !== 'false';
};

/** Dev builds show `ref` names. `?dev=0` ships. */
export const DEV_MODE = flag('dev', true);

/** Headless balance harness: `?sim=1` or `node sim.js`. */
export const SIM_MODE = flag('sim', false);

/** Perf smoke test: `?perf=1` spawns 2,500 entities and asserts p95 < 16.6ms. */
export const PERF_MODE = flag('perf', false);

/** In-browser unit-test runner: `?test=1`. */
export const TEST_MODE = flag('test', false);

export const CONFIG = {
  // --- simulation -------------------------------------------------------
  TICK_HZ: 60,
  TICK_DT: 1 / 60,
  /** Never simulate more than this many steps in one frame (spiral-of-death guard). */
  MAX_STEPS_PER_FRAME: 5,

  // --- world ------------------------------------------------------------
  ARENA_W: 4000,
  ARENA_H: 4000,
  /** Soft push-back band at the arena edge. DECISIONS.md §19. */
  ARENA_SOFT_EDGE: 120,

  // --- performance caps (DECISIONS.md §25, §35) --------------------------
  MAX_ENTITIES: 2500,
  MAX_ENEMIES: 2200,
  MAX_PROJECTILES: 1200,
  MAX_GEMS: 600,
  GEM_MERGE_THRESHOLD: 400,
  MAX_PARTICLES: 800,
  MAX_DAMAGE_NUMBERS: 60,
  MAX_MINIONS: 40,
  SPLIT_BUDGET_PER_RUN: 400,

  SPATIAL_CELL: 64,
  /** Enemies further than this many screens away get recycled to the far side. */
  CULL_SCREENS: 1.5,

  // --- rendering --------------------------------------------------------
  /**
   * The DESIGN resolution — how much WORLD is visible, independent of window
   * size, so a wide monitor is not a gameplay advantage.
   *
   * Deliberately 1280x720 and not the window's 1920x1080. At 1920 the camera
   * shows 1920 world px, which puts the spawn ring ~1050px from the player;
   * a 58 px/s fodder enemy then takes EIGHTEEN SECONDS to arrive, and every
   * melee character spends the opening of every run hitting nothing. It also
   * draws a 14px-radius enemy at 14 screen px, which is too small to read in a
   * horde. 1280 fixes both: ~12s to first contact and ~1.5x the apparent size.
   */
  BASE_W: 1280,
  BASE_H: 720,
  ATLAS_ROTATION_STEPS: 32,
  MAX_DPR: 2,

  // --- persistence ------------------------------------------------------
  SAVE_KEY: 'gachaSurvivors.save.v1',
  SCHEMA_VERSION: 2,
};

/**
 * The single name-display helper. Never sprinkle `if (DEV_MODE)` through the UI.
 * Covers characters, abilities, relics, enemies, stages and bosses alike.
 *
 * In a shipping build `src/data/refs.js` is deleted outright; `refOf()` returns
 * undefined and this degrades to `e.name` with no code change.
 */
export function displayName(e) {
  if (!e) return '';
  const base = (!DEV_MODE && e.shipName) ? e.shipName : (e.name || e.id || '');
  if (!DEV_MODE) return base;
  const ref = e.ref;
  return ref ? `${base} [${ref}]` : base;
}

/** The dimmed-bracket half of displayName, for UIs that style it separately. */
export function refSuffix(e) {
  return (DEV_MODE && e && e.ref) ? e.ref : '';
}

export const IS_TOUCH = IS_BROWSER &&
  (('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0);

export { IS_BROWSER };
