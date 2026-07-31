// Shared ability helpers.
//
// Everything an ability implementation needs, in one import, with the "where do
// I fire from" and "how much damage is this really" questions already answered.
// Using these consistently is what makes the mirror boss, minion mirroring and
// resonance work for every ability without any of them knowing about it.

import { runRng, fxRng } from '../../core/rng.js';
import { feel } from '../../core/feel.js';
import { audio } from '../../core/audio.js';
import { particles } from '../../render/particles.js';
import { effects, FX_TIER } from '../../render/effects.js';
import { floaters } from '../../render/damageNumbers.js';
import { flash, shake } from '../../render/screenShake.js';
import { camera } from '../../render/camera.js';
import { atlas } from '../../render/spriteAtlas.js';
import {
  clamp, TAU, angleTo, dist2, dirTo, V, lerp,
} from '../../core/math.js';
import {
  dealDamage, damagePlayer, healPlayer, areaDamage, coneDamage, lineDamage,
  executeEnemy, SRC,
} from '../damage.js';
import { MOTION } from '../projectile.js';
import { MINION_ROLE } from '../minion.js';
import { resolveTarget, nearestTo, collectNearest } from '../targeting.js';
import {
  applyBurn, applyBleed, applySlow, applyStun, applyTaunt, applyPull,
  applyShred, applyVulnerable, applyNoRegen, applyMark, applyHaste,
  applyEmpower, applyInvuln, applyUntargetable, applyIntangible, addShield,
  MARK,
} from '../statusEffects.js';
import { FIELD } from '../hazards.js';

export {
  runRng, fxRng, feel, audio, particles, effects, FX_TIER, floaters, flash, shake, camera, atlas,
  clamp, TAU, angleTo, dist2, dirTo, V, lerp,
  dealDamage, damagePlayer, healPlayer, areaDamage, coneDamage, lineDamage,
  executeEnemy, SRC, MOTION, MINION_ROLE, FIELD,
  resolveTarget, nearestTo, collectNearest,
  applyBurn, applyBleed, applySlow, applyStun, applyTaunt, applyPull,
  applyShred, applyVulnerable, applyNoRegen, applyMark, applyHaste,
  applyEmpower, applyInvuln, applyUntargetable, applyIntangible, addShield, MARK,
};

/**
 * WHERE AN ABILITY FIRES FROM.
 * Normally the player. When a minion is mirroring, or when THE FINAL FORM is
 * using your kit against you, it is that entity instead. Every ability calls
 * this instead of touching `p.x` directly, which is what makes both features
 * work for abilities written before either existed.
 */
export function origin(run, p, opts) {
  return (opts && opts.origin) || p;
}

/** True when this cast is the boss using your move on you. */
export function isHostile(opts) { return !!(opts && opts.hostile); }

/** Damage source: enemies when the boss is mirroring, enemies otherwise. */
export function hostileDamage(run, opts, x, y, radius, amount) {
  const p = run.player;
  if (dist2(x, y, p.x, p.y) < radius * radius) {
    damagePlayer(run, amount, SRC.BOSS, { fromX: x, fromY: y });
  }
}

/**
 * AUTO-ATTACK DAMAGE, fully resolved.
 * base * player damage multipliers * star-level auto bonus * mirror power.
 * `opts.damageOverride` (a minion's share) replaces the base entirely.
 */
export function autoDamage(run, p, base, opts) {
  const o = opts || EMPTY;
  if (o.damageOverride) return o.damageOverride * (o.power || 1);
  return base * p.autoDamageMultiplier() * (o.power || 1);
}

/** ABILITY DAMAGE (specials, escapes, passives) — no auto-only star bonus. */
export function abilityDamage(run, p, base, opts) {
  const o = opts || EMPTY;
  return base * p.abilityDamageMultiplier() * (o.power || 1);
}

/**
 * THE SIGNATURE-WEAPON MODIFIERS, or null.
 *
 * `p.autoScope` is set by the ability driver for exactly the duration of one
 * synchronous auto-attack `fire()` call and cleared immediately after. Reading
 * it here is what lets the signature weapon's level scale an auto-attack's
 * SIZE, projectile COUNT and PIERCE without touching all nineteen ability
 * implementations — and, just as importantly, without those same numbers
 * leaking into specials, escapes and passives, which call these helpers too.
 */
function sig(p) {
  return (p.autoScope && p.run.weapons) ? p.run.weapons.mods : null;
}

/** Areas scale with the player's areaMult. Every radius in every ability uses this. */
export function area(p, base) {
  const s = sig(p);
  return base * p.stats.areaMult * (s ? s.area : 1);
}

/** Projectile speed and range scale together (the Long Haul upgrade). */
export function projSpeed(p, base) { return base * p.stats.projectileSpeedMult; }

/** How many extra projectiles the Extra Shot upgrade added. */
export function extraShots(p) {
  const s = sig(p);
  return (p.stats.projectileCount | 0) + (s ? s.count : 0);
}

/** Pierce from upgrades, on top of an ability's own base pierce. */
export function pierce(p, base) {
  const s = sig(p);
  return (base || 0) + (p.stats.pierce | 0) + (s ? s.pierce : 0);
}

/**
 * HOW WIDE A VOLLEY OPENS — the arithmetic every fan in the game now shares.
 *
 * `arc` used to be the WHOLE fan no matter how many bodies went into it, and
 * that produced two wrong shapes at once.
 *
 *   - Six of the fifteen `spread` call sites pass `arc: 0`, because at their own
 *     count of one there was nothing to fan. Every projectile Extra Shot added
 *     to those was fired from the same point, on the same bearing, at the same
 *     speed, with the same life: five shots that are drawn as one shot and
 *     travel as one body for as long as they live. The damage was all there —
 *     each carries its own uid, so each one really does hit — and the upgrade was
 *     still invisible, which is exactly the complaint.
 *   - The nine sites that DID pass a fan had it SUBDIVIDED, so taking the most
 *     expensive offensive upgrade in the game made an existing volley tighter.
 *     Seven shuriken in the 0.26rad meant for three sit 2.5° apart: four pixels
 *     of separation at a hundred pixels of travel.
 *
 * So `arc` is a SPACING now, not a total. The gap the caller's own count implies
 * is kept exactly, floored so no two projectiles can ever share a bearing, and
 * the fan GROWS with the number of bodies in it. At the caller's own count the
 * result is identical to what it always was, down to the last bit — no volley in
 * the game changes shape until Extra Shot is actually taken.
 *
 * MIN_GAP is 0.13rad (7.4°): about 40px of separation at 300px of travel, which
 * is where two shots stop reading as one. MAX_FAN caps the whole spread at
 * 1.4rad (80°) so a nine-shot auto is still a volley pointed at something rather
 * than a nova; past the cap the shots tighten again instead of wrapping around
 * behind the player.
 */
const MIN_GAP = 0.13;
const MAX_FAN = 1.4;

/** The total angle `n` projectiles occupy, given the caller's requested `arc`. */
export function fanWidth(n, arc) {
  if (n <= 1) return 0;
  let gap = arc > 0 ? arc / (n - 1) : 0;
  if (gap < MIN_GAP) gap = MIN_GAP;
  const total = gap * (n - 1);
  return total > MAX_FAN ? MAX_FAN : total;
}

/**
 * The bearing of shot `i` of `n`, fanned around `angle`.
 *
 * Exported because `spread` is not the only thing that fans. Three weapon
 * implementations and two abilities build their own volleys, and every single
 * one of them carried its own copy of the cramping bug above.
 */
export function fanAngle(i, n, angle, arc) {
  if (n <= 1) return angle;
  const total = fanWidth(n, arc);
  return angle - total * 0.5 + (i / (n - 1)) * total;
}

/**
 * Fire a spread of projectiles. The single most-used helper — it applies Extra
 * Shot, Wide Reach, Long Haul and Piercing Will uniformly so no ability has to
 * remember to.
 *
 * `opts.fixedCount` opts a call OUT of Extra Shot, and exists for exactly one
 * shape: a 360° RING. A ring grows by adding SPOKES — which only the caller can
 * do, because only the caller knows the ring's geometry — and letting this
 * helper fan each spoke as well would apply the same upgrade twice and turn an
 * eight-shard barrier into eight fans of five.
 */
export function spread(run, p, x, y, angle, count, arc, o) {
  const opts = o || EMPTY;
  const base = count > 0 ? count : 1;
  const n = opts.fixedCount ? base : Math.max(1, base + extraShots(p));
  for (let i = 0; i < n; i++) {
    const a = fanAngle(i, n, angle, arc);
    run.projectiles.fire(x, y, a, {
      speed: projSpeed(p, opts.speed || 460),
      damage: opts.damage,
      life: (opts.life || 1.6) * p.stats.projectileSpeedMult,
      radius: (opts.radius || 8) * p.stats.areaMult,
      pierce: pierce(p, opts.pierce),
      motion: opts.motion,
      element: opts.element,
      visual: opts.visual,
      target: opts.target,
      turnRate: opts.turnRate,
      bounces: opts.bounces,
      bounceRange: opts.bounceRange,
      bounceDamageMult: opts.bounceDamageMult,
      aoeRadius: opts.aoeRadius ? area(p, opts.aoeRadius) : 0,
      aoeDamage: opts.aoeDamage,
      splitInto: opts.splitInto,
      splitDamage: opts.splitDamage,
      popTime: opts.popTime,
      popCount: opts.popCount,
      stickTime: opts.stickTime,
      spin: opts.spin,
      trailColor: opts.trailColor,
      knockback: opts.knockback,
      onHit: opts.onHit,
      onExpire: opts.onExpire,
      tag: opts.tag,
      owner: opts.owner || p,
      pierceBonusPerHit: p.flags.pierceBonusPerHit || 0,
    });
  }
  return n;
}

// --- the visual tier ---------------------------------------------------------
/**
 * NORMAL OR EVOLVED, for any cast.
 *
 * An evolution that changes only the numbers is an evolution the player has to
 * take on faith. `effects` draws a categorically different shape for tier 1 —
 * a counter-rotating second blade, a gold rim, a double pulse, ghosts that
 * linger — and this is the one function that decides which one a cast gets.
 *
 * Resolution order:
 *   1. `opts.tier` / `opts.evolved`, if the caller said so explicitly. Nothing
 *      overrides an ability that knows its own state.
 *   2. never for a HOSTILE cast — the mirror boss using your kit against you has
 *      to stay visually distinguishable from you using it.
 *   3. otherwise the signature weapon's own `evolved` flag, which is the
 *      character's kit reaching its final form. It is deliberately the WHOLE
 *      kit and not just the auto-attack: the evolution is the loudest moment in
 *      a run, and having every swing, nova and dash change silhouette at once is
 *      what makes it land.
 *
 * `opts.tier` is an OPTIONAL FIELD ON AN EXISTING BAG. No helper below changed
 * its parameter order or its required arguments — nineteen characters' worth of
 * ability code calls these and none of it needs editing.
 */
export function visualTier(p, opts) {
  const o = opts || EMPTY;
  if (o.tier !== undefined || o.evolved !== undefined) {
    return (o.tier === 'evolved' || o.tier === 1 || o.tier === true || o.evolved === true)
      ? FX_TIER.EVOLVED : FX_TIER.NORMAL;
  }
  if (o.hostile) return FX_TIER.NORMAL;
  const w = p && p.run && p.run.weapons;
  return (w && w.mods && w.mods.evolved) ? FX_TIER.EVOLVED : FX_TIER.NORMAL;
}

/**
 * The one options bag every effect call reuses.
 *
 * `effects` copies every field out synchronously, so a single mutable scratch
 * object is safe and keeps the most-used visual path in the game allocation
 * free. `fx()` resets EVERY field, because a value left over from the previous
 * call site is the kind of bug that shows up as "the dash sometimes flickers".
 */
const FX = {
  tier: 0, life: 0, alpha: 1, sweep: 1, color2: null,
  width: 0, from: 0, spokes: 0, size: 0, angle: 0, double: false,
};
function fx(tier) {
  FX.tier = tier; FX.life = 0; FX.alpha = 1; FX.sweep = 1; FX.color2 = null;
  FX.width = 0; FX.from = 0; FX.spokes = 0; FX.size = 0; FX.angle = 0;
  FX.double = false;
  return FX;
}

/**
 * Alternates every swing so a combo reads left-right-left. Deterministic.
 *
 * ONE toggle shared by every melee ability in the game, which is exactly right
 * for as long as a swing's direction is arbitrary. It stopped being arbitrary
 * the moment an ability started drawing the WEAPON through the arc as well as
 * the energy: `effects.sweepSprite` swings a real scythe, and if the prop and
 * its own slash pick opposite directions they do it for the whole run, because
 * this toggle's phase depends on how many other swings happened first.
 * `opts.sweep` lets such a caller pin it; every existing caller omits the field
 * and keeps alternating exactly as it did.
 */
let SWING = 1;

const ARC_SPARK = { speed: 220, life: 0.16, size: 0.4 };
const ARC_SPARK_EVO = { speed: 300, life: 0.26, size: 0.5, additive: true };
const NOVA_BURST = { speed: 0, life: 0.5, size: 0.9, additive: true };
const DASH_TRAIL = { color: '#ffffff', life: 0.28, size: 0.9, sizeEnd: 0.1, drag: 2, additive: true };

/**
 * A melee arc — the swing shape used by every sword character.
 *
 * The visual is a SWEEP, not a stamp: `effects.slash` cocks the blade back,
 * whips it through `arcRad` over a quarter of a second and drags a tapering
 * trail behind the leading edge. It no longer pushes into `run.overlays.wedges`,
 * because a one-frame pie slice and an animated swing on the same cast is just
 * the old flash showing through the new one.
 *
 * `opts.silent` suppresses the 'slash' sound and NOTHING else. It exists for the
 * one shape this helper could not express: a character who swings TWO blades in
 * the same tick calls this twice, `audio.play` has no throttle, and the pair came
 * out as one doubled click rather than as two blades. Such a caller plays the
 * sound on the first arc and silences the second. Every existing caller omits the
 * field and is byte-for-byte unaffected.
 */
export function meleeArc(run, p, x, y, angle, arcRad, radius, damage, o) {
  const opts = o || EMPTY;
  const r = area(p, radius);
  const hits = coneDamage(run, x, y, angle, arcRad, r, damage, opts.src || SRC.AUTO, {
    element: opts.element, knockback: opts.knockback, crit: opts.crit,
    maxTargets: opts.maxTargets, onHit: opts.onHit,
  });
  const color = opts.color || '#ffe86a';
  const tier = visualTier(p, opts);

  SWING = opts.sweep ? (opts.sweep < 0 ? -1 : 1) : -SWING;
  const f = fx(tier);
  f.sweep = SWING;
  f.life = opts.fxLife > 0 ? opts.fxLife : (tier ? 0.30 : 0.24);
  f.color2 = opts.color2 || null;
  effects.slash(x, y, angle, arcRad, r, color, f);

  particles.cone(x, y, angle, arcRad, tier ? 7 : 4, color, tier ? ARC_SPARK_EVO : ARC_SPARK);
  if (tier) {
    // A spark that lingers where the tip passed. Cheap, and it is the detail
    // that makes the evolved swing feel like it has weight behind it.
    const g = fx(tier);
    g.size = Math.max(10, r * 0.16);
    g.life = 0.20;
    effects.impact(x + Math.cos(angle) * r * 0.86, y + Math.sin(angle) * r * 0.86, color, g);
  }
  if (!opts.silent) audio.play('slash');
  return hits;
}

/** A nova / explosion at a point, with the ring particles and the shake. */
export function nova(run, p, x, y, radius, damage, o) {
  const opts = o || EMPTY;
  const r = area(p, radius);
  const hits = areaDamage(run, x, y, r, damage, opts.src || SRC.SPECIAL, {
    falloff: opts.falloff === undefined ? 0.25 : opts.falloff,
    element: opts.element, knockback: opts.knockback, crit: opts.crit,
    excludeBosses: opts.excludeBosses, maxTargets: opts.maxTargets, onHit: opts.onHit,
  });
  const color = opts.color || '#ffd76a';
  const tier = visualTier(p, opts);

  // The ring EXPANDS to the real damage radius over its life, so the blast now
  // shows the player exactly what it hit instead of asserting it.
  const f = fx(tier);
  f.from = r * 0.16;
  f.life = tier ? 0.52 : 0.42;
  f.width = Math.max(4, r * 0.11);
  f.double = tier || !!opts.double;
  f.spokes = 12;
  effects.shockwave(x, y, r, color, f);

  const g = fx(tier);
  g.spokes = tier ? 18 : 12;
  g.life = 0.34;
  g.width = Math.max(2, r * 0.05);
  effects.burstRing(x, y, r * 0.95, color, g);

  const h = fx(tier);
  h.size = Math.max(14, r * 0.22);
  h.life = 0.22;
  effects.impact(x, y, color, h);

  particles.ring(x, y, opts.particles || 22, color, r * 3.4);
  NOVA_BURST.speed = r * 1.6;
  particles.burst(x, y, 10, color, NOVA_BURST);
  if (opts.shake !== false) shake.medium();
  audio.play('explode');
  return hits;
}

// --- which way an escape actually goes ---------------------------------------
/**
 * MOVEMENT INTENT OUTRANKS WHATEVER THE ABILITY WAS AIMED AT.
 *
 * Reported from play: "dashes go into a pack of mobs." Every escape in the game
 * comes out of `dash` or `blink`, and until now each one picked its own angle —
 * usually `p.facing`, which is only refreshed WHILE the player is moving, and in
 * several kits an enemy or the densest cluster instead. Both are wrong at the
 * one moment that matters: you are surrounded, you have already picked the gap,
 * you are LEANING ON THE STICK TOWARDS IT, and the button throws you somewhere
 * else. The answer was in the input vector the whole time.
 *
 * So the direction is resolved here, once, on behalf of every escape at once:
 *
 *   1. `opts.aimed` — the caller insisted, and meant it. A gap-closer that has
 *      to arrive on its target, and a plough deliberately driven INTO the crowd,
 *      are not the bug being described.
 *   2. a dash that is not the ESCAPE button at all. `opts.src` already says
 *      which button a cast came off, and only the escape is the panic button
 *      the player is entitled to steer; a special that happens to travel — a
 *      shark carving nine passes through the thickest part of the room — is a
 *      deliberate commitment and keeps its own aim. The balance harness found
 *      this one: pointing that special away from the crowd cost the character
 *      two thirds of its damage and half its levels.
 *   3. anything that is not the player moving under their own input: a mirroring
 *      minion, or THE FINAL FORM using your own kit against you (`opts.origin`,
 *      `opts.hostile`). Your stick must never steer either of them.
 *   4. the direction currently held. `run.inputMoveX/Y` is this frame's resolved
 *      stick / keys / touch, sampled at the top of `run.update` before abilities
 *      tick, so it is the very vector `player._move` is walking on — down to its
 *      `> 0.01` threshold, so "the game thinks I am walking that way" and "the
 *      dash thinks I am walking that way" cannot come apart.
 *   5. the direction held a moment ago. Players let go of the stick as they tap
 *      the button, and a facing from a fifth of a second back is still what they
 *      meant. `p.stillT` is the engine's stillness clock — it resets to 0 the
 *      frame you move — and past the grace window that facing is genuinely stale.
 *   6. whatever the ability decided. Most of them answer "away from the thickest
 *      part of the room", which is exactly the right answer for a player who is
 *      standing still and has expressed no preference at all. That reasoning is
 *      not being thrown away; it is being demoted below a player who HAS.
 *
 * No RNG is drawn and nothing is allocated. Escapes cast, they do not tick, so
 * this is a handful of multiplies once every several seconds.
 */
const INTENT_MOVING = 0.01 * 0.01;   // `player._move`'s own "am I walking" test, squared
const INTENT_GRACE = 0.2;            // seconds of stale facing still worth honouring

export function escapeDirection(run, p, angle, opts) {
  const o = opts || EMPTY;
  if (o.aimed || o.hostile) return angle;
  if (o.src !== undefined && o.src !== SRC.ESCAPE) return angle;
  const player = run.player;
  if (!player || p !== player || (o.origin && o.origin !== player)) return angle;
  const mx = run.inputMoveX, my = run.inputMoveY;
  // Undefined on the very first frame of a run, before `update` has sampled the
  // input once; NaN fails the comparison and the caller's angle stands.
  if (mx * mx + my * my > INTENT_MOVING) return Math.atan2(my, mx);
  if (p.stillT >= 0 && p.stillT <= INTENT_GRACE) return p.facing;
  return angle;
}

/**
 * The opt-out, shared so a caller that has nothing else to say can pass it by
 * reference instead of building a bag. Frozen because it is handed to a dozen
 * files: a stray `H.AIMED.color = ...` would otherwise repaint every deliberate
 * escape in the game, and throwing is a much cheaper way to find that out.
 */
export const AIMED = Object.freeze({ aimed: true });

/**
 * A dash with i-frames. The shared spine of ~12 escape moves, so they all get
 * the same trail, the same obstacle handling and the same bounds clamping — and
 * now the same steering: `angle` is a REQUEST, resolved through
 * `escapeDirection` against what the player is actually asking for. Pass
 * `H.AIMED` (or `aimed: true` on the existing bag) for a dash that must go where
 * the ability points it rather than where the player is walking.
 */
export function dash(run, p, angle, distance, iframes, o) {
  const opts = o || EMPTY;
  const a = escapeDirection(run, p, angle, opts);
  const x0 = p.x, y0 = p.y;
  const x1 = clamp(p.x + Math.cos(a) * distance, run.bounds.minX, run.bounds.maxX);
  const y1 = clamp(p.y + Math.sin(a) * distance, run.bounds.minY, run.bounds.maxY);
  p.x = x1; p.y = y1;
  p.px = x1; p.py = y1;
  if (iframes > 0) applyInvuln(p.st, iframes);
  const cutW = area(p, opts.width || 40);
  if (opts.damage) {
    lineDamage(run, x0, y0, x1, y1, cutW, opts.damage,
               opts.src || SRC.ESCAPE, { element: opts.element, knockback: opts.knockback });
  }
  // THE TRAIL. Real afterimages now: a chain of fading silhouettes with a streak
  // pointing back down the path, so the dash shows the route it took rather than
  // dropping eight dots that could have come from anywhere.
  const color = opts.color || p.visual.color;
  const tier = visualTier(p, opts);
  const ghosts = tier ? 7 : 5;
  const size = opts.ghostSize > 0 ? opts.ghostSize : 15;
  for (let i = 0; i <= ghosts; i++) {
    const t = i / ghosts;
    const f = fx(tier);
    f.life = 0.22 + t * 0.18;
    f.alpha = 0.5 + t * 0.5;                 // brightest where the dash ENDED
    effects.afterimage(lerp(x0, x1, t), lerp(y0, y1, t), a, size, color, f);
  }
  // A DAMAGING dash cut something on the way through, so it draws the cut: a
  // beam down the exact line `lineDamage` tested, at the exact width it used.
  // An escape that hurts and an escape that does not should never look alike.
  if (opts.damage) {
    const c = fx(tier);
    c.life = tier ? 0.30 : 0.22;
    effects.beam(x0, y0, x1, y1, cutW * 0.5, color, c);
  }
  // A pop at both ends: one where the body left, one where it arrived.
  const s0 = fx(tier);
  s0.from = 4; s0.life = 0.26; s0.width = 4;
  effects.shockwave(x0, y0, size * 2.4, color, s0);
  const s1 = fx(tier);
  s1.from = 4; s1.life = 0.32; s1.width = 5;
  effects.shockwave(x1, y1, size * 3.0, color, s1);

  DASH_TRAIL.color = color;
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    particles.emit(lerp(x0, x1, t), lerp(y0, y1, t), 0, 0, DASH_TRAIL);
  }
  audio.play('escape');
  // `angle` rides along because the requested one is no longer the one that was
  // travelled. Callers that dress the dash afterwards — a skid, a spray cone, a
  // plume of smoke out of the back — need the direction the body ACTUALLY went,
  // and the segment endpoints alone would make every one of them recompute it.
  return { x0, y0, x1, y1, angle: a };
}

/**
 * Blink with no line damage — teleports, substitutions, dimension hops.
 *
 * The destination gets the same treatment `dash` gives its angle, with one
 * difference that matters: a blink is handed a PLACE, so what is re-aimed is the
 * HOP — the caller's distance, pointed where the player is going. Two guards
 * keep that honest.
 *
 * A blink that must arrive somewhere SPECIFIC — behind that enemy, on that
 * planted gate — is a destination and not a direction, and passes `H.AIMED`;
 * when it does, `x, y` are used untouched rather than round-tripped through a
 * sine and a cosine that would land it a hair off the thing it was aiming at.
 *
 * And re-aiming may never cost DISTANCE. The hop escapes route their
 * destination through their own wall-flip first, and letting intent overwrite
 * that turns a 200px hop into a 20px shuffle against the arena edge the moment
 * the player leans into the wall. If the re-aimed landing point survives the
 * bounds clamp worse than the one the caller chose, the caller's wins — a player
 * pressing into a wall is asking for the impossible, and the escape still has to
 * escape.
 */
export function blink(run, p, x, y, iframes, o) {
  const opts = o || EMPTY;
  const tier = visualTier(p, null);
  const color = p.visual.color;
  const a = fx(tier); a.from = 3; a.life = 0.30; a.width = 5;
  effects.shockwave(p.x, p.y, 46, color, a);
  const g = fx(tier); g.life = 0.30; g.alpha = 0.8;
  effects.afterimage(p.x, p.y, p.facing || 0, 16, color, g);
  particles.ring(p.x, p.y, 10, color, 220);

  const arena = run.bounds;
  let tx = clamp(x, arena.minX, arena.maxX);
  let ty = clamp(y, arena.minY, arena.maxY);
  const dx = x - p.x, dy = y - p.y;
  const asked = Math.atan2(dy, dx);
  const heading = escapeDirection(run, p, asked, opts);
  if (heading !== asked) {
    const d = Math.sqrt(dx * dx + dy * dy);
    const ix = clamp(p.x + Math.cos(heading) * d, arena.minX, arena.maxX);
    const iy = clamp(p.y + Math.sin(heading) * d, arena.minY, arena.maxY);
    if (dist2(ix, iy, p.x, p.y) >= dist2(tx, ty, p.x, p.y)) { tx = ix; ty = iy; }
  }
  p.x = tx; p.y = ty;
  p.px = p.x; p.py = p.y;
  if (iframes > 0) applyInvuln(p.st, iframes);

  const b = fx(tier); b.from = 3; b.life = 0.34; b.width = 5;
  effects.shockwave(p.x, p.y, 54, color, b);
  const h = fx(tier); h.size = 18; h.life = 0.22;
  effects.impact(p.x, p.y, color, h);
  particles.ring(p.x, p.y, 10, color, 220);
  audio.play('escape');
}

/** Screen colour grade for a special. Every special has a distinct one. */
export function grade(run, color, strength, duration) {
  flash.fire(color, strength, duration ? 1 / duration : 3);
  run.player.flags.gradeColor = color;
  run.player.flags.gradeT = duration || 0.4;
}

/** Announce an ability by name over the player. */
export function announce(run, text, color) {
  floaters.spawn(run.player.x, run.player.y - 68, text, color || '#ffd76a', 26, 1.4);
}

/**
 * Spawn one field (burning ground, chum pile, whirlpool).
 *
 * The spawn FLOURISH is throttled, and that is load-bearing rather than
 * fussy. Standing effects re-spawn their field every tick — the evolved
 * signature's halo does it twice a second, and a couple of specials refresh a
 * pull field on every single frame of their channel — so an unconditional ring
 * here would be a solid disc pinned to the player for the whole run. Short-lived
 * refresh fields are skipped outright and the rest share one flourish per
 * 0.18s of SIM time (never wall clock, and never the run RNG).
 */
export function field(run, p, x, y, radius, duration, kind, dps, color, o) {
  const opts = o || EMPTY;
  const r = area(p, radius);
  const f = run.hazards.spawnField(x, y, r, duration, kind, dps, color, opts);
  if (opts.fx !== false && duration >= 1.5 &&
      (run.time < FIELD_FX_T || run.time - FIELD_FX_T > 0.18)) {
    FIELD_FX_T = run.time;
    const g = fx(visualTier(p, opts));
    g.from = r * 0.55;
    g.life = 0.46;
    g.width = Math.max(3, r * 0.07);
    effects.shockwave(x, y, r, color || '#ff7a3d', g);
  }
  return f;
}
/** Sim time of the last field flourish. `run.time` restarts at 0 each run. */
let FIELD_FX_T = -1;

/** Summon a minion. `tag` caps the population per ability. */
export function summon(run, p, x, y, o) {
  const opts = o || EMPTY;
  if (opts.max && run.minions.countTag(opts.tag) >= opts.max) return null;
  return run.minions.spawn(x, y, opts);
}

/** A prop that is explicitly NOT a minion (DECISIONS.md §27). */
export function prop(run, p, x, y, o) {
  const opts = Object.assign({}, o || EMPTY);
  opts.isMinion = false;
  return run.minions.spawn(x, y, opts);
}

/**
 * Resonance multiplier for a relic's params when the owner is playing it.
 * Abilities do not use this — relicHooks does — but signature-relic-adjacent
 * abilities occasionally need to ask.
 */
export function resonating(run, relicId) {
  return run.player.resonatesWith(relicId);
}

/** Resolve the ability's declared targeting spec. Returns the shared result. */
export function target(run, p, spec, opts) {
  const o = origin(run, p, opts);
  ORIGIN.x = o.x; ORIGIN.y = o.y; ORIGIN.facing = o.facing !== undefined ? o.facing : p.facing;
  return resolveTarget(run, ORIGIN, spec);
}
const ORIGIN = { x: 0, y: 0, facing: 0 };

/** Iterate every live enemy inside a radius without allocating. */
export function forEachEnemyIn(run, x, y, radius, fn) {
  const hash = run.enemyHash;
  const items = run.enemies.items;
  const n = hash.query(x, y, radius);
  for (let k = 0; k < n; k++) {
    const e = items[hash.resultAt(k)];
    if (!e || !e.active || e.hp <= 0) continue;
    const rr = radius + e.radius;
    if (dist2(x, y, e.x, e.y) > rr * rr) continue;
    if (fn(e) === false) return;
  }
}

const EMPTY = {};
