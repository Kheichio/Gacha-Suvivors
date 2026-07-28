// THE WEAPON SYSTEM — up to three weapons, each on its own timer and its own
// upgrade path.
//
// SLOT 0 IS ALWAYS THE SIGNATURE. A character's own auto-attack is a weapon like
// any other: it has a level, it starts nerfed, and it can evolve. It is the one
// weapon that does not fire from here, because it still goes through
// `run.update`'s auto-attack path — that is what keeps every relic hook, every
// minion mirror and THE FINAL FORM's move-stealing working unchanged. What this
// system does for it instead is publish `sigMods()`, a small bundle of
// multipliers the auto pipeline reads.
//
// WHY WEAPON LEVELS ARE NOT IN `player.upgrades`
// ----------------------------------------------
// That map is walked, summed and displayed by nine other places — a character
// passive that sums every value in it, the build-slot counter, the HUD grid, the
// results screen, the "Maxed Out" achievement — none of which would be wrong in
// a way that throws. They would just quietly report nonsense. Weapons get their
// own list, and the places that should know about them are told explicitly.

import { Interval } from '../core/timer.js';
import { events } from '../core/events.js';
import { WEAPON_IMPLS } from './abilities/weaponImpls.js';

/** The id slot 0 always carries. Not a real weapon id — no data row owns it. */
export const SIGNATURE_ID = '__signature';

export class WeaponSystem {
  constructor(run) {
    this.run = run;
    this.data = run.data.weapons;
    /** Slot records, index 0 the signature. Never longer than WEAPON_SLOTS. */
    this.slots = [];
    this._sig = null;
    /** Rebuilt on every change; the auto pipeline reads it every frame. */
    this.mods = { damage: 1, rate: 1, area: 1, count: 0, pierce: 0, evolved: false };
  }

  get max() { return this.data.WEAPON_SLOTS; }
  get count() { return this.slots.length; }
  get full() { return this.slots.length >= this.max; }

  /** Slot 0, created at run start and never removed. */
  init() {
    const w = {
      id: SIGNATURE_ID,
      def: null,                 // the signature has no data row; it IS the character
      signature: true,
      level: 1,
      evolved: false,
      timer: null,               // fired by run.update, not by this system
      phase: 0,
      state: Object.create(null),
    };
    this.slots.push(w);
    this._sig = w;
    this._rebuildMods();
  }

  has(id) {
    for (const w of this.slots) if (w.id === id) return true;
    return false;
  }

  get(id) {
    for (const w of this.slots) if (w.id === id) return w;
    return null;
  }

  /** Add a pickable weapon. Returns the record, or null when the slots are full. */
  add(id) {
    if (this.full || this.has(id)) return null;
    const def = this.data.WEAPONS_BY_ID[id];
    if (!def) return null;
    const w = {
      id, def,
      signature: false,
      level: 1,
      evolved: false,
      timer: new Interval(1, this.slots.length * 0.31),   // stagger the first shot
      phase: 0,
      state: Object.create(null),
    };
    this.slots.push(w);
    events.emit('weapon:taken', id, 1);
    return w;
  }

  levelUp(id) {
    const w = this.get(id);
    if (!w || w.evolved) return false;
    if (w.level >= this.maxLevel(w)) return false;
    w.level++;
    if (w.signature) this._rebuildMods();
    events.emit('weapon:taken', id, w.level);
    return true;
  }

  maxLevel(w) { return w.signature ? this.data.SIGNATURE_LEVELS.length : w.def.levels.length; }
  isMaxed(w) { return !w.evolved && w.level >= this.maxLevel(w); }

  /** Every weapon that is maxed and has an evolution waiting. */
  evolvable() {
    const out = [];
    for (const w of this.slots) if (this.isMaxed(w)) out.push(w);
    return out;
  }

  evolve(id) {
    const w = this.get(id);
    if (!w || w.evolved || !this.isMaxed(w)) return false;
    w.evolved = true;
    // Fresh scratch: the evolved form's persistent effects should start from
    // nothing rather than inherit a half-expired field timer.
    w.state = Object.create(null);
    if (w.signature) this._rebuildMods();
    events.emit('weapon:evolved', id);
    return true;
  }

  evolutionOf(w) {
    return w.signature ? this.data.SIGNATURE_EVOLUTION : w.def.evolution;
  }

  /** The display name of a slot. The signature borrows the character's. */
  nameOf(w) {
    if (w.evolved) return this.evolutionOf(w).name;
    return w.signature ? this.run.player.def.autoAttack.name : w.def.name;
  }

  /**
   * The signature borrows the CHARACTER'S OWN emoji rather than a generic star,
   * so the slot that holds your auto-attack is recognisable at a glance as
   * yours — the player has to be able to see that their basic attack is one of
   * the things on the upgrade list, not a separate system.
   */
  iconOf(w) {
    if (w.evolved) return this.evolutionOf(w).icon;
    if (!w.signature) return w.def.icon;
    const v = this.run.player.def.visual;
    return (v && v.emoji) || '★';
  }

  /** The stat row in force right now. Never mutated — treat it as read-only. */
  statsFor(w) {
    if (w.signature) {
      return w.evolved ? this.data.SIGNATURE_EVOLUTION.stats
                       : this.data.SIGNATURE_LEVELS[w.level - 1];
    }
    return w.evolved ? w.def.evolution.stats : w.def.levels[w.level - 1];
  }

  /**
   * What the auto-attack pipeline multiplies itself by.
   *
   * Recomputed on change rather than read per frame, in the same spirit as the
   * player's stat pipeline: a level-up is rare, a frame is not.
   */
  _rebuildMods() {
    const s = this.statsFor(this._sig);
    const m = this.mods;
    m.damage = s.damage;
    m.rate = s.rate;
    m.area = s.area;
    m.count = s.count || 0;
    m.pierce = s.pierce || 0;
    m.evolved = this._sig.evolved;
  }

  /**
   * Fire the non-signature weapons and maintain the standing effects of the
   * evolved ones. Called once per sim tick from Run.update.
   */
  update(dt) {
    const run = this.run;
    const p = run.player;
    if (p.dead) return;
    const cdMult = p.stats.cooldownMult;

    for (let i = 0; i < this.slots.length; i++) {
      const w = this.slots[i];
      if (w.signature) { this._tickSignature(w, dt); continue; }
      const impl = WEAPON_IMPLS[w.def.kind];
      if (!impl) continue;
      const s = this.statsFor(w);

      // A standing effect is maintained every frame; the periodic activation
      // still runs on top of it, which is what makes an evolution read as
      // "everything it did before, plus it never stops".
      if (w.evolved && s.persist && impl.persist) impl.persist(run, p, w, s, dt);

      // Attack speed shortens a weapon's interval exactly as it shortens the
      // auto-attack's; cooldown reduction does NOT, or Quick Recovery would be
      // a flat damage upgrade for three weapons at once.
      const period = Math.max(0.05, s.interval /
        (p.stats.attackSpeedMult * (p.flags.attackSpeedBonus || 1)));
      w.timer.set(period);
      const shots = w.timer.tick(dt);
      for (let k = 0; k < shots; k++) impl.fire(run, p, w, s);
    }
    // cdMult is deliberately read and unused: see the comment above. Keeping the
    // read makes the omission visible instead of looking like an oversight.
    void cdMult;
  }

  /**
   * The evolved signature's standing halo.
   *
   * The signature's SWINGS still come from run.update's auto path — this is the
   * part that has to be true even while you are standing still doing nothing,
   * which is what makes "always active" visibly different from "very fast".
   */
  _tickSignature(w, dt) {
    if (!w.evolved) return;
    const s = this.data.SIGNATURE_EVOLUTION.stats;
    if (!s.persist) return;
    const st = w.state;
    st.auraT = (st.auraT || 0) - dt;
    if (st.auraT > 0) return;
    st.auraT = 0.5;
    const p = this.run.player;
    const dps = s.auraDps * this.run.autoDef.damage * p.autoDamageMultiplier();
    this.run.hazards.spawnField(p.x, p.y, s.auraRadius * p.stats.areaMult, 0.6,
                                'burn', dps, p.visual.color, { follow: p });
  }

  /** Compact record for the run summary and the results screen. */
  summary() {
    const out = [];
    for (const w of this.slots) {
      out.push({
        id: w.id,
        name: this.nameOf(w),
        icon: this.iconOf(w),
        level: w.level,
        maxLevel: this.maxLevel(w),
        evolved: w.evolved,
        signature: w.signature,
      });
    }
    return out;
  }
}
