# CHARACTER PROPOSALS — a cohort of eight

**Status:** proposal only. Nothing in this document is implemented. No source file was
touched to write it.

**Brief:** *"suggest some new characters to add and their kits, maybe use black clover
characters as an option."*

**What this is.** A gap analysis of the roster as it actually exists in the tree today,
then eight characters chosen to fill the holes that analysis found — seven from the
owner's floated source and one from elsewhere, because one hole that source cannot fill
cleanly. Every number is anchored against a real number already in `src/data/characters.js`
and the anchor is named. Every field name, targeting mode, status applier, shape and
sprite feature used below was checked against the file that implements it; where I use
something the engine does **not** have, it is called out as a cost rather than assumed.

**Read order.** Part 1 is the argument — §1.7 is a house rule nothing in the tree writes
down and it changed every one of the eight `visual` blocks, so do not skip it. Part 2 is
the content. Parts 3–7 are what a builder needs to actually land it without breaking the
suite; **Part 6** lists the seven places the tree turned out not to say what a reading of
it suggested.

**How the numbers were got.** Every count and distribution in this document was produced by
importing the data modules and tallying, not by reading a comment — every count comment in
the tree is stale (§1.1). The exact figures are printed at the head of Part 6 so they can
be re-derived.

**A note on this file's location.** `tests/run.js:21-32` walks `src/` and keeps only
`.js` files, so `docs/` is outside the ref-containment grep. That means the dev-only ref
block in Part 2 is *safe* here but also *unprotected* — it must never be copy-pasted
anywhere except `src/data/refs.js`, and this file should be deleted alongside `refs.js`
in a ship build.

---

# PART 1 — GAP ANALYSIS

## 1.1 The roster as it actually is

**28 characters, not 25.** Every count comment in the tree is stale — `characters.js:1`
("All 25 playable characters"), `characters.js:1181` ("Seven, not five"), `refs.js:36`
("CHARACTERS (25)"), `sprites.js:7` ("The 25 characters"), `relics.js:2` ("the 30 relics
(25 signature + 5 stage)" when it is 33). `gacha.js:530` ("28 signature relics") is the
only accurate one. I counted the arrays.

| Rarity | Count | Characters |
|---|---|---|
| ★3 | 2 | mochi, alto |
| ★4 | 6 | hoshino_rei, yamikage, uzu, captain_yuli, kagura, unit_09 |
| ★5 | 12 | rin, niten, shiro_same, reika, nekromina, hikari, kira, yukine, wren, brant, karin, nika |
| ★6 | 8 | sovereign_alicia, sora, han, aoi, mirel, akane, pekora, rima |

There is no ★7/★8/★9. `star7.js`/`star8.js`/`star9.js` are ability *content modules*
named by authoring cohort and `abilities/index.js:59-62` says so out loud; `gacha.js:41`
only has keys 3/4/5/6 and `data/index.js` only loops `[3,4,5,6]`.

**Element totals across all 28:** steel 6 · spirit 5 · lightning 5 · light 4 · fire 3 ·
water 3 · **shadow 2**.

## 1.2 The rarity × element matrix — this is where the holes are

| | fire | water | lightning | steel | shadow | light | spirit |
|---|---|---|---|---|---|---|---|
| **★3** | — | — | — | alto | — | — | mochi |
| **★4** | — | — | yamikage, unit_09 | captain_yuli | — | hoshino_rei | uzu, kagura |
| **★5** | hikari | rin, shiro_same | reika, wren, nika | niten, brant, karin | nekromina, kira | yukine | **—** |
| **★6** | alicia, akane | aoi | **—** | pekora | **—** | sora, han | mirel, rima |

Five true structural holes, in order of how loudly the code complains about them:

1. **The ★3 pool is two deep, and it bent the whole economy.** `gacha.js:20-25` states
   it: the spec's 60/32/7.2/0.8 curve "returns Mochi or Alto for 3 pulls in 5", so the
   shipped rates are 46/45/8/1 instead. DECISIONS.md §3 (line 72) records **FIX A —
   "invent two more ★3s"** — as rejected for exactly one reason, quoted verbatim at
   line 89-93: *"FIX A requires inventing two characters, which means choosing two
   anime/VTuber refs the owner never approved."* That objection is a content-authorship
   objection, not a technical one, and the owner has now floated a source. Line 95-96
   says what switching costs: *"add two objects to `characters.js` + edit the pool
   arrays. Nothing else."* **This is the single most defensible slot on the roster.**
2. **Shadow is the thinnest element at 2/28 and both are ★5.** No shadow ★3, ★4 or ★6.
3. **No spirit ★5** — the only empty cell in the ★5 row.
4. **No lightning ★6 and no shadow ★6** — the only two empty cells in the ★6 row.
5. **No fire ★4, no water ★4, no shadow ★4** — three empty cells in the ★4 row.

## 1.3 Archetypes already covered — the duplication risk

Melee arc duelist (alto, captain_yuli, akane) · counter/parry (niten) · taunt-tank that
returns stored damage (brant) · burst assassin with a reset loop (yamikage, karin) ·
minion **swarm** (uzu 5 clones, nekromina 5 deadbeats + 4 zombies) · aura support
(hoshino_rei, yukine) · zone/field debuff (yukine, reika) · hitscan sniper (reika) ·
homing precision spam (wren) · boomerang/return (rima, aoi) · ground-denial trap layer
(pekora, karin) · execute-by-timer (kira, captain_yuli) · full transformation
(sovereign_alicia, han) · charge-nuke (sora) · random/chaos output (mochi, mirel) ·
two-weapon toggle (nika) · artillery barrage (akane, aoi) · burn DoT (kagura, hikari) ·
gold/loot economy (sovereign_alicia, akane) · revive (hikari, hoshino_rei S3).

A ninth spinning orbital, a third minion swarm and a fourth melee arc are all things this
roster does not need.

## 1.4 Delivery patterns already covered

`nearest` single and volley · `nearestN` fan · `facing` arc and line · `facingAuto` ·
`aroundSelf` ring · `densestCluster` · `lineDensest` hitscan · `randomInRange` homing ·
thrown-and-left props · persistent minions · static fields · transformation.

**Not covered as a character's declared identity:** cursor-placed artillery · retaliation
(the crowd hurting itself on you) · a stack that ripens *on the enemy* over seconds ·
targeting the strongest thing on purpose · a single permanent companion rather than a
swarm · a shield stack as the core rather than a rider.

## 1.5 Engine vocabulary that is built, tested and sitting idle

Verified by grepping `src/` for each value:

| Thing | Where it lives | Used by |
|---|---|---|
| `highestHp` targeting | `targeting.js:115-128` | **nobody, anywhere** |
| `lowestHp` targeting | `targeting.js:115-128` | **nobody, anywhere** |
| `mouseAim` targeting | `targeting.js:84-92` | reika's special (`star5a.js:57,598`) — but **no character declares it** in `characters.js` |
| filter `marked` | `targeting.js:37` | nobody |
| filter `large` | `targeting.js:38` | nobody |
| filter `elite` | `targeting.js:39` | nobody |
| filter `notBoss` | `targeting.js:40` | nobody |
| `thorns` stat | `player.js:38`, applied `damage.js:293-295` on `SRC.CONTACT` | nobody |
| `lifesteal` stat | `player.js:38`, applied `damage.js:170-173` | nobody as an identity |
| `applyPoison` | `statusEffects.js:78`, ticks at `171-174` | nobody — and **not re-exported** by `helpers.js:27-44` |
| `addShield` | `statusEffects.js:136` | only as an S5 rider (wren, brant) |
| `altForm` | schema `characters.js:1271-1278` | 1 character |
| `resourceBar` | schema `characters.js:1404`, `1842` | 2 characters |
| `metric` | schema `characters.js:984` | 1 character |
| `special.charges` / `escape.charges` | `player.js:109-110` | 2 abilities |
| weapon `greatsword`, `sword`, `spear`, `fan`, `hammer`, `bow`, `claws`, `whip` | `pixelArt.js:3089-3470` | **no character** |
| hair `bowl`, `braid`, `topknot`, `buzz`, `plume`, `hood` | `pixelArt.js:1937-2440` | **no character** (only enemy archetypes) |

That last pair of rows is the useful one: there are eight unclaimed weapon silhouettes and
six unclaimed hair silhouettes, which is exactly what `tests/pixelArt.js:78-89` ("no two
characters look identical") needs a new cohort to spend.

## 1.6 The holes this cohort fills, and the two it does not

| Hole | Filled by |
|---|---|
| ★3 pool is 2 deep (DECISIONS.md §3 FIX A) | `shizuku` ★3, `kuroba` ★3 |
| water ★3 | `shizuku` |
| shadow ★3 / ★4 / ★6 (shadow present at every tier) | `kuroba`, `dokuga`, `sakai` |
| fire ★4 | `enshi` |
| spirit ★5 | `ibara` |
| lightning ★6 | `narukami` |
| `highestHp` targeting | `narukami` (auto + escape + passive) |
| `mouseAim` as a declared auto-attack | `bakuen` |
| `thorns` as a core | `ibara` |
| `addShield` as a core | `shizuku` |
| poison / a stack that ripens on the enemy | `dokuga` |
| a single permanent companion (not a swarm) | `enshi` |
| 2nd `altForm` | `kuroba` |
| 3rd and 4th `resourceBar` | `dokuga` (VIRULENCE), `sakai` (LIMIT) |
| unclaimed weapon silhouettes | greatsword, spear, whip, claws, katana(2nd), none, staff(3rd/4th) |
| unclaimed hair silhouettes | plume, hood, braid |

**Deliberately not filled, with reasons** — see Part 7. Short version: `lowestHp` and the
`revives` stat both want a character, and both cost engine or `run.js` work that breaks
the "one data object + four registry entries" promise. I would rather name them than jam
them in.

## 1.7 The `visual.shape` convention — an unwritten rule, measured

`characters.js:47` documents `visual` as "the PROCEDURAL fallback + palette source" and
lists a dozen legal shapes, so on the face of it a character may pick any of them. The
roster says otherwise. Executing the module and tallying:

```
CHARACTERS 28 → visual.shape { capsule: 27, circle: 1 }
```

**Twenty-seven of twenty-eight characters are `capsule`.** The one exception is `mochi`,
who is `circle` — and mochi is the only character whose sprite `body` is not `humanoid`
(`sprites.js:135`, a `blob`). The rule nobody wrote down is therefore: **the procedural
fallback for a person is an upright capsule, and a non-capsule shape is a claim that the
character is not a person.** It is the same shape the renderer stamps when the pixel atlas
is unavailable, so a character declaring `shard` renders as a floating splinter and one
declaring `hedge` renders as a bush where the player should be.

**This fails silently, and I checked rather than assumed.** Setting `karin.visual.shape` to
`'hedge'` and running the shipped boot-time validator:

```
SHAPES.hedge exists   : true      <- so `SHAPES[v.shape] || SHAPES.circle` SELECTS it;
SHAPES.capsule exists : true         there is no loud fallback to warn you
capsule path: 7 ops   beginPath moveTo(10.1,8.0) arcTo(29.9,8.0,29.9,32.0,9.9) ...
hedge   path: 13 ops  beginPath moveTo(36.0,20.0) quadraticCurveTo(35.8,24.6,31.3,27.3) ...
identical paths: false

validate() with karin set to shape 'hedge'  ->  NO COMPLAINT
```

An eleven-lobed clipped bush is drawn where the player stands, `data/index.js validate()`
passes, and all 220 tests pass — nothing in the tree reports it, because every gate that
looks at art (`tests/pixelArt.js:41-89`) inspects the **pixel-art** sprite and not the
procedural fallback. The only way to catch it is to know the convention.

This is worth stating because it is invisible in the schema comment and easy to get wrong
in exactly the way that looks like flavour. **All eight characters below are `capsule`**
(`sovereign_alicia`'s `altForm` is a capsule too, `characters.js:1277`, so the second
`altForm` in this cohort follows suit). Colour, `accent`, `emoji` and `size` are where a
character's fallback identity actually lives, and `glow: true` is the rarity tell — all
eight ★6s carry it, and exactly one ★5 does (`nika`), so it is a strong signal rather than
a strict one.

**Relics are the opposite** and deliberately so: across the 33 relics the shapes run
`shard` 7 · `square` 5 · `ring` 4 · `circle` 3 · `star` 3 · `capsule` 3 · `triangle` 2 ·
`cross` 2 · `diamond`/`hex`/`crescent`/`flower` 1 each. A relic is an object, so it gets an
object's silhouette. The eight relic `visual` blocks below use that vocabulary freely.

---

# PART 2 — THE EIGHT

## Reference anchors (measured off `src/data/characters.js`)

Raw auto DPS = `damage / interval`, times the projectile count the `desc` states. This is
the table every number below is anchored against.

| id | ★ | hp | armor | spd | dmgMult | asMult | areaMult | crit | auto | raw DPS | special cd | esc cd / iframes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mochi | 3 | 100 | 0 | 168 | 0.95 | 1.00 | 1.00 | .05 | 12 / 1.0s | 12 | 18 | 5 / 0.6 |
| alto | 3 | 105 | 0 | 176 | 1.00 | 1.00 | 1.00 | .05 | 16 / 0.8s arc | 20 | 20 | 7 / 0.8 |
| hoshino_rei | 4 | 100 | 0 | 174 | 1.00 | 1.00 | 1.05 | .05 | 18 / 1.0s | 18 | 24 | 6 / 0.5 |
| yamikage | 4 | 95 | 0 | 178 | 1.00 | 1.00 | 1.00 | .08 | 15 ×3 / 0.65s | 69 | 14 (2 chg) | 6 / 0.55 |
| uzu | 4 | 130 | 0 | 172 | 1.00 | 1.00 | 1.00 | .05 | 12 ×3 / 0.7s | 51 | 22 | 6 / 0.6 |
| captain_yuli | 4 | 100 | 1 | 186 | 1.00 | 1.00 | 0.90 | .07 | 11 / 0.35s | 31 | 18 | 7 / 0.6 |
| kagura | 4 | 95 | 0 | 170 | 1.00 | 1.00 | 1.05 | .05 | 22 ×2 / 1.1s | 40 | 25 | **0** / 0.5 |
| unit_09 | 4 | 90 | 0 | 176 | 1.00 | 1.05 | 1.00 | .05 | 13 / 0.5s | 26 | 22 | 6 / 0.7 |
| rin | 5 | 120 | 0 | 174 | 1.00 | 1.00 | 1.00 | .05 | 30 / 0.7s | 43 | 24 | 5 / 0.5 |
| niten | 5 | 110 | 1 | 170 | 1.00 | 1.00 | 1.00 | .10 | 26 / 0.6s | 43 | 28 | 7 / **0.4** |
| shiro_same | 5 | 110 | 0 | 172 | 1.00 | 1.00 | 1.00 | .05 | 10 ×5 / 0.9s | 56 | 26 | 6 / 0.5 |
| reika | 5 | 100 | 0 | 172 | 1.00 | 1.00 | 1.00 | .06 | 85 / 1.6s | 53 | 28 | 7 / 0.6 |
| nekromina | 5 | 105 | 0 | 170 | 1.00 | 1.00 | 1.05 | .05 | 16 / 0.8s ring | 20 | 25 | 6 / 1.2 |
| hikari | 5 | 115 | 0 | 172 | 1.00 | 1.00 | 1.05 | .05 | 18 ×4 / 1.0s | 72 | 27 | 5 / 0.5 |
| kira | 5 | **90** | 0 | 168 | 1.00 | 1.00 | 1.00 | .05 | 400 / 0.6s (timer) | n/a | 30 | 7 / 1.5 |
| yukine | 5 | 100 | 0 | 176 | 1.00 | 1.00 | 1.05 | .05 | 18 / 0.9s ring | 20 | 26 | 6 / 0.6 |
| wren | 5 | 95 | 0 | 174 | 1.00 | 1.05 | 0.95 | .06 | 12 ×2 / 0.45s | 53 | 24 | 5 / 0.6 |
| brant | 5 | **145** | 1 | 168 | 1.00 | 1.00 | 1.10 | .05 | 52 / 1.1s | 47 | 22 | **4** / 0.5 |
| karin | 5 | 112 | 0 | 178 | 1.05 | 1.10 | 0.95 | .10 | 34 / 0.42s | 81 | 24 | 5 / 0.5 |
| nika | 5 | 108 | 0 | 174 | 1.00 | **1.15** | 1.05 | .08 | 21 / 0.34s | 62 | **12** | 8 / 0.6 |
| sovereign_alicia | 6 | 140 | 1 | 176 | 1.05 | 1.00 | 1.05 | .05 | 32 ×3 / 1.0s | 96 | **35** | 7 / 1.2 |
| sora | 6 | **150** | 1 | 180 | 1.00 | 1.00 | 1.00 | .05 | 22 / 0.9s | 24 | 32 | 9 / **1.8** |
| han | 6 | 145 | 1 | 172 | 1.00 | 1.00 | 1.00 | .05 | 40 / 0.85s | 47 | 34 | 8 / 1.2 |
| aoi | 6 | 138 | **0** | 184 | 1.00 | 1.05 | 1.05 | .05 | 16 ×2 / 0.9s | 36 | 30 | 6 / 0.8 |
| mirel | 6 | 130 | 1 | 170 | 1.05 | 1.00 | 1.05 | .05 | 26 / 0.5s | 52 | 28 | 8 / 1.4 |
| akane | 6 | 142 | 1 | 174 | 1.05 | 1.00 | 1.05 | .05 | 30 / 0.65s | 46 | 30 | 6 / 0.9 |
| pekora | 6 | 132 | 1 | 182 | 1.00 | 1.00 | 1.10 | .05 | 24 ×4 / 0.95s | 101 | 31 | 6 / 0.9 |
| rima | 6 | 128 | 1 | 172 | 1.08 | 1.00 | 1.05 | .07 | 30 ×2 / 0.62s | 97 | 20 | 7 / **0.45** ×3 |

Current extremes worth knowing before proposing a new one: slowest move 168 · fastest 186
· lowest HP 90 · highest HP 150 · lowest areaMult 0.90 · highest 1.10 · highest
attackSpeedMult 1.15 · highest crit .10 · highest critMult 2.2 · lowest cooldownMult 0.95
· highest luck 3 (akane) · shortest special cd 12 · longest 35 · shortest escape cd 0
(kagura, the documented exception, DECISIONS.md §53) then 4 · shortest iframes 0.4 ·
longest 1.8. **Nothing on the roster has ever declared an `attackSpeedMult` below 1.0.**

**The ★6 floor** (`characters.js:1187-1191`, verbatim): 130–150 HP, 1 armor, at least one
stat multiplier above 1.0, and a passive that COMPOUNDS over a run rather than paying a
flat bonus. Note that rima at 128 already sits a hair *under* the stated floor; both ★6s
below clear it cleanly rather than borrowing her slack or aoi's zero-armour exception.

---

## 1 · `shizuku` — ★3 water — **the shield is the character**

**Slot and why.** ★3 (FIX A, DECISIONS.md §3) and the first water ★3 — the ★3 row has
only spirit and steel. Mechanically she is the roster's first kit whose *core* is
`addShield` (`statusEffects.js:136`), which currently exists only as an S5 rider on wren
and brant.

**Codename derivation.** House pattern #2, semantic translation of the defining trait into
Japanese — the same move as Fubuki(snow)→`yukine`, Kiara(phoenix)→`hikari`, Mokona(round
white)→`mochi`. She is a very small piece of a very large sea and the entire joke is that
scale mismatch. `shizuku` = "droplet". Distinct from `aoi` (which took the blue/water name
for a different character) in word, meaning and sound.

```
id: 'shizuku'   name: 'Shizuku'   epithet: 'The Wave That Will Not Be Aimed'
rarity: 3   archetype: 'Runaway Royal'   element: 'water'
visual: { shape: 'capsule', color: '#8fd4ff', accent: '#2a4f9e', emoji: '🌊', size: 15 }
stats: hp 104, armor 0, moveSpeed 172, pickupRadius 50,
       damageMult 0.90, attackSpeedMult 1.0, areaMult 1.05,
       critChance 0.05, critMult 2.0, cooldownMult 1.0, luck 1
```

**Stat anchors.** HP 104 sits between mochi's 100 and alto's 105 — she is a ★3, she gets
★3 HP. `damageMult 0.90` is the **lowest number in that column anywhere on the roster**
(mochi's 0.95 was the floor) and it is the price: her shield stack is worth more than her
damage and the card should say so. `capsule` per the shape convention in §1.7; no `glow` —
all eight ★6s carry it and no ★3 or ★4 does.

**Auto — `wild_current` / "Wild Current"** · `interval 0.9, damage 8, targeting { mode:
'randomInRange', range: 420 }`
> Three lances of water go somewhere every 0.9s for 8 damage each. Not at anything in
> particular. Somewhere.

3 × 8 / 0.9 = **26.7 raw DPS**, above both ★3s (mochi 12, alto 20) and below the ★4 that
shares her targeting mode (kagura, 40) — and a third of it lands on things that were not
the problem, which is what `randomInRange` costs. *Collision note:* kagura is the other
`randomInRange` character; hers are 2 homing talismans with a delayed detonation and an
`unmarked` filter, and these are 3 instant unfiltered lances. Close, and worth watching.

**Special — `tideguard` / "TIDEGUARD"** · `cooldown 16`
> Water closes over her as armour for 8s: 4 shield hits, +2 armor, and every shield hit it
> eats bursts for 45 damage in a 130px radius.

cd 16 sits between nika's 12 (the shortest on the roster) and mochi's 18 — inside the
12–35 band `suites.js:664-669` enforces. Name is plain English on purpose so no
`shipNames.js` entry is needed (see Part 3.4).

**Escape — `undertow` / "Undertow"** · `cooldown 5, iframes 0.5`
> A 220px slide on a sheet of water, invulnerable, 28 damage to everything she passes
> through, and she comes out of it wearing 1 more shield hit.

cd 5 matches mochi, rin, hikari and karin; iframes 0.5 is the roster's median.

**Passive — `overflow` / "Overflow"**
> Every shield hit she loses bursts for 40 damage in a 120px radius and refunds 3 HP. She
> has never once blocked something quietly.

This is the whole design in one line and it is the *inverse* of wren, whose FORM stacks
pay her for not being hit and pay nothing when she is. Being hit is how Shizuku aims.

**Star upgrades** (each string carries a digit, `suites.js:519-528`)
- s3 (always the SPECIAL): `'Tideguard runs 12s instead of 8 and opens with 6 shield hits instead of 4.'`
- s5 (always the ESCAPE): `'Undertow grants 2 shield hits instead of 1 and reaches 300px.'`

**Signature relic — `high_tide` / "High Tide"**
```
owner: 'shizuku'  stageOwner: null  rarity: 'rare'  icon: '🌊'  shipName: null
desc:          'Every 12s you gain 2 shield hits. Every shield hit you lose heals 6 HP.'
resonanceDesc: 'RESONANCE: every 8s, 3 shield hits, and 9 HP each.'
hooks:     ['onInterval']
params:    { interval: 12, shields: 2, heal: 6 }
resonance: { interval: 8,  shields: 3, heal: 9 }
visual: { shape: 'ring', color: '#8fd4ff', accent: '#12315e', size: 12 }
dropWeight: 220
codex: 'The armour was never the point. What it does when it breaks is the point.'
```
Resonance is fully resolved per `relics.js:16-23`: `interval` is in `RESONANCE_DIRECTION`
as `'down'` so 12/1.5 = 8 exactly; `shields` and `heal` take the `default: 'up'` so 2→3
and 6→9. All three land on integers, which is deliberate — `tests/data.test.js` asserts
each block against the table.

**Sprite descriptor** (legal vocabulary only — `sprites.js:30-127`)
```js
shizuku: {
  body: 'humanoid', young: true,
  hair: 'wave', hairColor: '#e8eef8', hairTip: '#9fd0f0',
  skin: '#fbe0cc', outfit: '#1c2a4a', accent: '#8fd4ff', eyes: '#7f5fd0',
  highCollar: '#141c30',
  coat: '#1c2a4a', coatTrim: '#8fd4ff',
  cape: '#1a2440',
  skirt: '#141c30', gloves: '#e8eef8', chest: '#8fd4ff',
  legColor: '#f7d8bc', boots: '#2a3550', bootHeight: 'knee',
  aura: '#8fd4ff',
  weapon: 'staff', weaponColor: '#e8eef8', gripColor: '#2a3550',
}
```
`wave` is currently worn only by hikari (orange, feathered, no weapon), so colour-off the
two share nothing. She is the third `staff` on the roster after wren and mirel — see
Part 5 for why that is the weakest point of this cohort's silhouette plan and what carries
the separation.

**Codex voice** (the character's own voice lives in the JSDoc block above the object, the
way KARIN's does at `characters.js:1650-1663`):
> *She was told, at length and by professionals, that the problem was her aim. It was
> never her aim. It was that nothing she does is supposed to be survivable by the person
> doing it, and she has been surviving it since she was eleven.*

**Barks (voice sample; the full block needs spawn/levelUp/lowHp/kill/boss/victory/defeat/idle):**
- spawn: `"I know. I KNOW. Just — stand behind me and it will be fine."`
- lowHp: `"That was the last one. That was the LAST ONE."`
- boss: `"Oh good. Something big enough that I cannot possibly miss."`

---

## 2 · `kuroba` — ★3 shadow — **nothing sticks to him**, and the roster's 2nd `altForm`

**Slot and why.** The second half of FIX A, and the first shadow character outside ★5 —
shadow is the thinnest element on the roster at 2/28 and both live in the same bracket.
Mechanically he is the roster's only *status-immunity* identity and the second `altForm`
(`characters.js:1271-1278`), a declared field that has had exactly one consumer since it
was invented.

**Why an `altForm` on a ★3 is the right call, not an extravagance.** `gacha.js:27-39`
says the ★3 bracket *is* the duplicate pool and therefore the star-level progression —
"the freed weight goes to ★3 — which is the duplicate pool, and therefore the star-level
progression that makes the characters you DO own get stronger." A ★3 that visibly becomes
something else is the strongest possible argument for that curve, and it costs the builder
almost nothing because the whole path already exists for alicia.

**Codename derivation.** House pattern #2 again: 黒刃 *kuroba*, "black blade" — the thing
he is rather than the thing he does, built the same way `yamikage` is yami+kage and
`shiro_same` is white+shark. Deliberately **not** built on *yami*, which `yamikage`
already spent.

```
id: 'kuroba'   name: 'Kuroba'   epithet: 'The One Nothing Sticks To'
rarity: 3   archetype: 'Antimage'   element: 'shadow'
visual: { shape: 'capsule', color: '#1a1a22', accent: '#c8f24a', emoji: '🗡', size: 16 }
stats: hp 112, armor 0, moveSpeed 174, pickupRadius 44,
       damageMult 1.0, attackSpeedMult 0.90, areaMult 1.10,
       critChance 0.05, critMult 2.0, cooldownMult 1.0, luck 0
```

**Stat anchors.** HP 112 is the highest ★3 (alto 105) and it has to be — his passive is
immunity, not avoidance, so he eats hits on purpose. `attackSpeedMult 0.90` is **the first
sub-1.0 number in that column anywhere on the roster**; brant is the slowest auto in the
game at a 1.1s interval and still declares 1.0, so this is a genuinely new lever and the
card must say what it buys. `areaMult 1.10` ties brant and pekora — the other two
characters whose weapon is comically oversized.

**Auto — `deadweight_swing` / "Deadweight Swing"** · `interval 1.0, damage 30, targeting
{ mode: 'facing' }`
> One enormous overhead every 1.0s: a 150° arc, 110px of reach, 30 damage — and +40%
> against anything currently burning, slowed, stunned, marked or vulnerable. Magic makes
> you easier to hit, not harder.

30 raw, dropping to ~27 effective once `attackSpeedMult 0.90` stretches the interval to
1.11s. That sits above alto's 20 (120° at 85px) and well under brant's 47, and every point
of it is paid for in reach. The status bonus reads `e.st` fields, which `targeting.js:36-40`
already does — **no new engine code**, unlike a "strip the status" version, which has no
helper and would need one.

**Special — `black_form` / "BLACK FORM"** · `cooldown 20`
> For 6s the blade takes him over: 1.6x size, +45% move speed, knockback immune, the swing
> interval drops to 0.55s, and every swing throws a 320px black crescent that pierces
> everything. He is a different silhouette while it runs.

cd 20 matches alto's 20, the other ★3 with a duration special. `apotheosis` (`star6.js:447-560`)
is the working template for the flags and the teardown.

```js
altForm: {
  id: 'black_form',              // must be one of his own 4 pillar ids (validate() 228-238)
  name: 'Black Form',
  spriteId: 'kuroba_black',      // must DIFFER from the character id, or the atlas
                                 // hands back the cached human at the new size
  visual: { shape: 'capsule', color: '#0e0e14', accent: '#c8f24a', emoji: '😈', size: 17 },
}
```

**Escape — `through_it` / "Through It"** · `cooldown 6, iframes 0.55`
> He does not dodge. He swings and walks: 0.55s invulnerable while he advances 200px along
> your movement direction, cutting everything in the lane for 60. With an empty lane it is
> just a 200px walk, which is the tell that he read it wrong.

**Passive — `no_mana_at_all` / "No Mana At All"**
> He has none, so nothing can be done to it: slow, stun, pull and burn simply do not land
> on him. And every enemy he kills inside 120px — arm's length, where he has to be anyway —
> adds a permanent +0.4% damage for the rest of the run. Uncapped.

The compounding half is deliberately keyed on *kills at melee range* rather than on
"statuses that failed on him": I could not confirm that enemies apply enough status to the
player for a failure counter to ever tick, and a passive that never fires still passes
`abilityRuntime.js:173-203`. Anchor: alto's `beater` is +2% per player level uncapped;
0.4% per close kill is the same shape on a different axis.

**Star upgrades**
- s3: `'Black Form runs 9s instead of 6 and its crescents reach 440px.'`
- s5: `'Through It cuts twice — once on the way in, once when he stops — for 60 each.'`

**Signature relic — `the_fifth_leaf` / "The Fifth Leaf"**
```
owner: 'kuroba'  rarity: 'rare'  icon: '🍀'  shipName: null
desc:          'Every 5th auto-attack throws a 380px black crescent that pierces everything for 3x damage.'
resonanceDesc: 'RESONANCE: every 3rd swing, 4.5x damage, and the crescent reaches 570px.'
hooks:     ['onNthAutoAttack']
params:    { everyNth: 5, damageMult: 3,   range: 380 }
resonance: { everyNth: 3, damageMult: 4.5, range: 570 }
visual: { shape: 'shard', color: '#c8f24a', accent: '#14141c', size: 13 }
dropWeight: 210
codex: 'It was in the pile nobody had bothered to sort. Of course it was.'
```
`everyNth` is in `RESONANCE_DIRECTION` as `'down'` (`relics.js:54`) — 5/1.5 = 3.33, and
`secret_technique_109` establishes the rounding at `relics.js:83`. Implementation model:
`secret_technique_109` in `relicHooks.js:328-341`, which is the same hook doing the same
job.

**Sprite descriptors**
```js
kuroba: {
  body: 'humanoid', young: true,
  hair: 'short', hairColor: '#d8cfa8', skin: '#e8b98a',
  headband: '#2a2430', headbandPlate: '#c8f24a',
  outfit: '#1a1a22', accent: '#c8f24a', eyes: '#4ae0a0',
  underLayer: '#2a2430',
  coat: '#141418', coatRagged: true,
  armWraps: '#d8d2c4', gloves: '#2a2430',
  belt: '#4a3a2a', shorts: '#1a1a22',
  legColor: '#2a2430', boots: '#141418', chest: '#c8f24a',
  weapon: 'greatsword', weaponColor: '#2a2a34', gripColor: '#8a7a5a',
}

// ALTERNATE FORM — lives next to him, keyed on its own spriteId (sprites.js:1008-1021).
kuroba_black: {
  body: 'humanoid', gridW: 40, gridH: 54,
  hair: 'short', hairColor: '#1a1a22', skin: '#6a5a72',
  outfit: '#0e0e14', accent: '#c8f24a', eyes: '#c8f24a', eyeGlow: '#e0ff6a',
  ears: 'greatHorns', earColor: '#0e0e14',
  wings: 'dragon', wingColor: '#141418',
  tail: 'scaled', tailColor: '#0e0e14',
  aura: '#c8f24a', chest: '#c8f24a',
  weapon: 'greatsword', weaponColor: '#0e0e14', gripColor: '#c8f24a',
}
```
`greatsword` is claimed by **no character** — that alone separates him from all six
existing melee silhouettes. `short` is otherwise worn only by kira (neat brown, blazer,
notebook), so an ash-blond sleeveless brawler with a headband and a slab of iron is a
different person with the colour off.

**Honest note on the alt form — this is the one real design decision left open.**
`sprites.js:1031-1037` sets the bar out loud: a transformation must change **body plan**,
not just decoration — *"turn the colour off and the two silhouettes have nothing in common,
which is the only test a transformation has to pass."* Alicia's form clears it by being a
`drake` (`sprites.js:1044-1050`). A humanoid-with-horns is a weaker claim, and every
feature above is legal — `wings: 'dragon'` at `pixelArt.js:766-771`, `tail: 'scaled'` at
`798`, `ears: 'greatHorns'` at `2693` — which is exactly why it is tempting and exactly why
it may not be enough.

The alternative, checked against the renderer rather than guessed at: **`body: 'titan'`**
(`pixelArt.js:4006-4072`, in `BODY_PLANS` at `4074-4083`). It is a genuinely different
figure — slab musculature, a sternum line and rib bands, a two-beat trudge that skips the
passing lift, fists instead of hands. But it reads **only** `outfit`, `accent`, `eyes`,
`cape`, `ears: 'horns'|'greatHorns'` and `chest`. **It draws no weapon, no hair and no
garment.** For a character whose entire identity is the slab of iron he is carrying, losing
the greatsword in the form the sword *causes* is the wrong trade.

So: the humanoid version above is the recommendation, and the acceptance test is a render,
not an argument. `tests/pixelArt.js:78-89` only catches *pixel-identical*; the standard is
"nameable from the silhouette" (`sprites.js:9-13`). Build the contact sheet, put
`kuroba` and `kuroba_black` side by side with the colour off, and if the two read as the
same person in a bigger coat, take `titan` and give him a `chest` crest instead of a
sword.

**Codex voice:**
> *Everyone else was handed something. He was handed a book with nothing in it and a sword
> too heavy to lift, and he has never once mentioned that this is unfair, because he is
> too busy lifting it.*

**Barks:**
- spawn: `"No magic. None. Zero. Watch what I do about it."`
- lowHp: `"Still standing. That is the entire trick."`
- boss: `"Good. The small ones were getting boring."`

---

## 3 · `enshi` — ★4 fire — **one lion, not a swarm**

**Slot and why.** The first fire ★4 — that row has light, lightning ×2, spirit ×2 and
steel and nothing else. Mechanically: the roster's minion kits are both *swarms* (uzu's 5
clones, nekromina's 5 deadbeats plus 4 zombies). A **single permanent companion you
position around** is a different game, and nobody plays it.

**Codename derivation.** House pattern #2 as a coined compound, exactly the way
`shiro_same` is white+shark: 炎獅 *enshi*, flame+lion.

```
id: 'enshi'   name: 'Enshi'   epithet: 'The Lion Stands With Him'
rarity: 4   archetype: 'Beast Commander'   element: 'fire'
visual: { shape: 'capsule', color: '#ff7a2b', accent: '#ffd76a', emoji: '🦁', size: 16 }
stats: hp 118, armor 1, moveSpeed 168, pickupRadius 46,
       damageMult 1.0, attackSpeedMult 1.0, areaMult 1.05,
       critChance 0.05, critMult 2.0, cooldownMult 1.0, luck 0
```

**Stat anchors.** ★4 HP runs 90 (unit_09) to 130 (uzu); 118 sits between captain_yuli's
100 and uzu's 130. `armor 1` at ★4 belongs to captain_yuli alone today, and it is the
right price for a character who never runs: the lion holds the line and he stands behind
it. moveSpeed 168 ties the roster floor (mochi, kira, brant) for the same reason.

**Auto — `lion_lance` / "Lion Lance"** · `interval 0.8, damage 20, targeting { mode: 'nearest' }`
> A lance of fire thrown at the nearest thing every 0.8s for 20 damage — and the lion
> throws its own at the same target 0.25s later for 14. Two attackers, one decision.

His own 20/0.8 = **25 raw**, the companion adding 14/0.8 = 17.5 for **~42.5 combined**.
The ★4 solo band is 18 (hoshino_rei) to 31 (captain_yuli) and the ★4 multi-body band is
40 (kagura) to 69 (yamikage); 42.5 sits at the bottom of the multi-body band, which is
correct because half of it is on a leash and can be out of position. The lion's 14 comes
through the minion's `damageOverride` (`helpers.js:73-77`) and therefore does **not** get
the signature-weapon scaling, which `tests/weapons.js:365-382` cares about.

**Special — `lions_domain` / "LION'S DOMAIN"** · `cooldown 23`
> He plants the lion and claims 340px of ground for 7s. Inside it: enemies burn for 45/s,
> he takes 30% less damage, and the lion attacks 3x as fast. Step outside and it is just a
> circle on the floor.

cd 23 sits between unit_09's 22 and hoshino_rei's 24 — mid-★4. Built on `H.field`
(`helpers.js:599`), the same primitive reika's vortex uses.

**Escape — `flamebound_step` / "Flamebound Step"** · `cooldown 6, iframes 0.6`
> The lion takes the hit for him. 0.6s invulnerable, 260px along your movement direction,
> and the lion stays behind and taunts everything within 220px for 2.5s.

`applyTaunt` (`statusEffects.js:91`) on an *escape* rather than on a special — brant's
taunt is a 22s special, so this is the same tool at a completely different cadence.

**Passive — `the_lion` / "The Lion"**
> A fire lion is out from the first second of the run and never leaves. It has 40% of his
> damage, holds a 200px leash, and every 20 kills it makes permanently adds +6% to its own
> damage. It dies to nothing — it only ever goes back to a walk.

**DECISIONS.md §27 call:** this is `summon()` (`helpers.js:618`) with `isMinion: true`, not
`prop()` (`625`). It is a real minion and must declare it, because that flag is what
suppresses niten's Dokkodo — and getting it wrong silently buffs or breaks a different
character. Since Enshi always owns a minion, niten's "+30% while you own no minions" is
untouched for niten players; the flag matters only for the count read.

**Star upgrades**
- s3: `"Lion's Domain reaches 440px and its burn climbs to 70/s."`
- s5: `'Flamebound Step leaves a 5s ring of fire dealing 40/s where he left.'`

**Signature relic — `the_standing_order` / "The Standing Order"**
```
owner: 'enshi'  rarity: 'epic'  icon: '🦁'  shipName: null
desc:          'Every 10s, whatever fights beside you strikes for 200 damage in a 200px radius. If you own nothing, you strike instead.'
resonanceDesc: 'RESONANCE: every 7s, 300 damage, 300px.'
hooks:     ['onInterval']
params:    { interval: 10, damage: 200, radius: 200 }
resonance: { interval: 7,  damage: 300, radius: 300 }
visual: { shape: 'triangle', color: '#ff7a2b', accent: '#2a1a10', size: 12 }
dropWeight: 140
codex: 'He gave it one instruction on the first day and has never had to give it another.'
```
Deliberately written so it is *usable by anyone* — `relics.js:5` requires that — and pays
out even for a character with no minions. 10/1.5 = 6.67, rounded to 7.

**Sprite descriptor**
```js
enshi: {
  body: 'humanoid',
  hair: 'plume', hairColor: '#ff7a2b', hairTip: '#ffd76a',
  skin: '#e8b98a', outfit: '#f2ece0', accent: '#ff7a2b', eyes: '#ffb03d',
  pauldrons: '#d8c8a8', pauldron: 'left',
  cape: '#c2402a', highCollar: '#f2ece0',
  coat: '#f2ece0', coatTrim: '#ffb03d', coatButtons: '#c8a24a',
  sash: '#c2402a', sashBuckle: '#ffd76a',
  gauntlets: true, armWraps: '#e8e0d0',
  legColor: '#e8e0d0', boots: '#8a5a2a', bootHeight: 'knee',
  aura: '#ff7a2b', sparks: '#ffd76a',
  weapon: 'spear', weaponColor: '#ffd76a', gripColor: '#8a5a2a',
}
```
`plume` and `spear` are both unclaimed by any character. A pale-coated officer with a
flame crest, one shoulder pad and a lance shares nothing with hikari (the other fire
character, orange `wave`, feathered, no weapon) or with akane (`twinLong`, tricorn,
cutlass).

**Codex voice:**
> *He is the third-born and he has never once behaved like it. The lion was not given to
> him either — it simply started walking beside him one day and neither of them has
> discussed it since.*

**Barks:**
- spawn: `"Hold this ground. Both of us."`
- kill: `"Good. Next."`
- boss: `"You will find it does not tire and neither do I."`

---

## 4 · `dokuga` — ★4 shadow — **poison, and a stack that ripens on the enemy**

**Slot and why.** The first shadow ★4, taking shadow to three of the four tiers. And the
first kit built on `applyPoison`, which has existed and ticked correctly since
`statusEffects.js:78` and `171-174` and has never had an owner.

**The correction that shaped this kit.** The recon said poison "exists but is not
re-exported." True, and there is a second problem it did not catch: **`applyPoison` takes
the MAX, it does not stack** (`statusEffects.js:79-80`, and the header at 63-65 explains
why — "that is what keeps 200 overlapping burns from deleting a boss instantly"). There is
no `poisonStacks` field on the status object. So a naive "5 stacks of poison" design does
not work and would need a new status field.

The fix that costs nothing: the ramp lives on **him**, not on them. His `resourceBar`
climbs, the poison he applies scales off it, and `applyPoison`'s max-wins semantics then
do exactly the right thing for free — every re-application upgrades the target.

**Codename derivation.** House pattern #2, coined compound: 毒牙 *dokuga*, poison+fang. The
epithet carries the other half of the character, which is the joke.

```
id: 'dokuga'   name: 'Dokuga'   epithet: 'The Friend You Did Not Notice'
rarity: 4   archetype: 'Plague Whisperer'   element: 'shadow'
visual: { shape: 'capsule', color: '#4a2f6e', accent: '#8ef04a', emoji: '☠', size: 16 }
stats: hp 108, armor 0, moveSpeed 166, pickupRadius 56,
       damageMult 0.95, attackSpeedMult 1.0, areaMult 1.15,
       critChance 0.03, critMult 2.0, cooldownMult 0.95, luck 1
resourceBar: { id: 'virulence', label: 'VIRULENCE', color: '#8ef04a', max: 100 }
```

**Stat anchors.** `critChance 0.03` is **the lowest on the roster** (0.05 was the floor,
shared by **twenty** of the twenty-eight — I tallied the column rather than eyeballing it)
because a poison kit does not crit — the damage is on a timer, not on the hit, and
pretending otherwise would make Keen Eye a trap upgrade on his card. `areaMult 1.15` is
**the new high** (brant and pekora at 1.10 were the ceiling) because clouds are the
delivery. `moveSpeed 166` is **the new floor** — 168 is the current one and three
characters sit on it (mochi, kira, brant). `cooldownMult 0.95` matches rima's, the only
other sub-1.0.

**Auto — `creeping_word` / "Creeping Word"** · `interval 1.0, damage 6, targeting { mode:
'nearest' }`
> A whisper drifts to the nearest thing every 1.0s and settles on it: 6 damage on contact,
> then poison. The poison is worth 7/s at an empty VIRULENCE bar and 42/s at a full one.
> Nothing he does is worth anything on the frame he does it.

**6 raw on-hit DPS — the lowest number in that column on the roster by half** (mochi's 12
was the floor), and that is the whole statement. Full ramp on a single target is
6 + 42 = **48/s**, which sits with rin and niten at 43 and brant at 47 — the ★5 melee
band, reached by a ★4 who needed the whole bar to get there. Formula: `poisonDps = 7 +
0.35 × virulence`.

**Special — `bloom_of_rot` / "BLOOM OF ROT"** · `cooldown 24`
> Every poisoned enemy on screen ruptures at once: 120 damage in a 160px radius around
> each one, and each rupture passes his current poison to everything it catches. Each
> enemy ruptures at most once per cast — the chain has to end somewhere.

cd 24 matches hoshino_rei and rin. The "at most once per cast" clause is load-bearing:
without it this is an unbounded loop on a packed screen.

**Escape — `exhale` / "Exhale"** · `cooldown 6, iframes 0.7`
> He breathes out and is not really there. 0.7s untargetable while he drifts 180px along
> your movement direction, and the breath stays where he started: a 240px cloud for 5s,
> 30 damage/s and poison to anything that walks into it.

**Passive — `it_spreads` / "It Spreads"**
> VIRULENCE fills 1 per enemy killed while poisoned and 1 per 2s spent with 5 or more
> enemies poisoned at once. And every enemy that dies while poisoned bursts into a 90px
> cloud for 3s that poisons whatever is standing in it. He does not kill crowds. He starts
> them.

The bar is the third on the roster after han's RAGE and nika's AMMO, and it is a genuinely
different *fill*: han's fills from suffering, nika's is spent ammunition, this one is a
tally of work done. The HUD renders any declared bar generically (`player.js:96`,
`characters.js:1402-1404`) — no branching required.

**Star upgrades**
- s3: `'Bloom of Rot ruptures for 190 damage and its radius grows to 220px.'`
- s5: `'Exhale leaves 2 clouds — one where he started and one where he stopped.'`

**Signature relic — `the_unopened_letter` / "The Unopened Letter"**
```
owner: 'dokuga'  rarity: 'epic'  icon: '✉'  shipName: null
desc:          'Every 9s the 6 nearest enemies are poisoned for 20/s for 6s, and poisoned enemies take +12% damage from everything.'
resonanceDesc: 'RESONANCE: every 6s, 9 enemies, 30/s, and +18% damage taken.'
hooks:     ['onInterval']
params:    { interval: 9, count: 6, dps: 20, duration: 6, vulnPct: 0.12 }
resonance: { interval: 6, count: 9, dps: 30, duration: 9, vulnPct: 0.18 }
visual: { shape: 'cross', color: '#8ef04a', accent: '#2a1f3a', size: 12 }
dropWeight: 140
codex: 'He wrote it, folded it, and put it under the door. Then he wrote another one.'
```
`vulnPct` rides `applyVulnerable` (`statusEffects.js:106`), already exported by
`helpers.js:29`. `count` and `dps` take `default: 'up'`; `interval` is `'down'`.

**Sprite descriptor**
```js
dokuga: {
  body: 'humanoid',
  hair: 'hood', hairColor: '#2a1f3a',
  skin: '#c8b8d0', outfit: '#3a2a52', accent: '#8ef04a',
  eyes: '#8ef04a', eyeGlow: '#c8ff8a',
  coat: '#2a1f3a', coatRagged: true, highCollar: '#3a2a52',
  armWraps: '#4a3a62', gloves: '#1a1424',
  legColor: '#1a1424', boots: '#2a1f3a',
  chest: '#8ef04a', aura: '#8ef04a',
  weapon: 'none',
}
```
`hair: 'hood'` **replaces the style and blacks the face out** (`sprites.js:52-55`) and is
worn by no character — only by the `ambusher` enemy archetype at `sprites.js:1164`, which
the character pixel-identity test (`tests/pixelArt.js:78-89`) does not compare against. A
tall hooded column with no face and green light coming off it is the most distinct
silhouette in the cohort, and it is also the brief: nobody can see him and nobody can hear
him.

**Codex voice:**
> *He has drafted the same three sentences eleven times. In the version he will actually
> say out loud, it comes out as a noise, and then everyone within forty feet stops being
> alive, and he apologises for that too.*

**Barks:**
- spawn: `"...hello. I said hello. I did say it."`
- kill: `"Oh — sorry. Sorry. It was already happening."`
- victory: `"You could stay. If you wanted. No pressure. None."`

---

## 5 · `ibara` — ★5 spirit — **`thorns`, at last**

**Slot and why.** Spirit ★5 is the **only empty cell in the entire ★5 row**. And `thorns`
is a real runtime stat (`player.js:38`) applied by `damage.js:293-295` on `SRC.CONTACT`
that no character, upgrade path or relic is built on. The archetype hole is the matching
one: brant is the closest thing to a retaliation character and his is a 22-second special
that *stores* damage; nobody plays a permanent standing rule where being surrounded is the
rotation.

**Codename derivation.** House pattern #2: 茨 *ibara*, "briar/thorn" — the same one-word
semantic translation as `hikari` and `aoi`.

```
id: 'ibara'   name: 'Ibara'   epithet: 'She Does Not Step Back'
rarity: 5   archetype: 'Briar Warden'   element: 'spirit'
visual: { shape: 'capsule', color: '#4a7fd6', accent: '#d64a7f', emoji: '🌹', size: 16 }
stats: hp 126, armor 1, moveSpeed 162, pickupRadius 44,
       damageMult 1.0, attackSpeedMult 0.95, areaMult 1.10,
       critChance 0.05, critMult 2.0, cooldownMult 1.0, luck 0
```

**Stat anchors.** HP 126 is the second-highest ★5 behind brant's 145 and ahead of rin's
120. `armor 1` is shared with exactly the two ★5s who also refuse to move (niten, brant).
`moveSpeed 162` is **the new roster floor** — 168 was the old one — and it is the
mechanical statement of the character: a thorns build that can kite is a thorns build that
never triggers. `attackSpeedMult 0.95` is the second sub-1.0 declaration in the cohort
after kuroba's 0.90. `areaMult 1.10` ties brant and pekora.

**Auto — `briar_lash` / "Briar Lash"** · `interval 0.8, damage 16, targeting { mode:
'nearestN', count: 2, range: 340 }`
> Two briars whip out at the two nearest things inside 340px every 0.8s for 16 damage
> each, and each one leaves a 60px patch of thorned ground for 2.5s dealing 14/s.

16 × 2 / 0.8 = **40 raw**, just under rin and niten at 43, with the ground patches
carrying the rest. The ★5 band runs 20 (nekromina, yukine) to 81 (karin), so this is a
low-middle number on purpose — her output is supposed to arrive through the passive.

**Special — `bloom` / "BLOOM"** · `cooldown 21`
> She sets her feet and the ground opens outward in rings: 5 waves over 3.5s, each one
> 90px further out than the last (120px to 480px), 95 damage a wave, each leaving thorned
> ground for 4s at 22/s. She cannot move while it runs and she does not want to.

cd 21 sits between nika's 12 and brant's 22 and is the second-shortest ★5 special — short
because it is a stationary channel and she is paying for it in the only currency she has.
An *expanding concentric* nova is a shape nothing on the roster does: hikari's is one
nova, mochi's is one eruption, karin's is a fixed 300px spin.

**Escape — `rose_guard` / "Rose Guard"** · `cooldown 6, iframes 0.6`
> A briar shell closes over her for 0.6s — invulnerable, no movement at all — and then
> bursts: 90 damage in 210px and 2.5s of 45% slow.

**Honest note:** this is the third escape on the roster that does not move you (niten's
0.4s parry, sora's 1.8s stand-still). It earns its place because it is the only one that
makes the *crowd* worse off rather than the player better off, and because standing
perfectly still is the character. Still — a reviewer should read all three side by side
before signing off.

**Passive — `thorncrown` / "Thorncrown"**
> Anything that touches her takes 35% of the damage it dealt straight back, and every 250
> damage her thorns return permanently adds another 2%. Uncapped. Being surrounded is not
> the failure state, it is the rotation.

Implementation: set `thorns` through `addBuff` and `recompute()` the way `hoard` does at
`star6.js:615-625` — never a direct stat write, because `player.js:182-183` zeroes the
stat on every recompute.

**Star upgrades**
- s3: `'Bloom grows 6 waves instead of 5 and reaches 560px.'`
- s5: `'Rose Guard bursts twice — once on cast and once 1.0s later.'`

**Signature relic — `the_kept_garden` / "The Kept Garden"**
```
owner: 'ibara'  rarity: 'epic'  icon: '🌹'  shipName: null
desc:          'Every hit you take also bursts for 45 damage in a 140px radius. Your thorns pay 15% more.'
resonanceDesc: 'RESONANCE: 68 damage, 210px, and thorns pay 22.5% more.'
hooks:     ['onDamageTaken']
params:    { damage: 45, radius: 140, thornsBonus: 0.15 }
resonance: { damage: 68, radius: 210, thornsBonus: 0.225 }
visual: { shape: 'flower', color: '#d64a7f', accent: '#1e3466', size: 12 }
dropWeight: 140
codex: 'The wall is beautiful from the outside. Nobody has ever mentioned that from the inside.'
```
All three params take `default: 'up'`, so 45→67.5 (68), 140→210, 0.15→0.225. Usable by
anyone — the burst half works with no thorns at all.

**Sprite descriptor**
```js
ibara: {
  body: 'humanoid',
  hair: 'braid', hairColor: '#f2e8d0', hairTie: '#4a7fd6',
  skin: '#f7dccb', outfit: '#2a4a8a', accent: '#d64a7f', eyes: '#5f8fd6',
  highCollar: '#1e3466', cape: '#1e3466',
  coat: '#2a4a8a', coatTrim: '#d8dee8', coatLapels: '#d8dee8',
  pauldrons: '#c8d2e6',
  sash: '#d64a7f', sashBuckle: '#c8d2e6',
  hakama: '#1e3466',
  gloves: '#d8dee8', cuffs: '#f2f5fb',
  legColor: '#1e3466', boots: '#1a2a4a', bootHeight: 'knee',
  blush: false, aura: '#d64a7f',
  weapon: 'whip', weaponColor: '#4a7fd6', gripColor: '#2a3550',
}
```
`braid` and `whip` are both unclaimed by any character. `blush: false` for the permanently
unmoved expression — the same flag captain_yuli and brant use.

**Codex voice:**
> *Her wall has held every single time it has been asked to. Whether she would like it to
> come down is a question nobody has been brave enough to put to her, and she has been
> waiting a very long time for somebody to try.*

**Barks:**
- spawn: `"You may come to me. I will not be coming to you."`
- lowHp: `"Still. Standing. Still."`
- boss: `"Finally. Something that will actually reach."`

---

## 6 · `narukami` — ★6 lightning — **`highestHp`, on purpose, with no setting for it**

**Slot and why.** Lightning is one of the two empty cells in the ★6 row. And this is the
first character in the game to declare `highestHp` (`targeting.js:115-128`) — implemented,
tested by nobody, used by nothing.

**Codename derivation.** House pattern #2: 鳴神 *narukami*, "thunder god" — an ordinary
Japanese word, not a proper noun, and unmistakably lightning. I rejected `raiga`, which
was the first candidate, purely because `reika` is the roster's other lightning character
and the two ids are one vowel apart in a file people type by hand.

```
id: 'narukami'   name: 'Narukami'   epithet: 'He Only Wants The Big One'
rarity: 6   archetype: 'Bolt Hunter'   element: 'lightning'
visual: { shape: 'capsule', color: '#9fd8ff', accent: '#ffe98a', emoji: '⚡', size: 16, glow: true }
stats: hp 131, armor 1, moveSpeed 192, pickupRadius 44,
       damageMult 1.0, attackSpeedMult 1.20, areaMult 0.85,
       critChance 0.12, critMult 2.0, cooldownMult 1.0, luck 0
```

**★6 floor check** (`characters.js:1187-1191`): 131 HP ✓ (inside 130–150, and chosen to
clear the stated floor cleanly rather than sit under it the way rima's 128 does) · armor 1
✓ · a multiplier above 1.0 ✓ (`attackSpeedMult 1.20`, **the new roster high** — nika's
1.15 was the ceiling) · a compounding passive ✓.

**Other extremes and what they buy.** `moveSpeed 192` is the fastest on the roster (aoi
184, captain_yuli 186). `areaMult 0.85` is the **new low** (captain_yuli's 0.90 was the
floor) — he is a single-target hunter and Wide Reach should be a bad card on him.
`critChance 0.12` is the **new high** (karin 0.10).

**Auto — `thunder_fang` / "Thunder Fang"** · `interval 0.4, damage 26, targeting { mode:
'highestHp', range: 700 }`
> A bolt every 0.4s at whatever has the most HP left inside 700px, for 26 damage. Not the
> nearest. Not the one about to hit you. The biggest one, always, and there is no setting
> for it.

26 / 0.4 = **65 raw**, between rima's 60 and karin's 81 — a real ★6 number. The whole
price of it is in the mode: on a crowded screen every point goes to the worst possible
target and something small is already touching you.

**Special — `stormbreak` / "STORMBREAK"** · `cooldown 19`
> For 5s a bolt falls every 0.35s on whatever has the most HP left within 900px: 120
> damage each, splitting to the 3 nearest things around it for 45. About fourteen bolts.
> It will not clear a wave. It will end a boss.

**1680 single-target over 5s.** Anchor: karin's ★5 DEATH LOTUS puts ~460 on everything
inside 300px over 2.4s; this is ~3.6x that, on exactly one body, from a ★6.
cd 19 becomes **the shortest ★6 special on the roster** (rima's 20 was the floor) and the
justification is structural: it does nothing at all to a crowd, so it is allowed back
sooner. Still inside the 12–35 band.

**Escape — `closer` / "Closer"** · `cooldown 4, iframes 0.35`
> A 320px dash TOWARD whatever has the most HP left, invulnerable through it, 110 damage
> on arrival. Every other escape in the game moves you away from the problem. This is the
> problem, and he is going to it.

cd 4 ties brant's, the shortest non-zero on the roster (kagura's 0 is the documented
exception, DECISIONS.md §53). iframes 0.35 becomes the shortest real window (niten's 0.4
was the floor) and clears the `>= 0.2` rule at `suites.js:671-682` with room.

**Passive — `the_big_one` / "The Big One"**
> +25% damage against whatever currently has the most HP on screen, and every elite or boss
> he kills adds a permanent +3% damage for the rest of the run. Uncapped. He is not a
> wave-clearer and he has never pretended to be.

Compounds ✓. The elite clause is `onKill` reading `enemy.isElite || enemy.isBoss`, the
same fields `targeting.js:39` reads for its `elite` filter.

**Star upgrades**
- s3: `'Stormbreak runs 8s instead of 5 and each bolt splits to 5 enemies.'`
- s5: `'Closer holds 2 charges.'` — a second use of `escape.charges` (`player.js:110`),
  after rima's 3 and yamikage's special 2.

**Signature relic — `the_only_one_worth_hitting` / "The Only One Worth Hitting"**
```
owner: 'narukami'  rarity: 'legendary'  icon: '⚡'  shipName: null
desc:          'Every 5th hit on the highest-HP enemy on screen deals 250 bonus damage.'
resonanceDesc: 'RESONANCE: every 3rd hit, 375 bonus damage.'
hooks:     ['onNthAutoAttack']
params:    { everyNth: 5, damage: 250 }
resonance: { everyNth: 3, damage: 375 }
visual: { shape: 'shard', color: '#ffe98a', accent: '#151a28', size: 13, glow: true }
dropWeight: 90
codex: 'He walked past four of them to get to the fifth. They were fine about it, mostly.'
```

**Sprite descriptor**
```js
narukami: {
  body: 'humanoid',
  hair: 'spiky', hairColor: '#9fd8ff', hairTip: '#ffffff',
  skin: '#f0c9a8', outfit: '#2a3550', accent: '#ffe98a',
  eyes: '#ffe98a', eyeGlow: '#ffffff',
  coat: '#1e2436', coatTrim: '#7fc8ee', coatRagged: true,
  harness: '#4a3a2a', gauntlets: true, gloves: '#2a3550',
  shorts: '#1e2436', legColor: '#2a3550', boots: '#151a28', bootHeight: 'knee',
  chest: '#ffe98a', sparks: '#ffe98a', aura: '#9fd8ff',
  weapon: 'claws', weaponColor: '#ffe98a',
}
```
**Highest silhouette risk in the cohort.** `spiky` is already worn by uzu and han, both of
whom are `young: true` with `weapon: 'none'` and a bright aura. The separations are: he is
not `young`, his hair is pale blue running to white rather than blond or black, he wears a
ragged coat and a harness rather than a jumpsuit or a gi, and he is the **only character
carrying `claws`**. Render him next to both before accepting — `tests/pixelArt.js:78-89`
fails on pixel-identity and will catch a true clash, but "not identical" is a lower bar
than "nameable from the silhouette", which is the standard `sprites.js:9-13` sets.

**Balance flag.** A `highestHp` auto against a boss-with-adds means he ignores adds
entirely, so the sweep will report him with an unusual kills/s-to-DPS ratio for a
structural reason rather than a balance one. Read the RANK, not the seconds
(DECISIONS.md §52). Do **not** reach for `metric` to paper over it — see Part 5.

**Codex voice:**
> *Somebody once explained to him that the smaller ones give the same experience and are
> considerably less likely to kill you. He listened to the entire explanation. He was
> being polite.*

**Barks:**
- spawn: `"Which of you is the strongest? No — don't answer. I'll find out."`
- lowHp: `"Ha! HA! Do that again!"`
- boss: `"THERE you are. I have been walking past people for ten minutes."`

---

## 7 · `sakai` — ★6 shadow — **the fourth `resourceBar`, and a cut that leaves the arena**

**Slot and why.** The last empty ★6 cell, and the third shadow slot — which takes the
thinnest element on the roster from present-in-one-tier to present-in-all-four.
Mechanically: the 4th `resourceBar`, and the roster's first execute that is *positional*
rather than conditional on a timer (kira) or on max-HP rank (captain_yuli).

**Codename derivation.** House pattern #2, semantic translation of the defining trait: 境
*sakai*, "boundary / border" — what his signature move cuts. Deliberately **not** built on
*yami*, which `yamikage` already spent, and deliberately not a *kuro-* word, because
`kuroba` in this same cohort is the other black-blade character.

```
id: 'sakai'   name: 'Sakai'   epithet: 'One Step Past'
rarity: 6   archetype: 'Boundary Cutter'   element: 'shadow'
visual: { shape: 'capsule', color: '#2a2233', accent: '#7a4fd6', emoji: '🌑', size: 17, glow: true }
stats: hp 148, armor 1, moveSpeed 166, pickupRadius 44,
       damageMult 1.05, attackSpeedMult 0.95, areaMult 1.10,
       critChance 0.05, critMult 2.2, cooldownMult 1.0, luck 0
resourceBar: { id: 'limit', label: 'LIMIT', color: '#7a4fd6', max: 100 }
```

**★6 floor check:** 148 HP ✓ (second-highest on the roster behind sora's 150, inside the
130–150 band) · armor 1 ✓ · `damageMult 1.05` above 1.0 ✓ (ties alicia, mirel, akane,
karin) · a compounding passive ✓. `critMult 2.2` ties niten — the two swordsmen who hit
once and mean it. `moveSpeed 166` is second only to ibara's 162 as the roster floor.

**Auto — `dark_cloak` / "Dark Cloak"** · `interval 0.95, damage 46, targeting { mode:
'facing' }`
> A single drawn cut every 0.95s: a 90° wedge 420px long, 46 damage, passing through
> everything inside it. He has the longest reach of any melee character in the game by a
> factor of four and he still walks toward you.

46 / 0.95 = **48 raw**, sitting with han (47, piercing beam), brant (47) and akane (46).
What makes it a ★6 is the 420px wedge: alto's arc reaches 85px, captain_yuli's 70px,
kuroba's 110px. Built on `H.coneDamage` (`helpers.js:38`) — no engine cost.

**Special — `dimension_slash` / "DIMENSION SLASH"** · `cooldown 26`
> One cut across the whole arena in the direction he is facing. 300 damage flat plus 4 per
> point of LIMIT — 700 at a full bar — piercing everything in the line, and anything left
> under 20% HP after it lands is cut out of the run entirely. Spends the bar.

cd 26 sits between rima's 20 and mirel's 28. The execute clause is `H.executeEnemy`
(`helpers.js:38`), already exported, already used by captain_yuli and kira. **This name is
a coined technique title and needs a `shipNames.js` entry** — see Part 3.4.

**Escape — `through_the_floor` / "Through The Floor"** · `cooldown 6, iframes 0.7`
> He drops into his own shadow and comes up 340px along your movement direction.
> Invulnerable, 90 damage to everything the line crossed, and every point of damage he took
> in the last 3s converts to LIMIT at double rate on the way up.

The escape feeding the resource is what stops the bar being a passive tax — it is the one
button that turns a bad three seconds into the next special.

**Passive — `one_step_past` / "One Step Past"**
> LIMIT fills 1 per enemy his blade passes through and 2 per hit he takes. At a full bar he
> gains +30% damage until he spends it, and every 200 LIMIT spent this run permanently adds
> +1.5% damage. Uncapped.

Compounds ✓. **Note the deliberate separation from han:** han's RAGE fills only from
damage *taken* and cashes out as a 15s transformation (`characters.js:1350-1404`). This
bar fills mostly from *work done* and cashes out as a number on one attack. Same field,
opposite economy — which is the argument for a fourth one existing at all.

**Star upgrades**
- s3: `'Dimension Slash cuts twice — a second cut 0.6s later at 60% damage.'`
- s5: `'Through The Floor executes anything under 12% HP along the line.'`

**Signature relic — `the_line_you_do_not_cross` / "The Line You Do Not Cross"**
```
owner: 'sakai'  rarity: 'legendary'  icon: '🌑'  shipName: null
desc:          'Every 15s, the next attack you land also cuts a 900px line through everything behind the target for 350 damage.'
resonanceDesc: 'RESONANCE: every 10s, 1350px, 525 damage.'
hooks:     ['onInterval', 'onAutoAttack']
params:    { interval: 15, damage: 350, length: 900 }
resonance: { interval: 10, damage: 525, length: 1350 }
visual: { shape: 'crescent', color: '#7a4fd6', accent: '#151520', size: 13, glow: true }
dropWeight: 90
codex: 'He did not aim at the thing. He aimed at the space it was standing in.'
```
Two hooks arming and firing. The precedent to copy is `potato_chip_gambit`
(`relics.js:370-387`) — kira's signature, `hooks: ['onInterval', 'onAutoAttack']`, an
`owner`, and a fully resolved `resonance` block. `abyssal_setlist` (`relics.js:649-662`)
wears the same two hooks but is a **stage** relic with `owner: null` and `resonance: null`,
so it is the wrong thing to copy for a signature.

**Sprite descriptor**
```js
sakai: {
  body: 'humanoid', gridW: 40, gridH: 54,
  hair: 'wild', hairColor: '#15151f',
  skin: '#c8a078', eyes: '#e8ecf5', eyeShadow: true, stubble: true,
  outfit: '#1a1a24', accent: '#7a4fd6',
  coat: '#1a1a24', coatTrim: '#7a4fd6', coatCuffs: '#241f34',
  underLayer: '#c8a078',
  sash: '#3a2a52', sashBuckle: '#7a4fd6',
  hakama: '#1a1a24', armWraps: '#3a3444',
  legColor: '#15151f', boots: '#241f2e',
  aura: '#7a4fd6',
  weapon: 'katana', weaponColor: '#2a2233', gripColor: '#7a4fd6',
}
```
40x54 is the maximum grid `pixelArt.js:1-60` allows and he should use all of it — he is
the largest human on the roster and the silhouette should say so before the colour loads.
`wild` is otherwise brant's (shaggy *red*, fur collar, mail, an enormous axe, and a
visibly terrified face); this is a dark-skinned, stubbled, eye-shadowed man in an open coat
over a bare chest. `katana` is otherwise rin's (young, ponytail, checkered haori, cyan
blade). Both separations are structural, not palette — but render all three.

**Codex voice:**
> *He has one piece of advice and he gives it to everybody, in the same four words, whether
> or not they have asked. Nobody has ever found a situation it did not apply to, which is
> either very good advice or no advice at all.*

**Barks:**
- spawn: `"Surge past it. That's the whole lesson. Class dismissed."`
- lowHp: `"Good. Now it's interesting."`
- boss: `"Stand there. Right there. Don't move — this only works once."`

---

## 8 · `bakuen` — ★5 fire — **the one non-Black-Clover slot**

**Why not Black Clover.** The hole here is *cursor-placed artillery with a deliberately
useless auto-attack* — the first character to declare `mouseAim` in `characters.js`. Black
Clover's placement mages are Zora (traps, which is pekora's whole archetype at
`characters.js:1899`) and Rill (painting, a child captain whose kit reads as summons). Its
cast is built around named duels rather than around one enormous number, so every
candidate I tried either collided with the trap layer or with the charge-nuke (sora). This
one is a clean fill from elsewhere and the rest of the cohort stays on-source.

**Slot.** ★5 fire — the ★5 row has only one fire character (hikari), and adding a second
does not require touching the ★5/★6 ratio at all.

**Codename derivation.** House pattern #2, coined compound: 爆炎 *bakuen*, explosion+flame.

```
id: 'bakuen'   name: 'Bakuen'   epithet: 'One. Every Twenty Seconds.'
rarity: 5   archetype: 'Single-Cast Artillerist'   element: 'fire'
visual: { shape: 'capsule', color: '#e0452c', accent: '#ffd23f', emoji: '💥', size: 15 }
stats: hp 92, armor 0, moveSpeed 170, pickupRadius 58,
       damageMult 1.0, attackSpeedMult 0.85, areaMult 1.30,
       critChance 0.05, critMult 2.5, cooldownMult 0.85, luck 1
```

**Stat anchors — four new roster extremes, all in the same direction.** HP 92 is
second-lowest behind kira's 90. `attackSpeedMult 0.85` is the **new floor** (kuroba's 0.90
is next). `areaMult 1.30` is the **new ceiling** by a distance — 1.10 was the previous high
and 1.15 is dokuga's in this same cohort. `cooldownMult 0.85` is the **new floor** (rima's
0.95 was it) because the special *is* the character and the entire stat line is bent
around getting it back. `critMult 2.5` is the **new high** (niten 2.2, karin 2.1) — a
character with exactly one number wants that number to spike.

**Auto — `kindling` / "Kindling"** · `interval 1.4, damage 9, targeting { mode: 'mouseAim',
range: 520 }`
> A weak dart of flame every 1.4s for 9 damage, wherever you are pointing. It is the worst
> auto-attack in the game and she is aware. It exists to keep her alive between the only
> thing she actually does.

9 / 1.4 = **6.4 raw DPS — the lowest number in the column by half** (mochi's 12 was the
floor), and deliberate.

**On `mouseAim`.** The recon said no character uses it; that is true of the *declared*
`targeting` field, but reika's IRON SAND STORM already resolves `{ mode: 'mouseAim', range:
600 }` inside her special (`star5a.js:57` and `598-599`), and the comment there records
that DECISIONS.md §17 already resolved mouse/pad/touch/auto behind `run.aimAngle()`
(`targeting.js:85-86`). So the pad fallback is proven and this costs nothing — she is
simply the first character whose *card* declares it.

**Special — `explosion` / "EXPLOSION"** · `cooldown 20`
> She stops dead, speaks for 1.6s, and a 420px crater appears exactly where the cursor was
> when she finished: 1400 damage, flat, to everything inside it. She cannot move, attack or
> escape during the speech. Afterwards she is at 40% move speed for 3s.

cd 20 sits between nika's 12 and brant's 22. **1400** anchor: karin's ★5 DEATH LOTUS puts
~460 on everything inside 300px over 2.4s, and hikari's REBIRTH NOVA is a 320px burst plus
a 25%-maxHP heal. One 420px circle at 1400, once per 20s, with a 1.6s immobile telegraph
and a 3s slow after, averages ~70 DPS — *below* her bracket. The entire design is that it
does not average.

**Escape — `carried_off` / "Carried Off"** · `cooldown 8, iframes 0.9`
> She has no escape of her own. Something drags her 260px along your movement direction,
> 0.9s invulnerable, and drops her. If she is mid-speech the cast survives and lands where
> she ends up — the only way she ever gets to move during it.

cd 8 matches nika and mirel; iframes 0.9 matches akane and pekora.

**Passive — `one_a_day` / "One A Day"**
> Every second she spends NOT casting Explosion adds 3% to its damage, capped at +150% —
> fifty seconds of restraint. At the cap, one circle is 3500 damage. The counter empties
> the instant it goes off. Standing around is the build.

The cooldown is 20s and the cap is at 50s, so **holding the button is a real decision made
twenty times a run**, which is what `relics.js:5-8` demands of relics and what the best
characters here already do (karin's retrieval loop, pekora's unsprung trap).

**Star upgrades**
- s3: `'Explosion reaches 540px and the speech shortens to 1.1s.'`
- s5: `'Carried Off drops 4 kindling motes along the path, 60 damage each.'`

**Signature relic — `the_speech` / "The Speech"**
```
owner: 'bakuen'  rarity: 'epic'  icon: '💥'  shipName: null
desc:          'Your special deals +8% damage per second it spent on cooldown before you cast it, up to +80%.'
resonanceDesc: 'RESONANCE: +12% per second, up to +120%.'
hooks:     ['onSpecial']
params:    { perSecond: 0.08, cap: 0.80 }
resonance: { perSecond: 0.12, cap: 1.20 }
visual: { shape: 'star', color: '#e0452c', accent: '#2a1f2e', size: 12 }
dropWeight: 130
codex: 'It is forty-one syllables long and she has never once shortened it for anybody.'
```
Deliberately written for **any** long-cooldown character, not just her — `the_loose_cannon`
(`relics.js:716-737`) is the model: priced against its owner's cooldown, usable by
everyone.

**Sprite descriptor**
```js
bakuen: {
  body: 'humanoid', young: true, gridW: 34, gridH: 48,
  hair: 'bob', hairColor: '#2a1f2e', hairTip: '#8a2a3a',
  skin: '#fbe0cc', outfit: '#2a1f3a', accent: '#e0452c',
  eyes: '#e0452c', eyeGlow: '#ff8a3d',
  eyepatch: 'right', eyepatchColor: '#1a1424', eyepatchStrap: '#1a1424',
  hat: 'pointed', hatColor: '#2a1f3a', hatTrim: '#e0452c',   // <-- see note
  cape: '#3a1f2e',
  coat: '#2a1f3a', coatTrim: '#e0452c',
  sash: '#e0452c', sashBuckle: '#ffd23f',
  skirt: '#1a1424', chest: '#ffd23f',
  legColor: '#2a2430', boots: '#1a1424', bootHeight: 'knee',
  aura: '#e0452c', sparks: '#ffd23f',
  weapon: 'staff', weaponColor: '#5a4130', gripColor: '#e0452c',
}
```
**`hat: 'pointed'` DOES NOT EXIST YET.** `sprites.js:47-55` offers `tricorn | topHat |
beret` and nothing else, and `pixelArt.js` silently ignores anything its switch does not
know. This is the cohort's one vocabulary addition, and it is exactly the precedent
`sprites.js:85-127` documents at length — "one concrete line of somebody's refNotes that
the vocabulary simply could not say." The alternative is `topHat`, which reads as a stage
magician and is wrong. Cost: one new case in the headgear switch, off by default, changing
nothing already in the table. Called out again in Part 5.

Separation from reika, the other `bob`: reika is a brown bob in a school uniform with
`weapon: 'none'`; this is a black-to-crimson bob under a pointed hat, `young`, one eye
covered, a cape and a gnarled staff.

**Codex voice:**
> *She could learn a second spell. It has been offered, repeatedly, by people who are
> trying to help. She would rather be the best in the world at one thing than adequate at
> nine, and — this is the part they keep missing — she is right.*

**Barks:**
- spawn: `"Do not interrupt the incantation. I mean it. I will start again."`
- lowHp: `"I have one left. That is all I have ever needed."`
- boss: `"Stand still. Please. It would be so much easier for both of us."`

---

## DEV-ONLY — the `refs.js` block

**This entire section is for `src/data/refs.js` and nowhere else.** `refs.js` is deleted
in a ship build and `displayName()` degrades cleanly (DECISIONS.md §22); nothing in
`src/game`, `src/render`, `src/scenes` or `src/ui` may import it. Every codename, ability
name, relic name, sprite descriptor, bark and codex line above stands alone with this
block gone — that was a design constraint on all of them, not a cleanup pass.

`refSource` is allowed to repeat (`refs.js:16-20` — Hololive JP already appears 6x), so
seven characters from one source needs no exception. The two rules that **are** enforced
(`suites.js:256-274`) are: each `ref` names exactly one person with no " and " / " & " /
"/" / " or " / "," in it, and no two characters share one. All eight below pass.

| id | ref | refSource |
|---|---|---|
| `shizuku` | Noelle Silva | Black Clover |
| `kuroba` | Asta | Black Clover |
| `enshi` | Fuegoleon Vermillion | Black Clover |
| `dokuga` | Gordon Agrippa | Black Clover |
| `ibara` | Charlotte Roselei | Black Clover |
| `narukami` | Luck Voltia | Black Clover |
| `sakai` | Yami Sukehiro | Black Clover |
| `bakuen` | Megumin | KonoSuba |

`refNotes` is the **full art brief** each sprite descriptor above was written against
(`refs.js:36-37`, `sprites.js:18-28`) — hair colour and style, eye colour, the specific
garment, the specific accessory, the specific weapon, the signature prop and the
personality beat. Each of the eight needs a paragraph of that depth written at the same
time as the descriptor, not after it. Two must carry an explicit *separation* note the way
rima's does at `refs.js:63-67`:

- `kuroba` — "the roster's other black-bladed shadow swordsman is the large stubbled man
  in the open coat with the katana; this one is a small tanned teenager with a headband and
  a slab of unsharpened iron. Separate at the silhouette, never at the palette."
- `narukami` — "two spiky-haired martial artists already exist and both are drawn young
  with bare hands. This one is an adult, pale blue running to white, in a torn coat, and he
  is the only one on the roster wearing claws."

**One containment gotcha worth writing into the file.** `tests/run.js:133-135` only scans
refs of **6 characters or more**, matched on word boundaries. `'Asta'` is four characters
and therefore **not scanned** — a leak of it into `characters.js` or a comment would pass
the suite silently. The same applies to any short ref a future cohort adds. Note it in
`refs.js` next to the entry.

---

# PART 3 — COHORT ARITHMETIC

## 3.1 Rarity, and the one test that constrains it

After the cohort: **★3 = 4 · ★4 = 8 · ★5 = 14 · ★6 = 10 · total 36.**

`suites.js:333-335` asserts `★5 count >= ★6 count`. 14 >= 10 ✓ — with four to spare, so a
future ★6 does not immediately need a paired ★5. `suites.js:329-331` requires the four
buckets to partition the roster exactly; `data/index.js:248-264` fails the boot if a
character's own `rarity` disagrees with the bucket it sits in.

**The ★3 pool doubles from 2 to 4, which is FIX A executed.** That reopens the question
`gacha.js:20-41` documents — whether `BASE_RATES` should move back toward the spec's
35/48/16/1 now that the pool can support it. **That is an owner call and out of scope for
the builder**: the rates are also load-bearing for the ★5-halving decision recorded at
`gacha.js:27-39`, and `tests/pity.test.js` asserts against the derived curve. Land the
characters; raise the rates as a separate, deliberate change.

## 3.2 Elements after

steel 6 · **spirit 6** · **lightning 6** · **fire 5** · **shadow 5** · **water 4** ·
light 4. From a 6/5/5/4/3/3/**2** spread to 6/6/6/5/5/4/4 — and the ★5 and ★6 rows both
become complete matrices with no empty cell.

## 3.3 Gacha placement — and how to not break the disjointness invariant

`gacha.js:159-172` states the rule: the ten launch ★5s in `POOL_5` are the permanent
standard pool and **everything added after launch is banner-exclusive**. `POOL_3` (line
153) and `POOL_4` (line 154) carry no such comment and are plain lists.

- **★3** — append `'shizuku'`, `'kuroba'` directly to `POOL_3`.
- **★4** — append `'enshi'`, `'dokuga'` directly to `POOL_4`.
- **★5** — do **not** touch `POOL_5`. Use the karin/nika pattern (`gacha.js:327-328` and
  `385-386`): `featured5` plus `pool: { ..., 5: POOL_5.concat(['ibara']) }` on **exactly
  one** banner each.
- **★6** — each needs its own new rate-up banner holding only itself in `pool[6]`, with
  `rateUpChance: 1` and `guaranteedOnLoss: false` (`gacha.js:198-216`). `data/index.js:279-289`
  fails the boot if `featured6` is not inside that banner's own `pool[6]`. Also append both
  ids to `POOL_6_ALL` (line 216) — it is only a ledger now, but it is the one place the
  full bracket is written down next to the banners.

**The elegant part:** put `ibara` on narukami's new banner's `featured5` and `bakuen` on
sakai's. The disjointness invariant at `gacha.js:366-376` ("every ★5 in the game is
favoured on exactly one rate-up") then survives with **zero edits to any existing banner**
— which matters, because that comment records the invariant having been half-broken twice
already.

- **Relic banner** — append all 8 new signature relic ids to `pool.relics`
  (`gacha.js:528-566`) **and** change `completesAt: 33` → `41` (line 578). `data/index.js:303-305`
  cross-checks them and a stale count retires the banner one relic early, making the last
  one unbankable with no error anywhere.

## 3.4 `shipNames.js` — the inclusion test, run

The test (`shipNames.js:33-38`): a name qualifies if it is a proper noun or a coined
technique title lifted from the source. Generic English stays. Real-world public-domain
vocabulary stays. I ran it over all 32 new ability names and 8 new relic names:

| Name | Verdict |
|---|---|
| `dimension_slash` "DIMENSION SLASH" | **Rename.** A coined technique title. → `'Rift Cut'` |
| `black_form` "BLACK FORM" | **Rename.** The source's own name for the transformation. → `'Nightblade Form'` |
| `dark_cloak` "Dark Cloak" | **Borderline — rename.** Two ordinary English words, but they are the source's named spell family. → `'Black Mantle'` |
| everything else | **Stays.** |

Three entries, all deliberate. Four ability names were written *around* this test rather
than through it — `deadweight_swing` instead of an "anti-magic" title, `tideguard` instead
of the source's armour name, `bloom` and `explosion` because both are plain nouns. That is
cheaper than a rename table entry and it means the shipping card reads the same as the dev
card, which is worth something on its own.

All 8 relic names are generic English → `shipName: null`. (Note `the_long_way_round` at
`relics.js:677-692` omits the key entirely rather than setting it null; either is
apparently fine, but `null` matches the older majority.)

## 3.5 The invariants each new entry must satisfy

Checked against the tests, in the order they are most likely to fire:

- 4 ability ids per character, all globally unique (`suites.js:276-285`) — 32 new ids.
- All 4 pillars registered in `AbilityRegistry` (`abilityCoverage.js:32-42`); auto needs
  `fire()`, special and escape need `cast()` (44-64).
- Any special with `tick()` must have a `cast()` whose **source text literally contains
  `ctx.active = true`** — the test greps the function body (`abilityCoverage.js:66-79`).
  Applies to: `tideguard`, `black_form`, `lions_domain`, `bloom_of_rot`, `bloom`,
  `stormbreak`, `explosion`.
- Special cooldowns 12–35 (`suites.js:664-669`): 16, 20, 23, 24, 21, 19, 26, 20 ✓.
- Escape iframes >= 0.2 and cooldown 4–9 (`suites.js:671-682`): 5/0.5, 6/0.55, 6/0.6,
  6/0.7, 6/0.6, 4/0.35, 6/0.7, 8/0.9 ✓.
- Every s3/s5 string carries a digit or an absolute word (`suites.js:519-528`) — all 16 do.
- >= 2 `buildPaths` each (`suites.js:684-689`).
- One signature relic each, pointing back (`data/index.js:213-221`, `suites.js:287-297`,
  `341`). `SIGNATURE_RELICS.length` must equal `CHARACTERS.length` = 36; `RELICS.length`
  must equal 36 + 5 = 41.
- Every relic hook name in `HOOK_NAMES` and actually implemented (`abilityCoverage.js:104-124`);
  `onInterval` relics must declare `params.interval` (126-133). Five of the eight are
  `onInterval` and all five declare it ✓.
- Every character sprite: 12–92% fill, >= 12 outline pixels, >= 5 colours, and pixel-unique
  (`pixelArt.js:41-89`).
- Every character has a `refs.js` entry (`suites.js:534-543`).
- No character id as a string literal outside `src/data/` and `src/game/abilities/`
  (`tests/run.js:59-77`).

---

# PART 4 — IMPLEMENTATION CHECKLIST

Exactly which files a builder touches to add **one** character, in order. Six data files,
one ability file, one hook file. Never gameplay code — `tests/run.js:43-120` greps for it.

1. **`src/data/characters.js`** — author the object. Copy the KARIN template
   (`1664-1726`), the newest post-launch character. All 11 required fields plus the 11
   `stats` keys `player.js:164-175` reads by name — a missing key silently becomes
   `undefined`. Add the JSDoc block above it in the house voice (KARIN's is at
   `1650-1663`). Then add the id to **three** places: `CHARACTERS` (1987-1997) inside its
   rarity block, `CHARACTERS_BY_ID` (2000-2029), `CHARACTERS_BY_RARITY` (2043-2049).
   `data/index.js:248-264` fails the boot if the last two disagree with the object's own
   `rarity`.

2. **`src/game/abilities/star10.js`** (new file) — `registerAll({ auto: { fire },
   special: { cast, tick?, end? }, escape: { cast, tick?, end? }, passive: { init?, tick?,
   onKill?, ... } })`. Follow `star3.js:61-212` for the allocation rule: **every** options
   bag, visual descriptor, targeting spec and callback is a module-level constant; nothing
   allocates inside `fire()` or `tick()`. Route all damage through `H.autoDamage` /
   `H.abilityDamage` and all radii through `H.area` so the mirror boss, minion mirroring
   and signature-weapon scaling work for free, and so `tests/weapons.js:337-382` passes.
   Use `runRng` (`core/rng.js`), never `Math.random()` or `Date.now()`.

3. **`src/game/abilities/index.js`** — add `import './star10.js';` to the content-module
   block at `52-63`. Order does not matter; the driver joins on ability id only.

4. **`src/data/relics.js`** — one signature relic. Copy the `SECRET_TECHNIQUE_109` shape
   (`71-88`). `owner` = the new character's id and the character's `signatureRelic` points
   back. `desc` must contain a digit (`suites.js:517`). Resolve the `resonance` block by
   hand against `RESONANCE_MULT` 1.5 and `RESONANCE_DIRECTION` (`50-60`) and write
   `resonanceDesc` off the **resolved** numbers, never off the base ones. Append to
   `RELICS` (743), `RELICS_BY_ID` (780), `SIGNATURE_RELICS` (820).

5. **`src/game/relicHooks.js`** — the `RELIC_IMPL` entry. `the_long_way_round` (272),
   `the_ninth_tail` (291) and `the_loose_cannon` (315) are the three newest models. Every
   declared hook must be in `HOOK_NAMES` (56-61) **and** be a real function.

6. **`src/data/refs.js`** — `REFS[id] = { ref, refSource, refNotes }`, placed in the
   correct rarity block. `refNotes` is the full art brief and step 7 is written line by
   line against it.

7. **`src/data/sprites.js`** — `CHARACTER_SPRITES[id]`, using only vocabulary the
   `pixelArt.js` switches already understand (`sprites.js:30-127`); anything else is
   silently ignored. No proper noun from `refs.js` may appear in this file. Do **not**
   author a portrait — `portraitFor()` (1078-1137) derives the HUD bust automatically. If
   the character declares an `altForm`, its descriptor goes in this same file keyed on its
   own `spriteId` (the `sovereign_alicia_dragon` precedent at 1044-1050).

8. **`src/data/gacha.js`** — per Part 3.3. Plus, always: append the new relic to the relic
   banner's `pool.relics` and bump `completesAt`.

9. **`src/data/shipNames.js`** — only if an ability or relic **name** fails the inclusion
   test at `33-38`. If nothing qualifies, write a comment block recording that the check
   was run — the Usaki block at `128-149` is the worked precedent for a deliberately empty
   entry.

10. **`node tests/run.js`** from the repo root. The gates most likely to fire, in order:
    `abilityCoverage` 32-42 → `pixelArt` 78-89 → `suites` 287-297 and 309-336 → `suites`
    664-682 → `tests/run.js` 59-101 and 142-156 → `abilityRuntime` 204-248 (the 4-minute
    empty-arena self-drain test, which fails below 25% of the HP pool — this is the one
    aoi's kit created, DECISIONS.md §52).

11. **Render it and look at it.** Build a PNG contact sheet with `buildBuffer` + `node:zlib`
    and put the new sprite next to every character it shares a hair style or weapon with,
    colour off. `tests/pixelArt.js:78-89` only catches *pixel-identical*; the standard
    `sprites.js:9-13` sets is "you can name them from the silhouette."

12. **`node sim.js --all --stage=1 --seeds=42,1337,7`.** Compare **rank order** against
    `BALANCE.md:62-89`, never absolute seconds — the table is a snapshot and goes stale.
    A ★6 sitting below a ★3 is a bug, not weak design (DECISIONS.md §52). Use three seeds:
    one seed swung the outlier count between 10 and 15 for identical code
    (`BALANCE.md:51-58`).

**For the full cohort**, do the eight characters one at a time through steps 1–10, then run
11 and 12 once at the end. Landing all eight and then debugging is how you get a
pixel-identity failure you cannot attribute.

---

# PART 5 — WHAT THIS COHORT COSTS OUTSIDE THE SIX-FILE LOOP

Everything below is a real cost. None of it is hidden in a kit description.

1. **`src/game/abilities/helpers.js` — re-export `applyPoison`.** It exists at
   `statusEffects.js:78` and ticks correctly at `171-174`, but `helpers.js:27-44` does not
   pass it through. One name in the import list and one in the export list, for `dokuga`.
   *(`applyChill` genuinely does not exist — only a `chillT` field at `statusEffects.js:16`
   — and nothing in this cohort needs it.)*

2. **`src/render/pixelArt.js` — one new headgear case, `hat: 'pointed'`.** For `bakuen`.
   The existing set is `tricorn | topHat | beret` and none of them is a witch's hat. This
   is precisely the precedent `sprites.js:85-127` documents; the addition is optional and
   off by default, so nothing already in the table changes shape.

3. **The balance harness has no burst metric, and you should not fake one.**
   `simHarness.js:236-238` treats `metric` as a **binary** — `'killsPerSecond'` or
   `dpsTotal`, nothing else. Worse, `simHarness.js:383` does
   `res.rows.find((r) => r.metric === 'killsPerSecond')`, a `.find` that returns only the
   **first** match and whose local variable is literally named `kira`; the warning text at
   `389-391` is Kira-specific prose that would be printed about whoever matched. And
   `rosterScene.js:1056-1059` prints *"their kit ignores enemy HP, so DPS lies"* for **any**
   character declaring the field — true of kira, false of `bakuen`.
   **Recommendation: do not declare `metric` on `bakuen` or `narukami`.** Read their RANK
   per DECISIONS.md §52 and accept that a burst character and a boss-hunter will sit oddly
   in a DPS table. If the owner wants a real second metric, that is a separate change
   touching `simHarness.js` (make it a lookup, not a `.find`) and `rosterScene.js` (make
   the copy a property of the metric, not a hardcoded sentence) — both files this cohort's
   builder does not otherwise open.

4. **`tests/suites.js:299-304` — the rival-pair test.** It is three hardcoded assertions
   (yamikage/uzu, sora/han). Adding a new rival pair does not *require* an edit, but
   `kuroba` and a future `yuno` would be the roster's third pair and the test should learn
   about them if that character is ever authored. Not a blocker for this cohort — noted so
   nobody "fixes" the test by accident.

5. **Stale count comments.** `characters.js:1`, `characters.js:1181`, `refs.js:36`,
   `sprites.js:7` and `relics.js:2` all state numbers that were already wrong before this
   cohort and would be wronger after. Worth fixing in the same pass, but they are prose,
   not behaviour — `abilityCoverage.js`'s stale test *names* ("all 76 pillars", "19
   characters") are decorative and their loops are generic; **do not "fix" those**.

---

# PART 6 — WHERE I READ THE TREE DIFFERENTLY FROM THE RECON

The recon is accurate on the roster, the schema, the gacha rules and the test gates. Seven
corrections, all of which changed a design decision above. Counts here were produced by
**executing the data modules**, not by reading comments:

```
CHARACTERS 28   rarity {3:2, 4:6, 5:12, 6:8}
elements {steel:6, spirit:5, lightning:5, light:4, water:3, fire:3, shadow:2}
visual.shape {capsule:27, circle:1}
RELICS 33  (SIGNATURE 28 + STAGE 5)   relic banner completesAt 33, pool.relics length 33
critChance {0.05:20, 0.06:2, 0.07:2, 0.08:2, 0.10:2}
attackSpeedMult {1.00:23, 1.05:3, 1.10:1, 1.15:1}   areaMult min 0.90 max 1.10
moveSpeed floor 168 (mochi, kira, brant)   ceiling 186 (captain_yuli)
```

1. **`mouseAim` is not unused.** The recon lists it with `lowestHp` and `highestHp` as
   "used by zero characters." reika's IRON SAND STORM resolves it at `star5a.js:57` and
   `598-599`. The accurate claim is narrower: no character declares it in the `targeting`
   field of `characters.js`. This is *good* news — it means the pad/touch fallback behind
   `run.aimAngle()` is already proven in a shipping ability, so `bakuen`'s auto costs
   nothing. (`lowestHp` and `highestHp` **are** genuinely unused; I grepped `src/` for both
   and for all four unused filters and confirmed zero hits.)

2. **`applyPoison` does not stack — it takes the MAX** (`statusEffects.js:79-80`, and the
   header at `63-65` explains why). There is no `poisonStacks` field. The recon flagged
   only the missing re-export. This is why `dokuga`'s ramp lives on a `resourceBar` on
   *him* rather than as stacks on the enemy: with max-wins semantics, an escalating
   application upgrades the target for free, and a naive stack design would need a new
   status field, a new applier and a new tick path.

3. **The ref-containment grep has a floor.** `tests/run.js:133-135` filters to refs of
   **6+ characters**, matched on word boundaries. `'Asta'` (4) is below it and would leak
   silently. Worth a comment in `refs.js`.

4. **`docs/` is not scanned at all.** `tests/run.js:21-32` walks `src/` and keeps only
   `.js`. That is why this document can safely carry the dev-only ref table — and why it
   must be deleted alongside `refs.js` in a ship build rather than relied on to stay clean.

5. **`visual.shape` is effectively fixed at `capsule` for characters** — 27 of 28, with
   `mochi`'s `circle` the single exception and the only non-`humanoid` body plan on the
   roster. Neither the recon nor the schema comment at `characters.js:47` says this; the
   comment lists a dozen legal shapes and reads as an invitation. An earlier draft of this
   document gave all eight proposals object shapes (`shard`, `ring`, `cross`, `star`,
   `crescent`, `triangle`, and `hedge`), which is legal — `spriteAtlas.js:1551` does
   `SHAPES[v.shape] || SHAPES.circle`, so nothing throws — and wrong: `hedge`
   (`spriteAtlas.js:503`) is the clipped-bush painter the courtyard obstacles use
   (`stages.js:873-913`), so the procedural fallback would have drawn a shrub where the
   player stands. All eight are now `capsule`. Written up as §1.7 because it is the kind of
   mistake that renders fine in a table and only fails when somebody turns the pixel atlas
   off.

6. **`hedge` is a real shape, and that is the trap.** It is in `SHAPES`, so a search for
   "is this legal?" answers yes. Legality is not the test here; the test is whether any
   character has ever used it, and the answer is that no character uses any of the twelve
   obstacle painters. Same class of error as writing `headband` for a `headdress`
   (`sprites.js:102-110`) — the vocabulary accepts it and the drawing is simply of the
   wrong thing.

7. **`gauntlets: true` is legal but is enemy idiom, not character idiom.** `pixelArt.js:400`
   is `slotRamp(v, fallback) => ramp(typeof v === 'string' ? v : fallback)`, so a boolean
   silently takes the `d.accent` fallback and draws. The only descriptor in the tree using
   the boolean form is the `chaser` enemy archetype (`sprites.js:1158`); every character
   passes a colour (`sprites.js:168`, `508`, `706`, `729`). `enshi` and `narukami` below
   keep `gauntlets: true` deliberately — both want the accent colour exactly — but a
   builder should know it is a fallback and not a mistake.

---

# PART 7 — HOLES I FOUND AND DELIBERATELY DID NOT FILL

Naming these is more useful than jamming a ninth and tenth character in.

- **`lowestHp` targeting.** A cleanup-executioner who only ever shoots the weakest thing.
  It is free — the mode is implemented at `targeting.js:115-128` — but Black Clover has no
  iconic attrition character (its cast is built around named duels), and every non-BC
  candidate I tried landed on shadow, which this cohort already takes to five. Worth a
  future slot; it should probably be light or water to keep the matrix flat.

- **The `revives` stat.** Vanessa's thread-of-fate is the obvious Black Clover fill and
  it is the most expensive thing in this document. DECISIONS.md §29 caps revives at 3 per
  run in a **fixed resolution order** (Undying → Second Chance → Shrine → Rei S3 → Phoenix
  Heart) that lives in `run.js`. A new revive is not a declared field; it is a deliberate
  insertion into an ordered list in gameplay code, and it changes two existing characters'
  behaviour. That is an owner decision, not a content one.

- **`lifesteal` as an identity.** Real stat, applied at `damage.js:170-173`, and shiro_same
  already lifesteals 5 HP an enemy inside her special. A whole kit built on it would want
  to be a predator that hunts the wounded — i.e. it wants `lowestHp` too, and the two
  should land on the same character rather than be split across two.

- **The `marked`, `large`, `elite` and `notBoss` filters.** `narukami`'s passive reads
  `isElite`/`isBoss` directly, and `kuroba`'s auto reads status fields, but no character in
  this cohort declares a filter in its `targeting` spec. They are one word each and a future
  character should spend one — a `large`-filtered auto in particular is a whole archetype
  (the character who only hits big things) that nothing occupies.

- **`applyChill`.** Does not exist; only a `chillT` field at `statusEffects.js:16`. A
  slow/freeze identity would need the applier written first. Nothing here needs it and
  `applySlow` covers the cases this cohort has.

- **Raising `BASE_RATES` back toward the spec's curve now that ★3 is four deep.** Named in
  Part 3.1 and deliberately left as a separate owner change.
