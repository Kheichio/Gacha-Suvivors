// ★3 ROSTER — the two starters. SECTION 4, spec lines 375-421.
//
// Both kits are deliberately honest: one projectile character built entirely out
// of "swallows things, spits them back out, hops between dimensions", and one
// melee duelist built out of "MMO player who takes it far too seriously".
// Nothing here branches on who is playing — the registry key IS the branch.

import { registerAll } from './index.js';
import * as H from './helpers.js';

// =============================================================================
// SHARED — small utilities both starters use. Module scope, so nothing here
// allocates inside a per-frame path.
// =============================================================================

/** Where an escape should go. Movement direction, else away from the crowd. */
const AWAY_SPEC = { mode: 'densestCluster', range: 460 };
function escapeAngle(run, p) {
  const ix = run.inputMoveX, iy = run.inputMoveY;
  if (ix * ix + iy * iy > 0.02) return Math.atan2(iy, ix);
  // Standing still and surrounded: leave the way the crowd is thinnest. An
  // escape that fails to escape a full surround is a failed acceptance test.
  const t = H.target(run, p, AWAY_SPEC);
  if (t.found) return t.angle + Math.PI;
  return p.facing;
}

/**
 * A destination `distance` away at `angle`, flipped to the opposite side when
 * that would bury the player in the arena wall. Both escapes route through this
 * so hugging a boundary never turns the escape into a 20px shuffle.
 */
const DEST = { x: 0, y: 0 };
function safeHop(run, p, angle, distance) {
  const b = run.bounds;
  const pad = 48;
  let x = p.x + Math.cos(angle) * distance;
  let y = p.y + Math.sin(angle) * distance;
  if (x < b.minX + pad || x > b.maxX - pad || y < b.minY + pad || y > b.maxY - pad) {
    const bx = p.x - Math.cos(angle) * distance;
    const by = p.y - Math.sin(angle) * distance;
    if (bx > b.minX + pad && bx < b.maxX - pad && by > b.minY + pad && by < b.maxY - pad) {
      x = bx; y = by;
    }
  }
  DEST.x = x; DEST.y = y;
  return DEST;
}

// =============================================================================
// ★3 — "THE POCKET DIMENSION"  (spirit)
// =============================================================================

// THE OBJECT TABLE.
// Spec line 386: "Purely cosmetic variety, but it makes the starter character
// endlessly watchable — do not cut this." Built ONCE, here, at module scope: one
// shot picks a descriptor, it never builds one. `damage` is each object's own
// number from the spec's 6-18 range; `ratio` converts it against the table mean
// so the character data (`damage: 12`, the mean) stays the single source of
// truth and re-tuning the data re-tunes every object with it.
const SPIT_OBJECTS = [
  {
    tag: 'puu_fish', damage: 6, speed: 520, life: 1.5, pierce: 0, knockback: 70,
    size: 9, trail: '#7fd4ff',
    visual: { shape: 'circle', color: '#7fd4ff', accent: '#0b3d5c', size: 9, emoji: '🐟', glow: true },
    // a wet slap
    impactColor: '#7fd4ff', impactCount: 6, heavy: false,
    impactOpts: { speed: 150, life: 0.26, size: 0.42, additive: true },
  },
  {
    tag: 'puu_teapot', damage: 9, speed: 470, life: 1.4, pierce: 0, knockback: 100,
    size: 11, trail: '#e8f0ff',
    visual: { shape: 'circle', color: '#e8f0ff', accent: '#6b7285', size: 11, emoji: '🫖', glow: true },
    // porcelain shatter
    impactColor: '#e8f0ff', impactCount: 9, heavy: false,
    impactOpts: { speed: 210, life: 0.3, size: 0.38, shape: 'shard' },
  },
  {
    tag: 'puu_twin', damage: 12, speed: 440, life: 1.4, pierce: 0, knockback: 130,
    size: 12, trail: '#ffffff',
    visual: { shape: 'circle', color: '#ffffff', accent: '#d63b4a', size: 12, emoji: '🍡', glow: true },
    // another one of itself, bouncing off indignantly
    impactColor: '#ffffff', impactCount: 8, heavy: false,
    impactOpts: { speed: 190, life: 0.34, size: 0.5, additive: true },
  },
  {
    tag: 'puu_anvil', damage: 15, speed: 380, life: 1.3, pierce: 1, knockback: 240,
    size: 13, trail: '#9aa3b8',
    visual: { shape: 'circle', color: '#9aa3b8', accent: '#2b3040', size: 13, emoji: '⚒️' },
    // a clang you feel in the controller
    impactColor: '#c9d2e4', impactCount: 7, heavy: true,
    impactOpts: { speed: 240, life: 0.28, size: 0.55, shape: 'diamond' },
  },
  {
    tag: 'puu_boulder', damage: 18, speed: 330, life: 1.3, pierce: 1, knockback: 280,
    size: 15, trail: '#8a7f72',
    visual: { shape: 'circle', color: '#8a7f72', accent: '#3a332c', size: 15, emoji: '🪨' },
    // dust cloud
    impactColor: '#a99c8c', impactCount: 10, heavy: true,
    impactOpts: { speed: 170, life: 0.5, size: 0.7, drag: 4 },
  },
];

// Mean of the table, derived rather than typed: `ratio` can never drift out of
// sync with the object list, and the data's `damage` stays the mean of 6-18.
let SPIT_MEAN = 0;
for (let i = 0; i < SPIT_OBJECTS.length; i++) SPIT_MEAN += SPIT_OBJECTS[i].damage;
SPIT_MEAN /= SPIT_OBJECTS.length;
const SPIT_BY_TAG = Object.create(null);
for (let i = 0; i < SPIT_OBJECTS.length; i++) {
  const o = SPIT_OBJECTS[i];
  o.ratio = o.damage / SPIT_MEAN;
  SPIT_BY_TAG[o.tag] = o;
}

/** "a matching impact effect" — one module-level callback, table-driven. */
function spitImpact(pr, e, run) {
  const o = SPIT_BY_TAG[pr.tag];
  if (!o) return;
  H.particles.burst(e.x, e.y, o.impactCount, o.impactColor, o.impactOpts);
  if (o.heavy) H.shake.small();
}

// Reused shot descriptors — one object each, mutated per shot, never rebuilt.
const SPIT_SHOT = {
  damage: 0, speed: 0, life: 0, radius: 0, pierce: 0, knockback: 0,
  motion: H.MOTION.STRAIGHT, element: 'spirit', visual: null,
  trailColor: null, onHit: spitImpact, tag: '',
};
const DISGORGE_SHOT = {
  damage: 0, speed: 0, life: 0, radius: 0, pierce: 0, knockback: 0,
  motion: H.MOTION.STRAIGHT, element: 'spirit', visual: null,
  trailColor: null, onHit: spitImpact, tag: '', owner: null,
};

const DISGORGE_COUNT = 20;
const DISGORGE_TOTAL = 90;
const DISGORGE_RADIUS = 140;
const MOUTH_COLOR = '#d63b4a';
const FREE_PICKUPS = ['heart', 'magnet', 'bento_box', 'hourglass', 'coin_pile'];

const HOP_DISTANCE = 200;
const HOP_DAMAGE = 20;
const RIFT_RADIUS = 90;            // authored: the spec gives 20 damage, no radius
const RIFT_PORTAL_TIME = 3;        // S5
const RIFT_COLOR = '#c58cff';
const RIFT_DMG_OPTS = { falloff: 0.2, element: 'spirit', knockback: 240 };
const RIFT_FIELD_OPTS = { hitsEnemies: true };
const RIFT_VISUAL = { shape: 'ring', color: '#c58cff', accent: '#2a0d4a', size: 26, glow: true };
const RIFT_PROP_OPTS = {
  role: H.MINION_ROLE.DECOY, hp: 9999, damage: 0, speed: 0,
  life: RIFT_PORTAL_TIME, tag: 'rift', max: 2, visual: RIFT_VISUAL,
};

/** One end of a Dimension Hop: the burst, and the S5 portal it leaves behind. */
function riftBurst(run, p, x, y, damage, s5, isDeparture) {
  H.areaDamage(run, x, y, H.area(p, RIFT_RADIUS), damage, H.SRC.ESCAPE, RIFT_DMG_OPTS);
  H.particles.ring(x, y, 16, RIFT_COLOR, 340);
  H.particles.burst(x, y, 8, '#ffffff', RIFT_SPARK_OPTS);
  if (!s5) return;
  // S5: "leaves both rifts open for 3s as damaging portals."
  H.field(run, p, x, y, RIFT_RADIUS, RIFT_PORTAL_TIME, 'damage', damage, RIFT_COLOR,
          RIFT_FIELD_OPTS);
  // Only the rift you LEFT gets the prop that pulls attention — a taunting prop
  // on the arrival rift would drag the crowd straight back onto you. Props, not
  // minions (DECISIONS.md §27), so this never breaks a Dokkodo build.
  if (isDeparture) H.prop(run, p, x, y, RIFT_PROP_OPTS);
}
const RIFT_SPARK_OPTS = { speed: 260, life: 0.4, size: 0.5, additive: true };

const SWALLOW_KILLS = 25;
const STOMACH_BONUS = 0.25;

// =============================================================================
// ★3 — "THE SOLO PLAYER"  (steel)
// =============================================================================

const ARC_ANGLE = (120 * Math.PI) / 180;   // "a 120° melee arc"
const ARC_RANGE = 85;                      // "range 85px"
const CHARGED_EVERY = 5;                   // "Every 5th swing"
const CHARGED_MULT = 3;                    // "3x damage"
const CHARGED_RANGE_MULT = 2;              // "double range"
const BLADE_STEEL = '#aeb8cc';
const BLADE_CYAN = '#3fd0ff';
const SWING_OPTS = { color: BLADE_STEEL, element: 'steel', src: H.SRC.AUTO, knockback: 90 };
const CHARGED_OPTS = { color: BLADE_CYAN, element: 'steel', src: H.SRC.AUTO, knockback: 240 };

const STREAM_TIME = 2.5;                   // "over 2.5s"
const STREAM_HITS = 16;                    // "a 16-hit dual-blade combo"
const STREAM_HITS_S3 = 24;                 // S3: "extends to 24 hits"
const STREAM_DAMAGE = 22;                  // "22 damage per hit"
const STREAM_IFRAMES = 1.0;                // "invulnerable for the first 1.0s"
const STREAM_SPEC = { mode: 'nearest', range: 700 };
const STREAM_HIT_OPTS = { element: 'steel', knockback: 110, fromX: 0, fromY: 0 };
const STREAM_CONE_OPTS = { speed: 320, life: 0.2, size: 0.45, additive: true };

// The hit counter climbs on screen (spec line 414). Pre-built strings so the
// counter never allocates inside tick().
const HIT_LABELS = [];
for (let i = 0; i <= 40; i++) HIT_LABELS.push(i + ' HIT');

const SWITCH_DISTANCE = 200;               // "reappears 200px"
const SWITCH_ARRIVE_IFRAMES = 0.25;        // authored: never materialise into a hit
const GLITCH_DPS = 25;                     // S5, from the character data
const GLITCH_TIME = 4;
const GLITCH_RADIUS = 110;                 // authored: the spec gives no radius
const GLITCH_COLOR = '#ff3a5e';
const GLITCH_FIELD_OPTS = { hitsEnemies: true };
const AFTERIMAGE_OPTS = { speed: 120, life: 0.55, size: 0.8, drag: 3, additive: true };

const BEATER_PER_LEVEL = 0.02;             // "+2% damage per player level"

// =============================================================================

registerAll({

  // ---- THE POCKET DIMENSION ------------------------------------------------

  // AUTO — "Puu!": spits a stored object out of its mouth at the nearest enemy.
  // The projectile is RANDOM each shot (anvil, teapot, fish, boulder, another
  // one of itself) with damage 6-18 and a matching impact effect. Fires every
  // 1.0s. Targeting: nearest.
  puu: {
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      const obj = H.runRng.pick(SPIT_OBJECTS);
      const s = SPIT_SHOT;
      s.damage = H.autoDamage(run, p, ctx.def.damage * obj.ratio, opts);
      s.speed = obj.speed;
      s.life = obj.life;
      s.radius = obj.size;
      s.pierce = obj.pierce;
      s.knockback = obj.knockback;
      s.visual = obj.visual;
      s.trailColor = obj.trail;
      s.tag = obj.tag;
      H.spread(run, p, o.x, o.y, t.angle, 1, 0, s);
      H.audio.play('shoot');
    },
  },

  // SPECIAL — "SECRET TECHNIQUE No. 108" (18s): opens its mouth impossibly wide
  // and disgorges EVERYTHING at once — 20 random objects erupt in a 140px radius
  // for 90 total damage, with heavy knockback.
  // S3: also spits out a free pickup.
  secret_technique_108: {
    cast(run, p, ctx) {
      ctx.active = true;
      ctx.t = 0.45;
      ctx.pulse = 0;

      // Every object radiates from the mouth and dies at exactly 140px (scaled by
      // areaMult), so the "140px radius" survives any projectile-speed upgrade.
      // The 90 is what a target AT the epicentre eats from all 20 objects; the
      // falloff toward the edge is the eruption's own shape, not a magic curve.
      const reach = H.area(p, DISGORGE_RADIUS);
      const each = H.abilityDamage(run, p, DISGORGE_TOTAL / DISGORGE_COUNT);
      // Extra Shot adds OBJECTS to the eruption. Still fired through the raw pool
      // rather than `H.spread`, and still for the original reason — this is a
      // 360° ring, and fanning each of twenty objects would apply the upgrade
      // twenty times over and quintuple the special. What grows is the RING, once,
      // so the most expensive upgrade in the game is no longer inert here.
      const objects = DISGORGE_COUNT + H.extraShots(p);
      const d = DISGORGE_SHOT;
      d.owner = p;
      d.damage = each;
      d.pierce = H.pierce(p, 6);
      for (let i = 0; i < objects; i++) {
        const obj = H.runRng.pick(SPIT_OBJECTS);
        const a = (i / objects) * H.TAU + H.runRng.range(-0.14, 0.14);
        const speed = H.projSpeed(p, obj.speed);
        d.speed = speed;
        d.life = reach / speed;
        d.radius = obj.size * p.stats.areaMult;
        d.knockback = obj.knockback + 260;      // "with heavy knockback"
        d.visual = obj.visual;
        d.trailColor = obj.trail;
        d.tag = obj.tag;
        run.projectiles.fire(p.x, p.y, a, d);
      }
      d.owner = null;
      d.visual = null;

      H.grade(run, MOUTH_COLOR, 0.32, 0.5);
      H.announce(run, 'SECRET TECHNIQUE No. 108', '#ffffff');
      H.camera.punch(0.07, 0.45);
      H.shake.big();
      H.audio.play('explode');
    },
    tick(run, p, ctx, dt) {
      ctx.pulse -= dt;
      if (ctx.pulse > 0) return;
      ctx.pulse = 0.15;
      H.particles.ring(p.x, p.y, 12, MOUTH_COLOR, H.area(p, DISGORGE_RADIUS) * 2.4);
    },
    end(run, p, ctx) {
      if (!ctx.s3) return;
      // S3: "Secret Technique No. 108 also spits out a free pickup."
      const a = H.runRng.angle();
      run.pickups.dropPickup(p.x + Math.cos(a) * 48, p.y + Math.sin(a) * 48,
                             H.runRng.pick(FREE_PICKUPS));
      H.announce(run, 'PUU!', '#ffffff');
    },
  },

  // ESCAPE — "Dimension Hop" (5s): vanishes into a rift and drops out of another
  // rift 200px away. 0.6s invulnerable. Both rifts damage enemies (20).
  // S5: leaves both rifts open for 3s as damaging portals.
  dimension_hop: {
    cast(run, p, ctx) {
      const x0 = p.x, y0 = p.y;
      const dest = safeHop(run, p, escapeAngle(run, p), HOP_DISTANCE);
      // i-frames come from the character data (0.6s), applied by the blink itself
      // as well as by the run's escape handling — an escape without them is a bug.
      H.blink(run, p, dest.x, dest.y, ctx.def.iframes);
      const dmg = H.abilityDamage(run, p, HOP_DAMAGE);
      riftBurst(run, p, x0, y0, dmg, ctx.s5, true);
      riftBurst(run, p, p.x, p.y, dmg, ctx.s5, false);
      H.flash.fire(RIFT_COLOR, 0.16, 4);
      H.shake.small();
      if (ctx.s5) H.floaters.spawn(x0, y0 - 40, 'RIFT', RIFT_COLOR, 18, 1.1);
    },
  },

  // PASSIVE — "Infinite Stomach": +25% pickup radius, and pickups are stored and
  // auto-collected even if you die before touching them.
  infinite_stomach: {
    init(run, p, ctx) {
      // A buff, not a direct stat write: `recompute()` rebuilds stats from
      // sources every time anything changes, so a direct write would evaporate
      // on the next upgrade. Read off the character data so the number is data.
      ctx.mods = { pickupRadius: p.def.stats.pickupRadius * STOMACH_BONUS };
      p.addBuff('infinite_stomach', 1e9, ctx.mods);
      p.flags.swallowPickups = true;    // generic: HUD/results may show the bank
      ctx.eaten = 0;
    },
    onKill(run, p, ctx, e) {
      // "stored and auto-collected even if you die before touching them" — the
      // stomach reaches out. Every 25 kills everything still lying on the ground
      // is swallowed from anywhere on the map, so nothing survives long enough
      // for a death to cost you. One pooled pass per 25 kills; free.
      if (++ctx.eaten < SWALLOW_KILLS) return;
      ctx.eaten = 0;
      run.pickups.magnetAll();
      H.particles.ring(p.x, p.y, 10, '#ffffff', 200);
    },
  },

  // ---- THE SOLO PLAYER -----------------------------------------------------

  // AUTO — "Sword Skill: Vertical Arc": a 120° melee arc in the facing
  // direction, 16 damage, range 85px, every 0.8s. Every 5th swing is a charged
  // Sword Skill — 3x damage, double range, and the blade leaves the glowing cyan
  // trail used for activated skills. Targeting: facing.
  vertical_arc: {
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      const n = ctx.shotIndex || 0;
      const charged = n > 0 && (n % CHARGED_EVERY) === 0;
      const dmg = H.autoDamage(run, p, ctx.def.damage * (charged ? CHARGED_MULT : 1), opts);
      const range = ARC_RANGE * (charged ? CHARGED_RANGE_MULT : 1);
      H.meleeArc(run, p, o.x, o.y, t.angle, ARC_ANGLE, range, dmg,
                 charged ? CHARGED_OPTS : SWING_OPTS);
      if (!charged) return;
      // The activated-skill tell: cyan bloom, a punch, and a louder swing.
      H.particles.ring(o.x, o.y, 12, BLADE_CYAN, H.area(p, range) * 2.6);
      H.camera.punch(0.03, 0.25);
      H.shake.small();
    },
  },

  // SPECIAL — "STARBURST STREAM" (20s): a 16-hit dual-blade combo executed on the
  // nearest cluster over 2.5s, 22 damage per hit, each hit auto-retargeting to
  // the closest living enemy. He is invulnerable for the first 1.0s. The hit
  // counter renders on screen as it climbs.
  // S3: extends to 24 hits.
  starburst_stream: {
    cast(run, p, ctx) {
      ctx.active = true;
      ctx.t = STREAM_TIME;
      ctx.hits = ctx.s3 ? STREAM_HITS_S3 : STREAM_HITS;
      ctx.interval = STREAM_TIME / ctx.hits;
      ctx.done = 0;
      ctx.next = 0;
      H.applyInvuln(p.st, STREAM_IFRAMES);
      p.flags.comboCounter = 0;
      H.grade(run, BLADE_CYAN, 0.3, 0.6);
      H.announce(run, 'STARBURST STREAM', BLADE_CYAN);
      H.camera.punch(0.06, 0.4);
      H.audio.play('special');
    },
    tick(run, p, ctx, dt) {
      ctx.next -= dt;
      while (ctx.next <= 0 && ctx.done < ctx.hits) {
        ctx.next += ctx.interval;
        // Every hit re-resolves: the combo chases the fight instead of finishing
        // on a corpse.
        const t = H.target(run, p, STREAM_SPEC);
        if (!t.found || !t.target) break;
        const e = t.target;
        const dmg = H.abilityDamage(run, p, STREAM_DAMAGE);
        STREAM_HIT_OPTS.fromX = p.x;
        STREAM_HIT_OPTS.fromY = p.y;
        H.dealDamage(run, e, dmg, H.SRC.SPECIAL, STREAM_HIT_OPTS);
        ctx.done++;

        // Dual blades: the slash colour alternates hand to hand.
        const blade = (ctx.done & 1) ? BLADE_CYAN : '#ffffff';
        H.particles.cone(e.x, e.y, t.angle + Math.PI, 1.4, 5, blade, STREAM_CONE_OPTS);
        H.particles.trail(p.x, p.y, Math.cos(t.angle) * 240, Math.sin(t.angle) * 240,
                          blade, 0.5, 0.18);

        // THE COUNTER, on screen, climbing.
        p.flags.comboCounter = ctx.done;
        H.floaters.spawn(p.x, p.y - 78, HIT_LABELS[ctx.done], blade,
                         18 + ctx.done * 0.55, 0.5, p);
        H.audio.play('slash');
      }
    },
    end(run, p, ctx) {
      // The last number hangs for a beat, then the counter clears.
      H.floaters.spawn(p.x, p.y - 92, HIT_LABELS[ctx.done], BLADE_CYAN, 34, 1.4);
      H.particles.ring(p.x, p.y, 20, BLADE_CYAN, 420);
      H.shake.medium();
      p.flags.comboCounter = 0;
    },
  },

  // ESCAPE — "Switch!" (7s): vanishes for 0.8s (fully invulnerable, immune to
  // slows), reappears 200px in the movement direction with an afterimage.
  // S5: leaves a "system error" glitch zone dealing 25 damage/s for 4s.
  'switch': {
    cast(run, p, ctx) {
      ctx.active = true;
      ctx.t = ctx.def.iframes;              // the 0.8s vanish IS the i-frame window
      ctx.x0 = p.x; ctx.y0 = p.y;
      H.applyInvuln(p.st, ctx.def.iframes + 0.05);
      H.applyIntangible(p.st, ctx.def.iframes);
      H.applyUntargetable(p.st, ctx.def.iframes);
      p.st.slowT = 0; p.st.slowMult = 1;    // "immune to slows"
      H.particles.ring(p.x, p.y, 14, '#9fd3ff', 300);
      H.floaters.spawn(p.x, p.y - 44, 'SWITCH!', '#9fd3ff', 20, 0.8);
      H.audio.play('escape');
    },
    tick(run, p, ctx, dt) {
      // Immunity, not a cleanse: anything applied mid-vanish is wiped too.
      p.st.slowT = 0; p.st.slowMult = 1;
      H.particles.trail(p.x, p.y, 0, 0, '#9fd3ff', 0.35, 0.2);
    },
    end(run, p, ctx) {
      const dest = safeHop(run, p, escapeAngle(run, p), SWITCH_DISTANCE);
      const x0 = p.x, y0 = p.y;
      H.blink(run, p, dest.x, dest.y, SWITCH_ARRIVE_IFRAMES);
      // The afterimage: a stack of him left standing where he was.
      H.particles.burst(x0, y0, 12, '#9fd3ff', AFTERIMAGE_OPTS);
      H.particles.ring(p.x, p.y, 12, '#ffffff', 260);
      if (!ctx.s5) return;
      // S5: the arena keeps a copy of the bug he just exploited.
      H.field(run, p, ctx.x0, ctx.y0, GLITCH_RADIUS, GLITCH_TIME, 'damage',
              GLITCH_DPS, GLITCH_COLOR, GLITCH_FIELD_OPTS);
      H.floaters.spawn(ctx.x0, ctx.y0 - 30, 'SYSTEM ERROR', GLITCH_COLOR, 18, 1.4);
      H.particles.ring(ctx.x0, ctx.y0, 16, GLITCH_COLOR, 360);
    },
  },

  // PASSIVE — "Beater": +2% damage per player level this run (uncapped). He
  // grinds and everyone resents him for it.
  beater: {
    init(run, p, ctx) {
      // The SAO-style segmented HP bar is a render concern, declared as a flag so
      // the HUD honours it generically rather than knowing who is playing.
      p.flags.segmentedHpBar = true;
      ctx.applied = 0;
      ctx.level = -1;
    },
    tick(run, p, ctx, dt) {
      if (p.level === ctx.level) return;
      ctx.level = p.level;
      const want = p.level * BEATER_PER_LEVEL;
      // Swap our own contribution in and out rather than owning the flag, so a
      // relic or evolution writing the same flag is never silently erased.
      p.flags.damageMultBonus = (p.flags.damageMultBonus || 0) - ctx.applied + want;
      ctx.applied = want;
    },
  },

});
