// GACHA SURVIVORS — ELEMENTS
// ============================================================================
// Seven elements were declared and assigned all over SECTION 3 and never once
// read. DECISIONS.md §26 makes them real, cheaply: a flat ±15% multiplier,
// surfaced in the codex and as a tint on the damage number. Every enemy carries
// an element; every character carries one; Rin's "water, special converts to
// fire" is now a literal element swap on his special, not flavour text.
//
// ±15% is deliberately small. It is a nudge that makes stage/character choice
// mean something, not a rock-paper-scissors gate that locks a roster out of a
// stage. Nothing in the balance targets assumes it.
//
// `color` is the codex swatch AND the damage-number tint, so every one of these
// has to stay legible against a dark arena at 12px. `icon` is the codex glyph.
// No ref strings live here (DECISIONS.md §22).
// ============================================================================

export const ELEMENTS = {
  fire:      { name: 'Fire',      color: '#ff7a3d', icon: '🔥' },
  water:     { name: 'Water',     color: '#5fd0ff', icon: '💧' },
  lightning: { name: 'Lightning', color: '#ffe14a', icon: '⚡' },
  steel:     { name: 'Steel',     color: '#c3ccdd', icon: '⚔' },
  // Shadow sits at a bluer, deeper violet than Spirit's #c58cff on purpose —
  // the two are adjacent in hue and must never be confused mid-fight.
  shadow:    { name: 'Shadow',    color: '#7c5cd6', icon: '🌑' },
  light:     { name: 'Light',     color: '#fff3b0', icon: '✨' },
  spirit:    { name: 'Spirit',    color: '#c58cff', icon: '👻' },
};

/** The whole system. 15% up if you are strong, 15% down if you are weak. */
export const ELEMENT_BONUS = 0.15;

/**
 * Attacker element -> the elements it is STRONG against.
 *
 *   ring:   fire > steel > lightning > water > fire
 *   mutual: shadow <-> light  (each beats the other — light burns away shadow,
 *           shadow smothers light; the mirror match is the point)
 *   spirit: neutral both ways. It hits nothing hard and nothing hits it hard.
 *
 * The reverse direction is NOT a second table — elementMultiplier reads this
 * one from both sides, so the ring can never desynchronise from itself.
 */
export const STRONG_AGAINST = {
  fire: ['steel'],
  steel: ['lightning'],
  lightning: ['water'],
  water: ['fire'],
  shadow: ['light'],
  light: ['shadow'],
  spirit: [],
};

/**
 * The ONE function permitted in the data layer: a pure lookup, no state, no
 * allocation, safe to call once per damage event in the hot loop.
 *
 * Unknown or missing elements (a prop, an environmental hazard, a projectile
 * that never declared one) fall through to 1 rather than throwing.
 *
 * @param {string} attacker element id
 * @param {string} defender element id
 * @returns {number} 1.15, 0.85, or 1
 */
export function elementMultiplier(attacker, defender) {
  const strong = STRONG_AGAINST[attacker];
  if (strong !== undefined && strong.indexOf(defender) !== -1) return 1 + ELEMENT_BONUS;
  const counter = STRONG_AGAINST[defender];
  if (counter !== undefined && counter.indexOf(attacker) !== -1) return 1 - ELEMENT_BONUS;
  return 1;
}
