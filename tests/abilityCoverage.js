// Ability registry coverage.
//
// Kept in its own file because it is the one suite that imports the ABILITY
// implementations rather than just data — so a broken ability file fails here
// loudly instead of taking the whole runner down at import time.
//
// What it protects: every one of the 19 characters × 4 pillars must resolve to a
// registered implementation. A typo in an id produces a pillar that silently
// never fires — the auto-attack that does nothing, the special that costs a
// cooldown and has no effect — and no other test would catch it.

import { describe, it, assert } from './harness.js';
import * as characters from '../src/data/characters.js';
import * as evolutions from '../src/data/evolutions.js';
import * as relics from '../src/data/relics.js';
import { HOOK_NAMES, RELIC_IMPL } from '../src/game/relicHooks.js';

let AbilityRegistry = null;
let importError = null;
try {
  const mod = await import('../src/game/abilities/index.js');
  AbilityRegistry = mod.AbilityRegistry;
} catch (e) {
  importError = e;
}

describe('abilities / registry coverage', () => {
  it('the registry imports without throwing', () => {
    assert.ok(!importError, importError ? String(importError.stack || importError) : '');
  });

  it('all 76 pillars resolve to an implementation', () => {
    if (!AbilityRegistry) { assert.ok(false, 'registry failed to import'); return; }
    const missing = [];
    for (const c of characters.CHARACTERS) {
      for (const key of ['autoAttack', 'special', 'escape', 'passive']) {
        const id = c[key].id;
        if (!AbilityRegistry[id]) missing.push(`${c.id}.${key} -> "${id}"`);
      }
    }
    assert.equal(missing.length, 0, 'unimplemented pillars:\n      ' + missing.join('\n      '));
  });

  it('every auto-attack exposes fire()', () => {
    if (!AbilityRegistry) return;
    const bad = [];
    for (const c of characters.CHARACTERS) {
      const impl = AbilityRegistry[c.autoAttack.id];
      if (impl && typeof impl.fire !== 'function') bad.push(c.autoAttack.id);
    }
    assert.equal(bad.length, 0, 'autos without fire(): ' + bad.join(', '));
  });

  it('every special and escape exposes cast()', () => {
    if (!AbilityRegistry) return;
    const bad = [];
    for (const c of characters.CHARACTERS) {
      for (const key of ['special', 'escape']) {
        const impl = AbilityRegistry[c[key].id];
        if (impl && typeof impl.cast !== 'function') bad.push(`${c.id}.${key}`);
      }
    }
    assert.equal(bad.length, 0, 'abilities without cast(): ' + bad.join(', '));
  });

  it('a special with tick() also has cast() setting a duration', () => {
    if (!AbilityRegistry) return;
    // A tick() that never runs is the classic silent bug: cast() forgot
    // ctx.active/ctx.t, so the duration-based half of the ability is dead.
    const suspicious = [];
    for (const c of characters.CHARACTERS) {
      const impl = AbilityRegistry[c.special.id];
      if (!impl || typeof impl.tick !== 'function') continue;
      const src = String(impl.cast);
      if (!/ctx\.active\s*=\s*true/.test(src)) suspicious.push(c.special.id);
    }
    assert.equal(suspicious.length, 0,
                 'specials with tick() whose cast() never sets ctx.active:\n      ' + suspicious.join('\n      '));
  });

  it('no ability id is registered twice', () => {
    if (!AbilityRegistry) return;
    // register() throws on a duplicate by design, so reaching here means none.
    const ids = Object.keys(AbilityRegistry);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('all 8 evolutions have a registry entry', () => {
    if (!AbilityRegistry) return;
    const missing = [];
    for (const e of evolutions.EVOLUTIONS) {
      if (!AbilityRegistry['evo_' + e.id]) missing.push(e.id);
    }
    assert.equal(missing.length, 0, 'evolutions without an effect: ' + missing.join(', '));
  });
});

describe('relics / hook wiring', () => {
  it('all 24 relics have an implementation', () => {
    const missing = relics.RELICS.filter((r) => !RELIC_IMPL[r.id]).map((r) => r.id);
    assert.equal(missing.length, 0, 'relics with no behaviour: ' + missing.join(', '));
  });

  it('every declared hook is a real hook name', () => {
    const bad = [];
    for (const r of relics.RELICS) {
      for (const h of r.hooks || []) {
        if (HOOK_NAMES.indexOf(h) < 0) bad.push(`${r.id} declares unknown hook "${h}"`);
      }
    }
    assert.equal(bad.length, 0, bad.join('\n      '));
  });

  it('every declared hook is actually implemented', () => {
    const bad = [];
    for (const r of relics.RELICS) {
      const impl = RELIC_IMPL[r.id];
      if (!impl) continue;
      for (const h of r.hooks || []) {
        if (typeof impl[h] !== 'function') bad.push(`${r.id} declares "${h}" but does not implement it`);
      }
    }
    assert.equal(bad.length, 0, bad.join('\n      '));
  });

  it('interval relics declare an interval param', () => {
    const bad = [];
    for (const r of relics.RELICS) {
      if ((r.hooks || []).indexOf('onInterval') < 0) continue;
      if (!r.params || typeof r.params.interval !== 'number') bad.push(r.id);
    }
    assert.equal(bad.length, 0, 'onInterval relics with no interval: ' + bad.join(', '));
  });
});
