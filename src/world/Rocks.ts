import {
  BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { castShadow, shadowMaterial } from '../core/Shadows';
import { U } from '../core/uniforms';
import { COMMON_GLSL, terrainHeight } from './common';
import type { ActiveFeatures } from './Features';

const MAX = 900;

const VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${COMMON_GLSL}
uniform vec3 uGrassMid;
uniform vec3 uTint;
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = uSunDir;
  vec2 p = vWorldPos.xz + vWorldPos.y * 0.7;

  // Granite: cool grey with warm speckles and darker veins.
  vec3 col = pow(vec3(0.6, 0.6, 0.62), vec3(2.2));
  col *= mix(0.78, 1.12, nz(p * 0.9).a);
  col = mix(col, pow(vec3(0.72, 0.62, 0.55), vec3(2.2)), smoothstep(0.7, 0.85, nz(p * 3.1 + 0.4).a) * 0.6);
  col *= mix(1.0, 0.7, smoothstep(0.6, 0.75, nz(p * 1.7 + 0.2).g));

  // Moss settles on the tops.
  float moss = smoothstep(0.45, 0.8, N.y + (nz(p * 0.8).a - 0.5) * 0.7);
  col = mix(col, uGrassMid * 0.55 * uTint, moss * 0.85);

  // Darker and teal where wet.
  vec4 f = featAt(vWorldPos.xz);
  float wet = f.a * (1.0 - smoothstep(f.b - 0.05, f.b + 0.12, vWorldPos.y));
  col = mix(col, col * vec3(0.45, 0.6, 0.62), wet);

  float diff = smoothstep(-0.05, 0.4, dot(N, L));
  col *= uAmbient * (0.75 + 0.25 * N.y) + uSunColor * (0.2 + 0.8 * diff) * max(L.y + 0.15, 0.0) * 1.05;
  col += uAmbient * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.12;
  col *= cloudShadowAt(vWorldPos.xz) * sunShadow(vWorldPos);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function rockGeometry() {
  let g = new IcosahedronGeometry(1, 2);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g) as IcosahedronGeometry;
  const pos = g.getAttribute('position') as BufferAttribute;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      1 +
      0.18 * Math.sin(v.x * 2.3 + v.y * 1.1) * Math.cos(v.z * 2.7) +
      0.08 * Math.sin(v.x * 5.1 - v.z * 4.3 + v.y * 3.7);
    v.multiplyScalar(n);
    // Flatten the base so rocks sit, and facet them a little.
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.3;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class Rocks {
  readonly mesh: InstancedMesh;

  constructor() {
    const mat = new ShaderMaterial({ uniforms: { ...U }, vertexShader: VERT, fragmentShader: FRAG });
    this.mesh = new InstancedMesh(rockGeometry(), mat, MAX);
    this.mesh.count = 0;
    castShadow(this.mesh, shadowMaterial(mat));
    this.mesh.frustumCulled = false;
  }

  rebuild(f: ActiveFeatures): void {
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    const tilt = new Quaternion();
    let n = 0;
    for (const r of f.rocks) {
      if (n >= MAX) break;
      const h = terrainHeight(r.x, r.z);
      s.set(r.s * (0.9 + (r.rot % 0.4)), r.s * r.squash, r.s * (0.8 + (r.rot % 0.5)));
      p.set(r.x, h + r.s * r.squash * (0.35 - r.sink), r.z);
      q.setFromAxisAngle(new Vector3(0, 1, 0), r.rot);
      tilt.setFromAxisAngle(new Vector3(1, 0, 0), ((r.rot * 7) % 0.3) - 0.15);
      q.multiply(tilt);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(n++, m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
