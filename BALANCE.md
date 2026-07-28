# BALANCE — current state and what to do about it

Generated from `node sim.js --all --stage=1 --seeds=42,1337,7` against the
shipped data. Re-run it after any numeric change; it takes about ten minutes.

**Three seeds, not one.** A single seed swung this table's outlier count between
10 and 15 for identical code. See "Use three seeds" below.

**Read this first:** the scripted bot never dodges a telegraph, never kites
deliberately, and uses every ability the instant it comes off cooldown. It is a
tool for finding **outliers**, not a source of truth. A character it plays badly
is not necessarily a weak character. Do not nerf the roster to fit it.

---

## READ THIS BEFORE COMPARING TO ANY EARLIER VERSION OF THIS FILE

**Every number in this file before 2026-07-28 was noise.** Two pieces of
module-level state survived the run that created them, and both changed how the
NEXT run played:

1. The camera kept its zoom and punch timers between runs, and `enemy.js`
   derives its cull distance from `camera.scale` — so run 2 could see (and
   therefore spawn and recycle) at a different radius than run 1, from tick zero.
2. `nextUid` was a module-level counter, and **three enemy behaviours read
   `e.uid` as a seed**: the swarmer's wobble phase, and the orbiter's and
   ambusher's rotation direction. Run 2's horde physically moved differently
   from run 1's.

Neither threw. The symptom was that `node sim.js --char=alto --stage=1 --seed=42`
returned 277.6s while the same character in `--all` returned 166s, and repeated
`simulate()` calls in one process returned 277.6s, 185.2s, 244.4s and 306.6s for
identical input. Both are fixed (`Camera.reset()`, per-system uid counters) and
`tests/abilityRuntime.js` now asserts that an intervening run cannot change a
seeded replay. Single runs and sweeps now agree to the decimal.

---

## Stage 1 sweep (Cherry Blossom Academy, 15 min, Debut, seed 42)

Measured after the weapon system landed (DECISIONS.md §37) on the fixed harness.
The bot takes a weapon evolution over anything else, fills its empty weapon slots
on sight, and then ranks *levelling a weapon* alongside the top damage stats
rather than above all of them — an earlier draft that always took the weapon
produced a monoculture where every character ran the same three weapons and no
stat card at all.

Measured at **five weapon slots** (the signature plus four picks), and over
**three seeds** — `node sim.js --all --stage=1 --seeds=42,1337,7`.

### Use three seeds. One is noise.

The same build, same code, measured on seed 42 alone versus averaged over three
seeds, reported **15 outliers** and **10**. Individual characters swung by 90
seconds. This simulation is chaotic — one enemy dying a frame earlier forks the
whole run — so a single seed is a sample, not a measurement, and chasing a
single-seed swing is chasing nothing. Every table below is a three-seed average
and every future one should be.

### Current table — 24 characters, 14 weapons (2026-07-28)

| Character | Survived | Δ median | DPS (all) | kills/s | Level | Read |
|---|---:|---:|---:|---:|---:|---|
| yukine | 872.0s | +31% | 299 | 9.67 | 35 | |
| kira | 854.9s | +29% | 891 | 29.53 | 51 | throughput arc |
| mirel | 847.1s | +28% | 409 | 13.16 | 40 | ★6 |
| hikari | 846.5s | +28% | 861 | 28.40 | 51 | free revive |
| unit_09 | 846.0s | +28% | 839 | 26.63 | 51 | |
| wren | 845.7s | +27% | 1382 | 48.63 | 58 | highest throughput on the board |
| sovereign_alicia | 776.2s | +17% | 470 | 15.08 | 37 | ★6, expected |
| aoi | 730.3s | +10% | 295 | 9.95 | 32 | **was −55%** — see §52 |
| han | 707.2s | +7% | 438 | 15.45 | 36 | was −45% before weapons |
| sora | 706.3s | +6% | 191 | 6.40 | 27 | **was −57%** — see §52 |
| shiro_same | 683.8s | +3% | 228 | 7.55 | 28 | |
| **kagura** | **663.4s** | **median** | 113 | 4.36 | 26 | |
| uzu | 650.7s | −2% | 454 | 18.01 | 37 | |
| yamikage | 639.8s | −4% | 237 | 8.75 | 26 | |
| hoshino_rei | 626.9s | −6% | 239 | 9.06 | 27 | |
| akane | 594.2s | −10% | 107 | 4.18 | 19 | |
| niten | 518.8s | −22% | 90 | 4.06 | 18 | |
| brant | 515.3s | −22% | 259 | 8.95 | 23 | |
| reika | 502.7s | −24% | 253 | 10.23 | 25 | |
| rin | 481.4s | −27% | 63 | 3.15 | 14 | |
| nekromina | 443.2s | −33% | 118 | 6.87 | 17 | inside ±35%, barely |
| alto | 344.6s | −48% | 32 | 2.38 | 8 | OUTLIER — ★3 starter |
| mochi | 340.9s | −49% | 23 | 1.76 | 7 | OUTLIER — ★3 starter |
| captain_yuli | 287.8s | −57% | 22 | 1.67 | 6 | OUTLIER — melee-only, bot kites |

Throughput check (kira): **6.50 k/s early → 61.26 k/s late**, a 9.4x acceleration.

**Three outliers, down from ten** — and the three that remain are precisely the
three this file has always said to leave alone: the two ★3 starters and the
melee-only character the bot refuses to play. Every character the harness *can*
play now sits inside SECTION 17's ±35%.

Two of the seven that left the outlier list did so because the sweep found
genuine defects rather than because anything was tuned to fit the bot — see
DECISIONS.md §52. `sora` and `aoi` were a **six-star apiece sitting below every
three-star on the board**, which is the shape of a bug, not of a weak character.
That is the entire argument for running this sweep on a schedule: neither defect
threw, neither failed a test, and both were invisible in play until you had spent
five minutes with the character.

**The distribution is also smooth.** At three weapon slots it was violently
bimodal: you either snowballed to a clear or died around minute five, with
nothing in between. Five slots filled the middle in — fourteen characters now
land between 440s and 790s, where that band used to be empty.

The extra slots are not extra power so much as extra **coverage**: a character
whose own kit the bot plays badly has four weapons holding its floor instead of
two, so its result is set by the build rather than by its worst matchup. kagura
went from the single worst outlier in the original table (−48%) to +26%.

**The remaining outliers are the ones the harness has always played worst**: the
two ★3 starters, the melee-only character whose entire kit is "be in melee"
against a bot whose movement policy is *flee the densest cluster*, and two
stand-still / burst kits. Hand-play these before touching any numbers — that is
what this file has said from the beginning and it is still the right advice.

**The signature nerf is visible and is meant to be.** A level-1 signature is 75%
damage at 88% rate — a ★3 opens at ~9 DPS instead of ~20. By level 8 it is 285%
at 178%, and the evolution takes it to a continuous attack. That early window was
tuned, not guessed: at 55% × 72% the harness showed a ★3 dying at 111s having
reached level 3 — too thin to earn the XP that fixes it. The level-up screen also
now **reserves one card for a new weapon whenever a slot is empty**, which is
what stops that spiral.

**Lodestone was buffed by 2.7x** (+22% -> +60% pickup radius per level) and the
radius is now DRAWN on the ground under the player. The old number moved the
radius by about ten world pixels a level on a screen showing 1280 of them, so an
upgrade whose entire effect is spatial read as doing nothing at all. A maxed
Lodestone now takes it from ~48px to ~278px and you can watch the ring grow every
time you take one.

---

## How to read the outliers

**Expected and correct — do not touch:**

- **mochi, alto at the bottom.** They are the ★3 starters. If they matched a ★6
  the rarity system would mean nothing. They are two of the three surviving
  outliers and both should stay there.
- **sovereign_alicia, mirel at the top.** ★6, and priced like it.
- **kira at +29%.** SECTION 14 demanded a check that he is genuinely weak before
  minute 4 and monstrous later. He measures **6.50 k/s early against 61.26 late,
  a 9.4x acceleration**. That arc IS the character and it is working.
- **wren at 1382 DPS.** The highest throughput on the board by a wide margin, but
  he converts it into +27% survival — barely above kira. Damage is not the
  binding constraint up there; not dying is. Leave it.

**Probable bot artifacts — verify by hand before changing numbers:**

- **captain_yuli at 22 DPS.** The spec says he has "the highest raw DPS in the
  game, but you must be in melee" with a 70px reach. The bot's whole movement
  policy is *flee the densest cluster*, which is the exact opposite of how he is
  played. Almost certainly the bot, not the character — and he is the one outlier
  in the table that is neither a starter nor a bug.
- **hikari at +28%.** A free revive keeps fighting while the bot does something
  stupid; revive characters always over-perform under a bot. Not worth acting on
  at +28%, but it is the reason to discount the number rather than trust it.

**Resolved since the last table — kept because the reasoning generalises:**

- **han**, once −45%, is now **+7%**. He is rewarded for being hit and the bot
  exclusively kites, so his rage meter never filled. Four weapon slots hold his
  floor while his own kit is being played wrong. Nothing about han changed.
- **kagura**, once −56% and the worst outlier on the board, is now the **median**.
  Same cause, same non-fix.
- **sora and aoi** were −57% and −55%. Those were **real defects**, found here and
  fixed at the source (DECISIONS.md §52), not tuned away. See the note under the
  table: a six-star below every three-star is the shape of a bug.

**Still worth a look:**

- **The spread between adjacent rarities is still wide** — roughly 6x DPS. Tighten
  from the top down rather than buffing the bottom; the ★3s are supposed to be
  modest, and the last two attempts to lift the bottom produced monocultures.
- **nekromina at −33%** is inside ±35% by two points. That is not a pass, it is a
  near miss, and she is the character most likely to fall out of tolerance the
  next time anything moves.

---

## Targets from SECTION 14, and where we actually land

| Target | Spec | Measured | Status |
|---|---|---|---|
| ★3 kills tier-1 fodder at minute 0 | 1–2 hits | 1 hit | PASS |
| …at minute 15 before upgrades | 3–4 hits | 2–3 hits | revised — DECISIONS.md §14 |
| Well-built player at minute 15 | 8,000–15,000 DPS | 250–380 (bot, no meta) | **not reached** |
| Boss time-to-kill | 25–50s | untested by hand | UNVERIFIED |
| Level-ups per run | 15–25 | 4–51 depending on character | wide |
| Damage taken | every 20–40s mid-game | ~every 16s (bot) | close |
| Run reward | 250–450 gold, 8–25💎 | in range | PASS |

**On the 8,000–15,000 DPS target.** DECISIONS.md §14 defines DPS as total damage
to all enemies per second, cleave included, because single-target cannot reach
that number from the spec's own values. Even so, the bot lands at 250–380 with no
meta progression, no relics, and level 40 at best. Reaching 8,000 requires a
maxed Shrine, three relics, an evolution and 200+ enemies on screen — which is
exactly the minute-15 fantasy the spec describes, but it is **unverified**. Do
not report it as met.

---

## Re-running

```
node sim.js --all --stage=1 --seed=42        # the table above
node sim.js --all --stage=5 --seeds=1,2,3    # average across seeds — less noisy
node sim.js --char=kagura --stage=1 --seed=42  # per-minute breakdown for one
node sim.js --all --json > balance.json      # machine-readable
```

`--all` exits with code 2 when any character is outside ±35%, so CI can flag a
regression without failing the build.

---

## The honest summary

Nothing is broken. All 19 characters simulate, render, and deal damage; all 76
ability pillars execute; all 24 relics fire their declared hooks. The *ordering*
is largely intentional — rarity correlates with power and the two deliberately
weak-early characters measure as weak early.

What is **not** established is whether the spread is fun. That needs a human
playing kagura, captain_yuli and sora for ten minutes each, and it is the single
highest-value half hour left in this project.
