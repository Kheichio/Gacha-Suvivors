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
// The centre is clear DURING NORMAL PLAY, which is not the same as always. Two
// things claim it, both of them transient and both of them decisions rather
// than status: the kill-streak callout, and the ability duration bars — the one
// read on the HUD that has to be found without looking away from your own
// character. See _centerDurations.
//
// ON TOUCH the bottom half of that layout rearranges itself, because a HUD you
// cannot see past your own thumbs is not a HUD. The stick owns the bottom-left
// quadrant, so the ability radials move to the two buttons that cast them in
// the bottom-right; the relic row lifts above those; a PAUSE button takes the
// top-right corner and the level/kills column drops below it. All of it is
// _layoutTouch, and it is also the map the input layer resolves touches
// against — screen geometry is the HUD's business, not input's.
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
import { RUN_STATE, FINALE_COUNTDOWN } from '../game/run.js';
import { abilities } from '../game/abilities/index.js';

class Hud {
  constructor() {
    this.hpGhost = 1;
    this.bossBarT = 0;
    this.introT = 0;
    this._relicSprites = Object.create(null);
    this.killStreakT = 0;
    /**
     * buffId -> the longest remaining time this HUD has ever seen on it.
     * The fallback denominator for a buff record that predates `b.dur`; see
     * _buffTotal(). One property write the first time a buff id appears and
     * nothing afterwards, so it never allocates inside a frame.
     */
    this._buffPeak = Object.create(null);
    /** Top edge of the build strip, published by _buildStrip for the duration bars. */
    this._stripTop = 0;
    /**
     * Top edge of the active-ability stack, published by _centerDurations for
     * the QTE plate. 0 when nothing is running.
     *
     * The two used to be placed against the same screen fraction from opposite
     * directions — the bars at 0.55H, the mash plate at 0.62H — and a 74px
     * plate 45px under a 46px bar overlaps on any viewport under ~940px tall.
     * It was there before the bars moved and it is nobody's idea of a bug
     * report, but the mash prompt is a thing you have half a second to obey and
     * it may not be drawn through.
     */
    this._durationsTop = 0;
  }

  reset() {
    this.hpGhost = 1; this.bossBarT = 0; this.introT = 0; this._portraitSprite = null;
    this._stripTop = 0;
    this._durationsTop = 0;
    // Durations do not carry between runs: a 30s stage buff whose peak was
    // learned last run must not be the denominator for a 6s one this run.
    this._buffPeak = Object.create(null);
  }

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
    // NOT atlas.ensure(). ensure() keys on visualKey(), which for a portrait
    // comes out as shape|colour|size and nothing else — so two characters whose
    // `visual.color` happens to match hash to the SAME key, the second bust
    // baked is thrown away, and one of them wears the other's face in the HUD
    // for the whole run. Two of the twenty-four collide today. registerPixel()
    // keys on the descriptor's own id, which is the entire reason portraitFor()
    // gives the bust an id distinct from the character's, and it still returns
    // the sprite the boot pre-raster already built rather than baking a new one.
    this._portraitSprite = !p.def.portrait ? p.sprite
      : p.def.portrait.pixel
        ? atlas.registerPixel(p.def.portrait.pixel, p.def.portrait.size || 14)
        : atlas.ensure(p.def.portrait);
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

    // THE TOUCH CONTROL MAP IS PART OF THE HUD, and only of a HUD that is
    // actually being played through. It is resolved first because three other
    // blocks have to get out of its way, and _layoutTouch hands it to the input
    // layer — which owns no screen geometry of its own — in the same breath.
    // PAUSED and LEVEL_UP deliberately publish NOTHING: those states draw menus
    // over the HUD, and a stick zone still live underneath a menu is exactly the
    // bug this whole pass exists to remove.
    const touching = IS_TOUCH && run.state === RUN_STATE.PLAYING;
    TOUCH_L.live = touching;
    if (touching) this._layoutTouch(W, H);

    this._lowHpVignette(r, run);
    this._topLeft(r, run, s);
    this._topCenter(r, run, W, s);
    this._topRight(r, run, W, s);
    this._buildStrip(r, run, W, H, s);
    this._bottomCenter(r, run, W, H, s);
    // On touch the two ability radials move to the thumb that presses them; the
    // bottom-left corner is where the movement stick lives, and a cooldown read
    // underneath a thumb is a cooldown read nobody has ever seen.
    if (!IS_TOUCH) this._bottomLeft(r, run, H, s);
    this._bottomRight(r, run, W, H, s);
    // After the build strip, which is what it has to stay clear of.
    this._centerDurations(r, run, W, H, s);
    if (this.bossBarT > 0.01) this._bossBar(r, run, W, s);
    if (run.qte) this._qte(r, run, W, H);
    this._killStreak(r, run, W, H);
    if (run.stageManager && run.stageManager.active) this._stageManager(r, run, W, H);
    if (run.finaleCountdown >= 0) this._finaleCountdown(r, run, W, H, s);
    if (touching) this._touchControls(r, run, W, H, s);
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
    // The pause button owns the top-right corner on touch, so this column
    // starts below it. Overlapping them would be worse than either placement:
    // a semi-transparent "LV 14" printed across the only way out of a run.
    const y0 = TOUCH_L.live ? TOUCH_L.topClear : 0;
    ui.text('LV ' + run.player.level, x, y0 + 26 * s, {
      size: 22 * s, color: PALETTE.accent, align: 'right', weight: 800, mono: true, outline: true,
    });
    ui.text('☠ ' + formatNumber(run.stats.kills), x, y0 + 48 * s, {
      size: 14 * s, color: PALETTE.textDim, align: 'right', weight: 700, mono: true,
    });
    ui.text('⭐ ' + formatNumber(run.stats.gold), x, y0 + 66 * s, {
      size: 14 * s, color: PALETTE.gold, align: 'right', weight: 700, mono: true,
    });

    // Generic metric hook — Kira's kills/sec, declared in his data.
    if (run.player.def.metric === 'killsPerSecond') {
      const kps = run.time > 0 ? run.stats.kills / run.time : 0;
      ui.text(kps.toFixed(2) + ' k/s', x, y0 + 84 * s, {
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

  // --- WHAT IS RUNNING RIGHT NOW ---------------------------------------------
  //
  // A radial answers "when can I use it again". It cannot answer "how long until
  // the thing I am currently standing inside stops", and for most of the roster
  // that second question is the one that decides whether you walk into the pack
  // or away from it. On a cooldown sweep an eight-second damage window and its
  // last half-second look identical — because to a cooldown sweep they ARE
  // identical, both are simply "not ready yet".
  //
  // This used to be a pair of 148x26 chips stacked above the bottom-left
  // radials, and verbatim from a player: it was too small and in the wrong
  // place. Both are true, and they are the same complaint. A countdown you have
  // to look AWAY from the fight to read is a countdown you do not read, so it
  // does not matter how correct it is — and at 148px wide it had room for a
  // ten-point name and a five-pixel track, which is a footnote, not an alarm.
  //
  // So it is centre-screen and large. The HUD's founding rule is that the middle
  // 70% stays clear, and this does not break it: nothing here is drawn unless an
  // ability is actually running, which is a few seconds at a time and never
  // during the normal business of walking and shooting.
  //
  // WHERE IT SITS IS NOT A FRACTION OF THE SCREEN. It used to start at 55% of
  // the height and move only when the arsenal was about to be underneath it —
  // a clamp that can pull the stack UP and never push it DOWN. So on any window
  // with room, which is 720p and everything above it, the bars floated in open
  // space with a growing band of nothing between them and the weapons plate:
  // 51px at 1280x720, 213px at 1920x1080, 375px at 2560x1440. Floating is the
  // whole problem. A panel that belongs to no edge and touches nothing reads as
  // debris dropped into the arena, and the eye has to FIND it every time
  // instead of knowing where it is.
  //
  // So it HANGS OFF THE ARSENAL: the bottom of the stack one gap above the
  // build strip, extra bars growing upward from there. One bar or two, the
  // thing you look at is in the same place, directly over the weapons. That is
  // also FURTHER from your own character than the old 55% was — the player is
  // ON the midline, and a bar centred there is drawn across your own sprite at
  // the exact moment you are trying to read it.
  _centerDurations(r, run, W, H, s) {
    const n = this._durationCount(run);
    if (n === 0) { this._durationsTop = 0; return; }
    // Sized by the UI scale AND capped against the viewport. 46px at uiScale
    // 1.4 is 64px, which on a phone held sideways is a sixth of the screen for
    // ONE of two bars — "bigger" was the request, but bigger than the window it
    // is in helps nobody.
    const h = Math.round(clamp(Math.min(46 * s, H * 0.085), 30, 56));
    const gap = Math.round(8 * s);
    // THE BOTTOM OF THE STACK, one gap above the top of the build strip —
    // `_stripTop`, published by _buildStrip, which is why this is drawn after
    // it. 10*s is not an arbitrary gap: it is exactly the clearance the strip
    // itself keeps above the XP bar, so the active bar, the arsenal and the XP
    // bar stack on one rhythm up the bottom edge.
    const floor = (this._stripTop || H) - Math.round(10 * s);
    const need = n * h + (n - 1) * gap;
    // The one thing that outranks the arsenal is the player's own character, at
    // the centre of the screen, so the stack stops climbing at 30% of the
    // height instead of walking up over it. On a genuinely over-subscribed HUD
    // — a 390px-tall window at uiScale 1.4, where the arsenal alone claims half
    // the height — that means there is no clearance to find and the two do
    // overlap. That is the right way round: this is drawn last, it is opaque,
    // it is on screen for a few seconds at a time, and the arsenal is reference
    // you can read whenever you like whereas "0.4s of invulnerability left" is
    // a decision you are making now.
    let top = Math.max(Math.round(H * 0.30), floor - need);
    this._durationsTop = top;

    top = this._durationBar(r, run, 'special', '✦', '#ff5fa2', W, top, h, gap, s);
    this._durationBar(r, run, 'escape', '➤', '#6ad8ff', W, top, h, gap, s);
  }

  /**
   * How many bars _centerDurations is about to draw, so the stack can be placed
   * before any of it is. Two probes rather than one because `activeState`
   * answers into a shared record — see abilities/index.js — and the answer about
   * SPECIAL is gone the moment ESCAPE is asked about.
   */
  _durationCount(run) {
    let n = 0;
    for (let i = 0; i < 2; i++) {
      const st = abilities.activeState(run, i === 0 ? 'special' : 'escape');
      if (st.active && !(st.timed && st.total < BAR_MIN_TIME)) n++;
    }
    return n;
  }

  /**
   * ONE RUNNING ABILITY, AS A BAR. Returns the top edge for the next one —
   * unchanged when nothing was drawn, so a lone active ability sits where the
   * stack starts instead of leaving a hole where the other one would have been.
   */
  _durationBar(r, run, key, icon, color, W, top, h, gap, s) {
    const st = abilities.activeState(run, key);
    if (!st.active) return top;
    // Sub-second effects are over before the eye has found the bar: the 0.45s of
    // a cast animation, the 0.05s an ability spends handing control back. A bar
    // that blinks on and off on every single press teaches the player to stop
    // looking at the one place they should be watching, so those do not get one.
    // BAR_MIN_TIME sits under the shortest window that is a STATE you play
    // inside — a 0.7s i-frame dash, a 1.2s phase-out — and over the longest one
    // that is only an animation.
    if (st.timed && st.total < BAR_MIN_TIME) return top;

    const def = run.player.def[key];
    const w = Math.round(Math.min(W * 0.56, 620 * s));
    const x = Math.round((W - w) / 2);
    const warn = st.timed && st.frac <= BAR_WARN_FRAC;
    // THE WARNING RIDES ON THREE CHANNELS, NOT ONE. The rule this file follows
    // is that no critical information may be carried by colour alone, and "your
    // invulnerability ends in half a second" is about as critical as this HUD
    // gets. So: the fill turns amber, the frame pulses, and a glyph appears in
    // front of the number. Any one of the three read on its own is enough.
    const beat = warn ? 0.5 + 0.5 * Math.sin(run.time * 9) : 0;
    const tint = warn ? '#ffd94a' : color;

    BAR_PANEL.borderColor = warn ? '#ffd94a' : PALETTE.border;
    BAR_PANEL.borderWidth = warn ? 2.5 + beat * 1.5 : 2;
    ui.panel(x, top, w, h, BAR_PANEL);
    // A stripe of the ability's own colour down the leading edge, so which of
    // the two buttons this belongs to is answered before anything is read.
    r.drawRect(x + 2, top + 2, Math.max(3, 4 * s), h - 4, tint, warn ? 0.6 + beat * 0.4 : 0.9);

    // TYPE SCALES WITH THE BAR, not with the UI setting alone. The bar itself
    // is capped against the viewport height above, and 22px of countdown inside
    // a 33px plate is type that does not fit its own panel — which is how a
    // "bigger" bar becomes an unreadable one on the exact device the enlargement
    // was for. On any window with room, `ts` is simply `s`.
    const ts = Math.min(s, h / 46);
    const ty = top + Math.round(h * 0.30);
    BAR_ICON.size = 17 * ts;
    BAR_ICON.color = tint;
    ui.text(icon, x + 20 * s, ty, BAR_ICON);
    BAR_NAME.size = 15 * ts;
    // The time field is a reserved width rather than a measured one: measuring
    // costs a text metric every frame for a string that is never wider than
    // "⚠ 12.3s", and the name is ellipsized into whatever is left.
    ui.text(ellipsize(r, displayName(def).split(' [')[0], w - 150 * s, 15 * ts, 800),
            x + 34 * s, ty, BAR_NAME);
    BAR_TIME.size = 22 * ts;
    BAR_TIME.color = warn ? '#ffd94a' : '#ffffff';
    ui.text(st.timed ? (warn ? '⚠ ' : '') + st.remaining.toFixed(1) + 's' : 'ACTIVE',
            x + w - 14 * s, ty, BAR_TIME);

    const bx = x + 14 * s, bw = w - 28 * s;
    const bh = Math.max(8, Math.round(h * 0.26));
    const by = top + h - bh - Math.round(h * 0.15);
    r.drawRect(bx - 2, by - 2, bw + 4, bh + 4, '#05070e', 1);
    r.drawRect(bx, by, bw, bh, 'rgba(4,6,14,0.85)', 1);

    if (st.timed) {
      const fw = Math.max(3, bw * st.frac);
      r.drawRect(bx, by, fw, bh, tint, 1);
      r.drawRect(bx, by, fw, Math.max(1, bh * 0.32), 'rgba(255,255,255,0.30)', 1);
      r.drawRect(bx, by + bh - Math.max(1, bh * 0.26), fw, Math.max(1, bh * 0.26), 'rgba(0,0,0,0.28)', 1);
      // The last quarter of the TRACK is notched, always — so "about to run out"
      // is a place on the bar you can watch the fill travel toward, instead of a
      // colour that changes at the same instant as the problem it warns about.
      const hx = bx + bw * (1 - BAR_WARN_FRAC), hs = bw * BAR_WARN_FRAC / 4;
      for (let i = 0; i < 4; i++) {
        r.drawRect(hx + i * hs, by, Math.max(1, 2 * s), bh, 'rgba(255,255,255,0.30)', 1);
      }
      if (warn) r.drawRect(bx, by, fw, bh, '#ffffff', beat * 0.45);
    } else {
      // No clock exists, so no clock is drawn. A block sliding back and forth
      // says "running, with no announced end", which is the truth; a full bar
      // would be a countdown that never counts, and a player who watched one sit
      // still for ninety seconds would rightly call the HUD broken.
      const mw = bw * 0.26;
      const mx = bx + (bw - mw) * (0.5 + 0.5 * Math.sin(run.time * 1.6));
      r.drawRect(mx, by, mw, bh, color, 0.9);
    }

    return top + h + gap;
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
    // Published for the duration bars, which are centre-screen and have to know
    // where the tallest thing on the HUD starts. Computed here rather than
    // recomputed there: every term above feeds it, and two copies of this
    // arithmetic would disagree the first time either changed.
    this._stripTop = by;

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
      // GREEN MEANS "TAKE THE EVOLVE CARD", so it may only mean that. A maxed
      // weapon whose evolution fee is unpaid gets the amber the full-bucket
      // counters use: it is not progressing and it is not ready either.
      const ready = maxed && ws.evoReady(w);
      const frac = evolved ? 1 : w.level / maxL;
      const col = evolved ? '#ffd76a' : ready ? '#7bf59a' : maxed ? '#ffd23f' : '#6ad8ff';
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
    // The two ability buttons own the bottom-right corner on touch, so the relic
    // row and its buff timers start above them instead of underneath a thumb.
    const y = (TOUCH_L.live ? Math.min(TOUCH_L.rightClear, H - 42 * s) : H - 42 * s) - size;

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

    // ACTIVE BUFF TIMERS.
    //
    // These divided every buff's remaining time by a hardcoded 60 seconds.
    // Almost nothing in the game grants a sixty-second buff, so a four-second
    // one drew as a 7%-full sliver that crept to 6% and then vanished — a bar
    // whose only honest reading was "something is on", which is exactly what the
    // label beside it already said. A bar is a ratio and a ratio needs the
    // number it started from, so the buff record carries it (`dur`, stamped in
    // addBuff) and this reads it.
    let by = y - 24 * s;
    for (const b of p.buffs) {
      if (b.t > 9000) continue;         // permanent buffs are not timers
      const w = 90 * s;
      const total = this._buffTotal(b);
      ui.bar(W - 18 - w, by, w, 8 * s, total > 0 ? clamp(b.t / total, 0, 1) : 0,
             '#ffd76a', { bg: 'rgba(4,6,14,0.7)' });
      // One decimal under ten seconds: rounding to whole seconds printed "0s"
      // for the entire last second of every buff in the game.
      ui.text(b.id + ' ' + (b.t >= 10 ? b.t.toFixed(0) : b.t.toFixed(1)) + 's',
              W - 18 - w - 6, by + 4 * s,
              { size: 10 * s, color: PALETTE.textDim, align: 'right', mono: true });
      by -= 13 * s;
    }

    // evolution badges
    if (p.evolutions.length) {
      ui.text('EVOLVED: ' + p.evolutions.length, W - 18, H - 60 * s,
              { size: 11 * s, color: PALETTE.accent, align: 'right', weight: 800 });
    }
  }

  /**
   * The denominator for a buff's timer bar.
   *
   * `b.dur` is the duration the buff was granted with, recorded by addBuff().
   * A buff record from anywhere that has not been taught to carry it still has
   * to draw something honest, so the fallback is the longest remaining time this
   * HUD has ever seen on that id — and because the HUD draws every frame while a
   * buff is at its fullest on the first frame it exists, that is the granted
   * duration to within one frame. It degrades to a bar that starts full and
   * empties correctly; it never degrades to a bar that lies about its scale.
   *
   * A refreshed buff extends rather than stacks, and both numbers rise together,
   * so a refresh refills the bar instead of overflowing past the end of it.
   */
  _buffTotal(b) {
    if (b.dur > 0) return b.dur > b.t ? b.dur : b.t;
    const seen = this._buffPeak[b.id];
    if (!(seen >= b.t)) { this._buffPeak[b.id] = b.t; return b.t; }
    return seen;
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
    // 0.62H is where it wants to be; the one thing that can be there already is
    // the active-ability stack, so it sits above that instead when both are up.
    // 84 = the plate's own 74px plus the 10px gap the bottom-edge stack uses,
    // so the two read as one column rather than as two things that nearly hit.
    const y = Math.min(H * 0.62, (this._durationsTop || H) - 84);
    ui.panel(W / 2 - 180, y, 360, 74, { color: 'rgba(10,4,10,0.94)', borderColor: '#ff3a5e', borderWidth: 3 });
    ui.text('MASH!', W / 2, y + 24, { size: 26, color: '#ff3a5e', align: 'center', weight: 800 });
    ui.bar(W / 2 - 156, y + 42, 312, 16, f, '#ffd94a', { bg: 'rgba(0,0,0,0.6)' });
    // DECISIONS.md §17 — any input works, and the prompt says so.
    ui.text('any button · any key · tap', W / 2, y + 66,
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

  /**
   * THE FINALE COUNTDOWN â€” the loudest thing this HUD draws that is not a boss.
   *
   * WHY IT IS NOT IN THE CENTRE. It is on screen for a full minute, which is an
   * order of magnitude longer than the kill-streak callout or the QTE prompt, and
   * the founding rule of this file is that the middle 70% stays clear. Those two
   * break it because they are on screen for a second or two. This one is not, so
   * it hangs off the TOP-CENTRE COLUMN instead, one plate under the run timer â€”
   * which is exactly where the player already looks to answer "how long left".
   * Answering that question one line lower with a shorter, redder clock is the
   * whole idea: the run timer stops being the one that matters the moment this
   * appears.
   *
   * IT STEPS OUT FROM UNDER THE BOSS BAR. A mid-boss can perfectly well be alive
   * while this is counting â€” that is the exact case callBossEarly refuses and
   * retries â€” and the drop-down boss plate occupies 52..132 * s. Same reasoning
   * and the same spelling as _qte's clamp against the duration stack.
   *
   * ZERO IS A REAL STATE, NOT A ROUNDING ERROR. The clock floors at zero and the
   * boss can still be a few seconds out, because the handover is retried rather
   * than forced (see Run._tickFinale). A number that sat on 00:00 would read as
   * frozen, so the word INCOMING takes over and the drain bar is dropped.
   */
  _finaleCountdown(r, run, W, H, s) {
    const t = run.finaleCountdown;
    if (t < 0) return;
    const handover = t <= 0;

    // A heartbeat that gets faster is read as urgency without anyone having to
    // look at the number: 0.8Hz above ten seconds, 1.6Hz under it.
    const hz = t <= 10 ? 1.6 : 0.8;
    const beat = 0.5 + 0.5 * Math.sin(run.time * hz * TAU);
    const col = t <= 10 ? '#ff3a5e' : '#ffd23f';

    const w = clamp(440 * s, 240, W - 40);
    const h = 84 * s;
    const x = (W - w) / 2;
    // Under the run timer normally; under the boss plate when one is up.
    const y = (this.bossBarT > 0.01 ? 150 : 78) * s;

    ui.panel(x, y, w, h, {
      color: 'rgba(12,6,14,0.94)', borderColor: col, borderWidth: 3, radius: 8,
      alpha: 0.85 + beat * 0.15,
    });
    ui.text('âš   FINAL BOSS INBOUND', W / 2, y + 20 * s, {
      size: 15, color: col, align: 'center', weight: 800, mono: true, outline: true,
    });
    ui.text(handover ? 'INCOMING' : formatTime(Math.ceil(t)), W / 2, y + 50 * s, {
      size: 28, color: '#ffffff', align: 'center', weight: 800, mono: true,
      outline: true, alpha: 0.75 + beat * 0.25,
    });
    if (!handover) {
      ui.bar(x + 16 * s, y + h - 16 * s, w - 32 * s, 8 * s,
             t / FINALE_COUNTDOWN, col, { bg: 'rgba(4,6,14,0.9)', segments: 6 });
    }
    // The reason, in plain words, outside the plate. A warning that does not say
    // why it appeared reads as the game breaking rather than as the game paying.
    ui.text('nothing left to claim â€” bank the coins', W / 2, y + h + 14 * s, {
      size: 12, color: PALETTE.textDim, align: 'center', weight: 700, outline: true,
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
      // `run.revivesLeftNow()`, not a stat minus a key count. `p.stats.revives`
      // sees only the Shrine's Revival row and Second Chance and misses Undying,
      // Rei's S3 and Phoenix Heart entirely; and `Object.keys(revivesUsed).length`
      // counts SOURCES TOUCHED rather than charges spent, so a source granting two
      // revives read as one. This is now the same number the revive pips draw.
      ['Revives left', String(run.revivesLeftNow())],
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
      // The sheet is the reference surface — it is where a player checks WHY the
      // evolve card has not come, and 'Lv 8/8' on its own does not answer that.
      const wMaxed = run.weapons.isMaxed(wep);
      const wReady = wMaxed && run.weapons.evoReady(wep);
      const tail = wep.evolved ? 'EVOLVED'
                 : wMaxed ? 'MAX  ·  ' + run.weapons.evoNeed(wep)
                 : 'Lv ' + wep.level + '/' + maxL;
      ui.statRow(`${run.weapons.iconOf(wep)}  ${run.weapons.nameOf(wep).split(' [')[0]}`,
                 tail, x + 20, yy, w - 40,
                 { color: wep.evolved ? '#ffd76a' : wReady ? '#7bf59a'
                        : wMaxed ? '#ffd23f' : PALETTE.text });
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
  /**
   * THE TOUCH CONTROL MAP. Geometry only; nothing is drawn here.
   *
   * Everything is sized off the SHORT edge. A phone held sideways is 844x390,
   * and a control sized off the long edge is a control at the far end of a reach
   * your thumb does not have — the previous layout used `min(W, H) * 0.13` for
   * the buttons and then placed them at multiples of that radius, which on a
   * short screen stacked two 50px circles into the same 60px of corner.
   *
   * The three positions answer three different questions:
   *   · the stick is a REGION, not a disc — the base appears wherever the left
   *     thumb lands, so there is nothing to find and nothing to miss;
   *   · the two ability buttons are two clearly separated discs in the opposite
   *     corner, far enough apart (2.3 radii between centres) that a thumb
   *     cannot press both;
   *   · PAUSE is a small disc in the top-right, because without it a phone
   *     player cannot leave a run at all — there is no ESC key to press.
   */
  _layoutTouch(W, H) {
    const L = TOUCH_L;
    const short = Math.min(W, H);
    const m = Math.round(clamp(short * 0.045, 12, 28));
    const rad = Math.round(clamp(short * 0.105, 46, 76));

    L.rad = rad; L.margin = m;
    L.specialR = rad; L.escapeR = rad;
    L.specialX = W - m - rad;
    L.specialY = H - m - rad;
    L.escapeX = W - m - rad * 3.0;
    L.escapeY = H - m - rad * 2.2;

    L.pauseR = Math.round(clamp(rad * 0.42, 22, 32));
    L.pauseX = W - m - L.pauseR;
    L.pauseY = m + L.pauseR;

    // The stick owns the bottom-left quadrant outright. It is a big rectangle
    // rather than a disc on purpose: the thumb that grabs it is not looking at
    // the screen, and "put your thumb somewhere down there" is a target nobody
    // can miss. The two buttons are tested first in input._touchZone, so the
    // rectangle is free to be generous without swallowing them.
    L.zoneX = 0;
    L.zoneW = Math.round(W * 0.5);
    L.zoneY = Math.round(H * 0.34);
    L.zoneH = H - L.zoneY;
    L.stickR = Math.round(clamp(short * 0.17, 60, 108));

    // What the rest of the HUD has to stay out of. The right-hand clearance is
    // measured from the top of the ESCAPE disc MINUS its name label, which is
    // drawn above the disc — clearing the circle alone puts the relic row on top
    // of the one word telling the player what that button does.
    const lbl = Math.round(20 * (save.data.settings.uiScale || 1));
    L.topClear = L.pauseY + L.pauseR + 10;
    L.rightClear = L.escapeY - L.escapeR - lbl;

    // Published HERE rather than after the controls are drawn, so there is no
    // way to compute a layout and forget to hand it over — the map the input
    // layer resolves touches against is always the one this frame drew.
    input.setTouchControls(L);
  }

  _touchControls(r, run, W, H, s) {
    const L = TOUCH_L;
    const t = input.touch;

    // --- the stick -----------------------------------------------------------
    if (t.active) {
      // Drawn where the finger actually IS, at the radius the input layer
      // actually uses. Those were three separate numbers before — a ring of 62,
      // a knob of 26 and a deflection of 90 — so the knob left its own ring
      // before the stick reached full speed, in a coordinate space that was
      // wrong by the device pixel ratio on top of that.
      r.drawCircle(t.stickBaseX, t.stickBaseY, L.stickR, '#ffffff', 0.05);
      r.strokeCircle(t.stickBaseX, t.stickBaseY, L.stickR, 'rgba(255,255,255,0.22)', 3, 1);
      let dx = t.stickX - t.stickBaseX, dy = t.stickY - t.stickBaseY;
      const d = Math.hypot(dx, dy);
      if (d > L.stickR) { dx = dx * L.stickR / d; dy = dy * L.stickR / d; }
      const kx = t.stickBaseX + dx, ky = t.stickBaseY + dy;
      r.drawLine(t.stickBaseX, t.stickBaseY, kx, ky, '#ffffff', 3, 0.18);
      r.drawCircle(kx, ky, L.stickR * 0.40, 'rgba(255,255,255,0.34)', 1);
      r.strokeCircle(kx, ky, L.stickR * 0.40, '#ffffff', 2.5, 0.8);
    } else {
      const hx = L.zoneX + L.stickR + L.margin * 2;
      const hy = H - L.stickR - L.margin * 2;
      r.strokeCircle(hx, hy, L.stickR, 'rgba(255,255,255,0.10)', 3, 1);
      ui.text('MOVE', hx, hy, {
        size: 11 * s, color: 'rgba(255,255,255,0.30)', align: 'center', weight: 800, mono: true,
      });
    }

    // --- the two ability buttons ---------------------------------------------
    // These ARE the radials now, rather than a pair of hollow rings in the
    // corner opposite the ones carrying the information. Cooldown, charges and
    // the ready pulse belong on the thing you press.
    this._touchAbility(r, run, 'special', '✦', '#ff5fa2',
                       L.specialX, L.specialY, L.specialR, t.buttons.special, s);
    this._touchAbility(r, run, 'escape', '➤', '#6ad8ff',
                       L.escapeX, L.escapeY, L.escapeR, t.buttons.escape, s);

    // --- pause ---------------------------------------------------------------
    const pr = L.pauseR;
    r.drawCircle(L.pauseX, L.pauseY, pr, 'rgba(6,8,16,0.85)', 1);
    r.strokeCircle(L.pauseX, L.pauseY, pr, PALETTE.border, 2.5, 1);
    // Two bars, drawn rather than typed: the pause glyph is one of the few
    // characters that is missing often enough to render as a tofu box, and a
    // tofu box on the only exit from a run is not a risk worth taking.
    const bw = Math.max(3, pr * 0.17), bh = pr * 0.86;
    r.drawRect(L.pauseX - bw * 2, L.pauseY - bh / 2, bw, bh, PALETTE.text, 0.95);
    r.drawRect(L.pauseX + bw, L.pauseY - bh / 2, bw, bh, PALETTE.text, 0.95);
  }

  /** One touch ability button: the radial, its cooldown read, and its name. */
  _touchAbility(r, run, key, icon, color, cx, cy, rad, pressed, s) {
    const p = run.player;
    const st = p[key];
    TOUCH_RADIAL.icon = icon;
    TOUCH_RADIAL.charges = st.charges;
    TOUCH_RADIAL.maxCharges = st.maxCharges;
    // A press has to be visible even when the button is on cooldown, or every
    // mistimed tap reads as a control that did not register.
    TOUCH_RADIAL.bg = pressed ? 'rgba(46,58,92,0.95)' : 'rgba(6,8,16,0.85)';
    ui.radial(cx, cy, rad, st.progress, color, TOUCH_RADIAL);
    if (pressed) r.strokeCircle(cx, cy, rad + 4, '#ffffff', 2.5, 0.55);
    if (!st.ready) {
      ui.text(st.remaining.toFixed(1), cx, cy + rad * 0.50, {
        size: 16 * s, color: '#ffffff', align: 'center', weight: 800, mono: true, outline: true,
      });
    }
    ui.text(displayName(p.def[key]).split(' [')[0], cx, cy - rad - 10 * s, {
      size: 11 * s, color: PALETTE.textDim, align: 'center', weight: 800,
    });
  }
}

// THE DURATION BARS' OPTION BAGS, HOISTED.
//
// The older widgets in this file build their opts inline, which is harmless for
// a plate that is drawn once and then reasoned about never again. These are
// different: they are polled and redrawn every rendered frame for as long as an
// ability is running, and the rule the rest of the project holds to is that a
// per-frame path allocates nothing. Every field that varies — with the UI scale,
// with which slot the bar belongs to, with the warning state — is written on
// every use, so nothing can leak in from the bar drawn before it.
const BAR_PANEL = {
  radius: 6, color: 'rgba(10,13,24,0.94)', borderColor: '', borderWidth: 2, bevel: false,
};
const BAR_ICON = { size: 17, color: '#ffffff', align: 'center', baseline: 'middle' };
const BAR_NAME = { size: 15, color: PALETTE.text, weight: 800, baseline: 'middle' };
const BAR_TIME = {
  size: 22, color: '#ffffff', weight: 800, mono: true,
  align: 'right', baseline: 'middle', outline: true,
};

/** Under this, an ability is a cast animation rather than a state you play inside. */
const BAR_MIN_TIME = 0.6;
/**
 * The warning zone, as a FRACTION rather than a fixed number of seconds. A
 * quarter of a 1.2s dash is 0.3s, which is about one human reaction; a quarter
 * of a 12s window is three seconds, which is long enough to get somewhere. One
 * number reads correctly for both only because it is proportional.
 */
const BAR_WARN_FRAC = 0.25;

/**
 * THE TOUCH CONTROL MAP — one record, rebuilt in place every frame a run is
 * being played through and handed to the input layer as it stands.
 *
 * It lives at module scope for the usual reason (a per-frame path allocates
 * nothing) and it is SHARED with input.js by value rather than by reference:
 * setTouchControls copies the fields out, so this is free to be scratch.
 *
 * `live` is what the rest of the HUD reads to get out of the way. It is false
 * on a desktop, and false while a run is paused or picking an upgrade — those
 * states draw menus on top of the HUD, and a movement stick still claiming the
 * bottom-left of the screen underneath a menu is the entire bug this replaced.
 */
const TOUCH_L = {
  live: false, rad: 0, margin: 0,
  zoneX: 0, zoneY: 0, zoneW: 0, zoneH: 0, stickR: 90,
  specialX: 0, specialY: 0, specialR: 0,
  escapeX: 0, escapeY: 0, escapeR: 0,
  pauseX: 0, pauseY: 0, pauseR: 0,
  topClear: 0, rightClear: 0,
};

/** The touch buttons' radial opts. Same rule as the bars above. */
const TOUCH_RADIAL = {
  icon: '', charges: 0, maxCharges: 1, bg: 'rgba(6,8,16,0.85)',
};

export const hud = new Hud();
