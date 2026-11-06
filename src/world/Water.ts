import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, ShaderMaterial } from 'three';
import { U } from '../core/uniforms';
import { COMMON_GLSL } from './common';
import type { ActiveFeatures } from './Features';

const VERT = /* glsl */ `
attribute vec2 aFlow;
attribute float aSlope;
varying vec3 vWorldPos;
varying vec2 vFlow;
varying float vSlope;
void main() {
  vWorldPos = position;
  vFlow = aFlow;
  vSlope = aSlope;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
${COMMON_GLSL}
varying vec3 vWorldPos;
varying vec2 vFlow;
varying float vSlope;

float waterH(vec2 q) {
  vec2 a = q * 0.12 - vFlow * uTime * 0.12;
  vec2 b = q * 0.27 - vFlow * uTime * 0.21 + vec2(0.37, 0.71) + uWindDir * uTime * 0.012;
  return nz(a).a * 0.6 + nz(b).g * 0.4;
}

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

void main() {
  vec2 p = vWorldPos.xz;
  float depth = max(vWorldPos.y - terrainHeight(p), 0.0);
  float speed = length(vFlow);

  // Ripple normal from two scrolling height layers.
  float e = 0.12;
  float amp = 1.2 + uWindStrength * 0.9 + speed * 2.0;
  float dx = waterH(p + vec2(e, 0.0)) - waterH(p - vec2(e, 0.0));
  float dz = waterH(p + vec2(0.0, e)) - waterH(p - vec2(0.0, e));
  vec3 N = normalize(vec3(-dx * amp, 1.0, -dz * amp));

  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = uSunDir;
  vec3 R = reflect(-V, N);

  // Fairy-pool turquoise, deepening to teal.
  vec3 shallow = srgb(vec3(0.42, 0.86, 0.80));
  vec3 deep = srgb(vec3(0.04, 0.30, 0.40));
  vec3 body = mix(shallow, deep, smoothstep(0.0, 1.5, depth));
  body *= uAmbient * 1.2 + uSunColor * 0.75 * max(L.y + 0.15, 0.0);
  float alpha = mix(0.22, 0.9, smoothstep(0.0, 1.6, depth));

  // Sky and soft cloud reflections.
  float ry = clamp(R.y, 0.0, 1.0);
  vec3 sky = mix(uFogColor, uZenith, pow(ry, 0.42));
  // Reflect the real clouds: look up the cloud field where the reflected ray meets the cloud layer.
  float cl = smoothstep(0.01, 0.25, cloudCov2D(vWorldPos.xz + R.xz / max(R.y, 0.06) * (CLOUD_BOTTOM + 500.0)));
  sky = mix(sky, uAmbient + uSunColor * 0.6, cl * 0.7);
  float fres = 0.03 + 0.97 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  vec3 col = mix(body, sky, fres);
  alpha = mix(alpha, 1.0, fres);

  // Sun glints: a soft sheen plus sharp anime sparkles.
  float rl = max(dot(R, L), 0.0);
  float glint = pow(rl, 400.0) * 2.0 + smoothstep(0.99935, 0.99975, rl) * 3.0;
  col += uSunColor * glint * step(0.0, L.y);
  alpha = max(alpha, min(1.0, glint));

  // Foam at the shore and on cascades.
  vec2 fd = speed > 1e-3 ? vFlow / speed : vec2(1.0, 0.0);
  vec2 fp = vec2(-fd.y, fd.x);
  float streak = smoothstep(0.45, 0.75, nz(vec2(dot(p, fd) * 0.25 - vWorldPos.y * 0.6 - uTime * 0.9, dot(p, fp) * 1.6)).a);
  float shoreN = nz(p * 0.6 + uTime * 0.02).a;
  float foam = (1.0 - smoothstep(0.0, 0.05 + shoreN * 0.08, depth)) * 0.8;
  foam = max(foam, smoothstep(0.04, 0.25, vSlope) * (0.45 + 0.55 * streak));
  foam = max(foam, smoothstep(0.3, 1.0, speed) * streak * 0.25);
  col = mix(col, uAmbient + uSunColor * 0.9, foam * 0.85);
  alpha = max(alpha, foam * 0.92);

  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Water {
  readonly mesh: Mesh;

  constructor() {
    const mat = new ShaderMaterial({
      uniforms: { ...U },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(new BufferGeometry(), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  rebuild(f: ActiveFeatures): void {
    const pos: number[] = [];
    const flow: number[] = [];
    const slope: number[] = [];
    const idx: number[] = [];

    for (const p of f.pools) {
      const base = pos.length / 3;
      pos.push(p.x, p.level, p.z);
      flow.push(0, 0);
      slope.push(0);
      const n = 48;
      const R = p.r * 1.25;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pos.push(p.x + Math.cos(a) * R, p.level, p.z + Math.sin(a) * R);
        // A gentle swirl so pools are never perfectly still.
        flow.push(-Math.sin(a) * 0.05, Math.cos(a) * 0.05);
        slope.push(0);
      }
      for (let i = 0; i < n; i++) idx.push(base, base + 1 + ((i + 1) % n), base + 1 + i);
    }

    for (const s of f.streams) {
      const base = pos.length / 3;
      const n = s.pts.length;
      for (let i = 0; i < n; i++) {
        const a = s.pts[Math.max(0, i - 1)];
        const b = s.pts[Math.min(n - 1, i + 1)];
        let tx = b.x - a.x;
        let tz = b.z - a.z;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        const run = tl;
        const drop = Math.abs(s.levels[Math.max(0, i - 1)] - s.levels[Math.min(n - 1, i + 1)]);
        const sl = drop / Math.max(run, 0.01);
        const w = s.halfW * 1.35;
        const sp = 0.5 + sl * 3;
        for (const side of [-1, 1]) {
          pos.push(s.pts[i].x - tz * w * side, s.levels[i], s.pts[i].z + tx * w * side);
          flow.push(tx * sp, tz * sp);
          slope.push(sl);
        }
      }
      for (let i = 0; i < n - 1; i++) {
        const a = base + i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('aFlow', new BufferAttribute(new Float32Array(flow), 2));
    geo.setAttribute('aSlope', new BufferAttribute(new Float32Array(slope), 1));
    geo.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
  }
}
