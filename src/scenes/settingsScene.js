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
// THE HIT REGION IS THE CONTROL, NEVER THE ROW.
// Each row used to declare ONE button spanning the full ~1080px list while the
// only thing the player could see was a 108px toggle, three 96px pills or a
// 260px action button. Clicking the grey note under DELETE SAVE opened the wipe
// confirmation; clicking the red warning under "Reduce flashing effects" flipped
// it. So every row now registers exactly one focus stop and it sits ON the
// control — the label and the note are inert text. The consequences:
//   · the enum pills look like radio buttons, so a click SELECTS the pill it
//     landed on instead of advancing the value by one (CONFIRM still advances,
//     because a keyboard has no cursor to land anywhere);
//   · a slider drag is locked to the track it started on and ignores the wheel,
//     so scrolling mid-drag can no longer teleport the value;
//   · FOCUS FOLLOWS THE ROW, not the screen slot. ui.focus is a flat per-frame
//     index, so scrolling used to slide a different setting under an unchanged
//     index and LEFT/RIGHT then adjusted whatever had slid into place.
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
    this.rowByFocus = [];      // frame-local focus index -> index into this.rows
    this.focusRow = -1;        // the ROW that holds focus, immune to scrolling
    this._focusInList = false;
    this._lastScroll = -1;
    this._refocus = true;
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

  // --- scrolling -------------------------------------------------------------
  /**
   * The row indices that fit in `listH` at the current scroll.
   *
   * Rows have three different heights, so the visible count is not a division —
   * and the old `maxScroll = rows.length - 1` let you scroll until one row sat
   * alone on an otherwise empty panel.
   */
  _visible(listH) {
    const out = [];
    let y = 0;
    for (let i = this.scroll; i < this.rows.length; i++) {
      const h = this._rowHeight(this.rows[i]);
      if (y + h > listH) break;
      out.push(i);
      y += h;
    }
    return out;
  },

  /** The scroll position at which the LAST row sits flush with the bottom. */
  _maxScroll(listH) {
    let s = this.rows.length;
    let used = 0;
    while (s > 0) {
      const h = this._rowHeight(this.rows[s - 1]);
      if (used + h > listH) break;
      used += h;
      s--;
    }
    return Math.max(0, Math.min(s, this.rows.length - 1));
  },

  /** Scroll the window until `idx` is on screen. Row heights vary, so: a loop. */
  _ensureVisible(idx, listH, maxScroll) {
    if (idx < 0) return;
    if (idx <= this.scroll) {
      // Bring the section header above it along for the ride when there is one.
      const head = idx > 0 && this.rows[idx - 1].type === 'head' ? idx - 1 : idx;
      this.scroll = clamp(head, 0, maxScroll);
      return;
    }
    let guard = this.rows.length + 1;
    while (guard-- > 0 && this.scroll < maxScroll &&
           this._visible(listH).indexOf(idx) < 0) this.scroll++;
  },

  /** The next focusable (non-header) row in `dir`, or -1. */
  _nextStop(from, dir) {
    for (let i = from + dir; i >= 0 && i < this.rows.length; i += dir) {
      if (this.rows[i].type !== 'head') return i;
    }
    return -1;
  },

  // --- values ----------------------------------------------------------------
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

  /** Pick an enum option OUTRIGHT — what three bordered pills have always looked
   *  like they do, and what the old advance-by-one behaviour never did. */
  _select(row, i) {
    const s = save.data.settings;
    const o = row.options[i];
    if (!o) return;
    if (s[row.key] === o.value) { audio.play('uiMove'); return; }
    s[row.key] = o.value;
    save.save();
    audio.play('uiConfirm');
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

    if (this.confirmWipe) {
      // Coming back out of the modal, focus has to be put back on the row that
      // opened it rather than on whatever slot index the modal left behind.
      this._refocus = true;
      this._renderConfirm(r, W, H, M);
      return;
    }

    // ---- header -----------------------------------------------------------
    ui.title('SETTINGS', M, 34, { size: 32 });
    ui.text('SECTION 13 calls this list required, not optional. So all of it works.',
      M, 62, { size: 13, color: PALETTE.textFaint });
    ui.text('LEFT / RIGHT changes the highlighted row  ·  ENTER or A activates it',
      W - M, 34, { size: 12, color: PALETTE.textDim, align: 'right', weight: 700 });
    ui.text('Mouse: drag a slider knob, click a pill, drag the scrollbar.',
      W - M, 54, { size: 12, color: PALETTE.textFaint, align: 'right' });

    const ctrlY = 84;
    if (ui.backButton(M, ctrlY)) { audio.play('uiBack'); this.manager.go('hub'); }

    // ---- geometry ---------------------------------------------------------
    const listY = ctrlY + 48;
    const listH = H - listY - M;
    const listW = Math.min(W - M * 2, 1080);
    const listX = M + Math.max(0, (W - M * 2 - listW) / 2);

    const maxScroll = this._maxScroll(listH);
    const barW = maxScroll > 0 ? 14 : 0;
    const rowW = listW - barW;

    // The wheel belongs to the LIST. It used to scroll from anywhere on the
    // screen, including from over the back button — and it is ignored outright
    // mid-drag, because sliding the track out from under a held knob is how the
    // volume used to jump to 0%.
    if (input.wheel && !this.drag && ui.pointIn(listX, listY, listW, listH)) {
      this.scroll = clamp(this.scroll + input.wheel, 0, maxScroll);
    }
    this.scroll = clamp(this.scroll, 0, maxScroll);

    if (this.drag) this._applyDrag();

    // ---- focus follows the ROW, not the slot ------------------------------
    const base = ui.itemCount;              // the rows start after the back button
    const stops = [];
    for (const j of this._visible(listH)) if (this.rows[j].type !== 'head') stops.push(j);
    if (stops.length && (this._refocus || (this.scroll !== this._lastScroll && this._focusInList))) {
      let p = stops.indexOf(this.focusRow);
      if (p < 0) p = this.focusRow >= 0 && this.focusRow > stops[stops.length - 1] ? stops.length - 1 : 0;
      this.focusRow = stops[p];
      ui.focus = base + p;
    }
    this._lastScroll = this.scroll;
    this._refocus = false;

    // ---- the rows ---------------------------------------------------------
    const clip = { x: listX, y: listY, w: rowW, h: listH };
    this.rowByFocus.length = 0;
    r.clipRect(listX, listY, listW, listH);
    let y = listY;
    let firstIdx = -1, lastIdx = -1;
    const vis = this._visible(listH);
    for (const j of vis) {
      const row = this.rows[j];
      const h = this._rowHeight(row);
      if (row.type === 'head') {
        this._drawHead(r, listX, y, rowW, row);
      } else {
        const idx = ui.itemCount;
        if (firstIdx < 0) firstIdx = idx;
        lastIdx = idx;
        this.rowByFocus[idx] = j;
        const rect = this._ctrlRect(row, listX, y, rowW, h - 6);
        // The slider grabs its own press BEFORE the focus widget is declared,
        // then takes the frame's click so the widget stays silent on release.
        if (row.type === 'slider') this._sliderPress(row, rect);
        if (this.drag && this.drag.row === row) ui.consumeClick();
        // `invisible` + a rect that IS the control: the row stays a focus stop
        // for the keyboard, but a click can only land on the thing you see.
        const hit = ui.button('row' + j, rect.x, rect.y, rect.w, rect.h, '',
          { invisible: true, clip });
        this._drawRow(r, listX, y, rowW, h - 6, row, ui.focus === idx, hit, rect);
      }
      y += h;
    }
    r.unclip();
    const nextRow = vis.length ? vis[vis.length - 1] + 1 : this.scroll;

    // ---- a real scrollbar -------------------------------------------------
    // The old affordance was a 3px painted rectangle: a mouse with no wheel
    // could not reach the SAVE DATA section at all.
    if (maxScroll > 0) {
      const seen = this.rows.length - maxScroll;
      this.scroll = Math.round(ui.scrollbar('setScroll', listX + listW - 10, listY, 8, listH,
        this.scroll, seen, this.rows.length));
      this.scroll = clamp(this.scroll, 0, maxScroll);
      if (nextRow < this.rows.length) {
        ui.text('▾ ' + (this.rows.length - nextRow) + ' MORE', listX + rowW - 8, listY + listH - 8,
          { size: 11, color: PALETTE.textFaint, align: 'right', weight: 700 });
      }
    }

    // ---- LEFT / RIGHT belongs to the focused row -------------------------
    const focusIdx = this.rowByFocus[ui.focus];
    const focusedRow = focusIdx === undefined ? null : this.rows[focusIdx];
    let consumed = false;
    if (focusedRow && focusedRow.type !== 'action') {
      let dir = 0;
      if (input.pressed(ACT.RIGHT)) dir = 1;
      else if (input.pressed(ACT.LEFT)) dir = -1;
      if (dir !== 0) { this._adjust(focusedRow, dir); consumed = true; }
    }
    // At the edges of the window, DOWN/UP move the WINDOW and take the focused
    // row with them — ui.end() would otherwise wrap the flat index around.
    if (!consumed && focusedRow) {
      let target = -1;
      if (input.pressed(ACT.DOWN) && ui.focus === lastIdx) target = this._nextStop(focusIdx, 1);
      else if (input.pressed(ACT.UP) && ui.focus === firstIdx) target = this._nextStop(focusIdx, -1);
      if (target >= 0) {
        this.focusRow = target;
        this._ensureVisible(target, listH, maxScroll);
        this._refocus = true;
        consumed = true;
        audio.play('uiMove');
      }
    }
    // Parking the toolkit's nav cooldown is what stops ui.end() ALSO moving the
    // cursor on the same key press.
    if (consumed) ui._navCooldown = 0.14;

    // Letting go writes the save immediately; touch() only queues it.
    if (this.drag && !input.mouseDown) { this.drag = null; save.save(); }

    ui.focusGrid(1);
    ui.end();

    // ui.end() has just resolved the arrow keys, so THIS is where the row that
    // owns the focus is recorded for the next frame.
    const settled = this.rowByFocus[ui.focus];
    this._focusInList = settled !== undefined;
    if (this._focusInList && !this._refocus) this.focusRow = settled;
  },

  // --- geometry --------------------------------------------------------------
  /**
   * The rect the player can SEE and therefore the only rect they may click.
   * `cx`/`cw` come back with it so the row's note knows where to stop wrapping.
   */
  _ctrlRect(row, x, y, w, h) {
    const cw = Math.min(300, Math.max(150, w * 0.28));
    const cx = x + w - 20 - cw;
    const cy = y + h / 2;
    if (row.type === 'toggle') return { x: cx + cw - 108, y: cy - 15, w: 108, h: 30, cx, cw };
    if (row.type === 'enum') return { x: cx, y: cy - 15, w: cw, h: 30, cx, cw };
    if (row.type === 'action') {
      const bw = Math.min(cw, 260);
      return { x: cx + cw - bw, y: cy - 16, w: bw, h: 32, cx, cw };
    }
    // Slider: the TRACK. The value readout to its left is a label, not a target.
    const labelW = 66;
    return { x: cx + labelW, y: cy - 14, w: Math.max(60, cw - labelW - 8), h: 28, cx, cw };
  },

  // --- the slider drag -------------------------------------------------------
  /**
   * Start a drag, remembering the track it started ON.
   *
   * The old version re-derived the track from the row's live on-screen position
   * every frame, so one wheel notch mid-drag slid the row and teleported the
   * value to wherever the cursor now sat relative to a different row.
   */
  _sliderPress(row, rect) {
    if (this.drag || !input.mouseClicked || !input.mouseInside) return;
    if (!ui.pointIn(rect.x - 12, rect.y, rect.w + 24, rect.h)) return;
    this.drag = { row, tx: rect.x, tw: rect.w };
    this._applyDrag();
  },

  _applyDrag() {
    // A pointer that has left the canvas reads as x = -10000; applying that
    // would slam the value to its minimum on the way out.
    if (!input.mouseInside) return;
    const d = this.drag;
    const span = d.row.max - d.row.min;
    this._setSlider(d.row, d.row.min + clamp((ui.mx - d.tx) / d.tw, 0, 1) * span);
  },

  // --- drawing ---------------------------------------------------------------
  _drawHead(r, x, y, w, row) {
    ui.text(row.label, x + 4, y + 16, { size: 13, color: PALETTE.accent, weight: 800 });
    const lw = r.measureText(row.label, 13 * ui.scale, 800);
    if (w > 700) ui.text(row.blurb || '', x + 16 + lw, y + 17, { size: 12, color: PALETTE.textFaint });
    r.drawRect(x + 4, y + 26, w - 8, 1, PALETTE.border, 1);
  },

  _drawRow(r, x, y, w, h, row, focused, hit, rect) {
    // Row-level feedback. The click target is the control, but the cursor
    // resting anywhere on the row should still say which row that is.
    // Kept translucent on purpose: the toolkit's focus ring is drawn around the
    // control BEFORE this, and a solid plate would bury it.
    const over = ui.pointIn(x, y, w, h);
    if (focused || over) {
      r.drawRoundRect(x + 2, y, w - 4, h, 8, PALETTE.panelHi, focused ? 0.34 : 0.18);
      r.drawRect(x + 2, y, 3, h, focused ? PALETTE.accent : PALETTE.border, focused ? 1 : 0.6);
    }

    const labelX = x + 16;
    ui.text(row.label, labelX, y + (row.note ? 20 : h / 2), {
      size: 15, weight: 800, color: focused ? PALETTE.accent : PALETTE.text,
    });
    if (row.note) {
      const noteW = Math.max(120, rect.cx - labelX - 24);
      const lines = wrapText(r, row.note, noteW, 11 * ui.scale);
      for (let i = 0; i < lines.length && i < 3; i++) {
        ui.text(lines[i], labelX, y + 36 + i * 14, {
          size: 11, color: row.noteColor || PALETTE.textFaint,
        });
      }
    }

    if (row.type === 'slider') this._drawSlider(r, row, rect, focused);
    else if (row.type === 'toggle') this._drawToggle(r, row, rect, focused, hit);
    else if (row.type === 'enum') this._drawEnum(r, row, rect, focused, hit);
    else if (row.type === 'action') this._drawAction(r, row, rect, focused, hit);

    if (focused && row.type !== 'action') {
      ui.text('‹', rect.cx - 14, y + h / 2, { size: 16, color: PALETTE.accent, weight: 800, align: 'center' });
      ui.text('›', x + w - 8, y + h / 2, { size: 16, color: PALETTE.accent, weight: 800, align: 'center' });
    }
  },

  _drawSlider(r, row, rect, focused) {
    const s = save.data.settings;
    const v = typeof s[row.key] === 'number' ? s[row.key] : row.min;
    const span = row.max - row.min;
    const frac = span > 0 ? clamp((v - row.min) / span, 0, 1) : 0;
    const dragging = !!(this.drag && this.drag.row === row);
    const cy = rect.y + rect.h / 2;

    ui.text(row.fmt ? row.fmt(v) : String(v), rect.x - 12, cy, {
      size: 14, color: focused || dragging ? PALETTE.accent : PALETTE.text,
      align: 'right', weight: 800, mono: true,
    });

    ui.bar(rect.x, cy - 6, rect.w, 12, frac,
      frac <= 0.001 ? PALETTE.textFaint : (focused || dragging ? PALETTE.accent : PALETTE.accent2));

    // A 6px dot did not read as something you could pick up. This one is 20-26px
    // across and carries grip lines, which is the difference between "indicator"
    // and "handle".
    const kx = rect.x + rect.w * frac;
    const kr = dragging ? 13 : focused ? 12 : 10;
    const col = dragging || focused ? PALETTE.accent : PALETTE.text;
    r.drawCircle(kx, cy, kr, col, 1);
    r.strokeCircle(kx, cy, kr, '#05060d', 2.5, 0.85);
    r.drawRect(kx - 3.5, cy - kr * 0.42, 1.5, kr * 0.84, '#05060d', 0.55);
    r.drawRect(kx + 2, cy - kr * 0.42, 1.5, kr * 0.84, '#05060d', 0.55);

    if (ui.pointIn(rect.x - 12, rect.y, rect.w + 24, rect.h)) ui.markHot();
  },

  _drawToggle(r, row, rect, focused, hit) {
    // `hit` can now only come from the pill itself — the red warning paragraph
    // under this row used to flip it.
    if (hit) this._activate(row);
    const on = !!save.data.settings[row.key];
    const px = rect.x, py = rect.y, pw = rect.w, ph = rect.h;
    const hot = ui.pointIn(px, py, pw, ph);
    ui.panel(px, py, pw, ph, {
      radius: 15,
      color: on ? 'rgba(123,245,154,0.12)' : hot ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)',
      borderColor: on ? PALETTE.good : hot || focused ? PALETTE.borderHot : PALETTE.border,
      borderWidth: focused ? 2 : 1.5,
      bevel: false,
    });
    const knobX = on ? px + pw - 17 : px + 17;
    r.drawCircle(knobX, py + ph / 2, 11, on ? PALETTE.good : PALETTE.textFaint, 1);
    ui.text(on ? (row.onLabel || 'ON') : (row.offLabel || 'OFF'),
      on ? px + 16 : px + pw - 16, py + ph / 2, {
        size: 12, weight: 800, align: on ? 'left' : 'right',
        color: on ? PALETTE.good : PALETTE.textDim,
      });
  },

  _drawEnum(r, row, rect, focused, hit) {
    const cur = save.data.settings[row.key];
    const n = row.options.length;
    const gap = 6;
    const bw = (rect.w - gap * (n - 1)) / n;

    let over = -1;
    for (let i = 0; i < n; i++) {
      if (ui.pointIn(rect.x + i * (bw + gap), rect.y, bw, rect.h)) over = i;
    }

    if (hit) {
      // A keyboard or a gamepad has no cursor to land on a pill, so CONFIRM
      // keeps its old advance-by-one meaning. A CLICK selects what it hit —
      // three individually-bordered pills have always looked like radio buttons
      // and now they behave like them.
      const byKey = input.pressed(ACT.CONFIRM) || input.pressed(ACT.SPECIAL);
      if (byKey || over < 0) this._adjust(row, 1);
      else this._select(row, over);
    }

    for (let i = 0; i < n; i++) {
      const o = row.options[i];
      const active = o.value === cur;
      const hot = over === i;
      const bx = rect.x + i * (bw + gap);
      ui.panel(bx, rect.y, bw, rect.h, {
        radius: 8,
        color: active ? 'rgba(255,215,106,0.16)' : hot ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.03)',
        borderColor: active ? PALETTE.accent : hot ? PALETTE.borderHot : PALETTE.border,
        borderWidth: active && focused ? 2 : 1.5,
        bevel: false,
      });
      ui.text(o.label, bx + bw / 2, rect.y + rect.h / 2, {
        size: 11, weight: 800, align: 'center',
        color: active ? PALETTE.accent : hot ? PALETTE.text : PALETTE.textFaint,
      });
    }
  },

  _drawAction(r, row, rect, focused, hit) {
    // Tight hit box, deliberately: DELETE SAVE used to fire from anywhere on the
    // row, including the grey sentence explaining what it destroys.
    if (hit) this._activate(row);
    const col = row.danger ? PALETTE.bad : PALETTE.accent2;
    const hot = ui.pointIn(rect.x, rect.y, rect.w, rect.h);
    ui.panel(rect.x, rect.y, rect.w, rect.h, {
      radius: 8,
      color: row.danger
        ? (hot ? 'rgba(255,111,145,0.22)' : 'rgba(255,111,145,0.10)')
        : (hot ? 'rgba(106,216,255,0.20)' : 'rgba(106,216,255,0.08)'),
      borderColor: focused || hot ? col : PALETTE.border,
      borderWidth: focused ? 2 : 1.5,
      bevel: false,
    });
    ui.text(focused || hot ? '▸ ' + row.label : row.label, rect.x + rect.w / 2, rect.y + rect.h / 2, {
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
