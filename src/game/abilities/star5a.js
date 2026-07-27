// FIVE-STAR ROSTER, PART A — the sword-and-storm four.
//
// Sixteen entries: four pillars each for the Breathing Swordsman, the Lone Ronin,
// the Deep-Sea VTuber and the Electromaster. Nothing here knows a character id;
// the registry key IS the branch, and the driver hands each entry its own `ctx`.
//
// Every number is SECTION 4's, read off `ctx.def` wherever src/data carries it so
// a balance pass edits the data and never has to come back in here.
//
// ALLOCATION RULE: fire() and tick() run every frame. Every options object,
// visual descriptor, targeting spec and iteration callback used by one of them is
// declared once at module load below and mutated in place. Only cast()/end() —
// which run at most a few times a minute — pass fresh literals.

import { registerAll } from './index.js';
import * as H from './helpers.js';

// --- palettes ----------------------------------------------------------------
// Water Breathing blue, and the Sun Breathing orange it becomes.
const C_WATER = '#5fd0ff';
const C_WATER_DEEP = '#1b5e7a';
const C_SUN = '#ff7a3d';
const C_SUNLIGHT = '#ffd76a';
// Vagabond ink-wash: heavy blacks, one red accent for blood.
const C_INK = '#2a2622';
const C_BLADE = '#e8ecf2';
const C_BLOOD = '#b0271f';
const C_VOID = '#0d0c0b';
// Deep-sea idol.
const C_SHARK = '#5fd6ff';
const C_ABYSS = '#0b3d5c';
// Railgun orange, arc-lightning cyan, iron sand.
const C_RAIL = '#e8862c';
const C_ARC = '#7ad9ff';
const C_SAND = '#6b6257';

// --- elements (DECISIONS.md §26 — element is real, not flavour) --------------
const EL_WATER = 'water';
const EL_FIRE = 'fire';
const EL_STEEL = 'steel';
const EL_LIGHTNING = 'lightning';

// --- strike tags exposed on ctx for the upgrades that touch only one ----------
const STRIKE_LONG = 'long';
const STRIKE_SHORT = 'short';

// --- visuals (hoisted: the atlas caches by descriptor, and fire() may not allocate)
const V_WAVE_WATER = { shape: 'crescent', color: C_WATER, accent: C_WATER_DEEP, size: 16, rotates: true, glow: true };
const V_WAVE_SUN = { shape: 'crescent', color: C_SUN, accent: C_SUNLIGHT, size: 16, rotates: true, glow: true };
const V_WAVE_BREATH = { shape: 'crescent', color: C_SUNLIGHT, accent: C_SUN, size: 22, rotates: true, glow: true };
const V_REFLECT = { shape: 'diamond', color: C_RAIL, accent: C_ARC, size: 7, rotates: true, glow: true };

// --- targeting specs ---------------------------------------------------------
const SPEC_CLUSTER = { mode: 'densestCluster', range: 620 };
const SPEC_MELEE = { mode: 'nearest', range: 150 };
const SPEC_CHAIN = { mode: 'nearestN', count: 5, range: 460 };
const SPEC_AIM = { mode: 'mouseAim', range: 600 };

// --- reusable option records -------------------------------------------------
const WAVE = {
  damage: 0, speed: 520, life: 0.35, radius: 15, pierce: 3,
  motion: H.MOTION.STRAIGHT, element: EL_WATER, visual: V_WAVE_WATER,
  trailColor: C_WATER, tag: 'wave',
};
const WHEEL = { damage: 0, width: 46, src: H.SRC.ESCAPE, element: EL_WATER, color: C_WATER, knockback: 140 };
const HEAL_TRAIL = { hitsPlayer: true, hitsEnemies: false };
const FIRE_RING = { falloff: 0, element: EL_FIRE, knockback: 90, onHit: igniteHit };
const FLAME_DRIFT = { life: 0.5, size: 0.7, speed: 40, additive: true };

const LONG_CUT = { element: EL_STEEL, knockback: 150, crit: false, color: C_BLADE, src: H.SRC.AUTO };
const THRUST = { element: EL_STEEL, knockback: 60, crit: false, maxTargets: 4 };
const THRUST_SPARK = { speed: 300, life: 0.14, size: 0.34 };
const CRESCENT = { element: EL_STEEL, knockback: 260 };
const COUNTER = { element: EL_STEEL, knockback: 900, color: C_BLADE, falloff: 0, src: H.SRC.ESCAPE };
const STEP = { color: C_BLADE, src: H.SRC.ESCAPE };
const DOKKODO_MODS = { damageMult: 0.30, dodge: 0.15 };

const RIP = { damage: 0, width: 54, src: H.SRC.ESCAPE, element: EL_WATER, color: C_SHARK, knockback: 0 };

const BEAM = { element: EL_LIGHTNING, knockback: 40, crit: false, onHit: null };
const RAIL_BONUS = { canCrit: false, knockback: 0, noNumber: true, element: EL_LIGHTNING };
const ION_SPARK = { color: C_ARC, life: 0.26, size: 0.5, sizeEnd: 0.05, drag: 3, additive: true };
const COIN = { speed: 260, life: 0.22, size: 0.5 };
const SAND_TICK = { falloff: 0, element: EL_STEEL, knockback: 0 };
const SAND_DRIFT = { life: 0.6, size: 0.5, speed: 30 };
const REPULSE = { element: EL_LIGHTNING, knockback: 900, color: C_ARC, falloff: 0, src: H.SRC.ESCAPE };
const REFLECT = { damage: 0, speed: 0, life: 2.2, radius: 7, pierce: 1, element: EL_LIGHTNING, visual: V_REFLECT, owner: null, trailColor: C_RAIL };
const ARC_HIT = { element: EL_LIGHTNING, knockback: 30, canCrit: true };

/**
 * The one mutable scratch record shared by the module-level callbacks below.
 * Iteration callbacks may not be closures (a closure per call is an allocation),
 * so the data they need is parked here immediately before the iteration starts.
 */
const S = {
  run: null, p: null, x: 0, y: 0, a: 0, n: 0,
  hit: false, dps: 0, dmg: 0, bleed: false, hits: 0, per: 0,
};

registerAll({
  // ==========================================================================
  //  RIN — Breath of the Rising Sun.  Water, until the Sun Breathing lands.
  // ==========================================================================

  water_surface_slash: {
    // "First Form: Water Surface Slash": a flowing crescent wave that travels
    //  180px and pierces 3, 30 damage, every 0.7s. The slash trail is a painted
    //  water ribbon. Targeting: facing (auto-turns to nearest).
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;

      // TOTAL CONCENTRATION BREATHING charged this swing (see the passive).
      // Only HIS swing spends the breath — a mirroring clone does not eat it.
      // DECISIONS.md §12: SUNLIT EDGE REPLACES the passive's bonus — take the
      // max of 8x and 2.2x, never the product.
      const charged = p.flags.breathCharged === true && o === p;
      const mult = charged ? (p.flags.sunlitEdge ? 8 : 2.2) : 1;
      // HINOKAMI KAGURA converts him to fire for its duration (DECISIONS.md §26).
      const burning = p.flags.elementOverride === EL_FIRE;

      WAVE.damage = H.autoDamage(run, p, ctx.def.damage, opts) * mult;
      WAVE.pierce = charged ? 999 : 3;            // "pierces infinitely"
      WAVE.element = burning ? EL_FIRE : EL_WATER;
      WAVE.visual = charged ? V_WAVE_BREATH : burning ? V_WAVE_SUN : V_WAVE_WATER;
      WAVE.trailColor = charged ? C_SUNLIGHT : burning ? C_SUN : C_WATER;
      WAVE.radius = charged ? 22 : 15;
      H.spread(run, p, o.x, o.y, t.angle, 1, 0, WAVE);

      if (charged) {
        p.flags.breathCharged = false;            // spent on THIS swing only
        H.particles.ring(o.x, o.y, 12, C_SUNLIGHT, 300);
        H.floaters.spawn(o.x, o.y - 48, 'BREATH', C_SUNLIGHT, 18, 0.7);
        H.camera.punch(0.03, 0.25);
      }
      H.audio.play('slash');
    },
  },

  hinokami_kagura: {
    // "HINOKAMI KAGURA: DANCE OF THE FIRE GOD" (24s): he drops into the Sun
    //  Breathing stance and performs a spinning circular dance for 3s, carving
    //  overlapping rings of flame around himself (25 damage per tick, 8 ticks,
    //  240px radius). Unstoppable — immune to knockback and slows — and
    //  everything hit BURNS for 4s. Screen shifts to orange firelight.
    //  S3: lasts 5s and pulls enemies inward.
    cast(run, p, ctx) {
      ctx.active = true;
      ctx.t = ctx.s3 ? 5 : 3;
      ctx.tickT = 0;
      ctx.spin = 0;
      // The whole palette goes blue -> orange. That arc IS the character.
      ctx.prevAura = p.flags.auraColor || null;
      p.flags.auraColor = C_SUN;
      p.flags.elementOverride = EL_FIRE;
      p.flags.ccImmune = true;                    // UNSTOPPABLE — honoured in tick()
      H.grade(run, C_SUN, 0.45, ctx.t);           // firelight for the whole dance
      H.announce(run, 'HINOKAMI KAGURA', C_SUN);
      H.camera.punch(0.08, 0.5);
      H.shake.medium();
      ctx.pull = null;
      if (ctx.s3) {
        // The dance drags the arena into itself. A field, not a minion (§27).
        // It is dragged along with him by tick() — hazard fields only auto-follow
        // pooled entities, and the player is not one.
        ctx.pull = H.field(run, p, p.x, p.y, 240, ctx.t, 'pull', 0, C_SUN,
                           { param: 210, hitsEnemies: true });
      }
    },
    tick(run, p, ctx, dt) {
      // Unstoppable, literally: knockback never reaches him (p.flags.ccImmune is
      // the general contract) and a slow is wiped the frame it lands.
      if (p.st.slowT > 0) { p.st.slowT = 0; p.st.slowMult = 1; }
      if (ctx.pull && ctx.pull.active) { ctx.pull.x = p.x; ctx.pull.y = p.y; }

      ctx.spin += dt * 11;
      const r = H.area(p, 240);
      // Two embers a frame trace the spin — pooled, so this allocates nothing.
      H.particles.drift(p.x + Math.cos(ctx.spin) * r * 0.9,
                        p.y + Math.sin(ctx.spin) * r * 0.9, C_SUN, FLAME_DRIFT);
      H.particles.drift(p.x + Math.cos(ctx.spin + 3.14) * r * 0.6,
                        p.y + Math.sin(ctx.spin + 3.14) * r * 0.6, C_SUNLIGHT, FLAME_DRIFT);

      // 8 ticks across the base 3s dance. S3 keeps the cadence and dances longer.
      ctx.tickT -= dt;
      if (ctx.tickT > 0) return;
      ctx.tickT = 0.375;

      const dmg = H.abilityDamage(run, p, 25);
      S.dps = dmg * 0.3;                          // the 4s burn, scaled off the tick
      H.areaDamage(run, p.x, p.y, r, dmg, H.SRC.SPECIAL, FIRE_RING);
      run.ringOverlay(p.x, p.y, r, C_SUN);
      H.particles.ring(p.x, p.y, 18, C_SUN, r * 3.2);
      H.shake.small();
      H.audio.play('slash');
    },
    end(run, p, ctx) {
      // Back to water. Restore, never assume — a relic may own the aura.
      p.flags.auraColor = ctx.prevAura;
      p.flags.elementOverride = null;
      p.flags.ccImmune = false;
      ctx.pull = null;
      H.grade(run, C_WATER, 0.25, 0.6);
      H.particles.ring(p.x, p.y, 20, C_WATER, 420);
    },
  },

  water_wheel: {
    // "Second Form: Water Wheel" (5s): a forward cartwheel dash 200px with full
    //  i-frames, carving a vertical water wheel that damages (45) along the
    //  entire path.
    //  S5: 2 charges (player.recompute already configures them at star 5) and a
    //  healing water trail — 3 HP/s for 4s (src/data/characters.js).
    cast(run, p, ctx) {
      const dist = 200 * (p.flags.escapeDistanceMult || 1);
      // Forward while he is moving; standing still, the wheel carries him out of
      // whatever has closed around him. An escape has to escape a full surround.
      let a = p.facing;
      if (p.movingT <= 0) {
        const t = H.target(run, p, SPEC_CLUSTER);
        if (t.found) a = t.angle + Math.PI;
      }
      WHEEL.damage = H.abilityDamage(run, p, 45) + (p.flags.escapeDamages || 0);
      const d = H.dash(run, p, a, dist, ctx.def.iframes, WHEEL);

      // The wheel itself: a spinning ribbon of water down the whole path.
      run.beamOverlay(d.x0, d.y0, d.x1, d.y1, H.area(p, 46), C_WATER);
      H.particles.ring(d.x1, d.y1, 12, C_WATER, 280);
      H.camera.punch(0.03, 0.25);

      if (ctx.s5) {
        H.field(run, p, (d.x0 + d.x1) * 0.5, (d.y0 + d.y1) * 0.5,
                dist * 0.5 + 40, 4, 'heal', 3, C_WATER, HEAL_TRAIL);
        H.floaters.spawn(p.x, p.y - 40, 'STILL WATER', C_WATER, 16, 1.0);
      }
    },
  },

  total_concentration: {
    // "Total Concentration Breathing": standing still for 1.0s makes the NEXT
    //  auto attack deal +120% damage and pierce infinitely. Hold still. Breathe.
    //  Swing.  (The swing itself, and DECISIONS.md §12's SUNLIT EDGE override,
    //  live in the auto-attack — this half only owns the breath.)
    init(run, p, ctx) {
      ctx.since = 0;
      p.flags.breathCharged = false;
    },
    tick(run, p, ctx, dt) {
      // p.stillT is the engine's stillness clock; it resets to 0 the frame he
      // moves. The local timer is what lets him re-charge without stepping.
      if (p.stillT <= 0) {
        if (ctx.since !== 0) ctx.since = 0;
        if (p.flags.breathCharged) p.flags.breathCharged = false;
        return;
      }
      if (p.flags.breathCharged) return;          // charged, waiting for the swing
      ctx.since += dt;
      if (ctx.since < 1.0) return;
      ctx.since = 0;
      p.flags.breathCharged = true;
      H.particles.ring(p.x, p.y, 10, C_SUNLIGHT, 150);
      H.audio.play('telegraph');
    },
  },

  // ==========================================================================
  //  NITEN — The Sword Saint.  Two swords, one guard, and nobody beside him.
  // ==========================================================================

  niten_ichiryu: {
    // "Niten Ichi-ryū": alternates two distinct strikes. Odd swings are the LONG
    //  SWORD — a wide 150° arc, 26 damage, 110px reach. Even swings are the SHORT
    //  SWORD — a fast forward thrust, 18 damage, pierces 3, 70px. Every 0.6s.
    //  The alternation is visible and audible, and several upgrades in the pool
    //  interact with only one of the two. Targeting: facing.
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      const crit = !!p.flags.guaranteedCrit;      // "Two Heavens As One"

      ctx.swing = (ctx.swing | 0) + 1;
      const long = (ctx.swing & 1) === 1;
      // Which sword actually fired, for the upgrades that only touch one.
      ctx.lastStrike = long ? STRIKE_LONG : STRIKE_SHORT;

      if (long) {
        LONG_CUT.crit = crit;
        H.meleeArc(run, p, o.x, o.y, t.angle, 2.6179939, 110,
                   H.autoDamage(run, p, ctx.def.damage, opts), LONG_CUT);
        H.camera.punch(0.015, 0.14);
        return;
      }

      // The short sword: a thrust, not a sweep. Narrow, fast, and red.
      const reach = H.area(p, 70);
      THRUST.crit = crit;
      THRUST.maxTargets = H.pierce(p, 3) + 1;
      H.coneDamage(run, o.x, o.y, t.angle, 0.42, reach,
                   H.autoDamage(run, p, 18, opts), H.SRC.AUTO, THRUST);
      run.wedgeOverlay(o.x, o.y, reach, t.angle - 0.21, t.angle + 0.21, C_BLOOD);
      H.particles.cone(o.x, o.y, t.angle, 0.3, 5, C_BLOOD, THRUST_SPARK);
      H.audio.play('shoot');
    },
  },

  battle_of_ichijoji: {
    // "THE BATTLE OF ICHIJŌJI" (28s): he plants himself and enters a counter-
    //  stance for 6s. Every enemy that enters melee range is cut down
    //  automatically — one clean instant strike per enemy, 90 damage, with a
    //  crescent slash that carries 200px beyond them. He cannot move during it
    //  and takes 50% reduced damage.
    //  S3: lasts 9s and he can walk at half speed during it.
    cast(run, p, ctx) {
      ctx.active = true;
      ctx.t = ctx.s3 ? 9 : 6;
      ctx.strikeT = 0;
      ctx.prevAura = p.flags.auraColor || null;
      p.flags.auraColor = C_BLOOD;
      if (ctx.s3) p.flags.moveSpeedMult = 0.5; else p.flags.rooted = true;
      // The damage path reads this multiplier; end() puts it back at 1.
      p.flags.damageTakenMult = 0.5;
      H.grade(run, C_INK, 0.5, 0.7);
      H.announce(run, 'THE BATTLE OF ICHIJŌJI', C_BLOOD);
      H.camera.punch(0.07, 0.5);
      H.shake.medium();
      H.particles.ring(p.x, p.y, 20, C_BLADE, 340);
    },
    tick(run, p, ctx, dt) {
      // The stance itself, drawn every frame: this circle is the promise.
      const range = H.area(p, 150);
      run.ringOverlay(p.x, p.y, range, C_BLOOD);

      ctx.strikeT -= dt;
      if (ctx.strikeT > 0) return;
      SPEC_MELEE.range = range;
      const t = H.target(run, p, SPEC_MELEE);
      if (!t.found) return;
      ctx.strikeT = 0.12;                         // one clean strike at a time

      // The crescent carries 200px BEYOND the man it cut.
      const d = Math.sqrt(H.dist2(p.x, p.y, t.x, t.y));
      const x1 = p.x + Math.cos(t.angle) * (d + H.area(p, 200));
      const y1 = p.y + Math.sin(t.angle) * (d + H.area(p, 200));
      H.lineDamage(run, p.x, p.y, x1, y1, H.area(p, 26),
                   H.abilityDamage(run, p, 90), H.SRC.SPECIAL, CRESCENT);
      run.beamOverlay(p.x, p.y, x1, y1, H.area(p, 22), C_BLADE);
      H.particles.cone(p.x, p.y, t.angle, 0.5, 4, C_BLOOD, THRUST_SPARK);
      H.audio.play('slash');
      H.shake.small();
    },
    end(run, p, ctx) {
      p.flags.auraColor = ctx.prevAura;
      // Put back only what the stance took.
      if (ctx.s3) p.flags.moveSpeedMult = 1; else p.flags.rooted = false;
      p.flags.damageTakenMult = 1;
      H.particles.ring(p.x, p.y, 14, C_INK, 260);
    },
  },

  the_void: {
    // "The Void" (7s): a 0.4s PARRY WINDOW, not a dash. If he is struck during
    //  the window he takes zero damage, and releases a 360° counter for 200
    //  damage with full knockback. If nothing hits him, he simply steps 120px and
    //  the cooldown is halved.
    //  S5: the window widens to 0.7s and a successful parry fully refunds it.
    cast(run, p, ctx) {
      const w = ctx.s5 ? 0.7 : (ctx.def.iframes || 0.4);
      ctx.active = true;
      ctx.t = w;
      ctx.window = w;
      ctx.parried = false;
      // The damage path's own witness: if anything gets through the i-frames,
      // this number moves and the guard counts as struck.
      ctx.dmgMark = run.stats.damageTaken;
      ctx.parryUntil = run.time + w;
      p.flags.parryWindow = w;
      p.flags.parryActive = true;
      H.applyInvuln(p.st, w);                     // "takes zero damage"
      H.grade(run, C_VOID, 0.3, 0.35);
      H.announce(run, 'THE VOID', C_BLADE);
      H.particles.ring(p.x, p.y, 12, C_BLADE, 200);
      H.audio.play('telegraph');
    },
    tick(run, p, ctx, dt) {
      if (ctx.parried) return;
      // Struck = either the damage path fired, or something is inside the guard.
      let struck = run.stats.damageTaken > ctx.dmgMark;
      if (!struck) struck = guardTouched(run, p);
      if (!struck) return;

      ctx.parried = true;
      H.nova(run, p, p.x, p.y, 220, H.abilityDamage(run, p, 200), COUNTER);
      run.ringOverlay(p.x, p.y, H.area(p, 220), C_BLADE);
      H.grade(run, C_BLADE, 0.55, 0.3);
      H.announce(run, 'PARRY', C_BLOOD);
      H.camera.punch(0.09, 0.35);
      H.shake.big();
      H.audio.play('crit');
    },
    end(run, p, ctx) {
      p.flags.parryActive = false;
      p.flags.parryWindow = 0;
      if (ctx.parried) {
        // Perfect reads mean a permanent guard.
        if (ctx.s5) { p.escape.refill(); H.floaters.spawn(p.x, p.y - 54, 'THE VOID', C_BLADE, 18, 1.0); }
        return;
      }
      // Nothing came. He simply steps — and the cooldown is halved.
      let a = p.facing;
      const t = H.target(run, p, SPEC_CLUSTER);
      if (t.found) a = t.angle + Math.PI;
      H.dash(run, p, a, 120 * (p.flags.escapeDistanceMult || 1), 0.15, STEP);
      p.escape.reduce(p.escape.duration * 0.5);
    },
  },

  dokkodo: {
    // "Dokkōdō (The Way of Walking Alone)": +30% damage and +15% dodge while you
    //  have no active minions, clones or summons.
    //  DECISIONS.md §27: only entities declaring isMinion:true suppress it —
    //  decoys, rifts, chum piles, torii gates and burning ground are props.
    init(run, p, ctx) {
      ctx.poll = 0;
      ctx.alone = false;
    },
    tick(run, p, ctx, dt) {
      ctx.poll -= dt;
      if (ctx.poll > 0) return;
      ctx.poll = 0.25;
      const alone = run.minions.minionCount === 0;
      if (alone === ctx.alone) return;
      ctx.alone = alone;
      if (alone) {
        p.addBuff('dokkodo', 1e9, DOKKODO_MODS);
        H.particles.ring(p.x, p.y, 8, C_INK, 140);
      } else {
        p.removeBuff('dokkodo');
      }
    },
  },

  // ==========================================================================
  //  SHIRO SAME — The Sharkbite Idol.
  // ==========================================================================

  bubble_bullets: {
    // "A fan of 5 bubbles that drift, then POP into 3 shrapnel shards each.
    //  10 damage per bubble, 7 per shard. Every 0.9s. Targeting: densestCluster."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      const dmg = H.autoDamage(run, p, ctx.def.damage, opts);
      H.spread(run, p, o.x, o.y, t.angle, 5, 0.9, {
        damage: dmg,
        speed: 300, life: 1.4, radius: 9,
        motion: H.MOTION.DRIFT_POP,
        popTime: 0.55, popCount: 3,
        splitDamage: dmg * 0.7,          // 7 per shard against 10 per bubble
        element: 'water',
        visual: { shape: 'circle', color: '#5fd6ff', accent: '#0b3d5c',
                  size: 9, glow: true },
      });
      H.audio.play('shoot');
    },
  },

  feeding_frenzy: {
    // "Submerges into a shadow fin and dashes through the arena 6 times over 4s,
    //  each dash dealing 80 damage in a wide line and healing 5 HP per enemy hit.
    //  Invulnerable throughout."   S3: +3 dashes and a whirlpool at the end.
    cast(run, p, ctx) {
      ctx.active = true;
      ctx.t = 4;
      ctx.dashes = ctx.s3 ? 9 : 6;
      ctx.done = 0;
      ctx.next = 0;
      H.applyInvuln(p.st, 4.1);
      H.grade(run, '#0b3d5c', 0.3, 0.5);
      H.announce(run, 'FEEDING FRENZY', '#5fd6ff');
      H.camera.punch(0.06, 0.4);
    },
    tick(run, p, ctx, dt) {
      ctx.next -= dt;
      if (ctx.next > 0 || ctx.done >= ctx.dashes) return;
      ctx.next = 4 / ctx.dashes;
      ctx.done++;
      const t = H.target(run, p, { mode: 'densestCluster', range: 700 });
      const a = t.found ? t.angle : p.facing;
      let healed = 0;
      H.dash(run, p, a, 260, 0.5, {
        damage: H.abilityDamage(run, p, 80),
        width: 46, element: 'water', src: H.SRC.SPECIAL, color: '#5fd6ff',
      });
      H.forEachEnemyIn(run, p.x, p.y, 90, () => { healed++; });
      if (healed) H.healPlayer(run, healed * 5);
      H.shake.small();
    },
    end(run, p, ctx) {
      if (!ctx.s3) return;
      H.field(run, p, p.x, p.y, 160, 5, 'pull', 0, '#5fd6ff',
              { param: 220, hitsEnemies: true });
      H.announce(run, 'WHIRLPOOL', '#5fd6ff');
    },
  },

  riptide: {
    // "Riptide" (6s): dashes 210px, dragging every enemy she passes along behind
    //  her, then flinging them. Sets up combos with AoE.
    //  S5: applies BLEED (2% max HP/s for 4s) to everything it drags.
    cast(run, p, ctx) {
      const dist = 210 * (p.flags.escapeDistanceMult || 1);
      let a = p.facing;
      if (p.movingT <= 0) {
        const t = H.target(run, p, SPEC_CLUSTER);
        if (t.found) a = t.angle + Math.PI;
      }
      const x0 = p.x, y0 = p.y;
      RIP.damage = p.flags.escapeDamages || 0;    // 0 unless a relic says otherwise
      const d = H.dash(run, p, a, dist, ctx.def.iframes, RIP);

      // The undertow: everything the wake touched is dragged in behind her and
      // then flung forward in one pile.
      S.run = run; S.x = d.x1; S.y = d.y1; S.a = a; S.n = 0;
      S.bleed = !!ctx.s5;
      H.forEachEnemyIn(run, (x0 + d.x1) * 0.5, (y0 + d.y1) * 0.5,
                       dist * 0.5 + 90, dragEnemy);

      run.beamOverlay(x0, y0, d.x1, d.y1, H.area(p, 54), C_SHARK);
      H.particles.ring(d.x1, d.y1, 14, C_SHARK, 320);
      if (S.n > 0) H.floaters.spawn(d.x1, d.y1 - 40, 'RIPTIDE', C_SHARK, 18, 0.9);
      H.camera.punch(0.04, 0.3);
    },
  },

  blood_in_the_water: {
    // "Blood in the Water": +35% damage to enemies below 40% HP.
    //  Applied as VULNERABLE on the wounded rather than as a stat on her, so it
    //  reads on the target where the player can see it and never needs a special
    //  case inside dealDamage.
    init(run, p, ctx) {
      ctx.poll = 0;
    },
    tick(run, p, ctx, dt) {
      ctx.poll -= dt;
      if (ctx.poll > 0) return;
      ctx.poll = 0.2;
      H.forEachEnemyIn(run, p.x, p.y, 760, markWounded);
    },
  },

  // ==========================================================================
  //  REIKA — The Level 5 Railgun Esper.  All of it is electromagnetism.
  // ==========================================================================

  railgun: {
    // "Coin Flick / RAILGUN": flips a coin, then fires a hitscan orange beam that
    //  pierces EVERYTHING across the full screen. 85 damage. Slow: every 1.6s.
    //  The beam leaves an ionised trail that arcs for 1s.
    //  Targeting: the line through the most enemies (spatial-hash line sweep).
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;

      // "Across the full screen" — the on-screen diagonal, not an arbitrary range.
      const reach = Math.hypot(run.camera.viewHalfW(80), run.camera.viewHalfH(80));
      const x1 = o.x + Math.cos(t.angle) * reach;
      const y1 = o.y + Math.sin(t.angle) * reach;
      const dmg = H.autoDamage(run, p, ctx.def.damage, opts);

      // "Level 5 Clearance": +12% per enemy already pierced. A hitscan beam has
      // no projectile to accumulate it, so the escalation is paid out per hit.
      S.run = run; S.hits = 0; S.dmg = dmg;
      S.per = p.flags.pierceBonusPerHit || 0;
      BEAM.crit = !!p.flags.guaranteedCrit;
      BEAM.onHit = S.per > 0 ? railClearance : null;
      H.lineDamage(run, o.x, o.y, x1, y1, H.area(p, 22), dmg, H.SRC.AUTO, BEAM);

      // The coin, then the beam, then the arc that hangs in the air for a second.
      H.particles.cone(o.x, o.y, t.angle, 0.3, 8, C_SUNLIGHT, COIN);
      run.beamOverlay(o.x, o.y, x1, y1, H.area(p, 26), C_RAIL);
      ctx.bx0 = o.x; ctx.by0 = o.y; ctx.bx1 = x1; ctx.by1 = y1; ctx.ionStep = 0;
      for (let i = 1; i <= 5; i++) run.scheduler.after(i * 0.18, ionTrail, ctx, run);

      H.audio.play('shoot');
      H.shake.small();
      H.camera.punch(0.025, 0.2);
    },
  },

  iron_sand_storm: {
    // "IRON SAND STORM" (28s): a swirling magnetic sand vortex (220px) at the
    //  cursor for 6s. Ticks 30 damage every 0.3s and pulls enemies inward.
    //  S3: creates a second, smaller vortex on expiry.
    cast(run, p, ctx) {
      // DECISIONS.md §17: mouseAim already resolved mouse / pad / touch / auto.
      const t = H.target(run, p, SPEC_AIM);
      ctx.active = true;
      ctx.t = 6;
      ctx.tickT = 0;
      ctx.spin = 0;
      ctx.radius = 220;
      ctx.second = false;
      ctx.vx = t.x; ctx.vy = t.y;
      H.field(run, p, ctx.vx, ctx.vy, ctx.radius, ctx.t, 'pull', 0, C_SAND,
              { param: 250, hitsEnemies: true });
      H.grade(run, C_SAND, 0.35, 0.6);
      H.announce(run, 'IRON SAND STORM', C_RAIL);
      H.camera.punch(0.05, 0.4);
      H.shake.medium();
    },
    tick(run, p, ctx, dt) {
      ctx.spin += dt * 7;
      const r = H.area(p, ctx.radius);
      // Sand orbiting the eye of the vortex.
      H.particles.drift(ctx.vx + Math.cos(ctx.spin) * r * 0.85,
                        ctx.vy + Math.sin(ctx.spin) * r * 0.85, C_SAND, SAND_DRIFT);
      H.particles.drift(ctx.vx + Math.cos(-ctx.spin * 1.3) * r * 0.55,
                        ctx.vy + Math.sin(-ctx.spin * 1.3) * r * 0.55, C_RAIL, SAND_DRIFT);
      run.ringOverlay(ctx.vx, ctx.vy, r, C_SAND);

      ctx.tickT -= dt;
      if (ctx.tickT > 0) return;
      ctx.tickT = 0.3;
      H.areaDamage(run, ctx.vx, ctx.vy, r, H.abilityDamage(run, p, 30),
                   H.SRC.SPECIAL, SAND_TICK);
      H.particles.ring(ctx.vx, ctx.vy, 8, C_RAIL, r * 1.6);
    },
    end(run, p, ctx) {
      H.particles.burst(ctx.vx, ctx.vy, 12, C_SAND, SAND_DRIFT);
      if (!ctx.s3 || ctx.second) return;
      // The collapse throws a second, smaller vortex. Restarting from end() is
      // legal: the driver clears ctx.active before calling us, so setting it
      // again simply hands the ability another life.
      ctx.second = true;
      ctx.active = true;
      ctx.t = 3;
      ctx.tickT = 0;
      ctx.radius = 132;                            // 60% of the first
      H.field(run, p, ctx.vx, ctx.vy, ctx.radius, ctx.t, 'pull', 0, C_SAND,
              { param: 250, hitsEnemies: true });
      H.floaters.spawn(ctx.vx, ctx.vy - 40, 'COLLAPSE', C_RAIL, 18, 1.0);
    },
  },

  magnetic_repulsion: {
    // "Magnetic Repulsion" (7s): pushes ALL enemies within 300px violently away,
    //  deals 40 damage, and slides her 150px backward. 0.6s i-frames.
    //  S5: also reflects every enemy projectile.
    cast(run, p, ctx) {
      H.applyInvuln(p.st, ctx.def.iframes);        // the escape's own guarantee
      H.nova(run, p, p.x, p.y, 300, H.abilityDamage(run, p, 40), REPULSE);
      run.ringOverlay(p.x, p.y, H.area(p, 300), C_ARC);
      H.grade(run, C_ARC, 0.4, 0.5);
      H.announce(run, 'REPULSION', C_ARC);
      H.camera.punch(0.06, 0.35);

      if (ctx.s5) reflectProjectiles(run, p);

      // Backward: away from whatever she just threw off her, so the escape
      // reliably leaves a full surround instead of sliding back into it.
      let a = p.facing + Math.PI;
      const t = H.target(run, p, SPEC_CLUSTER);
      if (t.found) a = t.angle + Math.PI;
      H.dash(run, p, a, 150 * (p.flags.escapeDistanceMult || 1), ctx.def.iframes, STEP);
    },
  },

  static_field: {
    // "Static Field": every 3s, chain lightning arcs from her to up to 5 nearby
    //  enemies for 20 damage each.
    init(run, p, ctx) {
      ctx.arcT = 3;
      ctx.drawT = 0;
      ctx.cn = 0;
      ctx.cx = new Float32Array(6);
      ctx.cy = new Float32Array(6);
    },
    tick(run, p, ctx, dt) {
      // The arc hangs for a fifth of a second so it is actually readable.
      if (ctx.drawT > 0) {
        ctx.drawT -= dt;
        ctx.cx[0] = p.x; ctx.cy[0] = p.y;
        for (let i = 1; i < ctx.cn; i++) {
          run.beamOverlay(ctx.cx[i - 1], ctx.cy[i - 1], ctx.cx[i], ctx.cy[i], 6, C_ARC);
        }
      }

      ctx.arcT -= dt;
      if (ctx.arcT > 0) return;
      ctx.arcT = 3;

      const t = H.target(run, p, SPEC_CHAIN);
      if (!t.count) return;
      const dmg = H.abilityDamage(run, p, 20);
      ctx.cx[0] = p.x; ctx.cy[0] = p.y; ctx.cn = 1;
      for (let i = 0; i < t.targets.length && i < 5; i++) {
        const e = t.targets[i];
        H.dealDamage(run, e, dmg, H.SRC.SPECIAL, ARC_HIT);
        ctx.cx[ctx.cn] = e.x; ctx.cy[ctx.cn] = e.y; ctx.cn++;
        H.particles.burst(e.x, e.y, 4, C_ARC, THRUST_SPARK);
      }
      ctx.drawT = 0.22;
      H.audio.play('hit');
    },
  },
});

// ---------------------------------------------------------------------------
//  Module-level callbacks. Never closures — a closure per call is an allocation,
//  and every one of these is reached from a per-frame path.
// ---------------------------------------------------------------------------

/** Everything the fire dance touches burns for 4s. */
function igniteHit(e) {
  H.applyBurn(e.st, S.dps, 4);
}

/**
 * Is anything actually inside the guard? Bodies first, then shots.
 * The radius is the engine's own contact test (enemy radius + player radius)
 * plus a hair of grace, so "struck" here means exactly what it means everywhere
 * else — not "an enemy is vaguely nearby".
 */
function guardTouched(run, p) {
  S.hit = false;
  H.forEachEnemyIn(run, p.x, p.y, p.radius + 6, guardBody);
  if (S.hit) return true;
  const items = run.enemyProjectiles.items;
  for (let i = 0; i < run.enemyProjectiles.count; i++) {
    const q = items[i];
    if (!q.active) continue;
    const rr = q.radius + p.radius + 10;
    if (H.dist2(q.x, q.y, p.x, p.y) < rr * rr) return true;
  }
  return false;
}
function guardBody() { S.hit = true; return false; }

/** The undertow: dragged in behind her, then flung together. */
function dragEnemy(e) {
  if (e.isBoss || e.knockbackImmune) return;
  const back = 60 + (S.n % 4) * 22;
  const side = ((S.n % 3) - 1) * 34;
  e.x = S.x - Math.cos(S.a) * back - Math.sin(S.a) * side;
  e.y = S.y - Math.sin(S.a) * back + Math.cos(S.a) * side;
  e.kbx = Math.cos(S.a) * 420;
  e.kby = Math.sin(S.a) * 420;
  if (S.bleed) H.applyBleed(e.st, 0.02, 4);       // S5: 2% max HP/s for 4s
  S.n++;
}

/** +35% damage to anything under 40% HP, written on the target as VULNERABLE. */
function markWounded(e) {
  if (e.maxHp <= 0 || e.hp / e.maxHp >= 0.40) return;
  H.applyVulnerable(e.st, 1.35, 0.35);
}

/**
 * "Level 5 Clearance" on a hitscan beam: +12% per enemy ALREADY pierced, so the
 * first target in the beam gets nothing and the tenth gets +108% — the same
 * escalation projectile.js pays out, which a hitscan line cannot accumulate.
 */
function railClearance(e) {
  if (S.hits > 0) H.dealDamage(S.run, e, S.dmg * S.per * S.hits, H.SRC.AUTO, RAIL_BONUS);
  S.hits++;
}

/** The ionised trail, redrawn five times across the second after the shot. */
function ionTrail(ctx, run) {
  ctx.ionStep++;
  const fade = 1 - ctx.ionStep / 6;
  run.beamOverlay(ctx.bx0, ctx.by0, ctx.bx1, ctx.by1, 3 + 9 * fade, C_ARC);
  for (let i = 0; i < 3; i++) {
    const t = H.fxRng.raw();
    H.particles.emit(H.lerp(ctx.bx0, ctx.bx1, t), H.lerp(ctx.by0, ctx.by1, t),
                     0, 0, ION_SPARK);
  }
}

/** S5: catch every enemy shot in the field and throw it back. */
function reflectProjectiles(run, p) {
  const src = run.enemyProjectiles;
  const items = src.items;
  let n = 0;
  for (let i = 0; i < src.count; i++) {
    const q = items[i];
    if (!q.active) continue;
    REFLECT.damage = q.damage;
    REFLECT.speed = Math.max(300, q.speed);
    REFLECT.radius = q.radius;
    REFLECT.owner = p;
    run.projectiles.fire(q.x, q.y, q.angle + Math.PI, REFLECT);
    q.aoeRadius = 0;                               // it is ours now; do not detonate
    src.pool.release(q);
    i--;
    n++;
  }
  if (n > 0) H.floaters.spawn(p.x, p.y - 54, 'REFLECTED', C_RAIL, 18, 1.0);
}
