// The gacha. This is the part players actually feel, so it is implemented
// exactly and unit-tested rather than approximated.
//
// DECISIONS.md §2 — the spec's soft pity ("+6%/pull from 51, always resolves by
// ~62") is arithmetically false: it reaches 80% at pull 62 and 100% at 67,
// leaving a dead zone before hard pity at 70. The fix pins the ramp so it
// reaches certainty EXACTLY at the hard-pity pull, and derives the step from the
// base rate so re-tuning rates can never desynchronise the curve from the
// guarantee. `rate5Plus` and `rate6` live in data/gacha.js; this file consumes
// them and owns the pull LOGIC.
//
// DECISIONS.md §8 — a banner's rarity weights are normalised over the rarities
// actually present in its pool, so the Standard banner's orphaned ★6 rate flows
// into ★5 instead of vanishing or being a second hardcoded table.
//
// ANTI-SAVE-SCUM (SECTION 6) — the meta RNG's seed and call counter are
// persisted BEFORE any result is shown. Reloading the page replays the same
// stream and yields the same pull.

import { metaRng } from '../core/rng.js';
import { save, rosterEntry, addCurrency, spendCurrency } from '../core/save.js';
import { events, EV } from '../core/events.js';

/** One pull result. */
function makeResult(kind, id, rarity, isNew, letters, featured) {
  return { kind, id, rarity, isNew, letters: letters || 0, featured: !!featured };
}

export class GachaEngine {
  constructor(data) {
    this.data = data;
    this.G = data.gacha;
  }

  banner(id) { return this.G.BANNERS.find((b) => b.id === id); }

  /** Which pity counter a banner reads. The ★5 counter is shared (SECTION 6). */
  _pityKey5(banner) {
    return this.G.PITY_SHARED_5_TYPES && this.G.PITY_SHARED_5_TYPES.includes(banner.type)
      ? '__shared5' : banner.id + ':5';
  }
  _pityKey6(banner) { return banner.id + ':6'; }

  pity(banner) {
    const g = save.data.gacha;
    const k5 = this._pityKey5(banner);
    const k6 = this._pityKey6(banner);
    return {
      since5: k5 === '__shared5' ? (g.sharedPity5 || 0) : (g.pity[k5] || 0),
      since6: g.pity[k6] || 0,
      guaranteedFeatured: !!g.guaranteedFeatured[banner.id],
      hard5: this.G.PITY.hard5,
      hard6: this.G.PITY.hard6,
      soft5: this.G.PITY.soft5,
      soft6: this.G.PITY.soft6,
    };
  }

  _setPity5(banner, v) {
    const g = save.data.gacha;
    const k = this._pityKey5(banner);
    if (k === '__shared5') g.sharedPity5 = v;
    else g.pity[k] = v;
  }
  _setPity6(banner, v) { save.data.gacha.pity[this._pityKey6(banner)] = v; }

  cost(banner, count) {
    const single = banner.costSingle !== undefined ? banner.costSingle : this.G.COST.single;
    const ten = banner.costTen !== undefined ? banner.costTen : this.G.COST.ten;
    const base = count >= 10 ? ten : single * count;
    return Math.round(base * (1 - (banner.discount || 0)));
  }

  canAfford(banner, count) {
    const c = this.cost(banner, count);
    const cur = banner.currency || this.G.COST.currency;
    return (save.data.currencies[cur] || 0) >= c;
  }

  /**
   * Roll one pull. Mutates pity state. Does NOT spend currency or persist —
   * `pull()` owns both, so a 10-pull is one transaction and one save.
   */
  rollOne(banner, ctx) {
    const G = this.G;
    const rates = this._effectiveRates(banner);

    const p5 = ctx.since5 + 1;
    const p6 = ctx.since6 + 1;

    // --- 6-star ---------------------------------------------------------------
    const has6 = banner.pool[6] && banner.pool[6].length > 0;
    let rarity = 0;
    if (has6) {
      const r6 = Math.min(1, G.rate6(p6));
      if (p6 >= G.PITY.hard6 || metaRng.raw() < r6) rarity = 6;
    }

    // --- 5-star+ --------------------------------------------------------------
    if (rarity === 0) {
      const r5 = Math.min(1, G.rate5Plus(p5));
      if (p5 >= G.PITY.hard5 || metaRng.raw() < r5) {
        // Resolved into the 5+ band. Split it between 6 and 5 by their relative
        // base weights — which is what makes a ★6 possible off the ★5 pity too.
        const w6 = has6 ? rates[6] : 0;
        const w5 = rates[5];
        rarity = (w6 > 0 && metaRng.raw() < w6 / (w6 + w5)) ? 6 : 5;
      }
    }

    // --- 4 vs 3 ---------------------------------------------------------------
    if (rarity === 0) {
      if (ctx.forceFourPlus) rarity = 4;
      else {
        const w4 = rates[4], w3 = rates[3];
        rarity = metaRng.raw() < w4 / (w4 + w3) ? 4 : 3;
      }
    }

    // --- pity bookkeeping -----------------------------------------------------
    ctx.since5 = rarity >= 5 ? 0 : p5;
    ctx.since6 = rarity >= 6 ? 0 : p6;
    if (rarity >= 4) ctx.gotFourPlus = true;

    // --- pick the character ---------------------------------------------------
    let pool = banner.pool[rarity];
    if (!pool || pool.length === 0) {
      // Degrade downward rather than returning nothing.
      for (let rr = rarity - 1; rr >= 3; rr--) {
        if (banner.pool[rr] && banner.pool[rr].length) { rarity = rr; pool = banner.pool[rr]; break; }
      }
      if (!pool || !pool.length) return makeResult('character', banner.pool[3][0], 3, false, 0, false);
    }

    let id = null;
    let featured = false;

    if (rarity === 6 && banner.featured6) {
      // The 50/50: a won 6★ is 50% the featured character; losing it guarantees
      // the NEXT 6★ is featured.
      if (ctx.guaranteedFeatured) { id = banner.featured6; featured = true; ctx.guaranteedFeatured = false; }
      else if (metaRng.raw() < (banner.rateUpChance === undefined ? 0.5 : banner.rateUpChance)) {
        id = banner.featured6; featured = true;
      } else {
        const others = pool.filter((x) => x !== banner.featured6);
        id = others.length ? others[metaRng.int(0, others.length - 1)] : banner.featured6;
        featured = id === banner.featured6;
        if (!featured) { ctx.guaranteedFeatured = true; ctx.lost5050 = true; }
      }
    } else if (rarity === 5 && banner.featured5 && banner.featured5.length) {
      // Featured ★5s share a 50% slice, matching the genre convention.
      if (metaRng.raw() < 0.5) {
        id = banner.featured5[metaRng.int(0, banner.featured5.length - 1)];
        featured = true;
      } else {
        id = pool[metaRng.int(0, pool.length - 1)];
        featured = banner.featured5.indexOf(id) >= 0;
      }
    } else {
      id = pool[metaRng.int(0, pool.length - 1)];
    }

    // --- new vs duplicate -----------------------------------------------------
    const entry = rosterEntry(id);
    const isNew = !entry.owned;
    let letters = 0;
    if (isNew) {
      entry.owned = true;
      entry.starLevel = Math.max(1, entry.starLevel || 1);
    } else {
      letters = this.G.DUPE_LETTERS[rarity] || 0;
      // FIX C (SECTION 18, shipped regardless): a ★3 already at S5 converts to
      // UNIVERSAL letters at full value instead of dead character-specific ones.
      if (this.G.THREE_STAR_OVERFLOW && rarity === 3 && (entry.starLevel || 1) >= 5) {
        save.data.currencies.universalLetters = (save.data.currencies.universalLetters || 0) + letters;
        return makeResult('character', id, rarity, false, letters, featured, true);
      }
      entry.letters = (entry.letters || 0) + letters;
    }
    return makeResult('character', id, rarity, isNew, letters, featured);
  }

  /** Normalised weights over the rarities actually present. DECISIONS.md §8. */
  _effectiveRates(banner) {
    const base = this.G.BASE_RATES;
    const out = { 3: 0, 4: 0, 5: 0, 6: 0 };
    let total = 0;
    for (const k of [3, 4, 5, 6]) {
      const has = banner.pool[k] && banner.pool[k].length > 0;
      out[k] = has ? base[k] : 0;
      total += out[k];
    }
    if (total <= 0) return base;
    if (banner.normalizeRates === false) return out;
    for (const k of [3, 4, 5, 6]) out[k] /= total;
    return out;
  }

  /**
   * Perform a pull of `count`. Spends currency, resolves pity, PERSISTS, and
   * only then returns the results for the reveal animation.
   * @returns {{results: Array, cost: number, error?: string}}
   */
  /**
   * Is this banner available? `unlockedBy` may name EITHER a key in
   * `save.data.unlocks` OR the achievement id that grants it — the data uses the
   * achievement id, the achievement's reward writes the unlocks key, and
   * checking only one of them left the relic banner permanently locked.
   */
  isUnlocked(banner) {
    const k = banner.unlockedBy;
    if (!k) return true;
    return !!(save.data.unlocks[k] || save.data.achievements[k] ||
              save.data.unlocks[banner.id] ||
              // the relic banner's key is `relicBanner`; its gate is an achievement id
              (banner.type === 'relic' && save.data.unlocks.relicBanner));
  }

  pull(banner, count) {
    const currency = banner.currency || this.G.COST.currency;
    const cost = this.cost(banner, count);

    // EVERY refusal must happen BEFORE spendCurrency. A relic banner reaching
    // the character roll used to spend the player's fragments and then throw on
    // `banner.pool[3][0]` — the worst possible ordering.
    if (banner.oneTime && save.data.gacha.beginnerUsed) {
      return { results: [], cost: 0, error: 'That banner is one-time only.' };
    }
    if (!this.isUnlocked(banner)) {
      return { results: [], cost: 0, error: 'Not unlocked yet.' };
    }
    if (banner.type === 'relic' || (banner.pool && banner.pool.relics && !banner.pool[3])) {
      return this.pullRelics(banner, count);
    }
    if (!banner.pool || !banner.pool[3] || banner.pool[3].length === 0) {
      return { results: [], cost: 0, error: 'That banner has no character pool.' };
    }
    if (!spendCurrency(currency, cost)) {
      return { results: [], cost, error: 'Not enough ' + currency + '.' };
    }

    const pity = this.pity(banner);
    const ctx = {
      since5: pity.since5, since6: pity.since6,
      guaranteedFeatured: pity.guaranteedFeatured,
      gotFourPlus: false, forceFourPlus: false, lost5050: false,
    };

    const results = [];
    for (let i = 0; i < count; i++) {
      // The 10-pull guarantee: if the last slot would otherwise be a ★3 and
      // nothing ≥★4 has landed, force it.
      ctx.forceFourPlus = (count >= 10 && i === count - 1 && !ctx.gotFourPlus);
      results.push(this.rollOne(banner, ctx));
    }

    // Beginner banner: guaranteed at least one ★5 within the first 10.
    if (banner.guarantee5Within && count >= banner.guarantee5Within) {
      if (!results.some((r) => r.rarity >= 5)) {
        const pool5 = banner.pool[5];
        if (pool5 && pool5.length) {
          const id = pool5[metaRng.int(0, pool5.length - 1)];
          const entry = rosterEntry(id);
          const isNew = !entry.owned;
          let letters = 0;
          if (isNew) entry.owned = true;
          else { letters = this.G.DUPE_LETTERS[5]; entry.letters = (entry.letters || 0) + letters; }
          results[results.length - 1] = makeResult('character', id, 5, isNew, letters, false);
          ctx.since5 = 0;
        }
      }
    }

    // --- commit ---------------------------------------------------------------
    this._setPity5(banner, ctx.since5);
    this._setPity6(banner, ctx.since6);
    save.data.gacha.guaranteedFeatured[banner.id] = ctx.guaranteedFeatured;
    save.data.gacha.totalPulls += count;
    if (banner.oneTime) save.data.gacha.beginnerUsed = true;

    const hist = save.data.gacha.history;
    for (const r of results) {
      hist.push({ id: r.id, rarity: r.rarity, banner: banner.id, isNew: r.isNew });
    }
    while (hist.length > this.G.PULL_HISTORY_MAX) hist.shift();

    if (ctx.lost5050) events.emit('gacha:lost5050');
    events.emit(EV.GACHA_PULL, results, banner);

    // Persist BEFORE the caller shows anything. This is the anti-save-scum rule.
    save.save();

    return { results, cost, lost5050: ctx.lost5050 };
  }

  /**
   * The Relic Banner. A separate roll path because relics are not characters and
   * share none of the rarity/pity machinery.
   *
   * DECISIONS.md §9: this does NOT gate relics — every relic is always in the
   * in-run drop pool, because M6 ships before M7 and all 8 evolutions require a
   * specific relic. Pulling BANKS a relic: a permanent 3x in-run drop weight
   * plus one guaranteed drop on the next run. It buys weight, not access.
   */
  pullRelics(banner, count) {
    const currency = banner.currency || this.G.COST.currency;
    const cost = this.cost(banner, count);
    const pool = (banner.pool && banner.pool.relics) || [];
    if (pool.length === 0) {
      return { results: [], cost: 0, error: 'That banner has no relic pool.' };
    }

    // Prefer relics not yet banked, so a near-complete collection does not pay
    // full price for duplicates it cannot use.
    const unbanked = pool.filter((id) => !(save.data.relics[id] && save.data.relics[id].banked));
    if (unbanked.length === 0) {
      return { results: [], cost: 0, error: 'Every relic is already banked.' };
    }
    if (count > unbanked.length) {
      return { results: [], cost: 0,
               error: `Only ${unbanked.length} relic${unbanked.length === 1 ? '' : 's'} left to bank.` };
    }
    if (!spendCurrency(currency, cost)) {
      return { results: [], cost, error: 'Not enough ' + currency + '.' };
    }

    const results = [];
    const remaining = unbanked.slice();
    for (let i = 0; i < count && remaining.length; i++) {
      const idx = metaRng.int(0, remaining.length - 1);
      const id = remaining.splice(idx, 1)[0];
      let entry = save.data.relics[id];
      if (!entry) entry = save.data.relics[id] = { owned: false, banked: false };
      const isNew = !entry.owned;
      entry.owned = true;
      entry.banked = true;
      results.push({ kind: 'relic', id, rarity: 5, isNew, letters: 0, featured: false });
    }

    save.data.gacha.totalPulls += results.length;
    const hist = save.data.gacha.history;
    for (const r of results) hist.push({ id: r.id, rarity: r.rarity, banner: banner.id, isNew: r.isNew });
    while (hist.length > this.G.PULL_HISTORY_MAX) hist.shift();

    events.emit(EV.GACHA_PULL, results, banner);
    // Persist before the caller shows anything — the same anti-save-scum rule.
    save.save();
    return { results, cost };
  }

  /** Spend Fan Letters to raise a character's star level. */
  raiseStar(charId) {
    const entry = rosterEntry(charId);
    const next = (entry.starLevel || 1) + 1;
    if (next > 5) return { ok: false, error: 'Already at S5.' };
    const cost = this.G.STAR_COSTS[next];
    const own = entry.letters || 0;
    const universal = save.data.currencies.universalLetters || 0;
    // Universal letters substitute at 2:1.
    const need = Math.max(0, cost - own);
    const universalNeed = need * this.G.UNIVERSAL_RATIO;
    if (own < cost && universal < universalNeed) {
      return { ok: false, error: `Need ${cost} 💌 (have ${own}, or ${universalNeed} universal).` };
    }
    if (own >= cost) entry.letters = own - cost;
    else {
      entry.letters = 0;
      save.data.currencies.universalLetters = universal - universalNeed;
    }
    entry.starLevel = next;
    save.save();
    return { ok: true, starLevel: next };
  }

  /** Owned-character count — Sora's Spirit Bomb scales off this. */
  ownedCount() {
    let n = 0;
    for (const k in save.data.roster) if (save.data.roster[k].owned) n++;
    return n;
  }
}

export function createGacha(data) { return new GachaEngine(data); }
