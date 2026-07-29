// ★5 ROSTER, PART B — NEKROMINA, HIKARI, AKANE, KIRA.
// SECTION 4, spec lines 693-812. Four pillars each, no character-id branches:
// the registry key IS the branch (DECISIONS.md §36).
//
// The four identities this file has to protect:
//   NEKROMINA fires ON A BEAT. Her auto is rhythmically regular and percussive,
//             and the downbeat is visible. The beat is now carried by the swing
//             itself — one 180° stroke per beat, alternating left and right —
//             which is what keeping time with a two-handed weapon looks like.
//   HIKARI    owns the most valuable passive in the game. `undying` does exactly
//             one thing — it opens the revive slot run.js already routes.
//   AKANE     is aimable chaos: every cannonball impact is telegraphed BEFORE it
//             lands, so BROADSIDE! is read, not suffered.
//   KIRA      never touches anything. His violence is off-screen and
//             administrative: no impact frames, no swings — a name is written,
//             a timer runs out, an enemy stops and falls over. His auto
//             deliberately ignores p.stats.damageMult (spec lines 790-795): he
//             is THROUGHPUT-limited, not damage-limited, which is the most
//             distinct build identity on the roster.

import { registerAll } from './index.js';
import * as H from './helpers.js';
// DECISIONS.md §17: "held" is an input-layer question, and the abstraction
// already resolves keyboard / gamepad / touch. Akane's S5 Barrel Roll is the
// only ability in this file that asks it.
import { input, ACT } from '../../core/input.js';

// --- visuals: registered once, never allocated in a fire()/tick() -------------
const DEADBEAT_VISUAL = { shape: 'capsule', color: '#efe6f2', accent: '#8b0f2a', size: 12 };
const ZOMBIE_VISUAL = { shape: 'capsule', color: '#7e8f5a', accent: '#2c1a30', size: 10 };
const FEATHER_VISUAL = { shape: 'shard', color: '#ff7a2f', accent: '#ffd24a', size: 8, rotates: true, glow: true };
const CANNONBALL_VISUAL = { shape: 'circle', color: '#2a2118', accent: '#d62b3a', size: 11 };

// --- reused option records (documented helper call shapes, created once) ------
const INK_FX = { life: 0.55, size: 0.3, speed: 14 };
const SMOKE_FX = { speed: 120, life: 0.7, size: 0.95 };
const MUZZLE_FX = { speed: 300, life: 0.16, size: 0.7, additive: true };
const HULL_FX = { life: 0.5, size: 0.7, speed: 8 };
const EYE_FX = { life: 0.4, size: 0.4, speed: 22 };
const BROADSIDE_AIM = { mode: 'densestCluster', range: 760 };
const AWAY_AIM = { mode: 'densestCluster', range: 520 };
const MASS_WRITE_AIM = { mode: 'nearestN', count: 6, filter: 'unmarked', range: 620 };

// ===========================================================================
//        AKANE'S PROPS — the three objects a pirate is made of
// ===========================================================================
//
// SHE WAS FIGHTING WITH ENERGY, WHICH IS THE ONE THING SHE HAS NONE OF.
//
// Everything in her kit is MATTER. A cutlass is a bar of steel, a flintlock is
// a machine that throws burning powder out of one end, a cannonball is eleven
// pounds of iron, and a rum barrel is a barrel. All four were drawn as coloured
// light: the cutlass was an arc with nothing in it, the flintlock was a
// one-frame line pushed into `run.overlays` that blinked and was gone, the
// broadside's galleon was six drifting motes, and the barrel was a yellow ring
// on the floor. The player report — "give her abilities better animations" — is
// really the report that none of her abilities looked like OBJECTS, which for
// the roster's one non-magical character is the whole read missing.
//
// So the three things she actually holds are pre-rastered props now, blitted
// source-over by `effects.sweepSprite` / `effects.fallSprite` in the second
// pass, and the energy effects stay exactly where they were: they are what the
// object DID to the air. Nothing about her damage, reach, cadence or cooldowns
// moved — this pass spends nothing but draw calls.
//
// Two of the three descriptors below are LITERAL, field-for-field copies of
// entries that are already in prewarm.js's EFFECT_VISUALS, which is why they
// cost the atlas nothing: the white steel crescent is a blade, and the brown
// disc that was written for a generic barrel-shaped thing is, in fact, a
// barrel seen from above. The cannon is the one genuinely new key, and it is
// registered HERE at module scope so it is baked before the first frame
// whichever of this module and the boot pass loads first.
//
// `flash: false` on the cannon for the same reason it is on every other prop:
// nothing can hit it, so the white twin is memory nothing will ever read — and
// because `flash` is part of the atlas key, omitting it would raster a SECOND
// cannon the first time she fires, which is exactly what tests/renderSmoke.js
// fails the build over.
const CUTLASS_STEEL = { shape: 'crescent', color: '#ffffff', accent: '#2a2a3a', size: 26, rotates: true };
const RUM_BARREL = { shape: 'circle', color: '#8a7b63', accent: '#3a3226', size: 20 };
const CANNON_IRON = { shape: 'saucer', color: '#2a2118', accent: '#e8c34a', size: 20, flash: false };
const CUTLASS_SPRITE = H.atlas.register(CUTLASS_STEEL);
const BARREL_SPRITE = H.atlas.register(RUM_BARREL);
const CANNON_SPRITE = H.atlas.register(CANNON_IRON);

/**
 * `sweepSprite` and `fallSprite` take a scale in MULTIPLES OF THE BAKED SPRITE,
 * so every call site below asks for a length in world pixels and divides by the
 * sprite's own width once, here. The alternative — hand-tuned scale constants —
 * silently changes size the day somebody edits a descriptor's `size`.
 */
const CUTLASS_UNIT = 1 / Math.max(1, CUTLASS_SPRITE.w);
const BARREL_UNIT = 1 / Math.max(1, BARREL_SPRITE.w);
const CANNON_UNIT = 1 / Math.max(1, CANNON_SPRITE.w);

// --- Buccaneer's Cutlass ----------------------------------------------------
/** 140°, 100px — the swing's declared geometry, unchanged and now named. */
const CUTLASS_ARC = 2.4435;
const CUTLASS_REACH = 100;
/**
 * Where the blade rides along the reach, and how much of it the blade spans.
 * Riding at 0.60 with a blade 0.80 of the reach long puts the hilt at her fist
 * and the point on the damage edge, which is what makes a 140° cone legible
 * without one extra draw call.
 */
const CUTLASS_RIDE = 0.60;
const CUTLASS_SPAN = 0.80;
/**
 * `sweep` here is a REQUEST, exactly as it is on Nekromina's scythe: `meleeArc`
 * otherwise picks the energy arc's direction from one module-level toggle whose
 * phase is shared with every other sword in the game, so a prop swung on top of
 * it would disagree for the whole run. Pinned per shot, off the shot index, so
 * her combo alternates and the blade and its own slash agree every time.
 */
const CUTLASS_SWING = { color: '#d62b3a', knockback: 120, src: H.SRC.AUTO, sweep: 1 };
const CUTLASS_SWEEP = { sweep: 1, scale: 1, ghosts: 3, life: 0.22 };

// --- the flintlock, and the ship's guns, which are the same machine ----------
/**
 * ONE GUN PROP, IN TWO SIZES. The pistol in her hand and the eighteen-pounders
 * along the galleon's rail are the same object at 26px and 70px, and that is a
 * statement rather than a saving: her entire answer to everything is a tube
 * full of powder, and the broadside is that answer eighteen times at once.
 */
const PISTOL_LEN = 26;
const GUN_LEN = 70;
const PISTOL_ARC = 0.46;
const GUN_ARC = 0.40;
const PISTOL_KICK = { sweep: 1, scale: PISTOL_LEN * CANNON_UNIT, ghosts: 2, life: 0.16, alpha: 0.95 };
const GUN_KICK = { sweep: 1, scale: GUN_LEN * CANNON_UNIT, ghosts: 3, life: 0.2, alpha: 0.95 };
const FLINTLOCK_HIT = { element: 'fire', knockback: 90, maxTargets: 0 };
/**
 * THE SHOT, as something with a life instead of a frame.
 *
 * It was `run.beamOverlay`, which the scene clears at the end of every tick —
 * so the one visible product of a hitscan shot existed for a single frame and,
 * at 144Hz with the sim at 60, was drawn for less than half of them. A pooled
 * beam rises, ripples and fades over a fifth of a second, which is how long a
 * muzzle flash actually hangs around. It also stops allocating an overlay
 * record on every third auto-attack.
 */
const FLINTLOCK_TRACE = { tier: 0, life: 0.2 };
const MUZZLE_JET = { tier: 0, life: 0.15 };
const MUZZLE_POP = { tier: 0, life: 0.2, size: 18 };
/** Powder smoke: slow, heavy, and it lingers long after the shot is resolved. */
const POWDER_FX = { speed: 200, life: 0.9, size: 0.8, drag: 3.2 };
const SPARK_FX = { speed: 380, life: 0.22, size: 0.45, additive: true };
const EMBER_FX = { speed: 150, life: 0.6, size: 0.35, drag: 2.4, additive: true };
const RECOIL_FX = { tier: 0, life: 0.22, alpha: 0.5 };
const RECOIL_GHOSTS = 3;

// --- BROADSIDE! -------------------------------------------------------------
/**
 * The galleon, in numbers.
 *
 * `HULL_HALF` is the same 280 the cast's telegraph line has always used, which
 * is the point: the ship is now DRAWN along the line that was already promising
 * it. `GUN_PORTS` is a row rather than a scatter — the shots walk down the
 * broadside and back, so a volley reads as one ship working its guns in
 * sequence instead of as fourteen unrelated bangs.
 */
const HULL_HALF = 280;
const GUN_PORTS = 7;
const HULL_REFRESH = 0.11;
/** How far the whole ship shoves when a gun goes off, and how fast it settles. */
const HULL_KICK = 16;
const HULL_SETTLE = 9;
const SHIP_TIMBER = '#8a7a5c';
const SHIP_DECK = '#c9c4bb';
const HULL_BEAM = { tier: 0, life: 0.2, alpha: 0.5 };
const RAIL_BEAM = { tier: 0, life: 0.2, alpha: 0.34 };
const ARRIVE_BEAM = { tier: 0, life: 0.7, alpha: 0.75 };
const FOG_FX = { speed: 120, life: 1.2, size: 0.9, drag: 2.2 };
/** The shell's flight, and the telegraph, are the same 1.1s. Unchanged. */
const SHELL_FLIGHT = 1.1;
const SHELL_ARC_BASE = 120;
const SHELL_ARC_PER_PX = 0.26;
/**
 * The volley's shot record, mutated in place.
 *
 * It used to be an object literal built inside `tick()` — one allocation per
 * cannonball, twenty-two of them per cast, on the frame the screen is busiest.
 */
const BROADSIDE_SHOT = {
  motion: H.MOTION.ARC, targetX: 0, targetY: 0,
  flightTime: SHELL_FLIGHT, arcHeight: SHELL_ARC_BASE,
  damage: 0, aoeRadius: 0, aoeDamage: 0,
  radius: 11, visual: CANNONBALL_VISUAL, element: 'fire',
  trailColor: '#7a6a58', owner: null, tag: 'broadside',
};
/**
 * WHERE THE SHELL LANDS, drawn as the shell landing.
 *
 * `MOTION.ARC` resolves its own damage on touchdown and offers no hook, so the
 * impact is scheduled for the same 1.1s the flight takes and lands on the same
 * frame. That is the only way to get splinters out of a projectile the engine
 * owns — and splinters are what separates "a cannonball hit the ground" from "a
 * number appeared". Thirty-two slots against ten shells in the air at once.
 */
const SHELL_SLOTS = 32;
const SHELLS = [];
for (let i = 0; i < SHELL_SLOTS; i++) SHELLS.push({ run: null, x: 0, y: 0, radius: 0 });
let shellSlot = 0;
const IMPACT_RING = { tier: 0, life: 0.44, width: 7, from: 16, spokes: 14 };
const IMPACT_POP = { tier: 0, life: 0.26, size: 24 };
/** Timber, going everywhere. `shard` is one of the five pre-baked shapes. */
const SPLINTER_FX = { speed: 300, life: 0.55, size: 0.5, drag: 3.2, shape: 'shard' };
const SCORCH_FX = { speed: 130, life: 0.7, size: 0.75, drag: 4 };

// --- Barrel Roll ------------------------------------------------------------
const BARREL_SIZE = 46;
/** Her diving into it: it comes down over her, spinning, in a fifth of a second. */
const BARREL_IN = { tier: 0, life: 0.22, from: 70, scale: BARREL_SIZE * BARREL_UNIT, angle: 0, spin: 5.5 };
/** And rolling: re-dropped on a cadence with a hair of lift, so it tumbles. */
const BARREL_ROLLING = { tier: 0, life: 0.14, from: 6, scale: BARREL_SIZE * BARREL_UNIT, angle: 0, spin: 7 };
const BARREL_ROLL_REFRESH = 0.09;
const STAVE_FX = { speed: 320, life: 0.6, size: 0.55, drag: 3, shape: 'shard' };
const RUM_SPRAY = { speed: 210, life: 0.7, size: 0.5, drag: 2.6 };
const SHATTER_FX = { tier: 0, life: 0.3, size: 26 };
/** The roll's own cut. Built once; it was an object literal per press. */
const ROLL_CUT = { damage: 0, width: 44, color: '#d62b3a', src: H.SRC.ESCAPE };

// --- NEKROMINA'S SCYTHE, the one PROP in this file ---------------------------
//
// Everything else in the game that an ability draws is ENERGY — an arc, a ring,
// a beam — and `effects` builds those from vector primitives precisely because a
// swing has to look different on every frame of its life. A scythe is the other
// case: it is the same object in every frame, only rotated, which is exactly
// what pre-rastering is for. So it is a registered atlas sprite blitted through
// the arc by `effects.sweepSprite`, and the energy arc `meleeArc` already draws
// is what the object did to the air.
//
// These two literals are EXACTLY the ones prewarm.js bakes at boot, field for
// field. The atlas key includes `flash`, so dropping that one property here
// would raster a SECOND copy of the scythe on the first swing of the run — a
// hitch at the worst possible moment, and something tests/renderSmoke.js fails
// the build over. Registering at module scope rather than inside fire() means
// neither import order costs a frame: `register` is a cache hit if the boot pass
// got here first and an ordinary raster if this module loaded before it.
const SCYTHE_PALE = { shape: 'scythe', color: '#dfe8f5', accent: '#8b0f2a', size: 30, flash: false };
const SCYTHE_GOLD = { shape: 'scythe', color: '#ffd76a', accent: '#8b0f2a', size: 30, flash: false };
const SCYTHE_SPRITE = H.atlas.register(SCYTHE_PALE);
const SCYTHE_SPRITE_EVO = H.atlas.register(SCYTHE_GOLD);

// --- Reaper's Rhythm: the swing's geometry -----------------------------------
/** A true half-circle. `coneDamage` halves this, so the footprint is ±90°. */
const REAPER_ARC = Math.PI;
/**
 * 150px, and the number is the whole balance argument for the rework.
 *
 * The crescents travelled 360px, which sounds like a reach a melee swing cannot
 * match — but they were THREE 26px-wide lanes fired 120° apart, each capped at
 * three bodies by its pierce, with up to a full second of flight before the far
 * end of that reach did anything at all. Swept area was ~54,000px² per beat
 * behind a hard nine-hit ceiling. A solid half-disc at 150px is ~35,000px² with
 * NO ceiling and no travel time, and the two land in the same place: driven for
 * 60 seconds on four seeds, walking into the crowd the way the game is actually
 * played, the swing does 985 damage against the waves' 992 — inside 1%. Standing
 * perfectly still it does 1,352 against 1,496, ~10% behind, which is the correct
 * direction for the trade: a melee auto should want you to close.
 *
 * Damage and cadence are untouched at 16 / 0.8s, exactly as her card states, so
 * the reach is the only thing this rework spends.
 *
 * 150 also makes her the longest melee auto on the roster — the cutlass is
 * 100px, the biggest chop 130px — which is what a two-handed scythe is FOR, and
 * it happens to put her whole summon ring (they spawn at 64px) inside her own
 * swing, which is a good place for a chorus line to stand.
 */
const REAPER_REACH = 150;
/**
 * How far the cone walks per beat with NOTHING in reach.
 *
 * Inherited from the crescent version, where it existed because three thin lanes
 * left 120° holes that had to be walked over. A half-disc has no holes, so the
 * walk now does exactly one job: an idle Nekromina keeps scything the room in a
 * slow rotation rather than facing one wall forever. The moment a body is inside
 * her reach the cone snaps onto it and the walk stops mattering.
 */
const REAPER_IDLE_STEP = H.TAU / 9;
/** Swing life, and the longer one the downbeat gets. */
const SWING_FX_LIFE = 0.26;
const DOWNBEAT_FX_LIFE = 0.36;
/**
 * Where the blade rides along the reach, and how much of the reach it spans.
 *
 * `sweepSprite` blits the prop centred on its radius, so riding at 0.62 and
 * spanning 0.78 puts the butt of the haft near her hip and the tip of the hook
 * on the damage edge — which is what makes the footprint legible without a
 * single extra draw call. Both scythe variants declare `size: 30`, so one
 * scale-per-pixel-of-reach constant serves both.
 */
const SCYTHE_RIDE = 0.62;
const SCYTHE_UNIT = 0.78 / Math.max(1, SCYTHE_SPRITE.w);

/**
 * The swing's two option bags. Mutated in place; never rebuilt per beat.
 *
 * `sweep` on the meleeArc bag is the one field here that is a REQUEST rather
 * than a setting. `helpers.meleeArc` currently picks the energy arc's direction
 * from one module-level toggle it flips on every call, which alternates
 * correctly — that toggle is what gives every sword in the game its left-right
 * combo — but its phase is shared, so it cannot be told to agree with a prop
 * being swung on top of it. Passing the direction we want costs nothing today
 * and locks the scythe and its own slash together the moment the helper reads
 * it; nothing else in this file depends on that landing.
 */
const REAPER_SWING = {
  color: '#ff5f8f', element: 'shadow', knockback: 40, src: H.SRC.AUTO,
  sweep: 1, fxLife: SWING_FX_LIFE, tier: 0,
};
const SCYTHE_SWEEP = { sweep: 1, scale: 1, ghosts: 4, life: SWING_FX_LIFE };

// --- shared numbers ----------------------------------------------------------
const DEADBEAT_TAG = 'deadbeat';
const ZOMBIE_TAG = 'necro_zombie';
const DEATH_TIMER = 3;              // spec: the countdown runs 3s, then they die
const EYES_RADIUS = 200;            // spec: marks apply in a 200px radius
const WRITE_SPEED_PER_KILL = 0.005; // spec: a permanent +0.5%, uncapped
const KIRA_RED = '#c8102e';

registerAll({

  // =========================================================================
  // NEKROMINA — "The Grave Idol". Death's apprentice, second shift.
  // =========================================================================

  // AUTO — "Reaper's Rhythm": swings the scythe through a 180° arc for 16 damage
  // every 0.8s, alternating left, right, left, right. Fires on a steady beat —
  // the SFX is percussive and loopable. Targeting: aroundSelf.
  //
  // THIS USED TO BE THREE THROWN CRESCENTS, which was never what the move is.
  // "Sweeps the scythe" described a spread of projectiles fanned 120° apart that
  // left her hand and flew away; the scythe itself never moved, and neither the
  // damage footprint nor the silhouette had anything to do with a swing. It is
  // now one melee cone — H.meleeArc at arcRad = π, so `coneDamage` tests the
  // exact half-disc `effects.slash` fills in — with the scythe SPRITE swung
  // through the same arc on top of it.
  reapers_rhythm: {
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const beat = ctx.shotIndex | 0;
      // Resolved once: the reach the cone will actually use, after areaMult and
      // the signature weapon. Everything below is measured against it so the
      // damage, the prop and the pulse cannot disagree about how big the swing is.
      const reach = H.area(p, REAPER_REACH);

      // WHERE THE HALF-CIRCLE POINTS.
      //
      // `aroundSelf` hands back her own facing and nothing else, which was the
      // right answer for a 240° fan of three waves: whichever way she faced, two
      // of the three lanes pointed somewhere useful. A single 180° cone has a
      // BACK, and a beat spent swinging at the wall behind the crowd is a beat
      // that does nothing — so the cone snaps onto the nearest body inside its
      // own reach. Nothing is lost by doing that: `nearestTo` measures centre
      // distance and `coneDamage` allows radius + the enemy's own radius, so
      // anything close enough to be snapped to is guaranteed to be hit.
      //
      // With the room empty it falls back to the declared spec and keeps walking
      // (see REAPER_IDLE_STEP), which is the same "rotating arc around herself"
      // the crescents drew — just with the scythe in it.
      const body = H.nearestTo(run, o.x, o.y, reach, null);
      let aim;
      if (body) {
        aim = H.angleTo(o.x, o.y, body.x, body.y);
      } else {
        const t = H.target(run, p, ctx.def.targeting, opts);
        aim = t.angle + beat * REAPER_IDLE_STEP;
      }

      // THE BEAT, AS A SWING. A rhythm you can see is a rhythm that ALTERNATES:
      // left, right, left, right, one stroke per beat, which is what a person
      // actually looks like keeping time with a two-handed weapon. Beat parity
      // decides the direction, so the downbeat — every fourth, an even one —
      // always falls on the same stroke, exactly like a real bar.
      const sweep = (beat & 1) ? -1 : 1;
      const downbeat = (beat & 3) === 0;
      // Resolved HERE rather than left to meleeArc so the energy arc and the
      // scythe cannot end up on different tiers: an evolved kit has to read as
      // evolved in one frame, and half of that read is the blade turning gold.
      const tier = H.visualTier(p, opts);
      const life = downbeat ? DOWNBEAT_FX_LIFE : SWING_FX_LIFE;

      REAPER_SWING.sweep = sweep;
      REAPER_SWING.tier = tier;
      REAPER_SWING.fxLife = life;
      // meleeArc plays 'slash' itself, which is why this no longer does: two
      // copies of the same sample on the same frame is a phasing artefact, not
      // a louder swing.
      H.meleeArc(run, p, o.x, o.y, aim, REAPER_ARC, REAPER_REACH,
                 H.autoDamage(run, p, ctx.def.damage, opts), REAPER_SWING);

      // THE SCYTHE ITSELF, riding the same arc at the same speed. `sweepSprite`
      // aligns every ghost along its own radius, so the haft always points back
      // at whoever is holding it — which is what makes this read as a swing from
      // her hip rather than a blade sliding sideways across the screen.
      //
      // "Whoever" is load-bearing: everything here pivots on `o`, not on `p`. A
      // mirroring minion and THE FINAL FORM both arrive as an origin, so both
      // sweep from where THEY stand, aim from where THEY stand, and — because
      // they all read the one shot index — stroke the same way on the same beat.
      // Nothing downstream assumed a projectile had left her hand: the old
      // version's only outputs were `run.projectiles.fire` calls, and no relic,
      // weapon or hook reads the 'rhythm' tag they carried.
      SCYTHE_SWEEP.sweep = sweep;
      SCYTHE_SWEEP.scale = reach * SCYTHE_UNIT;
      SCYTHE_SWEEP.ghosts = downbeat ? 6 : 4;
      SCYTHE_SWEEP.life = life;
      H.effects.sweepSprite(o.x, o.y, aim, REAPER_ARC, reach * SCYTHE_RIDE,
                            tier ? SCYTHE_SPRITE_EVO : SCYTHE_SPRITE, SCYTHE_SWEEP);

      // THE DOWNBEAT. Every fourth bar lands a visible pulse, so the rhythm is
      // something you can see as well as hear (and time Deadbeats' bobbing to).
      // The ring is sized to the real reach, so the accent doubles as the one
      // frame per bar that shows exactly how far the swing goes.
      if (downbeat) {
        H.particles.ring(o.x, o.y, 14, '#ff5f8f', reach * 2.2);
        H.camera.punch(0.02, 0.16);
      }
    },
  },

  // SPECIAL — "SUMMON: DEADBEATS" (25s): raises 5 hooded skeleton fans for 15s.
  // 20 damage per hit, 45 HP each, and they inherit 30% of your damage bonuses.
  // S3: Deadbeats explode for 60 damage when they expire or die.
  summon_deadbeats: {
    cast(run, p, ctx) {
      // "Grave Idol Mic" is the only thing in the game that writes minionSpeedBonus
      // and minionCapBonus, and the summoning ability is where they have to land.
      const beat = 0.8 / (p.flags.minionSpeedBonus || 1);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * H.TAU;
        H.summon(run, p, p.x + Math.cos(a) * 64, p.y + Math.sin(a) * 64, {
          role: H.MINION_ROLE.MELEE,
          hp: 45, damage: 20, speed: 185, life: 15,
          attackInterval: beat, orbitRadius: 64,
          tag: DEADBEAT_TAG, max: 12 + (p.flags.minionCapBonus | 0),
          visual: DEADBEAT_VISUAL, element: 'shadow',
          bonusShare: 0.3,
          onExpire: ctx.s3 ? deadbeatEncore : null,
        });
      }
      H.grade(run, '#ff5f8f', 0.34, 0.55);
      H.announce(run, 'SUMMON: DEADBEATS', '#ff5f8f');
      H.particles.ring(p.x, p.y, 26, '#8b0f2a', 420);
      H.shake.medium();
      H.camera.punch(0.05, 0.35);
      H.audio.play('special');
    },
  },

  // ESCAPE — "Phase Out" (6s): intangible for 1.2s — walks THROUGH enemies,
  // immune to everything, +40% move speed. The longest i-frame window in the
  // game, and it deals no damage at all.
  // S5: also resurrects one nearby corpse as a Deadbeat.
  phase_out: {
    cast(run, p, ctx) {
      const d = ctx.def.iframes;            // 1.2
      ctx.active = true;
      ctx.t = d;
      H.applyInvuln(p.st, d);               // immune to everything...
      H.applyIntangible(p.st, d);           // ...and walks through the crowd
      H.applyUntargetable(p.st, d);
      p.flags.moveSpeedMult = 1.4;
      H.grade(run, '#8b0f2a', 0.24, 0.4);
      H.particles.ring(p.x, p.y, 16, '#ff5f8f', 300);
      H.audio.play('escape');

      if (ctx.s5) {
        // "one corpse within 200px" — the radius the character data pins down.
        const body = H.nearestTo(run, p.x, p.y, 200, null);
        const bx = body ? body.x : p.x + H.runRng.range(-70, 70);
        const by = body ? body.y : p.y + H.runRng.range(-70, 70);
        H.summon(run, p, bx, by, {
          role: H.MINION_ROLE.MELEE,
          hp: 45, damage: 20, speed: 185, life: 15,
          attackInterval: 0.8 / (p.flags.minionSpeedBonus || 1),
          tag: DEADBEAT_TAG, max: 12 + (p.flags.minionCapBonus | 0),
          visual: DEADBEAT_VISUAL, element: 'shadow', bonusShare: 0.3,
          onExpire: ctx.s3 ? deadbeatEncore : null,
        });
        H.particles.burst(bx, by, 10, '#efe6f2', MUZZLE_FX);
      }
    },
    end(run, p, ctx) {
      p.flags.moveSpeedMult = 1;
      H.particles.ring(p.x, p.y, 12, '#ff5f8f', 220);
    },
  },

  // PASSIVE — "Necro-Harvest": every 25 kills, permanently raise a zombie
  // follower for the rest of the run (max 4). Weak individually; they stack.
  necro_harvest: {
    init(run, p, ctx) {
      ctx.lastKills = run.stats.kills | 0;
    },
    // Driven off run.stats.kills rather than an onKill callback so the count is
    // the same authoritative number the results screen shows — and so it cannot
    // silently miss deaths from DoTs, minions or hazards.
    tick(run, p, ctx, dt) {
      if (run.stats.kills - ctx.lastKills < 25) return;
      ctx.lastKills += 25;
      const a = H.runRng.angle();
      const m = H.summon(run, p, p.x + Math.cos(a) * 54, p.y + Math.sin(a) * 54, {
        role: H.MINION_ROLE.MELEE,
        hp: 30, damage: 10, speed: 150,
        attackInterval: 1.0 / (p.flags.minionSpeedBonus || 1),
        tag: ZOMBIE_TAG,
        // Max 4 — plus the Grave Idol Mic's +3, which is the "cap goes to 7"
        // her own build-path note in the character data describes.
        max: 4 + (p.flags.minionCapBonus | 0),
        visual: ZOMBIE_VISUAL, element: 'shadow',
      });
      if (!m) return;                       // already at four; the harvest waits
      H.floaters.spawn(m.x, m.y - 24, 'RISE', '#7e8f5a', 18, 1.1);
      H.particles.burst(m.x, m.y, 8, '#7e8f5a', MUZZLE_FX);
    },
  },

  // =========================================================================
  // HIKARI — "Hi-chan, the Phoenix Idol". Dying is basically her whole gimmick.
  // =========================================================================

  // AUTO — "Feather Flare": launches 4 burning feathers in a wide arc that stick
  // into the ground and burn for 3s (18 impact + 10/s burn in a 60px pool).
  // Every 1.0s. Targeting: densestCluster.
  feather_flare: {
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      if (!t.found) return;
      // Life is tuned to the throw distance so the feathers plant themselves in
      // the crowd rather than sailing past it.
      const reach = Math.sqrt(H.dist2(o.x, o.y, t.x, t.y));
      H.spread(run, p, o.x, o.y, t.angle, 4, 0.85, {
        damage: H.autoDamage(run, p, ctx.def.damage, opts),
        speed: 520, life: H.clamp(reach / 520, 0.24, 1.1),
        radius: 7, pierce: 2,
        motion: H.MOTION.STRAIGHT, element: 'fire',
        visual: FEATHER_VISUAL, trailColor: '#ffd24a',
        onExpire: featherPool,
        tag: 'feather',
      });
      H.audio.play('shoot');
    },
  },

  // SPECIAL — "REBIRTH NOVA" (27s): explodes in a 320px fire nova for 220
  // damage, then heals 25% of max HP over 3s. Everything hit burns.
  // S3: leaves a burning field for 6s.
  rebirth_nova: {
    cast(run, p, ctx) {
      H.nova(run, p, p.x, p.y, 320, H.abilityDamage(run, p, 220), {
        element: 'fire', color: '#ff7a2f', particles: 34,
        falloff: 0.15, onHit: igniteOnHit,
      });
      ctx.active = true;
      ctx.t = 3;
      ctx.healRate = p.maxHp * 0.25 / 3;    // 25% of max HP, spread over 3s
      ctx.healAcc = 0;
      if (ctx.s3) {
        // 320px, 6s, 20 damage/s — the S3 numbers exactly as her data states them.
        H.field(run, p, p.x, p.y, 320, 6, 'burn', 20, '#ff7a2f');
      }
      H.grade(run, '#ff7a2f', 0.5, 0.7);
      H.flash.fire('#ffd24a', 0.4, 3);
      H.announce(run, 'REBIRTH NOVA', '#ffd24a');
      H.camera.punch(0.09, 0.45);
      H.shake.big();
    },
    tick(run, p, ctx, dt) {
      ctx.healAcc += ctx.healRate * dt;
      // Healed in readable chunks so the number over her head means something.
      if (ctx.healAcc >= 2) { H.healPlayer(run, ctx.healAcc); ctx.healAcc = 0; }
      H.particles.drift(p.x + H.fxRng.signed() * 26, p.y + H.fxRng.signed() * 26, '#ffd24a', INK_FX);
    },
    end(run, p, ctx) {
      if (ctx.healAcc > 0) { H.healPlayer(run, ctx.healAcc); ctx.healAcc = 0; }
    },
  },

  // ESCAPE — "Ember Dash" (5s): a 200px dash with full i-frames, leaving a fire
  // trail that deals 15 damage/s for 3s.
  // S5: the fire trail chases the nearest enemy.
  ember_dash: {
    cast(run, p, ctx) {
      const a = p.facing;
      const seg = H.dash(run, p, a, 200, ctx.def.iframes, {
        color: '#ff7a2f', element: 'fire',
      });
      const chase = ctx.s5 ? H.nearestTo(run, seg.x1, seg.y1, 620, null) : null;
      for (let i = 0; i <= 3; i++) {
        const f = i / 3;
        H.field(run, p, H.lerp(seg.x0, seg.x1, f), H.lerp(seg.y0, seg.y1, f),
                44, 3, 'burn', 15, '#ff7a2f',
                // S5: the head of the trail peels off and hunts.
                i === 3 && chase ? { follow: chase } : undefined);
      }
      H.grade(run, '#ffd24a', 0.2, 0.3);
      H.particles.cone(seg.x0, seg.y0, a + Math.PI, 0.8, 8, '#ff7a2f', SMOKE_FX);
    },
  },

  // PASSIVE — "Undying": ONCE PER RUN, on lethal damage, revive at 50% HP with a
  // free Rebirth Nova and 2s of invulnerability.
  undying: {
    init(run, p, ctx) {
      // The whole passive. run.js owns the revive resolution order
      // (DECISIONS.md §29: Undying resolves first) and casts the free nova for
      // us, so all this pillar does is open the slot.
      p.flags.undying = true;
    },
  },

  // =========================================================================
  // AKANE — "Captain of the Treasure Ship". Ahoy.
  // =========================================================================

  // AUTO — "Buccaneer's Cutlass": a wide 140° cutlass arc at 100px reach, on the
  // cadence and for the damage her card declares. Every 3rd swing she instead
  // fires a FLINTLOCK shot — hitscan, pierces 4, 45 damage, with a satisfying
  // puff of smoke. Targeting: facing.
  //
  // Two guns and a sword, and all three of them are drawn as objects: see the
  // prop block at the top of this file for why that mattered enough to do.
  buccaneers_cutlass: {
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      const a = t.angle;
      const shot = ctx.shotIndex | 0;

      if (shot % 3 === 0) {
        // THE FLINTLOCK. Hitscan: it resolves the instant it is fired.
        const dmg = H.autoDamage(run, p, 45, opts);
        const x1 = o.x + Math.cos(a) * 520;
        const y1 = o.y + Math.sin(a) * 520;
        FLINTLOCK_HIT.maxTargets = H.pierce(p, 4) + 1;   // "pierces 4" — the shot plus four
        H.lineDamage(run, o.x, o.y, x1, y1, H.area(p, 16), dmg, H.SRC.AUTO, FLINTLOCK_HIT);

        // THE GUN, THEN THE FLASH, THEN THE SMOKE — in that order, because that
        // is the order they happen in and drawing them as one event is what made
        // this read as "a line appeared" rather than as a shot.
        //
        // The pistol is the ship's own gun at a third of the size (see
        // PISTOL_LEN), swung through a short arc pivoted on her fist: the
        // sweep's built-in wind-up dips the muzzle and then kicks it, which is
        // what a hand cannon going off does to the wrist holding it. Direction
        // alternates off the shot index so consecutive shots are not the same
        // shot twice, and none of it touches an RNG.
        const mx = o.x + Math.cos(a) * 22;
        const my = o.y + Math.sin(a) * 22;
        PISTOL_KICK.sweep = (shot & 2) ? -1 : 1;
        H.effects.sweepSprite(o.x, o.y, a, PISTOL_ARC, 24, CANNON_SPRITE, PISTOL_KICK);

        // The trace picks up the evolved tier, because an evolved kit has to
        // read as evolved in one frame and half of that read is her shot
        // growing gold rails down its length.
        FLINTLOCK_TRACE.tier = H.visualTier(p, opts);
        H.effects.beam(o.x, o.y, x1, y1, 5, '#ffe1a3', FLINTLOCK_TRACE);
        H.effects.beam(mx, my, mx + Math.cos(a) * 46, my + Math.sin(a) * 46, 13, '#ffd76a', MUZZLE_JET);
        H.effects.impact(mx, my, '#fff3b0', MUZZLE_POP);

        // The satisfying puff of smoke, which is the whole point of the move —
        // now heavy enough to still be hanging in the air on the next swing.
        H.particles.cone(mx, my, a, 0.55, 14, '#c9c4bb', POWDER_FX);
        H.particles.cone(mx, my, a, 0.22, 7, '#ffd76a', SPARK_FX);
        H.particles.burst(mx, my, 4, '#ff9a3d', EMBER_FX);
        H.audio.play('shoot');
        H.camera.punch(0.03, 0.2);
        H.shake.small();
      } else {
        // THE CUTLASS, with a cutlass in it. `meleeArc` draws the energy of the
        // swing; the sprite swept through the same arc at the same speed is the
        // bar of steel that displaced the air, and `sweepSprite` aligns every
        // ghost along its own radius so the hilt always points back at whoever
        // is holding it — which is what makes this a swing from her hip instead
        // of a blade sliding sideways across the screen.
        //
        // Everything pivots on `o` rather than on `p`, so a mirroring minion and
        // THE FINAL FORM both swing from where THEY stand.
        CUTLASS_SWING.sweep = (shot & 1) ? -1 : 1;
        H.meleeArc(run, p, o.x, o.y, a, CUTLASS_ARC, CUTLASS_REACH,
                   H.autoDamage(run, p, ctx.def.damage, opts), CUTLASS_SWING);
        const reach = H.area(p, CUTLASS_REACH);
        CUTLASS_SWEEP.sweep = CUTLASS_SWING.sweep;
        CUTLASS_SWEEP.scale = reach * CUTLASS_SPAN * CUTLASS_UNIT;
        H.effects.sweepSprite(o.x, o.y, a, CUTLASS_ARC, reach * CUTLASS_RIDE,
                              CUTLASS_SPRITE, CUTLASS_SWEEP);
      }
    },
  },

  // SPECIAL — "BROADSIDE!": a ghostly galleon fades in along one edge and runs
  // out its guns. 14 cannonballs arc across the arena over 2.5s, each exploding
  // for 70 damage in a 110px radius. Every impact point is telegraphed, so it is
  // aimable chaos rather than random chaos.
  // S3: 22 cannonballs and the galleon stays for a second volley.
  //
  // AIMABLE CHAOS IS THE IDENTITY AND THE TELEGRAPH IS ONLY HALF OF IT. Every
  // impact was already announced 1.1s before it landed; what was missing was the
  // other end of the line. Fourteen bangs came out of a stripe of warning colour
  // and fourteen explosions appeared, and nothing in between said SHIP. The hull
  // is drawn now, the guns are a row that fires in sequence, every shot kicks the
  // whole vessel back off the shot, and the shells loft in proportion to the
  // ground they cross — so the player can read where the volley is coming from,
  // which gun is next, and how far along the arc the iron currently is. None of
  // that changes a number. All of it changes whether the move is read or endured.
  broadside: {
    cast(run, p, ctx) {
      ctx.perVolley = ctx.s3 ? 22 : 14;
      ctx.volleys = ctx.s3 ? 2 : 1;
      ctx.total = ctx.perVolley * ctx.volleys;
      ctx.gap = 2.5 / ctx.perVolley;
      ctx.fired = 0;
      ctx.next = 0;
      ctx.dmg = H.abilityDamage(run, p, 70);
      ctx.active = true;
      ctx.t = 2.5 * ctx.volleys + (ctx.volleys - 1) * 0.7 + 0.25;

      // She anchors on whichever side of the arena has sea room.
      const mid = (run.bounds.minX + run.bounds.maxX) * 0.5;
      ctx.shipX = p.x > mid ? p.x - 760 : p.x + 760;
      ctx.shipY = p.y;
      // Which way the guns point. Every muzzle, every recoil and the hull's own
      // kick are measured against this one sign, so the ship cannot end up
      // firing out of its landward side.
      ctx.face = ctx.shipX < p.x ? 1 : -1;
      ctx.hullT = 0;
      ctx.kick = 0;
      run.hazards.telegraphLine(ctx.shipX, ctx.shipY - HULL_HALF, ctx.shipX, ctx.shipY + HULL_HALF,
                                40, ctx.t, 'yellow', 'arrow');

      // SHE FADES IN. The telegraph line has always promised a ship along this
      // edge and there was never one there — six drifting motes and a warning
      // stripe. The hull arrives as a single long beam down the exact line the
      // telegraph draws, with the fog it came out of blowing off it to leeward,
      // and `tick` keeps it on screen from there.
      H.effects.beam(ctx.shipX, ctx.shipY - HULL_HALF, ctx.shipX, ctx.shipY + HULL_HALF,
                     40, SHIP_TIMBER, ARRIVE_BEAM);
      H.particles.cone(ctx.shipX, ctx.shipY, ctx.face > 0 ? 0 : Math.PI, 2.4, 18, SHIP_TIMBER, FOG_FX);

      H.grade(run, '#d62b3a', 0.42, 0.6);
      H.announce(run, 'BROADSIDE!', '#e8c34a');
      H.camera.punch(0.06, 0.4);
      H.audio.play('special');
    },
    tick(run, p, ctx, dt) {
      // THE HULL, drawn rather than implied.
      //
      // Three pooled beams — the hull, the weather rail outboard, the far rail
      // inboard — refreshed four times faster than they fade, so they overlap
      // into one continuous ship for a handful of effect slots instead of three
      // draw calls a frame. They are spectral on purpose: `effects` composites
      // additively, and a ghost galleon is the one object in the game that ought
      // to be lit from inside.
      ctx.kick -= ctx.kick * (dt * HULL_SETTLE > 1 ? 1 : dt * HULL_SETTLE);
      ctx.hullT -= dt;
      if (ctx.hullT <= 0) {
        ctx.hullT = HULL_REFRESH;
        // The whole ship rides back on the recoil and settles. This is the cue
        // that makes a volley read as a ship WORKING rather than as a spawner.
        const hx = ctx.shipX - ctx.face * ctx.kick;
        const y0 = ctx.shipY - HULL_HALF, y1 = ctx.shipY + HULL_HALF;
        H.effects.beam(hx, y0, hx, y1, 34, SHIP_TIMBER, HULL_BEAM);
        H.effects.beam(hx + ctx.face * 15, y0 + 40, hx + ctx.face * 15, y1 - 40, 8, SHIP_DECK, RAIL_BEAM);
        H.effects.beam(hx - ctx.face * 15, y0 + 70, hx - ctx.face * 15, y1 - 70, 6, SHIP_TIMBER, RAIL_BEAM);
        H.particles.drift(hx, ctx.shipY + H.fxRng.signed() * HULL_HALF, SHIP_TIMBER, HULL_FX);
      }

      ctx.next -= dt;
      if (ctx.next > 0 || ctx.fired >= ctx.total) return;
      ctx.next = ctx.gap;
      ctx.fired++;
      // Reloading between volleys — the galleon holds station (S3).
      if (ctx.fired % ctx.perVolley === 0 && ctx.fired < ctx.total) ctx.next = 0.7;

      // Aimable, not random: the volley walks onto the thickest part of the crowd.
      const t = H.target(run, p, BROADSIDE_AIM);
      const cx = t.found ? t.x : p.x;
      const cy = t.found ? t.y : p.y;
      const spin = H.runRng.angle();
      const off = H.runRng.range(0, 250);
      const tx = H.clamp(cx + Math.cos(spin) * off, run.bounds.minX + 40, run.bounds.maxX - 40);
      const ty = H.clamp(cy + Math.sin(spin) * off, run.bounds.minY + 40, run.bounds.maxY - 40);
      const r = H.area(p, 110);

      // TELEGRAPHED FIRST. The shell's flight time and the telegraph are the
      // same 1.1s, so the red X fills exactly as the cannonball lands.
      run.hazards.telegraph(tx, ty, r, SHELL_FLIGHT, 'red', 'x');

      // WHICH GUN. The shot used to leave from a point level with wherever it
      // was going, which meant the muzzle flashes wandered up and down the edge
      // of the arena at random and the ship had no guns — it had one hole that
      // moved. They walk the broadside in order now, so the row is visible and
      // the volley has a rhythm you can hear coming.
      const port = ctx.fired % GUN_PORTS;
      const py = ctx.shipY - HULL_HALF * 0.82 + (port / (GUN_PORTS - 1)) * HULL_HALF * 1.64;
      const px = ctx.shipX - ctx.face * ctx.kick;
      const aim = H.angleTo(px, py, tx, ty);

      // A shell thrown further is thrown higher. One arc height for every range
      // made a long shot look like a flat line drive and a short one like a
      // mortar; both now loft in proportion to the ground they cover, which is
      // the entire "visibly ARCS" read.
      BROADSIDE_SHOT.targetX = tx;
      BROADSIDE_SHOT.targetY = ty;
      BROADSIDE_SHOT.arcHeight = SHELL_ARC_BASE + Math.sqrt(H.dist2(px, py, tx, ty)) * SHELL_ARC_PER_PX;
      BROADSIDE_SHOT.damage = ctx.dmg;
      BROADSIDE_SHOT.aoeRadius = r;
      BROADSIDE_SHOT.aoeDamage = ctx.dmg;
      BROADSIDE_SHOT.owner = p;
      run.projectiles.fire(px, py, aim, BROADSIDE_SHOT);

      // THE GUN GOING OFF: the barrel jumps in its port, a jet of flame leaves
      // it, the piece runs back inboard on its tackle, and the whole ship shoves
      // away from the shot.
      GUN_KICK.sweep = (port & 1) ? -1 : 1;
      H.effects.sweepSprite(px, py, aim, GUN_ARC, 30, CANNON_SPRITE, GUN_KICK);
      const jx = px + Math.cos(aim) * 34, jy = py + Math.sin(aim) * 34;
      H.effects.beam(jx, jy, jx + Math.cos(aim) * 90, jy + Math.sin(aim) * 90, 16, '#ffd76a', MUZZLE_JET);
      H.effects.impact(jx, jy, '#fff3b0', MUZZLE_POP);
      for (let i = 1; i <= RECOIL_GHOSTS; i++) {
        RECOIL_FX.alpha = 0.5 - i * 0.12;
        H.effects.afterimage(px - ctx.face * i * 10, py, aim, 13, SHIP_DECK, RECOIL_FX);
      }
      H.particles.cone(jx, jy, aim, 0.5, 12, '#c9c4bb', POWDER_FX);
      H.particles.cone(jx, jy, aim, 0.24, 6, '#ffd76a', SPARK_FX);
      H.particles.burst(jx, jy, 4, '#ff9a3d', EMBER_FX);
      ctx.kick = HULL_KICK;

      // AND WHERE IT LANDS. `MOTION.ARC` owns the damage and offers no hook, so
      // the splinters are scheduled for the same flight time and arrive on the
      // same frame the iron does.
      const rec = SHELLS[shellSlot];
      shellSlot = (shellSlot + 1) % SHELL_SLOTS;
      rec.run = run; rec.x = tx; rec.y = ty; rec.radius = r;
      run.scheduler.after(SHELL_FLIGHT, shellImpact, rec);
      H.shake.small();
    },
  },

  // ESCAPE — "Barrel Roll" (6s): dives into a rum barrel and rolls 220px, fully
  // invulnerable, dealing 30 to anything rolled over. The barrel shatters on
  // arrival leaving a rum puddle that ignites on any fire contact
  // (60 damage, 4s burn).
  // S5: can be HELD to keep rolling up to 1.5s, and the puddle ignites on its own.
  barrel_roll: {
    cast(run, p, ctx) {
      const a = p.facing;
      ROLL_CUT.damage = H.abilityDamage(run, p, 30);
      H.dash(run, p, a, 220, ctx.def.iframes, ROLL_CUT);
      ctx.angle = a;
      ctx.rollT = ctx.s5 ? 1.5 : 0;         // S5: hold to keep rolling
      ctx.rollDmg = H.abilityDamage(run, p, 30);
      ctx.segX = p.x; ctx.segY = p.y;
      ctx.hitT = 0.15;
      ctx.puddle = null;
      ctx.igniteT = 0.4;
      ctx.checkT = 0;
      ctx.fuseT = 0;
      ctx.propT = 0;
      ctx.done = false;
      ctx.active = true;
      ctx.t = 8;                            // roll window + the puddle's life
      // SHE DIVES INTO A BARREL, so there is a barrel. It comes down over her
      // spinning, which is the one frame that explains everything that follows —
      // without it the move is a yellow dash that inexplicably leaves a puddle.
      H.effects.fallSprite(p.x, p.y, BARREL_SPRITE, BARREL_IN);
      H.grade(run, '#e8c34a', 0.24, 0.4);
      H.particles.burst(p.x, p.y, 10, '#e8c34a', MUZZLE_FX);
    },
    tick(run, p, ctx, dt) {
      // THE ABILITY IS OVER — DO NOT BUILD ANOTHER BARREL.
      //
      // Igniting the rum sets `ctx.t = 0.05` to wind the ability down, but the
      // driver decrements `ctx.t` and only ends the ability on the tick it
      // reaches zero — so THREE more ticks of this body ran first, hit the
      // "no puddle yet" branch below, shattered a fresh barrel and reset
      // `ctx.t` back to 6. That is an infinite loop: detonate, rebuild,
      // detonate, for the rest of the run, one nova and one screen flash every
      // few frames. It was rare before because ignition needed a real fire
      // source; the evolved signature's standing aura made it certain.
      if (ctx.done) return;

      // --- still rolling (S5 only) -----------------------------------------
      if (ctx.rollT > 0) {
        if (input.held(ACT.ESCAPE)) {
          ctx.rollT -= dt;
          H.applyInvuln(p.st, 0.2);         // fully invulnerable the whole way
          const step = 330 * dt;
          p.x = H.clamp(p.x + Math.cos(ctx.angle) * step, run.bounds.minX, run.bounds.maxX);
          p.y = H.clamp(p.y + Math.sin(ctx.angle) * step, run.bounds.minY, run.bounds.maxY);
          p.px = p.x; p.py = p.y;
          H.particles.drift(p.x, p.y, '#e8c34a', HULL_FX);
          // The barrel she is inside, re-blitted on a cadence with a hair of
          // lift and a hard spin: a prop cannot be held on screen by a system
          // whose every entry has a lifetime, so a rolling object is drawn as a
          // fast sequence of very short-lived ones. The spin is what makes it
          // roll rather than slide.
          ctx.propT -= dt;
          if (ctx.propT <= 0) {
            ctx.propT = BARREL_ROLL_REFRESH;
            H.effects.fallSprite(p.x, p.y, BARREL_SPRITE, BARREL_ROLLING);
          }
          // Damage is resolved on a 0.15s cadence over the segment just covered,
          // so a long roll cannot hit the same enemy sixty times a second.
          ctx.hitT -= dt;
          if (ctx.hitT <= 0) {
            ctx.hitT = 0.15;
            H.lineDamage(run, ctx.segX, ctx.segY, p.x, p.y, H.area(p, 22),
                         ctx.rollDmg, H.SRC.ESCAPE, { knockback: 120 });
            ctx.segX = p.x; ctx.segY = p.y;
          }
          return;
        }
        ctx.rollT = 0;                      // released: the barrel shatters here
      }

      // --- the barrel shatters ----------------------------------------------
      if (!ctx.puddle) {
        ctx.puddle = H.field(run, p, p.x, p.y, 80, 6, 'damage', 0, '#e8c34a');
        // IT SHATTERS. Staves outward as timber shards, rum outward as liquid,
        // and one hard pop where the hoops let go — the puddle is the thing it
        // BECAME and needs a moment where it stops being a barrel.
        H.effects.impact(p.x, p.y, '#e8c34a', SHATTER_FX);
        H.particles.burst(p.x, p.y, 12, '#8a7a5c', STAVE_FX);
        H.particles.burst(p.x, p.y, 12, '#e8c34a', RUM_SPRAY);
        H.particles.burst(p.x, p.y, 14, '#e8c34a', SMOKE_FX);
        H.audio.play('explode');
        ctx.t = 6;
        if (!ctx.puddle) { ctx.t = 0.05; }
        return;
      }
      if (!ctx.puddle.active) { ctx.puddle = null; ctx.done = true; ctx.t = 0.05; return; }

      // --- does anything fire-based touch the rum? --------------------------
      //
      // THE RUM LIGHTS FROM FIRE YOU PLACED, NOT FROM THE FIRE YOU PERMANENTLY
      // ARE. An always-on self-aura — the evolved signature's standing halo, an
      // evolved Storm Ring — is a BURN field glued to the player, so without
      // this rule it overlapped the puddle the instant the barrel shattered AND
      // kept every nearby enemy alight, making the ignition an unconditional
      // rider on every single dash. A conditional payoff that is always true is
      // not a payoff, and at a reduced escape cooldown it fired constantly.
      //
      // A field that FOLLOWS a host is by definition somebody's aura, so it is
      // skipped, and so is any enemy standing inside one. Dashing clear and then
      // walking your aura back over the puddle still lights it — that is the
      // move working, and it is a decision rather than a freebie.
      ctx.checkT -= dt;
      if (ctx.checkT > 0) return;
      ctx.checkT = 0.2;
      // A short fuse, so the nova never lands on the same frame as the dash.
      ctx.fuseT = (ctx.fuseT || 0) + 0.2;
      if (ctx.fuseT < 0.4) return;
      const f = ctx.puddle;

      let lit = false;
      if (ctx.s5) {                          // S5: it lights itself
        ctx.igniteT -= 0.2;
        lit = ctx.igniteT <= 0;
      }
      if (!lit) {                            // anything burning standing in it
        AURAS.length = 0;
        const fields = run.hazards.fields.items;
        for (let i = 0; i < run.hazards.fields.count; i++) {
          const g = fields[i];
          if (g !== f && g.effect === H.FIELD.BURN && g.followHost) AURAS.push(g);
        }
        IGNITE_HIT = false;
        H.forEachEnemyIn(run, f.x, f.y, f.radius, checkBurning);
        lit = IGNITE_HIT;
      }
      if (!lit) {                            // or any burning ground overlapping it
        const fields = run.hazards.fields.items;
        for (let i = 0; i < run.hazards.fields.count; i++) {
          const g = fields[i];
          if (g === f || g.effect !== H.FIELD.BURN || g.followHost) continue;
          const rr = g.radius + f.radius;
          if (H.dist2(g.x, g.y, f.x, f.y) < rr * rr) { lit = true; break; }
        }
      }
      if (!lit) return;

      // WHOOMPH. 60 damage, then it burns for 4s.
      H.nova(run, p, f.x, f.y, 80, H.abilityDamage(run, p, 60), {
        element: 'fire', color: '#ff9a3d', falloff: 0.2, src: H.SRC.ESCAPE,
      });
      H.field(run, p, f.x, f.y, 80, 4, 'burn', 15, '#ff7a2f');
      // Burning spirit throws what is left of the barrel at the room.
      H.particles.burst(f.x, f.y, 10, '#8a7a5c', STAVE_FX);
      H.particles.burst(f.x, f.y, 10, '#ff9a3d', EMBER_FX);
      H.flash.fire('#ff9a3d', 0.3, 3);
      run.hazards.fields.release(f);
      ctx.puddle = null;
      ctx.done = true;
      ctx.t = 0.05;
    },
    end(run, p, ctx) {
      ctx.puddle = null;
      ctx.done = false;
    },
  },

  // PASSIVE — "Treasure Sense": chests and Treasure Carriers spawn 50% more often
  // and their location is permanently marked with a compass arrow at the edge of
  // the view. She is the best character in the game to farm on.
  treasure_sense: {
    init(run, p, ctx) {
      p.flags.treasureCompass = true;       // the HUD draws the edge-of-view arrow
      p.flags.chestBonus = 0.5;             // +50% chest / Treasure Carrier rate
    },
  },

  // =========================================================================
  // KIRA — "The God of the New World".
  // No impact frames. No swings. Enemies simply stop and fall over.
  // =========================================================================

  // AUTO — "Write the Name": every 0.6s he writes one name. The nearest UNMARKED
  // enemy gets a small countdown timer above its head. When it expires after 3s
  // that enemy DIES INSTANTLY regardless of its current or maximum HP. Bosses and
  // elites cannot be written — they take 400 damage when the timer resolves.
  // Targeting: nearest unmarked.
  //
  // >>> DESIGN NOTE (spec lines 790-795), PROTECTED HERE IN CODE:
  //     this ignores enemy HP scaling completely, so he is weak in the first
  //     three minutes and monstrous at minute 18. He is THROUGHPUT-limited, not
  //     damage-limited. Note what is absent: H.autoDamage() is never called.
  //     p.stats.damageMult does not touch this ability and must not be made to.
  //     Every attack-SPEED upgrade is enormous for him; every DAMAGE upgrade
  //     does exactly nothing. That is the most distinct build identity on the
  //     roster and it is deliberate.
  write_the_name: {
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      if (H.isHostile(opts)) {
        // THE FINAL FORM writing YOUR name. An execute cannot be mirrored onto
        // the player, so it lands as an off-screen judgement instead.
        H.damagePlayer(run, p.maxHp * 0.05, H.SRC.BOSS);
        H.flash.fire(KIRA_RED, 0.3, 3);
        return;
      }

      WRITE_RUN = run; WRITE_P = p;
      const radius = p.flags.deathNoteRadius | 0;
      // "Potato Chip Gambit" hands the next name six subjects at once. The flag
      // name is the relic's — relicHooks writes `nextWriteMarks` and this is the
      // only reader, so the two must agree exactly or the signature relic is inert.
      const mass = p.flags.nextWriteMarks | 0;

      if (radius > 0) {
        // SHINIGAMI EYES: names apply in a radius instead of one at a time.
        WRITE_HITS = 0;
        H.forEachEnemyIn(run, o.x, o.y, H.area(p, radius), writeNameEach);
        // An empty radius must never make him worse than his baseline: if the
        // sweep caught nobody, he still writes the one name he always writes.
        if (WRITE_HITS === 0) {
          const t = H.target(run, p, ctx.def.targeting, opts);
          if (t.found) writeName(run, p, t.target);
        }
      } else if (mass > 0) {
        p.flags.nextWriteMarks = 0;
        MASS_WRITE_AIM.count = H.clamp(mass, 1, 12);
        const t = H.target(run, p, MASS_WRITE_AIM, opts);
        for (let i = 0; i < t.targets.length; i++) writeName(run, p, t.targets[i]);
      } else {
        const t = H.target(run, p, ctx.def.targeting, opts);
        if (t.found) writeName(run, p, t.target);
      }
      WRITE_RUN = null; WRITE_P = null;
    },
  },

  // SPECIAL — "SHINIGAMI EYES" (30s): for 8s he sees every name and lifespan in
  // the world. All pending timers resolve INSTANTLY, his write rate triples, and
  // marks apply in a 200px radius rather than one at a time. COST: 25% of his
  // CURRENT HP the moment it is cast.
  // S3: lasts 12s and the HP cost drops to 10%.
  shinigami_eyes: {
    cast(run, p, ctx) {
      // The price, paid up front, through damage.js like everything else.
      // It ignores i-frames AND invulnerability on purpose: he has a 1.5s
      // untargetable escape on a 7s cooldown, so any cost that respects invuln
      // is a cost he simply never pays. 25% of CURRENT hp can never be the
      // killing blow, and trueDamage means armour cannot shave it either.
      H.damagePlayer(run, p.hp * (ctx.s3 ? 0.10 : 0.25), H.SRC.DOT, {
        ignoreInvuln: true, ignoreIframes: true, trueDamage: true, undodgeable: true,
      });

      ctx.active = true;
      ctx.t = ctx.s3 ? 12 : 8;
      ctx.pulseT = 0;
      p.flags.shinigamiEyes = true;         // the passive triples the write rate
      p.flags.deathNoteRadius = EYES_RADIUS;
      p.flags.deathNoteFlush = true;        // every pending timer resolves at once
      p.flags.auraColor = KIRA_RED;

      H.grade(run, KIRA_RED, 0.55, 0.9);    // a lot of red backlighting
      H.flash.fire(KIRA_RED, 0.45, 2.2);
      H.announce(run, 'SHINIGAMI EYES', KIRA_RED);
      H.camera.punch(0.07, 0.5);
      H.audio.play('special');
    },
    tick(run, p, ctx, dt) {
      ctx.pulseT -= dt;
      if (ctx.pulseT > 0) return;
      ctx.pulseT = 0.18;
      H.particles.drift(p.x + H.fxRng.signed() * 22, p.y - 14 + H.fxRng.signed() * 10, KIRA_RED, EYE_FX);
    },
    end(run, p, ctx) {
      p.flags.shinigamiEyes = false;
      p.flags.deathNoteRadius = 0;
      p.flags.auraColor = null;
    },
  },

  // ESCAPE — "Just As Planned" (7s): he steps back, adjusts his cuffs, and is
  // simply no longer a suspect. 1.5s untargetable — enemies lose track of him
  // entirely and wander — and every enemy that was targeting him is immediately
  // marked with a death timer.
  // S5: also resets the timers on every marked enemy to zero.
  just_as_planned: {
    cast(run, p, ctx) {
      const d = ctx.def.iframes;            // 1.5
      // He steps back — away from the thickest part of the room.
      const t = H.target(run, p, AWAY_AIM);
      const away = (t.found ? t.angle : p.facing) + Math.PI;
      H.dash(run, p, away, 110, d, { color: '#3a3a48' });
      H.applyUntargetable(p.st, d);
      H.applyInvuln(p.st, d);

      // Everything that was tracking him loses the thread, wanders off, and is
      // written down on the way.
      WRITE_RUN = run; WRITE_P = p;
      H.forEachEnemyIn(run, p.x, p.y, 420, loseTheSuspect);
      WRITE_RUN = null; WRITE_P = null;

      if (ctx.s5) p.flags.deathNoteFlush = true;   // every timer to zero

      H.grade(run, '#2a2a34', 0.3, 0.45);
      H.announce(run, 'JUST AS PLANNED', KIRA_RED);
      H.particles.ring(p.x, p.y, 12, KIRA_RED, 200);
    },
  },

  // PASSIVE — "A God Must Be Just": every enemy killed by a death timer grants a
  // permanent +0.5% write speed for the rest of the run. Uncapped. He only
  // accelerates.
  //
  // This pillar also OWNS THE COUNTDOWN. statusEffects.tickStatus deliberately
  // never decrements marks, because a mark expiring has an effect rather than
  // just clearing — and "what happens when a timer resolves" is exactly what
  // this passive is about. Autos have no tick(); this does.
  a_god_must_be_just: {
    init(run, p, ctx) {
      ctx.writeSpeed = 1;
      ctx.applied = 0;
      ctx.bossDamage = p.def.autoAttack.damage || 400;   // 400, from his data
      p.flags.deathNotePending = 0;
      p.flags.deathNoteFlush = false;
      p.flags.attackSpeedBonus = 1;
    },
    tick(run, p, ctx, dt) {
      const flush = p.flags.deathNoteFlush === true;
      if (flush) p.flags.deathNoteFlush = false;

      // With nothing pending and nothing flushed, the sweep is skipped entirely —
      // he costs nothing on a frame where no name is outstanding.
      if (flush || p.flags.deathNotePending > 0) {
        const items = run.enemies.items;
        let pending = 0;
        for (let i = 0; i < run.enemies.count; i++) {
          const e = items[i];
          if (!e.active || e.hp <= 0 || e.st.markKind !== H.MARK.DEATH_TIMER) continue;
          if (!flush) {
            e.st.markT -= dt;
            if (e.st.markT > 0) { pending++; continue; }
          }
          e.st.markT = 0; e.st.markMax = 0; e.st.markKind = H.MARK.NONE;

          // The sentence lands. No swing, no impact frame, no knockback — a
          // small ink-dark ring and the enemy stops existing.
          H.particles.ring(e.x, e.y, 5, KIRA_RED, 90);
          const written = !(e.isElite || e.isBoss);
          // executeEnemy already enforces the rule that bosses and elites cannot
          // be written and take flat damage instead.
          H.executeEnemy(run, e, ctx.bossDamage, H.SRC.EXECUTE);
          if (written) ctx.writeSpeed += WRITE_SPEED_PER_KILL;
          if (!e.active) i--;
        }
        p.flags.deathNotePending = pending;
      }

      // Write rate = the permanent accumulation, tripled while the eyes are open.
      const speed = ctx.writeSpeed * (p.flags.shinigamiEyes ? 3 : 1);
      if (speed !== ctx.applied) {
        ctx.applied = speed;
        p.flags.attackSpeedBonus = speed;
      }
    },
  },

});

// ---------------------------------------------------------------------------
// Module-level callbacks. Declared once so nothing in a per-frame path ever
// creates a closure (the projectile/minion/iteration APIs all take plain
// functions, and these capture nothing).
// ---------------------------------------------------------------------------

/** NEKROMINA S3 — a Deadbeat that expires or dies detonates for 60. */
function deadbeatEncore(m, run) {
  const p = run.player;
  H.areaDamage(run, m.x, m.y, H.area(p, 70), H.abilityDamage(run, p, 60), H.SRC.SPECIAL, {
    falloff: 0.3, element: 'shadow',
  });
  H.particles.ring(m.x, m.y, 12, '#ff5f8f', 260);
  H.audio.play('explode');
}

/** HIKARI — a spent feather plants itself and burns a 60px pool for 3s at 10/s. */
function featherPool(pr, run) {
  H.field(run, run.player, pr.x, pr.y, 60, 3, 'burn', 10, '#ff7a2f');
  H.particles.burst(pr.x, pr.y, 4, '#ffd24a', MUZZLE_FX);
}

/** HIKARI — everything the Rebirth Nova touches burns, at the feathers' rate. */
function igniteOnHit(e) {
  H.applyBurn(e.st, 10, 3);
}

/**
 * AKANE — eleven pounds of iron arriving.
 *
 * Scheduled by the volley for the shell's own flight time, so it fires on the
 * frame `MOTION.ARC` resolves the blast it cannot give us a hook for. This is
 * the whole "splintering impact": a shockwave sized to the real damage radius,
 * a hot core, timber shards thrown outward and a low bank of scorched dust that
 * hangs after everything else has gone. The ARC's own ring and its `explode`
 * sample still play underneath — this is the layer that says what was HIT.
 */
function shellImpact(rec) {
  const run = rec.run;
  if (!run) return;
  H.effects.shockwave(rec.x, rec.y, rec.radius, '#ff9a3d', IMPACT_RING);
  H.effects.impact(rec.x, rec.y, '#ffd76a', IMPACT_POP);
  H.particles.burst(rec.x, rec.y, 9, '#8a7a5c', SPLINTER_FX);
  H.particles.burst(rec.x, rec.y, 6, '#c9c4bb', SCORCH_FX);
  H.camera.punch(0.02, 0.14);
}

/** AKANE — is anything standing in the rum already on fire? */
let IGNITE_HIT = false;
/** Self-following burn fields in play this check. Module scope: no allocation. */
const AURAS = [];
function checkBurning(e) {
  if (e.st.burnT <= 0) return true;
  // An enemy that is only on fire because it is standing in one of YOUR
  // permanent auras is not "a burning thing that wandered into the rum" — it is
  // the aura, one step removed. See the comment at the call site.
  for (let i = 0; i < AURAS.length; i++) {
    const g = AURAS[i];
    const rr = g.radius + e.radius;
    if (H.dist2(g.x, g.y, e.x, e.y) < rr * rr) return true;
  }
  IGNITE_HIT = true;
  return false;
}

// KIRA — the two enemy-iteration callbacks share these instead of capturing.
let WRITE_RUN = null;
let WRITE_P = null;

/** Write one name: a 3s countdown over its head, and nothing else happens yet. */
function writeName(run, p, e) {
  if (!e || !e.active || e.hp <= 0) return false;
  if (e.st.markKind !== H.MARK.NONE) return false;      // never refresh a timer
  H.applyMark(e.st, H.MARK.DEATH_TIMER, DEATH_TIMER, 0);
  p.flags.deathNotePending = (p.flags.deathNotePending || 0) + 1;
  H.particles.drift(e.x, e.y - e.radius - 8, KIRA_RED, INK_FX);
  return true;
}

let WRITE_HITS = 0;
function writeNameEach(e) {
  if (writeName(WRITE_RUN, WRITE_P, e)) WRITE_HITS++;
  return true;
}

/** "Just As Planned": marked, and no longer sure who they were chasing. */
function loseTheSuspect(e) {
  const p = WRITE_P;
  writeName(WRITE_RUN, p, e);
  const a = H.runRng.angle();
  const wx = p.x + Math.cos(a) * 340;
  const wy = p.y + Math.sin(a) * 340;
  H.applyTaunt(e.st, 1.5, wx, wy);      // the declared "go there instead" channel
  H.applyPull(e.st, 1.5, wx, wy, 70);   // and a gentle drift, so they visibly wander
  return true;
}
