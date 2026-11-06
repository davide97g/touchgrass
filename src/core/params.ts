export type GrassTypeName = 'Meadow' | 'Susuki' | 'Lawn' | 'Wild' | 'Windswept';
export type TimeName = 'Noon' | 'Golden hour' | 'Dusk' | 'Misty dawn';
export type QualityName = 'auto' | 'low' | 'medium' | 'high';

export interface GrassType {
  height: number;
  heightVar: number;
  width: number;
  density: number;
  stiffness: number;
  base: string;
  mid: string;
  tip: string;
}

export const GRASS_TYPES: Record<GrassTypeName, GrassType> = {
  Meadow: {
    height: 0.85, heightVar: 0.35, width: 0.055, density: 1, stiffness: 1,
    base: '#0e3a26', mid: '#3a8a2c', tip: '#c3e05a',
  },
  Susuki: {
    height: 1.35, heightVar: 0.3, width: 0.04, density: 0.85, stiffness: 0.8,
    base: '#33461d', mid: '#8f963a', tip: '#f1dd9a',
  },
  Lawn: {
    height: 0.28, heightVar: 0.25, width: 0.045, density: 1.3, stiffness: 1.6,
    base: '#174822', mid: '#4b9831', tip: '#a8d64a',
  },
  Wild: {
    height: 1.15, heightVar: 0.45, width: 0.065, density: 1.1, stiffness: 0.9,
    base: '#0a372b', mid: '#2c983a', tip: '#d8f46c',
  },
  Windswept: {
    height: 0.7, heightVar: 0.3, width: 0.05, density: 1, stiffness: 0.65,
    base: '#1b4430', mid: '#599a45', tip: '#dbeaa4',
  },
};

export const params = {
  grass: { type: 'Meadow' as GrassTypeName, ...GRASS_TYPES.Meadow },
  wind: { strength: 0.6, direction: 35, gust: 0.75, gustSpeed: 5 },
  atmosphere: {
    time: 'Noon' as TimeName,
    clouds: 0.5,
    towering: 0.6,
    cloudSpeed: 3,
    evolution: 1,
    alto: 0.5,
    cirrus: 0.6,
    cloudStyle: 0.3,
    cloudShadows: 0.65,
    fog: 1,
  },
  flowers: { enabled: true, density: 0.6 },
  particles: true,
  birds: true,
  move: { speed: 1.4, headBob: true, sensitivity: 1, fov: 70 },
  audio: { master: 0.8, music: 0.6, musicOn: true, wind: 0.8, grass: 0.9, nature: 0.6, pad: 0.5, muted: false },
  post: { bloom: 0.35, vignette: 0.35 },
  quality: 'auto' as QualityName,
};

export type Params = typeof params;
