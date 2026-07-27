// The save blob: one JSON object under `gachaSurvivors.save.v1`.
//
// Migrations are a real chain, not a stub (DECISIONS.md §23). Every schema bump
// registers a function that takes the previous shape and returns the next one.
// `tests/save.test.js` loads a v1 fixture and asserts it upgrades cleanly.

import { CONFIG } from './config.js';
import { storage } from './storage.js';
import { metaRng } from './rng.js';

export function defaultSave() {
  return {
    schemaVersion: CONFIG.SCHEMA_VERSION,
    createdAt: 0,
    playtime: 0,

    currencies: { gold: 0, starFragments: 0, tickets: 0, universalLetters: 0 },
    /** characterId -> { owned, starLevel, letters, bond, runs, kills } */
    roster: {},
    /** relicId -> { owned, banked } — banked relics get a 3x in-run drop weight. */
    relics: {},

    /** bannerId -> pity state. The 5-star counter is shared; see gacha.js. */
    gacha: {
      pity: {},
      sharedPity5: 0,
      guaranteedFeatured: {},
      totalPulls: 0,
      history: [],          // last 100 pulls
      beginnerUsed: false,
      rngSeed: metaRng.seed,
      rngCalls: 0,
    },

    /** shrineUpgradeId -> level */
    shrine: {},
    shrineSpent: 0,

    /** stageId -> { cleared, bestTime, bestTier, clears, mastery } */
    stages: {},

    achievements: {},       // id -> unlockedAtSeconds
    codex: { enemies: {}, bosses: {}, relics: {}, characters: {} },

    /** Personal bests for Endless. Local only — there is no server. */
    endless: {},

    stats: {
      runs: 0, wins: 0, deaths: 0, kills: 0, damage: 0,
      goldEarned: 0, fragmentsEarned: 0, levelUps: 0, bossKills: 0,
      highestLevel: 0, longestRun: 0, stageManagerSurvived: 0,
    },

    settings: {
      masterVolume: 0.8, sfxVolume: 0.9, musicVolume: 0.5,
      shakeIntensity: 1.0,
      damageNumbers: 'all',        // all | crits | off
      reduceFlashing: true,        // ON by default — see DECISIONS.md deferred #5
      colorblindOutlines: false,
      uiScale: 1.0,
      autoAim: true,
      holdToUseAbilities: false,
      showRefNames: true,
      screenShakeOff: false,
    },

    /** Which unlock gates the achievements actually control (DECISIONS.md §24). */
    unlocks: { curse: false, relicBanner: false, encoreTier: false, endless: false },

    daily: { lastWinDay: -1 },

    /**
     * A CLAIM TICKET for a run that ended but whose results screen has not paid
     * out yet.
     *
     * SECTION 2 is absolute: "you KEEP all currency earned". But the payout
     * happens on the results screen, so ANYTHING that stops the player reaching
     * it — a hang, a crash, an alt-F4, a refresh — silently voids the whole run.
     * The run writes this the instant it ends; results clears it after paying;
     * and if the game ever boots and finds one still sitting here, it pays it
     * out then. Losing a run's rewards to a bug is not an acceptable outcome.
     */
    pendingRun: null,
  };
}

// --- migration chain ---------------------------------------------------------
// Keyed by the version being upgraded FROM.
const MIGRATIONS = {
  1: (s) => {
    // v1 predates the unlocks gate and the pluggable relic bank.
    s.unlocks = s.unlocks || { curse: false, relicBanner: false, encoreTier: false, endless: false };
    s.relics = s.relics || {};
    s.endless = s.endless || {};
    if (s.settings && s.settings.reduceFlashing === undefined) s.settings.reduceFlashing = true;
    s.schemaVersion = 2;
    return s;
  },
};

/** Fill in anything a migration or a hand-edited save is missing. */
function reconcile(save) {
  const d = defaultSave();
  for (const k of Object.keys(d)) {
    if (save[k] === undefined || save[k] === null) { save[k] = d[k]; continue; }
    if (typeof d[k] === 'object' && !Array.isArray(d[k])) {
      for (const k2 of Object.keys(d[k])) {
        if (save[k][k2] === undefined) save[k][k2] = d[k][k2];
      }
    }
  }
  return save;
}

export function migrate(raw) {
  let s = raw;
  let guard = 0;
  while ((s.schemaVersion || 1) < CONFIG.SCHEMA_VERSION && guard++ < 32) {
    const from = s.schemaVersion || 1;
    const fn = MIGRATIONS[from];
    if (!fn) {
      console.warn(`[save] no migration from v${from}; resetting to defaults`);
      return defaultSave();
    }
    s = fn(s);
    if ((s.schemaVersion || 1) === from) { s.schemaVersion = from + 1; }
  }
  if (s.schemaVersion > CONFIG.SCHEMA_VERSION) {
    // A save from a newer build. Do not destroy it — refuse and run in-memory.
    console.warn('[save] save is from a newer version; running without persistence');
    const fresh = defaultSave();
    fresh._readOnlyBecauseNewer = true;
    return fresh;
  }
  return reconcile(s);
}

class SaveManager {
  constructor() {
    this.data = defaultSave();
    this.loaded = false;
    this.dirty = false;
    this._flushTimer = 0;
  }

  load() {
    const raw = storage.read(CONFIG.SAVE_KEY);
    if (!raw) {
      this.data = defaultSave();
      this.data.createdAt = Date.now();
      this.loaded = true;
      this.save();
      return this.data;
    }
    try {
      this.data = migrate(JSON.parse(raw));
    } catch (e) {
      console.error('[save] corrupt save; starting fresh (old blob kept under .bak)', e);
      storage.write(CONFIG.SAVE_KEY + '.bak', raw);
      this.data = defaultSave();
    }
    // Resume the gacha stream exactly where it stopped — this is what makes
    // reloading the page unable to re-roll a pull.
    metaRng.reseed(this.data.gacha.rngSeed >>> 0, this.data.gacha.rngCalls | 0);
    this.loaded = true;
    return this.data;
  }

  /** Write immediately. Called before every gacha reveal. */
  save() {
    if (this.data._readOnlyBecauseNewer) return false;
    this.data.gacha.rngSeed = metaRng.seed;
    this.data.gacha.rngCalls = metaRng.calls;
    this.dirty = false;
    try {
      return storage.write(CONFIG.SAVE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.error('[save] serialise failed', e);
      return false;
    }
  }

  /** Mark dirty; the flush happens at most once a second, off the hot path. */
  touch() { this.dirty = true; }

  tick(dtRealSeconds) {
    if (!this.dirty) return;
    this._flushTimer += dtRealSeconds;
    if (this._flushTimer >= 1.0) { this._flushTimer = 0; this.save(); }
  }

  wipe() {
    storage.remove(CONFIG.SAVE_KEY);
    this.data = defaultSave();
    this.data.createdAt = Date.now();
    metaRng.reseed((Date.now() ^ 0x9e3779b9) >>> 0, 0);
    this.save();
  }

  export() { return JSON.stringify(this.data, null, 2); }

  import(json) {
    try {
      this.data = migrate(JSON.parse(json));
      this.save();
      return true;
    } catch (e) { return false; }
  }
}

export const save = new SaveManager();

// --- convenience accessors used all over the meta layer ----------------------

export function rosterEntry(charId) {
  let e = save.data.roster[charId];
  if (!e) {
    e = { owned: false, starLevel: 1, letters: 0, bond: 0, runs: 0, kills: 0 };
    save.data.roster[charId] = e;
  }
  return e;
}

export function stageEntry(stageId) {
  let e = save.data.stages[stageId];
  if (!e) {
    e = { cleared: false, bestTime: 0, bestTier: -1, clears: 0, mastery: 0 };
    save.data.stages[stageId] = e;
  }
  return e;
}

export function addCurrency(kind, amount) {
  if (!amount) return;
  const c = save.data.currencies;
  c[kind] = (c[kind] || 0) + amount;
  if (kind === 'gold') save.data.stats.goldEarned += Math.max(0, amount);
  if (kind === 'starFragments') save.data.stats.fragmentsEarned += Math.max(0, amount);
  save.touch();
}

export function spendCurrency(kind, amount) {
  const c = save.data.currencies;
  if ((c[kind] || 0) < amount) return false;
  c[kind] -= amount;
  save.touch();
  return true;
}
