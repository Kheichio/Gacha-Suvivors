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

| Character | Survived | Δ median | DPS (all) | kills/s | Level | Read |
|---|---:|---:|---:|---:|---:|---|
| shiro_same | 849s | +36% | 331 | 10.20 | 47 | **VICTORY** |
| sovereign_alicia | 846s | +36% | 656 | 20.34 | 60 | **VICTORY** — ★6, expected |
| kira | 845s | +36% | 1168 | 39.19 | 85 | **VICTORY** — throughput arc |
| hikari | 845s | +36% | 1102 | 36.45 | 84 | **VICTORY** — free revive |
| kagura | 785s | +26% | 642 | 20.98 | 66 | was the worst outlier in the original table |
| hoshino_rei | 716s | +15% | 217 | 7.89 | 34 | |
| uzu | 715s | +15% | 561 | 20.93 | 52 | |
| nekromina | 683s | +10% | 304 | 11.09 | 39 | |
| han | 674s | +8% | 532 | 17.90 | 46 | was −45% before weapons |
| **unit_09** | **623s** | **median** | 465 | 16.32 | 36 | |
| reika | 619s | −1% | 257 | 10.32 | 34 | |
| yamikage | 492s | −21% | 99 | 4.44 | 18 | |
| niten | 434s | −30% | 61 | 3.23 | 13 | |
| rin | 402s | −36% | 40 | 2.54 | 10 | OUTLIER, barely |
| akane | 368s | −41% | 48 | 2.90 | 10 | OUTLIER |
| sora | 342s | −45% | 28 | 1.97 | 8 | OUTLIER — weak-early is his design |
| mochi | 312s | −50% | 21 | 1.65 | 7 | OUTLIER — ★3 starter |
| alto | 297s | −52% | 20 | 1.64 | 7 | OUTLIER — ★3 starter |
| captain_yuli | 269s | −57% | 13 | 1.09 | 6 | OUTLIER — melee-only, bot kites |

**Ten outliers, and — more importantly — the distribution is smooth.** Before
the weapon system it was eleven, on a harness that turned out to be measuring
noise (see the top of this file). At three weapon slots it was violently
bimodal: you either snowballed to a clear or died around minute five, with
nothing in between. Five slots filled the middle in — nine characters now land
between 400s and 790s, where that band used to be empty.

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
  the rarity system would mean nothing.
- **sovereign_alicia at the top.** ★6, 35s cooldown, an 8-second dragon form.
- **sora near the bottom.** His Rapid Fist scales +4% per upgrade taken this run,
  uncapped. SECTION 4 calls him "a late-run monster and an early-run wet noodle,
  which is exactly the arc". The bot only reached level 5; a human reaching level
  40 sees a completely different character.
- **kira at +129%.** SECTION 14 demanded a check that he is genuinely weak before
  minute 4 and monstrous later. He measures 5.99 kills/s early against 20.35
  late — a 3.4x acceleration. That arc IS the character and it is working.

**Probable bot artifacts — verify by hand before changing numbers:**

- **uzu, hikari at +146%.** Both are autonomous: a clone army and a free revive
  keep fighting while the bot does something stupid. Minion and revive characters
  always over-perform under a bot. Check whether a human at the same level sees
  the same gap before touching either.
- **captain_yuli at 6 DPS.** The spec says he has "the highest raw DPS in the
  game, but you must be in melee" with a 70px reach. The bot's whole movement
  policy is *flee the densest cluster*, which is the exact opposite of how he is
  played. Almost certainly the bot, not the character.
- **han at −45%.** SECTION 4: "he is the only character in the game who is
  REWARDED for being hit, which makes him play completely differently from
  everyone else — he wades in instead of kiting." The bot exclusively kites, so
  his rage meter barely fills and he never transforms. This is the single
  clearest case in the table of the harness measuring the wrong thing.

**Genuinely worth a look:**

- **kagura, −56%.** A ★4 dying faster than both ★3 starters is not explained by
  rarity or by the bot's policy. Her ofuda auto has a 0.8s detonation delay and
  her escape is a two-press placed gate the bot never uses correctly (it presses
  once, plants the torii, and never presses again — so she effectively has no
  escape move at all). Confirm by hand; if it is only the gate, the character is
  fine and the bot needs to learn the second press.
- **The overall spread is 6x DPS between adjacent rarities.** Tighten from the
  top down rather than buffing the bottom — the ★3s are supposed to be modest.

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
