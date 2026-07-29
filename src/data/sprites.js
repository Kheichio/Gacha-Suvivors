// SPRITE DESCRIPTORS — the art layer.
//
// This is the file an artist replaces. Each entry names a body plan and a
// handful of features; `render/pixelArt.js` assembles the actual pixels. Swapping
// any entry for `{ sheet: 'art/hero.png', frames: 4 }` later changes nothing else.
//
// The 24 characters are hand-authored because they are what the player looks at
// for twenty minutes. Every one is directed off its own entry in characters.js —
// element, archetype, epithet, weapon, palette — and NO TWO SHARE A SILHOUETTE.
// The rule the first pass broke was that a palette swap is not a character: the
// whole roster was one 20x26 stick figure in nineteen colours. Now each one owns
// a distinct combination of hair style, headgear, garment layer, wings/tails and
// weapon, so you can name them from the silhouette alone with the colour off.
//
// Enemies derive from behaviour + tier + element, with overrides only where a
// mob has a specific silhouette worth protecting.
//
// EVERY DESCRIPTOR BELOW IS WRITTEN AGAINST ITS OWN `refNotes` IN refs.js, LINE
// BY LINE. That paragraph is the art brief — it names the hair colour and style,
// the eye colour, the specific garment, the specific accessory, the specific
// weapon and the signature prop, and where the previous pass contradicted it the
// descriptor is wrong and the paragraph is right. Anything the paragraph asked
// for that the drawing vocabulary could not express (a crate on the back, an
// eyepatch, detached sleeves, one shoulder pad, a forehead scar, drop earrings,
// nine tails instead of four, feather accents on the arms, a floating interface
// panel, a checkered garment) is now a feature in pixelArt.js rather than an
// omission here. NOTHING in this file may name a source character, series or
// other proper noun from refs.js — describe the feature, never the referent.

/**
 * id -> descriptor.
 * Body plans: humanoid | portrait | blob | ghost | beast | mech | titan
 *
 * Feature vocabulary the humanoid plan understands:
 *   hair       short spiky flame wild bowl bangs bob wave long twin drills
 *              lowTwin ponytail sidetail braid topknot buzz ahoge plume
 *              ducktail undercut hood none
 *   hair extra hairColor, hairTip (gradient to a second colour), hairTie,
 *              hairStreak (ONE dyed lock in the fringe — hairTip recolours the
 *              whole mass and is not the same request), sideBraid (a short
 *              braid at one temple, whatever the main style is)
 *   ears       fox cat elf ribbon fin horns greatHorns (+ earColor, earInner)
 *   headgear   crown, hat:'tricorn'|'topHat' (+hatColor, hatPlume), headband
 *              (+headbandPlate), headdress (+headdressRibbon), halo,
 *              hairpin:'star'
 *   face       eyes, eyeGlow, eyeSigil, visor, mask, eyepatch:'left'|'right',
 *              scar:'left'|'right', whiskers, blush:false
 *   garment    coat (+coatTrim, coatPattern:'check'|'stripe', coatPattern2,
 *              coatRagged), pinafore (+pinaforeTrim), hoodDown, highCollar,
 *              skirt, shorts, sash, belt, scarf, tie, neckBow, harness,
 *              pauldrons (colour) + pauldron:'left'|'right' (one side only),
 *              gauntlets, gloves, cuffs, armWraps, detachedSleeves, boots,
 *              bootHeight:'knee'|'thigh', barefoot, sleeve, legColor,
 *              underLayer, chest (crest)
 *   extras     cape, wings (feather|mech|energy|dragon), armWings, hipWings,
 *              tails 1-9 or tail:'scaled', aura, sparks, hologram,
 *              backpack (+backpackColor, strapColor), young
 *   weapon     greatsword sword cutlass katana daisho dual dualRev scythe
 *              trident spear staff gun book mic fan chakram hammer axe bow
 *              claws orb whip cards mirror none
 *
 * FOUR OF THOSE ARE NEW AND EXIST BECAUSE THE MAID WAS BEING DRAWN OUT OF THE
 * WRONG PARTS. `headband` was standing in for the frilled headdress, `coat` for
 * the pinafore and `scarf` for the neck ribbon: three garments wearing each
 * other's names, and at 30x42 they read as a headband, a coat and a scarf,
 * because that is what they were. So:
 *   headdress  a pale band with a SCALLOPED upper edge and short ribbon tails,
 *              sitting ON TOP of the hair. A headband crosses the BROW, is dark
 *              and carries a plate; the two are opposites and neither may be
 *              written for the other.
 *   pinafore   a bib on two shoulder straps plus an apron over the skirt with a
 *              frilled hem and the bow of its waist tie showing past the hips.
 *              Not a coat: no lapels, no open front, and it stops well short of
 *              the boot.
 *   neckBow    a ribbon tied in a BOW at the throat. Three garments live in the
 *              same six pixels — `scarf` is wrapped cloth with one long trailing
 *              end, `tie` is a knot with a blade down the shirt, `neckBow` has
 *              two loops and two stubs — and they are not interchangeable.
 *   cuffs      a band at the wrist that is a pixel proud of the arm and sits
 *              below the sleeve's hem, so it reads as a separate cuff rather
 *              than as the last row of a sleeve.
 * The rest of the additions are the same story on other characters: hoodDown
 * for the two hoodies that were being written as coats, coatRagged for the one
 * kimono the brief calls torn, hairStreak, sideBraid, earInner, lowTwin and the
 * axe, each of which is one concrete line of somebody's refNotes that the
 * vocabulary simply could not say.
 */
export const CHARACTER_SPRITES = {
  // ★3 ----------------------------------------------------------------------
  // The mascot. A soft white rice-cake blob with a red gem cut into its brow,
  // long drooping ears and a mouth that is clearly too big for it.
  // `skin` and `hair` are ignored by the blob plan; they are here so the HUD
  // portrait of a mascot is a white bald mascot head and not a peach-skinned
  // person with a haircut.
  mochi: {
    body: 'blob', outfit: '#f4f1ea', accent: '#d64545', eyes: '#141420',
    chest: '#d64545', ears: 'long', skin: '#f4f1ea', hair: 'none',
    gridW: 22, gridH: 22,
  },
  // The solo duelist. Black on black on black, a curtain of fringe over the
  // eyes, and the two blades held the way the brief describes them: one forward,
  // one REVERSED. The floating panel at his shoulder is the interface he treats
  // as part of his kit — it is the one thing on the roster that is pure UI.
  alto: {
    body: 'humanoid', hair: 'bangs', hairColor: '#14141c', skin: '#f0c9a8',
    // Slate rather than the near-black the palette wants: on black hair behind a
    // black fringe, a #2a2a3a iris is not a dark eye, it is no eye.
    outfit: '#2b3242', accent: '#3fd0ff', eyes: '#4d5a75',
    coat: '#101018', coatTrim: '#3fd0ff', highCollar: '#101018',
    gauntlets: '#3fd0ff', gloves: '#14141c', boots: '#14141c',
    hologram: '#3fd0ff', weapon: 'dualRev', weaponColor: '#cfe6ff',
  },

  // ★4 ----------------------------------------------------------------------
  // Stage idol. Blue-black BOB (not drills — the brief is specific), a gold star
  // pinned in it, a comet crest, a short cape, and one eye behind the fringe,
  // which is the single most recognisable thing about the design.
  hoshino_rei: {
    body: 'humanoid', hair: 'bob', hairColor: '#1d2445', skin: '#f7d3b4',
    outfit: '#1b2a5e', accent: '#6ad8ff', eyes: '#4aa8ff',
    eyepatch: 'left', eyepatchColor: '#161d3a',   // the fringe, not a patch
    hairpin: 'star', hairpinColor: '#ffe14a',
    // The brief says the costume is NAVY AND WHITE and the previous pass was
    // navy and cyan: every light on her was the accent, so the second half of a
    // two-colour costume was simply missing. The white now shows where a stage
    // outfit actually shows it — at the collar and on the gloves.
    underLayer: '#f4f1ea', gloves: '#f4f1ea',
    cape: '#121c44', skirt: '#2a3a78', sash: '#6ad8ff', chest: '#ffe14a',
    boots: '#121c44', bootHeight: 'knee',
    aura: '#ffe14a', weapon: 'mic', weaponColor: '#e8ecf5',
  },
  // The avenger, corrected against the brief: a dark blue STAND COLLAR, WHITE
  // ARM WRAPS, swept duck-tail hair and red eyes carrying a ring sigil. The face
  // wrap the previous pass gave him belongs to a different ninja entirely, and
  // taking it off is what lets the eyes do the work they are supposed to do.
  yamikage: {
    body: 'humanoid', hair: 'ducktail', hairColor: '#1a1d2e', skin: '#eec6a4',
    outfit: '#243050', accent: '#e8e8f0', eyes: '#ff3a3a', eyeGlow: '#ff6f6f',
    eyeSigil: '#14141c', highCollar: '#1c2740', armWraps: '#e8e8f0',
    sash: '#4a5578', gloves: '#1c2740', boots: '#1c2740', blush: false,
    weapon: 'katana', weaponColor: '#dfe8f5',
  },
  // His opposite number in every way: blond spikes instead of a dark sweep, a
  // plated forehead band, THREE whisker marks on each cheek, an orange-and-black
  // jumpsuit and three spirit tails. Bare-faced and unarmed, on purpose.
  uzu: {
    // A shade deeper than the other orange gi on purpose: they are the only two
    // orange characters and they sit next to each other on the roster grid.
    body: 'humanoid', hair: 'spiky', hairColor: '#f5d14a', skin: '#f5cba0',
    outfit: '#ef7318', accent: '#1a1d2e', eyes: '#4aa8ff',
    whiskers: true, headband: '#1a1d2e', headbandPlate: '#c8d2e0',
    sleeve: '#1a1d2e', sash: '#1a1d2e', chest: '#e8e8f0',
    tails: 3, tailColor: '#ff6a1a',
    // No gauntlets: with the obi, the sleeves and the gloves all in the same
    // near-black, one more black band at the waist joined them into a single
    // bar across the whole figure.
    gloves: '#1a1d2e', boots: '#1a1d2e', weapon: 'none',
  },
  // Short black UNDERCUT, a white cravat at the throat, an olive corps jacket
  // with the wing crest, and a full aerial-manoeuvre harness with hip canisters.
  // No blush and a flat mouth: the expression is the character.
  captain_yuli: {
    body: 'humanoid', hair: 'undercut', hairColor: '#15151f', skin: '#f0cba8',
    outfit: '#4a4636', accent: '#d8d2c4', eyes: '#3a4050',
    scarf: '#f4f1ea', cape: '#5c6a4a', harness: '#6a6250',
    chest: '#8ab0d8', gloves: '#e8e4dc', boots: '#3a3628', bootHeight: 'knee',
    blush: false, weapon: 'dual', weaponColor: '#cfd8e6',
  },
  // Shrine fox. Long pink hair, GOLD ears rather than pink ones, NINE tails,
  // a blue-and-white shrine robe with DETACHED SLEEVES, and the polished bronze
  // mirror she actually carries instead of the war fan she does not.
  kagura: {
    body: 'humanoid', hair: 'long', hairColor: '#ff9ecb', skin: '#fadbc4',
    outfit: '#eef2ff', accent: '#4a7fd6', eyes: '#ffd23f',
    detachedSleeves: '#dfe8ff', skirt: '#3f6ad8', shorts: '#2a3f7a',
    sash: '#4a7fd6', ears: 'fox', earColor: '#e8b64c',
    tails: 9, tailColor: '#ff9ecb', boots: '#e8e4dc',
    weapon: 'mirror', weaponColor: '#e8c98a',
  },
  // A stream overlay given a body: ribbon aerials shaped like headset ears, a
  // white-and-pink HOODED dress, THIGH-HIGH boots, pink eyes, a status halo that
  // is actually visible, and pixel motes shedding off her. The hood is worn
  // down, which the vocabulary could not say at all until now — the previous
  // pass wrote `coat` and quietly dropped the one word the brief leads with.
  unit_09: {
    body: 'humanoid', hair: 'ahoge', hairColor: '#8a6a4a', skin: '#fbdcc4',
    outfit: '#f7f2f4', accent: '#ff7ab8', eyes: '#ff7ab8',
    ears: 'ribbon', halo: '#ff7ab8', chest: '#ff7ab8', aura: '#ff7ab8',
    coat: '#f2e6ec', coatTrim: '#ff7ab8', hoodDown: '#ff7ab8',
    gloves: '#f7f2f4', boots: '#ff7ab8', bootHeight: 'thigh', weapon: 'none',
  },

  // ★5 ----------------------------------------------------------------------
  // Burgundy hair tied back, red-brown eyes, a SCAR the fringe parts around,
  // rectangular drop EARRINGS, a black-and-green CHECKERED haori, and the large
  // wooden BOX strapped to his back that the whole character is built around.
  // The blade runs pale blue because every run starts in the water form.
  rin: {
    body: 'humanoid', hair: 'ponytail', hairColor: '#7a2f2a', skin: '#f4cda6',
    outfit: '#1c2a20', accent: '#3f7a4a', eyes: '#c25a3a',
    coat: '#2e7d64', coatPattern: 'check', coatPattern2: '#14201a',
    coatTrim: '#1c2a20', sash: '#2a4a34', boots: '#14201a',
    scar: 'right', earrings: '#f4f1ea', earringsMotif: '#c8342a',
    backpack: 'box', backpackColor: '#7a5330', strapColor: '#3a2a1c',
    weapon: 'katana', weaponColor: '#8ad8ff',
  },
  // The ronin. Sun-darkened, scarred, roughly tied hair, a TORN kimono, NO
  // armour and BARE FEET, and the long-and-short pair drawn at once so the
  // length difference — which is the entire school — is impossible to miss.
  // Heavy blacks with one red accent, per the ink-wash direction. The hem is
  // ragged: he is the only person on the roster wearing rags and a garment that
  // ends in a ruled line has been laundered.
  niten: {
    body: 'humanoid', hair: 'topknot', hairColor: '#2a241e', skin: '#c9955f',
    outfit: '#22201c', accent: '#8a1f1f', eyes: '#1a1a1a',
    coat: '#332f28', coatTrim: '#8a1f1f', coatRagged: true,
    sash: '#8a1f1f', belt: false,
    barefoot: true, scar: 'left', blush: false,
    weapon: 'daisho', weaponColor: '#e0e6ee',
  },
  // Deep-sea, and VERY SMALL — a bigger head on a narrower frame, which is the
  // whole reason the humanoid plan learned about proportion. Dorsal fin on the
  // crown, pale twin-tails, a HOODIE over the suit with the hood down behind the
  // neck, a tail, and a gold trident.
  shiro_same: {
    body: 'humanoid', young: true,
    hair: 'twin', hairColor: '#dff4ff', hairTie: '#5fd6ff', skin: '#fbe0cc',
    outfit: '#5fd6ff', accent: '#0b3d5c', eyes: '#4a7f9c',
    coat: '#2f8fc4', coatTrim: '#dff4ff', hoodDown: '#2f8fc4', ears: 'fin',
    tails: 1, tailColor: '#4ab6e0', gloves: '#dff4ff', boots: '#0b3d5c',
    weapon: 'trident', weaponColor: '#ffe9a3',
  },
  // Electromaster. Short brown bob, cream winter uniform, the BROWN skirt with
  // SHORTS visible under it, a red collar RIBBON — a bow, which is a different
  // garment from the scarf that used to stand in for it — the flicked token as
  // her crest, and arcs coming off the bangs rather than a generic aura.
  reika: {
    body: 'humanoid', hair: 'bob', hairColor: '#7a5a3a', skin: '#fbdcc0',
    outfit: '#e8e4dc', accent: '#8a6a4a', eyes: '#c8a05a',
    neckBow: '#c8503a', skirt: '#6a4a2e', shorts: '#2e2a26',
    sparks: '#7ad9ff', chest: '#ffe14a', aura: '#7ad9ff',
    boots: '#2e3648', bootHeight: 'knee', weapon: 'none',
  },
  // Grave idol. Long pink hair, red eyes, a black-and-red coat with a HIGH
  // COLLAR, a tiny TOP HAT pinned on at an angle, and a full-size scythe. The
  // hat is what stops her reading as the other long-pink-haired character.
  nekromina: {
    body: 'humanoid', hair: 'long', hairColor: '#e0679f', skin: '#f2d0bc',
    outfit: '#1a1420', accent: '#c8203a', eyes: '#ff3a5e', eyeGlow: '#ff7a90',
    hat: 'topHat', hatColor: '#12101a',
    coat: '#241826', coatTrim: '#c8203a', highCollar: '#241826',
    cape: '#3a0d1c', sash: '#c8203a', gauntlets: '#c8203a', gloves: '#1a1420',
    boots: '#12101a', bootHeight: 'knee',
    weapon: 'scythe', weaponColor: '#dfe8f5',
  },
  // Phoenix. A feathered crest instead of hair with a gold crown over it,
  // burning wings, FEATHER ACCENTS ON THE ARMS specifically, two tail plumes,
  // and embers coming off her. Fire, and it should look like it.
  hikari: {
    body: 'humanoid', hair: 'plume', hairColor: '#ff7a2b', skin: '#fbdcc4',
    outfit: '#ff9a3d', accent: '#ffd23f', eyes: '#ffb03d',
    // The wings run DEEPER than the outfit, not lighter: at a near-match the
    // whole figure fused into one orange mass with no silhouette at all.
    crown: '#ffd23f', wings: 'feather', wingColor: '#d9541e',
    armWings: '#ffd23f', tails: 2, tailColor: '#ff6a1a',
    aura: '#ffd23f', chest: '#ffd23f', boots: '#c8502a', weapon: 'none',
  },
  // EVERYTHING IS RED. Long black twin-tails with red ribbons, a red coat worn
  // open over red-and-white, a huge red tricorn with a plume, gold trim, an
  // eyepatch over one eye, and a curved cutlass rather than a straight sword.
  akane: {
    body: 'humanoid', hair: 'twin', hairColor: '#1a1420', hairTie: '#c8203a',
    skin: '#fbdcc4', outfit: '#f4f1ea', accent: '#ffd23f', eyes: '#e0405f',
    hat: 'tricorn', hatColor: '#c8203a', hatPlume: '#f4f1ea',
    eyepatch: 'right', eyepatchColor: '#8f1428',
    coat: '#c8203a', coatTrim: '#ffd23f', pauldrons: '#ffd23f',
    sash: '#ffd23f', skirt: '#8f1428', boots: '#3a1218', bootHeight: 'thigh',
    weapon: 'cutlass', weaponColor: '#ffe9a3',
  },
  // The administrator. Immaculate: neat brown hair, brown eyes, a school blazer
  // and a TIE, perfect posture, no expression, and a PLAIN BLACK notebook. He is
  // the only person on the roster whose weapon is stationery, and the design
  // note is that nothing about him should look like it fights.
  kira: {
    body: 'humanoid', hair: 'short', hairColor: '#6a4a2e', skin: '#f7d8bc',
    outfit: '#e8e4dc', accent: '#8a2020', eyes: '#7a4a2a',
    coat: '#22252f', coatTrim: '#3a3f4e', tie: '#8a2020',
    gloves: '#f7d8bc', boots: '#1a1a22', blush: false,
    weapon: 'book', weaponColor: '#3a3a4a',
  },

  // The white fox broadcaster. Deliberately the OPPOSITE read to the pink
  // nine-tailed shrine fox: a white SIDETAIL rather than long loose hair, white
  // fox ears, exactly ONE tail, a modern collared jacket with a tie instead of a
  // shrine robe, and a fan of contracts in her hand instead of a mirror.
  yukine: {
    body: 'humanoid', hair: 'sidetail', hairColor: '#f2f6ff', hairTie: '#3fb6c8',
    skin: '#fbe0cc', outfit: '#eaf4ff', accent: '#3fb6c8', eyes: '#9ad84a',
    // Two things the brief names outright and the previous pass could not draw:
    // ONE blue-green streak in otherwise white hair, and PALE BLUE inner fur in
    // the ears. The ear lining used to be a hard-coded pink, which is right for
    // the other fox on the roster and wrong for this one.
    hairStreak: '#3fb6c8', earInner: '#bfe4f5',
    ears: 'fox', earColor: '#f2f6ff',
    coat: '#dbe9f7', coatTrim: '#3fb6c8', highCollar: '#dbe9f7',
    tie: '#2a6fa8', skirt: '#2a3550', shorts: '#1c2438',
    tails: 1, tailColor: '#cfe6f5',
    gloves: '#f2f6ff', boots: '#2a3550', bootHeight: 'thigh',
    aura: '#8fe6ff', weapon: 'cards', weaponColor: '#f4f1ea',
  },
  // The apprentice. A blunt lilac cut with ONE SMALL BRAID at the side, violet
  // eyes, a broad white capelet collar over a plain grey-brown travelling dress,
  // and FLAT SHOES — the tidiest silhouette on the roster, and a small frame
  // because she is the youngest person in the party. Bare orb-cast rather than a
  // blade: her hands are the weapon and they never shake. The scarf the previous
  // pass gave her was standing in for the capelet's broad collar, which is a
  // stand collar and not a scarf, and it came with a trailing end she does not
  // have; the braid was simply missing.
  wren: {
    body: 'humanoid', young: true,
    hair: 'bowl', hairColor: '#b08fd6', skin: '#f7d8bc',
    outfit: '#6a6252', accent: '#f4f1ea', eyes: '#8f6ad6',
    sideBraid: '#9a78c4', hairTie: '#e8e4dc',
    cape: '#f4f1ea', highCollar: '#f4f1ea', skirt: '#5a5244',
    gloves: '#e8e4dc', boots: '#3a3428',
    sparks: '#c3a8ff', blush: false, weapon: 'orb', weaponColor: '#c3a8ff',
  },
  // The warrior. Shaggy RED hair, blue eyes, a heavy blue-grey fur-collared coat
  // over MAIL (showing at the neck), wrapped forearms, one shoulder plate each
  // side, and the enormous two-handed AXE he never puts down. It is an axe in
  // the brief and in his relic, and the hammer the previous pass gave him is a
  // different weapon with a different silhouette. The biggest read in the cast
  // and the only red head.
  brant: {
    body: 'humanoid', hair: 'wild', hairColor: '#c8452c', skin: '#f0c9a8',
    outfit: '#3f4a5c', accent: '#c8452c', eyes: '#5fb6e0',
    coat: '#2e3a4c', coatTrim: '#8a7a52', scarf: '#8a7a52',
    underLayer: '#9aa4b2',
    pauldrons: '#8a9aa8', harness: '#5a4a38', armWraps: '#c8c2ba',
    gauntlets: '#8a9aa8', boots: '#2a2218', bootHeight: 'knee',
    // Brighter than the shoulder plates on purpose: the axe head passes right
    // over one, and at a near-match the two greys share an outline and fuse.
    blush: false, weapon: 'axe', weaponColor: '#d2dced',
  },

  // ★6 ----------------------------------------------------------------------
  // The dragon queen. Blonde hair running to orange-red AT THE TIPS, curved
  // great horns under a crown, one long SCALED TAIL rather than a pair of
  // brushes, WING ORNAMENTS AT THE HIPS rather than wings on the back, orange
  // eyes, and a gold mote field. Every one of those is the brief, verbatim.
  sovereign_alicia: {
    body: 'humanoid', hair: 'long', hairColor: '#ffd76a', hairTip: '#e0452c',
    skin: '#fbdcc4', outfit: '#ff8a3d', accent: '#ffb03d',
    eyes: '#ff8a3d', eyeGlow: '#ffd76a',
    ears: 'greatHorns', crown: '#ffd76a',
    tail: 'scaled', tailColor: '#e0452c', hipWings: '#ffd76a',
    cape: '#8a2a18', pauldrons: '#e0452c', gauntlets: '#e0452c',
    sash: '#ffd76a', chest: '#e0452c', aura: '#ffd76a',
    boots: '#8a2a18', bootHeight: 'knee', weapon: 'none',
  },
  // Orange gi with the BLUE UNDERSHIRT showing at the collar, a blue belt, blue
  // wristbands and boots, and hair that goes straight up. Unarmed, silver-eyed,
  // standing in a column of white ki motes.
  sora: {
    body: 'humanoid', hair: 'flame', hairColor: '#15151f', skin: '#f5cba0',
    outfit: '#ff8a2b', accent: '#3f6ad8', eyes: '#2a2a3a', eyeGlow: '#dfe8f5',
    underLayer: '#3f6ad8', sash: '#3f6ad8', sleeve: '#ff7a1a',
    gauntlets: '#3f6ad8', chest: '#e8e8f0',
    boots: '#3f6ad8', bootHeight: 'knee', aura: '#f2f6ff', weapon: 'none',
  },
  // His counterweight, pinned to the tournament design the brief names: spiky
  // black hair, a PURPLE gi over a blue undershirt, ONE shoulder pad on the left
  // only, a white cape, and a small young frame. The glasses and bowl cut the
  // previous pass gave him are from a later look and are gone.
  han: {
    body: 'humanoid', young: true,
    hair: 'spiky', hairColor: '#15151f', skin: '#f5cba0',
    outfit: '#8a5fd6', accent: '#ffd84a', eyes: '#2a2a3a',
    underLayer: '#3f6ad8', pauldron: 'left', pauldrons: '#e8e4dc',
    cape: '#e8e4dc', sash: '#ffd84a', chest: '#ffd84a',
    gauntlets: '#3f6ad8', boots: '#3f6ad8', bootHeight: 'knee',
    aura: '#ffd84a', weapon: 'none',
  },
  // THE MAID, and every line of her brief is a garment.
  //
  // Blue-violet hair in two long DRILL twin-tails tied with WHITE RIBBONS — the
  // only drills in the cast and half her silhouette — purple-blue eyes, and a
  // full maid uniform: dark navy dress, WHITE PINAFORE and detached CUFFS, a
  // WHITE FRILLED HEADDRESS, a RED NECK RIBBON. Every one of those five is now a
  // feature that means what it says. The previous pass faked three of them out
  // of the wrong parts — `headband` for the headdress, `coat` for the pinafore,
  // `scarf` for the neck ribbon — and what came out was a person in a headband,
  // a coat and a scarf, because that is what was written.
  //
  // The disc is thrown, not held: she is never posed, she is mid-accident, and a
  // ring at head height with a motion arc behind it is the closest this
  // vocabulary gets to a tray already out of her hands.
  aoi: {
    body: 'humanoid', hair: 'drills', hairColor: '#6b6ad6', hairTie: '#f4f1ea',
    skin: '#fbe0cc', outfit: '#1e2440', accent: '#f4f1ea', eyes: '#9b7cf0',
    headdress: '#f4f1ea', headdressRibbon: '#f4f1ea', neckBow: '#c8203a',
    pinafore: '#f4f1ea', pinaforeTrim: '#c9cfe4',
    detachedSleeves: '#f4f1ea', cuffs: '#f4f1ea',
    skirt: '#1e2440', gloves: '#f4f1ea', boots: '#2a3050', bootHeight: 'knee',
    aura: '#8fb6ff', weapon: 'chakram', weaponColor: '#e8ecf5',
  },
  // The elf. Small frame, long POINTED EARS, waist-length white-silver hair worn
  // in TWO LOW TAILS with gold ties, a white-and-gold robe under a short dark
  // shoulder cape, and a plain wooden staff. The single braid the previous pass
  // gave her is not what the paragraph says and the paragraph wins; low tails
  // are also a different read from the two high bunches already on the roster,
  // which is what keeps her out of the twin-tail pile. Nothing about her is
  // ornamental: she looks fourteen, is over a thousand, and owns one good coat.
  mirel: {
    body: 'humanoid', young: true,
    hair: 'lowTwin', hairColor: '#f2f6ff', hairTie: '#c8a24a', skin: '#fbe0cc',
    outfit: '#f7f4ec', accent: '#c8a24a', eyes: '#6ad89a',
    ears: 'elf', earColor: '#fbe0cc',
    cape: '#2a2436', coat: '#f2ece0', coatTrim: '#c8a24a', highCollar: '#f2ece0',
    sash: '#c8a24a', boots: '#5a4a38', bootHeight: 'knee',
    blush: false, aura: '#dff4e8', weapon: 'staff', weaponColor: '#8a6a4a',
  },
};

// ---------------------------------------------------------------------------
// PORTRAITS
// ---------------------------------------------------------------------------

/**
 * The atlas size the HUD should pass to `atlas.registerPixel(portraitFor(def), n)`.
 * 26 puts the 40x40 grid at round(26 * 2.6 / 40) = 2x — a clean integer upscale,
 * which is the only kind that stays pixel art. The HUD then fits the result to
 * its plate, so the extra rows bought detail rather than size.
 */
export const PORTRAIT_SIZE = 26;

/**
 * A head-and-shoulders bust descriptor for a character, or null.
 *
 * Two things here are load-bearing:
 *
 * 1. `id` MUST differ from the character id. The atlas keys pixel sprites on
 *    'px|' + descriptor.id + '|' + round(size), so reusing the plain id would
 *    hand back the cached WORLD sprite at portrait size and nobody would ever
 *    see an error — just the wrong picture.
 * 2. The colours are lifted from the same CHARACTER_SPRITES entry rather than
 *    re-typed, so a recolour can never leave the portrait and the world sprite
 *    disagreeing about what the character wears.
 */
export function portraitFor(def) {
  if (!def) return null;
  const src = CHARACTER_SPRITES[def.id];
  if (!src) return null;
  return Object.assign({}, src, {
    id: def.id + '_portrait',
    body: 'portrait',
    // A bust does not bob — it is framed art, not a thing standing in a field.
    noBob: true,
    gridW: undefined, gridH: undefined,
    // Below-the-neck kit that a bust crops out anyway; dropping it keeps the
    // portrait from drawing a trident through its own shoulder. `chest` stays —
    // the bust re-sites the crest onto the collarbone — and so do the collar,
    // the coat and the one-sided shoulder pad, which are all visible in frame.
    // `cuffs` go with the arms they sit on: there are no wrists in a bust.
    weapon: 'none', tails: 0, tail: null, cape: null, skirt: null, shorts: null,
    sash: null, gauntlets: null, boots: null, bootHeight: undefined,
    belt: undefined, harness: null, armWings: null, hipWings: null,
    backpack: null, hologram: null, barefoot: false, detachedSleeves: null,
    armWraps: null, cuffs: null,
    // `wings` deliberately SURVIVES: the bust shows the leading edge of one at
    // each shoulder, which is in frame and is half the read on the one
    // character who has them. So, deliberately, do `headdress`, `neckBow`,
    // `pinafore` and `hoodDown` — a headdress, a ribbon at the throat, the bib
    // of an apron and the roll of a hood down behind the neck are all ABOVE OR
    // AT the crop line, and a maid whose uniform is cropped out of her own
    // portrait is a stranger in a navy dress.
  });
}

// ---------------------------------------------------------------------------
// ENEMIES
// ---------------------------------------------------------------------------

/** Behaviour -> body plan. The silhouette should telegraph how a thing moves. */
const BODY_FOR_BEHAVIOR = {
  chaser: 'humanoid', swarmer: 'blob', charger: 'beast', ranged: 'mech',
  exploder: 'blob', splitter: 'blob', orbiter: 'ghost', summoner: 'ghost',
  shielder: 'beast', dasher: 'humanoid', tank: 'beast', healer: 'ghost',
  leech: 'blob', ambusher: 'beast', static: 'mech',
};

/**
 * Behaviour -> extra features. The body plan says WHAT it is; this says how it
 * carries itself, so two chasers and a dasher do not all resolve to the same
 * bald humanoid. Cheaper than an override per enemy and it applies to content
 * added later for free.
 */
const BEHAVIOR_STYLE = {
  chaser:   { hair: 'wild', gauntlets: true, gloves: '#4a5268' },
  dasher:   { hair: 'ponytail', weapon: 'claws', sash: true, bootHeight: 'knee' },
  ranged:   { weapon: 'gun', wings: 'mech' },
  charger:  { ears: 'horns', tails: 1 },
  tank:     { ears: 'greatHorns', pauldrons: true },
  shielder: { pauldrons: true },
  ambusher: { hair: 'hood', weapon: 'claws' },
  summoner: { halo: '#c58cff' },
  healer:   { halo: '#7bf59a' },
  orbiter:  { ears: 'horns' },
  exploder: { chest: '#ff7a3d' },
  splitter: { chest: '#7bf59a' },
  leech:    { ears: 'long' },
  swarmer:  {},
  static:   { noBob: true, halo: '#ff3a5e' },
};

/**
 * Enemies are COOL-TONED and desaturated against bright saturated players —
 * SECTION 1's readability rule, applied as a transform rather than remembered
 * per entry. They get the same anatomy the cast does at their own grid sizes,
 * because a crude enemy standing next to a detailed player reads as a bug in the
 * renderer rather than as a design decision; what keeps them subordinate is the
 * palette and the lack of a signature, not a lack of craft.
 */
function enemyDescriptor(def) {
  const spec = ENEMY_OVERRIDES[def.id] || {};
  const body = spec.body || BODY_FOR_BEHAVIOR[def.behavior] || 'humanoid';
  const style = BEHAVIOR_STYLE[def.behavior] || {};
  const tint = def.visual && def.visual.color ? def.visual.color : '#8fa2c9';
  const accent = def.visual && def.visual.accent ? def.visual.accent : '#2b3452';
  const big = def.size === 'large';
  const medium = def.size === 'medium';
  return Object.assign({
    body,
    outfit: tint,
    accent,
    hairColor: accent,
    skin: '#c9b8a8',
    eyes: '#ffd23f',
    hair: 'short',
    weapon: 'none',
    blush: false,          // nothing in the horde is pleased to be here
  }, style, {
    // Fodder used to render on a 16x18 grid against the player's 20x26, which
    // read as "the enemies are tiny". A rank-and-file enemy now sits just under
    // the player's 30x42 — it is a person too — and medium and large step up
    // from there. These are GRID sizes, not on-screen sizes: the atlas divides
    // the upscale back out, so raising them buys detail and costs nothing.
    gridW: big ? 36 : medium ? 30 : 26,
    gridH: big ? 46 : medium ? 38 : 34,
  }, spec);
}

/** Only where a mob has a silhouette worth protecting. */
const ENEMY_OVERRIDES = {
  // Deliberately the least interesting thing on screen: bowl cut, blazer, tie,
  // no expression. Everything else reads as important by comparison.
  mob_student:        { body: 'humanoid', hair: 'bowl', weapon: 'none',
                        tie: true, coat: '#3d4658' },
  chibi_ghost:        { body: 'ghost', eyes: '#e8ecf5' },
  slime_kouhai:       { body: 'blob' },
  tiny_slime:         { body: 'blob', gridW: 15, gridH: 15 },
  crow_familiar:      { body: 'ghost', eyes: '#ff3a5e', ears: 'horns' },
  // Naked, doughy and far too cheerful about it — so no boots and no hair.
  husk_wanderer:      { body: 'humanoid', hair: 'none', eyes: '#e8ecf5',
                        barefoot: true, belt: false },
  crawler_husk:       { body: 'beast', eyes: '#e8ecf5' },
  sprinting_husk:     { body: 'humanoid', hair: 'none', eyes: '#ff3a5e',
                        barefoot: true, belt: false, weapon: 'none' },
  // A gym uniform stuck mid-relay: team bib, whistle on a lanyard, one arm out.
  gym_uniform_ghoul:  { body: 'humanoid', hair: 'buzz', eyes: '#7bf59a',
                        chest: '#ff5f6e', harness: '#c8c2ba', sash: true },
  chalk_wraith:       { body: 'ghost', eyes: '#f4f1ea' },
  // Glasses catching the signage, so the eyes never show, and bag-heavy.
  neon_otaku:         { body: 'humanoid', hair: 'bob', visor: '#7ad9ff',
                        coat: '#4a5064', weapon: 'none' },
  gacha_zombie:       { body: 'humanoid', hair: 'short', eyes: '#7bf59a',
                        coat: '#3a4260', gloves: '#5a6076' },
  cursed_desk:        { body: 'mech', eyes: '#ff3a5e', noBob: true },
  kunai_bat:          { body: 'ghost', eyes: '#ffd23f', ears: 'horns' },
  camera_drone:       { body: 'mech', wings: 'mech' },
  mascot_suit:        { body: 'blob', gridW: 28, gridH: 28, ears: 'long' },
  mascot_splinter:    { body: 'blob', gridW: 16, gridH: 16 },
  jellyfish_chorus:   { body: 'ghost', eyes: '#c58cff' },
  // A silhouette with a flak vest and nothing else readable — no face at all.
  genin_shade:        { body: 'humanoid', hair: 'hood', mask: true,
                        harness: '#3a4054', weapon: 'claws' },
  coral_crab:         { body: 'beast', ears: 'horns', pauldrons: true },
  antifan_swarm:      { body: 'ghost', eyes: '#ff3a5e' },
  anglerfish_fan:     { body: 'beast', eyes: '#ffe14a', ears: 'greatHorns' },
  // The brief is explicit that this one is HUMAN-shaped, not the horned folklore
  // version — that is the Oni Bruiser's job and the two must not converge.
  lesser_oni:         { body: 'humanoid', hair: 'wild', eyes: '#c8f57b',
                        coat: '#3a3f6a', sash: true, barefoot: true },
  oni_bruiser:        { body: 'beast', ears: 'greatHorns', gridW: 34, gridH: 34 },
  // Porcelain with a hairline crack across the face, and wet red at the joints.
  blood_doll:         { body: 'humanoid', hair: 'twin', eyes: '#ff3a5e',
                        skin: '#e8e4e0', scar: 'left', skirt: '#7a1f2b',
                        gauntlets: '#7a1f2b' },
  blood_shard:        { body: 'blob', gridW: 15, gridH: 15 },
  // Straw hat pulled down, no face under the brim, one sword.
  ronin_shade:        { body: 'humanoid', hair: 'hood', hairColor: '#8a7a52',
                        weapon: 'katana', sash: true, barefoot: true },
  ceiling_crawler:    { body: 'beast', eyes: '#ff3a5e' },
  paper_lantern_wisp: { body: 'ghost', eyes: '#ffd23f', halo: '#ffd23f' },
  encore_siren:       { body: 'humanoid', hair: 'drills', weapon: 'mic',
                        skirt: '#3a2a5a', halo: '#c8b8ff' },
  trap_scroll:        { body: 'mech', gridW: 18, gridH: 18, noBob: true },
  eel_swarm:          { body: 'ghost', eyes: '#7bf59a' },
  rubble_golem:       { body: 'beast', gridW: 34, gridH: 34, pauldrons: true,
                        eyes: '#3a3f4a' },
  ambusher:           { body: 'humanoid', hair: 'hood', weapon: 'claws' },
  // Crew tee, lanyard, and a coil of cable over the shoulder trailing like a tail.
  drowned_roadie:     { body: 'humanoid', hair: 'none', eyes: '#7bf59a',
                        coat: '#2a3a44', harness: '#c8d84a',
                        tails: 1, tailColor: '#1c2228' },
};

/** Bosses are titans unless they are clearly something else. Grids unchanged. */
const BOSS_OVERRIDES = {
  the_algorithm:      { body: 'mech', gridW: 48, gridH: 48, eyes: '#ff2d95' },
  the_colossus:       { body: 'titan', gridW: 64, gridH: 64 },
  the_kraken_producer:{ body: 'blob', gridW: 56, gridH: 56 },
  gacha_golem:        { body: 'mech', gridW: 32, gridH: 32 },
  camera_drone_elite: { body: 'mech' },
  // Not a skeleton and not a scythe: a black headset, a lanyard, and a
  // clipboard. The whole point of this one is that he is production staff.
  stage_manager:      { body: 'humanoid', hair: 'short', gridW: 26, gridH: 36,
                        outfit: '#14141c', eyes: '#ff3a5e', eyeGlow: '#ff6f6f',
                        coat: '#0d0d14', highCollar: '#0d0d14',
                        harness: '#3a3a4a', visor: '#3a3f4a',
                        gauntlets: '#3a3a4a', gloves: '#14141c',
                        blush: false, weapon: 'book' },
};

function bossDescriptor(def) {
  const spec = BOSS_OVERRIDES[def.id] || {};
  const tint = def.visual && def.visual.color ? def.visual.color : '#8a5f8f';
  const accent = def.visual && def.visual.accent ? def.visual.accent : '#ffd23f';
  return Object.assign({
    body: 'titan',
    outfit: tint,
    accent,
    eyes: '#ff3a5e',
    ears: 'horns',
    cape: true,
    chest: accent,
    gridW: 56, gridH: 56,
  }, spec);
}

/**
 * Resolve a sprite descriptor for any entity, or null when it should keep its
 * procedural shape (projectiles, gems, pickups — those read better as clean
 * geometry than as tiny sprites).
 */
export function spriteFor(kind, def) {
  if (!def) return null;
  if (kind === 'character') {
    const d = CHARACTER_SPRITES[def.id];
    return d ? Object.assign({ id: def.id }, d) : null;
  }
  if (kind === 'enemy') return Object.assign({ id: def.id }, enemyDescriptor(def));
  if (kind === 'boss') return Object.assign({ id: def.id }, bossDescriptor(def));
  return null;
}

export { ENEMY_OVERRIDES, BOSS_OVERRIDES, BODY_FOR_BEHAVIOR, BEHAVIOR_STYLE };
