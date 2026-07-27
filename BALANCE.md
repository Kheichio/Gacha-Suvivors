# BALANCE — current state and what to do about it

Generated from `node sim.js --all --stage=1 --seed=42` against the shipped data.
Re-run it after any numeric change; it takes about three minutes.

**Read this first:** the scripted bot never dodges a telegraph, never kites
deliberately, and uses every ability the instant it comes off cooldown. It is a
tool for finding **outliers**, not a source of truth. A character it plays badly
is not necessarily a weak character. Do not nerf the roster to fit it.

---

## Stage 1 sweep (Cherry Blossom Academy, 15 min, Debut, seed 42)

| Character | Survived | Δ median | DPS (all) | kills/s | Level | Read |
|---|---:|---:|---:|---:|---:|---|
| hikari | 851s | +147% | 578 | 20.24 | 62 | **VICTORY** — free revive |
| uzu | 848s | +146% | 570 | 20.42 | 62 | **VICTORY** — clones compound |
| sovereign_alicia | 848s | +146% | 296 | 9.33 | 40 | **VICTORY** — ★6, expected |
| hoshino_rei | 600s | +74% | 85 | 4.70 | 21 | aura sustain |
| yamikage | 566s | +64% | 109 | 5.33 | 18 | Amaterasu never expires |
| kira | 565s | +64% | 300 | 14.70 | 34 | throughput arc working |
| unit_09 | 545s | +58% | 134 | 7.18 | 21 | |
| shiro_same | 478s | +39% | 56 | 3.07 | 16 | |
| sora | 372s | +8% | 23 | 1.70 | 10 | weak-early is his design |
| **rin** | **345s** | **median** | 24 | 1.90 | 7 | |
| reika | 320s | −7% | 92 | 6.37 | 14 | |
| nekromina | 312s | −10% | 69 | 5.41 | 15 | |
| akane | 280s | −19% | 23 | 1.93 | 6 | |
| niten | 263s | −24% | 21 | 1.79 | 5 | |
| captain_yuli | 236s | −31% | 6 | 0.57 | 4 | melee-only, bot kites |
| alto | 225s | −35% | 12 | 1.16 | 5 | ★3 starter |
| han | 188s | −45% | 40 | 3.80 | 7 | wants to be hit; bot flees |
| kagura | 180s | −48% | 15 | 1.50 | 8 | **look at this one** |
| mochi | 164s | −52% | 13 | 1.26 | 4 | ★3 starter |

SECTION 17 wants every character within ±35% of the median. Eleven are outside it.

**Three characters clear the stage outright** (hikari, uzu, sovereign_alicia
reach 848s on an 847s stage — that is a boss kill, not a timeout). A full uzu run
at S5 measures level 62, 16,651 kills, 452k damage, peak 4,730 DPS, and 197
damage taken — the "outnumbered at first, unstoppable by the end" arc landing
end to end.

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
