/**
 * Procedural flower heads for ten real wildflowers, drawn in a head-space square
 * q in [-1, 1]². Shared by the meadow flowers and the trailer's hero blooms.
 *
 *  0 common daisy (Bellis perennis)     5 forget-me-not (Myosotis)
 *  1 meadow buttercup (Ranunculus acris) 6 dandelion (Taraxacum)
 *  2 corn poppy (Papaver rhoeas)        7 wild pansy (Viola tricolor)
 *  3 cornflower (Centaurea cyanus)      8 iris (yellow flag / Siberian)
 *  4 garden cosmos (Cosmos bipinnatus)  9 red clover (Trifolium pratense)
 */
export const SPECIES = {
  daisy: 0,
  buttercup: 1,
  poppy: 2,
  cornflower: 3,
  cosmos: 4,
  forgetMeNot: 5,
  dandelion: 6,
  pansy: 7,
  iris: 8,
  clover: 9,
} as const;

/**
 * A round, finely subdivided disc for a flower head: centre plus rings of vertices
 * (x, y in [-1.08, 1.08]). The vertex shader bends it into a cup or dome per species.
 */
export function discGrid(rings = [0.14, 0.3, 0.5, 0.72, 0.92, 1.08], segs = 18): { xy: number[]; index: number[] } {
  const xy: number[] = [0, 0];
  const index: number[] = [];
  rings.forEach((r) => {
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      xy.push(Math.cos(a) * r, Math.sin(a) * r);
    }
  });
  for (let j = 0; j < segs; j++) index.push(0, 1 + j, 1 + ((j + 1) % segs));
  for (let i = 0; i < rings.length - 1; i++) {
    const a0 = 1 + i * segs;
    const b0 = 1 + (i + 1) * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      index.push(a0 + j, b0 + j, b0 + j1, a0 + j, b0 + j1, a0 + j1);
    }
  }
  return { xy, index };
}

/**
 * Shape and pose per species, in head units:
 * cupZ: height of the head surface above its base plane (cups, domes, drooping falls);
 * speciesTilt: how far the bloom leans off vertical (pansies look sideways, most face the sky).
 */
export const CUP_GLSL = /* glsl */ `
float cupZ(float sp, vec2 q) {
  float r2 = dot(q, q);
  vec3 k; // cup, dome, dome radius
  if (sp < 0.5) k = vec3(0.16, 0.14, 0.27);
  else if (sp < 1.5) k = vec3(0.6, 0.08, 0.16);
  else if (sp < 2.5) k = vec3(0.5, 0.06, 0.13);
  else if (sp < 3.5) k = vec3(0.32, 0.12, 0.24);
  else if (sp < 4.5) k = vec3(0.14, 0.08, 0.18);
  else if (sp < 5.5) k = vec3(0.1, 0.0, 0.1);
  else if (sp < 6.5) k = vec3(-0.06, 0.3, 1.0);
  else if (sp < 7.5) k = vec3(0.18, 0.0, 0.1);
  else if (sp < 8.5) k = vec3(-0.38, 0.32, 0.6);
  else if (sp < 9.5) k = vec3(-0.12, 0.62, 1.0);
  else k = vec3(0.5, 0.1, 0.2);
  return k.x * r2 + k.y * max(0.0, 1.0 - r2 / (k.z * k.z));
}
float speciesTilt(float sp) {
  if (sp > 6.5 && sp < 7.5) return 1.5;  // pansy: faces out sideways
  if (sp > 7.5 && sp < 8.5) return 0.45;
  if (sp > 8.5 && sp < 9.5) return 0.3;  // clover heads are round anyway
  if (sp > 9.5) return 0.0;              // water lily floats flat
  return 0.8;
}
`;

/** Head half-size in metres for each species. */
export const SPECIES_SIZE_GLSL = /* glsl */ `
float speciesSize(float sp) {
  if (sp < 0.5) return 0.046;
  if (sp < 1.5) return 0.04;
  if (sp < 2.5) return 0.08;
  if (sp < 3.5) return 0.055;
  if (sp < 4.5) return 0.075;
  if (sp < 5.5) return 0.056;
  if (sp < 6.5) return 0.056;
  if (sp < 7.5) return 0.052;
  if (sp < 8.5) return 0.088;
  return 0.042;
}
`;

export const FLOWER_HEAD_GLSL = /* glsl */ `
#define FPI 3.14159265

struct Bloom { vec3 col; float a; float petal; };

float fh1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float fh2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// One petal along a given axis. x = coverage, y = t (0 base .. 1 tip), z = lateral (-1..1), w = 1 inside.
// prof: 0 = elliptic (narrows at both ends), 1 = spoon (widest near the tip), 2 = funnel (widens to the tip).
vec4 petalAxis(vec2 q, float ang, float L, float wid, float tipK, float prof, float notch, float aa) {
  vec2 ax = vec2(cos(ang), sin(ang));
  float along = dot(q, ax);
  float lat = dot(q, vec2(-ax.y, ax.x));
  float t = along / L;
  float tc = clamp(t, 0.0, 1.0);
  float w;
  if (prof < 0.5) w = wid * L * pow(tc, 0.5) * pow(max(0.0, 1.0 - pow(tc, tipK)), 0.5);
  else if (prof < 1.5) w = wid * L * pow(tc, 0.7) * pow(max(0.0, 1.0 - pow(tc, tipK)), 0.35);
  else w = wid * L * (0.18 + 0.82 * tc) * pow(max(0.0, 1.0 - pow(tc, tipK)), 0.15);
  float latN = lat / max(w, 1e-4);
  // Toothed or notched tips.
  float tipEdge = 1.0 - notch * abs(sin(latN * FPI * 1.5));
  float m = smoothstep(w + aa, w - aa, abs(lat)) * smoothstep(-aa, aa, along) * smoothstep(tipEdge * L + aa, tipEdge * L - aa, along);
  return vec4(m, t, clamp(latN, -1.0, 1.0), step(0.001, m));
}

// A whorl of n petals; overlapping petals stack in a random but stable order.
// Returns the topmost petal (x coverage, y t, z lateral) and in w its id.
vec4 whorl(vec2 q, float n, float rot, float L, float wid, float tipK, float prof, float notch, float rnd, float aa, out float under) {
  float sec = 2.0 * FPI / n;
  float a = atan(q.y, q.x) - rot;
  float id0 = floor(a / sec + 0.5);
  vec4 best = vec4(0.0);
  float bestPrio = -1.0;
  float bestId = 0.0;
  under = 0.0;
  for (int k = -1; k <= 1; k++) {
    float id = id0 + float(k);
    float idm = mod(id, n);
    float Lj = L * (0.9 + 0.18 * fh1(idm * 7.13 + rnd * 31.0));
    float aj = rot + id * sec + (fh1(idm * 3.7 + rnd * 17.0) - 0.5) * sec * 0.25;
    vec4 p = petalAxis(q, aj, Lj, wid, tipK, prof, notch, aa);
    if (p.x <= 0.001) continue;
    float prio = fh1(idm * 1.618 + rnd * 5.0);
    if (prio > bestPrio) {
      if (bestPrio >= 0.0) under = 1.0;
      best = p;
      bestPrio = prio;
      bestId = idm;
    } else {
      under = 1.0;
    }
  }
  best.w = bestId;
  return best;
}

// Dense disc of tiny florets (composite centre), domed.
vec3 floretDisc(vec2 q, float rc, vec3 dark, vec3 light, float freq) {
  float r = length(q) / rc;
  // Spiral-ish florets: polar cells.
  float ang = atan(q.y, q.x);
  vec2 g = vec2(ang * freq * 0.5 / FPI * (0.3 + r), r * freq * 0.35);
  vec2 c = fract(g) - 0.5;
  float dotm = smoothstep(0.42, 0.12, length(c));
  vec3 col = mix(dark, light, dotm * (0.6 + 0.4 * fh2(floor(g))));
  col *= 0.55 + 0.45 * sqrt(max(0.0, 1.0 - r * r));
  col *= 1.0 - 0.35 * smoothstep(0.75, 1.0, r);
  return col;
}

void addLayer(inout Bloom b, vec3 c, float m, float petal) {
  m = clamp(m, 0.0, 1.0);
  b.col = mix(b.col, c, m);
  b.a = max(b.a, m);
  b.petal = mix(b.petal, petal, m);
}

float discMask(vec2 q, float rc, float aa) { return smoothstep(rc + aa, rc - aa, length(q)); }

// Shared petal shading: base shadow, central groove, faint veins, darker rim, shadow where it overlaps another.
vec3 petalShade(vec3 c, vec4 p, float veins, float under) {
  c *= 0.72 + 0.28 * smoothstep(0.0, 0.45, p.y);
  c *= 1.0 - 0.1 * smoothstep(0.15, 0.0, abs(p.z)) * smoothstep(0.2, 0.6, p.y);
  c *= 1.0 - veins * (0.5 + 0.5 * cos(p.z * 18.0 + p.y * 3.0)) * smoothstep(0.1, 0.5, p.y);
  c *= 1.0 - 0.22 * smoothstep(0.75, 1.0, abs(p.z)) * under;
  c *= 1.0 - 0.12 * smoothstep(0.85, 1.0, abs(p.z));
  return c;
}

Bloom daisy(vec2 q, float rnd, float aa) {
  Bloom b = Bloom(vec3(0.0), 0.0, 0.0);
  float u;
  float blush = fh1(rnd * 9.1);
  for (int l = 0; l < 2; l++) {
    float fl = float(l);
    vec4 p = whorl(q, 28.0, rnd * 6.28 + fl * 0.11, 0.97 - fl * 0.07, 0.11, 3.0, 1.0, 0.0, rnd + fl, aa, u);
    vec3 c = vec3(0.985, 0.975, 0.95);
    c = mix(c, vec3(0.92, 0.42, 0.6), smoothstep(0.6, 1.0, p.y) * blush * blush * 0.9);
    c = mix(c, vec3(0.9, 0.95, 0.75), smoothstep(0.3, 0.0, p.y) * 0.5);
    c = petalShade(c, p, 0.03, 1.0) * (1.0 - fl * 0.08);
    addLayer(b, c, p.x, 1.0);
  }
  float rc = 0.25;
  vec3 d = floretDisc(q, rc, vec3(0.86, 0.5, 0.04), vec3(1.0, 0.86, 0.22), 26.0);
  addLayer(b, d, discMask(q, rc, aa), 0.0);
  return b;
}

Bloom buttercup(vec2 q, float rnd, float aa) {
  Bloom b = Bloom(vec3(0.0), 0.0, 0.0);
  float u;
  vec4 p = whorl(q, 5.0, rnd * 6.28, 0.9, 0.82, 2.0, 0.0, 0.0, rnd, aa, u);
  vec3 c = vec3(1.0, 0.82, 0.04);
  c = mix(vec3(0.72, 0.7, 0.1), c, smoothstep(0.0, 0.3, p.y));
  // Cupped: the bowl darkens toward the middle and the rim catches the light.
  c *= 0.78 + 0.22 * smoothstep(0.2, 0.9, p.y) + 0.12 * smoothstep(0.6, 1.0, abs(p.z));
  c = petalShade(c, p, 0.015, u);
  // Buttercups are glossy: a small mirror-like highlight on each petal.
  float gloss = smoothstep(0.22, 0.0, length(vec2(p.y - 0.62, p.z * 0.35 + 0.12)));
  c = mix(c, vec3(1.0, 1.0, 0.9), gloss * 0.7);
  addLayer(b, c, p.x, 1.0);
  // Stamens ring around a green knot of pistils.
  float r = length(q);
  float ang = atan(q.y, q.x);
  float st = smoothstep(0.5, 0.1, length(vec2(fract(ang * 24.0 / (2.0 * FPI)) - 0.5, (r - 0.2) * 14.0)));
  vec3 sc = mix(vec3(0.85, 0.62, 0.05), vec3(1.0, 0.85, 0.25), st);
  addLayer(b, sc, discMask(q, 0.26, aa) * (0.5 + 0.5 * st), 0.0);
  addLayer(b, floretDisc(q, 0.13, vec3(0.42, 0.55, 0.1), vec3(0.7, 0.78, 0.25), 14.0), discMask(q, 0.13, aa), 0.0);
  return b;
}

Bloom poppy(vec2 q, float rnd, float aa) {
  Bloom b = Bloom(vec3(0.0), 0.0, 0.0);
  float u;
  vec4 p = whorl(q, 4.0, rnd * 6.28, 0.97, 1.3, 2.4, 0.0, 0.0, rnd, aa, u);
  vec3 c = mix(vec3(0.82, 0.04, 0.03), vec3(0.97, 0.22, 0.07), smoothstep(0.3, 1.0, p.y));
  // Crumpled silk: soft creases running out from the base.
  float crease = sin(p.z * 9.0 + sin(p.y * 7.0 + p.w) * 1.5) * 0.5 + 0.5;
  c *= 0.86 + 0.14 * crease;
  c *= 1.0 - 0.12 * pow(0.5 + 0.5 * sin(p.y * 22.0 + p.z * 3.0 + p.w * 2.0), 3.0) * smoothstep(0.3, 0.8, p.y);
  c = petalShade(c, p, 0.0, u);
  // Black basal blotch, sometimes rimmed in white.
  float blotch = smoothstep(0.34, 0.2, p.y) * smoothstep(0.85, 0.5, abs(p.z));
  float rim = fh1(rnd * 4.3) > 0.6 ? smoothstep(0.4, 0.33, p.y) * smoothstep(0.95, 0.6, abs(p.z)) * (1.0 - blotch) : 0.0;
  c = mix(c, vec3(0.95, 0.9, 0.85), rim * 0.8);
  c = mix(c, vec3(0.04, 0.02, 0.03), blotch);
  addLayer(b, c, p.x, 1.0);
  // Ring of dark stamens around the seed capsule with its stigma rays.
  float r = length(q);
  float ang = atan(q.y, q.x);
  float st = smoothstep(0.5, 0.0, length(vec2(fract(ang * 30.0 / (2.0 * FPI) + r * 2.0) - 0.5, 0.0)));
  addLayer(b, mix(vec3(0.03, 0.02, 0.04), vec3(0.18, 0.12, 0.2), st), discMask(q, 0.26, aa) * smoothstep(0.1, 0.13, r) * (0.55 + 0.45 * st), 0.0);
  vec3 cap = vec3(0.42, 0.47, 0.34) * (0.7 + 0.3 * sqrt(max(0.0, 1.0 - r * r / 0.012)));
  float rays = smoothstep(0.25, 0.0, abs(fract(ang * 9.0 / (2.0 * FPI)) - 0.5) * 2.0 - 0.05);
  cap = mix(cap, vec3(0.2, 0.08, 0.22), rays * 0.85);
  addLayer(b, cap, discMask(q, 0.11, aa), 0.0);
  return b;
}

Bloom cornflower(vec2 q, float rnd, float aa) {
  Bloom b = Bloom(vec3(0.0), 0.0, 0.0);
  float u;
  // Ragged funnel florets ending in little teeth.
  vec4 p = whorl(q, 9.0, rnd * 6.28, 0.96, 0.62, 6.0, 2.0, 0.16, rnd, aa, u);
  vec3 c = mix(vec3(0.3, 0.18, 0.62), vec3(0.16, 0.36, 0.95), smoothstep(0.1, 0.55, p.y));
  c = mix(c, vec3(0.45, 0.62, 1.0), smoothstep(0.7, 1.0, p.y) * 0.6);
  c = petalShade(c, p, 0.06, u);
  addLayer(b, c, p.x, 1.0);
  // Inner ring of smaller florets, then the dark tufted centre.
  vec4 p2 = whorl(q, 12.0, rnd * 3.1 + 0.3, 0.5, 0.5, 6.0, 2.0, 0.2, rnd + 2.0, aa, u);
  addLayer(b, petalShade(vec3(0.2, 0.28, 0.82), p2, 0.05, u), p2.x, 1.0);
  addLayer(b, floretDisc(q, 0.2, vec3(0.12, 0.04, 0.2), vec3(0.42, 0.22, 0.6), 22.0), discMask(q, 0.2, aa), 0.0);
  return b;
}

Bloom cosmos(vec2 q, float rnd, float aa) {
  Bloom b = Bloom(vec3(0.0), 0.0, 0.0);
  float u;
  float v = fh1(rnd * 2.7);
  vec3 base = v < 0.4 ? vec3(0.88, 0.22, 0.58) : v < 0.78 ? vec3(0.97, 0.66, 0.82) : vec3(0.985, 0.96, 0.97);
  vec4 p = whorl(q, 8.0, rnd * 6.28, 0.96, 0.7, 5.0, 1.0, 0.07, rnd, aa, u);
  vec3 c = base;
  c = mix(c, vec3(0.62, 0.05, 0.25), smoothstep(0.28, 0.08, p.y) * (v < 0.78 ? 0.75 : 0.25));
  c = petalShade(c, p, 0.05, u);
  addLayer(b, c, p.x, 1.0);
  addLayer(b, floretDisc(q, 0.17, vec3(0.85, 0.52, 0.03), vec3(1.0, 0.86, 0.25), 20.0), discMask(q, 0.17, aa), 0.0);
  return b;
}

Bloom forgetMeNot(vec2 q, float rnd, float aa) {
  Bloom b = Bloom(vec3(0.0), 0.0, 0.0);
  // A little spray of florets plus a couple of pink buds.
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float ang = fi * 1.2566 + rnd * 6.28;
    vec2 off = i == 0 ? vec2(0.0) : vec2(cos(ang), sin(ang)) * (0.5 + 0.08 * fh1(fi + rnd));
    float s = (i == 0 ? 0.3 : 0.26) + 0.04 * fh1(fi + rnd * 11.0);
    vec2 lq = (q - off) / s;
    float laa = aa / s;
    float u;
    vec4 p = whorl(lq, 5.0, fi * 1.3 + rnd * 6.28, 0.95, 0.92, 2.0, 0.0, 0.0, rnd + fi, laa, u);
    vec3 c = fh1(fi * 9.3 + rnd) > 0.85 ? vec3(0.8, 0.66, 0.95) : vec3(0.42, 0.66, 1.0);
    c = petalShade(c, p, 0.02, u);
    float r = length(lq);
    c = mix(c, vec3(0.98, 0.97, 0.92), smoothstep(0.34, 0.26, r));
    c = mix(c, vec3(1.0, 0.82, 0.18), smoothstep(0.16, 0.11, r));
    addLayer(b, c, p.x, 1.0);
  }
  for (int i = 0; i < 2; i++) {
    float ang = float(i) * 2.5 + rnd * 6.28 + 0.6;
    vec2 off = vec2(cos(ang), sin(ang)) * 0.86;
    float m = discMask(q - off, 0.07, aa);
    addLayer(b, vec3(0.92, 0.55, 0.72) * (0.8 + 0.2 * (q.y - off.y + 0.09) / 0.18), m, 0.5);
  }
  return b;
}

Bloom dandelion(vec2 q, float rnd, float aa) {
  Bloom b = Bloom(vec3(0.0), 0.0, 0.0);
  float u;
  for (int l = 0; l < 4; l++) {
    float fl = float(l);
    float n = 34.0 - fl * 7.0;
    float L = 0.98 - fl * 0.22;
    vec4 p = whorl(q, n, rnd * 6.28 + fl * 0.37, L, 0.2, 8.0, 1.0, 0.08, rnd + fl * 3.0, aa, u);
    vec3 c = mix(vec3(1.0, 0.8, 0.06), vec3(1.0, 0.6, 0.0), fl / 3.0);
    c = petalShade(c, p, 0.04, 1.0);
    addLayer(b, c, p.x, 1.0);
  }
  addLayer(b, vec3(0.95, 0.55, 0.0), discMask(q, 0.08, aa), 0.0);
  return b;
}

Bloom pansy(vec2 q, float rnd, float aa) {
  Bloom b = Bloom(vec3(0.0), 0.0, 0.0);
  q.y -= 0.05;
  float v = fh1(rnd * 6.1);
  vec3 top = v < 0.5 ? vec3(0.34, 0.12, 0.55) : vec3(0.55, 0.38, 0.85);
  vec3 side = vec3(0.86, 0.8, 0.97);
  // Back to front: the two upper petals, the two side petals, the big lower lip.
  vec4 p;
  p = petalAxis(q, radians(118.0), 0.88, 0.78, 2.2, 0.0, 0.0, aa);
  addLayer(b, petalShade(top, p, 0.03, 1.0), p.x, 1.0);
  p = petalAxis(q, radians(62.0), 0.88, 0.78, 2.2, 0.0, 0.0, aa);
  addLayer(b, petalShade(top * 1.05, p, 0.03, 1.0), p.x, 1.0);
  for (int i = 0; i < 2; i++) {
    p = petalAxis(q, radians(i == 0 ? 198.0 : -18.0), 0.74, 0.75, 2.2, 0.0, 0.0, aa);
    vec3 c = mix(vec3(1.0, 0.86, 0.3), side, smoothstep(0.15, 0.45, p.y));
    c = mix(c, top, smoothstep(0.65, 1.0, p.y) * 0.5);
    float lines = smoothstep(0.12, 0.0, abs(fract(p.z * 2.0 + 0.5) - 0.5)) * smoothstep(0.45, 0.1, p.y);
    c = mix(c, vec3(0.2, 0.06, 0.3), lines * 0.8);
    addLayer(b, petalShade(c, p, 0.0, 1.0), p.x, 1.0);
  }
  p = petalAxis(q, radians(-90.0), 0.9, 0.95, 2.4, 0.0, 0.0, aa);
  vec3 c = mix(vec3(1.0, 0.82, 0.12), vec3(0.99, 0.95, 0.72), smoothstep(0.2, 0.6, p.y));
  c = mix(c, top, smoothstep(0.8, 1.0, p.y) * (v < 0.5 ? 0.6 : 0.2));
  float guides = smoothstep(0.1, 0.0, abs(fract(p.z * 3.0 + 0.5) - 0.5)) * smoothstep(0.55, 0.05, p.y);
  c = mix(c, vec3(0.18, 0.05, 0.28), guides * 0.9);
  addLayer(b, petalShade(c, p, 0.0, 1.0), p.x, 1.0);
  // The little white-bearded eye.
  float r = length(q);
  addLayer(b, mix(vec3(0.98, 0.95, 0.9), vec3(1.0, 0.7, 0.05), smoothstep(0.08, 0.03, r)), discMask(q, 0.09, aa), 0.0);
  return b;
}

Bloom iris(vec2 q, float rnd, float aa) {
  Bloom b = Bloom(vec3(0.0), 0.0, 0.0);
  bool yellow = fh1(rnd * 3.9) < 0.6;
  vec3 fallC = yellow ? vec3(1.0, 0.84, 0.1) : vec3(0.33, 0.3, 0.86);
  vec3 stdC = yellow ? vec3(1.0, 0.9, 0.35) : vec3(0.52, 0.48, 0.95);
  float rot = rnd * 6.28;
  // Three broad falls with veins and a signal patch.
  for (int i = 0; i < 3; i++) {
    vec4 p = petalAxis(q, rot + float(i) * 2.0944, 0.98, 0.85, 2.2, 1.0, 0.0, aa);
    vec3 c = fallC * (0.85 + 0.15 * smoothstep(0.5, 1.0, p.y));
    float vein = smoothstep(0.35, 0.0, abs(fract(p.z * 5.0 + 0.5) - 0.5) * 2.0) * smoothstep(0.12, 0.35, p.y) * (1.0 - smoothstep(0.55, 0.8, p.y));
    c = mix(c, yellow ? vec3(0.5, 0.25, 0.06) : vec3(0.12, 0.08, 0.4), vein * 0.75);
    float signal = smoothstep(0.5, 0.25, p.y) * smoothstep(0.15, 0.3, p.y) * smoothstep(0.6, 0.2, abs(p.z));
    c = mix(c, yellow ? vec3(0.95, 0.6, 0.05) : vec3(0.98, 0.92, 0.6), signal * 0.85);
    addLayer(b, petalShade(c, p, 0.0, 1.0), p.x, 1.0);
  }
  // Three narrow upright standards between them, then the pale style arms on top.
  for (int i = 0; i < 3; i++) {
    vec4 p = petalAxis(q, rot + 1.0472 + float(i) * 2.0944, 0.5, 0.45, 2.0, 0.0, 0.0, aa);
    addLayer(b, petalShade(stdC, p, 0.03, 1.0), p.x, 1.0);
  }
  for (int i = 0; i < 3; i++) {
    vec4 p = petalAxis(q, rot + float(i) * 2.0944, 0.42, 0.3, 3.0, 0.0, 0.0, aa);
    addLayer(b, petalShade(yellow ? vec3(1.0, 0.93, 0.55) : vec3(0.78, 0.76, 0.98), p, 0.0, 1.0), p.x, 1.0);
  }
  return b;
}

Bloom clover(vec2 q, float rnd, float aa) {
  Bloom b = Bloom(vec3(0.0), 0.0, 0.0);
  float r = length(q);
  float ang = atan(q.y, q.x);
  // Rings of little tubular florets pointing outward, rosy at the top, pale at the base.
  float ring = r * 7.0;
  float ri = floor(ring);
  float nAround = max(4.0, floor(6.0 + ri * 6.0));
  float cell = floor((ang / (2.0 * FPI) + 0.5) * nAround + fh1(ri + rnd * 7.0));
  vec2 f = vec2(fract((ang / (2.0 * FPI) + 0.5) * nAround + fh1(ri + rnd * 7.0)) - 0.5, fract(ring) - 0.5);
  float tube = smoothstep(0.5, 0.1, length(f * vec2(1.0, 0.8)));
  float tipLight = smoothstep(-0.2, 0.45, f.y);
  float R = 0.82 + 0.06 * (fh1(cell + ri * 13.0) - 0.5);
  float m = smoothstep(R + aa * 2.0, R - aa * 2.0, r);
  float z = sqrt(max(0.0, 1.0 - (r / R) * (r / R)));
  vec3 rose = mix(vec3(0.97, 0.78, 0.88), vec3(0.88, 0.36, 0.62), smoothstep(-0.8, 0.4, q.y));
  vec3 c = mix(rose * 0.72, mix(rose, vec3(1.0, 0.93, 0.96), tipLight * 0.35), tube);
  c *= 0.62 + 0.38 * z;
  addLayer(b, c, m, 0.6);
  return b;
}

// Water lily (Nymphaea): three whorls of pointed petals, white flushing to pink, a golden crown of stamens.
Bloom waterLily(vec2 q, float rnd, float aa) {
  Bloom b = Bloom(vec3(0.0), 0.0, 0.0);
  float u;
  float pink = fh1(rnd * 5.3);
  vec3 tipC = pink < 0.45 ? vec3(0.96, 0.55, 0.72) : pink < 0.75 ? vec3(0.99, 0.82, 0.88) : vec3(0.99, 0.98, 0.96);
  for (int l = 0; l < 3; l++) {
    float fl = float(l);
    vec4 p = whorl(q, 8.0, rnd * 6.28 + fl * 0.39, 0.98 - fl * 0.22, 0.42 - fl * 0.05, 1.3, 0.0, 0.0, rnd + fl * 2.0, aa, u);
    vec3 c = mix(vec3(0.99, 0.97, 0.9), tipC, smoothstep(0.35, 1.0, p.y) * (0.6 + fl * 0.2));
    c = mix(c, vec3(0.88, 0.95, 0.75), smoothstep(0.25, 0.0, p.y) * 0.35);
    c = petalShade(c, p, 0.04, u) * (0.88 + fl * 0.06);
    addLayer(b, c, p.x, 1.0);
  }
  float r = length(q);
  float ang = atan(q.y, q.x);
  float st = smoothstep(0.5, 0.0, abs(fract(ang * 22.0 / (2.0 * FPI)) - 0.5) * 2.0);
  vec3 sc = mix(vec3(0.95, 0.62, 0.05), vec3(1.0, 0.88, 0.3), st * smoothstep(0.08, 0.2, r));
  addLayer(b, sc, discMask(q, 0.2, aa) * (0.6 + 0.4 * st + smoothstep(0.12, 0.08, r)), 0.0);
  return b;
}

Bloom flowerHead(vec2 q, float sp, float rnd, float aa) {
  if (sp < 0.5) return daisy(q, rnd, aa);
  if (sp < 1.5) return buttercup(q, rnd, aa);
  if (sp < 2.5) return poppy(q, rnd, aa);
  if (sp < 3.5) return cornflower(q, rnd, aa);
  if (sp < 4.5) return cosmos(q, rnd, aa);
  if (sp < 5.5) return forgetMeNot(q, rnd, aa);
  if (sp < 6.5) return dandelion(q, rnd, aa);
  if (sp < 7.5) return pansy(q, rnd, aa);
  if (sp < 8.5) return iris(q, rnd, aa);
  if (sp < 9.5) return clover(q, rnd, aa);
  return waterLily(q, rnd, aa);
}

// Seen from underneath or edge-on from behind: a paler, greener petal back and the green calyx.
Bloom backOf(Bloom b, vec2 q, float sp) {
  float r = length(q);
  // Petal backs keep their colour, a little paler and cooler; a small green calyx with five sepals.
  vec3 under = mix(b.col, vec3(dot(b.col, vec3(0.33))), 0.15) * 0.9 + vec3(0.02, 0.03, 0.0);
  float sepals = smoothstep(0.02, 0.0, abs(fract(atan(q.y, q.x) * 5.0 / (2.0 * FPI)) - 0.5) - 0.44) * smoothstep(0.38, 0.18, r);
  float calyx = max(smoothstep(0.17, 0.12, r), sepals);
  if (sp > 8.5 && sp < 9.5) calyx = 0.0; // clover: florets all round
  b.col = mix(under, vec3(0.24, 0.42, 0.15), calyx);
  b.petal *= 1.0 - calyx;
  return b;
}

// Light a head: colours above are authored in sRGB. Petals glow when the sun is behind them.
vec3 shadeBloom(Bloom b, vec3 worldPos, vec3 n, vec3 sunDir, vec3 sunCol, vec3 ambient) {
  vec3 col = pow(b.col, vec3(2.2));
  vec3 V = normalize(cameraPosition - worldPos);
  float facing = 0.75 + 0.25 * abs(dot(n, sunDir));
  vec3 lit = col * (ambient * 1.05 + sunCol * 0.95 * max(sunDir.y + 0.15, 0.0) * facing);
  float back = pow(max(dot(-V, sunDir), 0.0), 2.0) * b.petal;
  lit += sunCol * col * back * 0.55;
  return lit;
}
`;
