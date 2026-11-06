import { sampleNoise } from '../core/noise';
import { U } from '../core/uniforms';

/**
 * GLSL shared by every world shader. Every function here that the CPU also needs
 * (terrain height, gusts) has an exact TypeScript twin below. Keep them in sync.
 */
export const COMMON_GLSL = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uGustStrength;
uniform float uGustSpeed;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uCloudShadow;
uniform float uCloudCover;
uniform float uNight;
uniform sampler2D uFeat;
uniform vec2 uFeatCenter;
uniform float uFeatSize;
uniform vec3 uZenith;
uniform sampler3D uNoise3D;
uniform vec3 uCloudOffset;
uniform float uCloudTower;
uniform vec4 uTree;       // the great tree: trunk base x, z, ground y, root radius (0 = none)
uniform vec4 uTreeCanopy; // its crown: centre xyz, horizontal radius

vec4 nz(vec2 uv) { return textureLod(uNoise, uv, 0.0); }

// Water features baked around the player: r = height carve, g = bank, b = water level, a = water mask.
vec4 featAt(vec2 p) {
  vec2 uv = (p - uFeatCenter) / uFeatSize + 0.5;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec4(0.0, 0.0, -1000.0, 0.0);
  return textureLod(uFeat, uv, 0.0);
}

float terrainBase(vec2 p) {
  float h = (nz(p / 1100.0).r - 0.5) * 46.0;
  h += (nz(p / 330.0 + vec2(0.37, 0.11)).g - 0.5) * 9.0;
  h += (nz(p / 90.0 + vec2(0.71, 0.53)).b - 0.5) * 1.6;
  return h;
}

float terrainHeight(vec2 p) { return terrainBase(p) + featAt(p).r; }

// Big gust fronts that roll across the field along the wind direction.
float gustAt(vec2 p) {
  vec2 q = (p - uWindDir * uTime * uGustSpeed) / 220.0 + vec2(0.13, 0.77);
  return smoothstep(0.42, 0.85, nz(q).g);
}

// Medium-scale sway that keeps the whole field breathing between gusts.
float swayAt(vec2 p) {
  vec2 q = (p - uWindDir * uTime * uGustSpeed * 0.7) / 60.0 + vec2(0.61, 0.29);
  return nz(q).b;
}

// ---- Clouds: one weather map + 3D noise shared by the sky, ground shadows and water reflections ----
#define CLOUD_BOTTOM 1300.0
#define CLOUD_TOP 3700.0

float cremap(float x, float a, float b, float c, float d) { return c + (x - a) / (b - a) * (d - c); }

// x = coverage, y = cloud type (0 flat stratocumulus .. 1 towering cumulus).
// Two layers drift at different rates, so the pattern keeps reshuffling.
vec2 cloudWeather(vec2 xz) {
  vec2 w1 = (xz - uCloudOffset.xz) / 26000.0;
  vec2 w2 = (xz - uCloudOffset.xz * 1.3) / 15000.0 + vec2(0.37, 0.11);
  float c = nz(w1).r * 0.6 + nz(w2).g * 0.4;
  float thr = 1.0 - uCloudCover;
  float cov = smoothstep(thr - 0.14, thr + 0.2, c);
  float type = nz(w1 * 0.6 + vec2(0.5, 0.2)).b;
  return vec2(cov, type);
}

float cloudBase(vec3 p, vec2 w) {
  float h = clamp((p.y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM), 0.0, 1.0);
  float top = mix(0.28, 1.0, clamp(w.y * 1.4 * uCloudTower, 0.0, 1.0));
  float grad = smoothstep(0.0, 0.07, h) * smoothstep(top, top * 0.4, h);
  float n = texture(uNoise3D, (p - uCloudOffset) / 8000.0).r * 0.68;
  n += texture(uNoise3D, (p - uCloudOffset * vec3(1.0, 1.6, 1.0)) / 2700.0 + 0.31).g * 0.32; // cauliflower billows
  return clamp(cremap(n * grad, 1.0 - w.x, 1.0, 0.0, 1.0), 0.0, 1.0);
}

// Rough cloud cover overhead at a ground point (shadows, reflections).
float cloudCov2D(vec2 xz) {
  vec2 w = cloudWeather(xz);
  if (w.x < 0.01) return 0.0;
  return cloudBase(vec3(xz.x, CLOUD_BOTTOM + 450.0, xz.y), w);
}

float cloudShadowAt(vec2 p) {
  float ly = max(uSunDir.y, 0.12);
  vec2 q = p + uSunDir.xz / ly * (CLOUD_BOTTOM + 500.0);
  return mix(1.0, 0.52, smoothstep(0.01, 0.22, cloudCov2D(q)) * uCloudShadow);
}

// Dappled shade under the great tree's crown, wherever the sun's ray crosses it.
float treeShadeAt(vec3 wp) {
  if (uTreeCanopy.w <= 0.0) return 1.0;
  vec3 L = uSunDir;
  float s = max(uTreeCanopy.y - wp.y, 0.0) / max(L.y, 0.08);
  vec2 q = wp.xz + L.xz * s - uTreeCanopy.xz;
  float d = length(q) / uTreeCanopy.w;
  if (d > 1.4) return 1.0;
  vec2 w = uWindDir * sin(uTime * 0.8) * 0.12 * uWindStrength;
  float holes = smoothstep(0.7, 0.8, nz((q + w) / 3.5 + 0.3).a + d * 0.22);
  float edge = 1.0 - smoothstep(0.78, 1.12, d + (nz(q / 11.0 + 0.6).g - 0.5) * 0.4);
  return mix(1.0, 0.4, edge * (1.0 - holes) * smoothstep(0.0, 0.2, L.y));
}

vec3 fogColorFor(vec3 viewDir) {
  float sunAmt = pow(max(dot(viewDir, uSunDir), 0.0), 6.0);
  return uFogColor + uSunColor * sunAmt * 0.22;
}

vec3 applyFog(vec3 col, vec3 wp) {
  vec3 d = wp - cameraPosition;
  float dist = length(d);
  float f = 1.0 - exp(-pow(dist * uFogDensity, 1.35));
  return mix(col, fogColorFor(d / max(dist, 1e-4)), clamp(f, 0.0, 1.0));
}
`;

export function terrainBase(x: number, z: number): number {
  let h = (sampleNoise(x / 1100, z / 1100, 0) - 0.5) * 46;
  h += (sampleNoise(x / 330 + 0.37, z / 330 + 0.11, 1) - 0.5) * 9;
  h += (sampleNoise(x / 90 + 0.71, z / 90 + 0.53, 2) - 0.5) * 1.6;
  return h;
}

let featureDh: ((x: number, z: number) => number) | null = null;

/** The feature map registers itself here so CPU heights include pools and streams. */
export function setFeatureSampler(fn: (x: number, z: number) => number): void {
  featureDh = fn;
}

export function terrainHeight(x: number, z: number): number {
  return terrainBase(x, z) + (featureDh ? featureDh(x, z) : 0);
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** CPU twin of `gustAt` — reads the shared uniforms so it matches the frame being drawn. */
export function gustAt(x: number, z: number): number {
  const t = U.uTime.value;
  const w = U.uWindDir.value;
  const s = U.uGustSpeed.value;
  const qx = (x - w.x * t * s) / 220 + 0.13;
  const qz = (z - w.y * t * s) / 220 + 0.77;
  return smoothstep(0.42, 0.85, sampleNoise(qx, qz, 1));
}

/**
 * Pick a spawn on a gentle rise with an open view: the most prominent point
 * near the origin, facing the direction where the land falls away furthest.
 */
export function findSpawn(): { x: number; z: number; yaw: number } {
  let best = { x: 0, z: 0, yaw: 0, score: -Infinity };
  const dirs = 16;
  for (let gx = -300; gx <= 300; gx += 20) {
    for (let gz = -300; gz <= 300; gz += 20) {
      const h = terrainBase(gx, gz);
      let sum = 0;
      let lowest = Infinity;
      let lowestA = 0;
      for (let i = 0; i < dirs; i++) {
        const a = (i / dirs) * Math.PI * 2;
        const far = terrainBase(gx - Math.sin(a) * 140, gz - Math.cos(a) * 140);
        const near = terrainBase(gx - Math.sin(a) * 25, gz - Math.cos(a) * 25);
        sum += far;
        // A view direction should drop away, not rise into a wall.
        const v = far + Math.max(0, near - h) * 3;
        if (v < lowest) {
          lowest = v;
          lowestA = a;
        }
      }
      const prominence = h - sum / dirs;
      const score = prominence - Math.hypot(gx, gz) * 0.01;
      if (score > best.score) best = { x: gx, z: gz, yaw: lowestA, score };
    }
  }
  return best;
}

/**
 * Fragment-only: things right in front of the eye dissolve instead of being cut by the near plane.
 * A fine dither that the near-blur in post turns into a soft, out-of-focus veil.
 */
export const NEAR_FADE_GLSL = /* glsl */ `
void nearFade(vec3 wp) {
  float d = length(wp - cameraPosition);
  if (d > 0.55) return;
  float a = smoothstep(0.06, 0.55, d);
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (n > a) discard;
}
`;
