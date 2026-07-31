// The player: movement, the stat pipeline, and the four ability pillars.
//
// THE STAT PIPELINE is the important part. Stats are RECOMPUTED from sources
// every time something changes, never mutated in place:
//
//     character base
//   + star level bonuses (S2/S4)
//   + shrine meta upgrades
//   + bond bonuses
//   + in-run generic upgrades
//   + relic modifiers
//   + temporary buffs
//   = stats
//
// Recomputing is what makes "remove this buff" and "swap this relic" correct for
// free, instead of a subtract that drifts. It runs on change, not per frame.

import { feel } from '../core/feel.js';
import { CONFIG } from '../core/config.js';
import { clamp, normalize, V, damp, TAU, dist2 } from '../core/math.js';
import { makeStatus, clearStatus, tickStatus, speedMultiplier, isStunned } from './statusEffects.js';
import { atlas } from '../render/spriteAtlas.js';
import { particles } from '../render/particles.js';
import { damageNumbers, DMG_KIND } from '../render/damageNumbers.js';
import { fxRng } from '../core/rng.js';
import { Cooldown, Interval } from '../core/timer.js';
import { events, EV } from '../core/events.js';
import { input, ACT } from '../core/input.js';
import { save } from '../core/save.js';
import { DEV_MODE } from '../core/config.js';

/** Everything the game reads off `player.stats`. Order defines the HUD order. */
const STAT_KEYS = [
  'maxHp', 'armor', 'moveSpeed', 'pickupRadius',
  'damageMult', 'attackSpeedMult', 'areaMult', 'projectileSpeedMult',
  'critChance', 'critMult', 'cooldownMult', 'luck',
  'projectileCount', 'pierce', 'regen', 'xpMult', 'goldMult',
  'dodge', 'lifesteal', 'thorns', 'revives', 'momentumBonus',
];

/**
 * Percentage stats that scale an ABSOLUTE one. Data says `pickupRadiusMult`
 * because "+22% pickup radius" is how the upgrade reads to a player; the
 * simulation wants pixels. This is the bridge, and it is the ONLY place the two
 * vocabularies meet.
 */
const MULT_TO_BASE = {
  pickupRadiusMult: 'pickupRadius',
  moveSpeedMult: 'moveSpeed',
  maxHpMult: 'maxHp',
  armorMult: 'armor',
  regenMult: 'regen',
};

const WARNED = Object.create(null);

// Module scope: the regen effect fires several times a second and must not
// build an options object each time.
const REGEN_MOTE = { color: '#7bf59a', life: 0.85, size: 0.55, sizeEnd: 0.1, drag: 1.4, additive: true };
const REGEN_MOTE_FAINT = { color: '#4ee07a', life: 0.7, size: 0.32, sizeEnd: 0.05, drag: 1.8, additive: true };

export class Player {
  constructor(run, charDef) {
    this.run = run;
    this.def = charDef;
    this.id = charDef.id;

    this.x = 0; this.y = 0; this.px = 0; this.py = 0;
    this.vx = 0; this.vy = 0;
    this.facing = 0;
    this.dead = false;

    this.hp = 1; this.maxHp = 1;
    this.iframeT = 0;
    this.flashT = 0;
    this.lastDamageAt = -999;
    this.st = makeStatus();

    this.level = 1;
    this.xp = 0;
    this.xpToNext = 9;

    /** upgradeId -> level */
    this.upgrades = Object.create(null);
    /** relic ids, max RELIC_SLOTS */
    this.relics = [];
    /** evolution ids gained this run */
    this.evolutions = [];
    /** Temporary buffs: {id, t, mods} — recompute() folds them in. */
    this.buffs = [];

    /** Ad-hoc flags set by abilities/relics/evolutions. No character-id branching. */
    this.flags = Object.create(null);
    /** Character resource bar (Han's rage). Declared in data, generic here. */
    this.resource = 0;
    this.resourceMax = charDef.resourceBar ? charDef.resourceBar.max : 0;

    this.stats = {};
    for (const k of STAT_KEYS) this.stats[k] = 0;

    this.autoTimer = new Interval(1);
    this.autoShotIndex = 0;
    /** True only inside a synchronous auto-attack fire(). See helpers.js sig(). */
    this.autoScope = false;
    // A special may DECLARE charges, the way the escape gets its second one from
    // the star level. It is a generic optional field, not a character branch:
    // "you get N of these and then you are out" is a shape any special is free
    // to take, and the HUD's radial already draws the pips for it.
    this.special = new Cooldown(charDef.special.cooldown, charDef.special.charges || 1);
    this.escape = new Cooldown(charDef.escape.cooldown, 1);

    /** Ability runtime state — abilities own their own slot, keyed by ability id. */
    this.abilityState = Object.create(null);

    this.visual = charDef.visual;
    this.sprite = atlas.ensure(charDef.visual);
    /**
     * THE SECOND SILHOUETTE, and the one she wears the rest of the time.
     *
     * A character who becomes something else for the duration of an ability
     * declares it as `altForm` in her own data; `draw()` blits whatever
     * `this.sprite` points at, so a transformation is a pointer swap and nothing
     * in the renderer learns whose it is. The ability driver does the swapping.
     *
     * BOTH are rastered here, at construction. The alternative is baking a 2.2x
     * sprite on the single frame the screen is already whiting out, dimming the
     * arena and pulling the camera to 0.9 — the worst frame in the run to
     * discover a sprite has never been rastered. `altForm.visual` is published
     * through `data.allVisuals()`, so this is a cache hit at boot.
     */
    this.baseSprite = this.sprite;
    this.formSprite = charDef.altForm && charDef.altForm.visual
      ? atlas.ensure(charDef.altForm.visual) : null;
    this.radius = feel.playerHitRadius;

    /** Continuous-movement timer, for the Momentum upgrade. */
    this.movingT = 0;
    this.stillT = 0;

    /** Regen presentation: fractional HP banked until it is worth showing. */
    this._regenBank = 0;
    this._regenT = 0;
    this._regenFx = 0;

    this.starLevel = 1;
    this.bond = 0;

    this.recompute();
    this.hp = this.maxHp;
  }

  // --- stats ----------------------------------------------------------------
  recompute() {
    const d = this.def.stats;
    const s = this.stats;
    // Percentage-of-absolute contributions accumulate here and land at the end,
    // so three sources of "+22%" sum to +66% rather than compounding.
    if (!this._mults) this._mults = Object.create(null);
    for (const k in this._mults) this._mults[k] = 0;
    const star = this.starLevel;
    const bonuses = this.run.data.gacha.STAR_BONUSES;

    // base
    s.maxHp = d.hp;
    s.armor = d.armor;
    s.moveSpeed = d.moveSpeed;
    s.pickupRadius = d.pickupRadius;
    s.damageMult = d.damageMult;
    s.attackSpeedMult = d.attackSpeedMult;
    s.areaMult = d.areaMult;
    s.projectileSpeedMult = 1;
    s.critChance = d.critChance;
    s.critMult = d.critMult;
    s.cooldownMult = d.cooldownMult;
    s.luck = d.luck;
    s.projectileCount = 0;
    s.pierce = 0;
    s.regen = 0;
    s.xpMult = 1;
    s.goldMult = 1;
    s.dodge = 0;
    s.lifesteal = 0;
    s.thorns = 0;
    s.revives = 0;
    s.momentumBonus = 0;
    /** Auto-attack damage multiplier — S2/S4 raise this specifically. */
    s.autoDamageMult = 1;

    // --- star levels ---------------------------------------------------------
    if (star >= 2) { s.maxHp *= 1 + bonuses[2].hp; s.autoDamageMult += bonuses[2].autoDamage; }
    if (star >= 4) {
      s.maxHp *= 1 + bonuses[4].hp;
      s.autoDamageMult += bonuses[4].autoDamage;
      s.cooldownMult *= 1 + bonuses[4].cooldown;
    }

    // --- shrine (meta) -------------------------------------------------------
    //
    // Two shapes, both of them shrine.js's problem rather than ours. A row with
    // `effects` moves two stats at once (Curse, Glass Edge) and its own
    // stat/perLevel/mode are absent; a row with `scope: 'run'` is read straight
    // out of save.data.shrine by run.js at start-of-run and has nothing to say
    // to this pipeline at all.
    //
    // The scope check is not a micro-optimisation. Rerolls and Banish declare
    // `freeRerolls` and `banishes`, which are real keys that run.js really
    // consumes but which STAT_KEYS has never heard of — so every recompute fed
    // _applyStat() two keys it could only answer with the "unknown stat" warning
    // below. Both upgrades worked the whole time, and the warning that exists to
    // catch the ones that DON'T opened every dev session with two false
    // positives, which is precisely how a warning stops being read. Worse, it
    // burned those two names in WARNED, so the two loudest examples of the bug
    // that warning is for could only ever be reported once, first, and wrongly.
    const shrineLevels = save.data.shrine;
    for (const up of this.run.data.shrine.SHRINE_UPGRADES) {
      if (up.scope === 'run') continue;
      const lv = shrineLevels[up.id] || 0;
      if (lv <= 0) continue;
      if (up.effects) {
        for (const e of up.effects) this._applyStat(s, e.stat, e.perLevel * lv, e.mode);
      } else {
        this._applyStat(s, up.stat, up.perLevel * lv, up.mode);
      }
    }

    // --- bond ----------------------------------------------------------------
    for (const b of this.run.data.shrine.BOND_LEVELS) {
      if (this.bond >= b.level && b.reward.kind === 'stat') {
        this._applyStat(s, b.reward.stat, b.reward.value, 'add');
      }
    }

    // --- in-run generic upgrades ---------------------------------------------
    for (const id in this.upgrades) {
      const up = this.run.data.upgrades.UPGRADES_BY_ID[id];
      if (!up) continue;
      this._applyStat(s, up.stat, up.perLevel * this.upgrades[id], up.mode);
    }

    // --- relics --------------------------------------------------------------
    for (const rid of this.relics) {
      const r = this.run.data.relics.RELICS_BY_ID[rid];
      if (r && r.statMods) {
        for (const k in r.statMods) this._applyStat(s, k, r.statMods[k], 'add');
      }
    }

    // --- temporary buffs -----------------------------------------------------
    for (const b of this.buffs) {
      for (const k in b.mods) this._applyStat(s, k, b.mods[k], 'add');
    }

    // --- stage modifier ------------------------------------------------------
    const mod = this.run.modifier;
    if (mod) {
      if (mod.params.playerDodge) s.dodge += mod.params.playerDodge;
      if (mod.params.xpMult) s.xpMult *= mod.params.xpMult;
      if (mod.params.goldMult) s.goldMult *= mod.params.goldMult;
      if (mod.params.pickupRadiusMult) s.pickupRadius *= mod.params.pickupRadiusMult;
    }

    // --- percentage-of-absolute contributions --------------------------------
    // Applied AFTER every source so the order sources are read in cannot change
    // the result.
    for (const base in this._mults) {
      const acc = this._mults[base];
      if (acc) s[base] *= (1 + acc);
    }

    // --- clamps --------------------------------------------------------------
    s.dodge = clamp(s.dodge, 0, feel.dodgeCap);
    s.cooldownMult = Math.max(0.25, s.cooldownMult);
    s.critChance = clamp(s.critChance, 0, 1);
    s.moveSpeed = Math.max(40, s.moveSpeed);
    s.maxHp = Math.max(1, s.maxHp);
    // DECISIONS.md §29 — a hard cap of 3 revives per run, however they stack.
    s.revives = Math.min(3, s.revives);

    // A max-HP increase HEALS by the amount gained. Taking Iron Body at 30% HP
    // should feel like a reward, not like the bar getting proportionally emptier.
    const gained = s.maxHp - this.maxHp;
    this.maxHp = s.maxHp;
    if (gained > 0) this.hp += gained;
    this.hp = Math.min(this.hp, this.maxHp);
    if (this.hp <= 0 && !this.dead) this.hp = 1;

    // Cooldowns re-read their duration from the character def each recompute.
    this.special.configure(this.def.special.cooldown * s.cooldownMult,
                           this.def.special.charges || this.special.maxCharges);
    const escapeCd = this.flags.zeroCooldown
      ? Math.max(this.run.data.evolutions.EVOLUTIONS_BY_ID.zero_cooldown.params.cooldownFloor,
                 this.def.escape.cooldown * s.cooldownMult * 0.0)
      : this.def.escape.cooldown * s.cooldownMult;
    this.escape.configure(escapeCd, star >= 5 ? 2 : this.escape.maxCharges);

    this.radius = feel.playerHitRadius;
  }

  /**
   * Apply one stat contribution.
   *
   * A `<base>Mult` key is a PERCENTAGE of an absolute stat — `pickupRadiusMult`
   * scales `pickupRadius`, `moveSpeedMult` scales `moveSpeed`. Those are
   * accumulated and applied once at the end of recompute() so three sources of
   * "+22%" come to +66%, not to 1.22^3.
   *
   * This used to fall through to `s[key] = 0 + value` for any unrecognised key,
   * which silently created a field nothing reads — so Lodestone and Swift Boots
   * did NOTHING for the entire life of the project and never produced an error,
   * a warning, or a failing test. An unknown key is now loud.
   */
  _applyStat(s, key, value, mode) {
    if (!key || !value) return;

    const base = MULT_TO_BASE[key];
    if (base !== undefined) {
      this._mults[base] = (this._mults[base] || 0) + value;
      return;
    }

    if (s[key] === undefined) {
      if (DEV_MODE && !WARNED[key]) {
        WARNED[key] = true;
        console.warn(`[player] unknown stat "${key}" — this contribution does nothing. ` +
                     `Add it to STAT_KEYS or map it in MULT_TO_BASE.`);
      }
      return;
    }
    if (mode === 'mult') s[key] *= (1 + value);
    else s[key] += value;
  }

  // --- upgrades / relics ----------------------------------------------------
  addUpgrade(id) {
    const up = this.run.data.upgrades.UPGRADES_BY_ID[id];
    if (!up) return false;
    const cur = this.upgrades[id] || 0;
    if (cur >= up.maxLevel) return false;
    this.upgrades[id] = cur + 1;
    this.recompute();
    events.emit(EV.UPGRADE_TAKEN, id, this.upgrades[id]);
    return true;
  }

  upgradeLevel(id) { return this.upgrades[id] || 0; }
  isMaxed(id) {
    const up = this.run.data.upgrades.UPGRADES_BY_ID[id];
    return up ? (this.upgrades[id] || 0) >= up.maxLevel : false;
  }

  hasRelic(id) { return this.relics.indexOf(id) >= 0; }

  addRelic(id, slotIndex) {
    const max = this.run.data.relics.RELIC_SLOTS;
    if (this.hasRelic(id)) return false;
    if (this.relics.length >= max) {
      if (slotIndex === undefined) return false;
      this.relics[slotIndex] = id;
    } else {
      this.relics.push(id);
    }
    this.recompute();
    this.run.relicHooks.rebuild();
    events.emit(EV.RELIC_TAKEN, id);
    return true;
  }

  /** RESONANCE: playing the character a relic belongs to makes it 50% stronger. */
  resonatesWith(relicId) {
    const r = this.run.data.relics.RELICS_BY_ID[relicId];
    return !!(r && r.owner && r.owner === this.id);
  }

  /**
   * `dur` is the buff's FULL length, kept alongside the countdown so the HUD has
   * a denominator. Without it the timer strip divided every buff's remaining
   * time by a hardcoded 60 seconds, so a four-second buff drew as a bar 7% full
   * that never visibly moved — which is indistinguishable from a bar that is
   * broken. A refresh raises both, because a refreshed buff is a full one again.
   */
  addBuff(id, duration, mods) {
    for (const b of this.buffs) {
      if (b.id === id) {
        b.t = Math.max(b.t, duration);
        if (b.t > b.dur) b.dur = b.t;
        return b;
      }
    }
    const b = { id, t: duration, dur: duration, mods };
    this.buffs.push(b);
    this.recompute();
    // Singularity Patch counts stacks, so the count has to announce itself.
    if (this.run.relicHooks) this.run.relicHooks.fire('onBuffStack', this.buffs.length, id);
    return b;
  }

  removeBuff(id) {
    const i = this.buffs.findIndex((b) => b.id === id);
    if (i >= 0) { this.buffs.splice(i, 1); this.recompute(); }
  }

  get buffStacks() { return this.buffs.length; }

  // --- resource bar (generic; Han's rage is the only user today) -------------
  addResource(amount) {
    if (this.resourceMax <= 0) return;
    const before = this.resource;
    this.resource = clamp(this.resource + amount, 0, this.resourceMax);
    if (before < this.resourceMax && this.resource >= this.resourceMax) {
      events.emit('player:resourceFull', this);
    }
  }

  // --- update ---------------------------------------------------------------
  update(dt) {
    const run = this.run;
    this.px = this.x; this.py = this.y;

    // status
    const dot = tickStatus(this.st, dt, this.maxHp);
    if (dot > 0) run.damageSelf(dot);
    if (this.iframeT > 0) this.iframeT -= dt;
    if (this.flashT > 0) this.flashT -= dt;

    // buffs
    for (let i = 0; i < this.buffs.length; i++) {
      this.buffs[i].t -= dt;
      if (this.buffs[i].t <= 0) { this.buffs.splice(i, 1); i--; this.recompute(); }
    }

    // REGEN, AND PROOF THAT IT IS HAPPENING.
    //
    // A 0.4 HP/s trickle silently nudging a number was indistinguishable from
    // the upgrade doing nothing — which is exactly what it was reported as. It
    // now banks what it restores and spits out a countable `+N` the moment a
    // whole point has accrued, so the feedback is proportional to the stat: one
    // level drips a +1 every couple of seconds, eight levels fountain.
    if (this.stats.regen > 0 && this.hp < this.maxHp) {
      const before = this.hp;
      this.hp = Math.min(this.maxHp, this.hp + this.stats.regen * dt);
      this._regenBank += this.hp - before;
      this._regenT += dt;
      if (this._regenBank >= 1) {
        const whole = Math.floor(this._regenBank);
        this._regenBank -= whole;
        this._regenT = 0;
        damageNumbers.spawn(this.x + fxRng.range(-10, 10), this.y - 34, whole,
                            DMG_KIND.HEAL, -1);
        particles.emit(this.x + fxRng.range(-12, 12), this.y + 6, 0, -34, REGEN_MOTE);
      }
      // Even below one whole point, keep a mote drifting up so the effect is
      // visible while it is accumulating rather than only when it pays out.
      this._regenFx -= dt;
      if (this._regenFx <= 0) {
        this._regenFx = 0.42;
        particles.emit(this.x + fxRng.range(-14, 14), this.y + 8, 0, -26, REGEN_MOTE_FAINT);
      }
    } else {
      this._regenBank = 0;
    }

    // movement
    this._move(dt);

    // cooldowns
    this.special.tick(dt);
    this.escape.tick(dt);

    // Momentum: +3% damage per second of continuous movement, capped.
    if (this.stats.momentumBonus > 0) {
      const cap = this.stats.momentumBonus * 10;   // perLevel 0.03 -> +30% at 10s
      const target = Math.min(cap, this.movingT * this.stats.momentumBonus);
      this.flags.momentumDamage = target;
    }
  }

  _move(dt) {
    const run = this.run;
    if (isStunned(this.st) || this.flags.rooted) {
      this.vx = damp(this.vx, 0, 0.5, dt);
      this.vy = damp(this.vy, 0, 0.5, dt);
      this.movingT = 0; this.stillT += dt;
      return;
    }

    let ix = run.inputMoveX, iy = run.inputMoveY;
    const mag = Math.hypot(ix, iy);

    let speed = this.stats.moveSpeed * speedMultiplier(this.st);
    // "Deep Pressure" / rising tide slow both enemies and the player.
    if (run.hazards.tideHigh) speed *= 0.8;
    if (this.flags.moveSpeedMult) speed *= this.flags.moveSpeedMult;

    const targetVx = mag > 0.01 ? (ix / Math.max(1, mag)) * speed : 0;
    const targetVy = mag > 0.01 ? (iy / Math.max(1, mag)) * speed : 0;

    // SECTION 3: no acceleration ramp longer than 80ms. This genre lives on
    // precise dodging, so the ramp is short and the stop is shorter.
    const ramp = mag > 0.01 ? feel.accelTime : feel.decelTime;
    const k = ramp <= 0 ? 1 : clamp(dt / ramp, 0, 1);
    this.vx += (targetVx - this.vx) * k;
    this.vy += (targetVy - this.vy) * k;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (mag > 0.01) {
      this.facing = Math.atan2(this.vy, this.vx);
      this.movingT += dt;
      this.stillT = 0;
    } else {
      this.movingT = 0;
      this.stillT += dt;
    }

    // Arena bounds: a soft push-back band, then a hard clamp (DECISIONS.md §19).
    const b = run.bounds;
    const soft = CONFIG.ARENA_SOFT_EDGE;
    if (this.x < b.minX + soft) this.vx += (b.minX + soft - this.x) * 6 * dt;
    if (this.x > b.maxX - soft) this.vx -= (this.x - (b.maxX - soft)) * 6 * dt;
    if (this.y < b.minY + soft) this.vy += (b.minY + soft - this.y) * 6 * dt;
    if (this.y > b.maxY - soft) this.vy -= (this.y - (b.maxY - soft)) * 6 * dt;
    this.x = clamp(this.x, b.minX, b.maxX);
    this.y = clamp(this.y, b.minY, b.maxY);

    // Static geometry blocks the player outright.
    if (run.obstacles.count > 0) run.obstacles.resolve(this, this.radius + 6);
  }

  /**
   * Effective damage multiplier for an auto-attack, after everything —
   * including the SIGNATURE WEAPON's level, which is the reason a level-1 auto
   * hits for about half what it used to and a maxed one hits for four times it.
   */
  autoDamageMultiplier() {
    let m = this.stats.damageMult * this.stats.autoDamageMult;
    if (this.run.weapons) m *= this.run.weapons.mods.damage;
    if (this.flags.momentumDamage) m *= 1 + this.flags.momentumDamage;
    if (this.flags.damageMultBonus) m *= 1 + this.flags.damageMultBonus;
    return m;
  }

  abilityDamageMultiplier() {
    let m = this.stats.damageMult;
    if (this.flags.momentumDamage) m *= 1 + this.flags.momentumDamage;
    if (this.flags.damageMultBonus) m *= 1 + this.flags.damageMultBonus;
    return m;
  }

  /** Per-ability scratch state, created on first use. Never a Map lookup miss. */
  state(abilityId) {
    let s = this.abilityState[abilityId];
    if (!s) { s = Object.create(null); this.abilityState[abilityId] = s; }
    return s;
  }

  get hpFraction() { return this.maxHp > 0 ? this.hp / this.maxHp : 0; }
  get isLowHp() { return this.hpFraction < feel.lowHpThreshold; }

  draw(r, alpha) {
    const x = this.px + (this.x - this.px) * alpha;
    const y = this.py + (this.y - this.py) * alpha;
    let a = 1;
    if (this.st.intangibleT > 0) a = 0.45;
    else if (this.st.untargetableT > 0) a = 0.6;
    else if (this.iframeT > 0) a = 0.55 + 0.45 * Math.sin(this.iframeT * 40);

    const scale = (this.flags.sizeMult || 1) * this.sprite.unit * feel.playerDrawScale;
    // WALK OR IDLE, and the sprite owns the answer — it is the only thing that
    // knows how many walk frames it was baked with. It takes the interpolation
    // delta SQUARED rather than a speed, so nothing here pays for a square root
    // and nothing here depends on `vx` being maintained. Phase 0: there is only
    // ever one player, so there is nobody to fall into lockstep with.
    const dx = this.x - this.px, dy = this.y - this.py;
    const anim = this.sprite.animIndexFor(this.run.time, dx * dx + dy * dy, 0);
    r.drawSprite(this.sprite, x, y, 0, scale, a, this.flashT > 0, anim);

    // Aura ring while a transformation is active — the loudest state read.
    if (this.flags.auraColor) {
      const t = this.run.time * 4;
      r.strokeCircle(x, y, 26 * scale + Math.sin(t) * 2.5, this.flags.auraColor, 3, 0.7);
    }
    r.setAlpha(1);
  }
}
