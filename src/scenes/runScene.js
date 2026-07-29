// The run scene: owns a Run, draws the world, and routes the freeze screens.
//
// DRAW ORDER matters for readability, which SECTION 1 makes a hard requirement:
//     background -> obstacles -> fields -> pickups -> minions -> enemies ->
//     boss parts -> player -> projectiles -> overlays -> particles -> ability
//     effects -> telegraphs -> damage numbers -> HUD
// Telegraphs go OVER the horde deliberately: a red zone you cannot see because
// forty zombies are standing on it is the definition of unfair.
//
// The animated ability effects sit ABOVE the particles for the same reason a
// sword swing sits above its own sparks: the swing is the readable thing, the
// sparks are the garnish, and a garnish that occludes the read is noise.

import { Run, RUN_STATE } from '../game/run.js';
import { hud } from '../ui/hud.js';
import { levelUpScreen } from '../ui/levelUpScreen.js';
import { ui, PALETTE } from '../ui/widgets.js';
import { camera } from '../render/camera.js';
import { particles } from '../render/particles.js';
import { effects } from '../render/effects.js';
import { StageBackdrop } from '../render/stageBackdrop.js';
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
  /** The layered scenery for the CURRENT run, and the run it was built for. */
  _backdrop: null,
  _backdropRun: null,

  enter(params, mgr) {
    this.manager = mgr;
    // The one place the finish latch is cleared. A scene object is a singleton
    // reused for every run, so a latch left set by the previous run would make
    // the next death silent.
    this._finishing = false;
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
    this._backdrop = null;
    this._backdropRun = null;
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

    // `_finishing` STAYS SET. It is a one-way latch for the life of this scene,
    // cleared only by enter(), and clearing it here instead is what stranded the
    // player on the death card: updateRealtime() keeps running for as long as
    // this scene is current, the run is still in DEFEAT, and endT is still past
    // 2.2 — so _finish() fired again on the very next frame, and every frame
    // after that. Each one re-armed the scene transition from scratch, so the
    // cross-fade restarted forever and never completed, and each one also wrote
    // the pendingRun claim ticket to disk, at sixty saves a second.
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
    run.stageEvents.drawUnder(r, alpha);
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
    effects.draw(r, alpha);
    run.boss.drawOver(r, alpha);
    run.hazards.drawOver(r, alpha);
    // Over the horde, for exactly the reason telegraphs are: an objective ring
    // you cannot see because forty zombies are standing in it is not an
    // objective, it is a guess.
    run.stageEvents.drawOver(r, alpha);
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
    // Drawn AFTER the HUD, deliberately: `ui` binds itself to the renderer in
    // hud.draw, and a widget drawn before that is drawn against whatever screen
    // bound it last. It also has to sit clear of the HUD's own furniture —
    // portrait top-left, timer top-centre, build strip bottom-centre, relics
    // bottom-right — which leaves the middle of the left edge, and that is
    // where this goes. hud.js belongs to somebody else; this is the scene's own
    // screen-space block.
    this._eventBanner(r, run);
    levelUpScreen.draw(r, run);
    if (run.state === RUN_STATE.VICTORY || run.state === RUN_STATE.DEFEAT) {
      this._endCard(r, run);
    }
  },

  // --- world background -------------------------------------------------------
  /**
   * THE GROUND THE STAGE IS PLAYED ON.
   *
   * Two versions of this have been wrong for opposite reasons. The first was a
   * ground rect, a 128px grid, a border and one drifting mote, identical for all
   * seven stages, so a school roof at sunset and a flooded stadium were the same
   * screen with four hex codes swapped. The second was a parallax diorama —
   * silhouettes at 0.26x scroll, near scenery at 0.58x, mist, a moon, an aurora —
   * and it was distinct per stage but it was drawn ABOVE the arena, because on a
   * TOP-DOWN view "further from the camera than the floor" can only mean in the
   * air. Play report: "maps have a lot of random things floating around the
   * screen, it feels cluttering." Correct, and unfixable by tuning.
   *
   * render/stageBackdrop.js is now one opaque, patterned SURFACE that scrolls
   * 1:1 with the world, and nothing translucent is drawn anywhere except lying
   * flat on it. This scene no longer spawns ambient particles of its own for the
   * same reason; everything the stage's `ambience` colour used to put in the air
   * is now litter on the floor. Everything this function still does is decide
   * WHEN to build the thing.
   *
   * Built lazily against the run rather than in enter(), because enter() is not
   * the only way a run reaches this scene: tests/renderSmoke.js assigns
   * `runScene.run` directly and renders, and a backdrop that only existed on the
   * enter() path would be null for every one of those frames.
   */
  _background(r, run, cx, cy) {
    if (this._backdropRun !== run) {
      this._backdropRun = run;
      this._backdrop = new StageBackdrop(run.stage, run.bounds,
                                         run.data.stages.BACKDROPS, run.seed);
    }
    this._backdrop.draw(r, run, cx, cy);
  },

  /**
   * THE MINI-EVENT BANNER.
   *
   * Three lines and a bar: what it is, how far along you are, and how long is
   * left. It stays up for three seconds after the event resolves, in the result
   * colour, because a marker that simply vanishes reads as a despawn rather than
   * as a win or a loss — and the failure has to be as unmistakable as the win.
   */
  _eventBanner(r, run) {
    const ev = run.stageEvents;
    if (!ev || (!ev.active && ev.resultT <= 0)) return;
    // The system stops ticking the moment the run ends, so `resultT` freezes
    // wherever it was — without this the last banner of the run sits under the
    // death card until the scene changes.
    if (run.state === RUN_STATE.VICTORY || run.state === RUN_STATE.DEFEAT) return;
    const def = ev.def;
    if (!def) return;

    // GEOMETRY is scaled by hand; TEXT SIZES ARE NOT. `ui.text` multiplies by
    // `ui.scale`, which is this same setting — so passing `14 * s` here would
    // render at 14 * s * s and outgrow a panel that only grew by s. Do not
    // "fix" this to match the surrounding style.
    const s = save.data.settings.uiScale || 1;
    const W = 262 * s, H = 66 * s;
    // Below the HP plate, above the ability radials, clear of everything.
    const x = 18, y = Math.max(r.h * 0.32, 212 * s);
    const done = !ev.active;
    const col = done ? (ev.success ? '#7bf59a' : '#ff6f91') : ev.color;
    // Fade the result card out over its last half-second rather than cutting.
    const a = done ? clamp(ev.resultT / 0.6, 0, 1) : 1;

    ui.panel(x, y, W, H, {
      radius: 6, color: 'rgba(12,16,28,0.88)',
      borderColor: col, borderWidth: 2, alpha: a,
    });
    ui.text(done ? (ev.success ? 'EVENT CLEARED' : 'EVENT MISSED') : def.name, x + 12 * s, y + 16 * s, {
      size: 14, color: col, weight: 800, alpha: a,
    });
    ui.text(done ? def.name : this._objectiveLine(ev, def), x + 12 * s, y + 34 * s, {
      size: 11, color: PALETTE.textDim, weight: 700, alpha: a,
    });

    if (!done) {
      // Two readouts in one place: the bar is progress, the thin rule under it
      // is the clock. Neither is guessable from the other and both matter.
      ui.bar(x + 12 * s, y + 44 * s, W - 24 * s, 8 * s, ev.fraction, ev.color,
             { bg: 'rgba(4,6,14,0.8)' });
      const tf = ev.limit > 0 ? ev.timeLeft / ev.limit : 0;
      r.drawRect(x + 12 * s, y + 55 * s, (W - 24 * s) * clamp(tf, 0, 1), 3 * s,
                 tf < 0.25 ? '#ff6f91' : PALETTE.textFaint, 0.9);
      ui.text(Math.ceil(ev.timeLeft) + 's', x + W - 12 * s, y + 16 * s, {
        size: 12, color: tf < 0.25 ? '#ff6f91' : PALETTE.textDim,
        weight: 800, align: 'right', mono: true,
      });
    }
  },

  /** "12 / 18", "9.4s / 16s", "62%" — the progress line, per event kind. */
  _objectiveLine(ev, def) {
    switch (ev.kind) {
      case 'cull':
      case 'gather': return def.objective + '   ' + Math.floor(ev.progress) + ' / ' + ev.need;
      case 'hold': return def.objective + '   ' + ev.progress.toFixed(1) + 's / ' + ev.need + 's';
      default: return def.objective + '   ' + Math.round(ev.fraction * 100) + '%';
    }
  },

  _altar(r, run) {
    const a = run.altar;
    if (a.used) return;
    const pulse = 1 + 0.08 * Math.sin(run.time * 2.2);
    r.drawSprite(a.sprite, a.x, a.y, 0, pulse, 1, false, 0);
    r.strokeCircle(a.x, a.y, 60 + Math.sin(run.time * 2) * 5, '#ff5f7e', 2, 0.35);
  },

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

  /**
   * THE PER-FRAME OVERLAY LISTS: beams, rings and wedges.
   *
   * These are NOT the animated effect layer. They are records that the boss
   * controller and the weapon implementations REPUSH every single sim tick for
   * as long as a channel lasts — `run.update` clears the three lists at the top
   * of every tick — so an entry has no age and no lifetime of its own and can
   * never interpolate against one.
   *
   * What it does have is `run.time`, which is monotonic sim time and identical
   * for every viewer of a replay. Driving the highlights off that is what turns
   * a held breath cone from a static triangle into a cone with a rib sweeping
   * through it, without any of the pushers learning a new contract.
   *
   * Drawn additively in one block: everything here is energy over a dark stage,
   * and flipping the composite once per frame beats flipping it per entry.
   */
  _overlays(r, run) {
    const o = run.overlays;
    const beams = o.beams, rings = o.rings, wedges = o.wedges;
    if (!beams.length && !rings.length && !wedges.length) return;
    const t = run.time;
    r.setComposite('lighter');

    // --- beams: soft outer, body, white-hot core, muzzle and impact bloom ----
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      const w = b.w > 0 ? b.w : 8;
      const fl = 1 + 0.10 * Math.sin(t * 24 + i * 1.7);
      r.drawBeam(b.x0, b.y0, b.x1, b.y1, w * 2.3 * fl, b.color, 0.14);
      r.drawBeam(b.x0, b.y0, b.x1, b.y1, w, b.color, 0.50);
      r.drawBeam(b.x0, b.y0, b.x1, b.y1, Math.max(2, w * 0.34), '#ffffff', 0.55 * fl);
      r.drawCircle(b.x0, b.y0, w * 0.62, '#ffffff', 0.45);
      r.drawCircle(b.x1, b.y1, w * (0.7 + 0.15 * fl), b.color, 0.42);
    }

    // --- rings: a filled core, the hard edge, an inner rail and a breathing rim
    for (let i = 0; i < rings.length; i++) {
      const g = rings[i];
      if (!(g.r > 0)) continue;
      const pulse = 0.5 + 0.5 * Math.sin(t * 6 + i * 0.9);
      r.drawCircle(g.x, g.y, g.r, g.color, 0.09 + pulse * 0.05);
      r.strokeCircle(g.x, g.y, g.r, g.color, 5, 0.55);
      r.strokeCircle(g.x, g.y, g.r * 0.86, g.color, 2, 0.22 + pulse * 0.20);
      r.strokeCircle(g.x, g.y, g.r * (1.04 + pulse * 0.035), '#ffffff', 1.5, 0.22);
    }

    // --- wedges: the pie, both edges, an inner rail and a travelling rib -----
    for (let i = 0; i < wedges.length; i++) {
      const w = wedges[i];
      if (!(w.r > 0)) continue;
      const a0 = w.a0, a1 = w.a1;
      r.drawWedge(w.x, w.y, w.r, a0, a1, w.color, 0.18);
      r.drawArc(w.x, w.y, w.r, a0, a1, w.color, 4, 0.70);
      r.drawArc(w.x, w.y, w.r * 0.55, a0, a1, w.color, 2, 0.28);
      r.drawLine(w.x, w.y, w.x + Math.cos(a0) * w.r, w.y + Math.sin(a0) * w.r, w.color, 2, 0.42);
      r.drawLine(w.x, w.y, w.x + Math.cos(a1) * w.r, w.y + Math.sin(a1) * w.r, w.color, 2, 0.42);
      // The rib: a bright line that walks the cone from edge to edge. It is the
      // whole reason a channelled cone now reads as something being POURED out
      // rather than a shape that happens to be on the screen.
      const k = (t * 2.2 + i * 0.37) % 1;
      const ak = a0 + (a1 - a0) * k;
      const c = Math.cos(ak), s = Math.sin(ak);
      r.drawLine(w.x + c * w.r * 0.18, w.y + s * w.r * 0.18,
                 w.x + c * w.r * 0.98, w.y + s * w.r * 0.98, '#ffffff', 2.5, 0.45);
      r.drawArc(w.x, w.y, w.r * 0.98, ak - 0.09, ak + 0.09, '#ffffff', 5, 0.55);
    }

    r.setComposite('source-over');
    r.setAlpha(1);
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

    // THE OBJECTIVE ARROW, ahead of the treasure-compass guard.
    //
    // Chests only get an arrow for the players who bought one; an active mini
    // event gets one for everybody, always. The marker is placed 600-1250px away
    // from wherever the player happened to be standing, which is routinely off
    // screen at the moment it is announced — an objective you are told about and
    // then cannot find is a worse feature than no objective at all.
    const ev = run.stageEvents;
    if (ev && ev.active) {
      const dx = ev.x - cx, dy = ev.y - cy;
      if (Math.abs(dx) > r.halfW * 0.86 || Math.abs(dy) > r.halfH * 0.86) {
        const a = Math.atan2(dy, dx);
        const ex = cx + Math.cos(a) * r.halfW * 0.84;
        const ey = cy + Math.sin(a) * r.halfH * 0.84;
        const pulse = 0.6 + 0.4 * Math.sin(run.time * 4);
        r.drawWedge(ex, ey, 22, a - 0.38, a + 0.38, ev.color, 0.55 + pulse * 0.35);
        r.strokeCircle(ex, ey, 26, ev.color, 2, 0.3 + pulse * 0.25);
      }
    }

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
