import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { castShadow, shadowMaterial } from '../../core/Shadows';
import { U } from '../../core/uniforms';
import { COMMON_GLSL } from '../common';
import { Builder, M } from './geom';
import type { Realm } from './World';

const VERT = /* glsl */ `
attribute vec2 aMat;
attribute vec3 color;
uniform float uSway;
varying vec3 vN;
varying vec3 vWP;
varying vec3 vCol;
varying vec2 vMat;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
void main() {
#ifdef USE_INSTANCING
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  mat3 nm = mat3(modelMatrix) * mat3(instanceMatrix);
#else
  vec4 wp = modelMatrix * vec4(position, 1.0);
  mat3 nm = mat3(modelMatrix);
#endif
  // Foliage and cloth stir in the wind (instanced trees bend more toward the crown).
#ifdef USE_INSTANCING
  float lever = clamp(position.y * 0.12, 0.0, 1.6);
#else
  float lever = 1.0;
#endif
  float id = floor(aMat.x + 0.5);
  if (uSway > 0.0 && (id == 13.0 || id == 14.0)) {
    float ph = dot(wp.xz, vec2(0.21, 0.17)) + aMat.y * 6.28;
    float k = id == 14.0 ? 0.12 : 0.06 * uSway;
    wp.xz += uWindDir * sin(uTime * 1.6 + ph) * k * (0.4 + uWindStrength) * lever;
  }
  vWP = wp.xyz;
  vN = normalize(nm * normal);
  vCol = color;
#ifdef USE_INSTANCING_COLOR
  vCol *= instanceColor;
#endif
  vMat = aMat;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const STRUCT_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform vec3 uGrassBase;
uniform vec3 uGrassMid;
uniform vec3 uGrassTip;
uniform vec3 uTint;
uniform float uHaze;
uniform float uGroundAO;
uniform float uFogK;
varying vec3 vN;
varying vec3 vWP;
varying vec3 vCol;
varying vec2 vMat;

float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Blocks with mortar joints in face coordinates.
float blocks(vec2 q, out vec2 cell) {
  q.x += floor(q.y) * 0.5;
  cell = floor(q);
  vec2 f = fract(q);
  return smoothstep(0.0, 0.07, f.x) * smoothstep(1.0, 0.93, f.x) * smoothstep(0.0, 0.12, f.y) * smoothstep(1.0, 0.88, f.y);
}

void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 wp = vWP;
  vec3 V = normalize(cameraPosition - wp);
  vec3 L = uSunDir;
  float id = floor(vMat.x + 0.5);
  float rnd = vMat.y;
  vec3 col = vCol;
  vec3 emit = vec3(0.0);
  float spec = 0.0;
  float specPow = 40.0;
  vec3 an = abs(N);
  // Face coordinates: horizontal along the face, vertical up it (or plan view on flat tops).
  vec2 th = normalize(vec2(-N.z, N.x) + 1e-5);
  vec2 fuv = an.y > 0.75 ? wp.xz : vec2(dot(wp.xz, th), wp.y);
  float gy = uGroundAO > 0.0 ? terrainHeight(wp.xz) : -1e4;
  float above = wp.y - gy;

  if (id == 0.0 || id == 12.0 || id == 11.0) {
    float s = id == 11.0 ? 0.12 : 1.0;
    vec2 cell;
    float m = blocks(fuv * s * (id == 12.0 ? vec2(0.8, 1.2) : vec2(1.0 / 0.95, 1.0 / 0.48)), cell);
    col *= mix(0.74, 1.0, m) * (0.86 + 0.22 * h21(cell + rnd * 13.0));
    col *= mix(0.86, 1.06, nz(wp.xz * 0.21 + wp.y * 0.13).a);
    // Moss creeping over tops and weathered streaks down the walls.
    float moss = smoothstep(0.55, 0.9, N.y + (nz(wp.xz * 0.5).a - 0.5) * 0.8) * (id == 11.0 ? 1.0 : 0.6);
    col = mix(col, uGrassMid * 0.5 * uTint, moss * 0.7);
    col *= mix(1.0, 0.82, smoothstep(0.55, 0.8, nz(vec2(fuv.x * 0.7, fuv.y * 0.08)).g) * (1.0 - an.y));
    if (id == 11.0 && uHaze > 0.0) {
      // The flying castle: lit windows scattered over its tiers at night.
      vec2 wq = floor(fuv * vec2(0.22, 0.32));
      float lit = step(0.93, h21(wq + 7.0)) * (1.0 - an.y);
      emit += vec3(1.0, 0.72, 0.4) * lit * (0.15 + uLights * 1.6);
    }
  } else if (id == 1.0) {
    col *= mix(0.9, 1.04, nz(fuv * 0.45 + rnd).a) * mix(0.96, 1.02, nz(fuv * 3.1).b);
    // Rain streaks running down from sills and eaves; patches where the plaster has worn to stone.
    float streak = smoothstep(0.55, 0.85, nz(vec2(fuv.x * 1.7 + rnd * 9.0, fuv.y * 0.07)).g) * (1.0 - an.y);
    col *= mix(1.0, 0.82, streak);
    float worn = smoothstep(0.8, 0.86, nz(fuv * 0.22 + rnd * 3.0).a);
    vec2 cell;
    float bm = blocks(fuv * vec2(1.0 / 0.95, 1.0 / 0.48), cell);
    col = mix(col, vec3(0.5, 0.47, 0.42) * mix(0.75, 1.0, bm), worn * 0.5);
  } else if (id == 2.0) {
    col *= 0.82 + 0.3 * h21(floor(fuv * vec2(1.5, 7.0)) + rnd * 7.0);
  } else if (id == 3.0) {
    // Tile courses down the slope, each tile a slightly different tone.
    float v = wp.y * 3.3;
    float u = dot(wp.xz, th) * 2.6 + floor(v) * 0.5;
    float row = fract(v);
    col *= mix(0.62, 1.0, smoothstep(0.0, 0.4, row)) * (0.84 + 0.28 * h21(vec2(floor(u), floor(v)) + rnd * 3.0));
    col *= mix(0.9, 1.06, nz(wp.xz * 0.15).a);
    // Lichen and moss on the tiles, thicker toward the eaves; dark run-off lines.
    float lich = smoothstep(0.7, 0.9, nz(wp.xz * 0.35 + rnd).a + (1.0 - fract(v * 0.05)) * 0.1);
    col = mix(col, mix(vec3(0.24, 0.28, 0.12), vec3(0.55, 0.52, 0.3), nz(wp.xz * 1.3).b), lich * 0.3 * smoothstep(0.2, 0.6, N.y));
    col *= mix(1.0, 0.8, smoothstep(0.6, 0.9, nz(vec2(u * 0.4, wp.y * 0.12)).g));
    spec = 0.08;
  } else if (id == 4.0) {
    // Glass: sky reflection by day, warm lamplight within at dusk.
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec2 g = fract(fuv * vec2(2.1, 1.5));
    float mull = step(0.08, g.x) * step(g.x, 0.92) * step(0.08, g.y) * step(g.y, 0.92);
    col = mix(vec3(0.03, 0.04, 0.06), uZenith * 0.6 + uFogColor * 0.25, 0.25 + 0.6 * fres) * mix(0.4, 1.0, mull);
    float lit = step(0.3, rnd) * smoothstep(rnd * 0.6, rnd * 0.6 + 0.3, uLights);
    float warm = 0.7 + 0.5 * h21(floor(wp.xz * 0.5) + rnd);
    emit += mix(vec3(1.0, 0.58, 0.24), vec3(1.0, 0.8, 0.5), rnd) * 2.4 * lit * warm * mix(0.6, 1.0, mull);
    spec = 0.6;
    specPow = 120.0;
  } else if (id == 5.0) {
    col *= 0.7;
    emit += vCol * (0.25 + 3.2 * uLights);
  } else if (id == 6.0) {
    // Glassy: a cool body, light caught inside along the facets, bright rims, a slow inner pulse.
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    float pulse = 0.75 + 0.25 * sin(uTime * 1.3 + rnd * 6.28 + wp.y * 0.3);
    float facet = h21(floor(N.xz * 3.0 + rnd * 9.0));
    float veins = smoothstep(0.6, 0.95, nz(vec2(dot(wp.xz, th) * 0.12, wp.y * 0.05) + rnd).g);
    float height = clamp((wp.y - gy) / 12.0, 0.0, 1.0);
    col = vCol * mix(0.35, 0.7, facet);
    emit += vCol * (0.22 + 0.9 * fres + 0.9 * uLights) * pulse * mix(0.8, 1.4, height);
    emit += mix(vCol, vec3(1.0), 0.5) * veins * 0.3;
    float sparkle = pow(max(dot(reflect(-V, N), L), 0.0), 60.0);
    emit += uSunColor * sparkle * 1.5;
    spec = 1.4;
    specPow = 90.0;
  } else if (id == 7.0) {
    spec = 0.35;
  } else if (id == 8.0 || id == 9.0) {
    vec2 p = wp.xz + wp.y * 0.7;
    col *= mix(0.78, 1.12, nz(p * 0.4).a) * mix(1.0, 0.75, smoothstep(0.6, 0.75, nz(p * 0.9 + 0.2).g));
    if (id == 8.0) {
      // Strata: bedded layers of differing tone, warped a little, with dark seams and pale weathered bands.
      float wy = wp.y + (nz(wp.xz * 0.03).a - 0.5) * 6.0;
      float bed = fract(wy * 0.28);
      col *= mix(0.82, 1.1, nz(vec2(floor(wy * 0.28) * 0.37, 0.5)).a);
      col *= mix(0.74, 1.0, smoothstep(0.0, 0.08, bed) * smoothstep(1.0, 0.9, bed));
      col = mix(col, col * vec3(1.12, 1.0, 0.86), smoothstep(0.55, 0.8, nz(vec2(dot(wp.xz, th) * 0.05, wy * 0.1)).g) * 0.6);
      // Wet streaks and darker undersides.
      col *= mix(1.0, 0.7, smoothstep(0.62, 0.85, nz(vec2(dot(wp.xz, th) * 0.4, wp.y * 0.02)).b) * (1.0 - an.y));
      col *= mix(0.78, 1.0, smoothstep(-0.6, 0.2, N.y));
    }
    float top = smoothstep(0.5, 0.8, N.y + (nz(p * 0.3).a - 0.5) * 0.6);
    if (id == 9.0) top = max(top, 0.0);
    vec3 grass = mix(uGrassMid, uGrassTip, 0.25 + 0.4 * nz(p * 0.05).b) * uTint;
    col = mix(col, grass * 0.85, top * (id == 9.0 ? 1.0 : 0.7));
  } else if (id == 10.0) {
    float pulse = 0.6 + 0.4 * sin(uTime * 2.0 + rnd * 6.28);
    col *= 0.4;
    emit += vCol * (0.6 + 2.0 * uLights + 0.6 * pulse);
  } else if (id == 13.0) {
    col *= mix(0.75, 1.15, nz(wp.xz * 0.6 + wp.y * 0.4).a);
    float back = pow(clamp(dot(-V, L), 0.0, 1.0), 4.0);
    emit += col * uSunColor * back * 0.4;
  } else if (id == 14.0) {
    col *= mix(0.85, 1.05, nz(fuv * 0.8).a);
  } else if (id == 15.0) {
    col *= mix(0.92, 1.04, nz(wp.xz * 0.1).a);
    spec = 0.3;
  }

  // Grime near the ground on walls.
  if (uGroundAO > 0.0 && (id == 1.0 || id == 0.0)) col = mix(col * vec3(0.72, 0.68, 0.6), col, smoothstep(0.0, 1.4, above));

  float diff = smoothstep(-0.05, 0.45, dot(N, L));
  float ao = uGroundAO > 0.0 ? mix(0.62, 1.0, smoothstep(0.0, 3.0, above)) : 1.0;
  float sh = uGroundAO > 0.0 ? sunShadow(wp + N * 0.08) : 1.0;
  diff *= smoothstep(0.48, 1.0, sh);
  vec3 light = uAmbient * (0.72 + 0.28 * N.y) * ao * mix(0.85, 1.0, sh) + uSunColor * (0.12 + 0.88 * diff) * max(L.y + 0.15, 0.0) * 1.05;
  col *= light * cloudShadowAt(wp.xz);
  vec3 H = normalize(L + V);
  col += uSunColor * spec * pow(max(dot(N, H), 0.0), specPow) * diff;
  col += uAmbient * pow(1.0 - max(dot(N, V), 0.0), 4.0) * 0.1;
  col += emit;

  col = applyFogK(col, wp, uFogK);
  // Aerial perspective for things far up in the sky.
  vec3 vd = normalize(wp - cameraPosition);
  col = mix(col, fogColorFor(vd), uHaze);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function structureMaterial(opts: { haze?: number; groundAO?: boolean; sway?: number; fog?: number } = {}): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...U,
      uHaze: { value: opts.haze ?? 0 },
      uGroundAO: { value: opts.groundAO === false ? 0 : 1 },
      uSway: { value: opts.sway ?? 1 },
      uFogK: { value: opts.fog ?? 1 },
    },
    vertexShader: VERT,
    fragmentShader: STRUCT_FRAG,
  });
}

/** Split one big buffer into square chunks so the camera frustum can cull whole districts. */
function chunked(geo: BufferGeometry, size: number): BufferGeometry[] {
  const pos = geo.getAttribute('position') as BufferAttribute;
  const names = ['position', 'normal', 'color', 'aMat'];
  const attrs = names.map((n) => geo.getAttribute(n) as BufferAttribute);
  const buckets = new Map<string, number[]>();
  for (let t = 0; t < pos.count; t += 3) {
    const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
    const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    const key = `${Math.floor(cx / size)},${Math.floor(cz / size)}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(t);
  }
  const out: BufferGeometry[] = [];
  for (const tris of buckets.values()) {
    const g = new BufferGeometry();
    for (let ai = 0; ai < attrs.length; ai++) {
      const a = attrs[ai];
      const n = a.itemSize;
      const arr = new Float32Array(tris.length * 3 * n);
      let o = 0;
      for (const t of tris) {
        for (let v = 0; v < 3; v++) {
          for (let c = 0; c < n; c++) arr[o++] = a.array[(t + v) * n + c];
        }
      }
      g.setAttribute(names[ai], new BufferAttribute(arr, n));
    }
    g.computeBoundingSphere();
    out.push(g);
  }
  return out;
}

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWP;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLights;
uniform sampler2D uNoise;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWP;
void main() {
  vec3 V = normalize(cameraPosition - vWP);
  float edge = pow(1.0 - abs(dot(normalize(vN), V)), 1.5);
  float core = 1.0 - edge;
  float s = textureLod(uNoise, vec2(vUv.x * 2.0, vUv.y * 0.6 - uTime * 0.08), 0.0).a;
  float s2 = textureLod(uNoise, vec2(vUv.x * 5.0 + 0.3, vUv.y * 1.4 - uTime * 0.21), 0.0).g;
  float streak = smoothstep(0.4, 0.9, s * 0.6 + s2 * 0.5);
  float h = vUv.y;
  float fade = smoothstep(0.0, 0.04, h) * (1.0 - smoothstep(0.25, 1.0, h));
  float a = fade * (0.18 + 0.6 * streak) * (0.35 + 0.65 * core) * (0.25 + 0.75 * uLights);
  gl_FragColor = vec4(vec3(0.45, 0.85, 1.0) * a * 1.25, 1.0);
}
`;

const GLOW_VERT = /* glsl */ `
uniform float uLights;
uniform float uPixelRatio;
uniform float uTime;
attribute float aSize;
attribute float aSeed;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float flicker = 0.9 + 0.1 * sin(uTime * (7.0 + aSeed * 5.0) + aSeed * 40.0);
  vA = uLights * flicker;
  gl_PointSize = aSize * uPixelRatio * 300.0 / max(-mv.z, 1.0) * (0.4 + 0.6 * uLights);
}
`;
const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = exp(-r * r * 5.0) * (1.0 - smoothstep(0.85, 1.0, r));
  if (vA * a < 0.003) discard;
  gl_FragColor = vec4(uColor * a * vA, 1.0);
}
`;

/** Halos around lamps at dusk (additive points). */
export function lampGlow(lamps: { x: number; y: number; z: number }[], color: [number, number, number], size: number): Points {
  const g = new BufferGeometry();
  const p = new Float32Array(lamps.length * 3);
  const s = new Float32Array(lamps.length);
  const seed = new Float32Array(lamps.length);
  lamps.forEach((l, i) => {
    p.set([l.x, l.y, l.z], i * 3);
    s[i] = size;
    seed[i] = Math.random();
  });
  g.setAttribute('position', new BufferAttribute(p, 3));
  g.setAttribute('aSize', new BufferAttribute(s, 1));
  g.setAttribute('aSeed', new BufferAttribute(seed, 1));
  const m = new ShaderMaterial({
    uniforms: { uLights: U.uLights, uPixelRatio: U.uPixelRatio, uTime: U.uTime, uColor: { value: new Vector3(...color) } },
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const pts = new Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

/**
 * Everything built in the realm: houses, walls, towers, ruins, crystals, plus the few moving
 * parts (windmill sails, the gate's turning rings, floating crystals) and lamp halos.
 */
export class Structures {
  readonly group = new Group();
  private readonly mills: Group[] = [];
  private readonly spinners: { obj: Group; speed: number; bob: number; baseY: number }[] = [];
  readonly material = structureMaterial();

  constructor(realm: Realm) {
    const plan = realm.plan;
    const b = new Builder();
    for (const p of plan.props) p.fn(b);
    const all = b.build();
    const depth = shadowMaterial(this.material);
    for (const g of chunked(all, 120)) {
      const m = new Mesh(g, this.material);
      castShadow(m, depth);
      this.group.add(m);
    }
    all.dispose();

    // Windmill sails.
    for (const w of plan.windmills) {
      const g = new Group();
      const parts = new Builder();
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        const sail = new Builder();
        sail.box(0, 0, 0, 0.22, w.r, 0.18, 0, '#5a4232', M.wood);
        sail.box(0.85, w.r * 0.18, 0.02, 1.5, w.r * 0.8, 0.05, 0, '#efe6d2', M.cloth, 0.5);
        const sg = sail.build().rotateZ(a);
        parts.addRaw(sg);
        sg.dispose();
      }
      parts.cyl(0, 0, -0.6, 0.45, 1.0, '#3a2c22', M.wood, 8, 0.5, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2));
      const geo = parts.build();
      const mesh = new Mesh(geo, structureMaterial({ groundAO: false }));
      castShadow(mesh, shadowMaterial(mesh.material as ShaderMaterial));
      const inner = new Group();
      inner.add(mesh);
      g.add(inner);
      g.position.set(w.x, w.y, w.z);
      g.rotation.y = -w.rot + Math.PI / 2;
      this.group.add(g);
      this.mills.push(inner);
    }

    // Gate of light (city) and the floating crystal over the ruins' altar.
    plan.gates.forEach((gp, i) => {
      const g = new Group();
      const rb = new Builder();
      if (i === 0) {
        rb.ring(0, 0, 0, 3.6, 3, 0, Math.PI / 2, '#9ff0ff', M.rune, 0.1);
        rb.ring(0, 0, 0, 2.6, 3, 0, Math.PI / 2 + 0.3, '#c8f8ff', M.rune, 0.6);
      }
      rb.gem(0, 0, 0, 0.9, 1.9, 0.9, 0, '#8fe8ff', M.crystal, 0.3);
      const mesh = new Mesh(rb.build(), structureMaterial({ groundAO: false }));
      g.add(mesh);
      const baseY = gp.y + (i === 0 ? 5.2 : 2.0);
      g.position.set(gp.x, baseY, gp.z);
      this.group.add(g);
      this.spinners.push({ obj: g, speed: i === 0 ? 0.35 : 0.6, bob: i === 0 ? 0.25 : 0.4, baseY });
    });

    // A column of light rising from the gate of light.
    if (plan.gates.length) {
      const gp = plan.gates[0];
      const geo = new CylinderGeometry(2.2, 3.4, 90, 24, 1, true).translate(0, 45, 0);
      const beam = new Mesh(
        geo,
        new ShaderMaterial({
          uniforms: { uTime: U.uTime, uLights: U.uLights, uNoise: U.uNoise },
          vertexShader: BEAM_VERT,
          fragmentShader: BEAM_FRAG,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          side: DoubleSide,
        }),
      );
      beam.position.set(gp.x, gp.y + 0.8, gp.z);
      beam.renderOrder = 3;
      this.group.add(beam);
    }

    this.group.add(lampGlow(plan.lamps, [1.0, 0.72, 0.38], 1.4));
    this.group.add(lampGlow(plan.gates.map((g, i) => ({ x: g.x, y: g.y + (i === 0 ? 5.2 : 2.0), z: g.z })), [0.45, 0.85, 1.0], 9));
  }

  update(dt: number, time: number): void {
    for (const m of this.mills) m.rotation.z -= dt * 0.55;
    for (const s of this.spinners) {
      s.obj.rotation.y += dt * s.speed;
      s.obj.position.y = s.baseY + Math.sin(time * 0.8) * s.bob;
    }
  }
}
