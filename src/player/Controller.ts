import { MathUtils, PerspectiveCamera, Vector2, Vector3 } from 'three';
import { params } from '../core/params';
import { findSpawn, terrainHeight } from '../world/common';
import { AutoWander } from './AutoWander';

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
  speed = 0;

  constructor(private readonly dom: HTMLElement) {
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
    if (k === 'ControlLeft' || k === 'ControlRight') this.crouchHeld = down;
    if (down && k === 'KeyC' && !e.repeat) this.crouchToggled = !this.crouchToggled;
    if (down && this.enabled && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
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

  update(dt: number, camera: PerspectiveCamera): void {
    this.time += dt;
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
    targetSpeed *= (run ? 1.9 : 1) * MathUtils.lerp(1, 0.5, this.crouch) * (this.macro ? 0.4 : 1);

    // Camera-relative move vector in world XZ (camera looks down -Z at yaw 0).
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wx = input.x * cos - input.y * sin;
    const wz = -input.x * sin - input.y * cos;
    const desired = new Vector2(wx, wz).multiplyScalar(targetSpeed);
    const accel = desired.lengthSq() > 0.0001 ? 3.2 : 4.5;
    this.velocity.lerp(desired, 1 - Math.exp(-dt * accel));

    const nx = this.position.x + this.velocity.x * dt;
    const nz = this.position.z + this.velocity.y * dt;
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
    const g = terrainHeight(this.position.x, this.position.z);
    this.groundY = MathUtils.lerp(this.groundY, g, 1 - Math.exp(-dt * 12));
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
