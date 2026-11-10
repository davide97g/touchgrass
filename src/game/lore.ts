import type { TimeName } from '../core/params';

/** One of the five sigils that keep the door of the Pillar. */
export interface Sigil {
  id: string;
  name: string;
  /** Glyph drawn on the stele and in the quest log. */
  glyph: string;
  color: string;
  /** The riddle that leads to it. */
  riddle: string;
  /** What the stele says once it wakes. */
  verse: string;
  /** It only answers at these hours. */
  when?: TimeName[];
  /** What it says when touched at the wrong hour. */
  asleep?: string;
}

export const SIGILS: Sigil[] = [
  {
    id: 'stone',
    name: 'Sigil of Stone',
    glyph: '◈',
    color: '#ffd28a',
    riddle: 'The first sleeps where the old watchers fell, on the hill that still wears their broken crown.',
    verse: 'We watched the sky for a thousand years. When it finally looked back, we closed the door and broke our own tower, so that nobody would be tempted to open it for the wrong reason.',
  },
  {
    id: 'song',
    name: 'Sigil of Song',
    glyph: '❖',
    color: '#9ff0ff',
    riddle: 'The second hums among glass taller than towers, where the meadow grew teeth of light.',
    verse: 'The crystals are not stone. They are its breathing, come up through the ground while it sleeps. Stand still. You can hear the next breath coming.',
  },
  {
    id: 'dawn',
    name: 'Sigil of Dawn',
    glyph: '✺',
    color: '#ffb8d0',
    riddle: 'The third stands inside the ring of fourteen, and opens its eye only when mist lies on the fields.',
    verse: 'Fourteen of us stood here on the first morning and promised to forget the way in. The stones remember what we would not.',
    when: ['Misty dawn'],
    asleep: 'The carving is cold and dull. Fourteen stones keep the first dawn; perhaps it wakes with the morning mist.',
  },
  {
    id: 'petal',
    name: 'Sigil of Petal',
    glyph: '❀',
    color: '#f6a8ff',
    riddle: 'The fourth hides under blossom that never falls for good, and answers only after the sun has gone.',
    verse: 'We planted cherries over it so that something beautiful would stand where something heavy was buried. The fox was not our idea. The fox came by itself.',
    when: ['Dusk'],
    asleep: 'Petals drift across the carving and nothing answers. The shrine keepers did their work after sunset.',
  },
  {
    id: 'sky',
    name: 'Sigil of Sky',
    glyph: '✧',
    color: '#bfe0ff',
    riddle: 'The fifth was carried up out of reach, to an altar on land that forgot the ground. Only the wind will take you there.',
    verse: 'The last one we lifted into the air with the island it stood on, so that only someone who had learned to fly could finish what we began. If you are reading this, you have.',
  },
];

export const WAYSTONE = {
  title: 'The Waystone',
  text: [
    'Traveller. You woke in the grass, as all of us did.',
    'This realm is older than its roads. Beyond Hearthbrook stands a tower whose door has never opened. Five sigils keep it shut: one of stone, one of song, one of dawn, one of petal, one of sky.',
    'Wake all five and the door will know you.',
    'Lights drift in the fields. Gather them; they are what earlier travellers left behind. Walk gently and the animals will let you near. Look closely. Almost nothing here is only what it seems.',
  ],
};

/** Pages of the hermit's diary, scattered where the hermit stopped to write. */
export const PAGES: { title: string; text: string }[] = [
  {
    title: 'The Hermit’s Diary · I',
    text: 'I have moved to the woods. The city is too loud since the bell began to toll by itself. Nobody rings it. I checked. I climbed all two hundred steps and the rope was coiled on its hook, and it rang anyway, and I came down again rather faster than I went up.',
  },
  {
    title: 'The Hermit’s Diary · II',
    text: 'The millers of Windmere say the sails turn on windless nights. They say it kindly, the way you would mention a neighbour who sleepwalks. I asked which way the sails face when there is no wind. South-east, said the miller. Always south-east. Toward the tower.',
  },
  {
    title: 'The Hermit’s Diary · III',
    text: 'The horses of Hearthbrook will not graze the last pasture before the Ascent Road. I led the grey mare there myself. She stood at the edge with her ears forward for a long time, the way a horse stands when it is listening to something very large breathing very slowly.',
  },
  {
    title: 'The Hermit’s Diary · IV',
    text: 'From the Last Watch I saw it again at dusk: a shape as big as a village, crossing the sky as slowly as weather, with trees growing on its back. The watchman did not look up. “That is only the whale,” he said. “It has right of way.”',
  },
  {
    title: 'The Hermit’s Diary · V',
    text: 'The well in the southern hollow shows the moon at noon. I lowered the bucket and drew up light. I am not ashamed to say I drank it. Since then I find things more easily: lost buttons, old paths, the place where the mushrooms make their ring.',
  },
  {
    title: 'The Hermit’s Diary · VI',
    text: 'Somebody hung a swing on the knoll that faces the city. It is the right height for no one in particular and it is never still. I sat on it for an afternoon. I understood, when I stood up, that the realm is not waiting for a hero. It is waiting for somebody who is not in a hurry.',
  },
  {
    title: 'The Hermit’s Diary · VII',
    text: 'I followed the white stag as far as the ring of mushrooms and no further. Small pale people were sitting in the roots. They tilted their heads at me, all together, with a sound like dry seeds. I took off my hat. It seemed the thing to do.',
  },
  {
    title: 'The Hermit’s Diary · VIII',
    text: 'I have found four of the five sigils and I am too old to learn to fly. So I will leave these pages where someone younger may trip over them. The door was never locked against you. It was shut from the inside, by something that wished to sleep until a person came who had walked the whole realm first. Be gentle when you wake it. It has been dreaming of the wind.',
  },
];

/** What the chests hold. */
export const RELICS: { name: string; text: string }[] = [
  { name: 'A Miller’s Compass', text: 'The needle ignores north entirely and points, with great conviction, at the Pillar of Ascent.' },
  { name: 'The Shepherd’s Whistle', text: 'Carved from an ibex horn. Blow it and every sheep in earshot looks up, then decides you are not worth the walk.' },
  { name: 'A Jar of Bottled Dusk', text: 'Somebody caught an evening in it and screwed the lid on. It is still warm, and faintly orange.' },
  { name: 'The First Map', text: 'It shows the roads, the city, the two villages, and a sea serpent drawn in the sky with the note: “mostly harmless”.' },
  { name: 'A Kodama’s Acorn', text: 'It rattles when you shake it. It also rattles, quite softly, when you do not.' },
  { name: 'The Watchman’s Lens', text: 'A cracked glass from the broken tower. Through it the stars look a little closer, and one of them looks back.' },
  { name: 'A Feather of the Cloud Whale', text: 'Whales do not have feathers. And yet here it is, as long as your arm, and it weighs nothing at all.' },
  { name: 'The Bellringer’s Glove', text: 'One glove, left hand, worn through at the palm. Lumenhall has not had a bellringer for three hundred years.' },
  { name: 'A Petal That Never Wilts', text: 'From the first cherry of Blossom Hollow. It is cool to the touch and smells of rain that has not fallen yet.' },
  { name: 'The Serpent’s Scale', text: 'Jade green, edged in gold, the size of a dinner plate. It hums when the wind rises.' },
  { name: 'A Stone From the Sky', text: 'It fell off a floating island and never quite got the idea of falling. Let go, and it sinks to the ground like a leaf.' },
  { name: 'The Hermit’s Spectacles', text: 'Left on a stump, neatly folded. The hermit is always just out. Through them, the fields look exactly as they are, which is the surprise.' },
];

export const RANKS = [
  { xp: 0, name: 'Wanderer' },
  { xp: 120, name: 'Rambler' },
  { xp: 300, name: 'Pathfinder' },
  { xp: 600, name: 'Wayfarer' },
  { xp: 1000, name: 'Ranger' },
  { xp: 1500, name: 'Lorekeeper' },
  { xp: 2200, name: 'Skyfarer' },
  { xp: 3000, name: 'Windrider' },
  { xp: 4000, name: 'Realmwalker' },
  { xp: 5200, name: 'Legend of the Fields' },
];
