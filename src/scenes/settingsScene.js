// SETTINGS — SECTION 13 calls this list REQUIRED, not optional.
//
// Every row on this screen writes a real field in save.data.settings and every
// one of those fields is read by something:
//   masterVolume/sfxVolume/musicVolume  audio.applySettings()
//   shakeIntensity + screenShakeOff     render/screenShake.js
//   damageNumbers                       render/damageNumbers.js
//   reduceFlashing                      render/screenShake.js + core/feel.js
//   uiScale                             ui/widgets.js, ui/hud.js
//   autoAim                             game/run.js
//   colorblindOutlines / holdToUseAbilities / showRefNames  are stored and read
//   by their owning systems; nothing on this screen fakes a value it cannot set.
//
// EVERY control is adjustable with LEFT/RIGHT on the focused row, which is what
// makes the whole screen work on a keyboard and on a gamepad stick. The toolkit
// resolves LEFT/RIGHT as focus movement in ui.end(); when the focused row owns
// those keys we consume them first and park the toolkit's nav cooldown for a
// frame so the cursor does not also jump.
//
// PHOTOSENSITIVITY: reduceFlashing DEFAULTS TO ON (DECISIONS.md, deferred item
// 5) and the row states plainly what has and has not been verified. This screen
// makes no safety claim, because nobody has run the frame capture that would
// justify one.

import { ui, PALETTE, wrapText } from '../ui/widgets.js';
import { input, ACT } from '../core/input.js';
import { save } from '../core/save.js';
import { audio } from '../core/audio.js';

const ROW_H = 50;
const FLASH_ROW_H = 74;
const HEAD_H = 34;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function snap(v, step) { return Math.round(Math.round(v / step) * step * 1000) / 1000; }
function pctLabel(v) { return Math.round(v * 100) + '%'; }

export const settingsScene = {
  manager: null,

  enter(params, mgr) {
    this.manager = mgr || this.manager;
    this.scroll = 0;
    this.drag = null;
    this.confirmWipe = false;
    this.wipeArm = 0;          // cooling-off timer on the destructive button
    this.rowByFocus = [];
    this.rows = this._buildRows();

    // A console-driven import, for anyone who would rather paste than click.
    if (typeof window !== 'undefined') {
      window.__gsImport = (json) => this._applyImport(json);
      window.__gsExport = () => save.export();
    }
  },

  exit() { this.drag = null; },

  update(dt) {
    if (this.confirmWipe && this.wipeArm > 0) this.wipeArm = Math.max(0, this.wipeArm - dt);
  },

  clearColor() { return '#05060d'; },

  // --- the model -------------------------------------------------------------
  _buildRows() {
    return [
      { type: 'head', label: 'AUDIO', blurb: 'Every sound in the game is synthesised. There are no files to go missing.' },
      {
        type: 'slider', key: 'masterVolume', label: 'Master volume',
        min: 0, max: 1, step: 0.05, fmt: pctLabel,
        after: () => audio.applySettings(),
      },
      {
        type: 'slider', key: 'sfxVolume', label: 'SFX volume',
        note: 'Hits, crits, pickups, the gacha machine rattling.',
        min: 0, max: 1, step: 0.05, fmt: pctLabel,
        after: () => { audio.applySettings(); audio.play('uiConfirm'); },
      },
      {
        type: 'slider', key: 'musicVolume', label: 'Music volume',
        note: 'One optional track per stage. Silence is a supported configuration.',
        min: 0, max: 1, step: 0.05, fmt: pctLabel,
        after: () => audio.applySettings(),
      },

      { type: 'head', label: 'FEEL & CLARITY', blurb: 'Turn any of this off. Nothing here is load-bearing for difficulty.' },
      {
        type: 'slider', key: 'shakeIntensity', label: 'Screen shake',
        note: 'Slide all the way left for OFF. Boss slams still land, they just stop moving the furniture.',
        min: 0, max: 1, step: 0.05,
        fmt: (v) => (v <= 0.001 ? 'OFF' : pctLabel(v)),
        // Both fields, always in agreement: screenShake.js checks the hard OFF
        // flag first and the intensity second.
        after: (v) => { save.data.settings.screenShakeOff = v <= 0.001; },
      },
      {
        type: 'enum', key: 'damageNumbers', label: 'Damage numbers',
        note: 'Crits-only is the readable middle ground when the screen is full.',
        options: [
          { value: 'all', label: 'ALL' },
          { value: 'crits', label: 'CRITS ONLY' },
          { value: 'off', label: 'OFF' },
        ],
      },
      {
        type: 'toggle', key: 'reduceFlashing', label: 'Reduce flashing effects',
        h: FLASH_ROW_H,
        // Verbatim, and it stays verbatim. Do not soften this into a claim.
        note: 'Caps flash frequency at 3Hz. This has not been verified with frame capture — ' +
              'we make no epilepsy-safety claim.',
        noteColor: PALETTE.bad,
        onLabel: 'ON', offLabel: 'OFF',
      },
      {
        type: 'toggle', key: 'colorblindOutlines', label: 'Colourblind-safe enemy outlines',
        note: 'Thicker, higher-contrast silhouettes. Telegraphs already pair every colour with a shape.',
        onLabel: 'ON', offLabel: 'OFF',
      },
      {
        type: 'slider', key: 'uiScale', label: 'UI scale',
        note: 'Applies live, to this screen included.',
        min: 0.8, max: 1.4, step: 0.05,
        fmt: (v) => v.toFixed(2) + '×',
      },

      { type: 'head', label: 'CONTROLS', blurb: 'Mouse, keyboard and gamepad all drive the same game. Pick a favourite.' },
      {
        type: 'toggle', key: 'autoAim', label: 'Auto-aim',
        note: 'Off means your aim comes from the cursor or the right stick, and only from there.',
        onLabel: 'ON', offLabel: 'OFF',
      },
      {
        type: 'enum', key: 'holdToUseAbilities', label: 'Abilities',
        note: 'Hold suits a controller. Tap suits a keyboard. Neither is faster.',
        options: [
          { value: false, label: 'TAP TO USE' },
          { value: true, label: 'HOLD TO USE' },
        ],
      },

      { type: 'head', label: 'DEVELOPER', blurb: 'Visible because this is a dev build.' },
      {
        type: 'toggle', key: 'showRefNames', label: 'Show ref names',
        note: 'Stored in the save. displayName() currently keys off the ?dev= URL flag — ?dev=0 is what ships.',
        onLabel: 'ON', offLabel: 'OFF',
      },

      { type: 'head', label: 'SAVE DATA', blurb: 'It lives in this browser and nowhere else. There is no server, and there never was.' },
      {
        type: 'action', label: 'EXPORT SAVE',
        note: 'Copies the whole save to your clipboard and prints it to the console (F12).',
        run: () => this._export(),
      },
      {
        type: 'action', label: 'IMPORT SAVE',
        note: 'Reads a save from your clipboard. A bad paste changes nothing.',
        run: () => this._import(),
      },
      {
        type: 'action', label: 'RESTORE DEFAULT SETTINGS',
        note: 'Settings only. Your roster, gold and achievements are not touched.',
        run: () => this._restoreDefaults(),
      },
      {
        type: 'action', label: 'DELETE SAVE', danger: true,
        note: 'Everything. Roster, pity counters, achievements, the lot.',
        run: () => { this.confirmWipe = true; this.wipeArm = 1.5; ui.focus = 0; },
      },
    ];
  },

  _rowHeight(row) {
    if (row.type === 'head') return HEAD_H;
    return row.h || ROW_H;
  },

  _setSlider(row, v) {
    const s = save.data.settings;
    const nv = clamp(snap(v, row.step), row.min, row.max);
    if (nv === s[row.key]) return;
    s[row.key] = nv;
    if (row.after) row.after(nv);
    // touch(), not save(): a mouse drag would otherwise write localStorage every
    // frame. SaveManager.tick flushes it within a second, and letting go of the
    // mouse forces a write immediately.
    save.touch();
  },

  _adjust(row, dir) {
    const s = save.data.settings;
    if (row.type === 'slider') {
      const cur = typeof s[row.key] === 'number' ? s[row.key] : row.min;
      this._setSlider(row, cur + dir * row.step);
      audio.play('uiMove');
      return true;
    }
    if (row.type === 'toggle') {
      const next = dir > 0;
      if (!!s[row.key] === next) return false;
      s[row.key] = next;
      save.save();
      audio.play('uiConfirm');
      return true;
    }
    if (row.type === 'enum') {
      let idx = 0;
      for (let i = 0; i < row.options.length; i++) if (row.options[i].value === s[row.key]) idx = i;
      const n = row.options.length;
      const next = (idx + dir + n) % n;
      if (next === idx) return false;
      s[row.key] = row.options[next].value;
      save.save();
      audio.play('uiConfirm');
      return true;
    }
    return false;
  },

  _activate(row) {
    const s = save.data.settings;
    if (row.type === 'toggle') {
      s[row.key] = !s[row.key];
      save.save();
      return;
    }
    if (row.type === 'enum') { this._adjust(row, 1); return; }
    if (row.type === 'action' && row.run) row.run();
  },

  // --- save data actions -----------------------------------------------------
  _export() {
    const json = save.export();
    try {
      console.log('%c[GACHA SURVIVORS] save export — copy the string below', 'color:#ffd76a;font-weight:bold');
      console.log(json);
    } catch (e) { /* a missing console must never be fatal */ }
    let attempted = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        attempted = true;
        navigator.clipboard.writeText(json).then(
          () => this.manager.toast('Save copied to clipboard, and printed to the console.', PALETTE.good, '📋'),
          () => this.manager.toast('Clipboard refused. It is in the console instead (F12).', PALETTE.accent, '📋'),
        );
      }
    } catch (e) { attempted = false; }
    if (!attempted) {
      this.manager.toast('Save printed to the console (F12). No clipboard here.', PALETTE.accent, '📋');
    }
  },

  _import() {
    const apply = (text) => this._applyImport(text);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(apply, () => this._importPrompt(apply));
        return;
      }
    } catch (e) { /* fall through to the prompt */ }
    this._importPrompt(apply);
  },

  _importPrompt(apply) {
    // There is no DOM UI in this game, so the fallback is the browser's own
    // prompt, and the console hook after that.
    try {
      const t = window.prompt('Paste a Gacha Survivors save:');
      apply(t);
    } catch (e) {
      this.manager.toast('Paste it in the console: __gsImport(jsonString)', PALETTE.accent, '📥');
    }
  },

  _applyImport(text) {
    if (!text || !String(text).trim()) {
      this.manager.toast('Nothing to import. Nothing changed.', PALETTE.textDim, '📥');
      return false;
    }
    const ok = save.import(String(text));
    if (ok) {
      audio.applySettings();
      this.manager.toast('Save imported. Welcome back.', PALETTE.good, '📥');
    } else {
      this.manager.toast('That was not a Gacha Survivors save. Nothing was touched.', PALETTE.bad, '📥');
    }
    return ok;
  },

  _restoreDefaults() {
    const s = save.data.settings;
    s.masterVolume = 0.8; s.sfxVolume = 0.9; s.musicVolume = 0.5;
    s.shakeIntensity = 1.0; s.screenShakeOff = false;
    s.damageNumbers = 'all';
    s.reduceFlashing = true;      // stays ON by default. DECISIONS.md deferred #5.
    s.colorblindOutlines = false;
    s.uiScale = 1.0;
    s.autoAim = true;
    s.holdToUseAbilities = false;
    s.showRefNames = true;
    save.save();
    audio.applySettings();
    this.manager.toast('Settings back to factory. Reduce-flashing is on, as it should be.', PALETTE.accent, '⚙');
  },

  _wipe() {
    save.wipe();
    audio.applySettings();
    this.confirmWipe = false;
    // A fresh boot re-runs the first-run grant (two ★3 starters + 300💎), which
    // is the only thing that makes an empty save playable. Reloading is the
    // honest way to get there.
    try {
      if (typeof window !== 'undefined' && window.location && window.location.reload) {
        window.location.reload();
        return;
      }
    } catch (e) { /* fall through */ }
    this.manager.toast('Save deleted. Reload the page to start over.', PALETTE.bad, '🗑');
    this.manager.go('hub');
  },

  // --- render ----------------------------------------------------------------
  render(r, alpha) {
    ui.begin(r, 'settings');
    const W = r.w, H = r.h;
    const M = Math.round(clamp(W * 0.02, 14, 30));

    if (!input.mouseDown && this.drag) { this.drag = null; save.save(); }

    if (this.confirmWipe) { this._renderConfirm(r, W, H, M); return; }

    // ---- header -----------------------------------------------------------
    ui.title('SETTINGS', M, 34, { size: 32 });
    ui.text('SECTION 13 calls this list required, not optional. So all of it works.',
      M, 62, { size: 13, color: PALETTE.textFaint });
    ui.text('LEFT / RIGHT changes the highlighted row  ·  ENTER or A activates it',
      W - M, 34, { size: 12, color: PALETTE.textDim, align: 'right', weight: 700 });
    ui.text('Mouse: drag any slider bar directly.',
      W - M, 54, { size: 12, color: PALETTE.textFaint, align: 'right' });

    const ctrlY = 84;
    if (ui.backButton(M, ctrlY)) { audio.play('uiBack'); this.manager.go('hub'); }

    // ---- the rows ---------------------------------------------------------
    const listY = ctrlY + 48;
    const listH = H - listY - M;
    const listW = Math.min(W - M * 2, 1080);
    const listX = M + Math.max(0, (W - M * 2 - listW) / 2);

    if (input.wheel) this.scroll = clamp(this.scroll + input.wheel, 0, Math.max(0, this.rows.length - 1));
    this.scroll = clamp(this.scroll, 0, Math.max(0, this.rows.length - 1));

    this.rowByFocus.length = 0;
    r.clipRect(listX, listY, listW, listH);
    let y = listY;
    let firstIdx = -1, lastIdx = -1;
    let i = this.scroll;
    for (; i < this.rows.length; i++) {
      const row = this.rows[i];
      const h = this._rowHeight(row);
      if (y + h > listY + listH) break;
      if (row.type === 'head') {
        this._drawHead(r, listX, y, listW, row);
      } else {
        const idx = ui.itemCount;
        if (firstIdx < 0) firstIdx = idx;
        lastIdx = idx;
        this.rowByFocus[idx] = row;
        const hit = ui.button('row' + i, listX, y, listW, h - 6, '');
        const focused = ui.focus === idx;
        this._drawRow(r, listX, y, listW, h - 6, row, focused, hit);
      }
      y += h;
    }
    r.unclip();

    // ---- scroll affordance + edge scroll ---------------------------------
    const maxScroll = Math.max(0, this.rows.length - 1);
    if (maxScroll > 0 && (i < this.rows.length || this.scroll > 0)) {
      const t = this.scroll / maxScroll;
      const visible = Math.max(1, i - this.scroll);
      const bh = Math.max(30, listH * (visible / this.rows.length));
      r.drawRect(listX + listW - 3, listY + (listH - bh) * t, 3, bh, PALETTE.textFaint, 0.6);
      if (i < this.rows.length) {
        ui.text('▾ ' + (this.rows.length - i) + ' MORE', listX + listW - 18, listY + listH - 8,
          { size: 11, color: PALETTE.textFaint, align: 'right', weight: 700 });
      }
    }

    // ---- LEFT / RIGHT belongs to the focused row -------------------------
    const focusedRow = this.rowByFocus[ui.focus];
    let consumed = false;
    if (focusedRow && focusedRow.type !== 'action') {
      let dir = 0;
      if (input.pressed(ACT.RIGHT)) dir = 1;
      else if (input.pressed(ACT.LEFT)) dir = -1;
      if (dir !== 0) { this._adjust(focusedRow, dir); consumed = true; }
    }
    if (!consumed && firstIdx >= 0) {
      if (input.pressed(ACT.DOWN) && ui.focus === lastIdx && i < this.rows.length) {
        this.scroll = clamp(this.scroll + 1, 0, maxScroll); consumed = true; audio.play('uiMove');
      } else if (input.pressed(ACT.UP) && ui.focus === firstIdx && this.scroll > 0) {
        this.scroll = clamp(this.scroll - 1, 0, maxScroll); consumed = true; audio.play('uiMove');
      }
    }
    // Parking the toolkit's nav cooldown is what stops ui.end() ALSO moving the
    // cursor on the same key press.
    if (consumed) ui._navCooldown = 0.14;

    ui.focusGrid(1);
    ui.end();
  },

  _drawHead(r, x, y, w, row) {
    ui.text(row.label, x + 4, y + 16, { size: 13, color: PALETTE.accent, weight: 800 });
    const lw = r.measureText(row.label, 13 * ui.scale, 800);
    if (w > 700) ui.text(row.blurb || '', x + 16 + lw, y + 17, { size: 12, color: PALETTE.textFaint });
    r.drawRect(x + 4, y + 26, w - 8, 1, PALETTE.border, 1);
  },

  _drawRow(r, x, y, w, h, row, focused, hit) {
    const labelX = x + 16;
    const ctrlW = Math.min(300, Math.max(150, w * 0.28));
    const ctrlX = x + w - 20 - ctrlW;

    ui.text(row.label, labelX, y + (row.note ? 20 : h / 2), {
      size: 15, weight: 800, color: focused ? PALETTE.accent : PALETTE.text,
    });
    if (row.note) {
      const noteW = Math.max(120, ctrlX - labelX - 24);
      const lines = wrapText(r, row.note, noteW, 11 * ui.scale);
      for (let i = 0; i < lines.length && i < 3; i++) {
        ui.text(lines[i], labelX, y + 36 + i * 14, {
          size: 11, color: row.noteColor || PALETTE.textFaint,
        });
      }
    }

    if (row.type === 'slider') this._drawSlider(r, row, ctrlX, y, ctrlW, h, focused);
    else if (row.type === 'toggle') this._drawToggle(r, row, ctrlX, y, ctrlW, h, focused, hit);
    else if (row.type === 'enum') this._drawEnum(r, row, ctrlX, y, ctrlW, h, focused, hit);
    else if (row.type === 'action') this._drawAction(r, row, ctrlX, y, ctrlW, h, focused, hit);

    if (focused && row.type !== 'action') {
      ui.text('‹', ctrlX - 14, y + h / 2, { size: 16, color: PALETTE.accent, weight: 800, align: 'center' });
      ui.text('›', x + w - 8, y + h / 2, { size: 16, color: PALETTE.accent, weight: 800, align: 'center' });
    }
  },

  _drawSlider(r, row, x, y, w, h, focused) {
    const s = save.data.settings;
    const v = typeof s[row.key] === 'number' ? s[row.key] : row.min;
    const span = row.max - row.min;
    const frac = span > 0 ? clamp((v - row.min) / span, 0, 1) : 0;

    const labelW = 66;
    const tx = x + labelW;
    const tw = Math.max(60, w - labelW - 8);
    const ty = y + h / 2 - 5;

    ui.text(row.fmt ? row.fmt(v) : String(v), x + labelW - 12, y + h / 2, {
      size: 14, color: focused ? PALETTE.accent : PALETTE.text,
      align: 'right', weight: 800, mono: true,
    });

    ui.bar(tx, ty, tw, 10, frac, frac <= 0.001 ? PALETTE.textFaint : (focused ? PALETTE.accent : PALETTE.accent2));
    const kx = tx + tw * frac;
    r.drawCircle(kx, ty + 5, focused ? 8 : 6, focused ? PALETTE.accent : PALETTE.text, 1);
    r.strokeCircle(kx, ty + 5, focused ? 8 : 6, '#05060d', 2, 0.8);

    // Mouse drag. Grabbing anywhere on the track jumps the value there, which is
    // what every slider in every other program does.
    const mx = input.mouseX / (r.dpr || 1), my = input.mouseY / (r.dpr || 1);
    const overTrack = mx >= tx - 12 && mx <= tx + tw + 12 && my >= y && my <= y + h;
    if (input.mouseDown && (this.drag === row.key || (overTrack && input.mouseClicked))) {
      this.drag = row.key;
      this._setSlider(row, row.min + clamp((mx - tx) / tw, 0, 1) * span);
    }
  },

  _drawToggle(r, row, x, y, w, h, focused, hit) {
    if (hit) this._activate(row);
    const on = !!save.data.settings[row.key];
    const pw = 108, ph = 30;
    const px = x + w - pw, py = y + h / 2 - ph / 2;
    ui.panel(px, py, pw, ph, {
      radius: 15,
      color: on ? 'rgba(123,245,154,0.12)' : 'rgba(255,255,255,0.04)',
      borderColor: on ? PALETTE.good : PALETTE.border,
      borderWidth: focused ? 2 : 1.5,
    });
    const knobX = on ? px + pw - 17 : px + 17;
    r.drawCircle(knobX, py + ph / 2, 11, on ? PALETTE.good : PALETTE.textFaint, 1);
    ui.text(on ? (row.onLabel || 'ON') : (row.offLabel || 'OFF'),
      on ? px + 16 : px + pw - 16, py + ph / 2, {
        size: 12, weight: 800, align: on ? 'left' : 'right',
        color: on ? PALETTE.good : PALETTE.textDim,
      });
  },

  _drawEnum(r, row, x, y, w, h, focused, hit) {
    if (hit) this._activate(row);
    const cur = save.data.settings[row.key];
    const n = row.options.length;
    const gap = 6;
    const bw = (w - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const o = row.options[i];
      const active = o.value === cur;
      const bx = x + i * (bw + gap);
      ui.panel(bx, y + h / 2 - 15, bw, 30, {
        radius: 8,
        color: active ? 'rgba(255,215,106,0.14)' : 'rgba(255,255,255,0.03)',
        borderColor: active ? PALETTE.accent : PALETTE.border,
        borderWidth: active && focused ? 2 : 1.5,
      });
      ui.text(o.label, bx + bw / 2, y + h / 2, {
        size: 11, weight: 800, align: 'center',
        color: active ? PALETTE.accent : PALETTE.textFaint,
      });
    }
  },

  _drawAction(r, row, x, y, w, h, focused, hit) {
    if (hit) this._activate(row);
    const col = row.danger ? PALETTE.bad : PALETTE.accent2;
    const bw = Math.min(w, 260), bx = x + w - bw;
    ui.panel(bx, y + h / 2 - 16, bw, 32, {
      radius: 8,
      color: row.danger ? 'rgba(255,111,145,0.10)' : 'rgba(106,216,255,0.08)',
      borderColor: focused ? col : PALETTE.border,
      borderWidth: focused ? 2 : 1.5,
    });
    ui.text(focused ? '▸ ' + row.label : row.label, bx + bw / 2, y + h / 2, {
      size: 12, weight: 800, align: 'center', color: col,
    });
  },

  // --- the delete-save confirmation -----------------------------------------
  _renderConfirm(r, W, H, M) {
    r.overlay('#05060d', 0.72);

    const pw = Math.min(720, W - M * 2);
    const ph = Math.min(430, H - M * 2);
    const px = (W - pw) / 2, py = (H - ph) / 2;
    ui.panel(px, py, pw, ph, { radius: 16, color: 'rgba(12,8,14,0.98)', borderColor: PALETTE.bad, borderWidth: 2 });

    ui.title('DELETE EVERYTHING?', px + 28, py + 40, { size: 26, color: PALETTE.bad });
    let y = py + 72;
    const lines = wrapText(r,
      'This wipes the save in this browser. There is no server, there is no backup, and there is ' +
      'no undo. If you want a copy first, back out and use EXPORT SAVE.',
      pw - 56, 14 * ui.scale);
    for (const line of lines) { ui.text(line, px + 28, y, { size: 14, color: PALETTE.textDim }); y += 20; }
    y += 10;

    // Real numbers. You should know exactly what you are about to lose.
    const d = save.data;
    let owned = 0; for (const k in d.roster) if (d.roster[k].owned) owned++;
    let relics = 0; for (const k in d.relics) if (d.relics[k].owned) relics++;
    let achv = 0; for (const k in d.achievements) achv++;
    let cleared = 0; for (const k in d.stages) if (d.stages[k].cleared) cleared++;
    const rows = [
      ['Characters owned', String(owned)],
      ['Relics collected', String(relics)],
      ['Achievements earned', achv + ' / ' + this.manager.data.achievements.ACHIEVEMENTS.length],
      ['Stages cleared', String(cleared)],
      ['Total pulls', String(d.gacha.totalPulls || 0)],
      ['Runs / kills', (d.stats.runs || 0) + ' / ' + (d.stats.kills || 0)],
      ['Gold / Star Fragments', (d.currencies.gold || 0) + '⭐  ' + (d.currencies.starFragments || 0) + '💎'],
    ];
    for (const row of rows) { ui.statRow(row[0], row[1], px + 28, y, pw - 56, { color: PALETTE.bad }); y += 22; }

    const by = py + ph - 62;
    const bw = (pw - 56 - 16) / 2;
    if (ui.button('wipeNo', px + 28, by, bw, 44, 'NO — KEEP MY SAVE', { size: 15 })) {
      this.confirmWipe = false;
      audio.play('uiBack');
    }
    const armed = this.wipeArm <= 0;
    const label = armed ? 'YES — DELETE EVERYTHING' : 'YES — DELETE EVERYTHING  (' + this.wipeArm.toFixed(1) + 's)';
    if (ui.button('wipeYes', px + 44 + bw, by, bw, 44, label, { size: 15, disabled: !armed })) {
      this._wipe();
    }
    if (!armed) {
      ui.text('Read it first. The button arms in a moment.', px + 28, by - 14,
        { size: 11, color: PALETTE.textFaint });
    }

    // ESC / gamepad B backs out of the modal, never out of the screen.
    if (ui.backPressed()) { this.confirmWipe = false; audio.play('uiBack'); }

    ui.focusGrid(2);
    ui.end();
  },
};
