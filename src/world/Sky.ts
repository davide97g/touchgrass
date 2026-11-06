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
varying vec3 vDir;

#define PI 3.14159265

vec4 nz(vec2 uv) { return textureLod(uNoise, uv, 0.0); }
float wrapPi(float a) { return a - 2.0 * PI * floor((a + PI) / (2.0 * PI)); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
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
    vec2 sp = d.xz / (y + 0.4) * 220.0;
    float s = hash12(floor(sp));
    float tw = 0.6 + 0.4 * sin(uTime * (1.0 + s * 3.0) + s * 40.0);
    float star = step(0.985, s) * smoothstep(0.35, 0.0, length(fract(sp) - 0.5)) * tw;
    col += vec3(star) * uNight * smoothstep(0.05, 0.3, y);
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
