import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LinearFilter,
  NormalBlending,
  Mesh,
  type PerspectiveCamera,
  PlaneGeometry,
  Points,
  SRGBColorSpace,
  ShaderMaterial,
  Vector3,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { U } from '../core/uniforms';
import { COMMON_GLSL, NEAR_FADE_GLSL, terrainHeight } from '../world/common';
import { CUP_GLSL, discGrid, FLOWER_HEAD_GLSL } from '../world/flowerHeads';

const OUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

// ---------------------------------------------------------------- glowing points

const GLOW_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
uniform float uViewH;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // True world size, so a long lens magnifies them like everything else.
  float px = aSize * projectionMatrix[1][1] * 0.5 * uViewH / max(-mv.z, 0.01);
  float s = clamp(px, 1.5, 320.0);
  gl_PointSize = s;
  vColor = aColor * min(1.0, (px * px) / (s * s) + 0.15);
}
`;

const GLOW_FRAG = /* glsl */ `
uniform float uDepthOnly;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = exp(-d * d * 30.0);
  float halo = exp(-d * d * 5.0) * 0.3 * (1.0 - smoothstep(0.75, 1.0, d));
  float a = core + halo;
  if (uDepthOnly > 0.5) {
    if (core < 0.35) discard;
    gl_FragColor = vec4(0.0);
    return;
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a, a);
  ${OUT}
}
`;

/**
 * CPU-driven glowing points (fireflies, sparks). A depth-only pass writes their cores,
 * so the depth of field focuses on them instead of on the grass behind.
 */
export class GlowPoints {
  readonly group = new Group();
  readonly pos: Float32Array;
  readonly col: Float32Array;
  readonly size: Float32Array;
  count = 0;
  private readonly geo = new BufferGeometry();
  private readonly mats: ShaderMaterial[] = [];

  constructor(
    readonly capacity: number,
    depthPrepass = true,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new BufferAttribute(this.size, 1));
    const mk = (depthOnly: boolean) =>
      new ShaderMaterial({
        uniforms: { uViewH: { value: 1080 }, uDepthOnly: { value: depthOnly ? 1 : 0 } },
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: !depthOnly,
        depthWrite: depthOnly,
        colorWrite: !depthOnly,
        blending: depthOnly ? NormalBlending : AdditiveBlending,
      });
    const depth = new Points(this.geo, mk(true));
    const glow = new Points(this.geo, mk(false));
    this.mats.push(depth.material as ShaderMaterial, glow.material as ShaderMaterial);
    depth.visible = depthPrepass;
    depth.renderOrder = 12;
    glow.renderOrder = 13;
    depth.frustumCulled = glow.frustumCulled = false;
    this.group.add(depth, glow);
  }

  set(i: number, p: Vector3, c: Color, intensity: number, size: number): void {
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.col[i * 3] = c.r * intensity;
    this.col[i * 3 + 1] = c.g * intensity;
    this.col[i * 3 + 2] = c.b * intensity;
    this.size[i] = size;
  }

  commit(viewH: number): void {
    this.geo.setDrawRange(0, this.count);
    for (const k of ['position', 'aColor', 'aSize']) this.geo.getAttribute(k).needsUpdate = true;
    for (const m of this.mats) m.uniforms.uViewH.value = viewH;
  }
}

/** Short-lived drifting sparks (magic motes over the flower, the runes, the vortex). */
export class Sparks {
  readonly points: GlowPoints;
  private readonly p: { pos: Vector3; vel: Vector3; life: number; age: number; col: Color; size: number }[] = [];

  constructor(cap = 500) {
    this.points = new GlowPoints(cap);
  }

  emit(at: Vector3, n: number, spread: number, col: Color, speed = 0.4, life = 2.5, size = 0.025): void {
    for (let i = 0; i < n && this.p.length < this.points.capacity; i++) {
      const dir = new Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize();
      this.p.push({
        pos: at.clone().add(new Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread * 0.6, (Math.random() - 0.5) * spread)),
        vel: dir.multiplyScalar(speed * (0.4 + Math.random())),
        life: life * (0.6 + Math.random() * 0.8),
        age: 0,
        col: col.clone().offsetHSL((Math.random() - 0.5) * 0.06, 0, 0),
        size: size * (0.6 + Math.random() * 0.8),
      });
    }
  }

  update(dt: number, time: number, viewH: number): void {
    let n = 0;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const s = this.p[i];
      s.age += dt;
      if (s.age >= s.life) {
        this.p.splice(i, 1);
        continue;
      }
      s.vel.x += Math.sin(time * 1.7 + i) * 0.05 * dt;
      s.vel.z += Math.cos(time * 1.3 + i * 1.7) * 0.05 * dt;
      s.vel.multiplyScalar(1 - dt * 0.4);
      s.pos.addScaledVector(s.vel, dt);
    }
    for (const s of this.p) {
      const k = s.age / s.life;
      const a = Math.min(1, k * 4) * (1 - k) * (0.85 + 0.15 * Math.sin(time * 2.2 + s.size * 900));
      this.points.set(n++, s.pos, s.col, a * 2.2, s.size);
    }
    this.points.count = n;
    this.points.commit(viewH);
  }
}

// ---------------------------------------------------------------- a single blade of grass

const BLADE_VERT = /* glsl */ `
attribute float aT;
varying float vT;
varying vec3 vWorldPos;
void main() {
  vT = aT;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BLADE_FRAG = /* glsl */ `
${COMMON_GLSL}
${NEAR_FADE_GLSL}
uniform vec3 uGrassBase;
uniform vec3 uGrassMid;
uniform vec3 uGrassTip;
uniform vec3 uTint;
uniform vec3 uGlowPos;
uniform vec3 uGlowCol;
uniform float uGlow;
varying float vT;
varying vec3 vWorldPos;
void main() {
  nearFade(vWorldPos);
  vec3 col = mix(uGrassBase, uGrassMid, smoothstep(0.0, 0.55, vT));
  col = mix(col, uGrassTip, smoothstep(0.5, 1.0, vT)) * uTint;
  col *= uAmbient * 1.1 + uSunColor * 0.6 * max(uSunDir.y + 0.15, 0.0);
  col *= mix(0.45, 1.0, vT);
  float d = distance(vWorldPos, uGlowPos);
  col += uGlowCol * uGlow * 0.004 / (d * d + 0.003);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}
`;

/** One hero blade with a known tip, so a firefly can sit right on it. */
export class HeroBlade {
  readonly mesh: Mesh;
  readonly tip = new Vector3();
  private readonly geo = new BufferGeometry();
  private readonly pos: Float32Array;
  private readonly mat: ShaderMaterial;
  private static readonly SEG = 12;

  constructor(
    readonly base: Vector3,
    readonly height = 0.72,
    readonly lean = new Vector3(0.3, 0, 0.1),
    readonly width = 0.016,
  ) {
    const n = HeroBlade.SEG;
    this.pos = new Float32Array((n + 1) * 2 * 3);
    const t = new Float32Array((n + 1) * 2);
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      t[i * 2] = t[i * 2 + 1] = i / n;
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aT', new BufferAttribute(t, 1));
    this.geo.setIndex(idx);
    this.mat = new ShaderMaterial({
      uniforms: { ...U, uGlowPos: { value: new Vector3() }, uGlowCol: { value: new Color(0.78, 1, 0.4) }, uGlow: { value: 0 } },
      vertexShader: BLADE_VERT,
      fragmentShader: BLADE_FRAG,
      side: DoubleSide,
    });
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.update(0, null, 0);
  }

  update(time: number, camera: PerspectiveCamera | null, glow: number): void {
    const n = HeroBlade.SEG;
    const sway = 0.05 * Math.sin(time * 1.1) + 0.03 * Math.sin(time * 2.3 + 1);
    const lean = this.lean.clone();
    lean.x += sway * U.uWindDir.value.x * (0.4 + U.uWindStrength.value);
    lean.z += sway * U.uWindDir.value.y * (0.4 + U.uWindStrength.value);
    const A = Math.min(1.2, lean.length() * 1.6);
    const dir = lean.lengthSq() > 1e-6 ? lean.clone().normalize() : new Vector3(1, 0, 0);
    // Width axis: perpendicular to the bend, turned a little toward the camera.
    const side = new Vector3(-dir.z, 0, dir.x);
    if (camera) {
      const toCam = camera.position.clone().sub(this.base).setY(0).normalize();
      side.lerp(new Vector3(-toCam.z, 0, toCam.x), 0.6).normalize();
    }
    const p = new Vector3();
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = A * t;
      const along = A < 1e-3 ? 0 : (this.height * (1 - Math.cos(a))) / A;
      const up = A < 1e-3 ? this.height * t : (this.height * Math.sin(a)) / A;
      p.copy(this.base).addScaledVector(dir, along).setY(this.base.y + up);
      const w = this.width * (1 - t * 0.92) * 0.5;
      this.pos.set([p.x - side.x * w, p.y, p.z - side.z * w, p.x + side.x * w, p.y, p.z + side.z * w], i * 6);
      if (i === n) this.tip.copy(p);
    }
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.computeBoundingSphere();
    this.mat.uniforms.uGlowPos.value.copy(this.tip).y += 0.012;
    this.mat.uniforms.uGlow.value = glow;
  }
}

// ---------------------------------------------------------------- the glowing flower

const FLOWER_FRAG = /* glsl */ `
${COMMON_GLSL}
${NEAR_FADE_GLSL}
${FLOWER_HEAD_GLSL}
uniform float uGlow;
uniform float uSpecies;
uniform float uRnd;
uniform float uIri;
uniform vec3 uNormal;
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  nearFade(vWorldPos);
  float wob = sin(uTime * 1.9 + uRnd * 30.0) * 0.04 * (0.4 + uWindStrength);
  vec2 q = mat2(cos(wob), -sin(wob), sin(wob), cos(wob)) * (vUv * 2.0 - 1.0);
  float aa = max(fwidth(length(q)) * 1.2, 0.002);
  Bloom b = flowerHead(q, uSpecies, uRnd, aa);
  if (b.a < 0.5) discard;
  bool front = dot(cameraPosition - vWorldPos, uNormal) > 0.0;
  if (!front) b = backOf(b, q, uSpecies);
  if (uIri > 0.0) {
    // Enchanted: petals shift rose -> violet -> cyan, the heart turns gold.
    float r = length(q);
    float ang = atan(q.y, q.x);
    vec3 iri = mix(vec3(0.66, 0.45, 1.0), vec3(1.0, 0.5, 0.78), smoothstep(0.3, 0.95, r));
    iri = mix(iri, vec3(0.55, 0.95, 1.0), smoothstep(0.8, 1.0, r) * (0.5 + 0.5 * sin(uTime * 2.0 + ang * 3.0)) * 0.4);
    float lum = dot(b.col, vec3(0.3, 0.59, 0.11));
    b.col = mix(b.col, iri * (0.75 + 0.35 * lum), uIri * b.petal);
    b.col = mix(b.col, vec3(1.0, 0.85, 0.4), uIri * (1.0 - b.petal) * 0.6);
  }
  vec3 col = shadeBloom(b, vWorldPos, uNormal, uSunDir, uSunColor, uAmbient);
  float r = length(q);
  col += pow(b.col, vec3(2.2)) * (0.6 + 2.4 * (1.0 - r)) * uGlow * 2.2;
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}
`;

const FLOWER_VERT = /* glsl */ `
${CUP_GLSL}
uniform float uSpecies;
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  // position.xy is the head disc in head units; bend it into this species' cup.
  vec2 q = position.xy;
  vUv = q * 0.5 + 0.5;
  vec4 wp = modelMatrix * vec4(q, cupZ(uSpecies, q) + 0.04, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** A small flower that glows, with a stem and a halo; its head always turns to the viewer. */
export class GlowFlower {
  readonly group = new Group();
  readonly head: Mesh;
  readonly headPos: Vector3;
  readonly color = new Color(1.0, 0.55, 0.9);
  private readonly stem: HeroBlade;
  private readonly mat: ShaderMaterial;
  readonly halo = new GlowPoints(1, false);

  private readonly size: number;
  private lean: Vector3 | null = null;
  /** How far the bloom leans toward the first viewer (0 = straight up). */
  leanAmt = 0.5;

  constructor(base: Vector3, height = 0.62, size = 0.085, species = 4, iri = 1, rnd = Math.random()) {
    this.size = size;
    this.stem = new HeroBlade(base, height, new Vector3(0.05, 0, 0.04), 0.008);
    this.headPos = this.stem.tip.clone();
    this.mat = new ShaderMaterial({
      uniforms: {
        ...U,
        uGlow: { value: 0 },
        uSpecies: { value: species },
        uRnd: { value: rnd },
        uIri: { value: iri },
        uNormal: { value: new Vector3(0, 1, 0) },
      },
      vertexShader: FLOWER_VERT,
      fragmentShader: FLOWER_FRAG,
      side: DoubleSide,
    });
    const disc = discGrid();
    const hg = new BufferGeometry();
    const hp: number[] = [];
    for (let i = 0; i < disc.xy.length; i += 2) hp.push(disc.xy[i], disc.xy[i + 1], 0);
    hg.setAttribute('position', new BufferAttribute(new Float32Array(hp), 3));
    hg.setIndex(disc.index);
    this.head = new Mesh(hg, this.mat);
    this.head.scale.setScalar(size);
    this.head.frustumCulled = false;
    this.head.position.copy(this.headPos);
    this.group.add(this.stem.mesh, this.head, this.halo.group);
  }

  update(time: number, camera: PerspectiveCamera, glow: number, viewH: number): void {
    this.stem.update(time, camera, 0);
    this.headPos.copy(this.stem.tip);
    this.head.position.copy(this.headPos);
    // Face the sky, leaning a little (toward where the viewer first stood), nodding in the wind.
    if (!this.lean) {
      const d = camera.position.clone().sub(this.headPos).setY(0);
      this.lean = d.lengthSq() > 1e-6 ? d.normalize().multiplyScalar(this.leanAmt) : new Vector3();
    }
    const nod = Math.sin(time * 1.4 + this.size * 90) * 0.05 * (0.3 + U.uWindStrength.value);
    const n = new Vector3(0, 1, 0).add(this.lean).add(new Vector3(U.uWindDir.value.x, 0, U.uWindDir.value.y).multiplyScalar(nod)).normalize();
    this.head.position.copy(this.headPos);
    this.head.lookAt(this.head.position.clone().add(n));
    this.mat.uniforms.uNormal.value.copy(n);
    this.mat.uniforms.uGlow.value = glow;
    // Halo sits just behind the bloom so it never fights the petals for depth; a slow breath, no flicker.
    const pulse = 0.93 + 0.07 * Math.sin(time * 1.3);
    const back = this.headPos.clone().addScaledVector(camera.getWorldDirection(new Vector3()), 0.05);
    this.halo.set(0, back, this.color, glow * 2.2 * pulse, 0.9 + glow * 0.9);
    this.halo.count = glow > 0.001 ? 1 : 0;
    this.halo.commit(viewH);
  }
}

// ---------------------------------------------------------------- rune stones

const STONE_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vLocal;
varying vec3 vLocalN;
void main() {
  vLocal = position;
  vLocalN = normal;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const STONE_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform vec3 uGrassMid;
uniform vec3 uTint;
uniform float uPulse;
uniform float uSeed;
uniform vec3 uRuneCol;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vLocal;
varying vec3 vLocalN;

float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
vec2 gp(float i, float j) { return vec2((i - 1.0) * 0.17, 0.18 + j * 0.19); }

float glyph(vec2 p) {
  float d = seg(p, gp(1.0, 0.0), gp(1.0, 3.0));
  float s = uSeed;
  for (int k = 0; k < 9; k++) {
    float bit = mod(floor(s / pow(2.0, float(k))), 2.0);
    if (bit < 0.5) continue;
    vec2 a; vec2 b;
    if (k == 0) { a = gp(1.0, 3.0); b = gp(2.0, 2.0); }
    else if (k == 1) { a = gp(1.0, 2.0); b = gp(2.0, 1.0); }
    else if (k == 2) { a = gp(1.0, 3.0); b = gp(0.0, 2.0); }
    else if (k == 3) { a = gp(1.0, 2.0); b = gp(0.0, 1.0); }
    else if (k == 4) { a = gp(1.0, 1.0); b = gp(2.0, 0.0); }
    else if (k == 5) { a = gp(1.0, 1.0); b = gp(0.0, 0.0); }
    else if (k == 6) { a = gp(0.0, 3.0); b = gp(2.0, 1.0); }
    else if (k == 7) { a = gp(2.0, 3.0); b = gp(0.0, 1.0); }
    else { a = gp(1.0, 2.0); b = gp(2.0, 3.0); }
    d = min(d, seg(p, a, b));
  }
  return d;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = uSunDir;
  vec2 p = vWorldPos.xz * 2.0 + vWorldPos.y * 1.3;
  vec3 col = pow(vec3(0.55, 0.56, 0.6), vec3(2.2));
  col *= mix(0.7, 1.15, nz(p * 0.6).a);
  col = mix(col, pow(vec3(0.7, 0.62, 0.55), vec3(2.2)), smoothstep(0.7, 0.85, nz(p * 2.3 + 0.4).a) * 0.5);
  float moss = smoothstep(0.5, 0.85, N.y + (nz(p * 0.7).a - 0.5) * 0.8) + smoothstep(0.25, 0.0, vLocal.y) * 0.4;
  col = mix(col, uGrassMid * 0.5 * uTint, clamp(moss, 0.0, 1.0) * 0.8);
  float diff = smoothstep(-0.05, 0.45, dot(N, L));
  col *= uAmbient * (0.8 + 0.2 * N.y) + uSunColor * (0.2 + 0.8 * diff) * max(L.y + 0.15, 0.0);
  col += uAmbient * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.15;

  // The rune, cut into the face that looks at the pool.
  float face = smoothstep(0.4, 0.7, vLocalN.z);
  vec2 gpos = vec2(vLocal.x / 0.9, (vLocal.y - 0.12) / 0.95);
  float d = glyph(gpos);
  float stroke = smoothstep(0.035, 0.018, d) * face;
  float halo = exp(-d * 22.0) * face;
  float lvl = 0.12 + uPulse * 3.2;
  col = mix(col, col * 0.4, stroke * 0.6);
  col += uRuneCol * (stroke * lvl * 1.6 + halo * lvl * 0.35);
  // Light spills over the whole stone on each beat.
  col += uRuneCol * uPulse * 0.05 * (0.4 + 0.6 * face);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}
`;

const POOLGLOW_FRAG = /* glsl */ `
uniform float uPulse;
uniform vec3 uRuneCol;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float a = exp(-r * r * 4.0) * (1.0 - smoothstep(0.85, 1.0, r));
  vec3 c = uRuneCol * a * (0.06 + uPulse * 1.1);
  gl_FragColor = vec4(c, 1.0);
  ${OUT}
}
`;

function stoneGeometry(seed: number) {
  let g: BufferGeometry = new BoxGeometry(0.5, 1, 0.26, 4, 10, 2);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.getAttribute('position') as BufferAttribute;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const y = v.y + 0.5; // 0..1
    const taper = 1 - 0.28 * y * y;
    v.x *= taper;
    v.z *= taper * (1 - 0.2 * y);
    // Round the crown.
    const crown = Math.max(0, y - 0.78) / 0.22;
    v.y = y - crown * crown * (Math.abs(v.x) * 0.9 + 0.04);
    const n = 1 + 0.07 * Math.sin(v.x * 9 + v.y * 5 + seed) * Math.cos(v.z * 11 + seed * 2) + 0.04 * Math.sin(v.y * 17 + seed);
    v.x *= n;
    v.z *= n;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A ring of standing stones around a fairy pool; each rune flares when its note plays. */
export class RuneCircle {
  readonly group = new Group();
  readonly stones: { pos: Vector3; top: Vector3; mat: ShaderMaterial; glow: ShaderMaterial }[] = [];
  readonly color = new Color(0.35, 1.0, 0.86);

  constructor(cx: number, cz: number, radius: number, count: number, ok: (x: number, z: number) => boolean, offset = 0) {
    for (let i = 0; i < count; i++) {
      const a = offset + (i / count) * Math.PI * 2;
      let r = radius;
      let x = cx + Math.cos(a) * r;
      let z = cz + Math.sin(a) * r;
      for (let k = 0; k < 12 && !ok(x, z); k++) {
        r += 0.5;
        x = cx + Math.cos(a) * r;
        z = cz + Math.sin(a) * r;
      }
      const y = terrainHeight(x, z);
      const seed = 37 + i * 13;
      const mat = new ShaderMaterial({
        uniforms: { ...U, uPulse: { value: 0 }, uSeed: { value: [21, 82, 37, 148, 274, 69, 323, 98, 145, 290, 51][i % 11] }, uRuneCol: { value: this.color } },
        vertexShader: STONE_VERT,
        fragmentShader: STONE_FRAG,
      });
      const h = 0.95 + ((i * 7) % 5) * 0.09;
      const mesh = new Mesh(stoneGeometry(seed), mat);
      mesh.scale.set(1.5 + ((i * 3) % 4) * 0.1, h * 1.45, 1.3);
      mesh.position.set(x, y - 0.12, z);
      // Face the centre (+Z toward the pool), with a slight lean.
      mesh.rotation.set(0, Math.atan2(cx - x, cz - z), 0);
      mesh.rotateX(-0.04 - ((i * 5) % 3) * 0.02);
      mesh.rotateZ((((i * 11) % 7) - 3) * 0.012);

      const glow = new ShaderMaterial({
        uniforms: { uPulse: { value: 0 }, uRuneCol: { value: this.color } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: POOLGLOW_FRAG,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const disc = new Mesh(new PlaneGeometry(2.6, 2.6), glow);
      disc.rotation.x = -Math.PI / 2;
      // Sit the glow just in front of the stone, toward the water.
      const fx = (cx - x) / r;
      const fz = (cz - z) / r;
      disc.position.set(x + fx * 0.5, terrainHeight(x + fx * 0.5, z + fz * 0.5) + 0.06, z + fz * 0.5);
      disc.renderOrder = 9;
      this.group.add(mesh, disc);
      this.stones.push({ pos: new Vector3(x, y, z), top: new Vector3(x, y + h * 1.1, z), mat, glow });
    }
  }

  setPulse(i: number, v: number): void {
    const s = this.stones[i];
    if (!s) return;
    s.mat.uniforms.uPulse.value = v;
    s.glow.uniforms.uPulse.value = v;
  }
}

// ---------------------------------------------------------------- shooting star

const STAR_FRAG = /* glsl */ `
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float t = vUv.x; // 0 tail .. 1 head
  float s = vUv.y * 2.0 - 1.0;
  float body = exp(-s * s * mix(14.0, 5.0, t)) * pow(t, 2.2);
  float head = exp(-pow((1.0 - t) * 40.0, 2.0)) * exp(-s * s * 3.0) * 2.5;
  vec3 c = mix(vec3(0.55, 0.7, 1.0), vec3(1.0, 0.97, 0.88), t) * (body * 1.6 + head);
  gl_FragColor = vec4(c * uAlpha, 1.0);
  ${OUT}
}
`;

/** A meteor streak: a camera-facing ribbon between tail and head, far up in the sky. */
export class ShootingStar {
  readonly mesh: Mesh;
  readonly head = new Vector3();
  private readonly geo = new BufferGeometry();
  private readonly pos: Float32Array;
  private readonly mat: ShaderMaterial;
  private static readonly SEG = 24;

  constructor() {
    const n = ShootingStar.SEG;
    this.pos = new Float32Array((n + 1) * 2 * 3);
    const uv = new Float32Array((n + 1) * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      uv.set([i / n, 0, i / n, 1], i * 4);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('uv', new BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    this.mat = new ShaderMaterial({
      uniforms: { uAlpha: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
  }

  /** `from`/`to`: unit directions in the sky; k: 0..1 progress; trail: fraction of the arc behind the head. */
  update(eye: Vector3, from: Vector3, to: Vector3, k: number, trail: number, alpha: number, dist = 700): void {
    const n = ShootingStar.SEG;
    this.mesh.visible = alpha > 0.001;
    if (!this.mesh.visible) return;
    const dir = new Vector3();
    const pts: Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = Math.max(0, k - trail * (1 - i / n));
      dir.copy(from).lerp(to, t).normalize();
      pts.push(eye.clone().addScaledVector(dir, dist));
    }
    this.head.copy(pts[n]);
    for (let i = 0; i <= n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n, i + 1)];
      const tan = b.clone().sub(a).normalize();
      const view = pts[i].clone().sub(eye).normalize();
      const side = tan.cross(view).normalize().multiplyScalar(dist * 0.005 * (0.25 + 0.75 * (i / n)));
      const p = pts[i];
      this.pos.set([p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z], i * 6);
    }
    this.geo.getAttribute('position').needsUpdate = true;
    this.mat.uniforms.uAlpha.value = alpha;
  }
}

// ---------------------------------------------------------------- title card

/** The closing title, drawn once into a texture the grade pass reveals among the stars. */
export async function titleTexture(): Promise<CanvasTexture> {
  const W = 2048;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  try {
    await Promise.all([
      document.fonts.load('400 220px "Cormorant Garamond"'),
      document.fonts.load('italic 400 220px "Cormorant Garamond"'),
      document.fonts.load('500 48px "Manrope"'),
    ]);
  } catch {
    /* fall back to whatever serif is there */
  }
  g.clearRect(0, 0, W, H);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(246, 248, 255, 1)';
  g.shadowColor = 'rgba(170, 200, 255, 0.85)';
  g.shadowBlur = 38;
  g.font = '400 236px "Cormorant Garamond", Georgia, serif';
  (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '6px';
  g.fillText('touch grass', W / 2, H * 0.53);
  g.shadowBlur = 18;
  g.font = '500 44px "Manrope", system-ui, sans-serif';
  (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '22px';
  g.fillStyle = 'rgba(214, 226, 255, 0.92)';
  g.fillText('organic software experience', W / 2 + 11, H * 0.67);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}
