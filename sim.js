#!/usr/bin/env node
// Headless balance harness.
//
//   node sim.js                                  one run, first character, stage 1
//   node sim.js --char=rin --stage=5 --seed=42
//   node sim.js --all                            sweep every character
//   node sim.js --all --stage=3 --seeds=1,2,3    sweep with multiple seeds
//   node sim.js --all --json > balance.json      machine-readable
//
// This is the same code the browser runs. `?sim=1&char=rin&stage=2&seed=42` in
// the URL does the identical thing in-page.

import { simulate, sweep, printRun, printSweep } from './src/tools/simHarness.js';

const argv = process.argv.slice(2);
const flags = Object.create(null);
for (const a of argv) {
  const m = /^--?([\w.]+)(?:=(.*))?$/.exec(a);
  if (m) flags[m[1]] = m[2] === undefined ? '1' : m[2];
}

if (flags.help || flags.h) {
  console.log(`
  gacha survivors — balance harness

    node sim.js [options]

    --char=<id>        character to run (default: the first ★3)
    --stage=<id|n>     stage id, or a 1-based index
    --tier=<n>         0 debut, 1 encore, 2 legend, 3 kamige
    --star=<1..5>      star level to simulate
    --seed=<n>         run seed (default 42)
    --seeds=a,b,c      multiple seeds; results are averaged
    --max=<seconds>    cap the simulated time
    --all              sweep every character on the stage
    --json             emit JSON instead of a table

  NOTE: the scripted bot never dodges a telegraph, so it dies to every boss.
  Use this to find OUTLIERS, then hand-play what it flags. Treating its boss
  results as balance truth will nerf the whole roster to fit a bot that cannot
  read a wind-up.
`);
  process.exit(0);
}

const data = await import('./src/data/index.js');

const problems = data.validate();
if (problems.length) {
  console.error(`\n  ${problems.length} data integrity problem(s):`);
  for (const p of problems) console.error('    ' + p);
  console.error('');
}

const stages = data.stages.STAGES;
function resolveStage(v) {
  if (!v) return stages[0].id;
  if (data.stages.STAGES_BY_ID[v]) return v;
  const n = parseInt(v, 10);
  if (!isNaN(n) && stages[n - 1]) return stages[n - 1].id;
  console.error(`  unknown stage "${v}"; using ${stages[0].id}`);
  return stages[0].id;
}

const stageId = resolveStage(flags.stage);
const seeds = flags.seeds
  ? flags.seeds.split(',').map((s) => parseInt(s, 10) >>> 0)
  : [flags.seed ? (parseInt(flags.seed, 10) >>> 0) : 42];

if (flags.all) {
  const res = sweep(data, {
    stageId,
    seeds,
    tierIndex: +flags.tier || 0,
    starLevel: +flags.star || 1,
    maxSeconds: flags.max ? +flags.max : undefined,
  });
  if (flags.json) console.log(JSON.stringify(res, null, 2));
  else printSweep(res, console.log);
  const outliers = res.rows.filter((r) => r.outlier).length;
  process.exit(outliers > 0 ? 2 : 0);   // exit 2 so CI can flag it without failing hard
} else {
  const charId = flags.char || data.characters.CHARACTERS_BY_RARITY[3][0];
  if (!data.characters.CHARACTERS_BY_ID[charId]) {
    console.error(`  unknown character "${charId}". Valid ids:`);
    console.error('    ' + data.characters.CHARACTERS.map((c) => c.id).join(', '));
    process.exit(1);
  }
  const r = simulate(data, {
    characterId: charId,
    stageId,
    tierIndex: +flags.tier || 0,
    starLevel: +flags.star || 1,
    seed: seeds[0],
    maxSeconds: flags.max ? +flags.max : undefined,
  });
  if (flags.json) console.log(JSON.stringify(r, null, 2));
  else printRun(r, console.log);
}
