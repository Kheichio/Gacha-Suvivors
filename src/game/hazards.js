// Telegraphs, damage fields, and the six stage hazards.
//
// TELEGRAPHS are the difference between "hard" and "unfair" (SECTION 9). Every
// lethal thing in the game draws one through this system, which enforces the
// colour language AND pairs every colour with a SHAPE — because SECTION 13 says
// no critical information may be conveyed by colour alone.
//
//   red = damage zone, get out          (x marks)
//   yellow = wind-up, from this way     (arrow)
//   blue = safe zone, stand here        (circle)
//   white = unavoidable, escape NOW     (bang)

import { Pool } from '../core/pool.js';
import { runRng, fxRng } from '../core/rng.js';
import { feel } from '../core/feel.js';
import { particles } from '../render/particles.js';
import { audio } from '../core/audio.js';
import { floaters } from '../render/damageNumbers.js';
import { clamp, dist2, TAU, lerp, easeOutCubic } from '../core/math.js';
import { areaDamage, damagePlayer, dealDamage, SRC } from './damage.js';
import { applySlow, applyBurn } from './statusEffects.js';
import { TELEGRAPH_COLORS, TELEGRAPH_SHAPES } from '../data/bosses.js';

// --- telegraphs --------------------------------------------------------------
function makeTelegraph() {
  return {
    active: false, _i: 0,
    kind: 0,            // 0 circle, 1 line, 2 cone, 3 ring
    x: 0, y: 0, x2: 0, y2: 0, radius: 0, angle: 0, arc: 0, width: 0,
    t: 0, duration: 1, color: '#ff3a5e', shape: 'x', flashLast: false,
  };
}

// --- damage fields -----------------------------------------------------------
function makeField() {
  return {
    active: false, _i: 0,
    x: 0, y: 0, radius: 0,
    t: 0, duration: 1,
    dps: 0, effect: 0,   // 0 damage, 1 chill, 2 burn, 3 pull, 4 heal
    param: 0,
    color: '#ff7a3d',
    tickT: 0,
    hitsPlayer: false, hitsEnemies: true,
    followHost: null,
  };
}

export const FIELD = { DAMAGE: 0, CHILL: 1, BURN: 2, PULL: 3, HEAL: 4, SUNLIGHT: 5 };

export class HazardSystem {
  constructor(run) {
    this.run = run;
    this.telegraphs = new Pool(makeTelegraph, () => {}, 64, 256, true);
    this.fields = new Pool(makeField, (f) => { f.followHost = null; }, 64, 256, true);

    // stage hazard state
    this.kind = null;
    this.params = null;
    this.t = 0;
    this.lanes = null;
    this.visibilityRadius = 0;
    this.tidePhase = 0;
    this.tideHigh = false;
    this.spotlights = null;
    this.roomT = 0;
  }

  // --- telegraphs -----------------------------------------------------------
  telegraph(x, y, radius, duration, color, shape) {
    const t = this.telegraphs.spawn();
    if (!t) return null;
    t.kind = 0;
    t.x = x; t.y = y; t.radius = radius;
    t.t = 0; t.duration = duration;
    t.color = TELEGRAPH_COLORS[color] || color || TELEGRAPH_COLORS.red;
    t.shape = shape || TELEGRAPH_SHAPES[color] || 'x';
    t.flashLast = true;
    if (duration > 0.5) audio.play('telegraph');
    return t;
  }

  telegraphLine(x0, y0, x1, y1, width, duration, color, shape) {
    const t = this.telegraphs.spawn();
    if (!t) return null;
    t.kind = 1;
    t.x = x0; t.y = y0; t.x2 = x1; t.y2 = y1; t.width = width;
    t.t = 0; t.duration = duration;
    t.color = TELEGRAPH_COLORS[color] || color || TELEGRAPH_COLORS.red;
    t.shape = shape || TELEGRAPH_SHAPES[color] || 'arrow';
    return t;
  }

  telegraphCone(x, y, angle, arc, radius, duration, color, shape) {
    const t = this.telegraphs.spawn();
    if (!t) return null;
    t.kind = 2;
    t.x = x; t.y = y; t.angle = angle; t.arc = arc; t.radius = radius;
    t.t = 0; t.duration = duration;
    t.color = TELEGRAPH_COLORS[color] || color || TELEGRAPH_COLORS.red;
    t.shape = shape || TELEGRAPH_SHAPES[color] || 'arrow';
    return t;
  }

  /** A shrinking safe ring — "DETENTION", the whirlpool phase. */
  telegraphRing(x, y, radius, duration, color) {
    const t = this.telegraphs.spawn();
    if (!t) return null;
    t.kind = 3;
    t.x = x; t.y = y; t.radius = radius;
    t.t = 0; t.duration = duration;
    t.color = TELEGRAPH_COLORS[color] || color || TELEGRAPH_COLORS.blue;
    t.shape = 'circle';
    return t;
  }

  // --- fields ----------------------------------------------------------------
  spawnField(x, y, radius, duration, kind, dps, color, opts) {
    const f = this.fields.spawn();
    if (!f) return null;
    const o = opts || EMPTY;
    f.x = x; f.y = y; f.radius = radius;
    f.t = 0; f.duration = duration;
    f.effect = typeof kind === 'string' ? FIELD_FROM_NAME[kind] || 0 : kind;
    f.dps = dps || 0;
    f.param = o.param || 0;
    f.color = color || FIELD_COLOR[f.effect] || '#ff7a3d';
    f.tickT = 0;
    f.hitsPlayer = !!o.hitsPlayer;
    f.hitsEnemies = o.hitsEnemies !== false;
    f.followHost = o.follow || null;
    return f;
  }

  // --- stage hazard setup ----------------------------------------------------
  setStageHazard(hazardDef) {
    this.kind = hazardDef ? hazardDef.kind : null;
    this.params = hazardDef ? hazardDef.params : null;
    this.def = hazardDef;
    this.t = 0;
    this.visibilityRadius = 0;
    this.tidePhase = 0;
    this.tideHigh = false;

    if (!hazardDef) return;
    const run = this.run;
    switch (hazardDef.kind) {
      case 'lanes': {
        const n = this.params.lanes || 3;
        this.lanes = [];
        for (let i = 0; i < n; i++) {
          this.lanes.push({
            y: run.bounds.minY + (run.bounds.maxY - run.bounds.minY) * ((i + 1) / (n + 1)),
            t: runRng.range(0, this.params.interval || 11),
            x: 0, active: false, dir: i % 2 === 0 ? 1 : -1,
          });
        }
        break;
      }
      case 'spotlights': {
        const n = this.params.count || 3;
        this.spotlights = [];
        for (let i = 0; i < n; i++) {
          this.spotlights.push({
            x: runRng.range(run.bounds.minX, run.bounds.maxX),
            y: runRng.range(run.bounds.minY, run.bounds.maxY),
            tx: 0, ty: 0, r: this.params.radius || 170, t: 0,
          });
        }
        break;
      }
      case 'shifting_rooms':
        this.roomT = this.params.interval || 45;
        break;
    }
  }

  /** True when the player is standing in a spotlight (+50% damage, marked). */
  get playerSpotlit() { return this._spotlit; }
  /** Visibility clamp for the smoke-bomb hazard; 0 = unrestricted. */
  get visionRadius() { return this.visibilityRadius; }

  update(dt) {
    const run = this.run;
    const p = run.player;
    this.t += dt;

    // --- telegraphs ---------------------------------------------------------
    const tel = this.telegraphs.items;
    for (let i = 0; i < this.telegraphs.count; i++) {
      const t = tel[i];
      t.t += dt;
      if (t.t >= t.duration) { this.telegraphs.release(t); i--; }
    }

    // --- fields -------------------------------------------------------------
    const fl = this.fields.items;
    for (let i = 0; i < this.fields.count; i++) {
      const f = fl[i];
      f.t += dt;
      if (f.followHost) {
        if (!f.followHost.active) { f.followHost = null; }
        else { f.x = f.followHost.x; f.y = f.followHost.y; }
      }
      if (f.t >= f.duration) { this.fields.release(f); i--; continue; }

      f.tickT -= dt;
      if (f.tickT > 0) continue;
      f.tickT = 0.25;

      if (f.hitsEnemies) this._applyFieldToEnemies(f);
      if (f.hitsPlayer && dist2(f.x, f.y, p.x, p.y) < f.radius * f.radius) {
        if (f.effect === FIELD.DAMAGE || f.effect === FIELD.BURN) {
          damagePlayer(run, f.dps * 0.25, SRC.HAZARD, { fromX: f.x, fromY: f.y });
        } else if (f.effect === FIELD.CHILL) {
          applySlow(p.st, 0.6, 0.4);
        } else if (f.effect === FIELD.HEAL) {
          run.heal(f.dps * 0.25);
        }
      }
      if ((run.frameParity & 1) === 0) {
        particles.drift(f.x + fxRng.signed() * f.radius * 0.7,
                        f.y + fxRng.signed() * f.radius * 0.7, f.color,
                        { life: 0.5, size: 0.35, speed: 10 });
      }
    }

    // --- the stage hazard ---------------------------------------------------
    if (this.kind) this._updateStageHazard(dt);
  }

  _applyFieldToEnemies(f) {
    const run = this.run;
    const hash = run.enemyHash;
    const items = run.enemies.items;
    const n = hash.query(f.x, f.y, f.radius);
    for (let k = 0; k < n; k++) {
      const e = items[hash.resultAt(k)];
      if (!e || !e.active || e.hp <= 0) continue;
      const rr = f.radius + e.radius;
      if (dist2(f.x, f.y, e.x, e.y) > rr * rr) continue;
      switch (f.effect) {
        case FIELD.DAMAGE:
          dealDamage(run, e, f.dps * 0.25, SRC.HAZARD, { canCrit: false, knockback: 0, noNumber: true });
          break;
        case FIELD.BURN:
          applyBurn(e.st, f.dps, 1.2);
          break;
        case FIELD.CHILL:
          applySlow(e.st, f.param || 0.55, 0.6);
          break;
        case FIELD.PULL: {
          const dx = f.x - e.x, dy = f.y - e.y;
          const d = Math.hypot(dx, dy) || 1;
          e.x += dx / d * (f.param || 180) * 0.25;
          e.y += dy / d * (f.param || 180) * 0.25;
          break;
        }
        case FIELD.SUNLIGHT:
          e.st.noRegenT = Math.max(e.st.noRegenT, 0.5);
          break;
      }
    }
  }

  _updateStageHazard(dt) {
    const run = this.run;
    const p = run.player;
    const P = this.params;

    switch (this.kind) {
      // --- Stage 2: traffic lanes ------------------------------------------
      case 'lanes': {
        for (const L of this.lanes) {
          if (!L.active) {
            L.t -= dt;
            if (L.t <= 0 && Math.abs(L.y - p.y) < run.camera.viewHalfH(200)) {
              L.active = true;
              L.warnT = P.telegraph || feel.telegraphTruck;
              L.x = L.dir > 0 ? run.bounds.minX - 200 : run.bounds.maxX + 200;
              this.telegraphLine(run.bounds.minX, L.y, run.bounds.maxX, L.y,
                                 P.width || 140, L.warnT, 'yellow', 'arrow');
              audio.play('telegraph');
            }
          } else {
            if (L.warnT > 0) { L.warnT -= dt; continue; }
            L.x += (P.speed || 900) * L.dir * dt;
            const halfW = (P.width || 140) * 0.5;
            // Trucks flatten enemies too — learning to bait them is the point.
            if (P.damagesEnemies !== false) {
              areaDamage(run, L.x, L.y, halfW * 1.4, (P.damage || 45) * 3, SRC.HAZARD,
                         { canCrit: false, knockback: 400 });
            }
            if (Math.abs(p.y - L.y) < halfW && Math.abs(p.x - L.x) < 90) {
              damagePlayer(run, P.damage || 45, SRC.HAZARD, { fromX: L.x, fromY: L.y });
            }
            particles.burst(L.x, L.y, 2, '#ffd23f', { speed: 90, life: 0.3, additive: true });
            if (L.x < run.bounds.minX - 300 || L.x > run.bounds.maxX + 300) {
              L.active = false;
              L.t = (P.interval || 11) * runRng.range(0.7, 1.3);
              L.dir *= -1;
            }
          }
        }
        break;
      }

      // --- Stage 3: collapsing walls ---------------------------------------
      case 'collapsing': {
        this._hazT = (this._hazT || 0) - dt;
        if (this._hazT <= 0) {
          this._hazT = P.interval || 14;
          const n = P.count || 3;
          for (let i = 0; i < n; i++) {
            const a = runRng.angle();
            const d = runRng.range(200, 520);
            const x = clamp(p.x + Math.cos(a) * d, run.bounds.minX + 60, run.bounds.maxX - 60);
            const y = clamp(p.y + Math.sin(a) * d, run.bounds.minY + 60, run.bounds.maxY - 60);
            const r = P.radius || 90;
            this.telegraph(x, y, r, feel.telegraphLethal, 'red', 'x');
            run.scheduler.after(feel.telegraphLethal, dropRubble, { run, x, y, r, dmg: P.damage || 40, life: P.rubbleLife || 22 });
          }
        }
        break;
      }

      // --- Stage 4: smoke bombs --------------------------------------------
      case 'smoke': {
        this._hazT = (this._hazT || 0) - dt;
        if (this._hazT <= 0) {
          this._hazT = P.interval || 20;
          this._smokeT = P.duration || 9;
        }
        if (this._smokeT > 0) {
          this._smokeT -= dt;
          const target = P.visibility || 300;
          this.visibilityRadius = lerp(this.visibilityRadius || 2000, target, dt * 2);
        } else if (this.visibilityRadius > 0) {
          this.visibilityRadius = lerp(this.visibilityRadius, 2400, dt * 1.5);
          if (this.visibilityRadius > 2000) this.visibilityRadius = 0;
        }
        break;
      }

      // --- Stage 5: shifting rooms -----------------------------------------
      case 'shifting_rooms': {
        this.roomT -= dt;
        if (this.roomT <= 2 && !this._roomWarned) {
          this._roomWarned = true;
          floaters.spawn(p.x, p.y - 90, 'THE ROOMS ARE MOVING', '#ff5f7e', 24, 2.0);
          run.shakeMedium();
        }
        if (this.roomT <= 0) {
          this.roomT = P.interval || 45;
          this._roomWarned = false;
          this._reconfigureRooms();
        }
        break;
      }

      // --- Stage 6: rising tide --------------------------------------------
      case 'tide': {
        this.tidePhase += dt / (P.cycle || 60) * TAU;
        const high = Math.sin(this.tidePhase) > 0;
        if (high !== this.tideHigh) {
          this.tideHigh = high;
          floaters.spawn(p.x, p.y - 90, high ? 'HIGH TIDE' : 'LOW TIDE', '#5fd0ff', 22, 1.6);
        }
        // Applied by run.js when it computes speed multipliers.
        break;
      }

      // --- Stage 7: spotlights ---------------------------------------------
      case 'spotlights': {
        this._spotlit = false;
        for (const s of this.spotlights) {
          s.t -= dt;
          if (s.t <= 0) {
            s.t = runRng.range(3, 7);
            s.tx = runRng.range(run.bounds.minX + 200, run.bounds.maxX - 200);
            s.ty = runRng.range(run.bounds.minY + 200, run.bounds.maxY - 200);
          }
          const sp = P.speed || 90;
          const dx = s.tx - s.x, dy = s.ty - s.y;
          const d = Math.hypot(dx, dy) || 1;
          s.x += dx / d * Math.min(sp * dt, d);
          s.y += dy / d * Math.min(sp * dt, d);
          if (dist2(s.x, s.y, p.x, p.y) < s.r * s.r) this._spotlit = true;
        }
        break;
      }
    }
  }

  _reconfigureRooms() {
    const run = this.run;
    const P = this.params;
    run.obstacles.clear();
    const cx = run.player.x, cy = run.player.y;
    const n = P.walls || 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + runRng.range(-0.3, 0.3);
      const d = runRng.range(230, 620);
      const x = clamp(cx + Math.cos(a) * d, run.bounds.minX + 100, run.bounds.maxX - 100);
      const y = clamp(cy + Math.sin(a) * d, run.bounds.minY + 100, run.bounds.maxY - 100);
      if (runRng.chance(0.5)) run.obstacles.addBox(x, y, runRng.range(80, 220), 26);
      else run.obstacles.addBox(x, y, 26, runRng.range(80, 220));
    }
    // "the player is repositioned"
    const a = runRng.angle();
    run.player.x = clamp(cx + Math.cos(a) * 180, run.bounds.minX + 80, run.bounds.maxX - 80);
    run.player.y = clamp(cy + Math.sin(a) * 180, run.bounds.minY + 80, run.bounds.maxY - 80);
    run.camera.snapTo(run.player.x, run.player.y);
    particles.ring(run.player.x, run.player.y, 24, '#c58cff', 400);
    run.shakeMedium();
  }

  clear() {
    this.telegraphs.clear();
    this.fields.clear();
    this.kind = null;
    this.lanes = null;
    this.spotlights = null;
    this.visibilityRadius = 0;
  }

  // --- drawing ---------------------------------------------------------------
  drawUnder(r, alpha) {
    // Fields sit under entities so they never obscure a target.
    const fl = this.fields.items;
    for (let i = 0; i < this.fields.count; i++) {
      const f = fl[i];
      const t = f.t / f.duration;
      const a = (t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1) * 0.28;
      r.drawCircle(f.x, f.y, f.radius, f.color, a);
      r.strokeCircle(f.x, f.y, f.radius, f.color, 2, a * 1.8);
    }

    // Traffic lanes get a persistent road marking so the hazard is legible even
    // when no truck is coming.
    if (this.kind === 'lanes' && this.lanes) {
      const b = this.run.bounds;
      for (const L of this.lanes) {
        r.drawRect(b.minX, L.y - (this.params.width || 140) * 0.5,
                   b.maxX - b.minX, this.params.width || 140, '#161020', 0.5);
      }
    }
    r.setAlpha(1);
  }

  drawOver(r, alpha) {
    const tel = this.telegraphs.items;
    for (let i = 0; i < this.telegraphs.count; i++) {
      const t = tel[i];
      const prog = clamp(t.t / t.duration, 0, 1);
      // Pulse faster as it fills — the last 20% is unmistakable.
      const pulse = 0.35 + 0.45 * Math.abs(Math.sin(t.t * (4 + prog * 10)));
      const a = prog > 0.9 ? pulse * 1.3 : pulse;

      switch (t.kind) {
        case 0:
          r.drawCircle(t.x, t.y, t.radius, t.color, a * 0.22);
          r.strokeCircle(t.x, t.y, t.radius, t.color, 3, a);
          r.strokeCircle(t.x, t.y, t.radius * prog, t.color, 2, a * 0.7);
          break;
        case 1: {
          r.drawBeam(t.x, t.y, t.x2, t.y2, t.width, t.color, a * 0.22);
          r.drawLine(t.x, t.y, t.x2, t.y2, t.color, 3, a);
          break;
        }
        case 2:
          r.drawWedge(t.x, t.y, t.radius, t.angle - t.arc / 2, t.angle + t.arc / 2, t.color, a * 0.22);
          r.drawArc(t.x, t.y, t.radius, t.angle - t.arc / 2, t.angle + t.arc / 2, t.color, 3, a);
          break;
        case 3: {
          // Shrinking safe ring: the SAFE side is inside.
          const rad = t.radius * (1 - prog * 0.75);
          r.strokeCircle(t.x, t.y, rad, t.color, 5, a);
          break;
        }
      }
      // The accessibility half: a shape, not just a colour.
      this._drawGlyph(r, t, a);
    }

    // Smoke: a darkening ring at the visibility limit.
    if (this.visibilityRadius > 0 && this.visibilityRadius < 2000) {
      const p = this.run.player;
      r.strokeCircle(p.x, p.y, this.visibilityRadius, '#0a0a12', 220, 0.55);
    }

    // Spotlights.
    if (this.spotlights) {
      for (const s of this.spotlights) {
        r.drawCircle(s.x, s.y, s.r, '#fff3b0', 0.10);
        r.strokeCircle(s.x, s.y, s.r, '#fff3b0', 3, 0.45);
      }
    }
    r.setAlpha(1);
  }

  _drawGlyph(r, t, a) {
    const size = Math.max(14, t.radius * 0.22);
    const g = t.shape;
    if (g === 'x') {
      const s = size * 0.5;
      r.drawLine(t.x - s, t.y - s, t.x + s, t.y + s, t.color, 4, a);
      r.drawLine(t.x + s, t.y - s, t.x - s, t.y + s, t.color, 4, a);
    } else if (g === 'arrow') {
      const ang = t.kind === 1 ? Math.atan2(t.y2 - t.y, t.x2 - t.x) : t.angle;
      const mx = t.kind === 1 ? (t.x + t.x2) / 2 : t.x + Math.cos(ang) * t.radius * 0.55;
      const my = t.kind === 1 ? (t.y + t.y2) / 2 : t.y + Math.sin(ang) * t.radius * 0.55;
      const s = size * 0.6;
      r.drawLine(mx - Math.cos(ang) * s, my - Math.sin(ang) * s,
                 mx + Math.cos(ang) * s, my + Math.sin(ang) * s, t.color, 4, a);
      r.drawLine(mx + Math.cos(ang) * s, my + Math.sin(ang) * s,
                 mx + Math.cos(ang + 2.5) * s * 0.6, my + Math.sin(ang + 2.5) * s * 0.6, t.color, 4, a);
      r.drawLine(mx + Math.cos(ang) * s, my + Math.sin(ang) * s,
                 mx + Math.cos(ang - 2.5) * s * 0.6, my + Math.sin(ang - 2.5) * s * 0.6, t.color, 4, a);
    } else if (g === 'bang') {
      r.drawLine(t.x, t.y - size * 0.6, t.x, t.y + size * 0.15, t.color, 5, a);
      r.drawCircle(t.x, t.y + size * 0.45, 3.5, t.color, a);
    } else if (g === 'circle') {
      r.strokeCircle(t.x, t.y, size * 0.45, t.color, 3, a);
    }
  }
}

function dropRubble(ctx) {
  const { run, x, y, r, dmg, life } = ctx;
  areaDamage(run, x, y, r, dmg, SRC.HAZARD, { falloff: 0.3, canCrit: false });
  if (dist2(x, y, run.player.x, run.player.y) < r * r) {
    damagePlayer(run, dmg, SRC.HAZARD, { fromX: x, fromY: y });
  }
  run.obstacles.addCircle(x, y, r * 0.62, life);
  particles.burst(x, y, 12, '#6b6f80', { speed: 200, life: 0.6, size: 0.8 });
  run.shakeMedium();
}

const FIELD_COLOR = ['#ff5f7e', '#6ad8ff', '#ff7a3d', '#c58cff', '#7bf59a', '#ffe9a3'];
const FIELD_FROM_NAME = { damage: 0, chill: 1, burn: 2, pull: 3, heal: 4, sunlight: 5 };
const EMPTY = {};
