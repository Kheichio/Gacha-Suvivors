// =============================================================================
// src/core/admin.js — THE TESTING CONSOLE.
// =============================================================================
//
// Everything here writes the save file directly and then calls `save.touch()`,
// which is the same door the shop, the gacha and the results screen already go
// through. Nothing bypasses a system: granting a character calls the same
// roster shape `rosterEntry` builds, unlocking a stage writes the same
// `{ cleared }` flag a real clear writes, and every currency goes through
// `addCurrency` so the lifetime-earned stats stay honest.
//
// WHY IT IS ALWAYS ON. `DEV_MODE` is the flag that hides the ref names, and it
// is off in anything resembling a shipping build — gating the test console on it
// would mean the one build worth testing is the one that cannot be tested. It is
// namespaced on `window.gs` and it announces itself once in the console; if it
// ever needs to go, delete the `attachAdmin()` call in main.js and this file.
//
// EVERY COMMAND RETURNS A STRING, so the browser console prints a confirmation
// rather than `undefined`. That is the whole reason a testing tool feels usable.
// =============================================================================

import { save, addCurrency, defaultSave } from './save.js';

/** Filled by attachAdmin, so this module never imports the data layer. */
let DATA = null;

const CURRENCIES = ['gold', 'starFragments', 'tickets', 'universalLetters'];

function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

function purse() {
  const c = save.data.currencies;
  return CURRENCIES.map((k) => k + ' ' + fmt(c[k] || 0)).join('   ');
}

/** Every character id, or a validated single id. */
function charIds(id) {
  const all = DATA.characters.CHARACTERS.map((c) => c.id);
  if (id === undefined) return all;
  return all.includes(id) ? [id] : null;
}

export const admin = {
  // --- currency -------------------------------------------------------------

  /** Star fragments — the premium "gems". `gs.gems()` defaults to 10,000. */
  gems(n) {
    addCurrency('starFragments', n === undefined ? 10000 : n);
    return 'star fragments +' + fmt(n === undefined ? 10000 : n) + '   |   ' + purse();
  },
  gold(n) {
    addCurrency('gold', n === undefined ? 100000 : n);
    return 'gold +' + fmt(n === undefined ? 100000 : n) + '   |   ' + purse();
  },
  tickets(n) {
    addCurrency('tickets', n === undefined ? 100 : n);
    return 'tickets +' + fmt(n === undefined ? 100 : n) + '   |   ' + purse();
  },
  letters(n) {
    addCurrency('universalLetters', n === undefined ? 500 : n);
    return 'universal letters +' + fmt(n === undefined ? 500 : n) + '   |   ' + purse();
  },
  /** All four at once, which is what you actually want before a test session. */
  rich() {
    admin.gems(); admin.gold(); admin.tickets(); admin.letters();
    return 'topped up   |   ' + purse();
  },
  purse() { return purse(); },

  // --- roster ---------------------------------------------------------------

  /**
   * Grant a character, or everybody. `gs.give()` gives the whole roster at ★1;
   * `gs.give(id, 5)` gives one at ★5, with an id out of `gs.roster()`.
   *
   * No example here names a real character, and that is not fussiness: the
   * architecture rule in tests/run.js greps every file outside src/data/ and the
   * ability registry for a quoted character id and fails the build on a hit.
   * The rule exists so adding a character can never mean editing gameplay code,
   * and a doc comment is gameplay code as far as a grep is concerned.
   */
  give(id, star) {
    const ids = charIds(id);
    if (!ids) return 'no such character: ' + id + '  (try gs.roster())';
    const s = Math.max(1, Math.min(5, star || 1));
    for (const cid of ids) {
      const e = save.data.roster[cid] ||
        (save.data.roster[cid] = { owned: false, starLevel: 1, letters: 0, bond: 0, runs: 0, kills: 0 });
      e.owned = true;
      e.starLevel = Math.max(e.starLevel, s);
    }
    save.touch();
    return 'granted ' + ids.length + ' character(s) at ★' + s;
  },

  /** Set star level on one character, or on everybody owned. */
  star(id, level) {
    const s = Math.max(1, Math.min(5, level === undefined ? 5 : level));
    const ids = id === undefined ? charIds() : charIds(id);
    if (!ids) return 'no such character: ' + id;
    let n = 0;
    for (const cid of ids) {
      const e = save.data.roster[cid];
      if (!e || !e.owned) continue;
      e.starLevel = s; n++;
    }
    save.touch();
    return n + ' character(s) set to ★' + s;
  },

  /** Print the roster with ownership and star level. */
  roster() {
    const rows = DATA.characters.CHARACTERS.map((c) => {
      const e = save.data.roster[c.id];
      const owned = e && e.owned;
      return '  ' + (owned ? '★' + e.starLevel : ' - ') + '  ' +
             c.id.padEnd(20) + '★' + c.rarity + '  ' + c.name;
    });
    return 'ROSTER (' + rows.length + ')\n' + rows.join('\n');
  },

  // --- relics ---------------------------------------------------------------

  /** Own and BANK a relic, or all of them. Banked relics get the 3x drop weight. */
  relic(id) {
    const all = DATA.relics.RELICS.map((r) => r.id);
    const ids = id === undefined ? all : (all.includes(id) ? [id] : null);
    if (!ids) return 'no such relic: ' + id + '  (try gs.relics())';
    for (const rid of ids) save.data.relics[rid] = { owned: true, banked: true };
    save.touch();
    return 'owned + banked ' + ids.length + ' relic(s)';
  },
  relics() {
    return 'RELICS (' + DATA.relics.RELICS.length + ')\n' +
      DATA.relics.RELICS.map((r) => {
        const e = save.data.relics[r.id];
        return '  ' + (e && e.banked ? 'B' : e && e.owned ? 'o' : '-') + '  ' +
               r.id.padEnd(28) + (r.owner || r.stageOwner || '');
      }).join('\n');
  },

  // --- progression ----------------------------------------------------------

  /** Mark every stage cleared, which is what unlocks the later ones. */
  stages() {
    for (const s of DATA.stages.STAGES) {
      const e = save.data.stages[s.id] ||
        (save.data.stages[s.id] = { cleared: false, bestTime: 0, bestTier: 0, clears: 0, mastery: 0 });
      e.cleared = true;
      e.clears = Math.max(1, e.clears);
    }
    save.touch();
    return 'all ' + DATA.stages.STAGES.length + ' stages marked cleared';
  },

  /** Every shrine upgrade to its max level. */
  shrine() {
    let n = 0;
    for (const u of DATA.shrine.SHRINE_UPGRADES || []) {
      save.data.shrine[u.id] = u.maxLevel || 1; n++;
    }
    save.touch();
    return n + ' shrine upgrade(s) maxed';
  },

  /** Unlock every achievement, so anything gated behind one opens. */
  achievements() {
    let n = 0;
    for (const a of DATA.achievements.ACHIEVEMENTS || []) {
      if (!save.data.achievements[a.id]) { save.data.achievements[a.id] = 1; n++; }
    }
    save.touch();
    return n + ' achievement(s) unlocked';
  },

  /** The lot. One call, then reload. */
  everything() {
    admin.rich(); admin.give(undefined, 5); admin.relic();
    admin.stages(); admin.shrine(); admin.achievements();
    return 'EVERYTHING granted. Reload the page to see it on every screen.';
  },

  // --- run-time -------------------------------------------------------------

  /** The live Run, if one is in progress. Handy for poking at state. */
  run() {
    const s = admin._scenes && admin._scenes.current;
    return (s && s.run) || null;
  },

  /**
   * Level the player up n times. Through `run.grantXp`, not by writing
   * `p.level`, so the pending-level-up queue, the stats ledger and the XP_GAINED
   * event all fire exactly as they would in play — a level granted by poking the
   * field would never open an upgrade card.
   */
  level(n) {
    const run = admin.run();
    if (!run) return 'no run in progress';
    const k = n === undefined ? 10 : n;
    for (let i = 0; i < k; i++) run.grantXp(run.player.xpToNext - run.player.xp + 1);
    return 'granted ' + k + ' level-up(s) — take the cards';
  },

  /** Make the player unkillable for the rest of the run. */
  god() {
    const run = admin.run();
    if (!run) return 'no run in progress';
    run.player.st.invulnT = 1e9;
    return 'invulnerable until the run ends';
  },

  /** Kill everything currently on screen. */
  nuke() {
    const run = admin.run();
    if (!run) return 'no run in progress';
    const n = run.enemies.count;
    run.enemies.clear();
    return 'cleared ' + n + ' enemies';
  },

  // --- housekeeping ---------------------------------------------------------

  /**
   * Wipe the save. Asks nothing — that is the point of a test tool.
   *
   * Through `defaultSave()` rather than by deleting the key, so the object the
   * rest of the game is holding a reference to stays the right SHAPE. Dropping
   * `save.data` to null instead leaves every screen that already read it
   * pointing at a corpse until the reload lands.
   */
  wipe() {
    const fresh = defaultSave();
    for (const k of Object.keys(save.data)) delete save.data[k];
    Object.assign(save.data, fresh);
    save.touch();
    save.flush ? save.flush() : null;
    return 'save wiped. Reload the page.';
  },

  help() {
    return [
      'GACHA SURVIVORS — testing console.  Everything is on `gs`.',
      '',
      'CURRENCY',
      '  gs.gems(n)        star fragments      (default 10,000)',
      '  gs.gold(n)        gold                (default 100,000)',
      '  gs.tickets(n)     pull tickets        (default 100)',
      '  gs.letters(n)     universal letters   (default 500)',
      '  gs.rich()         all four at once',
      '  gs.purse()        show current balances',
      '',
      'ROSTER',
      '  gs.give()         every character at ★1',
      '  gs.give(id, star) one character at a star level',
      '  gs.star(id, n)    set star level; omit id for everybody',
      '  gs.roster()       list every id, rarity and what you own',
      '                    (ids come from gs.roster() — this file must not',
      '                     quote one: tests/run.js fails the build on any',
      '                     character id written outside the data layer)',
      '',
      'RELICS / PROGRESS',
      '  gs.relic(id)      own + bank one relic; omit id for all',
      '  gs.relics()       list them',
      '  gs.stages()       mark every stage cleared',
      '  gs.shrine()       max every shrine upgrade',
      '  gs.achievements() unlock the lot',
      '  gs.everything()   all of the above, then reload',
      '',
      'IN A RUN',
      '  gs.level(n)       n level-ups        gs.god()   invulnerable',
      '  gs.nuke()         clear the screen   gs.run()   the live Run object',
      '',
      'DANGER',
      '  gs.wipe()         erase the save',
    ].join('\n');
  },
};

/**
 * Attach the console. Called once from main.js, after the data layer is built.
 * `scenes` is handed in so `gs.run()` can find the live run without this module
 * importing the scene layer and creating a cycle.
 */
export function attachAdmin(data, scenes) {
  DATA = data;
  if (typeof window === 'undefined') return;
  admin._scenes = scenes;
  window.gs = admin;
  // One line, once, so a tester who has never read this file still finds it.
  console.log('%c gs ', 'background:#ff5fa8;color:#101018;font-weight:700',
              'testing console ready — type  gs.help()');
}
