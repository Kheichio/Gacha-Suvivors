// THE GACHA SCREEN — banner select + the pull animation.
//
// SECTION 6, lines 998-1006: "PULL PRESENTATION (do not skimp here — the pull
// animation IS the reward)". Everything below the banner list exists to serve
// that one sentence.
//
// WHAT THIS FILE DOES NOT DO: roll anything. `src/game/gachaEngine.js` owns the
// pull logic, spends the currency, resolves pity and PERSISTS before it returns
// (anti-save-scum, SECTION 6). This scene calls it once and then spends four
// seconds being theatrical about a result that is already written to disk.
// A result is NEVER re-rolled, re-ordered or "fixed up" here.
//
// THE ONE EXCEPTION — the relic banner. `banner_relic.pool` carries a `relics`
// array and no {3,4,5,6} keys, so `GachaEngine.rollOne()` walks off the end of
// `banner.pool[3][0]` and throws — AFTER `pull()` has already spent the
// currency. So relic pulls are transacted here instead, following the same
// contract to the letter: check, spend, roll on metaRng, mutate, PERSIST, and
// only then return something to animate. See `_pullRelics`.
//
// DECISIONS.md §9 is load-bearing for the copy: banking a relic does NOT unlock
// it. Every relic always drops in runs. The banner sells a permanent 3x drop
// weight. The UI says exactly that and never implies otherwise.

import { ui, PALETTE, RARITY_COLOR, RARITY_NAME, wrapText, formatCount } from '../ui/widgets.js';
import { input } from '../core/input.js';
import { save, spendCurrency } from '../core/save.js';
import { audio } from '../core/audio.js';
import { displayName } from '../core/config.js';
import { events, EV } from '../core/events.js';
import { metaRng, fxRng } from '../core/rng.js';
import { shake, flash } from '../render/screenShake.js';
import { particles } from '../render/particles.js';
import { clamp, easeOutCubic, easeOutBack, TAU } from '../core/math.js';

// -----------------------------------------------------------------------------
// COPY & CONSTANTS
// -----------------------------------------------------------------------------

const TYPE_LABEL = {
  standard: 'STANDARD',
  rateup: 'RATE-UP',
  beginner: 'ONE TIME',
  relic: 'SIGNATURE GEAR',
};

const TYPE_BLURB = {
  standard: 'Everyone who is not a ★6.',
  rateup: 'The only place ★6 exist.',
  beginner: 'One banner. One ten-pull. One guaranteed ★5.',
  relic: 'Buys drop weight. Never buys access.',
};

/** Relic rarities are words; the reveal needs a tier. rare/epic/legendary map
 *  onto the ★4/★5/★6 presentation so Signature Gear gets a real beam too. */
const RELIC_TIER = { rare: 4, epic: 5, legendary: 6 };
const RELIC_TIER_NAME = { rare: 'RARE', epic: 'EPIC', legendary: 'LEGEND' };

/** SECTION 18: "a consolation gift, and a very funny toast". Short — the toast
 *  panel is 360px wide and one line tall, so a paragraph would be a rectangle. */
const LOST_5050_TOASTS = [
  'The other fifty. It happens to everyone.',
  'Coin flipped. Coin lied. Coin has no manager.',
  'That was the 50. The 50 remains undefeated.',
  'Not her. YET. The next ★6 is in writing.',
  'You have been selected for the control group.',
];

/**
 * The ★6 rainbow, as SIX FIXED HEX COLOURS rather than a swept hsl().
 *
 * This matters: `particles.spriteFor()` keys the sprite atlas on the colour
 * STRING and rasterises a new sprite for every miss, and `shade()` behind it
 * only parses '#rrggbb'. Handing it a swept `hsl(...)` would register a fresh
 * sprite every frame AND paint every one of them black. Direct renderer calls
 * (drawCircle/drawBeam) take any CSS colour and keep the smooth sweep.
 */
const RAINBOW = ['#ff5f6d', '#ffb347', '#ffe66d', '#7bf59a', '#6ad8ff', '#c58cff'];

/** Seconds a NEW-character splash holds before it advances itself. */
const SPLASH_TIME = 3.0;
/** Dead input at the top of a splash, so a mash during reveals cannot eat it. */
const SPLASH_LOCK = 0.25;
/** Dead input on the summary, so a mash cannot spend another 135💎 by accident. */
const SUMMARY_LOCK = 0.45;

const HISTORY_ROW_H = 26;

// -----------------------------------------------------------------------------

export const gachaScene = {
  manager: null,

  // ---------------------------------------------------------------------------
  // LIFECYCLE
  // ---------------------------------------------------------------------------
  enter(params, mgr) {
    this.mgr = mgr || this.manager;
    this.G = this.mgr.data.gacha;
    this.PP = this.G.PULL_PRESENTATION;
    this.C = this.mgr.data.characters.CHARACTERS_BY_ID;
    this.R = this.mgr.data.relics.RELICS_BY_ID;
    this.ACH = this.mgr.data.achievements.ACHIEVEMENTS_BY_ID;

    // Cached in enter(), never rebuilt in render(). SECTION 13 acceptance #7.
    this.banners = this.G.BANNERS.slice();

    this.view = 'select';
    this.time = 0;
    this.w = 0; this.h = 0;
    this.listState = { scroll: 0 };
    this.p = null;
    this._emitAcc = 0;
    this.bannerIndex = 0;
    this.detailScroll = 0;
    this._detailMax = 0;

    this._refresh();

    if (params && params.banner) {
      const i = this.banners.findIndex((b) => b.id === params.banner);
      if (i >= 0) this.bannerIndex = i;
    } else {
      // Default to the first banner that is actually playable and in rotation.
      const i = this.banners.findIndex((b) => b.inRotation && !this._lockReason(b));
      if (i >= 0) this.bannerIndex = i;
    }
  },

  exit() {
    this.p = null;
    this.view = 'select';
  },

  resize(w, h) { this.w = w; this.h = h; },

  clearColor() {
    // The held beat before a ★6 drops the room to almost nothing. The pause is
    // the whole trick; the darkness is how the player knows it is coming.
    if (this.view === 'pull' && this.p && this.p.state === 'hold') return '#010109';
    return '#05060d';
  },

  /** Recompute everything cached off the save blob. Called on enter + each pull. */
  _refresh() {
    const h = save.data.gacha.history;
    this.history = [];
    for (let i = h.length - 1; i >= 0; i--) this.history.push(h[i]);
    this.fivePlus = 0;
    for (let i = 0; i < this.history.length; i++) {
      if ((this.history[i].rarity || 0) >= 5) this.fivePlus++;
    }
    const relicBanner = this.banners.find((b) => b.type === 'relic');
    this.unbankedCount = relicBanner ? this._unbanked(relicBanner).length : 0;
    this.relicTotal = relicBanner && relicBanner.pool.relics ? relicBanner.pool.relics.length : 0;
  },

  get banner() { return this.banners[clamp(this.bannerIndex, 0, this.banners.length - 1)]; },

  // ---------------------------------------------------------------------------
  // GATES
  // ---------------------------------------------------------------------------

  /** Relic ids on the banner that are not banked yet. */
  _unbanked(b) {
    const ids = (b.pool && b.pool.relics) || [];
    const out = [];
    for (let i = 0; i < ids.length; i++) {
      const s = save.data.relics[ids[i]];
      if (!s || !s.banked) out.push(ids[i]);
    }
    return out;
  },

  /**
   * `banner.unlockedBy` holds an ACHIEVEMENT id ('reach_level_60'), while the
   * achievement's reward writes `save.data.unlocks.relicBanner`. Both spellings
   * are accepted so the gate opens the moment the player earns it either way.
   */
  _isUnlocked(b) {
    if (!b.unlockedBy) return true;
    const u = save.data.unlocks || {};
    if (u[b.unlockedBy]) return true;
    if (b.type === 'relic' && u.relicBanner) return true;
    const ach = this.mgr.achievements;
    return !!(ach && ach.isUnlocked && ach.isUnlocked(b.unlockedBy));
  },

  /** Human reason this banner cannot be pulled, or null. Always specific. */
  _lockReason(b) {
    if (b.oneTime && save.data.gacha.beginnerUsed) {
      return 'Already claimed. First impressions only happen once.';
    }
    if (b.unlockedBy && !this._isUnlocked(b)) {
      const a = this.ACH && this.ACH[b.unlockedBy];
      return a ? ('LOCKED — ' + a.desc) : 'LOCKED — not yet earned.';
    }
    if (b.type === 'relic' && this.unbankedCount <= 0 && this.relicTotal > 0) {
      return 'All ' + this.relicTotal + ' banked. This banner has nothing left to sell.';
    }
    return null;
  },

  /** The engine is the authority on price — including the beginner discount. */
  _cost(b, n) { return this.mgr.gacha.cost(b, n); },

  _currencyOf(b) { return b.currency || this.G.COST.currency; },

  _have(b) { return save.data.currencies[this._currencyOf(b)] || 0; },

  _rates(b) {
    const g = this.mgr.gacha;
    // Ask the engine what it will actually roll rather than reprinting the
    // table — DECISIONS.md §8 normalisation must never drift from the copy.
    if (typeof g._effectiveRates === 'function') return g._effectiveRates(b);
    return this.G.BASE_RATES;
  },

  // ---------------------------------------------------------------------------
  // PULLING
  // ---------------------------------------------------------------------------

  _startPull(b, count) {
    const lock = this._lockReason(b);
    if (lock) { audio.play('uiBack'); this.mgr.toast(lock, PALETTE.bad, '🔒'); return; }

    const cost = this._cost(b, count);
    const have = this._have(b);
    if (have < cost) {
      audio.play('uiBack');
      this.mgr.toast('Need ' + cost + '💎, you have ' + have + '.', PALETTE.bad, '💎');
      this.mgr.toast('A finished run pays about 38💎. Go be amazing.', PALETTE.accent2, '⚔');
      return;
    }
    if (b.type === 'relic' && this.unbankedCount < count) {
      audio.play('uiBack');
      this.mgr.toast('Only ' + this.unbankedCount + ' left to bank. Singles only.', PALETTE.bad, '🎒');
      return;
    }

    const res = (b.type === 'relic')
      ? this._pullRelics(b, count)
      : this.mgr.gacha.pull(b, count);

    if (res.error || !res.results || res.results.length === 0) {
      audio.play('uiBack');
      this.mgr.toast(res.error || 'That pull produced nothing. Refunded by refusing to happen.', PALETTE.bad, '⚠');
      return;
    }

    // Everything below is presentation. The save is already on disk.
    this._refresh();

    let highest = 3;
    let letters = 0;
    let news = 0;
    for (const r of res.results) {
      if (r.rarity > highest) highest = r.rarity;
      letters += r.letters || 0;
      if (r.isNew) news++;
    }

    this.p = {
      banner: b,
      count: res.results.length,
      results: res.results,
      cost: res.cost,
      highest,
      letters,
      news,
      state: 'charge',
      t: 0,
      revealIndex: 0,
      revealed: new Array(res.results.length).fill(false),
      revealAt: new Array(res.results.length).fill(0),
      cardPos: new Array(res.results.length).fill(null),
      splashIndex: -1,
      splashT: 0,
      inputLock: 0,
      rainbow: this.PP.beamColor[highest] === 'rainbow',
    };
    this.view = 'pull';
    this._emitAcc = 0;
    audio.play(this.PP.sfx.charge);

    if (res.lost5050) {
      // SECTION 18 wants this to land as a joke and a promise, in that order.
      this.mgr.toast(fxRng.pick(LOST_5050_TOASTS), PALETTE.pink, '🪙');
      this.mgr.toast('NEXT ★6 GUARANTEED FEATURED', PALETTE.gold, '🔒');
    }
  },

  /**
   * The relic banner transaction. Mirrors GachaEngine.pull()'s contract exactly:
   * validate, spend, roll on the persisted meta stream, mutate, then save BEFORE
   * returning anything the player can see.
   *
   * `preferUnbanked` (data/gacha.js) means there are no dud pulls, so this draws
   * without replacement from the not-yet-banked set and the caller has already
   * refused a 10-pull that could not be filled.
   */
  _pullRelics(b, count) {
    const cost = this._cost(b, count);
    const currency = this._currencyOf(b);
    const pool = this._unbanked(b);
    if (pool.length < count) {
      return { results: [], cost, error: 'Only ' + pool.length + ' relics left to bank.' };
    }
    if (!spendCurrency(currency, cost)) {
      return { results: [], cost, error: 'Need ' + cost + '💎, you have ' + this._have(b) + '.' };
    }

    const results = [];
    for (let i = 0; i < count; i++) {
      const j = metaRng.int(0, pool.length - 1);
      const id = pool.splice(j, 1)[0];
      const rel = this.R[id];
      // DECISIONS.md §9 — `banked` is the 3x drop-weight flag run.js reads. It
      // does not unlock anything; the relic was already in the drop pool.
      save.data.relics[id] = { owned: true, banked: true, guaranteedNextRun: true };
      results.push({
        kind: 'relic',
        id,
        rarity: (rel && RELIC_TIER[rel.rarity]) || 4,
        isNew: true,
        letters: 0,
        featured: false,
      });
    }

    save.data.gacha.totalPulls += count;
    const hist = save.data.gacha.history;
    for (const r of results) {
      // rarity 0 keeps gear out of the "★5+ in the last 100" count; `kind`
      // tells the history row which table to look the id up in.
      hist.push({ id: r.id, rarity: 0, banner: b.id, isNew: true, kind: 'relic' });
    }
    while (hist.length > this.G.PULL_HISTORY_MAX) hist.shift();

    events.emit(EV.GACHA_PULL, results, b);
    save.save();          // persist BEFORE the reveal. Same rule as the engine.
    return { results, cost };
  },

  // ---------------------------------------------------------------------------
  // THE PULL STATE MACHINE
  // ---------------------------------------------------------------------------

  update(dt) {
    this.time += dt;
    if (this.view !== 'pull' || !this.p) return;
    const p = this.p;
    p.t += dt;
    if (p.inputLock > 0) p.inputLock -= dt;

    switch (p.state) {
      case 'charge':
        this._emitCharge(dt);
        if (p.t >= this.PP.chargeTime) {
          if (p.highest >= 6) {
            // A HELD BEAT OF SILENCE. Nothing moves, nothing sounds, and the
            // player already knows.
            p.state = 'hold'; p.t = 0;
          } else {
            this._burst();
          }
        }
        break;

      case 'hold':
        if (p.t >= (this.PP.holdBeat[6] || 0.9)) this._burst();
        break;

      case 'burst':
        if (p.t >= 0.28) { p.state = 'reveal'; p.t = 999; }
        break;

      case 'reveal':
        if (p.revealIndex >= p.results.length) { this._toSummary(); break; }
        if (p.t >= (p.count > 1 ? this.PP.revealInterval : 0)) this._revealNext();
        break;

      case 'splash':
        p.splashT += dt;
        if (p.splashT >= SPLASH_TIME) this._endSplash();
        break;

      default: break;
    }
  },

  _emitCharge(dt) {
    if (!this.w || !this.h) return;
    const p = this.p;
    const cx = this.w * 0.5, cy = this.h * 0.46;
    const col = this._beamParticleColor();
    this._emitAcc += dt;
    const step = 1 / 45;
    while (this._emitAcc >= step) {
      this._emitAcc -= step;
      // Motes fall INWARD toward the rift. Convergence reads as "charging"
      // where a normal outward burst reads as "already happened".
      const a = fxRng.angle();
      const d = 200 + fxRng.raw() * 260;
      const sp = 260 + fxRng.raw() * 320 + p.t * 200;
      particles.emit(cx + Math.cos(a) * d, cy + Math.sin(a) * d,
        -Math.cos(a) * sp, -Math.sin(a) * sp,
        { color: col, life: 0.55, size: 0.35 + fxRng.raw() * 0.3, sizeEnd: 0.02, drag: 0.4, additive: true });
    }
  },

  _burst() {
    const p = this.p;
    p.state = 'burst';
    p.t = 0;
    const col = this._beamParticleColor();
    audio.play(this.PP.sfx[p.highest] || this.PP.sfx[3]);
    const mult = this.PP.shake[p.highest];
    if (mult) shake.add(mult);
    flash.fire(p.highest >= 6 ? '#ffffff' : col, p.highest >= 5 ? 0.85 : 0.4, 5);
    if (this.w && this.h) {
      const cx = this.w * 0.5, cy = this.h * 0.46;
      if (p.highest >= 6) {
        // Six rings, one per rainbow band, so the ★6 burst is actually a rainbow
        // and not one arbitrary frame of the sweep.
        for (let i = 0; i < RAINBOW.length; i++) {
          particles.ring(cx, cy, 12, RAINBOW[i], 420 + i * 70, { life: 0.75, size: 0.9 });
        }
      } else {
        particles.ring(cx, cy, p.highest >= 5 ? 40 : 22, col, p.highest >= 5 ? 620 : 380, { life: 0.7, size: 0.9 });
      }
      particles.burst(cx, cy, p.highest >= 5 ? 46 : 24, col, { speed: 420, life: 0.8, size: 0.7, additive: true });
    }
  },

  _revealNext() {
    const p = this.p;
    const i = p.revealIndex;
    if (i >= p.results.length) { this._toSummary(); return; }
    const res = p.results[i];
    p.revealed[i] = true;
    p.revealAt[i] = this.time;
    p.revealIndex = i + 1;
    p.t = 0;

    // For a single pull the burst WAS the reveal; do not fire the cue twice.
    if (p.count > 1) audio.play(this.PP.sfx[res.rarity] || this.PP.sfx[3]);

    const pos = p.cardPos[i];
    if (res.rarity >= 5) {
      const mult = this.PP.shake[res.rarity];
      if (mult && p.count > 1) shake.add(mult * 0.4);
      if (pos) {
        particles.ring(pos.x + pos.w / 2, pos.y + pos.h / 2, 18,
          RARITY_COLOR[res.rarity], 240, { life: 0.5, size: 0.6 });
      }
    }
    if (res.isNew) {
      p.splashIndex = i;
      p.splashT = 0;
      p.state = 'splash';
    }
  },

  _endSplash() {
    const p = this.p;
    p.splashIndex = -1;
    p.state = 'reveal';
    p.t = 999;
  },

  _toSummary() {
    const p = this.p;
    if (p.state === 'summary') return;
    p.state = 'summary';
    p.splashIndex = -1;
    p.inputLock = SUMMARY_LOCK;
  },

  /**
   * SECTION 6: "Rarity reveal must be SKIPPABLE from the first frame. Respect
   * the player." Instant, from any state, no confirmation, nothing lost.
   */
  _skip() {
    const p = this.p;
    if (!p || p.state === 'summary') return;
    for (let i = 0; i < p.results.length; i++) {
      p.revealed[i] = true;
      if (!p.revealAt[i]) p.revealAt[i] = this.time - 2;   // counters land done
    }
    p.revealIndex = p.results.length;
    this._toSummary();
    audio.play('uiConfirm');
  },

  _toSelect() {
    this.view = 'select';
    this.p = null;
    audio.play('uiBack');
  },

  /** Beam colour by the HIGHEST rarity in the batch — never the first card. */
  _beamColor() {
    const p = this.p;
    if (!p) return PALETTE.accent2;
    const c = this.PP.beamColor[p.highest];
    if (c !== 'rainbow') return c || RARITY_COLOR[p.highest] || PALETTE.accent2;
    // Rainbow cycles; reduceFlashing slows the cycle rather than removing it.
    const speed = save.data.settings.reduceFlashing ? 60 : 260;
    return 'hsl(' + ((this.time * speed) % 360).toFixed(0) + ',100%,66%)';
  },

  /** Atlas-safe beam colour. Always a hex string — see RAINBOW above. */
  _beamParticleColor() {
    const p = this.p;
    if (!p) return PALETTE.accent2;
    if (this.PP.beamColor[p.highest] !== 'rainbow') {
      return this.PP.beamColor[p.highest] || RARITY_COLOR[p.highest] || PALETTE.accent2;
    }
    const step = save.data.settings.reduceFlashing ? 2 : 9;
    return RAINBOW[Math.floor(this.time * step) % RAINBOW.length];
  },

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  render(r, alpha) {
    this.w = r.w; this.h = r.h;
    if (this.view === 'pull' && this.p) this._renderPull(r, alpha);
    else this._renderSelect(r, alpha);
  },

  // --- BANNER SELECT ---------------------------------------------------------

  _renderSelect(r, alpha) {
    ui.begin(r, 'gacha:select');
    ui.focusGrid(1);

    r.vignette('rgba(4,6,16,0.85)', 0.5);

    const pad = 20;
    const headerH = 62;

    ui.title('SUMMON', pad + 108, pad + 17, { size: 30 });
    ui.text('The pity counters are on screen because hiding them is hostile.',
      pad + 108, pad + 42, { size: 12, color: PALETTE.textFaint });

    this._drawWallet(r, r.w - pad, pad);

    const by = pad + headerH;
    const bh = r.h - by - pad;
    const gap = 14;
    const showHistory = r.w >= 1000;
    const lw = clamp(r.w * 0.21, 190, 268);
    const rw = showHistory ? clamp(r.w * 0.23, 230, 330) : 0;
    const cx = pad + lw + gap;
    const cw = r.w - pad * 2 - lw - rw - gap * (showHistory ? 2 : 1);

    this._drawBannerTabs(r, pad, by, lw, bh);
    this._drawBannerDetail(r, cx, by, cw, bh, showHistory);
    if (showHistory) this._drawHistory(r, r.w - pad - rw, by, rw, bh);

    // Declared LAST so focus index 0 is the first banner, not "leave the screen".
    // ESC / gamepad B still resolve through it on any frame.
    if (ui.backButton(pad, pad)) { audio.play('uiBack'); this.mgr.go('hub'); }

    ui.end();
  },

  _drawWallet(r, right, y) {
    const c = save.data.currencies;
    const items = [
      ['💎', c.starFragments || 0, PALETTE.gem],
      ['🎟', c.tickets || 0, PALETTE.accent],
      ['💌', c.universalLetters || 0, PALETTE.pink],
    ];
    let x = right;
    for (let i = items.length - 1; i >= 0; i--) {
      const w = r.measureText(formatCount(items[i][1]), 15, 700) + 42;
      x -= w;
      ui.currency(x, y, items[i][0], items[i][1], items[i][2]);
      x -= 8;
    }
  },

  _drawBannerTabs(r, x, y, w, h) {
    ui.panel(x, y, w, h, { radius: 12 });
    ui.text('BANNERS', x + 14, y + 20, { size: 11, color: PALETTE.textFaint, weight: 800 });

    const bh = 62;
    let cy = y + 36;
    for (let i = 0; i < this.banners.length; i++) {
      const b = this.banners[i];
      const locked = !!this._lockReason(b);
      const sel = i === this.bannerIndex;
      const label = (sel ? '▸ ' : '') + (locked ? '🔒 ' : '') + displayName(b);
      if (ui.button('tab' + b.id, x + 8, cy, w - 16, bh - 8, this._fit(r, label, w - 42, 15), {
        size: 15,
        textAlign: 'left',
        sub: TYPE_LABEL[b.type] || b.type,
      })) {
        // A different banner is a different document; start it at the top.
        if (this.bannerIndex !== i) { this.bannerIndex = i; this.detailScroll = 0; }
      }
      if (sel) {
        const col = (b.art && b.art.color) || PALETTE.accent;
        r.drawRoundRect(x + 10, cy + 6, 4, bh - 20, 2, col, 0.95);
      }
      cy += bh;
    }

    // Honest footer: the shared counter is a real mechanic, so say so.
    const lines = [
      'The ★5 counter is SHARED between',
      'Debut Stage and both rate-ups.',
      'Beginner and Gear keep their own.',
    ];
    for (let i = 0; i < lines.length; i++) {
      ui.text(lines[i], x + 14, y + h - 52 + i * 15, { size: 11, color: PALETTE.textFaint });
    }
  },

  _drawBannerDetail(r, x, y, w, h, showHistory) {
    const b = this.banner;
    const col = (b.art && b.art.color) || PALETTE.accent;
    ui.panel(x, y, w, h, { radius: 14, borderColor: col, borderWidth: 1.5 });
    // A wash of the banner's own colour so switching tabs is felt, not read.
    r.drawRoundRect(x + 2, y + 2, w - 4, 92, 12, col, 0.08);

    const px = x + 20;
    let cy = y + 30;

    ui.title(this._fit(r, displayName(b), w - 190, 26), px, cy, { size: 26 });
    const badge = TYPE_LABEL[b.type] || b.type;
    const bw = r.measureText(badge, 12, 800) + 20;
    ui.panel(x + w - 20 - bw, cy - 13, bw, 26, { radius: 13, color: 'rgba(0,0,0,0.4)', borderColor: col });
    ui.text(badge, x + w - 20 - bw / 2, cy, { size: 12, color: col, weight: 800, align: 'center' });
    cy += 24;
    ui.text(TYPE_BLURB[b.type] || '', px, cy, { size: 12, color: PALETTE.textFaint });
    cy += 18;

    // --- everything between the header and the buttons SCROLLS -----------------
    // The featured lineup, the rates block and the ENTIRE PITY BLOCK used to be
    // dropped, silently and with no indicator, whenever they did not fit. On a
    // short window that meant the pity counters this screen's own copy promises
    // ("The pity counters are on screen because hiding them is hostile") were
    // simply not on the screen.
    const btnH = 54;
    const lockMsg = this._lockReason(b);
    const btnY = y + h - 18 - btnH - (lockMsg ? 26 : 22);

    const railW = 26;
    const viewTop = cy;
    const viewH = Math.max(60, btnY - 12 - viewTop);
    const pw = w - 40 - railW - 8;

    if (input.wheel && ui.pointIn(x, viewTop, w, viewH)) this.detailScroll += input.wheel * 52;
    this.detailScroll = clamp(this.detailScroll, 0, this._detailMax);

    r.clipRect(x + 2, viewTop, w - 4, viewH);
    const top = viewTop + 12 - this.detailScroll;
    let sy = top;
    for (const line of wrapText(r, b.desc || '', pw, 13)) {
      ui.text(line, px, sy, { size: 13, color: PALETTE.text }); sy += 18;
    }
    sy += 4;
    for (const line of wrapText(r, b.subDesc || '', pw, 12)) {
      ui.text(line, px, sy, { size: 12, color: PALETTE.textDim }); sy += 16;
    }
    sy += 10;

    const cardH = h < 620 ? 104 : 132;
    sy = this._drawFeatured(r, b, px, sy, pw, cardH) + 12;
    if (b.type !== 'relic') sy = this._drawRates(r, b, px, sy, pw) + 10;
    sy = this._drawPity(r, b, px, sy, pw);
    if (!showHistory) {
      ui.text('★5+ in the last 100 pulls: ' + this.fivePlus + '/' + this.history.length,
        px, sy + 14, { size: 12, color: PALETTE.accent, weight: 700 });
      sy += 28;
    }
    r.unclip();

    // --- the rail: two 36px buttons and a draggable bar between them ----------
    this._detailMax = Math.max(0, (sy - top) + 12 - viewH);
    const canScroll = this._detailMax > 1;
    const railX = x + w - 14 - railW;
    if (ui.button('bdUp', railX, viewTop, railW, 36, '▲', { size: 13, radius: 8, disabled: !canScroll })) {
      this.detailScroll -= viewH * 0.6;
    }
    if (ui.button('bdDn', railX, viewTop + viewH - 36, railW, 36, '▼', { size: 13, radius: 8, disabled: !canScroll })) {
      this.detailScroll += viewH * 0.6;
    }
    this.detailScroll = clamp(this.detailScroll, 0, this._detailMax);
    this.detailScroll = ui.scrollbar('bannerBar', railX + railW / 2 - 4, viewTop + 42, 8,
      Math.max(12, viewH - 84), this.detailScroll, viewH, viewH + this._detailMax);

    this._drawPullButtons(r, b, px, btnY, w - 40, btnH, lockMsg);
  },

  /** Featured lineup, pool summary, or the relic bank — one per banner type. */
  _drawFeatured(r, b, x, y, w, h) {
    if (b.type === 'relic') return this._drawRelicBank(r, b, x, y, w, h);

    ui.text(b.featured6 ? 'FEATURED' : 'IN THE POOL', x, y + 6, { size: 11, color: PALETTE.textFaint, weight: 800 });
    const top = y + 18;

    if (b.featured6) {
      const bigW = Math.min(150, w * 0.26);
      this._charCard(r, b.featured6, x, top, bigW, h, 6, true);
      const rest = w - bigW - 12;
      const list = b.featured5 || [];
      const n = Math.max(1, list.length);
      const cw = Math.min(126, (rest - (n - 1) * 8) / n);
      for (let i = 0; i < list.length; i++) {
        this._charCard(r, list[i], x + bigW + 12 + i * (cw + 8), top + 10, cw, h - 20, 5, false);
      }
      return top + h;
    }

    // No featured lineup: state the pool honestly, then show the ★5 chase.
    const counts = [];
    for (const k of [6, 5, 4, 3]) {
      const p = b.pool && b.pool[k];
      if (p && p.length) counts.push(p.length + '× ' + RARITY_NAME[k]);
    }
    ui.text(counts.join('   ·   '), x, top + 10, { size: 15, color: PALETTE.text, weight: 700 });
    ui.text('Every ★5 below is in this pool at the printed rate.', x, top + 30,
      { size: 12, color: PALETTE.textDim });

    const five = (b.pool && b.pool[5]) || [];
    const n = Math.max(1, five.length);
    const cw = Math.min(96, (w - (n - 1) * 6) / n);
    const chipY = top + 44;
    const chipH = Math.max(38, h - 62);
    for (let i = 0; i < five.length; i++) {
      this._charChip(r, five[i], x + i * (cw + 6), chipY, cw, chipH);
    }
    return top + h;
  },

  _drawRelicBank(r, b, x, y, w, h) {
    const total = this.relicTotal || 24;
    const banked = total - this.unbankedCount;
    ui.text('THE BANK', x, y + 6, { size: 11, color: PALETTE.textFaint, weight: 800 });
    ui.text(banked + ' / ' + total + ' banked', x, y + 28, { size: 20, color: PALETTE.gold, weight: 800 });
    ui.bar(x, y + 44, w, 12, banked / total, PALETTE.gold, {
      label: banked >= total ? 'COMPLETE' : (total - banked) + ' left',
    });
    const lines = [
      'Banking does NOT unlock a relic — all ' + total + ' already drop in runs.',
      'A banked relic drops ' + (b.dropWeightBonus || 3) + '× as often, forever, and is handed to you',
      'at the start of your very next run.',
    ];
    for (let i = 0; i < lines.length; i++) {
      ui.text(lines[i], x, y + 70 + i * 17, { size: 12, color: i === 0 ? PALETTE.accent2 : PALETTE.textDim });
    }
    return y + Math.max(h, 126);
  },

  _drawRates(r, b, x, y, w) {
    const rates = this._rates(b);
    ui.text('REAL RATES', x, y + 6, { size: 11, color: PALETTE.textFaint, weight: 800 });
    let cx = x;
    for (const k of [6, 5, 4, 3]) {
      const v = rates[k] || 0;
      if (v <= 0) continue;
      const label = RARITY_NAME[k] + ' ' + (v * 100).toFixed(2) + '%';
      const lw = r.measureText(label, 14, 800) + 20;
      ui.panel(cx, y + 18, lw, 26, { radius: 13, color: 'rgba(0,0,0,0.35)', borderColor: RARITY_COLOR[k] });
      ui.text(label, cx + lw / 2, y + 31, { size: 14, color: RARITY_COLOR[k], weight: 800, align: 'center' });
      cx += lw + 8;
    }
    if (b.normalizeRates && (!b.pool[6] || !b.pool[6].length)) {
      ui.text('No ★6 in this pool, so their 1.00% is shared out across the rest.',
        cx + 4, y + 31, { size: 11, color: PALETTE.textFaint });
    }
    return y + 50;
  },

  _drawPity(r, b, x, y, w) {
    const g = this.mgr.gacha;
    const pity = g.pity(b);
    const has6 = !!(b.pool && b.pool[6] && b.pool[6].length);

    ui.text('PITY', x, y + 6, { size: 11, color: PALETTE.textFaint, weight: 800 });
    let cy = y + 20;

    if (b.type === 'relic') {
      ui.text('No pity here, and none needed.', x, cy + 8, { size: 14, color: PALETTE.text, weight: 700 });
      ui.text('Every pull banks a relic you do not have yet. There are no duds.',
        x, cy + 28, { size: 12, color: PALETTE.textDim });
      return cy + 46;
    }

    // ★5 — the counter the spec prints verbatim.
    const l5 = (this.PP.pityLabel5 || '{n}/{max} to guaranteed ★5')
      .replace('{n}', pity.since5).replace('{max}', pity.hard5);
    ui.text(l5, x, cy + 8, { size: 15, color: PALETTE.gold, weight: 800 });
    const soft5 = pity.since5 + 1 >= pity.soft5;
    const rate5 = this.G.rate5Plus ? this.G.rate5Plus(pity.since5 + 1) : 0;
    ui.text('this pull: ★5+ ' + (rate5 * 100).toFixed(2) + '%' + (soft5 ? '  — SOFT PITY' : ''),
      x + w, cy + 8, { size: 12, color: soft5 ? PALETTE.good : PALETTE.textDim, align: 'right', weight: 700 });
    this._pityBar(r, x, cy + 20, w, 10, pity.since5, pity.hard5, pity.soft5, PALETTE.gold);
    cy += 40;

    if (has6) {
      const l6 = (this.PP.pityLabel6 || '{n}/{max} to guaranteed ★6')
        .replace('{n}', pity.since6).replace('{max}', pity.hard6);
      ui.text(l6, x, cy + 8, { size: 15, color: PALETTE.pink, weight: 800 });
      const soft6 = pity.since6 + 1 >= pity.soft6;
      const rate6 = this.G.rate6 ? this.G.rate6(pity.since6 + 1) : 0;
      ui.text('this pull: ★6 ' + (rate6 * 100).toFixed(2) + '%' + (soft6 ? '  — SOFT PITY' : ''),
        x + w, cy + 8, { size: 12, color: soft6 ? PALETTE.good : PALETTE.textDim, align: 'right', weight: 700 });
      this._pityBar(r, x, cy + 20, w, 10, pity.since6, pity.hard6, pity.soft6, PALETTE.pink);
      cy += 40;
    }

    if (pity.guaranteedFeatured) {
      const t = 'NEXT ★6 GUARANTEED FEATURED';
      const tw = r.measureText(t, 13, 800) + 26;
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 4);
      ui.panel(x, cy + 2, tw, 26, { radius: 13, color: 'rgba(255,95,162,0.14)', borderColor: PALETTE.pink });
      ui.text(t, x + tw / 2, cy + 15, { size: 13, color: PALETTE.pink, weight: 800, align: 'center', alpha: 0.7 + pulse * 0.3 });
      ui.text('You lost a 50/50. The house is settling up.', x + tw + 12, cy + 15,
        { size: 11, color: PALETTE.textFaint });
      cy += 30;
    } else if (b.guarantee5Within) {
      ui.text('★5 GUARANTEED inside the ten. Not "likely". Guaranteed.', x, cy + 12,
        { size: 12, color: PALETTE.good, weight: 700 });
      cy += 26;
    } else {
      ui.text('Every 10-pull contains at least one ★4 or better.', x, cy + 12,
        { size: 12, color: PALETTE.textDim });
      cy += 26;
    }
    return cy;
  },

  /** Pity bar with a tick where soft pity starts, so the ramp is visible. */
  _pityBar(r, x, y, w, h, n, max, soft, color) {
    ui.bar(x, y, w, h, n / max, color, { bg: 'rgba(0,0,0,0.55)' });
    const tx = x + w * (soft / max);
    r.drawRect(tx - 1, y - 3, 2, h + 6, PALETTE.text, 0.55);
    ui.text('soft ' + soft, tx, y + h + 9, { size: 10, color: PALETTE.textFaint, align: 'center' });
    ui.text('hard ' + max, x + w, y + h + 9, { size: 10, color: PALETTE.textFaint, align: 'right' });
  },

  _drawPullButtons(r, b, x, y, w, h, lockMsg) {
    if (lockMsg) {
      ui.panel(x, y - 30, w, 26, { radius: 8, color: 'rgba(255,111,145,0.10)', borderColor: PALETTE.bad });
      ui.text('🔒  ' + lockMsg, x + 12, y - 17, { size: 12, color: PALETTE.bad, weight: 700 });
    }

    const have = this._have(b);
    const c1 = this._cost(b, 1);
    const c10 = this._cost(b, 10);
    const single = !(b.oneTime);      // the beginner banner IS the ten-pull
    const relic = b.type === 'relic';

    const gap = 12;
    const bw = single ? (w - gap) / 2 : w;
    let bx = x;

    if (single) {
      const can = !lockMsg && have >= c1 && (!relic || this.unbankedCount >= 1);
      if (ui.button('pull1', bx, y, bw, h, 'PULL ×1', {
        size: 18,
        disabled: !can,
        sub: c1 + '💎' + (can ? '' : (lockMsg ? '  locked' : '  need ' + (c1 - have) + ' more')),
        tooltip: relic ? 'Banks one relic you do not own yet. It was already dropping in runs; now it drops 3× as often.' : null,
      })) this._startPull(b, 1);
      bx += bw + gap;
    }

    const can10 = !lockMsg && have >= c10 && (!relic || this.unbankedCount >= 10);
    let sub10 = c10 + '💎';
    if (lockMsg) sub10 += '  locked';
    else if (have < c10) sub10 += '  need ' + (c10 - have) + ' more';
    else if (relic && this.unbankedCount < 10) sub10 += '  only ' + this.unbankedCount + ' left to bank';
    else if (b.tenPullGuarantee) sub10 += '  ·  ★' + b.tenPullGuarantee + '+ guaranteed';

    if (ui.button('pull10', bx, y, bw, h, single ? 'PULL ×10' : 'CLAIM THE TEN', {
      size: 18,
      disabled: !can10,
      sub: sub10,
    })) this._startPull(b, 10);

    ui.text('You have ' + formatCount(have) + '💎.  A ×10 is ' + c10 + '💎 — about ' +
      Math.max(1, Math.ceil(c10 / 38)) + ' finished runs.',
      x, y + h + 14, { size: 11, color: PALETTE.textFaint });
  },

  _drawHistory(r, x, y, w, h) {
    ui.panel(x, y, w, h, { radius: 12 });
    ui.text('PULL HISTORY', x + 14, y + 20, { size: 11, color: PALETTE.textFaint, weight: 800 });
    ui.text('last ' + this.G.PULL_HISTORY_MAX, x + w - 14, y + 20,
      { size: 11, color: PALETTE.textFaint, align: 'right' });

    ui.panel(x + 10, y + 32, w - 20, 30, { radius: 8, color: 'rgba(255,215,106,0.08)', borderColor: PALETTE.accent });
    ui.text('★5+ in the last 100: ' + this.fivePlus, x + w / 2, y + 47,
      { size: 13, color: PALETTE.accent, weight: 800, align: 'center' });

    const ly = y + 70;
    const lh = h - (ly - y) - 12;
    if (this.history.length === 0) {
      const lines = wrapText(r, 'Nothing yet. Everybody starts at zero, including the people with the good screenshots.', w - 28, 12);
      for (let i = 0; i < lines.length; i++) {
        ui.text(lines[i], x + 14, ly + 12 + i * 17, { size: 12, color: PALETTE.textFaint });
      }
      return;
    }

    ui.list('gachaHistory', x + 10, ly, w - 20, lh, this.history, HISTORY_ROW_H,
      (item, rx, ry, rw, rh, focused) => this._historyRow(r, item, rx, ry, rw, rh, focused),
      this.listState);
  },

  _historyRow(r, item, x, y, w, h, focused) {
    const relic = item.kind === 'relic' || !item.rarity;
    const ent = relic ? this.R[item.id] : this.C[item.id];
    const tier = relic ? ((ent && RELIC_TIER[ent.rarity]) || 4) : item.rarity;
    const col = RARITY_COLOR[tier] || PALETTE.textDim;
    if (focused) ui.panel(x, y, w, h, { radius: 6, color: 'rgba(28,36,60,0.75)', border: false });

    const pill = relic ? ((ent && RELIC_TIER_NAME[ent.rarity]) || 'GEAR') : RARITY_NAME[tier];
    const pw = 52;
    ui.panel(x + 4, y + 3, pw, h - 6, { radius: 5, color: 'rgba(0,0,0,0.35)', borderColor: col });
    ui.text(pill, x + 4 + pw / 2, y + h / 2, { size: 11, color: col, weight: 800, align: 'center' });

    const name = ent ? displayName(ent) : item.id;
    const nameW = w - pw - 20 - (item.isNew ? 34 : 0);
    ui.text(this._fit(r, name, nameW, 12), x + pw + 12, y + h / 2,
      { size: 12, color: item.isNew ? PALETTE.text : PALETTE.textDim, weight: item.isNew ? 700 : 500 });
    if (item.isNew) {
      ui.text('NEW', x + w - 8, y + h / 2, { size: 10, color: PALETTE.good, weight: 800, align: 'right' });
    }
  },

  // --- CHARACTER CARDS (select view) -----------------------------------------

  _charCard(r, id, x, y, w, h, rarity, big) {
    const c = this.C[id];
    const col = ui.card(x, y, w, h, rarity);
    if (!c) return col;
    const owned = save.data.roster[id] && save.data.roster[id].owned;
    r.drawText(c.visual && c.visual.emoji ? c.visual.emoji : '★', x + w / 2, y + h * (big ? 0.34 : 0.36), {
      size: w * (big ? 0.42 : 0.4), align: 'center', baseline: 'middle',
    });
    ui.text(RARITY_NAME[rarity], x + w / 2, y + 14, { size: 11, color: col, weight: 800, align: 'center' });

    const lines = wrapText(r, displayName(c), w - 12, big ? 14 : 12);
    let ty = y + h * (big ? 0.60 : 0.62);
    for (let i = 0; i < Math.min(2, lines.length); i++) {
      ui.text(this._fit(r, lines[i], w - 12, big ? 14 : 12), x + w / 2, ty,
        { size: big ? 14 : 12, color: PALETTE.text, weight: 800, align: 'center' });
      ty += big ? 17 : 15;
    }
    if (big && c.epithet) {
      const ep = wrapText(r, c.epithet, w - 12, 10);
      for (let i = 0; i < Math.min(2, ep.length); i++) {
        ui.text(ep[i], x + w / 2, ty, { size: 10, color: PALETTE.textDim, align: 'center' });
        ty += 12;
      }
    }
    const badge = owned ? ('OWNED  S' + (save.data.roster[id].starLevel || 1)) : 'NOT OWNED';
    ui.text(badge, x + w / 2, y + h - 12,
      { size: 10, color: owned ? PALETTE.good : PALETTE.textFaint, weight: 800, align: 'center' });
    return col;
  },

  _charChip(r, id, x, y, w, h) {
    const c = this.C[id];
    if (!c) return;
    const owned = save.data.roster[id] && save.data.roster[id].owned;
    ui.panel(x, y, w, h, {
      radius: 8,
      color: 'rgba(10,13,24,0.8)',
      borderColor: owned ? RARITY_COLOR[c.rarity] : PALETTE.border,
    });
    r.drawText(c.visual && c.visual.emoji ? c.visual.emoji : '★', x + w / 2, y + h * 0.38, {
      size: Math.min(26, w * 0.42), align: 'center', baseline: 'middle', alpha: owned ? 1 : 0.45,
    });
    ui.text(this._fit(r, displayName(c), w - 8, 10), x + w / 2, y + h - 12,
      { size: 10, color: owned ? PALETTE.text : PALETTE.textFaint, align: 'center', weight: 700 });
  },

  // ---------------------------------------------------------------------------
  // THE PULL VIEW
  // ---------------------------------------------------------------------------

  _renderPull(r, alpha) {
    const p = this.p;
    ui.begin(r, 'gacha:pull');
    ui.focusGrid(1);

    const beam = this._beamColor();
    const cxs = r.w * 0.5;
    const cys = r.h * 0.46;
    const sx = shake.x, sy = shake.y;

    // background wash driven by the beam colour
    r.vignette('rgba(2,3,10,0.92)', p.state === 'hold' ? 0.95 : 0.7);
    if (p.state !== 'hold') {
      const glow = p.state === 'charge' ? clamp(p.t / this.PP.chargeTime, 0, 1) : 0.55;
      r.drawCircle(cxs + sx, cys + sy, Math.max(r.w, r.h) * 0.42, beam, 0.05 + glow * 0.10);
    }

    // Particles are emitted by this scene in screen coordinates, so the cull box
    // has to cover the screen. setCamera writes the box; setScreenSpace puts the
    // transform back so 1 unit == 1 CSS pixel.
    r.setCamera(r.w / 2, r.h / 2, 1);
    r.setScreenSpace();
    particles.draw(r, alpha);
    r.setAlpha(1);

    switch (p.state) {
      case 'charge': this._drawCharge(r, cxs + sx, cys + sy, beam); break;
      case 'hold':   this._drawHold(r, cxs + sx, cys + sy); break;
      case 'burst':  this._drawBurst(r, cxs + sx, cys + sy, beam); break;
      default:       this._drawCards(r, sx, sy); break;
    }

    if (p.state === 'splash') this._drawSplash(r);

    // full-screen flash (fired by _burst, decayed by main.js)
    if (flash.alpha > 0.001) r.overlay(flash.color, Math.min(1, flash.alpha));

    // --- controls -------------------------------------------------------------
    // The advance/continue affordance is declared FIRST so it owns focus index 0
    // and Enter never means "skip the whole thing" by accident. SKIP follows it,
    // and the hand-rolled "click anywhere" fallback comes LAST of all.
    let advance = false;
    const abw = 220, abh = 48;
    if (p.state === 'splash') {
      advance = ui.button('splashNext', r.w / 2 - abw / 2, r.h - 78, abw, abh, 'CONTINUE ▸', { size: 16 });
    } else if (p.state === 'reveal') {
      advance = ui.button('revealNext', r.w / 2 - abw / 2, r.h - 78, abw, abh, 'NEXT ▸', { size: 16 });
    }

    if (p.state === 'summary') this._drawSummary(r);
    else this._drawSkip(r);

    // ui.consumeClick() asks the toolkit for THIS FRAME'S click and gets refused
    // if any widget already took it. The old spelling was `input.mouseClicked &&
    // !consumed` with a local flag that only ever saw the NEXT button — SKIP was
    // drawn afterwards, so one press on SKIP fired _revealNext() and _skip()
    // together and the reveal jumped two steps.
    if (p.state === 'splash') {
      if (p.splashT >= SPLASH_LOCK && (advance || (input.mouseReleased && ui.consumeClick()))) {
        this._endSplash();
      }
    } else if (p.state === 'reveal') {
      if (advance || (input.mouseReleased && ui.consumeClick())) this._revealNext();
    }

    // ESC / gamepad B: skip while it is playing, leave once it is done.
    if (ui.backPressed()) {
      if (p.state === 'summary') this._toSelect();
      else this._skip();
    }

    ui.end();
  },

  /** SECTION 6: available and instant from the FIRST FRAME. Non-negotiable. */
  _drawSkip(r) {
    // TOP-LEFT, and 176x48. It used to be a 132x40 button at (r.w - 152, 20) —
    // which is exactly the rect the toast stack draws into, so a "NEXT ★6
    // GUARANTEED FEATURED" toast landed on top of the one control the spec calls
    // non-negotiable. This corner is empty in every pull state (the cards never
    // start above y=96) and is not where toasts live at either end of the screen.
    if (ui.button('skip', 24, 18, 176, 48, 'SKIP ▸▸', { size: 16 })) this._skip();
    ui.text('ESC also skips. Nothing is lost — the result is already saved.',
      24, 78, { size: 11, color: PALETTE.textFaint });
  },

  _drawCharge(r, cx, cy, beam) {
    const p = this.p;
    const t = clamp(p.t / this.PP.chargeTime, 0, 1);
    const e = easeOutCubic(t);
    const rad = 18 + e * 120;

    // the rift
    r.drawCircle(cx, cy, rad * 0.72, '#000000', 0.85);
    r.strokeCircle(cx, cy, rad, beam, 3 + e * 4, 0.9);
    r.strokeCircle(cx, cy, rad * (1.25 + Math.sin(this.time * 6) * 0.05), beam, 1.5, 0.35);

    const spokes = 12;
    for (let i = 0; i < spokes; i++) {
      const a = this.time * 1.6 + (i / spokes) * TAU;
      const inner = rad * 1.1;
      const outer = rad * (1.35 + e * 1.5 + Math.sin(this.time * 8 + i) * 0.08);
      r.drawLine(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner,
        cx + Math.cos(a) * outer, cy + Math.sin(a) * outer, beam, 2, 0.25 + e * 0.5);
    }

    ui.text(p.count > 1 ? 'TEN-PULL' : 'SINGLE PULL', cx, cy + rad + 56,
      { size: 13, color: PALETTE.textDim, align: 'center', weight: 800 });
    ui.text(displayName(p.banner), cx, cy + rad + 78,
      { size: 18, color: PALETTE.text, align: 'center', weight: 800 });
  },

  _drawHold(r, cx, cy) {
    // Silence. One point of light, trembling. Nothing else on screen.
    const p = this.p;
    const t = clamp(p.t / (this.PP.holdBeat[6] || 0.9), 0, 1);
    const rad = 3 + (1 - t) * 6;
    r.overlay('#000000', 0.55 + t * 0.35);
    r.drawCircle(cx, cy, rad, '#ffffff', 0.9);
    r.drawCircle(cx, cy, rad * 6, '#ffffff', 0.05 * (1 - t));
  },

  _drawBurst(r, cx, cy, beam) {
    const p = this.p;
    const t = clamp(p.t / 0.28, 0, 1);
    const rad = 40 + easeOutCubic(t) * Math.max(r.w, r.h) * 0.6;
    r.strokeCircle(cx, cy, rad, beam, 14 * (1 - t), 0.85 * (1 - t));
    r.drawCircle(cx, cy, 60 * (1 - t) + 8, '#ffffff', 0.8 * (1 - t));
    // the beam itself, straight up and down through the rift
    r.drawBeam(cx, cy - r.h, cx, cy + r.h, 90 * (1 - t) + 6, beam, 0.5 * (1 - t));
  },

  // --- cards -----------------------------------------------------------------

  _cardLayout(r) {
    const p = this.p;
    const n = p.count;
    const cols = n > 1 ? 5 : 1;
    const rows = Math.ceil(n / cols);
    const availW = r.w - 120;
    const availH = r.h - 250;
    let cw = n > 1 ? Math.min(168, (availW - (cols - 1) * 14) / cols) : Math.min(240, availW * 0.3);
    let ch = cw * 1.36;
    const maxH = (availH - (rows - 1) * 14) / rows;
    if (ch > maxH) { ch = maxH; cw = ch / 1.36; }
    const totalW = cols * cw + (cols - 1) * 14;
    const totalH = rows * ch + (rows - 1) * 14;
    return {
      cols, rows, cw, ch,
      x0: (r.w - totalW) / 2,
      y0: Math.max(96, (r.h - totalH) / 2 - 24),
    };
  },

  _drawCards(r, sx, sy) {
    const p = this.p;
    const L = this._cardLayout(r);
    for (let i = 0; i < p.count; i++) {
      const cxi = i % L.cols;
      const cyi = Math.floor(i / L.cols);
      const x = L.x0 + cxi * (L.cw + 14) + sx;
      const y = L.y0 + cyi * (L.ch + 14) + sy;
      p.cardPos[i] = { x, y, w: L.cw, h: L.ch };
      if (p.revealed[i]) this._drawResultCard(r, p.results[i], i, x, y, L.cw, L.ch);
      else this._drawFacedown(r, x, y, L.cw, L.ch);
    }
    ui.text(p.revealIndex + ' / ' + p.count + ' revealed', r.w / 2, L.y0 + L.rows * (L.ch + 14) + 8,
      { size: 12, color: PALETTE.textFaint, align: 'center' });
  },

  _drawFacedown(r, x, y, w, h) {
    const beam = this._beamColor();
    ui.panel(x, y, w, h, { radius: 12, color: 'rgba(6,8,16,0.9)', borderColor: PALETTE.border });
    r.drawText('✦', x + w / 2, y + h / 2, { size: w * 0.3, align: 'center', baseline: 'middle', color: beam, alpha: 0.35 });
  },

  _drawResultCard(r, res, i, x, y, w, h) {
    const p = this.p;
    const age = this.time - (p.revealAt[i] || this.time);
    const pop = clamp(age / 0.28, 0, 1);
    const scale = 0.86 + easeOutBack(pop) * 0.14;
    const cw = w * scale, ch = h * scale;
    const cx = x + (w - cw) / 2, cy = y + (h - ch) / 2;

    const relic = res.kind === 'relic';
    const ent = relic ? this.R[res.id] : this.C[res.id];
    const col = ui.card(cx, cy, cw, ch, res.rarity);

    const icon = relic
      ? (ent && ent.icon ? ent.icon : '🎒')
      : (ent && ent.visual && ent.visual.emoji ? ent.visual.emoji : '★');
    r.drawText(icon, cx + cw / 2, cy + ch * 0.34, {
      size: cw * 0.42, align: 'center', baseline: 'middle', alpha: pop,
    });

    const tierLabel = relic ? ((ent && RELIC_TIER_NAME[ent.rarity]) || 'GEAR') : RARITY_NAME[res.rarity];
    ui.text(tierLabel, cx + cw / 2, cy + 14, { size: 11, color: col, weight: 800, align: 'center' });
    if (res.featured) {
      ui.text('RATE-UP', cx + cw / 2, cy + 28, { size: 10, color: PALETTE.pink, weight: 800, align: 'center' });
    }

    const name = ent ? displayName(ent) : res.id;
    const lines = wrapText(r, name, cw - 12, 13);
    let ty = cy + ch * 0.62;
    for (let k = 0; k < Math.min(2, lines.length); k++) {
      ui.text(this._fit(r, lines[k], cw - 12, 13), cx + cw / 2, ty,
        { size: 13, color: PALETTE.text, weight: 800, align: 'center' });
      ty += 16;
    }

    // NEW badge, or the dupe counter ticking up.
    if (res.isNew) {
      const pulse = 0.6 + 0.4 * Math.sin(this.time * 6 + i);
      ui.text(relic ? 'BANKED' : 'NEW', cx + cw / 2, cy + ch - 16,
        { size: 13, color: PALETTE.good, weight: 800, align: 'center', alpha: 0.7 + pulse * 0.3 });
    } else if (res.letters) {
      const tick = clamp(age / (this.PP.dupeCounterTick || 0.6), 0, 1);
      const shown = Math.round(res.letters * easeOutCubic(tick));
      const done = tick >= 1;
      const universal = this.G.THREE_STAR_OVERFLOW && res.rarity === 3 &&
        ((save.data.roster[res.id] && save.data.roster[res.id].starLevel) || 1) >= 5;
      ui.text('+' + shown + ' 💌', cx + cw / 2, cy + ch - 18, {
        size: done ? 15 : 14, color: done ? PALETTE.pink : PALETTE.textDim,
        weight: 800, align: 'center',
      });
      if (universal) {
        ui.text('UNIVERSAL', cx + cw / 2, cy + ch - 5,
          { size: 9, color: PALETTE.accent2, weight: 800, align: 'center' });
      }
    }
  },

  // --- the new-character splash ---------------------------------------------

  _drawSplash(r) {
    const p = this.p;
    const i = p.splashIndex;
    if (i < 0) return;
    const res = p.results[i];
    const relic = res.kind === 'relic';
    const ent = relic ? this.R[res.id] : this.C[res.id];
    const col = RARITY_COLOR[res.rarity] || PALETTE.accent;
    const t = clamp(p.splashT / 0.35, 0, 1);
    const e = easeOutCubic(t);

    r.overlay('#03040c', 0.88 * e);
    r.drawCircle(r.w / 2, r.h * 0.42, Math.max(r.w, r.h) * 0.45, col, 0.10 * e);

    // rarity ribbon
    const ribbonH = 3;
    r.drawRect(0, r.h * 0.16, r.w * e, ribbonH, col, 0.9);
    r.drawRect(r.w * (1 - e), r.h * 0.74, r.w * e, ribbonH, col, 0.9);

    ui.text(relic ? 'SIGNATURE GEAR BANKED' : 'NEW CHARACTER',
      r.w / 2, r.h * 0.16 - 20, { size: 14, color: col, weight: 800, align: 'center', alpha: e });

    const icon = relic
      ? (ent && ent.icon ? ent.icon : '🎒')
      : (ent && ent.visual && ent.visual.emoji ? ent.visual.emoji : '★');
    r.drawText(icon, r.w / 2, r.h * 0.34, {
      size: Math.min(160, r.h * 0.20) * (0.9 + e * 0.1), align: 'center', baseline: 'middle', alpha: e,
    });

    // ui.text, not ui.title — title does not forward `alpha` and this fades in.
    const name = ent ? displayName(ent) : res.id;
    ui.text(this._fit(r, name, r.w - 80, 46), r.w / 2, r.h * 0.48,
      { size: 46, align: 'center', color: PALETTE.text, weight: 800, alpha: e });

    if (!relic) {
      if (ent && ent.epithet) {
        ui.text(ent.epithet, r.w / 2, r.h * 0.53,
          { size: 18, color: col, align: 'center', weight: 700, alpha: e });
      }
      const bark = ent && ent.barks && ent.barks.spawn;
      if (bark) {
        let by = r.h * 0.60;
        for (const line of wrapText(r, '“' + bark + '”', Math.min(760, r.w - 100), 20)) {
          ui.text(line, r.w / 2, by, { size: 20, color: PALETTE.text, align: 'center', alpha: e * 0.95 });
          by += 26;
        }
      }
      ui.text(RARITY_NAME[res.rarity] + '  ·  ' + (ent && ent.archetype ? ent.archetype : ''),
        r.w / 2, r.h * 0.70, { size: 13, color: PALETTE.textDim, align: 'center', weight: 700, alpha: e });
    } else {
      let by = r.h * 0.55;
      for (const line of wrapText(r, (ent && ent.desc) || '', Math.min(760, r.w - 100), 16)) {
        ui.text(line, r.w / 2, by, { size: 16, color: PALETTE.text, align: 'center', alpha: e });
        by += 22;
      }
      by += 10;
      // DECISIONS.md §9 — say what banking actually does, every single time.
      for (const line of wrapText(r,
        'It was always in the drop pool. It now drops 3× as often, forever, and you start your next run holding it.',
        Math.min(700, r.w - 100), 14)) {
        ui.text(line, r.w / 2, by, { size: 14, color: PALETTE.accent2, align: 'center', alpha: e });
        by += 19;
      }
    }

    // auto-advance timer, drawn so the player knows it is not stuck
    const frac = clamp(p.splashT / SPLASH_TIME, 0, 1);
    ui.bar(r.w / 2 - 110, r.h - 96, 220, 4, 1 - frac, col, { bg: 'rgba(255,255,255,0.10)' });
  },

  // --- summary ---------------------------------------------------------------

  _drawSummary(r) {
    const p = this.p;
    const b = p.banner;
    const lock = p.inputLock > 0;

    ui.text(p.count > 1 ? 'TEN-PULL COMPLETE' : 'PULL COMPLETE', r.w / 2, 34,
      { size: 13, color: PALETTE.textFaint, align: 'center', weight: 800 });
    ui.title(displayName(b), r.w / 2, 58, { size: 24, align: 'center' });

    const relic = b.type === 'relic';
    const bits = [];
    if (p.news) bits.push(p.news + (relic ? ' BANKED' : ' NEW'));
    if (p.letters) bits.push('+' + p.letters + '💌');
    bits.push('−' + p.cost + '💎');
    if (!relic) {
      const pity = this.mgr.gacha.pity(b);
      bits.push(pity.since5 + '/' + pity.hard5 + ' to ★5');
    } else {
      bits.push(this.unbankedCount + ' left to bank');
    }
    ui.text(bits.join('   ·   '), r.w / 2, 82,
      { size: 14, color: PALETTE.accent, align: 'center', weight: 700 });

    const btnH = 50, gap = 12;
    const c1 = this._cost(b, 1), c10 = this._cost(b, 10);
    const have = this._have(b);
    const lockMsg = this._lockReason(b);
    // A one-time banner has nothing left to pull again, so it gets one button.
    const single = !b.oneTime;
    const n = single ? 3 : 1;
    const bw = Math.min(240, (Math.min(r.w - 80, 820) - (n - 1) * gap) / n);
    const totalW = n * bw + (n - 1) * gap;
    const bx0 = (r.w - totalW) / 2;
    let bx = bx0;
    const by = r.h - 80;

    // SUMMARY_LOCK is 450ms of dead input so a mash through the reveal cannot
    // spend another 135💎 by accident. It used to be three silently greyed
    // buttons: you click, nothing happens, and nothing on screen says why.
    if (lock) {
      const f = 1 - clamp(p.inputLock / SUMMARY_LOCK, 0, 1);
      ui.text('unlocking in ' + p.inputLock.toFixed(2) + 's — so a mash cannot spend another ' + c10 + '💎',
        r.w / 2, by - 42, { size: 12, color: PALETTE.textFaint, align: 'center', weight: 700 });
      ui.bar(bx0, by - 30, totalW, 6, f, PALETTE.accent, { segments: false, bg: 'rgba(0,0,0,0.6)' });
    }

    if (ui.button('done', bx, by, bw, btnH, '‹ BANNERS', { size: 16, disabled: lock })) this._toSelect();
    bx += bw + gap;

    if (single) {
      const can = !lock && !lockMsg && have >= c1 && (!relic || this.unbankedCount >= 1);
      if (ui.button('again1', bx, by, bw, btnH, 'AGAIN ×1', { size: 16, disabled: !can, sub: c1 + '💎' })) {
        this._startPull(b, 1);
      }
      bx += bw + gap;

      const can10 = !lock && !lockMsg && have >= c10 && (!relic || this.unbankedCount >= 10);
      if (ui.button('again10', bx, by, bw, btnH, 'AGAIN ×10', {
        size: 16, disabled: !can10, sub: c10 + '💎',
      })) this._startPull(b, 10);
    }

    if (lockMsg) {
      ui.text(lockMsg, r.w / 2, by - 18, { size: 12, color: PALETTE.bad, align: 'center', weight: 700 });
    } else if (have < c10) {
      ui.text('You have ' + have + '💎. A ×10 is ' + c10 + '💎. Go win a run — one pays about 38💎.',
        r.w / 2, by - 18, { size: 12, color: PALETTE.textFaint, align: 'center' });
    }
  },

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  /** Truncate to fit, with an ellipsis. Never lets a long dev [ref] blow layout. */
  _fit(r, text, maxW, size) {
    const s = String(text);
    if (r.measureText(s, size, 700) <= maxW) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (r.measureText(s.slice(0, mid) + '…', size, 700) <= maxW) lo = mid; else hi = mid - 1;
    }
    return s.slice(0, lo) + '…';
  },
};
