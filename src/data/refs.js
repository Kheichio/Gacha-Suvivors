// =============================================================================
// src/data/refs.js — THE ONLY FILE IN THE PROJECT CONTAINING REF STRINGS.
// =============================================================================
//
// DECISIONS.md §22: every `ref`, `refSource` and `refNotes` string in the entire
// project lives here, keyed by entity id. Nothing else contains one. A shipping
// build DELETES THIS ONE FILE; `refOf()` then returns undefined and
// `displayName()` in src/core/config.js degrades to the plain game name with no
// code change anywhere else. `tests/refs.test.js` greps every other source file
// and fails the build if a ref string escapes.
//
// THE ONE-TO-ONE RULE (spec lines 37-74) is load-bearing and tested:
//   (a) every CHARACTER's `ref` names exactly one person — never a blend,
//       never a list;
//   (b) no two characters share a `ref`.
// `refSource` deliberately DOES repeat (Hololive EN x3, Hololive JP x3,
// Naruto x2, Dragon Ball x2). Spec lines 56-66 state outright that same-series
// pairs are fine and that the constraint is on the ref, not the series;
// SECTION 17's stray "no source appears on two characters" contradicts the
// document's own roster and loses.
//
// Stages MAY reference a whole series (spec lines 68-70), so stage refs use
// compound names. Bosses, mid-bosses and elites follow the character rule and
// name exactly one referent each — where the spec offered two, one was chosen
// and the other demoted to a note (see student_council_president, kagutsuchi,
// the_final_form). The single exception is `the_twin_fangs`, whose referent is
// canonically one conjoined entity.
//
// ASCII only, on purpose: this file is read by artists in whatever editor they
// already have open. Japanese titles are romanised without macrons.
// =============================================================================

export const REFS = {

  // ===========================================================================
  // CHARACTERS (19) — refNotes is the full SECTION 4 art-direction paragraph.
  // This is what an artist works from; do not trim it.
  // ===========================================================================

  // --- 3-star ---------------------------------------------------------------
  mochi: {
    ref: 'Mokona',
    refSource: 'Magic Knight Rayearth',
    refNotes: "Small, round, white, black bead eyes, long ears, a single red gem " +
              "on the forehead. Bounces instead of walking. Says \"puu!\" " +
              "constantly. Canonically swallows objects into an infinite stomach " +
              "and spits them back out, and hops between dimensions. Every " +
              "ability comes from those two facts. Also appears in Tsubasa and " +
              "xxxHolic; draw the Rayearth silhouette.",
  },

  alto: {
    ref: 'Kirito',
    refSource: 'Sword Art Online',
    refNotes: "Black coat over black gear, black hair with bangs over the eyes, " +
              "dual-wielding one sword forward and one reversed. Floating " +
              "translucent-blue game menus open with a swipe gesture. Should " +
              "read as \"MMO player who takes it far too seriously.\" His HP bar " +
              "renders as an SAO-style segmented bar.",
  },

  // --- 4-star ---------------------------------------------------------------
  hoshino_rei: {
    ref: 'Hoshimachi Suisei',
    refSource: 'Hololive JP',
    refNotes: "Blue-black bob with a star hairpin, one visible blue eye, navy " +
              "and white idol outfit with a star-and-comet motif, cape. Comet " +
              "imagery everywhere — her name literally means \"comet\". " +
              "Extremely competitive, a Tetris obsessive, and the \"I am an idol " +
              "AND I will end you\" energy is the whole character. Fanbase name: " +
              "Hoshiyomi (\"star gazers\").",
  },

  yamikage: {
    ref: 'Sasuke Uchiha',
    refSource: 'Naruto',
    refNotes: "Dark blue high-collar shirt, white arm wraps, black duck-tail " +
              "hair, red Sharingan eyes that spin when he uses anything. " +
              "Permanently brooding, monologues about revenge mid-fight. Every " +
              "ability here is his own — lightning (Chidori), black flame " +
              "(Amaterasu), Sharingan foresight. He does NOT get shadow clones " +
              "or substitution; those belong to a different ninja, and that " +
              "ninja is his own roster slot (Uzu).",
  },

  uzu: {
    ref: 'Naruto Uzumaki',
    refSource: 'Naruto',
    refNotes: "Spiky blond hair, blue eyes, three whisker marks on each cheek, " +
              "orange-and-black jumpsuit, forehead protector. Loud, relentlessly " +
              "optimistic, physically incapable of giving up. Deliberately " +
              "placed at the SAME rarity as Yamikage (Sasuke) — they are a " +
              "matched rival pair and should always be pulled, displayed and " +
              "balanced against each other. He inherits the exact moveset that " +
              "was withheld from Yamikage under the one-to-one rule.",
  },

  captain_yuli: {
    ref: 'Levi Ackerman',
    refSource: 'Attack on Titan',
    refNotes: "Short, black undercut hair, white cravat, Survey Corps jacket " +
              "with the Wings of Freedom, full ODM harness. Flat, unimpressed " +
              "expression at all times. Fights by spinning mid-air through a " +
              "target rather than swinging once. Obsessive about cleanliness — " +
              "his idle animation is wiping his blades.",
  },

  kagura: {
    ref: 'Tamamo-no-Mae',
    refSource: 'Fate/Grand Order',
    refNotes: "Long pink hair, golden fox ears, nine enormous fox tails, blue- " +
              "and-white miko outfit with detached sleeves, carries a polished " +
              "bronze mirror. Aggressively affectionate one moment and murderous " +
              "the next. Catchphrase is a fox noise. Everything about her is " +
              "shrine-fox iconography — ofuda, torii gates, foxfire, and Inari " +
              "worship.",
  },

  unit_09: {
    ref: 'Kizuna AI',
    refSource: 'VTuber (the original)',
    refNotes: "Brown hair with a huge pink ribbon shaped like headset ears, " +
              "white-and-pink hoodie dress, thigh-high boots, pink eyes. " +
              "Relentlessly cheerful, gestures with her whole body, insists she " +
              "is a super-intelligent AI while doing extremely un-AI things. Her " +
              "UI should look like a streaming overlay: subscriber counter, chat " +
              "ticker, a little \"LIVE\" dot.",
  },

  // --- 5-star ---------------------------------------------------------------
  rin: {
    ref: 'Tanjiro Kamado',
    refSource: 'Demon Slayer',
    refNotes: "Burgundy hair tied back, red-brown eyes, a scar on the forehead, " +
              "hanafuda earrings, black-and-green checkered haori, a large " +
              "wooden box strapped to his back. Earnest, gentle, apologises to " +
              "things he kills. He starts every run in Water Breathing and " +
              "unleashes Sun Breathing as his special — that arc from water to " +
              "fire IS the character, so the special must visually change his " +
              "whole palette from blue to orange when it fires.",
  },

  niten: {
    ref: 'Musashi Miyamoto',
    refSource: 'Vagabond',
    refNotes: "Ragged, sun-darkened ronin. Wild unwashed hair tied back roughly, " +
              "torn dark kimono, no armour, bare feet. Scarred, hollow-eyed, and " +
              "completely still until he isn't. He fights with a long sword in " +
              "the right hand and a short sword in the left simultaneously — " +
              "Niten Ichi-ryu, \"two heavens as one\" — which no one else in the " +
              "roster does. Where Rin's swordplay is flowing and beautiful, " +
              "Musashi's is brutal, economical, and ugly on purpose. Use the " +
              "Vagabond depiction specifically: ink-wash aesthetic, heavy " +
              "blacks, a single red accent for blood. Do NOT use the Fate/GO " +
              "version — that is a different character design entirely and this " +
              "roster is one-ref-per-slot.",
  },

  shiro_same: {
    ref: 'Gawr Gura',
    refSource: 'Hololive EN',
    refNotes: "Pale blue/white twin-tail hair, shark hoodie with a functional " +
              "tail and dorsal fin, blue-grey eyes, very small, holds a trident " +
              "she rarely uses correctly. Palette #5fd6ff / #ffffff / #0b3d5c. " +
              "Signature greeting is a shark-jaw hand gesture — use it as her " +
              "spawn animation.",
  },

  reika: {
    ref: 'Mikoto Misaka',
    refSource: 'A Certain Scientific Railgun',
    refNotes: "Short brown bob, Tokiwadai winter uniform with the brown skirt, " +
              "shorts underneath, lightning arcing off the bangs when angry. The " +
              "arcade token flick, the orange hitscan beam, \"Iron Sand\", and " +
              "\"Level 5\" are all hers verbatim. Her whole kit is " +
              "electromagnetism — lean into it.",
  },

  nekromina: {
    ref: 'Mori Calliope',
    refSource: 'Hololive EN',
    refNotes: "Long pink hair, red eyes, black-and-red reaper coat with a high " +
              "collar, a tiny top hat pinned at an angle, and a full-size scythe " +
              "she rests on her shoulder. She is Death's apprentice and also a " +
              "rapper — that exact duality is the character, so her attacks " +
              "should carry a beat: the auto attack fires on a rhythm and the " +
              "special drops on the downbeat. Her fanbase is canonically called " +
              "the \"Deadbeats\", which is what her minions are.",
  },

  hikari: {
    ref: 'Takanashi Kiara',
    refSource: 'Hololive EN',
    refNotes: "Orange/red hair with the phoenix crest, feathered orange-and-gold " +
              "outfit, bird-wing accents on the arms, aggressively upbeat. Her " +
              "canonical gimmick IS resurrection — she reincarnates instead of " +
              "dying, which is exactly what the \"Undying\" passive models. Fire " +
              "feathers everywhere.",
  },

  akane: {
    ref: 'Houshou Marine',
    refSource: 'Hololive JP',
    refNotes: "Everything is RED. Long black twin-tails with red ribbons, a red " +
              "pirate captain's coat worn open over a red-and-white outfit, a " +
              "huge red tricorn hat with a plume, gold trim, an eyepatch motif, " +
              "a cutlass at the hip. Enormous personality — loud, theatrical, " +
              "filthy-minded, immediately switches to an over-the-top pirate " +
              "voice. Greets everyone with \"Ahoy!\". Her fanbase are her crew. " +
              "Her hub idle should be her sprawled on a treasure pile.",
  },

  kira: {
    ref: 'Light Yagami',
    refSource: 'Death Note',
    refNotes: "Immaculate high-school student. Neat brown hair, brown eyes, " +
              "school blazer and tie, perfect posture. Carries a plain black " +
              "notebook. He never physically fights — his idle is standing " +
              "still, writing. The single most important art direction note in " +
              "this document: his violence is entirely off-screen and " +
              "administrative, and every effect should reinforce that. No impact " +
              "frames, no swings. Enemies simply stop and fall over. His moment " +
              "of triumph is a manic grin and a lot of red backlighting.",
  },

  // --- 6-star ---------------------------------------------------------------
  sovereign_alicia: {
    ref: 'Kiryu Coco',
    refSource: 'Hololive JP',
    refNotes: "Blonde hair with an orange-red gradient at the tips, curved " +
              "dragon horns, a long scaled tail, wing accessories at the hips, " +
              "orange eyes. Loud, brash, extremely confident, speaks in a " +
              "booming broadcast voice. She runs a morning news segment " +
              "in-universe — use that for her hub idle: she is reading headlines " +
              "at a desk when you walk past. The dragon form is canon to her, so " +
              "Apotheosis is her own transformation, not a borrowed one.",
  },

  sora: {
    ref: 'Goku',
    refSource: 'Dragon Ball',
    refNotes: "Spiky black hair, orange gi with a blue undershirt and belt, blue " +
              "wristbands and boots. Permanently cheerful, slightly dim, only " +
              "fully engaged when someone stronger shows up. Ki is visible as a " +
              "white-gold aura that flares when he charges. His three moves are " +
              "all his own: hand-to-hand rush, the Spirit Bomb, and Ultra " +
              "Instinct's silver-eyed auto-dodge.",
  },

  han: {
    ref: 'Gohan',
    refSource: 'Dragon Ball',
    refNotes: "Use the Cell Games design specifically — spiky black hair, purple " +
              "gi with a blue undershirt, a single shoulder pad, small and " +
              "young. He is a gentle, bookish kid who does not want to fight, " +
              "right up until the moment he does, at which point his hair goes " +
              "gold, his eyes go teal, and lightning crawls over his aura. That " +
              "transition is the entire character, so the transformation must be " +
              "the loudest visual event in the game: full stop of the music, a " +
              "held silent beat, then the aura detonates. Deliberately placed at " +
              "the SAME rarity as Sora (Goku) — father and son, both 6-star, and " +
              "the Spirit Bomb's roster-scaling gets an explicit bonus if you " +
              "own both.",
  },

  // ===========================================================================
  // STAGES (7) — from the QUICK REFERENCE MAP and SECTION 7's [REF:] lines.
  // Spec lines 68-70: only a stage may reference a whole series, because a
  // location is not a person. These are the only compound refs in the file.
  // ===========================================================================

  cherry_academy: {
    ref: 'Kunugigaoka Junior High + Shuchiin Academy',
    refSource: 'Assassination Classroom + Kaguya-sama: Love Is War',
    refNotes: "School anime, the warm end of it. Falling petals, chain-link " +
              "rooftop fences, a sunset gradient, and one lone desk on the roof. " +
              "Kunugigaoka supplies the hillside campus and the rooftops; " +
              "Shuchiin supplies the student council wing the boss walks out of. " +
              "This is the tutorial stage, so it should be the prettiest and the " +
              "least threatening thing in the game.",
  },

  neon_akiba: {
    ref: 'Akihabara at night',
    refSource: 'Steins;Gate + Oreimo + Durarara!!',
    refNotes: "Akihabara as shot in Steins;Gate, with Oreimo's shopfronts and " +
              "Durarara's Ikebukuro-at-night crowd blocking. Arcade signage " +
              "stacked eight storeys high, vending machines, rain reflections in " +
              "the asphalt, maid-cafe flyers spinning past on the wind. " +
              "Extremely pink and cyan — the only warm light on screen is the " +
              "truck headlights of the traffic-lane hazard, which is what makes " +
              "the telegraph readable.",
  },

  wall_amaris: {
    ref: 'Wall Maria and the fall of Shiganshina',
    refSource: 'Attack on Titan',
    refNotes: "Shattered stone walls, grey sky, smoke columns, a ruined town " +
              "half-buried in its own masonry. Bleak and epic. Almost no " +
              "saturation anywhere, so the player's projectiles are the only " +
              "colour on screen. The collapsing-wall hazard must be cut from the " +
              "same stone the arena is built from — the player should read cover " +
              "and threat as the same material.",
  },

  hidden_ember: {
    ref: 'The Hidden Leaf Village',
    refSource: 'Naruto',
    refNotes: "A ninja village at night: wooden rooftops at odd angles, paper " +
              "lanterns on strings, bamboo, drifting mist, and carved faces in " +
              "the cliff on the horizon. Deep green and lantern orange. The " +
              "smoke-bomb hazard cuts visibility to a 300px radius, so the " +
              "lanterns double as the player's only navigation aid — place them " +
              "on a readable grid, not at random.",
  },

  tatami_halls: {
    ref: 'The Infinity Castle',
    refSource: 'Demon Slayer',
    refNotes: "An impossible Escher palace of shifting tatami rooms, paper " +
              "doors, and upside-down staircases hanging in a void. Copy the " +
              "rotating-room architecture and the biwa-summoned reconfiguration " +
              "exactly. Deep indigo and blood red, with no horizon and no sky — " +
              "the absence of a ground plane is the whole effect.",
  },

  sunken_reef: {
    ref: 'Fishman Island',
    refSource: 'One Piece + Hololive EN',
    refNotes: "A drowned concert stadium on the ocean floor. Bubble-coral and " +
              "giant sunken architecture from Fishman Island, crossed with " +
              "Hololive EN's Atlantis and shark theming. Bioluminescent coral, " +
              "floating stage lights, whale song under the music, schools of " +
              "fish crossing the arena, and a dead jumbotron hanging over the " +
              "stage.",
  },

  zenith_stage: {
    ref: 'original',
    refSource: 'original',
    refNotes: "Declared original by the spec. Tonally it is the Cell Games arena " +
              "staged as a Hololive 3D concert under an Evangelion " +
              "instrumentality sky: a concert arena at the end of the world, " +
              "floating debris, an aurora, a crowd of a million silhouettes, and " +
              "every previous stage's silhouette visible on the horizon. Peak " +
              "anime. Nothing here is copied from one place — it is the game " +
              "quoting itself, which is why it has no ref.",
  },

  // ===========================================================================
  // BOSSES (7) — SECTION 7's [BOSS REF:] lines.
  // ===========================================================================

  student_council_president: {
    ref: 'Kaguya Shinomiya',
    refSource: 'Kaguya-sama: Love Is War',
    refNotes: "The spec offered Kaguya Shinomiya OR Miyuki Shirogane; bosses " +
              "follow the one-ref rule, so this is Kaguya. Long black hair with " +
              "a red ribbon, immaculate uniform, and an expression that has " +
              "already decided how this ends. Shirogane supplies props only — " +
              "the clipboard, the paperwork barrage, the disciplinary committee. " +
              "She fights with a chalkboard-katana and never stops being polite " +
              "about it. Phase 3 is DETENTION: a shrinking ring of red tape.",
  },

  the_algorithm: {
    ref: 'original',
    refSource: 'original',
    refNotes: "Declared original by the spec. Visually it is the Wired from " +
              "Serial Experiments Lain crossed with a giant recommendation feed: " +
              "a colossal floating eye built from stacked, scrolling content " +
              "cards, each card showing something the player did earlier in the " +
              "run. Its attacks are literally UI — infinite-scroll laser " +
              "columns and SUBSCRIBE popups invading the game field. Cold white " +
              "and interface blue against the Akiba pink.",
  },

  the_colossus: {
    ref: 'The Colossal Titan',
    refSource: 'Attack on Titan',
    refNotes: "Steam vents and all. Skinless, exposed musculature, no lips, and " +
              "so large it occupies a quarter of the screen — the player fights " +
              "its hands and climbs the steam vents to reach the nape. The steam " +
              "is the read: it hisses before every attack and it is how the weak " +
              "points announce themselves. The grab QTE accepts any input " +
              "(DECISIONS.md §17), so telegraph the hand, not the keyboard.",
  },

  the_sealed_beast: {
    ref: 'Kurama',
    refSource: 'Naruto',
    refNotes: "The Nine-Tailed Fox fought while chained by seals. A fire-fox the " +
              "size of a building: orange-red, black tear-line markings, red " +
              "sclera, wrapped in glowing seal chains that visibly strain. " +
              "Destroying a tail grants a permanent buff for the fight and " +
              "enrages it — that beast-versus-seal imagery is the entire " +
              "encounter and should get louder every time a tail goes.",
  },

  kagutsuchi: {
    ref: 'Akaza',
    refSource: 'Demon Slayer',
    refNotes: "Named for the Shinto fire kami; built from Akaza. Four arms, bare " +
              "torso covered in blue-black demon markings, pink hair, and an " +
              "eye-colour telegraph standing in for the Upper Rank kanji. His " +
              "ranged fan set borrows the attack SHAPE of another Upper Rank " +
              "(Doma's fans), but the silhouette, stance and pressure are " +
              "Akaza's alone — one ref per boss. Red eyes = charge, blue = " +
              "ranged fan, white = arena-wide slash you must escape through.",
  },

  the_kraken_producer: {
    ref: 'Surume',
    refSource: 'One Piece',
    refNotes: "One Piece's kraken, same per-tentacle health-bar structure. Eight " +
              "tentacles each with their own bar, and a tiny studio headset " +
              "perched on the head. Destroying tentacles removes its attacks one " +
              "at a time, so each tentacle needs a distinct silhouette. The " +
              "final phase pulls the whole arena into a whirlpool and the fight " +
              "continues on a shrinking platform. Absurd and enormous — commit.",
  },

  the_final_form: {
    ref: 'Hollow Ichigo',
    refSource: 'Bleach',
    refNotes: "The fight-a-copy-of-yourself boss. Hollow Ichigo is the primary " +
              "read: an inverted, bleached-white mirror with black sclera and a " +
              "grin the original never wears. Naruto vs. Dark Naruto is the " +
              "secondary reference for the shapeshifting build-up only — one ref " +
              "per boss. It transforms through pastiches of every previous boss, " +
              "then reveals its true form: the player's own character using " +
              "their auto, special and escape at 120% power.",
  },

  // ===========================================================================
  // MID-BOSSES (7)
  // ===========================================================================

  delinquent_senpai: {
    ref: 'Ryuji Takasu',
    refSource: 'Toradora!',
    refNotes: "The delinquent who is not actually a delinquent: a face that " +
              "reads as a thug, a uniform worn open, and a dead-straight charge " +
              "telegraphed a full beat in advance. Generic sukeban iconography " +
              "(long skirt, wooden sword, bleached hair) fills out the " +
              "silhouette. Warm and harmless underneath — this is the tutorial " +
              "mid-boss and it should be beatable almost by accident.",
  },

  mascot_prime: {
    ref: 'Chiitan',
    refSource: 'Japanese yuru-chara mascots',
    refNotes: "The cursed-mascot school taken to its endpoint: a giant suit with " +
              "an enormous head, a frozen smile, and movement far too energetic " +
              "for its mass. Funassyi's bounce is the animation reference. It " +
              "splits into four smaller suits and every one of them keeps " +
              "smiling. Never let the fabric look clean.",
  },

  the_armored: {
    ref: 'The Armored Titan',
    refSource: 'Attack on Titan',
    refNotes: "Plated bone armour over the entire body, a hard jaw, a low " +
              "forward-leaning charge. Immune to damage everywhere except the " +
              "exposed nape. Per DECISIONS.md §31 its facing turns at a capped " +
              "90 degrees per second with a 0.4s lag, so getting behind it is a " +
              "real skill rather than a coin flip — draw the armour plates large " +
              "enough that the player can always tell which way it faces.",
  },

  the_twin_fangs: {
    ref: 'Sakon and Ukon',
    refSource: 'Naruto',
    refNotes: "The only ref in this file naming two people, because the referent " +
              "is canonically one conjoined entity: the Sound Four's Sakon and " +
              "Ukon, one body with a second head emerging from it. Two elite " +
              "ninja that must die within 5s of each other or the survivor " +
              "revives the other at 50% HP. The Demon Brothers' " +
              "chain-and-gauntlet silhouette is the fallback if two separate " +
              "bodies read better in play.",
  },

  the_drum_oni: {
    ref: 'Kyogai the Drum Demon',
    refSource: 'Demon Slayer',
    refNotes: "The Tsuzumi Mansion demon: hand drums set into the shoulders, " +
              "arms and belly, and a room that rotates every time he strikes " +
              "one. Pale, hunched, and desperately proud of his own work. He is " +
              "the in-world explanation for Stage 5's shifting-rooms hazard, so " +
              "the drum hit and the room rotation must land on the same beat or " +
              "the whole stage stops making sense.",
  },

  tide_warden: {
    ref: 'Hody Jones',
    refSource: 'One Piece',
    refNotes: "Not Hody's own silhouette — this takes the shielded escort " +
              "formation his crew fights in and gives it a Sea King's mass. A " +
              "giant reef crab with a plated shield across its entire front, " +
              "barnacled and coral-crusted. Flank it. Per DECISIONS.md §31 the " +
              "shield turns at a capped rate, which is what makes flanking " +
              "possible at all.",
  },

  the_opening_act: {
    ref: 'original',
    refSource: 'original',
    refNotes: "ORIGINAL by ruling (DECISIONS.md §7). Stage 7 had no mid-boss at " +
              "its halfway mark; this is the fix. Three previous mid-bosses walk " +
              "out simultaneously at reduced HP under one shared spotlight, like " +
              "a support act sharing a bill. There is deliberately nothing to " +
              "copy: a finale that recapitulates the game has to be assembled " +
              "from the game. Draw it as a stage entrance — the house lights " +
              "come up on three silhouettes the player already recognises.",
  },

  // ===========================================================================
  // NAMED ELITES (7)
  // ===========================================================================

  perfect_attendance_award: {
    ref: 'original',
    refSource: 'original',
    refNotes: "No ref line in the spec and none is needed — it is a school " +
              "awards ceremony given a body. A gold-plated trophy the size of a " +
              "person, floating, slowly rotating, with a brass plaque reading " +
              "PERFECT ATTENDANCE. It has no attacks of its own; it summons " +
              "students who do, which is exactly how school awards work. The " +
              "tsukumogami tradition (see cursed_desk) is the in-world reason an " +
              "object is moving at all.",
  },

  gacha_golem: {
    ref: 'Gashapon capsule machine',
    refSource: 'Akihabara arcade fronts',
    refNotes: "A wall of gashapon machines that stood up and started walking: a " +
              "stack of chrome-and-glass capsule domes, a coin slot for a mouth, " +
              "a crank arm on each side. Very tanky, no attacks whatsoever, and " +
              "it runs away from the player. Comedy elite — it should look " +
              "increasingly desperate as its HP drops, and it coughs out three " +
              "upgrade capsules when it finally goes.",
  },

  abnormal: {
    ref: 'Abnormal Titan',
    refSource: 'Attack on Titan',
    refNotes: "AoT's abnormal titans; the nape weak point is canon. A husk that " +
              "sprints erratically, ignores every other target, and beelines the " +
              "player with its head cocked at the wrong angle. Genuinely scary. " +
              "Mark the nape with a visible glow — it takes 3x damage and the " +
              "player has to be told that without reading a codex entry.",
  },

  sealed_vessel: {
    ref: 'Fire Temple sealing monk',
    refSource: 'Naruto',
    refNotes: "A chained monk — sealed rather than imprisoned. Shaven head, " +
              "rope-and-paper seal wrappings over the eyes and arms, prayer " +
              "beads, kneeling until it isn't. Every few seconds it snaps one " +
              "seal and every enemy on screen gets stronger. The breaking seal " +
              "must be a loud, screen-wide, unmissable event so the player " +
              "learns to kill it first.",
  },

  upper_rank_remnant: {
    ref: 'The lesser Twelve Kizuki',
    refSource: 'Demon Slayer',
    refNotes: "One of the lower Upper Ranks, or what is left of one: " +
              "human-shaped, with the Kizuki eye-kanji half faded out. It " +
              "teleports, mimics the player's own escape move, and taunts with a " +
              "text bubble every time it dodges. The mimicry is the joke — it " +
              "should feel like being read, not like being cheated.",
  },

  elite_encore_siren: {
    ref: 'The centre of a sunken idol group',
    refSource: 'original — Hololive EN concert staging',
    refNotes: "A distinct entity from the Tier-3 encore_siren mob " +
              "(DECISIONS.md §30). This is the one with the solo: a mic stand, a " +
              "spotlight that tracks her through the water, a longer costume, " +
              "and a visible ring of light that both heals and shields " +
              "everything inside it. She is interrupted by 300 damage in 2 " +
              "seconds, so the ring must visibly crack as damage lands.",
  },

  the_understudy: {
    ref: 'original',
    refSource: 'original',
    refNotes: "ORIGINAL by ruling (DECISIONS.md §7). Stage 7 had no named elite; " +
              "this is the fix. A flat black silhouette of the player's own " +
              "character at 60% power that mirrors the auto-attack and nothing " +
              "else — no special, no escape. It foreshadows the Final Form, so " +
              "it must be recognisably the player's shape with none of the " +
              "player's colour: pure black fill, one thin white rim light, and " +
              "the same attack rhythm half a beat late.",
  },

  // ===========================================================================
  // THE SWEEPER — not in the required list, but he has a name plate and a
  // codex entry, so he needs a ref like everything else the player can see.
  // ===========================================================================

  stage_manager: {
    ref: 'Death, the Reaper',
    refSource: 'Vampire Survivors',
    refNotes: "The genre-standard hard stop, translated into the anime-industry " +
              "vocabulary this game is built from. Not a skeleton and not a " +
              "scythe: a production stage manager in a black headset and " +
              "lanyard, holding a clipboard, walking at the player at steadily " +
              "increasing speed and one-shotting them. He says \"That's a wrap.\" " +
              "999,999 HP and unkillable by design. Per DECISIONS.md §21 he " +
              "spawns at duration + 180s if the final boss is still alive; " +
              "surviving him 60s is the hidden achievement.",
  },

  // ===========================================================================
  // ENEMIES (35) — SECTION 9's "ENEMY REF NOTES" block supplies 23. The nine
  // ghost mobs and three split children (DECISIONS.md §5) are authored here to
  // match that voice. Enemies are archetypes, not people, so their refs are
  // objects, creatures and crowd shots rather than named characters.
  // ===========================================================================

  // --- TIER 1: FODDER (8) ---------------------------------------------------
  mob_student: {
    ref: 'Generic background classmate',
    refSource: 'School anime, any',
    refNotes: "Generic background character, deliberately faceless and grey. He " +
              "is the crowd that fills a classroom shot and never gets a line: " +
              "blank oval face, no eyes, standard-issue blazer, hands at his " +
              "sides. Keep him the least saturated thing on screen so every " +
              "other silhouette reads as important by comparison.",
  },

  chibi_ghost: {
    ref: 'Susuwatari soot sprite',
    refSource: 'Spirited Away',
    refNotes: "The little soot-sprite and obake ghosts. A round black puff with " +
              "two white dot eyes and a wavering wisp of a tail, bobbing along a " +
              "slow sine. Should look completely harmless and arrive in the " +
              "dozens — the threat is arithmetic, not silhouette.",
  },

  slime_kouhai: {
    ref: 'The stock blue slime',
    refSource: 'JRPG and isekai bestiary',
    refNotes: "The classic JRPG and slime-isekai blue slime: a glossy teardrop " +
              "dome with a tiny mouth and one highlight blob. Wobbles when it " +
              "moves and parts cleanly down the middle on death. Cheerful rather " +
              "than menacing — it is the first thing the player learns to " +
              "ignore, which is why it splits.",
  },

  crow_familiar: {
    ref: 'Kasugai crow',
    refSource: 'Demon Slayer',
    refNotes: "Karasu-tengu messenger crows. Glossy black, oversized head, one " +
              "bead eye visible, wings held in a hard V. It circles rather than " +
              "closes, which is what makes it annoying instead of dangerous — " +
              "the orbit radius must stay readable against a busy background.",
  },

  gacha_zombie: {
    ref: 'Akihabara crowd shot',
    refSource: 'Steins;Gate',
    refNotes: "Akihabara crowd shots: phone in hand, dead eyes, a shopping bag " +
              "hanging off one wrist. Shambles in a loose shoal with the face " +
              "lit from below by the screen. Washed-out streetwear against the " +
              "stage's Akiba pink, and it drops extra gold because it was always " +
              "going to spend it anyway.",
  },

  husk_wanderer: {
    ref: 'Pure Titan',
    refSource: 'Attack on Titan',
    refNotes: "The basic titan: vacant grin, lidless eyes, a lurching walk with " +
              "the arms hanging wrong. Naked, doughy, and far too cheerful about " +
              "it. Slow and relentless — always drawn in a crowd, never alone, " +
              "because a single one of these is not frightening and forty are.",
  },

  chalk_wraith: {
    ref: 'Blackboard yokai',
    refSource: 'Gakkou no Kaidan school ghost stories',
    refNotes: "NEW for Stage 1 (DECISIONS.md §5). A blackboard eraser's worth of " +
              "chalk dust holding a human outline. The edges keep crumbling and " +
              "re-forming, and it leaves a faint white smear on the floor " +
              "behind it. Draw it as negative space: pale dust over the stage's " +
              "sunset palette, with two empty chalk circles for eyes.",
  },

  neon_otaku: {
    ref: 'Akiba figure hunter',
    refSource: 'Oreimo',
    refNotes: "NEW for Stage 2 (DECISIONS.md §5). The other half of the Akiba " +
              "crowd: hunched, three plastic merch bags per hand, glasses " +
              "catching the signage so the eyes never show. Moves in short " +
              "determined bursts toward whatever it wants. Bag-heavy, " +
              "bottom-weighted silhouette; grey coat over screaming pink and " +
              "cyan bag art.",
  },

  // --- TIER 2: PRESSURE (12) ------------------------------------------------
  cursed_desk: {
    ref: 'Tsukumogami',
    refSource: 'Japanese folklore',
    refNotes: "Tsukumogami, the hundred-year object spirits — this one is a " +
              "school desk. Chipped wooden lid, one eye open in the grain, legs " +
              "that scuttle. It sits perfectly still, telegraphs for 0.8s, then " +
              "lunges, so the still pose has to be visibly wrong.",
  },

  kunai_bat: {
    ref: 'Summoned bat',
    refSource: 'Naruto',
    refNotes: "A ninja summon animal with a kunai gripped in each foot. " +
              "Leathery, oversized ears, small body, ragged flapping flight. It " +
              "never closes to melee; it holds at range and throws a three-kunai " +
              "spread, so the wing beat should read as a firing tell.",
  },

  camera_drone: {
    ref: 'Surveillance drone',
    refSource: 'Psycho-Pass',
    refNotes: "A street-surveillance drone: matte white shell, a single gimballed " +
              "lens, four whisper-quiet rotors, one red recording dot. Ghost in " +
              "the Shell's rounder Tachikoma read is the fallback. Its laser is " +
              "slow and tracking, so the actual threat cue is the lens turning " +
              "toward you.",
  },

  mascot_suit: {
    ref: 'Chiitan',
    refSource: 'Japanese yuru-chara mascots',
    refNotes: "A cursed regional mascot. Enormous head, tiny useless arms, a " +
              "permanent frozen smile, fabric slightly wrong at every seam. " +
              "Funassyi's manic bounce is the movement reference. It shrugs off " +
              "knockback because it is mostly stuffing, and it should look " +
              "delighted about that.",
  },

  jellyfish_chorus: {
    ref: 'Drifting spore',
    refSource: 'Nausicaa of the Valley of the Wind',
    refNotes: "Nausicaa's drifting spores crossed with a jellyfish: a " +
              "translucent bell, long trailing filaments, a faint internal glow. " +
              "It rises and falls as it drifts. The 3s fuse reads as the bell " +
              "going opaque and hot before the pop, and the blast chains, so the " +
              "brightening must be visible through a crowd.",
  },

  genin_shade: {
    ref: 'Genin silhouette',
    refSource: 'Naruto',
    refNotes: "A genin in silhouette only — flak vest, forehead protector, " +
              "sandals, no face. It blinks 150px toward the player in a " +
              "body-flicker with a puff of leaves and a hard afterimage left " +
              "behind. Ink-black against the village lanterns.",
  },

  coral_crab: {
    ref: 'Fishman Island fauna',
    refSource: 'One Piece',
    refNotes: "Fishman Island reef fauna: an armoured crab in candy-bright coral " +
              "pinks and oranges, with one oversized shield claw held flat " +
              "across the front. Per DECISIONS.md §31 the shield turns at only " +
              "90 degrees per second with a 0.4s lag, so draw the claw plate " +
              "large and unmistakable — the player has to see which way it faces " +
              "from across the arena.",
  },

  antifan_swarm: {
    ref: 'Faceless comment-section mob',
    refSource: 'original',
    refNotes: "Faceless internet-mob silhouettes with speech bubbles: flat grey " +
              "cut-out heads, no features, each trailing one tiny empty comment " +
              "bubble. They arrive twenty-five at a time and move faster than " +
              "anything else in the tier. Never make them cute — the joke is " +
              "that they are perfectly identical.",
  },

  gym_uniform_ghoul: {
    ref: 'PE-class ghost',
    refSource: 'School anime, the sports festival episode',
    refNotes: "NEW for Stage 1 (DECISIONS.md §5). A gym-uniform ghost stuck " +
              "mid-relay: white tee, coloured team bib, a whistle on a lanyard, " +
              "one arm permanently extended for a baton that is not there. Runs " +
              "in a sprinter's forward lean at all times, even standing still. " +
              "Bleached white and team red against the academy sunset.",
  },

  anglerfish_fan: {
    ref: 'Deep-sea anglerfish',
    refSource: 'One Piece',
    refNotes: "NEW for Stage 6 (DECISIONS.md §5). Reef-trench anglerfish with a " +
              "concert twist: the lure on its head is a glowing idol penlight, " +
              "and the mouth is far too large for the body. It hangs motionless " +
              "in the dark until the lure is close enough to matter. " +
              "Bioluminescent teal lure over a near-black body — the lure is the " +
              "only part the player should ever see coming.",
  },

  crawler_husk: {
    ref: 'Crawling Titan',
    refSource: 'Attack on Titan',
    refNotes: "NEW for Stage 3 (DECISIONS.md §5). A titan with no usable legs, " +
              "dragging itself forward on its forearms with the same vacant " +
              "grin as the Husk Wanderer. Low, wide, and horrifying at ankle " +
              "height. Explicitly NOT the Ceiling Crawler: different tier, " +
              "different stage, and this one comes from the floor.",
  },

  lesser_oni: {
    ref: 'Lower Rank demon',
    refSource: 'Demon Slayer',
    refNotes: "NEW for Stage 5 (DECISIONS.md §5). A footsoldier demon, NOT the " +
              "horned oni of folklore: human-shaped, sallow, veined, slit pupils " +
              "and too many teeth, kimono in muted indigo with blood-red cuffs. " +
              "It visibly regenerates under the stage's Demon Moon modifier, " +
              "which is the entire reason it exists. Explicitly distinct from " +
              "the Oni Bruiser, which is the folklore version.",
  },

  // --- TIER 3: THREATS (12) -------------------------------------------------
  oni_bruiser: {
    ref: 'Oni',
    refSource: 'Japanese folklore',
    refNotes: "The classic Japanese oni: red skin, two horns, a tiger-skin wrap, " +
              "and an iron kanabo club resting over one shoulder. Huge, slow, " +
              "and delighted about it. The ground-slam telegraph is him raising " +
              "the club straight up and holding it for a full beat.",
  },

  blood_doll: {
    ref: 'Junji Ito doll',
    refSource: 'Junji Ito',
    refNotes: "Junji Ito doll horror crossed with Demon Slayer blood art: a " +
              "porcelain-white face with a hairline crack, jointed limbs, and " +
              "dark arterial red where the joints meet. When it splits, the " +
              "halves are wet, not clean — that contrast between porcelain and " +
              "fluid is the whole design.",
  },

  ronin_shade: {
    ref: 'Wandering swordsman',
    refSource: 'Samurai Champloo',
    refNotes: "The wandering swordsman archetype, Kenshin's cross-scar lineage " +
              "rendered as a shadow. Straw hat, ragged travelling kimono, one " +
              "sword, no face under the brim. The long dash leaves a single flat " +
              "slash mark hanging in the air a beat after he has already gone.",
  },

  sprinting_husk: {
    ref: 'Abnormal Titan sprint',
    refSource: 'Attack on Titan',
    refNotes: "The abnormal titan sprint — this should be scary. Same vacant " +
              "grin as the Husk Wanderer, but running flat out with the arms " +
              "trailing behind and the head thrown back. Nothing else on screen " +
              "moves like this, and that contrast is the entire design.",
  },

  ceiling_crawler: {
    ref: 'Ceiling-drop ambusher',
    refSource: 'Parasyte',
    refNotes: "A Parasyte ceiling-drop: something person-shaped clinging " +
              "overhead with too many joints, unfolding as it falls. Tokyo " +
              "Ghoul's kagune silhouette is the fallback if a wetter read is " +
              "wanted. The telegraph is a shadow on the floor that grows for " +
              "0.6s — never drop one unannounced, ever.",
  },

  paper_lantern_wisp: {
    ref: 'Chochin-obake',
    refSource: 'Japanese folklore',
    refNotes: "The lantern yokai: a split paper lantern with one enormous eye " +
              "and a long lolling tongue, bobbing on a slack cord. Warm orange " +
              "from inside, indigo outside. It hangs almost stationary and keeps " +
              "spitting out chibi ghosts, which is what makes it a priority " +
              "target rather than scenery.",
  },

  encore_siren: {
    ref: 'Backup singer, but wrong',
    refSource: 'Idol anime',
    refNotes: "An idol-group backup singer, but wrong: the smile is held half a " +
              "second too long and the choreography is a beat behind everyone " +
              "else. Matching stage costume, handheld mic, a soft ring of light " +
              "at her feet marking the 250px heal radius. Per DECISIONS.md §30 " +
              "this is the Tier-3 mob, NOT the Stage 6 named elite.",
  },

  trap_scroll: {
    ref: 'Explosive tag',
    refSource: 'Naruto',
    refNotes: "A paper bomb: a rectangle of rice paper with a column of black " +
              "seal script, pinned to the floor and curling at the corners. It " +
              "does not move and it is always visible. The contract is that the " +
              "player can always see it and choose to walk around it — if a " +
              "player is ever surprised by one, the spawn placement is wrong.",
  },

  eel_swarm: {
    ref: 'Sea creature swarm',
    refSource: 'One Piece',
    refNotes: "A knot of reef eels moving as one body. Slick, dark green, mouths " +
              "open, no individual detail — read it as a single writhing mass. " +
              "When it latches it should visibly wrap the player, and it must be " +
              "obvious that moving 200px shakes it off.",
  },

  rubble_golem: {
    ref: 'Shiganshina masonry',
    refSource: 'Attack on Titan',
    refNotes: "NEW for Stage 3 (DECISIONS.md §5). The wall itself standing up: " +
              "shaped stone blocks, mortar seams, a broken roof beam through one " +
              "shoulder, dust pouring from every gap. No face, just a hole where " +
              "one should be. It is the stage hazard turned into an enemy, so it " +
              "must be exactly the same grey as the falling rubble.",
  },

  ambusher: {
    ref: 'Body-flicker ambush',
    refSource: 'Naruto',
    refNotes: "NEW for Stage 4 (DECISIONS.md §5). A shinobi that arrives instead " +
              "of approaching: it materialises beside the player in a swirl of " +
              "leaves, always with a 0.6s telegraph. Dark blue, hooded, blade " +
              "already drawn and already moving. The leaf swirl is the contract " +
              "— if the player did not get the swirl, the spawn is a bug.",
  },

  drowned_roadie: {
    ref: 'Sunken stage crew',
    refSource: 'original',
    refNotes: "NEW for Stage 6 (DECISIONS.md §5). Concert crew that never made " +
              "it out: black crew tee, laminated lanyard, gaffer tape round one " +
              "forearm, and a coil of cable over the shoulder that trails behind " +
              "like a tail. Bloated and waterlogged, moving on the drift. Black " +
              "and hi-vis yellow against the reef bioluminescence.",
  },

  // --- SPLIT CHILDREN (3) — spawned only, never in a mob table -------------
  tiny_slime: {
    ref: 'Split slime',
    refSource: 'JRPG and isekai bestiary',
    refNotes: "Half a Slime Kouhai, drawn at half the radius with the same " +
              "highlight blob and a slightly panicked face. Spawned only by the " +
              "splitter (DECISIONS.md §5) and never rolled from a mob table, so " +
              "it never needs an idle pose — it exists mid-panic.",
  },

  blood_shard: {
    ref: 'Blood-art fragment',
    refSource: 'Demon Slayer',
    refNotes: "A hand-sized piece of a Blood Doll: a porcelain shard trailing a " +
              "ribbon of arterial red, spinning slowly as it homes in. Spawned " +
              "only by the splitter (DECISIONS.md §5) and never rolled from a " +
              "mob table. Keep the ribbon long — it is how the player tracks " +
              "three of them at once.",
  },

  mascot_splinter: {
    ref: 'Mascot offcut',
    refSource: 'Japanese yuru-chara mascots',
    refNotes: "A torn-off piece of Mascot Prime still doing its absolute best: " +
              "one arm, one eye, half a grin, foam stuffing spilling from the " +
              "seam. It bounces exactly like the parent did, which is the joke. " +
              "Spawned only by Mascot Prime (DECISIONS.md §5) and never rolled " +
              "from a mob table.",
  },

  // ===========================================================================
  // RELICS (24) — SECTION 11's "RELIC NAME ORIGINS" block, all of it.
  // Spec lines 1524-1525: every signature relic comes from ITS OWN character's
  // source, never someone else's. So a signature relic's `ref` is deliberately
  // the same person as its owner character's `ref` — that duplication is the
  // rule being satisfied, not violated. The one-to-one uniqueness test runs
  // over characters only.
  // The 5 stage relics reference their stage's series, not a person.
  // ===========================================================================

  // --- 19 signature relics --------------------------------------------------
  secret_technique_109: {
    ref: 'Mokona',
    refSource: 'Magic Knight Rayearth',
    refNotes: "Mokona's running gag: Secret Technique No. 1 through 108, all of " +
              "them absurd and none of them ever explained. This relic is the " +
              "109th. Owner: Mochi, and it comes from Mochi's source alone.",
  },

  dual_blades: {
    ref: 'Kirito',
    refSource: 'Sword Art Online',
    refNotes: "Kirito's actual unique skill name in SAO — Dual Blades, the " +
              "one-of-a-kind skill the system handed exactly one player. Owner: " +
              "Alto, and it comes from Alto's source alone.",
  },

  hoshiyomi_penlight: {
    ref: 'Hoshimachi Suisei',
    refSource: 'Hololive JP',
    refNotes: "Hoshiyomi is Suisei's fanbase name — star gazers — and a penlight " +
              "is what they hold up in the dark. Owner: Hoshino Rei, and it " +
              "comes from her source alone.",
  },

  susanoo_fragment: {
    ref: 'Sasuke Uchiha',
    refSource: 'Naruto',
    refNotes: "Sasuke's Susanoo ribcage manifestation — the first, partial stage " +
              "of it, which is exactly what a fragment is. Owner: Yamikage. The " +
              "Nine-Tails cloak belongs to Uzu and stays there; these two relics " +
              "are the clearest case in the file of the one-to-one rule keeping " +
              "a shared series clean.",
  },

  nine_tails_chakra: {
    ref: 'Naruto Uzumaki',
    refSource: 'Naruto',
    refNotes: "Kurama's chakra cloak — Naruto's, not Sasuke's. Owner: Uzu. Same " +
              "series as the Susanoo Fragment and deliberately non-overlapping " +
              "with it.",
  },

  thunder_spear: {
    ref: 'Levi Ackerman',
    refSource: 'Attack on Titan',
    refNotes: "Attack on Titan's anti-titan Thunder Spear, verbatim, and Levi is " +
              "the one who uses it best. Owner: Captain Yuli, and it comes from " +
              "his source alone.",
  },

  inaris_blessing: {
    ref: 'Tamamo-no-Mae',
    refSource: 'Fate/Grand Order',
    refNotes: "Tamamo-no-Mae's Inari and fox-deity lineage. Inari is a " +
              "public-domain Shinto deity so the name itself ships as-is; the " +
              "lineage is what ties the relic to Kagura specifically. Owner: " +
              "Kagura.",
  },

  singularity_patch: {
    ref: 'Kizuna AI',
    refSource: 'VTuber (the original)',
    refNotes: "Kizuna AI's super-AI claim, shipped as a software update. Owner: " +
              "Unit-09, and it comes from her source alone.",
  },

  nichirin_blade_crimson: {
    ref: 'Tanjiro Kamado',
    refSource: 'Demon Slayer',
    refNotes: "Demon Slayer, verbatim: Nichirin blades change colour to match " +
              "their wielder, and Tanjiro's turns black and then crimson. Owner: " +
              "Rin. Canonical id per DECISIONS.md §11 — \"Nichirin Blade " +
              "Crimson\" without the parentheses is a rejected alias.",
  },

  two_heavens_as_one: {
    ref: 'Musashi Miyamoto',
    refSource: 'Vagabond',
    refNotes: "Niten Ichi-ryu, Musashi's actual two-sword school, translated: " +
              "two heavens as one. Owner: Niten. Extraordinary on him " +
              "specifically because his auto-attack already alternates two " +
              "blades, and merely very good on everyone else.",
  },

  chum_bucket: {
    ref: 'Gawr Gura',
    refSource: 'Hololive EN',
    refNotes: "Gawr Gura's fanbase are called chumbuds. Owner: Shiro Same. Per " +
              "DECISIONS.md §10 this relic carries an explicit resonance " +
              "override so the spec's worked example (20s down to 12s, 250px up " +
              "to 375px) survives verbatim instead of being rounded by the " +
              "generic 1.5x rule.",
  },

  level_5_clearance: {
    ref: 'Mikoto Misaka',
    refSource: 'A Certain Scientific Railgun',
    refNotes: "Academy City esper ranks — Misaka is one of only seven Level 5s, " +
              "and the rank is called out in her own art-direction notes as " +
              "hers verbatim. Owner: Reika.",
  },

  grave_idol_mic: {
    ref: 'Mori Calliope',
    refSource: 'Hololive EN',
    refNotes: "Mori Calliope's rap-and-reaper duality compressed into one prop: " +
              "a reaper's tool that happens to be a stage mic. Owner: Nekromina.",
  },

  ashes_of_the_eternal_encore: {
    ref: 'Takanashi Kiara',
    refSource: 'Hololive EN',
    refNotes: "Takanashi Kiara's phoenix reincarnation gimmick — the ashes are " +
              "the point, and the encore never actually ends. Owner: Hikari. " +
              "Canonical id per DECISIONS.md §11 — \"Ashes of the Encore\" is a " +
              "rejected alias.",
  },

  captains_rum: {
    ref: 'Houshou Marine',
    refSource: 'Hololive JP',
    refNotes: "Houshou Marine's pirate-captain persona, and the bottle that " +
              "comes with it. Owner: Akane.",
  },

  potato_chip_gambit: {
    ref: 'Light Yagami',
    refSource: 'Death Note',
    refNotes: "Light hiding a miniature TV inside a bag of crisps, iconically, " +
              "while eating a single chip with enormous dramatic intensity. " +
              "Owner: Kira. The animation is non-negotiable.",
  },

  crown_of_the_world_eater: {
    ref: 'Kiryu Coco',
    refSource: 'Hololive JP',
    refNotes: "Kiryu Coco's dragon-royalty framing. Owner: Sovereign Alicia. " +
              "Canonical id per DECISIONS.md §11 — \"Crown of World-Eater\" is a " +
              "rejected alias.",
  },

  kaioken: {
    ref: 'Goku',
    refSource: 'Dragon Ball',
    refNotes: "Goku's multiplier technique, recoil damage and all. Owner: Sora. " +
              "Han never uses it, which is exactly why the relic sits here and " +
              "not on him.",
  },

  the_cell_games: {
    ref: 'Gohan',
    refSource: 'Dragon Ball',
    refNotes: "Gohan's Super Saiyan 2 awakening at the Cell Games, verbatim, and " +
              "the reason his art direction is pinned to the Cell Games design " +
              "specifically. Owner: Han.",
  },

  // --- 5 stage relics -------------------------------------------------------
  neon_visor: {
    ref: 'Future Gadget lab goggles',
    refSource: 'Steins;Gate',
    refNotes: "Stage relic, Neon Akiba District. The future-gadget workshop " +
              "aesthetic: a hand-soldered visor with far too many exposed wires " +
              "that nonetheless works perfectly. Stage relics reference the " +
              "stage's series, not a person.",
  },

  anchor_gear: {
    ref: 'ODM gear',
    refSource: 'Attack on Titan',
    refNotes: "Stage relic, Ruins of Wall Amaris. Omni-directional mobility " +
              "gear: gas canisters at the hip, twin anchors, steel line on a " +
              "spool. Stage relics reference the stage's series, not a person.",
  },

  nine_seal_ward: {
    ref: 'Eight Trigrams Sealing Style',
    refSource: 'Naruto',
    refNotes: "Stage relic, Hidden Ember Village. Naruto's Eight Trigrams " +
              "Sealing Style with a ninth seal added, so the name is ours rather " +
              "than theirs. Stage relics reference the stage's series, not a " +
              "person.",
  },

  everblade_fragment: {
    ref: 'Scarlet crimson Nichirin ore',
    refSource: 'Demon Slayer',
    refNotes: "Stage relic, The Endless Tatami Halls. The scarlet crimson ore " +
              "Nichirin blades are forged from, still glowing in the hand. Stage " +
              "relics reference the stage's series, not a person.",
  },

  abyssal_setlist: {
    ref: 'Fishman Island',
    refSource: 'One Piece',
    refNotes: "Stage relic, Sunken Idol Reef. Fishman Island crossed with a " +
              "concert setlist: a waterlogged running order taped to a monitor " +
              "wedge with one song circled hard in red. Stage relics reference " +
              "the stage's series, not a person.",
  },

};

// -----------------------------------------------------------------------------
// Accessors. These three functions are the whole public API besides the tables;
// every consumer looks a ref up BY ENTITY ID and never stores the string.
// All three are total: an unknown id is not an error, because in a ship build
// this entire module is absent and callers must degrade silently.
// -----------------------------------------------------------------------------

export function refOf(id) { const r = REFS[id]; return r ? r.ref : undefined; }

export function refNotes(id) { const r = REFS[id]; return r ? r.refNotes : ''; }

export function refSource(id) { const r = REFS[id]; return r ? r.refSource : ''; }

// -----------------------------------------------------------------------------
// SHIP_NAMES USED TO LIVE HERE. IT MOVED, ON PURPOSE — src/data/shipNames.js.
//
// A ship build deletes THIS file. A `shipName` is the name that has to be on
// screen after that deletion (DECISIONS.md §22.3), so keeping the rename table
// in the file that gets deleted meant every ability fell back to its source-IP
// name in exactly the build the rename exists to protect. Refs are attributions
// and die at ship time; shipNames are display strings and must outlive them.
//
// Nothing else about the join changed: src/data/index.js still attaches them at
// boot, and displayName() still prefers `shipName` when DEV_MODE is false.
// -----------------------------------------------------------------------------



