import { Color, DynamicDrawUsage, Euler, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import type { TimeName } from '../../core/params';
import { U } from '../../core/uniforms';
import type { Birds } from '../Birds';
import { terrainHeight } from '../common';
import type { FeatureMap } from '../Features';
import { Builder, M } from '../realm/geom';
import { hash2, mulberry32 } from '../realm/rand';
import type { RealmMap } from '../realm/Realm';
import { structureMaterial } from '../realm/Structures';
import type { Subject } from './RareFlora';

const DAY: TimeName[] = ['Noon', 'Golden hour', 'Misty dawn'];

function kiteGeometry() {
  const b = new Builder();
  // Forward is +Z. Long angled wings with fingered tips, a forked rufous tail.
  b.blob(0, 0, 0, 0.11, 0.1, 0.32, 0, '#9a4a26', M.cloth, 0.5, true);
  b.blob(0, 0.02, 0.3, 0.07, 0.07, 0.08, 0, '#d8d0c0', M.cloth, 0.5, true);
  b.cone(0, 0.02, 0.4, 0.02, 0.05, '#e8c040', M.cloth, 6, 0.5, 0);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const x = s * (0.25 + k * 0.28);
      const tilt = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), s * 0.1);
      b.box(x, 0.02 + k * 0.03, 0.02 - k * 0.04, 0.3, 0.025, 0.36 - k * 0.04, 0, k === 3 ? '#2a2420' : k === 2 ? '#e8e0d4' : '#8a4224', M.cloth, 0.5, tilt);
    }
    for (let f = 0; f < 5; f++) b.box(s * (1.2 + f * 0.02), 0.11, 0.08 - f * 0.07, 0.24, 0.015, 0.05, s * (0.1 + f * 0.08), '#1a1614', M.cloth, 0.5);
    b.box(s * 0.09, 0, -0.52, 0.09, 0.02, 0.42, s * 0.22, '#b85a2a', M.cloth, 0.5);
  }
  return b.build();
}

function dragonflyGeometry() {
  const b = new Builder();
  for (let k = 0; k < 7; k++) b.box(0, 0, -0.012 - k * 0.012, 0.007, 0.007, 0.013, 0, k % 2 ? '#2a8ad8' : '#1a5aa8', M.cloth, 0.5);
  b.blob(0, 0, 0.012, 0.011, 0.01, 0.016, 0, '#3a9a5a', M.cloth, 0.5, true);
  for (const s of [-1, 1]) b.blob(s * 0.007, 0.003, 0.03, 0.008, 0.008, 0.008, 0, '#2a7aa8', M.cloth, 0.2, true);
  for (const s of [-1, 1]) {
    for (const [z, w] of [[0.018, 0.06], [0.002, 0.055]] as const) {
      b.box(s * (w / 2 + 0.004), 0.004, z, w, 0.0015, 0.014, s * 0.05, '#d8ecf4', M.crystal, 0.2);
    }
  }
  return b.build();
}

function frogGeometry() {
  const b = new Builder();
  b.blob(0, 0.022, 0, 0.032, 0.022, 0.042, 0, '#6a7a36', M.cloth, 0.5, true);
  b.blob(0, 0.03, 0.035, 0.026, 0.017, 0.022, 0, '#76863e', M.cloth, 0.5, true);
  b.blob(0, 0.016, 0.02, 0.026, 0.012, 0.034, 0, '#d8cca0', M.cloth, 0.5, true);
  for (const s of [-1, 1]) {
    b.blob(s * 0.016, 0.043, 0.04, 0.009, 0.009, 0.009, 0, '#c8a020', M.cloth, 0.3, true);
    b.blob(s * 0.018, 0.045, 0.043, 0.004, 0.005, 0.005, 0, '#0a0806', M.cloth, 0.1, true);
    b.blob(s * 0.034, 0.012, -0.02, 0.016, 0.012, 0.03, s * 0.4, '#5a6a2e', M.cloth, 0.5, true);
    b.blob(s * 0.026, 0.008, 0.04, 0.008, 0.012, 0.008, 0, '#5a6a2e', M.cloth, 0.5, true);
  }
  // Dark spots on the back.
  const r = mulberry32(0xf06);
  for (let k = 0; k < 6; k++) b.blob((r() - 0.5) * 0.04, 0.04, (r() - 0.5) * 0.05, 0.006, 0.003, 0.006, 0, '#2a3018', M.cloth, 0.3, true);
  return b.build();
}

interface Kite {
  cx: number;
  cz: number;
  R: number;
  alt: number;
  ang: number;
  dir: number;
  p: Vector3;
}

interface Fly {
  pool: { x: number; z: number; r: number; level: number };
  p: Vector3;
  v: Vector3;
  target: Vector3;
  t: number;
  heading: number;
}

/**
 * Small lives: red kites circling high over the fields, dragonflies patrolling the pools,
 * frogs on the shores. Also lists the swallows and butterflies (drawn elsewhere) for the lens.
 */
export class Critters {
  readonly group = new Group();
  private readonly kites: Kite[] = [];
  private readonly kiteMesh: InstancedMesh;
  private readonly flyMesh: InstancedMesh;
  private readonly frogMesh: InstancedMesh;
  private flies: Fly[] = [];
  private frogs: { x: number; y: number; z: number; heading: number }[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Vector3();
  private readonly s = new Vector3();
  private readonly bseed: Float32Array;
  private tod: TimeName = 'Noon';
  private poolsKey = '';

  constructor(private readonly features: FeatureMap, private readonly map: RealmMap) {
    const mat = structureMaterial({ groundAO: false });
    this.kiteMesh = new InstancedMesh(kiteGeometry(), mat, 2);
    this.flyMesh = new InstancedMesh(dragonflyGeometry(), mat, 24);
    this.frogMesh = new InstancedMesh(frogGeometry(), mat, 24);
    for (const im of [this.kiteMesh, this.flyMesh, this.frogMesh]) {
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      im.setColorAt(0, new Color(1, 1, 1));
      for (let i = 0; i < im.instanceMatrix.count; i++) im.setColorAt(i, new Color(1, 1, 1));
      this.group.add(im);
    }
    for (let i = 0; i < 2; i++) this.kites.push({ cx: 1e9, cz: 0, R: 70 + i * 25, alt: 85 + i * 30, ang: i * 3, dir: i ? -1 : 1, p: new Vector3() });
    // Same seeds as the butterflies in Ambient.ts (mulberry32(0xb077), 70 x 4).
    const r = mulberry32(0xb077);
    this.bseed = new Float32Array(70 * 4);
    for (let i = 0; i < this.bseed.length; i++) this.bseed[i] = r();
  }

  /** Re-seat the pond life when the walker's pools change. */
  private rebuildPools(cx: number, cz: number): void {
    const pools = this.features.active.pools.filter((p) => Math.hypot(p.x - cx, p.z - cz) < 140);
    const key = pools.map((p) => `${p.x.toFixed(0)},${p.z.toFixed(0)}`).join('|');
    if (key === this.poolsKey) return;
    this.poolsKey = key;
    this.flies = [];
    this.frogs = [];
    for (const p of pools) {
      const nf = 1 + Math.floor(hash2(p.x, p.z, 3) * 2.5);
      for (let k = 0; k < nf && this.flies.length < 24; k++) {
        const pp = new Vector3(p.x, p.level + 0.8, p.z);
        this.flies.push({ pool: p, p: pp, v: new Vector3(), target: pp.clone(), t: 0, heading: 0 });
      }
      // Frogs at the water's edge: march out from the centre until the ground is dry.
      const nfrog = 1 + Math.floor(hash2(p.x, p.z, 4) * 2.2);
      for (let k = 0; k < nfrog && this.frogs.length < 24; k++) {
        const a = hash2(p.x, p.z, 11 + k) * Math.PI * 2;
        let d = p.r * 0.5;
        while (d < p.r * 2.5 && this.features.waterDepth(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d) > 0.01) d += 0.25;
        const x = p.x + Math.cos(a) * (d + 0.15);
        const z = p.z + Math.sin(a) * (d + 0.15);
        if (this.map.solidAt(x, z) > 0.1) continue;
        this.frogs.push({ x, y: terrainHeight(x, z), z, heading: Math.atan2(p.x - x, p.z - z) });
      }
    }
  }

  update(dt: number, cx: number, cz: number, tod: TimeName, featVersion: number): void {
    this.tod = tod;
    void featVersion;
    this.rebuildPools(cx, cz);
    const t = U.uTime.value;
    const day = DAY.includes(tod);
    const sunny = tod === 'Noon' || tod === 'Golden hour';

    // Kites: circle on the thermals, drift with the walker.
    let n = 0;
    for (const k of this.kites) {
      if (Math.hypot(k.cx - cx, k.cz - cz) > 420) {
        const a = Math.random() * Math.PI * 2;
        k.cx = cx + Math.cos(a) * 140;
        k.cz = cz + Math.sin(a) * 140;
      }
      k.ang += (dt * 9 * k.dir) / k.R;
      const x = k.cx + Math.cos(k.ang) * k.R;
      const z = k.cz + Math.sin(k.ang) * k.R;
      const y = Math.max(terrainHeight(x, z), terrainHeight(k.cx, k.cz)) + k.alt + Math.sin(t * 0.13 + k.R) * 12;
      k.p.set(x, y, z);
      if (!day) continue;
      const heading = Math.atan2(-Math.sin(k.ang) * k.dir, Math.cos(k.ang) * k.dir);
      this.q.setFromEuler(this.eul(heading, 0.05 * Math.sin(t * 0.7), -0.32 * k.dir + 0.06 * Math.sin(t * 1.1 + k.R)));
      this.m.compose(k.p, this.q, this.s.setScalar(1.15));
      this.kiteMesh.setMatrixAt(n++, this.m);
    }
    this.kiteMesh.count = n;
    this.kiteMesh.instanceMatrix.needsUpdate = true;

    // Dragonflies: dart from point to point low over the water, hover, dart again.
    n = 0;
    if (sunny) {
      for (const f of this.flies) {
        f.t -= dt;
        if (f.t <= 0) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.random() * f.pool.r * 1.1;
          f.target.set(f.pool.x + Math.cos(a) * d, f.pool.level + 0.35 + Math.random() * 0.9, f.pool.z + Math.sin(a) * d);
          f.t = 0.8 + Math.random() * 2.2;
        }
        const to = this.e.subVectors(f.target, f.p);
        const dist = to.length();
        const want = to.multiplyScalar(dist > 0.05 ? Math.min(6, dist * 4) / dist : 0);
        f.v.lerp(want, 1 - Math.exp(-dt * 6));
        f.p.addScaledVector(f.v, dt);
        if (f.v.lengthSq() > 0.04) f.heading = Math.atan2(f.v.x, f.v.z);
        const hover = Math.sin(t * 40 + f.pool.x) * 0.004;
        this.q.setFromAxisAngle(this.e.set(0, 1, 0), f.heading);
        this.m.compose(this.e.set(f.p.x, f.p.y + hover, f.p.z), this.q, this.s.setScalar(1.5));
        this.flyMesh.setMatrixAt(n++, this.m);
      }
    }
    this.flyMesh.count = n;
    this.flyMesh.instanceMatrix.needsUpdate = true;

    n = 0;
    for (const f of this.frogs) {
      f.y = terrainHeight(f.x, f.z);
      const puff = 1 + (tod === 'Dusk' ? Math.max(0, Math.sin(t * 5 + f.x)) * 0.12 : 0);
      this.q.setFromAxisAngle(this.e.set(0, 1, 0), f.heading);
      this.m.compose(this.e.set(f.x, f.y, f.z), this.q, this.s.set(1.3, 1.3 * puff, 1.3));
      this.frogMesh.setMatrixAt(n++, this.m);
    }
    this.frogMesh.count = n;
    this.frogMesh.instanceMatrix.needsUpdate = true;
  }

  private readonly eu = new Euler();
  private eul(yaw: number, pitch: number, roll: number): Euler {
    return this.eu.set(pitch, yaw, roll, 'YXZ');
  }

  /** Frogs near a point (for their croaks at dusk). */
  nearestFrog(x: number, z: number): { x: number; z: number; d: number } | null {
    let best: { x: number; z: number; d: number } | null = null;
    for (const f of this.frogs) {
      const d = Math.hypot(f.x - x, f.z - z);
      if (!best || d < best.d) best = { x: f.x, z: f.z, d };
    }
    return best;
  }

  /** The kite nearest overhead (for its cry). */
  nearestKite(x: number, z: number): { x: number; z: number; d: number } | null {
    if (!DAY.includes(this.tod)) return null;
    let best: { x: number; z: number; d: number } | null = null;
    for (const k of this.kites) {
      const d = k.p.distanceTo(this.e.set(x, k.p.y - k.alt, z));
      if (!best || d < best.d) best = { x: k.p.x, z: k.p.z, d };
    }
    return best;
  }

  subjects(out: Subject[], cam: Vector3, birds: Birds, night: number, sunY: number): void {
    if (DAY.includes(this.tod)) for (const k of this.kites) out.push({ id: 'kite', x: k.p.x, y: k.p.y, z: k.p.z, r: 0.9 });
    for (let i = 0; i < this.flyMesh.count; i++) out.push({ id: 'dragonfly', x: this.flies[i].p.x, y: this.flies[i].p.y, z: this.flies[i].p.z, r: 0.07 });
    for (const f of this.frogs) out.push({ id: 'frog', x: f.x, y: f.y + 0.035, z: f.z, r: 0.06 });
    // Swallows (Birds.ts).
    if (DAY.includes(this.tod)) {
      for (let fl = 0; fl < 3; fl++) {
        for (let i = 0; i < 22; i++) {
          const p = birds.birdPos(fl, i);
          if (p && Math.abs(p.x - cam.x) < 150 && Math.abs(p.z - cam.z) < 150) out.push({ id: 'swallow', x: p.x, y: p.y, z: p.z, r: 0.18 });
        }
      }
    }
    // Butterflies: a CPU twin of the butterfly shader in Ambient.ts.
    const day = (1 - night) * Math.min(1, Math.max(0, (sunY - 0.05) / 0.2));
    if (day < 0.2) return;
    const S = 46;
    const time = U.uTime.value;
    for (let i = 0; i < 70; i++) {
      const sx = this.bseed[i * 4];
      const sy = this.bseed[i * 4 + 1];
      const sz = this.bseed[i * 4 + 2];
      const sw = this.bseed[i * 4 + 3];
      const wrap = (v: number) => ((((v + S / 2) % S) + S) % S) - S / 2;
      const rx = wrap(sx * S - cam.x);
      const rz = wrap(sy * S - cam.z);
      if (Math.hypot(rx, rz) > S * 0.36) continue;
      const tt = time * (0.35 + sz * 0.3) + sw * 40;
      const x = cam.x + rx + Math.sin(tt) * 2.5 + Math.sin(tt * 2.3) * 0.8;
      const z = cam.z + rz + Math.cos(tt * 0.8) * 2.5 + Math.sin(tt * 1.7) * 0.7;
      if (this.map.solidAt(x, z) >= 0.2 || this.features.sample(x, z, 3) >= 0.3) continue;
      const g = terrainHeight(x, z);
      if (g > 110) continue;
      const y = g + 0.7 + 0.5 * Math.sin(tt * 1.9) + sz * 0.6;
      const id = sz < 0.3 ? 'b_copper' : sz < 0.55 ? 'b_brimstone' : sz < 0.8 ? 'b_white' : 'b_blue';
      out.push({ id, x, y, z, r: 0.09 });
    }
  }
}
