// EVERY game-feel constant lives here, and nowhere else.
//
// This exists because juice tuning is the one part of the build that cannot be
// self-certified: an agent can implement a hit flash but cannot tell you whether
// 60ms feels right. So instead of hiding these numbers across twelve files, they
// are all here, all named, all range-annotated — and `F4` opens a live slider
// panel bound to this object. Drag until it feels good, hit "copy", paste the
// values back over the defaults. That is the whole workflow.
//
// SPEC ORIGIN is noted where the spec pins a number. `RANGE` is the sane band
// for the slider, not a hard clamp.

export const feel = {
  // --- movement (SECTION 3) --------------------------------------------------
  /** SPEC: base 165 px/s, per-character override. */
  moveSpeedBase: 165,
  /** SPEC: "no acceleration ramp longer than 80ms". RANGE 0.02-0.12 */
  accelTime: 0.07,
  decelTime: 0.05,
  /** SPEC: player hitbox radius 9px, drawn smaller than the sprite. */
  playerHitRadius: 9,

  // --- damage & defence (SECTION 3) -----------------------------------------
  /** SPEC: 0.5s per-enemy contact cooldown. */
  contactCooldown: 0.5,
  /** SPEC: 0.25s global i-frames after ANY damage. */
  iframeOnHit: 0.25,
  /** DECISIONS.md §34: 60ms at 0.35x, resolving the spec's 120/60 conflict. */
  hitstopDuration: 0.06,
  hitstopScale: 0.35,
  /** SPEC: dodge cap 60%. */
  dodgeCap: 0.60,

  // --- juice checklist (SECTION 3) ------------------------------------------
  /** SPEC: enemy tints white for 60ms. RANGE 0.03-0.14 */
  hitFlashDuration: 0.06,
  /** Knockback impulse per point of damage, before weight resistance. RANGE 1-14 */
  knockbackPerDamage: 5.5,
  knockbackMax: 420,
  /** How fast knockback bleeds off. Higher = snappier. RANGE 4-20 */
  knockbackDecay: 11,

  /** Screen shake, in world px of camera offset. RANGE 0-30 */
  shakeSmall: 3.5,
  shakeMedium: 9,
  shakeBig: 20,
  shakeDecay: 8.5,
  /** Shake trauma is squared, which makes small hits nearly invisible and big ones violent. */
  shakeExponent: 2,

  /** SPEC: camera deadzone 24px, lerp 0.15, lookahead up to 40px. */
  cameraDeadzone: 24,
  cameraLerp: 0.15,
  cameraLookahead: 40,
  /** SPEC: punch-out 1.0 -> 1.06 over 0.4s on special. */
  punchZoom: 0.06,
  punchDuration: 0.4,

  /** Damage number motion. */
  dmgNumberRise: 46,
  dmgNumberLife: 0.75,
  dmgNumberCritScale: 1.5,
  dmgNumberSpread: 16,
  /** SPEC: aggregate hits on the same enemy inside this window into one number. */
  dmgNumberStackWindow: 0.2,

  /** SPEC: gems accelerate toward the player with easing, not linearly. */
  magnetAccel: 2100,
  magnetMaxSpeed: 1500,
  magnetSnapDistance: 16,
  /** Gems get a brief outward pop before they are collectable — it reads as loot. */
  gemPopSpeed: 130,
  gemPopTime: 0.28,

  /** SPEC: level-up freeze frame, radial flash, ascending chime, cards fly in. */
  levelUpFreeze: 0.12,
  levelUpFlashTime: 0.35,

  /** SPEC: red vignette pulsing with a heartbeat under 25% HP. */
  lowHpThreshold: 0.25,
  lowHpPulseHz: 1.1,

  /** SPEC: kill streak counter appears at 25+ kills in 3 seconds. */
  killStreakThreshold: 25,
  killStreakWindow: 3.0,

  /** Death effects: small enemies pop into 4 particles; elites ring-explode. */
  deathParticlesSmall: 4,
  deathParticlesMedium: 7,
  deathParticlesLarge: 14,
  eliteRingParticles: 28,
  particleLife: 0.5,
  particleDrag: 5.0,

  // --- enemy behaviour -------------------------------------------------------
  /** SPEC: soft separation so hordes spread into readable blobs. RANGE 0-260 */
  separationForce: 92,
  separationRadius: 22,
  /** How hard enemies steer around static obstacles (DECISIONS.md §18). */
  avoidanceForce: 200,
  avoidanceLookahead: 46,
  /** SPEC: shielders must be flankable — DECISIONS.md §31. */
  shielderTurnRate: Math.PI / 2,   // 90 deg/s
  shielderFacingLag: 0.4,

  /** Telegraph timings. SPEC: 0.8-1.2s on anything lethal; ambush 0.6-0.7s. */
  telegraphLethal: 1.0,
  telegraphCharge: 0.8,
  telegraphAmbush: 0.7,
  telegraphTruck: 1.5,

  // --- pacing ----------------------------------------------------------------
  /** SPEC: 5 seconds of NOTHING before the final boss. */
  preBossCalm: 5,
  bossIntroDuration: 2.4,
  bossDeathSlowmo: 1.2,
  bossDeathScale: 0.25,

  // --- accessibility floors --------------------------------------------------
  /** With reduceFlashing on, no visual may flash faster than this. */
  maxFlashHz: 3,
};

/** Slider metadata for the F4 panel: [min, max, step]. */
export const FEEL_RANGES = {
  moveSpeedBase: [80, 320, 1],
  accelTime: [0, 0.25, 0.005],
  decelTime: [0, 0.25, 0.005],
  playerHitRadius: [4, 20, 0.5],
  contactCooldown: [0.15, 1.2, 0.05],
  iframeOnHit: [0, 1.0, 0.01],
  hitstopDuration: [0, 0.3, 0.005],
  hitstopScale: [0.05, 1, 0.01],
  hitFlashDuration: [0, 0.3, 0.005],
  knockbackPerDamage: [0, 20, 0.1],
  knockbackMax: [0, 900, 10],
  knockbackDecay: [1, 30, 0.5],
  shakeSmall: [0, 20, 0.25],
  shakeMedium: [0, 40, 0.5],
  shakeBig: [0, 70, 1],
  shakeDecay: [2, 25, 0.25],
  cameraDeadzone: [0, 140, 1],
  cameraLerp: [0.02, 0.6, 0.01],
  cameraLookahead: [0, 200, 2],
  punchZoom: [0, 0.3, 0.005],
  punchDuration: [0.1, 1.5, 0.05],
  dmgNumberRise: [0, 160, 2],
  dmgNumberLife: [0.2, 2, 0.05],
  dmgNumberCritScale: [1, 3, 0.05],
  magnetAccel: [200, 6000, 50],
  magnetMaxSpeed: [200, 4000, 50],
  gemPopSpeed: [0, 400, 5],
  levelUpFreeze: [0, 0.6, 0.01],
  lowHpThreshold: [0.05, 0.6, 0.01],
  killStreakThreshold: [5, 100, 1],
  separationForce: [0, 400, 5],
  separationRadius: [8, 60, 1],
  avoidanceForce: [0, 600, 10],
  telegraphLethal: [0.3, 2.5, 0.05],
  telegraphCharge: [0.2, 2, 0.05],
  particleLife: [0.1, 2, 0.05],
  bossDeathSlowmo: [0, 3, 0.1],
};

const DEFAULTS = Object.assign({}, feel);

export function resetFeel() { Object.assign(feel, DEFAULTS); }

/** What the F4 panel's "copy" button emits — paste straight over the defaults. */
export function exportFeel() {
  const lines = [];
  for (const k of Object.keys(feel)) {
    if (feel[k] !== DEFAULTS[k]) lines.push(`  ${k}: ${+feel[k].toFixed(4)},`);
  }
  return lines.length ? '// changed from defaults:\n' + lines.join('\n') : '// no changes';
}
