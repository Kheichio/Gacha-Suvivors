// THE 8 EVOLUTIONS.
//
// SECTION 10: "Evolutions are dramatic, not incremental." Each one is registered
// as `evo_<id>` with an `apply(run, p, def)` that runs exactly once, the moment
// the evolution is granted (run.grantEvolution -> abilities.applyEvolution).
//
// Three shapes, and nothing else:
//   1. a FLAG the engine already reads          (dragonhide, zero cooldown)
//   2. a HOOK on the relic dispatch table       (barrage, railgun, feeding, edge)
//   3. a SUMMON                                 (full susanoo)
// The hooks go through `run.relicHooks.addEvolutionHook(name, fn, params)` —
// the same ~20 hook points the relics bind to — so an evolution is never a
// special case in the update loop and never needs its own timer.
//
// Every number is read from `def.params` and every colour from `def.visual`, so
// data/evolutions.js stays the single source of truth. Nothing here allocates in
// a per-frame or per-shot path: the option objects a hook needs are built ONCE,
// inside apply(), and mutated in place afterwards.

import { registerAll } from './index.js';
import * as H from './helpers.js';

/** Tag that caps the spectral warrior population at exactly one. */
const SUSANOO_TAG = 'susanoo';
/** Spirit is the one element that is neutral in both directions (elements.js). */
const EL_SPIRIT = 'spirit';
const NO_LIST = [];

registerAll({

  // ==========================================================================
  //  ENCORE BARRAGE — Extra Shot (max) + Hoshiyomi Penlight
  // ==========================================================================

  /**
   * "Every 4th auto-attack fires a full 360° ring of 16 projectiles."
   *
   * `onNthAutoAttack` is the hook the every-Nth family already uses (the boulder,
   * the double swing, the guaranteed crit), and it is fired with the shot index
   * immediately after the auto goes out — so the ring reads as part of the swing.
   */
  evo_encore_barrage: {
    apply(run, p, def) {
      const P = def.params;
      const everyNth = P.everyNthShot || 4;
      const count = P.ringCount || 16;
      p.flags.encoreBarrage = everyNth;
      p.flags.encoreBarrageCount = count;

      // Built once, here. The hook fires on a per-shot path and must not allocate.
      const shot = {
        damage: 0, speed: 0, life: 1.1, radius: 8, pierce: 1,
        element: p.def.element, owner: p, tag: 'encore_barrage',
        visual: def.visual, knockback: 40,
      };

      run.relicHooks.addEvolutionHook('onNthAutoAttack', (r, pl, params, state, shotIndex) => {
        if (shotIndex % everyNth !== 0) return;
        // The ring IS the auto-attack, so it carries the auto-attack's own damage.
        shot.damage = H.autoDamage(r, pl, pl.def.autoAttack.damage, null);
        shot.speed = H.projSpeed(pl, 420);
        shot.radius = H.area(pl, 8);
        shot.pierce = H.pierce(pl, 1);
        for (let i = 0; i < count; i++) {
          r.projectiles.fire(pl.x, pl.y, (i / count) * H.TAU, shot);
        }
        H.particles.ring(pl.x, pl.y, 20, def.visual.color, 420);
        H.audio.play('shoot');
        H.shake.small();
      });
    },
  },

  // ==========================================================================
  //  ORBITAL RAILGUN — Piercing Will (max) + Level 5 Clearance
  // ==========================================================================

  /**
   * "Every 6s a screen-wide beam drops from orbit for 220 damage. Pierces
   *  everything, 90px wide, aims itself down the busiest line."
   *
   * `onInterval` is the relic table's own repeating timer — it counts each
   * handler's resolved `interval` down in relicHooks.tick, which is the same
   * clock the chum bucket and the captain's rum run on. No new scheduler.
   */
  evo_orbital_railgun: {
    apply(run, p, def) {
      const P = def.params;
      p.flags.orbitalRailgun = true;

      // DECISIONS.md §16: the same spatial-hash line sweep the railgun auto-attack
      // uses. No new targeting mode is invented for this.
      const spec = { mode: P.targeting || 'lineDensest', range: 1400 };
      const hit = { knockback: 140 };
      const timer = { interval: P.interval || 6 };

      run.relicHooks.addEvolutionHook('onInterval', (r, pl) => {
        const t = H.target(r, pl, spec, null);
        const a = t.found ? t.angle : pl.facing;
        // "Screen-wide": longer than the visible world, so it always enters and
        // leaves off-screen. It is not something you aim, it is something that
        // happens to the arena.
        const len = Math.max(1800, H.camera.viewHalfW(240) * 2);
        const half = len * 0.5;
        const cx = Math.cos(a), cy = Math.sin(a);
        const x0 = pl.x - cx * half, y0 = pl.y - cy * half;
        const x1 = pl.x + cx * half, y1 = pl.y + cy * half;

        H.lineDamage(r, x0, y0, x1, y1, H.area(pl, (P.width || 90) * 0.5),
                     H.abilityDamage(r, pl, P.damage || 220), H.SRC.EVOLUTION, hit);
        r.beamOverlay(x0, y0, x1, y1, H.area(pl, P.width || 90), def.visual.color);
        H.particles.ring(pl.x, pl.y, 14, def.visual.color, H.area(pl, P.width || 90) * 2);
        H.particles.cone(pl.x, pl.y, a, 0.18, 8, def.visual.color,
                         { speed: 520, life: 0.3, additive: true });
        H.flash.fire(def.visual.color, 0.22, 6);
        H.shake.medium();
        H.audio.play('explode');
      }, timer);
    },
  },

  // ==========================================================================
  //  FEEDING GROUNDS — Bloodthirst (max) + Chum Bucket
  // ==========================================================================

  /**
   * "Enemies below 25% HP are executed on contact and heal you 1% max HP each,
   *  up to 15% per second. Bosses and elites are too big to swallow."
   *
   * The per-second heal budget is the reason this is survivable to design
   * against: 200 executable mobs in one screen would otherwise be a full heal
   * every frame, and the character would stop being killable at all.
   */
  evo_feeding_grounds: {
    apply(run, p, def) {
      const P = def.params;
      const threshold = P.executeThreshold || 0.25;
      p.flags.feedingGrounds = threshold;

      run.relicHooks.addEvolutionHook('onHit', (r, pl, params, state, e) => {
        if (!e || !e.active || e.hp <= 0) return;
        // params.excludeTypes: elite / midboss / boss — "too big to swallow".
        if (e.isElite || e.isBoss || e.isMidBoss) return;
        if (e.hp > e.maxHp * threshold) return;

        H.executeEnemy(r, e, 0, H.SRC.EVOLUTION);

        // Heal budget, tracked per whole second on the hook's own state object.
        const sec = Math.floor(r.time);
        if (state.sec !== sec) { state.sec = sec; state.healed = 0; }
        const cap = pl.maxHp * (P.healCapPerSec || 0.15);
        const want = pl.maxHp * (P.healPercentMaxHp || 0.01);
        const give = Math.min(want, cap - (state.healed || 0));
        if (give > 0) {
          state.healed = (state.healed || 0) + give;
          H.healPlayer(r, give, true);
        }
        H.particles.burst(e.x, e.y, 3, def.visual.color,
                          { speed: 150, life: 0.24, additive: true });
      });
    },
  },

  // ==========================================================================
  //  SUNLIT EDGE — Sharp Edge (max) + Nichirin Blade (Crimson)
  // ==========================================================================

  /**
   * "Stand still 1.0s and your next attack deals 8x damage and pierces every
   *  enemy it touches. If you already have a stand-still bonus this REPLACES it
   *  instead of stacking — you keep the bigger multiplier, not both."
   *
   * DECISIONS.md §12. Two halves, both generic:
   *   - the BREATH: charge `p.flags.breathCharged` off the engine's own stillness
   *     clock. The one character who already has a stand-still passive writes the
   *     same flag, so the two can never double-charge.
   *   - the CUT: an auto-attack that consumes the breath itself (it reads
   *     `p.flags.sunlitEdge` and takes max(8x, its own 2.2x) — never the product)
   *     leaves the flag false, and this hook does nothing. Every other character's
   *     auto ignores the flag, so the hook delivers the 8x piercing cut itself.
   *     That check is the flag's state, not anybody's id.
   */
  evo_sunlit_edge: {
    apply(run, p, def) {
      const P = def.params;
      const still = P.standStillTime || 1.0;
      const mult = P.damageMult || 8;
      p.flags.sunlitEdge = mult;
      p.flags.sunlitEdgeStillTime = still;
      p.flags.sunlitEdgePierceAll = P.piercesAll !== false;

      run.relicHooks.addEvolutionHook('onTick', (r, pl, params, state, dt) => {
        // p.stillT is the engine's stillness clock; it resets the frame you move.
        if (pl.stillT <= 0) {
          if (state.since !== 0) state.since = 0;
          if (pl.flags.breathCharged) pl.flags.breathCharged = false;
          return;
        }
        if (pl.flags.breathCharged) return;         // charged, waiting for the cut
        state.since = (state.since || 0) + dt;
        if (state.since < still) return;
        state.since = 0;
        pl.flags.breathCharged = true;
        H.particles.ring(pl.x, pl.y, 10, def.visual.color, 160);
        H.audio.play('telegraph');
      });

      // Built once. The cut fires at most once per auto-attack.
      const cut = {
        damage: 0, speed: 0, life: 0.9, radius: 22,
        pierce: P.piercesAll !== false ? 999 : H.pierce(p, 3),
        element: p.def.element, owner: p, tag: 'sunlit_edge',
        visual: def.visual, trailColor: def.visual.color, knockback: 120,
      };

      run.relicHooks.addEvolutionHook('onAutoAttack', (r, pl) => {
        if (pl.flags.breathCharged !== true) return;   // the swing already spent it
        const t = H.target(r, pl, pl.def.autoAttack.targeting, null);
        if (!t.found) return;                          // held, not wasted
        pl.flags.breathCharged = false;
        cut.damage = H.autoDamage(r, pl, pl.def.autoAttack.damage, null) * mult;
        cut.speed = H.projSpeed(pl, 520);
        cut.radius = H.area(pl, 22);
        r.projectiles.fire(pl.x, pl.y, t.angle, cut);
        H.particles.cone(pl.x, pl.y, t.angle, 0.5, 8, def.visual.color,
                         { speed: 340, life: 0.3, additive: true });
        H.floaters.spawn(pl.x, pl.y - 48, 'SUNLIT EDGE', def.visual.color, 18, 0.8);
        H.camera.punch(0.035, 0.25);
        H.audio.play('slash');
      });
    },
  },

  // ==========================================================================
  //  ZERO COOLDOWN — Quick Recovery (max) + Singularity Patch
  // ==========================================================================

  /**
   * "Your escape move comes back in 0.6s flat. Two escapes play by their own
   *  rules — the placed gate and the parry — and get -70% instead."
   *
   * DECISIONS.md §28: a literal zero is an infinite buff loop (an escape relic
   * that grants a buff on every press) and undefined behaviour for the two
   * escapes whose cooldown IS the mechanic. The floor lives in player.recompute()
   * and reads the number straight out of this evolution's params, so the card and
   * the code cannot drift. Escape CHARGES regenerate on the floored cooldown and
   * the cap stays 2 — that is a charge rule, not an evolution param.
   */
  evo_zero_cooldown: {
    apply(run, p, def) {
      const P = def.params;
      const exempt = P.exemptAbilities || NO_LIST;

      if (exempt.indexOf(p.def.escape.id) >= 0) {
        const scale = 1 - (P.exemptReduction || 0.7);
        p.flags.escapeCooldownScale = scale;
        // recompute() rewrites escape.duration from the character def every time a
        // buff, relic or upgrade lands, so the reduction is RE-ASSERTED rather than
        // set once — otherwise the next stat change would silently undo it.
        run.relicHooks.addEvolutionHook('onTick', (r, pl) => {
          const want = pl.def.escape.cooldown * pl.stats.cooldownMult * scale;
          if (pl.escape.duration !== want) pl.escape.configure(want);
        });
      } else {
        p.flags.zeroCooldown = true;
        p.flags.escapeCooldownFloor = P.cooldownFloor || 0.6;
      }
      p.recompute();
    },
  },

  // ==========================================================================
  //  DRAGONHIDE — Iron Body (max) + Crown of the World-Eater
  // ==========================================================================

  /**
   * "Any single hit worth less than 10% of your max HP does nothing at all.
   *  Not reduced. Nothing."
   *
   * The check lives in damage.js, at the one place the player's HP is written —
   * so it covers contact, projectiles, hazards, DoTs and boss attacks without any
   * of them knowing about it. A flag is the whole implementation.
   */
  evo_dragonhide: {
    apply(run, p, def) {
      p.flags.dragonhide = true;
      p.flags.dragonhideThreshold = def.params.ignoreThreshold || 0.10;
    },
  },

  // ==========================================================================
  //  PHOENIX HEART — Second Wind (max) + Ashes of the Eternal Encore
  // ==========================================================================

  /**
   * "One extra revive at 50% HP that detonates an 1100px nova for 500 damage and
   *  refills every cooldown. It counts toward the 3-revive cap and resolves LAST."
   *
   * DECISIONS.md §29: run.js owns the revive ORDER and the cap, and it already
   * detonates the nova and refills both cooldowns when this evolution is in
   * p.evolutions — it is a revive SOURCE, not an ability cast. So this sets the
   * flag, and the hook adds the callout and the ring the revive itself does not.
   * It deliberately does NOT deal damage a second time.
   */
  evo_phoenix_heart: {
    apply(run, p, def) {
      const P = def.params;
      p.flags.phoenixHeart = true;
      p.flags.phoenixNovaRadius = P.novaRadius || 1100;
      p.flags.phoenixNovaDamage = P.novaDamage || 500;

      run.relicHooks.addEvolutionHook('onRevive', (r, pl) => {
        if (P.refillCooldowns !== false) { pl.special.refill(); pl.escape.refill(); }
        H.particles.ring(pl.x, pl.y, 44, def.visual.color, (P.novaRadius || 1100) * 0.9);
        H.particles.burst(pl.x, pl.y, 20, def.visual.accent,
                          { speed: 420, life: 0.7, size: 1.1, additive: true });
        H.grade(r, def.visual.color, 0.55, 0.8);
        H.announce(r, def.name, def.visual.color);
        H.camera.punch(0.08, 0.5);
        H.audio.play('special');
      });
    },
  },

  // ==========================================================================
  //  FULL SUSANOO — Guardian Plate (max) + Susanoo Fragment
  // ==========================================================================

  /**
   * "The ribcage stands all the way up. A permanent spectral warrior blocks one
   *  hit every 4s and cuts anything within 140px for 60 damage every 1.2s. It
   *  counts as a MINION — anything that pays you for fighting alone switches off."
   *
   * DECISIONS.md §27: `isMinion: true`, out loud. It benefits from minion buffs
   * and it genuinely switches off the "fight alone" passive. That build tension is
   * intentional and it is written on the card rather than hidden.
   *
   * The GUARD role in minion.js already owns the behaviour — orbit, block every
   * `blockInterval`, swing on `attackInterval` — so this only has to declare the
   * warrior and keep it standing. Its cut is the role's own 110px cone thrown
   * from a warrior orbiting 62px off your shoulder, which is where the recipe's
   * 140px of reach lives: the role owns the shape, the data owns the numbers it
   * can set (60 damage, every 1.2s).
   */
  evo_full_susanoo: {
    apply(run, p, def) {
      const P = def.params;
      p.flags.fullSusanoo = true;

      const warrior = {
        role: H.MINION_ROLE.GUARD,
        isMinion: P.isMinion !== false,
        hp: 99999,                       // "permanent" — it is not meant to die
        damage: P.meleeDamage || 60,
        attackInterval: (P.swingInterval || 1.2) / (p.flags.minionSpeedBonus || 1),
        orbitRadius: 62,
        speed: 210,
        element: EL_SPIRIT,
        tag: SUSANOO_TAG,
        max: 1,
        visual: def.visual,
      };

      H.summon(run, p, p.x + 60, p.y, warrior);

      // A watchdog on the block cadence: if the warrior is ever gone — killed by
      // an area attack, evicted by a summoner build at the minion cap — it stands
      // back up. "Permanent" has to survive contact with the pool.
      run.relicHooks.addEvolutionHook('onInterval', (r, pl) => {
        if (r.minions.countTag(SUSANOO_TAG) > 0) return;
        // A minion attack-speed relic can be picked up long after the evolution.
        warrior.attackInterval = (P.swingInterval || 1.2) / (pl.flags.minionSpeedBonus || 1);
        H.summon(r, pl, pl.x + 60, pl.y, warrior);
      }, { interval: P.blockInterval || 4 });
    },
  },
});
