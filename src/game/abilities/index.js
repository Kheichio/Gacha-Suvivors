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
//     ctx.t0         what ctx.t was handed at cast — the denominator a bar needs.
//                    Stamped here, read by activeState(), used by nothing else.
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
import './star8.js';
// Three characters added as one cohort rather than one per rarity file. The
// driver joins on ABILITY ID and never learns which file an implementation came
// from, so the split is filing convenience and nothing else.
import './star9.js';
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
          // Out of the form before end() runs, so the ability's own wind-down is
          // drawn on the body it leaves the player standing in.
          if (p.baseSprite && p.def.altForm && p.def.altForm.id === def.id) {
            p.sprite = p.baseSprite;
          }
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
    this._markDuration(ctx);
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
    const ok = impl.cast(run, p, ctx) !== false;
    this._markDuration(ctx);
    return ok;
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
    // THE SECOND SILHOUETTE. A character whose data declares an `altForm` for
    // THIS ability wears it for exactly as long as the ability runs. The join is
    // by id in both directions (see data/index.js validate()), so the driver
    // matches ids and never learns whose they are — and an ability written next
    // month is covered the moment its character declares a form for it.
    if (ctx.active && p.formSprite && p.def.altForm && p.def.altForm.id === def.id) {
      p.sprite = p.formSprite;
    }
    this._markDuration(ctx);
    if (kind === 'special' && p.def.barks && runRng.chance(0.25)) run.bark(p.def.barks.spawn);
    return true;
  }

  /**
   * THE DENOMINATOR.
   *
   * `ctx.t` has always counted DOWN and nothing has ever recorded what it
   * counted down FROM, so the remaining time could be printed and never drawn:
   * "1.4" means nothing without "of 8". The instant after cast() returns is the
   * only moment the clock is known to be whole, and this is the one funnel every
   * press goes through — stamping it here rather than in thirty-odd ability
   * files is what keeps "an ability that sets ctx.t gets a bar" true for the
   * ability somebody writes next month without them doing anything.
   *
   * It CLEARS rather than leaves a stale value when the cast started nothing
   * timed. The same ability's duration changes with its S3 upgrade and several
   * cast() bodies choose between a timed and an untimed form on the day, so a
   * left-over `t0` from the previous press would silently become the next bar's
   * denominator and start it part-full — the exact class of bug this field is
   * here to fix.
   *
   * Every path that can reach an impl's cast() calls this, the mirror boss's
   * included: if a mirrored cast leaves the player's own ctx running, the bar
   * the player is looking at had better be measuring the clock that is ticking.
   */
  _markDuration(ctx) {
    ctx.t0 = (ctx.active && ctx.t !== undefined) ? ctx.t : undefined;
  }

  /**
   * WHAT IS RUNNING RIGHT NOW — a read, for the HUD.
   *
   * The driver has always known this: `ctx.t` is the seconds left on an active
   * special or escape, counted down in tick() above. It was simply unreachable
   * from outside this file, so the HUD could say when an ability would come BACK
   * and never when the one you are standing inside would STOP — and that second
   * half is the one you play around. Being untouchable for another 0.3s and
   * being untouchable for another 3s are two different games.
   *
   * Generic by construction, and deliberately so: it asks the player's own data
   * which ability occupies the slot, then asks that ability's own scratch state
   * how long it has. No character, no ability id and no duration appears here,
   * so an ability written next month is covered the moment its cast() sets
   * `ctx.t` — which every duration ability in the game already does, because
   * that is how the driver ends them.
   *
   * @param {object} run
   * @param {'special'|'escape'} key
   * @returns {object} abilityActive — read it immediately, before the next call
   */
  activeState(run, key) {
    const s = abilityActive;
    s.active = false; s.timed = false; s.remaining = 0; s.total = 0; s.frac = 0;
    const p = run && run.player;
    const def = p && p.def[key];
    if (!def) return s;
    // Deliberately NOT p.state(): that accessor CREATES the scratch slot on a
    // miss, and a poll that runs on every rendered frame must not be able to
    // author simulation state as a side effect of being looked at. No slot means
    // the ability has never been cast, and the honest answer to "is it running"
    // is no.
    const ctx = p.abilityState[def.id];
    if (!ctx || !ctx.active) return s;
    s.active = true;

    // ACTIVE-BUT-UNTIMED IS AN ANSWER, NOT A MISSING ONE. A couple of abilities
    // never set `ctx.t` on purpose — the black flame spreads for the rest of the
    // run, a planted gate waits until you use it — and a progress bar for those
    // would sit pinned at 100% forever, which reads as a broken bar rather than
    // as an effect with no end. Callers get `timed: false` and are expected to
    // draw something that admits it.
    if (ctx.t === undefined) return s;

    s.timed = true;
    s.remaining = ctx.t > 0 ? ctx.t : 0;
    // `t0` is the clock as cast() left it — but an ability may re-arm its own
    // clock mid-flight (the rum barrel shortens itself when it shatters, and
    // several abilities wind down early by setting `ctx.t` to a hair above
    // zero), so the denominator is whichever of the two is larger. A bar drawn
    // past 100% full is a worse lie than one that starts part-full, and an
    // ability that just cut its own timer really IS about to end.
    s.total = ctx.t0 > s.remaining ? ctx.t0 : s.remaining;
    s.frac = s.total > 0 ? s.remaining / s.total : 0;
    return s;
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

/**
 * Reusable output for `activeState()`, on the same contract as `targetResult`
 * in targeting.js and for the same reason: the HUD asks about SPECIAL and then
 * about ESCAPE on every rendered frame, so a fresh object per answer is a
 * hundred-odd pieces of garbage a second produced by LOOKING at the run. Both
 * answers land here, so read one before asking the next question.
 *
 *   active     the ability is running at all
 *   timed      ...and it knows when it will stop
 *   remaining  seconds left    (0 when untimed)
 *   total      seconds it began with — the bar's denominator (0 when untimed)
 *   frac       remaining / total, 0..1 (0 when untimed)
 */
export const abilityActive = {
  active: false, timed: false, remaining: 0, total: 0, frac: 0,
};

const EMPTY_OPTS = { origin: null, damageOverride: 0, hostile: false, power: 1, noRelicHooks: false };
const MIRROR_OPTS = { origin: null, damageOverride: 0, hostile: false, power: 1, noRelicHooks: false };

export const abilities = new AbilityDriver();
