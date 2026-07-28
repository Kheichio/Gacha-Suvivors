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

/**
 * TWO CARD SHAPES, NOT ONE.
 *
 * A weapon and a stat upgrade are completely different decisions — one adds a
 * thing to the screen and takes a permanent slot, the other nudges a number —
 * and when both arrived as the same 250x340 rectangle with a different icon,
 * players could not tell them apart at a glance. So they no longer look alike:
 *
 *   WEAPON  wider, a solid TYPE RIBBON across the top, a coloured rail down the
 *           left, the icon in its own framed plate, and a before/after STAT
 *           TABLE. Loud and angular.
 *   PASSIVE narrower, no ribbon, no rail; the icon sits inline beside the name
 *           and the composition is built around one huge number. Quiet.
 *
 * PASSIVE stays at exactly 250 because tests/renderSmoke.js measures every
 * upgrade's name and description against that width at four UI scales.
 */
const CARD_W = 250;
const WEAPON_CARD_W = 306;
const CARD_H = 348;

/** Which kinds get the weapon treatment. */
const WEAPON_KINDS = { weapon: 1, newWeapon: 1, weaponEvo: 1 };
function cardWidth(choice) {
  return WEAPON_KINDS[choice.kind] ? WEAPON_CARD_W : CARD_W;
}

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

    // Cards are no longer a uniform width, so the row is laid out by walking a
    // running x rather than by multiplying one constant.
    let gap = 20;
    let totalW = (choices.length - 1) * gap;
    for (const c of choices) totalW += cardWidth(c);
    // Squeeze the gap before anything runs off the edge at four choices.
    if (totalW > W - 40 && choices.length > 1) {
      gap = Math.max(8, gap - (totalW - (W - 40)) / (choices.length - 1));
      totalW = (choices.length - 1) * gap;
      for (const c of choices) totalW += cardWidth(c);
    }
    let x0 = (W - totalW) / 2;
    const y = H / 2 - CARD_H / 2 + 20;

    for (let i = 0; i < choices.length; i++) {
      // The cards FLY IN, staggered.
      const inT = clamp((this.t - i * 0.06) / 0.32, 0, 1);
      const e = easeOutBack(inT);
      const cw = cardWidth(choices[i]);
      const yy = y + (1 - e) * 90;

      if (inT <= 0) { ui.itemCount++; }
      else this._card(r, run, choices[i], x0, yy, i, e, cw);
      x0 += cw + gap;
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

  _card(r, run, choice, x, y, index, e, cw) {
    const focused = ui.focus === index;
    const p = run.player;

    // WEAPON KINDS GO FIRST, and they go somewhere else entirely — see the
    // comment on WEAPON_CARD_W. They must also be handled before the stat-card
    // body below, which reads `choice.up.tier` unconditionally: a card kind with
    // no branch of its own throws inside the render loop and blanks the screen.
    if (WEAPON_KINDS[choice.kind]) {
      this._weaponCard(r, run, choice, x, y, cw, CARD_H, index, focused);
      return;
    }

    if (choice.kind === 'evolution') {
      const evo = choice.evo;
      ui.card(x, y, cw, CARD_H, 6, { focused });
      ui.text('BUILD EVOLUTION', x + cw / 2, y + 26, {
        size: 12, color: '#ff5fa2', align: 'center', weight: 800,
      });
      ui.text(evo.icon || '✦', x + cw / 2, y + 84, { size: 52, align: 'center' });
      ui.text(ellipsize(r, evo.name, cw - 26, 19, 800), x + cw / 2, y + 140, {
        size: fitSize(r, evo.name, cw - 26, 19, 800), color: PALETTE.accent,
        align: 'center', weight: 800,
      });
      const lines = wrapText(r, evo.desc, cw - 30, 13, 600);
      for (let i = 0; i < lines.length; i++) {
        ui.text(lines[i], x + cw / 2, y + 176 + i * 17, {
          size: 13, color: PALETTE.text, align: 'center', weight: 600,
        });
      }
      const up = run.data.upgrades.UPGRADES_BY_ID[evo.requires.upgrade];
      const rel = run.data.relics.RELICS_BY_ID[evo.requires.relic];
      ui.text(`${up.name} (MAX) + ${displayName(rel)}`, x + cw / 2, y + CARD_H - 24, {
        size: 11, color: PALETTE.textFaint, align: 'center',
      });
      if (ui.button('card' + index, x, y, cw, CARD_H, '', { radius: 12, invisible: true })) {
        run.chooseUpgrade(index);
      }
      return;
    }

    if (choice.kind === 'gold') {
      ui.card(x, y, cw, CARD_H, 3, { focused });
      ui.text('⭐', x + cw / 2, y + 110, { size: 60, align: 'center' });
      ui.text('+' + choice.amount + ' GOLD', x + cw / 2, y + 180, {
        size: 20, color: PALETTE.gold, align: 'center', weight: 800,
      });
      ui.text('Everything else is maxed. Take the money.', x + cw / 2, y + 212, {
        size: 12, color: PALETTE.textDim, align: 'center',
      });
      if (ui.button('card' + index, x, y, cw, CARD_H, '', { radius: 12, invisible: true })) run.chooseUpgrade(index);
      return;
    }

    this._passiveCard(r, run, choice, x, y, cw, CARD_H, index, focused);
  }

  /**
   * A PASSIVE (stat) card. Built around ONE BIG NUMBER, with the icon inline
   * beside the name rather than centred — so at a glance, before any text is
   * read, this is visibly not a weapon.
   */
  _passiveCard(r, run, choice, x, y, w, h, index, focused) {
    const up = choice.up;
    const level = choice.level;
    const isNew = level === 1;
    const rarity = up.tier === 'epic' ? 5 : up.tier === 'rare' ? 4 : 3;
    const col = RARITY_COLOR[rarity];
    const bucket = run.data.upgrades.BUILD_SLOTS.bucketOf(up);
    const slots = run.buildSlots();

    ui.panel(x, y, w, h, {
      color: 'rgba(24,29,46,0.97)', borderColor: focused ? PALETTE.borderHot : col,
      borderWidth: focused ? 3 : 1.5, radius: 14,
    });

    // Header: type + bucket, quiet, left-aligned. No ribbon — that is the
    // weapon card's signature and must not be borrowed here.
    ui.text('PASSIVE · ' + (bucket === 'offensive' ? 'ATTACK' : 'UTILITY'), x + 16, y + 20, {
      size: 10, color: PALETTE.textFaint, weight: 800, mono: true,
    });
    ui.text(isNew ? 'NEW' : `Lv ${level}/${up.maxLevel}`, x + w - 16, y + 20, {
      size: 10, color: isNew ? '#7bf59a' : PALETTE.textFaint,
      weight: 800, mono: true, align: 'right',
    });

    // Icon inline with the name.
    ui.text(up.icon || '◆', x + 30, y + 52, { size: 26, align: 'center', baseline: 'middle' });
    const nm = ellipsize(r, up.name, w - 62, 19, 800);
    ui.text(nm, x + 52, y + 52, {
      size: fitSize(r, up.name, w - 62, 19, 800), color: col, weight: 800, baseline: 'middle',
    });

    // THE NUMBER. SECTION 10's rule: never "increases damage" — the per-level
    // value and the running total, always, both computed from the data.
    const thisLevel = formatValue(up, up.perLevel);
    const total = formatValue(up, up.perLevel * level);
    r.drawRect(x + 16, y + 74, w - 32, 1, 'rgba(150,170,225,0.22)', 1);
    ui.text(thisLevel, x + w / 2, y + 106, {
      size: fitSize(r, thisLevel, w - 30, 26, 800), color: PALETTE.text,
      align: 'center', weight: 800,
    });
    if (level > 1) {
      const totalTxt = `now ${total} total`;
      ui.text(totalTxt, x + w / 2, y + 132, {
        size: fitSize(r, totalTxt, w - 30, 13, 700), color: PALETTE.accent,
        align: 'center', weight: 700,
      });
    }

    // WHAT IT DOES, in plain words. This replaced the flavour joke that used to
    // sit here: a card that made you laugh and left you unsure what you had
    // just taken was failing at its only job. The joke lives in the Codex.
    const lines = wrapText(r, up.desc || up.codex || '', w - 32, 13, 600);
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      ui.text(lines[i], x + w / 2, y + 166 + i * 17, {
        size: 13, color: PALETTE.textDim, align: 'center', weight: 600,
      });
    }

    // level pips
    const pipW = Math.min(12, (w - 40) / up.maxLevel);
    const pipY = y + h - 46;
    const pipX = x + w / 2 - (up.maxLevel * pipW) / 2;
    for (let i = 0; i < up.maxLevel; i++) {
      r.drawRect(pipX + i * pipW + 2, pipY, pipW - 4, 5,
                 i < level ? col : 'rgba(255,255,255,0.14)', 1);
    }
    const used = slots.used[bucket] + (isNew ? 1 : 0);
    ui.text(`${bucket === 'offensive' ? 'ATTACK' : 'UTILITY'} SLOT ${used}/${slots.max[bucket]}`,
            x + w / 2, y + h - 28, {
      size: 10, color: used >= slots.max[bucket] ? '#ffd23f' : PALETTE.textFaint,
      align: 'center', weight: 800, mono: true,
    });
    ui.text('[' + (index + 1) + ']', x + w / 2, y + h - 13, {
      size: 11, color: PALETTE.textFaint, align: 'center', mono: true,
    });

    if (ui.button('card' + index, x, y, w, h, '', { radius: 14, invisible: true })) {
      run.chooseUpgrade(index);
    }
  }

  /**
   * A WEAPON card. Deliberately nothing like the passive card:
   *
   *   - wider, and squared off rather than rounded
   *   - a solid TYPE RIBBON across the top, in the weapon's own colour
   *   - a coloured rail down the left edge
   *   - the icon inside its own framed plate
   *   - a BEFORE -> AFTER stat table, so "what does this level actually do"
   *     is answered with numbers rather than adjectives
   *
   * Handles all three weapon kinds — level, new, and evolve — because they are
   * the same object at three points in its life and should read that way.
   */
  _weaponCard(r, run, choice, x, y, w, h, index, focused) {
    const kind = choice.kind;
    const ws = run.weapons;
    const isNew = kind === 'newWeapon';
    const isEvo = kind === 'weaponEvo';
    const wpn = choice.w || null;
    const def = isNew ? choice.def : (wpn.def || null);
    const sig = !isNew && wpn.signature;

    const tier = def ? def.tier : 'epic';
    const rarity = isEvo ? 6 : sig ? 5 : tier === 'epic' ? 5 : tier === 'rare' ? 4 : 3;
    const col = isEvo ? '#ffd76a' : sig ? '#ffd76a' : RARITY_COLOR[rarity];

    const ribbon = isEvo ? 'EVOLVE THIS WEAPON'
                 : isNew ? 'NEW WEAPON'
                 : sig ? 'SIGNATURE ATTACK' : 'WEAPON';
    const name = isEvo ? choice.evo.name
               : isNew ? def.name
               : ws.nameOf(wpn).split(' [')[0];
    const icon = isEvo ? (choice.evo.icon || '♾')
               : isNew ? (def.icon || '⚔') : ws.iconOf(wpn);

    // --- plate: square, dark, with a rail ------------------------------------
    r.drawRect(x, y, w, h, 'rgba(13,17,29,0.98)', 1);
    r.strokeRect(x, y, w, h, focused ? PALETTE.borderHot : col, focused ? 3 : 2, 1);
    r.drawRect(x, y, 7, h, col, focused ? 1 : 0.85);          // the rail

    // --- ribbon ---------------------------------------------------------------
    const rh = 30;
    r.drawRect(x + 7, y, w - 7, rh, col, 1);
    ui.text(ribbon, x + 7 + (w - 7) / 2, y + rh / 2 + 1, {
      size: 12, color: '#0d111d', align: 'center', baseline: 'middle', weight: 800, mono: true,
    });

    // --- icon plate -----------------------------------------------------------
    const ps = 62;
    const px2 = x + 20, py = y + rh + 14;
    r.drawRect(px2, py, ps, ps, 'rgba(255,255,255,0.05)', 1);
    r.strokeRect(px2, py, ps, ps, col, 1.5, 0.7);
    ui.text(icon, px2 + ps / 2, py + ps / 2, { size: 34, align: 'center', baseline: 'middle' });

    // --- name + level ---------------------------------------------------------
    const tx = px2 + ps + 14;
    const tw = w - (tx - x) - 18;
    ui.text(ellipsize(r, name, tw, 20, 800), tx, py + 16, {
      size: fitSize(r, name, tw, 20, 800), color: col, weight: 800, baseline: 'middle',
    });
    if (isEvo) {
      ui.text('ALWAYS ACTIVE', tx, py + 40, { size: 12, color: '#7bf59a', weight: 800 });
    } else if (isNew) {
      const used = ws.count, max = ws.max;
      ui.text(`TAKES SLOT ${used + 1} / ${max}`, tx, py + 40, {
        size: 12, color: used + 1 >= max ? '#ffd23f' : PALETTE.accent2, weight: 800, mono: true,
      });
    } else {
      const maxL = ws.maxLevel(wpn);
      ui.text(`Lv ${wpn.level}  →  Lv ${choice.level}   of ${maxL}`, tx, py + 40, {
        size: 12, color: PALETTE.text, weight: 800, mono: true,
      });
    }

    // --- what changes ---------------------------------------------------------
    let cy = y + rh + ps + 26;
    r.drawRect(x + 16, cy - 8, w - 32, 1, 'rgba(150,170,225,0.22)', 1);
    ui.text(isNew || isEvo ? 'WHAT IT DOES' : 'WHAT THIS LEVEL CHANGES', x + 16, cy + 6, {
      size: 10, color: PALETTE.textFaint, weight: 800, mono: true,
    });
    cy += 22;
    const blurb = isEvo ? choice.evo.desc
                : isNew ? def.desc
                : weaponLevelNote(run, wpn, choice.level);
    const lines = wrapText(r, blurb || '', w - 32, 13, 600);
    for (let i = 0; i < Math.min(4, lines.length); i++) {
      ui.text(lines[i], x + 16, cy + i * 17, { size: 13, color: PALETTE.text, weight: 600 });
      cy += 0;
    }
    cy += Math.min(4, lines.length) * 17 + 8;

    // --- the stat table -------------------------------------------------------
    const rows = weaponStatRows(run, choice);
    for (let i = 0; i < rows.length && cy < y + h - 52; i++) {
      const row = rows[i];
      ui.text(row.label, x + 16, cy, { size: 11, color: PALETTE.textFaint, weight: 700 });
      if (row.from !== undefined && row.from !== row.to) {
        ui.text(row.from, x + w - 74, cy, {
          size: 11, color: PALETTE.textFaint, align: 'right', weight: 700, mono: true,
        });
        ui.text('→', x + w - 66, cy, { size: 11, color: PALETTE.textFaint, weight: 700 });
      }
      ui.text(row.to, x + w - 16, cy, {
        size: 12, color: row.better ? '#7bf59a' : PALETTE.text,
        align: 'right', weight: 800, mono: true,
      });
      cy += 16;
    }

    // --- footer ---------------------------------------------------------------
    if (!isNew && !isEvo) {
      const maxL = ws.maxLevel(wpn);
      const pipW = Math.min(16, (w - 40) / maxL);
      const pipX = x + w / 2 - (maxL * pipW) / 2;
      for (let i = 0; i < maxL; i++) {
        r.drawRect(pipX + i * pipW + 2, y + h - 44, pipW - 4, 6,
                   i < choice.level ? col : 'rgba(255,255,255,0.14)', 1);
      }
      if (choice.level >= maxL) {
        ui.text('next pick: EVOLUTION', x + w / 2, y + h - 28, {
          size: 11, color: '#ffd76a', align: 'center', weight: 800,
        });
      } else {
        ui.text(`WEAPON SLOT · ${ws.count}/${ws.max} used`, x + w / 2, y + h - 28, {
          size: 10, color: PALETTE.textFaint, align: 'center', weight: 800, mono: true,
        });
      }
    } else if (isEvo) {
      ui.text(ws.nameOf(wpn).split(' [')[0] + ' is MAXED', x + w / 2, y + h - 28, {
        size: 11, color: PALETTE.textFaint, align: 'center', weight: 700,
      });
    }
    ui.text('[' + (index + 1) + ']', x + w / 2, y + h - 13, {
      size: 11, color: PALETTE.textFaint, align: 'center', mono: true,
    });

    if (rarity >= 5 || focused) ui.brackets(x, y, w, h, focused ? PALETTE.borderHot : col, 18, 3);

    if (ui.button('card' + index, x, y, w, h, '', { radius: 2, invisible: true })) {
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

/** The authored one-liner for a specific weapon level. */
function weaponLevelNote(run, w, level) {
  const rows = w.signature ? run.data.weapons.SIGNATURE_LEVELS : w.def.levels;
  const row = rows[level - 1];
  return row ? row.note : '';
}

/**
 * BEFORE -> AFTER for a weapon card.
 *
 * A level note says "a SECOND slash follows the first", which is the right
 * headline — but the player also wants to know it went from 15 to 20 damage and
 * from 1.30s to 1.10s. Adjectives sell it; numbers let you compare it against
 * the card next to it. Both, always.
 *
 * The signature's rows are MULTIPLIERS on the character's own attack rather
 * than absolute numbers, so it gets its own labels and an x prefix — showing
 * "0.75" as if it were 0.75 damage would be a lie.
 */
const SIG_FIELDS = [
  { key: 'damage', label: 'Damage', mult: true },
  { key: 'rate', label: 'Swing rate', mult: true },
  { key: 'area', label: 'Attack size', mult: true },
  { key: 'count', label: 'Extra strikes', plus: true },
  { key: 'pierce', label: 'Extra pierce', plus: true },
];
const WEAPON_FIELDS = [
  { key: 'damage', label: 'Damage' },
  { key: 'interval', label: 'Fires every', seconds: true, lowerIsBetter: true },
  { key: 'radius', label: 'Reach' },
  { key: 'blast', label: 'Blast radius' },
  { key: 'range', label: 'Target range' },
  { key: 'count', label: 'Count' },
  { key: 'pierce', label: 'Pierce' },
  { key: 'burn', label: 'Burn damage' },
  { key: 'slow', label: 'Slow', percent: true },
];

function fmtStat(f, v) {
  if (v === undefined || v === null) return null;
  if (f.mult) return 'x' + (Math.round(v * 100) / 100).toFixed(2);
  if (f.plus) return '+' + v;
  if (f.seconds) return (Math.round(v * 100) / 100).toFixed(2) + 's';
  if (f.percent) return Math.round(v * 100) + '%';
  return String(Math.round(v * 10) / 10);
}

function weaponStatRows(run, choice) {
  const out = [];
  const W = run.data.weapons;
  let fields, from = null, to = null;

  if (choice.kind === 'newWeapon') {
    fields = WEAPON_FIELDS; to = choice.def.levels[0];
  } else if (choice.kind === 'weaponEvo') {
    const w = choice.w;
    fields = w.signature ? SIG_FIELDS : WEAPON_FIELDS;
    const rows = w.signature ? W.SIGNATURE_LEVELS : w.def.levels;
    from = rows[rows.length - 1];
    to = w.signature ? W.SIGNATURE_EVOLUTION.stats : w.def.evolution.stats;
  } else {
    const w = choice.w;
    fields = w.signature ? SIG_FIELDS : WEAPON_FIELDS;
    const rows = w.signature ? W.SIGNATURE_LEVELS : w.def.levels;
    from = rows[choice.level - 2] || null;
    to = rows[choice.level - 1];
  }
  if (!to) return out;

  for (const f of fields) {
    const tv = to[f.key];
    if (tv === undefined) continue;
    const fv = from ? from[f.key] : undefined;
    const ft = fmtStat(f, fv);
    const tt = fmtStat(f, tv);
    if (tt === null) continue;
    if (ft !== null && ft === tt) continue;          // unchanged: do not list it
    out.push({
      label: f.label,
      from: ft === null ? undefined : ft,
      to: tt,
      better: fv === undefined ? true : (f.lowerIsBetter ? tv < fv : tv > fv),
    });
    if (out.length >= 5) break;
  }
  return out;
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
