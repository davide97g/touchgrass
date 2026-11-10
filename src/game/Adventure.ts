import { Vector3 } from 'three';
import type { Experience } from '../core/Experience';
import { params } from '../core/params';
import { U } from '../core/uniforms';
import { FX } from '../post/Post';
import { GameHUD } from '../ui/GameHUD';
import type { JournalUI } from '../ui/JournalUI';
import { FOG_N, MAP, MapUI } from '../ui/MapUI';
import { loreHtml, questsHtml } from '../ui/QuestLog';
import type { Zones } from '../ui/Zones';
import { findSummit } from '../world/summit';
import { Mysteries, type Thing } from '../world/game/Mysteries';
import { Wisps } from '../world/game/Wisps';
import { Mythic } from '../world/life/Mythic';
import { watchtower } from '../world/realm/sites';
import { Game, GREAT_PLACES } from './Game';
import { PAGES, RELICS, SIGILS, WAYSTONE } from './lore';

const PET_NAME: Record<string, string> = { sheep: 'the sheep', horse: 'the horse', chicken: 'the hen', cat: 'the cat', cow: 'the cow', dog: 'the sheepdog' };

/**
 * The adventure: ties the game's rules to the world. It owns the lights to gather, the things to
 * touch, the stranger creatures, the HUD and the map, and decides what E does wherever you stand.
 */
export class Adventure {
  readonly game: Game;
  readonly wisps: Wisps;
  readonly mysteries: Mysteries;
  readonly mythic: Mythic;
  readonly hud: GameHUD;
  readonly map: MapUI;
  private readonly veil: HTMLElement;
  private readonly fog = new Uint8Array(FOG_N * FOG_N);
  private fogDirty = false;
  private fogT = 0;
  private thing: Thing | null = null;
  private pet: { sp: string; ref: number } | null = null;
  private scanT = 0;
  private uiT = 0;
  private combo = 0;
  private comboT = 0;
  private flash = 0;
  private nextRing = -1;
  private trialT = 0;
  private wish: { x: number; z: number; label: string; until: number } | null = null;
  private wishCool = 0;
  private songT = 20;
  private quackT = 6;
  private readonly last = new Vector3();
  private doorBusy = false;
  private time = 0;
  private goalAt = 0;
  private goalNow: { x: number; z: number; y?: number; label: string } | null = null;

  constructor(private readonly exp: Experience, private readonly zones: Zones, private readonly journalUI: JournalUI, private readonly toast: (text: string, ms?: number) => void, coarse: boolean) {
    const realm = exp.realm;
    const game = (this.game = new Game(exp.journal));
    const c = exp.controller;

    this.wisps = new Wisps(realm, (i) => game.hasWisp(i));
    this.mysteries = new Mysteries(realm, exp.forest, exp.skyward.shrine, { x: c.position.x, z: c.position.z, yaw: c.yaw }, {
      sigil: (id) => game.hasSigil(id),
      page: (i) => game.hasPage(i),
      chest: (i) => game.hasChest(i),
      flag: (f) => game.has(f),
    });
    game.wispTotal = this.wisps.total;
    game.chestTotal = this.mysteries.things.filter((t) => t.kind === 'chest').length;

    const site = (kind: string) => realm.sites.find((s) => s.kind === kind)!;
    const secret = (id: string) => realm.plan.secrets.find((q) => q.id === id);
    const pillar = site('pillar');
    const ruins = site('ruins');
    const tower = watchtower(ruins);
    const sum = findSummit();
    const glades = ['fairyring', 'moonwell', 'hut'].map(secret).filter((q): q is NonNullable<typeof q> => !!q).map((q) => ({ x: q.x, z: q.z, r: q.id === 'fairyring' ? 9 : 7 }));
    const tree = U.uTree.value;
    if (tree.w > 0) glades.push({ x: tree.x, z: tree.z, r: 9 });
    const well = secret('moonwell');
    const roosts = [{ x: tower.x, y: tower.top() + 2, z: tower.z }];
    if (realm.plan.bell) roosts.push({ x: realm.plan.bell.x, y: realm.plan.bell.y, z: realm.plan.bell.z });
    roosts.push({ x: site('pass').x, y: site('pass').level + 16, z: site('pass').z });
    this.mythic = new Mythic(exp.features, {
      pillar: { x: pillar.x, z: pillar.z, top: pillar.level + 3.6 + 12 * 46 },
      glades,
      jellies: [{ x: site('crystals').x, z: site('crystals').z, r: 50 }, ...(well ? [{ x: well.x, z: well.z, r: 10 }] : [])],
      roosts,
      crags: [{ x: sum.x, z: sum.z }, { x: site('pass').x - 120, z: site('pass').z + 60 }],
    });
    this.mythic.dragonAwake = game.has('crown');
    this.mythic.onRattle = (x, z) => {
      const p = c.position;
      const d = Math.hypot(x - p.x, z - p.z);
      exp.sfx.rattle(((x - p.x) * Math.cos(c.yaw) + (z - p.z) * -Math.sin(c.yaw)) / Math.max(d, 1));
    };
    c.flight.wind = game.has('crown') ? 1.5 : 1;

    exp.scene.add(this.wisps.group, this.mysteries.group, this.mythic.group);
    exp.shadows.addRoot(this.mysteries.group);
    exp.subjectSources.push((out) => this.mythic.subjects(out));
    const stand = c.canStand;
    c.canStand = (x, z) => (!stand || stand(x, z)) && !this.mysteries.blocked(x, z);
    exp.extraParts = (out, x, z) => this.mysteries.parts(out, x, z);
    exp.hooks.push((dt) => this.update(dt));

    // ---- HUD, map, journal pages ----
    this.hud = new GameHUD(coarse);
    this.hud.onPromptTap = () => this.interact();
    this.hud.onTrackerClick = () => journalUI.show('quests');
    this.map = new MapUI(realm, game);
    this.map.marks = () => ({
      player: { x: c.position.x, z: c.position.z, yaw: c.yaw },
      places: this.mysteries.places,
      target: this.goal(),
      chests: game.chests,
      fog: this.fog,
    });
    journalUI.extra = {
      quests: () => questsHtml(game),
      lore: () => loreHtml(game),
      questCount: () => {
        const q = game.quests();
        return `${q.filter((x) => x.done).length}/${q.length}`;
      },
      loreCount: () => `${game.sigils + game.pages.length + game.chests.length}/${SIGILS.length + PAGES.length + game.chestTotal}`,
      track: (id) => {
        game.track(id);
        this.wish = null;
      },
    };
    journalUI.tab = 'quests';
    this.veil = document.createElement('div');
    this.veil.className = 'travel-veil bright';
    document.body.appendChild(this.veil);

    // ---- what the game says when things happen ----
    game.onXp = (n, label) => {
      this.hud.feed(`+${n} xp · ${label}`);
      if (label !== 'a light gathered') exp.sfx.xp();
    };
    game.onRank = (r) => {
      this.hud.fanfare('Rank up', r.name, `Rank ${r.level + 1} · ${r.xp} xp`, 'rank');
      exp.sfx.levelUp();
    };
    game.onQuestDone = (q) => {
      this.hud.fanfare(q.kind === 'main' ? 'Chapter complete' : 'Quest complete', q.title, `+${q.xp} xp`, q.kind === 'main' ? 'legend' : 'quest');
      exp.sfx.questDone();
      this.hud.feed(`+${q.xp} xp · ${q.title}`);
    };
    game.onChange = () => {
      this.uiT = 0;
      this.goalAt = 0;
      journalUI.refresh();
    };

    // Fog of war.
    try {
      const raw = atob(game.explored);
      for (let i = 0; i < raw.length && i < this.fog.length; i++) this.fog[i] = raw.charCodeAt(i);
    } catch {
      /* start under cloud */
    }
    game.settle();
    this.last.copy(c.position);
  }

  /** Something outside changed the journal (a discovery, a photo). */
  journalChanged(label: string): void {
    this.game.sync(label);
  }

  /** Where the tracked quest (or the Moonwell's wish) points. */
  private goal(): { x: number; z: number; y?: number; label: string } | null {
    // Worked out a few times a second, not every frame.
    if (this.time < this.goalAt) return this.goalNow;
    this.goalAt = this.time + 0.25;
    this.goalNow = this.findGoal();
    return this.goalNow;
  }

  private findGoal(): { x: number; z: number; y?: number; label: string } | null {
    if (this.wish && this.wish.until > this.time) return this.wish;
    const g = this.game;
    const q = g.quests().find((x) => x.id === g.tracked);
    const key = q?.steps.find((s) => !s.done)?.target;
    if (!q || !key) return null;
    if (key === 'trial' && this.nextRing > 0 && this.nextRing < this.mysteries.rings.length) {
      const r = this.mysteries.rings[this.nextRing];
      return { x: r.x, z: r.z, y: r.y, label: 'Next ring' };
    }
    const p = this.mysteries.places.get(key);
    return p ? { ...p, label: q.title } : null;
  }

  private promptFor(t: Thing): string | null {
    const g = this.game;
    switch (t.kind) {
      case 'waystone':
        return g.has('waystone') ? 'Read the Waystone again' : 'Read the Waystone';
      case 'sigil':
        return g.hasSigil(t.sigil!.id) ? `Read the ${t.sigil!.name}` : 'Touch the carving';
      case 'page':
        return g.hasPage(t.index) ? null : 'Take the page';
      case 'chest':
        return g.hasChest(t.index) ? null : 'Open the chest';
      case 'blade':
        return g.has('blade') ? null : 'Draw the blade';
      case 'door':
        return !g.has('door') ? 'Lay a hand on the great door' : this.mysteries.doorMoving ? null : 'Step through the door';
      case 'well':
        return 'Make a wish';
      case 'swing':
        return this.exp.controller.seated ? null : 'Sit on the swing';
    }
  }

  /** E: touch whatever is in front of you. Returns true if something answered. */
  interact(): boolean {
    const hud = this.hud;
    if (hud.reading) {
      hud.closeReader();
      return true;
    }
    const exp = this.exp;
    if (!exp.started) return false;
    const g = this.game;
    const sfx = exp.sfx;
    const t = this.thing;
    if (!t || !this.promptFor(t)) {
      if (!this.pet) return false;
      const fresh = g.pet(this.pet.sp);
      exp.fauna.pet(this.pet.ref);
      hud.hearts();
      sfx.pet();
      if (['sheep', 'cow', 'dog', 'cat', 'horse', 'chicken'].includes(this.pet.sp)) sfx.call(this.pet.sp as 'sheep', 2, 0);
      this.toast(fresh ? `${PET_NAME[this.pet.sp] ?? 'it'} likes you` : `${PET_NAME[this.pet.sp] ?? 'it'} leans into your hand`, 2200);
      return true;
    }
    switch (t.kind) {
      case 'waystone': {
        const first = g.setFlag('waystone', 'the Waystone');
        if (first) sfx.sigil(1);
        this.mysteries.refresh();
        hud.read('An inscription', WAYSTONE.title, WAYSTONE.text, first ? 'New story quest: The Five Sigils · J opens your journal' : '', '◎', '#ffe6a0');
        break;
      }
      case 'sigil': {
        const s = t.sigil!;
        if (g.hasSigil(s.id)) {
          hud.read('Awake', s.name, [s.verse], `${g.sigils} of ${SIGILS.length} sigils awake`, s.glyph, s.color);
          break;
        }
        if (s.when && !s.when.includes(params.atmosphere.time)) {
          sfx.deny();
          hud.read('Asleep', 'A cold carving', [s.asleep ?? 'Nothing answers.'], 'T changes the time of day', s.glyph, '#9aa4b0');
          break;
        }
        g.wakeSigil(s.id);
        this.mysteries.refresh();
        sfx.sigil(g.sigils);
        this.flash = 0.7;
        FX.flash.set(s.color);
        const all = g.sigils >= SIGILS.length;
        hud.read('A sigil wakes', s.name, [s.verse], all ? 'All five are awake. The door of the Pillar will know you.' : `${g.sigils} of ${SIGILS.length} sigils awake`, s.glyph, s.color);
        if (all) hud.fanfare('The five sigils are awake', 'The Door Will Know You', 'Go to the Pillar of Ascent', 'legend');
        break;
      }
      case 'page': {
        g.readPage(t.index);
        this.mysteries.refresh();
        sfx.page();
        const p = PAGES[t.index];
        hud.read('A weathered page', p.title, [p.text], `${g.pages.length} of ${PAGES.length} pages found`);
        break;
      }
      case 'chest': {
        g.openChest(t.index);
        this.mysteries.refresh();
        sfx.chest();
        const r = RELICS[t.index % RELICS.length];
        window.setTimeout(() => hud.read('A relic', r.name, [r.text], `${g.chests.length} of ${g.chestTotal} chests opened`, '❖', '#ffd866'), 900);
        break;
      }
      case 'blade': {
        const seen = GREAT_PLACES.filter((id) => exp.journal.isSeen(id)).length;
        if (seen < GREAT_PLACES.length) {
          sfx.deny();
          hud.read('It does not move', 'The Unclaimed Blade', ['You pull until your arms shake. The blade does not so much as hum.', 'Letters are cut into the stone below the guard: “I yield to the one who has seen all nine great places.”'], `${seen} of ${GREAT_PLACES.length} great places seen`, '†', '#8ff0ff');
          break;
        }
        this.mysteries.pullBlade();
        g.setFlag('blade', 'the Dawnblade');
        sfx.sigil(5);
        this.flash = 0.9;
        FX.flash.set('#bff4ff');
        hud.fanfare('It comes free', 'The Dawnblade', 'Lights in the grass now drift toward you', 'legend');
        break;
      }
      case 'door': {
        if (!g.has('door')) {
          if (g.sigils < SIGILS.length) {
            sfx.deny();
            this.toast(g.has('waystone') ? `the door is cold · ${g.sigils} of ${SIGILS.length} sockets are lit` : 'the door is cold · five dull sockets cross it', 3600);
            break;
          }
          g.setFlag('door', 'the door of the Pillar');
          this.mysteries.refresh();
          sfx.rumble(9);
          this.toast('the five sockets blaze · the door begins to sink', 5000);
          break;
        }
        if (this.mysteries.doorMoving || this.doorBusy) break;
        this.enterDoor();
        break;
      }
      case 'well': {
        this.makeWish();
        break;
      }
      case 'swing': {
        exp.controller.seated = true;
        g.setFlag('swing', 'a quiet moment');
        this.toast('you sit a while · the city looks small from here', 3600);
        break;
      }
    }
    this.scanT = 0;
    return true;
  }

  /** The well shows the way to something still unfound. */
  private makeWish(): void {
    const g = this.game;
    const exp = this.exp;
    if (this.wishCool > 0) {
      this.toast('the water is still settling', 2200);
      return;
    }
    this.wishCool = 6;
    exp.sfx.wish();
    const p = exp.controller.position;
    const until = this.time + 240;
    if (g.has('waystone')) {
      const s = SIGILS.find((q) => !g.hasSigil(q.id) && !g.has(`rev:${q.id}`));
      if (s) {
        g.setFlag(`rev:${s.id}`, '');
        const at = this.mysteries.places.get(`sigil:${s.id}`)!;
        this.wish = { ...at, label: s.name, until };
        this.goalAt = 0;
        this.toast(`the water shows a carving · the ${s.name.toLowerCase()} is marked on your compass and map`, 5200);
        return;
      }
    }
    const chest = this.mysteries.things.filter((t) => t.kind === 'chest' && !g.hasChest(t.index)).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (chest && (!this.wish || this.wish.label !== 'A chest')) {
      this.wish = { x: chest.x, z: chest.z, label: 'A chest', until };
      this.toast('the water shows a lantern over an old chest · follow your compass', 5000);
      return;
    }
    const w = this.wisps.nearest(p.x, p.z);
    if (w) {
      this.wish = { x: w.x, z: w.z, label: 'A light', until };
      this.toast('the water shows a light drifting in the grass · follow your compass', 5000);
    } else this.toast('the water shows only the moon · there is nothing left to find', 4000);
  }

  /** Through the door: the tower lifts you to its crown, where something has been asleep. */
  private enterDoor(): void {
    const exp = this.exp;
    const g = this.game;
    this.doorBusy = true;
    this.veil.classList.add('on');
    exp.sfx.whoosh(1, 2.4, true);
    window.setTimeout(() => {
      const pillar = exp.realm.sites.find((s) => s.kind === 'pillar')!;
      const a = Math.atan2(-0.6, -0.8);
      const x = pillar.x + Math.cos(a) * 165;
      const z = pillar.z + Math.sin(a) * 165;
      exp.ascend(x, pillar.level + 3.6 + 12 * 46 + 46, z, Math.atan2(-(pillar.x - x), -(pillar.z - z)));
      const first = !g.has('crown');
      this.mythic.dragonAwake = true;
      exp.controller.flight.wind = 1.5;
      window.setTimeout(() => {
        this.veil.classList.remove('on');
        this.doorBusy = false;
        if (first) {
          g.setFlag('crown', 'the crown of the realm');
          exp.sfx.roar();
          this.hud.fanfare('Something wakes', 'Aurelion, the Sky Serpent', 'Its wind is yours: you fly half again as fast', 'legend');
          this.toast('the crown of the realm · raise the lens (Z) and frame the serpent', 7000);
        } else this.toast('the crown of the realm', 3000);
      }, 900);
    }, 900);
  }

  private update(dt: number): void {
    const exp = this.exp;
    const c = exp.controller;
    const g = this.game;
    const cam = exp.camera.position;
    const p = c.position;
    const tod = params.atmosphere.time;
    this.time += dt;
    const time = U.uTime.value;

    this.mythic.update(dt, cam, p.x, p.z, tod);
    this.mysteries.update(dt, time, this.nextRing);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 0.9);
      FX.flashAmt = this.flash * this.flash;
    }
    this.wishCool -= dt;
    if (!exp.started) {
      this.wisps.updateGuide(dt, cam, c.yaw, null, false, false);
      return;
    }

    // ---- lights to gather ----
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;
    for (const i of this.wisps.gather(cam, c.flying, g.has('blade') ? 2.2 : 1, (k) => g.hasWisp(k))) {
      if (!g.collectWisp(i)) continue;
      exp.sfx.pickup(this.combo++);
      this.comboT = 9;
      if (g.wisps === 1) this.toast('a light gathered · there are more, in the fields and in the sky', 4200);
    }
    const goal = this.goal();
    this.wisps.updateGuide(dt, cam, c.yaw, goal, !exp.macro, c.flying);
    this.zones.quest = goal ? { x: goal.x, z: goal.z, label: goal.label } : null;

    // ---- what E would do here ----
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.12;
      const fx = -Math.sin(c.yaw);
      const fz = -Math.cos(c.yaw);
      this.thing = exp.macro ? null : this.mysteries.nearest(cam, fx, fz, c.flying, (t) => this.promptFor(t) !== null);
      let text = this.thing ? this.promptFor(this.thing) : null;
      this.pet = null;
      if (!text && !c.flying && !exp.macro) {
        const a = exp.fauna.petTarget(p.x, p.z);
        if (a) {
          this.pet = { sp: a.sp, ref: a.ref };
          text = `Stroke ${PET_NAME[a.sp] ?? 'it'}`;
        }
      }
      this.hud.prompt(this.hud.reading || this.map.visible || this.journalUI.visible ? null : text);
    }

    // ---- the wind trial ----
    this.trial(dt, cam, c.flying);

    // ---- the map clears where you go ----
    const moved = Math.hypot(p.x - this.last.x, p.z - this.last.z);
    if (moved < 60) g.travel(dt, moved, c.flying);
    this.last.copy(p);
    this.fogT -= dt;
    if (this.fogT <= 0) {
      this.fogT = 0.5;
      const cell = MAP.size / FOG_N;
      const reach = c.flying ? Math.min(420, 150 + (cam.y - p.y) * 1.2) : 115;
      const n = Math.ceil(reach / cell);
      const ci = Math.floor((p.x - MAP.x0) / cell);
      const cj = Math.floor((p.z - MAP.z0) / cell);
      for (let j = cj - n; j <= cj + n; j++) {
        for (let i = ci - n; i <= ci + n; i++) {
          if (i < 0 || j < 0 || i >= FOG_N || j >= FOG_N || this.fog[j * FOG_N + i]) continue;
          if (Math.hypot((i + 0.5) * cell + MAP.x0 - p.x, (j + 0.5) * cell + MAP.z0 - p.z) > reach) continue;
          this.fog[j * FOG_N + i] = 1;
          this.fogDirty = true;
        }
      }
      if (this.fogDirty) {
        this.fogDirty = false;
        let s = '';
        for (let i = 0; i < this.fog.length; i++) s += String.fromCharCode(this.fog[i]);
        g.setExplored(btoa(s));
      }
    }

    // ---- voices the game adds ----
    if (exp.audio.running) {
      this.songT -= dt;
      if (this.songT <= 0) {
        this.songT = 14 + Math.random() * 16;
        if (this.mythic.whaleOut) {
          const w = this.mythic.whalePos;
          const d = w.distanceTo(cam);
          if (d < 1500) exp.sfx.whale(Math.max(0.15, 1 - d / 1500), ((w.x - cam.x) * Math.cos(c.yaw) - (w.z - cam.z) * Math.sin(c.yaw)) / Math.max(d, 1));
        }
      }
      this.quackT -= dt;
      if (this.quackT <= 0) {
        this.quackT = 2;
        const f = this.mythic.nearestFowl(p.x, p.z);
        if (f && f.kind === 'duck' && f.d < 45 && Math.random() < 0.5) exp.sfx.call('duck', f.d, ((f.x - p.x) * Math.cos(c.yaw) - (f.z - p.z) * Math.sin(c.yaw)) / Math.max(f.d, 1));
      }
    }

    // ---- tracker ----
    this.uiT -= dt;
    if (this.uiT <= 0) {
      this.uiT = 0.3;
      const q = g.quests().find((x) => x.id === g.tracked) ?? null;
      let dist: string | null = null;
      if (goal) {
        const d = Math.hypot(goal.x - p.x, goal.z - p.z);
        dist = d < 1000 ? `${Math.round(d / 5) * 5} m` : `${(d / 1000).toFixed(1)} km`;
      }
      this.hud.setTracker(g.rank, q, g.wisps, g.wispTotal, dist, g.completion());
      this.hud.show(!exp.macro);
    }
  }

  /** Rings in order, against the clock. */
  private trial(dt: number, eye: Vector3, flying: boolean): void {
    const rings = this.mysteries.rings;
    const sfx = this.exp.sfx;
    if (this.nextRing < 0) {
      const r = rings[0];
      if (flying && Math.abs(eye.x - r.x) < 9 && Math.hypot(eye.x - r.x, eye.y - r.y, eye.z - r.z) < 9) {
        this.nextRing = 1;
        this.trialT = 0;
        sfx.ring(0, false);
        this.toast('the wind trial · fly through every ring · shift for speed', 4200);
      }
      return;
    }
    this.trialT += dt;
    this.hud.timer(`${this.trialT.toFixed(1)} s · ring ${this.nextRing}/${rings.length}`);
    if (!flying || this.trialT > 240) {
      this.nextRing = -1;
      this.hud.timer(null);
      this.toast(flying ? 'the rings go dark · fly through the first one to try again' : 'the trial ends when you land · fly through the first ring to try again', 4200);
      return;
    }
    const r = rings[this.nextRing];
    if (Math.abs(eye.x - r.x) < 10 && Math.hypot(eye.x - r.x, eye.y - r.y, eye.z - r.z) < 10) {
      const last = this.nextRing === rings.length - 1;
      sfx.ring(this.nextRing, last);
      this.nextRing++;
      if (last) {
        const t = this.trialT;
        const best = this.game.finishTrial(t);
        this.nextRing = -1;
        this.hud.timer(null);
        const medal = t < 50 ? 'gold' : t < 80 ? 'silver' : 'bronze';
        this.hud.fanfare('The wind trial', `${t.toFixed(1)} seconds`, `${medal}${best ? ' · a new best' : ` · best ${this.game.trialBest?.toFixed(1)} s`}`, 'rank');
      }
    }
  }
}
