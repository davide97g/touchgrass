import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { U } from '../../core/uniforms';
import { COMMON_GLSL, terrainHeight } from '../common';
import { structureMaterial } from './Structures';
import { mulberry32 } from './rand';
import type { Realm } from './World';

// ---- chimney and campfire smoke ----

const SMOKE_VERT = /* glsl */ `
${COMMON_GLSL}
attribute vec4 aSeed; // phase, side, size, strength
varying float vA;
varying float vT;
void main() {
  float t = fract(uTime * 0.045 * (0.8 + aSeed.y * 0.4) + aSeed.x);
  vec3 p = position;
  float rise = t * (16.0 + aSeed.z * 10.0);
  vec2 drift = uWindDir * (rise * 0.55 + t * t * 10.0) * (0.4 + uWindStrength);
  p.xz += drift + vec2(sin(t * 6.0 + aSeed.x * 20.0), cos(t * 5.0 + aSeed.y * 20.0)) * t * 1.2;
  p.y += rise;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vT = t;
  vA = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.45, 1.0, t)) * aSeed.w;
  gl_PointSize = (1.0 + t * 6.0) * (0.8 + aSeed.z) * uPixelRatio * 300.0 / max(-mv.z, 1.0);
}
`;
const SMOKE_FRAG = /* glsl */ `
uniform vec3 uAmbient;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
varying float vA;
varying float vT;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, r)) * vA * 0.5;
  if (a < 0.003) discard;
  vec3 col = vec3(0.82, 0.82, 0.84) * (uAmbient * 1.3 + uSunColor * 0.6 * max(uSunDir.y + 0.2, 0.0));
  col = mix(col, uFogColor, vT * 0.4);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---- sparks over the fires ----

const SPARK_VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform vec2 uWindDir;
attribute vec4 aSeed;
varying float vA;
void main() {
  float t = fract(uTime * (0.35 + aSeed.y * 0.3) + aSeed.x);
  vec3 p = position;
  p.y += t * (2.5 + aSeed.z * 2.5);
  p.xz += vec2(sin(t * 9.0 + aSeed.x * 30.0), cos(t * 7.0 + aSeed.w * 30.0)) * 0.35 * t + uWindDir * t * 0.8;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vA = (1.0 - t) * (0.6 + 0.4 * sin(uTime * 20.0 + aSeed.w * 40.0));
  gl_PointSize = (0.06 + aSeed.z * 0.06) * uPixelRatio * 300.0 / max(-mv.z, 1.0) + 1.0;
}
`;
const SPARK_FRAG = /* glsl */ `
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = (1.0 - smoothstep(0.1, 0.5, length(d))) * vA;
  gl_FragColor = vec4(vec3(1.0, 0.55, 0.18) * a * 2.5, 1.0);
}
`;

const FIRE_GLOW_VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
attribute float aSeed;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float fl = 0.75 + 0.15 * sin(uTime * 11.0 + aSeed * 30.0) + 0.1 * sin(uTime * 23.0 + aSeed * 7.0);
  vA = fl;
  gl_PointSize = 5.5 * fl * uPixelRatio * 300.0 / max(-mv.z, 1.0);
}
`;
const FIRE_GLOW_FRAG = /* glsl */ `
uniform float uLights;
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = exp(-r * r * 4.0) * (1.0 - smoothstep(0.8, 1.0, r)) * vA * (0.35 + 0.65 * uLights);
  gl_FragColor = vec4(vec3(1.0, 0.5, 0.18) * a, 1.0);
}
`;

// ---- blossom petals ----

const PETAL_VERT = /* glsl */ `
${COMMON_GLSL}
attribute vec4 aSeed;
uniform vec3 uArea; // x, z, radius
varying float vA;
varying float vSpin;
void main() {
  float H = 9.0;
  float t = fract(uTime * (0.025 + aSeed.y * 0.02) + aSeed.x);
  vec2 base = uArea.xy + position.xz;
  vec2 drift = uWindDir * t * (6.0 + uWindStrength * 10.0) + vec2(sin(uTime * 0.7 + aSeed.z * 30.0), cos(uTime * 0.6 + aSeed.w * 30.0)) * 1.2;
  vec2 xz = base + drift;
  float y = terrainHeight(xz) + 0.1 + (1.0 - t) * H * (0.4 + 0.6 * aSeed.w);
  vec4 mv = modelViewMatrix * vec4(xz.x, y, xz.y, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = length(position.xz) / uArea.z;
  vA = smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.92, t) * (1.0 - smoothstep(0.75, 1.0, d));
  vSpin = uTime * (2.0 + aSeed.z * 3.0) + aSeed.x * 20.0;
  gl_PointSize = 0.13 * uPixelRatio * 300.0 / max(-mv.z, 1.0) + 1.0;
}
`;
const PETAL_FRAG = /* glsl */ `
uniform vec3 uAmbient;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
varying float vA;
varying float vSpin;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float c = cos(vSpin);
  float s = sin(vSpin);
  d = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
  d.y *= 1.0 / max(0.25, abs(sin(vSpin * 0.7)));
  float a = (1.0 - smoothstep(0.3, 0.5, length(d))) * vA;
  if (a < 0.05) discard;
  vec3 col = vec3(1.0, 0.72, 0.84) * (uAmbient + uSunColor * max(uSunDir.y + 0.2, 0.0));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---- butterflies around the walker by day ----

const BFLY_VERT = /* glsl */ `
${COMMON_GLSL}
attribute vec4 aSeed;
varying vec3 vCol;
varying float vA;
varying vec3 vWP;
void main() {
  float S = 46.0;
  vec2 anchor = aSeed.xy * S;
  vec2 rel = mod(anchor - cameraPosition.xz + 0.5 * S, S) - 0.5 * S;
  vec2 c = cameraPosition.xz + rel;
  float t = uTime * (0.35 + aSeed.z * 0.3) + aSeed.w * 40.0;
  c += vec2(sin(t) * 2.5 + sin(t * 2.3) * 0.8, cos(t * 0.8) * 2.5 + sin(t * 1.7) * 0.7);
  vec4 rl = realmAt(c);
  vec4 ft = featAt(c);
  float ok = (1.0 - step(0.2, rl.b)) * (1.0 - step(0.3, ft.a)) * (1.0 - smoothstep(110.0, 160.0, terrainHeight(c)));
  float day = (1.0 - uNight) * smoothstep(0.05, 0.25, uSunDir.y);
  float y = terrainHeight(c) + 0.7 + 0.5 * sin(t * 1.9) + aSeed.z * 0.6;
  float heading = atan(cos(t) * 2.5, -sin(t) * 2.5 * 0.8);
  float flap = sin(uTime * (14.0 + aSeed.z * 8.0) + aSeed.w * 10.0) * 1.1;
  vec3 p = position; // wing in local X (span) / Z (chord); x sign = side
  float side = sign(p.x);
  float ang = flap * side;
  vec3 q = vec3(p.x * cos(ang), abs(p.x) * sin(flap), p.z);
  float ch = cos(heading);
  float sh = sin(heading);
  q = vec3(q.x * ch + q.z * sh, q.y, -q.x * sh + q.z * ch);
  float sc = 0.09 * ok * day * smoothstep(S * 0.5, S * 0.3, length(rel));
  vec3 wp = vec3(c.x, y, c.y) + q * sc;
  vWP = wp;
  float k = aSeed.z;
  vCol = k < 0.3 ? vec3(1.0, 0.55, 0.12) : k < 0.55 ? vec3(1.0, 0.9, 0.35) : k < 0.8 ? vec3(0.96, 0.96, 1.0) : vec3(0.35, 0.6, 1.0);
  vA = abs(p.x) + abs(p.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const BFLY_FRAG = /* glsl */ `
${COMMON_GLSL}
varying vec3 vCol;
varying float vA;
varying vec3 vWP;
void main() {
  vec3 col = vCol * (uAmbient + uSunColor * 0.9 * max(uSunDir.y + 0.15, 0.0));
  col *= mix(0.35, 1.0, smoothstep(0.1, 0.5, vA));
  col = applyFog(col, vWP);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function butterflyGeometry(count: number): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  // Two wings, each two triangles (fore and hind wing).
  const v = [
    0, 0, 0.2, 1, 0, 0.55, 1.1, 0, -0.15,
    0, 0, 0.1, 0.8, 0, -0.2, 0.25, 0, -0.75,
    0, 0, 0.2, -1.1, 0, -0.15, -1, 0, 0.55,
    0, 0, 0.1, -0.25, 0, -0.75, -0.8, 0, -0.2,
  ];
  // Body sits on x=0: give it a tiny non-zero x so it flaps with neither wing.
  g.setAttribute('position', new BufferAttribute(new Float32Array(v.map((n, i) => (i % 3 === 0 && n === 0 ? 0.001 : n))), 3));
  const r = mulberry32(0xb077);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) seed[i] = r();
  g.setAttribute('aSeed', new InstancedBufferAttribute(seed, 4));
  g.instanceCount = count;
  return g;
}

/** Smoke, sparks, fire glow, drifting petals and butterflies. */
export class Ambient {
  readonly group = new Group();

  constructor(realm: Realm) {
    const plan = realm.plan;
    const r = mulberry32(0x5a0e);

    // Smoke.
    const per = 16;
    const sp: number[] = [];
    const ss: number[] = [];
    for (const s of plan.smokes) {
      for (let i = 0; i < per; i++) {
        sp.push(s.x, s.y, s.z);
        ss.push(i / per + r() * 0.05, r(), r() * s.s, (0.6 + r() * 0.4) * s.s);
      }
    }
    this.group.add(points(sp, ss, SMOKE_VERT, SMOKE_FRAG, { ...U }, NormalBlending));

    // Sparks and glow over fires.
    const fp: number[] = [];
    const fs: number[] = [];
    const gp: number[] = [];
    const gs: number[] = [];
    for (const f of plan.fires) {
      for (let i = 0; i < 18; i++) {
        fp.push(f.x + (r() - 0.5) * 0.4, f.y - 0.2, f.z + (r() - 0.5) * 0.4);
        fs.push(r(), r(), r(), r());
      }
      gp.push(f.x, f.y, f.z);
      gs.push(r());
    }
    this.group.add(points(fp, fs, SPARK_VERT, SPARK_FRAG, { uTime: U.uTime, uPixelRatio: U.uPixelRatio, uWindDir: U.uWindDir }, AdditiveBlending));
    this.group.add(points(gp, gs, FIRE_GLOW_VERT, FIRE_GLOW_FRAG, { uTime: U.uTime, uPixelRatio: U.uPixelRatio, uLights: U.uLights }, AdditiveBlending, 1));

    // Petals.
    for (const a of plan.petals) {
      const pp: number[] = [];
      const ps: number[] = [];
      for (let i = 0; i < 900; i++) {
        const ang = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * a.r;
        pp.push(Math.cos(ang) * d, 0, Math.sin(ang) * d);
        ps.push(r(), r(), r(), r());
      }
      this.group.add(points(pp, ps, PETAL_VERT, PETAL_FRAG, { ...U, uArea: { value: new Vector3(a.x, a.z, a.r) } }, NormalBlending));
    }

    // Fallen petals carpeting the ground under the cherries.
    {
      const pos: number[] = [];
      const nor: number[] = [];
      const col: number[] = [];
      const mat: number[] = [];
      const idx: number[] = [];
      const c = new Color();
      for (const t of plan.treeSpots) {
        if (t.kind !== 4) continue;
        const n = 260;
        for (let i = 0; i < n; i++) {
          const a = r() * Math.PI * 2;
          const d = Math.pow(r(), 0.7) * 6.5 * t.s;
          const x = t.x + Math.cos(a) * d;
          const z = t.z + Math.sin(a) * d;
          const y = terrainHeight(x, z) + 0.04 + r() * 0.04;
          const sz = 0.05 + r() * 0.05;
          const rot = r() * Math.PI;
          const cx = Math.cos(rot) * sz;
          const cz = Math.sin(rot) * sz;
          const base = pos.length / 3;
          pos.push(x - cx, y, z - cz, x - cz * 0.7, y, z + cx * 0.7, x + cx, y, z + cz, x + cz * 0.7, y, z - cx * 0.7);
          c.setHSL(0.94 + r() * 0.04, 0.6, 0.85 + r() * 0.1);
          for (let k = 0; k < 4; k++) {
            nor.push(0, 1, 0);
            col.push(c.r, c.g, c.b);
            mat.push(13, r());
          }
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
      if (pos.length) {
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
        g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
        g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
        g.setAttribute('aMat', new BufferAttribute(new Float32Array(mat), 2));
        g.setIndex(idx);
        g.computeBoundingSphere();
        const m = structureMaterial({ sway: 0, groundAO: true });
        m.side = DoubleSide;
        this.group.add(new Mesh(g, m));
      }
    }

    // Butterflies.
    const bm = new Mesh(
      butterflyGeometry(70),
      new ShaderMaterial({ uniforms: { ...U }, vertexShader: BFLY_VERT, fragmentShader: BFLY_FRAG, side: DoubleSide }),
    );
    bm.frustumCulled = false;
    this.group.add(bm);
  }
}

function points(pos: number[], seed: number[], vs: string, fs: string, uniforms: Record<string, { value: unknown }>, blending: typeof NormalBlending | typeof AdditiveBlending, seedSize = 4): Points {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aSeed', new BufferAttribute(new Float32Array(seed), seedSize));
  const m = new ShaderMaterial({
    uniforms,
    vertexShader: vs,
    fragmentShader: fs,
    transparent: true,
    depthWrite: false,
    blending,
  });
  const p = new Points(g, m);
  p.frustumCulled = false;
  return p;
}
