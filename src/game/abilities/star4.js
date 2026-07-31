// THE 4-STAR ROSTER — twenty-four ability implementations, six characters.
//
// SECTION 4 lines 427-574. Every number here is either read from the character
// data (`ctx.def.damage`, `ctx.def.interval`, `ctx.def.cooldown`,
// `ctx.def.iframes`) or quoted verbatim from the spec line printed above the
// ability it belongs to. Nothing in this file branches on a character id — the
// registry key IS the branch (DECISIONS.md §36).
//
// Allocation rules (SECTION 3 / DECISIONS.md §35): nothing in a `fire()` or
// `tick()` path allocates. Every callback, every `opts` bag that is reached from
// a per-frame path, and every visual descriptor is a module-level constant
// declared once below. Scratch that varies per call lives on `ctx`, which the
// driver hands each ability for the whole run.

import { registerAll } from './index.js';
import * as H from './helpers.js';

// ---------------------------------------------------------------------------
// Shared scratch. Written immediately before the helper call that reads it and
// consumed synchronously, so a single module-level record is safe and lets every
// callback below be a function reference instead of a per-call closure.
// ---------------------------------------------------------------------------
const SCRATCH = {
  fireDps: 0,      // great-fireball burn while the cone resolves
  burnDps: 0,      // foxfire burn while a wisp detonates
  killed: false,   // did a grapple line kill something mid-flight?
};

// --- palettes --------------------------------------------------------------
const REI_BLUE = '#4b6cff';
const REI_PALE = '#c9d6ff';
const CHIDORI = '#9fd6ff';
const CLAN_FIRE = '#ff7a3d';
const SEAL_VIOLET = '#8a3ff0';
const BARRAGE_PALE = '#c9d4ff';
const SPIRAL_ORANGE = '#ff7a1a';
const SPIRAL_BLUE = '#7ad4ff';
// The chakra that only comes out when he is nearly finished. It appears in ONE
// place in his kit — the guard he spends under half HP — so the colour itself
// carries the information.
const SPIRAL_RED = '#ff3320';
const LOG_BROWN = '#8a5a2b';
const DOUBLE_PINK = '#ffb3d9';
const STEEL_PALE = '#d8d2c4';
const FOX_PINK = '#ff8fc7';
const FOX_SPIRIT = '#bfe6ff';     // kitsunebi: the blue-white heart of foxfire
const FOX_BLUE = '#7ad9ff';       // its cooler trailing wisp, and the ground it leaves burning
const TORII_RED = '#e8452f';      // vermilion
const TORII_GLOW = '#dfe8ff';     // the light standing between the pillars
const AI_PINK = '#ff2d95';
const AI_BOLT = '#5fd0ff';
const BSOD_BLUE = '#2b6cff';

// --- projectile / minion visuals (registered in the atlas on first use) -----
const V_COMET_SHARD = { shape: 'star', color: REI_PALE, accent: REI_BLUE, size: 9, rotates: true, glow: true };
const V_DECOY = { shape: 'capsule', color: REI_PALE, accent: REI_BLUE, size: 15, glow: true };
const V_SHURIKEN = { shape: 'cross', color: '#8fa0d8', accent: '#151b32', size: 8, rotates: true };
const V_WIRE_SHURIKEN = { shape: 'cross', color: CLAN_FIRE, accent: '#151b32', size: 9, rotates: true, glow: true };
const V_CLONE = { shape: 'capsule', color: SPIRAL_ORANGE, accent: '#1b1b2b', size: 13 };
const V_DOUBLE = { shape: 'capsule', color: DOUBLE_PINK, accent: '#1b1b2b', size: 13, glow: true };
const V_LOG = { shape: 'capsule', color: LOG_BROWN, accent: '#3a2410', size: 14 };
const V_OFUDA = { shape: 'ofuda', color: '#fff6e0', accent: TORII_RED, size: 10, rotates: true };
const V_WISP = { shape: 'foxfire', color: FOX_SPIRIT, accent: '#2b6cff', size: 11, rotates: true, glow: true };
// `flash: false` — a prop can never be hit, so the white twin is memory nothing
// will read. It IS part of the atlas key, so prewarm.js carries it too.
const V_TORII = { shape: 'torii', color: TORII_RED, accent: '#7a1a12', size: 26, glow: true, flash: false };
const V_BOLT = { shape: 'shard', color: AI_BOLT, accent: '#0a2b4a', size: 8, rotates: true, glow: true };

// --- reusable opts bags ----------------------------------------------------
const CLONE_HIT = { fromX: 0, fromY: 0, element: 'spirit', knockback: 40 };
const KICK_HIT = { fromX: 0, fromY: 0, element: 'spirit', knockback: 260 };
const CLONE_PUFF = { speed: 150, life: 0.26, size: 0.55, additive: true };
const DRIFT_SMALL = { life: 0.6, size: 0.4, speed: 14 };
const PULSE_NOVA = {
  color: REI_PALE, element: 'light', falloff: 0, src: H.SRC.SPECIAL,
  shake: false, particles: 30, knockback: 60,
};
const REI_DASH = { color: REI_BLUE };
// --- Yamikage ---------------------------------------------------------------
const FIREBALL_CONE = { element: 'fire', knockback: 40, onHit: igniteWire };
const FIREBALL_FX = { speed: 260, life: 0.38, size: 0.8, additive: true };
const CHIDORI_DASH = { color: CHIDORI, element: 'lightning', width: 52, src: H.SRC.SPECIAL, damage: 0 };
const CHIDORI_THRUST = { canCrit: false, element: 'lightning', knockback: 60, fromX: 0, fromY: 0 };
const CHIDORI_NOVA = {
  color: CHIDORI, element: 'lightning', falloff: 0.3, src: H.SRC.SPECIAL,
  knockback: 180, particles: 18,
};
const CHIDORI_FORK = { canCrit: false, element: 'lightning', knockback: 0, fromX: 0, fromY: 0 };
const CHIDORI_GRIP_FX = { speed: 34, life: 0.3, size: 0.5, additive: true, color: CHIDORI };
const BARRAGE_DASH = { color: BARRAGE_PALE, element: 'steel', width: 36, src: H.SRC.ESCAPE, damage: 0 };
const BARRAGE_HIT = { element: 'steel', knockback: 30, fromX: 0, fromY: 0 };
const BARRAGE_SLAM = { color: BARRAGE_PALE, element: 'steel', falloff: 0.2, src: H.SRC.ESCAPE, knockback: 260 };
const RIPOSTE_NOVA = {
  color: CHIDORI, element: 'lightning', falloff: 0, src: H.SRC.SPECIAL,
  knockback: 90, particles: 14, shake: false,
};
const RASENGAN_NOVA = { color: SPIRAL_BLUE, element: 'spirit', falloff: 0.15, src: H.SRC.SPECIAL, knockback: 220 };
const RASENGAN_PULL = { param: 300, hitsEnemies: true };
const RASENGAN_HIT = { fromX: 0, fromY: 0, element: 'spirit', knockback: 60 };
// `src: SPECIAL` is load-bearing, not decoration: helpers.js `escapeDirection`
// only re-steers a dash that came off the ESCAPE button, so tagging the charge
// keeps it pointed at the thing it is charging.
const RASENGAN_DASH = { color: SPIRAL_BLUE, src: H.SRC.SPECIAL, ghostSize: 16 };
/** The transformation's stun. Reused by reference; never rebuilt per cast. */
const SUB_NOVA = {
  color: DOUBLE_PINK, element: 'spirit', falloff: 0, src: H.SRC.ESCAPE,
  knockback: 90, onHit: dazeHit,
};
/** Never Gives Up: the shove he lets out getting back up. `color` is swapped. */
const GUARD_NOVA = { color: SPIRAL_ORANGE, element: 'spirit', falloff: 0.2, src: H.SRC.MINION, knockback: 300 };
/** Seconds between clone guards. One number, declared once. */
const GUARD_PERIOD = 14;
// TWIN BLADE CROSS — two bags rather than one. The blades differ in exactly one
// field, and rewriting a shared bag between two synchronous calls would buy
// nothing. `sweep` PINS the swing direction: `helpers.meleeArc` alternates it by
// default, which is precisely wrong here, because a scissor has to converge on
// EVERY swing and not on every other one. `silent` keeps the pair to ONE 'slash'
// sound — two plays in the same tick is a doubled click, not two blades.
const YULI_CROSS_ARC = Math.PI / 2;   // the cone the PAIR covers — unchanged
const YULI_CROSS_REACH = 70;          // px — unchanged
// The half at angles BELOW facing. Its cone is centred at (facing - arc/4), and
// `drawSlash` starts a swing at (centre - sweep * width/2), so starting at the
// OUTER edge and closing onto facing is sweep +1.
const YULI_ARC_NEG = {
  color: STEEL_PALE, element: 'steel', src: H.SRC.AUTO, knockback: 30, sweep: 1,
};
// The half ABOVE facing, mirrored: outer edge inward is sweep -1.
const YULI_ARC_POS = {
  color: STEEL_PALE, element: 'steel', src: H.SRC.AUTO, knockback: 30,
  sweep: -1, silent: true,
};
/** The flash where the two blades meet. `tier` is written per swing before use. */
const YULI_CLASH = { size: 11, life: 0.16, tier: 0 };
const NAPE_HIT = { canCrit: false, element: 'steel', knockback: 160, fromX: 0, fromY: 0 };
const GRAPPLE_LINE = { element: 'steel', knockback: 140, onHit: noteKill };
const GRAPPLE_DASH = { color: STEEL_PALE };
const OFUDA_SHOT = {
  damage: 0, speed: 210, life: 2.4, radius: 8, motion: H.MOTION.STICK,
  stickTime: 0.8, aoeRadius: 46, element: 'spirit', visual: V_OFUDA,
  trailColor: '#fff6e0', onHit: ofudaStick, onExpire: ofudaRelease, tag: 'ofuda',
  target: null, spin: 0,
};
const OFUDA_PAPER = '#fff6e0';
/** The scraps that come off a charm as it is thrown. Square, because paper is. */
const OFUDA_FLUTTER = { speed: 95, life: 0.42, size: 0.34, shape: 'square' };
const WISP_SUMMON = {
  role: H.MINION_ROLE.SEEKER, hp: 1, damage: 0, speed: 260, life: 6,
  tag: 'foxfire', max: 18, visual: V_WISP, element: 'spirit', onExpire: foxfireBurst,
  orbitRadius: 74, orbitAngle: 0,
};
const WISP_SPAWN = { speed: 70, life: 0.5, size: 0.5, additive: true };

/**
 * HOW FAR A CLONE MAY BE FROM THE MAN, AND HOW BIG IT IS.
 *
 * The barrage lands on `targeting: {mode:'nearest'}`, and targeting.js's
 * DEFAULT_RANGE is 900 — wider than the half-width of the viewport at base zoom
 * (640), so the clones could and did appear off the side of the screen. An
 * auto-attack whose whole identity is "it needs no line of sight" still has to
 * be something you can SEE, so it gets an explicit reach that keeps every clone
 * comfortably inside the frame.
 *
 * The bodies are drawn a little under full size for the same reason a clone in
 * the source is not a twin: at 1.0 they read as three more players and the eye
 * loses which one it is steering.
 *
 * Declared up here because every clone bag below reads the scale.
 */
const CLONE_REACH = 420;
const CLONE_BODY_SCALE = 0.82;
/** The blit bag for one struck clone. `scale`/`angle` written per swing. */
const CLONE_GHOST = { life: 0.24, alpha: 0.92, scale: 1, angle: 0 };

/**
 * THE CLONE THAT SPINS THE SPHERE.
 *
 * He cannot hold that shape one-handed at this point in his life, and the kit
 * says so out loud rather than in a tooltip: one helper at base, four when the
 * S3 upgrade grows it. They are PROPS (DECISIONS.md §27) — they stand there for
 * half a second, taunt whatever is closest, and never swing at anything.
 */
const HELPER_PROP = {
  role: H.MINION_ROLE.DECOY, hp: 9999, damage: 0, life: 0.5,
  tag: 'spiral_helper', visual: V_CLONE, sprite: null, spriteScale: CLONE_BODY_SCALE,
};
/** S5: the three doubles the transformation leaves standing where he was. */
const DOUBLE_PROP = {
  role: H.MINION_ROLE.DECOY, hp: 9999, damage: 0, life: 4,
  tag: 'double', visual: V_DOUBLE, sprite: null, spriteScale: CLONE_BODY_SCALE,
};
const BONUS_CLONE_SUMMON = {
  role: H.MINION_ROLE.MIRROR, hp: 30, damage: 0, speed: 215, tag: 'bonus_clone', max: 5,
  // `sprite` is filled in at summon time with the player's own body — see
  // minion.js spawn(). The capsule stays as the spawn-puff colour and as the
  // fallback for any path that summons one without an owner sprite to hand.
  visual: V_CLONE, element: 'spirit', orbitRadius: 74, orbitAngle: 0,
  attackInterval: 0.7, bonusShare: 1, sprite: null, spriteScale: CLONE_BODY_SCALE,
};
const DECOY_PROP = {
  role: H.MINION_ROLE.DECOY, hp: 9999, damage: 0, life: 2.5,
  tag: 'comet_decoy', visual: V_DECOY,
};
const LOG_PROP = {
  role: H.MINION_ROLE.DECOY, hp: 9999, damage: 0, life: 1.2,
  tag: 'log', visual: V_LOG, onExpire: null,
};
const GATE_PROP = {
  role: H.MINION_ROLE.DECOY, hp: 9999, damage: 0, life: 8,
  tag: 'torii_gate', visual: V_TORII,
};
const PURIFY_NOVA = { color: TORII_RED, element: 'spirit', falloff: 0.2, src: H.SRC.ESCAPE, knockback: 320 };
// --- TORII WARP's numbers, in one place --------------------------------------
const WARP_DIST = 250;            // px per hop, before Anchor Gear
const WARP_RECHARGE = 4.5;        // seconds per purification charge
const WARP_RECHARGE_S5 = 3.0;
const GATE_LIFE = 8;              // seconds a gate stands (S5: for the run)
const ERROR_NOVA = {
  color: BSOD_BLUE, element: 'lightning', falloff: 0, src: H.SRC.ESCAPE,
  knockback: 180, onHit: stunHit,
};
const TRACE_FX = { color: STEEL_PALE, life: 0.26, size: 0.5, sizeEnd: 0.05, drag: 2, additive: true };
const HEART_PAYLOAD = { value: 0.03 };
/**
 * Where the substitution goes when the player is standing still and has
 * expressed no direction of their own. An escape that aims at an ENEMY is the
 * exact bug helpers.js `escapeDirection` was written to end.
 */
const SUB_AWAY = { mode: 'densestCluster', range: 620 };

// ---------------------------------------------------------------------------
// Module-level callbacks. Passed by reference so no closure is ever built in a
// per-frame path.
// ---------------------------------------------------------------------------

/** The great fireball runs down the wire and sets what it touches alight. */
function igniteWire(e) { H.applyBurn(e.st, SCRATCH.fireDps, 2.5); }

/** Grapple Line S5: the line refunds instantly if it killed something. */
function noteKill(e) { if (e.hp <= 0 || e.dying) SCRATCH.killed = true; }

/** Devotion: +45% damage vs Large and Elite, applied through the damage pipeline. */
function markDevotion(e) {
  if (e.size === 'large' || e.isElite || e.isBoss) H.applyVulnerable(e.st, 1.45, 0.5);
}

/** An ofuda sticks to its host and marks it, so the next volley picks someone else. */
function ofudaStick(proj, e) { H.applyMark(e.st, H.MARK.OFUDA, 9e8, 0); }

/** ...and releases the mark when it detonates or expires. */
function ofudaRelease(proj) {
  const host = proj.stickHost;
  if (host && host.st && host.st.markKind === H.MARK.OFUDA) {
    host.st.markKind = H.MARK.NONE;
    host.st.markT = 0;
  }
}

/** A foxfire wisp sets its victim burning for 3s when it detonates. */
function foxfireBurst(m, run) {
  SCRATCH.burnDps = m.damage / 3;
  H.forEachEnemyIn(run, m.x, m.y, 42, applyFoxfireBurn);
  H.particles.burst(m.x, m.y, 8, FOX_SPIRIT, CLONE_PUFF);
  H.particles.burst(m.x, m.y, 4, FOX_BLUE, CLONE_PUFF);
}
function applyFoxfireBurn(e) { H.applyBurn(e.st, SCRATCH.burnDps, 3); }

/** Substitution S5: the log detonates. 120 damage / 140px, from the character data. */
function logDetonate(m, run) {
  const p = run.player;
  H.areaDamage(run, m.x, m.y, H.area(p, 140), m.damage, H.SRC.ESCAPE,
               { falloff: 0.2, element: 'spirit', knockback: 260 });
  H.particles.ring(m.x, m.y, 18, LOG_BROWN, 420);
  H.audio.play('explode');
  H.shake.medium();
}

/** Substitution: anything close enough to see what he turned into stops dead. */
function dazeHit(e) { H.applyStun(e.st, 1.4); }

/** ERROR!: corrupted data stuns for 1.5s. */
function stunHit(e) { H.applyStun(e.st, 1.5); }

/** ERROR! S5: enemy ranged attacks are disabled for 4s — their fire timer is pushed out. */
function silenceRanged(e) { if (e.behavior === 'ranged') e.aiT = Math.max(e.aiT, 4); }

/** A dotted line of sparks — grapple wire, comet tail. */
function traceLine(x0, y0, x1, y1, color, steps) {
  TRACE_FX.color = color;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    H.particles.emit(H.lerp(x0, x1, t), H.lerp(y0, y1, t), 0, 0, TRACE_FX);
  }
}

/**
 * KILL COUNTING.
 * The driver documents `onKill` but does not dispatch it yet, so every kill-driven
 * passive below counts through `ctx.kills` from BOTH sides: `onKill` when the
 * driver starts calling it (which latches `ctx.hookLive` and disables the poll),
 * and a delta poll of `run.stats.kills` until then. Neither path can double-count.
 */
function pollKills(run, ctx) {
  if (ctx.hookLive) return 0;
  const k = run.stats.kills;
  const d = k - ctx.kills;
  ctx.kills = k;
  return d;
}

/** Torii gates: a pooled prop can be recycled, so identity is checked by uid. */
function gateAlive(ctx, i) {
  const g = ctx.gates[i];
  return !!(g && g.active && g.uid === ctx.uids[i] && g.hp > 0);
}
function pruneGates(ctx) {
  for (let i = ctx.gates.length - 1; i >= 0; i--) {
    if (!gateAlive(ctx, i)) { ctx.gates.splice(i, 1); ctx.uids.splice(i, 1); }
  }
}
/**
 * Leave a torii standing where she was.
 *
 * Gates are PROPS, not minions (DECISIONS.md §27), and the CAP lives here rather
 * than on the prop bag for two reasons: `H.prop` has no `max` — that is
 * `H.summon`'s — and a DECOY prop taunts everything within 260px every 0.4s
 * (minion.js), so an escape with no cooldown would otherwise carpet the arena
 * with taunt fields. The oldest gate is retired to make room, which also means
 * the two standing gates are always the two most recent places she fled.
 */
function plantGate(run, p, ctx, x, y, lit) {
  pruneGates(ctx);
  const maxGates = ctx.s5 ? 3 : 2;
  while (ctx.gates.length >= maxGates) {
    const old = ctx.gates.shift();
    ctx.uids.shift();
    if (old && old.active) { old.hp = 0; H.particles.ring(old.x, old.y, 8, TORII_RED, 160); }
  }
  GATE_PROP.life = ctx.s5 ? 0 : GATE_LIFE;      // life 0 == permanent, in minion.js
  const g = H.prop(run, p, x, y, GATE_PROP);
  if (!g) return null;
  ctx.gates.push(g);
  ctx.uids.push(g.uid);
  H.particles.ring(x, y, lit ? 16 : 10, TORII_RED, lit ? 300 : 220);
  H.particles.drift(x, y - 10, TORII_GLOW, DRIFT_SMALL);
  H.audio.play('relic');
  return g;
}

/** Firmware Update: one permanent +2% attack-speed stack. */
function firmwareStack(run, p, ctx) {
  ctx.stacks++;
  ctx.mods.attackSpeedMult = 0.02 * ctx.stacks;
  if (ctx.stacks === 1) p.addBuff('firmware_update', 9e8, ctx.mods);
  else p.recompute();
  H.floaters.spawn(p.x, p.y - 44, 'FIRMWARE +2% AS', AI_PINK, 17, 1.1, p);
}

// ---------------------------------------------------------------------------

registerAll({

  // =========================================================================
  // HOSHINO REI — "Reirei, the Encore Idol"
  // =========================================================================

  comet_shards: {
    // "Bouncing star shards that ricochet to up to 4 enemies, gaining +15%
    //  damage per bounce. 18 base damage, every 1.0s. Targeting: nearest."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      H.spread(run, p, o.x, o.y, t.angle, 1, 0.22, {
        damage: H.autoDamage(run, p, ctx.def.damage, opts),
        speed: 540, life: 1.6, radius: 9,
        motion: H.MOTION.BOUNCE,
        bounces: 4, bounceRange: 300, bounceDamageMult: 1.15,
        element: 'light',
        trailColor: REI_PALE,
        visual: V_COMET_SHARD,
      });
      H.audio.play('shoot');
    },
  },

  stellar_encore: {
    // "The stage lights drop and a comet crashes behind her. For 8s she projects
    //  an aura (200px) that heals 4 HP/s and grants +25% attack speed, while
    //  pulsing damaging soundwave rings every 0.8s (30 damage)."
    // S3: also revives you once if you would die during its duration.
    cast(run, p, ctx, opts) {
      ctx.active = true;
      ctx.t = 8;
      // The Hoshiyomi Penlight relic publishes these two flags for aura abilities.
      ctx.radius = 200 * (p.flags.auraSizeMult || 1);
      ctx.rate = 0.8 / (p.flags.auraRateMult || 1);
      ctx.pulse = H.abilityDamage(run, p, 30, opts);
      ctx.pulseT = ctx.rate;
      ctx.healT = 0.25;
      p.flags.attackSpeedBonus = 1.25;
      p.flags.auraColor = REI_BLUE;
      // DECISIONS.md §29 — run.js resolves this slot fourth in the revive order.
      if (ctx.s3) p.flags.reiRevive = true;

      // The comet: a streak out of the sky landing behind her, then the stage
      // lights drop to a single blue spot.
      const a = p.facing + Math.PI;
      traceLine(p.x + Math.cos(a) * 900, p.y + Math.sin(a) * 900 - 500,
                p.x + Math.cos(a) * 70, p.y + Math.sin(a) * 70, REI_PALE, 22);
      H.particles.ring(p.x + Math.cos(a) * 70, p.y + Math.sin(a) * 70, 26, REI_PALE, 460);
      H.grade(run, REI_BLUE, 0.42, 0.9);
      H.camera.punch(0.07, 0.45);
      H.shake.medium();
      H.announce(run, ctx.def.name, REI_PALE);
      return true;
    },
    tick(run, p, ctx, dt) {
      // 4 HP/s, banked in quarter-second chunks and silent: a green number every
      // frame would bury every other read on the screen.
      ctx.healT -= dt;
      if (ctx.healT <= 0) { ctx.healT += 0.25; H.healPlayer(run, 1, true); }
      if ((run.frameParity & 7) === 0) {
        const a = H.fxRng.angle();
        H.particles.drift(p.x + Math.cos(a) * ctx.radius, p.y + Math.sin(a) * ctx.radius,
                          REI_PALE, DRIFT_SMALL);
      }
      ctx.pulseT -= dt;
      if (ctx.pulseT > 0) return;
      ctx.pulseT = ctx.rate;
      H.nova(run, p, p.x, p.y, ctx.radius, ctx.pulse, PULSE_NOVA);
    },
    end(run, p, ctx) {
      p.flags.attackSpeedBonus = 1;
      p.flags.auraColor = null;
      p.flags.reiRevive = false;
      H.particles.ring(p.x, p.y, 20, REI_BLUE, 300);
    },
  },

  comet_trail: {
    // "A 150px streaking dash with a long blue comet tail, 0.5s invulnerable,
    //  leaving a glittering decoy that taunts for 2.5s."
    // S5: grants a 1-hit shield when you land.
    cast(run, p, ctx) {
      const x0 = p.x, y0 = p.y;
      H.dash(run, p, p.facing, 150, ctx.def.iframes, REI_DASH);
      traceLine(x0, y0, p.x, p.y, REI_BLUE, 14);
      H.prop(run, p, x0, y0, DECOY_PROP);
      H.particles.ring(x0, y0, 14, REI_PALE, 240);
      if (ctx.s5) {
        H.addShield(p.st, 1);
        H.floaters.spawn(p.x, p.y - 42, 'ENCORE GUARD', REI_PALE, 17, 1.0, p);
      }
      return true;
    },
  },

  hoshiyomi: {
    // "Every 10 kills drops a small heart (heals 3 HP)."
    init(run, p, ctx) { ctx.kills = 0; ctx.lastAt = 0; ctx.hookLive = 0; },
    onKill(run, p, ctx, e) {
      ctx.hookLive = 1;
      ctx.kills++;
      dropHearts(run, p, ctx, e);
    },
    tick(run, p, ctx, dt) {
      if (pollKills(run, ctx) <= 0) return;
      dropHearts(run, p, ctx, null);
    },
  },

  // =========================================================================
  // YAMIKAGE — "The Avenger"
  // =========================================================================

  shuriken_volley: {
    // "3 shuriken in a tight spread, pierce 1, 15 damage each, every 0.65s.
    //  Every 4th volley is wire-strung and curves back through the enemies a
    //  second time — and the great fireball follows the wire in. Targeting:
    //  nearest."
    //
    // The clan's fire technique lives HERE rather than on a button because it is
    // the thing he does constantly: binding with wire and then sending fire down
    // it is one move, and splitting it across two pillars would have made the
    // most-used half of the character the one you press least.
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      const dmg = H.autoDamage(run, p, ctx.def.damage, opts);
      const wire = (ctx.shotIndex % 4) === 0;
      H.spread(run, p, o.x, o.y, t.angle, 3, 0.26, {
        damage: dmg,
        speed: wire ? 560 : 620,
        life: wire ? 1.5 : 1.1,
        radius: 8,
        pierce: 1,
        motion: wire ? H.MOTION.BOOMERANG : H.MOTION.STRAIGHT,
        element: wire ? 'fire' : 'steel',
        visual: wire ? V_WIRE_SHURIKEN : V_SHURIKEN,
        trailColor: wire ? CLAN_FIRE : null,
        owner: o,
      });
      if (wire) {
        // THE FIREBALL IS A GARNISH, NOT THE KIT. Authored at 190px/60/18-per-second
        // it was a 60-damage nova plus a three-second burn on the whole screen
        // every 2.6 seconds, and the balance sweep answered immediately: 440 DPS
        // against the 93 he had before, +64% survival, a FOUR-star sitting second
        // on the board above a six-star. He is a single-target assassin whose
        // damage is supposed to be on Chidori and on the thing he is pointed at,
        // so the cone is now a wire-bound flare that softens a crowd rather than
        // clearing one.
        SCRATCH.fireDps = H.autoDamage(run, p, 11, opts);
        H.coneDamage(run, o.x, o.y, t.angle, 1.2, H.area(p, 130),
                     H.autoDamage(run, p, 34, opts), H.SRC.AUTO, FIREBALL_CONE);
        H.particles.cone(o.x, o.y, t.angle, 1.2, 14, CLAN_FIRE, FIREBALL_FX);
        H.flash.fire(CLAN_FIRE, 0.12, 7);
        H.audio.play('explode');
      }
      H.audio.play('shoot');
    },
  },

  chidori: {
    // "A fistful of lightning held for 0.3s, then a 340px thrust. 150 to
    //  everything on the line; 300 + 8% max HP, a 1.6s stun and a 140/130px
    //  discharge at the end of it. Two charges, 14s each, and that is all."
    // S3: forks to 3 more enemies for 140, and below 45% HP the cursed seal
    //     breaks — double thrust, +30% damage and +20% move speed for 10s.
    //
    // The wind-up is real, not decoration: `ctx.t` is the grip and end() is the
    // thrust, so the HUD's duration bar measures a clock that genuinely stops.
    // The ability it replaced set `ctx.active` and deliberately never set
    // `ctx.t`, which is why the HUD said ACTIVE for the rest of the run.
    cast(run, p, ctx, opts) {
      if (!ctx.spec) ctx.spec = { mode: 'nearest', range: 520 };
      const t = H.target(run, p, ctx.spec, opts);
      // Nothing in reach still spends the charge, but it is never wasted: the
      // run itself cuts the line in the direction he is already facing.
      ctx.angle = t.found ? t.angle : p.facing;
      ctx.mark = t.found ? t.target : null;
      ctx.line = H.abilityDamage(run, p, 150, opts);
      ctx.thrust = H.abilityDamage(run, p, 300, opts);
      ctx.burst = H.abilityDamage(run, p, 140, opts);
      ctx.fork = H.abilityDamage(run, p, 140, opts);
      // The seal is read at the moment he REACHES for it, not at the moment the
      // hit lands — the wind-up is the decision.
      ctx.sealed = !!(ctx.s3 && p.hp < p.maxHp * 0.45);
      // A second Chidori while the seal is still out takes this ctx's clock
      // over, so phase 1's cleanup has to happen HERE too or the violet aura is
      // left on for the rest of the run. The BUFF is deliberately left alone —
      // it owns its own ten seconds and the player earned them.
      if (ctx.phase === 1) p.flags.auraColor = null;
      ctx.phase = 0;
      ctx.active = true;
      ctx.t = 0.3;
      H.applyInvuln(p.st, 0.85);                  // the grip AND the run
      H.grade(run, ctx.sealed ? SEAL_VIOLET : CHIDORI, 0.45, 0.8);
      H.camera.punch(0.06, 0.4);
      H.flash.fire(CHIDORI, 0.2, 6);
      H.audio.play('telegraph');
      H.announce(run, ctx.def.name, ctx.sealed ? SEAL_VIOLET : CHIDORI);
      return true;
    },
    tick(run, p, ctx, dt) {
      if (ctx.phase === 1) {
        // The seal is out: marks crawling over him for as long as it lasts.
        if ((run.frameParity & 3) === 0) {
          H.particles.drift(p.x + H.fxRng.signed() * 22, p.y + H.fxRng.signed() * 22,
                            SEAL_VIOLET, DRIFT_SMALL);
        }
        return;
      }
      // The grip: lightning gathering in one hand.
      if ((run.frameParity & 1) === 0) {
        const a = H.fxRng.angle();
        H.particles.emit(p.x + Math.cos(a) * 26, p.y + Math.sin(a) * 26, 0, 0, CHIDORI_GRIP_FX);
      }
    },
    end(run, p, ctx) {
      if (ctx.phase === 1) {                      // the seal receded
        ctx.phase = 0;
        p.flags.auraColor = null;
        p.removeBuff('cursed_seal');
        H.particles.ring(p.x, p.y, 16, SEAL_VIOLET, 280);
        return;
      }

      // THE RUN. Aimed, not steered: passing `src: SRC.SPECIAL` is what tells
      // escapeDirection to leave the angle alone (helpers.js, rule 2).
      CHIDORI_DASH.damage = ctx.line;
      const d = H.dash(run, p, ctx.angle, 340, 0.35, CHIDORI_DASH);
      traceLine(d.x0, d.y0, d.x1, d.y1, CHIDORI, 18);
      H.flash.fire(CHIDORI, 0.3, 5);
      H.shake.big();

      // A target that died during the wind-up must not eat the whole charge, so
      // the thrust re-acquires whatever is closest to where he actually arrived.
      let e = ctx.mark;
      if (!e || !e.active || e.hp <= 0) e = H.nearestTo(run, d.x1, d.y1, 180, null);
      ctx.mark = null;
      if (!e) return;

      // THE DISCHARGE, and it is not decoration. A pure single-target thrust
      // measured at 24 damage per cast in a full headless run, because
      // `damageDealt` is capped at the target's HP and stage fodder has 20 of
      // it: a 300-damage assassination on a mob is 280 damage thrown away, and a
      // special that only pays off against an elite is a special the player
      // stops pressing. The burst is what makes the same button work on a crowd.
      H.nova(run, p, e.x, e.y, 130, ctx.burst, CHIDORI_NOVA);

      const amount = (ctx.thrust + e.maxHp * 0.08) * (ctx.sealed ? 2 : 1);
      CHIDORI_THRUST.fromX = d.x1; CHIDORI_THRUST.fromY = d.y1;
      H.dealDamage(run, e, amount, H.SRC.SPECIAL, CHIDORI_THRUST);
      H.applyStun(e.st, 1.6);
      H.particles.burst(e.x, e.y, 14, CHIDORI, CLONE_PUFF);
      H.floaters.spawn(e.x, e.y - 44, 'PIERCED', CHIDORI, 20, 1.0);
      H.audio.play('crit');

      if (!ctx.s3) return;
      if (!ctx.forks) ctx.forks = [];
      H.collectNearest(run, e, 200, null, 4, ctx.forks);
      let n = 0;
      for (let i = 0; i < ctx.forks.length && n < 3; i++) {
        const o = ctx.forks[i];
        if (!o || o === e || !o.active || o.hp <= 0) continue;
        CHIDORI_FORK.fromX = e.x; CHIDORI_FORK.fromY = e.y;
        H.dealDamage(run, o, ctx.fork, H.SRC.SPECIAL, CHIDORI_FORK);
        traceLine(e.x, e.y, o.x, o.y, CHIDORI, 8);
        n++;
      }
      if (!ctx.sealed) return;

      // THE CURSED SEAL. It re-arms this ability's own clock rather than adding
      // a second timer somewhere: the driver honours a cast that sets ctx.active
      // inside end(), so phase 1 owns the ten seconds and cleans up after itself
      // — including when onRunEnd tears the run down mid-buff.
      if (!ctx.sealMods) ctx.sealMods = { damageMult: 0.30, moveSpeedMult: 0.20 };
      p.addBuff('cursed_seal', 10, ctx.sealMods);
      p.flags.auraColor = SEAL_VIOLET;
      ctx.phase = 1;
      ctx.active = true;
      ctx.t = 10;
      H.grade(run, SEAL_VIOLET, 0.5, 1.0);
      H.floaters.spawn(p.x, p.y - 60, 'THE SEAL BREAKS', SEAL_VIOLET, 22, 1.4, p);
    },
  },

  lions_barrage: {
    // "He vanishes and comes out 190px along your movement direction, cutting for
    //  45 on the way. Whatever is nearest when he lands is pinned and ridden
    //  down: 4 rising hits of 45, then a heel-drop for 110 in a 100px radius."
    // S5: a second charge (star level configures it) and the drop leaves a 90px
    //     crater burning for 26/s over 5s.
    cast(run, p, ctx, opts) {
      BARRAGE_DASH.damage = H.abilityDamage(run, p, 45, opts);
      const d = H.dash(run, p, p.facing, 190, ctx.def.iframes, BARRAGE_DASH);
      H.particles.cone(p.x, p.y, d.angle + Math.PI, 1.6, 8, BARRAGE_PALE, CLONE_PUFF);

      // Nothing in reach is still a clean escape — the dash has already happened
      // and the i-frames are already on. The combo is the bonus, not the escape.
      const e = H.nearestTo(run, p.x, p.y, 150, null);
      if (!e) return true;

      ctx.hit = H.abilityDamage(run, p, 45, opts);
      ctx.slam = H.abilityDamage(run, p, 110, opts);
      ctx.step = 0;
      ctx.strikeT = 0;
      ctx.active = true;
      ctx.t = 0.42;
      H.applyStun(e.st, 0.6);                     // launched: it is not going anywhere
      H.floaters.spawn(e.x, e.y - 40, 'LAUNCH', BARRAGE_PALE, 18, 0.8);
      return true;
    },
    tick(run, p, ctx, dt) {
      ctx.strikeT -= dt;
      if (ctx.strikeT > 0 || ctx.step >= 4) return;
      ctx.strikeT = 0.09;
      ctx.step++;
      // Re-acquired on every hit rather than held across ticks: a pooled slot can
      // be recycled inside half a second, and a combo that keeps swinging at a
      // corpse is worse than one that moves on to whatever is still standing.
      const e = H.nearestTo(run, p.x, p.y, 160, null);
      if (!e) return;
      BARRAGE_HIT.fromX = p.x; BARRAGE_HIT.fromY = p.y;
      H.dealDamage(run, e, ctx.hit, H.SRC.ESCAPE, BARRAGE_HIT);
      H.particles.burst(e.x, e.y, 5, BARRAGE_PALE, CLONE_PUFF);
    },
    end(run, p, ctx) {
      H.nova(run, p, p.x, p.y, 100, ctx.slam, BARRAGE_SLAM);
      H.camera.punch(0.06, 0.35);
      if (!ctx.s5) return;
      H.field(run, p, p.x, p.y, 90, 5, 'burn', H.abilityDamage(run, p, 26), CLAN_FIRE);
      H.particles.ring(p.x, p.y, 16, CLAN_FIRE, 320);
      H.floaters.spawn(p.x, p.y - 46, 'SCORCHED', CLAN_FIRE, 18, 1.0, p);
    },
  },

  sharingan: {
    // "+18% dodge chance. Every dodge is a read: a 120px riposte for 70, and
    //  +7% damage for 5s, stacking to 5."
    //
    // The card's old second clause — "every enemy telegraph appears 0.3s earlier
    // on screen for him" — was `p.flags.telegraphLead = 0.3`, and nothing in the
    // project has ever read that flag. Half the passive was text. This is the
    // half of the eye the engine can actually deliver.
    //
    // ONE buff object carries both halves. `addBuff` only extends the timer when
    // the id is already present, so a stack is a mutation of `ctx.mods` plus a
    // recompute — the same shape Firmware Update uses — rather than an
    // add/remove churn that would rebuild the whole stat pipeline twice a dodge.
    //
    // The counter is POLLED off `run.stats.dodges`. damage.js emits
    // 'player:dodged', but the ability driver has no onDodge hook to route it
    // through, and a delta poll is the pattern every kill-driven passive in this
    // file already uses. It is exact (the counter only ever goes up by whole
    // dodges) and it stays deterministic.
    init(run, p, ctx) {
      if (!ctx.mods) ctx.mods = { dodge: 0.18, damageMult: 0 };
      ctx.mods.damageMult = 0;
      p.addBuff('sharingan', 9e8, ctx.mods);
      ctx.stacks = 0;
      ctx.stackT = 0;
      ctx.dodges = run.stats.dodges;
    },
    tick(run, p, ctx, dt) {
      // The read decays as a whole rather than per stack: five independent
      // timers for one number is five recomputes a second on a busy screen.
      if (ctx.stacks > 0) {
        ctx.stackT -= dt;
        if (ctx.stackT <= 0) {
          ctx.stacks = 0;
          ctx.mods.damageMult = 0;
          p.recompute();
        }
      }
      const d = run.stats.dodges - ctx.dodges;
      if (d <= 0) return;
      ctx.dodges = run.stats.dodges;
      H.nova(run, p, p.x, p.y, 120, H.abilityDamage(run, p, 70), RIPOSTE_NOVA);
      H.flash.fire('#ff3a3a', 0.14, 8);
      ctx.stacks = Math.min(5, ctx.stacks + d);
      ctx.stackT = 5;
      ctx.mods.damageMult = 0.07 * ctx.stacks;
      p.recompute();
      H.floaters.spawn(p.x, p.y - 50, 'READ', '#ff3a3a', 17, 0.9, p);
    },
  },

  // =========================================================================
  // UZU — "The Spiral"
  //
  // He has exactly one technique and he does it a thousand times. Everything
  // here is built in that order: the clones are the ATTACK, the sphere is the
  // one thing he had to be taught, the log is the academy trick that buys him a
  // second, and the passive is the half of him that has never lost.
  // =========================================================================

  kage_bunshin_barrage: {
    // "3 shadow clones puff into existence around the nearest enemy, strike
    //  simultaneously for 12 each, and vanish. Every 0.7s. Because the clones
    //  appear AT the target, this is the only auto-attack in the game with no
    //  travel time and no line of sight requirement."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found || !t.target) return;
      const dmg = H.autoDamage(run, p, ctx.def.damage, opts);
      const n = 3 + H.extraShots(p);
      // EACH CLONE IS DRAWN, AND IT IS DRAWN AS HIM.
      //
      // The strike used to be four particles at a point: the one auto-attack in
      // the game with no projectile to watch had nothing to watch at all, and
      // "three clones appear and hit it" was a stat you had to infer from the
      // damage numbers. `p.sprite` is the character's own pixel art, so a clone
      // is a second copy of the man rather than a coloured blob — and the
      // ability never learns whose sprite it is.
      CLONE_GHOST.scale = (p.sprite && p.sprite.unit ? p.sprite.unit : 1)
                        * H.feel.playerDrawScale * CLONE_BODY_SCALE;
      let e = t.target;
      for (let i = 0; i < n; i++) {
        if (!e || !e.active || e.hp <= 0) {
          e = H.nearestTo(run, o.x, o.y, CLONE_REACH, null);
          if (!e) break;
        }
        const a = (i / n) * H.TAU + run.time * 2.2;
        const cx = e.x + Math.cos(a) * (e.radius + 22);
        const cy = e.y + Math.sin(a) * (e.radius + 22);
        CLONE_HIT.fromX = cx; CLONE_HIT.fromY = cy;
        H.dealDamage(run, e, dmg, H.SRC.AUTO, CLONE_HIT);
        // Facing the thing it is hitting, so three clones around one enemy are
        // three bodies turned inward rather than three identical stickers.
        CLONE_GHOST.angle = 0;
        H.effects.ghostSprite(cx, cy, p.sprite, CLONE_GHOST);
        H.particles.burst(cx, cy, 4, SPIRAL_ORANGE, CLONE_PUFF);
      }

      // THE FINISHER, and only ever HIS.
      //
      // Four barrages is a rhythm instead of a stream, and the combo the clones
      // are copying ends the way it ends in the source: they kick the target up
      // and one of him comes down on it heel-first.
      //
      // Gated on the ORIGIN being the player rather than on the counter, and
      // that is deliberate: `fireAutoFrom` does not restamp `ctx.shotIndex`, so
      // a mirroring clone reads whatever the player's last shot left there and
      // six bodies would land six knockdowns on the same frame. The clones copy
      // the barrage; he alone finishes it.
      if (o === p && (ctx.shotIndex % 4) === 3 && e && e.active && e.hp > 0) {
        const kx = e.x, ky = e.y - e.radius - 26;
        KICK_HIT.fromX = kx; KICK_HIT.fromY = ky;
        H.dealDamage(run, e, dmg * 2, H.SRC.AUTO, KICK_HIT);
        H.applyStun(e.st, 0.6);
        H.particles.cone(kx, ky, Math.PI * 0.5, 1.0, 8, SPIRAL_ORANGE, CLONE_PUFF);
        H.floaters.spawn(e.x, e.y - e.radius - 34, 'BARRAGE!', SPIRAL_ORANGE, 16, 0.7);
        H.camera.punch(0.02, 0.16);
      }
      H.audio.play('slash');
    },
  },

  rasengan: {
    // THE ONE HE HAD TO BE TAUGHT. Everything else in this kit is volume; this is
    // a single hit, delivered by hand, and the only thing he does with a wind-up.
    // DECISIONS.md §22.3 ships it under its pre-authored name.
    //
    // IT CLOSES ITS OWN DISTANCE. "A devastating melee hit" and "a special the
    // harness bot can never land" are the same sentence otherwise — BALANCE.md's
    // one non-bug outlier is the melee-only character whose bot refuses to walk
    // into range. So the charge is part of the ability: up to 260px, invulnerable,
    // onto whatever is nearest. The player aims it by standing somewhere.
    //
    // S3 — the giant version: four clones feed it instead of one, 520 in a 200px
    //      sphere, and it GRINDS for 1.2s at 120 damage/s instead of popping.
    //      That is the difference the source draws between the two, and it is a
    //      strict upgrade: the old S3 traded away the rest of the special to fire
    //      once, so taking it cost you damage.
    cast(run, p, ctx, opts) {
      if (!ctx.spec) ctx.spec = { mode: 'nearest', range: 520 };
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.spec, opts);
      const a = t.found ? t.angle : (o.facing !== undefined ? o.facing : p.facing);

      // The clone that spins it — one at base, four at S3. Props, not minions.
      const helpers = ctx.s3 ? 4 : 1;
      // The clones that spin the sphere are HIM, so they are drawn as him.
      HELPER_PROP.sprite = p.sprite;
      for (let i = 0; i < helpers; i++) {
        const b = (i / helpers) * H.TAU + a;
        H.prop(run, p, o.x + Math.cos(b) * 34, o.y + Math.sin(b) * 34, HELPER_PROP);
      }
      H.particles.ring(o.x, o.y, 14, SPIRAL_BLUE, 220);

      // THE CHARGE — never on a mirrored cast. THE FINAL FORM throwing his kit
      // back at him must not be able to drag the player's own body across the
      // arena, which is what moving `p` from a hostile cast would do.
      if (!H.isHostile(opts) && o === p) {
        H.applyInvuln(p.st, 0.45);
        const gap = t.found ? Math.sqrt(H.dist2(p.x, p.y, t.x, t.y)) - 34 : 0;
        const reach = Math.min(260, gap);
        if (reach > 8) H.dash(run, p, a, reach, 0, RASENGAN_DASH);
        p.facing = a;
      }

      // Re-read the origin: he has moved, and on a mirrored cast this is the boss.
      const src = H.origin(run, p, opts);
      const cx = src.x + Math.cos(a) * 26;
      const cy = src.y + Math.sin(a) * 26;
      const single = H.abilityDamage(run, p, ctx.s3 ? 520 : 300, opts);
      const splash = H.abilityDamage(run, p, ctx.s3 ? 260 : 150, opts);
      const radius = ctx.s3 ? 200 : 120;

      // It goes INTO one body. The spiral is what everything else gets.
      const e = t.target;
      if (e && e.active && e.hp > 0) {
        RASENGAN_HIT.fromX = src.x; RASENGAN_HIT.fromY = src.y;
        H.dealDamage(run, e, single, H.SRC.SPECIAL, RASENGAN_HIT);
      }
      H.nova(run, p, cx, cy, radius, splash, RASENGAN_NOVA);
      H.field(run, p, cx, cy, radius, 1.2, 'pull', 0, SPIRAL_BLUE, RASENGAN_PULL);

      ctx.active = true;
      ctx.t = ctx.s3 ? 1.2 : 0.35;
      ctx.gx = cx; ctx.gy = cy; ctx.gr = radius;
      ctx.grind = ctx.s3 ? H.abilityDamage(run, p, 120, opts) * 0.25 : 0;
      ctx.grindT = 0.25;

      H.grade(run, SPIRAL_BLUE, 0.45, 0.7);
      H.camera.punch(0.09, 0.45);
      H.shake.big();
      H.floaters.spawn(src.x, src.y - 70, ctx.s3 ? 'GIANT SPIRAL' : 'SPIRAL',
                       SPIRAL_BLUE, 26, 1.2);
      H.announce(run, ctx.def.name, SPIRAL_BLUE);
      return true;
    },
    tick(run, p, ctx, dt) {
      // Base: the sphere just keeps turning for a third of a second. S3: it is
      // still in the wound. Four ticks a second, never per frame.
      if (ctx.grind <= 0) return;
      ctx.grindT -= dt;
      if (ctx.grindT > 0) return;
      ctx.grindT = 0.25;
      H.areaDamage(run, ctx.gx, ctx.gy, H.area(p, ctx.gr), ctx.grind, H.SRC.SPECIAL,
                   { falloff: 0.2, element: 'spirit', canCrit: false, noNumber: true });
      H.particles.drift(ctx.gx + H.fxRng.signed() * ctx.gr * 0.5,
                        ctx.gy + H.fxRng.signed() * ctx.gr * 0.5,
                        SPIRAL_BLUE, DRIFT_SMALL);
    },
    end(run, p, ctx) {
      H.particles.ring(ctx.gx, ctx.gy, 22, SPIRAL_BLUE, 380);
    },
  },

  substitution_jutsu: {
    // "A log takes the hit in his place. The log should be a real, visible,
    //  comically ordinary log."
    //
    // WHAT CHANGED. This used to blink him BEHIND the nearest enemy for a
    // guaranteed 250% backstab — an assassin's move on the one character in the
    // roster who has never come at anything from behind, and an "escape" whose
    // whole job was to put him back inside the crowd. It was also incoherent:
    // `blink` routes its destination through the player's movement intent, so
    // the hop was correctly re-aimed onto the stick while the backstab damage
    // still landed on an enemy that could now be half a screen away.
    //
    // So the log stays, the direction is the player's, and what he does on
    // landing is the OTHER academy trick — he comes back up as somebody else,
    // and everything close enough to look at him stops dead for 1.4s. That is
    // the transformation used the way the source uses it: as a weapon.
    //
    // S5: three doubles instead of one of him, taunting for 4s, and the log
    //     detonates for 120 in 140px. (The second charge is the star level's.)
    cast(run, p, ctx, opts) {
      const x0 = p.x, y0 = p.y;
      LOG_PROP.onExpire = ctx.s5 ? logDetonate : null;
      LOG_PROP.life = ctx.s5 ? 1.2 : 2.6;
      const log = H.prop(run, p, x0, y0, LOG_PROP);
      if (log && ctx.s5) log.damage = H.abilityDamage(run, p, 120, opts);

      // His own heading, or away from the thickest part of the room when he is
      // standing still. `blink` gives the stick the final word over both.
      let a = p.facing;
      if (p.movingT <= 0) {
        const t = H.target(run, p, SUB_AWAY, opts);
        if (t.found) a = t.angle + Math.PI;
      }
      const dist = 200 * (p.flags.escapeDistanceMult || 1);
      H.blink(run, p, x0 + Math.cos(a) * dist, y0 + Math.sin(a) * dist, ctx.def.iframes);

      H.nova(run, p, p.x, p.y, 150,
             H.abilityDamage(run, p, 60, opts) + (p.flags.escapeDamages || 0), SUB_NOVA);
      H.flash.fire(DOUBLE_PINK, 0.18, 5);
      H.floaters.spawn(p.x, p.y - 46, ctx.s5 ? 'ALL OF THEM?!' : 'WHO?!',
                       DOUBLE_PINK, 18, 1.0, p);

      if (ctx.s5) {
        DOUBLE_PROP.sprite = p.sprite;
        for (let i = 0; i < 3; i++) {
          const b = (i / 3) * H.TAU + a;
          H.prop(run, p, p.x + Math.cos(b) * 58, p.y + Math.sin(b) * 58, DOUBLE_PROP);
        }
      }
      H.particles.burst(x0, y0, 10, LOG_BROWN, CLONE_PUFF);
      return true;
    },
  },

  never_gives_up: {
    // TWO HALVES, AND THE NAME NOW MEANS BOTH OF THEM.
    //
    // "Every 10 kills spawns one bonus clone that persists until killed (max 5).
    //  The clone army builds over a run."
    //
    // ...and the half the name has been writing a cheque for and never cashing:
    // he does not go down. Every 14s one of him steps in front of the next hit —
    // through `st.shieldHits`, the same counter every other guard in the game
    // uses — and when it is spent he comes back up swinging. Under half HP the
    // chakra doing it is red instead of orange, which is the only place that
    // colour appears in his kit and is meant to be read as "nearly finished".
    init(run, p, ctx) {
      ctx.kills = 0; ctx.lastAt = 0; ctx.hookLive = 0;
      ctx.guardT = GUARD_PERIOD; ctx.guardUp = false; ctx.guardMark = 0;
    },
    onKill(run, p, ctx, e) {
      ctx.hookLive = 1;
      ctx.kills++;
      growArmy(run, p, ctx, e);
    },
    tick(run, p, ctx, dt) {
      if (pollKills(run, ctx) > 0) growArmy(run, p, ctx, null);

      if (ctx.guardUp) {
        // Measured against the count we LEFT it at rather than against zero: a
        // relic stacking its own shield on top delays this read by a hit instead
        // of hiding it for the rest of the run.
        if (p.st.shieldHits >= ctx.guardMark) return;
        ctx.guardUp = false;
        ctx.guardT = GUARD_PERIOD;
        const feral = p.hp < p.maxHp * 0.5;
        GUARD_NOVA.color = feral ? SPIRAL_RED : SPIRAL_ORANGE;
        H.nova(run, p, p.x, p.y, 140, H.abilityDamage(run, p, 40), GUARD_NOVA);
        H.particles.burst(p.x, p.y, 12, GUARD_NOVA.color, CLONE_PUFF);
        H.floaters.spawn(p.x, p.y - 52, feral ? 'NOT DONE YET' : 'ONE OF ME',
                         GUARD_NOVA.color, 18, 1.1, p);
        H.audio.play('escape');
        return;
      }

      ctx.guardT -= dt;
      if (ctx.guardT > 0) return;
      ctx.guardT = 0;
      H.addShield(p.st, 1);
      ctx.guardMark = p.st.shieldHits;
      ctx.guardUp = true;
      H.floaters.spawn(p.x, p.y - 46, 'CLONE GUARD', SPIRAL_ORANGE, 16, 0.9, p);
    },
  },

  // =========================================================================
  // CAPTAIN YULI — "Humanity's Strongest"
  // =========================================================================

  twin_blade_cross: {
    // "Rapid alternating slashes in a short 90° arc (70px), 11 damage, every
    //  0.35s. Highest raw DPS in the game, but you must be in melee."
    //
    // IT IS CALLED TWIN BLADE CROSS, SO IT SWINGS BOTH BLADES, TOGETHER.
    // The spec's "alternating" was ONE blade per swing, tilted 19° to either
    // side — a man with one sword and a nervous tic. The move is a SCISSOR: both
    // blades start at the OUTSIDE edges of the cone and whip inward to cross on
    // the facing direction. `effects.slash` cocks its head backwards for the
    // first sixth of its life, so the pair flares outward before it snaps shut,
    // which is the whole read.
    //
    // THE DPS BUDGET IS UNCHANGED, AND THAT IS GEOMETRY, NOT A RE-TUNE.
    // Each blade owns exactly HALF the cone, and the halves do not overlap:
    // [facing - 45°, facing] and [facing, facing + 45°]. Their union is the same
    // 90° cone the single swing covered, so every enemy still takes exactly ONE
    // hit of the full `dmg` per swing. Splitting the DAMAGE instead — two
    // half-strength swings over the whole cone — would have been a large stealth
    // nerf: damage.js subtracts armour PER HIT, so 2 x (5.5 - armour) is strictly
    // worse than (11 - armour) against anything armoured, and it would double
    // every per-hit relic proc, lifesteal tick and damage number as well.
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      const dmg = H.autoDamage(run, p, ctx.def.damage, opts);
      const blade = YULI_CROSS_ARC * 0.5;    // one blade's own cone
      const off = YULI_CROSS_ARC * 0.25;     // ...and where that cone is centred
      H.meleeArc(run, p, o.x, o.y, t.angle - off, blade,
                 YULI_CROSS_REACH, dmg, YULI_ARC_NEG);
      H.meleeArc(run, p, o.x, o.y, t.angle + off, blade,
                 YULI_CROSS_REACH, dmg, YULI_ARC_POS);
      // Where they cross. One pooled flash on the centre line is the whole
      // difference between "two swings happened" and "the blades met".
      const reach = H.area(p, YULI_CROSS_REACH);
      YULI_CLASH.tier = H.visualTier(p, YULI_ARC_NEG);
      H.effects.impact(o.x + Math.cos(t.angle) * reach * 0.82,
                       o.y + Math.sin(t.angle) * reach * 0.82,
                       STEEL_PALE, YULI_CLASH);
    },
  },

  nape_strike: {
    // "Grapples to the highest-max-HP enemy on screen and executes: 200 damage
    //  +12% of the target's MAX HP. Doubles against Large enemies. Full i-frames
    //  during the flight."
    // S3: hits the top 3 highest-HP enemies.
    cast(run, p, ctx, opts) {
      if (!ctx.list) { ctx.list = []; ctx.picks = []; }
      H.collectNearest(run, p, 900, null, 12, ctx.list);
      const want = ctx.s3 ? 3 : 1;
      ctx.picks.length = 0;
      for (let k = 0; k < want; k++) {
        let best = -1, bestHp = -1;
        for (let i = 0; i < ctx.list.length; i++) {
          const e = ctx.list[i];
          if (!e || !e.active || e.hp <= 0) continue;
          if (e.maxHp > bestHp) { bestHp = e.maxHp; best = i; }
        }
        if (best < 0) break;
        ctx.picks.push(ctx.list[best]);
        ctx.list[best] = null;
      }
      if (ctx.picks.length === 0) return false;   // no nape on screen: no cooldown spent

      ctx.step = 0;
      ctx.strikeT = 0;
      ctx.active = true;
      ctx.t = 0.24 * ctx.picks.length + 0.12;
      H.applyInvuln(p.st, ctx.t + 0.15);          // full i-frames for the whole flight
      H.grade(run, STEEL_PALE, 0.32, 0.6);
      H.camera.punch(0.06, 0.4);
      H.announce(run, ctx.def.name, STEEL_PALE);
      return true;
    },
    tick(run, p, ctx, dt) {
      ctx.strikeT -= dt;
      if (ctx.strikeT > 0 || ctx.step >= ctx.picks.length) return;
      ctx.strikeT = 0.24;
      const e = ctx.picks[ctx.step++];
      if (!e || !e.active || e.hp <= 0) return;

      const x0 = p.x, y0 = p.y;
      const a = H.angleTo(x0, y0, e.x, e.y);
      traceLine(x0, y0, e.x, e.y, STEEL_PALE, 12);
      H.blink(run, p, e.x - Math.cos(a) * (e.radius + 24), e.y - Math.sin(a) * (e.radius + 24), 0.3);
      p.facing = a;

      // 200 + 12% of MAX HP, doubled against Large.
      const base = (200 + e.maxHp * 0.12) * (e.size === 'large' ? 2 : 1);
      NAPE_HIT.fromX = p.x; NAPE_HIT.fromY = p.y;
      H.dealDamage(run, e, H.abilityDamage(run, p, base), H.SRC.SPECIAL, NAPE_HIT);
      H.particles.cone(e.x, e.y, a, 1.0, 10, STEEL_PALE, CLONE_PUFF);
      H.audio.play('crit');
      H.shake.medium();
    },
  },

  grapple_line: {
    // "Fires an anchor 320px in the aim direction and zips there. Invulnerable
    //  in flight, damages enemies along the line (45)."
    // S5: refunds instantly if it kills something mid-flight.
    cast(run, p, ctx, opts) {
      const a = run.aimAngle();
      SCRATCH.killed = false;
      const d = H.dash(run, p, a, 320, ctx.def.iframes, GRAPPLE_DASH);
      traceLine(d.x0, d.y0, d.x1, d.y1, STEEL_PALE, 16);
      H.lineDamage(run, d.x0, d.y0, d.x1, d.y1, H.area(p, 34),
                   H.abilityDamage(run, p, 45, opts), H.SRC.ESCAPE, GRAPPLE_LINE);
      H.audio.play('slash');
      if (ctx.s5 && SCRATCH.killed) {
        // The refund cannot happen inside cast() — run.js consumes the charge
        // immediately afterwards — so it lands on the next tick instead.
        ctx.refund = true;
        ctx.active = true;
        ctx.t = 0.05;
      }
      return true;
    },
    end(run, p, ctx) {
      if (!ctx.refund) return;
      ctx.refund = false;
      p.escape.refill();
      H.floaters.spawn(p.x, p.y - 44, 'LINE FREE', STEEL_PALE, 18, 1.0, p);
    },
  },

  devotion: {
    // "+45% damage vs. Large and Elite enemies."
    tick(run, p, ctx, dt) {
      ctx.markT = (ctx.markT || 0) - dt;
      if (ctx.markT > 0) return;
      ctx.markT = 0.25;
      // Routed through the damage pipeline as an incoming-damage multiplier so
      // it applies to every source he owns without a branch in damage.js.
      H.forEachEnemyIn(run, p.x, p.y, 800, markDevotion);
    },
  },

  // =========================================================================
  // KAGURA — "The Nine-Tailed Casteress"
  // =========================================================================

  ofuda_talismans: {
    // "2 slow-flying homing paper charms that stick to an enemy and detonate
    //  after 0.8s for 22 damage in a small AoE. Every 1.1s.
    //  Targeting: randomInRange (prefers unmarked enemies)."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      OFUDA_SHOT.damage = H.autoDamage(run, p, ctx.def.damage, opts);
      OFUDA_SHOT.target = t.target;
      // Paper TUMBLES. The direction alternates per volley so two charms in the
      // air are never one rigid object turning with the camera.
      OFUDA_SHOT.spin = (ctx.shotIndex & 1) ? 5.4 : -5.4;
      H.spread(run, p, o.x, o.y, t.angle, 2, 0.24, OFUDA_SHOT);
      H.particles.cone(o.x, o.y, t.angle, 0.55, 3, OFUDA_PAPER, OFUDA_FLUTTER);
      H.audio.play('shoot');
    },
  },

  nine_tail_blaze: {
    // "Summons 9 foxfire wisps that orbit her and then seek targets
    //  independently, 45 damage each, burning for 3s."
    // S3: the wisps leave burning foxfire trails.
    cast(run, p, ctx, opts) {
      WISP_SUMMON.damage = H.abilityDamage(run, p, 45, opts);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * H.TAU;
        WISP_SUMMON.orbitAngle = a;
        const wx = p.x + Math.cos(a) * 44, wy = p.y + Math.sin(a) * 44;
        H.summon(run, p, wx, wy, WISP_SUMMON);
        // Each flame lights where it is born, so nine of them arriving reads as
        // nine separate ignitions rather than as one ring appearing.
        H.particles.burst(wx, wy, 4, FOX_SPIRIT, WISP_SPAWN);
      }
      ctx.active = true;
      ctx.t = WISP_SUMMON.life;
      ctx.trailT = 0;
      ctx.burn = WISP_SUMMON.damage / 3;
      H.grade(run, FOX_SPIRIT, 0.4, 0.8);
      H.camera.punch(0.05, 0.4);
      H.announce(run, ctx.def.name, FOX_PINK);
      return true;
    },
    tick(run, p, ctx, dt) {
      if (!ctx.s3) return;
      ctx.trailT -= dt;
      if (ctx.trailT > 0) return;
      ctx.trailT = 0.35;
      const items = run.minions.items;
      for (let i = 0; i < run.minions.count; i++) {
        const m = items[i];
        if (m.tag !== WISP_SUMMON.tag) continue;
        H.field(run, p, m.x, m.y, 34, 1.6, 'burn', ctx.burn, FOX_BLUE);
      }
    },
  },

  torii_warp: {
    // "She blinks, and a torii gate is left standing where she went."
    //
    // THE PRESS ALWAYS WORKS. `cooldown` is 0 in the character data, so run.js
    // never refuses it and the HUD radial never counts down. There is no
    // plant-then-return state machine to be caught halfway through, no window to
    // miss, and no moment where the escape button does nothing — which was the
    // entire complaint about the old one, and was real: run.js only reaches an
    // escape while its cooldown is ready, so the old first press spent the
    // charge on a bookmark and had to refund it a tick later.
    //
    // WHAT IS METERED IS THE PURIFICATION, NOT THE ESCAPE. Everything run.js
    // does after a successful cast is per-press — the i-frames, every onEscape
    // relic (Anchor Gear detonates for 60, Kaio-ken hands out a buff) and the
    // cast event — so a genuinely free press at six presses a second is
    // permanent invulnerability and free AoE: DECISIONS.md §28's infinite loop,
    // arriving through the front door rather than through the ZERO COOLDOWN
    // evolution it was written to stop. So the ability holds two purification
    // charges, one back every 4.5s, and spends one to ARM a press. A press with
    // no charge still teleports her the full distance and still leaves a gate;
    // it simply buys distance instead of invulnerability, damage and relic
    // procs, and says so through `p.flags.escapeFree`.
    //
    // The charge is integrated from `run.time` on the press rather than counted
    // down in a tick(), which is what lets the ability never declare itself
    // active: an escape sitting `active` all run would pin an untimed duration
    // bar to the middle of the HUD for the whole run.
    //
    // S5: three charges at 3.0s each, and gates stand for the rest of the run.
    cast(run, p, ctx, opts) {
      if (!ctx.gates) { ctx.gates = []; ctx.uids = []; }
      const maxCharge = ctx.s5 ? 3 : 2;
      const rate = ctx.s5 ? WARP_RECHARGE_S5 : WARP_RECHARGE;
      if (ctx.chargeAt === undefined) { ctx.charge = maxCharge; ctx.chargeAt = run.time; }
      let c = ctx.charge + (run.time - ctx.chargeAt) / rate;
      if (c > maxCharge) c = maxCharge;
      ctx.chargeAt = run.time;

      // The gate marks where she LEFT, so it always stands over the thing she
      // got out of rather than the empty ground she arrived on.
      const x0 = p.x, y0 = p.y;
      const dist = WARP_DIST * (p.flags.escapeDistanceMult || 1);
      const a = p.facing || 0;
      // iframes 0 here: run.js grants them, and only for an armed press. `blink`
      // re-aims the hop through the player's own movement intent
      // (helpers.js escapeDirection), so the warp goes where you are leaning.
      H.blink(run, p, x0 + Math.cos(a) * dist, y0 + Math.sin(a) * dist, 0);

      // THE FINAL FORM mirroring her kit must not spend the player's charges.
      const charged = c >= 1 && !H.isHostile(opts);
      ctx.charge = charged ? c - 1 : c;
      p.flags.escapeFree = !charged;

      plantGate(run, p, ctx, x0, y0, charged);

      if (charged) {
        H.nova(run, p, p.x, p.y, 150, H.abilityDamage(run, p, 60, opts), PURIFY_NOVA);
        H.particles.ring(p.x, p.y, 20, TORII_GLOW, 420);
        H.flash.fire(TORII_RED, 0.18, 5);
        H.floaters.spawn(p.x, p.y - 46, 'PURIFY', FOX_PINK, 20, 1.0, p);
      } else {
        // A free warp is deliberately quieter. The player has to be able to see,
        // without looking away from their character, that this one carried no
        // burst and no i-frames — and still got them out.
        H.particles.ring(p.x, p.y, 10, TORII_GLOW, 240);
        H.floaters.spawn(p.x, p.y - 46, 'WARP', TORII_GLOW, 15, 0.8, p);
      }
      return true;
    },
  },

  purification: {
    // "12% chance on kill to drop a spirit orb worth 3x XP."
    init(run, p, ctx) { ctx.kills = 0; ctx.hookLive = 0; },
    onKill(run, p, ctx, e) {
      ctx.hookLive = 1;
      ctx.kills++;
      if (H.runRng.chance(0.12)) dropSpiritOrb(run, p, e);
    },
    tick(run, p, ctx, dt) {
      let d = pollKills(run, ctx);
      while (d-- > 0) {
        if (H.runRng.chance(0.12)) dropSpiritOrb(run, p, null);
      }
    },
  },

  // =========================================================================
  // UNIT-09 "AI-CHAN" — "Super A.I."
  // =========================================================================

  channel_beam: {
    // "Alternating left/right energy bolts fired from her ribbon-ears, 13 damage,
    //  pierce 1, every 0.5s. Perfectly accurate. Targeting: nearest."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      // Left ear, right ear, left ear...
      const side = (ctx.shotIndex & 1) ? 1 : -1;
      const px = o.x + Math.cos(t.angle + Math.PI / 2) * 13 * side;
      const py = o.y + Math.sin(t.angle + Math.PI / 2) * 13 * side;
      H.spread(run, p, px, py, t.angle, 1, 0.18, {
        damage: H.autoDamage(run, p, ctx.def.damage, opts),
        speed: 680, life: 1.3, radius: 8,
        pierce: 1,
        // Perfectly accurate, every time, forever: it steers onto the target.
        motion: H.MOTION.HOMING, target: t.target, turnRate: 9,
        element: 'lightning',
        visual: V_BOLT,
        trailColor: AI_BOLT,
        splitInto: p.flags.autoSplitInto || 0,
        tag: 'beam',
      });
      H.audio.play('shoot');
    },
  },

  super_ai_mode: {
    // "For 6s, fire rate is DOUBLED and every shot splits into 3 on impact. She
    //  takes +25% damage during it. Screen tints electric pink, the UI glitches,
    //  and the subscriber counter spins upward."
    // S3: no longer applies the +25% damage-taken penalty.
    cast(run, p, ctx) {
      ctx.active = true;
      ctx.t = 6;
      p.flags.attackSpeedBonus = 2;
      p.flags.autoSplitInto = 3;
      p.flags.uiGlitch = true;
      p.flags.auraColor = AI_PINK;
      if (!ctx.s3) H.applyVulnerable(p.st, 1.25, 6);
      H.grade(run, AI_PINK, 0.5, 1.0);
      H.camera.punch(0.08, 0.5);
      H.announce(run, ctx.def.name, AI_PINK);
      return true;
    },
    tick(run, p, ctx, dt) {
      // The subscriber counter spins upward. The HUD reads the flag generically.
      p.flags.subscribers = (p.flags.subscribers || 0) + 900 * dt;
      if ((run.frameParity & 3) === 0) {
        H.particles.drift(p.x + H.fxRng.signed() * 34, p.y + H.fxRng.signed() * 34,
                          AI_PINK, DRIFT_SMALL);
      }
    },
    end(run, p, ctx) {
      p.flags.attackSpeedBonus = 1;
      p.flags.autoSplitInto = 0;
      p.flags.uiGlitch = false;
      p.flags.auraColor = null;
      H.particles.ring(p.x, p.y, 18, AI_PINK, 320);
    },
  },

  error: {
    // "She blue-screens. 0.7s invulnerable, then a burst of corrupted data
    //  (160px) that STUNS enemies for 1.5s and deals 50 damage. She apologises
    //  to chat afterwards."
    // S5: also disables enemy ranged attacks for 4s.
    cast(run, p, ctx) {
      ctx.active = true;
      ctx.t = ctx.def.iframes;                    // 0.7s of blue screen
      H.applyInvuln(p.st, ctx.def.iframes);
      H.grade(run, BSOD_BLUE, 0.55, 0.7);
      H.camera.punch(0.05, 0.3);
      H.particles.burst(p.x, p.y, 12, BSOD_BLUE, CLONE_PUFF);
      H.floaters.spawn(p.x, p.y - 52, 'ERROR', '#ffffff', 24, 0.8, p);
      H.audio.play('telegraph');
      return true;
    },
    tick(run, p, ctx, dt) {
      // Corrupted-data confetti while the screen is blue.
      if ((run.frameParity & 1) === 0) {
        H.particles.drift(p.x + H.fxRng.signed() * 26, p.y + H.fxRng.signed() * 26,
                          BSOD_BLUE, DRIFT_SMALL);
      }
    },
    end(run, p, ctx) {
      H.nova(run, p, p.x, p.y, 160, H.abilityDamage(run, p, 50), ERROR_NOVA);
      H.flash.fire(BSOD_BLUE, 0.3, 4);
      H.shake.medium();
      if (ctx.s5) H.forEachEnemyIn(run, p.x, p.y, 600, silenceRanged);
      H.floaters.spawn(p.x, p.y - 46, 'sorry chat!!', AI_PINK, 17, 1.4, p);
    },
  },

  firmware_update: {
    // "Each level-up permanently grants +2% attack speed this run (stacks forever)."
    init(run, p, ctx) {
      // Her whole UI is a streaming overlay — subscriber counter, chat ticker,
      // LIVE dot. The HUD renders it off these flags, for anyone who has them.
      p.flags.streamOverlay = true;
      p.flags.subscribers = p.flags.subscribers || 0;
      if (!ctx.mods) ctx.mods = { attackSpeedMult: 0 };
      ctx.stacks = 0;
      ctx.level = p.level;
      ctx.hookLive = 0;
    },
    onLevelUp(run, p, ctx) {
      ctx.hookLive = 1;
      firmwareStack(run, p, ctx);
    },
    tick(run, p, ctx, dt) {
      p.flags.subscribers += 9 * dt;
      if (ctx.hookLive) return;
      while (ctx.level < p.level) { ctx.level++; firmwareStack(run, p, ctx); }
    },
  },
});

// ---------------------------------------------------------------------------
// Passive bodies, kept out of the entries so both the hook path and the poll
// path run exactly the same code.
// ---------------------------------------------------------------------------

/** Hoshiyomi: a small heart every 10 kills, worth a flat 3 HP. */
function dropHearts(run, p, ctx, e) {
  while (ctx.kills - ctx.lastAt >= 10) {
    ctx.lastAt += 10;
    // The pickup heals a fraction of max HP, so 3 HP is expressed as a fraction
    // of the max HP she has right now.
    HEART_PAYLOAD.value = 3 / Math.max(1, p.maxHp);
    const x = e ? e.x : p.x + H.fxRng.signed() * 40;
    const y = e ? e.y : p.y + H.fxRng.signed() * 40;
    run.pickups.dropPickup(x, y, 'heart', HEART_PAYLOAD);
    H.particles.burst(x, y, 5, REI_PALE, CLONE_PUFF);
  }
}

/** Never Gives Up: one more clone every 10 kills, up to 5, until it is killed. */
function growArmy(run, p, ctx, e) {
  while (ctx.kills - ctx.lastAt >= 10) {
    ctx.lastAt += 10;
    BONUS_CLONE_SUMMON.damage = H.autoDamage(run, p, p.def.autoAttack.damage) * 0.6;
    BONUS_CLONE_SUMMON.attackInterval = p.def.autoAttack.interval;
    BONUS_CLONE_SUMMON.orbitAngle = H.runRng.angle();
    // The army is copies of HIM, so they are drawn as him.
    BONUS_CLONE_SUMMON.sprite = p.sprite;
    const a = H.runRng.angle();
    const m = H.summon(run, p, p.x + Math.cos(a) * 70, p.y + Math.sin(a) * 70, BONUS_CLONE_SUMMON);
    if (m) H.floaters.spawn(p.x, p.y - 52, 'ONE MORE', SPIRAL_ORANGE, 17, 1.0, p);
  }
}

/** Purification: a spirit orb worth 3x XP. */
function dropSpiritOrb(run, p, e) {
  const x = e ? e.x : p.x + H.fxRng.signed() * 40;
  const y = e ? e.y : p.y + H.fxRng.signed() * 40;
  // With the enemy in hand the orb is worth 3x what it dropped; without it (the
  // polled path) it falls back to 3x a tier-2 gem.
  const gems = run.data.upgrades.XP_GEMS;
  const value = e && e.xp ? e.xp * 3 : gems[1].value * 3;
  run.pickups.dropGem(x, y, value);
  H.particles.ring(x, y, 10, FOX_PINK, 200);
}
