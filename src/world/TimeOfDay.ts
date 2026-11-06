import { Color, MathUtils } from 'three';
import type { TimeName } from '../core/params';
import { U } from '../core/uniforms';
import type { Sky } from './Sky';

export interface Preset {
  elev: number; // degrees
  azim: number; // degrees, 0 = straight ahead of spawn (-Z)
  sun: string;
  sunI: number;
  ambient: string;
  ambientI: number;
  zenith: string;
  horizon: string;
  fog: number;
  band: number;
  cloudLit: string;
  cloudShade: string;
  mountain: string;
  tint: string;
  night: number;
  exposure: number;
  bloom: number;
}

export const TIME_PRESETS: Record<TimeName, Preset> = {
  Noon: {
    elev: 50, azim: 145, sun: '#fff4dc', sunI: 1.0, ambient: '#8db3da', ambientI: 0.5,
    zenith: '#0a46c2', horizon: '#bcdcf4', fog: 0.0019, band: 0.42,
    cloudLit: '#ffffff', cloudShade: '#9cb0cf', mountain: '#4a72a8',
    tint: '#ffffff', night: 0, exposure: 1.0, bloom: 1.0,
  },
  'Golden hour': {
    elev: 9, azim: 18, sun: '#ffd08f', sunI: 1.25, ambient: '#a49ab6', ambientI: 0.5,
    zenith: '#3a6bb0', horizon: '#f5d1a0', fog: 0.0024, band: 0.36,
    cloudLit: '#fff0d6', cloudShade: '#b8939f', mountain: '#7a6c8f',
    tint: '#fbf6dc', night: 0, exposure: 1.05, bloom: 1.4,
  },
  Dusk: {
    elev: -3, azim: 8, sun: '#ff9a6a', sunI: 0.75, ambient: '#4c5c9c', ambientI: 0.62,
    zenith: '#0c1846', horizon: '#d99a86', fog: 0.0026, band: 0.22,
    cloudLit: '#eaa594', cloudShade: '#403e70', mountain: '#2e3566',
    tint: '#86a6dc', night: 0.85, exposure: 1.05, bloom: 1.6,
  },
  'Misty dawn': {
    elev: 7, azim: -70, sun: '#ffd8b4', sunI: 0.85, ambient: '#b4bcd0', ambientI: 0.6,
    zenith: '#7b9bc4', horizon: '#e8e3db', fog: 0.011, band: 0.5,
    cloudLit: '#fff6ee', cloudShade: '#b7b4c8', mountain: '#a1a8bd',
    tint: '#d9e3e6', night: 0.1, exposure: 1.0, bloom: 1.2,
  },
};

const COLOR_KEYS = ['sun', 'ambient', 'zenith', 'horizon', 'cloudLit', 'cloudShade', 'mountain', 'tint'] as const;
const NUM_KEYS = ['elev', 'azim', 'sunI', 'ambientI', 'fog', 'band', 'night', 'exposure', 'bloom'] as const;

interface State {
  colors: Record<(typeof COLOR_KEYS)[number], Color>;
  nums: Record<(typeof NUM_KEYS)[number], number>;
}

function toState(p: Preset): State {
  const colors = {} as State['colors'];
  for (const k of COLOR_KEYS) colors[k] = new Color(p[k]);
  const nums = {} as State['nums'];
  for (const k of NUM_KEYS) nums[k] = p[k];
  return { colors, nums };
}

function copyState(s: State): State {
  const colors = {} as State['colors'];
  for (const k of COLOR_KEYS) colors[k] = s.colors[k].clone();
  return { colors, nums: { ...s.nums } };
}

const smooth = (x: number) => x * x * (3 - 2 * x);

export class TimeOfDay {
  private from: State;
  private to: State;
  private cur: State;
  private k = 1;
  private duration = 1;
  name: TimeName;
  fogScale = 1;

  constructor(private readonly sky: Sky, initial: TimeName) {
    this.name = initial;
    this.to = toState(TIME_PRESETS[initial]);
    this.from = copyState(this.to);
    this.cur = copyState(this.to);
    this.apply();
  }

  get night(): number { return this.cur.nums.night; }
  get exposure(): number { return this.cur.nums.exposure; }
  get bloom(): number { return this.cur.nums.bloom; }

  set(name: TimeName, seconds = 5): void {
    this.name = name;
    this.setPreset(TIME_PRESETS[name], seconds);
  }

  /** Cross-fade to an arbitrary preset (the trailer uses a few that are not in the menu). */
  setPreset(p: Preset, seconds = 5): void {
    this.from = copyState(this.cur);
    this.to = toState(p);
    this.k = 0;
    this.duration = Math.max(0.001, seconds);
  }

  update(dt: number): void {
    if (this.k < 1) {
      this.k = Math.min(1, this.k + dt / this.duration);
      const t = smooth(this.k);
      for (const key of COLOR_KEYS) {
        this.cur.colors[key].copy(this.from.colors[key]).lerp(this.to.colors[key], t);
      }
      for (const key of NUM_KEYS) {
        this.cur.nums[key] = MathUtils.lerp(this.from.nums[key], this.to.nums[key], t);
      }
    }
    this.apply();
  }

  private apply(): void {
    const { colors: c, nums: n } = this.cur;
    const el = MathUtils.degToRad(n.elev);
    const az = MathUtils.degToRad(n.azim);
    U.uSunDir.value.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
    U.uSunColor.value.copy(c.sun).multiplyScalar(n.sunI);
    U.uAmbient.value.copy(c.ambient).multiplyScalar(n.ambientI);
    U.uFogColor.value.copy(c.horizon);
    U.uFogDensity.value = n.fog * this.fogScale;
    U.uTint.value.copy(c.tint);
    U.uNight.value = n.night;
    this.sky.zenith.copy(c.zenith);
    U.uZenith.value.copy(c.zenith);
    this.sky.cloudLit.copy(c.cloudLit);
    this.sky.cloudShade.copy(c.cloudShade);
    this.sky.mountain.copy(c.mountain);
    this.sky.band.value = n.band;
  }
}
