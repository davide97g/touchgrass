import {
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  WebGL3DRenderTarget,
  type Data3DTexture,
  type WebGLRenderer,
} from 'three';

/**
 * Tileable 3D cloud noise, generated once on the GPU slice by slice.
 * R: Perlin-Worley (billowy base shapes)
 * G, B, A: Worley fbm at 3 increasing frequencies (erosion detail).
 */
export function buildCloudNoise(renderer: WebGLRenderer, size = 96): Data3DTexture {
  const rt = new WebGL3DRenderTarget(size, size, size, {
    format: RGBAFormat,
    type: UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
  const tex = rt.texture as Data3DTexture;
  tex.wrapS = tex.wrapT = tex.wrapR = RepeatWrapping;

  const mat = new ShaderMaterial({
    uniforms: { uZ: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uZ;
      varying vec2 vUv;

      vec3 hash33(vec3 p) {
        p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
        return fract(sin(p) * 43758.5453123);
      }

      // Inverted Worley (1 at feature points), tileable with the given period.
      float worley(vec3 p, float period) {
        vec3 id = floor(p);
        vec3 f = fract(p);
        float md = 1.0;
        for (int x = -1; x <= 1; x++)
        for (int y = -1; y <= 1; y++)
        for (int z = -1; z <= 1; z++) {
          vec3 o = vec3(x, y, z);
          vec3 h = hash33(mod(id + o, period));
          vec3 d = o + h - f;
          md = min(md, dot(d, d));
        }
        return 1.0 - sqrt(md);
      }

      float worleyFbm(vec3 p, float freq) {
        return worley(p * freq, freq) * 0.625 + worley(p * freq * 2.0, freq * 2.0) * 0.25 + worley(p * freq * 4.0, freq * 4.0) * 0.125;
      }

      // Tileable gradient noise.
      float grad(vec3 p, float period) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
        float n = 0.0;
        float res[8];
        for (int k = 0; k < 8; k++) {
          vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
          vec3 g = normalize(hash33(mod(i + o, period)) * 2.0 - 1.0);
          res[k] = dot(g, f - o);
        }
        float x0 = mix(res[0], res[1], u.x);
        float x1 = mix(res[2], res[3], u.x);
        float x2 = mix(res[4], res[5], u.x);
        float x3 = mix(res[6], res[7], u.x);
        n = mix(mix(x0, x1, u.y), mix(x2, x3, u.y), u.z);
        return n;
      }

      float perlinFbm(vec3 p, float freq) {
        float sum = 0.0;
        float amp = 0.5;
        for (int o = 0; o < 5; o++) {
          sum += grad(p * freq, freq) * amp;
          freq *= 2.0;
          amp *= 0.5;
        }
        return sum * 0.5 + 0.5;
      }

      float remap(float x, float a, float b, float c, float d) {
        return c + (x - a) / (b - a) * (d - c);
      }

      void main() {
        vec3 p = vec3(vUv, uZ);
        float pn = perlinFbm(p, 4.0);
        float w = worleyFbm(p, 4.0);
        float pw = clamp(remap(pn, w - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
        gl_FragColor = vec4(pw, worleyFbm(p, 4.0), worleyFbm(p, 8.0), worleyFbm(p, 16.0));
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const scene = new Scene();
  const quad = new Mesh(new PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const prev = renderer.getRenderTarget();
  for (let z = 0; z < size; z++) {
    mat.uniforms.uZ.value = (z + 0.5) / size;
    renderer.setRenderTarget(rt, z);
    renderer.render(scene, cam);
  }
  renderer.setRenderTarget(prev);
  mat.dispose();
  quad.geometry.dispose();
  return tex;
}
