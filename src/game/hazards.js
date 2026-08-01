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
import { effects } from '../render/effects.js';
import { atlas } from '../render/spriteAtlas.js';

/**
 * THE CAR THE TRAFFIC HAZARD DRIVES.
 *
 * Registered at module scope so the first vehicle of the run is a cache hit —
 * the same discipline every prop in the ability layer follows, and the same
 * reason: rasterising a 52px sprite on the frame a hazard fires is a hitch at
 * the exact moment the player is being asked to move.
 *
 * `flash: false` and no `rotates` — nothing can hit it, and `drawSpriteRotated`
 * turns the context, so one baked frame serves both directions. Both fields are
 * part of the atlas key, so a copy of this literal that differs by either one
 * bakes a SECOND car mid-run and tests/renderSmoke.js fails the build over it.
 */
const V_CAR = { shape: 'car', color: '#e0455f', accent: '#1a1020', size: 26, flash: false };
const CAR_SPRITE = atlas.register(V_CAR);
/** `life` is one frame at 60Hz: the car is re-emitted every tick it is alive,
 *  so it tracks the damage window exactly instead of drifting behind it. */
const CAR_EAST = { life: 0.05, from: 0, scale: 2.1, angle: 0, spin: 0, alpha: 1 };
const CAR_WEST = { life: 0.05, from: 0, scale: 2.1, angle: Math.PI, spin: 0, alpha: 1 };

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

/**
 * EVERY `kind` THE TWO SWITCHES BELOW ACTUALLY HANDLE.
 *
 * This exists because a `switch` is not introspectable, and that is precisely
 * how five of the six stage hazards came to be dead content: the data said
 * 'debris' and the engine said 'collapsing', nothing matched, nothing ran, and
 * nothing anywhere could tell. A hand-kept list is only as good as the test that
 * reads it — tests/suites.js asserts every kind declared in data/stages.js
 * HAZARDS appears here, so adding a hazard whose handler was never written now
 * fails the build instead of shipping as a stage that quietly has no weather.
 */
export const HAZARD_KINDS = [
  'lanes', 'debris', 'visibility', 'reconfigure', 'cycle', 'zones',
];

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
    /** Earliest hazard-clock time the next mortar shell may be marked. See requestSalvo(). */
    this.salvoT = 0;
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

  /**
   * THE MORTAR SALVO GATE — one shell marked every `spacing` seconds, arena-wide.
   *
   * Play report: "the falling shots in map 3 ... there are 10 at a time on top of
   * the player." That is literal, and it was two facts multiplying.
   *
   * Stage 3's timeline places thirteen Siege Husks and the mob table keeps
   * rolling more from minute twelve, where at 420 effective HP under Titan's
   * Shadow they outlive every piece of fodder around them — twenty mortars alive
   * at once is ordinary, not a spike. And every one of them computed the SAME
   * impact point, `p + v * lead`, from the same player, with no per-shell
   * variation at all: twenty marks in one hole. Cutting away does not save you,
   * because the shells fired 0.2s later re-aim off wherever you cut to, and
   * nobody changes direction ten times in a second.
   *
   * This is a TIMESTAMP, not a token pool, and that is deliberate: a mortar
   * killed between marking and impact cannot leak a slot, and there is nothing
   * to reconcile when the pool recycles it. The rate is capped at 1/spacing
   * shells per second no matter how many mortars are alive, which against a
   * 1.45s telegraph puts at most ceil(1.45 / 0.5) = 3 marks on the floor at once.
   *
   * @returns true if the caller may mark a shell now.
   */
  requestSalvo(spacing) {
    if (this.t < this.salvoT) return false;
    this.salvoT = this.t + (spacing > 0 ? spacing : 0.5);
    return true;
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
  /**
   * FIVE OF THESE SIX HAZARDS HAD NEVER FIRED.
   *
   * Both switches below used to case on 'collapsing' / 'smoke' /
   * 'shifting_rooms' / 'tide' / 'spotlights'. The HAZARDS table in
   * data/stages.js — which is the thing that actually names them — declares
   * `kind: 'debris' | 'visibility' | 'reconfigure' | 'cycle' | 'zones'`. Only
   * `lanes` ever matched. So the collapsing walls, the smoke bombs, the shifting
   * rooms, the rising tide and the spotlights were dead content: declared in the
   * data, previewed on the stage-select screen, promised in every stage's codex
   * entry, and silently switched off in the engine, with no warning and no error
   * because a `switch` that matches nothing simply does nothing.
   *
   * The param NAMES had drifted the same way, and that half was worse than the
   * rename: every stale read fell through to an `||` default that happened to be
   * plausible, so even if a case had matched, the smoke would have been the
   * wrong radius and the rooms the wrong count, and it would have looked like a
   * tuning problem rather than a wiring one. Both switches now case on what the
   * data says, and every param below is read by the name the data declares it
   * under.
   */
  setStageHazard(hazardDef) {
    this.kind = hazardDef ? hazardDef.kind : null;
    this.params = hazardDef ? hazardDef.params : null;
    this.def = hazardDef;
    this.t = 0;
    this.visibilityRadius = 0;
    this.tidePhase = 0;
    this.tideHigh = false;
    this.salvoT = 0;
    // `_hazT` and `_smokeT` are RUN state and nothing reset them. The headless
    // harness runs a hundred runs in one process, so every run after the first
    // inherited the previous stage's countdown and Stage 3's opening rubble
    // volley landed at a different second every time — on the same seed.
    this._hazT = 0;
    this._smokeT = 0;

    if (!hazardDef) return;
    const run = this.run;
    switch (hazardDef.kind) {
      case 'lanes': {
        // LANE POSITIONS ARE AUTHORED WHEN THE STAGE HAS REAL ROADS.
        //
        // The even split — (i+1)/(n+1) of the arena height — is right for a
        // stage whose ground is a texture, and wrong the moment the backdrop
        // paints a road plan: a car running down the middle of a building block
        // is not a hazard, it is a bug you cannot dodge because there is nowhere
        // to dodge TO. `laneY` is a list of fractions of the arena, matching the
        // road centres in the backdrop's own cell plan; the fallback keeps every
        // stage that does not care byte-identical.
        const ys = this.params.laneY;
        const n = ys ? ys.length : (this.params.lanes || 3);
        const H = run.bounds.maxY - run.bounds.minY;
        this.lanes = [];
        for (let i = 0; i < n; i++) {
          this.lanes.push({
            y: run.bounds.minY + H * (ys ? ys[i] : (i + 1) / (n + 1)),
            t: runRng.range(0, this.params.interval || 11),
            x: 0, active: false, dir: i % 2 === 0 ? 1 : -1,
          });
        }
        break;
      }
      case 'zones': {
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
      case 'debris':
        // Half an interval of grace. At `_hazT` 0 the first volley fired on tick
        // one, before the player had moved or read the arena.
        this._hazT = (this.params.interval || 14) * 0.5;
        break;
      case 'reconfigure':
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
        // `active` is a POOL flag: enemies, minions and projectiles have one,
        // the player does not. Testing it truthily meant a field told to follow
        // the PLAYER detached itself on its very first tick and stayed where it
        // was born — so every player-anchored aura in the game was really a
        // stationary puddle that happened to be re-spawned underfoot.
        if (f.followHost.active === false) { f.followHost = null; }
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
            // THE CAR ITSELF. `lanes` used to be a moving damage window with two
            // sparks on it and nothing you could point at — the stage's signature
            // hazard was invisible. A prop blitted source-over at the damage
            // window's own position, facing the way it is travelling, is the
            // whole fix, and it costs one drawSpriteRotated per live lane.
            effects.fallSprite(L.x, L.y, CAR_SPRITE, L.dir > 0 ? CAR_EAST : CAR_WEST);
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
      //
      // "TOO QUICK TO DODGE, TOO MANY IN ONE PLACE, ALL ON TOP OF ME."
      // Three separate defects, and only one of them was a number.
      //
      // 1. THE CLAMP. `clamp(p.x + cos(a) * d, ...)` drags the mark toward the
      //    player: at x = minX + 60 with a negative offset the impact lands on
      //    the player's exact x, and in a corner it lands on them in both axes.
      //    Hugging the arena edge — the natural answer to a horde — quietly
      //    turned a dodgeable hazard into unavoidable damage. The OFFSET is
      //    reflected per axis now, which preserves |offset| = d exactly, so no
      //    mark is ever nearer than `minRange` however you stand. The clamp that
      //    remains is a safety net; the arena is 4000px against a 620px reach,
      //    so a reflected offset is always in bounds.
      // 2. THE FREE ANGLE. Every zone rolled its own, so three 170px discs could
      //    stack in one hole. One zone per equal SECTOR now, jitter bounded to
      //    +-0.30 rad: two adjacent sectors are at worst 120 - 2*17.2 = 85.6deg
      //    apart, and at the 300px inner radius that is a chord of
      //    2 * 300 * sin(42.8deg) = 408px — wider than the 340px two 170px discs
      //    need to not touch. The spacing check below catches the leftovers.
      // 3. THE TELEGRAPH. It was `feel.telegraphLethal` — a hardcoded 1.0s —
      //    while `HAZARDS.collapsing_walls.telegraph` sat next to it in the data
      //    and NOTHING READ IT, which is exactly the failure this file's header
      //    documents. Arithmetic: `dropRubble` tests the bare radius, so a mark
      //    that clips you costs 170px of running. The slowest character in the
      //    roster is 168px/s, so 170/168 = 1.01s, plus feel.accelTime 0.07s to
      //    get up to speed, plus 0.25s to notice a new mark on a screen the
      //    density curve is holding at 250-400 enemies: 1.33s required. It had
      //    1.0. The data now says 1.5 and the engine now reads it.
      //
      // And the three no longer land together — `stagger` walks the volley out
      // so it reads as three impacts instead of one wall.
      case 'debris': {
        this._hazT = (this._hazT || 0) - dt;
        if (this._hazT <= 0) {
          this._hazT = P.interval || 14;
          const r = P.radius || 90;
          const n = Math.min(P.zones || 3, MARK_X.length);
          const tel = (this.def && this.def.telegraph) || feel.telegraphLethal;
          const stagger = P.stagger || 0.35;
          const minR = P.minRange || r + 130;
          const maxR = P.maxRange || 620;
          const sep = P.spacing || r * 2;
          const b = run.bounds;
          const base = runRng.angle();
          let placed = 0;
          for (let i = 0; i < n; i++) {
            let x = 0, y = 0;
            // Bounded, never a while(true): five nudges around the sector and
            // then it takes what it has. A hazard may not stall the sim.
            for (let attempt = 0; attempt < 5; attempt++) {
              const a = base + (i / n) * TAU + runRng.range(-0.30, 0.30) + attempt * 0.5;
              const d = runRng.range(minR, maxR);
              let ox = Math.cos(a) * d, oy = Math.sin(a) * d;
              if (p.x + ox < b.minX + 60 || p.x + ox > b.maxX - 60) ox = -ox;
              if (p.y + oy < b.minY + 60 || p.y + oy > b.maxY - 60) oy = -oy;
              x = clamp(p.x + ox, b.minX + 60, b.maxX - 60);
              y = clamp(p.y + oy, b.minY + 60, b.maxY - 60);
              let ok = true;
              for (let k = 0; k < placed; k++) {
                if (dist2(x, y, MARK_X[k], MARK_Y[k]) < sep * sep) { ok = false; break; }
              }
              if (ok) break;
            }
            MARK_X[placed] = x; MARK_Y[placed] = y; placed++;
            const wait = tel + i * stagger;
            this.telegraph(x, y, r, wait, 'red', 'x');
            // The wreck it leaves is its OWN radius, not a fraction of the blast:
            // the data separates `radius` (what it hits) from `obstacleRadius`
            // (what it then blocks) precisely because the cover is meant to be
            // smaller than the zone you had to leave to avoid it.
            run.scheduler.after(wait, dropRubble, {
              run, x, y, r,
              dmg: P.damage || 40,
              life: P.obstacleLifetime || 22,
              blockR: P.obstacleRadius || r * 0.62,
            });
          }
        }
        break;
      }

      // --- Stage 4: smoke bombs --------------------------------------------
      case 'visibility': {
        this._hazT = (this._hazT || 0) - dt;
        if (this._hazT <= 0) {
          this._hazT = P.interval || 20;
          this._smokeT = P.duration || 9;
        }
        if (this._smokeT > 0) {
          this._smokeT -= dt;
          const target = P.visionRadius || 300;
          this.visibilityRadius = lerp(this.visibilityRadius || 2000, target, dt * 2);
        } else if (this.visibilityRadius > 0) {
          this.visibilityRadius = lerp(this.visibilityRadius, 2400, dt * 1.5);
          if (this.visibilityRadius > 2000) this.visibilityRadius = 0;
        }
        break;
      }

      // --- Stage 5: shifting rooms -----------------------------------------
      case 'reconfigure': {
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
      case 'cycle': {
        // A sine over `period` is a 50% duty cycle, and the data asks for
        // highTideDuration 30 out of period 60 — which is that exact split, so
        // the cheap version is also the correct one. If a stage ever wants an
        // asymmetric tide this has to become a phase comparison instead.
        this.tidePhase += dt / (P.period || 60) * TAU;
        const high = Math.sin(this.tidePhase) > 0;
        if (high !== this.tideHigh) {
          this.tideHigh = high;
          floaters.spawn(p.x, p.y - 90, high ? 'HIGH TIDE' : 'LOW TIDE', '#5fd0ff', 22, 1.6);
        }
        // Applied by run.js when it computes speed multipliers.
        break;
      }

      // --- Stage 7: spotlights ---------------------------------------------
      case 'zones': {
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
    const n = P.wallCount || 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + runRng.range(-0.3, 0.3);
      const d = runRng.range(230, 620);
      const x = clamp(cx + Math.cos(a) * d, run.bounds.minX + 100, run.bounds.maxX - 100);
      const y = clamp(cy + Math.sin(a) * d, run.bounds.minY + 100, run.bounds.maxY - 100);
      if (runRng.chance(0.5)) run.obstacles.addBox(x, y, runRng.range(80, 220), 26);
      else run.obstacles.addBox(x, y, 26, runRng.range(80, 220));
    }

    // THE ROOMS MOVED; THE FLOOR DID NOT EMPTY ITSELF FIRST.
    //
    // Unlike ObstacleField.scatter, which holds `clearance` around the player's
    // start and the altar, this rebuild answers to nothing but the player's
    // CURRENT position — so a slab can land squarely on the altar, on a chest, on
    // a relic, or on a gather mote. Everything that has to be walked to gets
    // pushed back out.
    run.pickups.evictFromObstacles();
    if (run.stageEvents) run.stageEvents.evictMotes();
    if (run.altar && run.obstacles.pushOut(run.altar.x, run.altar.y, 34, FREE)) {
      run.altar.x = FREE.x;
      run.altar.y = FREE.y;
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
    this.def = null;
    this.lanes = null;
    this.spotlights = null;
    this.visibilityRadius = 0;
    this.salvoT = 0;
    this._hazT = 0;
    this._smokeT = 0;
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
    // when nothing is coming. On a stage that paints its own roads this is a
    // dark WEAR STRIP down the middle of the carriageway rather than a band over
    // the whole width — the backdrop has already drawn the road, and a second
    // opaque rectangle on top of it hid the lane paint the road was drawn with.
    if (this.kind === 'lanes' && this.lanes) {
      const b = this.run.bounds;
      const w = this.params.width || 140;
      const authored = !!this.params.laneY;
      for (const L of this.lanes) {
        const h = authored ? w * 0.34 : w;
        r.drawRect(b.minX, L.y - h * 0.5, b.maxX - b.minX, h, '#161020', authored ? 0.28 : 0.5);
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
  const { run, x, y, r, dmg, life, blockR } = ctx;
  areaDamage(run, x, y, r, dmg, SRC.HAZARD, { falloff: 0.3, canCrit: false });
  if (dist2(x, y, run.player.x, run.player.y) < r * r) {
    damagePlayer(run, dmg, SRC.HAZARD, { fromX: x, fromY: y });
  }
  run.obstacles.addCircle(x, y, blockR > 0 ? blockR : r * 0.62, life);
  // A WALL JUST ARRIVED ON TOP OF WHATEVER WAS LYING THERE. This is the one
  // direction ObstacleField.pushOut cannot cover from the drop side: the loot was
  // legally placed and the geometry moved in afterwards. Bury a chest under a
  // slab of masonry and it is gone — the player is hard-blocked out of the
  // obstacle and chests are collected by touch.
  run.pickups.evictFromObstacles();
  particles.burst(x, y, 12, '#6b6f80', { speed: 200, life: 0.6, size: 0.8 });
  run.shakeMedium();
}

/**
 * Where this volley's marks went, for the spacing check. Module-level, per the
 * house rule that a hazard is not allowed to allocate its own bag every nine
 * seconds. Eight is well over the largest `zones` any stage authors (three), and
 * the loop clamps to this length so a data typo cannot walk off the end.
 */
const MARK_X = new Float64Array(8);
const MARK_Y = new Float64Array(8);

/** Scratch for the altar's obstacle push-out in _reconfigureRooms. */
const FREE = { x: 0, y: 0 };

const FIELD_COLOR = ['#ff5f7e', '#6ad8ff', '#ff7a3d', '#c58cff', '#7bf59a', '#ffe9a3'];
const FIELD_FROM_NAME = { damage: 0, chill: 1, burn: 2, pull: 3, heal: 4, sunlight: 5 };
const EMPTY = {};
