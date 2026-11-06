import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';
import { U } from '../core/uniforms';
import { COMMON_GLSL } from './common';

const BOX = 44;

const VERT = /* glsl */ `
${COMMON_GLSL}
uniform float uPixelRatio;
attribute vec4 aSeed;
varying float vAlpha;
varying float vFirefly;
varying float vGlint;

void main() {
  float firefly = step(aSeed.w, 0.45);
  // Drift with the wind, wobble softly, wrap around the camera.
  vec3 p = vec3(aSeed.x * ${BOX.toFixed(1)}, 0.0, aSeed.z * ${BOX.toFixed(1)});
  float drift = mix(0.5, 1.4, aSeed.y) * (0.3 + uWindStrength * 1.6) * (1.0 - firefly * 0.8);
  p.xz += uWindDir * uTime * drift;
  p.x += sin(uTime * 0.6 + aSeed.y * 40.0) * 0.8;
  p.z += cos(uTime * 0.5 + aSeed.x * 30.0) * 0.8;
  vec2 rel = mod(p.xz - cameraPosition.xz + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
  vec2 xz = cameraPosition.xz + rel;
  float y = mix(0.25 + aSeed.y * 5.0, 0.2 + aSeed.y * 1.8, firefly);
  y += sin(uTime * (0.4 + aSeed.x) + aSeed.z * 20.0) * 0.35;
  vec3 wp = vec3(xz.x, terrainHeight(xz) + y, xz.y);

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;

  float edge = 1.0 - smoothstep(${(BOX * 0.36).toFixed(1)}, ${(BOX * 0.5).toFixed(1)}, length(rel));
  float day = 1.0 - uNight;
  vec3 V = normalize(wp - cameraPosition);
  float glint = pow(max(dot(V, uSunDir), 0.0), 4.0);
  float blink = smoothstep(0.55, 1.0, sin(uTime * (0.8 + aSeed.z * 1.4) + aSeed.x * 50.0));

  float pollen = (1.0 - firefly) * day * (0.25 + glint * 0.9);
  float fly = firefly * smoothstep(0.4, 0.8, uNight) * blink;
  vAlpha = (pollen + fly) * edge;
  vFirefly = firefly;
  vGlint = glint;

  float size = mix(0.035 + glint * 0.03, 0.09, firefly);
  gl_PointSize = clamp(size * uPixelRatio * 600.0 / -mv.z, 0.0, 24.0 * uPixelRatio);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSunColor;
varying float vAlpha;
varying float vFirefly;
varying float vGlint;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a = a * a * vAlpha;
  if (a < 0.003) discard;
  vec3 pollen = mix(vec3(1.0, 0.97, 0.85), uSunColor, 0.4) * (0.8 + vGlint);
  vec3 fly = vec3(0.75, 1.0, 0.35) * 2.2;
  gl_FragColor = vec4(mix(pollen, fly, vFirefly) * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Particles {
  readonly points: Points;

  constructor(count: number) {
    const geo = new BufferGeometry();
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    geo.setAttribute('aSeed', new BufferAttribute(seed, 4));
    geo.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    const mat = new ShaderMaterial({
      uniforms: { ...U },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as ShaderMaterial).dispose();
  }
}
