// The post-run screen.
//
// SECTION 12 (prompt lines 1601-1605): "Time survived, level reached, kills,
// damage dealt, DPS graph over time, gold earned, Star Fragments earned, relics
// found, and the killing blow that ended you (with a screenshot-style freeze
// frame). Then a big juicy currency-tick animation. Make losing feel like
// progress, because it is."
//
// THIS SCREEN IS THE PAYOUT WINDOW. Nothing else in the codebase credits the
// run's gold, the completion/death fragment award, the first-clear bonus or the
// daily-first-win bonus, so all of it happens here, exactly once, in enter().
// SECTION 2 is explicit that dying never voids a run's rewards — a defeat is
// paid out on the same code path as a victory, only the fragment line differs
// (FRAGMENT_AWARDS.runFailed 4 vs runCompleted 8, DECISIONS.md §1).
//
// DOUBLE-PAY GUARD: enter() can be re-run (a cross-fade back, a hot reload, a
// scene registered twice), so the award is stamped onto the summary object
// itself. The same object can never be paid twice, and a genuinely new run
// always carries a fresh object from Run.summary().
//
// WHAT THIS SCREEN DELIBERATELY DOES NOT TOUCH:
//   save.data.stats.runs      runScene.enter() already counts the run on START,
//                             which is the only counter that survives a quit.
//   save.data.stats.bossKills run.js onEnemyDeath() already increments it per
//                             boss. Adding summary.bosses here would double every
//                             boss in the game and halve the 'boss_kills_10' gate.
//
// SECTION 19: the defeat copy is warm. `summary.killedBy` is already an authored
// phrase from Run._describeKiller ("a crowd you could not read"), presented in a
// freeze-frame film card — a record of what happened, never a taunt.

import { ui, PALETTE, wrapText, ellipsize } from '../ui/widgets.js';
import { save, addCurrency, rosterEntry, stageEntry } from '../core/save.js';
import { audio } from '../core/audio.js';
import { displayName } from '../core/config.js';
import { clamp, easeOutCubic, formatTime, withAlpha } from '../core/math.js';
import { recordRun } from '../game/quests.js';

/** The currency count-up. SECTION 12 asks for "big juicy"; 1.2s is the sweet spot. */
const TICK_DUR = 1.2;
/** Gap between rising ticks while the counter runs. */
const TICK_SFX_GAP = 0.045;

const GOLD_ICON = '🪙';
const FRAG_ICON = '💎';

// Upgrade tiers -> card colour. Matches the level-up screen's frame colours.
const TIER_COLOR = { common: '#e8ecf5', rare: '#6ad8ff', epic: '#c58cff' };
// Relic rarities are strings, not the 3-6 star scale, so RARITY_COLOR is wrong here.
const RELIC_COLOR = { rare: '#6ad8ff', epic: '#c58cff', legendary: '#ffd76a' };

// SECTION 19 — affectionate, never mocking. Losing is a cliffhanger, not a verdict.
const DEFEAT_SUBS = [
  'The episode ends. The series does not.',
  'Everything you earned is already banked. Nothing was voided.',
  'You now know something about that stage that you did not know an hour ago.',
  'You got further into that fight than the fight was expecting.',
  'The training arc is just the part that happens before the montage.',
  'Same character, same stage, new seed. The offer is right there.',
];

const VICTORY_SUBS = [
  'Roll credits. Stay through them, there is a sting.',
  'The stage is clear and the crowd has not sat back down.',
  'Nobody in the building is pretending that was luck.',
  'That is a wrap. Someone is already storyboarding the sequel.',
];

/** Thousands-separated, no locale surprises. SECTION 13: real numbers, always. */
function groupNum(n) {
  const v = Math.round(n || 0);
  const neg = v < 0;
  let s = String(Math.abs(v));
  let out = '';
  while (s.length > 3) { out = ',' + s.slice(-3) + out; s = s.slice(0, -3); }
  return (neg ? '-' : '') + s + out;
}

/**
 * `some_upgrade_id` -> "Some upgrade id".
 *
 * Only ever seen when a run reports something this build has no definition for —
 * a weapon from a newer system, a save written by a later version. Printing the
 * raw snake_case id is how the screen admits it does not know, badly; this is
 * how it admits it politely.
 */
function humaniseId(id) {
  const s = String(id).replace(/[_-]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
}

/** Deterministic pick so the headline does not reshuffle every frame. */
function pick(list, seed) {
  const n = list.length;
  if (!n) return '';
  const i = Math.abs((seed | 0) % n);
  return list[i];
}

/** Drifting background motes. Built once in enter(); render() only does maths. */
function buildMotes(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: Math.random(), y: Math.random(),
      r: 1 + Math.random() * 2.6,
      spd: 0.012 + Math.random() * 0.030,
      amp: 0.008 + Math.random() * 0.026,
      ph: Math.random() * Math.PI * 2,
      a: 0.08 + Math.random() * 0.20,
    });
  }
  return out;
}

export const resultsScene = {
  manager: null,

  // --- lifecycle --------------------------------------------------------------
  enter(params, mgr) {
    if (mgr) this.manager = mgr;
    this.mgr = this.manager;

    const shared = (this.manager && this.manager.shared) || {};
    const s = shared.lastResult || null;
    this.s = s;

    this.t = 0;
    this.tickT = 0;
    this._sfxT = 0;
    this._tickDone = false;
    this._grad = null;
    this.motes = buildMotes(48);

    // Empty defaults so render() is safe even with no run data at all.
    this.award = { gold: 0, frag: 0, lines: [] };
    this.unlockLines = [];
    this.build = [];
    this.weaponRows = [];
    this.weaponMax = 3;
    this.relicRows = [];
    this.evoRows = [];
    this.graph = null;
    this.headline = 'NO RUN DATA';
    this.subline = 'Nothing to report. Head back to the studio.';
    this.charDef = null;
    this.stageDef = null;
    this.tierDef = null;
    this.tierIndex = 0;
    this.bondLine = '';
    this.firstClear = false;

    if (!s) return;

    const D = this.manager.data;
    this.stageDef = D.stages.STAGES_BY_ID[s.stage] || null;
    this.charDef = D.characters.CHARACTERS_BY_ID[s.character] || null;

    const tiers = D.stages.DIFFICULTY_TIERS;
    let ti = 0;
    for (let i = 0; i < tiers.length; i++) if (tiers[i].id === s.tier) { ti = i; break; }
    this.tierIndex = ti;
    this.tierDef = tiers[ti];

    this.headline = s.victory ? 'VICTORY' : 'TO BE CONTINUED';
    this.subline = s.victory ? pick(VICTORY_SUBS, s.seed) : pick(DEFEAT_SUBS, s.seed);

    this._buildLists(D, s);
    this._buildGraph(s);
    this._payout(D, s);
  },

  exit() {
    // Nothing to release: no timers, no listeners, no run.
  },

  // --- one-time payout --------------------------------------------------------
  /**
   * Credits every reward this run earned and folds it into the save blob.
   * Guarded by a stamp on the summary object so re-entering cannot double-pay.
   */
  _payout(D, s) {
    const FA = D.shrine.FRAGMENT_AWARDS;
    const stageSave = stageEntry(s.stage);
    const alreadyPaid = s._rewarded === true;

    // --- what the run is worth ------------------------------------------------
    const gold = Math.max(0, Math.round(s.gold || 0));
    const lines = [];

    // Boss fragments were banked into the run itself (run.js onEnemyDeath).
    let frag = Math.max(0, Math.round(s.fragments || 0));
    if (frag > 0) lines.push({ label: (s.bosses || 0) + ' boss' + ((s.bosses === 1) ? '' : 'es') + ' felled', v: frag });

    const completion = s.victory ? FA.runCompleted : FA.runFailed;
    frag += completion;
    lines.push({
      label: s.victory ? 'run completed' : 'run ended early — paid in full anyway',
      v: completion,
    });

    // First clear of this stage. The stage authors its own bonus (50💎, or 200💎
    // for the Zenith Stage); FRAGMENT_AWARDS.firstClear is the fallback.
    // On a re-entry `cleared` is already true, so the answer is read back off the
    // summary rather than recomputed — the callout must not vanish on a revisit.
    const firstClear = alreadyPaid ? !!s._firstClear : (!!s.victory && !stageSave.cleared);
    if (!alreadyPaid) s._firstClear = firstClear;
    this.firstClear = firstClear;
    const fcr = (this.stageDef && this.stageDef.firstClearReward) || null;
    if (firstClear) {
      const bonus = (fcr && fcr.starFragments) || FA.firstClear;
      frag += bonus;
      lines.push({ label: 'FIRST CLEAR of this stage', v: bonus, hot: true });
    }

    // Daily first win. DECISIONS.md §1 prices it at 30💎 and nothing else claims it.
    const day = Math.floor(Date.now() / 86400000);
    const dailyWin = alreadyPaid
      ? !!s._dailyWin
      : (!!s.victory && save.data.daily.lastWinDay !== day);
    if (!alreadyPaid) s._dailyWin = dailyWin;
    if (dailyWin) { frag += FA.dailyFirstWin; lines.push({ label: 'first win today', v: FA.dailyFirstWin, hot: true }); }

    this.award = { gold, frag, lines };

    if (alreadyPaid) { this._buildUnlockLines(D, s, fcr, false); return; }
    s._rewarded = true;

    // --- credit it ------------------------------------------------------------
    addCurrency('gold', gold);
    addCurrency('starFragments', frag);
    // The claim ticket runScene wrote at run end has now been honoured.
    save.data.pendingRun = null;
    if (dailyWin) save.data.daily.lastWinDay = day;

    // --- lifetime stats -------------------------------------------------------
    // NOTE: `runs` is counted by runScene.enter() and `bossKills` by run.js. See
    // the file header — incrementing either here would double-count it.
    const S = save.data.stats;
    if (s.victory) S.wins = (S.wins | 0) + 1; else S.deaths = (S.deaths | 0) + 1;
    S.kills = (S.kills | 0) + (s.kills | 0);
    S.damage = (S.damage || 0) + (s.damageDealt || 0);
    S.levelUps = (S.levelUps | 0) + (s.levelUps | 0);
    S.highestLevel = Math.max(S.highestLevel | 0, s.level | 0);
    S.longestRun = Math.max(S.longestRun || 0, s.time || 0);
    // The per-run maxima the quest ledger cannot derive from a lifetime total.
    recordRun(s);

    // --- per-stage record -----------------------------------------------------
    // bestTime is a MAXIMUM (longest survived), matching stats.longestRun in the
    // same blob, so it is meaningful on a stage you have not cleared yet.
    stageSave.bestTime = Math.max(stageSave.bestTime || 0, s.time || 0);
    if (s.victory) {
      stageSave.cleared = true;
      stageSave.clears = (stageSave.clears | 0) + 1;
      if (this.tierIndex > (stageSave.bestTier === undefined ? -1 : stageSave.bestTier)) {
        stageSave.bestTier = this.tierIndex;
      }
    }

    // --- the character who ran it ---------------------------------------------
    const bondRun = D.shrine.BOND_PER_RUN;
    const bondBoss = D.shrine.BOND_PER_BOSS;
    const re = rosterEntry(s.character);
    const bondBefore = re.bond | 0;
    re.runs = (re.runs | 0) + 1;
    re.kills = (re.kills | 0) + (s.kills | 0);
    re.bond = bondBefore + bondRun + (s.bosses | 0) * bondBoss;
    // achievements.js reads roster[id].wins for `characterWins`; nothing else writes it.
    if (s.victory) re.wins = (re.wins | 0) + 1;
    this.bondLine = 'BOND ' + bondBefore + ' → ' + re.bond + ' (+' + (re.bond - bondBefore) + ')';

    for (const tier of D.shrine.BOND_LEVELS) {
      if (bondBefore < tier.level && re.bond >= tier.level) {
        this.manager.toast('Bond ' + tier.level + ' — ' + tier.desc, '#ff5fa2', '💞');
      }
    }

    // --- relics you actually held are relics you own --------------------------
    for (const id of s.relics || []) {
      const e = save.data.relics[id] || (save.data.relics[id] = { owned: false, banked: false });
      e.owned = true;
      save.data.codex.relics[id] = true;
    }

    // --- first-clear unlocks ---------------------------------------------------
    if (firstClear && fcr) {
      if (fcr.relic) {
        const e = save.data.relics[fcr.relic] || (save.data.relics[fcr.relic] = { owned: false, banked: false });
        e.owned = true;
        save.data.codex.relics[fcr.relic] = true;
      }
      if (fcr.unlocksEndless) save.data.unlocks.endless = true;
    }

    this._buildUnlockLines(D, s, fcr, true);

    if (firstClear && this.stageDef) {
      this.manager.toast('FIRST CLEAR — ' + displayName(this.stageDef), PALETTE.accent, '🏁');
    }

    // QUESTS settle here, after every counter this run moved has been written.
    // Doing it before the stats block above would pay out against last run's
    // numbers, which is exactly the sort of off-by-one nobody ever notices.
    this.questsPaid = this.manager.settleQuests ? this.manager.settleQuests() : [];

    // Run-scoped achievements evaluate against the finished summary.
    if (this.manager.achievements && this.manager.achievements.checkRunEnd) {
      this.manager.achievements.checkRunEnd(s);
    }

    save.save();
  },

  /** The "here is what that unlocked" callout. Cached — never rebuilt in render. */
  _buildUnlockLines(D, s, fcr, announce) {
    const out = [];
    if (!this.firstClear) { this.unlockLines = out; return; }

    if (fcr && fcr.relic) {
      const rel = D.relics.RELICS_BY_ID[fcr.relic];
      if (rel) out.push((rel.icon || '◆') + ' ' + displayName(rel) + ' added to your relic pool');
    }
    if (fcr && fcr.unlocksEndless) out.push('♾ ENDLESS MODE is open');

    // Difficulty tiers unlock per stage on that stage's first clear (SECTION 7).
    const tiers = D.stages.DIFFICULTY_TIERS;
    if (tiers.length > 1) {
      const names = [];
      for (let i = 1; i < tiers.length; i++) names.push(tiers[i].name);
      out.push('⚔ Difficulty tiers unlocked here: ' + names.join(', '));
    }

    // Any stage whose unlock requirements are now fully satisfied.
    for (const st of D.stages.STAGES) {
      if (st.id === s.stage) continue;
      const req = (st.unlock && st.unlock.stages) || [];
      if (req.length === 0) continue;
      if (req.indexOf(s.stage) < 0) continue;
      let ok = true;
      for (const need of req) {
        const e = save.data.stages[need];
        if (!e || !e.cleared) { ok = false; break; }
      }
      if (ok) out.push('▶ STAGE UNLOCKED: ' + displayName(st));
    }

    this.unlockLines = out;
    // Only genuinely NEW stages get a toast. The rest is already shouting from the
    // gold callout strip, and the toast queue caps at four — achievement unlocks
    // must not get evicted by things the player can already see.
    if (announce) {
      for (const line of out) {
        if (line.indexOf('STAGE UNLOCKED') >= 0 || line.indexOf('ENDLESS') >= 0) {
          this.manager.toast(line, PALETTE.accent2, '🔓');
        }
      }
    }
  },

  // --- cached view lists ------------------------------------------------------
  /**
   * AN UNKNOWN ID IS NOT AN ERROR. A run summary can legitimately name something
   * this build has no definition for — the weapon system's entries arrive in
   * `summary.upgrades` the same way, and a save can outlive a downgrade. Every
   * list below degrades to "a readable name and the level we were told", never
   * to a raw id claiming a level cap nobody can see.
   */
  _buildLists(D, s) {
    // The arsenal, straight off the run summary. A weapon's display name is
    // resolved during the run (the signature borrows the character's own
    // attack name) so this list needs no lookup and cannot drift.
    this.weaponRows = (s.weapons || []).map((w) => ({
      icon: w.icon || '⚔',
      name: String(w.name || '').split(' [')[0],
      level: w.level, max: w.maxLevel, evolved: !!w.evolved, signature: !!w.signature,
    }));
    this.weaponMax = (D.weapons && D.weapons.WEAPON_SLOTS) || 3;

    const relics = [];
    for (const id of s.relics || []) {
      const rel = D.relics.RELICS_BY_ID[id];
      relics.push({
        icon: (rel && rel.icon) || '◆',
        name: rel ? displayName(rel) : humaniseId(id),
        color: (rel && RELIC_COLOR[rel.rarity]) || PALETTE.text,
      });
    }
    this.relicRows = relics;

    const evos = [];
    for (const id of s.evolutions || []) {
      const ev = D.evolutions.EVOLUTIONS_BY_ID[id];
      evos.push({ icon: (ev && ev.icon) || '✦', name: ev ? displayName(ev) : humaniseId(id) });
    }
    this.evoRows = evos;

    const build = [];
    const byId = D.upgrades.UPGRADES_BY_ID;
    for (const id in s.upgrades || {}) {
      const lvl = s.upgrades[id] | 0;
      if (lvl <= 0) continue;
      const u = byId[id];
      // `max = lvl` was the old fallback, which made every unknown id render as
      // permanently MAXED in gold. max 0 means "cap unknown": the row prints
      // "Lv 3" instead of "3/3" and is never dressed up as a finished build.
      const max = (u && u.maxLevel) || 0;
      build.push({
        icon: (u && u.icon) || '•',
        name: u ? displayName(u) : humaniseId(id),
        lvl,
        max,
        label: max ? lvl + '/' + max : 'Lv ' + lvl,
        maxed: max > 0 && lvl >= max,
        color: (u && TIER_COLOR[u.tier]) || PALETTE.text,
      });
    }
    // Maxed first (they are the evolution ingredients), then by raw level. An
    // unknown cap sorts as "not close to done" rather than as NaN/Infinity.
    build.sort((a, b) => {
      const fa = a.max ? a.lvl / a.max : 0;
      const fb = b.max ? b.lvl / b.max : 0;
      return (fb - fa) || (b.lvl - a.lvl);
    });
    this.build = build;
  },

  /**
   * Down-samples dpsSamples (one per second, so a 20-minute run is 1,200 of them)
   * to at most 360 buckets by MAXIMUM, which preserves the peak exactly.
   */
  _buildGraph(s) {
    const src = s.dpsSamples || [];
    const n = src.length;
    if (n === 0) { this.graph = null; return; }

    let peakVal = 0, peakIdx = 0;
    for (let i = 0; i < n; i++) {
      const v = src[i] || 0;
      if (v > peakVal) { peakVal = v; peakIdx = i; }
    }

    const BUCKETS = 360;
    const step = Math.max(1, Math.ceil(n / BUCKETS));
    const pts = [];
    for (let i = 0; i < n; i += step) {
      let m = 0;
      for (let j = i; j < i + step && j < n; j++) if ((src[j] || 0) > m) m = src[j];
      pts.push(m);
    }

    // Sample i covers second i+1; map proportionally so a non-1Hz sampler still
    // lands the marker on the right clock time.
    const peakT = n > 0 ? ((peakIdx + 1) / n) * (s.time || n) : 0;
    // The marker is pinned to the BUCKET that holds the peak, not to the raw
    // sample index, so it sits exactly on a vertex of the drawn line. Because the
    // down-sample takes the maximum, that vertex IS the peak value.
    const peakBucket = Math.floor(peakIdx / step);

    this.graph = {
      pts,
      n,
      // Scaled to the samples the chart actually draws. summary.dpsPeak is
      // reported separately in the stat panel; the axis never claims to show it.
      max: Math.max(peakVal, 1),
      peakVal,
      peakT: Math.min(peakT, s.time || peakT),
      peakFrac: pts.length > 1 ? peakBucket / (pts.length - 1) : 1,
      avg: s.dpsTotal || 0,
      duration: s.time || n,
    };
  },

  // --- update -----------------------------------------------------------------
  update(dt) {
    this.t += dt;
    if (!this.s) return;

    const total = this.award.gold + this.award.frag;
    if (total <= 0) { this.tickT = TICK_DUR; this._tickDone = true; return; }

    if (this.tickT < TICK_DUR) {
      this.tickT += dt;
      this._sfxT += dt;
      if (this.tickT >= TICK_DUR) {
        this.tickT = TICK_DUR;
        if (!this._tickDone) { this._tickDone = true; audio.play('chest'); }
      } else if (this._sfxT >= TICK_SFX_GAP) {
        this._sfxT = 0;
        // A rising tick: the pitch climbs with the counter, so the payout reads
        // as "going up" even with the numbers off screen.
        const p = this.tickT / TICK_DUR;
        audio.tone({ type: 'square', freq: 520 + p * 940, dur: 0.028, gain: 0.045 });
      }
    }
  },

  // --- render -----------------------------------------------------------------
  clearColor() { return '#05060d'; },
  resize() { this._grad = null; },

  render(r, alpha) {
    ui.begin(r, 'results');
    ui.focusGrid(1);

    const W = r.w, H = r.h;
    const pad = Math.round(clamp(W * 0.022, 12, 28));

    this._backdrop(r, W, H);

    if (!this.s) {
      ui.title('NOTHING TO REPORT', W / 2, H * 0.42, { size: 40, align: 'center', color: PALETTE.textDim });
      ui.text('No run summary was handed to this screen.', W / 2, H * 0.42 + 40,
        { size: 15, align: 'center' });
      const bw = Math.min(240, W - pad * 2), bh = 54;
      if (ui.button('hub', (W - bw) / 2, H * 0.42 + 74, bw, bh, 'BACK TO THE STUDIO')) this.manager.go('hub');
      if (ui.backButton(pad, pad)) this.manager.go('hub');
      ui.end();
      return;
    }

    const s = this.s;
    const S = clamp(Math.min(W / 1280, H / 760), 0.62, 1.15);

    // --- frame -----------------------------------------------------------------
    const headerH = Math.round(clamp(H * 0.15, 74, 112));
    const footerH = Math.round(clamp(H * 0.11, 62, 86));
    const calloutH = this.unlockLines.length ? Math.round(clamp(H * 0.10, 54, 78)) : 0;
    const bodyY = pad + headerH + 8;
    const bodyH = Math.max(120, H - bodyY - footerH - (calloutH ? calloutH + 8 : 0) - pad);

    const gap = 12;
    const totalW = W - pad * 2;
    const leftW = Math.round(totalW * 0.30);
    const rightW = Math.round(totalW * 0.27);
    const midW = Math.max(180, totalW - leftW - rightW - gap * 2);
    const leftX = pad;
    const midX = leftX + leftW + gap;
    const rightX = midX + midW + gap;

    this._header(r, s, pad, pad, W - pad * 2, headerH, S);

    // --- left: the freeze frame, then the hard numbers -------------------------
    // Every split below leaves the SECOND panel a floor, so a short viewport eats
    // into the decorative half (the film cell) before it eats the numbers.
    let frameH = Math.round(clamp(bodyH * 0.34, 118, 240));
    if (bodyH - frameH - gap < 150) frameH = Math.max(70, bodyH - gap - 150);
    this._freezeFrame(r, s, leftX, bodyY, leftW, frameH, S);
    this._statPanel(r, s, leftX, bodyY + frameH + gap, leftW, bodyH - frameH - gap, S);

    // --- middle: the DPS graph, then the payout --------------------------------
    let graphH = Math.round(clamp(bodyH * 0.54, 180, 420));
    if (bodyH - graphH - gap < 118) graphH = Math.max(110, bodyH - gap - 118);
    this._dpsGraph(r, midX, bodyY, midW, graphH, S);
    this._rewards(r, s, midX, bodyY + graphH + gap, midW, bodyH - graphH - gap, S);

    // --- right: what you were running ------------------------------------------
    // Weapons lead the column: they are the loudest thing that happened during
    // the run and the first thing a player wants to see again afterwards.
    const wepH = Math.round(clamp(bodyH * 0.22, 86, 140));
    const relicH = Math.round(clamp(bodyH * 0.22, 84, 150));
    const evoH = Math.round(clamp(bodyH * 0.17, 70, 124));
    this._weaponPanel(r, rightX, bodyY, rightW, wepH);
    this._relicPanel(r, rightX, bodyY + wepH + gap, rightW, relicH);
    this._evoPanel(r, rightX, bodyY + wepH + relicH + gap * 2, rightW, evoH);
    this._buildPanel(r, rightX, bodyY + wepH + relicH + evoH + gap * 3, rightW,
      bodyH - wepH - relicH - evoH - gap * 3);

    // --- callout ----------------------------------------------------------------
    if (calloutH) this._callout(r, pad, bodyY + bodyH + 8, W - pad * 2, calloutH);

    // --- footer -----------------------------------------------------------------
    this._footer(r, s, pad, H - pad - Math.min(56, footerH - 16), W, H, footerH, pad);

    // Back affordance is declared LAST so RETRY holds focus 0 on entry, but it is
    // still drawn top-left and still answers ESC / gamepad B (SECTION 13).
    if (ui.backButton(pad, pad + Math.round(headerH * 0.5) - 17)) {
      audio.play('uiBack');
      this.manager.go('hub');
    }

    ui.end();
  },

  // --- pieces -----------------------------------------------------------------
  _backdrop(r, W, H) {
    const s = this.s;
    const win = !!(s && s.victory);
    const pal = this.stageDef && this.stageDef.palette;
    const wash = win ? PALETTE.accent : (pal && pal.accent) || PALETTE.pink;

    // A soft top-down wash in the stage's own colour so the screen still feels
    // like the place you just fought in.
    r.drawRect(0, 0, W, H * 0.62, wash, 0.045);
    r.drawRect(0, 0, W, 3, wash, win ? 0.9 : 0.5);

    const t = this.t;
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      let y = m.y - t * m.spd;
      y -= Math.floor(y);
      const x = (m.x + Math.sin(t * 0.5 + m.ph) * m.amp);
      r.drawCircle(x * W, y * H, m.r, wash, m.a * (win ? 1 : 0.7));
    }
    r.vignette('rgba(3,4,10,0.92)', 0.55);
  },

  _header(r, s, x, y, w, h, S) {
    const win = !!s.victory;
    const cy = y + h * 0.5;
    const tx = x + 112;

    ui.title(this.headline, tx, cy - h * 0.16, {
      size: clamp(46 * S, 24, 52),
      color: win ? PALETTE.accent : PALETTE.pink,
      outline: true,
    });
    ui.text(this.subline, tx, cy + h * 0.22, {
      size: clamp(15 * S, 11, 16), color: PALETTE.textDim, weight: 600,
    });

    // Right-hand run identity block. Real names via displayName, always.
    const rx = x + w;
    const charName = this.charDef ? displayName(this.charDef) : s.character;
    const stageName = this.stageDef ? displayName(this.stageDef) : s.stage;
    const tierName = this.tierDef ? this.tierDef.name : s.tier;

    ui.text(charName, rx, cy - h * 0.24, {
      size: clamp(20 * S, 14, 22), color: PALETTE.text, weight: 800, align: 'right',
    });
    ui.text(stageName + '  ·  ' + tierName, rx, cy + h * 0.02, {
      size: clamp(14 * S, 11, 15), color: PALETTE.textDim, align: 'right',
    });
    ui.text('seed ' + (s.seed >>> 0), rx, cy + h * 0.26, {
      size: 11, color: PALETTE.textFaint, align: 'right', mono: true,
    });
  },

  /**
   * The screenshot-style freeze frame SECTION 12 asks for: a film cell with
   * sprocket holes, letterboxing and a timecode. It records the killing blow.
   * It never editorialises about it.
   */
  _freezeFrame(r, s, x, y, w, h, S) {
    const win = !!s.victory;
    const accent = win ? PALETTE.accent : PALETTE.bad;
    ui.panel(x, y, w, h, { color: 'rgba(8,10,20,0.94)', borderColor: accent, borderWidth: 2 });

    const px = x + 14, py = y + 30, pw = w - 28, ph = h - 30 - 62;
    if (pw <= 0 || ph <= 0) return;

    ui.text(win ? 'CLOSING FRAME' : 'FINAL FRAME', x + 14, y + 16,
      { size: 11, color: accent, weight: 800 });
    ui.text(formatTime(s.time) + ' · LV ' + (s.level | 0), x + w - 14, y + 16,
      { size: 11, color: PALETTE.textFaint, align: 'right', mono: true });

    // The cell itself.
    r.drawRect(px, py, pw, ph, '#03040a', 1);
    r.drawRect(px, py, pw, Math.max(6, ph * 0.10), 'rgba(0,0,0,0.85)', 1);
    r.drawRect(px, py + ph - Math.max(6, ph * 0.10), pw, Math.max(6, ph * 0.10), 'rgba(0,0,0,0.85)', 1);

    // Sprocket holes down both edges.
    const holes = Math.max(3, Math.floor(ph / 20));
    for (let i = 0; i < holes; i++) {
      const hy = py + 6 + (ph - 12) * (i / Math.max(1, holes - 1)) - 3;
      r.drawRoundRect(px + 3, hy, 5, 6, 2, 'rgba(140,155,200,0.28)', 1);
      r.drawRoundRect(px + pw - 8, hy, 5, 6, 2, 'rgba(140,155,200,0.28)', 1);
    }

    // The subject: you, mid-frame, at the moment the shutter closed.
    const cx = px + pw * 0.5, cy = py + ph * 0.5;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 2.2);
    r.drawCircle(cx, cy, Math.min(pw, ph) * 0.34, accent, 0.10 + pulse * 0.05);
    r.strokeCircle(cx, cy, Math.min(pw, ph) * 0.34, accent, 1.5, 0.35);
    const emoji = (this.charDef && this.charDef.visual && this.charDef.visual.emoji) || '★';
    ui.text(emoji, cx, cy, { size: clamp(Math.min(pw, ph) * 0.42, 22, 62), align: 'center' });

    // Scanline + corner brackets, so it reads as a captured frame, not a portrait.
    r.drawRect(px + 10, cy - 1, pw - 20, 2, '#ffffff', 0.06);
    const b = 12;
    r.drawRect(px + 12, py + 10, b, 2, accent, 0.7); r.drawRect(px + 12, py + 10, 2, b, accent, 0.7);
    r.drawRect(px + pw - 12 - b, py + 10, b, 2, accent, 0.7); r.drawRect(px + pw - 14, py + 10, 2, b, accent, 0.7);
    r.drawRect(px + 12, py + ph - 12, b, 2, accent, 0.7); r.drawRect(px + 12, py + ph - 10 - b, 2, b, accent, 0.7);
    r.drawRect(px + pw - 12 - b, py + ph - 12, b, 2, accent, 0.7); r.drawRect(px + pw - 14, py + ph - 10 - b, 2, b, accent, 0.7);

    // The caption.
    const capY = py + ph + 14;
    let caption;
    if (win) {
      const bossDef = this.stageDef && this.manager.data.bosses.BOSSES_BY_ID[this.stageDef.boss];
      caption = bossDef
        ? 'You closed the show on ' + displayName(bossDef) + '.'
        : 'You closed the show.';
    } else {
      caption = 'Stopped by ' + (s.killedBy || 'something you will beat next time') + '.';
    }
    ui.text(win ? 'THE FINAL BLOW' : 'THE KILLING BLOW', x + 14, capY,
      { size: 10, color: PALETTE.textFaint, weight: 800 });

    const lines = wrapText(r, caption, w - 28, 14);
    for (let i = 0; i < lines.length && i < 2; i++) {
      ui.text(lines[i], x + 14, capY + 18 + i * 17, { size: 14, color: PALETTE.text, weight: 700 });
    }
    if (!win && lines.length <= 2) {
      ui.text('Not a verdict. A note for the next take.', x + 14, capY + 18 + lines.length * 17,
        { size: 12, color: PALETTE.textFaint });
    }
  },

  _statPanel(r, s, x, y, w, h, S) {
    if (h < 40) return;
    ui.panel(x, y, w, h);
    ui.text('THE RUN, IN NUMBERS', x + 14, y + 16, { size: 11, color: PALETTE.textFaint, weight: 800 });

    const rows = [
      ['TIME SURVIVED', formatTime(s.time), PALETTE.accent2],
      ['LEVEL REACHED', String(s.level | 0), PALETTE.accent2],
      ['ENEMIES KILLED', groupNum(s.kills), null],
      ['DAMAGE DEALT', groupNum(s.damageDealt), PALETTE.good],
      ['DAMAGE TAKEN', groupNum(s.damageTaken), PALETTE.bad],
      ['AVG DPS (all targets)', groupNum(s.dpsTotal), null],
      ['PEAK DPS (all targets)', groupNum(s.dpsPeak), PALETTE.accent],
      ['KILLS / SECOND', (s.killsPerSecond || 0).toFixed(2), null],
      ['ELITES / BOSSES', (s.elites | 0) + ' / ' + (s.bosses | 0), null],
      ['BEST KILL STREAK', groupNum(s.bestStreak), null],
      ['LEVEL-UPS TAKEN', String(s.levelUps | 0), null],
    ];

    const top = y + 32;
    const avail = h - 32 - 10;
    const rowH = clamp(avail / rows.length, 11, 26);
    for (let i = 0; i < rows.length; i++) {
      const ry = top + rowH * (i + 0.5);
      if (ry > y + h - 6) break;
      if (i % 2 === 1 && rowH >= 14) r.drawRect(x + 8, ry - rowH * 0.5, w - 16, rowH, '#ffffff', 0.022);
      ui.statRow(rows[i][0], rows[i][1], x + 14, ry, w - 28, { color: rows[i][2] || PALETTE.text });
    }
  },

  /**
   * The DPS graph. DECISIONS.md §14 defines DPS as TOTAL damage dealt to ALL
   * enemies per second, cleave included — so the axis says "all targets" out
   * loud. A single-target reading of this chart would be a lie.
   */
  _dpsGraph(r, x, y, w, h, S) {
    ui.panel(x, y, w, h);
    ui.text('DAMAGE OVER TIME', x + 14, y + 16, { size: 11, color: PALETTE.textFaint, weight: 800 });

    const g = this.graph;
    if (!g || g.pts.length === 0) {
      ui.text('No damage samples were recorded for this run.', x + w / 2, y + h / 2,
        { size: 13, color: PALETTE.textFaint, align: 'center' });
      return;
    }

    // Y-axis title, stated honestly and in full.
    ui.text('damage/sec (all targets)', x + 14, y + 34,
      { size: 11, color: PALETTE.accent2, weight: 700 });

    const padL = 62, padR = 16, padT = 48, padB = 30;
    const px = x + padL, py = y + padT;
    const pw = w - padL - padR, ph = h - padT - padB;
    if (pw < 20 || ph < 20) return;

    const c = r.ctx;
    const yMax = g.max * 1.12;

    // --- grid + y labels -------------------------------------------------------
    const GRID = 4;
    for (let i = 0; i <= GRID; i++) {
      const gy = py + ph - (ph * i) / GRID;
      r.drawRect(px, gy, pw, 1, '#ffffff', i === 0 ? 0.16 : 0.05);
      ui.text(groupNum((yMax * i) / GRID), px - 8, gy,
        { size: 10, color: PALETTE.textFaint, align: 'right', mono: true });
    }

    // --- filled area -----------------------------------------------------------
    const pts = g.pts;
    const n = pts.length;
    const xAt = (i) => px + (n <= 1 ? pw : (pw * i) / (n - 1));
    const yAt = (v) => py + ph - clamp(v / yMax, 0, 1) * ph;

    c.globalAlpha = 1; r._alpha = 1;
    c.beginPath();
    c.moveTo(px, py + ph);
    for (let i = 0; i < n; i++) c.lineTo(xAt(i), yAt(pts[i]));
    c.lineTo(xAt(n - 1), py + ph);
    c.closePath();
    c.fillStyle = this._gradFor(r, py, ph, PALETTE.accent2);
    c.fill();
    r._fill = '';

    // --- the line on top -------------------------------------------------------
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const lx = xAt(i), ly = yAt(pts[i]);
      if (i === 0) c.moveTo(lx, ly); else c.lineTo(lx, ly);
    }
    c.strokeStyle = PALETTE.accent2;
    c.lineWidth = 2;
    c.lineJoin = 'round';
    c.stroke();
    r._stroke = ''; r._lineW = -1;

    // --- average reference -----------------------------------------------------
    if (g.avg > 0) {
      const ay = yAt(g.avg);
      c.setLineDash([5, 5]);
      c.beginPath();
      c.moveTo(px, ay); c.lineTo(px + pw, ay);
      c.strokeStyle = 'rgba(232,236,245,0.45)';
      c.lineWidth = 1;
      c.stroke();
      c.setLineDash([]);
      r._stroke = ''; r._lineW = -1;
      ui.text('AVG ' + groupNum(g.avg), px + pw - 4, ay - 9,
        { size: 10, color: PALETTE.textDim, align: 'right', mono: true, weight: 700 });
    }

    // --- peak marker -----------------------------------------------------------
    const kx = px + pw * clamp(g.peakFrac, 0, 1);
    const ky = yAt(g.peakVal);
    r.drawLine(kx, ky, kx, py + ph, PALETTE.accent, 1, 0.35);
    r.drawCircle(kx, ky, 5, PALETTE.accent, 1);
    r.strokeCircle(kx, ky, 8 + 2 * (0.5 + 0.5 * Math.sin(this.t * 4)), PALETTE.accent, 1.5, 0.5);
    const peakLabel = 'PEAK ' + groupNum(g.peakVal) + ' @ ' + formatTime(g.peakT);
    const lw = r.measureText(peakLabel, 11 * ui.scale, 800);
    const lx = clamp(kx - lw / 2, px, px + pw - lw);
    ui.text(peakLabel, lx + lw / 2, Math.max(py + 8, ky - 18),
      { size: 11, color: PALETTE.accent, align: 'center', weight: 800, outline: true });

    // --- x axis ----------------------------------------------------------------
    r.drawRect(px, py + ph, pw, 1, '#ffffff', 0.16);
    for (let i = 0; i <= 4; i++) {
      const t = (g.duration * i) / 4;
      const lxx = px + (pw * i) / 4;
      r.drawRect(lxx, py + ph, 1, 4, '#ffffff', 0.18);
      ui.text(formatTime(t), lxx, py + ph + 14, {
        size: 10, color: PALETTE.textFaint, mono: true,
        align: i === 0 ? 'left' : i === 4 ? 'right' : 'center',
      });
    }
    ui.text('run time', px + pw / 2, py + ph + 26, { size: 10, color: PALETTE.textFaint, align: 'center' });
  },

  _gradFor(r, py, ph, color) {
    const key = color + '|' + Math.round(py) + '|' + Math.round(ph);
    if (this._grad && this._grad.key === key) return this._grad.g;
    const g = r.ctx.createLinearGradient(0, py, 0, py + ph);
    g.addColorStop(0, withAlpha(color, 0.55));
    g.addColorStop(1, withAlpha(color, 0.03));
    this._grad = { key, g };
    return g;
  },

  /** Gold + Star Fragments, counting up. SECTION 2: a loss is still a payday. */
  _rewards(r, s, x, y, w, h, S) {
    if (h < 60) return;
    ui.panel(x, y, w, h, { borderColor: 'rgba(255,215,106,0.35)' });
    ui.text('BANKED', x + 14, y + 16, { size: 11, color: PALETTE.accent, weight: 800 });
    ui.text(s.victory ? 'Paid on the way out.' : 'A failed run is still a paid run.',
      x + w - 14, y + 16, { size: 11, color: PALETTE.textFaint, align: 'right' });

    const p = easeOutCubic(clamp(this.tickT / TICK_DUR, 0, 1));
    const running = p < 1;
    const wobble = running ? 1 + 0.10 * Math.sin(this.t * 34) * (1 - p) : 1;
    const goldShown = Math.floor(this.award.gold * p);
    const fragShown = Math.floor(this.award.frag * p);

    const half = (w - 28) / 2;
    const numY = y + 34 + Math.min(30, h * 0.16);
    const numSize = clamp(38 * S * wobble, 20, 44);

    // Gold
    ui.text(GOLD_ICON, x + 16, numY, { size: clamp(20 * S, 14, 22) });
    ui.text(groupNum(goldShown), x + 16 + half - 6, numY, {
      size: numSize, color: PALETTE.gold, weight: 800, align: 'right', mono: true, outline: true,
    });
    ui.text('GOLD', x + 16 + half - 6, numY + numSize * 0.62, {
      size: 10, color: PALETTE.textFaint, align: 'right', weight: 800,
    });

    // Star Fragments
    ui.text(FRAG_ICON, x + 22 + half, numY, { size: clamp(20 * S, 14, 22) });
    ui.text(groupNum(fragShown), x + w - 16, numY, {
      size: numSize, color: PALETTE.gem, weight: 800, align: 'right', mono: true, outline: true,
    });
    ui.text('STAR FRAGMENTS', x + w - 16, numY + numSize * 0.62, {
      size: 10, color: PALETTE.textFaint, align: 'right', weight: 800,
    });

    // Breakdown of the fragment line, so the number is never a mystery.
    let by = numY + numSize * 0.62 + 20;
    const bottom = y + h - 8;
    for (const line of this.award.lines) {
      if (by + 14 > bottom) break;
      ui.text(line.label, x + 16, by, { size: 11, color: line.hot ? PALETTE.accent : PALETTE.textDim });
      ui.text('+' + line.v + FRAG_ICON, x + w - 16, by, {
        size: 11, color: line.hot ? PALETTE.accent : PALETTE.textDim, align: 'right', weight: 700, mono: true,
      });
      by += 15;
    }
    if (this.bondLine && by + 14 <= bottom) {
      ui.text(this.bondLine + ' with ' + (this.charDef ? displayName(this.charDef) : s.character),
        x + 16, by, { size: 11, color: PALETTE.pink, weight: 700 });
    }
  },

  _weaponPanel(r, x, y, w, h) {
    if (h < 36) return;
    const rows = this.weaponRows || [];
    ui.panel(x, y, w, h);
    ui.text('ARSENAL  ' + rows.length + '/' + (this.weaponMax || 3), x + 14, y + 16,
      { size: 11, color: PALETTE.textFaint, weight: 800 });
    const rowH = clamp((h - 32) / Math.max(1, this.weaponMax || 3), 18, 30);
    for (let i = 0; i < (this.weaponMax || 3); i++) {
      const row = rows[i];
      const ry = y + 28 + rowH * (i + 0.5);
      if (ry > y + h - 4) break;
      if (!row) {
        ui.text('·  empty slot', x + 20, ry, { size: Math.min(12, rowH * 0.5), color: PALETTE.textFaint });
        continue;
      }
      const col = row.evolved ? PALETTE.accent
                : row.level >= row.max ? '#7bf59a'
                : row.signature ? PALETTE.text : PALETTE.accent2;
      ui.text(row.icon, x + 20, ry, { size: Math.min(17, rowH * 0.68), align: 'center' });
      ui.text(ellipsize(r, row.name, w - 96, Math.min(13, rowH * 0.5), 700), x + 36, ry, {
        size: Math.min(13, rowH * 0.5), color: col, weight: 700,
      });
      ui.text(row.evolved ? 'EVO' : row.level + '/' + row.max, x + w - 14, ry, {
        size: Math.min(11, rowH * 0.45), color: col, align: 'right', weight: 800, mono: true,
      });
    }
  },

  _relicPanel(r, x, y, w, h) {
    if (h < 40) return;
    ui.panel(x, y, w, h);
    ui.text('RELICS FOUND  ' + this.relicRows.length + '/3', x + 14, y + 16,
      { size: 11, color: PALETTE.textFaint, weight: 800 });

    if (this.relicRows.length === 0) {
      ui.text('No relics this run. Bosses always drop one.', x + 14, y + 40,
        { size: 12, color: PALETTE.textFaint });
      return;
    }
    const rowH = clamp((h - 34) / Math.max(1, this.relicRows.length), 20, 34);
    for (let i = 0; i < this.relicRows.length; i++) {
      const row = this.relicRows[i];
      const ry = y + 30 + rowH * (i + 0.5);
      if (ry > y + h - 4) break;
      ui.text(row.icon, x + 20, ry, { size: Math.min(18, rowH * 0.7), align: 'center' });
      ui.text(row.name, x + 36, ry, {
        size: Math.min(13, rowH * 0.5), color: row.color, weight: 700,
      });
    }
  },

  _evoPanel(r, x, y, w, h) {
    if (h < 36) return;
    ui.panel(x, y, w, h);
    ui.text('EVOLUTIONS  ' + this.evoRows.length + '/8', x + 14, y + 16,
      { size: 11, color: PALETTE.textFaint, weight: 800 });

    if (this.evoRows.length === 0) {
      ui.text('Max an upgrade, hold its relic, and the screen goes white.',
        x + 14, y + 38, { size: 11, color: PALETTE.textFaint });
      return;
    }
    const rowH = clamp((h - 34) / Math.max(1, this.evoRows.length), 18, 30);
    for (let i = 0; i < this.evoRows.length; i++) {
      const row = this.evoRows[i];
      const ry = y + 30 + rowH * (i + 0.5);
      if (ry > y + h - 4) break;
      ui.text(row.icon, x + 20, ry, { size: Math.min(17, rowH * 0.72), align: 'center' });
      ui.text(row.name, x + 36, ry, {
        size: Math.min(13, rowH * 0.52), color: PALETTE.accent, weight: 800,
      });
    }
  },

  _buildPanel(r, x, y, w, h) {
    if (h < 40) return;
    ui.panel(x, y, w, h);
    ui.text('FINAL BUILD  ' + this.build.length + ' upgrades', x + 14, y + 16,
      { size: 11, color: PALETTE.textFaint, weight: 800 });

    if (this.build.length === 0) {
      ui.text('No upgrades taken. Bold.', x + 14, y + 40, { size: 12, color: PALETTE.textFaint });
      return;
    }

    const top = y + 28;
    const availH = h - 28 - 8;
    const MIN_ROW = 12;
    const n = this.build.length;

    // Nothing on this screen scrolls, so the panel takes as many columns as it
    // needs — up to three — instead of computing two and then `break`ing, which
    // dropped everything past column two with no indicator at all. If even three
    // columns cannot hold the list, the last slot spells out how many are left.
    const perCol = Math.max(1, Math.floor(availH / MIN_ROW));
    const cols = clamp(Math.ceil(n / perCol), 1, 3);
    const rowH = clamp(availH / Math.max(1, Math.ceil(n / cols)), MIN_ROW, 22);
    const rows = Math.max(1, Math.floor(availH / rowH));
    const cap = rows * cols;
    const shown = n > cap ? cap - 1 : n;
    const hidden = n - shown;

    const colW = (w - 20) / cols;
    const fs = clamp(rowH * 0.62, 9, 13);
    const nameW = colW - 18 - Math.max(26, r.measureText('99/99', fs * (ui.scale || 1), 700)) - 6;

    for (let i = 0; i < shown; i++) {
      const col = Math.floor(i / rows);
      const row = i - col * rows;
      const bx = x + 10 + col * colW;
      const by = top + rowH * (row + 0.5);
      if (by > y + h - 4) continue;
      const u = this.build[i];
      const col2 = u.maxed ? PALETTE.accent : u.color;
      ui.text(u.icon, bx + 8, by, { size: Math.min(13, fs + 1), align: 'center' });
      ui.text(ellipsize(r, u.name, Math.max(24, nameW), fs, u.maxed ? 800 : 600), bx + 18, by,
        { size: fs, color: col2, weight: u.maxed ? 800 : 600 });
      ui.text(u.label, bx + colW - 10, by, {
        size: fs, color: u.maxed ? PALETTE.accent : PALETTE.textDim,
        align: 'right', weight: 700, mono: true,
      });
    }

    if (hidden > 0) {
      const col = Math.floor(shown / rows);
      const row = shown - col * rows;
      ui.text('+' + hidden + ' more', x + 18 + col * colW, top + rowH * (row + 0.5),
        { size: fs, color: PALETTE.accent2, weight: 800 });
    }
  },

  _callout(r, x, y, w, h) {
    ui.panel(x, y, w, h, {
      color: 'rgba(30,24,8,0.92)', borderColor: PALETTE.accent, borderWidth: 2,
    });
    const pulse = 0.6 + 0.4 * Math.sin(this.t * 3);
    ui.text('🏁  FIRST CLEAR — ' + (this.stageDef ? displayName(this.stageDef) : ''),
      x + 16, y + h * 0.32, { size: 15, color: PALETTE.accent, weight: 800, alpha: 0.75 + pulse * 0.25 });
    const text = this.unlockLines.join('    ·    ');
    const lines = wrapText(r, text, w - 32, 12);
    ui.text(lines[0] || '', x + 16, y + h * 0.68, { size: 12, color: PALETTE.text, weight: 600 });
    if (lines.length > 1) {
      ui.text(lines[1], x + 16, y + h * 0.68 + 15, { size: 12, color: PALETTE.text, weight: 600 });
    }
  },

  _footer(r, s, x, by, W, H, footerH, pad) {
    const btnH = Math.min(56, footerH - 16);
    const btnW = clamp((W - pad * 2 - 24) / 3, 120, 240);
    const hubX = W - pad - btnW;
    const retryX = hubX - btnW - 12;

    // Declared first so it owns focus 0: the offer to go again is the point.
    if (ui.button('retry', retryX, by, btnW, btnH, 'RETRY', { sub: 'same fight, new seed' })) {
      this._retry();
    }
    if (ui.button('hub', hubX, by, btnW, btnH, 'HUB', { sub: 'the studio' })) {
      this.manager.go('hub');
    }

    const msg = s.victory
      ? 'Gold and fragments are already in your wallet. The Shrine is open.'
      : 'Nothing was voided. Every coin and fragment above is already yours.';
    ui.text(msg, x, by + btnH * 0.5, { size: 12, color: PALETTE.textDim, weight: 600 });
  },

  _retry() {
    const s = this.s;
    if (!s) { this.manager.go('hub'); return; }
    const shared = this.manager.shared;
    const seed = ((Math.random() * 0x7ffffffe) | 0) + 1;   // never 0: runScene falls back on falsy
    shared.characterId = s.character;
    shared.stageId = s.stage;
    shared.tierIndex = this.tierIndex;
    shared.seed = seed;
    this.manager.go('run', {
      characterId: s.character,
      stageId: s.stage,
      tierIndex: this.tierIndex,
      seed,
    });
  },
};
