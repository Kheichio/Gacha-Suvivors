// SPRITE DESCRIPTORS — the art layer.
//
// This is the file an artist replaces. Each entry names a body plan and a
// handful of features; `render/pixelArt.js` assembles the actual pixels. Swapping
// any entry for `{ sheet: 'art/hero.png', frames: 4 }` later changes nothing else.
//
// The 25 characters are hand-authored because they are what the player looks at
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
 * Body plans: humanoid | portrait | blob | ghost | beast | mech | titan | drake
 *
 * Feature vocabulary the humanoid plan understands:
 *   hair       short spiky flame wild bowl bangs bob wave long twin twinLong
 *              drills lowTwin ponytail sidetail braid topknot buzz ahoge plume
 *              ducktail undercut hood none
 *   hair extra hairColor, hairTip (gradient to a second colour), hairRoot (the
 *              INVERSE of hairTip — dark roots into a bright length), hairTie,
 *              hairStreak (ONE dyed lock in the fringe — hairTip recolours the
 *              whole mass and is not the same request), hairUnder (the INNER
 *              face of the mass in a second colour, i.e. a two-layer cut),
 *              sideBraid (a short braid at one temple, whatever the main style
 *              is), ahoge (the single antenna strand — a FLAG on any style, not
 *              a style of its own; takes its own colour)
 *   ears       fox cat rabbit elf ribbon fin horns greatHorns
 *              (+ earColor, earInner). earColor drives the horns too.
 *   headgear   crown, hat:'tricorn'|'topHat'|'beret' (+hatColor, hatTrim,
 *              hatPlume), headband (+headbandPlate — sits on the HAIRLINE),
 *              headdress (+headdressRibbon), halo,
 *              hairpin:'star'|'bell'|'carrot' (+hairpinColor, hairpinLeaf),
 *              hoodUp (an animal-head hood worn UP, LAYERED OVER the hair
 *              style; +hoodTeeth. `hair:'hood'` REPLACES the style and blacks
 *              the face out, and `hoodDown` is the same garment rolled behind
 *              the neck — three different requests, never interchangeable)
 *   face       eyes, eyeGlow, eyeSigil, visor, mask, eyepatch:'left'|'right'
 *              (+eyepatchColor, eyepatchStrap), scar:'left'|'right', whiskers,
 *              blush:false, eyeShadow (permanent dark under the eyes — blush
 *              :false only REMOVES the cheek dots and cannot add this),
 *              stubble (a TONE over the lower third of the face, not a shape)
 *   trinkets   earrings (+earringsMotif), sparks
 *   garment    coat (+coatTrim, coatLapels, coatCuffs, coatButtons,
 *              coatPattern:'check'|'stripe', coatPattern2, coatRagged),
 *              pinafore (+pinaforeTrim), hoodDown, highCollar, sailorCollar
 *              (a flat flap ACROSS THE SHOULDERS — highCollar is a stand collar
 *              reaching the jaw and is its structural opposite),
 *              skirt, shorts (a real standalone garment with a mid-thigh hem;
 *              under a skirt it stays the two-row band it always was), hakama
 *              (the LONG pleated DIVIDED one; `skirt` is a four-row mini at the
 *              hip and this is not a length setting on it),
 *              sash (+sashBuckle), belt, scarf, tie, neckBow,
 *              cravat (+cravatPin — CENTRED AND TIERED; the other three throat
 *              garments are a bow, a wrap and a knot-with-a-blade),
 *              harness, pauldrons (colour) + pauldron:'left'|'right' (one side
 *              only), gauntlets, gloves, cuffs, armWraps, detachedSleeves,
 *              boots, bootHeight:'knee'|'thigh', barefoot, sleeve, legColor,
 *              underLayer, chest (crest)
 *   extras     cape, shoulderCape, wings (feather|mech|energy|dragon),
 *              armWings, hipWings, tails 1-9 or tail:'scaled', aura, sparks,
 *              hologram, backpack (+backpackColor, strapColor), young
 *   weapon     greatsword sword cutlass katana daisho dual dualRev scythe
 *              trident spear staff gun book mic fan chakram hammer axe bow
 *              claws orb whip cards mirror carrot none
 *
 * THE SECOND ROUND OF ADDITIONS — twinLong, rabbit ears, the beret, hatTrim,
 * the eyepatch strap, coatLapels/coatCuffs/coatButtons, sashBuckle, the
 * shoulder cape and the carrot — are all the same story as the first: one
 * concrete line of somebody's refNotes that the vocabulary could not say. Every
 * one of them is OPTIONAL AND OFF BY DEFAULT, so nothing already in this table
 * changed shape when they landed. Two are worth calling out because they live
 * six pixels from something that already existed and must never be written for
 * it:
 *   coatCuffs  the deep turned-back funnel of a DRESS COAT sleeve. `cuffs` is
 *              the narrow detached band a maid wears at the wrist and belongs
 *              to no sleeve at all; this one belongs to the coat, takes its
 *              colour and carries its trim along the lip.
 *   shoulderCape a short mantle over the shoulders, worn OPEN, stopping well
 *              above the waist. `cape` is the full-length one that hangs to the
 *              boot; the two have opposite silhouettes and neither is a length
 *              setting on the other.
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
    body: 'blob', outfit: '#f4f1ea', eyes: '#141420',
    // The mouth and the ear TIPS come off this one slot, so it cannot be the
    // gem's red: the ears are white to the tip and the only pink on the creature
    // is skin — the mouth and the pads. A dusty rose gives a dark mouth line off
    // the shaded end of the ramp and a soft tip instead of a red cap on each ear.
    accent: '#d4838f',
    // A CUT RUBY, and the only saturated pixel on an otherwise white body. The
    // muted brick that was here read as a smudge on the brow rather than a stone,
    // and that stone is the single mark that identifies the design.
    chest: '#e0243c',
    ears: 'long', skin: '#f4f1ea', hair: 'none',
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
    // The gear under the coat is BLACK, not the slate-navy that was here. The
    // whole figure is one colour and the PIPING is what separates it — writing
    // the shirt as a navy made him a man in a blue top under a black coat.
    outfit: '#242733', accent: '#3fd0ff', eyes: '#4d5a75',
    // THE TRIM IS PALE, NOT THE INTERFACE COLOUR. The coat is black leather with
    // white-grey stripes down its front edges and sleeves; the light blue belongs
    // to the floating panel and to nothing he wears. Spent on the panel's colour,
    // the second half of a two-tone coat was simply absent and every light on him
    // was the same one light.
    coat: '#101018', coatTrim: '#e4eaf5', highCollar: '#101018',
    // Dark strapped bracers. Not bright metal, and not the panel blue again.
    gauntlets: '#5f6675', gloves: '#14141c', boots: '#14141c',
    // He carries TWO different blades — one jet black with a silver edge, one a
    // translucent aqua crystal — and one slot has to serve both, so it takes the
    // aqua: a black blade over a black coat on a dark stage is not a weapon.
    hologram: '#3fd0ff', weapon: 'dualRev', weaponColor: '#57d6c2',
  },

  // ★4 ----------------------------------------------------------------------
  // Stage idol, and the previous pass had her INVERTED — a near-black bob under
  // a navy costume, when the whole design is a pale blue head over a GREY CHECK.
  // Her hair is the lightest mass on the figure, not the darkest.
  //
  // Line by line: a blue SIDE-TAIL tied off with a dark ribbon; a pale star
  // pinned in it; a soft checked cap worn tilted with a small gold coronet on
  // top; a grey plaid jacket over white, a broad blue band knotted at the
  // throat, a deep blue ruffled skirt; long dark socks under ankle boots.
  //
  // The eyepatch is gone. It was faking a fringe over one eye that this design
  // does not have — both eyes show, and what they carry instead is a second
  // glint standing in for the star-shaped highlight in the iris.
  hoshino_rei: {
    body: 'humanoid',
    hair: 'sidetail', hairColor: '#7ba0e0', hairTie: '#2b3576', skin: '#f7d3b4',
    hairpin: 'star', hairpinColor: '#eaf1ff',
    outfit: '#e6e4ee', accent: '#3f6ad8', eyes: '#3f86e8',
    eyeSigil: '#f4f1ea',
    // `crown` runs BEFORE the hat branches, so its band is buried and only the
    // points clear the cap. That is exactly the read wanted here: an ornament
    // pinned on top, not a coronet worn round the skull.
    hat: 'beret', hatColor: '#8d8a99', crown: '#ffd23f',
    // The check is a PLAID, which is a texture, not a chessboard: two greys a
    // step apart. At the contrast the first pass used it read as a checkerboard
    // flag and it was the loudest thing in the frame.
    coat: '#9a97a6', coatPattern: 'check', coatPattern2: '#82808f',
    coatTrim: '#f4f1ea', sleeve: '#9a97a6',
    underLayer: '#f4f1ea', scarf: '#3f6ad8', cuffs: '#f4f1ea', gloves: '#f4f1ea',
    chest: '#e8eeff',
    skirt: '#31459e', sash: '#2b3576',
    legColor: '#2e3a68', boots: '#20263f',
    // Comet white-blue rather than gold: the motes are a comet's tail.
    aura: '#a8d0ff', weapon: 'mic', weaponColor: '#e8ecf5',
  },
  // The avenger, drawn at the age the whole kit is written for: a dark blue
  // STAND COLLAR, the round clan crest, WHITE ARM WRAPS, BLACK SHORTS, swept
  // duck-tail hair and red eyes carrying a ring sigil. The face wrap an earlier
  // pass gave him belongs to a different ninja entirely, and taking it off is
  // what lets the eyes do the work they are supposed to do.
  //   `young`   a real proportion change (bigger head, narrower shoulders), not
  //             a scale. He is a boy, and he stands next to his rival on the
  //             roster grid, so it has to survive being 30px tall.
  //   `chest`   the crest belongs on the BACK of the collar; the sprite is
  //             front-facing and the vocabulary has no back, so it is worn where
  //             it can actually be read. Same compromise the other crests take.
  //   `chakram` a ring drawn IN THE AIR beside the head — a thrown blade, which
  //             is literally his auto-attack. Deliberately not a sword: he has
  //             no sword at this age, and an empty pair of hands is his rival's
  //             silhouette, not his.
  yamikage: {
    body: 'humanoid', young: true,
    // Black with a strong BLUE cast, not a flat near-black: the swept tail is a
    // silhouette feature and it has to hold an edge on a dark stage.
    hair: 'ducktail', hairColor: '#252c4c', skin: '#f6d6bb',
    // A clearly BLUE navy. #243050 read as dark slate-purple, and this is the
    // single biggest colour block on him. He is also conspicuously pale — the
    // old skin was a tan.
    outfit: '#2c4a80', accent: '#eceef4', eyes: '#ff3a3a', eyeGlow: '#ff6f6f',
    eyeSigil: '#14141c', highCollar: '#233c68', chest: '#c81e3a',
    // The plated brow band, on BLUE cloth. It sits above the brow, so the fringe
    // and the ring sigil in the eye both survive it.
    headband: '#233c68', headbandPlate: '#c8d2e0',
    // The arm warmers are WHITE and run over the back of the hand, so the hands
    // are the same value as the forearms rather than a dark break between them.
    armWraps: '#eceef4', gloves: '#d4d9e4',
    // WHITE shorts, bare shins, low sandals. `sash` is gone: there is no obi at
    // this age, which lets the plain belt draw instead, and `bootHeight:'knee'`
    // is gone because a knee boot is a completely different lower silhouette.
    shorts: '#e2e6ef', legColor: '#f6d6bb', boots: '#1e3158', blush: false,
    weapon: 'chakram', weaponColor: '#c8d2e6',
  },
  // His opposite number in every way: blond spikes instead of a dark sweep, a
  // plated forehead band, THREE whisker marks on each cheek, an orange-and-black
  // jumpsuit and ONE spirit tail. Bare-faced and unarmed, on purpose.
  //
  // `young` because he is: the brief is the child, not the man he becomes, and
  // the bigger head on the narrower frame is what says so beside a rival who is
  // drawn at full adult proportions. One tail rather than three for the same
  // reason — the extra tails belong to a later version of this character.
  uzu: {
    // A shade deeper than the other orange gi on purpose: they are the only two
    // orange characters and they sit next to each other on the roster grid.
    body: 'humanoid', young: true,
    hair: 'spiky', hairColor: '#f7d94e', skin: '#f5cba0',
    // THE SUIT IS ORANGE AND BLUE, NOT ORANGE AND BLACK, and so is the brow
    // band's cloth. At the age this figure is drawn every dark panel on the
    // jumpsuit — shoulders, collar, waist, boots — is a deep blue; the near-black
    // the previous pass used belongs to the older version of the design and it
    // also made him read as the same two colours as the rival beside him.
    outfit: '#ef7318', accent: '#263b6e', eyes: '#4aa8ff',
    whiskers: true, headband: '#263b6e', headbandPlate: '#c8d2e0',
    sleeve: '#263b6e', highCollar: '#263b6e', sash: '#263b6e',
    chest: '#e8e8f0',
    tails: 1, tailColor: '#ff6a1a',
    // No gloves and no gauntlets: the hands are bare at this age, and the
    // sleeves already carry the whole of the second colour.
    boots: '#263b6e', weapon: 'none',
  },
  // Short black UNDERCUT, a white cravat at the throat, and the aerial-manoeuvre
  // harness. No blush and a flat mouth: the expression is the character.
  //
  // THE JACKET IS LIGHT TAN. It was a dark army olive, the same value as the
  // cloak over it, so the two garments fused and the one item the whole uniform
  // is named for was invisible. Everything else follows from putting it right:
  // the trousers are cream and now have to be declared (`legColor`, or they
  // inherit the jacket), the harness goes warm brown leather so it still reads
  // against tan, and the boots go mid-brown. Bare hands — the white gloves
  // belong to the cleaning gag, not to the combat silhouette. Pale steel-GREY
  // eyes, lifted off the near-black slate that at this size is not a dark eye.
  captain_yuli: {
    body: 'humanoid', hair: 'undercut', hairColor: '#1d1e2a', skin: '#f4d7be',
    outfit: '#a08d6a', accent: '#e8e2d2', eyes: '#7d8a99',
    // The permanent shadows under the eyes. Together with the narrow lids they
    // ARE the face — `blush: false` only takes the cheek dots away, and an
    // expression that is the whole character cannot be spelled as an absence.
    eyeShadow: '#3a2a38',
    // A tiered white cravat, not a scarf. `scarf` is wrapped cloth with one long
    // end whipping out to the side; this is centred, stacked and frilled.
    cravat: '#f4f1ea', cravatPin: '#c8b88a',
    cape: '#5c6a4a', harness: '#7a5c38',
    chest: '#8ab0d8', legColor: '#e6e1d2',
    boots: '#5c3f26', bootHeight: 'knee',
    blush: false, weapon: 'dual', weaponColor: '#cfd8e6',
  },
  // Shrine fox, rebuilt line by line against the brief.
  //
  // VERY LONG ROSE TWIN-TAILS with gold ties — long loose hair was half of it
  // and the half that was missing is the half you can name her by. Large
  // GOLDEN-BLONDE fox ears rather than pink ones. NINE tails. A modernised
  // shrine outfit: a white top with wide DETACHED SLEEVES over a VERMILION
  // HAKAMA, which is the signature colour of the whole design and which the
  // previous pass had as a blue mini — `skirt` was the only garment the
  // vocabulary had and it says "school uniform", so the one thing the costume
  // is famous for was both the wrong shape and the wrong colour. Gold at the
  // ties, the obi plate, the collar and the mirror's rim; a large gold BELL on
  // the crown between the ears; warm gold-amber eyes; and the polished mirror
  // she actually carries instead of the war fan she does not.
  //
  // 40x54, for the same reason as the captain and the rabbit: at 30x42 the
  // twin-tail falls, the nine-tail fan and the weapon column all want the same
  // six columns and two of the three have to lose.
  //
  // The tails run PALE GOLD and not her hair's pink, which is the one place the
  // drawing argues with the reference and wins. Nine tails in the same pink as
  // forty rows of hair hanging through the same rows is one pink mass with no
  // count in it, and the count is the character; in the ears' gold they read as
  // the fox half of her and the hair reads as the girl half.
  kagura: {
    body: 'humanoid', gridW: 40, gridH: 54,
    // The pink is WARM — a rose, not a cotton-candy magenta. The blue channel is
    // what was wrong: at this hair volume a cool pink turns the whole figure
    // lilac, and the hair is more than half of what is on screen.
    hair: 'twinLong', hairColor: '#f08cab', hairTie: '#e8c34a', skin: '#fadbc4',
    outfit: '#f7f4ec', accent: '#e8c34a', eyes: '#f4c23a',
    // FUR blonde, not the metal gold of the bell and the buckle. Five rows tall
    // and two pixels from the hairpin, ears sharing its colour stop being ears
    // and become one more piece of jewellery.
    ears: 'fox', earColor: '#e6c07c',
    detachedSleeves: '#fff0d8',
    hakama: '#d93a2b', sash: '#a3182f', sashBuckle: '#e8c34a',
    hairpin: 'bell', hairpinColor: '#f0c24a',
    tails: 9, tailColor: '#ffe9c0',
    // The crest is the only red a BUST gets: a head-and-shoulders crop throws
    // the hakama away entirely, and a portrait of this character with none of
    // her signature colour in it is a different person in a white shirt.
    chest: '#d93a2b', boots: '#f0ece2', aura: '#ffd76a',
    weapon: 'mirror', weaponColor: '#eef2f8',
  },
  // A stream overlay given a body: ribbon aerials shaped like headset ears, a
  // white-and-pink HOODED dress, THIGH-HIGH socks, a status halo that is
  // actually visible, and pixel motes shedding off her.
  //
  // The pink was doing every job on this entry — hair accent, eyes, boots,
  // gloves, halo, crest — which is how a two-colour character becomes a
  // one-colour one. Three corrections:
  //   the EYES ARE GREEN, and they are the only thing on her that is neither
  //     white nor pink. An eye in the accent colour is no eye at all;
  //   the pink lives IN THE HAIR, brown at the root running vivid by the ends,
  //     which is the detail she is described by more often than any garment;
  //   the legs are white socks over a bare strip of thigh, not solid pink boots,
  //     so the figure finally has a break in it below the waist.
  // The top is also SLEEVELESS with separate arm coverings — `detachedSleeves`,
  // not `gloves` — and the hands are bare.
  unit_09: {
    body: 'humanoid', hair: 'long', hairColor: '#ac7f52', hairTip: '#ff5c9e',
    skin: '#fbdcc4',
    outfit: '#f7f2f4', accent: '#ff5c9e', eyes: '#3ed2a0',
    ears: 'ribbon', halo: '#ff7ab8', chest: '#ff5c9e', aura: '#ff7ab8',
    coat: '#f4eef1', coatTrim: '#ff5c9e', hoodDown: '#ff5c9e',
    detachedSleeves: '#f4eef1',
    shorts: '#efe9ee', legColor: '#fbdcc4',
    boots: '#eee8ee', bootHeight: 'thigh', weapon: 'none',
  },

  // ★5 ----------------------------------------------------------------------
  // Burgundy hair tied back, red-brown eyes, a SCAR the fringe parts around,
  // rectangular drop EARRINGS, a black-and-green CHECKERED haori, and the large
  // wooden BOX strapped to his back that the whole character is built around.
  // The blade runs pale blue because every run starts in the water form.
  rin: {
    // Dark at the root, flame at the ends. The gradient is canon, not a flourish.
    body: 'humanoid', hair: 'ponytail', hairColor: '#6e2a24', hairTip: '#c2472a',
    skin: '#f4cda6',
    // THE UNIFORM UNDER THE HAORI IS BLACK. It was a dark green, so the figure
    // carried THREE greens — uniform, haori, check, sash — in one hue family and
    // the checkered pattern, which is the whole read, barely existed. The haori
    // also goes a true warm forest green: the old value was a teal, i.e. the
    // check was blue-green squares on green-black squares.
    outfit: '#22242a', accent: '#35844f', eyes: '#b0382c',
    coat: '#2b7a46', coatPattern: 'check', coatPattern2: '#181b1e',
    coatTrim: '#1a1d20', sash: '#2a2d34',
    // Pale wraps and rope sandals — the only light note below the waist, and
    // previously a near-black that merged with the trousers.
    boots: '#ece5d6',
    scar: 'right', earrings: '#f4f1ea', earringsMotif: '#c8342a',
    backpack: 'box', backpackColor: '#8a6039', strapColor: '#3a2a1c',
    weapon: 'katana', weaponColor: '#8ad8ff',
  },
  // The ronin. Sun-darkened, scarred, roughly tied hair, a TORN kimono, NO
  // armour and BARE FEET, and the long-and-short pair drawn at once so the
  // length difference — which is the entire school — is impossible to miss.
  // Heavy blacks with one red accent, per the ink-wash direction. The hem is
  // ragged: he is the only person on the roster wearing rags and a garment that
  // ends in a ruled line has been laundered.
  //
  // `topknot` was exactly backwards: the neat oiled bun on a shaved pate is a
  // RETAINED samurai's hairstyle, which is the one thing this character is not.
  // His is a long, roughly tied, unwashed mass — `ponytail`, with a cord.
  //
  // Three separated near-blacks rather than two identical ones. `outfit` and
  // `coat` were 0x11 apart, so from the chest down he was a single flat slab
  // with no garment in it, and the one red accent was spent TWICE — on the
  // coat's trim and on the sash — when the brief is explicit that there is one.
  // The trim is now the worn kimono's bone-coloured inner edge, and the red is
  // at the waist only, which is exactly where both blades are thrust through.
  niten: {
    body: 'humanoid', hair: 'ponytail', hairColor: '#241f1a', hairTie: '#6b5c46',
    skin: '#c9955f',
    outfit: '#2a2721', accent: '#8f1f1f', eyes: '#3a3028',
    // Stubble and a short beard round the mouth. It is the only thing on the
    // whole roster that says "adult, years on the road" rather than "young man",
    // and at this size it is a TONE across the lower third of the face, not a
    // drawn shape — a drawn beard here is a smudge.
    stubble: '#3a3028',
    coat: '#3b362d', coatTrim: '#8d8574', coatRagged: true,
    hakama: '#22201b',
    sash: '#8f1f1f', belt: false,
    barefoot: true, scar: 'left', blush: false,
    weapon: 'daisho', weaponColor: '#e0e6ee',
  },
  // Deep-sea, and VERY SMALL — a bigger head on a narrower frame, which is the
  // whole reason the humanoid plan learned about proportion. Dorsal fin on the
  // crown, pale twin-tails, a HOODIE over the suit with the hood down behind the
  // neck, a tail, and a gold trident.
  //
  // Half this palette is CYAN and the previous pass spent none of it on the
  // face: the eyes were a muted grey-blue, and the eye is the only place on a
  // head this size that a costume colour can land. The trident went gold, which
  // is a colour that appears nowhere on the design — it is teal on a navy shaft.
  // The socks and shoes were also inverted: dark shoes over pale legs, when it
  // is dark socks under WHITE trainers.
  shiro_same: {
    body: 'humanoid', young: true,
    hair: 'twin', hairColor: '#dff4ff', hairTie: '#1f5fa8',
    // Cobalt strands run through the white mass; one dyed lock in the fringe is
    // as close as the vocabulary gets, and it is close enough at this size.
    hairStreak: '#2f7fd6', skin: '#fbe0cc',
    outfit: '#5fd6ff', accent: '#0b3d5c', eyes: '#3fd0f5',
    // The top runs a deep cerulean fading to white at the cuffs and hem, so the
    // sleeves take the pale end of that ramp and the hands stay bare skin — the
    // greeting gesture is made with them. Grey shirt showing underneath, and the
    // toothed mouth printed across the front as the chest graphic.
    coat: '#2775c4', coatTrim: '#f0f8ff', sleeve: '#e6f3ff',
    underLayer: '#9aa8b4', chest: '#f0f8ff',
    // THE HOOD IS UP, and it is the single most recognisable thing about the
    // design — an animal head worn over the skull with a row of teeth round the
    // opening, a fin on the crown and side fins at the cheeks. It was written as
    // `hoodDown` because an up-hood was unsayable without blacking the face out
    // entirely, so the character was drawn wearing her signature behind her neck.
    hoodUp: '#2775c4', hoodTeeth: '#f4f7ff',
    ears: 'fin', earColor: '#2775c4',
    tails: 1, tailColor: '#3d92c8',
    legColor: '#24406e', boots: '#eef4fa',
    weapon: 'trident', weaponColor: '#38dcc8', gripColor: '#0b3d5c',
  },
  // Electromaster. Short brown bob, cream winter uniform, the BROWN skirt with
  // SHORTS visible under it, a red collar RIBBON — a bow, which is a different
  // garment from the scarf that used to stand in for it — the flicked token as
  // her crest, and arcs coming off the bangs rather than a generic aura.
  //
  // THE VEST WAS MISSING. The uniform is a light-brown knit over a WHITE
  // blouse, and that two-tone torso is the single most recognisable thing about
  // it — without the knit she was a girl in a cream shirt. Everything else on
  // the entry follows: the skirt has to go grey-taupe so it sits UNDER the knit
  // instead of continuing it, the shorts under it go light (they are a running
  // gag and a near-black band there reads as a shadow), and the knee boots go
  // entirely — she wears loafers, and the bare leg between hem and shoe is most
  // of the silhouette. Eyes are the same chestnut as the hair, per canon.
  reika: {
    body: 'humanoid', hair: 'bob', hairColor: '#a97a4c', skin: '#fbdcc0',
    outfit: '#f4f1ea', accent: '#a8834c', eyes: '#8f5c2e',
    coat: '#c9a273', coatTrim: '#a8834c', underLayer: '#f7f4ec',
    neckBow: '#c8323c',
    skirt: '#7a6f5e', shorts: '#e4e9f0',
    sparks: '#8fe6ff', chest: '#e8c34a', aura: '#7ad9ff',
    boots: '#5a4130', weapon: 'none',
  },
  // Grave idol. Long pink hair, red eyes, and a full-size scythe.
  //
  // THE COSTUME IS BLACK AND GOLD. The previous pass spent the trim, the arm
  // bands AND the belt on the same red, so an accent used four times stopped
  // being an accent and became the base colour — and the gold, which is half of
  // what she wears, was not on the figure anywhere. The red is now spent ONCE,
  // on the diamond brooch at the throat, plus the deep red lining showing
  // through the gown's slit.
  //
  // There is no top hat either. It is a small dark SPIKED CIRCLET worn on the
  // skull, and the one shape that headpiece does not have is a brim — which is
  // the only thing `hat` draws. `crown` is the closer word, nudged two steps off
  // black so eleven pixels of it still read against a dark arena.
  nekromina: {
    body: 'humanoid', hair: 'long', hairColor: '#f0a0c2', skin: '#f7dccb',
    outfit: '#221a2c', accent: '#c8203a', eyes: '#ff3a5e', eyeGlow: '#ff7a90',
    crown: '#2e2438',
    coat: '#1a1424', coatTrim: '#c9a24e', highCollar: '#241c30',
    underLayer: '#a01a30',
    // The outer layer is BLACK and torn, not maroon, and it carries hard spiked
    // shoulder pieces — one step lighter than the gown so the two layers do not
    // fuse into a single dark slab.
    cape: '#2a2136', pauldrons: '#3a2f48',
    sash: '#8f8c98', chest: '#c8203a',
    // Gold rings on the forearms, and BARE HANDS: no gloves anywhere on her.
    gauntlets: '#c9a24e', gloves: '#f7dccb',
    boots: '#2a2233', bootHeight: 'thigh',
    weapon: 'scythe', weaponColor: '#dfe8f5',
  },
  // Phoenix. Burning wings, FEATHER ACCENTS ON THE ARMS specifically, two tail
  // plumes, and embers coming off her.
  //
  // She was drawn monochrome orange and she is not: the design is orange, WHITE
  // and dark blue, her hair fades TEAL-GREEN at the ends, and her eyes are a
  // vivid MAGENTA — the deliberate complement to the hair, and the worst error
  // in the old entry, because an amber iris under an orange fringe is not a dark
  // eye, it is no eye. The crest of feathers is not her hair either; the hair is
  // ordinary and long and merely feathery, so `wave` and not `plume`, and the
  // crown it was wearing over it is regalia this costume does not have.
  hikari: {
    body: 'humanoid', hair: 'wave', hairColor: '#ff7a2b', hairTip: '#2fb08c',
    skin: '#fbdcc4',
    outfit: '#ff9a3d', accent: '#ffd23f', eyes: '#e34bb8',
    // Two clusters of luminous green-teal feathers just behind the ears. Every
    // reader takes them for earrings, which is exactly what the slot draws, and
    // at this size they are the second colour on the head.
    earrings: '#3fd6b0', earringsMotif: '#8ff5e0',
    neckBow: '#2fb08c', underLayer: '#f4f1ea', skirt: '#f4703a',
    sash: '#2b3a66',
    // The wings still run DEEPER than the outfit, not lighter: at a near-match
    // the whole figure fused into one orange mass with no silhouette at all.
    wings: 'feather', wingColor: '#d9541e',
    armWings: '#ffd23f', tails: 2, tailColor: '#ff6a1a',
    aura: '#ffd23f', chest: '#ffd23f',
    // WHITE thigh-highs, which is what she wears and which also stops the legs
    // being one more column of orange under an orange skirt.
    boots: '#f2ece0', bootHeight: 'thigh', weapon: 'none',
  },
  // The administrator. Immaculate: neat brown hair, brown eyes, a school blazer
  // and a TIE, perfect posture, no expression, and a PLAIN BLACK notebook. He is
  // the only person on the roster whose weapon is stationery, and the design
  // note is that nothing about him should look like it fights.
  //
  // THE BLAZER IS TAN. A charcoal one is a business suit worn by a man with a
  // job; this is a school uniform, it is light, and at portrait size the coat
  // colour is most of what anybody sees of him. With the coat pale the white
  // shirt now has to be declared or the two fuse, the lapels have to exist or
  // there is no frame round the tie, and the trousers go olive rather than
  // inheriting the shirt. The hair goes a light warm chestnut too — a dark
  // brown at this size is simply black, and black is somebody else's hair.
  kira: {
    body: 'humanoid', hair: 'short', hairColor: '#a06b3d', skin: '#f7d8bc',
    outfit: '#e8e4dc', accent: '#b0303a', eyes: '#8f5c30',
    coat: '#c4ad80', coatTrim: '#9a8354', coatLapels: '#ab9464',
    underLayer: '#f4f1ea',
    // A step brighter than a maroon: six pixels of the only saturated colour on
    // the figure, on a pale blazer, and a dark red there is a shadow in a shirt.
    tie: '#b0303a', legColor: '#6e684a',
    gloves: '#f7d8bc', boots: '#22222b', blush: false,
    weapon: 'book', weaponColor: '#33333e',
  },

  // The white fox broadcaster. Deliberately the OPPOSITE read to the pink
  // nine-tailed shrine fox: a white SIDETAIL rather than long loose hair, white
  // fox ears, exactly ONE tail, a modern collared jacket with a tie instead of a
  // shrine robe, and a fan of contracts in her hand instead of a mirror.
  //
  // Corrections, all of them the same mistake in different places: the one
  // saturated colour on this design lives at the THROAT and nowhere else, and
  // the previous pass had smeared it through the hair tie, a dyed streak, the
  // ear lining and the coat trim while the eyes — the only face colour she has
  // — were painted yellow-green. They are AQUA. The hair is uniformly white,
  // tied LOW at the nape with a BLACK ribbon; the ear tufts are dark; there is
  // no jacket at all, just a pale blouse over a black inner layer; and the
  // neckwear is a sailor BOW, not a necktie with a blade down the shirt.
  yukine: {
    body: 'humanoid', hair: 'ponytail', hairColor: '#f2f6ff', hairTie: '#1e1e28',
    skin: '#fbe0cc', outfit: '#f2f6fb', accent: '#2fc8e0', eyes: '#5fd9e6',
    // The one small braid at the temple, a shade under the main white so it
    // reads as a separate strand rather than as a fold in the same mass.
    sideBraid: '#e2e9f5',
    // A prominent antenna strand standing out of otherwise tied hair. `ahoge`
    // used to be a whole hairstyle, so it was mutually exclusive with the
    // ponytail and the strand simply lost.
    ahoge: true,
    ears: 'fox', earColor: '#f2f6ff', earInner: '#2a2732',
    // A flat SAILOR collar across the shoulders, which is what the top has —
    // `highCollar` is a stand collar reaching the jaw and is its opposite.
    sailorCollar: '#1c1c26',
    underLayer: '#1c1c26', neckBow: '#2fc8e0',
    detachedSleeves: '#eef3fb',
    skirt: '#1e2130',
    tails: 1, tailColor: '#eef4fb',
    boots: '#22222e', bootHeight: 'knee',
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
  //
  // THE LAYERS WERE INVERTED and the haircut was invented. Her hair is LONG —
  // waist-length and worn loose, not a bowl cut, and there is no braid on her
  // anywhere. The outer garment is a near-black robe worn OPEN over a pale
  // ankle-length dress; the previous pass had a white cape over a grey-brown
  // travelling dress, which is that arrangement turned inside out. She is also
  // not a child: she is the TALLER of the two mages, so `young` — which buys a
  // bigger head on a narrower frame — is the one proportion she must not have.
  // And she is never bare-handed: it is a plain wooden staff, ribbon-wrapped.
  wren: {
    body: 'humanoid',
    hair: 'long', hairColor: '#8d78ab', skin: '#f7d8bc',
    outfit: '#f2efe6', accent: '#7a5fa8', eyes: '#8f6ad6',
    coat: '#302c3c', coatTrim: '#4a4458', highCollar: '#f2efe6',
    // The dress falls to the ankle, so the legs take the GARMENT's colour rather
    // than skin. `skirt` is a four-row mini at the hip and `hakama` is pleated
    // and divided; neither is a long plain hem, and this is the only thing in
    // the vocabulary that can say one.
    legColor: '#e7e2d6',
    boots: '#2a2732',
    sparks: '#c3a8ff', blush: false,
    weapon: 'staff', weaponColor: '#8a6a4a', gripColor: '#7a5fa8',
  },
  // The warrior. Shaggy RED hair, blue eyes, a heavy blue-grey fur-collared coat
  // over MAIL (showing at the neck), wrapped forearms, one shoulder plate each
  // side, and the enormous two-handed AXE he never puts down. It is an axe in
  // the brief and in his relic, and the hammer the previous pass gave him is a
  // different weapon with a different silhouette. The biggest read in the cast
  // and the only red head.
  //
  // HE WEARS NO ARMOUR. The mail at the neck, the shoulder plates and the steel
  // gauntlets were all invented — under the coat is a plain black collared
  // shirt and baggy black trousers, and the coat itself is BRICK RED with broad
  // CREAM lapels and cream turned-back cuffs, not a blue-grey one with a fur
  // collar. His eyes are ORANGE, not blue. And the large forehead SCAR is his
  // one permanent facial feature and was simply absent.
  brant: {
    body: 'humanoid', hair: 'wild', hairColor: '#e0562c', skin: '#f0c9a8',
    // Bright red growing out of visibly DARK roots — the inverse of `hairTip`,
    // which gradients the ends, and previously unsayable, so the head had to be
    // one flat colour.
    hairRoot: '#7a2a1c',
    outfit: '#20202a', accent: '#e8ddc4', eyes: '#e8842e',
    scar: 'left',
    // A deeper brick than the head on purpose: hair and coat are both red, and
    // at a near-match the two fuse into one mass with no shoulders in it. The
    // cream shawl collar and the cream cuffs are the break between them.
    coat: '#a3332c', coatLapels: '#e8ddc4',
    sleeve: '#a3332c', coatCuffs: '#e8ddc4',
    highCollar: '#24242e', sash: '#e8e2d4',
    gloves: '#1e1e28', harness: '#5a4a38',
    legColor: '#22222c', boots: '#1c1c24', bootHeight: 'knee',
    // Brighter than the coat on purpose: the axe head passes right over the
    // shoulder, and at a near-match the two share an outline and fuse.
    blush: false, weapon: 'axe', weaponColor: '#d2dced',
  },

  // ★6 ----------------------------------------------------------------------
  // The dragon queen. Blonde hair running to orange-red AT THE TIPS, curved
  // great horns under a crown, one long SCALED TAIL rather than a pair of
  // brushes, WING ORNAMENTS AT THE HIPS rather than wings on the back, orange
  // eyes, and a gold mote field. Every one of those is the brief, verbatim.
  //
  // SHE WAS DRAWN ORANGE ON ORANGE and the costume's two dominant colours are
  // BLACK and RED. Corrections, top to bottom: the hair is a solid warm orange
  // mass with ONE bright yellow lock and a thin braid, not a blonde running to
  // red at the tips; the horns are a dark red-VIOLET and are the strongest
  // contrast on the head, so they need their own colour or they inherit the
  // gold; the eyes are hot pink grading to violet; the tail is that same violet
  // and is her true colour, which is why horns and tail agree; there is no
  // crown (a plain brown brow band) and there are no wings at all in this form.
  // The garment is a uniform JACKET — black body, gold piping, purple folded
  // collar and turned-back cuffs — over a white frilled shirt, with a red
  // pleated skirt and a gold waist clasp, and low brown loafers over black hose.
  sovereign_alicia: {
    body: 'humanoid', hair: 'long', hairColor: '#f2913a',
    hairStreak: '#ffd94f', sideBraid: '#f7bb45', skin: '#fbdcc4',
    outfit: '#1b1924', accent: '#e8c34a',
    eyes: '#e8477e', eyeGlow: '#c07ae8',
    ears: 'greatHorns', earColor: '#6b4a82', headband: '#7a5230',
    tail: 'scaled', tailColor: '#7d52a8',
    coat: '#282430', coatTrim: '#e8c34a',
    coatLapels: '#6b4a92', coatCuffs: '#6b4a92',
    underLayer: '#f7f4ec', chest: '#c8203a',
    skirt: '#c42232', sash: '#8f1428', sashBuckle: '#e8c34a',
    legColor: '#201e28', boots: '#6a4a30',
    aura: '#ffd76a', weapon: 'none',
  },
  // Orange gi with the BLUE UNDERSHIRT showing at the collar, a blue belt, blue
  // wristbands and boots, and hair that goes straight up. Unarmed, silver-eyed,
  // standing in a column of white ki motes.
  sora: {
    body: 'humanoid', hair: 'flame', hairColor: '#15151f', skin: '#f5cba0',
    // A deeper, greener cobalt than the bright royal blue it had. The belt, the
    // undershirt, the wristbands and the boots are all ONE colour on him, so
    // that colour is doing four jobs and has to be the right one. The eyes come
    // off near-black for the same reason every other dark iris here does.
    outfit: '#ff8a2b', accent: '#2f56b4', eyes: '#4a4e63', eyeGlow: '#e8eef8',
    underLayer: '#2f56b4', sash: '#2f56b4', sleeve: '#ff7a1a',
    gauntlets: '#2f56b4',
    // Black ink on orange, which is what the school patch actually is. A white
    // patch put the one thing on his chest in a colour he does not wear.
    chest: '#2a2230',
    boots: '#2f56b4', bootHeight: 'knee',
    // White-GOLD, not white: the charge flare and the silver-eyed state must not
    // be the same colour or the transformation has nothing left to announce.
    aura: '#fff2cf', weapon: 'none',
  },
  // His counterweight, pinned to the tournament design the brief names: spiky
  // black hair, a PURPLE gi over a blue undershirt, ONE shoulder pad on the left
  // only, a white cape, and a small young frame. The glasses and bowl cut the
  // previous pass gave him are from a later look and are gone.
  han: {
    body: 'humanoid', young: true,
    hair: 'spiky', hairColor: '#15151f', skin: '#f5cba0',
    // A DARK violet, with LIGHT SKY BLUE as the second colour — deliberately
    // paler than the navy on the other unarmed fighter, because that gap is
    // most of what tells the two of them apart at portrait size. There is no
    // gold on this costume: the gi is plain, with no crest of any kind, and the
    // obi, the undershirt and the wristbands are all the same light blue.
    outfit: '#6e4f9e', accent: '#7ab6e8',
    eyes: '#4a4e63', eyeGlow: '#5fe0c8',
    underLayer: '#6fb0e0', sash: '#6fb0e0', gauntlets: '#5aa0d8',
    // The borrowed weighted mantle: a white cape hung off a SYMMETRIC PAIR of
    // white shoulder plates. They come as a set with the cape; one side only was
    // a different garment entirely.
    pauldrons: '#eae7de', cape: '#eae7de',
    // Low pointed shoes, so the gi trousers run most of the leg.
    boots: '#2e3552',
    // Gold aura with LIGHTNING crawling over it, which is the loudest thing
    // about him and which the vocabulary already had a word for.
    aura: '#ffd84a', sparks: '#ffe98a', weapon: 'none',
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
  //
  // EVERY RIBBON ON HER IS BLUE. The drill ties, the band on the cap and the bow
  // at the throat are one navy, and the previous pass had white ties and a RED
  // bow — a colour that appears nowhere on this design. The hair was wrong too:
  // a blue-violet periwinkle, when it is a RED-leaning orchid purple with a dyed
  // light-blue lock through the fringe, and the eyes are a vivid purple-magenta
  // rather than one more shade of the same periwinkle. The sleeves are ATTACHED
  // and puffy — `detachedSleeves` is the wide hanging shrine sleeve and belongs
  // to another entry — and under the skirt are pale stockings with short shoes,
  // which knee boots were swallowing whole.
  aoi: {
    body: 'humanoid', hair: 'drills', hairColor: '#a274c8', hairTie: '#2f4c9e',
    // The dyed light-blue lock in the fringe, the same blue standing up as an
    // antenna strand above the drills, and the INNER face of each drill in that
    // blue as well — the two-tone the whole design is built on, and none of the
    // three were sayable before: `ahoge` was a hairstyle rather than a flag, and
    // `hairTip` recolours the entire mass rather than its underside.
    hairStreak: '#6fd4ec', ahoge: '#6fd4ec', hairUnder: '#6fd4ec',
    skin: '#fbe0cc', outfit: '#1e2440', accent: '#f4f1ea', eyes: '#c25ce0',
    headdress: '#f4f1ea', headdressRibbon: '#2f4c9e', neckBow: '#3a5cb8',
    pinafore: '#f4f1ea', pinaforeTrim: '#c9cfe4',
    sleeve: '#f7f4ec', cuffs: '#f4f1ea',
    chest: '#2f4c9e',
    skirt: '#1e2440',
    legColor: '#f2eee6', boots: '#232a4a',
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
    outfit: '#efe8da', accent: '#c8a24a', eyes: '#6ad89a',
    ears: 'elf', earColor: '#fbe0cc',
    // A SHORT WHITE MANTLE, not a full-length dark one. `cape` hangs to the boot
    // and this stops above the waist, which is the opposite silhouette. It is
    // also the top layer, so it takes the brightest white and the jacket under
    // it goes a shade warmer — a mantle within a shade of the garment it covers
    // is not a mantle, it is a fold.
    shoulderCape: '#faf7f0', highCollar: '#faf7f0',
    coat: '#ebe4d6', coatTrim: '#c8a24a',
    // The black-and-white striped shirt showing at the collar, averaged: two
    // alternating values inside one pixel is a mid grey, so a mid grey it is.
    underLayer: '#5a5866',
    // The one warm colour anywhere on her: the gem that closes the collar.
    chest: '#c8342a',
    earrings: '#c8a24a', earringsMotif: '#c8342a',
    // A BLACK belt with a gold clasp. Gold at the waist was the fourth gold on a
    // white figure and read as one more piece of trim rather than as a break.
    skirt: '#e9e1d3', sash: '#2e2a38', sashBuckle: '#c8a24a',
    legColor: '#2a2634', boots: '#5a4a38', bootHeight: 'knee',
    blush: false, aura: '#dff4e8', weapon: 'staff', weaponColor: '#8a6a4a',
  },
  // EVERYTHING IS RED, and she is the most detailed figure in the cast, because
  // the promotion out of the ★5 bracket is a promise the art has to keep: she is
  // now the character the rainbow pull beam lands on and the one the splash
  // screen holds a silent beat for, and a ★5-grade drawing under a ★6 banner is
  // the single most visible way to break that.
  //
  // She is drawn on a 38x54 grid rather than the roster's 30x42 — the atlas
  // divides the integer upscale back out, so a finer grid costs nothing on
  // screen and buys the room the brief actually needs: a coat with lapels AND
  // cuffs AND two rows of buttons, a hat with a cocked brim AND a crown AND a
  // plume, and a face carrying an eyepatch, its strap and its buckle at once.
  // At 30x42 those collapse into each other and she reads as a red smear.
  //
  // Line by line: long black twin-tails with red ribbons — LONG, which `twin`
  // could not say and `twinLong` now can; a red captain's coat worn OPEN over
  // red-and-white, with real notched lapels, deep turned-back cuffs and a
  // double row of gold buttons; a huge red tricorn with a white plume; gold
  // trim on every edge of it; an eyepatch, with the strap the previous pass
  // drew under the fringe where nobody could see it; and a CURVED cutlass.
  //
  // HER HAIR IS RED, and the near-black it had was the single biggest error in
  // this whole table: long crimson twin-tails are the first thing anybody names
  // her by. Everything else on the entry is downstream of putting that right.
  // The hat goes BLACK with gold along the brim — on a red-haired figure in a
  // red coat it is the only thing that gives the head an edge, and a red hat
  // over red hair has none. The eyepatch and its strap go black for the same
  // reason the old note gave for making them dark red, now inverted: that note
  // said a black strap on black hair shows nothing, which was true and is moot.
  // The coat's turnbacks show its BLACK lining, the waist is a black bodice, and
  // the gloves — white, and a named part of the costume — were simply missing.
  akane: {
    body: 'humanoid', gridW: 38, gridH: 54,
    // A shade lighter and pinker than the coat, so hair and garment do not fuse
    // into one red slab. The black hat sitting between them does the rest.
    hair: 'twinLong', hairColor: '#e04a52', hairTie: '#8f1428',
    skin: '#fbdcc4', outfit: '#f4f1ea', accent: '#ffd23f', eyes: '#f0455c',
    // A white FRILLED CRAVAT with the brooch pinned through it. The three throat
    // garments the vocabulary had are a bow (two loops), a scarf (one trailing
    // end) and a tie (a blade down the shirt); a centred tiered ruffle is none
    // of them, and it sits directly under the face where six pixels matter.
    cravat: '#f7f4ec', cravatPin: '#c8203a',
    hat: 'tricorn', hatColor: '#221d2c', hatTrim: '#ffd23f', hatPlume: '#f4f1ea',
    eyepatch: 'right', eyepatchColor: '#241f2e', eyepatchStrap: '#241f2e',
    coat: '#c2233c', coatTrim: '#ffd23f', coatLapels: '#2a2436',
    sleeve: '#c2233c', coatCuffs: '#2a2436', coatButtons: '#ffd23f',
    pauldrons: '#ffd23f', chest: '#a3182f',
    // Gold on gold is one shape: the buckle, the buttons and the coat piping are
    // the same colour within six rows of each other, so the black bodice under
    // them is what keeps three pieces of metal from reading as one smear — and
    // it is also the only thing holding the red coat and the red skirt apart.
    sash: '#241f30', sashBuckle: '#ffd23f', skirt: '#a3182f',
    gloves: '#f4f1ea',
    // Sheer dark tights under short BROWN boots, not near-black thigh boots.
    legColor: '#2a2434', boots: '#7a4a2e',
    // STEEL, not the pale gold the previous pass gave the blade. Against a red
    // coat, a gold hilt and a white plume, a gold sword is one more gold thing
    // in a picture that already has four — and the one part of a cutlass that
    // has to read from across the arena is the edge.
    aura: '#ffd23f', weapon: 'cutlass', weaponColor: '#dfe8f5',
  },
  // The rabbit. Everything about her is the EARS: white, pink-lined, rooted at
  // the crown and falling past the hip on the outside of the arms, which is
  // forty rows of silhouette that no other entry in this table owns a single
  // pixel of. Then blue-green twin-tails with white ribbons, red eyes, a
  // blue-and-white officer's coat-dress with a double row of gold buttons and a
  // high collar over a white top, a short shoulder cape, white gloves, brown
  // boots, and the carrot she carries the way everybody else carries a weapon.
  //
  // The checks that matter, because a converging silhouette is how a roster
  // silently loses a character: the other small twin-tailed one is pale blue
  // with a dorsal fin and a trident and no ears at all; the other long-eared
  // one is a white BLOB with no limbs; the two drills and the low tails are
  // hair-coloured falls that start at the temple and the nape rather than white
  // ones that start above the skull; and nobody else on the roster has four
  // separate things hanging past their hips at once.
  //
  // 40x54, for the same reason as the captain and then one more: at 30x42 the
  // ears, the twin-tails and the weapon column all want the same four columns,
  // and two of the three have to lose.
  //
  // THE DRESS IS WHITE AND THE BLUE IS AN EDGE. It was written the other way
  // round — a royal-blue body with white trim — and written that way she stops
  // being a pale figure with cold accents and becomes a blue box, against which
  // the two white ears have nothing to sit. Piping, pockets, buttons: that is
  // where the blue goes, all of it. Her hair is a cold SKY BLUE with no green in
  // it, in plaits that hang past the hip; there is no beret and no mantle, and
  // nothing at all on the crown, because the ears root there and anything worn
  // between them is one more shape competing for four rows of air. What sits at
  // her throat is a fur muffler, and the gloves are BLACK with a white cuff.
  pekora: {
    body: 'humanoid', young: true, gridW: 40, gridH: 54,
    hair: 'twinLong', hairColor: '#7fc8ee', hairStreak: '#f4f9fd',
    hairTie: '#f4f1ea',
    // ONE CARROT STUCK POINT-DOWN IN EACH PLAIT. It is the most-quoted detail of
    // her head after the ears, and the count is the joke, so this is the one
    // hairpin that mirrors instead of taking the shared single-pin position.
    hairpin: 'carrot', hairpinColor: '#ff8f2e', hairpinLeaf: '#4fae4a',
    skin: '#fbe0cc', outfit: '#eaf2ff', accent: '#3d7fd6', eyes: '#f23b46',
    ears: 'rabbit', earColor: '#f7f4f0', earInner: '#ff9ecb',
    coat: '#f2f5fb', coatTrim: '#5aa5e0', coatButtons: '#4d92d4',
    // The dark strapless piece under the dress. It is the only large dark mass
    // on the figure, so it is what stops six white shapes from merging.
    underLayer: '#2b2934',
    // Puffy short sleeves worn off the shoulder, a fur band at the wrist, and
    // then a dark glove. The band is what keeps the pale sleeve and the dark
    // glove from reading as one two-tone arm.
    detachedSleeves: '#f2f5fb', cuffs: '#f7f4ee', gloves: '#33313d',
    scarf: '#fbf8f2',
    // Dark hose, pale ankle shoes: the legs read as a dark column with a light
    // foot, which is the one place this palette inverts.
    legColor: '#2e2c39', boots: '#f2f5fb',
    // The fronds go in `gripColor` rather than in a slot of their own: on a
    // carrot the green end IS the handle, so the vocabulary already had a word
    // for it and did not need a second one.
    weapon: 'carrot', weaponColor: '#ff8f2e', gripColor: '#4fae4a',
  },

  // THE RETRIEVAL ASSASSIN. Short crimson hair in a low tail, a dark leather
  // bodice over a red half-skirt, thigh straps, and a blade in each hand — the
  // silhouette has to say "carries a lot of knives and is about to be somewhere
  // else". Green eyes and a scar across one of them.
  //
  // She is the only red-headed character on the roster who is NOT a warrior in a
  // coat (that is Brant, in brick red with cream lapels): crimson rather than
  // brick, cropped rather than shaggy, and armed with two short blades rather
  // than one enormous axe. Colour off, the two share nothing.
  karin: {
    body: 'humanoid', hair: 'ponytail', hairColor: '#b8202f', hairTie: '#2a2028',
    skin: '#f2c9a8', outfit: '#26222c', accent: '#dfe8f5', eyes: '#5fd08a',
    scar: 'left',
    // A hard bodice over the shirt with a steel-edged collar, then the red
    // half-skirt: the two-tone torso is what separates her from a plain
    // assassin in black.
    coat: '#1c1920', coatTrim: '#c0182f', highCollar: '#1c1920',
    sash: '#c0182f', sashBuckle: '#dfe8f5',
    skirt: '#a41528', shorts: '#26222c',
    armWraps: '#3a3038', gloves: '#1c1920',
    legColor: '#22202a', boots: '#2e2830', bootHeight: 'thigh',
    chest: '#dfe8f5',
    weapon: 'dual', weaponColor: '#dfe8f5',
  },

  // THE CHARMER. Long black hair with the fox ears and the nine tails, gold
  // eyes, and a fitted dark-blue dress with gold trim.
  //
  // The roster already has a nine-tailed fox — the pink shrine one — so this had
  // to separate at the silhouette and not at the palette: hers is `twinLong`
  // (two long falls either side), a hakama and detached sleeves, and a mirror.
  // This one is a SINGLE long mass, a fitted dress with a short cape, and an orb
  // held in the hand. Colour off, the two read as different people.
  rima: {
    body: 'humanoid', hair: 'long', hairColor: '#1e1a2c', hairTip: '#3d2e5c',
    skin: '#fbe0cc', outfit: '#1e2a52', accent: '#ffd76a', eyes: '#ffc93f',
    ears: 'fox', earColor: '#241f34', earInner: '#ff9ecb',
    // A high gold-trimmed collar and a short mantle, so the shoulders read even
    // with the hair down over them.
    shoulderCape: '#2a3a6e', highCollar: '#2a3a6e',
    coat: '#1e2a52', coatTrim: '#ffd76a',
    underLayer: '#f2ece0', chest: '#ff7ad0',
    earrings: '#ffd76a', earringsMotif: '#ff7ad0',
    sash: '#ff7ad0', sashBuckle: '#ffd76a',
    skirt: '#1a2446',
    // Nine of them, in a warmer black than the hair so the fan separates from
    // the fall it hangs behind.
    tails: 9, tailColor: '#4a3a5c',
    legColor: '#f7d8bc', boots: '#2a2440',
    aura: '#ff7ad0', weapon: 'orb', weaponColor: '#ff7ad0',
  },

  // THE LOOSE CANNON. Two enormous blue braids past the hip, a magenta stripe
  // through the fringe, pink eyes, and the least coordinated outfit in the game:
  // a rust-brown crop top, purple shorts, one long stocking and one short one,
  // and a rocket launcher.
  //
  // The braids are the read and they are `twinLong` — which the pirate captain
  // and the shrine fox also wear — so the separation is colour and length: hers
  // are the only BLUE pair, they are the longest, and nothing else about her is
  // symmetrical, which is the note the asymmetric legwear carries.
  nika: {
    body: 'humanoid', hair: 'twinLong', hairColor: '#4a63d8', hairTie: '#2a2233',
    hairStreak: '#ff5fa8', skin: '#f5cba0',
    outfit: '#8a4a3a', accent: '#ff5fa8', eyes: '#ff5fa8', eyeGlow: '#ff9ecb',
    // Cropped top over bare midriff, then the purple shorts and the belt she
    // hangs everything off.
    underLayer: '#f5cba0',
    sash: '#5f3a8a', sashBuckle: '#ffd23f',
    shorts: '#5f3a8a',
    harness: '#4a3a2a', armWraps: '#c8c2ba', gloves: '#2a2233',
    // Mismatched legwear on purpose: one leg dark, one bare. `legColor` is one
    // value, so the dark one wins and the boots go pale to keep the break.
    legColor: '#3a3050', boots: '#e8e4dc', bootHeight: 'knee',
    chest: '#6ad8ff',
    sparks: '#6ad8ff',
    weapon: 'gun', weaponColor: '#6ad8ff', gripColor: '#5f3a8a',
  },

  // ALTERNATE FORMS -----------------------------------------------------------
  //
  // Not roster entries. A character who becomes something else for the duration
  // of an ability declares an `altForm` in characters.js carrying its own
  // `spriteId`, and index.js resolves that id THROUGH THIS TABLE — so a form
  // lives here, next to the person it belongs to, rather than in a second table
  // that three consumers would have to learn to skip. Nothing walks these keys:
  // every reader of this file indexes it by a character id it already has.
  //
  // The id is `<character>_dragon` and never the character's own, for exactly
  // the reason `portraitFor()` renames: the atlas keys pixel sprites on
  // `'px|' + descriptor.id + '|' + round(size)`, so a form that reused the plain
  // id would be handed back the cached HUMAN sprite at the transformed size and
  // nothing anywhere would report an error — she would simply get bigger.

  // THE DRAGON.
  //
  // Her transformation is canon to the character rather than borrowed, and the
  // spec calls the cast of it the most spectacular thing in the game: a full
  // screen tint, the camera pulling out, and a wing-beat under the roar. Up to
  // now the thing all of that announced was the same woman at 2.2x scale with
  // an orange aura, which is not a transformation, it is a status effect.
  //
  // So it is a different BODY PLAN, not a different descriptor on the humanoid
  // one. `drake` shares nothing with the figure she turns out of: an animal's
  // proportions, no shoulders, a barrel slung between the forelimbs, hind legs
  // that fold the wrong way, a snout, two pairs of horns, a membrane wing with
  // finger struts on each side and a tail a third of the grid long. Turn the
  // colour off and the two silhouettes have nothing in common, which is the
  // only test a transformation has to pass.
  //
  // The palette is hers, read straight off her humanoid entry — the orange-red
  // her hair runs to at the tips is the scale colour, the gold of her horns and
  // crown is the horn and claw colour, and the deep red of her cape is the wing
  // membrane. A dragon in colours the player has never seen her wear is a
  // different monster arriving, not her.
  sovereign_alicia_dragon: {
    body: 'drake', gridW: 54, gridH: 48,
    outfit: '#e0452c', accent: '#ffd76a',
    wingColor: '#8a2a18', underLayer: '#ffb03d',
    eyes: '#ffd76a', eyeGlow: '#ff8a3d',
    chest: '#ffd76a', aura: '#ffd76a',
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

  // A BUST IS A HUMAN SHAPE, AND NOT EVERY CHARACTER HAS ONE.
  //
  // `portrait` draws head, neck, collar and shoulders on the assumption that
  // there is a person under them. Forcing it on every roster entry gave the
  // mascot — a rice-cake blob with no body at all — a human neck and a pair of
  // shoulders in its HUD icon, wearing its own face like a mask. Nothing
  // errored, nothing looked broken enough to grep for, and the world sprite
  // (which is right) sat two inches away disagreeing with it.
  //
  // So a non-humanoid keeps its OWN plan and is simply drawn at portrait
  // resolution. Every non-humanoid plan derives its whole geometry from the
  // grid it is handed, so 40x40 is free detail on the same silhouette rather
  // than a second drawing that has to be kept in sync with the first.
  if (src.body && src.body !== 'humanoid') {
    return Object.assign({}, src, {
      id: def.id + '_portrait',
      noBob: true,
      gridW: 40, gridH: 40,
    });
  }

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
    hakama: null,
    sash: null, gauntlets: null, boots: null, bootHeight: undefined,
    belt: undefined, harness: null, armWings: null, hipWings: null,
    backpack: null, hologram: null, barefoot: false, detachedSleeves: null,
    armWraps: null, cuffs: null, coatCuffs: null, sashBuckle: null,
    // `wings` deliberately SURVIVES: the bust shows the leading edge of one at
    // each shoulder, which is in frame and is half the read on the one
    // character who has them. So, deliberately, do `headdress`, `neckBow`,
    // `pinafore` and `hoodDown` — a headdress, a ribbon at the throat, the bib
    // of an apron and the roll of a hood down behind the neck are all ABOVE OR
    // AT the crop line, and a maid whose uniform is cropped out of her own
    // portrait is a stranger in a navy dress.
    //
    // And so do `coatLapels`, `coatButtons`, `shoulderCape` and `eyepatchStrap`.
    // A bust is mostly collar and shoulder: the lapels are a frame around the
    // face, the buttons and the mantle are the only parts of a uniform that
    // survive the crop at all, and a strap that runs over the temple is nearer
    // the eye than anything else on the figure. `coatCuffs` and `sashBuckle` go
    // the other way with the wrists and the waist they belong to, for the same
    // reason `cuffs` does — there are no wrists in a bust.
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

  // ==========================================================================
  // STAGE 3 — THE TITANS, AND THEY ARE ALL ONE BODY PLAN NOW.
  //
  // Four of these six were `humanoid` or `beast` and two had no override at
  // all, which meant Stage 3's horde was drawn out of the SAME two silhouettes
  // as the school, the street, the village and the reef. The stage whose entire
  // premise is "something very large stepped over the wall" was fielding bald
  // office workers and the same hunched quadruped a coral crab uses.
  //
  // `titan` is the plan that says it, and none of it needed a new drawer:
  //
  //   DISPROPORTIONATE HEAD   drawTitan sizes the skull off the grid WIDTH
  //     (headR = W * 0.13) and everything else off its HEIGHT, so the head is
  //     0.26 * W/H of the figure. At a square grid that is 26% — a four-heads-
  //     tall body, which is the whole read — and pushing W past H pushes it
  //     further. The humanoid plan is 21% of a much taller figure.
  //   OVER-LONG ARMS          arms are H * 0.34 hung from H * 0.32, so the
  //     fists land at the hip line with nothing at the wrist to break them up.
  //   EXPOSED MUSCULATURE     the torso carries a sternum line and three rib
  //     bands in `c.dark`, which is sink() of the flesh colour — darker, MORE
  //     saturated, rotated cool — so on the pale doughy tones in enemies.js it
  //     comes out raw red-brown rather than as shading.
  //   NO CLOTHING             the plan has no coat, no boots, no belt loop and
  //     no weapon hand. There is nothing to switch off because there was never
  //     anything there.
  //   UNEVEN GAIT             FRAME_PLAN gives `titan` TWO walk beats, not
  //     four: it takes the contact beats and skips the passing lift entirely,
  //     because nothing this heavy picks a foot up cleanly.
  //
  // THE GRIDS ARE THE CHARACTERISATION. Same plan, six proportions, and they
  // are chosen against the HITBOX rather than for looks alone: on-screen height
  // is `visual.size * 2.6` whatever the grid says, and the width follows the
  // grid's aspect — so a 1.6:1 grid is a sprite half again wider than the thing
  // it is drawn on, and you get hit by a shoulder that was never there. Every
  // one below lands inside 1.05-1.3x of its own collision diameter, which is
  // where the humanoid and beast versions already sat.
  //
  //   husk_wanderer   36x36  square — the ordinary four-metre one, head at 26%
  //   crawler_husk    36x32  wide and low — 29%, dragging itself
  //   sprinting_husk  32x42  gaunt, small-headed at 20%, all limb: the abnormal
  //   splinter_husk   26x24  knee-high, head at 33% — mouth first
  //   rubble_golem    38x36  broad, and it keeps the tank's crown of horns
  //   siege_husk      40x44  the biggest of them, and the only one with a core
  //
  // The eyes are the family resemblance: blank white on the vacant ones, red on
  // the two that have decided something.
  // ==========================================================================
  husk_wanderer:      { body: 'titan', gridW: 36, gridH: 36, eyes: '#e8ecf5' },
  crawler_husk:       { body: 'titan', gridW: 36, gridH: 32, eyes: '#e8ecf5' },
  sprinting_husk:     { body: 'titan', gridW: 32, gridH: 42, eyes: '#ff3a5e' },
  splinter_husk:      { body: 'titan', gridW: 26, gridH: 24, eyes: '#e8ecf5' },
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
  /**
   * The wall got up, and it brought the wall.
   *
   * `ears: 'none'` OVERRIDES BEHAVIOR_STYLE.tank's `greatHorns` on purpose, and
   * it was rendered both ways before choosing. drawTitan draws a horn as a
   * 1px blade running 5px out and 6px up from the skull; on a 38px grid that is
   * two long thin diagonals off a small head, and side by side with the Coral
   * Crab and the Oni Bruiser — who legitimately have them — it reads as INSECT
   * ANTENNAE, not as masonry. On a thing made of stone that is simply the wrong
   * animal.
   *
   * `cape` is what replaces it. On the titan plan a cape is not cloth: it is a
   * dark taper drawn BEHIND the torso, wider than the body and hanging past the
   * hips, in `shade(c.deep, -0.2)` — so on a grey golem it is a slab of wall
   * still sitting on its back, and it makes this the broadest silhouette of the
   * six, which is what the heaviest thing on the stage should be. The value is
   * ignored by drawTitan (it derives the colour from the body); `true` is the
   * honest way to say "on".
   */
  rubble_golem:       { body: 'titan', gridW: 38, gridH: 36, eyes: '#3a3f4a',
                        ears: 'none', cape: true },
  // "Architecture that has decided to move." This one had NO override at all
  // and `mortar` is missing from BODY_FOR_BEHAVIOR, so the heaviest, slowest,
  // longest-ranged thing on the stage resolved to a featureless bald humanoid
  // — the single least characterised sprite in the game, on the mob the stage
  // fields twenty of. `chest` is the one lit thing on any of these six: the
  // furnace it lobs its shells out of, and the only way to pick it out of a
  // wall of husks at a glance.
  siege_husk:         { body: 'titan', gridW: 40, gridH: 44, eyes: '#c8462a',
                        chest: '#e07a3f' },
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
