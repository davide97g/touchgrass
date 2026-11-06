import { Color, Data3DTexture, Texture, Vector2, Vector3, Vector4 } from 'three';
import { noiseTexture } from './noise';

/**
 * Uniform objects shared by reference across every world material, so one
 * write (time, wind, sun, fog...) updates grass, terrain, flowers and particles at once.
 */
export const U = {
  uTime: { value: 0 },
  uNoise: { value: noiseTexture as Texture },

  uWindDir: { value: new Vector2(1, 0) },
  uWindStrength: { value: 0.6 },
  uGustStrength: { value: 0.75 },
  uGustSpeed: { value: 5 },

  uSunDir: { value: new Vector3(0.3, 0.8, 0.5).normalize() },
  uSunColor: { value: new Color(1, 1, 1) },
  uAmbient: { value: new Color(0.4, 0.5, 0.6) },
  uFogColor: { value: new Color(0.7, 0.85, 0.95) },
  uFogDensity: { value: 0.004 },
  uCloudShadow: { value: 0.6 },
  uCloudCover: { value: 0.5 },
  uNight: { value: 0 },

  uGrassBase: { value: new Color() },
  uGrassMid: { value: new Color() },
  uGrassTip: { value: new Color() },
  uTint: { value: new Color(1, 1, 1) },
  uGrassHeight: { value: 0.85 },
  uGrassHeightVar: { value: 0.35 },
  uGrassWidth: { value: 0.055 },
  uStiffness: { value: 1 },

  uTrailMap: { value: null as Texture | null },
  uTrailCenter: { value: new Vector2() },
  uTrailSize: { value: 40 },

  uFeat: { value: null as Texture | null },
  uFeatCenter: { value: new Vector2() },
  uFeatSize: { value: 512 },
  uZenith: { value: new Color(0.1, 0.3, 0.8) },
  uNoise3D: { value: new Data3DTexture() as Texture },
  uCloudOffset: { value: new Vector3() },
  uCloudTower: { value: 0.6 },

  uTree: { value: new Vector4(0, 0, 0, 0) },
  uTreeCanopy: { value: new Vector4(0, 0, 0, 0) },

  uPixelRatio: { value: 1 },
};

export type SharedUniforms = typeof U;
