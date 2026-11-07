import {
  BufferAttribute,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector4,
} from 'three';
import { U } from '../core/uniforms';
import { COMMON_GLSL, NEAR_FADE_GLSL } from './common';

export interface GrassLayerConfig {
  /** Side of the square patch that wraps around the camera (m). */
  size: number;
  /** Blades per square metre. */
  density: number;
  /** Vertical segments per blade. */
  segments: number;
  /** Width multiplier (far blades are wider to cover more ground). */
  widthScale: number;
  /** Distance fade: [inStart, inEnd, outStart, outEnd]. */
  fade: [number, number, number, number];
}

const VERT = /* glsl */ `
${COMMON_GLSL}
uniform float uPatchSize;
uniform vec4 uFade;
uniform float uLodWidth;
uniform float uGrassHeight;
uniform float uGrassHeightVar;
uniform float uGrassWidth;
uniform float uStiffness;
uniform sampler2D uTrailMap;
uniform vec2 uTrailCenter;
uniform float uTrailSize;

attribute vec2 aPos;
attribute vec4 aRand;

varying float vT;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vGust;
varying float vVar;
varying float vPatch;
varying float vCrop;
varying float vCropKind;
varying float vAlpine;

vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

void main() {
  float t = position.y;
  float side = position.x;

  // Wrap the patch around the camera: each blade stays fixed in world space.
  vec2 rel = mod(aPos - cameraPosition.xz + 0.5 * uPatchSize, uPatchSize) - 0.5 * uPatchSize;
  vec2 base = cameraPosition.xz + rel;
  float dist = length(rel);

  // Re-randomise per tile so repetition is invisible.
  vec2 tile = floor(base / uPatchSize);
  vec4 r = fract(aRand + vec4(hash22(tile), hash22(tile + 17.0)));

  vAlpine = 0.0;
  float clump = nz(base / 40.0).a;
  float h = uGrassHeight * (1.0 + (r.x - 0.5) * 2.0 * uGrassHeightVar) * mix(0.6, 1.25, clump);
  float fade = smoothstep(uFade.x, uFade.y, dist) * (1.0 - smoothstep(uFade.z, uFade.w, dist));
  vec4 feat = featAt(base);
  // No grass in the water; short, sparse grass on the shores.
  float shore = smoothstep(0.25, 1.0, feat.g) * (0.6 + 0.4 * step(0.5, r.w));
  fade *= (1.0 - smoothstep(0.2, 0.5, feat.a)) * (1.0 - shore * 0.8);
  // Roads, plazas and buildings: none under walls, short and sparse along the verges.
  vec4 rl = realmAt(base);
  fade *= 1.0 - smoothstep(0.35, 0.75, rl.g + (r.w - 0.5) * 0.35);
  fade *= 1.0 - smoothstep(0.05, 0.35, rl.b);
  h *= mix(1.0, 0.4, smoothstep(0.02, 0.45, rl.g));
  // Crop fields: blades in neat rows, recoloured (wheat, greens, lavender).
  vCrop = smoothstep(1.6, 1.9, rl.a) * (1.0 - smoothstep(0.02, 0.1, rl.g));
  vCropKind = rl.a;
  if (vCrop > 0.0) {
    float row = abs(fract(base.x / 1.1) - 0.5);
    fade *= mix(1.0, smoothstep(0.34, 0.2, row), vCrop);
    h *= mix(1.0, rl.a < 2.5 ? 1.35 : rl.a < 3.5 ? 0.75 : 0.95, vCrop);
  }
  if (uTree.w > 0.0) {
    float td = length(base - uTree.xy) / uTree.w;
    fade *= smoothstep(0.5, 0.75, td);
    h *= mix(0.55, 1.0, smoothstep(0.8, 2.2, td));
  }
  h *= fade;

  float w = uGrassWidth * mix(0.7, 1.3, r.y) * uLodWidth;
  float ground = terrainHeight(base);
  // Thin out on the high slopes.
  float alpine = smoothstep(110.0, 220.0, ground + (r.x - 0.5) * 40.0);
  h *= 1.0 - alpine * 0.55;
  vAlpine = alpine;
  // No blades on bare rock or under snow (same masks as the terrain paint).
  float mmk = mountainMask(base);
  if (mmk > 0.0) {
    float e = 1.5;
    float gx = terrainHeight(base + vec2(e, 0.0)) - ground;
    float gz = terrainHeight(base + vec2(0.0, e)) - ground;
    float ny = e / length(vec3(gx, e, gz));
    float bare = max(alpineRock(base, ny), alpineSnow(base, ground, ny)) * smoothstep(0.0, 0.15, mmk);
    float keep = 1.0 - smoothstep(0.35 + r.w * 0.3, 0.7 + r.w * 0.25, bare);
    h *= keep;
  }

  float theta = r.z * 6.2831853;
  vec2 facing = vec2(cos(theta), sin(theta));
  vec2 leanDir = vec2(-facing.y, facing.x) * (r.w > 0.5 ? 1.0 : -1.0);

  // --- Bend: rest lean + wind (sway, gusts, flutter) + trail push ---
  vec2 bend = leanDir * (0.12 + 0.3 * r.w);
  float gust = gustAt(base);
  float sway = swayAt(base);
  float ws = uWindStrength;
  // The steady push saturates; past a breeze the extra energy goes into motion, not into lying flat.
  float wsC = min(ws, 1.1);
  float gs = min(uGustStrength, 1.3);
  float storm = smoothstep(1.0, 2.6, ws);
  float phase = dot(base, uWindDir) * 0.55;
  float flutter = sin(uTime * (2.8 + r.y * 2.2 + storm * 4.0) + r.x * 6.2831 - phase);
  float spring = sin(uTime * 1.7 + r.z * 3.0 - phase * 0.4);
  float windAmt = wsC * (0.12 + 0.42 * sway + 0.95 * gust * gs);
  windAmt += wsC * (0.1 * flutter * (0.35 + gust) + 0.12 * spring * gust * gs);
  vec2 perp = vec2(-uWindDir.y, uWindDir.x);
  float sideBend = 0.05 * flutter * wsC;
  if (storm > 0.0) {
    // Gale: fast rolling waves race downwind; blades whip low in each crest and spring back past
    // upright in the trough, swing sideways and shiver at the tips (like tall grass and wheat in a storm).
    float along = dot(base, uWindDir);
    float across = dot(base, perp);
    float w1 = sin(along * 0.38 - uTime * 7.0 + sin(across * 0.09 + uTime * 0.4) * 2.2);
    float w2 = sin(along * 1.25 - uTime * 10.5 + across * 0.35 + r.x * 2.5);
    float crest = 0.5 + 0.5 * w1;
    windAmt += storm * (0.75 * crest * crest * (0.7 + 0.6 * gust) + 0.16 * w2 - 0.3);
    sideBend += storm * (0.32 * sin(uTime * 2.9 + along * 0.21 + r.y * 6.28) + 0.14 * w2 + 0.1 * flutter);
  }
  bend += uWindDir * windAmt + perp * sideBend;
  bend /= uStiffness;

  vec2 tuv = (base - uTrailCenter) / uTrailSize + 0.5;
  float edge = smoothstep(0.0, 0.08, tuv.x) * smoothstep(1.0, 0.92, tuv.x)
             * smoothstep(0.0, 0.08, tuv.y) * smoothstep(1.0, 0.92, tuv.y);
  vec2 push = textureLod(uTrailMap, tuv, 0.0).rg * edge;
  bend += push * 1.7;

  float bl = length(bend);
  float A = clamp(bl, 0.0, 1.45);
  vec2 bdir = bl > 1e-4 ? bend / bl : vec2(1.0, 0.0);

  // Constant-length circular arc: angle grows linearly up the blade.
  float a = A * t;
  float along, up;
  if (A < 1e-3) { along = 0.0; up = h * t; }
  else { along = h * (1.0 - cos(a)) / A; up = h * sin(a) / A; }

  float width = w * (1.0 - t) * (1.0 + 0.35 * t);
  vec3 wAxis = vec3(facing.x, 0.0, facing.y);
  vec3 pos = vec3(base.x, ground, base.y)
           + vec3(bdir.x * along, up, bdir.y * along)
           + wAxis * side * width;

  vec3 tangent = vec3(bdir.x * sin(a), cos(a), bdir.y * sin(a));
  vec3 n = normalize(cross(wAxis, tangent));
  n = normalize(n + wAxis * side * 0.55);

  vT = t;
  vNormal = n;
  vWorldPos = pos;
  vGust = gust * ws * uGustStrength;
  vVar = r.y;
  vPatch = smoothstep(0.55, 0.85, nz(base / 150.0 + vec2(0.2, 0.9)).b);

  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

const FRAG = /* glsl */ `
${COMMON_GLSL}
${NEAR_FADE_GLSL}
uniform float uFarLod;
uniform vec3 uGrassBase;
uniform vec3 uGrassMid;
uniform vec3 uGrassTip;
uniform vec3 uTint;

varying float vT;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vGust;
varying float vVar;
varying float vPatch;
varying float vCrop;
varying float vCropKind;
varying float vAlpine;

void main() {
  nearFade(vWorldPos);
  // Far blades are seen mostly by their sunlit upper halves.
  float t = mix(vT, 0.35 + 0.65 * vT, uFarLod);
  vec3 col = mix(uGrassBase, uGrassMid, smoothstep(0.0, 0.45, t));
  col = mix(col, uGrassTip, smoothstep(0.38, 1.0, t));
  col *= mix(0.82, 1.12, vVar);
  col = mix(col, col * vec3(1.18, 1.06, 0.62), vPatch * 0.55);
  // High pasture: tougher, drier, sun-bleached blades.
  col = mix(col, dot(col, vec3(0.3, 0.55, 0.15)) * vec3(1.05, 0.95, 0.62) * 0.95, vAlpine * 0.6);
  if (vCrop > 0.0) {
    vec3 cb, cm, ct;
    if (vCropKind < 2.5) { cb = vec3(0.28, 0.2, 0.06); cm = vec3(0.72, 0.5, 0.14); ct = vec3(0.98, 0.82, 0.42); }
    else if (vCropKind < 3.5) { cb = vec3(0.04, 0.16, 0.03); cm = vec3(0.16, 0.42, 0.08); ct = vec3(0.5, 0.75, 0.18); }
    else { cb = vec3(0.06, 0.12, 0.06); cm = vec3(0.22, 0.3, 0.18); ct = vec3(0.42, 0.26, 0.85); }
    vec3 cc = mix(cb, cm, smoothstep(0.0, 0.5, t));
    cc = mix(cc, ct, smoothstep(vCropKind > 3.5 ? 0.62 : 0.4, 1.0, t)) * mix(0.85, 1.1, vVar);
    col = mix(col, cc, vCrop);
  }
  col *= uTint;

  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = uSunDir;

  // Soft two-band toon light.
  float ndl = dot(N, L);
  float diff = smoothstep(-0.25, 0.55, ndl);
  vec3 light = uAmbient + uSunColor * (0.35 + 0.65 * diff) * max(L.y + 0.15, 0.0) * 1.15;
  col *= light;

  // Backlit translucency: tips glow when looking toward the sun.
  float back = pow(clamp(dot(-V, L), 0.0, 1.0), 3.0) * smoothstep(0.2, 1.0, vT);
  col += uSunColor * uGrassTip * uTint * back * 0.55;

  // Gust sheen: blades bending over flash their light side (the anime "wave").
  col += vGust * smoothstep(0.25, 1.0, vT) * uSunColor * uTint * vec3(0.22, 0.26, 0.09);

  col *= cloudShadowAt(vWorldPos.xz) * treeShadeAt(vWorldPos) * sunShadow(vWorldPos);
  col *= mix(0.32, 1.0, smoothstep(0.0, 0.55, t));

  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function bladeGeometry(segments: number): InstancedBufferGeometry {
  const geo = new InstancedBufferGeometry();
  const verts: number[] = [];
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    verts.push(-1, t, 0, 1, t, 0);
  }
  verts.push(0, 1, 0);
  const idx: number[] = [];
  for (let i = 0; i < segments - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segments - 1) * 2;
  idx.push(last, last + 1, last + 2);
  geo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  geo.setIndex(idx);
  return geo;
}

function makeLayer(cfg: GrassLayerConfig): Mesh {
  const geo = bladeGeometry(cfg.segments);
  const n = Math.max(1, Math.round(Math.sqrt(cfg.size * cfg.size * cfg.density)));
  const count = n * n;
  const cell = cfg.size / n;
  const pos = new Float32Array(count * 2);
  const rnd = new Float32Array(count * 4);
  let k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      pos[k * 2] = (i + Math.random()) * cell;
      pos[k * 2 + 1] = (j + Math.random()) * cell;
      for (let c = 0; c < 4; c++) rnd[k * 4 + c] = Math.random();
      k++;
    }
  }
  geo.setAttribute('aPos', new InstancedBufferAttribute(pos, 2));
  geo.setAttribute('aRand', new InstancedBufferAttribute(rnd, 4));
  geo.instanceCount = count;

  const mat = new ShaderMaterial({
    uniforms: {
      ...U,
      uPatchSize: { value: cfg.size },
      uFade: { value: new Vector4(...cfg.fade) },
      uLodWidth: { value: cfg.widthScale },
      uFarLod: { value: cfg.widthScale > 1.2 ? 1 : 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: DoubleSide,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

export class Grass {
  readonly group = new Group();
  bladeCount = 0;

  build(layers: GrassLayerConfig[]): void {
    this.dispose();
    this.bladeCount = 0;
    for (const cfg of layers) {
      const m = makeLayer(cfg);
      this.bladeCount += (m.geometry as InstancedBufferGeometry).instanceCount;
      this.group.add(m);
    }
  }

  dispose(): void {
    for (const child of [...this.group.children]) {
      const m = child as Mesh;
      m.geometry.dispose();
      (m.material as ShaderMaterial).dispose();
      this.group.remove(m);
    }
  }
}
