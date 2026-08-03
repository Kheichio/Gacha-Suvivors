// Enemies: the pooled entity, the 21 behaviour archetypes, and the scaling.
//
// SECTION 9's archetypes are reusable AI FUNCTIONS, not per-enemy code. Adding an
// enemy is a data object; adding an archetype is one entry in BEHAVIORS.
//
// Off-screen enemies (SECTION 1): rendering culled, AI cheapened to movement
// only, and anything drifting more than 1.5 screens away is teleported to the
// far side of the view (DECISIONS.md §19 — of the VIEW, not the arena, which is
// what makes a 4000x4000 bounded arena feel endless). ONE archetype opts out of
// both of those — see `thinksOffscreen`.

import { CONFIG } from '../core/config.js';
import { Pool } from '../core/pool.js';
import { runRng } from '../core/rng.js';
import { feel } from '../core/feel.js';
import { atlas } from '../render/spriteAtlas.js';
import { particles } from '../render/particles.js';
import { events, EV } from '../core/events.js';
import {
  clamp, dirTo, normalize, V, dist2, TAU, angleDelta, rotateToward, lerp,
} from '../core/math.js';
import {
  makeStatus, clearStatus, tickStatus, isStunned, speedMultiplier, MARK,
  applyHaste, applyEmpower,
} from './statusEffects.js';
import { dealDamage, damagePlayer, areaDamage, SRC } from './damage.js';
import { SCALING } from '../data/stages.js';

/**
 * Per-SYSTEM, not per-module.
 *
 * `e.uid` is not just an identity: three behaviours read it as a seed —
 * the swarmer's wobble phase (`sin(aiT * 3.2 + e.uid)`), and the orbiter's and
 * ambusher's rotation direction (`e.uid & 1`). A module-level counter that
 * never resets meant the SECOND run in a process got a different swarm and a
 * different set of orbit directions from the first, on the same seed. That made
 * `node sim.js --all` measure a different game for every character after the
 * first — the same character on the same seed ranged from 185s to 307s — and
 * every number in BALANCE.md with it.
 */
let uidCounter = 1;

export function makeEnemy() {
  return {
    active: false, _i: 0, uid: 0,
    def: null, id: '',
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    kbx: 0, kby: 0,                       // knockback impulse, decays
    hp: 0, maxHp: 0, armor: 0, weight: 1,
    // `baseDamage` is the statline; `damage` is what it hits for THIS tick. The
    // two only differ while something is empowering it — which nothing could do
    // before the Conductor, because `empower` was a player-only status and an
    // enemy's contact damage was read straight off the spawn-time number.
    damage: 0, baseDamage: 0, speed: 0, baseSpeed: 0,
    xp: 0, goldChance: 0,
    radius: 12, size: 'small',
    element: 'spirit',
    behavior: 'chaser',
    facing: 0, facingTarget: 0,
    visual: null, sprite: null,
    flashT: 0, lastHitAt: 0, lastLineStamp: 0,
    dying: false,
    isElite: false, isBoss: false, isMidBoss: false, isMinionTarget: false,
    knockbackImmune: false,
    shieldArc: 0, shieldReduction: 0,
    contactCd: 0,                         // per-enemy 0.5s contact tick
    st: makeStatus(),
    // behaviour scratch — every archetype reuses these three, so no archetype
    // ever needs to allocate a state object
    aiT: 0, aiT2: 0, aiState: 0,
    aiX: 0, aiY: 0, aiF: 0,
    /**
     * WHICH WAY ROUND THE THING IN FRONT OF ME, AND FOR HOW LONG.
     *
     * Owned by ObstacleField.steer, which is the only reader and the only
     * writer. `avoidSide` is +1/-1 (a rotation sense around the piece, not a
     * compass direction), `avoidT` counts the commitment down, `avoidKey`
     * identifies the piece by position so the commitment lapses when the mob
     * meets a different one.
     *
     * Three numbers, not a nested object: this template is preallocated
     * CONFIG.MAX_ENEMIES (2,200) times and steer() runs on every one of them
     * every tick. They MUST be reset in spawn() — a recycled slot that kept a
     * dead mob's committed side sends a fresh one the long way round a block it
     * has never seen.
     */
    avoidSide: 0, avoidT: 0, avoidKey: 0,
    params: null,
    affixes: null, affixT: 0, affixT2: 0,
    spawnT: 0,                            // spawn-in telegraph / fade
    offscreen: false,
    /**
     * Keep thinking, and never get recycled, while out of view.
     *
     * The default is the opposite for very good reasons — two thousand enemies
     * cannot each run a state machine you are not looking at. But the Strafer's
     * entire attack HAPPENS out there: it withdraws past the edge, lines up, and
     * comes back down a telegraphed lane. Under the normal rules it would freeze
     * into a plain chaser the instant it left the screen and then be teleported
     * to a random bearing, which is precisely the two things it must not do.
     * Set from the archetype at spawn so the hot loop reads a boolean, not a
     * string.
     */
    thinksOffscreen: false,
    tier: 1,
    hpBarT: 0,
    // boss-only, present on every enemy so the shape never changes
    phase: 0, attackCd: 0, currentAttack: null, attackT: 0, bossDef: null,
    parts: null, partHp: null,
  };
}

function resetEnemy(e) {
  e.def = null; e.visual = null; e.sprite = null; e.params = null;
  e.affixes = null; e.bossDef = null; e.currentAttack = null;
  e.parts = null; e.partHp = null;
  clearStatus(e.st);
  e.dying = false;
  e.isElite = false; e.isBoss = false; e.isMidBoss = false;
  e.shieldArc = 0; e.shieldReduction = 0;
  e.knockbackImmune = false;
  e.thinksOffscreen = false;
  e.kbx = 0; e.kby = 0;
  e.hpBarT = 0;
  e.phase = 0;
}

// --- scaling (SECTION 8) -----------------------------------------------------
export function scaledHp(base, minutes, difficultyMult, stageMult) {
  return base * (1 + SCALING.hp * minutes) * difficultyMult * stageMult;
}
export function scaledDamage(base, minutes, difficultyMult) {
  return base * (1 + SCALING.damage * minutes) * difficultyMult;
}
export function scaledSpeed(base, minutes, difficultyMult) {
  return base * Math.min(SCALING.speedCap, 1 + SCALING.speed * minutes) * difficultyMult;
}
export function scaledXp(base, minutes) {
  return base * (1 + SCALING.xp * minutes);
}

export class EnemySystem {
  constructor(run) {
    this.run = run;
    this.pool = new Pool(makeEnemy, resetEnemy, 512, CONFIG.MAX_ENEMIES, true);
    this.splitBudget = CONFIG.SPLIT_BUDGET_PER_RUN;
    // Restarts with the run. See the comment on uidCounter.
    this._nextUid = uidCounter;
    /**
     * LIVE POPULATION PER ENEMY ID.
     *
     * Every enemy in the game — wave events, the baseline trickle, summoners,
     * splitters, the Splitting affix, stage events — is born in `spawn()`, so
     * one Map maintained here is the whole of `params.maxAlive`. Per-run, never
     * module-level: the determinism suite replays a seed after an intervening
     * run and would catch that immediately.
     */
    this._alive = new Map();
    /**
     * THE BROADPHASE MARGIN, SIZED TO WHAT IS ACTUALLY ALIVE.
     *
     * Every hit test in the game is `hash.query(x, y, r + pad)` followed by an
     * exact test against `r + e.radius`, so the pad must cover the largest
     * radius on the field or big targets silently stop being hittable — with no
     * error anywhere. It used to be the constant 140, which cost a screen of
     * 8px fodder a 320x320px gather per projectile and STILL did not cover a
     * 150-radius boss. Recomputed once per tick in `refreshQueryPad`, and
     * raised on the spot by anything that grows a radius mid-tick.
     */
    this.queryPad = CONFIG.HIT_QUERY_PAD;
  }

  /**
   * O(n) over the array the spatial hash was just built from. Called from
   * run.update immediately after `enemyHash.build`, before anything queries it.
   * ~800 property reads, under 0.003ms — against 0.29ms saved on the projectile
   * broadphase alone at horde density.
   */
  refreshQueryPad() {
    const items = this.pool.items;
    let m = 0;
    for (let i = 0; i < this.pool.count; i++) {
      const r = items[i].radius;
      if (r > m) m = r;
    }
    m += CONFIG.BROADPHASE_SLACK;
    this.queryPad = m < CONFIG.BROADPHASE_MIN_PAD ? CONFIG.BROADPHASE_MIN_PAD : m;
  }

  /**
   * Raise the pad for an enemy whose radius grew after `spawn` returned — the
   * elite 1.35x in run.spawnElite and the raw boss radius in boss.js. The pad
   * only ever moves UP here; the per-tick refresh is what brings it back down.
   */
  noteRadius(e) {
    const want = e.radius + CONFIG.BROADPHASE_SLACK;
    if (want > this.queryPad) this.queryPad = want;
  }

  get items() { return this.pool.items; }
  get count() { return this.pool.count; }

  /**
   * @param def    an entry from data/enemies.js (or data/bosses.js)
   * @param opts   {isElite, isBoss, isMidBoss, affixes, hpMult, speedMult, scale}
   */
  spawn(def, x, y, opts) {
    if (this.run.totalEntities() >= CONFIG.MAX_ENTITIES) return null;
    // CONCURRENCY CAP — `params.maxAlive`, authored in data/enemies.js.
    //
    // Play report: "the quick moving straight line mobs appear too many at once
    // causing lag". The timeline asks for up to 60 of one fast swarm mob at a
    // time (waves.js), and because they outrun the player they all survive to
    // reach him, so the ask and the population are the same number. Refusing
    // the spawn here rather than editing 56 wave rows means the cap is a
    // property of the CREATURE — one number next to its speed, honoured by the
    // wave director, the trickle, summoners and the Splitting affix alike.
    //
    // A refusal is not an error: `_spawnBatch` already stops on a null and the
    // spread-spawn entry expires on its own timer, so nothing spins.
    const cap = def.params ? def.params.maxAlive : 0;
    if (cap > 0 && (this._alive.get(def.id) || 0) >= cap) return null;
    const e = this.pool.spawn();
    if (!e) return null;
    const o = opts || EMPTY;
    const run = this.run;
    const minutes = run.time / 60;

    e.uid = this._nextUid++;
    e.def = def; e.id = def.id;
    e.x = e.px = x; e.y = e.py = y;
    e.vx = 0; e.vy = 0; e.kbx = 0; e.kby = 0;
    e.behavior = def.behavior || 'chaser';
    e.thinksOffscreen = e.behavior === 'strafer';
    e.params = def.params || EMPTY;
    e.size = def.size || 'small';
    e.element = def.element || 'spirit';
    e.tier = def.tier || 1;
    e.visual = def.visual;
    e.sprite = atlas.ensure(def.visual);
    e.radius = (def.visual && def.visual.size ? def.visual.size : 12) *
               (o.scale || 1) * feel.enemySizeMult;
    e.weight = def.weight || 1;
    e.goldChance = def.goldChance || 0;
    e.isElite = !!o.isElite;
    e.isBoss = !!o.isBoss;
    e.isMidBoss = !!o.isMidBoss;
    e.dying = false;
    e.contactCd = 0;
    e.aiT = runRng.range(0, 1); e.aiT2 = 0; e.aiState = 0;
    e.aiX = 0; e.aiY = 0; e.aiF = 0;
    // Steering commitment. Cleared with the rest of the behaviour scratch and
    // deliberately WITHOUT touching runRng: steer's only tiebreak is `uid & 1`
    // precisely so a replayed seed routes the horde identically.
    // Steering commitment. Cleared with the rest of the behaviour scratch and
    // deliberately WITHOUT touching runRng: steer's only tiebreak is `uid & 1`
    // precisely so a replayed seed routes the horde identically.
    e.avoidSide = 0; e.avoidT = 0; e.avoidKey = 0;
    e.flashT = 0;
    e.facing = e.facingTarget = runRng.angle();
    e.spawnT = o.telegraph || 0;
    e.phase = 0; e.attackCd = 1.2; e.attackT = 0; e.currentAttack = null;
    e.bossDef = (o.isBoss || o.isMidBoss) ? def : null;
    clearStatus(e.st);

    const dm = run.difficultyMult;
    const sm = run.stage.hpMult || 1;
    let hp = scaledHp(def.hp, minutes, dm.hp, sm) * (o.hpMult || 1);
    if (o.isElite) hp *= 8;                                   // SECTION 9
    // "Titan's Shadow": LARGE enemies +100% HP but 3x XP.
    if (run.modifier && run.modifier.params.largeHpMult && e.size === 'large') {
      hp *= run.modifier.params.largeHpMult;
    }
    if (run.modifier && run.modifier.params.hpMult) hp *= run.modifier.params.hpMult;
    e.hp = e.maxHp = hp;

    e.damage = scaledDamage(def.damage, minutes, dm.damage);
    e.baseSpeed = scaledSpeed(def.speed, minutes, dm.speed) * (o.speedMult || 1);
    if (run.modifier && run.modifier.params.enemySpeedMult) e.baseSpeed *= run.modifier.params.enemySpeedMult;
    e.speed = e.baseSpeed;
    e.armor = def.armor || 0;

    let xp = scaledXp(def.xp || 1, minutes);
    if (run.modifier && run.modifier.params.largeXpMult && e.size === 'large') xp *= run.modifier.params.largeXpMult;
    if (o.isElite) xp *= 6;
    e.xp = xp;

    if (e.behavior === 'shielder') {
      e.shieldArc = e.params.shieldArc || 1.6;
      e.shieldReduction = e.params.shieldReduction || 0.9;
    } else if (e.behavior === 'tethered') {
      // The ward reuses the shielder's directional-mitigation path with the arc
      // opened to the full circle — a ward has no front, and rather than add a
      // second mitigation branch to damage.js (the one file every hit in the
      // game passes through) the archetype simply sets `shieldArc` to TAU while
      // the ward is up and back to 0 when it drops. The reduction is fixed here;
      // the arc is owned by the behaviour because it is the state.
      e.shieldReduction = e.params.wardReduction || 0.92;
    }
    if (e.size === 'large' || o.isBoss) e.knockbackImmune = o.isBoss || false;

    // affixes
    e.affixes = o.affixes || null;
    if (e.affixes) {
      for (const a of e.affixes) {
        if (a.id === 'colossal') { e.radius *= 2; e.damage *= 2; e.knockbackImmune = true; }
        if (a.id === 'frenzied') e.aiF = 0;
      }
    }
    // AFTER the affixes, deliberately: Colossal's doubling is part of the
    // statline this enemy actually has, and snapshotting before it would have
    // the first Conductor pulse quietly undo it.
    e.baseDamage = e.damage;

    // After the affixes too: `colossal` doubles the radius, and the broadphase
    // pad has to know about the doubled one, not the statline one.
    this._alive.set(def.id, (this._alive.get(def.id) || 0) + 1);
    this.noteRadius(e);

    events.emit(EV.ENEMY_SPAWNED, e);
    return e;
  }

  release(e) {
    // The population counter has to be decremented HERE and not in the pool,
    // because `clear()` bypasses release entirely. `pool.release` no-ops on an
    // already-dead slot, so the `active` guard is what keeps a double release
    // from driving the count negative.
    if (e.active) {
      const n = this._alive.get(e.id);
      if (n > 0) this._alive.set(e.id, n - 1);
    }
    this.pool.release(e);
  }
  clear() {
    this.pool.clear();
    this._alive.clear();
    this.queryPad = CONFIG.HIT_QUERY_PAD;
    this.splitBudget = CONFIG.SPLIT_BUDGET_PER_RUN;
  }

  update(dt) {
    const run = this.run;
    const p = run.player;
    const items = this.pool.items;
    const cullX = run.camera.viewHalfW(0) * CONFIG.CULL_SCREENS;
    const cullY = run.camera.viewHalfH(0) * CONFIG.CULL_SCREENS;
    const viewX = run.camera.viewHalfW(120);
    const viewY = run.camera.viewHalfH(120);

    for (let i = 0; i < this.pool.count; i++) {
      const e = items[i];
      e.px = e.x; e.py = e.y;

      // spawn telegraph — enemy exists but is inert and drawn as a warning
      if (e.spawnT > 0) {
        e.spawnT -= dt;
        continue;
      }

      // --- status ------------------------------------------------------------
      const dot = tickStatus(e.st, dt, e.maxHp);
      if (dot > 0) {
        dealDamage(run, e, dot, SRC.DOT, { canCrit: false, knockback: 0, noNumber: run.enemies.count > 260 });
        if (!e.active || e.hp <= 0) { i--; continue; }
      }
      if (e.flashT > 0) e.flashT -= dt;
      if (e.hpBarT > 0) e.hpBarT -= dt;

      // "Demon Moon": enemies regenerate 1% max HP/s — unless Sunlight is on them.
      if (run.modifier && run.modifier.params.regenPerSec && e.st.noRegenT <= 0 && e.hp > 0) {
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * run.modifier.params.regenPerSec * dt);
      }

      // --- offscreen handling ------------------------------------------------
      const dx = e.x - p.x, dy = e.y - p.y;
      e.offscreen = Math.abs(dx) > viewX || Math.abs(dy) > viewY;
      if (Math.abs(dx) > cullX || Math.abs(dy) > cullY) {
        if (e.isBoss || e.isMidBoss || e.isElite) {
          // Bosses never get recycled — they walk back instead.
          this._moveToward(e, p.x, p.y, dt, 1.6);
          continue;
        }
        // A Strafer that has withdrawn is exactly where it is supposed to be.
        // Recycling it would drop it back in at a random bearing with a
        // telegraphed lane already drawn somewhere else entirely.
        if (!e.thinksOffscreen) { this._recycle(e, p, viewX, viewY); continue; }
      }

      // --- knockback ---------------------------------------------------------
      if (e.kbx !== 0 || e.kby !== 0) {
        e.x += e.kbx * dt;
        e.y += e.kby * dt;
        const d = 1 - feel.knockbackDecay * dt;
        e.kbx *= d > 0 ? d : 0;
        e.kby *= d > 0 ? d : 0;
        if (Math.abs(e.kbx) < 3) e.kbx = 0;
        if (Math.abs(e.kby) < 3) e.kby = 0;
      }

      if (isStunned(e.st)) { continue; }

      e.speed = e.baseSpeed * speedMultiplier(e.st);
      // Frenzied affix: +80% move speed below 50% HP.
      if (e.affixes && e.hp < e.maxHp * 0.5) {
        for (const a of e.affixes) if (a.id === 'frenzied') { e.speed *= 1.8; break; }
      }
      // Empower on an enemy. Every attack in this file reads `e.damage` —
      // contact, slams, blasts, projectiles — so recomputing it from the
      // statline once per tick is the whole of the Conductor's damage buff, and
      // it costs one compare on every enemy that is not being buffed.
      e.damage = e.st.empowerT > 0 ? e.baseDamage * e.st.empowerMult : e.baseDamage;

      // --- pull (chum bucket, iron sand, whirlpool) --------------------------
      if (e.st.pullT > 0 && e.st.pullForce > 0) {
        if (dirTo(e.x, e.y, e.st.pullX, e.st.pullY) > 4) {
          e.x += V.x * e.st.pullForce * dt;
          e.y += V.y * e.st.pullForce * dt;
        }
      }

      // --- behaviour ---------------------------------------------------------
      if (e.offscreen && !e.thinksOffscreen) {
        // Cheapened update: movement only, no AI targeting, no attacks.
        this._moveToward(e, p.x, p.y, dt, 1.0);
      } else {
        const fn = e.isBoss || e.isMidBoss ? null : BEHAVIORS[e.behavior];
        if (fn) fn(e, run, p, dt, this);
        else if (!e.isBoss && !e.isMidBoss) BEHAVIORS.chaser(e, run, p, dt, this);
      }

      // --- separation (SECTION 3: readable blobs, not a conga line) ----------
      if (!e.offscreen && !e.isBoss && e.behavior !== 'static') {
        this._separate(e, dt);
      }

      // --- obstacles ---------------------------------------------------------
      // OFF-SCREEN MOBS ARE STEERED TOO, BUT ONLY WHERE THE GEOMETRY EARNS IT.
      //
      // Skipping steer() off screen is the same economy as the cheapened AI
      // above and it is correct for scattered rubble: nothing out there can bury
      // a mob deeper than a body-length, so the correction it gets on the frame
      // it reappears is invisible. It is wrong the moment a single piece is
      // deeper than the off-screen band is tall — `viewY` here is 480px at every
      // resolution (BASE_H/2 + 120), and a stage whose blocks are 1000px square
      // hides a mob's ENTIRE transit of one. It walks in unseen, and the tick it
      // crosses into view the hard-resolve teleports it half a block sideways.
      //
      // `deepest` is geometry, measured by the field itself — never a stage id,
      // which would be a special case pretending to be a rule. Six of the seven
      // sets are nowhere near 480 and pay nothing but this compare.
      if (run.obstacles.count > 0 && (!e.offscreen || run.obstacles.deepest > viewY)) {
        run.obstacles.steer(e, dt);
      }

      // --- arena bounds ------------------------------------------------------
      const b = run.bounds;
      if (e.x < b.minX) { e.x = b.minX; e.vx = Math.abs(e.vx); }
      else if (e.x > b.maxX) { e.x = b.maxX; e.vx = -Math.abs(e.vx); }
      if (e.y < b.minY) { e.y = b.minY; e.vy = Math.abs(e.vy); }
      else if (e.y > b.maxY) { e.y = b.maxY; e.vy = -Math.abs(e.vy); }

      // --- contact damage ----------------------------------------------------
      if (e.contactCd > 0) e.contactCd -= dt;
      if (!e.isBoss && !e.isMidBoss && e.contactCd <= 0 && !e.offscreen) {
        const r = e.radius + feel.playerHitRadius;
        if (dist2(e.x, e.y, p.x, p.y) < r * r && p.st.intangibleT <= 0) {
          damagePlayer(run, e.damage, SRC.CONTACT, { attacker: e, fromX: e.x, fromY: e.y });
          e.contactCd = feel.contactCooldown;
        }
      }

      // --- affix behaviour ---------------------------------------------------
      if (e.affixes) this._tickAffixes(e, run, p, dt);

      if (!e.active) i--;
    }
  }

  _recycle(e, p, viewX, viewY) {
    // Teleport to just off the opposite edge of the VIEW, keeping pressure up
    // without the player ever seeing a pop-in.
    const a = runRng.angle();
    const rx = viewX * 1.05, ry = viewY * 1.05;
    e.x = p.x + Math.cos(a) * rx;
    e.y = p.y + Math.sin(a) * ry;
    e.kbx = 0; e.kby = 0;
    const b = this.run.bounds;
    e.x = clamp(e.x, b.minX, b.maxX);
    e.y = clamp(e.y, b.minY, b.maxY);
    /**
     * NOT INSIDE A BUILDING. `waveDirector._spawnBatch` already guards its own
     * placement this way and says why; the recycle path fires far more often and
     * was missed. The ellipse this lands on is 798x504 around the player, and on
     * a city-block stage a large share of it is solid: Akihabara's four blocks
     * occupy x and y [600,1600] and [2400,3400], which is a quarter of the
     * arena. A mob dropped in the middle of one has nothing pushing it out until
     * it drifts on screen, and then pops 516px sideways in a single tick.
     *
     * pushOut's tier-2 relaxation exits a box along its shallower axis in one
     * push, so even dead centre of a 1000px block is one pass, not a ring walk.
     */
    if (this.run.obstacles.count > 0 &&
        this.run.obstacles.pushOut(e.x, e.y, e.radius, FREE)) {
      e.x = FREE.x; e.y = FREE.y;
    }
    // AFTER the correction, not before: px/py are the render's interpolation
    // anchors and a teleport they did not see becomes a 500px smear.
    e.px = e.x; e.py = e.y;
    // A fresh position is a fresh problem — the piece it was rounding is now
    // half a screen away.
    e.avoidSide = 0; e.avoidT = 0; e.avoidKey = 0;
  }

  _moveToward(e, tx, ty, dt, mult) {
    if (dirTo(e.x, e.y, tx, ty) > 1) {
      const s = e.speed * (mult || 1) * dt;
      e.x += V.x * s;
      e.y += V.y * s;
      e.vx = V.x * e.speed; e.vy = V.y * e.speed;
      e.facingTarget = Math.atan2(V.y, V.x);
    }
  }

  /**
   * Soft separation. Sampled, not exhaustive — 6 neighbours is plenty.
   *
   * The sampling now happens where the candidates live. This used to call
   * `hash.query`, which writes every index in the covered cells into the result
   * buffer before this function reads the first one, and then stopped after six
   * — so on a spread-out field it was free and inside a fifty-strong pack it
   * was tens of thousands of wasted writes per tick. `separationPush` walks the
   * same cells in the same order with the same tests and stops at six; the
   * displacement is identical and the cost no longer grows with the crowd.
   */
  _separate(e, dt) {
    const rad = feel.separationRadius + e.radius * 0.5;
    const c = this.run.enemyHash.separationPush(
      this.pool.items, e, rad, SEPARATION_SAMPLES, SEP);
    if (c > 0) {
      const f = feel.separationForce * dt / c;
      e.x += SEP.x * f;
      e.y += SEP.y * f;
    }
  }

  _tickAffixes(e, run, p, dt) {
    e.affixT -= dt;
    for (let i = 0; i < e.affixes.length; i++) {
      const a = e.affixes[i];
      switch (a.id) {
        case 'splitting':
          if (e.affixT <= 0) {
            const child = run.data.enemies.ENEMIES_BY_TIER[1];
            for (let k = 0; k < (a.params.count || 4) && this.splitBudget > 0; k++) {
              const def = run.data.enemies.ENEMIES_BY_ID[runRng.pick(child)];
              if (def) {
                this.spawn(def, e.x + runRng.signed() * 30, e.y + runRng.signed() * 30);
                this.splitBudget--;
              }
            }
            e.affixT = a.params.interval || 5;
          }
          break;
        case 'chilling':
          if (e.affixT <= 0) {
            run.hazards.spawnField(e.x, e.y, 46, 2.5, 'chill');
            e.affixT = 0.5;
          }
          break;
      }
    }
    if (e.affixT <= 0) e.affixT = 0.5;
  }

  /** Called from damage.js via run.onEnemyDeath. Splitters and Volatile live here. */
  onDeath(e, src) {
    const run = this.run;

    if (e.affixes) {
      for (const a of e.affixes) {
        if (a.id === 'volatile') {
          areaDamage(run, e.x, e.y, a.params.radius || 200, a.params.damage || 120,
                     SRC.HAZARD, { falloff: 0.4, canCrit: false });
          particles.ring(e.x, e.y, 20, '#ff6b3d', 380);
        }
      }
    }

    // splitter archetype
    if (e.behavior === 'splitter' && e.params.splitInto && this.splitBudget > 0) {
      const def = run.data.enemies.ENEMIES_BY_ID[e.params.splitInto];
      const n = e.params.splitCount || 2;
      if (def) {
        for (let i = 0; i < n && this.splitBudget > 0; i++) {
          const a = (i / n) * TAU + runRng.raw();
          const c = this.spawn(def, e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 18);
          if (c) { c.kbx = Math.cos(a) * 160; c.kby = Math.sin(a) * 160; this.splitBudget--; }
        }
      }
    }

    // exploder archetype detonates whether it died to you or to its own fuse
    if (e.behavior === 'exploder' && e.aiState === 1) {
      enemyBlast(run, e.x, e.y, e.params.blastRadius || 90, e.damage * 2);
    }

    this.release(e);
  }

  draw(r, alpha) {
    const items = this.pool.items;
    const run = this.run;
    for (let i = 0; i < this.pool.count; i++) {
      const e = items[i];
      const x = e.px + (e.x - e.px) * alpha;
      const y = e.py + (e.y - e.py) * alpha;

      if (e.spawnT > 0) {
        // Ambush telegraph — a shrinking ring where the enemy will land.
        const t = 1 - e.spawnT / (e.def.params && e.def.params.telegraph || feel.telegraphAmbush);
        r.strokeCircle(x, y, e.radius * (2.4 - t * 1.4), '#ffd23f', 3, 0.5 + t * 0.4);
        continue;
      }

      // Sprites are built around a 14px reference radius; scaling by the raw
      // hitbox radius made a 9px fodder enemy render at two-thirds size against
      // the player. Enemies are people too — they should read at roughly the
      // player's scale, with size class stepping up from there.
      //
      // `enemyDrawScale` then lifts the whole family: even at parity with the
      // player a rank-and-file enemy was too small to pick out of a horde of
      // two hundred. The ceiling moved with it, because bosses were already
      // pinned at the old 2.6 and would otherwise have stopped growing while
      // everything else caught up to them.
      // `sprite.unit` cancels the atlas's integer-upscale rounding, so a mob's
      // on-screen size follows its declared size and its hitbox rather than
      // whichever side of 0.5 its grid happened to land on. Small fodder gains
      // the most from that, which is exactly the class that read too small.
      const scale = e.sprite.unit * clamp(e.radius / 14, 0.85, 2.6) * feel.enemyDrawScale;
      // WALK OR IDLE, offset per entity so a pack does not march in lockstep.
      // `e.uid * 0.37` is the same phase the bob has always used.
      //
      // The speed comes in as the SQUARED interpolation delta, which is two
      // subtracts and two multiplies that the two lines above already paid for.
      // Not `e.vx`: `_moveToward` maintains it but the `ranged` back-off below
      // (line 640) and the ambusher's teleports write `e.x` directly and leave
      // `e.vx` stale, so a strafing enemy would moonwalk.
      const dxv = e.x - e.px, dyv = e.y - e.py;
      const anim = e.sprite.animIndexFor(run.time, dxv * dxv + dyv * dyv, e.uid * 0.37);
      r.drawSprite(e.sprite, x, y, e.behavior === 'ranged' || e.isBoss ? e.facing : 0,
                   scale, 1, e.flashT > 0, anim);

      if (e.isElite || e.isBoss || e.isMidBoss) {
        // Gold outline + health bar + name plate (SECTION 9).
        r.strokeCircle(x, y, e.radius + 4, '#ffd76a', 2.5, 0.9);
      }

      // THE WARD. A `tethered` mob takes 92% less damage while a neighbour is
      // propping it up, and "your damage does almost nothing" has to be drawn or
      // it reads as a bug in the damage numbers rather than as a rule. So: a
      // ring on the warded mob and a line to whichever enemy is currently
      // holding it. Kill along the line, or drag the fight away from it.
      // The numeric test comes first deliberately — it is one compare that fails
      // for every one of the two thousand things that are not this.
      if (e.aiF === 1 && e.behavior === 'tethered') {
        const c = e.visual.accent || '#8ce8ff';
        r.drawLine(x, y, e.aiX, e.aiY, c, 2, 0.45);
        r.strokeCircle(x, y, e.radius + 5, c, 2, 0.8);
      }
    }
    r.setAlpha(1);
  }
}

/**
 * AN ENEMY'S AREA ATTACK — everything in the blast, INCLUDING THE PLAYER.
 *
 * `areaDamage` walks the enemy spatial hash and nothing else. That is exactly
 * right for the player's novas and exactly wrong for an enemy's, and every enemy
 * explosion in this file used to call it on its own: the Jellyfish Chorus
 * detonated for 22 into an empty room, the Oni Bruiser's slam only ever hurt
 * other oni, the Drowned Roadie's flight case landed on nobody, and a floor
 * carpeted in Trap Scrolls was completely safe to stand on. Four of the loudest,
 * reddest, most telegraphed attacks in the game did nothing whatsoever to the
 * one thing they were aimed at, and because a telegraph still drew and particles
 * still burst, it read as a balance problem rather than a missing call.
 *
 * game/hazards.js had the other half of this the whole time — `dropRubble` does
 * the area damage AND the player check — which is why the collapsing walls were
 * the only enemy-side AoE in the game that ever landed on anyone.
 *
 * The enemy-side damage keeps going out too. It is what the Jellyfish's chain
 * has always been built on, and taking it away would change the kill economy of
 * three stages for a fix that is about the player's half of the blast.
 */
function enemyBlast(run, x, y, radius, amount) {
  areaDamage(run, x, y, radius, amount, SRC.HAZARD, BLAST_OPTS);
  const p = run.player;
  const r = radius + feel.playerHitRadius;
  const d2 = dist2(x, y, p.x, p.y);
  if (d2 > r * r) return;
  // Same falloff the enemy side got, so standing at the lip of a telegraph is
  // meaningfully better than standing on the mark.
  const t = Math.sqrt(d2) / Math.max(1, radius);
  BLAST_HIT.fromX = x; BLAST_HIT.fromY = y;
  damagePlayer(run, amount * (1 - BLAST_OPTS.falloff * clamp(t, 0, 1)), SRC.HAZARD, BLAST_HIT);
}

/** Module-level, per house rule: a blast is not allowed to allocate its own bag. */
const BLAST_OPTS = { falloff: 0.4, canCrit: false };
/** Reused record in the shape of `lastHit` — read synchronously, never stored. */
const BLAST_HIT = { fromX: 0, fromY: 0 };

// --- the 21 behaviour archetypes --------------------------------------------
// Every one is a pure function of (enemy, run, player, dt, system). None of them
// allocates, and none of them knows which enemy id it is driving.
//
// DECISIONS.md §6 fixed the list at 15 because that was every archetype SECTION 9
// implied plus the two it used without defining. Play report: "make more unique
// mobs ... different ability types ... so that the gameplay feels more different
// and more challenging specifically for the later levels." Six more, and every
// one of them exists to pose a QUESTION the first fifteen never asked:
//
//   mortar      you are not safe at range, and standing where you are standing
//               is a decision with a timer on it
//   sower       the floor is a resource and it is being spent
//   conductor   the crowd is only this fast because something in it is
//   watcher     "hold this corner and out-DPS it" stops working
//   tethered    this one cannot be killed until you have dealt with the others
//   strafer     the danger is not on screen yet
//
// Every one of them telegraphs, without exception (game/hazards.js header): the
// mortar and the watcher draw a red circle, the strafer draws a yellow lane, the
// sower's ground is permanently visible, and neither the conductor nor the
// tethered mob deals damage of its own at all.

/**
 * PASS-THROUGH — the shared half of `chaser` and `swarmer`, and the answer to
 * "make them go at the player quicker so they don't stack on top of each other".
 *
 * Everything in this file steers at the player's exact position on every tick,
 * forever. For a mob that is SLOWER than the player that is fine: it never
 * arrives, so it never has to leave. For the fast ones — 124 to 145 base speed
 * against the player's 165, which SECTION 8's speed scaling passes inside four
 * minutes — it is a design bug wearing a performance bug's clothes. They arrive,
 * they have nowhere to go, `_separate` packs them into a shell, and the shell
 * thickens for the rest of the run. That pile is what makes every broadphase
 * query in the game return ten times as many candidates: the SAME 900 enemies
 * cost 2.42ms a tick spread out and 4.68ms piled on the player.
 *
 * So inside `passLock` they COMMIT: heading locked, speed up, run straight
 * through and out the far side, then wheel around. A pass is one or two contact
 * ticks instead of a permanent attachment, the pack sweeps across the screen the
 * way a shoal does, and the crowd stops being a static wall to path through.
 *
 * Entirely data-gated on `params.passLock`, so every mob that does not declare
 * it is byte-for-byte the enemy it was. Uses aiState/aiT2/aiF — never aiT, which
 * the swarmer's wobble phase owns.
 *
 * @returns true if it moved the enemy this tick and the caller must not.
 */
function passThrough(e, p, dt, sys) {
  const lock = e.params.passLock;
  if (!lock) return false;
  if (e.aiState === 1) {                      // committed: run the locked heading
    e.aiT2 -= dt;
    const s = e.speed * (e.params.passSpeed || 1.6) * dt;
    e.x += Math.cos(e.aiF) * s;
    e.y += Math.sin(e.aiF) * s;
    e.facingTarget = e.aiF;
    if (e.aiT2 <= 0) { e.aiState = 2; e.aiT2 = e.params.passRecover || 0.35; }
    return true;
  }
  if (e.aiState === 2) {                      // wheel around before the next pass
    e.aiT2 -= dt;
    sys._moveToward(e, p.x, p.y, dt, 0.45);
    if (e.aiT2 <= 0) e.aiState = 0;
    return true;
  }
  if (dist2(e.x, e.y, p.x, p.y) < lock * lock) {
    e.aiState = 1;
    e.aiT2 = e.params.passTime || 0.55;
    e.aiF = Math.atan2(p.y - e.y, p.x - e.x);
    return true;
  }
  return false;
}

const BEHAVIORS = {
  chaser(e, run, p, dt, sys) {
    if (passThrough(e, p, dt, sys)) return;
    sys._moveToward(e, p.x, p.y, dt, 1);
  },

  swarmer(e, run, p, dt, sys) {
    // Chaser plus a gentle sine weave, so a pack reads as a shoal not a line.
    e.aiT += dt;
    if (passThrough(e, p, dt, sys)) return;
    const wobble = Math.sin(e.aiT * 3.2 + e.uid) * 0.35;
    if (dirTo(e.x, e.y, p.x, p.y) > 1) {
      const a = Math.atan2(V.y, V.x) + wobble;
      const s = e.speed * dt;
      e.x += Math.cos(a) * s;
      e.y += Math.sin(a) * s;
      e.facingTarget = a;
    }
  },

  charger(e, run, p, dt, sys) {
    const telegraph = e.params.telegraph || feel.telegraphCharge;
    const dashSpeed = e.params.dashSpeed || 240;
    const dashTime = e.params.dashTime || 0.5;
    switch (e.aiState) {
      case 0: // approach
        sys._moveToward(e, p.x, p.y, dt, 1);
        if (dist2(e.x, e.y, p.x, p.y) < 300 * 300) { e.aiState = 1; e.aiT = telegraph; }
        break;
      case 1: // telegraph — stop dead, so the tell is unmissable
        e.aiT -= dt;
        e.aiX = p.x; e.aiY = p.y;
        e.facingTarget = Math.atan2(p.y - e.y, p.x - e.x);
        if (e.aiT <= 0) { e.aiState = 2; e.aiT = dashTime; e.aiF = e.facingTarget; }
        break;
      case 2: // dash
        e.aiT -= dt;
        e.x += Math.cos(e.aiF) * dashSpeed * dt;
        e.y += Math.sin(e.aiF) * dashSpeed * dt;
        if (e.aiT <= 0) { e.aiState = 3; e.aiT = e.params.recover || 0.7; }
        break;
      default: // recover
        e.aiT -= dt;
        if (e.aiT <= 0) e.aiState = 0;
    }
  },

  ranged(e, run, p, dt, sys) {
    const range = e.params.range || 350;
    const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y));
    if (d > range * 1.15) sys._moveToward(e, p.x, p.y, dt, 1);
    else if (d < range * 0.7) {
      // back off
      if (dirTo(p.x, p.y, e.x, e.y) > 1) { e.x += V.x * e.speed * dt; e.y += V.y * e.speed * dt; }
    } else {
      // strafe, so a wall of shooters does not stand in a perfect arc
      const a = Math.atan2(p.y - e.y, p.x - e.x) + Math.PI / 2 * (e.uid & 1 ? 1 : -1);
      e.x += Math.cos(a) * e.speed * 0.5 * dt;
      e.y += Math.sin(a) * e.speed * 0.5 * dt;
    }
    e.facingTarget = Math.atan2(p.y - e.y, p.x - e.x);
    e.aiT -= dt;
    if (e.aiT <= 0 && d < range * 1.3) {
      e.aiT = e.params.fireInterval || 2.0;
      // data/enemies.js declares these as `projectileCount` and `spreadArc`, and
      // this read them as `projectiles` and `spread`. Both fell through to the
      // `||` default, so the Kunai Bat — whose entire statline is "throws THREE
      // knives in a 0.5 rad fan" — threw one, forever, and nothing anywhere
      // could report it. Both spellings are accepted; the data's wins.
      const n = e.params.projectileCount || e.params.projectiles || 1;
      const spread = e.params.spreadArc || e.params.spread || 0.35;
      for (let i = 0; i < n; i++) {
        const a = e.facingTarget + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0);
        run.enemyProjectiles.spawn(e.x, e.y, a, e.params.projectileSpeed || 240,
                                   e.damage, e.params.projectileLife || 3.2, e);
      }
    }
  },

  exploder(e, run, p, dt, sys) {
    const fuse = e.params.fuse || 3;
    const blast = e.params.blastRadius || 90;
    if (e.aiState === 0) {
      sys._moveToward(e, p.x, p.y, dt, 1.1);
      if (dist2(e.x, e.y, p.x, p.y) < (blast * 0.8) * (blast * 0.8)) {
        e.aiState = 1; e.aiT = fuse * 0.35;
      }
    } else {
      // visible fuse + beep; the enemy stops so the blast is dodgeable
      e.aiT -= dt;
      e.aiT2 += dt;
      if (e.aiT <= 0) {
        // THE BLAST CAN KILL THE EXPLODER ITSELF — through its own self-damage
        // or through a chain — and `release()` nulls `visual` on the pooled
        // slot. Reading `e.visual.color` on the line after the damage therefore
        // threw "Cannot read properties of null" and took the whole run down;
        // on a reef run it landed at around ninety seconds, every time. So the
        // colour and the position are read BEFORE the damage, and the tail
        // checks the slot is still live before it touches `e` again.
        const puff = e.visual ? e.visual.color : '#ff6b3d';
        const bx = e.x, by = e.y;
        enemyBlast(run, e.x, e.y, blast, e.damage * 2);
        particles.ring(bx, by, 16, puff, blast * 3);
        if (!e.active) return;
        // Jellyfish Chorus chains: the blast can set off neighbours.
        if (e.params.chains) {
          const hash = run.enemyHash;
          const items = run.enemies.items;
          const n = hash.query(e.x, e.y, blast);
          for (let k = 0; k < n; k++) {
            const o = items[hash.resultAt(k)];
            if (o && o.active && o !== e && o.behavior === 'exploder' && o.aiState === 0) {
              o.aiState = 1; o.aiT = 0.35;
            }
          }
        }
        e.aiState = 0;
        dealDamage(run, e, e.maxHp * 10, SRC.HAZARD, { canCrit: false, noNumber: true });
      }
    }
  },

  splitter(e, run, p, dt, sys) { sys._moveToward(e, p.x, p.y, dt, 1); },

  orbiter(e, run, p, dt, sys) {
    const rad = e.params.orbitRadius || 120;
    const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y)) || 1;
    const toward = (d - rad) / rad;
    const ang = Math.atan2(p.y - e.y, p.x - e.x);
    const tangent = ang + Math.PI / 2 * (e.uid & 1 ? 1 : -1);
    const s = e.speed * dt;
    e.x += (Math.cos(tangent) * (1 - Math.abs(toward) * 0.5) + Math.cos(ang) * toward) * s;
    e.y += (Math.sin(tangent) * (1 - Math.abs(toward) * 0.5) + Math.sin(ang) * toward) * s;
    e.facingTarget = ang;
  },

  summoner(e, run, p, dt, sys) {
    // Drifts slowly; the threat is the stream of adds, so it stays reachable.
    sys._moveToward(e, p.x, p.y, dt, 0.35);
    e.aiT -= dt;
    if (e.aiT <= 0) {
      e.aiT = e.params.summonInterval || 4;
      const def = run.data.enemies.ENEMIES_BY_ID[e.params.summonId];
      if (def) {
        const n = e.params.summonCount || 4;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          sys.spawn(def, e.x + Math.cos(a) * 34, e.y + Math.sin(a) * 34);
        }
        particles.ring(e.x, e.y, 10, e.visual.color, 180);
      }
    }
  },

  shielder(e, run, p, dt, sys) {
    // DECISIONS.md §31 — the facing lags and the turn rate is capped, so
    // circling faster than 90 deg/s genuinely gets you behind the shield.
    sys._moveToward(e, p.x, p.y, dt, 0.85);
    e.aiT += dt;
    const lag = e.params.facingLag || feel.shielderFacingLag;
    if (e.aiT >= lag) {
      e.aiT = 0;
      e.aiF = Math.atan2(p.y - e.y, p.x - e.x);
    }
    const rate = (e.params.turnRate || feel.shielderTurnRate) * dt;
    e.facing = rotateToward(e.facing, e.aiF, rate);
    e.facingTarget = e.facing;
  },

  dasher(e, run, p, dt, sys) {
    e.aiT -= dt;
    if (e.aiT <= 0) {
      e.aiT = e.params.blinkInterval || 3;
      const d = e.params.blinkDist || 150;
      if (dirTo(e.x, e.y, p.x, p.y) > 1) {
        particles.burst(e.x, e.y, 6, e.visual.color, { speed: 120, life: 0.25 });
        e.x += V.x * d; e.y += V.y * d;
        e.px = e.x; e.py = e.y;
        particles.burst(e.x, e.y, 6, e.visual.color, { speed: 120, life: 0.25 });
      }
    } else {
      sys._moveToward(e, p.x, p.y, dt, 0.55);
    }
  },

  tank(e, run, p, dt, sys) {
    sys._moveToward(e, p.x, p.y, dt, 1);
    // Ground-slam AoE on a timer.
    if (e.params.slamInterval) {
      e.aiT -= dt;
      if (e.aiT <= 0 && dist2(e.x, e.y, p.x, p.y) < 220 * 220) {
        if (e.aiState === 0) {
          e.aiState = 1; e.aiT = feel.telegraphLethal;
          run.hazards.telegraph(e.x, e.y, e.params.slamRadius || 130, e.aiT, 'red', 'circle');
        } else {
          e.aiState = 0; e.aiT = e.params.slamInterval;
          // `slamDamage` is authored as a BASE number sitting next to the
          // enemy's base `damage`, so the only honest way to spend it is as the
          // RATIO between the two — using it raw would hand minute twenty a slam
          // that still hits for 34. It had never been read at all.
          const slamMult = e.params.slamDamage && e.def && e.def.damage
            ? e.params.slamDamage / e.def.damage : 1.6;
          enemyBlast(run, e.x, e.y, e.params.slamRadius || 130, e.damage * slamMult);
          particles.ring(e.x, e.y, 14, '#ff9a3d', 300);
        }
      }
    }
  },

  healer(e, run, p, dt, sys) {
    // Keeps its distance and heals allies — the "kill this first" enemy.
    const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y));
    if (d < 260) { if (dirTo(p.x, p.y, e.x, e.y) > 1) { e.x += V.x * e.speed * dt; e.y += V.y * e.speed * dt; } }
    else sys._moveToward(e, p.x, p.y, dt, 0.5);
    e.aiT -= dt;
    if (e.aiT <= 0) {
      e.aiT = 0.5;
      const rad = e.params.healRadius || 250;
      const amt = (e.params.healRate || 15) * 0.5;
      const hash = run.enemyHash;
      const items = run.enemies.items;
      const n = hash.query(e.x, e.y, rad);
      for (let k = 0; k < n; k++) {
        const o = items[hash.resultAt(k)];
        if (o && o.active && o !== e && o.hp < o.maxHp && o.st.noRegenT <= 0) {
          o.hp = Math.min(o.maxHp, o.hp + amt);
        }
      }
      particles.drift(e.x, e.y, '#7bf59a', { life: 0.6, size: 0.4 });
    }
  },

  leech(e, run, p, dt, sys) {
    if (e.aiState === 0) {
      sys._moveToward(e, p.x, p.y, dt, 1.15);
      const r = e.radius + feel.playerHitRadius;
      if (dist2(e.x, e.y, p.x, p.y) < r * r) {
        e.aiState = 1;
        e.aiX = p.x; e.aiY = p.y;      // where it attached
      }
    } else {
      // Attached: rides the player and drains until shaken off by moving 200px.
      e.x = p.x + Math.cos(e.aiT * 5) * 14;
      e.y = p.y + Math.sin(e.aiT * 5) * 14;
      e.aiT += dt;
      e.aiT2 -= dt;
      if (e.aiT2 <= 0) {
        e.aiT2 = 0.5;
        damagePlayer(run, (e.params.drainRate || 8) * 0.5, SRC.CONTACT, { attacker: e, ignoreIframes: true });
      }
      const shake = e.params.shakeOffDistance || 200;
      if (dist2(e.aiX, e.aiY, p.x, p.y) > shake * shake) {
        e.aiState = 0;
        e.kbx = (e.x - p.x) * 6; e.kby = (e.y - p.y) * 6;
      }
    }
  },

  /** DECISIONS.md §6 — declared by Ceiling Crawler, never defined in the spec. */
  ambusher(e, run, p, dt, sys) {
    // Spawned with a telegraph by the wave director; afterwards it is a fast chaser
    // that re-submerges if you outrun it, then drops on you again.
    e.aiT -= dt;
    if (e.aiState === 0) {
      sys._moveToward(e, p.x, p.y, dt, 1.25);
      if (e.aiT <= 0 && dist2(e.x, e.y, p.x, p.y) > 520 * 520) {
        e.aiState = 1; e.aiT = e.params.telegraph || feel.telegraphAmbush;
        const a = runRng.angle();
        e.aiX = p.x + Math.cos(a) * 140;
        e.aiY = p.y + Math.sin(a) * 140;
      }
    } else {
      if (e.aiT <= 0) {
        e.x = e.aiX; e.y = e.aiY; e.px = e.x; e.py = e.y;
        particles.ring(e.x, e.y, 10, e.visual.color, 200);
        e.aiState = 0; e.aiT = 4;
      }
    }
  },

  /**
   * MORTAR — indirect fire, and the answer to "just stand at max range".
   *
   * A `ranged` mob throws a thing AT you and you sidestep the thing. A mortar
   * throws a thing at where you WILL BE and draws the impact on the floor a full
   * second early, so the dodge is a decision about the next second rather than a
   * reaction to a sprite. It also outranges everything: kiting is not a build,
   * it is a habit, and this is the mob that charges rent on it.
   */
  mortar(e, run, p, dt, sys) {
    const range = e.params.range || 520;
    const d2p = dist2(e.x, e.y, p.x, p.y);
    const near = range * 0.62;
    if (d2p > range * range) sys._moveToward(e, p.x, p.y, dt, 1);
    else if (d2p < near * near) {
      // Backing off is the whole point of the archetype; it never brawls.
      if (dirTo(p.x, p.y, e.x, e.y) > 1) { e.x += V.x * e.speed * dt; e.y += V.y * e.speed * dt; }
    } else {
      const a = Math.atan2(p.y - e.y, p.x - e.x) + Math.PI / 2 * (e.uid & 1 ? 1 : -1);
      e.x += Math.cos(a) * e.speed * 0.45 * dt;
      e.y += Math.sin(a) * e.speed * 0.45 * dt;
    }
    e.facingTarget = Math.atan2(p.y - e.y, p.x - e.x);

    e.aiT -= dt;
    const blast = e.params.blastRadius || 130;
    if (e.aiState === 0) {
      const fire = range * 1.25;
      if (e.aiT <= 0 && d2p < fire * fire) {
        // THREE SHELLS IN THE AIR, ARENA-WIDE, AND NOT ONE MORE.
        // Nothing capped how many mortars could be marking at once, and on
        // Stage 3 twenty of them alive is ordinary — see the note on
        // HazardSystem.requestSalvo() for the count and where it comes from.
        if (!run.hazards.requestSalvo(e.params.salvoSpacing || 0.5)) {
          // Losing the gate must not cost this mortar its turn, or the ones at
          // the back of the pool would starve behind the ones at the front
          // forever. A short retry, jittered off `uid` so the queue rotates
          // deterministically instead of always favouring low pool indices.
          e.aiT = 0.10 + (e.uid & 7) * 0.02;
          return;
        }
        // LEAD THE SHOT. Aiming at the player's feet means a moving player is
        // never hit and a stationary one always is, which is the same enemy
        // twice; leading by half a second means running in a straight line is
        // the thing that gets punished and cutting is the thing that works.
        //
        // SCATTER is the other half of that idea and it was missing. The lead
        // is a pure function of (p, v), so every mortar in range produced a
        // pixel-IDENTICAL mark: ten circles stacked in one hole instead of ten
        // circles covering ground. `scatter` is deliberately smaller than the
        // blast (130 against 145 + 9 of player hitbox), so a player who stands
        // still is still hit and the archetype keeps its entire job — it just
        // is not a guaranteed dead-centre hit any more, and two shells half a
        // second apart now land up to 260px apart instead of on top of each
        // other.
        const lead = e.params.lead || 0.5;
        const sc = e.params.scatter || 120;
        const sa = runRng.angle();
        const sd = runRng.range(sc * 0.45, sc);
        e.aiX = clamp(p.x + p.vx * lead + Math.cos(sa) * sd, run.bounds.minX, run.bounds.maxX);
        e.aiY = clamp(p.y + p.vy * lead + Math.sin(sa) * sd, run.bounds.minY, run.bounds.maxY);
        e.aiState = 1;
        e.aiT = e.params.telegraph || feel.telegraphLethal;
        run.hazards.telegraph(e.aiX, e.aiY, blast, e.aiT, 'red', 'x');
      }
    } else if (e.aiT <= 0) {
      // A shell can land on the thing that fired it — the player kites a mortar
      // backwards into its own impact mark all the time — and the enemy half of
      // the blast is real, so `release()` can null `visual` on this very slot
      // before the next line runs. Exactly the failure the exploder's comment
      // documents: read the colour and the mark FIRST, and check the slot is
      // still live before touching `e` again.
      const puff = e.visual ? e.visual.color : '#ff9a3d';
      const bx = e.aiX, by = e.aiY;
      enemyBlast(run, bx, by, blast, e.damage * (e.params.shellMult || 1.5));
      particles.ring(bx, by, 12, puff, blast * 2.6);
      if (!e.active) return;
      e.aiState = 0;
      e.aiT = e.params.fireInterval || 4.5;
    }
  },

  /**
   * SOWER — ground denial. It does not chase you; it takes the floor away.
   *
   * Everything else in the horde is a thing to be killed. This one converts the
   * arena into something you have to route around, and it keeps doing it while
   * you decide whether it is worth the detour. Its own contact damage is low on
   * purpose: the mob is not the threat, the trail is, and killing it does not
   * clean up what it already put down.
   *
   * The field is PERMANENTLY VISIBLE (hazards.js draws it under the entities), so
   * this is telegraph-compliant without a countdown: there is nothing to warn
   * about, it is simply there.
   */
  sower(e, run, p, dt, sys) {
    sys._moveToward(e, p.x, p.y, dt, 0.8);
    e.aiT -= dt;
    if (e.aiT > 0) return;
    e.aiT = e.params.sowInterval || 2.2;
    // Only ever at its own feet. A sower that placed ground under the PLAYER
    // would be an untelegraphed attack wearing a hazard's clothes.
    run.hazards.spawnField(e.x, e.y, e.params.fieldRadius || 62,
                           e.params.fieldLife || 6,
                           e.params.fieldKind || 'damage',
                           e.damage * (e.params.fieldDps || 0.55),
                           e.visual.color, SOW_OPTS);
  },

  /**
   * CONDUCTOR — the reason the crowd is suddenly a problem.
   *
   * The healer taught "kill that one first" with a green beam you can see. This
   * teaches the same lesson without a beam: a screen of ordinary fodder that is
   * moving 35% faster and hitting 30% harder than it was ten seconds ago, and
   * one thing in the middle of it keeping time. It has no attack of its own and
   * the lowest contact damage of its tier — every point of threat it represents
   * is borrowed from the enemies around it, which is exactly the read.
   *
   * `applyHaste`/`applyEmpower` take the STRONGER of the incoming and existing
   * effect, so two conductors overlapping is not 1.35 x 1.35.
   */
  conductor(e, run, p, dt, sys) {
    // Hangs back like the healer: it wants to be inside its own crowd, not
    // ahead of it.
    const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y));
    if (d < 240) { if (dirTo(p.x, p.y, e.x, e.y) > 1) { e.x += V.x * e.speed * dt; e.y += V.y * e.speed * dt; } }
    else sys._moveToward(e, p.x, p.y, dt, 0.6);

    e.aiT -= dt;
    if (e.aiT > 0) return;
    e.aiT = 0.5;
    const rad = e.params.rallyRadius || 260;
    const haste = e.params.hasteMult || 1.35;
    const power = e.params.empowerMult || 1.3;
    // 0.9s of buff refreshed every 0.5s: killing the conductor does not undo the
    // crowd instantly, it lets the crowd fall back to normal over half a second,
    // which is long enough to feel like a consequence and short enough to read.
    const hash = run.enemyHash;
    const items = run.enemies.items;
    const n = hash.query(e.x, e.y, rad);
    for (let k = 0; k < n; k++) {
      const o = items[hash.resultAt(k)];
      if (!o || !o.active || o === e || o.hp <= 0) continue;
      applyHaste(o.st, haste, 0.9);
      applyEmpower(o.st, power, 0.9);
    }
    particles.drift(e.x, e.y, e.visual.accent || e.visual.color, RALLY_FX);
  },

  /**
   * WATCHER — it only attacks people who are not going anywhere.
   *
   * The tier-2 comment in data/enemies.js has claimed since the first build that
   * "every one of them punishes standing still", and none of them did: a chaser
   * walking at you is not a clock. This is. It measures DISPLACEMENT, not input,
   * so shuffling on the spot and orbiting a 40px circle both count as standing
   * still — and a player who genuinely relocates resets it for free.
   *
   * It never moves onto you and it strikes the ANCHOR, not the player, so the
   * counter-play is always the same one word: leave.
   */
  watcher(e, run, p, dt, sys) {
    const stand = e.params.standRadius || 96;
    const strike = e.params.strikeRadius || 118;

    // Loiters at reading distance. It is a threat you are supposed to be able to
    // see and ignore until you cannot.
    const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y));
    if (d > 300) sys._moveToward(e, p.x, p.y, dt, 1);
    else if (d < 190) { if (dirTo(p.x, p.y, e.x, e.y) > 1) { e.x += V.x * e.speed * 0.7 * dt; e.y += V.y * e.speed * 0.7 * dt; } }
    e.facingTarget = Math.atan2(p.y - e.y, p.x - e.x);

    e.aiT -= dt;
    if (e.aiState === 1) {
      if (e.aiT <= 0) {
        // Same rule as the mortar and the exploder: the strike lands on an
        // anchor the watcher may itself be standing next to, and the blast is
        // free to kill it. Colour and mark are read before the damage, and the
        // slot is re-checked before anything else on `e` is written.
        const puff = e.visual ? e.visual.color : '#ff9a3d';
        const bx = e.aiX, by = e.aiY;
        enemyBlast(run, bx, by, strike, e.damage * (e.params.strikeMult || 1.8));
        particles.ring(bx, by, 14, puff, strike * 2.4);
        if (!e.active) return;
        e.aiState = 0;
        e.aiT2 = 0;
        e.aiT = e.params.cooldown || 2.5;
        e.aiX = p.x; e.aiY = p.y;
      }
      return;
    }
    if (e.aiT > 0) return;              // cooling down; not watching yet

    if (dist2(e.aiX, e.aiY, p.x, p.y) > stand * stand) {
      // Moved. Re-anchor and start the count again from nothing.
      e.aiX = p.x; e.aiY = p.y;
      e.aiT2 = 0;
      return;
    }
    e.aiT2 += dt;
    if (e.aiT2 >= (e.params.patience || 2.2)) {
      e.aiState = 1;
      e.aiT = e.params.telegraph || feel.telegraphLethal;
      run.hazards.telegraph(e.aiX, e.aiY, strike, e.aiT, 'red', 'x');
    }
  },

  /**
   * TETHERED — cannot be killed the way everything else is killed.
   *
   * While ANY other enemy is inside `wardRadius` it takes 92% less damage and
   * draws a tether to whichever one is holding the ward up. Alone, it is a
   * slightly slow tier-3 chaser you delete in a second. So the horde around it
   * is not chaff any more, it is the fight — and on a covered screen at minute
   * fifteen that is a genuine problem to solve rather than a bigger number.
   *
   * TWO answers, on purpose, because one answer is a puzzle and two is a
   * mechanic: clear a bubble around it, or burn it — damage.js exempts DoTs from
   * the mitigation path, so bleed/burn/poison builds bypass the ward entirely
   * and pay for it in time instead of positioning.
   */
  tethered(e, run, p, dt, sys) {
    sys._moveToward(e, p.x, p.y, dt, 1);
    e.aiT -= dt;
    if (e.aiT > 0) return;
    // Four checks a second. The ward is a state, not a per-hit query — putting
    // this in damage.js would mean a spatial-hash lookup on every one of the
    // twenty thousand hits a built player lands in a minute.
    e.aiT = 0.25;
    const rad = e.params.wardRadius || 150;
    const hash = run.enemyHash;
    const items = run.enemies.items;
    const n = hash.query(e.x, e.y, rad);
    for (let k = 0; k < n; k++) {
      const o = items[hash.resultAt(k)];
      if (!o || !o.active || o === e || o.hp <= 0 || o.spawnT > 0) continue;
      // A WARD MAY NOT BE HELD BY ANOTHER WARDED THING. Without this line a
      // cluster of Mask Bearers holds itself up: every one of them is somebody
      // else's escort, none of them can be killed first, and the only way out is
      // a DoT — which is a deadlock, not a mechanic. Caught by driving 24 of
      // them into one run and watching all 24 survive an hour. The escort has to
      // be ordinary horde, which is also the read the tether is meant to give.
      if (o.behavior === 'tethered') continue;
      if (dist2(e.x, e.y, o.x, o.y) > rad * rad) continue;
      e.aiF = 1;                        // warded
      e.aiX = o.x; e.aiY = o.y;         // where the tether is drawn to
      e.shieldArc = TAU;
      return;
    }
    e.aiF = 0;
    e.shieldArc = 0;
  },

  /**
   * STRAFER — the thing that is not on screen yet.
   *
   * Everything else in this file is a problem you can see and choose to walk
   * away from. This one leaves, and comes back on a timer, down a lane it drew
   * across the whole arena a second before it arrives — so the question stops
   * being "what is near me" and starts being "where will I be in a second".
   *
   * It is the one archetype that runs while off-screen (`thinksOffscreen`),
   * because the withdrawal and the line-up ARE the attack. It does no damage
   * out there: the update loop only tests contact for enemies inside the view.
   */
  strafer(e, run, p, dt, sys) {
    e.aiT -= dt;
    switch (e.aiState) {
      case 0:                            // PROWL — an ordinary fast chaser
        sys._moveToward(e, p.x, p.y, dt, 1);
        if (e.aiT <= 0) {
          const tel = e.params.telegraph || feel.telegraphLethal;
          const rx = run.camera.viewHalfW(0) * 1.25;
          const ry = run.camera.viewHalfH(0) * 1.25;
          e.aiF = runRng.angle();
          e.aiX = p.x - Math.cos(e.aiF) * rx;
          e.aiY = p.y - Math.sin(e.aiF) * ry;
          e.aiState = 1; e.aiT = tel;
          // The lane, drawn the full width of the run so the safe side of it is
          // unambiguous. Yellow + arrow is the "wind-up, from this way" pair.
          run.hazards.telegraphLine(e.aiX, e.aiY,
                                    e.aiX + Math.cos(e.aiF) * rx * 2.6,
                                    e.aiY + Math.sin(e.aiF) * ry * 2.6,
                                    e.radius * 2.4, tel, 'yellow', 'arrow');
        }
        break;
      case 1:                            // LINE UP, out past the edge of the view
        sys._moveToward(e, e.aiX, e.aiY, dt, 3.2);
        if (e.aiT <= 0) {
          // Snapped onto the mark rather than merely near it: the lane is
          // already drawn and a strafer that runs parallel to its own telegraph
          // is a lie. It is well outside the view, so nothing pops.
          e.x = e.aiX; e.y = e.aiY; e.px = e.x; e.py = e.y;
          e.aiState = 2; e.aiT = e.params.runTime || 1.7;
        }
        break;
      case 2: {                          // THE RUN
        const s = (e.params.dashSpeed || 660) * dt;
        e.x += Math.cos(e.aiF) * s;
        e.y += Math.sin(e.aiF) * s;
        e.facingTarget = e.aiF;
        if (e.aiT <= 0) { e.aiState = 3; e.aiT = e.params.recover || 0.9; }
        break;
      }
      default:                           // RECOVER, then go around again
        sys._moveToward(e, p.x, p.y, dt, 0.45);
        if (e.aiT <= 0) { e.aiState = 0; e.aiT = e.params.runInterval || 6; }
    }
  },

  /** DECISIONS.md §6 — declared by Trap Scroll, never defined in the spec. */
  static(e, run, p, dt, sys) {
    // A visible, avoidable mine. It never moves; it detonates on proximity after
    // a telegraph, which is what makes it fair.
    if (e.aiState === 0) {
      const trigger = e.params.triggerRadius || 70;
      if (dist2(e.x, e.y, p.x, p.y) < trigger * trigger) {
        e.aiState = 1;
        e.aiT = e.params.fuse || 0.8;
        run.hazards.telegraph(e.x, e.y, e.params.blastRadius || 110, e.aiT, 'red', 'x');
      }
    } else {
      e.aiT -= dt;
      if (e.aiT <= 0) {
        enemyBlast(run, e.x, e.y, e.params.blastRadius || 110, e.damage);
        particles.ring(e.x, e.y, 18, '#ffd23f', 420);
        dealDamage(run, e, e.maxHp * 10, SRC.HAZARD, { canCrit: false, noNumber: true });
      }
    }
  },
};

const EMPTY = {};

/** SECTION 3's separation sample size. Six neighbours read as a blob; more do not. */
const SEPARATION_SAMPLES = 6;
/** Reused out-vector for separationPush — a separation pass may not allocate. */
const SEP = { x: 0, y: 0 };

/** Same rule for _recycle's pushOut. Never read across calls. */
const FREE = { x: 0, y: 0 };

/**
 * The Sower's field, as a module-level constant (house rule: no options bag is
 * built inside a tick). `hitsEnemies:false` is deliberate — an enemy hazard that
 * mowed down the crowd it was standing in would be a gift, not a threat.
 */
const SOW_OPTS = { hitsPlayer: true, hitsEnemies: false };

/** Same rule, one line up: the Conductor's beat is drawn twice a second. */
const RALLY_FX = { life: 0.6, size: 0.45 };

export { BEHAVIORS };
