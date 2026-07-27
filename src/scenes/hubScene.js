// "THE STUDIO" — the hub. SECTION 12.
//
// A cozy VTuber studio drawn entirely from primitives: desks, monitors, a ring
// light, a shrine in the corner, and a gacha machine that rattles on a timer.
// Your owned characters mill about on the floor as idle sprites and bark when
// you click them. That is the whole personality budget of this screen and it
// costs one array of {x, vx, sprite}.
//
// INPUT LIVES IN render(), NOT update(). The immediate-mode toolkit resolves a
// button on the frame it draws it, and sceneManager.update() can run up to five
// fixed steps per frame — reading input.pressed() there would fire a navigation
// five times. update() here only advances timers.
//
// The hub is the root screen, so "back" cannot mean "the previous screen".
// ESC / gamepad B opens SETTINGS (which backs out to here), and the SETTINGS
// node is labelled with that so the affordance is visible, never a dead end.

import { ui, PALETTE, RARITY_COLOR, RARITY_NAME, wrapText, formatCount } from '../ui/widgets.js';
import { input } from '../core/input.js';
import { save, rosterEntry } from '../core/save.js';
import { audio } from '../core/audio.js';
import { displayName } from '../core/config.js';
import { atlas } from '../render/spriteAtlas.js';
import { clamp } from '../core/math.js';

const NODES = [
  { scene: 'stageSelect', label: 'STAGE SELECT', icon: '🎬',
    tip: 'Seven stages, four difficulty tiers. Best times and rewards are on the card.' },
  { scene: 'roster', label: 'ROSTER', icon: '🎴',
    tip: 'Equip a character, raise star levels with Fan Letters, read their bond.' },
  { scene: 'gacha', label: 'GACHA MACHINE', icon: '🎰',
    tip: 'Banners, pity counters, and the last 100 pulls. It rattles by itself. Ignore that.' },
  { scene: 'shrine', label: 'THE SHRINE', icon: '⛩',
    tip: 'Permanent upgrades bought with gold. The refund is free and always will be — experiment.' },
  { scene: 'achievements', label: 'ACHIEVEMENTS', icon: '🏆',
    tip: '40 of them. Some pay Star Fragments, some unlock things no amount of gold can buy.' },
  { scene: 'codex', label: 'CODEX', icon: '📖',
    tip: 'Every enemy, boss, relic and character you have met, with the flavour text they deserve.' },
  { scene: 'settings', label: 'SETTINGS', icon: '⚙',
    tip: 'Volume, screen shake, damage numbers, UI scale. ESC or gamepad B lands here from anywhere.' },
];

/** Capsule positions inside the gacha dome. Fixed, so the machine never re-rolls. */
const CAPSULES = [
  { dx: -0.42, dy: 0.30, c: '#ff5fa2' }, { dx: -0.02, dy: 0.44, c: '#ffd76a' },
  { dx: 0.40, dy: 0.28, c: '#6ad8ff' }, { dx: -0.28, dy: -0.10, c: '#c58cff' },
  { dx: 0.18, dy: -0.04, c: '#7bf59a' }, { dx: 0.50, dy: -0.20, c: '#ff9ec4' },
  { dx: -0.55, dy: -0.24, c: '#6ad8ff' }, { dx: 0.02, dy: -0.40, c: '#ffd76a' },
];

const LANE_Y = [-38, -19, 0];
const LANE_SCALE = [0.80, 0.98, 1.16];

function formatPlaytime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = (s / 3600) | 0;
  const m = ((s % 3600) / 60) | 0;
  if (h > 0) return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
  return m + 'm ' + ((s % 60) < 10 ? '0' : '') + (s % 60) + 's';
}

export const hubScene = {
  manager: null,
  actors: null,
  L: null,
  t: 0,

  // --- lifecycle -------------------------------------------------------------
  enter(params, mgr) {
    this.manager = mgr || this.manager;
    this.mgr = this.manager;
    this.t = 0;
    this.L = null;
    this._bgKey = '';
    this._nav = false;
    this._hover = -1;
    this._rattleCooldown = 2.2;
    this._rattle = 0;
    this._buildActors();
    this._buildTotals();
  },

  exit() { this.actors = null; },

  resize() { this.L = null; },

  clearColor() { return '#0a0713'; },

  /** Timers only. Everything that reads input happens once per frame, in render. */
  update(dt) {
    this.t += dt;

    // The hub counts its own wall time toward the save's playtime. Every other
    // scene is expected to do the same for the stretch it owns; nothing else can
    // know how long the player sat here.
    save.data.playtime += dt;
    save.touch();

    this._rattleCooldown -= dt;
    if (this._rattleCooldown <= 0) { this._rattleCooldown = 3.4 + Math.random() * 3.2; this._rattle = 0.75; }
    if (this._rattle > 0) this._rattle -= dt;

    const L = this.L;
    if (!L || !this.actors) return;
    for (const a of this.actors) {
      a.t += dt;
      if (a.bubbleT > 0) a.bubbleT -= dt;
      if (a.hop > 0) a.hop -= dt;
      if (a.pauseT > 0) { a.pauseT -= dt; continue; }
      a.x += a.vx * dt;
      if (a.x < L.walkMinX) { a.x = L.walkMinX; a.vx = Math.abs(a.vx); }
      if (a.x > L.walkMaxX) { a.x = L.walkMaxX; a.vx = -Math.abs(a.vx); }
      a.idleT -= dt;
      if (a.idleT <= 0) {
        a.idleT = 4 + Math.random() * 7;
        a.pauseT = 0.7 + Math.random() * 1.8;
        if (Math.random() < 0.5) a.vx = -a.vx;
      }
    }
  },

  // --- view state ------------------------------------------------------------
  _buildActors() {
    const d = this.manager && this.manager.data;
    this.actors = [];
    if (!d) return;
    const owned = [];
    for (const c of d.characters.CHARACTERS) {
      const e = save.data.roster[c.id];
      if (e && e.owned) owned.push(c);
    }
    for (let i = 0; i < owned.length; i++) {
      const c = owned[i];
      const lane = i % LANE_Y.length;
      this.actors.push({
        char: c,
        sprite: atlas.ensure(c.visual),
        lane,
        laneY: LANE_Y[lane],
        laneScale: LANE_SCALE[lane],
        x: 0, sx: 0, sy: 0, sr: 20, dh: 40,
        vx: (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 16),
        t: Math.random() * 10,
        idleT: 2 + Math.random() * 8,
        pauseT: 0,
        hop: 0,
        bubbleT: 0,
        bubbleLines: null,
        bubbleW: 0,
        _spread: owned.length > 1 ? i / (owned.length - 1) : 0.5,
      });
    }
    // Back lanes first so the front row overlaps them, which is the whole trick.
    this.actors.sort((a, b) => a.lane - b.lane);
  },

  /** Constant denominators for the node subtitles. Built once, never in render. */
  _buildTotals() {
    const d = this.manager && this.manager.data;
    this.totals = { stages: 7, chars: 19, shrine: 0, achievements: 0, codex: 1 };
    if (!d) return;
    this.totals.stages = d.stages.STAGES.length;
    this.totals.chars = d.characters.CHARACTERS.length;
    let sh = 0;
    for (const u of d.shrine.SHRINE_UPGRADES) sh += u.maxLevel;
    this.totals.shrine = sh;
    this.totals.achievements = d.achievements.ACHIEVEMENTS.length;
    this.totals.codex = d.enemies.ENEMIES.length + d.bosses.BOSSES.length +
      d.relics.RELICS.length + d.characters.CHARACTERS.length;
  },

  _countOwned() {
    let n = 0;
    for (const k in save.data.roster) if (save.data.roster[k].owned) n++;
    return n;
  },

  _countCleared() {
    let n = 0;
    for (const k in save.data.stages) if (save.data.stages[k].cleared) n++;
    return n;
  },

  _countCodex() {
    const c = save.data.codex;
    let n = 0;
    for (const cat of ['enemies', 'bosses', 'relics', 'characters']) {
      const m = c[cat];
      if (m) for (const k in m) if (m[k]) n++;
    }
    return n;
  },

  _sub(node) {
    const d = this.manager.data;
    const cur = save.data.currencies;
    switch (node.scene) {
      case 'stageSelect': return this._countCleared() + '/' + this.totals.stages + ' stages cleared';
      case 'roster': return this._countOwned() + '/' + this.totals.chars + ' characters owned';
      case 'gacha': {
        const pity = save.data.gacha.sharedPity5 | 0;
        const left = Math.max(0, d.gacha.PITY.hard5 - pity);
        return pity + ' pulls since ★5 · guaranteed in ' + left;
      }
      case 'shrine': {
        let lv = 0;
        for (const k in save.data.shrine) lv += save.data.shrine[k] | 0;
        return lv + '/' + this.totals.shrine + ' levels · ' + formatCount(cur.gold) + ' gold banked';
      }
      case 'achievements': {
        let n = 0;
        for (const k in save.data.achievements) n++;
        return n + '/' + this.totals.achievements + ' unlocked';
      }
      case 'codex': return this._countCodex() + '/' + this.totals.codex + ' entries seen';
      case 'settings': return 'ESC / gamepad B';
    }
    return '';
  },

  _go(scene) {
    if (this._nav) return;
    this._nav = true;
    this.manager.go(scene);
  },

  // --- layout ----------------------------------------------------------------
  _ensureLayout(r) {
    const key = r.w + 'x' + r.h;
    if (this.L && this.L.key === key) return this.L;

    const W = r.w, H = r.h;
    const pad = Math.round(clamp(W * 0.02, 14, 30));
    const narrow = W < 1020;
    const headerH = narrow ? 108 : 80;
    const footerH = 32;

    const colW = Math.round(clamp(W * 0.26, 208, 330));
    const nodeTop = headerH + 6;
    const nodeBottom = H - footerH - 8;
    const gap = 7;
    const rowH = clamp(Math.floor((nodeBottom - nodeTop - gap * 6) / 7), 32, 62);

    const panelW = Math.round(clamp(W * 0.30, 236, 400));
    const panelH = Math.round(clamp(H * 0.20, 106, 132));
    const panelX = W - pad - panelW;
    const panelY = Math.max(nodeTop + 40, H - footerH - 8 - panelH);

    const studioX = pad + colW + pad;
    const studioY = headerH + 6;
    const studioW = Math.max(60, W - studioX - pad);
    const floorY = clamp(panelY - 26, studioY + 96, H - footerH - 10);

    const L = {
      key, W, H, pad, narrow, headerH, footerH,
      colX: pad, colY: nodeTop, colW, rowH, gap,
      panelX, panelY, panelW, panelH,
      studioX, studioY, studioW, floorY,
      walkMinX: studioX + 34,
      walkMaxX: Math.max(studioX + 44, W - pad - 34),
      actorScale: clamp((floorY - studioY) / 190, 0.85, 2.0),
    };
    this.L = L;
    if (this.actors) {
      for (const a of this.actors) {
        a.x = L.walkMinX + (L.walkMaxX - L.walkMinX) * a._spread;
      }
    }
    return L;
  },

  // --- render ----------------------------------------------------------------
  render(r) {
    const L = this._ensureLayout(r);
    ui.begin(r, 'hub');
    ui.focusGrid(1);

    this._paintBackdrop(r);
    this._drawStudio(r, L);
    this._drawActors(r, L);
    r.vignette('rgba(8,4,14,0.85)', 0.55);

    this._drawHeader(r, L);
    this._drawNodes(r, L);
    this._drawStarring(r, L);
    this._drawFooter(r, L);

    // The root screen's escape hatch: never a dead end, always somewhere useful.
    if (ui.backPressed() && !this._nav) { audio.play('uiBack'); this._go('settings'); }

    ui.end();
  },

  _paintBackdrop(r) {
    const c = r.ctx;
    const key = r.w + 'x' + r.h;
    if (this._bgKey !== key) {
      const g = c.createLinearGradient(0, 0, 0, r.h);
      g.addColorStop(0.00, '#3d1f3c');
      g.addColorStop(0.34, '#291733');
      g.addColorStop(0.70, '#160f23');
      g.addColorStop(1.00, '#0a0713');
      this._bgGrad = g;
      this._bgKey = key;
    }
    r.setAlpha(1);
    c.fillStyle = this._bgGrad;
    r._fill = '';
    c.fillRect(0, 0, r.w, r.h);
  },

  // --- the set ---------------------------------------------------------------
  _drawStudio(r, L) {
    const x0 = L.studioX, y0 = L.studioY, fy = L.floorY;
    const w = L.studioW;
    if (w < 200 || fy - y0 < 120) return;      // no room for the set; skip it
    const t = this.t;
    const u = clamp(w / 900, 0.55, 1.3);
    const cx = x0 + w * 0.5;

    // Back wall + seams.
    r.drawRect(x0, y0, w, fy - y0, '#2c1730', 0.45);
    for (let i = 1; i < 4; i++) {
      const yy = y0 + (fy - y0) * (i / 4);
      r.drawLine(x0, yy, x0 + w, yy, '#432349', 1, 0.35);
    }
    // Floor + perspective boards.
    r.drawRect(x0, fy, w, r.h - fy, '#1d1223', 0.85);
    r.drawRect(x0, fy - 3, w, 3, '#6a3a63', 0.75);
    for (let i = 0; i <= 8; i++) {
      const bx = x0 + (w / 8) * i;
      r.drawLine(bx, fy, cx + (bx - cx) * 2.6, r.h, '#3a2140', 1, 0.30);
    }

    this._drawDesk(r, x0 + w * 0.05, fy, u, t);
    this._drawGacha(r, x0 + w * 0.485, fy, u, t);
    this._drawShrine(r, x0 + w * 0.80, fy, u, t);

    // ON AIR sign, because of course there is one.
    const sw = 96 * u, sh = 30 * u;
    const sx = x0 + w * 0.30, sy = y0 + 14;
    const pulse = 0.55 + 0.45 * Math.sin(t * 2.2);
    ui.panel(sx, sy, sw, sh, {
      color: 'rgba(26,8,18,0.9)', borderColor: 'rgba(255,95,162,0.7)',
      radius: 6, borderWidth: 2, alpha: 0.5 + pulse * 0.5,
    });
    ui.text('ON AIR', sx + sw / 2, sy + sh / 2, {
      size: 12 * u, color: PALETTE.pink, align: 'center', weight: 800, alpha: 0.55 + pulse * 0.45,
    });
  },

  _drawDesk(r, dx, fy, u, t) {
    const dw = 236 * u, legH = 88 * u;
    const dy = fy - legH;
    r.drawRect(dx + 14 * u, dy, 9 * u, legH, '#241528', 1);
    r.drawRect(dx + dw - 23 * u, dy, 9 * u, legH, '#241528', 1);
    r.drawRoundRect(dx, dy - 11 * u, dw, 12 * u, 4, '#42283c', 1);

    // Two monitors and a mic. Screens animate off a sine so nothing is stored.
    for (let m = 0; m < 2; m++) {
      const mw = 92 * u, mh = 60 * u;
      const mx = dx + 12 * u + m * (mw + 16 * u);
      const my = dy - 11 * u - mh - 6 * u;
      r.drawRect(mx + mw * 0.46, my + mh, 7 * u, 8 * u, '#1b1020', 1);
      r.drawRoundRect(mx, my, mw, mh, 5, '#181022', 1);
      const glow = m === 0 ? '#6ad8ff' : '#ff5fa2';
      r.drawRoundRect(mx + 4 * u, my + 4 * u, mw - 8 * u, mh - 8 * u, 3, glow, 0.10);
      for (let b = 0; b < 5; b++) {
        const h = (0.25 + 0.6 * Math.abs(Math.sin(t * (1.6 + m * 0.7) + b * 1.1))) * (mh - 16 * u);
        const bw = (mw - 16 * u) / 5 - 3 * u;
        r.drawRect(mx + 8 * u + b * (bw + 3 * u), my + mh - 8 * u - h, bw, h, glow, 0.5);
      }
    }
    // Ring light.
    const rx = dx + dw + 34 * u, ry = fy - 150 * u, rr = 26 * u;
    r.drawRect(rx - 3 * u, ry, 6 * u, 150 * u, '#241528', 1);
    r.drawCircle(rx, ry, rr * 1.9, '#ffe9b8', 0.05);
    r.strokeCircle(rx, ry, rr, '#ffeec2', 5 * u, 0.55);
  },

  _drawGacha(r, gx, fy, u, t) {
    // The machine rattles on a timer. Nothing is inside it. Probably.
    const shake = this._rattle > 0 ? Math.sin(t * 52) * 3.2 * u * (this._rattle / 0.75) : 0;
    const x = gx + shake;
    const gw = 104 * u, gh = 104 * u, domeR = 52 * u;
    const bodyY = fy - gh;
    r.drawRoundRect(x, bodyY, gw, gh, 8, '#3b1c3a', 1);
    r.drawRoundRect(x + 6 * u, bodyY + 10 * u, gw - 12 * u, 26 * u, 5, '#ff5fa2', 0.16);
    ui.text('1 PULL', x + gw / 2, bodyY + 23 * u, {
      size: 11 * u, color: PALETTE.pink, align: 'center', weight: 800,
    });
    // Coin slot + dispenser flap.
    r.drawRect(x + gw * 0.5 - 12 * u, bodyY + 46 * u, 24 * u, 5 * u, '#170c18', 1);
    r.drawRoundRect(x + gw * 0.5 - 20 * u, bodyY + 62 * u, 40 * u, 28 * u, 5, '#170c18', 1);
    // Glass dome + capsules.
    const dcx = x + gw / 2, dcy = bodyY - domeR * 0.42;
    r.drawCircle(dcx, dcy, domeR, '#cfe6ff', 0.13);
    for (let i = 0; i < CAPSULES.length; i++) {
      const c = CAPSULES[i];
      const j = this._rattle > 0 ? Math.sin(t * 40 + i * 2.1) * 3 * u : Math.sin(t * 1.2 + i) * 0.6 * u;
      r.drawCircle(dcx + c.dx * domeR + j, dcy + c.dy * domeR - Math.abs(j) * 0.4, 9 * u, c.c, 0.9);
    }
    r.strokeCircle(dcx, dcy, domeR, '#e8f2ff', 2 * u, 0.35);
    r.drawCircle(dcx - domeR * 0.38, dcy - domeR * 0.42, domeR * 0.22, '#ffffff', 0.22);
  },

  _drawShrine(r, sx, fy, u, t) {
    // A torii, a donation box, and two candles that will not stay lit.
    const tw = 104 * u, th = 132 * u;
    const x = sx, y = fy - th;
    r.drawCircle(x + tw / 2, y + th * 0.55, 78 * u, '#ff7a3d', 0.055);
    r.drawRect(x + 8 * u, y + 18 * u, 11 * u, th - 18 * u, '#d9483f', 1);
    r.drawRect(x + tw - 19 * u, y + 18 * u, 11 * u, th - 18 * u, '#d9483f', 1);
    r.drawRect(x - 14 * u, y, tw + 28 * u, 12 * u, '#c33c35', 1);
    r.drawRect(x - 8 * u, y + 14 * u, tw + 16 * u, 6 * u, '#e05a4c', 1);
    r.drawRect(x - 2 * u, y + 34 * u, tw + 4 * u, 8 * u, '#d9483f', 1);
    // Donation box.
    r.drawRoundRect(x + 22 * u, fy - 30 * u, tw - 44 * u, 30 * u, 4, '#3a2a1e', 1);
    r.drawRect(x + 30 * u, fy - 26 * u, tw - 60 * u, 5 * u, '#1a120c', 1);
    // Candles.
    for (let i = 0; i < 2; i++) {
      const cxp = x + (i === 0 ? 6 * u : tw - 6 * u);
      const flick = 0.6 + 0.4 * Math.sin(t * (7 + i * 3.3) + i);
      r.drawRect(cxp - 3 * u, fy - 22 * u, 6 * u, 22 * u, '#e8dcc4', 1);
      r.drawCircle(cxp, fy - 27 * u, 5 * u * flick, '#ffb347', 0.85);
      r.drawCircle(cxp, fy - 27 * u, 12 * u * flick, '#ff9a3c', 0.10);
    }
  },

  // --- the cast --------------------------------------------------------------
  _drawActors(r, L) {
    const acts = this.actors;
    this._hover = -1;
    if (!acts || acts.length === 0) {
      ui.text('The studio is empty. Somebody go pull a character.',
        L.studioX + L.studioW / 2, L.floorY - 40,
        { size: 15, color: PALETTE.textFaint, align: 'center' });
      return;
    }
    // drawSprite culls against the CAMERA box and a menu never sets a camera,
    // so open the window to the screen for the duration of this pass.
    r.cullMinX = -400; r.cullMaxX = r.w + 400;
    r.cullMinY = -400; r.cullMaxY = r.h + 400;

    const mx = input.mouseX / (r.dpr || 1);
    const my = input.mouseY / (r.dpr || 1);

    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      const sp = a.sprite;
      const scale = L.actorScale * a.laneScale;
      const dw = sp.w * scale, dh = sp.h * scale;
      const walking = a.pauseT <= 0;
      const bob = walking ? Math.abs(Math.sin(a.t * 6.2)) * 3.2 : Math.sin(a.t * 2.0) * 1.4;
      const hop = a.hop > 0 ? Math.sin((1 - a.hop / 0.45) * Math.PI) * 16 : 0;
      const baseY = L.floorY + a.laneY;
      const cy = baseY - dh * 0.5 - bob - hop;
      a.sx = a.x; a.sy = cy; a.dh = dh; a.sr = Math.max(16, dw * 0.40);

      r.drawRoundRect(a.x - dw * 0.26, baseY - 4, dw * 0.52, 7, 3.5, '#000000', 0.38);
      r.drawSprite(sp, a.x, cy, 0, scale, 1, false, 0);

      if (Math.abs(mx - a.x) <= a.sr && Math.abs(my - cy) <= dh * 0.55) this._hover = i;
    }
    r.setAlpha(1);

    // Bubbles on top of everyone.
    for (const a of acts) {
      if (a.bubbleT > 0 && a.bubbleLines) this._drawBubble(r, a);
    }

    if (this._hover >= 0) {
      const a = acts[this._hover];
      if (a.bubbleT <= 0) {
        ui.text(displayName(a.char), a.sx, a.sy - a.dh * 0.5 - 12, {
          size: 13, color: RARITY_COLOR[a.char.rarity], align: 'center', weight: 800, outline: true,
        });
      }
      if (input.mouseClicked) this._poke(a, r);
    }
  },

  _drawBubble(r, a) {
    const lines = a.bubbleLines;
    const bw = a.bubbleW, bh = lines.length * 17 + 16;
    const bx = clamp(a.sx - bw / 2, 8, Math.max(8, r.w - bw - 8));
    const by = a.sy - a.dh * 0.5 - bh - 18;
    const alpha = clamp(a.bubbleT / 0.45, 0, 1);
    const col = RARITY_COLOR[a.char.rarity] || PALETTE.accent;
    ui.panel(bx, by, bw, bh, { color: 'rgba(10,7,18,0.95)', borderColor: col, radius: 10, alpha });
    for (let i = 0; i < lines.length; i++) {
      ui.text(lines[i], bx + 12, by + 16 + i * 17, { size: 13, color: PALETTE.text, alpha });
    }
    r.drawCircle(a.sx, by + bh + 6, 4, 'rgba(10,7,18,0.95)', alpha);
    r.drawCircle(a.sx + 3, by + bh + 14, 2.5, 'rgba(10,7,18,0.95)', alpha);
    ui.text(displayName(a.char), bx + 12, by - 9, {
      size: 11, color: col, weight: 800, alpha, outline: true,
    });
  },

  /** Free personality: click a character, get a line. */
  _poke(a, r) {
    const barks = a.char.barks || {};
    const keys = [];
    for (const k in barks) if (barks[k]) keys.push(k);
    if (keys.length === 0) return;
    let line = barks[keys[(Math.random() * keys.length) | 0]];
    if (a.bubbleLines && a.bubbleT > 0 && keys.length > 1) {
      // Don't repeat the line they are already saying.
      let guard = 0;
      while (line === a._lastLine && guard++ < 4) line = barks[keys[(Math.random() * keys.length) | 0]];
    }
    a._lastLine = line;
    a.bubbleLines = wrapText(r, line, 230, 13);
    let w = 0;
    for (const l of a.bubbleLines) w = Math.max(w, r.measureText(l, 13, 500));
    a.bubbleW = Math.min(254, w + 24);
    a.bubbleT = 3.6;
    a.hop = 0.45;
    a.pauseT = 1.4;
    audio.play('pickup');
  },

  // --- chrome ----------------------------------------------------------------
  _drawHeader(r, L) {
    const c = save.data.currencies;
    ui.title('THE STUDIO', L.pad, 34, { size: L.narrow ? 26 : 32 });
    // The nodes are drawn first, so focus 0..6 IS the node under the cursor.
    // Its tip goes here rather than in a tooltip, which would fall off the
    // bottom of the screen for the last two rows.
    const tip = (ui.focus >= 0 && ui.focus < NODES.length)
      ? NODES[ui.focus].tip
      : 'everyone here is technically at work';
    ui.text(this._fit(r, tip, L.narrow ? L.W - L.pad * 2 : L.W * 0.40 - L.pad, 12),
      L.pad, L.narrow ? 60 : 58, { size: 12, color: PALETTE.textFaint });

    const cy = L.narrow ? 74 : 22;
    let x = L.narrow ? L.pad : Math.max(L.pad + 250, L.W * 0.42);
    x += ui.currency(x, cy, '⭐', c.gold, PALETTE.gold) + 8;
    x += ui.currency(x, cy, '💎', c.starFragments, PALETTE.gem) + 8;
    x += ui.currency(x, cy, '🎟', c.tickets, PALETTE.accent2) + 8;
    ui.currency(x, cy, '💌', c.universalLetters, PALETTE.pink);
  },

  _drawNodes(r, L) {
    const x = L.colX, w = L.colW;
    let y = L.colY;
    for (let i = 0; i < NODES.length; i++) {
      const n = NODES[i];
      const idx = ui.itemCount;
      const hit = ui.button(n.scene, x, y, w, L.rowH, null, { radius: 10 });
      const focused = ui.focus === idx;
      const tall = L.rowH >= 44;
      ui.text(n.icon, x + 24, y + L.rowH / 2, { size: tall ? 20 : 15, align: 'center' });
      ui.text(n.label, x + 46, y + (tall ? L.rowH / 2 - 8 : L.rowH / 2), {
        size: tall ? 16 : 14, color: focused ? PALETTE.accent : PALETTE.text, weight: 800,
      });
      if (tall) {
        ui.text(this._sub(n), x + 46, y + L.rowH / 2 + 11, { size: 11, color: PALETTE.textFaint });
      }
      if (focused) ui.text('›', x + w - 16, y + L.rowH / 2, { size: 18, color: PALETTE.accent, align: 'center' });
      if (hit) this._go(n.scene);
      y += L.rowH + L.gap;
    }
  },

  _drawStarring(r, L) {
    const d = this.manager.data;
    const id = this.manager.shared.characterId;
    const char = d.characters.CHARACTERS_BY_ID[id];
    const x = L.panelX, y = L.panelY, w = L.panelW, h = L.panelH;

    if (!char) {
      ui.panel(x, y, w, h, { radius: 12 });
      ui.text('No one is equipped. Try the ROSTER.', x + 14, y + h / 2, { size: 13, color: PALETTE.textDim });
      return;
    }
    const e = rosterEntry(char.id);
    const col = ui.card(x, y, w, h, char.rarity);
    ui.text('NOW STARRING', x + 14, y + 16, { size: 10, color: PALETTE.textFaint, weight: 800 });

    // Keyboard and gamepad players get the poke too — it must not be mouse-only.
    const bw = 96, bh = 22;
    if (ui.button('poke', x + w - bw - 10, y + 6, bw, bh, 'POKE 💬', { size: 11, radius: 8 })) {
      const a = this._findActor(char.id);
      if (a) this._poke(a, r);
      else this.manager.toast('They stepped out. Try the ROSTER.', PALETTE.textDim, '💬');
    }

    // Portrait.
    const sp = atlas.ensure(char.visual);
    const ps = clamp((h - 46) / sp.h, 0.7, 2.0);
    r.cullMinX = -400; r.cullMaxX = r.w + 400; r.cullMinY = -400; r.cullMaxY = r.h + 400;
    r.drawSprite(sp, x + 34, y + h / 2 + 8, 0, ps, 1, false, 0);
    r.setAlpha(1);

    const tx = x + 68;
    const tw = w - 68 - 14;
    ui.text(this._fit(r, displayName(char), tw, 17), tx, y + 38, {
      size: 17, color: col, weight: 800,
    });
    ui.text(this._fit(r, char.epithet, tw, 12), tx, y + 56, { size: 12, color: PALETTE.textDim });

    const el = d.elements.ELEMENTS[char.element];
    ui.text(RARITY_NAME[char.rarity] + ' · S' + e.starLevel + '/5 · ' +
      (el ? el.icon + ' ' + displayName(el) : char.element),
      tx, y + 74, { size: 12, color: PALETTE.text, weight: 700 });
    ui.text('bond ' + (e.bond | 0) + ' · ' + (e.runs | 0) + ' runs · ' + formatCount(e.kills || 0) + ' kills',
      tx, y + 90, { size: 11, color: PALETTE.textFaint });
  },

  _findActor(charId) {
    if (!this.actors) return null;
    for (const a of this.actors) if (a.char.id === charId) return a;
    return null;
  },

  _drawFooter(r, L) {
    const s = save.data.stats;
    const y = L.H - L.footerH / 2 - 2;
    const line = 'PLAYTIME ' + formatPlaytime(save.data.playtime) +
      '   ·   RUNS ' + (s.runs | 0) + ' (' + (s.wins | 0) + ' cleared, ' + (s.deaths | 0) + ' learning experiences)' +
      '   ·   KILLS ' + formatCount(s.kills || 0) +
      '   ·   PULLS ' + (save.data.gacha.totalPulls | 0);
    ui.text(this._fit(r, line, L.W - L.pad * 2, 12), L.pad, y, { size: 12, color: PALETTE.textFaint });
  },

  /** Truncate to fit. Menus only — this measures text. */
  _fit(r, text, maxW, size) {
    if (r.measureText(text, size, 700) <= maxW) return text;
    let s = String(text);
    while (s.length > 1 && r.measureText(s + '…', size, 700) > maxW) s = s.slice(0, -1);
    return s + '…';
  },
};
