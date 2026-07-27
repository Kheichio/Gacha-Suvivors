# Verdict: Keep the spec's stack. Build it in HTML5 + Canvas 2D + vanilla ES modules.

**Primary recommendation: HTML5 / Canvas 2D / vanilla ES modules — exactly what your spec already mandates. Do not override it.**

**Runner-up: Godot 4.6 (statically-typed GDScript).**

**The condition under which Godot wins instead:** if you decide *before writing a line of code* that this game's real business is a paid Steam release with a console/mobile follow-on, and that the browser build is marketing only. In that world Godot is better, and switching costs ~90 lines of spec edits today versus a full rewrite in six months. Two of the four biggest games in this exact genre — Brotato (10M+ copies) and Halls of Torment (which shipped Windows/Linux/Android/iOS/PS5/Xbox) — are Godot games. That is a real argument. But it is a *different plan* than the one you wrote, and it should be an explicit decision, not a drift.

**s&box is a hard no.** Details below, in concrete terms.

---

## 1. s&box: why the premise is backwards

You proposed s&box for "easy publishing." That is the single thing s&box is worst at for this project.

**The platform is nearly empty and paywalled.** s&box shipped 28 Apr 2026 at $19.99. All-time concurrent peak: 6,762 on release day. Today (25 Jul 2026): **~695 concurrent players across the entire platform**, every game combined. Monthly average went 4,106 (April) → 748 (June), a 59.5% one-month collapse, ~90% off peak. Publishing there is publishing to an empty room behind a $20 door.

**The Steam export you'd actually want does not exist yet for you.** Facepunch signed the Valve license in late March 2026, but the docs (last updated ~26 Apr 2026, unchanged through July) still say distribution requires Valve approval, that it's being piloted with a handful of hand-picked developers (My Summer Cottage first), and that you must not distribute exported builds without a license — email `standalone@facepunch.com`. Garry's own framing: *"We still have work to do on our end. We need to create a license between Facepunch and the people shipping games, then double and triple check everything is legit."* You would be betting a multi-month solo project on a discretionary approval queue with no published SLA.

**It breaks your spec at the acceptance-criteria level, not the preference level:**

| Spec requirement | s&box |
|---|---|
| Opens from `index.html`, no build step, no network requests | Impossible — no web/WASM target at all |
| `?sim=1&char=rin&stage=2&seed=42` harness | Rewrite as CLI; on-platform builds also lose `System.IO` to the API whitelist |
| Keyboard, mouse, gamepad, **and touch** all fully playable | Touch is impossible — no mobile target |
| 60 FPS on a mid-range laptop | **Intel integrated graphics are explicitly unsupported.** A huge share of mid-range laptops simply will not launch the game |
| Save survives a browser restart | N/A |
| Emoji + procedural shapes as free placeholder art | No world-space emoji draw exists. You must build and bake an emoji atlas **before M1** — the exact work your spec deliberately deferred, now blocking your fun-check gate |

**It also inverts your delivery plan.** Your whole strategy is "solo dev + AI coding agent." Vanilla JS + Canvas 2D is arguably the best-represented target in any coding model's training data. s&box is among the worst: models' training predates the Nov 2025 open-sourcing, s&box C# is not Unity C# (component lifecycle, scene system, networking all differ), it runs a restricted .NET subset so agents confidently emit blocked APIs like `System.IO.File`, and the total public corpus is a fraction of any established engine. Worse, the *only* architecture that hits 2,000 entities in Source 2 is a custom instanced-quad render object (`SceneCustomObject` / `Graphics` + `RenderAttributes`) — the single least-documented corner of the engine. Your agent will default to one GameObject per entity, which does not scale, and you'd be hand-holding it through the hardest, least-exampled path in the engine.

**Two more, briefly.** There's no direct sales channel on-platform — only The Play Fund, which the EULA says creators have *"no right to compensation"* from and which Facepunch operates *"at its sole and absolute discretion."* And the standalone license reportedly requires Steam presence if you're on any storefront at all, which kills an itch.io-first release. (I'd flag that last one as *likely, not verified* — it comes from a docs summary plus a community guide, not a primary license text I read directly.)

The one honest point in s&box's favor: C# with real value types and `Span<T>` genuinely is a better language for a 2,000-entity zero-allocation loop than JavaScript. That advantage is real, and it is available to you from Godot (C#) or Unity without any of the above.

---

## 2. Unity and Unreal, briefly

**Unity is the correct answer *if* you were overriding the spec and didn't like Godot.** It's genre-proven at exactly this scale by solo devs: Vampire Survivors moved *to* Unity at v1.6, 20 Minutes Till Dawn shipped Steam + mobile + Switch, Megabonk (solo dev) sold 1M copies in two weeks. DOTS/ECS is **not required** at 2,000 entities — VS and Soulstone Survivors both reportedly use plain GameObjects plus aggressive pooling. Assets are YAML text, so an agent can read and write scenes and prefabs. Licensing is benign now: Runtime Fee cancelled, Personal free to $200k, no royalty ever. It's a legitimate choice. It costs a full JS→C# port, ~5-15% of the work lands in a GUI your agent can't drive from text, and Unity Web builds have an ~8MB floor with slow loads — you lose the instant-play property entirely.

**Unreal is close to disqualified for this spec.** No web export exists (Epic deleted HTML5 in 4.24; UE5 never had one; Pixel Streaming is rented GPU-hours, not a build). Paper2D has been unmaintained-in-practice for the better part of a decade — the actual 2D animation stack everyone uses is PaperZD, a paid third-party Fab plugin by one person. Every asset is a binary `.uasset` your agent cannot read, write, or diff. 2,000 `AActor`s with `PaperSpriteComponent`s don't batch, so you'd write your own 2D renderer inside a 3D engine — the exact work Canvas 2D already does — in C++, with minutes-long rebuilds, for a 300MB+ empty-project floor.

---

## 3. Why the spec's own stack wins

**The genre precedent is exact, not analogous.** Vampire Survivors *was* an HTML5 game — Phaser 3, free in the browser on itch.io from March 2021, then Steam via an Electron wrapper from December 2021. It hit 1.0 and sold **1M+ copies while still running the JavaScript build.** The Unity port came after commercial success, explicitly to unlock console SKUs. This stack is proven all the way through "sold a million copies."

**Port cost is zero.** Every hard requirement in your spec maps to plain JS in tens-to-low-hundreds of lines: fixed-timestep accumulator (~40 LOC), mulberry32 dual-stream RNG (~20), object pool (~60), spatial hash (~80), localStorage + schemaVersion migration (~100). In every other engine you'd re-implement or work *around* each of these.

**The headless 100x harness is nearly free, and this is the strongest single argument.** If your sim layer never imports the renderer, the identical ES modules run under `node sim.js` in CI and under `?sim=1&char=rin&stage=2&seed=42` in the browser. No headless licence, no CI GPU, no fake display server, no separate build target. That closes your AI agent's feedback loop completely: change a number, sweep 19 characters × 7 stages, read stdout, iterate — with no human opening an editor. Godot needs `--headless --disable-render-loop`; Unity needs a `-batchmode -nographics` build. Both work; neither is *free*.

**Iteration speed for solo-dev-plus-agent is the best available.** Every file is plain text the agent can read, grep, diff, and regenerate. No binary scenes, no `.meta` files, no import pipeline, no compile step, no editor state that exists only in a GUI. Edit → Ctrl+R → running, sub-second.

### The one thing that will kill it if you get it wrong

**2,000 entities at 60 FPS is achievable in Canvas 2D — but the literal reading of your own spec misses it by 3-5x.**

"Emoji + procedurally drawn shapes" read naively means `beginPath/arc/fill/stroke` plus `fillText('🧟')` per entity per frame. Color-emoji `fillText` is among the most expensive Canvas 2D operations that exists — glyph shaping plus a large color-bitmap raster — and one benchmark found a 16-core 2022 desktop struggling with a couple thousand strings per frame. Naive implementation walls at roughly **300-800 entities**.

The fix costs nothing on day one and is a painful whole-render-layer retrofit later. **Rewrite `spriteAtlas.js` from "future real-art module" into "the renderer's only source of pixels."** At boot, rasterize every distinct `visual` variant (shape × color × size × outline), every emoji, and 16-32 rotation steps into offscreen canvases. The hot loop then calls nothing but `drawImage`. ~150 LOC. Add a hard rule beside your existing performance rules:

> **No `beginPath`, no `fillText`, no `shadowBlur`, no `save()`/`restore()` inside the per-entity draw loop.**

Plus: bitmap digit atlas for damage numbers (removes text from the hot path entirely, makes the 60-number cap trivially cheap); round coordinates with `(x + 0.5) | 0` before `drawImage` (faster *and* sharper — sub-pixel coords force interpolation); sort draws by state so additive particles are one contiguous block with a single `globalCompositeOperation` set/reset; skip dirty rects entirely (a scrolling camera redraws the whole screen anyway); consider `getContext('2d', { alpha: false })`.

Disciplined, 5,000-15,000 `drawImage` calls/frame is realistic on 2020+ integrated graphics. 2,000 entities plus 800 particles plus 60 damage numbers sits comfortably inside with headroom. Anchor points: a 2011-era Intel HD3000 managed 1,100 Canvas 2D sprites at 60 FPS; a Ryzen 5 4500U laptop ran 10,000 sprites at 47 FPS through Pixi in 2023, so that machine's raw throughput is an order of magnitude past what you need.

*(Flagging as uncertain: the dossier cites Kontra — a Canvas 2D micro-engine — hitting 60 FPS at 10,000 sprites on that same laptop. The researcher could not verify Kontra is Canvas-2D-only, and its benchmark entry used fixed-timestep animation which flatters the number. Treat it as suggestive, not as a measured Canvas 2D ceiling.)*

At 2,000 entities you are **CPU/simulation-bound, not render-bound** — the frame is dominated by spatial hash rebuild, broadphase queries, status effects, steering, and damage resolution. Budget under 6ms for sim, ~8ms for render, 2ms slack.

Also: **pin the perf target.** "Mid-range laptop" is undefined in your spec, and Intel UHD 620 vs Iris Xe is roughly a 2x swing from the GPU alone. Name a reference machine and resolution, and add a `?perf=1` flag that spawns 2,500 entities and asserts p95 frame time under 16.6ms.

---

## 4. "Easy publishing" — separating three different things

Your instinct conflated three distinct problems. They have different answers.

### Easy to *upload*
**Canvas 2D wins outright and it isn't close.** Zip the folder with `index.html` at root, upload to itch.io, tick "play in browser," set viewport, publish. Live in 60 seconds. The upload artifact *is* the source tree. Godot's floor is ~35MB of compressed WASM (~25MB stripped) for an *empty* project. Unity Web is ~8MB minimum with a build step. s&box: not possible.

### Easy to be *found*
**Nobody's engine solves this, and that's the honest answer.** But Canvas 2D gives you more shots on goal:
- **itch.io browser build** — free, instant, zero-install. This is literally where Vampire Survivors built its audience for nine months before Steam.
- **Newgrounds** — HTML5 zips, medals/scoreboards API, and the anime/VTuber aesthetic lands well with that audience.
- **CrazyGames (~35M MAU) / Poki (60M+ MAU)** — real reach, but a structural caveat for *this* game: portal economics assume short, stateless sessions. A 20-minute roguelite whose entire hook is persistent gacha meta-progression in localStorage is a bad fit — iframe and third-party-storage rules make saves fragile, and a player who loses their roster churns permanently. Treat portals as top-of-funnel driving Steam wishlists, not as a revenue line.

s&box's discovery is actively hostile here: it launched to "Mixed" (~44%) Steam reviews with the front page overrun by AI-generated content, and Garry publicly committed to pushing "obviously AI-created slop off the main page." An AI-agent-built game whose shipping art is emoji and procedural shapes gets pattern-matched as exactly that, regardless of how good the underlying simulation is.

### Easy to eventually *sell*
**Steam, via Electron. Well-trodden.**
- **Wrapper: Electron.** Not a close call. Electron and NW.js are the only desktop frameworks officially supported by the Steamworks binding libraries; the overlay works; Chromium's own compositor gives predictable graphics across machines. **Tauri is the wrong choice here** despite its appeal — OS-native webviews (WebKitGTK/WKWebView) sacrifice graphics performance, it has documented Steam-overlay breakage, and neither binding officially supports it. The 100MB+ bundle is a non-issue; nobody refunds an indie roguelite over download size.
- **Binding: `steamworks.js`** (actively maintained) over `greenworks` (production-proven — it shipped Game Dev Tycoon — but the original repo has been dormant ~8 years; only a community fork lives).
- **Precedents:** Vampire Survivors (Electron, 1M+ copies), Game Dev Tycoon (NW.js), Athena Crisis (Electron, macOS Steam).
- **Cost:** $100 recoupable Steam Direct fee. *(Flagging as unverified in this dossier — treated as general knowledge, not confirmed this session.)*

**One gotcha worth building for now:** Steam Auto-Cloud syncs *files*. Your localStorage lives inside Chromium's LevelDB in the Electron user-data dir, which is not a clean thing to sync. Under Electron, write the save JSON to a real file via Node `fs` into `app.getPath('userData')` and point Auto-Cloud at that; keep the browser build on localStorage. That means **`save.js` needs a pluggable storage backend from day one** — ~30 LOC now, genuinely annoying to retrofit. It also gives you the iOS escape route: Safari's ITP can evict localStorage after ~7 days of non-use, which for a gacha game means silent, total loss of the meta-layer. Add IndexedDB plus a copy-pasteable export/import save code.

---

## 5. The escape hatch, and how much your spec already buys you

Your spec is already shaped correctly for this, which is the quiet reason to trust it.

**Gameplay code never touches a canvas context.** Entities carry a declarative `visual: { shape, color, outline, size, emoji?, sheet?, frames? }` object. (Note the `ctx` in `AbilityRegistry` is a *game* context, not a `CanvasRenderingContext2D` — that naming will confuse your agent at some point; consider renaming it.) That is already the right seam.

**Tier 1 — swap to PixiJS/WebGL. Cheap, and the door is already open.** Rewrite `renderer.js`, `spriteAtlas.js`, `particles.js`, `damageNumbers.js` — roughly 4 files, ~800-1500 LOC — plus retained-mode Sprite pooling in `pool.js` (Pixi is retained-mode, so the pool layer is a real refactor, not a one-liner). **Zero gameplay files change.** ~10-15% of the codebase, 0% of gameplay/data.

Two things to do *now* so this stays cheap:
1. Keep `renderer.js` a narrow **immediate-mode** API: `beginFrame / setCamera / drawSprite(atlasId, x, y, rot, scale, alpha, tint) / drawText / endFrame`. Any future Pixi backend maintains the retained scene graph internally.
2. Make `spriteAtlas.js` mandatory-at-boot as described above. This makes the real-art drop-in a genuine no-op later.

**Buy Pixi when the art direction demands it, not when the entity count does.** At 2,000 entities you're CPU-bound, so WebGL barely raises your ceiling. What it actually buys is *capability*: free per-sprite tint (19 character palettes without pre-baking every variant), additive glow and blend modes without state-flush cost, full-screen shader filters for boss phases and hitstop, cheap rotation/scale. If your art escalates toward "loud, screen-filling," Pixi stops being optional. Pixi v8 does 200k sprites at 60fps and 1M particles via `ParticleContainer` — two orders of magnitude past your requirement. Caveat: it softly breaks "zero dependencies / no build step" — you can vendor it as an ES module and keep no-build, but it's a real ~400KB dependency.

**Tier 2 — Steam.** Electron wrapper. Days, not months. Covered above.

**Tier 3 — console. This is a rewrite, and there is no way around it.** There is no certified third-party JavaScript/Chromium runtime shipping on Switch, PS5, or Xbox for indies. If the game succeeds, console means a Unity or Godot re-implementation — **exactly what Poncle did with Vampire Survivors** — or a porting house. Your renderer abstraction does *not* save you here; the whole thing is a different language.

But price that correctly: it is a **success problem**, and it's the same wall VS hit *after* selling a million copies on the JS build. Your engine-agnostic architecture is what makes it survivable — the fixed-timestep accumulator, pooling, spatial hash, dual-stream RNG, the gacha pity state machine, and the entire `/src/data` registry all transliterate line-for-line into C#. Roughly 75-85% of the spec survives a Unity port as *design*; ~90% survives a Godot port. What gets rewritten is the render layer, and you'd be rewriting that anyway for real art.

**If you want to pre-pay that insurance, pick Godot now instead of later** — that's the runner-up condition. Just know what you're buying: to hit 2,000 entities in Godot you must *not* use Nodes (no `Node2D`, `CharacterBody2D`, or `Area2D` per entity — the tutorial approach walls somewhere around 50-200 enemies), which means the editor can't visualize your entities, the scene-tree debugger shows nothing, and most Godot tutorials and LLM training data stop applying to ~60% of your codebase. And C# in Godot 4 **cannot export to web at all** — so you'd pick GDScript (web works, but your 100x harness realistically degrades to 10-30x) or C# (harness is fine, browser build is gone). Decide that before M0, not at M9.

---

## 6. Can the agent build this without you? No. Here's the precise split.

**Genuinely lands autonomously** (this is a lot — probably 70-80% of the LOC):
- All of M0: accumulator, dual-stream RNG, pools, 64px spatial hash, camera with deadzone/lerp/lookahead, F3 overlay. Textbook; first or second try.
- The entire data layer — ~5,400 lines of plain objects transcribed from your spec. Agents are excellent at exactly this.
- The registry discipline itself. `AbilityRegistry[id] = {onCast, onTick, onEnd}`, never branching on character id, one `displayName()` helper, `damage.js` as single choke point. An agent follows structural rules like these *more* consistently than most humans — no deadline pressure to hack around them.
- Gacha math **and a real unit test for it** — rates, pity ramp, 50/50 with `guaranteedFeatured`, 10-pull guarantee, persisted counters. Runs headless, genuinely proves itself.
- The one-to-one ref unit test (every `ref` a single string, no `refSource` twice, no ability id on two characters).
- Save/load, schemaVersion, migration.
- All 13 enemy behavior archetypes and the 7 spawn patterns — well-understood steering.
- WebAudio synthesized SFX. ~200 lines of oscillator code, zero binary assets. **This is the one asset category an agent can actually author**, and it's a real argument for the web stack.
- The harness plumbing (building it — not interpreting it).
- All placeholder copy: 54 barks, ~33 achievements, ~88 codex entries, 163 upgrade descriptions. Quality will be serviceable-but-generic against a spec asking for "funny" and "warm," but the fields get filled.

**Will not land without you — the short list:**

1. **A screenshot capability is mandatory from M0, not optional.** The agent writes Canvas draw calls and cannot see the canvas. A wrong camera transform, inverted y-axis, z-order bug drawing HUD under the arena, alpha mistake making every enemy invisible, sprite at 10x scale — *all of these produce zero console errors and pass every test the agent can write.* It will report "rendering implemented" for a black screen. Give it Playwright/Puppeteer headless screenshots or the `claude-in-chrome` skill and require it to capture and actually look at a frame after every render change. Without this, do not start. With it, it self-catches maybe 70%.

2. **The M1 gate — "is moving and killing things ALREADY satisfying?"** There is no metric that answers this. The agent will write "M1 gate: PASS — combat feels responsive" and continue, and that sentence is a fabrication, and it is the most load-bearing sentence in the build. **You play the M1 build for 10 minutes and tune six numbers**: move speed, accel ramp, attack cadence, knockback impulse, hit-flash duration, hitstop duration. One 30-minute session. Highest-leverage half hour in the project.

3. **All juice tuning (Section 3, M8).** Hitstop 60ms vs 120ms (your spec contradicts itself inside one sentence, line 291), knockback impulse constant, gem easing curve, shake amplitudes, card fly-in speed. The agent picks plausible constants; every one will be wrong by a factor a player notices instantly. **Workaround that actually works:** have it expose every juice constant in a single `feel.js` with a dev-mode slider panel bound to it (it can build that). You drag sliders for 2-3 hours; the results become defaults.

4. **Zero-allocation verification.** The agent honors it in the obvious places (pooled enemies, projectiles, gems) and violates it everywhere subtle: array literals as return values, per-frame closures in `forEach`/`filter`/`map` over the spatial hash, string concat for damage numbers and HUD, `{x, y}` temporaries in steering, spread operators, `Math.hypot` arg arrays, boxed iterators from `for...of`. **A heap profile is a Chrome DevTools interaction it cannot run.** It will mark that acceptance criterion PASS on the grounds that it used pools. This fails silently and shows up as GC stutter at minute 15 — precisely when the game must not stutter.

5. **Gamepad and touch on real hardware.** No synthetic gamepad exists for headless testing. Deadzones, stick drift, Xbox/DualSense/generic HID mapping, thumb-reach ergonomics for the virtual stick. 45 minutes with a controller and a phone. Non-negotiable if you're going to claim the support.

6. **Accessibility verification.** Your spec promises a genuine 3Hz flash cap. The agent can throttle one flash timer; it cannot verify the *composite* of hit flashes + level-up radial + Unit-09's UI glitch + Alicia's screen tint + gacha rainbow beam + boss telegraphs firing together stays under 3Hz. That needs frame capture and luminance analysis. Photosensitive-epilepsy claims from an unverified system are a real harm risk, not a checkbox. Same for colorblind safety — your boss telegraph language is RED/YELLOW/BLUE/WHITE, which is exactly a color-only channel. **If you can't do this pass, ship with reduce-flashing ON by default and remove the epilepsy-safety claim from the UI.**

7. **M9 balance tuning** (as distinct from building the harness). The scripted bot never dodges a telegraph, so it dies to every boss and reports every character as failing. Use the harness to find outliers — that part genuinely works — then hand-play the 3-4 flagged characters. Budget 10+ hours.

8. **The Section 18 FIX A vs FIX B decision** (thin ★3 pool). Forced to choose, the agent picks A (you labelled it "recommended") and then *invents two characters*, quietly violating your one-to-one rule with refs you'd never have approved. Five-minute decision; make it before M7.

9. **Publishing.** Credentials, and the legal-exposure judgement. Have the agent produce the artifact plus a pre-publish checklist and stop.

**One structural warning:** your spec says "adding a new character must require editing exactly ONE file" (line 243) but also "one data object + up to 4 registry entries" (line 927) — already two different claims. Under pressure to ship 19 characters, the agent will start special-casing: `if (char.id === 'kira')` in the damage pipeline, a rage-meter branch in the HUD for Han, a roster-count lookup in Sora's Spirit Bomb. Each is individually reasonable and collectively destroys the architecture you designed the whole document around. **Nothing in your acceptance criteria tests for this.** Add a test that greps for character-id string literals outside `/src/data`.

**Also worth knowing before you start:** the feasibility audit found ~40 genuine self-contradictions in the spec, several of which are load-bearing. The largest: **the economy is off by 20-60x** (250-450 gold / 8-25 Star Fragments per run against a 1,600-Fragment 10-pull, with a stated target of one 10-pull per 3-4 runs). Also, the soft-pity claim is arithmetically false as written (+6%/pull from a 8% base reaches 80% at pull 62, not "always"), which means your required pity unit test *cannot be written* without a judgement call from you. Nine mob types are named in stage tables with no stats anywhere. M6 says 22 relics and 7 evolutions; Section 15 and the actual lists say 24 and 8. Stage 7 has no mid-boss. Fix the economy, the pity curve, and the relic/evolution counts before M6 — the rest can be resolved in flight.

---

## 7. The IP footnote that actually touches engine choice

Your DEV_MODE ref-stripping handles *character names*. It does not touch the ability and relic names, and a lot of those are verbatim from source IP: **Kamehameha, Kaio-ken, Amaterasu, Susanoo, Nichirin, Niten Ichi-ryū, Level 5, Shinigami Eyes, Rasengan, Chidori.** Those strings ship in `characters.js` regardless of the flag. (Related: your spec's own test — "grep the built output for a ref string" — is impossible under "no build step." There is no built output.)

**The practical point for this decision:** where you host changes who can delete you and how much say you get.

- **Self-publishing** (itch.io, your own Electron build on Steam) puts you inside the DMCA safe-harbor framework. A complaint gets you a formal counter-notice with legal weight, you keep control of your own binary, and itch.io is famously hands-off.
- **A third-party platform** like s&box is strictly worse. Its EULA requires you not infringe third-party rights, grants Facepunch a sub-licensable assignable licence over your Experience, and reserves the right to suspend or cancel your access *"without prior warning"* with no refunds. Its monetization rules separately forbid monetizing packages built on copyrighted material, and it runs a public DMCA reporting endpoint. Cover Corp or Shueisha files once and a company protecting its own Valve relationship removes you instantly — no counter-notice, no obligation to hear you out.

So: the engine choice that gives you the most control over your own distribution is also the one that gives you the most control here. That's the web stack.

Cheap mitigations, none of which are legal advice: extend the DEV_MODE stripping to cover ability and relic names too (it's the same mechanism, just a wider table); rename the most flagrant ones outright before any public build — a "Kamehameha" is a "Father-Son Beam," a "Nichirin Blade" is a "Sunsteel Edge"; and keep the `ref` strings in a single file you can delete rather than scattered through ability code. Do this at data-authoring time, not as a pre-ship scramble.

---

## Do this

1. Keep the spec's stack. Delete the engine question.
2. **Before M0**, patch five things into the spec: (a) `spriteAtlas.js` is mandatory-at-boot and the renderer's only source of pixels; (b) the "no `beginPath`/`fillText`/`shadowBlur`/`save()` in the draw loop" rule; (c) `renderer.js` is a narrow immediate-mode API; (d) `save.js` gets a pluggable storage backend; (e) a named reference laptop + resolution + a `?perf=1` gate asserting p95 < 16.6ms at 2,500 entities.
3. Give the agent screenshot capability on day one. Non-negotiable.
4. Fix the economy numbers, the pity curve, the 24-relics/8-evolutions counts, and the FIX A/B decision yourself.
5. Ship free in-browser on itch.io the moment M4 is playable. That's the VS playbook, and it's the fastest audience you can buy for $0.
6. Electron + `steamworks.js` when you have something worth charging for.
7. If it sells, *then* pay for the Godot or Unity re-implementation for console — with 90% of your design document and all of your balance data intact.