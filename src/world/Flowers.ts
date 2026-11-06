import {
  BufferAttribute,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
} from 'three';
import { sampleNoise } from '../core/noise';
import { U } from '../core/uniforms';
import { COMMON_GLSL, NEAR_FADE_GLSL, terrainHeight } from './common';
import { CUP_GLSL, discGrid, FLOWER_HEAD_GLSL, SPECIES_SIZE_GLSL } from './flowerHeads';
import type { FeatureMap } from './Features';

const PATCH = 56;

const VERT = /* glsl */ `
${COMMON_GLSL}
${SPECIES_SIZE_GLSL}
${CUP_GLSL}
uniform float uPatchSize;
uniform float uDensity;
uniform float uGrassHeight;
uniform sampler2D uTrailMap;
uniform vec2 uTrailCenter;
uniform float uTrailSize;

attribute vec3 aCorner; // x: side/-1..1, y: t along stem, z: 0 stem / 1 head
attribute vec2 aPos;
attribute vec4 aRand;

varying vec2 vUv;
varying float vPart;
varying float vT;
varying vec3 vWorldPos;
varying float vKind;
varying float vShore;
varying float vSpecies;
varying vec3 vHeadN;

void main() {
  vec2 rel = mod(aPos - cameraPosition.xz + 0.5 * uPatchSize, uPatchSize) - 0.5 * uPatchSize;
  vec2 base = cameraPosition.xz + rel;
  float dist = length(rel);

  // Flowers grow in drifts, not uniformly.
  float drift = nz(base / 70.0 + vec2(0.33, 0.66)).b;
  float show = step(1.0 - uDensity * 0.55, drift) * step(aRand.w, 0.35 + uDensity * 0.65);
  show = max(show, step(aRand.w, 0.05 * uDensity)); // and a few loners everywhere
  // Wildflowers gather along the shores; none grow in the water.
  vec4 feat = featAt(base);
  float shoreBloom = step(0.18, feat.g) * (1.0 - step(0.8, feat.g)) * step(aRand.w, 0.12 + uDensity * 0.4);
  show = max(show, shoreBloom) * (1.0 - step(0.25, feat.a));
  if (uTree.w > 0.0) show *= step(1.3, length(base - uTree.xy) / uTree.w);
  vShore = shoreBloom;
  float fade = 1.0 - smoothstep(uPatchSize * 0.38, uPatchSize * 0.5, dist);
  float h = uGrassHeight * mix(1.12, 1.5, aRand.x) * show * fade; // blooms stand above the grass

  float gust = gustAt(base);
  float sway = swayAt(base);
  float wsC = min(uWindStrength, 1.1);
  float storm = smoothstep(1.0, 2.6, uWindStrength);
  vec2 bend = uWindDir * wsC * (0.1 + 0.35 * sway + 0.8 * gust * min(uGustStrength, 1.3));
  bend += uWindDir * wsC * 0.08 * sin(uTime * 2.4 + aRand.y * 6.28);
  if (storm > 0.0) {
    // Same rolling gale waves as the grass: stems whip down and bob back, swing sideways.
    float along = dot(base, uWindDir);
    float crest = 0.5 + 0.5 * sin(along * 0.38 - uTime * 7.0 + sin(dot(base, vec2(-uWindDir.y, uWindDir.x)) * 0.09 + uTime * 0.4) * 2.2);
    bend += uWindDir * storm * (0.6 * crest * crest + 0.12 * sin(uTime * 9.0 + aRand.y * 20.0) - 0.2);
    bend += vec2(-uWindDir.y, uWindDir.x) * storm * 0.25 * sin(uTime * 3.1 + aRand.y * 6.28);
  }
  vec2 tuv = (base - uTrailCenter) / uTrailSize + 0.5;
  bend += textureLod(uTrailMap, tuv, 0.0).rg * 1.4;
  float A = clamp(length(bend), 0.0, 1.3);
  vec2 bdir = length(bend) > 1e-4 ? normalize(bend) : vec2(1.0, 0.0);

  float t = aCorner.z > 0.5 ? 1.0 : aCorner.y;
  float a = A * t;
  float along = A < 1e-3 ? 0.0 : h * (1.0 - cos(a)) / A;
  float up = A < 1e-3 ? h * t : h * sin(a) / A;
  vec3 p = vec3(base.x, terrainHeight(base), base.y) + vec3(bdir.x * along, up, bdir.y * along);

  // Species grow in patches (one dominant kind per patch, a few strays); the shores have their own.
  vec2 pc = floor(base / 9.0 + (nz(base / 37.0 + 0.4).rg - 0.5) * 2.5);
  float patchSp = floor(fract(sin(dot(pc, vec2(41.3, 289.1))) * 15731.7) * 8.0);
  float stray = floor(fract(aRand.z * 53.17) * 8.0);
  float msp = fract(aRand.z * 7.31) < 0.72 ? patchSp : stray;
  // Meadow kinds: daisy, buttercup, poppy, cornflower, cosmos, dandelion, pansy, clover.
  float meadow = msp < 4.5 ? msp : (msp < 5.5 ? 6.0 : (msp < 6.5 ? 7.0 : 9.0));
  float k = fract(aRand.z * 7.31);
  float shoreSp = k < 0.55 ? 8.0 : (k < 0.82 ? 5.0 : 1.0);
  vSpecies = shoreBloom > 0.5 ? shoreSp : meadow;

  if (aCorner.z > 0.5) {
    // Head: a real cup facing the sky. It follows the stem as it bends and nods in the wind,
    // leans a little its own way and a little toward the sun; we see it foreshortened, not face-on.
    vec2 stemDir = bdir * sin(A);
    vec3 n = vec3(stemDir.x, cos(A), stemDir.y);
    float tilt = speciesTilt(vSpecies) * (0.5 + 0.5 * fract(aRand.y * 23.1));
    float az = aRand.y * 6.2831;
    // Most blooms turn toward the sun; each keeps some of its own lean.
    vec2 sunH = normalize(uSunDir.xz + vec2(1e-4)) * step(0.0, uSunDir.y);
    vec2 own = vec2(cos(az), sin(az));
    vec2 lean2 = normalize(mix(own, sunH, 0.45) + vec2(1e-4)) * tilt;
    vec3 lean = vec3(lean2.x, 0.0, lean2.y);
    float nod = sin(uTime * (1.3 + aRand.x) + aRand.y * 30.0) * 0.06 * (0.3 + uWindStrength) + gust * uGustStrength * uWindStrength * 0.25;
    lean += vec3(uWindDir.x, 0.0, uWindDir.y) * nod;
    n = normalize(n + lean);
    vec3 ref = vec3(cos(az * 3.1), 0.0, sin(az * 3.1));
    vec3 right = normalize(ref - n * dot(ref, n) + vec3(1e-4, 0.0, 0.0));
    vec3 fw = cross(n, right);
    float s = speciesSize(vSpecies) * mix(0.85, 1.15, fract(aRand.z * 13.7)) * step(0.001, h);
    vec2 q = aCorner.xy;
    p += (right * q.x + fw * q.y) * s + n * (cupZ(vSpecies, q) + 0.04) * s;
    vUv = q;
    vHeadN = n;
  } else {
    float theta = aRand.y * 6.2831;
    p += vec3(cos(theta), 0.0, sin(theta)) * aCorner.x * 0.006 * (1.0 - t * 0.5);
    vUv = vec2(0.0);
    vHeadN = vec3(0.0, 1.0, 0.0);
  }

  vPart = aCorner.z;
  vT = t;
  vWorldPos = p;
  vKind = aRand.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
${COMMON_GLSL}
${NEAR_FADE_GLSL}
${FLOWER_HEAD_GLSL}
uniform vec3 uGrassMid;
uniform vec3 uGrassBase;
uniform vec3 uTint;
varying vec2 vUv;
varying float vPart;
varying float vT;
varying vec3 vWorldPos;
varying float vKind;
varying float vShore;
varying float vSpecies;
varying vec3 vHeadN;

void main() {
  nearFade(vWorldPos);
  vec3 col;
  if (vPart > 0.5) {
    // Petals flutter a touch in the wind.
    float wob = sin(uTime * 2.3 + vKind * 40.0) * 0.05 * (0.4 + uWindStrength);
    vec2 q = mat2(cos(wob), -sin(wob), sin(wob), cos(wob)) * vUv;
    float aa = max(fwidth(length(q)) * 1.2, 0.002);
    float sp = floor(vSpecies + 0.5);
    Bloom b = flowerHead(q, sp, fract(vKind * 97.13), aa);
    if (b.a < 0.5) discard;
    bool front = dot(cameraPosition - vWorldPos, vHeadN) > 0.0;
    if (!front) b = backOf(b, q, sp);
    col = shadeBloom(b, vWorldPos, front ? vHeadN : -vHeadN, uSunDir, uSunColor, uAmbient);
  } else {
    col = mix(uGrassBase, uGrassMid, vT) * uTint;
    col *= uAmbient + uSunColor * 0.7 * max(uSunDir.y + 0.15, 0.0);
    col *= mix(0.4, 1.0, vT);
  }
  col *= cloudShadowAt(vWorldPos.xz) * treeShadeAt(vWorldPos);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Flowers {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly rnd: Float32Array;

  constructor(count: number) {
    const geo = new InstancedBufferGeometry();
    // Stem: 3 levels x 2 verts; head: a subdivided disc the shader bends into a cup.
    const c: number[] = [];
    for (let i = 0; i < 3; i++) c.push(-1, i / 2, 0, 1, i / 2, 0);
    const disc = discGrid();
    for (let i = 0; i < disc.xy.length; i += 2) c.push(disc.xy[i], disc.xy[i + 1], 1);
    geo.setAttribute('aCorner', new BufferAttribute(new Float32Array(c), 3));
    // Three needs a position attribute for draw-range bookkeeping.
    geo.setAttribute('position', new BufferAttribute(new Float32Array(c.length), 3));
    geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, ...disc.index.map((i) => i + 6)]);

    const pos = new Float32Array(count * 2);
    const rnd = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos[i * 2] = Math.random() * PATCH;
      pos[i * 2 + 1] = Math.random() * PATCH;
      for (let k = 0; k < 4; k++) rnd[i * 4 + k] = Math.random();
    }
    this.pos = pos;
    this.rnd = rnd;
    geo.setAttribute('aPos', new InstancedBufferAttribute(pos, 2));
    geo.setAttribute('aRand', new InstancedBufferAttribute(rnd, 4));
    geo.instanceCount = count;

    this.mat = new ShaderMaterial({
      uniforms: { ...U, uPatchSize: { value: PATCH }, uDensity: { value: 0.6 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: DoubleSide,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
  }

  /**
   * CPU replica of the shader's placement rules: the nearest visible flower head
   * in front of the camera, for the macro lens to frame.
   */
  findTarget(
    cx: number,
    cz: number,
    yaw: number,
    features: FeatureMap,
    minD = 1.4,
    maxD = 8,
  ): { x: number; y: number; z: number } | null {
    if (!this.mesh.visible) return null;
    const density = this.mat.uniforms.uDensity.value as number;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let best: { x: number; y: number; z: number } | null = null;
    let bestScore = Infinity;
    const P = PATCH;
    for (let i = 0; i < this.rnd.length / 4; i++) {
      const rx = ((((this.pos[i * 2] - cx + P / 2) % P) + P) % P) - P / 2;
      const rz = ((((this.pos[i * 2 + 1] - cz + P / 2) % P) + P) % P) - P / 2;
      const d = Math.hypot(rx, rz);
      if (d < minD || d > maxD) continue;
      const cos = (rx * fx + rz * fz) / d;
      if (cos < 0.75) continue;
      const x = cx + rx;
      const z = cz + rz;
      const w = this.rnd[i * 4 + 3];
      const drift = sampleNoise(x / 70 + 0.33, z / 70 + 0.66, 2);
      let show = (drift >= 1 - density * 0.55 && w <= 0.35 + density * 0.65) || w <= 0.05 * density;
      const g = features.sample(x, z, 1);
      if (g >= 0.18 && g < 0.8 && w <= 0.12 + density * 0.4) show = true;
      if (features.sample(x, z, 3) >= 0.25) show = false;
      if (!show) continue;
      const score = d * (2 - cos);
      if (score < bestScore) {
        bestScore = score;
        const h = U.uGrassHeight.value * (1.12 + 0.38 * this.rnd[i * 4]);
        best = { x, y: terrainHeight(x, z) + h, z };
      }
    }
    return best;
  }

  /** Every visible flower head within a ring and view cone (trailer framing). */
  listNear(
    cx: number,
    cz: number,
    yaw: number,
    features: FeatureMap,
    minD: number,
    maxD: number,
    minCos: number,
  ): { x: number; y: number; z: number; d: number; side: number }[] {
    const out: { x: number; y: number; z: number; d: number; side: number }[] = [];
    if (!this.mesh.visible) return out;
    const density = this.mat.uniforms.uDensity.value as number;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const P = PATCH;
    for (let i = 0; i < this.rnd.length / 4; i++) {
      const rx = ((((this.pos[i * 2] - cx + P / 2) % P) + P) % P) - P / 2;
      const rz = ((((this.pos[i * 2 + 1] - cz + P / 2) % P) + P) % P) - P / 2;
      const d = Math.hypot(rx, rz);
      if (d < minD || d > maxD) continue;
      const cos = (rx * fx + rz * fz) / d;
      if (cos < minCos) continue;
      const x = cx + rx;
      const z = cz + rz;
      const w = this.rnd[i * 4 + 3];
      const drift = sampleNoise(x / 70 + 0.33, z / 70 + 0.66, 2);
      let show = (drift >= 1 - density * 0.55 && w <= 0.35 + density * 0.65) || w <= 0.05 * density;
      const g = features.sample(x, z, 1);
      if (g >= 0.18 && g < 0.8 && w <= 0.12 + density * 0.4) show = true;
      if (features.sample(x, z, 3) >= 0.25) show = false;
      if (!show) continue;
      const h = U.uGrassHeight.value * (1.12 + 0.38 * this.rnd[i * 4]);
      out.push({ x, y: terrainHeight(x, z) + h, z, d, side: rx * -fz + rz * fx });
    }
    return out;
  }

  set density(v: number) {
    this.mat.uniforms.uDensity.value = v;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
