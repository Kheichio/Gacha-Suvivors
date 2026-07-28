// THE CODEX — SECTION 12, hub node 7.
//
//   "Every enemy, boss, relic, and character you've seen, with flavor text.
//    This is where the world-building lives."
//
// Four content tabs plus one rules page:
//   ENEMIES  BOSSES  RELICS  CHARACTERS  ELEMENTS
//
// SEEN-NESS lives in save.data.codex.{enemies,bosses,relics,characters} as an
// id -> true map. Anything you have not met renders as ??? over a silhouette
// (the pre-rastered white flash frame of the real sprite, drawn dim — so the
// shape is honest and the name is not).
//
// Owning a character or a relic counts as having seen it, even if nothing ever
// wrote the codex flag. You do not need to be introduced to someone who works
// for you.
//
// DEV_MODE shows every entry regardless, tagged UNSEEN, and adds the refSource /
// refNotes lines. refs are joined onto the data objects at boot by
// src/data/index.js, so `entry.refNotes` simply exists (or does not, in a ship
// build, where refs.js is deleted and every line here degrades to nothing).
//
// The ELEMENTS page exists because DECISIONS.md §26 made the seven elements a
// real ±15% system instead of decoration. If the game applies it, the codex has
// to teach it.
//
// SCROLLING. Three surfaces here overflow and all three scroll the same way: a
// wheel gated on the surface's own rect, a DRAGGABLE ui.scrollbar, and a pair of
// ▲/▼ buttons on a plate for keyboard and gamepad. The card grid scrolls by ROWS
// (a wheel notch used to turn a whole page), and the ELEMENTS page scrolls at all
// (its matrix ran to y≈749 against a 720px screen, so the bottom two rows of the
// chart and the caption under them were unreachable).

import { ui, PALETTE, RARITY_COLOR, RARITY_NAME, wrapText, formatCount } from '../ui/widgets.js';
import { input } from '../core/input.js';
import { save } from '../core/save.js';
import { audio } from '../core/audio.js';
import { displayName, DEV_MODE } from '../core/config.js';
import { atlas } from '../render/spriteAtlas.js';

const TABS = [
  { id: 'enemies', label: 'ENEMIES' },
  { id: 'bosses', label: 'BOSSES' },
  { id: 'relics', label: 'RELICS' },
  { id: 'characters', label: 'CHARACTERS' },
  { id: 'elements', label: 'ELEMENTS' },
];

// Relics are rated rare/epic/legendary, not 3-6 stars. Map them onto the same
// three colours the rest of the game already uses so nothing has to be learned
// twice.
const RELIC_RARITY_COLOR = { rare: RARITY_COLOR[3], epic: RARITY_COLOR[4], legendary: RARITY_COLOR[5] };
const RELIC_RARITY_NAME = { rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY' };

const BOSS_KIND_LABEL = { boss: 'STAGE BOSS', midboss: 'MID-BOSS', elite: 'NAMED ELITE', sweeper: 'SWEEPER' };
const BOSS_KIND_COLOR = { boss: '#ff5fa2', midboss: '#ffd76a', elite: '#c58cff', sweeper: '#e8ecf5' };
const TIER_LABEL = { 1: 'TIER 1 · FODDER', 2: 'TIER 2 · PRESSURE', 3: 'TIER 3 · THREAT' };
const TIER_COLOR = { 1: '#6ad8ff', 2: '#ffd76a', 3: '#ff5fa2' };

const TELEGRAPH_HINT = {
  red: 'red — damage zone, get out',
  yellow: 'yellow — wind-up, it comes from here',
  blue: 'blue — safe zone, stand here',
  white: 'white — unavoidable, ESCAPE NOW',
};

// The one line every empty codex slot gets. Encouraging, never smug.
const UNKNOWN_FLAVOUR = 'No entry yet. Go and be introduced.';

const EMPTY_MAP = {};

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

/** camelCaseKey -> "Camel case key", for the raw params dumps. */
function humanKey(k) {
  const s = String(k).replace(/([A-Z])/g, ' $1');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtValue(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  if (Array.isArray(v)) return v.map(fmtValue).join(', ');
  if (typeof v === 'object') {
    const parts = [];
    for (const k in v) parts.push(k + ' ' + fmtValue(v[k]));
    return parts.join(' / ');
  }
  return String(v);
}

function pct(v) { return Math.round(v * 100) + '%'; }
function signedPct(v) { return (v >= 0 ? '+' : '') + Math.round(v * 100) + '%'; }

/**
 * drawSprite culls against the camera box the run scene left behind, and in a
 * menu there is no camera. Open the box up before drawing anything in screen
 * space; the run scene re-establishes it with setCamera() every frame.
 */
function openCullBox(r) {
  r.cullMinX = -1e7; r.cullMaxX = 1e7;
  r.cullMinY = -1e7; r.cullMaxY = 1e7;
}

export const codexScene = {
  manager: null,

  enter(params, mgr) {
    this.manager = mgr || this.manager;
    this.tab = 0;
    this.gridRow = 0;
    this.sel = 0;
    this.detailScroll = 0;
    this._detailMax = 0;
    this.elementScroll = 0;
    this._elementMax = 0;
    // See the card loop in _renderBrowser: the focus index as it stood when the
    // last frame finished declaring cards.
    this._focusMark = -1;

    const data = this.manager.data;

    // Built ONCE. render() never assembles a list.
    this.lists = {
      enemies: data.enemies.ENEMIES.slice(),
      bosses: data.bosses.BOSSES.slice(),
      relics: data.relics.RELICS.slice(),
      characters: data.characters.CHARACTERS.slice(),
    };
    // Enemies read best grouped by tier; everything else is already in the order
    // its author intended (stage order, roster order, signature-then-stage).
    this.lists.enemies.sort((a, b) => (a.tier - b.tier) || a.name.localeCompare(b.name));

    this.elementIds = Object.keys(data.elements.ELEMENTS);

    // Which elements beat which, resolved once so the detail panel is a lookup.
    this.matchups = Object.create(null);
    for (const id of this.elementIds) {
      const strong = (data.elements.STRONG_AGAINST[id] || []).slice();
      const weak = [];
      for (const other of this.elementIds) {
        if ((data.elements.STRONG_AGAINST[other] || []).indexOf(id) !== -1) weak.push(other);
      }
      this.matchups[id] = { strong, weak };
    }
  },

  exit() {},

  update(dt) { /* immediate-mode: everything lives in render() */ },

  clearColor() { return '#05060d'; },

  // --- seen-ness -------------------------------------------------------------
  _seen(kind, entry) {
    const map = (save.data.codex && save.data.codex[kind]) || EMPTY_MAP;
    if (map[entry.id]) return true;
    if (kind === 'characters') {
      const e = save.data.roster[entry.id];
      if (e && e.owned) return true;
    }
    if (kind === 'relics') {
      const e = save.data.relics[entry.id];
      if (e && e.owned) return true;
    }
    return false;
  },

  _seenCount(kind) {
    const list = this.lists[kind];
    let n = 0;
    for (let i = 0; i < list.length; i++) if (this._seen(kind, list[i])) n++;
    return n;
  },

  _totalRecorded() {
    let n = 0, t = 0;
    for (const kind of ['enemies', 'bosses', 'relics', 'characters']) {
      n += this._seenCount(kind);
      t += this.lists[kind].length;
    }
    return { n, t };
  },

  // --- small drawing helpers -------------------------------------------------
  _sprite(r, visual, cx, cy, box, silhouette) {
    if (!visual) return;
    const sp = atlas.ensure(visual);
    if (!sp || !sp.w) return;
    const scale = box / Math.max(sp.w, sp.h);
    r.drawSprite(sp, cx, cy, 0, scale, silhouette ? 0.22 : 1, !!silhouette, 0);
    r.setAlpha(1);
  },

  /** Wrapped paragraph. Returns the y AFTER the last line. */
  _para(r, text, x, y, w, size, color, weight) {
    if (!text) return y;
    const s = size * ui.scale;
    const lines = wrapText(r, String(text), w, s);
    const lh = s + 5;
    for (let i = 0; i < lines.length; i++) {
      ui.text(lines[i], x, y + i * lh + s * 0.5, { size, color: color || PALETTE.textDim, weight: weight || 500 });
    }
    return y + lines.length * lh;
  },

  _heading(r, text, x, y, w, color) {
    ui.text(text, x, y + 8, { size: 12, color: color || PALETTE.accent2, weight: 800 });
    r.drawRect(x, y + 18, w, 1, PALETTE.border, 1);
    return y + 28;
  },

  _elementPill(r, elId, x, y) {
    const E = this.manager.data.elements.ELEMENTS[elId];
    if (!E) return 0;
    const label = E.icon + ' ' + E.name.toUpperCase();
    const w = r.measureText(label, 12 * ui.scale, 800) + 18;
    ui.panel(x, y, w, 22, { radius: 11, color: 'rgba(8,11,20,0.9)', borderColor: E.color });
    ui.text(label, x + 9, y + 11, { size: 12, color: E.color, weight: 800 });
    return w;
  },

  // --- the screen ------------------------------------------------------------
  render(r, alpha) {
    ui.begin(r, 'codex');
    openCullBox(r);

    const W = r.w, H = r.h;
    const M = Math.round(clamp(W * 0.02, 14, 30));
    const sc = ui.scale;

    // ---- header -----------------------------------------------------------
    const rec = this._totalRecorded();
    ui.title('CODEX', M, 34, { size: 32 });
    ui.text('Everything you have met, and roughly what it thought of you.',
      M + r.measureText('CODEX', 32 * sc, 800) + 16, 36, { size: 14, color: PALETTE.textFaint });
    ui.text('RECORDED  ' + rec.n + ' / ' + rec.t, W - M, 30, {
      size: 15, color: PALETTE.accent, align: 'right', weight: 800, mono: true,
    });
    ui.bar(W - M - 220, 44, 220, 8, rec.t ? rec.n / rec.t : 0, PALETTE.accent);

    // ---- tab strip (focus 0..5) -------------------------------------------
    const tabY = 68;
    const tabH = 44;
    if (ui.backButton(M, tabY + 5)) { audio.play('uiBack'); this.manager.go('hub'); }

    const tabsX = M + 92 + 12;
    const tabsW = W - tabsX - M;
    const tabGap = 8;
    const tabW = (tabsW - tabGap * (TABS.length - 1)) / TABS.length;
    for (let i = 0; i < TABS.length; i++) {
      const t = TABS[i];
      let label = t.label;
      if (t.id !== 'elements') label += '  ' + this._seenCount(t.id) + '/' + this.lists[t.id].length;
      const x = tabsX + i * (tabW + tabGap);
      const active = this.tab === i;
      if (active) {
        r.drawRoundRect(x, tabY, tabW, tabH, 10, PALETTE.accent, 0.10);
      }
      if (ui.button('tab' + t.id, x, tabY, tabW, tabH, label, { size: 14 })) {
        if (this.tab !== i) {
          this.tab = i;
          this.gridRow = 0; this.sel = 0; this.detailScroll = 0; this.elementScroll = 0;
          // Park the cursor on the tab that was just chosen. Tabs declare
          // different numbers of focusable things, and the previous answer to
          // that was four DISABLED 10x10 buttons at (-400,-400) — arrow
          // navigation could settle on one and the highlight simply vanished.
          ui.focus = ui.itemCount - 1;
        }
      }
      if (active) r.drawRect(x + 12, tabY + tabH - 3, tabW - 24, 3, PALETTE.accent, 0.95);
    }

    const bodyY = tabY + tabH + 14;
    const bodyH = H - bodyY - M;

    if (TABS[this.tab].id === 'elements') {
      this._renderElements(r, M, bodyY, W - M * 2, bodyH);
      ui.focusGrid(3);
      ui.end();
      return;
    }

    this._renderBrowser(r, M, bodyY, W - M * 2, bodyH);
    ui.focusGrid(3);
    ui.end();
  },

  /**
   * Point the detail panel at a different entry.
   *
   * Re-selecting what is already open must NOT reset the scroll: the cursor on
   * its way from the grid down to the PREV/NEXT buttons crosses the bottom row,
   * and throwing away the reading position every time it did was the bug.
   */
  _select(i) {
    if (this.sel === i) return;
    this.sel = i;
    this.detailScroll = 0;
  },

  // --- grid + detail ---------------------------------------------------------
  _renderBrowser(r, x, y, w, h) {
    const kind = TABS[this.tab].id;
    const list = this.lists[kind];

    const gridW = Math.round(w * 0.53);
    const detailX = x + gridW + 18;
    const detailW = w - gridW - 18;

    const cols = 3;
    const gap = 10;
    const barW = 12;
    const cardW = (gridW - barW - 6 - gap * (cols - 1)) / cols;
    const cardH = 76;
    const footerH = 48;
    const gridH = h - footerH;
    const rows = Math.max(1, Math.floor((gridH + gap) / (cardH + gap)));
    const totalRows = Math.max(1, Math.ceil(list.length / cols));
    const maxRow = Math.max(0, totalRows - rows);

    // The grid scrolls BY ROWS, gated on the grid's own rect. One notch used to
    // turn a whole page — a dozen entries gone in a flick of the finger — and it
    // did so wherever the pointer happened to be inside the body.
    if (input.wheel && ui.pointIn(x, y, gridW, gridH)) this.gridRow += input.wheel;
    this.gridRow = clamp(Math.round(this.gridRow), 0, maxRow);
    const start = this.gridRow * cols;
    const end = Math.min(list.length, start + cols * rows);

    // ---- cards ------------------------------------------------------------
    // KEYBOARD AND GAMEPAD FOCUS PREVIEWS; THE POINTER DOES NOT. Hover also
    // takes ui.focus, so selecting on focus meant sweeping the cursor down to the
    // PREV/NEXT buttons re-selected every card it crossed — and each of those
    // threw away the detail panel's scroll position.
    //
    // The discriminator: hover can only move the focus DURING this loop, so a
    // focus index that is already different when the loop STARTS was moved by
    // ui.end()'s arrow/stick navigation on the previous frame.
    const kbNav = ui.focus !== this._focusMark;
    for (let i = start; i < end; i++) {
      const entry = list[i];
      const col = (i - start) % cols;
      const row = ((i - start) / cols) | 0;
      const cx = x + col * (cardW + gap);
      const cy = y + row * (cardH + gap);
      const idx = ui.itemCount;
      const seen = this._seen(kind, entry);
      if (ui.button('card' + entry.id, cx, cy, cardW, cardH, '')) this._select(i);
      else if (kbNav && ui.focus === idx) this._select(i);
      this._drawCard(r, cx, cy, cardW, cardH, kind, entry, seen);
    }
    this._focusMark = ui.focus;

    this.gridRow = clamp(Math.round(ui.scrollbar('gridBar', x + gridW - barW + 2, y, 8, gridH,
      this.gridRow, rows, totalRows)), 0, maxRow);

    // ---- footer: page jumps + where you are -------------------------------
    const fy = y + gridH + 8;
    const canPage = maxRow > 0;
    if (ui.button('pgPrev', x, fy, 96, 36, '‹ PREV', { size: 13, disabled: !canPage })) {
      this.gridRow = Math.max(0, this.gridRow - rows);
    }
    if (ui.button('pgNext', x + 104, fy, 96, 36, 'NEXT ›', { size: 13, disabled: !canPage })) {
      this.gridRow = Math.min(maxRow, this.gridRow + rows);
    }
    ui.text('SHOWING ' + (list.length ? start + 1 : 0) + '–' + end + '  OF  ' + list.length,
      x + 212, fy + 18, { size: 12, color: PALETTE.textFaint, mono: true });

    // ---- detail -----------------------------------------------------------
    this.sel = clamp(this.sel, 0, Math.max(0, list.length - 1));
    const entry = list[this.sel];
    const seen = entry ? this._seen(kind, entry) : false;

    ui.panel(detailX, y, detailW, h, { radius: 14, color: PALETTE.panel });

    // The scroll controls get a plate of their own at the foot of the panel.
    // They used to be two 34x30 buttons floating directly on top of the text,
    // beside a painted 3px rect with a FIXED 60px thumb that nothing could drag.
    const railH = 48;
    const viewH = h - railH - 4;

    if (input.wheel && ui.pointIn(detailX, y, detailW, viewH)) this.detailScroll += input.wheel * 46;
    this.detailScroll = clamp(this.detailScroll, 0, this._detailMax);

    const padX = 18, padY = 16;
    const innerW = detailW - padX * 2 - 18;
    r.clipRect(detailX + 2, y + 2, detailW - 4, viewH);
    const top = y + padY - this.detailScroll;
    let endY = top;
    if (entry) {
      if (!seen && !DEV_MODE) endY = this._renderUnknown(r, detailX + padX, top, innerW, kind, entry);
      else if (kind === 'enemies') endY = this._detailEnemy(r, detailX + padX, top, innerW, entry, seen);
      else if (kind === 'bosses') endY = this._detailBoss(r, detailX + padX, top, innerW, entry, seen);
      else if (kind === 'relics') endY = this._detailRelic(r, detailX + padX, top, innerW, entry, seen);
      else endY = this._detailCharacter(r, detailX + padX, top, innerW, entry, seen);
    }
    r.unclip();

    this._detailMax = Math.max(0, (endY - top) + padY * 2 - viewH);
    const canScroll = this._detailMax > 1;

    this.detailScroll = ui.scrollbar('detailBar', detailX + detailW - 16, y + 10, 8, viewH - 20,
      this.detailScroll, viewH, viewH + this._detailMax);

    const ry = y + h - railH;
    ui.panel(detailX + 2, ry, detailW - 4, railH - 2, { radius: 10, color: 'rgba(6,8,16,0.94)' });
    ui.text(canScroll ? 'wheel · drag the bar · or' : 'all of it fits',
      detailX + 14, ry + railH / 2 - 1, { size: 11, color: PALETTE.textFaint });
    const bw = 46, bh = 36;
    const bx = detailX + detailW - 12 - bw * 2 - 8;
    if (ui.button('dScrollUp', bx, ry + 5, bw, bh, '▲', { size: 14, disabled: !canScroll })) {
      this.detailScroll -= viewH * 0.6;
    }
    if (ui.button('dScrollDown', bx + bw + 8, ry + 5, bw, bh, '▼', { size: 14, disabled: !canScroll })) {
      this.detailScroll += viewH * 0.6;
    }
    this.detailScroll = clamp(this.detailScroll, 0, this._detailMax);
  },

  _drawCard(r, x, y, w, h, kind, entry, seen) {
    const dim = !seen && !DEV_MODE;
    let stripe = PALETTE.border;
    let tag = '';
    if (kind === 'enemies') { stripe = TIER_COLOR[entry.tier] || PALETTE.border; tag = 'T' + entry.tier; }
    else if (kind === 'bosses') { stripe = BOSS_KIND_COLOR[entry.kind] || PALETTE.border; tag = (BOSS_KIND_LABEL[entry.kind] || '').split(' ')[0]; }
    else if (kind === 'relics') { stripe = RELIC_RARITY_COLOR[entry.rarity] || PALETTE.border; tag = RELIC_RARITY_NAME[entry.rarity] || ''; }
    else { stripe = RARITY_COLOR[entry.rarity] || PALETTE.border; tag = RARITY_NAME[entry.rarity] || ''; }

    r.drawRect(x + 2, y + 8, 3, h - 16, dim ? PALETTE.textFaint : stripe, dim ? 0.5 : 1);
    this._sprite(r, entry.visual, x + 34, y + h / 2, 40, dim);

    const nameX = x + 58;
    const name = dim ? '???' : displayName(entry);
    const size = name.length > 24 ? 12 : 14;
    ui.text(name, nameX, y + 26, {
      size, color: dim ? PALETTE.textFaint : PALETTE.text, weight: 800,
    });
    ui.text(tag, nameX, y + 48, { size: 10, color: dim ? PALETTE.textFaint : stripe, weight: 800 });

    if (DEV_MODE && !seen) {
      ui.text('UNSEEN', x + w - 8, y + 14, { size: 9, color: PALETTE.textFaint, align: 'right', weight: 800 });
    }
  },

  _renderUnknown(r, x, y, w, kind, entry) {
    this._sprite(r, entry.visual, x + 44, y + 44, 76, true);
    ui.title('???', x + 96, y + 30, { size: 26, color: PALETTE.textFaint });
    ui.text('NOT YET RECORDED', x + 96, y + 56, { size: 11, color: PALETTE.textFaint, weight: 800 });
    let yy = y + 104;
    yy = this._para(r, UNKNOWN_FLAVOUR, x, yy, w, 14, PALETTE.textDim);
    yy += 10;
    const hint = kind === 'relics'
      ? 'Relics record themselves the first time one drops in a run. All 24 are always in the pool.'
      : kind === 'characters'
        ? 'Characters record themselves the moment they arrive from the gacha machine.'
        : 'Enemies and bosses record themselves the first time they get within arm’s reach.';
    yy = this._para(r, hint, x, yy, w, 12, PALETTE.textFaint);
    return yy;
  },

  // --- detail: enemies -------------------------------------------------------
  _detailEnemy(r, x, y, w, e, seen) {
    let yy = y;
    this._sprite(r, e.visual, x + 40, y + 40, 68, false);
    const headX = x + 88, headW = w - 88;
    yy = this._para(r, displayName(e), headX, y + 4, headW, 20, PALETTE.text, 800);
    ui.text(TIER_LABEL[e.tier] || ('TIER ' + e.tier), headX, yy + 12, {
      size: 11, color: TIER_COLOR[e.tier] || PALETTE.textDim, weight: 800,
    });
    this._elementPill(r, e.element, headX, yy + 22);
    yy = Math.max(yy + 52, y + 84);
    if (DEV_MODE && !seen) {
      ui.text('UNSEEN — visible because DEV_MODE is on', x, yy, { size: 11, color: PALETTE.bad, weight: 800 });
      yy += 18;
    }

    yy = this._para(r, '“' + (e.codex || '') + '”', x, yy + 4, w, 14, PALETTE.accent2, 600) + 10;

    yy = this._heading(r, 'REAL NUMBERS', x, yy, w);
    const rowH = 20;
    const rows = [
      ['HP', String(e.hp)],
      ['Contact damage', String(e.damage)],
      ['Speed', e.speed + ' px/s'],
      ['Behavior', e.behavior],
      ['Size class', e.size],
      ['Knockback resist', e.weight + (e.weight >= 90 ? '  (immovable)' : e.weight >= 10 ? '  (barely nudges)' : '')],
      ['XP gem', String(e.xp)],
      ['Gold chance', pct(e.goldChance)],
    ];
    if (e.spawnable === false) rows.push(['Spawns', 'only on a parent’s death']);
    for (const row of rows) { ui.statRow(row[0], row[1], x, yy + 8, w); yy += rowH; }
    yy += 6;

    yy = this._elementBlock(r, x, yy, w, e.element);

    const keys = Object.keys(e.params || EMPTY_MAP);
    if (keys.length) {
      yy = this._heading(r, 'ARCHETYPE PARAMETERS', x, yy, w);
      for (const k of keys) { ui.statRow(humanKey(k), fmtValue(e.params[k]), x, yy + 8, w); yy += rowH; }
      yy += 6;
    }
    return this._refBlock(r, x, yy, w, e);
  },

  // --- detail: bosses --------------------------------------------------------
  _detailBoss(r, x, y, w, b, seen) {
    let yy = y;
    this._sprite(r, b.visual, x + 44, y + 44, 76, false);
    const headX = x + 96, headW = w - 96;
    yy = this._para(r, displayName(b), headX, y + 2, headW, 18, PALETTE.text, 800);
    yy = this._para(r, b.epithet || '', headX, yy + 2, headW, 12, PALETTE.textDim, 600);
    ui.text(BOSS_KIND_LABEL[b.kind] || 'BOSS', headX, yy + 12, {
      size: 11, color: BOSS_KIND_COLOR[b.kind] || PALETTE.textDim, weight: 800,
    });
    yy = Math.max(yy + 26, y + 92);
    if (DEV_MODE && !seen) {
      ui.text('UNSEEN — visible because DEV_MODE is on', x, yy, { size: 11, color: PALETTE.bad, weight: 800 });
      yy += 18;
    }

    if (b.quote) yy = this._para(r, b.quote, x, yy + 4, w, 14, PALETTE.accent2, 600) + 6;
    if (b.barks && b.barks.intro) {
      yy = this._para(r, 'ON ARRIVAL: “' + b.barks.intro + '”', x, yy, w, 12, PALETTE.textFaint) + 8;
    }

    yy = this._heading(r, 'REAL NUMBERS', x, yy, w);
    const rowH = 20;
    ui.statRow('HP', b.invulnerable ? b.hp + '  (invulnerable)' : formatCount(b.hp), x, yy + 8, w); yy += rowH;
    ui.statRow('Speed', b.speed + ' px/s', x, yy + 8, w); yy += rowH;
    ui.statRow('Contact damage', b.contactDamage ? String(b.damage) : 'NONE — everything it does, you can read', x, yy + 8, w); yy += rowH;
    ui.statRow('Telegraph floor', (b.telegraphFloor || 0.8) + 's  (enrage never goes under it)', x, yy + 8, w); yy += rowH;
    ui.statRow('XP', String(b.xp), x, yy + 8, w); yy += rowH;
    if (b.stage) {
      const st = this.manager.data.stages.STAGES_BY_ID[b.stage];
      ui.statRow('Stage', st ? displayName(st) : b.stage, x, yy + 8, w); yy += rowH;
    }
    if (b.reward) {
      const rw = [];
      if (b.reward.starFragments) rw.push(b.reward.starFragments + '💎');
      if (b.reward.relic) rw.push('1 relic');
      if (b.reward.chest) rw.push(b.reward.chest + ' chest');
      ui.statRow('Drops', rw.length ? rw.join(' · ') : 'nothing but the satisfaction', x, yy + 8, w); yy += rowH;
    }
    if (b.affixes && b.affixes.length) { ui.statRow('Affixes', b.affixes.join(', '), x, yy + 8, w); yy += rowH; }
    yy += 6;

    yy = this._elementBlock(r, x, yy, w, b.element);

    if (b.mechanic) {
      yy = this._heading(r, 'ENCOUNTER RULE', x, yy, w, PALETTE.bad);
      yy = this._para(r, humanKey(b.mechanic.kind), x, yy, w, 13, PALETTE.text, 800);
      const mp = b.mechanic.params || EMPTY_MAP;
      for (const k in mp) { ui.statRow(humanKey(k), fmtValue(mp[k]), x, yy + 8, w); yy += 20; }
      yy += 8;
    }

    if (b.phases && b.phases.length) {
      yy = this._heading(r, 'PHASES (' + b.phases.length + ')', x, yy, w);
      for (let i = 0; i < b.phases.length; i++) {
        const p = b.phases[i];
        const range = p.hpFrom !== undefined
          ? Math.round(p.hpFrom * 100) + '% → ' + Math.round(p.hpTo * 100) + '% HP'
          : p.timeFrom + 's → ' + (p.timeTo >= 9999 ? '∞' : p.timeTo + 's');
        ui.text((i + 1) + '. ' + p.name + (p.enrage ? '  ⚠ ENRAGE' : ''), x, yy + 8, {
          size: 13, color: p.enrage ? PALETTE.bad : PALETTE.text, weight: 800,
        });
        ui.text(range, x + w, yy + 8, { size: 11, color: PALETTE.textFaint, align: 'right', mono: true });
        yy += 18;
        yy = this._para(r, 'speed ×' + (p.speedMult || 1) + ' · ' + (p.attacks || []).join(', '),
          x + 12, yy, w - 12, 11, PALETTE.textFaint) + 6;
      }
      yy += 4;
    }

    if (b.stances && b.stances.length) {
      yy = this._heading(r, 'STANCES', x, yy, w);
      for (const s of b.stances) {
        ui.text(s.name, x, yy + 8, { size: 13, color: PALETTE.accent, weight: 800 });
        yy += 18;
        yy = this._para(r, (s.attacks || []).join(', '), x + 12, yy, w - 12, 11, PALETTE.textFaint) + 6;
      }
    }

    if (b.parts && b.parts.length) {
      yy = this._heading(r, 'DESTRUCTIBLE PARTS', x, yy, w);
      for (const p of b.parts) { ui.statRow(p.name || p.id, fmtValue(p.hp) + ' HP', x, yy + 8, w); yy += 20; }
      yy += 6;
    }

    const attackIds = Object.keys(b.attacks || EMPTY_MAP);
    if (attackIds.length) {
      yy = this._heading(r, 'ATTACKS (' + attackIds.length + ')', x, yy, w);
      for (const id of attackIds) {
        const a = b.attacks[id];
        ui.text(a.name, x, yy + 8, { size: 13, color: PALETTE.text, weight: 800 });
        yy += 18;
        const meta = a.kind + ' · telegraph ' + a.telegraph + 's · cooldown ' +
          (a.cooldown ? a.cooldown + 's' : 'always on') + ' · ' + (a.damage ? a.damage + ' damage' : 'no damage');
        yy = this._para(r, meta, x + 12, yy, w - 12, 11, PALETTE.accent2);
        if (a.telegraphColor) {
          yy = this._para(r, TELEGRAPH_HINT[a.telegraphColor] || a.telegraphColor, x + 12, yy, w - 12, 11, PALETTE.textFaint);
        }
        if (a.desc) yy = this._para(r, a.desc, x + 12, yy + 2, w - 12, 12, PALETTE.textDim);
        if (DEV_MODE && a.params) {
          yy = this._para(r, fmtValue(a.params), x + 12, yy + 2, w - 12, 10, PALETTE.textFaint);
        }
        yy += 8;
      }
    }
    return this._refBlock(r, x, yy, w, b);
  },

  // --- detail: relics --------------------------------------------------------
  _detailRelic(r, x, y, w, rel, seen) {
    let yy = y;
    this._sprite(r, rel.visual, x + 40, y + 40, 66, false);
    const headX = x + 88, headW = w - 88;
    yy = this._para(r, (rel.icon || '') + ' ' + displayName(rel), headX, y + 4, headW, 18, PALETTE.text, 800);
    const col = RELIC_RARITY_COLOR[rel.rarity] || PALETTE.border;
    ui.text(RELIC_RARITY_NAME[rel.rarity] || '', headX, yy + 12, { size: 11, color: col, weight: 800 });
    yy = Math.max(yy + 28, y + 84);
    if (DEV_MODE && !seen) {
      ui.text('UNSEEN — visible because DEV_MODE is on', x, yy, { size: 11, color: PALETTE.bad, weight: 800 });
      yy += 18;
    }

    if (rel.codex) yy = this._para(r, '“' + rel.codex + '”', x, yy + 4, w, 14, PALETTE.accent2, 600) + 8;

    yy = this._heading(r, 'WHAT IT DOES', x, yy, w);
    yy = this._para(r, rel.desc, x, yy, w, 13, PALETTE.text) + 8;

    if (rel.resonanceDesc) {
      yy = this._heading(r, 'RESONANCE  (×1.5 on its owner)', x, yy, w, PALETTE.pink);
      yy = this._para(r, rel.resonanceDesc, x, yy, w, 13, PALETTE.pink) + 8;
    } else {
      yy = this._para(r, 'A stage relic belongs to a place, not a person. It never resonates.',
        x, yy, w, 12, PALETTE.textFaint) + 8;
    }

    yy = this._heading(r, 'REAL NUMBERS', x, yy, w);
    const rowH = 20;
    const owner = rel.owner ? this.manager.data.characters.CHARACTERS_BY_ID[rel.owner] : null;
    const stage = rel.stageOwner ? this.manager.data.stages.STAGES_BY_ID[rel.stageOwner] : null;
    ui.statRow('Owner', owner ? displayName(owner) : (stage ? displayName(stage) : '—'), x, yy + 8, w); yy += rowH;
    ui.statRow('Drop weight', String(rel.dropWeight), x, yy + 8, w); yy += rowH;
    ui.statRow('Hooks', (rel.hooks || []).join(', ') || '—', x, yy + 8, w); yy += rowH;
    const own = save.data.relics[rel.id];
    ui.statRow('Collected', own && own.owned ? 'yes' : 'not yet', x, yy + 8, w,
      { color: own && own.owned ? PALETTE.good : PALETTE.textFaint }); yy += rowH;
    ui.statRow('Banked', own && own.banked ? 'yes — 3× in-run drop weight' : 'no', x, yy + 8, w,
      { color: own && own.banked ? PALETTE.gold : PALETTE.textFaint }); yy += rowH;
    yy += 8;

    const pkeys = Object.keys(rel.params || EMPTY_MAP);
    if (pkeys.length) {
      yy = this._heading(r, 'PARAMS', x, yy, w);
      for (const k of pkeys) {
        const base = rel.params[k];
        const res = rel.resonance ? rel.resonance[k] : undefined;
        ui.statRow(humanKey(k), fmtValue(base) + (res !== undefined && res !== base ? '   →  ' + fmtValue(res) : ''),
          x, yy + 8, w, { color: res !== undefined && res !== base ? PALETTE.pink : PALETTE.text });
        yy += rowH;
      }
      ui.text('left column: base   ·   right column: resonating', x, yy + 12, { size: 10, color: PALETTE.textFaint });
      yy += 20;
    }
    return this._refBlock(r, x, yy, w, rel);
  },

  // --- detail: characters ----------------------------------------------------
  _detailCharacter(r, x, y, w, c, seen) {
    let yy = y;
    this._sprite(r, c.visual, x + 40, y + 40, 66, false);
    const headX = x + 88, headW = w - 88;
    yy = this._para(r, displayName(c), headX, y + 4, headW, 20, RARITY_COLOR[c.rarity] || PALETTE.text, 800);
    ui.text(RARITY_NAME[c.rarity] + '  ·  ' + c.archetype, headX, yy + 12, {
      size: 12, color: PALETTE.textDim, weight: 700,
    });
    this._elementPill(r, c.element, headX, yy + 24);
    yy = Math.max(yy + 54, y + 86);
    if (DEV_MODE && !seen) {
      ui.text('UNSEEN — visible because DEV_MODE is on', x, yy, { size: 11, color: PALETTE.bad, weight: 800 });
      yy += 18;
    }

    yy = this._para(r, c.epithet, x, yy, w, 15, PALETTE.accent, 800) + 4;
    if (c.barks && c.barks.spawn) {
      yy = this._para(r, '“' + c.barks.spawn + '”', x, yy, w, 13, PALETTE.accent2, 600) + 8;
    }

    const e = save.data.roster[c.id];
    yy = this._heading(r, 'YOUR RECORD', x, yy, w);
    const rowH = 20;
    ui.statRow('Owned', e && e.owned ? 'yes' : 'not yet', x, yy + 8, w,
      { color: e && e.owned ? PALETTE.good : PALETTE.textFaint }); yy += rowH;
    ui.statRow('Star level', 'S' + ((e && e.starLevel) || 1), x, yy + 8, w); yy += rowH;
    ui.statRow('Bond', String((e && e.bond) || 0), x, yy + 8, w); yy += rowH;
    ui.statRow('Runs / kills', ((e && e.runs) || 0) + ' / ' + formatCount((e && e.kills) || 0), x, yy + 8, w); yy += rowH;
    yy += 8;

    yy = this._heading(r, 'BASE STATS', x, yy, w);
    const s = c.stats;
    ui.statRow('HP', String(s.hp), x, yy + 8, w); yy += rowH;
    ui.statRow('Armor', String(s.armor), x, yy + 8, w); yy += rowH;
    ui.statRow('Move speed', s.moveSpeed + ' px/s', x, yy + 8, w); yy += rowH;
    ui.statRow('Pickup radius', s.pickupRadius + ' px', x, yy + 8, w); yy += rowH;
    ui.statRow('Damage', pct(s.damageMult), x, yy + 8, w); yy += rowH;
    ui.statRow('Attack speed', pct(s.attackSpeedMult), x, yy + 8, w); yy += rowH;
    ui.statRow('Area', pct(s.areaMult), x, yy + 8, w); yy += rowH;
    ui.statRow('Crit', pct(s.critChance) + ' at ×' + s.critMult, x, yy + 8, w); yy += rowH;
    ui.statRow('Cooldowns', pct(s.cooldownMult), x, yy + 8, w); yy += rowH;
    ui.statRow('Luck', String(s.luck), x, yy + 8, w); yy += rowH;
    yy += 8;

    yy = this._elementBlock(r, x, yy, w, c.element);

    yy = this._heading(r, 'KIT', x, yy, w);
    yy = this._ability(r, x, yy, w, 'AUTO', c.autoAttack,
      c.autoAttack.interval + 's · ' + c.autoAttack.damage + ' damage · targets ' +
      ((c.autoAttack.targeting && c.autoAttack.targeting.mode) || 'nearest'));
    yy = this._ability(r, x, yy, w, 'SPECIAL', c.special, c.special.cooldown + 's cooldown');
    yy = this._ability(r, x, yy, w, 'ESCAPE', c.escape,
      c.escape.cooldown + 's cooldown · ' + c.escape.iframes + 's invulnerable');
    yy = this._ability(r, x, yy, w, 'PASSIVE', c.passive, '');

    if (c.resourceBar) {
      yy = this._para(r, 'RESOURCE: ' + c.resourceBar.label + ' — 0 to ' + c.resourceBar.max,
        x, yy, w, 12, PALETTE.gold, 800) + 8;
    }

    if (c.starUpgrades) {
      yy = this._heading(r, 'STAR UPGRADES', x, yy, w);
      if (c.starUpgrades.s3) yy = this._para(r, 'S3 — ' + c.starUpgrades.s3, x, yy, w, 12, PALETTE.textDim) + 4;
      if (c.starUpgrades.s5) yy = this._para(r, 'S5 — ' + c.starUpgrades.s5, x, yy, w, 12, PALETTE.textDim) + 8;
    }

    const sig = this.manager.data.relics.RELICS_BY_ID[c.signatureRelic];
    if (sig) {
      yy = this._heading(r, 'SIGNATURE RELIC', x, yy, w, PALETTE.pink);
      yy = this._para(r, (sig.icon || '') + ' ' + displayName(sig), x, yy, w, 13, PALETTE.pink, 800);
      yy = this._para(r, sig.desc, x, yy + 2, w, 12, PALETTE.textDim) + 8;
    }

    if (c.buildPaths && c.buildPaths.length) {
      yy = this._heading(r, 'BUILD PATHS', x, yy, w);
      for (const b of c.buildPaths) yy = this._para(r, '• ' + b, x, yy, w, 12, PALETTE.textDim) + 6;
    }

    if (c.barks) {
      yy = this._heading(r, 'BARKS', x, yy, w);
      for (const k in c.barks) {
        yy = this._para(r, humanKey(k) + ': “' + c.barks[k] + '”', x, yy, w, 12, PALETTE.textFaint) + 4;
      }
    }
    return this._refBlock(r, x, yy, w, c);
  },

  _ability(r, x, y, w, slot, ab, meta) {
    if (!ab) return y;
    let yy = y;
    ui.text(slot, x, yy + 8, { size: 10, color: PALETTE.accent2, weight: 800 });
    ui.text(displayName(ab), x + 62, yy + 8, { size: 13, color: PALETTE.text, weight: 800 });
    yy += 18;
    if (meta) yy = this._para(r, meta, x + 62, yy, w - 62, 11, PALETTE.accent2);
    if (ab.desc) yy = this._para(r, ab.desc, x + 62, yy + 2, w - 62, 12, PALETTE.textDim);
    return yy + 8;
  },

  /** The ±15% ring, as it applies to ONE element. */
  _elementBlock(r, x, y, w, elId) {
    const E = this.manager.data.elements;
    const def = E.ELEMENTS[elId];
    if (!def) return y;
    let yy = this._heading(r, 'ELEMENT', x, y, w, def.color);
    const m = this.matchups[elId] || { strong: [], weak: [] };
    const nameOf = (id) => (E.ELEMENTS[id] ? E.ELEMENTS[id].icon + ' ' + E.ELEMENTS[id].name : id);
    if (!m.strong.length && !m.weak.length) {
      yy = this._para(r, def.icon + ' ' + def.name + ' — neutral both ways. Hits nothing hard, nothing hits it hard.',
        x, yy, w, 12, PALETTE.textDim) + 8;
      return yy;
    }
    if (m.strong.length) {
      yy = this._para(r, 'Strong against ' + m.strong.map(nameOf).join(', ') + '  (+15% damage dealt)',
        x, yy, w, 12, PALETTE.good) + 2;
    }
    if (m.weak.length) {
      yy = this._para(r, 'Weak to ' + m.weak.map(nameOf).join(', ') + '  (−15% damage dealt into them)',
        x, yy, w, 12, PALETTE.bad) + 2;
    }
    return yy + 8;
  },

  /** DEV-only attribution. In a ship build refs.js is gone and this draws nothing. */
  _refBlock(r, x, y, w, entry) {
    if (!DEV_MODE) return y;
    if (!entry.ref && !entry.refSource && !entry.refNotes) return y;
    let yy = this._heading(r, 'REFERENCE (DEV ONLY)', x, y + 6, w, PALETTE.textFaint);
    if (entry.ref) yy = this._para(r, 'ref: ' + entry.ref, x, yy, w, 12, PALETTE.textFaint, 700) + 2;
    if (entry.refSource) yy = this._para(r, 'source: ' + entry.refSource, x, yy, w, 12, PALETTE.textFaint) + 2;
    if (entry.refNotes) yy = this._para(r, entry.refNotes, x, yy, w, 12, PALETTE.textFaint) + 2;
    return yy + 10;
  },

  // --- the ELEMENTS page -----------------------------------------------------
  /**
   * This page has ALWAYS overflowed: at 1280x720 the element matrix ran to
   * y≈749 against a 720px screen, so its bottom two rows and the caption under
   * them were off the bottom with no clip, no scroll and no input able to reach
   * them. It now scrolls like every other overflowing surface in this file.
   */
  _renderElements(r, x, y, w, h) {
    const E = this.manager.data.elements;
    ui.panel(x, y, w, h, { radius: 14 });

    const railH = 48;
    const viewH = h - railH - 4;
    if (input.wheel && ui.pointIn(x, y, w, viewH)) this.elementScroll += input.wheel * 52;
    this.elementScroll = clamp(this.elementScroll, 0, this._elementMax);

    const px = x + 24;
    const pw = w - 48 - 18;
    r.clipRect(x + 2, y + 2, w - 4, viewH);
    const top = y + 22 - this.elementScroll;
    let yy = top;

    ui.title('SEVEN ELEMENTS, ONE SMALL NUMBER', px, yy + 8, { size: 20 });
    yy += 34;
    yy = this._para(r,
      'Every enemy carries an element. Every character carries an element. When they meet, ' +
      'damage moves by exactly ' + signedPct(E.ELEMENT_BONUS) + ' one way or ' + signedPct(-E.ELEMENT_BONUS) +
      ' the other. That is the whole system.',
      px, yy, pw, 14, PALETTE.textDim) + 4;
    yy = this._para(r,
      'It is deliberately small. It is a nudge that makes picking a character for a stage mean ' +
      'something — not a rock-paper-scissors gate that locks half your roster out of a fight. ' +
      'Nothing in the balance targets assumes you have it.',
      px, yy, pw, 13, PALETTE.textFaint) + 16;

    // ---- the ring ---------------------------------------------------------
    yy = this._heading(r, 'THE RING', px, yy, pw);
    yy += 6;
    const ring = ['fire', 'steel', 'lightning', 'water', 'fire'];
    const chipH = 40;
    const arrowW = 30;
    const chipW = Math.min(150, (pw - arrowW * (ring.length - 1)) / ring.length);
    let cx = px;
    for (let i = 0; i < ring.length; i++) {
      const el = E.ELEMENTS[ring[i]];
      const last = i === ring.length - 1;
      ui.panel(cx, yy, chipW, chipH, {
        radius: 10, color: 'rgba(8,11,20,0.9)', borderColor: el.color, borderWidth: last ? 1 : 2, alpha: last ? 0.55 : 1,
      });
      ui.text(el.icon + ' ' + el.name.toUpperCase(), cx + chipW / 2, yy + chipH / 2, {
        size: 13, color: el.color, weight: 800, align: 'center', alpha: last ? 0.6 : 1,
      });
      cx += chipW;
      if (!last) {
        ui.text('beats ›', cx + arrowW / 2, yy + chipH / 2, {
          size: 10, color: PALETTE.textFaint, align: 'center', weight: 700,
        });
        cx += arrowW;
      }
    }
    yy += chipH + 8;
    ui.text('…and round again. Four elements, one loop, no exceptions.', px, yy + 6, { size: 12, color: PALETTE.textFaint });
    yy += 26;

    // ---- the mutual pair + the neutral ------------------------------------
    const halfW = (pw - 18) / 2;
    ui.panel(px, yy, halfW, 74, { radius: 10, color: 'rgba(8,11,20,0.7)' });
    ui.text('🌑 SHADOW  ⇄  ✨ LIGHT', px + 16, yy + 24, { size: 14, color: '#c9b6ff', weight: 800 });
    this._para(r, 'Each beats the other. Light burns shadow away, shadow smothers light. The mirror match is the point.',
      px + 16, yy + 36, halfW - 32, 11, PALETTE.textFaint);

    ui.panel(px + halfW + 18, yy, halfW, 74, { radius: 10, color: 'rgba(8,11,20,0.7)' });
    ui.text('👻 SPIRIT', px + halfW + 34, yy + 24, { size: 14, color: E.ELEMENTS.spirit.color, weight: 800 });
    this._para(r, 'Neutral both ways. Hits nothing hard, nothing hits it hard. The first enemy you ever meet is spirit on purpose.',
      px + halfW + 34, yy + 36, halfW - 32, 11, PALETTE.textFaint);
    yy += 90;

    // ---- the full matrix --------------------------------------------------
    yy = this._heading(r, 'FULL CHART — row attacks column', px, yy, pw);
    yy += 6;
    const ids = this.elementIds;
    const n = ids.length;
    // Sized against the WIDTH only. It used to also divide by the remaining
    // height, which is how a chart that does not fit ended up drawn anyway.
    const cell = clamp((pw - 100) / n, 34, 64);
    const gridX = px + 100;

    for (let c = 0; c < n; c++) {
      const el = E.ELEMENTS[ids[c]];
      ui.text(el.icon, gridX + c * cell + cell / 2, yy + 12, { size: 14, align: 'center' });
    }
    const gy = yy + 26;
    for (let rI = 0; rI < n; rI++) {
      const rowEl = E.ELEMENTS[ids[rI]];
      const ry = gy + rI * cell;
      ui.text(rowEl.icon + ' ' + rowEl.name, px, ry + cell / 2, { size: 11, color: rowEl.color, weight: 700 });
      for (let c = 0; c < n; c++) {
        const mult = E.elementMultiplier(ids[rI], ids[c]);
        const cxx = gridX + c * cell;
        const strong = mult > 1.001, weak = mult < 0.999;
        r.drawRoundRect(cxx + 1, ry + 1, cell - 2, cell - 2, 5,
          strong ? 'rgba(123,245,154,0.14)' : weak ? 'rgba(255,111,145,0.14)' : 'rgba(255,255,255,0.03)', 1);
        ui.text(strong ? '+15%' : weak ? '−15%' : '—', cxx + cell / 2, ry + cell / 2, {
          size: Math.min(12, cell * 0.34), align: 'center', weight: 800,
          color: strong ? PALETTE.good : weak ? PALETTE.bad : PALETTE.textFaint,
        });
      }
    }
    // The number is written in every cell, so no information here is carried by
    // colour alone (SECTION 13 accessibility).
    ui.text('The percentage is written in every cell — the colour is a convenience, never the message.',
      px, gy + n * cell + 16, { size: 11, color: PALETTE.textFaint });
    r.unclip();

    this._elementMax = Math.max(0, (gy + n * cell + 34) - top - viewH);
    const canScroll = this._elementMax > 1;
    this.elementScroll = ui.scrollbar('elBar', x + w - 16, y + 10, 8, viewH - 20,
      this.elementScroll, viewH, viewH + this._elementMax);

    const ry = y + h - railH;
    ui.panel(x + 2, ry, w - 4, railH - 2, { radius: 10, color: 'rgba(6,8,16,0.94)' });
    ui.text(canScroll ? 'wheel · drag the bar · or' : 'all of it fits',
      x + 16, ry + railH / 2 - 1, { size: 11, color: PALETTE.textFaint });
    const bw = 46, bh = 36;
    const bx = x + w - 14 - bw * 2 - 8;
    if (ui.button('elScrollUp', bx, ry + 5, bw, bh, '▲', { size: 14, disabled: !canScroll })) {
      this.elementScroll -= viewH * 0.6;
    }
    if (ui.button('elScrollDown', bx + bw + 8, ry + 5, bw, bh, '▼', { size: 14, disabled: !canScroll })) {
      this.elementScroll += viewH * 0.6;
    }
    this.elementScroll = clamp(this.elementScroll, 0, this._elementMax);
  },
};
