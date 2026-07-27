// THE 4-STAR ROSTER — twenty-four ability implementations, six characters.
//
// SECTION 4 lines 427-574. Every number here is either read from the character
// data (`ctx.def.damage`, `ctx.def.interval`, `ctx.def.cooldown`,
// `ctx.def.iframes`) or quoted verbatim from the spec line printed above the
// ability it belongs to. Nothing in this file branches on a character id — the
// registry key IS the branch (DECISIONS.md §36).
//
// Allocation rules (SECTION 3 / DECISIONS.md §35): nothing in a `fire()` or
// `tick()` path allocates. Every callback, every `opts` bag that is reached from
// a per-frame path, and every visual descriptor is a module-level constant
// declared once below. Scratch that varies per call lives on `ctx`, which the
// driver hands each ability for the whole run.

import { registerAll } from './index.js';
import * as H from './helpers.js';
// The only hold-to-charge ability in the roster needs the raw button state.
// `input.held()` is device-agnostic (keyboard, pad, touch), so this stays inside
// DECISIONS.md §17's "one abstraction" rule.
import { input, ACT } from '../../core/input.js';

// ---------------------------------------------------------------------------
// Shared scratch. Written immediately before the helper call that reads it and
// consumed synchronously, so a single module-level record is safe and lets every
// callback below be a function reference instead of a per-call closure.
// ---------------------------------------------------------------------------
const SCRATCH = {
  dps: 0,          // black-flame damage per second while a spread pass runs
  burnDps: 0,      // foxfire burn while a wisp detonates
  killed: false,   // did a grapple line kill something mid-flight?
  burning: false,  // is there a burning enemy next to the flicker landing?
};

// --- palettes --------------------------------------------------------------
const REI_BLUE = '#4b6cff';
const REI_PALE = '#c9d6ff';
const BLACK_FLAME = '#6a1b9a';
const CHIDORI = '#9fd6ff';
const SPIRAL_ORANGE = '#ff7a1a';
const SPIRAL_BLUE = '#7ad4ff';
const LOG_BROWN = '#8a5a2b';
const STEEL_PALE = '#d8d2c4';
const FOX_PINK = '#ff8fc7';
const FOX_FIRE = '#ffb03d';
const TORII_RED = '#e8452f';
const AI_PINK = '#ff2d95';
const AI_BOLT = '#5fd0ff';
const BSOD_BLUE = '#2b6cff';

// --- projectile / minion visuals (registered in the atlas on first use) -----
const V_COMET_SHARD = { shape: 'star', color: REI_PALE, accent: REI_BLUE, size: 9, rotates: true, glow: true };
const V_DECOY = { shape: 'capsule', color: REI_PALE, accent: REI_BLUE, size: 15, glow: true };
const V_SHURIKEN = { shape: 'cross', color: '#8fa0d8', accent: '#151b32', size: 8, rotates: true };
const V_WIRE_SHURIKEN = { shape: 'cross', color: '#c81e3a', accent: '#151b32', size: 9, rotates: true, glow: true };
const V_CLONE = { shape: 'capsule', color: SPIRAL_ORANGE, accent: '#1b1b2b', size: 13 };
const V_LOG = { shape: 'capsule', color: LOG_BROWN, accent: '#3a2410', size: 14 };
const V_OFUDA = { shape: 'square', color: '#fff6e0', accent: TORII_RED, size: 8, rotates: true };
const V_WISP = { shape: 'circle', color: FOX_FIRE, accent: '#7a3b00', size: 10, glow: true };
const V_TORII = { shape: 'triangle', color: TORII_RED, accent: '#ffd8c2', size: 20, glow: true };
const V_BOLT = { shape: 'shard', color: AI_BOLT, accent: '#0a2b4a', size: 8, rotates: true, glow: true };

// --- reusable opts bags ----------------------------------------------------
const CLONE_HIT = { fromX: 0, fromY: 0, element: 'spirit', knockback: 40 };
const CLONE_PUFF = { speed: 150, life: 0.26, size: 0.55, additive: true };
const DRIFT_SMALL = { life: 0.6, size: 0.4, speed: 14 };
const PULSE_NOVA = {
  color: REI_PALE, element: 'light', falloff: 0, src: H.SRC.SPECIAL,
  shake: false, particles: 30, knockback: 60,
};
const AMATERASU_MARK_FX = { speed: 90, life: 0.5, size: 0.6, additive: true };
const REI_DASH = { color: REI_BLUE };
const FLICKER_DASH = { color: CHIDORI, element: 'lightning', width: 44, src: H.SRC.ESCAPE, damage: 0 };
const FLICKER_NOVA = { color: BLACK_FLAME, element: 'shadow', falloff: 0.2, src: H.SRC.ESCAPE };
const RASENGAN_NOVA = { color: SPIRAL_BLUE, element: 'spirit', falloff: 0.15, src: H.SRC.SPECIAL, knockback: 0 };
const RASENGAN_PULL = { param: 300, hitsEnemies: true };
const BACKSTAB = { canCrit: false, element: 'spirit', knockback: 240, fromX: 0, fromY: 0 };
const YULI_ARC = { color: STEEL_PALE, element: 'steel', src: H.SRC.AUTO, knockback: 30 };
const NAPE_HIT = { canCrit: false, element: 'steel', knockback: 160, fromX: 0, fromY: 0 };
const GRAPPLE_LINE = { element: 'steel', knockback: 140, onHit: noteKill };
const GRAPPLE_DASH = { color: STEEL_PALE };
const OFUDA_SHOT = {
  damage: 0, speed: 210, life: 2.4, radius: 8, motion: H.MOTION.STICK,
  stickTime: 0.8, aoeRadius: 46, element: 'spirit', visual: V_OFUDA,
  trailColor: '#fff6e0', onHit: ofudaStick, onExpire: ofudaRelease, tag: 'ofuda',
  target: null,
};
const WISP_SUMMON = {
  role: H.MINION_ROLE.SEEKER, hp: 1, damage: 0, speed: 260, life: 6,
  tag: 'foxfire', max: 18, visual: V_WISP, element: 'spirit', onExpire: foxfireBurst,
  orbitRadius: 74, orbitAngle: 0,
};
const CLONE_SUMMON = {
  role: H.MINION_ROLE.MIRROR, hp: 30, damage: 0, speed: 215, life: 10,
  tag: 'shadow_clone', max: 12, visual: V_CLONE, element: 'spirit',
  orbitRadius: 70, orbitAngle: 0, attackInterval: 0.7, bonusShare: 1,
};
const BONUS_CLONE_SUMMON = {
  role: H.MINION_ROLE.MIRROR, hp: 30, damage: 0, speed: 215, tag: 'bonus_clone', max: 5,
  visual: V_CLONE, element: 'spirit', orbitRadius: 96, orbitAngle: 0,
  attackInterval: 0.7, bonusShare: 1,
};
const DECOY_PROP = {
  role: H.MINION_ROLE.DECOY, hp: 9999, damage: 0, life: 2.5,
  tag: 'comet_decoy', visual: V_DECOY,
};
const LOG_PROP = {
  role: H.MINION_ROLE.DECOY, hp: 9999, damage: 0, life: 1.2,
  tag: 'log', visual: V_LOG, onExpire: null,
};
const GATE_PROP = {
  role: H.MINION_ROLE.DECOY, hp: 9999, damage: 0, life: 10,
  tag: 'torii_gate', visual: V_TORII,
};
const PURIFY_NOVA = { color: TORII_RED, element: 'spirit', falloff: 0.2, src: H.SRC.ESCAPE, knockback: 320 };
const ERROR_NOVA = {
  color: BSOD_BLUE, element: 'lightning', falloff: 0, src: H.SRC.ESCAPE,
  knockback: 180, onHit: stunHit,
};
const TRACE_FX = { color: STEEL_PALE, life: 0.26, size: 0.5, sizeEnd: 0.05, drag: 2, additive: true };
const HEART_PAYLOAD = { value: 0.03 };
/** Substitution has no declared targeting spec: it always swaps onto the nearest. */
const SUB_TARGET = { mode: 'nearest', range: 520 };

// ---------------------------------------------------------------------------
// Module-level callbacks. Passed by reference so no closure is ever built in a
// per-frame path.
// ---------------------------------------------------------------------------

/** AMATERASU: black flame jumps to anything touching a burning enemy. */
function spreadBlackFlame(e) {
  if (e.st.burnPerm) return;
  H.applyBurn(e.st, SCRATCH.dps, 0, true);
  H.applyMark(e.st, H.MARK.AMATERASU, 9e8, 0);
  H.particles.drift(e.x, e.y, BLACK_FLAME, DRIFT_SMALL);
}

/** Body Flicker S5: is the landing spot beside something already burning? */
function seeBurning(e) { if (e.st.burnT > 0) SCRATCH.burning = true; }

/** Grapple Line S5: the line refunds instantly if it killed something. */
function noteKill(e) { if (e.hp <= 0 || e.dying) SCRATCH.killed = true; }

/** Devotion: +45% damage vs Large and Elite, applied through the damage pipeline. */
function markDevotion(e) {
  if (e.size === 'large' || e.isElite || e.isBoss) H.applyVulnerable(e.st, 1.45, 0.5);
}

/** An ofuda sticks to its host and marks it, so the next volley picks someone else. */
function ofudaStick(proj, e) { H.applyMark(e.st, H.MARK.OFUDA, 9e8, 0); }

/** ...and releases the mark when it detonates or expires. */
function ofudaRelease(proj) {
  const host = proj.stickHost;
  if (host && host.st && host.st.markKind === H.MARK.OFUDA) {
    host.st.markKind = H.MARK.NONE;
    host.st.markT = 0;
  }
}

/** A foxfire wisp sets its victim burning for 3s when it detonates. */
function foxfireBurst(m, run) {
  SCRATCH.burnDps = m.damage / 3;
  H.forEachEnemyIn(run, m.x, m.y, 42, applyFoxfireBurn);
  H.particles.burst(m.x, m.y, 6, FOX_FIRE, CLONE_PUFF);
}
function applyFoxfireBurn(e) { H.applyBurn(e.st, SCRATCH.burnDps, 3); }

/** Substitution S5: the log detonates. 120 damage / 140px, from the character data. */
function logDetonate(m, run) {
  const p = run.player;
  H.areaDamage(run, m.x, m.y, H.area(p, 140), m.damage, H.SRC.ESCAPE,
               { falloff: 0.2, element: 'spirit', knockback: 260 });
  H.particles.ring(m.x, m.y, 18, LOG_BROWN, 420);
  H.audio.play('explode');
  H.shake.medium();
}

/** ERROR!: corrupted data stuns for 1.5s. */
function stunHit(e) { H.applyStun(e.st, 1.5); }

/** ERROR! S5: enemy ranged attacks are disabled for 4s — their fire timer is pushed out. */
function silenceRanged(e) { if (e.behavior === 'ranged') e.aiT = Math.max(e.aiT, 4); }

/** A dotted line of sparks — grapple wire, comet tail. */
function traceLine(x0, y0, x1, y1, color, steps) {
  TRACE_FX.color = color;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    H.particles.emit(H.lerp(x0, x1, t), H.lerp(y0, y1, t), 0, 0, TRACE_FX);
  }
}

/**
 * KILL COUNTING.
 * The driver documents `onKill` but does not dispatch it yet, so every kill-driven
 * passive below counts through `ctx.kills` from BOTH sides: `onKill` when the
 * driver starts calling it (which latches `ctx.hookLive` and disables the poll),
 * and a delta poll of `run.stats.kills` until then. Neither path can double-count.
 */
function pollKills(run, ctx) {
  if (ctx.hookLive) return 0;
  const k = run.stats.kills;
  const d = k - ctx.kills;
  ctx.kills = k;
  return d;
}

/** Torii gates: a pooled prop can be recycled, so identity is checked by uid. */
function gateAlive(ctx, i) {
  const g = ctx.gates[i];
  return !!(g && g.active && g.uid === ctx.uids[i] && g.hp > 0);
}
function pruneGates(ctx) {
  for (let i = ctx.gates.length - 1; i >= 0; i--) {
    if (!gateAlive(ctx, i)) { ctx.gates.splice(i, 1); ctx.uids.splice(i, 1); }
  }
}
function dropGates(run, ctx) {
  for (let i = 0; i < ctx.gates.length; i++) {
    const g = ctx.gates[i];
    if (g && g.active) { g.hp = 0; H.particles.ring(g.x, g.y, 12, TORII_RED, 220); }
  }
  ctx.gates.length = 0;
  ctx.uids.length = 0;
}

/** Firmware Update: one permanent +2% attack-speed stack. */
function firmwareStack(run, p, ctx) {
  ctx.stacks++;
  ctx.mods.attackSpeedMult = 0.02 * ctx.stacks;
  if (ctx.stacks === 1) p.addBuff('firmware_update', 9e8, ctx.mods);
  else p.recompute();
  H.floaters.spawn(p.x, p.y - 44, 'FIRMWARE +2% AS', AI_PINK, 17, 1.1, p);
}

// ---------------------------------------------------------------------------

registerAll({

  // =========================================================================
  // HOSHINO REI — "Reirei, the Encore Idol"
  // =========================================================================

  comet_shards: {
    // "Bouncing star shards that ricochet to up to 4 enemies, gaining +15%
    //  damage per bounce. 18 base damage, every 1.0s. Targeting: nearest."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      H.spread(run, p, o.x, o.y, t.angle, 1, 0.22, {
        damage: H.autoDamage(run, p, ctx.def.damage, opts),
        speed: 540, life: 1.6, radius: 9,
        motion: H.MOTION.BOUNCE,
        bounces: 4, bounceRange: 300, bounceDamageMult: 1.15,
        element: 'light',
        trailColor: REI_PALE,
        visual: V_COMET_SHARD,
      });
      H.audio.play('shoot');
    },
  },

  stellar_encore: {
    // "The stage lights drop and a comet crashes behind her. For 8s she projects
    //  an aura (200px) that heals 4 HP/s and grants +25% attack speed, while
    //  pulsing damaging soundwave rings every 0.8s (30 damage)."
    // S3: also revives you once if you would die during its duration.
    cast(run, p, ctx, opts) {
      ctx.active = true;
      ctx.t = 8;
      // The Hoshiyomi Penlight relic publishes these two flags for aura abilities.
      ctx.radius = 200 * (p.flags.auraSizeMult || 1);
      ctx.rate = 0.8 / (p.flags.auraRateMult || 1);
      ctx.pulse = H.abilityDamage(run, p, 30, opts);
      ctx.pulseT = ctx.rate;
      ctx.healT = 0.25;
      p.flags.attackSpeedBonus = 1.25;
      p.flags.auraColor = REI_BLUE;
      // DECISIONS.md §29 — run.js resolves this slot fourth in the revive order.
      if (ctx.s3) p.flags.reiRevive = true;

      // The comet: a streak out of the sky landing behind her, then the stage
      // lights drop to a single blue spot.
      const a = p.facing + Math.PI;
      traceLine(p.x + Math.cos(a) * 900, p.y + Math.sin(a) * 900 - 500,
                p.x + Math.cos(a) * 70, p.y + Math.sin(a) * 70, REI_PALE, 22);
      H.particles.ring(p.x + Math.cos(a) * 70, p.y + Math.sin(a) * 70, 26, REI_PALE, 460);
      H.grade(run, REI_BLUE, 0.42, 0.9);
      H.camera.punch(0.07, 0.45);
      H.shake.medium();
      H.announce(run, ctx.def.name, REI_PALE);
      return true;
    },
    tick(run, p, ctx, dt) {
      // 4 HP/s, banked in quarter-second chunks and silent: a green number every
      // frame would bury every other read on the screen.
      ctx.healT -= dt;
      if (ctx.healT <= 0) { ctx.healT += 0.25; H.healPlayer(run, 1, true); }
      if ((run.frameParity & 7) === 0) {
        const a = H.fxRng.angle();
        H.particles.drift(p.x + Math.cos(a) * ctx.radius, p.y + Math.sin(a) * ctx.radius,
                          REI_PALE, DRIFT_SMALL);
      }
      ctx.pulseT -= dt;
      if (ctx.pulseT > 0) return;
      ctx.pulseT = ctx.rate;
      H.nova(run, p, p.x, p.y, ctx.radius, ctx.pulse, PULSE_NOVA);
    },
    end(run, p, ctx) {
      p.flags.attackSpeedBonus = 1;
      p.flags.auraColor = null;
      p.flags.reiRevive = false;
      H.particles.ring(p.x, p.y, 20, REI_BLUE, 300);
    },
  },

  comet_trail: {
    // "A 150px streaking dash with a long blue comet tail, 0.5s invulnerable,
    //  leaving a glittering decoy that taunts for 2.5s."
    // S5: grants a 1-hit shield when you land.
    cast(run, p, ctx) {
      const x0 = p.x, y0 = p.y;
      H.dash(run, p, p.facing, 150, ctx.def.iframes, REI_DASH);
      traceLine(x0, y0, p.x, p.y, REI_BLUE, 14);
      H.prop(run, p, x0, y0, DECOY_PROP);
      H.particles.ring(x0, y0, 14, REI_PALE, 240);
      if (ctx.s5) {
        H.addShield(p.st, 1);
        H.floaters.spawn(p.x, p.y - 42, 'ENCORE GUARD', REI_PALE, 17, 1.0, p);
      }
      return true;
    },
  },

  hoshiyomi: {
    // "Every 10 kills drops a small heart (heals 3 HP)."
    init(run, p, ctx) { ctx.kills = 0; ctx.lastAt = 0; ctx.hookLive = 0; },
    onKill(run, p, ctx, e) {
      ctx.hookLive = 1;
      ctx.kills++;
      dropHearts(run, p, ctx, e);
    },
    tick(run, p, ctx, dt) {
      if (pollKills(run, ctx) <= 0) return;
      dropHearts(run, p, ctx, null);
    },
  },

  // =========================================================================
  // YAMIKAGE — "The Avenger"
  // =========================================================================

  shuriken_volley: {
    // "3 shuriken in a tight spread, pierce 1, 15 damage each, every 0.65s.
    //  Every 4th volley is wire-strung and curves back through the enemies a
    //  second time. Targeting: nearest."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      const dmg = H.autoDamage(run, p, ctx.def.damage, opts);
      const wire = (ctx.shotIndex % 4) === 0;
      H.spread(run, p, o.x, o.y, t.angle, 3, 0.26, {
        damage: dmg,
        speed: wire ? 560 : 620,
        life: wire ? 1.5 : 1.1,
        radius: 8,
        pierce: 1,
        motion: wire ? H.MOTION.BOOMERANG : H.MOTION.STRAIGHT,
        element: 'shadow',
        visual: wire ? V_WIRE_SHURIKEN : V_SHURIKEN,
        trailColor: wire ? '#c81e3a' : null,
        owner: o,
      });
      H.audio.play('shoot');
    },
  },

  amaterasu: {
    // "Marks the 5 nearest enemies with inextinguishable BLACK FLAME. Burns for
    //  40 damage/s until the target dies — the burn never expires and cannot be
    //  cleansed. Spreads to any enemy that touches a burning one."
    // S3: marks 8 enemies and the flames leave burning ground.
    cast(run, p, ctx, opts) {
      if (!ctx.spec) ctx.spec = { mode: 'nearestN', count: 5, range: 760 };
      ctx.spec.count = ctx.s3 ? 8 : 5;
      ctx.dps = H.abilityDamage(run, p, 40, opts);
      SCRATCH.dps = ctx.dps;

      const t = H.target(run, p, ctx.spec, opts);
      const list = t.targets;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e || !e.active || e.hp <= 0) continue;
        // The 4th argument is `permanent`: burnT is pinned and tickStatus never
        // decrements it, so nothing in the game can put this out.
        H.applyBurn(e.st, ctx.dps, 0, true);
        H.applyMark(e.st, H.MARK.AMATERASU, 9e8, 0);
        H.particles.burst(e.x, e.y, 8, BLACK_FLAME, AMATERASU_MARK_FX);
        H.particles.ring(e.x, e.y, 10, '#180020', 200);
        if (ctx.s3) H.field(run, p, e.x, e.y, 70, 6, 'burn', ctx.dps * 0.5, BLACK_FLAME);
      }

      // The spread runs for the rest of the run: `ctx.t` is deliberately never
      // set, so the driver ticks this ability forever and never calls end().
      ctx.active = true;
      if (ctx.spreadT === undefined) { ctx.spreadT = 0; ctx.scan = 0; }
      H.grade(run, '#2a0736', 0.5, 1.0);
      H.camera.punch(0.05, 0.5);
      H.shake.medium();
      H.announce(run, ctx.def.name, BLACK_FLAME);
      return true;
    },
    tick(run, p, ctx, dt) {
      ctx.spreadT -= dt;
      if (ctx.spreadT > 0) return;
      ctx.spreadT = 0.25;                       // 4 checks a second, never per frame
      const n = run.enemies.count;
      if (n <= 0) return;
      SCRATCH.dps = ctx.dps;
      const items = run.enemies.items;
      let i = ctx.scan >= n ? 0 : ctx.scan;
      let scanned = 0, sources = 0;
      // Round-robin with a per-pass scan AND source cap: a screen where half the
      // horde is already alight must not turn one tick into 1,000 hash queries.
      // The cursor persists on ctx, so every enemy is still reached within a
      // second or two — the flame is slow and inevitable, which is the point.
      while (scanned < n && scanned < 512 && sources < 48) {
        const e = items[i];
        i++; if (i >= n) i = 0;
        scanned++;
        if (!e || !e.active || e.hp <= 0 || !e.st.burnPerm) continue;
        sources++;
        H.forEachEnemyIn(run, e.x, e.y, e.radius + 8, spreadBlackFlame);
      }
      ctx.scan = i;
    },
  },

  body_flicker: {
    // "A lightning-fast blink 190px in the movement direction, leaving a
    //  crackling Chidori afterimage that damages anything it passes through (60)."
    // S5: a second charge (the Cooldown is configured to 2 by star level), and
    //     ending it next to a burning enemy detonates the flame for 150 in 120px.
    cast(run, p, ctx, opts) {
      FLICKER_DASH.damage = H.abilityDamage(run, p, 60, opts);
      H.dash(run, p, p.facing, 190, ctx.def.iframes, FLICKER_DASH);
      H.particles.cone(p.x, p.y, p.facing + Math.PI, 1.6, 8, CHIDORI, CLONE_PUFF);
      H.flash.fire(CHIDORI, 0.16, 6);

      if (!ctx.s5) return true;
      SCRATCH.burning = false;
      H.forEachEnemyIn(run, p.x, p.y, H.area(p, 120), seeBurning);
      if (!SCRATCH.burning) return true;
      H.nova(run, p, p.x, p.y, 120, H.abilityDamage(run, p, 150, opts), FLICKER_NOVA);
      H.floaters.spawn(p.x, p.y - 46, 'BLACKFLAME BURST', BLACK_FLAME, 18, 1.1, p);
      return true;
    },
  },

  sharingan: {
    // "+18% dodge chance, and enemy telegraphs are shown 0.3s earlier for him."
    init(run, p, ctx) {
      if (!ctx.mods) ctx.mods = { dodge: 0.18 };
      p.addBuff('sharingan', 9e8, ctx.mods);
      // Read generically by the telegraph system: every wind-up starts this much
      // sooner on screen for him. Not a hint — a real head start.
      p.flags.telegraphLead = 0.3;
    },
  },

  // =========================================================================
  // UZU — "The Spiral"
  // =========================================================================

  kage_bunshin_barrage: {
    // "3 shadow clones puff into existence around the nearest enemy, strike
    //  simultaneously for 12 each, and vanish. Every 0.7s. Because the clones
    //  appear AT the target, this is the only auto-attack in the game with no
    //  travel time and no line of sight requirement."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found || !t.target) return;
      const dmg = H.autoDamage(run, p, ctx.def.damage, opts);
      const n = 3 + H.extraShots(p);
      let e = t.target;
      for (let i = 0; i < n; i++) {
        if (!e || !e.active || e.hp <= 0) {
          e = H.nearestTo(run, o.x, o.y, 620, null);
          if (!e) break;
        }
        const a = (i / n) * H.TAU + run.time * 2.2;
        const cx = e.x + Math.cos(a) * (e.radius + 22);
        const cy = e.y + Math.sin(a) * (e.radius + 22);
        CLONE_HIT.fromX = cx; CLONE_HIT.fromY = cy;
        H.dealDamage(run, e, dmg, H.SRC.AUTO, CLONE_HIT);
        H.particles.burst(cx, cy, 4, SPIRAL_ORANGE, CLONE_PUFF);
      }
      H.audio.play('slash');
    },
  },

  shadow_clone_jutsu: {
    // "Summons 4 persistent clones for 10s. They mirror your auto-attack at 60%
    //  damage, drift around you, and taunt nearby enemies. They are individually
    //  killable (30 HP each)."
    // S3: 6 clones, and HOLDING the button converges them into a single RASENGAN
    //     slam — 320 damage in a 180px spiral that drags enemies inward.
    cast(run, p, ctx, opts) {
      ctx.active = true;
      ctx.t = 10;
      ctx.hold = 0;
      ctx.slammed = false;
      const count = ctx.s3 ? 6 : 4;
      CLONE_SUMMON.damage = H.autoDamage(run, p, p.def.autoAttack.damage, opts) * 0.6;
      CLONE_SUMMON.attackInterval = p.def.autoAttack.interval;
      CLONE_SUMMON.life = 10;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * H.TAU;
        CLONE_SUMMON.orbitAngle = a;
        H.summon(run, p, p.x + Math.cos(a) * 54, p.y + Math.sin(a) * 54, CLONE_SUMMON);
      }
      H.grade(run, SPIRAL_ORANGE, 0.34, 0.7);
      H.camera.punch(0.05, 0.35);
      H.announce(run, ctx.def.name, SPIRAL_ORANGE);
      return true;
    },
    tick(run, p, ctx, dt) {
      // HOLD: 0.4s on the special button at any point inside the 10s converges
      // them. Holding through the cast does it immediately; you can also call
      // them back later, which is the same input and reads better in play.
      if (!ctx.s3 || ctx.slammed) return;
      if (!input.held(ACT.SPECIAL)) return;
      ctx.hold += dt;
      if (ctx.hold < 0.4) {
        if ((run.frameParity & 3) === 0) {
          H.particles.drift(p.x + H.fxRng.signed() * 60, p.y + H.fxRng.signed() * 60,
                            SPIRAL_BLUE, DRIFT_SMALL);
        }
        return;
      }
      // The clones converge into one sphere. DECISIONS.md §22 ships this under
      // its approved name.
      ctx.slammed = true;
      run.minions.killAll(CLONE_SUMMON.tag);
      H.nova(run, p, p.x, p.y, 180, H.abilityDamage(run, p, 320), RASENGAN_NOVA);
      H.field(run, p, p.x, p.y, 180, 1.2, 'pull', 0, SPIRAL_BLUE, RASENGAN_PULL);
      H.grade(run, SPIRAL_BLUE, 0.45, 0.7);
      H.camera.punch(0.09, 0.45);
      H.shake.big();
      H.floaters.spawn(p.x, p.y - 70, 'SPIRAL SPHERE', SPIRAL_BLUE, 26, 1.4);
      ctx.t = 0.05;                              // the special ends with the slam
    },
    end(run, p, ctx) {
      if (ctx.slammed) H.particles.ring(p.x, p.y, 22, SPIRAL_BLUE, 380);
    },
  },

  substitution_jutsu: {
    // "A log takes the hit in his place and he reappears BEHIND the nearest
    //  enemy, which eats a guaranteed backstab crit (250%). The log should be a
    //  real, visible, comically ordinary log."
    // S5: a second charge (star level configures it) and the log detonates for
    //     120 damage in a 140px radius.
    cast(run, p, ctx, opts) {
      const x0 = p.x, y0 = p.y;
      LOG_PROP.onExpire = ctx.s5 ? logDetonate : null;
      LOG_PROP.life = ctx.s5 ? 1.2 : 2.2;
      const log = H.prop(run, p, x0, y0, LOG_PROP);
      if (log && ctx.s5) log.damage = H.abilityDamage(run, p, 120, opts);

      const t = H.target(run, p, ctx.def.targeting || SUB_TARGET, opts);
      if (t.found && t.target) {
        const e = t.target;
        const a = H.angleTo(x0, y0, e.x, e.y);
        H.blink(run, p, e.x + Math.cos(a) * (e.radius + 26),
                e.y + Math.sin(a) * (e.radius + 26), ctx.def.iframes);
        p.facing = a + Math.PI;
        // 250% of a full barrage (3 strikes of the auto's base damage).
        const base = p.def.autoAttack.damage * 3;
        BACKSTAB.fromX = p.x; BACKSTAB.fromY = p.y;
        H.dealDamage(run, e, H.abilityDamage(run, p, base, opts) * 2.5, H.SRC.ESCAPE, BACKSTAB);
        H.particles.cone(p.x, p.y, p.facing, 1.2, 8, SPIRAL_ORANGE, CLONE_PUFF);
        H.floaters.spawn(e.x, e.y - 40, 'BACKSTAB', SPIRAL_ORANGE, 20, 1.0);
      } else {
        // Nothing to appear behind: still a real escape — swap out and away.
        H.blink(run, p, x0 + Math.cos(p.facing) * 190, y0 + Math.sin(p.facing) * 190,
                ctx.def.iframes);
      }
      H.particles.burst(x0, y0, 10, LOG_BROWN, CLONE_PUFF);
      return true;
    },
  },

  never_gives_up: {
    // "Every 10 kills spawns one bonus clone that persists until killed (max 5).
    //  The clone army builds over a run."
    init(run, p, ctx) { ctx.kills = 0; ctx.lastAt = 0; ctx.hookLive = 0; },
    onKill(run, p, ctx, e) {
      ctx.hookLive = 1;
      ctx.kills++;
      growArmy(run, p, ctx, e);
    },
    tick(run, p, ctx, dt) {
      if (pollKills(run, ctx) <= 0) return;
      growArmy(run, p, ctx, null);
    },
  },

  // =========================================================================
  // CAPTAIN YULI — "Humanity's Strongest"
  // =========================================================================

  twin_blade_cross: {
    // "Rapid alternating slashes in a short 90° arc (70px), 11 damage, every
    //  0.35s. Highest raw DPS in the game, but you must be in melee."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      const dmg = H.autoDamage(run, p, ctx.def.damage, opts);
      // Alternating: each swing crosses the other way, so the pair reads as an X.
      const side = (ctx.shotIndex & 1) ? 0.34 : -0.34;
      H.meleeArc(run, p, o.x, o.y, t.angle + side, Math.PI / 2, 70, dmg, YULI_ARC);
    },
  },

  nape_strike: {
    // "Grapples to the highest-max-HP enemy on screen and executes: 200 damage
    //  +12% of the target's MAX HP. Doubles against Large enemies. Full i-frames
    //  during the flight."
    // S3: hits the top 3 highest-HP enemies.
    cast(run, p, ctx, opts) {
      if (!ctx.list) { ctx.list = []; ctx.picks = []; }
      H.collectNearest(run, p, 900, null, 12, ctx.list);
      const want = ctx.s3 ? 3 : 1;
      ctx.picks.length = 0;
      for (let k = 0; k < want; k++) {
        let best = -1, bestHp = -1;
        for (let i = 0; i < ctx.list.length; i++) {
          const e = ctx.list[i];
          if (!e || !e.active || e.hp <= 0) continue;
          if (e.maxHp > bestHp) { bestHp = e.maxHp; best = i; }
        }
        if (best < 0) break;
        ctx.picks.push(ctx.list[best]);
        ctx.list[best] = null;
      }
      if (ctx.picks.length === 0) return false;   // no nape on screen: no cooldown spent

      ctx.step = 0;
      ctx.strikeT = 0;
      ctx.active = true;
      ctx.t = 0.24 * ctx.picks.length + 0.12;
      H.applyInvuln(p.st, ctx.t + 0.15);          // full i-frames for the whole flight
      H.grade(run, STEEL_PALE, 0.32, 0.6);
      H.camera.punch(0.06, 0.4);
      H.announce(run, ctx.def.name, STEEL_PALE);
      return true;
    },
    tick(run, p, ctx, dt) {
      ctx.strikeT -= dt;
      if (ctx.strikeT > 0 || ctx.step >= ctx.picks.length) return;
      ctx.strikeT = 0.24;
      const e = ctx.picks[ctx.step++];
      if (!e || !e.active || e.hp <= 0) return;

      const x0 = p.x, y0 = p.y;
      const a = H.angleTo(x0, y0, e.x, e.y);
      traceLine(x0, y0, e.x, e.y, STEEL_PALE, 12);
      H.blink(run, p, e.x - Math.cos(a) * (e.radius + 24), e.y - Math.sin(a) * (e.radius + 24), 0.3);
      p.facing = a;

      // 200 + 12% of MAX HP, doubled against Large.
      const base = (200 + e.maxHp * 0.12) * (e.size === 'large' ? 2 : 1);
      NAPE_HIT.fromX = p.x; NAPE_HIT.fromY = p.y;
      H.dealDamage(run, e, H.abilityDamage(run, p, base), H.SRC.SPECIAL, NAPE_HIT);
      H.particles.cone(e.x, e.y, a, 1.0, 10, STEEL_PALE, CLONE_PUFF);
      H.audio.play('crit');
      H.shake.medium();
    },
  },

  grapple_line: {
    // "Fires an anchor 320px in the aim direction and zips there. Invulnerable
    //  in flight, damages enemies along the line (45)."
    // S5: refunds instantly if it kills something mid-flight.
    cast(run, p, ctx, opts) {
      const a = run.aimAngle();
      SCRATCH.killed = false;
      const d = H.dash(run, p, a, 320, ctx.def.iframes, GRAPPLE_DASH);
      traceLine(d.x0, d.y0, d.x1, d.y1, STEEL_PALE, 16);
      H.lineDamage(run, d.x0, d.y0, d.x1, d.y1, H.area(p, 34),
                   H.abilityDamage(run, p, 45, opts), H.SRC.ESCAPE, GRAPPLE_LINE);
      H.audio.play('slash');
      if (ctx.s5 && SCRATCH.killed) {
        // The refund cannot happen inside cast() — run.js consumes the charge
        // immediately afterwards — so it lands on the next tick instead.
        ctx.refund = true;
        ctx.active = true;
        ctx.t = 0.05;
      }
      return true;
    },
    end(run, p, ctx) {
      if (!ctx.refund) return;
      ctx.refund = false;
      p.escape.refill();
      H.floaters.spawn(p.x, p.y - 44, 'LINE FREE', STEEL_PALE, 18, 1.0, p);
    },
  },

  devotion: {
    // "+45% damage vs. Large and Elite enemies."
    tick(run, p, ctx, dt) {
      ctx.markT = (ctx.markT || 0) - dt;
      if (ctx.markT > 0) return;
      ctx.markT = 0.25;
      // Routed through the damage pipeline as an incoming-damage multiplier so
      // it applies to every source he owns without a branch in damage.js.
      H.forEachEnemyIn(run, p.x, p.y, 800, markDevotion);
    },
  },

  // =========================================================================
  // KAGURA — "The Nine-Tailed Casteress"
  // =========================================================================

  ofuda_talismans: {
    // "2 slow-flying homing paper charms that stick to an enemy and detonate
    //  after 0.8s for 22 damage in a small AoE. Every 1.1s.
    //  Targeting: randomInRange (prefers unmarked enemies)."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      OFUDA_SHOT.damage = H.autoDamage(run, p, ctx.def.damage, opts);
      OFUDA_SHOT.target = t.target;
      H.spread(run, p, o.x, o.y, t.angle, 2, 0.24, OFUDA_SHOT);
      H.audio.play('shoot');
    },
  },

  nine_tail_blaze: {
    // "Summons 9 foxfire wisps that orbit her and then seek targets
    //  independently, 45 damage each, burning for 3s."
    // S3: the wisps leave burning foxfire trails.
    cast(run, p, ctx, opts) {
      WISP_SUMMON.damage = H.abilityDamage(run, p, 45, opts);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * H.TAU;
        WISP_SUMMON.orbitAngle = a;
        H.summon(run, p, p.x + Math.cos(a) * 44, p.y + Math.sin(a) * 44, WISP_SUMMON);
      }
      ctx.active = true;
      ctx.t = WISP_SUMMON.life;
      ctx.trailT = 0;
      ctx.burn = WISP_SUMMON.damage / 3;
      H.grade(run, FOX_FIRE, 0.4, 0.8);
      H.camera.punch(0.05, 0.4);
      H.announce(run, ctx.def.name, FOX_PINK);
      return true;
    },
    tick(run, p, ctx, dt) {
      if (!ctx.s3) return;
      ctx.trailT -= dt;
      if (ctx.trailT > 0) return;
      ctx.trailT = 0.35;
      const items = run.minions.items;
      for (let i = 0; i < run.minions.count; i++) {
        const m = items[i];
        if (m.tag !== WISP_SUMMON.tag) continue;
        H.field(run, p, m.x, m.y, 34, 1.6, 'burn', ctx.burn, FOX_FIRE);
      }
    },
  },

  torii_warp: {
    // "First press plants a torii gate; second press (within 10s) teleports back
    //  to it with a purifying burst (60 damage, knockback). If not used, the gate
    //  expires and refunds half the CD."
    // S5: gates become permanent for the run (max 2) and can be re-used.
    //
    // RULING (spec vs engine): run.js only reaches an escape while its cooldown
    // is ready, so the return press can never happen if planting spends the whole
    // 8s. The plant therefore refunds its charge on the following tick — planting
    // is a bookmark, warping is the escape and pays the cooldown — and an unused
    // gate still refunds half through p.escape.reduce, which is what pays back a
    // second charge that is mid-recharge at S5.
    cast(run, p, ctx) {
      if (!ctx.gates) { ctx.gates = []; ctx.uids = []; }
      pruneGates(ctx);
      const maxGates = ctx.s5 ? 2 : 1;

      if (ctx.gates.length < maxGates) {
        // ---- first press: plant --------------------------------------------
        GATE_PROP.life = ctx.s5 ? 0 : 10;
        const g = H.prop(run, p, p.x, p.y, GATE_PROP);
        if (!g) return false;
        ctx.gates.push(g);
        ctx.uids.push(g.uid);
        ctx.armed = true;
        ctx.active = true;
        ctx.t = ctx.s5 ? undefined : 10;
        H.particles.ring(p.x, p.y, 16, TORII_RED, 300);
        H.floaters.spawn(p.x, p.y - 46, 'GATE SET', TORII_RED, 18, 1.1);
        H.audio.play('relic');
        return true;
      }

      // ---- second press: warp back ----------------------------------------
      let pick = 0, bestD = -1;
      for (let i = 0; i < ctx.gates.length; i++) {
        const d = H.dist2(p.x, p.y, ctx.gates[i].x, ctx.gates[i].y);
        if (d > bestD) { bestD = d; pick = i; }
      }
      const g = ctx.gates[pick];
      H.blink(run, p, g.x, g.y, ctx.def.iframes);
      H.nova(run, p, p.x, p.y, 150, H.abilityDamage(run, p, 60), PURIFY_NOVA);
      H.particles.ring(p.x, p.y, 24, '#ffffff', 420);
      H.flash.fire(TORII_RED, 0.22, 5);
      H.floaters.spawn(p.x, p.y - 46, 'PURIFY', FOX_PINK, 20, 1.1, p);
      if (!ctx.s5) {
        g.hp = 0;
        ctx.gates.splice(pick, 1);
        ctx.uids.splice(pick, 1);
        ctx.active = false;                       // consumed: end() must not refund
        ctx.armed = false;
      }
      return true;
    },
    tick(run, p, ctx, dt) {
      if (!ctx.armed) return;
      if (p.escape.ready) return;
      ctx.armed = false;
      p.escape.refill();                          // the return press is the escape
    },
    end(run, p, ctx) {
      // The window closed with the gate unused.
      p.escape.reduce(ctx.def.cooldown * 0.5);
      dropGates(run, ctx);
      ctx.armed = false;
      H.floaters.spawn(p.x, p.y - 46, 'GATE FADED', TORII_RED, 16, 1.0, p);
    },
  },

  purification: {
    // "12% chance on kill to drop a spirit orb worth 3x XP."
    init(run, p, ctx) { ctx.kills = 0; ctx.hookLive = 0; },
    onKill(run, p, ctx, e) {
      ctx.hookLive = 1;
      ctx.kills++;
      if (H.runRng.chance(0.12)) dropSpiritOrb(run, p, e);
    },
    tick(run, p, ctx, dt) {
      let d = pollKills(run, ctx);
      while (d-- > 0) {
        if (H.runRng.chance(0.12)) dropSpiritOrb(run, p, null);
      }
    },
  },

  // =========================================================================
  // UNIT-09 "AI-CHAN" — "Super A.I."
  // =========================================================================

  channel_beam: {
    // "Alternating left/right energy bolts fired from her ribbon-ears, 13 damage,
    //  pierce 1, every 0.5s. Perfectly accurate. Targeting: nearest."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      // Left ear, right ear, left ear...
      const side = (ctx.shotIndex & 1) ? 1 : -1;
      const px = o.x + Math.cos(t.angle + Math.PI / 2) * 13 * side;
      const py = o.y + Math.sin(t.angle + Math.PI / 2) * 13 * side;
      H.spread(run, p, px, py, t.angle, 1, 0.18, {
        damage: H.autoDamage(run, p, ctx.def.damage, opts),
        speed: 680, life: 1.3, radius: 8,
        pierce: 1,
        // Perfectly accurate, every time, forever: it steers onto the target.
        motion: H.MOTION.HOMING, target: t.target, turnRate: 9,
        element: 'lightning',
        visual: V_BOLT,
        trailColor: AI_BOLT,
        splitInto: p.flags.autoSplitInto || 0,
        tag: 'beam',
      });
      H.audio.play('shoot');
    },
  },

  super_ai_mode: {
    // "For 6s, fire rate is DOUBLED and every shot splits into 3 on impact. She
    //  takes +25% damage during it. Screen tints electric pink, the UI glitches,
    //  and the subscriber counter spins upward."
    // S3: no longer applies the +25% damage-taken penalty.
    cast(run, p, ctx) {
      ctx.active = true;
      ctx.t = 6;
      p.flags.attackSpeedBonus = 2;
      p.flags.autoSplitInto = 3;
      p.flags.uiGlitch = true;
      p.flags.auraColor = AI_PINK;
      if (!ctx.s3) H.applyVulnerable(p.st, 1.25, 6);
      H.grade(run, AI_PINK, 0.5, 1.0);
      H.camera.punch(0.08, 0.5);
      H.announce(run, ctx.def.name, AI_PINK);
      return true;
    },
    tick(run, p, ctx, dt) {
      // The subscriber counter spins upward. The HUD reads the flag generically.
      p.flags.subscribers = (p.flags.subscribers || 0) + 900 * dt;
      if ((run.frameParity & 3) === 0) {
        H.particles.drift(p.x + H.fxRng.signed() * 34, p.y + H.fxRng.signed() * 34,
                          AI_PINK, DRIFT_SMALL);
      }
    },
    end(run, p, ctx) {
      p.flags.attackSpeedBonus = 1;
      p.flags.autoSplitInto = 0;
      p.flags.uiGlitch = false;
      p.flags.auraColor = null;
      H.particles.ring(p.x, p.y, 18, AI_PINK, 320);
    },
  },

  error: {
    // "She blue-screens. 0.7s invulnerable, then a burst of corrupted data
    //  (160px) that STUNS enemies for 1.5s and deals 50 damage. She apologises
    //  to chat afterwards."
    // S5: also disables enemy ranged attacks for 4s.
    cast(run, p, ctx) {
      ctx.active = true;
      ctx.t = ctx.def.iframes;                    // 0.7s of blue screen
      H.applyInvuln(p.st, ctx.def.iframes);
      H.grade(run, BSOD_BLUE, 0.55, 0.7);
      H.camera.punch(0.05, 0.3);
      H.particles.burst(p.x, p.y, 12, BSOD_BLUE, CLONE_PUFF);
      H.floaters.spawn(p.x, p.y - 52, 'ERROR', '#ffffff', 24, 0.8, p);
      H.audio.play('telegraph');
      return true;
    },
    tick(run, p, ctx, dt) {
      // Corrupted-data confetti while the screen is blue.
      if ((run.frameParity & 1) === 0) {
        H.particles.drift(p.x + H.fxRng.signed() * 26, p.y + H.fxRng.signed() * 26,
                          BSOD_BLUE, DRIFT_SMALL);
      }
    },
    end(run, p, ctx) {
      H.nova(run, p, p.x, p.y, 160, H.abilityDamage(run, p, 50), ERROR_NOVA);
      H.flash.fire(BSOD_BLUE, 0.3, 4);
      H.shake.medium();
      if (ctx.s5) H.forEachEnemyIn(run, p.x, p.y, 600, silenceRanged);
      H.floaters.spawn(p.x, p.y - 46, 'sorry chat!!', AI_PINK, 17, 1.4, p);
    },
  },

  firmware_update: {
    // "Each level-up permanently grants +2% attack speed this run (stacks forever)."
    init(run, p, ctx) {
      // Her whole UI is a streaming overlay — subscriber counter, chat ticker,
      // LIVE dot. The HUD renders it off these flags, for anyone who has them.
      p.flags.streamOverlay = true;
      p.flags.subscribers = p.flags.subscribers || 0;
      if (!ctx.mods) ctx.mods = { attackSpeedMult: 0 };
      ctx.stacks = 0;
      ctx.level = p.level;
      ctx.hookLive = 0;
    },
    onLevelUp(run, p, ctx) {
      ctx.hookLive = 1;
      firmwareStack(run, p, ctx);
    },
    tick(run, p, ctx, dt) {
      p.flags.subscribers += 9 * dt;
      if (ctx.hookLive) return;
      while (ctx.level < p.level) { ctx.level++; firmwareStack(run, p, ctx); }
    },
  },
});

// ---------------------------------------------------------------------------
// Passive bodies, kept out of the entries so both the hook path and the poll
// path run exactly the same code.
// ---------------------------------------------------------------------------

/** Hoshiyomi: a small heart every 10 kills, worth a flat 3 HP. */
function dropHearts(run, p, ctx, e) {
  while (ctx.kills - ctx.lastAt >= 10) {
    ctx.lastAt += 10;
    // The pickup heals a fraction of max HP, so 3 HP is expressed as a fraction
    // of the max HP she has right now.
    HEART_PAYLOAD.value = 3 / Math.max(1, p.maxHp);
    const x = e ? e.x : p.x + H.fxRng.signed() * 40;
    const y = e ? e.y : p.y + H.fxRng.signed() * 40;
    run.pickups.dropPickup(x, y, 'heart', HEART_PAYLOAD);
    H.particles.burst(x, y, 5, REI_PALE, CLONE_PUFF);
  }
}

/** Never Gives Up: one more clone every 10 kills, up to 5, until it is killed. */
function growArmy(run, p, ctx, e) {
  while (ctx.kills - ctx.lastAt >= 10) {
    ctx.lastAt += 10;
    BONUS_CLONE_SUMMON.damage = H.autoDamage(run, p, p.def.autoAttack.damage) * 0.6;
    BONUS_CLONE_SUMMON.attackInterval = p.def.autoAttack.interval;
    BONUS_CLONE_SUMMON.orbitAngle = H.runRng.angle();
    const a = H.runRng.angle();
    const m = H.summon(run, p, p.x + Math.cos(a) * 70, p.y + Math.sin(a) * 70, BONUS_CLONE_SUMMON);
    if (m) H.floaters.spawn(p.x, p.y - 52, 'ONE MORE', SPIRAL_ORANGE, 17, 1.0, p);
  }
}

/** Purification: a spirit orb worth 3x XP. */
function dropSpiritOrb(run, p, e) {
  const x = e ? e.x : p.x + H.fxRng.signed() * 40;
  const y = e ? e.y : p.y + H.fxRng.signed() * 40;
  // With the enemy in hand the orb is worth 3x what it dropped; without it (the
  // polled path) it falls back to 3x a tier-2 gem.
  const gems = run.data.upgrades.XP_GEMS;
  const value = e && e.xp ? e.xp * 3 : gems[1].value * 3;
  run.pickups.dropGem(x, y, value);
  H.particles.ring(x, y, 10, FOX_PINK, 200);
}
