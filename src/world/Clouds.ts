import {
  Color,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { params } from '../core/params';
import { U } from '../core/uniforms';
import { buildCloudNoise } from './CloudNoise';
import { COMMON_GLSL } from './common';

const FRAG = /* glsl */ `
${COMMON_GLSL}
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform mat4 uPrevViewProj;
uniform vec3 uEye;
uniform sampler2D uHistory;
uniform float uHistoryValid;
uniform float uFrame;
uniform int uSteps;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec2 uAltoOffset;
uniform vec2 uCirrusOffset;
uniform float uAlto;
uniform float uCirrus;
uniform float uStyle;
uniform float uHaze;
varying vec2 vUv;

#define PI 3.14159265

float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

float density(vec3 p) {
  vec2 w = cloudWeather(p.xz);
  if (w.x < 0.01) return 0.0;
  float d = cloudBase(p, w);
  if (d <= 0.0) return 0.0;
  float h = clamp((p.y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM), 0.0, 1.0);
  // Detail erosion: billowy tops, wispy undersides; scrolls faster than the base so edges churn.
  vec4 dn = texture(uNoise3D, (p - uCloudOffset * vec3(1.4, 2.6, 1.4)) / 950.0);
  float det = dn.g * 0.625 + dn.b * 0.25 + dn.a * 0.125;
  det = mix(1.0 - det, det, clamp(h * 4.0, 0.0, 1.0));
  return max(cremap(d, det * 0.5, 1.0, 0.0, 1.0), 0.0);
}

float densityCoarse(vec3 p) {
  vec2 w = cloudWeather(p.xz);
  if (w.x < 0.01) return 0.0;
  return cloudBase(p, w);
}

vec3 viewDir() {
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  return normalize((uCamWorld * vec4(normalize(v.xyz / v.w), 0.0)).xyz);
}

void main() {
  vec3 dir = viewDir();
  vec4 res = vec4(0.0);

  if (dir.y > 0.003) {
    vec3 L = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.06), uSunDir.z));
    float cosT = dot(dir, uSunDir);
    float phase = (hg(cosT, 0.65) * 0.55 + hg(cosT, -0.2) * 0.45) * 4.0 * PI;
    float jitter = ign(gl_FragCoord.xy + uFrame * 5.588);

    // ---------------- low: volumetric cumulus ----------------
    float t0 = (CLOUD_BOTTOM - uEye.y) / dir.y;
    float t1 = min((CLOUD_TOP - uEye.y) / dir.y, t0 + 16000.0);
    float T = 1.0;
    vec3 col = vec3(0.0);
    float dAcc = 0.0;
    float wAcc = 0.0;
    if (t0 < 70000.0) {
      float stepLen = (t1 - t0) / float(uSteps);
      float t = t0 + stepLen * jitter;
      for (int i = 0; i < 96; i++) {
        if (i >= uSteps || T < 0.02) break;
        vec3 p = uEye + dir * t;
        float d = density(p);
        if (d > 0.003) {
          // Light march toward the sun with growing steps.
          float lsum = 0.0;
          float ls = 70.0;
          vec3 lp = p;
          for (int j = 0; j < 5; j++) {
            lp += L * ls;
            lsum += densityCoarse(lp) * ls;
            ls *= 1.7;
          }
          float lt = exp(-lsum * 0.034);
          float powder = 1.0 - exp(-d * 6.0);
          float h = clamp((p.y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM), 0.0, 1.0);
          // Anime ramp vs physical falloff, blended by the style slider.
          float toon = smoothstep(0.1, 0.38, lt * (0.55 + 0.45 * powder));
          float e = mix(toon, lt * mix(0.6, 1.0, powder), uStyle);
          // Multiple scattering, cheaply: a softer transmittance lifts thin parts and keeps cores deep.
          float ms = exp(-lsum * 0.009);
          vec3 amb = mix(uCloudShade * 0.8, mix(uCloudShade, uCloudLit, 0.55), h) * (0.62 + 0.55 * ms);
          vec3 c = mix(amb, uCloudLit, e) + uSunColor * (lt * powder * phase * 0.22 + ms * phase * 0.05);
          float a = 1.0 - exp(-d * 0.06 * stepLen);
          col += T * a * c;
          dAcc += T * a * t;
          wAcc += T * a;
          T *= 1.0 - a;
        }
        t += stepLen;
      }
      // Aerial perspective: far clouds melt into the horizon haze.
      float dist = wAcc > 0.0 ? dAcc / wAcc : t0;
      float haze = 1.0 - exp(-dist / uHaze);
      col = mix(col, uFogColor * (1.0 - T), haze * 0.85);
    }

    // ---------------- mid: altocumulus "mackerel" patches ----------------
    vec4 behind = vec4(0.0);
    float ta = (5600.0 - uEye.y) / dir.y;
    if (uAlto > 0.0 && ta < 90000.0) {
      vec2 pa = (uEye + dir * ta).xz;
      vec2 uv = (pa - uAltoOffset) / 7000.0;
      vec4 cn = texture(uNoise3D, vec3(uv, uCloudOffset.y / 30000.0));
      float cells = cn.g * 0.7 + cn.b * 0.3;
      float mask = nz((pa - uAltoOffset) / 40000.0 + vec2(0.71, 0.27)).g * 0.7 + nz((pa - uAltoOffset) / 13000.0).a * 0.3;
      float a = smoothstep(0.5, 0.72, cells * mix(0.6, 1.25, mask)) * smoothstep(0.42, 0.62, mask) * uAlto * 0.85;
      a *= exp(-ta / 55000.0);
      vec3 c = mix(uCloudShade, uCloudLit, 0.55 + 0.45 * cells) + uSunColor * pow(max(cosT, 0.0), 6.0) * 0.4;
      c = mix(c, uFogColor, 1.0 - exp(-ta / (uHaze * 1.4)));
      behind = vec4(c * a, a);
    }

    // ---------------- high: cirrus streaks along the upper wind ----------------
    float tc = (9500.0 - uEye.y) / dir.y;
    if (uCirrus > 0.0 && tc < 120000.0) {
      vec2 pc = (uEye + dir * tc).xz - uCirrusOffset;
      vec2 cd = normalize(vec2(uWindDir.x * 0.8 - uWindDir.y * 0.6, uWindDir.y * 0.8 + uWindDir.x * 0.6));
      vec2 cp = vec2(-cd.y, cd.x);
      vec2 suv = vec2(dot(pc, cd) / 26000.0, dot(pc, cp) / 4200.0);
      float warp = nz(suv * 0.5 + 0.3).b;
      float n = nz(suv + vec2(0.0, warp * 0.35)).g * 0.65 + nz(suv * 3.3 + 0.2).a * 0.35;
      float a = smoothstep(0.55, 0.86, n) * smoothstep(0.3, 0.55, nz(pc / 60000.0).r) * uCirrus * 0.55;
      a *= exp(-tc / 90000.0);
      vec3 c = uCloudLit * 1.02 + uSunColor * pow(max(cosT, 0.0), 8.0) * 0.6;
      behind.rgb += (1.0 - behind.a) * c * a;
      behind.a += (1.0 - behind.a) * a;
    }

    res = vec4(col + T * behind.rgb, 1.0 - T * (1.0 - behind.a));
  }

  // Temporal accumulation, reprojected by view direction (clouds are effectively at infinity).
  vec4 pc = uPrevViewProj * vec4(dir, 0.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  if (any(isnan(res)) || any(isinf(res))) res = vec4(0.0);
  if (uHistoryValid > 0.5 && pc.w > 0.0 && puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0) {
    vec4 hist = texture(uHistory, puv);
    if (!any(isnan(hist)) && !any(isinf(hist))) res = mix(res, hist, 0.86);
  }
  gl_FragColor = clamp(res, 0.0, 32.0);
}
`;

export class Clouds {
  readonly offset = new Vector3();
  private readonly alto = new Vector2();
  private readonly cirrus = new Vector2();
  private rtA: WebGLRenderTarget;
  private rtB: WebGLRenderTarget;
  private readonly mat: ShaderMaterial;
  private readonly scene = new Scene();
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly prevViewProj = new Matrix4();
  private historyValid = false;
  private frame = 0;
  scale = 0.4;
  steps = 48;

  constructor(renderer: WebGLRenderer, cloudLit: Color, cloudShade: Color) {
    U.uNoise3D.value = buildCloudNoise(renderer);
    U.uCloudOffset.value = this.offset;
    const opts = { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false };
    this.rtA = new WebGLRenderTarget(4, 4, opts);
    this.rtB = new WebGLRenderTarget(4, 4, opts);
    this.mat = new ShaderMaterial({
      uniforms: {
        ...U,
        uInvProj: { value: new Matrix4() },
        uCamWorld: { value: new Matrix4() },
        uPrevViewProj: { value: new Matrix4() },
        uEye: { value: new Vector3() },
        uHistory: { value: null },
        uHistoryValid: { value: 0 },
        uFrame: { value: 0 },
        uSteps: { value: 48 },
        uCloudLit: { value: cloudLit },
        uCloudShade: { value: cloudShade },
        uAltoOffset: { value: this.alto },
        uCirrusOffset: { value: this.cirrus },
        uAlto: { value: 0.5 },
        uCirrus: { value: 0.6 },
        uStyle: { value: 0.3 },
        uHaze: { value: 30000 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  get texture(): Texture {
    return this.rtA.texture;
  }

  setSize(w: number, h: number): void {
    const cw = Math.max(16, Math.round(w * this.scale));
    const ch = Math.max(16, Math.round(h * this.scale));
    if (cw === this.rtA.width && ch === this.rtA.height) return;
    this.rtA.setSize(cw, ch);
    this.rtB.setSize(cw, ch);
    this.historyValid = false;
  }

  /** Invalidate history (after big jumps like teleports or slider changes). */
  reset(): void {
    this.historyValid = false;
  }

  render(renderer: WebGLRenderer, camera: PerspectiveCamera, dt: number): void {
    const a = params.atmosphere;
    const wd = U.uWindDir.value;
    // Time-lapse: winds at three levels, sheared against each other.
    const speed = a.cloudSpeed * (0.5 + U.uWindStrength.value);
    this.offset.x += wd.x * 12 * speed * dt;
    this.offset.z += wd.y * 12 * speed * dt;
    this.offset.y += 9 * a.evolution * dt;
    const rot = (v: Vector2, ang: number, mag: number) => {
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      v.x += (wd.x * c - wd.y * s) * mag * speed * dt;
      v.y += (wd.x * s + wd.y * c) * mag * speed * dt;
    };
    rot(this.alto, 0.45, 20);
    rot(this.cirrus, -0.6, 34);
    U.uCloudTower.value = a.towering;

    camera.updateMatrixWorld();
    const u = this.mat.uniforms;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uPrevViewProj.value.copy(this.prevViewProj);
    u.uEye.value.copy(camera.position);
    u.uHistory.value = this.rtB.texture;
    u.uHistoryValid.value = this.historyValid ? 1 : 0;
    u.uFrame.value = this.frame++ % 64;
    u.uSteps.value = this.steps;
    u.uAlto.value = a.alto;
    u.uCirrus.value = a.cirrus;
    u.uStyle.value = a.cloudStyle;
    u.uHaze.value = 32000 / Math.max(0.2, a.fog);

    // rtB holds last frame; render the new one into rtA... swap first so rtA is the target.
    [this.rtA, this.rtB] = [this.rtB, this.rtA];
    u.uHistory.value = this.rtB.texture;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);

    this.prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.historyValid = true;
  }
}
