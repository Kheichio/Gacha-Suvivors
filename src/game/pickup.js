// XP gems, gold, and the 10 world pickup types.
//
// GEM MERGING (SECTION 1): above 400 gems, nearby gems merge into higher-value
// gems. Without this a 20-minute run at 300 kills/second becomes a gem-collection
// simulator that allocates and iterates more than the enemies do.
//
// MAGNET ARC (SECTION 3): gems accelerate toward the player with easing, not
// linearly. That easing is the whole reason collecting them feels good.

import { CONFIG } from '../core/config.js';
import { Pool } from '../core/pool.js';
import { runRng, fxRng } from '../core/rng.js';
import { feel } from '../core/feel.js';
import { atlas } from '../render/spriteAtlas.js';
import { particles } from '../render/particles.js';
import { audio } from '../core/audio.js';
import { events, EV } from '../core/events.js';
import { floaters } from '../render/damageNumbers.js';
import { clamp, dirTo, V, dist2, TAU, easeInExpo } from '../core/math.js';
import { healPlayer, areaDamage, SRC } from './damage.js';
import { applySlow } from './statusEffects.js';

export const PICKUP_KIND = {
  GEM: 0, GOLD: 1, HEART: 2, MAGNET: 3, BOMB: 4, BENTO: 5,
  HOURGLASS: 6, CHEST: 7, GOLD_CHEST: 8, SHRINE: 9, RELIC: 10, WEAPON: 11,
};

function makePickup() {
  return {
    active: false, _i: 0,
    kind: 0, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    value: 0, tier: 0,
    radius: 8, sprite: null, visual: null, scale: 1,
    life: 0, popT: 0, magnetT: 0,
    bob: 0, merged: 0,
    payload: null,      // relic id for RELIC, upgrade list for CHEST
    used: false,
  };
}

function resetPickup(p) { p.payload = null; p.sprite = null; p.visual = null; p.used = false; }

export class PickupSystem {
  constructor(run) {
    this.run = run;
    this.pool = new Pool(makePickup, resetPickup, 512, CONFIG.MAX_GEMS + 256, true);
    this.gemCount = 0;
    this._mergeT = 0;
    this._sprites = new Map();
  }

  get items() { return this.pool.items; }
  get count() { return this.pool.count; }

  _sprite(visual) {
    const key = visual.shape + visual.color + (visual.size || 8) + (visual.emoji || '');
    let s = this._sprites.get(key);
    if (!s) {
      // Pickups never take damage, so they never need the white-flash twin.
      // Copying rather than mutating keeps the shared data object untouched.
      if (visual.flash !== false) {
        const noFlash = Object.assign({}, visual);
        noFlash.flash = false;
        s = atlas.ensure(noFlash);
      } else {
        s = atlas.ensure(visual);
      }
      this._sprites.set(key, s);
    }
    return s;
  }

  /** Drop an XP gem of the right tier for `value`. */
  dropGem(x, y, value) {
    const tiers = this.run.data.upgrades.XP_GEMS;
    // Pick the largest gem that fits, so a big drop is one gem not forty.
    let ti = 0;
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (value >= tiers[i].value) { ti = i; break; }
    }
    const def = tiers[ti];
    const p = this._take();
    if (!p) return null;
    p.kind = PICKUP_KIND.GEM;
    p.tier = ti;
    p.value = value;
    this._place(p, x, y, def.visual);
    p.popT = feel.gemPopTime;
    const a = fxRng.angle();
    p.vx = Math.cos(a) * feel.gemPopSpeed;
    p.vy = Math.sin(a) * feel.gemPopSpeed;
    this.gemCount++;
    return p;
  }

  dropGold(x, y, amount) {
    const p = this._take();
    if (!p) return null;
    p.kind = PICKUP_KIND.GOLD;
    p.value = amount;
    this._place(p, x, y, GOLD_VISUAL);
    p.popT = feel.gemPopTime;
    const a = fxRng.angle();
    p.vx = Math.cos(a) * feel.gemPopSpeed * 0.8;
    p.vy = Math.sin(a) * feel.gemPopSpeed * 0.8;
    return p;
  }

  /** Spawn one of the named world pickups by id from data/upgrades.js PICKUPS. */
  dropPickup(x, y, id, payload) {
    const def = this.run.data.upgrades.PICKUPS.find((d) => d.id === id);
    if (!def) return null;
    const p = this._take();
    if (!p) return null;
    p.kind = KIND_FROM_ID[id] !== undefined ? KIND_FROM_ID[id] : PICKUP_KIND.HEART;
    p.value = def.value || 0;
    p.payload = payload || def;
    this._place(p, x, y, def.visual);
    p.life = def.despawn || 0;
    p.popT = 0.2;
    return p;
  }

  dropChest(x, y, gold) {
    const p = this.dropPickup(x, y, gold ? 'gold_chest' : 'chest');
    if (p) p.kind = gold ? PICKUP_KIND.GOLD_CHEST : PICKUP_KIND.CHEST;
    return p;
  }

  /**
   * A boss weapon crate. The PAYLOAD IS THE WEAPON DEFINITION ITSELF, not its
   * id: draw() prints the weapon's icon and name above the crate every frame it
   * is on screen, and a map lookup per crate per frame to recover something the
   * caller already had in its hand would be a lookup for nothing.
   */
  dropWeapon(x, y, def) {
    const p = this.dropPickup(x, y, 'weapon_crate', def);
    // p.x, not x: the crate may have been pushed off a wall on its way down, and
    // a burst ring left behind at the requested spot points at nothing.
    if (p) particles.ring(p.x, p.y, 14, '#6ad8ff', 240);
    return p;
  }

  dropRelic(x, y, relicId) {
    const relic = this.run.data.relics.RELICS_BY_ID[relicId];
    if (!relic) return null;
    const p = this._take();
    if (!p) return null;
    p.kind = PICKUP_KIND.RELIC;
    p.payload = relicId;
    this._place(p, x, y, relic.visual || RELIC_VISUAL);
    p.popT = 0.35;
    particles.ring(p.x, p.y, 16, '#ffd76a', 260);
    audio.play('relic');
    return p;
  }

  _take() {
    if (this.pool.count >= this.pool.max) {
      // At the cap, sacrifice the lowest-value gem furthest from the player.
      this._forceMerge();
      if (this.pool.count >= this.pool.max) return null;
    }
    return this.pool.spawn();
  }

  /**
   * NOTHING EVER LANDS ON A WALL.
   *
   * Every drop in the game funnels through here — dropGem, dropGold, dropPickup
   * and therefore dropChest and dropWeapon, and dropRelic — so this is the one
   * place the rule has to be stated. See ObstacleField.pushOut for why a drop
   * inside static geometry is not a cosmetic problem: a chest, a relic, a weapon
   * crate and a heart are collected by TOUCH, and the player cannot get close
   * enough to a drop at the centre of a blocker to take it.
   *
   * The visual is resolved BEFORE the push because the clearance is the drop's
   * own radius: a crate has to end up a crate's width off the wall, not with its
   * centre exactly on the surface and half its sprite still buried.
   */
  _place(p, x, y, visual) {
    p.visual = visual;
    p.sprite = this._sprite(visual);
    p.radius = (visual.size || 8) + 4;
    const obstacles = this.run.obstacles;
    if (obstacles.count > 0 && obstacles.pushOut(x, y, p.radius, FREE)) {
      x = FREE.x; y = FREE.y;
    }
    p.x = p.px = x; p.y = p.py = y;
    p.vx = 0; p.vy = 0;
    p.scale = 1;
    p.magnetT = 0;
    p.merged = 0;
    p.bob = fxRng.raw() * TAU;
    p.used = false;
  }

  /**
   * PUSH EVERY PICKUP OUT OF THE GEOMETRY, ONCE.
   *
   * For the case where the WALL ARRIVES ON TOP OF THE LOOT rather than the other
   * way round: the collapsing-walls hazard drops a blocking circle wherever it
   * telegraphed, and the shifting-rooms hazard clears the field and builds new
   * corridors on top of whatever was lying there. Either can bury a chest that
   * has been on the floor for two minutes.
   *
   * O(pickups x obstacles) and therefore NOT a per-frame call. It runs once per
   * wall event — a few times a minute on the two stages that have one.
   */
  evictFromObstacles() {
    const obstacles = this.run.obstacles;
    if (obstacles.count === 0) return;
    const items = this.pool.items;
    for (let i = 0; i < this.pool.count; i++) {
      const g = items[i];
      if (obstacles.pushOut(g.x, g.y, g.radius, FREE)) {
        // px/py too, or the render interpolation slides it across the new wall.
        g.x = g.px = FREE.x;
        g.y = g.py = FREE.y;
      }
    }
  }

  update(dt) {
    const run = this.run;
    const obstacles = run.obstacles;
    const p = run.player;
    const items = this.pool.items;
    const pickupR = p.stats.pickupRadius;
    const pickupR2 = pickupR * pickupR;

    // Periodic merge pass — every 0.5s, not every frame.
    this._mergeT -= dt;
    if (this._mergeT <= 0) {
      this._mergeT = 0.5;
      if (this.gemCount > CONFIG.GEM_MERGE_THRESHOLD) this._mergePass();
    }

    for (let i = 0; i < this.pool.count; i++) {
      const g = items[i];
      g.px = g.x; g.py = g.y;

      if (g.life > 0) {
        g.life -= dt;
        if (g.life <= 0) { this._release(g); i--; continue; }
      }

      if (g.popT > 0) {
        // Outward pop before it becomes collectable — reads as loot bursting out.
        g.popT -= dt;
        g.x += g.vx * dt; g.y += g.vy * dt;
        g.vx *= 1 - 7 * dt; g.vy *= 1 - 7 * dt;
        // THE POP CAN UNDO THE PUSH-OUT. It is a random direction at 130 px/s for
        // 0.28s — up to ~25px of travel _place knew nothing about, and roughly
        // half of those directions point back at the wall the drop was just moved
        // clear of. Re-resolve on the ONE tick the pop ENDS rather than on every
        // tick of it: this is the only tick whose position anything keeps, and
        // doing it per-tick would be 128 compares per popping gem per frame.
        if (g.popT <= 0 && obstacles.count > 0 &&
            obstacles.pushOut(g.x, g.y, g.radius, FREE)) {
          g.x = g.px = FREE.x;
          g.y = g.py = FREE.y;
          g.vx = 0; g.vy = 0;
        }
        continue;
      }

      g.bob += dt * 3;

      const d2 = dist2(g.x, g.y, p.x, p.y);
      const isCollectable = g.kind === PICKUP_KIND.GEM || g.kind === PICKUP_KIND.GOLD;

      if (isCollectable) {
        if (g.magnetT > 0 || d2 < pickupR2) {
          // THE MAGNET ARC — a STEER, not a force accumulator.
          //
          // Adding acceleration toward the player without damping makes a gem
          // build speed, overshoot, and then have to brake from the far side:
          // it orbits the player forever and never arrives. Steering the
          // velocity toward the target instead keeps the easing (slow start,
          // violent finish) while guaranteeing it converges.
          g.magnetT += dt;
          const t = clamp(g.magnetT / 0.55, 0, 1);
          const speed = 90 + easeInExpo(t) * (feel.magnetMaxSpeed - 90);
          const dist = dirTo(g.x, g.y, p.x, p.y);   // writes the unit dir into V
          if (dist > 0.5) {
            const wantX = V.x * speed, wantY = V.y * speed;
            // Strong steering, but not a hard snap — the curve is what sells it.
            const k = clamp(dt * 14, 0, 1);
            g.vx += (wantX - g.vx) * k;
            g.vy += (wantY - g.vy) * k;
          }
          const stepX = g.vx * dt, stepY = g.vy * dt;
          g.x += stepX; g.y += stepY;

          // Collect against the distance AFTER moving, with a radius that grows
          // with this tick's travel. At 1500 px/s a gem covers 25px per tick and
          // would otherwise tunnel straight through a fixed 16px window.
          const travel = Math.hypot(stepX, stepY);
          const snap = Math.max(feel.magnetSnapDistance, travel * 0.75 + 8);
          if (dist2(g.x, g.y, p.x, p.y) < snap * snap) {
            this._collect(g);
            i--; continue;
          }
        }
      } else {
        // World pickups are picked up by touching them, always.
        const r = g.radius + 18;
        if (d2 < r * r) { this._collect(g); i--; continue; }
      }
    }
  }

  /** Pull EVERY gem on the map — the Magnet pickup. */
  magnetAll() {
    const items = this.pool.items;
    for (let i = 0; i < this.pool.count; i++) {
      const g = items[i];
      if (g.kind === PICKUP_KIND.GEM || g.kind === PICKUP_KIND.GOLD) {
        g.magnetT = 0.001;
        g.popT = 0;
      }
    }
  }

  _mergePass() {
    // Merge gems that are close together into the next tier up. One pass over the
    // dense array using the pickup hash; cheap and it runs twice a second.
    const items = this.pool.items;
    const cell = 90;
    const buckets = this._buckets || (this._buckets = new Map());
    buckets.clear();
    for (let i = 0; i < this.pool.count; i++) {
      const g = items[i];
      if (g.kind !== PICKUP_KIND.GEM || g.magnetT > 0 || g.popT > 0) continue;
      const key = ((g.x / cell) | 0) * 8191 + ((g.y / cell) | 0);
      const head = buckets.get(key);
      if (head === undefined) { buckets.set(key, g); continue; }
      // Merge g into head.
      head.value += g.value;
      head.merged++;
      this._retier(head);
      this._release(g);
      this.gemCount--;
      i--;
    }
  }

  _forceMerge() {
    this._mergePass();
    if (this.pool.count < this.pool.max) return;
    // Still full: collapse the two furthest gems regardless of proximity.
    const items = this.pool.items;
    const p = this.run.player;
    let worst = -1, worstD = -1;
    for (let i = 0; i < this.pool.count; i++) {
      const g = items[i];
      if (g.kind !== PICKUP_KIND.GEM) continue;
      const d = dist2(g.x, g.y, p.x, p.y);
      if (d > worstD) { worstD = d; worst = i; }
    }
    if (worst >= 0) {
      // Do not delete value — bank it onto the player so the run stays honest.
      this.run.grantXp(items[worst].value);
      this._release(items[worst]);
      this.gemCount--;
    }
  }

  _retier(g) {
    const tiers = this.run.data.upgrades.XP_GEMS;
    let ti = 0;
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (g.value >= tiers[i].value) { ti = i; break; }
    }
    if (ti !== g.tier) {
      g.tier = ti;
      g.visual = tiers[ti].visual;
      g.sprite = this._sprite(g.visual);
      g.radius = (g.visual.size || 8) + 4;
    }
    // A merged gem is visibly chunkier even inside a tier.
    g.scale = clamp(1 + g.merged * 0.06, 1, 1.9);
  }

  _release(g) {
    if (g.kind === PICKUP_KIND.GEM) this.gemCount = Math.max(0, this.gemCount - 1);
    this.pool.release(g);
  }

  _collect(g) {
    const run = this.run;
    const p = run.player;
    switch (g.kind) {
      case PICKUP_KIND.GEM:
        run.grantXp(g.value);
        audio.play('pickup');
        break;
      case PICKUP_KIND.GOLD:
        run.grantGold(g.value);
        audio.play('gold');
        break;
      case PICKUP_KIND.HEART:
        healPlayer(run, p.maxHp * (g.payload.value || 0.2));
        floaters.spawn(p.x, p.y - 40, 'HEAL', '#7bf59a', 20, 0.9);
        break;
      case PICKUP_KIND.MAGNET:
        this.magnetAll();
        floaters.spawn(p.x, p.y - 40, 'MAGNET', '#6ad8ff', 22, 1.0);
        audio.play('levelUp');
        break;
      case PICKUP_KIND.BOMB:
        run.screenClear();
        floaters.spawn(p.x, p.y - 40, 'BOOM', '#ff7a3d', 26, 1.1);
        break;
      case PICKUP_KIND.BENTO:
        run.addBuff('bento', 60, { damageMult: 0.10 });
        floaters.spawn(p.x, p.y - 40, '+10% DAMAGE (60s)', '#ffd76a', 18, 1.2);
        break;
      case PICKUP_KIND.HOURGLASS:
        run.slowAllEnemies(0.5, 8);
        floaters.spawn(p.x, p.y - 40, 'TIME STOP', '#c58cff', 22, 1.1);
        break;
      case PICKUP_KIND.CHEST:
        run.openChest(false, g.x, g.y);
        break;
      case PICKUP_KIND.GOLD_CHEST:
        run.openChest(true, g.x, g.y);
        break;
      case PICKUP_KIND.RELIC:
        run.offerRelic(g.payload);
        break;
      case PICKUP_KIND.WEAPON:
        // run.takeWeaponDrop owns the "is this still worth anything" question
        // and its own floater, because it is the only thing that knows whether
        // the slot it was going to fill is still free.
        run.takeWeaponDrop(g.payload);
        break;
      case PICKUP_KIND.SHRINE:
        // Stationary interactable — handled by run.update proximity, not consumed.
        return;
    }
    events.emit(EV.PICKUP_TAKEN, g.kind, g.value);
    particles.burst(g.x, g.y, 4, g.visual.color, { speed: 90, life: 0.22, size: 0.3, additive: true });
    this._release(g);
  }

  clear() { this.pool.clear(); this.gemCount = 0; }

  draw(r, alpha) {
    const items = this.pool.items;
    for (let i = 0; i < this.pool.count; i++) {
      const g = items[i];
      const x = g.px + (g.x - g.px) * alpha;
      const y = g.py + (g.y - g.py) * alpha;
      // Pickups PULSE (SECTION 1's readability rule).
      const pulse = 1 + Math.sin(g.bob) * 0.10;
      const yOff = g.kind >= PICKUP_KIND.HEART ? Math.sin(g.bob * 0.7) * 3 : 0;
      r.drawSprite(g.sprite, x, y + yOff, 0, g.scale * pulse, 1, false, 0);

      // THE WEAPON CRATE NAMES ITSELF, IN THE WORLD, FOR AS LONG AS IT LIES
      // THERE.
      //
      // Everything else on this list is a thing you already know from its
      // colour: the red one heals, the purple one stops time. A weapon crate is
      // a PERMANENT SLOT DECISION a boss just handed you, and "walk over the
      // blue box and find out what was in it" is not a decision — it is a coin
      // flip the player is not allowed to decline. So it prints the weapon's
      // own icon and name above itself and lets them choose.
      //
      // drawText's docstring says never to call it per entity. That warning is
      // about damage numbers — hundreds a second, which is why they have their
      // own pre-rastered glyph path. A stage drops at most four or five crates
      // in twenty minutes and rarely two at once, which is the same volume the
      // floaters layer already spends this exact call on.
      if (g.kind === PICKUP_KIND.WEAPON && g.payload) {
        const ly = y + yOff - g.radius - 12;
        r.drawText(g.payload.icon + ' ' + g.payload.name, x, ly, WEAPON_LABEL);
        r.drawText('WEAPON DROP', x, ly - 15, WEAPON_LABEL_SUB);
      }
    }
    r.setAlpha(1);
  }
}

// Per-frame option bags are module-level constants, never built inside draw().
const WEAPON_LABEL = {
  size: 15, weight: 800, color: '#cfefff', align: 'center', baseline: 'middle',
  outline: true,
};
const WEAPON_LABEL_SUB = {
  size: 11, weight: 800, color: '#6ad8ff', align: 'center', baseline: 'middle',
  outline: true,
};

/**
 * Scratch for the obstacle push-out. Module-level and never read across calls,
 * for the same reason PUSH is in obstacles.js: a drop must not allocate.
 */
const FREE = { x: 0, y: 0 };

const GOLD_VISUAL = { shape: 'circle', color: '#ffd76a', accent: '#7a5200', size: 6, glow: true };
const RELIC_VISUAL = { shape: 'star', color: '#ffd76a', accent: '#6b4200', size: 15, glow: true };

const KIND_FROM_ID = {
  heart: PICKUP_KIND.HEART, magnet: PICKUP_KIND.MAGNET, bomb: PICKUP_KIND.BOMB,
  coin_pile: PICKUP_KIND.GOLD, bento_box: PICKUP_KIND.BENTO,
  hourglass: PICKUP_KIND.HOURGLASS, chest: PICKUP_KIND.CHEST,
  gold_chest: PICKUP_KIND.GOLD_CHEST, shrine: PICKUP_KIND.SHRINE,
  weapon_crate: PICKUP_KIND.WEAPON,
};
