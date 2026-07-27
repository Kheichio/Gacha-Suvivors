// The art tests.
//
// Sprite generation has the same problem as rendering: a sprite that comes out
// EMPTY, or SOLID, or pixel-identical to another character, draws without error
// and passes every other check in the project. These assert the things a broken
// sprite would fail, on the raw pixel buffer, with no canvas involved.

import { describe, it, assert } from './harness.js';
import { buildBuffer, OUTLINE, BODY_PLANS } from '../src/render/pixelArt.js';
import { CHARACTER_SPRITES, spriteFor } from '../src/data/sprites.js';
import * as characters from '../src/data/characters.js';
import * as enemies from '../src/data/enemies.js';
import * as bosses from '../src/data/bosses.js';

/** Fraction of the grid that is filled, and a cheap content fingerprint. */
function analyse(buf) {
  let filled = 0, outline = 0;
  const colors = new Set();
  let sig = 0;
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      const c = buf.get(x, y);
      if (!c) continue;
      filled++;
      if (c === OUTLINE) outline++;
      else colors.add(c);
      // Position- and colour-sensitive hash.
      sig = (Math.imul(sig ^ (x * 73856093) ^ (y * 19349663), 0x85ebca6b) ^ hashStr(c)) >>> 0;
    }
  }
  return { filled, outline, colors: colors.size, fill: filled / (buf.w * buf.h), sig };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

describe('art / character sprites', () => {
  it('all 19 characters have a sprite descriptor', () => {
    const missing = characters.CHARACTERS.filter((c) => !CHARACTER_SPRITES[c.id]).map((c) => c.id);
    assert.equal(missing.length, 0, 'characters with no sprite: ' + missing.join(', '));
  });

  it('every character sprite has actual pixels in it', () => {
    const bad = [];
    for (const c of characters.CHARACTERS) {
      const a = analyse(buildBuffer(spriteFor('character', c)));
      // Empty = invisible. Solid = an unreadable blob. Both draw without error.
      if (a.fill < 0.12) bad.push(`${c.id}: only ${(a.fill * 100).toFixed(0)}% filled`);
      if (a.fill > 0.92) bad.push(`${c.id}: ${(a.fill * 100).toFixed(0)}% filled — a solid block`);
    }
    assert.equal(bad.length, 0, bad.join('\n      '));
  });

  it('every character sprite is outlined', () => {
    // The outline is what separates a sprite from the background and from the
    // 200 enemies behind it. Without it the game is unreadable in a crowd.
    const bad = [];
    for (const c of characters.CHARACTERS) {
      const a = analyse(buildBuffer(spriteFor('character', c)));
      if (a.outline < 12) bad.push(`${c.id}: ${a.outline} outline pixels`);
    }
    assert.equal(bad.length, 0, bad.join('\n      '));
  });

  it('every character sprite uses several colours', () => {
    // A one-colour silhouette has no readable features.
    const bad = [];
    for (const c of characters.CHARACTERS) {
      const a = analyse(buildBuffer(spriteFor('character', c)));
      if (a.colors < 5) bad.push(`${c.id}: only ${a.colors} colours`);
    }
    assert.equal(bad.length, 0, bad.join('\n      '));
  });

  it('no two characters look identical', () => {
    // THE point of hand-authoring 19 descriptors. If two collapse to the same
    // pixels the roster silently loses a character and nothing else notices.
    const seen = new Map();
    const clashes = [];
    for (const c of characters.CHARACTERS) {
      const { sig } = analyse(buildBuffer(spriteFor('character', c)));
      if (seen.has(sig)) clashes.push(`${c.id} is pixel-identical to ${seen.get(sig)}`);
      seen.set(sig, c.id);
    }
    assert.equal(clashes.length, 0, clashes.join('\n      '));
  });

  it('the rival pairs are visually distinguishable', () => {
    // SECTION 4: same-series pairs "must be visibly and mechanically distinct".
    // Yamikage/Uzu and Sora/Han are the two the spec calls out by name.
    for (const [a, b] of [['yamikage', 'uzu'], ['sora', 'han']]) {
      const ca = characters.CHARACTERS_BY_ID[a], cb = characters.CHARACTERS_BY_ID[b];
      const sa = analyse(buildBuffer(spriteFor('character', ca)));
      const sb = analyse(buildBuffer(spriteFor('character', cb)));
      assert.notEqual(sa.sig, sb.sig, `${a} and ${b} render identically`);
      const da = CHARACTER_SPRITES[a], db = CHARACTER_SPRITES[b];
      assert.notEqual(da.outfit, db.outfit, `${a} and ${b} share an outfit colour`);
    }
  });
});

describe('art / enemy and boss sprites', () => {
  it('every enemy resolves to a sprite with pixels', () => {
    const bad = [];
    for (const e of enemies.ENEMIES) {
      const d = spriteFor('enemy', e);
      if (!d) { bad.push(`${e.id}: no descriptor`); continue; }
      const a = analyse(buildBuffer(d));
      if (a.fill < 0.10) bad.push(`${e.id}: ${(a.fill * 100).toFixed(0)}% filled`);
      if (a.outline < 8) bad.push(`${e.id}: no outline`);
    }
    assert.equal(bad.length, 0, bad.join('\n      '));
  });

  it('every boss resolves to a sprite with pixels', () => {
    const bad = [];
    for (const b of bosses.BOSSES) {
      const d = spriteFor('boss', b);
      if (!d) { bad.push(`${b.id}: no descriptor`); continue; }
      const a = analyse(buildBuffer(d));
      if (a.fill < 0.06) bad.push(`${b.id}: ${(a.fill * 100).toFixed(0)}% filled`);
    }
    assert.equal(bad.length, 0, bad.join('\n      '));
  });

  it('bosses are drawn on a bigger grid than fodder', () => {
    const mob = spriteFor('enemy', enemies.ENEMIES_BY_ID.mob_student);
    const boss = spriteFor('boss', bosses.BOSSES[0]);
    const mobBuf = buildBuffer(mob), bossBuf = buildBuffer(boss);
    assert.ok(bossBuf.w * bossBuf.h > mobBuf.w * mobBuf.h * 2,
              'a boss sprite is not meaningfully larger than a fodder sprite');
  });

  it('every body plan produces something', () => {
    for (const body of BODY_PLANS) {
      const a = analyse(buildBuffer({ body, outfit: '#5f7fd6', accent: '#203050' }));
      assert.atLeast(a.filled, 20, `body plan "${body}" drew almost nothing`);
    }
  });

  it('the idle bob produces a genuinely different second frame', () => {
    const d = spriteFor('character', characters.CHARACTERS[0]);
    const base = buildBuffer(d);
    const bobbed = base.shifted(1);
    assert.notEqual(analyse(base).sig, analyse(bobbed).sig, 'the bob frame is identical');
  });
});
