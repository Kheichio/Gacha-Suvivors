// All 25 playable characters. SECTION 4 of the design spec.
//
// This file is PURE DATA. No functions, no logic, no branching — the ability
// registry (src/game/abilities/) owns behaviour, keyed by the ids declared here.
// Adding character #20 is one object in this file plus up to four registry
// entries (spec line 927 / DECISIONS.md §36).
//
// No source-inspiration fields live here. Every such string in the project lives
// in one file — src/data/refs.js — keyed by character id and joined at display
// time (DECISIONS.md §22). A ship build deletes that file and displayName()
// no-ops cleanly. tests/refs.test.js fails the build if one leaks into this file.
//
// Character-specific presentation needs are DECLARED, never branched on:
//   - `resourceBar`  Han only    — the RAGE meter the HUD renders generically.
//   - `metric`       Kira only   — the balance harness measures him on kills/sec
//                    instead of DPS, because his timers ignore enemy HP
//                    entirely (spec line 1664).
//   - `altForm`      Alicia only — the second silhouette she wears for the eight
//                    seconds APOTHEOSIS runs. The renderer draws whatever the
//                    active form declares and never learns whose it is.
// DECISIONS.md §36 greps every file outside src/data/ for a character id
// literal, so these three fields are the only sanctioned escape hatch.
//
// Special cooldowns run 12-35s (DECISIONS.md §15 — the spec's "12-30s" is wrong;
// Sora 32 / Han 34 / Alicia 35 are the three most powerful specials in the game
// and their numbers are correct). Escape cooldowns run 4-9s.
//
// Targeting modes are the 8 base modes plus nearestN / facingAuto / lineDensest
// and an optional `filter` (DECISIONS.md §16). No mode is ever hardcoded per
// character.
//
// Elements are live data, not flavour (DECISIONS.md §26):
//   fire > steel > lightning > water > fire  (ring, +/-15%)
//   shadow <-> light (mutual +15%), spirit neutral both ways.

// ---------------------------------------------------------------------------
//                        3-STAR ROSTER (Starters)
// ---------------------------------------------------------------------------

const MOCHI = {
  id: 'mochi',
  name: 'Mochi',
  epithet: 'The Pocket Dimension',
  rarity: 3,
  archetype: 'Chaos Mascot',
  element: 'spirit',
  visual: { shape: 'circle', color: '#ffffff', accent: '#d63b4a', emoji: '🍡', size: 14 },
  stats: {
    hp: 100, armor: 0, moveSpeed: 168, pickupRadius: 52,
    damageMult: 0.95, attackSpeedMult: 1.0, areaMult: 1.0,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 1,
  },
  autoAttack: {
    id: 'puu', name: 'Puu!',
    // Spec gives a 6-18 range; the schema carries one number, so `damage` is the
    // mean and the roll lives in the ability. The random object is COSMETIC and
    // load-bearing for watchability — spec line 386 says do not cut it.
    desc: 'Spits a stored object at the nearest enemy every 1.0s for 6-18 damage. ' +
          'Anvil, teapot, fish, boulder, another Mochi — you never know.',
    interval: 1.0, damage: 12, targeting: { mode: 'nearest' },
  },
  special: {
    id: 'secret_technique_108', name: 'SECRET TECHNIQUE No. 108', cooldown: 18,
    desc: 'Opens its mouth impossibly wide and disgorges 20 objects at once: ' +
          '90 total damage in a 140px radius with heavy knockback.',
  },
  escape: {
    id: 'dimension_hop', name: 'Dimension Hop', cooldown: 5, iframes: 0.6,
    desc: 'Vanishes into a rift and drops out of another 200px away. ' +
          'Both rifts deal 20 damage.',
  },
  passive: {
    id: 'infinite_stomach', name: 'Infinite Stomach',
    desc: '+25% pickup radius. Pickups are swallowed and stored — you collect ' +
          'them even if you die before touching them.',
  },
  starUpgrades: {
    s3: 'Secret Technique No. 108 also spits out a free pickup.',
    s5: 'Dimension Hop leaves both rifts open for 3s as damaging portals.',
  },
  signatureRelic: 'secret_technique_109',
  barks: {
    spawn: 'Puu~! Mochi is here! Puu!',
    levelUp: 'Puuu! Mochi ate the level. It was crunchy.',
    lowHp: '...puu?',
    kill: 'Gone! Mochi swallowed it. No, you cannot have it back.',
    boss: 'Big! BIG! Mochi can still fit it. Probably. Puu!',
    victory: 'Puu! Next world, next snack! Bye-bye!',
    idle: 'Secret Technique No. 47! ...Mochi forgot what that one does.',
  },
  buildPaths: [
    'Vacuum gremlin — Lodestone + Scholar + Four-Leaf; Infinite Stomach hoovers ' +
    'the whole arena and you out-level the difficulty curve instead of fighting it',
    'Rift blender — Quick Recovery + Wide Reach + Momentum; Dimension Hop becomes ' +
    'a 20-damage teleport strike you throw out every 3s',
  ],
};

const ALTO = {
  id: 'alto',
  name: 'Alto',
  epithet: 'The Solo Player',
  rarity: 3,
  archetype: 'Duelist',
  element: 'steel',
  visual: { shape: 'capsule', color: '#1b1f2a', accent: '#3fd0ff', emoji: '🗡️', size: 16 },
  stats: {
    hp: 105, armor: 0, moveSpeed: 176, pickupRadius: 46,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.0,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 0,
  },
  autoAttack: {
    id: 'vertical_arc', name: 'Sword Skill: Vertical Arc',
    desc: 'A 120° arc in the facing direction, 85px reach, every 0.8s. ' +
          'Every 5th swing is a charged Sword Skill: 3x damage, double range, cyan trail.',
    interval: 0.8, damage: 16, targeting: { mode: 'facing' },
  },
  special: {
    id: 'starburst_stream', name: 'STARBURST STREAM', cooldown: 20,
    desc: '16 dual-blade hits over 2.5s at 22 damage each, every hit retargeting ' +
          'to the closest living enemy. Invulnerable for the first 1.0s. ' +
          'The hit counter climbs on screen.',
  },
  escape: {
    id: 'switch', name: 'Switch!', cooldown: 7, iframes: 0.8,
    desc: 'Vanishes for 0.8s — invulnerable and immune to slows — then reappears ' +
          '200px along your movement direction with an afterimage.',
  },
  passive: {
    id: 'beater', name: 'Beater',
    desc: '+2% damage per player level this run, uncapped. He grinds, and ' +
          'everyone resents him for it.',
  },
  starUpgrades: {
    s3: 'Starburst Stream extends to 24 hits.',
    // Spec states the glitch zone but no numbers; 25 damage/s for 4s authored to
    // keep the card honest (every desc ships real numbers, spec line 1729).
    s5: 'Switch! leaves a system-error glitch zone dealing 25 damage/s for 4s.',
  },
  signatureRelic: 'dual_blades',
  barks: {
    spawn: "Party of one. That's not lonely, that's efficient.",
    levelUp: 'Skill slot open. Allocating.',
    lowHp: "HP's yellow. I have until red.",
    kill: 'Switch! ...right. Solo. Force of habit.',
    boss: 'Every boss has a pattern. Give me ten seconds.',
    defeat: 'No respawn. I knew that when I logged in.',
  },
  buildPaths: [
    'Charged-swing crit — Keen Eye + Killing Blow + Wide Reach; every 5th swing ' +
    'is already 3x, so crit multiplies the spike instead of the chaff',
    'Level-hoarder — Scholar + Lodestone + Second Wind; Beater is uncapped, so ' +
    'XP gain literally is a damage stat for him',
  ],
};

// ---------------------------------------------------------------------------
//                          4-STAR ROSTER (Rare)
// ---------------------------------------------------------------------------

const HOSHINO_REI = {
  id: 'hoshino_rei',
  name: 'Hoshino Rei',
  epithet: 'Reirei, the Encore Idol',
  rarity: 4,
  archetype: 'Aura Idol',
  element: 'light',
  visual: { shape: 'capsule', color: '#4b6cff', accent: '#f2f6ff', emoji: '☄️', size: 16 },
  stats: {
    hp: 100, armor: 0, moveSpeed: 174, pickupRadius: 48,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.05, critChance: 0.05,
    critMult: 2.0, cooldownMult: 1.0, luck: 0,
  },
  autoAttack: {
    id: 'comet_shards', name: 'Comet Shards',
    desc: 'Star shards that ricochet to up to 4 enemies, gaining +15% damage per ' +
          'bounce. 18 base damage every 1.0s.',
    interval: 1.0, damage: 18, targeting: { mode: 'nearest' },
  },
  special: {
    id: 'stellar_encore', name: 'STELLAR ENCORE', cooldown: 24,
    desc: 'The stage lights drop and a comet lands behind her. For 8s a 200px aura ' +
          'heals 4 HP/s, grants +25% attack speed, and pulses a 30-damage ' +
          'soundwave ring every 0.8s.',
  },
  escape: {
    id: 'comet_trail', name: 'Comet Trail', cooldown: 6, iframes: 0.5,
    desc: 'A 150px streaking dash that leaves a glittering decoy taunting enemies ' +
          'for 2.5s.',
  },
  passive: {
    id: 'hoshiyomi', name: 'Hoshiyomi',
    desc: 'Every 10 kills drops a small heart that heals 3 HP.',
  },
  starUpgrades: {
    // Revive stacking is capped at 3/run and resolves in a fixed order
    // (DECISIONS.md §29): Undying -> Second Chance -> Shrine -> Rei S3 -> Phoenix Heart.
    s3: 'Stellar Encore revives you once if you would die during its 8s.',
    s5: 'Comet Trail grants a 1-hit shield when you land.',
  },
  signatureRelic: 'hoshiyomi_penlight',
  barks: {
    spawn: "I'll sing. You'll die. Both on schedule.",
    levelUp: "Higher rank. I don't do plateaus.",
    lowHp: 'Misdrop. Fine. I clear it from here.',
    kill: 'Cleared four lines at once. Metaphorically.',
    boss: 'Good. I stack better under pressure.',
    victory: 'Encore, and nobody beat my score. As usual.',
  },
  buildPaths: [
    'Aura anchor — Wide Reach + Quick Recovery + Iron Body; stack the Penlight and ' +
    'stand inside a 280px healing ring that never goes down',
    'Ricochet chain — Long Haul + Extra Shot + Sharp Edge; each shard bounce is ' +
    '+15%, so bounce count is the real damage stat',
  ],
};

const YAMIKAGE = {
  id: 'yamikage',
  name: 'Yamikage',
  epithet: 'The Avenger',
  rarity: 4,
  archetype: 'Assassin',
  element: 'lightning',
  visual: { shape: 'capsule', color: '#2b3a6b', accent: '#c81e3a', emoji: '👁️', size: 16 },
  stats: {
    hp: 95, armor: 0, moveSpeed: 178, pickupRadius: 46,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.0,
    critChance: 0.08, critMult: 2.0, cooldownMult: 1.0, luck: 0,
  },
  autoAttack: {
    id: 'shuriken_volley', name: 'Shuriken & Wire',
    desc: '3 shuriken in a tight spread, 15 damage each, pierce 1, every 0.65s. ' +
          'Every 4th volley is wire-strung and curves back through — and the fire ' +
          'goes down the wire with it: a 130px cone for 34 damage that burns for ' +
          '11 damage/s over 2.5s.',
    interval: 0.65, damage: 15, targeting: { mode: 'nearest' },
  },
  special: {
    // `charges` is a generic, optional field on any special (player.js reads it
    // the way it already reads the escape's star-5 second charge). It exists
    // because this move is defined by having a COUNT rather than a rhythm: two
    // in the pocket, and then you are out until they come back one at a time.
    id: 'chidori', name: 'CHIDORI', cooldown: 14, charges: 2,
    desc: 'Two charges, 14s each. He grips a fistful of lightning for 0.3s, then ' +
          'crosses 340px in a straight line: everything on the path takes 150. ' +
          'The enemy at the end takes 300 + 8% of its max HP, is stunned for ' +
          '1.6s, and the impact discharges 140 in a 130px burst. Invulnerable ' +
          'through the whole run.',
  },
  escape: {
    id: 'lions_barrage', name: "Lion's Barrage", cooldown: 6, iframes: 0.55,
    desc: 'Vanishes and comes out 190px along your movement direction, cutting for ' +
          '45 on the way. Whatever is nearest when he lands is pinned and ridden ' +
          'down: 4 rising hits of 45, then a heel-drop for 110 in a 100px radius.',
  },
  passive: {
    id: 'sharingan', name: 'Sharingan',
    desc: '+18% dodge chance. Every dodge is a read: the attack comes straight ' +
          'back as a 120px riposte for 70, and he keeps +7% damage for 5s, ' +
          'stacking to 5.',
  },
  starUpgrades: {
    // The cursed seal is deliberately CONDITIONAL and deliberately on the
    // special: it is a desperate power-up, so it may only be reachable when he
    // is actually desperate. The unconditional half (the fork) is what keeps S3
    // from reading as dead on a full health bar.
    s3: 'Chidori forks: 3 more enemies within 200px take 140 lightning each. And ' +
        'cast below 45% HP the cursed seal breaks — the thrust hits twice as ' +
        'hard and he gains +30% damage and +20% move speed for 10s.',
    s5: "Lion's Barrage gains a second charge, and the heel-drop ignites: a 90px " +
        'crater burning for 26 damage/s over 5s.',
  },
  signatureRelic: 'susanoo_fragment',
  barks: {
    spawn: 'Stay out of my way. All of you.',
    levelUp: 'Hn. Still not enough.',
    lowHp: "I don't get to die before he does.",
    kill: 'You were not the one I wanted.',
    boss: 'Finally. Something worth hating.',
    idle: 'I cut every bond I had for this. Do not talk to me.',
  },
  buildPaths: [
    'Assassin — Keen Eye + Killing Blow + Quick Recovery; Chidori is two charges ' +
    'of "that elite is already dead", and cooldown is what buys the third and fourth',
    'Untouchable duelist — Phantom Step + Vengeance + Guardian Plate; 18% base ' +
    'dodge plus 40% from Phantom Step means most of the screen simply misses — ' +
    'and under Sharingan every miss is a counter and a damage stack',
  ],
};

const UZU = {
  id: 'uzu',
  name: 'Uzu',
  epithet: 'The Spiral',
  rarity: 4,
  archetype: 'Clone Swarm',
  element: 'spirit',
  visual: { shape: 'capsule', color: '#ff7a1a', accent: '#1b1b2b', emoji: '🌀', size: 16 },
  stats: {
    hp: 130, armor: 0, moveSpeed: 172, pickupRadius: 46,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.0,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 0,
  },
  // THE KIT IS BUILT IN THE ORDER HE LEARNED IT.
  //
  // Clones are the ATTACK — the one technique he has, thrown constantly, at no
  // range and with no aim. The sphere is the one thing he had to be TAUGHT, so it
  // is the special: rare, delivered by hand, and enormous. The log is the academy
  // trick that buys him a second, and the transformation he lands in is a real
  // weapon rather than a joke. The passive is the only thing about him that has
  // never lost a fight.
  autoAttack: {
    id: 'kage_bunshin_barrage', name: 'Kage Bunshin Barrage',
    desc: '3 clones puff into existence AT the nearest enemy within 420px and ' +
          'strike for 12 each, every 0.7s. No travel time, no line of sight. ' +
          'Every 4th barrage ends the combo: they kick it up and he comes down ' +
          'heel-first for 24 extra damage and a 0.6s knockdown.',
    // 420, not targeting.js's default 900. The clones are drawn where they
    // strike, and half the viewport at base zoom is 640px — so the default put
    // his entire auto-attack off the side of the screen whenever the nearest
    // enemy happened to be out there.
    interval: 0.7, damage: 12, targeting: { mode: 'nearest', range: 420 },
  },
  special: {
    id: 'rasengan', name: 'RASENGAN', cooldown: 22,
    desc: 'A clone spins the sphere into his palm and he closes up to 260px to ' +
          'drive it in: 300 damage to the body he hits, 150 more in a 120px ' +
          'spiral that drags everything inward. Invulnerable for the 0.45s charge.',
  },
  escape: {
    id: 'substitution_jutsu', name: 'Substitution Jutsu', cooldown: 6, iframes: 0.6,
    desc: 'A log takes the hit and he comes up 200px away as somebody else. ' +
          'Everything within 150px takes 60 damage and stops dead for 1.4s. The ' +
          'log is real, visible, and comically ordinary.',
  },
  passive: {
    id: 'never_gives_up', name: 'Never Gives Up',
    desc: 'Every 10 kills a clone joins him for good, up to 5. And he does not ' +
          'go down: every 14s one of him steps in front of the next hit and eats ' +
          'it whole, then blasts 40 damage out in a 140px ring getting back up.',
  },
  starUpgrades: {
    // The giant version. 4 clones feed it instead of 1, and it GRINDS instead of
    // popping — which is the difference the source draws between the two, not a
    // bigger number on the same move.
    s3: 'RASENGAN becomes the giant version: 4 clones feed it for 520 damage in ' +
        'a 200px sphere that then grinds for 1.2s at 120 damage/s.',
    // "the log detonates" carries no number in the spec; 120 / 140px authored to
    // match the scale of his other burst.
    s5: 'Substitution leaves 3 doubles that taunt for 4s, and the log detonates ' +
        'for 120 damage in a 140px radius.',
  },
  signatureRelic: 'nine_tails_chakra',
  barks: {
    spawn: "Alright! Watch me! I'm gonna be number one!",
    levelUp: "YES! I TOLD you I'd get stronger!",
    lowHp: "I never go back on my word. That's my whole thing!",
    kill: 'One down! Only about a thousand to go!',
    boss: "HUGE! Great! I'll just make a thousand of me!",
    victory: 'Ramen. I earned ramen. Somebody buy me ramen.',
    idle: 'Hey. HEY. Are you watching? You have to be watching.',
  },
  buildPaths: [
    'Clone army — Iron Body + Second Wind + Rapid Fire; clones mirror your auto, ' +
    'so attack speed multiplies across six bodies at once',
    'Low-HP berserker — Nine-Tails Chakra + Bloodthirst + Vengeance; park under ' +
    '50% HP on purpose for +40% attack speed and a burning cloak',
  ],
};

const CAPTAIN_YULI = {
  id: 'captain_yuli',
  name: 'Captain Yuli',
  epithet: "Humanity's Strongest",
  rarity: 4,
  archetype: 'Aerial Executioner',
  element: 'steel',
  visual: { shape: 'capsule', color: '#3f4a3a', accent: '#d8d2c4', emoji: '🪝', size: 15 },
  stats: {
    hp: 100, armor: 1, moveSpeed: 186, pickupRadius: 44,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 0.9,
    critChance: 0.07, critMult: 2.0, cooldownMult: 1.0, luck: 0,
  },
  autoAttack: {
    id: 'twin_blade_cross', name: 'Twin Blade Cross',
    desc: 'Both blades at once — a 90° scissor that starts wide and crosses in ' +
          'front of him. 70px reach, 11 damage every 0.35s. The highest raw DPS ' +
          'in the game — if you can survive standing that close.',
    interval: 0.35, damage: 11, targeting: { mode: 'facing' },
  },
  special: {
    id: 'nape_strike', name: 'NAPE STRIKE', cooldown: 18,
    desc: 'Grapples to the highest-max-HP enemy on screen and executes it: ' +
          '200 damage +12% of its max HP, doubled against Large enemies. ' +
          'Full i-frames during the flight.',
  },
  escape: {
    id: 'grapple_line', name: 'Grapple Line', cooldown: 7, iframes: 0.6,
    // Line damage is unspecified in the spec; 45 authored to sit between Rin's
    // Water Wheel (45) and Yamikage's Chidori afterimage (60).
    desc: 'Fires an anchor 320px in the aim direction and zips there, ' +
          'invulnerable, cutting everything along the line for 45 damage.',
  },
  passive: {
    id: 'devotion', name: 'Devotion',
    desc: '+45% damage to Large and Elite enemies. He was built for the big ones.',
  },
  starUpgrades: {
    s3: 'Nape Strike executes the top 3 highest-HP enemies on screen.',
    s5: 'Grapple Line refunds its entire cooldown instantly if it kills something ' +
        'mid-flight.',
  },
  signatureRelic: 'thunder_spear',
  barks: {
    spawn: 'Tch. Look at this filth.',
    levelUp: "Stronger. Don't let it make you sloppy.",
    lowHp: 'Blood on the jacket. I just cleaned it.',
    kill: "That's not a body, that's a stain. Move.",
    boss: 'Big. Loud. Same weak point as the small ones.',
    victory: 'Clean your blades. Sleep. We do it again tomorrow.',
  },
  buildPaths: [
    'Melee blender — Rapid Fire + Bloodthirst + Guardian Plate; 0.35s swings turn ' +
    '1.5% lifesteal into a full health bar per wave',
    'Boss deleter — Sharp Edge + Killing Blow + Quick Recovery; Devotion and Nape ' +
    'Strike make him the fastest boss clear on the roster',
  ],
};

const KAGURA = {
  id: 'kagura',
  name: 'Kagura',
  epithet: 'The Nine-Tailed Casteress',
  rarity: 4,
  archetype: 'Shrine Fox',
  element: 'spirit',
  visual: { shape: 'capsule', color: '#ff8fc7', accent: '#e8b64c', emoji: '🦊', size: 16 },
  stats: {
    hp: 95, armor: 0, moveSpeed: 170, pickupRadius: 52,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.05,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 1,
  },
  autoAttack: {
    id: 'ofuda_talismans', name: 'Ofuda Talismans',
    desc: '2 slow homing charms stick to an enemy and detonate 0.8s later for ' +
          '22 damage in a small blast. Every 1.1s.',
    interval: 1.1, damage: 22,
    // Prefers targets not already carrying a talisman — no double-marking.
    targeting: { mode: 'randomInRange', filter: 'unmarked' },
  },
  special: {
    id: 'nine_tail_blaze', name: 'NINE-TAIL BLAZE', cooldown: 25,
    desc: '9 foxfire wisps orbit her, then seek targets independently for 45 ' +
          'damage each and set them burning for 3s.',
  },
  escape: {
    id: 'torii_warp', name: 'Torii Warp', cooldown: 0, iframes: 0.5,
    desc: 'NO COOLDOWN, EVER. She blinks 250px the way she is leaning and leaves ' +
          'a torii gate standing where she left. Purification — 2 charges, one ' +
          'back every 4.5s — adds 0.5s invulnerable and a 60-damage purifying ' +
          'burst on arrival. With none banked the warp still moves her.',
  },
  passive: {
    id: 'purification', name: 'Purification',
    desc: '12% chance on kill to drop a spirit orb worth 3x XP.',
  },
  starUpgrades: {
    // Trail numbers are unstated in the spec. 12 damage/s for 4s in a 70px trail:
    // nine wisps overlap heavily, so per-trail damage sits below Hikari's 15/s
    // Ember Dash trail while the stacked total is what makes the upgrade.
    s3: 'Nine-Tail Blaze wisps leave burning foxfire trails: 12 damage/s for 4s ' +
        'in a 70px path.',
    // ZERO COOLDOWN still exempts her warp (DECISIONS.md §28, §53). It is now
    // exempt because there is nothing left to reduce — her escape has no
    // cooldown at all — and removing the exemption would FLOOR her back up to
    // 0.6s, turning that evolution into a downgrade for exactly one character.
    s5: 'Torii Warp holds 3 purification charges instead of 2 and banks one ' +
        'every 3.0s, and your gates stand for the rest of the run (max 3).',
  },
  signatureRelic: 'inaris_blessing',
  barks: {
    spawn: 'Kon~! Did you miss me, darling?',
    levelUp: 'Ufufu~ do that again and I might keep you.',
    lowHp: 'You tore my sleeve. I will tear rather more.',
    kill: 'Aww, it stopped moving. Fetch me another, darling~',
    boss: 'My, my. Shall I be the sweet one today, or the other one?',
    idle: "I'm not clingy. I simply know where you sleep. Kon!",
  },
  buildPaths: [
    "Burn stacker — Inari's Blessing + Wide Reach + Sharp Edge; every DoT in the " +
    'kit gets +50% damage and +2s, and the talisman blasts overlap',
    'Warp skirmisher — Swift Boots + Wide Reach + Killing Blow; the blink is ' +
    'free and the purifying burst lands on arrival, so retreating IS the attack',
  ],
};

const UNIT_09 = {
  id: 'unit_09',
  name: 'Unit-09 "AI-chan"',
  epithet: 'Super A.I.',
  rarity: 4,
  archetype: 'Stream Overlay',
  element: 'lightning',
  visual: { shape: 'capsule', color: '#ff9ecb', accent: '#ffffff', emoji: '🤖', size: 16 },
  stats: {
    hp: 90, armor: 0, moveSpeed: 176, pickupRadius: 48,
    damageMult: 1.0, attackSpeedMult: 1.05, areaMult: 1.0,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 0,
  },
  autoAttack: {
    id: 'channel_beam', name: 'Channel Beam',
    desc: 'Alternating left/right bolts from her ribbon-ears, 13 damage, pierce 1, ' +
          'every 0.5s. Perfectly accurate, every time, forever.',
    interval: 0.5, damage: 13, targeting: { mode: 'nearest' },
  },
  special: {
    id: 'super_ai_mode', name: 'SUPER A.I. MODE', cooldown: 22,
    desc: 'For 6s your fire rate DOUBLES and every shot splits into 3 on impact. ' +
          'You take +25% damage for the duration. The subscriber counter spins.',
  },
  escape: {
    id: 'error', name: 'ERROR!', cooldown: 6, iframes: 0.7,
    desc: 'She blue-screens: 0.7s invulnerable, then a 160px burst of corrupted ' +
          'data for 50 damage and a 1.5s stun. She apologises to chat afterwards.',
  },
  passive: {
    id: 'firmware_update', name: 'Firmware Update',
    desc: 'Every level-up permanently grants +2% attack speed for the rest of ' +
          'the run. It stacks forever.',
  },
  starUpgrades: {
    s3: 'SUPER A.I. MODE no longer applies the +25% damage-taken penalty.',
    s5: 'ERROR! also disables enemy ranged attacks for 4s.',
  },
  signatureRelic: 'singularity_patch',
  barks: {
    spawn: 'Hai domo! Super A.I. detected! It is me!',
    levelUp: 'My intelligence is increasing! Allegedly!',
    lowHp: 'Chat? CHAT. Do something. Please.',
    kill: 'Target eliminated! I calculated that! Mostly!',
    boss: 'Scanning... it is very big and I do not like it!',
    defeat: "I didn't lose, I froze! Buffering! Buffering!",
  },
  buildPaths: [
    'Fire-rate stack — Rapid Fire + Scholar; Firmware Update turns every level-up ' +
    'into a permanent buff, so XP gain compounds into attack speed',
    'Buff hoarder — Singularity Patch + Bento pickups + Momentum; at 6 simultaneous ' +
    'buffs the Patch adds a flat +30% damage and she glows hot pink',
  ],
};

// ---------------------------------------------------------------------------
//                       5-STAR ROSTER (Ultra Rare)
// ---------------------------------------------------------------------------

const RIN = {
  id: 'rin',
  name: 'Rin',
  epithet: 'Breath of the Rising Sun',
  rarity: 5,
  archetype: 'Breathing Swordsman',
  // Water baseline; HINOKAMI KAGURA converts his damage to fire for its duration.
  // Under DECISIONS.md §26 that conversion is literal, not cosmetic — the whole
  // palette shifts blue -> orange and the element matchups flip with it.
  element: 'water',
  visual: { shape: 'capsule', color: '#2e7d64', accent: '#7a1f2b', emoji: '🌊', size: 16 },
  stats: {
    hp: 120, armor: 0, moveSpeed: 174, pickupRadius: 46,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.0,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 0,
  },
  autoAttack: {
    id: 'water_surface_slash', name: 'First Form: Water Surface Slash',
    desc: 'A flowing crescent wave that travels 180px and pierces 3, ' +
          '30 damage every 0.7s.',
    interval: 0.7, damage: 30, targeting: { mode: 'facingAuto' },
  },
  special: {
    id: 'hinokami_kagura', name: 'HINOKAMI KAGURA: DANCE OF THE FIRE GOD', cooldown: 24,
    desc: 'Drops into the Sun Breathing stance and dances for 3s, carving rings ' +
          'of flame: 25 damage per tick, 8 ticks, 240px radius. Immune to knockback ' +
          'and slows, and everything hit burns for 4s.',
  },
  escape: {
    id: 'water_wheel', name: 'Second Form: Water Wheel', cooldown: 5, iframes: 0.5,
    desc: 'A forward cartwheel 200px with full i-frames, carving a water wheel ' +
          'that deals 45 damage along the entire path.',
  },
  passive: {
    id: 'total_concentration', name: 'Total Concentration Breathing',
    // The SUNLIT EDGE evolution REPLACES this bonus rather than stacking
    // (DECISIONS.md §12): Rin takes the evolution's 8x instead of his 2.2x.
    desc: 'Stand still for 1.0s and your next auto-attack deals +120% damage and ' +
          'pierces infinitely. Hold still. Breathe. Swing.',
  },
  starUpgrades: {
    s3: 'Dance of the Fire God lasts 5s and pulls enemies inward.',
    // "healing water trail" has no number in the spec; 3 HP/s for 4s authored to
    // sit just under Rei's 4 HP/s aura, which is her signature.
    s5: 'Water Wheel gains 2 charges and leaves a healing water trail: 3 HP/s for 4s.',
  },
  signatureRelic: 'nichirin_blade_crimson',
  barks: {
    spawn: "I'm sorry. I'll make this quick.",
    levelUp: 'My breathing settled. Thank you for that.',
    lowHp: 'Get up. Get up. You promised her.',
    kill: 'Rest now. You were someone, once.',
    boss: "You smell sad. I'm still going to stop you.",
    victory: 'Everyone got home. That was the whole point.',
  },
  buildPaths: [
    'Rhythm sniper — Piercing Will + Sharp Edge + Long Haul; stand still, breathe, ' +
    'and delete a whole column with one infinitely-piercing +120% swing',
    'Sun dancer — Quick Recovery + Wide Reach + Iron Body; the 240px fire dance ' +
    'is unstoppable, so build for uptime and walk through the horde',
  ],
};

const NITEN = {
  id: 'niten',
  name: 'Niten',
  epithet: 'The Sword Saint',
  rarity: 5,
  archetype: 'Lone Ronin',
  element: 'steel',
  visual: { shape: 'capsule', color: '#2a2622', accent: '#b0271f', emoji: '⚔️', size: 17 },
  stats: {
    hp: 110, armor: 1, moveSpeed: 170, pickupRadius: 42,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.0,
    critChance: 0.10, critMult: 2.2, cooldownMult: 1.0, luck: 0,
  },
  autoAttack: {
    id: 'niten_ichiryu', name: 'Niten Ichi-ryū',
    desc: 'Alternates two strikes every 0.6s. Odd swings: the LONG SWORD, a 150° ' +
          'arc for 26 damage at 110px. Even swings: the SHORT SWORD, a thrust for ' +
          '18 damage that pierces 3 at 70px. Several upgrades touch only one of them.',
    interval: 0.6, damage: 26, targeting: { mode: 'facing' },
  },
  special: {
    id: 'battle_of_ichijoji', name: 'THE BATTLE OF ICHIJŌJI', cooldown: 28,
    desc: 'Plants himself in a counter-stance for 6s. Every enemy that steps into ' +
          'melee is cut down automatically for 90 damage, with a crescent that ' +
          'carries 200px past them. He cannot move and takes 50% less damage.',
  },
  escape: {
    id: 'the_void', name: 'The Void', cooldown: 7, iframes: 0.4,
    desc: 'A 0.4s PARRY WINDOW, not a dash. Struck during it: zero damage and a ' +
          '360° counter for 200 damage with full knockback. Untouched: he steps ' +
          '120px and the cooldown is halved.',
  },
  passive: {
    id: 'dokkodo', name: 'Dokkōdō (The Way of Walking Alone)',
    // Only entities declaring isMinion:true suppress this (DECISIONS.md §27).
    // Clones, zombies, Deadbeats and the Full Susanoo warrior do. Decoys, rifts,
    // chum piles, torii gates and burning ground do NOT — they are props.
    desc: '+30% damage and +15% dodge while you have no active minions, clones or ' +
          'summons. FULL SUSANOO genuinely turns this off. That is the trade.',
  },
  starUpgrades: {
    s3: 'The Battle of Ichijōji lasts 9s and he can walk at half speed during it.',
    s5: "The Void's parry window widens to 0.7s and a successful parry refunds the " +
        'entire cooldown. Perfect reads mean a permanent guard.',
  },
  signatureRelic: 'two_heavens_as_one',
  barks: {
    spawn: 'Invincible under the sky. Or dead. Either one.',
    levelUp: 'Sharper. Not better. Sharper.',
    lowHp: "I'm bleeding. Good. Then I'm still here.",
    kill: 'One. I count them so I remember them.',
    boss: 'Come. Show me what I am not yet.',
    idle: 'Strong. Strong. Strong. It is all I know how to want.',
  },
  buildPaths: [
    'Alternating crit — Two Heavens As One + Keen Eye + Killing Blow; every second ' +
    'swing already crits, so crit damage doubles his effective rate',
    'Solo wall — Guardian Plate + Iron Body + Phantom Step; Dokkōdō pays +30% ' +
    'damage and +15% dodge for refusing every summon in the game',
  ],
};

const SHIRO_SAME = {
  id: 'shiro_same',
  name: 'Shiro Same',
  epithet: 'The Sharkbite Idol',
  rarity: 5,
  archetype: 'Deep-Sea VTuber',
  element: 'water',
  visual: { shape: 'capsule', color: '#5fd6ff', accent: '#0b3d5c', emoji: '🦈', size: 16 },
  stats: {
    hp: 110, armor: 0, moveSpeed: 172, pickupRadius: 46,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.0,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 0,
  },
  autoAttack: {
    id: 'bubble_bullets', name: 'Bubble Bullets',
    desc: 'A fan of 5 bubbles that drift, then POP into 3 shrapnel shards each. ' +
          '10 damage per bubble, 7 per shard, every 0.9s.',
    interval: 0.9, damage: 10, targeting: { mode: 'densestCluster' },
  },
  special: {
    id: 'feeding_frenzy', name: 'FEEDING FRENZY', cooldown: 26,
    desc: 'Submerges into a shadow fin and dashes across the arena 6 times over 4s. ' +
          'Each dash deals 80 damage in a wide line and heals 5 HP per enemy hit. ' +
          'Invulnerable throughout.',
  },
  escape: {
    id: 'riptide', name: 'Riptide', cooldown: 6, iframes: 0.5,
    desc: 'Dashes 210px, dragging every enemy she passes along behind her, then ' +
          'flinging them. Sets up every AoE in the game.',
  },
  passive: {
    id: 'blood_in_the_water', name: 'Blood in the Water',
    desc: '+35% damage to enemies below 40% HP.',
  },
  starUpgrades: {
    // The whirlpool has no numbers in the spec. 200px / 20 damage per 0.5s for 5s
    // authored at a fifth of Reika's Iron Sand vortex (her entire special), so a
    // tail-end effect never outshines a dedicated one.
    s3: 'Feeding Frenzy gains 3 extra dashes and ends in a 200px whirlpool that ' +
        'drags enemies inward for 20 damage every 0.5s over 5s.',
    s5: 'Riptide applies BLEED (2% max HP/s for 4s) to everything it drags.',
  },
  signatureRelic: 'chum_bucket',
  barks: {
    spawn: 'A! ...that means hello. Chomp chomp!',
    levelUp: 'Ooh, shiny! Mine now.',
    lowHp: "Sharks don't cry! That's just seawater!",
    kill: 'Did I do that? I DID that! Bloop!',
    boss: "It's so BIG. Do I bite the top or the bottom?",
    idle: 'I do have a trident. Mostly I use it for snacks.',
  },
  buildPaths: [
    'Shrapnel scaling — Extra Shot + Wide Reach + Piercing Will; 5 bubbles become ' +
    '8, and every one of them is worth 3 more shards',
    'Execute bruiser — Bloodthirst + Killing Blow + Chum Bucket; herd them into a ' +
    'pile and dive on everything under 40% for +35%',
  ],
};

const REIKA = {
  id: 'reika',
  name: 'Reika',
  epithet: 'The Level 5 Railgun Esper',
  rarity: 5,
  archetype: 'Electromaster',
  element: 'lightning',
  visual: { shape: 'capsule', color: '#e8862c', accent: '#7ad9ff', emoji: '⚡', size: 16 },
  stats: {
    hp: 100, armor: 0, moveSpeed: 172, pickupRadius: 46,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.0,
    critChance: 0.06, critMult: 2.0, cooldownMult: 1.0, luck: 0,
  },
  autoAttack: {
    id: 'railgun', name: 'Coin Flick / RAILGUN',
    desc: 'Flicks a coin, then fires a hitscan orange beam that pierces EVERYTHING ' +
          'across the full screen for 85 damage. Slow — every 1.6s — and it leaves ' +
          'an ionised trail that arcs for 1s.',
    interval: 1.6, damage: 85,
    // The line through the most enemies, resolved by a spatial-hash line sweep
    // (DECISIONS.md §16).
    targeting: { mode: 'lineDensest' },
  },
  special: {
    id: 'iron_sand_storm', name: 'IRON SAND STORM', cooldown: 28,
    // Placed at the cursor; with no aim input (gamepad/touch/auto-aim) it defaults
    // to the densest cluster in range via aimVector() (DECISIONS.md §17).
    desc: 'A 220px magnetic sand vortex at your cursor for 6s: 30 damage every ' +
          '0.3s, dragging enemies inward the whole time.',
  },
  escape: {
    id: 'magnetic_repulsion', name: 'Magnetic Repulsion', cooldown: 7, iframes: 0.6,
    desc: 'Hurls every enemy within 300px violently away for 40 damage and slides ' +
          'you 150px backward.',
  },
  passive: {
    id: 'static_field', name: 'Static Field',
    desc: 'Every 3s, chain lightning arcs from you to up to 5 nearby enemies for ' +
          '20 damage each.',
  },
  starUpgrades: {
    // "smaller" is the spec's only word for it; 140px / 20 damage per 0.3s / 4s
    // is the first vortex scaled to roughly two-thirds size and duration.
    s3: 'Iron Sand Storm spawns a second 140px vortex where the first expires: ' +
        '20 damage every 0.3s for 4s.',
    s5: 'Magnetic Repulsion also reflects every enemy projectile it catches.',
  },
  signatureRelic: 'level_5_clearance',
  barks: {
    spawn: 'Level 5. Third strongest. Wanna see why?',
    levelUp: 'More voltage. Obviously.',
    lowHp: 'Do NOT call me a kid right now.',
    kill: 'One yen. That is all you cost me.',
    boss: "Big talk. I've fried bigger. Probably.",
    idle: 'The frog keychain is ironic. Drop it.',
  },
  buildPaths: [
    'Screen deleter — Level 5 Clearance + Piercing Will + Long Haul; +12% damage ' +
    'per enemy already pierced is uncapped, so aim down the longest line',
    'Static bruiser — Rapid Fire + Keen Eye + Second Wind; the 1.6s railgun is slow, ' +
    'so let the passive chain carry the chaff while you charge',
  ],
};

const NEKROMINA = {
  id: 'nekromina',
  name: 'Nekromina',
  epithet: 'The Grave Idol',
  rarity: 5,
  archetype: 'Necro Rapper',
  element: 'shadow',
  visual: { shape: 'capsule', color: '#ff5f8f', accent: '#8b0f2a', emoji: '💀', size: 16 },
  stats: {
    hp: 105, armor: 0, moveSpeed: 170, pickupRadius: 48,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.05,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 0,
  },
  autoAttack: {
    id: 'reapers_rhythm', name: "Reaper's Rhythm",
    desc: 'A 180° scythe arc, 16 damage, 150px reach, every 0.8s, alternating ' +
          'left, right, left, right. It keeps time, because of course it does.',
    interval: 0.8, damage: 16, targeting: { mode: 'aroundSelf' },
  },
  special: {
    id: 'summon_deadbeats', name: 'SUMMON: DEADBEATS', cooldown: 25,
    desc: 'Raises 5 hooded skeleton fans for 15s. 20 damage per hit, 45 HP each, ' +
          'and they inherit 30% of your damage bonuses. They bob in time.',
  },
  escape: {
    id: 'phase_out', name: 'Phase Out', cooldown: 6, iframes: 1.2,
    desc: 'Intangible for 1.2s — walk straight through enemies, immune to ' +
          'everything, +40% move speed. The longest i-frame window in the game, ' +
          'and it deals no damage at all.',
  },
  passive: {
    id: 'necro_harvest', name: 'Necro-Harvest',
    desc: 'Every 25 kills permanently raises a zombie follower for the rest of the ' +
          'run, up to 4. Individually pathetic. Collectively a problem.',
  },
  starUpgrades: {
    s3: 'Deadbeats explode for 60 damage when they expire or die.',
    // "nearby" needed a radius, and the raised Deadbeat needed to be the SAME
    // Deadbeat her special summons — 20 damage per hit, 45 HP, 15s.
    s5: 'Phase Out resurrects one corpse within 200px as a Deadbeat: 20 damage ' +
        'per hit, 45 HP, 15s.',
  },
  signatureRelic: 'grave_idol_mic',
  barks: {
    spawn: "Yo. Death's apprentice, second shift. Let's work.",
    levelUp: 'New bars. Actual bars. The numbers kind.',
    lowHp: 'The paperwork on my own death would be brutal.',
    kill: 'Scythe, mic, same swing. Next.',
    boss: "Big one. Boss'll want that in writing.",
    defeat: "Wrong side of the desk. Cool. That's... cool.",
  },
  buildPaths: [
    'Minion orchestra — Grave Idol Mic + Sharp Edge + Rapid Fire; the cap goes to ' +
    '7 and every minion inherits 30% of your damage stats',
    'Untouchable scythe — Quick Recovery + Phantom Step + Wide Reach; a 1.2s ' +
    'intangible window off a 6s cooldown is the safest kiting tool on the roster',
  ],
};

const HIKARI = {
  id: 'hikari',
  name: 'Hikari',
  epithet: 'Hi-chan, the Phoenix Idol',
  rarity: 5,
  archetype: 'Phoenix Idol',
  element: 'fire',
  visual: { shape: 'capsule', color: '#ff7a2f', accent: '#ffd24a', emoji: '🪶', size: 16 },
  stats: {
    hp: 115, armor: 0, moveSpeed: 172, pickupRadius: 46,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.05,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 0,
  },
  autoAttack: {
    id: 'feather_flare', name: 'Feather Flare',
    desc: '4 burning feathers arc out and stick into the ground: 18 on impact, ' +
          'then a 60px pool burning for 10/s over 3s. Every 1.0s.',
    interval: 1.0, damage: 18, targeting: { mode: 'densestCluster' },
  },
  special: {
    id: 'rebirth_nova', name: 'REBIRTH NOVA', cooldown: 27,
    desc: 'Detonates in a 320px fire nova for 220 damage, then heals 25% of max HP ' +
          'over 3s. Everything caught in it burns.',
  },
  escape: {
    id: 'ember_dash', name: 'Ember Dash', cooldown: 5, iframes: 0.5,
    desc: 'A 200px dash with full i-frames, leaving a fire trail that deals ' +
          '15 damage/s for 3s.',
  },
  passive: {
    id: 'undying', name: 'Undying',
    // First in the revive resolution order, hard-capped at 3 revives per run
    // (DECISIONS.md §29).
    desc: 'Once per run, lethal damage instead revives you at 50% HP with a free ' +
          'Rebirth Nova and 2s of invulnerability. Learn the boss the fun way.',
  },
  starUpgrades: {
    // The spec gives the 6s and no damage. 20/s in the nova's own 320px radius —
    // above her 10/s feather pools and 15/s dash trail, because this one costs a
    // 27s special.
    s3: 'Rebirth Nova leaves a 320px burning field for 6s dealing 20 damage/s.',
    s5: "Ember Dash's fire trail chases the nearest enemy.",
  },
  signatureRelic: 'ashes_of_the_eternal_encore',
  barks: {
    spawn: 'Kikkeriki! Order up: one horde, extra crispy!',
    levelUp: "Encore! And I haven't even died once today!",
    lowHp: "It's FINE! Dying is a Tuesday for me!",
    kill: 'NEXT! The line is long and I am very fast!',
    boss: 'Ooh, a big one! Staff, line up behind me!',
    defeat: 'See you in ten minutes. I always come back.',
  },
  buildPaths: [
    'Burn field — Wide Reach + Sharp Edge + Quick Recovery; feather pools, nova ' +
    'field and dash trail all overlap into one permanent carpet of fire',
    'Second-life aggro — Ashes of the Eternal Encore + Second Chance + Bloodthirst; ' +
    'die on purpose, come back at +100% damage for 10s, delete the room',
  ],
};

// AKANE MOVED TO THE 6-STAR BLOCK — see the promotion note down there.

const KIRA = {
  id: 'kira',
  name: 'Kira',
  epithet: 'The God of the New World',
  rarity: 5,
  archetype: 'Administrator',
  element: 'shadow',
  visual: { shape: 'capsule', color: '#1a1a22', accent: '#c8102e', emoji: '📓', size: 16 },
  stats: {
    // Damage stats are near-decorative on him by design — the death timer ignores
    // enemy HP entirely. Attack speed (write rate) is his ONLY scaling stat, and
    // spec lines 790-795 say to protect that identity in balancing.
    hp: 90, armor: 0, moveSpeed: 168, pickupRadius: 46,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.0,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 1,
  },
  autoAttack: {
    id: 'write_the_name', name: 'Write the Name',
    // `damage` is the boss/elite fallback, not chip damage: written enemies die
    // outright, so there is no HP number to scale against.
    desc: 'Writes one name every 0.6s. The nearest unmarked enemy gets a 3s ' +
          'countdown, then DIES — whatever its HP. Bosses and elites cannot be ' +
          'written; they take 400 damage when the timer resolves instead.',
    interval: 0.6, damage: 400, targeting: { mode: 'nearest', filter: 'unmarked' },
  },
  special: {
    id: 'shinigami_eyes', name: 'SHINIGAMI EYES', cooldown: 30,
    desc: 'For 8s every pending timer resolves INSTANTLY, his write rate triples, ' +
          'and names apply in a 200px radius instead of one at a time. ' +
          'Costs 25% of your current HP the moment it is cast.',
  },
  escape: {
    id: 'just_as_planned', name: 'Just As Planned', cooldown: 7, iframes: 1.5,
    desc: 'He steps back, adjusts his cuffs, and is simply no longer a suspect. ' +
          '1.5s untargetable — enemies lose him and wander — and every enemy that ' +
          'was tracking him is marked with a death timer.',
  },
  passive: {
    id: 'a_god_must_be_just', name: 'A God Must Be Just',
    desc: 'Every enemy killed by a death timer grants a permanent +0.5% write ' +
          'speed for the rest of the run. Uncapped. He only accelerates.',
  },
  starUpgrades: {
    s3: 'Shinigami Eyes lasts 12s and its HP cost drops to 10%.',
    s5: 'Just As Planned also resets every marked enemy\'s timer to zero.',
  },
  signatureRelic: 'potato_chip_gambit',
  barks: {
    spawn: "I'll take it from here. Quietly.",
    levelUp: 'All according to plan. Naturally.',
    lowHp: 'This was also part of the plan. Mostly.',
    kill: 'Heart attack. Nothing suspicious about that.',
    boss: "It has a name. It doesn't know I have it yet.",
    victory: 'Someone had to be justice. It may as well be me.',
    idle: "I'll take one potato chip... and eat it.",
  },
  // The balance harness measures him on kills/sec, not DPS — his timers report as
  // infinite DPS otherwise (spec line 1664, DECISIONS.md §36). Declared, not branched.
  metric: 'killsPerSecond',
  buildPaths: [
    'Pure throughput — Rapid Fire + Quick Recovery + Swift Boots; write rate is ' +
    'his only real stat and Sharp Edge does literally nothing for him',
    'Mass marking — Potato Chip Gambit + Extra Shot + cooldown reduction; six names ' +
    'per write and Shinigami Eyes up as often as possible',
  ],
};

const YUKINE = {
  id: 'yukine',
  name: 'Yukine',
  epithet: 'The Chief Executive Fox',
  rarity: 5,
  archetype: 'Corporate Kitsune',
  // White-blue foxfire, deliberately NOT Kagura's orange spirit-fire: this fox
  // is the bright, commercial, on-brand one and her element says so.
  element: 'light',
  visual: { shape: 'capsule', color: '#eaf4ff', accent: '#3fb6c8', emoji: '🦊', size: 16 },
  stats: {
    hp: 100, armor: 0, moveSpeed: 176, pickupRadius: 54,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.05,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 2,
  },
  autoAttack: {
    id: 'three_tail_flourish', name: 'Three-Tail Flourish',
    desc: 'She spins once. The tail sweeps a 170px ring for 18 damage, then ' +
          '3 lines of white foxfire run out along the floor 120° apart, ' +
          '420px long, for 14 each. Every 0.9s.',
    interval: 0.9, damage: 18, targeting: { mode: 'aroundSelf' },
  },
  special: {
    id: 'terms_and_conditions', name: 'TERMS AND CONDITIONS', cooldown: 26,
    desc: 'Drops a 320px contract zone for 10s. Everything standing in it signs: ' +
          '+40% damage taken, and every 0.5s the deal pays her 0.6 HP per ' +
          'signatory. Signing is not optional and she will not explain clause four.',
  },
  escape: {
    id: 'tail_swap', name: 'Tail Swap', cooldown: 6, iframes: 0.6,
    desc: 'Blinks 220px and leaves her tail behind. It taunts everything within ' +
          '260px for 3s, burns everything within 110px for 18 damage/s, then ' +
          'detonates for 70 damage in a 140px radius.',
  },
  passive: {
    id: 'three_streams', name: 'Three Streams',
    desc: 'She runs three shows at once. Every 15s another tail lights, up to 3. ' +
          'Each lit tail is +8% attack speed, +8% area, and 6 damage/s to ' +
          'everything within 90px. One hit worth 20% of your max HP snuffs one out.',
  },
  starUpgrades: {
    s3: 'TERMS AND CONDITIONS runs 14s at +55% damage taken and pays 1.2 HP per signatory.',
    s5: 'Tail Swap leaves 2 tails, and each detonation grows to 120 damage in a 200px radius.',
  },
  signatureRelic: 'exclusive_contract',
  barks: {
    spawn: 'Kon-kon! Great turnout today. Shall we monetise it?',
    levelUp: 'Growth! Sustainable growth! I love that for us!',
    lowHp: "This is a temporary dip. Temporary. Look at the trend line.",
    kill: 'And that is why you read the contract. Bye~!',
    boss: 'Ooh, a big account. I want this one. I WANT this one.',
    victory: 'Great numbers, great vibes, great everyone. Same time tomorrow?',
    idle: 'One tail. ONE. It is plenty. I am extremely efficient.',
  },
  buildPaths: [
    'Contract stacker — Wide Reach + Quick Recovery + Exclusive Contract; the ' +
    'zone is the whole kit, so make it bigger and put it down more often',
    'Three-tail engine — Iron Body + Guardian Plate + Rapid Fire; every tail you ' +
    'keep lit is +8% attack speed and 6 damage/s, and tails die to big hits',
  ],
};

const WREN = {
  id: 'wren',
  name: 'Wren',
  epithet: 'The Diligent Apprentice',
  rarity: 5,
  archetype: 'Precision Caster',
  element: 'lightning',
  visual: { shape: 'capsule', color: '#c3a8ff', accent: '#f4f1ea', emoji: '📐', size: 15 },
  stats: {
    hp: 95, armor: 0, moveSpeed: 174, pickupRadius: 46,
    damageMult: 1.0, attackSpeedMult: 1.05, areaMult: 0.95,
    critChance: 0.06, critMult: 2.0, cooldownMult: 1.0, luck: 0,
  },
  autoAttack: {
    id: 'flawless_repetition', name: 'Flawless Repetition',
    desc: '2 homing bolts every 0.45s, 12 damage each, pierce 1. Every volley ' +
          'that kills something adds a bolt to the next one, up to 6; a volley ' +
          'that kills nothing drops straight back to 2.',
    interval: 0.45, damage: 12, targeting: { mode: 'nearestN', count: 2 },
  },
  special: {
    id: 'perfect_marks', name: 'PERFECT MARKS', cooldown: 24,
    desc: 'For 5s she stops holding back: 6 bolts per second, 22 damage each, ' +
          'pierce 2, cycling one at a time through the 8 nearest enemies so ' +
          'nothing is ever over-killed. 30 bolts, none of them wasted.',
  },
  escape: {
    id: 'textbook_form', name: 'Textbook Form', cooldown: 5, iframes: 0.6,
    desc: 'The defensive drill, performed exactly as written: 0.6s invulnerable, ' +
          'a 170px reposition, and the barrier shatters outward into 8 shards ' +
          'for 30 damage each.',
  },
  passive: {
    id: 'mana_discipline', name: 'Mana Discipline',
    desc: 'Every 5s without taking damage grants a stack of FORM: +6% attack ' +
          'speed and +4% damage each, up to 6 stacks. Taking a hit removes one ' +
          'stack, not all of them.',
  },
  starUpgrades: {
    s3: 'PERFECT MARKS lasts 8s and every bolt pierces 4 instead of 2.',
    s5: 'Textbook Form also grants a shield that blocks the next 2 hits.',
  },
  signatureRelic: 'annotated_manual',
  barks: {
    spawn: 'I have already prepared. You do not need to ask.',
    levelUp: 'Noted. That was overdue.',
    lowHp: 'This is inconvenient. I will manage.',
    kill: 'Correct. Next.',
    boss: 'Large. Slow. Predictable. ...I see.',
    victory: 'That took eleven minutes. It should have taken nine.',
    idle: 'I am not sulking. I am waiting. There is a difference.',
  },
  buildPaths: [
    'Kill chain — Killing Blow + Sharp Edge + Rapid Fire; every volley that kills ' +
    'grows the next one, so the build is about never letting the chain break',
    'Untouched form — Guardian Plate + Phantom Step + Quick Recovery; 6 stacks of ' +
    'FORM is +36% attack speed and +24% damage for simply not getting hit',
  ],
};

const BRANT = {
  id: 'brant',
  name: 'Brant',
  epithet: 'The Coward Who Never Runs',
  rarity: 5,
  archetype: 'Frightened Berserker',
  element: 'steel',
  visual: { shape: 'capsule', color: '#c8452c', accent: '#4a5568', emoji: '🪓', size: 17 },
  stats: {
    hp: 145, armor: 1, moveSpeed: 168, pickupRadius: 44,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.1,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 0,
  },
  autoAttack: {
    id: 'two_handed_swing', name: 'Two-Handed Swing',
    desc: 'An enormous overhead chop: a 120° arc at 130px reach for 52 damage ' +
          'with 260px of knockback, every 1.1s. The slowest auto-attack in the ' +
          'game. With 3 or more enemies already inside the arc it hits 25% ' +
          'harder, because that is the point he stops thinking.',
    interval: 1.1, damage: 52, targeting: { mode: 'facing' },
  },
  special: {
    id: 'hold_the_line', name: 'HOLD THE LINE', cooldown: 22,
    desc: 'He plants his feet and screams. For 6s everything within 300px is ' +
          'taunted onto him and he takes 60% less damage — and every point that ' +
          'gets through is stored. It ends in one swing: 250 damage plus 3x ' +
          'everything he absorbed, in a 260px arc.',
  },
  escape: {
    id: 'flinch', name: 'Flinch', cooldown: 4, iframes: 0.5,
    desc: 'He does not mean to. A 170px panic hop away from the nearest threat ' +
          'with full i-frames, and he swings wildly on the way down for 60 ' +
          'damage in a 140px radius. The shortest escape cooldown on the roster.',
  },
  passive: {
    id: 'braver_than_he_looks', name: 'Braver Than He Looks',
    desc: 'Up to +50% damage as his HP drops, scaling smoothly from +0% at full ' +
          'to +50% at 1 HP. Dropping under 30% HP makes him scream: everything ' +
          'within 240px is thrown 400px back and slowed 40% for 2s, once every 15s.',
  },
  starUpgrades: {
    s3: 'HOLD THE LINE lasts 9s and returns the stored damage at 4x instead of 3x.',
    s5: "Flinch's landing swing grows to 110 damage in a 200px radius and leaves " +
        'a shield that blocks the next 1 hit.',
  },
  signatureRelic: 'chipped_greataxe',
  barks: {
    spawn: "There's too many. There's TOO MANY. ...okay. Okay!",
    levelUp: 'Stronger. Good. I still hate this.',
    lowHp: "I'm not crying, I'm LEAKING! Leave me alone!",
    kill: "Sorry! Sorry — that was me. I did that. Sorry!",
    boss: "Nope. Nope nope nope. ...fine. FINE. COME ON THEN.",
    victory: "Is it over? Is it actually over? I need to sit down.",
    idle: "I'm not scared. I'm appropriately informed.",
  },
  buildPaths: [
    'Absorb and answer — Iron Body + Guardian Plate + Second Wind; HOLD THE LINE ' +
    'pays 3x everything you eat, so eat as much as you can survive',
    'Cornered animal — Bloodthirst + Vengeance + Sharp Edge; Braver Than He Looks ' +
    'is +50% damage at 1 HP, so the build is staying exactly that scared',
  ],
};

// ---------------------------------------------------------------------------
//                      6-STAR ROSTER (Limited / UR)
//
// Seven, not five. Akane was promoted out of the ★5 bracket and Usaki was
// authored straight into this one; both sit at the BOTTOM of the block rather
// than in alphabetical or thematic order, because the five above them are the
// launch ★6s and keeping their order stable keeps every banner, save file and
// screenshot that already exists honest.
//
// The ★6 floor this bracket is priced against, read off the five below:
//   130-150 HP, 1 armor, at least one stat multiplier above 1.0, and a passive
//   that COMPOUNDS over a run rather than paying a flat bonus. Aoi is the one
//   ★6 with no armour and her own card says so out loud, so a promotion has to
//   buy the plate rather than borrow her exception.
// ---------------------------------------------------------------------------

const SOVEREIGN_ALICIA = {
  id: 'sovereign_alicia',
  name: 'Sovereign Alicia',
  epithet: 'The Dragon Queen Who Streams',
  rarity: 6,
  archetype: 'Broadcast Dragon',
  element: 'fire',
  visual: { shape: 'capsule', color: '#ffb020', accent: '#e0452c', emoji: '🐉', size: 17, glow: true },
  stats: {
    hp: 140, armor: 1, moveSpeed: 176, pickupRadius: 50,
    damageMult: 1.05, attackSpeedMult: 1.0, areaMult: 1.05,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 1,
  },
  autoAttack: {
    id: 'dragonfang_volley', name: 'Dragonfang Volley',
    desc: '3 seeking dragon-heads that curve aggressively into their targets, ' +
          '32 damage each, every 1.0s.',
    interval: 1.0, damage: 32, targeting: { mode: 'nearestN', count: 3 },
  },
  special: {
    id: 'apotheosis', name: 'APOTHEOSIS', cooldown: 35,
    desc: 'Becomes a full dragon for 8s: 2.2x size, immune to knockback, ' +
          '+50% move speed, -40% damage taken, and the auto-attack is REPLACED ' +
          'by a 300px breath cone dealing 70 damage/s that applies burn.',
  },
  escape: {
    id: 'wingbeat', name: 'Wingbeat', cooldown: 7, iframes: 1.2,
    desc: 'Flies for 1.2s — invulnerable, passing over everything, +80% move speed ' +
          '— and lands with a gust dealing 90 damage in a 200px radius.',
  },
  passive: {
    id: 'hoard', name: 'Hoard',
    desc: 'Every 100 gold collected this run grants a permanent +1% damage for ' +
          'the rest of the run.',
  },
  starUpgrades: {
    // Two problems with the spec's "stacking armor shred": it carries no number,
    // and NO enemy or boss in the game has an `armor` stat, so a flat shred would
    // be a no-op on every target. Authored as a vulnerability stack instead —
    // the `vuln` status the damage pipeline already applies — and the card says
    // exactly what it does.
    s3: 'Apotheosis lasts 4s longer and its breath applies ARMOR SHRED: ' +
        '+5% damage taken per stack, up to 5 stacks, refreshed for 6s.',
    s5: "Wingbeat's landing gust becomes a meteor strike for 250 damage.",
  },
  signatureRelic: 'crown_of_the_world_eater',
  barks: {
    spawn: 'Goood morning! Top story: all of you, deceased.',
    levelUp: "That's the sound of the numbers going UP, baby!",
    lowHp: 'Do you have ANY idea what this outfit cost?!',
    kill: "Breaking news: it's dead. More after the break.",
    boss: 'Big guest on the show tonight! Roll the fire!',
    victory: "Show's over! Hit subscribe. I said HIT IT.",
  },
  /**
   * THE DRAGON. `special` says what APOTHEOSIS DOES; this says what she IS while
   * it runs, and it is a declared field for exactly the reason Han's RAGE bar
   * and Kira's balance metric are: nothing outside src/data/ may know her id, so
   * the renderer has to be handed the second silhouette rather than look it up.
   *
   * She is the only character in the game who becomes a different creature, and
   * until this field existed there was nowhere for that to live — the form was
   * her own 17px capsule at `sizeMult` 2.2, which reads as a large woman rather
   * than as a dragon. Her card promised a transformation the art could not keep.
   *
   * Three things are deliberately NOT here. Duration, size and the damage
   * numbers stay in the ability: they are balance, they already exist there, and
   * a second copy of 2.2 in a content file is a number that will eventually
   * disagree with the one that actually applies. Only the appearance is data.
   *
   * `visual.pixel` is joined at boot from sprites.js keyed on `spriteId` — not
   * on her own id, because the atlas keys sprites on the descriptor id and
   * reusing hers would silently hand back the human. index.js publishes this
   * visual through allVisuals(), which is load-bearing rather than tidy: the
   * alternative is rasterising a 2.2x sprite on the single frame the screen is
   * already whiting out, dimming the arena and pulling the camera to 0.9.
   */
  altForm: {
    // The ability whose duration this form lasts for. The join is by id in both
    // directions so neither half can be renamed without the other noticing.
    id: 'apotheosis',
    name: 'Dragon Form',
    spriteId: 'sovereign_alicia_dragon',
    visual: { shape: 'capsule', color: '#e0452c', accent: '#ffd76a', emoji: '🐲', size: 17, glow: true },
  },
  buildPaths: [
    'Greed dragon — Cursed Coin + Four-Leaf + Lodestone; Hoard converts gold into ' +
    'permanent damage, so gold gain is a damage upgrade with extra steps',
    'Crowned bruiser — Crown of the World-Eater + Guardian Plate + Second Wind; ' +
    'stay above 80% HP for a flat +35% all damage and never dip',
  ],
};

const SORA = {
  id: 'sora',
  name: 'Sora',
  epithet: 'The Boy Who Fell From The Sky',
  rarity: 6,
  archetype: 'Ki Martial Artist',
  element: 'light',
  visual: { shape: 'capsule', color: '#ff7a1a', accent: '#2f6ff0', emoji: '☁️', size: 16, glow: true },
  stats: {
    hp: 150, armor: 1, moveSpeed: 180, pickupRadius: 48,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.0,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 0,
  },
  autoAttack: {
    id: 'rapid_fist', name: 'Rapid Fist',
    // `damage` is one punch; the last punch of a volley lands 48 instead. Both
    // are priced for a LINE, not the cone this used to be — see star6.js.
    desc: 'Straight ki punches down one line, alternating fists — two at first, four ' +
          'once it evolves, and the gap between them closes as it levels until they ' +
          'land as one. 22 a hit, 48 on the last. Damage grows +4% per upgrade taken ' +
          'this run, uncapped. Early-run wet noodle, late-run disaster.',
    interval: 0.9, damage: 22, targeting: { mode: 'facing' },
  },
  special: {
    id: 'spirit_bomb', name: 'SPIRIT BOMB', cooldown: 32,
    desc: 'Charges 1.5s — immobile and vulnerable, the arena dims, motes stream in ' +
          '— then hurls it at the largest cluster: 400 damage in a 300px blast, ' +
          '+25 damage for every character you own. Your whole roster flashes ' +
          'around the blast for one frame.',
  },
  escape: {
    id: 'ultra_instinct', name: 'ULTRA INSTINCT', cooldown: 9, iframes: 1.8,
    desc: '1.8s of total invulnerability and no movement bonus whatsoever. He ' +
          'stands perfectly still, eyes silver, and simply is not hit. ' +
          "That's the move.",
  },
  passive: {
    id: 'zenkai', name: 'Zenkai',
    desc: 'Every level-up offers 4 upgrades instead of 3, with one free reroll. ' +
          'Each time you drop below 25% HP you permanently gain +12% damage for ' +
          'the run, up to 5 stacks.',
  },
  starUpgrades: {
    s3: 'Spirit Bomb charges in 0.8s and its blast grows to 420px.',
    s5: 'Ultra Instinct fully heals you the first time it is used each run.',
  },
  signatureRelic: 'kaioken',
  barks: {
    spawn: "Whoa, there's a ton of you! This'll be fun!",
    levelUp: 'Ooh! I felt that one. Stronger!',
    lowHp: "Okay. Okay! NOW it's a real fight.",
    kill: 'Aw, already? I was just warming up.',
    boss: "Whoa... you're strong! I'm getting excited!",
    victory: "Good fight! Hey, you hungry? I'm starving.",
  },
  buildPaths: [
    'Upgrade glutton — Scholar + Zenkai rerolls; Rapid Fist gains +4% per upgrade ' +
    'TAKEN, so quantity of upgrades beats quality of upgrades',
    'Kaio-ken loop — Kaio-ken + Quick Recovery + Bloodthirst; every escape becomes ' +
    '+50% damage and +30% attack speed at the cost of 10% max HP',
  ],
};

const HAN = {
  id: 'han',
  name: 'Han',
  epithet: 'The Reluctant Successor',
  rarity: 6,
  archetype: 'Rage Successor',
  element: 'light',
  visual: { shape: 'capsule', color: '#8f5fd6', accent: '#ffd84a', emoji: '📘', size: 15, glow: true },
  stats: {
    hp: 145, armor: 1, moveSpeed: 172, pickupRadius: 46,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.0,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 0,
  },
  autoAttack: {
    id: 'masenko', name: 'Masenko',
    desc: 'A two-handed beam from the forehead that pierces everything in a line ' +
          'for 40 damage, every 0.85s. Clean, efficient, unglamorous.',
    interval: 0.85, damage: 40, targeting: { mode: 'densestCluster' },
  },
  special: {
    id: 'father_son_kamehameha', name: 'FATHER-SON KAMEHAMEHA', cooldown: 34,
    desc: 'Charges 1.2s, then a 160px-wide continuous beam for 2.5s at 120 damage ' +
          'per 0.2s tick. Halfway through, a second spectral pair of hands closes ' +
          'over his: double width and damage. If you also own Sora, the hands are ' +
          'unmistakably his and the bonus is +150% instead of +100%.',
  },
  escape: {
    id: 'great_saiyaman_pose', name: 'Great Saiyaman Pose!', cooldown: 8, iframes: 1.2,
    desc: 'Stops dead and performs an elaborate, deeply embarrassing justice pose ' +
          'over 1.2s. Fully invulnerable throughout, and every enemy within 200px ' +
          'is stunned for 1.5s out of sheer confusion.',
  },
  passive: {
    id: 'hidden_potential', name: 'Hidden Potential',
    desc: 'Taking damage fills RAGE. At 100% he transforms for 15s: +80% damage, ' +
          '+30% move speed, immune to knockback, and Masenko fires twice per ' +
          'volley. The meter empties afterward. He is the only character rewarded ' +
          'for getting hit.',
  },
  starUpgrades: {
    s3: 'Rage fills 40% faster and the transformation lasts 22s.',
    s5: 'Great Saiyaman Pose also fully fills the Rage meter, once every 60s.',
  },
  signatureRelic: 'the_cell_games',
  barks: {
    spawn: "I-I really don't want to do this. ...Okay.",
    levelUp: 'Um. Is that good? It felt good.',
    lowHp: "That's enough. That's... that's ENOUGH.",
    kill: 'Sorry! Sorry. I said sorry, please stay down.',
    boss: 'I have a test tomorrow. Can we be quick?',
    victory: 'Can I go home now? I have homework.',
  },
  // The ONLY resourceBar in the game. The HUD renders any character's declared
  // bar generically rather than branching on id (DECISIONS.md §36).
  resourceBar: { id: 'rage', label: 'RAGE', color: '#ffd34a', max: 100 },
  buildPaths: [
    'Rage engine — Iron Body + Second Wind + Vengeance + The Cell Games; wade in, ' +
    'take the hits on purpose, and live inside the 15s transformation',
    'Beam artillery — Piercing Will + Long Haul + Sharp Edge; Masenko already ' +
    'pierces everything, so line length and raw damage carry the Kamehameha too',
  ],
};

const AOI = {
  id: 'aoi',
  name: 'Aoi',
  epithet: 'The Catastrophe Maid',
  rarity: 6,
  archetype: 'Disaster Idol',
  element: 'water',
  visual: { shape: 'capsule', color: '#7fb6ff', accent: '#f4f1ea', emoji: '🍵', size: 16, glow: true },
  stats: {
    // No armour on purpose: she is the only ★6 with none. Everything about her
    // is fast, loud and structurally unsound.
    hp: 138, armor: 0, moveSpeed: 184, pickupRadius: 50,
    damageMult: 1.0, attackSpeedMult: 1.05, areaMult: 1.05,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 2,
  },
  autoAttack: {
    id: 'flying_saucers', name: 'Flying Saucers',
    desc: '3 saucers thrown in a boomerang arc that hit on the way out AND on ' +
          'the way back, 16 damage a pass, pierce 2, every 0.9s. Every 4th ' +
          'throw she fumbles the whole tray instead: 45 damage in a 90px ' +
          'shatter at her own feet, and 2% of her own max HP — she is never ' +
          'charged for it below 35%.',
    interval: 0.9, damage: 16, targeting: { mode: 'nearest' },
  },
  special: {
    id: 'total_disaster', name: 'OPERATION: TOTAL DISASTER', cooldown: 30,
    desc: 'She pulls the wrong cable. The ceiling comes down for 4s: 9 rig ' +
          'sections land on 0.4s telegraphs for 110 damage in 130px each, and ' +
          'then the main lighting truss lands on HER for 340 damage in a 300px ' +
          'ring. Fully invulnerable throughout, which is the only reason she ' +
          'is still employed.',
  },
  escape: {
    id: 'apology_slide', name: 'Apology Slide', cooldown: 6, iframes: 0.8,
    desc: 'She loses her footing and slides 240px on her face, invulnerable, ' +
          'ploughing everything on the path 300px aside for 40 damage, and ' +
          'finishing in a bow so mortified that everything within 200px is ' +
          'taunted onto her for 2s.',
  },
  passive: {
    id: 'live_and_unedited', name: 'Live and Unedited',
    desc: 'Nothing goes wrong for free. Every fumbled tray and every 12 damage ' +
          'you take adds 1 VIEWER; every 10 viewers is a permanent +5% damage ' +
          'for the rest of the run, up to 20 stacks. The disasters are the show.',
  },
  starUpgrades: {
    s3: 'OPERATION: TOTAL DISASTER drops 14 rig sections instead of 9, and the ' +
        'truss drags everything within 420px inward before it lands.',
    s5: 'Apology Slide leaves a 160px slick of spilled tea for 5s, slowing ' +
        'enemies by 45%.',
  },
  signatureRelic: 'cracked_teacup',
  barks: {
    spawn: "W-welcome home, Master! ...that's the wrong door. Sorry!",
    levelUp: 'I levelled up?! ON PURPOSE?! Ehh?!',
    lowHp: "I'm fine! This is fine! Nothing is on fire! ...that's on fire.",
    kill: 'Sorry sorry sorry — was that yours? Was that yours?!',
    boss: 'Okay. Okay! I have a plan. ...I lied. I have no plan.',
    victory: 'We did it! Somehow! Do NOT ask me how!',
    defeat: "Clip that. Actually — don't. DON'T CLIP THAT.",
    idle: "I dropped the tray again. That's four today. It's not even noon.",
  },
  buildPaths: [
    'Chaos engine — Cracked Teacup + Wide Reach + Quick Recovery; every single ' +
    'thing in the kit is an accident with a radius, so widen all of them',
    'Viewer count — Iron Body + Second Wind + Vengeance; Live and Unedited pays ' +
    'you for taking hits, so stop dodging and start earning',
  ],
};

const MIREL = {
  id: 'mirel',
  name: 'Mirel',
  epithet: 'She Who Counts In Centuries',
  rarity: 6,
  archetype: 'Ordinary Magic Scholar',
  // Spirit is neutral both ways (DECISIONS.md §26), which is exactly right for
  // a mage whose entire thesis is that ordinary magic beats special magic.
  element: 'spirit',
  visual: { shape: 'capsule', color: '#f2f6ff', accent: '#c8a24a', emoji: '🌿', size: 15, glow: true },
  stats: {
    hp: 130, armor: 1, moveSpeed: 170, pickupRadius: 52,
    damageMult: 1.05, attackSpeedMult: 1.0, areaMult: 1.05,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 1,
  },
  autoAttack: {
    id: 'ordinary_offensive_magic', name: 'Ordinary Offensive Magic',
    desc: 'One plain white bolt every 0.5s for 26 damage, pierce 2. The most ' +
          'common attack spell in the world and nothing more. Every 8th bolt ' +
          'she casts without moving her hand: 3x damage, pierces everything, ' +
          'no wind-up at all.',
    interval: 0.5, damage: 26, targeting: { mode: 'nearest' },
  },
  special: {
    id: 'the_collection', name: 'THE COLLECTION', cooldown: 28,
    desc: 'She opens the book. For 10s she casts one random spell from the ' +
          'collection every 0.5s — 20 casts, none of which were ever meant for ' +
          'combat: a field of flowers (heals 8 HP), a spell that removes rust ' +
          '(2% max HP/s bleed for 4s), one that polishes armour (3 shred stacks ' +
          'for 6s), one that turns a patch of ground to sand (65 damage in ' +
          '110px), and one that makes grapes sweeter, which does nothing at all.',
  },
  escape: {
    id: 'mana_suppression', name: 'Mana Suppression', cooldown: 8, iframes: 1.4,
    desc: 'She simply stops registering as a mage. 1.4s untargetable and ' +
          'invulnerable at +30% move speed, and every enemy within 320px that ' +
          'was tracking her stops dead and looks around for 1.2s.',
  },
  passive: {
    id: 'a_long_time_to_practise', name: 'A Long Time To Practise',
    desc: 'Every 80 auto-attack casts this run permanently adds +5% auto-attack ' +
          'damage, uncapped. A thousand years is a great many casts. She is also ' +
          'immune to knockback and slows — none of this is new to her.',
  },
  starUpgrades: {
    s3: 'THE COLLECTION runs 15s (30 casts) and the spell that does nothing is ' +
        'removed from the book.',
    s5: 'Mana Suppression also refunds 50% of THE COLLECTION\'s remaining cooldown.',
  },
  signatureRelic: 'field_of_flowers',
  barks: {
    spawn: "Mm. This will take a moment. Perhaps a decade.",
    levelUp: 'Oh. That is the 4,000th time I have done that.',
    lowHp: "Inconvenient. I had plans for this century.",
    kill: 'It was an ordinary spell. That is rather the point.',
    boss: "I have killed one of these before. ...eighty years ago. Roughly.",
    victory: 'Good. Now, there is a flower I want to see. It blooms in twelve years.',
    idle: 'I collect them. No, they are not useful. Yes, I know.',
  },
  buildPaths: [
    'Ordinary mastery — Sharp Edge + Piercing Will + Long Haul; the auto is the ' +
    'whole character and A Long Time To Practise never stops paying it',
    'The whole book — Field of Flowers + Wide Reach + Quick Recovery; THE ' +
    'COLLECTION is 20 random effects, so more of them, more often, over more ground',
  ],
};

/**
 * PROMOTED FROM ★5. She kept her id, her four pillar ids, her relic, her
 * element and every word of her voice; what changed is the price.
 *
 * A promotion that only edits `rarity` is a lie the pull screen tells: she
 * would sit in the rainbow beam with a 110 HP ★5 statline and lose every
 * comparison a player makes the moment they own two ★6s. So the whole card was
 * re-pitched against the five launch ★6s rather than against the ★5s she left:
 *
 *   HP     110 -> 142  (★6 band is 130-150; Sora 150, Han 145, Alicia 140)
 *   armor    0 -> 1    (every ★6 but Aoi, and Aoi's card explains why she is not)
 *   damage 1.00 -> 1.05, area 1.00 -> 1.05  (Alicia and Mirel both carry 1.05)
 *   luck     2 -> 3    (the highest number on the roster, and the actual point)
 *
 * Luck is the promotion. Treasure Sense was already the best farming passive in
 * the game at ★5 and the character is built entirely around going and getting
 * the thing; ★6 is where nobody out-farms her, so the stat that says so goes to
 * a number no one else has. Her damage numbers moved the least, on purpose —
 * she is not being promoted into a damage dealer.
 */
const AKANE = {
  id: 'akane',
  name: 'Akane',
  epithet: 'Captain of the Treasure Ship',
  rarity: 6,
  archetype: 'Pirate Captain',
  // Fire by way of gunpowder — the flintlock, the broadside and the rum all burn.
  element: 'fire',
  visual: { shape: 'capsule', color: '#d62b3a', accent: '#e8c34a', emoji: '🏴‍☠️', size: 16, glow: true },
  stats: {
    hp: 142, armor: 1, moveSpeed: 174, pickupRadius: 60,
    damageMult: 1.05, attackSpeedMult: 1.0, areaMult: 1.05,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 3,
  },
  autoAttack: {
    id: 'buccaneers_cutlass', name: "Buccaneer's Cutlass",
    desc: 'A wide 140° cutlass arc, 30 damage, 105px reach, every 0.65s. Every 3rd ' +
          'swing is a hitscan FLINTLOCK shot instead: 62 damage, pierces 5, ' +
          'enormous puff of smoke.',
    interval: 0.65, damage: 30, targeting: { mode: 'facing' },
  },
  special: {
    id: 'broadside', name: 'BROADSIDE!', cooldown: 30,
    // 27s -> 30s. The volley grew by 700 damage; a ★6 special the size of Aoi's
    // ceiling collapse is priced at Aoi's cooldown, not at a ★5's.
    desc: 'A ghost galleon fades in along one edge and runs out its guns: 18 ' +
          'cannonballs over 2.5s, each exploding for 95 damage in a 120px radius. ' +
          'Every impact point is telegraphed, so it is aimable chaos.',
  },
  escape: {
    id: 'barrel_roll', name: 'Barrel Roll', cooldown: 6, iframes: 0.9,
    desc: 'Dives into a rum barrel and rolls 240px, fully invulnerable, dealing 55 ' +
          'to anything rolled over. The barrel shatters into a rum puddle that ' +
          'ignites on any fire contact for 90 damage and a 5s burn.',
  },
  passive: {
    id: 'treasure_sense', name: 'Treasure Sense',
    // The compounding half is what makes this a ★6 passive, and it is
    // deliberately NOT Alicia's Hoard. Hoard is a trickle you cannot miss —
    // gold arrives whether you want it or not. This is a lump you have to cross
    // the arena for, through whatever is standing between you and the chest.
    desc: 'Chests and Treasure Carriers spawn 65% more often and are permanently ' +
          'marked with a compass arrow at the edge of the screen. Every chest you ' +
          'crack is a permanent +6% damage and +6% pickup radius for the rest of ' +
          'the run, uncapped. She is the best character in the game to farm on ' +
          'and she knows it.',
  },
  starUpgrades: {
    s3: 'Broadside fires 28 cannonballs and the galleon stays for a second volley.',
    s5: 'Barrel Roll can be held to keep rolling up to 1.5s, and the rum puddle ' +
        'ignites on its own for 90 damage and a 5s burn.',
  },
  signatureRelic: 'captains_rum',
  barks: {
    spawn: 'Ahoy! Now, which one of ye is the treasure?',
    levelUp: 'Yer captain grows mightier! ...Ow. My back.',
    lowHp: 'Ahoy! ...no, wait. HELP. Somebody HELP.',
    kill: 'Down ye go! Ahaha! ...bit much. Sorry.',
    boss: 'A big one! Crew, behind me! Well behind me!',
    idle: "I'm seventeen, by the way. Forever. Don't check.",
  },
  buildPaths: [
    'Loot run — Cursed Coin + Four-Leaf + Lodestone; luck 3 and Treasure Sense ' +
    'stack into three chests a run, and every chest is another permanent +6%',
    'Powder magazine — Wide Reach + Sharp Edge + Quick Recovery; the flintlock, the ' +
    'broadside and the burning rum puddle all scale on area and all set fire',
  ],
};

/**
 * The id and the display name do not match, which happens nowhere else on this
 * roster. That is deliberate and it is not a typo.
 *
 * `pekora` is the REGISTRY KEY. DECISIONS.md §36 binds behaviour to ids and
 * never to names, and her four pillar files were written against these ids
 * before the display name was settled; renaming the key later would silently
 * unbind four abilities and no test outside abilityCoverage would notice. So
 * the key stayed put and the name moved. `name` is the string a player reads,
 * and spec line 333 requires that one to be safe to display on its own.
 */
/**
 * THE BLADE COMES BACK. A ★5 whose entire kit is one loop the player performs
 * with their FEET rather than with a button: throw, decide, walk, collect.
 *
 * Every other ranged character on the roster is a damage faucet you point. She
 * leaves nine seconds of unclaimed value on the floor behind every volley, and
 * the only way to bank it is to go and stand on it — which turns her positioning
 * into a resource decision twenty times a minute in a genre whose only verb is
 * movement. The escape teleports TO one, so retrieval and disengage are the same
 * press and pressing it well means having thrown well ten seconds earlier.
 *
 * Steel because everything she uses is a thrown object, and steel's weakness to
 * fire is the honest cost of a kit that has to walk into where it just threw.
 */
const KARIN = {
  id: 'karin',
  name: 'Karin',
  epithet: 'The Blade Comes Back',
  rarity: 5,
  archetype: 'Reset Assassin',
  element: 'steel',
  visual: { shape: 'capsule', color: '#c0182f', accent: '#dfe8f5', emoji: '🗡', size: 16 },
  stats: {
    hp: 112, armor: 0, moveSpeed: 178, pickupRadius: 54,
    damageMult: 1.05, attackSpeedMult: 1.1, areaMult: 0.95,
    critChance: 0.10, critMult: 2.1, cooldownMult: 1.0, luck: 1,
  },
  autoAttack: {
    id: 'bouncing_blade', name: 'Bouncing Blade',
    desc: 'One blade thrown at the nearest thing every 0.42s: 34 damage in a ' +
          '46px bite where it lands, and then it STAYS there, standing in the ' +
          'ground, for 9 seconds. Nothing she throws is spent until she has ' +
          'walked back over it.',
    interval: 0.42, damage: 34, targeting: { mode: 'nearest' },
  },
  special: {
    id: 'death_lotus', name: 'DEATH LOTUS', cooldown: 24,
    desc: 'She stops moving and starts spinning. For 2.4s, everything within ' +
          '300px takes 42 damage every 0.22s and 3 more blades go out on a ' +
          'turning spoke every time — about thirty of them, all of which land ' +
          'point-down and all of which are still worth picking up afterwards.',
  },
  escape: {
    id: 'shunpo', name: 'Shunpo', cooldown: 5, iframes: 0.5,
    desc: 'She steps to the nearest blade she has left lying around, up to ' +
          '460px, fully invulnerable, and sweeps it up on arrival. With nothing ' +
          'on the floor it is a plain 460px step the way she was already going ' +
          '— which is the tell that she has been throwing badly.',
  },
  passive: {
    id: 'voracity', name: 'Voracity',
    desc: 'Every blade she picks up takes 0.7s off BOTH cooldowns and adds a ' +
          'permanent 1.2% damage for the rest of the run. Uncapped. Walking ' +
          'over her own mess is not the upkeep of the build, it IS the build.',
  },
  starUpgrades: {
    s3: 'DEATH LOTUS covers 380px and throws 4 blades a volley instead of 3.',
    s5: 'Shunpo holds 2 charges, so she can chain 2 retrievals back to back.',
  },
  signatureRelic: 'the_long_way_round',
  barks: {
    spawn: 'I dropped these on purpose. All of them. Watch.',
    levelUp: 'Faster. Which means further. Which means more of them.',
    lowHp: 'Fine — I only have to reach ONE of them.',
    kill: 'Mine. That one was mine. I want it back.',
    boss: 'Big. Slow. Standing on about nine of my knives.',
    victory: 'Right. Give me a minute, I have to go round and collect.',
    defeat: 'I threw the last one too far. That is the whole story.',
    idle: 'A knife on the floor is not a lost knife. It is a saved trip.',
  },
  buildPaths: [
    'The circuit — Quick Recovery + Long Haul + move speed; every second shaved ' +
    'off Shunpo is another blade retrieved, and Voracity never stops compounding',
    'The flurry — Extra Shot + Sharp Edge; more blades per throw is more blades ' +
    'on the floor, and DEATH LOTUS turns a crowd into thirty pickups at once',
  ],
};

/**
 * NINE REASONS TO STAY. The ★6 whose damage is a function of standing still.
 *
 * The orb goes out and COMES BACK, and it hurts on both passes — so her output
 * depends on holding a line long enough for the return trip to land, which is
 * the exact opposite instinct to every other ranged character here and is the
 * whole reason she plays differently on identical stats.
 *
 * The charm is the only ability in the game that takes the player out of the
 * fight without taking the fight away. For five seconds nothing can target her
 * and everything in the circle is dragged onto one point and left grinding
 * itself down there. She is not invulnerable. She is IRRELEVANT, and those are
 * different feelings.
 *
 * Three dashes held at once is a data field the engine did not previously have —
 * `escape.charges` — and she is the reason it exists.
 */
const RIMA = {
  id: 'rima',
  name: 'Rima',
  epithet: 'Nine Reasons To Stay',
  rarity: 6,
  archetype: 'Arcane Charmer',
  element: 'spirit',
  visual: { shape: 'capsule', color: '#ff7ad0', accent: '#ffd76a', emoji: '🦊', size: 16, glow: true },
  stats: {
    hp: 128, armor: 1, moveSpeed: 172, pickupRadius: 56,
    damageMult: 1.08, attackSpeedMult: 1.0, areaMult: 1.05,
    critChance: 0.07, critMult: 2.0, cooldownMult: 0.95, luck: 1,
  },
  autoAttack: {
    id: 'orb_of_deception', name: 'Orb of Deception',
    desc: 'A pale blue orb thrown 470px out THE WAY SHE IS FACING and pulled ' +
          'straight back to her hand. 30 damage going, 30 coming home, and it ' +
          'passes through everything both ways. Half her damage is on the ' +
          'return trip, so the shot is only worth what her feet were doing ' +
          'while it was away — and she aims it, so the line is hers to pick.',
    interval: 0.62, damage: 30, targeting: { mode: 'facing' },
  },
  special: {
    id: 'fox_fire', name: 'FOX-FIRE', cooldown: 20,
    desc: 'Three flames rise off her and hang there. For 6s, every 0.55s three ' +
          'of them peel away at whatever is nearest inside 460px for 62 damage ' +
          'each — about thirty flames — and they turn hard enough that running ' +
          'from one is not an answer.',
  },
  escape: {
    id: 'spirit_rush', name: 'Spirit Rush', cooldown: 7, iframes: 0.45, charges: 3,
    desc: 'THREE dashes, held at once and spent one at a time. 320px each, ' +
          'invulnerable through it, 55 damage to everything she passes through. ' +
          'They recharge individually, so the question is never whether to dash ' +
          'but how many she can afford to.',
  },
  passive: {
    id: 'essence_theft', name: 'Essence Theft',
    desc: 'Every kill heals her 0.6 HP and adds a permanent 0.8% damage. A ' +
          'thousand years of other people\'s magic, collected one piece at a ' +
          'time, and never once given back.',
  },
  starUpgrades: {
    s3: 'FOX-FIRE runs 9s instead of 6.',
    s5: 'FOX-FIRE releases 4 flames a wave instead of 3.',
  },
  signatureRelic: 'the_ninth_tail',
  barks: {
    spawn: 'Come closer. Everyone always does.',
    levelUp: 'Oh, that IS new. I have not felt that one before.',
    lowHp: 'Rude. I was being charming.',
    kill: 'Thank you. I will look after it.',
    boss: 'You are very large and very certain. Both of those are fixable.',
    victory: 'They all wanted to stay. That is the part nobody believes.',
    defeat: 'I have had a thousand years. One bad afternoon is survivable.',
    idle: 'Nine tails. Nine reasons. Ask me about any of them.',
  },
  buildPaths: [
    'The long line — Piercing Will + Long Haul + area; the orb already pierces ' +
    'everything, so every extra pixel of travel is a second full pass through it',
    'The pack — Quick Recovery + Sharp Edge; 30 seeking flames every 15 seconds ' +
    'is the highest single-target output on the roster and it needs no aiming',
  ],
};

/**
 * THE FUN PART. Two weapons on one trigger, and the special IS the trigger.
 *
 * MINIGUN is fast, single-target and small. ROCKETS fire every OTHER shot and
 * that one is an area blast. The cadence is halved in the implementation rather
 * than through the attack-speed stat, and deliberately: the card quotes one
 * interval and the player reads it once, so a mode that silently rewrote it
 * would be lying about a number already on screen. Skipping every second shot is
 * a thing you can watch happen.
 *
 * The escape is not a dodge. It is a floor full of traps that takes everybody's
 * legs at once — three seconds of a completely still arena, then three more of a
 * slow one — which is the only hard crowd-stop on the roster and the reason she
 * can be a ★5 with 108 HP and no armour.
 */
const NIKA = {
  id: 'nika',
  name: 'Nika',
  epithet: 'The Fun Part',
  rarity: 5,
  archetype: 'Loose Cannon',
  element: 'lightning',
  visual: { shape: 'capsule', color: '#ff5fa8', accent: '#6ad8ff', emoji: '💥', size: 16, glow: true },
  /**
   * THE AMMO BAR, and it is what stops her being a one-button character.
   *
   * Rockets beat the minigun in every situation a bullet heaven produces, so a
   * free toggle between them is not a choice — it is a correct answer you press
   * once and never revisit. Every rocket spends ammo, an empty tube drops her
   * back to the gun on the spot, and only the gun refills it. The rotation is
   * therefore forced and it has a rhythm: shred, bank, dump, get kicked out.
   */
  resourceBar: { id: 'ammo', label: 'AMMO', color: '#6ad8ff', max: 100 },
  stats: {
    hp: 108, armor: 0, moveSpeed: 174, pickupRadius: 52,
    damageMult: 1.0, attackSpeedMult: 1.15, areaMult: 1.05,
    critChance: 0.08, critMult: 2.2, cooldownMult: 1.0, luck: 2,
  },
  autoAttack: {
    id: 'switcheroo', name: 'Switcheroo!',
    desc: 'MINIGUN: one shot every 0.34s at the nearest thing for 21, and it ' +
          'refills 13 AMMO a second. ROCKETS: every OTHER shot, aimed at the ' +
          'thickest part of the crowd, for 48 in a 120px blast — and each one ' +
          'costs 11 AMMO. Run the tube dry and she is back on the gun that ' +
          'instant, whether or not she was ready.',
    interval: 0.34, damage: 21, targeting: { mode: 'nearest' },
  },
  special: {
    id: 'switcheroo_swap', name: 'SWITCHEROO', cooldown: 12,
    desc: 'She swaps guns. The one coming in fires a free volley of 5 on the ' +
          'way and she moves 25% faster for 3s while she is enjoying it. The ' +
          'shortest cooldown on the roster because the swap is the rotation, ' +
          'not a cooldown you save.',
  },
  escape: {
    id: 'flame_chompers', name: 'Flame Chompers!', cooldown: 8, iframes: 0.6,
    desc: '5 chompers thrown out in a 190px ring. Everything within 320px is ' +
          'bitten for 70, CANNOT MOVE for 3s, and is slowed 55% for 3s after ' +
          'that. She is invulnerable for 0.6s while she throws them.',
  },
  passive: {
    id: 'get_excited', name: 'Get Excited!',
    desc: 'Every kill is a permanent 2% damage and 0.9 move speed, up to 25 ' +
          'stacks. She does not calm down afterwards, and there is no version ' +
          'of this where she calms down afterwards.',
  },
  starUpgrades: {
    s3: 'The free swap volley is 8 shots instead of 5.',
    s5: 'Flame Chompers throws 8 instead of 5, and the haste lasts 6s.',
  },
  signatureRelic: 'the_loose_cannon',
  barks: {
    spawn: 'Rockets? Minigun? Rockets. No — minigun. BOTH. Watch this.',
    levelUp: 'MORE of it! That was the correct answer!',
    lowHp: 'This is FINE. This is the exciting part!',
    kill: 'Ha! Did you see? Nobody ever sees.',
    boss: 'Oh, you are BIG. I have exactly the wrong gun out. Perfect.',
    victory: 'Told you. Nobody ever believes the plan until after the plan.',
    defeat: 'Worth it. Do not check the arithmetic.',
    idle: 'The trick is to never stop moving and never stop reloading.',
  },
  buildPaths: [
    'Rockets forever — area + Sharp Edge; the half cadence stops mattering the ' +
    'moment one blast covers the whole screen, and Get Excited pays per corpse',
    'Minigun forever — attack speed + Extra Shot + crit; the fastest interval ' +
    'in the game multiplied by everything that keys off shots fired',
  ],
};

const PEKORA = {
  id: 'pekora',
  name: 'Usaki',
  epithet: 'The Flawless Plan',
  rarity: 6,
  archetype: 'Trap Schemer',
  // The only steel ★6. The bracket was fire, fire, light, light, water, spirit
  // before her, and steel is genuinely the right read rather than the leftover
  // one: everything she uses is ordnance she left lying on the floor earlier.
  // Mines are hardware. Under the ring (fire > steel > lightning) that also
  // hands her a real weakness the other ★6s do not share, which is the trade
  // for a kit that fights the arena instead of the enemy in front of her.
  element: 'steel',
  visual: { shape: 'capsule', color: '#5b8fe0', accent: '#ff8f2e', emoji: '🥕', size: 16, glow: true },
  stats: {
    // Lightest ★6 that still carries armour, and the second fastest character in
    // the game behind Aoi. She has to outrun her own ordnance, so the speed is
    // load-bearing rather than flavour. areaMult 1.10 ties Brant for the highest
    // on the roster because every single thing in the kit is a radius.
    hp: 132, armor: 1, moveSpeed: 182, pickupRadius: 48,
    damageMult: 1.0, attackSpeedMult: 1.0, areaMult: 1.10,
    critChance: 0.05, critMult: 2.0, cooldownMult: 1.0, luck: 1,
  },
  autoAttack: {
    id: 'carrot_barrage', name: 'Carrot Barrage',
    // `damage` is ONE carrot, and it is the same number whether it lands on the
    // floor or on a face — the ability never carries two damage values for one
    // projectile, which is the mistake the first pass made.
    desc: '4 carrots lobbed in a fan. Each sticks point-down where it lands and ' +
          'pops 1.2s later for 24 damage in a 70px burst; one that lands ON ' +
          'something pops immediately instead. Every 0.95s. Nothing she throws ' +
          'hurts on the frame she throws it.',
    interval: 0.95, damage: 24, targeting: { mode: 'densestCluster' },
  },
  special: {
    id: 'grand_scheme', name: 'THE GRAND SCHEME', cooldown: 31,
    desc: 'She takes a full 1.0s to lay it out properly: 8 numbered charges in a ' +
          '340px ring with tripwire strung between every pair. Then it goes ' +
          'wrong all at once. Every charge detonates for 150 damage in 120px, ' +
          'the wires whip inward and drag everything to the middle, and the last ' +
          'charge — the one that was never in the plan — goes off directly under ' +
          'HER for 200 damage in 260px. She is immune to it. Nothing else is.',
  },
  escape: {
    id: 'panic_hop', name: 'Panic Hop', cooldown: 6, iframes: 0.9,
    desc: 'Three enormous rabbit hops covering 260px in 0.9s, fully invulnerable, ' +
          'dropping a carrot mine at each launch point: 80 damage in a 110px ' +
          'blast, armed after 0.5s, live for 8s. She maintains this was the plan.',
  },
  passive: {
    id: 'it_backfired', name: 'It Backfired',
    // The ★6 compounding passive, and the joke and the mechanic are the same
    // thing: it pays when the trap DOESN'T work. Priced at +1% rather than the
    // +6% Akane gets per chest because a full Panic Hop can retire three mines
    // at once, six seconds later.
    desc: 'Nothing she leaves lying around is wasted. A trap or mine that expires ' +
          'without anything stepping on it goes off anyway out of pure spite: ' +
          '60 damage in 100px where it sat, 1.5s off every cooldown, and a ' +
          'permanent +1% damage for the rest of the run. Uncapped. The plan ' +
          'failing IS the plan, and she will say so afterwards, at length.',
  },
  starUpgrades: {
    s3: 'THE GRAND SCHEME lays 12 charges instead of 8 and the tripwires drag ' +
        'from 460px out.',
    s5: 'Panic Hop drops 5 mines instead of 3, and they arm instantly.',
  },
  signatureRelic: 'the_contingency_plan',
  barks: {
    spawn: 'Step one of forty. Ehehe~! You lot are step two.',
    levelUp: 'Stronger. On schedule. It was in the plan. Page nine.',
    lowHp: 'This is a trap! ...for me. I walked into my own. Ignore that.',
    kill: 'Ehehe! Exactly as pla— fine, wrong trap, but it COUNTED.',
    boss: 'A big one! I prepared forty contingencies! ...for a small one.',
    victory: 'Flawless. Textbook. Do not go back and watch the footage.',
    defeat: 'That was a FEINT. I meant that. I absolutely meant that.',
    idle: 'Plan thirty-one is going brilliantly. One through thirty are sealed.',
  },
  buildPaths: [
    'Minefield — Wide Reach + Quick Recovery + The Contingency Plan; every single ' +
    'thing in the kit is something she left on the floor, so widen all of it and ' +
    'leave more of it more often',
    'Spite scaling — Swift Boots + Sharp Edge + Long Haul; It Backfired pays a ' +
    'permanent +1% for every trap nobody stepped on, so outrun your own ordnance ' +
    'on purpose and let the arena pay you for it',
  ],
};

/** All 25 playable characters, in canonical roster order (rarity ascending). */
export const CHARACTERS = [
  // 3-star
  MOCHI, ALTO,
  // 4-star
  HOSHINO_REI, YAMIKAGE, UZU, CAPTAIN_YULI, KAGURA, UNIT_09,
  // 5-star
  RIN, NITEN, SHIRO_SAME, REIKA, NEKROMINA, HIKARI, KIRA,
  YUKINE, WREN, BRANT, KARIN, NIKA,
  // 6-star
  SOVEREIGN_ALICIA, SORA, HAN, AOI, MIREL, AKANE, PEKORA, RIMA,
];

/** id -> character. Written literally so no lookup logic lives in a data file. */
export const CHARACTERS_BY_ID = {
  mochi: MOCHI,
  alto: ALTO,
  hoshino_rei: HOSHINO_REI,
  yamikage: YAMIKAGE,
  uzu: UZU,
  captain_yuli: CAPTAIN_YULI,
  kagura: KAGURA,
  unit_09: UNIT_09,
  rin: RIN,
  niten: NITEN,
  shiro_same: SHIRO_SAME,
  reika: REIKA,
  nekromina: NEKROMINA,
  hikari: HIKARI,
  kira: KIRA,
  yukine: YUKINE,
  wren: WREN,
  brant: BRANT,
  karin: KARIN,
  nika: NIKA,
  sovereign_alicia: SOVEREIGN_ALICIA,
  sora: SORA,
  han: HAN,
  aoi: AOI,
  mirel: MIREL,
  akane: AKANE,
  pekora: PEKORA,
  rima: RIMA,
};

/**
 * Gacha pools by rarity: 2 / 6 / 10 / 7 = 25 (SECTION 15).
 * The ★3 pool is deliberately thin — DECISIONS.md §3 takes FIX B and rebalances
 * the pull rates (35/48/16/1) rather than inventing two unapproved characters.
 * Switching to FIX A later means adding two objects above and two ids here.
 *
 * These lists are the ONLY place rarity membership is written down; nothing
 * derives them from `rarity` at runtime, so moving a character between brackets
 * means editing here AND the character's own `rarity`, and data/index.js
 * validate() fails the boot if the two ever disagree. That check exists because
 * Akane's ★5 -> ★6 promotion is exactly the edit that forgets one of them.
 */
export const CHARACTERS_BY_RARITY = {
  3: ['mochi', 'alto'],
  4: ['hoshino_rei', 'yamikage', 'uzu', 'captain_yuli', 'kagura', 'unit_09'],
  5: ['rin', 'niten', 'shiro_same', 'reika', 'nekromina', 'hikari', 'kira',
      'yukine', 'wren', 'brant', 'karin', 'nika'],
  6: ['sovereign_alicia', 'sora', 'han', 'aoi', 'mirel', 'akane', 'pekora', 'rima'],
};
