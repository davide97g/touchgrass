/**
 * The trailer's clock, in seconds. Picture (Director) and sound (Score) both read
 * these marks, and the audio clock drives both, so cuts land on the music.
 */
export const M = {
  open: 0, // eyes open, macro in the grass
  flowers: 4.5, // focus wanders over the flowers
  rise: 10, // focus lets go, stand up, the field opens
  walk: 14.5,
  birdsFar: 15.5,
  overhead: 20,
  swallows: 28, // long lens on the swallows, clouds catch the sunset
  sun: 36, // settle on the setting sun
  gust: 41,
  blink: 46,
  night: 47.2, // eyes open again: night, fireflies
  fireflies: 55,
  perch: 66.8, // one firefly glows brighter on a blade tip
  white: 72.8,
  dawn: 73,
  skyward: 75.5,
  pondCut: 79,
  pond: 79.5,
  orbit: 83,
  details: 90,
  call: 100, // a small glowing flower across the water
  dive: 103.5,
  flare: 111.3,
  fairy: 111.6, // wake at sunset by a fairy pool
  float: 119,
  follow: 124,
  accel: 127,
  vortex: 131,
  stars: 134, // lying in the grass under the stars
  meteor: 139.5,
  title: 142.3,
  fadeOut: 152.5,
  end: 156,
};

export const RUNE_STONES = 9;

export interface RuneNote {
  t: number;
  stone: number;
  midi: number;
  vel: number;
}

/**
 * The ancient tune. Every note lights one rune stone, walking around the ring,
 * so the eye can follow the melody: gentle at first, then an accelerando into the vortex.
 */
function buildRuneNotes(): RuneNote[] {
  const out: RuneNote[] = [];
  let stone = 0;
  const add = (t: number, midi: number, vel: number) => {
    out.push({ t, stone: stone % RUNE_STONES, midi, vel });
    stone++;
  };
  // D dorian, lyre-like. [beat, midi], beat = 0.55 s.
  const beat = 0.55;
  const phrase: [number, number][] = [
    [0, 69], [1, 74], [1.5, 76], [2, 77], [3, 76], [3.5, 74],
    [4, 72], [5, 69], [6, 67], [6.5, 69],
    [8, 74], [9, 77], [9.5, 79], [10, 81], [11, 79], [11.5, 77],
    [12, 76], [13, 72], [13.5, 74],
  ];
  const t0 = M.fairy + 1.0;
  for (const [b, m] of phrase) add(t0 + b * beat, m, 0.75);
  // Answer phrase while drifting to the centre.
  const t1 = t0 + 15 * beat;
  const answer: [number, number][] = [[0, 81], [1, 79], [1.5, 77], [2, 76], [3, 74], [4, 72], [4.5, 74], [5, 69]];
  for (const [b, m] of answer) add(t1 + b * beat, m, 0.7);
  // Slow follow: one stone at a time.
  const slow = [74, 77, 81, 84];
  slow.forEach((m, i) => add(M.follow + 0.2 + i * 0.72, m, 0.95));
  // Accelerando: a Dm9 arpeggio spiralling up and round, ever faster.
  const arp = [62, 65, 69, 72, 76, 77, 81, 84, 88, 86, 84, 81, 77, 76, 72, 69];
  let t = M.accel;
  let gap = 0.5;
  let i = 0;
  while (t < M.vortex + 1.6) {
    add(t, arp[i % arp.length] + (t > M.vortex ? 12 : 0), 0.9);
    i++;
    t += gap;
    gap = Math.max(0.045, gap * 0.88);
  }
  return out;
}

export const RUNE_NOTES = buildRuneNotes();
