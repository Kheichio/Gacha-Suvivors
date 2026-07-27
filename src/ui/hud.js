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

import { ui, PALETTE, RARITY_COLOR } from './widgets.js';
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

  reset() { this.hpGhost = 1; this.bossBarT = 0; this.introT = 0; }

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

  // --- HP, armour, revives ---------------------------------------------------
  _topLeft(r, run, s) {
    const p = run.player;
    const x = 20, y = 20;
    const w = 300 * s, h = 26 * s;

    // Portrait plate beside the bar — the sprite is already rastered, so this
    // costs one drawImage and immediately says "this is you".
    const port = 40 * s;
    ui.panel(x, y - 2, port, port, { radius: 4, color: '#141a2b', borderColor: 'rgba(160,180,230,0.55)' });
    if (p.sprite) {
      const fit = (port - 8) / Math.max(p.sprite.w, p.sprite.h);
      r.drawSprite(p.sprite, x + port / 2, y - 2 + port / 2, 0, fit, 1, false, 0);
    }

    const bx = x + port + 8;
    const bw = w - port - 8;
    ui.bar(bx, y, bw, h, p.hpFraction,
           p.hpFraction > 0.5 ? '#4ee07a' : p.hpFraction > 0.25 ? '#ffd23f' : '#ff4a6e', {
      ghost: this.hpGhost, ghostColor: 'rgba(255,255,255,0.5)',
      segments: 10,
    });
    ui.text(`${Math.ceil(p.hp)} / ${Math.round(p.maxHp)}`, bx + bw / 2, y + h / 2 + 1, {
      size: 15 * s, color: '#ffffff', align: 'center', weight: 800, outline: true, mono: true,
    });

    let yy = y + Math.max(h, 40 * s) + 8;

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
    const revives = p.stats.revives - Object.keys(run.revivesUsed).length;
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
    const ids = Object.keys(p.upgrades);

    // One tile per held upgrade, laid out in a bar directly above the XP bar.
    // Bottom-centre is where the eye already goes for the XP fill, so the build
    // sits in the player's natural glance path instead of hiding in a corner.
    const n = ids.length + p.evolutions.length;
    if (n === 0) return;

    // Every measurement below is derived from ONE tile size so nothing can
    // overlap: the icon, the level text and the fill ramp each get their own
    // band inside the tile, and the header gets its own row above the grid.
    const tile = 46 * s;
    const gap = 5 * s;
    const padX = 10 * s;
    const headerH = 18 * s;
    const cols = Math.max(1, Math.min(n, Math.floor((W * 0.80 - padX * 2) / (tile + gap))));
    const rows = Math.ceil(n / cols);
    const boxW = cols * (tile + gap) - gap + padX * 2;
    const boxH = headerH + rows * (tile + gap) - gap + 8 * s;
    const bx = (W - boxW) / 2;
    // Sit clear of the XP bar (10*s tall + 4px) with real breathing room.
    const by = H - (10 * s + 4) - boxH - 10 * s;

    ui.panel(bx, by, boxW, boxH, {
      radius: 5, color: 'rgba(16,21,35,0.90)',
      borderColor: 'rgba(150,170,225,0.45)', borderWidth: 2,
    });

    // Slot counters on the header line — the cap has to be legible or the
    // level-up screen suddenly refusing new upgrades reads as a bug.
    const atkFull = slots.used.offensive >= slots.max.offensive;
    const utlFull = slots.used.utility >= slots.max.utility;
    const hy = by + headerH / 2 + 1;
    // Right-aligned counters measured from the right edge, so they cannot run
    // into each other or off the plate however wide the box gets.
    ui.text(`UTL ${slots.used.utility}/${slots.max.utility}`, bx + boxW - padX, hy, {
      size: 10 * s, color: utlFull ? '#ffd23f' : PALETTE.textDim,
      weight: 800, mono: true, align: 'right',
    });
    const utlW = r.measureText(`UTL ${slots.used.utility}/${slots.max.utility}`, 10 * s, 800);
    ui.text(`ATK ${slots.used.offensive}/${slots.max.offensive}`,
            bx + boxW - padX - utlW - 12 * s, hy, {
      size: 10 * s, color: atkFull ? '#ffd23f' : PALETTE.textDim,
      weight: 800, mono: true, align: 'right',
    });
    ui.text('BUILD', bx + padX, hy, {
      size: 10 * s, color: PALETTE.textFaint, weight: 800, mono: true,
    });

    let i = 0;
    const place = (ix) => ({
      x: bx + padX + (ix % cols) * (tile + gap),
      y: by + headerH + Math.floor(ix / cols) * (tile + gap),
    });

    for (const id of ids) {
      const up = run.data.upgrades.UPGRADES_BY_ID[id];
      if (!up) continue;
      const lv = p.upgrades[id];
      const maxed = lv >= up.maxLevel;
      const { x, y } = place(i++);

      r.drawRect(x, y, tile, tile, maxed ? 'rgba(255,210,63,0.16)' : 'rgba(8,11,20,0.85)', 1);
      r.strokeRect(x, y, tile, tile, maxed ? '#ffd23f' : 'rgba(150,170,225,0.40)', 2, 1);
      // Three bands that cannot collide: icon centred at 32%, level text at
      // 68%, ramp pinned to the foot. All explicitly baselined 'middle' so the
      // glyph box never bleeds into the band below it.
      ui.text(up.icon || '◆', x + tile / 2, y + tile * 0.32, {
        size: 16 * s, align: 'center', baseline: 'middle',
      });
      ui.text(`${lv}/${up.maxLevel}`, x + tile / 2, y + tile * 0.68, {
        size: 10 * s, color: maxed ? '#ffd23f' : PALETTE.textDim,
        align: 'center', baseline: 'middle', weight: 800, mono: true,
      });
      r.drawRect(x + 4, y + tile - 7, tile - 8, 3, 'rgba(5,7,14,0.8)', 1);
      r.drawRect(x + 4, y + tile - 7, (tile - 8) * (lv / up.maxLevel), 3,
                 maxed ? '#ffd23f' : '#6ad8ff', 1);
    }

    // Evolutions get a gold tile — they are the payoff and should stand out.
    for (const eid of p.evolutions) {
      const evo = run.data.evolutions.EVOLUTIONS_BY_ID[eid];
      if (!evo) continue;
      const { x, y } = place(i++);
      const pulse = 0.6 + 0.4 * Math.sin(run.time * 3);
      r.drawRect(x, y, tile, tile, 'rgba(255,215,106,0.22)', 1);
      r.strokeRect(x, y, tile, tile, '#ffd76a', 2, pulse);
      ui.text(evo.icon || '✦', x + tile / 2, y + tile * 0.32, {
        size: 16 * s, align: 'center', baseline: 'middle',
      });
      ui.text('EVO', x + tile / 2, y + tile * 0.68, {
        size: 9 * s, color: '#ffd76a', align: 'center', baseline: 'middle',
        weight: 800, mono: true,
      });
    }
  }

  // --- relics + buffs --------------------------------------------------------
  _bottomRight(r, run, W, H, s) {
    const p = run.player;
    const size = 34 * s;
    let x = W - 18 - size;
    const y = H - 42 * s - size;

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
    const w = 420, h = 520;
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
