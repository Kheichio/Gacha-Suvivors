// Scene manager.
//
// A scene is a plain object: { enter(params), exit(), update(dt), render(r, alpha),
// resize(w, h)?, clearColor()? }. Transitions are a simple cross-fade so no
// screen has to implement one.
//
// Everything meta-facing (hub, roster, gacha, shrine, codex, settings, results)
// is a scene; the run itself is a scene that owns a Run.

import { events } from '../core/events.js';
import { audio } from '../core/audio.js';
import { save, addCurrency } from '../core/save.js';
import { ui } from '../ui/widgets.js';
import { clamp, easeOutCubic } from '../core/math.js';
import { createGacha } from '../game/gachaEngine.js';
import { createAchievements } from '../game/achievements.js';

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

const FADE_TIME = 0.22;

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
    this._pending = null;
    this._toast = [];
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

    // First-run grant: the two ★3 starters, so the game is playable immediately.
    let owns = false;
    for (const k in save.data.roster) if (save.data.roster[k].owned) { owns = true; break; }
    if (!owns) {
      for (const id of data.characters.CHARACTERS_BY_RARITY[3]) {
        const e = save.data.roster[id] || (save.data.roster[id] = { owned: false, starLevel: 1, letters: 0, bond: 0, runs: 0, kills: 0 });
        e.owned = true;
      }
      save.data.currencies.starFragments += 300;   // enough for two 10-pulls
      save.save();
    }
    this.shared.characterId = this.shared.characterId ||
      data.characters.CHARACTERS_BY_RARITY[3][0];
    this.shared.stageId = data.stages.STAGES[0].id;

    this.achievements.bind();

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

  /** Switch scenes with a cross-fade. Safe to call from inside a scene's update. */
  go(id, params) {
    const scene = this.scenes[id];
    if (!scene) { console.warn('[scenes] unknown scene "' + id + '"'); return; }
    this._pending = { id, scene, params: params || EMPTY };
    this._fade = FADE_TIME;
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
      // a second completes. Nothing is worth stranding the player over.
      if (this._fade <= 0 || this._pendingAge > 1.0) {
        const p = this._pending;
        this._pending = null;
        this._pendingAge = 0;
        this._fade = FADE_TIME;
        this._swap(p.id, p.scene, p.params);
      }
    } else if (this._fade > 0) {
      this._fade -= dtReal;
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
    if (this.current && this.current.render) {
      try { this.current.render(r, alpha); }
      catch (e) { this._sceneError('render', e); }
    }
    this._drawToasts(r);

    // cross-fade
    if (this._fade > 0) {
      const t = this._pending
        ? 1 - this._fade / FADE_TIME          // fading OUT
        : this._fade / FADE_TIME;             // fading IN
      r.overlay('#05060d', clamp(t, 0, 1));
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

  _drawToasts(r) {
    if (this._toast.length === 0) return;
    r.setScreenSpace();
    const w = 360;
    let y = 20;
    for (const t of this._toast) {
      const inT = clamp(t.t / 0.28, 0, 1);
      const outT = clamp((t.life - t.t) / 0.4, 0, 1);
      const x = r.w - w - 20 + (1 - easeOutCubic(inT)) * (w + 30);
      const a = Math.min(1, outT);
      ui.panel(x, y, w, 52, { color: 'rgba(10,13,24,0.95)', borderColor: t.color, alpha: a });
      ui.text(t.icon, x + 26, y + 26, { size: 22, align: 'center', color: t.color, alpha: a });
      ui.text(t.text, x + 50, y + 26, { size: 14, color: '#e8ecf5', weight: 700, alpha: a });
      y += 60;
    }
  }
}

const EMPTY = {};
export const sceneManager = new SceneManager();
