// THE FIVE CHARACTERS ADDED AFTER THE ORIGINAL NINETEEN — twenty pillars.
//
// Two ★6 (the Disaster Idol and the Ordinary Magic Scholar) and three ★5 (the
// Corporate Kitsune, the Precision Caster and the Frightened Berserker). The
// file follows star6.js exactly: `registerAll({...})`, one `import * as H`, a
// module-level constant for every options bag, visual descriptor, targeting spec
// and iteration callback, and NO closure anywhere a frame can reach.
//
// Nothing here branches on a character id — the registry key IS the branch
// (DECISIONS.md §36) — and every number is either read off `ctx.def` or quoted
// from the character's own card in src/data/characters.js.
//
// WHY THIS FILE ALSO CARRIES FIVE RELIC IMPLEMENTATIONS
// -----------------------------------------------------
// `relicHooks.js` deliberately does NOT import the ability layer, so that a
// consumer reading HOOK_NAMES does not drag 170KB of abilities in at module
// load. That arrow points one way and this file respects it: the dependency
// added here runs abilities -> relicHooks, which already exists transitively
// through helpers.js, and never the reverse. The five new signature relics are
// therefore registered INTO the exported `RELIC_IMPL` table at the bottom of
// this file rather than by editing it — additive, idempotent, and it keeps the
// five new characters' content in the one module that owns them.

import { registerAll } from './index.js';
import * as H from './helpers.js';
import { RELIC_IMPL } from '../relicHooks.js';

/** A "permanent for the rest of the run" buff duration. */
const FOREVER = 1e9;
const THIRD = H.TAU / 3;

// ===========================================================================
//                              PALETTES
// ===========================================================================
// AOI — porcelain white over maid navy, with tea gold for the accidents, plus
// the two greys the lighting rig is painted. The rig is deliberately the only
// thing in her palette that is not crockery or tea: when a girder-grey object
// is on screen, it is structural, it is not hers, and it is coming down.
const C_PORCELAIN = '#eaf2ff';
const C_MAID = '#1e2440';
const C_TEA = '#c9a227';
const C_AOI = '#7fb6ff';
const C_RIG = '#8a93a8';
const C_RIG_DARK = '#12161f';
// MIREL — plain white magic, old gold, and one green for the flowers.
const C_PLAIN = '#f2f6ff';
const C_GOLD = '#c8a24a';
const C_MEADOW = '#8fe6a8';
// YUKINE — white-blue foxfire, never orange. That is the whole separation from
// the other fox on the roster.
const C_FOXFIRE = '#dff4ff';
const C_ICE = '#3fb6c8';
// WREN — lilac discipline.
const C_LILAC = '#c3a8ff';
const C_CHALK = '#f4f1ea';
// BRANT — rust red and cold steel.
const C_RUST = '#c8452c';
const C_STEEL = '#b8c2ce';

// ===========================================================================
//                    SHARED SCRATCH FOR ITERATION CALLBACKS
// ===========================================================================
/**
 * Written immediately before the iteration that reads it and consumed
 * synchronously, so one module-level record lets every callback below be a
 * function REFERENCE instead of a per-call closure.
 */
const S = {
  run: null, x: 0, y: 0, n: 0, t: 0, mult: 1, dps: 0, dur: 0, force: 0,
};

function tauntToPoint(e) { H.applyTaunt(e.st, S.t, S.x, S.y); S.n++; }
function signContract(e) { H.applyVulnerable(e.st, S.mult, S.dur); S.n++; }
function stunAndLose(e) { H.applyStun(e.st, S.t); S.n++; }
function scareOff(e) {
  if (!e.knockbackImmune && !e.isBoss) {
    const dx = e.x - S.x, dy = e.y - S.y;
    const d = Math.hypot(dx, dy) || 1;
    e.kbx = dx / d * S.force;
    e.kby = dy / d * S.force;
  }
  H.applySlow(e.st, 0.6, S.dur);
  S.n++;
}
function burnNear(e) { H.applyBurn(e.st, S.dps, S.dur); }
function countBodies() { S.n++; }
function bleedRust(e) { H.applyBleed(e.st, RUST_BLEED, RUST_BLEED_TIME); S.n++; }
/**
 * Buffed to a mirror: thinner plate AND a much easier thing to see. The glint
 * is per BODY rather than per cast — the point of the spell is that you can
 * pick the polished ones out of a crowd afterwards — and capped, because a
 * thirty-strong pack would otherwise empty the effect pool on housework.
 */
function polishArmour(e) {
  H.applyShred(e.st, POLISH_SHRED, POLISH_TIME);
  H.applyVulnerable(e.st, POLISH_VULN, POLISH_TIME);
  if (S.n < POLISH_GLINTS) H.effects.impact(e.x, e.y, C_PLAIN, POLISH_GLINT);
  S.n++;
}

// ===========================================================================
//                    AOI — water, rarity 6, "The Catastrophe Maid"
// ===========================================================================

// EVERYTHING SHE DOES IS AN ACCIDENT WITH A RADIUS, AND IT HAS TO LOOK LIKE ONE
// ----------------------------------------------------------------------------
// Her numbers were finished long before she looked like anything. Three white
// circles left in a fan, a shockwave appeared where the ceiling was supposed to
// be, and a slide that ends in a bow was a ring on the floor — the fumbled tray
// and the lighting truss were the same expanding hoop in two different colours.
// None of it read as porcelain, as a DROP, or as a mistake, which for a
// character whose entire premise is that she breaks things is the whole joke
// missing.
//
// So everything below that is an OBJECT is now drawn as one. `effects.
// sweepSprite` and `effects.fallSprite` blit an already-rastered atlas prop
// source-over in a second pass, which is the one thing the energy primitives
// cannot do: a saucer is a saucer, a truss is a truss, and both are made of
// matter that falls. The energy effects stay exactly where they were — they are
// what the object DID to the room — and the prop is what did it.
//
// Every descriptor here is a literal copy of an entry in EFFECT_VISUALS in
// src/render/prewarm.js. `rotates` and `flash` are both part of the atlas key,
// so a descriptor that differs by one field rasterises a SECOND copy the first
// time she throws — mid-run, at the exact moment the player casts something —
// and tests/renderSmoke.js fails the build naming the key it had to bake.
// Registering them here, at module level, is what puts them in the atlas before
// the boot pass ever looks.

// --- Flying Saucers ---------------------------------------------------------
const V_SAUCER = { shape: 'saucer', color: C_PORCELAIN, accent: C_MAID, size: 11, rotates: true };
const V_TRAY = { shape: 'saucer', color: C_TEA, accent: C_MAID, size: 18, flash: false };
const SP_SAUCER = H.atlas.register(V_SAUCER);
const SP_TRAY = H.atlas.register(V_TRAY);

const SAUCER_COUNT = 3;
/** The fan she throws into. `spread` spreads over exactly this. */
const SAUCER_FAN = 0.5;
const SAUCER = {
  damage: 0, speed: 470, life: 1.4, radius: 10, pierce: 2,
  motion: H.MOTION.BOOMERANG, element: 'water',
  visual: V_SAUCER, trailColor: C_PORCELAIN, tag: 'saucer', onExpire: null,
};

/**
 * THE RELEASE — one sweep per saucer, pivoting on her hands.
 *
 * A projectile's drawn rotation is its velocity angle and nothing else: it
 * cannot wobble, because the only thing it knows is where it is going. The
 * wobble therefore has to live in the THROW. Each saucer gets a sweep of its
 * own along the angle it was thrown at, and because `sweepSprite` aligns every
 * ghost along its OWN radius, the two ghosts behind the head sit at visibly
 * different angles — a plate that left a hand badly, tumbling, rather than a
 * plate on rails. The sweep alternates hands every throw and alternates again
 * between the saucers within one throw, so no two of the three leave the same
 * way and no two consecutive throws are the same throw twice. All of it is
 * index-driven and none of it touches an RNG, because a cosmetic that consumed
 * the run stream would desynchronise a seeded replay for a wobble.
 *
 * The radius is short and the life is a sixth of a second: by the time it fades
 * the real saucers are 80px out and these are the blur they left behind.
 */
const RELEASE_RADIUS = 46;
const RELEASE_ARC = 0.5;
/** At most four release flourishes, however many Extra Shot has stacked on. */
const RELEASE_MAX = 4;
const SAUCER_RELEASE = { tier: 0, life: 0.17, alpha: 0.9, sweep: 1, scale: 1, ghosts: 2 };
/** The tray itself stays in her hands — on every throw but the fourth. */
const TRAY_RADIUS = 30;
const TRAY_ARC = 1.2;
const TRAY_SWING = { tier: 0, life: 0.22, alpha: 0.62, sweep: 1, scale: 1, ghosts: 3 };
const THROW_SPRAY = { speed: 150, life: 0.22, size: 0.34, additive: true };
/** Which way the throw goes. Flipped per throw; deterministic. */
let saucerSwing = 1;

/**
 * THE CATCH.
 *
 * A boomerang that simply stops existing has no RETURN in it — the saucer went
 * out, came back, and then the frame it arrived was the frame it was gone, so
 * the second pass read as a projectile that happened to fly through twice. It
 * has an ending now: `onExpire` fires where the flight actually finished, which
 * for a boomerang is her hands, and the little clatter there is what tells the
 * player these things come back to somebody.
 *
 * A saucer that pierced its way out of existence never reaches this — the pool
 * releases it without expiring it — which is exactly right. That one broke.
 */
const CATCH_FX = { tier: 0, life: 0.2, size: 13 };
const CATCH_PUFF = { speed: 70, life: 0.26, size: 0.3, drag: 7, additive: true };
function catchSaucer(proj) {
  H.effects.impact(proj.x, proj.y, C_PORCELAIN, CATCH_FX);
  H.particles.burst(proj.x, proj.y, 3, C_PORCELAIN, CATCH_PUFF);
}
SAUCER.onExpire = catchSaucer;

/** Every 4th throw is the whole tray, at her own feet, at her own expense. */
const FUMBLE_EVERY = 4;
const FUMBLE_DAMAGE = 45;
const FUMBLE_RADIUS = 90;
// The cost is a SHARE OF MAX HP with a floor she is never charged below, not a
// flat 3. A flat cost every 3.6s is 0.83 HP/s against a 138 pool with no regen:
// the balance sweep had her pinned at 1 HP from minute three and dead by four,
// bottom of a 24-character board as a six-star. "Never lethal" was true only in
// the narrow sense that the subtraction stopped at 1 — parking a character at 1
// HP forever is a death sentence with extra steps.
//
// The fumble is meant to be a CONVERSION, not attrition: `live_and_unedited`
// turns every mishap into a permanent damage stack. So it stays expensive while
// she is healthy and costs nothing once she is not.
const FUMBLE_HP_COST = 0.02;          // of max HP
const FUMBLE_HP_FLOOR = 0.35;         // never charged below this share of max
const FUMBLE_NOVA = {
  src: H.SRC.AUTO, element: 'water', color: C_PORCELAIN,
  falloff: 0.2, particles: 14, knockback: 180, shake: false,
};
/**
 * The tray, arriving AFTER the blast rather than before it.
 *
 * That ordering is the whole gag and it is not a compromise: the plates leave
 * her hands first and shatter on the floor, and the tray — which she let go of
 * a moment later, still trying to catch them — lands on top of the mess a third
 * of a second behind. Dropping the prop before the nova would read as the tray
 * causing the explosion, which is both wrong and much less funny.
 */
const TRAY_DROP = { tier: 0, life: 0.34, from: 130, scale: 1.15, angle: 0.5, spin: 4.2 };
/** Porcelain, going everywhere. `shard` is one of the five pre-baked shapes. */
const SHARD_BURST = { speed: 240, life: 0.5, size: 0.42, drag: 3.4, shape: 'shard' };

/**
 * The tray goes. It is never lethal and — more importantly — it never strands
 * her: three seasons of this and it has still never actually killed her.
 */
function fumbleTray(run, p, opts) {
  H.nova(run, p, p.x, p.y, FUMBLE_RADIUS, H.autoDamage(run, p, FUMBLE_DAMAGE, opts), FUMBLE_NOVA);
  H.particles.burst(p.x, p.y, 12, C_PORCELAIN, SHARD_BURST);
  H.effects.fallSprite(p.x, p.y, SP_TRAY, TRAY_DROP);
  const floor = p.maxHp * FUMBLE_HP_FLOOR;
  if (p.hp > floor) p.hp = Math.max(floor, p.hp - p.maxHp * FUMBLE_HP_COST);
  p.flags.mishaps = (p.flags.mishaps | 0) + 1;
  H.floaters.spawn(p.x, p.y - 44, 'oops', C_TEA, 16, 0.8);
  H.camera.punch(0.02, 0.16);
}

// --- OPERATION: TOTAL DISASTER ---------------------------------------------
const DISASTER_TIME = 4;
const RIG_COUNT = 9;
const RIG_COUNT_S3 = 14;
const RIG_DAMAGE = 110;
const RIG_RADIUS = 130;
const RIG_TELEGRAPH = 0.4;
const TRUSS_DAMAGE = 340;
const TRUSS_RADIUS = 300;
const TRUSS_PULL_RADIUS = 420;
const RIG_AIM = { mode: 'densestCluster', range: 640 };
const RIG_HIT = { falloff: 0.3, element: 'water', knockback: 120 };
const RIG_FX = { tier: 0, life: 0.4, width: 8, from: 10, spokes: 10 };
const RIG_IMPACT = { tier: 0, life: 0.24, size: 22 };
const TRUSS_NOVA = {
  src: H.SRC.SPECIAL, element: 'water', color: C_TEA,
  falloff: 0.15, particles: 34, knockback: 280,
};
const TRUSS_PULL = { param: 260, hitsEnemies: true };

// THE THING THAT WAS MISSING FROM THIS MOVE
// -----------------------------------------
// A telegraph appeared, and then 0.4s later a shockwave appeared, and in
// between them there was NOTHING. The player was being asked to infer a falling
// object from a circle on the floor and a bang. The circle was the shadow of a
// thing that was never drawn.
//
// It is drawn now. The fall is fired on the same frame as the telegraph with a
// life of exactly the fuse, so the section arrives on the frame the scheduler
// fires `dropRig` — one event, drawn once, landing once. `fallSprite` puts a
// shadow under it that tightens all the way in, which matters more than the
// girder does: the player is looking at their own feet, not at the ceiling.
const V_RIG = { shape: 'girder', color: C_RIG, accent: C_RIG_DARK, size: 26, flash: false };
const V_TRUSS = { shape: 'girder', color: C_TEA, accent: C_RIG_DARK, size: 44, flash: false };
const SP_RIG = H.atlas.register(V_RIG);
const SP_TRUSS = H.atlas.register(V_TRUSS);
const RIG_FALL = { tier: 0, life: RIG_TELEGRAPH, from: 340, scale: 1.8, angle: 0, spin: 0.7 };
const RIG_DUST = { speed: 180, life: 0.5, size: 0.4, drag: 4, shape: 'square' };
/**
 * How long before the end the main truss lets go.
 *
 * The truss cannot be spawned by `end()` — a drop that begins when the blast
 * has already happened is a truss falling into its own crater. So the rigging
 * gives way here instead, and the telegraph, the girder and the blast are all
 * pinned to the point it was hanging over, which is where she was standing when
 * it went. She is invulnerable for the whole move and has never once been
 * anywhere else, but if she does walk out from under it, the ring the player
 * was shown is still the ring that lands. A telegraph that lies is worse than
 * no telegraph.
 */
const TRUSS_LEAD = 0.45;
const TRUSS_FALL = { tier: 0, life: TRUSS_LEAD, from: 560, scale: 2.5, angle: 0.2, spin: 0.45 };

/**
 * A fixed ring of drop records. The scheduler swap-and-pops, so callback order
 * is NOT insertion order and a rig cannot be identified by position — it has to
 * carry its own coordinates. Twenty-four slots against a 0.4s fuse and at most
 * four drops a second is four times the headroom it can ever need.
 */
const RIG_SLOTS = 24;
const RIGS = [];
for (let i = 0; i < RIG_SLOTS; i++) RIGS.push({ run: null, x: 0, y: 0, damage: 0, radius: 0 });
let rigSlot = 0;

function dropRig(rec) {
  const run = rec.run;
  if (!run) return;
  H.areaDamage(run, rec.x, rec.y, rec.radius, rec.damage, H.SRC.SPECIAL, RIG_HIT);
  H.effects.shockwave(rec.x, rec.y, rec.radius, C_PORCELAIN, RIG_FX);
  H.effects.impact(rec.x, rec.y, C_TEA, RIG_IMPACT);
  H.particles.ring(rec.x, rec.y, 12, C_PORCELAIN, rec.radius * 2.4);
  // Grey, and square, and thrown outward: the section that just landed came off
  // a ceiling and left a piece of it behind.
  H.particles.burst(rec.x, rec.y, 8, C_RIG, RIG_DUST);
  H.audio.play('explode');
  H.shake.small();
}

// --- Apology Slide ----------------------------------------------------------
const SLIDE_DIST = 240;
const SLIDE_DAMAGE = 40;
const SLIDE_CUT = {
  damage: 0, width: 52, src: H.SRC.ESCAPE, element: 'water',
  color: C_PORCELAIN, knockback: 300,
};
const BOW_RADIUS = 200;
const BOW_TAUNT = 2;
const SLICK_RADIUS = 160;
const SLICK_TIME = 5;
const SLICK_OPTS = { param: 0.55 };          // 0.55 speed == "45% slower"
const SLIDE_AWAY = { mode: 'densestCluster', range: 560 };
const BOW_FX = { tier: 0, life: 0.42, width: 6, from: 20, spokes: 14 };

/**
 * THE SKID.
 *
 * `dash` leaves a ghost chain already, but it leaves an UPRIGHT one, because
 * every other escape in the game is a person moving fast while standing up.
 * This one is a person on her face. A second chain rides under the first,
 * smaller and offset a few pixels down the screen so it sits below her feet,
 * and it is brightest in the MIDDLE of the path rather than at the end — a
 * slide is fastest where it started and she is already stopping by the time she
 * arrives, which is the opposite of the curve a dash wants.
 */
const SKID_GHOSTS = 6;
const SKID_SIZE = 9;
const SKID_DROP = 8;
const SKID_FX = { tier: 0, life: 0.44, alpha: 0.5 };
/** Floor wax off the leading edge, thrown forward the way she is going. */
const SKID_SPRAY = { speed: 210, life: 0.34, size: 0.36, additive: true };

/**
 * THE BOW, one beat after the slide stops.
 *
 * The taunt lands the instant the slide does — that is gameplay and it is not
 * moving — but the POSE cannot be simultaneous with the thing it is a reaction
 * to. A bow drawn on the same frame as the skid is not a bow, it is a smear. A
 * fifth of a second later it is a separate beat: she has come to rest, realised
 * what she has done, and folded in half about it.
 *
 * Four slots because the ring costs nothing; the escape's own 6s cooldown means
 * one would do.
 */
const BOW_DELAY = 0.18;
const BOW_SLOTS = 4;
const BOWS = [];
for (let i = 0; i < BOW_SLOTS; i++) BOWS.push({ x: 0, y: 0, a: 0, n: 0 });
let bowSlot = 0;
const BOW_DIP = { tier: 0, life: 0.5, alpha: 0.95 };
const BOW_POP = { tier: 0, life: 0.26, size: 15 };

function takeABow(rec) {
  // Folded over: a smaller silhouette than the one that arrived, tipped forward
  // past the direction she was travelling in.
  H.effects.afterimage(rec.x, rec.y, rec.a + 0.9, 11, C_AOI, BOW_DIP);
  H.effects.impact(rec.x, rec.y - 10, C_PORCELAIN, BOW_POP);
  H.particles.ring(rec.x, rec.y, 10, C_AOI, 180);
  if (rec.n > 0) H.floaters.spawn(rec.x, rec.y - 52, 'SORRY!!', C_AOI, 18, 1.0);
}

/**
 * S5's slick is SPILLED TEA and has to look spilled.
 *
 * It was a blue disc, which is every other chill field in the game. It is tea
 * gold now, it has the splatter it landed with, and the tray is lying in the
 * middle of it — the same tray prop the fumble drops, because it is the same
 * accident happening for the same reason. The splats are placed off the run
 * stream deliberately: `fxRng` is the throwaway cosmetic stream and a puddle's
 * shape must never be able to move a seeded replay.
 */
const TEA_SPILL = { tier: 0, life: 0.42, from: 210, scale: 1.1, angle: 1.1, spin: 5.5 };
const TEA_SPLAT = { tier: 0, life: 0.4, size: 20 };
const TEA_SPRAY = { speed: 190, life: 0.6, size: 0.42, drag: 2.6 };
const TEA_SPLATS = 3;

// --- Live and Unedited ------------------------------------------------------
const VIEWER_PER_DAMAGE = 12;
const VIEWERS_PER_STACK = 10;
const VIEWER_STACK_DAMAGE = 0.05;
const VIEWER_MAX_STACKS = 20;
/**
 * THE COUNTER WAS INVISIBLE FOR NINE VIEWERS OUT OF TEN.
 *
 * The passive only ever spoke when a stack landed, so the nine mishaps before
 * it were converted in total silence — the player took a hit, took a hit, took
 * a hit, and then out of nowhere was told about a number they had never seen
 * moving. Now every single viewer says so the moment it arrives, small and
 * dim, and the audience it has bought drifts up off her continuously between
 * times, faster the more of them there are. The stack is still the loud moment;
 * it is just no longer the only one.
 */
const VIEWER_MOTE = { life: 1.3, size: 0.34, sizeEnd: 0.06, speed: 14, grav: -26, alpha: 0.75 };
const VIEWER_MOTE_GAP = 0.55;
const VIEWER_MOTE_STEP = 0.02;
const VIEWER_MOTE_FLOOR = 0.14;
const VIEWER_RADIUS = 90;
const VIEWER_POP = { tier: 0, life: 0.34, width: 4, spokes: 12 };

/** One viewer, or several at once, the moment they land. */
function showViewers(p, n) {
  H.floaters.spawn(p.x + H.fxRng.signed() * 16, p.y - 26, '+' + n, C_AOI, 12, 0.55);
  H.particles.drift(p.x + H.fxRng.signed() * 14, p.y - 6, C_AOI, VIEWER_MOTE);
}

/** Idempotent on both counters: viewers only ever move forward. */
function countViewers(run, p, ctx) {
  const taken = run.stats.damageTaken;
  const gained = ((taken - ctx.seenDamage) / VIEWER_PER_DAMAGE) | 0;
  if (gained > 0) {
    ctx.seenDamage += gained * VIEWER_PER_DAMAGE;
    ctx.viewers += gained;
    showViewers(p, gained);
  }
  const m = p.flags.mishaps | 0;
  if (m > ctx.seenMishaps) {
    showViewers(p, m - ctx.seenMishaps);
    ctx.viewers += m - ctx.seenMishaps;
    ctx.seenMishaps = m;
  }

  const want = Math.min(VIEWER_MAX_STACKS, (ctx.viewers / VIEWERS_PER_STACK) | 0);
  if (want <= ctx.stacks) return;
  ctx.stacks = want;
  ctx.mods.damageMult = want * VIEWER_STACK_DAMAGE;
  p.recompute();
  H.effects.burstRing(p.x, p.y, H.area(p, VIEWER_RADIUS), C_AOI, VIEWER_POP);
  H.floaters.spawn(p.x, p.y - 50, ctx.viewers + ' VIEWERS', C_AOI, 18, 1.1);
  H.audio.play('pickup');
}

// ===========================================================================
//                 MIREL — spirit, rarity 6, "She Who Counts In Centuries"
// ===========================================================================

// --- Ordinary Offensive Magic -----------------------------------------------
const V_BOLT = { shape: 'shard', color: C_PLAIN, accent: '#8fa2c9', size: 8, rotates: true, glow: true };
const V_BOLT_SILENT = { shape: 'shard', color: '#ffffff', accent: C_GOLD, size: 13, rotates: true, glow: true };
const BOLT = {
  damage: 0, speed: 820, life: 1.1, radius: 8, pierce: 2,
  motion: H.MOTION.STRAIGHT, element: 'spirit',
  visual: V_BOLT, trailColor: '#dfe8ff', tag: 'plain_bolt',
};
const SILENT_EVERY = 8;
const SILENT_MULT = 3;
const BOLT_FX = { speed: 240, life: 0.14, size: 0.4 };

// --- THE COLLECTION ---------------------------------------------------------
//
// FIVE SPELLS THAT WERE ALL THE SAME SPELL
// ----------------------------------------
// The book opened, and out came a nova, a heal, two debuff sweeps and a
// floater — five entries that differed only in which number moved. Nothing they
// did was a THING; nothing was left on the floor afterwards; the field of
// flowers, which is the most famous piece of ordinary magic anybody in this
// world has ever collected, was eight hit points and five green sparks.
//
// The premise of the whole character is that she picked up magic nobody thought
// was worth writing down, and that the reason she is the most dangerous person
// in any room is that she actually kept it. That only lands if the spells are
// REAL. So every one of the five now does the literal thing it is named after
// and the arena remembers it afterwards:
//
//   0  a patch of ground turned to SAND — the ground heaves once, and then it
//      is sand for twelve seconds and nothing standing on it has any footing
//   1  a FIELD OF FLOWERS — an actual meadow, for an actual minute, and she
//      heals the entire time she is standing in it. The headline. See below.
//   2  a spell that REMOVES RUST — it comes off, and it lands, and the corrosion
//      keeps working on whatever walks through the pile
//   3  a spell that POLISHES ARMOUR — the only one that leaves nothing on the
//      floor, because what it leaves is on THEM: plate buffed down to a shine
//      that stops being armour and starts being a bright, obvious target
//   4  a spell that makes GRAPES SWEETER — still, correctly, useless. It also
//      still works: the ground it lands on is now the nicest thing for a
//      hundred pixels and everything in the area wanders over to have a look
//
// `runRng` picks — never fxRng and never Math.random — so a seeded run replays
// the exact same book in the exact same order.
const COLLECTION_TIME = 10;
const COLLECTION_TIME_S3 = 15;
const COLLECTION_CADENCE = 0.5;
const SPELL_REACH = 520;
const COLLECTION_AIM = { mode: 'densestCluster', range: SPELL_REACH };
const SPELL_FX = { tier: 0, life: 0.3, size: 18 };
/** Spell 4 is the one that makes grapes sweeter. S3 removes it from the book. */
const SPELL_COUNT = 5;
const SPELL_USELESS = 4;

// --- spell 0: a patch of ground turned to sand ------------------------------
/** Pale, dry and not remotely gold — the ground it used to be is gone. */
const C_SAND = '#d8d2c4';
const SPELL_SAND_DAMAGE = 65;
const SPELL_SAND_RADIUS = 110;
/** The patch is WIDER than the blast: the damage is the ground going, not the sand. */
const SAND_PATCH_RADIUS = 150;
const SAND_PATCH_TIME = 12;
const SAND_SLIP = { param: 0.62 };            // 0.62 speed == "38% slower"
const SAND_NOVA = {
  src: H.SRC.SPECIAL, element: 'spirit', color: C_GOLD,
  falloff: 0.25, particles: 16, shake: false,
};
/** Square grains, thrown low and dragging hard. Sand does not float. */
const SAND_GRAINS = { speed: 150, life: 0.7, size: 0.34, drag: 3.2, shape: 'square' };

// --- spell 2: a spell that removes rust -------------------------------------
const C_RUST_DUST = '#c96a4a';
const RUST_RADIUS = 120;
const RUST_TIME = 10;
const RUST_DPS = 16;
const RUST_BLEED = 0.02;                      // 2% max HP per second
const RUST_BLEED_TIME = 4;
const RUST_FLAKES = { speed: 130, life: 0.8, size: 0.3, drag: 3, shape: 'shard' };

// --- spell 3: a spell that polishes armour ----------------------------------
// The one entry in the book whose leave-behind is not on the ground. Armour
// polished to a mirror is thinner armour AND a brighter target, and both halves
// outlive the cast by twelve seconds — long enough that the player can see the
// spell was worth rolling even when it lands on an empty patch of floor.
const POLISH_SHRED = 3;
const POLISH_TIME = 12;
const POLISH_VULN = 1.18;
/** Effects are a 160-slot pool. A crowd of thirty must not spend it on sparkle. */
const POLISH_GLINTS = 6;
const POLISH_GLINT = { tier: 0, life: 0.26, size: 11 };
const POLISH_FX = { tier: 0, life: 0.4, width: 4, spokes: 14 };

// --- spell 4: a spell that makes grapes sweeter -----------------------------
// It is not a combat spell, it has never been a combat spell, and making it one
// would be throwing the joke away. What it is instead is TRUE: the fruit on
// that patch of ground is now better than the fruit anywhere else, and things
// go and stand where the good fruit is. No damage, no debuff, no buff. A weak
// pull, a small circle, five seconds, and every other page in the book aimed at
// the same place.
const C_GRAPE = '#a86bff';
const GRAPE_RADIUS = 110;
const GRAPE_TIME = 5;
const GRAPE_PULL = { param: 80 };
const GRAPE_DROP = { speed: 90, life: 0.9, size: 0.36, drag: 4.5 };

// --- spell 1: THE FIELD OF FLOWERS ------------------------------------------
//
// A MINUTE OF GROUND THAT IS ACTUALLY THERE
// -----------------------------------------
// This had to be a real gameplay object and not a flourish, so it is one: a
// `heal` field out of hazards.js, hers alone (`hitsEnemies: false` — the meadow
// is not a weapon), running the full minute and paying out every quarter of a
// second she is standing inside it.
//
// The problem with that on its own is that hazards.js draws a field as a
// translucent disc with a stroke round it, and a translucent disc is what every
// burning floor, chill slick and pull well in the game already looks like. A
// meadow that reads as "a green version of the fire" is not a meadow.
//
// So the patch is FOUR MORE FIELDS, with no gameplay on them at all — they hit
// nobody, they carry no dps, and they exist purely because four discs straddling
// the rim break the circle into a lumpy, overgrown edge with a denser middle,
// which is what a patch of anything growing actually looks like from above.
// They are placed at FIXED angles, not rolled: a meadow that is a different
// shape on a replay of the same seed is a meadow that consumed the run stream
// to be pretty. The fields' own ambient motes then rise out of all five for the
// whole minute for free, which is most of the shimmer.
//
// On top of that a scheduled pulse keeps SEEDING it: three flower heads and
// three blades of grass every 0.7s, scattered across the patch off the cosmetic
// stream, each living a couple of seconds. Steady state is a dozen-odd flowers
// standing in the grass at any moment, in four colours, never in the same place
// twice. Nothing here is alive for a minute — 800 particles is the whole game's
// budget — but the MEADOW is, and that is the part the player is standing in.
//
// The pulse re-arms itself through `run.scheduler`, which swap-and-pops before
// firing (so a callback may safely schedule the next one) and is cleared with
// the run (so a meadow can never outlive the arena it grew in).
const MEADOW_TIME = 60;
const MEADOW_RADIUS = 150;
const MEADOW_HEAL_DPS = 3;
const MEADOW_HEAL_OPTS = { hitsPlayer: true, hitsEnemies: false, fx: false };
const MEADOW_DECOR_OPTS = { hitsPlayer: false, hitsEnemies: false, fx: false };
/**
 * The fringe: angle, distance from centre and radius, all as fractions of the
 * meadow's own radius. They sit ON the rim rather than inside it, so each one
 * is a bite out of the silhouette rather than a second disc stacked on the
 * first — hazards.js composites field alpha, and five concentric discs is a
 * solid green coin.
 */
const MEADOW_LOBES = [
  { a: 0.42, d: 0.92, r: 0.40 },
  { a: 1.98, d: 1.00, r: 0.34 },
  { a: 3.35, d: 0.88, r: 0.42 },
  { a: 4.90, d: 0.97, r: 0.36 },
];
const MEADOW_FX = { tier: 0, life: 0.7, width: 5, from: 24, spokes: 18 };
const MEADOW_BLOOM = 0.7;
const MEADOW_FLOWERS = 3;
const MEADOW_BLADES = 3;
/** Four ordinary flowers. Every one of these is already in the atlas palette. */
const FLOWER_COLORS = [C_PLAIN, '#ff8fc7', C_GOLD, '#c9a6ff'];
/**
 * A flower is a thing standing in a field, not a spark: zero velocity, zero
 * drag, zero gravity, and it barely shrinks over a two-second life. Drawn
 * source-over rather than additive for the same reason the props are — a petal
 * lit additively over a dark stage is a smear of light, not a petal.
 */
const FLOWER_HEAD = { color: C_PLAIN, life: 2.4, size: 0.44, sizeEnd: 0.38, drag: 0, grav: 0, alpha: 0.95, shape: 'star' };
const GRASS_BLADE = { color: C_MEADOW, life: 1.9, size: 0.32, sizeEnd: 0.28, drag: 0, grav: 0, alpha: 0.8, shape: 'shard' };

/**
 * A fixed ring of meadow records, one per live patch that is still being seeded.
 * Six is more than the special can plant inside its own duration; a seventh
 * simply takes the oldest slot, whose GROUND carries on to its natural end and
 * whose pulse stops — the flowers stop arriving, the meadow does not vanish.
 */
const MEADOW_SLOTS = 6;
const MEADOWS = [];
for (let i = 0; i < MEADOW_SLOTS; i++) {
  MEADOWS.push({ run: null, gen: 0, x: 0, y: 0, r: 0, left: 0, n: 0 });
}
let meadowSlot = 0;
/** Two centres closer than this share of a radius are the same patch. */
const MEADOW_MERGE = 1.0;

/** Scatter flowers and grass across a patch, uniform over the disc. */
function seedFlowers(rec, flowers, blades) {
  for (let i = 0; i < flowers; i++) {
    // sqrt, or every flower crowds the middle and the rim is bare.
    const a = H.fxRng.angle();
    const d = Math.sqrt(H.fxRng.raw()) * rec.r;
    FLOWER_HEAD.color = FLOWER_COLORS[(rec.n++) & 3];
    H.particles.emit(rec.x + Math.cos(a) * d, rec.y + Math.sin(a) * d, 0, 0, FLOWER_HEAD);
  }
  for (let i = 0; i < blades; i++) {
    const a = H.fxRng.angle();
    const d = Math.sqrt(H.fxRng.raw()) * rec.r;
    H.particles.emit(rec.x + Math.cos(a) * d, rec.y + Math.sin(a) * d, 0, 0, GRASS_BLADE);
  }
}

/**
 * One seeding pulse, re-arming itself until the patch's minute is up.
 *
 * `gen` is the whole safety story. The record is a recycled slot, so a pulse
 * still in the scheduler when its slot is handed to a NEWER meadow would
 * otherwise carry on seeding — at the new coordinates, on the new clock,
 * doubling that patch's flower rate forever. Comparing the generation it was
 * armed with against the one the slot carries now is what makes a superseded
 * pulse return instead.
 */
function bloomMeadow(rec, gen) {
  const run = rec.run;
  if (!run || rec.gen !== gen) return;
  rec.left -= MEADOW_BLOOM;
  seedFlowers(rec, MEADOW_FLOWERS, MEADOW_BLADES);
  if (rec.left > 0) run.scheduler.after(MEADOW_BLOOM, bloomMeadow, rec, gen);
  else rec.run = null;
}

/** A patch of hers still growing at this point, or null. */
function meadowAt(run, x, y, r) {
  const merge = r * MEADOW_MERGE;
  for (let i = 0; i < MEADOW_SLOTS; i++) {
    const m = MEADOWS[i];
    if (m.run !== run || m.left <= 0) continue;
    const dx = m.x - x, dy = m.y - y;
    if (dx * dx + dy * dy <= merge * merge) return m;
  }
  return null;
}

/**
 * Put a meadow on the ground. Shared by the spell and by her signature relic,
 * because they are the same spell and must not be two different meadows.
 *
 * GROUND THAT IS ALREADY A MEADOW DOES NOT BECOME MORE OF A MEADOW.
 * ----------------------------------------------------------------
 * The special rolls this page four or five times inside one casting and she is
 * very often standing where she was standing a second ago, so the first version
 * of this laid four heal fields on top of each other: hazards.js pays every
 * overlapping field out separately, which measured at TWELVE HP a second — a
 * 130 HP character back to full in eleven seconds, on a minute-long floor, from
 * a spell whose whole joke is that it is not for combat. It was not a tuning
 * problem, it was the same patch counted four times.
 *
 * So a cast that lands on a patch that is already blooming re-seeds it and
 * stops. Not a refresh, not a stack, not a bigger circle — the flowers come up
 * again and that is all, because there is nothing else casting it a second time
 * would honestly do. `radius` is the BASE radius throughout; `H.field` applies
 * the player's area scaling to all five fields and the record stores the scaled
 * result, so the flowers land inside the patch that actually exists rather than
 * inside the one it would have been at areaMult 1.
 */
function plantMeadow(run, p, x, y, radius, duration, healDps) {
  const r = H.area(p, radius);
  const live = meadowAt(run, x, y, r);
  if (live) {
    seedFlowers(live, MEADOW_FLOWERS * 2, MEADOW_BLADES * 2);
    H.effects.shockwave(x, y, r * 0.9, C_MEADOW, MEADOW_FX);
    return;
  }

  H.field(run, p, x, y, radius, duration, 'heal', healDps, C_MEADOW, MEADOW_HEAL_OPTS);
  for (let i = 0; i < MEADOW_LOBES.length; i++) {
    const L = MEADOW_LOBES[i];
    H.field(run, p, x + Math.cos(L.a) * r * L.d, y + Math.sin(L.a) * r * L.d,
            radius * L.r, duration, 'heal', 0, C_MEADOW, MEADOW_DECOR_OPTS);
  }
  H.effects.shockwave(x, y, r * 1.25, C_MEADOW, MEADOW_FX);

  const rec = MEADOWS[meadowSlot];
  meadowSlot = (meadowSlot + 1) % MEADOW_SLOTS;
  rec.run = run;
  rec.gen++;
  rec.x = x; rec.y = y;
  rec.r = r * 1.15;                 // out to the far edge of the fringe lobes
  rec.left = duration;
  rec.n = 0;
  // Seed it on the frame it is planted. The pulse arms the next one itself.
  bloomMeadow(rec, rec.gen);
}

// --- Mana Suppression -------------------------------------------------------
const SUPPRESS_SPEED = 1.30;
const SUPPRESS_RADIUS = 320;
const SUPPRESS_STUN = 1.2;
const SUPPRESS_FX = { speed: 60, life: 0.4, size: 0.7, sizeEnd: 0.08, additive: true };
const SUPPRESS_REFUND = 0.5;                  // S5

// --- A Long Time To Practise ------------------------------------------------
const PRACTICE_PER_STACK = 80;                // casts
const PRACTICE_BONUS = 0.05;                  // +5% auto damage, uncapped

// ===========================================================================
//                YUKINE — light, rarity 5, "The Chief Executive Fox"
// ===========================================================================

// --- Three-Tail Flourish ----------------------------------------------------
const FLOURISH_RADIUS = 170;
const FLOURISH_LINES = 3;
const FLOURISH_LINE_LENGTH = 420;
const FLOURISH_LINE_DAMAGE = 14;
const FLOURISH_RING = { falloff: 0, element: 'light', knockback: 70 };
const FLOURISH_LINE = { element: 'light', knockback: 30 };
const FLOURISH_BURST = { tier: 0, life: 0.34, width: 5, spokes: 14 };
const FLOURISH_BEAM = { tier: 0, life: 0.2 };

// --- TERMS AND CONDITIONS ---------------------------------------------------
const CONTRACT_TIME = 10;
const CONTRACT_TIME_S3 = 14;
const CONTRACT_RADIUS = 320;
const CONTRACT_VULN = 1.40;
const CONTRACT_VULN_S3 = 1.55;
const CONTRACT_PAY = 0.6;
const CONTRACT_PAY_S3 = 1.2;
const CONTRACT_TICK = 0.5;
const CONTRACT_FX = { tier: 0, life: 0.5, width: 6, from: 40, spokes: 16 };

// --- Tail Swap --------------------------------------------------------------
const V_TAIL = { shape: 'crescent', color: C_FOXFIRE, accent: C_ICE, size: 16, glow: true };
const TAIL_DIST = 220;
const TAIL_LIFE = 3;
const TAIL_BURN_DPS = 18;
const TAIL_BURN_RADIUS = 110;
const TAIL_POP_DAMAGE = 70;
const TAIL_POP_RADIUS = 140;
const TAIL_POP_DAMAGE_S5 = 120;
const TAIL_POP_RADIUS_S5 = 200;
const TAIL_PROP = {
  role: H.MINION_ROLE.DECOY, hp: 9999, damage: 0, life: TAIL_LIFE,
  tag: 'fox_tail', visual: V_TAIL, isMinion: false, onExpire: null,
};
const TAIL_HIT = { falloff: 0.2, element: 'light', knockback: 200 };
const TAIL_AWAY = { mode: 'densestCluster', range: 560 };

/**
 * The tail bursts when it expires. The damage rides on the prop's own `damage`
 * field, which `cast()` set, so this callback needs no state of its own.
 */
function tailBurst(m, run) {
  const p = run.player;
  const r = H.area(p, m.orbitRadius || TAIL_POP_RADIUS);
  H.areaDamage(run, m.x, m.y, r, m.damage, H.SRC.ESCAPE, TAIL_HIT);
  H.effects.burstRing(m.x, m.y, r, C_FOXFIRE, FLOURISH_BURST);
  H.particles.ring(m.x, m.y, 16, C_ICE, r * 2.6);
  H.audio.play('explode');
}
TAIL_PROP.onExpire = tailBurst;

// --- Three Streams ----------------------------------------------------------
const TAIL_LIGHT_EVERY = 15;
const TAIL_MAX = 3;
const TAIL_ATTACK_SPEED = 0.08;
const TAIL_AREA = 0.08;
const TAIL_CLOAK_DPS = 6;
const TAIL_CLOAK_RADIUS = 90;
const TAIL_SNUFF_FRACTION = 0.20;             // one hit worth 20% max HP
const STREAM_DRIFT = { life: 0.5, size: 0.4, speed: 22 };

/** Re-derive the tail buff from the count. Never a subtract — always a rebuild. */
function applyTailBuff(p, ctx) {
  ctx.mods.attackSpeedMult = ctx.tails * TAIL_ATTACK_SPEED;
  ctx.mods.areaMult = ctx.tails * TAIL_AREA;
  p.recompute();
}

// ===========================================================================
//                  WREN — lightning, rarity 5, "The Diligent Apprentice"
// ===========================================================================

// --- Flawless Repetition ----------------------------------------------------
//
// SHE WAS FINISHED ON THE DAY SHE ARRIVED, WHICH IS NOT WHAT AN APPRENTICE IS
// ----------------------------------------------------------------------------
// The first version handed her two homing bolts, a 620px search and a streak
// that climbed to six on kills — all of it available on the opening volley of a
// fresh run at one star with nothing levelled. Two bolts became six inside the
// first minute, every one of them multiplied again by Extra Shot, and the
// player who reported it was right: at level one she was already doing the
// thing she is supposed to spend a run earning. A ★5 precision caster whose
// level-one attack is her level-forty attack has no progression in it at all;
// she just has a good attack, and then keeps it.
//
// So the drill is a drill again. She fires ONE bolt, she throws it about as far
// as a room is wide, and everything past that is bought:
//
//   HOW MANY   the streak still climbs one per volley that killed something and
//              still collapses to one the instant a volley does not — that is
//              the character and it is untouched. What changed is the CEILING it
//              climbs to, which is her star level and nothing else: 2 at ★1 and
//              ★2, then 3, 4 and 5. On top of that `spread` adds Extra Shot and
//              the signature's own extra projectiles to every bolt, exactly as
//              it does for every other shooter in the game.
//   HOW FAR    a flat base, plus a step per star, plus a step for every extra
//              projectile she has earned — and then multiplied by `area`, which
//              for the auto-attack pipeline folds in Wide Reach AND the
//              signature weapon's own per-level number. That last one is the
//              only SMOOTH per-level lever the weapon system publishes (`count`
//              moves twice in eight levels; `area` moves every level), and for a
//              caster whose entire attack is its reach, "how big is what she
//              does" and "how far away is she willing to do it" are the same
//              question. Long Haul then extends it again, because its card
//              promises range and this is range.
//
// The bolt's LIFE is derived from the reach rather than fixed, so the search and
// the flight always agree. A 620px bolt behind a 240px search was the old shape
// and it reads as a bug: she declines to shoot at something, and then the thing
// she did shoot at sails a screen past it.
const V_WREN_BOLT = { shape: 'diamond', color: C_LILAC, accent: '#2a2436', size: 8, rotates: true, glow: true };
/** A volley that killed nothing. Also the very first volley of every run. */
const REPEAT_BASE = 1;
/**
 * How far the streak may climb, indexed by star level. Slot 0 is unreachable
 * and holds a zero deliberately: `[star] || [1]` then covers a ctx with no star
 * on it — a mirrored cast, a test harness — without a separate guard.
 */
const REPEAT_CEIL_BY_STAR = [0, 2, 2, 3, 4, 5];
const REPEAT_SPEED = 620;
const REPEAT_RANGE = 280;
const REPEAT_RANGE_PER_STAR = 40;
const REPEAT_RANGE_PER_SHOT = 60;
/**
 * The ceiling on the search, which is targeting.js's own DEFAULT_RANGE — the
 * distance this game already treats as "as far as anybody aims". A fully
 * levelled signature with four Extra Shots and eight Long Hauls asks for well
 * past three thousand pixels, which is not reach, it is a bolt fired at nothing.
 */
const REPEAT_RANGE_CAP = 900;
/** Seconds of flight over and above the reach — homing bolts need to curve. */
const REPEAT_SLACK = 0.3;
const REPEAT_BOLT = {
  damage: 0, speed: REPEAT_SPEED, life: 1, radius: 8, pierce: 1,
  motion: H.MOTION.HOMING, turnRate: 8, target: null,
  element: 'lightning', visual: V_WREN_BOLT, trailColor: '#e6d8ff',
  tag: 'repeat_bolt', onHit: null,
};
/** Set by the volley, read by the on-hit: did anything actually die? */
let repeatKilled = false;
function noteRepeatKill(proj, e) { if (e.hp <= 0 || e.dying) repeatKilled = true; }
REPEAT_BOLT.onHit = noteRepeatKill;
const REPEAT_AIM = { mode: 'nearestN', count: 1, range: REPEAT_RANGE };

// --- PERFECT MARKS ----------------------------------------------------------
const MARKS_TIME = 5;
const MARKS_TIME_S3 = 8;
const MARKS_RATE = 6;                          // bolts per second
const MARKS_DAMAGE = 22;
const MARKS_PIERCE = 2;
const MARKS_PIERCE_S3 = 4;
const MARKS_SPREAD = 8;                        // cycle through the 8 nearest
const MARKS_AIM = { mode: 'nearestN', count: MARKS_SPREAD, range: 700 };
const MARKS_BOLT = {
  damage: 0, speed: 900, life: 1.0, radius: 7, pierce: MARKS_PIERCE,
  motion: H.MOTION.HOMING, turnRate: 11, target: null,
  element: 'lightning', visual: V_WREN_BOLT, trailColor: '#efe4ff',
  tag: 'perfect_bolt',
};

// --- Textbook Form ----------------------------------------------------------
const FORM_DIST = 170;
const FORM_SHARDS = 8;
const FORM_SHARD_DAMAGE = 30;
const FORM_SHARD_RADIUS = 210;
const V_SHARD = { shape: 'triangle', color: C_CHALK, accent: C_LILAC, size: 9, rotates: true };
const FORM_SHARD = {
  damage: 0, speed: 560, life: 0.55, radius: 9, pierce: 1,
  motion: H.MOTION.STRAIGHT, element: 'lightning',
  visual: V_SHARD, trailColor: C_LILAC, tag: 'form_shard',
  // A 360° ring grows by adding SPOKES, not by fanning each spoke — see the
  // `fixedCount` note on H.spread. The cast below grows the count itself.
  fixedCount: true,
};
const FORM_STEP = { color: C_LILAC, src: H.SRC.ESCAPE };
const FORM_AWAY = { mode: 'densestCluster', range: 540 };
const FORM_SHIELD_HITS = 2;                    // S5
const FORM_FX = { tier: 0, life: 0.34, width: 5, from: 14, spokes: 8 };

// --- Mana Discipline --------------------------------------------------------
const FORM_STACK_TIME = 5;
const FORM_MAX_STACKS = 6;
const FORM_STACK_SPEED = 0.06;
const FORM_STACK_DAMAGE = 0.04;

function applyFormBuff(p, ctx) {
  ctx.mods.attackSpeedMult = ctx.stacks * FORM_STACK_SPEED;
  ctx.mods.damageMult = ctx.stacks * FORM_STACK_DAMAGE;
  p.recompute();
}

// ===========================================================================
//                 BRANT — steel, rarity 5, "The Coward Who Never Runs"
// ===========================================================================

// --- Two-Handed Swing -------------------------------------------------------
const CHOP_ARC = 2.0944;                       // 120 degrees
const CHOP_REACH = 130;
const CHOP_CROWD = 3;                          // 3+ inside the arc and he commits
const CHOP_CROWD_BONUS = 1.25;
const CHOP = {
  element: 'steel', knockback: 260, color: C_STEEL, color2: C_RUST,
  src: H.SRC.AUTO, onHit: null,
};
function countChopHit() { S.n++; }
CHOP.onHit = countChopHit;

// --- HOLD THE LINE ----------------------------------------------------------
const LINE_TIME = 6;
const LINE_TIME_S3 = 9;
const LINE_RADIUS = 300;
const LINE_REDUCTION = 0.40;                   // "takes 60% less damage"
const LINE_TAUNT = 1.0;
const LINE_TAUNT_TICK = 0.5;
const LINE_BASE_DAMAGE = 250;
const LINE_RETURN = 3;
const LINE_RETURN_S3 = 4;
const LINE_SWING_ARC = 2.6179939;              // 150 degrees
const LINE_SWING_REACH = 260;
const LINE_SWING = { element: 'steel', knockback: 520, color: C_RUST, src: H.SRC.SPECIAL };

// --- Flinch -----------------------------------------------------------------
const FLINCH_DIST = 170;
const FLINCH_DAMAGE = 60;
const FLINCH_RADIUS = 140;
const FLINCH_DAMAGE_S5 = 110;
const FLINCH_RADIUS_S5 = 200;
const FLINCH_NOVA = {
  src: H.SRC.ESCAPE, element: 'steel', color: C_STEEL,
  falloff: 0.25, particles: 18, knockback: 240,
};
const FLINCH_STEP = { color: C_RUST, src: H.SRC.ESCAPE };
const FLINCH_AWAY = { mode: 'nearest', range: 420 };

// --- Braver Than He Looks ---------------------------------------------------
const BRAVE_MAX_BONUS = 0.50;
const SCREAM_THRESHOLD = 0.30;
const SCREAM_REARM = 0.36;
const SCREAM_RADIUS = 240;
const SCREAM_FORCE = 400;
const SCREAM_SLOW_TIME = 2;
const SCREAM_COOLDOWN = 15;
const SCREAM_FX = { tier: 0, life: 0.5, width: 7, from: 24, spokes: 18 };

// ===========================================================================

registerAll({

  // ---- AOI ----------------------------------------------------------------

  flying_saucers: {
    // "3 saucers thrown in a boomerang arc that hit on the way out AND on the
    //  way back, 16 damage a pass, pierce 2, every 0.9s. Every 4th throw she
    //  fumbles the whole tray instead."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      // Only SHE fumbles. A mirroring clone and the mirror boss both throw
      // properly, which is funnier and keeps the shot index honest.
      if (o === p && ((ctx.shotIndex | 0) % FUMBLE_EVERY) === FUMBLE_EVERY - 1) {
        fumbleTray(run, p, opts);
        return;
      }
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      SAUCER.damage = H.autoDamage(run, p, ctx.def.damage, opts);
      const n = H.spread(run, p, o.x, o.y, t.angle, SAUCER_COUNT, SAUCER_FAN, SAUCER);

      // THE RELEASE, laid over the fan `spread` just fired on. The angles are
      // re-derived from the count it returned rather than assumed, so Extra Shot
      // widening the fan widens the flourish with it — and `shown` caps how many
      // of them get one, because this is a flourish for the THROW and not a
      // decoration on every projectile in it.
      const shown = n < RELEASE_MAX ? n : RELEASE_MAX;
      saucerSwing = -saucerSwing;
      for (let i = 0; i < shown; i++) {
        // Sampled evenly across the REAL fan rather than re-fanned over its own
        // count, so every sweep still lands on a saucer that exists however wide
        // Extra Shot has opened the throw.
        const k = shown > 1 ? Math.round(i * (n - 1) / (shown - 1)) : 0;
        const a = H.fanAngle(k, n, t.angle, SAUCER_FAN);
        SAUCER_RELEASE.sweep = (i & 1) ? -saucerSwing : saucerSwing;
        H.effects.sweepSprite(o.x, o.y, a, RELEASE_ARC, RELEASE_RADIUS, SP_SAUCER, SAUCER_RELEASE);
      }
      // And the tray, still in her hands, following the throw through. It is
      // drawn on every throw for one reason: the fourth one has to be the throw
      // where it is suddenly NOT in her hands, and that only lands if the player
      // has watched her hold on to it three times.
      TRAY_SWING.sweep = saucerSwing;
      H.effects.sweepSprite(o.x, o.y, t.angle, TRAY_ARC, TRAY_RADIUS, SP_TRAY, TRAY_SWING);
      H.particles.cone(o.x, o.y, t.angle, H.fanWidth(n, SAUCER_FAN), 5, C_PORCELAIN, THROW_SPRAY);
      H.audio.play('shoot');
    },
  },

  total_disaster: {
    // "She pulls the wrong cable. The ceiling comes down for 4s: 9 rig sections
    //  land on 0.4s telegraphs for 110 damage in 130px each, then the main
    //  lighting truss lands on HER for 340 damage in a 300px ring. Fully
    //  invulnerable throughout."   S3: 14 sections, and the truss pulls first.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) {
        // The mirror must not hand the player 4s of invulnerability. It drops
        // one truss on them instead, which is both correct and a better fight.
        const o = H.origin(run, p, opts);
        H.hostileDamage(run, opts, o.x, o.y, H.area(p, TRUSS_RADIUS),
                        H.abilityDamage(run, p, TRUSS_DAMAGE, opts));
        H.particles.ring(o.x, o.y, 20, C_TEA, TRUSS_RADIUS * 2.4);
        H.audio.play('explode');
        return;
      }
      ctx.active = true;
      ctx.t = DISASTER_TIME;
      ctx.left = ctx.s3 ? RIG_COUNT_S3 : RIG_COUNT;
      ctx.gap = DISASTER_TIME / ctx.left;
      ctx.next = 0;
      // Where the truss will land, and whether it has let go yet. Seeded to her
      // cast position so that `end()` running early — the run finishing under a
      // live special — still has a real point to put it on.
      ctx.truss = false;
      ctx.trussX = p.x;
      ctx.trussY = p.y;
      H.applyInvuln(p.st, DISASTER_TIME + 0.25);
      H.grade(run, C_PORCELAIN, 0.45, 0.8);
      H.camera.punch(0.07, 0.5);
      H.shake.medium();
      H.announce(run, 'TOTAL DISASTER', C_AOI);
      H.audio.play('telegraph');
    },
    tick(run, p, ctx, dt) {
      // THE TRUSS LETS GO FIRST. Deliberately ahead of the rig-section gate
      // below, which stops running the moment the last section is out — the
      // truss is not one of the sections and must not be gated on them.
      if (!ctx.truss && ctx.t <= TRUSS_LEAD) {
        ctx.truss = true;
        ctx.trussX = p.x;
        ctx.trussY = p.y;
        TRUSS_FALL.life = ctx.t;      // arrives on the frame `end()` fires
        H.effects.fallSprite(ctx.trussX, ctx.trussY, SP_TRUSS, TRUSS_FALL);
        run.hazards.telegraph(ctx.trussX, ctx.trussY, H.area(p, TRUSS_RADIUS),
                              ctx.t, C_TEA, 'circle');
        H.audio.play('telegraph');
      }

      ctx.next -= dt;
      if (ctx.next > 0 || ctx.left <= 0) return;
      ctx.next = ctx.gap;
      ctx.left--;

      const t = H.target(run, p, RIG_AIM);
      const rec = RIGS[rigSlot];
      rigSlot = (rigSlot + 1) % RIG_SLOTS;
      rec.run = run;
      rec.x = t.found ? t.x : p.x + H.fxRng.signed() * 160;
      rec.y = t.found ? t.y : p.y + H.fxRng.signed() * 160;
      rec.radius = H.area(p, RIG_RADIUS);
      rec.damage = H.abilityDamage(run, p, RIG_DAMAGE);
      run.hazards.telegraph(rec.x, rec.y, rec.radius, RIG_TELEGRAPH, C_TEA, 'circle');
      // The section itself, in the air, for the whole length of the fuse. Its
      // angle is stepped off the counter rather than rolled, so nine girders
      // come down at nine different attitudes and a seeded run drops them the
      // same way twice.
      RIG_FALL.angle = ctx.left * 0.7;
      RIG_FALL.spin = (ctx.left & 1) ? -0.7 : 0.7;
      RIG_FALL.scale = rec.radius / RIG_RADIUS * 1.8;
      H.effects.fallSprite(rec.x, rec.y, SP_RIG, RIG_FALL);
      run.scheduler.after(RIG_TELEGRAPH, dropRig, rec);
    },
    end(run, p, ctx) {
      // The main truss. It lands on her, because of course it does — on the
      // point the rigging gave way over, which is where the telegraph has been
      // and where the girder has been falling for the last half second.
      const x = ctx.trussX, y = ctx.trussY;
      if (ctx.s3) {
        H.field(run, p, x, y, TRUSS_PULL_RADIUS, 0.6, 'pull', 0, C_TEA, TRUSS_PULL);
      }
      H.nova(run, p, x, y, TRUSS_RADIUS, H.abilityDamage(run, p, TRUSS_DAMAGE), TRUSS_NOVA);
      H.particles.burst(x, y, 16, C_RIG, RIG_DUST);
      H.grade(run, C_TEA, 0.55, 0.7);
      H.flash.fire('#ffffff', 0.5, 2.2);
      H.camera.punch(0.11, 0.7);
      H.shake.big();
      H.floaters.spawn(p.x, p.y - 60, "I'M SO SORRY", C_TEA, 20, 1.3);
    },
  },

  apology_slide: {
    // "She loses her footing and slides 240px on her face, invulnerable,
    //  ploughing everything on the path 300px aside for 40 damage, and finishes
    //  in a bow so mortified that everything within 200px is taunted onto her
    //  for 2s."   S5: a 160px tea slick, 45% slow, 5s.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) return false;    // there is no dignity here to mirror
      let a = p.facing;
      if (p.movingT <= 0) {
        const t = H.target(run, p, SLIDE_AWAY);
        if (t.found) a = t.angle + Math.PI;
      }
      const dist = SLIDE_DIST * (p.flags.escapeDistanceMult || 1);
      SLIDE_CUT.damage = H.abilityDamage(run, p, SLIDE_DAMAGE) + (p.flags.escapeDamages || 0);
      const d = H.dash(run, p, a, dist, ctx.def.iframes, SLIDE_CUT);

      // THE SKID, along the path `dash` actually took — its clamped endpoints,
      // not the 240px it was asked for, so a slide that ran into the arena wall
      // stops where she stopped.
      for (let i = 0; i <= SKID_GHOSTS; i++) {
        const f = i / SKID_GHOSTS;
        SKID_FX.alpha = 0.22 + 0.5 * (1 - Math.abs(f - 0.5) * 2);
        H.effects.afterimage(H.lerp(d.x0, d.x1, f), H.lerp(d.y0, d.y1, f) + SKID_DROP,
                             a, SKID_SIZE, C_PORCELAIN, SKID_FX);
      }
      H.particles.cone(d.x1, d.y1, a, 0.9, 9, C_PORCELAIN, SKID_SPRAY);

      // The bow. Everything close enough to have watched it is now watching her.
      // The taunt is applied here, on the frame the slide ends; the POSE is a
      // beat behind it and scheduled below.
      const r = H.area(p, BOW_RADIUS);
      S.x = p.x; S.y = p.y; S.t = BOW_TAUNT; S.n = 0;
      H.forEachEnemyIn(run, p.x, p.y, r, tauntToPoint);
      H.effects.shockwave(p.x, p.y, r, C_PORCELAIN, BOW_FX);
      H.particles.ring(p.x, p.y, 14, C_AOI, r * 2.2);
      const bow = BOWS[bowSlot];
      bowSlot = (bowSlot + 1) % BOW_SLOTS;
      bow.x = p.x; bow.y = p.y; bow.a = a; bow.n = S.n;
      run.scheduler.after(BOW_DELAY, takeABow, bow);

      if (ctx.s5) {
        const mx = (d.x0 + d.x1) * 0.5, my = (d.y0 + d.y1) * 0.5;
        H.field(run, p, mx, my, SLICK_RADIUS, SLICK_TIME, 'chill', 0, C_TEA, SLICK_OPTS);
        // Everything she was carrying, arriving after her. The tray lands in the
        // middle of the puddle it made.
        H.effects.fallSprite(mx, my, SP_TRAY, TEA_SPILL);
        const rr = H.area(p, SLICK_RADIUS);
        for (let i = 0; i < TEA_SPLATS; i++) {
          H.effects.impact(mx + H.fxRng.signed() * rr * 0.6,
                           my + H.fxRng.signed() * rr * 0.6, C_TEA, TEA_SPLAT);
        }
        H.particles.burst(mx, my, 14, C_TEA, TEA_SPRAY);
        H.floaters.spawn(p.x, p.y - 34, 'SPILLED TEA', C_TEA, 15, 0.9);
      }
      H.camera.punch(0.03, 0.25);
    },
  },

  live_and_unedited: {
    // "Every fumbled tray and every 12 damage you take adds 1 VIEWER; every 10
    //  viewers is a permanent +5% damage for the rest of the run, up to 20."
    init(run, p, ctx) {
      ctx.viewers = 0;
      ctx.stacks = 0;
      ctx.seenDamage = run.stats.damageTaken;
      ctx.seenMishaps = 0;
      ctx.moteT = 0;
      p.flags.mishaps = 0;
      ctx.mods = { damageMult: 0 };
      p.addBuff('live_and_unedited', FOREVER, ctx.mods);
    },
    tick(run, p, ctx, dt) {
      countViewers(run, p, ctx);
      // The audience she has already earned, drifting up off her between
      // stacks. The gap closes as the stacks climb, so twenty stacks is a
      // visibly busier character than two — with a floor, because this runs for
      // the whole run and an unbounded rate is a particle pool spent on ambience.
      ctx.moteT -= dt;
      if (ctx.moteT > 0 || ctx.viewers <= 0) return;
      const gap = VIEWER_MOTE_GAP - ctx.stacks * VIEWER_MOTE_STEP;
      ctx.moteT = gap > VIEWER_MOTE_FLOOR ? gap : VIEWER_MOTE_FLOOR;
      H.particles.drift(p.x + H.fxRng.signed() * VIEWER_RADIUS * 0.6,
                        p.y + H.fxRng.signed() * 26, C_AOI, VIEWER_MOTE);
    },
    onDamaged(run, p, ctx) { countViewers(run, p, ctx); },
  },

  // ---- MIREL --------------------------------------------------------------

  ordinary_offensive_magic: {
    // "One plain white bolt every 0.5s for 26 damage, pierce 2. Every 8th bolt
    //  she casts without moving her hand: 3x damage, pierces everything."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      const silent = o === p && ((ctx.shotIndex | 0) % SILENT_EVERY) === SILENT_EVERY - 1;
      BOLT.damage = H.autoDamage(run, p, ctx.def.damage, opts) * (silent ? SILENT_MULT : 1);
      BOLT.pierce = silent ? 99 : 2;
      BOLT.radius = silent ? 13 : 8;
      BOLT.visual = silent ? V_BOLT_SILENT : V_BOLT;
      H.spread(run, p, o.x, o.y, t.angle, 1, 0, BOLT);
      if (silent) {
        // No wind-up, no gesture, no noise. Only the light changes.
        H.particles.cone(o.x, o.y, t.angle, 0.2, 5, C_GOLD, BOLT_FX);
        H.camera.punch(0.02, 0.14);
      } else {
        H.audio.play('shoot');
      }
    },
  },

  the_collection: {
    // "She opens the book. For 10s she casts one random spell from the
    //  collection every 0.5s — 20 casts, none of which were ever meant for
    //  combat, and every one of which leaves the arena different afterwards:
    //  a patch of ground turned to sand for 12s, a field of flowers that
    //  blooms for a full minute and heals 3 HP/s while she stands in it, a
    //  spell that takes the rust off and leaves it on the floor still eating
    //  for 10s, a spell that polishes armour down to a shine for 12s, and one
    //  that makes grapes sweeter, which does nothing except make that patch of
    //  ground the nicest thing for a hundred pixels."
    //  S3: 15s, and the spell that does nothing is removed.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) {
        const o = H.origin(run, p, opts);
        H.hostileDamage(run, opts, o.x, o.y, H.area(p, SPELL_SAND_RADIUS * 2),
                        H.abilityDamage(run, p, SPELL_SAND_DAMAGE * 3, opts));
        H.particles.ring(o.x, o.y, 16, C_GOLD, 320);
        H.audio.play('explode');
        return;
      }
      ctx.active = true;
      ctx.t = ctx.s3 ? COLLECTION_TIME_S3 : COLLECTION_TIME;
      ctx.castT = 0;
      ctx.casts = 0;
      p.flags.auraColor = C_GOLD;
      H.grade(run, C_PLAIN, 0.35, 0.7);
      H.announce(run, 'THE COLLECTION', C_GOLD);
      H.camera.punch(0.04, 0.35);
      H.audio.play('telegraph');
    },
    tick(run, p, ctx, dt) {
      ctx.castT -= dt;
      if (ctx.castT > 0) return;
      ctx.castT += COLLECTION_CADENCE;
      ctx.casts++;

      // The book, rolled on the RUN stream so a seeded replay reads the same
      // page in the same order. S3 simply never rolls the useless one.
      const roll = H.runRng.int(0, SPELL_COUNT - 1);
      const spell = (ctx.s3 && roll === SPELL_USELESS) ? 0 : roll;
      const t = H.target(run, p, COLLECTION_AIM);
      const x = t.found ? t.x : p.x;
      const y = t.found ? t.y : p.y;
      const r = H.area(p, SPELL_SAND_RADIUS);

      switch (spell) {
        case 0: {  // a spell that turns a patch of ground to sand
          // The blast is the ground GOING. What is left is what it went to, and
          // it is wider than the crater, because the crater is the moment and
          // the sand is the consequence.
          H.nova(run, p, x, y, SPELL_SAND_RADIUS,
                 H.abilityDamage(run, p, SPELL_SAND_DAMAGE), SAND_NOVA);
          H.field(run, p, x, y, SAND_PATCH_RADIUS, SAND_PATCH_TIME, 'chill', 0,
                  C_SAND, SAND_SLIP);
          H.particles.burst(x, y, 12, C_SAND, SAND_GRAINS);
          break;
        }
        case 1: {  // a spell that grows a field of flowers
          // At her own feet, always — every other page in the book is aimed at
          // the crowd, and this one is the page she stands on.
          plantMeadow(run, p, p.x, p.y, MEADOW_RADIUS, MEADOW_TIME, MEADOW_HEAL_DPS);
          H.floaters.spawn(p.x, p.y - 40, 'A FIELD OF FLOWERS', C_MEADOW, 15, 1.0);
          break;
        }
        case 2: {  // a spell that removes rust
          S.n = 0;
          H.forEachEnemyIn(run, x, y, r, bleedRust);
          // She took it OFF them. It did not stop existing — it is on the floor
          // now, and it is still corrosion, and it is still working.
          H.field(run, p, x, y, RUST_RADIUS, RUST_TIME, 'damage',
                  H.abilityDamage(run, p, RUST_DPS), C_RUST_DUST);
          H.effects.impact(x, y, C_RUST_DUST, SPELL_FX);
          H.particles.burst(x, y, 10, C_RUST_DUST, RUST_FLAKES);
          break;
        }
        case 3: {  // a spell that polishes armour
          S.n = 0;
          H.forEachEnemyIn(run, x, y, r, polishArmour);
          H.effects.burstRing(x, y, r, C_PLAIN, POLISH_FX);
          H.effects.impact(x, y, C_STEEL, SPELL_FX);
          break;
        }
        default: {  // a spell that makes grapes sweeter
          H.field(run, p, x, y, GRAPE_RADIUS, GRAPE_TIME, 'pull', 0, C_GRAPE, GRAPE_PULL);
          H.particles.burst(x, y, 9, C_GRAPE, GRAPE_DROP);
          H.floaters.spawn(x, y - 40, '...grapes', C_GRAPE, 14, 0.8);
          break;
        }
      }
      H.audio.play('shoot');
    },
    end(run, p, ctx) {
      p.flags.auraColor = null;
      H.particles.ring(p.x, p.y, 12, C_GOLD, 240);
      H.floaters.spawn(p.x, p.y - 46, ctx.casts + ' SPELLS', C_GOLD, 17, 1.0);
    },
  },

  mana_suppression: {
    // "She simply stops registering as a mage. 1.4s untargetable and
    //  invulnerable at +30% move speed, and every enemy within 320px that was
    //  tracking her stops dead and looks around for 1.2s."
    //  S5: also refunds 50% of THE COLLECTION's remaining cooldown.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) return false;    // there is no presence here to hide
      ctx.active = true;
      ctx.t = ctx.def.iframes;
      ctx.puffT = 0;
      H.applyInvuln(p.st, ctx.def.iframes);
      H.applyUntargetable(p.st, ctx.def.iframes);
      p.flags.moveSpeedMult = SUPPRESS_SPEED;

      const r = H.area(p, SUPPRESS_RADIUS);
      S.t = SUPPRESS_STUN; S.n = 0;
      H.forEachEnemyIn(run, p.x, p.y, r, stunAndLose);
      H.grade(run, C_PLAIN, 0.28, 0.5);
      H.particles.ring(p.x, p.y, 14, C_PLAIN, r * 1.6);
      H.announce(run, 'MANA SUPPRESSION', C_PLAIN);
      H.audio.play('escape');
      if (S.n > 0) H.floaters.spawn(p.x, p.y - 52, S.n + ' LOST HER', C_PLAIN, 17, 1.0);

      if (ctx.s5) {
        p.special.reduce(p.special.duration * SUPPRESS_REFUND);
        H.floaters.spawn(p.x, p.y - 76, 'NO TIME AT ALL', C_GOLD, 16, 1.0);
      }
    },
    tick(run, p, ctx, dt) {
      ctx.puffT -= dt;
      if (ctx.puffT > 0) return;
      ctx.puffT = 0.1;
      H.particles.burst(p.x, p.y, 2, C_PLAIN, SUPPRESS_FX);
    },
    end(run, p, ctx) {
      p.flags.moveSpeedMult = p.flags.formMoveSpeed || 1;
      H.particles.ring(p.x, p.y, 8, C_PLAIN, 160);
    },
  },

  a_long_time_to_practise: {
    // "Every 80 auto-attack casts this run permanently adds +5% auto-attack
    //  damage, uncapped. She is also immune to knockback and slows."
    init(run, p, ctx) {
      ctx.stacks = 0;
      ctx.baseShots = p.autoShotIndex;
      ctx.mods = { autoDamageMult: 0 };
      p.addBuff('a_long_time_to_practise', FOREVER, ctx.mods);
      p.flags.knockbackImmune = true;
    },
    tick(run, p, ctx) {
      // None of this is new to her: a slow is wiped the frame it lands, and the
      // knockback flag is re-asserted in case a transformation cleared it.
      if (p.st.slowT > 0) { p.st.slowT = 0; p.st.slowMult = 1; }
      if (!p.flags.knockbackImmune) p.flags.knockbackImmune = true;

      const casts = p.autoShotIndex - ctx.baseShots;
      const want = (casts / PRACTICE_PER_STACK) | 0;
      if (want <= ctx.stacks) return;
      ctx.stacks = want;
      ctx.mods.autoDamageMult = want * PRACTICE_BONUS;
      p.recompute();
      H.floaters.spawn(p.x, p.y - 46, 'PRACTICE x' + want, C_GOLD, 17, 1.1);
      H.audio.play('levelUp');
    },
  },

  // ---- YUKINE -------------------------------------------------------------

  three_tail_flourish: {
    // "She spins once. The tail sweeps a 170px ring for 18 damage, then 3 lines
    //  of white foxfire run out along the floor 120° apart, 420px long, for 14
    //  each. Every 0.9s."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      const r = H.area(p, FLOURISH_RADIUS);
      H.areaDamage(run, o.x, o.y, r, H.autoDamage(run, p, ctx.def.damage, opts),
                   H.SRC.AUTO, FLOURISH_RING);
      H.effects.burstRing(o.x, o.y, r, C_FOXFIRE, FLOURISH_BURST);

      // Three lines of floor fire, rotated a little each spin so the pattern
      // never sits still. The step is fixed, so it stays deterministic.
      ctx.spin = ((ctx.spin || 0) + 0.7) % H.TAU;
      const base = (t.found ? t.angle : (o.facing || 0)) + ctx.spin;
      const len = H.projSpeed(p, FLOURISH_LINE_LENGTH);
      const lineDmg = H.autoDamage(run, p, FLOURISH_LINE_DAMAGE, opts);
      // Extra Shot adds LINES. This is an emitter that happens to throw beams
      // rather than bodies, and "one more of the thing you throw" is exactly as
      // meaningful here as it is for a knife — so three lines 120° apart become
      // up to nine, and the step divides by the real count so the pattern stays
      // evenly spread instead of overlapping the first three.
      const lines = FLOURISH_LINES + H.extraShots(p);
      const step = H.TAU / lines;
      for (let i = 0; i < lines; i++) {
        const a = base + i * step;
        const x1 = o.x + Math.cos(a) * len;
        const y1 = o.y + Math.sin(a) * len;
        H.lineDamage(run, o.x, o.y, x1, y1, H.area(p, 15), lineDmg, H.SRC.AUTO, FLOURISH_LINE);
        H.effects.beam(o.x, o.y, x1, y1, 9, C_ICE, FLOURISH_BEAM);
      }
      H.audio.play('slash');
    },
  },

  terms_and_conditions: {
    // "Drops a 320px contract zone for 10s. Everything standing in it signs:
    //  +40% damage taken, and every 0.5s the deal pays her 0.6 HP per
    //  signatory."   S3: 14s at +55%, paying 1.2 HP each.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) {
        const o = H.origin(run, p, opts);
        H.hostileDamage(run, opts, o.x, o.y, H.area(p, CONTRACT_RADIUS),
                        H.abilityDamage(run, p, 90, opts));
        H.particles.ring(o.x, o.y, 18, C_ICE, CONTRACT_RADIUS * 2);
        H.audio.play('explode');
        return;
      }
      ctx.active = true;
      ctx.t = ctx.s3 ? CONTRACT_TIME_S3 : CONTRACT_TIME;
      ctx.vuln = ctx.s3 ? CONTRACT_VULN_S3 : CONTRACT_VULN;
      ctx.pay = ctx.s3 ? CONTRACT_PAY_S3 : CONTRACT_PAY;
      ctx.tickT = 0;
      ctx.signed = 0;
      // The zone is PLACED, not carried: she signs the room and then leaves.
      ctx.zx = p.x; ctx.zy = p.y;
      ctx.zr = H.area(p, CONTRACT_RADIUS);
      H.effects.shockwave(ctx.zx, ctx.zy, ctx.zr, C_FOXFIRE, CONTRACT_FX);
      H.grade(run, C_ICE, 0.35, 0.6);
      H.announce(run, 'TERMS AND CONDITIONS', C_FOXFIRE);
      H.camera.punch(0.05, 0.4);
      H.audio.play('levelUp');
    },
    tick(run, p, ctx, dt) {
      run.ringOverlay(ctx.zx, ctx.zy, ctx.zr, C_ICE);
      ctx.tickT -= dt;
      if (ctx.tickT > 0) return;
      ctx.tickT = CONTRACT_TICK;

      S.mult = ctx.vuln; S.dur = CONTRACT_TICK + 0.35; S.n = 0;
      H.forEachEnemyIn(run, ctx.zx, ctx.zy, ctx.zr, signContract);
      if (S.n <= 0) return;
      ctx.signed += S.n;
      H.healPlayer(run, ctx.pay * S.n);
      H.particles.ring(ctx.zx, ctx.zy, 6, C_FOXFIRE, ctx.zr * 1.4);
    },
    end(run, p, ctx) {
      H.effects.burstRing(ctx.zx, ctx.zy, ctx.zr, C_ICE, FLOURISH_BURST);
      H.floaters.spawn(ctx.zx, ctx.zy - 40, ctx.signed + ' SIGNED', C_FOXFIRE, 18, 1.2);
    },
  },

  tail_swap: {
    // "Blinks 220px and leaves her tail behind. It taunts everything within
    //  260px for 3s and burns everything within 110px for 18 damage/s, then
    //  detonates for 70 damage in a 140px radius."   S5: 2 tails, 120 / 200px.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) return false;    // the boss has no tail to leave
      let a = p.facing;
      if (p.movingT <= 0) {
        const t = H.target(run, p, TAIL_AWAY);
        if (t.found) a = t.angle + Math.PI;
      }
      const x0 = p.x, y0 = p.y;
      const dist = TAIL_DIST * (p.flags.escapeDistanceMult || 1);

      const tails = ctx.s5 ? 2 : 1;
      TAIL_PROP.damage = H.abilityDamage(run, p, ctx.s5 ? TAIL_POP_DAMAGE_S5 : TAIL_POP_DAMAGE);
      // The prop rides its blast radius on `orbitRadius`, which a DECOY does not
      // otherwise use — that is what lets `tailBurst` stay a bare reference.
      TAIL_PROP.orbitRadius = ctx.s5 ? TAIL_POP_RADIUS_S5 : TAIL_POP_RADIUS;
      for (let i = 0; i < tails; i++) {
        const off = tails === 1 ? 0 : (i === 0 ? -34 : 34);
        const tx = x0 + Math.cos(a + Math.PI / 2) * off;
        const ty = y0 + Math.sin(a + Math.PI / 2) * off;
        H.prop(run, p, tx, ty, TAIL_PROP);
        H.field(run, p, tx, ty, TAIL_BURN_RADIUS, TAIL_LIFE, 'burn',
                TAIL_BURN_DPS, C_FOXFIRE);
      }

      H.blink(run, p, x0 + Math.cos(a) * dist, y0 + Math.sin(a) * dist, ctx.def.iframes);
      H.particles.ring(x0, y0, 12, C_ICE, 260);
      H.floaters.spawn(x0, y0 - 40, 'KON!', C_FOXFIRE, 16, 0.8);
    },
  },

  three_streams: {
    // "Every 15s another tail lights, up to 3. Each lit tail is +8% attack
    //  speed, +8% area, and 6 damage/s to everything within 90px. One hit worth
    //  20% of your max HP snuffs one out."
    init(run, p, ctx) {
      ctx.tails = 0;
      ctx.lightT = TAIL_LIGHT_EVERY;
      ctx.cloakT = 0;
      ctx.seenDamage = run.stats.damageTaken;
      ctx.mods = { attackSpeedMult: 0, areaMult: 0 };
      p.addBuff('three_streams', FOREVER, ctx.mods);
    },
    tick(run, p, ctx, dt) {
      // A single big hit costs her a show. Read off the run's cumulative total
      // so the tick poll and the damage callback can never double-count.
      const taken = run.stats.damageTaken;
      const hit = taken - ctx.seenDamage;
      if (hit > 0) {
        ctx.seenDamage = taken;
        if (ctx.tails > 0 && hit >= p.maxHp * TAIL_SNUFF_FRACTION) {
          ctx.tails--;
          applyTailBuff(p, ctx);
          H.floaters.spawn(p.x, p.y - 46, 'TAIL OUT', C_ICE, 17, 1.0);
        }
      }

      if (ctx.tails < TAIL_MAX) {
        ctx.lightT -= dt;
        if (ctx.lightT <= 0) {
          ctx.lightT = TAIL_LIGHT_EVERY;
          ctx.tails++;
          applyTailBuff(p, ctx);
          H.particles.ring(p.x, p.y, 10, C_FOXFIRE, 200);
          H.floaters.spawn(p.x, p.y - 46, 'TAIL ' + ctx.tails, C_FOXFIRE, 17, 1.0);
          H.audio.play('pickup');
        }
      }

      if (ctx.tails <= 0) return;
      ctx.cloakT -= dt;
      if (ctx.cloakT > 0) return;
      ctx.cloakT = 0.25;
      S.dps = TAIL_CLOAK_DPS * ctx.tails; S.dur = 0.6;
      H.forEachEnemyIn(run, p.x, p.y, H.area(p, TAIL_CLOAK_RADIUS), burnNear);
      H.particles.drift(p.x + H.fxRng.signed() * 26, p.y + H.fxRng.signed() * 26,
                        C_FOXFIRE, STREAM_DRIFT);
    },
  },

  // ---- WREN ---------------------------------------------------------------

  flawless_repetition: {
    // "One homing bolt every 0.45s, 12 damage, pierce 1, and at first she will
    //  not throw it further than about 240px. Every volley that kills something
    //  adds a bolt to the next one; a volley that kills nothing drops straight
    //  back to one. Her star level raises that ceiling from 2 bolts to 5, and
    //  every extra projectile she earns pushes the range out with it."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      // Resolve the PREVIOUS volley before firing this one: `repeatKilled` was
      // set by the on-hit callback while those bolts were in the air. The very
      // first volley of a run also CLEARS it, so a kill from the previous run
      // can never hand her a free bolt on the opening shot.
      if (ctx.streak === undefined) { ctx.streak = REPEAT_BASE; repeatKilled = false; }
      const ceiling = REPEAT_CEIL_BY_STAR[ctx.star | 0] || REPEAT_CEIL_BY_STAR[1];
      ctx.streak = repeatKilled ? Math.min(ceiling, ctx.streak + 1) : REPEAT_BASE;
      repeatKilled = false;

      // THE REACH, rebuilt every volley because every term in it can move
      // between two shots — a level-up, a weapon level, an evolution.
      // `H.area` is deliberately inside the auto's scope here, which is the
      // only place the signature weapon's per-level number is readable at all.
      const base = REPEAT_RANGE +
                   ((ctx.star || 1) - 1) * REPEAT_RANGE_PER_STAR +
                   H.extraShots(p) * REPEAT_RANGE_PER_SHOT;
      const reach = Math.min(REPEAT_RANGE_CAP, H.projSpeed(p, H.area(p, base)));
      REPEAT_AIM.range = reach;
      REPEAT_AIM.count = ctx.streak;
      const t = H.target(run, p, REPEAT_AIM, opts);
      if (!t.found) return;
      REPEAT_BOLT.damage = H.autoDamage(run, p, ctx.def.damage, opts);
      // `spread` multiplies this by projectileSpeedMult again, exactly as it
      // does the speed — so a Long Haul bolt outruns the search rather than
      // falling short of it, which is the direction that error has to point.
      REPEAT_BOLT.life = reach / REPEAT_SPEED + REPEAT_SLACK;
      const found = t.targets.length;
      for (let i = 0; i < ctx.streak; i++) {
        const e = i < found ? t.targets[i] : t.target;
        REPEAT_BOLT.target = e;
        const a = e ? H.angleTo(o.x, o.y, e.x, e.y) : t.angle;
        H.spread(run, p, o.x, o.y, a, 1, 0, REPEAT_BOLT);
      }
      REPEAT_BOLT.target = null;
      H.audio.play('shoot');
    },
  },

  perfect_marks: {
    // "For 5s she stops holding back: 6 bolts per second, 22 damage each,
    //  pierce 2, cycling one at a time through the 8 nearest enemies so nothing
    //  is over-killed. 30 bolts, none of them wasted."   S3: 8s, pierce 4.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) {
        const o = H.origin(run, p, opts);
        H.hostileDamage(run, opts, o.x, o.y, 140,
                        H.abilityDamage(run, p, MARKS_DAMAGE * 4, opts));
        H.particles.ring(o.x, o.y, 14, C_LILAC, 300);
        H.audio.play('shoot');
        return;
      }
      ctx.active = true;
      ctx.t = ctx.s3 ? MARKS_TIME_S3 : MARKS_TIME;
      ctx.boltT = 0;
      ctx.fired = 0;
      ctx.cycle = 0;
      p.flags.auraColor = C_LILAC;
      H.grade(run, C_LILAC, 0.32, 0.6);
      H.announce(run, 'PERFECT MARKS', C_LILAC);
      H.camera.punch(0.04, 0.35);
      H.audio.play('telegraph');
    },
    tick(run, p, ctx, dt) {
      ctx.boltT -= dt;
      if (ctx.boltT > 0) return;
      ctx.boltT += 1 / MARKS_RATE;

      const t = H.target(run, p, MARKS_AIM);
      if (!t.found) return;
      const n = t.targets.length || 1;
      const e = t.targets[ctx.cycle % n] || t.target;
      ctx.cycle++;
      ctx.fired++;
      MARKS_BOLT.damage = H.abilityDamage(run, p, MARKS_DAMAGE);
      MARKS_BOLT.pierce = ctx.s3 ? MARKS_PIERCE_S3 : MARKS_PIERCE;
      MARKS_BOLT.target = e;
      const a = e ? H.angleTo(p.x, p.y, e.x, e.y) : t.angle;
      H.spread(run, p, p.x, p.y, a, 1, 0, MARKS_BOLT);
      MARKS_BOLT.target = null;
      H.particles.cone(p.x, p.y, a, 0.2, 2, C_LILAC, BOLT_FX);
      H.audio.play('shoot');
    },
    end(run, p, ctx) {
      p.flags.auraColor = null;
      H.floaters.spawn(p.x, p.y - 46, ctx.fired + ' CASTS', C_LILAC, 17, 1.0);
      H.particles.ring(p.x, p.y, 10, C_LILAC, 200);
    },
  },

  textbook_form: {
    // "0.6s invulnerable, a 170px reposition, and the barrier shatters outward
    //  into 8 shards for 30 damage each."   S5: also a 2-hit shield for 6s.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) return false;    // the drill is hers, not the boss's
      H.applyInvuln(p.st, ctx.def.iframes);

      const r = H.area(p, FORM_SHARD_RADIUS);
      H.effects.shockwave(p.x, p.y, r, C_CHALK, FORM_FX);
      FORM_SHARD.damage = H.abilityDamage(run, p, FORM_SHARD_DAMAGE);
      // Extra Shot adds SHARDS to the barrier: eight becomes fourteen at the cap.
      // The ring gets denser and hits harder, which is the upgrade doing
      // something visible, without each of the eight becoming a fan of its own
      // and multiplying an escape by five.
      const shards = FORM_SHARDS + H.extraShots(p);
      for (let i = 0; i < shards; i++) {
        H.spread(run, p, p.x, p.y, (i / shards) * H.TAU, 1, 0, FORM_SHARD);
      }
      H.particles.ring(p.x, p.y, 14, C_LILAC, r * 1.6);

      let a = p.facing;
      if (p.movingT <= 0) {
        const t = H.target(run, p, FORM_AWAY);
        if (t.found) a = t.angle + Math.PI;
      }
      H.dash(run, p, a, FORM_DIST * (p.flags.escapeDistanceMult || 1),
             ctx.def.iframes, FORM_STEP);

      if (ctx.s5) {
        // Hit-based, not timed — every other shield in the game (the Susanoo
        // ribcage, the Nine-Seal Ward) is counted in hits, and a second clock
        // on top of that is a number the player cannot see.
        H.addShield(p.st, FORM_SHIELD_HITS);
        H.floaters.spawn(p.x, p.y - 46, 'AS WRITTEN', C_CHALK, 16, 1.0);
      }
      H.audio.play('escape');
    },
  },

  mana_discipline: {
    // "Every 5s without taking damage grants a stack of FORM: +6% attack speed
    //  and +4% damage each, up to 6 stacks. Taking a hit removes one stack, not
    //  all of them."
    init(run, p, ctx) {
      ctx.stacks = 0;
      ctx.clean = 0;
      ctx.seenDamage = run.stats.damageTaken;
      ctx.mods = { attackSpeedMult: 0, damageMult: 0 };
      p.addBuff('mana_discipline', FOREVER, ctx.mods);
    },
    tick(run, p, ctx, dt) {
      const taken = run.stats.damageTaken;
      if (taken > ctx.seenDamage) {
        ctx.seenDamage = taken;
        ctx.clean = 0;
        if (ctx.stacks > 0) {
          ctx.stacks--;
          applyFormBuff(p, ctx);
          H.floaters.spawn(p.x, p.y - 42, 'FORM ' + ctx.stacks, C_LILAC, 15, 0.8);
        }
        return;
      }
      if (ctx.stacks >= FORM_MAX_STACKS) return;
      ctx.clean += dt;
      if (ctx.clean < FORM_STACK_TIME) return;
      ctx.clean = 0;
      ctx.stacks++;
      applyFormBuff(p, ctx);
      H.particles.ring(p.x, p.y, 8, C_LILAC, 150);
      H.floaters.spawn(p.x, p.y - 42, 'FORM ' + ctx.stacks, C_CHALK, 15, 0.9);
    },
  },

  // ---- BRANT --------------------------------------------------------------

  two_handed_swing: {
    // "A 120° arc at 130px reach for 52 damage with 260px of knockback, every
    //  1.1s. With 3 or more enemies already inside the arc it hits 25% harder."
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      // The crowd check happens BEFORE the swing, on the same cone the swing
      // uses, so the card's "already inside the arc" is literally true.
      S.n = 0;
      H.forEachEnemyIn(run, o.x, o.y, H.area(p, CHOP_REACH), countBodies);
      const crowded = S.n >= CHOP_CROWD;
      S.n = 0;
      const dmg = H.autoDamage(run, p, ctx.def.damage, opts) *
                  (crowded ? CHOP_CROWD_BONUS : 1);
      H.meleeArc(run, p, o.x, o.y, t.angle, CHOP_ARC, CHOP_REACH, dmg, CHOP);
      if (crowded) {
        H.camera.punch(0.035, 0.2);
        H.shake.small();
      }
    },
  },

  hold_the_line: {
    // "For 6s everything within 300px is taunted onto him and he takes 60% less
    //  damage — and every point that gets through is stored. It ends in one
    //  swing: 250 damage plus 3x everything he absorbed, in a 260px arc."
    //  S3: 9s and 4x.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) {
        const o = H.origin(run, p, opts);
        H.hostileDamage(run, opts, o.x, o.y, H.area(p, LINE_SWING_REACH),
                        H.abilityDamage(run, p, LINE_BASE_DAMAGE, opts));
        H.particles.ring(o.x, o.y, 20, C_RUST, LINE_SWING_REACH * 2);
        H.audio.play('explode');
        return;
      }
      ctx.active = true;
      ctx.t = ctx.s3 ? LINE_TIME_S3 : LINE_TIME;
      ctx.stored = 0;
      ctx.seenDamage = run.stats.damageTaken;
      ctx.tauntT = 0;
      ctx.prevAura = p.flags.auraColor || null;
      p.flags.auraColor = C_RUST;
      p.flags.damageTakenMult = LINE_REDUCTION;
      p.flags.knockbackImmune = true;
      H.grade(run, C_RUST, 0.45, 0.7);
      H.announce(run, 'HOLD THE LINE', C_RUST);
      H.camera.punch(0.07, 0.5);
      H.shake.medium();
      H.audio.play('special');
    },
    tick(run, p, ctx, dt) {
      const taken = run.stats.damageTaken;
      if (taken > ctx.seenDamage) {
        ctx.stored += taken - ctx.seenDamage;
        ctx.seenDamage = taken;
        H.floaters.spawn(p.x, p.y - 58, Math.round(ctx.stored) + ' HELD', C_RUST, 16, 0.7);
      }
      run.ringOverlay(p.x, p.y, H.area(p, LINE_RADIUS), C_RUST);

      ctx.tauntT -= dt;
      if (ctx.tauntT > 0) return;
      ctx.tauntT = LINE_TAUNT_TICK;
      S.x = p.x; S.y = p.y; S.t = LINE_TAUNT; S.n = 0;
      H.forEachEnemyIn(run, p.x, p.y, H.area(p, LINE_RADIUS), tauntToPoint);
    },
    end(run, p, ctx) {
      p.flags.auraColor = ctx.prevAura;
      p.flags.damageTakenMult = 1;
      p.flags.knockbackImmune = false;
      const mult = ctx.s3 ? LINE_RETURN_S3 : LINE_RETURN;
      const dmg = H.abilityDamage(run, p, LINE_BASE_DAMAGE) + ctx.stored * mult;
      H.meleeArc(run, p, p.x, p.y, p.facing, LINE_SWING_ARC, LINE_SWING_REACH, dmg, LINE_SWING);
      H.grade(run, C_RUST, 0.5, 0.5);
      H.flash.fire('#ffffff', 0.4, 2.4);
      H.camera.punch(0.1, 0.6);
      H.shake.big();
      H.floaters.spawn(p.x, p.y - 66, Math.round(dmg) + '!!', C_RUST, 24, 1.4);
    },
  },

  flinch: {
    // "A 170px panic hop away from the nearest threat with full i-frames, and he
    //  swings wildly on the way down for 60 damage in a 140px radius."
    //  S5: 110 damage in 200px and a 1-hit shield for 3s.
    cast(run, p, ctx, opts) {
      if (H.isHostile(opts)) return false;    // the boss is not afraid of anything
      let a = p.facing + Math.PI;
      const t = H.target(run, p, FLINCH_AWAY);
      if (t.found) a = t.angle + Math.PI;
      H.dash(run, p, a, FLINCH_DIST * (p.flags.escapeDistanceMult || 1),
             ctx.def.iframes, FLINCH_STEP);
      H.nova(run, p, p.x, p.y,
             ctx.s5 ? FLINCH_RADIUS_S5 : FLINCH_RADIUS,
             H.abilityDamage(run, p, ctx.s5 ? FLINCH_DAMAGE_S5 : FLINCH_DAMAGE),
             FLINCH_NOVA);
      if (ctx.s5) {
        H.addShield(p.st, 1);
        H.floaters.spawn(p.x, p.y - 46, 'GUARD UP', C_STEEL, 16, 0.9);
      }
      H.camera.punch(0.03, 0.22);
    },
  },

  braver_than_he_looks: {
    // "Up to +50% damage as his HP drops, from +0% at full to +50% at 1 HP.
    //  Dropping under 30% HP makes him scream: everything within 240px is thrown
    //  400px back and slowed 40% for 2s, once every 15s."
    init(run, p, ctx) {
      ctx.poll = 0;
      ctx.armed = true;
      ctx.nextScream = 0;
      ctx.mods = { damageMult: 0 };
      p.addBuff('braver_than_he_looks', FOREVER, ctx.mods);
    },
    tick(run, p, ctx, dt) {
      ctx.poll -= dt;
      if (ctx.poll > 0) return;
      ctx.poll = 0.2;

      const frac = p.hpFraction;
      const want = BRAVE_MAX_BONUS * (1 - frac);
      if (Math.abs(want - ctx.mods.damageMult) > 0.01) {
        ctx.mods.damageMult = want;
        p.recompute();
      }

      // The scream is edge-triggered with a re-arm band, so a regen tick sitting
      // exactly on the threshold cannot make it stutter.
      if (frac >= SCREAM_REARM) { ctx.armed = true; return; }
      if (frac >= SCREAM_THRESHOLD || !ctx.armed) return;
      if (run.time < ctx.nextScream) return;
      ctx.armed = false;
      ctx.nextScream = run.time + SCREAM_COOLDOWN;

      const r = H.area(p, SCREAM_RADIUS);
      S.x = p.x; S.y = p.y; S.force = SCREAM_FORCE; S.dur = SCREAM_SLOW_TIME; S.n = 0;
      H.forEachEnemyIn(run, p.x, p.y, r, scareOff);
      H.effects.shockwave(p.x, p.y, r, C_RUST, SCREAM_FX);
      H.particles.ring(p.x, p.y, 22, C_RUST, r * 2.4);
      H.grade(run, C_RUST, 0.35, 0.4);
      H.camera.punch(0.06, 0.4);
      H.shake.medium();
      H.announce(run, 'AAAAAAH!', C_RUST);
      H.audio.play('explode');
    },
  },
});

// ===========================================================================
//                   THE FIVE NEW SIGNATURE RELIC IMPLEMENTATIONS
// ===========================================================================
// Registered into the shared table rather than written inside relicHooks.js —
// see the note at the top of this file. Signature is the same as every other
// entry there: (run, p, params, state, a, b, c), and nothing allocates per call.

// --- The Exclusive Contract (Yukine) ----------------------------------------
const CONTRACT_UP = 'exclusive_contract_deal';

// --- The Annotated Manual (Wren) --------------------------------------------
// Kills refund every timer the player has, including the relic interval clocks,
// which is why this reaches into the hook table rather than only the cooldowns.

// --- The Chipped Greataxe (Brant) -------------------------------------------
const GREATAXE_HIT = { canCrit: true, element: 'steel', knockback: 0 };

// --- The Cracked Teacup (Aoi) -----------------------------------------------
const TEACUP_HIT = { falloff: 0.25, element: 'water', knockback: 200 };
const TEACUP_FX = { tier: 0, life: 0.44, width: 7, from: 12, spokes: 12 };

// --- A Field of Flowers (Mirel) ---------------------------------------------
// The meadow itself — the heal field, the ragged fringe and the seeding pulse —
// lives up in her ability section and this relic plants exactly that one. They
// are the same spell out of the same book, and if the relic laid down a
// different-looking patch the player would reasonably conclude they were two
// different effects that happened to share a colour.
const MEADOW_CHILL = { param: 0.70 };

RELIC_IMPL.exclusive_contract = {
  /** Sign: a burst window, and then the clause you agreed to. */
  onInterval(run, p, params, state) {
    if (!state.mods) {
      state.mods = { damageMult: 0 };
      p.addBuff(CONTRACT_UP, FOREVER, state.mods);
    }
    state.phase = 1;
    state.left = params.duration || 8;
    state.mods.damageMult = params.bonus || 0.45;
    p.recompute();
    H.floaters.spawn(p.x, p.y - 52, 'SIGNED', C_FOXFIRE, 18, 1.1);
    H.particles.ring(p.x, p.y, 12, C_ICE, 220);
    H.audio.play('levelUp');
  },
  onTick(run, p, params, state, dt) {
    if (!state.phase) return;
    state.left -= dt;
    if (state.left > 0) return;
    if (state.phase === 1) {
      state.phase = 2;
      state.left = params.duration || 8;
      state.mods.damageMult = -(params.penalty || 0.20);
      p.recompute();
      H.floaters.spawn(p.x, p.y - 52, 'CLAUSE FOUR', C_ICE, 17, 1.1);
      return;
    }
    state.phase = 0;
    state.mods.damageMult = 0;
    p.recompute();
  },
};

RELIC_IMPL.annotated_manual = {
  onKill(run, p, params) {
    const r = params.refund || 0.4;
    p.special.reduce(r);
    p.escape.reduce(r);
    // Relic interval clocks are cooldowns too, and the card says "every
    // cooldown you have", so they move as well.
    const iv = run.relicHooks.table.onInterval;
    for (let i = 0; i < iv.length; i++) iv[i].state.t -= r;
  },
};

RELIC_IMPL.chipped_greataxe = {
  onEscape(run, p, params, state) {
    state.until = run.time + (params.window || 2);
  },
  /** The follow-through. The base swing already landed, so this pays the rest. */
  onAutoAttack(run, p, params, state) {
    if (!state.until || run.time > state.until) return;
    state.until = 0;
    const t = H.nearestTo(run, p.x, p.y, 260, null);
    if (!t) return;
    const extra = (params.damageMult || 2.5) - 1;
    GREATAXE_HIT.knockback = params.knockback || 500;
    H.dealDamage(run, t, p.def.autoAttack.damage * extra * p.autoDamageMultiplier(),
                 H.SRC.AUTO, GREATAXE_HIT);
    H.effects.impact(t.x, t.y, C_RUST, RIG_IMPACT);
    H.floaters.spawn(p.x, p.y - 54, 'FOLLOW THROUGH', C_RUST, 17, 1.0);
    H.audio.play('crit');
    H.shake.small();
  },
};

RELIC_IMPL.cracked_teacup = {
  onInterval(run, p, params) {
    const r = H.area(p, params.radius || 140);
    H.areaDamage(run, p.x, p.y, r, H.abilityDamage(run, p, params.damage || 120),
                 H.SRC.SPECIAL, TEACUP_HIT);
    // Clumsiness has never actually killed her. The floor is 1 HP, not a death.
    p.hp = Math.max(1, p.hp - (params.selfDamage || 5));
    p.flags.mishaps = (p.flags.mishaps | 0) + 1;
    H.effects.shockwave(p.x, p.y, r, C_PORCELAIN, TEACUP_FX);
    H.particles.ring(p.x, p.y, 14, C_TEA, r * 2.2);
    // The same porcelain the fumbled tray throws. It is the same accident and
    // it has to leave the same mess on the floor, or her signature relic reads
    // as somebody else's ability that happens to cost her HP.
    H.particles.burst(p.x, p.y, 10, C_PORCELAIN, SHARD_BURST);
    H.floaters.spawn(p.x, p.y - 46, 'CRASH', C_TEA, 17, 1.0);
    H.audio.play('explode');
    H.shake.small();
  },
};

RELIC_IMPL.field_of_flowers = {
  onInterval(run, p, params) {
    const radius = params.radius || MEADOW_RADIUS;
    const dur = params.duration || 8;
    // The slow is the relic's own clause and belongs to the relic — the spell
    // in the book has never slowed anybody, and a meadow that grips your ankles
    // is a relic doing something extra, not a meadow.
    MEADOW_CHILL.param = 1 - (params.slow || 0.30);
    H.field(run, p, p.x, p.y, radius, dur, 'chill', 0, C_MEADOW, MEADOW_CHILL);
    plantMeadow(run, p, p.x, p.y, radius, dur, params.healPerSecond || MEADOW_HEAL_DPS);
    H.floaters.spawn(p.x, p.y - 46, 'IN BLOOM', C_MEADOW, 17, 1.1);
    H.audio.play('pickup');
  },
};
