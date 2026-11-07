import { MathUtils, PerspectiveCamera, Vector2, Vector3 } from 'three';
import { params } from '../core/params';
import { findSpawn, terrainHeight } from '../world/common';
import { AutoWander } from './AutoWander';
import { Flight, type Waypoint } from './Flight';

const EYE = 1.6;
const EYE_CROUCH = 0.62;
const STEP_LENGTH = 0.72;

function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Controller {
  readonly position = new Vector3(0, 0, 0);
  readonly velocity = new Vector2();
  yaw = 0;
  pitch = -0.04;
  crouch = 0;
  crouchHeld = false;
  crouchToggled = false;
  enabled = false;
  locked = false;
  wanderActive = true;
  /** Macro lens: kneel, move slowly, look gently. */
  macro = false;
  lookScale = 1;
  private macroK = 0;
  readonly wander = new AutoWander(0);

  /** Joystick from touch controls, x = strafe, y = forward, each -1..1. */
  readonly touchMove = new Vector2();

  onStep: ((intensity: number) => void) | null = null;
  /** Returns false where the water is too deep to wade. */
  canStand: ((x: number, z: number) => boolean) | null = null;
  onUserMove: (() => void) | null = null;

  private readonly keys = new Set<string>();
  private groundY = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private time = 0;
  private runTime = 0;
  /** Flight state (see Flight.ts); `flying` while in the air. */
  flying = false;
  readonly flight: Flight;
  waypoints: () => Waypoint[] = () => [];
  onLanded: (() => void) | null = null;
  private slide = 0;
  private fallV = 0;
  /** Ground slope under the walker (rise over run). */
  slope = 0;
  speed = 0;

  constructor(private readonly dom: HTMLElement) {
    this.flight = new Flight(() => this.waypoints());
    const spawn = findSpawn();
    this.position.set(spawn.x, 0, spawn.z);
    this.yaw = spawn.yaw;
    this.wander.reset(spawn.yaw);
    this.groundY = terrainHeight(spawn.x, spawn.z);
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => this.onMouse(e));
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
  }

  /** Jump straight to a spot (fast travel): no easing in from the old ground height. */
  teleport(x: number, z: number, yaw: number): void {
    this.position.set(x, 0, z);
    this.groundY = terrainHeight(x, z);
    this.position.y = this.groundY;
    this.velocity.set(0, 0);
    this.slide = 0;
    this.fallV = 0;
    this.yaw = yaw;
    this.pitch = -0.02;
    this.wander.reset(yaw);
  }

    requestLock(): void {
    if (matchMedia('(pointer: coarse)').matches) return;
    const el = this.dom as HTMLElement & { requestPointerLock: (o?: object) => Promise<void> | void };
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => el.requestPointerLock());
      }
    } catch {
      el.requestPointerLock();
    }
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if ((e.target as HTMLElement)?.closest?.('input, textarea, .tp-dfwv')) return;
    const k = e.code;
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (this.flying && k === 'Space') e.preventDefault();
    if (!this.flying) {
      if (k === 'ControlLeft' || k === 'ControlRight') this.crouchHeld = down;
      if (down && k === 'KeyC' && !e.repeat) this.crouchToggled = !this.crouchToggled;
    }
    if (down && this.enabled && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ...(this.flying ? ['Space', 'KeyC', 'ControlLeft', 'ControlRight'] : [])].includes(k)) {
      this.onUserMove?.();
    }
  }

  private onMouse(e: MouseEvent): void {
    if (!this.enabled || !this.locked) return;
    const s = 0.0021 * params.move.sensitivity * this.lookScale;
    this.look(e.movementX * s, e.movementY * s);
    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) this.onUserMove?.();
  }

  /** Radians to turn: positive dx looks right, positive dy looks down. */
  look(dx: number, dy: number): void {
    this.yaw -= dx;
    this.pitch = MathUtils.clamp(this.pitch - dy, -1.35, 1.35);
  }

  /** Take off from where you stand. */
  startFlight(camera: PerspectiveCamera): void {
    if (this.flying) return;
    this.flying = true;
    this.wanderActive = false;
    this.crouchHeld = false;
    this.crouchToggled = false;
    this.flight.start(this.position.x, camera.position.y, this.position.z, this.yaw, this.velocity.x, this.velocity.y);
  }

  /** Head for the ground; the flight ends when you touch down somewhere solid. */
  land(): void {
    if (this.flying) this.flight.land();
  }

  private updateFlight(dt: number, camera: PerspectiveCamera): void {
    const f = this.flight;
    const k = (c: string) => this.keys.has(c);
    const input = { forward: 0, strafe: 0, lift: 0, boost: false };
    if (this.enabled && !f.auto) {
      input.forward = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0) + this.touchMove.y;
      input.strafe = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0) + this.touchMove.x;
      input.lift = (k('Space') ? 1 : 0) - (k('KeyC') || k('ControlLeft') || k('ControlRight') ? 1 : 0);
      input.boost = k('ShiftLeft') || k('ShiftRight');
    }
    if (f.auto) {
      const kk = 1 - Math.exp(-dt * 0.9);
      this.yaw = angleLerp(this.yaw, f.autoLookYaw, kk);
      this.pitch = MathUtils.lerp(this.pitch, f.autoPitch, kk);
    }
    const landed = f.update(dt, this.yaw, this.pitch, input, (x, z) => !this.canStand || this.canStand(x, z));
    const g = terrainHeight(f.pos.x, f.pos.z);
    this.position.set(f.pos.x, g, f.pos.z);
    this.velocity.set(f.vel.x, f.vel.z);
    this.speed = 0;
    if (landed) {
      this.flying = false;
      this.groundY = g;
      this.velocity.multiplyScalar(0.3);
      this.slide = 0;
      this.fallV = 0;
      this.onLanded?.();
    }
    const breathe = Math.sin(this.time * 0.9) * 0.08 * Math.min(1, (f.pos.y - g) / 10);
    camera.position.set(f.pos.x, f.pos.y + breathe, f.pos.z);
    camera.rotation.set(this.pitch, this.yaw, f.roll, 'YXZ');
  }

  update(dt: number, camera: PerspectiveCamera): void {
    this.time += dt;
    if (this.flying) {
      this.updateFlight(dt, camera);
      return;
    }
    const input = new Vector2();
    let run = false;
    let targetSpeed = params.move.speed;

    if (this.wanderActive) {
      const w = this.wander.update(dt);
      const k = 1 - Math.exp(-dt * 0.8);
      this.yaw = angleLerp(this.yaw, w.yaw, k);
      this.pitch = MathUtils.lerp(this.pitch, w.pitch, k);
      const rel = w.heading - this.yaw;
      input.set(-Math.sin(rel), Math.cos(rel));
      targetSpeed = w.speed;
    } else if (this.enabled) {
      const f = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
      const r = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
      input.set(r, f).add(this.touchMove);
      if (input.lengthSq() > 1) input.normalize();
      run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    }

    const crouching = this.crouchHeld || this.crouchToggled;
    this.macroK = MathUtils.lerp(this.macroK, this.macro ? 1 : 0, 1 - Math.exp(-dt * 3));
    this.crouch = MathUtils.lerp(this.crouch, crouching ? 1 : 0, 1 - Math.exp(-dt * 5));
    // Holding Shift: a brisk walk at first, then a long easy stride for crossing the realm.
    this.runTime = run ? this.runTime + dt : 0;
    const stride = run ? 1.9 + Math.min(1, Math.max(0, (this.runTime - 1.5) / 2.5)) * 2.6 : 1;
    targetSpeed *= stride * MathUtils.lerp(1, 0.5, this.crouch) * (this.macro ? 0.4 : 1);

    // Camera-relative move vector in world XZ (camera looks down -Z at yaw 0).
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wx = input.x * cos - input.y * sin;
    const wz = -input.x * sin - input.y * cos;
    // Slopes: climbing gets slow past ~20°, impossible past ~45°, where the ground gives way and you slide.
    const px = this.position.x;
    const pz = this.position.z;
    const e = 0.6;
    const gx = (terrainHeight(px + e, pz) - terrainHeight(px - e, pz)) / (2 * e);
    const gz = (terrainHeight(px, pz + e) - terrainHeight(px, pz - e)) / (2 * e);
    const slope = Math.hypot(gx, gz);
    const ux = slope > 1e-4 ? gx / slope : 0;
    const uz = slope > 1e-4 ? gz / slope : 0;
    this.slope = slope;
    const desired = new Vector2(wx, wz).multiplyScalar(targetSpeed);
    if (slope > 0.35) {
      const up = desired.x * ux + desired.y * uz;
      if (up > 0) {
        const keep = slope > 1.0 ? 0 : 1 - MathUtils.smoothstep(slope, 0.35, 1.0) * 0.85;
        desired.x -= ux * up * (1 - keep);
        desired.y -= uz * up * (1 - keep);
        if (slope > 0.9 && this.wanderActive) this.wander.turn(dt);
      }
    }
    const accel = desired.lengthSq() > 0.0001 ? 3.2 : 4.5;
    this.velocity.lerp(desired, 1 - Math.exp(-dt * accel));
    let slideX = 0;
    let slideZ = 0;
    if (slope > 1.0) {
      const vu = this.velocity.x * ux + this.velocity.y * uz;
      if (vu > 0) {
        this.velocity.x -= ux * vu;
        this.velocity.y -= uz * vu;
      }
      this.slide = Math.min(7, this.slide + dt * (slope - 0.9) * 9);
    } else this.slide = Math.max(0, this.slide - dt * 6);
    slideX = -ux * this.slide;
    slideZ = -uz * this.slide;


    const nx = this.position.x + (this.velocity.x + slideX) * dt;
    const nz = this.position.z + (this.velocity.y + slideZ) * dt;
    const ok = (x: number, z: number) => !this.canStand || this.canStand(x, z);
    if (ok(nx, nz)) {
      this.position.x = nx;
      this.position.z = nz;
    } else if (ok(nx, this.position.z)) {
      this.position.x = nx;
      this.velocity.y *= 0.5;
    } else if (ok(this.position.x, nz)) {
      this.position.z = nz;
      this.velocity.x *= 0.5;
    } else {
      this.velocity.multiplyScalar(0.5);
    }
    if (this.wanderActive && !ok(nx + this.velocity.x * 2, nz + this.velocity.y * 2)) this.wander.turn(dt);
    // Gravity: step up smoothly, but walk off a drop and you fall.
    const g = terrainHeight(this.position.x, this.position.z);
    if (g >= this.groundY - 0.35) {
      this.groundY = g > this.groundY ? MathUtils.lerp(this.groundY, g, 1 - Math.exp(-dt * 12)) : MathUtils.lerp(this.groundY, g, 1 - Math.exp(-dt * 20));
      if (this.fallV < -4) this.onStep?.(1); // landing
      this.fallV = 0;
    } else {
      this.fallV = Math.max(-40, this.fallV - 9.8 * dt);
      this.groundY = Math.max(g, this.groundY + this.fallV * dt);
    }
    this.position.y = this.groundY;

    // Head bob tied to stride; a footstep fires at each trough.
    this.speed = this.velocity.length();
    const prevStep = Math.floor(this.bobPhase / Math.PI);
    this.bobPhase += (this.speed * dt * Math.PI) / STEP_LENGTH;
    if (Math.floor(this.bobPhase / Math.PI) !== prevStep && this.speed > 0.25) {
      this.onStep?.(MathUtils.clamp(this.speed / 2.5, 0.25, 1));
    }
    const bobTarget = params.move.headBob ? MathUtils.clamp(this.speed / 1.4, 0, 1.6) : 0;
    this.bobAmp = MathUtils.lerp(this.bobAmp, bobTarget, 1 - Math.exp(-dt * 4));
    const bobY = -Math.abs(Math.sin(this.bobPhase)) * 0.035 * this.bobAmp + 0.0175 * this.bobAmp;
    const roll = Math.sin(this.bobPhase) * 0.004 * this.bobAmp;
    const breathe = Math.sin(this.time * 1.2) * 0.006;

    const eye = MathUtils.lerp(MathUtils.lerp(EYE, EYE_CROUCH, this.crouch), 1.22, this.macroK * (1 - this.crouch));
    camera.position.set(this.position.x, this.position.y + eye + bobY + breathe, this.position.z);
    camera.rotation.set(this.pitch, this.yaw, roll, 'YXZ');
  }
}
