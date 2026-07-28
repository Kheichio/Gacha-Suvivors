// The in-run HUD.
//
// SECTION 13's layout, exactly — and the rule that governs all of it:
// KEEP THE CENTRE 70% OF THE SCREEN COMPLETELY CLEAR.
//
//   TOP-CENTRE     run timer (large, monospace), current wave name
//   TOP-LEFT       HP bar (thick, with a delayed white ghost bar), armour pips,
//                  revive icons
//   TOP-RIGHT      kill count, gold, level
//   BOTTOM-CENTRE  XP bar spanning the screen width
//   BOTTOM-LEFT    SPECIAL and ESCAPE with radial sweeps — the most important
//                  element after the HP bar. When ready they PULSE, because the
//                  player must never have to think about whether escape is up.
//   BOTTOM-RIGHT   relic icons (max 3) + active buff timers
//   BOSS           a health bar that drops from the top with name and epithet
//
// The HUD is also where the generic hooks live that keep character-specific UI
// out of the engine: `resourceBar` (the rage meter) and `metric` (the
// kills-per-second read-out) are DECLARED IN CHARACTER DATA and rendered
// generically here. Nothing in this file compares a character id to a literal —
// tests/run.js greps for exactly that and fails the build if it finds one.

import { ui, PALETTE, RARITY_COLOR, ellipsize } from './widgets.js';
import { displayName, DEV_MODE, IS_TOUCH } from '../core/config.js';
import { save } from '../core/save.js';
import { input, ACT } from '../core/input.js';
import { feel } from '../core/feel.js';
import { atlas } from '../render/spriteAtlas.js';
import { MONO_FONT } from '../render/renderer.js';
import { clamp, formatTime, formatNumber, TAU, lerp, easeOutCubic } from '../core/math.js';
import { RUN_STATE } from '../game/run.js';

class Hud {
  constructor() {
    this.hpGhost = 1;
    this.bossBarT = 0;
    this.introT = 0;
    this._relicSprites = Object.create(null);
    this.killStreakT = 0;
  }

  reset() { this.hpGhost = 1; this.bossBarT = 0; this.introT = 0; this._portraitSprite = null; }

  /**
   * The HD portrait, resolved once per run.
   *
   * `def.portrait` is joined on in data/index.js and pre-rastered at boot. If
   * the art layer has not published one, this degrades to the world sprite
   * rather than to nothing — a HUD with no face is worse than a small one.
   */
  _portrait(p) {
    if (this._portraitSprite && this._portraitFor === p.id) return this._portraitSprite;
    this._portraitFor = p.id;
    this._portraitSprite = p.def.portrait ? atlas.ensure(p.def.portrait) : p.sprite;
    return this._portraitSprite;
  }

  update(run, dt) {
    const p = run.player;
    const frac = p.hpFraction;
    // The ghost bar lags behind, so a big hit READS as a big hit.
    if (frac < this.hpGhost) this.hpGhost = Math.max(frac, this.hpGhost - dt * 0.55);
    else this.hpGhost = frac;

    if (run.boss.isActive) this.bossBarT = Math.min(1, this.bossBarT + dt * 3);
    else this.bossBarT = Math.max(0, this.bossBarT - dt * 3);

    if (run.boss.isActive && run.boss.introT > 0) this.introT = run.boss.introT;
    else if (this.introT > 0) this.introT -= dt;
  }

  draw(r, run) {
    r.setScreenSpace();
    // Bind the toolkit without disturbing the focus of any menu drawn on top.
    ui.attach(r);
    const W = r.w, H = r.h;
    const s = save.data.settings.uiScale || 1;
    const p = run.player;

    this._lowHpVignette(r, run);
    this._topLeft(r, run, s);
    this._topCenter(r, run, W, s);
    this._topRight(r, run, W, s);
    this._buildStrip(r, run, W, H, s);
    this._bottomCenter(r, run, W, H, s);
    this._bottomLeft(r, run, H, s);
    this._bottomRight(r, run, W, H, s);
    if (this.bossBarT > 0.01) this._bossBar(r, run, W, s);
    if (run.qte) this._qte(r, run, W, H);
    this._killStreak(r, run, W, H);
    if (run.stageManager && run.stageManager.active) this._stageManager(r, run, W, H);
    if (IS_TOUCH) this._touchControls(r, W, H);
    if (input.held(ACT.STATS)) this._statSheet(r, run, W, H);
  }

  // --- portrait, HP, armour, revives -----------------------------------------
  _topLeft(r, run, s) {
    const p = run.player;
    const x = 20, y = 18;
    const w = 356 * s, h = 30 * s;

    // THE PORTRAIT. A dedicated high-resolution bust — its own atlas entry with
    // its own id, drawn from data/sprites.js's `portraitFor()` — rather than the
    // 24px world sprite scaled up. The world sprite has to read at a glance from
    // across an arena; this sits two inches from the player's eye for twenty
    // minutes and can afford real detail.
    const port = 66 * s;
    const rar = RARITY_COLOR[p.def.rarity] || PALETTE.border;
    ui.panel(x, y, port, port, {
      radius: 6, color: '#141a2b', borderColor: rar, borderWidth: 2.5,
    });
    // Rarity band across the top of the plate, matching the roster cards.
    r.drawRect(x + 3, y + 3, port - 6, Math.max(3, port * 0.055), rar, 0.95);
    // drawSprite culls against the CAMERA box; the HUD is screen space and only
    // survived by accident. Open the window explicitly for the portrait blit.
    const cmx = r.cullMinX, cMx = r.cullMaxX, cmy = r.cullMinY, cMy = r.cullMaxY;
    r.cullMinX = -4000; r.cullMaxX = r.w + 4000;
    r.cullMinY = -4000; r.cullMaxY = r.h + 4000;
    const sp = this._portrait(p);
    if (sp) {
      const fit = (port - 12) / Math.max(sp.w, sp.h);
      r.drawSprite(sp, x + port / 2, y + port / 2 + 2 * s, 0, fit, 1, p.flashT > 0, 0);
    }
    r.cullMinX = cmx; r.cullMaxX = cMx; r.cullMinY = cmy; r.cullMaxY = cMy;
    if (p.isLowHp && !p.dead) {
      // The plate itself pulses red under 25% — the portrait is the thing the
      // eye is already on, so it is the cheapest place to put a warning.
      const beat = 0.5 + 0.5 * Math.sin(run.time * feel.lowHpPulseHz * TAU);
      r.strokeRect(x - 2, y - 2, port + 4, port + 4, '#ff4a6e', 3, 0.35 + beat * 0.5);
    }

    const bx = x + port + 10 * s;
    const bw = w - port - 10 * s;
    ui.text(displayName(p.def).split(' [')[0], bx, y + 8 * s, {
      size: 13 * s, color: rar, weight: 800,
    });
    ui.text('S' + p.starLevel, bx + bw, y + 8 * s, {
      size: 11 * s, color: PALETTE.textFaint, weight: 800, align: 'right', mono: true,
    });
    const by = y + 20 * s;
    ui.bar(bx, by, bw, h, p.hpFraction,
           p.hpFraction > 0.5 ? '#4ee07a' : p.hpFraction > 0.25 ? '#ffd23f' : '#ff4a6e', {
      ghost: this.hpGhost, ghostColor: 'rgba(255,255,255,0.5)',
      segments: 10,
    });
    // THE REGEN PREVIEW: a green band showing where this bar will be in three
    // seconds. "+0.4 HP/s" is a number nobody can picture; a strip of bar you
    // can watch creep forward is the same information as a distance.
    if (p.stats.regen > 0 && p.hpFraction < 1) {
      const ahead = Math.min(1, p.hpFraction + (p.stats.regen * 3) / Math.max(1, p.maxHp));
      const x0 = bx + bw * p.hpFraction;
      const x1 = bx + bw * ahead;
      const pulse = 0.35 + 0.25 * Math.sin(run.time * 3.4);
      if (x1 > x0 + 1) {
        r.drawRect(x0, by + 2, x1 - x0, h - 4, '#7bf59a', pulse * 0.55);
        r.drawRect(x1 - 2, by + 2, 2, h - 4, '#bfffd4', 0.35 + pulse * 0.4);
      }
    }

    ui.text(`${Math.ceil(p.hp)} / ${Math.round(p.maxHp)}`, bx + bw / 2, by + h / 2 + 1, {
      size: 16 * s, color: '#ffffff', align: 'center', weight: 800, outline: true, mono: true,
    });
    if (p.stats.regen > 0) {
      ui.text('♥ +' + p.stats.regen.toFixed(1) + '/s', bx + bw, by + h + 9 * s, {
        size: 11 * s, color: '#7bf59a', align: 'right', weight: 800, mono: true,
      });
    }

    let yy = y + Math.max(port, h + 22 * s) + (p.stats.regen > 0 ? 16 * s : 8);

    // armour pips
    if (p.stats.armor > 0) {
      const n = Math.min(12, Math.round(p.stats.armor));
      for (let i = 0; i < n; i++) {
        r.drawRect(x + i * 11 * s, yy, 8 * s, 6 * s, '#9fb0d0', 0.9);
      }
      ui.text('ARMOUR ' + Math.round(p.stats.armor), x + n * 11 * s + 8, yy + 3 * s,
              { size: 10 * s, color: PALETTE.textFaint, mono: true });
      yy += 12 * s;
    }

    // revive icons
    const revives = run.revivesLeftNow();
    if (revives > 0) {
      for (let i = 0; i < revives; i++) {
        ui.text('✚', x + i * 18 * s + 6, yy + 8 * s, { size: 15 * s, color: '#7bf59a', align: 'center' });
      }
      yy += 18 * s;
    }

    // Generic resource bar — declared in character data (Han's rage today).
    if (p.resourceMax > 0) {
      const rb = p.def.resourceBar;
      const f = p.resource / p.resourceMax;
      ui.bar(x, yy, w * 0.8, 12 * s, f, rb.color || '#ffd34a', { bg: 'rgba(4,6,14,0.8)' });
      ui.text(rb.label + (f >= 1 ? '  READY' : ''), x + 6, yy + 6 * s,
              { size: 10 * s, color: f >= 1 ? '#ffffff' : PALETTE.textDim, weight: 800, mono: true });
      yy += 18 * s;
    }

  }

  // --- timer + wave name -----------------------------------------------------
  _topCenter(r, run, W, s) {
    const t = run.endless ? run.time : Math.max(0, run.stage.duration - run.time);
    const color = (!run.endless && t < 60) ? '#ffd94a' : '#e8ecf5';
    ui.text(formatTime(run.endless ? run.time : t), W / 2, 34 * s, {
      size: 40 * s, color, align: 'center', weight: 800, mono: true, outline: true,
    });
    const label = run.endless ? 'OVERTIME' : run.stage.name;
    ui.text(label, W / 2, 60 * s, { size: 12 * s, color: PALETTE.textFaint, align: 'center', weight: 700 });

    if (run.waveDirector.calmUntil > run.time) {
      ui.text('…', W / 2, 84 * s, { size: 22 * s, color: PALETTE.textDim, align: 'center' });
    }
  }

  // --- kills, gold, level ----------------------------------------------------
  _topRight(r, run, W, s) {
    const x = W - 18;
    ui.text('LV ' + run.player.level, x, 26 * s, {
      size: 22 * s, color: PALETTE.accent, align: 'right', weight: 800, mono: true, outline: true,
    });
    ui.text('☠ ' + formatNumber(run.stats.kills), x, 48 * s, {
      size: 14 * s, color: PALETTE.textDim, align: 'right', weight: 700, mono: true,
    });
    ui.text('⭐ ' + formatNumber(run.stats.gold), x, 66 * s, {
      size: 14 * s, color: PALETTE.gold, align: 'right', weight: 700, mono: true,
    });

    // Generic metric hook — Kira's kills/sec, declared in his data.
    if (run.player.def.metric === 'killsPerSecond') {
      const kps = run.time > 0 ? run.stats.kills / run.time : 0;
      ui.text(kps.toFixed(2) + ' k/s', x, 84 * s, {
        size: 12 * s, color: PALETTE.accent2, align: 'right', weight: 700, mono: true,
      });
    }
  }

  // --- XP bar ----------------------------------------------------------------
  _bottomCenter(r, run, W, H, s) {
    const p = run.player;
    const h = 10 * s;
    const y = H - h - 4;
    const f = p.xpToNext > 0 ? p.xp / p.xpToNext : 0;
    r.drawRect(0, y, W, h, 'rgba(4,6,14,0.85)', 1);
    r.drawRect(0, y, W * clamp(f, 0, 1), h, '#6ad8ff', 1);
    // A subtle leading edge so incremental gain is visible at a glance.
    if (f > 0.002) r.drawRect(W * f - 2, y, 2, h, '#ffffff', 0.8);
    ui.text('LV ' + p.level, 10, y - 9 * s, { size: 11 * s, color: PALETTE.textFaint, weight: 700, mono: true });
    ui.text(Math.floor(p.xp) + ' / ' + p.xpToNext, W - 10, y - 9 * s,
            { size: 11 * s, color: PALETTE.textFaint, align: 'right', weight: 700, mono: true });
  }

  // --- special + escape ------------------------------------------------------
  _bottomLeft(r, run, H, s) {
    const p = run.player;
    const rad = 30 * s;
    const y = H - rad - 42 * s;
    const x1 = 26 + rad, x2 = x1 + rad * 2.5;

    ui.radial(x1, y, rad, p.special.progress, '#ff5fa2', {
      icon: '✦', key: 'E / RMB',
      charges: p.special.charges, maxCharges: p.special.maxCharges,
    });
    ui.radial(x2, y, rad, p.escape.progress, '#6ad8ff', {
      icon: '➤', key: 'SPACE',
      charges: p.escape.charges, maxCharges: p.escape.maxCharges,
    });

    // Names underneath so a new player learns what the buttons are.
    ui.text(displayName(p.def.special).split(' [')[0], x1, y - rad - 10 * s,
            { size: 10 * s, color: PALETTE.textFaint, align: 'center', weight: 700 });
    ui.text(displayName(p.def.escape).split(' [')[0], x2, y - rad - 10 * s,
            { size: 10 * s, color: PALETTE.textFaint, align: 'center', weight: 700 });

    // Cooldown seconds when not ready — no guessing.
    if (!p.special.ready) {
      ui.text(p.special.remaining.toFixed(1), x1, y + 1, {
        size: 15 * s, color: '#ffffff', align: 'center', weight: 800, mono: true, outline: true });
    }
    if (!p.escape.ready) {
      ui.text(p.escape.remaining.toFixed(1), x2, y + 1, {
        size: 15 * s, color: '#ffffff', align: 'center', weight: 800, mono: true, outline: true });
    }
  }

  /**
   * THE BUILD STRIP — every upgrade you hold, with its level, plus the slot
   * counters. Up the left edge under the HP plate.
   *
   * Without this the player has no idea what they picked up two minutes ago,
   * which makes every level-up choice a guess. It also makes the build-slot cap
   * legible: you can see the bucket filling before it locks.
   */
  _buildStrip(r, run, W, H, s) {
    const p = run.player;
    const slots = run.buildSlots();
    const ws = run.weapons;

    // EVERY POSITION IS DRAWN, FILLED OR NOT.
    //
    // The old strip drew only what you held, at 46px, which answered "what do I
    // have" and never "how much more can I have" — so the level-up screen
    // quietly refusing a new upgrade read as a bug rather than as the cap doing
    // its job. Weapons make that worse: three slots is the single most
    // important number in a build and it has to be visible at all times, before
    // you spend the third one.
    const WT = 62 * s;             // weapon tile
    const WG = 8 * s;
    const UT = 42 * s;             // upgrade tile
    const UG = 4 * s;
    const GG = 16 * s;             // gap between the ATK and UTL groups
    const padX = 12 * s;
    const headerH = 20 * s;
    const labelH = 13 * s;

    const evos = [];
    for (const eid of p.evolutions) {
      const evo = run.data.evolutions.EVOLUTIONS_BY_ID[eid];
      if (evo) evos.push(evo);
    }

    const nAtk = slots.max.offensive, nUtl = slots.max.utility;
    const upRowW = (nAtk + nUtl + evos.length) * (UT + UG) - UG + GG +
                   (evos.length ? GG : 0);
    const wpRowW = ws.max * (WT + WG) - WG;
    let boxW = Math.max(upRowW, wpRowW) + padX * 2;

    // Shrink to fit rather than overflow: the plate is centred, and at 1024 or
    // at uiScale 1.4 the full-width row does not fit.
    const k = Math.min(1, (W * 0.94) / boxW);
    const wt = WT * k, wg = WG * k, ut = UT * k, ug = UG * k, gg = GG * k;
    const px = padX * k;
    boxW = Math.max((nAtk + nUtl + evos.length) * (ut + ug) - ug + gg + (evos.length ? gg : 0),
                    ws.max * (wt + wg) - wg) + px * 2;

    const boxH = headerH + wt + labelH + ut + 12 * s;
    const bx = (W - boxW) / 2;
    // Sit clear of the XP bar (10*s tall + 4px) with real breathing room.
    const by = H - (10 * s + 4) - boxH - 10 * s;

    ui.panel(bx, by, boxW, boxH, {
      radius: 6, color: 'rgba(16,21,35,0.92)',
      borderColor: 'rgba(150,170,225,0.45)', borderWidth: 2,
    });

    // --- header: the two counters that used to be the only cap cue -----------
    const atkFull = slots.used.offensive >= slots.max.offensive;
    const utlFull = slots.used.utility >= slots.max.utility;
    const hy = by + headerH / 2 + 2;
    ui.text(`UTL ${slots.used.utility}/${nUtl}`, bx + boxW - px, hy, {
      size: 11 * s, color: utlFull ? '#ffd23f' : PALETTE.textDim,
      weight: 800, mono: true, align: 'right',
    });
    const utlW = r.measureText(`UTL ${slots.used.utility}/${nUtl}`, 11 * s, 800);
    ui.text(`ATK ${slots.used.offensive}/${nAtk}`, bx + boxW - px - utlW - 14 * s, hy, {
      size: 11 * s, color: atkFull ? '#ffd23f' : PALETTE.textDim,
      weight: 800, mono: true, align: 'right',
    });
    ui.text(`WEAPONS ${ws.count}/${ws.max}`, bx + px, hy, {
      size: 11 * s, color: ws.full ? '#ffd23f' : PALETTE.accent2,
      weight: 800, mono: true,
    });

    // --- the weapon slots ----------------------------------------------------
    const wy = by + headerH;
    const wx0 = bx + (boxW - (ws.max * (wt + wg) - wg)) / 2;
    for (let i = 0; i < ws.max; i++) {
      const x = wx0 + i * (wt + wg);
      const w = ws.slots[i];
      if (!w) {
        ui.slot(x, wy, wt, wt, { label: 'EMPTY', size: 9 * s });
        continue;
      }
      const maxL = ws.maxLevel(w);
      const evolved = w.evolved;
      const maxed = ws.isMaxed(w);
      const frac = evolved ? 1 : w.level / maxL;
      const col = evolved ? '#ffd76a' : maxed ? '#7bf59a' : '#6ad8ff';
      const pulse = evolved ? 0.6 + 0.4 * Math.sin(run.time * 3) : 1;

      r.drawRoundRect(x, wy, wt, wt, 5,
                      evolved ? 'rgba(255,215,106,0.20)' : 'rgba(8,11,20,0.9)', 1);
      r.strokeRect(x, wy, wt, wt, col, evolved ? 2.5 : 2, pulse);
      ui.text(ws.iconOf(w), x + wt / 2, wy + wt * 0.30, {
        size: 22 * s * k, align: 'center', baseline: 'middle',
      });
      ui.text(evolved ? 'EVOLVED' : `Lv ${w.level}/${maxL}`, x + wt / 2, wy + wt * 0.60, {
        size: 10 * s * k, color: col, align: 'center', baseline: 'middle',
        weight: 800, mono: true,
      });
      ui.text(ellipsize(r, ws.nameOf(w).split(' [')[0], wt - 6 * k, 9 * k),
              x + wt / 2, wy + wt * 0.80, {
        size: 9 * s * k, color: PALETTE.textFaint, align: 'center', baseline: 'middle',
      });
      r.drawRect(x + 4, wy + wt - 7, wt - 8, 3.5, 'rgba(5,7,14,0.8)', 1);
      r.drawRect(x + 4, wy + wt - 7, (wt - 8) * frac, 3.5, col, 1);
    }

    // --- the upgrade grid: every position, filled or empty --------------------
    const ly = wy + wt + labelH * 0.5;
    const uy = wy + wt + labelH;
    const held = { offensive: [], utility: [] };
    for (const id in p.upgrades) {
      const up = run.data.upgrades.UPGRADES_BY_ID[id];
      if (!up) continue;
      held[run.data.upgrades.BUILD_SLOTS.bucketOf(up)].push(up);
    }

    const rowW = (nAtk + nUtl + evos.length) * (ut + ug) - ug + gg + (evos.length ? gg : 0);
    let ux = bx + (boxW - rowW) / 2;

    ui.text('ATK', ux, ly, { size: 9 * s, color: PALETTE.textFaint, weight: 800, mono: true });
    ux = this._upGroup(r, run, held.offensive, nAtk, ux, uy, ut, ug, s, k, '#ff8a6b');
    ux += gg;
    ui.text('UTL', ux, ly, { size: 9 * s, color: PALETTE.textFaint, weight: 800, mono: true });
    ux = this._upGroup(r, run, held.utility, nUtl, ux, uy, ut, ug, s, k, '#6ad8ff');

    if (evos.length) {
      ux += gg;
      ui.text('EVO', ux, ly, { size: 9 * s, color: '#ffd76a', weight: 800, mono: true });
      for (const evo of evos) {
        const pulse = 0.6 + 0.4 * Math.sin(run.time * 3);
        r.drawRoundRect(ux, uy, ut, ut, 4, 'rgba(255,215,106,0.22)', 1);
        r.strokeRect(ux, uy, ut, ut, '#ffd76a', 2, pulse);
        ui.text(evo.icon || '✦', ux + ut / 2, uy + ut * 0.38, {
          size: 17 * s * k, align: 'center', baseline: 'middle',
        });
        ui.text('EVO', ux + ut / 2, uy + ut * 0.76, {
          size: 8 * s * k, color: '#ffd76a', align: 'center', baseline: 'middle',
          weight: 800, mono: true,
        });
        ux += ut + ug;
      }
    }
  }

  /** One bucket of the upgrade grid: the held tiles, then the empty positions. */
  _upGroup(r, run, list, max, x, y, ut, ug, s, k, accent) {
    for (let i = 0; i < max; i++) {
      const up = list[i];
      if (!up) {
        ui.slot(x, y, ut, ut, { radius: 4 });
        x += ut + ug;
        continue;
      }
      const lv = run.player.upgrades[up.id];
      const maxed = lv >= up.maxLevel;
      const col = maxed ? '#ffd23f' : accent;
      r.drawRoundRect(x, y, ut, ut, 4,
                      maxed ? 'rgba(255,210,63,0.16)' : 'rgba(8,11,20,0.88)', 1);
      r.strokeRect(x, y, ut, ut, maxed ? '#ffd23f' : 'rgba(150,170,225,0.45)', 2, 1);
      ui.text(up.icon || '◆', x + ut / 2, y + ut * 0.32, {
        size: 16 * s * k, align: 'center', baseline: 'middle',
      });
      ui.text(`${lv}/${up.maxLevel}`, x + ut / 2, y + ut * 0.66, {
        size: 9 * s * k, color: maxed ? '#ffd23f' : PALETTE.textDim,
        align: 'center', baseline: 'middle', weight: 800, mono: true,
      });
      r.drawRect(x + 3, y + ut - 6, ut - 6, 3, 'rgba(5,7,14,0.8)', 1);
      r.drawRect(x + 3, y + ut - 6, (ut - 6) * (lv / up.maxLevel), 3, col, 1);
      x += ut + ug;
    }
    return x;
  }

  // --- relics + buffs --------------------------------------------------------
  _bottomRight(r, run, W, H, s) {
    const p = run.player;
    const size = 38 * s;
    const maxRelics = run.data.relics.RELIC_SLOTS;
    let x = W - 18 - size;
    const y = H - 42 * s - size;

    // Relic slots draw their maximum too, for the same reason the build grid
    // does: "you can carry three" is a rule the player has to be able to see
    // before the fourth one forces a swap decision on them mid-fight.
    for (let i = maxRelics - 1; i >= p.relics.length; i--) {
      ui.slot(x, y, size, size, { radius: 8 });
      x -= size + 6;
    }
    ui.text(`RELICS ${p.relics.length}/${maxRelics}`, W - 18, y - 8 * s, {
      size: 10 * s, color: PALETTE.textFaint, align: 'right', weight: 800, mono: true,
    });

    for (let i = p.relics.length - 1; i >= 0; i--) {
      const id = p.relics[i];
      const relic = run.data.relics.RELICS_BY_ID[id];
      if (!relic) continue;
      const resonant = run.relicHooks.isResonant(id);
      ui.panel(x, y, size, size, {
        radius: 8,
        color: 'rgba(10,13,24,0.9)',
        borderColor: resonant ? '#ffd76a' : PALETTE.border,
        borderWidth: resonant ? 2.5 : 1.5,
      });
      ui.text(relic.icon || '◆', x + size / 2, y + size / 2, { size: 18 * s, align: 'center' });
      if (resonant) {
        const pulse = 0.5 + 0.5 * Math.sin(run.time * 4);
        r.strokeRect(x - 2, y - 2, size + 4, size + 4, '#ffd76a', 1, pulse * 0.6);
      }
      x -= size + 6;
    }

    // active buff timers
    let by = y - 24 * s;
    for (const b of p.buffs) {
      if (b.t > 9000) continue;         // permanent buffs are not timers
      const w = 90 * s;
      ui.bar(W - 18 - w, by, w, 8 * s, clamp(b.t / 60, 0, 1), '#ffd76a', { bg: 'rgba(4,6,14,0.7)' });
      ui.text(b.id + ' ' + b.t.toFixed(0) + 's', W - 18 - w - 6, by + 4 * s,
              { size: 10 * s, color: PALETTE.textDim, align: 'right', mono: true });
      by -= 13 * s;
    }

    // evolution badges
    if (p.evolutions.length) {
      ui.text('EVOLVED: ' + p.evolutions.length, W - 18, H - 60 * s,
              { size: 11 * s, color: PALETTE.accent, align: 'right', weight: 800 });
    }
  }

  // --- boss bar --------------------------------------------------------------
  _bossBar(r, run, W, s) {
    const b = run.boss;
    const e = b.active;
    if (!e) return;
    const t = easeOutCubic(this.bossBarT);
    const w = Math.min(760, W * 0.62) * s;
    const x = (W - w) / 2;
    const y = lerp(-70, 78 * s, t);

    const frac = clamp(e.hp / e.maxHp, 0, 1);
    ui.panel(x - 8, y - 26 * s, w + 16, 54 * s, { color: 'rgba(8,10,20,0.86)', radius: 10 });
    ui.text(displayName(b.def), W / 2, y - 10 * s, {
      size: 18 * s, color: '#ff6f91', align: 'center', weight: 800, outline: true,
    });
    if (b.def.epithet) {
      ui.text(b.def.epithet, W / 2, y + 4 * s, {
        size: 11 * s, color: PALETTE.textFaint, align: 'center', weight: 600,
      });
    }
    ui.bar(x, y + 12 * s, w, 12 * s, frac, '#ff3a5e', { bg: 'rgba(4,6,14,0.9)' });

    // Phase separators, so the player can see the fight's structure.
    if (b.def.phases) {
      for (const ph of b.def.phases) {
        if (ph.hpTo <= 0) continue;
        r.drawRect(x + w * ph.hpTo, y + 12 * s, 2, 12 * s, '#0b0d16', 0.9);
      }
      const ph = b.phase;
      if (ph) {
        ui.text(ph.name, x + w, y + 32 * s, {
          size: 11 * s, color: ph.enrage ? '#ff3a5e' : PALETTE.textDim, align: 'right', weight: 700,
        });
      }
    }

    // Multi-part bosses show a pip per surviving tentacle/tail.
    if (b.parts) {
      let alive = 0;
      for (let i = 0; i < b.parts.length; i++) if (b.parts[i] > 0) alive++;
      ui.text(`${alive}/${b.parts.length}`, x, y + 32 * s,
              { size: 11 * s, color: PALETTE.accent, weight: 700, mono: true });
    }

    // Intro card.
    if (b.introT > 0 && b.def.quote) {
      const a = clamp(b.introT / feel.bossIntroDuration, 0, 1);
      ui.text(b.def.quote, W / 2, y + 74 * s, {
        size: 15 * s, color: '#e8ecf5', align: 'center', weight: 600, alpha: a, outline: true,
      });
    }
  }

  // --- QTE -------------------------------------------------------------------
  _qte(r, run, W, H) {
    const q = run.qte;
    const f = q.got / q.need;
    ui.panel(W / 2 - 180, H * 0.62, 360, 74, { color: 'rgba(10,4,10,0.94)', borderColor: '#ff3a5e', borderWidth: 3 });
    ui.text('MASH!', W / 2, H * 0.62 + 24, { size: 26, color: '#ff3a5e', align: 'center', weight: 800 });
    ui.bar(W / 2 - 156, H * 0.62 + 42, 312, 16, f, '#ffd94a', { bg: 'rgba(0,0,0,0.6)' });
    // DECISIONS.md §17 — any input works, and the prompt says so.
    ui.text('any button · any key · tap', W / 2, H * 0.62 + 66,
            { size: 11, color: PALETTE.textFaint, align: 'center' });
  }

  _killStreak(r, run, W, H) {
    if (run.killStreak.count < feel.killStreakThreshold) return;
    const pulse = 1 + 0.06 * Math.sin(run.time * 12);
    ui.text(run.killStreak.count + ' KILL STREAK', W / 2, H * 0.24, {
      size: 26 * pulse, color: '#ffd94a', align: 'center', weight: 800, outline: true,
    });
  }

  _stageManager(r, run, W, H) {
    const t = run.stageManagerT;
    ui.text("THAT'S A WRAP.", W / 2, H * 0.16, {
      size: 30, color: '#ff3a5e', align: 'center', weight: 800, outline: true,
      alpha: 0.6 + 0.4 * Math.sin(run.time * 3),
    });
    ui.text(t.toFixed(1) + 's', W / 2, H * 0.16 + 26, {
      size: 16, color: PALETTE.textDim, align: 'center', mono: true, weight: 700,
    });
  }

  _lowHpVignette(r, run) {
    const p = run.player;
    if (!p.isLowHp || p.dead) return;
    // Pulses with the heartbeat SFX (SECTION 3).
    const beat = 0.5 + 0.5 * Math.sin(run.time * feel.lowHpPulseHz * TAU);
    const strength = (1 - p.hpFraction / feel.lowHpThreshold) * (0.28 + beat * 0.22);
    r.vignette('rgba(180,20,50,0.95)', clamp(strength, 0, 0.6));
  }

  // --- TAB: detailed stats ---------------------------------------------------
  _statSheet(r, run, W, H) {
    const p = run.player;
    // Taller than it was: the sheet now carries the arsenal as well as the
    // stats, and a sheet that runs off its own panel is worse than no sheet.
    const w = 460, h = Math.min(660, H - 40);
    const x = (W - w) / 2, y = (H - h) / 2;
    r.overlay('#05060d', 0.6);
    ui.panel(x, y, w, h, { color: 'rgba(10,13,24,0.97)' });
    ui.title(displayName(p.def), x + 20, y + 34, { size: 22 });
    ui.text(p.def.epithet + '  ·  S' + p.starLevel, x + 20, y + 56, { size: 13, color: PALETTE.accent });

    const rows = [
      ['HP', `${Math.ceil(p.hp)} / ${Math.round(p.maxHp)}`],
      ['Armour', p.stats.armor.toFixed(1)],
      ['Move speed', p.stats.moveSpeed.toFixed(0) + ' px/s'],
      ['Damage', 'x' + p.stats.damageMult.toFixed(2)],
      ['Auto damage', 'x' + (p.stats.damageMult * p.stats.autoDamageMult).toFixed(2)],
      ['Attack speed', 'x' + p.stats.attackSpeedMult.toFixed(2)],
      ['Area', 'x' + p.stats.areaMult.toFixed(2)],
      ['Projectiles', '+' + p.stats.projectileCount],
      ['Pierce', '+' + p.stats.pierce],
      ['Crit chance', (p.stats.critChance * 100).toFixed(1) + '%'],
      ['Crit damage', 'x' + p.stats.critMult.toFixed(2)],
      ['Cooldowns', 'x' + p.stats.cooldownMult.toFixed(2)],
      ['Dodge', (p.stats.dodge * 100).toFixed(1) + '%  (cap 60%)'],
      ['Lifesteal', (p.stats.lifesteal * 100).toFixed(1) + '%'],
      ['Regen', p.stats.regen.toFixed(1) + ' hp/s'],
      ['Pickup radius', p.stats.pickupRadius.toFixed(0) + ' px'],
      ['XP gain', 'x' + p.stats.xpMult.toFixed(2)],
      ['Gold gain', 'x' + p.stats.goldMult.toFixed(2)],
      ['Luck', p.stats.luck.toFixed(1)],
      ['Revives left', String(p.stats.revives - Object.keys(run.revivesUsed).length)],
    ];
    let yy = y + 84;
    for (const [k, v] of rows) {
      ui.statRow(k, v, x + 20, yy, w - 40);
      yy += 19;
    }

    // Weapons first — they are the biggest single contributor to what is
    // actually happening on screen, so they lead the sheet, not trail it.
    yy += 8;
    ui.text('WEAPONS  ' + run.weapons.count + '/' + run.weapons.max,
            x + 20, yy, { size: 12, color: PALETTE.accent2, weight: 800 });
    yy += 18;
    // `wep`, not `w`: `w` is this function's panel width, and a `for (const w …)`
    // here shadows it, so the row width silently becomes NaN.
    for (const wep of run.weapons.slots) {
      const maxL = run.weapons.maxLevel(wep);
      const tail = wep.evolved ? 'EVOLVED' : 'Lv ' + wep.level + '/' + maxL;
      ui.statRow(`${run.weapons.iconOf(wep)}  ${run.weapons.nameOf(wep).split(' [')[0]}`,
                 tail, x + 20, yy, w - 40,
                 { color: wep.evolved ? '#ffd76a' : run.weapons.isMaxed(wep) ? '#7bf59a' : PALETTE.text });
      yy += 17;
    }
    for (let i = run.weapons.count; i < run.weapons.max; i++) {
      ui.text('·  empty slot', x + 20, yy, { size: 11, color: PALETTE.textFaint });
      yy += 17;
    }

    // Upgrade list
    yy += 8;
    ui.text('UPGRADES', x + 20, yy, { size: 12, color: PALETTE.accent, weight: 800 });
    yy += 18;
    let col = 0;
    for (const id in p.upgrades) {
      const up = run.data.upgrades.UPGRADES_BY_ID[id];
      if (!up) continue;
      const maxed = p.upgrades[id] >= up.maxLevel;
      ui.text(`${up.name} ${p.upgrades[id]}/${up.maxLevel}`,
              x + 20 + (col % 2) * (w / 2 - 20), yy + Math.floor(col / 2) * 16,
              { size: 11, color: maxed ? PALETTE.accent : PALETTE.textDim });
      col++;
    }

    ui.text('hold TAB', x + w - 20, y + h - 14, { size: 10, color: PALETTE.textFaint, align: 'right' });
  }

  // --- touch --------------------------------------------------------------
  _touchControls(r, W, H) {
    const rad = Math.min(W, H) * 0.13;
    // Virtual stick base (bottom-left) — drawn only as a hint ring.
    const t = input.touch;
    if (t.active) {
      r.strokeCircle(t.stickBaseX, t.stickBaseY, 62, 'rgba(255,255,255,0.25)', 3, 1);
      r.drawCircle(t.stickX, t.stickY, 26, 'rgba(255,255,255,0.35)', 1);
    } else {
      r.strokeCircle(W * 0.16, H * 0.78, 62, 'rgba(255,255,255,0.10)', 3, 1);
    }
    // Two ability buttons (bottom-right), positioned clear of the HUD.
    r.strokeCircle(W - rad * 1.5, H - rad * 1.5, rad, 'rgba(255,95,162,0.4)', 3, 1);
    ui.text('✦', W - rad * 1.5, H - rad * 1.5, { size: rad * 0.7, align: 'center', color: '#ff5fa2' });
    r.strokeCircle(W - rad * 3.4, H - rad * 1.2, rad, 'rgba(106,216,255,0.4)', 3, 1);
    ui.text('➤', W - rad * 3.4, H - rad * 1.2, { size: rad * 0.7, align: 'center', color: '#6ad8ff' });
  }
}

export const hud = new Hud();
