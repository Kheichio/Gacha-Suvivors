// =============================================================================
// src/game/abilities/star9.js — THREE NEWCOMERS, TWELVE PILLARS.
// =============================================================================
//
// The other content modules are named for a rarity bracket, and that is a
// convention rather than a rule: the driver joins on ABILITY ID and never learns
// what file an implementation came from or what a character is called. These
// three arrived together as one request, they share no mechanics, and splitting
// them across star5c/star6b/star5d would have bought nothing except three more
// import lines. So: one file, one cohort, the three of them side by side.
//
//   KARIN   steel, rarity 5.  Throws blades and then goes and gets them back.
//                             The whole kit is one loop: plant, retrieve, reset.
//   RIMA    spirit, rarity 6. An orb that returns, a charm that turns the crowd
//                             on itself, and three dashes she holds at once.
//   NIKA    lightning, rarity 5. Two weapons on one trigger, and a floor trap
//                             that takes everybody's legs for three seconds.
//
// HOUSE RULES, from star8.js's header, which is the file template:
//   - a module-level constant for every options bag, visual descriptor,
//     targeting spec and iteration callback. No object literal and no closure on
//     any path a frame can reach;
//   - nothing branches on a character id — the registry key IS the branch;
//   - every radius through H.area, every damage through H.autoDamage /
//     H.abilityDamage, every origin through H.origin;
//   - every number is either read off ctx.def or quoted from the character card.
//     The `desc` strings ship real numbers and these have to match them;
//   - a module-level pool is cleared in init() AND carries its own `run` per
//     record, because module scope is process-global and the headless harness
//     runs a hundred runs in one process.
// =============================================================================

import { registerAll } from './index.js';
import * as H from './helpers.js';

const SRC = H.SRC;
const FOREVER = 1e9;

// --- palettes ---------------------------------------------------------------
// KARIN — steel and one red. Everything she leaves on the floor is a blade, so
// the blade is the only silhouette she owns and it has to be unmistakable.
const C_STEEL = '#dfe8f5';
const C_BLOOD = '#c8203a';
const C_KARIN_DARK = '#1b1f2a';
// RIMA — arcane pink over old gold. The orb and the charm are the same magic.
const C_ARCANE = '#ff7ad0';
const C_RIMA_GOLD = '#ffd76a';
const C_RIMA_DARK = '#2a1a3a';
// NIKA — hot pink and a cold blue, and the two never mix: pink is the minigun,
// blue is the rockets, and the whole point of her is knowing which is loaded.
const C_NIKA_PINK = '#ff5fa8';
const C_NIKA_BLUE = '#6ad8ff';
const C_NIKA_DARK = '#2a2233';
const C_CHOMPER = '#7bf59a';

// =============================================================================
//                    KARIN — "The Blade Comes Back"
// =============================================================================
//
// THE LOOP IS THE CHARACTER. Every blade she throws lands point-down and STAYS
// there. Walking over one picks it up, and picking one up is what pays her: a
// slice off both cooldowns and a permanent stack of damage. So the kit is not
// "throw daggers", it is "throw daggers and then decide whether the ground they
// landed on is worth walking to" — which is a movement decision, made twenty
// times a minute, in a genre where movement is the only verb.
//
// The escape is the other half of it: it goes TO a blade rather than away from
// danger, so the retrieval and the disengage are the same button and pressing it
// well means having thrown well ten seconds earlier.

/** One blade, in the ground, waiting. Same shape as the auto's, unrotated. */
const V_BLADE = { shape: 'shard', color: C_STEEL, accent: C_KARIN_DARK, size: 9, rotates: true, glow: true };
const V_PLANTED = { shape: 'shard', color: C_STEEL, accent: C_KARIN_DARK, size: 11, flash: false };
const SP_PLANTED = H.atlas.register(V_PLANTED);
H.atlas.register(V_BLADE);

/** Standing in the floor. `shard` points +X, so this stands it on its nose. */
const BLADE_NOSE_DOWN = Math.PI * 0.5;

const BLADE_SPEED = 760;
const BLADE_FLIGHT = 0.26;
const BLADE_LIFE = 9;
/** How close is close enough to sweep one up. Deliberately NOT through H.area:
 *  pickup reach is a movement contract, and Wide Reach must not widen it. */
const BLADE_PICKUP = 72;
const BLADE_REFUND = 0.7;
const BLADE_STACK = 0.012;
const BLADE_DASH = 460;

/**
 * The blades on the floor.
 *
 * A module-level ring rather than ctx, for the reason star8.js's mines give: a
 * blade lives nine seconds and the escape that retrieves it is on five, so
 * blades routinely outlive the cast that threw them — and the pillar that
 * RESOLVES them is the passive, not the auto that made them.
 */
const BLADE_SLOTS = 28;
const BLADES = [];
for (let i = 0; i < BLADE_SLOTS; i++) {
  BLADES.push({ run: null, live: false, x: 0, y: 0, t: 0 });
}
let bladeSlot = 0;

const BLADE_SHOT = {
  motion: H.MOTION.ARC, targetX: 0, targetY: 0, flightTime: BLADE_FLIGHT, arcHeight: 0,
  damage: 0, radius: 9, visual: V_BLADE, trailColor: C_STEEL,
  owner: null, tag: 'karin_blade',
};
const BLADE_LAND = { life: BLADE_LIFE, from: 4, angle: BLADE_NOSE_DOWN, spin: 0, alpha: 0.95 };
const BLADE_HIT = { falloff: 0.2, element: 'steel', knockback: 60 };
const BLADE_SPARK = { speed: 190, life: 0.3, size: 0.34, drag: 3, shape: 'shard' };
const BLADE_PICKUP_FX = { life: 0.3, size: 13 };
const THROW_FX = { speed: 210, life: 0.2, size: 0.3, additive: true };

/** A landing record, from the scheduler. Module-level: no closures. */
function plantBlade(rec) {
  const run = rec.run;
  if (!run || run.over) return;
  const b = BLADES[bladeSlot];
  bladeSlot = (bladeSlot + 1) % BLADE_SLOTS;
  b.run = run; b.live = true;
  b.x = rec.x; b.y = rec.y; b.t = BLADE_LIFE;
  H.effects.fallSprite(rec.x, rec.y, SP_PLANTED, BLADE_LAND);
  H.particles.burst(rec.x, rec.y, 3, C_KARIN_DARK, BLADE_SPARK);
}

/** A fixed ring of in-flight records, exactly like the carrot barrage's. */
const LANDING_SLOTS = 24;
const LANDINGS = [];
for (let i = 0; i < LANDING_SLOTS; i++) LANDINGS.push({ run: null, x: 0, y: 0 });
let landingSlot = 0;

/** Throw one blade at (tx, ty), and schedule the thing it becomes. */
function throwBlade(run, p, ox, oy, tx, ty, dmg) {
  BLADE_SHOT.damage = dmg;
  BLADE_SHOT.owner = p;
  BLADE_SHOT.targetX = tx;
  BLADE_SHOT.targetY = ty;
  BLADE_SHOT.arcHeight = 26;
  run.projectiles.fire(ox, oy, H.angleTo(ox, oy, tx, ty), BLADE_SHOT);
  // A lobbed projectile cannot hit anything in flight (MOTION.ARC skips the hit
  // pass), so the damage is resolved where it lands, on the same frame the blade
  // plants. That is also why the two are one scheduler call and not two.
  const rec = LANDINGS[landingSlot];
  landingSlot = (landingSlot + 1) % LANDING_SLOTS;
  rec.run = run; rec.x = tx; rec.y = ty;
  run.scheduler.after(BLADE_FLIGHT, landBlade, rec);
}

const BLADE_BURST = 46;
function landBlade(rec) {
  const run = rec.run;
  if (!run || run.over) return;
  H.areaDamage(run, rec.x, rec.y, BLADE_BURST, LANDED_DAMAGE, SRC.AUTO, BLADE_HIT);
  plantBlade(rec);
}
/** Set immediately before every scheduled landing. One volley, one value. */
let LANDED_DAMAGE = 0;

const KARIN_AIM = { mode: 'nearest' };
const LOTUS_TIME = 2.4;
const LOTUS_CADENCE = 0.22;
const LOTUS_RADIUS = 300;
const LOTUS_DAMAGE = 42;
const LOTUS_BLADES = 3;
const LOTUS_HIT = { falloff: 0.15, element: 'steel', knockback: 90 };
const LOTUS_FX = { life: 0.34, width: 5, spokes: 12 };
const LOTUS_SPIN = { speed: 260, life: 0.36, size: 0.4, drag: 2.6, shape: 'shard' };

const SHUNPO_IFRAME_FX = { speed: 220, life: 0.34, size: 0.36, additive: true };

// =============================================================================
//                    RIMA — "Nine Reasons To Stay"
// =============================================================================
//
// The orb is the read: it goes out and it COMES BACK, and it hurts on both
// passes, so her damage is a function of standing still long enough for the
// return trip to land on something. That is the opposite instinct to every other
// ranged character on the roster and it is the whole reason she plays
// differently with the same stats.
//
// The charm is the one ability in the game that removes the player from the
// fight without removing the fight. Nothing can target her for five seconds;
// everything in the circle is dragged to one point and grinds itself down there.
// She is not invulnerable — she is IRRELEVANT, which is a different feeling.

const V_ORB = { shape: 'circle', color: C_ARCANE, accent: C_RIMA_DARK, size: 13, rotates: true, glow: true };
const ORB_SPEED = 430;
const ORB_OUT = 0.42;
const ORB_HIT = { falloff: 0, element: 'spirit', knockback: 40 };
const ORB = {
  motion: H.MOTION.BOOMERANG, originX: 0, originY: 0, outTime: ORB_OUT,
  damage: 0, speed: ORB_SPEED, life: 1.5, radius: 15, pierce: 99,
  element: 'spirit', visual: V_ORB, trailColor: C_ARCANE,
  owner: null, tag: 'rima_orb', knockback: 40,
};
const RIMA_AIM = { mode: 'nearest' };
const ORB_FX = { speed: 200, life: 0.2, size: 0.34, additive: true };

const CHARM_TIME = 5;
const CHARM_RADIUS = 340;
const CHARM_DPS = 34;
const CHARM_PULL = { param: 150 };
const CHARM_FX = { life: 0.6, width: 6, from: 30, spokes: 20 };
const CHARM_HEART = { speed: 120, life: 1.0, size: 0.46, drag: 2.2, shape: 'flower' };
const CHARM_MOTE = { color: C_ARCANE, life: 0.9, size: 0.4, sizeEnd: 0.1, drag: 1.6, additive: true };

/** Shared scratch for the charm's enemy walk. Never read across calls. */
const S = { t: 0, x: 0, y: 0, n: 0, sx: 0, sy: 0 };

function charmOne(e) {
  // Taunted to the CENTROID of the crowd rather than to the player. That one
  // argument is the whole ability: they walk to each other instead of to her.
  H.applyTaunt(e.st, S.t, S.x, S.y);
  H.applyPull(e.st, S.t, S.x, S.y, 150);
  H.applyNoRegen(e.st, S.t);
  S.n++;
}
function sumPosition(e) { S.sx += e.x; S.sy += e.y; S.n++; }

const RUSH_DIST = 320;
const RUSH_DAMAGE = 55;
const RUSH_CUT = { width: 46, damage: 0, src: SRC.ESCAPE, element: 'spirit', knockback: 110, color: C_ARCANE };
const RUSH_GHOSTS = 3;
const RUSH_FX = { alpha: 0.5 };
const RUSH_SPRAY = { speed: 200, life: 0.3, size: 0.34, additive: true };

const THEFT_HEAL = 0.6;
const THEFT_STACK = 0.008;

// =============================================================================
//                    NIKA — "The Fun Part"
// =============================================================================
//
// TWO WEAPONS ON ONE TRIGGER, and the special is the trigger. Everything else
// about her is downstream of which one is loaded:
//
//   MINIGUN   every auto fires, single target, fast, small.
//   ROCKETS   every OTHER auto fires, and that one is an area blast.
//
// The cadence is halved HERE rather than through the attack-speed stat, and
// deliberately: the interval on the card is one number, the player reads it once,
// and a mode that silently rewrites it is a lie about how fast she shoots. A
// counter that skips every second call is honest — you can watch it happen.
//
// The escape is the other half of the fantasy: it is not a dodge, it is a floor
// full of traps that take everybody's legs at once. She gets her i-frames for
// the drop, and then she gets three seconds of a completely still arena.

const V_BULLET = { shape: 'shard', color: C_NIKA_PINK, accent: C_NIKA_DARK, size: 7, rotates: true, glow: true };
const V_ROCKET = { shape: 'triangle', color: C_NIKA_BLUE, accent: C_NIKA_DARK, size: 11, rotates: true, glow: true };
const V_CHOMPER = { shape: 'hex', color: C_CHOMPER, accent: '#14301c', size: 13, flash: false };
const SP_CHOMPER = H.atlas.register(V_CHOMPER);
H.atlas.register(V_BULLET);
H.atlas.register(V_ROCKET);

const MODE_MINIGUN = 0;
const MODE_ROCKETS = 1;

const BULLET = {
  motion: H.MOTION.STRAIGHT, damage: 0, speed: 980, life: 0.9, radius: 7, pierce: 1,
  element: 'lightning', visual: V_BULLET, trailColor: C_NIKA_PINK,
  owner: null, tag: 'nika_bullet', knockback: 30,
};
const ROCKET = {
  motion: H.MOTION.STRAIGHT, damage: 0, speed: 520, life: 1.6, radius: 13, pierce: 0,
  aoeRadius: 0, aoeDamage: 0,
  element: 'lightning', visual: V_ROCKET, trailColor: C_NIKA_BLUE,
  owner: null, tag: 'nika_rocket', knockback: 120,
};
const NIKA_AIM = { mode: 'nearest' };
const NIKA_AIM_CROWD = { mode: 'densestCluster' };
const ROCKET_BLAST = 120;
const MUZZLE_FX = { speed: 240, life: 0.16, size: 0.3, additive: true };

const SWAP_VOLLEY = 5;
const SWAP_HASTE = 1.25;
const SWAP_HASTE_TIME = 3;

const CHOMPER_COUNT = 5;
const CHOMPER_RING = 190;
const CHOMPER_ROOT = 3;
const CHOMPER_SLOW = 3;
const CHOMPER_SLOW_MULT = 0.45;
const CHOMPER_DAMAGE = 70;
const CHOMPER_RADIUS = 320;
const CHOMPER_HIT = { falloff: 0.3, element: 'lightning', knockback: 0 };
const CHOMPER_DROP = { life: 0.45, from: 130, angle: 0, spin: 1.4 };
const CHOMPER_FX = { life: 0.5, width: 5, from: 20, spokes: 16 };
const CHOMPER_BITE = { speed: 150, life: 0.5, size: 0.4, drag: 3, shape: 'hex' };

function chompOne(e) {
  // Rooted first, then slowed for the same again. Both are applied on THIS
  // frame with different durations rather than scheduled — statusEffects takes
  // the stronger of existing and incoming, so a six-second slow simply outlives
  // the three-second stun sitting on top of it, and nothing has to fire later.
  H.applyStun(e.st, CHOMPER_ROOT);
  H.applySlow(e.st, CHOMPER_SLOW_MULT, CHOMPER_ROOT + CHOMPER_SLOW);
  S.n++;
}

const EXCITED_STACK = 0.02;
const EXCITED_SPEED = 0.9;
const EXCITED_CAP = 25;

// =============================================================================

registerAll({

  // ---- KARIN ---------------------------------------------------------------

  bouncing_blade: {
    // "One blade, thrown at the nearest thing, 34 damage in a 46px bite where it
    //  lands. It sticks there for 9s. Every 0.42s."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      const n = 1 + H.extraShots(p);
      LANDED_DAMAGE = H.autoDamage(run, p, ctx.def.damage, opts);
      const fan = H.fanWidth(n, 0.30);
      const reach = Math.sqrt(H.dist2(o.x, o.y, t.x, t.y));
      for (let i = 0; i < n; i++) {
        const a = H.fanAngle(i, n, t.angle, 0.30);
        const d = reach * (0.94 + 0.06 * (i % 2));
        const tx = H.clamp(o.x + Math.cos(a) * d, run.bounds.minX + 24, run.bounds.maxX - 24);
        const ty = H.clamp(o.y + Math.sin(a) * d, run.bounds.minY + 24, run.bounds.maxY - 24);
        throwBlade(run, p, o.x, o.y, tx, ty, LANDED_DAMAGE);
      }
      H.particles.cone(o.x, o.y, t.angle, fan + 0.2, 4, C_STEEL, THROW_FX);
      H.audio.play('shoot');
    },
  },

  death_lotus: {
    // "2.4s of spinning, a volley of 3 blades every 0.22s at everything inside
    //  300px for 42 each, and every one of them stays in the ground afterwards."
    //  S3: 380px and 4 blades a volley.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) {
        // The boss keeps the punchline and skips the spin: one full circle of
        // blades, once, with none of the retrieval loop that follows.
        const o = H.origin(run, p, opts);
        H.hostileDamage(run, opts, o.x, o.y, H.area(p, LOTUS_RADIUS),
                        H.abilityDamage(run, p, LOTUS_DAMAGE * 2, opts));
        H.effects.burstRing(o.x, o.y, H.area(p, LOTUS_RADIUS), C_BLOOD, LOTUS_FX);
        H.audio.play('slash');
        return;
      }
      ctx.active = true;
      ctx.t = LOTUS_TIME;
      ctx.castT = 0;
      p.flags.auraColor = C_BLOOD;
      H.grade(run, C_BLOOD, 0.3, 0.6);
      H.announce(run, 'DEATH LOTUS', C_BLOOD);
      H.camera.punch(0.04, 0.3);
      H.audio.play('special');
    },
    tick(run, p, ctx, dt) {
      ctx.castT -= dt;
      if (ctx.castT > 0) return;
      ctx.castT += LOTUS_CADENCE;

      const r = H.area(p, ctx.s3 ? LOTUS_RADIUS * 1.27 : LOTUS_RADIUS);
      const n = ctx.s3 ? LOTUS_BLADES + 1 : LOTUS_BLADES;
      const dmg = H.abilityDamage(run, p, LOTUS_DAMAGE);
      H.areaDamage(run, p.x, p.y, r, dmg, SRC.SPECIAL, LOTUS_HIT);

      // The blades go OUTWARD on a turning spoke rather than at targets: she is
      // spinning, not aiming, and a volley that tracks reads as a turret.
      LANDED_DAMAGE = dmg * 0.5;
      ctx.spin = (ctx.spin || 0) + 0.9;
      for (let i = 0; i < n; i++) {
        const a = ctx.spin + i * (H.TAU / n);
        const d = r * (0.55 + 0.4 * ((i % 3) / 2));
        const tx = H.clamp(p.x + Math.cos(a) * d, run.bounds.minX + 24, run.bounds.maxX - 24);
        const ty = H.clamp(p.y + Math.sin(a) * d, run.bounds.minY + 24, run.bounds.maxY - 24);
        throwBlade(run, p, p.x, p.y, tx, ty, LANDED_DAMAGE);
      }
      H.effects.burstRing(p.x, p.y, r, C_BLOOD, LOTUS_FX);
      H.particles.ring(p.x, p.y, 8, C_STEEL, r * 2.2);
      H.particles.burst(p.x, p.y, 5, C_BLOOD, LOTUS_SPIN);
      H.audio.play('slash');
    },
    end(run, p, ctx) {
      p.flags.auraColor = null;
      H.particles.ring(p.x, p.y, 14, C_BLOOD, 280);
    },
  },

  shunpo: {
    // "She goes to the nearest blade she has left lying around — up to 460px,
    //  fully invulnerable for 0.5s — and picks it up on arrival. With nothing on
    //  the floor she simply steps 460px the way she is already going."
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) return false;   // there is nothing here to retrieve

      // The nearest LIVE blade of her own, inside the step. Not H.nearestTo:
      // that finds enemies, and the whole point is that this finds her own
      // property.
      let best = null, bestD = Infinity;
      const reach = BLADE_DASH * (p.flags.escapeDistanceMult || 1);
      const reach2 = reach * reach;
      for (let i = 0; i < BLADE_SLOTS; i++) {
        const b = BLADES[i];
        if (!b.live || b.run !== run) continue;
        const d = H.dist2(p.x, p.y, b.x, b.y);
        if (d < bestD && d <= reach2) { bestD = d; best = b; }
      }

      const a = best ? H.angleTo(p.x, p.y, best.x, best.y) : p.facing;
      RUSH_CUT.damage = 0;
      if (best) {
        // AIMED: a retrieval that re-aims to the stick is a retrieval that
        // misses the thing it exists to collect.
        H.blink(run, p, best.x, best.y, ctx.def.iframes, H.AIMED);
        collectBlade(run, p, best);
      } else {
        H.dash(run, p, a, reach, ctx.def.iframes);
      }
      H.effects.afterimage(p.x, p.y, a, 30, C_STEEL, RUSH_FX);
      H.particles.cone(p.x, p.y, a + Math.PI, 0.9, 8, C_STEEL, SHUNPO_IFRAME_FX);
      H.audio.play('escape');
      H.camera.punch(0.03, 0.2);
    },
  },

  voracity: {
    // "Every blade she picks up shaves 0.7s off both cooldowns and adds a
    //  permanent 1.2% damage. Uncapped. Walking over her own mess is the build."
    init(run, p, ctx) {
      ctx.stacks = 0;
      ctx.mods = { damageMult: 0 };
      p.addBuff('voracity', FOREVER, ctx.mods);
      // Module scope is process-global; the harness runs many runs in one.
      for (let i = 0; i < BLADE_SLOTS; i++) {
        BLADES[i].live = false; BLADES[i].run = null;
      }
      bladeSlot = 0; landingSlot = 0;
    },
    tick(run, p, ctx, dt) {
      const pick2 = BLADE_PICKUP * BLADE_PICKUP;
      for (let i = 0; i < BLADE_SLOTS; i++) {
        const b = BLADES[i];
        if (!b.live) continue;
        // A record from a dead run holds that run alive and desynchronises a
        // seeded replay. Drop it the moment it is noticed.
        if (b.run !== run) { b.live = false; b.run = null; continue; }
        b.t -= dt;
        if (b.t <= 0) { b.live = false; b.run = null; continue; }
        if (H.dist2(p.x, p.y, b.x, b.y) <= pick2) collectBlade(run, p, b);
      }
    },
  },

  // ---- RIMA ----------------------------------------------------------------

  orb_of_deception: {
    // "An orb thrown 430px out and pulled straight back. 30 damage on the way
    //  out, 30 on the way home, and it passes through everything both ways."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      ORB.damage = H.autoDamage(run, p, ctx.def.damage, opts);
      ORB.owner = p;
      // The BOOMERANG motion pulls back to where it was FIRED, so the origin has
      // to be the origin entity's position on this exact frame — a mirroring
      // minion's orb returns to the minion, not to her.
      ORB.originX = o.x;
      ORB.originY = o.y;
      ORB.radius = H.area(p, 15);
      H.spread(run, p, o.x, o.y, t.angle, 1, 0, ORB);
      H.particles.cone(o.x, o.y, t.angle, 0.3, 4, C_ARCANE, ORB_FX);
      H.audio.play('shoot');
    },
  },

  charm: {
    // "For 5s nothing inside 340px can see her at all: they are dragged to the
    //  middle of their own crowd and left there taking 34 a second. She is
    //  untargetable for the whole of it."
    //  S3: 7s. S5: it also heals her for a tenth of what it deals.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) {
        const o = H.origin(run, p, opts);
        H.hostileDamage(run, opts, o.x, o.y, H.area(p, CHARM_RADIUS),
                        H.abilityDamage(run, p, CHARM_DPS * 2, opts));
        H.audio.play('telegraph');
        return;
      }
      const dur = ctx.s3 ? CHARM_TIME + 2 : CHARM_TIME;
      const r = H.area(p, CHARM_RADIUS);

      // THE CENTROID FIRST. Everything is taunted to where the crowd already
      // IS, so they converge on each other rather than on a point she picked —
      // which is what makes it read as them turning on one another.
      S.sx = 0; S.sy = 0; S.n = 0;
      H.forEachEnemyIn(run, p.x, p.y, r, sumPosition);
      const cx = S.n > 0 ? S.sx / S.n : p.x;
      const cy = S.n > 0 ? S.sy / S.n : p.y;

      S.t = dur; S.x = cx; S.y = cy; S.n = 0;
      H.forEachEnemyIn(run, p.x, p.y, r, charmOne);

      // The grinder they make of themselves. A real field, so it keeps working
      // on anything that wanders in for the whole five seconds.
      H.field(run, p, cx, cy, CHARM_RADIUS * 0.55, dur, 'damage',
              H.abilityDamage(run, p, CHARM_DPS), C_ARCANE, CHARM_PULL);

      ctx.active = true;
      ctx.t = dur;
      ctx.cx = cx; ctx.cy = cy;
      ctx.moteT = 0;
      H.applyUntargetable(p.st, dur);
      p.flags.auraColor = C_ARCANE;
      H.effects.shockwave(p.x, p.y, r, C_ARCANE, CHARM_FX);
      H.particles.burst(cx, cy, 12, C_ARCANE, CHARM_HEART);
      H.grade(run, C_ARCANE, 0.32, 0.6);
      H.announce(run, 'CHARM', C_ARCANE);
      H.floaters.spawn(p.x, p.y - 40, S.n + ' CHARMED', C_ARCANE, 16, 1.0);
      H.audio.play('special');
    },
    tick(run, p, ctx, dt) {
      ctx.moteT -= dt;
      if (ctx.moteT > 0) return;
      ctx.moteT = 0.14;
      H.particles.drift(ctx.cx + H.fxRng.signed() * 90, ctx.cy + H.fxRng.signed() * 90,
                        C_ARCANE, CHARM_MOTE);
    },
    end(run, p, ctx) {
      p.flags.auraColor = null;
      H.particles.ring(ctx.cx, ctx.cy, 14, C_RIMA_GOLD, 320);
    },
  },

  spirit_rush: {
    // "Three dashes, held at once. 320px each, 0.45s invulnerable, 55 damage to
    //  everything she passes through. They recharge one at a time."
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) return false;
      const dist = RUSH_DIST * (p.flags.escapeDistanceMult || 1);
      RUSH_CUT.damage = H.abilityDamage(run, p, RUSH_DAMAGE) + (p.flags.escapeDamages || 0);
      const a = H.escapeDirection(run, p, p.facing, opts);
      const d = H.dash(run, p, a, dist, ctx.def.iframes, RUSH_CUT);
      for (let i = 0; i <= RUSH_GHOSTS; i++) {
        const f = i / RUSH_GHOSTS;
        H.effects.afterimage(H.lerp(d.x0, d.x1, f), H.lerp(d.y0, d.y1, f),
                             a, 28, C_ARCANE, RUSH_FX);
      }
      H.particles.cone(d.x1, d.y1, a + Math.PI, 0.8, 7, C_ARCANE, RUSH_SPRAY);
      H.audio.play('escape');
    },
  },

  essence_theft: {
    // "Every kill heals her 0.6 HP and adds a permanent 0.8% damage. A thousand
    //  years of other people's magic, one piece at a time."
    init(run, p, ctx) {
      ctx.stacks = 0;
      ctx.kills = run.stats.kills;
      ctx.mods = { damageMult: 0 };
      p.addBuff('essence_theft', FOREVER, ctx.mods);
    },
    tick(run, p, ctx) {
      // The driver documents onKill but does not dispatch it, so this is the
      // mandated delta-poll against run.stats. `ctx.hookLive` latches if the
      // hook ever starts arriving, and neither path can double-count.
      if (ctx.hookLive) return;
      const k = run.stats.kills;
      const d = k - ctx.kills;
      if (d <= 0) return;
      ctx.kills = k;
      ctx.stacks += d;
      ctx.mods.damageMult = ctx.stacks * THEFT_STACK;
      p.recompute();
      H.healPlayer(run, THEFT_HEAL * d, true);
    },
    onKill(run, p, ctx) { ctx.hookLive = true; },
  },

  // ---- NIKA ----------------------------------------------------------------

  switcheroo: {
    // "MINIGUN: one shot every 0.34s at the nearest thing for 21. ROCKETS: every
    //  OTHER shot, at the thickest part of the crowd, for 48 in a 120px blast."
    init(run, p, ctx) {
      ctx.mode = MODE_MINIGUN;
      ctx.beat = 0;
      p.flags.nikaMode = MODE_MINIGUN;
    },
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const rockets = ctx.mode === MODE_ROCKETS;

      // HALF CADENCE, COUNTED HERE. The card says one interval and means it; a
      // mode that quietly rewrote the attack-speed stat would be lying about a
      // number the player has already read. Skipping every second call is a
      // thing you can watch happen.
      if (rockets) {
        ctx.beat = (ctx.beat + 1) & 1;
        if (ctx.beat === 1) return;
      }

      const t = H.target(run, p, rockets ? NIKA_AIM_CROWD : ctx.def.targeting, opts);
      if (!t.found) return;
      const n = 1 + H.extraShots(p);

      if (rockets) {
        ROCKET.damage = H.autoDamage(run, p, ctx.def.damage * 2.3, opts);
        ROCKET.owner = p;
        ROCKET.aoeRadius = H.area(p, ROCKET_BLAST);
        ROCKET.aoeDamage = ROCKET.damage;
        H.spread(run, p, o.x, o.y, t.angle, n, 0.22, ROCKET);
        H.particles.cone(o.x, o.y, t.angle, 0.4, 6, C_NIKA_BLUE, MUZZLE_FX);
        H.camera.punch(0.02, 0.14);
      } else {
        BULLET.damage = H.autoDamage(run, p, ctx.def.damage, opts);
        BULLET.owner = p;
        H.spread(run, p, o.x, o.y, t.angle, n, 0.12, BULLET);
        H.particles.cone(o.x, o.y, t.angle, 0.22, 3, C_NIKA_PINK, MUZZLE_FX);
      }
      H.audio.play('shoot');
    },
  },

  switcheroo_swap: {
    // "She swaps weapons. The other one fires a free volley of 5 on the way in
    //  and she moves 25% faster for 3s while she is enjoying it."
    //  S3: the free volley is 8. S5: the haste lasts 6s.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) return false;   // the boss brought its own gun
      const auto = p.state('switcheroo');
      const to = auto.mode === MODE_ROCKETS ? MODE_MINIGUN : MODE_ROCKETS;
      auto.mode = to;
      auto.beat = 0;
      p.flags.nikaMode = to;

      const rockets = to === MODE_ROCKETS;
      const t = H.target(run, p, rockets ? NIKA_AIM_CROWD : NIKA_AIM);
      const a = t.found ? t.angle : p.facing;
      const n = ctx.s3 ? SWAP_VOLLEY + 3 : SWAP_VOLLEY;
      const dmg = H.abilityDamage(run, p, rockets ? 48 : 21);

      if (rockets) {
        ROCKET.damage = dmg;
        ROCKET.owner = p;
        ROCKET.aoeRadius = H.area(p, ROCKET_BLAST);
        ROCKET.aoeDamage = dmg;
        H.spread(run, p, p.x, p.y, a, n, 0.26, ROCKET);
      } else {
        BULLET.damage = dmg;
        BULLET.owner = p;
        H.spread(run, p, p.x, p.y, a, n, 0.14, BULLET);
      }

      H.applyHaste(p.st, SWAP_HASTE, ctx.s5 ? SWAP_HASTE_TIME * 2 : SWAP_HASTE_TIME);
      const col = rockets ? C_NIKA_BLUE : C_NIKA_PINK;
      H.effects.burstRing(p.x, p.y, H.area(p, 150), col, CHOMPER_FX);
      H.particles.ring(p.x, p.y, 12, col, 300);
      H.grade(run, col, 0.28, 0.45);
      H.announce(run, rockets ? 'ROCKETS' : 'MINIGUN', col);
      H.floaters.spawn(p.x, p.y - 40, rockets ? 'ROCKETS!' : 'MINIGUN!', col, 17, 0.9);
      H.camera.punch(0.05, 0.3);
      H.audio.play('special');
    },
  },

  flame_chompers: {
    // "5 chompers in a 190px ring. Everything inside 320px is bitten for 70,
    //  cannot move for 3s, and is slowed 55% for 3s after that. She is
    //  invulnerable for 0.6s while she throws them."
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) return false;
      H.applyInvuln(p.st, ctx.def.iframes);
      H.applyUntargetable(p.st, ctx.def.iframes);

      const r = H.area(p, CHOMPER_RADIUS);
      H.areaDamage(run, p.x, p.y, r, H.abilityDamage(run, p, CHOMPER_DAMAGE),
                   SRC.ESCAPE, CHOMPER_HIT);
      S.n = 0;
      H.forEachEnemyIn(run, p.x, p.y, r, chompOne);

      // The chompers themselves, thrown out around her. They are decoration
      // over a resolved effect rather than entities: the bite has already
      // happened, and five props landing sell it far better than five timers.
      const ring = H.area(p, CHOMPER_RING);
      const n = ctx.s5 ? CHOMPER_COUNT + 3 : CHOMPER_COUNT;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * H.TAU + 0.4;
        H.effects.fallSprite(p.x + Math.cos(a) * ring, p.y + Math.sin(a) * ring,
                             SP_CHOMPER, CHOMPER_DROP);
      }
      H.effects.shockwave(p.x, p.y, r, C_CHOMPER, CHOMPER_FX);
      H.particles.burst(p.x, p.y, 12, C_CHOMPER, CHOMPER_BITE);
      H.floaters.spawn(p.x, p.y - 40, S.n + ' CHOMPED', C_CHOMPER, 15, 0.9);
      H.grade(run, C_CHOMPER, 0.26, 0.5);
      H.shake.medium();
      H.audio.play('escape');
    },
  },

  get_excited: {
    // "Every kill is a permanent 2% damage and 0.9 move speed, up to 25 stacks.
    //  She does not calm down afterwards."
    init(run, p, ctx) {
      ctx.stacks = 0;
      ctx.kills = run.stats.kills;
      ctx.mods = { damageMult: 0, moveSpeed: 0 };
      p.addBuff('get_excited', FOREVER, ctx.mods);
    },
    tick(run, p, ctx) {
      if (ctx.hookLive || ctx.stacks >= EXCITED_CAP) return;
      const k = run.stats.kills;
      const d = k - ctx.kills;
      if (d <= 0) return;
      ctx.kills = k;
      ctx.stacks = Math.min(EXCITED_CAP, ctx.stacks + d);
      ctx.mods.damageMult = ctx.stacks * EXCITED_STACK;
      ctx.mods.moveSpeed = ctx.stacks * EXCITED_SPEED;
      p.recompute();
    },
    onKill(run, p, ctx) { ctx.hookLive = true; },
  },

});

/**
 * Sweep a blade off the floor. Shared by the passive's proximity poll and by the
 * escape that teleports onto one, because they are the same event and the payout
 * must not depend on which of the two got there.
 */
function collectBlade(run, p, b) {
  b.live = false;
  b.run = null;
  const ctx = p.state('voracity');
  if (ctx.mods) {
    ctx.stacks = (ctx.stacks | 0) + 1;
    ctx.mods.damageMult = ctx.stacks * BLADE_STACK;
    p.recompute();
  }
  p.special.reduce(BLADE_REFUND);
  p.escape.reduce(BLADE_REFUND);
  H.effects.impact(b.x, b.y, C_STEEL, BLADE_PICKUP_FX);
  H.particles.burst(b.x, b.y, 4, C_STEEL, BLADE_SPARK);
  H.audio.play('pickup');
}
