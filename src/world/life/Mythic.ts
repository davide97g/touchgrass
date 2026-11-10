import { Color, DynamicDrawUsage, Euler, Group, InstancedMesh, Matrix4, Mesh, Quaternion, ShaderMaterial, Vector3 } from 'three';
import type { TimeName } from '../../core/params';
import { U } from '../../core/uniforms';
import { terrainHeight } from '../common';
import type { FeatureMap } from '../Features';
import { Builder, M } from '../realm/geom';
import { hash2, mulberry32 } from '../realm/rand';
import { STRUCT_FRAG, structureMaterial } from '../realm/Structures';
import { creatureMaterial } from './creature';
import type { Subject } from './RareFlora';
import { BIRDS } from './species';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- the cloud whale

const WHALE_VERT = /* glsl */ `
attribute vec2 aMat;
attribute vec3 color;
uniform float uTime;
uniform float uShow;
varying vec3 vN;
varying vec3 vWP;
varying vec3 vCol;
varying vec2 vMat;
void main() {
  vec3 p = position;
  // A slow swimming wave down the body, growing toward the flukes; the long fins row.
  float tail = smoothstep(12.0, -36.0, p.z);
  float w = uTime * 0.55;
  p.y += sin(w + p.z * 0.06) * 1.1 + tail * tail * sin(w - 1.2) * 7.0;
  float fin = max(abs(p.x) - 7.5, 0.0);
  p.y += sin(w + 1.6) * fin * 0.42 - fin * 0.12;
  p *= uShow;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vCol = color;
  vMat = aMat;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

function whaleGeometry() {
  const b = new Builder();
  const r = mulberry32(0x3a1e);
  // Forward is +Z. A row of overlapping ellipsoids: slate back, pale pleated belly.
  const prof: [number, number, number][] = [
    [30, 3.2, 2.8], [25, 5.2, 4.4], [19, 6.6, 5.6], [12, 7.4, 6.4], [4, 7.6, 6.6], [-4, 7.0, 6.0],
    [-12, 5.8, 5.0], [-19, 4.4, 3.9], [-25, 3.1, 2.8], [-30, 2.1, 1.9], [-34, 1.4, 1.2],
  ];
  for (const [z, rx, ry] of prof) {
    b.blob(0, 0, z, rx, ry, 6.2, 0, '#46597a', M.cloth, r(), true);
    b.blob(0, -ry * 0.34, z, rx * 0.86, ry * 0.8, 5.6, 0, '#cfdae2', M.cloth, r(), true);
  }
  // Throat pleats.
  for (let k = -3; k <= 3; k++) b.box(k * 1.2, -5.6, 14, 0.22, 0.5, 22, 0, '#aebcc8', M.cloth, 0.5);
  // Long pectoral fins, swept back.
  for (const s of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const t = k / 5;
      b.blob(s * (7.2 + k * 2.6), -2.2 - t * 0.6, 12 - k * 2.4, 2.4 - t * 1.1, 0.5, 3.6 - t * 1.6, s * 0.5, k % 2 ? '#3e5170' : '#46597a', M.cloth, r(), true);
    }
    // Flukes.
    for (let k = 0; k < 5; k++) {
      const t = k / 4;
      b.blob(s * (1.6 + k * 2.3), 0, -36 - k * 1.5, 2.3 - t * 0.9, 0.4, 3.2 - t * 1.4, s * 0.7, '#3e5170', M.cloth, r(), true);
    }
    // An eye, small and old, with a point of light in it.
    b.blob(s * 4.9, -0.6, 25.4, 0.5, 0.5, 0.5, 0, '#0c1018', M.cloth, 0.1, true);
    b.blob(s * 5.25, -0.5, 25.6, 0.16, 0.16, 0.16, 0, '#bff4ff', M.rune, 0.3, true);
    // Runes burning along the flanks.
    for (let k = 0; k < 14; k++) {
      const z = 22 - k * 3.8;
      const rx = 7.5 * Math.sqrt(Math.max(0.05, 1 - Math.pow((z - 2) / 34, 2)));
      b.blob(s * rx * 0.93, 0.8 + Math.sin(k * 1.3) * 0.7, z, 0.18, 0.55, 0.9, 0, '#8fe8ff', M.rune, k / 14, true);
    }
  }
  // A meadow on its back: turf, a few trees, a standing stone.
  b.blob(0, 5.1, 2, 5.2, 1.9, 13, 0, '#6a9a50', M.turf, 0.5, true);
  for (let k = 0; k < 9; k++) {
    const x = (r() - 0.5) * 6;
    const z = -8 + r() * 20;
    const h = 1.6 + r() * 1.8;
    b.cyl(x, 6.3, z, 0.18, h, '#5a4632', M.wood, 8);
    b.blob(x, 6.3 + h + 0.6, z, 1.3 + r() * 0.8, 1.2 + r() * 0.6, 1.3 + r() * 0.8, r() * 6, r() < 0.3 ? '#f2b8cc' : '#4f8a3c', M.foliage, r());
  }
  b.box(1.5, 6.4, 9, 0.7, 2.6, 0.5, 0.4, '#bdb5a3', M.stone, 0.5);
  b.box(1.5, 7.6, 9, 0.72, 0.16, 0.52, 0.4, '#8fe8ff', M.rune, 0.6);
  // Small dorsal fin.
  b.blob(0, 4.6, -20, 0.5, 1.6, 2.6, 0, '#3e5170', M.cloth, 0.5, true);
  return b.build();
}

// ---------------------------------------------------------------- the sky serpent

const DRAGON_VERT = /* glsl */ `
attribute vec2 aMat;
attribute vec3 color;
uniform float uTime;
uniform vec3 uCenter;   // orbit centre (x, altitude, z)
uniform float uR;
uniform float uAng;     // where the head is on the circle
uniform float uShow;
varying vec3 vN;
varying vec3 vWP;
varying vec3 vCol;
varying vec2 vMat;
void main() {
  vec3 p = position * uShow;
  // The body is modelled straight along -Z and wrapped onto its orbit: local x is outward, z along the path.
  float s = -position.z;
  float k = min(1.0, s / 18.0);
  float ang = uAng + p.z / uR;
  float rad = uR + p.x + sin(s * 0.085 - uTime * 1.5) * 5.0 * k;
  float y = uCenter.y + p.y + sin(s * 0.062 - uTime * 1.15) * 7.0 * k + sin(uTime * 0.31) * 6.0;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec3 wp = vec3(uCenter.x + dir.x * rad, y, uCenter.z + dir.y * rad);
  vWP = wp;
  vN = normalize(vec3(dir.x * normal.x - dir.y * normal.z, normal.y, dir.y * normal.x + dir.x * normal.z));
  vCol = color;
  vMat = aMat;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const DRAGON_LEN = 118;

function dragonGeometry() {
  const b = new Builder();
  const r = mulberry32(0xd4a6);
  // Head at the origin looking down +Z, body trailing along -Z.
  const N = 64;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const z = -4 - t * (DRAGON_LEN - 4);
    const rad = (2.7 - t * 1.9) * (0.75 + 0.25 * Math.sin(Math.min(1, t * 6) * Math.PI * 0.5)) + 0.25;
    b.blob(0, 0, z, rad, rad * 0.95, 1.9, 0, i % 2 ? '#2f9a7e' : '#37aa8a', M.cloth, r(), true);
    b.blob(0, -rad * 0.42, z, rad * 0.74, rad * 0.62, 1.7, 0, '#e8cf7a', M.cloth, r(), true);
    // A crest of fins down the spine, small scutes along the flanks.
    if (i % 2 === 0) b.cone(0, rad * 0.8, z, rad * 0.24, rad * 0.95 + 0.5, '#f0b03a', M.cloth, 6, r());
    if (i % 3 === 0) for (const s of [-1, 1]) b.blob(s * rad * 0.86, rad * 0.2, z, 0.16, 0.5, 0.6, 0, '#bff4ff', M.rune, i / N, true);
  }
  // Tail plume.
  for (let k = 0; k < 7; k++) b.blob((r() - 0.5) * 1.2, (r() - 0.5) * 1.2, -DRAGON_LEN - k * 1.1, 1.1 - k * 0.12, 1.3 - k * 0.14, 2.2, 0, k % 2 ? '#f0b03a' : '#ffd866', M.cloth, r(), true);
  // Four small clawed legs.
  for (const z of [-20, -78]) {
    for (const s of [-1, 1]) {
      b.blob(s * 2.6, -1.6, z, 0.7, 1.5, 0.8, 0, '#2a8a70', M.cloth, 0.5, true);
      b.blob(s * 3.2, -3.2, z + 0.9, 0.5, 1.1, 0.6, 0, '#2a8a70', M.cloth, 0.5, true);
      for (let c = -1; c <= 1; c++) b.cone(s * 3.3 + c * 0.32, -4.6, z + 1.5, 0.14, 0.7, '#f4ecd8', M.plaster, 6, 0.5);
    }
  }
  // The head: long jaw, brow, horns, whiskers and a mane.
  b.blob(0, 0.3, 0.5, 2.5, 2.2, 3.4, 0, '#37aa8a', M.cloth, 0.5, true);
  b.blob(0, -0.1, 4.4, 1.6, 1.25, 2.9, 0, '#3cb694', M.cloth, 0.5, true);
  b.blob(0, -1.15, 3.6, 1.35, 0.6, 2.6, 0, '#e8cf7a', M.cloth, 0.5, true);
  b.blob(0, 0.3, 7.0, 0.95, 0.7, 0.7, 0, '#2f9a7e', M.cloth, 0.5, true);
  for (const s of [-1, 1]) {
    b.blob(s * 1.45, 1.0, 2.6, 0.5, 0.42, 0.6, 0, '#ffe07a', M.lamp, 0.9, true);
    b.blob(s * 1.62, 1.0, 2.9, 0.16, 0.34, 0.2, 0, '#14100c', M.cloth, 0.1, true);
    b.blob(s * 1.3, 1.75, 2.4, 0.75, 0.3, 1.1, s * 0.3, '#2a8a70', M.cloth, 0.5, true);
    // Antler horns, swept back and forked.
    let x = s * 1.1;
    let y = 2.0;
    let z = 0.4;
    for (let k = 0; k < 7; k++) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -1.0 - k * 0.07).premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), s * -0.28));
      b.box(x, y, z, 0.42 - k * 0.045, 1.0, 0.42 - k * 0.045, 0, '#f4ecd8', M.plaster, 0.5, q);
      if (k === 3) b.box(x, y, z, 0.2, 1.4, 0.2, 0, '#f4ecd8', M.plaster, 0.5, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.2));
      const d = new Vector3(0, 0.92, 0).applyQuaternion(q);
      x += d.x;
      y += d.y;
      z += d.z;
    }
    // Whiskers streaming back from the snout.
    let wx = s * 0.9;
    let wy = -0.2;
    let wz = 6.6;
    for (let k = 0; k < 10; k++) {
      b.blob(wx, wy, wz, 0.1, 0.1, 0.75, s * 0.25, '#ffd866', M.cloth, 0.5, true);
      wx += s * (0.55 - k * 0.02);
      wy += Math.sin(k * 0.7) * 0.25 - 0.05;
      wz -= 1.25;
    }
    for (let k = 0; k < 7; k++) b.blob(s * (1.6 + r() * 0.8), 0.6 - k * 0.3, -0.5 - k * 0.9, 0.5, 0.9, 1.5, s * 0.4, k % 2 ? '#f0b03a' : '#ffd866', M.cloth, r(), true);
    for (const tz of [5.2, 6.1]) b.cone(s * 0.85, -1.5, tz, 0.16, 0.6, '#f4ecd8', M.plaster, 6, 0.5);
  }
  // A pearl of light carried under the chin.
  b.blob(0, -2.6, 4.2, 0.8, 0.8, 0.8, 0, '#bff4ff', M.rune, 0.5, true);
  // Built slender; fattened here so it reads from across the realm.
  return b.build().scale(1.7, 1.7, 1);
}

// ---------------------------------------------------------------- small geometries

function batGeometry() {
  const b = new Builder();
  b.blob(0, 0, 0, 0.018, 0.016, 0.03, 0, '#3a2e2a', M.cloth, 0.5, true);
  for (const s of [-1, 1]) {
    b.cone(s * 0.01, 0.012, 0.022, 0.006, 0.016, '#2a201c', M.cloth, 6);
    b.box(s * 0.05, 0, 0, 0.085, 0.002, 0.05, s * 0.2, '#2a2220', M.cloth, 0.5);
    b.box(s * 0.11, 0, -0.008, 0.06, 0.002, 0.034, s * 0.5, '#241c1a', M.cloth, 0.5);
  }
  return b.build();
}

function jellyGeometry() {
  const b = new Builder();
  // A bell with a ruffled rim and trailing threads.
  b.blob(0, 0, 0, 0.36, 0.26, 0.36, 0, '#bfe8ff', M.crystal, 0.3, true);
  b.blob(0, -0.02, 0, 0.26, 0.16, 0.26, 0, '#ffd6f0', M.rune, 0.6, true);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU;
    b.blob(Math.cos(a) * 0.32, -0.12, Math.sin(a) * 0.32, 0.07, 0.06, 0.07, 0, '#d8f4ff', M.crystal, k / 10, true);
    const len = 0.5 + ((k * 7) % 5) * 0.14;
    b.box(Math.cos(a) * 0.22, -0.2 - len, Math.sin(a) * 0.22, 0.012, len, 0.012, 0, k % 2 ? '#bfe8ff' : '#ffd6f0', M.rune, k / 10);
  }
  for (let k = 0; k < 4; k++) b.box(Math.cos(k * 1.6) * 0.06, -1.05, Math.sin(k * 1.6) * 0.06, 0.03, 0.95, 0.03, k, '#e8fbff', M.crystal, 0.5);
  return b.build();
}

function kodamaGeometry() {
  const b = new Builder();
  b.blob(0, 0.14, 0, 0.075, 0.13, 0.065, 0, '#f2f8ee', M.cloth, 0.5, true);
  b.blob(0, 0.36, 0, 0.115, 0.105, 0.1, 0, '#f6fbf2', M.cloth, 0.5, true);
  for (const s of [-1, 1]) {
    b.blob(s * 0.09, 0.14, 0, 0.022, 0.085, 0.022, 0, '#eef4ea', M.cloth, 0.5, true);
    b.blob(s * 0.035, 0.0, 0.01, 0.028, 0.035, 0.035, 0, '#eef4ea', M.cloth, 0.5, true);
    // Lopsided hollow eyes.
    b.blob(s * 0.045, 0.375 + s * 0.012, 0.09, s > 0 ? 0.022 : 0.016, s > 0 ? 0.026 : 0.02, 0.012, 0, '#1a2018', M.cloth, 0.1, true);
    b.blob(s * 0.045, 0.375 + s * 0.012, 0.098, 0.006, 0.007, 0.006, 0, '#9ff0ff', M.rune, 0.6, true);
  }
  b.blob(0.004, 0.32, 0.094, 0.012, 0.02, 0.01, 0, '#1a2018', M.cloth, 0.1, true);
  return b.build();
}

interface Spirit {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** 0 hidden .. 1 fully there. */
  show: number;
  gone: number;
  seed: number;
}

interface Fowl {
  kind: 'swan' | 'duck';
  pool: { x: number; z: number; r: number; level: number };
  a: number;
  d: number;
  speed: number;
  x: number;
  z: number;
  heading: number;
}

export interface MythicSites {
  pillar: { x: number; z: number; top: number };
  /** Where the kodama sit: glades of the hidden places. */
  glades: { x: number; z: number; r: number }[];
  /** Where lantern jellies rise at night. */
  jellies: { x: number; z: number; r: number }[];
  /** Towers the bats tumble around (x, height, z). */
  roosts: { x: number; y: number; z: number }[];
  /** Crags the eagles circle. */
  crags: { x: number; z: number }[];
}

/**
 * The stranger lives of the realm: the cloud whale crossing the sky when the sun is low, the sky
 * serpent that circles the Pillar once its door has opened, kodama in the old glades, lantern
 * jellies over the crystals at night, bats around the towers, eagles over the range, and the
 * swans and ducks of the pools.
 */
export class Mythic {
  readonly group = new Group();
  private readonly whale: Mesh;
  private readonly whaleMat: ShaderMaterial;
  private whaleAng = 2.4;
  private whaleShow = 0;
  readonly whalePos = new Vector3();
  private readonly dragon: Mesh;
  private readonly dragonMat: ShaderMaterial;
  private dragonAng = 0;
  private dragonShow = 0;
  /** Set once the door of the Pillar has been opened. */
  dragonAwake = false;
  readonly dragonPos = new Vector3();
  private readonly kodama: InstancedMesh;
  private readonly spirits: Spirit[] = [];
  private readonly jelly: InstancedMesh;
  private readonly jellies: { x: number; z: number; g: number; h: number; seed: number; p: Vector3 }[] = [];
  private readonly bats: InstancedMesh;
  private readonly batPos: Vector3[] = [];
  private batRoost: { x: number; y: number; z: number } | null = null;
  private readonly eagles: InstancedMesh;
  private readonly eaglePos: Vector3[] = [];
  private readonly swans: InstancedMesh;
  private readonly ducks: InstancedMesh;
  private fowl: Fowl[] = [];
  private poolsKey = '';
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly eu = new Euler();
  private tod: TimeName = 'Noon';
  /** Fired when a kodama vanishes in front of you (for its rattle). */
  onRattle: ((x: number, z: number) => void) | null = null;

  constructor(private readonly features: FeatureMap, private readonly sites: MythicSites) {
    const uniforms = (extra: Record<string, { value: unknown }>) => ({ ...U, uHaze: { value: 0.08 }, uGroundAO: { value: 0 }, uFogK: { value: 0.45 }, ...extra });
    this.whaleMat = new ShaderMaterial({ uniforms: uniforms({ uShow: { value: 0 } }), vertexShader: WHALE_VERT, fragmentShader: STRUCT_FRAG });
    this.whale = new Mesh(whaleGeometry(), this.whaleMat);
    this.whale.frustumCulled = false;
    this.whale.scale.setScalar(1.7);
    this.whale.visible = false;
    this.group.add(this.whale);

    this.dragonMat = new ShaderMaterial({
      uniforms: uniforms({ uShow: { value: 0 }, uCenter: { value: new Vector3(sites.pillar.x, sites.pillar.top + 30, sites.pillar.z) }, uR: { value: 105 }, uAng: { value: 0 } }),
      vertexShader: DRAGON_VERT,
      fragmentShader: STRUCT_FRAG,
    });
    this.dragon = new Mesh(dragonGeometry(), this.dragonMat);
    this.dragon.frustumCulled = false;
    this.dragon.visible = false;
    this.group.add(this.dragon);

    const mat = structureMaterial({ groundAO: false, sway: 0 });
    const feathered = creatureMaterial();
    const inst = (geo: ReturnType<typeof batGeometry>, n: number, m: ShaderMaterial = mat) => {
      const im = new InstancedMesh(geo, m, n);
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      for (let i = 0; i < n; i++) im.setColorAt(i, new Color(1, 1, 1));
      this.group.add(im);
      return im;
    };

    // Kodama: a handful in each old glade, sitting where the grass is short.
    const r = mulberry32(0x60da);
    for (const g of sites.glades) {
      const n = 3 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const a = r() * TAU;
        const d = g.r * (0.4 + r() * 0.4);
        const x = g.x + Math.cos(a) * d;
        const z = g.z + Math.sin(a) * d;
        this.spirits.push({ x, y: terrainHeight(x, z), z, heading: Math.atan2(g.x - x, g.z - z), show: 0, gone: 0, seed: r() });
      }
    }
    this.kodama = inst(kodamaGeometry(), Math.max(1, this.spirits.length));

    for (const j of sites.jellies) {
      for (let k = 0; k < 7; k++) {
        const a = r() * TAU;
        const d = Math.sqrt(r()) * j.r;
        const x = j.x + Math.cos(a) * d;
        const z = j.z + Math.sin(a) * d;
        this.jellies.push({ x, z, g: terrainHeight(x, z), h: 3 + r() * 9, seed: r(), p: new Vector3() });
      }
    }
    this.jelly = inst(jellyGeometry(), Math.max(1, this.jellies.length));

    this.bats = inst(batGeometry(), 18);
    for (let i = 0; i < 18; i++) this.batPos.push(new Vector3());
    this.eagles = inst(BIRDS.eagle(0.7), sites.crags.length, feathered);
    for (let i = 0; i < sites.crags.length; i++) this.eaglePos.push(new Vector3());
    this.swans = inst(BIRDS.swan(1), 8, feathered);
    this.ducks = inst(BIRDS.duck(1), 20, feathered);
  }

  private rebuildPools(cx: number, cz: number): void {
    const pools = this.features.active.pools.filter((p) => Math.hypot(p.x - cx, p.z - cz) < 170);
    const key = pools.map((p) => `${p.x.toFixed(0)},${p.z.toFixed(0)}`).join('|');
    if (key === this.poolsKey) return;
    this.poolsKey = key;
    this.fowl = [];
    let ns = 0;
    let nd = 0;
    for (const p of pools) {
      const h = hash2(p.x, p.z, 21);
      const add = (kind: 'swan' | 'duck', k: number) => {
        const a = hash2(p.x, p.z, 30 + k) * TAU;
        this.fowl.push({ kind, pool: p, a, d: p.r * (0.2 + hash2(p.x, p.z, 40 + k) * 0.3), speed: (kind === 'swan' ? 0.25 : 0.4) * (hash2(p.x, p.z, 50 + k) < 0.5 ? -1 : 1), x: p.x, z: p.z, heading: 0 });
      };
      if (p.r >= 7.5 && h < 0.55 && ns < 8) {
        const n = h < 0.25 ? 2 : 1;
        for (let k = 0; k < n && ns < 8; k++, ns++) add('swan', k);
      }
      if (p.r >= 5 && h > 0.3 && nd < 20) {
        const n = 2 + Math.floor(hash2(p.x, p.z, 22) * 3);
        for (let k = 0; k < n && nd < 20; k++, nd++) add('duck', 4 + k);
      }
    }
  }

  update(dt: number, cam: Vector3, px: number, pz: number, tod: TimeName): void {
    this.tod = tod;
    const t = U.uTime.value;
    const dusk = tod === 'Dusk';
    const thin = dusk || tod === 'Misty dawn';

    // ---- the cloud whale: a slow road across the sky, out when the sun is low ----
    const whaleOut = tod !== 'Noon';
    this.whaleShow += ((whaleOut ? 1 : 0) - this.whaleShow) * Math.min(1, dt * 0.5);
    this.whale.visible = this.whaleShow > 0.01;
    this.whaleAng += (dt * 11) / 1050;
    {
      const a = this.whaleAng;
      const x = -330 + Math.cos(a) * 1150;
      const z = 60 + Math.sin(a) * 880;
      const y = 520 + Math.sin(a * 3) * 45;
      this.whalePos.set(x, y, z);
      const heading = Math.atan2(-Math.sin(a) * 1150, Math.cos(a) * 880);
      this.whale.position.copy(this.whalePos);
      this.whale.rotation.set(Math.cos(a * 3) * -0.06, heading, Math.sin(t * 0.21) * 0.05, 'YXZ');
      this.whaleMat.uniforms.uShow.value = this.whaleShow;
    }

    // ---- the sky serpent ----
    this.dragonShow += ((this.dragonAwake ? 1 : 0) - this.dragonShow) * Math.min(1, dt * 0.35);
    this.dragon.visible = this.dragonShow > 0.01;
    if (this.dragon.visible) {
      this.dragonAng += (dt * 19) / 105;
      const u = this.dragonMat.uniforms;
      u.uAng.value = this.dragonAng;
      u.uShow.value = this.dragonShow;
      const c = u.uCenter.value as Vector3;
      this.dragonPos.set(c.x + Math.cos(this.dragonAng) * 105, c.y + Math.sin(t * 0.31) * 6, c.z + Math.sin(this.dragonAng) * 105);
    }

    // ---- kodama: there in thin light, gone if you come too close ----
    let n = 0;
    for (const k of this.spirits) {
      const d = Math.hypot(k.x - px, k.z - pz);
      if (k.gone > 0) {
        k.gone -= dt;
        if (d < 22) k.gone = Math.max(k.gone, 4);
      } else if (thin && d < 5.5 && k.show > 0.6) {
        k.gone = 18 + k.seed * 20;
        this.onRattle?.(k.x, k.z);
      }
      const want = thin && k.gone <= 0 ? 1 : 0;
      k.show += (want - k.show) * Math.min(1, dt * (want ? 0.8 : 9));
      if (k.show < 0.02) continue;
      // Heads turn to follow you, tilting with a little rattle.
      const look = d < 28 ? Math.atan2(px - k.x, pz - k.z) : k.heading;
      const tilt = Math.sin(t * 0.7 + k.seed * 40) > 0.75 ? Math.sin(t * 22) * 0.25 : Math.sin(t * 0.9 + k.seed * 9) * 0.12;
      this.q.setFromEuler(this.eu.set(0, look, tilt, 'YXZ'));
      this.m.compose(this.v.set(k.x, k.y - 0.02, k.z), this.q, this.s.setScalar(k.show * (1.7 + k.seed * 0.9)));
      this.kodama.setMatrixAt(n++, this.m);
    }
    this.kodama.count = n;
    this.kodama.instanceMatrix.needsUpdate = true;

    // ---- lantern jellies ----
    n = 0;
    if (dusk) {
      for (const j of this.jellies) {
        const ph = t * 0.5 + j.seed * 30;
        const pulse = 0.5 + 0.5 * Math.sin(ph * 2.2);
        j.p.set(j.x + Math.sin(ph * 0.31) * 2.5, j.g + j.h + Math.sin(ph * 0.4) * 1.6 + pulse * 0.25, j.z + Math.cos(ph * 0.27) * 2.5);
        this.q.setFromEuler(this.eu.set(Math.sin(ph * 0.5) * 0.15, ph * 0.2, Math.cos(ph * 0.43) * 0.15, 'YXZ'));
        const sc = 1.5 + j.seed * 1.6;
        this.m.compose(j.p, this.q, this.s.set(sc * (1.08 - pulse * 0.2), sc * (0.86 + pulse * 0.3), sc * (1.08 - pulse * 0.2)));
        this.jelly.setMatrixAt(n++, this.m);
      }
    }
    this.jelly.count = n;
    this.jelly.instanceMatrix.needsUpdate = true;

    // ---- bats around the nearest tower ----
    n = 0;
    this.batRoost = null;
    if (dusk) {
      let bd = 260;
      for (const r of this.sites.roosts) {
        const d = Math.hypot(r.x - px, r.z - pz);
        if (d < bd) {
          bd = d;
          this.batRoost = r;
        }
      }
      if (this.batRoost) {
        const c = this.batRoost;
        for (let i = 0; i < 18; i++) {
          const ph = t * (0.5 + (i % 5) * 0.09) + i * 2.1;
          const rad = 5 + (i % 6) * 2.4 + Math.sin(ph * 1.7) * 3;
          const p = this.batPos[i].set(c.x + Math.cos(ph) * rad + Math.sin(ph * 3.1) * 1.5, c.y - 2 - (i % 4) * 2.5 + Math.sin(ph * 2.3) * 2.2, c.z + Math.sin(ph * 1.13) * rad + Math.cos(ph * 2.7) * 1.5);
          const heading = Math.atan2(-Math.sin(ph) * rad, Math.cos(ph * 1.13) * rad * 1.13);
          this.q.setFromEuler(this.eu.set(Math.sin(ph * 5) * 0.3, heading, Math.sin(t * 34 + i) * 0.7, 'YXZ'));
          this.m.compose(p, this.q, this.s.set(2.2, 2.2 * (0.5 + 0.5 * Math.abs(Math.sin(t * 17 + i))) + 0.6, 2.2));
          this.bats.setMatrixAt(n++, this.m);
        }
      }
    }
    this.bats.count = n;
    this.bats.instanceMatrix.needsUpdate = true;

    // ---- eagles over the crags ----
    n = 0;
    if (tod !== 'Dusk') {
      this.sites.crags.forEach((c, i) => {
        const R = 85 + i * 30;
        const a = t * (0.085 - i * 0.012) * (i % 2 ? -1 : 1) + i * 2;
        const x = c.x + Math.cos(a) * R;
        const z = c.z + Math.sin(a) * R;
        const y = terrainHeight(c.x, c.z) + 75 + i * 20 + Math.sin(t * 0.11 + i) * 14;
        const dir = i % 2 ? -1 : 1;
        this.eaglePos[i].set(x, y, z);
        this.q.setFromEuler(this.eu.set(0.04 * Math.sin(t * 0.6), Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir), -0.3 * dir + 0.05 * Math.sin(t + i), 'YXZ'));
        this.m.compose(this.eaglePos[i], this.q, this.s.setScalar(1.3));
        this.eagles.setMatrixAt(n++, this.m);
      });
    }
    this.eagles.count = n;
    this.eagles.instanceMatrix.needsUpdate = true;

    // ---- swans and ducks ----
    this.rebuildPools(cam.x, cam.z);
    let ns = 0;
    let nd = 0;
    for (const f of this.fowl) {
      // Paddle in slow rings; drift to the far side when someone wades in.
      const d = Math.hypot(f.pool.x - px, f.pool.z - pz);
      if (d < f.pool.r + 5) {
        const away = Math.atan2(f.pool.z - pz, f.pool.x - px);
        let da = (away - f.a) % TAU;
        if (da > Math.PI) da -= TAU;
        if (da < -Math.PI) da += TAU;
        f.a += Math.sign(da) * Math.min(Math.abs(da), dt * 0.9);
      } else f.a += (dt * f.speed) / Math.max(1.5, f.d);
      const x = f.pool.x + Math.cos(f.a) * f.d;
      const z = f.pool.z + Math.sin(f.a) * f.d;
      const mv = Math.atan2(x - f.x, z - f.z);
      if (Math.hypot(x - f.x, z - f.z) > 1e-4) {
        let dh = (mv - f.heading) % TAU;
        if (dh > Math.PI) dh -= TAU;
        if (dh < -Math.PI) dh += TAU;
        f.heading += dh * Math.min(1, dt * 2);
      }
      f.x = x;
      f.z = z;
      const bob = Math.sin(t * 1.4 + f.a * 3) * 0.012;
      this.q.setFromEuler(this.eu.set(Math.sin(t * 1.1 + f.d) * 0.03, f.heading, 0, 'YXZ'));
      if (f.kind === 'swan') {
        this.m.compose(this.v.set(x, f.pool.level - 0.05 + bob, z), this.q, this.s.setScalar(1.5));
        this.swans.setMatrixAt(ns++, this.m);
      } else {
        this.m.compose(this.v.set(x, f.pool.level - 0.03 + bob, z), this.q, this.s.setScalar(1.25));
        this.ducks.setMatrixAt(nd++, this.m);
      }
    }
    this.swans.count = ns;
    this.ducks.count = nd;
    this.swans.instanceMatrix.needsUpdate = true;
    this.ducks.instanceMatrix.needsUpdate = true;
  }

  /** The nearest duck (for its quack). */
  nearestFowl(x: number, z: number): { kind: 'swan' | 'duck'; x: number; z: number; d: number } | null {
    let best: { kind: 'swan' | 'duck'; x: number; z: number; d: number } | null = null;
    for (const f of this.fowl) {
      const d = Math.hypot(f.x - x, f.z - z);
      if (!best || d < best.d) best = { kind: f.kind, x: f.x, z: f.z, d };
    }
    return best;
  }

  get whaleOut(): boolean {
    return this.whaleShow > 0.5;
  }

  subjects(out: Subject[]): void {
    if (this.whaleShow > 0.6) out.push({ id: 'whale', x: this.whalePos.x, y: this.whalePos.y, z: this.whalePos.z, r: 44 });
    if (this.dragonShow > 0.6) out.push({ id: 'dragon', x: this.dragonPos.x, y: this.dragonPos.y, z: this.dragonPos.z, r: 12 });
    for (const k of this.spirits) if (k.show > 0.6) out.push({ id: 'kodama', x: k.x, y: k.y + 0.3 * (1.7 + k.seed * 0.9), z: k.z, r: 0.4 });
    for (let i = 0; i < this.jelly.count; i++) out.push({ id: 'jelly', x: this.jellies[i].p.x, y: this.jellies[i].p.y - 0.3, z: this.jellies[i].p.z, r: 0.7 });
    for (let i = 0; i < this.bats.count; i++) out.push({ id: 'bat', x: this.batPos[i].x, y: this.batPos[i].y, z: this.batPos[i].z, r: 0.25 });
    for (let i = 0; i < this.eagles.count; i++) out.push({ id: 'eagle', x: this.eaglePos[i].x, y: this.eaglePos[i].y, z: this.eaglePos[i].z, r: 1.6 });
    for (const f of this.fowl) out.push({ id: f.kind, x: f.x, y: f.pool.level + (f.kind === 'swan' ? 0.45 : 0.14), z: f.z, r: f.kind === 'swan' ? 0.6 : 0.2 });
    void this.tod;
  }
}
