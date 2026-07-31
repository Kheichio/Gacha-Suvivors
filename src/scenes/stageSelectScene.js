// STAGE SELECT — pick a stage, a difficulty tier, then a character, then go.
// SECTION 12 node 1: "shows best time & rewards".
//
// Two steps in one scene:
//   mode 'stage' — the seven stages, their hazard and modifier IN PLAIN WORDS,
//                  the boss, the first-clear reward, your best time and clears,
//                  the four difficulty tiers with their real multipliers, and
//                  Overtime (Endless) on anything you have already cleared.
//   mode 'char'  — only the characters you actually own, with every ability,
//                  the passive, and both authored build paths.
//
// FOCUS IS THE PREVIEW. Moving the stick over a stage shows that stage; you
// never have to "open" anything to read it. COMMITTING IS EXPLICIT: a single
// click selects, and only the CHOOSE CHARACTER button — or a double-click on the
// row already selected — walks on to step two. A single click used to navigate,
// which made the button redundant and every stray click a surprise.
//
// Both detail panels SCROLL. They were clipped with no scroll handler, no
// scrollbar and no arrows, so at 1280x720 the stage card simply cut "YOUR BEST
// TIME" and "CLEARS" off the bottom with no input able to reveal them.
//
// Two rulings are visible on this screen:
//   DECISIONS.md §32 — Endless bests are LOCAL. The label is "Personal Bests".
//                      There is no server and the screen says so out loud.
//   DECISIONS.md §33 — unlock.stages is an ARRAY, so a locked stage renders
//                      "Clear: A, B, C" and Stage 7 lists all six.
//
// INPUT LIVES IN render(). sceneManager.update() may run five fixed steps in one
// frame; input.pressed() there would fire a navigation five times over.

import { ui, PALETTE, RARITY_COLOR, RARITY_NAME, wrapText, formatCount } from '../ui/widgets.js';
import { input } from '../core/input.js';
import { save } from '../core/save.js';
import { audio } from '../core/audio.js';
import { displayName } from '../core/config.js';
import { atlas } from '../render/spriteAtlas.js';
import { clamp, formatTime } from '../core/math.js';

/** Read-only defaults so browsing this screen never writes to the save blob. */
const NO_STAGE = { cleared: false, bestTime: 0, bestTier: -1, clears: 0, mastery: 0 };
const NO_ROSTER = { owned: false, starLevel: 1, letters: 0, bond: 0, runs: 0, kills: 0 };

const STARS = ['', '★', '★★', '★★★', '★★★★', '★★★★★'];

function fit(r, text, maxW, size) {
  const s = String(text);
  if (r.measureText(s, size, 700) <= maxW) return s;
  let out = s;
  while (out.length > 1 && r.measureText(out + '…', size, 700) > maxW) out = out.slice(0, -1);
  return out + '…';
}

/** Open the sprite cull window: drawSprite culls to the camera, menus have none. */
function openCull(r) {
  r.cullMinX = -400; r.cullMaxX = r.w + 400;
  r.cullMinY = -400; r.cullMaxY = r.h + 400;
}

export const stageSelectScene = {
  manager: null,
  mode: 'stage',
  sel: 0,
  tierIndex: 0,
  endless: false,
  characterId: null,
  owned: null,
  charPage: 0,

  // --- lifecycle -------------------------------------------------------------
  enter(params, mgr) {
    this.manager = mgr || this.manager;
    this.mgr = this.manager;
    const p = params || {};
    const d = this.manager.data;
    const shared = this.manager.shared;

    this.stages = d.stages.STAGES;
    this.tiers = d.stages.DIFFICULTY_TIERS;
    this.mode = 'stage';
    this._wrapCache = Object.create(null);
    this._nav = false;
    this._restoreFocus = -1;
    this._stageFocus = 0;
    this._preview = null;
    this.detScroll = 0; this._detMax = 0;
    this.charScroll = 0; this._charMax = 0; this._charScrollFor = null;
    // Double-click bookkeeping for the stage rows (see _stageRow).
    this._rowClickIdx = -1;
    this._rowClickT = -1e9;

    const wantStage = p.stageId || shared.stageId;
    this.sel = 0;
    for (let i = 0; i < this.stages.length; i++) if (this.stages[i].id === wantStage) this.sel = i;

    const wantTier = p.tierIndex !== undefined ? p.tierIndex : shared.tierIndex;
    this.tierIndex = clamp(wantTier | 0, 0, this.tiers.length - 1);
    this.endless = !!p.endless;

    // A run seed is NOT gacha — it never touches the meta stream. A daily or a
    // replay arrives with its seed already chosen and must keep it; everything
    // else rolls a fresh one at launch.
    this._fixedSeed = p.seed ? (p.seed | 0) : 0;
    this._seedReason = p.daily ? 'DAILY' : (this._fixedSeed ? 'REPLAY' : '');

    this.owned = [];
    for (const c of d.characters.CHARACTERS) {
      const e = save.data.roster[c.id];
      if (e && e.owned) this.owned.push(c);
    }
    const wantChar = p.characterId || shared.characterId;
    this.characterId = null;
    for (const c of this.owned) if (c.id === wantChar) this.characterId = c.id;
    if (!this.characterId && this.owned.length) this.characterId = this.owned[0].id;
    this.charPage = 0;
  },

  exit() { this._wrapCache = Object.create(null); },

  resize() { this._wrapCache = Object.create(null); },

  clearColor() {
    const st = this.stages && this.stages[this.sel];
    return (st && st.palette && st.palette.bg) || '#05060d';
  },

  update() { /* nothing to simulate; all input is resolved once per frame in render */ },

  // --- save-blob reads (never writes) ----------------------------------------
  _stage() { return this.stages[this.sel]; },
  _entry(id) { return save.data.stages[id] || NO_STAGE; },
  _roster(id) { return save.data.roster[id] || NO_ROSTER; },

  /**
   * Every printed name goes through displayName(), tiers included. None of them
   * carry a `ref` today — but "Titan's Shadow" and "Kamige" are exactly the kind
   * of string refs.js may claim later, and this keeps that a data change.
   */
  _tierName(i) { return displayName(this.tiers[i]).toUpperCase(); },

  _isUnlocked(st) {
    const req = st.unlock && st.unlock.stages;
    if (!req || req.length === 0) return true;
    for (let i = 0; i < req.length; i++) if (!this._entry(req[i]).cleared) return false;
    return true;
  },

  /** Tiers unlock per-stage on that stage's first clear (SECTION 7 / stages.js). */
  _tierOpen(i) { return i === 0 || this._entry(this._stage().id).cleared; },
  _effTier() { return this._tierOpen(this.tierIndex) ? this.tierIndex : 0; },

  _canEndless() {
    return !!save.data.unlocks.endless && this._entry(this._stage().id).cleared;
  },
  _effEndless() { return this.endless && this._canEndless(); },

  _wrap(r, key, text, width, size) {
    const k = key + '|' + (width | 0) + '|' + size;
    const c = this._wrapCache;
    let v = c[k];
    if (!v) v = c[k] = wrapText(r, text, width, size);
    return v;
  },

  _rewardText(st) {
    const d = this.manager.data;
    const fc = st.firstClearReward || {};
    let out = '';
    if (fc.starFragments) out += fc.starFragments + '💎';
    if (fc.gold) out += (out ? ' · ' : '') + fc.gold + '⭐';
    if (fc.relic) {
      const rl = d.relics.RELICS_BY_ID[fc.relic];
      out += (out ? ' · ' : '') + 'Relic: ' + (rl ? displayName(rl) : fc.relic);
    }
    if (fc.unlocksEndless) out += (out ? ' · ' : '') + 'unlocks OVERTIME on every cleared stage';
    return out || 'bragging rights, mostly';
  },

  _unlockText(st) {
    const req = (st.unlock && st.unlock.stages) || [];
    const by = this.manager.data.stages.STAGES_BY_ID;
    let out = '';
    for (let i = 0; i < req.length; i++) {
      const s = by[req[i]];
      out += (i ? ', ' : '') + (s ? displayName(s) : req[i]);
    }
    return 'Clear: ' + out;
  },

  _go(scene, params) {
    if (this._nav) return;
    this._nav = true;
    this.manager.go(scene, params);
  },

  _start() {
    const st = this._stage();
    if (this._nav || !this.characterId || !this._isUnlocked(st)) return;
    const s = this.manager.shared;
    s.characterId = this.characterId;
    s.stageId = st.id;
    s.tierIndex = this._effTier();
    s.endless = this._effEndless();
    s.seed = this._fixedSeed || ((Math.random() * 0x7fffffff) | 0);
    this._go('run');
  },

  // --- render ----------------------------------------------------------------
  render(r) {
    const char = this.mode === 'char';
    ui.begin(r, char ? 'stageSelect.char' : 'stageSelect');
    if (this._restoreFocus >= 0) { ui.focus = this._restoreFocus; this._restoreFocus = -1; }

    this._paintBackdrop(r);
    if (char) this._renderChar(r); else this._renderStage(r);

    ui.end();
  },

  /** The screen wears the selected stage's colours. clearColor() paints the bg. */
  _paintBackdrop(r) {
    const p = this._stage().palette;
    const step = 72;
    for (let x = 0; x < r.w; x += step) r.drawLine(x, 0, x, r.h, p.grid, 1, 0.16);
    for (let y = 0; y < r.h; y += step) r.drawLine(0, y, r.w, y, p.grid, 1, 0.16);
    r.drawRect(0, 0, r.w, 3, p.accent, 0.75);
    r.vignette('rgba(0,0,0,0.82)', 0.62);
  },

  // ===========================================================================
  // STEP 1 — STAGE + TIER
  // ===========================================================================
  _renderStage(r) {
    const W = r.w, H = r.h;
    const pad = clamp(W * 0.02, 14, 30) | 0;
    const headerH = 76;
    const barH = 58;
    const bodyY = headerH;
    const bodyH = Math.max(140, H - headerH - barH - pad);
    const listW = clamp(W * 0.36, 268, 470) | 0;
    const detX = pad + listW + 14;
    const detW = Math.max(180, W - detX - pad);

    ui.focusGrid(1);

    const st = this._stage();
    ui.title('STAGE SELECT', pad, 34, { size: 28 });
    ui.text('click a stage to read it · double-click or CHOOSE CHARACTER to commit',
      pad, 58, { size: 12, color: PALETTE.textFaint });

    // --- the seven stages ----------------------------------------------------
    const gap = 6;
    const rowH = clamp((bodyH - gap * 6) / 7, 38, 84) | 0;
    let y = bodyY;
    for (let i = 0; i < this.stages.length; i++) {
      this._stageRow(r, i, pad, y, listW, rowH);
      y += rowH + gap;
    }

    // --- the detail card -----------------------------------------------------
    this._stageDetail(r, detX, bodyY, detW, bodyH);

    // --- bottom bar ----------------------------------------------------------
    const by = H - barH + 10;
    const unlocked = this._isUnlocked(st);
    const nextW = clamp(W * 0.22, 200, 280) | 0;
    const summary = displayName(st) + '  ·  ' + this._tierName(this._effTier()) +
      (this._effEndless() ? '  ·  OVERTIME' : '') +
      (this._fixedSeed ? '  ·  ' + this._seedReason + ' SEED ' + this._fixedSeed : '');
    ui.text(fit(r, summary, W - pad * 2 - nextW - 130, 13), pad + 110, by + 20,
      { size: 13, color: PALETTE.textDim });

    if (ui.button('next', W - pad - nextW, by, nextW, 40,
        !unlocked ? '🔒 STAGE LOCKED' : this.owned.length ? 'CHOOSE CHARACTER ›' : 'NOBODY OWNED — GO PULL', {
          size: 15,
          disabled: !unlocked || this.owned.length === 0,
        })) {
      this._stageFocus = ui.focus;
      this.mode = 'char';
      this._preview = null;
      audio.play('uiConfirm');
    }

    if (ui.backButton(pad, by + 3)) { audio.play('uiBack'); this._go('hub'); }
  },

  /** Point the detail card at a different stage. Different stage, fresh scroll. */
  _pick(i) {
    if (this.sel === i) return;
    this.sel = i;
    this.detScroll = 0;
  },

  _stageRow(r, i, x, y, w, h) {
    const st = this.stages[i];
    const e = this._entry(st.id);
    const unlocked = this._isUnlocked(st);
    const idx = ui.itemCount;
    const hit = ui.button('st' + st.id, x, y, w, h, null, { radius: 10, disabled: !unlocked });
    const focused = ui.focus === idx;
    if (focused && this.sel !== i) this._pick(i);
    // A click SELECTS. Only a SECOND click on the row already selected — the
    // double-click every desktop list already teaches — walks on to step two.
    // A single click used to navigate, which made the CHOOSE CHARACTER button
    // below it redundant and turned a misplaced click into a scene change.
    if (hit) {
      const dbl = this.sel === i && this._rowClickIdx === i && (ui.time - this._rowClickT) < 0.45;
      this._pick(i);
      this._rowClickIdx = i;
      this._rowClickT = ui.time;
      if (dbl && this.owned.length && unlocked) {
        this._stageFocus = idx;
        this.mode = 'char';
        this._preview = null;
        audio.play('uiConfirm');
      }
    }

    const twoLine = h >= 50;
    const col = !unlocked ? PALETTE.textFaint : focused ? PALETTE.accent : PALETTE.text;
    const accent = st.palette.accent;

    // Stage colour chip, so the list reads as seven different places.
    r.drawRoundRect(x + 6, y + 6, 5, h - 12, 2.5, accent, unlocked ? 0.9 : 0.3);
    ui.text((i + 1) + '', x + 26, y + h / 2, {
      size: twoLine ? 17 : 14, color: unlocked ? accent : PALETTE.textFaint,
      weight: 800, align: 'center',
    });

    const nameX = x + 42;
    const nameW = w - 42 - 74;
    ui.text(fit(r, displayName(st), nameW, twoLine ? 15 : 13),
      nameX, twoLine ? y + h / 2 - 9 : y + h / 2, {
        size: twoLine ? 15 : 13, color: col, weight: 800,
      });
    ui.text(STARS[st.difficultyStars] || '', x + w - 12, y + (twoLine ? h / 2 - 9 : h / 2), {
      size: 12, color: unlocked ? PALETTE.gold : PALETTE.textFaint, align: 'right', weight: 700,
    });

    if (!twoLine) return;
    let sub;
    if (!unlocked) sub = '🔒 ' + this._unlockText(st);
    else if (e.cleared) {
      sub = (st.duration / 60) + ' min · best ' + (e.bestTime ? formatTime(e.bestTime) : '—') +
        ' · ' + e.clears + (e.clears === 1 ? ' clear' : ' clears');
      if (e.bestTier > 0) sub += ' · ' + this._tierName(Math.min(e.bestTier, this.tiers.length - 1));
    } else {
      sub = (st.duration / 60) + ' min · never cleared · first clear pays ' + this._rewardText(st);
    }
    ui.text(fit(r, sub, w - 52, 11), nameX, y + h / 2 + 10, {
      size: 11, color: unlocked ? PALETTE.textFaint : PALETTE.bad,
    });
  },

  _stageDetail(r, x, y, w, h) {
    const d = this.manager.data;
    const st = this._stage();
    const e = this._entry(st.id);
    const unlocked = this._isUnlocked(st);
    ui.panel(x, y, w, h, { radius: 14, color: 'rgba(8,10,20,0.86)' });

    const blockH = 168;
    const railH = 42;
    // The content view. This was a bare clipRect with no scroll of any kind, so
    // the last ~20px of copy (YOUR BEST TIME, CLEARS) had no way to be reached.
    const viewH = Math.max(40, h - blockH - 6 - railH);
    const innerW = w - 32 - 14;

    if (input.wheel && ui.pointIn(x, y, w, viewH)) this.detScroll += input.wheel * 48;
    this.detScroll = clamp(this.detScroll, 0, this._detMax);

    r.clipRect(x + 2, y + 2, w - 4, viewH);
    const top = y + 24 - this.detScroll;
    let cy = top;

    ui.text('STAGE ' + (this.sel + 1) + ' OF ' + this.stages.length + '  ·  ' +
      (STARS[st.difficultyStars] || '') + '  ·  ' + (st.duration / 60) + ' MIN',
      x + 16, cy, { size: 11, color: PALETTE.textFaint, weight: 800 });
    cy += 24;
    ui.title(fit(r, displayName(st), innerW, 21), x + 16, cy, { size: 21, color: st.palette.accent });
    cy += 26;

    for (const l of this._wrap(r, 'codex' + st.id, st.codex, innerW, 12)) {
      ui.text(l, x + 16, cy, { size: 12, color: PALETTE.textDim });
      cy += 15;
    }
    cy += 8;
    r.drawLine(x + 16, cy, x + 16 + innerW, cy, PALETTE.border, 1, 1);
    cy += 14;

    // Hazard — the name AND what it does, in plain language.
    const haz = st.hazards && st.hazards.length ? d.stages.HAZARDS[st.hazards[0]] : null;
    ui.text('HAZARD · ' + (haz ? displayName(haz) : 'NONE'), x + 16, cy, {
      size: 13, color: PALETTE.bad, weight: 800,
    });
    cy += 17;
    const hazDesc = haz
      ? haz.desc + (haz.telegraph ? ' You get ' + haz.telegraph + 's of warning.' : ' No warning window — it is always visible.')
      : 'Nothing here is trying to kill you except the enemies. This stage is where you learn.';
    for (const l of this._wrap(r, 'haz' + st.id, hazDesc, innerW, 12)) {
      ui.text(l, x + 16, cy, { size: 12, color: PALETTE.textDim });
      cy += 15;
    }
    cy += 10;

    // Modifier.
    const mod = st.modifier ? d.stages.MODIFIERS[st.modifier] : null;
    ui.text('MODIFIER · ' + (mod ? displayName(mod) : 'NONE'), x + 16, cy, {
      size: 13, color: PALETTE.accent2, weight: 800,
    });
    cy += 17;
    for (const l of this._wrap(r, 'mod' + st.id, mod ? mod.desc : 'The rules are the rules.', innerW, 12)) {
      ui.text(l, x + 16, cy, { size: 12, color: PALETTE.textDim });
      cy += 15;
    }
    cy += 10;

    // Boss + mid-boss.
    const boss = d.bosses.BOSSES_BY_ID[st.boss];
    const mid = d.bosses.BOSSES_BY_ID[st.midBoss];
    if (boss) {
      ui.text('BOSS · ' + fit(r, displayName(boss), innerW - 60, 13), x + 16, cy, {
        size: 13, color: PALETTE.pink, weight: 800,
      });
      cy += 17;
      ui.text(fit(r, '"' + boss.epithet + '" · ' + formatCount(boss.hp) + ' HP', innerW, 12),
        x + 16, cy, { size: 12, color: PALETTE.textDim });
      cy += 16;
    }
    if (mid) {
      ui.text(fit(r, 'MID-BOSS · ' + displayName(mid), innerW, 12), x + 16, cy, {
        size: 12, color: PALETTE.textFaint,
      });
      cy += 18;
    }

    // First clear + your record.
    ui.statRow(e.cleared ? 'FIRST CLEAR (claimed)' : 'FIRST CLEAR REWARD',
      fit(r, this._rewardText(st), innerW * 0.56, 13), x + 16, cy, innerW,
      { color: e.cleared ? PALETTE.textFaint : PALETTE.gold });
    cy += 20;
    ui.statRow('YOUR BEST TIME', e.bestTime ? formatTime(e.bestTime) : 'not yet', x + 16, cy, innerW,
      { color: e.bestTime ? PALETTE.good : PALETTE.textFaint });
    cy += 20;
    ui.statRow('CLEARS', String(e.clears | 0), x + 16, cy, innerW);
    cy += 20;
    if (!unlocked) {
      ui.text('🔒 ' + this._unlockText(st), x + 16, cy, { size: 12, color: PALETTE.bad, weight: 700 });
      cy += 18;
    }
    r.unclip();

    // --- the scroll rail -----------------------------------------------------
    this._detMax = Math.max(0, (cy - top) + 16 - viewH);
    const canScroll = this._detMax > 1;
    this.detScroll = ui.scrollbar('stDetBar', x + w - 16, y + 8, 8, viewH - 16,
      this.detScroll, viewH, viewH + this._detMax);

    const ry = y + h - blockH - 6 - railH;
    const bw = 46, bh = 36;
    const bx = x + w - 12 - bw * 2 - 8;
    // A backing plate, so the scrolled text passes BEHIND the controls instead
    // of running into them.
    ui.panel(x + 2, ry, w - 4, railH - 2, { radius: 10, color: 'rgba(4,6,14,0.94)' });
    ui.text(canScroll ? 'wheel · drag the bar · or' : 'all of it fits', x + 16, ry + railH / 2,
      { size: 11, color: PALETTE.textFaint });
    if (ui.button('stDetUp', bx, ry + 3, bw, bh, '▲', { size: 14, disabled: !canScroll })) {
      this.detScroll -= viewH * 0.6;
    }
    if (ui.button('stDetDn', bx + bw + 8, ry + 3, bw, bh, '▼', { size: 14, disabled: !canScroll })) {
      this.detScroll += viewH * 0.6;
    }
    this.detScroll = clamp(this.detScroll, 0, this._detMax);

    // --- tiers + overtime, pinned to the bottom of the card ------------------
    this._tierBlock(r, x, y + h - blockH, w, blockH);
  },

  _tierBlock(r, x, y, w, h) {
    const st = this._stage();
    const innerW = w - 32;
    ui.text('DIFFICULTY TIER', x + 16, y + 12, { size: 11, color: PALETTE.textFaint, weight: 800 });

    const n = this.tiers.length;
    const gap = 7;
    const tw = (innerW - gap * (n - 1)) / n;
    const ty = y + 24;
    const th = 44;
    const eff = this._effTier();
    let shown = -1;

    for (let i = 0; i < n; i++) {
      const t = this.tiers[i];
      const open = this._tierOpen(i);
      const tx = x + 16 + i * (tw + gap);
      const idx = ui.itemCount;
      if (ui.button('tier' + t.id, tx, ty, tw, th, null, { radius: 8, disabled: !open })) {
        this.tierIndex = i;
      }
      const focused = ui.focus === idx;
      if (focused) shown = i;
      const col = !open ? PALETTE.textFaint : (i === eff ? PALETTE.accent : focused ? PALETTE.text : PALETTE.textDim);
      ui.text((open ? '' : '🔒 ') + this._tierName(i), tx + tw / 2, ty + 16, {
        size: 12, color: col, align: 'center', weight: 800,
      });
      ui.text('HP ×' + t.hpMult + ' · REW ×' + t.rewardMult, tx + tw / 2, ty + 32, {
        size: 10, color: PALETTE.textFaint, align: 'center',
      });
      if (i === eff) r.drawRect(tx + 6, ty + th - 3, tw - 12, 2, PALETTE.accent, 0.9);
    }

    // The honest read-out: whatever tier you are pointing at, or the live one.
    const readIdx = shown >= 0 ? shown : eff;
    const open = this._tierOpen(readIdx);
    const readable = open
      ? this._tierName(readIdx) + ' — ' + this.tiers[readIdx].desc
      : this._tierName(readIdx) + ' — locked. Clear ' + displayName(st) + ' once and every tier opens.';
    ui.text(fit(r, readable, innerW, 11), x + 16, ty + th + 14, {
      size: 11, color: open ? PALETTE.textDim : PALETTE.bad,
    });

    // --- OVERTIME ------------------------------------------------------------
    // DECISIONS.md §32: local personal bests. Never the word "leaderboard".
    const canE = this._canEndless();
    const best = save.data.endless[st.id];
    const bestT = typeof best === 'number' ? best : (best && best.bestTime) || 0;
    const ey = ty + th + 28;
    let sub;
    if (canE) sub = 'PERSONAL BEST ' + (bestT ? formatTime(bestT) : 'none yet') + ' · local only, no leaderboard';
    else if (!save.data.unlocks.endless) sub = 'locked — clear The Zenith Stage to unlock Overtime';
    else sub = 'locked — clear this stage at least once';

    if (ui.button('endless', x + 16, ey, innerW, 40,
      (this._effEndless() ? '✓ ' : '') + 'OVERTIME  ·  ENDLESS', {
        size: 13, disabled: !canE, sub: fit(r, sub, innerW - 20, 11),
      })) {
      this.endless = !this.endless;
      audio.play('uiConfirm');
    }
  },

  // ===========================================================================
  // STEP 2 — CHARACTER
  // ===========================================================================
  _renderChar(r) {
    const W = r.w, H = r.h;
    const pad = clamp(W * 0.02, 14, 30) | 0;
    const headerH = 76;
    const barH = 58;
    const bodyY = headerH;
    const bodyH = Math.max(140, H - headerH - barH - pad);
    const detW = clamp(W * 0.34, 260, 460) | 0;
    const gridW = Math.max(160, W - pad * 2 - detW - 14);
    const detX = pad + gridW + 14;

    const st = this._stage();
    ui.title('CHOOSE YOUR CHARACTER', pad, 34, { size: 26 });
    ui.text(fit(r, displayName(st) + '  ·  ' + this._tierName(this._effTier()) +
      (this._effEndless() ? '  ·  OVERTIME' : '') +
      (this._fixedSeed ? '  ·  ' + this._seedReason + ' SEED ' + this._fixedSeed : ''), W - pad * 2, 12),
      pad, 58, { size: 12, color: PALETTE.textFaint });

    if (this.owned.length === 0) {
      ui.focusGrid(1);
      ui.panel(pad, bodyY, W - pad * 2, 120, { radius: 14 });
      ui.text('Your roster is empty, which should be impossible. Go and pull somebody.',
        pad + 20, bodyY + 50, { size: 15, color: PALETTE.text });
      if (ui.button('togacha', pad + 20, bodyY + 72, 200, 34, 'GACHA MACHINE ›', { size: 13 })) this._go('gacha');
      if (ui.backButton(pad, H - barH + 13)) this._back();
      return;
    }

    // --- grid ---------------------------------------------------------------
    const gap = 10;
    const cardW = clamp(gridW / 4 - gap, 116, 168);
    const cardH = clamp(cardW * 0.86, 104, 146);
    const cols = Math.max(1, Math.floor((gridW + gap) / (cardW + gap)));
    // 44, not 34: the paging buttons below are a real 36px target now.
    const rows = Math.max(1, Math.floor((bodyH - 44 + gap) / (cardH + gap)));
    const pageSize = cols * rows;
    const pages = Math.max(1, Math.ceil(this.owned.length / pageSize));
    if (this.charPage >= pages) this.charPage = pages - 1;
    ui.focusGrid(cols);

    this._preview = null;
    const start = this.charPage * pageSize;
    for (let k = 0; k < pageSize && start + k < this.owned.length; k++) {
      const c = this.owned[start + k];
      const cx = pad + (k % cols) * (cardW + gap);
      const cyy = bodyY + Math.floor(k / cols) * (cardH + gap);
      this._charCard(r, c, cx, cyy, cardW, cardH);
    }
    // Resolve what the detail panel shows: whatever is hovered this frame,
    // otherwise the character actually equipped. Latching `_preview` the first
    // time and never re-reading it was the bug — the panel froze on whoever
    // happened to be focused when the screen opened.
    this._preview = this._hoverPreview || this._byId(this.characterId) || this.owned[0];
    this._hoverPreview = null;

    // --- paging -------------------------------------------------------------
    if (pages > 1) {
      const py = bodyY + rows * (cardH + gap) - gap + 8;
      if (ui.button('pagePrev', pad, py, 100, 36, '‹ PREV', { size: 13, disabled: this.charPage <= 0 })) this.charPage--;
      if (ui.button('pageNext', pad + 108, py, 100, 36, 'NEXT ›', { size: 13, disabled: this.charPage >= pages - 1 })) this.charPage++;
      ui.text('PAGE ' + (this.charPage + 1) + '/' + pages + '  ·  ' + this.owned.length + ' owned',
        pad + 220, py + 18, { size: 11, color: PALETTE.textFaint });
    }

    // --- detail -------------------------------------------------------------
    this._charDetail(r, this._preview, detX, bodyY, detW, bodyH);

    // --- bottom bar ---------------------------------------------------------
    const by = H - barH + 10;
    const startW = clamp(W * 0.20, 190, 260) | 0;
    const picked = this._byId(this.characterId);
    ui.text(fit(r, picked ? 'Taking ' + displayName(picked) + ' to ' + displayName(st) : 'Pick somebody first',
      W - pad * 2 - startW - 130, 13), pad + 110, by + 20, { size: 13, color: PALETTE.textDim });

    if (ui.button('start', W - pad - startW, by, startW, 40, 'START RUN ▶', {
      size: 16, disabled: !this.characterId,
    })) this._start();

    if (ui.backButton(pad, by + 3)) this._back();
  },

  _back() {
    audio.play('uiBack');
    this.mode = 'stage';
    this._restoreFocus = this._stageFocus;
    this._preview = null;
  },

  _byId(id) {
    return this.manager.data.characters.CHARACTERS_BY_ID[id] || null;
  },

  _charCard(r, c, x, y, w, h) {
    const e = this._roster(c.id);
    const col = RARITY_COLOR[c.rarity] || PALETTE.border;
    const idx = ui.itemCount;
    const hit = ui.button('c' + c.id, x, y, w, h, null, { radius: 12 });
    const focused = ui.focus === idx;
    // Hovering PREVIEWS; the detail panel falls back to the equipped character
    // whenever nothing is hovered (see _charStep), so clicking is always
    // reflected even if the pointer then wanders off the grid.
    if (focused) this._hoverPreview = c;
    const selected = this.characterId === c.id;

    // Rarity wash + frame, drawn over the button's own focus panel.
    r.drawRoundRect(x + 2, y + 2, w - 4, h * 0.34, 10, col, 0.12);
    ui.panel(x, y, w, h, {
      color: 'rgba(0,0,0,0)', borderColor: selected ? PALETTE.accent : col,
      borderWidth: selected ? 3 : 2, radius: 12,
    });

    openCull(r);
    const sp = atlas.ensure(c.visual);
    const s = clamp((h * 0.42) / sp.h, 0.6, 1.9);
    r.drawSprite(sp, x + w / 2, y + h * 0.34, 0, s, 1, false, 0);
    r.setAlpha(1);

    ui.text(fit(r, displayName(c), w - 14, 12), x + w / 2, y + h * 0.66, {
      size: 12, color: focused ? PALETTE.accent : PALETTE.text, align: 'center', weight: 800,
    });
    ui.text(RARITY_NAME[c.rarity] + ' · S' + e.starLevel, x + w / 2, y + h * 0.80, {
      size: 11, color: col, align: 'center', weight: 700,
    });
    ui.text(selected ? '✓ EQUIPPED' : 'bond ' + (e.bond | 0) + ' · ' + (e.runs | 0) + ' runs',
      x + w / 2, y + h - 12, {
        size: 10, color: selected ? PALETTE.accent : PALETTE.textFaint,
        align: 'center', weight: selected ? 800 : 500,
      });

    if (hit) {
      this.characterId = c.id;
      this.manager.shared.characterId = c.id;
      // Equipping is authoritative — the detail panel switches immediately
      // rather than waiting for the pointer to move.
      this._preview = c;
      this._hoverPreview = c;
    }
  },

  /**
   * Four ability blocks plus both build paths, in a panel that was clipped with
   * no scroll of any kind — on anything shorter than about 900px the PASSIVE and
   * the build paths were simply not on the screen. It scrolls now.
   */
  _charDetail(r, c, x, y, w, h) {
    ui.panel(x, y, w, h, { radius: 14, color: 'rgba(8,10,20,0.88)' });

    const railH = 42;
    const viewH = Math.max(40, h - railH);
    const id = c ? c.id : null;
    // A different character is a different document: start it at the top.
    if (this._charScrollFor !== id) { this._charScrollFor = id; this.charScroll = 0; }

    if (input.wheel && ui.pointIn(x, y, w, viewH)) this.charScroll += input.wheel * 48;
    this.charScroll = clamp(this.charScroll, 0, this._charMax);

    const innerW = w - 32 - 14;
    const top = y + 24 - this.charScroll;
    let cy = top;

    if (c) {
      const d = this.manager.data;
      const e = this._roster(c.id);
      const col = RARITY_COLOR[c.rarity] || PALETTE.text;
      r.clipRect(x + 2, y + 2, w - 4, viewH);

      ui.text(RARITY_NAME[c.rarity] + '  ·  STAR LEVEL ' + e.starLevel + '/5  ·  ' + c.archetype.toUpperCase(),
        x + 16, cy, { size: 11, color: col, weight: 800 });
      cy += 24;
      ui.title(fit(r, displayName(c), innerW, 20), x + 16, cy, { size: 20, color: col });
      cy += 22;
      ui.text(fit(r, c.epithet, innerW, 13), x + 16, cy, { size: 13, color: PALETTE.textDim });
      cy += 22;

      const el = d.elements.ELEMENTS[c.element];
      const s = c.stats;
      ui.text((el ? el.icon + ' ' + displayName(el).toUpperCase() : c.element) +
        '  ·  ' + s.hp + ' HP  ·  ' + s.moveSpeed + ' SPD  ·  ' +
        Math.round(s.critChance * 100) + '% CRIT  ·  ×' + s.damageMult + ' DMG',
        x + 16, cy, { size: 11, color: el ? el.color : PALETTE.textDim, weight: 700 });
      cy += 16;
      r.drawLine(x + 16, cy, x + 16 + innerW, cy, PALETTE.border, 1, 1);
      cy += 14;

      cy = this._ability(r, c, 'AUTO', c.autoAttack,
        c.autoAttack.damage + ' dmg every ' + c.autoAttack.interval + 's', x, cy, innerW, PALETTE.accent2);
      cy = this._ability(r, c, 'SPECIAL', c.special,
        c.special.cooldown + 's cooldown', x, cy, innerW, PALETTE.accent);
      cy = this._ability(r, c, 'ESCAPE', c.escape,
        (c.escape.cooldown > 0 ? c.escape.cooldown + 's cd' : 'no cd') +
        ' · ' + (c.escape.iframes || 0) + 's i-frames', x, cy, innerW, PALETTE.good);
      cy = this._ability(r, c, 'PASSIVE', c.passive, '', x, cy, innerW, PALETTE.pink);

      ui.text('BUILD PATHS', x + 16, cy, { size: 11, color: PALETTE.textFaint, weight: 800 });
      cy += 16;
      const paths = c.buildPaths || [];
      for (let i = 0; i < paths.length; i++) {
        const lines = this._wrap(r, 'bp' + c.id + i, paths[i], innerW - 12, 11);
        for (let j = 0; j < lines.length; j++) {
          ui.text((j === 0 ? '▸ ' : '   ') + lines[j], x + 16, cy, { size: 11, color: PALETTE.textDim });
          cy += 14;
        }
        cy += 4;
      }
      r.unclip();
    }

    // --- the scroll rail -----------------------------------------------------
    // Declared unconditionally, so the focus index layout does not shift when a
    // short sheet stops being scrollable.
    this._charMax = Math.max(0, (cy - top) + 16 - viewH);
    const canScroll = this._charMax > 1;
    this.charScroll = ui.scrollbar('chDetBar', x + w - 16, y + 8, 8, viewH - 16,
      this.charScroll, viewH, viewH + this._charMax);

    const ry = y + h - railH;
    const bw = 46, bh = 36;
    const bx = x + w - 12 - bw * 2 - 8;
    ui.panel(x + 2, ry, w - 4, railH - 2, { radius: 10, color: 'rgba(4,6,14,0.94)' });
    ui.text(canScroll ? 'wheel · drag the bar · or' : 'all of it fits', x + 16, ry + railH / 2,
      { size: 11, color: PALETTE.textFaint });
    if (ui.button('chDetUp', bx, ry + 3, bw, bh, '▲', { size: 14, disabled: !canScroll })) {
      this.charScroll -= viewH * 0.6;
    }
    if (ui.button('chDetDn', bx + bw + 8, ry + 3, bw, bh, '▼', { size: 14, disabled: !canScroll })) {
      this.charScroll += viewH * 0.6;
    }
    this.charScroll = clamp(this.charScroll, 0, this._charMax);
  },

  _ability(r, c, tag, ab, meta, x, cy, innerW, color) {
    if (!ab) return cy;
    ui.text(tag + ' · ' + fit(r, displayName(ab), innerW - 80, 13), x + 16, cy, {
      size: 13, color, weight: 800,
    });
    if (meta) {
      ui.text(meta, x + 16 + innerW, cy, { size: 11, color: PALETTE.textFaint, align: 'right', mono: true });
    }
    cy += 16;
    for (const l of this._wrap(r, 'ab' + c.id + tag, ab.desc, innerW, 11)) {
      ui.text(l, x + 16, cy, { size: 11, color: PALETTE.textDim });
      cy += 13;
    }
    return cy + 9;
  },
};
