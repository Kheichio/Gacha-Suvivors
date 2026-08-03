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
 *
 * IT IS DRAWN BY THIS FILE, NOT PUSHED THROUGH THE EFFECT POOL, and the first
 * attempt got that wrong in four ways at once. It called
 * `effects.fallSprite(...)` once per tick with a one-frame life, and fallSprite
 * animates a prop DROPPING onto a point:
 *
 *   - `from: 0` is falsy, so `o.from > 0 ? o.from : 260` fell through to the
 *     default and every car was drawn 260px ABOVE the lane it was damaging,
 *     easing down over a lifetime it never lived long enough to finish. The
 *     hazard hit you from a car floating over the next street.
 *   - a one-frame life at 60Hz still leaves three of them alive at once, each
 *     at a different point in that drop and a different alpha, 15px apart at
 *     900px/s — a smeared column of ghost cars rather than a car.
 *   - fallSprite paints a shadow disc too, so there were three of those.
 *   - and it burned three of the 160 effect slots per lane per tick, which
 *     evicts the oldest — the player's own ability effects.
 *
 * A car is not an effect. It is a thing that exists at a place for as long as
 * the hazard says it does, which is a draw, not a particle.
 */
const V_CAR = { shape: 'car', color: '#e0455f', accent: '#1a1020', size: 26, flash: false };
const CAR_SPRITE = atlas.register(V_CAR);
const CAR_SCALE = 3.4;

/**
 * THE PAINTED EXTENT of the car, as a fraction of its 64px sprite box. Measured
 * off the raster, not read off the path coordinates: the shape has an outline,
 * an underlay and an overlay, and only the pixels know where it actually ends.
 */
const CAR_BODY_L = 0.84, CAR_BODY_W = 0.42;

/**
 * THE BOX THAT HITS THE PLAYER *IS* THE CAR.
 *
 * It used to be `|dy| < width/2 && |dx| < 90` — a 180 x 140 rectangle, against
 * a car drawn 113 long and 57 wide. Two thirds of the thing that killed you was
 * not on screen, and 40px of clear road either side of the bonnet was lethal.
 * That is the exact "hard vs unfair" line this file's own header is about, and
 * it is invisible in play: you die next to a car and conclude the hitboxes are
 * mushy, which is not a bug report anybody can act on.
 *
 * So both numbers come from the sprite now and cannot drift from it. The result
 * is 92 x 46 — the same length as before and less than half the width, which is
 * what a car actually is.
 *
 * `params.width` is untouched and still does its two other jobs: the telegraph
 * beam (deliberately WIDER than the danger, which is the forgiving direction)
 * and the enemy sweep, which is meant to be generous — trucks flatten the horde
 * and baiting them is the point.
 */
export const CAR_HITBOX = {
  scale: CAR_SCALE,
  hl: CAR_SPRITE.w * CAR_SCALE * CAR_BODY_L * 0.5,
  hw: CAR_SPRITE.h * CAR_SCALE * CAR_BODY_W * 0.5,
};

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
    /**
     * The BURNING-WRECKAGE sub-hazard's params, or null.
     *
     * A sub-hazard rather than a second entry in `stage.hazards` because that
     * array is single-occupancy in practice: game/run.js wires `hazards[0]` and
     * the stage-select card previews `hazards[0]`, so a second id is data that
     * validates, previews nowhere and never fires. See `_updateFires`.
     */
    this.fires = null;
    this._fireT = 0;
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

    if (!hazardDef) { this.fires = null; this._fireT = 0; return; }
    const run = this.run;

    // THE FIRES ARE READ OFF `params`, NOT off `kind`, and that is deliberate.
    // Setting a stage's scenery alight has nothing to do with whether its
    // signature hazard drops rubble, floods, or moves the walls, so this is an
    // opt-in block any hazard of any kind may carry rather than a branch of the
    // switch below. Seeded to 60% of an interval so the first fire is not
    // competing with the opening rubble volley (which seeds to 50%).
    this.fires = hazardDef.params ? hazardDef.params.fires || null : null;
    this._fireT = this.fires ? (this.fires.interval || 6) * 0.6 : 0;

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
      // A BURNING field also throws embers, at half the rate and in a hotter
      // colour than the pool itself. `drift` already carries a -12 gravity, so
      // an ember rises off the fire and dies, which is what an ember does; the
      // pool's own mote is the smoke. Both colours are pre-rastered — #ffb03d
      // is in prewarm.js PARTICLE_COLORS — because a particle sheet baked on
      // the frame a fire lights is a hitch at the exact moment the player is
      // being asked to move.
      if (f.effect === FIELD.BURN && (run.frameParity & 3) === 0) {
        particles.drift(f.x + fxRng.signed() * f.radius * 0.5,
                        f.y + fxRng.signed() * f.radius * 0.5, '#ffb03d',
                        { life: 0.8, size: 0.28, speed: 16 });
      }
    }

    // --- the stage hazard ---------------------------------------------------
    if (this.kind) this._updateStageHazard(dt);
    if (this.fires) this._updateFires(dt);
  }

  /**
   * BURNING WRECKAGE — the ruins keep catching, and the fire is ANCHORED TO
   * THE GEOMETRY rather than rolled on open ground.
   *
   * Stage 3's brief is a town that burned down. Rolling a damaging disc at a
   * random bearing would have produced fires standing in the middle of an empty
   * street with nothing to have set them off, which reads as a mechanic rather
   * than as a place — so this walks the STATIC BLOCKER list, takes a piece
   * inside [minRange, maxRange] of the player, and lights the ground just off
   * its face. Every anchor is therefore a house, a beam, a cart or a rubble
   * pile, INCLUDING the wreckage the collapsing-walls hazard dropped nine
   * seconds ago: a wall comes down, and then it catches.
   *
   * THREE RULES IT MAY NOT BREAK, in order of how expensive getting them wrong
   * is:
   *
   *   1. IT IS TELEGRAPHED. An untelegraphed damaging zone in a bullet heaven
   *      is a cheap death — this file's own header is about exactly that line.
   *      `telegraph` is a real number in the data and it is read here.
   *   2. IT NEVER LIGHTS UNDER YOU. `minRange` is checked against the FINAL
   *      point, after the offset off the blocker, not against the blocker — an
   *      anchor 320px away with a 90px radius can otherwise put the fire 230px
   *      from the player, inside its own inner limit.
   *   3. IT NEVER LIGHTS INSIDE A WALL. A field centred in a solid box is
   *      damage the player is hard-blocked out of standing in, which is not a
   *      hazard, it is a decal. `overlaps` is the same test the drop path uses.
   *
   * Bounded everywhere and no `while (true)` anywhere: a hazard may not stall
   * the sim, so a volley that cannot find room places fewer fires and moves on.
   */
  _updateFires(dt) {
    const F = this.fires;
    this._fireT -= dt;
    if (this._fireT > 0) return;
    // Jittered, so the fires never fall into lockstep with the 9s rubble volley
    // and the stage stops having a rhythm you can set a metronome to.
    this._fireT = (F.interval || 6) * runRng.range(0.8, 1.25);

    const run = this.run;
    const n = Math.min(F.count || 2, FIRE_X.length);
    const radius = F.radius || 118;
    const tel = F.telegraph || 1.2;
    const minR = F.minRange || radius + 180;
    const maxR = F.maxRange || 900;
    const sep = F.spacing || radius * 2.4;
    let placed = 0;
    for (let i = 0; i < n; i++) {
      if (!this._fireSpot(SPOT, F, minR, maxR)) continue;
      let ok = true;
      for (let k = 0; k < placed; k++) {
        if (dist2(SPOT.x, SPOT.y, FIRE_X[k], FIRE_Y[k]) < sep * sep) { ok = false; break; }
      }
      if (!ok) continue;
      FIRE_X[placed] = SPOT.x; FIRE_Y[placed] = SPOT.y; placed++;
      this.telegraph(SPOT.x, SPOT.y, radius, tel, 'red', 'x');
      run.scheduler.after(tel, ignite, {
        hz: this, x: SPOT.x, y: SPOT.y, radius,
        dps: F.dps || 26, life: F.life || 8,
        // Defaults to FALSE, which is the opposite of spawnField's own default
        // and is the point: a persistent field ticking four times a second
        // across a 300-strong horde is free damage that scales with density,
        // and it would re-rank the stage in the balance sweep without anybody
        // authoring a number.
        hitsEnemies: F.damagesEnemies === true,
      });
    }
  }

  /**
   * Where the next fire catches, into `out`. Returns false if there is nowhere.
   *
   * The blocker walk starts at a random index and takes the first piece in the
   * band rather than collecting candidates and picking one: there is no bag to
   * allocate, the start offset is what keeps it from always burning the same
   * house, and the cost is one squared distance per blocker against a field of
   * at most 128.
   */
  _fireSpot(out, F, minR, maxR) {
    const run = this.run;
    const p = run.player;
    const b = run.bounds;
    const obs = run.obstacles;
    const gap = F.gap || 46;
    const radius = F.radius || 118;
    // The core, not the whole disc. A fire whose EDGE clips a wall is a fire
    // banked against a building, which is what this is meant to look like;
    // rejecting on the full radius would only ever light in open ground.
    const core = radius * 0.35;
    const minR2 = minR * minR, maxR2 = maxR * maxR;

    const n = obs ? obs.count : 0;
    if (n > 0) {
      const start = runRng.int(0, n - 1);
      for (let k = 0; k < n; k++) {
        const idx = (start + k) % n;
        const d2 = dist2(obs.x[idx], obs.y[idx], p.x, p.y);
        if (d2 < minR2 || d2 > maxR2) continue;
        const reach = obs.r[idx] + gap;
        for (let attempt = 0; attempt < 4; attempt++) {
          const ang = runRng.angle();
          const x = clamp(obs.x[idx] + Math.cos(ang) * reach, b.minX + 80, b.maxX - 80);
          const y = clamp(obs.y[idx] + Math.sin(ang) * reach, b.minY + 80, b.maxY - 80);
          if (dist2(x, y, p.x, p.y) < minR2) continue;
          if (obs.overlaps(x, y, core)) continue;
          out.x = x; out.y = y;
          return true;
        }
      }
    }

    // NOTHING TO BURN IN RANGE — the middle of the market square, or a stage
    // that opted in with no geometry at all. Fall back to the ring roll the
    // debris volley uses, reflected per axis so the arena edge can never drag
    // a mark onto the player (the bug documented on `case 'debris'`).
    for (let attempt = 0; attempt < 6; attempt++) {
      const ang = runRng.angle();
      const d = runRng.range(minR, maxR);
      let ox = Math.cos(ang) * d, oy = Math.sin(ang) * d;
      if (p.x + ox < b.minX + 80 || p.x + ox > b.maxX - 80) ox = -ox;
      if (p.y + oy < b.minY + 80 || p.y + oy > b.maxY - 80) oy = -oy;
      const x = clamp(p.x + ox, b.minX + 80, b.maxX - 80);
      const y = clamp(p.y + oy, b.minY + 80, b.maxY - 80);
      if (obs && obs.overlaps(x, y, core)) continue;
      out.x = x; out.y = y;
      return true;
    }
    return false;
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
            // The CAR's footprint, not the lane's — see CAR_HITBOX.
            if (Math.abs(p.y - L.y) < CAR_HITBOX.hw && Math.abs(p.x - L.x) < CAR_HITBOX.hl) {
              damagePlayer(run, P.damage || 45, SRC.HAZARD, { fromX: L.x, fromY: L.y });
            }
            // SPRAY OFF THE BACK TYRES, not a shower of yellow sparks.
            //
            // The old burst fired TWO additive yellow particles EVERY TICK — 120
            // a second per lane — and it was the whole of what the hazard looked
            // like before there was a car. A glowing yellow comet is what an
            // energy bolt looks like; it is not what a vehicle looks like, and
            // with the car drawn on top of it the two read as two hazards. It
            // fires four times a second now, behind the car rather than on it,
            // in the road's own grey.
            L.spray = (L.spray || 0) - dt;
            if (L.spray <= 0) {
              L.spray = 0.25;
              particles.burst(L.x - L.dir * 70, L.y, 2, '#8e97b5',
                              { speed: 60, life: 0.45, size: 0.5 });
            }
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
    // RUN STATE, and nothing else resets it. The headless harness runs a
    // hundred runs in one process; a leftover `fires` block would set the next
    // stage's scenery alight, and a leftover countdown would light Stage 3's
    // first fire at a different second on the same seed.
    this.fires = null;
    this._fireT = 0;
  }

  // --- drawing ---------------------------------------------------------------
  drawUnder(r, alpha) {
    // Fields sit under entities so they never obscure a target.
    const fl = this.fields.items;
    for (let i = 0; i < this.fields.count; i++) {
      const f = fl[i];
      const t = f.t / f.duration;
      const fade = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
      const a = fade * 0.28;
      if (f.effect === FIELD.BURN) { this._drawFire(r, f, fade); continue; }
      r.drawCircle(f.x, f.y, f.radius, f.color, a);
      r.strokeCircle(f.x, f.y, f.radius, f.color, 2, a * 1.8);
    }

    // TRAFFIC LANES GET A PERSISTENT MARKING so the hazard is legible even when
    // nothing is coming — but WHAT that marking is depends on whether the stage
    // has drawn a road under it.
    //
    // Without `laneY` the lane is an abstraction on a texture, and a dark band
    // the full width of the damage window is the honest drawing of it.
    //
    // With `laneY` the backdrop has already painted a carriageway, complete with
    // its own dashed centre line, and the band was covering it up: a 47px slab
    // of near-black straight down the middle of a road that had just been drawn.
    // What the player actually needs to know on that stage is not "there is a
    // road here" — they can see that — but "cars come down THIS one", and the
    // real-world answer to that is TYRE WEAR. Two thin darkened tracks either
    // side of the centre line say it without hiding anything.
    if (this.kind === 'lanes' && this.lanes) {
      const b = this.run.bounds;
      const w = this.params.width || 140;
      const W = b.maxX - b.minX;
      if (this.params.laneY) {
        for (const L of this.lanes) {
          r.drawRect(b.minX, L.y - w * 0.30, W, 11, '#0e0a18', 0.30);
          r.drawRect(b.minX, L.y + w * 0.30 - 11, W, 11, '#0e0a18', 0.30);
        }
      } else {
        for (const L of this.lanes) r.drawRect(b.minX, L.y - w * 0.5, W, w, '#161020', 0.5);
      }
    }
    r.setAlpha(1);
  }

  /**
   * FIRE IS NOT AN ORANGE DISC.
   *
   * Every field in this system draws as one translucent circle and one stroke,
   * which is the right drawing of a chill puddle or a heal pool and is not what
   * anybody means by "the ruins are burning". A burning field gets four flat
   * rings instead — a scorch bed, the body, a hotter middle and a white-hot
   * core — plus three tongues rolling inside it.
   *
   * ALL OF IT IS FLAT ON THE FLOOR. This game is top-down: a flame drawn as if
   * it had height is a flame hovering over the arena, which is the exact bug
   * that cost render/stageBackdrop.js its entire parallax layer.
   *
   * IT CATCHES RATHER THAN APPEARING — but the catch is an INTENSITY ramp and
   * not a radius one, and that distinction was paid for. The body used to grow
   * out of nothing over the first 12% of the life; on an 8s fire that is a FULL
   * SECOND in which a 118px disc that is already dealing 26/s is drawn as a
   * black scorch bed with a thin ring and nothing at all inside it. Rendered in
   * a real run and looked at: the frame the telegraph expires, the thing that
   * has just started hurting you reads as a shadow on the road. The header of
   * this file refuses exactly that trade — the damage is full-radius from the
   * frame it lights, so the fire is too. It flares from ember to white-hot over
   * a quarter of a second, at the size it is going to keep.
   *
   * THE FLICKER IS PHASED OFF THE POOL INDEX, not off an RNG. Draw code may
   * never touch `runRng` — a replay would diverge the moment somebody watched
   * it — and `fxRng` would leave two adjacent fires flickering in lockstep as
   * often as not, because they would be sampling the same stream on the same
   * frame. `f._i` is the pool slot, which is stable for the life of the field
   * and different for every field alive at once.
   */
  _drawFire(r, f, fade) {
    // 0.50 -> 1 over the first quarter second, in REAL seconds off `f.t` rather
    // than as a fraction of the life: a 2s ember and a 12s bonfire have to catch
    // at the same rate, because what the ramp is describing is fire and not the
    // hazard's tuning.
    const catchK = 0.50 + 0.50 * (f.t < 0.25 ? f.t / 0.25 : 1);
    const rad = f.radius;
    const beat = f.t * 3.1 + f._i * 1.7;
    r.drawCircle(f.x, f.y, rad * 1.06, '#120c09', fade * 0.42);
    r.drawCircle(f.x, f.y, rad, f.color, fade * 0.46 * catchK);
    r.drawCircle(f.x, f.y, rad * (0.62 + 0.06 * Math.sin(beat)), '#ff9a3c', fade * 0.50 * catchK);
    r.drawCircle(f.x, f.y, rad * (0.30 + 0.05 * Math.sin(beat * 1.7)), '#ffd76a', fade * 0.58 * catchK);
    for (let k = 0; k < 3; k++) {
      const ang = beat * 0.4 + k * 2.0944;
      const off = rad * (0.40 + 0.20 * Math.sin(beat * 1.3 + k));
      r.drawCircle(f.x + Math.cos(ang) * off, f.y + Math.sin(ang) * off,
                   rad * 0.20, '#ff7a3d', fade * 0.40 * catchK);
    }
    // The edge of the damage, and it is the one ring that does NOT breathe:
    // what the player has to be able to find is where standing here starts to
    // cost, and a boundary that moves is a boundary you cannot read.
    r.strokeCircle(f.x, f.y, f.radius, '#ffd76a', 2, fade * 0.55);
  }

  /**
   * THE CARS, drawn over the horde because a car is a solid object and the
   * things it is flattening are underneath it.
   *
   * One blit and one shadow per live lane, straight from this file's own state.
   * There is no pooling and no interpolation: `L.x` IS the damage window's
   * position, so what the player sees and what the hazard hits are the same
   * number by construction — which is the bug that killed the first version,
   * where the sprite was an effect animating its own way toward a point the
   * damage had already left.
   */
  _drawVehicles(r) {
    if (this.kind !== 'lanes' || !this.lanes) return;
    for (const L of this.lanes) {
      if (!L.active || L.warnT > 0) continue;
      // A CAR-SHAPED shadow. A disc under a 184x92 vehicle is the wrong shape in
      // both axes at once — too short to reach the bumpers and too tall at the
      // flanks — and at this size that reads as a dark halo rather than as a
      // thing sitting on the road. Offset down, because the light in this whole
      // stage is overhead signage.
      r.drawRect(L.x - CAR_HITBOX.hl * 0.94, L.y - CAR_HITBOX.hw * 0.72 + 17,
                 CAR_HITBOX.hl * 1.88, CAR_HITBOX.hw * 1.44, '#000000', 0.26);
      r.drawSpriteRotated(CAR_SPRITE, L.x, L.y, L.dir > 0 ? 0 : Math.PI,
                          CAR_HITBOX.scale, 1, false, 0);
    }
    r.setAlpha(1);
  }

  drawOver(r, alpha) {
    this._drawVehicles(r);
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
 * THE IGNITION, `telegraph` seconds after the mark went down.
 *
 * It goes through `spawnField` — the ONE place in the codebase that owns
 * damaging ground — rather than doing its own damage, so the fire tick, the
 * 0.25s cadence, the player/enemy split and the burn status all behave exactly
 * the way a Brazier Oni's pool or a mortar's puddle already does. There is no
 * second damage path here and there must never be one.
 */
function ignite(ctx) {
  const { hz, x, y, radius, dps, life, hitsEnemies } = ctx;
  hz.spawnField(x, y, radius, life, 'burn', dps, FIRE_COLOR,
                { hitsPlayer: true, hitsEnemies });
  // The catch. Small and warm — the fire itself is the loud part, and this only
  // has to say WHEN, on the one frame the telegraph stops being a promise.
  particles.burst(x, y, 10, '#ff7a3d', { speed: 150, life: 0.55, size: 0.6 });
}

/**
 * Where this volley's marks went, for the spacing check. Module-level, per the
 * house rule that a hazard is not allowed to allocate its own bag every nine
 * seconds. Eight is well over the largest `zones` any stage authors (three), and
 * the loop clamps to this length so a data typo cannot walk off the end.
 */
const MARK_X = new Float64Array(8);
const MARK_Y = new Float64Array(8);

/**
 * The same, for the fires. Its OWN pair rather than a share of MARK_X: the
 * rubble volley and a fire volley can land on the same tick, and a spacing
 * check reading half of somebody else's marks would silently stack two fires.
 */
const FIRE_X = new Float64Array(8);
const FIRE_Y = new Float64Array(8);

/**
 * The stage colour of standing fire. Pre-rastered as a particle already — it is
 * `STAGE_EVENTS.hold_the_breach.color` in data/stages.js, which prewarm.js
 * harvests — so the drifting smoke a field emits in its own colour costs no
 * mid-run bake. Changing it means adding the new hex to prewarm.js.
 */
const FIRE_COLOR = '#e07a3f';

/** Scratch for the altar's obstacle push-out in _reconfigureRooms. */
const FREE = { x: 0, y: 0 };

/** Scratch for the fire-anchor search. Written and read within one call. */
const SPOT = { x: 0, y: 0 };

const FIELD_COLOR = ['#ff5f7e', '#6ad8ff', '#ff7a3d', '#c58cff', '#7bf59a', '#ffe9a3'];
const FIELD_FROM_NAME = { damage: 0, chill: 1, burn: 2, pull: 3, heal: 4, sunlight: 5 };
const EMPTY = {};
