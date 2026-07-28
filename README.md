# GACHA SURVIVORS

An anime/VTuber roguelike bullet-heaven. Top-down, single-stick, auto-attacking;
15–25 minute runs against escalating waves; a gacha between runs that is a
progression toy, not a monetisation scheme.

HTML5 + Canvas 2D, vanilla ES modules, **zero runtime dependencies, no build
step, fully offline**.

---

## Run it

```
npx serve .          # then open http://localhost:3000
```

ES modules need an HTTP origin, so opening `index.html` straight off the
filesystem will fail with a CORS error. Any static server works; nothing is
installed and nothing is compiled.

### URL flags

| Flag | What it does |
|---|---|
| `?dev=0` | Ship mode — every `[ref]` name disappears from every surface |
| `?test=1` | Runs the unit tests in-page |
| `?perf=1` | Spawns 2,500 entities, measures 10s, prints PASS/FAIL on p95 frame time |
| `?sim=1&char=rin&stage=2&seed=42` | Headless balance run, printed to the console |
| `?scene=roster` | Boot straight into a scene |

### Keys

```
WASD / arrows   move            SPACE   escape move
E / RMB         special         ESC     pause
TAB (hold)      detailed stats  F3      debug overlay
F4              feel-tuning sliders (dev only)
```

Gamepad and touch are first-class: left stick moves, A/X escapes, B/Circle
specials; touch gets a virtual stick bottom-left and two ability buttons
bottom-right, laid out clear of the HUD.

---

## Commands

```
npm test              # 122 tests, including the ones SECTION 17 demands
node sim.js --all     # balance sweep across all 19 characters
node sim.js --char=kira --stage=5 --seed=42
node sim.js --all --json > balance.json
```

---

## Read these first

- **`DECISIONS.md`** — the ~40 self-contradictions in the original spec and how
  each was resolved. **It wins over the prompt wherever they disagree.** The
  economy was off by 20–60x, soft pity was arithmetically false, and the relic
  and evolution counts disagreed with themselves; all of that is settled there,
  with reasoning.
- `GACHA_SURVIVORS_PROMPT.txt` — the original design spec.
- `docs/ENGINE_DECISION.md` — why HTML5 + Canvas 2D over Godot, Unity, s&box.

---

## Layout

```
index.html              opens the game; no build step
sim.js                  headless balance harness (node)
src/
  main.js               bootstrap, fixed-timestep loop, scene manager
  core/                 config, rng, pool, spatialHash, math, events, timer,
                        input, audio, save, storage, feel
  render/               camera, renderer, spriteAtlas, particles,
                        damageNumbers, screenShake, debug, prewarm
  game/                 run, player, enemy, projectile, pickup, minion,
                        obstacles, hazards, waveDirector, adaptiveDirector,
                        boss, damage, statusEffects, targeting, relicHooks,
                        gachaEngine, achievements, weapons
    abilities/          the ability registry — 19 characters x 4 pillars,
                        plus weaponImpls.js (one entry per weapon `kind`)
  data/                 ALL content as plain data objects
  scenes/               hub, stageSelect, run, results, gacha, roster,
                        shrine, codex, achievements, settings
  ui/                   widgets, hud, levelUpScreen
  tools/                simHarness, perfTest
tests/                  harness + suites, runnable under node and in-browser
```

**All content lives in `/src/data`.** Gameplay code reads data; it never
hardcodes a character name, an enemy stat or a wave. `tests/run.js` greps for
character-id string literals outside the data layer and fails the build if any
appear — that test exists because "adding a character must require editing
exactly ONE file" is the easiest rule in the spec to break by accident.

---

## Weapons

You carry **five weapons, maximum**, and slot 0 is always your character's own
signature attack — it sits in the weapon row with everything else, it levels
like everything else, and it evolves like everything else.

That signature starts **nerfed** — 75% damage, 88% swing rate, 85% size — and is
levelled on the level-up screen like anything else. By level 8 it is 285% damage
at 178% rate with two extra projectiles and two pierce; at max it can **evolve**
into a continuous form that fires without pause and leaves a standing aura.

The other four slots are filled from eight pickable weapons, each with its own
hand-authored eight-level path and its own evolution — so you leave half the
arsenal on the table every run:

| Weapon | What it does | Evolves into |
|---|---|---|
| Blade Arc ⚔ | a sword slash in front of you | ENDLESS EDGE — a 360° blade that never stops |
| Idol Orbit ✦ | shards circling you | CONSTELLATION — twelve, on two counter-rotating rings |
| Kunai Fan 🗡 | piercing knives at the nearest enemy | THOUSAND EDGES — ten rays, ten times a second |
| Storm Ring ⚡ | a shock detonating around you | PERMASTORM — the storm simply stays |
| Spirit Bell 🔔 | rings that damage and slow | STANDING RESONANCE — a permanent holding field |
| Wisp Flock 🔥 | foxfire that hunts on its own | WILDFIRE — the flock never thins |
| Chain Lash 〰 | long lashes with the best reach in the game | ENDLESS LASH — six chains, no pause |
| Meteor Call ☄ | shells onto the thickest part of the crowd | STARFALL — continuous, and it leaves burning ground |

**Every single level changes something you can see.** No weapon level is "+8%
damage" — it is another projectile, a wider arc, a second slash, a shorter
interval. `tests/weapons.js` asserts that: a level that changes nothing
measurable fails the build.

**Weapon cards and passive cards do not look alike.** A weapon card is wider,
squared off, carries a solid type ribbon and a coloured rail, puts its icon in a
framed plate, and shows a before → after stat table. A passive card is narrower,
rounded, has no ribbon, sits its icon inline beside the name, and is built around
one large number. You should never have to read a card to know which kind it is.

Weapon levels live in their own list, not in `player.upgrades`, and weapon
evolutions are not pushed into `player.evolutions`. Both are deliberate —
DECISIONS.md §37 has the reasoning.

---

## The three architectural decisions that matter

**1. `spriteAtlas.js` is the renderer's only source of pixels.**
Every shape variant, every emoji and 32 rotation steps are rasterised to
offscreen canvases at boot; the per-entity draw loop calls nothing but
`drawImage`. Read literally, "emoji + procedurally drawn shapes" means
`fillText('🧟')` per entity per frame, which walls at 300–800 entities against a
2,000-entity target — and the F3 overlay reports 60 FPS on an idle title screen,
so the acceptance criterion gets marked PASS while being false. Inside the draw
loop there is no `beginPath`, no `fillText`, no `shadowBlur`, no `save()`, no
gradient construction. `tests/run.js` enforces it.

**2. `damage.js` is the single choke point for all damage.**
Auto-attacks, specials, DoTs, contact, thorns, hazards, boss attacks, executes —
everything. That is what makes crit, lifesteal, element bonuses, armour, dodge,
hit flash, knockback, damage numbers and every relic hook work uniformly instead
of being reimplemented and forgotten in twenty call sites.

**3. Abilities are a registry of pure functions keyed by id.**
Gameplay code never branches on a character id. Adding character #20 is one data
object plus up to four registry entries. Han's rage meter is a generic
`resourceBar` declared in his data; Kira's kills-per-second read-out is a generic
`metric`. Neither has a line of code that knows who they are.

---

## Determinism

The simulation is a fixed 60Hz accumulator; rendering is decoupled and
interpolated. The sim never reads wall-clock time, so a seed reproduces a run
identically at 30 FPS, at 144 FPS, and at 100x under `node sim.js`. Hitstop
consumes real time without feeding the accumulator, which is why it can exist at
all without breaking replay.

Two RNG streams: `run` (seeded per run) and `meta` (gacha only, seeded from a
persisted counter). The meta stream's seed and call count are written to disk
**before** any pull result is shown, so reloading the page replays the same
stream and cannot re-roll a pull.

---

## What is verified, and what is not

`npm test` covers the four things SECTION 17 asks for explicitly — pity resolves
exactly at the documented pull counts, the one-to-one rule holds, save survives a
schemaVersion bump, no ref string is reachable outside `refs.js` — plus the
architecture rule the spec forgot to test.

Beyond static checks, it **executes** the content rather than grepping it. Every
character is simulated and rendered; every special is cast and driven through its
full tick and end; every escape is fired and checked for real i-frames; every
passive runs 90 simulated seconds; every relic is equipped on its own owner (so
the resonance branch runs) for 60s; every evolution is granted and run. All of it
at **star level 5**, because at star 1 roughly a third of the ability code — the
S3 and S5 branches — never executes at all. A seeded run is also replayed twice
and asserted identical, which is what makes the balance harness meaningful.

**Not verified, and not claimed:**

1. **Whether it feels good.** No metric answers "is moving and killing things
   already satisfying?". Every constant is exposed in `src/core/feel.js` with a
   live slider panel on `F4`; drag, hit COPY, paste over the defaults.
2. **Zero allocations in the update loop.** Pooling is honoured throughout and
   the hot paths are written allocation-free, but confirming it needs a DevTools
   heap profile.
3. **Gamepad and touch on real hardware.** No synthetic gamepad exists headless.
4. **Photosensitivity.** One flash timer is throttled and the composite is
   rate-limited to 3Hz, but the *composite* of all simultaneous flashes needs
   frame capture and luminance analysis. Until that pass happens
   `reduceFlashing` **defaults to ON** and the UI makes no epilepsy-safety claim.
5. **Final balance.** `node sim.js --all` finds outliers. Its bot never dodges a
   telegraph, so it dies to every boss and slanders every character equally —
   use it to find the character 3x off the median, then hand-play that one.

---

## Shipping

`?dev=0` strips every ref name. To harden it, delete `src/data/refs.js`
outright: `data/index.js` imports it inside a try/catch, `displayName()` degrades
to the plain name, and `shipNames.js` — a separate file that deliberately
survives the deletion — swaps the ability and relic names that are verbatim
source IP for original ones. Nothing else changes.
