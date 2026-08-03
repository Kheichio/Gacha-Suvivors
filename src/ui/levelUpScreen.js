// The level-up card screen, the chest reveal, the relic-swap prompt, the altar,
// and the pause menu. Everything that freezes the sim mid-run lives here.
//
// SECTION 10's rule governs the card text: "Never write 'increases damage' —
// write '+12% damage (now +36% total)'." Every card here computes both numbers
// from the data, so a card can never drift from what it actually grants.

import { ui, PALETTE, RARITY_COLOR, RARITY_NAME, wrapText, fitSize, ellipsize } from './widgets.js';
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

    // THE CADENCE HAS TO BE VISIBLE OR IT READS AS THE GAME BEING BROKEN.
    //
    // Weapons used to be on two of the three cards. They are now on one screen
    // in three (WEAPON_OFFERS in data/upgrades.js), and a player who does not
    // know that is a player watching stat card after stat card go by, deciding
    // the weapon pool has bugged out. So the screen says when the next one is
    // due — and says nothing at all on the screens that are carrying one,
    // because a weapon card announces itself perfectly well.
    const wait = weaponOfferWait(run, choices);
    if (wait > 0) {
      ui.text(`next weapon offer in ${wait} ${wait === 1 ? 'level' : 'levels'}`,
              W / 2, H * 0.17 + 54, {
        size: 12, color: PALETTE.accent2, align: 'center', weight: 800, mono: true,
      });
    }
    // And the second clock: WHEN THE RACK MAY GET WIDER. See arsenalUnlockWait.
    const slotWait = arsenalUnlockWait(run);
    if (slotWait > 0) {
      ui.text(`weapon slot ${run.weapons.count + 1} unlocks in ${slotWait} ` +
              `${slotWait === 1 ? 'level' : 'levels'}`, W / 2, H * 0.17 + 71, {
        size: 11, color: PALETTE.textFaint, align: 'center', weight: 800, mono: true,
      });
    }

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

    // reroll / skip. TWO buttons and one 12px gap, and the row is centred on
    // exactly that width — `bw * 2 + 12`.
    //
    // There was a third, BANISH, and it is worth saying why it is gone rather
    // than leaving a hole here for someone to "fix" by putting it back. It read
    // `run.banishUpgrade(ui.focus)`, and `ui.focus` is the FLAT WIDGET INDEX, not
    // a card index — widgets.js sets it to the hovered widget and requires
    // `focus === idx` to fire at all, so at the instant the banish button
    // activated, focus was by definition the banish button's own index (4 on a
    // three-card screen). `levelUpChoices[4]` is undefined, so banishUpgrade()
    // bailed on its `if (!id) return false` every single time and nothing was
    // ever removed from any pool. The screen still replayed the card fly-in, so
    // it looked like it had done something. There was no way to point at a card
    // to banish it, because the button being pressed is what focus is.
    const by = y + CARD_H + 26;
    const bw = 150;
    const bx = W / 2 - (bw * 2 + 12) / 2;
    if (ui.button('reroll', bx, by, bw, 40, `REROLL (${run.rerollsLeft})`,
                  { disabled: run.rerollsLeft <= 0, size: 14 })) {
      run.rerollUpgrades();
      this.t = 0;
    }
    if (ui.button('skip', bx + bw + 12, by, bw, 40,
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
    //
    // Both used to be `up.perLevel` and `up.perLevel * level` inline. That was
    // right while every row paid the same amount every time and became a LIE the
    // moment the healing rows started ramping: a level-8 Second Wind card would
    // have shouted "+0.2 HP/s (now +1.6 total)" at a player who was actually
    // being handed +1.2 and ending on 5.6. Nothing would have caught it —
    // tests/suites.js only asserts a digit appears — so the card asks the data
    // what this level gives (deltaAt) and what the player will hold (totalAt)
    // instead of doing the arithmetic itself.
    const U = run.data.upgrades;
    const thisLevel = formatValue(up, U.deltaAt(up, level));
    const total = formatValue(up, U.totalAt(up, level), true);
    r.drawRect(x + 16, y + 74, w - 32, 1, 'rgba(150,170,225,0.22)', 1);
    ui.text(thisLevel, x + w / 2, y + 106, {
      size: fitSize(r, thisLevel, w - 30, 26, 800), color: PALETTE.text,
      align: 'center', weight: 800,
    });
    if (level > 1) {
      const totalTxt = `now ${total}`;
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
        // THIS USED TO SAY 'next pick: EVOLUTION', WHICH IS A PROMISE THE GAME
        // DOES NOT KEEP. Maxing a weapon is half the recipe; the other half is
        // the generic upgrade named in `evolution.requires`. A player told the
        // evolution is one pick away and then never shown an evolve card decides
        // the feature is broken — and a player who happens to be holding the
        // upgrade already decides that MAX LEVEL ALONE evolves a weapon, which
        // is exactly the bug that gets reported. Print the fee instead; evoHint()
        // owns which of the two sentences applies.
        const hint = ws.evoHint(wpn);
        ui.text(hint || 'next pick: EVOLUTION', x + w / 2, y + h - 28, {
          size: 11, color: ws.evoReady(wpn) ? '#ffd76a' : PALETTE.textFaint,
          align: 'center', weight: 800, mono: true,
        });
      } else {
        ui.text(`WEAPON SLOT · ${ws.count}/${ws.max} used`, x + w / 2, y + h - 28, {
          size: 10, color: PALETTE.textFaint, align: 'center', weight: 800, mono: true,
        });
      }
    } else if (isEvo) {
      // The card the player waited a whole run for should say what BOUGHT it, or
      // the entry fee stays invisible in the one moment it is being collected —
      // which is how "I evolved a weapon by maxing it" becomes the player's
      // model of the system.
      const req = ws.evoRequirement(wpn);
      const rup = ws.evoUpgradeOf(req);
      ui.text(req ? 'MAXED  +  ' + (rup ? rup.name : req.upgrade) + ' ' + req.level
                  : ws.nameOf(wpn).split(' [')[0] + ' is MAXED',
              x + w / 2, y + h - 28, {
        size: 11, color: PALETTE.textFaint, align: 'center', weight: 700, mono: true,
      });
    } else {
      // A weapon you do not own yet is where the fee matters MOST: it is the last
      // moment the player can decline to buy into an upgrade they were never
      // going to take. evoRequirementOf() exists for exactly this card — it reads
      // the fee off a DEFINITION, because a weapon being offered for the first
      // time has no slot record yet.
      const newHint = ws.evoHintOf(ws.evoRequirementOf(def));
      if (newHint) {
        ui.text(newHint, x + w / 2, y + h - 28, {
          size: 11, color: PALETTE.textFaint, align: 'center', weight: 700, mono: true,
        });
      }
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

    /**
     * THE PACHINKO PARLOUR'S PAYOUT — the once-a-run find on Akihabara.
     *
     * Two buttons, both of them real, and the whole design is that neither is
     * the obvious one: the cash is worth more the earlier you find it and the
     * prize is worth more the later, and nothing on this screen tells the
     * player which side of that line they are on.
     *
     * BOTH OPTIONS PRINT WHAT THEY ACTUALLY ARE. "A free weapon" is not an
     * offer you can weigh against a number — Run rolls the prize BEFORE this
     * screen opens (openPachinko) precisely so the button can name it. When
     * the roll came back empty — every slot full and every weapon maxed — the
     * button says so and is disabled, rather than sitting there live and
     * quietly eating the reward.
     */
    if (res.kind === 'pachinko') {
      ui.title('🎰  PACHINKO', W / 2, H * 0.22, { size: 40, align: 'center', color: PALETTE.gold });
      ui.text('The tray is full and the attendant is not looking. One payout.',
              W / 2, H * 0.22 + 36, { size: 15, color: PALETTE.textDim, align: 'center' });
      ui.focusGrid(2);
      const bw2 = 300, bh2 = 104, gap2 = 16;
      const bx2 = W / 2 - bw2 - gap2 / 2;
      const cashSub = res.fragments ? res.gold + ' ⭐  +  ' + res.fragments + ' ✦'
                                    : res.gold + ' ⭐';
      if (ui.button('pachiCash', bx2, H * 0.44, bw2, bh2, 'CASH OUT',
                    { size: 20, sub: cashSub })) {
        run.usePachinko('cash');
      }
      const has = !!res.prizeName;
      if (ui.button('pachiPrize', bx2 + bw2 + gap2, H * 0.44, bw2, bh2,
                    has ? res.prizeIcon + '  ' + res.prizeName : 'NO PRIZE LEFT',
                    { size: 20, sub: has ? res.prizeSub : 'every slot full, every weapon maxed',
                      disabled: !has })) {
        run.usePachinko('prize');
      }
      ui.text('It pays out once. Choose.', W / 2, H * 0.44 + bh2 + 34,
              { size: 13, color: PALETTE.textFaint, align: 'center' });
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
      // WHICH level this row actually granted. The chest applies every upgrade
      // before this screen is drawn, so the player's current level IS the level
      // this row paid — minus however many copies of the same upgrade come later
      // in the list, because a chest can grant the same card twice in one open.
      // (Weapon and evolution rows are chestRow() objects with no `id` and a
      // pre-resolved `fmt`; they fall through to the level-0/perLevel path and
      // print the line they were built with.)
      let laterCopies = 0;
      for (let j = i + 1; j < granted.length; j++) if (up.id && granted[j].id === up.id) laterCopies++;
      const lv = up.id ? Math.max(1, run.player.upgradeLevel(up.id) - laterCopies) : 0;
      ui.text(formatValue(up, lv > 0 ? run.data.upgrades.deltaAt(up, lv) : up.perLevel),
              x + 56, y + 48, { size: 13, color: PALETTE.text });
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

    // THE CHARACTER SHEET owns the left edge, and it is laid out FIRST because
    // everything under this line is centred in whatever is left over. It returns
    // 0 when the viewport cannot carry both, and then this screen is laid out
    // exactly as it always was.
    const sheetR = this._pauseSheet(r, run);
    const cx = sheetR > 0 ? sheetR + (W - sheetR) / 2 : W / 2;

    ui.title('PAUSED', cx, H * 0.16, { size: 44, align: 'center' });

    const p = run.player;
    const colW = 460;

    // YOUR ARSENAL. Same reasoning as the evolution recipes below it: a weapon
    // you cannot see the level of is a weapon you cannot plan around, and the
    // "this one is maxed, take the evolve card" moment has to be legible before
    // the card shows up rather than after.
    ui.text('WEAPONS  ' + run.weapons.count + ' / ' + run.weapons.max,
            cx, H * 0.20, { size: 14, color: PALETTE.accent2, align: 'center', weight: 800 });
    let wy = H * 0.24;
    for (const w of run.weapons.slots) {
      const maxL = run.weapons.maxLevel(w);
      const done = w.evolved;
      const maxed = run.weapons.isMaxed(w);
      // MAXED IS HALF THE RECIPE, AND THIS ROW USED TO PROMISE THE WHOLE THING.
      // `ready` was `isMaxed(w)` alone, so a weapon sitting at level 8 with its
      // required upgrade untouched was told it could evolve, in green, on the
      // one screen a player opens specifically to ask that question. It cannot,
      // and it will sit there for the rest of the run.
      const need = run.weapons.evoNeed(w);
      const ready = maxed && run.weapons.evoReady(w);
      const col = done ? '#ffd76a' : ready ? '#7bf59a' : maxed ? '#ffd23f' : PALETTE.text;
      const tail = done ? 'EVOLVED'
                 : ready ? 'MAX — can evolve into ' + run.weapons.evolutionOf(w).name
                 : maxed ? 'MAX — needs ' + need
                 : 'Lv ' + w.level + ' / ' + maxL + (need ? '   needs ' + need : '');
      ui.text(`${run.weapons.iconOf(w)}  ${run.weapons.nameOf(w).split(' [')[0]}`,
              cx - colW / 2, wy, { size: 13, color: col, weight: 700 });
      ui.text(tail, cx + colW / 2, wy, { size: 12, color: col, align: 'right' });
      wy += 19;
    }
    for (let i = run.weapons.count; i < run.weapons.max; i++) {
      ui.text('·  empty weapon slot', cx - colW / 2, wy,
              { size: 13, color: PALETTE.textFaint });
      wy += 19;
    }

    // Evolution recipes live here. SECTION 10: "A hidden recipe is a wasted recipe."
    const hints = run.data.evolutions.EVOLUTION_HINTS;
    ui.text('EVOLUTIONS', cx, wy + 14, { size: 14, color: PALETTE.accent, align: 'center', weight: 800 });
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
              cx - colW / 2, y, { size: 13, color });
      y += 20;
    }

    const bw = 260, bh = 46;
    const bx = cx - bw / 2;
    // THE THREE BUTTONS MUST BE ON THE SCREEN. The column above them grows with
    // the arsenal (5 rows) and the evolution list (8 rows), so the buttons start
    // at 0.24H + 289 and ABANDON RUN ends at 0.24H + 463 — which on a 600px
    // viewport is y=617, off the bottom, on the only way out of a run that does
    // not involve dying. Clamped DOWNWARD only, so every viewport that already
    // fitted (H >= 649) is pixel-for-pixel untouched.
    let by = Math.min(y + 26, H - 40 - (bh * 3 + 20));
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

    ui.text('ESC to resume', cx, H - 30, { size: 12, color: PALETTE.textFaint, align: 'center' });
    ui.end();
  }

  // --- the pause character sheet ------------------------------------------------
  /**
   * EVERYTHING ABOUT THE CHARACTER YOU ARE PLAYING, down the left edge.
   *
   * The middle column of this screen is about the RUN — the arsenal you built,
   * the recipes still open to you. Nothing on it was ever about the CHARACTER,
   * and four minutes in there is no way to find out what your special actually
   * does, what its cooldown really is after every modifier, or whether the S5
   * you paid for has unlocked, short of abandoning the run for the Codex. TAB
   * answers the live stats and the build; it has never answered the kit.
   *
   * Returns the x the menu column may start from — this panel's right edge plus
   * a gutter — or 0 when the viewport cannot carry both, in which case nothing
   * is drawn at all and the menu centres on the screen exactly as it used to.
   *
   * GEOMETRY IS SCALED BY HAND; TEXT SIZES ARE NOT. `ui.text` multiplies every
   * size by `ui.scale` itself, so a size passed here as `12 * s` would render at
   * 12 * s * s and outgrow a panel that only grew by s. Same rule as
   * runScene._eventBanner; do not "fix" it to match the surrounding style.
   */
  _pauseSheet(r, run) {
    const p = run.player;
    const W = r.w, H = r.h;
    const s = ui.scale || 1;
    const M = 14;
    const PAD = Math.round(14 * s);
    const GUT = Math.round(20 * s);

    // --- how wide, and whether at all ----------------------------------------
    // The menu beside this is a 460px column and wants air on both sides. The
    // sheet takes what is left, between a width it stops being readable under
    // and one past which it is only a wider margin.
    const MENU_NEED = 460 + 56;
    let w = clamp(Math.round(W * 0.30), Math.round(214 * s), Math.round(360 * s));
    const room = W - M - GUT - MENU_NEED;
    if (w > room) w = room;
    if (w < Math.round(196 * s)) return 0;
    const x = M;
    const iw = w - PAD * 2;

    // --- the metrics every block is measured AND drawn with ------------------
    const TOP  = Math.round(15 * s);   // panel top + PAD -> the first baseline
    const NAME = Math.round(22 * s);
    const SUB  = Math.round(16 * s);
    const TAG  = Math.round(15 * s);
    const HEAD = Math.round(20 * s);   // a section label, its rule and the gap
    const ROW  = Math.round(15 * s);   // one stat row
    const TTL  = Math.round(16 * s);   // an ability's name line
    const MET  = Math.round(13 * s);   // an ability's numbers line
    const LN   = Math.round(13 * s);   // one wrapped description line
    const GAP  = Math.round(7 * s);
    const TAGW = Math.round(52 * s);   // the AUTO/SPECIAL/ESCAPE/PASSIVE gutter
    const ELW  = Math.round(96 * s);   // reserved for the element, right-aligned
    const IND  = Math.round(14 * s);   // the star rows hang off their mark

    // --- what the four pillars say -------------------------------------------
    const auto = p.def.autoAttack, sp = p.def.special, es = p.def.escape;
    // The auto-attack's REAL interval, by the same arithmetic run.js does every
    // tick — attack speed, the flag bonus, and the signature weapon's rate — so
    // this can never drift from what the character is actually doing.
    const eff = Math.max(0.05, auto.interval /
      (p.stats.attackSpeedMult * (p.flags.attackSpeedBonus || 1) * run.weapons.mods.rate));
    KIT[0].def = auto;
    KIT[0].meta = `every ${eff.toFixed(2)}s  ·  ${auto.damage} dmg  ·  base ${auto.interval.toFixed(2)}s` +
                  `  ·  ${(auto.targeting && auto.targeting.mode) || 'nearest'}`;
    KIT[1].def = sp;
    KIT[1].meta = (p.special.ready ? 'READY' : p.special.remaining.toFixed(1) + 's') +
                  `  ·  cd ${p.special.duration.toFixed(1)}s  ·  base ${sp.cooldown}s` +
                  (p.special.maxCharges > 1 ? `  ·  ${p.special.charges}/${p.special.maxCharges}` : '');
    KIT[2].def = es;
    KIT[2].meta = (p.escape.ready ? 'READY' : p.escape.remaining.toFixed(1) + 's') +
                  `  ·  cd ${p.escape.duration.toFixed(1)}s  ·  ${(es.iframes || 0).toFixed(1)}s i-frames` +
                  (p.escape.maxCharges > 1 ? `  ·  ${p.escape.charges}/${p.escape.maxCharges}` : '');
    KIT[3].def = p.def.passive;
    KIT[3].meta = 'always on';
    for (const e of KIT) e.lines = wrapText(r, (e.def && e.def.desc) || '', iw, 11, 600);

    const su = p.def.starUpgrades || NO_STARS;
    const s3 = wrapText(r, su.s3 || '—', iw - IND, 11, 600);
    const s5 = wrapText(r, su.s5 || '—', iw - IND, 11, 600);

    // --- fit ------------------------------------------------------------------
    const headerH = TOP + NAME + SUB + TAG + GAP;
    const statsH = HEAD + 6 * ROW + GAP;
    const totalFor = (n) => {
      let t = PAD * 2 + headerH + statsH + HEAD;
      for (const e of KIT) t += TTL + MET + Math.min(n, e.lines.length) * LN + GAP;
      t += GAP + HEAD;
      t += TTL + Math.min(n, s3.length) * LN + GAP;
      t += TTL + Math.min(n, s5.length) * LN + GAP;
      return t;
    };
    // ONE KNOB ABSORBS EVERY VIEWPORT: how many lines of a description survive.
    // Everything else here is a fixed number of rows, so the descriptions are
    // the only thing that can give — and a truncated line that SAYS it was
    // truncated is worth more than a sheet that runs off its own panel.
    let dm = 6;
    const availH = H - 16;
    while (dm > 1 && totalFor(dm) > availH) dm--;
    const h = Math.min(totalFor(dm), availH);
    const y = Math.round((H - h) / 2);

    // --- draw -----------------------------------------------------------------
    const rar = RARITY_COLOR[p.def.rarity] || PALETTE.border;
    ui.panel(x, y, w, h, {
      radius: 8, color: 'rgba(12,16,28,0.97)', borderColor: rar, borderWidth: 2,
    });
    // The one viewport short enough to defeat even a one-line description loses
    // the bottom of the sheet rather than painting over the menu beside it.
    r.clipRect(x, y, w, h);

    const tx = x + PAD;
    let yy = y + PAD + TOP;

    const nm = displayName(p.def).split(' [')[0];
    ui.text(ellipsize(r, nm, iw, 20, 800), tx, yy, {
      size: fitSize(r, nm, iw, 20, 800), color: rar, weight: 800, display: true,
    });
    yy += NAME;
    ui.text(ellipsize(r, p.def.epithet || '', iw, 12, 600), tx, yy,
            { size: 12, color: PALETTE.accent });
    yy += SUB;
    const tags = `${RARITY_NAME[p.def.rarity] || ''}  ·  S${p.starLevel}  ·  ${p.def.archetype}`;
    ui.text(ellipsize(r, tags, iw - ELW, 11, 700), tx, yy,
            { size: 11, color: PALETTE.textDim, weight: 700 });
    const el = run.data.elements.ELEMENTS[p.def.element];
    ui.text(el ? el.icon + ' ' + el.name.toUpperCase() : String(p.def.element || ''),
            tx + iw, yy, {
      size: 11, color: el ? el.color : PALETTE.textFaint,
      weight: 800, mono: true, align: 'right',
    });
    yy += TAG + GAP;

    // --- live stats, two columns ----------------------------------------------
    // Twelve rows in one column is half the panel. Two columns of six is the
    // same information in half the height, and every label is short enough that
    // its value can still be right-aligned against the column edge.
    yy = this._sheetHead(r, 'LIVE STATS', tx, yy, iw, s);
    STATS[0][1] = Math.ceil(p.hp) + ' / ' + Math.round(p.maxHp);
    STATS[1][1] = p.stats.armor.toFixed(1);
    STATS[2][1] = p.stats.moveSpeed.toFixed(0) + ' px/s';
    STATS[3][1] = p.stats.pickupRadius.toFixed(0) + ' px';
    STATS[4][1] = 'x' + p.stats.damageMult.toFixed(2);
    STATS[5][1] = 'x' + (p.stats.damageMult * p.stats.autoDamageMult).toFixed(2);
    STATS[6][1] = 'x' + p.stats.attackSpeedMult.toFixed(2);
    STATS[7][1] = 'x' + p.stats.areaMult.toFixed(2);
    STATS[8][1] = (p.stats.critChance * 100).toFixed(1) + '%';
    STATS[9][1] = 'x' + p.stats.critMult.toFixed(2);
    STATS[10][1] = 'x' + p.stats.cooldownMult.toFixed(2);
    STATS[11][1] = p.stats.luck.toFixed(1);
    const cw = Math.round((iw - Math.round(16 * s)) / 2);
    for (let i = 0; i < STATS.length; i++) {
      ui.statRow(STATS[i][0], STATS[i][1], (i & 1) ? tx + iw - cw : tx,
                 yy + (i >> 1) * ROW, cw);
    }
    yy += 6 * ROW + GAP;

    // --- the kit --------------------------------------------------------------
    yy = this._sheetHead(r, 'KIT', tx, yy, iw, s, PALETTE.accent2);
    for (const e of KIT) {
      ui.text(e.tag, tx, yy, { size: 10, color: PALETTE.textFaint, weight: 800, mono: true });
      const an = displayName(e.def).split(' [')[0];
      ui.text(ellipsize(r, an, iw - TAGW, 13, 800), tx + TAGW, yy,
              { size: 13, color: e.color, weight: 800 });
      yy += TTL;
      ui.text(ellipsize(r, e.meta, iw, 11, 700), tx, yy,
              { size: 11, color: PALETTE.accent2, weight: 700, mono: true });
      yy += MET;
      yy = this._sheetLines(r, e.lines, dm, tx, yy, iw, LN, PALETTE.textDim) + GAP;
    }

    // --- the star upgrades, and whether this star level has them --------------
    yy += GAP;
    yy = this._sheetHead(r, 'STAR UPGRADES', tx, yy, iw, s, PALETTE.accent);
    yy = this._sheetStar(r, 'S3', s3, p.starLevel >= 3, dm, tx, yy, iw, IND, TTL, LN, GAP);
    this._sheetStar(r, 'S5', s5, p.starLevel >= 5, dm, tx, yy, iw, IND, TTL, LN, GAP);

    r.unclip();
    return x + w + GUT;
  }

  /** A section label and its hairline rule. Returns the next baseline. */
  _sheetHead(r, label, x, y, w, s, color) {
    ui.text(label, x, y, { size: 10, color: color || PALETTE.textFaint, weight: 800, mono: true });
    r.drawRect(x, y + Math.round(7 * s), w, 1, 'rgba(150,170,225,0.22)', 1);
    return y + Math.round(20 * s);
  }

  /**
   * The wrapped body of a description, capped at `max` lines. A cap that simply
   * stopped would read as a description that ends mid-sentence, so the last line
   * of a truncated one carries an ellipsis and the Codex holds the rest.
   */
  _sheetLines(r, lines, max, x, y, w, lh, color) {
    const n = Math.min(max, lines.length);
    for (let i = 0; i < n; i++) {
      const cut = i === n - 1 && n < lines.length;
      ui.text(cut ? ellipsize(r, lines[i] + ' …', w, 11, 600) : lines[i],
              x, y + i * lh, { size: 11, color, weight: 600 });
    }
    return y + n * lh;
  }

  /**
   * One star upgrade, and whether the star level you are PLAYING AT has it.
   * The thresholds are abilities/index.js's own: s3 at star >= 3, s5 at >= 5.
   */
  _sheetStar(r, label, lines, unlocked, max, x, y, w, ind, ttl, lh, gap) {
    ui.text((unlocked ? '✔  ' : '·  ') + label + (unlocked ? '   ACTIVE' : '   LOCKED'),
            x, y, {
      size: 11, color: unlocked ? PALETTE.good : PALETTE.textFaint,
      weight: 800, mono: true,
    });
    return this._sheetLines(r, lines, max, x + ind, y + ttl, w - ind, lh,
                            unlocked ? PALETTE.textDim : PALETTE.textFaint) + gap;
  }
}

/**
 * THE PAUSE SHEET'S SCRATCH RECORDS.
 *
 * The pause screen redraws every rendered frame it is up, and the rule the rest
 * of this project holds to is that a per-frame path does not allocate. The four
 * kit entries and the twelve stat rows are therefore ONE set of records,
 * rewritten in place on every use — every field that varies is written every
 * time, so nothing can survive from the frame before it. The wrapped
 * description arrays are the one thing that still allocates and they have to:
 * they depend on the panel width, which depends on the window.
 */
const KIT = [
  { tag: 'AUTO',    def: null, meta: '', lines: null, color: PALETTE.text },
  { tag: 'SPECIAL', def: null, meta: '', lines: null, color: PALETTE.pink },
  { tag: 'ESCAPE',  def: null, meta: '', lines: null, color: PALETTE.accent2 },
  { tag: 'PASSIVE', def: null, meta: '', lines: null, color: PALETTE.good },
];
const STATS = [
  ['HP', ''], ['Armour', ''], ['Speed', ''], ['Pickup', ''],
  ['Damage', ''], ['Auto dmg', ''], ['Atk spd', ''], ['Area', ''],
  ['Crit', ''], ['Crit dmg', ''], ['Cooldown', ''], ['Luck', ''],
];

/** A character that declared no star upgrades. All 25 declare both; belt and braces. */
const NO_STARS = {};

/**
 * HOW MANY MORE LEVEL-UPS UNTIL A WEAPON CAN BE OFFERED. 0 means "one is on
 * this screen right now".
 *
 * Reads the CARDS rather than predicting from the cadence alone, so it can
 * never claim a weapon is coming on a screen that is already carrying one, and
 * can never promise one that the roll declined to produce.
 *
 * DEPENDS ON `levelUpIndex` NAMING THE SCREEN ON DISPLAY, not the one after it.
 * That is now guaranteed — Run advances the counter when the screen is
 * dismissed, and the field's comment there explains why — but this arithmetic
 * is where a regression would surface first, as a hint that counts 2, 1, 3
 * instead of 2, 1, weapon.
 */
function weaponOfferWait(run, choices) {
  for (const c of choices) if (WEAPON_KINDS[c.kind]) return 0;
  const every = run.data.upgrades.WEAPON_OFFERS.everyNth;
  return every - ((run.levelUpIndex || 0) % every);
}

/**
 * HOW MANY MORE LEVEL-UPS UNTIL THE RACK MAY GET WIDER. -1 means "it may
 * already", which includes the case where there is nothing left to widen into.
 *
 * The weapon cadence and the arsenal budget are two different clocks and a
 * player who only sees the first one draws the wrong conclusion from it: they
 * are offered a weapon card every three levels, every one of those cards is a
 * LEVEL on something they already carry, and the obvious reading is that the
 * game has run out of weapons. It has not — it is holding the next slot back.
 * Say so, in the same place, in the same breath.
 *
 * Mirrors Run.mayExpandArsenal: the budget is `2 + floor(index / newEveryNth)`,
 * so it next exceeds the weapons held at index `(held - 1) * newEveryNth`.
 */
function arsenalUnlockWait(run) {
  const ws = run.weapons;
  if (ws.full || run.mayExpandArsenal()) return -1;
  const n = run.data.upgrades.WEAPON_OFFERS.newEveryNth;
  return Math.max(1, (ws.count - 1) * n - (run.levelUpIndex || 0));
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

/**
 * Renders an upgrade's value using its declared unit. `isTotal` picks the row's
 * `totalFmt` phrase over its `fmt` one.
 *
 * TWO DECLARED FIELDS WERE BEING READ BY NOTHING before the healing ramp, and
 * both are load-bearing now.
 *
 *   totalFmt   Every one of the 22 rows carries one, and upgrades.js documents
 *              the rendering as `"<fmt> (now <totalFmt>)"` — but this function
 *              only ever used `fmt`, so the running-total line read "now +36%
 *              damage total" instead of "now +36% total". Harmless while both
 *              said a number; actively wrong on a row like Phantom Step, whose
 *              totalFmt is the only place the 60% cap is written down.
 *   decimals   second_wind and bloodthirst both declare it and it was ignored in
 *              favour of a hardcoded 1 place for percents and 2 for flats. A
 *              ramp can produce values the flat rows never did (a delta of
 *              0.30000000000000004, say), and the row is the only thing that
 *              knows how precise its own number is meant to be.
 *
 * `decimals` is a CEILING, not a pad: 12.0 still prints as "12". A card that
 * writes "+12.0% total" where it used to write "+12%" has been made worse by a
 * correctness fix, which is not a trade this screen makes.
 */
function formatValue(up, v, isTotal) {
  const phrase = (isTotal && up.totalFmt) || up.fmt;
  const scaled = up.unit === 'percent' ? v * 100 : v;
  const places = up.decimals !== undefined ? up.decimals : (up.unit === 'percent' ? 1 : 2);
  const p = Math.pow(10, places);
  const num = Math.round(scaled * p) / p;
  if (phrase) return phrase.replace('{v}', num);
  return '+' + num + (up.unit === 'percent' ? '%' : '');
}

export const levelUpScreen = new LevelUpScreen();
