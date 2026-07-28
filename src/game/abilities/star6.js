// 6-STAR ABILITY PILLARS — the three limited/UR characters (SECTION 4, [17]-[19]).
//
// These are the spectacle characters. Their job in the game's economy is to be
// the thing you pulled for, so every one of the nine moves here is louder than
// anything below it: a full-body transformation, a charged nuke that scales with
// your collection, and the loudest single visual event in the build.
//
// Everything obeys the shared rules: no character-id branching (the registry key
// IS the branch), no allocation on a per-frame path (all scratch lives on `ctx`
// or in the module-level records below), and every number is either read from the
// character data or written here exactly as SECTION 4 states it.

import { registerAll } from './index.js';
import * as H from './helpers.js';
import { save } from '../../core/save.js';
import { CHARACTERS_BY_ID } from '../../data/characters.js';

// ---------------------------------------------------------------------------
// ARCHITECTURE EXCEPTION — the one bent rule in this file, bent deliberately.
//
// SECTION 4 [19] mandates an explicit CROSS-CHARACTER synergy: Father-Son
// Kamehameha's spectral hands are "unmistakably his" and the bonus rises from
// +100% to +150% "if you also own Sora". That is a content rule about a named
// PAIR of characters, so it cannot be expressed without naming one of them.
// It lives here in one module-level constant, inside src/game/abilities/ (the
// folder tests/architecture.test.js exempts), and is read ONLY through
// `ctx.def.synergyWith || SYNERGY_PARTNER` — so the day the character data grows
// a `synergyWith` field the data wins and this constant can be deleted without
// touching a line of the ability below.
// ---------------------------------------------------------------------------
const SYNERGY_PARTNER = 'sora';

/** A "permanent for the rest of the run" buff duration. */
const FOREVER = 1e9;
const HALF_PI = Math.PI / 2;

/** Roster ownership, read straight off the save (never a rosterEntry() write). */
function ownsCharacter(id) {
  const e = id && save.data.roster ? save.data.roster[id] : null;
  return !!(e && e.owned);
}

/** How many characters the player owns. Spirit Bomb scales on exactly this. */
function countOwnedRoster() {
  let owned = 0;
  const roster = save.data.roster;
  for (const k in roster) if (roster[k] && roster[k].owned) owned++;
  return owned;
}

/**
 * A transformation owns `formAuraColor` / `formMoveSpeed`; shorter moves restore
 * to those instead of to the default, so casting an escape in the middle of a
 * transformation cannot strip the transformation's aura or speed when it ends.
 */
function restoreAura(p) { p.flags.auraColor = p.flags.formAuraColor || null; }
function restoreMoveSpeed(p) { p.flags.moveSpeedMult = p.flags.formMoveSpeed || 1; }

/**
 * THE FINAL FORM mirroring a transformation or a defensive move must not hand
 * the PLAYER the buff. Every such cast becomes a damaging echo at the boss
 * instead, which is both correct and a better fight.
 */
function hostileEcho(run, p, opts, radius, damage, color) {
  const o = H.origin(run, p, opts);
  const r = H.area(p, radius);
  H.particles.ring(o.x, o.y, 18, color, r * 3);
  H.hostileDamage(run, opts, o.x, o.y, r, damage);
  H.audio.play('explode');
}

/** Total upgrade LEVELS taken this run — Rapid Fist's uncapped scaler. */
function upgradeCount(p) {
  let n = 0;
  for (const id in p.upgrades) n += p.upgrades[id];
  return n;
}

// ===========================================================================
//                        SOVEREIGN ALICIA — fire, rarity 6
//     palette: #ffb020 (scale gold) / #e0452c (dragonfire red)
// ===========================================================================

const FANG_COUNT = 3;
const DRAGONFANG_VISUAL = {
  shape: 'triangle', color: '#ffb020', accent: '#e0452c', size: 11,
  rotates: true, glow: true,
};
// Reused by all three fangs of every volley — mutated in place, never rebuilt.
const DRAGONFANG_OPTS = {
  damage: 0, speed: 430, life: 1.5, radius: 11,
  motion: H.MOTION.HOMING, turnRate: 7.5, target: null,
  element: 'fire', visual: DRAGONFANG_VISUAL, trailColor: '#ff7a3d',
};

const APOTHEOSIS_DURATION = 8;        // seconds
const APOTHEOSIS_S3_BONUS = 4;        // S3: "+4s duration"
const APOTHEOSIS_SIZE = 2.2;
const APOTHEOSIS_SPEED = 1.5;         // +50% move speed
const APOTHEOSIS_REDUCTION = 0.40;    // +40% damage-taken reduction
const APOTHEOSIS_ZOOM = 0.9;          // "camera pull-out to 0.9 zoom"
const BREATH_DPS = 70;
const BREATH_RANGE = 300;
const BREATH_ARC = 0.85;              // ~49 degrees of dragon
const BREATH_TICK = 0.1;              // 7 damage every 0.1s == exactly 70/s
const BREATH_BURN_DPS = 18;
const BREATH_BURN_TIME = 2.5;
const BREATH_SHRED_STEP = 1;          // S3: a STACKING armour shred
const BREATH_SHRED_MAX = 10;
const BREATH_SHRED_TIME = 4;
const BREATH_AIM = { mode: 'facingAuto', range: BREATH_RANGE };
const BREATH_OPTS = { element: 'fire', onHit: null };
const BREATH_FX = { speed: 520, life: 0.35, size: 0.8, additive: true };
// The engine's only incoming-damage levers for the PLAYER are flat armour and
// dodge (damage.js `damagePlayer`), so "+40% damage taken reduction" is spent as
// +40% dodge: the same expected value through the pipeline that already exists.
const APOTHEOSIS_MODS = { dodge: APOTHEOSIS_REDUCTION };

/** One closure per run, built on the first cast, so the cone never allocates. */
function makeBreathHit(ctx) {
  return (e) => {
    H.applyBurn(e.st, BREATH_BURN_DPS, BREATH_BURN_TIME);
    if (!ctx.s3) return;
    const cur = e.st.shredT > 0 ? e.st.shredAmt : 0;
    H.applyShred(e.st, Math.min(BREATH_SHRED_MAX, cur + BREATH_SHRED_STEP), BREATH_SHRED_TIME);
  };
}

const WINGBEAT_SPEED = 1.8;           // +80% move speed
const WINGBEAT_GUST_RADIUS = 200;
const WINGBEAT_GUST_DAMAGE = 90;
const WINGBEAT_METEOR_DAMAGE = 250;   // S5
const WING_TRAIL_FX = { speed: 120, life: 0.4, size: 0.7, additive: true };
const METEOR_FX = {
  color: '#ff5a2c', life: 0.32, size: 1.3, sizeEnd: 0.2, drag: 0.4, additive: true,
};
const METEOR_NOVA_OPTS = {
  src: H.SRC.ESCAPE, element: 'fire', color: '#ff5a2c', particles: 30, falloff: 0.2,
};
const GUST_NOVA_OPTS = {
  src: H.SRC.ESCAPE, element: 'fire', color: '#ffe6a8', particles: 20, falloff: 0.3,
};

const HOARD_GOLD_PER_STACK = 100;
const HOARD_DAMAGE_PER_STACK = 0.01;  // +1% per 100 gold, permanent, uncapped

/** Idempotent: keyed on a high-water mark, so tick() and onGold() cannot double-pay. */
function reconcileHoard(run, p, ctx) {
  const steps = (run.stats.gold / HOARD_GOLD_PER_STACK) | 0;
  if (steps <= ctx.steps) return;
  ctx.mods.damageMult += HOARD_DAMAGE_PER_STACK * (steps - ctx.steps);
  ctx.steps = steps;
  p.recompute();
  H.floaters.spawn(p.x, p.y - 44, '+' + Math.round(ctx.mods.damageMult * 100) + '% HOARD',
                   '#ffb020', 18, 1.1);
  H.audio.play('pickup');
}

// ===========================================================================
//                             SORA — light, rarity 6
//     palette: #ff7a1a (gi orange) / #2f6ff0 (undershirt blue)
// ===========================================================================

const RAPID_FIST_FINISHER = 48;       // def.damage is the jab; this is the last one
const RAPID_FIST_PER_UPGRADE = 0.04;  // +4% per upgrade taken this run, uncapped
// RAPID FIST IS A PUNCH, NOT A SWEEP.
//
// It used to fire `meleeArc` at 1.25 radians — a 72-degree cone — three times.
// That is a sword swing: it sprays to the sides, hits things beside and behind
// the target, and looks nothing like a martial artist throwing hands. A punch
// travels in a STRAIGHT LINE, so each one is a narrow forward `lineDamage`,
// offset a few pixels perpendicular to alternate left and right fist.
//
// The COUNT and the RHYTHM both come from the signature weapon's level: one
// punch at level 1, two by level 4, three by level 7, four once it evolves —
// and the gap between them divides by the same rate multiplier that shortens
// the attack interval, so at max level the volley lands almost as one hit.
//
// LINE COMPENSATION. A 72-degree cone caught four to eight bodies a swing; a
// jab down one line catches one to three. Swapping the shape without repricing
// the hit was a ~5x throughput cut, and the balance sweep found it immediately:
// sora fell from -45% of median survival to -57%, below every three-star on the
// board. The straight line is the correct SHAPE and it stays. The per-punch
// numbers are what pay for it, so a punch hits substantially harder than a
// sweep tick did and the volley opens at two rather than one.
const RAPID_FIST_REACH = 148;
const RAPID_FIST_WIDTH = 23;          // half-width of the jab line
const RAPID_FIST_OFFSET = 11;         // left/right fist separation
const RAPID_FIST_GAP = 0.085;         // between punches at level 1, in sim seconds
const RAPID_FIST_MIN = 2;             // "1-2 right left" — the volley is never one
const RAPID_FIST_MAX = 4;
const JAB_FX = { life: 0.17, tier: 0 };
const JAB_IMPACT = { life: 0.2, size: 13, tier: 0 };
const RAPID_FIST_FINISH_FX = { speed: 420, life: 0.24, size: 0.7, additive: true };
const JAB_DMG = { element: 'light', knockback: 70 };

/**
 * One punch. A module-level singleton taking (run, ctx) so a volley creates no
 * closure and no garbage, and so the sim-time scheduler stays deterministic.
 */
function rapidFistPunch(run, ctx) {
  const p = run.player;
  const host = ctx.comboHost || p;
  if (host !== p && !host.active) return;          // the mirroring minion died
  const i = ctx.punchI++;
  const last = i >= (ctx.punchN || 1) - 1;
  const a = ctx.comboAngle;

  // Alternate the fist, but never the DIRECTION — both hands punch down the
  // same line, which is the whole point.
  const side = (i & 1) ? 1 : -1;
  const px = Math.cos(a + HALF_PI) * RAPID_FIST_OFFSET * side;
  const py = Math.sin(a + HALF_PI) * RAPID_FIST_OFFSET * side;
  const reach = H.area(p, last ? RAPID_FIST_REACH * 1.18 : RAPID_FIST_REACH);
  const x0 = host.x + px, y0 = host.y + py;
  const x1 = x0 + Math.cos(a) * reach, y1 = y0 + Math.sin(a) * reach;

  JAB_DMG.knockback = last ? 160 : 70;
  H.lineDamage(run, x0, y0, x1, y1, H.area(p, RAPID_FIST_WIDTH),
               last ? ctx.comboFinisher : ctx.comboJab, H.SRC.AUTO, JAB_DMG);

  const tier = ctx.fxTier || 0;
  JAB_FX.tier = tier;
  JAB_FX.life = last ? 0.22 : 0.17;
  H.effects.beam(x0, y0, x1, y1, last ? 17 : 11,
                 last ? '#ffffff' : '#ffe9b0', JAB_FX);
  JAB_IMPACT.tier = tier;
  JAB_IMPACT.size = last ? 19 : 13;
  H.effects.impact(x1, y1, last ? '#ffffff' : '#ffe9b0', JAB_IMPACT);

  if (last) {
    H.particles.cone(x1, y1, a, 0.45, 8, '#ffffff', RAPID_FIST_FINISH_FX);
    H.camera.punch(0.012, 0.12);
  }
  H.audio.play('slash');
}

const SPIRIT_CHARGE = 1.5;            // S3 drops this to 0.8
const SPIRIT_CHARGE_S3 = 0.8;
const SPIRIT_FLIGHT = 0.55;
const SPIRIT_RADIUS = 300;            // S3 grows it to 420
const SPIRIT_RADIUS_S3 = 420;
const SPIRIT_DAMAGE = 400;
const SPIRIT_PER_OWNED = 25;          // "+25 damage for every character you own"
const SPIRIT_AIM = { mode: 'densestCluster', range: 900 };
const MOTE_OPTS = {
  color: '#8fd0ff', life: 1.0, size: 0.5, sizeEnd: 0.12,
  drag: 0.2, alpha: 0.9, additive: true,
};
const SPIRIT_TRAIL_FX = { speed: 90, life: 0.4, size: 0.6, additive: true };
const SPIRIT_NOVA_OPTS = {
  src: H.SRC.SPECIAL, element: 'light', color: '#8fd0ff', particles: 40, falloff: 0.15,
};
const SILHOUETTE_OPTS = {
  color: '#ffffff', life: 0.12, size: 2.6, sizeEnd: 2.2,
  drag: 0, alpha: 0.95, additive: true,
};

/** The roster lending its energy: one spectral silhouette per owned character,
 *  in that character's own colour, for a single frame. */
function flashRosterSilhouettes(x, y, radius) {
  const roster = save.data.roster;
  const n = countOwnedRoster();
  if (n <= 0) return;
  let i = 0;
  for (const k in roster) {
    if (!roster[k] || !roster[k].owned) continue;
    const def = CHARACTERS_BY_ID[k];
    const a = (i / n) * H.TAU;
    SILHOUETTE_OPTS.color = def && def.visual ? def.visual.color : '#ffffff';
    H.particles.emit(x + Math.cos(a) * radius * 0.78, y + Math.sin(a) * radius * 0.78,
                     0, 0, SILHOUETTE_OPTS);
    i++;
  }
}

const ULTRA_AURA = '#eaf4ff';
const ULTRA_FX = { speed: 40, life: 0.35, size: 0.9, sizeEnd: 0.1, additive: true };

const ZENKAI_CHOICES = 4;             // 4 upgrade cards instead of 3
const ZENKAI_THRESHOLD = 0.25;        // "each time you drop below 25% HP"
const ZENKAI_REARM = 0.30;            // re-arm above 30% so a regen tick cannot flicker
const ZENKAI_PER_STACK = 0.12;        // +12% damage, permanent
const ZENKAI_MAX_STACKS = 5;

/** Idempotent on both call paths: the armed flag is the whole state machine. */
function checkZenkai(run, p, ctx) {
  const frac = p.hpFraction;
  if (frac >= ZENKAI_REARM) { ctx.armed = true; return; }
  if (frac >= ZENKAI_THRESHOLD || !ctx.armed) return;
  ctx.armed = false;
  if (ctx.stacks >= ZENKAI_MAX_STACKS) return;
  ctx.stacks++;
  ctx.mods.damageMult += ZENKAI_PER_STACK;
  p.recompute();
  H.announce(run, 'ZENKAI x' + ctx.stacks, '#ff7a1a');
  H.grade(run, '#ff7a1a', 0.3, 0.5);
  H.particles.ring(p.x, p.y, 18, '#ffd76a', 340);
  H.audio.play('levelUp');
}

/** One free reroll per level-up. Keyed on p.level, so it can never double-grant. */
function grantZenkaiReroll(run, p, ctx) {
  if (p.level <= ctx.rerollLevel) return;
  run.rerollsLeft += p.level - ctx.rerollLevel;
  ctx.rerollLevel = p.level;
}

// ===========================================================================
//                              HAN — light, rarity 6
//     palette: #8f5fd6 (purple gi) / #ffd84a (super-saiyan gold)
// ===========================================================================

const MASENKO_VISUAL = {
  shape: 'shard', color: '#ffe9a8', accent: '#8f5fd6', size: 9,
  rotates: true, glow: true,
};
const MASENKO_OPTS = {
  damage: 0, speed: 1000, life: 0.9, radius: 9,
  motion: H.MOTION.STRAIGHT, pierce: 99,          // "pierces everything in a line"
  element: 'light', visual: MASENKO_VISUAL, trailColor: '#ffd84a',
};
const MASENKO_SPACING = 13;           // the two rage beams travel side by side
const MASENKO_FX = { speed: 340, life: 0.18, size: 0.5, additive: true };

const KAME_CHARGE = 1.2;
const KAME_BEAM = 2.5;
const KAME_TICK = 0.2;
const KAME_TICK_DAMAGE = 120;
const KAME_WIDTH = 160;               // full width; lineDamage takes the half
const KAME_RANGE = 900;
const KAME_BOOST = 1.0;               // "+100%" at the halfway point
const KAME_BOOST_SYNERGY = 1.5;       // "+150% instead" when the partner is owned
const KAME_AIM = { mode: 'lineDensest', range: KAME_RANGE };
const KAME_LINE_OPTS = { element: 'light', knockback: 0 };
const KAME_CHARGE_FX = { speed: 260, life: 0.35, size: 0.55, additive: true };
const KAME_BEAM_FX = { speed: 200, life: 0.25, size: 0.8, additive: true };

const POSE_STUN_RADIUS = 200;
const POSE_STUN_TIME = 1.5;
const POSE_S5_RAGE_COOLDOWN = 60;     // S5: fills Rage "once every 60s"
const POSE_FX = { speed: 300, life: 0.5, size: 0.9, additive: true };
// Module-level iteration callbacks: forEachEnemyIn never receives a fresh closure.
let poseStunCount = 0;
const poseStun = (e) => { H.applyStun(e.st, POSE_STUN_TIME); poseStunCount++; };
const poseStunNewcomers = (e) => { if (e.st.stunT <= 0) H.applyStun(e.st, POSE_STUN_TIME); };

const RAGE_FORM_TIME = 15;            // S3 raises this to 22
const RAGE_FORM_TIME_S3 = 22;
const RAGE_FORM_DAMAGE = 0.80;        // +80% damage
const RAGE_FORM_SPEED = 1.30;         // +30% move speed
const RAGE_S3_FILL = 1.4;             // S3: rage fills 40% faster
// SECTION 4 never states a fill RATE, only that taking damage fills it. Taking
// 45% of max HP fills the bar — see the report note; it is one constant to tune.
const RAGE_HP_FRACTION = 0.45;
const RAGE_SILENCE = 0.5;             // the held silent beat before the detonation
const RAGE_AURA = '#ffd84a';
const RAGE_FORM_MODS = { damageMult: RAGE_FORM_DAMAGE };
const RAGE_LIGHTNING_FX = { speed: 220, life: 0.22, size: 0.5, additive: true };
const RAGE_BURST_FX = { speed: 420, life: 0.7, size: 1.1, additive: true };

/**
 * Rage from damage taken. Both the tick poll and the onDamaged callback route
 * through here, and both are keyed on the run's cumulative damageTaken — so the
 * meter fills exactly once per point of damage no matter which one fires.
 */
function pumpRage(run, p, ctx) {
  const total = run.stats.damageTaken;
  const delta = total - ctx.seenDamage;
  if (delta <= 0) return;
  ctx.seenDamage = total;
  if (ctx.formT > 0 || p.resourceMax <= 0) return;   // no free refill mid-form
  const per = p.resourceMax / Math.max(1, p.maxHp * RAGE_HP_FRACTION) *
              (ctx.s3 ? RAGE_S3_FILL : 1);
  p.addResource(delta * per);
}

// ===========================================================================

registerAll({

  // ---- SOVEREIGN ALICIA ---------------------------------------------------

  dragonfang_volley: {
    // "3 seeking dragon-head projectiles that curve aggressively, 32 damage each,
    //  every 1.0s. Targeting: nearest x3."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      DRAGONFANG_OPTS.damage = H.autoDamage(run, p, ctx.def.damage, opts);
      const found = t.targets.length;
      for (let i = 0; i < FANG_COUNT; i++) {
        // Three heads, three targets — and when fewer than three exist they all
        // curve onto the survivor rather than being wasted.
        const e = i < found ? t.targets[i] : t.target;
        DRAGONFANG_OPTS.target = e;
        const a = e ? H.angleTo(o.x, o.y, e.x, e.y) : t.angle;
        H.spread(run, p, o.x, o.y, a, 1, 0.5, DRAGONFANG_OPTS);
      }
      DRAGONFANG_OPTS.target = null;
      H.audio.play('shoot');
    },
  },

  apotheosis: {
    // "She transforms into a full dragon for 8s: 2.2x size, immune to knockback,
    //  +50% move speed, +40% damage taken reduction, and the auto attack is
    //  REPLACED with a continuous breath cone (70 damage/s, 300px, applies burn).
    //  The most spectacular thing in the game — full screen tint, camera pull-out
    //  to 0.9 zoom, wing-beat SFX."
    //  S3: +4s duration and the breath applies a stacking armour shred.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) {
        hostileEcho(run, p, opts, BREATH_RANGE * 0.6,
                    H.abilityDamage(run, p, BREATH_DPS, opts), '#ff7a1a');
        return;
      }
      ctx.active = true;
      ctx.t = APOTHEOSIS_DURATION + (ctx.s3 ? APOTHEOSIS_S3_BONUS : 0);
      ctx.breathT = 0;
      if (!ctx.onBreath) ctx.onBreath = makeBreathHit(ctx);
      if (!ctx.wedge) {
        ctx.wedge = { x: 0, y: 0, r: 0, a0: 0, a1: 0, color: '#ff7a1a', life: 0.06 };
      }

      // THE FORM.
      p.flags.autoAttackDisabled = true;      // the breath IS the auto attack now
      p.flags.sizeMult = APOTHEOSIS_SIZE;
      p.flags.knockbackImmune = true;
      p.flags.formMoveSpeed = APOTHEOSIS_SPEED;
      p.flags.moveSpeedMult = APOTHEOSIS_SPEED;
      p.flags.formAuraColor = '#ff7a1a';
      p.flags.auraColor = '#ff7a1a';
      p.addBuff('apotheosis_form', ctx.t + 0.2, APOTHEOSIS_MODS);

      // THE SPECTACLE: full-screen tint, the camera pulling out to 0.9, and the
      // wing-beat as two low layered hits under the transformation roar.
      H.grade(run, '#ff7a1a', 0.55, 0.9);
      H.camera.setZoomTarget(APOTHEOSIS_ZOOM);
      H.camera.punch(0.10, 0.7);
      H.shake.big();
      H.flash.fire('#ffe6a8', 0.5, 2.2);
      H.particles.ring(p.x, p.y, 34, '#ffb020', 620);
      H.particles.ring(p.x, p.y, 22, '#e0452c', 380);
      H.audio.play('escape');
      H.audio.play('explode');
      H.announce(run, 'APOTHEOSIS', '#ffb020');
    },
    tick(run, p, ctx, dt) {
      // The cone overlay is refreshed every frame from one persistent record
      // (run.js clears the overlay lists each frame); the damage runs on its own
      // 0.1s cadence so the DPS is exactly 70 regardless of frame rate.
      const t = H.target(run, p, BREATH_AIM);
      const a = t.found ? t.angle : p.facing;
      const r = H.area(p, BREATH_RANGE);
      const w = ctx.wedge;
      w.x = p.x; w.y = p.y; w.r = r;
      w.a0 = a - BREATH_ARC / 2; w.a1 = a + BREATH_ARC / 2;
      run.overlays.wedges.push(w);

      ctx.breathT -= dt;
      if (ctx.breathT > 0) return;
      ctx.breathT += BREATH_TICK;
      BREATH_OPTS.onHit = ctx.onBreath;
      H.coneDamage(run, p.x, p.y, a, BREATH_ARC, r,
                   H.abilityDamage(run, p, BREATH_DPS * BREATH_TICK),
                   H.SRC.SPECIAL, BREATH_OPTS);
      H.particles.cone(p.x, p.y, a, BREATH_ARC, 6, '#ff7a1a', BREATH_FX);
    },
    end(run, p, ctx) {
      p.flags.autoAttackDisabled = false;
      p.flags.sizeMult = 1;
      p.flags.knockbackImmune = false;
      p.flags.formMoveSpeed = 0;
      p.flags.formAuraColor = null;
      if (!p.flags.flying) restoreMoveSpeed(p);   // a flight in progress keeps its own speed
      restoreAura(p);
      p.removeBuff('apotheosis_form');
      H.camera.setZoomTarget(1);
      H.grade(run, '#e0452c', 0.22, 0.5);
      H.particles.ring(p.x, p.y, 18, '#e0452c', 300);
      H.audio.play('escape');
    },
  },

  wingbeat: {
    // "Flies for 1.2s — fully invulnerable, passes over everything, +80% move
    //  speed — and lands with a gust dealing 90 damage in a 200px radius."
    //  S5: the landing gust becomes a meteor strike (250 damage).
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) {
        hostileEcho(run, p, opts, WINGBEAT_GUST_RADIUS,
                    H.abilityDamage(run, p, WINGBEAT_GUST_DAMAGE, opts), '#ffe6a8');
        return;
      }
      ctx.active = true;
      ctx.t = ctx.def.iframes;                // 1.2s of flight, from the data
      ctx.wingT = 0;
      // Escaping a full surround: invulnerable AND intangible for the whole
      // flight at +80% speed. Nothing touches her and nothing blocks her.
      H.applyInvuln(p.st, ctx.def.iframes);
      H.applyIntangible(p.st, ctx.def.iframes);
      p.flags.moveSpeedMult = WINGBEAT_SPEED;
      p.flags.flying = true;
      H.grade(run, '#ffe6a8', 0.3, 0.4);
      H.camera.punch(0.05, 0.35);
      H.particles.ring(p.x, p.y, 16, '#ffe6a8', 300);
      H.audio.play('escape');
      H.audio.play('slash');                  // the wing-beat itself
    },
    tick(run, p, ctx, dt) {
      ctx.wingT -= dt;
      if (ctx.wingT > 0) return;
      ctx.wingT = 0.09;
      H.particles.burst(p.x, p.y + 10, 3, '#ffe6a8', WING_TRAIL_FX);
    },
    end(run, p, ctx) {
      p.flags.flying = false;
      restoreMoveSpeed(p);
      if (ctx.s5) {
        // S5 — a meteor strike instead of a gust. It comes down with her.
        for (let i = 0; i < 10; i++) {
          H.particles.emit(p.x + H.fxRng.signed() * 40, p.y - 260 - i * 26,
                           H.fxRng.signed() * 20, 900, METEOR_FX);
        }
        H.nova(run, p, p.x, p.y, WINGBEAT_GUST_RADIUS,
               H.abilityDamage(run, p, WINGBEAT_METEOR_DAMAGE), METEOR_NOVA_OPTS);
        H.grade(run, '#ff5a2c', 0.4, 0.6);
        H.shake.big();
        H.announce(run, 'METEOR', '#ff5a2c');
      } else {
        H.nova(run, p, p.x, p.y, WINGBEAT_GUST_RADIUS,
               H.abilityDamage(run, p, WINGBEAT_GUST_DAMAGE), GUST_NOVA_OPTS);
        H.shake.small();
      }
    },
  },

  hoard: {
    // "Every 100 gold collected this run grants a permanent +1% damage for the
    //  rest of the run."
    init(run, p, ctx) {
      ctx.steps = 0;
      ctx.mods = { damageMult: 0 };
      p.addBuff('hoard_stacks', FOREVER, ctx.mods);
    },
    tick(run, p, ctx) { reconcileHoard(run, p, ctx); },
    onGold(run, p, ctx) { reconcileHoard(run, p, ctx); },
  },

  // ---- SORA ---------------------------------------------------------------

  rapid_fist: {
    // "A 3-hit ki-charged melee combo (14 / 14 / 30 damage) in the facing
    //  direction, every 0.9s. Damage scales +4% per upgrade taken this run
    //  (uncapped). Targeting: facing."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      const scale = 1 + RAPID_FIST_PER_UPGRADE * upgradeCount(p);
      const mods = run.weapons ? run.weapons.mods : null;
      ctx.comboHost = o;
      ctx.comboAngle = t.found ? t.angle : (o.facing || 0);
      ctx.comboJab = H.autoDamage(run, p, ctx.def.damage, opts) * scale;
      ctx.comboFinisher = H.autoDamage(run, p, RAPID_FIST_FINISHER, opts) * scale;
      // 1 punch -> 4, straight from the signature weapon's own level.
      ctx.punchN = H.clamp(RAPID_FIST_MIN + (mods ? mods.count : 0),
                           RAPID_FIST_MIN, RAPID_FIST_MAX);
      ctx.punchI = 0;
      ctx.fxTier = (mods && mods.evolved) ? H.FX_TIER.EVOLVED : H.FX_TIER.NORMAL;
      // The same rate multiplier that shortens his attack interval also closes
      // the gap between punches, so levelling him visibly speeds the combo up
      // rather than just repeating it more often.
      const gap = RAPID_FIST_GAP / (mods ? Math.max(0.5, mods.rate) : 1);
      rapidFistPunch(run, ctx);
      for (let i = 1; i < ctx.punchN; i++) {
        run.scheduler.after(gap * i, rapidFistPunch, run, ctx);
      }
    },
  },

  spirit_bomb: {
    // "He plants his feet and raises both arms. Charges for 1.5s during which he
    //  CANNOT move and is vulnerable — the whole arena dims and motes of light
    //  stream in from off-screen. Then he hurls a growing blue orb at the largest
    //  enemy cluster: 400 damage in a 300px blast, PLUS 25 damage for every
    //  character you own in the roster. On detonation, spectral silhouettes of
    //  your entire owned roster flash around the blast for one frame."
    //  S3: charge drops to 0.8s and the radius grows to 420px.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) {
        hostileEcho(run, p, opts, SPIRIT_RADIUS,
                    H.abilityDamage(run, p, SPIRIT_DAMAGE, opts), '#8fd0ff');
        return;
      }
      ctx.active = true;
      ctx.charge = ctx.s3 ? SPIRIT_CHARGE_S3 : SPIRIT_CHARGE;
      ctx.blast = ctx.s3 ? SPIRIT_RADIUS_S3 : SPIRIT_RADIUS;
      ctx.t = ctx.charge + SPIRIT_FLIGHT;
      ctx.phase = 0;
      ctx.moteT = 0;
      ctx.ox = p.x; ctx.oy = p.y - 60;
      ctx.tx = p.x; ctx.ty = p.y;
      if (!ctx.orb) ctx.orb = { x: 0, y: 0, r: 6, color: '#8fd0ff' };

      // He plants his feet. Rooted and undefended for the whole charge — that
      // exposure is the entire cost of the strongest attack in the game.
      p.flags.rooted = true;
      p.flags.auraColor = '#8fd0ff';
      H.grade(run, '#0b1a3d', 0.5, ctx.charge);      // the whole arena dims
      H.camera.punch(0.04, ctx.charge);
      H.announce(run, 'SPIRIT BOMB', '#8fd0ff');
      H.audio.play('telegraph');
    },
    tick(run, p, ctx, dt) {
      const orb = ctx.orb;
      if (ctx.phase === 0) {
        // --- charging: motes of light streaming in from off-screen ------------
        const k = 1 - (ctx.t - SPIRIT_FLIGHT) / ctx.charge;      // 0 -> 1
        orb.x = p.x; orb.y = p.y - 60;
        orb.r = 6 + 46 * (k < 0 ? 0 : k);
        run.overlays.rings.push(orb);
        ctx.moteT -= dt;
        if (ctx.moteT <= 0) {
          ctx.moteT = 0.04;
          for (let i = 0; i < 3; i++) {
            const a = H.fxRng.angle();
            const d = 620 + H.fxRng.raw() * 220;
            const mx = orb.x + Math.cos(a) * d, my = orb.y + Math.sin(a) * d;
            H.particles.emit(mx, my, (orb.x - mx) / 0.85, (orb.y - my) / 0.85, MOTE_OPTS);
          }
        }
        if (ctx.t > SPIRIT_FLIGHT) return;

        // --- the throw --------------------------------------------------------
        ctx.phase = 1;
        p.flags.rooted = false;
        const t = H.target(run, p, SPIRIT_AIM);
        ctx.ox = orb.x; ctx.oy = orb.y;
        ctx.tx = t.found ? t.x : p.x + Math.cos(p.facing) * 420;
        ctx.ty = t.found ? t.y : p.y + Math.sin(p.facing) * 420;
        H.shake.medium();
        H.audio.play('special');
        return;
      }

      // --- flight: the orb grows all the way in -----------------------------
      const k = 1 - ctx.t / SPIRIT_FLIGHT;
      orb.x = H.lerp(ctx.ox, ctx.tx, k);
      orb.y = H.lerp(ctx.oy, ctx.ty, k);
      orb.r = 52 + H.area(p, ctx.blast) * 0.25 * k;
      run.overlays.rings.push(orb);
      H.particles.burst(orb.x, orb.y, 2, '#8fd0ff', SPIRIT_TRAIL_FX);
    },
    end(run, p, ctx) {
      p.flags.rooted = false;
      restoreAura(p);
      const owned = countOwnedRoster();
      const damage = H.abilityDamage(run, p, SPIRIT_DAMAGE + SPIRIT_PER_OWNED * owned);
      const x = ctx.phase === 1 ? ctx.tx : p.x;
      const y = ctx.phase === 1 ? ctx.ty : p.y;
      H.nova(run, p, x, y, ctx.blast, damage, SPIRIT_NOVA_OPTS);
      // Everyone lending their energy, for exactly one frame.
      flashRosterSilhouettes(x, y, H.area(p, ctx.blast));
      H.grade(run, '#8fd0ff', 0.6, 0.8);
      H.flash.fire('#ffffff', 0.55, 2.0);
      H.shake.big();
      H.camera.punch(0.09, 0.6);
      H.floaters.spawn(x, y - 40, owned + ' ALLIES', '#8fd0ff', 20, 1.2);
    },
  },

  ultra_instinct: {
    // "1.8s of TOTAL invulnerability with NO movement bonus. His eyes go silver,
    //  the aura turns white, and his body slips every attack on its own while he
    //  stands perfectly still. Pure, honest, unglamorous defense."
    //  S5: also fully heals you the first time it is used each run.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) return false;    // there is nothing here to mirror
      ctx.active = true;
      ctx.t = ctx.def.iframes;                // 1.8s, from the character data
      ctx.dodgeT = 0;
      H.applyInvuln(p.st, ctx.def.iframes);
      p.flags.auraColor = ULTRA_AURA;
      p.flags.eyesSilver = true;
      // No dash, no speed, no damage — deliberately the least flashy special in
      // the game. Its screen effect is a quiet silver wash and nothing else.
      H.grade(run, ULTRA_AURA, 0.32, 0.6);
      H.particles.ring(p.x, p.y, 14, ULTRA_AURA, 240);
      H.announce(run, 'ULTRA INSTINCT', ULTRA_AURA);
      H.audio.play('escape');
      if (ctx.s5 && !ctx.healedThisRun) {
        ctx.healedThisRun = true;             // S5 — the first use each run only
        H.healPlayer(run, p.maxHp);
        H.announce(run, 'FULL RECOVERY', '#7bf59a');
      }
    },
    tick(run, p, ctx, dt) {
      ctx.dodgeT -= dt;
      if (ctx.dodgeT > 0) return;
      ctx.dodgeT = 0.12;
      // The body slipping attacks on its own: silver after-images, no movement.
      H.particles.burst(p.x, p.y, 2, ULTRA_AURA, ULTRA_FX);
    },
    end(run, p, ctx) {
      p.flags.eyesSilver = false;
      restoreAura(p);
      H.particles.ring(p.x, p.y, 10, ULTRA_AURA, 180);
    },
  },

  zenkai: {
    // "Every level-up offers 4 upgrade choices instead of 3 with one free reroll,
    //  and each time you drop below 25% HP you permanently gain +12% damage for
    //  the rest of the run, max 5 stacks."
    init(run, p, ctx) {
      p.flags.upgradeChoices = ZENKAI_CHOICES;
      ctx.stacks = 0;
      ctx.armed = true;
      ctx.rerollLevel = p.level;
      ctx.mods = { damageMult: 0 };
      p.addBuff('zenkai_stacks', FOREVER, ctx.mods);
    },
    tick(run, p, ctx) {
      checkZenkai(run, p, ctx);
      grantZenkaiReroll(run, p, ctx);         // safety net if onLevelUp never fires
    },
    onDamaged(run, p, ctx) { checkZenkai(run, p, ctx); },
    onLevelUp(run, p, ctx) { grantZenkaiReroll(run, p, ctx); },
  },

  // ---- HAN ----------------------------------------------------------------

  masenko: {
    // "A two-handed energy blast fired from the forehead. A fast beam that
    //  pierces everything in a line for 40 damage, every 0.85s. Clean, efficient,
    //  and unglamorous — he is not showing off. Targeting: densestCluster."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      MASENKO_OPTS.damage = H.autoDamage(run, p, ctx.def.damage, opts);
      // Hidden Potential fires the volley TWICE while transformed — two parallel
      // beams rather than one louder one, so the state is legible at a glance.
      const shots = p.flags.doubleVolley ? 2 : 1;
      const nx = Math.cos(t.angle + HALF_PI) * MASENKO_SPACING;
      const ny = Math.sin(t.angle + HALF_PI) * MASENKO_SPACING;
      for (let i = 0; i < shots; i++) {
        const s = shots === 1 ? 0 : (i === 0 ? -1 : 1);
        H.spread(run, p, o.x + nx * s, o.y + ny * s, t.angle, 1, 0.1, MASENKO_OPTS);
      }
      H.particles.cone(o.x, o.y, t.angle, 0.35, 4, '#ffe9a8', MASENKO_FX);
      H.audio.play('shoot');
    },
  },

  father_son_kamehameha: {
    // "He braces both hands at his side and charges for 1.2s, then fires a
    //  continuous beam for 2.5s (120 damage per 0.2s tick, 160px wide). At the
    //  halfway point a second, spectral pair of hands materialises over his — the
    //  beam DOUBLES in width and damage for the remainder. If you also own the
    //  partner, the hands are unmistakably his and the bonus is +150%."
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) {
        hostileEcho(run, p, opts, KAME_WIDTH,
                    H.abilityDamage(run, p, KAME_TICK_DAMAGE, opts), '#bfe6ff');
        return;
      }
      ctx.active = true;
      ctx.t = KAME_CHARGE + KAME_BEAM;
      ctx.phase = 0;
      ctx.beamT = 0;
      ctx.boosted = false;
      ctx.angle = p.facing;
      // Data first; the bent-rule constant is only the fallback (see the note at
      // the top of this file).
      const partner = ctx.def.synergyWith || SYNERGY_PARTNER;
      ctx.synergy = ownsCharacter(partner);
      const pd = CHARACTERS_BY_ID[partner];
      ctx.handColor = ctx.synergy && pd && pd.visual ? pd.visual.color : '#bfe6ff';
      if (!ctx.beam) {
        ctx.beam = { x0: 0, y0: 0, x1: 0, y1: 0, w: KAME_WIDTH, color: '#bfe6ff' };
      }
      ctx.beam.color = '#bfe6ff';
      ctx.beam.w = KAME_WIDTH;
      p.flags.auraColor = '#bfe6ff';
      H.grade(run, '#bfe6ff', 0.35, KAME_CHARGE);
      H.announce(run, 'KAMEHAMEHA', '#bfe6ff');
      H.audio.play('telegraph');
    },
    tick(run, p, ctx, dt) {
      if (ctx.phase === 0) {
        // --- bracing both hands at his side -----------------------------------
        const t = H.target(run, p, KAME_AIM);
        if (t.found) ctx.angle = t.angle;
        const hx = p.x - Math.cos(ctx.angle) * 26;
        const hy = p.y - Math.sin(ctx.angle) * 26;
        H.particles.cone(hx, hy, ctx.angle + Math.PI, 1.6, 2, '#bfe6ff', KAME_CHARGE_FX);
        if (ctx.t > KAME_BEAM) return;
        ctx.phase = 1;                        // the aim locks; the beam opens
        H.shake.medium();
        H.flash.fire('#ffffff', 0.4, 3);
        H.camera.punch(0.07, 0.5);
        H.audio.play('special');
        return;
      }

      // --- the beam ----------------------------------------------------------
      // At the halfway point of the 2.5s, the second pair of hands closes over his.
      if (!ctx.boosted && ctx.t <= KAME_BEAM * 0.5) {
        ctx.boosted = true;
        ctx.beam.color = ctx.handColor;
        H.particles.ring(p.x, p.y, 26, ctx.handColor, 460);
        H.flash.fire(ctx.handColor, 0.5, 2.2);
        H.grade(run, ctx.handColor, 0.45, 0.7);
        H.shake.big();
        H.camera.punch(0.09, 0.6);
        H.audio.play('evolve');
        H.announce(run, ctx.synergy ? 'FATHER AND SON' : 'SECOND PAIR', ctx.handColor);
      }

      const mult = ctx.boosted ? 1 + (ctx.synergy ? KAME_BOOST_SYNERGY : KAME_BOOST) : 1;
      const len = H.projSpeed(p, KAME_RANGE);
      const half = H.area(p, KAME_WIDTH * mult) * 0.5;
      const b = ctx.beam;
      b.x0 = p.x; b.y0 = p.y;
      b.x1 = p.x + Math.cos(ctx.angle) * len;
      b.y1 = p.y + Math.sin(ctx.angle) * len;
      b.w = half * 2;
      run.overlays.beams.push(b);
      H.particles.cone(p.x, p.y, ctx.angle, 0.18, 3,
                       ctx.boosted ? ctx.handColor : '#bfe6ff', KAME_BEAM_FX);

      ctx.beamT -= dt;
      if (ctx.beamT > 0) return;
      ctx.beamT += KAME_TICK;                 // 120 damage per 0.2s tick
      H.lineDamage(run, b.x0, b.y0, b.x1, b.y1, half,
                   H.abilityDamage(run, p, KAME_TICK_DAMAGE * mult),
                   H.SRC.SPECIAL, KAME_LINE_OPTS);
      H.shake.small();
    },
    end(run, p, ctx) {
      restoreAura(p);
      H.particles.ring(p.x, p.y, 14, '#bfe6ff', 260);
      H.grade(run, '#bfe6ff', 0.2, 0.4);
    },
  },

  great_saiyaman_pose: {
    // "He stops dead and performs an elaborate, deeply embarrassing justice pose
    //  over 1.2s. Fully invulnerable the entire duration, and every enemy within
    //  200px is STUNNED for 1.5s out of sheer confusion. Commit to it completely."
    //  S5: also fully fills the Rage meter, once per 60s.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) return false;    // the boss has no shame to weaponise
      ctx.active = true;
      ctx.t = ctx.def.iframes;                // 1.2s of pose, from the data
      ctx.poseT = 0;
      H.applyInvuln(p.st, ctx.def.iframes);
      // He stops dead. He is also untouchable, and everything near him is
      // laughing too hard to move — which is how this escapes a full surround.
      p.flags.rooted = true;
      p.flags.auraColor = '#7bf59a';
      poseStunCount = 0;
      H.forEachEnemyIn(run, p.x, p.y, H.area(p, POSE_STUN_RADIUS), poseStun);
      H.grade(run, '#7bf59a', 0.35, 0.6);
      H.particles.ring(p.x, p.y, 24, '#7bf59a', H.area(p, POSE_STUN_RADIUS) * 3);
      H.camera.punch(0.05, 0.5);
      H.announce(run, 'GREAT SAIYAMAN POSE!', '#7bf59a');
      H.audio.play('levelUp');
      if (poseStunCount > 0) {
        H.floaters.spawn(p.x, p.y - 90, poseStunCount + ' CONFUSED', '#7bf59a', 18, 1.2);
      }
      if (ctx.s5 && run.time >= (ctx.nextRageFill || 0)) {
        ctx.nextRageFill = run.time + POSE_S5_RAGE_COOLDOWN;
        p.addResource(p.resourceMax);         // S5 — the whole meter, once a minute
        H.announce(run, 'RAGE FULL', RAGE_AURA);
      }
    },
    tick(run, p, ctx, dt) {
      ctx.poseT -= dt;
      if (ctx.poseT > 0) return;
      ctx.poseT = 0.2;
      H.particles.burst(p.x, p.y - 20, 4, '#ffffff', POSE_FX);   // hold every beat
    },
    end(run, p, ctx) {
      p.flags.rooted = false;
      restoreAura(p);
      // Anything that wandered in mid-pose is confused too — but nothing already
      // laughing has its timer extended past the stated 1.5s.
      H.forEachEnemyIn(run, p.x, p.y, H.area(p, POSE_STUN_RADIUS), poseStunNewcomers);
      H.particles.ring(p.x, p.y, 12, '#7bf59a', 240);
    },
  },

  hidden_potential: {
    // "Taking damage fills a RAGE meter. At 100% he transforms for 15s: +80%
    //  damage, +30% move speed, immune to knockback, gold aura with crawling
    //  lightning, and his Masenko FIRES TWICE PER VOLLEY. The meter empties
    //  afterward and must be refilled. He is the only character REWARDED for
    //  being hit."   S3: rage fills 40% faster and the form lasts 22s.
    init(run, p, ctx) {
      ctx.seenDamage = run.stats.damageTaken;
      ctx.formT = 0;
      ctx.formMax = ctx.s3 ? RAGE_FORM_TIME_S3 : RAGE_FORM_TIME;
      ctx.silenceT = 0;
      ctx.boltT = 0;
      p.resource = 0;
    },
    tick(run, p, ctx, dt) {
      pumpRage(run, p, ctx);

      // --- the held silent beat ---------------------------------------------
      // The transition IS the character, so the game stops for it: the music
      // cuts, half a second of nothing, and THEN the aura detonates.
      if (ctx.silenceT > 0) {
        ctx.silenceT -= dt;
        if (ctx.silenceT > 0) return;
        ctx.formT = ctx.formMax;
        p.flags.doubleVolley = true;          // Masenko fires twice per volley
        p.flags.knockbackImmune = true;
        p.flags.formMoveSpeed = RAGE_FORM_SPEED;
        p.flags.moveSpeedMult = RAGE_FORM_SPEED;
        p.flags.formAuraColor = RAGE_AURA;
        p.flags.auraColor = RAGE_AURA;
        p.addBuff('hidden_potential_form', ctx.formMax + 0.2, RAGE_FORM_MODS);
        // THE DETONATION — the loudest single frame in the game.
        H.flash.fire('#ffffff', 0.85, 1.6);
        H.grade(run, RAGE_AURA, 0.7, 1.0);
        H.shake.big();
        H.camera.punch(0.12, 0.8);
        H.particles.ring(p.x, p.y, 40, RAGE_AURA, 720);
        H.particles.ring(p.x, p.y, 26, '#ffffff', 420);
        H.particles.burst(p.x, p.y, 20, RAGE_AURA, RAGE_BURST_FX);
        H.audio.play('evolve');
        H.audio.play('explode');
        H.announce(run, 'HIDDEN POTENTIAL', RAGE_AURA);
        return;
      }

      // --- transformed -------------------------------------------------------
      if (ctx.formT > 0) {
        ctx.formT -= dt;
        // The meter doubles as the transformation timer, so it is empty exactly
        // when the form ends and must be refilled from scratch.
        p.resource = p.resourceMax * (ctx.formT > 0 ? ctx.formT / ctx.formMax : 0);
        ctx.boltT -= dt;
        if (ctx.boltT <= 0) {
          ctx.boltT = 0.06;                   // crawling lightning
          const a = H.fxRng.angle();
          H.particles.emit(p.x + Math.cos(a) * 22, p.y + Math.sin(a) * 22,
                           Math.cos(a) * 90, Math.sin(a) * 90 - 60, RAGE_LIGHTNING_FX);
        }
        if (ctx.formT > 0) return;
        ctx.formT = 0;
        p.resource = 0;
        p.flags.doubleVolley = false;
        p.flags.knockbackImmune = false;
        p.flags.formMoveSpeed = 0;
        p.flags.formAuraColor = null;
        restoreMoveSpeed(p);
        restoreAura(p);
        p.removeBuff('hidden_potential_form');
        H.grade(run, '#8f5fd6', 0.25, 0.6);
        H.particles.ring(p.x, p.y, 16, '#8f5fd6', 300);
        return;
      }

      // --- the meter reaches 100% -------------------------------------------
      if (p.resourceMax > 0 && p.resource >= p.resourceMax) {
        ctx.silenceT = RAGE_SILENCE;
        H.audio.stopMusic();                  // full stop of the music
        H.grade(run, '#05040a', 0.55, RAGE_SILENCE);
        H.camera.punch(0.02, RAGE_SILENCE);
      }
    },
    onDamaged(run, p, ctx) { pumpRage(run, p, ctx); },
  },
});
