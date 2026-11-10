import type { TimeName } from '../core/params';

export type Category = 'flora' | 'fauna' | 'place';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

/**
 * One thing in the realm worth finding: a rare flower, a creature, a place.
 * You *discover* it by coming near (it is named in your journal), and you *collect* it by
 * framing it in the lens: centred in the reticle, at the right distance, held still while
 * the focus settles. The photo taken at that moment is kept in the journal.
 */
export interface Entry {
  id: string;
  cat: Category;
  name: string;
  /** Latin name or epithet. */
  latin: string;
  rarity: Rarity;
  /** What the journal says once it is known. */
  blurb: string;
  /** A rumour shown while it is still unknown. */
  hint: string;
  /** Discovered when within this many metres (and in view, for flora and fauna). */
  discover: number;
  /** Good shooting distance (metres from the lens). */
  near: number;
  far: number;
  /** Fraction of the frame height the subject must fill (0 = any). */
  fill: number;
  /** Times of day it shows itself (all when absent). */
  when?: TimeName[];
}

const flora = (e: Omit<Entry, 'cat' | 'near' | 'far' | 'fill' | 'discover'> & Partial<Pick<Entry, 'near' | 'far' | 'fill' | 'discover'>>): Entry => ({
  cat: 'flora',
  near: 0.22,
  far: 2.6,
  fill: 0.1,
  discover: 5.5,
  ...e,
});
const fauna = (e: Omit<Entry, 'cat' | 'fill'> & Partial<Pick<Entry, 'fill'>>): Entry => ({ cat: 'fauna', fill: 0.07, ...e });
const place = (e: Omit<Entry, 'cat' | 'fill' | 'near' | 'far'> & Partial<Pick<Entry, 'near' | 'far' | 'fill'>>): Entry => ({
  cat: 'place',
  near: 6,
  far: 900,
  fill: 0,
  ...e,
});

export const CATALOG: Entry[] = [
  // ---------------------------------------------------------------- rare flora
  flora({
    id: 'clover4',
    name: 'Four-leaf Clover',
    latin: 'Trifolium repens, quadrifoliate',
    rarity: 'rare',
    blurb: 'One white-clover leaf in ten thousand grows a fourth leaflet. This one waits in the meadow where you first woke, as if it had been expecting you.',
    hint: 'Luck is said to grow close to where every journey begins.',
    near: 0.18,
    far: 1.6,
    discover: 3.5,
  }),
  flora({
    id: 'fritillary',
    name: 'Snake’s-head Fritillary',
    latin: 'Fritillaria meleagris',
    rarity: 'uncommon',
    blurb: 'A nodding bell chequered like a game board in plum and pale lilac. It loves wet spring meadows, and stands in little groups along the shores of the fairy pools.',
    hint: 'Chequered bells nod where the meadows drink from still water.',
  }),
  flora({
    id: 'pasque',
    name: 'Pasque Flower',
    latin: 'Pulsatilla vulgaris',
    rarity: 'uncommon',
    blurb: 'Silky violet cups with a golden boss, wrapped in silver hairs against the cold. Old stories say it springs where ancient blood was spilled; here it grows around the Old Ring.',
    hint: 'Silken violet cups keep watch among the standing stones.',
  }),
  flora({
    id: 'bluepoppy',
    name: 'Himalayan Blue Poppy',
    latin: 'Meconopsis betonicifolia',
    rarity: 'rare',
    blurb: 'Tissue-thin petals the blue of a high summer sky around a crown of golden stamens. Famously hard to grow, it chose the wind-swept hill of Watcher’s Rise.',
    hint: 'A poppy the colour of the sky grows on the hill of the old watchers.',
  }),
  flora({
    id: 'slipper',
    name: 'Lady’s Slipper Orchid',
    latin: 'Cypripedium calceolus',
    rarity: 'rare',
    blurb: 'A swollen golden pouch hung between twisted maroon ribbons. Bees tumble into the slipper and can only climb out past the pollen. It hides in the dappled shade at the edge of the western woods.',
    hint: 'A golden slipper was lost in the shade where the western woods begin.',
  }),
  flora({
    id: 'martagon',
    name: 'Martagon Lily',
    latin: 'Lilium martagon',
    rarity: 'uncommon',
    blurb: 'Turk’s-cap lily: tepals curled all the way back, freckled with wine-dark spots, hanging in a little candelabra. It grows tall in the light woods north of the hollow.',
    hint: 'Freckled turbans hang in the light woods past Blossom Hollow.',
    far: 3.2,
  }),
  flora({
    id: 'ghostpipe',
    name: 'Ghost Pipe',
    latin: 'Monotropa uniflora',
    rarity: 'rare',
    blurb: 'No leaves, no green: a waxy white plant that feeds on the fungi under the trees and glows faintly in the gloom. Touch it and it blackens, so look only.',
    hint: 'Pale pipes without a leaf stand where the forest floor never sees the sun.',
    near: 0.18,
  }),
  flora({
    id: 'gentian',
    name: 'Trumpet Gentian',
    latin: 'Gentiana acaulis',
    rarity: 'uncommon',
    blurb: 'Trumpets of the deepest blue in the mountains, almost stemless, with green-freckled throats. They close when a cloud passes over the sun.',
    hint: 'Blue trumpets sound along the road that climbs toward the range.',
  }),
  flora({
    id: 'edelweiss',
    name: 'Edelweiss',
    latin: 'Leontopodium nivale',
    rarity: 'rare',
    blurb: 'Lion’s foot: a star of woolly white bracts around tiny golden florets. The felt keeps it from freezing and burning in the thin mountain air. Climbers once risked their lives for one.',
    hint: 'A star of white felt grows high, past the last watchtower.',
  }),
  flora({
    id: 'moonpetal',
    name: 'Moonpetal',
    latin: 'Selenanthus nocturnus',
    rarity: 'rare',
    blurb: 'Closed by day, it opens at dusk and glows with pale blue veins until dawn. The shrine keepers of Blossom Hollow planted it under the cherries long ago.',
    hint: 'Under the cherry trees something blooms only after the sun has gone.',
    when: ['Dusk', 'Misty dawn'],
  }),
  flora({
    id: 'starbloom',
    name: 'Starbloom',
    latin: 'Crystallanthus cantans',
    rarity: 'legendary',
    blurb: 'A flower that grew from crystal dust: glassy petals that catch the light and hum softly in the wind. It only roots where the great crystals sing.',
    hint: 'Where the crystals sing, a flower of glass is said to answer.',
  }),
  flora({
    id: 'skybell',
    name: 'Skybell',
    latin: 'Campanula caelestis',
    rarity: 'legendary',
    blurb: 'Pale azure bells that ring, very faintly, when the high wind passes. They grow nowhere else but the roof of the realm, beside the summit cairn.',
    hint: 'Bells ring with the wind on the very roof of the realm.',
  }),

  // ---------------------------------------------------------------- creatures
  fauna({ id: 'sheep', name: 'Sheep', latin: 'Ovis aries', rarity: 'common', blurb: 'The flocks of Windmere, shorn each spring. They follow each other everywhere and are not as foolish as people say.', hint: 'Grazing in flocks around the windmill village and on the open hills.', discover: 30, near: 2, far: 45 }),
  fauna({ id: 'horse', name: 'Horse', latin: 'Equus caballus', rarity: 'common', blurb: 'The herds of Hearthbrook run half wild on the eastern pastures. Come slowly, and they will lift their heads to look at you.', hint: 'Running free in the pastures east of the shepherds’ hamlet.', discover: 40, near: 3, far: 60 }),
  fauna({ id: 'deer', name: 'Red Deer', latin: 'Cervus elaphus', rarity: 'common', blurb: 'Shy grazers of the forest edges. They see you long before you see them and flee if you hurry.', hint: 'Along the edges of the woods. Walk, don’t run.', discover: 45, near: 4, far: 70 }),
  fauna({ id: 'boar', name: 'Wild Boar', latin: 'Sus scrofa', rarity: 'common', blurb: 'They root the soil for bulbs and acorns and leave it looking ploughed. Best admired from a respectful distance.', hint: 'Rooting near the crystals and in the eastern scrub.', discover: 30, near: 3, far: 50 }),
  fauna({ id: 'chicken', name: 'Hen', latin: 'Gallus domesticus', rarity: 'common', blurb: 'Every farmyard has its hens, scratching, gossiping and running from absolutely everything.', hint: 'In the yards of every village and farmstead.', discover: 14, near: 0.8, far: 18 }),
  fauna({ id: 'cat', name: 'Town Cat', latin: 'Felis catus', rarity: 'common', blurb: 'Lumenhall belongs to its cats. They nap on warm steps and let you pass if you are polite.', hint: 'Somewhere in the streets of the starting city.', discover: 14, near: 0.8, far: 20 }),
  fauna({ id: 'hare', name: 'Brown Hare', latin: 'Lepus europaeus', rarity: 'uncommon', blurb: 'Long-eared and long-legged, it freezes flat in the grass and then bolts in great zigzag bounds.', hint: 'Out in the open fields, ears above the grass.', discover: 30, near: 1.5, far: 40 }),
  fauna({ id: 'fox', name: 'Red Fox', latin: 'Vulpes vulpes', rarity: 'uncommon', blurb: 'A flame-coloured hunter of the field margins, listening for mice under the grass and pouncing nose first.', hint: 'Hunts the field edges when the light is low.', discover: 30, near: 1.5, far: 45, when: ['Golden hour', 'Dusk', 'Misty dawn'] }),
  fauna({ id: 'hedgehog', name: 'Hedgehog', latin: 'Erinaceus europaeus', rarity: 'uncommon', blurb: 'Snuffling through the farm gardens after dark for beetles and slugs. It grunts like a tiny pig.', hint: 'Snuffles around the farmsteads after dark.', discover: 12, near: 0.5, far: 10, when: ['Dusk', 'Misty dawn'] }),
  fauna({ id: 'ibex', name: 'Alpine Ibex', latin: 'Capra ibex', rarity: 'rare', blurb: 'Wild goats of the high cliffs, with great ridged horns swept back. They stand on ledges that look impossible.', hint: 'On the slopes under the Skyreach Range, where the road gives out.', discover: 60, near: 4, far: 90 }),
  fauna({ id: 'heron', name: 'Grey Heron', latin: 'Ardea cinerea', rarity: 'uncommon', blurb: 'It stands motionless at the edge of the pools for an hour, then strikes faster than you can blink.', hint: 'Standing still as a post at the edge of a pool.', discover: 35, near: 2, far: 50 }),
  fauna({ id: 'frog', name: 'Common Frog', latin: 'Rana temporaria', rarity: 'common', blurb: 'Golden-eyed and speckled, it sits on the lily pads and sings at dusk in a soft purring croak.', hint: 'On the lily pads of the fairy pools. Listen at dusk.', discover: 6, near: 0.3, far: 5 }),
  fauna({ id: 'dragonfly', name: 'Emperor Dragonfly', latin: 'Anax imperator', rarity: 'uncommon', blurb: 'Bright blue and green, the largest of the darners, patrolling the pools in tireless loops.', hint: 'Patrolling low over the pools on sunny days.', discover: 10, near: 0.5, far: 8, fill: 0.04, when: ['Noon', 'Golden hour'] }),
  fauna({ id: 'kite', name: 'Red Kite', latin: 'Milvus milvus', rarity: 'uncommon', blurb: 'A forked tail twisting like a rudder, it circles for hours over the fields on the warm air without a single wingbeat.', hint: 'Look up: something circles high over the fields by day.', discover: 160, near: 15, far: 260, fill: 0.03, when: ['Noon', 'Golden hour', 'Misty dawn'] }),
  fauna({ id: 'swallow', name: 'Barn Swallow', latin: 'Hirundo rustica', rarity: 'common', blurb: 'Navy backs, rusty throats and long tail streamers. They hunt flies in fast flocks over the grass and roost when night falls.', hint: 'Fast flocks skimming the fields by day.', discover: 40, near: 3, far: 80, fill: 0.025, when: ['Noon', 'Golden hour', 'Misty dawn'] }),
  fauna({ id: 'b_copper', name: 'Small Copper', latin: 'Lycaena phlaeas', rarity: 'common', blurb: 'A tiny, fierce, fire-orange butterfly that defends its patch of meadow against all comers.', hint: 'A spark of orange dancing over the meadow by day.', discover: 6, near: 0.4, far: 5, fill: 0.04, when: ['Noon', 'Golden hour'] }),
  fauna({ id: 'b_brimstone', name: 'Brimstone', latin: 'Gonepteryx rhamni', rarity: 'common', blurb: 'The butter-coloured fly that may have given butterflies their name. Its wings are shaped like leaves.', hint: 'A flake of butter-yellow over the flowers by day.', discover: 6, near: 0.4, far: 5, fill: 0.04, when: ['Noon', 'Golden hour'] }),
  fauna({ id: 'b_white', name: 'Wood White', latin: 'Leptidea sinapis', rarity: 'common', blurb: 'Delicate and slow, it flutters low along the grass as if it had all day. It does.', hint: 'Something small and white drifting low over the grass.', discover: 6, near: 0.4, far: 5, fill: 0.04, when: ['Noon', 'Golden hour'] }),
  fauna({ id: 'b_blue', name: 'Common Blue', latin: 'Polyommatus icarus', rarity: 'uncommon', blurb: 'Wings of bright violet-blue above and freckled grey below. It roosts head-down on grass stems at night.', hint: 'A scrap of sky-blue flickering over the meadow.', discover: 6, near: 0.4, far: 5, fill: 0.04, when: ['Noon', 'Golden hour'] }),
  fauna({ id: 'owl', name: 'Tawny Owl', latin: 'Strix aluco', rarity: 'rare', blurb: 'It sleeps through the day in the cracked watchtower and wakes at dusk. Its call is the one in every ghost story.', hint: 'A watcher still keeps the broken tower, but only after the sun sets.', discover: 30, near: 3, far: 45, when: ['Dusk', 'Misty dawn'] }),
  fauna({ id: 'hart', name: 'The Pale Hart', latin: 'Cervus albus', rarity: 'legendary', blurb: 'A white stag with antlers that shine like frost. Hunters of old followed it for years and never once caught it. It allows itself to be seen only when the mist lies on the fields.', hint: 'Something white walks the deep eastern woods on misty mornings.', discover: 55, near: 5, far: 80, when: ['Misty dawn'] }),

  fauna({ id: 'cow', name: 'Highland Cow', latin: 'Bos taurus, Highland', rarity: 'common', blurb: 'Shaggy, russet and unhurried, with a fringe over its eyes and horns as wide as a doorway. Every farmstead keeps a few.', hint: 'Shaggy red cattle graze beside the farmsteads.', discover: 35, near: 2.5, far: 50 }),
  fauna({ id: 'dog', name: 'Sheepdog', latin: 'Canis familiaris', rarity: 'common', blurb: 'Black and white and never still. It decides within a second that you are part of the flock, and follows you to make sure you stay in it.', hint: 'Each village has one. It will find you before you find it.', discover: 20, near: 1, far: 25 }),
  fauna({ id: 'squirrel', name: 'Red Squirrel', latin: 'Sciurus vulgaris', rarity: 'uncommon', blurb: 'Tufted ears and a tail longer than itself. It buries hundreds of nuts every autumn and forgets most of them, which is how forests travel.', hint: 'A flick of red on the forest floor, wherever the trees stand close.', discover: 16, near: 0.8, far: 18, fill: 0.04 }),
  fauna({ id: 'badger', name: 'Badger', latin: 'Meles meles', rarity: 'uncommon', blurb: 'A striped face on a low grey body, trundling out of its sett when the light fails. The paths it wears are older than the roads.', hint: 'A striped face leaves the wood edge when the light fails.', discover: 22, near: 1.2, far: 25, when: ['Dusk', 'Misty dawn'] }),
  fauna({ id: 'wolf', name: 'Grey Wolf', latin: 'Canis lupus', rarity: 'rare', blurb: 'A pack keeps the northern woods. You will hear them long before you see them, and they will have seen you long before that.', hint: 'After sunset something sings in the northern woods. It is not a bird.', discover: 45, near: 4, far: 70, when: ['Dusk'] }),
  fauna({ id: 'bear', name: 'Brown Bear', latin: 'Ursus arctos', rarity: 'rare', blurb: 'Half a tonne of patience. It turns over stones for grubs and stands up tall to smell what the wind is carrying. Give it room.', hint: 'Something very large turns over stones in the southern woods.', discover: 50, near: 5, far: 80 }),
  fauna({ id: 'raven', name: 'Raven', latin: 'Corvus corax', rarity: 'uncommon', blurb: 'Black from beak to claw and far too clever. It keeps watch over old stones as if it were waiting for someone in particular.', hint: 'A black bird keeps watch where old stones stand.', discover: 22, near: 1.5, far: 30 }),
  fauna({ id: 'eagle', name: 'Golden Eagle', latin: 'Aquila chrysaetos', rarity: 'rare', blurb: 'Two metres of wing riding the updraught off the range. From up there it can see a hare move in the fields below Lumenhall.', hint: 'Broad dark wings ride the wind above the highest rock.', discover: 220, near: 15, far: 320, fill: 0.03, when: ['Noon', 'Golden hour', 'Misty dawn'] }),
  fauna({ id: 'swan', name: 'Mute Swan', latin: 'Cygnus olor', rarity: 'uncommon', blurb: 'White as a sail, neck in a perfect S. It glides across the larger pools as though it had been painted there.', hint: 'Something white and proud sails on the larger pools.', discover: 30, near: 2, far: 40 }),
  fauna({ id: 'duck', name: 'Mallard', latin: 'Anas platyrhynchos', rarity: 'common', blurb: 'A bottle-green head, a curled tail and an opinion about everything. Wherever there is water, there is a mallard on it.', hint: 'Paddling in little fleets on the fairy pools.', discover: 22, near: 1, far: 25, fill: 0.04 }),
  fauna({ id: 'bat', name: 'Pipistrelle', latin: 'Pipistrellus pipistrellus', rarity: 'uncommon', blurb: 'It weighs less than a coin and eats three thousand midges a night, tumbling through the dusk around towers and old walls.', hint: 'When the sun is gone, small wings tumble around the old towers.', discover: 25, near: 1, far: 28, fill: 0.015, when: ['Dusk'] }),
  fauna({ id: 'jelly', name: 'Lantern Jelly', latin: 'Aurelia aetheria', rarity: 'rare', blurb: 'They rise out of the ground mist after dark and drift on nothing at all, pulsing with a light that has no heat. Nobody has ever seen one land.', hint: 'After dark, pale lanterns drift where the crystals sing and where the well glows.', discover: 40, near: 1.5, far: 40, fill: 0.04, when: ['Dusk'] }),
  fauna({ id: 'kodama', name: 'Kodama', latin: 'Spiritus silvae', rarity: 'legendary', blurb: 'Small pale spirits of the old trees. They sit very still, tilt their heads with a soft rattle, and are gone the moment you step too close. A wood that has them is a healthy wood.', hint: 'In the oldest glades, when the light is thin, the trees send someone to look at you.', discover: 16, near: 2, far: 18, fill: 0.03, when: ['Dusk', 'Misty dawn'] }),
  fauna({ id: 'kitsune', name: 'The Kitsune', latin: 'Vulpes novemcauda', rarity: 'legendary', blurb: 'A white fox with more tails than a fox should have, each tipped with cold fire. The shrine keepers left it rice and never once saw it eat.', hint: 'The shrine among the cherries has a guardian. It keeps its hours after sunset.', discover: 40, near: 3, far: 55, when: ['Dusk'] }),
  fauna({ id: 'whale', name: 'The Cloud Whale', latin: 'Balaena nimbosa', rarity: 'legendary', blurb: 'It swims the upper air as slowly as weather, a meadow growing on its back and runes burning along its flanks. The old maps mark its road across the sky, and nothing else.', hint: 'When the sun is low, look up. Something as large as a village crosses the sky.', discover: 600, near: 40, far: 900, fill: 0.05, when: ['Golden hour', 'Dusk', 'Misty dawn'] }),
  fauna({ id: 'dragon', name: 'Aurelion, the Sky Serpent', latin: 'Draco caelestis', rarity: 'legendary', blurb: 'It slept inside the Pillar for an age, behind a door that five sigils kept. Now it turns around the crown of the tower, jade and gold, and the wind it makes is yours to ride.', hint: 'They say the Pillar of Ascent is not empty. They say the door was shut from the inside.', discover: 450, near: 30, far: 600, fill: 0.05 }),

  // ---------------------------------------------------------------- places
  place({ id: 'site:city', name: 'Lumenhall', latin: 'The Starting City', rarity: 'common', blurb: 'A walled city of pale stone and blue slate, built around the gate of light. Its bell tower tolls every few minutes.', hint: 'The city on the horizon, west of where you woke.', discover: 150, near: 20 }),
  place({ id: 'site:windmere', name: 'Windmere', latin: 'Village of Windmills', rarity: 'common', blurb: 'Millers and shepherds. The sails turn day and night and the sheep keep the grass short.', hint: 'Follow the King’s Road east.', discover: 95, near: 12 }),
  place({ id: 'site:hearth', name: 'Hearthbrook', latin: 'Shepherds’ Hamlet', rarity: 'common', blurb: 'A hamlet of thatched roofs and horse pastures, with a fire always burning on the green.', hint: 'South-east, past Blossom Hollow.', discover: 90, near: 12 }),
  place({ id: 'site:ruins', name: 'Watcher’s Rise', latin: 'Ruins of the First Age', rarity: 'common', blurb: 'A broken colonnade and a cracked watchtower crown the hill. A crystal still turns over the altar.', hint: 'A hill crowned with ruins, far to the north.', discover: 120, near: 12 }),
  place({ id: 'site:crystals', name: 'Shardfield', latin: 'Where the Crystals Sing', rarity: 'uncommon', blurb: 'Crystals as tall as towers grow out of the meadow here. Nobody knows who planted them, or if anyone did.', hint: 'North-west, off the road to the ruins.', discover: 105, near: 12 }),
  place({ id: 'site:watch', name: 'Last Watch', latin: 'Gate of the Skyreach Range', rarity: 'uncommon', blurb: 'The last tower before the mountains, where the road becomes a path and the path becomes rock.', hint: 'Where the mountain road gives out, far to the west.', discover: 90, near: 8 }),
  place({ id: 'site:grove', name: 'Blossom Hollow', latin: 'Shrine of the Petals', rarity: 'common', blurb: 'A round shrine among cherry trees that are always in flower. Petals drift down whatever the season.', hint: 'Down a lane from the King’s Road, among the cherries.', discover: 70, near: 8 }),
  place({ id: 'site:pillar', name: 'Pillar of Ascent', latin: 'The Labyrinth Tower', rarity: 'uncommon', blurb: 'A tower so tall it disappears into the haze. The great door has never opened.', hint: 'At the end of the Ascent Road, past Hearthbrook.', discover: 150, near: 20 }),
  place({ id: 'site:ring', name: 'The Old Ring', latin: 'Stones of the First Dawn', rarity: 'uncommon', blurb: 'Fourteen standing stones, some still capped with lintels, around a rune stone that never stops glowing.', hint: 'A lane off the road between the two villages.', discover: 55, near: 8 }),
  place({ id: 'tree', name: 'The Great Tree', latin: 'Quercus antiquissima', rarity: 'common', blurb: 'The oldest living thing in the fields. Its roots hold the hill together and its crown has its own weather.', hint: 'A giant tree stands on a rise near where you woke.', discover: 60, near: 10 }),
  place({ id: 'castle', name: 'The Floating Castle', latin: 'Twenty-one tiers adrift', rarity: 'rare', blurb: 'Twenty-one floors of land stacked in the sky, held up by nothing anyone understands. Every tier is a country of its own.', hint: 'Fly south toward the castle in the sky until it fills the view.', discover: 900, near: 120, far: 3200 }),
  place({ id: 'summit', name: 'Skyreach Summit', latin: 'The Roof of the Realm', rarity: 'rare', blurb: 'The highest ground you can stand on. A cairn of stones and prayer flags, and the whole realm spread out below.', hint: 'The roof of the realm, somewhere in the western range.', discover: 40, near: 3, far: 60 }),
  place({ id: 'fairyring', name: 'The Fairy Ring', latin: 'Where the little folk dance', rarity: 'rare', blurb: 'A perfect circle of mushrooms in a forest glade. At night the caps glow, and it is very easy to believe in the little folk.', hint: 'Where the eastern woods are deepest, they say the little folk dance in a ring.', discover: 18, near: 3, far: 60 }),
  place({ id: 'moonwell', name: 'The Moonwell', latin: 'Water that remembers the moon', rarity: 'rare', blurb: 'An old well of mossy stones in a quiet hollow. Its water glows pale blue, even at noon.', hint: 'An old well of glowing water hides in a hollow in the southern woods.', discover: 18, near: 3, far: 60 }),
  place({ id: 'swing', name: 'The Lone Swing', latin: 'A view worth the climb', rarity: 'uncommon', blurb: 'Someone hung a swing from a lone oak on a knoll that looks across the whole valley to Lumenhall. Nobody knows who.', hint: 'A lone tree on a knoll looks across the valley at the city.', discover: 24, near: 3, far: 80 }),
  place({ id: 'blade', name: 'The Unclaimed Blade', latin: 'For a hero yet to come', rarity: 'rare', blurb: 'A sword thrust into a rock on a bare hilltop, still bright after centuries. Many have tried to pull it out.', hint: 'A blade in the stone waits on a bare hill in the north-east.', discover: 26, near: 3, far: 80 }),
  place({ id: 'hut', name: 'The Hermit’s Hut', latin: 'Smoke among the trees', rarity: 'uncommon', blurb: 'A tiny cabin deep in the woods with a lantern by the door and a pot on the fire. The hermit is always just out.', hint: 'Follow the chimney smoke rising out of the northern woods.', discover: 22, near: 4, far: 70 }),
  place({ id: 'skyshrine', name: 'The Sky Shrine', latin: 'An altar for the wind', rarity: 'legendary', blurb: 'A gate and an altar on the largest of the floating islands, reachable only on the wind. Bells hang from the gate and ring when you fly past.', hint: 'One of the floating islands keeps a shrine that can only be reached by flying.', discover: 90, near: 6, far: 220 }),
];

export const BY_ID = new Map(CATALOG.map((e) => [e.id, e]));

export const CATEGORY_LABEL: Record<Category, { one: string; many: string; found: string }> = {
  flora: { one: 'rare flower', many: 'Flowers', found: 'You found a new rare flower' },
  fauna: { one: 'creature', many: 'Creatures', found: 'You spotted a new creature' },
  place: { one: 'place', many: 'Places', found: 'You discovered a new place' },
};
