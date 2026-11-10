import { Color, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { castShadow, shadowMaterial } from '../../core/Shadows';
import { mountainMask, terrainHeight } from '../common';
import type { FeatureMap } from '../Features';
import type { Forest } from './Forest';
import { hash2, mulberry32, range, type Rng } from './rand';
import { sampleNoise } from '../../core/noise';
import { watchtower } from './sites';
import { cellPools } from '../Features';
import type { TimeName } from '../../core/params';
import type { Subject } from '../life/RareFlora';
import { creatureMaterial } from '../life/creature';
import { SPECIES, type SpeciesName } from '../life/species';
import type { Realm } from './World';


interface Trait {
  walk: number;
  run: number;
  flee: number;
  stride: number;
  turn: number;
  /** Times of day it is out (always when absent). */
  when?: TimeName[];
  /** Never wanders (perched or standing watch). */
  still?: boolean;
  /** Height of the body centre and rough radius (for the lens). */
  body: [number, number];
  /** Lets a slow, gentle visitor come close enough to touch. */
  tame?: boolean;
}

const TRAITS: Record<SpeciesName, Trait> = {
  sheep: { walk: 0.55, run: 2.6, flee: 5, stride: 0.9, turn: 2, body: [0.8, 0.6], tame: true },
  horse: { walk: 1.1, run: 5.5, flee: 7, stride: 1.9, turn: 1.4, body: [1.45, 1.1], tame: true },
  deer: { walk: 0.9, run: 7.5, flee: 22, stride: 1.5, turn: 3, body: [1.15, 0.8] },
  boar: { walk: 0.6, run: 4.5, flee: 9, stride: 0.8, turn: 2.5, body: [0.65, 0.6] },
  chicken: { walk: 0.35, run: 2.2, flee: 2.5, stride: 0.18, turn: 5, body: [0.32, 0.2], tame: true },
  cat: { walk: 0.5, run: 3.5, flee: 3, stride: 0.35, turn: 4, body: [0.28, 0.25], tame: true },
  fox: { walk: 0.8, run: 6.5, flee: 9, stride: 0.55, turn: 3.5, body: [0.42, 0.35], when: ['Golden hour', 'Dusk', 'Misty dawn'] },
  hare: { walk: 0.7, run: 8, flee: 6, stride: 0.75, turn: 4, body: [0.27, 0.22] },
  hedgehog: { walk: 0.22, run: 0.5, flee: 1.6, stride: 0.07, turn: 2, body: [0.1, 0.13], when: ['Dusk', 'Misty dawn'] },
  ibex: { walk: 0.7, run: 4.5, flee: 16, stride: 1.0, turn: 2.5, body: [0.85, 0.6] },
  hart: { walk: 0.8, run: 6, flee: 14, stride: 1.6, turn: 2, body: [1.3, 0.9], when: ['Misty dawn'] },
  owl: { walk: 0, run: 0, flee: 0, stride: 1, turn: 1.5, body: [0.24, 0.18], when: ['Dusk', 'Misty dawn'], still: true },
  heron: { walk: 0.3, run: 0.6, flee: 7, stride: 0.6, turn: 1.5, body: [0.85, 0.45] },
  cow: { walk: 0.45, run: 2.4, flee: 4, stride: 1.2, turn: 1.2, body: [1.05, 1.0], tame: true },
  dog: { walk: 1.2, run: 5.5, flee: 0, stride: 0.5, turn: 5, body: [0.48, 0.4], tame: true },
  wolf: { walk: 1.0, run: 8, flee: 16, stride: 0.9, turn: 3.5, body: [0.72, 0.55], when: ['Dusk'] },
  bear: { walk: 0.6, run: 5, flee: 7, stride: 1.2, turn: 1.4, body: [0.95, 1.0] },
  squirrel: { walk: 0.9, run: 4.5, flee: 5, stride: 0.3, turn: 6, body: [0.1, 0.1] },
  badger: { walk: 0.4, run: 2.2, flee: 5, stride: 0.3, turn: 2.5, body: [0.22, 0.3], when: ['Dusk', 'Misty dawn'] },
  raven: { walk: 0, run: 0, flee: 0, stride: 1, turn: 2, body: [0.2, 0.2], still: true },
  kitsune: { walk: 0.7, run: 7, flee: 6, stride: 0.8, turn: 3, body: [0.68, 0.6], when: ['Dusk'] },
};

const ZOO = import.meta.env.DEV ? new URLSearchParams(location.search).get('zoo') : null;
export const ZOO_AT = { x: -60, z: -100 };

interface Animal {
  sp: SpeciesName;
  /** Out of hours: walks off and disappears. */
  away: boolean;
  hidden: boolean;
  /** Fixed height (perched birds). */
  perch: number | null;
  i: number;
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  state: 'graze' | 'walk' | 'flee' | 'look' | 'follow';
  /** Seconds of contentment left after being petted. */
  happy: number;
  t: number;
  tx: number;
  tz: number;
  home: { x: number; z: number; r: number };
  phase: number;
  gait: number;
  graze: number;
  seed: number;
  scale: number;
  coat: Color;
  /** Head turned toward the visitor (radians) and how pleased it is (0 .. 1). */
  look: number;
  mood: number;
  /** Stands in the line-up for inspection (development only). */
  zoo?: boolean;
}

interface Lod {
  mesh: InstancedMesh;
  anim: InstancedBufferAttribute;
  anim2: InstancedBufferAttribute;
  n: number;
}

/** How far the detailed model is used, and how far the smaller animals are drawn at all. */
const NEAR = 42;

const COATS: Record<SpeciesName, string[]> = {
  sheep: ['#f2eee4', '#ece6da', '#f6f2ea', '#d8d2c6', '#5a5048'],
  horse: ['#7a4a2a', '#5a3820', '#3a2a22', '#a8784a', '#e8e0d4', '#2a2422'],
  deer: ['#a0704a', '#94643e', '#ae7a52'],
  boar: ['#5a4434', '#4a382c', '#6a5040'],
  chicken: ['#f4f0e6', '#c87a3a', '#8a4a2a', '#f4f0e6', '#2a2a2a'],
  cat: ['#e8a050', '#3a3a3a', '#f0ece4', '#8a8478', '#c87a3a'],
  fox: ['#ffffff', '#f4e8e0', '#ffeee0'],
  hare: ['#ffffff', '#f0e8dc', '#e8dccb'],
  hedgehog: ['#ffffff', '#e8e0d8'],
  ibex: ['#ffffff', '#e8e0d4', '#d8d0c4'],
  hart: ['#ffffff'],
  owl: ['#ffffff'],
  heron: ['#ffffff'],
  cow: ['#b05a2c', '#a04e24', '#c06a36', '#8a4420', '#d8b890', '#2e2622'],
  dog: ['#ffffff'],
  wolf: ['#ffffff', '#e8e4e0', '#c8c8cc'],
  bear: ['#6a4a30', '#5a3e28', '#7a5636'],
  squirrel: ['#ffffff'],
  badger: ['#ffffff'],
  raven: ['#ffffff'],
  kitsune: ['#ffffff'],
};

/**
 * Herds that live in the realm: sheep in the pastures and on the open hills, horses by
 * Hearthbrook, deer along the forest edges, boars rooting near the crystals. They graze,
 * wander, look up when you come close and bolt if you rush them.
 */
export class Fauna {
  readonly group = new Group();
  private readonly animals: Animal[] = [];
  private readonly meshes = new Map<SpeciesName, { hi: Lod; lo: Lod }>();
  private readonly eye = new Vector3(0, -1e5, 0);
  private zoom = 1;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 1, 0);

  constructor(private readonly realm: Realm, private readonly features: FeatureMap, private readonly forest: Forest) {
    const r = mulberry32(0xa11a);
    type Herd = { sp: SpeciesName; x: number; z: number; r: number; n: number; perch?: { y: number; heading: number }; zoo?: boolean };
    const herds: Herd[] = [];
    for (const p of realm.plan.pastures) herds.push({ sp: p.kind, x: p.x, z: p.z, r: p.r, n: p.kind === 'sheep' ? 12 : 7 });
    for (const f of realm.plan.flocks) herds.push({ sp: f.kind, x: f.x, z: f.z, r: f.r, n: f.n });
    herds.push(
      { sp: 'sheep', x: 70, z: -300, r: 40, n: 9 },
      { sp: 'sheep', x: -260, z: 330, r: 35, n: 7 },
      { sp: 'deer', x: -900, z: -230, r: 60, n: 6 },
      { sp: 'deer', x: 190, z: 330, r: 55, n: 5 },
      { sp: 'deer', x: 720, z: -700, r: 60, n: 6 },
      { sp: 'deer', x: -1200, z: 700, r: 70, n: 5 },
      { sp: 'horse', x: 640, z: 120, r: 70, n: 6 },
      { sp: 'boar', x: -560, z: -650, r: 45, n: 4 },
      { sp: 'boar', x: 480, z: 120, r: 40, n: 3 },
      { sp: 'boar', x: -1000, z: 80, r: 50, n: 4 },
      // Hares out in the open fields (one family close to where you wake), foxes along the margins.
      { sp: 'hare', x: -150, z: -40, r: 45, n: 3 },
      { sp: 'hare', x: 200, z: -60, r: 50, n: 3 },
      { sp: 'hare', x: -380, z: -300, r: 50, n: 2 },
      { sp: 'hare', x: 420, z: 250, r: 50, n: 3 },
      { sp: 'hare', x: -200, z: 520, r: 45, n: 2 },
      { sp: 'hare', x: 700, z: -500, r: 50, n: 2 },
      { sp: 'fox', x: -300, z: 60, r: 60, n: 1 },
      { sp: 'fox', x: 350, z: -120, r: 60, n: 2 },
      { sp: 'fox', x: -760, z: -120, r: 60, n: 1 },
      { sp: 'fox', x: 520, z: 420, r: 60, n: 2 },
      { sp: 'fox', x: 120, z: -600, r: 60, n: 1 },
      // Ibex on the slopes under the range.
      { sp: 'ibex', x: -1900, z: 560, r: 90, n: 4 },
      { sp: 'ibex', x: -1720, z: 250, r: 70, n: 3 },
    );
    // Highland cattle beside the farmsteads, a sheepdog in each village.
    for (const f of realm.plan.flocks) {
      if (f.kind !== 'chicken') continue;
      const village = realm.sites.some((q) => q.kind === 'village' && Math.hypot(q.x - f.x, q.z - f.z) < 5);
      if (village) herds.push({ sp: 'dog', x: f.x, z: f.z, r: 16, n: 1 });
      else herds.push({ sp: 'cow', x: f.x + 26, z: f.z + 18, r: 30, n: 2 + (hash2(f.x, f.z, 2) > 0.5 ? 1 : 0) });
    }
    const hutQ = realm.plan.secrets.find((q) => q.id === 'hut');
    if (hutQ) {
      herds.push({ sp: 'dog', x: hutQ.approach.x, z: hutQ.approach.z, r: 8, n: 1 });
      // The pack that sings in the northern woods.
      herds.push({ sp: 'wolf', x: hutQ.x + 110, z: hutQ.z - 70, r: 70, n: 3 });
    }
    const wellQ = realm.plan.secrets.find((q) => q.id === 'moonwell');
    herds.push({ sp: 'bear', x: wellQ ? wellQ.x - 90 : -300, z: wellQ ? wellQ.z + 60 : 800, r: 60, n: 1 });
    herds.push({ sp: 'bear', x: -1380, z: 120, r: 70, n: 1 });
    // Squirrels where the trees stand close, badgers along the wood edges.
    {
      const woods: { x: number; z: number; w: number }[] = [];
      for (let x = -1500; x <= 1000; x += 90) {
        for (let z = -1100; z <= 1100; z += 90) {
          const w = sampleNoise(x / 1500 + 0.17, z / 1500 + 0.53, 1);
          if (w > 0.57 && mountainMask(x, z) < 0.02 && realm.map.roadDist(x, z) > 25 && !realm.sites.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 30)) woods.push({ x, z, w });
        }
      }
      const far = (list: { x: number; z: number }[], p: { x: number; z: number }, d: number) => list.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > d);
      const sq: { x: number; z: number }[] = [];
      for (const p of woods.filter((p) => p.w > 0.66).sort((a, b) => Math.hypot(a.x + 80, a.z + 120) - Math.hypot(b.x + 80, b.z + 120))) {
        if (sq.length < 8 && far(sq, p, 260)) sq.push(p);
      }
      for (const p of sq) herds.push({ sp: 'squirrel', x: p.x, z: p.z, r: 22, n: 2 });
      const bd: { x: number; z: number }[] = [];
      for (const p of woods.filter((p) => p.w < 0.62).sort((a, b) => hash2(a.x, a.z, 7) - hash2(b.x, b.z, 7))) {
        if (bd.length < 5 && far(bd, p, 420)) bd.push(p);
      }
      for (const p of bd) herds.push({ sp: 'badger', x: p.x, z: p.z, r: 30, n: 1 });
    }
    // A raven on the stone of the unclaimed blade, another on the altar of the Old Ring.
    const bladeQ = realm.plan.secrets.find((q) => q.id === 'blade');
    if (bladeQ) herds.push({ sp: 'raven', x: bladeQ.x + 0.75, z: bladeQ.z - 0.25, r: 0, n: 1, perch: { y: terrainHeight(bladeQ.x, bladeQ.z) + 0.5, heading: 0.9 } });
    const ringS = realm.sites.find((q) => q.kind === 'ring');
    if (ringS) herds.push({ sp: 'raven', x: ringS.x + 1.1, z: ringS.z - 0.3, r: 0, n: 1, perch: { y: ringS.level + 0.9, heading: 2.4 } });
    // The guardian of the shrine among the cherries.
    const groveS = realm.sites.find((q) => q.kind === 'grove');
    if (groveS) herds.push({ sp: 'kitsune', x: groveS.x, z: groveS.z, r: groveS.r * 0.9, n: 1 });
    // Hedgehogs in every farmyard.
    for (const f of realm.plan.flocks) if (f.kind === 'chicken') herds.push({ sp: 'hedgehog', x: f.x, z: f.z, r: Math.max(10, f.r), n: 1 });
    // The pale hart walks the glade of the fairy ring.
    const ring = realm.plan.secrets.find((q) => q.id === 'fairyring');
    herds.push({ sp: 'hart', x: ring ? ring.x : 720, z: ring ? ring.z : -700, r: 45, n: 1 });
    // The owl keeps the broken watchtower of the ruins.
    const ruins = realm.sites.find((q) => q.kind === 'ruins');
    if (ruins) {
      const t = watchtower(ruins);
      const a = (0.5 / 9) * Math.PI * 2;
      herds.push({ sp: 'owl', x: t.x + Math.cos(a) * 5.0, z: t.z + Math.sin(a) * 5.0, r: 0, n: 1, perch: { y: t.top(), heading: Math.atan2(Math.cos(a), Math.sin(a)) } });
    }
    // Herons fishing at the bigger ponds.
    const pools: { x: number; z: number; r: number; d: number }[] = [];
    for (let i = -8; i <= 6; i++) {
      for (let j = -6; j <= 6; j++) {
        for (const p of cellPools(i, j)) {
          if (p.r < 6 || hash2(p.x, p.z, 5) > 0.45) continue;
          pools.push({ x: p.x, z: p.z, r: p.r, d: Math.hypot(p.x + 80, p.z + 120) });
        }
      }
    }
    pools.sort((a, b) => a.d - b.d);
    for (const p of pools.slice(0, 10)) {
      const a = hash2(p.x, p.z, 9) * Math.PI * 2;
      const d = p.r * 1.15 + 1;
      herds.push({ sp: 'heron', x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, r: 2.5, n: 1, perch: { y: NaN, heading: Math.atan2(p.x - (p.x + Math.cos(a) * d), p.z - (p.z + Math.sin(a) * d)) } });
    }

    // Development: one of each kind lined up beside the waking place (?zoo, ?zoo=walk|run|graze|look|happy).
    if (ZOO !== null) {
      (Object.keys(SPECIES) as SpeciesName[]).forEach((sp, i) => herds.push({ sp, x: ZOO_AT.x + (i % 7) * 3.2, z: ZOO_AT.z + Math.floor(i / 7) * 4, r: 0, n: 1, zoo: true, perch: { y: terrainHeight(ZOO_AT.x + (i % 7) * 3.2, ZOO_AT.z + Math.floor(i / 7) * 4) + 0.8, heading: Math.PI / 2 } }));
    }

    const counts = Object.fromEntries(Object.keys(SPECIES).map((k) => [k, 0])) as Record<SpeciesName, number>;
    for (const h of herds) {
      for (let k = 0; k < h.n; k++) {
        let x = h.x;
        let z = h.z;
        if (h.r > 0) {
          for (let t = 0; t < 30; t++) {
            const a = r() * Math.PI * 2;
            const d = Math.sqrt(r()) * h.r * 0.8;
            x = h.x + Math.cos(a) * d;
            z = h.z + Math.sin(a) * d;
            if (this.walkable(x, z, h.sp)) break;
          }
        }
        const fixed = h.perch && !Number.isNaN(h.perch.y) ? h.perch.y : null;
        this.animals.push({
          sp: h.sp,
          away: false,
          hidden: false,
          perch: fixed,
          i: counts[h.sp]++,
          x,
          z,
          y: fixed ?? terrainHeight(x, z),
          heading: h.perch ? h.perch.heading : r() * Math.PI * 2,
          speed: 0,
          state: 'graze',
          happy: 0,
          t: range(r, 1, 12),
          tx: x,
          tz: z,
          home: { x: h.x, z: h.z, r: h.r },
          phase: r() * 10,
          gait: 0,
          graze: 1,
          seed: r(),
          scale: range(r, 0.88, 1.12) * (h.sp === 'deer' && r() < 0.6 ? 0.85 : 1) * (h.sp === 'hart' ? 1.15 : 1) * (h.sp === 'kitsune' ? 1.5 : 1),
          coat: new Color(),
          look: 0,
          mood: 0,
          zoo: h.zoo,
        });
      }
    }

    const mat = creatureMaterial();
    const hop = creatureMaterial(true);
    hop.uniforms = mat.uniforms;
    const white = new Color('#ffffff');
    for (const sp of Object.keys(SPECIES) as SpeciesName[]) {
      const n = counts[sp];
      if (!n) continue;
      const m = sp === 'hare' || sp === 'squirrel' ? hop : mat;
      const shadow = shadowMaterial(m);
      const lod = (detail: number): Lod => {
        const geo = SPECIES[sp](detail);
        const anim = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
        const anim2 = new InstancedBufferAttribute(new Float32Array(n * 2), 2);
        anim.setUsage(DynamicDrawUsage);
        anim2.setUsage(DynamicDrawUsage);
        geo.setAttribute('aAnim', anim);
        geo.setAttribute('aAnim2', anim2);
        const mesh = new InstancedMesh(geo, m, n);
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.frustumCulled = false;
        castShadow(mesh, shadow);
        for (let i = 0; i < n; i++) mesh.setColorAt(i, white);
        mesh.instanceColor!.setUsage(DynamicDrawUsage);
        mesh.count = 0;
        this.group.add(mesh);
        return { mesh, anim, anim2, n: 0 };
      };
      this.meshes.set(sp, { hi: lod(1), lo: lod(0.45) });
      const rc = mulberry32(sp.length * 977);
      for (const a of this.animals) {
        if (a.sp !== sp) continue;
        a.coat.set(COATS[sp][Math.floor(rc() * COATS[sp].length)]);
        if (sp === 'sheep' && rc() < 0.85) a.coat.set(COATS.sheep[Math.floor(rc() * 3)]);
      }
    }
    this.update(0, 0, 0, 0, 'Noon');
  }

  private walkable(x: number, z: number, sp: SpeciesName = 'sheep'): boolean {
    const map = this.realm.map;
    const tame = sp === 'chicken' || sp === 'cat' || sp === 'hedgehog' || sp === 'dog';
    const mm = mountainMask(x, z);
    const alpine = sp === 'ibex';
    return (
      this.features.waterDepth(x, z) < 0.05 &&
      map.solidAt(x, z) < 0.2 &&
      (tame || map.roadAt(x, z) < 0.6) &&
      (alpine ? mm > 0.06 && terrainHeight(x, z) < 330 : mm < 0.35) &&
      !this.forest.blocked(x, z, sp === 'squirrel' ? 0.25 : 0.6)
    );
  }

  private pickTarget(a: Animal, r: Rng): void {
    for (let t = 0; t < 8; t++) {
      const ang = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * a.home.r;
      const x = a.home.x + Math.cos(ang) * d;
      const z = a.home.z + Math.sin(ang) * d;
      if (this.walkable(x, z, a.sp)) {
        a.tx = x;
        a.tz = z;
        return;
      }
    }
    a.tx = a.home.x;
    a.tz = a.home.z;
  }

  /** Where the camera is and how far it is zoomed in: decides which animals get the detailed model. */
  view(eye: Vector3, zoom: number): void {
    this.eye.copy(eye);
    this.zoom = zoom;
  }

  update(dt: number, px: number, pz: number, playerSpeed: number, tod: TimeName): void {
    const r = Math.random;
    for (const a of this.animals) {
      const tr = TRAITS[a.sp];
      const dp = Math.hypot(a.x - px, a.z - pz);
      if (a.zoo) {
        // The line-up: stand still, graze or stride on the spot as asked.
        a.gait = ZOO === 'walk' ? 1 : ZOO === 'run' ? 2 : 0;
        a.graze += ((ZOO === 'graze' ? 1 : 0) - a.graze) * Math.min(1, dt * 1.8);
        a.phase += a.gait * 3.2 * dt;
        a.mood = ZOO === 'happy' ? 1 : 0;
        a.look = ZOO === 'look' ? Math.max(-1.1, Math.min(1.1, turnTo(0, Math.atan2(px - a.x, pz - a.z) - a.heading, 9))) : 0;
        continue;
      }
      const out = !tr.when || tr.when.includes(tod);
      // Out of hours: wander off and vanish where nobody sees; back once it's their time again.
      if (!out && !a.hidden) {
        if (dp > 45 || dt === 0 || tr.still) a.hidden = true;
        else if (!a.away) {
          a.away = true;
          a.state = 'walk';
          a.t = 12;
          const away = Math.atan2(a.x - px, a.z - pz);
          a.tx = a.x + Math.sin(away) * 60;
          a.tz = a.z + Math.cos(away) * 60;
        } else if (a.t <= 0) a.hidden = true;
      } else if (out && a.hidden && (dp > 40 || dt === 0)) {
        a.hidden = false;
        a.away = false;
        a.state = 'graze';
        a.t = range(r, 2, 8);
      }
      if (a.hidden || (dp > 700 && dt > 0)) continue; // nobody is watching
      a.t -= dt;
      a.happy = Math.max(0, a.happy - dt);
      // Tame animals let a slow, gentle visitor walk right up to them.
      const calm = tr.tame && (playerSpeed < 1.5 || a.happy > 0) ? 0.22 : 1;
      const spook = !tr.still && !a.away && dp < tr.flee * (playerSpeed > 2 ? 2.2 : 1) * calm;
      // The sheepdog trots over and keeps you company.
      if (a.sp === 'dog' && !spook) {
        if (dp < 34 && dp > 2.6) {
          a.state = 'follow';
          a.tx = px;
          a.tz = pz;
          a.t = 1;
        } else if (a.state === 'follow') {
          a.state = 'look';
          a.t = 3;
        }
      }
      if (spook && a.state !== 'flee') {
        a.state = 'flee';
        a.t = range(r, 2.5, 4.5);
        const away = Math.atan2(a.x - px, a.z - pz) + (r() - 0.5) * 0.8;
        a.tx = a.x + Math.sin(away) * 30;
        a.tz = a.z + Math.cos(away) * 30;
      } else if (!spook && !a.away && dp < Math.max(tr.flee * 2.4, tr.still ? 30 : 0) && a.state === 'graze' && r() < dt * 0.6) {
        a.state = 'look';
        a.t = range(r, 1.5, 3.5);
      }

      let targetSpeed = 0;
      let targetGraze = 0;
      if (a.state === 'graze') {
        targetGraze = tr.still ? 0 : 1;
        if (a.t <= 0) {
          a.t = 30;
          if (tr.still || (a.sp === 'heron' && r() < 0.8)) {
            a.t = range(r, 6, 20);
          } else {
            a.state = 'walk';
            this.pickTarget(a, r);
          }
        }
      } else if (a.state === 'look') {
        // Head up, turn toward the visitor.
        const want = Math.atan2(px - a.x, pz - a.z);
        a.heading = turnTo(a.heading, want, dt * tr.turn * 0.5);
        if (a.t <= 0) {
          a.state = 'graze';
          a.t = range(r, 4, 14);
        }
      } else if (a.state === 'follow') {
        targetSpeed = dp > 9 ? tr.run : tr.walk * 1.4;
      } else if (a.state === 'walk') {
        targetSpeed = tr.walk;
        if (!a.away && (Math.hypot(a.tx - a.x, a.tz - a.z) < 1.5 || a.t <= 0)) {
          a.state = 'graze';
          a.t = range(r, 5, 20);
        }
      } else {
        targetSpeed = tr.run;
        if (a.t <= 0) {
          a.state = 'look';
          a.t = range(r, 2, 4);
          a.home.x = a.home.x * 0.7 + a.x * 0.3;
          a.home.z = a.home.z * 0.7 + a.z * 0.3;
        }
      }

      if (targetSpeed > 0) {
        const want = Math.atan2(a.tx - a.x, a.tz - a.z);
        a.heading = turnTo(a.heading, want, dt * tr.turn);
      }
      a.speed += (targetSpeed - a.speed) * Math.min(1, dt * (a.state === 'flee' ? 4 : 1.5));
      a.graze += (targetGraze - a.graze) * Math.min(1, dt * 1.8);
      if (a.speed > 0.01) {
        const nx = a.x + Math.sin(a.heading) * a.speed * dt;
        const nz = a.z + Math.cos(a.heading) * a.speed * dt;
        if (this.walkable(nx, nz, a.sp)) {
          a.x = nx;
          a.z = nz;
        } else {
          a.heading += (r() < 0.5 ? 1 : -1) * 1.2;
          if (a.state === 'walk' && !a.away) this.pickTarget(a, r);
        }
      }
      a.gait = a.speed / Math.max(tr.walk, 0.01) > 1.5 ? 1 + Math.min(1, a.speed / tr.run) : a.speed / Math.max(tr.walk, 0.01);
      // The head follows the visitor while it watches; a stroked animal is pleased for a while.
      const watching = a.state === 'look' || (a.state === 'follow' && dp < 6) || (a.happy > 0 && dp < 8);
      const want = watching && !tr.still ? Math.max(-1.1, Math.min(1.1, turnTo(0, Math.atan2(px - a.x, pz - a.z) - a.heading, 9))) : 0;
      a.look += (want - a.look) * Math.min(1, dt * 4);
      a.mood += ((a.happy > 0 ? 1 : a.state === 'follow' ? 0.5 : 0) - a.mood) * Math.min(1, dt * 3);
      a.phase += (a.speed / tr.stride) * Math.PI * dt;
      if (a.perch !== null) a.y = a.perch;
      else a.y += (terrainHeight(a.x, a.z) - a.y) * Math.min(1, dt * 10 + (dt === 0 ? 1 : 0));
    }

    // Up close the detailed model, further off the stand-in; out of sight nothing at all.
    for (const l of this.meshes.values()) l.hi.n = l.lo.n = 0;
    const near = NEAR * this.zoom;
    for (const a of this.animals) {
      if (a.hidden) continue;
      const d = Math.hypot(a.x - this.eye.x, a.y - this.eye.y, a.z - this.eye.z);
      const size = TRAITS[a.sp].body[1] * a.scale;
      if (d > Math.min(1400, size * 900 * this.zoom + 120)) continue;
      const l = this.meshes.get(a.sp)!;
      const t = d < near ? l.hi : l.lo;
      const i = t.n++;
      this.q.setFromAxisAngle(this.up, a.heading);
      this.m.compose(this.v.set(a.x, a.y, a.z), this.q, this.s.setScalar(a.scale));
      t.mesh.setMatrixAt(i, this.m);
      t.mesh.setColorAt(i, a.coat);
      t.anim.setXYZW(i, a.phase, a.gait, a.graze, a.seed);
      t.anim2.setXY(i, a.look, a.mood);
    }
    for (const l of this.meshes.values()) {
      for (const t of [l.hi, l.lo]) {
        t.mesh.count = t.n;
        t.mesh.visible = t.n > 0;
        if (!t.n) continue;
        t.mesh.instanceMatrix.needsUpdate = true;
        t.mesh.instanceColor!.needsUpdate = true;
        t.anim.needsUpdate = true;
        t.anim2.needsUpdate = true;
      }
    }
  }

  /** Visible animals near the camera, for the lens and the journal. */
  subjects(out: Subject[], cx: number, cz: number, range = 320): void {
    for (const a of this.animals) {
      if (a.hidden) continue;
      if (Math.abs(a.x - cx) > range || Math.abs(a.z - cz) > range) continue;
      const tr = TRAITS[a.sp];
      out.push({ id: a.sp, x: a.x, y: a.y + tr.body[0] * a.scale, z: a.z, r: tr.body[1] * a.scale });
    }
  }

  /** A tame animal close enough to touch, in front of the visitor. */
  petTarget(x: number, z: number, reach = 2.6): { sp: SpeciesName; x: number; y: number; z: number; ref: number } | null {
    let best: { sp: SpeciesName; x: number; y: number; z: number; ref: number } | null = null;
    let bd = reach;
    this.animals.forEach((a, ref) => {
      if (a.hidden || !TRAITS[a.sp].tame || a.state === 'flee') return;
      const d = Math.hypot(a.x - x, a.z - z) - TRAITS[a.sp].body[1] * a.scale * 0.6;
      if (d < bd) {
        bd = d;
        best = { sp: a.sp, x: a.x, y: a.y + TRAITS[a.sp].body[0] * a.scale, z: a.z, ref };
      }
    });
    return best;
  }

  /** Stroke it: it lifts its head, stays a while and is not afraid of you for some time. */
  pet(ref: number): void {
    const a = this.animals[ref];
    if (!a) return;
    a.happy = 40;
    a.state = 'look';
    a.t = 5;
  }

  /** Where the animals of one kind are (for the map and for quests). */
  whereabouts(sp: SpeciesName): { x: number; z: number } | null {
    const a = this.animals.find((q) => q.sp === sp);
    return a ? { x: a.home.x, z: a.home.z } : null;
  }

  /** The nearest visible animal of each kind within reach (for their calls). */
  nearest(cx: number, cz: number, maxD: number): { sp: SpeciesName; x: number; z: number; d: number }[] {
    const best = new Map<SpeciesName, { sp: SpeciesName; x: number; z: number; d: number }>();
    for (const a of this.animals) {
      if (a.hidden) continue;
      const d = Math.hypot(a.x - cx, a.z - cz);
      if (d > maxD) continue;
      const b = best.get(a.sp);
      if (!b || d < b.d) best.set(a.sp, { sp: a.sp, x: a.x, z: a.z, d });
    }
    return [...best.values()];
  }
}

function turnTo(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + Math.max(-k, Math.min(k, d));
}
