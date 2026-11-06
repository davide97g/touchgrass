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
import { COMMON_GLSL, terrainHeight } from './common';
import type { FeatureMap } from './Features';

const PATCH = 56;

const VERT = /* glsl */ `
${COMMON_GLSL}
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

void main() {
  vec2 rel = mod(aPos - cameraPosition.xz + 0.5 * uPatchSize, uPatchSize) - 0.5 * uPatchSize;
  vec2 base = cameraPosition.xz + rel;
  float dist = length(rel);

  // Flowers grow in drifts, not uniformly.
  float drift = nz(base / 70.0 + vec2(0.33, 0.66)).b;
  float show = step(1.0 - uDensity * 0.55, drift) * step(aRand.w, 0.35 + uDensity * 0.65);
  // Wildflowers gather along the shores; none grow in the water.
  vec4 feat = featAt(base);
  float shoreBloom = step(0.18, feat.g) * (1.0 - step(0.8, feat.g)) * step(aRand.w, 0.12 + uDensity * 0.4);
  show = max(show, shoreBloom) * (1.0 - step(0.25, feat.a));
  vShore = shoreBloom;
  float fade = 1.0 - smoothstep(uPatchSize * 0.38, uPatchSize * 0.5, dist);
  float h = uGrassHeight * mix(0.75, 1.15, aRand.x) * show * fade;

  float gust = gustAt(base);
  float sway = swayAt(base);
  vec2 bend = uWindDir * uWindStrength * (0.1 + 0.35 * sway + 0.8 * gust * uGustStrength);
  bend += uWindDir * uWindStrength * 0.08 * sin(uTime * 2.4 + aRand.y * 6.28);
  vec2 tuv = (base - uTrailCenter) / uTrailSize + 0.5;
  bend += textureLod(uTrailMap, tuv, 0.0).rg * 1.4;
  float A = clamp(length(bend), 0.0, 1.3);
  vec2 bdir = length(bend) > 1e-4 ? normalize(bend) : vec2(1.0, 0.0);

  float t = aCorner.z > 0.5 ? 1.0 : aCorner.y;
  float a = A * t;
  float along = A < 1e-3 ? 0.0 : h * (1.0 - cos(a)) / A;
  float up = A < 1e-3 ? h * t : h * sin(a) / A;
  vec3 p = vec3(base.x, terrainHeight(base), base.y) + vec3(bdir.x * along, up, bdir.y * along);

  if (aCorner.z > 0.5) {
    // Head: camera-facing billboard at the stem tip.
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 upv = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float s = mix(0.045, 0.075, aRand.z) * step(0.001, h);
    p += (right * aCorner.x + upv * (aCorner.y * 2.0 - 1.0)) * s;
    vUv = vec2(aCorner.x, aCorner.y * 2.0 - 1.0);
  } else {
    float theta = aRand.y * 6.2831;
    p += vec3(cos(theta), 0.0, sin(theta)) * aCorner.x * 0.006 * (1.0 - t * 0.5);
    vUv = vec2(0.0);
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
uniform vec3 uGrassMid;
uniform vec3 uGrassBase;
uniform vec3 uTint;
varying vec2 vUv;
varying float vPart;
varying float vT;
varying vec3 vWorldPos;
varying float vKind;
varying float vShore;

void main() {
  vec3 col;
  if (vPart > 0.5) {
    float r = length(vUv);
    // Petals flutter a little in the wind (visible up close in macro).
    float ang = atan(vUv.y, vUv.x) + sin(uTime * 2.3 + vKind * 40.0) * 0.07 * (0.4 + uWindStrength);
    float petals = vKind < 0.4 ? 5.0 : (vKind < 0.8 ? 6.0 : 8.0);
    float pa = ang * petals / 6.2831853;
    float pid = floor(pa + 0.5);
    float pf = pa - pid; // -0.5..0.5 across one petal
    float edge = 0.5 + 0.5 * sqrt(max(0.0, 1.0 - pf * pf * 4.0));
    edge *= 0.94 + 0.06 * fract(sin(pid * 12.9898 + vKind * 78.2) * 43758.5);
    float aa = fwidth(r) * 1.2;
    if (r > edge + aa * 0.5) discard;

    vec3 petal;
    float k = fract(vKind * 7.31);
    if (vShore > 0.5) petal = k < 0.6 ? vec3(0.55, 0.45, 0.92) : vec3(0.98, 0.86, 0.3); // iris-like by the water
    else if (k < 0.35) petal = vec3(0.97, 0.95, 0.9);
    else if (k < 0.65) petal = vec3(0.96, 0.62, 0.76);
    else if (k < 0.88) petal = vec3(0.98, 0.84, 0.3);
    else petal = vec3(0.78, 0.7, 0.95);
    petal = pow(petal, vec3(2.2));
    float rn = r / edge;
    petal *= 0.92 + 0.12 * fract(sin(pid * 3.7 + vKind * 11.0) * 9137.1); // each petal its own shade
    petal *= mix(0.82, 1.06, smoothstep(0.2, 0.9, rn));                   // deeper toward the heart
    petal *= 1.0 - smoothstep(0.035, 0.0, abs(pf)) * 0.12 * smoothstep(0.3, 0.6, rn); // central groove
    petal *= 1.0 - smoothstep(0.36, 0.5, abs(pf)) * 0.35;                  // shadowed gaps between petals

    // Domed, speckled centre.
    float cr = 0.24;
    vec2 cell = floor(vUv * 16.0);
    float h = fract(sin(dot(cell, vec2(127.1, 311.7)) + vKind * 17.0) * 43758.5);
    float dotm = step(0.55, h) * smoothstep(0.38, 0.22, length(fract(vUv * 16.0) - 0.5));
    vec3 centre = pow(mix(vec3(0.92, 0.6, 0.12), vec3(1.0, 0.86, 0.35), dotm), vec3(2.2));
    centre *= 0.65 + 0.35 * sqrt(max(0.0, 1.0 - (r / cr) * (r / cr)));
    col = mix(centre, petal, smoothstep(cr - 0.02, cr + 0.02, r));

    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 lightCol = uAmbient + uSunColor * 0.9 * max(uSunDir.y + 0.15, 0.0);
    col *= lightCol;
    // Backlit petals glow.
    float back = pow(max(dot(-V, uSunDir), 0.0), 2.0) * smoothstep(cr, 0.8, r);
    col += uSunColor * petal * back * 0.45;
  } else {
    col = mix(uGrassBase, uGrassMid, vT) * uTint;
    col *= uAmbient + uSunColor * 0.7 * max(uSunDir.y + 0.15, 0.0);
    col *= mix(0.4, 1.0, vT);
  }
  col *= cloudShadowAt(vWorldPos.xz);
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
    // Stem: 3 levels x 2 verts; head: 4 verts.
    const c: number[] = [];
    for (let i = 0; i < 3; i++) c.push(-1, i / 2, 0, 1, i / 2, 0);
    c.push(-1, 0, 1, 1, 0, 1, -1, 1, 1, 1, 1, 1);
    geo.setAttribute('aCorner', new BufferAttribute(new Float32Array(c), 3));
    // Three needs a position attribute for draw-range bookkeeping.
    geo.setAttribute('position', new BufferAttribute(new Float32Array(c.length), 3));
    geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 6, 7, 8, 7, 9, 8]);

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
      let show = drift >= 1 - density * 0.55 && w <= 0.35 + density * 0.65;
      const g = features.sample(x, z, 1);
      if (g >= 0.18 && g < 0.8 && w <= 0.12 + density * 0.4) show = true;
      if (features.sample(x, z, 3) >= 0.25) show = false;
      if (!show) continue;
      const score = d * (2 - cos);
      if (score < bestScore) {
        bestScore = score;
        const h = U.uGrassHeight.value * (0.75 + 0.4 * this.rnd[i * 4]);
        best = { x, y: terrainHeight(x, z) + h, z };
      }
    }
    return best;
  }

  set density(v: number) {
    this.mat.uniforms.uDensity.value = v;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
