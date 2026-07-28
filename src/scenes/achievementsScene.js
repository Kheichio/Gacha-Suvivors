// ACHIEVEMENTS — SECTION 12, hub node 5. Forty of them.
//
// This screen CLAIMS NOTHING. src/game/achievements.js grants the reward the
// instant the condition trips, so by the time a row turns gold the fragments are
// already in the wallet. This is a viewer and a progress tracker, and it says so
// out loud at the top rather than growing a COLLECT button nobody needs.
//
// Hidden rows (hidden:true) read ??? until they fire and then reveal completely —
// name, description, reward and the joke, all at once. That reveal IS the joke,
// so nothing here spoils it early. Note that none of the three real unlock gates
// (DECISIONS.md §24) is hidden; you can always see what you are working toward.
//
// THE LIST is 50 slots deep and roughly 42 of them are off-screen at any window
// size, so it carries a real draggable scrollbar rather than a painted 3px
// indicator, and the wheel only turns it while the cursor is actually over it.
// Rows are clickable — a click replays the achievement's line — and they now say
// so, both in the strapline and on the focused row, because a 1200px click
// target with no affordance is a trap either way.
//
// PROGRESS is read straight out of save.data.stats / roster / stages / gacha.
// It is computed here rather than through Achievements.progress() for one
// reason: the engine's `_value()` reads cond.stage and cond.tier, while the data
// writes cond.target. Until those agree, the per-stage and per-tier rows would
// all draw a flat 0. The bars on this screen tell the truth today.

import { ui, PALETTE, wrapText } from '../ui/widgets.js';
import { input, ACT } from '../core/input.js';
import { save } from '../core/save.js';
import { audio } from '../core/audio.js';

// Achievement data carries no `category` field, so the category is derived from
// the condition kind. One table, ten groups, no per-id bookkeeping to drift.
const CATEGORY_OF = {
  runTime: 'SURVIVAL',
  endlessTime: 'SURVIVAL',
  runLevel: 'LEVELS',
  runKills: 'BODY COUNT',
  totalKills: 'BODY COUNT',
  totalRuns: 'CAREER',
  totalWins: 'CAREER',
  characterWins: 'CAREER',
  bossKills: 'BOSSES',
  noDamageBoss: 'BOSSES',
  survivedStageManager: 'BOSSES',
  stageCleared: 'FIRST CLEARS',
  difficultyCleared: 'DIFFICULTY',
  allStagesCleared: 'DIFFICULTY',
  charactersOwned: 'COLLECTION',
  relicsOwned: 'COLLECTION',
  starLevel: 'COLLECTION',
  bondLevel: 'COLLECTION',
  codexEntries: 'COLLECTION',
  pullsTotal: 'THE MACHINE',
  fanLettersSpent: 'THE MACHINE',
  lost5050: 'THE MACHINE',
  goldTotal: 'BUILDS & ECONOMY',
  upgradeMaxed: 'BUILDS & ECONOMY',
  evolutionsFound: 'BUILDS & ECONOMY',
};

const CATEGORY_ORDER = [
  'SURVIVAL', 'LEVELS', 'BODY COUNT', 'CAREER', 'BOSSES',
  'FIRST CLEARS', 'DIFFICULTY', 'COLLECTION', 'THE MACHINE', 'BUILDS & ECONOMY',
];

const CATEGORY_BLURB = {
  'SURVIVAL': 'Stay upright. That is the entire brief.',
  'LEVELS': 'The upgrade screen is the real final boss.',
  'BODY COUNT': 'At a certain point you stop being a fighter and become weather.',
  'CAREER': 'Runs started, runs closed, lights nobody bothers switching off.',
  'BOSSES': 'Read the telegraph. Then read it again, properly, this time.',
  'FIRST CLEARS': 'Seven stages, seven endings, seven very tired protagonists.',
  'DIFFICULTY': 'Opt-in suffering. Generously priced.',
  'COLLECTION': 'It stopped being a roster and became a workplace.',
  'THE MACHINE': 'It rattles. It knows. It does not care.',
  'BUILDS & ECONOMY': 'Gold in, evolutions out.',
};

const UNLOCK_LABEL = {
  curse: 'CURSE at the Shrine',
  relicBanner: 'the Signature Gear banner',
  encoreTier: 'Encore difficulty',
  endless: 'Endless Mode',
};

// Kinds whose value is a per-run peak the save blob never keeps. A bar would be
// a lie, so these get an honest label instead.
const PER_RUN_ONLY = {
  runKills: 'IN A SINGLE RUN',
  noDamageBoss: 'IN A SINGLE FIGHT',
  lost5050: 'WHEN IT HAPPENS',
  upgradeMaxed: 'IN A SINGLE RUN',
  evolutionsFound: 'IN A SINGLE RUN',
};

const TIME_KINDS = { runTime: 1, endlessTime: 1, survivedStageManager: 1 };

const FILTERS = [
  { id: 'all', label: 'SHOWING: EVERYTHING' },
  { id: 'locked', label: 'SHOWING: STILL TO DO' },
  { id: 'done', label: 'SHOWING: EARNED' },
];

const HEAD_H = 40;
const ROW_H = 66;

const EMPTY_MAP = {};

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

function commas(n) {
  const s = String(Math.floor(n));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function mmss(sec) {
  const s = Math.max(0, Math.floor(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/**
 * The engine writes Date.now() into save.data.achievements[id]; the save-blob
 * comment calls the field "unlockedAtSeconds". Accept either rather than print
 * a date in 1970.
 */
function fmtWhen(stamp) {
  if (!stamp) return '';
  const ms = stamp < 1e11 ? stamp * 1000 : stamp;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString() + '  ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return d.toISOString().slice(0, 16).replace('T', '  ');
  }
}

function rewardText(reward) {
  if (!reward) return '—';
  const parts = [];
  if (reward.starFragments) parts.push(reward.starFragments + '💎');
  if (reward.tickets) parts.push(reward.tickets + '🎟');
  if (reward.universalLetters) parts.push(reward.universalLetters + '💌');
  if (reward.gold) parts.push(commas(reward.gold) + '⭐');
  if (reward.unlock) parts.push('UNLOCKS ' + (UNLOCK_LABEL[reward.unlock] || reward.unlock));
  if (reward.costume) parts.push('A COSTUME TINT');
  return parts.length ? parts.join('  ·  ') : '—';
}

export const achievementsScene = {
  manager: null,

  enter(params, mgr) {
    this.manager = mgr || this.manager;
    this.filter = 0;
    this.scroll = 0;
    this.list = this.manager.data.achievements.ACHIEVEMENTS;
    this._rebuild();
  },

  exit() {},

  update(dt) { /* immediate-mode: the screen is built in render() */ },

  clearColor() { return '#05060d'; },

  // --- model -----------------------------------------------------------------

  _unlockedAt(id) { return save.data.achievements[id] || 0; },

  _isUnlocked(id) { return save.data.achievements[id] !== undefined; },

  _tierIndex(tierId) {
    const tiers = this.manager.data.stages.DIFFICULTY_TIERS;
    for (let i = 0; i < tiers.length; i++) if (tiers[i].id === tierId) return i;
    return 0;
  },

  /**
   * Current value for a countable condition, or null when the condition is a
   * per-run event the save blob does not keep a lifetime record of.
   */
  _current(cond) {
    const s = save.data.stats;
    const d = save.data;
    switch (cond.kind) {
      case 'runTime': return s.longestRun || 0;
      case 'runLevel': return s.highestLevel || 0;
      case 'totalKills': return s.kills || 0;
      case 'totalRuns': return s.runs || 0;
      case 'totalWins': return s.wins || 0;
      case 'bossKills': return s.bossKills || 0;
      case 'goldTotal': return s.goldEarned || 0;
      case 'survivedStageManager': return s.stageManagerSurvived || 0;
      case 'fanLettersSpent': return s.fanLettersSpent || 0;
      case 'pullsTotal': return d.gacha.totalPulls || 0;
      case 'charactersOwned': {
        let n = 0; for (const k in d.roster) if (d.roster[k].owned) n++; return n;
      }
      case 'relicsOwned': {
        let n = 0; for (const k in d.relics) if (d.relics[k].owned) n++; return n;
      }
      case 'starLevel': {
        let best = 1; for (const k in d.roster) best = Math.max(best, d.roster[k].starLevel || 1); return best;
      }
      case 'bondLevel': {
        let best = 0; for (const k in d.roster) best = Math.max(best, d.roster[k].bond || 0); return best;
      }
      case 'codexEntries': {
        let n = 0;
        const codex = d.codex || EMPTY_MAP;
        for (const cat of ['enemies', 'bosses', 'relics', 'characters']) {
          const m = codex[cat] || EMPTY_MAP;
          for (const k in m) if (m[k]) n++;
        }
        return n;
      }
      case 'endlessTime': {
        let best = 0; for (const k in d.endless) best = Math.max(best, d.endless[k] || 0); return best;
      }
      case 'stageCleared': {
        const e = d.stages[cond.target];
        return e && e.cleared ? 1 : 0;
      }
      case 'characterWins': {
        if (cond.target) { const e = d.roster[cond.target]; return (e && e.wins) || 0; }
        let n = 0; for (const k in d.roster) n += (d.roster[k].wins || 0); return n;
      }
      case 'difficultyCleared':
      case 'allStagesCleared': {
        const want = this._tierIndex(cond.target);
        let n = 0;
        for (const st of this.manager.data.stages.STAGES) {
          const e = d.stages[st.id];
          if (e && e.bestTier >= want) n++;
        }
        return n;
      }
      default: return null;      // per-run only
    }
  },

  _progress(a) {
    if (!a.condition) return null;
    if (PER_RUN_ONLY[a.condition.kind]) return null;
    const cur = this._current(a.condition);
    if (cur === null) return null;
    const target = a.condition.value || 1;
    return { current: Math.min(cur, target), raw: cur, target, fraction: target > 0 ? Math.min(1, cur / target) : 0 };
  },

  _fmtCount(kind, v) {
    if (TIME_KINDS[kind]) return mmss(v);
    return commas(v);
  },

  /** Rebuild the flat slot list: category headers interleaved with rows. */
  _rebuild() {
    const filter = FILTERS[this.filter].id;
    const groups = Object.create(null);
    for (const a of this.list) {
      const cat = (a.condition && CATEGORY_OF[a.condition.kind]) || 'MISCELLANY';
      (groups[cat] || (groups[cat] = [])).push(a);
    }

    const slots = [];
    let hidden = 0;
    let paidFragments = 0, paidTickets = 0, paidLetters = 0;
    for (const a of this.list) {
      if (a.hidden && !this._isUnlocked(a.id)) hidden++;
      if (this._isUnlocked(a.id) && a.reward) {
        paidFragments += a.reward.starFragments || 0;
        paidTickets += a.reward.tickets || 0;
        paidLetters += a.reward.universalLetters || 0;
      }
    }

    const order = CATEGORY_ORDER.slice();
    for (const k in groups) if (order.indexOf(k) === -1) order.push(k);

    for (const cat of order) {
      const items = groups[cat];
      if (!items) continue;
      let done = 0;
      for (const a of items) if (this._isUnlocked(a.id)) done++;
      const shown = items.filter((a) => {
        if (filter === 'locked') return !this._isUnlocked(a.id);
        if (filter === 'done') return this._isUnlocked(a.id);
        return true;
      });
      if (!shown.length) continue;
      slots.push({ type: 'head', cat, done, total: items.length });
      for (const a of shown) slots.push({ type: 'ach', a });
    }

    this.slots = slots;
    this.hiddenLeft = hidden;
    this.paid = { fragments: paidFragments, tickets: paidTickets, letters: paidLetters };
    this.scroll = clamp(this.scroll, 0, Math.max(0, slots.length - 1));
  },

  _slotHeight(slot) { return slot.type === 'head' ? HEAD_H : ROW_H; },

  /**
   * The scroll position at which the LAST slot sits flush with the bottom.
   * `slots.length - 1` let the list scroll until one row sat alone on an
   * otherwise empty panel, which a draggable scrollbar makes very easy to hit.
   */
  _maxScroll(listH) {
    let s = this.slots.length;
    let used = 0;
    while (s > 0) {
      const h = this._slotHeight(this.slots[s - 1]);
      if (used + h > listH) break;
      used += h;
      s--;
    }
    return Math.max(0, Math.min(s, Math.max(0, this.slots.length - 1)));
  },

  // --- render ----------------------------------------------------------------
  render(r, alpha) {
    ui.begin(r, 'achievements');
    // The engine owns completion; this screen only reads it.
    const comp = this.manager.achievements
      ? this.manager.achievements.completion
      : { unlocked: 0, total: this.list.length, fraction: 0 };

    const W = r.w, H = r.h;
    const M = Math.round(clamp(W * 0.02, 14, 30));

    // ---- header -----------------------------------------------------------
    ui.title('ACHIEVEMENTS', M, 34, { size: 32 });
    ui.text('Rewards pay out the instant you earn them. Nothing here needs collecting — this is the scoreboard. ' +
      'Click a row to hear its line again.',
      M, 62, { size: 13, color: PALETTE.textFaint });

    const barW = Math.min(340, W * 0.28);
    const barX = W - M - barW;
    ui.text(comp.unlocked + ' / ' + comp.total + '   ·   ' + Math.round(comp.fraction * 100) + '% COMPLETE',
      W - M, 28, { size: 15, color: PALETTE.accent, align: 'right', weight: 800, mono: true });
    ui.bar(barX, 40, barW, 10, comp.fraction, PALETTE.accent);
    ui.text('PAID OUT SO FAR:  ' + this.paid.fragments + '💎   ' + this.paid.tickets + '🎟   ' + this.paid.letters + '💌',
      W - M, 64, { size: 12, color: PALETTE.textDim, align: 'right', mono: true });

    // ---- controls (focus 0, 1) -------------------------------------------
    const ctrlY = 84;
    if (ui.backButton(M, ctrlY)) { audio.play('uiBack'); this.manager.go('hub'); }
    // M + 120, not M + 100: ui.backButton is 108 wide now and the two hit boxes
    // overlapped, with BACK silently winning the shared 8px because it is
    // declared first.
    if (ui.button('filter', M + 120, ctrlY, 220, 40, FILTERS[this.filter].label, { size: 13 })) {
      this.filter = (this.filter + 1) % FILTERS.length;
      this.scroll = 0;
      this._rebuild();
    }
    const hiddenLine = this.hiddenLeft === 0
      ? 'Every hidden one has shown itself. There is nothing left up the sleeve.'
      : this.hiddenLeft + ' of these are hidden. They will not tell you what they are. That is the joke.';
    if (W > 900) ui.text(hiddenLine, M + 352, ctrlY + 20, { size: 12, color: PALETTE.textFaint });

    // ---- the list ---------------------------------------------------------
    const listY = ctrlY + 48;
    const listH = H - listY - M;
    const listW = W - M * 2;

    const maxScroll = this._maxScroll(listH);
    const rowW = listW - (maxScroll > 0 ? 14 : 0);

    // The wheel belongs to the LIST, not to the whole screen: a notch with the
    // cursor parked on BACK or on the filter button used to page 50 slots.
    if (input.wheel && ui.pointIn(M, listY, listW, listH)) {
      this.scroll = clamp(this.scroll + input.wheel, 0, maxScroll);
    }
    this.scroll = clamp(this.scroll, 0, maxScroll);

    // clipRect clips DRAWING only, so every row button carries the clip rect.
    const clip = { x: M, y: listY, w: rowW, h: listH };
    r.clipRect(M, listY, rowW, listH);
    let y = listY;
    let firstRowIdx = -1, lastRowIdx = -1;
    let i = this.scroll;
    for (; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const h = this._slotHeight(slot);
      if (y + h > listY + listH) break;
      if (slot.type === 'head') {
        this._drawHeader(r, M, y, rowW, slot);
      } else {
        const idx = ui.itemCount;
        if (firstRowIdx < 0) firstRowIdx = idx;
        lastRowIdx = idx;
        if (ui.button('ach' + slot.a.id, M, y, rowW, ROW_H - 6, '', { clip })) this._poke(slot.a);
        this._drawRow(r, M, y, rowW, ROW_H - 6, slot.a, ui.focus === idx);
      }
      y += h;
    }
    r.unclip();

    if (this.slots.length === 0) {
      ui.text('Nothing matches that filter. Try another one, or go and earn something.',
        M + 12, listY + 30, { size: 14, color: PALETTE.textFaint });
    }

    // A real, DRAGGABLE scrollbar. 42 of the 50 slots are off-screen at a
    // typical window size and the old affordance was a 3px painted rectangle —
    // there was no path to the bottom of this list without a wheel.
    if (maxScroll > 0) {
      const seen = this.slots.length - maxScroll;
      this.scroll = Math.round(ui.scrollbar('achScroll', M + listW - 10, listY, 8, listH,
        this.scroll, seen, this.slots.length));
      this.scroll = clamp(this.scroll, 0, maxScroll);
      if (i < this.slots.length) {
        ui.text('▾ ' + (this.slots.length - i) + ' MORE', M + rowW - 8, listY + listH - 10,
          { size: 11, color: PALETTE.textFaint, align: 'right', weight: 700 });
      }
    }

    // Keyboard/gamepad edge-scroll. ui.end() resolves navigation for the whole
    // screen from a flat index list, so when focus is already parked on the last
    // visible row a DOWN press has to move the WINDOW instead of the cursor.
    // Setting the toolkit's nav cooldown is what stops it doing both.
    if (firstRowIdx >= 0) {
      if (input.pressed(ACT.DOWN) && ui.focus === lastRowIdx && i < this.slots.length) {
        this.scroll = clamp(this.scroll + 1, 0, maxScroll);
        ui._navCooldown = 0.12;
        audio.play('uiMove');
      } else if (input.pressed(ACT.UP) && ui.focus === firstRowIdx && this.scroll > 0) {
        this.scroll = clamp(this.scroll - 1, 0, maxScroll);
        ui._navCooldown = 0.12;
        audio.play('uiMove');
      }
    }

    ui.focusGrid(1);
    ui.end();
  },

  /** Activating a row replays its line. Cheap, and the jokes deserve a rerun. */
  _poke(a) {
    const unlocked = this._isUnlocked(a.id);
    if (unlocked) {
      this.manager.toast(a.toast || a.desc, PALETTE.gold, a.icon || '🏆');
    } else if (a.hidden) {
      this.manager.toast('No hints. That is the entire bit.', PALETTE.textDim, '❓');
    } else {
      this.manager.toast(a.desc, PALETTE.accent2, a.icon || '🏆');
    }
  },

  _drawHeader(r, x, y, w, slot) {
    const frac = slot.total ? slot.done / slot.total : 0;
    const complete = slot.done === slot.total;
    ui.text(slot.cat, x + 4, y + 16, {
      size: 14, color: complete ? PALETTE.good : PALETTE.accent, weight: 800,
    });
    const catW = r.measureText(slot.cat, 14 * ui.scale, 800);
    ui.text(CATEGORY_BLURB[slot.cat] || '', x + 16 + catW, y + 17, { size: 12, color: PALETTE.textFaint });
    ui.text(slot.done + ' / ' + slot.total + '  ·  ' + Math.round(frac * 100) + '%', x + w - 8, y + 16, {
      size: 12, color: complete ? PALETTE.good : PALETTE.textDim, align: 'right', weight: 800, mono: true,
    });
    r.drawRect(x + 4, y + 28, w - 12, 1, PALETTE.border, 1);
    r.drawRect(x + 4, y + 28, (w - 12) * frac, 1.5, complete ? PALETTE.good : PALETTE.accent, 0.9);
  },

  _drawRow(r, x, y, w, h, a, focused) {
    const unlocked = this._isUnlocked(a.id);
    const secret = a.hidden && !unlocked;
    const statusW = Math.min(240, Math.max(150, w * 0.24));
    const textX = x + 58;
    const textW = w - 58 - statusW - 28;

    // Left rail: gold when earned, dim when not. It is NOT the focus cue — it
    // used to be overpainted in accent on the focused row, which meant hovering
    // an earned row changed a 3px stripe from gold to gold-ish and nothing else.
    r.drawRect(x + 3, y + 8, 3, h - 16, unlocked ? PALETTE.gold : PALETTE.textFaint, unlocked ? 1 : 0.4);

    ui.text(secret ? '❓' : (a.icon || '🏆'), x + 30, y + h / 2 - 4, {
      size: 24, align: 'center', alpha: unlocked ? 1 : 0.55,
    });

    const name = secret ? '???' : a.name;
    ui.text(name, textX, y + 20, {
      size: 15, weight: 800, color: unlocked ? PALETTE.text : (secret ? PALETTE.textFaint : PALETTE.textDim),
    });

    const desc = secret ? 'Hidden. You will find out the same way everyone does — abruptly.' : a.desc;
    const lines = wrapText(r, desc, Math.max(80, textW), 12 * ui.scale);
    ui.text(lines[0] || '', textX, y + 40, { size: 12, color: PALETTE.textFaint });
    if (lines.length > 1) ui.text(lines[1], textX, y + 54, { size: 12, color: PALETTE.textFaint });

    // Reward — always visible for non-hidden rows, because you should be able to
    // decide whether a row is worth chasing before you chase it.
    ui.text(secret ? '???' : rewardText(a.reward), x + w - 12, y + 20, {
      size: 12, align: 'right', weight: 800, mono: true,
      color: unlocked ? PALETTE.gold : (secret ? PALETTE.textFaint : PALETTE.accent),
    });

    // Status / progress.
    const sx = x + w - 12 - statusW;
    if (unlocked) {
      const when = fmtWhen(this._unlockedAt(a.id));
      ui.text('✓ EARNED' + (when ? '   ' + when : ''), x + w - 12, y + 44, {
        size: 12, align: 'right', color: PALETTE.good, weight: 700, mono: true,
      });
    } else if (secret) {
      ui.text('LOCKED', x + w - 12, y + 44, { size: 12, align: 'right', color: PALETTE.textFaint, weight: 700 });
    } else {
      const p = this._progress(a);
      if (p) {
        const kind = a.condition.kind;
        // A full bar on a locked row is not a bug: conditions are evaluated at
        // run end and on gacha pulls, so "the counter is there, the check has
        // not run yet" is a real state and it should say so.
        const ready = p.fraction >= 1;
        ui.bar(sx, y + h - 20, statusW, 8, p.fraction, ready ? PALETTE.good : PALETTE.accent2);
        ui.text(this._fmtCount(kind, p.raw) + ' / ' + this._fmtCount(kind, p.target) + (ready ? '   ·   READY' : ''),
          x + w - 12, y + h - 32, {
            size: 11, align: 'right', color: ready ? PALETTE.good : PALETTE.textDim, weight: 700, mono: true,
          });
      } else {
        const label = (a.condition && PER_RUN_ONLY[a.condition.kind]) || 'NOT YET';
        ui.text(label, x + w - 12, y + 44, {
          size: 11, align: 'right', color: PALETTE.textFaint, weight: 700,
        });
      }
    }

    // The real focus/hover treatment: a bracket frame, a fat accent rail, and a
    // stated affordance. A row this wide has to say what happens when you hit
    // it, and it is the only thing on the screen that has an answer.
    if (focused) {
      ui.brackets(x + 1, y, w - 2, h, PALETTE.borderHot, 18, 3);
      r.drawRect(x + 1, y + 4, 5, h - 8, PALETTE.accent, 1);
      r.drawRect(x + 1, y, w - 2, 1.5, PALETTE.borderHot, 0.5);
      r.drawRect(x + 1, y + h - 1.5, w - 2, 1.5, PALETTE.borderHot, 0.5);
      // Under the icon, which is the only column with room on every row shape.
      ui.text('▸ REPLAY', x + 30, y + h - 8, {
        size: 9, color: PALETTE.accent, weight: 800, align: 'center',
      });
    }
  },
};
