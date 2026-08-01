// THE single choke point for ALL damage in the game.
//
// Nothing anywhere else may write to `hp`. Every hit — auto-attacks, specials,
// DoTs, contact damage, thorns, hazards, boss attacks, execute effects — comes
// through `dealDamage` or `damagePlayer`. That is what makes crit, lifesteal,
// element bonuses, armour, dodge, damage caps, hit flash, knockback, damage
// numbers, achievements, and relic hooks work uniformly instead of being
// reimplemented (and forgotten) in twenty call sites.
//
// It is also what makes the balance harness honest: `runStats.damageDealt` is
// the sum of what actually passed through here.

import { CONFIG } from '../core/config.js';
import { events, EV } from '../core/events.js';
import { runRng } from '../core/rng.js';
import { feel } from '../core/feel.js';
import { clamp, dirTo, V } from '../core/math.js';
import { damageNumbers, DMG_KIND } from '../render/damageNumbers.js';
import { particles } from '../render/particles.js';
import { shake } from '../render/screenShake.js';
import { audio } from '../core/audio.js';
import {
  damageMultiplierTaken, damageMultiplierDealt, armorAfterShred,
  isInvuln, applySlow,
} from './statusEffects.js';
import { elementMultiplier } from '../data/elements.js';

/** Damage source tags — used by relics, achievements and the codex. */
export const SRC = {
  AUTO: 0, SPECIAL: 1, ESCAPE: 2, DOT: 3, CONTACT: 4, MINION: 5,
  HAZARD: 6, RELIC: 7, THORNS: 8, EXECUTE: 9, BOSS: 10, EVOLUTION: 11,
};

/** Reused result record. Read it immediately; the next call overwrites it. */
export const lastHit = {
  amount: 0, crit: false, killed: false, overkill: 0, dodged: false, blocked: false,
};

/**
 * Deal damage to an enemy.
 *
 * @param {object} run    the active Run (owns pools, stats, the player)
 * @param {object} e      the target enemy
 * @param {number} amount pre-mitigation damage
 * @param {number} src    one of SRC.*
 * @param {object} opts   {crit, canCrit, element, knockback, fromX, fromY,
 *                         pierce, noNumber, kind, lifestealMult, flat}
 * @returns {number} damage actually dealt (0 if the target was already dead)
 */
export function dealDamage(run, e, amount, src, opts) {
  lastHit.amount = 0; lastHit.crit = false; lastHit.killed = false;
  lastHit.overkill = 0; lastHit.dodged = false; lastHit.blocked = false;
  if (!e || !e.active || e.hp <= 0 || amount <= 0) return 0;

  const o = opts || EMPTY;
  const p = run.player;

  // --- invulnerability (the boss intro card, the phase-transition shell) -----
  // The only entities that ever carry `invulnT` are bosses: game/boss.js sets it
  // for the length of the intro card and for the shell at the top of a phase
  // break. It was WRITTEN in both places and READ IN NEITHER — `isInvuln` was
  // imported into this file for the player path alone — so the intro card's own
  // comment ("invulnerable and inert while the card is up") had never once been
  // true, and a phase transition had no way to say "not yet".
  if (isInvuln(e.st)) {
    lastHit.blocked = true;
    if (!o.noNumber && src !== SRC.DOT) {
      damageNumbers.spawn(e.x, e.y - e.radius, 0, DMG_KIND.MISS, e.uid);
    }
    events.emit(EV.ENEMY_HIT, e, 0, src);
    return 0;
  }

  // --- shields (Warded elites, Susanoo, boss shield phases) -----------------
  if (e.st.shieldHits > 0 && src !== SRC.DOT) {
    e.st.shieldHits--;
    lastHit.blocked = true;
    if (!o.noNumber) damageNumbers.spawn(e.x, e.y - e.radius, 0, DMG_KIND.MISS, e.uid);
    events.emit(EV.ENEMY_HIT, e, 0, src);
    return 0;
  }

  // --- directional mitigation (shielders, Warded affix) --------------------
  let dmg = amount;
  if (e.shieldArc > 0 && o.fromX !== undefined && src !== SRC.DOT) {
    const ang = Math.atan2(o.fromY - e.y, o.fromX - e.x);
    let d = ang - e.facing;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) < e.shieldArc * 0.5) dmg *= (1 - e.shieldReduction);
  }

  // --- crit -----------------------------------------------------------------
  let crit = !!o.crit;
  if (!crit && o.canCrit !== false && p) {
    crit = runRng.chance(p.stats.critChance);
  }
  if (crit) dmg *= (p ? p.stats.critMult : 2);

  // --- element ---------------------------------------------------------------
  if (o.element && e.element) dmg *= elementMultiplier(o.element, e.element);

  // --- outgoing/incoming multipliers ----------------------------------------
  if (p) dmg *= damageMultiplierDealt(p.st);
  dmg *= damageMultiplierTaken(e.st);

  // --- armour: final = max(1, incoming - armor) (SECTION 3) -----------------
  const armor = armorAfterShred(e.armor || 0, e.st);
  if (armor > 0 && src !== SRC.EXECUTE) dmg = Math.max(1, dmg - armor);

  dmg = Math.max(0, dmg);
  if (dmg <= 0) return 0;

  // --- apply -----------------------------------------------------------------
  const before = e.hp;
  e.hp -= dmg;
  const dealt = Math.min(before, dmg);

  run.stats.damageDealt += dealt;
  if (crit) run.stats.crits++;

  // --- feedback --------------------------------------------------------------
  e.flashT = feel.hitFlashDuration;
  e.lastHitAt = run.time;

  if (!o.noNumber) {
    const kind = o.kind !== undefined ? o.kind
      : src === SRC.DOT ? DMG_KIND.DOT
      : crit ? DMG_KIND.CRIT : DMG_KIND.NORMAL;
    damageNumbers.spawn(e.x, e.y - e.radius * 0.8, dealt, kind, e.uid);
  }

  // Knockback, scaled by damage and resisted by weight (SECTION 3 juice list).
  if (o.knockback !== 0 && src !== SRC.DOT && !e.knockbackImmune) {
    const kb = Math.min(feel.knockbackMax, (o.knockback || dealt) * feel.knockbackPerDamage) / (e.weight || 1);
    if (kb > 1) {
      const fx = o.fromX !== undefined ? o.fromX : (p ? p.x : e.x);
      const fy = o.fromY !== undefined ? o.fromY : (p ? p.y : e.y);
      if (dirTo(fx, fy, e.x, e.y) > 0.001) {
        e.kbx += V.x * kb;
        e.kby += V.y * kb;
      }
    }
  }

  if (src !== SRC.DOT) {
    audio.play(crit ? 'crit' : 'hit');
    // ONE SPARK PER HIT IS A LUXURY A HORDE CANNOT AFFORD.
    //
    // A built player standing in a fast swarm lands 284 hits a tick, which asked
    // this line for ~789 particles a tick against an 800-particle cap: the pool
    // was completely churned every single frame (`_take` evicts the oldest when
    // full), every emit allocated a `colour|shape` cache key — about 47,000
    // string allocations a second of pure GC pressure — and the sparks were
    // evicted before they were ever drawn. It also handed the renderer a
    // permanently saturated 800-sprite pass carrying no information at all.
    // Measured: 0.252ms/tick for the emits alone, 0.033ms/tick once they stand
    // down above 60% of the cap.
    //
    // Crits always spark. They are the readable ones and they are a twentieth of
    // the hits. The budget sits deliberately ABOVE particles.js's RICH_LIMIT of
    // 320, so standing the sparks down can never flip the draw loop back into
    // its expensive halo-and-streak mode.
    if (crit || particles.count < SPARK_BUDGET) {
      particles.cone(e.x, e.y, Math.atan2(e.y - (o.fromY ?? e.y), e.x - (o.fromX ?? e.x)),
                     1.1, crit ? 5 : 2, crit ? '#ffd94a' : e.visual.color, HIT_SPARK);
    }
  }

  // --- lifesteal -------------------------------------------------------------
  if (p && p.stats.lifesteal > 0 && src !== SRC.DOT && src !== SRC.THORNS) {
    healPlayer(run, dealt * p.stats.lifesteal * (o.lifestealMult || 1), true);
  }

  lastHit.amount = dealt;
  lastHit.crit = crit;

  events.emit(EV.ENEMY_HIT, e, dealt, src);
  if (crit) events.emit('enemy:crit', e, dealt, src);

  if (e.hp <= 0) {
    lastHit.killed = true;
    lastHit.overkill = -e.hp;
    killEnemy(run, e, src);
  }

  return dealt;
}

/**
 * Instant, HP-ignoring removal. Kira's death timers and execute effects.
 * Bosses and elites cannot be executed — they take `bossDamage` instead
 * (SECTION 4: canonically he needs a face and a name).
 */
export function executeEnemy(run, e, bossDamage, src) {
  if (!e || !e.active || e.hp <= 0) return 0;
  if (e.isBoss || e.isElite) {
    return dealDamage(run, e, bossDamage || 400, src || SRC.EXECUTE,
                      { canCrit: false, kind: DMG_KIND.EXECUTE });
  }
  const dealt = e.hp;
  e.hp = 0;
  run.stats.damageDealt += dealt;
  damageNumbers.spawn(e.x, e.y - e.radius, 0, DMG_KIND.EXECUTE, e.uid);
  killEnemy(run, e, src || SRC.EXECUTE);
  return dealt;
}

/** The one place an enemy dies. Drops, particles, events, stats. */
export function killEnemy(run, e, src) {
  if (!e.active || e.dying) return;
  e.dying = true;
  e.hp = 0;

  run.stats.kills++;
  run.killStreak.count++;
  run.killStreak.t = feel.killStreakWindow;

  // Death particles: small enemies pop into 4, elites explode with a ring.
  const color = e.visual.color;
  if (e.isElite || e.isBoss) {
    particles.ring(e.x, e.y, feel.eliteRingParticles, '#ffd76a', 320, { life: 0.7 });
    particles.burst(e.x, e.y, feel.deathParticlesLarge, color, { speed: 260, life: 0.6, size: 0.9 });
    shake.medium();
    audio.play(e.isBoss ? 'bossDie' : 'eliteDie');
  } else {
    const n = e.size === 'large' ? feel.deathParticlesLarge
            : e.size === 'medium' ? feel.deathParticlesMedium : feel.deathParticlesSmall;
    particles.burst(e.x, e.y, n, color, { speed: 130, life: 0.36, size: 0.5 });
    audio.play('enemyDie');
  }

  run.onEnemyDeath(e, src);
  events.emit(EV.ENEMY_KILLED, e, src, run);
  if (e.isElite) events.emit(EV.ELITE_KILLED, e, src, run);
  if (e.isBoss) events.emit(EV.BOSS_KILLED, e, src, run);
}

// --- the player side ---------------------------------------------------------

/**
 * Damage the player. Handles dodge, armour, i-frames, hitstop, revives.
 * @returns {number} damage actually taken
 */
export function damagePlayer(run, amount, src, opts) {
  const p = run.player;
  const o = opts || EMPTY;
  if (!p || p.dead || amount <= 0) return 0;
  if (isInvuln(p.st) && !o.ignoreInvuln) return 0;
  if (p.iframeT > 0 && !o.ignoreIframes) return 0;

  // Dodge: a flat roll, capped at 60%, shows a "MISS" popup (SECTION 3).
  if (!o.undodgeable) {
    const dodge = Math.min(feel.dodgeCap, p.stats.dodge);
    if (dodge > 0 && runRng.chance(dodge)) {
      damageNumbers.spawn(p.x, p.y - 26, 0, DMG_KIND.MISS, -1);
      run.stats.dodges++;
      events.emit('player:dodged', src);
      return 0;
    }
  }

  // A one-hit shield (Susanoo Fragment, Nine-Seal Ward, Rei's S5) eats it whole.
  if (p.st.shieldHits > 0) {
    p.st.shieldHits--;
    damageNumbers.spawn(p.x, p.y - 26, 0, DMG_KIND.MISS, -1);
    events.emit('player:blocked', src);
    audio.play('escape');
    return 0;
  }

  let dmg = amount;
  if (!o.trueDamage) dmg = Math.max(1, dmg - p.stats.armor);
  // DRAGONHIDE: take no damage from any single hit below 10% of max HP.
  if (p.flags.dragonhide && dmg < p.maxHp * 0.10) return 0;
  dmg = Math.min(dmg, p.hp + 1e6);

  p.hp -= dmg;
  run.stats.damageTaken += dmg;
  p.iframeT = feel.iframeOnHit;
  p.flashT = 0.12;
  p.lastDamageAt = run.time;

  // Hitstop-lite: ONLY on player damage, never on enemy death (SECTION 3).
  run.requestHitstop(feel.hitstopDuration, feel.hitstopScale);
  shake.small(o.fromX !== undefined ? Math.sign(p.x - o.fromX) : 0,
              o.fromY !== undefined ? Math.sign(p.y - o.fromY) : 0);
  audio.play('playerHurt');
  damageNumbers.spawn(p.x, p.y - 30, dmg, DMG_KIND.NORMAL, -1);
  particles.burst(p.x, p.y, 6, '#ff5f7e', { speed: 170, life: 0.3, size: 0.5 });

  // Thorns / Vengeance: reflect a share of contact damage.
  if (p.stats.thorns > 0 && o.attacker && src === SRC.CONTACT) {
    dealDamage(run, o.attacker, dmg * p.stats.thorns, SRC.THORNS,
               { canCrit: false, knockback: 0 });
  }

  events.emit(EV.PLAYER_HURT, dmg, src, o.attacker);

  if (p.hp <= 0) run.onPlayerLethal(src, o);
  return dmg;
}

export function healPlayer(run, amount, silent) {
  const p = run.player;
  if (!p || p.dead || amount <= 0) return 0;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  const healed = p.hp - before;
  if (healed > 0.5 && !silent) {
    damageNumbers.spawn(p.x, p.y - 30, healed, DMG_KIND.HEAL, -1);
    audio.play('heal');
  }
  if (healed > 0) events.emit(EV.PLAYER_HEAL, healed);
  return healed;
}

/**
 * Area damage. The single implementation used by every explosion, nova, slam and
 * shockwave in the game — including boss attacks and hazards.
 *
 * @param falloff  0 = flat, 1 = linear falloff to the edge
 */
export function areaDamage(run, x, y, radius, amount, src, opts) {
  const o = opts || EMPTY;
  const hash = run.enemyHash;
  const items = run.enemies.items;
  // The broadphase margin has to cover the TARGET's radius as well as the
  // effect's, because the exact test below is `radius + e.radius`. Querying the
  // bare radius meant anything bigger than the cell overhang simply never came
  // back from the hash and quietly stopped being hittable.
  const n = hash.query(x, y, radius + run.enemies.queryPad);
  let hits = 0;
  for (let k = 0; k < n; k++) {
    const e = items[hash.resultAt(k)];
    if (!e || !e.active || e.hp <= 0) continue;
    if (o.excludeBosses && e.isBoss) continue;
    if (o.excludeElites && (e.isElite || e.isBoss)) continue;
    const dx = e.x - x, dy = e.y - y;
    const r = radius + e.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 > r * r) continue;
    let amt = amount;
    if (o.falloff) {
      const t = Math.sqrt(d2) / radius;
      amt *= 1 - o.falloff * clamp(t, 0, 1);
    }
    dealDamage(run, e, amt, src, {
      fromX: x, fromY: y, element: o.element, crit: o.crit, canCrit: o.canCrit,
      knockback: o.knockback, kind: o.kind, noNumber: o.noNumber,
    });
    hits++;
    if (o.onHit) o.onHit(e);
    if (o.maxTargets && hits >= o.maxTargets) break;
  }
  return hits;
}

/**
 * Damage everything on a line segment. Railguns, beams, dash trails, sweeps.
 * Walks the segment in radius-sized steps and dedupes with a tick stamp — which
 * is why every enemy carries `lastLineStamp`.
 */
export function lineDamage(run, x0, y0, x1, y1, halfWidth, amount, src, opts) {
  const o = opts || EMPTY;
  const hash = run.enemyHash;
  const items = run.enemies.items;
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const stepLen = Math.max(halfWidth, 24);
  const steps = Math.max(1, Math.ceil(len / stepLen));
  // The broadphase circle is centred on a SAMPLE but the exact test measures to
  // the SEGMENT, so it has to reach around the target AND across the sampling
  // gap. By the triangle inequality |sample -> enemy| is at most
  // (halfWidth + e.radius) + stepLen/2, and queryPad is already e.radius + 16 at
  // worst, so this is provably >= what the exact test can accept. For a narrow
  // beam that is pad + 12 instead of the old flat 140.
  const pad = run.enemies.queryPad + stepLen * 0.5;
  const stamp = ++run.lineStamp;
  let hits = 0;

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = x0 + dx * t, py = y0 + dy * t;
    const n = hash.query(px, py, halfWidth + pad);
    for (let k = 0; k < n; k++) {
      const e = items[hash.resultAt(k)];
      if (!e || !e.active || e.hp <= 0 || e.lastLineStamp === stamp) continue;
      // exact point-segment distance
      const ex = e.x - x0, ey = e.y - y0;
      let proj = (ex * dx + ey * dy) / (len * len);
      proj = clamp(proj, 0, 1);
      const cx = x0 + dx * proj, cy = y0 + dy * proj;
      const ddx = e.x - cx, ddy = e.y - cy;
      const rr = halfWidth + e.radius;
      if (ddx * ddx + ddy * ddy > rr * rr) continue;
      e.lastLineStamp = stamp;
      dealDamage(run, e, amount, src, {
        fromX: cx, fromY: cy, element: o.element, crit: o.crit,
        knockback: o.knockback, kind: o.kind,
      });
      hits++;
      if (o.onHit) o.onHit(e);
      if (o.maxTargets && hits >= o.maxTargets) return hits;
    }
  }
  return hits;
}

/** Damage everything inside a cone. Breath attacks, melee arcs, shotgun spreads. */
export function coneDamage(run, x, y, angle, arc, radius, amount, src, opts) {
  const o = opts || EMPTY;
  const hash = run.enemyHash;
  const items = run.enemies.items;
  const n = hash.query(x, y, radius + run.enemies.queryPad);
  const half = arc * 0.5;
  let hits = 0;
  for (let k = 0; k < n; k++) {
    const e = items[hash.resultAt(k)];
    if (!e || !e.active || e.hp <= 0) continue;
    const dx = e.x - x, dy = e.y - y;
    const r = radius + e.radius;
    if (dx * dx + dy * dy > r * r) continue;
    let d = Math.atan2(dy, dx) - angle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > half) continue;
    dealDamage(run, e, amount, src, {
      fromX: x, fromY: y, element: o.element, crit: o.crit,
      knockback: o.knockback, kind: o.kind,
    });
    hits++;
    if (o.onHit) o.onHit(e);
    if (o.maxTargets && hits >= o.maxTargets) break;
  }
  return hits;
}

const EMPTY = {};

/** Module-level, per the house rule: a hit may not build its own options bag. */
const HIT_SPARK = { speed: 150, life: 0.2, size: 0.34 };
/**
 * Live particles above which the per-hit spark stands down. 60% of the cap —
 * high enough that ordinary play never notices, low enough that a screen-filling
 * horde cannot churn the whole pool once per frame, and above RICH_LIMIT (320)
 * so it never re-enables the particle draw's extra passes as a side effect.
 */
const SPARK_BUDGET = CONFIG.MAX_PARTICLES * 0.6;
