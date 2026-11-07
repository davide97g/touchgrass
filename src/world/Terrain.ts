import { BufferAttribute, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from 'three';
import { U } from '../core/uniforms';
import { COMMON_GLSL } from './common';

const RADIUS = 520;
const SNAP = 4;

const VERT = /* glsl */ `
${COMMON_GLSL}
uniform vec2 uOffset;
uniform float uSink;
varying vec3 vWorldPos;
void main() {
  vec2 p = position.xz + uOffset;
  vWorldPos = vec3(p.x, terrainHeight(p) - uSink, p.y);
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
uniform vec3 uHole; // far ring only: discard inside the near grid (centre xz, half size)
varying vec3 vWorldPos;

float h21t(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 p = vWorldPos.xz;
  if (uHole.z > 0.0 && max(abs(p.x - uHole.x), abs(p.y - uHole.y)) < uHole.z) discard;
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

  // Mountains: bare rock on the steep faces, dry alpine turf higher up, snow on the heights.
  float mm = mountainMask(p);
  if (mm > 0.0) {
    float wy = vWorldPos.y;
    float rockK = alpineRock(p, N.y);
    float snowK = alpineSnow(p, wy, N.y);
    float shade = sunShadow(vWorldPos);
    vec3 litM = uAmbient * (0.72 + 0.28 * N.y) + uSunColor * (0.2 + 0.8 * diff) * max(L.y + 0.15, 0.0) * 1.1 * shade;

    // Rock: bedded and jointed, warm lichen on the ledges, dark seams.
    float bed = fract((wy + (nz(p / 23.0).a - 0.5) * 8.0) * 0.18);
    vec3 rock = pow(vec3(0.52, 0.51, 0.53), vec3(2.2)) * mix(0.72, 1.12, nz(p / 13.0 + vec2(wy * 0.02)).a);
    rock *= mix(0.68, 1.0, smoothstep(0.0, 0.07, bed) * smoothstep(1.0, 0.92, bed));
    rock *= mix(1.0, 0.78, smoothstep(0.6, 0.8, nz(vec2(dot(p, vec2(0.7, 0.7)) / 14.0, wy / 18.0) + 0.3).g));
    rock = mix(rock, pow(vec3(0.62, 0.58, 0.42), vec3(2.2)), smoothstep(0.65, 0.85, nz(p / 4.0 + wy * 0.05).a) * 0.45);
    float detail = nz(p * 0.9).a * 0.6 + nz(p * 3.1).b * 0.4;
    rock *= mix(0.85, 1.1, detail);

    // Alpine turf: the meadow dries toward straw and moss as it climbs.
    float alpine = smoothstep(100.0, 220.0, wy + (nz(p / 37.0).a - 0.5) * 50.0);
    vec3 turf = mix(col, col * vec3(1.05, 0.92, 0.6) * mix(0.85, 1.05, nz(p * 0.4).a), alpine);

    vec3 ground = mix(turf, rock * litM, rockK);

    // Snow: soft blue in the shade, wind ripples across it, crisp glints in the sun,
    // thinner where rock ribs break through.
    vec2 wd = normalize(uWindDir + vec2(0.3, 0.1));
    vec2 wp2 = vec2(-wd.y, wd.x);
    // Two scales of wind ripples plus fine grain; they tilt the normal so the snow takes light and shade.
    float ripple = nz(vec2(dot(p, wd) * 0.9, dot(p, wp2) * 0.18)).a;
    float ripple2 = nz(vec2(dot(p, wd) * 1.6, dot(p, wp2) * 0.62) + 0.4).g;
    float grain = nz(p * 7.0).a;
    float near = 1.0 - smoothstep(15.0, 90.0, length(vWorldPos - cameraPosition));
    vec3 Ns = normalize(N
      + vec3(wd.x, 0.0, wd.y) * ((ripple - 0.5) * 0.5 + (ripple2 - 0.5) * 0.45 * near)
      + vec3(wp2.x, 0.0, wp2.y) * (grain - 0.5) * 0.25 * near);
    float sd = smoothstep(-0.35, 0.75, dot(Ns, L)) * shade;
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 snowCol = vec3(0.8, 0.82, 0.86) * uSunColor * sd * max(L.y + 0.15, 0.0) * 0.82;
    snowCol += vec3(0.42, 0.52, 0.74) * uAmbient * (0.75 + 0.35 * Ns.y);
    snowCol *= mix(0.86, 1.0, ripple2) * mix(0.94, 1.0, grain);
    float glint = step(0.993, fract(sin(dot(floor(p * 45.0), vec2(12.9898, 78.233))) * 43758.5453));
    snowCol += uSunColor * glint * pow(max(dot(reflect(-L, Ns), V), 0.0), 8.0) * 1.6 * sd * (1.0 - smoothstep(20.0, 60.0, length(vWorldPos - cameraPosition)));
    // Rock ribs break through only on the steeper, wind-scoured parts, with crisp edges.
    float rib = nz(vec2(dot(p, wd) / 40.0, dot(p, wp2) / 9.0) + 0.17).a;
    float thin = smoothstep(0.72, 0.76, rib) * smoothstep(0.55, 0.9, rockK);
    ground = mix(ground, snowCol, snowK * (1.0 - thin));
    col = mix(col, ground, smoothstep(0.0, 0.15, mm));
  }

  // Crop fields: tilled soil between the rows.
  vec4 rlc = realmAt(p);
  float crop = smoothstep(1.6, 1.9, rlc.a) * (1.0 - smoothstep(0.02, 0.1, rlc.g));
  if (crop > 0.0) {
    vec3 soil = pow(vec3(0.45, 0.33, 0.22), vec3(2.2)) * mix(0.8, 1.1, nz(p * 0.7).a);
    float furrow = smoothstep(0.15, 0.4, abs(fract(p.x / 1.1) - 0.5));
    soil *= mix(1.0, 0.7, furrow);
    vec3 litC = uAmbient + uSunColor * (0.45 + 0.55 * diff) * max(L.y + 0.15, 0.0) * 1.1;
    vec3 cropFar = rlc.a < 2.5 ? vec3(0.78, 0.56, 0.18) : rlc.a < 3.5 ? vec3(0.22, 0.48, 0.1) : vec3(0.36, 0.28, 0.62);
    cropFar *= mix(0.85, 1.1, furrow) * mix(0.9, 1.08, nz(p / 9.0).a);
    col = mix(col, mix(soil, cropFar, far) * litC, crop * 0.9);
  }

  // Roads and plazas: packed earth with wheel ruts, or cobblestones in town.
  vec4 rl = realmAt(p);
  if (rl.g > 0.001 || rl.b > 0.001) {
    vec3 lit = uAmbient + uSunColor * (0.45 + 0.55 * diff) * max(L.y + 0.15, 0.0) * 1.1;
    float en = nz(p * 0.31).a - 0.5;
    float road = smoothstep(0.32, 0.62, rl.g + en * 0.45);
    vec3 dirt = pow(vec3(0.6, 0.52, 0.4), vec3(2.2)) * mix(0.8, 1.1, nz(p * 0.9).a);
    dirt = mix(dirt, dirt * 0.78, smoothstep(0.55, 0.75, nz(p * 2.7 + 0.3).b));
    // Cobbles: offset rows of rounded stones.
    vec2 q = p * vec2(2.4, 3.0);
    q.x += floor(q.y) * 0.5;
    vec2 cf = fract(q) - 0.5;
    float stoneMask = smoothstep(0.5, 0.36, max(abs(cf.x) * 0.95, abs(cf.y)));
    float tone = 0.78 + 0.3 * h21t(floor(q));
    vec3 cob = pow(vec3(0.66, 0.63, 0.58), vec3(2.2)) * tone;
    cob = mix(cob * 0.5, cob, stoneMask);
    vec3 pave = mix(dirt, cob, smoothstep(0.3, 0.7, rl.a));
    col = mix(col, pave * lit, road);
    col = mix(col, dirt * lit * 0.85, smoothstep(0.2, 0.8, rl.b) * (1.0 - road) * 0.7);
  }

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

  col *= cloudShadowAt(p) * treeShadeAt(vWorldPos) * sunShadow(vWorldPos);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const FAR_SIZE = 18000;
const FAR_SEGS = 560;

export class Terrain {
  readonly mesh: Mesh;
  /** Coarse fixed grid out to the mountains; it skips whatever the near grid covers. */
  readonly far: Mesh;
  private readonly offset = new Vector2();
  private readonly material: ShaderMaterial;
  private readonly farMaterial: ShaderMaterial;

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
        uHole: { value: new Vector3(0, 0, 0) },
        uSink: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;

    // Denser toward the realm, sparse at the far mountains.
    const fg = new PlaneGeometry(2, 2, FAR_SEGS, FAR_SEGS);
    fg.rotateX(-Math.PI / 2);
    const fp = fg.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < fp.count; i++) {
      const x = fp.getX(i);
      const z = fp.getZ(i);
      const w = (v: number) => Math.sign(v) * (0.35 * Math.abs(v) + 0.65 * v * v) * (FAR_SIZE / 2);
      fp.setXYZ(i, w(x), 0, w(z));
    }
    fp.needsUpdate = true;
    this.farMaterial = this.material.clone();
    this.farMaterial.uniforms = { ...this.material.uniforms, uOffset: { value: new Vector2() }, uHole: { value: new Vector3(0, 0, RADIUS - 6) }, uSink: { value: 0.15 } };
    this.far = new Mesh(fg, this.farMaterial);
    this.far.frustumCulled = false;
  }

  setFarRange(start: number, end: number): void {
    this.material.uniforms.uFarStart.value = start;
    this.material.uniforms.uFarEnd.value = end;
  }

  update(camX: number, camZ: number): void {
    this.offset.set(Math.round(camX / SNAP) * SNAP, Math.round(camZ / SNAP) * SNAP);
    const hole = this.farMaterial.uniforms.uHole.value as Vector3;
    hole.set(this.offset.x, this.offset.y, RADIUS - 6);
  }
}
