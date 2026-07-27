// The F3 debug overlay and the F4 feel-tuning panel.
//
// The F3 overlay exists because "60 FPS with 2,000 entities" is an acceptance
// criterion, and the honest version of that check needs entity counts, frame
// time percentiles, and pool starvation next to the FPS number. An FPS counter
// alone reports 60 on an idle title screen and marks the criterion PASS.
//
// The F4 panel exists because juice tuning cannot be self-certified. It binds
// live sliders to every constant in feel.js; drag until it feels right, press
// COPY, paste the output over the defaults.

import { DEV_MODE } from '../core/config.js';
import { feel, FEEL_RANGES, resetFeel, exportFeel } from '../core/feel.js';
import { atlas } from './spriteAtlas.js';
import { particles } from './particles.js';
import { damageNumbers } from './damageNumbers.js';
import { storage } from '../core/storage.js';
import { displayName, refSuffix } from '../core/config.js';
import { MONO_FONT, UI_FONT } from './renderer.js';
import { clamp } from '../core/math.js';
import { input } from '../core/input.js';

class DebugOverlay {
  constructor() {
    this.visible = false;
    this.feelPanel = false;
    this.run = null;
    this.scroll = 0;
    this.dragKey = null;
    this._keys = Object.keys(FEEL_RANGES);
    this._lines = [];
    this._flash = 0;
  }

  toggle() { this.visible = !this.visible; }
  toggleFeelPanel() {
    if (!DEV_MODE) return;
    this.feelPanel = !this.feelPanel;
    if (this.feelPanel) this.visible = true;
  }

  attachRun(run) { this.run = run; }

  draw(r, game) {
    r.setScreenSpace();
    const pad = 10;
    const L = this._lines;
    L.length = 0;

    const p = game.perf;
    const fpsColor = p.fps >= 58 ? '#7bf59a' : p.fps >= 45 ? '#ffd94a' : '#ff6f91';

    L.push(['FPS', `${p.fps.toFixed(0)}  (p95 ${p.p95.toFixed(1)}ms)`, fpsColor]);
    L.push(['frame', `sim ${p.simMs.toFixed(2)}ms  render ${p.renderMs.toFixed(2)}ms  steps ${p.steps}`,
            p.simMs + p.renderMs > 16.6 ? '#ff6f91' : '#9fb0d0']);

    const run = this.run;
    if (run) {
      const total = run.totalEntities();
      L.push(['entities', `${total}  /  ${run.enemies.count} enemy  ${run.projectiles.count}+${run.enemyProjectiles.count} proj  ` +
                          `${run.pickups.count} pick  ${run.minions.count} minion  ${particles.count} fx  ${damageNumbers.count} dmg`,
              total > 2000 ? '#ffd94a' : '#9fb0d0']);
      const starved = run.enemies.pool.starved + run.projectiles.pool.starved + run.pickups.pool.starved;
      if (starved > 0) L.push(['STARVED', `${starved} spawn(s) refused by a pool cap`, '#ff6f91']);
      const q = run.waveDirector.stats();
      L.push(['waves', `event ${q.next}/${q.total}  spawned ${q.spawned}` + (q.queued ? `  QUEUED ${q.queued}` : ''),
              q.queued ? '#ffd94a' : '#9fb0d0']);
      L.push(['director', run.adaptive.debugString(), '#9fb0d0']);
      L.push(['run', `t ${run.time.toFixed(1)}s  seed ${run.seed}  ${run.stage.id}/${run.tier.id}`, '#9fb0d0']);

      const pl = run.player;
      const suffix = refSuffix(pl.def);
      L.push(['player', `${pl.def.name}${suffix ? ' [' + suffix + ']' : ''}  S${pl.starLevel}  L${pl.level}  ` +
                        `${pl.hp.toFixed(0)}/${pl.maxHp.toFixed(0)}hp`, '#e8ecf5']);
      L.push(['stats', `dmg x${pl.stats.damageMult.toFixed(2)}  as x${pl.stats.attackSpeedMult.toFixed(2)}  ` +
                       `area x${pl.stats.areaMult.toFixed(2)}  crit ${(pl.stats.critChance * 100).toFixed(0)}%  ` +
                       `pierce +${pl.stats.pierce}  proj +${pl.stats.projectileCount}`, '#9fb0d0']);
      L.push(['dps', `total ${(run.stats.dpsSamples.length ? run.stats.dpsSamples[run.stats.dpsSamples.length - 1] : 0).toFixed(0)}/s  ` +
                     `peak ${run.stats.peakDps.toFixed(0)}  kills ${run.stats.kills}  k/s ${(run.stats.kills / Math.max(1, run.time)).toFixed(1)}`, '#9fb0d0']);
      if (run.player.relics.length) {
        L.push(['relics', run.player.relics.map((id) => {
          const rr = run.data.relics.RELICS_BY_ID[id];
          return displayName(rr) + (run.relicHooks.isResonant(id) ? ' ★' : '');
        }).join(', '), '#ffd76a']);
      }
      if (run.player.evolutions.length) {
        L.push(['evolutions', run.player.evolutions.join(', '), '#ffd76a']);
      }
      if (run.boss.isActive) {
        const b = run.boss;
        L.push(['boss', `${displayName(b.def)}  phase ${b.phaseIndex + 1}/${b.def.phases ? b.def.phases.length : 1}  ` +
                        `${(b.active.hp / b.active.maxHp * 100).toFixed(0)}%  ` +
                        `attack ${b.current ? b.current.key : '-'}`, '#ff6f91']);
      }
    }

    const a = atlas.stats();
    L.push(['atlas', `${a.sprites} sprites ~${a.mb}MB` +
                     (atlas.emojiSupported ? '  emoji OK' : '  EMOJI UNSUPPORTED (shapes only)') +
                     (a.lazyMisses ? `  LAZY ${a.lazyMisses}` : ''),
            (!atlas.emojiSupported || a.lazyMisses) ? '#ffd94a' : '#9fb0d0']);
    L.push(['storage', storage.name, '#9fb0d0']);
    L.push(['input', input.lastDevice + (input.padIndex >= 0 ? ' (pad)' : ''), '#9fb0d0']);

    // panel
    const lineH = 15;
    const w = 640;
    const h = L.length * lineH + pad * 2 + 4;
    r.drawRect(pad, pad, w, h, 'rgba(6,8,16,0.82)', 1);
    r.strokeRect(pad, pad, w, h, 'rgba(120,140,200,0.25)', 1, 1);

    let y = pad + 16;
    for (const [k, v, color] of L) {
      r.drawText(k, pad + 8, y, { size: 11, color: '#5f6b8c', family: MONO_FONT, weight: 700 });
      r.drawText(v, pad + 78, y, { size: 11, color: color || '#9fb0d0', family: MONO_FONT, weight: 500 });
      y += lineH;
    }

    r.drawText('F3 close · F4 feel panel', pad + 8, pad + h - 6,
               { size: 10, color: '#41496b', family: MONO_FONT });

    if (this.feelPanel) this._drawFeelPanel(r);
  }

  _drawFeelPanel(r) {
    const w = 330;
    const x = r.w - w - 12;
    const rowH = 22;
    const visible = Math.min(this._keys.length, Math.floor((r.h - 120) / rowH));
    const h = visible * rowH + 76;
    const y0 = 12;

    r.drawRect(x, y0, w, h, 'rgba(6,8,16,0.92)', 1);
    r.strokeRect(x, y0, w, h, 'rgba(255,215,106,0.35)', 1, 1);
    r.drawText('FEEL — drag to tune', x + 12, y0 + 20, { size: 13, color: '#ffd76a', weight: 800 });
    r.drawText('scroll: wheel · COPY writes to console', x + 12, y0 + 34,
               { size: 10, color: '#6a7590', family: MONO_FONT });

    if (input.wheel) this.scroll = clamp(this.scroll + input.wheel, 0, Math.max(0, this._keys.length - visible));

    const mx = input.mouseX / (r.dpr || 1);
    const my = input.mouseY / (r.dpr || 1);

    let y = y0 + 50;
    for (let i = 0; i < visible; i++) {
      const key = this._keys[this.scroll + i];
      if (!key) break;
      const [min, max, step] = FEEL_RANGES[key];
      const val = feel[key];
      const t = clamp((val - min) / (max - min), 0, 1);

      const barX = x + 12, barW = w - 24, barY = y + 12;
      r.drawText(key, barX, y + 8, { size: 10, color: '#c8d2e8', family: MONO_FONT });
      r.drawText(String(+val.toFixed(4)), barX + barW, y + 8,
                 { size: 10, color: '#ffd76a', family: MONO_FONT, align: 'right' });
      r.drawRect(barX, barY, barW, 4, '#1d2438', 1);
      r.drawRect(barX, barY, barW * t, 4, '#ffd76a', 1);
      r.drawCircle(barX + barW * t, barY + 2, 5, '#ffe9a3', 1);

      const hot = mx >= barX - 6 && mx <= barX + barW + 6 && my >= barY - 8 && my <= barY + 12;
      if (input.mouseDown && (this.dragKey === key || (hot && !this.dragKey))) {
        this.dragKey = key;
        const nt = clamp((mx - barX) / barW, 0, 1);
        const raw = min + nt * (max - min);
        feel[key] = Math.round(raw / step) * step;
      }
      y += rowH;
    }
    if (!input.mouseDown) this.dragKey = null;

    // buttons
    const by = y0 + h - 24;
    this._button(r, x + 12, by, 92, 18, 'COPY', () => {
      const out = exportFeel();
      console.log('%c[feel] paste over the defaults in src/core/feel.js:', 'color:#ffd76a', '\n' + out);
      if (navigator.clipboard) navigator.clipboard.writeText(out).catch(() => {});
      this._flash = 1;
    }, mx, my);
    this._button(r, x + 112, by, 92, 18, 'RESET', () => { resetFeel(); }, mx, my);
    if (this._flash > 0) {
      this._flash -= 0.02;
      r.drawText('copied to console', x + 212, by + 13, { size: 10, color: '#7bf59a', family: MONO_FONT });
    }
  }

  _button(r, x, y, w, h, label, onClick, mx, my) {
    const hot = mx >= x && mx <= x + w && my >= y && my <= y + h;
    r.drawRect(x, y, w, h, hot ? '#2a3350' : '#1a2035', 1);
    r.strokeRect(x, y, w, h, '#3d4870', 1, 1);
    r.drawText(label, x + w / 2, y + 13, { size: 10, color: '#c8d2e8', align: 'center', family: MONO_FONT, weight: 700 });
    if (hot && input.mouseClicked) onClick();
  }
}

export const debugOverlay = new DebugOverlay();
