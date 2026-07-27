// THE ROSTER — hub node 2 (SECTION 12 line 1571) plus BOND LEVELS (node 6).
//
// Left:  every one of the 19 characters as a card. Owned ones in full colour with
//        their star level as pips; unowned ones silhouetted, labelled NOT OWNED,
//        and told exactly which banners can produce them. Filterable and sortable
//        by rarity and element.
// Right: the selected character's FULL sheet. Every number this game knows about
//        them, printed (SECTION 13: real numbers, never adjectives) — base stats,
//        the four pillars, both star upgrades, the signature relic and its
//        resonance, both authored build paths, their barks, their bond progress
//        and the exact Fan Letter cost of the next star.
//
// NAVIGATION IS THE TOOLKIT'S. Every interactive thing on this screen is a
// ui.button, so keyboard, mouse and gamepad all work without a line of input
// code here (SECTION 13 acceptance criterion #1). The one raw input read is the
// mouse wheel, which only scrolls the sheet and has a focusable ▲/▼ equivalent
// beside it for the other two devices.
//
// Nothing is laid out against 1920x1080 — every number below is derived from
// r.w / r.h, and the sheet re-flows (two text columns above 620px, one below).
//
// PERF: the sheet is a list of pre-measured draw items, rebuilt only when the
// selection, the star level, the bond or the panel width changes. render() walks
// it and allocates nothing.

import { ui, PALETTE, RARITY_COLOR, RARITY_NAME, wrapText, formatCount } from '../ui/widgets.js';
import { input } from '../core/input.js';
import { save, rosterEntry } from '../core/save.js';
import { audio } from '../core/audio.js';
import { displayName } from '../core/config.js';
import { clamp } from '../core/math.js';

// --- small formatters --------------------------------------------------------

const comma = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const trim1 = (v) => String(Math.round(v * 10) / 10);
const pct = (v) => (v > 0 ? '+' : '') + trim1(v * 100) + '%';
const pctAbs = (v) => trim1(v * 100) + '%';

/**
 * Cut a string to fit, with an ellipsis. Measured at the size it will actually
 * be DRAWN at — ui.text multiplies by settings.uiScale, so measuring at the
 * nominal size would let big-text users overflow every box on the screen.
 */
function fit(r, text, maxW, size, weight) {
  const w = weight || 600;
  const px = size * (ui.scale || 1);
  let s = String(text);
  if (r.measureText(s, px, w) <= maxW) return s;
  while (s.length > 1 && r.measureText(s + '…', px, w) > maxW) s = s.slice(0, -1);
  return s + '…';
}

/** The 5 star pips. Filled up to `level`, hollow after. */
function starPips(r, x, y, level, color, size) {
  const step = size * 0.92 * (ui.scale || 1);
  for (let i = 0; i < 5; i++) {
    const on = i < level;
    ui.text(on ? '★' : '☆', x + i * step, y, {
      size, color: on ? color : PALETTE.textFaint, align: 'left', weight: 800,
    });
  }
  return step * 5;
}

// Base-stat rows, in the order the character sheet reads best. Anything a
// character declares that is NOT in this table still gets printed, generically,
// so adding a stat key to characters.js can never silently vanish from the UI.
const STAT_ROWS = [
  ['hp', 'Max HP', 'int'],
  ['armor', 'Armor', 'int'],
  ['moveSpeed', 'Move speed', 'px/s'],
  ['pickupRadius', 'Pickup radius', 'px'],
  ['damageMult', 'Damage', 'pctAbs'],
  ['attackSpeedMult', 'Attack speed', 'pctAbs'],
  ['areaMult', 'Area', 'pctAbs'],
  ['critChance', 'Crit chance', 'pctAbs'],
  ['critMult', 'Crit damage', 'mult'],
  ['cooldownMult', 'Cooldown', 'pctAbs'],
  ['luck', 'Luck', 'int'],
];

function statValue(kind, v) {
  if (kind === 'pctAbs') return pctAbs(v);
  if (kind === 'mult') return 'x' + trim1(v);
  if (kind === 'px/s') return Math.round(v) + ' px/s';
  if (kind === 'px') return Math.round(v) + ' px';
  return String(Math.round(v * 100) / 100);
}

/** Targeting mode, spelled out. DECISIONS.md §16 modes + the optional filter. */
function targetingText(t) {
  if (!t || !t.mode) return 'nearest';
  let s = t.mode;
  if (t.count) s += ' x' + t.count;
  if (t.filter) s += ' (' + t.filter + ' only)';
  return s;
}

/**
 * data.gacha.STAR_BONUSES, read key-by-key rather than hardcoded per star, so a
 * change to that table shows up here without an edit.
 */
function starBonusText(b) {
  if (!b) return '';
  const parts = [];
  if (b.hp) parts.push(pct(b.hp) + ' max HP');
  if (b.autoDamage) parts.push(pct(b.autoDamage) + ' auto-attack damage');
  if (b.cooldown) parts.push(pct(b.cooldown) + ' cooldowns');
  if (b.escapeCharges) parts.push(b.escapeCharges + ' ESCAPE charges');
  if (b.specialUpgrade) parts.push('unlocks the SPECIAL upgrade');
  if (b.escapeUpgrade) parts.push('unlocks the ESCAPE upgrade');
  for (const k in b) {
    if (k === 'hp' || k === 'autoDamage' || k === 'cooldown') continue;
    if (k === 'escapeCharges' || k === 'specialUpgrade' || k === 'escapeUpgrade') continue;
    parts.push(k + ': ' + b[k]);
  }
  return parts.join(', ');
}

const RARITY_FILTERS = [0, 6, 5, 4, 3];
const SORT_MODES = ['RARITY', 'NAME', 'ELEMENT', 'OWNED FIRST'];

export const rosterScene = {
  manager: null,

  // ---------------------------------------------------------------------------
  enter(params, mgr) {
    if (mgr) this.manager = mgr;
    const D = this.manager.data;

    this.chars = D.characters.CHARACTERS;
    this.elementIds = ['all'].concat(Object.keys(D.elements.ELEMENTS));

    // Which banners can produce each character. Computed once — the pull screen
    // and this one must never disagree about where somebody comes from.
    this.bannersFor = Object.create(null);
    for (const c of this.chars) {
      const list = [];
      for (const b of D.gacha.BANNERS) {
        const pool = b.pool && b.pool[c.rarity];
        if (!pool || pool.indexOf(c.id) < 0) continue;
        list.push({
          name: displayName(b),
          featured: b.featured6 === c.id ||
                    !!(b.featured5 && b.featured5.indexOf(c.id) >= 0),
          oneTime: !!b.oneTime,
        });
      }
      this.bannersFor[c.id] = list;
    }

    this.rarityIdx = 0;
    this.elementIdx = 0;
    this.sortIdx = 0;

    this.selected = (params && params.characterId) ||
                    this.manager.shared.characterId ||
                    this.chars[0].id;

    this.sheetScroll = 0;
    this._sheet = null;
    this._sheetKey = '';
    this._view = [];
    this._refresh();
  },

  exit() {
    this._sheet = null;
    this._sheetKey = '';
  },

  resize() {
    // Width changed, so every wrapped line is wrong. Drop the cache.
    this._sheetKey = '';
  },

  update() {},

  clearColor() { return '#05060d'; },

  // --- view state ------------------------------------------------------------
  /** Rebuild the filtered + sorted card list. Called on filter change only. */
  _refresh() {
    const rar = RARITY_FILTERS[this.rarityIdx];
    const ele = this.elementIds[this.elementIdx];
    const out = [];
    for (const c of this.chars) {
      if (rar && c.rarity !== rar) continue;
      if (ele !== 'all' && c.element !== ele) continue;
      out.push(c);
    }
    const mode = SORT_MODES[this.sortIdx];
    out.sort((a, b) => {
      if (mode === 'NAME') return a.name.localeCompare(b.name);
      if (mode === 'ELEMENT') {
        if (a.element !== b.element) return a.element.localeCompare(b.element);
        return b.rarity - a.rarity;
      }
      if (mode === 'OWNED FIRST') {
        const oa = rosterEntry(a.id).owned ? 0 : 1;
        const ob = rosterEntry(b.id).owned ? 0 : 1;
        if (oa !== ob) return oa - ob;
        return b.rarity - a.rarity;
      }
      if (a.rarity !== b.rarity) return b.rarity - a.rarity;
      return a.name.localeCompare(b.name);
    });
    this._view = out;
  },

  _select(id) {
    if (this.selected === id) return;
    this.selected = id;
    this.sheetScroll = 0;
  },

  _char(id) { return this.manager.data.characters.CHARACTERS_BY_ID[id]; },

  // ---------------------------------------------------------------------------
  render(r) {
    ui.begin(r, 'roster');

    const pad = Math.round(clamp(r.w * 0.018, 12, 26));
    const headerH = 38;
    const bodyY = pad + headerH + 10;
    const bodyH = Math.max(200, r.h - bodyY - pad);
    const gap = 12;
    const leftW = Math.round(Math.min(clamp(r.w * 0.40, 300, 740), r.w * 0.52 - pad));
    const rightX = pad + leftW + gap;
    const rightW = Math.max(240, r.w - rightX - pad);

    // --- header ---------------------------------------------------------------
    const back = ui.backButton(pad, pad);
    ui.title('ROSTER', pad + 104, pad + headerH / 2, { size: 24 });

    let owned = 0;
    for (const c of this.chars) if (rosterEntry(c.id).owned) owned++;
    ui.text(owned + ' / ' + this.chars.length + ' signed to the studio',
      pad + 104 + r.measureText('ROSTER', 24 * (ui.scale || 1), 800) + 16,
      pad + headerH / 2, { size: 13 });

    // Currency pills, right aligned. Fan Letters are the only thing spent here.
    const cur = save.data.currencies;
    const pillW = (n) => r.measureText(formatCount(n), 15, 700) + 42;
    const uni = cur.universalLetters || 0;
    const frag = cur.starFragments || 0;
    let cx = r.w - pad - pillW(uni);
    ui.currency(cx, pad + 4, '💌', uni, PALETTE.pink);
    cx -= pillW(frag) + 8;
    ui.currency(cx, pad + 4, '💎', frag, PALETTE.gem);

    // --- panels ---------------------------------------------------------------
    ui.panel(pad, bodyY, leftW, bodyH, { radius: 16 });
    ui.panel(rightX, bodyY, rightW, bodyH, { radius: 16 });

    const gridCols = this._drawGrid(r, pad, bodyY, leftW, bodyH);
    this._drawSheet(r, rightX, bodyY, rightW, bodyH);

    ui.focusGrid(Math.max(2, gridCols));
    ui.end();

    if (back) { audio.play('uiBack'); this.manager.go('hub'); }
  },

  // --- left: the grid --------------------------------------------------------
  _drawGrid(r, px, py, pw, ph) {
    const ip = 12;
    const fx = px + ip;
    const fw = pw - ip * 2;

    // Filter / sort row. Three cycling buttons keeps this navigable on a stick.
    const fh = 32;
    const fbw = (fw - 16) / 3;
    const rar = RARITY_FILTERS[this.rarityIdx];
    const ele = this.elementIds[this.elementIdx];
    const eleDef = this.manager.data.elements.ELEMENTS[ele];

    if (ui.button('f_rar', fx, py + ip, fbw, fh,
      'RARITY: ' + (rar ? RARITY_NAME[rar] : 'ALL'),
      { size: 13, tooltip: 'Cycle the rarity filter.' })) {
      this.rarityIdx = (this.rarityIdx + 1) % RARITY_FILTERS.length;
      this._refresh();
    }
    if (ui.button('f_ele', fx + fbw + 8, py + ip, fbw, fh,
      'ELEMENT: ' + (eleDef ? eleDef.icon + ' ' + eleDef.name.toUpperCase() : 'ALL'),
      { size: 13, tooltip: 'fire > steel > lightning > water > fire. Shadow and Light beat each other. Spirit is neutral. Worth ' + pctAbs(this.manager.data.elements.ELEMENT_BONUS) + ' either way.' })) {
      this.elementIdx = (this.elementIdx + 1) % this.elementIds.length;
      this._refresh();
    }
    if (ui.button('f_sort', fx + (fbw + 8) * 2, py + ip, fbw, fh,
      'SORT: ' + SORT_MODES[this.sortIdx], { size: 13 })) {
      this.sortIdx = (this.sortIdx + 1) % SORT_MODES.length;
      this._refresh();
    }

    const view = this._view;
    const listY = py + ip + fh + 8;
    ui.text(view.length === this.chars.length
      ? 'All ' + this.chars.length + ' of them.'
      : 'Showing ' + view.length + ' of ' + this.chars.length + '.',
      fx, listY + 8, { size: 12, color: PALETTE.textFaint });

    const gy = listY + 20;
    const gh = py + ph - ip - gy;
    if (gh < 40 || view.length === 0) {
      if (view.length === 0) {
        ui.text('Nobody matches that. Loosen a filter.', fx, gy + 24,
          { size: 14, color: PALETTE.textDim });
      }
      return 2;
    }

    const cellGap = 8;
    const minCellH = 46;
    // Columns come from the available WIDTH first, then get added until the rows
    // also fit the available HEIGHT. All 19 stay on screen at any window size;
    // the cards just get denser rather than falling off the bottom.
    let cols = clamp(Math.floor((fw + cellGap) / 170), 2, 5);
    while (cols < 6 &&
           Math.ceil(view.length / cols) * (minCellH + cellGap) - cellGap > gh) cols++;
    const rows = Math.max(1, Math.ceil(view.length / cols));
    const cellW = Math.max(60, (fw - cellGap * (cols - 1)) / cols);
    const cellH = clamp((gh - cellGap * (rows - 1)) / rows, minCellH, 116);
    const compact = cellH < 78;

    const equipped = this.manager.shared.characterId;

    r.clipRect(px + 2, gy - 2, pw - 4, gh + 4);
    for (let i = 0; i < view.length; i++) {
      const c = view[i];
      const col = i % cols, row = (i / cols) | 0;
      const x = fx + col * (cellW + cellGap);
      const y = gy + row * (cellH + cellGap);
      if (y > gy + gh) break;

      const e = rosterEntry(c.id);
      const rc = RARITY_COLOR[c.rarity] || PALETTE.border;
      const idx = ui.itemCount;

      if (ui.button('c_' + c.id, x, y, cellW, cellH, '', { radius: 12 })) {
        this._select(c.id);
      }
      // Focus follows the stick/arrows: highlighting a card previews it, which
      // is the whole reason the sheet is on screen at the same time.
      if (ui.focus === idx) this._select(c.id);

      // rarity wash + base strip
      r.drawRoundRect(x + 2, y + 2, cellW - 4, cellH * 0.34, 10, rc, e.owned ? 0.16 : 0.04);
      r.drawRect(x + 3, y + cellH - 5, cellW - 6, 3, rc, e.owned ? 0.9 : 0.22);

      if (this.selected === c.id) {
        r.strokeRect(x - 2, y - 2, cellW + 4, cellH + 4, PALETTE.accent2, 2, 0.85);
      }

      const nameW = cellW - 16;
      const roomy = cellH >= 66;                 // has space for the glyph row
      const yName = roomy ? 38 : 17;
      const yLine2 = roomy ? 56 : 34;
      const yLine3 = 74;

      if (e.owned) {
        if (roomy) {
          ui.text((c.visual && c.visual.emoji) || '★', x + 10, y + 17, { size: 15 });
        }
        ui.text(RARITY_NAME[c.rarity], x + cellW - 10, y + (roomy ? 17 : yName),
          { size: 12, color: rc, align: 'right', weight: 800 });
        ui.text(fit(r, displayName(c), roomy ? nameW : nameW - 30, 14, 800), x + 10, y + yName,
          { size: 14, color: PALETTE.text, weight: 800 });
        starPips(r, x + 10, y + yLine2, e.starLevel || 1, PALETTE.accent, 11);
        if (!compact) {
          const el = this.manager.data.elements.ELEMENTS[c.element];
          ui.text(fit(r, (el ? el.icon + ' ' + el.name : c.element) + '  ·  ' + c.archetype,
            nameW, 11, 500), x + 10, y + yLine3, { size: 11, color: PALETTE.textFaint });
        }
        if (equipped === c.id) {
          ui.text('ON STAGE', x + cellW - 10, y + yLine2,
            { size: 10, color: PALETTE.good, align: 'right', weight: 800 });
        }
      } else {
        // Silhouette: the shape is there, the person is not.
        if (roomy) {
          r.drawCircle(x + 20, y + 20, 9, '#1a2035', 1);
          ui.text('?', x + 20, y + 20, { size: 14, color: '#39415f', align: 'center', weight: 800 });
        }
        ui.text(RARITY_NAME[c.rarity], x + cellW - 10, y + (roomy ? 20 : yName),
          { size: 12, color: rc, align: 'right', weight: 800, alpha: 0.55 });
        ui.text('NOT OWNED', x + 10, y + yName,
          { size: 12, color: PALETTE.textFaint, weight: 800 });
        const bl = this.bannersFor[c.id];
        if (!bl || bl.length === 0) {
          ui.text('No banner carries them.', x + 10, y + yLine2,
            { size: 10, color: PALETTE.bad });
        } else if (compact) {
          ui.text(bl.length + (bl.length === 1 ? ' banner' : ' banners'), x + 10, y + yLine2,
            { size: 10, color: PALETTE.textFaint });
        } else {
          for (let b = 0; b < Math.min(2, bl.length); b++) {
            ui.text(fit(r, (bl[b].featured ? '★ ' : '· ') + bl[b].name, nameW, 10, 600),
              x + 10, y + yLine2 + b * 14,
              { size: 10, color: bl[b].featured ? PALETTE.accent : PALETTE.textFaint });
          }
          if (bl.length > 2 && cellH >= 96) {
            ui.text('+' + (bl.length - 2) + ' more', x + 10, y + yLine2 + 28,
              { size: 10, color: PALETTE.textFaint });
          }
        }
      }
    }
    r.unclip();
    return cols;
  },

  // --- right: the sheet ------------------------------------------------------
  _drawSheet(r, px, py, pw, ph) {
    const c = this._char(this.selected);
    if (!c) return;
    const D = this.manager.data;
    const e = rosterEntry(c.id);
    const rc = RARITY_COLOR[c.rarity] || PALETTE.border;
    const ip = 14;
    const cw = pw - ip * 2;

    // --- fixed header ---------------------------------------------------------
    const hh = 104;
    const hx = px + ip, hy = py + ip;
    ui.card(hx, hy, cw, hh, c.rarity);
    ui.text((c.visual && c.visual.emoji) || '★', hx + 34, hy + 40, { size: 34, align: 'center' });
    ui.text(fit(r, displayName(c), Math.max(60, cw - 200), 26, 800), hx + 66, hy + 28,
      { size: 26, color: PALETTE.text, weight: 800 });
    ui.text(fit(r, c.epithet, Math.max(60, cw - 200), 14, 600), hx + 66, hy + 52,
      { size: 14, color: rc, weight: 700 });
    const el = D.elements.ELEMENTS[c.element];
    ui.text(RARITY_NAME[c.rarity] + '  ·  ' + c.archetype + '  ·  ' +
            (el ? el.icon + ' ' + el.name : c.element),
      hx + 66, hy + 74, { size: 12, color: PALETTE.textDim });

    if (e.owned) {
      starPips(r, hx + cw - 96, hy + 26, e.starLevel || 1, PALETTE.accent, 15);
      ui.text('S' + (e.starLevel || 1), hx + cw - 16, hy + 50,
        { size: 13, color: PALETTE.accent, align: 'right', weight: 800, mono: true });
      ui.text('BOND ' + (e.bond || 0) + '  ·  ' + (e.runs || 0) + ' runs',
        hx + cw - 16, hy + 72, { size: 12, color: PALETTE.textDim, align: 'right' });
    } else {
      ui.text('NOT OWNED', hx + cw - 16, hy + 28,
        { size: 15, color: PALETTE.bad, align: 'right', weight: 800 });
      const bl = this.bannersFor[c.id] || [];
      const line = bl.length
        ? bl.map((b) => (b.featured ? '★' : '') + b.name).join('  ·  ')
        : 'Not in any banner pool.';
      ui.text(fit(r, line, Math.max(60, cw - 130), 11, 600), hx + cw - 16, hy + 52,
        { size: 11, color: PALETTE.textFaint, align: 'right' });
      ui.text('★ = rate-up', hx + cw - 16, hy + 70,
        { size: 10, color: PALETTE.textFaint, align: 'right' });
    }

    // --- fixed footer: the two actions ---------------------------------------
    const fh = 92;
    const fy = py + ph - ip - fh;
    this._drawFooter(r, hx, fy, cw, fh, c, e);

    // --- scrolling body -------------------------------------------------------
    const bodyTop = hy + hh + 10;
    const bodyBot = fy - 10;
    const bodyH = Math.max(60, bodyBot - bodyTop);

    // Scroll affordance: ▲ / ▼ buttons on the right rail (keyboard + gamepad),
    // and the wheel over the panel (mouse). Both drive the same offset.
    const railW = 30;
    const contentW = cw - railW - 8;
    const sbX = hx + cw - railW;
    const up = ui.button('sc_up', sbX, bodyTop, railW, 30, '▲', { size: 13, radius: 8 });
    const dn = ui.button('sc_dn', sbX, bodyTop + bodyH - 30, railW, 30, '▼', { size: 13, radius: 8 });

    const key = c.id + '|' + Math.round(contentW) + '|' + (e.owned ? 1 : 0) + '|' +
                (e.starLevel || 1) + '|' + (e.bond || 0) + '|' + (ui.scale || 1);
    if (this._sheetKey !== key) {
      this._sheet = this._buildSheet(r, c, e, contentW);
      this._sheetKey = key;
    }
    const sheet = this._sheet;
    const twoCol = contentW >= 620;
    const total = twoCol ? Math.max(sheet.hA, sheet.hB) : sheet.hA + sheet.hB;
    const maxScroll = Math.max(0, total - bodyH + 8);

    const mx = input.mouseX / (r.dpr || 1), my = input.mouseY / (r.dpr || 1);
    const overPanel = mx >= px && mx <= px + pw && my >= bodyTop && my <= bodyTop + bodyH;
    if (input.wheel && overPanel) this.sheetScroll += input.wheel * 56;
    if (up) this.sheetScroll -= bodyH * 0.6;
    if (dn) this.sheetScroll += bodyH * 0.6;
    this.sheetScroll = clamp(this.sheetScroll, 0, maxScroll);

    r.clipRect(hx, bodyTop, contentW + 2, bodyH);
    if (twoCol) {
      const colW = (contentW - 18) / 2;
      this._drawItems(r, sheet.colA, hx, bodyTop - this.sheetScroll, colW, bodyTop, bodyH);
      this._drawItems(r, sheet.colB, hx + colW + 18, bodyTop - this.sheetScroll, colW, bodyTop, bodyH);
    } else {
      this._drawItems(r, sheet.colA, hx, bodyTop - this.sheetScroll, contentW, bodyTop, bodyH);
      this._drawItems(r, sheet.colB, hx, bodyTop - this.sheetScroll + sheet.hA, contentW, bodyTop, bodyH);
    }
    r.unclip();

    if (maxScroll > 0) {
      const t = this.sheetScroll / maxScroll;
      const trackY = bodyTop + 34, trackH = bodyH - 68;
      const bh = Math.max(22, trackH * (bodyH / total));
      r.drawRect(sbX + railW / 2 - 1, trackY, 2, trackH, PALETTE.border, 1);
      r.drawRect(sbX + railW / 2 - 2, trackY + (trackH - bh) * t, 4, bh, PALETTE.accent, 0.8);
    }
  },

  _drawFooter(r, x, y, w, h, c, e) {
    const D = this.manager.data;
    const G = D.gacha;
    const star = e.starLevel || 1;
    const next = star + 1;
    const maxed = next > 5;
    const cost = maxed ? 0 : (G.STAR_COSTS[next] || 0);
    const own = e.letters || 0;
    const universal = save.data.currencies.universalLetters || 0;
    const shortfall = Math.max(0, cost - own);
    const uniNeed = shortfall * G.UNIVERSAL_RATIO;
    const affordable = !maxed && (own >= cost || universal >= uniNeed);

    ui.panel(x, y, w, h, { radius: 12, color: 'rgba(8,11,20,0.85)' });

    // Line 1 — the exact letter maths, never rounded, never hidden.
    let line;
    if (!e.owned) line = 'Fan Letters only accrue for characters you own. Go pull.';
    else if (maxed) line = 'S5. There is nothing left to buy — 💌 ' + comma(own) + ' held, and dupes now pay out elsewhere.';
    else if (own >= cost) line = '💌 ' + comma(own) + ' / ' + comma(cost) + ' held. Paid in full from their own letters.';
    else if (universal >= uniNeed) line = '💌 ' + comma(own) + ' / ' + comma(cost) + ' held — the last ' + comma(shortfall) + ' comes from ' + comma(uniNeed) + ' Universal 💌 at ' + G.UNIVERSAL_RATIO + ':1.';
    else line = '💌 ' + comma(own) + ' / ' + comma(cost) + '. Short by ' + comma(shortfall) + ' — or ' + comma(uniNeed) + ' Universal 💌 (you have ' + comma(universal) + ').';
    ui.text(fit(r, line, w - 24, 12, 600), x + 12, y + 18, { size: 12, color: PALETTE.textDim });

    // Line 2 — what the next star actually does.
    if (e.owned && !maxed) {
      const bonus = starBonusText(G.STAR_BONUSES[next]);
      ui.text(fit(r, 'S' + next + ' grants: ' + bonus, w - 24, 12, 700),
        x + 12, y + 38, { size: 12, color: PALETTE.accent, weight: 700 });
    }

    const by = y + h - 44;
    const bw = w - 24;
    const upW = Math.round(bw * 0.58);
    const upLabel = maxed ? 'S5 — MAXED'
      : !e.owned ? 'NOT OWNED'
      : 'RAISE TO S' + next + '  ·  ' + comma(cost) + ' 💌';
    if (ui.button('star_up', x + 12, by, upW, 34, upLabel, {
      size: 14,
      disabled: !e.owned || maxed || !affordable,
      tooltip: maxed ? null : 'Star levels are permanent and never reset.',
    })) {
      const res = this.manager.gacha.raiseStar(c.id);
      if (res && res.ok) {
        audio.play('levelUp');
        this._sheetKey = '';
        this.manager.toast(displayName(c) + ' is now S' + res.starLevel + '.', PALETTE.accent, '★');
      } else {
        audio.play('uiBack');
        this.manager.toast((res && res.error) || 'Not enough Fan Letters.', PALETTE.bad, '💌');
      }
    }

    const equipped = this.manager.shared.characterId === c.id;
    if (ui.button('equip', x + 12 + upW + 8, by, bw - upW - 8, 34,
      equipped ? 'ON STAGE' : 'EQUIP', {
        size: 14,
        disabled: !e.owned || equipped,
      })) {
      this.manager.shared.characterId = c.id;
      audio.play('uiConfirm');
      this.manager.toast(displayName(c) + ' takes the stage.', RARITY_COLOR[c.rarity], '🎬');
    }
  },

  // --- sheet construction ----------------------------------------------------
  /**
   * Turn a character into two pre-measured columns of draw items. Called only
   * when the selection / star / bond / width changes, never per frame.
   */
  _buildSheet(r, c, e, w) {
    const D = this.manager.data;
    const G = D.gacha;
    const colW = w >= 620 ? (w - 18) / 2 : w;
    const A = [], B = [];
    // Every height below is in DRAWN pixels, so the whole sheet re-flows when the
    // player raises settings.uiScale instead of overlapping itself.
    const S = ui.scale || 1;

    const mk = {
      h: (list, text, color) => {
        list.push({ k: 'h', text, color: color || PALETTE.accent2, hgt: Math.round(30 * S) });
      },
      t: (list, text, o) => {
        const oo = o || {};
        const size = oo.size || 13;
        list.push({
          k: 't', text, size, color: oo.color || PALETTE.textDim,
          weight: oo.weight || 500, mono: !!oo.mono, indent: oo.indent || 0,
          hgt: Math.round(size * 1.45 * S),
        });
      },
      wrap: (list, text, o) => {
        const oo = o || {};
        const size = oo.size || 12;
        const ind = oo.indent || 0;
        const lines = wrapText(r, String(text), Math.max(60, colW - ind * S), size * S);
        for (const ln of lines) mk.t(list, ln, { size, color: oo.color, indent: ind, weight: oo.weight });
      },
      pair: (list, la, va, lb, vb, ca, cb) => {
        list.push({ k: 's2', la, va, lb, vb, ca, cb, hgt: Math.round(21 * S) });
      },
      bar: (list, frac, color, label) => {
        list.push({ k: 'bar', frac, color, label, hgt: Math.round(28 * S) });
      },
      gap: (list, h) => { list.push({ k: 'sp', hgt: Math.round((h || 8) * S) }); },
    };

    // === COLUMN A ============================================================
    // BOND first: it is the thing that changes every run.
    mk.h(A, 'BOND');
    const bond = e.bond || 0;
    const levels = D.shrine.BOND_LEVELS;
    let nextLv = null, prevAt = 0;
    for (const b of levels) {
      if (bond < b.level) { nextLv = b; break; }
      prevAt = b.level;
    }
    if (nextLv) {
      const span = Math.max(1, nextLv.level - prevAt);
      mk.bar(A, (bond - prevAt) / span, PALETTE.pink,
        'BOND ' + bond + ' / ' + nextLv.level);
      mk.wrap(A, 'Next, at bond ' + nextLv.level + ': ' + nextLv.desc,
        { size: 12, color: PALETTE.accent });
      mk.t(A, (nextLv.level - bond) + ' more to go.', { size: 12, color: PALETTE.textFaint });
    } else {
      mk.bar(A, 1, PALETTE.pink, 'BOND ' + bond + ' — every tier claimed');
      mk.t(A, 'Nothing left to unlock. Keep playing them anyway.',
        { size: 12, color: PALETTE.textFaint });
    }
    mk.gap(A, 4);
    mk.t(A, '+' + D.shrine.BOND_PER_RUN + ' bond for finishing a run with them. Win or lose.',
      { size: 12 });
    mk.t(A, '+' + D.shrine.BOND_PER_BOSS + ' more per boss killed in that run, mid-bosses included.',
      { size: 12 });
    mk.gap(A, 6);
    for (const b of levels) {
      const got = bond >= b.level;
      mk.wrap(A, (got ? '✔ ' : '○ ') + 'Bond ' + b.level + ' — ' + b.desc,
        { size: 12, color: got ? PALETTE.good : PALETTE.textFaint });
    }

    // BASE STATS
    mk.gap(A, 10);
    mk.h(A, 'BASE STATS');
    const printed = Object.create(null);
    const rows = [];
    for (const [key, label, kind] of STAT_ROWS) {
      if (c.stats[key] === undefined) continue;
      printed[key] = true;
      rows.push([label, statValue(kind, c.stats[key])]);
    }
    for (const k in c.stats) {
      if (printed[k]) continue;
      rows.push([k, statValue('int', c.stats[k])]);
    }
    for (let i = 0; i < rows.length; i += 2) {
      const a = rows[i], b = rows[i + 1];
      mk.pair(A, a[0], a[1], b ? b[0] : '', b ? b[1] : '');
    }
    mk.gap(A, 4);
    mk.t(A, 'Before shrine upgrades, star bonuses, bond and relics.',
      { size: 11, color: PALETTE.textFaint });

    // THE FOUR PILLARS
    mk.gap(A, 10);
    mk.h(A, 'THE FOUR PILLARS');

    const aa = c.autoAttack;
    const dps = aa.interval > 0 ? aa.damage / aa.interval : 0;
    mk.t(A, '⚔  AUTO ATTACK — ' + displayName(aa), { size: 13, color: PALETTE.text, weight: 800 });
    mk.t(A, 'every ' + trim1(aa.interval) + 's  ·  ' + comma(aa.damage) + ' damage  ·  ' +
            trim1(dps) + ' dmg/s  ·  targets ' + targetingText(aa.targeting),
      { size: 11, color: PALETTE.accent, mono: true });
    mk.wrap(A, aa.desc, { size: 12 });
    mk.gap(A, 8);

    const sp = c.special;
    mk.t(A, '✦  SPECIAL — ' + displayName(sp), { size: 13, color: PALETTE.text, weight: 800 });
    mk.t(A, trim1(sp.cooldown) + 's cooldown', { size: 11, color: PALETTE.accent, mono: true });
    mk.wrap(A, sp.desc, { size: 12 });
    mk.gap(A, 8);

    const esc = c.escape;
    mk.t(A, '↯  ESCAPE — ' + displayName(esc), { size: 13, color: PALETTE.text, weight: 800 });
    mk.t(A, trim1(esc.cooldown) + 's cooldown  ·  ' + trim1(esc.iframes) + 's i-frames',
      { size: 11, color: PALETTE.accent, mono: true });
    mk.wrap(A, esc.desc, { size: 12 });
    mk.gap(A, 8);

    const pas = c.passive;
    mk.t(A, '◈  PASSIVE — ' + displayName(pas), { size: 13, color: PALETTE.text, weight: 800 });
    mk.wrap(A, pas.desc, { size: 12 });

    if (c.resourceBar) {
      mk.gap(A, 8);
      mk.t(A, '▮  RESOURCE — ' + c.resourceBar.label,
        { size: 13, color: PALETTE.text, weight: 800 });
      mk.t(A, 'Fills to ' + c.resourceBar.max + '. The HUD draws it for them and nobody else.',
        { size: 12 });
    }
    if (c.metric) {
      mk.gap(A, 6);
      mk.t(A, 'Balance metric: ' + c.metric + ' — their kit ignores enemy HP, so DPS lies.',
        { size: 11, color: PALETTE.textFaint });
    }

    // === COLUMN B ============================================================
    const star = e.starLevel || 1;

    mk.h(B, 'STAR UPGRADES');
    const s3on = star >= 3, s5on = star >= 5;
    mk.t(B, (s3on ? '✔ ' : '🔒 ') + 'S3 — SPECIAL',
      { size: 12, color: s3on ? PALETTE.good : PALETTE.textFaint, weight: 800 });
    mk.wrap(B, c.starUpgrades.s3, { size: 12, color: s3on ? PALETTE.textDim : PALETTE.textFaint });
    mk.gap(B, 6);
    mk.t(B, (s5on ? '✔ ' : '🔒 ') + 'S5 — ESCAPE',
      { size: 12, color: s5on ? PALETTE.good : PALETTE.textFaint, weight: 800 });
    mk.wrap(B, c.starUpgrades.s5, { size: 12, color: s5on ? PALETTE.textDim : PALETTE.textFaint });

    mk.gap(B, 10);
    mk.h(B, 'STAR LEVELS');
    for (const lv of [2, 3, 4, 5]) {
      const have = star >= lv;
      const cost = G.STAR_COSTS[lv];
      mk.t(B, (have ? '✔ ' : '○ ') + 'S' + lv + '  ·  ' + comma(cost) + ' 💌',
        { size: 12, color: have ? PALETTE.good : PALETTE.accent, weight: 800 });
      mk.wrap(B, starBonusText(G.STAR_BONUSES[lv]),
        { size: 11, color: have ? PALETTE.textDim : PALETTE.textFaint, indent: 12 });
    }
    mk.gap(B, 2);
    mk.t(B, 'Dupes pay ' + G.DUPE_LETTERS[c.rarity] + ' 💌 each at ' + RARITY_NAME[c.rarity] +
            '. Universal 💌 substitute at ' + G.UNIVERSAL_RATIO + ':1.',
      { size: 11, color: PALETTE.textFaint });

    // SIGNATURE RELIC
    const relic = D.relics.RELICS_BY_ID[c.signatureRelic];
    mk.gap(B, 10);
    mk.h(B, 'SIGNATURE RELIC');
    if (relic) {
      mk.t(B, (relic.icon || '◆') + '  ' + displayName(relic),
        { size: 13, color: PALETTE.gold, weight: 800 });
      mk.wrap(B, relic.desc, { size: 12 });
      if (relic.resonanceDesc) {
        mk.gap(B, 4);
        mk.wrap(B, relic.resonanceDesc, { size: 12, color: PALETTE.pink, weight: 700 });
        mk.t(B, 'Resonance fires only while you are playing them.',
          { size: 11, color: PALETTE.textFaint });
      }
      const relicBanner = D.gacha.BANNERS.find((b) => b.dropWeightBonus);
      mk.t(B, 'It drops in runs regardless (DECISIONS §9). Banking it on the relic ' +
              'banner just makes it ' + ((relicBanner && relicBanner.dropWeightBonus) || 3) +
              'x as likely.',
        { size: 11, color: PALETTE.textFaint });
    } else {
      mk.t(B, 'No signature relic on file. That is a bug — tell someone.',
        { size: 12, color: PALETTE.bad });
    }

    // BUILD PATHS — verbatim, both of them.
    mk.gap(B, 10);
    mk.h(B, 'BUILD PATHS');
    const paths = c.buildPaths || [];
    for (let i = 0; i < paths.length; i++) {
      mk.t(B, 'PATH ' + (i + 1), { size: 11, color: PALETTE.accent, weight: 800 });
      mk.wrap(B, paths[i], { size: 12, indent: 10 });
      if (i < paths.length - 1) mk.gap(B, 6);
    }
    if (paths.length < 2) {
      mk.t(B, 'SECTION 14 wants two viable paths per character. This one is short.',
        { size: 11, color: PALETTE.bad });
    }

    // BARKS — they are the character.
    mk.gap(B, 10);
    mk.h(B, 'BARKS');
    const barkLabels = { spawn: 'ON SPAWN', levelUp: 'ON LEVEL UP', lowHp: 'AT LOW HP' };
    for (const key in c.barks) {
      mk.t(B, barkLabels[key] || key.toUpperCase(),
        { size: 10, color: PALETTE.textFaint, weight: 800 });
      mk.wrap(B, '“' + c.barks[key] + '”',
        { size: 13, color: RARITY_COLOR[c.rarity] || PALETTE.text, weight: 600 });
      mk.gap(B, 4);
    }

    let hA = 0, hB = 0;
    for (const it of A) hA += it.hgt;
    for (const it of B) hB += it.hgt;
    return { colA: A, colB: B, hA, hB };
  },

  /** Walk a pre-measured column. Anything scrolled out of view is skipped. */
  _drawItems(r, items, x, y, w, clipY, clipH) {
    const S = ui.scale || 1;
    let cy = y;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const h = it.hgt;
      if (cy + h >= clipY - 8 && cy <= clipY + clipH + 8) {
        if (it.k === 'h') {
          ui.text(it.text, x, cy + h * 0.5, { size: 12, color: it.color, weight: 800 });
          r.drawRect(x, cy + h * 0.87, w, 1, it.color, 0.25);
        } else if (it.k === 't') {
          ui.text(it.text, x + it.indent * S, cy + h / 2, {
            size: it.size, color: it.color, weight: it.weight, mono: it.mono,
          });
        } else if (it.k === 's2') {
          const half = it.vb === '' ? w : (w - 14) / 2;
          ui.statRow(it.la, it.va, x, cy + h / 2, half, { color: it.ca });
          if (it.lb) ui.statRow(it.lb, it.vb, x + half + 14, cy + h / 2, half, { color: it.cb });
        } else if (it.k === 'bar') {
          ui.bar(x, cy + h * 0.18, w, h * 0.57, it.frac, it.color, { label: it.label });
        }
      }
      cy += h;
    }
  },
};
