// The AdaptiveDirector — adaptive difficulty. Subtle, never obvious.
//
// SECTION 8's three rules, implemented literally:
//   pressure = (enemies within 300px) + (recent damage taken * 3)
//   pressure < 20 for 15 straight seconds -> up to +25% spawn rate, pull the
//     next wave event forward
//   player below 25% HP -> -15% spawn rate for 10s, better heart drops
//   NEVER modify enemy stats. Only spawn rate and pickup luck. Players can feel
//     stat cheating and they hate it.
//
// That last rule is the reason this class exposes exactly two multipliers and
// nothing else. There is no hook here that could reach an enemy's HP.

import { clamp, damp, dist2 } from '../core/math.js';

const LOW_PRESSURE = 20;
const LOW_PRESSURE_WINDOW = 15;
const MAX_SPAWN_BOOST = 1.25;
const RELIEF_SPAWN_MULT = 0.85;
const RELIEF_DURATION = 10;

export class AdaptiveDirector {
  constructor(run) {
    this.run = run;
    this.pressure = 0;
    this.smoothedPressure = 0;
    this.lowT = 0;
    this.reliefT = 0;
    this.recentDamage = 0;

    /** The only two things this system is allowed to touch. */
    this.spawnRateMult = 1;
    this.luckBonus = 0;

    this._sampleT = 0;
    this._nearby = 0;
  }

  reset() {
    this.pressure = 0; this.smoothedPressure = 0;
    this.lowT = 0; this.reliefT = 0; this.recentDamage = 0;
    this.spawnRateMult = 1; this.luckBonus = 0;
  }

  /** Called from damage.js's player-hurt path via the run. */
  onPlayerDamaged(amount) { this.recentDamage += amount; }

  update(dt) {
    const run = this.run;
    const p = run.player;

    // Recent damage decays over ~4 seconds.
    this.recentDamage = Math.max(0, this.recentDamage - this.recentDamage * dt * 0.25);

    // Sample the crowd 4x/second, not every tick — the number barely moves and
    // the query is the expensive part.
    this._sampleT -= dt;
    if (this._sampleT <= 0) {
      this._sampleT = 0.25;
      this._nearby = 0;
      const hash = run.enemyHash;
      const items = run.enemies.items;
      const n = hash.query(p.x, p.y, 300);
      for (let k = 0; k < n; k++) {
        const e = items[hash.resultAt(k)];
        if (e && e.active && e.hp > 0 && dist2(e.x, e.y, p.x, p.y) < 300 * 300) this._nearby++;
      }
    }

    this.pressure = this._nearby + this.recentDamage * 3;
    this.smoothedPressure = damp(this.smoothedPressure, this.pressure, 0.12, dt);

    // --- rule 1: bored player -------------------------------------------------
    if (this.pressure < LOW_PRESSURE) {
      this.lowT += dt;
    } else {
      this.lowT = 0;
    }
    let target = 1;
    if (this.lowT > LOW_PRESSURE_WINDOW) {
      const over = clamp((this.lowT - LOW_PRESSURE_WINDOW) / 10, 0, 1);
      target = 1 + (MAX_SPAWN_BOOST - 1) * over;
      // "pull the next wave event forward" — but only during the boring stretch,
      // and never past a boss anchor.
      run.pullWaveForward(dt * 0.35 * over);
    }

    // --- rule 2: struggling player -------------------------------------------
    const hpFrac = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    if (hpFrac < 0.25) this.reliefT = RELIEF_DURATION;
    if (this.reliefT > 0) {
      this.reliefT -= dt;
      target = Math.min(target, RELIEF_SPAWN_MULT);
      this.luckBonus = 1.6;          // better heart drops, nothing else
    } else {
      this.luckBonus = 0;
    }

    // Ramp rather than snap, so nothing about this is perceptible.
    this.spawnRateMult = damp(this.spawnRateMult, target, 0.05, dt);
  }

  /** Heart drop weight multiplier, consumed by the drop tables. */
  get heartLuck() { return 1 + this.luckBonus; }

  /** Debug read-out for the F3 overlay. This never surfaces in the game UI. */
  debugString() {
    return `pressure ${this.smoothedPressure.toFixed(0)} spawn x${this.spawnRateMult.toFixed(2)}` +
           (this.reliefT > 0 ? ' RELIEF' : '') +
           (this.lowT > LOW_PRESSURE_WINDOW ? ' BOOST' : '');
  }
}
