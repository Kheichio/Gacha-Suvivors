// THE RABBIT TRICKSTER — four pillars, one idea.
//
// USAKI is the roster's only character who does not fight the enemy in front of
// her. She fights the FLOOR: every pillar here leaves something lying on it and
// walks away, and the damage happens later, somewhere she is no longer standing.
// That single premise is what all four of these have to protect, so it is worth
// writing down what it costs:
//
//   NOTHING SHE THROWS HURTS ON THE FRAME SHE THROWS IT. Her card says so in as
//   many words and it is the whole character. Carrots are lobbed on a real arc
//   that cannot collide in flight, mines have an arming delay, and THE GRAND
//   SCHEME spends a full second laying itself out before it does one point of
//   damage. She is the only auto-attack in the game with a wind-up measured in
//   seconds, and the trade for it is that everything lands in a radius.
//
//   THE PLAN FAILING IS THE PLAN. `it_backfired` pays when a trap goes off with
//   nobody standing on it — so the passive is not a rider on the kit, it is the
//   kit's payoff condition inverted. It also OWNS the mine lifecycle, for the
//   same reason Kira's passive owns his countdown: "what happens when a thing
//   she left behind runs out" is exactly what that pillar is about, and there is
//   nowhere else in the engine that polls a trap.
//
// The file follows star7.js exactly: `registerAll({...})`, one `import * as H`,
// a module-level constant for every options bag, visual descriptor, targeting
// spec and iteration callback, and NO closure anywhere a frame can reach.
// Nothing branches on a character id — the registry key IS the branch
// (DECISIONS.md §36) — and every number below is either read off `ctx.def` or
// quoted from her own card in src/data/characters.js.

import { registerAll } from './index.js';
import * as H from './helpers.js';

/** A "permanent for the rest of the run" buff duration. */
const FOREVER = 1e9;

// ===========================================================================
//                              PALETTE
// ===========================================================================
// Three colours, all of them already on her own data: the orange of the thing
// she leaves behind, the blue of the uniform she is wearing while she explains
// the plan, and the near-black her ordnance is outlined in. Deliberately no
// fourth: a kit where every effect is the same two colours reads as ONE
// character's ordnance going off in six different places, which is the whole
// silhouette problem a trap character has.
const C_CARROT = '#ff8f2e';
const C_UNIFORM = '#5b8fe0';
const C_NIGHT = '#1e2f5c';

// ===========================================================================
//                    THE ONE PROP SHE OWNS, IN TWO SIZES
// ===========================================================================
// Everything she leaves on the floor is the same object. That is not laziness:
// a barrage carrot, a panic-hop mine and one of THE GRAND SCHEME's numbered
// charges all kill you the same way for the same reason, and drawing them as
// three different things would be three lies about how the kit works. One
// silhouette, in the ground, point-down, is the read — "that is hers, do not
// stand there" — and it has to be learnable in the first thirty seconds.
//
// AND IT IS AN ACTUAL CARROT NOW. It was `triangle`: an orange wedge, which is
// a perfectly serviceable projectile silhouette and says nothing whatsoever
// about what she is throwing. Everything in this kit is a carrot — it is the
// epithet, the joke and the ordnance at once — and it was reading as a dart.
// `SHAPES.carrot` is a tapered root with the leaves IN the stroked path, so the
// top survives the outline pass at the nine pixels the barrage bakes at.
//
// `carrot` points +X, so an `angle` of π/2 stands it on its nose — the fronds
// then sit in the dirt, which is exactly right for something stuck in the
// ground point-down. The prop
// variant is deliberately `flash: false` and not `rotates`: `drawSpriteRotated`
// reads frame 0 and turns on the context, nothing can hit it, and both fields
// are part of the atlas key — a descriptor that differs by one of them
// rasterises a SECOND copy the first time she throws, which is a hitch at the
// exact moment the player casts something and something tests/renderSmoke.js
// fails the build over. Registering both HERE, at module scope, is what puts
// them in the atlas before the boot pass ever looks: `register` is a cache hit
// if prewarm got here first and an ordinary raster if this module loaded first,
// and either way it happens before the first frame.
const V_CARROT = { shape: 'carrot', color: C_CARROT, accent: C_NIGHT, size: 9, rotates: true, glow: true };
const V_ORDNANCE = { shape: 'carrot', color: C_CARROT, accent: C_NIGHT, size: 13, flash: false };
const SP_ORDNANCE = H.atlas.register(V_ORDNANCE);
H.atlas.register(V_CARROT);

/** Standing on its point. Every drop below starts from this. */
const NOSE_DOWN = Math.PI * 0.5;

// ===========================================================================
//                    SHARED SCRATCH FOR ITERATION CALLBACKS
// ===========================================================================
/**
 * Did anything step inside the mine's trigger ring? Written immediately before
 * the sweep that reads it and consumed on the next line, so `steppedOn` can be
 * a function REFERENCE rather than a per-poll closure — and the poll runs on
 * every live mine on every frame she has any.
 */
let MINE_TRIPPED = false;
function steppedOn() { MINE_TRIPPED = true; return false; }

// ===========================================================================
//                   CARROT BARRAGE — the auto-attack
// ===========================================================================
// "4 carrots lobbed in a fan. Each sticks point-down where it lands and pops
//  1.2s later for 24 damage in a 70px burst; one that lands ON something pops
//  immediately instead. Every 0.95s."
const CARROT_COUNT = 4;
/** How wide the fan of LANDING POINTS is, in radians. */
const CARROT_FAN = 0.62;
const CARROT_FLIGHT = 0.44;
const CARROT_FUSE = 1.2;
const CARROT_BLAST = 70;
/**
 * "Lands ON something." Deliberately tight — this is the carrot arriving on a
 * body, not a proximity fuse. A generous number here would quietly delete the
 * 1.2s wind-up that is the entire cost of the ability.
 */
const CARROT_CONTACT = 26;
/**
 * The lob's reach, clamped. The floor matters more than the ceiling: with the
 * crowd already on top of her the target resolves a few pixels away, and four
 * carrots landing inside her own hitbox is a volley that covers nothing. 90px
 * out with a 70px blast still reaches back to her feet.
 */
const CARROT_MIN = 90;
const CARROT_MAX = 620;

/**
 * The lob itself, mutated in place and never rebuilt.
 *
 * MOTION.ARC and not a straight shot, for a reason that is mechanical rather
 * than decorative: `ProjectileSystem.update` skips `_hitEnemies` entirely for
 * an ARC, so a carrot physically CANNOT damage anything between her hand and
 * the floor. Her card's "nothing she throws hurts on the frame she throws it"
 * is therefore enforced by the motion type instead of by everyone remembering.
 *
 * `aoeRadius` stays 0 on purpose. An ARC with one detonates the instant it
 * lands, which is the broadside's contract and the exact opposite of hers — the
 * damage is owned by `popCarrot` a fuse later.
 */
const CARROT_SHOT = {
  motion: H.MOTION.ARC, targetX: 0, targetY: 0, flightTime: CARROT_FLIGHT, arcHeight: 0,
  damage: 0, aoeRadius: 0, radius: 8, visual: V_CARROT, trailColor: C_CARROT,
  owner: null, tag: 'carrot',
};

/**
 * A fixed ring of in-flight carrots.
 *
 * The scheduler swap-and-pops, so a callback cannot be identified by position
 * and every carrot has to carry its own coordinates. Forty-eight slots against
 * four carrots per 0.95s living for flight + fuse (1.64s) is ~7 in play, and
 * the headroom is there for a fully stacked Extra Shot at double attack speed.
 */
const CARROT_SLOTS = 48;
const CARROTS = [];
for (let i = 0; i < CARROT_SLOTS; i++) {
  CARROTS.push({ run: null, x: 0, y: 0, damage: 0, radius: 0, loud: false });
}
let carrotSlot = 0;

const THROW_FX = { speed: 170, life: 0.24, size: 0.34, additive: true };
const DIRT_FX = { speed: 80, life: 0.34, size: 0.3, drag: 5, shape: 'square' };
const CHUNK_FX = { speed: 240, life: 0.46, size: 0.42, drag: 3.6, shape: 'shard' };
const POP_RING = { tier: 0, life: 0.32, width: 4, spokes: 10 };
const POP_POP = { tier: 0, life: 0.22, size: 16 };
const CARROT_HIT = { falloff: 0.2, element: 'steel', knockback: 70 };
/**
 * The carrot standing in the floor for exactly as long as its fuse runs.
 *
 * `fallSprite` is being used for the half of it nobody thinks of: the SHADOW.
 * `from` is 3px, so the prop does not meaningfully fall — but the shadow under
 * it tightens all the way in across the life, which is a fuse the player can
 * read while looking at their own feet, and it ends on the frame the thing goes
 * off. `spin` is 0 because a carrot stuck in the ground does not turn.
 */
const CARROT_STUCK = { tier: 0, life: CARROT_FUSE, from: 3, scale: 1, angle: NOSE_DOWN, spin: 0 };

/**
 * The carrot arrives. Either it landed on somebody — in which case the wind-up
 * was paid for and it goes now — or it sticks and starts counting.
 */
function plantCarrot(rec) {
  const run = rec.run;
  if (!run) return;
  if (H.nearestTo(run, rec.x, rec.y, CARROT_CONTACT, null)) { popCarrot(rec); return; }
  H.effects.fallSprite(rec.x, rec.y, SP_ORDNANCE, CARROT_STUCK);
  H.particles.burst(rec.x, rec.y, 3, C_NIGHT, DIRT_FX);
  run.scheduler.after(CARROT_FUSE, popCarrot, rec);
}

/**
 * The fuse runs out. `loud` is the first carrot of its volley and the only one
 * that makes a noise: four detonations inside a fifth of a second played four
 * times over is a phasing artefact rather than a louder bang.
 */
function popCarrot(rec) {
  const run = rec.run;
  if (!run) return;
  H.areaDamage(run, rec.x, rec.y, rec.radius, rec.damage, H.SRC.AUTO, CARROT_HIT);
  H.effects.burstRing(rec.x, rec.y, rec.radius, C_CARROT, POP_RING);
  H.effects.impact(rec.x, rec.y, C_CARROT, POP_POP);
  H.particles.burst(rec.x, rec.y, 7, C_CARROT, CHUNK_FX);
  H.particles.ring(rec.x, rec.y, 6, C_UNIFORM, rec.radius * 2.4);
  if (rec.loud) H.audio.play('explode');
}

// ===========================================================================
//                   THE GRAND SCHEME — the special
// ===========================================================================
// "She takes a full 1.0s to lay it out properly: 8 numbered charges in a 340px
//  ring with tripwire strung between every pair. Then it goes wrong all at
//  once."   S3: 12 charges, and the tripwires drag from 460px out.
const SCHEME_SETUP = 1.0;
const SCHEME_CHARGES = 8;
const SCHEME_CHARGES_S3 = 12;
const SCHEME_RING = 340;
const SCHEME_CHARGE_DAMAGE = 150;
const SCHEME_CHARGE_RADIUS = 120;
const SCHEME_DRAG = 340;
const SCHEME_DRAG_S3 = 460;
const SCHEME_FINAL_DAMAGE = 200;
const SCHEME_FINAL_RADIUS = 260;
/** How long the wires whip for. Long enough to move a crowd, short enough to
 *  read as a snap rather than as a vortex. */
const SCHEME_WHIP = 0.7;
const SCHEME_WIRE_REFRESH = 0.18;

const SCHEME_HIT = { falloff: 0.25, element: 'steel', knockback: 160 };
const SCHEME_PULL = { param: 300, hitsEnemies: true };
const SCHEME_NOVA = {
  src: H.SRC.SPECIAL, element: 'steel', color: C_CARROT,
  falloff: 0.15, particles: 30, knockback: 260,
};
/**
 * A charge descending into place across the whole wind-up, arriving on the
 * frame it detonates.
 *
 * That timing is the joke and it is deliberate: her card says she takes a full
 * second to lay it out PROPERLY and then it goes wrong all at once, so the last
 * piece of the plan is still being put down when the plan happens. Twelve
 * shadows tightening around a ring is also the only telegraph this move needs —
 * it says exactly where the ring is and exactly when, without a single hazard
 * marker.
 */
const CHARGE_DROP = { tier: 0, life: SCHEME_SETUP, from: 150, scale: 1.15, angle: 0, spin: 1.1 };
const WIRE_FX = { tier: 0, life: 0.26, alpha: 0.7 };
const CHARGE_FX = { tier: 0, life: 0.36, width: 5, spokes: 12 };
const CHARGE_POP = { tier: 0, life: 0.26, size: 20 };

// ===========================================================================
//                      PANIC HOP — the escape
// ===========================================================================
// "Three enormous rabbit hops covering 260px in 0.9s, fully invulnerable,
//  dropping a carrot mine at each launch point."   S5: 5 mines, armed instantly.
const HOP_DIST = 260;
const HOP_MINES = 3;
const HOP_MINES_S5 = 5;
const HOP_AWAY = { mode: 'densestCluster', range: 520 };
/** How high off the floor the ghost chain arcs. This is the whole "enormous". */
const HOP_APEX = 34;
const HOP_GHOSTS = 5;
const HOP_SIZE = 13;
const HOP_FX = { tier: 0, life: 0.34, alpha: 0.5 };
const LAND_FX = { tier: 0, life: 0.3, from: 6, width: 4 };
const KICK_FX = { speed: 210, life: 0.3, size: 0.34, drag: 5, additive: true };

// --- the mines --------------------------------------------------------------
const MINE_DAMAGE = 80;
const MINE_RADIUS = 110;
const MINE_ARM = 0.5;
const MINE_LIFE = 8;
/**
 * The trigger ring, as a share of the blast. Well inside it, because a mine you
 * set off from the far edge of its own explosion is a proximity aura — the
 * enemy has to walk ONTO the thing, and the visible disc is what it covers when
 * they do.
 */
const MINE_TRIGGER = 0.42;
/** How often a live mine asks whether anything is standing on it. */
const MINE_POLL = 0.08;
const MINE_HIT = { falloff: 0.25, element: 'steel', knockback: 220 };
/**
 * The mine's footprint is a 0-dps field, which is doing two jobs at once: it is
 * the only persistent flat-on-the-floor primitive in the engine, and it is
 * sized to the real blast radius, so the disc the player sees IS the area the
 * thing covers. `hitsEnemies: false` because the field is purely a drawing —
 * every point of damage this move deals is resolved by `blowMine` below, and a
 * field that also ticked would be a second, invisible damage source nobody
 * declared.
 */
const MINE_FIELD = { hitsEnemies: false };
/** Falling out of her hands at the top of a hop. */
const MINE_DROP = { tier: 0, life: 0.4, from: 110, scale: 1, angle: NOSE_DOWN, spin: 3.4 };
const ARM_FX = { tier: 0, life: 0.26, size: 12 };

/**
 * EVERYTHING SHE HAS LEFT ON THE FLOOR.
 *
 * A fixed ring, at module scope, and NOT on any ability's `ctx`. Two things
 * force that. Her escape's cooldown is 6s and a mine lives for 8, so mines
 * routinely outlive the cast that placed them — parking them on the escape's
 * scratch object means the next press orphans the previous set. And the pillar
 * that resolves them is the PASSIVE, not the escape, because "a trap that
 * expires without anything stepping on it" is what her passive is about.
 *
 * `run` is stored per record and checked on every tick rather than trusted:
 * clearing the ring in `init` covers the ordinary case, but a mine placed in a
 * run that ended without her passive ever initialising again would otherwise
 * sit in the ring holding a dead run alive. A seeded replay has to start from
 * an empty floor or it is not a replay.
 */
const MINE_SLOTS = 24;
const MINES = [];
for (let i = 0; i < MINE_SLOTS; i++) {
  MINES.push({
    run: null, live: false, x: 0, y: 0,
    damage: 0, radius: 0, trigger: 0, armT: 0, t: 0, pollT: 0, field: null,
  });
}
let mineSlot = 0;

/** Take a mine off the floor: the footprint goes with it, always. */
function retireMine(m) {
  m.live = false;
  const f = m.field;
  m.field = null;
  if (f && f.active && m.run) m.run.hazards.fields.release(f);
}

/** Somebody stood on it. The mine as designed. */
function blowMine(m) {
  const run = m.run;
  const x = m.x, y = m.y, r = m.radius, dmg = m.damage;
  retireMine(m);
  if (!run) return;
  H.areaDamage(run, x, y, r, dmg, H.SRC.ESCAPE, MINE_HIT);
  H.effects.burstRing(x, y, r, C_CARROT, CHARGE_FX);
  H.effects.impact(x, y, C_CARROT, CHARGE_POP);
  H.particles.burst(x, y, 9, C_CARROT, CHUNK_FX);
  H.particles.ring(x, y, 10, C_UNIFORM, r * 2.4);
  H.audio.play('explode');
  H.shake.small();
}

/** One mine, at the point her feet left the floor. */
function dropMine(run, p, x, y, damage, radius, arm) {
  const m = MINES[mineSlot];
  mineSlot = (mineSlot + 1) % MINE_SLOTS;
  // The ring wrapped onto a mine that is still live. Twenty-four slots against
  // five mines per six seconds is four times the headroom this can ever need,
  // so reaching here means something upstream went wrong — and the honest
  // answer is to set the old one off rather than to leak its field forever.
  if (m.live) blowMine(m);
  m.run = run;
  m.live = true;
  m.x = x; m.y = y;
  m.damage = damage;
  m.radius = radius;
  m.trigger = radius * MINE_TRIGGER;
  m.armT = arm;
  m.t = MINE_LIFE;
  m.pollT = 0;
  m.field = H.field(run, p, x, y, radius, MINE_LIFE, 'damage', 0, C_CARROT, MINE_FIELD);
  H.effects.fallSprite(x, y, SP_ORDNANCE, MINE_DROP);
}

// ===========================================================================
//                    IT BACKFIRED — the passive
// ===========================================================================
// "A trap or mine that expires without anything stepping on it goes off anyway
//  out of pure spite: 60 damage in 100px where it sat, 1.5s off every cooldown,
//  and a permanent +1% damage for the rest of the run. Uncapped."
const BACKFIRE_DAMAGE = 60;
const BACKFIRE_RADIUS = 100;
const BACKFIRE_REFUND = 1.5;
const BACKFIRE_STACK = 0.01;
const BACKFIRE_HIT = { falloff: 0.3, element: 'steel', knockback: 120 };
const SPITE_FX = { tier: 0, life: 0.44, width: 6, from: 14, spokes: 14 };

// ===========================================================================

registerAll({

  carrot_barrage: {
    // "4 carrots lobbed in a fan. Each sticks point-down where it lands and pops
    //  1.2s later for 24 damage in a 70px burst; one that lands ON something
    //  pops immediately instead. Every 0.95s."
    //
    // This does NOT go through `H.spread`, and the reason is the motion: an ARC
    // needs a per-projectile landing point and `spread` fans by ANGLE, which for
    // a lob would leave four carrots on four different bearings all at the same
    // range only by accident. So the fan is built here — over landing points,
    // which is what the player actually sees — and the one upgrade `spread`
    // would have applied that this move can use, Extra Shot, is applied by hand
    // through `H.extraShots`. Long Haul and Piercing Will are deliberately
    // absent: a carrot has no travel to lengthen and nothing to pierce.
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;

      const n = CARROT_COUNT + H.extraShots(p);
      const reach = H.clamp(Math.sqrt(H.dist2(o.x, o.y, t.x, t.y)), CARROT_MIN, CARROT_MAX);
      const dmg = H.autoDamage(run, p, ctx.def.damage, opts);
      const r = H.area(p, CARROT_BLAST);
      // The fan opens WITH the count, on the same arithmetic every other volley
      // in the game uses. Ten carrots crammed into the 0.62rad meant for four
      // land in one heap, which is the one shape this move exists not to make.
      const fan = H.fanWidth(n, CARROT_FAN);
      CARROT_SHOT.damage = dmg;
      CARROT_SHOT.owner = p;

      for (let i = 0; i < n; i++) {
        const a = H.fanAngle(i, n, t.angle, CARROT_FAN);
        // The range stagger is stepped off the index rather than rolled: four
        // carrots on one neat arc reads as a machine, and a cosmetic that
        // consumed the run stream would desynchronise a seeded replay for it.
        const d = reach * (0.82 + 0.09 * (i % 3));
        const tx = H.clamp(o.x + Math.cos(a) * d, run.bounds.minX + 30, run.bounds.maxX - 30);
        const ty = H.clamp(o.y + Math.sin(a) * d, run.bounds.minY + 30, run.bounds.maxY - 30);
        CARROT_SHOT.targetX = tx;
        CARROT_SHOT.targetY = ty;
        // A lob that goes further goes higher. A fixed arc height makes a long
        // throw look like a flat line drive and a short one like a mortar.
        CARROT_SHOT.arcHeight = 70 + d * 0.30;
        run.projectiles.fire(o.x, o.y, H.angleTo(o.x, o.y, tx, ty), CARROT_SHOT);

        const rec = CARROTS[carrotSlot];
        carrotSlot = (carrotSlot + 1) % CARROT_SLOTS;
        rec.run = run;
        rec.x = tx; rec.y = ty;
        rec.damage = dmg;
        rec.radius = r;
        rec.loud = i === 0;
        run.scheduler.after(CARROT_FLIGHT, plantCarrot, rec);
      }

      H.particles.cone(o.x, o.y, t.angle, fan + 0.25, 5, C_CARROT, THROW_FX);
      H.audio.play('shoot');
    },
  },

  grand_scheme: {
    // "8 numbered charges in a 340px ring with tripwire strung between every
    //  pair. Then it goes wrong all at once. Every charge detonates for 150
    //  damage in 120px, the wires whip inward and drag everything to the middle,
    //  and the last charge — the one that was never in the plan — goes off
    //  directly under HER for 200 damage in 260px."   S3: 12 charges, 460px drag.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) {
        // THE FINAL FORM does not get to spend a second explaining itself. The
        // mirror keeps the punchline — the charge that goes off underneath —
        // and drops the setup, which is both correct and a better fight.
        const o = H.origin(run, p, opts);
        H.hostileDamage(run, opts, o.x, o.y, H.area(p, SCHEME_FINAL_RADIUS),
                        H.abilityDamage(run, p, SCHEME_FINAL_DAMAGE, opts));
        H.particles.ring(o.x, o.y, 18, C_CARROT, SCHEME_FINAL_RADIUS * 2);
        H.audio.play('explode');
        return;
      }
      ctx.active = true;
      ctx.t = SCHEME_SETUP;
      ctx.n = ctx.s3 ? SCHEME_CHARGES_S3 : SCHEME_CHARGES;
      // The ring is PLACED, not carried: she lays it out where she is standing
      // and is then free to walk out of it, which is the only reason the last
      // charge landing on her is funny rather than mandatory.
      ctx.cx = p.x;
      ctx.cy = p.y;
      ctx.ring = H.area(p, SCHEME_RING);
      ctx.spin = H.runRng.angle();
      ctx.wireT = 0;

      for (let i = 0; i < ctx.n; i++) {
        const a = ctx.spin + (i / ctx.n) * H.TAU;
        const x = ctx.cx + Math.cos(a) * ctx.ring;
        const y = ctx.cy + Math.sin(a) * ctx.ring;
        // Each charge comes down at its own attitude, stepped off the index so
        // twelve of them do not descend in lockstep and a seed drops them the
        // same way twice.
        CHARGE_DROP.angle = NOSE_DOWN + i * 0.5;
        CHARGE_DROP.spin = (i & 1) ? -1.1 : 1.1;
        H.effects.fallSprite(x, y, SP_ORDNANCE, CHARGE_DROP);
        // "NUMBERED charges." They are numbered because she numbered them, and
        // the numbers are the only part of the plan that ever works.
        H.floaters.spawn(x, y - 20, String(i + 1), C_UNIFORM, 15, SCHEME_SETUP);
      }

      H.grade(run, C_UNIFORM, 0.4, 0.6);
      H.announce(run, 'THE GRAND SCHEME', C_CARROT);
      H.camera.punch(0.04, 0.35);
      H.audio.play('telegraph');
    },
    tick(run, p, ctx, dt) {
      // THE TRIPWIRE, strung between every pair while the charges come down.
      // Redrawn on a cadence rather than every frame: `effects.beam` is pooled
      // and a wire with a fifth of a second of life overlaps its own refresh, so
      // twelve wires cost twelve spawns every 0.18s instead of twelve a frame.
      ctx.wireT -= dt;
      if (ctx.wireT > 0) return;
      ctx.wireT = SCHEME_WIRE_REFRESH;
      for (let i = 0; i < ctx.n; i++) {
        const a0 = ctx.spin + (i / ctx.n) * H.TAU;
        const a1 = ctx.spin + ((i + 1) / ctx.n) * H.TAU;
        H.effects.beam(ctx.cx + Math.cos(a0) * ctx.ring, ctx.cy + Math.sin(a0) * ctx.ring,
                       ctx.cx + Math.cos(a1) * ctx.ring, ctx.cy + Math.sin(a1) * ctx.ring,
                       4, C_UNIFORM, WIRE_FX);
      }
    },
    end(run, p, ctx) {
      // IT GOES WRONG ALL AT ONCE, in the order her card describes it: the ring
      // first, then the wires, then the part she did not plan.
      const dmg = H.abilityDamage(run, p, SCHEME_CHARGE_DAMAGE);
      const r = H.area(p, SCHEME_CHARGE_RADIUS);
      for (let i = 0; i < ctx.n; i++) {
        const a = ctx.spin + (i / ctx.n) * H.TAU;
        const x = ctx.cx + Math.cos(a) * ctx.ring;
        const y = ctx.cy + Math.sin(a) * ctx.ring;
        H.areaDamage(run, x, y, r, dmg, H.SRC.SPECIAL, SCHEME_HIT);
        H.effects.burstRing(x, y, r, C_CARROT, CHARGE_FX);
        H.effects.impact(x, y, C_CARROT, CHARGE_POP);
        H.particles.burst(x, y, 6, C_CARROT, CHUNK_FX);
      }

      // THE WIRES WHIP INWARD. A pull field rather than one displacement, so
      // anything that survived the ring is still being dragged toward the middle
      // when it works out that the middle is the worst place in the arena.
      H.field(run, p, ctx.cx, ctx.cy,
              ctx.s3 ? SCHEME_DRAG_S3 : SCHEME_DRAG, SCHEME_WHIP,
              'pull', 0, C_UNIFORM, SCHEME_PULL);

      // AND THE ONE THAT WAS NEVER IN THE PLAN, directly under her.
      //
      // "She is immune to it. Nothing else is" needs no code: `nova` resolves
      // through `areaDamage`, which only ever touches enemies. Stating the
      // immunity here rather than implementing it is the point — nothing in this
      // file may ever be changed to damage her with her own charge.
      H.nova(run, p, p.x, p.y, SCHEME_FINAL_RADIUS,
             H.abilityDamage(run, p, SCHEME_FINAL_DAMAGE), SCHEME_NOVA);
      H.effects.fallSprite(p.x, p.y, SP_ORDNANCE, CHARGE_DROP);
      H.grade(run, C_CARROT, 0.55, 0.7);
      H.flash.fire('#ffffff', 0.45, 2.2);
      H.camera.punch(0.1, 0.6);
      H.shake.big();
      H.floaters.spawn(p.x, p.y - 60, 'THAT WAS THE PLAN', C_UNIFORM, 20, 1.3);
    },
  },

  panic_hop: {
    // "Three enormous rabbit hops covering 260px in 0.9s, fully invulnerable,
    //  dropping a carrot mine at each launch point: 80 damage in a 110px blast,
    //  armed after 0.5s, live for 8s."   S5: 5 mines, armed instantly.
    //
    // Deliberately NOT `H.dash`. Every other escape in the game is one
    // displacement with a ghost chain down the line it took; this is three, and
    // the difference has to be visible or "three enormous hops" is a sentence on
    // a card that the move never says. Each leg builds its own chain over an
    // ARC that leaves the floor, so she is legibly airborne between the mines
    // rather than sliding between them — and none of the legs deals damage,
    // because nothing she does hurts on the frame she does it.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) return false;      // the boss does not panic
      let a = p.facing;
      if (p.movingT <= 0) {
        const t = H.target(run, p, HOP_AWAY);
        if (t.found) a = t.angle + Math.PI;
      }
      // `ctx.def.iframes` is 0.9 and her card says the hops cover 260px in 0.9s.
      // That is the same number twice on purpose: she is invulnerable for
      // exactly as long as she is in the air, and reading both off the data
      // means a re-price of one can never leave her landing unprotected.
      const air = ctx.def.iframes;
      ctx.angle = a;
      ctx.hops = ctx.s5 ? HOP_MINES_S5 : HOP_MINES;
      ctx.gap = air / ctx.hops;
      ctx.step = HOP_DIST * (p.flags.escapeDistanceMult || 1) / ctx.hops;
      ctx.arm = ctx.s5 ? 0 : MINE_ARM;
      ctx.damage = H.abilityDamage(run, p, MINE_DAMAGE);
      ctx.radius = H.area(p, MINE_RADIUS);
      ctx.active = true;
      ctx.t = air;
      H.applyInvuln(p.st, air + 0.15);
      H.grade(run, C_CARROT, 0.2, 0.3);
      H.audio.play('escape');

      hop(run, p, ctx);                         // the first one, on the press
      ctx.left = ctx.hops - 1;
      ctx.next = ctx.gap;
    },
    tick(run, p, ctx, dt) {
      if (ctx.left <= 0) return;
      ctx.next -= dt;
      if (ctx.next > 0) return;
      ctx.next = ctx.gap;
      ctx.left--;
      hop(run, p, ctx);
    },
  },

  it_backfired: {
    // "Nothing she leaves lying around is wasted. A trap or mine that expires
    //  without anything stepping on it goes off anyway out of pure spite: 60
    //  damage in 100px where it sat, 1.5s off every cooldown, and a permanent
    //  +1% damage for the rest of the run. Uncapped."
    //
    // THIS PILLAR ALSO OWNS THE MINEFIELD, exactly the way Kira's passive owns
    // his countdown and for the same reason: "what happens when a thing she left
    // behind runs out" is what this passive IS, and there is nowhere else in the
    // engine that polls a trap. Putting the poll on the escape instead would
    // stop it the moment the escape's own duration ended, six seconds before the
    // mines it placed expire.
    init(run, p, ctx) {
      ctx.stacks = 0;
      ctx.mods = { damageMult: 0 };
      p.addBuff('it_backfired', FOREVER, ctx.mods);
      // A run starts on an empty floor. See the note on MINES.
      for (let i = 0; i < MINE_SLOTS; i++) {
        const m = MINES[i];
        m.live = false; m.run = null; m.field = null;
      }
      mineSlot = 0;
    },
    tick(run, p, ctx, dt) {
      let spited = 0;
      for (let i = 0; i < MINE_SLOTS; i++) {
        const m = MINES[i];
        if (!m.live) continue;
        // A mine from a run that is already over. It cannot be detonated (its
        // arena is gone) and it must not keep that run alive, so it is dropped.
        if (m.run !== run) { m.live = false; m.run = null; m.field = null; continue; }

        // AN UNARMED MINE IS NEITHER STEPPABLE NOR EXPIRABLE. Both halves
        // matter: walking over one she has just dropped has to be safe for the
        // enemy chasing her, and a mine cannot backfire before it was ever a
        // trap.
        if (m.armT > 0) {
          m.armT -= dt;
          if (m.armT <= 0) {
            H.effects.impact(m.x, m.y, C_CARROT, ARM_FX);
            H.audio.play('pickup');
          }
          continue;
        }

        m.t -= dt;
        if (m.t <= 0) {
          // NOBODY STEPPED ON IT. This is the payoff, and it is the only one in
          // the game that fires because an ability DIDN'T work.
          const x = m.x, y = m.y;
          retireMine(m);
          H.areaDamage(run, x, y, H.area(p, BACKFIRE_RADIUS),
                       H.abilityDamage(run, p, BACKFIRE_DAMAGE), H.SRC.SPECIAL, BACKFIRE_HIT);
          H.effects.shockwave(x, y, H.area(p, BACKFIRE_RADIUS), C_UNIFORM, SPITE_FX);
          H.effects.impact(x, y, C_CARROT, CHARGE_POP);
          H.particles.burst(x, y, 8, C_CARROT, CHUNK_FX);
          // "1.5s off every cooldown" — the two the player can see and plan
          // around. Relic interval clocks are deliberately left alone: they are
          // metronomes rather than decisions, and a passive that silently
          // accelerated six of them would be impossible to read on the HUD.
          p.special.reduce(BACKFIRE_REFUND);
          p.escape.reduce(BACKFIRE_REFUND);
          ctx.stacks++;
          spited++;
          continue;
        }

        m.pollT -= dt;
        if (m.pollT > 0) continue;
        m.pollT = MINE_POLL;
        MINE_TRIPPED = false;
        H.forEachEnemyIn(run, m.x, m.y, m.trigger, steppedOn);
        if (MINE_TRIPPED) blowMine(m);
      }

      // A full Panic Hop can retire three mines on the same frame, so the buff
      // is rebuilt once from the count rather than added to three times — and
      // the player is told once, with the total, instead of three times over.
      if (spited <= 0) return;
      ctx.mods.damageMult = ctx.stacks * BACKFIRE_STACK;
      p.recompute();
      H.floaters.spawn(p.x, p.y - 48, 'IT BACKFIRED', C_CARROT, 18, 1.1);
      H.audio.play('explode');
    },
  },

});

// ---------------------------------------------------------------------------
// Module-level helpers. Declared once so nothing in a per-frame path ever
// creates a closure.
// ---------------------------------------------------------------------------

/**
 * ONE HOP.
 *
 * The mine goes down at the LAUNCH point — where her feet were, not where they
 * land — which is what makes the move a retreat that costs the ground behind
 * her rather than a bomb she throws forward. The ghost chain arcs off the floor
 * by `HOP_APEX` at the midpoint and is brightest there, because a hop is
 * highest where it is fastest and she is already coming down by the time the
 * next mine is in her hand.
 */
function hop(run, p, ctx) {
  const x0 = p.x, y0 = p.y;
  dropMine(run, p, x0, y0, ctx.damage, ctx.radius, ctx.arm);

  p.x = H.clamp(x0 + Math.cos(ctx.angle) * ctx.step, run.bounds.minX, run.bounds.maxX);
  p.y = H.clamp(y0 + Math.sin(ctx.angle) * ctx.step, run.bounds.minY, run.bounds.maxY);
  p.px = p.x; p.py = p.y;
  // Re-asserted per leg rather than trusted from the cast: a hop that outlives
  // its own window by a frame is a frame she is standing in a crowd she just
  // mined.
  H.applyInvuln(p.st, ctx.gap + 0.2);

  for (let i = 0; i <= HOP_GHOSTS; i++) {
    const f = i / HOP_GHOSTS;
    const lift = Math.sin(f * Math.PI);
    HOP_FX.alpha = 0.28 + 0.5 * lift;
    H.effects.afterimage(H.lerp(x0, p.x, f), H.lerp(y0, p.y, f) - lift * HOP_APEX,
                         ctx.angle, HOP_SIZE, C_UNIFORM, HOP_FX);
  }
  H.effects.shockwave(p.x, p.y, 42, C_UNIFORM, LAND_FX);
  H.particles.cone(x0, y0, ctx.angle + Math.PI, 0.9, 5, C_UNIFORM, KICK_FX);
}
