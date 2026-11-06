import {
  NeutralToneMapping,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Timer,
  Vector2,
  WebGLRenderer,
} from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { Controller } from '../player/Controller';
import { TouchControls } from '../player/TouchControls';
import { Post } from '../post/Post';
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
import { Water } from '../world/Water';
import { GRASS_TYPES, params, type GrassTypeName, type TimeName } from './params';
import { detectTier, grassLayers, TIER_ORDER, TIERS, type Tier } from './quality';
import { U } from './uniforms';

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
  private readonly terrain = new Terrain();
  private readonly grass = new Grass();
  private readonly sky = new Sky();
  private readonly trail = new TrailMap();
  readonly features = new FeatureMap();
  private readonly water = new Water();
  private readonly rocks = new Rocks();
  private readonly aquatic = new Aquatic();
  private readonly birds = new Birds();
  private readonly clouds: Clouds;
  private readonly bufferSize = new Vector2();
  private flowers: Flowers | null = null;
  private particles: Particles | null = null;
  private post: Post | null = null;

  tier: Tier;
  private autoTier: boolean;
  started = false;
  private elapsed = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 60;
  private lowFpsStreak = 0;
  private lastTierChange = 0;
  private densityTimer = 0;
  private needsResize = false;

  /** Macro lens state: target on/off, eased amount, zoom. */
  macro = false;
  private macroAmt = 0;
  macroFov = 10;
  private macroTarget: { x: number; y: number; z: number } | null = null;
  private macroAim = 0;

  onFirstFrame: (() => void) | null = null;
  onWanderChange: ((on: boolean) => void) | null = null;
  private firstFrame = true;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;

    this.autoTier = params.quality === 'auto';
    this.tier = this.autoTier ? detectTier(this.renderer.getContext() as WebGL2RenderingContext) : (params.quality as Tier);

    this.camera = new PerspectiveCamera(params.move.fov, 1, 0.05, 2500);
    this.clouds = new Clouds(this.renderer, this.sky.cloudLit, this.sky.cloudShade);
    this.controller = new Controller(canvas);
    this.controller.canStand = (x, z) => this.features.waterDepth(x, z) < 0.42;
    this.features.onChange = () => {
      this.water.rebuild(this.features.active);
      this.rocks.rebuild(this.features.active);
      this.aquatic.rebuild(this.features);
    };
    this.features.update(this.controller.position.x, this.controller.position.z);
    this.faceNearestPool();
    this.controller.onStep = (i) => this.audio.step(i);
    this.controller.onUserMove = () => {
      if (this.started && this.controller.wanderActive) this.setWander(false);
    };
    if (matchMedia('(pointer: coarse)').matches) new TouchControls(canvas, this.controller);

    this.tod = new TimeOfDay(this.sky, params.atmosphere.time);
    this.scene.add(
      this.sky.mesh,
      this.terrain.mesh,
      this.grass.group,
      this.water.mesh,
      this.rocks.mesh,
      this.aquatic.group,
      this.birds.mesh,
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
    if (on && this.flowers) {
      const p = this.controller.position;
      this.macroTarget = this.flowers.findTarget(p.x, p.z, this.controller.yaw, this.features);
      this.macroAim = this.macroTarget ? 1.4 : 0;
    }
  }

  /** True when the macro lens found a flower to frame. */
  get macroHasTarget(): boolean {
    return !!this.macroTarget;
  }

  /** Scroll to zoom while in macro. */
  zoomMacro(deltaY: number): void {
    this.macroFov = Math.min(35, Math.max(5, this.macroFov * (1 + deltaY * 0.0012)));
  }

  setWander(on: boolean): void {
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

  private applyWind(): void {
    const w = params.wind;
    const a = (w.direction * Math.PI) / 180;
    U.uWindDir.value.set(Math.cos(a), Math.sin(a));
    U.uWindStrength.value = w.strength;
    U.uGustStrength.value = w.gust;
    U.uGustSpeed.value = w.gustSpeed;
  }

  private applyAtmosphere(): void {
    U.uCloudCover.value = params.atmosphere.clouds;
    U.uCloudShadow.value = params.atmosphere.cloudShadows;
    this.tod.fogScale = params.atmosphere.fog;
  }

  private applyFlowers(): void {
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
    this.clouds.scale = cfg.cloudScale;
    this.clouds.steps = cfg.cloudSteps;
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, TIERS[this.tier].maxDpr);
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
    this.macroAmt += ((this.macro ? 1 : 0) - this.macroAmt) * Math.min(1, dt * 3);
    const e = this.macroAmt * this.macroAmt * (3 - 2 * this.macroAmt);
    const fov = params.move.fov + (this.macroFov - params.move.fov) * e;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.controller.lookScale = fov / params.move.fov;
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

    const p = this.controller.position;
    const cam = this.camera.position;
    this.features.update(p.x, p.z);
    this.terrain.update(cam.x, cam.z);
    this.birds.update(dt, cam.x, cam.z, params.birds ? this.tod.night : 1);
    this.clouds.render(this.renderer, this.camera, dt);
    this.sky.update(cam.x, cam.y, cam.z, this.clouds.texture, this.bufferSize);
    const part = this.macro && this.macroTarget ? { x: this.macroTarget.x, z: this.macroTarget.z, strength: 0.9 } : null;
    this.trail.update(this.renderer, dt, p.x, p.z, this.controller.velocity.x, this.controller.velocity.y, this.controller.crouch, part);

    if (this.audio.running) {
      const yaw = this.controller.yaw;
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const wd = U.uWindDir.value;
      this.audio.update({
        dt,
        speed: this.controller.speed,
        crouch: this.controller.crouch,
        grassHeight: params.grass.height,
        windStrength: params.wind.strength,
        gust: gustAt(p.x, p.z) * params.wind.gust,
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

    this.renderer.toneMappingExposure = this.tod.exposure;
    if (this.post) this.post.render(this.elapsed, params.post.bloom * this.tod.bloom * 0.6, params.post.vignette + e * 0.4, e);
    else this.renderer.render(this.scene, this.camera);

    if (this.firstFrame) {
      this.firstFrame = false;
      this.onFirstFrame?.();
    }
    this.measure(dt);
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
    if (!this.autoTier || this.elapsed < 5 || this.elapsed - this.lastTierChange < 6) return;
    this.lowFpsStreak = this.fps < 40 ? this.lowFpsStreak + 1 : 0;
    const idx = TIER_ORDER.indexOf(this.tier);
    if (this.lowFpsStreak >= 2 && idx > 0) {
      this.lowFpsStreak = 0;
      this.setTier(TIER_ORDER[idx - 1]);
    }
  }
}
