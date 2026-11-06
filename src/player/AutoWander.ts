/**
 * Hands-free drift: a slowly meandering heading, unhurried pace and a gaze that
 * wanders a little around the direction of travel, like a walk with no destination.
 */
export class AutoWander {
  private heading: number;
  private t = Math.random() * 1000;

  constructor(initialYaw: number) {
    this.heading = initialYaw;
  }

  reset(yaw: number): void {
    this.heading = yaw;
  }

  /** Veer away (used when the path ahead is deep water). */
  turn(dt: number): void {
    this.heading += dt * 0.9;
  }

  update(dt: number): { heading: number; yaw: number; pitch: number; speed: number } {
    this.t += dt;
    const t = this.t;
    const turn = 0.09 * Math.sin(t * 0.071) + 0.06 * Math.sin(t * 0.029 + 1.3) + 0.03 * Math.sin(t * 0.17 + 4.1);
    this.heading += turn * dt;
    return {
      heading: this.heading,
      yaw: this.heading + 0.32 * Math.sin(t * 0.093) + 0.12 * Math.sin(t * 0.21 + 2.0),
      pitch: -0.04 + 0.07 * Math.sin(t * 0.081 + 0.7),
      speed: 0.75 + 0.15 * Math.sin(t * 0.05),
    };
  }
}
