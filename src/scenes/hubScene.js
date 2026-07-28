// "THE STUDIO" — the hub. SECTION 12.
//
// A full-bleed main menu in three bands, not a sidebar with a picture beside it.
//
//   HEADER  the title on the left; the four currency pills right-aligned in
//           their own band, or dropped to their own row when the UI scale gets
//           big enough that the two would not both fit. They never share a
//           vertical strip with the title separated only by an x offset.
//   STAGE   the studio set — desk, monitors, ring light, gacha machine, shrine,
//           ON AIR sign — with the owned cast walking on the floor, and the NOW
//           STARRING card for the equipped character pinned to the right of it.
//   NAV     the seven destinations as large cards, pinned to the bottom of the
//           screen so they fill it instead of floating in the upper-left quarter
//           with 120-170px of dead space underneath. STAGE SELECT is a hero
//           plate down the left because it is the button that starts the game;
//           the other six sit in a grid beside it. Every card carries an icon on
//           its own plate, its label, the live progress line from _sub(), and a
//           progress bar wherever the fraction actually means something.
//
// THE TIP STRIP. A reserved row directly under the nav band. The focused card's
// description prints there, anchored to that card's x — not 500px away in the
// header — and it is resolved in the same pass that draws the cards, so it can
// never be a frame behind the cursor.
//
// The set and the cast are the personality of this screen and they stay, but
// they never fight the chrome: the set is CLIPPED to its own band, the walk band
// and the speech bubbles are clamped to the part of the stage no panel covers,
// and the header/nav/footer bands sit on a scrim over a vignette.
//
// EVERY interactive thing here is a ui.button — including the cast, which is
// therefore keyboard and gamepad reachable — except the two set props that
// double as shortcuts, which do the toolkit's press-capture dance by hand and
// call ui.consumeClick() so they can never fire on the same click as a button.
//
// Sizes are derived from ui.scale so a uiScale of 1.4 grows the boxes with the
// text instead of overflowing every label, and every string on the screen goes
// through ellipsize()/wrapText(), which measure at the scale they draw at.
//
// INPUT LIVES IN render(), NOT update(). The immediate-mode toolkit resolves a
// button on the frame it draws it, and sceneManager.update() can run up to five
// fixed steps per frame — reading input.pressed() there would fire a navigation
// five times. update() here only advances timers.
//
// The hub is the root screen, so "back" cannot mean "the previous screen".
// ESC / gamepad B opens SETTINGS (which backs out to here), and the SETTINGS
// card is labelled with that so the affordance is visible, never a dead end.

import { ui, PALETTE, RARITY_COLOR, RARITY_NAME, wrapText, ellipsize, fitSize, formatCount } from '../ui/widgets.js';
import { input } from '../core/input.js';
import { save, rosterEntry } from '../core/save.js';
import { audio } from '../core/audio.js';
import { displayName } from '../core/config.js';
import { atlas } from '../render/spriteAtlas.js';
import { clamp } from '../core/math.js';

// NODES[0] is the hero card. The rest fill the grid in this order.
const NODES = [
  { scene: 'stageSelect', label: 'STAGE SELECT', icon: '🎬', color: PALETTE.accent,
    tip: 'Seven stages, four difficulty tiers. Best times and rewards are on the card.' },
  { scene: 'roster', label: 'ROSTER', icon: '🎴', color: PALETTE.pink,
    tip: 'Equip a character, raise star levels with Fan Letters, read their bond.' },
  { scene: 'gacha', label: 'GACHA MACHINE', icon: '🎰', color: PALETTE.gem,
    tip: 'Banners, pity counters, and the last 100 pulls. It rattles by itself. Ignore that.' },
  { scene: 'shrine', label: 'THE SHRINE', icon: '⛩', color: '#ff9a3c',
    tip: 'Permanent upgrades bought with gold. The refund is free and always will be — experiment.' },
  { scene: 'achievements', label: 'ACHIEVEMENTS', icon: '🏆', color: PALETTE.gold,
    tip: '40 of them. Some pay Star Fragments, some unlock things no amount of gold can buy.' },
  { scene: 'codex', label: 'CODEX', icon: '📖', color: PALETTE.accent2,
    tip: 'Every enemy, boss, relic and character you have met, with the flavour text they deserve.' },
  { scene: 'settings', label: 'SETTINGS', icon: '⚙', color: PALETTE.textDim,
    tip: 'Volume, screen shake, damage numbers, UI scale. ESC or gamepad B lands here from anywhere.' },
];

/** Capsule positions inside the gacha dome. Fixed, so the machine never re-rolls. */
const CAPSULES = [
  { dx: -0.42, dy: 0.30, c: '#ff5fa2' }, { dx: -0.02, dy: 0.44, c: '#ffd76a' },
  { dx: 0.40, dy: 0.28, c: '#6ad8ff' }, { dx: -0.28, dy: -0.10, c: '#c58cff' },
  { dx: 0.18, dy: -0.04, c: '#7bf59a' }, { dx: 0.50, dy: -0.20, c: '#ff9ec4' },
  { dx: -0.55, dy: -0.24, c: '#6ad8ff' }, { dx: 0.02, dy: -0.40, c: '#ffd76a' },
];

/** Front lane last. The depth OFFSETS are computed per layout — see _ensureLayout. */
const LANE_SCALE = [0.80, 0.98, 1.16];

/**
 * The floor fits ten. Nineteen sprites in an 800px band is a pile rather than a
 * cast, and every one of them ends up covering the others' hit boxes.
 */
const MAX_CAST = 10;

/** A clip rect nothing can be inside. See _castHits for why this exists. */
const CLIP_NOWHERE = { x: -20000, y: -20000, w: 1, h: 1 };

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
    this._tip = null;
    this._propPress = null;
    this._counts = { owned: 0, cleared: 0, shrine: 0, ach: 0, codex: 0, pity: 0 };
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
    const equipped = (this.manager.shared && this.manager.shared.characterId) || null;

    const owned = [];
    for (const c of d.characters.CHARACTERS) {
      const e = save.data.roster[c.id];
      if (e && e.owned) owned.push(c);
    }

    // Cap the floor. The equipped character is always on it, so the NOW STARRING
    // poke button always has somebody to poke.
    let cast = owned;
    if (owned.length > MAX_CAST) {
      cast = owned.slice(0, MAX_CAST);
      let present = false;
      for (const c of cast) if (c.id === equipped) { present = true; break; }
      if (!present) {
        for (const c of owned) if (c.id === equipped) { cast[MAX_CAST - 1] = c; break; }
      }
    }

    for (let i = 0; i < cast.length; i++) {
      const c = cast[i];
      const lane = i % LANE_SCALE.length;
      this.actors.push({
        char: c,
        sprite: atlas.ensure(c.visual),
        lane,
        laneScale: LANE_SCALE[lane],
        x: 0, sx: 0, sy: 0, dw: 40, dh: 40,
        vx: (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 16),
        t: Math.random() * 10,
        idleT: 2 + Math.random() * 8,
        pauseT: 0,
        hop: 0,
        bubbleT: 0,
        bubbleLines: null,
        bubbleW: 0,
        // Spread across the band rather than pinning the first and last to the
        // walls, which is where they used to stand until they chose to move.
        _spread: (i + 0.5) / cast.length,
      });
    }
    // Back lanes first so the front row overlaps them, which is the whole trick.
    this.actors.sort((a, b) => a.lane - b.lane);
  },

  /** Constant denominators for the card subtitles. Built once, never in render. */
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

  /**
   * One pass over the save blob per frame. _sub() and _frac() both need the same
   * five counts, and counting twice per card meant fourteen scans of the roster,
   * the stage table and the codex every frame.
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
    this._counts = { owned, cleared, shrine, ach, codex, pity: save.data.gacha.sharedPity5 | 0 };
  },

  _sub(node) {
    const d = this.manager && this.manager.data;
    const c = this._counts, t = this.totals;
    if (!d) return '';
    switch (node.scene) {
      case 'stageSelect': return c.cleared + '/' + t.stages + ' stages cleared';
      case 'roster': return c.owned + '/' + t.chars + ' characters owned';
      case 'gacha': {
        const left = Math.max(0, d.gacha.PITY.hard5 - c.pity);
        return c.pity + ' pulls since ★5 · guaranteed in ' + left;
      }
      case 'shrine':
        return c.shrine + '/' + t.shrine + ' levels · ' +
          formatCount(save.data.currencies.gold) + ' gold banked';
      case 'achievements': return c.ach + '/' + t.achievements + ' unlocked';
      case 'codex': return c.codex + '/' + t.codex + ' entries seen';
      case 'settings': return 'ESC / gamepad B lands here';
    }
    return '';
  },

  /** The card's progress bar, or -1 where a fraction would be a lie. */
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
      case 'shrine': return t.shrine ? c.shrine / t.shrine : -1;
      case 'achievements': return t.achievements ? c.ach / t.achievements : -1;
      case 'codex': return t.codex ? c.codex / t.codex : -1;
    }
    return -1;
  },

  _go(scene) {
    if (this._nav) return;
    this._nav = true;
    this.manager.go(scene);
  },

  // --- layout ----------------------------------------------------------------
  /**
   * Everything below is in REAL pixels and derived from ui.scale, so the boxes
   * grow with the text. Sizes handed to ui.text()/ui.title() are LOGICAL — the
   * toolkit multiplies those by ui.scale itself — which is why the few places
   * that size text off a real-pixel box divide S back out.
   */
  _ensureLayout(r) {
    const S = clamp(ui.scale || 1, 0.75, 1.7);
    const key = r.w + 'x' + r.h + '@' + S;
    if (this.L && this.L.key === key) return this.L;

    const W = r.w, H = r.h;
    const pad = Math.round(clamp(W * 0.022, 14, 30));
    const gap = Math.round(12 * S);

    // The pills get their own right-aligned band. When the title and the pills
    // cannot both fit on one row at this scale the pills drop to a second row —
    // they are never merely x-offset past the title and hoped for.
    const titleW = r.measureText('THE STUDIO', 30 * S, 800);
    const stackHeader = (W - pad * 2 - titleW - 24) < 470 * S;
    const headerH = Math.round((stackHeader ? 112 : 82) * S);
    const footerH = Math.round(30 * S);
    const tipH = Math.round(56 * S);

    const bodyY = headerH;
    const bodyH = Math.max(200, H - headerH - footerH);

    // --- nav band, pinned to the bottom --------------------------------------
    const navW = W - pad * 2;
    const cols = navW >= 1120 ? 3 : 2;
    const rows = 6 / cols;
    const cardMinH = Math.max(64, Math.round(70 * S));
    const cardMaxH = Math.round(190 * S);
    const navMin = cardMinH * rows + gap * (rows - 1);
    const navMax = cardMaxH * rows + gap * (rows - 1);
    // Reserve a stage first: the set and the cast are not decoration that gets
    // squeezed to nothing on a short window.
    const stageMin = Math.round(clamp(H * 0.18, 120, 260));
    const navRoom = Math.max(Math.round(110 * S), bodyH - tipH - gap - stageMin);
    const navH = Math.min(Math.round(clamp(bodyH * 0.44, navMin, navMax)), navRoom);

    const navY = H - footerH - tipH - navH;
    const tipY = navY + navH + Math.round(6 * S);
    const heroW = Math.round(clamp(navW * 0.30, 230 * S, 430 * S));
    const gridX = pad + heroW + gap;
    const gridW = navW - heroW - gap;
    const cardW = (gridW - gap * (cols - 1)) / cols;
    const cardH = (navH - gap * (rows - 1)) / rows;

    // --- stage band ----------------------------------------------------------
    const studioY = bodyY;
    const studioH = Math.max(0, navY - gap - studioY);
    const studioX = pad;
    // On a stage too short to hold a character card, the card is dropped and the
    // width goes back to the set — better an honest empty floor than a NOW
    // STARRING panel with its own text folded on top of its own button.
    const wantStarW = Math.round(clamp(W * 0.26, 290 * S, 440 * S));
    const starOk = studioH >= 170 && (W - pad * 2 - wantStarW) >= 320;
    const starW = starOk ? wantStarW : 0;
    const starX = W - pad - starW;
    const studioW = Math.max(80, (starOk ? starX - gap : W - pad) - studioX);
    const floorY = studioY + studioH - Math.round(16 * S);
    const stageOk = studioH >= 108 && studioW >= 200;

    // Lanes are spread across a third of the stage's depth instead of the 19px
    // they used to sit apart, which put three 60-96px sprites inside one sprite
    // height of each other and made the back two effectively unclickable.
    const laneSpan = Math.round(clamp(studioH * 0.34, 44, 140));
    const laneY = [];
    for (let i = 0; i < LANE_SCALE.length; i++) {
      laneY.push(-laneSpan * (1 - i / (LANE_SCALE.length - 1)));
    }
    const depth = floorY - studioY;
    const actorScale = clamp(Math.min(depth / 210, laneSpan / 58), 0.85, 1.8);

    // The two props that are also destinations. Boxes here so the hit test and
    // the drawing cannot drift apart.
    const u = clamp(studioW / 900, 0.55, 1.3);
    const gx = studioX + studioW * 0.485;
    const domeTop = floorY - 104 * u - 52 * u * 1.42;
    const sx = studioX + studioW * 0.80;

    const L = {
      key, S, W, H, pad, gap, stackHeader, headerH, footerH,
      navY, navH, tipY, tipH, cols, rows,
      heroX: pad, heroW, gridX, cardW, cardH,
      starX, starY: studioY, starW, starH: studioH, starOk,
      studioX, studioY, studioW, studioH, floorY, stageOk, u,
      gachaBox: { x: gx, y: domeTop, w: 104 * u, h: floorY - domeTop },
      shrineBox: { x: sx - 14 * u, y: floorY - 132 * u, w: 132 * u, h: 132 * u },
      laneY, actorScale,
      walkMinX: studioX + 44,
      walkMaxX: Math.max(studioX + 54, studioX + studioW - 44),
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
    ui.begin(r, 'hub');
    const L = this._ensureLayout(r);
    ui.focusGrid(L.cols);
    this._refreshCounts();

    this._paintBackdrop(r, L);
    this._drawStudio(r, L);
    this._drawActors(r, L);
    r.vignette('rgba(8,4,14,0.85)', 0.55);
    this._drawScrims(r, L);

    this._drawHeader(r, L);
    // Focus order: the seven cards, then POKE, then the cast. STAGE SELECT is
    // index 0, so arriving here already points at the button that starts a run.
    this._drawNodes(r, L);
    this._drawStarring(r, L);
    this._castHits(r, L);
    this._drawBubbles(r, L);
    this._propHits(r, L);
    this._drawFooter(r, L);

    // The root screen's escape hatch: never a dead end, always somewhere useful.
    if (ui.backPressed() && !this._nav) { audio.play('uiBack'); this._go('settings'); }

    ui.end();
  },

  _paintBackdrop(r, L) {
    const c = r.ctx;
    const key = L.W + 'x' + L.H;
    if (this._bgKey !== key) {
      const g = c.createLinearGradient(0, 0, 0, L.H);
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
    c.fillRect(0, 0, L.W, L.H);
  },

  /** Dim the bands the chrome sits on, so the set never eats a label. */
  _drawScrims(r, L) {
    r.drawRect(0, 0, L.W, L.headerH, 'rgba(8,5,16,0.74)', 1);
    r.drawRect(0, L.headerH - 2, L.W, 2, 'rgba(255,215,106,0.30)', 1);
    const y = L.navY - Math.round(8 * L.S);
    r.drawRect(0, y, L.W, L.H - y, 'rgba(7,4,14,0.62)', 1);
    r.drawRect(0, y, L.W, 1, 'rgba(150,170,225,0.22)', 1);
  },

  // --- the set ---------------------------------------------------------------
  _drawStudio(r, L) {
    if (!L.stageOk) return;
    const x0 = L.studioX, y0 = L.studioY, fy = L.floorY;
    const w = L.studioW, bottom = L.studioY + L.studioH;
    const t = this.t;
    const u = L.u;
    const cx = x0 + w * 0.5;

    // The set now lives in a BAND rather than running off the bottom of the
    // screen, so everything in it is clipped to that band — the floorboard
    // perspective lines in particular fan well outside it.
    r.clipRect(x0, y0, w, bottom - y0);

    // Back wall + seams.
    r.drawRect(x0, y0, w, fy - y0, '#2c1730', 0.45);
    for (let i = 1; i < 4; i++) {
      const yy = y0 + (fy - y0) * (i / 4);
      r.drawLine(x0, yy, x0 + w, yy, '#432349', 1, 0.35);
    }
    // Floor + perspective boards.
    r.drawRect(x0, fy, w, bottom - fy, '#1d1223', 0.85);
    r.drawRect(x0, fy - 3, w, 3, '#6a3a63', 0.75);
    for (let i = 0; i <= 8; i++) {
      const bx = x0 + (w / 8) * i;
      r.drawLine(bx, fy, cx + (bx - cx) * 2.6, bottom, '#3a2140', 1, 0.30);
    }

    this._drawDesk(r, x0 + w * 0.05, fy, u, t);
    this._drawGacha(r, L.gachaBox.x, fy, u, t);
    this._drawShrine(r, L.shrineBox.x + 14 * u, fy, u, t);

    // ON AIR sign, because of course there is one.
    const sw = 96 * u, sh = 30 * u;
    const sx = x0 + w * 0.28, sy = y0 + 12;
    const pulse = 0.55 + 0.45 * Math.sin(t * 2.2);
    ui.panel(sx, sy, sw, sh, {
      color: 'rgba(26,8,18,0.9)', borderColor: 'rgba(255,95,162,0.7)',
      radius: 6, borderWidth: 2, alpha: 0.5 + pulse * 0.5,
    });
    ui.text('ON AIR', sx + sw / 2, sy + sh / 2, {
      size: 12 * u / L.S, color: PALETTE.pink, align: 'center', weight: 800, alpha: 0.55 + pulse * 0.45,
    });

    r.unclip();
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
      size: 11 * u / (ui.scale || 1), color: PALETTE.pink, align: 'center', weight: 800,
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
  /** Sprites only. The hit boxes are declared later, after the nav cards. */
  _drawActors(r, L) {
    const acts = this.actors;
    if (!L.stageOk) return;
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

    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      const sp = a.sprite;
      // `sprite.unit` cancels the atlas's integer-upscale rounding. Without it
      // the cast's size on this screen depends on which side of 0.5 a
      // character's grid happened to land, and two characters standing next to
      // each other can differ by a factor of two.
      const scale = L.actorScale * a.laneScale * sp.unit;
      const dw = sp.w * scale, dh = sp.h * scale;
      const walking = a.pauseT <= 0;
      const bob = walking ? Math.abs(Math.sin(a.t * 6.2)) * 3.2 : Math.sin(a.t * 2.0) * 1.4;
      const hop = a.hop > 0 ? Math.sin((1 - a.hop / 0.45) * Math.PI) * 16 : 0;
      const baseY = L.floorY + L.laneY[a.lane];
      const cy = baseY - dh * 0.5 - bob - hop;
      a.sx = a.x; a.sy = cy; a.dw = dw; a.dh = dh;

      r.drawRoundRect(a.x - dw * 0.26, baseY - 4, dw * 0.52, 7, 3.5, '#000000', 0.38);
      r.drawSprite(sp, a.x, cy, 0, scale, 1, false, 0);
    }
    r.setAlpha(1);
  },

  /** The hit box for one actor, in screen space. */
  _actorBox(a) {
    const hw = Math.max(15, a.dw * 0.42), hh = Math.max(17, a.dh * 0.5);
    return { x: a.sx - hw, y: a.sy - hh, w: hw * 2, h: hh * 2 };
  },

  /**
   * The cast, as real focusable widgets.
   *
   * They used to be hand-hit-tested with no focus participation and no break, so
   * an overlap always resolved to the LAST actor tested — the one furthest back.
   * Now: find the topmost actor under the cursor first (front to back, breaking
   * at the first hit), then declare every actor as an invisible ui.button in
   * DRAW order. The ones the topmost covers are handed a clip rect nothing can
   * be inside, which makes the toolkit treat them as un-hoverable and
   * un-clickable while leaving them keyboard- and gamepad-reachable.
   */
  _castHits(r, L) {
    const acts = this.actors;
    this._hover = -1;
    if (!acts || acts.length === 0 || !L.stageOk) return;

    let top = -1;
    for (let i = acts.length - 1; i >= 0; i--) {
      const b = this._actorBox(acts[i]);
      if (ui.pointIn(b.x, b.y, b.w, b.h)) { top = i; break; }
    }

    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      const b = this._actorBox(a);
      const idx = ui.itemCount;
      const hit = ui.button('cast' + i, b.x, b.y, b.w, b.h, null, {
        invisible: true,
        clip: (top >= 0 && top !== i) ? CLIP_NOWHERE : null,
      });
      if (ui.focus === idx) this._hover = i;
      if (hit) this._poke(a, r, L);
    }

    if (this._hover >= 0) {
      const a = acts[this._hover];
      if (a.bubbleT <= 0) {
        ui.text(displayName(a.char), a.sx, a.sy - a.dh * 0.5 - 12, {
          size: 13, color: RARITY_COLOR[a.char.rarity], align: 'center', weight: 800, outline: true,
        });
      }
    }
  },

  /** On top of the chrome, so a bark is never painted over by a panel. */
  _drawBubbles(r, L) {
    if (!this.actors || !L.stageOk) return;
    for (const a of this.actors) {
      if (a.bubbleT > 0 && a.bubbleLines) this._drawBubble(r, L, a);
    }
  },

  _drawBubble(r, L, a) {
    const lines = a.bubbleLines;
    const bw = a.bubbleW, bh = lines.length * 17 + 16;
    // Clamped to the STAGE, not the screen. A bubble from the leftmost actor
    // used to slide under the nav column and get painted over by it.
    const bx = clamp(a.sx - bw / 2, L.studioX + 6,
                     Math.max(L.studioX + 6, L.studioX + L.studioW - bw - 6));
    const by = Math.max(L.studioY + 14, a.sy - a.dh * 0.5 - bh - 18);
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
  _poke(a, r, L) {
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
    // The bubble can never be wider than the stage it has to sit inside.
    const wrapW = clamp((L || this.L || { studioW: 300 }).studioW - 60, 140, 240);
    a.bubbleLines = wrapText(r, line, wrapW, 13);
    let w = 0;
    for (const l of a.bubbleLines) w = Math.max(w, r.measureText(l, 13 * (ui.scale || 1), 600));
    a.bubbleW = Math.min(wrapW + 24, w + 24);
    a.bubbleT = 3.6;
    a.hop = 0.45;
    a.pauseT = 1.4;
    audio.play('pickup');
  },

  _findActor(charId) {
    if (!this.actors) return null;
    for (const a of this.actors) if (a.char.id === charId) return a;
    return null;
  },

  /**
   * The set is clickable. The gacha machine and the shrine ARE destinations, so
   * pointing at them and clicking goes there. This is the one hand-rolled hit
   * test on the screen — the nav cards remain the keyboard/gamepad path — and it
   * mirrors the toolkit's press capture exactly, then calls ui.consumeClick() so
   * it can never fire on the same click as a button that is drawn over it.
   */
  _propHits(r, L) {
    if (L.stageOk) {
      const props = [
        { box: L.gachaBox, scene: 'gacha', label: 'GACHA MACHINE', color: PALETTE.pink },
        { box: L.shrineBox, scene: 'shrine', label: 'THE SHRINE', color: '#ff9a3c' },
      ];
      for (const p of props) {
        const b = p.box;
        const over = ui.pointIn(b.x, b.y, b.w, b.h);
        if (over) {
          ui.markHot();
          r.drawRoundRect(b.x - 5, b.y - 5, b.w + 10, b.h + 10, 12, p.color, 0.12);
          ui.text(p.label + ' ›', b.x + b.w / 2, b.y - 14, {
            size: 12, color: p.color, align: 'center', weight: 800, outline: true,
          });
          if (input.mouseClicked && !this._propPress) this._propPress = p.scene;
          if (input.mouseReleased && this._propPress === p.scene && ui.consumeClick()) {
            audio.play('uiConfirm');
            this._go(p.scene);
          }
        }
      }
    }
    // A release anywhere ends the press, exactly as the toolkit does.
    if (input.mouseReleased) this._propPress = null;
  },

  // --- chrome ----------------------------------------------------------------
  /** ui.currency() sizes its pill from exactly this; mirrored so the row can be
   *  right-aligned without drawing it twice to find out how wide it is. */
  _pillW(r, amount) { return r.measureText(formatCount(amount), 15, 700) + 42; },

  _drawHeader(r, L) {
    const S = L.S;
    const c = save.data.currencies;

    const titleY = Math.round((L.stackHeader ? 30 : 32) * S);
    ui.title('THE STUDIO', L.pad, titleY, { size: 30 });
    ui.text('everyone here is technically at work', L.pad, titleY + Math.round(23 * S),
      { size: 12, color: PALETTE.textFaint });

    // The pills own a band. No tip text lives up here any more — it belongs on
    // the card the cursor is pointing at, not 500px away and a frame stale.
    const pills = [
      ['⭐', c.gold, PALETTE.gold],
      ['💎', c.starFragments, PALETTE.gem],
      ['🎟', c.tickets, PALETTE.accent2],
      ['💌', c.universalLetters, PALETTE.pink],
    ];
    const pg = Math.round(9 * S);
    let total = -pg;
    for (const p of pills) total += this._pillW(r, p[1]) + pg;

    let px = L.stackHeader ? L.pad : Math.max(L.pad, L.W - L.pad - total);
    const py = L.stackHeader ? Math.round(70 * S) : Math.round((L.headerH - 28) / 2);
    for (const p of pills) px += ui.currency(px, py, p[0], p[1], p[2]) + pg;
  },

  _drawFooter(r, L) {
    const s = save.data.stats;
    r.drawRect(0, L.H - L.footerH, L.W, 1, 'rgba(150,170,225,0.20)', 1);
    const line = 'PLAYTIME ' + formatPlaytime(save.data.playtime) +
      '   ·   RUNS ' + (s.runs | 0) + ' (' + (s.wins | 0) + ' cleared, ' + (s.deaths | 0) + ' learning experiences)' +
      '   ·   KILLS ' + formatCount(s.kills || 0) +
      '   ·   PULLS ' + (save.data.gacha.totalPulls | 0);
    ui.text(ellipsize(r, line, L.W - L.pad * 2, 12, 600), L.pad, L.H - L.footerH / 2,
      { size: 12, color: PALETTE.textFaint });
  },

  // --- the seven destinations ------------------------------------------------
  _drawNodes(r, L) {
    this._tip = null;
    // Hero first, so STAGE SELECT is focus index 0 and the screen opens pointing
    // at the button that starts a run.
    this._heroCard(r, L, NODES[0], L.heroX, L.navY, L.heroW, L.navH);
    for (let i = 1; i < NODES.length; i++) {
      const k = i - 1;
      const x = L.gridX + (k % L.cols) * (L.cardW + L.gap);
      const y = L.navY + Math.floor(k / L.cols) * (L.cardH + L.gap);
      this._gridCard(r, L, NODES[i], x, y, L.cardW, L.cardH);
    }
    this._drawTip(r, L);
  },

  /**
   * The icon plate: a rounded frame in the card's colour with a dark well cut
   * out of it. Two round rects, and the icon stops floating in the label's lap.
   */
  _iconPlate(r, L, x, y, size, icon, color, hot) {
    r.drawRoundRect(x, y, size, size, size * 0.22, hot ? color : 'rgba(150,170,225,0.45)', hot ? 0.95 : 0.5);
    r.drawRoundRect(x + 2, y + 2, size - 4, size - 4, size * 0.19, 'rgba(8,10,22,0.94)', 1);
    // The plate is in real pixels; ui.text multiplies by ui.scale, so divide it
    // back out or the glyph outgrows the plate at uiScale 1.4.
    ui.text(icon, x + size / 2, y + size / 2 + size * 0.02, { size: size * 0.46 / L.S, align: 'center' });
  },

  _heroCard(r, L, n, x, y, w, h) {
    const S = L.S;
    const idx = ui.itemCount;
    const hit = ui.button(n.scene, x, y, w, h, null, { radius: 14 });
    const focused = ui.focus === idx;
    if (focused) this._tip = { text: n.tip, x, color: n.color };

    // Visual primacy: a permanent accent wash and frame the other six never get.
    r.drawRoundRect(x + 2, y + 2, w - 4, h - 4, 12, PALETTE.accent, focused ? 0.12 : 0.07);
    ui.panel(x, y, w, h, {
      color: 'rgba(0,0,0,0)', borderColor: PALETTE.accent,
      borderWidth: focused ? 3 : 2, radius: 14, bevel: false,
    });

    const cx = x + w / 2;
    const barH = Math.max(7, Math.round(9 * S));
    const barY = y + h - Math.round(30 * S) - barH;
    const zTop = y + Math.round(10 * S);
    const zH = Math.max(60, barY - Math.round(14 * S) - zTop);
    const plate = Math.round(clamp(Math.min(w * 0.36, zH * 0.42), 48, 148 * S));
    const blockH = Math.round(20 * S) + plate + Math.round(28 * S) + Math.round(22 * S);
    const top = zTop + Math.max(0, (zH - blockH) / 2);

    ui.text('START A RUN', cx, top + Math.round(9 * S),
      { size: 11, color: PALETTE.accent, align: 'center', weight: 800 });
    this._iconPlate(r, L, cx - plate / 2, top + Math.round(20 * S), plate, n.icon, PALETTE.accent, true);

    const labelY = top + Math.round(20 * S) + plate + Math.round(24 * S);
    const tw = w - Math.round(28 * S);
    const ls = fitSize(r, n.label, tw, 24, 800);
    ui.text(ellipsize(r, n.label, tw, ls, 800), cx, labelY, {
      size: ls, color: focused ? PALETTE.accent : PALETTE.text, align: 'center', weight: 800,
    });
    ui.text(ellipsize(r, this._sub(n), tw, 12, 600), cx, labelY + Math.round(22 * S),
      { size: 12, color: PALETTE.textDim, align: 'center' });

    const frac = this._frac(n);
    if (frac >= 0) {
      const bx = x + Math.round(20 * S), bw = w - Math.round(40 * S);
      ui.bar(bx, barY, bw, barH, frac, PALETTE.accent, { segments: false });
    }
    ui.text('▶  PLAY', cx, y + h - Math.round(14 * S),
      { size: 13, color: PALETTE.accent, align: 'center', weight: 800 });

    if (hit) this._go(n.scene);
  },

  _gridCard(r, L, n, x, y, w, h) {
    const S = L.S;
    const idx = ui.itemCount;
    const hit = ui.button(n.scene, x, y, w, h, null, { radius: 12 });
    const focused = ui.focus === idx;
    if (focused) this._tip = { text: n.tip, x, color: n.color };

    // A colour rail down the left edge, so six cards read as six places.
    r.drawRoundRect(x + 3, y + 8, 4, h - 16, 2, n.color, focused ? 0.95 : 0.55);

    const frac = this._frac(n);
    const barH = Math.max(6, Math.round(7 * S));
    const barY = y + h - Math.round(15 * S) - barH;
    const contentH = (frac >= 0 ? barY - Math.round(8 * S) : y + h) - y;

    const plate = Math.round(clamp(contentH * 0.56, 34, 64 * S));
    const px = x + Math.round(16 * S);
    const py = y + (contentH - plate) / 2;
    this._iconPlate(r, L, px, py, plate, n.icon, n.color, focused);

    const tx = px + plate + Math.round(14 * S);
    const tw = Math.max(30, x + w - tx - Math.round(14 * S));
    const midY = y + contentH / 2;
    const ls = fitSize(r, n.label, tw, 16, 800);
    ui.text(ellipsize(r, n.label, tw, ls, 800), tx, midY - Math.round(11 * S), {
      size: ls, color: focused ? PALETTE.accent : PALETTE.text, weight: 800,
    });
    // The sub-line goes through the same fitter as everything else now. It was
    // the one string on the screen that did not, so at uiScale 1.3 it ran off
    // the end of the button and into the focus chevron.
    ui.text(ellipsize(r, this._sub(n), tw, 11, 600), tx, midY + Math.round(10 * S),
      { size: 11, color: PALETTE.textFaint });

    if (frac >= 0) {
      ui.bar(x + Math.round(16 * S), barY, w - Math.round(32 * S), barH, frac, n.color, { segments: false });
    }
    if (hit) this._go(n.scene);
  },

  /**
   * The tip strip. A reserved row under the nav band, so the description sits
   * DIRECTLY UNDER the card it belongs to and never covers it, never flips over
   * a neighbour, and never moves the layout when it appears.
   */
  _drawTip(r, L) {
    const S = L.S;
    const y = L.tipY;
    const boxH = L.tipH - Math.round(6 * S);
    const t = this._tip;
    if (!t) {
      ui.text('point at a card and it tells you what is behind it',
        L.pad + Math.round(4 * S), y + boxH / 2, { size: 12, color: PALETTE.textFaint });
      return;
    }
    const w = Math.min(Math.round(640 * S), L.W - L.pad * 2);
    const x = clamp(t.x, L.pad, Math.max(L.pad, L.W - L.pad - w));
    const lines = wrapText(r, t.text, w - Math.round(28 * S), 12);
    const lh = Math.round(15 * S);
    const h = Math.min(boxH, lines.length * lh + Math.round(15 * S));

    ui.panel(x, y, w, h, {
      color: 'rgba(8,6,18,0.96)', borderColor: t.color, radius: 8, borderWidth: 1.5, bevel: false,
    });
    // A tab pointing back up at the card this belongs to.
    const tabX = clamp(t.x + Math.round(20 * S), x + 8, x + w - Math.round(26 * S));
    r.drawRect(tabX, y - Math.round(4 * S), Math.round(16 * S), Math.round(5 * S), t.color, 0.9);

    for (let i = 0; i < lines.length; i++) {
      const ly = y + Math.round(14 * S) + i * lh;
      if (ly + lh * 0.5 > y + h) break;
      ui.text(lines[i], x + Math.round(14 * S), ly, { size: 12, color: PALETTE.textDim });
    }
  },

  // --- NOW STARRING ----------------------------------------------------------
  /** The equipped character, drawn as big as the stage band allows. */
  _portrait(r, char, col, cx, top, boxH) {
    if (boxH < 26) return;
    const sp = atlas.ensure(char.visual);
    const cy = top + boxH / 2;
    r.drawCircle(cx, cy, boxH * 0.46, col, 0.10);
    r.drawRoundRect(cx - boxH * 0.28, top + boxH - 6, boxH * 0.56, 7, 3.5, '#000000', 0.40);
    r.cullMinX = -400; r.cullMaxX = r.w + 400; r.cullMinY = -400; r.cullMaxY = r.h + 400;
    r.drawSprite(sp, cx, cy, 0, clamp((boxH * 0.86) / sp.h, 0.7, 5.0), 1, false, 0);
    r.setAlpha(1);
  },

  _drawStarring(r, L) {
    const d = this.manager && this.manager.data;
    if (!d || !L.starOk) return;
    const S = L.S;
    const x = L.starX, y = L.starY, w = L.starW, h = L.starH;

    const pad = Math.round(15 * S);
    const btnH = Math.max(40, Math.round(44 * S));
    const btnY = y + h - btnH - Math.round(14 * S);
    const tw = w - pad * 2;
    const char = d.characters.CHARACTERS_BY_ID[this.manager.shared.characterId];

    if (!char) {
      ui.panel(x, y, w, h, { radius: 12, color: 'rgba(8,10,20,0.92)' });
      ui.text('NOW STARRING', x + pad, y + Math.round(19 * S),
        { size: 10, color: PALETTE.textFaint, weight: 800 });
      ui.slot(x + pad, y + Math.round(34 * S), tw,
        Math.max(24, btnY - Math.round(46 * S) - y), { label: 'NOBODY EQUIPPED', radius: 10 });
      if (ui.button('toRoster', x + pad, btnY, tw, btnH, 'OPEN THE ROSTER ›', { size: 14 })) {
        this._go('roster');
      }
      return;
    }

    const e = rosterEntry(char.id);
    const el = d.elements.ELEMENTS[char.element];
    const col = ui.card(x, y, w, h, char.rarity);
    ui.text('NOW STARRING', x + pad, y + Math.round(19 * S),
      { size: 10, color: PALETTE.textFaint, weight: 800 });

    const meta = RARITY_NAME[char.rarity] + ' · S' + e.starLevel + '/5 · ' +
      (el ? el.icon + ' ' + displayName(el) : char.element);
    const bottom = btnY - Math.round(10 * S);
    const lead = Math.round(20 * S);

    // A tall stage stacks the portrait over the text and gets a stat strip. A
    // short one turns the card on its side rather than folding the text onto
    // its own button, which is what a single vertical budget used to do.
    if (h >= 250) {
      const topY = y + Math.round(32 * S);
      const textH = Math.round(70 * S);
      let statH = Math.round(40 * S);
      let portH = bottom - topY - textH - statH;
      if (portH < 50) { statH = 0; portH = bottom - topY - textH; }
      portH = clamp(portH, 0, Math.round(200 * S));

      this._portrait(r, char, col, x + w / 2, topY, portH);
      let ty = topY + portH + Math.round(16 * S);
      const ns = fitSize(r, displayName(char), tw, 20, 800);
      ui.text(ellipsize(r, displayName(char), tw, ns, 800), x + w / 2, ty,
        { size: ns, color: col, align: 'center', weight: 800 });
      ui.text(ellipsize(r, char.epithet, tw, 12, 600), x + w / 2, ty + lead,
        { size: 12, color: PALETTE.textDim, align: 'center' });
      ui.text(ellipsize(r, meta, tw, 12, 700), x + w / 2, ty + lead * 2,
        { size: 12, color: PALETTE.text, align: 'center', weight: 700 });

      if (statH > 0) this._statStrip(r, L, e, x + pad, bottom - statH, tw, statH);
    } else {
      const topY = y + Math.round(28 * S);
      const ph = Math.max(28, bottom - topY);
      const pw = Math.min(Math.round(w * 0.36), ph);
      this._portrait(r, char, col, x + pad + pw / 2, topY, ph);

      const tx = x + pad + pw + Math.round(12 * S);
      const rw = Math.max(40, x + w - pad - tx);
      const ty = topY + Math.round(12 * S);
      const ns = fitSize(r, displayName(char), rw, 18, 800);
      ui.text(ellipsize(r, displayName(char), rw, ns, 800), tx, ty, { size: ns, color: col, weight: 800 });
      if (ty + lead <= bottom) {
        ui.text(ellipsize(r, char.epithet, rw, 12, 600), tx, ty + lead,
          { size: 12, color: PALETTE.textDim });
      }
      if (ty + lead * 2 <= bottom) {
        ui.text(ellipsize(r, meta, rw, 12, 700), tx, ty + lead * 2,
          { size: 12, color: PALETTE.text, weight: 700 });
      }
    }

    // 96x22 was the smallest click target in the game, and it was drawn on top
    // of the card's own rarity band. It is a real control now.
    if (ui.button('poke', x + pad, btnY, tw, btnH, 'POKE 💬', { size: 14, radius: 10 })) {
      const a = this._findActor(char.id);
      if (a) this._poke(a, r, L);
      else this.manager.toast('They stepped out. Try the ROSTER.', PALETTE.textDim, '💬');
    }
  },

  _statStrip(r, L, e, x, y, w, h) {
    const S = L.S;
    const cells = [['BOND', String(e.bond | 0)], ['RUNS', String(e.runs | 0)],
                   ['KILLS', formatCount(e.kills || 0)]];
    const g = Math.round(8 * S);
    const cw = (w - g * 2) / 3;
    for (let i = 0; i < 3; i++) {
      const cx = x + i * (cw + g);
      ui.panel(cx, y, cw, h, { radius: 8, color: 'rgba(6,8,18,0.72)', bevel: false });
      ui.text(cells[i][0], cx + cw / 2, y + Math.round(13 * S),
        { size: 9, color: PALETTE.textFaint, align: 'center', weight: 800 });
      ui.text(ellipsize(r, cells[i][1], cw - 10, 15, 800), cx + cw / 2, y + h - Math.round(13 * S),
        { size: 15, color: PALETTE.text, align: 'center', weight: 800, mono: true });
    }
  },
};
