import {
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { U } from '../core/uniforms';

const RES = 256;
const SIZE = 40; // metres covered, centred on the player

/**
 * Player-centred ping-pong map of push vectors. Each frame the previous map is
 * shifted (by whole texels, so it never blurs), decayed toward zero, and the
 * body is stamped in. Grass reads it to part around you and slowly spring back.
 */
export class TrailMap {
  private rtA: WebGLRenderTarget;
  private rtB: WebGLRenderTarget;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: ShaderMaterial;
  private readonly center = new Vector2();
  private initialised = false;
  /** Scales how hard the body presses the grass (the trailer turns it off for close-ups). */
  bodyScale = 1;

  constructor() {
    const opts = {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
    };
    this.rtA = new WebGLRenderTarget(RES, RES, opts);
    this.rtB = new WebGLRenderTarget(RES, RES, opts);
    this.mat = new ShaderMaterial({
      uniforms: {
        uPrev: { value: null },
        uShift: { value: new Vector2() },
        uDecay: { value: 0.99 },
        uPlayer: { value: new Vector2(0.5, 0.5) },
        uVel: { value: new Vector2() },
        uRadius: { value: 0.6 / SIZE },
        uStrength: { value: 1 },
        uPart: { value: new Vector2(-10, -10) },
        uPartR: { value: 0.02 },
        uPartS: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uPrev;
        uniform vec2 uShift;
        uniform float uDecay;
        uniform vec2 uPlayer;
        uniform vec2 uVel;
        uniform float uRadius;
        uniform float uStrength;
        uniform vec2 uPart;
        uniform float uPartR;
        uniform float uPartS;
        varying vec2 vUv;
        void main() {
          vec2 suv = vUv + uShift;
          vec2 prev = vec2(0.0);
          if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) prev = texture2D(uPrev, suv).rg;
          prev *= uDecay;

          vec2 d = vUv - uPlayer;
          float r = length(d);
          float f = smoothstep(uRadius * 2.2, uRadius * 0.4, r) * uStrength;
          vec2 dir = normalize(d + uVel * uRadius * 0.6 + vec2(1e-6));
          vec2 stamp = dir * f;
          // Second, ring-shaped stamp: hands parting the grass around a flower.
          vec2 dp = vUv - uPart;
          float rp = length(dp);
          float fp = smoothstep(uPartR * 1.7, uPartR * 0.8, rp) * smoothstep(0.0, uPartR * 0.45, rp) * uPartS;
          vec2 part = normalize(dp + vec2(1e-6)) * fp;
          if (length(part) > length(stamp)) stamp = part;
          vec2 outv = length(stamp) > length(prev) ? mix(prev, stamp, 0.6) : prev;
          gl_FragColor = vec4(outv, 0.0, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);

    U.uTrailMap.value = this.rtA.texture;
    U.uTrailSize.value = SIZE;
  }

  update(
    renderer: WebGLRenderer,
    dt: number,
    x: number,
    z: number,
    vx: number,
    vz: number,
    crouch: number,
    part: { x: number; z: number; strength: number } | null = null,
  ): void {
    const texel = SIZE / RES;
    const cx = Math.round(x / texel) * texel;
    const cz = Math.round(z / texel) * texel;
    const u = this.mat.uniforms;
    if (!this.initialised) {
      this.center.set(cx, cz);
      this.initialised = true;
    }
    u.uShift.value.set((cx - this.center.x) / SIZE, (cz - this.center.y) / SIZE);
    this.center.set(cx, cz);
    // ~6 s half-life: paths linger, then the field heals.
    u.uDecay.value = Math.pow(0.5, dt / 6);
    u.uPlayer.value.set((x - cx) / SIZE + 0.5, (z - cz) / SIZE + 0.5);
    u.uVel.value.set(vx, vz);
    u.uRadius.value = (0.45 + crouch * 0.35) / SIZE;
    u.uStrength.value = (0.85 + crouch * 0.35) * this.bodyScale;
    if (part) {
      u.uPart.value.set((part.x - cx) / SIZE + 0.5, (part.z - cz) / SIZE + 0.5);
      u.uPartR.value = 0.55 / SIZE;
      u.uPartS.value = part.strength;
    } else {
      u.uPartS.value = 0;
    }
    u.uPrev.value = this.rtA.texture;

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rtB);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);

    [this.rtA, this.rtB] = [this.rtB, this.rtA];
    U.uTrailMap.value = this.rtA.texture;
    U.uTrailCenter.value.copy(this.center);
  }
}
