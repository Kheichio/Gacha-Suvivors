// Stage mini events — the optional detours, and the card that explains them.
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
//
// TELLING THE PLAYER WHAT TO DO
// -----------------------------
// Play report, later and much less kind: an event announced itself with one
// floater and a coloured circle 900px away, and at no point did anything on
// screen say what the objective WAS or how to finish it. A ring that fills when
// you stand in it and a ring that fills when you kill things in it look
// identical, and the only way to learn which one you were looking at was to walk
// into it and watch what happened for forty seconds.
//
// So this file owns the whole presentation now, in four pieces that each answer
// a different question:
//
//   THE POP-UP        "what just happened, and what am I being asked to do?"
//                     A card that slides in at the top of the screen the instant
//                     an event starts: the name, the INSTRUCTION in plain words,
//                     the clock and what it pays. It slides back out after five
//                     seconds, because a briefing that outstays its welcome is a
//                     wall you are fighting through rather than a card you read.
//                     The same card comes back once at the end for the result.
//   THE BANNER        "how am I doing?" Left edge, up the whole time the
//                     objective runs: instruction, live progress, time left, and
//                     whether you are actually standing in the thing.
//   THE MARKER LABEL  the same name and the same count, written on the circle
//                     itself, for when you are looking at the arena and not at
//                     the HUD.
//   THE AFTERGLOW     a ring that BLOOMS on a win and COLLAPSES on a loss, so
//                     the two outcomes differ in shape and not only in colour.
//
// THE INSTRUCTION IS DERIVED, NEVER AUTHORED. `instructionFor` builds it from
// the entry's own `kind` and `need`, so a new event added to data/stages.js
// arrives with its instruction already written and stays a data-only addition —
// which was the whole point of there being four handlers instead of fourteen
// events. An entry may still override it with an `instruction` field when the
// derived sentence would be wrong; nothing does today, and nothing should have
// to.

import { runRng } from '../core/rng.js';
import { events, EV } from '../core/events.js';
import { audio } from '../core/audio.js';
import { particles } from '../render/particles.js';
import { floaters } from '../render/damageNumbers.js';
import { flash } from '../render/screenShake.js';
// The one place a game system reaches into src/ui. It is deliberate: this system
// draws its own briefing card, and the alternative is a hand-rolled panel that
// starts out looking like the rest of the game and drifts away from it the first
// time the toolkit's plate changes. Nothing in widgets.js imports src/game, so
// there is no cycle, and nothing borrowed from it can observe the simulation.
import { ui, PALETTE, ellipsize } from '../ui/widgets.js';
import { clamp, dist2, lerp, easeOutCubic, TAU } from '../core/math.js';

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
/** How long the marker's afterglow burns after the objective resolves. */
const RESULT_HOLD = 3.2;
/** Fixed mote pool. `gather` events ask for 8-10; 12 is headroom, not a budget. */
const MAX_MOTES = 12;
/** Touch radius for a mote. Generous on purpose — this is not a precision test. */
const MOTE_REACH = 52;
/** Scratch for the mote push-out. Never read across calls. */
const FREE = { x: 0, y: 0 };

// THE POP-UP'S CLOCK.
//
// IN and OUT are short enough to read as one movement rather than as an
// animation you sit through; the card is fully legible for the whole middle of
// its life either way, because the fade is over inside a third of a second at
// each end. BRIEF is the number that was argued about: four seconds is not long
// enough to read three lines while dodging, and six seconds is long enough that
// the card is still sitting on the fight when you arrive at the marker.
const POP_IN = 0.30;
const POP_OUT = 0.42;
const POP_BRIEF = 5.0;
const POP_RESULT = 3.0;
const POP_BRIEFING = 0, POP_OUTCOME = 1;

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
    /**
     * Is the player standing in the circle RIGHT NOW? Only `reach` and `hold`
     * have an answer, and both of them bleed progress back out when it is no —
     * which the player could previously only discover by watching the bar go
     * backwards and guessing why. The banner says it in words instead.
     */
    this.inside = false;

    // The three strings the announcement is made of, built ONCE when the event
    // starts rather than per frame: they are pure functions of the entry, they
    // change only when the entry does, and the draw runs sixty times a second.
    this.instruction = '';
    this.note = '';
    this.kicker = '';
    this.rewardLine = '';

    // Motes are FLAT ARRAYS, not objects, for the same reason every pool in this
    // codebase is: the draw walks them every frame and an array of twelve object
    // literals is twelve pointer chases plus whatever the GC decides to do about
    // them later.
    this.moteX = new Float32Array(MAX_MOTES);
    this.moteY = new Float32Array(MAX_MOTES);
    this.moteLive = new Uint8Array(MAX_MOTES);
    this.moteCount = 0;

    this.nextT = runRng.range(FIRST_MIN, FIRST_MAX);
    /** > 0 while the marker's afterglow is still burning. */
    this.resultT = 0;
    this.success = false;
    /** Seconds the pop-up has been up, or < 0 when there is no card. */
    this.popT = -1;
    this.popLife = 0;
    this.popMode = POP_BRIEFING;
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
    // The card is driven by SIM time, not the wall clock, and that is the whole
    // reason it survives a level-up: Run.update returns before this system on a
    // freeze screen, so a briefing interrupted by three upgrade cards is still
    // there, with the same time left on it, when the player comes back.
    if (this.popT >= 0) {
      this.popT += dt;
      if (this.popT >= this.popLife) this.popT = -1;
    }
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
    this.inside = false;
    this.phase = EVENT_PHASE.ACTIVE;

    this.instruction = def.instruction || instructionFor(def.kind, this.need);
    this.note = KIND_NOTES[def.kind] || '';
    this.kicker = 'STAGE EVENT  ·  ' + def.objective;
    this.rewardLine = rewardLine(def.reward);

    this.moteCount = 0;
    if (def.kind === 'gather') this._scatterMotes(P);

    // THE CARD DOES THE EXPLAINING; the floater only says that something
    // happened, HERE, where the player's eye already is. There used to be two of
    // them — the name and the objective, stacked over the player's own head — and
    // between them they said less than one line of the card does, while sitting
    // directly on top of the fight the player was in the middle of.
    this._raise(POP_BRIEFING, POP_BRIEF);
    floaters.spawn(p.x, p.y - 112, def.name.toUpperCase(), this.color, 28, 2.4);
    particles.ring(this.x, this.y, 22, this.color, 420);
    audio.play('telegraph');
  }

  /** Put a card on screen. One at a time; a new one always replaces the old. */
  _raise(mode, life) {
    this.popMode = mode;
    this.popLife = life;
    this.popT = 0;
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
      let mx = clamp(this.x + Math.cos(a) * d, b.minX + 60, b.maxX - 60);
      let my = clamp(this.y + Math.sin(a) * d, b.minY + 60, b.maxY - 60);
      // A MOTE INSIDE A BLOCKER IS AN UNWINNABLE OBJECTIVE. MOTE_REACH is 52 and
      // the player is hard-resolved out of static geometry at 15px of clearance,
      // so a mote at the centre of any piece thicker than ~37px cannot be
      // touched â€” and `gather` needs ALL of them. That is a guaranteed failure
      // banner with nothing on screen that would ever explain it.
      if (this.run.obstacles.count > 0 && this.run.obstacles.pushOut(mx, my, 16, FREE)) {
        mx = FREE.x; my = FREE.y;
      }
      this.moteX[i] = mx;
      this.moteY[i] = my;
      this.moteLive[i] = 1;
    }
    this.moteCount = n;
  }

  /**
   * Push live motes back out of the geometry.
   *
   * Only the shifting-rooms hazard needs this: it clears the obstacle field and
   * rebuilds it mid-event, which can drop a corridor wall on a mote that was
   * placed legally forty seconds earlier.
   */
  evictMotes() {
    const obstacles = this.run.obstacles;
    if (obstacles.count === 0 || this.moteCount === 0) return;
    for (let i = 0; i < this.moteCount; i++) {
      if (!this.moteLive[i]) continue;
      if (obstacles.pushOut(this.moteX[i], this.moteY[i], 16, FREE)) {
        this.moteX[i] = FREE.x;
        this.moteY[i] = FREE.y;
      }
    }
  }

  _tick(dt) {
    const run = this.run;
    const p = run.player;
    this.t += dt;

    switch (this.kind) {
      case 'reach': {
        // Stand in it. Progress bleeds back out at twice the rate it goes in, so
        // clipping the edge while running past does not claim it.
        this.inside = dist2(p.x, p.y, this.x, this.y) < this.radius * this.radius;
        this.progress = this.inside
          ? this.progress + dt
          : Math.max(0, this.progress - dt * 2);
        break;
      }

      case 'hold': {
        // The ring closes as the clock runs, which is what turns "stand here"
        // into a fight for a shrinking floor rather than a place to idle.
        this.radius = lerp(this.radius0, this.radius0 * 0.5, clamp(this.t / this.limit, 0, 1));
        this.inside = dist2(p.x, p.y, this.x, this.y) < this.radius * this.radius;
        this.progress = this.inside
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
    // INSIDE THE RING, AND NOWHERE ELSE.
    //
    // `e.x/e.y` is still the DEATH position here even though the slot is
    // already back in the pool: run.onEnemyDeath -> enemies.onDeath releases it
    // BEFORE damage.js emits ENEMY_KILLED, but the pool's reset never touches
    // x or y, and the freed slot cannot be claimed until the next spawn, which
    // is a later tick.
    if (dist2(e.x, e.y, this.x, this.y) > this.radius * this.radius) return;
    this.progress++;
    // ONE SPARK PER COUNTED KILL. The rule above was already enforced and
    // completely invisible: the only way to learn that the kill you made on the
    // way to the ring did nothing was to watch a number that had not moved,
    // which reads as "the objective is broken" rather than as "that one was
    // outside". A kill that counts now says so, where it happened, in the
    // event's own colour.
    particles.burst(e.x, e.y, 4, this.color,
                    { speed: 130, life: 0.28, size: 0.42, additive: true });
  }

  _resolve(success) {
    const run = this.run;
    const p = run.player;
    const def = this.def;
    this.phase = EVENT_PHASE.IDLE;
    this.resultT = RESULT_HOLD;
    this.success = success;
    this.inside = false;
    this.moteCount = 0;
    this.nextT = runRng.range(GAP_MIN, GAP_MAX);
    // THE SAME CARD, ONE LAST TIME. The outcome arrives in the place the player
    // already learned to look for this event, which is what stops a win and a
    // loss both reading as "the marker went away".
    this._raise(POP_OUTCOME, POP_RESULT);

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
      // the marker having despawned on its own. The wash is deliberately a cold
      // grey rather than red: red is the colour this game uses for being hit,
      // and a missed detour must not feel like taking damage.
      floaters.spawn(p.x, p.y - 100, def.name.toUpperCase() + ' — MISSED', '#8e97b5', 24, 2.4);
      particles.burst(this.x, this.y, 12, '#6b6f80', { speed: 150, life: 0.7, size: 0.6 });
      flash.fire('#7d879e', 0.22, 2.8);
      audio.play('uiBack');
    }
    // `this.def` is deliberately NOT nulled: the outcome card runs for another
    // three seconds and it still needs the name, the colour and the reward line
    // of the thing that just resolved.
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
    this.popT = -1;
  }

  /** "12 / 18", "9.4s / 16s", "62%" — the count, per event kind. */
  _progressText() {
    switch (this.kind) {
      case 'cull':
      case 'gather': return Math.floor(this.progress) + ' / ' + this.need;
      case 'hold':   return this.progress.toFixed(1) + 's / ' + this.need + 's';
      default:       return Math.round(this.fraction * 100) + '%';
    }
  }

  // --- drawing ---------------------------------------------------------------
  /**
   * The ground marker, under the horde. Everything readable at a glance: a
   * filled area you can see through a crowd, a hard rim, and a progress ring
   * that fills clockwise from the top like every other timer in the game.
   */
  drawUnder(r, alpha) {
    if (this.phase !== EVENT_PHASE.ACTIVE) { this._afterglow(r); return; }
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
   * WHAT HAPPENED TO THE CIRCLE, DRAWN ON THE CIRCLE.
   *
   * Success BLOOMS outward past where the ring stood; failure COLLAPSES into the
   * pip and goes out. Two different shapes rather than two different greens: the
   * rule this project holds to is that no outcome may be carried by colour
   * alone, and "did I get that or not" is about as much of an outcome as this
   * system has.
   */
  _afterglow(r) {
    if (this.resultT <= 0 || !this.def) return;
    const k = clamp(this.resultT / RESULT_HOLD, 0, 1);
    const col = this.success ? '#7bf59a' : '#6b7590';
    const rad = this.success ? this.radius * (1.0 + (1 - k) * 0.6)
                             : this.radius * (0.22 + k * 0.78);
    r.strokeCircle(this.x, this.y, rad, col, 3, k * 0.55);
    r.drawCircle(this.x, this.y, 7, col, k * 0.8);
    r.setAlpha(1);
  }

  /**
   * The part that has to survive forty enemies standing on it: rotating ticks
   * around the rim, the gather motes and the marker's own label, drawn OVER the
   * horde for the same reason telegraphs are.
   *
   * The progress string is built ONCE here and handed to both readers. It is one
   * short allocation a frame, which is what a HUD costs; two would be careless.
   */
  drawOver(r, alpha) {
    const prog = this.phase === EVENT_PHASE.ACTIVE ? this._progressText() : '';
    if (this.phase === EVENT_PHASE.ACTIVE) this._marker(r, prog);
    this._screen(r, prog);
  }

  _marker(r, prog) {
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

    // THE LABEL SITS ON THE CENTRE, NOT ON THE RIM. `radius` runs from 110 to
    // 420 across the table, so a label hung off the rim would be four hundred
    // pixels from the pip it names on half the events, and on the other half it
    // would be tucked under the player's own sprite.
    MARKER_NAME.alpha = 1;
    r.drawText(this.def.name, this.x, this.y - 44, MARKER_NAME);
    MARKER_COUNT.color = this.color;
    r.drawText(prog, this.x, this.y - 21, MARKER_COUNT);
    r.setAlpha(1);
  }

  /**
   * SCREEN SPACE, FROM INSIDE A WORLD-SPACE HOOK.
   *
   * runScene keeps drawing the world after drawOver returns — enemy bars, the
   * mark timers, damage numbers, the objective's own edge arrow — so the camera
   * has to be exactly where it was found. `setCamera` rebuilds the transform AND
   * the cull box from three numbers the renderer already carries, so stashing
   * those three and replaying them is a faithful restore rather than an
   * approximation of one. Nothing here blits a sprite, which is the only reason
   * this does not also need hud.js's cull-window dance: drawSprite culls against
   * that box and screen-space coordinates are nowhere near it.
   */
  _screen(r, prog) {
    const run = this.run;
    // Every clock in this system freezes the moment the run ends — Run.update
    // returns before the systems block on VICTORY and DEFEAT — so without this
    // the last card of the run sits under the death screen until the scene
    // changes. `player.dead` is set in exactly one place and only alongside
    // DEFEAT, and `victory` in exactly one alongside VICTORY, so the pair is the
    // run state without importing run.js into the thing run.js imports.
    if (run.player.dead || run.victory) return;
    if (this.phase !== EVENT_PHASE.ACTIVE && this.popT < 0) return;

    const cx = r.camX, cy = r.camY, cs = r.camScale;
    r.setScreenSpace();
    // Bind the toolkit without disturbing the focus of any menu drawn on top —
    // the HUD does the same thing for the same reason.
    ui.attach(r);
    // ONE THING AT A TIME, which is this system's own rule about itself. While
    // the briefing card is up it IS the banner — same name, same instruction,
    // same clock, four times the size — and on a narrow window the two overlap.
    // Nothing is lost by standing the banner down for those five seconds: every
    // marker is placed at least 520px away, so the objective has not moved off
    // zero by the time the card clears.
    const briefing = this.popT >= 0 && this.popMode === POP_BRIEFING;
    if (this.phase === EVENT_PHASE.ACTIVE && !briefing) this._banner(r, prog);
    if (this.popT >= 0) this._popup(r);
    r.setAlpha(1);
    r.setCamera(cx, cy, cs);
  }

  /**
   * THE PERSISTENT BANNER — instruction, progress, clock, and whether you are
   * standing in the thing.
   *
   * Left edge, a third of the way down: the HUD's own furniture is the portrait
   * top-left, the timer top-centre, the build strip bottom-centre and the relics
   * bottom-right, which leaves exactly this. It is the one piece of this UI that
   * is up for the entire objective, so it carries the four numbers that change
   * and none of the prose that does not.
   */
  _banner(r, prog) {
    const def = this.def;
    if (!def) return;
    // GEOMETRY IS SCALED BY HAND; TEXT SIZES ARE NOT. `ui.text` multiplies by
    // `ui.scale`, which is this same setting — so passing `13 * s` for a size
    // would render at 13 * s * s and outgrow a box that only grew by s. Do not
    // "fix" this to match the surrounding style.
    const s = ui.scale;
    const W = 296 * s, H = 96 * s;
    const x = 18;
    // ANCHORED FROM BOTH ENDS, and the bottom one is not decoration.
    //
    // The floor pushes the plate clear of the HP block above it, which grows
    // with the UI scale. That was the whole rule, and it is wrong on its own:
    // the plate grows with the scale too, while the WINDOW does not, so at 1.4
    // on a 576px-tall window the floor put the top at 297 and the bottom at 431
    // — straight through the build strip, which the HUD draws AFTER this system
    // and therefore straight over the top of. The line that got buried was the
    // instruction, which is the one line this whole file exists to show.
    //
    // So the plate is also held above the bottom 38% of the screen, where the
    // build strip and the XP bar live. On every ordinary window the floor still
    // wins and nothing moves; the ceiling only bites on the short-window,
    // large-scale combinations where the two genuinely cannot both be honoured,
    // and there a plate tucked a little high is legible and a plate under the
    // build strip is not.
    const y = Math.min(Math.max(r.h * 0.32, 212 * s), Math.max(96 * s, r.h * 0.62 - H));
    const col = this.color;
    const tf = this.limit > 0 ? this.timeLeft / this.limit : 0;
    const urgent = tf < 0.25;
    const beat = 0.5 + 0.5 * Math.sin(this.run.time * 6);

    PANEL.borderColor = col;
    PANEL.borderWidth = 2;
    PANEL.alpha = 1;
    ui.panel(x, y, W, H, PANEL);
    // A spine in the event's own colour, so which objective this is survives
    // being read out of the corner of an eye. Inset from the ends rather than
    // run full height: the plate has a 6px radius and a spine flush with the top
    // pokes out through the rounded corner.
    r.drawRect(x + 3, y + 9 * s, 4 * s, H - 18 * s, col, 0.95);

    const ix = x + 15 * s, iw = W - 27 * s;
    label(def.name, ix, y + 16 * s, 13, col, 800, 'left', 1, false);
    label(Math.ceil(this.timeLeft) + 's', x + W - 12 * s, y + 16 * s, 14,
          urgent ? '#ff6f91' : PALETTE.textDim, 800, 'right',
          urgent ? 0.55 + beat * 0.45 : 1, true);

    // Ellipsized rather than trusted: the derived sentences all fit at every UI
    // scale, but `def.instruction` is an override anybody may author and a line
    // that runs off the plate is worse than a line that ends in a dot.
    label(ellipsize(r, this.instruction, iw, 11, 700), ix, y + 34 * s, 11,
          PALETTE.text, 700, 'left', 1, false);

    // ONE NOTCH PER KILL, ONE PER MOTE. A counted objective gets a bar segmented
    // by the thing it counts, so "four more" is a distance on the bar rather
    // than a subtraction; a timed one gets quarters, because tenths of a second
    // are not a unit anybody reads off a 270px bar.
    BAR.segments = (this.kind === 'cull' || this.kind === 'gather') && this.need <= 24
      ? this.need : 4;
    ui.bar(ix, y + 46 * s, iw, 9 * s, this.fraction, col, BAR);

    label(prog, ix, y + 68 * s, 11, PALETTE.textDim, 700, 'left', 1, true);
    // THE STATE, IN WORDS. `reach` and `hold` both drain when you step out, and
    // a bar quietly running backwards is the single most confusing thing this
    // system ever did — the player reads it as the objective being broken.
    let st = KIND_STATUS[this.kind] || '';
    let sc = PALETTE.textFaint, sa = 1;
    if (this.kind === 'reach' || this.kind === 'hold') {
      if (this.inside) { st = '◆ HOLDING'; sc = '#7bf59a'; }
      else { st = '⚠ GET IN THE CIRCLE'; sc = '#ffd94a'; sa = 0.55 + beat * 0.45; }
    }
    label(st, x + W - 12 * s, y + 68 * s, 10, sc, 800, 'right', sa, false);

    // The clock as a rule under everything: the bar above is progress and this
    // is time, and neither is guessable from the other.
    r.drawRect(ix, y + 80 * s, iw * clamp(tf, 0, 1), 3 * s,
               urgent ? '#ff6f91' : PALETTE.textFaint, 0.9);
    r.setAlpha(1);
  }

  /**
   * THE POP-UP — the thing that was missing.
   *
   * Slides down into the top third, holds, slides back up. `a` runs 0 -> 1 -> 0
   * across the card's whole life and EVERYTHING else is derived from it — the
   * fade, the slide, whether to draw at all — so the card cannot get out of step
   * with its own animation, which is how a panel ends up hanging fully opaque at
   * an offset nobody wrote.
   */
  _popup(r) {
    const def = this.def;
    if (!def) return;
    const life = this.popLife, t = this.popT;
    const a = t < POP_IN ? easeOutCubic(t / POP_IN)
            : t > life - POP_OUT ? clamp((life - t) / POP_OUT, 0, 1)
            : 1;
    // Below this the card is a smear that still costs twenty draw calls, and a
    // panel at alpha 0 is a draw the headless smoke test correctly complains
    // about.
    if (a < 0.02) return;

    const s = ui.scale;
    const outcome = this.popMode === POP_OUTCOME;
    const W = Math.min(r.w - 40, 470 * s);
    const H = (outcome ? 106 : 142) * s;
    const x = (r.w - W) / 2;
    // Clear of the run timer and the wave name above it, clear of the kill
    // streak, and out of the centre of the screen where the fight is. It is only
    // here for five seconds; it does not get to own the middle.
    //
    // Held off the bottom 38% for the same reason the banner is, and it is the
    // taller of the two so it needs it more: the card grows with the UI scale
    // and the window does not, so at 1.4 on a short window the note and the
    // reward line were drawn under the build strip. The HUD renders after this
    // system, so "under" means invisible, not merely crowded.
    const y = Math.min(Math.max(r.h * 0.27, 150 * s), Math.max(88 * s, r.h * 0.62 - H))
            + (1 - a) * -30 * s;
    const col = outcome ? (this.success ? '#7bf59a' : '#8e97b5') : this.color;

    PANEL.borderColor = col;
    PANEL.borderWidth = 2.5;
    PANEL.alpha = a;
    ui.panel(x, y, W, H, PANEL);
    r.drawRect(x + 3, y + 10 * s, 5 * s, H - 20 * s, col, a * 0.95);
    r.drawRect(x + 12 * s, y + 3, W - 24 * s, 3 * s, col, a * 0.5);

    if (outcome) {
      const cxp = x + W / 2;
      title(this.success ? 'EVENT CLEARED' : 'EVENT MISSED', cxp, y + 36 * s, 28, col, 'center', a);
      label(def.name, cxp, y + 64 * s, 13, PALETTE.textDim, 700, 'center', a, false);
      label(this.success ? this.rewardLine : 'No reward. The next one is already on its way.',
            cxp, y + 86 * s, 12,
            this.success ? PALETTE.gold : PALETTE.textFaint, 800, 'center', a, false);
    } else {
      const tx = x + 20 * s;
      label(this.kicker, tx, y + 22 * s, 10, PALETTE.textFaint, 800, 'left', a, false);
      label(Math.ceil(this.timeLeft) + 's', x + W - 20 * s, y + 26 * s, 24, col, 800, 'right', a, true);
      title(def.name, tx, y + 52 * s, 26, col, 'left', a);
      // THE LINE THE WHOLE CARD EXISTS FOR. Biggest body text on the panel, full
      // white, weight 800 — if a player reads exactly one thing here, it has to
      // be the one that says what to do.
      //
      // Bounded for the same reason the banner's copy of it is: the four derived
      // sentences fit here at every UI scale with room to spare, but the moment
      // an entry authors its own `instruction` that stops being a fact about the
      // code and becomes a fact about the content, and the line that runs off
      // the plate would be this one.
      label(ellipsize(r, this.instruction, W - 40 * s, 16, 800),
            tx, y + 82 * s, 16, PALETTE.text, 800, 'left', a, false);
      label(this.note, tx, y + 103 * s, 12, PALETTE.textFaint, 600, 'left', a, false);
      if (this.rewardLine) {
        label(this.rewardLine, tx, y + 124 * s, 11, PALETTE.gold, 800, 'left', a, false);
      }
    }
    r.setAlpha(1);
  }
}

/**
 * THE INSTRUCTION, DERIVED FROM THE ENTRY.
 *
 * Four handlers, four sentences, and the count comes out of the same `need` the
 * handler counts against — so an event that asks for 22 kills says 22 without
 * anybody writing 22 down twice and one of the two going stale. This is the
 * whole reason a new event stays a data-only addition: the sentence arrives with
 * the entry, for free, and it cannot disagree with the rule it describes.
 *
 * Plain words on purpose. "Claim the objective" is what the first pass said and
 * it is not an instruction, it is a restatement of the fact that there is one.
 */
function instructionFor(kind, need) {
  switch (kind) {
    case 'cull':   return 'Kill ' + need + ' enemies inside the ring';
    case 'hold':   return 'Survive ' + need + 's inside the ring';
    case 'gather': return 'Collect all ' + need + ' motes';
    default:       return 'Stand in the marked circle';
  }
}

/**
 * The one thing about each handler that is not obvious from watching it, and
 * that costs a run's worth of confusion to learn the hard way. Keyed by `kind`,
 * so these are four strings for the whole table rather than one per event.
 */
const KIND_NOTES = {
  reach:  'Step back out and the claim drains twice as fast as it filled.',
  cull:   'Only kills INSIDE the ring count. Killing on the way there does not.',
  hold:   'The ring closes as the clock runs — the floor gets smaller, not safer.',
  gather: 'They are the bright motes around the marker. Walk over them.',
};

/** The banner's right-hand status line for the kinds with no in/out state. */
const KIND_STATUS = {
  cull:   'IN-RING KILLS ONLY',
  gather: 'WALK OVER THEM',
};

/**
 * What it pays, in one line, built once when the event starts.
 *
 * `xpLevels` is printed as a percentage OF A LEVEL rather than as XP, because
 * that is what it actually is — the payout scales with the curve, and a flat
 * number on the card would be a different promise at minute two than at minute
 * eighteen even though the reward is identical.
 */
const SEP = '  ·  ';

function rewardLine(R) {
  if (!R) return '';
  let s = '';
  if (R.xpLevels) s += '+' + Math.round(R.xpLevels * 100) + '% of a level';
  if (R.gold) s += (s ? SEP : '') + R.gold + ' gold';
  if (R.healPct) s += (s ? SEP : '') + '+' + Math.round(R.healPct * 100) + '% HP';
  if (R.goldChest) s += (s ? SEP : '') + 'GOLD CHEST';
  else if (R.chest) s += (s ? SEP : '') + 'CHEST';
  return s;
}

// THE DRAW-OPTION BAGS, HOISTED.
//
// Same rule the HUD's duration chips follow, and for the same reason: these are
// handed to the toolkit on every rendered frame for as long as a card is up, and
// a per-frame path in this project allocates nothing. Every field that varies is
// rewritten on every use — that is what `label` and `title` are for, and it is
// why they take the varying fields as arguments rather than letting a caller
// remember which ones to set. A leaked field from the previous call is exactly
// the bug this shape exists to make impossible.
const PANEL = {
  radius: 6, color: 'rgba(12,16,28,0.93)', borderColor: '', borderWidth: 2, alpha: 1,
};
const LABEL = {
  size: 12, color: '', weight: 700, align: 'left', baseline: 'middle', alpha: 1, mono: false,
};
const TITLE = {
  size: 26, color: '', weight: 800, align: 'left', baseline: 'middle', alpha: 1,
  display: true, outline: true,
};
const BAR = { bg: 'rgba(4,6,14,0.85)', segments: 10 };

/** The marker's own label, in WORLD space — it rides the arena, not the screen. */
const MARKER_NAME = {
  size: 19, color: '#ffffff', align: 'center', baseline: 'middle',
  weight: 800, outline: true, alpha: 1,
};
const MARKER_COUNT = {
  size: 15, color: '#ffffff', align: 'center', baseline: 'middle',
  weight: 800, outline: true, alpha: 1,
};

function label(str, x, y, size, color, weight, align, alpha, mono) {
  LABEL.size = size; LABEL.color = color; LABEL.weight = weight;
  LABEL.align = align; LABEL.alpha = alpha; LABEL.mono = mono;
  ui.text(str, x, y, LABEL);
}

function title(str, x, y, size, color, align, alpha) {
  TITLE.size = size; TITLE.color = color; TITLE.align = align; TITLE.alpha = alpha;
  ui.text(str, x, y, TITLE);
}
