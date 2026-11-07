import { Color, MathUtils, type PerspectiveCamera, Vector3 } from 'three';
import type { CameraDirector, Experience } from '../core/Experience';
import { params } from '../core/params';
import { U } from '../core/uniforms';
import { FX } from '../post/Post';
import { sampleNoise } from '../core/noise';
import { terrainBase, terrainHeight } from '../world/common';
import { SPECIES } from '../world/flowerHeads';
import type { Pool } from '../world/Features';
import type { Preset } from '../world/TimeOfDay';
import { GlowFlower, GlowPoints, HeroBlade, RuneCircle, ShootingStar, Sparks, titleTexture } from './props';
import { Score } from './Score';
import { M, RUNE_NOTES, RUNE_STONES } from './timeline';

// ------------------------------------------------------------ small maths

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeIn = (x: number) => x * x * x;
const wrapPi = (a: number) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
const lerpAngle = (a: number, b: number, t: number) => a + wrapPi(b - a) * t;
const fwd = (yaw: number) => new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
const right = (yaw: number) => new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
const UP = new Vector3(0, 1, 0);

/** Keyframed value: smooth-stepped between keys, held at the ends. */
function track(keys: [number, number][]): (t: number) => number {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [t0, v0] = keys[i - 1];
        const [t1, v1] = keys[i];
        return t1 <= t0 ? v1 : v0 + (v1 - v0) * sstep(t0, t1, t);
      }
    }
    return keys[keys.length - 1][1];
  };
}

function aim(from: Vector3, to: Vector3): { yaw: number; pitch: number; dist: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const h = Math.hypot(dx, dz);
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, h), dist: Math.hypot(h, dy) };
}

/** Yaw that looks along a horizontal direction. */
const yawOf = (d: Vector3) => Math.atan2(-d.x, -d.z);
/** Preset azimuth (degrees) that puts the sun along a horizontal direction. */
const azOf = (d: Vector3) => MathUtils.radToDeg(Math.atan2(d.x, -d.z));

/** Height (sine of elevation) of the distant mountain silhouette toward a horizontal direction; mirrors Sky.ts. */
function horizonAt(d: Vector3): number {
  const az = Math.atan2(d.x, -d.z);
  const cx = Math.cos(az);
  const cz = Math.sin(az);
  const m1 = 0.01 + sampleNoise(cx * 0.32 + 0.5, cz * 0.32 + 0.5, 0) * 0.07;
  const m2 = 0.004 + sampleNoise(cx * 0.55 + 0.2, cz * 0.55 + 0.7, 1) * 0.04;
  return Math.max(m1, m2);
}

function preset(p: Preset): Preset {
  return p;
}

// ------------------------------------------------------------ the director

interface Rig {
  pos: Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;
  dof: number;
  focus: number;
}

interface Fly {
  anchor: Vector3;
  s: number[];
}

export class Director implements CameraDirector {
  onEnd: (() => void) | null = null;
  /** Debug: freeze the clock at the start offset. */
  hold = false;
  /** Debug: pin the camera for stills (window.__dir.pose in dev). */
  pose: { pos: Vector3; look: Vector3; fov: number; focus: number } | null = null;
  private score: Score | null = null;
  private t0 = 0;
  private T = 0;
  private running = false;
  private ended = false;
  private fired = new Set<string>();

  private readonly want: Rig = { pos: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 70, dof: 0, focus: -1 };
  private readonly cur: Rig = { pos: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 70, dof: 0, focus: -1 };
  private snap = true;
  /** Presses a wider hollow into the grass around the camera (trail map). */
  private kneel = 0;
  private dofScale = 1.5;
  private angRate = 5;
  private posRate = 8;

  // Walking bob and footsteps, from distance actually travelled.
  private walked = 0;
  private bobAmp = 0;
  private lastStep = 0;
  private lastXZ = new Vector3();

  // Locations.
  private S = new Vector3();
  private H = 0;
  private readonly pool1: Pool;
  private readonly pool2: Pool;
  private theta1 = 0;
  private theta2 = 0;
  private runeOffset = 0;
  private flowerTargets: Vector3[] = [];
  private readonly openFlowers: GlowFlower[] = [];
  private details: Vector3[] | null = null;
  private readonly lying = new Vector3();
  private lyingYaw = 0;
  private N1 = new Vector3();
  private nightYaw = 0;

  // Props.
  private readonly flies = new GlowPoints(208);
  private readonly flyData: Fly[] = [];
  private readonly flyColor = new Color(0.78, 1.0, 0.4);
  private readonly blade: HeroBlade;
  private readonly flower: GlowFlower;
  private readonly runes: RuneCircle;
  private readonly meteor = new ShootingStar();
  private readonly sparks = new Sparks(600);
  /** Pollen, seeds and torn petals streaming past in the gust. */
  private readonly debris = new GlowPoints(360, false);
  private readonly debrisP: { p: Vector3; v: Vector3; c: Color; s: number; a: number; ph: number }[] = [];
  private meteorFrom = new Vector3();
  private meteorTo = new Vector3();
  private meteorSet = false;
  private warped = [false, false];
  private lastSpark = 0;
  private lastRuneIdx = -1;

  private readonly presets: Record<'afternoon' | 'sunset' | 'sunsetDown' | 'night' | 'dawn' | 'fairy' | 'starry', Preset>;
  /** Where the sun sets: ahead of the walk, over the lowest stretch of the far hills. */
  private sunYaw = 0;
  private gustYaw = 0;

  // Environment tracks.
  private readonly lid = track([
    [0, 0], [0.5, 0], [1.3, 0.38], [1.75, 0.22], [2.7, 0.8], [3.0, 0.68], [3.8, 1],
    [M.gust + 2.2, 1], [M.gust + 3.3, 0.72], [M.gust + 3.7, 0.8], [M.gust + 4.4, 0.55], [M.blink, 0.5], [M.blink + 0.28, 0], [M.night + 0.3, 0], [M.night + 1.1, 0.5], [M.night + 1.45, 0.36], [M.night + 2.6, 1],
    [M.flare, 1], [M.flare + 0.12, 0], [M.fairy + 1.0, 0], [M.fairy + 1.9, 0.55], [M.fairy + 2.3, 0.42], [M.fairy + 3.4, 1],
  ]);
  private readonly blur = track([
    [0, 14], [1.5, 9], [3, 3.5], [4.2, 0.5], [4.8, 0], [M.gust + 2.5, 0], [M.gust + 4.2, 2.2], [M.blink, 3.5], [M.blink + 0.3, 0],
    [M.night, 0], [M.night + 0.01, 7], [M.night + 3.2, 0],
    [M.dawn, 0], [M.dawn + 0.01, 5], [M.dawn + 2.2, 0],
    [M.fairy, 0], [M.fairy + 0.01, 9], [M.fairy + 4, 0],
    [M.stars, 0], [M.stars + 0.01, 6], [M.stars + 2.5, 0],
  ]);
  private readonly fade = track([[0, 0], [0.8, 1], [M.fadeOut, 1], [M.end, 0]]);
  private readonly swirl = track([[M.vortex, 0], [M.stars - 0.05, 12], [M.stars, 7], [M.stars + 2.8, 0]]);
  private readonly title = track([[M.title, 0], [M.title + 3.8, 1]]);
  private readonly wind = track([
    [0, 0.45], [M.gust, 0.5], [M.gust + 1.2, 1.7], [M.gust + 3.0, 3.3], [M.blink, 3.6], [M.blink + 0.5, 0.3],
    [M.dawn, 0.3], [M.dawn + 0.05, 0.22], [M.fairy, 0.22], [M.fairy + 0.05, 0.38], [M.stars, 0.38], [M.stars + 0.05, 0.3],
  ]);
  private readonly gust = track([
    [0, 0.6], [M.gust, 0.7], [M.gust + 1.2, 1.2], [M.gust + 3.0, 1.3], [M.blink, 1.3], [M.blink + 0.5, 0.45],
    [M.dawn, 0.45], [M.dawn + 0.05, 0.3], [M.fairy, 0.3], [M.fairy + 0.05, 0.6], [M.stars, 0.6], [M.stars + 0.05, 0.5],
  ]);
  private readonly clouds = track([
    [0, 0.36], [M.swallows, 0.36], [M.swallows + 4, 0.5], [M.sun - 2, 0.46], [M.sun + 1.5, 0.3], [M.blink + 0.3, 0.3], [M.blink + 0.35, 0.28],
    [M.dawn, 0.28], [M.dawn + 0.05, 0.42], [M.fairy, 0.42], [M.fairy + 0.05, 0.5], [M.stars, 0.5], [M.stars + 0.05, 0.05],
  ]);
  private readonly bloom = track([[M.perch, 1], [M.white, 3.4], [M.dawn + 0.4, 1], [M.dive + 3, 1], [M.flare, 2.4], [M.fairy + 0.6, 1]]);
  private readonly exposure = track([[M.perch + 1.5, 1], [M.white, 1.45], [M.dawn + 0.4, 1]]);
  private readonly walkS = track([[M.walk, 0], [M.swallows - 0.3, 13.5], [M.night + 0.6, 13.5], [M.fireflies - 0.4, 17.5]]);

  constructor(private readonly exp: Experience) {
    const ctl = exp.controller;
    ctl.enabled = false;
    ctl.wanderActive = false;
    params.audio.musicOn = false;
    params.atmosphere.cloudSpeed = 1.6;
    params.flowers.density = 0.9;
    exp.applyFlowers();

    this.pickWalk();
    const pools = this.pickPools();
    this.pool1 = pools[0];
    this.pool2 = pools[1];
    this.placePond();
    this.placeFairy();
    this.pickFlowers();

    // Night: where the walk stops among the fireflies.
    this.N1 = this.path(17.5);
    this.nightYaw = this.pathYaw(17.5);
    const nf = fwd(this.nightYaw);
    const nr = right(this.nightYaw);
    const bladeBase = this.N1.clone().addScaledVector(nf, 3.0).addScaledVector(nr, 0.45);
    bladeBase.y = terrainHeight(bladeBase.x, bladeBase.z);
    this.blade = new HeroBlade(bladeBase, 1.2, nr.clone().multiplyScalar(-0.12).addScaledVector(nf, -0.18));
    this.blade.mesh.visible = false;
    this.buildFlies();

    // Glowing flower, across the pond from the detail shots.
    const p1 = this.pool1;
    const ta = this.theta1 + 0.45 + Math.PI;
    let fr = p1.r * 1.06 + 0.6;
    let fx = p1.x + Math.cos(ta) * fr;
    let fz = p1.z + Math.sin(ta) * fr;
    for (let k = 0; k < 12 && (exp.features.waterDepth(fx, fz) > 0.01 || !this.stand(fx, fz)); k++) {
      fr += 0.4;
      fx = p1.x + Math.cos(ta) * fr;
      fz = p1.z + Math.sin(ta) * fr;
    }
    this.flower = new GlowFlower(new Vector3(fx, terrainHeight(fx, fz), fz), 0.95, 0.11, SPECIES.cosmos, 1, 0.37);

    const p2 = this.pool2;
    const ringR = Math.max(p2.r * 1.12 + 0.9, p2.r + 1.4);
    this.runeOffset = this.theta2 + Math.PI / RUNE_STONES;
    this.runes = new RuneCircle(p2.x, p2.z, ringR, RUNE_STONES, (x, z) => exp.features.waterDepth(x, z) < 0.01, this.runeOffset);

    for (const f of this.openFlowers) exp.scene.add(f.group);
    exp.scene.add(this.debris.group, this.flies.group, this.blade.mesh, this.flower.group, this.runes.group, this.meteor.mesh, this.sparks.points.group);

    // Light: built around the chosen walk and pools.
    const walkDir = fwd(this.H);
    // Pick the sunset bearing where the far hills dip lowest, so the disc stays visible to the end.
    const eyeAt = this.path(13.5);
    eyeAt.y += 1.6;
    // Elevation (sine) of the nearest land along a bearing, as seen from where we stand.
    const landAt = (yaw: number) => {
      const f = fwd(yaw);
      let m = -1;
      for (let d = 8; d <= 420; d *= 1.18) {
        const x = eyeAt.x + f.x * d;
        const z = eyeAt.z + f.z * d;
        const e = terrainBase(x, z) - eyeAt.y;
        m = Math.max(m, e / Math.hypot(d, e));
      }
      return m;
    };
    let bestH = Infinity;
    for (let k = -12; k <= 12; k++) {
      const y = this.H + 0.2 + k * 0.05;
      const h = Math.max(horizonAt(fwd(y)), landAt(y)) + Math.abs(k) * 0.0006;
      if (h < bestH) {
        bestH = h;
        this.sunYaw = y;
      }
    }
    const sunsetDir = fwd(this.sunYaw);
    // In the gale we turn away from the sun toward the more open side, where the field is side-lit.
    this.gustYaw = landAt(this.sunYaw + 1.05) < landAt(this.sunYaw - 1.05) ? this.sunYaw + 1.05 : this.sunYaw - 1.05;
    const horizonDeg = MathUtils.radToDeg(Math.asin(bestH));
    const C1 = this.pondPos(this.theta1 + 0.45);
    const toFlower = new Vector3(this.flower.headPos.x - C1.x, 0, this.flower.headPos.z - C1.z).normalize();
    const W2 = this.fairyPos();
    const toPool2 = new Vector3(p2.x - W2.x, 0, p2.z - W2.z).normalize();
    this.presets = {
      afternoon: preset({
        elev: 21, azim: azOf(fwd(this.H - 1.0)), sun: '#ffe7bd', sunI: 1.15, ambient: '#9db4d6', ambientI: 0.5,
        zenith: '#1d5bc4', horizon: '#cfe2f2', fog: 0.0021, band: 0.4,
        cloudLit: '#fffaf0', cloudShade: '#a3adc9', mountain: '#5a7aa8', tint: '#fffbee', night: 0, exposure: 1.02, bloom: 1.25,
      }),
      sunset: preset({
        elev: horizonDeg + 3.2, azim: azOf(sunsetDir), sun: '#ff9450', sunI: 1.3, ambient: '#a07fa0', ambientI: 0.5,
        zenith: '#2b3f86', horizon: '#ffb27a', fog: 0.0026, band: 0.3,
        cloudLit: '#ffb08a', cloudShade: '#7d5478', mountain: '#5d4675', tint: '#ffe0c0', night: 0.12, exposure: 1.06, bloom: 1.7,
      }),
      // ...and slipping behind the hills as the gale comes.
      sunsetDown: preset({
        elev: horizonDeg - 1.4, azim: azOf(sunsetDir), sun: '#ff7a3c', sunI: 1.15, ambient: '#967aa6', ambientI: 0.48,
        zenith: '#283a80', horizon: '#ff9f70', fog: 0.0027, band: 0.28,
        cloudLit: '#ff9c86', cloudShade: '#6e4c74', mountain: '#55406f', tint: '#ffd6bc', night: 0.18, exposure: 1.05, bloom: 1.8,
      }),
      night: preset({
        elev: 30, azim: azOf(fwd(this.H + 2.3)), sun: '#a8bcf0', sunI: 0.45, ambient: '#4a5ea8', ambientI: 0.85,
        zenith: '#040c26', horizon: '#1b2a55', fog: 0.0022, band: 0.32,
        cloudLit: '#4a5a8a', cloudShade: '#0d1533', mountain: '#0f1838', tint: '#86a2e0', night: 1, exposure: 1.3, bloom: 1.9,
      }),
      dawn: preset({
        elev: 8, azim: azOf(toFlower.clone().applyAxisAngle(UP, 0.4)), sun: '#ffd6ae', sunI: 0.95, ambient: '#b0bcd6', ambientI: 0.58,
        zenith: '#6f94c6', horizon: '#f0dccb', fog: 0.005, band: 0.48,
        cloudLit: '#fff1e4', cloudShade: '#b4adc6', mountain: '#9aa3bd', tint: '#e6ecef', night: 0.08, exposure: 1.02, bloom: 1.3,
      }),
      fairy: preset({
        elev: 3.5, azim: azOf(toPool2.clone().applyAxisAngle(UP, -0.3)), sun: '#ff8a5c', sunI: 1.2, ambient: '#9b7cb0', ambientI: 0.52,
        zenith: '#33357e', horizon: '#ff9d84', fog: 0.0028, band: 0.28,
        cloudLit: '#ffa69a', cloudShade: '#6a4a82', mountain: '#4f3f78', tint: '#ffd9cc', night: 0.25, exposure: 1.05, bloom: 1.8,
      }),
      starry: preset({
        elev: 14, azim: azOf(fwd(this.lyingYaw + Math.PI)), sun: '#8ea4e0', sunI: 0.3, ambient: '#4256a0', ambientI: 0.8,
        zenith: '#02081c', horizon: '#142247', fog: 0.002, band: 0.3,
        cloudLit: '#3a4878', cloudShade: '#0a1130', mountain: '#0c1534', tint: '#7088c8', night: 1, exposure: 1.2, bloom: 2,
      }),
    };
    void walkDir;

    exp.tod.setPreset(this.presets.afternoon, 0.001);
    this.applyEnv(0);
    FX.lid = 0;
    FX.fade = 0;
    void titleTexture().then((t) => (FX.titleTex = t));

    this.birdGuides();
    this.cur.pos.copy(this.S).y += 0.72;
    this.cur.yaw = this.H;
  }

  /** Roll camera. Call from a user gesture after the audio engine started. */
  start(offset = 0): void {
    const ctx = this.exp.audio.ctx;
    if (ctx && !this.score) this.score = new Score(ctx, this.exp.audio.input);
    this.t0 = (ctx?.currentTime ?? 0) + 0.25 - offset;
    this.score?.start(this.t0);
    this.running = true;
    this.T = offset;
    this.snap = true;
  }

  get time(): number {
    return this.running ? Math.max(this.T, 0.001) : 0;
  }

  // ------------------------------------------------------------ location scouting

  private stand(x: number, z: number): boolean {
    const f = this.exp.features;
    return f.waterDepth(x, z) < 0.05 && (this.exp.controller.canStand?.(x, z) ?? true);
  }

  private pathRaw(sx: number, sz: number, H: number, s: number): Vector3 {
    const f = fwd(H);
    const r = right(H);
    const m = 1.1 * Math.sin(s * 0.11);
    const x = sx + f.x * s + r.x * m;
    const z = sz + f.z * s + r.z * m;
    return new Vector3(x, terrainHeight(x, z), z);
  }

  private path(s: number): Vector3 {
    return this.pathRaw(this.S.x, this.S.z, this.H, s);
  }

  private pathYaw(s: number): number {
    const a = this.path(s);
    const b = this.path(s + 0.5);
    return yawOf(b.sub(a));
  }

  /** A walk that stays dry, clear of the tree, opens onto a view, and starts among flowers. */
  private pickWalk(): void {
    const sp = this.exp.controller.position;
    const feat = this.exp.features;
    let best = -Infinity;
    this.S.copy(sp);
    this.H = this.exp.controller.yaw;
    const offs = [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5], [9, 9], [-9, 9], [9, -9], [-9, -9], [14, 0], [-14, 0], [0, 14], [0, -14]];
    for (const [ox, oz] of offs) {
      const sx = sp.x + ox;
      const sz = sp.z + oz;
      for (let k = 0; k < 24; k++) {
        const H = (k / 24) * Math.PI * 2;
        let ok = true;
        for (let s = 0; s <= 46 && ok; s += 1.5) {
          const p = this.pathRaw(sx, sz, H, s);
          if (!this.stand(p.x, p.z) || feat.sample(p.x, p.z, 1) > 0.04) ok = false;
        }
        if (!ok) continue;
        const h0 = terrainHeight(sx, sz);
        const f = fwd(H);
        const far = terrainBase(sx + f.x * 170, sz + f.z * 170);
        const mid = this.pathRaw(sx, sz, H, 20).y;
        const view = h0 - far;
        const slope = Math.abs(mid - h0);
        const flowers = this.exp.flowers?.listNear(sx, sz, H, feat, 1.5, 5.5, 0.8).length ?? 0;
        const score = view * 0.5 - slope * 1.2 + Math.min(flowers, 7) * 1.5 - Math.hypot(ox, oz) * 0.04;
        if (score > best) {
          best = score;
          this.S.set(sx, h0, sz);
          this.H = H;
        }
      }
    }
  }

  private pickPools(): [Pool, Pool] {
    const sp = this.S;
    const pools = this.exp.features.active.pools
      .filter((p) => p.r >= 3.5)
      .map((p) => ({ p, d: Math.hypot(p.x - sp.x, p.z - sp.z) }))
      .sort((a, b) => b.p.r - a.p.r + (a.d - b.d) * 0.02);
    if (pools.length === 0) {
      // No water nearby: invent a "pool" spot so the shots still have somewhere to look.
      const f = fwd(this.H + 1.2);
      const fake: Pool = { x: sp.x + f.x * 60, z: sp.z + f.z * 60, r: 6, level: terrainHeight(sp.x + f.x * 60, sp.z + f.z * 60), seed: 1 };
      return [fake, fake];
    }
    // Pools with room around them (chains crowd small pools together).
    const all = this.exp.features.active.pools;
    const roomy = (p: Pool) => all.every((o) => o === p || Math.hypot(o.x - p.x, o.z - p.z) > p.r + o.r + 7);
    const a = pools.find((q) => roomy(q.p))?.p ?? pools[0].p;
    const b =
      pools.find((q) => roomy(q.p) && q.p.r >= 5 && Math.hypot(q.p.x - a.x, q.p.z - a.z) > 30)?.p ??
      pools.find((q) => Math.hypot(q.p.x - a.x, q.p.z - a.z) > 30)?.p ??
      a;
    return [a, b];
  }

  private pondPos(theta: number, extra = 2.6): Vector3 {
    const p = this.pool1;
    const x = p.x + Math.cos(theta) * (p.r + extra);
    const z = p.z + Math.sin(theta) * (p.r + extra);
    return new Vector3(x, terrainHeight(x, z), z);
  }

  /** Pick a stretch of shore that stays dry for the walk-around, with dry ground opposite for the flower. */
  private placePond(): void {
    const p = this.pool1;
    let best = -Infinity;
    for (let k = 0; k < 36; k++) {
      const th = (k / 36) * Math.PI * 2;
      let ok = 0;
      for (let i = 0; i <= 6; i++) {
        const q = this.pondPos(th + (i / 6) * 0.45);
        if (this.stand(q.x, q.z) && this.exp.features.waterDepth(q.x, q.z) < 0.01) ok++;
      }
      const opp = th + 0.45 + Math.PI;
      const ox = p.x + Math.cos(opp) * (p.r * 1.06 + 0.6);
      const oz = p.z + Math.sin(opp) * (p.r * 1.06 + 0.6);
      const score = ok + (this.stand(ox, oz) ? 2 : 0) - Math.abs(terrainHeight(ox, oz) - p.level) * 0.5;
      if (score > best) {
        best = score;
        this.theta1 = th;
      }
    }
  }

  private fairyPos(extra = 3.8): Vector3 {
    const p = this.pool2;
    const x = p.x + Math.cos(this.theta2) * (p.r + extra);
    const z = p.z + Math.sin(this.theta2) * (p.r + extra);
    return new Vector3(x, terrainHeight(x, z), z);
  }

  private placeFairy(): void {
    const p = this.pool2;
    let best = -Infinity;
    for (let k = 0; k < 36; k++) {
      const th = (k / 36) * Math.PI * 2;
      let score = 0;
      for (const e of [3.5, 5.5, 9, 11]) {
        const x = p.x + Math.cos(th) * (p.r + e);
        const z = p.z + Math.sin(th) * (p.r + e);
        if (this.stand(x, z) && this.exp.features.sample(x, z, 1) < 0.2) score++;
      }
      score -= Math.abs(terrainHeight(p.x + Math.cos(th) * (p.r + 5.5), p.z + Math.sin(th) * (p.r + 5.5)) - p.level) * 0.3;
      if (score > best) {
        best = score;
        this.theta2 = th;
      }
    }
    // Lie down a little further back, on open grass.
    for (const e of [10, 12, 14, 8, 16]) {
      const x = p.x + Math.cos(this.theta2) * (p.r + e);
      const z = p.z + Math.sin(this.theta2) * (p.r + e);
      if (this.stand(x, z) && this.exp.features.sample(x, z, 1) < 0.02) {
        this.lying.set(x, terrainHeight(x, z), z);
        break;
      }
    }
    if (this.lying.lengthSq() === 0) this.lying.copy(this.fairyPos(10));
    this.lyingYaw = this.theta2 * 1.7 + 0.6;
  }

  /** Three flowers placed in front of the opening shot, left to right, at eye level in the grass. */
  private pickFlowers(): void {
    const f = fwd(this.H);
    const r = right(this.H);
    const spots: [number, number, number][] = [
      [1.7, -0.75, 1.0], [2.5, 0.05, 1.08], [2.0, 0.8, 0.98],
    ];
    this.flowerTargets = [];
    spots.forEach(([d, side, h], i) => {
      const b = this.S.clone().addScaledVector(f, d).addScaledVector(r, side);
      b.y = terrainHeight(b.x, b.z);
      const fl = new GlowFlower(b, h, [0.07, 0.1, 0.075][i], [SPECIES.daisy, SPECIES.poppy, SPECIES.cornflower][i], 0, 0.3 + i * 0.2);
      this.openFlowers.push(fl);
      this.flowerTargets.push(fl.headPos);
    });
  }

  private buildFlies(): void {
    const rnd = mulberry(91);
    for (let i = 0; i < 200; i++) {
      // Most of them along the night walk and around where it stops; the rest scattered wide.
      const along = i < 140;
      const centre = along ? this.path(13 + rnd() * 9) : this.path(16.5);
      const a = rnd() * Math.PI * 2;
      const d = along ? 1.2 + rnd() * 5 : 2 + Math.sqrt(rnd()) * 16;
      const x = centre.x + Math.cos(a) * d;
      const z = centre.z + Math.sin(a) * d;
      this.flyData.push({
        anchor: new Vector3(x, 0.5 + rnd() * 1.3, z),
        s: [rnd(), rnd(), rnd(), rnd(), rnd(), rnd()],
      });
    }
  }

  /** Hero fireflies (0..2 fly, 3 sits on the blade tip). */
  private heroFly(i: number, T: number): Vector3 {
    const f = fwd(this.nightYaw);
    const r = right(this.nightYaw);
    const p = this.N1.clone();
    let h = 0.4;
    if (i === 0) {
      const u = T - M.fireflies;
      p.addScaledVector(f, 3.0 + 0.25 * Math.sin(T * 0.6)).addScaledVector(r, -0.95 + 0.2 * u);
      h = 1.08 + 0.08 * Math.sin(T * 1.2);
    } else if (i === 1) {
      const u = T - M.fireflies - 4;
      p.addScaledVector(f, 4.1 + 0.2 * Math.sin(T * 0.5)).addScaledVector(r, 1.15 - 0.17 * u);
      h = 1.16 + 0.1 * Math.sin(T * 0.9 + 1);
    } else if (i === 2) {
      const u = T - M.fireflies - 7.5;
      p.addScaledVector(f, 2.3 + 0.1 * u).addScaledVector(r, -0.35 + 0.16 * u);
      h = 1.02 + 0.07 * Math.sin(T * 1.5);
    } else {
      return this.blade.tip.clone().add(new Vector3(0, 0.014, 0));
    }
    p.y = terrainHeight(p.x, p.z) + h;
    return p;
  }

  // ------------------------------------------------------------ birds

  private birdGuides(): void {
    const f = fwd(this.H);
    const r = right(this.H);
    const A0 = this.path(6).addScaledVector(f, 80);
    const S0 = this.path(0);
    const Ac = this.path(13.5).addScaledVector(f, 26);
    const groundA = terrainHeight(A0.x, A0.z);
    const groundAc = terrainHeight(Ac.x, Ac.z);
    const sunDir = fwd(this.sunYaw);

    const far = (T: number) =>
      A0.clone().addScaledVector(r, -70 + 15 * (T - M.birdsFar)).setY(groundA + 26 + 2 * Math.sin(T));
    const line = (T: number) => {
      const u = T - M.overhead;
      const p = S0.clone().addScaledVector(f, -45 + 13 * u).addScaledVector(r, 3 - 0.4 * u);
      p.y = terrainHeight(p.x, p.z) + 9 + 0.6 * u;
      return p;
    };
    const arc = (T: number) => {
      const phi = -Math.PI / 2 + 0.42 * (T - M.swallows);
      return Ac.clone()
        .addScaledVector(r, Math.cos(phi) * 11)
        .addScaledVector(f, Math.sin(phi) * 7)
        .setY(groundAc + 17 + 2 * Math.sin(T * 0.5));
    };
    const away = (T: number) => arc(M.sun - 1).addScaledVector(sunDir, 14 * (T - M.sun + 1)).add(new Vector3(0, 1.5 * (T - M.sun + 1), 0));
    const near = (T: number) => {
      let p = line(T);
      p = p.lerp(arc(T), sstep(M.swallows - 2.5, M.swallows + 1, T));
      return p.lerp(away(T), sstep(M.sun - 1, M.sun + 1, T));
    };

    this.exp.birds.guide = (fi) => {
      const T = this.T;
      if (!this.running) return null;
      let fn: ((t: number) => Vector3) | null = null;
      if (fi === 0 && T >= M.birdsFar && T < M.birdsFar + 10) fn = far;
      if (fi === 1 && T >= M.overhead && T < M.gust + 2) fn = near;
      if (!fn) return null;
      const p = fn(T);
      const v = fn(T + 0.05).sub(p).multiplyScalar(20);
      if (!this.warped[fi]) {
        this.warped[fi] = true;
        this.exp.birds.warpFlock(fi, p, v);
      }
      return { p, v };
    };
  }

  // ------------------------------------------------------------ per frame

  update(dt: number, camera: PerspectiveCamera): number {
    const ctx = this.exp.audio.ctx;
    if (this.running) {
      if (!this.hold) this.T = ctx && ctx.state === 'running' ? ctx.currentTime - this.t0 : this.T + dt;
      this.score?.update();
    }
    const T = Math.max(0, this.T);
    this.events(T);
    this.shot(T);
    this.applyEnv(T);
    this.applyRig(dt, camera, T);
    this.props(dt, T, camera);

    if (this.running && !this.ended && T > M.end + 0.6) {
      this.ended = true;
      this.onEnd?.();
    }
    return this.cur.dof;
  }

  /** One-off moments: light changes and cuts. */
  private events(T: number): void {
    const once = (key: string, at: number, fn: () => void) => {
      if (T >= at && !this.fired.has(key)) {
        this.fired.add(key);
        fn();
      }
    };
    const tod = this.exp.tod;
    once('sunset', M.swallows + 0.6, () => tod.setPreset(this.presets.sunset, 7.5));
    once('sunsetDown', M.sun + 0.5, () => tod.setPreset(this.presets.sunsetDown, M.blink - M.sun - 0.3));
    once('night', M.blink + 0.4, () => {
      tod.setPreset(this.presets.night, 0.001);
      this.exp.cut();
    });
    once('dawn', M.dawn, () => tod.setPreset(this.presets.dawn, 0.001));
    once('pondCut', M.pondCut, () => {
      this.snap = true;
    });
    once('fairy', M.fairy, () => {
      tod.setPreset(this.presets.fairy, 0.001);
      this.snap = true;
      this.exp.cut();
    });
    once('stars', M.stars, () => {
      tod.setPreset(this.presets.starry, 0.001);
      this.exp.sky.stars.value = 1;
      params.atmosphere.alto = 0.08;
      params.atmosphere.cirrus = 0.12;
      this.snap = true;
      this.exp.cut();
    });
  }

  private applyEnv(T: number): void {
    params.wind.strength = this.wind(T);
    // Blades give way in the gust.
    U.uStiffness.value = params.grass.stiffness * (1 - 0.12 * sstep(M.gust + 1, M.gust + 3.5, T) * (1 - sstep(M.blink, M.blink + 0.4, T)));
    params.wind.gust = this.gust(T);
    this.exp.applyWind();
    U.uCloudCover.value = this.clouds(T);
    FX.lid = this.running ? this.lid(T) : 0;
    FX.blur = this.blur(T);
    FX.fade = this.running ? this.fade(T) : 0;
    FX.swirl = this.swirl(T);
    FX.title = this.title(T);
    FX.bloom = this.bloom(T);
    FX.exposure = this.exposure(T);

    // Flashes: warm white (firefly), petal pink (flower), cold blue (vortex).
    let amt = 0;
    if (T < M.dawn + 4) {
      amt = track([[M.white - 2.3, 0], [M.white, 3.6], [M.dawn + 0.3, 2.6], [M.dawn + 2.0, 0]])(T);
      FX.flash.setRGB(1.0, 0.95, 0.78);
    } else if (T < M.fairy + 3) {
      amt = track([[M.flare - 1.1, 0], [M.flare, 4.2], [M.fairy + 0.3, 3.4], [M.fairy + 1.8, 0]])(T);
      FX.flash.setRGB(1.0, 0.62, 0.95).lerp(new Color(1, 1, 1), sstep(M.flare - 0.2, M.fairy, T));
    } else {
      amt = track([[M.stars - 0.9, 0], [M.stars - 0.03, 3.6], [M.stars + 0.2, 2.4], [M.stars + 1.7, 0]])(T);
      FX.flash.setRGB(0.72, 0.84, 1.0);
    }
    FX.flashAmt = amt;
    FX.saturation = 1.14 + 0.08 * sstep(M.swallows, M.sun + 2, T) * (1 - sstep(M.gust + 3, M.blink, T));
  }

  /** Where the camera wants to be and what it looks at. */
  private shot(T: number): void {
    const w = this.want;
    w.roll = 0;
    w.focus = -1;
    this.kneel = 0;
    this.exp.trailPart = null;
    this.dofScale = 1.5;
    this.angRate = 5;
    this.posRate = 8;
    this.exp.trail.bodyScale = 0;

    if (T < M.dawn) this.meadow(T);
    else if (T < M.pondCut) this.dawnRise(T);
    else if (T < M.fairy) this.pond(T);
    else if (T < M.stars) this.fairy(T);
    else this.stars(T);
  }

  // ---- meadow: opening, flowers, the walk, the swallows, the sun, the gust, night, fireflies

  private meadow(T: number): void {
    const w = this.want;
    const s = this.walkS(T);
    const base = this.path(s);
    const py = this.pathYaw(s);
    const eye = track([
      [0, 0.72], [M.rise + 0.4, 0.72], [M.rise + 4.2, 1.6], [M.fireflies - 1.2, 1.6], [M.fireflies + 1.0, 1.2],
    ])(T);
    w.pos.copy(base).setY(base.y + eye);
    w.fov = track([
      [0, 32], [M.rise, 32], [M.rise + 3, 70], [M.swallows, 70], [M.swallows + 2.2, 11], [M.swallows + 4.5, 11],
      [M.swallows + 6.5, 6.5], [M.sun, 6.5], [M.sun + 2.6, 55], [M.blink, 55], [M.night, 62], [M.fireflies, 62],
      [M.fireflies + 2.6, 18], [M.perch, 18], [M.white, 11],
    ])(T);
    w.dof = track([[0, 1], [M.rise, 1], [M.rise + 1.6, 0], [M.fireflies + 0.5, 0], [M.fireflies + 2, 1]])(T);
    if (s > 0.3 && T < M.swallows + 1) this.exp.trail.bodyScale = 1;

    if (T < M.rise + 1.5) {
      // Opening: low in the grass at flower height, sliding very slowly; focus on the blades, then on flowers.
      const r = right(this.H);
      w.pos.addScaledVector(r, -0.25 + 0.03 * T);
      const fy = this.flowerTargets.reduce((m, f) => m + f.y, 0) / this.flowerTargets.length + 0.3;
      w.pos.y = MathUtils.lerp(fy, w.pos.y, sstep(M.rise, M.rise + 1.5, T));
      const baseLook = w.pos.clone().addScaledVector(fwd(this.H + 0.12 + 0.03 * Math.sin(T * 0.3)), 3).add(new Vector3(0, -0.05, 0));
      const [A, B, C] = this.flowerTargets;
      // Awake: the blades in focus, then flower one, then flower two, then up and away.
      void C;
      const seq: [number, Vector3][] = [
        [M.flowers, baseLook], [M.flowers + 1.0, A], [M.flowers + 2.4, A], [M.flowers + 3.4, B], [M.rise + 1.5, B],
      ];
      const a = this.follow(T, w.pos, seq, baseLook);
      w.yaw = a.yaw;
      w.pitch = a.pitch;
      // Part the grass around whichever flower the eye is on.
      const near = [A, B].reduce((m, f) => (aim(w.pos, f).yaw - a.yaw) ** 2 < (aim(w.pos, m).yaw - a.yaw) ** 2 ? f : m, A);
      if (T > M.flowers - 1.5) this.exp.trailPart = { x: near.x, z: near.z, strength: 1 };
      this.dofScale = 0.9;
      w.focus = T < M.flowers ? 1.6 + 0.1 * Math.sin(T * 0.5) : a.dist;
      if (T > M.rise) {
        const k = sstep(M.rise, M.rise + 1.5, T);
        w.yaw = lerpAngle(w.yaw, py, k);
        w.pitch = MathUtils.lerp(w.pitch, -0.02, k);
      }
      this.angRate = 3;
      // Kneeling: part a little hollow in the grass so the eye can see through.
      this.exp.trail.bodyScale = 1.6;
      this.kneel = 1;
      return;
    }

    // Walking: an easy gaze that drifts with the path.
    let yaw = py + 0.1 * Math.sin(T * 0.21);
    let pitch = -0.03 + 0.02 * Math.sin(T * 0.17);
    const birds = this.exp.birds;
    const f0 = aim(w.pos, birds.flockCentre(0));
    const f1 = aim(w.pos, birds.flockCentre(1));
    const wFar = sstep(M.birdsFar + 0.8, M.birdsFar + 2.5, T) * (1 - sstep(M.overhead + 0.5, M.overhead + 2, T)) * 0.55;
    yaw = lerpAngle(yaw, f0.yaw, wFar);
    pitch = MathUtils.lerp(pitch, f0.pitch, wFar);
    const wNear = sstep(M.overhead + 1.6, M.overhead + 3.2, T) * (1 - sstep(M.sun, M.sun + 2.4, T));
    yaw = lerpAngle(yaw, f1.yaw, wNear);
    pitch = MathUtils.lerp(pitch, Math.min(f1.pitch, 1.25), wNear);
    if (T >= M.swallows - 1) this.angRate = 3.2;

    // The setting sun, then the gust across the field.
    const sunYaw = this.sunYaw;
    const wSun = sstep(M.sun, M.sun + 2.6, T);
    yaw = lerpAngle(yaw, sunYaw, wSun);
    pitch = MathUtils.lerp(pitch, 0.05, wSun);
    // The gale hits: turn the face away from it, over the rolling field.
    const wTurn = sstep(M.gust + 0.4, M.gust + 2.6, T);
    yaw = lerpAngle(yaw, this.gustYaw, wTurn);
    pitch = MathUtils.lerp(pitch, -0.14, wTurn);
    if (T > M.gust && T < M.blink + 0.5) {
      // Buffeted: the head shakes harder as the gust builds and turns a little away from it.
      const g = sstep(M.gust + 0.5, M.blink - 0.5, T);
      w.roll = (0.006 + 0.03 * g) * Math.sin(T * 7.3) + (0.004 + 0.018 * g) * Math.sin(T * 13.1 + 1.0) - 0.03 * g;
      yaw += (0.012 * Math.sin(T * 9.7) + 0.008 * Math.sin(T * 17.3)) * g - 0.12 * g;
      pitch += (0.01 * Math.sin(T * 11.3 + 2.0) + 0.006 * Math.sin(T * 19.1)) * g - 0.05 * g;
      w.pos.y -= 0.12 * g;
      this.angRate = 9;
    }

    // Night: wander slowly, looking around among the fireflies.
    if (T >= M.blink + 0.4) {
      yaw = py + 0.3 * Math.sin((T - M.night) * 0.33 + 0.6);
      pitch = -0.07 + 0.04 * Math.sin(T * 0.2);
      if (T >= M.night + 0.6) this.exp.trail.bodyScale = 1;
      if (T > M.fireflies - 1) {
        this.exp.trail.bodyScale = 1.6;
        this.kneel = 1;
      }
    }

    // Fireflies, close: follow one, then another, then another; then the one on the blade.
    if (T >= M.fireflies - 0.5) {
      const h = (i: number) => this.heroFly(i, T);
      const seq: [number, Vector3][] = [
        [M.fireflies + 0.5, w.pos.clone().addScaledVector(fwd(yaw), 3).setY(w.pos.y - 0.1)],
        [M.fireflies + 1.8, h(0)], [M.fireflies + 4.2, h(0)], [M.fireflies + 5.2, h(1)], [M.fireflies + 7.8, h(1)],
        [M.fireflies + 8.8, h(2)], [M.fireflies + 10.6, h(2)], [M.perch, h(3)],
      ];
      const k = sstep(M.fireflies - 0.5, M.fireflies + 0.5, T);
      const a = this.follow(T, w.pos, seq, seq[0][1]);
      yaw = lerpAngle(yaw, a.yaw, k);
      pitch = MathUtils.lerp(pitch, a.pitch, k);
      w.focus = a.dist;
      this.angRate = 4.5;
      // Hands part the grass where the eye rests.
      const tgt = [h(0), h(1), h(2), h(3)].reduce((m, q) => (aim(w.pos, q).yaw - a.yaw) ** 2 < (aim(w.pos, m).yaw - a.yaw) ** 2 ? q : m);
      this.exp.trailPart = { x: tgt.x, z: tgt.z, strength: 0.8 };
      if (T >= M.perch - 1) {
        // Stare: drift toward it.
        const tip = h(3);
        const u = easeIn(sstep(M.perch, M.white + 0.2, T));
        const dir = tip.clone().sub(w.pos);
        const len = dir.length();
        w.pos.addScaledVector(dir.normalize(), Math.max(0, len - 0.5) * u);
        const a2 = aim(w.pos, tip);
        yaw = a2.yaw;
        pitch = a2.pitch;
        w.focus = a2.dist;
      }
    }
    w.yaw = yaw;
    w.pitch = pitch;
  }

  // ---- dawn breaks where the firefly was; the gaze lifts to the sky and comes down by a pond

  private dawnRise(T: number): void {
    const w = this.want;
    const tip = this.heroFly(3, M.white);
    const start = this.N1.clone();
    const dir = tip.clone().sub(start).setY(0).normalize();
    const p = start.clone().addScaledVector(dir, 2.4);
    const g = terrainHeight(p.x, p.z);
    p.y = g + track([[M.dawn, tip.y - g + 0.05], [M.dawn + 2.6, 1.5]])(T);
    p.addScaledVector(dir, -track([[M.dawn, 0], [M.dawn + 2.6, 1.2]])(T));
    w.pos.copy(p);
    const a0 = aim(p, tip);
    const pondYaw = aim(this.pondPos(this.theta1), new Vector3(this.pool1.x, this.pool1.level, this.pool1.z)).yaw;
    const k = sstep(M.skyward, M.pondCut - 0.2, T);
    w.yaw = lerpAngle(yawOf(dir), pondYaw, k);
    w.pitch = MathUtils.lerp(Math.max(a0.pitch, -0.05) * (1 - sstep(M.dawn, M.dawn + 2, T)), 1.08, k);
    w.fov = track([[M.dawn, 11], [M.dawn + 2.4, 58], [M.pondCut, 64]])(T);
    w.dof = track([[M.dawn, 1], [M.dawn + 1.4, 0]])(T);
    w.focus = 3;
    this.angRate = 3;
  }

  private pond(T: number): void {
    const w = this.want;
    const p = this.pool1;
    const centre = new Vector3(p.x, p.level, p.z);
    const th = this.theta1 + 0.45 * sstep(M.orbit, M.details - 0.4, T);
    const pos = this.pondPos(th);
    const eye = track([[M.pondCut, 1.55], [M.details - 0.5, 1.55], [M.details + 1, 1.18]])(T);
    w.pos.copy(pos).setY(pos.y + eye);
    const look = aim(w.pos, centre.clone().add(new Vector3(0, 0.2, 0)));
    let yaw = look.yaw + 0.12 * Math.sin((T - M.orbit) * 0.4) * sstep(M.orbit, M.orbit + 2, T);
    let pitch = MathUtils.lerp(1.08, look.pitch, sstep(M.pond, M.orbit, T));
    w.fov = track([[M.pondCut, 64], [M.orbit, 60], [M.details, 60], [M.details + 1.5, 21], [M.call + 1, 21], [M.call + 2.5, 24], [M.dive, 22], [M.dive + 2.5, 9], [M.dive + 3.2, 9], [M.flare, 42]])(T);
    w.dof = track([[M.details, 0], [M.details + 1.4, 1]])(T);
    this.angRate = T < M.orbit ? 2.6 : 4;

    if (T >= M.details - 0.5) {
      this.kneel = 1;
      this.exp.trail.bodyScale = 1.8;
      const d = this.detailTargets(w.pos, yaw);
      const fl = this.flower.headPos;
      const seq: [number, Vector3][] = [
        [M.details, centre], [M.details + 1.2, d[0]], [M.details + 3.6, d[0]], [M.details + 4.6, d[1]],
        [M.details + 6.8, d[1]], [M.details + 7.8, d[2]], [M.call + 0.8, d[2]], [M.call + 2.0, fl],
      ];
      const a = this.follow(T, w.pos, seq, centre);
      const k = sstep(M.details - 0.5, M.details + 0.5, T);
      yaw = lerpAngle(yaw, a.yaw, k);
      pitch = MathUtils.lerp(pitch, a.pitch, k);
      w.focus = a.dist;
    }

    if (T >= M.dive + 2.4) {
      // Pulled across the water into the flower.
      const u = easeIn(sstep(M.dive + 2.6, M.flare + 0.1, T));
      const from = w.pos.clone();
      const to = this.flower.headPos.clone();
      const dir = to.clone().sub(from);
      const len = dir.length();
      dir.normalize();
      w.pos.copy(from).addScaledVector(dir, (len - 0.13) * u);
      w.pos.y += Math.sin(u * Math.PI) * 0.35;
      const a = aim(w.pos, to);
      yaw = a.yaw;
      pitch = a.pitch;
      w.focus = a.dist;
      this.angRate = 9;
      this.posRate = 10;
    }
    w.yaw = yaw;
    w.pitch = pitch;
  }

  /** Near, middle and far details by the pond: a lily pad, a rock on the rim, a lily across. */
  private detailTargets(cam: Vector3, yaw: number): Vector3[] {
    if (this.details) return this.details;
    const p = this.pool1;
    const f = fwd(yaw);
    const inFront = (q: Vector3, a: number, b: number) => {
      const d = q.clone().sub(cam).setY(0);
      const len = d.length();
      return len > a && len < b && d.normalize().dot(f) > 0.55;
    };
    const pads = this.exp.aquatic.padSpots
      .filter((s) => Math.hypot(s.x - p.x, s.z - p.z) < p.r)
      .map((s) => new Vector3(s.x, s.y + 0.03, s.z));
    const flowers = this.exp.aquatic.padSpots
      .filter((s) => s.flower && Math.hypot(s.x - p.x, s.z - p.z) < p.r)
      .map((s) => new Vector3(s.x, s.y + 0.06, s.z));
    const rocks = this.exp.features.active.rocks
      .filter((r) => {
        const d = Math.hypot(r.x - p.x, r.z - p.z);
        return d > p.r * 0.7 && d < p.r * 1.45;
      })
      .map((r) => new Vector3(r.x, terrainHeight(r.x, r.z) + r.s * r.squash * 0.3, r.z));
    const byDist = (a: Vector3, b: Vector3) => a.distanceTo(cam) - b.distanceTo(cam);
    const centre = new Vector3(p.x, p.level, p.z);
    const shore = (frac: number, side: number) => {
      const d = centre.clone().sub(cam).setY(0);
      const q = cam.clone().addScaledVector(d, frac).addScaledVector(right(yaw), side);
      q.y = p.level + 0.05;
      return q;
    };
    const near = pads.filter((q) => inFront(q, 2.8, 8)).sort(byDist)[0] ?? shore(0.35, -0.6);
    const mid =
      pads.filter((q) => inFront(q, 5, 12) && q.distanceTo(near) > 1.5).sort(byDist)[0] ??
      rocks.filter((q) => inFront(q, 6, 14)).sort(byDist)[0] ??
      shore(0.75, 1.2);
    const far =
      flowers.filter((q) => inFront(q, 5, 22) && q.distanceTo(near) > 2).sort(byDist).pop() ??
      pads.filter((q) => inFront(q, 6, 22)).sort(byDist).pop() ??
      shore(1.4, -1.5);
    this.details = [near, mid, far];
    return this.details;
  }

  // ---- fairy pool at sunset: wake, drift to the centre, follow the runes into the vortex

  private fairy(T: number): void {
    const w = this.want;
    const p = this.pool2;
    const W2 = this.fairyPos();
    const centre = new Vector3(p.x, p.level, p.z);
    const toC = centre.clone().sub(W2).setY(0).normalize();
    const wake = W2.clone().addScaledVector(toC, 1.6 * sstep(M.fairy + 2, M.float, T));
    wake.y = terrainHeight(wake.x, wake.z) + track([[M.fairy, 1.05], [M.fairy + 4.5, 1.65]])(T);
    const hover = centre.clone().setY(p.level + 1.7);
    const u = sstep(M.float, M.follow, T);
    w.pos.copy(wake).lerp(hover, u);
    w.pos.y += Math.sin(u * Math.PI) * 0.6;
    const vort = sstep(M.vortex, M.stars, T);
    w.pos.y += vort * 1.6;
    w.fov = track([[M.fairy, 62], [M.float, 58], [M.follow, 66], [M.vortex, 72], [M.stars, 90]])(T);
    w.dof = 0;

    const lookCentre = aim(w.pos, centre.clone().add(new Vector3(0, 0.4, 0)));
    let yaw = lookCentre.yaw + 0.18 * Math.sin((T - M.fairy) * 0.35) * (1 - u);
    let pitch = lookCentre.pitch * (1 - u) - 0.1 * u;

    // The eye runs after the light: continuous progress along the ring of stones.
    const prog = this.runeProgress(T);
    const followYaw = -Math.PI / 2 - this.runeOffset - (prog * Math.PI * 2) / RUNE_STONES;
    const kf = sstep(M.float + 2.5, M.follow, T);
    yaw = lerpAngle(yaw, followYaw, kf);
    this.angRate = T > M.follow ? 9 : 3;
    if (T > M.accel) this.angRate = 14;
    pitch = MathUtils.lerp(pitch, -0.12, kf);
    pitch = MathUtils.lerp(pitch, 1.25, sstep(M.vortex + 0.3, M.stars - 0.2, T));
    w.yaw = yaw;
    w.pitch = pitch;
    w.roll = -0.25 * vort;
  }

  /** Fractional index of the latest rune note (stones count up, unwrapped). */
  private runeProgress(T: number): number {
    let idx = 0;
    for (let i = 0; i < RUNE_NOTES.length; i++) {
      if (RUNE_NOTES[i].t > T) {
        if (i === 0) return 0;
        const a = RUNE_NOTES[i - 1].t;
        const b = RUNE_NOTES[i].t;
        return i - 1 + sstep(a, b, T) * 0.35 + clamp01((T - a) / (b - a)) * 0.65;
      }
      idx = i;
    }
    return idx + 1;
  }

  // ---- lying under the stars; a falling star; the title

  private stars(T: number): void {
    const w = this.want;
    w.pos.copy(this.lying).y += 0.34;
    const unwind = 2.6 * (1 - sstep(M.stars, M.stars + 3.5, T));
    w.yaw = this.lyingYaw + unwind + 0.012 * (T - M.stars);
    w.pitch = 1.22;
    w.roll = 0;
    w.fov = track([[M.stars, 90], [M.stars + 3, 82]])(T);
    w.dof = 0;
    this.angRate = 12;
    this.exp.trail.bodyScale = 0.7;
    if (T >= M.meteor && this.meteorSet) {
      // Follow the falling star a little.
      const k = sstep(M.meteor, M.meteor + 1.5, T) * (1 - sstep(M.title + 1, M.title + 4, T));
      const a = aim(this.cur.pos, this.meteor.head);
      w.yaw = lerpAngle(w.yaw, a.yaw, k * 0.3);
      w.pitch = MathUtils.lerp(w.pitch, Math.min(a.pitch, 1.4), k * 0.3);
      this.angRate = 2;
    }
  }

  /** Gust debris: spawns upwind of the camera and races past on the wind, tumbling. */
  private updateDebris(dt: number, T: number, camera: PerspectiveCamera, viewH: number): void {
    const k = sstep(M.gust + 0.8, M.gust + 3, T) * (1 - sstep(M.blink + 0.1, M.blink + 0.4, T));
    const wd = U.uWindDir.value;
    const wind = new Vector3(wd.x, 0, wd.y);
    const side = new Vector3(-wd.y, 0, wd.x);
    const target = Math.floor(k * 340);
    while (this.debrisP.length < target) {
      const r = Math.random();
      // Born in the view (shifted upwind), so they stream across the frame.
      const fv = camera.getWorldDirection(new Vector3()).setY(0).normalize();
      const rv = new Vector3(-fv.z, 0, fv.x);
      const p = camera.position
        .clone()
        .addScaledVector(fv, 1.2 + Math.random() * 9)
        .addScaledVector(rv, (Math.random() - 0.5) * 9)
        .addScaledVector(wind, -(2 + Math.random() * 6))
        .add(new Vector3(0, (Math.random() - 0.55) * 2.4, 0));
      this.debrisP.push({
        p,
        v: wind.clone().multiplyScalar(7 + Math.random() * 8).add(new Vector3(0, (Math.random() - 0.3) * 1.2, 0)),
        c: r < 0.55 ? new Color(1.0, 0.86, 0.55) : r < 0.8 ? new Color(1.0, 0.7, 0.75) : new Color(0.95, 0.95, 0.85),
        s: 0.018 + Math.random() * 0.04,
        a: 0.35 + Math.random() * 0.6,
        ph: Math.random() * 100,
      });
    }
    let n = 0;
    for (let i = this.debrisP.length - 1; i >= 0; i--) {
      const d = this.debrisP[i];
      d.v.y += Math.sin(T * 3 + d.ph) * 2.5 * dt;
      d.v.addScaledVector(side, Math.sin(T * 2.3 + d.ph * 1.7) * 3 * dt);
      d.p.addScaledVector(d.v, dt);
      d.ph += dt * 0.0001;
      const ahead = d.p.clone().sub(camera.position).dot(wind);
      if (ahead > 12 || d.p.distanceTo(camera.position) > 16 || k <= 0.001) {
        this.debrisP.splice(i, 1);
        continue;
      }
    }
    for (const d of this.debrisP) {
      const tw = 0.6 + 0.4 * Math.sin(T * 14 + d.ph); // tumbling petals catch the light
      this.debris.set(n++, d.p, d.c, d.a * tw * 2.6 * Math.max(k, 0.2), d.s);
    }
    this.debris.count = n;
    this.debris.commit(viewH);
  }

  // ------------------------------------------------------------ helpers

  /** Look-at along a list of (time, target) keys: holds between equal targets, eases between different ones. */
  private follow(T: number, from: Vector3, keys: [number, Vector3][], fallback: Vector3) {
    if (T <= keys[0][0]) return aim(from, keys[0][1] ?? fallback);
    for (let i = 1; i < keys.length; i++) {
      if (T <= keys[i][0]) {
        const a = aim(from, keys[i - 1][1]);
        const b = aim(from, keys[i][1]);
        const k = sstep(keys[i - 1][0], keys[i][0], T);
        return { yaw: lerpAngle(a.yaw, b.yaw, k), pitch: MathUtils.lerp(a.pitch, b.pitch, k), dist: MathUtils.lerp(a.dist, b.dist, k) };
      }
    }
    return aim(from, keys[keys.length - 1][1]);
  }

  private applyRig(dt: number, camera: PerspectiveCamera, T: number): void {
    const c = this.cur;
    const w = this.want;
    if (this.snap || !this.running) {
      this.snap = false;
      c.pos.copy(w.pos);
      c.yaw = w.yaw;
      c.pitch = w.pitch;
      c.roll = w.roll;
      c.fov = w.fov;
      c.dof = w.dof;
      c.focus = w.focus;
      this.lastXZ.copy(w.pos);
    } else {
      const kp = 1 - Math.exp(-dt * this.posRate);
      const ka = 1 - Math.exp(-dt * this.angRate);
      c.pos.lerp(w.pos, kp);
      c.yaw = lerpAngle(c.yaw, w.yaw, ka);
      c.pitch += (w.pitch - c.pitch) * ka;
      c.roll += (w.roll - c.roll) * ka;
      const kf = 1 - Math.exp(-dt * 6);
      c.fov += (w.fov - c.fov) * kf;
      c.dof += (w.dof - c.dof) * kf;
      c.focus = w.focus <= 0 ? w.focus : c.focus <= 0 ? w.focus : c.focus + (w.focus - c.focus) * (1 - Math.exp(-dt * 8));
    }

    // Walking bob and footsteps from the distance actually covered on foot.
    const ground = terrainHeight(c.pos.x, c.pos.z);
    const onFoot = c.pos.y - ground > 1.2 && (T < M.fairy || T > M.stars + 99);
    const step = Math.hypot(c.pos.x - this.lastXZ.x, c.pos.z - this.lastXZ.z);
    const speed = dt > 0 ? step / dt : 0;
    this.lastXZ.copy(c.pos);
    if (onFoot && speed < 4) this.walked += step;
    this.bobAmp += (MathUtils.clamp(onFoot ? speed / 1.4 : 0, 0, 1.4) - this.bobAmp) * (1 - Math.exp(-dt * 4));
    const ph = (this.walked * Math.PI) / 0.72;
    const stepIdx = Math.floor(ph / Math.PI);
    if (stepIdx !== this.lastStep) {
      this.lastStep = stepIdx;
      if (onFoot && speed > 0.25 && this.running) this.exp.audio.step(MathUtils.clamp(speed / 2.5, 0.25, 1));
    }
    const bobY = (-Math.abs(Math.sin(ph)) * 0.035 + 0.0175) * this.bobAmp;
    const breathe = Math.sin(T * 1.2) * 0.005;

    camera.position.set(c.pos.x, c.pos.y + bobY + breathe, c.pos.z);
    camera.rotation.set(c.pitch, c.yaw, c.roll + Math.sin(ph) * 0.004 * this.bobAmp, 'YXZ');
    if (Math.abs(camera.fov - c.fov) > 0.001) {
      camera.fov = c.fov;
      camera.updateProjectionMatrix();
    }
    FX.focus = c.focus;
    FX.dofScale = this.dofScale;
    if (this.pose) {
      camera.position.copy(this.pose.pos);
      camera.lookAt(this.pose.look);
      camera.fov = this.pose.fov;
      camera.updateProjectionMatrix();
      FX.focus = this.pose.focus;
    }

    // Lens flare: the low sun in (or near) frame, while it clears the far hills.
    const sd = U.uSunDir.value;
    const fwdv = camera.getWorldDirection(new Vector3());
    const facing = sstep(0.55, 0.97, fwdv.dot(sd));
    const visible = sstep(-0.004, 0.012, sd.y - horizonAt(new Vector3(sd.x, 0, sd.z).normalize())) * (1 - sstep(0.3, 0.6, this.exp.tod.night));
    const sp = camera.position.clone().addScaledVector(sd, 900).project(camera);
    FX.sunUv.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    FX.flare = sp.z < 1 ? facing * visible : 0;

    // Feed the player state the rest of the world reads (audio, trail, feature map).
    const ctl = this.exp.controller;
    ctl.position.set(c.pos.x, ground, c.pos.z);
    ctl.yaw = c.yaw;
    ctl.pitch = c.pitch;
    ctl.speed = onFoot ? speed : 0;
    ctl.velocity.set(0, 0);
    ctl.crouch = this.kneel;
  }

  private props(dt: number, T: number, camera: PerspectiveCamera): void {
    const viewH = this.exp.renderer.getContext().drawingBufferHeight;
    const night = sstep(M.blink + 0.35, M.blink + 0.45, T) * (1 - sstep(M.dawn - 0.05, M.dawn + 0.3, T));

    for (const f of this.openFlowers) {
      f.group.visible = T < M.rise + 6;
      if (f.group.visible) f.update(T, camera, 0, viewH);
    }

    // Fireflies.
    let n = 0;
    if (night > 0.001) {
      for (let i = 0; i < this.flyData.length; i++) {
        const f = this.flyData[i];
        const s = f.s;
        const p = new Vector3(
          f.anchor.x + Math.sin(T * (0.2 + s[0] * 0.25) + s[1] * 30) * 1.1,
          0,
          f.anchor.z + Math.cos(T * (0.17 + s[2] * 0.2) + s[3] * 30) * 1.1,
        );
        p.y = terrainHeight(p.x, p.z) + f.anchor.y + Math.sin(T * (0.4 + s[4] * 0.5) + s[5] * 20) * 0.22;
        const blink = 0.22 + 0.78 * sstep(0.35, 1.0, Math.sin(T * (0.6 + s[4] * 1.3) + s[0] * 40));
        this.flies.set(n++, p, this.flyColor, blink * night * 3.2, 0.05);
      }
      if (T > M.fireflies - 2) {
        for (let i = 0; i < 3; i++) this.flies.set(n++, this.heroFly(i, T), this.flyColor, 3.4 * night, 0.06);
      }
    }
    // The perched one, glowing ever brighter.
    this.blade.mesh.visible = T > M.night && T < M.dawn + 3;
    if (this.blade.mesh.visible) {
      const g = sstep(M.perch - 0.5, M.white, T);
      this.blade.update(T, camera, (0.5 + g * 6) * night);
      if (night > 0.001) this.flies.set(n++, this.heroFly(3, T), new Color(0.85, 1.0, 0.5), (2.2 + g * g * 14) * night, 0.04 + g * 0.06);
    }
    this.flies.count = n;
    this.flies.commit(viewH);

    // The flower across the pond.
    const fg = T < M.call - 0.4 ? 0 : sstep(M.call - 0.4, M.call + 1.4, T) * (1 + 1.4 * sstep(M.dive + 3, M.flare, T));
    this.flower.group.visible = T > M.pondCut - 1 && T < M.fairy + 0.5;
    if (this.flower.group.visible) {
      this.flower.update(T, camera, fg, viewH);
      if (fg > 0.05 && T - this.lastSpark > 0.12) {
        this.lastSpark = T;
        this.sparks.emit(this.flower.headPos, 1, 0.5, new Color(1.0, 0.75, 0.95), 0.12, 3.5, 0.01);
      }
    }

    // Runes: each stone flares on its note and fades.
    this.runes.group.visible = T > M.flare && T < M.stars + 0.5;
    if (this.runes.group.visible) {
      const pulse = new Array(RUNE_STONES).fill(0);
      for (let i = 0; i < RUNE_NOTES.length; i++) {
        const nt = RUNE_NOTES[i];
        if (nt.t > T) break;
        const age = T - nt.t;
        if (age < 4) pulse[nt.stone] = Math.max(pulse[nt.stone], nt.vel * Math.exp(-age / (T > M.accel ? 0.35 : 0.8)));
        if (i > this.lastRuneIdx) {
          this.lastRuneIdx = i;
          const st = this.runes.stones[nt.stone];
          if (st) this.sparks.emit(st.top, T > M.accel ? 3 : 7, 0.35, this.runes.color, 0.5, 2.2, 0.016);
        }
      }
      const idle = 0.08 + 0.05 * Math.sin(T * 1.3);
      const all = sstep(M.vortex - 1, M.vortex + 1.5, T);
      for (let i = 0; i < RUNE_STONES; i++) this.runes.setPulse(i, Math.max(pulse[i], idle, all * 1.2));
    }

    // Shooting star.
    if (T >= M.meteor && !this.meteorSet) {
      this.meteorSet = true;
      const dirAt = (x: number, y: number) => new Vector3(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
      this.meteorFrom.copy(dirAt(0.85, 0.75));
      this.meteorTo.copy(dirAt(-0.45, -0.25));
    }
    if (this.meteorSet) {
      const k = 1 - Math.pow(1 - clamp01((T - M.meteor) / 2.6), 1.6);
      const alpha = sstep(M.meteor, M.meteor + 0.3, T) * (1 - sstep(M.meteor + 1.9, M.meteor + 3.0, T));
      this.meteor.update(camera.position, this.meteorFrom, this.meteorTo, k, 0.42, alpha * 2.6);
    }

    this.updateDebris(dt, T, camera, viewH);
    this.sparks.update(dt, T, viewH);
  }
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
