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
  runRng, fxRng, feel, audio, particles, floaters, flash, shake, camera, atlas,
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

/** Areas scale with the player's areaMult. Every radius in every ability uses this. */
export function area(p, base) { return base * p.stats.areaMult; }

/** Projectile speed and range scale together (the Long Haul upgrade). */
export function projSpeed(p, base) { return base * p.stats.projectileSpeedMult; }

/** How many extra projectiles the Extra Shot upgrade added. */
export function extraShots(p) { return p.stats.projectileCount | 0; }

/** Pierce from upgrades, on top of an ability's own base pierce. */
export function pierce(p, base) { return (base || 0) + (p.stats.pierce | 0); }

/**
 * Fire a spread of projectiles. The single most-used helper — it applies Extra
 * Shot, Wide Reach, Long Haul and Piercing Will uniformly so no ability has to
 * remember to.
 */
export function spread(run, p, x, y, angle, count, arc, o) {
  const opts = o || EMPTY;
  const n = Math.max(1, count + extraShots(p));
  const total = arc * (n > 1 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = n > 1 ? angle - total / 2 + (i / (n - 1)) * total : angle;
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

/**
 * A melee arc — the swing shape used by every sword character.
 * Draws its own transient visual so no ability needs render code.
 */
export function meleeArc(run, p, x, y, angle, arcRad, radius, damage, o) {
  const opts = o || EMPTY;
  const r = area(p, radius);
  const hits = coneDamage(run, x, y, angle, arcRad, r, damage, opts.src || SRC.AUTO, {
    element: opts.element, knockback: opts.knockback, crit: opts.crit,
    maxTargets: opts.maxTargets, onHit: opts.onHit,
  });
  run.overlays.wedges.push({ x, y, r, a0: angle - arcRad / 2, a1: angle + arcRad / 2,
                             color: opts.color || '#ffe86a', life: 0.12 });
  particles.cone(x, y, angle, arcRad, 4, opts.color || '#ffe86a', { speed: 220, life: 0.16, size: 0.4 });
  audio.play('slash');
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
  particles.ring(x, y, opts.particles || 22, opts.color || '#ffd76a', r * 3.4);
  particles.burst(x, y, 10, opts.color || '#ffd76a', { speed: r * 1.6, life: 0.5, size: 0.9, additive: true });
  if (opts.shake !== false) shake.medium();
  audio.play('explode');
  return hits;
}

/**
 * A dash with i-frames. The shared spine of ~12 escape moves, so they all get
 * the same trail, the same obstacle handling and the same bounds clamping.
 */
export function dash(run, p, angle, distance, iframes, o) {
  const opts = o || EMPTY;
  const x0 = p.x, y0 = p.y;
  const x1 = clamp(p.x + Math.cos(angle) * distance, run.bounds.minX, run.bounds.maxX);
  const y1 = clamp(p.y + Math.sin(angle) * distance, run.bounds.minY, run.bounds.maxY);
  p.x = x1; p.y = y1;
  p.px = x1; p.py = y1;
  if (iframes > 0) applyInvuln(p.st, iframes);
  if (opts.damage) {
    lineDamage(run, x0, y0, x1, y1, area(p, opts.width || 40), opts.damage,
               opts.src || SRC.ESCAPE, { element: opts.element, knockback: opts.knockback });
  }
  // Afterimage trail.
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    particles.emit(lerp(x0, x1, t), lerp(y0, y1, t), 0, 0, {
      color: opts.color || p.visual.color, life: 0.28, size: 0.9, sizeEnd: 0.1,
      drag: 2, additive: true,
    });
  }
  audio.play('escape');
  return { x0, y0, x1, y1 };
}

/** Blink with no line damage — teleports, substitutions, dimension hops. */
export function blink(run, p, x, y, iframes) {
  particles.ring(p.x, p.y, 10, p.visual.color, 220);
  p.x = clamp(x, run.bounds.minX, run.bounds.maxX);
  p.y = clamp(y, run.bounds.minY, run.bounds.maxY);
  p.px = p.x; p.py = p.y;
  if (iframes > 0) applyInvuln(p.st, iframes);
  particles.ring(p.x, p.y, 10, p.visual.color, 220);
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

/** Spawn one field (burning ground, chum pile, whirlpool). */
export function field(run, p, x, y, radius, duration, kind, dps, color, o) {
  return run.hazards.spawnField(x, y, area(p, radius), duration, kind, dps, color, o);
}

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
