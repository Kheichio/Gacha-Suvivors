// Status effects.
//
// Every effect is a fixed slot on a pooled entity's `st` object — allocated once
// when the pool is built, never again. No Map, no array of effect objects, no
// per-frame filtering. Adding a new effect means adding two numbers here, not a
// new allocation path.

import { clamp } from '../core/math.js';

/** Called once per pooled entity, at pool construction. */
export function makeStatus() {
  return {
    // damage over time
    burnT: 0, burnDps: 0, burnPerm: 0,     // burnPerm: Amaterasu never expires
    bleedT: 0, bleedPct: 0,                // % of MAX hp per second
    poisonT: 0, poisonDps: 0,

    // control
    slowT: 0, slowMult: 1,
    stunT: 0,
    chillT: 0,
    tauntT: 0, tauntX: 0, tauntY: 0,
    pullT: 0, pullX: 0, pullY: 0, pullForce: 0,

    // debuffs
    shredT: 0, shredAmt: 0,                // flat armor reduction
    vulnT: 0, vulnMult: 1,                 // incoming damage multiplier
    noRegenT: 0,                           // Sunlight: prevents elite/boss regen

    // marks
    markT: 0, markKind: 0, markSrc: 0,     // Kira's death timer; Kagura's ofuda
    markMax: 0,

    // buffs (used by the player and by minions)
    hasteT: 0, hasteMult: 1,
    empowerT: 0, empowerMult: 1,
    shieldHits: 0,
    invulnT: 0,
    untargetableT: 0,
    intangibleT: 0,
  };
}

export function clearStatus(st) {
  st.burnT = 0; st.burnDps = 0; st.burnPerm = 0;
  st.bleedT = 0; st.bleedPct = 0;
  st.poisonT = 0; st.poisonDps = 0;
  st.slowT = 0; st.slowMult = 1;
  st.stunT = 0; st.chillT = 0;
  st.tauntT = 0; st.pullT = 0; st.pullForce = 0;
  st.shredT = 0; st.shredAmt = 0;
  st.vulnT = 0; st.vulnMult = 1;
  st.noRegenT = 0;
  st.markT = 0; st.markKind = 0; st.markSrc = 0; st.markMax = 0;
  st.hasteT = 0; st.hasteMult = 1;
  st.empowerT = 0; st.empowerMult = 1;
  st.shieldHits = 0; st.invulnT = 0; st.untargetableT = 0; st.intangibleT = 0;
}

export const MARK = { NONE: 0, DEATH_TIMER: 1, OFUDA: 2, AMATERASU: 3, NAPE: 4 };

// --- appliers ----------------------------------------------------------------
// All take (st, ...) and take the STRONGER of the existing and incoming effect
// rather than stacking blindly. That is what keeps 200 overlapping burns from
// deleting a boss instantly.

export function applyBurn(st, dps, duration, permanent) {
  if (permanent) { st.burnPerm = 1; st.burnDps = Math.max(st.burnDps, dps); st.burnT = 1e9; return; }
  if (dps >= st.burnDps) { st.burnDps = dps; st.burnT = Math.max(st.burnT, duration); }
  else st.burnT = Math.max(st.burnT, duration * 0.5);
}

export function applyBleed(st, pctPerSec, duration) {
  st.bleedPct = Math.max(st.bleedPct, pctPerSec);
  st.bleedT = Math.max(st.bleedT, duration);
}

export function applyPoison(st, dps, duration) {
  st.poisonDps = Math.max(st.poisonDps, dps);
  st.poisonT = Math.max(st.poisonT, duration);
}

/** mult < 1 slows. Stronger slow wins; durations extend. */
export function applySlow(st, mult, duration) {
  if (mult < st.slowMult || st.slowT <= 0) st.slowMult = mult;
  st.slowT = Math.max(st.slowT, duration);
}

export function applyStun(st, duration) { st.stunT = Math.max(st.stunT, duration); }

export function applyTaunt(st, duration, x, y) {
  st.tauntT = Math.max(st.tauntT, duration);
  st.tauntX = x; st.tauntY = y;
}

export function applyPull(st, duration, x, y, force) {
  st.pullT = Math.max(st.pullT, duration);
  st.pullX = x; st.pullY = y; st.pullForce = Math.max(st.pullForce, force);
}

export function applyShred(st, amount, duration) {
  st.shredAmt = Math.max(st.shredAmt, amount);
  st.shredT = Math.max(st.shredT, duration);
}

export function applyVulnerable(st, mult, duration) {
  st.vulnMult = Math.max(st.vulnMult, mult);
  st.vulnT = Math.max(st.vulnT, duration);
}

/** Rin's Sunlight: prevents elite and boss regeneration. */
export function applyNoRegen(st, duration) { st.noRegenT = Math.max(st.noRegenT, duration); }

export function applyMark(st, kind, duration, src) {
  // A stronger mark overwrites a weaker one; a death timer is never downgraded.
  if (st.markKind === MARK.DEATH_TIMER && kind !== MARK.DEATH_TIMER) return;
  st.markKind = kind;
  st.markT = duration;
  st.markMax = duration;
  st.markSrc = src || 0;
}

export function applyHaste(st, mult, duration) {
  st.hasteMult = Math.max(st.hasteMult, mult);
  st.hasteT = Math.max(st.hasteT, duration);
}

export function applyEmpower(st, mult, duration) {
  st.empowerMult = Math.max(st.empowerMult, mult);
  st.empowerT = Math.max(st.empowerT, duration);
}

export function applyInvuln(st, duration) { st.invulnT = Math.max(st.invulnT, duration); }
export function applyUntargetable(st, duration) { st.untargetableT = Math.max(st.untargetableT, duration); }
export function applyIntangible(st, duration) { st.intangibleT = Math.max(st.intangibleT, duration); }
export function addShield(st, hits) { st.shieldHits += hits; }

// --- queries -----------------------------------------------------------------
export const isStunned = (st) => st.stunT > 0;
export const isInvuln = (st) => st.invulnT > 0;
export const isUntargetable = (st) => st.untargetableT > 0 || st.intangibleT > 0;
export const speedMultiplier = (st) => (st.slowT > 0 ? st.slowMult : 1) * (st.hasteT > 0 ? st.hasteMult : 1);
export const damageMultiplierTaken = (st) => (st.vulnT > 0 ? st.vulnMult : 1);
export const damageMultiplierDealt = (st) => (st.empowerT > 0 ? st.empowerMult : 1);
export const armorAfterShred = (armor, st) => Math.max(0, armor - (st.shredT > 0 ? st.shredAmt : 0));
export const canRegen = (st) => st.noRegenT <= 0;
export const hasAnyDot = (st) => st.burnT > 0 || st.bleedT > 0 || st.poisonT > 0;

/**
 * Advance every timer and return TOTAL DoT damage for this tick.
 *
 * The caller is responsible for routing that damage through damage.js — this
 * function never touches HP itself, because damage.js is the single choke point
 * for all damage in the game and DoTs are not an exception to that.
 *
 * @param maxHp used for the percent-based bleed
 * @returns {number} damage to apply, already summed
 */
export function tickStatus(st, dt, maxHp) {
  let dmg = 0;

  if (st.burnT > 0) {
    dmg += st.burnDps * dt;
    if (!st.burnPerm) { st.burnT -= dt; if (st.burnT <= 0) { st.burnT = 0; st.burnDps = 0; } }
  }
  if (st.bleedT > 0) {
    dmg += maxHp * st.bleedPct * dt;
    st.bleedT -= dt;
    if (st.bleedT <= 0) { st.bleedT = 0; st.bleedPct = 0; }
  }
  if (st.poisonT > 0) {
    dmg += st.poisonDps * dt;
    st.poisonT -= dt;
    if (st.poisonT <= 0) { st.poisonT = 0; st.poisonDps = 0; }
  }

  if (st.slowT > 0) { st.slowT -= dt; if (st.slowT <= 0) { st.slowT = 0; st.slowMult = 1; } }
  if (st.stunT > 0) st.stunT -= dt;
  if (st.chillT > 0) st.chillT -= dt;
  if (st.tauntT > 0) st.tauntT -= dt;
  if (st.pullT > 0) { st.pullT -= dt; if (st.pullT <= 0) st.pullForce = 0; }
  if (st.shredT > 0) { st.shredT -= dt; if (st.shredT <= 0) st.shredAmt = 0; }
  if (st.vulnT > 0) { st.vulnT -= dt; if (st.vulnT <= 0) st.vulnMult = 1; }
  if (st.noRegenT > 0) st.noRegenT -= dt;
  if (st.hasteT > 0) { st.hasteT -= dt; if (st.hasteT <= 0) st.hasteMult = 1; }
  if (st.empowerT > 0) { st.empowerT -= dt; if (st.empowerT <= 0) st.empowerMult = 1; }
  if (st.invulnT > 0) st.invulnT -= dt;
  if (st.untargetableT > 0) st.untargetableT -= dt;
  if (st.intangibleT > 0) st.intangibleT -= dt;

  // Marks are NOT decremented here — the systems that own them (Kira's write,
  // Kagura's ofuda) tick them, because expiry has an effect, not just a clear.

  return dmg;
}

/** Tint colour for the entity outline, so status is readable at a glance. */
export function statusTint(st) {
  if (st.stunT > 0) return '#ffe14a';
  if (st.burnT > 0) return '#ff7a3d';
  if (st.markKind === MARK.DEATH_TIMER) return '#ff3a5e';
  if (st.bleedT > 0) return '#e0405f';
  if (st.slowT > 0) return '#6ad8ff';
  return null;
}
