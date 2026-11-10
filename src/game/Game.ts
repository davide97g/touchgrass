import { CATALOG, type Rarity } from '../discovery/catalog';
import type { Journal } from '../discovery/Journal';
import { PAGES, RANKS, SIGILS } from './lore';

interface Save {
  v: 1;
  wisps: number[];
  sigils: string[];
  pages: number[];
  chests: number[];
  pets: string[];
  flags: Record<string, number>;
  quests: string[];
  tracked: string | null;
  trialBest: number | null;
  /** Fog of war: base64 of the explored grid. */
  explored: string;
  walked: number;
  flown: number;
}

const LS_KEY = 'touchgrass.game.v1';
const fresh = (): Save => ({ v: 1, wisps: [], sigils: [], pages: [], chests: [], pets: [], flags: {}, quests: [], tracked: null, trialBest: null, explored: '', walked: 0, flown: 0 });

const RARITY_XP: Record<Rarity, number> = { common: 10, uncommon: 20, rare: 40, legendary: 100 };

export interface QuestStep {
  text: string;
  done: boolean;
  n?: number;
  of?: number;
  /** Key of a place the compass can point to. */
  target?: string;
}

export interface QuestView {
  id: string;
  kind: 'main' | 'side';
  title: string;
  blurb: string;
  steps: QuestStep[];
  xp: number;
  done: boolean;
  /** Not yet offered (earlier chapters unfinished). */
  locked: boolean;
}

export interface Rank {
  level: number;
  name: string;
  xp: number;
  /** Progress toward the next rank, 0..1 (1 at the top). */
  frac: number;
  next: number | null;
}

const FARM = ['sheep', 'horse', 'chicken', 'cow', 'dog'];
const NIGHT = ['owl', 'hedgehog', 'fox', 'bat', 'badger', 'wolf'];
const WATER = ['heron', 'frog', 'dragonfly', 'swan', 'duck'];
const LEGENDS = ['hart', 'kitsune', 'whale', 'kodama'];
const SECRETS = ['fairyring', 'moonwell', 'swing', 'blade', 'hut', 'skyshrine', 'summit'];
export const GREAT_PLACES = CATALOG.filter((e) => e.id.startsWith('site:')).map((e) => e.id);

/**
 * The game layered over the field: experience and ranks, the main story (five sigils and a door
 * that never opened), side quests, and everything the traveller has gathered. Experience is
 * derived from what the journal and this save hold, so progress made before the game existed counts.
 */
export class Game {
  private s: Save = fresh();
  private lastXp = 0;
  private lastLevel = 0;
  private saveT = 0;
  wispTotal = 0;
  chestTotal = 0;

  onXp: ((amount: number, label: string) => void) | null = null;
  onRank: ((rank: Rank) => void) | null = null;
  onQuestDone: ((q: QuestView) => void) | null = null;
  onChange: (() => void) | null = null;

  constructor(readonly journal: Journal) {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Save>;
        if (p && p.v === 1) this.s = { ...fresh(), ...p };
      }
    } catch {
      /* private mode or corrupted: start fresh */
    }
  }

  /** Call once the world knows its totals: settles what was already earned without fanfare. */
  settle(): void {
    for (const q of this.quests()) if (q.done && !this.s.quests.includes(q.id)) this.s.quests.push(q.id);
    this.lastXp = this.xp;
    this.lastLevel = this.rank.level;
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.s));
    } catch {
      /* quota or private mode */
    }
  }

  // ---------------------------------------------------------------- experience

  get xp(): number {
    const j = this.journal;
    let xp = 0;
    for (const e of CATALOG) {
      if (j.isSeen(e.id)) xp += RARITY_XP[e.rarity];
      if (j.isCollected(e.id)) xp += RARITY_XP[e.rarity] * 2;
    }
    xp += this.s.wisps.length * 5 + this.s.sigils.length * 120 + this.s.pages.length * 30 + this.s.chests.length * 60 + this.s.pets.length * 15;
    if (this.has('waystone')) xp += 30;
    if (this.has('door')) xp += 300;
    if (this.has('blade')) xp += 300;
    if (this.s.trialBest !== null) xp += 150;
    const all = this.questDefs();
    for (const id of this.s.quests) xp += all.find((q) => q.id === id)?.xp ?? 0;
    return xp;
  }

  get rank(): Rank {
    const xp = this.xp;
    let level = 0;
    for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].xp) level = i;
    const next = RANKS[level + 1]?.xp ?? null;
    return { level, name: RANKS[level].name, xp, next, frac: next === null ? 1 : (xp - RANKS[level].xp) / (next - RANKS[level].xp) };
  }

  /** Something changed: hand out the experience it earned, check ranks and quests. */
  sync(label: string): void {
    // Quests first: finishing one adds its reward.
    const finished: QuestView[] = [];
    for (let pass = 0; pass < 3; pass++) {
      let any = false;
      for (const q of this.quests()) {
        if (q.done && !q.locked && !this.s.quests.includes(q.id)) {
          this.s.quests.push(q.id);
          finished.push(q);
          any = true;
        }
      }
      if (!any) break;
    }
    const xp = this.xp;
    const questXp = finished.reduce((a, q) => a + q.xp, 0);
    const gain = xp - this.lastXp - questXp;
    this.lastXp = xp;
    if (gain > 0) this.onXp?.(gain, label);
    for (const q of finished) {
      this.onQuestDone?.(q);
      if (this.s.tracked === q.id) this.s.tracked = null;
    }
    const r = this.rank;
    if (r.level > this.lastLevel) this.onRank?.(r);
    this.lastLevel = r.level;
    this.save();
    this.onChange?.();
  }

  // ---------------------------------------------------------------- state

  has(flag: string): boolean {
    return flag in this.s.flags;
  }

  setFlag(flag: string, label = ''): boolean {
    if (this.has(flag)) return false;
    this.s.flags[flag] = Date.now();
    this.sync(label);
    return true;
  }

  hasWisp(i: number): boolean {
    return this.s.wisps.includes(i);
  }
  get wisps(): number {
    return this.s.wisps.length;
  }
  collectWisp(i: number): boolean {
    if (this.hasWisp(i)) return false;
    this.s.wisps.push(i);
    this.sync('a light gathered');
    return true;
  }

  hasSigil(id: string): boolean {
    return this.s.sigils.includes(id);
  }
  get sigils(): number {
    return this.s.sigils.length;
  }
  wakeSigil(id: string): boolean {
    if (this.hasSigil(id)) return false;
    this.s.sigils.push(id);
    this.sync('a sigil woken');
    return true;
  }

  hasPage(i: number): boolean {
    return this.s.pages.includes(i);
  }
  get pages(): number[] {
    return this.s.pages;
  }
  readPage(i: number): boolean {
    if (this.hasPage(i)) return false;
    this.s.pages.push(i);
    this.sync('a page of the diary');
    return true;
  }

  hasChest(i: number): boolean {
    return this.s.chests.includes(i);
  }
  get chests(): number[] {
    return this.s.chests;
  }
  openChest(i: number): boolean {
    if (this.hasChest(i)) return false;
    this.s.chests.push(i);
    this.sync('a relic found');
    return true;
  }

  get pets(): string[] {
    return this.s.pets;
  }
  pet(sp: string): boolean {
    if (this.s.pets.includes(sp)) return false;
    this.s.pets.push(sp);
    this.sync('a new friend');
    return true;
  }

  get trialBest(): number | null {
    return this.s.trialBest;
  }
  finishTrial(seconds: number): boolean {
    const best = this.s.trialBest === null || seconds < this.s.trialBest;
    if (best) this.s.trialBest = seconds;
    this.sync('the wind trial');
    return best;
  }

  get explored(): string {
    return this.s.explored;
  }
  setExplored(b64: string): void {
    this.s.explored = b64;
  }

  /** Distance travelled; saved now and then. */
  travel(dt: number, metres: number, flying: boolean): void {
    if (flying) this.s.flown += metres;
    else this.s.walked += metres;
    this.saveT += dt;
    if (this.saveT > 12) {
      this.saveT = 0;
      this.save();
    }
  }
  get walked(): number {
    return this.s.walked;
  }
  get flown(): number {
    return this.s.flown;
  }

  // ---------------------------------------------------------------- quests

  get tracked(): string | null {
    const all = this.quests();
    const t = all.find((q) => q.id === this.s.tracked && !q.done && !q.locked);
    if (t) return t.id;
    return (all.find((q) => q.kind === 'main' && !q.done && !q.locked) ?? all.find((q) => !q.done && !q.locked))?.id ?? null;
  }

  track(id: string): void {
    this.s.tracked = id;
    this.save();
    this.onChange?.();
  }

  quests(): QuestView[] {
    return this.questDefs();
  }

  private questDefs(): QuestView[] {
    const j = this.journal;
    const got = (ids: string[]) => ids.filter((id) => j.isCollected(id)).length;
    const seen = (ids: string[]) => ids.filter((id) => j.isSeen(id)).length;
    const count = (text: string, n: number, of: number, target?: string): QuestStep => ({ text, done: n >= of, n: Math.min(n, of), of, target });
    const flag = (text: string, f: string, target?: string): QuestStep => ({ text, done: this.has(f), target });
    const q = (id: string, kind: 'main' | 'side', title: string, blurb: string, xp: number, steps: QuestStep[], locked = false): QuestView => ({
      id,
      kind,
      title,
      blurb,
      xp,
      steps,
      locked,
      done: !locked && steps.every((s) => s.done),
    });

    const flora = CATALOG.filter((e) => e.cat === 'flora').map((e) => e.id);
    const anyFlora = got(flora) > 0;
    const anyFauna = CATALOG.some((e) => e.cat === 'fauna' && j.isCollected(e.id));
    const waystone = this.has('waystone');
    const five = this.sigils >= SIGILS.length;
    const door = this.has('door');

    const sigilSteps: QuestStep[] = SIGILS.map((s) => ({
      text: this.hasSigil(s.id) ? `${s.glyph} ${s.name}` : s.riddle,
      done: this.hasSigil(s.id),
      target: !this.hasSigil(s.id) && this.has(`rev:${s.id}`) ? `sigil:${s.id}` : undefined,
    }));

    return [
      q('m1', 'main', 'First Light', 'A stone near where you woke is glowing. It seems to be waiting.', 60, [flag('Find the glowing Waystone and read it (E)', 'waystone', 'waystone')]),
      q('m2', 'main', 'The Five Sigils', 'Five sigils keep the door of the Pillar. Each sleeps where its riddle says. The Moonwell is said to show the way to those who ask.', 400, sigilSteps, !waystone),
      q('m3', 'main', 'The Door That Never Opened', 'The sigils are awake. The Pillar of Ascent stands at the end of the Ascent Road, past Hearthbrook.', 500, [flag('Stand before the great door of the Pillar and open it (E)', 'door', 'pillar'), flag('Step through', 'crown', 'pillar')], !five),
      q('m4', 'main', 'Crown of the Realm', 'Something has woken at the top of the tower.', 600, [{ text: 'Photograph Aurelion, the Sky Serpent', done: j.isCollected('dragon'), target: 'crown' }], !door),

      q('lens', 'side', 'A Good Eye', 'The lens keeps what you look at closely.', 60, [
        { text: 'Take a photo with the lens (Z, then click)', done: j.photos.length > 0 },
        { text: 'Collect a rare flower: frame it and hold still', done: anyFlora },
        { text: 'Collect a creature the same way', done: anyFauna },
      ]),
      q('wisp1', 'side', 'Lights in the Grass', 'Small lights drift over the fields and roads. Walk through one.', 80, [count('Gather 10 drifting lights', this.wisps, 10)]),
      q('wisp2', 'side', 'Lamplighter', 'They are thicker along the roads, on the hilltops and, they say, in the sky.', 250, [count('Gather 40 drifting lights', this.wisps, 40)], this.wisps < 10),
      q('wisp3', 'side', 'Every Last Light', 'Some of them were never meant to be reached on foot.', 800, [count('Gather every light in the realm', this.wisps, Math.max(1, this.wispTotal))], this.wisps < 40),
      q('pet', 'side', 'A Gentle Hand', 'Walk slowly and tame animals let you come close enough to touch (E).', 120, [count('Befriend 5 kinds of animal', this.s.pets.length, 5)]),
      q('farm', 'side', 'Farmhand’s Album', 'The farmsteads and villages keep five kinds of animal.', 150, [count('Photograph sheep, horse, hen, cow and sheepdog', got(FARM), FARM.length)]),
      q('water', 'side', 'Still Waters', 'The fairy pools are busier than they look.', 200, [count('Photograph heron, frog, dragonfly, swan and mallard', got(WATER), WATER.length)]),
      q('night', 'side', 'Night Shift', 'After sunset a different realm clocks in. (T changes the hour.)', 300, [count('Photograph owl, hedgehog, fox, bat, badger and wolf', got(NIGHT), NIGHT.length)]),
      q('legend', 'side', 'Things That Should Not Be', 'A white stag, a fox with too many tails, small pale people in the roots, a whale in the sky.', 700, [count('Photograph the Pale Hart, the Kitsune, a Kodama and the Cloud Whale', got(LEGENDS), LEGENDS.length)]),
      q('botany', 'side', 'The Botanist', 'Twelve rare flowers, each growing where the real one would.', 500, [count('Collect all twelve rare flowers', got(flora), flora.length)]),
      q('carto', 'side', 'Cartographer', 'Nine great places stand in the realm. The map (Tab) fills in as you walk.', 200, [count('Discover the nine great places', seen(GREAT_PLACES), GREAT_PLACES.length)]),
      q('secret', 'side', 'Off the Map', 'Some places are on no signpost.', 400, [count('Find the seven hidden places', seen(SECRETS), SECRETS.length)]),
      q('diary', 'side', 'The Hermit’s Diary', 'The hermit is always just out, but left pages pinned to posts across the realm.', 300, [count('Find the eight pages', this.s.pages.length, PAGES.length)]),
      q('chest', 'side', 'Treasure Hunter', 'Old chests sit under lanterns in out-of-the-way corners.', 400, [count('Open every chest', this.s.chests.length, Math.max(1, this.chestTotal))]),
      q('trial', 'side', 'The Wind Trial', 'A course of rings hangs in the air east of where you woke. Fly (V) through the first to begin.', 200, [{ text: 'Fly through every ring of the course', done: this.s.trialBest !== null, target: 'trial' }]),
      q('blade', 'side', 'The Unclaimed Blade', 'A sword stands in a stone on a bare hill. It yields only to one who has seen all nine great places.', 300, [
        { text: 'Find the blade in the stone', done: j.isSeen('blade') },
        count('See all nine great places', seen(GREAT_PLACES), GREAT_PLACES.length),
        flag('Draw the blade (E)', 'blade', 'blade'),
      ]),
    ];
  }

  /** Share of everything there is to do, 0..100. */
  completion(): number {
    const j = this.journal.counts();
    const qs = this.quests();
    const parts: [number, number][] = [
      [j.got, j.total],
      [this.wisps, Math.max(1, this.wispTotal)],
      [qs.filter((q) => q.done).length, qs.length],
      [this.s.chests.length, Math.max(1, this.chestTotal)],
      [this.s.pages.length, PAGES.length],
    ];
    return Math.round((parts.reduce((a, [n, of]) => a + n / of, 0) / parts.length) * 100);
  }
}
