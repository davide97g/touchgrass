import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
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
import { hash2, mulberry32, range, type Rng } from './rand';
import { watchtower } from './sites';
import { cellPools } from '../Features';
import type { TimeName } from '../../core/params';
import type { Subject } from '../life/RareFlora';
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
#ifdef HOP
  // Hares bound: the whole body arcs up and stretches out on each leap.
  float hop = max(0.0, sin(ph * 0.5));
  p.y += hop * 0.22 * min(gait, 1.6);
  p.z *= 1.0 + hop * 0.12 * min(gait, 1.5);
#else
  p.y += abs(sin(ph)) * 0.04 * gait;
#endif

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

const SPIKE = new ConeGeometry(1, 1, 5, 1).translate(0, 0.5, 0);

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
  fox: () =>
    assemble([
      {
        id: 0,
        pivot: [0, 0, 0],
        fn: (b) => {
          b.blob(0, 0.4, 0, 0.12, 0.13, 0.3, 0, '#c4602a', M.cloth, 0.5, true);
          b.blob(0, 0.36, 0.16, 0.1, 0.1, 0.12, 0, '#efe6da', M.cloth, 0.5, true);
        },
      },
      {
        id: 5,
        pivot: [0, 0.46, 0.24],
        fn: (b) => {
          b.blob(0, 0.5, 0.34, 0.085, 0.08, 0.09, 0, '#c8642c', M.cloth, 0.5, true);
          b.blob(0, 0.47, 0.44, 0.035, 0.035, 0.08, 0, '#f0e8dc', M.cloth, 0.5, true);
          b.blob(0, 0.475, 0.52, 0.016, 0.014, 0.014, 0, '#1a1210', M.cloth, 0.1, true);
          for (const sx of [-1, 1]) {
            b.cone(sx * 0.05, 0.55, 0.32, 0.034, 0.1, '#b85a28', M.cloth, 6);
            b.cone(sx * 0.05, 0.62, 0.32, 0.016, 0.04, '#1e1612', M.cloth, 6);
            b.blob(sx * 0.04, 0.52, 0.42, 0.011, 0.011, 0.008, 0, '#2a1a10', M.cloth, 0.1, true);
          }
        },
      },
      ...legs(0.06, 0.2, 0.3, 0.035, '#3a2218', '#1a1210'),
      {
        id: 6,
        pivot: [0, 0.42, -0.28],
        fn: (b) => {
          b.blob(0, 0.36, -0.46, 0.07, 0.07, 0.2, 0, '#c4602a', M.cloth, 0.5, true);
          b.blob(0, 0.33, -0.64, 0.045, 0.045, 0.06, 0, '#f4ece0', M.cloth, 0.5, true);
        },
      },
    ]),
  hare: () =>
    assemble([
      {
        id: 0,
        pivot: [0, 0, 0],
        fn: (b) => {
          b.blob(0, 0.25, 0.02, 0.1, 0.11, 0.17, 0, '#8a6a46', M.cloth, 0.5, true);
          b.blob(0, 0.22, -0.1, 0.115, 0.12, 0.12, 0, '#8e6c48', M.cloth, 0.5, true);
          b.blob(0, 0.2, 0.08, 0.07, 0.07, 0.08, 0, '#e8dccb', M.cloth, 0.5, true);
        },
      },
      {
        id: 5,
        pivot: [0, 0.3, 0.14],
        fn: (b) => {
          b.blob(0, 0.33, 0.22, 0.055, 0.06, 0.075, 0, '#8a6a46', M.cloth, 0.5, true);
          for (const sx of [-1, 1]) {
            const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.35).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), sx * 0.15));
            b.box(sx * 0.025, 0.36, 0.2, 0.034, 0.17, 0.012, 0, '#9a7a52', M.cloth, 0.5, q);
            b.box(sx * 0.025 + sx * 0.02, 0.52, 0.15, 0.034, 0.03, 0.013, 0, '#1a1410', M.cloth, 0.1, q);
            b.blob(sx * 0.035, 0.35, 0.25, 0.012, 0.014, 0.012, 0, '#2a1a0a', M.cloth, 0.1, true);
          }
        },
      },
      { id: 1, pivot: [-0.04, 0.16, 0.1], fn: (b) => b.box(-0.04, 0, 0.11, 0.025, 0.17, 0.03, 0, '#7a5a3a', M.cloth, 0.5) },
      { id: 2, pivot: [0.04, 0.16, 0.1], fn: (b) => b.box(0.04, 0, 0.11, 0.025, 0.17, 0.03, 0, '#7a5a3a', M.cloth, 0.5) },
      { id: 3, pivot: [-0.07, 0.2, -0.1], fn: (b) => b.box(-0.07, 0, -0.06, 0.035, 0.05, 0.16, 0, '#7a5a3a', M.cloth, 0.5) },
      { id: 4, pivot: [0.07, 0.2, -0.1], fn: (b) => b.box(0.07, 0, -0.06, 0.035, 0.05, 0.16, 0, '#7a5a3a', M.cloth, 0.5) },
      { id: 6, pivot: [0, 0.25, -0.2], fn: (b) => b.blob(0, 0.27, -0.22, 0.04, 0.04, 0.03, 0, '#f6f2ea', M.cloth, 0.5, true) },
    ]),
  hedgehog: () =>
    assemble([
      {
        id: 0,
        pivot: [0, 0, 0],
        fn: (b) => {
          b.blob(0, 0.08, 0, 0.1, 0.075, 0.13, 0, '#5a4636', M.cloth, 0.5, true);
          const r = mulberry32(0x4e6);
          for (let i = 0; i < 46; i++) {
            const a = r() * Math.PI * 2;
            const t = Math.acos(1 - r() * 0.95);
            const nx = Math.sin(t) * Math.cos(a);
            const ny = Math.cos(t);
            const nz = Math.sin(t) * Math.sin(a);
            if (nz > 0.75) continue;
            const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(nx * 0.8, ny, nz * 0.7 - 0.25).normalize());
            const g = new Matrix4().compose(new Vector3(nx * 0.09, 0.08 + ny * 0.065, nz * 0.12), q, new Vector3(0.014, 0.07, 0.014));
            b.geometry(SPIKE, g, r() < 0.5 ? '#3a2e24' : '#c8b8a0', M.cloth, 0.3);
          }
        },
      },
      {
        id: 5,
        pivot: [0, 0.07, 0.1],
        fn: (b) => {
          b.blob(0, 0.06, 0.14, 0.05, 0.045, 0.06, 0, '#b09a80', M.cloth, 0.5, true);
          b.blob(0, 0.05, 0.2, 0.02, 0.018, 0.04, 0, '#a08870', M.cloth, 0.5, true);
          b.blob(0, 0.05, 0.24, 0.011, 0.01, 0.01, 0, '#14100c', M.cloth, 0.1, true);
          for (const sx of [-1, 1]) b.blob(sx * 0.025, 0.075, 0.17, 0.008, 0.008, 0.006, 0, '#0a0806', M.cloth, 0.1, true);
        },
      },
      ...legs(0.05, 0.07, 0.04, 0.018, '#6a5440', '#3a2a1e'),
    ]),
  ibex: () =>
    assemble([
      {
        id: 0,
        pivot: [0, 0, 0],
        fn: (b) => {
          b.blob(0, 0.78, 0, 0.21, 0.24, 0.44, 0, '#8a7a62', M.cloth, 0.5, true);
          b.blob(0, 0.68, 0.05, 0.16, 0.12, 0.3, 0, '#c8bca4', M.cloth, 0.5, true);
          b.box(0, 0.95, -0.1, 0.06, 0.08, 0.6, 0, '#4a3e30', M.cloth, 0.2);
        },
      },
      {
        id: 5,
        pivot: [0, 0.9, 0.36],
        fn: (b) => {
          const qn = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.45);
          b.box(0, 0.85, 0.42, 0.14, 0.42, 0.16, 0, '#7e6e58', M.cloth, 0.5, qn);
          b.box(0, 1.12, 0.56, 0.13, 0.15, 0.26, 0, '#8a7a62', M.cloth, 0.5);
          b.box(0, 1.03, 0.66, 0.05, 0.12, 0.05, 0, '#3a3024', M.cloth, 0.3);
          for (const sx of [-1, 1]) {
            // Great ridged horns sweeping back in an arc.
            let y = 1.2;
            let z = 0.56;
            for (let k = 0; k < 8; k++) {
              const a = 0.25 + k * 0.28;
              const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -a);
              b.box(sx * (0.045 + k * 0.006), y, z, 0.05 - k * 0.003, 0.11, 0.06 - k * 0.003, 0, k % 2 ? '#5a4e40' : '#6a5c4a', M.wood, 0.5, q);
              y += Math.cos(a) * 0.09;
              z -= Math.sin(a) * 0.09;
            }
            b.box(sx * 0.08, 1.16, 0.5, 0.08, 0.04, 0.03, sx * 0.4, '#7e6e58', M.cloth, 0.5);
          }
        },
      },
      ...legs(0.13, 0.3, 0.6, 0.065, '#6a5a48', '#2a2420'),
      { id: 6, pivot: [0, 0.9, -0.42], fn: (b) => b.box(0, 0.82, -0.46, 0.06, 0.12, 0.05, 0, '#4a3e30', M.cloth, 0.5) },
    ]),
  hart: () =>
    assemble([
      {
        id: 0,
        pivot: [0, 0, 0],
        fn: (b) => {
          b.blob(0, 1.15, 0, 0.33, 0.36, 0.76, 0, '#f4f2ee', M.cloth, 0.5, true);
          b.blob(0, 1.25, 0.5, 0.3, 0.34, 0.32, 0, '#f8f6f2', M.cloth, 0.5, true);
        },
      },
      {
        id: 5,
        pivot: [0, 1.3, 0.6],
        fn: (b) => {
          const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.4);
          b.box(0, 1.2, 0.7, 0.2, 0.78, 0.27, 0, '#f4f2ee', M.cloth, 0.5, q);
          b.box(0, 1.9, 0.96, 0.2, 0.22, 0.46, 0, '#f8f6f2', M.cloth, 0.5);
          b.box(0, 1.87, 1.2, 0.13, 0.14, 0.08, 0, '#3a3438', M.cloth, 0.1);
          for (const s of [-1, 1]) {
            b.box(s * 0.17, 2.06, 0.84, 0.22, 0.08, 0.05, s * 0.3, '#f4f2ee', M.cloth, 0.5);
            b.blob(s * 0.1, 1.95, 1.08, 0.025, 0.025, 0.02, 0, '#1a1a24', M.cloth, 0.1, true);
            // A crown of antlers, many tines, glowing faintly like frost.
            let x = s * 0.09;
            let y = 2.04;
            let z = 0.86;
            for (let k = 0; k < 7; k++) {
              const ax = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), s * (-0.5 + k * 0.06)).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.25 - k * 0.05));
              b.box(x, y, z, 0.045 - k * 0.004, 0.2, 0.045 - k * 0.004, 0, '#e8f8ff', M.crystal, 0.3 + k * 0.05, ax);
              const dir = new Vector3(0, 0.2, 0).applyQuaternion(ax);
              if (k > 1 && k < 6) {
                const tq = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.6).premultiply(ax);
                b.box(x, y + 0.05, z, 0.026, 0.18, 0.026, 0, '#e8f8ff', M.crystal, 0.6, tq);
              }
              x += dir.x;
              y += dir.y;
              z += dir.z;
            }
          }
        },
      },
      ...legs(0.18, 0.55, 1.0, 0.08, '#f0eee8', '#8a8a90'),
      { id: 6, pivot: [0, 1.25, -0.72], fn: (b) => b.box(0, 1.12, -0.78, 0.12, 0.2, 0.07, 0, '#ffffff', M.cloth, 0.8) },
    ]),
  owl: () =>
    assemble([
      {
        id: 0,
        pivot: [0, 0, 0],
        fn: (b) => {
          b.blob(0, 0.17, 0, 0.11, 0.17, 0.1, 0, '#8a6a4a', M.cloth, 0.5, true);
          b.blob(0, 0.15, 0.05, 0.08, 0.12, 0.06, 0, '#c8a880', M.cloth, 0.5, true);
          for (const sx of [-1, 1]) b.blob(sx * 0.09, 0.16, -0.02, 0.035, 0.13, 0.08, 0, '#6a4e36', M.cloth, 0.5, true);
          for (const sx of [-1, 1]) b.box(sx * 0.03, 0, 0.04, 0.02, 0.03, 0.04, 0, '#c8a040', M.cloth, 0.5);
        },
      },
      {
        id: 5,
        pivot: [0, 0.3, 0],
        fn: (b) => {
          b.blob(0, 0.36, 0.01, 0.1, 0.085, 0.09, 0, '#8a6a4a', M.cloth, 0.5, true);
          b.blob(0, 0.36, 0.07, 0.075, 0.06, 0.03, 0, '#c8aa86', M.cloth, 0.5, true);
          for (const sx of [-1, 1]) {
            b.blob(sx * 0.033, 0.37, 0.095, 0.018, 0.018, 0.01, 0, '#1a1208', M.lamp, 0.15, true);
          }
          b.cone(0, 0.32, 0.1, 0.012, 0.03, '#d8b878', M.cloth, 6);
        },
      },
      { id: 6, pivot: [0, 0.08, -0.08], fn: (b) => b.box(0, 0.02, -0.1, 0.08, 0.1, 0.03, 0, '#6a4e36', M.cloth, 0.5) },
    ]),
  heron: () =>
    assemble([
      {
        id: 0,
        pivot: [0, 0, 0],
        fn: (b) => {
          b.blob(0, 0.78, 0, 0.12, 0.13, 0.26, 0, '#9aa0a8', M.cloth, 0.5, true);
          b.blob(0, 0.75, -0.24, 0.08, 0.06, 0.16, 0, '#5a6068', M.cloth, 0.5, true);
          b.blob(0, 0.72, 0.1, 0.09, 0.1, 0.12, 0, '#d8dce0', M.cloth, 0.5, true);
        },
      },
      {
        id: 5,
        pivot: [0, 0.86, 0.18],
        fn: (b) => {
          const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.25);
          b.box(0, 0.86, 0.2, 0.05, 0.36, 0.06, 0, '#e8eaec', M.cloth, 0.5, q);
          b.blob(0, 1.22, 0.3, 0.045, 0.045, 0.07, 0, '#f0f2f4', M.cloth, 0.5, true);
          b.box(0, 1.25, 0.28, 0.08, 0.018, 0.12, 0, '#1a1c20', M.cloth, 0.1);
          const qb = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2 + 0.1);
          b.box(0, 1.22, 0.34, 0.018, 0.16, 0.022, 0, '#d8a040', M.cloth, 0.3, qb);
          for (const sx of [-1, 1]) b.blob(sx * 0.03, 1.235, 0.33, 0.008, 0.008, 0.006, 0, '#f0d040', M.cloth, 0.1, true);
        },
      },
      { id: 1, pivot: [-0.05, 0.65, 0], fn: (b) => b.box(-0.05, 0, 0, 0.02, 0.66, 0.02, 0, '#7a6a4a', M.cloth, 0.5) },
      { id: 4, pivot: [0.05, 0.65, 0], fn: (b) => b.box(0.05, 0, 0, 0.02, 0.66, 0.02, 0, '#7a6a4a', M.cloth, 0.5) },
    ]),
};

export type SpeciesName = keyof typeof SPECIES;

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
}

const TRAITS: Record<SpeciesName, Trait> = {
  sheep: { walk: 0.55, run: 2.6, flee: 5, stride: 0.9, turn: 2, body: [0.8, 0.6] },
  horse: { walk: 1.1, run: 5.5, flee: 7, stride: 1.9, turn: 1.4, body: [1.45, 1.1] },
  deer: { walk: 0.9, run: 7.5, flee: 22, stride: 1.5, turn: 3, body: [1.15, 0.8] },
  boar: { walk: 0.6, run: 4.5, flee: 9, stride: 0.8, turn: 2.5, body: [0.65, 0.6] },
  chicken: { walk: 0.35, run: 2.2, flee: 2.5, stride: 0.18, turn: 5, body: [0.32, 0.2] },
  cat: { walk: 0.5, run: 3.5, flee: 3, stride: 0.35, turn: 4, body: [0.28, 0.25] },
  fox: { walk: 0.8, run: 6.5, flee: 9, stride: 0.55, turn: 3.5, body: [0.42, 0.35], when: ['Golden hour', 'Dusk', 'Misty dawn'] },
  hare: { walk: 0.7, run: 8, flee: 6, stride: 0.75, turn: 4, body: [0.27, 0.22] },
  hedgehog: { walk: 0.22, run: 0.5, flee: 1.6, stride: 0.07, turn: 2, body: [0.1, 0.13], when: ['Dusk', 'Misty dawn'] },
  ibex: { walk: 0.7, run: 4.5, flee: 16, stride: 1.0, turn: 2.5, body: [0.85, 0.6] },
  hart: { walk: 0.8, run: 6, flee: 14, stride: 1.6, turn: 2, body: [1.3, 0.9], when: ['Misty dawn'] },
  owl: { walk: 0, run: 0, flee: 0, stride: 1, turn: 1.5, body: [0.24, 0.18], when: ['Dusk', 'Misty dawn'], still: true },
  heron: { walk: 0.3, run: 0.6, flee: 7, stride: 0.6, turn: 1.5, body: [0.85, 0.45] },
};

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
  fox: ['#ffffff', '#f4e8e0', '#ffeee0'],
  hare: ['#ffffff', '#f0e8dc', '#e8dccb'],
  hedgehog: ['#ffffff', '#e8e0d8'],
  ibex: ['#ffffff', '#e8e0d4', '#d8d0c4'],
  hart: ['#ffffff'],
  owl: ['#ffffff'],
  heron: ['#ffffff'],
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
    type Herd = { sp: SpeciesName; x: number; z: number; r: number; n: number; perch?: { y: number; heading: number } };
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
          t: range(r, 1, 12),
          tx: x,
          tz: z,
          home: { x: h.x, z: h.z, r: h.r },
          phase: r() * 10,
          gait: 0,
          graze: 1,
          seed: r(),
          scale: range(r, 0.88, 1.12) * (h.sp === 'deer' && r() < 0.6 ? 0.85 : 1) * (h.sp === 'hart' ? 1.15 : 1),
        });
      }
    }

    const mat = new ShaderMaterial({
      uniforms: { ...U, uHaze: { value: 0 }, uGroundAO: { value: 1 }, uFogK: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: STRUCT_FRAG,
    });
    const hop = new ShaderMaterial({
      uniforms: mat.uniforms,
      vertexShader: VERT,
      fragmentShader: STRUCT_FRAG,
      defines: { HOP: '' },
    });
    const coat = new Color();
    for (const sp of Object.keys(SPECIES) as SpeciesName[]) {
      const n = counts[sp];
      if (!n) continue;
      const geo = SPECIES[sp]();
      const anim = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
      anim.setUsage(DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      const m = sp === 'hare' ? hop : mat;
      const mesh = new InstancedMesh(geo, m, n);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      castShadow(mesh, shadowMaterial(m));
      const rc = mulberry32(sp.length * 977);
      for (let i = 0; i < n; i++) {
        coat.set(COATS[sp][Math.floor(rc() * COATS[sp].length)]);
        if (sp === 'sheep' && rc() < 0.85) coat.set(COATS.sheep[Math.floor(rc() * 3)]);
        mesh.setColorAt(i, coat);
      }
      this.meshes.set(sp, { mesh, anim });
      this.group.add(mesh);
    }
    this.update(0, 0, 0, 0, 'Noon');
  }

  private walkable(x: number, z: number, sp: SpeciesName = 'sheep'): boolean {
    const map = this.realm.map;
    const tame = sp === 'chicken' || sp === 'cat' || sp === 'hedgehog';
    const mm = mountainMask(x, z);
    const alpine = sp === 'ibex';
    return (
      this.features.waterDepth(x, z) < 0.05 &&
      map.solidAt(x, z) < 0.2 &&
      (tame || map.roadAt(x, z) < 0.6) &&
      (alpine ? mm > 0.06 && terrainHeight(x, z) < 330 : mm < 0.35) &&
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

  update(dt: number, px: number, pz: number, playerSpeed: number, tod: TimeName): void {
    const r = Math.random;
    for (const a of this.animals) {
      const tr = TRAITS[a.sp];
      const dp = Math.hypot(a.x - px, a.z - pz);
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
      const spook = !tr.still && !a.away && dp < tr.flee * (playerSpeed > 2 ? 2.2 : 1);
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
      a.phase += (a.speed / tr.stride) * Math.PI * dt;
      if (a.perch !== null) a.y = a.perch;
      else a.y += (terrainHeight(a.x, a.z) - a.y) * Math.min(1, dt * 10 + (dt === 0 ? 1 : 0));
    }

    for (const [sp, { mesh, anim }] of this.meshes) {
      for (const a of this.animals) {
        if (a.sp !== sp) continue;
        this.q.setFromAxisAngle(this.up, a.heading);
        this.m.compose(this.v.set(a.x, a.y, a.z), this.q, this.s.setScalar(a.hidden ? 0 : a.scale));
        mesh.setMatrixAt(a.i, this.m);
        anim.setXYZW(a.i, a.phase, a.gait, a.graze, a.seed);
      }
      mesh.instanceMatrix.needsUpdate = true;
      anim.needsUpdate = true;
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
