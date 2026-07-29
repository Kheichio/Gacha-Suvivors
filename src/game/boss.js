// Boss controller: phases, telegraphed attacks, intro cards, weak points,
// destructible parts, and the player-mirror.
//
// Bosses are data (data/bosses.js). This file is the ~20 attack KINDS those data
// entries compose from. A new boss is a data object; a new attack kind is one
// entry in ATTACKS. Nothing here branches on a boss id.
//
// SECTION 9's rule is the spine: bosses deal NO contact damage. They hurt you
// with attacks you can read and dodge. Every lethal attack draws a telegraph
// through hazards.js, which pairs its colour with a shape.
//
// A PHASE IS A DIFFERENT FIGHT, NOT A LONGER ONE
// ----------------------------------------------
// Play report: "make final bosses two-three stages long, make them have much
// more hp". More HP alone would have made every boss the same forty seconds
// twice, which is the exact failure mode a health-bar buff always has. So three
// things moved together and none of them works without the other two:
//
//   1. HP. `def.finaleHpMult` is applied HERE, in spawn(), and only when the
//      boss walks on as its stage's FINALE. It is deliberately not baked into
//      `def.hp`, because `def.hp` is also what the Grand Finale modifier reads
//      when it respawns an old boss as a Stage 7 elite (x8 already) and what the
//      codex quotes. Multiplying the data would have turned four roaming recap
//      elites into 300,000-HP roadblocks nobody could clear.
//
//   2. PACE. `phase.attackRateMult` and `phase.telegraphMult` mean phase three
//      is not phase one with an extra move — it is faster, its wind-ups are
//      shorter, and its attack list is DISJOINT from the list before it. The
//      telegraph is clamped at `def.telegraphFloor` no matter how hard a phase
//      pushes; that clamp is the difference between "hard" and "unfair" and the
//      data file says so in its own header.
//
//   3. THE BREAK. Crossing a phase threshold staggers the boss: it stops dead,
//      takes `transition.vuln`x damage for a couple of seconds, eats a
//      slow-motion beat, a grade, a shockwave and its own bark line. It is the
//      unmissable read on "the fight changed", and it is also the pacing valve —
//      the free damage window is what keeps 2.5x the health from being 2.5x the
//      time.
//
// EVERY ATTACK ANIMATES. The attack kinds below drive render/effects.js: a
// wind-up that pulses on the telegraph ring, an impact on the frame the thing
// lands, and a follow-through as it leaves. Nothing here registers a sprite —
// effects.js draws from renderer primitives — so animating an attack can never
// rasterise mid-fight. The one exception is the three PROJECTILE kinds, whose
// atlas descriptors go through attackVisual() for exactly that reason.
//
// THE ATTACKS NOW READ THEIR OWN PARAMS
// -------------------------------------
// Writing the phase lists out flushed out that a third of the attack table was
// decorative. The data said `projectiles: 24, rings: 3, gapArc: 0.5`; the runner
// read `P.count` and fired one gapless ring of sixteen. `summonAdds` read
// `P.enemy` while every boss in the file authors `spawns: [{ enemy, count }]`,
// so NO BOSS IN THE GAME HAS EVER SUMMONED ANYTHING. `tentacleSlam` sized itself
// off the (inert) destructible-parts array and therefore always resolved to zero
// arms — the Kraken's opener and the Final Form's sixth movement were both
// no-ops. `rotatingSweep` ignored `arms`, `angularSpeed` and `length`.
//
// All of that is fixed below, and the fix is why "2.5x the health" is not "2.5x
// the boredom": phase two of the President is now a summon phase because the
// summon works, and the ring attacks now have the gaps their own descriptions
// promise, which makes them MORE dodgeable while looking like far more.
//
// `duration` is authored on the FINAL bosses' attacks only. Without it an attack
// ends one tick after it fires, which is correct for a slam and nonsense for a
// six-second sweeping laser. Mid-bosses are deliberately left instantaneous:
// their HP ladder is a tuned 1.8x staircase (see data/stages.js) and lengthening
// their channels would move every rung on it.

import { runRng, fxRng } from '../core/rng.js';
import { feel } from '../core/feel.js';
import { CONFIG } from '../core/config.js';
import { events, EV } from '../core/events.js';
import { audio } from '../core/audio.js';
import { particles } from '../render/particles.js';
import { effects } from '../render/effects.js';
import { floaters } from '../render/damageNumbers.js';
import { shake, flash } from '../render/screenShake.js';
import { clamp, dirTo, V, dist2, TAU, lerp, angleTo, rotateToward } from '../core/math.js';
import { damagePlayer, SRC } from './damage.js';
import { applyStun, applyBurn, applyPull, addShield, applyVulnerable } from './statusEffects.js';
import { MOTION } from './projectile.js';

/**
 * Fallback for a phase that declares no `transition`. Every FINAL boss authors
 * its own; mid-bosses and elites fall through to this, which is deliberately
 * small — a mid-boss break should register without stopping the run dead.
 */
const DEFAULT_TRANSITION = { stagger: 0.7, vuln: 1.6, vulnTail: 0.8, slowmo: 0.5, slowmoT: 0.28 };

export class BossController {
  constructor(run) {
    this.run = run;
    this.active = null;
    this.def = null;
    this.introT = 0;
    this.phaseIndex = 0;
    this.attackCd = 0;
    this.current = null;
    this.attackT = 0;
    this.attackStage = 0;
    this.deathT = 0;
    this.qte = null;
    /** Seconds left of the phase-transition stagger. Nothing acts while it runs. */
    this.staggerT = 0;
    this.staggerTotal = 0;
    this._lastKey = null;
    /** Throttle for effects spawned outside an attack (the stagger sparks). */
    this._fxT = 0;
    /** Per-tentacle / per-tail HP for multi-part bosses. */
    this.parts = null;
    this.partAngles = null;
    /**
     * ONE attack record, reused. `_chooseAttack` used to build a fresh object
     * literal per cast, which is an allocation on a path that runs every few
     * seconds for the whole fight. `this.current` is still either null or this
     * exact object, so `_stillFighting`'s identity check reads the same.
     */
    this.cur = { key: null, def: null, impl: null, t: 0, stage: 0, fx: 0, tel: 0 };
  }

  spawn(def, x, y, isMidBoss) {
    const run = this.run;
    const e = run.enemies.spawn(def, x, y, { isBoss: !isMidBoss, isMidBoss: !!isMidBoss });
    if (!e) return null;
    e.knockbackImmune = true;
    // THE FINALE MULTIPLIER, and the one place it is allowed to exist. See the
    // header: `def.hp` stays the number the codex quotes and the number the
    // Grand Finale's x8 elite pass multiplies, so a recap elite is still a
    // recap elite and not a wall.
    const finaleMult = isMidBoss ? 1 : (def.finaleHpMult || 1);
    e.hp = e.maxHp = def.hp * finaleMult * run.difficultyMult.hp * (run.stage.hpMult || 1) *
                     (1 + 0.06 * (run.time / 60));
    e.radius = (def.visual.size || 60);
    e.bossDef = def;

    this.active = e;
    this.def = def;
    this.introT = feel.bossIntroDuration;
    this.phaseIndex = 0;
    this.attackCd = feel.bossIntroDuration + 0.8;
    this.current = null;
    this.attackStage = 0;
    this.deathT = 0;
    this.qte = null;
    this.staggerT = 0;
    this.staggerTotal = 0;
    this._lastKey = null;
    // Phase objects are module-level data literals shared by every run in the
    // session, and `weakPoint` is written onto them. Wipe it at the door so a
    // run that ended inside a nape window cannot hand the next one a boss that
    // is permanently exposed.
    if (def.phases) for (let i = 0; i < def.phases.length; i++) def.phases[i].weakPoint = false;

    // Multi-part bosses (the Kraken's 8 tentacles, the Sealed Beast's 9 tails).
    if (def.parts) {
      this.parts = new Float32Array(def.parts.count);
      this.partAngles = new Float32Array(def.parts.count);
      for (let i = 0; i < def.parts.count; i++) {
        this.parts[i] = def.parts.hp * run.difficultyMult.hp;
        this.partAngles[i] = (i / def.parts.count) * TAU;
      }
      e.parts = this.parts;
    }

    audio.play('bossIntro');
    shake.medium();
    events.emit(EV.BOSS_SPAWNED, e, def);
    return e;
  }

  get isActive() { return !!(this.active && this.active.active && this.active.hp > 0); }
  get phase() { return this.def && this.def.phases ? this.def.phases[this.phaseIndex] : null; }
  /** True while the boss is broken open between phases. The HUD reads it. */
  get staggered() { return this.staggerT > 0; }

  update(dt) {
    const e = this.active;
    const run = this.run;
    if (!e) return;
    if (!e.active || e.hp <= 0) { this.active = null; this.def = null; return; }

    const p = run.player;

    // --- intro card ---------------------------------------------------------
    if (this.introT > 0) {
      this.introT -= dt;
      // Drift into frame; invulnerable and inert while the card is up.
      e.st.invulnT = Math.max(e.st.invulnT, 0.05);
      if (dirTo(e.x, e.y, p.x, p.y) > 340) {
        e.x += V.x * 90 * dt;
        e.y += V.y * 90 * dt;
      }
      return;
    }

    // --- phase transitions --------------------------------------------------
    // Resolved BEFORE the stagger gate, so a burst big enough to cross two
    // thresholds inside one break still gets both breaks rather than silently
    // skipping a phase's opening bark.
    const frac = e.hp / e.maxHp;
    const phases = this.def.phases;
    if (phases) {
      let want = this.phaseIndex;
      for (let i = 0; i < phases.length; i++) {
        if (frac <= phases[i].hpFrom && frac > phases[i].hpTo) { want = i; break; }
        if (i === phases.length - 1 && frac <= phases[i].hpFrom) want = i;
      }
      if (want !== this.phaseIndex) {
        this.phaseIndex = want;
        this._enterPhase(phases[want]);
      }
    }

    // --- the break ----------------------------------------------------------
    if (this.staggerT > 0) {
      this.staggerT -= dt;
      this._staggerFx(e, dt);
      return;
    }

    // --- movement -----------------------------------------------------------
    const ph = this.phase;
    const speedMult = (ph && ph.speedMult) || 1;
    const c = this.current;
    // `impl.moves` — the attack is driving the body itself (a dash). `impl.roots`
    // — the boss plants to channel. Either way the chase is suppressed, which is
    // what stops a beam's origin sliding sideways out from under its telegraph.
    if (!c || (c.def.allowMove !== false && !c.impl.moves && !c.impl.roots)) {
      const keep = this.def.keepDistance || 0;
      const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y));
      if (d > keep + 40) {
        if (dirTo(e.x, e.y, p.x, p.y) > 1) {
          e.x += V.x * e.speed * speedMult * dt;
          e.y += V.y * e.speed * speedMult * dt;
        }
      } else if (keep > 0 && d < keep - 40) {
        if (dirTo(p.x, p.y, e.x, e.y) > 1) {
          e.x += V.x * e.speed * 0.6 * dt;
          e.y += V.y * e.speed * 0.6 * dt;
        }
      }
      e.facing = rotateToward(e.facing, angleTo(e.x, e.y, p.x, p.y), 2.2 * dt);
    }

    // --- attacks ------------------------------------------------------------
    if (this.current) {
      this._tickAttack(dt);
    } else {
      this.attackCd -= dt;
      if (this.attackCd <= 0) this._chooseAttack();
    }

    // --- multi-part rendering angles ----------------------------------------
    if (this.parts) {
      for (let i = 0; i < this.parts.length; i++) this.partAngles[i] += dt * 0.35;
    }
  }

  /**
   * THE BREAK. Four channels, because one is missable and two are a coincidence:
   * a stop, a grade, a shockwave and a line. The boss is also opened up — vuln
   * for the length of the stagger plus a tail — and that free window is the
   * pacing valve that pays for the finale HP multiplier.
   */
  _enterPhase(ph) {
    const run = this.run;
    const e = this.active;
    const tr = ph.transition || DEFAULT_TRANSITION;
    const enraged = !!ph.enrage;
    const color = enraged ? '#ff3a5e' : '#ffd76a';

    this._cancelAttack();
    this.staggerT = this.staggerTotal = tr.stagger || 0;
    this.attackCd = this.staggerT + (tr.recover || 1.0);

    // Broken open: it stops, it takes more, and the numbers say so.
    applyStun(e.st, this.staggerT);
    applyVulnerable(e.st, tr.vuln || 1.6, this.staggerT + (tr.vulnTail || 0.8));

    // 1. THE PAUSE.
    run.setSlowmo(tr.slowmo || 0.4, tr.slowmoT || 0.35);
    // 2. THE GRADE — a slow wash rather than a strobe, so it reads as a change
    //    of act instead of a hit. FlashController still caps and rate-limits it
    //    when `reduceFlashing` is on, which is why this goes through it at all.
    flash.fire(color, 0.55, 0.9);
    // 3. THE SHOCKWAVE — a double pulse out of the body, a white spoke-ring
    //    chasing it, and a core flash where the two meet.
    const f = fx();
    f.life = 0.62; f.from = e.radius * 0.5; f.width = 12; f.double = true; f.spokes = 16;
    effects.shockwave(e.x, e.y, e.radius * 5.2, color, f);
    const g = fx();
    g.life = 0.44; g.spokes = 22; g.width = 5;
    effects.burstRing(e.x, e.y, e.radius * 3.4, '#ffffff', g);
    const h = fx();
    h.size = e.radius * 0.9; h.life = 0.3;
    effects.impact(e.x, e.y, color, h);
    particles.ring(e.x, e.y, 30, color, 520);
    shake.big();
    audio.play('bossIntro');

    // 4. THE LINE. The phase name over the body, then the boss's own bark under
    //    the player where every other bark in the game lands.
    floaters.spawn(e.x, e.y - e.radius - 34, ph.name, color, 30, 2.4);
    const barks = this.def.barks;
    const line = barks && barks['phase' + (this.phaseIndex + 1)];
    if (line) run.bark(line);
    if (enraged) floaters.spawn(e.x, e.y - e.radius - 66, 'ENRAGED', '#ff3a5e', 22, 2.0);

    if (ph.shield) addShield(e.st, ph.shield);
    events.emit(EV.BOSS_PHASE, e, ph, this.phaseIndex);
  }

  /**
   * Drop the attack in progress, and run its `end()` first.
   *
   * A phase change and a death both used to just null `current`, which is fine
   * for a slam and is a leak for the two kinds that hold STATE outside the
   * record. `grabQte` leaves `player.flags.rooted` set — a soft-lock you can
   * only escape by dying, reproducible any time the transition damage lands
   * inside the mash window. `weakPoint` leaves `phase.weakPoint` true, and a
   * phase object is a MODULE-LEVEL DATA LITERAL shared by every run in the
   * session, so an interrupted nape window makes the nape permanently exposed
   * for the rest of the process.
   */
  _cancelAttack() {
    const c = this.current;
    this.current = null;
    // Both callers still hold a live `active` and `def` at this point, which is
    // why `end()` can be called at all — it is ordered before either is nulled.
    if (c && c.impl && c.impl.end) c.impl.end(this, c);
    if (this.qte) {
      if (this.run.player) this.run.player.flags.rooted = false;
      this.run.endQte(false);
      this.qte = null;
    }
  }

  /** Sparks off the body for as long as the break lasts. Throttled, not per-frame. */
  _staggerFx(e, dt) {
    this._fxT -= dt;
    if (this._fxT > 0) return;
    this._fxT = 0.14;
    const a = fxRng.raw() * TAU;
    const f = fx();
    f.life = 0.34; f.alpha = 0.8; f.size = e.radius * 0.3;
    effects.impact(e.x + Math.cos(a) * e.radius * 0.8, e.y + Math.sin(a) * e.radius * 0.8,
                   '#ffd76a', f);
  }

  _chooseAttack() {
    const ph = this.phase;
    const list = ph ? ph.attacks : Object.keys(this.def.attacks || EMPTY);
    if (!list || list.length === 0) { this.attackCd = 2; return; }
    // Avoid repeating the same attack back to back; players read patterns fast.
    let key = list[runRng.int(0, list.length - 1)];
    if (list.length > 1 && key === this._lastKey) {
      key = list[(list.indexOf(key) + 1 + runRng.int(0, list.length - 2)) % list.length];
    }
    this._lastKey = key;
    const def = this.def.attacks[key];
    if (!def) { this.attackCd = 1.5; return; }
    const impl = ATTACKS[def.kind];
    if (!impl) { this.attackCd = 1.5; return; }

    const c = this.cur;
    c.key = key; c.def = def; c.impl = impl; c.t = 0; c.stage = 0; c.fx = 0;
    // THE TELEGRAPH, resolved once and stored, because every wind-up frame and
    // the hazard painted below have to agree on the same number. A phase may
    // shorten it; `telegraphFloor` is where that stops. An attack authored with
    // telegraph 0 is a MECHANIC (a weak-point window), not a lethal move, and
    // the floor must not invent a wind-up for it.
    const raw = def.telegraph === undefined ? feel.telegraphLethal : def.telegraph;
    c.tel = raw > 0
      ? Math.max(raw * ((ph && ph.telegraphMult) || 1), this.def.telegraphFloor || 0.8)
      : 0;
    this.current = c;
    SCRATCH.i = 0; SCRATCH.x = 0; SCRATCH.y = 0; SCRATCH.a = 0; SCRATCH.n = 0;
    SCRATCH.u = 0; SCRATCH.v = 0; SCRATCH.w = 0;
    // Every lethal attack telegraphs first. That is the whole contract.
    if (impl.telegraph) impl.telegraph(this, c);
  }

  /**
   * Drive the attack in progress.
   *
   * THE BOSS CAN DIE INSIDE ITS OWN ATTACK. Thorns reflect its contact damage,
   * a burning field it walked into keeps ticking, a weapon executes it — and
   * `onDeath()` nulls both `active` and `current` when that happens. Every
   * attack callback in this file dereferences `bc.active`, so each one has to be
   * re-guarded rather than trusting the local `c` captured at the top.
   *
   * This was latent for the whole life of the project and only started throwing
   * once the player got strong enough to routinely kill a boss mid-attack:
   * `end()` ran on a corpse and read `.st` off null.
   */
  _tickAttack(dt) {
    const c = this.current;
    c.t += dt;
    const tel = c.tel;
    if (c.stage === 0) {
      this._windupFx(c, dt);
      if (!this._stillFighting(c)) return;
      if (c.impl.windup) c.impl.windup(this, c, dt);
      if (!this._stillFighting(c)) return;
      if (c.t >= tel) {
        c.stage = 1; c.t = 0; c.fx = 0;
        if (c.impl.fire) c.impl.fire(this, c);
      }
      return;
    }
    const dur = c.def.duration || 0;
    // Guarded BEFORE the callback as well as after it. `active()` dereferences
    // `bc.active` in a dozen places and `onDeath()` may already have nulled it —
    // the frame after a boss dies inside its own beam still arrives here.
    if (!this._stillFighting(c)) return;
    if (c.impl.active) c.impl.active(this, c, dt);
    if (!this._stillFighting(c)) return;
    if (c.t >= dur) {
      if (c.impl.end) c.impl.end(this, c);
      // end() can be the killing blow too.
      if (!this._stillFighting(c)) { return; }
      this.current = null;
      const ph = this.phase;
      // Enrage used to be a bare 0.7x on the cooldown. It still is, as the
      // FALLBACK — a phase that states its own `attackRateMult` overrides it, so
      // the seven finales set their own pace and nothing else in the file moved.
      const rate = (ph && ph.attackRateMult) || (ph && ph.enrage ? 1 / 0.7 : 1);
      this.attackCd = (c.def.cooldown || 4) / rate;
    }
  }

  /**
   * THE WIND-UP, shared by every kind so no attack can forget to have one.
   *
   * An imploding ring — `from` outside, `to` on the body — because energy
   * GATHERING and energy LEAVING are the same primitive run in opposite
   * directions, and the player has to be able to tell them apart at a glance.
   * The last beat before it lands gets a white flash instead: that is the frame
   * you are supposed to already be moving on.
   */
  _windupFx(c, dt) {
    const e = this.active;
    if (!e || c.tel <= 0) return;
    c.fx -= dt;
    if (c.fx > 0) return;
    const left = c.tel - c.t;
    const last = left <= 0.2;
    c.fx = last ? 0.1 : 0.26;
    const color = TELEGRAPH_FX[c.def.telegraphColor] || TELEGRAPH_FX.red;
    const f = fx();
    f.life = last ? 0.16 : 0.3;
    f.from = e.radius * (last ? 1.5 : 2.6);
    f.width = last ? 8 : 4;
    f.alpha = last ? 1 : 0.75;
    effects.shockwave(e.x, e.y, e.radius * 0.85, last ? '#ffffff' : color, f);
  }

  /** Is `c` still the live attack of a live boss? */
  _stillFighting(c) {
    return !!(this.active && this.active.active && this.active.hp > 0 && this.current === c);
  }

  /**
   * Damage routed at a destructible part. Returns true if the part absorbed it.
   * Used by the Kraken's tentacles and the Sealed Beast's tails.
   */
  damagePart(index, amount) {
    if (!this.parts || index < 0 || index >= this.parts.length) return false;
    if (this.parts[index] <= 0) return false;
    this.parts[index] -= amount;
    if (this.parts[index] <= 0) {
      this.parts[index] = 0;
      this._onPartDestroyed(index);
    }
    return true;
  }

  _onPartDestroyed(i) {
    const run = this.run;
    const e = this.active;
    const d = this.def.parts;
    particles.ring(e.x + Math.cos(this.partAngles[i]) * e.radius,
                   e.y + Math.sin(this.partAngles[i]) * e.radius, 18, '#ffd76a', 320);
    shake.medium();
    floaters.spawn(e.x, e.y - e.radius, d.destroyedText || 'SEVERED', '#ffd76a', 24, 1.6);
    // Each destroyed part grants the player a buff AND enrages the boss —
    // exactly the Sealed Beast's tail-destruction loop.
    if (d.playerBuff) run.player.addBuff('part_' + i, 99999, d.playerBuff);
    if (d.enragePerPart) e.speed *= 1 + d.enragePerPart;
    // Removing a part removes one of its attacks, one by one.
    if (d.removesAttack && this.phase) {
      const idx = this.phase.attacks.indexOf(d.removesAttack[i % d.removesAttack.length]);
      if (idx >= 0) this.phase.attacks.splice(idx, 1);
    }
  }

  onDeath() {
    const run = this.run;
    const e = this.active;
    if (!e) return;
    // Slow-mo death (SECTION 9).
    run.setSlowmo(feel.bossDeathScale, feel.bossDeathSlowmo);
    flash.fire('#ffffff', 0.5, 2.2);
    shake.big();
    this._cancelAttack();
    this.active = null;
    this.def = null;
    this.staggerT = 0;
    this.parts = null;
  }

  drawUnder(r, alpha) {
    // Multi-part limbs draw beneath the body so the body reads as the target.
    const e = this.active;
    if (!e || !this.parts) return;
    const d = this.def.parts;
    for (let i = 0; i < this.parts.length; i++) {
      if (this.parts[i] <= 0) continue;
      const a = this.partAngles[i];
      const len = d.length || 180;
      const x = e.x + Math.cos(a) * (e.radius + len * 0.5);
      const y = e.y + Math.sin(a) * (e.radius + len * 0.5);
      r.drawBeam(e.x, e.y, x, y, d.width || 26, d.color || '#7a3d5c', 0.9);
      const hpF = this.parts[i] / (d.hp * this.run.difficultyMult.hp);
      r.drawCircle(x, y, (d.width || 26) * 0.6, hpF > 0.5 ? '#ff9ab8' : '#ff3a5e', 1);
    }
    r.setAlpha(1);
  }

  drawOver(r, alpha) {
    const e = this.active;
    if (!e) return;
    // The break: a fat gold ring around the body for as long as it is open, so
    // "hit it NOW" is legible from the health bar's worth of screen away.
    if (this.staggerT > 0 && this.staggerTotal > 0) {
      const k = this.staggerT / this.staggerTotal;
      r.strokeCircle(e.x, e.y, e.radius * (1.15 + (1 - k) * 0.5), '#ffd76a', 5, 0.35 + k * 0.5);
    }
    // Weak point marker, when a phase exposes one.
    const ph = this.phase;
    if (ph && ph.weakPoint) {
      const a = e.facing + Math.PI;   // the nape is behind
      const x = e.x + Math.cos(a) * e.radius * 0.8;
      const y = e.y + Math.sin(a) * e.radius * 0.8;
      const pulse = 0.6 + 0.4 * Math.sin(this.run.time * 6);
      r.strokeCircle(x, y, 18, '#4fc3ff', 3, pulse);
      r.drawCircle(x, y, 8, '#4fc3ff', pulse * 0.7);
    }
  }
}

const SCRATCH = { i: 0, x: 0, y: 0, a: 0, n: 0, u: 0, v: 0, w: 0 };
const EMPTY = {};

/**
 * The effect colour for each telegraph colour. NOT a duplicate of
 * TELEGRAPH_COLORS: those are the hazard system's exact accessibility hues and
 * live in the data file, and importing data into the controller to tint a spark
 * would make render/prewarm.js's import graph circular.
 */
const TELEGRAPH_FX = {
  red: '#ff3a5e', yellow: '#ffd23f', blue: '#4fc3ff', white: '#ffffff',
};

// --- allocation-free scratch bags ---------------------------------------------
// Everything below is a MODULE-LEVEL CONSTANT that a call site fills in
// immediately before use. Each consumer copies what it needs synchronously —
// effects.js in `_begin`, ProjectileSystem in `fire`, damage.js in its opts
// read — so one shared bag per shape is safe and the whole file allocates
// nothing after boot.

const FX = {
  tier: 0, life: 0, alpha: 1, sweep: 1, color2: null,
  width: 0, from: 0, spokes: 0, size: 0, angle: 0, double: false,
};
function fx() {
  FX.tier = 0; FX.life = 0; FX.alpha = 1; FX.sweep = 1; FX.color2 = null;
  FX.width = 0; FX.from = 0; FX.spokes = 0; FX.size = 0; FX.angle = 0;
  FX.double = false;
  return FX;
}

/** The projectile options bag. `ProjectileSystem.fire` copies it field by field. */
const PROJ = {
  speed: 0, damage: 0, life: 0, radius: 0, owner: null, visual: null,
  motion: 0, target: null, turnRate: 0,
};
function proj(def, owner) {
  PROJ.speed = 0; PROJ.damage = def.damage || 0; PROJ.life = 0; PROJ.radius = 0;
  PROJ.owner = owner; PROJ.visual = attackVisual(def);
  PROJ.motion = MOTION.STRAIGHT; PROJ.target = null; PROJ.turnRate = 0;
  return PROJ;
}

const HIT = { fromX: 0, fromY: 0 };
const HIT_TRUE = { ignoreIframes: true, fromX: 0, fromY: 0 };
const HIT_CRUSH = { ignoreIframes: true, undodgeable: true };

/** `damagePlayer` with the hit direction filled in — the knockback flinch reads it. */
function hitPlayer(run, amount, x, y) {
  HIT.fromX = x; HIT.fromY = y;
  return damagePlayer(run, amount, SRC.BOSS, HIT);
}
function burnPlayer(run, amount, x, y) {
  HIT_TRUE.fromX = x; HIT_TRUE.fromY = y;
  return damagePlayer(run, amount, SRC.BOSS, HIT_TRUE);
}

/**
 * A ring of deferred-callback contexts.
 *
 * `Scheduler.after(delay, fn, a, b)` takes two payloads and holds them until the
 * timer expires, so the payload cannot be one shared object — two shockwave
 * rings 0.35s apart would both read the second one's radius. A short ring of
 * pre-made records gives every in-flight callback its own storage without ever
 * allocating: 32 is comfortably more than the most any single cast schedules
 * (six sealing pillars, five steam vents, four arms, three slam waves).
 */
const CTX = [];
for (let i = 0; i < 32; i++) {
  CTX.push({ run: null, e: null, def: null, x: 0, y: 0, r: 0, dmg: 0, a: 0, n: 0, color: null });
}
let ctxHead = 0;
function ctxFor(run, x, y, r, dmg) {
  const c = CTX[ctxHead];
  ctxHead = (ctxHead + 1) % CTX.length;
  c.run = run; c.e = null; c.def = null;
  c.x = x; c.y = y; c.r = r; c.dmg = dmg; c.a = 0; c.n = 0; c.color = null;
  return c;
}

// --- boss projectile visuals --------------------------------------------------
//
// Three attack kinds fire a projectile, and each used to build its descriptor as
// an OBJECT LITERAL INSIDE fire() — so a 24-projectile ring allocated 24 of them
// per cast, and, far worse, the atlas had never seen the resulting key. The boot
// pre-raster harvests `data.allVisuals()`, and a descriptor that exists only
// inside a function body is invisible to it: the first time a boss opened with
// one of these the atlas baked 32 rotation steps and a white flash twin
// MID-FIGHT. tests/renderSmoke.js exists to catch precisely that and never did,
// because it drives ten seconds of a run and a boss lands at the halfway mark.
//
// So the descriptor is built once per ATTACK DEFINITION and cached on it. The
// same builder runs at boot across every boss's whole attack table (see
// bossProjectileVisuals, which render/prewarm.js calls), so the runtime lookup
// does not merely produce an EQUAL descriptor — it produces the SAME OBJECT the
// pre-raster already registered, and the two keys cannot drift apart later.
//
// The only field an attack may add to change its look is `color`. In particular
// a radialBurst must NEVER be given `params.radius`: this builder reads it as
// the SPRITE size, and the 260px telegraph circle an author would mean by it
// would bake a 260px projectile sprite at boot.

const ATTACK_VISUAL = {
  radialBurst: (d) => ({
    shape: 'diamond', color: d.color || '#ff6f91', accent: '#3a0a18',
    size: (d.params && d.params.radius) || 9, rotates: true, glow: true,
  }),
  homingProjectile: (d) => ({
    shape: 'square', color: d.color || '#ff2d95', accent: '#2a0a1e',
    size: 11, rotates: true,
  }),
  projectileSpread: (d) => ({
    shape: 'shard', color: d.color || '#c58cff', accent: '#2a1040',
    size: 8, rotates: true,
  }),
};

/** The cached descriptor for one attack definition, built on first ask. */
function attackVisual(def) {
  let v = def._visual;
  if (v === undefined) {
    const make = ATTACK_VISUAL[def.kind];
    v = def._visual = make ? make(def) : null;
  }
  return v;
}

/**
 * Every projectile descriptor the boss table can produce, for the boot pass.
 *
 * Walks each boss's ENTIRE attack table rather than only the attacks its opening
 * phase lists — a phase-three attack is the one whose hitch hurts most, and it
 * is also the one a short smoke test will never reach.
 */
export function bossProjectileVisuals(bossList) {
  const out = [];
  for (const b of bossList || []) {
    const table = b.attacks;
    if (!table) continue;
    for (const key in table) {
      const v = attackVisual(table[key]);
      if (v) out.push(v);
    }
  }
  return out;
}

// --- attack kinds -------------------------------------------------------------
// Each is { telegraph?, windup?, fire?, active?, end?, moves?, roots? }.
// Everything lethal telegraphs. Nothing allocates.
//
// A BOSS ATTACK DAMAGES THE PLAYER AND NOTHING ELSE.
// Every kind below used to run its geometry through `areaDamage` / `coneDamage`
// / `lineDamage` as well as through the direct player check — and those three
// walk `run.enemies`, which is the pool the boss itself lives in. Player minions
// are a SEPARATE pool and were never in range of it, so the only things that
// friendly fire ever hit were the boss and the adds it had just summoned.
//
// It stayed invisible while every channel resolved in a single tick. Giving the
// finales real `duration`s made it obvious: KAGUTSUCHI, driven at the 380 DPS
// its 45,600-HP bar is authored against, died in 91 seconds instead of 111,
// because it stands in its own ember rain and its own four-whip wheel and was
// taking a fifth of its own health bar off. The hazard FIELDS this file spawns
// already pass `hitsEnemies: false` — the same decision, written down in a
// different place — so the geometry calls are simply gone.

const ATTACKS = {
  /**
   * Columns or rows that sweep across the arena.
   *
   * `duration` is what makes this an attack rather than a still frame: with none
   * authored the sweep lands on the very first row and the row it stops on is
   * the top edge of the arena, which no player has ever been standing on.
   *
   * The per-lane jitter is stored rather than re-rolled. It used to be applied
   * in the telegraph and dropped in the damage pass, so every column hit up to
   * 60px away from the line it had drawn — a telegraph that lies is worse than
   * no telegraph, and this one lied by half its own width.
   */
  lineSweep: {
    roots: true,
    telegraph(bc, c) {
      const run = bc.run, P = c.def.params;
      const vertical = P.axis === 'vertical';
      const n = Math.min(P.columns || 3, LANES.length);
      const spanA = vertical ? run.bounds.minX : run.bounds.minY;
      const spanB = vertical ? run.bounds.maxX : run.bounds.maxY;
      for (let i = 0; i < n; i++) {
        const pos = lerp(spanA, spanB, (i + 0.5) / n) + runRng.signed() * 60;
        LANES[i] = pos;
        if (vertical) run.hazards.telegraphLine(pos, run.bounds.minY, pos, run.bounds.maxY, P.width || 100, c.tel, c.def.telegraphColor || 'red', 'x');
        else run.hazards.telegraphLine(run.bounds.minX, pos, run.bounds.maxX, pos, P.width || 100, c.tel, c.def.telegraphColor || 'red', 'x');
      }
      SCRATCH.n = n;
      SCRATCH.a = vertical ? 1 : 0;
      SCRATCH.i = 0;
    },
    fire(bc, c) {
      audio.play('special');
      shake.medium();
      const e = bc.active;
      const f = fx();
      f.life = 0.34; f.spokes = 16; f.width = 5;
      effects.burstRing(e.x, e.y, e.radius * 2.2, '#ff3a5e', f);
    },
    active(bc, c, dt) {
      const run = bc.run, P = c.def.params;
      const vertical = SCRATCH.a === 1;
      const n = SCRATCH.n;
      const half = (P.width || 100) * 0.5;
      const t = clamp(c.t / (c.def.duration || 1.4), 0, 1);
      const sweep = vertical
        ? lerp(run.bounds.minY, run.bounds.maxY, t)
        : lerp(run.bounds.minX, run.bounds.maxX, t);
      // The leading edge draws as a real bar eight times a second, so the player
      // can see which way the wall is going and how far it has come.
      c.fx -= dt;
      const draw = c.fx <= 0;
      if (draw) c.fx = 0.12;
      for (let i = 0; i < n; i++) {
        const pos = LANES[i];
        const x = vertical ? pos : sweep;
        const y = vertical ? sweep : pos;
        const p = run.player;
        if (dist2(x, y, p.x, p.y) < half * half) hitPlayer(run, c.def.damage, x, y);
        if (draw) {
          const f = fx();
          f.life = 0.22; f.alpha = 0.8;
          effects.beam(x - (vertical ? half : 0), y - (vertical ? 0 : half),
                       x + (vertical ? half : 0), y + (vertical ? 0 : half),
                       half * 0.5, '#ff3a5e', f);
        }
        particles.burst(x, y, 1, '#ff3a5e', P_SPARK);
      }
    },
  },

  /**
   * A ring of projectiles outward from the boss.
   *
   * `rings`, `ringDelay`, `gapArc` and `projectiles` are all authored in the data
   * and none of them used to be read. Three rings of fourteen WITH a gap each is
   * both a bigger spectacle and a fairer attack than one gapless ring of sixteen,
   * which is why implementing the data as written made the fight easier to
   * survive and much harder to ignore.
   */
  radialBurst: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active;
      run.hazards.telegraph(e.x, e.y, 260, c.tel, c.def.telegraphColor || 'yellow', 'arrow');
    },
    fire(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      const rings = P.rings || 1;
      SCRATCH.a = P.aimed ? angleTo(e.x, e.y, run.player.x, run.player.y) : runRng.angle();
      burstRingShot(run, e, c.def, SCRATCH.a, 0);
      for (let i = 1; i < rings; i++) {
        const ctx = ctxFor(run, 0, 0, 0, 0);
        ctx.e = e; ctx.def = c.def; ctx.a = SCRATCH.a; ctx.n = i;
        run.scheduler.after(i * (P.ringDelay || 0.6), delayedRing, ctx);
      }
      audio.play('explode');
      shake.small();
    },
  },

  homingProjectile: {
    telegraph(bc, c) {
      const e = bc.active;
      bc.run.hazards.telegraph(e.x, e.y, 90, c.tel, c.def.telegraphColor || 'yellow', 'arrow');
    },
    fire(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      const n = P.count || 4;
      const base = angleTo(e.x, e.y, run.player.x, run.player.y);
      const spread = P.spread || 1.2;
      const o = proj(c.def, e);
      o.motion = MOTION.HOMING; o.target = run.player;
      o.speed = P.speed || 190; o.turnRate = P.turnRate || 1.6;
      o.life = P.life || 6; o.radius = 11;
      for (let i = 0; i < n; i++) {
        run.enemyProjectiles.fire(e.x, e.y, base + (i / Math.max(1, n - 1) - 0.5) * spread, o);
      }
      // They peel off the body: one arc across the fan, one pop where they left.
      const f = fx();
      f.life = 0.28; f.width = 10;
      effects.slash(e.x, e.y, base, spread, e.radius * 1.5, '#ff2d95', f);
      const g = fx();
      g.size = e.radius * 0.5; g.life = 0.2;
      effects.impact(e.x, e.y, '#ff2d95', g);
      audio.play('shoot');
    },
  },

  groundSlam: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      SCRATCH.x = P.atPlayer ? run.player.x : e.x;
      SCRATCH.y = P.atPlayer ? run.player.y : e.y;
      run.hazards.telegraph(SCRATCH.x, SCRATCH.y, P.radius || 200, c.tel,
                            c.def.telegraphColor || 'red', 'x');
    },
    fire(bc, c) {
      const run = bc.run, P = c.def.params;
      const rad = P.radius || 200;
      const p = run.player;
      if (dist2(SCRATCH.x, SCRATCH.y, p.x, p.y) < rad * rad) {
        hitPlayer(run, c.def.damage, SCRATCH.x, SCRATCH.y);
      }
      // THE IMPACT: a hard flash at the palm, a ring at the exact damage radius
      // so the blast shows what it hit, and spokes thrown outward.
      const f = fx();
      f.size = rad * 0.34; f.life = 0.24;
      effects.impact(SCRATCH.x, SCRATCH.y, '#ff9a3d', f);
      const g = fx();
      g.life = 0.46; g.from = rad * 0.2; g.width = Math.max(5, rad * 0.09); g.spokes = 14;
      effects.shockwave(SCRATCH.x, SCRATCH.y, rad, '#ff9a3d', g);
      particles.ring(SCRATCH.x, SCRATCH.y, 26, '#ff9a3d', rad * 3.2);
      shake.big();
      audio.play('explode');
      // Expanding shockwave rings, if declared. `shockwaves` is the data's word
      // for them; `rings` was the only one this ever read, and no boss uses it.
      const waves = P.shockwaves || P.rings || 0;
      for (let i = 1; i <= waves; i++) {
        const ctx = ctxFor(run, SCRATCH.x, SCRATCH.y, rad * (1 + i * 0.5), c.def.damage * 0.7);
        run.scheduler.after(i * 0.35, shockRing, ctx);
      }
    },
  },

  /**
   * A charge, or three. `dashes` and `turnBetween` are authored on half the
   * charge attacks in the file and neither was read, so a boss that advertised
   * "three dashes at 1,150px/s, re-aiming between each" did one and stopped.
   * Every re-aim repaints the line first — the contract is per DASH, not per
   * cast, and a second lunge with no warning is exactly the unfair the telegraph
   * rules exist to forbid.
   */
  chargeDash: {
    moves: true,
    telegraph(bc, c) {
      dashAim(bc, c, c.tel);
      SCRATCH.i = 0; SCRATCH.u = 0; SCRATCH.v = 0;
    },
    fire(bc, c) { audio.play('special'); shake.medium(); },
    active(bc, c, dt) {
      const run = bc.run, e = bc.active, P = c.def.params;
      // Between two dashes: the line is already repainted and the boss is
      // holding still on it.
      if (SCRATCH.v > 0) { SCRATCH.v -= dt; return; }
      const sp = P.speed || 900;
      const px = e.x, py = e.y;
      e.x += Math.cos(SCRATCH.a) * sp * dt;
      e.y += Math.sin(SCRATCH.a) * sp * dt;
      SCRATCH.u += sp * dt;
      const p = run.player;
      if (dist2(e.x, e.y, p.x, p.y) < ((P.width || 90) * 0.5 + 12) ** 2) {
        hitPlayer(run, c.def.damage, e.x, e.y);
      }
      // The trail is real afterimages now, not a dust line: a body that moves
      // 1,150px/s has to leave copies of itself or it reads as a teleport.
      c.fx -= dt;
      if (c.fx <= 0) {
        c.fx = 0.045;
        const f = fx();
        f.life = 0.26; f.alpha = 0.7;
        effects.afterimage(px, py, SCRATCH.a, e.radius * 0.6, '#ff3a5e', f);
      }
      particles.trail(e.x, e.y, -Math.cos(SCRATCH.a) * sp, -Math.sin(SCRATCH.a) * sp, '#ff3a5e', 0.9, 0.3);
      e.x = clamp(e.x, run.bounds.minX, run.bounds.maxX);
      e.y = clamp(e.y, run.bounds.minY, run.bounds.maxY);

      if (SCRATCH.u >= (P.distance || 700)) {
        SCRATCH.i++;
        const f = fx();
        f.life = 0.34; f.from = 8; f.width = 6;
        effects.shockwave(e.x, e.y, e.radius * 2.0, '#ff3a5e', f);
        if (SCRATCH.i < (P.dashes || 1)) {
          SCRATCH.u = 0;
          SCRATCH.v = P.turnBetween === false ? 0.18 : 0.42;
          dashAim(bc, c, SCRATCH.v);
        } else {
          c.t = (c.def.duration || 0) + 1;    // done early; let end() run
        }
      }
    },
    end(bc, c) {
      const e = bc.active;
      applyStun(e.st, (c.def.params && c.def.params.recover) || 0.9);
      const f = fx();
      f.size = e.radius * 0.7; f.life = 0.26;
      effects.impact(e.x, e.y, '#ff3a5e', f);
    },
  },

  /**
   * Adds. THIS NEVER WORKED: it read `P.enemy`, and every boss in the data file
   * authors `spawns: [{ enemy, count }]` because they all bring two kinds at
   * once. Thirteen summon attacks across seven bosses and seven mid-bosses, all
   * silently spawning nothing, for the whole life of the project.
   *
   * Entries that name a `boss` rather than an `enemy` are skipped: The Opening
   * Act's curtain call walks three mid-bosses on, and that is the multiSpawn
   * mechanic's job, not this one's.
   */
  summonAdds: {
    telegraph(bc, c) {
      const e = bc.active;
      SCRATCH.a = runRng.angle();
      bc.run.hazards.telegraph(e.x, e.y, 140, c.tel, 'yellow', 'circle');
    },
    fire(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      const list = P.spawns;
      const rad = P.radius || 260;
      let placed = 0;
      if (list) {
        for (let s = 0; s < list.length; s++) {
          const row = list[s];
          if (!row || !row.enemy) continue;
          const def = run.data.enemies.ENEMIES_BY_ID[row.enemy];
          if (!def) continue;
          const n = row.count || 1;
          for (let i = 0; i < n; i++) {
            // 'cluster' drops them in a blob to one side; 'ring' is the default
            // and rings the boss, which is what every desc in the data says.
            const a = P.pattern === 'cluster'
              ? SCRATCH.a + runRng.signed() * 0.5
              : (placed / Math.max(1, totalSpawns(list))) * TAU;
            const d = P.pattern === 'cluster' ? rad * (0.4 + fxRng.raw() * 0.3) : rad;
            const x = clamp(e.x + Math.cos(a) * d, run.bounds.minX + 40, run.bounds.maxX - 40);
            const y = clamp(e.y + Math.sin(a) * d, run.bounds.minY + 40, run.bounds.maxY - 40);
            if (run.enemies.spawn(def, x, y)) {
              const f = fx();
              f.life = 0.3; f.from = 2; f.width = 3;
              effects.shockwave(x, y, 34, '#c58cff', f);
            }
            placed++;
          }
        }
      }
      const g = fx();
      g.life = 0.5; g.from = rad; g.width = 6; g.spokes = 18;
      effects.shockwave(e.x, e.y, e.radius * 0.9, '#c58cff', g);
      particles.ring(e.x, e.y, 16, '#c58cff', 320);
      audio.play('telegraph');
    },
  },

  aoeCircle: {
    telegraph(bc, c) {
      const run = bc.run, P = c.def.params;
      const n = P.count || 3;
      const rad = P.radius || 130;
      for (let i = 0; i < n; i++) {
        const a = runRng.angle(), d = runRng.range(80, P.spread || 340);
        const x = run.player.x + Math.cos(a) * d;
        const y = run.player.y + Math.sin(a) * d;
        run.hazards.telegraph(x, y, rad, c.tel, c.def.telegraphColor || 'red', 'x');
        run.scheduler.after(c.tel, popCircle, ctxFor(run, x, y, rad, c.def.damage));
      }
    },
    fire() {},
  },

  coneBreath: {
    roots: true,
    telegraph(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      SCRATCH.a = angleTo(e.x, e.y, run.player.x, run.player.y);
      run.hazards.telegraphCone(e.x, e.y, SCRATCH.a, P.arc || P.angle || 1.0, P.range || 300,
                                c.tel, c.def.telegraphColor || 'red', 'arrow');
    },
    fire(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      audio.play('special');
      // The mouth opens: one wide slash across the whole cone, then the stream.
      const f = fx();
      f.life = 0.3; f.width = 18;
      effects.slash(e.x, e.y, SCRATCH.a, P.arc || P.angle || 1.0, (P.range || 300) * 0.55,
                    c.def.color || '#ff7a3d', f);
    },
    active(bc, c, dt) {
      const run = bc.run, e = bc.active, P = c.def.params;
      const arc = P.arc || P.angle || 1.0;
      const range = P.range || 300;
      // The cone tracks slowly, so backing out of it is a real option.
      SCRATCH.a = rotateToward(SCRATCH.a, angleTo(e.x, e.y, run.player.x, run.player.y), (P.trackRate || 0.7) * dt);
      const p = run.player;
      let d = angleTo(e.x, e.y, p.x, p.y) - SCRATCH.a;
      while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      if (Math.abs(d) < arc * 0.5 && dist2(e.x, e.y, p.x, p.y) < range * range) {
        burnPlayer(run, c.def.damage * dt, e.x, e.y);
        if (P.burn) applyBurn(p.st, P.burn, 2);
      }
      run.wedgeOverlay(e.x, e.y, range, SCRATCH.a - arc / 2, SCRATCH.a + arc / 2,
                       c.def.color || '#ff7a3d');
      // A beam down the middle every eighth of a second gives the stream a spine
      // to read; the particles alone are a fog with no direction in them.
      c.fx -= dt;
      if (c.fx <= 0) {
        c.fx = 0.11;
        const f = fx();
        f.life = 0.2; f.alpha = 0.7;
        effects.beam(e.x, e.y, e.x + Math.cos(SCRATCH.a) * range, e.y + Math.sin(SCRATCH.a) * range,
                     range * 0.06, c.def.color || '#ff7a3d', f);
      }
      for (let i = 0; i < 3; i++) {
        const a2 = SCRATCH.a + (fxRng.raw() - 0.5) * arc;
        const dd = fxRng.raw() * range;
        P_BREATH.color = c.def.color || '#ff7a3d';
        particles.emit(e.x + Math.cos(a2) * dd, e.y + Math.sin(a2) * dd,
                       Math.cos(a2) * 120, Math.sin(a2) * 120, P_BREATH);
      }
    },
    end(bc, c) {
      const e = bc.active, P = c.def.params;
      const f = fx();
      f.life = 0.34; f.spokes = 10; f.width = 4; f.angle = SCRATCH.a;
      effects.burstRing(e.x, e.y, (P.range || 300) * 0.4, c.def.color || '#ff7a3d', f);
    },
  },

  /**
   * A channelled beam. It TRACKS at `turnRate` rather than spinning blindly at a
   * fixed rate — which is what every one of these attacks says it does in its own
   * description ("a 1,600px beam that tracks at 20 deg/s"), and it is a much
   * better attack: outrunning a tracking beam sideways is a skill, standing
   * outside the sweep of a metronome is a wait.
   */
  beamContinuous: {
    roots: true,
    telegraph(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      SCRATCH.a = angleTo(e.x, e.y, run.player.x, run.player.y);
      const len = P.length || P.range || 1200;
      run.hazards.telegraphLine(e.x, e.y, e.x + Math.cos(SCRATCH.a) * len, e.y + Math.sin(SCRATCH.a) * len,
                                P.width || 120, c.tel, 'white', 'bang');
    },
    fire(bc, c) {
      const e = bc.active, P = c.def.params;
      audio.play('special'); shake.medium(); flash.fire('#ffffff', 0.3, 4);
      const f = fx();
      f.size = (P.width || 120) * 0.5; f.life = 0.26;
      effects.impact(e.x, e.y, c.def.color || '#ffe86a', f);
    },
    active(bc, c, dt) {
      const run = bc.run, e = bc.active, P = c.def.params;
      const len = P.length || P.range || 1200;
      const w = P.width || 120;
      const turn = P.turnRate === undefined ? (P.rotate || 0) : P.turnRate;
      SCRATCH.a = rotateToward(SCRATCH.a, angleTo(e.x, e.y, run.player.x, run.player.y), turn * dt);
      const x1 = e.x + Math.cos(SCRATCH.a) * len, y1 = e.y + Math.sin(SCRATCH.a) * len;
      const p = run.player;
      const ex = p.x - e.x, ey = p.y - e.y;
      const perp = Math.abs(ex * Math.sin(SCRATCH.a) - ey * Math.cos(SCRATCH.a));
      const projd = ex * Math.cos(SCRATCH.a) + ey * Math.sin(SCRATCH.a);
      if (perp < w * 0.5 && projd > 0 && projd < len) {
        burnPlayer(run, c.def.damage * dt, e.x, e.y);
      }
      run.beamOverlay(e.x, e.y, x1, y1, w, c.def.color || '#ffe86a');
      // The overlay is a flat bar. The effect is what gives it a hot core, a
      // ripple and a burning muzzle — throttled, because one per frame at 144Hz
      // would flush the whole 160-slot effect pool twice a second.
      c.fx -= dt;
      if (c.fx <= 0) {
        c.fx = 0.09;
        const f = fx();
        f.life = 0.16;
        effects.beam(e.x, e.y, x1, y1, w * 0.5, c.def.color || '#ffe86a', f);
        const g = fx();
        g.size = w * 0.4; g.life = 0.16; g.alpha = 0.8;
        effects.impact(e.x + Math.cos(SCRATCH.a) * e.radius, e.y + Math.sin(SCRATCH.a) * e.radius,
                       '#ffffff', g);
      }
    },
    end(bc, c) {
      const e = bc.active, P = c.def.params;
      const f = fx();
      f.life = 0.4; f.from = 4; f.width = 7;
      effects.shockwave(e.x, e.y, (P.width || 120) * 1.4, c.def.color || '#ffe86a', f);
    },
  },

  /** "DETENTION" — a shrinking ring of red tape you must stay inside. */
  shrinkingRing: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      SCRATCH.x = e.x; SCRATCH.y = e.y;
      SCRATCH.u = P.startRadius || P.radius || 520;
      SCRATCH.v = P.endRadius || SCRATCH.u * 0.25;
      run.hazards.telegraphRing(e.x, e.y, SCRATCH.u, c.def.duration || 8, 'blue');
    },
    fire(bc, c) {
      audio.play('telegraph');
      const f = fx();
      f.life = 0.5; f.from = SCRATCH.u * 1.1; f.width = 9;
      effects.shockwave(SCRATCH.x, SCRATCH.y, SCRATCH.u, '#4fc3ff', f);
    },
    active(bc, c, dt) {
      const run = bc.run, P = c.def.params;
      const t = clamp(c.t / (c.def.duration || 8), 0, 1);
      const rad = lerp(SCRATCH.u, SCRATCH.v, t);
      const p = run.player;
      if (dist2(SCRATCH.x, SCRATCH.y, p.x, p.y) > rad * rad) {
        burnPlayer(run, c.def.damage * dt, SCRATCH.x, SCRATCH.y);
        if (P.pullForce) applyPull(p.st, 0.2, SCRATCH.x, SCRATCH.y, P.pullForce);
      }
      run.ringOverlay(SCRATCH.x, SCRATCH.y, rad, '#ff3a5e');
      // One pulse per second down the wall, so a ring that closes over six
      // seconds still looks like it is being driven inward rather than resized.
      c.fx -= dt;
      if (c.fx <= 0) {
        c.fx = 0.9;
        const f = fx();
        f.life = 0.7; f.from = rad * 1.16; f.width = 6; f.spokes = 20;
        effects.shockwave(SCRATCH.x, SCRATCH.y, rad, '#ff3a5e', f);
      }
    },
  },

  /**
   * Arms sweeping around a pivot. `arms`, `angularSpeed`, `length` and `reverses`
   * are all authored and none was read: every rotating sweep in the game was one
   * 0.7-radian wedge at a fixed 2.2 rad/s, whatever its data said.
   */
  rotatingSweep: {
    roots: true,
    telegraph(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      SCRATCH.a = runRng.angle();
      SCRATCH.n = P.arms || 1;
      SCRATCH.u = P.length || P.range || 420;
      // The arc is derived from the arm's own width at its own reach, so a 70px
      // clipboard beam 520px long is a thin blade and not a quarter of the arena.
      SCRATCH.v = P.arc || clamp((P.width || 70) / SCRATCH.u * 2.2, 0.18, 1.2);
      for (let k = 0; k < SCRATCH.n; k++) {
        run.hazards.telegraphCone(e.x, e.y, SCRATCH.a + (k / SCRATCH.n) * TAU, SCRATCH.v,
                                  SCRATCH.u, c.tel, c.def.telegraphColor || 'red', 'arrow');
      }
    },
    fire(bc, c) { audio.play('slash'); shake.small(); },
    active(bc, c, dt) {
      const run = bc.run, e = bc.active, P = c.def.params;
      const dur = c.def.duration || 0;
      let spin = P.angularSpeed || P.rotateSpeed || 2.2;
      // "and halfway through they reverse" — Kagutsuchi's Severing Wheel.
      if (P.reverses && dur > 0 && c.t > dur * 0.5) spin = -spin;
      SCRATCH.a += spin * dt;
      const arc = SCRATCH.v, range = SCRATCH.u, arms = SCRATCH.n;
      const p = run.player;
      c.fx -= dt;
      const draw = c.fx <= 0;
      if (draw) c.fx = 0.13;
      for (let k = 0; k < arms; k++) {
        const a = SCRATCH.a + (k / arms) * TAU;
        let d = angleTo(e.x, e.y, p.x, p.y) - a;
        while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
        if (Math.abs(d) < arc * 0.5 && dist2(e.x, e.y, p.x, p.y) < range * range) {
          hitPlayer(run, c.def.damage, e.x, e.y);
        }
        run.wedgeOverlay(e.x, e.y, range, a - arc / 2, a + arc / 2, '#ff3a5e');
        if (draw) {
          const f = fx();
          f.life = 0.24; f.width = Math.max(4, (P.width || 70) * 0.4);
          f.sweep = spin < 0 ? -1 : 1;
          effects.slash(e.x, e.y, a, arc * 1.6, range, '#ff3a5e', f);
        }
      }
    },
  },

  /**
   * The Colossus grab. DECISIONS.md §17: the mash accepts ANY ability key, ANY
   * gamepad face button, or a screen tap. Never keyboard-only.
   */
  grabQte: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active;
      run.hazards.telegraph(run.player.x, run.player.y, 120, c.tel, 'white', 'bang');
      // The reach is drawn as a closing ring on the PLAYER, because the thing
      // you have to read is "am I inside it", not "where is the hand".
      const f = fx();
      f.life = c.tel * 0.9; f.from = (c.def.params.reach || 340); f.width = 7;
      effects.shockwave(e.x, e.y, e.radius * 1.2, '#ffffff', f);
    },
    fire(bc, c) {
      const run = bc.run, P = c.def.params;
      const p = run.player;
      const e = bc.active;
      const reach = P.reach || P.grabRange || 340;
      if (dist2(e.x, e.y, p.x, p.y) < reach * reach && p.st.invulnT <= 0) {
        bc.qte = { need: P.mashCount || 8, got: 0, t: P.window || 2.5, damage: c.def.damage };
        run.startQte(bc.qte);
        p.flags.rooted = true;
        const f = fx();
        f.size = 40; f.life = 0.3;
        effects.impact(p.x, p.y, '#ffffff', f);
        shake.big();
      }
    },
    active(bc, c, dt) {
      const run = bc.run;
      if (!bc.qte) return;
      bc.qte.t -= dt;
      if (run.mashPressed()) {
        bc.qte.got++;
        const f = fx();
        f.life = 0.22; f.from = 46; f.width = 4;
        effects.shockwave(run.player.x, run.player.y, 14, '#7bf59a', f);
      }
      if (bc.qte.got >= bc.qte.need) {
        run.player.flags.rooted = false;
        run.endQte(true);
        bc.qte = null;
        const f = fx();
        f.life = 0.4; f.spokes = 16; f.width = 5;
        effects.burstRing(run.player.x, run.player.y, 90, '#7bf59a', f);
        c.t = (c.def.duration || 0) + 1;
      } else if (bc.qte.t <= 0) {
        damagePlayer(run, bc.qte.damage, SRC.BOSS, HIT_CRUSH);
        run.player.flags.rooted = false;
        run.endQte(false);
        bc.qte = null;
        const f = fx();
        f.size = 54; f.life = 0.3;
        effects.impact(run.player.x, run.player.y, '#ff3a5e', f);
        shake.big();
      }
    },
    end(bc) { if (bc.run.player) bc.run.player.flags.rooted = false; bc.run.endQte(false); bc.qte = null; },
  },

  /**
   * A fan of shards. `arc` is the data's word for the fan width and the impl only
   * ever read `spread`, so every fan in the game — eleven-shot, thirteen-shot,
   * fourteen-shot — went out at the same default 1.0 radians. `waves` and
   * `rotatePerWave` were not read either, and they are the whole idea of the
   * Crimson Fan: the safe lane has to MOVE between waves or there is no attack.
   */
  projectileSpread: {
    telegraph(bc, c) {
      const e = bc.active, P = c.def.params;
      SCRATCH.a = angleTo(e.x, e.y, bc.run.player.x, bc.run.player.y);
      SCRATCH.n = 0;
      bc.run.hazards.telegraphCone(e.x, e.y, SCRATCH.a, P.arc || P.spread || 1.0, 400,
                                   c.tel, c.def.telegraphColor || 'yellow', 'arrow');
    },
    fire(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      spreadWave(run, e, c.def, SCRATCH.a);
      const waves = P.waves || 1;
      for (let i = 1; i < waves; i++) {
        const ctx = ctxFor(run, 0, 0, 0, 0);
        ctx.e = e; ctx.def = c.def; ctx.a = SCRATCH.a + i * (P.rotatePerWave || 0);
        run.scheduler.after(i * (P.waveDelay || 0.45), delayedSpread, ctx);
      }
      audio.play('shoot');
    },
  },

  /**
   * THE FINAL FORM's payoff: a mirror of the player's own character, using their
   * auto-attack at 120% power. Generic — it reads the player's ability id, never
   * a switch on which character it is.
   */
  mirrorPlayer: {
    telegraph(bc, c) {
      const e = bc.active;
      bc.run.hazards.telegraph(e.x, e.y, 160, c.tel, 'white', 'bang');
      floaters.spawn(e.x, e.y - e.radius - 20, 'YOUR OWN MOVE', '#ffffff', 24, 1.6);
    },
    fire(bc, c) {
      const run = bc.run, e = bc.active;
      run.fireMirroredPlayerAbility(e, (c.def.params && c.def.params.powerMult) || 1.2);
      audio.play('special');
      shake.medium();
      // It puts YOUR silhouette on, so the copy reads as a copy.
      const f = fx();
      f.life = 0.42; f.alpha = 0.9;
      effects.afterimage(e.x, e.y, e.facing, e.radius * 0.7, run.player.visual.color, f);
      const g = fx();
      g.life = 0.38; g.spokes = 14; g.width = 4;
      effects.burstRing(e.x, e.y, e.radius * 2.0, '#ffffff', g);
    },
  },

  /**
   * Arms coming down around the player. It used to size itself off `bc.parts`,
   * which is a zero-length array on every boss in the game, so `Math.min` pinned
   * the count at zero and the Kraken's signature opener did nothing at all.
   * Live parts still cap it when the parts system has any — losing an arm should
   * cost the boss an arm's worth of slam.
   */
  tentacleSlam: {
    telegraph(bc, c) {
      const run = bc.run, P = c.def.params;
      let n = P.arms || P.count || 3;
      if (bc.parts && bc.parts.length) {
        let alive = 0;
        for (let i = 0; i < bc.parts.length; i++) if (bc.parts[i] > 0) alive++;
        n = Math.min(alive, n);
      }
      SCRATCH.n = n;
      const rad = P.radius || 120;
      const reach = P.reach || 300;
      for (let k = 0; k < n; k++) {
        const a = runRng.angle(), d = runRng.range(60, reach);
        const x = run.player.x + Math.cos(a) * d, y = run.player.y + Math.sin(a) * d;
        run.hazards.telegraph(x, y, rad, c.tel, 'red', 'x');
        const ctx = ctxFor(run, x, y, rad, c.def.damage);
        ctx.color = '#8b3fd6';
        run.scheduler.after(c.tel, popCircle, ctx);
      }
    },
    fire(bc, c) { shake.medium(); },
  },

  steamVent: {
    telegraph(bc, c) {
      const run = bc.run, P = c.def.params, e = bc.active;
      const n = P.vents || P.count || 4;
      const rad = P.radius || 100;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + runRng.raw();
        const x = clamp(e.x + Math.cos(a) * (P.distance || 260), run.bounds.minX + 40, run.bounds.maxX - 40);
        const y = clamp(e.y + Math.sin(a) * (P.distance || 260), run.bounds.minY + 40, run.bounds.maxY - 40);
        run.hazards.telegraph(x, y, rad, c.tel, 'red', 'x');
        const ctx = ctxFor(run, x, y, rad, c.def.damage);
        ctx.color = '#e8ecf5';
        run.scheduler.after(c.tel, ventUp, ctx);
      }
    },
    fire() {},
  },

  tailSweep: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      const arc = P.arc || 2.4;
      SCRATCH.w = angleTo(e.x, e.y, run.player.x, run.player.y);
      SCRATCH.a = SCRATCH.w - arc * 0.5;
      run.hazards.telegraphCone(e.x, e.y, SCRATCH.w, arc, P.reach || P.range || 480,
                                c.tel, c.def.telegraphColor || 'red', 'arrow');
    },
    fire(bc, c) {
      const e = bc.active, P = c.def.params;
      audio.play('slash'); shake.medium();
      // The whole scythe, in one stroke, at the reach it actually covers.
      const f = fx();
      f.life = Math.max(0.26, c.def.duration || 0.85);
      f.width = 22; f.sweep = 1;
      effects.slash(e.x, e.y, SCRATCH.w, P.arc || 2.4, P.reach || P.range || 480,
                    c.def.color || '#ff6a1f', f);
    },
    active(bc, c, dt) {
      const run = bc.run, e = bc.active, P = c.def.params;
      const arc = P.arc || 2.4;
      const range = P.reach || P.range || 480;
      SCRATCH.a += (arc / (c.def.duration || 0.8)) * dt;
      const p = run.player;
      let d = angleTo(e.x, e.y, p.x, p.y) - SCRATCH.a;
      while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      if (Math.abs(d) < 0.3 && dist2(e.x, e.y, p.x, p.y) < range * range) {
        hitPlayer(run, c.def.damage, e.x, e.y);
      }
    },
    end(bc, c) {
      const e = bc.active, P = c.def.params;
      const f = fx();
      f.life = 0.3; f.size = 26;
      effects.impact(e.x + Math.cos(SCRATCH.a) * (P.reach || P.range || 480) * 0.8,
                     e.y + Math.sin(SCRATCH.a) * (P.reach || P.range || 480) * 0.8,
                     c.def.color || '#ff6a1f', f);
    },
  },

  /** The Drum Oni rotates the room by hitting the drums on his back. */
  drumRotate: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active;
      run.hazards.telegraph(e.x, e.y, 300, c.tel, 'yellow', 'circle');
      floaters.spawn(e.x, e.y - e.radius, 'THE ROOM TURNS', '#ffd23f', 22, 1.8);
    },
    fire(bc, c) {
      const run = bc.run, e = bc.active;
      run.rotateArena((c.def.params && (c.def.params.rotationDeg || c.def.params.degrees)) || 90);
      shake.big();
      audio.play('explode');
      const f = fx();
      f.life = 0.8; f.from = 40; f.width = 10; f.spokes = 24; f.double = true;
      effects.shockwave(e.x, e.y, 900, '#ffd23f', f);
    },
  },

  /**
   * Burning ground. `zones` is authored on both of the fields that matter (nine
   * for Ember Rain, eight for the Pyro Cue) and only one circle was ever painted.
   */
  spawnHazard: {
    telegraph(bc, c) {
      const run = bc.run, P = c.def.params;
      const n = P.zones || 1;
      const rad = P.radius || 150;
      SCRATCH.n = Math.min(n, ZONES.length >> 1);
      for (let i = 0; i < SCRATCH.n; i++) {
        const x = i === 0 ? run.player.x
                          : clamp(run.player.x + runRng.signed() * (P.spread || 520),
                                  run.bounds.minX + 40, run.bounds.maxX - 40);
        const y = i === 0 ? run.player.y
                          : clamp(run.player.y + runRng.signed() * (P.spread || 520),
                                  run.bounds.minY + 40, run.bounds.maxY - 40);
        ZONES[i * 2] = x; ZONES[i * 2 + 1] = y;
        run.hazards.telegraph(x, y, rad, c.tel, c.def.telegraphColor || 'red', 'x');
      }
    },
    fire(bc, c) {
      const run = bc.run, P = c.def.params;
      const rad = P.radius || 150;
      for (let i = 0; i < SCRATCH.n; i++) {
        const x = ZONES[i * 2], y = ZONES[i * 2 + 1];
        run.hazards.spawnField(x, y, rad, P.life || P.duration || 6,
                               P.effect || 'damage', P.tickDps || c.def.damage, c.def.color,
                               FIELD_OPTS);
        const f = fx();
        f.life = 0.4; f.from = rad * 0.2; f.width = 5;
        effects.shockwave(x, y, rad, c.def.color || '#ff7a3d', f);
      }
      audio.play('explode');
    },
  },

  /** A phase where the boss is immune until you break the shield. */
  shieldPhase: {
    telegraph(bc, c) {
      const e = bc.active;
      bc.run.hazards.telegraph(e.x, e.y, e.radius + 40, c.tel, 'blue', 'circle');
    },
    fire(bc, c) {
      const e = bc.active;
      addShield(e.st, (c.def.params && c.def.params.hits) || 3);
      floaters.spawn(e.x, e.y - e.radius, 'SHIELDED', '#4fc3ff', 22, 1.4);
      const f = fx();
      f.life = 0.5; f.from = e.radius * 2.4; f.width = 6; f.spokes = 16;
      effects.shockwave(e.x, e.y, e.radius * 1.1, '#4fc3ff', f);
    },
  },

  /** The Armored: immune except on the exposed nape. */
  weakPoint: {
    telegraph(bc, c) {
      const e = bc.active;
      bc.run.hazards.telegraph(e.x, e.y, e.radius + 30, c.tel, 'blue', 'circle');
    },
    fire(bc, c) {
      const e = bc.active;
      const ph = bc.phase;
      if (ph) ph.weakPoint = true;
      floaters.spawn(e.x, e.y - e.radius, 'NAPE EXPOSED', '#4fc3ff', 22, 1.8);
      const f = fx();
      f.life = 0.5; f.spokes = 12; f.width = 4;
      effects.burstRing(e.x, e.y, e.radius * 1.6, '#4fc3ff', f);
    },
    active(bc, c, dt) {
      // The window has to keep announcing itself or a six-second buff is
      // indistinguishable from nothing happening.
      const e = bc.active;
      c.fx -= dt;
      if (c.fx > 0) return;
      c.fx = 0.5;
      const f = fx();
      f.life = 0.45; f.from = e.radius * 1.9; f.width = 3; f.alpha = 0.7;
      effects.shockwave(e.x, e.y, e.radius * 0.9, '#4fc3ff', f);
    },
    // Cleared on EVERY phase, not just the current one. Only one window is ever
    // open, and the one caller that can end this attack early — a phase break —
    // has already advanced `bc.phase` by the time it gets here, so clearing the
    // current phase would clear the wrong object and leave the flag latched on a
    // shared data literal for the rest of the session.
    end(bc, c) {
      const phs = bc.def && bc.def.phases;
      if (phs) for (let i = 0; i < phs.length; i++) phs[i].weakPoint = false;
    },
  },
};

// --- shared spawn helpers ------------------------------------------------------

/** How many bodies a `spawns` table adds up to, for ring placement. */
function totalSpawns(list) {
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    if (row && row.enemy) n += row.count || 1;
  }
  return n || 1;
}

/** Re-aim a charge and repaint the line it is about to travel. */
function dashAim(bc, c, warn) {
  const run = bc.run, e = bc.active, P = c.def.params;
  SCRATCH.a = angleTo(e.x, e.y, run.player.x, run.player.y);
  const len = P.distance || 700;
  run.hazards.telegraphLine(e.x, e.y, e.x + Math.cos(SCRATCH.a) * len, e.y + Math.sin(SCRATCH.a) * len,
                            P.width || 90, warn, c.def.telegraphColor || 'red', 'arrow');
}

/**
 * One ring of a radial burst. `gapArc` is a SAFE LANE cut out of the ring, and
 * the lane rotates 1.7 radians per ring so consecutive rings never line their
 * gaps up — which is exactly what THE ALGORITHM's Feed Collapse says it does.
 */
function burstRingShot(run, e, def, baseAngle, index) {
  const P = def.params || EMPTY;
  const n = P.projectiles || P.count || 16;
  const gap = P.gapArc || 0;
  const off = baseAngle + index * 0.37;
  const gapA = off + index * 1.7;
  const o = proj(def, e);
  o.speed = P.speed || 260; o.life = P.life || 4; o.radius = 9;
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * TAU;
    if (gap > 0) {
      let d = a - gapA;
      while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      if (Math.abs(d) < gap * 0.5) continue;
    }
    run.enemyProjectiles.fire(e.x, e.y, a, o);
  }
  const f = fx();
  f.life = 0.36; f.spokes = Math.min(24, n); f.width = 4; f.angle = off;
  effects.burstRing(e.x, e.y, e.radius * (1.8 + index * 0.3), def.color || '#ff6f91', f);
}

/** One wave of a spread. */
function spreadWave(run, e, def, baseAngle) {
  const P = def.params || EMPTY;
  const n = P.count || 7;
  const arc = P.arc || P.spread || 1.0;
  const o = proj(def, e);
  o.speed = P.speed || 300; o.life = P.life || 4; o.radius = 8;
  for (let i = 0; i < n; i++) {
    run.enemyProjectiles.fire(e.x, e.y, baseAngle + (i / Math.max(1, n - 1) - 0.5) * arc, o);
  }
  const f = fx();
  f.life = 0.26; f.width = 12;
  effects.slash(e.x, e.y, baseAngle, arc, e.radius * 1.8, def.color || '#c58cff', f);
}

// --- scheduled helpers (module-level so they never allocate a closure) --------

function popCircle(ctx) {
  const { run, x, y, r, dmg } = ctx;
  if (dist2(x, y, run.player.x, run.player.y) < r * r) hitPlayer(run, dmg, x, y);
  const color = ctx.color || '#ff3a5e';
  const f = fx();
  f.size = r * 0.5; f.life = 0.24;
  effects.impact(x, y, color, f);
  const g = fx();
  g.life = 0.4; g.from = r * 0.25; g.width = Math.max(4, r * 0.1); g.spokes = 12;
  effects.shockwave(x, y, r, color, g);
  particles.ring(x, y, 14, color, r * 3);
  shake.small();
}

function ventUp(ctx) {
  const { run, x, y, r, dmg } = ctx;
  popCircle(ctx);
  run.hazards.spawnField(x, y, r * 0.8, 3, 'damage', dmg * 0.4, '#e8ecf5', FIELD_OPTS);
  // The column: a beam straight up out of the vent, which is also the read on
  // "stand here AFTER it fires and it carries you to the nape".
  const f = fx();
  f.life = 0.5; f.alpha = 0.85;
  effects.beam(x, y + r * 0.4, x, y - r * 3.2, r * 0.55, '#e8ecf5', f);
}

function shockRing(ctx) {
  const { run, x, y, r, dmg } = ctx;
  const p = run.player;
  const d = Math.sqrt(dist2(x, y, p.x, p.y));
  if (Math.abs(d - r) < 60) hitPlayer(run, dmg, x, y);
  const f = fx();
  f.life = 0.5; f.from = r * 0.55; f.width = 9; f.spokes = 16;
  effects.shockwave(x, y, r, '#ffd23f', f);
  particles.ring(x, y, 18, '#ffd23f', r * 3);
}

function delayedRing(ctx) {
  const e = ctx.e;
  if (!e || !e.active || e.hp <= 0) return;
  burstRingShot(ctx.run, e, ctx.def, ctx.a, ctx.n);
  audio.play('shoot');
}

function delayedSpread(ctx) {
  const e = ctx.e;
  if (!e || !e.active || e.hp <= 0) return;
  spreadWave(ctx.run, e, ctx.def, ctx.a);
  audio.play('shoot');
}

// --- more module-level constants ----------------------------------------------
const P_SPARK = { speed: 60, life: 0.3, additive: true };
const P_BREATH = { color: '#ff7a3d', life: 0.3, size: 0.7, additive: true, drag: 3 };
const FIELD_OPTS = { hitsPlayer: true, hitsEnemies: false };
/** x,y pairs for the multi-zone hazards. 16 zones is nearly twice the biggest authored. */
const ZONES = new Float32Array(32);
/** Where each lineSweep column actually is, so the damage matches the telegraph. */
const LANES = new Float32Array(8);

export { ATTACKS };
