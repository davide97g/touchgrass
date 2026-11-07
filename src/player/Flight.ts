import { MathUtils, Vector2, Vector3 } from 'three';
import { terrainHeight } from '../world/common';

/** A place the autopilot flies to and circles: centre, orbit radius, cruising height above sea level. */
export interface Waypoint {
  name: string;
  x: number;
  z: number;
  r: number;
  alt: number;
}

export type FlightMode = 'launch' | 'fly' | 'land';

export interface FlightInput {
  /** -1..1 forward along the gaze. */
  forward: number;
  /** -1..1 sideways. */
  strafe: number;
  /** -1..1 straight up / down. */
  lift: number;
  boost: boolean;
}

const EYE = 1.6;
const CRUISE = 17;
const BOOST = 3.6;
const CEILING = 1250;

function wrap(a: number): number {
  return ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}

/**
 * Flight: a launch that throws you into the air, then free flight that follows your gaze
 * (look down to dive, up to climb), with a little glide and inertia, banking into turns.
 * The autopilot tours the realm's landmarks, circling each before moving on.
 */
export class Flight {
  mode: FlightMode = 'launch';
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  auto = false;
  roll = 0;
  /** Speed of the last frame (m/s), for wind, FOV and sound. */
  speed = 0;
  private t = 0;
  private launchFrom = 0;
  private launchTo = 0;
  private prevYaw = 0;
  private route: Waypoint[] = [];
  private target = 0;
  private orbitT = 0;
  private orbitDir = 1;
  /** The autopilot's own heading and gaze. */
  autoYaw = 0;
  autoPitch = 0;
  /** Where the autopilot looks (toward the landmark while circling it). */
  autoLookYaw = 0;

  constructor(private readonly waypoints: () => Waypoint[]) {}

  start(x: number, eyeY: number, z: number, yaw: number, vx: number, vz: number): void {
    this.mode = 'launch';
    this.t = 0;
    this.pos.set(x, eyeY, z);
    this.vel.set(vx, 0, vz);
    const ground = terrainHeight(x, z);
    this.launchFrom = eyeY;
    this.launchTo = Math.max(eyeY, ground) + 55;
    this.prevYaw = yaw;
    this.autoYaw = yaw;
    this.auto = false;
  }

  land(): void {
    if (this.mode !== 'land') this.mode = 'land';
  }

  setAuto(on: boolean, yaw: number, pitch: number): void {
    this.auto = on;
    if (on) {
      this.autoYaw = yaw;
      this.autoLookYaw = yaw;
      this.autoPitch = pitch;
      this.planRoute();
    }
  }

  private planRoute(): void {
    // Nearest first, then onward in a loop that keeps moving away from where we were.
    const all = this.waypoints().slice();
    const out: Waypoint[] = [];
    let cx = this.pos.x;
    let cz = this.pos.z;
    while (all.length) {
      let bi = 0;
      let bd = Infinity;
      all.forEach((w, i) => {
        const d = Math.hypot(w.x - cx, w.z - cz);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      const w = all.splice(bi, 1)[0];
      out.push(w);
      cx = w.x;
      cz = w.z;
    }
    this.route = out;
    this.target = 0;
    this.orbitT = 0;
  }

  /** The ground clearance needed along the next stretch of the flight path. */
  private terrainAhead(x: number, z: number, dx: number, dz: number, reach: number): number {
    let h = terrainHeight(x, z);
    for (let i = 1; i <= 6; i++) {
      const t = (i / 6) * reach;
      h = Math.max(h, terrainHeight(x + dx * t, z + dz * t));
    }
    return h;
  }

  /**
   * Advance one frame. Returns true when the flight has ended (landed).
   * `canStand` decides whether a landing spot is acceptable.
   */
  update(dt: number, yaw: number, pitch: number, input: FlightInput, canStand: (x: number, z: number) => boolean): boolean {
    this.t += dt;
    const p = this.pos;
    const v = this.vel;
    const ground = terrainHeight(p.x, p.z);

    // Gaze frame.
    const cp = Math.cos(pitch);
    const fwd = new Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const desired = new Vector3();
    if (this.auto && this.mode === 'fly') {
      this.autopilot(dt, desired);
    } else {
      const sp = CRUISE * (input.boost ? BOOST : 1);
      desired.addScaledVector(fwd, input.forward * sp);
      desired.addScaledVector(right, input.strafe * sp * 0.7);
      desired.y += input.lift * sp * 0.65;
    }

    if (this.mode === 'launch') {
      // Thrown upward on an easing curve; you can already steer.
      const k = Math.min(1, this.t / 1.6);
      const e = 1 - Math.pow(1 - k, 3);
      v.x += (desired.x - v.x) * (1 - Math.exp(-dt * 1.5));
      v.z += (desired.z - v.z) * (1 - Math.exp(-dt * 1.5));
      const y = this.launchFrom + (this.launchTo - this.launchFrom) * e;
      v.y = (y - p.y) / Math.max(dt, 1e-4);
      p.x += v.x * dt;
      p.z += v.z * dt;
      p.y = y;
      if (k >= 1) {
        this.mode = 'fly';
        v.y = 0;
      }
    } else if (this.mode === 'fly') {
      // Gliding inertia: quick to respond, slow to stop.
      const accel = desired.lengthSq() > v.lengthSq() ? 1.8 : 1.1;
      v.lerp(desired, 1 - Math.exp(-dt * accel));
      p.addScaledVector(v, dt);
    } else {
      // Landing: drift down, keep a little forward motion, look for solid ground.
      const alt = p.y - (ground + EYE);
      const sink = -Math.min(22, Math.max(3.5, alt * 0.9));
      const hv = new Vector2(v.x, v.z).multiplyScalar(Math.exp(-dt * 0.8));
      const ok = canStand(p.x, p.z);
      if (!ok && hv.length() < 3) hv.set(-Math.sin(yaw) * 3, -Math.cos(yaw) * 3);
      v.set(hv.x, ok || alt > 2 ? sink : 0, hv.y);
      p.addScaledVector(v, dt);
      if (p.y <= ground + EYE + 0.05) {
        p.y = ground + EYE;
        if (ok) return true;
      }
    }

    // Never through the ground, never into the clouds.
    if (p.y < ground + 2.2 && this.mode !== 'land') {
      p.y = ground + 2.2;
      if (v.y < 0) v.y *= 0.2;
    }
    if (p.y > CEILING) {
      p.y = CEILING;
      if (v.y > 0) v.y = 0;
    }

    // Bank into turns and sideways drift.
    const yawRate = wrap(yaw - this.prevYaw) / Math.max(dt, 1e-4);
    this.prevYaw = yaw;
    const side = v.dot(right);
    const bank = MathUtils.clamp(-yawRate * 0.25 * Math.min(1, v.length() / 15) - side * 0.012, -0.45, 0.45);
    this.roll += (bank - this.roll) * (1 - Math.exp(-dt * 2.5));
    this.speed = v.length();
    return false;
  }

  /** Steer toward the current landmark, circle it a while, then the next. */
  private autopilot(dt: number, desired: Vector3): void {
    if (!this.route.length) this.planRoute();
    if (!this.route.length) return;
    const w = this.route[this.target % this.route.length];
    const p = this.pos;
    const dx = w.x - p.x;
    const dz = w.z - p.z;
    const dist = Math.hypot(dx, dz);
    let headX: number;
    let headZ: number;
    let altGoal: number;
    const speed = dist > w.r * 3 ? 26 : 16;
    if (dist > w.r * 1.25) {
      headX = dx / dist;
      headZ = dz / dist;
      altGoal = dist > w.r * 4 ? Math.max(w.alt, 0) : w.alt;
    } else {
      // Orbit: fly tangent, a little inward to hold the circle.
      this.orbitT += dt;
      const tx = (-dz / dist) * this.orbitDir;
      const tz = (dx / dist) * this.orbitDir;
      const pull = (dist - w.r) / w.r;
      headX = tx + (dx / dist) * pull;
      headZ = tz + (dz / dist) * pull;
      const l = Math.hypot(headX, headZ);
      headX /= l;
      headZ /= l;
      altGoal = w.alt;
      if (this.orbitT > 28) {
        this.target++;
        this.orbitT = 0;
        this.orbitDir = Math.random() < 0.5 ? 1 : -1;
      }
    }
    // Stay well clear of the land ahead.
    const clear = this.terrainAhead(p.x, p.z, headX, headZ, 260) + 45;
    altGoal = Math.max(altGoal, clear);

    // Turn smoothly toward the heading (yaw looks down -Z).
    const wantYaw = Math.atan2(-headX, -headZ);
    const turn = MathUtils.clamp(wrap(wantYaw - this.autoYaw), -0.32 * dt, 0.32 * dt);
    this.autoYaw += turn;
    const fx = -Math.sin(this.autoYaw);
    const fz = -Math.cos(this.autoYaw);
    desired.set(fx * speed, MathUtils.clamp((altGoal - p.y) * 0.25, -8, 10), fz * speed);

    // Gaze: ahead and a little down; toward the landmark while circling it.
    const toward = Math.atan2(-dx, -dz);
    const near = dist < w.r * 1.6 ? 0.75 : 0;
    this.autoLookYaw = this.autoYaw + MathUtils.clamp(wrap(toward - this.autoYaw), -1.1, 1.1) * near;
    let wantPitch = -0.12 - Math.min(0.25, Math.max(0, (p.y - terrainHeight(p.x, p.z) - 60) / 600));
    if (dist < w.r * 1.6) wantPitch = Math.atan2(w.alt - 40 - p.y, Math.max(dist, 1)) * 0.6;
    this.autoPitch += (wantPitch - this.autoPitch) * (1 - Math.exp(-dt * 0.6));
  }

  /** The waypoint the autopilot is heading for (for a toast). */
  get currentName(): string {
    return this.route.length ? this.route[this.target % this.route.length].name : '';
  }
}
