import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { U } from '../../core/uniforms';
import { COMMON_GLSL, findSpawn, mountainMask, terrainHeight } from '../common';
import { cellPools, FEATURE_CELL } from '../Features';
import type { Forest } from '../realm/Forest';
import { mulberry32, range, type Rng } from '../realm/rand';
import type { Realm } from '../realm/World';
import { site } from '../realm/World';
import { findSummit } from '../summit';
import { FloraBuilder, hex, mix, PAT, SHAPES, stemCurve, type RGB } from './floraKit';

/** A collectible thing somewhere in the world, for the lens and the journal. */
export interface Subject {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Rough radius of the subject (metres). */
  r: number;
}

const VERT = /* glsl */ `
${COMMON_GLSL}
attribute vec3 color;
attribute vec2 aUv;
attribute vec4 aInfo;
attribute vec4 aOpen;
attribute vec3 aAxis;
uniform float uOpen;
varying vec3 vCol;
varying vec2 vUv;
varying vec4 vInfo;
varying vec3 vN;
varying vec3 vWP;
varying float vH;

vec3 rotAxis(vec3 v, vec3 k, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

void main() {
  vec3 p = position;
  vec3 n = normal;
  if (aOpen.w != 0.0) {
    float a = aOpen.w * (1.0 - uOpen);
    p = aOpen.xyz + rotAxis(p - aOpen.xyz, aAxis, a);
    n = rotAxis(n, aAxis, a);
  }
  vec4 wp = modelMatrix * vec4(p, 1.0);
  float h = max(p.y, 0.0);
  float seed = dot(modelMatrix[3].xz, vec2(0.13, 0.71));
  float gust = gustAt(wp.xz);
  vec2 sw = uWindDir * (sin(uTime * 1.9 + seed * 6.0 + h * 3.0) * 0.35 + gust * uGustStrength * 0.8 + 0.2) * uWindStrength * 0.06;
  sw += vec2(sin(uTime * 2.7 + seed * 11.0), cos(uTime * 2.3 + seed * 7.0)) * 0.012 * (0.3 + uWindStrength);
  wp.xz += sw * (h * 0.6 + h * h * 3.0);
  vWP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  vCol = color;
  vUv = aUv;
  vInfo = aInfo;
  vH = h;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${COMMON_GLSL}
uniform float uOpen;
varying vec3 vCol;
varying vec2 vUv;
varying vec4 vInfo;
varying vec3 vN;
varying vec3 vWP;
varying float vH;

float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWP);
  if (dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(uSunDir);
  float pat = floor(vInfo.y + 0.5);
  float u = vUv.x;
  float v = vUv.y;
  vec3 alb = vCol;
  vec3 emit = vec3(0.0);
  float spec = 0.12;
  float shin = 20.0;
  float thin = vInfo.w;
  float night = max(uNight, uLights * 0.75);

  if (pat == 1.0) {
    // Felt: matted white hairs, a fine sparkle.
    float n = h21(floor(vec2(u * 70.0, (v + 1.0) * 12.0 + vInfo.z * 40.0)));
    float n2 = h21(floor(vWP.xz * 900.0));
    alb *= 0.84 + 0.2 * n + 0.08 * step(0.92, n2);
    spec = 0.04;
  } else if (pat == 2.0) {
    // Chequered fritillary: light squares in a skewed grid.
    float ch = mod(floor(u * 10.0) + floor((v + 1.0) * 3.0 + u * 2.0), 2.0);
    alb = mix(alb, min(alb * 3.6 + vec3(0.16, 0.1, 0.18), vec3(1.0)), ch * 0.8);
    spec = 0.3;
    shin = 30.0;
  } else if (pat == 3.0) {
    // Freckles toward the throat.
    vec2 q = vec2(u * 14.0, (v + 1.0) * 4.0);
    vec2 c = floor(q);
    vec2 f = fract(q) - 0.5 - (vec2(h21(c + 3.1), h21(c + 7.7)) - 0.5) * 0.4;
    float s = step(0.45, h21(c + vInfo.z * 13.0)) * smoothstep(0.3, 0.16, length(f)) * smoothstep(0.9, 0.35, u);
    alb = mix(alb, vec3(0.05, 0.01, 0.025), s * 0.92);
    spec = 0.25;
    shin = 30.0;
  } else if (pat == 4.0) {
    // Luminous veins (they light up as night falls).
    float d = abs(sin(v * 3.14159 * 2.5 + u * 1.2));
    float vein = smoothstep(0.22, 0.0, d) * smoothstep(1.0, 0.15, u) + smoothstep(0.08, 0.0, abs(v)) * 0.8;
    emit = vec3(0.35, 0.65, 1.0) * vein * vInfo.x * (0.12 + 0.88 * night) * (0.4 + 0.6 * uOpen);
    emit += vec3(0.5, 0.7, 1.0) * vInfo.x * 0.06 * night;
    spec = 0.45;
    shin = 40.0;
  } else if (pat == 5.0) {
    // Crystal: facets and glints, glowing from within.
    float facet = step(0.0, v) * 0.15;
    alb *= 0.85 + facet;
    spec = 1.4;
    shin = 90.0;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    float tw = step(0.985, h21(floor(vWP.xz * 300.0) + floor(uTime * 3.0)));
    emit = vCol * vInfo.x * (0.35 + 0.65 * night) + vec3(0.7, 1.0, 1.0) * (fres * 0.6 + tw * 1.5);
  } else if (pat == 6.0) {
    // Wax: ghostly white, faint inner light.
    spec = 0.5;
    shin = 30.0;
    emit = vec3(0.75, 0.82, 0.9) * vInfo.x * (0.15 + 0.85 * night);
  } else if (pat == 7.0) {
    // Leaf: pale midrib, lateral veins, waxy sheen.
    float mid = smoothstep(0.09, 0.0, abs(v));
    float lat = smoothstep(0.1, 0.0, abs(fract(u * 7.0 - abs(v) * 1.6) - 0.5) - 0.42);
    alb *= 0.9 + 0.25 * mid + 0.08 * lat;
    spec = 0.3;
    shin = 18.0;
  } else if (pat == 8.0) {
    alb *= mix(0.7, 1.0, u);
  } else if (pat == 9.0) {
    // Clover leaflet: notched tip, pale chevron.
    if (u > 0.8 && abs(v) < (u - 0.8) * 2.2) discard;
    float band = smoothstep(0.07, 0.0, abs(u - 0.42 - abs(v) * 0.22)) * step(abs(v), 0.75);
    alb = mix(alb, vec3(0.42, 0.62, 0.3), band * 0.7);
    spec = 0.35;
    shin = 24.0;
  } else if (pat == 10.0) {
    // Silk: fine veins and a soft sheen.
    alb *= 0.88 + 0.14 * smoothstep(0.0, 0.5, abs(sin(v * 18.0 + u * 3.0)));
    spec = 0.55;
    shin = 14.0;
  } else {
    alb *= 0.9 + 0.12 * smoothstep(0.0, 0.4, abs(sin(v * 14.0 + u * 2.0)));
  }

  float sh = cloudShadowAt(vWP.xz) * treeShadeAt(vWP) * sunShadow(vWP);
  float ndl = dot(N, L);
  float diff = max(ndl * 0.65 + 0.35, 0.0);
  float trans = max(0.0, -ndl) * thin;
  vec3 H = normalize(L + V);
  float sp = pow(max(dot(N, H), 0.0), shin) * spec;
  float ao = mix(0.5, 1.0, smoothstep(0.0, 0.1, vH));
  vec3 col = alb * (uAmbient * 1.05 * ao + uSunColor * diff * sh) + alb * uSunColor * trans * 0.9 * sh + uSunColor * sp * sh;
  col += emit;
  col = applyFog(col, vWP);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const MOTE_VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
attribute vec4 aSeed;
attribute float aOn;
varying float vA;
void main() {
  float t = fract(uTime * 0.11 * (0.7 + aSeed.y * 0.6) + aSeed.x);
  float a = aSeed.z * 6.2831 + uTime * (0.25 + aSeed.w * 0.3);
  float r = (0.12 + 0.4 * aSeed.w) * (1.0 - t * 0.4);
  vec3 p = position + vec3(cos(a) * r, 0.05 + t * (1.2 + aSeed.y), sin(a) * r);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  vA = sin(t * 3.14159) * aOn * (1.0 - smoothstep(30.0, 55.0, d)) * (0.55 + 0.45 * sin(uTime * 3.0 + aSeed.x * 40.0));
  gl_PointSize = max(0.03 * uPixelRatio * 700.0 / max(d, 0.1), 2.2 * uPixelRatio);
}
`;
const MOTE_FRAG = /* glsl */ `
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a = a * a * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vec3(1.0, 0.92, 0.62) * a * 1.6, 1.0);
}
`;

// ------------------------------------------------------------------ species

type Built = { head: Vector3; size: number };
type Species = (b: FloraBuilder, r: Rng) => Built;

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const grad = (a: string, b: string, k = 1) => {
  const A = hex(a);
  const B = hex(b);
  return (u: number) => mix(A, B, Math.pow(u, k));
};
const flat = (c: string) => {
  const C = hex(c);
  return () => C;
};

function leafRosette(b: FloraBuilder, r: Rng, n: number, len: number, wid: number, base: string, tip: string, opts: { elev?: number; curl?: number; shape?: (u: number) => number; pattern?: number; y?: number } = {}): void {
  const col = grad(base, tip);
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI * 2 + r() * 0.5;
    b.petal({
      at: V(0, opts.y ?? 0.004, 0),
      az,
      elev: (opts.elev ?? 0.35) + (r() - 0.5) * 0.2,
      len: len * range(r, 0.8, 1.15),
      wid,
      curl: opts.curl ?? -0.6,
      cup: 0.25,
      shape: opts.shape ?? SHAPES.lance,
      color: (u) => col(u),
      pattern: opts.pattern ?? PAT.leaf,
      thin: 0.5,
      rnd: r(),
      nu: 7,
      nv: 3,
    });
  }
}

const SPECIES: Record<string, Species> = {
  clover4: (b, r) => {
    const plant = (x: number, z: number, leaves: number, s: number) => {
      const top = V(x, 0.075 * s, z);
      b.tube(stemCurve(V(x, 0, z), 0.075 * s, 0.3, r() * 6.28, 5), () => 0.0016, grad('#4a6a2a', '#7aa04a'));
      const rot = r() * 6.28;
      for (let k = 0; k < leaves; k++) {
        b.petal({
          at: top.clone(),
          az: rot + (k / leaves) * Math.PI * 2,
          elev: 0.18,
          len: 0.024 * s,
          wid: 0.016 * s,
          shape: SHAPES.heart,
          curl: -0.25,
          cup: 0.18,
          color: grad('#2f6a26', '#4f9a3a'),
          pattern: PAT.clover,
          thin: 0.6,
          rnd: r(),
          nu: 8,
          nv: 5,
        });
      }
      return top;
    };
    const head = plant(0, 0, 4, 1.25);
    for (let i = 0; i < 9; i++) {
      const a = r() * 6.28;
      const d = range(r, 0.07, 0.22);
      plant(Math.cos(a) * d, Math.sin(a) * d, 3, range(r, 0.9, 1.2));
    }
    return { head, size: 0.04 };
  },

  fritillary: (b, r) => {
    let head = V(0, 0.2, 0);
    for (let s = 0; s < 3; s++) {
      const a = r() * 6.28;
      const base = V(Math.cos(a) * 0.05 * s, 0, Math.sin(a) * 0.05 * s);
      const pts = stemCurve(base, range(r, 0.26, 0.34), range(r, 1.7, 2.1), r() * 6.28, 10);
      b.tube(pts, (t) => 0.0024 * (1 - t * 0.3), grad('#4f6a3a', '#6f8a4a'));
      const tip = pts[pts.length - 1];
      if (s === 0) head = tip.clone().add(V(0, -0.022, 0));
      const rot = r() * 6.28;
      for (let k = 0; k < 6; k++) {
        b.petal({
          at: tip.clone(),
          az: rot + (k / 6) * Math.PI * 2,
          elev: -1.38,
          len: 0.042,
          wid: 0.013,
          curl: 0.3,
          cup: 0.28,
          shape: SHAPES.ellipse,
          color: () => hex('#5a2450'),
          pattern: PAT.checker,
          thin: 0.65,
          rnd: r(),
        });
      }
      for (let l = 0; l < 2; l++) {
        b.petal({ at: V(base.x, 0.02 + l * 0.05, base.z), az: r() * 6.28, elev: 0.9, len: 0.12, wid: 0.004, curl: -1.0, shape: SHAPES.strap, color: grad('#3f6a3a', '#7a9a5a'), pattern: PAT.leaf, rnd: r(), nv: 2 });
      }
    }
    return { head, size: 0.032 };
  },

  pasque: (b, r) => {
    leafRosette(b, r, 9, 0.07, 0.006, '#5a7a4a', '#9ab08a', { elev: 0.4, curl: -0.8, shape: SHAPES.strap });
    let head = V(0, 0.2, 0);
    for (let s = 0; s < 2; s++) {
      const a = r() * 6.28;
      const base = V(Math.cos(a) * 0.04 * s, 0, Math.sin(a) * 0.04 * s);
      const h = range(r, 0.15, 0.2);
      const pts = stemCurve(base, h, 0.3, r() * 6.28, 6);
      b.tube(pts, () => 0.0028, grad('#6a7a5a', '#8a8a7a'));
      const top = pts[pts.length - 1];
      if (s === 0) head = top.clone().add(V(0, 0.02, 0));
      const rot = r() * 6.28;
      for (let k = 0; k < 6; k++) {
        b.petal({ at: top.clone(), az: rot + (k / 6) * Math.PI * 2 + (k % 2) * 0.1, elev: 0.95 + (k % 2) * 0.12, len: 0.042, wid: 0.016, curl: 0.35, cup: 0.32, shape: SHAPES.ellipse, color: grad('#3c1f6a', '#9a74d4', 0.8), pattern: PAT.silk, thin: 0.75, rnd: r() });
      }
      for (let k = 0; k < 20; k++) {
        const aa = (k / 20) * 6.28;
        const rr = 0.006 + (k % 2) * 0.003;
        b.ball(top.clone().add(V(Math.cos(aa) * rr, 0.012 + (k % 3) * 0.002, Math.sin(aa) * rr)), 0.0018, 0.0018, 0.0018, flat('#f0c020'), { pattern: PAT.plain }, 5);
      }
      b.ball(top.clone().add(V(0, 0.014, 0)), 0.004, 0.005, 0.004, flat('#5a2a7a'), { pattern: PAT.wool }, 6);
    }
    return { head, size: 0.045 };
  },

  bluepoppy: (b, r) => {
    leafRosette(b, r, 5, 0.13, 0.025, '#4a6a32', '#7a9a52', { elev: 0.5, curl: -0.9, shape: SHAPES.ellipse });
    const pts = stemCurve(V(0, 0, 0), 0.56, 0.6, r() * 6.28, 12);
    b.tube(pts, (t) => 0.0042 * (1 - t * 0.35), grad('#5a7a3a', '#6a8a4a'));
    const top = pts[pts.length - 1];
    const rot = r() * 6.28;
    for (let k = 0; k < 4; k++) {
      b.petal({ at: top.clone(), az: rot + (k / 4) * Math.PI * 2, elev: 0.5, len: 0.058, wid: 0.05, curl: 0.75, cup: 0.32, ruffle: 0.06, shape: SHAPES.round, color: grad('#2a4fb8', '#8ab8f2', 0.7), pattern: PAT.plain, thin: 0.9, rnd: r(), nu: 10, nv: 6 });
    }
    for (let k = 0; k < 34; k++) {
      const aa = (k / 34) * 6.28 * 3.1;
      const rr = 0.009 + (k % 4) * 0.002;
      b.ball(top.clone().add(V(Math.cos(aa) * rr, 0.01 + (k % 3) * 0.002, Math.sin(aa) * rr)), 0.0019, 0.0019, 0.0019, flat('#f2c418'), {}, 5);
    }
    b.ball(top.clone().add(V(0, 0.012, 0)), 0.006, 0.008, 0.006, flat('#8ab84a'), {}, 7);
    return { head: top.clone().add(V(0, 0.02, 0)), size: 0.065 };
  },

  slipper: (b, r) => {
    const az = r() * 6.28;
    const pts = stemCurve(V(0, 0, 0), 0.32, 0.5, az, 10);
    b.tube(pts, () => 0.0035, grad('#4a6a2a', '#6a8a3a'));
    for (let k = 0; k < 3; k++) {
      const p = pts[2 + k * 2];
      b.petal({ at: p.clone(), az: az + k * 2.3, elev: 0.75, len: 0.13, wid: 0.036, curl: -0.6, cup: 0.35, shape: SHAPES.ellipse, color: grad('#3a6a2a', '#6aa04a'), pattern: PAT.leaf, rnd: r(), nu: 9, nv: 4 });
    }
    const top = pts[pts.length - 1];
    const fx = Math.cos(az);
    const fz = Math.sin(az);
    const pouch = top.clone().add(V(fx * 0.022, -0.018, fz * 0.022));
    b.ball(pouch, 0.02, 0.017, 0.02, grad('#c89a10', '#f4d43a'), { pattern: PAT.plain, thin: 0.4 }, 12);
    b.petal({ at: top.clone(), az: az + Math.PI, elev: 1.25, len: 0.055, wid: 0.013, curl: 0.5, cup: 0.3, shape: SHAPES.lance, color: grad('#3a1410', '#7a3020'), pattern: PAT.silk, thin: 0.5, rnd: r() });
    b.petal({ at: top.clone(), az: az + Math.PI, elev: -1.1, len: 0.045, wid: 0.011, curl: 0.2, cup: 0.3, shape: SHAPES.lance, color: grad('#3a1410', '#6a2a1a'), pattern: PAT.silk, thin: 0.5, rnd: r() });
    for (const s of [-1, 1]) {
      b.petal({ at: top.clone(), az: az + s * 1.75, elev: -0.55, len: 0.065, wid: 0.0055, twist: 4.2 * s, shape: SHAPES.strap, color: grad('#4a1a12', '#8a3a22'), pattern: PAT.silk, thin: 0.5, rnd: r(), nu: 12, nv: 2 });
    }
    return { head: pouch.clone().add(V(0, 0.008, 0)), size: 0.04 };
  },

  martagon: (b, r) => {
    const pts = stemCurve(V(0, 0, 0), 0.95, 0.25, r() * 6.28, 14);
    b.tube(pts, (t) => 0.0045 * (1 - t * 0.4), grad('#4a5a2a', '#6a5a4a'));
    const whorl = pts[5];
    for (let k = 0; k < 7; k++) {
      b.petal({ at: whorl.clone(), az: (k / 7) * 6.28 + r() * 0.3, elev: 0.3, len: 0.12, wid: 0.018, curl: -0.6, cup: 0.25, shape: SHAPES.lance, color: grad('#2f5a24', '#5a8a3a'), pattern: PAT.leaf, rnd: r() });
    }
    let head = pts[11].clone();
    for (let f = 0; f < 4; f++) {
      const p = pts[9 + Math.min(5, f + (f > 1 ? 1 : 0))] ?? pts[pts.length - 1];
      const az = f * 2.4 + r() * 0.5;
      const ped = stemCurve(p, 0.06, 2.2, az, 6);
      b.tube(ped, () => 0.0018, grad('#5a5a3a', '#8a5a6a'));
      const fl = ped[ped.length - 1];
      if (f === 1) head = fl.clone().add(V(0, -0.01, 0));
      const rot = r() * 6.28;
      for (let k = 0; k < 6; k++) {
        b.petal({ at: fl.clone(), az: rot + (k / 6) * Math.PI * 2, elev: -1.25, len: 0.048, wid: 0.0095, curl: 3.8, cup: 0.25, shape: SHAPES.lance, color: grad('#b0507a', '#e6a0c4', 0.7), pattern: PAT.spots, thin: 0.6, rnd: r(), nu: 12, nv: 3 });
      }
      for (let k = 0; k < 6; k++) {
        const aa = (k / 6) * 6.28;
        const end = fl.clone().add(V(Math.cos(aa) * 0.012, -0.045, Math.sin(aa) * 0.012));
        b.tube([fl.clone(), fl.clone().lerp(end, 0.5).add(V(0, 0.004, 0)), end], () => 0.0008, flat('#c8b0a0'), {}, 4);
        b.ball(end, 0.0016, 0.004, 0.0016, flat('#c84a1a'), {}, 5);
      }
    }
    return { head, size: 0.06 };
  },

  ghostpipe: (b, r) => {
    let head = V(0, 0.12, 0);
    for (let s = 0; s < 7; s++) {
      const a = r() * 6.28;
      const d = s === 0 ? 0 : range(r, 0.012, 0.035);
      const base = V(Math.cos(a) * d, 0, Math.sin(a) * d);
      const az = Math.atan2(base.z, base.x) + (r() - 0.5);
      const pts = stemCurve(base, range(r, 0.12, 0.17), range(r, 2.0, 2.5), az, 10);
      b.tube(pts, () => 0.0042, grad('#c8ccd0', '#f4f6fa'), { pattern: PAT.wax, glow: 0.2, thin: 0.85 });
      const tip = pts[pts.length - 1];
      const dir = tip.clone().sub(pts[pts.length - 2]).normalize();
      b.lathe(tip, dir, [[0.004, -0.002], [0.008, 0.006], [0.0105, 0.014], [0.0115, 0.02], [0.0105, 0.024]], (u) => mix(hex('#e8eaee'), hex('#ffffff'), u), { pattern: PAT.wax, glow: 0.35, thin: 0.9 }, 12, 5, 0.12);
      if (s === 0) head = tip.clone();
    }
    return { head, size: 0.045 };
  },

  gentian: (b, r) => {
    leafRosette(b, r, 7, 0.055, 0.017, '#1f4a22', '#3f7a3a', { elev: 0.12, curl: -0.2, shape: SHAPES.ellipse });
    let head = V(0, 0.07, 0);
    for (let s = 0; s < 2; s++) {
      const a = r() * 6.28;
      const base = V(Math.cos(a) * 0.035 * s, 0.004, Math.sin(a) * 0.035 * s);
      const tilt = V((r() - 0.5) * 0.3, 1, (r() - 0.5) * 0.3).normalize();
      const k = 1.35;
      b.lathe(base, tilt, [[0.005 * k, 0], [0.008 * k, 0.012 * k], [0.011 * k, 0.03 * k], [0.015 * k, 0.045 * k], [0.021 * k, 0.054 * k]], (u) => mix(hex('#2a5a3a'), hex('#1424a8'), Math.min(1, u * 2.2)), { pattern: PAT.silk, thin: 0.55 }, 15, 5, 0.18);
      const rim = base.clone().addScaledVector(tilt, 0.054 * k);
      if (s === 0) head = rim.clone();
      for (let l = 0; l < 5; l++) {
        b.petal({ at: rim.clone().add(V(Math.cos((l / 5) * 6.28) * 0.02, 0, Math.sin((l / 5) * 6.28) * 0.02)), az: (l / 5) * 6.28, elev: 0.25, len: 0.02, wid: 0.013, curl: -0.3, cup: 0.2, shape: SHAPES.round, color: grad('#1a2ab8', '#2a3ad0'), pattern: PAT.silk, thin: 0.6, rnd: r() });
      }
    }
    return { head, size: 0.035 };
  },

  edelweiss: (b, r) => {
    leafRosette(b, r, 7, 0.05, 0.007, '#8a9a82', '#b4c0ac', { elev: 0.3, curl: -0.4, pattern: PAT.wool });
    let head = V(0, 0.12, 0);
    for (let s = 0; s < 3; s++) {
      const a = r() * 6.28;
      const base = V(Math.cos(a) * 0.04 * s, 0, Math.sin(a) * 0.04 * s);
      const pts = stemCurve(base, range(r, 0.1, 0.14), 0.4, r() * 6.28, 6);
      b.tube(pts, () => 0.0025, grad('#8a9a82', '#b8c4b0'), { pattern: PAT.wool });
      const top = pts[pts.length - 1];
      if (s === 0) head = top.clone();
      const rot = r() * 6.28;
      for (let k = 0; k < 10; k++) {
        b.petal({ at: top.clone(), az: rot + (k / 10) * Math.PI * 2 + (r() - 0.5) * 0.15, elev: 0.14 + r() * 0.15, len: range(r, 0.024, 0.038), wid: 0.0078, curl: 0.25, cup: 0.25, shape: SHAPES.lance, color: (u) => mix(hex('#c8d0bc'), hex('#f6f6ee'), Math.min(1, u * 1.6)), pattern: PAT.wool, thin: 0.35, rnd: r() });
      }
      for (let k = 0; k < 6; k++) {
        const aa = (k / 5) * 6.28;
        const rr = k === 5 ? 0 : 0.0085;
        b.ball(top.clone().add(V(Math.cos(aa) * rr, 0.004, Math.sin(aa) * rr)), 0.0048, 0.0042, 0.0048, flat('#e8e0b0'), { pattern: PAT.wool }, 7);
      }
    }
    return { head, size: 0.035 };
  },

  moonpetal: (b, r) => {
    const pts = stemCurve(V(0, 0, 0), 0.44, 0.35, r() * 6.28, 10);
    b.tube(pts, () => 0.0032, grad('#4a6a6a', '#9ab0b8'));
    for (let k = 0; k < 3; k++) {
      b.petal({ at: pts[2 + k * 2].clone(), az: k * 2.2 + r(), elev: 0.6, len: 0.1, wid: 0.018, curl: -0.6, cup: 0.3, shape: SHAPES.lance, color: grad('#5a7a7a', '#a8c4c8'), pattern: PAT.leaf, rnd: r() });
    }
    const top = pts[pts.length - 1];
    const rot = r() * 6.28;
    const whorl = (n: number, len: number, wid: number, elev: number, close: number, off: number) => {
      for (let k = 0; k < n; k++) {
        const az = rot + off + (k / n) * Math.PI * 2;
        b.petal({
          at: top.clone(),
          az,
          elev,
          len,
          wid,
          curl: 0.45,
          cup: 0.28,
          shape: SHAPES.spoon,
          color: (u) => mix(hex('#8aa8f0'), hex('#f2f6ff'), Math.min(1, u * 1.4)),
          pattern: PAT.veins,
          glow: 1.0,
          thin: 0.85,
          rnd: r(),
          hinge: { pivot: top.clone(), axis: V(-Math.sin(az), 0, Math.cos(az)), angle: close },
        });
      }
    };
    whorl(7, 0.07, 0.022, 0.15, 1.3, 0);
    whorl(5, 0.046, 0.016, 0.5, 0.95, 0.4);
    b.ball(top.clone().add(V(0, 0.008, 0)), 0.007, 0.007, 0.007, flat('#d8ecff'), { pattern: PAT.veins, glow: 2.2 }, 8);
    return { head: top.clone().add(V(0, 0.02, 0)), size: 0.07 };
  },

  starbloom: (b, r) => {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * 6.28 + r();
      b.petal({ at: V(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05), az: a, elev: 1.15, len: range(r, 0.05, 0.11), wid: 0.012, shape: SHAPES.lance, cup: -0.4, color: grad('#3ab8d8', '#c8f8ff'), pattern: PAT.crystal, glow: 0.6, thin: 0.9, rnd: r(), nu: 4, nv: 2 });
    }
    const pts = stemCurve(V(0, 0, 0), 0.4, 0.25, r() * 6.28, 8);
    b.tube(pts, () => 0.003, grad('#5ac8d8', '#b8f0ff'), { pattern: PAT.crystal, glow: 0.4, thin: 0.9 });
    const top = pts[pts.length - 1];
    const rot = r() * 6.28;
    for (let k = 0; k < 5; k++) {
      b.petal({ at: top.clone(), az: rot + (k / 5) * Math.PI * 2, elev: 0.55, len: 0.068, wid: 0.02, curl: 0.25, cup: -0.35, shape: SHAPES.lance, color: grad('#2ad0f0', '#eaffff', 0.7), pattern: PAT.crystal, glow: 0.9, thin: 0.95, rnd: r(), nu: 5, nv: 2 });
      b.petal({ at: top.clone(), az: rot + ((k + 0.5) / 5) * Math.PI * 2, elev: 0.95, len: 0.042, wid: 0.013, curl: 0.2, cup: -0.35, shape: SHAPES.lance, color: grad('#6ae0ff', '#ffffff', 0.7), pattern: PAT.crystal, glow: 1.0, thin: 0.95, rnd: r(), nu: 4, nv: 2 });
    }
    b.ball(top.clone().add(V(0, 0.01, 0)), 0.007, 0.01, 0.007, flat('#f0ffff'), { pattern: PAT.crystal, glow: 2.4 }, 6);
    return { head: top.clone().add(V(0, 0.02, 0)), size: 0.06 };
  },

  skybell: (b, r) => {
    leafRosette(b, r, 6, 0.045, 0.02, '#3a6a4a', '#6a9a7a', { elev: 0.2, curl: -0.3, shape: SHAPES.round });
    let head = V(0, 0.25, 0);
    for (let s = 0; s < 2; s++) {
      const a = r() * 6.28;
      const base = V(Math.cos(a) * 0.04 * s, 0, Math.sin(a) * 0.04 * s);
      const az = r() * 6.28;
      const pts = stemCurve(base, range(r, 0.28, 0.34), 1.5, az, 12);
      b.tube(pts, (t) => 0.0026 * (1 - t * 0.3), grad('#4a7a5a', '#8ab09a'));
      for (const i of [6, 8, 10, 12]) {
        const p = pts[i];
        const end = p.clone().add(V(Math.cos(az + i) * 0.012, -0.012, Math.sin(az + i) * 0.012));
        b.tube([p.clone(), end], () => 0.0012, flat('#7aa08a'), {}, 4);
        b.lathe(end, V(0, -1, 0), [[0.003, 0], [0.008, 0.006], [0.011, 0.016], [0.0125, 0.024], [0.017, 0.031]], (u) => mix(hex('#6aa0e8'), hex('#d8ecff'), u), { pattern: PAT.silk, glow: 0.35, thin: 0.85 }, 14, 5, 0.22);
        b.ball(end.clone().add(V(0, -0.022, 0)), 0.0025, 0.0025, 0.0025, flat('#fff4c8'), { pattern: PAT.veins, glow: 1.2 }, 5);
        if (s === 0 && i === 10) head = end.clone().add(V(0, -0.015, 0));
      }
    }
    return { head, size: 0.05 };
  },
};

// ------------------------------------------------------------------ placement

interface Spot {
  id: string;
  x: number;
  z: number;
  rot: number;
  scale: number;
}

interface Specimen extends Subject {
  mesh: Mesh;
  head: Vector3;
  ground: number;
  scale: number;
  moteIdx: number;
}

const MOTES = 7;

interface OkOpts {
  slope?: number;
  mtn?: [number, number];
  pave?: boolean;
}

/**
 * Rare flowers: a dozen species (real rarities and a few the realm grew on its own), each at a
 * few hand-picked kinds of places: by the pools, around the standing stones, at the edge of the
 * woods, under the cherries, among the crystals, high in the mountains. Each is a real little
 * mesh to be looked at up close. Until you collect one, golden motes rise from it and the grass
 * bows away around it, so it can be found.
 */
export class RareFlora {
  readonly group = new Group();
  readonly specimens: Specimen[] = [];
  private readonly mats = new Map<string, ShaderMaterial>();
  private readonly moteOn: BufferAttribute;
  private readonly motePos: BufferAttribute;
  private readonly motes: Points;
  private visT = 0;
  private lastFeat = -1;

  constructor(private readonly realm: Realm, private readonly forest: Forest, collected: (id: string) => boolean) {
    const spots = this.plan();
    const geos = new Map<string, { geo: BufferGeometry; built: Built }[]>();
    const moteSeed: number[] = [];
    const motePos: number[] = [];
    const moteOn: number[] = [];
    spots.forEach((s, i) => {
      const variants = geos.get(s.id) ?? [];
      geos.set(s.id, variants);
      if (variants.length < 2) {
        const b = new FloraBuilder();
        const built = SPECIES[s.id](b, mulberry32(0x51ee + s.id.length * 97 + variants.length * 7919));
        variants.push({ geo: b.build(), built });
      }
      const v = variants[i % variants.length];
      let mat = this.mats.get(s.id);
      if (!mat) {
        mat = new ShaderMaterial({
          uniforms: { ...U, uOpen: { value: 1 } },
          vertexShader: VERT,
          fragmentShader: FRAG,
          side: DoubleSide,
        });
        this.mats.set(s.id, mat);
      }
      const mesh = new Mesh(v.geo, mat);
      mesh.rotation.y = s.rot;
      mesh.scale.setScalar(s.scale);
      const ground = terrainHeight(s.x, s.z);
      mesh.position.set(s.x, ground, s.z);
      mesh.visible = false;
      this.group.add(mesh);
      const head = v.built.head.clone();
      const sp: Specimen = { id: s.id, x: s.x, y: 0, z: s.z, r: v.built.size * s.scale, mesh, head, ground, scale: s.scale, moteIdx: motePos.length / 3 };
      this.place(sp);
      this.specimens.push(sp);
      const on = collected(s.id) ? 0 : 1;
      for (let k = 0; k < MOTES; k++) {
        motePos.push(s.x, ground, s.z);
        moteSeed.push(Math.random(), Math.random(), Math.random(), Math.random());
        moteOn.push(on);
      }
    });

    const g = new BufferGeometry();
    this.motePos = new BufferAttribute(new Float32Array(motePos), 3);
    this.moteOn = new BufferAttribute(new Float32Array(moteOn), 1);
    g.setAttribute('position', this.motePos);
    g.setAttribute('aSeed', new BufferAttribute(new Float32Array(moteSeed), 4));
    g.setAttribute('aOn', this.moteOn);
    this.motes = new Points(
      g,
      new ShaderMaterial({
        uniforms: { uTime: U.uTime, uPixelRatio: U.uPixelRatio },
        vertexShader: MOTE_VERT,
        fragmentShader: MOTE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 11;
    this.group.add(this.motes);
  }

  private place(sp: Specimen): void {
    const m = sp.mesh;
    m.position.y = sp.ground;
    m.updateMatrixWorld();
    const w = sp.head.clone().applyMatrix4(m.matrixWorld);
    sp.x = w.x;
    sp.y = w.y;
    sp.z = w.z;
  }

  /** The aura stops once the flower is in the journal. */
  markCollected(id: string): void {
    for (const s of this.specimens) {
      if (s.id !== id) continue;
      for (let k = 0; k < MOTES; k++) this.moteOn.setX(s.moteIdx + k, 0);
    }
    this.moteOn.needsUpdate = true;
  }

  update(dt: number, cx: number, cz: number, featVersion: number, open: number): void {
    const mp = this.mats.get('moonpetal');
    if (mp) mp.uniforms.uOpen.value = open;
    this.visT -= dt;
    // Ground can change near the pools as the feature map follows the walker.
    if (featVersion !== this.lastFeat) {
      this.lastFeat = featVersion;
      for (const s of this.specimens) {
        if (Math.hypot(s.x - cx, s.z - cz) > 400) continue;
        const g = terrainHeight(s.mesh.position.x, s.mesh.position.z);
        if (Math.abs(g - s.ground) > 0.005) {
          s.ground = g;
          this.place(s);
          for (let k = 0; k < MOTES; k++) this.motePos.setXYZ(s.moteIdx + k, s.mesh.position.x, g, s.mesh.position.z);
          this.motePos.needsUpdate = true;
        }
      }
    }
    if (this.visT > 0) return;
    this.visT = 0.4;
    for (const s of this.specimens) s.mesh.visible = Math.hypot(s.x - cx, s.z - cz) < 160;
  }

  /** Uncollected specimens near a point (for the grass to part around them). */
  nearby(cx: number, cz: number, radius: number, collected: (id: string) => boolean, out: { x: number; z: number; r: number; s: number }[]): void {
    for (const s of this.specimens) {
      if (collected(s.id)) continue;
      const d = Math.hypot(s.x - cx, s.z - cz);
      if (d < radius) out.push({ x: s.mesh.position.x, z: s.mesh.position.z, r: Math.max(0.6, s.r * 9), s: 0.85 });
    }
  }

  subjects(out: Subject[]): void {
    for (const s of this.specimens) if (s.mesh.visible) out.push(s);
  }

  // ---- where each species grows ----

  private ok(x: number, z: number, opts: OkOpts = {}): boolean {
    const map = this.realm.map;
    if (map.solidAt(x, z) > 0.02 || (!opts.pave && map.roadAt(x, z) > 0.02)) return false;
    if (!this.forest.clear(x, z) || this.forest.blocked(x, z, 0.9)) return false;
    const m = mountainMask(x, z);
    const [m0, m1] = opts.mtn ?? [0, 0.12];
    if (m < m0 || m > m1) return false;
    const e = 0.8;
    const gx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
    const gz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
    if (Math.hypot(gx, gz) > (opts.slope ?? 0.45)) return false;
    // Stay clear of every pond's water.
    const ci = Math.floor(x / FEATURE_CELL);
    const cj = Math.floor(z / FEATURE_CELL);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (const p of cellPools(i, j)) if (Math.hypot(p.x - x, p.z - z) < p.r * 1.25 + 1.2) return false;
      }
    }
    return true;
  }

  private scatter(out: Spot[], r: Rng, id: string, ax: number, az: number, r0: number, r1: number, n: number, test: (x: number, z: number) => boolean, scale = 1): void {
    let placed = 0;
    for (let t = 0; t < 600 && placed < n; t++) {
      const a = r() * Math.PI * 2;
      const d = r0 + Math.sqrt(r()) * (r1 - r0);
      const x = ax + Math.cos(a) * d;
      const z = az + Math.sin(a) * d;
      if (!test(x, z)) continue;
      if (out.some((s) => Math.hypot(s.x - x, s.z - z) < 7)) continue;
      out.push({ id, x, z, rot: r() * Math.PI * 2, scale: scale * range(r, 0.92, 1.1) });
      placed++;
    }
  }

  private plan(): Spot[] {
    const r = mulberry32(0xf10a);
    const out: Spot[] = [];
    const ok = (o?: OkOpts) => (x: number, z: number) => this.ok(x, z, o);
    const nearTrees = (min: number, max: number) => (x: number, z: number) => this.ok(x, z) && this.forest.blocked(x, z, max) && !this.forest.blocked(x, z, min);

    const spawn = findSpawn();
    this.scatter(out, r, 'clover4', spawn.x, spawn.z, 18, 55, 1, ok({ slope: 0.3 }), 1.3);

    // Fritillaries along the shores of the ponds nearest the start.
    const pools: { x: number; z: number; r: number; d: number }[] = [];
    const ci = Math.floor(spawn.x / FEATURE_CELL);
    const cj = Math.floor(spawn.z / FEATURE_CELL);
    for (let i = ci - 4; i <= ci + 4; i++) {
      for (let j = cj - 4; j <= cj + 4; j++) {
        for (const p of cellPools(i, j)) if (p.r > 5) pools.push({ x: p.x, z: p.z, r: p.r, d: Math.hypot(p.x - spawn.x, p.z - spawn.z) });
      }
    }
    pools.sort((a, b) => a.d - b.d);
    for (const p of pools.slice(0, 4)) this.scatter(out, r, 'fritillary', p.x, p.z, p.r * 1.3 + 1.5, p.r * 1.3 + 5, 1, ok({ slope: 0.35 }), 1.15);

    const ring = site('ring');
    this.scatter(out, r, 'pasque', ring.x, ring.z, 17, 30, 3, ok(), 1.25);
    const ruins = site('ruins');
    this.scatter(out, r, 'bluepoppy', ruins.x, ruins.z, 20, 46, 3, ok({ slope: 0.5 }), 1.15);
    this.scatter(out, r, 'slipper', -900, -230, 10, 160, 2, nearTrees(1.3, 7), 1.2);
    this.scatter(out, r, 'martagon', 190, 330, 10, 170, 3, nearTrees(1.4, 9), 1.05);
    // Ghost pipe: the darkest forest floor within reach of the start.
    let deep: { x: number; z: number; n: number } | null = null;
    for (let x = spawn.x - 900; x <= spawn.x + 900; x += 30) {
      for (let z = spawn.z - 900; z <= spawn.z + 900; z += 30) {
        const d = Math.hypot(x - spawn.x, z - spawn.z);
        if (d < 250 || mountainMask(x, z) > 0.05) continue;
        let n = 0;
        for (let k = 0; k < 8; k++) if (this.forest.blocked(x + Math.cos(k) * 9, z + Math.sin(k) * 9, 5)) n++;
        if (!deep || n > deep.n || (n === deep.n && d < Math.hypot(deep.x - spawn.x, deep.z - spawn.z))) deep = { x, z, n };
      }
    }
    if (deep) this.scatter(out, r, 'ghostpipe', deep.x, deep.z, 0, 40, 2, nearTrees(1.1, 5), 1.4);
    // Mountains.
    const watch = site('watch');
    for (const [x, z] of [[-1450, 420], [-1580, 445], [-1300, 360]]) this.scatter(out, r, 'gentian', x, z, 8, 60, 1, ok({ mtn: [0.0, 0.45], slope: 0.6 }), 1.35);
    this.scatter(out, r, 'edelweiss', watch.x, watch.z, 30, 170, 3, (x, z) => this.ok(x, z, { mtn: [0.12, 0.7], slope: 0.7 }) && terrainHeight(x, z) > watch.level + 12, 1.45);
    const grove = site('grove');
    this.scatter(out, r, 'moonpetal', grove.x, grove.z, 13, 38, 3, ok({ slope: 0.4 }), 1.1);
    const cr = site('crystals');
    this.scatter(out, r, 'starbloom', cr.x, cr.z, 8, 55, 1, ok({ slope: 0.4 }), 1.3);
    const sum = findSummit();
    this.scatter(out, r, 'skybell', sum.x, sum.z, 4, 14, 1, (x, z) => this.ok(x, z, { mtn: [0.3, 1.01], slope: 0.75 }) && Math.hypot(x - (sum.x + 3.5), z - (sum.z + 2)) > 2.5, 1.4);
    return out;
  }
}

export type { RGB };
