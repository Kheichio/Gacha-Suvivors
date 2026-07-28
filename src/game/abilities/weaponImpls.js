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
const CONE_OPTS = { element: null, knockback: 0, maxTargets: 0 };
const PROJ_OPTS = {
  speed: 0, damage: 0, life: 0, radius: 0, pierce: 0, motion: 0, visual: null,
  knockback: 0, target: null, turnRate: 0, owner: null, tag: '',
  aoeRadius: 0, aoeDamage: 0, onHit: null, onExpire: null, trailColor: null,
  host: null, orbitAngle: 0, orbitRadius: 0, orbitSpeed: 0,
  targetX: 0, targetY: 0, flightTime: 0, arcHeight: 0,
};
const WEDGE = { x: 0, y: 0, r: 0, a0: 0, a1: 0, color: '', life: 0 };
const NEAR = [];

/** A cone hit plus its wedge overlay and particles, without meleeArc's audio. */
function slash(run, p, x, y, angle, arc, radius, damage, color, knockback) {
  const r = H.area(p, radius);
  const hits = H.coneDamage(run, x, y, angle, arc, r, damage, SRC.AUTO, {
    knockback: knockback, crit: undefined,
  });
  run.overlays.wedges.push({ x, y, r, a0: angle - arc / 2, a1: angle + arc / 2,
                             color, life: 0.12 });
  return hits;
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
      slash(run, p, p.x, p.y, a, s.arc, s.radius, dmg, '#ffe86a', s.knockback);
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
      PROJ_OPTS.visual = w.def.visual;
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
      PROJ_OPTS.visual = w.def.visual;
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
      color: w.def.visual.color, knockback: s.knockback, falloff: 0.2,
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
            s.fieldDps * p.abilityDamageMultiplier(), w.def.visual.color,
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
      run.overlays.rings.push({ x: p.x, y: p.y, r: rad, color: w.def.visual.color });
    }
    H.particles.ring(p.x, p.y, 18, w.def.visual.color, H.area(p, s.radius) * 3);
    H.audio.play('explode');
  },
  persist(run, p, w, s, dt) {
    const st = w.state;
    st.fieldT = (st.fieldT || 0) - dt;
    if (st.fieldT > 0) return;
    st.fieldT = 0.5;
    H.field(run, p, p.x, p.y, s.fieldRadius, 0.6, 'chill',
            s.fieldDps * p.abilityDamageMultiplier(), w.def.visual.color,
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
      PROJ_OPTS.visual = w.def.visual;
      PROJ_OPTS.knockback = 20;
      PROJ_OPTS.owner = p;
      PROJ_OPTS.tag = w.id;
      PROJ_OPTS.host = null;
      PROJ_OPTS.target = t;
      PROJ_OPTS.turnRate = s.turnRate;
      PROJ_OPTS.trailColor = w.def.visual.color;
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
            s.arc, s.radius, dmg, w.def.visual.color, s.knockback);
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
    METEOR.color = w.def.visual.color;
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
      PROJ_OPTS.visual = w.def.visual;
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

/** Every kind data/weapons.js is allowed to name. Asserted in the test suite. */
export const WEAPON_KINDS = Object.keys(WEAPON_IMPLS);
