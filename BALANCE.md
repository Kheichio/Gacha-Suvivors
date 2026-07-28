# BALANCE — current state and what to do about it

Generated from `node sim.js --all --stage=1 --seed=42` against the shipped data.
Re-run it after any numeric change; it takes about three minutes.

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

| Character | Survived | Δ median | DPS (all) | kills/s | Level | Read |
|---|---:|---:|---:|---:|---:|---|
| shiro_same | 849s | +44% | 239 | 7.61 | 45 | **VICTORY** |
| kira | 846s | +44% | 570 | 20.17 | 62 | **VICTORY** — throughput arc |
| hikari | 846s | +43% | 1136 | 37.39 | 84 | **VICTORY** — free revive |
| han | 845s | +43% | 1153 | 36.98 | 81 | **VICTORY** — was the worst character |
| hoshino_rei | 845s | +43% | 926 | 28.39 | 82 | **VICTORY** |
| uzu | 845s | +43% | 1378 | 46.99 | 91 | **VICTORY** — clones compound |
| unit_09 | 845s | +43% | 1463 | 46.64 | 83 | **VICTORY** |
| sovereign_alicia | 845s | +43% | 1092 | 34.44 | 75 | **VICTORY** — ★6, expected |
| yamikage | 627s | +6% | 128 | 5.42 | 20 | |
| **rin** | **590s** | **median** | 58 | 2.94 | 15 | |
| kagura | 531s | −10% | 78 | 3.63 | 27 | |
| nekromina | 383s | −35% | 87 | 6.24 | 12 | |
| sora | 350s | −41% | 23 | 1.76 | 7 | weak-early is his design |
| niten | 328s | −44% | 36 | 1.96 | 7 | |
| reika | 319s | −46% | 90 | 6.23 | 13 | |
| alto | 278s | −53% | 18 | 1.60 | 6 | ★3 starter |
| captain_yuli | 273s | −54% | 8 | 0.69 | 5 | melee-only, bot kites |
| akane | 262s | −56% | 22 | 1.99 | 8 | |
| mochi | 251s | −58% | 15 | 1.34 | 6 | ★3 starter |

**The distribution is now bimodal, and that is the weapon system working.**
Eight characters clear the stage; the rest die between 250s and 590s. Sixteen sit
outside SECTION 17's ±35% band — but that band is measured against a median that
has been dragged from ~345s to 590s by the clears, so the count is not comparable
to the pre-fix figure (which was, in any case, noise).

What the shape actually says: **surviving to roughly minute five is now the whole
game.** Get three weapons levelling and you snowball to a clear; die before they
come online and you land in the 250–350s band. That is the genre's arc, and it is
the one this game did not have before — but it does mean the early minutes carry
far more weight than they used to, and the bottom four (mochi, alto,
captain_yuli, akane) are the cases to hand-play first.

**The signature nerf is visible and is meant to be.** A level-1 signature is 75%
damage at 88% rate — a ★3 opens at ~9 DPS instead of ~20. By level 8 it is 285%
at 178%, and the evolution takes it to a continuous attack. That early window was
tuned, not guessed: at 55% × 72% the harness showed a ★3 dying at 111s having
reached level 3 — too thin to earn the XP that fixes it. The level-up screen also
now **reserves one card for a new weapon whenever a slot is empty**, which is
what stops that spiral.

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
