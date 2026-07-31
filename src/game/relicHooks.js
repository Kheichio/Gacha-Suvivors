// Relic and evolution hook dispatch.
//
// Relics are DATA (data/relics.js) declaring which hooks they use plus their
// params. This file is the ~20 hook POINTS those declarations bind to, and the
// implementations keyed by relic id.
//
// RESONANCE (DECISIONS.md §10) is applied here, once, when the hook table is
// built — not at every call site. Params are resolved through a direction-aware
// 1.5x (intervals and cooldowns go DOWN, everything else goes UP), with an
// explicit per-relic override where the spec pinned exact numbers.
//
// PUBLIC API (used by run.js, the ability registry, and the evolutions module):
//     hooks.fire(name, a, b, c)          dispatch a hook
//     hooks.rebuild()                    re-bind after a relic changes
//     hooks.tick(dt)                     drive onInterval / onTick
//     hooks.addEvolutionHook(name, fn)   register an extra handler not tied to a relic
//     hooks.paramsFor(relicId)           resolved params, resonance included

import { events, EV } from '../core/events.js';
import { runRng } from '../core/rng.js';
import { audio } from '../core/audio.js';
import { particles } from '../render/particles.js';
import { floaters } from '../render/damageNumbers.js';
import { shake, flash } from '../render/screenShake.js';
import { clamp, TAU, dist2, angleTo } from '../core/math.js';
import {
  dealDamage, areaDamage, coneDamage, lineDamage, executeEnemy, healPlayer,
  damagePlayer, SRC,
} from './damage.js';
import {
  applyBurn, applyBleed, applySlow, applyStun, applyPull, applyNoRegen,
  applyHaste, applyEmpower, applyMark, addShield, MARK,
} from './statusEffects.js';
import { nearestTo } from './targeting.js';
import { MINION_ROLE } from './minion.js';
// `helpers.js` is a LEAF of the ability folder: it imports the engine (damage,
// projectiles, targeting, status, hazards, effects) and never index.js or
// registry.js, so pulling `spread` in costs nothing this file was not already
// loading. It is imported because a relic that throws a projectile has to honour
// Extra Shot, Long Haul, Wide Reach and Piercing Will exactly like an ability
// that throws one, and the only way to guarantee that is the shared funnel.
import { spread } from './abilities/helpers.js';
// NOTE: this file still deliberately does NOT import the ability REGISTRY. A
// relic that needs to re-fire an auto-attack asks the Run to do it
// (`run.fireExtraAuto`) rather than reaching into the registry — otherwise every
// consumer of relicHooks (including the test runner) drags the whole 170KB
// ability layer in at module-load time just to read HOOK_NAMES.

/** The stone. Module scope: an every-Nth-shot path must not allocate. */
const BOULDER = {
  damage: 0, speed: 300, life: 2, radius: 20, knockback: 90,
  pierce: 2, tag: 'boulder',
  visual: { shape: 'circle', color: '#8a7b63', accent: '#3a3226', size: 20 },
};

export const HOOK_NAMES = [
  'onInterval', 'onAutoAttack', 'onNthAutoAttack', 'onHit', 'onCrit', 'onKill',
  'onEliteKill', 'onDamageTaken', 'onLowHp', 'onHighHp', 'onLevelUp', 'onEscape',
  'onSpecial', 'onRevive', 'onProjectileHit', 'onTick', 'onRunStart', 'onPierce',
  'onBuffStack', 'onGoldGained',
];

export class RelicHooks {
  constructor(run) {
    this.run = run;
    /** hookName -> array of {relic, params, fn, state} */
    this.table = Object.create(null);
    for (const n of HOOK_NAMES) this.table[n] = [];
    /** relicId -> resolved params (resonance already folded in) */
    this.params = Object.create(null);
    /** relicId -> per-run scratch */
    this.state = Object.create(null);
    /** Extra handlers not tied to a relic — evolutions register through here. */
    this.extra = Object.create(null);
    this._bound = false;
    this._bindEvents();
  }

  // --- binding ---------------------------------------------------------------
  _bindEvents() {
    if (this._bound) return;
    this._bound = true;
    const run = this.run;
    this._onEnemyKilled = (e, src) => {
      this.fire('onKill', e, src);
      if (e.isElite || e.isBoss) this.fire('onEliteKill', e, src);
    };
    this._onEnemyHit = (e, dmg, src) => this.fire('onHit', e, dmg, src);
    this._onCrit = (e, dmg, src) => this.fire('onCrit', e, dmg, src);
    this._onHurt = (dmg, src, attacker) => this.fire('onDamageTaken', dmg, src, attacker);
    this._onGold = (amount) => this.fire('onGoldGained', amount);
    events.on(EV.ENEMY_KILLED, this._onEnemyKilled);
    events.on(EV.ENEMY_HIT, this._onEnemyHit);
    events.on('enemy:crit', this._onCrit);
    events.on(EV.PLAYER_HURT, this._onHurt);
    events.on(EV.GOLD_GAINED, this._onGold);
  }

  dispose() {
    events.off(EV.ENEMY_KILLED, this._onEnemyKilled);
    events.off(EV.ENEMY_HIT, this._onEnemyHit);
    events.off('enemy:crit', this._onCrit);
    events.off(EV.PLAYER_HURT, this._onHurt);
    events.off(EV.GOLD_GAINED, this._onGold);
    this._bound = false;
  }

  /** Re-bind the whole table. Called whenever the equipped relics change. */
  rebuild() {
    for (const n of HOOK_NAMES) this.table[n].length = 0;
    const run = this.run;
    const p = run.player;

    for (const id of p.relics) {
      const relic = run.data.relics.RELICS_BY_ID[id];
      if (!relic) continue;
      const resonant = p.resonatesWith(id);
      const params = resolveParams(run, relic, resonant);
      this.params[id] = params;
      if (!this.state[id]) this.state[id] = Object.create(null);
      this.state[id].resonant = resonant;
      this.state[id].t = 0;

      const impl = RELIC_IMPL[id];
      if (!impl) continue;
      for (const hook of relic.hooks || []) {
        const fn = impl[hook];
        if (!fn) continue;
        this.table[hook].push({ id, relic, params, fn, state: this.state[id], resonant });
      }
    }
    // Extras (evolutions) are appended after relics so they see the final state.
    for (const n of HOOK_NAMES) {
      const ex = this.extra[n];
      if (ex) for (const e of ex) this.table[n].push(e);
    }
  }

  /**
   * Register a handler that is not backed by a relic. Evolutions use this.
   * @param name one of HOOK_NAMES
   * @param fn   (run, p, params, state, a, b, c) => void
   * @param params optional params object the handler receives
   */
  addEvolutionHook(name, fn, params) {
    if (!HOOK_NAMES.includes(name)) {
      console.warn('[relicHooks] unknown hook "' + name + '"');
      return;
    }
    const entry = { id: 'evolution', relic: null, params: params || EMPTY,
                    fn, state: Object.create(null), resonant: false };
    if (!this.extra[name]) this.extra[name] = [];
    this.extra[name].push(entry);
    this.table[name].push(entry);
    return entry;
  }

  paramsFor(id) { return this.params[id] || EMPTY; }
  isResonant(id) { return !!(this.state[id] && this.state[id].resonant); }

  // --- dispatch ---------------------------------------------------------------
  fire(name, a, b, c) {
    const list = this.table[name];
    if (!list || list.length === 0) return;
    const run = this.run;
    const p = run.player;
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      h.fn(run, p, h.params, h.state, a, b, c);
    }
  }

  tick(dt) {
    const run = this.run;
    const p = run.player;

    // onInterval: each relic counts its own resolved interval.
    const iv = this.table.onInterval;
    for (let i = 0; i < iv.length; i++) {
      const h = iv[i];
      h.state.t = (h.state.t || 0) - dt;
      if (h.state.t <= 0) {
        h.state.t = h.params.interval || 10;
        h.fn(run, p, h.params, h.state);
      }
    }

    const tk = this.table.onTick;
    for (let i = 0; i < tk.length; i++) tk[i].fn(run, p, tk[i].params, tk[i].state, dt);

    // Threshold hooks are edge-triggered, so they cannot fire every frame.
    const frac = p.hpFraction;
    const low = this.table.onLowHp;
    if (low.length) {
      for (let i = 0; i < low.length; i++) {
        const h = low[i];
        const below = frac < (h.params.threshold || 0.5);
        if (below !== !!h.state.below) {
          h.state.below = below;
          h.fn(run, p, h.params, h.state, below);
        }
      }
    }
    const high = this.table.onHighHp;
    if (high.length) {
      for (let i = 0; i < high.length; i++) {
        const h = high[i];
        const above = frac > (h.params.threshold || 0.8);
        if (above !== !!h.state.above) {
          h.state.above = above;
          h.fn(run, p, h.params, h.state, above);
        }
      }
    }
  }
}

// --- resonance --------------------------------------------------------------
/**
 * DECISIONS.md §10. The spec left resonance as "50% stronger" with one worked
 * example that is 40% on one param and 50% on another — so it is per-param and
 * direction-aware, with an explicit override where the numbers were pinned.
 */
function resolveParams(run, relic, resonant) {
  const base = relic.params || EMPTY;
  if (!resonant) return base;
  if (relic.resonance) return Object.assign({}, base, relic.resonance);

  const dir = run.data.relics.RESONANCE_DIRECTION || EMPTY;
  const mult = run.data.relics.RESONANCE_MULT || 1.5;
  const out = {};
  for (const k in base) {
    const v = base[k];
    if (typeof v !== 'number') { out[k] = v; continue; }
    const d = dir[k] || dir.default || 'up';
    out[k] = d === 'down' ? v / mult : v * mult;
  }
  return out;
}

// --- the 24 relic implementations -------------------------------------------
// Keyed by relic id, each an object of hook handlers. Signature is always
// (run, p, params, state, a, b, c). Nothing here allocates per call.

const RELIC_IMPL = {

  // --- signature relics -----------------------------------------------------

  /** Mochi — every 8th auto-attack spits a boulder (4x damage, knockback). */
  secret_technique_109: {
    onNthAutoAttack(run, p, params, state, shotIndex) {
      const n = params.everyNth || 8;
      if (shotIndex % n !== 0) return;
      const t = nearestTo(run, p.x, p.y, 700, null);
      const a = t ? angleTo(p.x, p.y, t.x, t.y) : p.facing;
      // Through `spread`, so a relic-thrown projectile honours the same four
      // upgrades an ability-thrown one does. The numbers are raw on purpose —
      // the helper applies area, speed, life and pierce itself.
      BOULDER.damage = p.def.autoAttack.damage * (params.damageMult || 4) * p.autoDamageMultiplier();
      spread(run, p, p.x, p.y, a, 1, 0, BOULDER);
      audio.play('explode');
    },
  },

  /** Alto — every 4th auto-attack swings twice. */
  dual_blades: {
    onNthAutoAttack(run, p, params, state, shotIndex) {
      const n = params.everyNth || 4;
      if (shotIndex % n !== 0) return;
      // Re-fire the auto one frame later so the second swing reads as a follow-up.
      run.scheduler.after(0.09, reFireAuto, run);
    },
  },

  /** Hoshino Rei — auras 40% larger and 25% faster. Read by aura abilities. */
  hoshiyomi_penlight: {
    onRunStart(run, p, params) {
      p.flags.auraSizeMult = 1 + (params.sizeBonus || 0.40);
      p.flags.auraRateMult = 1 + (params.rateBonus || 0.25);
    },
    onTick(run, p, params) {
      if (p.flags.auraSizeMult === undefined) {
        p.flags.auraSizeMult = 1 + (params.sizeBonus || 0.40);
        p.flags.auraRateMult = 1 + (params.rateBonus || 0.25);
      }
    },
  },

  /** Yamikage — every 12s a spectral ribcage fully blocks the next hit taken. */
  susanoo_fragment: {
    onInterval(run, p, params, state) {
      if (p.st.shieldHits > 0) return;
      addShield(p.st, 1);
      state.up = true;
      particles.ring(p.x, p.y, 12, '#8b5cf6', 180);
      floaters.spawn(p.x, p.y - 44, 'RIBCAGE UP', '#8b5cf6', 16, 0.9);
    },
    /** The block itself happens in damage.js; this is the feedback for it. */
    onDamageTaken(run, p, params, state) {
      if (!state.up || p.st.shieldHits > 0) return;
      state.up = false;
      particles.ring(p.x, p.y, 14, '#8b5cf6', 260);
      floaters.spawn(p.x, p.y - 44, 'BLOCKED', '#8b5cf6', 18, 1.0);
    },
  },

  /**
   * The rabbit trickster — once every `cooldown`, a hit comes back at the sender
   * and a mine goes off where she was standing.
   *
   * THE REFUND, AND WHY IT IS A REFUND. Her card promises the hit "does not
   * land". `onDamageTaken` fires AFTER damage.js has already resolved and
   * subtracted it — the Susanoo Fragment's own comment says as much, which is
   * why that relic pre-arms a shield through the status system instead of
   * cancelling anything here. A shield is the wrong shape for this one: it would
   * eat a hit chosen by the shield, whereas this relic's entire pitch is that you
   * never know which hit it spends on. So the hit is REFUNDED — healed back
   * exactly, capped by the heal path — which nets to the same HP as a negation
   * and, unlike a shield, still lets the reflect read off the real number.
   *
   * The one honest difference: anything that reacts to HP dropping (low-HP
   * relics, her own on-damage counters) still sees the dip. That is a fair price
   * for not touching damage.js's hot path, and it is invisible at 60fps.
   *
   * The mine is NOT routed through the trickster's own trap ring: that ring is
   * owned and cleared by her passive and pays her spite stacks, which this
   * relic's card does not promise to anyone who is merely holding it.
   */
  the_contingency_plan: {
    onDamageTaken(run, p, params, state, dmg, src, attacker) {
      const now = run.time;
      if (state.until !== undefined && now < state.until) return;
      state.until = now + (params.cooldown || 40);

      const taken = dmg > 0 ? dmg : 0;
      if (taken > 0) healPlayer(run, taken);

      // Straight back onto whatever threw it, when there is something to hit.
      if (attacker && attacker.active && attacker.hp > 0) {
        dealDamage(run, attacker, taken * (params.reflect || 3), SRC.RELIC,
                   { canCrit: false, element: 'spirit' });
      }
      areaDamage(run, p.x, p.y, (params.radius || 130) * p.stats.areaMult,
                 (params.damage || 100) * p.abilityDamageMultiplier(), SRC.RELIC,
                 { falloff: 0.3, element: 'spirit' });

      particles.ring(p.x, p.y, 18, '#ff8f2e', (params.radius || 130) * 2.6);
      floaters.spawn(p.x, p.y - 46, 'PLAN B', '#ff8f2e', 18, 1.0);
      audio.play('explode');
      shake.small();
    },
  },

  /** Uzu — below 50% HP: +40% attack speed and a burning chakra cloak. */
  nine_tails_chakra: {
    onLowHp(run, p, params, state, below) {
      if (below) {
        p.addBuff('nine_tails', 99999, { attackSpeedMult: params.attackSpeed || 0.40 });
        p.flags.auraColor = '#ff7a3d';
        state.cloak = true;
      } else {
        p.removeBuff('nine_tails');
        p.flags.auraColor = null;
        state.cloak = false;
      }
    },
    onTick(run, p, params, state, dt) {
      if (!state.cloak) return;
      state.burnT = (state.burnT || 0) - dt;
      if (state.burnT > 0) return;
      state.burnT = 0.25;
      areaDamage(run, p.x, p.y, (params.radius || 90) * p.stats.areaMult,
                 (params.dps || 30) * 0.25, SRC.RELIC, { canCrit: false, noNumber: true });
      particles.drift(p.x, p.y, '#ff7a3d', { life: 0.4, size: 0.5 });
    },
  },

  /** Captain Yuli — every 6th attack detonates in a 100px blast. */
  thunder_spear: {
    onNthAutoAttack(run, p, params, state, shotIndex) {
      const n = params.everyNth || 6;
      if (shotIndex % n !== 0) return;
      const t = nearestTo(run, p.x, p.y, 500, null);
      const x = t ? t.x : p.x, y = t ? t.y : p.y;
      areaDamage(run, x, y, (params.radius || 100) * p.stats.areaMult,
                 (params.damage || 120) * p.abilityDamageMultiplier(), SRC.RELIC,
                 { falloff: 0.3, element: 'lightning' });
      particles.ring(x, y, 16, '#ffe14a', 300);
      shake.small();
      audio.play('explode');
    },
  },

  /** Kagura — DoTs deal +50% damage and last +2s. */
  inaris_blessing: {
    onTick(run, p, params) {
      // Set every tick rather than once: an evolution or a swapped relic can
      // clear a flag, and a silently-lost passive is the worst kind of bug.
      p.flags.dotDamageMult = 1 + (params.damageBonus || 0.50);
      p.flags.dotDurationBonus = params.durationBonus || 2;
    },
    /** Extends whatever DoT the hit just applied. */
    onHit(run, p, params, state, e) {
      if (!e || !e.active) return;
      const bonus = params.durationBonus || 2;
      if (e.st.burnT > 0 && !e.st.burnPerm) {
        e.st.burnT += bonus * 0.25;
        e.st.burnDps *= 1 + (params.damageBonus || 0.5) * 0.05;
      }
      if (e.st.bleedT > 0) e.st.bleedT += bonus * 0.25;
      if (e.st.poisonT > 0) e.st.poisonT += bonus * 0.25;
    },
  },

  /** Unit-09 — at 6+ buff stacks, +30% damage and a hot pink outline. */
  singularity_patch: {
    onBuffStack(run, p, params, state) { evaluateSingularity(run, p, params, state); },
    onTick(run, p, params, state) { evaluateSingularity(run, p, params, state); },
  },

  /** Rin — SUNLIGHT: no enemy regeneration, 4% max HP/s for 4s. */
  nichirin_blade_crimson: {
    onHit(run, p, params, state, e) {
      if (!e || !e.active) return;
      applyNoRegen(e.st, params.duration || 4);
      applyBleed(e.st, params.percentPerSec || 0.04, params.duration || 4);
    },
  },

  /**
   * Niten — every 2nd auto-attack is a guaranteed crit.
   * Extraordinary on him because his auto already alternates long/short sword;
   * merely very good on everyone else.
   */
  two_heavens_as_one: {
    onNthAutoAttack(run, p, params, state, shotIndex) {
      p.flags.guaranteedCrit = (shotIndex % (params.everyNth || 2)) === 0;
    },
    onCrit(run, p, params, state, e) {
      // The guaranteed crit is consumed the moment it lands, so a piercing
      // attack cannot spend one charge on forty enemies.
      p.flags.guaranteedCrit = false;
      particles.burst(e.x, e.y, 4, '#ffd94a', { speed: 180, life: 0.22, additive: true });
    },
  },

  /** Shiro Same — a chum pile that pulls enemies in, every 20s (12s resonant). */
  chum_bucket: {
    onInterval(run, p, params, state) {
      const r = (params.radius || 250) * p.stats.areaMult;
      // A PROP, not a minion — DECISIONS.md §27.
      run.hazards.spawnField(p.x, p.y, r, params.duration || 4, 'pull', 0, '#5fd6ff',
                             { param: params.force || 200, hitsEnemies: true });
      particles.ring(p.x, p.y, 14, '#5fd6ff', r * 2);
      floaters.spawn(p.x, p.y - 40, 'CHUM', '#5fd6ff', 16, 0.9);
    },
  },

  /** Reika — piercing attacks gain +12% damage per enemy already pierced. */
  level_5_clearance: {
    onTick(run, p, params) { p.flags.pierceBonusPerHit = params.perPierce || 0.12; },
    /** Fired by the projectile system each time a shot punches through. */
    onPierce(run, p, params, state, projectile) {
      if (!projectile) return;
      projectile.accumulatedPierceBonus += params.perPierce || 0.12;
    },
  },

  /** Nekromina — minion cap +3, minions +25% attack speed. */
  grave_idol_mic: {
    onRunStart(run, p, params) { applyMinionBonuses(p, params); },
    onTick(run, p, params) { applyMinionBonuses(p, params); },
  },

  /** Hikari — a revive grants +100% damage for 10s. */
  ashes_of_the_eternal_encore: {
    onRevive(run, p, params, state) {
      p.addBuff('ashes', params.duration || 10, { damageMult: params.damageBonus || 1.0 });
      flash.fire('#ff7a3d', 0.5, 2);
      floaters.spawn(p.x, p.y - 60, 'ENCORE!', '#ff7a3d', 30, 2.0);
    },
  },

  /** Akane — every 45s: heal 20% max HP and gain +40% damage for 8s. */
  captains_rum: {
    onInterval(run, p, params, state) {
      healPlayer(run, p.maxHp * (params.healPercent || 0.20));
      p.addBuff('rum', params.duration || 8, { damageMult: params.damageBonus || 0.40 });
      floaters.spawn(p.x, p.y - 44, 'GLUG', '#ff5f7e', 18, 1.0);
      audio.play('heal');
    },
  },

  /** Kira — every 30s the next name written marks 6 enemies at once. */
  potato_chip_gambit: {
    onInterval(run, p, params, state) {
      p.flags.nextWriteMarks = params.marks || 6;
      state.armed = true;
      // The animation must be him eating a single potato chip with enormous
      // dramatic intensity. Non-negotiable, per the spec.
      floaters.spawn(p.x, p.y - 50, '🥔 *crunch*', '#ffd76a', 20, 1.6);
      audio.play('crit');
      shake.small();
    },
    /** Clears the charge once the write that used it has gone out. */
    onAutoAttack(run, p, params, state) {
      if (!state.armed || p.flags.nextWriteMarks) return;
      state.armed = false;
    },
  },

  /** Alicia — while above 80% HP, +35% all damage. */
  crown_of_the_world_eater: {
    onHighHp(run, p, params, state, above) {
      if (above) {
        p.addBuff('crown', 99999, { damageMult: params.damageBonus || 0.35 });
        p.flags.auraColor = '#ffb03d';
      } else {
        p.removeBuff('crown');
        p.flags.auraColor = null;
      }
    },
  },

  /** Sora — the escape grants +50% damage / +30% attack speed for 6s, at 10% max HP. */
  kaioken: {
    onEscape(run, p, params, state) {
      p.addBuff('kaioken', params.duration || 6, {
        damageMult: params.damageBonus || 0.50,
        attackSpeedMult: params.attackSpeed || 0.30,
      });
      // Recoil is real damage, routed through the choke point like everything else.
      damagePlayer(run, p.maxHp * (params.recoilPercent || 0.10), SRC.RELIC,
                   { trueDamage: true, ignoreIframes: true, undodgeable: true });
      p.flags.auraColor = '#ff3a5e';
      flash.fire('#ff3a5e', 0.3, 4);
      floaters.spawn(p.x, p.y - 50, 'KAIO-KEN', '#ff3a5e', 24, 1.2);
    },
  },

  /** Han — below 25% HP, fill your rage/special and gain 2s invuln. Once/90s. */
  the_cell_games: {
    onLowHp(run, p, params, state, below) { if (below) fireCellGames(run, p, params, state); },
    /**
     * Also checked on damage taken, not only on the threshold crossing: a hit
     * that takes you from 30% to 5% and a hit that takes you from 20% to 5%
     * must both trigger it, and only the first is a crossing.
     */
    onDamageTaken(run, p, params, state) {
      if (p.hpFraction < (params.threshold || 0.25)) fireCellGames(run, p, params, state);
    },
  },

  // --- stage relics (no resonance — they belong to a place, not a person) ---

  /** Neon Akiba — enemies you can SEE take +10%; hazards no longer obscure you. */
  neon_visor: {
    onRunStart(run, p, params) { p.flags.ignoreVisionHazard = true; },
    onTick(run, p, params) {
      p.flags.ignoreVisionHazard = true;
      p.flags.visibleDamageBonus = params.damageBonus || 0.10;
    },
    onHit(run, p, params, state, e) {
      if (!e || e.offscreen) return;
      // Applied as a small bonus hit rather than a stat, so it only ever affects
      // things actually on screen — which is the point of the relic.
      const bonus = (params.damageBonus || 0.10);
      if (bonus > 0 && !e.offscreen) e.st.vulnT = Math.max(e.st.vulnT, 0.1), e.st.vulnMult = Math.max(e.st.vulnMult, 1 + bonus);
    },
  },

  /** Wall Amaris — your escape travels 60% farther and damages. */
  anchor_gear: {
    onTick(run, p, params) {
      p.flags.escapeDistanceMult = 1 + (params.distanceBonus || 0.60);
      p.flags.escapeDamages = params.damage || 60;
    },
    /** The extra distance is read by the escape itself; this adds the damage. */
    onEscape(run, p, params, state) {
      const dmg = (params.damage || 60) * p.abilityDamageMultiplier();
      areaDamage(run, p.x, p.y, 70 * p.stats.areaMult, dmg, SRC.ESCAPE, { falloff: 0.2 });
      particles.ring(p.x, p.y, 10, '#c3ccdd', 240);
    },
  },

  /** Hidden Ember — the first hit you take every 10s is fully negated. */
  nine_seal_ward: {
    onInterval(run, p, params, state) {
      if (p.st.shieldHits < 1) {
        addShield(p.st, 1);
        state.up = true;
        particles.ring(p.x, p.y, 8, '#7bf59a', 140);
      }
    },
    onDamageTaken(run, p, params, state) {
      if (!state.up || p.st.shieldHits > 0) return;
      state.up = false;
      floaters.spawn(p.x, p.y - 42, 'WARDED', '#7bf59a', 16, 0.9);
    },
  },

  /** Endless Tatami Halls — killing an elite refunds all cooldowns. */
  everblade_fragment: {
    onEliteKill(run, p, params, state, e) {
      p.special.refill();
      p.escape.refill();
      floaters.spawn(p.x, p.y - 50, 'READY', '#ffd76a', 20, 1.1);
      audio.play('levelUp');
    },
  },

  /** Sunken Idol Reef — every 30s your NEXT attack crits for 400%. */
  abyssal_setlist: {
    onInterval(run, p, params, state) {
      p.flags.chargedCrit = params.damageMult || 4.0;
      p.flags.auraColor = '#5fd0ff';
      floaters.spawn(p.x, p.y - 44, 'HOLD IT…', '#5fd0ff', 18, 1.2);
    },
    onAutoAttack(run, p, params, state, shotIndex) {
      if (!p.flags.chargedCrit) return;
      // Consumed by the next auto; the ability layer reads the flag.
      run.scheduler.after(0.05, clearChargedCrit, p);
    },
  },
};

// Module-level helpers so no hook has to create a closure per call.
function applyMinionBonuses(p, params) {
  p.flags.minionCapBonus = params.capBonus || 3;
  p.flags.minionSpeedBonus = 1 + (params.attackSpeed || 0.25);
}

function evaluateSingularity(run, p, params, state) {
  const need = params.stacks || 6;
  const on = p.buffStacks >= need;
  if (on === !!state.on) return;
  state.on = on;
  if (on) {
    p.addBuff('singularity', 99999, { damageMult: params.damageBonus || 0.30 });
    p.flags.auraColor = '#ff2d95';
  } else {
    p.removeBuff('singularity');
    p.flags.auraColor = null;
  }
}

function fireCellGames(run, p, params, state) {
  if (state.cd !== undefined && run.time < state.cd) return;
  state.cd = run.time + (params.cooldown || 90);
  if (p.resourceMax > 0) p.addResource(p.resourceMax);
  else p.special.refill();
  p.st.invulnT = Math.max(p.st.invulnT, params.invuln || 2);
  flash.fire('#ffd34a', 0.6, 2);
  shake.big();
  floaters.spawn(p.x, p.y - 60, 'NOT YET', '#ffd34a', 30, 2.0);
}

function reFireAuto(run) {
  // The shot index is NOT advanced, so a doubled swing cannot itself trigger an
  // every-Nth relic and cascade into an infinite loop.
  run.fireExtraAuto();
}
function clearChargedCrit(p) { p.flags.chargedCrit = 0; p.flags.auraColor = null; }

const EMPTY = {};
export { RELIC_IMPL };
