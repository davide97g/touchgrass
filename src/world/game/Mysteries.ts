import { AdditiveBlending, Color, CylinderGeometry, DoubleSide, Group, Mesh, ShaderMaterial, Vector3 } from 'three';
import { U } from '../../core/uniforms';
import { castShadow, shadowMaterial } from '../../core/Shadows';
import { PAGES, RELICS, SIGILS, type Sigil } from '../../game/lore';
import { mountainMask, terrainHeight } from '../common';
import { cellPools, FEATURE_CELL } from '../Features';
import type { Forest } from '../realm/Forest';
import { Builder, lean, M } from '../realm/geom';
import { mulberry32 } from '../realm/rand';
import { lampGlow, structureMaterial } from '../realm/Structures';
import type { Realm } from '../realm/World';

const TAU = Math.PI * 2;

export type ThingKind = 'waystone' | 'sigil' | 'page' | 'chest' | 'blade' | 'door' | 'well' | 'swing';

/** Something in the world the traveller can touch with E. */
export interface Thing {
  kind: ThingKind;
  /** Index (page, chest) or sigil. */
  index: number;
  sigil?: Sigil;
  x: number;
  y: number;
  z: number;
  /** How close you must stand. */
  reach: number;
  /** Solid radius (0 = walk through). */
  solid: number;
}

export interface MysteryState {
  sigil(id: string): boolean;
  page(i: number): boolean;
  chest(i: number): boolean;
  flag(f: string): boolean;
}

interface Ring {
  x: number;
  y: number;
  z: number;
  mesh: Mesh;
}


/**
 * The mysteries of the realm, as things you can walk up to: the Waystone that starts the story,
 * five sigil steles, pages of the hermit's diary pinned to posts, chests under lanterns, the
 * blade in the stone, the great door of the Pillar, and the ring course of the wind trial.
 */
export class Mysteries {
  readonly group = new Group();
  readonly things: Thing[] = [];
  /** Named places the compass and the companion can point to. */
  readonly places = new Map<string, { x: number; z: number; y?: number }>();
  readonly rings: Ring[] = [];
  private readonly ringNext: Mesh;
  private readonly beam: Mesh;
  private readonly beamMat: ShaderMaterial;
  private readonly sigilLit = new Map<string, Group>();
  private readonly doorLamps: Mesh[] = [];
  private readonly papers: Mesh[] = [];
  private readonly lids: { hinge: Group; open: number; want: number }[] = [];
  private readonly blade = new Group();
  private bladeT = -1;
  private readonly bladeHome = new Vector3();
  private readonly door = new Group();
  private readonly doorSlab: Mesh;
  private doorOpen = 0;
  private doorWant = 0;
  private readonly doorBase = new Vector3();
  private readonly portal: Mesh;
  private readonly mat = structureMaterial();
  private readonly free = structureMaterial({ groundAO: false, sway: 0 });

  constructor(private readonly realm: Realm, private readonly forest: Forest, shrine: Vector3 | null, spawn: { x: number; z: number; yaw: number }, private readonly state: MysteryState) {
    const b = new Builder();
    const lamps: { x: number; y: number; z: number }[] = [];
    const site = (kind: string) => realm.sites.find((s) => s.kind === kind)!;
    const secret = (id: string) => realm.plan.secrets.find((q) => q.id === id);

    // ---- the Waystone, a few steps from where the traveller wakes ----
    {
      const fx = -Math.sin(spawn.yaw + 0.5);
      const fz = -Math.cos(spawn.yaw + 0.5);
      const p = this.spot(spawn.x + fx * 17, spawn.z + fz * 17, 0, 7, 1);
      const y = terrainHeight(p.x, p.z);
      const rot = Math.atan2(spawn.x - p.x, spawn.z - p.z);
      const nx = Math.sin(rot);
      const nz = Math.cos(rot);
      b.box(p.x, y - 0.2, p.z, 1.9, 0.45, 1.2, rot, '#a8a294', M.stone, 0.3);
      b.box(p.x, y + 0.2, p.z, 1.3, 3.1, 0.5, rot, '#bdb5a3', M.stone, 0.6, lean(0.6, 0.03));
      b.prism(p.x, y + 3.28, p.z, 1.34, 0.5, 0.54, rot, '#b0a896', M.stone, 0.4);
      for (const s of [-1, 1]) {
        for (const [rr, yy] of [[0.42, 2.2], [0.27, 2.2], [0.12, 2.2]] as const) b.ring(p.x + nx * 0.27 * s, y + yy, p.z + nz * 0.27 * s, rr, 0.5, rot, 0, '#ffe6a0', M.rune, rr);
        for (let k = 0; k < 5; k++) b.box(p.x + nx * 0.26 * s + Math.cos(rot) * (k - 2) * 0.2, y + 1.15, p.z + nz * 0.26 * s - Math.sin(rot) * (k - 2) * 0.2, 0.09, 0.26, 0.03, rot, k < 5 ? '#ffe6a0' : '#fff', M.rune, k / 5);
      }
      this.things.push({ kind: 'waystone', index: 0, x: p.x, y: y + 1.6, z: p.z, reach: 4.4, solid: 0.85 });
      this.places.set('waystone', { x: p.x, z: p.z, y: y + 2 });
      // A column of light so it can be seen from where you wake.
      const geo = new CylinderGeometry(0.25, 0.75, 60, 20, 1, true).translate(0, 30, 0);
      this.beamMat = new ShaderMaterial({
        uniforms: { uAmt: { value: 1 }, uTime: U.uTime },
        vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vWP; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }',
        fragmentShader:
          'uniform float uAmt; uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vWP; void main(){ vec3 V = normalize(cameraPosition - vWP); float core = pow(abs(dot(normalize(vN), V)), 3.0); float fade = smoothstep(0.0, 0.03, vUv.y) * pow(1.0 - vUv.y, 1.6); float flow = 0.75 + 0.25 * sin(vUv.y * 40.0 - uTime * 2.4); gl_FragColor = vec4(vec3(1.0, 0.78, 0.36) * core * fade * flow * 0.55 * uAmt, 1.0); }',
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
      this.beam = new Mesh(geo, this.beamMat);
      this.beam.position.set(p.x, y + 3.2, p.z);
      this.beam.renderOrder = 3;
      this.group.add(this.beam);
    }

    // ---- five sigil steles ----
    const sigilSpot: Record<string, { x: number; z: number; y: number; face: number }> = {};
    const around = (s: { x: number; z: number }, r0: number, r1: number, seed: number) => {
      const p = this.spot(s.x, s.z, r0, r1, seed);
      return { x: p.x, z: p.z, y: terrainHeight(p.x, p.z), face: Math.atan2(s.x - p.x, s.z - p.z) + Math.PI };
    };
    sigilSpot.stone = around(site('ruins'), 9, 26, 2);
    sigilSpot.song = around(site('crystals'), 12, 40, 3);
    sigilSpot.dawn = around(site('ring'), 4.5, 9, 4);
    sigilSpot.petal = around(site('grove'), 7, 20, 5);
    sigilSpot.sky = shrine ? { x: shrine.x + 4.5, z: shrine.z + 2.5, y: shrine.y - 1.7, face: 0.6 } : around({ x: -120, z: 980 }, 0, 10, 6);
    for (const [si, s] of SIGILS.entries()) {
      const p = sigilSpot[s.id];
      const rot = p.face;
      const nx = Math.sin(rot);
      const nz = Math.cos(rot);
      b.box(p.x, p.y - 0.25, p.z, 1.5, 0.5, 1.0, rot, '#9a968a', M.stone, 0.2);
      b.box(p.x, p.y + 0.2, p.z, 1.0, 2.6, 0.42, rot, '#b4ad9c', M.stone, 0.5 + si * 0.1, lean(si * 1.3, 0.035));
      b.prism(p.x, p.y + 2.78, p.z, 1.04, 0.4, 0.46, rot, '#a8a090', M.stone, 0.4);
      const dim = new Color(s.color).multiplyScalar(0.16);
      for (const f of [-1, 1]) b.ring(p.x + nx * 0.225 * f, p.y + 1.75, p.z + nz * 0.225 * f, 0.3, 0.4, rot, 0, dim, M.rune, 0.5);
      // What lights up when it wakes: the full glyph on both faces and a shard turning above.
      const lit = new Builder();
      for (const f of [-1, 1]) {
        lit.ring(nx * 0.24 * f, 1.75, nz * 0.24 * f, 0.31, 0.6, rot, 0, s.color, M.rune, 0.2);
        lit.ring(nx * 0.24 * f, 1.75, nz * 0.24 * f, 0.17, 0.6, rot, 0, s.color, M.rune, 0.6);
        lit.gem(nx * 0.24 * f, 1.75 - 0.09, nz * 0.24 * f, 0.09, 0.09, 0.03, rot, '#ffffff', M.rune, 0.9);
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * TAU + Math.PI / 4;
          lit.box(nx * 0.24 * f + Math.cos(rot) * Math.cos(a) * 0.42, 1.73 + Math.sin(a) * 0.42, nz * 0.24 * f - Math.sin(rot) * Math.cos(a) * 0.42, 0.05, 0.05, 0.03, rot, s.color, M.rune, k / 4);
        }
        lit.box(nx * 0.235 * f, 0.55, nz * 0.235 * f, 0.5, 0.05, 0.02, rot, s.color, M.rune, 0.4);
      }
      const g = new Group();
      g.add(new Mesh(lit.build(), this.free));
      const shard = new Builder();
      shard.gem(0, 0, 0, 0.2, 0.42, 0.2, 0, s.color, M.crystal, 0.5);
      const sm = new Mesh(shard.build(), this.free);
      sm.position.y = 3.75;
      sm.name = 'shard';
      g.add(sm);
      g.position.set(p.x, p.y, p.z);
      this.group.add(g);
      this.sigilLit.set(s.id, g);
      this.things.push({ kind: 'sigil', index: si, sigil: s, x: p.x, y: p.y + 1.6, z: p.z, reach: s.id === 'sky' ? 26 : 4.2, solid: s.id === 'sky' ? 0 : 0.75 });
      this.places.set(`sigil:${s.id}`, { x: p.x, z: p.z, y: p.y + 2 });
    }

    // ---- pages of the hermit's diary, pinned to posts ----
    const pillar = site('pillar');
    const doorA = Math.atan2(-0.6, -0.8);
    const ddx = Math.cos(doorA);
    const ddz = Math.sin(doorA);
    const pageAt: { x: number; z: number }[] = [];
    const hut = secret('hut');
    const well = secret('moonwell');
    const swing = secret('swing');
    const fairy = secret('fairyring');
    const vill = realm.sites.filter((s) => s.kind === 'village');
    pageAt.push(hut ? this.spot(hut.approach.x, hut.approach.z, 1, 5, 11, true) : this.spot(-300, -700, 0, 20, 11));
    pageAt.push(this.spot(vill[0].x, vill[0].z, vill[0].r + 3, vill[0].r + 14, 12, true));
    pageAt.push(this.spot(vill[1].x, vill[1].z, vill[1].r + 3, vill[1].r + 14, 13, true));
    pageAt.push(this.spot(site('pass').x, site('pass').z, 8, 20, 14, true));
    pageAt.push(well ? this.spot(well.x, well.z, 3.2, 6, 15, true) : this.spot(-200, 700, 0, 20, 15));
    pageAt.push(swing ? this.spot(swing.x, swing.z, 3.5, 7, 16, true) : this.spot(-700, 500, 0, 20, 16));
    pageAt.push(fairy ? this.spot(fairy.x, fairy.z, 6.5, 9.5, 17, true) : this.spot(700, -700, 0, 20, 17));
    pageAt.push(this.spot(pillar.x + ddx * 54 - ddz * 15, pillar.z + ddz * 54 + ddx * 15, 0, 5, 18, true));
    pageAt.slice(0, PAGES.length).forEach((p, i) => {
      const y = terrainHeight(p.x, p.z);
      const rot = hashAngle(p.x, p.z);
      b.cyl(p.x, y - 0.3, p.z, 0.06, 1.75, '#5a4632', M.wood, 8, 0.4);
      b.box(p.x, y + 1.02, p.z, 0.56, 0.5, 0.05, rot, '#6a5038', M.wood, 0.5);
      b.gable(p.x, y + 1.52, p.z, 0.74, 0.16, 0.3, rot, '#4a3a2a', M.roof, 0.4);
      b.box(p.x + Math.sin(rot) * 0.2, y + 1.3, p.z + Math.cos(rot) * 0.2, 0.08, 0.12, 0.08, rot, '#ffcf7a', M.lamp, 0.9);
      lamps.push({ x: p.x + Math.sin(rot) * 0.2, y: y + 1.36, z: p.z + Math.cos(rot) * 0.2 });
      const pb = new Builder();
      pb.box(0, 0, 0, 0.36, 0.42, 0.012, 0, '#f4ecd6', M.plaster, 0.9);
      for (let k = 0; k < 6; k++) pb.box(-0.01 + (k % 2) * 0.02, 0.06 + k * 0.055, 0.008, 0.26 - (k % 3) * 0.04, 0.012, 0.004, 0, '#3a3028', M.wood, 0.2);
      const paper = new Mesh(pb.build(), this.free);
      paper.position.set(p.x + Math.sin(rot) * 0.035, y + 1.06, p.z + Math.cos(rot) * 0.035);
      paper.rotation.y = rot;
      this.group.add(paper);
      this.papers.push(paper);
      this.things.push({ kind: 'page', index: i, x: p.x, y: y + 1.2, z: p.z, reach: 3.6, solid: 0.3 });
    });

    // ---- chests under lanterns, in out-of-the-way corners ----
    {
      const r = mulberry32(0xc4e5);
      const spots: { x: number; z: number }[] = [];
      let tries = 0;
      while (spots.length < RELICS.length && tries++ < 4000) {
        const x = -1650 + r() * 2700;
        const z = -1150 + r() * 2300;
        if (mountainMask(x, z) > 0.22 || realm.map.roadDist(x, z) < 70) continue;
        if (Math.hypot(x - spawn.x, z - spawn.z) < 180) continue;
        if (realm.sites.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 50)) continue;
        if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 380)) continue;
        if (!this.ok(x, z, false) || this.slope(x, z) > 0.22) continue;
        spots.push({ x, z });
      }
      spots.forEach((p, i) => {
        const y = terrainHeight(p.x, p.z);
        const rot = hashAngle(p.x, p.z);
        b.cyl(p.x, y - 0.3, p.z, 1.25, 0.55, '#a8a294', M.stone, 12, 0.3);
        b.cyl(p.x, y + 0.2, p.z, 1.0, 0.14, '#bdb5a3', M.stone, 12, 0.6);
        b.box(p.x, y + 0.34, p.z, 0.96, 0.46, 0.58, rot, '#6a4a2e', M.wood, 0.5);
        const cx = Math.cos(rot);
        const sx = -Math.sin(rot);
        for (const u of [-0.36, 0, 0.36]) b.box(p.x + cx * u, y + 0.33, p.z + sx * u, 0.07, 0.49, 0.61, rot, '#c8a24a', M.metal, 0.6);
        // Lantern post beside it.
        const lx = p.x + cx * 1.05;
        const lz = p.z + sx * 1.05;
        b.cyl(lx, y - 0.2, lz, 0.05, 2.5, '#4a3a2a', M.wood, 8);
        b.box(lx, y + 2.2, lz, 0.5, 0.05, 0.05, rot, '#4a3a2a', M.wood);
        b.box(lx - cx * 0.2, y + 1.86, lz - sx * 0.2, 0.2, 0.28, 0.2, rot, '#ffcf7a', M.lamp, 0.8);
        lamps.push({ x: lx - cx * 0.2, y: y + 2.0, z: lz - sx * 0.2 });
        // The lid, hinged along the back.
        const lb = new Builder();
        lb.box(0, 0, 0.29, 0.98, 0.14, 0.6, 0, '#7a5636', M.wood, 0.4);
        lb.prism(0, 0.14, 0.29, 0.98, 0.14, 0.6, 0, '#6a4a2e', M.wood, 0.5);
        for (const u of [-0.36, 0, 0.36]) lb.box(u, -0.005, 0.29, 0.07, 0.3, 0.63, 0, '#c8a24a', M.metal, 0.6);
        lb.box(0, -0.06, 0.6, 0.12, 0.14, 0.03, 0, '#e8c040', M.metal, 0.6);
        const hinge = new Group();
        hinge.add(new Mesh(lb.build(), this.free));
        const tb = new Builder();
        tb.box(0, -0.12, 0.29, 0.8, 0.1, 0.42, 0, '#ffd866', M.lamp, 0.95);
        const gold = new Mesh(tb.build(), this.free);
        gold.name = 'gold';
        const holder = new Group();
        holder.position.set(p.x - Math.sin(rot) * 0.29, y + 0.8, p.z - Math.cos(rot) * 0.29);
        holder.rotation.y = rot;
        holder.add(hinge, gold);
        this.group.add(holder);
        this.lids.push({ hinge, open: 0, want: 0 });
        this.things.push({ kind: 'chest', index: i, x: p.x, y: y + 0.7, z: p.z, reach: 3.8, solid: 0.95 });
        this.places.set(`chest:${i}`, { x: p.x, z: p.z });
      });
    }

    // ---- the blade in the stone ----
    const bq = secret('blade');
    if (bq) {
      const y = terrainHeight(bq.x, bq.z);
      const sb = new Builder();
      const tilt = lean(0.7, 0.12);
      const rot = 0.5;
      sb.box(0, 0.35, 0, 0.09, 1.25, 0.018, rot, '#d8dee8', M.metal, 0.8, tilt);
      sb.box(0, 0.5, 0, 0.022, 1.0, 0.022, rot, '#8ff0ff', M.rune, 0.4, tilt);
      sb.box(0.07, 1.6, 0.02, 0.5, 0.06, 0.08, rot, '#c8a24a', M.metal, 0.6, tilt);
      sb.cyl(0.08, 1.65, 0.02, 0.026, 0.32, '#3a2a22', M.wood, 8, 0.5, tilt);
      sb.gem(0.1, 2.02, 0.03, 0.06, 0.08, 0.06, 0, '#8ff0ff', M.rune, 0.9);
      const mesh = new Mesh(sb.build(), this.free);
      castShadow(mesh, shadowMaterial(this.free));
      this.blade.add(mesh);
      this.bladeHome.set(bq.x, y, bq.z);
      this.blade.position.copy(this.bladeHome);
      this.group.add(this.blade);
      this.things.push({ kind: 'blade', index: 0, x: bq.x, y: y + 1.4, z: bq.z, reach: 4.6, solid: 0 });
      this.places.set('blade', { x: bq.x, z: bq.z, y: y + 2 });
    }

    // ---- the Moonwell grants a wish, the swing a rest ----
    if (well) this.things.push({ kind: 'well', index: 0, x: well.x, y: terrainHeight(well.x, well.z) + 0.9, z: well.z, reach: 3.6, solid: 0 });
    if (swing) this.things.push({ kind: 'swing', index: 0, x: swing.x, y: terrainHeight(swing.x, swing.z) + 0.7, z: swing.z, reach: 2.6, solid: 0 });

    // ---- the great door of the Pillar ----
    {
      const R = 32;
      const rot = Math.atan2(ddx, ddz);
      this.doorBase.set(pillar.x + ddx * (R - 0.6), pillar.level + 3.6, pillar.z + ddz * (R - 0.6));
      const db = new Builder();
      db.box(0, 0, 0, 9, 16, 1.2, 0, '#2a3242', M.metal, 0.4);
      for (const s of [-1, 1]) {
        db.box(s * 2.25, 0.6, 0.62, 3.6, 14.6, 0.08, 0, '#39445a', M.metal, 0.6);
        db.box(s * 0.12, 0, 0.64, 0.1, 16, 0.08, 0, '#8fe8ff', M.rune, 0.3);
        for (let k = 0; k < 4; k++) db.ring(s * 2.25, 3 + k * 3.2, 0.68, 0.9, 0.6, 0, 0, '#5b6a86', M.metal, k / 4);
      }
      // Five dull sockets across the door, one for each sigil.
      SIGILS.forEach((s, i) => {
        const x = (i - 2) * 1.55;
        db.ring(x, 8.2, 0.7, 0.42, 0.7, 0, 0, '#7a8498', M.metal, 0.5);
        const lb = new Builder();
        lb.gem(x, 8.2 - 0.3, 0.74, 0.3, 0.3, 0.1, 0, s.color, M.rune, 0.9);
        lb.ring(x, 8.2, 0.74, 0.5, 0.5, 0, 0, s.color, M.rune, 0.4);
        const lm = new Mesh(lb.build(), this.free);
        this.doorLamps.push(lm);
      });
      this.doorSlab = new Mesh(db.build(), this.free);
      for (const l of this.doorLamps) this.doorSlab.add(l);
      this.door.add(this.doorSlab);
      // What waits behind it.
      const pb = new Builder();
      pb.box(0, 0, 0.42, 9, 16, 0.1, 0, '#dff8ff', M.rune, 0.5);
      this.portal = new Mesh(pb.build(), this.free);
      this.door.add(this.portal);
      this.door.position.copy(this.doorBase);
      this.door.rotation.y = rot;
      this.group.add(this.door);
      const fx = pillar.x + ddx * (R + 12);
      const fz = pillar.z + ddz * (R + 12);
      this.things.push({ kind: 'door', index: 0, x: fx, y: pillar.level + 3, z: fz, reach: 20, solid: 0 });
      this.places.set('pillar', { x: fx, z: fz, y: pillar.level + 8 });
      this.places.set('crown', { x: pillar.x, z: pillar.z, y: pillar.level + 590 });
    }

    // ---- the wind trial: a course of rings in the air ----
    {
      const course: [number, number, number][] = [
        [-30, -230, 55], [90, -330, 75], [200, -470, 105], [245, -620, 150], [370, -740, 135], [510, -650, 95],
        [590, -480, 70], [650, -360, 50], [690, -270, 36], [570, -150, 46], [410, -70, 56], [220, -70, 50],
      ];
      const pts = course.map(([x, z, h]) => new Vector3(x, terrainHeight(x, z) + h, z));
      const ringMat = structureMaterial({ groundAO: false, sway: 0, fog: 0.3 });
      const rb = new Builder();
      rb.ring(0, 0, 0, 7.5, 7.5, 0, 0, '#8fe8ff', M.rune, 0.3);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        rb.gem(Math.cos(a) * 7.5, Math.sin(a) * 7.5 - 0.5, 0, 0.5, 1.0, 0.5, 0, '#dff8ff', M.crystal, k / 8);
      }
      const geo = rb.build();
      pts.forEach((p, i) => {
        const a = pts[Math.max(0, i - 1)];
        const c = pts[Math.min(pts.length - 1, i + 1)];
        const m = new Mesh(geo, ringMat);
        m.position.copy(p);
        m.lookAt(p.x + (c.x - a.x), p.y + (c.y - a.y), p.z + (c.z - a.z));
        m.frustumCulled = false;
        this.group.add(m);
        this.rings.push({ x: p.x, y: p.y, z: p.z, mesh: m });
      });
      const nb = new Builder();
      nb.ring(0, 0, 0, 9.2, 5, 0, 0, '#ffe07a', M.rune, 0.8);
      this.ringNext = new Mesh(nb.build(), ringMat);
      this.ringNext.frustumCulled = false;
      this.group.add(this.ringNext);
      this.places.set('trial', { x: pts[0].x, z: pts[0].z, y: pts[0].y });
    }

    const mesh = new Mesh(b.build(), this.mat);
    mesh.frustumCulled = false;
    castShadow(mesh, shadowMaterial(this.mat));
    this.group.add(mesh);
    this.group.add(lampGlow(lamps, [1.0, 0.78, 0.4], 1.6));
    this.refresh();
    if (state.flag('door')) this.doorOpen = this.doorWant = 1;
    for (const [i, l] of this.lids.entries()) if (state.chest(i)) l.open = l.want = 1;
    this.update(0, 0, -1);
  }

  private dry(x: number, z: number): boolean {
    const ci = Math.floor(x / FEATURE_CELL);
    const cj = Math.floor(z / FEATURE_CELL);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const p of cellPools(i, j)) if (Math.hypot(p.x - x, p.z - z) < p.r * 1.7 + 2) return false;
    return true;
  }

  private slope(x: number, z: number): number {
    const e = 2;
    return Math.hypot(terrainHeight(x + e, z) - terrainHeight(x - e, z), terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
  }

  private ok(x: number, z: number, roadOk: boolean): boolean {
    const m = this.realm.map;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (m.solidAt(x + dx, z + dz) > 0.05) return false;
    if (!roadOk && m.roadAt(x, z) > 0.25) return false;
    return this.forest.clear(x, z) && !this.forest.blocked(x, z, 1.2) && this.dry(x, z) && !this.things.some((t) => Math.hypot(t.x - x, t.z - z) < 4);
  }

  /** A free, dry, fairly level spot in a ring around a point. */
  private spot(cx: number, cz: number, r0: number, r1: number, seed: number, roadOk = false): { x: number; z: number } {
    const r = mulberry32(seed * 7919 + 13);
    let best = { x: cx + r1, z: cz };
    for (let t = 0; t < 120; t++) {
      const a = r() * TAU;
      const d = r0 + r() * (r1 - r0) + (t > 60 ? (t - 60) * 0.3 : 0);
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (!this.ok(x, z, roadOk || t > 80)) continue;
      best = { x, z };
      if (this.slope(x, z) < 0.3) break;
    }
    return best;
  }

  /** Bring the visuals in line with what has been woken, read, opened and pulled. */
  refresh(): void {
    const s = this.state;
    for (const sig of SIGILS) this.sigilLit.get(sig.id)!.visible = s.sigil(sig.id);
    SIGILS.forEach((sig, i) => (this.doorLamps[i].visible = s.sigil(sig.id)));
    this.papers.forEach((p, i) => (p.visible = !s.page(i)));
    this.lids.forEach((l, i) => (l.want = s.chest(i) ? 1 : 0));
    this.beam.visible = !s.flag('waystone');
    if (s.flag('blade') && this.bladeT < 0) this.blade.visible = false;
    this.doorWant = s.flag('door') ? 1 : 0;
  }

  /** The blade comes free: it rises, turns in the light and is gone. */
  pullBlade(): void {
    this.bladeT = 0;
    this.blade.visible = true;
  }

  /** True while the door is still grinding open. */
  get doorMoving(): boolean {
    return Math.abs(this.doorWant - this.doorOpen) > 0.01;
  }

  update(dt: number, time: number, nextRing: number): void {
    for (const g of this.sigilLit.values()) {
      if (!g.visible) continue;
      const sh = g.getObjectByName('shard')!;
      sh.rotation.y = time * 0.9;
      sh.position.y = 3.75 + Math.sin(time * 1.4) * 0.12;
    }
    for (const l of this.lids) {
      l.open += (l.want - l.open) * Math.min(1, dt * 3);
      l.hinge.rotation.x = -l.open * 1.9;
      l.hinge.parent!.getObjectByName('gold')!.visible = l.open > 0.05;
    }
    if (this.bladeT >= 0) {
      this.bladeT += dt;
      const t = this.bladeT;
      const rise = Math.min(1, t / 2.4);
      const e = 1 - Math.pow(1 - rise, 3);
      this.blade.position.set(this.bladeHome.x, this.bladeHome.y + e * 2.4, this.bladeHome.z);
      this.blade.rotation.y = Math.max(0, t - 1.2) * 2.2;
      const fade = Math.max(0, 1 - Math.max(0, t - 5.5) / 1.5);
      this.blade.scale.setScalar(fade);
      if (fade <= 0) {
        this.blade.visible = false;
        this.bladeT = -1;
      }
    }
    // The door sinks into its threshold.
    const speed = 0.11;
    if (this.doorOpen < this.doorWant) this.doorOpen = Math.min(this.doorWant, this.doorOpen + dt * speed);
    else if (this.doorOpen > this.doorWant) this.doorOpen = this.doorWant;
    const k = this.doorOpen * this.doorOpen * (3 - 2 * this.doorOpen);
    this.doorSlab.position.y = -k * 15.6;
    this.doorSlab.position.x = this.doorMoving ? Math.sin(time * 60) * 0.03 : 0;
    this.portal.visible = this.doorOpen > 0.01;

    // The ring course: the next ring burns gold, the ones behind you go out.
    this.rings.forEach((r, i) => {
      r.mesh.visible = nextRing < 0 || i >= nextRing;
      r.mesh.rotation.z += dt * 0.25;
    });
    const nr = this.rings[Math.max(0, nextRing)];
    this.ringNext.visible = nextRing >= 0 && nextRing < this.rings.length;
    if (this.ringNext.visible) {
      this.ringNext.position.set(nr.x, nr.y, nr.z);
      this.ringNext.quaternion.copy(nr.mesh.quaternion);
      this.ringNext.scale.setScalar(1 + Math.sin(time * 5) * 0.05);
    }
  }

  /** Is there something solid here (steles, chests, posts)? */
  blocked(x: number, z: number): boolean {
    for (const t of this.things) if (t.solid > 0 && Math.abs(t.x - x) < t.solid && Math.abs(t.z - z) < t.solid && Math.hypot(t.x - x, t.z - z) < t.solid) return true;
    return false;
  }

  /** The thing within reach, best in front of the eye. */
  nearest(eye: Vector3, fx: number, fz: number, flying: boolean, usable: (t: Thing) => boolean): Thing | null {
    let best: Thing | null = null;
    let bs = Infinity;
    for (const t of this.things) {
      if (!usable(t)) continue;
      const dx = t.x - eye.x;
      const dz = t.z - eye.z;
      const d = Math.hypot(dx, dz);
      const reach = flying ? Math.max(t.reach, 12) : t.reach;
      if (d > reach || Math.abs(t.y - eye.y) > reach + 6) continue;
      const facing = d > 0.8 ? (dx * fx + dz * fz) / d : 1;
      if (facing < 0.1 && d > 1.6) continue;
      const score = d / reach - facing * 0.4;
      if (score < bs) {
        bs = score;
        best = t;
      }
    }
    return best;
  }

  /** Grass bows away around the things worth walking up to. */
  parts(out: { x: number; z: number; r: number; s: number }[], px: number, pz: number): void {
    for (const t of this.things) {
      if (t.kind === 'door' || t.kind === 'well' || t.kind === 'swing' || t.kind === 'blade') continue;
      if (Math.abs(t.x - px) > 19 || Math.abs(t.z - pz) > 19) continue;
      out.push({ x: t.x, z: t.z, r: t.kind === 'chest' ? 2.2 : 1.7, s: 1 });
    }
  }
}

function hashAngle(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * TAU;
}

