// The run scene: owns a Run, draws the world, and routes the freeze screens.
//
// DRAW ORDER matters for readability, which SECTION 1 makes a hard requirement:
//     background -> obstacles -> fields -> pickups -> minions -> enemies ->
//     boss parts -> player -> projectiles -> particles -> telegraphs ->
//     damage numbers -> HUD
// Telegraphs go OVER the horde deliberately: a red zone you cannot see because
// forty zombies are standing on it is the definition of unfair.

import { Run, RUN_STATE } from '../game/run.js';
import { hud } from '../ui/hud.js';
import { levelUpScreen } from '../ui/levelUpScreen.js';
import { ui, PALETTE } from '../ui/widgets.js';
import { camera } from '../render/camera.js';
import { particles } from '../render/particles.js';
import { damageNumbers, floaters } from '../render/damageNumbers.js';
import { shake, flash } from '../render/screenShake.js';
import { debugOverlay } from '../render/debug.js';
import { atlas } from '../render/spriteAtlas.js';
import { input, ACT } from '../core/input.js';
import { audio } from '../core/audio.js';
import { save } from '../core/save.js';
import { events, EV } from '../core/events.js';
import { feel } from '../core/feel.js';
import { hitstop, setTimeScale, game } from '../main.js';
import { clamp, TAU, lerp, formatTime } from '../core/math.js';

export const runScene = {
  manager: null,
  run: null,
  endT: 0,
  _bgSprites: null,

  enter(params, mgr) {
    this.manager = mgr;
    const shared = mgr.shared;
    const cfg = {
      characterId: params.characterId || shared.characterId,
      stageId: params.stageId || shared.stageId,
      tierIndex: params.tierIndex !== undefined ? params.tierIndex : shared.tierIndex,
      endless: params.endless || shared.endless,
      seed: params.seed || shared.seed || ((Math.random() * 0x7fffffff) | 0),
    };
    shared.seed = cfg.seed;

    this.run = new Run(mgr.data, cfg);
    this.endT = 0;
    hud.reset();
    debugOverlay.attachRun(this.run);
    audio.playMusic(this.run.stage.music);

    // Codex: seeing something is what unlocks its entry.
    this._codexUnsub = events.on(EV.ENEMY_SPAWNED, (e) => {
      const cat = (e.isBoss || e.isMidBoss) ? 'bosses' : 'enemies';
      if (!save.data.codex[cat][e.id]) { save.data.codex[cat][e.id] = true; save.touch(); }
    });
    save.data.codex.characters[cfg.characterId] = true;
    save.data.stats.runs++;
    save.touch();
  },

  exit() {
    if (this._codexUnsub) events.off(EV.ENEMY_SPAWNED, this._codexUnsub);
    audio.stopMusic();
    if (this.run) { this.run.dispose(); this.run = null; }
    debugOverlay.attachRun(null);
  },

  update(dt) {
    const run = this.run;
    if (!run) return;

    // Presentation-only timer for the pickup-radius flare. Lives on the scene,
    // not on the player, so it can never perturb a seeded replay.
    if (this._pickupFlare > 0) this._pickupFlare -= dt;

    // --- pause ---------------------------------------------------------------
    if (input.pressed(ACT.PAUSE)) {
      if (run.state === RUN_STATE.PLAYING) { run.state = RUN_STATE.PAUSED; audio.play('uiBack'); }
      else if (run.state === RUN_STATE.PAUSED) { run.state = RUN_STATE.PLAYING; }
    }
    if (run.wantQuit) { this._finish(false); return; }
    if (run.wantSettings) { run.wantSettings = false; this.manager.go('settings', { returnTo: 'run' }); return; }

    run.update(dt);
    hud.update(run, dt);
    levelUpScreen.update(run, dt);

    // Hitstop is requested by the damage path and consumed here, so the run
    // stays a pure simulation and main.js owns wall-clock effects.
    const hs = run.consumeHitstop();
    if (hs > 0) hitstop(hs, feel.hitstopScale);
    if (run._slowmoT > 0) {
      run._slowmoT -= dt;
      setTimeScale(run._slowmoScale);
      if (run._slowmoT <= 0) setTimeScale(1);
    }

  },

  /**
   * Real-time, once per frame, OUTSIDE the fixed-timestep loop.
   *
   * The end-of-run transition lives here and nowhere else. Death applies a
   * 0.25x slow-mo and a hitstop; if either ever pinned the time scale near zero
   * the sim-time version of this timer would crawl or stop, and the player
   * would be stuck on the death card with no way out. Getting off the death
   * screen must never depend on the simulation making progress.
   */
  updateRealtime(dtReal) {
    const run = this.run;
    if (!run) return;
    if (run.state !== RUN_STATE.VICTORY && run.state !== RUN_STATE.DEFEAT) return;

    this.endT += dtReal;
    // Any input skips the card immediately; otherwise it auto-advances.
    const skipped = input.pressed(ACT.CONFIRM) || input.pressed(ACT.SPECIAL) ||
                    input.pressed(ACT.ESCAPE) || input.pressed(ACT.PAUSE) ||
                    input.mouseClicked;
    if (this.endT > 2.2 || (skipped && this.endT > 0.35)) {
      // Whatever the sim was doing, it is over now.
      setTimeScale(1);
      run._slowmoT = 0;
      this._finish(run.victory);
    }
  },

  _finish(victory) {
    const run = this.run;
    if (!run || this._finishing) return;
    this._finishing = true;
    setTimeScale(1);
    const summary = run.summary();
    summary.victory = victory && run.victory;
    this.manager.shared.lastResult = summary;

    // CLAIM TICKET — written before the results screen is even reached.
    // The payout itself lives on the results screen, so anything that stops the
    // player getting there (a hang, a crash, a refresh, alt-F4) used to void the
    // entire run. Now the run's earnings are on disk the moment it ends; results
    // clears the ticket after paying, and boot pays out any ticket it finds.
    try {
      save.data.pendingRun = {
        gold: Math.max(0, Math.round(summary.gold || 0)),
        fragments: Math.max(0, Math.round(summary.fragments || 0)),
        victory: !!summary.victory,
        stage: summary.stage,
        at: Date.now(),
      };
      save.save();
    } catch (e) { /* a failed ticket must never block the transition */ }

    this._finishing = false;
    this.manager.go('results');
  },

  clearColor() {
    return this.run ? this.run.stage.palette.bg : '#05060d';
  },

  render(r, alpha) {
    const run = this.run;
    if (!run) return;

    const cx = camera.renderX(alpha);
    const cy = camera.renderY(alpha);
    r.setCamera(cx, cy, camera.scale);

    this._background(r, run, cx, cy);
    run.obstacles.draw(r, alpha);
    run.hazards.drawUnder(r, alpha);
    this._pickupRing(r, run, alpha);
    this._altar(r, run);
    run.pickups.draw(r, alpha);
    run.boss.drawUnder(r, alpha);
    run.minions.draw(r, alpha);
    run.enemies.draw(r, alpha);
    run.player.draw(r, alpha);
    run.projectiles.draw(r, alpha);
    run.enemyProjectiles.draw(r, alpha);
    this._overlays(r, run);
    particles.draw(r, alpha);
    run.boss.drawOver(r, alpha);
    run.hazards.drawOver(r, alpha);
    this._enemyBars(r, run, alpha);
    this._marks(r, run, alpha);
    damageNumbers.draw(r);
    floaters.draw(r);
    this._edgeArrows(r, run, cx, cy);

    // --- screen space ---------------------------------------------------------
    r.setScreenSpace();
    if (flash.alpha > 0.002) r.overlay(flash.color, flash.alpha);
    // The smoke-bomb hazard darkens everything outside the visibility radius.
    if (run.hazards.visibilityRadius > 0 && run.hazards.visibilityRadius < 2000 &&
        !run.player.flags.ignoreVisionHazard) {
      r.vignette('rgba(6,8,14,0.97)', 0.85);
    }
    hud.draw(r, run);
    levelUpScreen.draw(r, run);
    if (run.state === RUN_STATE.VICTORY || run.state === RUN_STATE.DEFEAT) {
      this._endCard(r, run);
    }
  },

  // --- world background -------------------------------------------------------
  _background(r, run, cx, cy) {
    const pal = run.stage.palette;
    const b = run.bounds;
    // Ground fill + a parallax grid. Cheap, readable, and it gives the player a
    // sense of motion that a flat colour cannot.
    r.drawRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY, pal.ground || pal.bg, 1);

    const cell = 128;
    const x0 = Math.floor((cx - r.halfW) / cell) * cell;
    const x1 = cx + r.halfW + cell;
    const y0 = Math.floor((cy - r.halfH) / cell) * cell;
    const y1 = cy + r.halfH + cell;
    const gridColor = pal.grid || 'rgba(255,255,255,0.04)';
    for (let x = x0; x < x1; x += cell) r.drawLine(x, y0, x, y1, gridColor, 1, 0.35);
    for (let y = y0; y < y1; y += cell) r.drawLine(x0, y, x1, y, gridColor, 1, 0.35);

    // Arena boundary — a visible wall, because an invisible one feels broken.
    r.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY, pal.accent || '#ff2d95', 6, 0.4);

    // Ambient motes.
    const amb = run.stage.ambience;
    if (amb && (run.frameParity & 3) === 0) {
      particles.drift(
        cx + (Math.random() - 0.5) * r.halfW * 2,
        cy + (Math.random() - 0.5) * r.halfH * 2,
        amb.particleColor || pal.accent,
        { life: 2.2, size: 0.35, speed: 12, shape: amb.particleShape });
    }
  },

  _altar(r, run) {
    const a = run.altar;
    if (a.used) return;
    const pulse = 1 + 0.08 * Math.sin(run.time * 2.2);
    r.drawSprite(a.sprite, a.x, a.y, 0, pulse, 1, false, 0);
    r.strokeCircle(a.x, a.y, 60 + Math.sin(run.time * 2) * 5, '#ff5f7e', 2, 0.35);
  },

  /** Boss-driven beams / rings / wedges, plus melee arc flashes. */
  /**
   * THE PICKUP RADIUS, DRAWN ON THE GROUND.
   *
   * Lodestone is a purely spatial upgrade, and an invisible radius is an
   * upgrade the player has to take on faith — which is how a stat that has been
   * quietly growing all run reads as "this does nothing". Drawing the ring
   * makes every level of it a visible, measurable step, and it doubles as a
   * permanent read on how close a gem has to be before it comes to you.
   *
   * Faint by default so it never competes with the horde; it flares for a
   * couple of seconds whenever the radius actually changes.
   */
  _pickupRing(r, run, alpha) {
    const p = run.player;
    const rad = p.stats.pickupRadius;
    if (rad <= 0) return;
    const x = p.px + (p.x - p.px) * alpha;
    const y = p.py + (p.y - p.py) * alpha;

    // Flare on change. Tracked here rather than on the player because it is a
    // presentation concern and must not exist in the simulation.
    if (this._lastPickupR === undefined) this._lastPickupR = rad;
    if (Math.abs(rad - this._lastPickupR) > 0.5) {
      this._lastPickupR = rad;
      this._pickupFlare = 2.2;
    }
    const flare = this._pickupFlare > 0 ? this._pickupFlare / 2.2 : 0;

    const pulse = 0.5 + 0.5 * Math.sin(run.time * 2.2);
    r.strokeCircle(x, y, rad, '#6ad8ff', 1.5 + flare * 2.5,
                   0.10 + pulse * 0.05 + flare * 0.55);
    if (flare > 0.01) {
      r.drawCircle(x, y, rad, '#6ad8ff', flare * 0.06);
      r.strokeCircle(x, y, rad * (1 + (1 - flare) * 0.25), '#8ef0ff', 2, flare * 0.35);
    }
  },

  _overlays(r, run) {
    const o = run.overlays;
    for (const b of o.beams) r.drawBeam(b.x0, b.y0, b.x1, b.y1, b.w, b.color, 0.65);
    for (const g of o.rings) r.strokeCircle(g.x, g.y, g.r, g.color, 5, 0.55);
    for (const w of o.wedges) {
      r.drawWedge(w.x, w.y, w.r, w.a0, w.a1, w.color, 0.22);
      r.drawArc(w.x, w.y, w.r, w.a0, w.a1, w.color, 3, 0.6);
    }
  },

  /** Health bars for elites and bosses only — never for fodder. */
  _enemyBars(r, run, alpha) {
    const items = run.enemies.items;
    for (let i = 0; i < run.enemies.count; i++) {
      const e = items[i];
      if (!e.isElite && !e.isBoss && !e.isMidBoss) continue;
      if (e.spawnT > 0) continue;
      const x = e.px + (e.x - e.px) * alpha;
      const y = e.py + (e.y - e.py) * alpha - e.radius - 14;
      const w = Math.max(50, e.radius * 2.2);
      const f = clamp(e.hp / e.maxHp, 0, 1);
      r.drawRect(x - w / 2, y, w, 6, 'rgba(4,6,14,0.85)', 1);
      r.drawRect(x - w / 2, y, w * f, 6, e.isBoss ? '#ff3a5e' : '#ffd76a', 1);
      if (e.isElite && e.affixes) {
        let ax = x - w / 2;
        for (const af of e.affixes) {
          r.drawRect(ax, y - 8, 6, 6, af.color || '#ffd76a', 0.9);
          ax += 8;
        }
      }
    }
  },

  /** Kira's death timers and Kagura's ofuda need to be legible on the enemy. */
  _marks(r, run, alpha) {
    const items = run.enemies.items;
    for (let i = 0; i < run.enemies.count; i++) {
      const e = items[i];
      if (e.st.markKind === 0 || e.st.markT <= 0) continue;
      const x = e.px + (e.x - e.px) * alpha;
      const y = e.py + (e.y - e.py) * alpha - e.radius - 8;
      const f = e.st.markMax > 0 ? e.st.markT / e.st.markMax : 0;
      // A shrinking ring plus the seconds — colour alone is not enough.
      r.strokeCircle(x, y, 9, '#ff3a5e', 2, 0.9);
      r.drawWedge(x, y, 8, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - f), '#ff3a5e', 0.75);
    }
  },

  /**
   * Compass arrows at the screen edge for chests and Treasure Carriers.
   * Akane's Treasure Sense turns these on permanently; everyone gets them for
   * an active Treasure Carrier, because a fleeing enemy you cannot find is a
   * frustration, not a chase.
   */
  _edgeArrows(r, run, cx, cy) {
    const p = run.player;
    if (!p.flags.treasureCompass) return;
    const items = run.pickups.items;
    for (let i = 0; i < run.pickups.count; i++) {
      const g = items[i];
      if (g.kind < 7) continue;                    // chests and above only
      const dx = g.x - cx, dy = g.y - cy;
      if (Math.abs(dx) < r.halfW * 0.9 && Math.abs(dy) < r.halfH * 0.9) continue;
      const a = Math.atan2(dy, dx);
      const ex = cx + Math.cos(a) * r.halfW * 0.86;
      const ey = cy + Math.sin(a) * r.halfH * 0.86;
      r.drawWedge(ex, ey, 16, a - 0.35, a + 0.35, '#ffd76a', 0.85);
    }
  },

  _endCard(r, run) {
    const W = r.w, H = r.h;
    const t = clamp(this.endT / 0.8, 0, 1);
    r.overlay('#05060d', t * 0.55);
    const title = run.victory ? 'VICTORY' : 'RUN OVER';
    ui.text(title, W / 2, H * 0.42, {
      size: 72 * t, color: run.victory ? '#ffd76a' : '#ff6f91',
      align: 'center', weight: 800, outline: true, alpha: t,
    });
    if (!run.victory && run.stats.killedBy) {
      ui.text('Taken out by ' + run.stats.killedBy + '.', W / 2, H * 0.42 + 52, {
        size: 17, color: PALETTE.textDim, align: 'center', alpha: t,
      });
    }
    ui.text('You keep everything you earned.', W / 2, H * 0.42 + 80, {
      size: 14, color: PALETTE.textFaint, align: 'center', alpha: t,
    });
  },
};
