// THE SHRINE — 21 permanent meta upgrades bought with GOLD, plus bond levels and
// the SECTION 5 currency award table.
//
// SPEC: SECTION 12 (prompt lines 1573-1597). Every stated per-level value on the
// FIRST NINE rows is verbatim from lines 1574-1585. SECTION 5's award numbers are
// verbatim from DECISIONS.md §1's resolved table. The twelve rows after those nine
// are not in the spec at all and say so, loudly, in their own block below.
//
// THE SPEC LISTED TEN. The tenth was BANISH and it is gone, so that the count
// above is nine and not ten. It was not a balance call and not a taste call: the
// level-up screen passed `ui.focus` — the flat WIDGET index, which at the moment
// the BANISH button fires is always the banish button's own index — into
// run.banishUpgrade(index), which reads it as a CARD index. `levelUpChoices[4]`
// on a three-card screen is undefined, so the method returned false before
// decrementing anything, every time, for the life of the project. The row sold
// up to 25,200 gold of a counter that could not be spent once. Saves that bought
// it are refunded by save.js's v2 -> v3 migration.
//
// PURE DATA. The shrine screen and the run-setup stat pipeline read this file;
// nothing here knows how either works. No ref strings live here (DECISIONS.md §22).
//
// ---------------------------------------------------------------------------
// UPGRADE SCHEMA
//   id/name/icon  card face. Ids are consumed by save.shrine (`id -> level`).
//   maxLevel      levels purchasable, spec levels plus DEEP TIER (see below).
//   specLevels    the spec's own ceiling for this row. Documentation only —
//                 nothing reads it — but it is the line between "the shrine the
//                 spec described" and everything bolted on top of it, and without
//                 it that line is unrecoverable a year from now. ZERO means the
//                 spec never had this row: it is not a row whose ceiling was
//                 raised, it is a row that did not exist.
//   stat          the single stat key the engine applies this to. Deliberately
//                 reuses the keys already live in the stat pipeline (upgrades.js
//                 and the MODIFIERS params in stages.js) rather than inventing
//                 synonyms — `goldMult` is the same bucket Cursed Coin feeds.
//   perLevel      amount applied per level. Signed: Haste is negative, because
//                 a smaller cooldown multiplier is a shorter cooldown.
//   levelTotals   OPTIONAL, and only on Mending. The ACCUMULATED value at each
//                 level, so the row can RAMP instead of paying the same amount
//                 every time. Exactly the field upgrades.js documents, read
//                 through the same totalAt()/deltaAt() pair — one definition of
//                 what a ramped row is worth, shared by both data files, because
//                 two implementations of it is two chances to disagree with the
//                 stat the player actually gets. Absent = flat = perLevel * level,
//                 which is every other row here.
//   mode          'add'  additive into a multiplier bucket: final = base * (1 + Σ)
//                 'flat' straight onto the raw stat:        final = base + Σ
//                 Same two modes as upgrades.js, same shared application path
//                 (DECISIONS.md §36 — no per-upgrade branching anywhere).
//   unit          how `perLevel` READS on the card, independently of how it is
//                 APPLIED: 'percent' prints it multiplied by 100, 'flat' prints
//                 it as authored. It defaults to percent for `add` and flat for
//                 `flat`, which is why the spec's ten rows all omit it.
//                 It exists because critChance is a PROBABILITY. It is added
//                 straight onto the stat exactly like a flat row, and a player
//                 reads it as "+1%", and until this field existed those two facts
//                 could not both be true — the card would either have applied a
//                 hundredfold or printed "+0.01%". upgrades.js has carried the
//                 same field, with the same two values, since the beginning; this
//                 is that vocabulary, not a new one.
//   effects       ONLY on an upgrade that moves two stats at once. Two do: Curse
//                 and Glass Edge. When `effects` is present the engine applies
//                 every entry and ignores stat/perLevel/mode/unit, which are then
//                 absent; each entry carries its own stat/perLevel/mode/unit.
//   scope         'run' marks a row that the RUN reads for itself out of
//                 save.data.shrine when it starts (run.js), rather than one the
//                 player stat pipeline applies. Rerolls and Curse are the two,
//                 and the marker is not decoration: player.js walks this whole
//                 list, and before the marker existed it fed `freeRerolls` into
//                 _applyStat(), which does not know that key and answered the
//                 only way it can — with the "unknown stat" warning it exists to
//                 raise for upgrades that silently do nothing. The upgrade
//                 worked; run.js had already read it. But every dev session
//                 opened with a false positive from the project's one honest
//                 alarm about dead stat keys, which is the exact way an alarm
//                 stops being read. `scope: 'run'` is the row telling the
//                 pipeline, truthfully, that it is not talking to it.
//   baseCost      gold for level 1.
//   costGrowth    geometric growth. Cost of level n (1-indexed) is
//                 round(baseCost * costGrowth^(n-1)).
//   desc          what it does, in real numbers. No adjectives standing in for a
//                 quantity, ever.
//   fmt           running-total phrase for the card. {v} = accumulated display
//                 value, i.e. perLevel * level, percentages already × 100.
//                 {v2} is the second entry of `effects`. The value prints its own
//                 sign, so a negative row's fmt carries no leading '+'.
//   warning       optional second line on the card, rendered in the caution
//                 colour. Curse and Glass Edge carry one, and it is not
//                 decoration — SECTION 12 orders that kind of row labelled
//                 honestly, and a row with a real cost that does not say so is a
//                 lie with a price tag on it.
//   lockedBy      optional save.unlocks flag that must be true to buy this at all.
//                 Curse and Glass Edge both carry `curse` (DECISIONS.md §24).
//
// COSTS. Might's curve is the spec's, verbatim: 100 * 1.55^n. Everything else is
// priced against that anchor and against SECTION 14's "a full 20-minute run awards
// 250-450 gold":
//   - Vitality matches Might exactly. They are the two core rows and one being
//     cheaper would just tell players which to buy first.
//   - Fortune and Insight are the cheapest per level because they compound into
//     everything else; making them expensive taxes the player twice.
//   - Rerolls doubles each level, and the last one should sting.
//   - Revival is the spec's stated "expensive": 2,500 then 6,000 then 14,400.
//   - Curse is cheap on purpose. It is a handicap you are choosing.
//
// ---------------------------------------------------------------------------
// THE DEEP TIER
// ---------------------------------------------------------------------------
// Play report: "create more use for gold coins, its too easy to get and too
// little to do with it." It was right. The spec's rows totalled 56 levels and
// ~62,900 gold — twenty-odd good runs and the entire meta layer was finished
// forever, after which every coin picked up off the floor was decoration.
// (59 levels and ~65,700 while Banish was still a row; its three spec levels
// cost 400/800/1,600.)
//
// So every row keeps its spec levels EXACTLY as priced and then keeps going. The
// deep tier is not a second, gentler curve: it is the SAME geometric curve run
// further out, which is what makes it steep. Might's tenth level costs 5,164
// gold; its fifteenth costs 46,200. Greed's fifth costs 2,088; its tenth costs
// 29,647. Nothing about the early shrine changed, and nothing in the deep tier is
// a rounding error.
//
//   row        spec  ->  max     deep-tier gold     row total
//   might        10  ->  15         115,647          130,018
//   vitality     10  ->  15         115,647          130,018
//   alacrity      5  ->  10          24,867           27,238
//   fortune       8  ->  14          63,912           69,823
//   insight       8  ->  14          63,912           69,823
//   rerolls       3  ->   6          22,400           25,200
//   revival       2  ->   3          14,400           22,900
//   greed         5  ->  10          66,928           71,641
//   curse         5  ->  10          30,043           34,000
//   ----------------------------------------------------------
//   56 levels ->  97                517,756          580,661
//
// BANISH was a tenth row here — 3 -> 6 levels, 22,400 deep, 25,200 total — and
// its removal is why every figure in this block is 6 levels and 25,200 gold
// lighter than it used to be. See the header for why the row went.
//
// ~581,000 gold, up from ~62,900: 41 new levels and 9.2x the demand. Fortune and
// Curse both feed the wallet that pays for the rest, so the curve is a long climb
// rather than a wall — and the refund below is still free, still total, so none of
// the deep tier is a purchase anyone is stuck with.
//
// Revival stops at 3 and not one level higher because THREE IS THE ENGINE'S HARD
// CAP: run.js resolves at most three revives per run across every source
// (DECISIONS.md §29). A fourth level would be a row that takes 34,000 gold and
// does nothing, which is the single most dishonest thing a shop can sell.
//
// ---------------------------------------------------------------------------
// THE TWELVE THAT WERE NEVER IN THE SPEC
// ---------------------------------------------------------------------------
// The deep tier fixed the AMOUNT of gold the shrine could absorb and changed
// nothing about the DECISION. Ten rows, of which two were core, two were economy
// and four were single-purchase utilities, means that after the first few runs
// every visit to this screen is the same visit: put it in Might, put it in
// Vitality, come back later. A sink is not a choice. Making the sink deeper made
// the same non-choice cost more.
//
// So these twelve are chosen by AXIS, not by size. Every one of them moves a stat
// the run genuinely reads — checked one by one against player.js STAT_KEYS /
// MULT_TO_BASE and then against the consumer downstream, because this codebase has
// already shipped an upgrade that wrote to a field nothing read and stayed broken
// for the entire life of the project:
//
//   precision  critChance        damage.js rolls it on every hit
//   ferocity   critMult          damage.js multiplies by it when that roll wins
//   tempo      attackSpeedMult   run.js auto-timer + weapons.js every slot
//   expanse    areaMult          helpers.js area(), every arc/blast/orbit/aura
//   lodestar   pickupRadiusMult  bridged to pickupRadius; pickup.js magnet test
//   mending    regen             player.js update(), and the HUD's green band
//   bulwark    armor             damage.js subtracts it from every incoming hit
//   evasion    dodge             damage.js rolls it before anything else
//   haste      cooldownMult      player.js reconfigures SPECIAL and ESCAPE
//   bodkin     pierce            helpers.js pierce(), every projectile
//   volley     projectileCount   helpers.js count(), auto-attack and weapons
//   glass      damageMult + maxHpMult, both core buckets, in opposite directions
//
// PRICING. Level 1 of a new row is 110-320 gold — inside a single completed run,
// on purpose. The point of twelve rows is that an ordinary run's 250-450 gold now
// buys a DECISION instead of a fraction of a Might level, and the cheap first
// levels are what make the screen worth reading again. From there each row runs
// the same geometric curve the spec's rows run, so the far end is genuinely far:
// Tempo's twelfth level is 24,813 gold on its own.
//
// The two exceptions are priced as what they are. Bodkin (+1 pierce) and Volley
// (+1 projectile) are the only rows here that change what a weapon DOES rather
// than how much of it there is, they are the two the in-run pool deliberately
// rations (Extra Shot is 4 levels at epic weight, Piercing Will is 5 at rare), and
// a permanent copy of either has to cost like the endgame purchase it is. Volley
// is 5,000 then 15,000 and stops: three permanent projectiles would out-scale
// every weapon in the game at once.
//
//   row         levels   L1      Lmax      row total
//   precision     10     200    10,328       28,742
//   ferocity      10     150     5,767       17,000
//   tempo         12     200    24,813       69,563
//   expanse       12     180    19,359       55,545
//   lodestar      10     110     3,117        9,797
//   mending       10     220    11,361       31,618
//   bulwark       10     260    15,955       43,015
//   evasion        8     320     9,370       23,966
//   haste         10     260    17,867       47,212
//   bodkin         3   1,200     5,808        9,648
//   volley         2   5,000    15,000       20,000
//   glass         10     300    11,533       34,000
//   -----------------------------------------------------
//   107 levels                              390,106
//
// 103 levels / 605,861 gold becomes 210 levels / 995,967 — just under a million,
// which at a good run's 400 gold is a number no one finishes by accident. Nothing
// in the first ten rows moved by a single coin.
//
// GLASS EDGE is the second risk row and it is deliberately a DIFFERENT risk from
// Curse. Curse asks "can you handle twice as many enemies", and it pays in gold,
// XP and Star Fragments — it is an economy bet. Glass Edge asks "can you avoid
// being hit at all", and it pays in damage — it is a survival bet, and the only
// row on the screen that can make you strictly worse. It shares Curse's gate for
// the same reason it shares its shape: `kill_10000_enemies` is the game's proof
// that a player has seen enough of it to be offered a knife. Vitality is the only
// thing that buys the HP back, which makes those two rows an argument with each
// other, which is the entire point of putting them on the same screen.
// ---------------------------------------------------------------------------

export const SHRINE_UPGRADES = [
  {
    id: 'might', name: 'Might', icon: '⚔', maxLevel: 15, specLevels: 10,
    stat: 'damageMult', perLevel: 0.02, mode: 'add',
    baseCost: 100, costGrowth: 1.55,
    desc: '+2% damage per level, fifteen levels deep. The last five cost more than the first ten put together.',
    fmt: '+{v}% damage',
  },
  {
    // `maxHpMult` is the multiplicative sibling of the flat `maxHp` Iron Body
    // feeds. A percentage has to scale with the character, or +3% of Mochi's 100
    // and +3% of a 6-star's pool would be the same upgrade wearing two hats.
    id: 'vitality', name: 'Vitality', icon: '❤', maxLevel: 15, specLevels: 10,
    stat: 'maxHpMult', perLevel: 0.03, mode: 'add',
    baseCost: 100, costGrowth: 1.55,
    desc: '+3% max HP per level, fifteen levels deep. +45% at the top.',
    fmt: '+{v}% max HP',
  },
  {
    id: 'alacrity', name: 'Alacrity', icon: '👟', maxLevel: 10, specLevels: 5,
    stat: 'moveSpeedMult', perLevel: 0.02, mode: 'add',
    baseCost: 150, costGrowth: 1.60,
    desc: '+2% move speed per level, ten levels deep. In a game where not being touched is the defence, this is a defensive row.',
    fmt: '+{v}% move speed',
  },
  {
    // Fortune pays for its own deep tier and then for everyone else's, which is
    // exactly why it is allowed to go this far: a gold sink that also raises gold
    // income is a loop the player can actually run, not a toll.
    id: 'fortune', name: 'Fortune', icon: '🪙', maxLevel: 14, specLevels: 8,
    stat: 'goldMult', perLevel: 0.03, mode: 'add',
    baseCost: 120, costGrowth: 1.50,
    desc: '+3% gold gain per level, fourteen levels deep. +42% at the top, which is how the rest of this screen gets paid for.',
    fmt: '+{v}% gold',
  },
  {
    // The one row that pushes back against the XP curve's soft cap. It is
    // deliberately buyable rather than free: levelling faster is a thing you earn
    // across runs now, not a thing the curve hands you inside one.
    id: 'insight', name: 'Insight', icon: '📖', maxLevel: 14, specLevels: 8,
    stat: 'xpMult', perLevel: 0.02, mode: 'add',
    baseCost: 120, costGrowth: 1.50,
    desc: '+2% XP gain per level, fourteen levels deep. +28% at the top — the only permanent answer to the late-game XP curve.',
    fmt: '+{v}% XP',
  },
  {
    // `freeRerolls` is the same key LEVELUP starts at 1 in upgrades.js, and
    // run.js adds this row's level to it at start-of-run. `scope: 'run'` is what
    // keeps the player stat pipeline from trying to apply a key it has never
    // heard of — see the schema note above.
    id: 'rerolls', name: 'Rerolls', icon: '🔄', maxLevel: 6, specLevels: 3,
    stat: 'freeRerolls', perLevel: 1, mode: 'flat', scope: 'run',
    baseCost: 400, costGrowth: 2.00,
    desc: '+1 level-up reroll per level, six levels deep. The sixth costs 12,800 on its own.',
    fmt: '+{v} rerolls',
  },
  {
    // `revives` is Second Chance's key. Revives are hard-capped at 3 per run
    // across ALL sources and resolve in a fixed order (DECISIONS.md §29). THREE
    // levels, and not one more: this row now reaches that cap on its own, and a
    // fourth level would be 34,000 gold spent on nothing at all.
    id: 'revival', name: 'Revival', icon: '💫', maxLevel: 3, specLevels: 2,
    stat: 'revives', perLevel: 1, mode: 'flat',
    baseCost: 2500, costGrowth: 2.40,
    desc: '+1 starting revive per level. Three is the hard cap per run from every source combined, and this row alone can reach it.',
    fmt: '+{v} starting revives',
  },
  {
    id: 'greed', name: 'Greed', icon: '🍀', maxLevel: 10, specLevels: 5,
    stat: 'luck', perLevel: 1, mode: 'flat',
    baseCost: 250, costGrowth: 1.70,
    desc: '+1 starting luck per level, ten levels deep. Luck raises chest quality and rare drop rates.',
    fmt: '+{v} starting luck',
  },
  {
    // The spec's instruction on this row is a design brief, not flavour: "the
    // best value upgrade for good players and a trap for bad ones. Label it
    // honestly." So the desc states BOTH halves in plain numbers, in that order —
    // the cost first, the payoff second — and `warning` puts the trap on the card
    // where the player cannot miss it. The refund below is free for exactly this.
    //
    // Two stats, so this is one of the two rows that uses `effects`. Keys are the
    // ones already consumed by run.js via MODIFIERS/DIFFICULTY_TIERS params, which
    // is also why the row is `scope: 'run'`.
    //
    // DECISIONS.md §24: `lockedBy` is a REAL gate. save.unlocks.curse starts false
    // and is only flipped by the `kill_10000_enemies` achievement. Until then this
    // row renders locked with the achievement named on it.
    id: 'curse', name: 'Curse', icon: '🩸', maxLevel: 10, specLevels: 5,
    scope: 'run',
    effects: [
      { stat: 'countMult', perLevel: 0.10, mode: 'add' },
      { stat: 'rewardMult', perLevel: 0.08, mode: 'add' },
    ],
    baseCost: 300, costGrowth: 1.50,
    desc: '+10% enemy count AND +8% all rewards per level, ten levels deep. At level 10 that is twice as many enemies for +80% gold, XP and Star Fragments.',
    fmt: '+{v}% enemies, +{v2}% rewards',
    warning: 'This makes the game harder. That is the entire point — it pays you for the risk. If you are dying already, refund it. The refund is free.',
    lockedBy: 'curse',
  },

  // ==========================================================================
  // The twelve. See THE TWELVE THAT WERE NEVER IN THE SPEC above for why these
  // exist and how they are priced. Every one carries `specLevels: 0`, which is
  // the honest value: the spec did not raise their ceiling, it never had them.
  // ==========================================================================

  {
    // A PROBABILITY, not a multiplier — mode 'flat' because damage.js does
    // `runRng.chance(critChance)` against the raw stat, and `unit: 'percent'`
    // because "+0.01 crit chance" is not a sentence anybody has ever said out
    // loud. This pair is the whole reason `unit` exists.
    //
    // +1% a level against Keen Eye's in-run +5% a level is deliberate: the
    // permanent row is the floor a build starts from, never the build itself.
    id: 'precision', name: 'Precision', icon: '🎯', maxLevel: 10, specLevels: 0,
    stat: 'critChance', perLevel: 0.01, mode: 'flat', unit: 'percent',
    baseCost: 200, costGrowth: 1.55,
    desc: '+1% crit chance per level, ten levels deep. +10% at the top, on top of whatever the character already brings and anything Keen Eye adds inside the run.',
    fmt: '+{v}% crit chance',
  },
  {
    // Ferocity is the cheapest offensive row on the screen and that is a trap
    // the desc defuses rather than one it sets: crit damage multiplies a hit
    // that never happens if nothing crits. It is priced under Precision because
    // it is worth less than Precision, not because it is a better deal.
    id: 'ferocity', name: 'Ferocity', icon: '💢', maxLevel: 10, specLevels: 0,
    stat: 'critMult', perLevel: 0.04, mode: 'flat', unit: 'percent',
    baseCost: 150, costGrowth: 1.50,
    desc: '+4% crit damage per level, ten levels deep. +40% at the top, and worth exactly nothing until something crits — buy Precision first, or bring a character who already does.',
    fmt: '+{v}% crit damage',
  },
  {
    // The most valuable per-point row here, priced like it. attackSpeedMult is
    // read twice per weapon activation — once by run.js for the auto-attack
    // timer, once by weapons.js for all five slots — so +18% is +18% on
    // everything you own simultaneously, which no single damage row manages.
    // Twelve levels rather than ten so the top of the row is genuinely a
    // destination: the twelfth level alone is 24,813 gold.
    id: 'tempo', name: 'Tempo', icon: '⏩', maxLevel: 12, specLevels: 0,
    stat: 'attackSpeedMult', perLevel: 0.015, mode: 'add',
    baseCost: 200, costGrowth: 1.55,
    desc: '+1.5% attack speed per level, twelve levels deep. +18% at the top, on your auto-attack and all five weapon slots at once.',
    fmt: '+{v}% attack speed',
  },
  {
    // Area is the quietest strong stat in the game: it never shows up in a
    // damage number, and it decides how many enemies are inside the number that
    // does. Same twelve-level shape as Tempo, slightly cheaper per level because
    // it does nothing at all for a single-target fight — which is to say, for a
    // boss.
    id: 'expanse', name: 'Expanse', icon: '💥', maxLevel: 12, specLevels: 0,
    stat: 'areaMult', perLevel: 0.015, mode: 'add',
    baseCost: 180, costGrowth: 1.53,
    desc: '+1.5% attack size per level, twelve levels deep. +18% at the top — every swing arc, blast, orbit and aura is physically bigger, so each one catches more.',
    fmt: '+{v}% attack size',
  },
  {
    // The cheapest row on the screen, because it is the one that pays the screen
    // back. Pickup radius collects XP gems and gold you had already earned and
    // were walking away from, so it feeds Insight and Fortune without being
    // either of them. `pickupRadiusMult` is bridged to the absolute
    // `pickupRadius` by MULT_TO_BASE — the same bridge Lodestone needed and did
    // not have for the entire life of the project.
    id: 'lodestar', name: 'Lodestar', icon: '🧲', maxLevel: 10, specLevels: 0,
    stat: 'pickupRadiusMult', perLevel: 0.05, mode: 'add',
    baseCost: 110, costGrowth: 1.45,
    desc: '+5% pickup radius per level, ten levels deep. +50% at the top. It buys no damage at all; it buys every gem and coin you would otherwise have walked past.',
    fmt: '+{v}% pickup radius',
  },
  {
    // RAMPED, and it is the single worst low-level healing source in the game —
    // worse than Second Wind, which at least costs a level-up card. This row is
    // live from the first second of EVERY run, on every character, for free,
    // bought once with gold you already had.
    //
    // A flat 0.2 a level was 42-63% of everything stage 1 does to you in the
    // opening minutes (measured in tree: 0.32-0.47 HP/s incoming), for 220 gold —
    // under a single good run's earnings. Maxed it was +2 HP/s against that same
    // 0.47, i.e. the run out-healing the entire stage from minute zero, which the
    // harness had literally never measured because simulate() zeroes the shrine.
    // It has now: mochi with this row at 10 healed 249 HP against 242 taken over
    // 300s on stage 1 — a heal ratio of 103%.
    //
    // So the same shape as Second Wind: `levelTotals` carries the ACCUMULATED
    // value (see the schema note in upgrades.js, whose totalAt() the pipeline
    // reads it through). Level 1 is 0.1 HP/s, half of what it was; level 10 is
    // still exactly 2.0, so nothing anybody has already paid 31,618 gold for got
    // taken away. Every total is one decimal on purpose — the HUD prints regen as
    // toFixed(1), and a row whose first level renders as a rounded-up "+0.1/s"
    // when it is really 0.05 is a card lying by a factor of two.
    id: 'mending', name: 'Mending', icon: '🌿', maxLevel: 10, specLevels: 0,
    stat: 'regen', perLevel: 0.1, mode: 'flat',
    //            +0.1 +0.1 +0.1 +0.1 +0.2 +0.2 +0.3 +0.3 +0.3 +0.3
    levelTotals: [0.1, 0.2, 0.3, 0.4, 0.6, 0.8, 1.1, 1.4, 1.7, 2.0],
    baseCost: 220, costGrowth: 1.55,
    desc: 'Regeneration in and out of combat from the first second of the run, ramping: +0.1 HP/s for each of the first four levels and +0.3 for each of the last four. +2 HP/s at the top.',
    fmt: '+{v} HP/s regen',
  },
  {
    // Half a point a level, because a whole point a level would be Guardian
    // Plate for free and permanently. Flat reduction is the most swing-heavy
    // defensive stat in the game — it is nearly total against a swarm of 6s and
    // nearly nothing against one 200 — so the desc states which of those two it
    // is buying, and states the floor: damage.js never reduces a hit below 1,
    // so no amount of this makes anything harmless.
    id: 'bulwark', name: 'Bulwark', icon: '🛡', maxLevel: 10, specLevels: 0,
    stat: 'armor', perLevel: 0.5, mode: 'flat',
    baseCost: 260, costGrowth: 1.58,
    desc: '+0.5 armour per level, ten levels deep. Armour is subtracted from every hit before it lands, so 5 points erase a swarm and barely dent one big slam. No hit is ever reduced below 1.',
    fmt: '+{v} armour',
  },
  {
    // Eight levels, not ten, and the most expensive per point of the defensive
    // three. Dodge is the only defensive stat that can zero a hit outright, and
    // it stacks into the SAME 60% cap Phantom Step and every relic feed — so a
    // player who buys all eight has spent 23,966 gold moving their personal
    // ceiling, not raising the game's. The desc says so; a hidden cap is how a
    // shop sells the same thing twice.
    id: 'evasion', name: 'Evasion', icon: '👻', maxLevel: 8, specLevels: 0,
    stat: 'dodge', perLevel: 0.01, mode: 'flat', unit: 'percent',
    baseCost: 320, costGrowth: 1.62,
    desc: '+1% dodge per level, eight levels deep. A dodged hit deals nothing at all. Dodge from every source combined is hard-capped at 60%, and this row feeds that same cap.',
    fmt: '+{v}% dodge',
  },
  {
    // perLevel is NEGATIVE and the fmt carries no leading '+', exactly like
    // Quick Recovery in upgrades.js, so the value prints its own sign: "-4%
    // ability cooldowns". player.js clamps cooldownMult at 0.25 whatever stacks
    // into it, and -10% from here cannot get anywhere near that on its own.
    //
    // It moves SPECIAL and ESCAPE only. Weapons are Tempo, and the desc names
    // Tempo rather than saying "some cooldowns" — a player who buys the wrong
    // one of these two has been mis-sold.
    id: 'haste', name: 'Haste', icon: '⏱', maxLevel: 10, specLevels: 0,
    stat: 'cooldownMult', perLevel: -0.01, mode: 'add',
    baseCost: 260, costGrowth: 1.60,
    desc: '-1% SPECIAL and ESCAPE cooldown per level, ten levels deep. -10% at the top. It does not speed weapons up — that is Tempo.',
    fmt: '{v}% ability cooldowns',
  },
  {
    // Three levels at 1,200 / 2,640 / 5,808. Pierce is rationed on purpose in
    // the in-run pool (Piercing Will is rare tier, 5 levels) because it changes
    // what a shot IS rather than how big it is: the third enemy in a line is
    // free damage that no damage stat can produce. A permanent copy has to be
    // priced like the endgame purchase it is, and has to stop early.
    id: 'bodkin', name: 'Bodkin', icon: '🗡', maxLevel: 3, specLevels: 0,
    stat: 'pierce', perLevel: 1, mode: 'flat',
    baseCost: 1200, costGrowth: 2.20,
    desc: '+1 pierce per level, three levels only. Your shots pass through one more enemy each before they stop. Melee swings, orbits and fields are unaffected.',
    fmt: '+{v} pierce',
  },
  {
    // The single most expensive thing on this screen per level, and the shortest
    // row: 5,000, then 15,000, then nothing. Extra Shot is epic tier and capped
    // at 4 levels for a reason — projectileCount multiplies every projectile
    // weapon at once — and a permanent third one would out-scale the whole
    // arsenal simultaneously. Two, and it stops.
    id: 'volley', name: 'Volley', icon: '🔱', maxLevel: 2, specLevels: 0,
    stat: 'projectileCount', perLevel: 1, mode: 'flat',
    baseCost: 5000, costGrowth: 3.00,
    desc: '+1 projectile per level, two levels only, at 5,000 then 15,000 gold. Everything you throw throws one more from minute zero — auto-attack, special, escape and every projectile weapon. Melee swings and standing fields are unaffected.',
    fmt: '+{v} projectiles',
  },
  {
    // THE SECOND RISK ROW, and deliberately a different bet from Curse. Curse
    // asks whether you can handle twice as many enemies and pays in economy.
    // This asks whether you can avoid being touched at all and pays in damage.
    //
    // Both halves land in core buckets that already exist — damageMult is
    // Might's, maxHpMult is Vitality's — which means the shrine's own preview
    // shows the NET of the two, not two numbers that need reconciling. Buying
    // Vitality 15 and Glass Edge 10 is +45% and -35% and the screen prints +10%,
    // because that is the truth about the character you are about to play.
    //
    // -3.5% against +5% is the ratio that makes it an argument rather than an
    // answer. At level 10 it is one and a half times the damage on 65% of the
    // health, and player.js floors maxHp at 1, so it can never be lethal on its
    // own — it just removes the margin that was covering your mistakes.
    //
    // Same gate as Curse. `kill_10000_enemies` is the game's proof that a player
    // has seen enough of it to be handed a knife.
    id: 'glass', name: 'Glass Edge', icon: '💔', maxLevel: 10, specLevels: 0,
    effects: [
      { stat: 'damageMult', perLevel: 0.05, mode: 'add' },
      { stat: 'maxHpMult', perLevel: -0.035, mode: 'add' },
    ],
    baseCost: 300, costGrowth: 1.50,
    desc: '+5% damage AND -3.5% max HP per level, ten levels deep. At level 10 that is one and a half times the damage on 65% of the health.',
    fmt: '+{v}% damage, {v2}% max HP',
    warning: 'The HP is gone before the run starts and Vitality is the only thing that buys it back. If you are already dying at minute 12, this is not the row that fixes it. The refund is free.',
    lockedBy: 'curse',
  },
];

/**
 * ALWAYS a full refund button, always free (SECTION 12 line 1586: "Let players
 * experiment"). Every level ever bought returns 100% of its gold, so the Shrine
 * is a sandbox rather than a commitment — which is the only reason Curse and
 * Glass Edge can be honest offers instead of traps.
 */
export const SHRINE_REFUND_FREE = true;

// ---------------------------------------------------------------------------
// BOND LEVELS — SECTION 12 line 1596. Playing a character raises their bond.
// The `reward.kind` selects the handler; `stat`/`value` parameterise it, so a new
// bond tier is a data addition. Bond is per character, stored in
// save.roster[id].bond.
// ---------------------------------------------------------------------------

export const BOND_LEVELS = [
  {
    level: 5, reward: { kind: 'stat', stat: 'maxHp', value: 0.05 },
    desc: '+5% max HP with this character.',
  },
  {
    level: 10, reward: { kind: 'barks' },
    desc: 'A new bark set.',
  },
  {
    level: 15, reward: { kind: 'costume' },
    desc: 'A costume tint.',
  },
];

/** +1 bond for finishing a run with them. Win or lose — losing is still playing. */
export const BOND_PER_RUN = 1;

/** +1 more per boss killed in that run, mid-bosses included. */
export const BOND_PER_BOSS = 1;

// ---------------------------------------------------------------------------
// SECTION 5 — STAR FRAGMENT AWARD TABLE, as resolved by DECISIONS.md §1.
//
// These numbers are LOAD-BEARING and were not touched: they appear in SECTION 14's
// balance targets and on the results screen. The 20-60x economy error was in the
// pull PRICE, which §1 moved to 15 / 135 in gacha.js. A completed 20-minute run
// with both bosses pays 8 + 10 + 20 = 38💎; 3-4 runs is ~114-152💎, which is the
// spec's "one 10-pull per 3-4 completed runs" target hit on the nose.
//
// Note runFailed: dying still pays 4💎. SECTION 12: "Make losing feel like
// progress, because it is."
//
// miniBoss is the ONE addition, and it is deliberately small. Every stage now
// runs two or three mid-boss fights instead of one, and the stage's SIGNATURE
// mid-boss — the one pinned to the halfway anchor — still pays the spec's 10💎.
// The extra mini-bosses pay 3💎 each, so a completed run pays 41💎 (two fights)
// or 44💎 (three) against the old 38💎: more fights, near-identical economy, and
// the "one 10-pull per 3-4 completed runs" target above is untouched because it
// is measured on the three numbers that did not move.
// ---------------------------------------------------------------------------

export const FRAGMENT_AWARDS = {
  runCompleted: 8,
  runFailed: 4,
  midBoss: 10,
  miniBoss: 3,
  finalBoss: 20,
  firstClear: 50,
  dailyFirstWin: 30,
};

// Boot-time index. Not logic — an O(1) lookup instead of a linear scan every time
// the shrine screen prices a row. Same pattern as UPGRADES_BY_ID in upgrades.js.
export const SHRINE_UPGRADES_BY_ID = Object.fromEntries(
  SHRINE_UPGRADES.map((u) => [u.id, u]),
);
