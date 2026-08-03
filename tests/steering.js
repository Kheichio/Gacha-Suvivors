// Obstacle steering — the only BEHAVIOURAL coverage ObstacleField has.
//
// Everything in suites.js about obstacles is data-shape: which kinds a set
// declares, whether a layout box is big enough to anchor an event. None of it
// runs steer(), which is why a horde that could not get round a 1000px city
// block shipped: the code was exercised on paper and never on a wall.
//
// The geometry here is SYNTHETIC on purpose. A test that reads a real stage's
// layout starts failing the day someone moves a lamp post, and it would then be
// reporting a data change as a steering regression. One 1000x1000 box is the
// shape of the problem; where the shipped stages put theirs is a different test.
//
// Everything is synchronous — `runSuites` does not await, so an async body that
// rejects would be reported as a PASS.

import { describe, it, assert } from './harness.js';
import * as data from '../src/data/index.js';
import { ObstacleField } from '../src/game/obstacles.js';
import { makeEnemy } from '../src/game/enemy.js';
import { Run } from '../src/game/run.js';
import { runRng } from '../src/core/rng.js';
import { feel } from '../src/core/feel.js';
import { save } from '../src/core/save.js';
import { storage } from '../src/core/storage.js';
import { camera } from '../src/render/camera.js';
import { CONFIG } from '../src/core/config.js';

const DT = 1 / 60;

/** A field with no Run behind it. steer() reads geometry and `feel`, nothing else. */
function field() {
  return new ObstacleField({ bounds: { minX: 0, minY: 0, maxX: 4000, maxY: 4000 } });
}

/** A pooled enemy, positioned. Uses the real template so the avoid* state is real. */
function mob(x, y, uid) {
  const e = makeEnemy();
  e.uid = uid === undefined ? 1 : uid;
  e.x = e.px = x; e.y = e.py = y;
  e.radius = 15.96;                  // gacha_zombie: visual.size 14 * enemySizeMult
  e.speed = 62;
  return e;
}

/**
 * One tick of `chaser`: enemy.js stamps px/py, `_moveToward` walks at the player
 * and writes vx/vy, then steer runs. Transcribed rather than imported because
 * BEHAVIORS is module-private and the thing under test is steer(), not the AI.
 */
function tick(F, e, tx, ty) {
  e.px = e.x; e.py = e.y;
  const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
  if (d > 1) {
    e.x += dx / d * e.speed * DT;
    e.y += dy / d * e.speed * DT;
    e.vx = dx / d * e.speed; e.vy = dy / d * e.speed;
  }
  F.steer(e, DT);
  return Math.hypot(e.x - tx, e.y - ty);
}

/**
 * `reversals` counts ticks whose step points BACKWARDS against the previous
 * one — measured off the motion, not off `e.avoidSide`, because a dither can
 * hide inside a stored field that is only written on a fresh decision. Steps
 * under 0.3px (the mob is 1.03px/tick) are ignored so float noise at a standstill
 * does not read as a turn.
 * @returns {{d:number, path:number, reversals:number, ticks:number}}
 */
function chase(F, e, tx, ty, seconds) {
  let path = 0, reversals = 0, d = Infinity, lx = 0, ly = 0;
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const x0 = e.x, y0 = e.y;
    d = tick(F, e, tx, ty);
    const sx = e.x - x0, sy = e.y - y0;
    const step = Math.hypot(sx, sy);
    path += step;
    if (step > 0.3 && Math.hypot(lx, ly) > 0.3 && sx * lx + sy * ly < 0) reversals++;
    if (step > 0.3) { lx = sx; ly = sy; }
    if (d < 60) return { d, path, reversals, ticks: i + 1 };
  }
  return { d, path, reversals, ticks: n };
}

// ---------------------------------------------------------------------------
describe('obstacles / the horde routes around a wall instead of grinding on it', () => {
  // A 1000x1000 block centred at (1100,1100) spans 600..1600 on both axes.
  // The player stands 100px off its EAST face; the enemy starts 100px off its
  // WEST face, dead level with both. The only way through is 500px along the
  // face to a corner, 1000px across, and 500px back — about 2,000px of walking
  // for a mob that moves 62 px/s, so 60 seconds is the honest budget.
  const BLOCK = { x: 1100, y: 1100, hw: 500, hh: 500 };
  const PX = 1700, PY = 1100;

  it('a chaser pinned to a 1000px face reaches the player on the far side', () => {
    const F = field();
    F.addBox(BLOCK.x, BLOCK.y, BLOCK.hw, BLOCK.hh);
    const e = mob(500, 1100);
    const r = chase(F, e, PX, PY, 60);
    // Before this landed the mob stopped dead against the face and ended the
    // minute ~1,150px away, having walked kilometres.
    assert.lessThan(r.d, 60,
                    `never arrived — ended ${r.d.toFixed(0)}px away after walking ${r.path.toFixed(0)}px`);
    // And it took a ROUTE, not a wander: the geodesic round the block is
    // ~2,050px, so anything under 1.5x means it committed to one way round.
    assert.lessThan(r.path, 3100,
                    `arrived, but walked ${r.path.toFixed(0)}px to do it — that is a wander, not a route`);
  });

  it('it never reverses its mind about which way round', () => {
    const F = field();
    F.addBox(BLOCK.x, BLOCK.y, BLOCK.hw, BLOCK.hh);
    const e = mob(500, 1100);
    const r = chase(F, e, PX, PY, 60);
    // The old code re-derived the side every tick from a dot product that is
    // exactly 0 at a face centre, so it flipped at frame rate and integrated to
    // nothing. A handful of backward steps is corner geometry; hundreds is a
    // dither, and a mob that dithers walks a kilometre and arrives nowhere.
    assert.atMost(r.reversals, 20,
                  `stepped BACKWARDS on ${r.reversals} of ${r.ticks} ticks getting round one box`);
  });

  it('mobs starting either side of the face split into two streams', () => {
    // Not cosmetic: a single conga line means one of the two ways round is
    // never used, and the mobs on the wrong side of it walk the long way.
    const F = field();
    F.addBox(BLOCK.x, BLOCK.y, BLOCK.hw, BLOCK.hh);
    const north = mob(500, 800, 1);
    const south = mob(500, 1400, 2);
    chase(F, north, PX, PY, 6);
    chase(F, south, PX, PY, 6);
    assert.lessThan(north.y, 800, 'the mob north of centre did not head for the north corner');
    assert.atLeast(south.y, 1400, 'the mob south of centre did not head for the south corner');
  });

  it('a mob square-on to the face still picks a side, deterministically', () => {
    // Dead centre the nearest-exit rule is a tie and the heading is a tie, so
    // the parity tiebreak is the ONLY thing choosing — and it must be `uid & 1`
    // and not the RNG, or a replayed seed routes the horde differently.
    const F = field();
    F.addBox(BLOCK.x, BLOCK.y, BLOCK.hw, BLOCK.hh);
    const even = mob(500, 1100, 2);
    const odd = mob(500, 1100, 3);
    chase(F, even, PX, PY, 8);
    chase(F, odd, PX, PY, 8);
    assert.notEqual(even.avoidSide, 0, 'a blocked mob ended with no committed side at all');
    assert.notEqual(even.avoidSide, odd.avoidSide,
                    'consecutive uids took the same way round — the parity tiebreak is dead');
  });

  it('a mob that never writes vx/vy is steered too', () => {
    // THE ONE THAT SHIPPED. steer() used to take its heading from `e.vx/e.vy`,
    // and `_moveToward` is the only function in enemy.js that writes them — the
    // swarmer, the charger's dash, the ranged back-off, the orbiter and every
    // teleport move `e.x/e.y` directly and leave the velocity at spawn's (0,0).
    // Those mobs read as STATIONARY, took the depenetrate-only early return, and
    // got no avoidance at all. On the city-block stage they are 76 of the 130
    // mob-table weight and all of the first minute.
    const F = field();
    F.addBox(BLOCK.x, BLOCK.y, BLOCK.hw, BLOCK.hh);
    const e = mob(500, 1100);
    let d = Infinity;
    for (let i = 0; i < 60 / DT; i++) {
      e.px = e.x; e.py = e.y;
      const dx = PX - e.x, dy = PY - e.y, dd = Math.hypot(dx, dy);
      if (dd > 1) { e.x += dx / dd * e.speed * DT; e.y += dy / dd * e.speed * DT; }
      assert.equal(e.vx, 0, 'the test itself wrote a velocity — it is no longer proving anything');
      F.steer(e, DT);
      d = Math.hypot(e.x - PX, e.y - PY);
      if (d < 60) break;
    }
    assert.lessThan(d, 60, `a velocity-less mob never got round the block — ended ${d.toFixed(0)}px away`);
  });

  it('steering consumes no run randomness', () => {
    // DETERMINISM. sim.js and the balance harness replay from a seed; a single
    // raw() in here would desync every enemy spawned after the first wall.
    const F = field();
    F.addBox(BLOCK.x, BLOCK.y, BLOCK.hw, BLOCK.hh);
    F.addCircle(700, 900, 40);
    const before = runRng.calls;
    chase(F, mob(500, 1100), PX, PY, 20);
    assert.equal(runRng.calls, before, 'steer() drew from runRng');
  });

  it('the same seed and the same start replay to the same pixel', () => {
    const one = field(); one.addBox(BLOCK.x, BLOCK.y, BLOCK.hw, BLOCK.hh);
    const two = field(); two.addBox(BLOCK.x, BLOCK.y, BLOCK.hw, BLOCK.hh);
    const a = mob(500, 1100, 7), b = mob(500, 1100, 7);
    chase(one, a, PX, PY, 20);
    chase(two, b, PX, PY, 20);
    assert.equal(a.x, b.x, 'two identical runs diverged in x');
    assert.equal(a.y, b.y, 'two identical runs diverged in y');
  });
});

// ---------------------------------------------------------------------------
describe('obstacles / sparse rubble is still barely noticed', () => {
  // The routing above must not turn a 40px crate into a 300px detour. Six of the
  // seven stages are scattered rubble and that is the case the steering was
  // tuned for in the first place.
  it('a single small blocker on the line costs almost nothing', () => {
    const F = field();
    F.addCircle(1500, 1100, 40);
    const e = mob(1000, 1100);
    const r = chase(F, e, 2000, 1100, 40);
    assert.lessThan(r.d, 60, `did not get past a 40px circle — ended ${r.d.toFixed(0)}px away`);
    // Straight line is 940px to the 60px reach. A tenth of that in detour is
    // generous; the old code cost about the same.
    assert.lessThan(r.path, 1200, `detoured ${(r.path - 940).toFixed(0)}px around a 40px circle`);
  });

  it('a lookahead scales with the piece, so small furniture keeps its old reach', () => {
    // The probe is `radius + avoidanceLookahead + avoidanceSizeScale * longest
    // half-extent`. For a 20px bin that is 62 + 9 = 71px — within 15% of the
    // 62px it was before this change. For a 500px block it is 287.
    const bin = 15.96 + feel.avoidanceLookahead + feel.avoidanceSizeScale * 20;
    const block = 15.96 + feel.avoidanceLookahead + feel.avoidanceSizeScale * 500;
    assert.lessThan(bin, 80, 'small furniture is now avoided from absurdly far away');
    assert.atLeast(block, 200, 'a 1000px block is still probed from inside one body-length');
  });
});

// ---------------------------------------------------------------------------
describe('obstacles / per-enemy steering state is pooled state', () => {
  it('the pooled enemy carries the three avoidance fields', () => {
    const e = makeEnemy();
    assert.equal(e.avoidSide, 0);
    assert.equal(e.avoidT, 0);
    assert.equal(e.avoidKey, 0);
  });

  it('a mob that has committed to a side actually stores it', () => {
    const F = field();
    F.addBox(1100, 1100, 500, 500);
    const e = mob(500, 1100);
    chase(F, e, 1700, 1100, 4);
    assert.notEqual(e.avoidSide, 0, 'nothing was committed, so the reset test below proves nothing');
    assert.atLeast(e.avoidT, 0, 'the commitment timer went negative');
    assert.notEqual(e.avoidKey, 0, 'no obstacle was keyed');
  });

  it('a recycled pool slot does not inherit the dead mob\'s committed side', () => {
    // The pool hands the same object straight back — `release` swap-and-pops and
    // `spawn` takes `items[count]` — and `resetEnemy` does not touch behaviour
    // scratch. So spawn() is the only thing standing between a fresh mob and a
    // dead one's decision to go north round a block it has never seen.
    storage.useMemory();
    save.load();
    save.data.shrine = {};
    for (const c of data.characters.CHARACTERS) {
      save.data.roster[c.id] = { owned: true, starLevel: 1, letters: 0, bond: 0, runs: 0, kills: 0 };
    }
    camera.resize(CONFIG.BASE_W, CONFIG.BASE_H);
    const run = new Run(data, {
      characterId: data.characters.CHARACTERS[0].id,
      stageId: data.stages.STAGES[0].id,
      tierIndex: 0,
      seed: 4242,
    });
    const def = data.enemies.ENEMIES[0];
    const first = run.enemies.spawn(def, 2200, 2000);
    assert.ok(first, 'could not spawn an enemy at all');
    first.avoidSide = -1; first.avoidT = 9; first.avoidKey = 12345;
    run.enemies.release(first);
    const second = run.enemies.spawn(def, 2400, 2000);
    assert.equal(second, first, 'the pool did not hand back the same slot — this proves nothing');
    assert.equal(second.avoidSide, 0, 'a fresh mob inherited a dead one\'s committed side');
    assert.equal(second.avoidT, 0, 'a fresh mob inherited a dead one\'s commitment timer');
    assert.equal(second.avoidKey, 0, 'a fresh mob inherited a dead one\'s committed obstacle');
    run.dispose();
  });
});

// ---------------------------------------------------------------------------
describe('obstacles / how deep a body can be buried, per field', () => {
  // `deepest` is what enemy.js asks before steering an OFF-SCREEN mob. It has to
  // be the SHORT axis: a 1800x200 courtyard wall can only ever swallow 100px of
  // a body however long it is, and paying for off-screen steering because of it
  // would be a tax on six stages to fix one.
  it('a long thin wall is shallow and a square block is deep', () => {
    const F = field();
    F.addBox(1000, 1000, 900, 100);              // 1800 x 200
    assert.equal(F.deepest, 100, 'a long wall reported its LENGTH as its depth');
    F.addBox(3000, 3000, 500, 500);              // 1000 x 1000
    assert.equal(F.deepest, 500);
    F.addCircle(200, 200, 44);
    assert.equal(F.deepest, 500, 'a small circle raised the deepest reading');
  });

  it('removing the deepest piece lowers the reading again', () => {
    const F = field();
    F.addBox(1000, 1000, 900, 100);
    const big = F.addBox(3000, 3000, 500, 500);
    assert.equal(F.deepest, 500);
    F.removeAt(big);
    assert.equal(F.deepest, 100, 'deepest survived the piece that set it — swap-and-pop was not remeasured');
    F.clear();
    assert.equal(F.deepest, 0, 'a cleared field still claims to be able to bury something');
  });
});
