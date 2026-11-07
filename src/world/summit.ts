import { terrainBase } from './common';

let cached: { x: number; z: number; y: number } | null = null;

/** The highest spot in the western range you can actually stand on (gentle enough not to slide off). */
export function findSummit(): { x: number; z: number; y: number } {
  if (cached) return cached;
  let peak = { x: -2000, z: 600, score: -Infinity };
  for (let x = -2500; x <= -1700; x += 12) {
    for (let z = 200; z <= 1100; z += 12) {
      const h = terrainBase(x, z);
      const e = 1.5;
      let worst = 0;
      for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
        const gx = (terrainBase(x + dx + e, z + dz) - terrainBase(x + dx - e, z + dz)) / (2 * e);
        const gz = (terrainBase(x + dx, z + dz + e) - terrainBase(x + dx, z + dz - e)) / (2 * e);
        worst = Math.max(worst, Math.hypot(gx, gz));
      }
      if (worst > 0.45) continue;
      let ring = 0;
      for (let k = 0; k < 8; k++) ring += terrainBase(x + Math.cos(k * 0.785) * 70, z + Math.sin(k * 0.785) * 70);
      const prominence = h - ring / 8;
      const score = h + prominence * 3 - worst * 60;
      if (score > peak.score) peak = { x, z, score };
    }
  }
  cached = { x: peak.x, z: peak.z, y: terrainBase(peak.x, peak.z) };
  return cached;
}
