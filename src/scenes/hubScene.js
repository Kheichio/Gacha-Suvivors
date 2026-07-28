// THE HOME SCREEN.
//
// WHAT THIS IS NOW, AND WHY IT IS NOT WHAT IT WAS
// -----------------------------------------------
// The previous version was a diorama: a drawn studio set with a walking cast of
// your owned characters in the middle of the screen and a "NOW STARRING" panel
// down the right. Both are gone. The cast occupied the largest, most valuable
// region of the home screen and did nothing you could act on; the starring panel
// restated information the ROSTER card already carries. A home screen's whole
// job is to get you somewhere, and every pixel that is not helping you choose is
// working against it.
//
// So: a header, a PLAY hero, a grid of destinations, a footer. Nothing else.
// Every destination is on screen at once at every supported size — the previous
// layout stacked eight rows into a fixed column and pushed SETTINGS off the
// bottom edge the moment a ninth node was added, which is a failure mode a grid
// simply does not have.
//
// The look comes from composition and light rather than props: a deep gradient,
// one large accent bloom, a fine grid, drifting motes, and cards that lift and
// bracket when they take focus.
//
// INPUT LIVES IN render(), NOT update(). The immediate-mode toolkit resolves a
// button on the frame it draws it, and sceneManager.update() can run up to five
// fixed steps per frame — reading input.pressed() there would fire a navigation
// five times.
//
// The hub is the root screen, so "back" cannot mean "the previous screen".
// ESC / gamepad B opens SETTINGS, and the SETTINGS card says so.

import { ui, PALETTE, wrapText, ellipsize, fitSize, formatCount } from '../ui/widgets.js';
import { save } from '../core/save.js';
import { audio } from '../core/audio.js';
import { clamp } from '../core/math.js';
import { completedCount, unclaimedCount } from '../game/quests.js';

/**
 * THE HERO is separate from the grid, because "start a run" is not a peer of
 * "read the codex". A menu that presents its primary action as one tile among
 * eight is a menu that has not decided what it is for.
 */
const HERO = {
  scene: 'stageSelect', label: 'STAGE SELECT', icon: '▶', color: PALETTE.accent,
  tip: 'Seven stages, four difficulty tiers. Best times and rewards are on the card.',
};

const NODES = [
  { scene: 'roster', label: 'ROSTER', icon: '🎴', color: PALETTE.pink,
    tip: 'Equip a character, raise star levels with Fan Letters, read their bond.' },
  { scene: 'gacha', label: 'GACHA', icon: '🎰', color: PALETTE.gem,
    tip: 'Banners, pity counters, and the last 100 pulls.' },
  { scene: 'quests', label: 'QUESTS', icon: '📋', color: '#7bf59a',
    tip: 'The reward ladder. Every one pays out the moment you finish it — there is nothing to claim.' },
  { scene: 'shrine', label: 'SHRINE', icon: '⛩', color: '#ff9a3c',
    tip: 'Permanent upgrades bought with gold. The refund is free and always will be — experiment.' },
  { scene: 'achievements', label: 'ACHIEVEMENTS', icon: '🏆', color: PALETTE.gold,
    tip: '40 of them. Some pay Star Fragments, some unlock things no amount of gold can buy.' },
  { scene: 'codex', label: 'CODEX', icon: '📖', color: PALETTE.accent2,
    tip: 'Every enemy, boss, relic and character you have met, with the flavour text they deserve.' },
];

const SETTINGS_NODE = {
  scene: 'settings', label: 'SETTINGS', icon: '⚙', color: PALETTE.textDim,
  tip: 'Volume, screen shake, damage numbers, UI scale. ESC or gamepad B lands here from anywhere.',
};

const CURRENCIES = [
  { key: 'gold', icon: '⭐', color: PALETTE.gold },
  { key: 'starFragments', icon: '💎', color: PALETTE.gem },
  { key: 'tickets', icon: '🎟', color: PALETTE.accent2 },
  { key: 'universalLetters', icon: '💌', color: PALETTE.pink },
];

const MOTE_COUNT = 26;

function formatPlaytime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = (s / 3600) | 0;
  const m = ((s % 3600) / 60) | 0;
  if (h > 0) return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
  return m + 'm ' + ((s % 60) < 10 ? '0' : '') + (s % 60) + 's';
}

export const hubScene = {
  manager: null,
  L: null,
  t: 0,

  // --- lifecycle -------------------------------------------------------------
  enter(params, mgr) {
    this.manager = mgr || this.manager;
    this.t = 0;
    this.L = null;
    this._bgKey = '';
    this._nav = false;
    this._counts = { owned: 0, cleared: 0, shrine: 0, ach: 0, codex: 0, pity: 0,
                     questsDone: 0, questsReady: 0 };
    // A pull on the gacha screen can complete a quest, and the player walks
    // straight back here afterwards — so this is where it has to pay out.
    if (this.manager && this.manager.settleQuests) this.manager.settleQuests();
    this._buildMotes();
    this._buildTotals();
  },

  exit() { this._nav = false; },

  resize() { this.L = null; },

  clearColor() { return '#080611'; },

  /** Timers only. Everything that reads input happens once per frame, in render. */
  update(dt) {
    this.t += dt;
    // The hub counts its own wall time toward the save's playtime. Every other
    // scene is expected to do the same for the stretch it owns; nothing else
    // can know how long the player sat here.
    save.data.playtime += dt;
    save.touch();
  },

  /**
   * Drifting motes. The only decorative element left, and it is deliberately
   * the cheapest one there is: 26 circles on sine paths, no sprites, no pool,
   * nothing to update. Positions are normalised so a resize never strands them.
   */
  _buildMotes() {
    const m = [];
    for (let i = 0; i < MOTE_COUNT; i++) {
      m.push({
        x: Math.random(), y: Math.random(),
        r: 0.8 + Math.random() * 2.2,
        spd: 0.006 + Math.random() * 0.020,
        amp: 0.010 + Math.random() * 0.030,
        ph: Math.random() * Math.PI * 2,
        a: 0.06 + Math.random() * 0.16,
      });
    }
    this.motes = m;
  },

  /** Constant denominators for the card subtitles. Built once, never in render. */
  _buildTotals() {
    const d = this.manager && this.manager.data;
    this.totals = { stages: 7, chars: 19, shrine: 0, achievements: 0, codex: 1, quests: 1 };
    if (!d) return;
    this.totals.stages = d.stages.STAGES.length;
    this.totals.chars = d.characters.CHARACTERS.length;
    let sh = 0;
    for (const u of d.shrine.SHRINE_UPGRADES) sh += u.maxLevel;
    this.totals.shrine = sh;
    this.totals.achievements = d.achievements.ACHIEVEMENTS.length;
    this.totals.codex = d.enemies.ENEMIES.length + d.bosses.BOSSES.length +
      d.relics.RELICS.length + d.characters.CHARACTERS.length;
    this.totals.quests = (d.quests && d.quests.QUESTS) ? d.quests.QUESTS.length : 1;
  },

  /**
   * One pass over the save blob per frame. `_sub()` and `_frac()` both want the
   * same counts, and counting inside each of them meant sixteen scans of the
   * roster, the stage table and the codex every single frame.
   */
  _refreshCounts() {
    let owned = 0;
    for (const k in save.data.roster) if (save.data.roster[k].owned) owned++;
    let cleared = 0;
    for (const k in save.data.stages) if (save.data.stages[k].cleared) cleared++;
    let shrine = 0;
    for (const k in save.data.shrine) shrine += save.data.shrine[k] | 0;
    let ach = 0;
    for (const k in save.data.achievements) ach++;
    let codex = 0;
    const cx = save.data.codex;
    for (const cat of ['enemies', 'bosses', 'relics', 'characters']) {
      const m = cx[cat];
      if (m) for (const k in m) if (m[k]) codex++;
    }
    this._counts = {
      owned, cleared, shrine, ach, codex,
      pity: save.data.gacha.sharedPity5 | 0,
      questsDone: completedCount(), questsReady: unclaimedCount(),
    };
  },

  _sub(node) {
    const d = this.manager && this.manager.data;
    const c = this._counts, t = this.totals;
    if (!d) return '';
    switch (node.scene) {
      case 'stageSelect': return c.cleared + ' of ' + t.stages + ' stages cleared';
      case 'roster': return c.owned + '/' + t.chars + ' owned';
      case 'gacha': {
        const left = Math.max(0, d.gacha.PITY.hard5 - c.pity);
        return left + ' to guaranteed ★5';
      }
      case 'quests': return c.questsDone + '/' + t.quests + ' complete';
      case 'shrine': return c.shrine + '/' + t.shrine + ' levels';
      case 'achievements': return c.ach + '/' + t.achievements + ' unlocked';
      case 'codex': return c.codex + '/' + t.codex + ' entries';
      case 'settings': return 'ESC or gamepad B lands here from anywhere';
    }
    return '';
  },

  /** -1 when a progress bar would be meaningless on this card. */
  _frac(node) {
    const d = this.manager && this.manager.data;
    const c = this._counts, t = this.totals;
    if (!d) return -1;
    switch (node.scene) {
      case 'stageSelect': return t.stages ? c.cleared / t.stages : -1;
      case 'roster': return t.chars ? c.owned / t.chars : -1;
      // Pity IS a fraction: it is progress toward a guarantee, and watching it
      // fill is most of the reason to look at this card at all.
      case 'gacha': return d.gacha.PITY.hard5 ? clamp(c.pity / d.gacha.PITY.hard5, 0, 1) : -1;
      case 'quests': return t.quests ? c.questsDone / t.quests : -1;
      case 'shrine': return t.shrine ? c.shrine / t.shrine : -1;
      case 'achievements': return t.achievements ? c.ach / t.achievements : -1;
      case 'codex': return t.codex ? c.codex / t.codex : -1;
    }
    return -1;
  },

  /** A badge in the corner of a card — unclaimed quests today, nothing else. */
  _badge(node) {
    if (node.scene === 'quests' && this._counts.questsReady > 0) {
      return String(this._counts.questsReady);
    }
    return null;
  },

  _go(scene) {
    if (this._nav) return;
    this._nav = true;
    this.manager.go(scene);
  },

  // --- layout ----------------------------------------------------------------
  /**
   * EVERY DESTINATION IS ON SCREEN AT EVERY SIZE. That is the requirement the
   * old column layout failed: it stacked one row per node into a fixed-height
   * column, so adding a ninth node silently pushed SETTINGS off the bottom.
   * A grid absorbs a new node by shrinking its cells instead.
   */
  _ensureLayout(r) {
    const S = ui.scale || 1;
    const key = r.w + 'x' + r.h + 'x' + S;
    if (this.L && this.L.key === key) return this.L;

    const W = r.w, H = r.h;
    const pad = Math.round(clamp(W * 0.025, 14, 34));
    const gap = Math.round(clamp(W * 0.011, 8, 18));

    // Header: title left, currency pills right. When they cannot share a row at
    // this UI scale the pills drop to their own, and the header grows.
    const titleSize = Math.round(clamp(W * 0.028, 22, 40) * S);
    const pillH = Math.round(28 * S);
    const pillsW = 4 * Math.round(108 * S) + 3 * 8;
    const titleW = Math.round(titleSize * 9.2);
    const twoRow = titleW + pillsW + pad * 3 > W;
    const headerH = Math.round((twoRow ? titleSize + 16 + pillH + 10 : titleSize + 26) + 10);

    const footerH = Math.round(clamp(26 * S, 22, 40));
    const bodyY = headerH + Math.round(pad * 0.5);
    const bodyH = Math.max(160, H - bodyY - footerH - pad);

    const narrow = W < 1020;
    let heroX, heroY, heroW, heroH, gridX, gridY, gridW, gridH;
    if (narrow) {
      heroX = pad; heroY = bodyY; heroW = W - pad * 2;
      heroH = Math.round(clamp(bodyH * 0.26, 96, 190));
      gridX = pad; gridY = heroY + heroH + gap;
      gridW = heroW; gridH = bodyH - heroH - gap;
    } else {
      heroX = pad; heroY = bodyY;
      heroW = Math.round(clamp(W * 0.30, 250, 430));
      heroH = bodyH;
      gridX = heroX + heroW + gap; gridY = bodyY;
      gridW = W - pad - gridX; gridH = bodyH;
    }

    const cols = gridW > 760 ? 3 : 2;
    const rows = Math.ceil(NODES.length / cols);
    const settingsH = Math.round(clamp(50 * S, 42, 74));
    const cardsH = gridH - settingsH - gap;
    const cardW = (gridW - gap * (cols - 1)) / cols;
    const cardH = (cardsH - gap * (rows - 1)) / rows;

    const L = {
      key, W, H, S, pad, gap, narrow,
      headerH, titleSize, pillH, twoRow, footerH,
      heroX, heroY, heroW, heroH,
      gridX, gridY, gridW, gridH,
      cols, rows, cardW, cardH,
      settingsY: gridY + cardsH + gap, settingsH,
      tipY: H - footerH - Math.round(16 * S),
    };
    this.L = L;
    return L;
  },

  // --- render ----------------------------------------------------------------
  render(r) {
    const L = this._ensureLayout(r);
    ui.begin(r, 'hub');
    ui.focusGrid(L.cols);
    this._refreshCounts();

    this._backdrop(r, L);

    // The hero takes focus index 0, so the screen opens pointing at the button
    // that starts a run.
    this._heroCard(r, L);
    for (let i = 0; i < NODES.length; i++) {
      const col = i % L.cols, row = (i / L.cols) | 0;
      this._card(r, L, NODES[i],
                 L.gridX + col * (L.cardW + L.gap),
                 L.gridY + row * (L.cardH + L.gap),
                 L.cardW, L.cardH);
    }
    this._settingsBar(r, L);

    this._header(r, L);
    this._footer(r, L);
    this._tip(r, L);

    // The root screen's escape hatch: never a dead end, always somewhere useful.
    if (ui.backPressed() && !this._nav) { audio.play('uiBack'); this._go('settings'); }

    ui.end();
  },

  /**
   * The look. A vertical gradient, one large accent bloom, a fine grid and a
   * drift of motes — cached where it can be, arithmetic where it cannot.
   */
  _backdrop(r, L) {
    const c = r.ctx;
    const key = r.w + 'x' + r.h;
    if (this._bgKey !== key) {
      const g = c.createLinearGradient(0, 0, r.w * 0.35, r.h);
      g.addColorStop(0.00, '#2a1b3f');
      g.addColorStop(0.42, '#171029');
      g.addColorStop(1.00, '#080611');
      this._bgGrad = g;
      const b = c.createRadialGradient(r.w * 0.16, r.h * 0.10, 0,
                                       r.w * 0.16, r.h * 0.10, r.h * 0.9);
      b.addColorStop(0.00, 'rgba(255,95,162,0.20)');
      b.addColorStop(0.45, 'rgba(120,60,200,0.07)');
      b.addColorStop(1.00, 'rgba(0,0,0,0)');
      this._bloom = b;
      this._bgKey = key;
    }
    r.setAlpha(1);
    c.fillStyle = this._bgGrad; r._fill = '';
    c.fillRect(0, 0, r.w, r.h);
    c.fillStyle = this._bloom; r._fill = '';
    c.fillRect(0, 0, r.w, r.h);

    // A fine grid, barely there. It reads as a surface rather than as a void.
    const step = Math.round(clamp(r.w / 26, 34, 76));
    for (let x = step; x < r.w; x += step) r.drawRect(x, 0, 1, r.h, '#ffffff', 0.018);
    for (let y = step; y < r.h; y += step) r.drawRect(0, y, r.w, 1, '#ffffff', 0.014);

    // One long diagonal light streak across the upper body.
    r.drawLine(-40, L.headerH + 40, r.w * 0.62, -30, 'rgba(255,215,106,0.05)', 60, 1);

    for (const m of this.motes) {
      const x = m.x * r.w + Math.sin(this.t * m.spd * 6 + m.ph) * m.amp * r.w;
      const y = ((m.y + this.t * m.spd) % 1.15 - 0.075) * r.h;
      r.drawCircle(x, y, m.r, '#ffe9c4', m.a);
    }

    r.vignette('rgba(6,4,12,0.9)', 0.42);
  },

  // --- header / footer -------------------------------------------------------
  _header(r, L) {
    const c = save.data.currencies;
    ui.title('GACHA SURVIVORS', L.pad, Math.round(L.titleSize * 0.62) + 12, {
      size: L.titleSize / (ui.scale || 1), align: 'left',
    });
    if (!L.twoRow) {
      ui.text('everyone here is technically at work', L.pad + 2,
              Math.round(L.titleSize * 0.62) + 12 + Math.round(L.titleSize * 0.62), {
        size: 12, color: PALETTE.textFaint,
      });
    }

    // Right-aligned in one pass: measure every pill first, then place.
    const widths = [];
    let total = 0;
    for (const cur of CURRENCIES) {
      const w = r.measureText(formatCount(c[cur.key] || 0), 15 * (ui.scale || 1), 700) + 42;
      widths.push(w);
      total += w + 8;
    }
    let x = L.twoRow ? L.pad : L.W - L.pad - (total - 8);
    const y = L.twoRow ? Math.round(L.titleSize * 0.62) + 26 : Math.round(L.titleSize * 0.18) + 6;
    for (let i = 0; i < CURRENCIES.length; i++) {
      ui.currency(x, y, CURRENCIES[i].icon, c[CURRENCIES[i].key] || 0, CURRENCIES[i].color);
      x += widths[i] + 8;
    }

    r.drawRect(L.pad, L.headerH - 6, L.W - L.pad * 2, 1, 'rgba(255,255,255,0.10)', 1);
  },

  _footer(r, L) {
    const s = save.data.stats;
    const y = L.H - L.footerH / 2 - 2;
    r.drawRect(L.pad, L.H - L.footerH - 8, L.W - L.pad * 2, 1, 'rgba(255,255,255,0.07)', 1);
    const line = 'PLAYTIME ' + formatPlaytime(save.data.playtime) +
      '   ·   RUNS ' + (s.runs | 0) + ' (' + (s.wins | 0) + ' cleared)' +
      '   ·   KILLS ' + formatCount(s.kills || 0) +
      '   ·   PULLS ' + (save.data.gacha.totalPulls | 0);
    ui.text(ellipsize(r, line, L.W - L.pad * 2, 12, 600), L.pad, y,
            { size: 12, color: PALETTE.textFaint });
  },

  /**
   * The focused card's tip, on its own reserved line above the footer.
   *
   * Read AFTER every card has been declared, so `ui.focus` is this frame's
   * value rather than last frame's — the previous layout printed it in the
   * header, which is drawn first, and was therefore always one frame stale.
   */
  _tip(r, L) {
    const all = [HERO].concat(NODES, [SETTINGS_NODE]);
    const n = all[clamp(ui.focus, 0, all.length - 1)];
    if (!n) return;
    ui.text(ellipsize(r, n.tip, L.W - L.pad * 2, 12, 600), L.pad, L.tipY, {
      size: 12, color: PALETTE.textDim,
    });
  },

  // --- cards -----------------------------------------------------------------
  /** The shared plate: glass body, coloured top edge, focus lift and brackets. */
  _plate(r, x, y, w, h, color, focused, tint) {
    const lift = focused ? -2 : 0;
    r.drawRoundRect(x, y + lift, w, h, 12, 'rgba(16,12,28,0.82)', 1);
    if (tint) r.drawRoundRect(x, y + lift, w, h, 12, color, focused ? 0.13 : 0.07);
    // A top edge in the destination's colour, and a soft inner highlight.
    r.drawRect(x + 12, y + lift, w - 24, 3, color, focused ? 1 : 0.75);
    r.drawRect(x + 12, y + lift + 3, w - 24, 1, '#ffffff', 0.10);
    r.strokeRect(x, y + lift, w, h, focused ? PALETTE.borderHot : 'rgba(150,170,225,0.20)',
                 focused ? 2.5 : 1.5, 1);
    if (focused) ui.brackets(x, y + lift, w, h, PALETTE.borderHot, Math.min(22, w * 0.16), 3);
    return lift;
  },

  _iconPlate(r, x, y, size, icon, color, focused) {
    r.drawRoundRect(x, y, size, size, 10, color, focused ? 0.22 : 0.13);
    r.strokeRect(x, y, size, size, color, 1.5, focused ? 0.9 : 0.45);
    ui.text(icon, x + size / 2, y + size / 2, {
      size: size * 0.52, align: 'center', baseline: 'middle',
    });
  },

  _bar(r, x, y, w, frac, color) {
    r.drawRoundRect(x, y, w, 5, 2.5, 'rgba(4,6,14,0.75)', 1);
    if (frac > 0.001) r.drawRoundRect(x, y, w * clamp(frac, 0, 1), 5, 2.5, color, 1);
  },

  /**
   * PLAY. Deliberately the largest object on the screen: it is what the home
   * screen is FOR, and presenting it as one tile among eight was the previous
   * layout's other mistake.
   */
  _heroCard(r, L) {
    const n = HERO;
    const x = L.heroX, y = L.heroY, w = L.heroW, h = L.heroH;
    const idx = ui.itemCount;
    const focused = ui.focus === idx;
    const hit = ui.button(n.scene, x, y, w, h, null, { invisible: true });

    const lift = this._plate(r, x, y, w, h, n.color, focused, true);
    const yy = y + lift;
    const pulse = 0.55 + 0.45 * Math.sin(this.t * 2.4);

    // A soft bloom behind the play glyph so the eye lands here first.
    const cx = x + w / 2;
    const plate = Math.round(clamp(Math.min(w, h) * 0.30, 54, 118));
    const py = L.narrow ? yy + (h - plate) / 2 : yy + h * 0.20;
    const px = L.narrow ? x + Math.round(24 * L.S) : cx - plate / 2;
    r.drawCircle(px + plate / 2, py + plate / 2, plate * 0.86, n.color, 0.06 + pulse * 0.05);
    this._iconPlate(r, px, py, plate, n.icon, n.color, focused);

    const textX = L.narrow ? px + plate + Math.round(20 * L.S) : cx;
    const align = L.narrow ? 'left' : 'center';
    const tw = L.narrow ? (x + w - textX - 20) : (w - 28);

    const playSize = fitSize(r, 'PLAY', tw, Math.round(clamp(h * 0.11, 22, 40)), 800);
    ui.text('PLAY', textX, L.narrow ? py + plate * 0.38 : yy + h * 0.20 + plate + Math.round(34 * L.S), {
      size: playSize, color: focused ? PALETTE.accent : PALETTE.text,
      align, weight: 800, baseline: 'middle',
    });
    ui.text(n.label, textX, L.narrow ? py + plate * 0.72 : yy + h * 0.20 + plate + Math.round(58 * L.S), {
      size: 12, color: PALETTE.textFaint, align, weight: 800, mono: true, baseline: 'middle',
    });

    const sub = this._sub(n);
    const frac = this._frac(n);
    const barW = Math.min(tw, Math.round(clamp(w * 0.62, 120, 300)));
    const barX = L.narrow ? textX : cx - barW / 2;
    const barY = yy + h - Math.round(46 * L.S);
    ui.text(ellipsize(r, sub, tw, 12, 700), L.narrow ? textX : cx, barY - Math.round(12 * L.S), {
      size: 12, color: PALETTE.textDim, align, weight: 700,
    });
    if (frac >= 0) this._bar(r, barX, barY, barW, frac, n.color);

    if (hit) this._go(n.scene);
  },

  _card(r, L, n, x, y, w, h) {
    const idx = ui.itemCount;
    const focused = ui.focus === idx;
    const hit = ui.button(n.scene, x, y, w, h, null, { invisible: true });

    const lift = this._plate(r, x, y, w, h, n.color, focused, false);
    const yy = y + lift;
    const pad = Math.round(clamp(w * 0.09, 12, 24));

    const plate = Math.round(clamp(Math.min(w * 0.30, h * 0.34), 34, 66));
    this._iconPlate(r, x + pad, yy + pad, plate, n.icon, n.color, focused);

    const badge = this._badge(n);
    if (badge) {
      const bx = x + w - pad - 13, by = yy + pad + 12;
      const bp = 0.6 + 0.4 * Math.sin(this.t * 4);
      r.drawCircle(bx, by, 13, '#7bf59a', 0.85 + bp * 0.15);
      ui.text(badge, bx, by + 1, {
        size: 13, color: '#06210f', align: 'center', baseline: 'middle', weight: 800,
      });
    }

    const ty = yy + pad + plate + Math.round(clamp(h * 0.10, 14, 30));
    const tw = w - pad * 2;
    ui.text(ellipsize(r, n.label, tw, 17, 800), x + pad, ty, {
      size: fitSize(r, n.label, tw, 17, 800),
      color: focused ? PALETTE.text : PALETTE.textDim, weight: 800,
    });
    ui.text(ellipsize(r, this._sub(n), tw, 12, 600), x + pad, ty + Math.round(19 * L.S), {
      size: 12, color: PALETTE.textFaint,
    });

    const frac = this._frac(n);
    if (frac >= 0) this._bar(r, x + pad, yy + h - Math.round(18 * L.S), tw, frac, n.color);

    if (focused) {
      ui.text('›', x + w - pad, yy + h - Math.round(18 * L.S) - Math.round(14 * L.S), {
        size: 17, color: n.color, align: 'right', weight: 800,
      });
    }

    if (hit) this._go(n.scene);
  },

  /** SETTINGS gets a full-width bar rather than a tile: it is not a destination
   *  you browse, it is one you go to on purpose. */
  _settingsBar(r, L) {
    const n = SETTINGS_NODE;
    const x = L.gridX, y = L.settingsY, w = L.gridW, h = L.settingsH;
    const idx = ui.itemCount;
    const focused = ui.focus === idx;
    const hit = ui.button(n.scene, x, y, w, h, null, { invisible: true });

    const lift = focused ? -2 : 0;
    r.drawRoundRect(x, y + lift, w, h, 10, 'rgba(16,12,28,0.72)', 1);
    r.strokeRect(x, y + lift, w, h, focused ? PALETTE.borderHot : 'rgba(150,170,225,0.16)',
                 focused ? 2.5 : 1.5, 1);
    r.drawRect(x, y + lift + 8, 3, h - 16, n.color, focused ? 1 : 0.6);

    ui.text(n.icon, x + Math.round(28 * L.S), y + lift + h / 2, {
      size: Math.round(clamp(h * 0.42, 16, 26)), align: 'center', baseline: 'middle',
    });
    ui.text(n.label, x + Math.round(52 * L.S), y + lift + h / 2, {
      size: 15, color: focused ? PALETTE.text : PALETTE.textDim,
      weight: 800, baseline: 'middle',
    });
    ui.text('ESC', x + w - 16, y + lift + h / 2, {
      size: 11, color: PALETTE.textFaint, align: 'right', baseline: 'middle',
      weight: 800, mono: true,
    });

    if (hit) this._go(n.scene);
  },
};
