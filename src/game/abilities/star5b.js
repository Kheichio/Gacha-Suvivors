// ★5 ROSTER, PART B — NEKROMINA, HIKARI, AKANE, KIRA.
// SECTION 4, spec lines 693-812. Four pillars each, no character-id branches:
// the registry key IS the branch (DECISIONS.md §36).
//
// The four identities this file has to protect:
//   NEKROMINA fires ON A BEAT. Her auto is rhythmically regular and percussive,
//             and the downbeat is visible.
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
const CRESCENT_WAVE = { shape: 'crescent', color: '#ff5f8f', accent: '#8b0f2a', size: 13, rotates: true, glow: true };
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

  // AUTO — "Reaper's Rhythm": sweeps the scythe in a rotating arc around herself,
  // releasing 3 crescent waves, 16 damage, every 0.8s. Fires on a steady beat —
  // the SFX is percussive and loopable. Targeting: aroundSelf (rotating spread).
  reapers_rhythm: {
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      const beat = ctx.shotIndex | 0;
      // The sweep advances a fixed step every beat, so successive bars of three
      // walk all the way around her instead of cutting the same three lanes.
      const base = (t.found ? t.angle : o.facing || 0) + beat * (H.TAU / 9);
      H.spread(run, p, o.x, o.y, base, 3, H.TAU * (2 / 3), {
        damage: H.autoDamage(run, p, ctx.def.damage, opts),
        speed: 360, life: 1.0, radius: 13, pierce: 2,
        motion: H.MOTION.STRAIGHT, element: 'shadow',
        visual: CRESCENT_WAVE, trailColor: '#8b0f2a', knockback: 40,
        tag: 'rhythm',
      });
      H.audio.play('slash');
      // THE DOWNBEAT. Every fourth bar lands a visible pulse, so the rhythm is
      // something you can see as well as hear (and time Deadbeats' bobbing to).
      if ((beat & 3) === 0) {
        H.particles.ring(o.x, o.y, 10, '#ff5f8f', 300);
        H.camera.punch(0.012, 0.12);
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

  // AUTO — "Buccaneer's Cutlass": a wide 140° cutlass arc, 24 damage, 100px
  // reach, every 0.65s. Every 3rd swing she instead fires a FLINTLOCK shot —
  // hitscan, pierces 4, 45 damage, with a satisfying puff of smoke.
  // Targeting: facing.
  buccaneers_cutlass: {
    fire(run, p, ctx, opts) {
      const o = H.origin(run, p, opts);
      const t = H.target(run, p, ctx.def.targeting, opts);
      const a = t.angle;

      if ((ctx.shotIndex | 0) % 3 === 0) {
        // THE FLINTLOCK. Hitscan: it resolves the instant it is fired.
        const dmg = H.autoDamage(run, p, 45, opts);
        const x1 = o.x + Math.cos(a) * 520;
        const y1 = o.y + Math.sin(a) * 520;
        H.lineDamage(run, o.x, o.y, x1, y1, H.area(p, 16), dmg, H.SRC.AUTO, {
          element: 'fire', knockback: 90,
          maxTargets: H.pierce(p, 4) + 1,   // "pierces 4" — the shot plus four
        });
        run.beamOverlay(o.x, o.y, x1, y1, 5, '#ffe1a3');
        // The satisfying puff of smoke, which is the whole point of the move.
        H.particles.cone(o.x + Math.cos(a) * 20, o.y + Math.sin(a) * 20, a, 0.55, 12, '#c9c4bb', SMOKE_FX);
        H.particles.burst(o.x + Math.cos(a) * 22, o.y + Math.sin(a) * 22, 6, '#ffd76a', MUZZLE_FX);
        H.audio.play('shoot');
        H.camera.punch(0.024, 0.16);
      } else {
        H.meleeArc(run, p, o.x, o.y, a, 2.4435, 100,           // 140°, 100px reach
                   H.autoDamage(run, p, ctx.def.damage, opts), {
          color: '#d62b3a', knockback: 120, src: H.SRC.AUTO,
        });
      }
    },
  },

  // SPECIAL — "BROADSIDE!" (27s): a ghostly galleon fades in along one edge and
  // runs out its guns. 14 cannonballs arc across the arena over 2.5s, each
  // exploding for 70 damage in a 110px radius. Every impact point is
  // telegraphed, so it is aimable chaos rather than random chaos.
  // S3: 22 cannonballs and the galleon stays for a second volley.
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
      run.hazards.telegraphLine(ctx.shipX, ctx.shipY - 280, ctx.shipX, ctx.shipY + 280,
                                40, ctx.t, 'yellow', 'arrow');

      H.grade(run, '#d62b3a', 0.42, 0.6);
      H.announce(run, 'BROADSIDE!', '#e8c34a');
      H.camera.punch(0.06, 0.4);
      H.audio.play('special');
    },
    tick(run, p, ctx, dt) {
      // The hull, drawn in drifting spectral timber rather than an allocation.
      ctx.hullT = (ctx.hullT || 0) - dt;
      if (ctx.hullT <= 0) {
        ctx.hullT = 0.12;
        H.particles.drift(ctx.shipX, ctx.shipY + H.fxRng.signed() * 260, '#8a7a5c', HULL_FX);
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
      run.hazards.telegraph(tx, ty, r, 1.1, 'red', 'x');

      const sy = ty + H.runRng.range(-40, 40);
      run.projectiles.fire(ctx.shipX, sy, H.angleTo(ctx.shipX, sy, tx, ty), {
        motion: H.MOTION.ARC,
        targetX: tx, targetY: ty, flightTime: 1.1, arcHeight: 200,
        damage: ctx.dmg, aoeRadius: r, aoeDamage: ctx.dmg,
        radius: 11, visual: CANNONBALL_VISUAL, element: 'fire',
        trailColor: '#7a6a58', owner: p, tag: 'broadside',
      });
      H.particles.burst(ctx.shipX, sy, 7, '#ffd76a', MUZZLE_FX);
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
      H.dash(run, p, a, 220, ctx.def.iframes, {
        damage: H.abilityDamage(run, p, 30), width: 44,
        color: '#d62b3a', src: H.SRC.ESCAPE,
      });
      ctx.angle = a;
      ctx.rollT = ctx.s5 ? 1.5 : 0;         // S5: hold to keep rolling
      ctx.rollDmg = H.abilityDamage(run, p, 30);
      ctx.segX = p.x; ctx.segY = p.y;
      ctx.hitT = 0.15;
      ctx.puddle = null;
      ctx.igniteT = 0.4;
      ctx.checkT = 0;
      ctx.active = true;
      ctx.t = 8;                            // roll window + the puddle's life
      H.grade(run, '#e8c34a', 0.24, 0.4);
      H.particles.burst(p.x, p.y, 10, '#e8c34a', MUZZLE_FX);
    },
    tick(run, p, ctx, dt) {
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
        H.particles.burst(p.x, p.y, 14, '#e8c34a', SMOKE_FX);
        H.audio.play('explode');
        ctx.t = 6;
        if (!ctx.puddle) { ctx.t = 0.05; }
        return;
      }
      if (!ctx.puddle.active) { ctx.puddle = null; ctx.t = 0.05; return; }

      // --- does anything fire-based touch the rum? --------------------------
      ctx.checkT -= dt;
      if (ctx.checkT > 0) return;
      ctx.checkT = 0.2;
      const f = ctx.puddle;

      let lit = false;
      if (ctx.s5) {                          // S5: it lights itself
        ctx.igniteT -= 0.2;
        lit = ctx.igniteT <= 0;
      }
      if (!lit) {                            // anything burning standing in it
        IGNITE_HIT = false;
        H.forEachEnemyIn(run, f.x, f.y, f.radius, checkBurning);
        lit = IGNITE_HIT;
      }
      if (!lit) {                            // or any burning ground overlapping it
        const fields = run.hazards.fields.items;
        for (let i = 0; i < run.hazards.fields.count; i++) {
          const g = fields[i];
          if (g === f || g.effect !== H.FIELD.BURN) continue;
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
      H.flash.fire('#ff9a3d', 0.3, 3);
      run.hazards.fields.release(f);
      ctx.puddle = null;
      ctx.t = 0.05;
    },
    end(run, p, ctx) {
      ctx.puddle = null;
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

/** AKANE — is anything standing in the rum already on fire? */
let IGNITE_HIT = false;
function checkBurning(e) {
  if (e.st.burnT > 0) { IGNITE_HIT = true; return false; }
  return true;
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
