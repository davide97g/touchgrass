import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { castShadow, shadowMaterial } from '../../core/Shadows';
import { U } from '../../core/uniforms';
import { mountainMask, terrainHeight } from '../common';
import type { FeatureMap } from '../Features';
import type { Forest } from './Forest';
import { Builder, M } from './geom';
import { mulberry32, range, type Rng } from './rand';
import { STRUCT_FRAG } from './Structures';
import type { Realm } from './World';

const VERT = /* glsl */ `
attribute vec2 aMat;
attribute vec3 color;
attribute float aPart;   // 0 body, 1-4 legs (FL FR BL BR), 5 head and neck, 6 tail
attribute vec3 aPivot;
attribute vec4 aAnim;    // stride phase, gait (0 still .. 2 gallop), graze (head down), seed
uniform float uTime;
varying vec3 vN;
varying vec3 vWP;
varying vec3 vCol;
varying vec2 vMat;

vec3 rotX(vec3 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}

void main() {
  vec3 p = position;
  vec3 n = normal;
  float ph = aAnim.x;
  float gait = aAnim.y;
  float graze = aAnim.z;
  if (aPart > 0.5 && aPart < 4.5) {
    // Trot: diagonal pairs swing together; a gallop reaches further.
    float off = (aPart == 1.0 || aPart == 4.0) ? 0.0 : 3.14159;
    float a = sin(ph + off) * min(gait, 1.0) * 0.55 + sin(ph * 1.0 + off) * max(gait - 1.0, 0.0) * 0.35;
    p = aPivot + rotX(p - aPivot, a);
    n = rotX(n, a);
  } else if (aPart > 4.5 && aPart < 5.5) {
    float nod = graze * 1.05 + sin(uTime * 1.3 + aAnim.w * 9.0) * 0.06 * (1.0 - graze) + sin(ph * 2.0) * 0.04 * gait;
    nod += graze * sin(uTime * 4.0 + aAnim.w * 20.0) * 0.08; // nibbling
    p = aPivot + rotX(p - aPivot, nod);
    n = rotX(n, nod);
  } else if (aPart > 5.5) {
    float wag = sin(uTime * 3.0 + aAnim.w * 12.0) * 0.4;
    vec3 q = p - aPivot;
    p = aPivot + vec3(q.x * cos(wag) - q.z * sin(wag) * 0.3, q.y, q.z) + vec3(sin(wag) * q.y * -0.4, 0.0, 0.0);
  }
  p.y += abs(sin(ph)) * 0.04 * gait;

  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  vCol = color;
#ifdef USE_INSTANCING_COLOR
  vCol *= instanceColor;
#endif
  vMat = aMat;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

type PartFn = (b: Builder) => void;

function assemble(parts: { id: number; pivot: [number, number, number]; fn: PartFn }[]): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const mat: number[] = [];
  const part: number[] = [];
  const piv: number[] = [];
  for (const p of parts) {
    const b = new Builder();
    p.fn(b);
    const g = b.build();
    const n = g.getAttribute('position').count;
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nrm.push(...(g.getAttribute('normal').array as Float32Array));
    col.push(...(g.getAttribute('color').array as Float32Array));
    mat.push(...(g.getAttribute('aMat').array as Float32Array));
    for (let i = 0; i < n; i++) {
      part.push(p.id);
      piv.push(...p.pivot);
    }
    g.dispose();
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('aMat', new BufferAttribute(new Float32Array(mat), 2));
  g.setAttribute('aPart', new BufferAttribute(new Float32Array(part), 1));
  g.setAttribute('aPivot', new BufferAttribute(new Float32Array(piv), 3));
  return g;
}

function legs(hx: number, hz: number, top: number, w: number, color: string, hoof: string): { id: number; pivot: [number, number, number]; fn: PartFn }[] {
  const out: { id: number; pivot: [number, number, number]; fn: PartFn }[] = [];
  const spots: [number, number][] = [[-hx, hz], [hx, hz], [-hx, -hz], [hx, -hz]];
  spots.forEach(([x, z], i) => {
    out.push({
      id: i + 1,
      pivot: [x, top, z],
      fn: (b) => {
        b.box(x, 0.12, z, w, top - 0.1, w, 0, color, M.cloth, 0.5);
        b.box(x, 0, z, w * 1.1, 0.14, w * 1.15, 0, hoof, M.wood, 0.5);
      },
    });
  });
  return out;
}

// Forward is +Z. White-ish albedo where the instance colour should tint the coat.
const SPECIES = {
  sheep: () =>
    assemble([
      {
        id: 0,
        pivot: [0, 0, 0],
        fn: (b) => {
          b.blob(0, 0.78, 0, 0.5, 0.42, 0.7, 0, '#ffffff', M.cloth, 0.2);
          b.blob(0.15, 0.9, 0.25, 0.32, 0.3, 0.35, 1, '#ffffff', M.cloth, 0.4);
          b.blob(-0.15, 0.88, -0.3, 0.33, 0.3, 0.35, 2, '#ffffff', M.cloth, 0.6);
        },
      },
      {
        id: 5,
        pivot: [0, 0.85, 0.55],
        fn: (b) => {
          b.box(0, 0.78, 0.82, 0.24, 0.3, 0.36, 0, '#2e2a28', M.cloth, 0.1);
          b.blob(0, 1.0, 0.68, 0.26, 0.2, 0.22, 0, '#ffffff', M.cloth, 0.3);
          b.box(0, 0.98, 0.75, 0.5, 0.07, 0.1, 0, '#2e2a28', M.cloth, 0.1);
        },
      },
      ...legs(0.2, 0.38, 0.55, 0.09, '#2e2a28', '#1a1816'),
      { id: 6, pivot: [0, 0.85, -0.7], fn: (b) => b.blob(0, 0.78, -0.72, 0.12, 0.16, 0.1, 0, '#ffffff', M.cloth, 0.5) },
    ]),
  horse: () =>
    assemble([
      {
        id: 0,
        pivot: [0, 0, 0],
        fn: (b) => {
          b.blob(0, 1.38, 0, 0.42, 0.45, 1.0, 0, '#ffffff', M.cloth, 0.5, true);
          b.blob(0, 1.42, 0.55, 0.42, 0.48, 0.5, 0, '#ffffff', M.cloth, 0.5, true);
        },
      },
      {
        id: 5,
        pivot: [0, 1.6, 0.8],
        fn: (b) => {
          const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.55);
          b.box(0, 1.45, 0.95, 0.3, 0.95, 0.46, 0, '#ffffff', M.cloth, 0.5, q);
          b.box(0, 2.0, 1.25, 0.26, 0.28, 0.66, 0, '#ffffff', M.cloth, 0.5);
          b.box(0, 1.98, 1.58, 0.22, 0.22, 0.12, 0, '#3a302a', M.cloth, 0.1);
          b.box(0, 1.75, 1.0, 0.08, 0.95, 0.28, 0, '#2a2420', M.cloth, 0.2, q);
          b.box(0.09, 2.2, 1.05, 0.06, 0.18, 0.06, 0, '#ffffff', M.cloth, 0.5);
          b.box(-0.09, 2.2, 1.05, 0.06, 0.18, 0.06, 0, '#ffffff', M.cloth, 0.5);
        },
      },
      ...legs(0.24, 0.7, 1.15, 0.13, '#ffffff', '#2a2420'),
      { id: 6, pivot: [0, 1.5, -0.95], fn: (b) => b.box(0, 0.75, -1.02, 0.12, 0.8, 0.12, 0, '#2a2420', M.cloth, 0.3) },
    ]),
  deer: () =>
    assemble([
      {
        id: 0,
        pivot: [0, 0, 0],
        fn: (b) => {
          b.blob(0, 1.05, 0, 0.3, 0.33, 0.68, 0, '#ffffff', M.cloth, 0.5, true);
          b.blob(0, 0.95, -0.55, 0.18, 0.15, 0.08, 0, '#f4f0e8', M.cloth, 0.9);
        },
      },
      {
        id: 5,
        pivot: [0, 1.2, 0.55],
        fn: (b) => {
          const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.4);
          b.box(0, 1.1, 0.62, 0.18, 0.7, 0.24, 0, '#ffffff', M.cloth, 0.5, q);
          b.box(0, 1.72, 0.86, 0.18, 0.2, 0.42, 0, '#ffffff', M.cloth, 0.5);
          b.box(0, 1.69, 1.08, 0.12, 0.13, 0.08, 0, '#2a2420', M.cloth, 0.1);
          for (const s of [-1, 1]) {
            b.box(s * 0.16, 1.88, 0.75, 0.2, 0.08, 0.05, s * 0.3, '#ffffff', M.cloth, 0.5);
            // Antlers.
            const qa = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), s * -0.45);
            b.box(s * 0.1, 1.85, 0.78, 0.04, 0.6, 0.04, 0, '#d8c8a8', M.wood, 0.7, qa);
            b.box(s * 0.26, 2.2, 0.82, 0.03, 0.3, 0.03, 0, '#d8c8a8', M.wood, 0.7, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5));
          }
        },
      },
      ...legs(0.16, 0.48, 0.85, 0.07, '#ffffff', '#2a2420'),
      { id: 6, pivot: [0, 1.1, -0.65], fn: (b) => b.box(0, 1.0, -0.7, 0.1, 0.16, 0.06, 0, '#f4f0e8', M.cloth, 0.8) },
    ]),
  boar: () =>
    assemble([
      {
        id: 0,
        pivot: [0, 0, 0],
        fn: (b) => {
          b.blob(0, 0.62, 0, 0.36, 0.38, 0.62, 0, '#ffffff', M.cloth, 0.5);
          b.blob(0, 0.78, 0.25, 0.3, 0.32, 0.36, 0, '#ffffff', M.cloth, 0.3);
          b.box(0, 0.9, -0.1, 0.1, 0.12, 0.9, 0, '#2a2018', M.cloth, 0.1);
        },
      },
      {
        id: 5,
        pivot: [0, 0.75, 0.5],
        fn: (b) => {
          b.box(0, 0.45, 0.6, 0.36, 0.38, 0.42, 0, '#ffffff', M.cloth, 0.5);
          b.box(0, 0.42, 0.88, 0.2, 0.18, 0.2, 0, '#c89a8a', M.cloth, 0.5);
          for (const s of [-1, 1]) {
            b.box(s * 0.13, 0.48, 0.9, 0.04, 0.16, 0.04, 0, '#f4ecd8', M.plaster, 0.5, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.6));
            b.box(s * 0.14, 0.72, 0.58, 0.1, 0.14, 0.05, 0, '#ffffff', M.cloth, 0.5);
          }
        },
      },
      ...legs(0.18, 0.36, 0.42, 0.09, '#ffffff', '#1a1612'),
      { id: 6, pivot: [0, 0.75, -0.6], fn: (b) => b.box(0, 0.6, -0.64, 0.04, 0.24, 0.04, 0, '#2a2018', M.cloth, 0.5) },
    ]),
  chicken: () =>
    assemble([
      {
        id: 0,
        pivot: [0, 0, 0],
        fn: (b) => {
          b.blob(0, 0.32, -0.02, 0.17, 0.16, 0.22, 0, '#ffffff', M.cloth, 0.5, true);
          b.box(0, 0.36, -0.22, 0.12, 0.2, 0.08, 0, '#ffffff', M.cloth, 0.6, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.6));
        },
      },
      {
        id: 5,
        pivot: [0, 0.4, 0.12],
        fn: (b) => {
          b.blob(0, 0.5, 0.17, 0.08, 0.09, 0.08, 0, '#ffffff', M.cloth, 0.5, true);
          b.box(0, 0.56, 0.17, 0.025, 0.07, 0.09, 0, '#d0302a', M.cloth, 0.2);
          b.box(0, 0.48, 0.26, 0.03, 0.03, 0.06, 0, '#e8a030', M.cloth, 0.2);
        },
      },
      { id: 1, pivot: [-0.06, 0.2, 0], fn: (b) => b.box(-0.06, 0, 0, 0.025, 0.2, 0.025, 0, '#e8a030', M.cloth, 0.5) },
      { id: 2, pivot: [0.06, 0.2, 0], fn: (b) => b.box(0.06, 0, 0, 0.025, 0.2, 0.025, 0, '#e8a030', M.cloth, 0.5) },
    ]),
  cat: () =>
    assemble([
      {
        id: 0,
        pivot: [0, 0, 0],
        fn: (b) => b.blob(0, 0.26, 0, 0.11, 0.11, 0.24, 0, '#ffffff', M.cloth, 0.5, true),
      },
      {
        id: 5,
        pivot: [0, 0.3, 0.2],
        fn: (b) => {
          b.blob(0, 0.36, 0.27, 0.09, 0.08, 0.08, 0, '#ffffff', M.cloth, 0.5, true);
          for (const sx of [-1, 1]) b.cone(sx * 0.05, 0.41, 0.27, 0.03, 0.07, '#ffffff', M.cloth, 6);
        },
      },
      ...legs(0.06, 0.15, 0.2, 0.035, '#ffffff', '#ffffff'),
      {
        id: 6,
        pivot: [0, 0.3, -0.22],
        fn: (b) => b.box(0, 0.28, -0.26, 0.03, 0.32, 0.03, 0, '#ffffff', M.cloth, 0.5, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.5)),
      },
    ]),
};

type SpeciesName = keyof typeof SPECIES;

const TRAITS: Record<SpeciesName, { walk: number; run: number; flee: number; stride: number; turn: number }> = {
  sheep: { walk: 0.55, run: 2.6, flee: 5, stride: 0.9, turn: 2 },
  horse: { walk: 1.1, run: 5.5, flee: 7, stride: 1.9, turn: 1.4 },
  deer: { walk: 0.9, run: 7.5, flee: 22, stride: 1.5, turn: 3 },
  boar: { walk: 0.6, run: 4.5, flee: 9, stride: 0.8, turn: 2.5 },
  chicken: { walk: 0.35, run: 2.2, flee: 2.5, stride: 0.18, turn: 5 },
  cat: { walk: 0.5, run: 3.5, flee: 3, stride: 0.35, turn: 4 },
};

interface Animal {
  sp: SpeciesName;
  i: number;
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  state: 'graze' | 'walk' | 'flee' | 'look';
  t: number;
  tx: number;
  tz: number;
  home: { x: number; z: number; r: number };
  phase: number;
  gait: number;
  graze: number;
  seed: number;
  scale: number;
}

const COATS: Record<SpeciesName, string[]> = {
  sheep: ['#f2eee4', '#ece6da', '#f6f2ea', '#d8d2c6', '#5a5048'],
  horse: ['#7a4a2a', '#5a3820', '#3a2a22', '#a8784a', '#e8e0d4', '#2a2422'],
  deer: ['#a0704a', '#94643e', '#ae7a52'],
  boar: ['#5a4434', '#4a382c', '#6a5040'],
  chicken: ['#f4f0e6', '#c87a3a', '#8a4a2a', '#f4f0e6', '#2a2a2a'],
  cat: ['#e8a050', '#3a3a3a', '#f0ece4', '#8a8478', '#c87a3a'],
};

/**
 * Herds that live in the realm: sheep in the pastures and on the open hills, horses by
 * Hearthbrook, deer along the forest edges, boars rooting near the crystals. They graze,
 * wander, look up when you come close and bolt if you rush them.
 */
export class Fauna {
  readonly group = new Group();
  private readonly animals: Animal[] = [];
  private readonly meshes = new Map<SpeciesName, { mesh: InstancedMesh; anim: InstancedBufferAttribute }>();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 1, 0);

  constructor(private readonly realm: Realm, private readonly features: FeatureMap, private readonly forest: Forest) {
    const r = mulberry32(0xa11a);
    const herds: { sp: SpeciesName; x: number; z: number; r: number; n: number }[] = [];
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
    );

    const counts: Record<SpeciesName, number> = { sheep: 0, horse: 0, deer: 0, boar: 0, chicken: 0, cat: 0 };
    for (const h of herds) {
      for (let k = 0; k < h.n; k++) {
        let x = h.x;
        let z = h.z;
        for (let t = 0; t < 30; t++) {
          const a = r() * Math.PI * 2;
          const d = Math.sqrt(r()) * h.r * 0.8;
          x = h.x + Math.cos(a) * d;
          z = h.z + Math.sin(a) * d;
          if (this.walkable(x, z, h.sp)) break;
        }
        this.animals.push({
          sp: h.sp,
          i: counts[h.sp]++,
          x,
          z,
          y: terrainHeight(x, z),
          heading: r() * Math.PI * 2,
          speed: 0,
          state: 'graze',
          t: range(r, 1, 12),
          tx: x,
          tz: z,
          home: { x: h.x, z: h.z, r: h.r },
          phase: r() * 10,
          gait: 0,
          graze: 1,
          seed: r(),
          scale: range(r, 0.88, 1.12) * (h.sp === 'deer' && r() < 0.6 ? 0.85 : 1),
        });
      }
    }

    const mat = new ShaderMaterial({
      uniforms: { ...U, uHaze: { value: 0 }, uGroundAO: { value: 1 }, uFogK: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: STRUCT_FRAG,
    });
    const coat = new Color();
    for (const sp of Object.keys(SPECIES) as SpeciesName[]) {
      const n = counts[sp];
      if (!n) continue;
      const geo = SPECIES[sp]();
      const anim = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
      anim.setUsage(DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      const mesh = new InstancedMesh(geo, mat, n);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      castShadow(mesh, shadowMaterial(mat));
      const rc = mulberry32(sp.length * 977);
      for (let i = 0; i < n; i++) {
        coat.set(COATS[sp][Math.floor(rc() * COATS[sp].length)]);
        if (sp === 'sheep' && rc() < 0.85) coat.set(COATS.sheep[Math.floor(rc() * 3)]);
        mesh.setColorAt(i, coat);
      }
      this.meshes.set(sp, { mesh, anim });
      this.group.add(mesh);
    }
    this.update(0, 0, 0, 0);
  }

  private walkable(x: number, z: number, sp: SpeciesName = 'sheep'): boolean {
    const map = this.realm.map;
    const tame = sp === 'chicken' || sp === 'cat';
    return (
      this.features.waterDepth(x, z) < 0.05 &&
      map.solidAt(x, z) < 0.2 &&
      (tame || map.roadAt(x, z) < 0.6) &&
      mountainMask(x, z) < 0.35 &&
      !this.forest.blocked(x, z, 0.6)
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

  update(dt: number, px: number, pz: number, playerSpeed: number): void {
    const r = Math.random;
    for (const a of this.animals) {
      const tr = TRAITS[a.sp];
      const dp = Math.hypot(a.x - px, a.z - pz);
      if (dp > 700 && dt > 0) continue; // nobody is watching
      a.t -= dt;
      const spook = dp < tr.flee * (playerSpeed > 2 ? 2.2 : 1);
      if (spook && a.state !== 'flee') {
        a.state = 'flee';
        a.t = range(r, 2.5, 4.5);
        const away = Math.atan2(a.x - px, a.z - pz) + (r() - 0.5) * 0.8;
        a.tx = a.x + Math.sin(away) * 30;
        a.tz = a.z + Math.cos(away) * 30;
      } else if (!spook && dp < tr.flee * 2.4 && a.state === 'graze' && r() < dt * 0.6) {
        a.state = 'look';
        a.t = range(r, 1.5, 3.5);
      }

      let targetSpeed = 0;
      let targetGraze = 0;
      if (a.state === 'graze') {
        targetGraze = 1;
        if (a.t <= 0) {
          a.state = 'walk';
          this.pickTarget(a, r);
          a.t = 30;
        }
      } else if (a.state === 'look') {
        // Head up, turn toward the visitor.
        const want = Math.atan2(px - a.x, pz - a.z);
        a.heading = turnTo(a.heading, want, dt * tr.turn * 0.5);
        if (a.t <= 0) {
          a.state = 'graze';
          a.t = range(r, 4, 14);
        }
      } else if (a.state === 'walk') {
        targetSpeed = tr.walk;
        if (Math.hypot(a.tx - a.x, a.tz - a.z) < 1.5 || a.t <= 0) {
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
          if (a.state === 'walk') this.pickTarget(a, r);
        }
      }
      a.gait = a.speed / tr.walk > 1.5 ? 1 + Math.min(1, a.speed / tr.run) : a.speed / tr.walk;
      a.phase += (a.speed / tr.stride) * Math.PI * dt;
      a.y += (terrainHeight(a.x, a.z) - a.y) * Math.min(1, dt * 10 + (dt === 0 ? 1 : 0));
    }

    for (const [sp, { mesh, anim }] of this.meshes) {
      for (const a of this.animals) {
        if (a.sp !== sp) continue;
        this.q.setFromAxisAngle(this.up, a.heading);
        this.m.compose(this.v.set(a.x, a.y, a.z), this.q, this.s.setScalar(a.scale));
        mesh.setMatrixAt(a.i, this.m);
        anim.setXYZW(a.i, a.phase, a.gait, a.graze, a.seed);
      }
      mesh.instanceMatrix.needsUpdate = true;
      anim.needsUpdate = true;
    }
  }
}

function turnTo(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + Math.max(-k, Math.min(k, d));
}
