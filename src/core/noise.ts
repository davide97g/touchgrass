import {
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  RGBAFormat,
  RepeatWrapping,
} from 'three';

/**
 * One tileable 4-channel noise texture drives terrain, wind, clouds and clumping.
 * The CPU keeps an identical copy (round-tripped through half floats) so the
 * camera, audio and gameplay can sample exactly what the GPU sees.
 */
export const NOISE_SIZE = 256;

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed + 1, 0x9e3779b9);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function periodicValue(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const m = (a: number) => ((a % period) + period) % period;
  const x0 = m(xi);
  const x1 = m(xi + 1);
  const y0 = m(yi);
  const y1 = m(yi + 1);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(px: number, py: number, baseFreq: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = baseFreq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicValue(px * f, py * f, f, seed * 31 + o);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// Per-channel recipe: [base frequency, octaves, seed]
const CHANNELS: [number, number, number][] = [
  [4, 5, 1], // R: broad hills / big gust fronts
  [8, 4, 2], // G: medium features
  [6, 4, 3], // B: medium-soft features
  [16, 3, 4], // A: fine clumping
];

const cpuData = new Float32Array(NOISE_SIZE * NOISE_SIZE * 4);

function build(): DataTexture {
  const N = NOISE_SIZE;
  for (let c = 0; c < 4; c++) {
    const [f, o, s] = CHANNELS[c];
    let min = Infinity;
    let max = -Infinity;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const v = fbm(i / N, j / N, f, o, s);
        cpuData[(j * N + i) * 4 + c] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    // Stretch contrast to the full [0, 1] range.
    const inv = 1 / (max - min);
    for (let k = 0; k < N * N; k++) {
      const idx = k * 4 + c;
      cpuData[idx] = (cpuData[idx] - min) * inv;
    }
  }
  const half = new Uint16Array(cpuData.length);
  for (let k = 0; k < cpuData.length; k++) {
    half[k] = DataUtils.toHalfFloat(cpuData[k]);
    cpuData[k] = DataUtils.fromHalfFloat(half[k]);
  }
  const tex = new DataTexture(half, N, N, RGBAFormat, HalfFloatType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export const noiseTexture = build();

/** Bilinear sample matching GPU `textureLod(uNoise, uv, 0.0)[channel]` with repeat wrap. */
export function sampleNoise(u: number, v: number, channel: number): number {
  const N = NOISE_SIZE;
  const x = u * N - 0.5;
  const y = v * N - 0.5;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const x0 = ((xi % N) + N) % N;
  const y0 = ((yi % N) + N) % N;
  const x1 = (x0 + 1) % N;
  const y1 = (y0 + 1) % N;
  const a = cpuData[(y0 * N + x0) * 4 + channel];
  const b = cpuData[(y0 * N + x1) * 4 + channel];
  const c = cpuData[(y1 * N + x0) * 4 + channel];
  const d = cpuData[(y1 * N + x1) * 4 + channel];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
