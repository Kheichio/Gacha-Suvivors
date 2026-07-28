// Node test runner:  npm test   /   node tests/run.js
//
// Runs the shared suites plus the two source-scanning suites that only make
// sense with filesystem access:
//   - the architecture rule (no character-id literals outside the data layer)
//   - ref containment (no ref string outside refs.js)
//
// Both exist because they are the two rules that are easiest to break by
// accident when adding content later, and neither is checkable from inside the
// running game.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, assert, runSuites } from './harness.js';
import { CHARACTERS } from '../src/data/characters.js';
import { REFS } from '../src/data/refs.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, out) {
  out = out || [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const SRC_FILES = walk(join(ROOT, 'src'));
const rel = (f) => relative(ROOT, f).split(sep).join('/');
const read = (f) => readFileSync(f, 'utf8');

// The data layer and the ability registry are the two places allowed to name a
// character. Everywhere else, a character id in a string literal means someone
// special-cased instead of adding data.
const DATA_DIR = 'src/data/';
const ABILITY_DIR = 'src/game/abilities/';

// ---------------------------------------------------------------------------
describe('architecture / adding a character must not touch gameplay code', () => {
  // DECISIONS.md §36. The spec says "adding a new character must require editing
  // exactly ONE file" (line 243) and also "one data object + up to 4 registry
  // entries" (line 927). Nothing in SECTION 17 tests for the failure mode, which
  // is `if (char.id === 'kira')` appearing in the damage pipeline under shipping
  // pressure.
  // Read the ids from the module rather than by regex: characters.js also
  // contains `id:` for each of the four ability pillars, so a naive scrape
  // collects 95 ids and then flags every ability name as a leaked character.
  const CHAR_IDS = CHARACTERS.map((c) => c.id);

  it('found the character ids to scan for', () => {
    assert.equal(CHAR_IDS.length, 19, 'expected 19 character ids in characters.js');
  });

  it('no character id appears outside src/data/ and the ability registry', () => {
    const violations = [];
    for (const f of SRC_FILES) {
      const r = rel(f);
      if (r.startsWith(DATA_DIR) || r.startsWith(ABILITY_DIR)) continue;
      const src = read(f);
      for (const id of CHAR_IDS) {
        // Only a quoted literal counts; `characterId` as a variable is fine.
        const re = new RegExp(`['"\`]${id}['"\`]`);
        const m = re.exec(src);
        if (m) {
          const line = src.slice(0, m.index).split('\n').length;
          violations.push(`${r}:${line} references '${id}'`);
        }
      }
    }
    assert.equal(violations.length, 0,
                 'character ids leaked into gameplay code:\n      ' + violations.join('\n      '));
  });

  it('the ability registry only names characters where the spec mandates it', () => {
    // The single sanctioned exception is Sora/Han's owned-both Spirit Bomb
    // synergy, which SECTION 4 requires explicitly. It must carry a comment.
    const violations = [];
    for (const f of SRC_FILES) {
      const r = rel(f);
      if (!r.startsWith(ABILITY_DIR)) continue;
      const src = read(f);
      const lines = src.split('\n');
      for (const id of CHAR_IDS) {
        const re = new RegExp(`['"\`]${id}['"\`]`);
        for (let i = 0; i < lines.length; i++) {
          if (!re.test(lines[i])) continue;
          // Allow it when the surrounding 6 lines explain why.
          const ctx = lines.slice(Math.max(0, i - 6), i + 2).join('\n');
          if (/\/\/|\/\*/.test(ctx) && /(synergy|spec|owned|DECISIONS|deliberate)/i.test(ctx)) continue;
          violations.push(`${r}:${i + 1} '${id}'`);
        }
      }
    }
    assert.equal(violations.length, 0,
                 'unexplained character ids in the ability registry:\n      ' + violations.join('\n      '));
  });

  it('gameplay code never branches on a stage or boss id either', () => {
    const IDS = ['cherry_academy', 'neon_akiba', 'wall_amaris', 'hidden_ember',
                 'tatami_halls', 'sunken_reef', 'zenith_stage',
                 'the_algorithm', 'the_colossus', 'kagutsuchi', 'the_final_form'];
    const violations = [];
    for (const f of SRC_FILES) {
      const r = rel(f);
      if (r.startsWith(DATA_DIR) || r.startsWith('src/scenes/') || r.startsWith('src/ui/')) continue;
      const src = read(f);
      for (const id of IDS) {
        const re = new RegExp(`['"\`]${id}['"\`]`);
        if (re.test(src)) violations.push(`${r} references '${id}'`);
      }
    }
    assert.equal(violations.length, 0,
                 'stage/boss ids leaked into engine code:\n      ' + violations.join('\n      '));
  });
});

// ---------------------------------------------------------------------------
describe('architecture / ref containment (SECTION 17\'s grep, made possible)', () => {
  // SECTION 17 line 1736 asks you to "grep the built output for a ref string" —
  // impossible under SECTION 1's "no build step", because there is no built
  // output. DECISIONS.md §22 makes the test real instead: every ref string in
  // the project lives in exactly one deletable file.
  // Only DISTINCTIVE refs are scanned for. "Oni" is a legitimate ref (Lesser
  // Oni) and also an ordinary word that appears in half the enemy names — a
  // naive substring scan flags "Oni Bruiser" in enemies.js as a ref leak. The
  // strings worth guarding are the ones that identify a real person: 6+
  // characters, matched on word boundaries.
  const REF_STRINGS = Object.values(REFS)
    .map((r) => r.ref)
    .filter((s) => s && s !== 'original' && s.length >= 6);

  it('refs.js exists and holds the ref strings', () => {
    assert.atLeast(Object.keys(REFS).length, 90, 'refs.js should hold ~100 ref entries');
    assert.atLeast(REF_STRINGS.length, 60);
  });

  it('no ref string appears in any other source file', () => {
    const violations = [];
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const f of SRC_FILES) {
      const r = rel(f);
      if (r === 'src/data/refs.js') continue;
      const src = read(f);
      for (const s of REF_STRINGS) {
        const re = new RegExp('\\b' + escape(s) + '\\b');
        if (re.test(src)) violations.push(`${r} contains "${s}"`);
      }
    }
    assert.equal(violations.length, 0,
                 'ref strings leaked out of refs.js:\n      ' + violations.slice(0, 20).join('\n      '));
  });

  it('deleting refs.js leaves nothing that reads it unguarded', () => {
    // Only data/index.js may import it, and only inside a try/catch.
    const importers = [];
    for (const f of SRC_FILES) {
      const r = rel(f);
      if (r === 'src/data/refs.js') continue;
      const src = read(f);
      if (/from\s+['"][^'"]*refs\.js['"]/.test(src) || /import\(['"][^'"]*refs\.js['"]\)/.test(src)) {
        importers.push(r);
      }
    }
    for (const imp of importers) {
      assert.equal(imp, 'src/data/index.js',
                   `${imp} imports refs.js directly; only data/index.js may, and only guarded`);
    }
    const idx = read(join(ROOT, 'src/data/index.js'));
    assert.ok(/try\s*\{[\s\S]*refs\.js[\s\S]*\}\s*catch/.test(idx),
              'data/index.js must import refs.js inside a try/catch');
  });
});

// ---------------------------------------------------------------------------
describe('architecture / performance rules that cannot be self-caught', () => {
  // DECISIONS.md §35.2. The F3 overlay reports 60 FPS on an idle title screen,
  // so "60 FPS with 2,000 entities" gets marked PASS while being false. These
  // static checks catch the specific mistakes that cause it.
  const HOT_FILES = [
    'src/game/enemy.js', 'src/game/projectile.js', 'src/game/pickup.js',
    'src/game/minion.js', 'src/render/particles.js', 'src/render/damageNumbers.js',
  ];

  it('no fillText / beginPath / shadowBlur in the per-entity draw loops', () => {
    const violations = [];
    for (const f of HOT_FILES) {
      let src;
      try { src = read(join(ROOT, f)); } catch (e) { continue; }
      // Look only inside draw(...) bodies.
      const m = /\bdraw\s*\([^)]*\)\s*\{/.exec(src);
      if (!m) continue;
      let depth = 0, i = m.index + m[0].length - 1, start = i;
      do {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
        i++;
      } while (depth > 0 && i < src.length);
      const body = src.slice(start, i);
      for (const bad of ['fillText', 'beginPath', 'shadowBlur', 'createLinearGradient',
                         'createRadialGradient', '.save()', '.filter =']) {
        if (body.includes(bad)) violations.push(`${f} draw() uses ${bad}`);
      }
    }
    assert.equal(violations.length, 0, violations.join('\n      '));
  });

  it('the renderer disables canvas alpha', () => {
    const src = read(join(ROOT, 'src/render/renderer.js'));
    assert.ok(/getContext\(\s*'2d'\s*,\s*\{[^}]*alpha:\s*false/.test(src),
              "renderer must use getContext('2d', { alpha: false })");
  });

  it('the sprite atlas is the only place that rasterises emoji', () => {
    const violations = [];
    for (const f of SRC_FILES) {
      const r = rel(f);
      if (r === 'src/render/spriteAtlas.js') continue;
      if (r.startsWith('src/scenes/') || r.startsWith('src/ui/')) continue;  // menus are not the hot loop
      const src = read(f);
      if (/ctx\.fillText\(/.test(src)) violations.push(r);
    }
    assert.equal(violations.length, 0,
                 'raw ctx.fillText outside the atlas and the menus:\n      ' + violations.join('\n      '));
  });

  it('every entity pool declares a hard cap', () => {
    const src = read(join(ROOT, 'src/core/config.js'));
    for (const k of ['MAX_ENTITIES', 'MAX_ENEMIES', 'MAX_PROJECTILES', 'MAX_GEMS',
                     'MAX_PARTICLES', 'MAX_DAMAGE_NUMBERS', 'GEM_MERGE_THRESHOLD']) {
      assert.ok(src.includes(k), `config is missing the ${k} cap`);
    }
  });
});

// ---------------------------------------------------------------------------
describe('architecture / no network requests, no build step', () => {
  it('nothing fetches from a remote origin', () => {
    const violations = [];
    for (const f of SRC_FILES) {
      const src = read(f);
      const m = /(https?:)\/\/[^\s'"`)]+/g.exec(src);
      if (m && !/schema|w3\.org|json-schema/.test(m[0])) {
        violations.push(`${rel(f)} references ${m[0]}`);
      }
      if (/@import\s+url|fonts\.googleapis/.test(src)) violations.push(`${rel(f)} fetches a font`);
    }
    assert.equal(violations.length, 0, violations.join('\n      '));
  });

  it('index.html loads only local modules', () => {
    const html = read(join(ROOT, 'index.html'));
    assert.ok(!/src=["']https?:/.test(html), 'index.html loads a remote script');
    assert.ok(!/href=["']https?:/.test(html), 'index.html loads a remote stylesheet');
    assert.ok(html.includes('./src/main.js'), 'index.html must import ./src/main.js');
  });

  it('no bare-specifier imports (there is no bundler to resolve them)', () => {
    const violations = [];
    for (const f of SRC_FILES) {
      // Line-anchored: a bare `from '...'` regex also matches prose inside a
      // template string ("Need 40 💌 (have 12, or 80 from universal)").
      for (const line of read(f).split('\n')) {
        const m = /^\s*(?:import\b.*?|\}\s*)from\s+['"]([^'"]+)['"]/.exec(line);
        if (!m) continue;
        const spec = m[1];
        if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
        violations.push(`${rel(f)} imports "${spec}"`);
      }
    }
    assert.equal(violations.length, 0,
                 'bare imports need a bundler; this project has no build step:\n      ' + violations.join('\n      '));
  });
});

// ---------------------------------------------------------------------------
// The shared suites are imported last so the source scans above run first and
// a syntax error in the data layer is reported as a clean failure.
await import('./suites.js');
await import('./abilityCoverage.js');
await import('./pixelArt.js');
await import('./abilityRuntime.js');
await import('./weapons.js');
await import('./quests.js');
await import('./renderSmoke.js');

const COLORS = {
  suite: '\x1b[1m\x1b[36m', pass: '\x1b[32m', fail: '\x1b[31m',
  detail: '\x1b[90m', reset: '\x1b[0m',
};
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (s, kind) => (useColor && COLORS[kind] ? COLORS[kind] + s + COLORS.reset : s);

console.log('');
const result = runSuites((line, kind) => console.log(paint(line, kind)));
console.log('');

if (result.failed === 0) {
  console.log(paint(`  ${result.passed} passed`, 'pass'));
  process.exit(0);
} else {
  console.log(paint(`  ${result.passed} passed, ${result.failed} FAILED`, 'fail'));
  console.log('');
  for (const f of result.failures) {
    console.log(paint(`  ${f.suite} › ${f.test}`, 'fail'));
    console.log(paint('    ' + String(f.detail).split('\n').join('\n    '), 'detail'));
  }
  process.exit(1);
}
