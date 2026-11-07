import type { GrassLayerConfig } from '../world/Grass';

export type Tier = 'low' | 'medium' | 'high';

export interface TierConfig {
  near: Omit<GrassLayerConfig, 'fade'>;
  far: Omit<GrassLayerConfig, 'fade'>;
  maxDpr: number;
  post: boolean;
  flowers: number;
  particles: number;
  cloudScale: number;
  cloudSteps: number;
}

export const TIERS: Record<Tier, TierConfig> = {
  low: {
    near: { size: 26, density: 55, segments: 4, widthScale: 1.25 },
    far: { size: 150, density: 4, segments: 2, widthScale: 1.9 },
    maxDpr: 1.5, // phones are 3x screens: 1x looks pixelated; drops back toward 1x if too slow
    post: false,
    flowers: 3500,
    particles: 250,
    cloudScale: 0.25,
    cloudSteps: 28,
  },
  medium: {
    near: { size: 32, density: 95, segments: 5, widthScale: 1.05 },
    far: { size: 180, density: 7, segments: 3, widthScale: 1.6 },
    maxDpr: 1.5,
    post: true,
    flowers: 6500,
    particles: 450,
    cloudScale: 0.33,
    cloudSteps: 40,
  },
  high: {
    near: { size: 38, density: 150, segments: 6, widthScale: 1 },
    far: { size: 210, density: 10, segments: 3, widthScale: 1.5 },
    maxDpr: 2,
    post: true,
    flowers: 10000,
    particles: 700,
    cloudScale: 0.5,
    cloudSteps: 56,
  },
};

export const TIER_ORDER: Tier[] = ['low', 'medium', 'high'];

/** Grass layers for a tier, with fades set so near and far blend into each other. */
export function grassLayers(tier: Tier, densityScale: number): GrassLayerConfig[] {
  const t = TIERS[tier];
  const rn = t.near.size / 2;
  const rf = t.far.size / 2;
  return [
    { ...t.near, density: t.near.density * densityScale, fade: [-1, 0, rn * 0.72, rn * 0.98] },
    { ...t.far, density: t.far.density * densityScale, fade: [rn * 0.5, rn * 0.85, rf * 0.45, rf * 0.9] },
  ];
}

export function detectTier(gl: WebGL2RenderingContext): Tier {
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'low' || q === 'medium' || q === 'high') return q;

  const coarse = matchMedia('(pointer: coarse)').matches;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = (ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '').toLowerCase();
  if (coarse || /mali|adreno|powervr|apple gpu/.test(gpu)) return 'low';
  if (/rtx|radeon rx|apple m\d (pro|max|ultra)|apple m[3-9]|geforce gtx 1[0-9]{3}|arc a/.test(gpu)) return 'high';
  if (/intel|uhd|iris|swiftshader|llvmpipe/.test(gpu)) return 'low';
  return 'medium';
}

/** Tier detection before the renderer exists (it decides whether the canvas gets MSAA). */
export function probeTier(): Tier {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'low';
  const tier = detectTier(gl);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return tier;
}
