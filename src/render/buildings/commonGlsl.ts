// GLSL shared by the building materials: #defines generated from the generator's
// constants (so ids never drift), hashes, filtered noise, analytic box filters,
// the surface struct, window light colours and interior ("room") mapping.

import { DSURF, FLAG, GLASS, GND, OCC, PAT, SIGN_LIGHT, WSURF } from '../../world/buildings/constants';

function defines(prefix: string, table: Record<string, number>): string {
  return Object.entries(table)
    .map(([k, v]) => `#define ${prefix}_${k} ${v}`)
    .join('\n');
}

export const BLD_DEFINES = [
  defines('PAT', PAT),
  defines('GND', GND),
  defines('GLASS', GLASS),
  defines('WSURF', WSURF),
  defines('OCC', OCC),
  defines('FLAG', FLAG),
  defines('DS', DSURF),
  defines('SIGN', SIGN_LIGHT),
].join('\n');

export const BLD_UNIFORMS_GLSL = /* glsl */ `
uniform float uBldNight;
uniform float uBldDay;
uniform vec4 uBldOcc;
uniform vec3 uBldSkyZ;
uniform vec3 uBldSkyH;
uniform vec3 uBldGnd;
`;

export const BLD_COMMON_GLSL = /* glsl */ `
struct BldS {
  vec3 alb;    // albedo
  float rough;
  float metal;
  vec3 n;      // tangent-space normal (x along the facade / u, y up, z out)
  vec3 emis;   // emitted radiance (interiors, lights)
  float ao;    // indirect light occlusion
  float sh;    // direct light occlusion (recess shadows)
  float glass; // glass coverage (fallback reflections)
};

BldS bNew(vec3 alb) {
  BldS s;
  s.alb = alb; s.rough = 0.9; s.metal = 0.0; s.n = vec3(0.0, 0.0, 1.0);
  s.emis = vec3(0.0); s.ao = 1.0; s.sh = 1.0; s.glass = 0.0;
  return s;
}

BldS bMix(BldS a, BldS b, float t) {
  a.alb = mix(a.alb, b.alb, t); a.rough = mix(a.rough, b.rough, t); a.metal = mix(a.metal, b.metal, t);
  a.n = mix(a.n, b.n, t); a.emis = mix(a.emis, b.emis, t); a.ao = mix(a.ao, b.ao, t);
  a.sh = mix(a.sh, b.sh, t); a.glass = mix(a.glass, b.glass, t);
  return a;
}

float bSat(float x) { return clamp(x, 0.0, 1.0); }

// Hashes without sine (Dave Hoskins)
float bh11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float bh21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 bh22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 bh32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }

float bn2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = bh21(i);
  float b = bh21(i + vec2(1.0, 0.0));
  float c = bh21(i + vec2(0.0, 1.0));
  float d = bh21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Noise that fades to its mean once a noise cell is smaller than ~2 pixels (fpp = pixel size in noise units).
float bn2f(vec2 p, float fpp) { return mix(bn2(p), 0.5, smoothstep(0.25, 0.6, fpp)); }

// Integral from 0 to x of the periodic indicator of [a, b] (period p, 0 <= a < b <= p).
float bPI(float x, float p, float a, float b) {
  float n = floor(x / p);
  return n * (b - a) + clamp(x - n * p - a, 0.0, b - a);
}
// Box-filtered pulse train: exact average coverage over [x - w/2, x + w/2]. Never aliases.
float bPulse(float x, float w, float p, float a, float b) {
  w = max(w, 1e-4);
  return (bPI(x + 0.5 * w, p, a, b) - bPI(x - 0.5 * w, p, a, b)) / w;
}
// Box-filtered single interval [a, b].
float bBox(float x, float w, float a, float b) {
  w = max(w, 1e-4);
  return bSat((min(x + 0.5 * w, b) - max(x - 0.5 * w, a)) / w);
}
float bRect(vec2 p, vec2 w, vec2 lo, vec2 hi) { return bBox(p.x, w.x, lo.x, hi.x) * bBox(p.y, w.y, lo.y, hi.y); }
// Anti-aliased inside test for a signed distance (negative inside), w = pixel size.
float bFill(float sd, float w) { return bSat(0.5 - sd / max(w, 1e-4)); }
// A thin line of width lw at distance d, faded to its average when thinner than a pixel.
float bLine(float d, float lw, float w) {
  float cov = bSat((0.5 * lw - abs(d)) / max(w, 1e-4) + 0.5);
  float avg = lw / max(w, lw);
  return mix(cov, avg, smoothstep(0.5 * lw, 2.0 * lw, w));
}

float bFresnel(float cosT, float f0) { float k = 1.0 - bSat(cosT); float k2 = k * k; return f0 + (1.0 - f0) * k2 * k2 * k; }

vec3 bSkyFallback(vec3 d) {
  float y = d.y;
  vec3 sky = mix(uBldSkyH, uBldSkyZ, sqrt(bSat(y)));
  vec3 gnd = mix(uBldSkyH * 0.55, uBldGnd, bSat(-y * 5.0));
  return y >= 0.0 ? sky : gnd;
}

// Direction toward the main light (world space); straight up when the scene has none.
vec3 bLightDir() {
#if NUM_SUN_LIGHTS > 0
  return transformDirectionByInverseViewMatrix(sunLights[0].direction, viewMatrix);
#elif NUM_DIR_LIGHTS > 0
  return transformDirectionByInverseViewMatrix(directionalLights[0].direction, viewMatrix);
#else
  return vec3(0.0, 1.0, 0.0);
#endif
}

// Interior light colour for a window (h = random 0..1) by occupancy profile.
vec3 bLightCol(float h, int occ) {
  vec3 warm = vec3(1.0, 0.58, 0.28);
  vec3 neutral = vec3(1.0, 0.8, 0.55);
  vec3 cool = vec3(0.75, 0.85, 1.0);
  vec3 tv = vec3(0.3, 0.45, 1.0);
  if (occ == OCC_OFFICE) return h < 0.55 ? cool : h < 0.9 ? neutral : warm;
  if (occ == OCC_RETAIL) return h < 0.45 ? cool : h < 0.85 ? neutral : warm;
  if (occ == OCC_HOTEL) return h < 0.6 ? warm : h < 0.9 ? neutral : cool;
  return h < 0.55 ? warm : h < 0.82 ? neutral : h < 0.92 ? cool : tv * 0.5;
}

// Room kinds for interior mapping.
#define ROOM_HOME 0
#define ROOM_OFFICE 1
#define ROOM_SHOP 2
#define ROOM_LOBBY 3
#define ROOM_PARKING 4
#define ROOM_WAREHOUSE 5

/*
 * Interior mapping: radiance seen through a window into a box room.
 * p: entry point in room coordinates (x in [0, size.x], y in [0, size.y], z = 0 at the glass)
 * d: ray direction (d.z > 0 goes into the room). rnd: per-room randoms.
 * lit: 0 (dark) .. 1 (lights on), lc: light colour. Returns emitted radiance.
 */
vec3 bRoom(vec3 p, vec3 d, vec3 size, vec3 rnd, int kind, float lit, vec3 lc) {
  vec3 ad = max(abs(d), vec3(1e-4));
  float tx = (d.x > 0.0 ? size.x - p.x : p.x) / ad.x;
  float ty = (d.y > 0.0 ? size.y - p.y : p.y) / ad.y;
  float tz = (size.z - p.z) / ad.z;
  float t = min(min(tx, ty), tz);
  vec3 h = p + d * t;
  vec3 wallC = mix(vec3(0.78, 0.74, 0.66), vec3(0.62, 0.7, 0.74), rnd.x);
  if (rnd.y > 0.8) wallC = vec3(0.86, 0.84, 0.8);
  vec3 floorC = rnd.z < 0.5 ? vec3(0.42, 0.28, 0.17) : vec3(0.62, 0.6, 0.56);
  vec3 ceilC = vec3(0.9, 0.89, 0.86);
  vec3 c;
  float lampBoost = 0.0;
  if (kind == ROOM_OFFICE) { wallC = vec3(0.66, 0.66, 0.66); floorC = vec3(0.3, 0.31, 0.33); }
  else if (kind == ROOM_SHOP) { wallC = mix(vec3(0.9, 0.88, 0.84), vec3(0.8, 0.86, 0.9), rnd.x); floorC = vec3(0.78, 0.76, 0.72); }
  else if (kind == ROOM_LOBBY) { wallC = mix(vec3(0.55, 0.4, 0.28), vec3(0.8, 0.76, 0.68), rnd.x); floorC = vec3(0.82, 0.8, 0.76); }
  else if (kind == ROOM_PARKING) { wallC = vec3(0.5, 0.5, 0.49); floorC = vec3(0.34, 0.34, 0.34); ceilC = vec3(0.55, 0.55, 0.54); }
  else if (kind == ROOM_WAREHOUSE) { wallC = vec3(0.35, 0.35, 0.34); floorC = vec3(0.3, 0.3, 0.3); ceilC = vec3(0.25, 0.25, 0.26); }
  if (t == tz) {
    c = wallC;
    if (kind == ROOM_HOME) {
      // furniture silhouette and a picture
      float fx = abs(h.x - size.x * (0.35 + 0.3 * rnd.y));
      if (h.y < 0.55 + 0.35 * rnd.z && fx < size.x * 0.28) c = mix(vec3(0.18, 0.14, 0.12), vec3(0.35, 0.3, 0.42), rnd.x);
      else if (h.y > 1.35 && h.y < 1.85 && abs(h.x - size.x * 0.5) < 0.35) c = vec3(0.3, 0.35, 0.45) * (0.6 + rnd.z);
    } else if (kind == ROOM_OFFICE) {
      if (h.y < 0.76 && h.y > 0.7) c = vec3(0.2);
      else if (h.y < 1.2 && fract(h.x / 1.6) < 0.08) c = vec3(0.25);
    } else if (kind == ROOM_SHOP) {
      // shelves with products
      float band = fract(h.y / 0.45);
      vec3 prod = 0.25 + 0.65 * bh32(vec2(floor(h.x / 0.22), floor(h.y / 0.45)) + rnd.xy * 17.0);
      if (h.y < 2.1) c = band < 0.12 ? vec3(0.85) : prod;
    } else if (kind == ROOM_LOBBY) {
      if (h.y < 1.1 && abs(h.x - size.x * 0.5) < size.x * 0.25) c = vec3(0.2, 0.16, 0.13);
    } else if (kind == ROOM_PARKING) {
      // the far side of the deck is open: daylight
      if (h.y > 1.0 && h.y < size.y - 0.35) c = mix(uBldSkyH, vec3(0.6), 0.5) * 1.6;
      else if (h.y < 1.4) c = 0.15 + 0.6 * bh32(vec2(floor(h.x / 2.6), rnd.x * 31.0));
    } else if (kind == ROOM_WAREHOUSE) {
      if (h.y < 4.0 && fract(h.x / 2.8) > 0.15) c = mix(vec3(0.35, 0.3, 0.22), vec3(0.2, 0.25, 0.4), bh21(vec2(floor(h.x / 2.8), floor(h.y / 1.3))));
    }
  } else if (t == tx) {
    c = wallC * 0.88;
    if (kind == ROOM_SHOP && h.y < 2.1) c = mix(c, 0.3 + 0.5 * bh32(vec2(floor(h.z / 0.25), floor(h.y / 0.45)) + rnd.yz * 9.0), fract(h.y / 0.45) < 0.12 ? 0.0 : 0.8);
  } else if (d.y > 0.0) {
    c = ceilC;
    if (kind == ROOM_OFFICE || kind == ROOM_SHOP) {
      vec2 g = fract(h.xz / vec2(1.2, 1.8));
      if (g.x < 0.5 && g.y < 0.33) { c = vec3(1.0); lampBoost = 1.0; }
    } else if (kind == ROOM_PARKING) {
      if (fract(h.z / 3.0) < 0.06 && abs(fract(h.x / 2.6) - 0.5) < 0.3) { c = vec3(1.0); lampBoost = 1.0; }
    } else {
      float lr = length(h.xz - vec2(size.x * 0.5, size.z * 0.45));
      if (lr < 0.22) { c = vec3(1.0); lampBoost = 1.0; }
    }
  } else {
    c = floorC;
    if (kind == ROOM_PARKING && abs(fract(h.x / 2.6) - 0.5) > 0.47) c = vec3(0.8, 0.8, 0.7);
  }
  // corner darkening
  vec3 e = min(h, size - h);
  float edge = min(min(e.x, e.y), size.z - h.z + 0.5);
  float ao = 0.65 + 0.35 * smoothstep(0.0, 0.8, edge);
  // daylight falls off with depth; lamps light the room evenly with a hotspot below the lamp
  float day = uBldDay * (0.05 + 0.1 * exp(-h.z * 0.35));
  vec3 lamp = vec3(0.0);
  if (lit > 0.0) {
    float fall;
    if (kind == ROOM_OFFICE || kind == ROOM_SHOP || kind == ROOM_PARKING) fall = 0.75;
    else fall = 0.35 + 0.65 / (1.0 + dot(h - vec3(size.x * 0.5, size.y - 0.3, size.z * 0.45), h - vec3(size.x * 0.5, size.y - 0.3, size.z * 0.45)) * 0.25);
    lamp = lc * lit * fall;
  }
  vec3 dimNight = kind == ROOM_PARKING ? vec3(0.0) : vec3(0.004, 0.005, 0.008) * uBldNight;
  return c * ao * (vec3(day) + lamp + dimNight) + lampBoost * lc * lit * 2.5;
}
`;
