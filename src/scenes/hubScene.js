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
// simply does not have. That skeleton is untouched and must stay untouched;
// there is a test that walks eight viewport sizes by four UI scales and checks
// every rect it produces.
//
// WHAT CHANGED AFTER THAT, AND WHY
// --------------------------------
// The layout was right and the SURFACE was wrong. Verbatim from the owner: "the
// main menu is pretty scuffed". Three specific things were true of it, and all
// three are ordinary, unglamorous mistakes rather than matters of taste:
//
//   1. ONE FACE, ONE WEIGHT. Titles, card labels, subtitles and the footer were
//      all the same system UI stack. A screen with no typographic contrast is a
//      settings dialog no matter what colour it is, and this one had the game's
//      own name set in the same font as "PLAYTIME 4h 12m". There is a display
//      face now (render/renderer.js DISPLAY_FONT — condensed, no download) and
//      the wordmark is the gradient one off the boot splash, which was always
//      the best-looking type in the project and had never appeared in the game.
//
//   2. TWO PAIRS OF DESTINATIONS SHARED A COLOUR. GACHA and CODEX were both
//      #6ad8ff; PLAY and ACHIEVEMENTS were both #ffd76a. The rule the design
//      claimed for itself — every destination knows itself by its colour — was
//      not actually being kept, because the palette had six hues for eight
//      things. It has eight now.
//
//   3. THE PLAY BUTTON WAS A ROUNDED RECTANGLE WITH A TRIANGLE IN IT. It is the
//      reason the screen exists. It is now the only object on the screen with a
//      gradient body, a moving specular sweep, an ignition disc that spins, a
//      charge that winds up while the button is held, and a shock ring on
//      release — and it is still a plain `ui.button`, so keyboard and gamepad
//      reach it exactly as before.
//
// The look otherwise still comes from composition and light rather than props:
// a deep gradient, two accent blooms, a fine grid, drifting motes, and cards
// that lift and bracket when they take focus.
//
// INPUT LIVES IN render(), NOT update(). The immediate-mode toolkit resolves a
// button on the frame it draws it, and sceneManager.update() can run up to five
// fixed steps per frame — reading input.pressed() there would fire a navigation
// five times.
//
// The hub is the root screen, so "back" cannot mean "the previous screen".
// ESC / gamepad B opens SETTINGS, and the SETTINGS card says so.

import { ui, PALETTE, ellipsize, fitSize, formatCount } from '../ui/widgets.js';
import { save } from '../core/save.js';
import { audio } from '../core/audio.js';
import { clamp, TAU } from '../core/math.js';
import { Rng, hashString } from '../core/rng.js';
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

/**
 * EIGHT DESTINATIONS, EIGHT HUES.
 *
 * This list used to reach for PALETTE tokens by meaning — `PALETTE.gem` for the
 * gacha because gems buy pulls, `PALETTE.gold` for achievements because trophies
 * are gold — and ended up with GACHA and CODEX on the same cyan and PLAY and
 * ACHIEVEMENTS on the same gold. Meaning is the wrong axis: the card's colour is
 * not a description of the card, it is the card's NAME at a glance and from the
 * corner of your eye, and two things cannot share a name. So the hues are spread
 * around the wheel first and justified second, and ACHIEVEMENTS takes the one
 * near-neutral in the palette because a trophy case reading as polished metal is
 * a happy accident rather than a compromise.
 */
const NODES = [
  { scene: 'roster', label: 'ROSTER', icon: '🎴', color: PALETTE.pink,
    tip: 'Equip a character, raise star levels with Fan Letters, read their bond.' },
  { scene: 'gacha', label: 'GACHA', icon: '🎰', color: PALETTE.violet,
    tip: 'Banners, pity counters, and the last 100 pulls.' },
  { scene: 'quests', label: 'QUESTS', icon: '📋', color: PALETTE.good,
    tip: 'The reward ladder. Every one pays out the moment you finish it — there is nothing to claim.' },
  { scene: 'shrine', label: 'SHRINE', icon: '⛩', color: PALETTE.ember,
    tip: 'Permanent upgrades bought with gold. The refund is free and always will be — experiment.' },
  { scene: 'achievements', label: 'ACHIEVEMENTS', icon: '🏆', color: PALETTE.ice,
    tip: '40 of them. Some pay Star Fragments, some unlock things no amount of gold can buy.' },
  { scene: 'codex', label: 'CODEX', icon: '📖', color: PALETTE.accent2,
    tip: 'Every enemy, boss, relic and character you have met, with the flavour text they deserve.' },
];

const SETTINGS_NODE = {
  scene: 'settings', label: 'SETTINGS', icon: '⚙', color: '#8e9ab8',
  tip: 'Volume, screen shake, damage numbers, UI scale. ESC or gamepad B lands here from anywhere.',
};

const CURRENCIES = [
  { key: 'gold', icon: '⭐', color: PALETTE.gold },
  { key: 'starFragments', icon: '💎', color: PALETTE.gem },
  { key: 'tickets', icon: '🎟', color: PALETTE.accent2 },
  { key: 'universalLetters', icon: '💌', color: PALETTE.pink },
];

const MOTE_COUNT = 26;

/**
 * The motes' layout stream.
 *
 * This was `Math.random()`, which is banned outright in anything the simulation
 * can observe and merely untidy here — but it also meant the backdrop was
 * different on every boot for no reason anybody asked for. A private stream off
 * a fixed hash gives the home screen the same sky every time, touches neither
 * `runRng` nor `fxRng` (whose call counts are load-bearing elsewhere), and costs
 * one object at module load.
 */
const MOTE_RNG = new Rng(hashString('hub:motes'));

/** Warm, cool, and plain white. Which one a mote gets is decided once, at build. */
const MOTE_COLORS = ['#ffe9c4', '#ffc9e2', '#bfe6ff'];

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
    this._heroKey = '';
    this._nav = false;
    /** Wind-up while PLAY is held, and the kick that fires when it is released. */
    this._charge = 0;
    this._launch = 0;
    this._held = false;
    this._counts = { owned: 0, cleared: 0, shrine: 0, ach: 0, codex: 0, pity: 0,
                     questsDone: 0, questsReady: 0 };
    // A pull on the gacha screen can complete a quest, and the player walks
    // straight back here afterwards — so this is where it has to pay out.
    if (this.manager && this.manager.settleQuests) this.manager.settleQuests();
    this._buildMotes();
    this._buildTotals();
  },

  exit() { this._nav = false; this._charge = 0; this._launch = 0; this._held = false; },

  resize() { this.L = null; },

  clearColor() { return '#080611'; },

  /** Timers only. Everything that reads input happens once per frame, in render. */
  update(dt) {
    this.t += dt;
    // The PLAY button's two motion states. `_held` is written by render (the
    // toolkit only knows what is held while it is drawing it) and integrated
    // here, so the wind-up is a real ramp rather than a per-frame boolean —
    // that one-frame lag is invisible and the alternative is a button that
    // snaps between two poses.
    const chargeTo = this._held ? 1 : 0;
    this._charge += (chargeTo - this._charge) * Math.min(1, dt * (this._held ? 7 : 12));
    if (this._launch > 0) this._launch = Math.max(0, this._launch - dt * 2.6);
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
        x: MOTE_RNG.raw(), y: MOTE_RNG.raw(),
        r: 0.8 + MOTE_RNG.raw() * 2.2,
        spd: 0.006 + MOTE_RNG.raw() * 0.020,
        amp: 0.010 + MOTE_RNG.raw() * 0.030,
        ph: MOTE_RNG.raw() * Math.PI * 2,
        a: 0.06 + MOTE_RNG.raw() * 0.16,
        c: MOTE_COLORS[MOTE_RNG.int(0, MOTE_COLORS.length - 1)],
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

  /**
   * Leave. The rect and the colour go to the toolkit first: sceneManager grows
   * the next screen out of whatever was last marked, and marking it HERE rather
   * than letting the button's own default stand is the difference between the
   * screen wiping in the destination's colour and wiping in a generic indigo.
   */
  _go(node, x, y, w, h) {
    if (this._nav) return;
    this._nav = true;
    ui.markSource(x, y, w, h, node.color);
    this.manager.go(node.scene);
  },

  // --- layout ----------------------------------------------------------------
  /**
   * EVERY DESTINATION IS ON SCREEN AT EVERY SIZE. That is the requirement the
   * old column layout failed: it stacked one fixed-height row per destination
   * into a fixed-height column, so adding a ninth node silently pushed SETTINGS
   * off the bottom. A grid absorbs a new node by shrinking its cells instead.
   *
   * Nothing in here moved during the visual rework, deliberately. The test that
   * guards it reads these exact fields, and a layout change dressed up as a
   * paint change is how a screen loses a button.
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
      // The hero stacks its disc above its wordmark only when it is tall enough
      // to hold both. Below that it lays out sideways, exactly as the narrow
      // layout does — a 240px threshold rather than a `narrow` check, because
      // "is there room" is the actual question and the two are not the same at
      // a 1024x640 window.
      heroStacked: !narrow && heroH >= 240,
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
    // It travels out of the SETTINGS bar even though nothing was clicked, so a
    // keypress and a click arrive at the same screen the same way.
    if (ui.backPressed() && !this._nav) {
      audio.play('uiBack');
      this._go(SETTINGS_NODE, L.gridX, L.settingsY, L.gridW, L.settingsH);
    }

    ui.end();
  },

  /**
   * The look. A vertical gradient, two accent blooms, a fine grid, a slow
   * horizon band and a drift of motes — cached where it can be, arithmetic
   * where it cannot, and allocating NOTHING per frame. The gradient objects are
   * rebuilt only when the viewport changes size, which is the same discipline
   * every other cached surface in this project uses.
   */
  _backdrop(r, L) {
    const c = r.ctx;
    const key = r.w + 'x' + r.h;
    if (this._bgKey !== key) {
      const g = c.createLinearGradient(0, 0, r.w * 0.35, r.h);
      g.addColorStop(0.00, '#33204c');
      g.addColorStop(0.42, '#18102b');
      g.addColorStop(1.00, '#070511');
      this._bgGrad = g;
      const b = c.createRadialGradient(r.w * 0.16, r.h * 0.10, 0,
                                       r.w * 0.16, r.h * 0.10, r.h * 0.9);
      b.addColorStop(0.00, 'rgba(255,95,162,0.22)');
      b.addColorStop(0.45, 'rgba(120,60,200,0.08)');
      b.addColorStop(1.00, 'rgba(0,0,0,0)');
      this._bloom = b;
      // A second, cooler bloom in the opposite corner. One light source reads as
      // a spotlight and flattens everything it does not reach; two give the
      // screen a direction and stop the bottom-right quadrant being a dead grey.
      const b2 = c.createRadialGradient(r.w * 0.92, r.h * 0.96, 0,
                                        r.w * 0.92, r.h * 0.96, r.h * 0.85);
      b2.addColorStop(0.00, 'rgba(106,216,255,0.16)');
      b2.addColorStop(0.50, 'rgba(60,110,200,0.05)');
      b2.addColorStop(1.00, 'rgba(0,0,0,0)');
      this._bloom2 = b2;
      this._bgKey = key;
    }
    r.setAlpha(1);
    c.fillStyle = this._bgGrad; r._fill = '';
    c.fillRect(0, 0, r.w, r.h);
    c.fillStyle = this._bloom; r._fill = '';
    c.fillRect(0, 0, r.w, r.h);
    c.fillStyle = this._bloom2; r._fill = '';
    c.fillRect(0, 0, r.w, r.h);

    // A fine grid, barely there. It reads as a surface rather than as a void.
    const step = Math.round(clamp(r.w / 26, 34, 76));
    for (let x = step; x < r.w; x += step) r.drawRect(x, 0, 1, r.h, '#ffffff', 0.020);
    for (let y = step; y < r.h; y += step) r.drawRect(0, y, r.w, 1, '#ffffff', 0.016);

    // One long diagonal light streak across the upper body.
    r.drawLine(-40, L.headerH + 40, r.w * 0.62, -30, 'rgba(255,215,106,0.055)', 60, 1);

    // A single band drifting down the screen on a 40-second cycle. Slow enough
    // that it is never the thing you are looking at, present enough that the
    // backdrop is not a still image — which is the whole difference between a
    // menu that feels alive and a menu that feels like a screenshot.
    const bandH = Math.max(60, r.h * 0.16);
    const bandY = ((this.t * 0.025) % 1.3 - 0.15) * r.h;
    r.drawRect(0, bandY, r.w, bandH, '#9ab6ff', 0.020);
    r.drawRect(0, bandY, r.w, 1, '#cfe0ff', 0.05);

    for (const m of this.motes) {
      const x = m.x * r.w + Math.sin(this.t * m.spd * 6 + m.ph) * m.amp * r.w;
      const y = ((m.y + this.t * m.spd) % 1.15 - 0.075) * r.h;
      r.drawCircle(x, y, m.r, m.c, m.a);
    }

    r.vignette('rgba(6,4,12,0.9)', 0.42);
  },

  // --- header / footer -------------------------------------------------------
  _header(r, L) {
    const c = save.data.currencies;
    const ty = Math.round(L.titleSize * 0.62) + 12;

    // THE WORDMARK, not a title. `ui.title` would put the game's own name in the
    // same treatment as the word "SETTINGS", which is the exact flatness this
    // rework exists to remove — so the home screen, and only the home screen,
    // gets the gradient display treatment off the boot splash.
    const wmW = ui.wordmark('GACHA SURVIVORS', L.pad, ty, {
      size: L.titleSize / (ui.scale || 1),
    });
    // A hairline in the ramp's own three colours, tucked under the wordmark and
    // exactly as wide as it is. Cheap, and it stops the tagline floating.
    const uy = ty + Math.round(L.titleSize * 0.46);
    const third = wmW / 3;
    r.drawRect(L.pad, uy, third, 2, PALETTE.displayHot, 0.85);
    r.drawRect(L.pad + third, uy, third, 2, PALETTE.displayMid, 0.85);
    r.drawRect(L.pad + third * 2, uy, third, 2, PALETTE.displayCool, 0.85);

    if (!L.twoRow) {
      ui.text('everyone here is technically at work', L.pad + 2, uy + 12, {
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
            { size: 12, color: PALETTE.textFaint, mono: true });
  },

  /**
   * The focused card's tip, on its own reserved line above the footer.
   *
   * Read AFTER every card has been declared, so `ui.focus` is this frame's
   * value rather than last frame's — the previous layout printed it in the
   * header, which is drawn first, and was therefore always one frame stale.
   *
   * The leading pip is drawn in the focused destination's own colour, so the
   * tip line is visibly attached to the card it belongs to rather than being a
   * caption that happens to change.
   */
  _tip(r, L) {
    const all = [HERO].concat(NODES, [SETTINGS_NODE]);
    const n = all[clamp(ui.focus, 0, all.length - 1)];
    if (!n) return;
    r.drawRect(L.pad, L.tipY - 5, 3, 11, n.color, 0.9);
    ui.text(ellipsize(r, n.tip, L.W - L.pad * 2 - 12, 12, 600), L.pad + 10, L.tipY, {
      size: 12, color: PALETTE.textDim,
    });
  },

  // --- cards -----------------------------------------------------------------
  /** The shared plate: glass body, coloured top edge, focus lift and brackets. */
  _plate(r, x, y, w, h, color, focused, tint) {
    const lift = focused ? -3 : 0;
    // A cast shadow under the lifted card. Without one the lift is a two-pixel
    // translation that nobody notices; with one the card is off the surface.
    if (focused) r.drawRoundRect(x + 2, y + 4, w - 4, h, 12, 'rgba(3,2,8,0.55)', 1);
    r.drawRoundRect(x, y + lift, w, h, 12, 'rgba(16,12,28,0.86)', 1);
    if (tint) r.drawRoundRect(x, y + lift, w, h, 12, color, focused ? 0.15 : 0.07);
    // A top edge in the destination's colour, and a soft inner highlight.
    r.drawRect(x + 12, y + lift, w - 24, focused ? 4 : 3, color, focused ? 1 : 0.75);
    r.drawRect(x + 12, y + lift + (focused ? 4 : 3), w - 24, 1, '#ffffff', 0.10);
    r.strokeRect(x, y + lift, w, h, focused ? PALETTE.borderHot : 'rgba(150,170,225,0.22)',
                 focused ? 1.75 : 1.5, 1);
    if (focused) {
      // A wash of the card's own colour, breathing. 0.29Hz — an order of
      // magnitude under the 3Hz accessibility floor in core/feel.js, so this is
      // one of the few animations in the game that needs no reduceFlashing gate.
      const glow = 0.5 + 0.5 * Math.sin(this.t * 1.8);
      r.drawRoundRect(x, y + lift, w, h, 12, color, 0.05 + glow * 0.05);
      ui.brackets(x, y + lift, w, h, PALETTE.borderHot, Math.min(22, w * 0.16), 2);
    }
    return lift;
  },

  _iconPlate(r, x, y, size, icon, color, focused) {
    r.drawRoundRect(x, y, size, size, 10, color, focused ? 0.24 : 0.13);
    r.strokeRect(x, y, size, size, color, 1.5, focused ? 0.95 : 0.45);
    ui.text(icon, x + size / 2, y + size / 2, {
      size: size * 0.52, align: 'center', baseline: 'middle',
    });
  },

  _bar(r, x, y, w, frac, color) {
    r.drawRoundRect(x, y, w, 5, 2.5, 'rgba(4,6,14,0.75)', 1);
    const f = clamp(frac, 0, 1);
    if (f > 0.001) {
      r.drawRoundRect(x, y, w * f, 5, 2.5, color, 1);
      // A specular along the top of the fill. Flat bars read as painted-on;
      // this is the same two-rect bevel ui.bar() uses, at bar-chart scale.
      r.drawRect(x + 2, y + 1, Math.max(0, w * f - 4), 1, '#ffffff', 0.30);
    }
  },

  /**
   * PLAY.
   *
   * Deliberately the largest object on the screen: it is what the home screen
   * is FOR, and presenting it as one tile among eight was the previous layout's
   * other mistake. It is now also the only object with any real depth on it,
   * which is the second half of the same argument — being biggest is not the
   * same as being most interesting, and a big flat rectangle is still flat.
   *
   * Five things carry it and each one answers a different question:
   *   · a gradient body and a cast shadow           — is this a surface?
   *   · a specular sweep crossing it on a loop      — is this screen alive?
   *   · an ignition disc, spinning, with a bloom    — where do I look?
   *   · a charge ring that winds up while held      — did my press register?
   *   · a shock ring on release                     — did it FIRE?
   *
   * It is still a `ui.button` with `invisible: true`, so it is focus stop zero
   * and Enter, gamepad A, and a click all reach it exactly as they did before.
   * `focusRing: false` because the art below draws a far better focus state
   * than a yellow rectangle three pixels outside the card.
   */
  _heroCard(r, L) {
    const n = HERO;
    const x = L.heroX, y = L.heroY, w = L.heroW, h = L.heroH;
    const idx = ui.itemCount;
    const focused = ui.focus === idx;
    const hit = ui.button(n.scene, x, y, w, h, null, { invisible: true, focusRing: false });
    this._held = ui.heldId === n.scene;

    // A press SINKS the whole card. Everything below is laid out against `yy`,
    // so the sink costs one number rather than an offset on twenty draw calls.
    const press = this._charge;
    const lift = (focused ? -4 : 0) + press * 5;
    const yy = y + lift;
    const stacked = L.heroStacked;

    // --- body ----------------------------------------------------------------
    // Keyed on the LAYOUT, not on `yy`. The card moves by a few pixels when it
    // takes focus and again while it is held, and keying the gradient on where
    // it currently sits meant rebuilding a CanvasGradient on every frame of the
    // press — an allocation per frame, in the one path that most needs not to
    // have one. A gradient anchored four pixels off across a 900px card is not
    // a thing anybody can see.
    if (this._heroKey !== L.key) {
      const g = r.ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
      g.addColorStop(0.00, 'rgba(58,40,26,0.94)');
      g.addColorStop(0.38, 'rgba(28,20,42,0.92)');
      g.addColorStop(1.00, 'rgba(13,10,24,0.94)');
      this._heroGrad = g;
      this._heroKey = L.key;
    }
    r.drawRoundRect(x + 3, yy + 7, w - 6, h, 16, 'rgba(3,2,8,0.6)', 1);
    r.drawRoundRect(x, yy, w, h, 16, 'rgba(10,8,20,1)', 1);
    r.ctx.fillStyle = this._heroGrad; r._fill = '';
    r.setAlpha(1);
    // The gradient is painted through the same rounded path the plate uses, so
    // it cannot square off the corners the shadow just established.
    this._roundPath(r, x, yy, w, h, 16);
    r.ctx.fill();
    r._fill = '';

    // The specular sweep. Clipped to the card, two lines, one modulo — and it
    // is the single cheapest thing on this screen that makes it look expensive.
    r.clipRect(x, yy, w, h);
    const sweep = ((this.t * 0.28) % 1.6) - 0.3;
    const sx = x - h * 0.6 + sweep * (w + h * 1.2);
    r.drawLine(sx, yy + h + 20, sx + h * 0.55, yy - 20, '#ffffff', Math.max(18, w * 0.10), 0.045);
    r.drawLine(sx + h * 0.18, yy + h + 20, sx + h * 0.73, yy - 20, '#ffe9c4', 3, 0.16);
    r.unclip();

    // THE FOCUS TREATMENT, AT A THIRD OF THE WEIGHT IT SHIPPED WITH.
    //
    // Verbatim from a player: "yellow box around play button is extremely thick
    // when hovering over it". It was — a 3px gold rule around the whole card
    // plus four 4px brackets thirty pixels long at the corners, on the largest
    // object on the screen, all of it in the same #ffd76a as the card's own top
    // edge. Together they read as one continuous eight-pixel gold frame, which
    // is not a focus state, it is a highlighter.
    //
    // What actually communicates focus here was never the outline: the card
    // lifts, casts a shadow, brightens its top edge, and the ignition disc spins
    // up and blooms. The rule only has to say "this one" — so it is 2px, the
    // brackets are 2px and shorter, and every other cue is untouched.
    r.drawRect(x + 14, yy, w - 28, focused ? 5 : 4, n.color, focused ? 1 : 0.85);
    r.drawRect(x + 14, yy + (focused ? 5 : 4), w - 28, 1, '#ffffff', 0.14);
    r.strokeRect(x, yy, w, h, focused ? PALETTE.borderHot : 'rgba(255,215,106,0.35)',
                 focused ? 2 : 1.5, 1);
    if (focused) ui.brackets(x, yy, w, h, PALETTE.borderHot, Math.min(24, w * 0.11), 2);

    // --- the ignition disc ---------------------------------------------------
    const discR = Math.round(clamp(Math.min(w, h) * (stacked ? 0.24 : 0.34), 24, 84));
    const dcx = stacked ? x + w / 2 : x + Math.round(26 * L.S) + discR;
    const dcy = stacked ? yy + h * 0.30 : yy + h / 2;
    this._ignition(r, dcx, dcy, discR, focused, press);

    // --- type ----------------------------------------------------------------
    const textX = stacked ? x + w / 2 : dcx + discR + Math.round(18 * L.S);
    const align = stacked ? 'center' : 'left';
    const tw = stacked ? (w - 34) : Math.max(40, x + w - textX - 18);

    const playCap = Math.round(clamp(h * (stacked ? 0.11 : 0.20), 24, 46));
    const playSize = fitSize(r, 'PLAY', tw, playCap, 800);
    const playY = stacked ? yy + h * 0.60 : yy + h * 0.34;
    ui.title('PLAY', textX, playY, {
      size: playSize, align, weight: 800,
      color: focused ? PALETTE.text : '#e6ddf2',
    });
    ui.text(n.label, textX, playY + Math.round(playSize * 0.72 * L.S), {
      size: 12, color: focused ? PALETTE.accent : PALETTE.textFaint,
      align, weight: 800, mono: true, baseline: 'middle',
    });

    // --- progress ------------------------------------------------------------
    // Kept verbatim from the old hero: the stage-progress line and its bar are
    // the only information this button carries and losing them to a redesign
    // would be a straight downgrade.
    const sub = this._sub(n);
    const frac = this._frac(n);
    const barW = Math.min(tw, Math.round(clamp(w * 0.62, 120, 300)));
    const barX = stacked ? x + w / 2 - barW / 2 : textX;
    const barY = yy + h - Math.round(clamp(20 * L.S, 16, 30));
    ui.text(ellipsize(r, sub, tw, 12, 700), stacked ? x + w / 2 : textX,
            barY - Math.round(14 * L.S), {
      size: 12, color: PALETTE.textDim, align, weight: 700,
    });
    if (frac >= 0) this._bar(r, barX, barY, barW, frac, n.color);

    if (hit) {
      this._launch = 1;
      this._go(n, x, yy, w, h);
    }
  },

  /** A rounded-rect path, left open for the caller to fill or clip. */
  _roundPath(r, x, y, w, h, rad) {
    const c = r.ctx;
    const rr = Math.min(rad, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  },

  /**
   * The disc at the heart of the PLAY button.
   *
   * Three rings at three speeds, because one ring rotating is a loading spinner
   * and three at different rates is a machine. The tick ring is drawn as eight
   * arc segments rather than a dashed stroke: `setLineDash` is context state
   * this renderer does not track, and leaving it set leaks a dashed stroke into
   * whatever draws next.
   *
   * Nothing in here oscillates above 1Hz, so none of it trips the reduceFlashing
   * floor — the brightness varies, the FREQUENCY never does.
   */
  _ignition(r, cx, cy, rad, focused, press) {
    const t = this.t;
    const breathe = 0.5 + 0.5 * Math.sin(t * 2.1);
    const hot = focused ? 1 : 0.45;

    // Bloom. Grows a little on focus and a lot on the launch kick.
    const kick = this._launch * this._launch;
    r.drawCircle(cx, cy, rad * (1.5 + breathe * 0.12 + kick * 0.9), HERO.color,
                 0.05 + breathe * 0.03 * hot + kick * 0.10);

    // The shock ring: fires outward on release and is gone in under half a
    // second, which is roughly how long the outgoing transition takes to cover
    // the button — so the two read as one continuous event.
    if (this._launch > 0.001) {
      const s = 1 - this._launch;
      r.strokeCircle(cx, cy, rad * (1 + s * 2.4), '#ffffff', 3 * this._launch,
                     this._launch * 0.55);
      r.strokeCircle(cx, cy, rad * (1 + s * 1.7), HERO.color, 5 * this._launch,
                     this._launch * 0.4);
    }

    // Ring one: eight ticks, rotating slowly.
    const spin = t * (focused ? 1.05 : 0.55) + press * 3;
    for (let i = 0; i < 8; i++) {
      const a0 = spin + (i / 8) * TAU;
      r.drawArc(cx, cy, rad * 1.26, a0, a0 + 0.20, HERO.color, 2.5, 0.25 + hot * 0.45);
    }
    // Ring two: a thin counter-rotating hairline with one long segment, so the
    // eye has something to track around the circle.
    const spin2 = -t * 0.9;
    r.drawArc(cx, cy, rad * 1.11, spin2, spin2 + 1.5, '#ffffff', 1.5, 0.12 + hot * 0.16);

    // Ring three: the charge. Empty at rest, full while held.
    if (press > 0.002) {
      r.drawArc(cx, cy, rad * 1.11, -Math.PI / 2, -Math.PI / 2 + TAU * press,
                '#ffffff', 4, 0.55 + press * 0.35);
    }

    // Core. Compresses under the press, which is the entire reason the button
    // feels like it has a spring in it.
    const core = rad * (1 - press * 0.14);
    r.drawCircle(cx, cy, core, 'rgba(12,9,22,0.95)', 1);
    r.drawCircle(cx, cy, core, HERO.color, 0.16 + breathe * 0.06 * hot + press * 0.25);
    r.strokeCircle(cx, cy, core, HERO.color, focused ? 3 : 2, 0.55 + hot * 0.45);

    ui.text(HERO.icon, cx + core * 0.06, cy, {
      size: core * 0.86 / (ui.scale || 1), align: 'center', baseline: 'middle',
      color: focused ? '#fff6dc' : '#f0e4c6',
    });
  },

  /**
   * A destination card, in one of TWO arrangements.
   *
   * The grid hands these whatever cell size falls out of the viewport, and the
   * range is enormous: 456x420 at 1920x1080, and 375x70 at 800x600 with the UI
   * scale at 1.4. The old card had one arrangement — icon at the top, then the
   * label, then the subtitle, then a bar pinned to the bottom — and it was
   * wrong at both ends of that range. On the tall cell the entire contents sat
   * in the top third with 290 pixels of nothing under it; on the short cell the
   * label's baseline was computed at `pad + plate + h*0.10`, which is BELOW the
   * bottom edge of a 70px card, so the text simply rendered outside the card
   * and over whatever was beneath. Nothing caught it: the visibility test checks
   * where the RECTS are, and both failures are about where the text is.
   *
   * So the card measures itself. If the stacked poster arrangement fits, it
   * uses it and anchors the type to the BOTTOM of the cell, so a tall card is a
   * poster rather than a small card with a lot of air below it. If it does not
   * fit, the card lays out as a row — icon, then type beside it, bar as a rule
   * along the bottom edge — which is the same shape the SETTINGS bar uses and
   * degrades all the way down to a 40px cell.
   */
  _card(r, L, n, x, y, w, h) {
    const idx = ui.itemCount;
    const focused = ui.focus === idx;
    const hit = ui.button(n.scene, x, y, w, h, null, { invisible: true, focusRing: false });

    const lift = this._plate(r, x, y, w, h, n.color, focused, false);
    const yy = y + lift;
    const frac = this._frac(n);
    const sub = this._sub(n);

    // The type block's own height, in drawn pixels: label, rule, subtitle.
    const blockH = Math.round(46 * L.S);
    const pad = Math.round(clamp(Math.min(w * 0.09, h * 0.22), 10, 24));
    const plate = Math.round(clamp(Math.min(w * 0.30, h * 0.34), 28, 66));
    const stacked = h >= pad * 2 + plate + blockH + Math.round(16 * L.S);

    let iconX, iconY, iconS, textX, tw, labelY;
    if (stacked) {
      iconS = plate;
      iconX = x + pad; iconY = yy + pad;
      textX = x + pad; tw = w - pad * 2;
      // Anchored up from the bar, not down from the icon.
      labelY = yy + h - Math.round(18 * L.S) - blockH;
    } else {
      iconS = Math.round(clamp(h - pad * 2, 20, 52));
      iconX = x + pad; iconY = yy + (h - iconS) / 2;
      textX = iconX + iconS + Math.round(10 * L.S);
      tw = Math.max(30, x + w - textX - pad);
      labelY = yy + h / 2 - Math.round(11 * L.S);
    }

    this._iconPlate(r, iconX, iconY, iconS, n.icon, n.color, focused);

    const badge = this._badge(n);
    if (badge) {
      const br = Math.round(clamp(13 * L.S, 9, 15));
      const bx = x + w - pad - br, by = yy + Math.max(pad, br + 2);
      const bp = 0.6 + 0.4 * Math.sin(this.t * 4);
      r.drawCircle(bx, by, br, PALETTE.good, 0.85 + bp * 0.15);
      ui.text(badge, bx, by + 1, {
        size: 13, color: '#06210f', align: 'center', baseline: 'middle', weight: 800,
      });
    }

    // The label is the ONLY thing on a card set in the display face. That is
    // what makes a card scannable at a glance: one condensed heavy word per
    // tile, and everything else deferring to it in the UI face.
    const labelCap = stacked ? 18 : Math.round(clamp(h * 0.24, 11, 16));
    const labelSize = fitSize(r, n.label, tw, labelCap, 800);
    ui.text(ellipsize(r, n.label, tw, labelSize, 800), textX, labelY, {
      size: labelSize, display: true, weight: 800,
      color: focused ? PALETTE.text : '#dbe3f6',
    });
    // A short rule under the label in the card's colour — the cheapest possible
    // way to attach the name to the identity, and it grows on focus.
    r.drawRect(textX, labelY + Math.round(labelSize * 0.62 * L.S),
               Math.min(tw, focused ? 44 : 22), 2, n.color, focused ? 1 : 0.6);
    ui.text(ellipsize(r, sub, tw, 12, 600), textX, labelY + Math.round(22 * L.S), {
      size: 12, color: PALETTE.textFaint,
    });

    if (frac >= 0) {
      if (stacked) {
        this._bar(r, x + pad, yy + h - Math.round(18 * L.S), w - pad * 2, frac, n.color);
      } else {
        // No room for a real bar, so the card's bottom edge becomes one.
        r.drawRect(x + 3, yy + h - 5, (w - 6) * clamp(frac, 0, 1), 3, n.color, 0.95);
      }
    }

    if (focused) {
      // The chevron slides out a couple of pixels on a slow sine. It is the
      // only "go this way" cue on the card and a static one is furniture.
      const nudge = 2 + 2 * Math.sin(this.t * 2.6);
      const cy = stacked ? yy + h - Math.round(32 * L.S) : yy + h / 2;
      ui.text('›', x + w - Math.round(pad * 0.6) + nudge, cy, {
        size: 18, color: n.color, align: 'right', weight: 800, display: true,
      });
    }

    if (hit) this._go(n, x, yy, w, h);
  },

  /** SETTINGS gets a full-width bar rather than a tile: it is not a destination
   *  you browse, it is one you go to on purpose. */
  _settingsBar(r, L) {
    const n = SETTINGS_NODE;
    const x = L.gridX, y = L.settingsY, w = L.gridW, h = L.settingsH;
    const idx = ui.itemCount;
    const focused = ui.focus === idx;
    const hit = ui.button(n.scene, x, y, w, h, null, { invisible: true, focusRing: false });

    const lift = focused ? -3 : 0;
    const yy = y + lift;
    if (focused) r.drawRoundRect(x + 2, y + 4, w - 4, h, 10, 'rgba(3,2,8,0.5)', 1);
    r.drawRoundRect(x, yy, w, h, 10, 'rgba(16,12,28,0.78)', 1);
    r.strokeRect(x, yy, w, h, focused ? PALETTE.borderHot : 'rgba(150,170,225,0.18)',
                 focused ? 1.75 : 1.5, 1);
    r.drawRect(x, yy + 8, 3, h - 16, n.color, focused ? 1 : 0.6);
    if (focused) ui.brackets(x, yy, w, h, PALETTE.borderHot, Math.min(20, w * 0.06), 2);

    ui.text(n.icon, x + Math.round(28 * L.S), yy + h / 2, {
      size: Math.round(clamp(h * 0.42, 16, 26)), align: 'center', baseline: 'middle',
    });
    ui.text(n.label, x + Math.round(52 * L.S), yy + h / 2, {
      size: 16, color: focused ? PALETTE.text : PALETTE.textDim,
      weight: 800, baseline: 'middle', display: true,
    });
    ui.text('ESC', x + w - 16, yy + h / 2, {
      size: 11, color: PALETTE.textFaint, align: 'right', baseline: 'middle',
      weight: 800, mono: true,
    });

    if (hit) this._go(n, x, yy, w, h);
  },
};
