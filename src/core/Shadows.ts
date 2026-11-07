import {
  DepthTexture,
  Material,
  Mesh,
  NearestFilter,
  Object3D,
  OrthographicCamera,
  ShaderMaterial,
  UnsignedIntType,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { U } from './uniforms';

/** Fragment shader for depth-only passes of opaque casters. */
export const SHADOW_FRAG_SOLID = /* glsl */ `
void main() { gl_FragColor = vec4(1.0); }
`;

/**
 * A depth variant of a caster's material: same vertex shader (so wind, instancing, billboards
 * and animation all match), trivial fragment unless the caster needs an alpha test.
 */
export function shadowMaterial(src: ShaderMaterial, frag = SHADOW_FRAG_SOLID): ShaderMaterial {
  const m = new ShaderMaterial({
    uniforms: src.uniforms,
    vertexShader: src.vertexShader,
    fragmentShader: frag,
    defines: { ...(src.defines ?? {}), SHADOW_PASS: '' },
    side: src.side,
  });
  return m;
}

/** Tag a mesh as a shadow caster with the given depth material. */
export function castShadow(mesh: Mesh, mat: Material): void {
  mesh.userData.shadowMat = mat;
}

/**
 * One sun shadow map that follows the walker: an orthographic view from the sun over a square
 * around the camera, snapped to its texels so edges never crawl. Casters are tagged meshes in
 * the given roots; everything else is hidden for the pass.
 */
export class Shadows {
  readonly target: WebGLRenderTarget;
  readonly camera: OrthographicCamera;
  enabled = true;
  private readonly roots: Object3D[] = [];
  private readonly half: number;
  private readonly size: number;
  private readonly depthRange = 900;
  private readonly hidden: Object3D[] = [];
  private readonly swapped: { mesh: Mesh; mat: Material | Material[] }[] = [];
  private readonly tmp = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();

  constructor(size = 2048, half = 85) {
    this.size = size;
    this.half = half;
    this.target = new WebGLRenderTarget(size, size, { depthBuffer: true });
    this.target.depthTexture = new DepthTexture(size, size, UnsignedIntType);
    this.target.depthTexture.minFilter = this.target.depthTexture.magFilter = NearestFilter;
    this.camera = new OrthographicCamera(-half, half, half, -half, 1, this.depthRange);
    U.uShadowMap.value = this.target.depthTexture;
  }

  addRoot(o: Object3D): void {
    this.roots.push(o);
  }

  setSize(size: number): void {
    this.target.setSize(size, size);
  }

  render(renderer: WebGLRenderer, cx: number, cy: number, cz: number): void {
    const sun = U.uSunDir.value;
    const on = this.enabled && sun.y > 0.02;
    U.uShadowParams.value.set(1 / this.size, 1, on ? 1 : 0, 0.18 / this.depthRange);
    if (!on) return;

    // Light frame; snap the centre to whole texels along the light's right/up axes.
    const cam = this.camera;
    const dir = this.tmp.copy(sun).normalize();
    this.up.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.99) this.up.set(0, 0, 1);
    this.right.crossVectors(this.up, dir).normalize();
    const upv = new Vector3().crossVectors(dir, this.right).normalize();
    const texel = (this.half * 2) / this.size;
    const c = new Vector3(cx, cy, cz);
    const r = Math.round(c.dot(this.right) / texel) * texel - c.dot(this.right);
    const u = Math.round(c.dot(upv) / texel) * texel - c.dot(upv);
    c.addScaledVector(this.right, r).addScaledVector(upv, u);
    cam.position.copy(c).addScaledVector(dir, this.depthRange * 0.6);
    cam.up.copy(upv);
    cam.lookAt(c);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    U.uShadowMatrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    // Swap in depth materials, hide everything that does not cast.
    for (const root of this.roots) {
      root.traverse((o) => {
        if (!o.visible) return;
        const mesh = o as Mesh;
        const sm = o.userData.shadowMat as Material | undefined;
        if (sm && mesh.isMesh) {
          this.swapped.push({ mesh, mat: mesh.material });
          mesh.material = sm;
        } else if ((o as Mesh).isMesh || (o as { isPoints?: boolean }).isPoints) {
          o.visible = false;
          this.hidden.push(o);
        }
      });
    }
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    const tone = renderer.toneMapping;
    renderer.setRenderTarget(this.target);
    renderer.autoClear = true;
    for (const root of this.roots) {
      renderer.render(root, cam);
      renderer.autoClear = false;
    }
    renderer.autoClear = prevAuto;
    renderer.toneMapping = tone;
    renderer.setRenderTarget(prevTarget);
    for (const s of this.swapped) s.mesh.material = s.mat;
    for (const o of this.hidden) o.visible = true;
    this.swapped.length = 0;
    this.hidden.length = 0;
  }
}
