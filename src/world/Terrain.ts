import { BufferAttribute, Mesh, PlaneGeometry, ShaderMaterial, Vector2 } from 'three';
import { U } from '../core/uniforms';
import { COMMON_GLSL } from './common';

const RADIUS = 520;
const SNAP = 4;

const VERT = /* glsl */ `
${COMMON_GLSL}
uniform vec2 uOffset;
varying vec3 vWorldPos;
void main() {
  vec2 p = position.xz + uOffset;
  vWorldPos = vec3(p.x, terrainHeight(p), p.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
}
`;

const FRAG = /* glsl */ `
${COMMON_GLSL}
uniform vec3 uGrassBase;
uniform vec3 uGrassMid;
uniform vec3 uGrassTip;
uniform vec3 uTint;
uniform float uFarStart;
uniform float uFarEnd;
varying vec3 vWorldPos;

void main() {
  vec2 p = vWorldPos.xz;
  // Per-pixel normal so shading never pops when the grid recentres.
  float e = 1.5;
  float hx = terrainHeight(p + vec2(e, 0.0)) - terrainHeight(p - vec2(e, 0.0));
  float hz = terrainHeight(p + vec2(0.0, e)) - terrainHeight(p - vec2(0.0, e));
  vec3 N = normalize(vec3(-hx, 2.0 * e, -hz));

  float dist = length(p - cameraPosition.xz);
  float far = smoothstep(uFarStart, uFarEnd, dist);

  // Under the blades: dark, shaded floor. In the distance: the look of a dense field.
  vec3 nearCol = mix(uGrassBase, uGrassMid, 0.18) * 0.75;
  vec3 farCol = mix(uGrassMid, uGrassTip, 0.42);

  // Painterly strokes stretched along the wind.
  vec2 perp = vec2(-uWindDir.y, uWindDir.x);
  float stroke = nz(vec2(dot(p, uWindDir) / 30.0, dot(p, perp) / 7.0)).a;
  float stroke2 = nz(vec2(dot(p, uWindDir) / 9.0, dot(p, perp) / 2.5) + 0.5).a;
  farCol *= mix(0.84, 1.12, stroke) * mix(0.94, 1.05, stroke2);

  float patchy = smoothstep(0.55, 0.85, nz(p / 150.0 + vec2(0.2, 0.9)).b);
  vec3 col = mix(nearCol, farCol, far);
  col = mix(col, col * vec3(1.18, 1.06, 0.62), patchy * 0.55);
  col *= uTint;

  vec3 L = uSunDir;
  float diff = smoothstep(-0.1, 0.7, dot(N, L));
  col *= uAmbient + uSunColor * (0.45 + 0.55 * diff) * max(L.y + 0.15, 0.0) * 1.1;

  // Distant gust waves still visible across the hills.
  float g = gustAt(p) * uWindStrength * uGustStrength;
  col += g * far * uSunColor * uTint * vec3(0.12, 0.14, 0.05);

  // Shores: moss and pebbles. Beds: pale stones, darker with depth, with caustics.
  vec4 f = featAt(p);
  if (f.g > 0.001 || f.a > 0.001) {
    float peb = nz(p * 1.4).a;
    float peb2 = nz(p * 4.3 + 0.3).a;
    vec3 moss = mix(uGrassBase, uGrassMid, 0.55) * 0.9 * uTint;
    vec3 stone = pow(mix(vec3(0.5, 0.52, 0.5), vec3(0.7, 0.7, 0.67), peb2), vec3(2.2));
    stone *= mix(0.75, 1.1, peb);
    vec3 bankCol = mix(moss, stone, smoothstep(0.72, 0.97, f.g + (peb - 0.5) * 0.5));
    vec3 lit = uAmbient + uSunColor * (0.45 + 0.55 * diff) * max(L.y + 0.15, 0.0) * 1.1;
    col = mix(col, bankCol * lit, smoothstep(0.05, 0.5, f.g));
    float depth = f.b - vWorldPos.y;
    if (f.a > 0.3 && depth > 0.0) {
      vec3 bed = stone * mix(vec3(1.0), vec3(0.35, 0.62, 0.66), smoothstep(0.0, 1.4, depth)) * lit;
      float a1 = nz(p / 3.1 + uTime * 0.018).a;
      float a2 = nz(p / 2.3 - uTime * 0.014 + 0.5).a;
      float caust = pow(1.0 - abs(a1 - a2), 14.0);
      bed += uSunColor * caust * 0.55 * max(L.y, 0.0) * (1.0 - smoothstep(0.2, 1.6, depth));
      col = mix(col, bed, smoothstep(0.3, 0.6, f.a));
    }
  }

  col *= cloudShadowAt(p) * treeShadeAt(vWorldPos);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Terrain {
  readonly mesh: Mesh;
  private readonly offset = new Vector2();
  private readonly material: ShaderMaterial;

  constructor() {
    const geo = new PlaneGeometry(2, 2, 280, 280);
    geo.rotateX(-Math.PI / 2);
    // Warp the grid so vertices crowd near the camera (exact heights where blades stand).
    const pos = geo.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setXYZ(i, Math.sign(x) * x * x * RADIUS, 0, Math.sign(z) * z * z * RADIUS);
    }
    pos.needsUpdate = true;

    this.material = new ShaderMaterial({
      uniforms: {
        ...U,
        uOffset: { value: this.offset },
        uFarStart: { value: 14 },
        uFarEnd: { value: 70 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
  }

  setFarRange(start: number, end: number): void {
    this.material.uniforms.uFarStart.value = start;
    this.material.uniforms.uFarEnd.value = end;
  }

  update(camX: number, camZ: number): void {
    this.offset.set(Math.round(camX / SNAP) * SNAP, Math.round(camZ / SNAP) * SNAP);
  }
}
