// The level-up card screen, the chest reveal, the relic-swap prompt, the altar,
// and the pause menu. Everything that freezes the sim mid-run lives here.
//
// SECTION 10's rule governs the card text: "Never write 'increases damage' —
// write '+12% damage (now +36% total)'." Every card here computes both numbers
// from the data, so a card can never drift from what it actually grants.

import { ui, PALETTE, RARITY_COLOR, wrapText, fitSize, ellipsize } from './widgets.js';
import { displayName } from '../core/config.js';
import { input, ACT } from '../core/input.js';
import { audio } from '../core/audio.js';
import { save } from '../core/save.js';
import { atlas } from '../render/spriteAtlas.js';
import { clamp, easeOutBack, easeOutCubic, lerp } from '../core/math.js';
import { RUN_STATE } from '../game/run.js';

const CARD_W = 250;
const CARD_H = 340;

class LevelUpScreen {
  constructor() {
    this.t = 0;
    this.lastState = -1;
  }

  update(run, dt) {
    if (run.state !== this.lastState) { this.lastState = run.state; this.t = 0; }
    this.t += dt;
  }

  draw(r, run) {
    switch (run.state) {
      case RUN_STATE.LEVEL_UP: this._levelUp(r, run); break;
      case RUN_STATE.CHEST: this._chest(r, run); break;
      case RUN_STATE.RELIC_SWAP: this._relicSwap(r, run); break;
      case RUN_STATE.PAUSED: this._pause(r, run); break;
    }
  }

  // --- level-up ---------------------------------------------------------------
  _levelUp(r, run) {
    const W = r.w, H = r.h;
    const choices = run.levelUpChoices;
    if (!choices) return;

    r.overlay('#05060d', 0.72);
    // Radial flash on arrival (SECTION 3's juice list).
    const flashT = clamp(this.t / 0.35, 0, 1);
    if (flashT < 1) r.overlay('#ffffff', (1 - flashT) * 0.35);

    ui.begin(r, 'levelup');
    ui.focusGrid(choices.length);

    ui.title('LEVEL ' + run.player.level, W / 2, H * 0.17, { size: 46, align: 'center' });
    ui.text('choose one', W / 2, H * 0.17 + 34, { size: 14, color: PALETTE.textDim, align: 'center' });

    const gap = 22;
    const totalW = choices.length * CARD_W + (choices.length - 1) * gap;
    const x0 = (W - totalW) / 2;
    const y = H / 2 - CARD_H / 2 + 20;

    for (let i = 0; i < choices.length; i++) {
      // The cards FLY IN, staggered.
      const inT = clamp((this.t - i * 0.06) / 0.32, 0, 1);
      const e = easeOutBack(inT);
      const x = x0 + i * (CARD_W + gap);
      const yy = y + (1 - e) * 90;

      if (inT <= 0) { ui.itemCount++; continue; }
      this._card(r, run, choices[i], x, yy, i, e);
    }

    // reroll / banish / skip
    const by = y + CARD_H + 26;
    const bw = 150;
    const bx = W / 2 - (bw * 3 + 24) / 2;
    if (ui.button('reroll', bx, by, bw, 40, `REROLL (${run.rerollsLeft})`,
                  { disabled: run.rerollsLeft <= 0, size: 14 })) {
      run.rerollUpgrades();
      this.t = 0;
    }
    if (ui.button('banish', bx + bw + 12, by, bw, 40, `BANISH (${run.banishesLeft})`,
                  { disabled: run.banishesLeft <= 0, size: 14,
                    tooltip: 'Removes the focused upgrade from this run’s pool entirely.' })) {
      run.banishUpgrade(ui.focus);
      this.t = 0;
    }
    if (ui.button('skip', bx + (bw + 12) * 2, by, bw, 40,
                  `SKIP (+${run.data.upgrades.LEVELUP.skipGold} ⭐)`, { size: 14 })) {
      run.skipUpgrade();
    }

    // number-key shortcuts
    for (let i = 0; i < choices.length && i < 9; i++) {
      if (this._numberKey(i + 1)) run.chooseUpgrade(i);
    }

    ui.end();
  }

  _card(r, run, choice, x, y, index, e) {
    const focused = ui.focus === index;
    const p = run.player;

    if (choice.kind === 'evolution') {
      const evo = choice.evo;
      ui.card(x, y, CARD_W, CARD_H, 6, { focused });
      ui.text('EVOLUTION', x + CARD_W / 2, y + 26, {
        size: 12, color: '#ff5fa2', align: 'center', weight: 800,
      });
      ui.text(evo.icon || '✦', x + CARD_W / 2, y + 84, { size: 52, align: 'center' });
      ui.text(ellipsize(r, evo.name, CARD_W - 26, 19, 800), x + CARD_W / 2, y + 140, {
        size: fitSize(r, evo.name, CARD_W - 26, 19, 800), color: PALETTE.accent,
        align: 'center', weight: 800,
      });
      const lines = wrapText(r, evo.desc, CARD_W - 30, 13, 600);
      for (let i = 0; i < lines.length; i++) {
        ui.text(lines[i], x + CARD_W / 2, y + 176 + i * 17, {
          size: 13, color: PALETTE.text, align: 'center', weight: 600,
        });
      }
      const up = run.data.upgrades.UPGRADES_BY_ID[evo.requires.upgrade];
      const rel = run.data.relics.RELICS_BY_ID[evo.requires.relic];
      ui.text(`${up.name} (MAX) + ${displayName(rel)}`, x + CARD_W / 2, y + CARD_H - 24, {
        size: 11, color: PALETTE.textFaint, align: 'center',
      });
      if (ui.button('card' + index, x, y, CARD_W, CARD_H, '', { radius: 12, invisible: true })) {
        run.chooseUpgrade(index);
      }
      return;
    }

    // --- weapon cards ---------------------------------------------------------
    // These three branches MUST come before the stat-card body below, which
    // reads `choice.up.tier` unconditionally: a card kind with no branch of its
    // own throws inside the render loop and blanks the whole screen.
    if (choice.kind === 'weaponEvo') {
      const evo = choice.evo;
      const wname = run.weapons.nameOf(choice.w);
      ui.card(x, y, CARD_W, CARD_H, 6, { focused });
      ui.text('EVOLVE', x + CARD_W / 2, y + 26, {
        size: 12, color: '#ffd76a', align: 'center', weight: 800,
      });
      ui.text(evo.icon || '♾', x + CARD_W / 2, y + 84, { size: 52, align: 'center' });
      ui.text(ellipsize(r, evo.name, CARD_W - 26, 19, 800), x + CARD_W / 2, y + 140, {
        size: fitSize(r, evo.name, CARD_W - 26, 19, 800), color: '#ffd76a',
        align: 'center', weight: 800,
      });
      ui.text('ALWAYS ACTIVE', x + CARD_W / 2, y + 160, {
        size: 11, color: '#7bf59a', align: 'center', weight: 800,
      });
      const elines = wrapText(r, evo.desc, CARD_W - 30, 13, 600);
      for (let i = 0; i < Math.min(5, elines.length); i++) {
        ui.text(elines[i], x + CARD_W / 2, y + 186 + i * 17, {
          size: 13, color: PALETTE.text, align: 'center', weight: 600,
        });
      }
      ui.text(wname + ' — MAX', x + CARD_W / 2, y + CARD_H - 24, {
        size: 11, color: PALETTE.textFaint, align: 'center',
      });
      if (ui.button('card' + index, x, y, CARD_W, CARD_H, '', { radius: 12, invisible: true })) {
        run.chooseUpgrade(index);
      }
      return;
    }

    if (choice.kind === 'newWeapon') {
      const def = choice.def;
      const rar = def.tier === 'epic' ? 5 : def.tier === 'rare' ? 4 : 3;
      ui.card(x, y, CARD_W, CARD_H, rar, { focused });
      ui.text('NEW WEAPON', x + CARD_W / 2, y + 24, {
        size: 12, color: '#7bf59a', align: 'center', weight: 800,
      });
      ui.text(def.icon || '⚔', x + CARD_W / 2, y + 82, { size: 48, align: 'center' });
      ui.text(ellipsize(r, def.name, CARD_W - 26, 20, 800), x + CARD_W / 2, y + 138, {
        size: fitSize(r, def.name, CARD_W - 26, 20, 800), color: RARITY_COLOR[rar],
        align: 'center', weight: 800,
      });
      const dlines = wrapText(r, def.desc, CARD_W - 30, 13, 600);
      for (let i = 0; i < Math.min(4, dlines.length); i++) {
        ui.text(dlines[i], x + CARD_W / 2, y + 172 + i * 17, {
          size: 13, color: PALETTE.text, align: 'center', weight: 600,
        });
      }
      // The slot cost, stated plainly. Taking a third weapon is the last one you
      // will ever take, and the card has to say so before you click it.
      const used = run.weapons.count, max = run.weapons.max;
      ui.text(`WEAPON SLOT ${used + 1} / ${max}`, x + CARD_W / 2, y + CARD_H - 52, {
        size: 12, color: used + 1 >= max ? '#ffd23f' : PALETTE.accent2,
        align: 'center', weight: 800, mono: true,
      });
      if (used + 1 >= max) {
        ui.text('your last slot', x + CARD_W / 2, y + CARD_H - 36, {
          size: 11, color: '#ffd23f', align: 'center', weight: 700,
        });
      }
      ui.text('[' + (index + 1) + ']', x + CARD_W / 2, y + CARD_H - 15, {
        size: 11, color: PALETTE.textFaint, align: 'center', mono: true,
      });
      if (ui.button('card' + index, x, y, CARD_W, CARD_H, '', { radius: 12, invisible: true })) {
        run.chooseUpgrade(index);
      }
      return;
    }

    if (choice.kind === 'weapon') {
      const w = choice.w;
      const lvl = choice.level;
      const maxL = run.weapons.maxLevel(w);
      const row = w.signature ? run.data.weapons.SIGNATURE_LEVELS[lvl - 1]
                              : w.def.levels[lvl - 1];
      const rar = w.signature ? 5 : w.def.tier === 'epic' ? 5 : w.def.tier === 'rare' ? 4 : 3;
      ui.card(x, y, CARD_W, CARD_H, rar, { focused });
      ui.text(w.signature ? 'SIGNATURE' : 'WEAPON', x + CARD_W / 2, y + 24, {
        size: 12, color: w.signature ? '#ffd76a' : PALETTE.accent2,
        align: 'center', weight: 800,
      });
      ui.text(run.weapons.iconOf(w), x + CARD_W / 2, y + 82, { size: 48, align: 'center' });
      const wname = run.weapons.nameOf(w).split(' [')[0];
      ui.text(ellipsize(r, wname, CARD_W - 26, 20, 800), x + CARD_W / 2, y + 138, {
        size: fitSize(r, wname, CARD_W - 26, 20, 800), color: RARITY_COLOR[rar],
        align: 'center', weight: 800,
      });
      ui.text(`Lv ${lvl} / ${maxL}`, x + CARD_W / 2, y + 162, {
        size: 13, color: PALETTE.textDim, align: 'center', weight: 800, mono: true,
      });
      // SECTION 10's rule, applied to weapons: never "improves the weapon" —
      // always the specific thing this specific level buys.
      const nlines = wrapText(r, (row && row.note) || '', CARD_W - 30, 15, 700);
      for (let i = 0; i < Math.min(3, nlines.length); i++) {
        ui.text(nlines[i], x + CARD_W / 2, y + 194 + i * 19, {
          size: 15, color: PALETTE.text, align: 'center', weight: 700,
        });
      }
      if (lvl >= maxL) {
        ui.text('next: EVOLUTION', x + CARD_W / 2, y + CARD_H - 52, {
          size: 12, color: '#ffd76a', align: 'center', weight: 800,
        });
      }
      const pipW = Math.min(14, (CARD_W - 40) / maxL);
      const pipY = y + CARD_H - 34;
      const pipX = x + CARD_W / 2 - (maxL * pipW) / 2;
      for (let i = 0; i < maxL; i++) {
        r.drawRect(pipX + i * pipW + 2, pipY, pipW - 4, 5,
                   i < lvl ? RARITY_COLOR[rar] : 'rgba(255,255,255,0.14)', 1);
      }
      ui.text('[' + (index + 1) + ']', x + CARD_W / 2, y + CARD_H - 15, {
        size: 11, color: PALETTE.textFaint, align: 'center', mono: true,
      });
      if (ui.button('card' + index, x, y, CARD_W, CARD_H, '', { radius: 12, invisible: true })) {
        run.chooseUpgrade(index);
      }
      return;
    }

    if (choice.kind === 'gold') {
      ui.card(x, y, CARD_W, CARD_H, 3, { focused });
      ui.text('⭐', x + CARD_W / 2, y + 110, { size: 60, align: 'center' });
      ui.text('+' + choice.amount + ' GOLD', x + CARD_W / 2, y + 180, {
        size: 20, color: PALETTE.gold, align: 'center', weight: 800,
      });
      ui.text('Everything else is maxed. Take the money.', x + CARD_W / 2, y + 212, {
        size: 12, color: PALETTE.textDim, align: 'center',
      });
      if (ui.button('card' + index, x, y, CARD_W, CARD_H, '', { radius: 12, invisible: true })) run.chooseUpgrade(index);
      return;
    }

    const up = choice.up;
    const level = choice.level;
    const isNew = level === 1;
    const rarity = up.tier === 'epic' ? 5 : up.tier === 'rare' ? 4 : 3;
    ui.card(x, y, CARD_W, CARD_H, rarity, { focused });

    ui.text(isNew ? 'NEW' : `Lv ${level} / ${up.maxLevel}`, x + CARD_W / 2, y + 24, {
      size: 12, color: isNew ? '#7bf59a' : PALETTE.textFaint, align: 'center', weight: 800,
    });
    ui.text(up.icon || '◆', x + CARD_W / 2, y + 82, { size: 48, align: 'center' });
    ui.text(ellipsize(r, up.name, CARD_W - 26, 20, 800), x + CARD_W / 2, y + 138, {
      size: fitSize(r, up.name, CARD_W - 26, 20, 800), color: RARITY_COLOR[rarity],
      align: 'center', weight: 800,
    });

    // THE NUMBERS. Both of them, always.
    const perLevel = up.perLevel;
    const totalAfter = perLevel * level;
    const thisLevel = formatValue(up, perLevel);
    const total = formatValue(up, totalAfter);
    ui.text(thisLevel, x + CARD_W / 2, y + 178, {
      size: fitSize(r, thisLevel, CARD_W - 26, 22, 800), color: PALETTE.text,
      align: 'center', weight: 800,
    });
    if (level > 1) {
      const totalTxt = `(now ${total} total)`;
      ui.text(totalTxt, x + CARD_W / 2, y + 204, {
        size: fitSize(r, totalTxt, CARD_W - 26, 14, 700), color: PALETTE.accent,
        align: 'center', weight: 700,
      });
    }

    const lines = wrapText(r, up.codex || up.desc || '', CARD_W - 30, 12, 600);
    for (let i = 0; i < Math.min(4, lines.length); i++) {
      ui.text(lines[i], x + CARD_W / 2, y + 236 + i * 15, {
        size: 12, color: PALETTE.textDim, align: 'center', weight: 600,
      });
    }

    // level pips
    const pipW = 12, pipY = y + CARD_H - 34;
    const pipX = x + CARD_W / 2 - (up.maxLevel * pipW) / 2;
    for (let i = 0; i < up.maxLevel; i++) {
      r.drawRect(pipX + i * pipW + 2, pipY, pipW - 4, 5,
                 i < level ? RARITY_COLOR[rarity] : 'rgba(255,255,255,0.14)', 1);
    }
    ui.text('[' + (index + 1) + ']', x + CARD_W / 2, y + CARD_H - 15, {
      size: 11, color: PALETTE.textFaint, align: 'center', mono: true,
    });

    if (ui.button('card' + index, x, y, CARD_W, CARD_H, '', { radius: 12, invisible: true })) {
      run.chooseUpgrade(index);
    }
  }

  _numberKey(n) {
    // The widgets layer owns navigation; number keys are a direct-select extra.
    if (typeof window === 'undefined') return false;
    return !!(input._pressed && input._pressed['num' + n]);
  }

  // --- chest ------------------------------------------------------------------
  _chest(r, run) {
    const W = r.w, H = r.h;
    const res = run.chestResult;
    if (!res) return;

    r.overlay('#05060d', 0.7);
    ui.begin(r, 'chest');

    if (res.kind === 'altar') {
      const A = run.data.upgrades.SHRINE_ALTAR;
      ui.title('⛩  THE ALTAR', W / 2, H * 0.28, { size: 40, align: 'center' });
      ui.text('Something is listening. It wants something first.', W / 2, H * 0.28 + 36,
              { size: 15, color: PALETTE.textDim, align: 'center' });
      ui.focusGrid(3);
      const bw = 300, bh = 96;
      const bx = W / 2 - bw / 2;
      const hpCost = Math.ceil(run.player.hp * A.hpCostPercent);
      if (ui.button('altarHp', bx, H * 0.45, bw, bh,
                    `OFFER ${hpCost} HP`, { size: 18, sub: 'for a random relic' })) {
        run.useAltar('hp');
      }
      if (ui.button('altarGold', bx, H * 0.45 + bh + 12, bw, bh,
                    `OFFER ${A.goldCost} ⭐`, {
                      size: 18, sub: 'for a guaranteed upgrade',
                      disabled: run.stats.gold < A.goldCost,
                    })) {
        run.useAltar('gold');
      }
      if (ui.button('altarNo', bx, H * 0.45 + (bh + 12) * 2, bw, 48, 'WALK AWAY', { size: 15 })) {
        run.altar.used = true;
        run.closeChest();
      }
      ui.end();
      return;
    }

    const isGold = res.gold;
    ui.title(isGold ? '📦  GOLD CHEST' : '📦  CHEST', W / 2, H * 0.26, {
      size: 40, align: 'center', color: isGold ? PALETTE.gold : PALETTE.text,
    });

    const granted = res.granted || [];
    ui.text(granted.length + (granted.length === 1 ? ' upgrade' : ' upgrades'),
            W / 2, H * 0.26 + 34, { size: 15, color: PALETTE.textDim, align: 'center' });

    const cw = 200, ch = 74, gap = 12;
    const totalW = Math.min(granted.length, 5) * (cw + gap) - gap;
    const x0 = (W - totalW) / 2;
    for (let i = 0; i < granted.length; i++) {
      // Slot-machine style stagger.
      const inT = clamp((this.t - 0.15 - i * 0.16) / 0.3, 0, 1);
      if (inT <= 0) continue;
      const up = granted[i];
      const x = x0 + i * (cw + gap);
      const y = H * 0.42 + (1 - easeOutBack(inT)) * 40;
      const rarity = up.tier === 'epic' ? 5 : up.tier === 'rare' ? 4 : 3;
      ui.card(x, y, cw, ch, rarity, {});
      ui.text(up.icon || '◆', x + 30, y + ch / 2, { size: 26, align: 'center' });
      ui.text(up.name, x + 56, y + 26, { size: 15, color: RARITY_COLOR[rarity], weight: 800 });
      ui.text(formatValue(up, up.perLevel), x + 56, y + 48, { size: 13, color: PALETTE.text });
    }

    ui.focusGrid(1);
    if (ui.button('chestOk', W / 2 - 110, H * 0.72, 220, 48, 'CONTINUE', { size: 16 }) ||
        input.pressed(ACT.ESCAPE)) {
      run.closeChest();
    }
    ui.end();
  }

  // --- relic swap ---------------------------------------------------------------
  _relicSwap(r, run) {
    const W = r.w, H = r.h;
    const offerId = run.relicOffer;
    if (!offerId) return;
    const offer = run.data.relics.RELICS_BY_ID[offerId];
    const p = run.player;

    r.overlay('#05060d', 0.76);
    ui.begin(r, 'relicswap');
    ui.focusGrid(4);

    ui.title('RELIC FOUND', W / 2, H * 0.16, { size: 38, align: 'center', color: PALETTE.accent });
    ui.text('You can only carry three. Choose what to drop.', W / 2, H * 0.16 + 32,
            { size: 15, color: PALETTE.textDim, align: 'center' });

    // The new relic
    const nw = 300, nh = 190;
    this._relicCard(r, run, offer, W / 2 - nw / 2, H * 0.26, nw, nh, true, false);

    // The three held
    const cw = 260, ch = 170, gap = 18;
    const totalW = 3 * cw + 2 * gap;
    const x0 = (W - totalW) / 2;
    for (let i = 0; i < 3; i++) {
      const held = run.data.relics.RELICS_BY_ID[p.relics[i]];
      const x = x0 + i * (cw + gap);
      const y = H * 0.58;
      const focused = ui.focus === i;
      this._relicCard(r, run, held, x, y, cw, ch, false, focused);
      if (ui.button('slot' + i, x, y, cw, ch, '', { radius: 12, invisible: true })) {
        run.resolveRelicSwap(i);
      }
    }

    if (ui.button('declineRelic', W / 2 - 110, H * 0.58 + ch + 18, 220, 42, 'KEEP MINE', { size: 15 })) {
      run.resolveRelicSwap(-1);
    }
    ui.end();
  }

  _relicCard(r, run, relic, x, y, w, h, isNew, focused) {
    if (!relic) { ui.panel(x, y, w, h, {}); return; }
    const resonant = run.player.resonatesWith(relic.id);
    ui.card(x, y, w, h, resonant ? 6 : 5, { focused });
    ui.text(relic.icon || '◆', x + w / 2, y + 38, { size: 30, align: 'center' });
    ui.text(displayName(relic), x + w / 2, y + 72, {
      size: 16, color: resonant ? '#ffd76a' : PALETTE.text, align: 'center', weight: 800,
    });
    if (resonant) {
      ui.text('RESONANCE', x + w / 2, y + 90, {
        size: 11, color: '#ff9a3d', align: 'center', weight: 800,
      });
    }
    const desc = resonant && relic.resonanceDesc ? relic.resonanceDesc : relic.desc;
    const lines = wrapText(r, desc, w - 28, 12);
    for (let i = 0; i < Math.min(4, lines.length); i++) {
      ui.text(lines[i], x + w / 2, y + (resonant ? 110 : 104) + i * 15, {
        size: 12, color: PALETTE.textDim, align: 'center',
      });
    }
    if (isNew) {
      ui.text('NEW', x + w / 2, y + h - 14, { size: 11, color: '#7bf59a', align: 'center', weight: 800 });
    }
  }

  // --- pause ---------------------------------------------------------------------
  _pause(r, run) {
    const W = r.w, H = r.h;
    r.overlay('#05060d', 0.8);
    ui.begin(r, 'pause');
    ui.focusGrid(1);

    ui.title('PAUSED', W / 2, H * 0.16, { size: 44, align: 'center' });

    const p = run.player;
    const colW = 460;

    // YOUR ARSENAL. Same reasoning as the evolution recipes below it: a weapon
    // you cannot see the level of is a weapon you cannot plan around, and the
    // "this one is maxed, take the evolve card" moment has to be legible before
    // the card shows up rather than after.
    ui.text('WEAPONS  ' + run.weapons.count + ' / ' + run.weapons.max,
            W * 0.5, H * 0.20, { size: 14, color: PALETTE.accent2, align: 'center', weight: 800 });
    let wy = H * 0.24;
    for (const w of run.weapons.slots) {
      const maxL = run.weapons.maxLevel(w);
      const done = w.evolved;
      const ready = run.weapons.isMaxed(w);
      const col = done ? '#ffd76a' : ready ? '#7bf59a' : PALETTE.text;
      const tail = done ? 'EVOLVED'
                 : ready ? 'MAX — can evolve into ' + run.weapons.evolutionOf(w).name
                 : 'Lv ' + w.level + ' / ' + maxL;
      ui.text(`${run.weapons.iconOf(w)}  ${run.weapons.nameOf(w).split(' [')[0]}`,
              W / 2 - colW / 2, wy, { size: 13, color: col, weight: 700 });
      ui.text(tail, W / 2 + colW / 2, wy, { size: 12, color: col, align: 'right' });
      wy += 19;
    }
    for (let i = run.weapons.count; i < run.weapons.max; i++) {
      ui.text('·  empty weapon slot', W / 2 - colW / 2, wy,
              { size: 13, color: PALETTE.textFaint });
      wy += 19;
    }

    // Evolution recipes live here. SECTION 10: "A hidden recipe is a wasted recipe."
    const hints = run.data.evolutions.EVOLUTION_HINTS;
    ui.text('EVOLUTIONS', W * 0.5, wy + 14, { size: 14, color: PALETTE.accent, align: 'center', weight: 800 });
    let y = wy + 34;
    for (const hint of hints) {
      const evo = run.data.evolutions.EVOLUTIONS_BY_ID[hint.id];
      const haveUp = p.isMaxed(evo.requires.upgrade);
      const haveRelic = p.hasRelic(evo.requires.relic);
      const done = p.evolutions.indexOf(evo.id) >= 0;
      const color = done ? '#7bf59a' : (haveUp && haveRelic) ? PALETTE.accent
                  : (haveUp || haveRelic) ? PALETTE.text : PALETTE.textFaint;
      const mark = done ? '✔' : (haveUp && haveRelic) ? '▶' : '·';
      ui.text(`${mark}  ${hint.upgradeName}${haveUp ? ' ✓' : ''}  +  ${hint.relicName}${haveRelic ? ' ✓' : ''}  →  ${hint.resultName}`,
              W / 2 - colW / 2, y, { size: 13, color });
      y += 20;
    }

    const bw = 260, bh = 46;
    const bx = W / 2 - bw / 2;
    let by = y + 26;
    if (ui.button('resume', bx, by, bw, bh, 'RESUME', { size: 16 })) {
      run.state = RUN_STATE.PLAYING;
    }
    by += bh + 10;
    if (ui.button('pauseSettings', bx, by, bw, bh, 'SETTINGS', { size: 15 })) {
      run.wantSettings = true;
    }
    by += bh + 10;
    if (ui.button('quit', bx, by, bw, bh, 'ABANDON RUN', { size: 15,
        tooltip: 'You keep every coin and fragment you earned. This is a roguelite, not a punishment box.' })) {
      run.wantQuit = true;
    }

    ui.text('ESC to resume', W / 2, H - 30, { size: 12, color: PALETTE.textFaint, align: 'center' });
    ui.end();
  }
}

/** Renders an upgrade's per-level value using its declared unit. */
function formatValue(up, v) {
  if (up.fmt) {
    const num = up.unit === 'percent' ? Math.round(v * 1000) / 10 : Math.round(v * 100) / 100;
    return up.fmt.replace('{v}', num);
  }
  if (up.unit === 'percent') return '+' + (v * 100).toFixed(0) + '%';
  return '+' + (Math.round(v * 100) / 100);
}

export const levelUpScreen = new LevelUpScreen();
