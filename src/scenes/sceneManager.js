// Scene manager.
//
// A scene is a plain object: { enter(params), exit(), update(dt), render(r, alpha),
// resize(w, h)?, clearColor()? }. Transitions are implemented here so no screen
// has to implement one.
//
// THE TRANSITION IS DIRECTIONAL, AND NO SCENE KNOWS THAT.
// -------------------------------------------------------
// Every navigation used to be the same 0.22s dip to black. It is not that the
// cross-fade looked bad; it is that it carried no information. Eight of these
// screens are reached by pressing a card that is ALREADY the right shape, in
// the right place, in the right colour, and throwing all three away at the
// moment of travel makes a menu feel like a set of unrelated documents rather
// than one place you are moving around inside.
//
// So a navigation now plays in two beats: the widget the player pressed grows
// until it covers the screen, and then that plate splits at the widget's own
// position and opens to reveal where they landed. "This card took me there",
// told in geometry.
//
// The scenes are not involved. `go()` takes exactly the arguments it always
// took; the rect and the colour come from `ui.takeSource()`, which the toolkit
// fills in for free on every activated button (see widgets.js markSource). A
// screen this file's author has never read gets the transition anyway, and a
// navigation with no widget behind it — the boot call, a recovery from a thrown
// scene — finds no source and degrades to exactly the cross-fade it always was.
//
// Everything meta-facing (hub, roster, gacha, shrine, codex, settings, results)
// is a scene; the run itself is a scene that owns a Run.
//
// TWO THINGS ARE ENFORCED CENTRALLY HERE, because ten screens will not each
// remember to do them:
//   · UI input is blocked for the duration of a transition. The cross-fade is
//     painted AFTER the scene, so an outgoing screen is fully hit-testable
//     behind it; two screens had grown a private `_nav` guard for this and the
//     rest had not.
//   · Toasts live at the bottom centre and dismiss on click. They used to stack
//     down the top-right — opaque, for 3.4s, over the gacha SKIP button and
//     every screen's currency pills, with no way to clear them.

import { events } from '../core/events.js';
import { audio } from '../core/audio.js';
import { save, addCurrency } from '../core/save.js';
import { ui } from '../ui/widgets.js';
import { input, ACT } from '../core/input.js';
import { clamp, easeOutCubic, mixHex } from '../core/math.js';
import { Rng, hashString } from '../core/rng.js';
import { createGacha } from '../game/gachaEngine.js';
import { createAchievements } from '../game/achievements.js';
import { settle as settleQuests, unclaimedCount } from '../game/quests.js';

import { hubScene } from './hubScene.js';
import { stageSelectScene } from './stageSelectScene.js';
import { runScene } from './runScene.js';
import { resultsScene } from './resultsScene.js';
import { gachaScene } from './gachaScene.js';
import { rosterScene } from './rosterScene.js';
import { shrineScene } from './shrineScene.js';
import { codexScene } from './codexScene.js';
import { settingsScene } from './settingsScene.js';
import { achievementsScene } from './achievementsScene.js';
import { questsScene } from './questsScene.js';

const FADE_TIME = 0.22;

// The two beats of the directional transition. Deliberately close to the old
// 0.22 + 0.22: the point of the rework is that the travel READS, not that it
// takes longer. The grow is the shorter of the two because it happens while the
// player still has their finger on the button and is not looking for anything;
// the open is where the new screen has to arrive, so it gets the extra frames.
const WIPE_OUT = 0.20;
const WIPE_IN = 0.26;

// When a navigation has a rect but no colour of its own — a BACK button, a list
// row, anything that is not one of the hub's coloured destinations. Muted
// indigo, so it reads as the game's furniture rather than as somebody's accent.
const WIPE_DEFAULT = '#6f7bb8';

// The UI half of the action set. `input.pressed()` is documented as UI-only —
// the simulation reads presses through consume()/the latch — so clearing these
// during a transition cannot drop a gameplay input.
const UI_ACTIONS = [ACT.CONFIRM, ACT.SPECIAL, ACT.BACK, ACT.PAUSE,
                    ACT.UP, ACT.DOWN, ACT.LEFT, ACT.RIGHT];

// Toasts. Bottom-centre, stacked upward, newest lowest.
const TOAST_W = 400;
const TOAST_H = 52;
const TOAST_GAP = 8;
const TOAST_BOTTOM = 18;

class SceneManager {
  constructor() {
    this.scenes = Object.create(null);
    this.current = null;
    this.currentId = '';
    this.data = null;
    this.gacha = null;
    this.achievements = null;
    /** Shared state that outlives a scene: the pending run config, last results. */
    this.shared = { characterId: null, stageId: null, tierIndex: 0, lastResult: null, seed: 0 };
    this._fade = 0;
    /** How long the phase `_fade` is counting down actually lasts. */
    this._fadeTotal = FADE_TIME;
    this._pendingAge = 0;
    this._pending = null;
    /**
     * The directional transition, latched at go() time and mutated in place —
     * never rebuilt. It has to survive `_swap`, because the second beat plays
     * over the screen that has already been entered, and it has to be readable
     * from render() on every frame in between.
     */
    this._wipe = { active: false, x: 0, y: 0, w: 0, h: 0, plate: '#000', rim: '#000', bright: 1 };
    this._toast = [];
    /** The toast a click went down on, so a dismiss needs press AND release. */
    this._toastPress = null;
  }

  async init(data) {
    this.data = data;
    this.gacha = createGacha(data);
    this.achievements = createAchievements(data, this);

    this.register('hub', hubScene);
    this.register('stageSelect', stageSelectScene);
    this.register('run', runScene);
    this.register('results', resultsScene);
    this.register('gacha', gachaScene);
    this.register('roster', rosterScene);
    this.register('shrine', shrineScene);
    this.register('codex', codexScene);
    this.register('settings', settingsScene);
    this.register('achievements', achievementsScene);
    this.register('quests', questsScene);

    // FIRST-RUN GRANT: ONE random ★3, and nothing else.
    //
    // This used to hand over both ★3 starters AND 300 fragments — two 10-pulls,
    // before the player had done anything. The whole opening of the game, given
    // away, which left the first run with no stake in it: the gacha had already
    // been seen, so finishing a run paid out into a menu you had stopped caring
    // about. Now the first quest pays for the first pull (data/quests.js).
    //
    // The pick is seeded from the save's own creation stamp rather than from
    // Math.random, so it is stable for a given save and cannot re-roll on a
    // reload — and it deliberately does NOT touch `metaRng`, whose call count is
    // the gacha's anti-save-scum ledger.
    let owns = false;
    for (const k in save.data.roster) if (save.data.roster[k].owned) { owns = true; break; }
    const starters = data.characters.CHARACTERS_BY_RARITY[3];
    if (!owns) {
      const pick = new Rng(hashString('starter:' + (save.data.createdAt || 1)));
      const id = pick.pick(starters);
      const e = save.data.roster[id] ||
        (save.data.roster[id] = { owned: false, starLevel: 1, letters: 0, bond: 0, runs: 0, kills: 0 });
      e.owned = true;
      this.shared.characterId = id;
      save.save();
    }
    // Whatever is actually owned, never a hardcoded starter: the granted one may
    // not be the first entry in the pool.
    if (!this.shared.characterId || !(save.data.roster[this.shared.characterId] || {}).owned) {
      let first = null;
      for (const c of data.characters.CHARACTERS) {
        if ((save.data.roster[c.id] || {}).owned) { first = c.id; break; }
      }
      this.shared.characterId = first || starters[0];
    }
    this.shared.stageId = data.stages.STAGES[0].id;

    this.achievements.bind();
    this.settleQuests();

    // Claim any run whose results screen never got to pay out. See
    // save.js `pendingRun` — SECTION 2 does not allow a run's earnings to be
    // lost to a bug, so this is the last line of defence.
    const ticket = save.data.pendingRun;
    if (ticket && (ticket.gold > 0 || ticket.fragments > 0)) {
      addCurrency('gold', ticket.gold);
      addCurrency('starFragments', ticket.fragments);
      save.data.pendingRun = null;
      save.save();
      this.toast(`Recovered ${ticket.gold}⭐ and ${ticket.fragments}💎 from your last run.`,
                 '#7bf59a', '💾');
    }
  }

  register(id, scene) {
    this.scenes[id] = scene;
    scene.manager = this;
  }

  /**
   * Switch scenes. Safe to call from inside a scene's update.
   *
   * The signature has not changed and must not: every screen in the game calls
   * this, and the whole design of the directional transition is that none of
   * them has to say anything about it. Where the player pressed comes from the
   * toolkit, which recorded it when the button fired.
   */
  go(id, params) {
    const scene = this.scenes[id];
    if (!scene) { console.warn('[scenes] unknown scene "' + id + '"'); return; }
    this._pending = { id, scene, params: params || EMPTY };
    this._pendingAge = 0;
    this._armTransition(ui.takeSource());
  }

  /**
   * Decide which transition this navigation gets, and set up its first beat.
   *
   * THE OFF SWITCHES, and why they are the ones they are.
   *
   *   screenShakeOff — the shake slider dragged all the way to OFF is the only
   *     unambiguous "do not move the picture at me" control this game has, and
   *     a plate that sweeps across the whole viewport is exactly the thing that
   *     control is for. That player gets the plain cross-fade, unchanged, with
   *     no motion in it at all.
   *
   *   reduceFlashing — a different complaint, so a different answer. This is a
   *     frequency cap (core/feel.js maxFlashHz), and the transition has no
   *     frequency: it is one smooth pass in one direction, which is not what
   *     that setting is protecting against. What IS worth suppressing for it is
   *     the brightness — so the plate goes almost to black and the colour wash
   *     over it is dropped, while the motion that carries the meaning stays.
   *
   * Anything without a usable rect falls back to the cross-fade too, which is
   * what makes this safe to reach from the boot call and from `_sceneError`.
   */
  _armTransition(src) {
    const wipe = this._wipe;
    wipe.active = false;
    this._fadeTotal = FADE_TIME;
    this._fade = FADE_TIME;

    if (!src || !(src.w > 1) || !(src.h > 1)) return;
    if (!isFinite(src.x + src.y + src.w + src.h)) return;
    const s = save.data.settings;
    if (s.screenShakeOff) return;

    const col = (typeof src.color === 'string' && src.color.charAt(0) === '#' &&
                 src.color.length === 7) ? src.color : WIPE_DEFAULT;
    wipe.x = src.x; wipe.y = src.y; wipe.w = src.w; wipe.h = src.h;
    wipe.rim = col;
    // mixHex allocates a string. Once per navigation, never per frame — the
    // draw path below only ever hands these two around by reference.
    wipe.plate = mixHex(col, '#07060f', s.reduceFlashing ? 0.88 : 0.74);
    wipe.bright = s.reduceFlashing ? 0 : 1;
    wipe.active = true;
    this._fadeTotal = WIPE_OUT;
    this._fade = WIPE_OUT;
  }

  /** Immediate switch, no fade. Used at boot. */
  _swap(id, scene, params) {
    if (this.current && this.current.exit) this.current.exit();
    // resetFocus, NOT begin: begin(null, ...) sets ui.r = null, and the very
    // next thing that draws is the new scene's HUD, which would then dereference
    // a null renderer and black-screen the game on its first frame.
    ui.resetFocus(id);
    this.current = scene;
    this.currentId = id;
    if (scene.enter) scene.enter(params, this);
    events.emit('scene:changed', id);
  }

  /**
   * Called ONCE PER RENDER FRAME with real elapsed time, outside the fixed-
   * timestep loop. Anything whose timing must not depend on the simulation
   * running belongs here — most importantly the end-of-run transition.
   *
   * Driving that from update() made it hostage to the sim: death applies a
   * 0.25x slow-mo and a hitstop, and if anything ever pinned the time scale at
   * zero or starved the accumulator, the player sat on the death card forever
   * with no way out. A transition the player needs in order to keep playing
   * cannot be a simulated event.
   */
  updateRealtime(dtReal) {
    // PRESENTATION runs on real time. All of it.
    //
    // The scene TRANSITION lives here, not in update(). Moving only the
    // *decision* to switch into real time was not enough: the cross-fade
    // countdown was still ticking on sim time, so a stalled simulation left
    // `_pending` set forever and the player watched a half-faded death screen
    // with no way out. Deciding to leave and actually leaving both have to be
    // independent of the simulation.
    ui.tick(dtReal);
    this._tickToasts(dtReal);

    if (this._pending) {
      this._fade -= dtReal;
      this._pendingAge = (this._pendingAge || 0) + dtReal;
      // Belt and braces: whatever happens to the fade, a transition older than
      // a second completes. Nothing is worth stranding the player over. This
      // outlives the rework unchanged — both wipe beats together are under 0.5s,
      // so a transition that is still pending at 1.0s is a transition that has
      // gone wrong, and the answer to that is still "arrive anyway".
      if (this._fade <= 0 || this._pendingAge > 1.0) {
        const p = this._pending;
        this._pending = null;
        this._pendingAge = 0;
        // Hand over to the second beat. The plate is covering the whole screen
        // at this instant, which is the only reason the swap underneath it is
        // invisible — so the incoming phase must start at FULL coverage, and
        // both the wipe and the plain fade do.
        this._fadeTotal = this._wipe.active ? WIPE_IN : FADE_TIME;
        this._fade = this._fadeTotal;
        this._swap(p.id, p.scene, p.params);
      }
    } else if (this._fade > 0) {
      this._fade -= dtReal;
      // Let go of the latched rect the moment it stops being drawn, so a stale
      // one can never be picked up by a later navigation that has no source.
      if (this._fade <= 0) this._wipe.active = false;
    }

    if (this.current && this.current.updateRealtime) {
      try { this.current.updateRealtime(dtReal); }
      catch (e) { this._sceneError('updateRealtime', e); }
    }
  }

  _sceneError(phase, e) {
    // A scene that throws must not take the whole loop down with it — a frozen
    // canvas with a stack trace in the console is indistinguishable from a hang.
    if (!this._errored) this._errored = Object.create(null);
    const key = this.currentId + ':' + phase;
    if (!this._errored[key]) {
      this._errored[key] = true;
      console.error(`[scene:${this.currentId}] ${phase}() threw; recovering to the hub`, e);
      this.toast('Something broke on that screen. Back to the hub.', '#ff6f91', '⚠');
    }
    if (this.currentId !== 'hub') this.go('hub');
  }

  /**
   * SIMULATION time. Only the current scene's own sim work — transitions, UI
   * animation and toasts all live in updateRealtime() so they cannot be stalled
   * by anything the simulation does.
   */
  update(dt) {
    if (this.current && this.current.update) {
      try { this.current.update(dt); }
      catch (e) { this._sceneError('update', e); }
    }
  }

  render(r, alpha) {
    // The cursor has to be resolved BEFORE the scene draws. Both of the input
    // gates below have to take a click AWAY from the scene, and by the time the
    // overlay and the toasts are painted the scene has already hit-tested and
    // fired. attach() binds the renderer and resolves ui.mx/ui.my without
    // touching the focus state, which is exactly what is needed here.
    ui.attach(r);
    const rects = this._toastRects(r);
    const overToast = this._toastAt(rects);

    // Click-to-dismiss, tracked here rather than in _drawToasts for the same
    // reason: the press edge belongs to this frame, before the scene sees it.
    if (overToast >= 0 && input.mouseClicked) this._toastPress = this._toast[overToast];
    const dismiss = (overToast >= 0 && input.mouseReleased &&
                     this._toastPress === this._toast[overToast]) ? this._toast[overToast] : null;
    if (input.mouseReleased) this._toastPress = null;

    // UI INPUT IS DEAD WHILE THE SCREEN IS COVERED.
    //
    // The transition overlay is painted after the scene renders, so for the
    // whole of its duration the outgoing screen stayed fully hit-testable behind
    // it — clicking a character card on a screen that is 80% gone fired a real
    // selection. hubScene and stageSelectScene each grew their own `_nav` guard
    // for this and the other eight screens never did, so it is blocked here,
    // once, for all of them: outright while leaving, and while the incoming
    // screen is still more than half hidden.
    //
    // Measured against `_fadeTotal`, not FADE_TIME. The wipe's two beats are
    // different lengths from each other and from the plain fade, and hard-coding
    // one of the three durations here is how this gate silently stops covering
    // the case it exists for.
    const total = this._fadeTotal || FADE_TIME;
    const blocked = !!this._pending || (this._fade > 0 && this._fade / total >= 0.5);
    const wasInside = input.mouseInside;
    const wasClicked = input.mouseClicked;
    const wasReleased = input.mouseReleased;
    if (blocked || overToast >= 0) {
      // mouseInside false puts ui.mx/my off-canvas, so nothing hovers either.
      input.mouseInside = false;
      input.mouseClicked = false;
      input.mouseReleased = false;
    }
    if (blocked) for (const a of UI_ACTIONS) input._pressed[a] = false;

    if (this.current && this.current.render) {
      try { this.current.render(r, alpha); }
      catch (e) { this._sceneError('render', e); }
    }

    input.mouseInside = wasInside;
    input.mouseClicked = wasClicked;
    input.mouseReleased = wasReleased;

    this._drawToasts(r, rects, overToast);
    if (dismiss) {
      const k = this._toast.indexOf(dismiss);
      if (k >= 0) this._toast.splice(k, 1);
      audio.play('uiBack');
    }

    // The transition, over everything, including the toasts.
    //
    // `_fadeTotal` is re-read HERE rather than reused from the `total` above,
    // and the difference is a real one-frame artefact. The scene renders in
    // between: a button inside it can fire, call go(), and re-arm the whole
    // transition with a different phase length. Measuring this frame's progress
    // against the length the previous phase had meant the very first frame of a
    // navigation drew the plate already 23% grown — the one frame of the whole
    // transition where the player is looking straight at the thing that moved.
    // The input gate above keeps the pre-render value on purpose: it governs the
    // render that has already happened.
    if (this._fade > 0) {
      const span = this._fadeTotal || FADE_TIME;
      const k = clamp(1 - this._fade / span, 0, 1);    // 0 -> 1 within the beat
      if (this._wipe.active) this._drawWipe(r, k, !!this._pending);
      else r.overlay('#05060d', this._pending ? k : 1 - k);
    }
  }

  /**
   * The directional transition.
   *
   * BEAT ONE (`leaving`): the pressed widget grows from its own rect until it
   * covers the viewport, corner radius relaxing to zero as it goes, while the
   * screen behind it goes dark. Smoothstep rather than an ease-out — the plate
   * has to leave slowly enough that the eye registers WHICH rect it was, and
   * arrive fast enough that the wait is not felt.
   *
   * BEAT TWO: the plate splits and opens. It splits on the axis the widget was
   * furthest off-centre along, AT the widget's own centre — so a card on the
   * left opens on the left, and the new screen appears to be arriving from the
   * direction the player reached in. A leading edge in the widget's colour
   * rides each door so the motion has something to read against.
   *
   * ZERO ALLOCATION. Two colour strings, latched at go() time; everything else
   * is arithmetic and primitive calls that take their alpha as a number. There
   * is no string building, no options bag and no gradient in here, because this
   * runs on every frame of every navigation for the life of the game.
   */
  _drawWipe(r, k, leaving) {
    const wp = this._wipe;
    const W = r.w, H = r.h;
    r.setScreenSpace();

    if (leaving) {
      const e = k * k * (3 - 2 * k);
      const x = wp.x * (1 - e);
      const y = wp.y * (1 - e);
      const w = wp.w + (W - wp.w) * e;
      const h = wp.h + (H - wp.h) * e;
      const rad = 14 * (1 - e);
      r.overlay('#05060d', e * 0.92);
      // Rim first, plate on top: at full coverage the rim rect is off the edges
      // on all four sides and the plate is flush, so the result is opaque even
      // though neither rectangle alone is.
      r.drawRoundRect(x - 3, y - 3, w + 6, h + 6, rad + 3, wp.rim, 1);
      r.drawRoundRect(x, y, w, h, rad, wp.plate, 1);
      if (wp.bright) {
        // Both of these have to reach ZERO exactly at full coverage. Beat two
        // opens on a flat `wp.plate`, and any wash still left over on the last
        // frame of beat one shows up as a colour pop at the handover — which is
        // the one frame in the whole transition the player is looking hardest at.
        r.drawRoundRect(x, y, w, h, rad, wp.rim, 0.34 * (1 - e));
        r.strokeRect(x, y, w, h, wp.rim, 2, 0.85 * (1 - e));
      }
      return;
    }

    const e = easeOutCubic(k);
    const fade = 1 - e;
    // The new screen comes up out of the dark as the doors part.
    r.overlay('#05060d', fade * 0.55);
    const cx = clamp(wp.x + wp.w / 2, 0, W);
    const cy = clamp(wp.y + wp.h / 2, 0, H);
    const edge = wp.bright ? 0.30 + 0.70 * fade : 0.25 * fade;
    if (Math.abs(cx - W / 2) >= Math.abs(cy - H / 2)) {
      const lw = cx, rw = W - cx;
      const lx = -e * lw, rx = cx + e * rw;
      r.drawRect(lx, 0, lw, H, wp.plate, 1);
      r.drawRect(rx, 0, rw, H, wp.plate, 1);
      if (lw > 0) r.drawRect(lx + lw - 3, 0, 3, H, wp.rim, edge);
      if (rw > 0) r.drawRect(rx, 0, 3, H, wp.rim, edge);
    } else {
      const th = cy, bh = H - cy;
      const ty = -e * th, by = cy + e * bh;
      r.drawRect(0, ty, W, th, wp.plate, 1);
      r.drawRect(0, by, W, bh, wp.plate, 1);
      if (th > 0) r.drawRect(0, ty + th - 3, W, 3, wp.rim, edge);
      if (bh > 0) r.drawRect(0, by, W, 3, wp.rim, edge);
    }
  }

  clearColor() {
    return (this.current && this.current.clearColor) ? this.current.clearColor() : '#05060d';
  }

  onResize(w, h) {
    for (const id in this.scenes) {
      const s = this.scenes[id];
      if (s.resize) s.resize(w, h);
    }
  }

  // --- toasts (achievements, unlocks, errors) --------------------------------
  /**
   * Pay out every quest whose counter is met, and say so.
   *
   * Called at boot, on arriving at the hub, and after a results payout — the
   * three moments a counter can have moved. There is no claim button on
   * purpose; see game/quests.js.
   */
  settleQuests() {
    const paid = settleQuests();
    for (const q of paid) {
      this.toast('QUEST  ' + q.name + ' — ' + q.rewardText, '#7bf59a', q.icon || '✔');
    }
    return paid;
  }

  /** How many completed quests are waiting to be noticed. Drives the hub badge. */
  get questsReady() { return unclaimedCount(); }

  toast(text, color, icon) {
    this._toast.push({ text, color: color || '#ffd76a', icon: icon || '★', t: 0, life: 3.4 });
    if (this._toast.length > 4) this._toast.shift();
  }

  _tickToasts(dt) {
    for (let i = 0; i < this._toast.length; i++) {
      this._toast[i].t += dt;
      if (this._toast[i].t >= this._toast[i].life) { this._toast.splice(i, 1); i--; }
    }
  }

  /**
   * Where the toasts sit.
   *
   * They used to stack DOWN THE TOP-RIGHT CORNER — four opaque 360x52 panels
   * from y=20, for 3.4 seconds each, directly on top of the gacha's SKIP button
   * and every screen's currency pills, with no way to get rid of them. Bottom
   * centre is the one strip of every screen in this game that holds no controls,
   * and a click dismisses them anyway.
   */
  _toastRects(r) {
    const out = [];
    const n = this._toast.length;
    if (n === 0) return out;
    const w = Math.min(TOAST_W, r.w - 40);
    const x = Math.round((r.w - w) / 2);
    for (let i = 0; i < n; i++) {
      // Newest lowest; older ones are pushed up the stack.
      const y = r.h - TOAST_BOTTOM - TOAST_H - (n - 1 - i) * (TOAST_H + TOAST_GAP);
      out.push({ x, y, w, h: TOAST_H });
    }
    return out;
  }

  /** Index of the toast under the cursor, topmost (newest) first, or -1. */
  _toastAt(rects) {
    for (let i = rects.length - 1; i >= 0; i--) {
      const q = rects[i];
      if (ui.pointIn(q.x, q.y, q.w, q.h)) return i;
    }
    return -1;
  }

  _drawToasts(r, rects, over) {
    if (this._toast.length === 0) return;
    r.setScreenSpace();
    for (let i = 0; i < this._toast.length; i++) {
      const t = this._toast[i];
      const q = rects[i];
      if (!q) continue;
      const inT = clamp(t.t / 0.28, 0, 1);
      const outT = clamp((t.life - t.t) / 0.4, 0, 1);
      // Rises into place instead of flying in from the right.
      const y = q.y + (1 - easeOutCubic(inT)) * (q.h + 24);
      const a = Math.min(1, outT);
      const hot = over === i;
      ui.panel(q.x, y, q.w, q.h, {
        color: hot ? 'rgba(26,32,52,0.97)' : 'rgba(10,13,24,0.95)',
        borderColor: hot ? '#ffd76a' : t.color, alpha: a,
      });
      ui.text(t.icon, q.x + 26, y + 26, { size: 22, align: 'center', color: t.color, alpha: a });
      ui.text(t.text, q.x + 50, y + 26, {
        size: 14, color: '#e8ecf5', weight: 700, alpha: a * (hot ? 1 : 0.98),
      });
      ui.text(hot ? '✕' : '·', q.x + q.w - 14, y + 26, {
        size: hot ? 14 : 12, align: 'center', weight: 800,
        color: hot ? '#ffd76a' : '#8994b3', alpha: a,
      });
    }
  }
}

const EMPTY = {};
export const sceneManager = new SceneManager();
