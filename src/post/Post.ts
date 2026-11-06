import {
  Color,
  DepthTexture,
  HalfFloatType,
  NearestFilter,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  type Texture,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * Cinematic overrides, written by the trailer director (all neutral by default):
 * eyelids, full-screen blur, a vortex twirl, colour flashes, fade to black, a title card,
 * manual focus for the depth of field and bloom/exposure multipliers.
 */
export const FX = {
  lid: 1, // 0 eyes shut .. 1 wide open
  blur: 0, // full-screen blur radius in px (at 1080p)
  swirl: 0, // vortex twirl strength (radians at the centre)
  flash: new Color(1, 1, 1),
  flashAmt: 0,
  fade: 1, // 1 visible .. 0 black
  title: 0, // title reveal 0..1
  titleTex: null as Texture | null,
  focus: -1, // metres; <= 0 means autofocus
  dofScale: 1.5,
  bloom: 1,
  exposure: 1,
  saturation: 1.14,
  nearBlur: 1, // blur for things a hand's width from the eye (fading grass, petals)
  flare: 0, // lens flare strength
  sunUv: new Vector2(0.5, 0.5), // sun position on screen (0..1)
  flareColor: new Color(1.0, 0.72, 0.45),
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.35 },
    uTime: { value: 0 },
    uSaturation: { value: 1.14 },
    uLid: { value: 1 },
    uBlur: { value: 0 },
    uSwirl: { value: 0 },
    uFlash: { value: new Color(0, 0, 0) },
    uFade: { value: 1 },
    uTitle: { value: 0 },
    tTitle: { value: null as Texture | null },
    uRes: { value: new Vector2(1, 1) },
    uFlare: { value: 0 },
    uSunUv: { value: new Vector2(0.5, 0.5) },
    uFlareCol: { value: new Color(1, 0.72, 0.45) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tTitle;
    uniform float uVignette;
    uniform float uTime;
    uniform float uSaturation;
    uniform float uLid;
    uniform float uBlur;
    uniform float uSwirl;
    uniform vec3 uFlash;
    uniform float uFade;
    uniform float uTitle;
    uniform vec2 uRes;
    uniform float uFlare;
    uniform vec2 uSunUv;
    uniform vec3 uFlareCol;
    varying vec2 vUv;
    // Lens flare: a warm glow and anamorphic streak at the sun, ghosts and a halo ring mirrored through the centre.
    vec3 lensFlare(vec2 uv, float aspect) {
      vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
      vec2 s = (uSunUv - 0.5) * vec2(aspect, 1.0);
      vec2 d = p - s;
      float r = length(d);
      vec3 c = uFlareCol * (exp(-r * 9.0) * 0.55 + exp(-r * 40.0) * 0.8);
      // Anamorphic streak.
      c += vec3(1.0, 0.62, 0.38) * exp(-abs(d.y) * 260.0) * exp(-abs(d.x) * 1.6) * 0.9;
      c += vec3(0.55, 0.65, 1.0) * exp(-abs(d.y) * 600.0) * exp(-abs(d.x) * 0.9) * 0.25;
      // Ghosts along the line through the centre, each with its own tint.
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float k = -0.35 - fi * 0.32 + (i == 2 ? 0.55 : 0.0);
        vec2 g = s * k;
        float gr = 0.025 + 0.03 * fract(fi * 0.618 + 0.2) + fi * 0.008;
        float gd = length(p - g);
        vec3 tint = mix(vec3(0.95, 0.55, 0.3), vec3(0.4, 0.7, 1.0), fract(fi * 0.37));
        c += tint * smoothstep(gr, gr * 0.6, gd) * (0.045 + 0.03 * fract(fi * 0.71));
      }
      // Halo ring, centred opposite the sun.
      float hr = length(p + s * 0.25);
      c += vec3(1.0, 0.8, 0.6) * exp(-pow((hr - 0.45) / 0.02, 2.0)) * 0.025;
      c += vec3(0.6, 0.8, 1.0) * exp(-pow((hr - 0.47) / 0.015, 2.0)) * 0.018;
      return c;
    }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 0.1) * 43758.5453); }
    float h21(vec2 p) { return fract(sin(dot(p, vec2(41.31, 289.17))) * 15731.743); }
    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
    }
    void main() {
      float aspect = uRes.x / uRes.y;
      vec2 uv = vUv;
      // Vortex: twirl the frame around its centre, strongest in the middle.
      if (uSwirl > 0.001) {
        vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
        float r = length(q);
        float a = uSwirl * pow(max(0.0, 1.0 - r / 0.95), 2.0) + uSwirl * 0.08;
        float c = cos(a);
        float s = sin(a);
        q = mat2(c, -s, s, c) * q * (1.0 - min(uSwirl * 0.015, 0.25) * (1.0 - r));
        uv = q / vec2(aspect, 1.0) + 0.5;
      }
      vec3 c = texture2D(tDiffuse, uv).rgb;
      // Full-screen soft focus (eyes adjusting, transitions).
      if (uBlur > 0.3) {
        vec2 px = uBlur * (uRes.y / 1080.0) / uRes;
        vec3 acc = c;
        float w = 1.0;
        for (int i = 0; i < 24; i++) {
          float rr = sqrt((float(i) + 0.5) / 24.0);
          float aa = float(i) * 2.39996;
          vec2 o = vec2(cos(aa), sin(aa)) * rr * px;
          vec3 sc = texture2D(tDiffuse, uv + o).rgb;
          float ww = 1.0 + dot(sc, vec3(0.3, 0.59, 0.11)) * 0.8;
          acc += sc * ww;
          w += ww;
        }
        c = acc / w;
      }
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * 1.6 * uVignette;
      c *= clamp(v, 0.0, 1.0);
      // Flare sits in the lens, so it goes under the eyelids.
      if (uFlare > 0.001) c += lensFlare(vUv, aspect) * uFlare;

      // Eyelids: two soft arcs closing toward the middle; warm light glows through them.
      if (uLid < 0.999) {
        vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);
        float open = uLid * 0.78;
        float curve = 1.0 - min(1.0, (q.x * q.x) / (aspect * aspect * 0.32)) * 0.55;
        float edge = 0.03 + (1.0 - uLid) * 0.09;
        float top = smoothstep(open * curve + edge, open * curve - edge, q.y);
        float bot = smoothstep(open * curve * 0.92 + edge, open * curve * 0.92 - edge, -q.y);
        float m = top * bot * smoothstep(0.0, 0.08, uLid);
        vec3 through = vec3(0.16, 0.035, 0.02) * (0.25 + l * 0.6) * smoothstep(0.0, 0.6, uLid + 0.15);
        c = mix(through, c, m);
      }

      c += uFlash;

      // Title card: letters condense out of the stars.
      if (uTitle > 0.001) {
        vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);
        vec2 tuv = q / vec2(1.3, 0.65) + 0.5;
        if (tuv.x > 0.0 && tuv.x < 1.0 && tuv.y > 0.0 && tuv.y < 1.0) {
          vec4 t = texture2D(tTitle, tuv);
          float n = vnoise(tuv * vec2(90.0, 45.0)) * 0.7 + vnoise(tuv * 9.0) * 0.3;
          float k = uTitle * 1.35 - 0.2;
          float m = smoothstep(n - 0.12, n + 0.12, k);
          float spark = smoothstep(0.12, 0.0, abs(n - k)) * step(0.001, uTitle) * (1.0 - smoothstep(0.85, 1.0, uTitle));
          c = c * (1.0 - t.a * m * 0.6) + t.rgb * t.a * m * 1.5 + t.a * spark * vec3(0.9, 0.95, 1.0) * 1.4;
        }
      }

      c *= uFade;
      c += (hash(vUv * 1000.0) - 0.5) * 0.012;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

const DEPTH_GLSL = /* glsl */ `
#include <packing>
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
float linZ(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
`;

/**
 * Macro lens: thin-lens style depth of field with a smoothed GPU autofocus on
 * whatever sits at the centre of the frame (no CPU readback, no stalls).
 */
class DofPass extends Pass {
  amount = 0;
  private readonly quad: FullScreenQuad;
  private readonly focusQuad: FullScreenQuad;
  private readonly mat: ShaderMaterial;
  private readonly focusMat: ShaderMaterial;
  private focus: [WebGLRenderTarget, WebGLRenderTarget];
  private idx = 0;

  constructor(private readonly camera: PerspectiveCamera) {
    super();
    const opts = { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false };
    this.focus = [new WebGLRenderTarget(1, 1, opts), new WebGLRenderTarget(1, 1, opts)];
    this.focusMat = new ShaderMaterial({
      uniforms: { tDepth: { value: null }, tPrev: { value: null }, uNear: { value: 0.05 }, uFar: { value: 2500 }, uBlend: { value: 0.1 }, uManual: { value: -1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        ${DEPTH_GLSL}
        uniform sampler2D tPrev;
        uniform float uBlend;
        uniform float uManual;
        void main() {
          if (uManual > 0.0) { gl_FragColor = vec4(uManual); return; }
          float d = linZ(vec2(0.5));
          for (int i = 0; i < 8; i++) {
            float a = float(i) * 0.785398;
            d = min(d, linZ(vec2(0.5) + vec2(cos(a), sin(a)) * vec2(0.0025, 0.004)));
          }
          d = clamp(d, 0.08, 400.0);
          float prev = texture2D(tPrev, vec2(0.5)).r;
          gl_FragColor = vec4(prev <= 0.0 ? d : mix(prev, d, uBlend));
        }
      `,
    });
    this.mat = new ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        tFocus: { value: null },
        uNear: { value: 0.05 },
        uFar: { value: 2500 },
        uAmount: { value: 0 },
        uCoc: { value: 1.5 },
        uNearBlur: { value: 1 },
        uMaxBlur: { value: 18 },
        uTexel: { value: new Vector2() },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        ${DEPTH_GLSL}
        uniform sampler2D tColor;
        uniform sampler2D tFocus;
        uniform float uAmount;
        uniform float uCoc;
        uniform float uNearBlur;
        uniform float uMaxBlur;
        uniform vec2 uTexel;
        varying vec2 vUv;
        float cocAt(float z, float f) { return max(clamp(abs(1.0 - f / z) * uCoc, 0.0, 1.0) * uAmount, uNearBlur * smoothstep(0.7, 0.12, z)); }
        void main() {
          float f = texture2D(tFocus, vec2(0.5)).r;
          float cz = linZ(vUv);
          if (uAmount < 0.001) {
            // Near blur only: most pixels have nothing close around them, pass them straight through.
            float mn = cz;
            for (int i = 0; i < 8; i++) {
              float a = float(i) * 0.785398;
              mn = min(mn, linZ(vUv + vec2(cos(a), sin(a)) * uMaxBlur * uTexel));
            }
            if (mn > 0.7) { gl_FragColor = vec4(texture2D(tColor, vUv).rgb, 1.0); return; }
          }
          float cc = cocAt(cz, f);
          vec3 acc = texture2D(tColor, vUv).rgb;
          float wsum = 1.0;
          const int N = 48;
          for (int i = 0; i < N; i++) {
            float r = sqrt((float(i) + 0.5) / float(N));
            float a = float(i) * 2.39996;
            vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uMaxBlur * uTexel;
            float sz = linZ(uv);
            float sc = cocAt(sz, f);
            if (sz > cz) sc = min(sc, cc); // sharp things in front stay crisp
            float w = smoothstep(r - 0.1, r + 0.02, sc);
            vec3 c = texture2D(tColor, uv).rgb;
            float lum = dot(c, vec3(0.3, 0.59, 0.11));
            w *= 1.0 + lum * lum * 0.6; // bokeh highlights bloom into discs
            acc += c * w;
            wsum += w;
          }
          gl_FragColor = vec4(acc / wsum, 1.0);
        }
      `,
    });
    this.quad = new FullScreenQuad(this.mat);
    this.focusQuad = new FullScreenQuad(this.focusMat);
  }

  render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
    const near = this.camera.near;
    const far = this.camera.far;
    const prev = this.focus[this.idx];
    const next = this.focus[1 - this.idx];
    this.idx = 1 - this.idx;

    const fu = this.focusMat.uniforms;
    fu.tDepth.value = readBuffer.depthTexture;
    fu.tPrev.value = prev.texture;
    fu.uNear.value = near;
    fu.uFar.value = far;
    fu.uManual.value = FX.focus;
    renderer.setRenderTarget(next);
    this.focusQuad.render(renderer);

    const u = this.mat.uniforms;
    u.tColor.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.tFocus.value = next.texture;
    u.uNear.value = near;
    u.uFar.value = far;
    u.uAmount.value = this.amount;
    u.uCoc.value = FX.dofScale;
    u.uNearBlur.value = FX.nearBlur;
    u.uTexel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    u.uMaxBlur.value = Math.max(10, readBuffer.height / 42);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.quad.dispose();
    this.focusQuad.dispose();
    this.mat.dispose();
    this.focusMat.dispose();
    this.focus.forEach((r) => r.dispose());
  }
}

/** Scrubs NaN/Inf and clamps extreme HDR values so one bad pixel can't black out the screen through bloom. */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 48.0), 1.0);
    }
  `,
};

export class Post {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private readonly dof: DofPass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    const size = renderer.getDrawingBufferSize(new Vector2());
    const rt = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
    rt.depthTexture = new DepthTexture(size.x, size.y);
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.dof = new DofPass(camera);
    this.dof.enabled = false;
    this.composer.addPass(this.dof);
    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.bloom = new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.35, 0.7, 0.92);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.grade.uniforms.uRes.value.set(w * pixelRatio, h * pixelRatio);
  }

  render(time: number, bloom: number, vignette: number, macro: number): void {
    this.dof.amount = macro;
    this.dof.enabled = macro > 0.01 || FX.nearBlur > 0.001;
    this.bloom.strength = bloom * FX.bloom;
    const g = this.grade.uniforms;
    g.uVignette.value = vignette;
    g.uTime.value = time;
    g.uSaturation.value = FX.saturation;
    g.uLid.value = FX.lid;
    g.uBlur.value = FX.blur;
    g.uSwirl.value = FX.swirl;
    g.uFlash.value.copy(FX.flash).multiplyScalar(FX.flashAmt);
    g.uFade.value = FX.fade;
    g.uTitle.value = FX.title;
    g.uFlare.value = FX.flare;
    g.uSunUv.value.copy(FX.sunUv);
    g.uFlareCol.value.copy(FX.flareColor);
    g.tTitle.value = FX.titleTex;
    this.composer.render();
  }

  dispose(): void {
    this.dof.dispose();
    this.composer.dispose();
  }
}
