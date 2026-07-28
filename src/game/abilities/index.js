// THE ABILITY REGISTRY.
//
// SECTION 4's implementation note, taken literally: abilities are a registry of
// pure functions keyed by id. Gameplay code NEVER branches on a character id.
// Adding character #20 is one data object plus up to four entries here.
//
// `tests/architecture.test.js` greps every file outside src/data and this folder
// for character-id string literals and fails if any appear. That test exists
// because "adding a character must require editing exactly ONE file" is the
// easiest rule in the spec to break by accident under shipping pressure.
//
// SHAPE OF AN ENTRY
// -----------------
//   AUTO     { fire(run, p, ctx, opts) }
//   SPECIAL  { cast(run, p, ctx), tick?(run, p, ctx, dt), end?(run, p, ctx) }
//   ESCAPE   { cast(run, p, ctx), tick?, end? }
//   PASSIVE  { init?(run, p, ctx), tick?(run, p, ctx, dt),
//              onKill?(run, p, ctx, enemy), onHit?(run, p, ctx, enemy, dmg),
//              onLevelUp?, onDamaged?, onGold? }
//
// `ctx` is `player.state(abilityId)` — a per-run scratch object owned by that
// ability alone, plus the fields this module writes into it:
//     ctx.star       the character's star level (1..5)
//     ctx.s3         true when the S3 SPECIAL upgrade is unlocked
//     ctx.s5         true when the S5 ESCAPE upgrade is unlocked
//     ctx.active     set by cast(), cleared when end() runs
//     ctx.t          duration remaining while active
//     ctx.power      a multiplier applied by the mirror boss (1.0 normally)

import { events, EV } from '../../core/events.js';
import { audio } from '../../core/audio.js';
import { runRng } from '../../core/rng.js';
import { feel } from '../../core/feel.js';
import { camera } from '../../render/camera.js';
import { flash, shake } from '../../render/screenShake.js';
import { floaters } from '../../render/damageNumbers.js';
import { particles } from '../../render/particles.js';
import { resolveTarget, targetResult, nearestTo } from '../targeting.js';
import { dealDamage, SRC } from '../damage.js';
import { angleTo, clamp } from '../../core/math.js';

// The registry table is re-exported from a leaf module, and this statement is
// deliberately FIRST: `import` is hoisted, so registry.js must be fully
// evaluated before any content module below runs `registerAll`. Content modules
// import `registerAll` from here; the binding resolves through to registry.js.
export { AbilityRegistry, register, registerAll } from './registry.js';
import { AbilityRegistry } from './registry.js';

// The content modules. Importing them is what populates the registry.
import './star3.js';
import './star4.js';
import './star5a.js';
import './star5b.js';
import './star6.js';
import './star7.js';
import './evolutionEffects.js';

// ---------------------------------------------------------------------------

class AbilityDriver {
  constructor() {
    this.missing = new Set();
  }

  _impl(id) {
    const a = AbilityRegistry[id];
    if (!a && !this.missing.has(id)) {
      this.missing.add(id);
      console.warn(`[abilities] no implementation for "${id}" — that pillar is inert`);
    }
    return a;
  }

  _ctx(run, id) {
    const p = run.player;
    const c = p.state(id);
    if (c.star === undefined) {
      c.star = p.starLevel;
      c.s3 = p.starLevel >= 3;
      c.s5 = p.starLevel >= 5;
      c.power = 1;
    }
    return c;
  }

  // --- lifecycle ------------------------------------------------------------
  onRunStart(run) {
    const p = run.player;
    for (const key of ['autoAttack', 'special', 'escape', 'passive']) {
      const def = p.def[key];
      if (!def) continue;
      const impl = this._impl(def.id);
      const ctx = this._ctx(run, def.id);
      ctx.def = def;
      if (impl && impl.init) impl.init(run, p, ctx);
    }
  }

  onRunEnd(run) {
    const p = run.player;
    for (const key of ['special', 'escape']) {
      const def = p.def[key];
      if (!def) continue;
      const impl = this._impl(def.id);
      const ctx = this._ctx(run, def.id);
      if (impl && impl.end && ctx.active) impl.end(run, p, ctx);
      ctx.active = false;
    }
  }

  // --- per-tick -------------------------------------------------------------
  tick(run, dt) {
    const p = run.player;

    // passive
    const pass = p.def.passive;
    if (pass) {
      const impl = this._impl(pass.id);
      if (impl && impl.tick) impl.tick(run, p, this._ctx(run, pass.id), dt);
    }

    // an active special or escape
    for (const key of ['special', 'escape']) {
      const def = p.def[key];
      if (!def) continue;
      const ctx = this._ctx(run, def.id);
      if (!ctx.active) continue;
      const impl = this._impl(def.id);
      if (ctx.t !== undefined) {
        ctx.t -= dt;
        if (ctx.t <= 0) {
          ctx.active = false;
          if (impl && impl.end) impl.end(run, p, ctx);
          continue;
        }
      }
      if (impl && impl.tick) impl.tick(run, p, ctx, dt);
    }
  }

  // --- auto attack ----------------------------------------------------------
  fireAuto(run) {
    const p = run.player;
    const def = p.def.autoAttack;
    const impl = this._impl(def.id);
    if (!impl || !impl.fire) return false;
    const ctx = this._ctx(run, def.id);
    ctx.shotIndex = p.autoShotIndex;
    // AUTO SCOPE: helpers.js reads this to fold the signature weapon's level
    // into area / projectile count / pierce. Set for exactly the duration of the
    // synchronous fire() and cleared in a finally, so a throw inside one
    // character's auto cannot leave every special in the game permanently
    // inflated.
    p.autoScope = true;
    try { impl.fire(run, p, ctx, EMPTY_OPTS); } finally { p.autoScope = false; }
    return true;
  }

  /**
   * A minion mirroring the player's auto-attack (Uzu's clones, Deadbeats).
   * The minion stands in for the player as the origin, at a share of damage.
   */
  fireAutoFrom(run, origin, damage) {
    const p = run.player;
    const def = p.def.autoAttack;
    const impl = this._impl(def.id);
    if (!impl || !impl.fire) return false;
    const ctx = this._ctx(run, def.id);
    MIRROR_OPTS.origin = origin;
    MIRROR_OPTS.damageOverride = damage;
    MIRROR_OPTS.noRelicHooks = true;
    // A clone mirroring your auto-attack mirrors the weapon you levelled, too.
    p.autoScope = true;
    try { impl.fire(run, p, ctx, MIRROR_OPTS); } finally { p.autoScope = false; }
    MIRROR_OPTS.origin = null;
    MIRROR_OPTS.damageOverride = 0;
    return true;
  }

  /**
   * THE FINAL FORM using the player's own kit against them at 120% power.
   * Generic: it reads the ability ids off the player's data, which is exactly why
   * this works for a character added after the boss was written.
   */
  fireMirrored(run, boss, powerMult) {
    const p = run.player;
    const pick = runRng.raw();
    const def = pick < 0.6 ? p.def.autoAttack : pick < 0.9 ? p.def.special : p.def.escape;
    const impl = this._impl(def.id);
    if (!impl) return false;
    MIRROR_OPTS.origin = boss;
    MIRROR_OPTS.damageOverride = 0;
    MIRROR_OPTS.hostile = true;
    MIRROR_OPTS.power = powerMult || 1.2;
    const ctx = this._ctx(run, def.id);
    if (impl.fire) impl.fire(run, p, ctx, MIRROR_OPTS);
    else if (impl.cast) impl.cast(run, p, ctx, MIRROR_OPTS);
    MIRROR_OPTS.origin = null;
    MIRROR_OPTS.hostile = false;
    MIRROR_OPTS.power = 1;
    return true;
  }

  // --- casting --------------------------------------------------------------
  castSpecial(run) { return this._cast(run, run.player.def.special, 'special'); }
  castEscape(run) { return this._cast(run, run.player.def.escape, 'escape'); }

  /** Cast a specific ability by id, bypassing its cooldown (Undying's free nova). */
  cast(run, id, free) {
    const p = run.player;
    const impl = this._impl(id);
    if (!impl || !impl.cast) return false;
    const ctx = this._ctx(run, id);
    return impl.cast(run, p, ctx) !== false;
  }

  _cast(run, def, kind) {
    if (!def) return false;
    const p = run.player;
    const impl = this._impl(def.id);
    if (!impl || !impl.cast) return false;
    const ctx = this._ctx(run, def.id);
    ctx.def = def;
    const ok = impl.cast(run, p, ctx);
    if (ok === false) return false;
    if (kind === 'special' && p.def.barks && runRng.chance(0.25)) run.bark(p.def.barks.spawn);
    return true;
  }

  /** Evolutions patch behaviour through the same registry, never through a branch. */
  applyEvolution(run, evo) {
    const impl = AbilityRegistry['evo_' + evo.id];
    if (impl && impl.apply) impl.apply(run, run.player, evo);
    else run.player.flags[camelize(evo.id)] = true;
  }
}

function camelize(id) {
  return id.replace(/_([a-z])/g, (m, c) => c.toUpperCase());
}

const EMPTY_OPTS = { origin: null, damageOverride: 0, hostile: false, power: 1, noRelicHooks: false };
const MIRROR_OPTS = { origin: null, damageOverride: 0, hostile: false, power: 1, noRelicHooks: false };

export const abilities = new AbilityDriver();
