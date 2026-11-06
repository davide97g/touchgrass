import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector2, type Texture } from 'three';
import { U } from '../core/uniforms';


const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w * 0.99999; // pin to far plane
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform sampler2D uCloudTex;
uniform vec2 uViewport;
uniform float uTime;
uniform vec2 uWindDir;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uCloudCover;
uniform float uNight;
uniform vec3 uZenith;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uMountain;
uniform float uBand;
uniform float uStars;
varying vec3 vDir;

#define PI 3.14159265

vec4 nz(vec2 uv) { return textureLod(uNoise, uv, 0.0); }
float wrapPi(float a) { return a - 2.0 * PI * floor((a + PI) / (2.0 * PI)); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// One star per occupied cell, jittered inside it; magnitude, size and colour temperature all random.
vec3 starLayer(vec2 sp, float density, float seed) {
  vec2 cell = floor(sp);
  vec2 f = fract(sp);
  if (hash12(cell + seed * 17.0) > density) return vec3(0.0);
  vec2 pos = 0.2 + 0.6 * vec2(hash12(cell + seed * 31.0 + 3.1), hash12(cell + seed * 7.0 + 9.7));
  float m = hash12(cell + seed * 13.0 + 5.3);
  float mag = pow(m, 5.0);                       // most faint, a few bright
  float dist = length(f - pos);
  float r = 0.05 + 0.16 * mag;
  float core = smoothstep(r, r * 0.25, dist);
  float halo = exp(-dist * dist / (r * r * 5.0)) * mag * 0.35;
  float t = hash12(cell + seed * 5.0 + 1.7);
  vec3 tint = t < 0.15 ? vec3(0.68, 0.78, 1.0)   // hot blue
            : t < 0.6 ? vec3(0.95, 0.97, 1.0)   // white
            : t < 0.85 ? vec3(1.0, 0.93, 0.78)  // yellow
            : vec3(1.0, 0.76, 0.55);            // orange-red
  float tw = 0.8 + 0.2 * sin(uTime * (0.7 + m * 3.0) + t * 60.0);
  return tint * (core * (0.25 + 2.2 * mag) + halo) * tw;
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float az = atan(d.x, -d.z);
  float el = asin(clamp(y, -1.0, 1.0));

  // Sky gradient: deep zenith blue to pale horizon haze.
  float g = pow(clamp(y, 0.0, 1.0), uBand);
  vec3 col = mix(uFogColor, uZenith, g);

  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 40.0) * 0.35 + pow(sd, 6.0) * 0.12);

  if (uNight > 0.01 && y > 0.0) {
    vec2 sp = d.xz / (y + 0.4);
    float horizon = smoothstep(0.05, 0.3, y);
    // Few bright stars, more mid ones; the clear-night extra adds a dense faint field and the milky way.
    vec3 stars = starLayer(sp * 120.0, 0.05, 1.0) * 1.6 + starLayer(sp * 260.0, 0.07, 2.0);
    if (uStars > 0.0) {
      vec3 band = normalize(vec3(0.62, 0.35, -0.7));
      float mw = exp(-pow(dot(d, band) / 0.24, 2.0));
      vec2 mp = d.xz / (y + 0.6);
      float dust = nz(mp * 0.9 + 0.2).a * 0.55 + nz(mp * 2.7 + 0.5).g * 0.3 + nz(mp * 7.3).b * 0.15;
      float lanes = smoothstep(0.55, 0.75, nz(mp * 1.7 + vec2(0.3, 0.9)).r);
      vec3 extra = starLayer(sp * 520.0, 0.1 + mw * 0.35, 3.0) * 0.55 + starLayer(sp * 900.0, mw * 0.5, 4.0) * 0.35;
      vec3 glow = mix(vec3(0.22, 0.25, 0.42), vec3(0.42, 0.36, 0.38), smoothstep(0.4, 0.8, dust));
      glow *= mw * smoothstep(0.25, 0.75, dust) * (1.0 - lanes * 0.7) * 0.22;
      stars = stars * (1.0 + mw * 0.4) + (extra * (1.0 - lanes * 0.5) + glow) * uStars;
    }
    col += stars * uNight * horizon;
  }

  // Volumetric clouds (rendered at low resolution, premultiplied).
  vec4 cl = texture2D(uCloudTex, gl_FragCoord.xy / uViewport);
  col = col * (1.0 - cl.a) + cl.rgb;

  // Two layers of distant mountains, periodic around the horizon.
  vec2 ring = vec2(cos(az), sin(az));
  float m1 = 0.01 + nz(ring * 0.32 + 0.5).r * 0.07;
  float m2 = 0.004 + nz(ring * 0.55 + vec2(0.2, 0.7)).g * 0.04;
  float aa = 0.0025;
  float far = smoothstep(m1 + aa, m1 - aa, y);
  float near = smoothstep(m2 + aa, m2 - aa, y);
  vec3 mFar = mix(uFogColor, uMountain, 0.22);
  vec3 mNear = mix(uFogColor, uMountain, 0.4);
  col = mix(col, mFar, far);
  col = mix(col, mNear, near);
  if (y < 0.0) col = mix(col, mNear, smoothstep(0.0, -0.02, y));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Sky {
  readonly mesh: Mesh;
  readonly zenith = new Color();
  readonly cloudLit = new Color();
  readonly cloudShade = new Color();
  readonly mountain = new Color();
  readonly band = { value: 0.42 };
  /** Extra stars and a milky way on clear nights (trailer). */
  readonly stars = { value: 0 };

  constructor() {
    const mat = new ShaderMaterial({
      uniforms: {
        uNoise: U.uNoise,
        uTime: U.uTime,
        uWindDir: U.uWindDir,
        uSunDir: U.uSunDir,
        uSunColor: U.uSunColor,
        uFogColor: U.uFogColor,
        uCloudCover: U.uCloudCover,
        uNight: U.uNight,
        uCloudTex: { value: null },
        uViewport: { value: new Vector2(1, 1) },
        uZenith: { value: this.zenith },
        uCloudLit: { value: this.cloudLit },
        uCloudShade: { value: this.cloudShade },
        uMountain: { value: this.mountain },
        uBand: this.band,
        uStars: this.stars,
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: BackSide,
      depthWrite: false,
    });
    this.mesh = new Mesh(new SphereGeometry(1000, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  update(x: number, y: number, z: number, clouds: Texture, viewport: Vector2): void {
    this.mesh.position.set(x, y, z);
    const u = (this.mesh.material as ShaderMaterial).uniforms;
    u.uCloudTex.value = clouds;
    u.uViewport.value.copy(viewport);
  }
}
