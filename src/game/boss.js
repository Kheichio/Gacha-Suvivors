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

import { runRng, fxRng } from '../core/rng.js';
import { feel } from '../core/feel.js';
import { CONFIG } from '../core/config.js';
import { events, EV } from '../core/events.js';
import { audio } from '../core/audio.js';
import { particles } from '../render/particles.js';
import { floaters } from '../render/damageNumbers.js';
import { shake, flash } from '../render/screenShake.js';
import { clamp, dirTo, V, dist2, TAU, lerp, angleTo, rotateToward } from '../core/math.js';
import { areaDamage, coneDamage, lineDamage, damagePlayer, dealDamage, SRC } from './damage.js';
import { applyStun, applySlow, applyBurn, applyPull, applyShred, addShield, MARK, applyMark } from './statusEffects.js';
import { MOTION } from './projectile.js';

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
    /** Per-tentacle / per-tail HP for multi-part bosses. */
    this.parts = null;
    this.partAngles = null;
  }

  spawn(def, x, y, isMidBoss) {
    const run = this.run;
    const e = run.enemies.spawn(def, x, y, { isBoss: !isMidBoss, isMidBoss: !!isMidBoss });
    if (!e) return null;
    e.knockbackImmune = true;
    e.hp = e.maxHp = def.hp * run.difficultyMult.hp * (run.stage.hpMult || 1) *
                     (isMidBoss ? 1 : 1) * (1 + 0.06 * (run.time / 60));
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

    // --- movement -----------------------------------------------------------
    const ph = this.phase;
    const speedMult = (ph && ph.speedMult) || 1;
    if (!this.current || this.current.def.allowMove !== false) {
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

  _enterPhase(ph) {
    const run = this.run;
    const e = this.active;
    this.current = null;
    this.attackCd = 1.4;
    floaters.spawn(e.x, e.y - e.radius - 30, ph.name, ph.enrage ? '#ff3a5e' : '#ffd76a', 26, 2.2);
    particles.ring(e.x, e.y, 24, ph.enrage ? '#ff3a5e' : '#ffd76a', 460);
    shake.medium();
    flash.fire(ph.enrage ? '#ff3a5e' : '#ffffff', 0.25, 5);
    audio.play('bossIntro');
    if (ph.shield) addShield(e.st, ph.shield);
    events.emit(EV.BOSS_PHASE, e, ph, this.phaseIndex);
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

    this.current = { key, def, impl, t: 0, stage: 0, data: SCRATCH };
    SCRATCH.i = 0; SCRATCH.x = 0; SCRATCH.y = 0; SCRATCH.a = 0; SCRATCH.n = 0;
    // Every lethal attack telegraphs first. That is the whole contract.
    if (impl.telegraph) impl.telegraph(this, this.current);
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
    const tel = c.def.telegraph || feel.telegraphLethal;
    if (c.stage === 0) {
      if (c.impl.windup) c.impl.windup(this, c, dt);
      if (!this._stillFighting(c)) return;
      if (c.t >= tel) {
        c.stage = 1; c.t = 0;
        if (c.impl.fire) c.impl.fire(this, c);
      }
      return;
    }
    const dur = c.def.duration || 0;
    if (c.impl.active) c.impl.active(this, c, dt);
    if (!this._stillFighting(c)) return;
    if (c.t >= dur) {
      if (c.impl.end) c.impl.end(this, c);
      // end() can be the killing blow too.
      if (!this._stillFighting(c)) { return; }
      this.current = null;
      this.attackCd = (c.def.cooldown || 4) * (this.phase && this.phase.enrage ? 0.7 : 1);
    }
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
    this.active = null;
    this.def = null;
    this.current = null;
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

const SCRATCH = { i: 0, x: 0, y: 0, a: 0, n: 0 };
const EMPTY = {};

// --- attack kinds -------------------------------------------------------------
// Each is { telegraph?, windup?, fire?, active?, end? }. Everything lethal
// telegraphs. Nothing allocates.

const ATTACKS = {
  /** Columns or rows that sweep across the arena. */
  lineSweep: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      const vertical = P.axis === 'vertical';
      const n = P.columns || 3;
      const spanA = vertical ? run.bounds.minX : run.bounds.minY;
      const spanB = vertical ? run.bounds.maxX : run.bounds.maxY;
      for (let i = 0; i < n; i++) {
        const pos = lerp(spanA, spanB, (i + 0.5) / n) + runRng.signed() * 60;
        if (vertical) run.hazards.telegraphLine(pos, run.bounds.minY, pos, run.bounds.maxY, P.width || 100, c.def.telegraph || 1, c.def.telegraphColor || 'red', 'x');
        else run.hazards.telegraphLine(run.bounds.minX, pos, run.bounds.maxX, pos, P.width || 100, c.def.telegraph || 1, c.def.telegraphColor || 'red', 'x');
        if (i === 0) SCRATCH.x = pos;
        SCRATCH.n = n;
      }
      SCRATCH.a = vertical ? 1 : 0;
      SCRATCH.i = 0;
    },
    fire(bc, c) { audio.play('special'); shake.medium(); },
    active(bc, c, dt) {
      const run = bc.run, P = c.def.params;
      const vertical = SCRATCH.a === 1;
      const n = SCRATCH.n;
      const spanA = vertical ? run.bounds.minX : run.bounds.minY;
      const spanB = vertical ? run.bounds.maxX : run.bounds.maxY;
      for (let i = 0; i < n; i++) {
        const pos = lerp(spanA, spanB, (i + 0.5) / n);
        const t = clamp(c.t / (c.def.duration || 1.4), 0, 1);
        const sweep = vertical
          ? lerp(run.bounds.minY, run.bounds.maxY, t)
          : lerp(run.bounds.minX, run.bounds.maxX, t);
        const x = vertical ? pos : sweep;
        const y = vertical ? sweep : pos;
        areaDamage(run, x, y, (P.width || 100) * 0.5, c.def.damage * dt * 4, SRC.BOSS, { canCrit: false });
        const p = run.player;
        if (dist2(x, y, p.x, p.y) < ((P.width || 100) * 0.5) ** 2) {
          damagePlayer(run, c.def.damage, SRC.BOSS, { fromX: x, fromY: y });
        }
        particles.burst(x, y, 1, '#ff3a5e', { speed: 60, life: 0.3, additive: true });
      }
    },
  },

  /** A ring of projectiles outward from the boss. */
  radialBurst: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active;
      run.hazards.telegraph(e.x, e.y, (c.def.params.radius || 260), c.def.telegraph || 0.9,
                            c.def.telegraphColor || 'yellow', 'arrow');
    },
    fire(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      const n = P.count || 16;
      const off = P.aimed ? angleTo(e.x, e.y, run.player.x, run.player.y) : runRng.angle();
      for (let i = 0; i < n; i++) {
        run.enemyProjectiles.fire(e.x, e.y, off + (i / n) * TAU, {
          speed: P.speed || 260, damage: c.def.damage, life: P.life || 4,
          radius: P.radius || 9, owner: e,
          visual: { shape: 'diamond', color: c.def.color || '#ff6f91', accent: '#3a0a18', size: P.radius || 9, rotates: true, glow: true },
        });
      }
      audio.play('explode');
      shake.small();
    },
  },

  homingProjectile: {
    telegraph(bc, c) {
      const e = bc.active;
      bc.run.hazards.telegraph(e.x, e.y, 90, c.def.telegraph || 0.8, c.def.telegraphColor || 'yellow', 'arrow');
    },
    fire(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      const n = P.count || 4;
      const base = angleTo(e.x, e.y, run.player.x, run.player.y);
      for (let i = 0; i < n; i++) {
        run.enemyProjectiles.fire(e.x, e.y, base + (i / Math.max(1, n - 1) - 0.5) * (P.spread || 1.2), {
          motion: MOTION.HOMING, target: run.player,
          speed: P.speed || 190, turnRate: P.turnRate || 1.6,
          damage: c.def.damage, life: P.life || 6, radius: 11, owner: e,
          visual: { shape: 'square', color: c.def.color || '#ff2d95', accent: '#2a0a1e', size: 11, rotates: true },
        });
      }
      audio.play('shoot');
    },
  },

  groundSlam: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      SCRATCH.x = P.atPlayer ? run.player.x : e.x;
      SCRATCH.y = P.atPlayer ? run.player.y : e.y;
      run.hazards.telegraph(SCRATCH.x, SCRATCH.y, P.radius || 200, c.def.telegraph || 1.0,
                            c.def.telegraphColor || 'red', 'x');
    },
    fire(bc, c) {
      const run = bc.run, P = c.def.params;
      areaDamage(run, SCRATCH.x, SCRATCH.y, P.radius || 200, c.def.damage, SRC.BOSS, { falloff: 0.3, canCrit: false });
      const p = run.player;
      if (dist2(SCRATCH.x, SCRATCH.y, p.x, p.y) < (P.radius || 200) ** 2) {
        damagePlayer(run, c.def.damage, SRC.BOSS, { fromX: SCRATCH.x, fromY: SCRATCH.y });
      }
      particles.ring(SCRATCH.x, SCRATCH.y, 26, '#ff9a3d', (P.radius || 200) * 3.2);
      shake.big();
      audio.play('explode');
      // Expanding shockwave rings, if declared.
      if (P.rings) {
        for (let i = 1; i <= P.rings; i++) {
          run.scheduler.after(i * 0.35, shockRing, { run, x: SCRATCH.x, y: SCRATCH.y, r: (P.radius || 200) * (1 + i * 0.5), dmg: c.def.damage * 0.7 });
        }
      }
    },
  },

  chargeDash: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active;
      SCRATCH.a = angleTo(e.x, e.y, run.player.x, run.player.y);
      const len = c.def.params.distance || 700;
      run.hazards.telegraphLine(e.x, e.y, e.x + Math.cos(SCRATCH.a) * len, e.y + Math.sin(SCRATCH.a) * len,
                                c.def.params.width || 90, c.def.telegraph || 0.9,
                                c.def.telegraphColor || 'red', 'arrow');
    },
    fire(bc, c) { audio.play('special'); shake.medium(); },
    active(bc, c, dt) {
      const run = bc.run, e = bc.active, P = c.def.params;
      const sp = P.speed || 900;
      const px = e.x, py = e.y;
      e.x += Math.cos(SCRATCH.a) * sp * dt;
      e.y += Math.sin(SCRATCH.a) * sp * dt;
      lineDamage(run, px, py, e.x, e.y, (P.width || 90) * 0.5, c.def.damage * 0.4, SRC.BOSS, { knockback: 300 });
      const p = run.player;
      if (dist2(e.x, e.y, p.x, p.y) < ((P.width || 90) * 0.5 + 12) ** 2) {
        damagePlayer(run, c.def.damage, SRC.BOSS, { fromX: e.x, fromY: e.y });
      }
      particles.trail(e.x, e.y, -Math.cos(SCRATCH.a) * sp, -Math.sin(SCRATCH.a) * sp, '#ff3a5e', 0.9, 0.3);
      e.x = clamp(e.x, run.bounds.minX, run.bounds.maxX);
      e.y = clamp(e.y, run.bounds.minY, run.bounds.maxY);
    },
    end(bc, c) { bc.active.st.stunT = Math.max(bc.active.st.stunT, c.def.params.recover || 0.9); },
  },

  summonAdds: {
    telegraph(bc, c) {
      const e = bc.active;
      bc.run.hazards.telegraph(e.x, e.y, 140, c.def.telegraph || 0.8, 'yellow', 'circle');
    },
    fire(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      const def = run.data.enemies.ENEMIES_BY_ID[P.enemy];
      if (!def) return;
      const n = P.count || 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        run.enemies.spawn(def, e.x + Math.cos(a) * (e.radius + 40), e.y + Math.sin(a) * (e.radius + 40));
      }
      particles.ring(e.x, e.y, 16, '#c58cff', 320);
      audio.play('telegraph');
    },
  },

  aoeCircle: {
    telegraph(bc, c) {
      const run = bc.run, P = c.def.params;
      const n = P.count || 3;
      for (let i = 0; i < n; i++) {
        const a = runRng.angle(), d = runRng.range(80, P.spread || 340);
        const x = run.player.x + Math.cos(a) * d;
        const y = run.player.y + Math.sin(a) * d;
        run.hazards.telegraph(x, y, P.radius || 130, c.def.telegraph || 1.0, c.def.telegraphColor || 'red', 'x');
        run.scheduler.after(c.def.telegraph || 1.0, popCircle, { run, x, y, r: P.radius || 130, dmg: c.def.damage });
      }
    },
    fire() {},
  },

  coneBreath: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      SCRATCH.a = angleTo(e.x, e.y, run.player.x, run.player.y);
      run.hazards.telegraphCone(e.x, e.y, SCRATCH.a, P.arc || 1.0, P.range || 300,
                                c.def.telegraph || 1.0, c.def.telegraphColor || 'red', 'arrow');
    },
    fire(bc, c) { audio.play('special'); },
    active(bc, c, dt) {
      const run = bc.run, e = bc.active, P = c.def.params;
      // The cone tracks slowly, so backing out of it is a real option.
      SCRATCH.a = rotateToward(SCRATCH.a, angleTo(e.x, e.y, run.player.x, run.player.y), (P.trackRate || 0.7) * dt);
      const p = run.player;
      let d = angleTo(e.x, e.y, p.x, p.y) - SCRATCH.a;
      while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      if (Math.abs(d) < (P.arc || 1.0) * 0.5 && dist2(e.x, e.y, p.x, p.y) < (P.range || 300) ** 2) {
        damagePlayer(run, c.def.damage * dt, SRC.BOSS, { ignoreIframes: true, fromX: e.x, fromY: e.y });
        if (P.burn) applyBurn(p.st, P.burn, 2);
      }
      for (let i = 0; i < 3; i++) {
        const a2 = SCRATCH.a + (fxRng.raw() - 0.5) * (P.arc || 1.0);
        const dd = fxRng.raw() * (P.range || 300);
        particles.emit(e.x + Math.cos(a2) * dd, e.y + Math.sin(a2) * dd,
                       Math.cos(a2) * 120, Math.sin(a2) * 120,
                       { color: c.def.color || '#ff7a3d', life: 0.3, size: 0.7, additive: true, drag: 3 });
      }
    },
  },

  beamContinuous: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      SCRATCH.a = angleTo(e.x, e.y, run.player.x, run.player.y);
      const len = P.range || 1200;
      run.hazards.telegraphLine(e.x, e.y, e.x + Math.cos(SCRATCH.a) * len, e.y + Math.sin(SCRATCH.a) * len,
                                P.width || 120, c.def.telegraph || 1.2, 'white', 'bang');
    },
    fire(bc, c) { audio.play('special'); shake.medium(); flash.fire('#ffffff', 0.3, 4); },
    active(bc, c, dt) {
      const run = bc.run, e = bc.active, P = c.def.params;
      SCRATCH.a += (P.rotate || 0) * dt;
      const len = P.range || 1200;
      const x1 = e.x + Math.cos(SCRATCH.a) * len, y1 = e.y + Math.sin(SCRATCH.a) * len;
      lineDamage(run, e.x, e.y, x1, y1, (P.width || 120) * 0.5, c.def.damage * dt * 3, SRC.BOSS, { canCrit: false });
      const p = run.player;
      const ex = p.x - e.x, ey = p.y - e.y;
      const perp = Math.abs(ex * Math.sin(SCRATCH.a) - ey * Math.cos(SCRATCH.a));
      const proj = ex * Math.cos(SCRATCH.a) + ey * Math.sin(SCRATCH.a);
      if (perp < (P.width || 120) * 0.5 && proj > 0 && proj < len) {
        damagePlayer(run, c.def.damage * dt, SRC.BOSS, { ignoreIframes: true, fromX: e.x, fromY: e.y });
      }
      run.beamOverlay(e.x, e.y, x1, y1, P.width || 120, c.def.color || '#ffe86a');
    },
  },

  /** "DETENTION" — a shrinking ring of red tape you must stay inside. */
  shrinkingRing: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      SCRATCH.x = e.x; SCRATCH.y = e.y;
      run.hazards.telegraphRing(e.x, e.y, P.radius || 520, c.def.duration || 8, 'blue');
    },
    fire(bc, c) { audio.play('telegraph'); },
    active(bc, c, dt) {
      const run = bc.run, P = c.def.params;
      const t = clamp(c.t / (c.def.duration || 8), 0, 1);
      const rad = (P.radius || 520) * (1 - t * 0.75);
      const p = run.player;
      if (dist2(SCRATCH.x, SCRATCH.y, p.x, p.y) > rad * rad) {
        damagePlayer(run, c.def.damage * dt, SRC.BOSS, { ignoreIframes: true });
      }
      run.ringOverlay(SCRATCH.x, SCRATCH.y, rad, '#ff3a5e');
    },
  },

  rotatingSweep: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      SCRATCH.a = runRng.angle();
      run.hazards.telegraphCone(e.x, e.y, SCRATCH.a, P.arc || 0.7, P.range || 420,
                                c.def.telegraph || 1.0, 'red', 'arrow');
    },
    fire(bc, c) { audio.play('slash'); shake.small(); },
    active(bc, c, dt) {
      const run = bc.run, e = bc.active, P = c.def.params;
      SCRATCH.a += (P.rotateSpeed || 2.2) * dt;
      coneDamage(run, e.x, e.y, SCRATCH.a, P.arc || 0.7, P.range || 420, c.def.damage * dt * 6, SRC.BOSS, { canCrit: false, knockback: 200 });
      const p = run.player;
      let d = angleTo(e.x, e.y, p.x, p.y) - SCRATCH.a;
      while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      if (Math.abs(d) < (P.arc || 0.7) * 0.5 && dist2(e.x, e.y, p.x, p.y) < (P.range || 420) ** 2) {
        damagePlayer(run, c.def.damage, SRC.BOSS, { fromX: e.x, fromY: e.y });
      }
      run.wedgeOverlay(e.x, e.y, P.range || 420, SCRATCH.a - (P.arc || 0.7) / 2, SCRATCH.a + (P.arc || 0.7) / 2, '#ff3a5e');
    },
  },

  /**
   * The Colossus grab. DECISIONS.md §17: the mash accepts ANY ability key, ANY
   * gamepad face button, or a screen tap. Never keyboard-only.
   */
  grabQte: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active;
      run.hazards.telegraph(run.player.x, run.player.y, 120, c.def.telegraph || 1.0, 'white', 'bang');
    },
    fire(bc, c) {
      const run = bc.run, P = c.def.params;
      const p = run.player;
      const e = bc.active;
      if (dist2(e.x, e.y, p.x, p.y) < (P.grabRange || 340) ** 2 && p.st.invulnT <= 0) {
        bc.qte = { need: P.mashCount || 8, got: 0, t: P.window || 2.5, damage: c.def.damage };
        run.startQte(bc.qte);
        p.flags.rooted = true;
      }
    },
    active(bc, c, dt) {
      const run = bc.run;
      if (!bc.qte) return;
      bc.qte.t -= dt;
      if (run.mashPressed()) bc.qte.got++;
      if (bc.qte.got >= bc.qte.need) {
        run.player.flags.rooted = false;
        run.endQte(true);
        bc.qte = null;
        c.t = c.def.duration + 1;
      } else if (bc.qte.t <= 0) {
        damagePlayer(run, bc.qte.damage, SRC.BOSS, { ignoreIframes: true, undodgeable: true });
        run.player.flags.rooted = false;
        run.endQte(false);
        bc.qte = null;
      }
    },
    end(bc) { if (bc.run.player) bc.run.player.flags.rooted = false; bc.run.endQte(false); bc.qte = null; },
  },

  projectileSpread: {
    telegraph(bc, c) {
      const e = bc.active;
      bc.run.hazards.telegraphCone(e.x, e.y, angleTo(e.x, e.y, bc.run.player.x, bc.run.player.y),
                                   c.def.params.spread || 1.0, 400, c.def.telegraph || 0.8, 'yellow', 'arrow');
    },
    fire(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      const base = angleTo(e.x, e.y, run.player.x, run.player.y);
      const n = P.count || 7;
      for (let i = 0; i < n; i++) {
        run.enemyProjectiles.fire(e.x, e.y, base + (i / (n - 1) - 0.5) * (P.spread || 1.0), {
          speed: P.speed || 300, damage: c.def.damage, life: 4, radius: 8, owner: e,
          visual: { shape: 'shard', color: c.def.color || '#c58cff', accent: '#2a1040', size: 8, rotates: true },
        });
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
      bc.run.hazards.telegraph(e.x, e.y, 160, c.def.telegraph || 1.0, 'white', 'bang');
      floaters.spawn(e.x, e.y - e.radius - 20, 'YOUR OWN MOVE', '#ffffff', 24, 1.6);
    },
    fire(bc, c) {
      const run = bc.run, e = bc.active;
      run.fireMirroredPlayerAbility(e, (c.def.params && c.def.params.powerMult) || 1.2);
      audio.play('special');
      shake.medium();
    },
  },

  tentacleSlam: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      const alive = [];
      if (bc.parts) for (let i = 0; i < bc.parts.length; i++) if (bc.parts[i] > 0) alive.push(i);
      SCRATCH.n = Math.min(alive.length, P.count || 3);
      for (let k = 0; k < SCRATCH.n; k++) {
        const a = runRng.angle(), d = runRng.range(60, 300);
        const x = run.player.x + Math.cos(a) * d, y = run.player.y + Math.sin(a) * d;
        run.hazards.telegraph(x, y, P.radius || 120, c.def.telegraph || 1.0, 'red', 'x');
        run.scheduler.after(c.def.telegraph || 1.0, popCircle, { run, x, y, r: P.radius || 120, dmg: c.def.damage });
      }
    },
    fire(bc, c) { shake.medium(); },
  },

  steamVent: {
    telegraph(bc, c) {
      const run = bc.run, P = c.def.params;
      const n = P.count || 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + runRng.raw();
        const x = bc.active.x + Math.cos(a) * (P.distance || 260);
        const y = bc.active.y + Math.sin(a) * (P.distance || 260);
        run.hazards.telegraph(x, y, P.radius || 100, c.def.telegraph || 1.0, 'red', 'x');
        run.scheduler.after(c.def.telegraph || 1.0, ventUp, { run, x, y, r: P.radius || 100, dmg: c.def.damage });
      }
    },
    fire() {},
  },

  tailSweep: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active, P = c.def.params;
      SCRATCH.a = angleTo(e.x, e.y, run.player.x, run.player.y) - (P.arc || 2.4) * 0.5;
      run.hazards.telegraphCone(e.x, e.y, angleTo(e.x, e.y, run.player.x, run.player.y),
                                P.arc || 2.4, P.range || 480, c.def.telegraph || 1.1, 'red', 'arrow');
    },
    fire(bc, c) { audio.play('slash'); shake.medium(); },
    active(bc, c, dt) {
      const run = bc.run, e = bc.active, P = c.def.params;
      SCRATCH.a += ((P.arc || 2.4) / (c.def.duration || 0.8)) * dt;
      coneDamage(run, e.x, e.y, SCRATCH.a, 0.5, P.range || 480, c.def.damage * dt * 8, SRC.BOSS, { knockback: 380, canCrit: false });
      const p = run.player;
      let d = angleTo(e.x, e.y, p.x, p.y) - SCRATCH.a;
      while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      if (Math.abs(d) < 0.3 && dist2(e.x, e.y, p.x, p.y) < (P.range || 480) ** 2) {
        damagePlayer(run, c.def.damage, SRC.BOSS, { fromX: e.x, fromY: e.y });
      }
    },
  },

  /** The Drum Oni rotates the room by hitting the drums on his back. */
  drumRotate: {
    telegraph(bc, c) {
      const run = bc.run, e = bc.active;
      run.hazards.telegraph(e.x, e.y, 300, c.def.telegraph || 1.2, 'yellow', 'circle');
      floaters.spawn(e.x, e.y - e.radius, 'THE ROOM TURNS', '#ffd23f', 22, 1.8);
    },
    fire(bc, c) {
      const run = bc.run;
      run.rotateArena((c.def.params && c.def.params.degrees) || 90);
      shake.big();
      audio.play('explode');
    },
  },

  spawnHazard: {
    telegraph(bc, c) {
      const run = bc.run, P = c.def.params;
      run.hazards.telegraph(run.player.x, run.player.y, P.radius || 150, c.def.telegraph || 1.0, 'red', 'x');
      SCRATCH.x = run.player.x; SCRATCH.y = run.player.y;
    },
    fire(bc, c) {
      const run = bc.run, P = c.def.params;
      run.hazards.spawnField(SCRATCH.x, SCRATCH.y, P.radius || 150, P.duration || 6,
                             P.effect || 'damage', c.def.damage, c.def.color,
                             { hitsPlayer: true, hitsEnemies: false });
    },
  },

  /** A phase where the boss is immune until you break the shield. */
  shieldPhase: {
    telegraph(bc, c) {
      const e = bc.active;
      bc.run.hazards.telegraph(e.x, e.y, e.radius + 40, c.def.telegraph || 0.6, 'blue', 'circle');
    },
    fire(bc, c) {
      const e = bc.active;
      addShield(e.st, (c.def.params && c.def.params.hits) || 3);
      floaters.spawn(e.x, e.y - e.radius, 'SHIELDED', '#4fc3ff', 22, 1.4);
    },
  },

  /** The Armored: immune except on the exposed nape. */
  weakPoint: {
    telegraph(bc, c) {
      const e = bc.active;
      bc.run.hazards.telegraph(e.x, e.y, e.radius + 30, c.def.telegraph || 0.8, 'blue', 'circle');
    },
    fire(bc, c) {
      const e = bc.active;
      const ph = bc.phase;
      if (ph) ph.weakPoint = true;
      floaters.spawn(e.x, e.y - e.radius, 'NAPE EXPOSED', '#4fc3ff', 22, 1.8);
    },
    end(bc, c) { const ph = bc.phase; if (ph) ph.weakPoint = false; },
  },

  /** Clones the player's own projectiles back at them (The Algorithm). */
  feed_collapse: null,
};
delete ATTACKS.feed_collapse;

// --- scheduled helpers (module-level so they never allocate a closure) --------
function popCircle(ctx) {
  const { run, x, y, r, dmg } = ctx;
  areaDamage(run, x, y, r, dmg, SRC.BOSS, { falloff: 0.3, canCrit: false });
  if (dist2(x, y, run.player.x, run.player.y) < r * r) {
    damagePlayer(run, dmg, SRC.BOSS, { fromX: x, fromY: y });
  }
  particles.ring(x, y, 14, '#ff3a5e', r * 3);
  shake.small();
}

function ventUp(ctx) {
  const { run, x, y, r, dmg } = ctx;
  popCircle(ctx);
  run.hazards.spawnField(x, y, r * 0.8, 3, 'damage', dmg * 0.4, '#e8ecf5', { hitsPlayer: true, hitsEnemies: false });
}

function shockRing(ctx) {
  const { run, x, y, r, dmg } = ctx;
  areaDamage(run, x, y, r, dmg, SRC.BOSS, { falloff: 0.5, canCrit: false });
  const p = run.player;
  const d = Math.sqrt(dist2(x, y, p.x, p.y));
  if (Math.abs(d - r) < 60) damagePlayer(run, dmg, SRC.BOSS, { fromX: x, fromY: y });
  particles.ring(x, y, 18, '#ffd23f', r * 3);
}

export { ATTACKS };
