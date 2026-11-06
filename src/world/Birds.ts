import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  ShaderMaterial,
  Vector3,
} from 'three';
import { U } from '../core/uniforms';
import { COMMON_GLSL, terrainHeight } from './common';

const VERT = /* glsl */ `
attribute float aPart; // 0 body, 1 inner wing, 2 outer wing, 3 tail
attribute vec2 aFlight; // phase, flap amount
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vLocalN;
varying vec3 vLocal;
varying float vPart;

vec2 rot(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

const float SHOULDER = 0.045;
const float ELBOW = 0.27;

void main() {
  vec3 p = position;
  vec3 n = normal;
  float f = aFlight.y;
  float ph = uTime * 14.0 + aFlight.x * 6.2831;
  // Quick downstroke, slower recovery.
  float beat = sin(ph + 0.45 * sin(ph));
  // Gliding holds a shallow V; flapping sweeps the whole wing, the hand lags behind.
  float th1 = mix(0.16, 0.08 + 0.72 * beat, f);
  float th2 = mix(0.05, 0.55 * sin(ph - 1.1), f);

  if (aPart > 0.5 && aPart < 2.5) {
    float side = p.x < 0.0 ? -1.0 : 1.0;
    p.x *= side;
    n.x *= side;
    if (aPart > 1.5) {
      p.xy = rot(p.xy - vec2(ELBOW, 0.0), th2) + vec2(ELBOW, 0.0);
      n.xy = rot(n.xy, th2);
      // The hand folds back on the upstroke.
      p.z -= (p.x - ELBOW) * 0.35 * max(0.0, -beat) * f;
    }
    p.xy = rot(p.xy - vec2(SHOULDER, 0.0), th1) + vec2(SHOULDER, 0.0);
    n.xy = rot(n.xy, th1);
    p.x *= side;
    n.x *= side;
  }
  // Body rides opposite the wingbeat; tail streamers trail and flex.
  p.y -= 0.018 * beat * f;
  if (aPart > 2.5) p.y += sin(ph - 1.6) * 0.03 * (-p.z - 0.14) * 3.0 * (0.3 + f);

  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(m) * n);
  vLocalN = n;
  vLocal = p;
  vPart = aPart;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${COMMON_GLSL}
uniform vec3 uGrassMid;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vLocalN;
varying vec3 vLocal;
varying float vPart;

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

void main() {
  float face = gl_FrontFacing ? 1.0 : -1.0;
  vec3 N = normalize(vNormal) * face;
  vec3 LN = vLocalN * face;
  bool under = LN.y < 0.0;

  // Barn swallow: glossy navy back, cream belly, rust throat, pale underwings.
  vec3 back = srgb(vec3(0.12, 0.16, 0.3));
  vec3 col = back;
  if (vPart < 0.5) {
    float belly = smoothstep(0.15, -0.35, LN.y);
    col = mix(back, srgb(vec3(0.9, 0.86, 0.78)), belly);
    float throat = smoothstep(0.13, 0.16, vLocal.z) * smoothstep(0.215, 0.2, vLocal.z) * smoothstep(-0.1, -0.45, LN.y);
    col = mix(col, srgb(vec3(0.7, 0.32, 0.18)), throat);
    col = mix(col, back, smoothstep(0.19, 0.215, vLocal.z));      // dark face and crown
    if (vLocal.z > 0.232) col = srgb(vec3(0.06, 0.05, 0.05));      // beak
  } else if (vPart < 2.5) {
    col = under ? srgb(vec3(0.74, 0.72, 0.7)) : back;
    // Darker flight feathers toward the trailing edge and tip.
    col *= mix(1.0, 0.7, smoothstep(0.35, 0.7, abs(vLocal.x)));
  } else {
    col = under ? srgb(vec3(0.42, 0.42, 0.46)) : back * 0.9;
  }

  // Sky light from above, green bounce from the meadow below, sun, and a glossy rim.
  vec3 V = normalize(cameraPosition - vWorldPos);
  float sky = 0.55 + 0.45 * N.y;
  vec3 bounce = mix(uAmbient, uGrassMid, 0.35) * 0.4 * max(-N.y, 0.0);
  float diff = max(dot(N, uSunDir), 0.0);
  vec3 light = uAmbient * sky * 1.25 + bounce + uSunColor * diff * max(uSunDir.y + 0.15, 0.0);
  col *= light;
  float spec = pow(max(dot(reflect(-V, N), uSunDir), 0.0), 24.0) * (under ? 0.0 : 0.35);
  col += uSunColor * spec;
  col += uAmbient * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.25;

  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Bird {
  p: Vector3;
  v: Vector3;
  phase: number;
  flap: number;
  flapT: number;
  roll: number;
  /** Place in a loose formation when the flock is guided along a scripted path. */
  off: Vector3;
}

interface Flock {
  birds: Bird[];
  angle: number;
  speed: number;
  t: number;
  centre: Vector3;
}

const PER_FLOCK = 22;
const FLOCKS = 3;

function birdGeometry(): BufferGeometry {
  const pos: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];
  const add = (x: number, y: number, z: number, pt: number) => {
    pos.push(x, y, z);
    part.push(pt);
    return pos.length / 3 - 1;
  };

  // Body: a lofted spindle from tail (-z) to beak (+z).
  const rings = [
    { z: -0.17, r: 0.008 },
    { z: -0.12, r: 0.028 },
    { z: -0.05, r: 0.045 },
    { z: 0.03, r: 0.052 },
    { z: 0.11, r: 0.044 },
    { z: 0.17, r: 0.036 }, // head
    { z: 0.22, r: 0.024 },
    { z: 0.25, r: 0.008 }, // beak
    { z: 0.275, r: 0.0 },
  ];
  const seg = 8;
  const ringStart: number[] = [];
  for (const rg of rings) {
    ringStart.push(pos.length / 3);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      // Slightly taller than wide; head sits a touch higher.
      const lift = rg.z > 0.12 ? 0.012 : 0;
      add(Math.cos(a) * rg.r * 0.9, Math.sin(a) * rg.r * 1.05 + lift, rg.z, 0);
    }
  }
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = ringStart[k] + i;
      const b = ringStart[k] + ((i + 1) % seg);
      const c = ringStart[k + 1] + i;
      const d = ringStart[k + 1] + ((i + 1) % seg);
      idx.push(a, b, c, b, d, c);
    }
  }

  // Wings: long, swept, pointed, gently cambered. Three chordwise rows: leading, mid, trailing.
  const span = [0.045, 0.15, 0.27, 0.4, 0.53, 0.64];
  const lead = [0.08, 0.09, 0.075, 0.02, -0.07, -0.17];
  const trail = [-0.08, -0.1, -0.1, -0.105, -0.125, -0.17];
  for (const side of [-1, 1]) {
    const rows: number[][] = [[], [], []];
    for (let i = 0; i < span.length; i++) {
      const x = span[i] * side;
      const pt = span[i] > 0.27 ? 2 : 1;
      const camber = 0.012 * (1 - i / span.length);
      rows[0].push(add(x, 0.004, lead[i], pt));
      rows[1].push(add(x, 0.004 + camber, lead[i] * 0.55 + trail[i] * 0.45, pt));
      rows[2].push(add(x, 0.0, trail[i], pt));
    }
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < span.length - 1; i++) {
        const a = rows[r][i];
        const b = rows[r][i + 1];
        const c = rows[r + 1][i];
        const d = rows[r + 1][i + 1];
        if (side > 0) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
  }

  // Forked tail with streamers.
  const t0 = add(-0.035, 0.0, -0.12, 3);
  const t1 = add(0.035, 0.0, -0.12, 3);
  const tl = add(-0.085, 0.0, -0.44, 3);
  const tr = add(0.085, 0.0, -0.44, 3);
  const tn = add(0.0, 0.0, -0.24, 3);
  const tm = add(-0.05, 0.0, -0.24, 3);
  const tq = add(0.05, 0.0, -0.24, 3);
  idx.push(t0, t1, tn, t0, tn, tm, tm, tn, tl, t1, tq, tn, tq, tr, tn);

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aPart', new BufferAttribute(new Float32Array(part), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class Birds {
  readonly mesh: InstancedMesh;
  private flocks: Flock[] = [];
  private flight: InstancedBufferAttribute;
  private readonly m = new Matrix4();
  private readonly tmp = new Vector3();
  private readonly dir = new Vector3();
  private readonly ahead = new Vector3();
  private initialised = false;
  /** Nearest bird to the listener, for panning chirps. */
  nearest = { dist: Infinity, x: 0, z: 0 };
  /** Optional scripted flight (trailer): where a flock's formation centre should be, and how fast it moves. */
  guide: ((flock: number) => { p: Vector3; v: Vector3 } | null) | null = null;

  /** Centre of a flock (world space). */
  flockCentre(i: number): Vector3 {
    return this.flocks[i]?.centre ?? this.tmp.set(0, -1e4, 0);
  }

  /** Move a whole flock into formation around a point, flying with velocity v (trailer cuts). */
  warpFlock(i: number, p: Vector3, v: Vector3): void {
    const fl = this.flocks[i];
    if (!fl) return;
    for (const b of fl.birds) {
      b.p.copy(p).add(b.off);
      b.v.copy(v);
    }
    fl.centre.copy(p);
  }

  /** One bird's position (world space). */
  birdPos(flock: number, i: number): Vector3 | null {
    return this.flocks[flock]?.birds[i]?.p ?? null;
  }

  constructor() {
    const geo = birdGeometry();
    this.flight = new InstancedBufferAttribute(new Float32Array(PER_FLOCK * FLOCKS * 2), 2);
    geo.setAttribute('aFlight', this.flight);
    const mat = new ShaderMaterial({ uniforms: { ...U }, vertexShader: VERT, fragmentShader: FRAG, side: DoubleSide });
    this.mesh = new InstancedMesh(geo, mat, PER_FLOCK * FLOCKS);
    this.mesh.frustumCulled = false;
  }

  private init(px: number, pz: number): void {
    for (let f = 0; f < FLOCKS; f++) {
      const angle = (f / FLOCKS) * Math.PI * 2 + Math.random();
      const centre = new Vector3(px + Math.cos(angle) * 70, 0, pz + Math.sin(angle) * 70);
      centre.y = terrainHeight(centre.x, centre.z) + 35;
      const birds: Bird[] = [];
      for (let i = 0; i < PER_FLOCK; i++) {
        birds.push({
          p: centre.clone().add(new Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 12)),
          v: new Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(9),
          phase: Math.random(),
          flap: 1,
          flapT: Math.random() * 3,
          roll: 0,
          off: new Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 9),
        });
      }
      this.flocks.push({ birds, angle, speed: (f % 2 ? -1 : 1) * (0.045 + Math.random() * 0.03), t: Math.random() * 100, centre });
    }
    this.initialised = true;
  }

  update(dt: number, px: number, pz: number, night: number): void {
    if (!this.initialised) this.init(px, pz);
    const away = Math.min(1, Math.max(0, (night - 0.35) / 0.4)); // birds roost as it gets dark
    this.mesh.visible = away < 0.98;
    this.nearest.dist = Infinity;
    const sep = new Vector3();
    const ali = new Vector3();
    const coh = new Vector3();
    const target = new Vector3();
    const up = new Vector3(0, 1, 0);
    let idx = 0;

    for (let fi = 0; fi < this.flocks.length; fi++) {
      const fl = this.flocks[fi];
      const g = this.guide?.(fi) ?? null;
      fl.t += dt;
      fl.angle += fl.speed * dt;
      // Orbit radius breathes, so flocks sometimes sweep right overhead.
      const R = 60 + 48 * Math.sin(fl.t * 0.023 + fl.angle * 1.7) + away * 400;
      target.set(px + Math.cos(fl.angle) * R, 0, pz + Math.sin(fl.angle) * R);
      target.y = terrainHeight(target.x, target.z) + 20 + 12 * Math.sin(fl.t * 0.05) + away * 80;

      fl.centre.set(0, 0, 0);
      for (const b of fl.birds) fl.centre.add(b.p);
      fl.centre.multiplyScalar(1 / fl.birds.length);

      for (const b of fl.birds) {
        sep.set(0, 0, 0);
        ali.set(0, 0, 0);
        coh.set(0, 0, 0);
        let n = 0;
        for (const o of fl.birds) {
          if (o === b) continue;
          const d = b.p.distanceTo(o.p);
          if (d < 9) {
            ali.add(o.v);
            coh.add(o.p);
            n++;
            if (d < 3.2) sep.add(this.tmp.subVectors(b.p, o.p).multiplyScalar(1 / Math.max(d * d, 0.05)));
          }
        }
        const prevDir = this.tmp.copy(b.v).normalize();
        const prevX = prevDir.x;
        const prevZ = prevDir.z;
        if (g) {
          // Scripted: hold a loose formation around the guide, still swerving apart a little.
          const want = new Vector3().copy(g.p).add(b.off).sub(b.p).multiplyScalar(1.6).add(g.v).addScaledVector(sep, 2);
          b.v.lerp(want, 1 - Math.exp(-dt * 2.5));
          b.p.addScaledVector(b.v, dt);
        }
        const acc = new Vector3();
        if (!g && n > 0) {
          acc.add(ali.multiplyScalar(1 / n).sub(b.v).multiplyScalar(0.9));
          acc.add(coh.multiplyScalar(1 / n).sub(b.p).multiplyScalar(0.35));
        }
        if (!g) acc.add(sep.multiplyScalar(9));
        acc.add(this.tmp.subVectors(target, b.p).normalize().multiplyScalar(3.2));
        // Keep above the land.
        const ground = terrainHeight(b.p.x, b.p.z);
        if (b.p.y < ground + 12) acc.y += (ground + 12 - b.p.y) * 1.5;

        if (!g) {
          b.v.addScaledVector(acc, dt);
          const sp = b.v.length();
          const want = 9.5 + 1.5 * Math.sin(b.phase * 30 + fl.t);
          b.v.multiplyScalar(Math.min(Math.max(sp, 6.5), 12.5) / sp);
          b.v.lerp(b.v.clone().normalize().multiplyScalar(want), dt * 0.5);
          b.p.addScaledVector(b.v, dt);
        }

        // Flap in bursts, then glide.
        b.flapT -= dt;
        if (b.flapT <= 0) b.flapT = 1.5 + Math.random() * 3;
        const flapping = b.flapT > 1.0 || b.v.y > 0.8 ? 1 : 0.08;
        b.flap += (flapping - b.flap) * Math.min(1, dt * 4);

        // Bank into turns.
        const dir = this.dir.copy(b.v).normalize();
        const turn = prevX * dir.z - prevZ * dir.x;
        b.roll += (Math.max(-0.9, Math.min(0.9, -turn * 40)) - b.roll) * Math.min(1, dt * 3);

        // Matrix4.lookAt(eye, target) points +Z from target to eye: eye ahead of the bird, so the head (+Z) leads.
        this.m.lookAt(this.ahead.copy(b.p).add(dir), b.p, up);
        const roll = new Matrix4().makeRotationZ(b.roll);
        this.m.multiply(roll);
        this.m.setPosition(b.p);
        const s = 1.15 + b.phase * 0.3;
        this.m.scale(new Vector3(s, s, s));
        this.mesh.setMatrixAt(idx, this.m);
        this.flight.setXY(idx, b.phase, b.flap);
        idx++;

        const d = Math.hypot(b.p.x - px, b.p.z - pz);
        if (d < this.nearest.dist) this.nearest = { dist: Math.hypot(d, b.p.y - terrainHeight(px, pz)), x: b.p.x, z: b.p.z };
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.flight.needsUpdate = true;
  }
}
