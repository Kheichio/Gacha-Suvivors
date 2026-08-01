// WebAudio. Every SFX is synthesized — zero asset files, zero network requests,
// and it is the one asset category that can be authored entirely in code.
//
// Music is one optional file slot per stage that no-ops if missing. NEVER let a
// missing asset throw: every load is try/catch with a silent fallback.

import { IS_BROWSER } from './config.js';
import { save } from './save.js';
import { fxRng } from './rng.js';

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.ready = false;
    this.muted = false;
    this.music = null;
    this.musicSrc = null;
    /** Rate limiter: identical sounds inside this window collapse into one. */
    this._lastAt = Object.create(null);
    this._voices = 0;
    this.MAX_VOICES = 24;
    this._noiseBuf = null;
  }

  /** Must be called from a user gesture; browsers refuse to start otherwise. */
  init() {
    if (this.ready || !IS_BROWSER) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain.connect(this.master);
      this.musicGain.connect(this.master);
      this.master.connect(this.ctx.destination);
      this._buildNoise();
      this.applySettings();
      this.ready = true;
    } catch (e) {
      console.warn('[audio] unavailable; running silent', e);
      this.ready = false;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  applySettings() {
    if (!this.ready) return;
    const s = save.data.settings;
    this.master.gain.value = this.muted ? 0 : (s.masterVolume ?? 0.8);
    this.sfxGain.gain.value = s.sfxVolume ?? 0.9;
    this.musicGain.gain.value = s.musicVolume ?? 0.5;
  }

  _buildNoise() {
    const len = this.ctx.sampleRate * 0.5;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
  }

  _canPlay(key, minGap) {
    const now = this.ctx.currentTime;
    const last = this._lastAt[key] || -1;
    if (now - last < minGap) return false;
    if (this._voices >= this.MAX_VOICES) return false;
    this._lastAt[key] = now;
    return true;
  }

  _voice(node, dur) {
    this._voices++;
    node.onended = () => { this._voices--; };
    try { node.stop(this.ctx.currentTime + dur); } catch (e) { /* already stopped */ }
  }

  /**
   * The single tone primitive. Everything in SFX is one or two of these.
   * @param {object} o {type, freq, freqTo, dur, gain, detune, delay, curve}
   */
  tone(o) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime + (o.delay || 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.freqTo && o.freqTo !== o.freq) {
      if (o.curve === 'exp' && o.freqTo > 0 && o.freq > 0) osc.frequency.exponentialRampToValueAtTime(o.freqTo, t0 + o.dur);
      else osc.frequency.linearRampToValueAtTime(o.freqTo, t0 + o.dur);
    }
    if (o.detune) osc.detune.value = o.detune;
    const peak = (o.gain === undefined ? 0.25 : o.gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.min(0.012, o.dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g); g.connect(o.bus || this.sfxGain);
    osc.start(t0);
    this._voice(osc, o.dur + 0.05);
  }

  /** Filtered noise burst — explosions, impacts, whooshes. */
  noise(o) {
    if (!this.ready || !this._noiseBuf) return;
    const t0 = this.ctx.currentTime + (o.delay || 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = o.filter || 'lowpass';
    filt.frequency.setValueAtTime(o.freq || 1200, t0);
    if (o.freqTo) filt.frequency.exponentialRampToValueAtTime(Math.max(40, o.freqTo), t0 + o.dur);
    filt.Q.value = o.q || 1;
    const g = this.ctx.createGain();
    const peak = o.gain === undefined ? 0.3 : o.gain;
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(filt); filt.connect(g); g.connect(o.bus || this.sfxGain);
    src.start(t0);
    this._voice(src, o.dur + 0.05);
  }

  /** Rising/falling arpeggio — level-up, gacha reveal, achievement. */
  arp(notes, step, opts = {}) {
    if (!this.ready) return;
    for (let i = 0; i < notes.length; i++) {
      this.tone({
        type: opts.type || 'triangle', freq: notes[i], freqTo: notes[i],
        dur: opts.dur || 0.16, gain: (opts.gain || 0.22) * (1 - i * 0.06),
        delay: i * step,
      });
    }
  }

  /** Fire a named SFX. Unknown names are a silent no-op, never a throw. */
  play(name, variant) {
    if (!this.ready) return;
    const f = SFX[name];
    if (!f) return;
    try { f(this, variant); } catch (e) { /* a broken sound must never kill a run */ }
  }

  // --- music ---------------------------------------------------------------
  async playMusic(url, loop = true) {
    if (!this.ready || !url) return;
    this.stopMusic();
    try {
      const res = await fetch(url);
      if (!res.ok) return;                       // missing track: silence, no crash
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = loop;
      src.connect(this.musicGain);
      src.start();
      this.musicSrc = src;
    } catch (e) { /* missing or undecodable — the game is fully playable silent */ }
  }

  stopMusic() {
    if (this.musicSrc) { try { this.musicSrc.stop(); } catch (e) {} this.musicSrc = null; }
  }

  setMuted(m) { this.muted = m; this.applySettings(); }
}

// --- the SFX bank ------------------------------------------------------------
// Each entry is a tiny synth patch. Tuned to be readable in a horde: hits are
// short and bright, deaths are soft, and nothing above 5kHz sustains.
const SFX = {
  hit: (a) => {
    if (!a._canPlay('hit', 0.028)) return;
    a.tone({ type: 'square', freq: 420 + fxRng.raw() * 90, freqTo: 180, dur: 0.055, gain: 0.09 });
  },
  crit: (a) => {
    if (!a._canPlay('crit', 0.04)) return;
    a.tone({ type: 'sawtooth', freq: 900, freqTo: 320, dur: 0.09, gain: 0.15 });
    a.tone({ type: 'square', freq: 1800, freqTo: 700, dur: 0.06, gain: 0.07, delay: 0.01 });
  },
  enemyDie: (a) => {
    if (!a._canPlay('enemyDie', 0.03)) return;
    a.noise({ freq: 900, freqTo: 200, dur: 0.09, gain: 0.10, filter: 'lowpass' });
  },
  eliteDie: (a) => {
    a.noise({ freq: 2400, freqTo: 120, dur: 0.5, gain: 0.32, filter: 'lowpass' });
    a.tone({ type: 'sawtooth', freq: 160, freqTo: 40, dur: 0.5, gain: 0.2 });
  },
  bossDie: (a) => {
    a.noise({ freq: 3000, freqTo: 60, dur: 1.4, gain: 0.4 });
    a.arp([220, 277, 330, 440, 554, 660], 0.09, { type: 'triangle', dur: 0.5, gain: 0.2 });
  },
  playerHurt: (a) => {
    a.tone({ type: 'sawtooth', freq: 220, freqTo: 70, dur: 0.2, gain: 0.3 });
    a.noise({ freq: 700, freqTo: 120, dur: 0.16, gain: 0.16 });
  },
  levelUp: (a) => a.arp([523, 659, 784, 1047, 1319], 0.055, { type: 'triangle', dur: 0.32, gain: 0.26 }),
  pickup: (a) => {
    if (!a._canPlay('pickup', 0.022)) return;
    a.tone({ type: 'sine', freq: 880 + fxRng.raw() * 220, freqTo: 1400, dur: 0.05, gain: 0.05 });
  },
  gold: (a) => {
    if (!a._canPlay('gold', 0.03)) return;
    a.tone({ type: 'square', freq: 1200, freqTo: 1700, dur: 0.06, gain: 0.07 });
  },
  heal: (a) => a.arp([440, 587, 740], 0.05, { type: 'sine', dur: 0.3, gain: 0.2 }),
  special: (a) => {
    a.tone({ type: 'sawtooth', freq: 110, freqTo: 660, dur: 0.35, gain: 0.28, curve: 'exp' });
    a.noise({ freq: 400, freqTo: 3000, dur: 0.3, gain: 0.16, filter: 'bandpass', q: 3 });
  },
  escape: (a) => {
    a.noise({ freq: 3000, freqTo: 600, dur: 0.18, gain: 0.2, filter: 'bandpass', q: 2 });
    a.tone({ type: 'sine', freq: 700, freqTo: 1500, dur: 0.14, gain: 0.12 });
  },
  explode: (a) => {
    if (!a._canPlay('explode', 0.05)) return;
    a.noise({ freq: 1800, freqTo: 90, dur: 0.34, gain: 0.28 });
  },
  shoot: (a) => {
    if (!a._canPlay('shoot', 0.035)) return;
    a.tone({ type: 'square', freq: 640, freqTo: 900, dur: 0.04, gain: 0.05 });
  },
  slash: (a) => {
    if (!a._canPlay('slash', 0.045)) return;
    a.noise({ freq: 4200, freqTo: 1200, dur: 0.08, gain: 0.12, filter: 'bandpass', q: 4 });
  },
  telegraph: (a) => a.tone({ type: 'triangle', freq: 320, freqTo: 320, dur: 0.5, gain: 0.1 }),
  /**
   * A CLOCK TOWER, TOLLING THREE.
   *
   * A stage cue rather than a combat one, and it is built like a bell instead of
   * like a hit: three strikes a beat and a half apart, each one a low sine
   * fundamental with two INHARMONIC partials over it and a long tail. The
   * partials are what make it a bell — 2.76x and 5.4x are the classic minor-third
   * and nominal ratios of a cast bell, and they are deliberately not whole
   * multiples, because a stack of harmonics is an organ.
   *
   * Every strike also opens with a scrape of filtered noise at a twentieth of
   * the gain: that is the clapper, and without it the bell starts out of nowhere
   * and reads as a synth pad. Nothing here sustains above 5kHz, per the bank's
   * own rule — the fifth partial is 594Hz.
   */
  clockTower: (a) => {
    if (!a._canPlay('clockTower', 2.0)) return;
    for (let k = 0; k < 3; k++) {
      const d = k * 1.5;
      a.noise({ freq: 2600, freqTo: 900, dur: 0.05, gain: 0.05, filter: 'bandpass', q: 3, delay: d });
      a.tone({ type: 'sine', freq: 110, freqTo: 108, dur: 2.6, gain: 0.26, delay: d });
      a.tone({ type: 'sine', freq: 303, freqTo: 300, dur: 1.9, gain: 0.11, delay: d });
      a.tone({ type: 'sine', freq: 594, freqTo: 588, dur: 1.2, gain: 0.05, delay: d });
    }
  },
  bossIntro: (a) => {
    a.tone({ type: 'sawtooth', freq: 55, freqTo: 110, dur: 1.6, gain: 0.3 });
    a.arp([110, 138, 165, 220], 0.16, { type: 'sawtooth', dur: 0.8, gain: 0.16 });
  },
  uiMove: (a) => { if (a._canPlay('uiMove', 0.04)) a.tone({ type: 'square', freq: 640, dur: 0.03, gain: 0.05 }); },
  uiConfirm: (a) => a.arp([660, 990], 0.05, { type: 'square', dur: 0.1, gain: 0.12 }),
  uiBack: (a) => a.tone({ type: 'square', freq: 400, freqTo: 260, dur: 0.09, gain: 0.1 }),
  gachaCharge: (a) => a.tone({ type: 'sine', freq: 110, freqTo: 880, dur: 1.5, gain: 0.22, curve: 'exp' }),
  gacha3: (a) => a.arp([392, 494], 0.09, { type: 'triangle', dur: 0.3, gain: 0.18 }),
  gacha4: (a) => a.arp([392, 494, 587], 0.08, { type: 'triangle', dur: 0.35, gain: 0.22 }),
  gacha5: (a) => a.arp([523, 659, 784, 1047], 0.09, { type: 'triangle', dur: 0.5, gain: 0.28 }),
  gacha6: (a) => {
    a.arp([523, 659, 784, 1047, 1319, 1568], 0.1, { type: 'triangle', dur: 0.8, gain: 0.3 });
    a.noise({ freq: 6000, freqTo: 400, dur: 1.2, gain: 0.18, filter: 'bandpass', q: 1.4, delay: 0.1 });
  },
  achievement: (a) => a.arp([784, 988, 1175, 1568], 0.07, { type: 'triangle', dur: 0.4, gain: 0.24 }),
  heartbeat: (a) => {
    if (!a._canPlay('heartbeat', 0.6)) return;
    a.tone({ type: 'sine', freq: 70, freqTo: 45, dur: 0.14, gain: 0.3 });
    a.tone({ type: 'sine', freq: 60, freqTo: 40, dur: 0.12, gain: 0.2, delay: 0.19 });
  },
  killStreak: (a) => a.arp([880, 1108, 1318], 0.04, { type: 'square', dur: 0.14, gain: 0.14 }),
  chest: (a) => a.arp([523, 587, 659, 784, 880], 0.06, { type: 'triangle', dur: 0.3, gain: 0.24 }),
  relic: (a) => {
    a.arp([440, 554, 659, 880], 0.1, { type: 'sine', dur: 0.6, gain: 0.26 });
    a.noise({ freq: 5000, freqTo: 800, dur: 0.7, gain: 0.1, filter: 'bandpass', q: 2 });
  },
  evolve: (a) => {
    a.tone({ type: 'sawtooth', freq: 220, freqTo: 1760, dur: 1.0, gain: 0.3, curve: 'exp' });
    a.arp([440, 554, 659, 880, 1108], 0.08, { type: 'triangle', dur: 0.6, gain: 0.24 });
  },
  stageManager: (a) => {
    a.tone({ type: 'sawtooth', freq: 40, freqTo: 30, dur: 2.2, gain: 0.34 });
    a.noise({ freq: 200, freqTo: 60, dur: 2.0, gain: 0.2 });
  },
};

export const audio = new AudioEngine();
export const SFX_NAMES = Object.keys(SFX);
