// THE SHRINE — hub node 4 (SECTION 12 lines 1573-1586).
//
// Ten permanent upgrades bought with GOLD. Every card prints the exact effect at
// the level you own AND at the level you are being asked to buy, side by side
// ("+6% damage → +8% damage"), plus the exact price. No adjectives anywhere.
//
// CURSE is the row the spec singles out: "+10% enemy count AND +8% all rewards
// (5 levels — opt-in difficulty; this is the best value upgrade for good players
// and a trap for bad ones. Label it honestly.)" Both halves are stated in the
// same sentence, in that order, and the trap is spelled out on the card in the
// caution colour. It is also genuinely locked until save.unlocks.curse, which
// only the `kill_10000_enemies` achievement flips (DECISIONS.md §24) — the card
// shows the requirement and the live kill count while it waits.
//
// THE REFUND IS FREE, FULL AND ALWAYS ON SCREEN (line 1586: "Let players
// experiment"). It hands back every gold ever spent here and zeroes every level,
// behind one confirmation. That button is the entire reason Curse can be an
// honest offer instead of a trap.
//
// Cost of the next level, for an upgrade you own `lv` levels of:
//     round(baseCost * costGrowth^lv)
// which is the spec's own "100 * 1.55^n" for Might and sums to the ~14,370 gold
// the data file documents for all ten levels.
//
// Every number laid out here comes off r.w / r.h. Nothing assumes 1920x1080.

import { ui, PALETTE, wrapText, formatCount } from '../ui/widgets.js';
import { save, spendCurrency } from '../core/save.js';
import { audio } from '../core/audio.js';
import { displayName } from '../core/config.js';
import { clamp } from '../core/math.js';

const comma = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const trim1 = (v) => String(Math.round(v * 10) / 10);

/** Measured at the size it is DRAWN at — ui.text scales by settings.uiScale. */
function fit(r, text, maxW, size, weight) {
  const w = weight || 600;
  const px = size * (ui.scale || 1);
  let s = String(text);
  if (r.measureText(s, px, w) <= maxW) return s;
  while (s.length > 1 && r.measureText(s + '…', px, w) > maxW) s = s.slice(0, -1);
  return s + '…';
}

/** Gold to buy the NEXT level when you already own `level` of them. */
function costOf(u, level) {
  return Math.round(u.baseCost * Math.pow(u.costGrowth, level));
}

/** Everything the shrine has ever taken for this row at its current level. */
function investedIn(u, level) {
  let sum = 0;
  for (let i = 0; i < level; i++) sum += costOf(u, i);
  return sum;
}

/**
 * The one row with two stats uses `effects`; everything else declares
 * stat/perLevel/mode directly. Normalising here means nothing downstream ever
 * branches on which shape an upgrade has.
 */
function effectsOf(u) {
  return u.effects || [{ stat: u.stat, perLevel: u.perLevel, mode: u.mode }];
}

/**
 * The card's running-total phrase at a given level, built from the upgrade's own
 * `fmt` string. {v} is the first effect, {v2} the second — percentages already
 * multiplied out, exactly as shrine.js documents.
 */
function fmtAt(u, level) {
  const parts = effectsOf(u);
  const disp = (p) => {
    const raw = p.perLevel * level;
    return trim1(p.mode === 'add' ? raw * 100 : raw);
  };
  let s = String(u.fmt).replace('{v}', disp(parts[0]));
  if (parts[1]) s = s.replace('{v2}', disp(parts[1]));
  return s;
}

// The aggregate-preview table. Stat keys are the ones the run actually reads —
// player.js for the stat bucket, run.js for Curse's two — so a row here is a
// promise the engine keeps.
const PREVIEW_ROWS = [
  { stat: 'damageMult', label: 'Damage', kind: 'pct' },
  { stat: 'maxHpMult', label: 'Max HP', kind: 'pct' },
  { stat: 'moveSpeedMult', label: 'Move speed', kind: 'pct' },
  { stat: 'goldMult', label: 'Gold gain', kind: 'pct' },
  { stat: 'xpMult', label: 'XP gain', kind: 'pct' },
  { stat: 'freeRerolls', label: 'Level-up rerolls', kind: 'flat', base: 'freeRerolls' },
  { stat: 'banishes', label: 'Level-up banishes', kind: 'flat', base: 'banishes' },
  { stat: 'revives', label: 'Starting revives', kind: 'flat', note: 'cap 3' },
  { stat: 'luck', label: 'Starting luck', kind: 'flat' },
  { stat: 'countMult', label: 'Enemy count', kind: 'pct', tone: 'bad' },
  { stat: 'rewardMult', label: 'All rewards', kind: 'pct', tone: 'good' },
];

export const shrineScene = {
  manager: null,

  enter(params, mgr) {
    if (mgr) this.manager = mgr;
    const D = this.manager.data;
    this.ups = D.shrine.SHRINE_UPGRADES;

    // The price of owning literally everything. Static — computed once.
    let all = 0;
    for (const u of this.ups) all += investedIn(u, u.maxLevel);
    this.maxCost = all;

    // The achievement that opens Curse, found by what it GRANTS rather than by
    // id, so renaming the achievement cannot silently break this screen.
    this.gateAch = null;
    for (const a of D.achievements.ACHIEVEMENTS) {
      if (a.reward && a.reward.unlock === 'curse') { this.gateAch = a; break; }
    }

    this.confirm = false;
    this._wrapKey = '';
    this._wrap = Object.create(null);
  },

  exit() { this.confirm = false; },

  resize() { this._wrapKey = ''; },

  update() {},

  clearColor() { return '#05060d'; },

  // --- helpers ---------------------------------------------------------------
  _level(u) { return save.data.shrine[u.id] || 0; },

  _locked(u) { return !!(u.lockedBy && !save.data.unlocks[u.lockedBy]); },

  /** Gold owed back by a full refund. */
  _refundTotal() {
    let fromLevels = 0;
    for (const u of this.ups) fromLevels += investedIn(u, this._level(u));
    // A hand-edited or migrated save can carry levels with no recorded spend.
    // Refund the larger of the two so the player is never short-changed.
    return Math.max(save.data.shrineSpent || 0, fromLevels);
  },

  /**
   * Wrapped copy, cached per card width and UI scale. Ten cards x two paragraphs
   * of text-shaping every frame would be the only expensive thing on this screen,
   * so it happens once per resize instead.
   */
  _wrapped(r, id, text, w, size) {
    const S = ui.scale || 1;
    const key = Math.round(w) + '|' + size + '|' + S;
    if (this._wrapKey !== key) { this._wrapKey = key; this._wrap = Object.create(null); }
    let v = this._wrap[id];
    if (!v) { v = wrapText(r, String(text), w, size * S); this._wrap[id] = v; }
    return v;
  },

  _aggregate() {
    const out = Object.create(null);
    for (const u of this.ups) {
      const lv = this._level(u);
      if (lv <= 0) continue;
      for (const p of effectsOf(u)) {
        if (!p.stat) continue;
        out[p.stat] = (out[p.stat] || 0) + p.perLevel * lv;
      }
    }
    return out;
  },

  _buy(u) {
    const lv = this._level(u);
    if (lv >= u.maxLevel || this._locked(u)) return;
    const cost = costOf(u, lv);
    if (!spendCurrency('gold', cost)) {
      this.manager.toast('You are ' + comma(cost - (save.data.currencies.gold || 0)) +
        ' gold short.', PALETTE.bad, '🪙');
      audio.play('uiBack');
      return;
    }
    save.data.shrine[u.id] = lv + 1;
    save.data.shrineSpent = (save.data.shrineSpent || 0) + cost;
    save.save();
    audio.play('levelUp');
    this.manager.toast(displayName(u) + ' Lv ' + (lv + 1) + ' — ' + fmtAt(u, lv + 1),
      u.warning ? PALETTE.bad : PALETTE.accent, u.icon);
  },

  _refund() {
    const amount = this._refundTotal();
    // Written straight to the wallet, NOT through addCurrency: a refund is not
    // gold earned, and it must not inflate stats.goldEarned or nudge the
    // lifetime-gold achievement.
    save.data.currencies.gold = (save.data.currencies.gold || 0) + amount;
    for (const u of this.ups) save.data.shrine[u.id] = 0;
    save.data.shrineSpent = 0;
    save.save();
    audio.play('chest');
    this.manager.toast('Refunded ' + comma(amount) + ' gold. Ten levels of nothing. Try something else.',
      PALETTE.good, '🪙');
  },

  /** ui.button, unless a modal is up — then it is a dead, greyed facsimile. */
  _btn(id, x, y, w, h, label, opts) {
    if (!this.confirm) return ui.button(id, x, y, w, h, label, opts);
    const o = opts || {};
    ui.panel(x, y, w, h, {
      color: 'rgba(14,18,32,0.5)',
      radius: o.radius === undefined ? 10 : o.radius,
    });
    if (label) {
      ui.text(label, o.textAlign === 'left' ? x + 14 : x + w / 2, y + h / 2, {
        size: o.size || 16, color: PALETTE.textFaint, weight: 700,
        align: o.textAlign || 'center',
      });
    }
    return false;
  },

  // ---------------------------------------------------------------------------
  render(r) {
    ui.begin(r, this.confirm ? 'shrine.confirm' : 'shrine');

    const pad = Math.round(clamp(r.w * 0.018, 12, 26));
    const headerH = 38;
    const bodyY = pad + headerH + 10;
    const bodyH = Math.max(220, r.h - bodyY - pad);
    const gap = 12;
    const rightW = Math.round(clamp(r.w * 0.28, 250, 420));
    const leftW = Math.max(240, r.w - pad * 2 - gap - rightW);
    const rightX = pad + leftW + gap;

    // --- header ---------------------------------------------------------------
    const back = this._btn('__back', pad, pad, 92, 34, '‹ BACK', { size: 14 });
    ui.title('THE SHRINE', pad + 104, pad + headerH / 2, { size: 24 });
    ui.text('Permanent. Bought with gold. Refundable in full, for free, forever.',
      pad + 104 + r.measureText('THE SHRINE', 24 * (ui.scale || 1), 800) + 16,
      pad + headerH / 2, { size: 13 });

    const gold = save.data.currencies.gold || 0;
    const gw = r.measureText(formatCount(gold), 15, 700) + 42;
    ui.currency(r.w - pad - gw, pad + 4, '🪙', gold, PALETTE.gold);

    // --- panels ---------------------------------------------------------------
    ui.panel(pad, bodyY, leftW, bodyH, { radius: 16 });
    ui.panel(rightX, bodyY, rightW, bodyH, { radius: 16 });

    const cols = this._drawCards(r, pad, bodyY, leftW, bodyH);
    this._drawPreview(r, rightX, bodyY, rightW, bodyH);

    // --- the confirmation -----------------------------------------------------
    if (this.confirm) {
      this._drawConfirm(r);
      ui.focusGrid(2);
      ui.end();
      if (ui.backPressed()) { this.confirm = false; audio.play('uiBack'); }
      return;
    }

    ui.focusGrid(Math.max(1, cols));
    ui.end();

    if (back || ui.backPressed()) { audio.play('uiBack'); this.manager.go('hub'); }
  },

  // --- the ten cards ---------------------------------------------------------
  _drawCards(r, px, py, pw, ph) {
    const ip = 12;
    const gx = px + ip;
    const gw = pw - ip * 2;
    const gy = py + ip;
    const gh = ph - ip * 2;

    const cardGap = 10;
    const cols = gw >= 660 ? 2 : 1;
    const rows = Math.ceil(this.ups.length / cols);
    const cardW = (gw - cardGap * (cols - 1)) / cols;
    const cardH = clamp((gh - cardGap * (rows - 1)) / rows, 74, 168);
    const gold = save.data.currencies.gold || 0;

    r.clipRect(px + 2, py + 2, pw - 4, ph - 4);
    for (let i = 0; i < this.ups.length; i++) {
      const u = this.ups[i];
      const col = i % cols, row = (i / cols) | 0;
      const x = gx + col * (cardW + cardGap);
      const y = gy + row * (cardH + cardGap);

      const lv = this._level(u);
      const maxed = lv >= u.maxLevel;
      const locked = this._locked(u);
      const cost = maxed ? 0 : costOf(u, lv);
      const afford = !maxed && !locked && gold >= cost;
      const isCurse = !!u.warning;

      let price = locked ? 'LOCKED' : maxed ? 'MAX' : comma(cost) + ' 🪙';
      if (!locked && !maxed && !afford) price += '  (' + comma(cost - gold) + ' short)';

      if (this._btn('u_' + u.id, x, y, cardW, cardH, '', {
        radius: 12, disabled: !afford,
      })) {
        this._buy(u);
      }

      // Accent wash: gold normally, caution red for the row that bites back.
      const accent = isCurse ? PALETTE.bad : maxed ? PALETTE.good : PALETTE.accent;
      r.drawRoundRect(x + 2, y + 2, cardW - 4, 26, 10, accent, locked ? 0.04 : 0.10);

      // --- row 1: name + level ------------------------------------------------
      ui.text(u.icon || '◆', x + 14, y + 18, { size: 16 });
      ui.text(fit(r, displayName(u).toUpperCase(), cardW * 0.5, 15, 800), x + 38, y + 18,
        { size: 15, color: locked ? PALETTE.textFaint : PALETTE.text, weight: 800 });
      ui.text('Lv ' + lv + ' / ' + u.maxLevel, x + cardW - 14, y + 18, {
        size: 13, align: 'right', weight: 800, mono: true,
        color: maxed ? PALETTE.good : locked ? PALETTE.textFaint : PALETTE.textDim,
      });

      // --- row 2: this level -> next level, and the price ---------------------
      const S = ui.scale || 1;
      const effY = y + 40;
      const priceW = r.measureText(price, 14 * S, 800) + 16;
      ui.text(price, x + cardW - 14, effY, {
        size: 14, align: 'right', weight: 800,
        color: maxed ? PALETTE.good : locked ? PALETTE.textFaint
          : afford ? PALETTE.gold : PALETTE.bad,
      });
      const effW = Math.max(60, cardW - 28 - priceW);
      if (maxed) {
        ui.text(fit(r, fmtAt(u, lv) + '  ·  nothing left to buy', effW, 14, 800), x + 14, effY,
          { size: 14, color: PALETTE.good, weight: 800 });
      } else {
        const cur = fmtAt(u, lv);
        const nxt = fmtAt(u, lv + 1);
        const curW = r.measureText(cur, 14 * S, 700);
        ui.text(cur, x + 14, effY, { size: 14, color: PALETTE.textDim, weight: 700 });
        ui.text('→', x + 22 + curW, effY, { size: 14, color: PALETTE.textFaint, weight: 700 });
        ui.text(fit(r, nxt, Math.max(40, effW - curW - 30), 14, 800), x + 44 + curW, effY, {
          size: 14, color: locked ? PALETTE.textFaint : accent, weight: 800,
        });
      }

      // --- row 3: pips, or the lock gate (a locked row is always level 0) -----
      let bodyTop = y + 58;
      if (locked) {
        const kills = save.data.stats.kills || 0;
        const target = (this.gateAch && this.gateAch.condition &&
                        this.gateAch.condition.value) || 10000;
        const req = (this.gateAch && this.gateAch.desc)
          ? this.gateAch.desc.split('.')[0]
          : 'Kill 10,000 enemies in total';
        ui.text(fit(r, '🔒 ' + req + ' — ' + comma(Math.min(kills, target)) + '/' + comma(target),
          cardW - 28, 12, 700), x + 14, y + 54,
          { size: 12, color: PALETTE.bad, weight: 700 });
        ui.bar(x + 14, y + 63, cardW - 28, 5, kills / target, PALETTE.bad);
        bodyTop = y + 78;
      } else {
        const pipW = (cardW - 28) / u.maxLevel;
        for (let s = 0; s < u.maxLevel; s++) {
          r.drawRect(x + 14 + s * pipW, y + 54, Math.max(3, pipW - 3), 4,
            s < lv ? accent : PALETTE.border, s < lv ? 0.95 : 1);
        }
      }

      // --- row 4: what it does, and (Curse only) what it costs you ------------
      const bodyBot = y + cardH - 6;
      const lineH = Math.round(14 * S);
      const textW = Math.max(80, cardW - 28);
      let ly = bodyTop;
      const lines = this._wrapped(r, u.id, u.desc, textW, 11);
      for (let l = 0; l < lines.length && ly + lineH - 2 <= bodyBot; l++) {
        ui.text(lines[l], x + 14, ly + 6, { size: 11, color: PALETTE.textFaint });
        ly += lineH;
      }
      // Curse is the one row that carries a warning, and SECTION 12 orders it
      // labelled honestly — so it prints in the caution colour, on the card,
      // under the sentence that states the payoff. Both halves, always.
      if (u.warning) {
        const wl = this._wrapped(r, u.id + ':warn', u.warning, textW, 11);
        ly += 3;
        for (let l = 0; l < wl.length && ly + lineH - 2 <= bodyBot; l++) {
          ui.text(wl[l], x + 14, ly + 6, { size: 11, color: PALETTE.bad, weight: 600 });
          ly += lineH - 1;
        }
      }
    }
    r.unclip();
    return cols;
  },

  // --- the live preview + the refund -----------------------------------------
  _drawPreview(r, px, py, pw, ph) {
    const D = this.manager.data;
    const ip = 14;
    const x = px + ip;
    const w = pw - ip * 2;
    const agg = this._aggregate();
    const LEVELUP = D.upgrades.LEVELUP;

    ui.text('ON YOUR NEXT RUN', x, py + ip + 10, { size: 12, color: PALETTE.accent2, weight: 800 });
    r.drawRect(x, py + ip + 20, w, 1, PALETTE.accent2, 0.25);

    const refundH = 118;
    const listTop = py + ip + 34;
    const listBottom = py + ph - ip - refundH;
    const rowH = clamp((listBottom - listTop - 40) / PREVIEW_ROWS.length, 15, 24);

    let y = listTop + rowH / 2;
    for (const row of PREVIEW_ROWS) {
      if (y > listBottom - 8) break;
      const v = agg[row.stat] || 0;
      let value, color;
      if (row.kind === 'pct') {
        value = (v > 0 ? '+' : '') + trim1(v * 100) + '%';
        color = v === 0 ? PALETTE.textFaint
          : row.tone === 'bad' ? PALETTE.bad
          : row.tone === 'good' ? PALETTE.good : PALETTE.text;
      } else {
        const base = row.base ? (LEVELUP[row.base] || 0) : 0;
        value = base ? comma(base) + ' → ' + comma(base + v) : (v > 0 ? '+' : '') + comma(v);
        if (row.note && v > 0) value += ' (' + row.note + ')';
        color = v === 0 ? PALETTE.textFaint : PALETTE.text;
      }
      ui.statRow(row.label, value, x, y, w, { color });
      y += rowH;
    }

    // The Curse verdict, in the one place the player is looking at totals.
    const curseLv = save.data.shrine.curse || 0;
    if (curseLv > 0) {
      const enemies = trim1((agg.countMult || 0) * 100);
      const rewards = trim1((agg.rewardMult || 0) * 100);
      ui.text('CURSE ' + curseLv + ': +' + enemies + '% of them, +' + rewards + '% of everything they drop.',
        x, y + 6, { size: 11, color: PALETTE.bad, weight: 700 });
    } else {
      ui.text('Element matchups, stage modifiers and difficulty tiers stack on top of these.',
        x, y + 6, { size: 10, color: PALETTE.textFaint });
    }

    // --- refund block ---------------------------------------------------------
    const ry = py + ph - ip - refundH;
    r.drawRect(x, ry, w, 1, PALETTE.border, 1);

    const invested = this._refundTotal();
    const pctDone = this.maxCost > 0 ? invested / this.maxCost : 0;
    ui.text('INVESTED', x, ry + 20, { size: 11, color: PALETTE.textFaint, weight: 800 });
    ui.text(comma(invested) + ' 🪙', x + w, ry + 20,
      { size: 15, color: PALETTE.gold, align: 'right', weight: 800, mono: true });
    ui.bar(x, ry + 32, w, 6, pctDone, PALETTE.gold);
    ui.text('Everything, every level: ' + comma(this.maxCost) + ' 🪙  (' +
            trim1(clamp(pctDone, 0, 1) * 100) + '% owned)',
      x, ry + 50, { size: 10, color: PALETTE.textFaint });

    const free = D.shrine.SHRINE_REFUND_FREE !== false;
    if (this._btn('refund', x, ry + 62, w, 34,
      invested > 0 ? 'REFUND EVERYTHING · ' + comma(invested) + ' 🪙' : 'NOTHING TO REFUND',
      { size: 13, disabled: invested <= 0 || !free })) {
      this.confirm = true;
    }
    ui.text(fit(r, 'Free. Always. Nothing here is a mistake you are stuck with.',
      w, 11, 600), x, ry + 106, { size: 11, color: PALETTE.textDim });
  },

  _drawConfirm(r) {
    r.overlay('#05060d', 0.74);
    const S = ui.scale || 1;
    const mw = Math.round(clamp(r.w * 0.5, 300, 580));
    const mh = Math.round(clamp(r.h * 0.46, 240, 320));
    const mx = Math.round((r.w - mw) / 2);
    const my = Math.round((r.h - mh) / 2);
    const amount = this._refundTotal();

    ui.panel(mx, my, mw, mh, {
      color: 'rgba(9,12,22,0.98)', borderColor: PALETTE.accent, borderWidth: 2, radius: 16,
    });
    ui.title('TEAR IT ALL DOWN?', mx + mw / 2, my + 40, { size: 22, align: 'center' });

    const lines = [
      comma(amount) + ' gold comes straight back to your wallet.',
      'All ten upgrades drop to level 0. You can rebuy any of them immediately.',
      'This costs nothing. It has never cost anything. That is the point.',
    ];
    let ty = my + 78;
    for (const l of lines) {
      for (const w2 of wrapText(r, l, mw - 56, 13 * S)) {
        ui.text(w2, mx + mw / 2, ty, { size: 13, color: PALETTE.textDim, align: 'center' });
        ty += 19 * S;
      }
      ty += 4;
    }

    const bw = (mw - 56) / 2;
    const by = my + mh - 56;
    // Cancel is registered FIRST so it is the one holding focus when the modal
    // opens — ui.begin resets focus to index 0 on the screen-id change.
    if (ui.button('cf_no', mx + 20, by, bw, 38, 'NO — LEAVE IT', { size: 14 })) {
      this.confirm = false;
      audio.play('uiBack');
    }
    if (ui.button('cf_yes', mx + 36 + bw, by, bw, 38, 'YES — REFUND IT ALL', { size: 14 })) {
      this._refund();
      this.confirm = false;
    }
  },
};
