import {
  NeutralToneMapping,
  PerspectiveCamera,
  SRGBColorSpace,
  Vector3,
  Scene,
  Timer,
  Vector2,
  WebGLRenderer,
} from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { Bells } from '../audio/Bells';
import { Sfx, type Call } from '../audio/Sfx';
import { Discovery, type LensState } from '../discovery/Discovery';
import { Journal } from '../discovery/Journal';
import { FlightFX } from '../player/FlightFX';
import { Critters } from '../world/life/Critters';
import { RareFlora } from '../world/life/RareFlora';
import { Controller } from '../player/Controller';
import { TouchControls } from '../player/TouchControls';
import { FX, Post } from '../post/Post';
import { BreathGuide } from '../ui/BreathGuide';
import { Panel } from '../ui/Panel';
import { Aquatic } from '../world/Aquatic';
import { Birds } from '../world/Birds';
import { Clouds } from '../world/Clouds';
import { gustAt } from '../world/common';
import { FeatureMap } from '../world/Features';
import { Flowers } from '../world/Flowers';
import { Grass } from '../world/Grass';
import { Particles } from '../world/Particles';
import { Rocks } from '../world/Rocks';
import { Sky } from '../world/Sky';
import { Terrain } from '../world/Terrain';
import { TimeOfDay, TIME_PRESETS } from '../world/TimeOfDay';
import { TrailMap } from '../world/TrailMap';
import { findTreeSite, Tree } from '../world/Tree';
import { Water } from '../world/Water';
import { Ambient } from '../world/realm/Ambient';
import { Fauna } from '../world/realm/Fauna';
import { Forest } from '../world/realm/Forest';
import { CASTLE, ISLANDS, Sky as SkyRealm } from '../world/realm/Skyward';
import { Structures } from '../world/realm/Structures';
import { initRealm, type Realm } from '../world/realm/init';
import { Shadows } from './Shadows';
import { GRASS_TYPES, params, type GrassTypeName, type TimeName } from './params';
import { detectTier, grassLayers, probeTier, TIER_ORDER, TIERS, type Tier } from './quality';
import { U } from './uniforms';

/** Something that flies the camera instead of the player (the trailer). Returns the depth-of-field amount. */
export interface CameraDirector {
  update(dt: number, camera: PerspectiveCamera): number;
}

export class Experience {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controller: Controller;
  readonly audio = new AudioEngine();
  readonly breath = new BreathGuide();
  readonly panel: Panel;
  readonly tod: TimeOfDay;

  private readonly clock = new Timer();
  /** The planned world (city, villages, roads, hills): built first, everything samples it. */
  readonly realm: Realm = initRealm();
  private readonly terrain = new Terrain();
  private readonly grass = new Grass();
  readonly sky = new Sky();
  readonly trail = new TrailMap();
  readonly features = new FeatureMap();
  private readonly water = new Water();
  private readonly rocks = new Rocks();
  readonly aquatic = new Aquatic();
  readonly birds = new Birds();
  private readonly tree: Tree;
  private readonly clouds: Clouds;
  readonly structures: Structures;
  readonly forest: Forest;
  readonly fauna: Fauna;
  readonly skyward: SkyRealm;
  private readonly bells: Bells;
  readonly sfx: Sfx;
  readonly journal = new Journal();
  readonly rareFlora: RareFlora;
  readonly critters: Critters;
  readonly discovery: Discovery;
  readonly flightFX = new FlightFX();
  /** What the lens sees this frame. */
  lens: LensState;
  private shot: ((canvas: HTMLCanvasElement) => void) | null = null;
  private readonly trailParts: { x: number; z: number; r: number; s: number; ax?: number; az?: number; len?: number }[] = [];
  private callT = 0;
  private wasBoost = false;
  private fovKick = 0;
  private readonly flyVel = new Vector3();
  readonly shadows = new Shadows();
  private readonly bufferSize = new Vector2();
  flowers: Flowers | null = null;
  particles: Particles | null = null;
  private post: Post | null = null;

  tier: Tier;
  private autoTier: boolean;
  started = false;
  private elapsed = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 60;
  private lowFpsStreak = 0;
  /** Resolution ceiling lowered step by step once the lowest tier is still too slow. */
  private dprCap = Infinity;
  private lastTierChange = 0;
  private densityTimer = 0;
  private needsResize = false;

  /** Macro lens state: target on/off, eased amount, zoom. */
  macro = false;
  private macroAmt = 0;
  macroFov = 10;
  private macroTarget: { x: number; y: number; z: number } | null = null;
  private macroAim = 0;
  private flyFov = 0;
  private blastT = 0;

  /** When set, flies the camera (trailer) and the player controller sits idle. */
  director: CameraDirector | null = null;
  /** Fixed drawing-buffer size (for recording), or null to follow the window. */
  fixedSize: { w: number; h: number } | null = null;
  /** Director-chosen spot where hands part the grass (trail map ring stamp). */
  trailPart: { x: number; z: number; strength: number } | null = null;

  onFirstFrame: (() => void) | null = null;
  onWanderChange: ((on: boolean) => void) | null = null;
  onFlightChange: ((flying: boolean) => void) | null = null;
  private firstFrame = true;

  constructor(canvas: HTMLCanvasElement) {
    // The low tier draws straight to the canvas (no post, so no multisampled target):
    // give that canvas MSAA, or phones get stair-stepped blades and pixelated leaves.
    const startTier = params.quality === 'auto' ? probeTier() : (params.quality as Tier);
    this.renderer = new WebGLRenderer({ canvas, antialias: !TIERS[startTier].post, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;

    this.autoTier = params.quality === 'auto';
    this.tier = startTier;

    this.camera = new PerspectiveCamera(params.move.fov, 1, 0.05, 14000);
    this.clouds = new Clouds(this.renderer, this.sky.cloudLit, this.sky.cloudShade);
    this.controller = new Controller(canvas);
    this.controller.canStand = (x, z) =>
      this.features.waterDepth(x, z) < 0.42 && this.tree.clear(x, z) && this.realm.map.solidAt(x, z) < 0.5 && this.forest.clear(x, z);
    this.features.onChange = () => {
      this.water.rebuild(this.features.active);
      this.rocks.rebuild(this.features.active);
      this.aquatic.rebuild(this.features);
    };
    this.features.update(this.controller.position.x, this.controller.position.z);
    this.faceNearestPool();
    const p0 = this.controller.position;
    this.tree = new Tree(findTreeSite(p0.x, p0.z, this.controller.yaw, this.features));
    this.controller.onStep = (i) => this.audio.step(i);
    this.controller.onUserMove = () => {
      if (this.started && (this.controller.wanderActive || (this.controller.flying && this.controller.flight.auto))) this.setWander(false);
    };
    if (matchMedia('(pointer: coarse)').matches) new TouchControls(canvas, this.controller);

    this.structures = new Structures(this.realm);
    this.skyward = new SkyRealm();
    this.forest = new Forest(this.realm, this.features, this.skyward.treeSpots);
    this.fauna = new Fauna(this.realm, this.features, this.forest);
    this.bells = new Bells(this.audio, this.realm.plan.bell);
    this.sfx = new Sfx(this.audio);
    this.rareFlora = new RareFlora(this.realm, this.forest, (id) => this.journal.isCollected(id));
    this.critters = new Critters(this.features, this.realm.map);
    this.discovery = new Discovery(
      this.realm,
      this.journal,
      [
        (out) => this.rareFlora.subjects(out),
        (out) => this.fauna.subjects(out, this.camera.position.x, this.camera.position.z),
        (out) => this.critters.subjects(out, this.camera.position, this.birds, this.tod.night, U.uSunDir.value.y),
      ],
      () => this.skyward.shrine,
    );
    this.discovery.settle();
    this.lens = this.discovery.state;
    this.controller.waypoints = () => [
      ...this.realm.sites.map((s) => ({ name: s.name, x: s.x, z: s.z, r: s.r + (s.kind === 'pillar' ? 120 : 70), alt: s.level + (s.kind === 'pillar' ? 320 : s.kind === 'city' ? 70 : 45) })),
      { name: 'the floating castle', x: CASTLE.x, z: CASTLE.z, r: CASTLE.R + 260, alt: CASTLE.bottom + 260 },
      ...ISLANDS.filter((i) => i.R > 30).map((i) => ({ name: 'a floating island', x: i.x, z: i.z, r: i.R + 70, alt: i.y + 25 })),
    ];
    this.controller.onLanded = () => {
      const p = this.controller.position;
      this.flightFX.burst(p.x, p.y, p.z, 90, 0.7);
      this.sfx.thud(1);
      this.sfx.whoosh(0.4, 0.9, false);
      this.onFlightChange?.(false);
    };
    for (const root of [this.structures.group, this.forest.group, this.fauna.group, this.tree.group, this.rocks.mesh]) this.shadows.addRoot(root);

    this.tod = new TimeOfDay(this.sky, params.atmosphere.time);
    this.scene.add(
      this.terrain.far,
      this.structures.group,
      this.forest.group,
      this.fauna.group,
      this.skyward.group,
      new Ambient(this.realm).group,
      this.rareFlora.group,
      this.critters.group,
      this.flightFX.group,
    );
    this.scene.add(
      this.sky.mesh,
      this.terrain.mesh,
      this.grass.group,
      this.water.mesh,
      this.rocks.mesh,
      this.aquatic.group,
      this.birds.mesh,
      this.tree.group,
    );

    this.applyGrass();
    this.applyWind();
    this.applyAtmosphere();
    this.buildForTier();

    this.panel = new Panel({
      grassType: (n) => this.setGrassType(n),
      grassChanged: () => this.applyGrass(),
      densityChanged: () => this.rebuildGrass(),
      windChanged: () => this.applyWind(),
      timeChanged: (n) => this.setTime(n),
      atmosphereChanged: () => this.applyAtmosphere(),
      flowersChanged: () => this.applyFlowers(),
      audioChanged: () => this.audio.setVolumes(),
      qualityChanged: (q) => {
        this.autoTier = q === 'auto';
        this.setTier(q === 'auto' ? detectTier(this.renderer.getContext() as WebGL2RenderingContext) : q);
      },
      fovChanged: () => {
        this.camera.fov = params.move.fov;
        this.camera.updateProjectionMatrix();
      },
    });

    // Resizing clears the canvas, so it only ever happens right before a render (never between frames).
    window.addEventListener('resize', () => (this.needsResize = true));
    this.resize();
    this.clock.connect(document);
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // ---------- state ----------

  /** Start the visit looking toward the closest fairy pool, if one is in view range. */
  private faceNearestPool(): void {
    const p = this.controller.position;
    let best: { x: number; z: number } | null = null;
    let bd = 260;
    for (const pool of this.features.active.pools) {
      const d = Math.hypot(pool.x - p.x, pool.z - p.z);
      if (d < bd && d > 20) {
        bd = d;
        best = pool;
      }
    }
    if (!best) return;
    const yaw = Math.atan2(-(best.x - p.x), -(best.z - p.z));
    this.controller.yaw = yaw;
    this.controller.wander.reset(yaw);
  }

  enter(): void {
    this.started = true;
    this.audio.start();
    this.controller.enabled = true;
    this.setWander(false);
    this.controller.requestLock();
  }

  setMacro(on: boolean): void {
    this.macro = on;
    this.controller.macro = on;
    if (on && this.controller.wanderActive) this.setWander(false);
    this.macroTarget = null;
    // Look down and the lens finds a flower (you kneel to it); look out and it stays where you aim.
    if (on && !this.controller.flying && this.controller.pitch < -0.12) {
      const p = this.controller.position;
      this.macroTarget = this.rareTarget(p.x, p.z, this.controller.yaw);
      if (!this.macroTarget && this.flowers) this.macroTarget = this.flowers.findTarget(p.x, p.z, this.controller.yaw, this.features);
      this.macroAim = this.macroTarget ? 1.4 : 0;
    }
    this.controller.kneel = on && !!this.macroTarget;
  }

  /** A rare flower close in front, for the lens to turn to first. */
  private rareTarget(x: number, z: number, yaw: number): { x: number; y: number; z: number } | null {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let best: { x: number; y: number; z: number } | null = null;
    let bd = Infinity;
    for (const s of this.rareFlora.specimens) {
      const dx = s.x - x;
      const dz = s.z - z;
      const d = Math.hypot(dx, dz);
      if (d > 3.4 || d < 0.2) continue;
      if ((dx * fx + dz * fz) / d < 0.45) continue;
      if (d < bd) {
        bd = d;
        best = { x: s.x, y: s.y, z: s.z };
      }
    }
    return best;
  }

  /** Grab the next rendered frame (the photo). */
  capture(cb: (canvas: HTMLCanvasElement) => void): void {
    this.shot = cb;
  }

  /** True when the macro lens found a flower to frame. */
  get macroHasTarget(): boolean {
    return !!this.macroTarget;
  }

  /** Scroll to zoom while in macro. */
  zoomMacro(deltaY: number): void {
    this.macroFov = Math.min(60, Math.max(4, this.macroFov * (1 + deltaY * 0.0012)));
  }

  // ---------- flight ----------

  /** Take off, or come down to land if already flying. */
  toggleFlight(): void {
    const c = this.controller;
    if (c.flying) {
      c.flight.auto = false;
      c.land();
      return;
    }
    if (this.macro) this.setMacro(false);
    c.startFlight(this.camera);
    const p = c.position;
    this.flightFX.burst(p.x, p.y, p.z, 160, 1);
    this.sfx.whoosh(1, 1.8, true);
    this.blastT = 1;
    this.onFlightChange?.(true);
  }

  get flying(): boolean {
    return this.controller.flying;
  }

  setWander(on: boolean): void {
    const c = this.controller;
    if (c.flying) {
      // In the air, "wander" is the autopilot.
      if (c.flight.auto === on || c.flight.mode !== 'fly') return;
      c.flight.setAuto(on, c.yaw, c.pitch);
      this.onWanderChange?.(on);
      return;
    }
    if (this.controller.wanderActive === on) return;
    this.controller.wanderActive = on;
    if (on) this.controller.wander.reset(this.controller.yaw);
    this.onWanderChange?.(on);
  }

  setTime(name: TimeName, seconds = 5): void {
    params.atmosphere.time = name;
    this.tod.set(name, seconds);
    this.panel?.refresh();
  }

  cycleTime(): TimeName {
    const names = Object.keys(TIME_PRESETS) as TimeName[];
    const next = names[(names.indexOf(params.atmosphere.time) + 1) % names.length];
    this.setTime(next);
    return next;
  }

  setGrassType(name: GrassTypeName): void {
    const prevDensity = params.grass.density;
    Object.assign(params.grass, GRASS_TYPES[name], { type: name });
    this.applyGrass();
    if (params.grass.density !== prevDensity) this.rebuildGrass();
  }

  private applyGrass(): void {
    const g = params.grass;
    U.uGrassBase.value.set(g.base);
    U.uGrassMid.value.set(g.mid);
    U.uGrassTip.value.set(g.tip);
    U.uGrassHeight.value = g.height;
    U.uGrassHeightVar.value = g.heightVar;
    U.uGrassWidth.value = g.width;
    U.uStiffness.value = g.stiffness;
  }

  applyWind(): void {
    const w = params.wind;
    const a = (w.direction * Math.PI) / 180;
    U.uWindDir.value.set(Math.cos(a), Math.sin(a));
    U.uWindStrength.value = w.strength;
    U.uGustStrength.value = w.gust;
    U.uGustSpeed.value = w.gustSpeed;
  }

  applyAtmosphere(): void {
    U.uCloudCover.value = params.atmosphere.clouds;
    U.uCloudShadow.value = params.atmosphere.cloudShadows;
    this.tod.fogScale = params.atmosphere.fog;
  }

  applyFlowers(): void {
    if (this.flowers) {
      this.flowers.mesh.visible = params.flowers.enabled;
      this.flowers.density = params.flowers.density;
    }
    if (this.particles) this.particles.points.visible = params.particles;
  }

  private rebuildGrass(): void {
    // Debounce slider drags.
    window.clearTimeout(this.densityTimer);
    this.densityTimer = window.setTimeout(() => {
      this.grass.build(grassLayers(this.tier, params.grass.density));
    }, 120);
  }

  private setTier(t: Tier): void {
    if (t === this.tier && this.grass.bladeCount > 0) return;
    this.tier = t;
    this.dprCap = Infinity;
    this.lastTierChange = this.elapsed;
    this.buildForTier();
    this.needsResize = true;
  }

  private buildForTier(): void {
    const cfg = TIERS[this.tier];
    this.grass.build(grassLayers(this.tier, params.grass.density));
    const rn = cfg.near.size / 2;
    this.terrain.setFarRange(rn * 0.7, cfg.far.size * 0.42);

    if (this.flowers) {
      this.scene.remove(this.flowers.mesh);
      this.flowers.dispose();
    }
    this.flowers = new Flowers(cfg.flowers);
    this.scene.add(this.flowers.mesh);

    if (this.particles) {
      this.scene.remove(this.particles.points);
      this.particles.dispose();
    }
    this.particles = new Particles(cfg.particles);
    this.scene.add(this.particles.points);
    this.applyFlowers();

    this.post?.dispose();
    this.post = cfg.post ? new Post(this.renderer, this.scene, this.camera) : null;
    const a2c = cfg.post || this.renderer.getContext().getContextAttributes()?.antialias === true;
    this.tree.setAlphaToCoverage(a2c);
    // On the bare canvas (low tier) alpha-to-coverage leaves bright speckles in distant crowns: hard alpha test there.
    this.forest?.setAlphaToCoverage(cfg.post);
    this.forest?.setDetail(this.tier === 'high' ? 150 : this.tier === 'medium' ? 110 : 70);
    this.shadows.enabled = this.tier !== 'low';
    this.shadows.setSize(this.tier === 'high' ? 2048 : 1536);
    this.clouds.scale = cfg.cloudScale;
    this.clouds.steps = cfg.cloudSteps;
  }

  /** After a camera cut: drop temporal history that would smear across the jump. */
  cut(): void {
    this.clouds.reset();
  }

  private resize(): void {
    const w = this.fixedSize?.w ?? window.innerWidth;
    const h = this.fixedSize?.h ?? window.innerHeight;
    const dpr = this.fixedSize ? 1 : Math.min(window.devicePixelRatio || 1, TIERS[this.tier].maxDpr, this.dprCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post?.setSize(w, h, dpr);
    this.renderer.getDrawingBufferSize(this.bufferSize);
    this.clouds.setSize(this.bufferSize.x, this.bufferSize.y);
    U.uPixelRatio.value = dpr;
  }

  // ---------- loop ----------

  private frame(t: number): void {
    if (this.needsResize) {
      this.needsResize = false;
      this.resize();
    }
    this.clock.update(t);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.elapsed += dt;
    U.uTime.value = this.elapsed;

    this.tod.update(dt);
    if (this.director) {
      this.frameScene(dt, this.director.update(dt, this.camera));
      return;
    }
    this.macroAmt += ((this.macro ? 1 : 0) - this.macroAmt) * Math.min(1, dt * 3);
    const e = this.macroAmt * this.macroAmt * (3 - 2 * this.macroAmt);
    // In flight the view widens with speed.
    this.flyFov += ((this.controller.flying ? Math.min(16, this.controller.flight.speed * 0.25) + 4 : 0) - this.flyFov) * Math.min(1, dt * 1.5);
    this.fovKick *= Math.exp(-dt * 2.5);
    const fov = params.move.fov + this.flyFov + this.fovKick + (this.macroFov - (params.move.fov + this.flyFov + this.fovKick)) * e;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.controller.lookScale = Math.min(1, fov / params.move.fov);
    // Ease the view onto the chosen flower for a moment, then hand control back.
    if (this.macroTarget && this.macroAim > 0) {
      this.macroAim -= dt;
      const t = this.macroTarget;
      const cp = this.camera.position;
      const dx = t.x - cp.x;
      const dy = t.y - cp.y;
      const dz = t.z - cp.z;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const k = 1 - Math.exp(-dt * 4);
      let dyaw = (yaw - this.controller.yaw) % (Math.PI * 2);
      if (dyaw > Math.PI) dyaw -= Math.PI * 2;
      if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      this.controller.yaw += dyaw * k;
      this.controller.pitch += (pitch - this.controller.pitch) * k;
    }
    this.breath.update(dt);
    this.controller.update(dt, this.camera);
    this.frameScene(dt, e);
  }

  /** Everything after the camera is placed: world updates, audio, render. `e` is the depth-of-field amount. */
  private frameScene(dt: number, e: number): void {
    const p = this.controller.position;
    const cam = this.camera.position;
    this.features.update(p.x, p.z);
    this.terrain.update(cam.x, cam.z);
    const sunY = U.uSunDir.value.y;
    U.uLights.value = Math.min(1, this.tod.night * 1.15 + Math.max(0, Math.min(1, (0.2 - sunY) / 0.25)) * 0.55);
    this.structures.update(dt, this.elapsed);
    const alt = cam.y - p.y;
    const high = this.controller.flying && alt > 25;
    const tod = params.atmosphere.time;
    this.fauna.update(dt, high ? 1e6 : p.x, high ? 1e6 : p.z, this.controller.speed, tod);
    this.rareFlora.update(dt, cam.x, cam.z, this.features.version, smooth01((U.uLights.value - 0.25) / 0.45));
    this.critters.update(dt, p.x, p.z, tod, this.features.version);
    this.flightFeel(dt, alt);
    if (this.started && !this.director) {
      this.lens = this.discovery.update(dt, this.camera, this.macro, tod, this.post ? this.post.centerDepth : NaN);
      // Focus pulls onto the framed subject (not the grass in front of it).
      const want = this.macro && Number.isFinite(this.lens.dist) ? this.lens.dist : -1;
      if (want < 0) FX.focus = -1;
      else FX.focus = FX.focus <= 0 ? want : FX.focus + (want - FX.focus) * Math.min(1, dt * 5);
    }
    this.skyward.update(dt, this.elapsed);
    this.forest.update(cam.x, cam.z);
    this.birds.update(dt, cam.x, cam.z, params.birds ? this.tod.night : 1);
    this.clouds.render(this.renderer, this.camera, dt);
    this.sky.update(cam.x, cam.y, cam.z, this.clouds.texture, this.bufferSize);
    const part = this.director
      ? this.trailPart
      : this.macro && this.macroTarget
        ? { x: this.macroTarget.x, z: this.macroTarget.z, strength: 0.9 }
        : null;
    const skim = this.controller.flying && alt < 4;
    const trailV = this.controller.flying && !skim ? 0 : 1;
    // Grass bows away around rare flowers not yet collected; flying low, it flattens in rings below you.
    const tp = this.trailParts;
    tp.length = 0;
    if (!this.director) {
      const lowFly = this.controller.flying ? Math.max(0, 1 - alt / 16) : 0;
      if (lowFly > 0) tp.push({ x: p.x, z: p.z, r: 2.2 + alt * 0.25, s: 0.9 * lowFly });
      if (this.blastT > 0) {
        this.blastT -= dt;
        tp.push({ x: p.x, z: p.z, r: 1.5 + (1 - this.blastT) * 6, s: Math.max(0, this.blastT) * 1.2 });
      }
      // The lens parts the grass around what it frames and along the line of sight to it.
      const ls = this.discovery.focusPoint;
      const t = this.macro && !this.controller.flying ? (ls && Math.hypot(ls.x - p.x, ls.z - p.z) < 18 ? ls : this.macroTarget) : null;
      if (t) {
        const d = Math.hypot(t.x - p.x, t.z - p.z);
        const animal = t === ls && this.discovery.state.subject?.cat === 'fauna';
        tp.push({ x: t.x, z: t.z, r: animal ? 1.3 : 0.7, s: 1 });
        if (d > 0.5) tp.push({ x: (t.x + p.x) / 2, z: (t.z + p.z) / 2, r: animal ? 0.7 : 0.55, s: 1, ax: (t.x - p.x) / d, az: (t.z - p.z) / d, len: d / 2 });
      }
      this.rareFlora.nearby(p.x, p.z, 19, (id) => this.journal.isCollected(id), tp);
      if (tp.length > 8) tp.length = 8;
    }
    this.trail.update(this.renderer, dt, p.x, p.z, this.controller.velocity.x * trailV, this.controller.velocity.y * trailV, this.controller.crouch, part, tp);

    if (this.audio.running) {
      const yaw = this.controller.yaw;
      this.bells.update(dt, p.x, p.z, yaw);
      if (!this.director) this.voices(dt, p.x, p.z, yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const wd = U.uWindDir.value;
      this.audio.update({
        dt,
        speed: this.controller.speed,
        crouch: this.controller.crouch,
        grassHeight: params.grass.height,
        windStrength: params.wind.strength + (this.controller.flying ? Math.min(1.6, this.controller.flight.speed * 0.03 + Math.min(1, alt / 200) * 0.3) : 0),
        gust: gustAt(p.x, p.z) * params.wind.gust + (this.controller.flying ? Math.min(0.8, this.controller.flight.speed * 0.012) : 0),
        gustLeft: gustAt(p.x - rx * 12, p.z - rz * 12) * params.wind.gust,
        gustRight: gustAt(p.x + rx * 12, p.z + rz * 12) * params.wind.gust,
        windPan: -(wd.x * rx + wd.y * rz),
        night: this.tod.night,
        breath: this.breath.value,
        breathOn: this.breath.active,
        mood: params.atmosphere.time,
        ...this.waterAndBirdAudio(p.x, p.z, rx, rz),
      });
    }

    // Sun shadows over the area in front of the camera.
    const ce = this.camera.matrixWorld.elements;
    const fl = Math.hypot(ce[8], ce[10]) || 1;
    const fwdX = -ce[8] / fl;
    const fwdZ = -ce[10] / fl;
    this.shadows.render(this.renderer, cam.x + fwdX * 35, cam.y, cam.z + fwdZ * 35);

    this.renderer.toneMappingExposure = this.tod.exposure * FX.exposure;
    if (this.post) this.post.render(this.elapsed, params.post.bloom * this.tod.bloom * 0.6, params.post.vignette + e * 0.4, e, this.macro && !this.director);
    else this.renderer.render(this.scene, this.camera);
    // A photo: read the frame back while it is still in the drawing buffer.
    if (this.shot) {
      const cb = this.shot;
      this.shot = null;
      cb(this.renderer.domElement);
    }

    if (this.firstFrame) {
      this.firstFrame = false;
      this.onFirstFrame?.();
    }
    this.measure(dt);
  }

  /** Speed lines, the rush at the edges of the view, a whoosh when you put on speed. */
  private flightFeel(dt: number, alt: number): void {
    const c = this.controller;
    const f = c.flight;
    if (c.flying) {
      this.flyVel.copy(f.vel);
      const sp = f.speed;
      const rush = Math.min(1, Math.max(0, (sp - 14) / 46));
      FX.speed += (rush * 0.85 - FX.speed) * Math.min(1, dt * 3);
      this.flightFX.update(dt, this.flyVel, Math.min(1, sp / 22) * (alt > 2 ? 1 : 0.4));
      const boost = c.boosting;
      if (boost && !this.wasBoost && f.mode === 'fly') {
        this.sfx.whoosh(0.8, 1.3, true);
        this.fovKick = 7;
      }
      this.wasBoost = boost;
    } else {
      FX.speed += (0 - FX.speed) * Math.min(1, dt * 4);
      this.flightFX.update(dt, this.flyVel.multiplyScalar(Math.exp(-dt * 3)), 0);
      this.wasBoost = false;
    }
  }

  /** Animals you come near make themselves heard. */
  private voices(dt: number, x: number, z: number, yaw: number): void {
    this.callT -= dt;
    if (this.callT > 0) return;
    this.callT = 0.6;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const pan = (ax: number, az: number, d: number) => ((ax - x) * rx + (az - z) * rz) / Math.max(d, 1);
    const kinds: Partial<Record<string, Call>> = { sheep: 'sheep', horse: 'horse', chicken: 'chicken', owl: 'owl', fox: 'fox', cat: 'cat', deer: 'deer', heron: 'heron' };
    for (const a of this.fauna.nearest(x, z, 55)) {
      const k = kinds[a.sp];
      if (k && Math.random() < 0.35) this.sfx.call(k, a.d, pan(a.x, a.z, a.d));
    }
    const tod = params.atmosphere.time;
    const fr = this.critters.nearestFrog(x, z);
    if (fr && fr.d < 35 && tod !== 'Noon') this.sfx.call('frog', fr.d, pan(fr.x, fr.z, fr.d));
    const kt = this.critters.nearestKite(x, z);
    if (kt && Math.random() < 0.2) this.sfx.call('kite', Math.min(59, kt.d * 0.4), pan(kt.x, kt.z, Math.hypot(kt.x - x, kt.z - z)));
  }

  private waterAndBirdAudio(x: number, z: number, rx: number, rz: number) {
    const w = this.features.nearestWater(x, z);
    const brook = Math.max(0, 1 - w.stream / 28);
    const brookPan = w.stream < Infinity ? ((w.pan.x - x) * rx + (w.pan.z - z) * rz) / Math.max(w.stream, 1) : 0;
    const pond = Math.max(0, 1 - w.pool / 20);
    const b = this.birds.nearest;
    const birdNear = Math.max(0, 1 - b.dist / 60);
    const birdPan = b.dist < Infinity ? ((b.x - x) * rx + (b.z - z) * rz) / Math.max(Math.hypot(b.x - x, b.z - z), 1) : 0;
    return { brook: brook * brook, brookPan, pond, birdNear, birdPan };
  }

  private measure(dt: number): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime < 2) return;
    this.fps = this.fpsFrames / this.fpsTime;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.panel.setStats(this.grass.bladeCount, this.fps, this.tier);

    // Step down one tier if we stay well under 40 fps (never while the tab is settling).
    if (!this.autoTier || this.director || this.elapsed < 5 || this.elapsed - this.lastTierChange < 6) return;
    this.lowFpsStreak = this.fps < 40 ? this.lowFpsStreak + 1 : 0;
    const idx = TIER_ORDER.indexOf(this.tier);
    if (this.lowFpsStreak >= 2 && idx > 0) {
      this.lowFpsStreak = 0;
      this.setTier(TIER_ORDER[idx - 1]);
    } else if (this.lowFpsStreak >= 2 && this.renderer.getPixelRatio() > 1) {
      // Already on the lowest tier: trade sharpness for frame rate, down to 1x.
      this.lowFpsStreak = 0;
      this.lastTierChange = this.elapsed;
      this.dprCap = Math.max(1, this.renderer.getPixelRatio() - 0.25);
      this.needsResize = true;
    }
  }
}

function smooth01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
