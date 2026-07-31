// THE ROSTER — hub node 2 (SECTION 12 line 1571) plus BOND LEVELS (node 6).
//
// Left:  every one of the 19 characters as a card, each carrying its FACE.
//        Owned ones in full colour with their star level as pips; unowned ones
//        silhouetted, labelled NOT OWNED, and told exactly which banners can
//        produce them. Filterable and sortable by rarity and element.
// Right: the selected character's FULL sheet. Every number this game knows about
//        them, printed (SECTION 13: real numbers, never adjectives) — base stats,
//        the four pillars, both star upgrades, the signature relic and its
//        resonance, both authored build paths, their barks, their bond progress
//        and the exact Fan Letter cost of the next star.
//
// NAVIGATION IS THE TOOLKIT'S. Every interactive thing on this screen is a
// ui.button, so keyboard, mouse and gamepad all work without a line of input
// code here (SECTION 13 acceptance criterion #1). The one raw input read is the
// mouse wheel, which only scrolls the sheet (and only while the pointer is over
// it) and has a focusable ▲/▼ rail plus a draggable ui.scrollbar beside it.
//
// THE FILTERS ARE SEGMENTED, NOT CYCLING. Three cycling buttons meant reaching
// the last element cost seven clicks and the other six states were invisible
// until you had clicked past them. A pointer picks directly now; a stick still
// walks the chips one at a time.
//
// THE ART IS THE POINT OF A ROSTER. This screen used to print `visual.emoji`
// and stop there — one glyph — while the game was already building TWO sprites
// per character and showing both of them everywhere else. `c.portrait` is an HD
// head-and-shoulders bust (data/sprites.js portraitFor(), joined on in
// data/index.js, pre-rastered at boot) and `c.visual.pixel` is the full-body
// figure you actually play. A card gets the bust; the sheet gets both, with the
// body standing on its own little stage and idling on its two bob frames,
// because the sheet is the one place a player can stand still and appraise a
// design instead of chasing it round an arena.
//
// Nothing is laid out against 1920x1080 — every number below is derived from
// r.w / r.h, and the sheet re-flows (two text columns above 620px, one below).
//
// PERF: the sheet is a list of pre-measured draw items, rebuilt only when the
// selection, the star level, the bond or the panel width changes. render() walks
// it and allocates nothing. The sprites behind the art are resolved once per
// character into `_artCache` and never looked up again — see `_art()`.

import { ui, PALETTE, RARITY_COLOR, RARITY_NAME, wrapText, formatCount } from '../ui/widgets.js';
import { input } from '../core/input.js';
import { save, rosterEntry } from '../core/save.js';
import { audio } from '../core/audio.js';
import { displayName } from '../core/config.js';
import { clamp } from '../core/math.js';
import { atlas } from '../render/spriteAtlas.js';

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

// --- drawing sprites on a MENU -----------------------------------------------

/**
 * The camera cull box, parked while this screen blits a sprite in screen space.
 *
 * `r.drawSprite()` rejects anything outside cullMinX..cullMaxY, and on a menu
 * those four numbers are whatever the last run left in them — a window round a
 * player standing thousands of pixels away, so every portrait here is discarded
 * before it reaches drawImage, silently, with a perfectly happy test suite.
 * ui/hud.js `_topLeft()` opens the window round its own portrait blit for
 * exactly this reason; this is the same trick, hoisted so the grid can pay for
 * it once round the whole card loop rather than once per card.
 *
 * Module-level, so it allocates nothing per frame — which also makes it
 * NON-REENTRANT. Every cullOff() must be closed by a cullOn() before the next
 * one opens, including on the early-return paths.
 */
const CULL = { x0: 0, x1: 0, y0: 0, y1: 0 };

function cullOff(r) {
  CULL.x0 = r.cullMinX; CULL.x1 = r.cullMaxX;
  CULL.y0 = r.cullMinY; CULL.y1 = r.cullMaxY;
  r.cullMinX = -4000; r.cullMaxX = r.w + 4000;
  r.cullMinY = -4000; r.cullMaxY = r.h + 4000;
}

function cullOn(r) {
  r.cullMinX = CULL.x0; r.cullMaxX = CULL.x1;
  r.cullMinY = CULL.y0; r.cullMaxY = CULL.y1;
}

/**
 * The atlas Sprite behind a visual descriptor.
 *
 * Deliberately NOT `atlas.ensure()` for the pixel case. ensure() keys on
 * visualKey(), which for a portrait comes out as shape|colour|size and nothing
 * else — and this roster contains a pair of characters whose `visual.color` is
 * the same string, so both portraits hash to one key and the second one to be
 * registered is thrown away. In a HUD that shows one face at a time nobody ever
 * notices; in a grid of nineteen it prints the wrong person. `registerPixel()`
 * keys on the descriptor's OWN id, which is the exact reason portraitFor() gives
 * the bust an id of its own, and it returns the sprite the boot pre-raster
 * already built rather than making a new one.
 */
function pixelSprite(v) {
  if (!v) return null;
  return v.pixel ? atlas.registerPixel(v.pixel, v.size || 14) : atlas.ensure(v);
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

    // id -> { face, body }. Kept ACROSS entries, not rebuilt per visit: a
    // character's art never changes, and the whole point of the cache is that
    // the draw loop never touches the atlas (a Map.get on a joined key string
    // is an allocation, and there are nineteen of them a frame).
    if (!this._artCache) this._artCache = Object.create(null);

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
    // See the card loop in _drawGrid: the focus index as it stood when the last
    // frame finished declaring cards.
    this._focusMark = -1;
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

  /**
   * Point the sheet at somebody else. Re-selecting whoever is already open is a
   * no-op, so the read position survives — sweeping the pointer across the grid
   * used to reset the sheet you were halfway through reading, once per card.
   */
  _select(id) {
    if (this.selected === id) return;
    this.selected = id;
    this.sheetScroll = 0;
  },

  _char(id) { return this.manager.data.characters.CHARACTERS_BY_ID[id]; },

  // --- art -------------------------------------------------------------------
  /**
   * The two sprites for a character, resolved once. `face` is the HD bust,
   * `body` the full-body world sprite. Either may be null — a character with no
   * entry in the art layer degrades to its emoji rather than to a hole.
   */
  _art(c) {
    let a = this._artCache[c.id];
    if (!a) {
      a = { face: pixelSprite(c.portrait), body: pixelSprite(c.visual) };
      this._artCache[c.id] = a;
    }
    return a;
  },

  /**
   * A framed bust. The card's face, and the left half of the sheet header.
   *
   * UNOWNED DRAWS THE REAL SPRITE, NOT A QUESTION MARK. The rule this screen has
   * always stated — "the shape is there, the person is not" — was being carried
   * by a '?' in a grey circle, which tells you nothing whatsoever about who you
   * are missing. The atlas already bakes a white twin of every pixel sprite for
   * the hit-flash, so the silhouette costs nothing: blit that instead, at low
   * alpha, and the hair, the horns, the hat and the wings all survive while the
   * person does not.
   *
   * The CALLER owns the cull window (cullOff/cullOn) — the grid parks it once
   * round the whole card loop rather than once per card.
   */
  _facePlate(r, c, owned, x, y, w, h, rc) {
    r.drawRoundRect(x, y, w, h, 5, '#0b0f1c', owned ? 0.92 : 0.7);
    // Rarity band across the top of the plate, matching the HUD portrait and the
    // card wash, so one character reads the same way in a run and on this screen.
    r.drawRect(x + 2, y + 2, w - 4, Math.max(2, h * 0.055), rc, owned ? 0.95 : 0.3);
    r.strokeRect(x, y, w, h, rc, 1.5, owned ? 0.75 : 0.28);

    const cx = x + w / 2, cy = y + h / 2 + h * 0.03;
    const sp = this._art(c).face;
    if (!sp) {
      ui.text((c.visual && c.visual.emoji) || '★', cx, cy, {
        size: Math.max(11, h * 0.42), align: 'center', alpha: owned ? 1 : 0.35,
      });
      return;
    }
    // Fitted to the SHORT side so a plate that is not quite square still frames
    // the whole bust instead of cropping its shoulders.
    const k = (Math.min(w, h) - 8) / Math.max(sp.w, sp.h);
    r.drawSprite(sp, cx, cy, 0, k, owned ? 1 : 0.24, !owned, 0);
  },

  /**
   * The same bust with no plate and no gutter, laid into the card as a BACKDROP.
   *
   * This is what a card too narrow for a face column gets, and it exists because
   * the alternative was worse. At 1024x640 the grid packs to four columns of
   * ~90px, and a 33px plate there leaves 33px for a name — so the choice was
   * between a face on every card at every window size, or no face at all below
   * about 1280. A wash is neither: it costs no layout, it bleeds behind the
   * right-hand half where only the rarity chip sits, and at this alpha it reads
   * as texture that happens to be a person rather than as art competing with
   * the text on top of it.
   *
   * Drawn BEFORE the card's text, and the grid's clip rect keeps it off the
   * neighbours.
   */
  _faceWash(r, c, owned, x, y, w, h) {
    const sp = this._art(c).face;
    if (!sp) return;
    const k = (h - 4) / Math.max(sp.w, sp.h);
    r.drawSprite(sp, x + w - sp.w * k * 0.5 - 3, y + h / 2, 0, k,
                 owned ? 0.28 : 0.14, !owned, 0);
  },

  /**
   * The full-body world sprite, standing on a floor line. Sheet only — a grid
   * full of these would be a grid full of animations all competing for the eye,
   * and at 46px of card height there is no room for a figure anyway.
   *
   * It idles on the sprite's two bob frames the way player.js does, but SLOWER:
   * the in-run rate is 4Hz standing and 9Hz moving, which is right for something
   * crossing an arena and unreadable on a menu you are trying to read next to.
   * `ui.time` is the toolkit's own real-time clock — the same one every pulse on
   * this screen already runs off — so this adds no timebase and reads no input.
   */
  _bodyPlate(r, c, owned, x, y, w, h, rc) {
    r.drawRoundRect(x, y, w, h, 5, '#0b0f1c', owned ? 0.92 : 0.7);
    r.strokeRect(x, y, w, h, rc, 1.5, owned ? 0.55 : 0.22);

    const floorY = y + h - 12;
    r.drawRect(x + 4, floorY, w - 8, 1, rc, owned ? 0.35 : 0.14);

    const sp = this._art(c).body;
    if (!sp) {
      ui.text((c.visual && c.visual.emoji) || '★', x + w / 2, y + h / 2, {
        size: Math.max(11, w * 0.5), align: 'center', alpha: owned ? 1 : 0.35,
      });
      return;
    }
    const k = Math.min((w - 12) / sp.w, (h - 26) / sp.h);
    const anim = ((ui.time * 3) | 0) & 1;
    const bob = Math.sin(ui.time * 2.1) * 1.5;
    // Shadow first, and it stays put while the figure floats — a shadow that
    // rides up with the sprite is the thing that makes a bob look like a glitch.
    r.drawRect(x + w / 2 - sp.w * k * 0.28, floorY - 2, sp.w * k * 0.56, 4,
               '#000000', owned ? 0.45 : 0.25);
    r.drawSprite(sp, x + w / 2, floorY - sp.h * k * 0.5 + bob, 0, k,
                 owned ? 1 : 0.24, !owned, anim);
  },

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

  /**
   * One row of the filter bar: a label, then one directly-clickable chip per
   * state. `textOf(value, chipW)` may shorten itself when the chip is narrow;
   * `tipOf(value)` supplies the tooltip that carries the meaning an icon alone
   * cannot (SECTION 13 — never let a glyph be the only label).
   */
  _segment(r, id, x, y, w, h, labW, label, values, active, textOf, tipOf, choose) {
    ui.text(label, x, y + h / 2, { size: 11, color: PALETTE.textFaint, weight: 800 });
    const n = values.length;
    const gap = 4;
    const cw = Math.max(24, (w - labW - gap * (n - 1)) / n);
    for (let i = 0; i < n; i++) {
      const cx = x + labW + i * (cw + gap);
      const on = i === active;
      if (ui.button(id + i, cx, y, cw, h, '', {
        radius: 8, tooltip: tipOf ? tipOf(values[i]) : null,
      })) { choose(i); }
      // CHOSEN is not FOCUSED. The toolkit paints focus; this paints the state,
      // over the top, so the two are never confused for one another.
      if (on) {
        r.drawRoundRect(cx + 2, y + 2, cw - 4, h - 4, 6, PALETTE.accent, 0.18);
        r.drawRect(cx + 6, y + h - 6, cw - 12, 3, PALETTE.accent, 0.95);
      }
      ui.text(fit(r, textOf(values[i], cw), cw - 8, 12, 800), cx + cw / 2, y + h / 2 - 1, {
        size: 12, color: on ? PALETTE.accent : PALETTE.textDim, align: 'center', weight: 800,
      });
    }
  },

  // --- left: the grid --------------------------------------------------------
  _drawGrid(r, px, py, pw, ph) {
    const ip = 12;
    const fx = px + ip;
    const fw = pw - ip * 2;
    const D = this.manager.data;

    // Three segmented rows. Every state is on screen and one click away — the
    // old cycling buttons hid 14 of the 17 states behind repeated clicking.
    const fh = ph >= 460 ? 34 : 28;
    const rowGap = 6;
    const labW = 66;
    let fy = py + ip;

    const elementTip = 'fire > steel > lightning > water > fire. Shadow and Light beat each other. ' +
      'Spirit is neutral. Worth ' + pctAbs(D.elements.ELEMENT_BONUS) + ' either way.';

    this._segment(r, 'f_rar', fx, fy, fw, fh, labW, 'RARITY', RARITY_FILTERS, this.rarityIdx,
      (v) => (v ? RARITY_NAME[v] : 'ALL'),
      (v) => (v ? 'Only ' + RARITY_NAME[v] + ' characters.' : 'Every rarity.'),
      (i) => { this.rarityIdx = i; this._refresh(); });
    fy += fh + rowGap;

    this._segment(r, 'f_ele', fx, fy, fw, fh, labW, 'ELEMENT', this.elementIds, this.elementIdx,
      (id, cw) => {
        if (id === 'all') return 'ALL';
        const el = D.elements.ELEMENTS[id];
        const full = el.icon + ' ' + el.name.toUpperCase();
        // Narrow chips fall back to the glyph; the tooltip and the count line
        // below both still spell the element out in words.
        return r.measureText(full, 12 * (ui.scale || 1), 800) <= cw - 8 ? full : el.icon;
      },
      (id) => (id === 'all' ? 'Every element. ' + elementTip
                            : D.elements.ELEMENTS[id].name.toUpperCase() + '. ' + elementTip),
      (i) => { this.elementIdx = i; this._refresh(); });
    fy += fh + rowGap;

    this._segment(r, 'f_sort', fx, fy, fw, fh, labW, 'SORT', SORT_MODES, this.sortIdx,
      (v) => (v === 'OWNED FIRST' ? 'OWNED' : v), null,
      (i) => { this.sortIdx = i; this._refresh(); });
    fy += fh;

    const view = this._view;
    const listY = fy + 8;
    const ele = this.elementIds[this.elementIdx];
    const eleDef = D.elements.ELEMENTS[ele];
    const filterWords = (RARITY_FILTERS[this.rarityIdx] ? RARITY_NAME[RARITY_FILTERS[this.rarityIdx]] + '  ·  ' : '') +
      (eleDef ? eleDef.icon + ' ' + eleDef.name.toUpperCase() + '  ·  ' : '') +
      SORT_MODES[this.sortIdx];
    ui.text(fit(r, (view.length === this.chars.length
      ? 'All ' + this.chars.length + ' of them'
      : 'Showing ' + view.length + ' of ' + this.chars.length) + '  ·  ' + filterWords, fw, 12, 600),
      fx, listY + 8, { size: 12, color: PALETTE.textFaint });

    const gy = listY + 20;
    const gh = py + ph - ip - gy;
    if (gh < 40 || view.length === 0) {
      if (view.length === 0) {
        ui.text('Nobody matches that. Loosen a filter.', fx, gy + 24,
          { size: 14, color: PALETTE.textDim });
      }
      this._focusMark = ui.focus;
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

    // THE FACE GUTTER. One square plate down the left of every card, sized from
    // the cell so it degrades instead of overflowing: bounded by the card's
    // height (a short wide card gets a short face, not one hanging off the
    // bottom) and by roughly a third of its width (so the name still has
    // somewhere to go), and capped at 52 because past that the bust wins an
    // argument it should not — the grid is for scanning, and a name you cannot
    // read is a card you have to click to identify.
    //
    // Below 54px of remaining text width the column is dropped and the face
    // becomes a backdrop instead (`_faceWash`) — a card with a face and no room
    // for a name is worse than a card with no face, but a card with NO face is
    // the thing this whole change exists to get rid of.
    const faceBox = Math.round(clamp(Math.min(cellH - 10, cellW * 0.36), 22, 52));
    const showFace = cellW - faceBox - 26 >= 54;
    const textDx = showFace ? faceBox + 14 : 10;

    const equipped = this.manager.shared.characterId;

    // r.clipRect() clips DRAWING only — hit-testing goes straight through it, so
    // every button below is handed the same rect via `clip` or a card scrolled
    // half off the bottom stays fully clickable while being invisible.
    const clip = { x: px + 2, y: gy - 2, w: pw - 4, h: gh + 4 };
    // Hover can only move the focus DURING this loop, so a focus index that is
    // already different when the loop STARTS was moved by ui.end()'s arrow/stick
    // navigation last frame. That is how the keyboard previews and the pointer
    // does not — see the `kbNav` branch below.
    const kbNav = ui.focus !== this._focusMark;
    // Parked once for the whole grid rather than per card. Closed immediately
    // after the loop — there is no early return between here and there.
    cullOff(r);
    r.clipRect(clip.x, clip.y, clip.w, clip.h);
    for (let i = 0; i < view.length; i++) {
      const c = view[i];
      const col = i % cols, row = (i / cols) | 0;
      const x = fx + col * (cellW + cellGap);
      const y = gy + row * (cellH + cellGap);
      if (y > gy + gh) break;

      const e = rosterEntry(c.id);
      const rc = RARITY_COLOR[c.rarity] || PALETTE.border;
      const idx = ui.itemCount;

      if (ui.button('c_' + c.id, x, y, cellW, cellH, '', { radius: 12, clip })) {
        this._select(c.id);
      }
      // Focus follows the stick/arrows: highlighting a card previews it, which
      // is the whole reason the sheet is on screen at the same time. A MOUSE
      // hover does not preview — hover also takes ui.focus, and sweeping the
      // pointer across 19 cards on the way somewhere else reset the sheet's
      // scroll position nineteen times.
      else if (kbNav && ui.focus === idx) this._select(c.id);

      // rarity wash + base strip
      r.drawRoundRect(x + 2, y + 2, cellW - 4, cellH * 0.34, 10, rc, e.owned ? 0.16 : 0.04);
      r.drawRect(x + 3, y + cellH - 5, cellW - 6, 3, rc, e.owned ? 0.9 : 0.22);

      if (this.selected === c.id) {
        r.strokeRect(x - 2, y - 2, cellW + 4, cellH + 4, PALETTE.accent2, 2, 0.85);
      }

      // The plate is square and vertically centred, so it sits clear of the
      // card's own base strip at the bottom whatever the row height works out to.
      if (showFace) {
        this._facePlate(r, c, e.owned, x + 6, y + (cellH - faceBox) / 2,
                        faceBox, faceBox, rc);
      } else {
        this._faceWash(r, c, e.owned, x + 2, y + 2, cellW - 4, cellH - 4);
      }

      const tx = x + textDx;
      const nameW = cellW - textDx - 10;
      const roomy = cellH >= 66;                 // has space for the glyph row
      const yName = roomy ? 38 : 17;
      const yLine2 = roomy ? 56 : 34;
      const yLine3 = 74;

      if (e.owned) {
        // Only where the plate is not already carrying the face. The emoji is
        // this card's oldest identity cue and it keeps its corner on the narrow
        // layout — where the face is a wash on the far side and cannot be the
        // thing your eye lands on — but stacking it on top of a framed bust is
        // two portraits arguing in one 52px box.
        if (roomy && !showFace) {
          ui.text((c.visual && c.visual.emoji) || '★', tx, y + 17, { size: 15 });
        }
        ui.text(RARITY_NAME[c.rarity], x + cellW - 10, y + (roomy ? 17 : yName),
          { size: 12, color: rc, align: 'right', weight: 800 });
        ui.text(fit(r, displayName(c), roomy ? nameW : nameW - 30, 14, 800), tx, y + yName,
          { size: 14, color: PALETTE.text, weight: 800 });
        starPips(r, tx, y + yLine2, e.starLevel || 1, PALETTE.accent, 11);
        if (!compact) {
          const el = this.manager.data.elements.ELEMENTS[c.element];
          ui.text(fit(r, (el ? el.icon + ' ' + el.name : c.element) + '  ·  ' + c.archetype,
            nameW, 11, 500), tx, y + yLine3, { size: 11, color: PALETTE.textFaint });
        }
        if (equipped === c.id) {
          ui.text('ON STAGE', x + cellW - 10, y + yLine2,
            { size: 10, color: PALETTE.good, align: 'right', weight: 800 });
        }
      } else {
        // Silhouette: the shape is there, the person is not. The plate draws the
        // real sprite as its white twin; only a card too narrow for a plate at
        // all falls back to the old '?' disc.
        if (roomy && !showFace) {
          r.drawCircle(tx + 10, y + 20, 9, '#1a2035', 1);
          ui.text('?', tx + 10, y + 20, { size: 14, color: '#39415f', align: 'center', weight: 800 });
        }
        ui.text(RARITY_NAME[c.rarity], x + cellW - 10, y + (roomy ? 20 : yName),
          { size: 12, color: rc, align: 'right', weight: 800, alpha: 0.55 });
        ui.text('NOT OWNED', tx, y + yName,
          { size: 12, color: PALETTE.textFaint, weight: 800 });
        const bl = this.bannersFor[c.id];
        if (!bl || bl.length === 0) {
          ui.text('No banner carries them.', tx, y + yLine2,
            { size: 10, color: PALETTE.bad });
        } else if (compact) {
          ui.text(bl.length + (bl.length === 1 ? ' banner' : ' banners'), tx, y + yLine2,
            { size: 10, color: PALETTE.textFaint });
        } else {
          for (let b = 0; b < Math.min(2, bl.length); b++) {
            ui.text(fit(r, (bl[b].featured ? '★ ' : '· ') + bl[b].name, nameW, 10, 600),
              tx, y + yLine2 + b * 14,
              { size: 10, color: bl[b].featured ? PALETTE.accent : PALETTE.textFaint });
          }
          if (bl.length > 2 && cellH >= 96) {
            ui.text('+' + (bl.length - 2) + ' more', tx, y + yLine2 + 28,
              { size: 10, color: PALETTE.textFaint });
          }
        }
      }
    }
    r.unclip();
    cullOn(r);
    this._focusMark = ui.focus;
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
    //
    // THE PLACE TO SPEND PIXELS. Both sprites, side by side: the bust that says
    // who they are, then the figure that says what you will be looking at for
    // twenty minutes.
    //
    // The big header needs BOTH dimensions to earn it — tall enough that the
    // scrolling body still has something to scroll, and wide enough that two
    // plates plus a 26px name is not the entire panel. Failing either, it falls
    // back to roughly the height this header always was.
    const hh = (ph >= 430 && cw >= 560) ? 138 : 106;
    // 30 short of the header: ui.card() paints its own rarity band across the
    // top and its own countable pip row along the bottom, and the plates have to
    // sit inside both of them rather than over them.
    const artH = hh - 30;
    const hx = px + ip, hy = py + ip;
    const bustW = artH;
    const bodyW = Math.round(artH * 0.62);
    // The figure is the first thing to go on a narrow panel — the bust is the
    // identity, the figure is the appraisal, and a name squeezed to six
    // characters costs more than a second picture buys. At the compact art size
    // the two plates together are ~130px, so this only actually bites on a
    // panel too narrow to be legible with or without them.
    const showBody = cw >= bustW + bodyW + 240;
    const artW = bustW + (showBody ? bodyW + 8 : 0);
    const tx = hx + 24 + artW;
    const textW = Math.max(60, cw - (tx - hx) - 116);
    // Baselines as fractions of the header, not constants: at 106 they land back
    // on the 28 / 52 / 74 the fixed layout used, and at 138 they spread instead
    // of leaving a hole under the last line.
    const l1 = hy + Math.round(hh * 0.27);
    const l2 = hy + Math.round(hh * 0.48);
    const l3 = hy + Math.round(hh * 0.68);

    ui.card(hx, hy, cw, hh, c.rarity);

    cullOff(r);
    this._facePlate(r, c, e.owned, hx + 10, hy + 12, bustW, artH, rc);
    if (showBody) {
      this._bodyPlate(r, c, e.owned, hx + 18 + bustW, hy + 12, bodyW, artH, rc);
    }
    cullOn(r);
    // The emoji has not been thrown away — it is the character's own shorthand
    // everywhere else in the game — it is a badge on the plate now rather than
    // the only art on the screen. It gets its own chip: a bare glyph laid over
    // a shoulder is unreadable against half the palettes on this roster.
    // Inset by 2px on both edges so the chip sits INSIDE the plate's own rule
    // rather than straddling it.
    const bgx = hx + bustW - 4, bgy = hy + artH - 2;
    r.drawRoundRect(bgx - 12, bgy - 12, 24, 24, 7, '#0b0f1c', 0.88);
    r.strokeRect(bgx - 12, bgy - 12, 24, 24, rc, 1, e.owned ? 0.6 : 0.25);
    ui.text((c.visual && c.visual.emoji) || '★', bgx, bgy,
      { size: 15, align: 'center', alpha: e.owned ? 1 : 0.5 });

    ui.text(fit(r, displayName(c), textW, 26, 800), tx, l1,
      { size: 26, color: PALETTE.text, weight: 800 });
    ui.text(fit(r, c.epithet, textW, 14, 600), tx, l2,
      { size: 14, color: rc, weight: 700 });
    const el = D.elements.ELEMENTS[c.element];
    ui.text(fit(r, RARITY_NAME[c.rarity] + '  ·  ' + c.archetype + '  ·  ' +
            (el ? el.icon + ' ' + el.name : c.element), textW, 12, 600),
      tx, l3, { size: 12, color: PALETTE.textDim });

    if (e.owned) {
      starPips(r, hx + cw - 96, l1 - 2, e.starLevel || 1, PALETTE.accent, 15);
      ui.text('S' + (e.starLevel || 1), hx + cw - 16, l2,
        { size: 13, color: PALETTE.accent, align: 'right', weight: 800, mono: true });
      ui.text('BOND ' + (e.bond || 0) + '  ·  ' + (e.runs || 0) + ' runs',
        hx + cw - 16, l3, { size: 12, color: PALETTE.textDim, align: 'right' });
    } else {
      ui.text('NOT OWNED', hx + cw - 16, l1,
        { size: 15, color: PALETTE.bad, align: 'right', weight: 800 });
      const bl = this.bannersFor[c.id] || [];
      const line = bl.length
        ? bl.map((b) => (b.featured ? '★' : '') + b.name).join('  ·  ')
        : 'Not in any banner pool.';
      // Measured against the space LEFT OF the right edge and RIGHT OF the art,
      // not against the whole panel: right-aligned text that fits `cw - 130`
      // starts underneath the plates on a narrow sheet.
      ui.text(fit(r, line, Math.max(60, cw - (tx - hx) - 130), 11, 600), hx + cw - 16, l2,
        { size: 11, color: PALETTE.textFaint, align: 'right' });
      ui.text('★ = rate-up', hx + cw - 16, l3,
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

    // The scroll rail. It used to be two 30x30 buttons with a painted 2px track
    // and a 4px thumb between them that was neither clickable nor draggable —
    // a mouse without a wheel could not reach the bottom of any sheet.
    const railW = 40;
    const btnH = 36;
    const contentW = cw - railW - 10;
    const sbX = hx + cw - railW;

    const key = c.id + '|' + Math.round(contentW) + '|' + (e.owned ? 1 : 0) + '|' +
                (e.starLevel || 1) + '|' + (e.bond || 0) + '|' + (ui.scale || 1);
    if (this._sheetKey !== key) {
      this._sheet = this._buildSheet(r, c, e, contentW);
      this._sheetKey = key;
    }
    const sheet = this._sheet;
    const twoCol = contentW >= 620;
    const total = twoCol ? Math.max(sheet.hA, sheet.hB) : sheet.hA + sheet.hB;
    const visible = Math.max(1, bodyH - 8);
    const maxScroll = Math.max(0, total - visible);

    const up = ui.button('sc_up', sbX, bodyTop, railW, btnH, '▲',
      { size: 13, radius: 8, disabled: maxScroll <= 0 });
    const dn = ui.button('sc_dn', sbX, bodyTop + bodyH - btnH, railW, btnH, '▼',
      { size: 13, radius: 8, disabled: maxScroll <= 0 });

    if (input.wheel && ui.pointIn(px, bodyTop, pw, bodyH)) this.sheetScroll += input.wheel * 56;
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

    this.sheetScroll = ui.scrollbar('sheetBar', sbX + railW / 2 - 5, bodyTop + btnH + 6, 10,
      Math.max(12, bodyH - btnH * 2 - 12), this.sheetScroll, visible, total);
    this.sheetScroll = clamp(this.sheetScroll, 0, maxScroll);
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

    // 36px, not 34 — and the tooltip is pinned to the bottom of the panel, so it
    // relies on the toolkit flipping it ABOVE the button when there is no room
    // below. There never is: this button sits ~80px off the bottom of the screen.
    const btnH = 36;
    const by = y + h - btnH - 8;
    const bw = w - 24;
    const upW = Math.round(bw * 0.58);
    const upLabel = maxed ? 'S5 — MAXED'
      : !e.owned ? 'NOT OWNED'
      : 'RAISE TO S' + next + '  ·  ' + comma(cost) + ' 💌';
    if (ui.button('star_up', x + 12, by, upW, btnH, upLabel, {
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
    if (ui.button('equip', x + 12 + upW + 8, by, bw - upW - 8, btnH,
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
    mk.t(A, (esc.cooldown > 0 ? trim1(esc.cooldown) + 's cooldown' : 'NO COOLDOWN') +
      '  ·  ' + trim1(esc.iframes) + 's i-frames',
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
