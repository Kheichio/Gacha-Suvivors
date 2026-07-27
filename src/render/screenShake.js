// Trauma-based screen shake.
//
// Trauma decays linearly; the offset is trauma^2 (feel.shakeExponent). That
// curve is what makes a chip-damage hit almost invisible and a nova ult violent,
// from the same code path.
//
// Respects two accessibility settings: `shakeIntensity` (0..1, including OFF)
// and the global `screenShakeOff` toggle.

import { feel } from '../core/feel.js';
import { save } from '../core/save.js';
import { fxRng } from '../core/rng.js';
import { clamp } from '../core/math.js';

class ScreenShake {
  constructor() {
    this.trauma = 0;
    this.x = 0; this.y = 0;
    this.rot = 0;
    /** Directional kick — a boss slam from the left pushes the camera right. */
    this.dirX = 0; this.dirY = 0;
    this.dirMag = 0;
    this._t = 0;
  }

  /** @param amount trauma to add, 0..1. Use feel.shakeSmall/Medium/Big scaled. */
  add(amount, dirX, dirY) {
    const s = this._intensity();
    if (s <= 0) return;
    this.trauma = clamp(this.trauma + amount * s, 0, 1);
    if (dirX !== undefined) {
      this.dirX = dirX; this.dirY = dirY || 0;
      this.dirMag = Math.min(1, this.dirMag + amount * s);
    }
  }

  /** Convenience wrappers matching the spec's three tiers. */
  small(dx, dy) { this.add(feel.shakeSmall / 40, dx, dy); }
  medium(dx, dy) { this.add(feel.shakeMedium / 40, dx, dy); }
  big(dx, dy) { this.add(feel.shakeBig / 40, dx, dy); }

  _intensity() {
    const s = save.data.settings;
    if (s.screenShakeOff) return 0;
    return clamp(s.shakeIntensity === undefined ? 1 : s.shakeIntensity, 0, 2);
  }

  update(dt) {
    this._t += dt;
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - feel.shakeDecay * dt * 0.12);
    }
    if (this.dirMag > 0) this.dirMag = Math.max(0, this.dirMag - dt * 4.5);

    const t = Math.pow(this.trauma, feel.shakeExponent);
    if (t < 0.0005 && this.dirMag < 0.0005) {
      this.x = 0; this.y = 0; this.rot = 0;
      return;
    }
    const mag = t * feel.shakeBig * 2.4;
    // Sampled noise rather than pure random: the motion stays coherent frame to
    // frame instead of looking like static.
    this.x = (noise(this._t * 34.0) * 2 - 1) * mag + this.dirX * this.dirMag * feel.shakeMedium;
    this.y = (noise(this._t * 34.0 + 91.7) * 2 - 1) * mag + this.dirY * this.dirMag * feel.shakeMedium;
    this.rot = (noise(this._t * 22.0 + 41.3) * 2 - 1) * t * 0.012;
  }

  reset() { this.trauma = 0; this.x = 0; this.y = 0; this.rot = 0; this.dirMag = 0; }
}

/** Cheap 1D value noise with smooth interpolation. No allocation. */
function noise(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}
function hash1(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const shake = new ScreenShake();

// --- flash controller --------------------------------------------------------
// Screen flashes are the photosensitivity risk. Every full-screen flash in the
// game routes through here, which enforces a global minimum interval when
// `reduceFlashing` is on — the per-effect throttle is not enough, because the
// hazard is the COMPOSITE of simultaneous flashes.

class FlashController {
  constructor() {
    this.alpha = 0;
    this.color = '#ffffff';
    this.decay = 6;
    this._lastAt = -999;
    this.time = 0;
    this.suppressed = 0;
  }

  /** @param strength 0..1 */
  fire(color, strength, decay) {
    this.time = this.time || 0;
    const reduce = save.data.settings.reduceFlashing;
    if (reduce) {
      const minGap = 1 / feel.maxFlashHz;
      if (this.time - this._lastAt < minGap) { this.suppressed++; return; }
      strength = Math.min(strength, 0.28);   // and cap the amplitude, not just the rate
    }
    this._lastAt = this.time;
    this.color = color || '#ffffff';
    this.alpha = Math.max(this.alpha, strength);
    this.decay = decay || 6;
  }

  update(dt) {
    this.time += dt;
    if (this.alpha > 0) this.alpha = Math.max(0, this.alpha - this.decay * dt);
  }

  reset() { this.alpha = 0; this._lastAt = -999; }
}

export const flash = new FlashController();
