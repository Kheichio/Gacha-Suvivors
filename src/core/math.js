// Allocation-free math helpers. Nothing here may return a new object.
// Vector results are written into module-level scratch registers; callers read
// them immediately. See DECISIONS.md §35 (zero allocation in the hot loop).

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

/** Frame-rate independent exponential smoothing. `t` is the fraction per 1/60s. */
export const damp = (a, b, t, dt) => lerp(a, b, 1 - Math.pow(1 - t, dt * 60));

export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

/** True when two circles overlap. The only broadphase-free collision test used. */
export const circleHit = (ax, ay, ar, bx, by, br) => {
  const dx = bx - ax, dy = by - ay, r = ar + br;
  return dx * dx + dy * dy <= r * r;
};

export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);

/** Shortest signed angular delta from `a` to `b`, in (-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Rotate `from` toward `to` by at most `maxStep` radians. */
export function rotateToward(from, to, maxStep) {
  const d = angleDelta(from, to);
  if (d > maxStep) return from + maxStep;
  if (d < -maxStep) return from - maxStep;
  return to;
}

/** Snap an angle to one of N evenly spaced steps (for the rotation atlas). */
export const quantizeAngle = (a, steps) => {
  const i = Math.round(((a % TAU) + TAU) % TAU / TAU * steps) % steps;
  return i;
};

// --- scratch vector registers ------------------------------------------------
// `vx`/`vy` are the general-purpose out-params. Read them on the very next line;
// any nested call may clobber them.
export const V = { x: 0, y: 0 };

/** Normalise (x, y) into V. Zero-length input yields (0, 0). */
export function normalize(x, y) {
  const l = Math.sqrt(x * x + y * y);
  if (l < 1e-9) { V.x = 0; V.y = 0; return 0; }
  V.x = x / l; V.y = y / l;
  return l;
}

/** Unit vector from a to b, into V. Returns the distance. */
export function dirTo(ax, ay, bx, by) {
  return normalize(bx - ax, by - ay);
}

/** Clamp a vector's magnitude, into V. */
export function limit(x, y, max) {
  const l2 = x * x + y * y;
  if (l2 <= max * max || l2 < 1e-12) { V.x = x; V.y = y; return; }
  const l = Math.sqrt(l2);
  V.x = x / l * max; V.y = y / l * max;
}

// --- easing ------------------------------------------------------------------
export const easeOutCubic  = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic   = (t) => t * t * t;
export const easeOutQuad   = (t) => t * (2 - t);
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutBack   = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
export const easeOutElastic = (t) => {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1;
};
/** The XP-gem magnet arc: slow start, violent finish. */
export const easeInExpo = (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10));

// --- formatting --------------------------------------------------------------
export function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = (s / 60) | 0;
  const r = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
}

export function formatNumber(n) {
  const v = Math.round(n);
  if (v < 1000) return '' + v;
  if (v < 1e6) return (v / 1000).toFixed(v < 10000 ? 1 : 0) + 'K';
  return (v / 1e6).toFixed(v < 1e7 ? 1 : 0) + 'M';
}

// --- colour ------------------------------------------------------------------
/** '#rrggbb' -> 0xrrggbb. Boot-time only; never call this in a draw loop. */
export function hexToInt(hex) {
  return parseInt(hex.charAt(0) === '#' ? hex.slice(1) : hex, 16) | 0;
}

/** Mix two '#rrggbb' strings. Boot-time / UI only — allocates a string. */
export function mixHex(a, b, t) {
  const A = hexToInt(a), B = hexToInt(b);
  const r = Math.round(lerp((A >> 16) & 255, (B >> 16) & 255, t));
  const g = Math.round(lerp((A >> 8) & 255, (B >> 8) & 255, t));
  const bl = Math.round(lerp(A & 255, B & 255, t));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

/** Lighten/darken a hex colour. Boot-time only. */
export const shade = (hex, amt) => mixHex(hex, amt > 0 ? '#ffffff' : '#000000', Math.abs(amt));

export function withAlpha(hex, a) {
  const v = hexToInt(hex);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}
