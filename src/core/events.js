// A tiny synchronous event bus.
//
// Used for cross-system reactions that must not create a dependency edge:
// relics listening for `enemy:killed`, achievements listening for everything,
// audio listening for `player:hurt`. Handlers run immediately, in registration
// order, and must not allocate.
//
// Payloads are passed as loose positional args rather than an object literal —
// deliberately, so emitting from the hot loop costs nothing.

class EventBus {
  constructor() {
    this.map = new Map();
    this.depth = 0;
  }

  on(name, fn) {
    let list = this.map.get(name);
    if (!list) { list = []; this.map.set(name, list); }
    list.push(fn);
    return fn;
  }

  once(name, fn) {
    const wrap = (a, b, c, d) => { this.off(name, wrap); fn(a, b, c, d); };
    return this.on(name, wrap);
  }

  off(name, fn) {
    const list = this.map.get(name);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  /** Remove every handler for a name, or the entire bus if name is omitted. */
  clear(name) {
    if (name === undefined) this.map.clear();
    else this.map.delete(name);
  }

  emit(name, a, b, c, d) {
    const list = this.map.get(name);
    if (!list || list.length === 0) return;
    this.depth++;
    // Index-based so a handler unsubscribing mid-emit cannot skip its neighbour.
    for (let i = 0; i < list.length; i++) {
      const fn = list[i];
      if (!fn) continue;
      fn(a, b, c, d);
      if (list[i] !== fn) i--; // a handler removed itself; re-check this slot
    }
    this.depth--;
  }
}

/** Global bus. Run-scoped subscriptions are cleared in `run.dispose()`. */
export const events = new EventBus();

/** A fresh bus, for tests and for the headless harness. */
export const createBus = () => new EventBus();

// --- the canonical event names ----------------------------------------------
// Keeping them here means a typo in a listener is a lint-visible undefined
// rather than a handler that silently never fires.
export const EV = {
  RUN_START:      'run:start',
  RUN_END:        'run:end',
  RUN_TICK:       'run:tick',

  PLAYER_HURT:    'player:hurt',
  PLAYER_HEAL:    'player:heal',
  PLAYER_DIED:    'player:died',
  PLAYER_REVIVED: 'player:revived',
  PLAYER_LEVELUP: 'player:levelup',
  PLAYER_MOVED:   'player:moved',

  ENEMY_SPAWNED:  'enemy:spawned',
  ENEMY_HIT:      'enemy:hit',
  ENEMY_KILLED:   'enemy:killed',
  ELITE_KILLED:   'elite:killed',
  BOSS_SPAWNED:   'boss:spawned',
  BOSS_PHASE:     'boss:phase',
  BOSS_KILLED:    'boss:killed',

  PICKUP_TAKEN:   'pickup:taken',
  CHEST_OPENED:   'chest:opened',
  GOLD_GAINED:    'gold:gained',
  XP_GAINED:      'xp:gained',

  UPGRADE_TAKEN:  'upgrade:taken',
  RELIC_TAKEN:    'relic:taken',
  EVOLUTION:      'evolution:gained',

  ABILITY_CAST:   'ability:cast',
  ESCAPE_CAST:    'escape:cast',

  GACHA_PULL:     'gacha:pull',
  ACHIEVEMENT:    'achievement:unlocked',

  SFX:            'sfx',
  SHAKE:          'shake',
  FLASH:          'flash',
  TOAST:          'toast',
  BARK:           'bark',
};
