import {
  DepthTexture,
  HalfFloatType,
  NearestFilter,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
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

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.35 },
    uTime: { value: 0 },
    uSaturation: { value: 1.14 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uTime;
    uniform float uSaturation;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 0.1) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * 1.6 * uVignette;
      c *= clamp(v, 0.0, 1.0);
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
      uniforms: { tDepth: { value: null }, tPrev: { value: null }, uNear: { value: 0.05 }, uFar: { value: 2500 }, uBlend: { value: 0.1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        ${DEPTH_GLSL}
        uniform sampler2D tPrev;
        uniform float uBlend;
        void main() {
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
        uMaxBlur: { value: 18 },
        uTexel: { value: new Vector2() },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        ${DEPTH_GLSL}
        uniform sampler2D tColor;
        uniform sampler2D tFocus;
        uniform float uAmount;
        uniform float uMaxBlur;
        uniform vec2 uTexel;
        varying vec2 vUv;
        float cocAt(float z, float f) { return clamp(abs(1.0 - f / z) * 1.5, 0.0, 1.0) * uAmount; }
        void main() {
          float f = texture2D(tFocus, vec2(0.5)).r;
          float cz = linZ(vUv);
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
    renderer.setRenderTarget(next);
    this.focusQuad.render(renderer);

    const u = this.mat.uniforms;
    u.tColor.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.tFocus.value = next.texture;
    u.uNear.value = near;
    u.uFar.value = far;
    u.uAmount.value = this.amount;
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
  }

  render(time: number, bloom: number, vignette: number, macro: number): void {
    this.dof.amount = macro;
    this.dof.enabled = macro > 0.01;
    this.bloom.strength = bloom;
    this.grade.uniforms.uVignette.value = vignette;
    this.grade.uniforms.uTime.value = time;
    this.composer.render();
  }

  dispose(): void {
    this.dof.dispose();
    this.composer.dispose();
  }
}
