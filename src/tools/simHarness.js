// The balance harness. SECTION 14: "This is not optional — you cannot
// hand-balance 19 characters."
//
// Runs the REAL simulation headlessly at maximum speed with a scripted
// "average player", and prints DPS / level / death time. The same ES modules
// the browser runs execute here under `node sim.js`, which is what makes this
// closed loop possible without a human opening an editor.
//
// WHAT THIS CAN AND CANNOT TELL YOU
// ---------------------------------
// The bot never dodges a telegraph. It will therefore die to every boss and
// report every character as failing that fight. Use it to find OUTLIERS — the
// character 3x above or below the median — and then hand-play what it flags.
// Treating its boss results as balance truth will make you nerf the whole
// roster to fit a bot that cannot read a wind-up.
//
// KIRA (SECTION 14's named special case): his instant-kill timers ignore enemy
// HP, so the standard DPS metric reports him as effectively infinite. He is
// measured on ENEMIES KILLED PER SECOND instead, and the harness separately
// checks that he is genuinely weak before minute 4.

import { Run, RUN_STATE } from '../game/run.js';
import { input, ACT } from '../core/input.js';
import { save } from '../core/save.js';
import { storage } from '../core/storage.js';
import { CONFIG } from '../core/config.js';
import { runRng } from '../core/rng.js';
import { camera } from '../render/camera.js';
import { dist2, clamp, TAU } from '../core/math.js';

const DT = CONFIG.TICK_DT;

/** Upgrades the "average player" reaches for, in preference order. */
const BOT_PRIORITY = [
  'extra_shot', 'sharp_edge', 'rapid_fire', 'keen_eye', 'killing_blow',
  'wide_reach', 'piercing_will', 'iron_body', 'swift_boots', 'lodestone',
  'quick_recovery', 'second_wind', 'guardian_plate', 'scholar', 'bloodthirst',
];

/** Where "level a weapon" sits in BOT_PRIORITY's ranking. See chooseUpgrade(). */
const WEAPON_LEVEL_RANK = 3;

class Bot {
  constructor(run) {
    this.run = run;
    this.threatX = 0; this.threatY = 0;
  }

  /** SECTION 14's spec: moves away from the densest cluster, uses abilities off cooldown. */
  act() {
    const run = this.run;
    const p = run.player;

    // --- movement: flee the densest nearby cell, drift toward loot ----------
    let fx = 0, fy = 0;
    const hash = run.enemyHash;
    const items = run.enemies.items;
    const n = hash.query(p.x, p.y, 300);
    let cx = 0, cy = 0, c = 0;
    for (let k = 0; k < n; k++) {
      const e = items[hash.resultAt(k)];
      if (!e || !e.active || e.hp <= 0) continue;
      cx += e.x; cy += e.y; c++;
    }
    if (c > 0) {
      cx /= c; cy /= c;
      const dx = p.x - cx, dy = p.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      fx += dx / d; fy += dy / d;
    }

    // A weak pull toward the nearest gem, so the bot levels at a human-ish rate
    // instead of kiting in a corner and starving.
    let bestD = Infinity, gx = 0, gy = 0;
    const pk = run.pickups.items;
    for (let i = 0; i < run.pickups.count; i++) {
      const g = pk[i];
      const d = dist2(g.x, g.y, p.x, p.y);
      if (d < bestD) { bestD = d; gx = g.x; gy = g.y; }
    }
    if (bestD < 520 * 520) {
      const dx = gx - p.x, dy = gy - p.y;
      const d = Math.hypot(dx, dy) || 1;
      fx += (dx / d) * 0.55; fy += (dy / d) * 0.55;
    }

    // Stay off the walls; a bot pinned in a corner dies to nothing interesting.
    const b = run.bounds;
    const margin = 400;
    if (p.x < b.minX + margin) fx += 1;
    if (p.x > b.maxX - margin) fx -= 1;
    if (p.y < b.minY + margin) fy += 1;
    if (p.y > b.maxY - margin) fy -= 1;

    const l = Math.hypot(fx, fy);
    input.moveX = l > 0.01 ? fx / l : 0;
    input.moveY = l > 0.01 ? fy / l : 0;

    // --- abilities off cooldown --------------------------------------------
    if (p.special.ready) input.press(ACT.SPECIAL);
    if (p.escape.ready) input.press(ACT.ESCAPE);
  }

  clearInput() {
    input._pressed[ACT.SPECIAL] = false;
    input._pressed[ACT.ESCAPE] = false;
    input._latched[ACT.SPECIAL] = false;
    input._latched[ACT.ESCAPE] = false;
  }

  /**
   * "Always picks the highest-damage upgrade."
   *
   * The ranking is deliberate rather than incidental: weapons now carry most of
   * a build's damage, so a bot that only recognised stat cards would fall
   * through to index 0 whenever it was offered three weapons and would report
   * every character as far weaker than a human plays them.
   *
   *   weapon evolution  >  build evolution  >  fill the empty weapon slots
   *
   * and after that, LEVELLING A WEAPON COMPETES WITH STAT CARDS rather than
   * beating all of them. A bot that always took the weapon produced a
   * monoculture — every character ran the same three weapons and no stat card
   * at all — which is a worse slander than the one the bot already commits by
   * never dodging. `WEAPON_LEVEL_RANK` puts a weapon level just behind the top
   * three damage stats, which is roughly where a human puts it.
   */
  chooseUpgrade() {
    const run = this.run;
    const choices = run.levelUpChoices;
    if (!choices || choices.length === 0) { run.state = RUN_STATE.PLAYING; return; }
    for (const kind of ['weaponEvo', 'evolution', 'newWeapon']) {
      for (let i = 0; i < choices.length; i++) {
        if (choices[i].kind === kind) { run.chooseUpgrade(i); return; }
      }
    }
    let best = 0, bestRank = 999;
    for (let i = 0; i < choices.length; i++) {
      const ch = choices[i];
      let r;
      if (ch.kind === 'weapon') r = WEAPON_LEVEL_RANK;
      else if (ch.kind === 'upgrade') {
        const rank = BOT_PRIORITY.indexOf(ch.up.id);
        r = rank < 0 ? 500 : rank;
      } else continue;
      if (r < bestRank) { bestRank = r; best = i; }
    }
    run.chooseUpgrade(best);
  }
}

/**
 * Run one simulation.
 * @param {object} data    the data layer
 * @param {object} cfg     { characterId, stageId, tierIndex, seed, maxSeconds, starLevel }
 * @returns {object} the run summary plus harness-specific metrics
 */
export function simulate(data, cfg) {
  storage.useMemory();
  save.load();
  // The harness measures the CHARACTER, not the account, so meta progression is
  // zeroed — otherwise a well-invested shrine would flatter every result.
  save.data.shrine = {};
  for (const c of data.characters.CHARACTERS) {
    save.data.roster[c.id] = { owned: true, starLevel: cfg.starLevel || 1, letters: 0, bond: 0, runs: 0, kills: 0 };
  }

  camera.resize(CONFIG.BASE_W, CONFIG.BASE_H);

  const run = new Run(data, {
    characterId: cfg.characterId,
    stageId: cfg.stageId,
    tierIndex: cfg.tierIndex || 0,
    seed: cfg.seed >>> 0,
  });
  const bot = new Bot(run);

  const maxSeconds = cfg.maxSeconds || run.stage.duration + 30;
  const maxSteps = Math.ceil(maxSeconds / DT);

  // Per-minute samples, which is what makes "weak early, monstrous late" visible.
  const perMinute = [];
  let lastMinute = 0, lastDamage = 0, lastKills = 0;

  let steps = 0;
  const t0 = now();
  while (steps < maxSteps) {
    if (run.state === RUN_STATE.LEVEL_UP) { bot.chooseUpgrade(); continue; }
    if (run.state === RUN_STATE.CHEST) { run.closeChest(); continue; }
    if (run.state === RUN_STATE.RELIC_SWAP) { run.resolveRelicSwap(0); continue; }
    if (run.state === RUN_STATE.DEFEAT || run.state === RUN_STATE.VICTORY) break;

    bot.act();
    run.update(DT);
    bot.clearInput();
    steps++;

    const minute = Math.floor(run.time / 60);
    if (minute > lastMinute) {
      perMinute.push({
        minute,
        dps: (run.stats.damageDealt - lastDamage) / 60,
        kps: (run.stats.kills - lastKills) / 60,
        level: run.player.level,
        hp: run.player.hp / run.player.maxHp,
        enemies: run.enemies.count,
      });
      lastMinute = minute;
      lastDamage = run.stats.damageDealt;
      lastKills = run.stats.kills;
    }
  }
  const wall = now() - t0;

  const summary = run.summary();
  summary.perMinute = perMinute;
  summary.wallMs = wall;
  summary.speedup = wall > 0 ? (run.time * 1000) / wall : 0;
  summary.died = run.state === RUN_STATE.DEFEAT;
  summary.timedOut = steps >= maxSteps && !summary.died && !summary.victory;
  summary.starLevel = cfg.starLevel || 1;

  // SECTION 14's Kira clause: measure him on kills/sec, and verify he is
  // genuinely weak before minute 4.
  const isThroughputCharacter = run.player.def.metric === 'killsPerSecond';
  summary.metric = isThroughputCharacter ? 'killsPerSecond' : 'dpsTotal';
  summary.metricValue = isThroughputCharacter ? summary.killsPerSecond : summary.dpsTotal;
  summary.earlyKps = perMinute.slice(0, 4).reduce((a, s) => a + s.kps, 0) / Math.max(1, Math.min(4, perMinute.length));
  summary.lateKps = perMinute.slice(-4).reduce((a, s) => a + s.kps, 0) / Math.max(1, Math.min(4, perMinute.length));

  run.dispose();
  return summary;
}

function now() {
  if (typeof performance !== 'undefined' && performance.now) return performance.now();
  return Date.now();
}

/**
 * Sweep every character over a stage and report outliers against the median.
 * SECTION 17: "no character more than 35% above or below the median clear time".
 */
export function sweep(data, opts) {
  const o = opts || {};
  const stageId = o.stageId || data.stages.STAGES[0].id;
  const seeds = o.seeds || [1337];
  const only = o.characters;
  const chars = (only && only.length ? only : data.characters.CHARACTERS.map((c) => c.id));

  const rows = [];
  for (const id of chars) {
    const runs = [];
    for (const seed of seeds) {
      runs.push(simulate(data, {
        characterId: id, stageId, tierIndex: o.tierIndex || 0,
        seed, maxSeconds: o.maxSeconds, starLevel: o.starLevel,
      }));
    }
    const avg = (f) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
    rows.push({
      character: id,
      metric: runs[0].metric,
      metricValue: avg((r) => r.metricValue),
      dpsTotal: avg((r) => r.dpsTotal),
      dpsPeak: avg((r) => r.dpsPeak),
      killsPerSecond: avg((r) => r.killsPerSecond),
      survived: avg((r) => r.time),
      level: avg((r) => r.level),
      kills: avg((r) => r.kills),
      damageTaken: avg((r) => r.damageTaken),
      wins: runs.filter((r) => r.victory).length,
      deaths: runs.filter((r) => r.died).length,
      earlyKps: avg((r) => r.earlyKps),
      lateKps: avg((r) => r.lateKps),
      runs: runs.length,
    });
  }

  // The median is taken over SURVIVAL TIME, which is the closest thing the bot
  // produces to "clear time" given it cannot beat a boss.
  const times = rows.map((r) => r.survived).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] || 1;
  for (const r of rows) {
    r.deltaFromMedian = median > 0 ? (r.survived - median) / median : 0;
    r.outlier = Math.abs(r.deltaFromMedian) > 0.35;
  }

  return { stageId, median, rows, seeds };
}

// --- browser entry: ?sim=1&char=rin&stage=2&seed=42 --------------------------
export async function runFromQuery(query) {
  const data = await import('../data/index.js');
  const stages = data.stages.STAGES;
  const stageId = query.stage
    ? (isNaN(+query.stage) ? query.stage : (stages[Math.max(0, (+query.stage) - 1)] || stages[0]).id)
    : stages[0].id;

  if (query.all) {
    const res = sweep(data, { stageId, seeds: [+query.seed || 42], tierIndex: +query.tier || 0 });
    printSweep(res, console.log);
    return res;
  }

  const r = simulate(data, {
    characterId: query.char || data.characters.CHARACTERS[0].id,
    stageId,
    tierIndex: +query.tier || 0,
    seed: +query.seed || 42,
    starLevel: +query.star || 1,
  });
  printRun(r, console.log);
  return r;
}

// --- printing -----------------------------------------------------------------
export function printRun(r, log) {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (v, d) => (v === undefined ? '-' : v.toFixed(d === undefined ? 1 : d));
  log('');
  log(`  ${r.character}  ·  ${r.stage} (${r.tier})  ·  seed ${r.seed}  ·  S${r.starLevel}`);
  log(`  ${'-'.repeat(64)}`);
  log(`  outcome        ${r.victory ? 'VICTORY' : r.died ? 'died' : 'timed out'}  at ${num(r.time)}s`);
  log(`  level          ${r.level}   (${r.levelUps} level-ups)`);
  log(`  kills          ${r.kills}   (${num(r.killsPerSecond, 2)}/s)`);
  log(`  damage dealt   ${Math.round(r.damageDealt).toLocaleString()}`);
  log(`  dps (all)      ${num(r.dpsTotal)}   peak ${num(r.dpsPeak)}`);
  log(`  damage taken   ${Math.round(r.damageTaken).toLocaleString()}`);
  log(`  relics         ${r.relics.join(', ') || '-'}`);
  log(`  evolutions     ${r.evolutions.join(', ') || '-'}`);
  log(`  headline       ${r.metric} = ${num(r.metricValue, 2)}`);
  log(`  sim speed      ${num(r.speedup, 0)}x realtime (${num(r.wallMs, 0)}ms)`);
  if (r.perMinute && r.perMinute.length) {
    log('');
    log(`  min   dps        kills/s   lv   hp     enemies`);
    for (const m of r.perMinute) {
      log(`  ${pad(m.minute, 4)}  ${pad(num(m.dps, 0), 10)} ${pad(num(m.kps, 2), 9)} ${pad(m.level, 4)} ` +
          `${pad(num(m.hp * 100, 0) + '%', 6)} ${m.enemies}`);
    }
  }
}

export function printSweep(res, log) {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (v, d) => v.toFixed(d === undefined ? 1 : d);
  log('');
  log(`  BALANCE SWEEP — ${res.stageId}, seeds [${res.seeds.join(', ')}]`);
  log(`  median survival ${num(res.median)}s;  SECTION 17 wants every character within ±35%`);
  log('');
  log(`  ${pad('character', 20)}${pad('survived', 11)}${pad('Δmedian', 10)}${pad('dps(all)', 11)}${pad('kills/s', 10)}${pad('lv', 5)}flag`);
  log(`  ${'-'.repeat(78)}`);
  const sorted = res.rows.slice().sort((a, b) => b.survived - a.survived);
  for (const r of sorted) {
    const d = (r.deltaFromMedian * 100);
    log(`  ${pad(r.character, 20)}${pad(num(r.survived) + 's', 11)}` +
        `${pad((d >= 0 ? '+' : '') + num(d, 0) + '%', 10)}` +
        `${pad(num(r.dpsTotal, 0), 11)}${pad(num(r.killsPerSecond, 2), 10)}` +
        `${pad(Math.round(r.level), 5)}${r.outlier ? 'OUTLIER' : ''}`);
  }
  const outliers = res.rows.filter((r) => r.outlier);
  log('');
  if (outliers.length === 0) {
    log('  no outliers — every character is inside ±35% of the median.');
  } else {
    log(`  ${outliers.length} outlier(s): ${outliers.map((r) => r.character).join(', ')}`);
    log('  Hand-play these before changing any numbers. The bot never dodges a');
    log('  telegraph, so a boss-heavy stage slanders every character equally and');
    log('  a character that dies early here may simply be one the bot plays badly.');
  }
  // Kira's separate check.
  const kira = res.rows.find((r) => r.metric === 'killsPerSecond');
  if (kira) {
    log('');
    log(`  throughput character (${kira.character}): early ${num(kira.earlyKps, 2)} k/s, ` +
        `late ${num(kira.lateKps, 2)} k/s`);
    if (kira.earlyKps > 0 && kira.lateKps / kira.earlyKps < 2) {
      log('  WARNING: he is not accelerating. SECTION 14 requires him to be genuinely');
      log('  weak before minute 4 and monstrous by minute 18 — that arc IS the character.');
    }
  }
}
