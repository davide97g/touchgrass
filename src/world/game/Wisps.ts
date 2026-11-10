import { AdditiveBlending, BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, Points, ShaderMaterial, Vector3 } from 'three';
import { U } from '../../core/uniforms';
import { mountainMask, terrainHeight } from '../common';
import { cellPools, FEATURE_CELL } from '../Features';
import { mulberry32 } from '../realm/rand';
import { CASTLE, ISLANDS } from '../realm/Skyward';
import type { Realm } from '../realm/World';

const VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
attribute float aSeed;
attribute float aSize;
attribute float aState;   // 0 drifting, > 0 the moment it was gathered, < 0 gone
varying float vA;
varying float vPop;
void main() {
  vec3 p = position;
  p.y += sin(uTime * 1.3 + aSeed * 40.0) * 0.22;
  p.x += sin(uTime * 0.7 + aSeed * 17.0) * 0.18;
  p.z += cos(uTime * 0.6 + aSeed * 29.0) * 0.18;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float twinkle = 0.82 + 0.18 * sin(uTime * (3.0 + aSeed * 4.0) + aSeed * 60.0);
  float size = aSize * twinkle;
  vA = 1.0;
  vPop = 0.0;
  if (aState > 0.0) {
    // Gathered: flare out and fade.
    float age = (uTime - aState) / 0.7;
    size *= 1.0 + age * 5.0;
    vA = max(0.0, 1.0 - age);
    vPop = 1.0;
  } else if (aState < 0.0) {
    vA = 0.0;
  }
  gl_PointSize = vA <= 0.0 ? 0.0 : clamp(size * uPixelRatio * 420.0 / max(-mv.z, 0.5), 3.0 * uPixelRatio, 260.0 * uPixelRatio);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
varying float vPop;
void main() {
  if (vA <= 0.001) discard;
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float halo = exp(-r * r * 4.5) * (1.0 - smoothstep(0.8, 1.0, r));
  float core = exp(-r * r * 60.0);
  // Four soft rays, like a star seen through an eyelash.
  float ray = exp(-abs(d.x) * 46.0) * exp(-abs(d.y) * 7.0) + exp(-abs(d.y) * 46.0) * exp(-abs(d.x) * 7.0);
  float ring = vPop * smoothstep(0.12, 0.0, abs(r - 0.7)) * 0.8;
  vec3 col = uColor * (halo * 0.9 + ray * 0.6 + ring) + vec3(1.0) * core * 1.6;
  gl_FragColor = vec4(col * vA, 1.0);
}
`;

export interface Wisp {
  x: number;
  y: number;
  z: number;
  /** In the sky: gathered in flight, from further away. */
  sky: boolean;
}

/**
 * Drifting lights to gather: along the roads, on hilltops, in the woods, around every landmark,
 * and a good many in the sky for those who fly. Walk (or fly) through one and it is yours.
 * A companion light floats ahead of the traveller and leans toward whatever they are looking for.
 */
export class Wisps {
  readonly group = new Group();
  readonly list: Wisp[] = [];
  private readonly state: BufferAttribute;
  private readonly guide: Points;
  private readonly guidePos = new Vector3();
  private readonly guideAttr: BufferAttribute;
  private guideOn = false;

  constructor(realm: Realm, has: (i: number) => boolean) {
    const r = mulberry32(0x11b5);
    const dry = (x: number, z: number) => {
      const ci = Math.floor(x / FEATURE_CELL);
      const cj = Math.floor(z / FEATURE_CELL);
      for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const p of cellPools(i, j)) if (Math.hypot(p.x - x, p.z - z) < p.r * 1.5 + 1) return false;
      return true;
    };
    const ground = (x: number, z: number, h = 1.15) => {
      if (realm.map.solidAt(x, z) > 0.05 || !dry(x, z)) return false;
      if (this.list.some((w) => Math.hypot(w.x - x, w.z - z) < 30)) return false;
      this.list.push({ x, y: terrainHeight(x, z) + h, z, sky: false });
      return true;
    };

    // Breadcrumbs along the country roads.
    for (const road of realm.roads) {
      if (road.pave > 0.5) continue;
      let acc = 60;
      for (let i = 1; i < road.pts.length; i++) {
        const a = road.pts[i - 1];
        const b = road.pts[i];
        acc += Math.hypot(b.x - a.x, b.z - a.z);
        if (acc < 150) continue;
        const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const side = r() < 0.5 ? 1 : -1;
        if (ground(b.x + (-(b.z - a.z) / l) * (road.halfW + 2.5) * side, b.z + ((b.x - a.x) / l) * (road.halfW + 2.5) * side)) acc = 0;
      }
    }
    // A few around every landmark and hidden place.
    for (const s of realm.sites) {
      for (let k = 0; k < 3; k++) {
        for (let t = 0; t < 12; t++) {
          const a = r() * Math.PI * 2;
          const d = s.r * (0.3 + r() * 0.9) + 6;
          if (ground(s.x + Math.cos(a) * d, s.z + Math.sin(a) * d)) break;
        }
      }
    }
    for (const q of realm.plan.secrets) {
      for (let t = 0; t < 12; t++) {
        const a = r() * Math.PI * 2;
        if (ground(q.x + Math.cos(a) * (q.r + 4 + r() * 6), q.z + Math.sin(a) * (q.r + 4 + r() * 6))) break;
      }
    }
    // Scattered over the open country, a little denser close to where the traveller wakes.
    let tries = 0;
    const target = this.list.length + 34;
    while (this.list.length < target && tries++ < 900) {
      const near = r() < 0.35;
      const x = near ? -80 + (r() - 0.5) * 700 : -1500 + r() * 2500;
      const z = near ? -120 + (r() - 0.5) * 700 : -1100 + r() * 2200;
      if (mountainMask(x, z) > 0.2) continue;
      ground(x, z);
    }
    // In the sky: over each floating island, a stair of lights up the Pillar, a crown over the castle.
    for (const isl of ISLANDS) {
      this.list.push({ x: isl.x, y: isl.y + 26 + isl.R * 0.25, z: isl.z, sky: true });
      if (isl.R > 50) this.list.push({ x: isl.x + isl.R * 0.8, y: isl.y - isl.R * 0.6, z: isl.z - isl.R * 0.4, sky: true });
    }
    const pillar = realm.sites.find((s) => s.kind === 'pillar');
    if (pillar) {
      for (let k = 0; k < 9; k++) {
        const a = k * 0.9;
        this.list.push({ x: pillar.x + Math.cos(a) * 52, y: pillar.level + 60 + k * 62, z: pillar.z + Math.sin(a) * 52, sky: true });
      }
    }
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      this.list.push({ x: CASTLE.x + Math.cos(a) * (CASTLE.R + 60), y: CASTLE.bottom + 120 + k * 130, z: CASTLE.z + Math.sin(a) * (CASTLE.R + 60), sky: true });
    }

    const n = this.list.length;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const size = new Float32Array(n);
    const st = new Float32Array(n);
    this.list.forEach((w, i) => {
      pos.set([w.x, w.y, w.z], i * 3);
      seed[i] = r();
      size[i] = w.sky ? 5.5 : 1.0;
      st[i] = has(i) ? -1 : 0;
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new BufferAttribute(seed, 1));
    g.setAttribute('aSize', new BufferAttribute(size, 1));
    this.state = new BufferAttribute(st, 1);
    this.state.setUsage(DynamicDrawUsage);
    g.setAttribute('aState', this.state);
    const mat = (color: [number, number, number]) =>
      new ShaderMaterial({
        uniforms: { uTime: U.uTime, uPixelRatio: U.uPixelRatio, uColor: { value: new Vector3(...color) } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
    const pts = new Points(g, mat([1.0, 0.86, 0.42]));
    pts.frustumCulled = false;
    pts.renderOrder = 4;
    this.group.add(pts);

    // The companion light and the short tail it leaves.
    const gg = new BufferGeometry();
    this.guideAttr = new BufferAttribute(new Float32Array(6 * 3), 3);
    this.guideAttr.setUsage(DynamicDrawUsage);
    gg.setAttribute('position', this.guideAttr);
    gg.setAttribute('aSeed', new BufferAttribute(new Float32Array([0.3, 0.5, 0.7, 0.2, 0.9, 0.4]), 1));
    gg.setAttribute('aSize', new BufferAttribute(new Float32Array([0.26, 0.17, 0.13, 0.1, 0.08, 0.06]), 1));
    gg.setAttribute('aState', new BufferAttribute(new Float32Array(6), 1));
    this.guide = new Points(gg, mat([0.5, 0.92, 1.0]));
    this.guide.frustumCulled = false;
    this.guide.renderOrder = 4;
    this.guide.visible = false;
    this.group.add(this.guide);
  }

  get total(): number {
    return this.list.length;
  }

  /** Gather whatever the traveller is touching. Returns the indices gathered this frame. */
  gather(eye: Vector3, flying: boolean, reach: number, has: (i: number) => boolean): number[] {
    const out: number[] = [];
    const now = U.uTime.value;
    for (let i = 0; i < this.list.length; i++) {
      if (this.state.getX(i) !== 0) continue;
      const w = this.list[i];
      const rr = (w.sky ? 9 : flying ? 5 : 1.7) * reach;
      const dx = w.x - eye.x;
      const dz = w.z - eye.z;
      if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
      const dy = w.y - (eye.y - (flying ? 0 : 0.5));
      if (dx * dx + dy * dy * (flying ? 1 : 0.5) + dz * dz > rr * rr) continue;
      if (has(i)) continue;
      this.state.setX(i, now);
      this.state.needsUpdate = true;
      out.push(i);
    }
    return out;
  }

  /** The nearest light still drifting (for the Moonwell and the blade's pull). */
  nearest(x: number, z: number, ground = true): Wisp | null {
    let best: Wisp | null = null;
    let bd = Infinity;
    for (let i = 0; i < this.list.length; i++) {
      if (this.state.getX(i) !== 0) continue;
      const w = this.list[i];
      if (ground && w.sky) continue;
      const d = Math.hypot(w.x - x, w.z - z);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  /** Float the companion ahead of the eye, leaning toward the goal when there is one. */
  updateGuide(dt: number, eye: Vector3, yaw: number, goal: { x: number; z: number; y?: number } | null, on: boolean, flying: boolean): void {
    this.guide.visible = on;
    if (!on) {
      this.guideOn = false;
      return;
    }
    const t = U.uTime.value;
    let dx = -Math.sin(yaw + 0.5);
    let dz = -Math.cos(yaw + 0.5);
    let lead = 2.2;
    let dy = -0.25;
    if (goal) {
      const gx = goal.x - eye.x;
      const gz = goal.z - eye.z;
      const d = Math.hypot(gx, gz);
      if (d > 4) {
        dx = gx / d;
        dz = gz / d;
        lead = flying ? 14 : 4.5;
        if (goal.y !== undefined) dy = Math.max(-6, Math.min(6, ((goal.y - eye.y) / d) * lead));
      }
    }
    const want = new Vector3(eye.x + dx * lead + Math.sin(t * 0.9) * 0.35, eye.y + dy + Math.sin(t * 1.7) * 0.18, eye.z + dz * lead + Math.cos(t * 1.1) * 0.35);
    if (!this.guideOn || want.distanceTo(this.guidePos) > 60) this.guidePos.copy(want);
    else this.guidePos.lerp(want, 1 - Math.exp(-dt * 2.2));
    this.guideOn = true;
    // Shift the tail down one, then put the head in front.
    const a = this.guideAttr.array as Float32Array;
    const k = 1 - Math.exp(-dt * 14);
    for (let i = 5; i >= 1; i--) {
      for (let c = 0; c < 3; c++) a[i * 3 + c] += (a[(i - 1) * 3 + c] - a[i * 3 + c]) * k;
    }
    a[0] = this.guidePos.x;
    a[1] = this.guidePos.y;
    a[2] = this.guidePos.z;
    this.guideAttr.needsUpdate = true;
  }
}
