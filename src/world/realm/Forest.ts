import { Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { sampleNoise } from '../../core/noise';
import { castShadow } from '../../core/Shadows';
import { U } from '../../core/uniforms';
import { mountainMask, smoothstep, terrainHeight } from '../common';
import { cellPools, FEATURE_CELL, type FeatureMap } from '../Features';
import { makeVariants, setLeafA2C, treeMaterials, type SpeciesName, type TreeMaterials, type TreeVariant } from '../flora/Arbor';
import { mulberry32, range } from './rand';
import { REALM_CENTER, REALM_SIZE } from './Realm';
import type { Realm } from './World';

const SPACING = 8.5;
const GRID = 32;

interface Spec {
  x: number;
  z: number;
  y: number;
  s: number;
  rot: number;
  sp: SpeciesName;
  v: number;
}

/** Extra trees placed by other systems (floating islands), at absolute heights. */
export interface TreeSpot {
  x: number;
  y: number;
  z: number;
  s: number;
  sp: SpeciesName;
}

const KIND_TO_SPECIES: SpeciesName[] = ['spruce', 'oak', 'birch', 'bush', 'cherry'];
const VARIANTS: Record<SpeciesName, number> = { oak: 4, spruce: 3, birch: 3, cherry: 3, bush: 3 };
const TRUNK: Record<SpeciesName, number> = { oak: 0.6, spruce: 0.38, birch: 0.24, cherry: 0.42, bush: 0 };

interface TreeSet {
  sp: SpeciesName;
  v: number;
  trees: Spec[];
  near: { bark: InstancedMesh; leaves: InstancedMesh };
}

const FAR_CHUNK = 900;

/**
 * Woods across the realm: spruce on the foothills, oak, birch and hazel in the lowlands,
 * lone oaks and birches in the meadows, cherries in the blossom grove. Every tree is a grown,
 * parametric tree; near ones get full detail, the rest a lighter version, dissolving between.
 */
export class Forest {
  readonly group = new Group();
  private readonly trunks = new Map<string, { x: number; z: number; r: number }[]>();
  private readonly sets: TreeSet[] = [];
  private readonly grid = new Map<string, Spec[]>();
  private readonly lod = { near: { value: 140 }, band: { value: 26 } };
  private readonly mats: TreeMaterials[] = [];
  private lastX = Infinity;
  private lastZ = Infinity;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly sv = new Vector3();
  private readonly pv = new Vector3();
  private readonly Y = new Vector3(0, 1, 0);
  readonly count: number;

  constructor(realm: Realm, features: FeatureMap, extra: TreeSpot[] = []) {
    void features;
    const r = mulberry32(0xf0e57);
    const map = realm.map;
    const spawn = { x: -80, z: -120 };
    const tree = U.uTree.value;
    const half = REALM_SIZE / 2 - 20;
    const pools = new Map<string, { x: number; z: number; r: number }[]>();
    const poolsNear = (x: number, z: number) => {
      const ci = Math.floor(x / FEATURE_CELL);
      const cj = Math.floor(z / FEATURE_CELL);
      const out: { x: number; z: number; r: number }[] = [];
      for (let i = ci - 1; i <= ci + 1; i++) {
        for (let j = cj - 1; j <= cj + 1; j++) {
          const k = `${i},${j}`;
          let p = pools.get(k);
          if (!p) pools.set(k, (p = cellPools(i, j)));
          out.push(...p);
        }
      }
      return out;
    };

    const specs: Spec[] = [];
    const pickV = (sp: SpeciesName) => Math.floor(r() * VARIANTS[sp]);
    for (let gz = REALM_CENTER.z - half; gz < REALM_CENTER.z + half; gz += SPACING) {
      for (let gx = REALM_CENTER.x - half; gx < REALM_CENTER.x + half; gx += SPACING) {
        const x = gx + (r() - 0.5) * SPACING * 0.9;
        const z = gz + (r() - 0.5) * SPACING * 0.9;
        const wood = sampleNoise(x / 1500 + 0.17, z / 1500 + 0.53, 1);
        const mm = mountainMask(x, z);
        let dens = smoothstep(0.56, 0.68, wood);
        dens = Math.max(dens, smoothstep(0.02, 0.2, mm) * (1 - smoothstep(0.5, 0.75, mm)) * 0.85);
        const roll = r();
        if (roll > Math.max(dens * 0.85, 0.012)) continue;
        if (Math.hypot(x - spawn.x, z - spawn.z) < 70) continue;
        if (tree.w > 0 && Math.hypot(x - tree.x, z - tree.y) < 26) continue;
        if (map.sample(x, z, 1) > 0.01 || map.sample(x, z, 2) > 0.01) continue;
        if (map.sample(x, z, 3) > 1.5) continue; // fields
        let near = false;
        for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) {
          if (map.sample(x + dx, z + dz, 1) > 0.02 || map.sample(x + dx, z + dz, 2) > 0.05) near = true;
        }
        if (near) continue;
        if (realm.sites.some((s) => Math.hypot(x - s.x, z - s.z) < s.r * 1.05 + 8)) continue;
        if (poolsNear(x, z).some((p) => Math.hypot(p.x - x, p.z - z) < p.r * 1.5 + 4)) continue;
        const y = terrainHeight(x, z);
        if (y > 230) continue;

        const conifer = mm > 0.05 || sampleNoise(x / 400 + 0.3, z / 400 + 0.9, 2) > 0.55;
        let sp: SpeciesName;
        if (dens < 0.1) sp = r() < 0.6 ? 'oak' : 'birch';
        else if (conifer) sp = r() < 0.85 ? 'spruce' : 'birch';
        else sp = r() < 0.18 ? 'bush' : r() < 0.68 ? 'oak' : 'birch';
        const s = range(r, 0.8, 1.3) * (dens < 0.1 && sp === 'oak' ? 1.3 : 1);
        specs.push({ x, z, y, s, rot: r() * Math.PI * 2, sp, v: pickV(sp) });
      }
    }
    for (const t of realm.plan.treeSpots) {
      const sp = KIND_TO_SPECIES[t.kind] ?? 'oak';
      specs.push({ x: t.x, z: t.z, y: terrainHeight(t.x, t.z), s: t.s, rot: r() * Math.PI * 2, sp, v: pickV(sp) });
    }
    for (const t of extra) specs.push({ x: t.x, z: t.z, y: t.y, s: t.s, rot: r() * Math.PI * 2, sp: t.sp, v: pickV(t.sp) });
    this.count = specs.length;

    for (const t of specs) {
      const tr = TRUNK[t.sp];
      if (tr > 0 && t.y < terrainHeight(t.x, t.z) + 20) {
        const tk = `${Math.floor(t.x / 8)},${Math.floor(t.z / 8)}`;
        let tl = this.trunks.get(tk);
        if (!tl) this.trunks.set(tk, (tl = []));
        tl.push({ x: t.x, z: t.z, r: tr * t.s });
      }
      const gk = `${Math.floor(t.x / GRID)},${Math.floor(t.z / GRID)}`;
      let gl = this.grid.get(gk);
      if (!gl) this.grid.set(gk, (gl = []));
      gl.push(t);
    }

    // Grow the variants and build one near and one far set per variant.
    const seeds: Record<SpeciesName, number> = { oak: 11, spruce: 23, birch: 37, cherry: 41, bush: 53 };
    for (const sp of Object.keys(VARIANTS) as SpeciesName[]) {
      const variants = makeVariants(sp, VARIANTS[sp], seeds[sp]);
      variants.forEach((variant, v) => {
        const trees = specs.filter((t) => t.sp === sp && t.v === v);
        if (!trees.length) return;
        const nearM = treeMaterials(sp, variant.height, 0, this.lod);
        const farM = treeMaterials(sp, variant.height, 1, this.lod);
        this.mats.push(nearM, farM);
        const mk = (geo: TreeVariant['near']['bark'], mat: TreeMaterials['bark'], n: number) => {
          const im = new InstancedMesh(geo, mat, n);
          im.frustumCulled = false;
          return im;
        };
        const set: TreeSet = {
          sp,
          v,
          trees,
          near: { bark: mk(variant.near.bark, nearM.bark, trees.length), leaves: mk(variant.near.leaves, nearM.leaves, trees.length) },
        };
        castShadow(set.near.bark, nearM.barkShadow);
        castShadow(set.near.leaves, nearM.leavesShadow);
        set.near.bark.count = set.near.leaves.count = 0;
        this.group.add(set.near.bark, set.near.leaves);
        // Far set in big spatial chunks, so the camera frustum can drop what is behind.
        const chunks = new Map<string, Spec[]>();
        for (const t of trees) {
          const k = `${Math.floor(t.x / FAR_CHUNK)},${Math.floor(t.z / FAR_CHUNK)}`;
          let l = chunks.get(k);
          if (!l) chunks.set(k, (l = []));
          l.push(t);
        }
        for (const list of chunks.values()) {
          const fb = new InstancedMesh(variant.far.bark, farM.bark, list.length);
          const fl = new InstancedMesh(variant.far.leaves, farM.leaves, list.length);
          list.forEach((t, i) => {
            this.place(t);
            fb.setMatrixAt(i, this.m);
            fl.setMatrixAt(i, this.m);
          });
          fb.computeBoundingSphere();
          fl.computeBoundingSphere();
          if (fl.boundingSphere) fl.boundingSphere.radius += 12;
          if (fb.boundingSphere) fb.boundingSphere.radius += 6;
          this.group.add(fb, fl);
        }
        this.sets.push(set);
      });
    }
  }

  private place(t: Spec): void {
    this.q.setFromAxisAngle(this.Y, t.rot);
    this.m.compose(this.pv.set(t.x, t.y, t.z), this.q, this.sv.set(t.s, t.s, t.s));
  }

  /** Near-detail radius (by quality tier). */
  setDetail(near: number): void {
    this.lod.near.value = near;
    this.lastX = Infinity;
  }

  setAlphaToCoverage(on: boolean): void {
    for (const m of this.mats) setLeafA2C(m.leaves, on);
  }

  /** False against a trunk. */
  clear(x: number, z: number): boolean {
    const list = this.trunks.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`);
    if (!list) return true;
    return list.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + 0.25);
  }

  /** Trunks near a point (for animals steering around them). */
  blocked(x: number, z: number, pad: number): boolean {
    const list = this.trunks.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`);
    return !!list && list.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + pad);
  }

  update(cx: number, cz: number): void {
    if (Math.hypot(cx - this.lastX, cz - this.lastZ) < 8) return;
    this.lastX = cx;
    this.lastZ = cz;
    const R = this.lod.near.value + this.lod.band.value;
    const counts = new Map<TreeSet, number>();
    const bySp = new Map<string, TreeSet>();
    for (const s of this.sets) bySp.set(`${s.sp}:${s.v}`, s);
    const g0x = Math.floor((cx - R) / GRID);
    const g1x = Math.floor((cx + R) / GRID);
    const g0z = Math.floor((cz - R) / GRID);
    const g1z = Math.floor((cz + R) / GRID);
    for (let gx = g0x; gx <= g1x; gx++) {
      for (let gz = g0z; gz <= g1z; gz++) {
        const list = this.grid.get(`${gx},${gz}`);
        if (!list) continue;
        for (const t of list) {
          if (Math.hypot(t.x - cx, t.z - cz) > R) continue;
          const set = bySp.get(`${t.sp}:${t.v}`);
          if (!set) continue;
          const n = counts.get(set) ?? 0;
          this.place(t);
          set.near.bark.setMatrixAt(n, this.m);
          set.near.leaves.setMatrixAt(n, this.m);
          counts.set(set, n + 1);
        }
      }
    }
    for (const s of this.sets) {
      const n = counts.get(s) ?? 0;
      s.near.bark.count = s.near.leaves.count = n;
      s.near.bark.instanceMatrix.needsUpdate = true;
      s.near.leaves.instanceMatrix.needsUpdate = true;
    }
  }
}
