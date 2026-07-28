// The WaveDirector: reads the spawn timeline and spawns accordingly.
//
// NAMING (DECISIONS.md §13): the spec uses "Director" for three different
// systems. This one — and only this one — is the WaveDirector. The adaptive
// difficulty system is the AdaptiveDirector; the unkillable sweeper is the
// Stage Manager.
//
// TIME (DECISIONS.md §20): timelines are authored in NORMALISED time (0..1) and
// scaled to each stage's duration at load, because stages run 15/20/22/25
// minutes and the spec's curve was written against a fixed 20. Three anchors are
// then re-pinned exactly rather than left to the fraction:
//     mid-boss   at 0.50 * duration
//     calm       at duration - 60s   (5 seconds of NOTHING)
//     final boss at duration - 55s
//
// MID-BOSSES, PLURAL. Every stage now runs two or three mid-boss fights (play
// report: "add mini bosses to each stage"), so exactly ONE of them can own the
// halfway anchor. The one whose authored time is nearest 0.50 gets it and is
// marked `anchor` — that is the stage's SIGNATURE mid-boss, the one named in
// stages.js `midBoss`, and it is the one that clears the screen first and pays
// the full mid-boss loot table. The extra mini-bosses keep their authored,
// scaled times and are spawned with `isMini` set. See waves.js for the ladder.
//
// Only one boss is ever live at once: BossController holds a single `active`
// entity, so a second mid-boss spawned on top of the first would silently turn
// the first into an inert statue that never attacks again. A mid-boss whose beat
// arrives while a fight is still going is POSTPONED instead (_postpone), which
// costs nothing and cannot desync the rest of the timeline.

import { runRng } from '../core/rng.js';
import { CONFIG } from '../core/config.js';
import { feel } from '../core/feel.js';
import { events, EV } from '../core/events.js';
import { floaters } from '../render/damageNumbers.js';
import { particles } from '../render/particles.js';
import { audio } from '../core/audio.js';
import { clamp, TAU, dist2 } from '../core/math.js';
import { SCALING } from '../data/stages.js';

export class WaveDirector {
  constructor(run) {
    this.run = run;
    /** Scaled, sorted, re-anchored copy of the stage's timeline. */
    this.timeline = [];
    this.next = 0;
    /** Events currently spreading their spawns over `duration`. */
    this.pending = [];
    this.calmUntil = 0;
    this.bossSpawned = false;
    this.midBossSpawned = false;
    this.stageManagerSpawned = false;
    /** Waves suppressed by the entity cap, so the F3 overlay can show the backlog. */
    this.queueDepth = 0;
    this.spawnedTotal = 0;
    this._trickle = 0;
  }

  load(stage, waveList) {
    const D = stage.duration;
    this.timeline.length = 0;
    this.pending.length = 0;
    this.next = 0;
    this.bossSpawned = false;
    this.midBossSpawned = false;
    this.stageManagerSpawned = false;
    this.spawnedTotal = 0;

    for (const w of waveList) {
      const ev = {
        t: w.t * D,
        type: w.type, enemy: w.enemy, count: w.count || 1,
        pattern: w.pattern || 'edge_random',
        duration: w.duration || 0,
        modifiers: w.modifiers || null,
        side: w.side || null,
        anchor: false,
        fired: false,
      };
      // Re-anchor the two fixed END beats exactly. The halfway mid-boss anchor is
      // resolved below, once every mid-boss on the timeline is known.
      if (w.type === 'calm') { ev.t = D - 60; ev.duration = feel.preBossCalm; }
      else if (w.type === 'boss') ev.t = D - 55;
      this.timeline.push(ev);
    }

    // A stage whose author forgot an anchor still gets one — the acceptance
    // criteria promise a boss at the halfway mark on every stage. `midBosses` is
    // the full ladder; `midBoss` alone is the pre-mini-boss shape and still works.
    if (!this.timeline.some((e) => e.type === 'midboss')) {
      const ids = (stage.midBosses && stage.midBosses.length)
        ? stage.midBosses : (stage.midBoss ? [stage.midBoss] : []);
      for (let i = 0; i < ids.length; i++) {
        // The signature keeps 0.50; the rest spread evenly across the middle.
        const f = ids[i] === stage.midBoss || ids.length === 1
          ? 0.5 : 0.26 + (0.52 * i) / Math.max(1, ids.length - 1);
        this.timeline.push({ t: D * f, type: 'midboss', enemy: ids[i], count: 1,
                             anchor: false, fired: false, pattern: 'cluster' });
      }
    }
    if (!this.timeline.some((e) => e.type === 'boss') && stage.boss) {
      this.timeline.push({ t: D - 60, type: 'calm', duration: feel.preBossCalm, anchor: false, fired: false });
      this.timeline.push({ t: D - 55, type: 'boss', enemy: stage.boss, count: 1, anchor: false, fired: false, pattern: 'cluster' });
    }

    // The halfway anchor: whichever mid-boss was authored closest to 0.50 is
    // pinned there exactly, and is thereafter the stage's signature. Picking by
    // proximity rather than by id means a stage that renames its mid-boss, or
    // lists the same creature twice, still lands one fight on the halfway beat.
    let best = -1, bestErr = Infinity;
    for (let i = 0; i < this.timeline.length; i++) {
      const ev = this.timeline[i];
      if (ev.type !== 'midboss') continue;
      const err = Math.abs(ev.t / D - 0.5);
      if (err < bestErr) { bestErr = err; best = i; }
    }
    if (best >= 0) { this.timeline[best].t = D * 0.5; this.timeline[best].anchor = true; }

    this.timeline.sort((a, b) => a.t - b.t);
  }

  /**
   * Re-sort after an out-of-band retime — today that is only Run.callBossEarly,
   * which drags the finale forward for a finished build. Everything already fired
   * keeps the front of the array so `next` stays exactly "how many events have
   * happened", which is the invariant the whole update loop is built on.
   */
  resort() {
    this.timeline.sort((a, b) => (a.fired === b.fired ? a.t - b.t : (a.fired ? -1 : 1)));
    this.next = 0;
    while (this.next < this.timeline.length && this.timeline[this.next].fired) this.next++;
  }

  /**
   * Move the event at `i` to `when` and slide it back into sorted position.
   * `next` deliberately does NOT advance: index `i` now holds whatever came after
   * it, and the caller's loop should look at that instead.
   */
  _postpone(i, when) {
    const ev = this.timeline[i];
    ev.t = when;
    this.timeline.splice(i, 1);
    let j = i;
    while (j < this.timeline.length && this.timeline[j].t < when) j++;
    this.timeline.splice(j, 0, ev);
  }

  update(dt) {
    const run = this.run;
    const t = run.time;

    // Fire everything whose time has come.
    while (this.next < this.timeline.length && this.timeline[this.next].t <= t) {
      const ev = this.timeline[this.next];
      // One boss at a time, always. Spawning a mid-boss over a live one would
      // hand BossController a new `active` and leave the old fight standing there
      // with no AI at all, so the beat waits its turn instead.
      if (ev.type === 'midboss' && run.boss.isActive) {
        this._postpone(this.next, t + MIDBOSS_RETRY);
        continue;
      }
      this._fire(ev);
      this.next++;
    }

    // Advance spread spawns.
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i];
      p.acc += dt;
      const want = Math.floor((p.acc / p.duration) * p.total) - p.done;
      if (want > 0) {
        const made = this._spawnBatch(p.def, want, p.pattern, p.side, p.modifiers);
        p.done += made;
        this.queueDepth += want - made;
      }
      if (p.acc >= p.duration || p.done >= p.total) {
        this.pending.splice(i, 1);
        i--;
      }
    }

    // Baseline trickle. This is a FLOOR that keeps the arena from emptying
    // between authored events — not the main spawn source.
    //
    // It used to be a pure rate formula, which produced 236 enemies at minute 2
    // against SECTION 8's stated 40-70 for that window: the trickle drowned out
    // the authored timeline entirely and the teaching phase was a wall. It now
    // targets the density curve directly and only fires when the arena is BELOW
    // the count the curve calls for at this point in the run.
    if (t > this.calmUntil && !run.bossActive) {
      this._trickle -= dt;
      if (this._trickle <= 0) {
        const target = this.targetDensity(t) * run.adaptive.spawnRateMult *
                       (run.modifier && run.modifier.params.countMult ? run.modifier.params.countMult : 1) *
                       run.difficultyMult.count;
        const deficit = target - run.enemies.count;
        if (deficit > 0) {
          // Refill proportionally to how far below the curve we are, so a
          // screen-clear recovers quickly and a full screen stays quiet.
          //
          // The rate has to beat the player's kill rate or the late game never
          // arrives: by minute 13 a built player is killing ~23/second, and a
          // gentler refill left 70 enemies on screen where SECTION 8 asks for
          // 250-400. That "screen is fully covered" phase is the one the genre
          // exists for — under-filling it is the difference between the power
          // fantasy landing and the run just fizzling out.
          const batch = clamp(Math.ceil(deficit * 0.14), 1, 18);
          const def = this._pickMob(t);
          if (def) this._spawnBatch(def, batch, 'edge_random', null, null);
          this._trickle = deficit > target * 0.4 ? 0.18 : 0.35;
        } else {
          this._trickle = 0.8;
        }
      }
    }

    // The Stage Manager — DECISIONS.md §21.
    if (!this.stageManagerSpawned && t > run.stage.duration + 180 && !run.victory) {
      this.stageManagerSpawned = true;
      this._spawnStageManager();
    }
  }

  /**
   * How many enemies SECTION 8's density curve wants alive at this point.
   * Authored verbatim from lines 1234-1244, in normalised time so it scales to
   * a 15, 20, 22 or 25 minute stage (DECISIONS.md §20).
   *
   *   0.00-0.10   15-30    teaching, one mob type
   *   0.10-0.25   40-70    second mob type
   *   0.25-0.45   80-130   three types mixing
   *   0.50-0.75   140-220  elite packs
   *   0.75-0.95   250-400  "the screen is fully covered" phase
   */
  targetDensity(t) {
    const f = clamp(t / this.run.stage.duration, 0, 1);
    for (let i = 1; i < DENSITY.length; i++) {
      if (f <= DENSITY[i][0]) {
        const a = DENSITY[i - 1], b = DENSITY[i];
        const k = (f - a[0]) / Math.max(1e-6, b[0] - a[0]);
        return a[1] + (b[1] - a[1]) * k;
      }
    }
    return DENSITY[DENSITY.length - 1][1];
  }

  _pickMob(t) {
    const run = this.run;
    const table = run.stage.mobTable;
    if (!table || table.length === 0) return null;
    // Weighted pick among entries whose `from` gate has opened.
    let total = 0;
    for (const m of table) if (t >= (m.from || 0)) total += m.weight || 10;
    if (total <= 0) return run.data.enemies.ENEMIES_BY_ID[table[0].id];
    let r = runRng.raw() * total;
    for (const m of table) {
      if (t < (m.from || 0)) continue;
      r -= (m.weight || 10);
      if (r <= 0) return run.data.enemies.ENEMIES_BY_ID[m.id];
    }
    return run.data.enemies.ENEMIES_BY_ID[table[0].id];
  }

  _fire(ev) {
    const run = this.run;
    if (ev.fired) return;
    ev.fired = true;

    switch (ev.type) {
      case 'calm':
        this.calmUntil = run.time + (ev.duration || feel.preBossCalm);
        // The silence before the boss. Clear the field so it lands clean.
        run.clearFodder();
        floaters.spawn(run.player.x, run.player.y - 120, '...', '#8e97b5', 30, 2.2);
        break;

      case 'midboss': {
        const def = run.data.bosses.BOSSES_BY_ID[ev.enemy];
        if (!def) break;
        // ONLY the signature mid-boss clears the screen. That wipe is a dramatic
        // beat and it is also a total XP write-off — every fodder enemy alive is
        // deleted without dropping a gem — and doing it two or three times a run
        // would be a silent tax on levelling that nothing on screen explains. A
        // mini-boss walks in through the crowd, which is what "mini" means.
        if (ev.anchor) run.clearFodder();
        this.midBossSpawned = true;
        run.spawnBoss(def, true, !ev.anchor);
        break;
      }

      case 'boss': {
        const def = run.data.bosses.BOSSES_BY_ID[ev.enemy];
        if (!def) break;
        this.bossSpawned = true;
        run.spawnBoss(def, false);
        break;
      }

      case 'elite': {
        const def = run.data.bosses.BOSSES_BY_ID[ev.enemy] ||
                    run.data.enemies.ENEMIES_BY_ID[ev.enemy];
        if (!def) break;
        for (let i = 0; i < ev.count; i++) run.spawnElite(def);
        break;
      }

      default: {
        const def = run.data.enemies.ENEMIES_BY_ID[ev.enemy] ||
                    run.data.bosses.BOSSES_BY_ID[ev.enemy];
        if (!def) break;
        let count = ev.count;
        const mod = run.modifier;
        if (mod && mod.params.countMult) count = Math.round(count * mod.params.countMult);
        count = Math.round(count * run.difficultyMult.count);
        if (ev.duration > 0) {
          this.pending.push({ def, total: count, done: 0, acc: 0, duration: ev.duration,
                              pattern: ev.pattern, side: ev.side, modifiers: ev.modifiers });
        } else {
          const made = this._spawnBatch(def, count, ev.pattern, ev.side, ev.modifiers);
          this.queueDepth += count - made;
        }
        if (ev.type === 'ring' || ev.type === 'swarm') audio.play('telegraph');
        break;
      }
    }
  }

  /** @returns how many actually spawned (the cap may refuse some). */
  _spawnBatch(def, count, pattern, side, modifiers) {
    const run = this.run;
    const p = run.player;
    const vw = run.camera.viewHalfW(90);
    const vh = run.camera.viewHalfH(90);
    let made = 0;

    const opts = modifiers ? {
      hpMult: modifiers.hpMult || 1,
      speedMult: modifiers.speedMult || 1,
      affixes: modifiers.affix ? run.affixesFor(modifiers.affix) : null,
    } : EMPTY;

    for (let i = 0; i < count; i++) {
      if (run.totalEntities() >= CONFIG.MAX_ENTITIES) break;
      let x, y, telegraph = 0;
      switch (pattern) {
        case 'edge_side': {
          const s = side || SIDES[runRng.int(0, 3)];
          if (s === 'left')  { x = p.x - vw; y = p.y + (i / count - 0.5) * vh * 2; }
          else if (s === 'right') { x = p.x + vw; y = p.y + (i / count - 0.5) * vh * 2; }
          else if (s === 'top') { x = p.x + (i / count - 0.5) * vw * 2; y = p.y - vh; }
          else { x = p.x + (i / count - 0.5) * vw * 2; y = p.y + vh; }
          break;
        }
        case 'ring': {
          const a = (i / count) * TAU;
          const rad = 700;
          x = p.x + Math.cos(a) * rad;
          y = p.y + Math.sin(a) * rad;
          break;
        }
        case 'cluster': {
          if (i === 0) { const a = runRng.angle(); this._cx = p.x + Math.cos(a) * (vw * 0.9); this._cy = p.y + Math.sin(a) * (vh * 0.9); }
          const a2 = runRng.angle(), d = runRng.raw() * 130;
          x = this._cx + Math.cos(a2) * d;
          y = this._cy + Math.sin(a2) * d;
          break;
        }
        case 'chase_line': {
          // A snaking line that follows the player's recent path.
          const trail = run.playerTrail;
          const idx = clamp(trail.length - 1 - i * 2, 0, trail.length - 1);
          const pt = trail[idx];
          x = pt ? pt.x : p.x - vw;
          y = pt ? pt.y : p.y;
          break;
        }
        case 'ambush': {
          const a = runRng.angle();
          const d = runRng.range(120, 260);
          x = p.x + Math.cos(a) * d;
          y = p.y + Math.sin(a) * d;
          telegraph = feel.telegraphAmbush;   // ALWAYS telegraphed
          break;
        }
        case 'scatter_interior': {
          x = runRng.range(run.bounds.minX + 80, run.bounds.maxX - 80);
          y = runRng.range(run.bounds.minY + 80, run.bounds.maxY - 80);
          break;
        }
        default: { // edge_random
          const a = runRng.angle();
          x = p.x + Math.cos(a) * vw * runRng.range(1.0, 1.18);
          y = p.y + Math.sin(a) * vh * runRng.range(1.0, 1.18);
        }
      }
      x = clamp(x, run.bounds.minX + 12, run.bounds.maxX - 12);
      y = clamp(y, run.bounds.minY + 12, run.bounds.maxY - 12);

      const o = telegraph ? { hpMult: opts.hpMult, speedMult: opts.speedMult, affixes: opts.affixes, telegraph } : opts;
      const e = run.enemies.spawn(def, x, y, o);
      if (e) { made++; this.spawnedTotal++; }
      else break;
    }
    return made;
  }

  _spawnStageManager() {
    const run = this.run;
    const def = run.data.bosses.BOSSES_BY_ID.stage_manager;
    if (!def) return;
    const a = runRng.angle();
    const e = run.enemies.spawn(def, run.player.x + Math.cos(a) * 700, run.player.y + Math.sin(a) * 700,
                                { isBoss: true });
    if (!e) return;
    e.knockbackImmune = true;
    run.stageManager = e;
    run.stageManagerT = 0;
    audio.play('stageManager');
    floaters.spawn(run.player.x, run.player.y - 130, "THAT'S A WRAP.", '#ff3a5e', 40, 3.2);
    events.emit('stageManager:spawned', e);
  }

  /** For the F3 overlay and the results screen. */
  stats() {
    return { next: this.next, total: this.timeline.length, queued: this.queueDepth, spawned: this.spawnedTotal };
  }
}

const SIDES = ['left', 'right', 'top', 'bottom'];
const EMPTY = {};

/** Seconds a mid-boss beat waits before retrying when a fight is still live. */
const MIDBOSS_RETRY = 4;

/** [normalisedTime, enemiesAlive] — SECTION 8's curve as data. */
const DENSITY = [
  [0.00, 12],
  [0.10, 30],
  [0.25, 65],
  [0.45, 120],
  [0.50, 140],
  [0.75, 215],
  [0.95, 330],
  [1.00, 360],
];
