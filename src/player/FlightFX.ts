import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { U } from '../core/uniforms';

const STREAKS = 220;
const BOX = 70;

const STREAK_VERT = /* glsl */ `
uniform vec3 uVel;
uniform float uAmt;
attribute vec4 aSeed;
attribute vec2 aCorner;
varying float vA;
varying float vSide;
void main() {
  vec3 base = (aSeed.xyz - 0.5) * ${BOX.toFixed(1)};
  vec3 rel = mod(base - cameraPosition + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
  vec3 wp = cameraPosition + rel;
  float sp = length(uVel);
  vec3 dir = sp > 0.01 ? uVel / sp : vec3(0.0, 0.0, 1.0);
  float len = clamp(sp * 0.09, 0.0, 9.0) * (0.45 + aSeed.w);
  vec3 P = wp - dir * len * aCorner.x;
  vec3 toCam = normalize(cameraPosition - P);
  vec3 side = normalize(cross(dir, toCam) + vec3(1e-5));
  float w = (0.012 + 0.025 * aSeed.w) * (1.0 - aCorner.x * 0.75);
  P += side * aCorner.y * w;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
  float d = length(rel);
  vA = uAmt * (1.0 - aCorner.x) * smoothstep(${(BOX * 0.5).toFixed(1)}, ${(BOX * 0.18).toFixed(1)}, d) * smoothstep(1.2, 6.0, d);
  vSide = aCorner.y;
}
`;
const STREAK_FRAG = /* glsl */ `
uniform vec3 uSunColor;
uniform vec3 uAmbient;
varying float vA;
varying float vSide;
void main() {
  float a = vA * (1.0 - vSide * vSide);
  if (a < 0.003) discard;
  vec3 col = mix(vec3(0.9, 0.96, 1.0), uSunColor, 0.25) * (0.5 + 0.5 * length(uAmbient));
  gl_FragColor = vec4(col * a * 0.55, 1.0);
}
`;

const BURST = 260;
const BURST_VERT = /* glsl */ `
uniform float uPixelRatio;
attribute vec3 aCol;
attribute vec2 aLife; // age 0..1, size
varying vec3 vCol;
varying float vA;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vCol = aCol;
  vA = aLife.x < 1.0 ? (1.0 - aLife.x) * smoothstep(0.0, 0.05, aLife.x) : 0.0;
  gl_PointSize = aLife.y * uPixelRatio * 600.0 / max(-mv.z, 0.2);
}
`;
const BURST_FRAG = /* glsl */ `
uniform vec3 uSunColor;
uniform vec3 uAmbient;
varying vec3 vCol;
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.25, length(d * vec2(1.0, 1.7))) * vA;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vCol * (uAmbient + uSunColor * 0.8), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const BITS: [number, number, number][] = [
  [0.22, 0.45, 0.12],
  [0.35, 0.6, 0.16],
  [0.55, 0.72, 0.2],
  [0.75, 0.8, 0.35],
  [1.0, 0.75, 0.85],
  [1.0, 1.0, 0.92],
  [1.0, 0.85, 0.3],
];

/**
 * What flying feels like: speed lines that stream past in the direction of travel, a burst of
 * grass and petals thrown up at take-off and landing, and the grass flattening in rings under
 * you when you skim low (the downwash is stamped into the trail map by the experience).
 */
export class FlightFX {
  readonly group = new Group();
  private readonly streakMat: ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly lifeAttr: BufferAttribute;
  private readonly posAttr: BufferAttribute;
  private readonly colAttr: BufferAttribute;
  private readonly rate: Float32Array;
  private cursor = 0;
  private alive = 0;

  constructor() {
    const g = new InstancedBufferGeometry();
    g.setAttribute('aCorner', new BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
    g.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    const seed = new Float32Array(STREAKS * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    g.setAttribute('aSeed', new InstancedBufferAttribute(seed, 4));
    g.instanceCount = STREAKS;
    this.streakMat = new ShaderMaterial({
      uniforms: { uVel: { value: new Vector3() }, uAmt: { value: 0 }, uSunColor: U.uSunColor, uAmbient: U.uAmbient },
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const streaks = new Mesh(g, this.streakMat);
    streaks.frustumCulled = false;
    streaks.renderOrder = 12;
    this.group.add(streaks);

    const bg = new BufferGeometry();
    this.pos = new Float32Array(BURST * 3);
    this.vel = new Float32Array(BURST * 3);
    this.life = new Float32Array(BURST * 2).fill(1);
    this.rate = new Float32Array(BURST);
    this.posAttr = new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    this.lifeAttr = new BufferAttribute(this.life, 2).setUsage(DynamicDrawUsage);
    this.colAttr = new BufferAttribute(new Float32Array(BURST * 3), 3).setUsage(DynamicDrawUsage);
    bg.setAttribute('position', this.posAttr);
    bg.setAttribute('aLife', this.lifeAttr);
    bg.setAttribute('aCol', this.colAttr);
    const burst = new Points(
      bg,
      new ShaderMaterial({
        uniforms: { uPixelRatio: U.uPixelRatio, uSunColor: U.uSunColor, uAmbient: U.uAmbient },
        vertexShader: BURST_VERT,
        fragmentShader: BURST_FRAG,
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
      }),
    );
    burst.frustumCulled = false;
    this.group.add(burst);
  }

  /** Grass, petals and pollen thrown up around a point. */
  burst(x: number, y: number, z: number, n: number, power: number): void {
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % BURST;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 2.2;
      this.pos[i * 3] = x + Math.cos(a) * r;
      this.pos[i * 3 + 1] = y + Math.random() * 0.6;
      this.pos[i * 3 + 2] = z + Math.sin(a) * r;
      const out = (2 + Math.random() * 6) * power;
      this.vel[i * 3] = Math.cos(a) * out;
      this.vel[i * 3 + 1] = (3 + Math.random() * 7) * power;
      this.vel[i * 3 + 2] = Math.sin(a) * out;
      this.life[i * 2] = 0;
      this.life[i * 2 + 1] = 0.03 + Math.random() * 0.05;
      this.rate[i] = 1 / (1.6 + Math.random() * 2.2);
      const c = BITS[Math.floor(Math.random() * BITS.length)];
      this.colAttr.setXYZ(i, c[0], c[1], c[2]);
    }
    this.colAttr.needsUpdate = true;
    this.alive = 4;
  }

  update(dt: number, vel: Vector3, amount: number): void {
    this.streakMat.uniforms.uVel.value.copy(vel);
    const u = this.streakMat.uniforms.uAmt;
    u.value += (amount - u.value) * Math.min(1, dt * 3);
    if (this.alive <= 0) return;
    this.alive -= dt;
    const t = U.uTime.value;
    for (let i = 0; i < BURST; i++) {
      if (this.life[i * 2] >= 1) continue;
      this.life[i * 2] = Math.min(1, this.life[i * 2] + dt * this.rate[i]);
      // Light bits: strong drag, they flutter down slowly and drift with the wind.
      const drag = Math.exp(-dt * 2.2);
      this.vel[i * 3] = this.vel[i * 3] * drag + U.uWindDir.value.x * dt * 2 + Math.sin(t * 3 + i) * dt * 1.5;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - dt * 2.4;
      this.vel[i * 3 + 2] = this.vel[i * 3 + 2] * drag + U.uWindDir.value.y * dt * 2 + Math.cos(t * 2.6 + i) * dt * 1.5;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.posAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
  }
}
