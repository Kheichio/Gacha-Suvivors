// The data layer aggregator.
//
// Everything gameplay reads about content comes through this one object, so a
// scene never imports a content file directly and the whole layer can be swapped
// (for a test fixture, or for a mod pack) by handing a different object to Run.
//
// ALSO: this is where refs are JOINED BACK ON. Every content file is written
// without a single `ref` string (DECISIONS.md §22); `refs.js` holds them all,
// keyed by id, and is the one file a shipping build deletes. If it is absent,
// `attachRefs` no-ops and `displayName()` degrades to the plain name with no
// other code change anywhere.

import * as characters from './characters.js';
import * as enemies from './enemies.js';
import * as stages from './stages.js';
import * as waves from './waves.js';
import * as upgrades from './upgrades.js';
import * as weapons from './weapons.js';
import * as quests from './quests.js';
import * as relics from './relics.js';
import * as evolutions from './evolutions.js';
import * as gacha from './gacha.js';
import * as bosses from './bosses.js';
import * as achievements from './achievements.js';
import * as shrine from './shrine.js';
import * as elements from './elements.js';
// NOT behind the try/catch below: shipNames.js is the one naming table a ship
// build KEEPS (DECISIONS.md §22.3). refs.js is deleted; the renames it triggers
// are not, or DEV_MODE=false would print the source-IP names it exists to hide.
import { SHIP_NAMES } from './shipNames.js';
import { spriteFor } from './sprites.js';
// Namespace import as well as the named one: the portrait art is optional, and a
// missing NAMED export is a module-link error that would take the whole boot
// down rather than degrading to "no portrait".
import * as spriteDefs from './sprites.js';

let refs = null;
try {
  refs = await import('./refs.js');
} catch (e) {
  // A shipping build deletes refs.js outright. This is the expected path there,
  // not an error — the game runs identically with every ref name gone.
  refs = null;
}

/**
 * Attach `ref` / `refSource` / `refNotes` to every content object that has an
 * entry. Runs once, at boot. Content files stay ref-free on disk.
 */
function attachRefs() {
  if (!refs || !refs.REFS) return 0;
  let n = 0;
  const tables = [
    characters.CHARACTERS, enemies.ENEMIES, stages.STAGES,
    relics.RELICS, bosses.BOSSES,
  ];
  for (const table of tables) {
    if (!table) continue;
    for (const entry of table) {
      const r = refs.REFS[entry.id];
      if (!r) continue;
      entry.ref = r.ref;
      entry.refSource = r.refSource;
      entry.refNotes = r.refNotes;
      n++;
    }
  }
  return n;
}

/**
 * Ship-safe renames for ability and relic names that are verbatim source IP
 * (DECISIONS.md §22.3 — the DEV_MODE flag covers abilities and relics too, not
 * only character names).
 *
 * Deliberately NOT part of attachRefs(): that function returns early when
 * refs.js is absent, which is the ship build — the one build where these
 * renames are the entire point. Abilities are nested inside a character object
 * so they are joined here; relics also carry `shipName` inline in relics.js and
 * the two tables must agree.
 */
function attachShipNames() {
  let n = 0;
  for (const c of characters.CHARACTERS) {
    for (const key of ['autoAttack', 'special', 'escape', 'passive']) {
      const a = c[key];
      if (a && SHIP_NAMES[a.id]) { a.shipName = SHIP_NAMES[a.id]; n++; }
    }
  }
  for (const r of relics.RELICS) {
    if (SHIP_NAMES[r.id]) { r.shipName = SHIP_NAMES[r.id]; n++; }
  }
  return n;
}

/**
 * Attach a PIXEL SPRITE descriptor to every character, enemy and boss.
 *
 * Content files describe an entity's colour and silhouette shape; sprites.js
 * describes what it actually LOOKS like. Joining them here means neither file
 * has to know about the other, and replacing sprites.js with real art is a
 * one-file change — the drop-in path SECTION 1 asked for.
 *
 * Projectiles, gems and pickups deliberately keep their procedural geometry:
 * a clean bright shard reads better in a screen full of sprites than a tiny
 * sprite would, and they are the highest-count things on screen.
 */
function attachSprites() {
  let n = 0;
  const join = (kind, list) => {
    for (const e of list) {
      const d = spriteFor(kind, e);
      if (d && e.visual) { e.visual.pixel = d; n++; }
    }
  };
  join('character', characters.CHARACTERS);
  join('enemy', enemies.ENEMIES);
  join('boss', bosses.BOSSES);
  // ALTERNATE FORMS. A character that becomes something else for the duration of
  // an ability declares the second silhouette as `altForm` (Alicia's dragon is
  // the only one today). It is keyed on its OWN `spriteId`, never the character
  // id: the atlas keys pixel sprites on the descriptor id, so reusing hers would
  // hand back the cached human at dragon size with no error anywhere — the same
  // trap portraitFor() documents.
  //
  // Degrades on purpose. If sprites.js carries no entry for the form yet,
  // spriteFor returns null, the visual keeps its procedural capsule, and the
  // form still renders — just not yet as art.
  for (const c of characters.CHARACTERS) {
    const f = c.altForm;
    if (!f || !f.visual || !f.spriteId) continue;
    const d = spriteFor('character', { id: f.spriteId });
    if (d) { f.visual.pixel = d; n++; }
  }
  return n;
}

/**
 * Attach a HD PORTRAIT descriptor to every character.
 *
 * The world sprite is 24px of pixel art seen from across an arena; the HUD sits
 * two inches from the player's eye for twenty minutes and deserves its own,
 * much more detailed, bust. It is a separate atlas entry with its own id —
 * registerPixel keys on `'px|' + descriptor.id + '|' + size`, so reusing the
 * character's own id would silently hand back the world sprite instead.
 */
function attachPortraits() {
  const make = spriteDefs.portraitFor;
  if (typeof make !== 'function') return 0;
  const size = spriteDefs.PORTRAIT_SIZE || 26;
  let n = 0;
  for (const c of characters.CHARACTERS) {
    const d = make(c);
    if (!d) continue;
    c.portrait = { shape: 'circle', color: c.visual.color, size, pixel: d, flash: false };
    n++;
  }
  return n;
}

const refsAttached = attachRefs();
const shipNamesAttached = attachShipNames();
const spritesAttached = attachSprites();
const portraitsAttached = attachPortraits();

/** Every distinct visual descriptor in the game, for the boot-time pre-raster. */
export function allVisuals() {
  const out = [];
  const push = (v) => { if (v) out.push(v); };
  for (const c of characters.CHARACTERS) {
    push(c.visual);
    push(c.portrait);
    // The transformed silhouette bakes with everything else. It is cast exactly
    // once per run, at the loudest moment in the game, and that is the worst
    // possible frame to discover a sprite has never been rastered.
    if (c.altForm) push(c.altForm.visual);
  }
  for (const e of enemies.ENEMIES) push(e.visual);
  for (const v of weapons.weaponVisuals()) push(v);
  for (const b of bosses.BOSSES) push(b.visual);
  for (const r of relics.RELICS) push(r.visual);
  for (const e of evolutions.EVOLUTIONS) push(e.visual);
  for (const p of upgrades.PICKUPS) push(p.visual);
  for (const g of upgrades.XP_GEMS) push(g.visual);
  // Obstacle sets. These are joined in here rather than hand-listed in
  // prewarm.js's EFFECT_VISUALS for the same reason the particle palette is
  // harvested rather than written out: a hand-kept copy of a data table goes
  // stale the moment content is added to it, and the cost of missing one is a
  // sprite rasterising on the frame a player first walks past a crate.
  for (const k in stages.OBSTACLE_SETS) push(stages.OBSTACLE_SETS[k].visual);
  return out;
}

/** Sanity checks that run at boot in dev and as a unit test in CI. */
export function validate() {
  const problems = [];
  const has = (map, id, what) => { if (!map[id]) problems.push(`${what}: unknown id "${id}"`); };

  for (const c of characters.CHARACTERS) {
    has(relics.RELICS_BY_ID, c.signatureRelic, `character ${c.id}.signatureRelic`);
    // The relic has to point back. A signature relic names its owner and the
    // owner names the relic, and only checking one direction lets a relic sit
    // on the roster owned by somebody who has never heard of it — which the
    // resonance bonus then pays to the wrong character, silently.
    const sig = relics.RELICS_BY_ID[c.signatureRelic];
    if (sig && sig.owner !== c.id) {
      problems.push(`character ${c.id}.signatureRelic "${c.signatureRelic}" is owned by "${sig.owner}"`);
    }
    for (const k of ['autoAttack', 'special', 'escape', 'passive']) {
      if (!c[k] || !c[k].id) problems.push(`character ${c.id} is missing ${k}`);
    }
    // An alternate form names the ability it lasts for, in both directions, so
    // that renaming either half fails the boot instead of leaving a character
    // who transforms into nothing.
    if (c.altForm) {
      const f = c.altForm;
      if (!f.visual) problems.push(`character ${c.id}.altForm has no visual to draw or pre-raster`);
      if (!f.spriteId) problems.push(`character ${c.id}.altForm declares no spriteId`);
      else if (f.spriteId === c.id) {
        problems.push(`character ${c.id}.altForm.spriteId must differ from the character id`);
      }
      const owns = ['autoAttack', 'special', 'escape', 'passive']
        .some((k) => c[k] && c[k].id === f.id);
      if (!owns) problems.push(`character ${c.id}.altForm "${f.id}" is not one of her own abilities`);
    }
  }

  // RARITY BUCKETS. CHARACTERS_BY_RARITY is the only place membership is written
  // down and every character also carries its own `rarity`; two hand-kept tables
  // that must agree is exactly the shape of edit that gets half-done. Akane's
  // ★5 -> ★6 promotion had to touch both and Usaki's authoring had to add to
  // both, so the disagreement is caught here, at boot, rather than on the pull
  // screen — where a character in two buckets rolls off two different rates and
  // prints two different beam colours for one result.
  const bucketOf = {};
  for (const r of [3, 4, 5, 6]) {
    for (const id of characters.CHARACTERS_BY_RARITY[r] || []) {
      const c = characters.CHARACTERS_BY_ID[id];
      if (!c) { problems.push(`CHARACTERS_BY_RARITY[${r}]: unknown character "${id}"`); continue; }
      if (c.rarity !== r) problems.push(`character ${id} declares rarity ${c.rarity} but sits in bucket ${r}`);
      if (bucketOf[id] !== undefined) {
        problems.push(`character ${id} sits in rarity buckets ${bucketOf[id]} and ${r} at once`);
      }
      bucketOf[id] = r;
    }
  }
  for (const c of characters.CHARACTERS) {
    if (bucketOf[c.id] === undefined) {
      problems.push(`character ${c.id} is in no rarity bucket and can never be pulled`);
    }
  }

  // GACHA POOLS. Every banner is a third hand-written copy of the roster, so the
  // same promotion that desynchronises the buckets desynchronises these — and a
  // pool holding an id at the wrong rarity is not a rarer character, it is a bug
  // the pull screen cannot report.
  for (const b of gacha.BANNERS) {
    const pool = b.pool || {};
    for (const r of [3, 4, 5, 6]) {
      for (const id of pool[r] || []) {
        const c = characters.CHARACTERS_BY_ID[id];
        if (!c) { problems.push(`banner ${b.id} pool[${r}]: unknown character "${id}"`); continue; }
        if (c.rarity !== r) problems.push(`banner ${b.id} pool[${r}] holds ${id}, who is ★${c.rarity}`);
      }
    }
    if (b.featured6) {
      const c = characters.CHARACTERS_BY_ID[b.featured6];
      if (!c) problems.push(`banner ${b.id}.featured6: unknown character "${b.featured6}"`);
      else if (c.rarity !== 6) problems.push(`banner ${b.id} features ★${c.rarity} ${b.featured6} as its ★6`);
      else if ((pool[6] || []).indexOf(b.featured6) < 0) {
        // Losing the 50/50 draws from the pool, and `guaranteedOnLoss` then
        // promises the featured character next. If she is not IN the pool the
        // banner advertises a character its own roll can never return.
        problems.push(`banner ${b.id} features ${b.featured6} but omits her from its ★6 pool`);
      }
    }
    for (const id of b.featured5 || []) {
      const c = characters.CHARACTERS_BY_ID[id];
      if (!c) { problems.push(`banner ${b.id}.featured5: unknown character "${id}"`); continue; }
      // A ★6 in a featured5 list is unreachable code — the ★5 branch never draws
      // her — and the banner copy promises a result the roll cannot return. That
      // is precisely what Akane's promotion left behind in the Tournament Arc.
      if (c.rarity !== 5) problems.push(`banner ${b.id} features ★${c.rarity} ${id} among its ★5s`);
    }
    const rp = pool.relics;
    if (rp) {
      for (const id of rp) has(relics.RELICS_BY_ID, id, `banner ${b.id} relic pool`);
      // A stale `completesAt` retires the banner one relic early and the last
      // relic becomes unbankable with no error anywhere.
      if (b.completesAt !== rp.length) {
        problems.push(`banner ${b.id}.completesAt is ${b.completesAt} but its pool holds ${rp.length} relics`);
      }
    }
  }
  for (const s of stages.STAGES) {
    if (s.boss) has(bosses.BOSSES_BY_ID, s.boss, `stage ${s.id}.boss`);
    if (s.midBoss) has(bosses.BOSSES_BY_ID, s.midBoss, `stage ${s.id}.midBoss`);
    for (const m of s.mobTable || []) has(enemies.ENEMIES_BY_ID, m.id, `stage ${s.id}.mobTable`);
    for (const h of s.hazards || []) { if (!stages.HAZARDS[h]) problems.push(`stage ${s.id}: unknown hazard "${h}"`); }
    if (s.modifier && !stages.MODIFIERS[s.modifier]) problems.push(`stage ${s.id}: unknown modifier "${s.modifier}"`);
    // The three registry keys added with the backdrop/obstacle/event pass. All
    // three are REQUIRED, not optional: a stage that silently falls back to the
    // default look is exactly the "every stage is the same grid in four hex
    // codes" failure this pass exists to end, and a missing key would produce it
    // with no error anywhere.
    if (!s.backdrop) problems.push(`stage ${s.id} declares no backdrop`);
    else if (!stages.BACKDROPS[s.backdrop]) problems.push(`stage ${s.id}: unknown backdrop "${s.backdrop}"`);
    if (!s.obstacles) problems.push(`stage ${s.id} declares no obstacle set`);
    else if (!stages.OBSTACLE_SETS[s.obstacles]) {
      problems.push(`stage ${s.id}: unknown obstacle set "${s.obstacles}"`);
    }
    if (!s.events || !s.events.length) problems.push(`stage ${s.id} has no mini events`);
    for (const e of s.events || []) {
      const def = stages.STAGE_EVENTS[e];
      if (!def) { problems.push(`stage ${s.id}: unknown event "${e}"`); continue; }
      if (stages.STAGE_EVENT_KINDS.indexOf(def.kind) < 0) {
        problems.push(`event ${e}: unknown kind "${def.kind}"`);
      }
    }
  }

  // A backdrop with a missing colour role draws that element in `undefined`,
  // which Canvas silently ignores — an invisible layer with no error.
  for (const k in stages.BACKDROPS) {
    const b = stages.BACKDROPS[k];
    for (const role of ['far', 'farEdge', 'farLit', 'mid', 'midEdge', 'tile', 'seam', 'detail', 'glow']) {
      if (!b[role]) problems.push(`backdrop ${k} is missing the "${role}" colour`);
    }
  }

  // An obstacle set with no `forms` scatters nothing, and one whose circular
  // pieces have no `visual` cannot be pre-rastered — it would bake mid-run.
  for (const k in stages.OBSTACLE_SETS) {
    const o = stages.OBSTACLE_SETS[k];
    if (!o.count) continue;
    if (!o.forms || !o.forms.length) problems.push(`obstacle set ${k} places ${o.count} pieces of nothing`);
    if (!o.box) problems.push(`obstacle set ${k} has no box colours`);
    let wantsCircle = false;
    for (const f of o.forms || []) {
      if (f.form === 'circle') wantsCircle = true;
      else if (f.form !== 'box') problems.push(`obstacle set ${k}: unknown form "${f.form}"`);
    }
    if (wantsCircle && !o.visual) problems.push(`obstacle set ${k} rolls circles but declares no visual`);
  }

  // An event that pays nothing is a detour with no reason to take it.
  for (const id in stages.STAGE_EVENTS) {
    const e = stages.STAGE_EVENTS[id];
    const r = e.reward;
    if (!r || !(r.xpLevels || r.gold || r.chest || r.goldChest || r.healPct)) {
      problems.push(`event ${id} pays nothing`);
    }
    if (!e.objective) problems.push(`event ${id} never says what to do`);
    const p = e.params || {};
    if (!(p.need > 0)) problems.push(`event ${id} has no win condition (need)`);
    if (!(p.limit > 0)) problems.push(`event ${id} has no time limit`);
    if (!(p.radius > 0)) problems.push(`event ${id} has no marked area`);
  }
  for (const e of evolutions.EVOLUTIONS) {
    has(upgrades.UPGRADES_BY_ID, e.requires.upgrade, `evolution ${e.id}.requires.upgrade`);
    has(relics.RELICS_BY_ID, e.requires.relic, `evolution ${e.id}.requires.relic`);
  }
  for (const q of quests.QUESTS) {
    if (!q.track || quests.TRACK_KINDS.indexOf(q.track.kind) < 0) {
      problems.push(`quest ${q.id}: unknown track kind "${q.track && q.track.kind}"`);
    }
    if (!q.reward || Object.keys(q.reward).length === 0) problems.push(`quest ${q.id} pays nothing`);
    if (!q.rewardText) problems.push(`quest ${q.id} does not say what it pays`);
  }
  for (const w of weapons.WEAPONS) {
    if (!w.levels || w.levels.length !== 8) problems.push(`weapon ${w.id} must have 8 levels`);
    if (!w.evolution) problems.push(`weapon ${w.id} has no evolution`);
    if (!w.visual) problems.push(`weapon ${w.id} has no visual to pre-raster`);
  }
  for (const sid in waves.WAVES) {
    if (!stages.STAGES_BY_ID[sid]) problems.push(`waves: unknown stage "${sid}"`);
    for (const w of waves.WAVES[sid]) {
      if (!w.enemy) continue;
      if (!enemies.ENEMIES_BY_ID[w.enemy] && !bosses.BOSSES_BY_ID[w.enemy]) {
        problems.push(`waves[${sid}] @${w.t}: unknown enemy "${w.enemy}"`);
      }
    }
  }
  return problems;
}

export const data = {
  characters, enemies, stages, waves, upgrades, weapons, quests, relics, evolutions,
  gacha, bosses, achievements, shrine, elements,
  refs, refsAttached, shipNamesAttached, portraitsAttached,
  allVisuals, validate,
};

export {
  characters, enemies, stages, waves, upgrades, weapons, quests, relics, evolutions,
  gacha, bosses, achievements, shrine, elements, refs,
};
export { quests as questData };

export default data;
