import { terrainHeight } from '../common';
import { planCity } from './city';
import { M } from './geom';
import { lamp } from './kit';
import { mulberry32 } from './rand';
import { meander, Plan, RealmMap, type Pt, type Road, type Site } from './Realm';
import { campfire, fieldsAround, planFarm, planGrove, planPillar, planRing, signpost } from './more';
import { planHidden } from './hidden';
import { planCrystals, planRuins, planVillage, planWatch } from './sites';
import { mountainMask } from '../common';

/**
 * The layout of the realm. Spawn lies on a grassy rise near (-80, -120); everything else is
 * placed around it so the first views hold a city on the horizon, a hill crowned with ruins,
 * windmills, and the mountains closing the world.
 */
export const SITES: Site[] = [
  { id: 'city', name: 'Lumenhall', subtitle: 'Starting City', kind: 'city', x: -560, z: 210, r: 118, level: 0, zone: 150 },
  { id: 'windmere', name: 'Windmere', subtitle: 'Village of Windmills', kind: 'village', x: 390, z: -430, r: 46, level: 0, zone: 95 },
  { id: 'hearth', name: 'Hearthbrook', subtitle: 'Shepherds’ Hamlet', kind: 'village', x: 330, z: 600, r: 42, level: 0, zone: 90 },
  { id: 'ruins', name: 'Watcher’s Rise', subtitle: 'Ruins of the First Age', kind: 'ruins', x: -250, z: -840, r: 34, level: 0, zone: 120 },
  { id: 'crystals', name: 'Shardfield', subtitle: 'Where the Crystals Sing', kind: 'crystals', x: -660, z: -500, r: 62, level: 0, zone: 105 },
  { id: 'watch', name: 'Last Watch', subtitle: 'Gate of the Skyreach Range', kind: 'pass', x: -1780, z: 470, r: 14, level: 0, zone: 90 },
  { id: 'grove', name: 'Blossom Hollow', subtitle: 'Shrine of the Petals', kind: 'grove', x: 60, z: 300, r: 34, level: 0, zone: 70 },
  { id: 'pillar', name: 'Pillar of Ascent', subtitle: 'The Labyrinth Tower', kind: 'pillar', x: 780, z: 980, r: 52, level: 0, zone: 150 },
  { id: 'ring', name: 'The Old Ring', subtitle: 'Stones of the First Dawn', kind: 'ring', x: 660, z: -280, r: 20, level: 0, zone: 55 },
];

export const site = (id: string) => SITES.find((s) => s.id === id)!;

export interface Realm {
  plan: Plan;
  map: RealmMap;
  sites: Site[];
  roads: Road[];
}

let realm: Realm | null = null;

export function getRealm(): Realm {
  if (!realm) realm = buildRealm();
  return realm;
}

function dirTo(a: Site, p: Pt): number {
  return Math.atan2(p.z - a.z, p.x - a.x);
}

function edge(s: Site, toward: Pt, extra = 0): Pt {
  const a = dirTo(s, toward);
  return { x: s.x + Math.cos(a) * (s.r + extra), z: s.z + Math.sin(a) * (s.r + extra) };
}

function buildRealm(): Realm {
  const plan = new Plan();
  const city = site('city');
  const wind = site('windmere');
  const hearth = site('hearth');
  const ruins = site('ruins');
  const crystals = site('crystals');
  const watch = site('watch');

  // The ruins stand on a broad hill of their own.
  plan.hill(ruins.x, ruins.z, 210, 58, 1.3);

  const map = new RealmMap(plan, (m) => {
    for (const s of SITES) {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        for (const f of [0, 0.5, 1]) {
          sum += m.groundNow(s.x + Math.cos(a) * s.r * f, s.z + Math.sin(a) * s.r * f);
          n++;
        }
      }
      s.level = sum / n;
    }
    // The ruins sit on the crest.
    ruins.level = m.groundNow(ruins.x, ruins.z) - 1;

    // Waypoints for the roads leaving the city (they decide where the gates are).
    const wpKing = { x: -330, z: 175 };
    const wpSouth = { x: -505, z: -130 };
    const wpNorth = { x: -250, z: 470 };
    const wpWest = { x: -860, z: 300 };
    const gateAngles = [wpKing, wpSouth, wpNorth, wpWest].map((p) => dirTo(city, p));
    const { gates } = planCity(plan, city, gateAngles);

    const road = (way: Pt[], halfW: number, pave: number, seed: number, amp = 9, name?: string) =>
      plan.road(meander(way, amp, seed), halfW, pave, name);

    // King's Road: the city to Windmere, past the starting meadow.
    road([gates[0], wpKing, { x: -150, z: 115 }, { x: 60, z: 30 }, { x: 240, z: -190 }, edge(wind, { x: 240, z: -190 }, -8)], 2.8, 0.15, 1.1, 10, 'King’s Road');
    // South road to the ruins, with a spur to the crystals.
    road([gates[1], wpSouth, { x: -440, z: -420 }, { x: -330, z: -650 }, edge(ruins, { x: -330, z: -650 }, -4)], 2.2, 0.0, 2.3, 8);
    road([{ x: -440, z: -420 }, { x: -545, z: -470 }, edge(crystals, { x: -545, z: -470 }, -20)], 1.6, 0.0, 3.7, 5);
    // North road to Hearthbrook.
    road([gates[2], wpNorth, { x: -20, z: 560 }, { x: 160, z: 600 }, edge(hearth, { x: 160, z: 600 }, -8)], 2.2, 0.0, 4.9, 10);
    // Between the villages.
    road([edge(wind, { x: 510, z: -150 }, -8), { x: 510, z: -150 }, { x: 540, z: 210 }, { x: 450, z: 470 }, edge(hearth, { x: 450, z: 470 }, -8)], 1.9, 0.0, 6.1, 12);
    // West road climbs to the last watch under the mountains.
    road([gates[3], wpWest, { x: -1150, z: 330 }, { x: -1450, z: 420 }, { x: -1650, z: 450 }, edge(watch, { x: -1650, z: 450 }, -2)], 2.0, 0.0, 7.3, 14, 'Mountain Road');

    const grove = site('grove');
    const pillar = site('pillar');
    const ring = site('ring');
    // Lanes to the grove and the stone ring; the long road to the labyrinth tower.
    road([{ x: 60, z: 30 }, { x: 40, z: 160 }, edge(grove, { x: 40, z: 160 }, 2)], 1.5, 0.0, 8.2, 6);
    road([{ x: 510, z: -150 }, { x: 590, z: -220 }, edge(ring, { x: 590, z: -220 }, 4)], 1.4, 0.0, 9.4, 5);
    road([edge(hearth, { x: 520, z: 790 }, -8), { x: 520, z: 790 }, { x: 650, z: 900 }, edge(pillar, { x: 650, z: 900 }, 2)], 2.4, 0.2, 10.6, 10, 'Ascent Road');
    planGrove(plan, grove);
    planPillar(plan, pillar);
    planRing(plan, ring);

    planVillage(plan, wind, [dirTo(wind, { x: 240, z: -190 }), dirTo(wind, { x: 510, z: -150 })], 0x317d, 3, 'sheep');
    planVillage(plan, hearth, [dirTo(hearth, { x: 160, z: 600 }), dirTo(hearth, { x: 450, z: 470 })], 0x4e47, 1, 'horse');
    planRuins(plan, ruins);
    planCrystals(plan, crystals);
    planWatch(plan, watch);

    // Fields, hens and a fire in the villages.
    const rf = mulberry32(0xf1e1d);
    for (const v of [wind, hearth]) {
      fieldsAround(plan, m, rf, v.x, v.z, v.r + 18, v.r + 110, 7, SITES);
      plan.flocks.push({ x: v.x, z: v.z, r: v.r * 0.6, kind: 'chicken', n: 8 });
    }
    campfire(plan, wind.x + 12.5, wind.z - 2);
    campfire(plan, hearth.x - 12, hearth.z + 3);
    campfire(plan, watch.x - 8, watch.z + 4);
    campfire(plan, ruins.x + 9, ruins.z + 20);

    // Farmsteads along the country roads.
    const farms: { x: number; z: number }[] = [];
    const spawn = { x: -80, z: -120 };
    let fs = 0x7a12;
    for (const rd of plan.roads) {
      if (rd.pave > 0.5 || rd.halfW < 1.8) continue;
      let acc = 0;
      for (let i = 1; i < rd.pts.length - 1; i++) {
        acc += Math.hypot(rd.pts[i].x - rd.pts[i - 1].x, rd.pts[i].z - rd.pts[i - 1].z);
        if (acc < 190) continue;
        const a = rd.pts[i - 1];
        const b = rd.pts[i + 1];
        const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const side = (fs & 1) === 0 ? 1 : -1;
        const x = rd.pts[i].x + (-(b.z - a.z) / l) * 34 * side;
        const z = rd.pts[i].z + ((b.x - a.x) / l) * 34 * side;
        fs++;
        if (SITES.some((st) => Math.hypot(st.x - x, st.z - z) < st.r + 60)) continue;
        if (Math.hypot(x - spawn.x, z - spawn.z) < 140 || mountainMask(x, z) > 0.02) continue;
        if (farms.some((f) => Math.hypot(f.x - x, f.z - z) < 260)) continue;
        if (m.roadDist(x, z) < 22) continue;
        acc = 0;
        farms.push({ x, z });
        const rot = Math.atan2(rd.pts[i].x - x, rd.pts[i].z - z);
        planFarm(plan, m, x, z, rot, fs * 7919, SITES);
      }
    }

    // Hidden places, away from everything above.
    planHidden(plan, m, SITES);

    // Signposts where the country roads begin and end.
    for (const rd of [...plan.roads]) {
      if (rd.pave > 0.5) continue;
      const n = rd.pts.length;
      for (const [i, j] of [[0, 1], [n - 1, n - 2]]) {
        const p = rd.pts[i];
        const q = rd.pts[Math.min(n - 1, Math.max(0, j + (j > i ? 4 : -4)))];
        const d = Math.atan2(q.z - p.z, q.x - p.x);
        const sx = p.x + Math.cos(d) * 6 + Math.cos(d + Math.PI / 2) * (rd.halfW + 1.2);
        const sz = p.z + Math.sin(d) * 6 + Math.sin(d + Math.PI / 2) * (rd.halfW + 1.2);
        signpost(plan, sx, sz, [d, d + Math.PI + 0.3]);
      }
    }
  });

  // Wayside: lamps on the approach to the city, milestones further out.
  const rr = mulberry32(0x3a7);
  for (const road of plan.roads) {
    if (road.pave > 0.5) continue; // city streets are lit by the city
    let acc = 0;
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1];
      const b = road.pts[i];
      acc += Math.hypot(b.x - a.x, b.z - a.z);
      const dc = Math.hypot(b.x - city.x, b.z - city.z);
      const near = dc < city.r + 260 && dc > city.r + 12;
      const every = near ? 26 : 140;
      if (acc < every) continue;
      acc = 0;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      const side = rr() < 0.5 ? 1 : -1;
      const x = b.x + (-dz / l) * (road.halfW + 1.1) * side;
      const z = b.z + (dx / l) * (road.halfW + 1.1) * side;
      if (map.solidAt(x, z) > 0.1) continue;
      if (near) {
        plan.prop((bd) => {
          const y = terrainHeight(x, z);
          lamp(bd, x, y, z, 0);
          plan.lamps.push({ x, y: y + 3.6, z });
        });
      } else {
        plan.prop((bd) => {
          const y = terrainHeight(x, z);
          bd.box(x, y - 0.4, z, 0.5, 1.4, 0.32, Math.atan2(dx, dz), '#c8c0ae', M.stone, rr());
          bd.box(x, y + 0.95, z, 0.5, 0.12, 0.32, Math.atan2(dx, dz), '#8fe8ff', M.rune, rr());
        });
      }
    }
  }

  return { plan, map, sites: SITES, roads: plan.roads };
}
