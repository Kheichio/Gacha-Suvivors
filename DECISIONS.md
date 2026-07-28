# GACHA SURVIVORS — BUILD DECISIONS

Every self-contradiction found in `GACHA_SURVIVORS_PROMPT.txt` (catalogued in
`docs/BUILD_FEASIBILITY.json`) is resolved here. **This file wins over the prompt
where they disagree.** Each entry states the conflict, the ruling, and why.

Authority: the owner granted full decision-making authority for this build
(2026-07-27). Items previously flagged as "needs the human" are decided here and
marked **[OWNER-OVERRIDABLE]** — each is a one-file data change to reverse.

---

## 1. Economy — pull cost, not run rewards, was the wrong number

**Conflict.** Runs award 8–25💎 (line 1651). Target is one 10-pull per 3–4 runs
(line 949). `costTen: 1600` (line 1019). 3–4 runs yields 24–100💎 against 1,600 —
off by 20–60x.

**Ruling.** Keep every SECTION 5 award number exactly as written. Change the cost.

| Source | Award |
|---|---|
| Run completed | 8💎 |
| Run failed (died) | 4💎 |
| Mid-boss killed | 10💎 |
| Final boss killed | 20💎 |
| First clear of a stage | 50💎 |
| Daily first win | 30💎 |
| Achievements | 20–200💎 |

A completed 20-min run = 38💎. 3–4 runs ≈ 114–152💎.

```
costSingle: 15    costTen: 135    (10% bulk discount, standard genre convention)
```

**Why.** In a single-player game with no monetization the pull price is a pure
pacing dial with no external anchor; the reward numbers are load-bearing (they
appear in the balance targets and the results screen). Change the dial, not the
targets. SECTION 14's "8–25💎" now reads correctly as the *completion* award
before boss and first-clear bonuses — which is exactly what SECTION 5 describes.

---

## 2. Soft pity — made arithmetically exact

**Conflict.** +6%/pull from an 8% base starting at pull 51 reaches 80% at pull 62,
not "always" (line 974). It hits 100% at pull 67, leaving a dead zone before hard
pity at 70. SECTION 17 demands a unit test that pity "resolves exactly at the
documented pull counts" — impossible as written.

**Ruling.** Pin the ramp so it reaches certainty **exactly at the hard-pity pull**.
The dead zone disappears and both documented counts (51, 70) survive.

```
rate5plus(n) = base5plus + max(0, n - 50) * k5      base5plus = 0.16  (see §3)
k5 chosen so rate5plus(HARD_PITY_5) === 1.0

rate6(n)     = base6 + max(0, n - SOFT_6) * k6      base6 = 0.01
k6 chosen so rate6(90) === 1.0
```

`k` is **derived in code from the base rate and the pity pull**, never a magic
number — so re-tuning rates can never desynchronise the curve from the guarantee.
`src/data/gacha.js` exports the constants; `tests/pity.test.js` asserts:
resolution probability is exactly 1.0 at the hard-pity pull, strictly increasing
from the soft-pity pull, and no simulated sequence of 1,000,000 pulls ever
exceeds hard pity.

---

## 3. The thin ★3 pool — FIX B + FIX C **[OWNER-OVERRIDABLE]**

**Conflict.** Only two ★3 characters exist but ★3 is 60% of pulls (SECTION 18).

**Ruling.** Ship **FIX C** (mandated regardless) and take **FIX B**, not FIX A.

```
3★ 35%    4★ 48%    5★ 16%    6★ 1%
```

Retuned pity against the new curve (per SECTION 18's own instruction to retune):

```
5★+ soft pity from pull 25, hard pity 40
6★  soft pity from pull 55, hard pity 70   (rate-up banners only)
```

**Why not FIX A.** FIX A requires inventing two characters, which means choosing
two anime/VTuber refs the owner never approved, under a one-to-one rule the owner
curated deliberately across 19 slots. That is a content-authorship decision, not
an engineering one. FIX B is pure numbers, invents nothing, and the spec already
required retuning pity — which §2 does anyway.

Rates and pity live in `src/data/gacha.js` as named constants. Switching to FIX A
later = add two objects to `characters.js` + edit the pool arrays. Nothing else.

---

## 4. Counts: relics, evolutions, upgrade levels, enemies

| Thing | M6 says | SECTION 15 says | Actual lists | **Build** |
|---|---|---|---|---|
| Relics | 22 | 24 | 19 sig + 5 stage = 24 | **24** |
| Evolutions | 7 | 8 | 8 named | **8** |
| Upgrade levels | 22 × 8 = 176 | — | Extra Shot 4, Piercing Will 5, Second Chance 2 | **163** (per-upgrade `maxLevel`) |
| Enemy types | — | ~23 | 23 statted + 9 named-only + 3 split children | **35** |

M6's numbers are wrong in both cases.

---

## 5. The nine ghost mobs — authored in full

Named in stage tables with no stats anywhere: **Chalk Wraith, Gym Uniform Ghoul,
Neon Otaku, Crawler Husk, Rubble Golem, Ambusher, Lesser Oni, Anglerfish Fan,
Drowned Roadie.** All nine get full stats, behavior, visual, and ref notes.

Explicitly **not** conflated: `crawler_husk` ≠ `ceiling_crawler`; `lesser_oni` ≠
`oni_bruiser`. Different tiers, different behaviors, different stages.

Three split-children also authored: `tiny_slime` (Slime Kouhai), `blood_shard`
(Blood Doll), `mascot_splinter` (Mascot Prime).

The four orphaned enemies (Chibi Ghost, Slime Kouhai, Crow Familiar, Ronin Shade)
are added to stage mob tables so they are reachable content.

---

## 6. Two undefined behaviors + the archetype list

`ambusher` (Ceiling Crawler) and `static` (Trap Scroll) are used but missing from
SECTION 9's 13-entry list. Both are implemented; the archetype list is **15**:

```
chaser swarmer charger ranged exploder splitter orbiter summoner
shielder dasher tank healer leech ambusher static
```

---

## 7. Stage 7 has no mid-boss and no elite

SECTION 2 promises a boss at the halfway mark of every stage. Stage 7 (25 min) has
nothing at 12:30 and no named elite, against SECTION 9's "one per stage minimum".

**Ruling.** Author both:

- **Mid-boss — THE OPENING ACT**: three previous mid-bosses enter simultaneously
  at reduced HP. Thematically correct for a finale that recapitulates the game.
- **Elite — THE UNDERSTUDY**: a silhouette of the player's character at 60% power
  that mirrors the auto-attack only. Foreshadows the Final Form.

---

## 8. Standard banner's orphaned 6★ rate

Standard contains no 6-stars but the rate table allocates 1%. **Ruling:** on any
banner, rarity weights are normalised over the rarities actually present in that
banner's pool. Standard's 1% redistributes into ★5 → effective ★5 rate 17%.
Implemented as normalisation, not a hardcoded second table.

---

## 9. Relics unobtainable during M6

SECTION 6 says signature relics enter the in-run drop pool only once pulled — but
M6 (relics) precedes M7 (gacha), and all 8 evolutions require a specific relic.

**Ruling.** **All 24 relics are always in the in-run drop pool.** The Relic Banner
does not gate them; it grants a **permanent +3x drop weight** for that relic plus
an immediate guaranteed drop next run. M6 is testable, evolutions are reachable,
and the banner still means something.

---

## 10. Resonance has no formula

One worked example (Chum Bucket: 20s→12s cooldown = −40%, 250→375px = +50%).

**Ruling.** Resonance is **per-param, direction-aware, defaulting to 1.5x**:

```js
RESONANCE_DIRECTION = { interval:'down', cooldown:'down', chargeTime:'down',
                        threshold:'context', /* everything else */ default:'up' }
up:   v * 1.5        down: v / 1.5        (Chum Bucket: 20/1.5 = 13.3s)
```

Any relic may override with an explicit `resonance: {...}` param block —
Chum Bucket does (`interval: 12`) to match the spec's worked example verbatim.
All 24 `resonanceDesc` strings are authored, generated from the resolved params so
the text can never drift from the numbers.

---

## 11. Name collisions — canonical ids

| Canonical id | Canonical name | Aliases rejected |
|---|---|---|
| `ashes_of_the_eternal_encore` | Ashes of the Eternal Encore | "Ashes of the Encore" |
| `nichirin_blade_crimson` | Nichirin Blade (Crimson) | "Nichirin Blade Crimson" |
| `crown_of_the_world_eater` | Crown of the World-Eater | "Crown of World-Eater" |

`tests/data.test.js` asserts every evolution recipe references a relic id that
exists, so a dangling recipe cannot ship.

---

## 12. TOTAL CONCENTRATION evolution vs Rin's passive

Same name, same trigger, same effect as Rin's "Total Concentration Breathing".

**Ruling.** The evolution is renamed **SUNLIT EDGE**, and it **replaces** the
passive's charged bonus rather than stacking (`max`, not `+`). Rin gets the
evolution's 8x instead of his passive's 2.2x; everyone else gets it from nothing.

---

## 13. "Director" means three different things

**Ruling — fixed vocabulary, enforced by file names:**

| Name | What it is | File |
|---|---|---|
| **WaveDirector** | reads the spawn timeline | `game/waveDirector.js` |
| **AdaptiveDirector** | the pressure/difficulty system | `game/adaptiveDirector.js` |
| **The Stage Manager** | the unkillable sweeper | `data/bosses.js` |

SECTION 2's cross-reference points at the wrong one; it means the Stage Manager.

---

## 14. TTK and DPS targets

**TTK.** Line 1644 wants 3–4 hits on Tier-1 fodder at minute 15. `enemyHp` with
k=0.115 gives Mob Student 27 HP at min 15; Alto's 16-damage auto kills in 2. To
reach 3–4 you need k≈0.25–0.36, which would gut the "become overwhelmingly
powerful" fantasy that line 1254 calls load-bearing.

**Ruling.** Keep k=0.115. The revised TTK target is **1 hit at minute 0, 2–3 hits
at minute 15 before upgrades.** Stages carry a `hpMult` for per-stage tuning.

**DPS.** 8,000–15,000 at minute 15 is unreachable as single-target. **Ruling:
DPS is defined as total damage dealt to all enemies per second, cleave included.**
With 200+ enemies on screen and AoE builds that target is correct and reachable.
The harness reports `dpsTotal` and `dpsSingleTarget` separately so the definition
can never be quietly fudged.

---

## 15. Special cooldowns 12–35s

Sora 32s, Han 34s, Alicia 35s violate the stated 12–30s. The three outliers are
the three most powerful specials in the game and their cooldowns are correct.
**Ruling: the stated range is wrong — it is 12–35s.**

---

## 16. Targeting modes

Six declared modes don't exist in the 8-mode list. **Ruling:** the 8 base modes
plus four parameterised additions, all data-driven (`targeting: { mode, count,
filter }`) so no new mode is ever hardcoded per character:

```
nearest lowestHp highestHp randomInRange facing aroundSelf mouseAim densestCluster
+ nearestN (count)          Alicia's "nearest x3"
+ facingAuto                Rin's "facing (auto-turns to nearest)"
+ lineDensest               Reika's railgun line — spatial-hash line sweep
+ filter: 'unmarked'        Kagura, Kira
```

---

## 17. Aim on gamepad and touch

`mouseAim` and cursor-placed abilities have no cursor on a pad.

**Ruling.** A single `aimVector()` abstraction: mouse → cursor delta; gamepad →
right stick, falling back to left stick, falling back to auto-target; touch →
drag from the ability button, falling back to auto-target. Placed abilities
(Reika's vortex) default to the densest cluster within range when no aim input is
active. Auto-aim toggle in settings applies to all three.

**QTE.** The Colossus grab accepts *any* of: any ability key, gamepad face button,
or screen tap. Never a keyboard-only mash.

---

## 18. Stage geometry without a nav mesh

Stage 3 rubble "blocks enemy pathing"; Stage 5 walls slide and corridors form.
There is no pathfinding, tilemap, or collision module in the mandated tree, and
`chaser` is defined as "moves directly at the player".

**Ruling.** `game/obstacles.js` — static blockers (circles and AABBs) registered
in the spatial hash. Enemies apply **steering avoidance** (raycast ahead one
body-length, add a lateral push) on top of their normal behavior. The player is
hard-blocked. No A*, no nav mesh, no tilemap. Costs ~120 LOC and covers both
stages honestly. Documented as steering, not pathfinding — a chaser in a dead-end
pocket will hug the wall, which is acceptable and readable.

---

## 19. Arena bounds

4000×4000 "wraps softly", undefined.

**Ruling.** The arena is **bounded, not wrapping**. The player is clamped with a
120px soft push-back band and a visible boundary vignette. "Wraps softly" applies
to *enemies only*: an enemy more than 1.5 screens from the player is teleported to
a random point just off the opposite edge **of the view**, not the arena — which
is what line 194 actually describes and what makes the 4000×4000 arena feel
endless without a wrapping camera.

---

## 20. Density curve vs variable stage length

The curve is authored at absolute times (mid-boss 10:00, boss 19:05) but stages
run 15/20/22/25 minutes.

**Ruling.** Timelines are authored in **normalised time** (0.0–1.0) and scaled to
each stage's duration at load. Anchors are fixed by rule, not by clock:

```
mid-boss   at 0.50 * duration
calm       at duration - 60s   (5s of nothing)
final boss at duration - 55s
```

Each of the 7 stages gets a hand-authored timeline on top of the shared density
shape. ~280 wave events total.

---

## 21. Hard stop

**Ruling.** Victory = the final boss dies (the run ends immediately, per line 266).
"Stalling" = the final boss is alive at `duration + 180s`, at which point **The
Stage Manager** spawns. Surviving him 60s is the hidden achievement.

---

## 22. DEV_MODE, and the IP exposure the flag does not cover

SECTION 17's test greps "the built output" — there is no build step, and the flag
only ever covered *character* names. Ability and relic names ship verbatim from
source IP either way: Kamehameha, Kaio-ken, Amaterasu, Susanoo, Nichirin,
Niten Ichi-ryū, Level 5, Shinigami Eyes, Rasengan, Chidori.

**Ruling — three changes:**

1. **Every `ref`, `refSource`, and `refNotes` string in the entire project lives in
   one file: `src/data/refs.js`**, keyed by entity id. Nothing else contains a ref
   string. A ship build deletes that one file; `displayName()` no-ops cleanly when
   the table is absent. This is the grep test made actually possible —
   `tests/refs.test.js` asserts no ref string appears in any other source file.
2. **`displayName()` covers abilities and relics too**, not just characters — same
   helper, wider table.
3. Every ability and relic carries an optional **`shipName`**. `DEV_MODE=false`
   uses it where present. Pre-authored for the flagrant ones:
   Kamehameha → *Father-Son Beam*, Kaio-ken → *Crimson Multiplier*,
   Amaterasu → *Blackflame*, Susanoo Fragment → *Guardian Ribcage*,
   Nichirin Blade (Crimson) → *Sunsteel Edge (Crimson)*,
   Two Heavens As One → *Two Skies As One*, Level 5 Clearance → *Rank Five
   Clearance*, Shinigami Eyes → *Reaper's Sight*, Chidori → *Thousand Birds*,
   Rasengan → *Spiral Sphere*.

Not legal advice — a cheap mitigation done at authoring time instead of as a
pre-ship scramble.

---

## 23. Save migration is real, not a stub

SECTION 1 asks for a stub; SECTION 17 requires testing a schemaVersion bump.
**Ruling:** a real migration chain (`v1 → v2 → …`) with a registered migration per
step, plus a v1 fixture in `tests/save.test.js` that must load and upgrade
cleanly. Storage is a **pluggable backend** (localStorage → Node `fs` → IndexedDB)
so an Electron/Steam build is a 3-line swap rather than a retrofit.

---

## 24. Achievements that unlock already-unlocked things

**Ruling.** Make the gates real rather than deleting the rewards:

- **Curse** (Shrine) is genuinely locked until "Kill 10,000 enemies total".
- **Relic Banner** is genuinely locked until "Reach level 60 in one run".
- "Survive 60s against the Stage Manager" grants **200💎 + a costume tint**, not a
  20th character. A secret character with no data, no ref, and no rarity is not
  content — it is a bug with a reward attached.

---

## 25. Kamige difficulty vs the entity cap

"All mobs gain one elite affix" + Splitting (+4 mobs/5s) on a 2,000-mob screen is
an unbounded cascade against a hard 60 FPS requirement.

**Ruling.**
- Hard entity cap **2,500**. Above it all spawns are suppressed (waves queue,
  never drop silently — the debug overlay shows the queue depth).
- **Splitting** and **Volatile** are excluded from the Kamige blanket-affix roll;
  Kamige rolls from the seven non-cascading affixes.
- Splitting has a per-run global budget of 400 spawned children.

---

## 26. Elements are no longer dead data

Seven elements are declared and assigned but never used.

**Ruling.** A 20-LOC real system: **±15%**, shown in the codex and on the damage
number's tint.

```
fire > steel > lightning > water > fire        (ring, +15% / −15%)
shadow <-> light                               (mutual +15%)
spirit                                         (neutral both ways)
```

Enemies carry an element. Rin's "water, special converts to fire" is now literal.

---

## 27. Niten's Dokkōdō vs summons

**Ruling.** An entity counts as a minion only if it declares `isMinion: true`.
Clones, zombies, Deadbeats, foxfire wisps, and the Full Susanoo warrior do.
Decoys, rifts, chum piles, torii gates, and burning ground are **props**, not
minions. FULL SUSANOO is therefore genuinely anti-synergistic with Niten — that is
a real build tension, and his relic text says so out loud rather than hiding it.

---

## 28. Degenerate evolutions

- **ZERO COOLDOWN**: escape cooldown floors at **0.6s**, not 0. Preserves the
  fantasy, kills the infinite Kaio-ken buff loop. The card says "0.6s".
- Interaction with the S5 two-charge escape: charges regenerate on the floored
  cooldown, cap stays 2.
- Kagura's placed-gate escape and Niten's parry are exempted (their cooldowns are
  already mechanic-driven); the evolution gives them a flat −70% instead.

---

## 29. Revive stacking

Up to 6 revive sources with no stated cap.

**Ruling.** Hard cap **3 revives per run**. Resolution order (first available
wins, each consumed once):

```
Hikari's Undying → Second Chance → Shrine Revival → Rei S3 → Phoenix Heart
```

---

## 30. Encore Siren is two entities

One id, two definitions (tier-3 mob vs Stage 6 named elite).

**Ruling.** `encore_siren` (Tier-3 healer, heals 15/s in 250px) and
`elite_encore_siren` (named elite, heals + shields, interruptible by 300 damage in
2s). Different ids, different stats, both real.

---

## 31. Coral Crab's shield is now flankable

A shielder that always faces you cannot be flanked.

**Ruling.** Shielders have a **turn rate cap of 90°/s and a 0.4s facing lag**.
Circling faster than that genuinely gets you behind the shield. Applies to every
`shielder` and to The Armored mid-boss.

---

## 32. Endless leaderboard is local

"Leaderboard by time survived" against "zero external dependencies, offline".
**Ruling:** local-only personal bests, stored in the save blob. Labelled
"Personal Bests", not "Leaderboard".

---

## 33. Stage unlock schema takes an array

`unlock: { stage: 'x', cleared: true }` cannot express Stage 7's "clear 1–6".
**Ruling:** `unlock: { stages: ['a','b',...], cleared: true }`.

---

## 34. Hitstop, and determinism

Line 291 says 120ms and 60ms in one sentence.

**Ruling.** **60ms at 0.35× time scale**, player damage only, never on enemy death.

Determinism is preserved by making hitstop part of the **simulation**, not the
render: it scales how much time is fed into the fixed-step accumulator, driven by
a sim event, so a given seed replays identically. The headless harness runs the
same code path with `timeScale` forced to 1.0 and asserts the seed still
reproduces — hitstop changes wall-clock pacing, never sim outcomes.

---

## 35. Performance — the rule the spec never states

*(Carried in from the pre-M0 analysis; this is what makes 2,000 entities possible
at all.)* "Emoji + procedurally drawn shapes" read literally means `fillText('🧟')`
per entity per frame — among the most expensive Canvas 2D operations there is.
Naive implementation walls at 300–800 entities, and the F3 overlay reports 60 FPS
on an idle title screen, so the acceptance criterion gets marked PASS while being
false.

**Rulings:**

1. **`spriteAtlas.js` is mandatory at boot and the renderer's only source of
   pixels.** Every visual variant (shape × colour × size × outline), every emoji,
   and 32 rotation steps are rasterised to offscreen canvases at boot. The hot
   loop calls nothing but `drawImage`.
2. **Hard rule, enforced by review:** no `beginPath`, `fillText`, `shadowBlur`,
   `save()`/`restore()`, `filter`, or gradient construction inside the per-entity
   draw loop. Bitmap digit atlas for damage numbers. Coordinates rounded with
   `(x + 0.5) | 0`. Draws sorted by state. `getContext('2d', { alpha: false })`.
3. **`renderer.js` is a narrow immediate-mode API** — `beginFrame / setCamera /
   drawSprite / drawText / endFrame` — so a PixiJS backend later touches ~4 render
   files and zero gameplay files.
4. **Pinned perf target**: 1920×1080 at 100% scale, integrated-GPU class hardware
   (Intel Iris Xe / Apple M1 / Ryzen 5000U). `?perf=1` spawns 2,500 entities and
   asserts p95 frame time < 16.6ms, printing a PASS/FAIL line.
5. Budget at 2,000 entities: **<6ms sim, ~8ms render, 2ms slack.** The game is
   CPU/simulation-bound, not render-bound.

---

## 36. Architecture rule the acceptance criteria forgot to test

The spec says "adding a new character must require editing exactly ONE file"
(line 243) and also "one data object + up to 4 registry entries" (line 927).
Under pressure to ship 19 characters the failure mode is special-casing —
`if (char.id === 'kira')` in the damage pipeline, a rage-meter branch in the HUD
for Han. Nothing in SECTION 17 tests for it.

**Ruling.** `tests/architecture.test.js` greps every file outside `src/data/` and
`src/game/abilities/` for character-id string literals and fails the build if any
appear. Han's rage meter is a generic `resourceBar` declared in his data; Kira's
kills-per-second metric is a generic `metric` declaration. No exceptions.

---

## Deferred to the owner (not blocking, flagged honestly)

These need a human and cannot be self-certified:

1. **The M1 gate** — "is moving and killing things ALREADY satisfying?" No metric
   answers this. Reported as **UNVERIFIED**, never as PASS.
2. **Juice tuning** — every constant is exposed in `src/core/feel.js` with a
   dev slider panel bound to it (`F4`). Drag sliders, hit "copy values", paste.
3. **Zero-allocation verification** — needs a DevTools heap profile.
4. **Gamepad and touch on real hardware** — no synthetic gamepad exists headless.
5. **Photosensitivity** — one flash timer can be throttled in code; the composite
   of all simultaneous flashes needs frame capture and luminance analysis. Until
   that pass happens, `reduceFlashing` **defaults to ON** and the UI makes no
   epilepsy-safety claim.
6. **Final balance** — the harness finds outliers; the scripted bot never dodges a
   telegraph, so it dies to every boss and slanders every character. Use it for
   outliers, then hand-play what it flags.


---

## §37 — WEAPONS: the auto-attack becomes a build slot (post-launch, 2026-07-28)

**The problem.** Every character's auto-attack was a constant: one shape, one
damage number, one interval, from the first second of a run to the last. The 22
generic upgrades only ever nudged a stat, so a twenty-minute run's offensive
progression was "the same swing, 60% larger". Nothing about the screen at minute
eighteen looked different from minute two, which is the single thing this genre
is actually built on.

**Ruling.** Three weapons, and the auto-attack is one of them.

1. `src/data/weapons.js` declares eight pickable weapons, each with a
   hand-authored eight-level path where **every level changes something
   visible** — a wider arc, another projectile, a shorter interval — plus a
   max-level evolution that turns it from periodic into permanent.
2. The character's own auto-attack is **slot 0**, permanently. It starts at 70%
   damage / 85% rate / 85% area and climbs to 285% / 178% / 158%, then evolves
   into a continuous attack with a standing aura. It is still fired by
   `Run.update`'s auto path, not by the weapon system, which is what keeps every
   relic hook, the minion mirror and THE FINAL FORM's move-stealing working
   without a single change.
3. **Three slots, hard.** Without a cap the answer to every weapon offer is
   "yes" and every run converges on the same nine weapons.

**Why weapon levels are NOT stored in `player.upgrades`.** Nine other systems
walk that map — a character passive sums every value in it, the build-slot
counter, the HUD grid, the results screen, the "Maxed Out" achievement, the
codex. None of them would throw on an unknown id; they would each quietly report
something false. Weapons own their own list and the systems that should know are
told explicitly.

**Why weapon evolutions are NOT pushed into `player.evolutions`.** The results
screen prints `/8` as a literal and two achievements hard-code the same 8.
Moving that denominator silently is exactly the class of bug this document
exists to prevent.

**The level-1 nerf is calibrated, not guessed.** The first pass used 55% damage
x 72% rate. `node sim.js --char=alto --stage=1 --seed=42` went from 20.7 DPS /
level 6 / 491 kills to 12.9 / level 4 / 228 — the opening was so thin that the
player never earned the XP to reach the levels that fix it. A death spiral is
not a difficulty curve. 70% x 85% is a nerf you feel and can climb out of.

---

## §38 — Enemies read too small, and the fix is two numbers, not one

**The problem.** `def.visual.size` simultaneously set the hitbox radius, the
atlas raster size and the draw scale. So "make the enemies bigger" was
unavoidably also "make the game harder", and there was no way to separate the
readability complaint from the difficulty change.

**Ruling.** `feel.enemySizeMult` (1.14) scales the hitbox; `feel.enemyDrawScale`
(1.55) scales only what you see. Enemies read ~1.7x larger while their hitboxes
grow ~14%, which also means the sprite is slightly more generous than the
hitbox — the correct way round for a game about not being touched.

While fixing it: every broadphase hit query used a margin of 40px against an
exact test of `radius + e.radius`. Elites (x1.35), the `colossal` affix (x2) and
every boss already exceeded that, so **large enemies were silently un-hittable
by projectiles, area damage, cone damage and line damage** with no error
anywhere. The margin is now `CONFIG.HIT_QUERY_PAD`, sized off the largest radius
the game can produce.
---

## §39 — The balance harness was measuring noise (2026-07-28)

**The problem.** `node sim.js --char=alto --stage=1 --seed=42` returned 277.6s.
The same character, same stage, same seed, inside `node sim.js --all` returned
166s. Calling `simulate()` four times in one process for identical input
returned 277.6s, 250.9s, 306.6s and 228.8s.

Two pieces of module-level state outlived the run that set them, and both changed
how the next run PLAYED — not how it looked:

1. **The camera.** `zoom`, `targetZoom` and the punch timers persisted, and
   `enemy.js` derives its culling and off-screen radii from
   `camera.scale = baseZoom * zoom`. A run that ended mid-punch handed the next
   run a different view of the arena on tick zero.
2. **`nextUid`.** A module counter, and three enemy behaviours read `e.uid` as
   a SEED — the swarmer's wobble phase (`sin(aiT * 3.2 + e.uid)`) and the
   orbiter's and ambusher's rotation direction (`e.uid & 1`). Run 2's horde
   moved differently from run 1's on the same seed.

Neither threw, neither failed a test, and `tests/abilityRuntime.js`'s existing
"a seeded run is reproducible" passed throughout — because it replays two runs
back to back with scripted input, which happens not to disturb either.

**Ruling.** `Camera.reset()` is called at the top of `Run._init`, and the uid
counters moved from module scope onto each system instance. A new test asserts
that an INTERVENING run — a different character, stage, tier and seed — cannot
change a seeded replay. Every number in BALANCE.md predating this is void, and
the file says so at the top.