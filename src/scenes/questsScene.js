// THE QUEST BOARD.
//
// One scrolling list of every quest, grouped by tier, each row showing what to
// do, how far along you are, and exactly what it pays. Completed rows stay
// visible with their reward struck through — a board that hides what you have
// already done stops being a record of progress.
//
// Nothing here CLAIMS anything: quests settle automatically the moment their
// counter is met (game/quests.js explains why). This screen is a reference, not
// a chore list, so it has exactly one interactive control per row and that
// control does nothing but scroll.
//
// INPUT LIVES IN render(), NOT update() — sceneManager.update() can run up to
// five fixed steps per frame, and reading input there fires navigation five
// times over.

import { ui, PALETTE, ellipsize, wrapText, formatCount } from '../ui/widgets.js';
import { save } from '../core/save.js';
import { input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { clamp } from '../core/math.js';
import { board, completedCount, unclaimedCount } from '../game/quests.js';
import { QUESTS, QUEST_TIERS } from '../data/quests.js';

const CURRENCY_ICON = {
  starFragments: '💎', gold: '⭐', tickets: '🎟', universalLetters: '💌',
};
const CURRENCY_COLOR = {
  starFragments: '#6ad8ff', gold: '#ffd76a', tickets: '#6ad8ff', universalLetters: '#ff5fa2',
};

export const questsScene = {
  manager: null,
  rows: null,
  scroll: 0,
  t: 0,

  enter(params, mgr) {
    this.manager = mgr || this.manager;
    this.t = 0;
    this.scroll = 0;
    this._nav = false;
    // Settle on arrival too: a pull made on the gacha screen can complete the
    // "have three characters" quest, and the player is looking straight at it.
    if (this.manager && this.manager.settleQuests) this.manager.settleQuests();
    this.rows = board();
  },

  exit() { this.rows = null; },

  resize() {},

  clearColor() { return '#0a0713'; },

  update(dt) {
    this.t += dt;
    save.data.playtime += dt;
    save.touch();
  },

  render(r) {
    const W = r.w, H = r.h;
    if (!this.rows) this.rows = board();
    ui.begin(r, 'quests');
    ui.focusGrid(1);

    const pad = Math.round(clamp(W * 0.02, 14, 30));
    this._backdrop(r);

    // --- header ---------------------------------------------------------------
    ui.title('QUESTS', pad + 124, 40, { size: 30 });
    const done = completedCount(), total = QUESTS.length;
    const ready = unclaimedCount();
    ui.text(`${done} / ${total} complete` + (ready ? `  ·  ${ready} just paid out` : ''),
            pad + 124, 66, { size: 13, color: ready ? '#7bf59a' : PALETTE.textFaint });

    const c = save.data.currencies;
    let cx = W - pad;
    for (const k of ['universalLetters', 'tickets', 'gold', 'starFragments']) {
      const w = r.measureText(formatCount(c[k] || 0), 15, 700) + 42;
      cx -= w + 8;
      ui.currency(cx, 22, CURRENCY_ICON[k], c[k] || 0, CURRENCY_COLOR[k]);
    }

    ui.text('Quests pay out the moment you finish them. There is nothing to claim.',
            pad, 92, { size: 12, color: PALETTE.textFaint });

    // --- the board ------------------------------------------------------------
    const listX = pad, listY = 112;
    const listW = W - pad * 2;
    const listH = H - listY - pad;
    ui.panel(listX, listY, listW, listH, { radius: 10 });

    const rowH = 62;
    const headerH = 26;
    // Build the flat draw list once per frame: tier headers interleaved with
    // their rows, so one scroll offset covers both.
    const flat = [];
    for (const tier of QUEST_TIERS) {
      const inTier = this.rows.filter((q) => q.quest.tier === tier);
      if (!inTier.length) continue;
      flat.push({ header: tier });
      for (const q of inTier) flat.push({ row: q });
    }

    let contentH = 0;
    for (const it of flat) contentH += it.header ? headerH : rowH;
    const viewH = listH - 16;
    const maxScroll = Math.max(0, contentH - viewH);
    if (input.wheel && ui.pointIn(listX, listY, listW, listH)) {
      this.scroll = clamp(this.scroll + input.wheel * 48, 0, maxScroll);
    }
    this.scroll = clamp(this.scroll, 0, maxScroll);

    const barW = maxScroll > 0 ? 14 : 0;
    const clip = { x: listX + 8, y: listY + 8, w: listW - 16 - barW, h: viewH };
    r.clipRect(clip.x, clip.y, clip.w, clip.h);
    let y = listY + 8 - this.scroll;
    for (const it of flat) {
      if (it.header) {
        if (y + headerH > clip.y && y < clip.y + clip.h) {
          ui.text(it.header.toUpperCase(), clip.x + 4, y + headerH / 2, {
            size: 11, color: PALETTE.accent, weight: 800, mono: true, baseline: 'middle',
          });
          r.drawRect(clip.x + 4 + r.measureText(it.header.toUpperCase(), 11, 800) + 10,
                     y + headerH / 2, clip.w - 20 - r.measureText(it.header.toUpperCase(), 11, 800),
                     1, 'rgba(150,170,225,0.2)', 1);
        }
        y += headerH;
        continue;
      }
      if (y + rowH > clip.y && y < clip.y + clip.h) {
        this._row(r, it.row, clip.x, y, clip.w, rowH - 6, clip);
      } else {
        ui.itemCount++;              // keep focus indices stable while scrolled
      }
      y += rowH;
    }
    r.unclip();

    if (barW) {
      this.scroll = ui.scrollbar('questBar', listX + listW - barW + 2, listY + 8,
                                 8, viewH, this.scroll, viewH, contentH);
    }

    if (ui.backButton(pad, 26) && !this._nav) {
      this._nav = true;
      audio.play('uiBack');
      this.manager.go('hub');
    }
    ui.end();
  },

  _row(r, q, x, y, w, h, clip) {
    const quest = q.quest;
    const col = q.claimed ? '#7bf59a' : q.done ? PALETTE.accent : PALETTE.text;
    const focused = ui.focus === ui.itemCount;

    r.drawRoundRect(x, y, w, h, 8,
                    q.claimed ? 'rgba(123,245,154,0.07)' : 'rgba(12,16,28,0.75)', 1);
    if (focused) r.strokeRect(x, y, w, h, PALETTE.borderHot, 2, 0.8);
    r.drawRect(x, y, 4, h, col, q.claimed ? 0.9 : q.done ? 1 : 0.35);

    ui.text(quest.icon || '◆', x + 30, y + h / 2, { size: 24, align: 'center', baseline: 'middle' });

    const tx = x + 54;
    const tw = w - 54 - 210;
    ui.text(ellipsize(r, quest.name, tw, 16, 800), tx, y + 18, {
      size: 16, color: col, weight: 800,
    });
    ui.text(ellipsize(r, quest.desc, tw, 12, 600), tx, y + 37, {
      size: 12, color: PALETTE.textDim,
    });

    // Progress: a bar and the raw counter, because "3/10" answers a question a
    // bar alone cannot.
    const bw = 150;
    const bx = x + w - 200;
    ui.bar(bx, y + 16, bw, 9, q.fraction, q.claimed ? '#7bf59a' : PALETTE.accent2,
           { bg: 'rgba(4,6,14,0.8)', segments: false });
    ui.text(`${formatCount(Math.min(q.have, q.need))} / ${formatCount(q.need)}`,
            bx + bw, y + 38, {
      size: 11, color: PALETTE.textFaint, align: 'right', mono: true, weight: 700,
    });

    ui.text(q.claimed ? 'PAID' : q.done ? 'PAYING…' : '', x + w - 22, y + 18, {
      size: 11, color: '#7bf59a', align: 'right', weight: 800, mono: true,
    });
    const rewardLines = wrapText(r, quest.rewardText, tw, 11, 700);
    ui.text(rewardLines[0] || '', tx, y + h - 8, {
      size: 11, color: q.claimed ? PALETTE.textFaint : CURRENCY_COLOR.starFragments, weight: 700,
    });

    // One invisible focus stop per row so the board is keyboard-navigable. It
    // does nothing when activated — there is nothing to claim.
    ui.button('q_' + quest.id, x, y, w, h, '', { invisible: true, clip });
  },

  _backdrop(r) {
    const c = r.ctx;
    const key = r.w + 'x' + r.h;
    if (this._bgKey !== key) {
      const g = c.createLinearGradient(0, 0, 0, r.h);
      g.addColorStop(0.00, '#241a33');
      g.addColorStop(0.55, '#150f23');
      g.addColorStop(1.00, '#0a0713');
      this._bgGrad = g;
      this._bgKey = key;
    }
    r.setAlpha(1);
    c.fillStyle = this._bgGrad;
    r._fill = '';
    c.fillRect(0, 0, r.w, r.h);
  },
};
