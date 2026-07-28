// WEAPON IMPLEMENTATIONS — one entry per `kind` in data/weapons.js.
//
// These are the same shape as the character ability registry: pure functions,
// keyed by a string that lives in data, with no branching on who is playing.
// They live in this folder rather than in game/weapons.js for two reasons: the
// helpers module is here, and this is one of the two directories allowed to
// name content ids at all.
//
// SHAPE OF AN ENTRY
//   fire(run, p, w, s)          one activation. `w` is the runtime weapon
//                               record (level, evolved, per-weapon scratch in
//                               `w.state`), `s` the resolved stat row.
//   persist(run, p, w, s, dt)   optional, called EVERY FRAME once the weapon has
//                               evolved and its stat row sets `persist`. This is
//                               how "always active" is actually always active
//                               rather than merely frequent.
//
// Damage goes through H.abilityDamage so weapons scale with the player's damage
// stat, crit, lifesteal, element bonuses and every relic hook, exactly like
// anything else that goes through damage.js. Areas go through H.area so Wide
// Reach applies. Projectile weapons add p.stats.projectileCount so Extra Shot
// means something for them too — melee and field weapons deliberately do not,
// because "+1 projectile" on a nova has no meaning.
//
// ALLOCATION: every visual descriptor and every options bag is module scope.
// A weapon firing five projectiles ten times a second must not build objects.

import * as H from './helpers.js';
import { MOTION } from '../projectile.js';
import { SRC } from '../damage.js';

const TAU = Math.PI * 2;

/**
 * Where a weapon points when it needs a direction.
 * The nearest enemy if there is one in reach, otherwise the way you are facing —
 * so a weapon never fires into empty space while something is behind you.
 */
function aimAt(run, p, range) {
  const e = H.nearestTo(run, p.x, p.y, range || 700, null);
  if (e) return Math.atan2(e.y - p.y, e.x - p.x);
  return p.facing;
}

/** Extra projectiles from the Extra Shot upgrade, for projectile weapons only. */
function extra(p) { return p.stats.projectileCount | 0; }

// --- shared options bags -----------------------------------------------------
const PROJ_OPTS = {
  speed: 0, damage: 0, life: 0, radius: 0, pierce: 0, motion: 0, visual: null,
  knockback: 0, target: null, turnRate: 0, owner: null, tag: '',
  aoeRadius: 0, aoeDamage: 0, onHit: null, onExpire: null, trailColor: null,
  host: null, orbitAngle: 0, orbitRadius: 0, orbitSpeed: 0,
  targetX: 0, targetY: 0, flightTime: 0, arcHeight: 0,
};
const NEAR = [];

/**
 * A cone hit plus its ANIMATED swing, without meleeArc's audio.
 *
 * `tier` is the weapon's own evolved flag, not the character's: a Blade Arc you
 * took to ENDLESS EDGE has to look different from one at level 3 even on a
 * character whose signature is still un-evolved. That is the entire point of
 * the request — an evolution you cannot see is an evolution you have to take on
 * faith.
 */
const SWING = { tier: 0, life: 0.2, width: 0, sweep: 1, color2: null };
let SWING_DIR = 1;
function slash(run, p, x, y, angle, arc, radius, damage, color, knockback, tier) {
  const r = H.area(p, radius);
  const hits = H.coneDamage(run, x, y, angle, arc, r, damage, SRC.AUTO, {
    knockback: knockback, crit: undefined,
  });
  SWING_DIR = -SWING_DIR;                       // combos read left-right-left
  SWING.tier = tier || 0;
  SWING.life = tier ? 0.26 : 0.2;
  SWING.sweep = SWING_DIR;
  SWING.color2 = tier ? '#ffe9a3' : null;
  H.effects.slash(x, y, angle, arc, r, color, SWING);
  return hits;
}

/** The tier a weapon's effects should draw at. One place, so it cannot drift. */
function tierOf(w) { return w.evolved ? H.FX_TIER.EVOLVED : H.FX_TIER.NORMAL; }

/** The visual an evolved weapon fires, falling back to its base descriptor. */
function visualOf(w) {
  return (w.evolved && w.def.evolution.visual) || w.def.visual;
}

/**
 * THE ONE OPTIONS BAG EVERY effects.* CALL BELOW REUSES.
 *
 * `effects` copies every field out synchronously on spawn, so a single mutable
 * scratch object is safe and keeps the whole animated layer allocation free.
 * `wfx()` resets EVERY field for the same reason helpers.js does: a `spokes`
 * left over from the previous call site is the kind of bug that shows up months
 * later as "the chain sometimes draws a starburst".
 */
const WFX = {
  tier: 0, life: 0, alpha: 1, sweep: 1, color2: null,
  width: 0, from: 0, spokes: 0, size: 0, angle: 0, double: false,
};
function wfx(tier) {
  WFX.tier = tier; WFX.life = 0; WFX.alpha = 1; WFX.sweep = 1; WFX.color2 = null;
  WFX.width = 0; WFX.from = 0; WFX.spokes = 0; WFX.size = 0; WFX.angle = 0;
  WFX.double = false;
  return WFX;
}

export const WEAPON_IMPLS = Object.create(null);

// ---------------------------------------------------------------------------
// ARC — the sword swing. The archetype the whole system was designed around:
// small and slow at level 1, a 360° blender once it evolves.
// ---------------------------------------------------------------------------
WEAPON_IMPLS.arc = {
  fire(run, p, w, s) {
    const dmg = H.abilityDamage(run, p, s.damage);
    const n = s.count || 1;
    // The evolved form spins on its own axis instead of aiming, which is what
    // turns "a swing toward something" into "a blade that is simply orbiting".
    let base;
    if (s.spin) {
      w.phase = (w.phase || 0) + s.spin * s.interval;
      base = w.phase;
    } else {
      base = aimAt(run, p, H.area(p, s.radius) + 240);
    }
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? base : base - 0.5 + (i / (n - 1)) * 1.0;
      slash(run, p, p.x, p.y, a, s.arc, s.radius, dmg,
                  w.evolved ? '#ffd76a' : '#ffe86a', s.knockback, tierOf(w));
    }
    H.particles.cone(p.x, p.y, base, s.arc, 5, '#ffe86a',
                     { speed: 240, life: 0.18, size: 0.5 });
    H.audio.play('slash');
  },
};

// ---------------------------------------------------------------------------
// ORBIT — shards on a ring around the player. Periodic until it evolves, at
// which point the ring is simply never allowed to empty.
// ---------------------------------------------------------------------------
WEAPON_IMPLS.orbit = {
  fire(run, p, w, s) {
    if (!w.state.orbs) w.state.orbs = [];
    const orbs = w.state.orbs;
    const dmg = H.abilityDamage(run, p, s.damage);
    const radius = H.area(p, s.radius);
    const n = s.count;
    // TWO RINGS once there are enough shards for it.
    //
    // A single ring is a fence at exactly one distance: push the radius out to
    // cover more ground and it starts passing straight OVER everything standing
    // close to you. Alternating shards onto an inner ring is what stops a bigger
    // orbit from being a worse orbit — and it is why the evolved form is
    // strictly better than the maxed one rather than merely wider.
    const inner = n >= 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (w.phase || 0);
      const rr = inner && (i & 1) ? radius * 0.58 : radius;
      PROJ_OPTS.speed = 0;
      PROJ_OPTS.damage = dmg;
      PROJ_OPTS.life = s.duration;
      PROJ_OPTS.radius = 11 * p.stats.areaMult;
      PROJ_OPTS.pierce = s.pierce;
      PROJ_OPTS.motion = MOTION.ORBIT;
      PROJ_OPTS.visual = visualOf(w);
      PROJ_OPTS.knockback = 40;
      PROJ_OPTS.owner = p;
      PROJ_OPTS.tag = w.id;
      PROJ_OPTS.host = p;
      PROJ_OPTS.orbitAngle = a;
      PROJ_OPTS.orbitRadius = rr;
      // The inner ring counter-rotates, so a shard sweeps past a given point
      // twice as often as the ring's own period would suggest.
      PROJ_OPTS.orbitSpeed = (inner && (i & 1)) ? -s.speed : s.speed;
      const pr = run.projectiles.fire(p.x + Math.cos(a) * rr,
                                      p.y + Math.sin(a) * rr, a, PROJ_OPTS);
      if (pr) orbs.push(pr);
    }
    w.phase = (w.phase || 0) + 0.7;
    H.audio.play('uiMove');
  },
  persist(run, p, w, s) {
    // Top the ring back up the instant a shard expires, rather than waiting out
    // an interval. Without this the "permanent" halo visibly blinks.
    const orbs = w.state.orbs;
    if (!orbs) return;
    let alive = 0;
    for (let i = 0; i < orbs.length; i++) {
      if (orbs[i] && orbs[i].active && orbs[i].tag === w.id) alive++;
      else { orbs.splice(i, 1); i--; }
    }
    if (alive < s.count) WEAPON_IMPLS.orbit.fire(run, p, w, s);
  },
};

// ---------------------------------------------------------------------------
// SPREAD — the knife fan. Aimed at level 1, omnidirectional once evolved.
// ---------------------------------------------------------------------------
WEAPON_IMPLS.spread = {
  fire(run, p, w, s) {
    const dmg = H.abilityDamage(run, p, s.damage);
    const n = Math.max(1, s.count + extra(p));
    const full = s.arc >= 6.0;                    // the evolved 360° form
    const base = full ? (w.phase = (w.phase || 0) + 0.41) : aimAt(run, p, 760);
    for (let i = 0; i < n; i++) {
      const a = full ? base + (i / n) * TAU
              : n === 1 ? base : base - s.arc / 2 + (i / (n - 1)) * s.arc;
      PROJ_OPTS.speed = H.projSpeed(p, s.speed);
      PROJ_OPTS.damage = dmg;
      PROJ_OPTS.life = s.life * p.stats.projectileSpeedMult;
      PROJ_OPTS.radius = 8 * p.stats.areaMult;
      PROJ_OPTS.pierce = H.pierce(p, s.pierce);
      PROJ_OPTS.motion = MOTION.STRAIGHT;
      PROJ_OPTS.visual = visualOf(w);
      PROJ_OPTS.knockback = 30;
      PROJ_OPTS.owner = p;
      PROJ_OPTS.tag = w.id;
      PROJ_OPTS.host = null;
      run.projectiles.fire(p.x, p.y, a, PROJ_OPTS);
    }
    H.audio.play('shoot');
  },
};

// ---------------------------------------------------------------------------
// NOVA — the shock ring. Evolves into a standing field the shock lands on top of.
// ---------------------------------------------------------------------------
WEAPON_IMPLS.nova = {
  fire(run, p, w, s) {
    const dmg = H.abilityDamage(run, p, s.damage);
    H.nova(run, p, p.x, p.y, s.radius, dmg, {
      color: visualOf(w).color, knockback: s.knockback, falloff: 0.2,
      src: SRC.AUTO, shake: false,
    });
    H.shake.small();
  },
  persist(run, p, w, s, dt) {
    // One field, kept alive and glued to the player, rather than a new field
    // every frame — 60 hazard spawns a second would exhaust the pool in a blink.
    const st = w.state;
    st.fieldT = (st.fieldT || 0) - dt;
    if (st.fieldT > 0) return;
    st.fieldT = 0.5;
    H.field(run, p, p.x, p.y, s.fieldRadius, 0.6, 'burn',
            s.fieldDps * p.abilityDamageMultiplier(), visualOf(w).color,
            { follow: p });
  },
};

// ---------------------------------------------------------------------------
// WAVE — the bell. Concentric rings, so standing in the middle of a crowd is
// rewarded: an enemy is hit once per ring whose radius reaches it.
// ---------------------------------------------------------------------------
WEAPON_IMPLS.wave = {
  fire(run, p, w, s) {
    const dmg = H.abilityDamage(run, p, s.damage);
    const n = s.count;
    for (let i = 0; i < n; i++) {
      const rad = H.area(p, s.radius * (0.45 + 0.55 * ((i + 1) / n)));
      SLOW.amount = s.slow; SLOW.time = s.slowTime;
      WAVE_OPTS.falloff = 0.15;
      WAVE_OPTS.onHit = slowOnHit;
      H.areaDamage(run, p.x, p.y, rad, dmg, SRC.AUTO, WAVE_OPTS);
      run.overlays.rings.push({ x: p.x, y: p.y, r: rad, color: visualOf(w).color });
    }
    H.particles.ring(p.x, p.y, 18, visualOf(w).color, H.area(p, s.radius) * 3);
    H.audio.play('explode');
  },
  persist(run, p, w, s, dt) {
    const st = w.state;
    st.fieldT = (st.fieldT || 0) - dt;
    if (st.fieldT > 0) return;
    st.fieldT = 0.5;
    H.field(run, p, p.x, p.y, s.fieldRadius, 0.6, 'chill',
            s.fieldDps * p.abilityDamageMultiplier(), visualOf(w).color,
            { follow: p, param: s.slow });
  },
};

// ---------------------------------------------------------------------------
// HOMING — the wisps. They pick their own targets, which is the entire pitch:
// a weapon you never have to aim while you are busy not dying.
// ---------------------------------------------------------------------------
WEAPON_IMPLS.homing = {
  fire(run, p, w, s) {
    const dmg = H.abilityDamage(run, p, s.damage);
    const n = Math.max(1, s.count + extra(p));
    H.collectNearest(run, p, 620, null, Math.min(12, n), NEAR);
    const burn = s.burn * p.abilityDamageMultiplier();
    for (let i = 0; i < n; i++) {
      const t = NEAR[i % Math.max(1, NEAR.length)] || null;
      const a = t ? Math.atan2(t.y - p.y, t.x - p.x) : p.facing + (i / n) * TAU;
      PROJ_OPTS.speed = H.projSpeed(p, s.speed);
      PROJ_OPTS.damage = dmg;
      PROJ_OPTS.life = s.life;
      PROJ_OPTS.radius = 9 * p.stats.areaMult;
      PROJ_OPTS.pierce = H.pierce(p, 0);
      PROJ_OPTS.motion = MOTION.HOMING;
      PROJ_OPTS.visual = visualOf(w);
      PROJ_OPTS.knockback = 20;
      PROJ_OPTS.owner = p;
      PROJ_OPTS.tag = w.id;
      PROJ_OPTS.host = null;
      PROJ_OPTS.target = t;
      PROJ_OPTS.turnRate = s.turnRate;
      PROJ_OPTS.trailColor = visualOf(w).color;
      PROJ_OPTS.onHit = burnOnHit;
      BURN.amount = burn;
      BURN.time = s.burnTime;
      run.projectiles.fire(p.x, p.y, a, PROJ_OPTS);
    }
    PROJ_OPTS.onHit = null;
    PROJ_OPTS.trailColor = null;
    PROJ_OPTS.target = null;
    H.audio.play('shoot');
  },
};

/**
 * The wisp burn. A module-level callback reading module-level params rather
 * than a closure per projectile — the burn magnitude only changes on level-up,
 * so reading the live value at impact is both correct and free.
 */
const BURN = { amount: 0, time: 0 };
function burnOnHit(pr, e, run) {
  H.applyBurn(e.st, BURN.amount, BURN.time);
}

// ---------------------------------------------------------------------------
// LASH — long thin cones in the cardinal directions. The reach weapon: it hits
// things that are not near you yet, which is a defensive stat wearing a hat.
// ---------------------------------------------------------------------------
const LASH_DIRS = [0, Math.PI, -Math.PI / 2, Math.PI / 2, -Math.PI / 4, Math.PI * 0.75];
WEAPON_IMPLS.lash = {
  fire(run, p, w, s) {
    const dmg = H.abilityDamage(run, p, s.damage);
    // Face the crowd, then lash out around that axis, so the first two lashes
    // are never wasted on empty ground.
    const base = aimAt(run, p, H.area(p, s.radius) + 200);
    for (let i = 0; i < s.count; i++) {
      slash(run, p, p.x, p.y, base + LASH_DIRS[i % LASH_DIRS.length],
            s.arc, s.radius, dmg, visualOf(w).color, s.knockback, tierOf(w));
    }
    H.audio.play('slash');
  },
};

// ---------------------------------------------------------------------------
// MORTAR — shells onto the thickest part of the crowd. Fire and forget.
// ---------------------------------------------------------------------------
const METEOR = { dps: 0, time: 0, color: '#ff7a3d', radius: 0 };
function meteorLand(pr, run) {
  if (METEOR.time <= 0) return;
  run.hazards.spawnField(pr.x, pr.y, METEOR.radius, METEOR.time, 'burn',
                         METEOR.dps, METEOR.color);
}

/** The bell's slow, on the same module-level-params pattern as the wisp burn. */
const SLOW = { amount: 0, time: 0 };
const WAVE_OPTS = { falloff: 0, onHit: null };
function slowOnHit(e) { H.applySlow(e.st, SLOW.amount, SLOW.time); }

const DENSE_SPEC = { mode: 'densestCluster', range: 0 };
WEAPON_IMPLS.mortar = {
  fire(run, p, w, s) {
    const dmg = H.abilityDamage(run, p, s.damage);
    DENSE_SPEC.range = s.range;
    const t = H.target(run, p, DENSE_SPEC);
    const cx = t.found ? t.x : p.x + Math.cos(p.facing) * s.range * 0.5;
    const cy = t.found ? t.y : p.y + Math.sin(p.facing) * s.range * 0.5;
    const blast = H.area(p, s.blast);
    METEOR.dps = (s.fieldDps || 0) * p.abilityDamageMultiplier();
    METEOR.time = s.fieldTime || 0;
    METEOR.color = visualOf(w).color;
    METEOR.radius = blast * 0.8;
    for (let i = 0; i < s.count; i++) {
      // Scatter the salvo so five shells are five craters, not one.
      const a = H.runRng.angle();
      const d = i === 0 ? 0 : H.runRng.range(30, 40 + blast * 0.9);
      PROJ_OPTS.speed = 0;
      PROJ_OPTS.damage = dmg;
      PROJ_OPTS.life = 0;
      PROJ_OPTS.radius = 12;
      PROJ_OPTS.pierce = 0;
      PROJ_OPTS.motion = MOTION.ARC;
      PROJ_OPTS.visual = visualOf(w);
      PROJ_OPTS.owner = p;
      PROJ_OPTS.tag = w.id;
      PROJ_OPTS.host = null;
      PROJ_OPTS.aoeRadius = blast;
      PROJ_OPTS.aoeDamage = dmg;
      PROJ_OPTS.targetX = cx + Math.cos(a) * d;
      PROJ_OPTS.targetY = cy + Math.sin(a) * d;
      PROJ_OPTS.flightTime = 0.55 + i * 0.07;
      PROJ_OPTS.arcHeight = 150;
      PROJ_OPTS.onExpire = s.fieldTime ? meteorLand : null;
      run.projectiles.fire(p.x, p.y - 10, 0, PROJ_OPTS);
    }
    PROJ_OPTS.onExpire = null;
    PROJ_OPTS.aoeRadius = 0;
    PROJ_OPTS.aoeDamage = 0;
  },
};

// ===========================================================================
// THE SIX THAT ARE NOT "A SHAPE ON A TIMER"
// ===========================================================================
// Everything above resolves inside a single fire() call: aim, damage a shape,
// draw the shape, done. The six below all break that in some specific way —
// they read state from LAST time they fired, they schedule work for later, they
// spawn things that spawn things, or they move the enemies before hitting them.
// The comment above each one names which.

// ---------------------------------------------------------------------------
// BLOOM — ground that persists, and grows where you stop.
//
// THE STATE IT KEEPS: an ANCHOR. Every other weapon fires from wherever the
// player happens to be; this one remembers where the last bed went down and
// asks whether you have left it. If you have, that is a new bed and the old one
// keeps burning behind you — a trail. If you have not, the bed you are standing
// on thickens by one ring instead. Walking and standing are two different
// weapons here, and neither one is the "correct" way to play it.
// ---------------------------------------------------------------------------
const BLOOM_FIELD = { fx: false };
const BLOOM_HIT = { falloff: 0.25, knockback: 30 };
WEAPON_IMPLS.bloom = {
  fire(run, p, w, s) {
    const st = w.state;
    const v = visualOf(w);
    const tier = tierOf(w);
    const dmg = H.abilityDamage(run, p, s.damage);
    const base = H.area(p, s.radius);

    // "Have you left the bed?" is a distance test against the bed's OWN size, so
    // a wide late-game bed is harder to walk out of than a level-1 one. That is
    // deliberate: the weapon should get more willing to trail you, not less.
    const moved = st.anchorX === undefined ||
                  H.dist2(st.anchorX, st.anchorY, p.x, p.y) > base * base * 0.38;
    const fromX = st.anchorX, fromY = st.anchorY;
    if (moved) { st.anchorX = p.x; st.anchorY = p.y; st.stacks = 0; }
    else st.stacks = Math.min(s.count, (st.stacks || 0) + 1);

    const stacks = st.stacks | 0;
    const raw = s.radius * (1 + stacks * 0.15);
    const r = H.area(p, raw);
    const x = st.anchorX, y = st.anchorY;

    // The bed itself: standing ground that keeps working after the swing that
    // made it is long gone. Its damage is baked in at spawn, because a hazard
    // field ticks long after this frame's multipliers are gone.
    H.field(run, p, x, y, raw, s.duration, 'damage', dmg * 0.85, v.color, BLOOM_FIELD);
    // ...and the bite as it opens, which is the part that crits.
    H.areaDamage(run, x, y, r, dmg, SRC.AUTO, BLOOM_HIT);

    const f = wfx(tier);
    f.from = r * 0.34; f.life = 0.42; f.width = Math.max(3, r * 0.16);
    H.effects.shockwave(x, y, r, v.color, f);

    if (moved) {
      const g = wfx(tier);
      g.size = Math.max(10, r * 0.42); g.life = 0.26;
      H.effects.impact(x, y, v.color, g);
      // The creeper between the old bed and the new one, so a trail reads as one
      // continuous thing rather than a row of unrelated circles.
      if (fromX !== undefined) {
        const b = wfx(tier);
        b.life = 0.30;
        H.effects.beam(fromX, fromY, x, y, Math.max(4, r * 0.22), v.color, b);
      }
    } else {
      // Standing still: spokes push OUTWARD as the bed spreads, one more spoke
      // per ring, so the growth is countable at a glance.
      const g = wfx(tier);
      g.spokes = 6 + stacks; g.life = 0.36; g.width = Math.max(2, r * 0.06);
      H.effects.burstRing(x, y, r, v.color, g);
    }
    H.particles.ring(x, y, 8, v.color, r * 1.8);
    H.audio.play('uiMove');
  },
  persist(run, p, w, s, dt) {
    // OVERGROWTH: a seam under your feet between the beds, so a sprint no longer
    // leaves gaps to walk back through. Short-lived and small — the beds are
    // still the weapon; this is what joins them up.
    const st = w.state;
    st.creepT = (st.creepT || 0) - dt;
    if (st.creepT > 0) return;
    st.creepT = 0.22;
    H.field(run, p, p.x, p.y, s.radius * 0.5, 1.0, 'damage',
            H.abilityDamage(run, p, s.damage) * 0.5, visualOf(w).color, BLOOM_FIELD);
  },
};

// ---------------------------------------------------------------------------
// CHAIN — a bolt that gains damage on every jump.
//
// WHAT IT BREAKS: one activation, MANY resolutions, each one bigger than the
// last and each one starting from where the previous ended. There is no
// projectile — the whole chain resolves inside the frame, which is what lets the
// escalation be visible as a row of brightening beams rather than guessed at.
// ---------------------------------------------------------------------------
const CHAIN_HIT = new Array(16);
const CHAIN_OPTS = { fromX: 0, fromY: 0, knockback: 0 };

/** Nearest enemy to (x, y) that this chain has not already burned. */
let LINK_X = 0, LINK_Y = 0, LINK_N = 0, LINK_D = 0, LINK_BEST = null;
function linkScan(e) {
  for (let i = 0; i < LINK_N; i++) if (CHAIN_HIT[i] === e) return;
  const d = H.dist2(LINK_X, LINK_Y, e.x, e.y);
  if (d < LINK_D) { LINK_D = d; LINK_BEST = e; }
}
function nextLink(run, x, y, radius, n) {
  LINK_X = x; LINK_Y = y; LINK_N = n;
  LINK_D = radius * radius; LINK_BEST = null;
  H.forEachEnemyIn(run, x, y, radius, linkScan);
  return LINK_BEST;
}

WEAPON_IMPLS.chain = {
  fire(run, p, w, s) {
    const v = visualOf(w);
    const tier = tierOf(w);
    const dmg = H.abilityDamage(run, p, s.damage);
    const reach = H.area(p, s.radius);
    const gain = s.gain || 0.3;
    let e = H.nearestTo(run, p.x, p.y, s.range, null);
    if (!e) return;

    const maxLinks = Math.min(CHAIN_HIT.length, (s.count | 0) + 1);
    let n = 0, x = p.x, y = p.y;
    while (e && n < maxLinks) {
      CHAIN_HIT[n] = e;
      CHAIN_OPTS.fromX = x; CHAIN_OPTS.fromY = y;
      CHAIN_OPTS.knockback = s.knockback;
      H.dealDamage(run, e, dmg * (1 + gain * n), SRC.AUTO, CHAIN_OPTS);

      // The link. It gets thicker and lasts longer down the chain, which is the
      // escalation made visible — you can see which end of the wire is the
      // dangerous one without reading a number.
      const b = wfx(tier);
      b.life = 0.15 + n * 0.012;
      H.effects.beam(x, y, e.x, e.y, 4 + n * 1.2, v.color, b);
      const im = wfx(tier);
      im.size = 9 + n * 2.2; im.life = 0.20;
      H.effects.impact(e.x, e.y, v.color, im);

      x = e.x; y = e.y;
      n++;
      let next = nextLink(run, x, y, reach, n);
      // LIVE WIRE: rather than grounding out at the edge of the pack, the
      // evolved form doubles back onto something it has already burned. Without
      // this the evolution is strictly worse than max level against three
      // enemies, because the escalation is capped by the body count.
      if (!next && s.loop) next = nextLink(run, x, y, reach, 0);
      e = next;
    }
    // Drop every enemy reference the scan held: a module-level scratch that
    // keeps pointing at a corpse outlives the run it belongs to.
    for (let i = 0; i < n; i++) CHAIN_HIT[i] = null;
    LINK_BEST = null;

    const f = wfx(tier);
    f.spokes = 8; f.life = 0.24; f.width = 3;
    H.effects.burstRing(p.x, p.y, 34, v.color, f);
    H.audio.play('shoot');
  },
};

// ---------------------------------------------------------------------------
// SHRAPNEL — projectiles whose job is to stop being projectiles.
//
// WHAT IT BREAKS: the pod is not the attack. MOTION.DRIFT_POP drifts it out,
// bleeds its speed off and then bursts it into `popCount` shards travelling in
// every direction — so the damage lands one fuse AFTER the shot, somewhere the
// weapon did not aim. Nothing else in the arsenal spawns a second generation.
// ---------------------------------------------------------------------------
const POD_OPTS = {
  speed: 0, damage: 0, life: 0, radius: 0, pierce: 0, motion: 0, visual: null,
  knockback: 0, owner: null, tag: '', trailColor: null, onExpire: null,
  popTime: 0, popCount: 0, splitDamage: 0,
};
/** Burst params, read by the module-level expire callback. Same pattern as METEOR. */
const POD = { radius: 0, damage: 0, color: '#ffb03d', tier: 0 };
const POD_BURST = { falloff: 0.3, knockback: 60 };
const POD_SPARK = { speed: 190, life: 0.3, size: 0.5, additive: true };
function podBurst(pr, run) {
  if (!(POD.radius > 0)) return;
  H.areaDamage(run, pr.x, pr.y, POD.radius, POD.damage, SRC.AUTO, POD_BURST);
  const f = wfx(POD.tier);
  f.from = POD.radius * 0.28; f.life = 0.34; f.width = Math.max(3, POD.radius * 0.14);
  H.effects.shockwave(pr.x, pr.y, POD.radius, POD.color, f);
  H.particles.burst(pr.x, pr.y, 6, POD.color, POD_SPARK);
}

WEAPON_IMPLS.shrapnel = {
  fire(run, p, w, s) {
    const v = visualOf(w);
    const tier = tierOf(w);
    const dmg = H.abilityDamage(run, p, s.damage);
    const n = Math.max(1, s.count + extra(p));
    const ring = !!s.ring;
    const base = ring ? (w.phase = (w.phase || 0) + 0.37) : aimAt(run, p, 640);

    POD.radius = H.area(p, s.blast);
    POD.damage = dmg * 0.55;
    POD.color = v.color;
    POD.tier = tier;

    for (let i = 0; i < n; i++) {
      const a = ring ? base + (i / n) * TAU
              : n === 1 ? base : base - 0.42 + (i / (n - 1)) * 0.84;
      POD_OPTS.speed = H.projSpeed(p, s.speed);
      POD_OPTS.damage = dmg;
      // The pod must OUTLIVE its own fuse by a tick, or the pop never happens
      // and the whole weapon is a mediocre piercing shot.
      POD_OPTS.life = s.fuse + 0.08;
      POD_OPTS.radius = 9 * p.stats.areaMult;
      POD_OPTS.pierce = H.pierce(p, s.pierce);
      POD_OPTS.motion = MOTION.DRIFT_POP;
      POD_OPTS.visual = v;
      POD_OPTS.knockback = 25;
      POD_OPTS.owner = p;
      POD_OPTS.tag = w.id;
      POD_OPTS.trailColor = v.color;
      POD_OPTS.onExpire = podBurst;
      POD_OPTS.popTime = s.fuse;
      POD_OPTS.popCount = s.shards;
      POD_OPTS.splitDamage = dmg * 0.5;
      run.projectiles.fire(p.x, p.y, a, POD_OPTS);
    }

    const f = wfx(tier);
    f.spokes = ring ? 12 : 7; f.life = 0.26; f.width = 3;
    f.angle = base;
    H.effects.burstRing(p.x, p.y, 40, v.color, f);
    H.audio.play('shoot');
  },
};

// ---------------------------------------------------------------------------
// BOOMERANG — two damage windows per activation, and the second one is bigger.
//
// WHAT IT BREAKS: the throw does not finish the job. The outbound disc converts
// into a RETURNING one — a fresh projectile, deliberately, because the hit
// bookkeeping is per-projectile and a single record can only cut a given body
// once. The return leg carries `returnMult` and detonates when it reaches you,
// which makes the good position "crowd between me and where I threw it".
// ---------------------------------------------------------------------------
const THROW_OPTS = {
  speed: 0, damage: 0, life: 0, radius: 0, pierce: 0, motion: 0, visual: null,
  knockback: 0, owner: null, tag: '', trailColor: null, onHit: null, onExpire: null,
};
const RETURN_OPTS = {
  speed: 0, damage: 0, life: 0, radius: 0, pierce: 0, motion: 0, visual: null,
  knockback: 0, owner: null, tag: '', trailColor: null, onHit: null, onExpire: null,
  aoeRadius: 0, aoeDamage: 0, outTime: 0,
};
const DISC = {
  damage: 0, speed: 0, life: 0, radius: 0, reach: 0, blast: 0, blastDamage: 0,
  knockback: 0, visual: null, color: '#9fd3ff', tag: '', tier: 0,
};

/**
 * Turn the disc around. Fired from BOTH ends of the outbound leg's life.
 *
 * THE CATCH IS PAID FOR BY THE THROW. The detonation scales with how far out the
 * disc actually got before it turned, and that is the rule the whole weapon
 * hangs on. Without it, the cheapest possible play is to stand inside a wall of
 * bodies and let every disc burn its pierce in the first 30px — the turn then
 * happens on top of you, the catch lands instantly, and the weapon degenerates
 * into a point-blank bomb that never travels. Measured: it made a maxed
 * Return Cut out-damage its own evolution, because the evolved disc pierces
 * everything and therefore always makes the full trip.
 */
function discReturn(pr, run) {
  if (!(DISC.life > 0)) return;
  const p = run.player;
  const dx = p.x - pr.x, dy = p.y - pr.y;
  const thrown = Math.sqrt(dx * dx + dy * dy);
  const f = DISC.reach > 0 ? Math.min(1, thrown / DISC.reach) : 1;
  const a = Math.atan2(dy, dx);
  RETURN_OPTS.speed = DISC.speed;
  RETURN_OPTS.damage = DISC.damage;
  RETURN_OPTS.life = DISC.life;
  RETURN_OPTS.radius = DISC.radius;
  // The return leg cuts through everything: it has one job and a fixed distance
  // to do it in, and a disc that dies in the crowd never delivers the catch.
  RETURN_OPTS.pierce = 99;
  RETURN_OPTS.motion = MOTION.BOOMERANG;
  RETURN_OPTS.visual = DISC.visual;
  RETURN_OPTS.knockback = DISC.knockback;
  RETURN_OPTS.tag = DISC.tag;
  RETURN_OPTS.trailColor = DISC.color;
  RETURN_OPTS.aoeRadius = DISC.blast * (0.18 + f * 0.82);
  RETURN_OPTS.aoeDamage = DISC.blastDamage * f * f;
  // Not zero: the projectile system reads `outTime || 0.42`, so a literal 0
  // would be taken for "unset" and the disc would fly on for another 0.42s
  // before deciding to come home.
  RETURN_OPTS.outTime = 1e-4;
  run.projectiles.fire(pr.x, pr.y, a, RETURN_OPTS);

  // The turn, drawn at the strength of the throw that earned it.
  const gh = wfx(DISC.tier);
  gh.life = 0.30; gh.alpha = 0.5 + f * 0.5;
  H.effects.afterimage(pr.x, pr.y, a, DISC.radius * (1.2 + f * 0.9), DISC.color, gh);
  const sh = wfx(DISC.tier);
  sh.from = 4; sh.life = 0.30; sh.width = 4;
  H.effects.shockwave(pr.x, pr.y, DISC.radius * (1.4 + f * 2.0), DISC.color, sh);
}

/**
 * The other end of the outbound leg. A disc that spends its pierce inside a
 * crowd is released without ever expiring, so waiting on `onExpire` alone means
 * the weapon's entire identity silently switches off in exactly the situation it
 * was taken for. `hitCount` is still pre-increment here, so `>= pierce` is the
 * cut that is about to be its last.
 */
function discHit(pr, e, run) {
  if (pr.hitCount >= pr.pierce) discReturn(pr, run);
}

WEAPON_IMPLS.boomerang = {
  fire(run, p, w, s) {
    const v = visualOf(w);
    const tier = tierOf(w);
    const dmg = H.abilityDamage(run, p, s.damage);
    const n = Math.max(1, s.count + extra(p));
    const speed = H.projSpeed(p, s.speed);
    const out = s.radius / s.speed;          // seconds to the turn, at any speed
    const rad = 11 * p.stats.areaMult;
    const base = aimAt(run, p, 720);

    DISC.damage = dmg * (s.returnMult || 1.25);
    DISC.speed = speed;
    DISC.life = out * 2.1;
    DISC.radius = rad;
    DISC.reach = H.area(p, s.radius);
    DISC.blast = H.area(p, s.blast);
    DISC.blastDamage = dmg * 0.55;
    DISC.knockback = s.knockback;
    DISC.visual = v;
    DISC.color = v.color;
    DISC.tag = w.id;
    DISC.tier = tier;

    for (let i = 0; i < n; i++) {
      const a = n === 1 ? base : base - s.arc / 2 + (i / (n - 1)) * s.arc;
      THROW_OPTS.speed = speed;
      THROW_OPTS.damage = dmg;
      THROW_OPTS.life = out;
      THROW_OPTS.radius = rad;
      THROW_OPTS.pierce = H.pierce(p, s.pierce);
      THROW_OPTS.motion = MOTION.STRAIGHT;
      THROW_OPTS.visual = v;
      THROW_OPTS.knockback = s.knockback;
      THROW_OPTS.owner = p;
      THROW_OPTS.tag = w.id;
      THROW_OPTS.trailColor = v.color;
      THROW_OPTS.onHit = discHit;
      THROW_OPTS.onExpire = discReturn;
      run.projectiles.fire(p.x, p.y, a, THROW_OPTS);
    }

    const f = wfx(tier);
    f.spokes = 6; f.life = 0.22; f.width = 3; f.angle = base;
    H.effects.burstRing(p.x, p.y, 36, v.color, f);
    H.audio.play('slash');
  },
};

// ---------------------------------------------------------------------------
// SIPHON — a meter your whole build fills, that pays out in one lump.
//
// WHAT IT BREAKS: the timer is not what decides when the weapon goes off. The
// hum ticks constantly and does very little; what it is really doing is counting
// bodies. Every enemy it touches is +1, and every KILL anywhere in the run — any
// weapon, any relic, a hazard, contact damage — is +5. Fill the meter and the
// core dumps a nova plus an arc into each of the nearest `count` enemies.
//
// Reading `run.stats.kills` as a delta rather than subscribing to the kill event
// is deliberate: no listener to leak, no ordering to get wrong, and it is exact.
// ---------------------------------------------------------------------------
const HUM_OPTS = { follow: null, fx: false };
const SIPHON_TAP = { falloff: 0.15, knockback: 18 };
const SIPHON_ARC = { knockback: 60, canCrit: true };
const SIPHON_NOVA = { color: '#ffd94a', knockback: 0, falloff: 0.15, src: 0, tier: 0, shake: false };

WEAPON_IMPLS.siphon = {
  fire(run, p, w, s) {
    const st = w.state;
    const v = visualOf(w);
    const tier = tierOf(w);
    const dmg = H.abilityDamage(run, p, s.damage);
    const r = H.area(p, s.radius);

    // THE HUM. Small on purpose — its output is the meter, not the number.
    const hits = H.areaDamage(run, p.x, p.y, r, dmg, SRC.AUTO, SIPHON_TAP);

    if (st.kills === undefined) st.kills = run.stats.kills;
    const fresh = run.stats.kills - st.kills;
    st.kills = run.stats.kills;
    // A wave wiped by one meteor should not bank four discharges at once, so
    // the kill credit per tick is capped.
    st.charge = (st.charge || 0) + hits + (fresh > 0 ? Math.min(fresh, 12) * 5 : 0);

    const f = wfx(tier);
    f.spokes = 8; f.life = 0.22; f.width = Math.max(2, r * 0.04);
    H.effects.burstRing(p.x, p.y, r * 0.92, v.color, f);

    if (st.charge < s.charge) return;
    st.charge = 0;

    // THE DISCHARGE.
    const surge = H.abilityDamage(run, p, s.surge);
    SIPHON_NOVA.color = v.color;
    SIPHON_NOVA.src = SRC.AUTO;
    SIPHON_NOVA.tier = tier;
    SIPHON_NOVA.knockback = 220;
    H.nova(run, p, p.x, p.y, s.blast, surge, SIPHON_NOVA);

    const arcs = Math.min(12, s.count | 0);
    H.collectNearest(run, p, H.area(p, s.blast) * 1.3, null, arcs, NEAR);
    for (let i = 0; i < NEAR.length; i++) {
      const e = NEAR[i];
      H.dealDamage(run, e, surge * 0.5, SRC.AUTO, SIPHON_ARC);
      const b = wfx(tier);
      b.life = 0.26;
      H.effects.beam(p.x, p.y, e.x, e.y, 6 + i * 0.4, v.color, b);
    }
    NEAR.length = 0;
    H.shake.medium();
  },
  persist(run, p, w, s, dt) {
    // OVERLOAD: the meter stops being invisible. Both the radius and the damage
    // of the standing field read the LIVE charge, so a nearly-full core is
    // something you watch swell before it goes off.
    const st = w.state;
    st.humT = (st.humT || 0) - dt;
    if (st.humT > 0) return;
    st.humT = 0.35;
    const frac = Math.min(1, (st.charge || 0) / Math.max(1, s.charge));
    HUM_OPTS.follow = p;
    H.field(run, p, p.x, p.y, s.radius * (0.45 + frac * 0.55), 0.45, 'damage',
            H.abilityDamage(run, p, s.damage) * (0.5 + frac * 1.6),
            visualOf(w).color, HUM_OPTS);
    HUM_OPTS.follow = null;
  },
};

// ---------------------------------------------------------------------------
// SINGULARITY — it moves them first, then hits where they will be.
//
// WHAT IT BREAKS: the two halves happen at different times. A well goes down,
// drags everything inside it into one heap for `duration` seconds, and only THEN
// collapses — which is why its blast radius can be smaller than its pull radius
// and still catch more bodies than a nova twice its size.
//
// The delay goes through run.scheduler, and the record it carries holds nothing
// but numbers and a colour string. `run` rides as the scheduler's own argument
// so that clearing the scheduler at the end of a run drops the reference too.
// ---------------------------------------------------------------------------
const WELLS = [];
for (let i = 0; i < 12; i++) {
  WELLS.push({ x: 0, y: 0, r: 0, damage: 0, knockback: 0, color: '#c58cff', tier: 0 });
}
let WELL_I = 0;

const WELL_FIELD = { fx: false };
const COLLAPSE_OPTS = { falloff: 0.2, knockback: 0 };
let PULL_T = 0, PULL_X = 0, PULL_Y = 0, PULL_F = 0;
function pullEnemy(e) { H.applyPull(e.st, PULL_T, PULL_X, PULL_Y, PULL_F); }

function collapseWell(run, k) {
  COLLAPSE_OPTS.knockback = k.knockback;
  H.areaDamage(run, k.x, k.y, k.r, k.damage, SRC.AUTO, COLLAPSE_OPTS);

  const f = wfx(k.tier);
  f.from = k.r * 0.12; f.life = 0.44; f.width = Math.max(4, k.r * 0.14); f.spokes = 16;
  H.effects.shockwave(k.x, k.y, k.r, k.color, f);
  const g = wfx(k.tier);
  g.spokes = 18; g.life = 0.34; g.width = Math.max(2, k.r * 0.05);
  H.effects.burstRing(k.x, k.y, k.r * 0.95, k.color, g);
  const h = wfx(k.tier);
  h.size = Math.max(16, k.r * 0.3); h.life = 0.24;
  H.effects.impact(k.x, k.y, k.color, h);

  H.particles.ring(k.x, k.y, 18, k.color, k.r * 2.6);
  H.shake.small();
  H.audio.play('explode');
}

const WELL_SPEC = { mode: 'densestCluster', range: 0 };
WEAPON_IMPLS.singularity = {
  fire(run, p, w, s) {
    const v = visualOf(w);
    const tier = tierOf(w);
    const dmg = H.abilityDamage(run, p, s.damage);
    WELL_SPEC.range = s.range;
    const t = H.target(run, p, WELL_SPEC);
    const cx = t.found ? t.x : p.x + Math.cos(p.facing) * s.range * 0.4;
    const cy = t.found ? t.y : p.y + Math.sin(p.facing) * s.range * 0.4;
    const pullR = H.area(p, s.radius);
    const blast = H.area(p, s.blast);

    for (let i = 0; i < s.count; i++) {
      // Scatter the extra wells so three stars are three heaps, not one.
      const a = H.runRng.angle();
      const d = i === 0 ? 0 : H.runRng.range(pullR * 0.7, pullR * 1.5);
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;

      // The well's BODY: a visible disc that chips while it holds, so the hold
      // is not dead time and the player can see exactly what is being dragged.
      H.field(run, p, x, y, s.radius, s.duration, 'damage', dmg * 0.22, v.color, WELL_FIELD);

      // THE DRAG. A status rather than a field effect, because a field pulls in
      // 0.25s lurches and this has to look like gravity.
      PULL_T = s.duration; PULL_X = x; PULL_Y = y; PULL_F = s.pull;
      H.forEachEnemyIn(run, x, y, pullR, pullEnemy);

      // Motes falling INWARD are the entire telegraph: they say "this is a
      // drain" in one frame, before the collapse says anything at all.
      H.particles.ring(x, y, 10, v.color, -pullR * 1.5);
      const f = wfx(tier);
      f.spokes = 10; f.life = 0.34; f.width = 3;
      H.effects.burstRing(x, y, pullR * 0.8, v.color, f);

      const k = WELLS[WELL_I];
      WELL_I = (WELL_I + 1) % WELLS.length;
      k.x = x; k.y = y; k.r = blast; k.damage = dmg;
      k.knockback = s.knockback; k.color = v.color; k.tier = tier;
      run.scheduler.after(s.duration, collapseWell, run, k);
    }
    H.audio.play('telegraph');
  },
  persist(run, p, w, s, dt) {
    // EVENT HORIZON: the drag stops being a place and becomes YOU. This is the
    // cost of the evolution, not a bonus on it — everything in range is now
    // arriving faster than it chose to, and it is arriving at your feet.
    const st = w.state;
    st.dragT = (st.dragT || 0) - dt;
    if (st.dragT > 0) return;
    st.dragT = 0.2;
    PULL_T = 0.3; PULL_X = p.x; PULL_Y = p.y; PULL_F = s.dragForce || 120;
    H.forEachEnemyIn(run, p.x, p.y, H.area(p, s.dragRadius || 280), pullEnemy);
  },
};

/** Every kind data/weapons.js is allowed to name. Asserted in the test suite. */
export const WEAPON_KINDS = Object.keys(WEAPON_IMPLS);
