// Stage mini events — the optional detours.
//
// Play report: "add random mini events to the maps that suit the map as well,
// simply going to one place, killing mobs inside a circle etc like that."
//
// The whole of a run's minute-to-minute decision making used to be "which way is
// the horde thinnest". There was nothing on the map worth walking TOWARD except
// the altar, which is one visit, and a chest, which comes to you when an elite
// dies wherever it happened to die. An event is a reason to cross the arena on
// purpose, at a moment you choose, with a cost you can read.
//
// SHAPE
// -----
// One system, owned and ticked by Run, exactly like HazardSystem: constructor,
// update, two draw hooks and clear(). FOUR HANDLERS — reach, cull, hold, gather
// — selected by the `kind` on a STAGE_EVENTS entry, so a new event on an
// existing kind is a data-only addition and touches no code here at all. Which
// events a stage may roll is `stage.events`, themed alongside its hazard.
//
// EXACTLY ONE AT A TIME, and never on top of something else that is already
// asking for the player's attention:
//   - not during a boss or mid-boss fight. A fight is the pacing anchor of the
//     stage and an objective marker 900px away during one is not a choice, it is
//     a punishment for engaging.
//   - not during a freeze screen. This gets it for free: Run.update returns
//     before the systems block on LEVEL_UP / CHEST / RELIC_SWAP / PAUSED, so
//     this never ticks and a level-up cannot eat an event's clock.
//   - not during the pre-boss calm, and not in the last minute and a half of the
//     stage, where a 40-second objective could not be finished anyway.
//
// EVERY ROLL IS runRng. Placement, which event fires, the gap until the next one
// and where the motes land are all part of the simulation and a seed reproduces
// them exactly; nothing here reads fxRng or the wall clock.

import { runRng } from '../core/rng.js';
import { events, EV } from '../core/events.js';
import { audio } from '../core/audio.js';
import { particles } from '../render/particles.js';
import { floaters } from '../render/damageNumbers.js';
import { flash } from '../render/screenShake.js';
import { clamp, dist2, lerp, TAU } from '../core/math.js';

export const EVENT_PHASE = { IDLE: 0, ACTIVE: 1 };

/**
 * CADENCE. Engine tuning, not content, so it lives here rather than on the
 * stage: every stage wants the same rhythm and only the flavour differs.
 *
 * The first event waits out the opening — the first 80 seconds are when a build
 * is at its thinnest and being asked to leave the safe pocket is how a run ends
 * at level 4. After that, one every two minutes or so: on a 20-minute stage that
 * is six or seven, which at half a level each is a meaningful but not
 * run-defining share of the curve.
 */
const FIRST_MIN = 80, FIRST_MAX = 115;
const GAP_MIN = 100, GAP_MAX = 150;
/** Retry interval when the cadence came due during a boss fight. */
const BLOCKED_RETRY = 5;
/** No new event inside the last stretch of the stage. */
const END_MARGIN = 95;
/** How long CLEARED / FAILED stays on the banner after it resolves. */
const RESULT_HOLD = 3.2;
/** Fixed mote pool. `gather` events ask for 8-10; 12 is headroom, not a budget. */
const MAX_MOTES = 12;
/** Touch radius for a mote. Generous on purpose — this is not a precision test. */
const MOTE_REACH = 52;

export class StageEventSystem {
  constructor(run) {
    this.run = run;
    /** STAGE_EVENTS entries this stage may roll. Empty = the system idles. */
    this.pool = [];
    this.phase = EVENT_PHASE.IDLE;
    this.def = null;
    this.kind = '';
    this.color = '#ffd76a';

    this.x = 0; this.y = 0;
    this.radius = 0;
    this.radius0 = 0;
    this.t = 0;
    this.limit = 0;
    this.need = 0;
    this.progress = 0;

    // Motes are FLAT ARRAYS, not objects, for the same reason every pool in this
    // codebase is: the draw walks them every frame and an array of twelve object
    // literals is twelve pointer chases plus whatever the GC decides to do about
    // them later.
    this.moteX = new Float32Array(MAX_MOTES);
    this.moteY = new Float32Array(MAX_MOTES);
    this.moteLive = new Uint8Array(MAX_MOTES);
    this.moteCount = 0;

    this.nextT = runRng.range(FIRST_MIN, FIRST_MAX);
    /** > 0 while the resolution banner is still up. */
    this.resultT = 0;
    this.success = false;
    /** Total cleared / failed this run, for the results line and for barks. */
    this.cleared = 0;
    this.failed = 0;
    this._lastDef = null;

    // The `cull` handler is the one thing here that cannot be polled: a kill is
    // an instant with a POSITION, and by the time the next tick runs the corpse
    // is gone and the pool slot has been recycled. Same subscribe/unsubscribe
    // discipline as RelicHooks — see clear().
    this._onKill = (e, src, r) => this._countKill(e, r);
    events.on(EV.ENEMY_KILLED, this._onKill);
  }

  /** Build this stage's themed pool. Unknown ids are skipped, never thrown on. */
  load(stage, table) {
    this.pool.length = 0;
    for (const id of stage.events || []) {
      const def = table[id];
      if (def) this.pool.push(def);
    }
  }

  /** True while an objective is live — the marker, the arrow and the banner. */
  get active() { return this.phase === EVENT_PHASE.ACTIVE; }

  /** 0..1 toward the objective. The banner and the marker ring both read it. */
  get fraction() { return this.need > 0 ? clamp(this.progress / this.need, 0, 1) : 0; }

  /** Seconds left on the clock. */
  get timeLeft() { return Math.max(0, this.limit - this.t); }

  // --- the tick --------------------------------------------------------------
  update(dt) {
    if (this.resultT > 0) this.resultT -= dt;
    if (this.phase === EVENT_PHASE.ACTIVE) { this._tick(dt); return; }
    if (this.pool.length === 0) return;

    this.nextT -= dt;
    if (this.nextT > 0) return;
    if (!this._canStart()) { this.nextT = BLOCKED_RETRY; return; }
    this._start();
  }

  _canStart() {
    const run = this.run;
    if (run.player.dead) return false;
    // A boss OR a mid-boss. `boss.isActive` is the live-entity truth; the run's
    // own flag catches the window between the spawn and the controller taking it.
    if (run.boss.isActive || run.bossActive) return false;
    if (run.waveDirector && run.waveDirector.calmUntil > run.time) return false;
    if (!run.endless && run.time > run.stage.duration - END_MARGIN) return false;
    return true;
  }

  _start() {
    const run = this.run;
    const b = run.bounds;
    const p = run.player;

    // Never the same event twice running, when there is another to pick. With
    // two events per stage that would otherwise be a coin flip that lands on the
    // same face 25% of the time, and the same objective twice reads as a bug.
    let def = runRng.pick(this.pool);
    if (this.pool.length > 1 && def === this._lastDef) {
      const i = this.pool.indexOf(def);
      def = this.pool[(i + 1 + runRng.int(0, this.pool.length - 2)) % this.pool.length];
    }
    this._lastDef = def;

    const P = def.params;
    const a = runRng.angle();
    const d = runRng.range(P.range[0], P.range[1]);
    // Clamped well inside the arena: an objective centred on the wall is half an
    // objective, and the `hold` ring shrinks toward its own centre.
    this.x = clamp(p.x + Math.cos(a) * d, b.minX + 260, b.maxX - 260);
    this.y = clamp(p.y + Math.sin(a) * d, b.minY + 260, b.maxY - 260);

    this.def = def;
    this.kind = def.kind;
    this.color = def.color || '#ffd76a';
    this.radius0 = P.radius;
    this.radius = P.radius;
    // A `gather` can never need more motes than the pool can hold. Without the
    // clamp, a data entry asking for 14 would place 12 and then be mathematically
    // unwinnable — a failure banner every single time, with nothing on screen
    // that would ever tell you why.
    this.need = def.kind === 'gather' ? Math.min(P.need, MAX_MOTES) : P.need;
    this.limit = P.limit;
    this.progress = 0;
    this.t = 0;
    this.phase = EVENT_PHASE.ACTIVE;

    this.moteCount = 0;
    if (def.kind === 'gather') this._scatterMotes(P);

    // ANNOUNCE IT ON THE PLAYER, not on the marker. The marker may be 1,100px
    // away and off screen, which is exactly when a floater there is a floater
    // nobody sees.
    floaters.spawn(p.x, p.y - 118, def.name.toUpperCase(), this.color, 30, 2.8);
    floaters.spawn(p.x, p.y - 86, def.objective, '#e8ecf5', 18, 2.8);
    particles.ring(this.x, this.y, 22, this.color, 420);
    audio.play('telegraph');
  }

  _scatterMotes(P) {
    const b = this.run.bounds;
    const n = Math.min(MAX_MOTES, P.need);
    for (let i = 0; i < n; i++) {
      // A ring with jitter rather than a uniform disc: a disc clusters toward
      // the middle and the last two motes end up on top of each other, which
      // makes the objective finish in one step instead of reading as a sweep.
      //
      // The radial band stops at 0.85 rather than 1.0 for a reason the first
      // headless pass found immediately: motes on the rim of a 420px marker put
      // the full route at well over 3,000px, and a gather that cannot be
      // finished at walking speed inside its own timer is not a detour, it is a
      // guaranteed failure banner.
      const a = (i / n) * TAU + runRng.range(-0.35, 0.35);
      const d = P.radius * runRng.range(0.30, 0.85);
      this.moteX[i] = clamp(this.x + Math.cos(a) * d, b.minX + 60, b.maxX - 60);
      this.moteY[i] = clamp(this.y + Math.sin(a) * d, b.minY + 60, b.maxY - 60);
      this.moteLive[i] = 1;
    }
    this.moteCount = n;
  }

  _tick(dt) {
    const run = this.run;
    const p = run.player;
    this.t += dt;

    switch (this.kind) {
      case 'reach': {
        // Stand in it. Progress bleeds back out at twice the rate it goes in, so
        // clipping the edge while running past does not claim it.
        const inside = dist2(p.x, p.y, this.x, this.y) < this.radius * this.radius;
        this.progress = inside
          ? this.progress + dt
          : Math.max(0, this.progress - dt * 2);
        break;
      }

      case 'hold': {
        // The ring closes as the clock runs, which is what turns "stand here"
        // into a fight for a shrinking floor rather than a place to idle.
        this.radius = lerp(this.radius0, this.radius0 * 0.5, clamp(this.t / this.limit, 0, 1));
        const inside = dist2(p.x, p.y, this.x, this.y) < this.radius * this.radius;
        this.progress = inside
          ? this.progress + dt
          : Math.max(0, this.progress - dt * 0.6);
        break;
      }

      case 'gather': {
        for (let i = 0; i < this.moteCount; i++) {
          if (!this.moteLive[i]) continue;
          if (dist2(p.x, p.y, this.moteX[i], this.moteY[i]) > MOTE_REACH * MOTE_REACH) continue;
          this.moteLive[i] = 0;
          this.progress++;
          particles.burst(this.moteX[i], this.moteY[i], 5, this.color,
                          { speed: 110, life: 0.3, size: 0.4, additive: true });
          audio.play('pickup');
        }
        break;
      }

      // `cull` advances entirely from the kill handler.
    }

    if (this.progress >= this.need) { this._resolve(true); return; }
    if (this.t >= this.limit) this._resolve(false);
  }

  _countKill(e, run) {
    // The bus is a GLOBAL singleton and a previous run's system can still be
    // attached to it if that run was never disposed. Checking the run is what
    // stops a dead objective counting kills from a live one.
    if (run !== this.run || this.phase !== EVENT_PHASE.ACTIVE || this.kind !== 'cull') return;
    if (dist2(e.x, e.y, this.x, this.y) > this.radius * this.radius) return;
    this.progress++;
  }

  _resolve(success) {
    const run = this.run;
    const p = run.player;
    const def = this.def;
    this.phase = EVENT_PHASE.IDLE;
    this.resultT = RESULT_HOLD;
    this.success = success;
    this.moteCount = 0;
    this.nextT = runRng.range(GAP_MIN, GAP_MAX);

    if (success) {
      this.cleared++;
      this._pay(def);
      floaters.spawn(p.x, p.y - 100, 'EVENT CLEARED', this.color, 30, 2.4);
      particles.ring(this.x, this.y, 28, this.color, 520);
      flash.fire(this.color, 0.30, 2.4);
      audio.play('levelUp');
    } else {
      this.failed++;
      // Unmistakable, and cheap. A failure that only removes a marker reads as
      // the marker having despawned on its own.
      floaters.spawn(p.x, p.y - 100, def.name.toUpperCase() + ' — MISSED', '#8e97b5', 24, 2.4);
      particles.burst(this.x, this.y, 12, '#6b6f80', { speed: 150, life: 0.7, size: 0.6 });
      audio.play('uiBack');
    }
    // `this.def` is deliberately NOT nulled: the result banner runs for another
    // three seconds and it still needs the name and the colour of the thing that
    // just resolved.
  }

  /**
   * Pay out through the systems that already exist — no new economy.
   *
   * `xpLevels` is a fraction of THIS level's requirement rather than a flat XP
   * number, and that is the whole balance argument: a flat 300 XP is a free
   * level at minute two and invisible at minute eighteen, and this fires six or
   * seven times a run. Half a level is worth the walk at every point on the
   * curve and never more than that.
   */
  _pay(def) {
    const run = this.run;
    const p = run.player;
    const R = def.reward;
    if (R.xpLevels) run.grantXp(run.xpNeeded(p.level) * R.xpLevels);
    if (R.gold) run.grantGold(R.gold);
    if (R.healPct) run.heal(p.maxHp * R.healPct);
    // A chest drops at the MARKER, not on the player: it is the last beat of the
    // detour, and it lands where the player already is.
    if (R.goldChest) run.pickups.dropChest(this.x, this.y, true);
    else if (R.chest) run.pickups.dropChest(this.x, this.y, false);
  }

  clear() {
    events.off(EV.ENEMY_KILLED, this._onKill);
    this.phase = EVENT_PHASE.IDLE;
    this.pool.length = 0;
    this.moteCount = 0;
    this.resultT = 0;
  }

  // --- drawing ---------------------------------------------------------------
  /**
   * The ground marker, under the horde. Everything readable at a glance: a
   * filled area you can see through a crowd, a hard rim, and a progress ring
   * that fills clockwise from the top like every other timer in the game.
   */
  drawUnder(r, alpha) {
    if (this.phase !== EVENT_PHASE.ACTIVE) return;
    const t = this.run.time;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    const f = this.fraction;

    r.drawCircle(this.x, this.y, this.radius, this.color, 0.07 + pulse * 0.03);
    r.strokeCircle(this.x, this.y, this.radius, this.color, 4, 0.55 + pulse * 0.2);
    r.strokeCircle(this.x, this.y, this.radius * 0.9, this.color, 1.5, 0.2);
    if (f > 0.001) {
      r.drawArc(this.x, this.y, this.radius * 0.95, -Math.PI / 2,
                -Math.PI / 2 + TAU * f, '#ffffff', 5, 0.75);
    }
    // The centre pip, so the exact spot is never ambiguous on a 330px circle.
    r.drawCircle(this.x, this.y, 7, this.color, 0.8);
    r.setAlpha(1);
  }

  /**
   * The part that has to survive forty enemies standing on it: rotating ticks
   * around the rim and the gather motes, drawn OVER the horde for the same
   * reason telegraphs are.
   */
  drawOver(r, alpha) {
    if (this.phase !== EVENT_PHASE.ACTIVE) return;
    const t = this.run.time;

    // Three ticks walking the rim. Motion is what the eye finds in a crowd.
    for (let i = 0; i < 3; i++) {
      const a = t * 0.9 + (i / 3) * TAU;
      const c = Math.cos(a), s = Math.sin(a);
      r.drawLine(this.x + c * (this.radius - 16), this.y + s * (this.radius - 16),
                 this.x + c * (this.radius + 16), this.y + s * (this.radius + 16),
                 '#ffffff', 3, 0.6);
    }

    for (let i = 0; i < this.moteCount; i++) {
      if (!this.moteLive[i]) continue;
      const bob = 0.6 + 0.4 * Math.sin(t * 4 + i * 1.7);
      r.drawCircle(this.moteX[i], this.moteY[i], 9 + bob * 3, this.color, 0.30);
      r.drawCircle(this.moteX[i], this.moteY[i], 5, '#ffffff', 0.6 + bob * 0.3);
    }
    r.setAlpha(1);
  }
}
