// Detail shader: roofs (membrane, gravel, barrel tile, metal, shingles), parapets, ledges,
// awnings, rooftop equipment, glass, signs (atlas text with neon / backlight at night),
// helipads, parking stalls, pools, pavers, wood, solar panels and light strips.

import { AWNING_STRIPE_COLORS, SIGN_COLORS } from '../../world/buildings/constants';

const vec3s = (list: readonly (readonly number[])[]): string => list.map((c) => `vec3(${c.map((v) => v.toFixed(3)).join(', ')})`).join(', ');

export const DETAIL_VERT_PARS = /* glsl */ `
attribute vec4 detA;
flat varying vec4 vDetA;
varying vec2 vBldUv;
varying vec3 vBldWPos;
varying vec3 vBldWNrm;
`;

export const DETAIL_VERT_MAIN = /* glsl */ `
vBldUv = uv;
vBldWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vBldWNrm = normalize(mat3(modelMatrix) * objectNormal);
vDetA = detA;
`;

export const DETAIL_FRAG_PARS = /* glsl */ `
uniform sampler2D uBldSignAtlas;
flat varying vec4 vDetA;
varying vec2 vBldUv;
varying vec3 vBldWPos;
varying vec3 vBldWNrm;

const vec3 BLD_SIGN_COLS[8] = vec3[8](${vec3s(SIGN_COLORS)});
const vec3 BLD_STRIPE_COLS[4] = vec3[4](${vec3s(AWNING_STRIPE_COLORS)});

vec3 dNw;

BldS bldDetail(vec3 base) {
  int surf = int(vDetA.x + 0.5);
  float seed = vDetA.y;
  float p1 = vDetA.z;
  float p2 = vDetA.w;
  vec2 uv = vBldUv;
  vec2 fw = max(fwidth(uv), vec2(1e-4));
  float fp = max(fw.x, fw.y);
  vec3 N = normalize(vBldWNrm);
  // cotangent frame from screen derivatives (works for any surface orientation)
  vec3 dp1 = dFdx(vBldWPos);
  vec3 dp2 = dFdy(vBldWPos);
  vec2 duv1 = dFdx(uv);
  vec2 duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N);
  vec3 dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-20));
  T *= invmax;
  B *= invmax;
  vec3 V = normalize(cameraPosition - vBldWPos);
  BldS s = bNew(base);
  vec3 n = vec3(0.0, 0.0, 1.0);
  float det = 1.0 - smoothstep(0.015, 0.06, fp);
  bool vertical = abs(N.y) < 0.5;
  float big = bn2(vBldWPos.xz * 0.07 + seed * 13.0);

  if (surf == DS_PLAIN || surf == DS_CONCRETE) {
    float f = 1.0 - smoothstep(0.008, 0.04, fp);
    if (f > 0.0) {
      vec2 p = uv * 7.0;
      float n0 = bn2(p);
      n.xy += (vec2(bn2(p + vec2(0.23, 0.0)), bn2(p + vec2(0.0, 0.23))) - n0) * 0.8 * f;
      s.alb *= 1.0 + (n0 - 0.5) * 0.08 * f;
    }
    s.alb *= 0.94 + 0.1 * big;
    if (surf == DS_CONCRETE) s.alb *= 0.9 + 0.2 * bn2f(uv * 1.3 + seed * 3.0, fp * 1.3);
    if (vertical) s.alb *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 1.2, uv.y)) * step(-2.0, uv.y);
    s.rough = 0.92;
  } else if (surf == DS_MEMBRANE || surf == DS_GRAVEL) {
    float stain = bn2(uv * 0.18 + seed * 7.0);
    s.alb *= 0.88 + 0.2 * stain;
    s.alb *= 1.0 - 0.12 * smoothstep(0.6, 0.72, bn2(uv * 0.5 + seed * 3.0)) * (1.0 - smoothstep(0.72, 0.8, bn2(uv * 0.5 + seed * 3.0)));
    if (surf == DS_MEMBRANE) {
      float seam = bLine((fract(uv.x / 1.83 + 0.5) - 0.5) * 1.83, 0.03, fw.x);
      s.alb *= 1.0 - 0.1 * seam;
      s.rough = 0.75;
    } else {
      float g = bn2f(uv * 28.0, fp * 28.0);
      s.alb *= 0.8 + 0.4 * g;
      s.rough = 0.97;
    }
  } else if (surf == DS_TILE) {
    float colW = 0.235;
    float courseH = 0.33;
    float cu = uv.x / colW;
    float ci = floor(cu);
    float fu = fract(cu);
    float row = floor(uv.y / courseH);
    float fv = fract(uv.y / courseH);
    bool cap = mod(ci, 2.0) > 0.5;
    float prof = sin(fu * 3.14159265);
    vec3 tint = vec3(1.0) + (bh32(vec2(ci, row) + seed * 7.0) - 0.5) * vec3(0.22, 0.2, 0.18);
    float burnt = step(0.9, bh21(vec2(ci * 1.7, row) + seed));
    float shade = cap ? 0.72 + 0.4 * prof : 0.62 + 0.25 * prof;
    shade *= 1.0 - 0.35 * smoothstep(0.82, 1.0, fv) * (cap ? 0.6 : 1.0);
    shade *= 0.9 + 0.1 * smoothstep(0.0, 0.08, fv);
    vec3 tile = s.alb * tint * mix(1.0, 0.6, burnt);
    s.alb = mix(s.alb * 0.8, tile * shade, det);
    n.x += cos(fu * 3.14159265) * (cap ? 0.75 : -0.45) * det;
    n.y += (smoothstep(0.85, 1.0, fv) * -0.6 + (1.0 - smoothstep(0.0, 0.06, fv)) * 0.5) * det;
    // dirt and lichen streaks running down the slope, bleaching near the ridge
    float streaks = bn2(vec2(uv.x * 1.8 + seed * 5.0, uv.y * 0.25));
    s.alb *= 1.0 - 0.25 * smoothstep(0.5, 0.85, streaks);
    s.alb = mix(s.alb, s.alb * vec3(0.8, 0.85, 0.75), smoothstep(0.65, 0.9, bn2(uv * 0.4 + seed)) * 0.5);
    s.rough = 0.8;
  } else if (surf == DS_METAL_ROOF) {
    bool seam = fract(seed * 5.3) < 0.4;
    float P = seam ? 0.45 : 0.19;
    float ph = uv.x / P * 6.2831853;
    float rf = 1.0 - smoothstep(0.02, 0.08, fp);
    if (seam) {
      float d = (fract(uv.x / P + 0.5) - 0.5) * P;
      float rib = bLine(d, 0.03, fw.x);
      s.alb *= 1.0 - 0.15 * rib + 0.05 * rib;
      n.x += sign(d) * (1.0 - smoothstep(0.0, 0.03, abs(d))) * 0.6 * rf;
    } else {
      n.x += sin(ph) * 0.55 * rf;
      s.alb *= 1.0 - 0.08 * (0.5 + 0.5 * cos(ph)) * rf - 0.04 * (1.0 - rf);
    }
    float lum = dot(base, vec3(0.3333));
    float rust = smoothstep(0.5, 0.8, bn2(vec2(uv.x * 0.9, uv.y * 0.35) + seed * 11.0)) * step(lum, 0.25);
    s.alb = mix(s.alb, vec3(0.28, 0.13, 0.06), rust * 0.6);
    s.alb *= 0.9 + 0.2 * big;
    s.metal = 0.55 * (1.0 - rust);
    s.rough = 0.42 + 0.4 * rust;
  } else if (surf == DS_SHINGLE) {
    float row = floor(uv.y / 0.14);
    float tx = uv.x / 0.33 + mod(row, 2.0) * 0.5;
    float tab = floor(tx);
    float fv = fract(uv.y / 0.14);
    vec3 tint = vec3(1.0) + (bh21(vec2(tab, row) + seed) - 0.5) * 0.25;
    float line = max(bLine((fract(tx) - 0.5) * 0.33, 0.01, fw.x), bLine(fv * 0.14, 0.012, fw.y));
    s.alb = mix(s.alb * 0.95, s.alb * tint * (1.0 - 0.45 * line) * (0.9 + 0.2 * bn2f(uv * 40.0, fp * 40.0)), det);
    n.y += (1.0 - smoothstep(0.0, 0.1, fv)) * 0.5 * det;
    s.rough = 0.95;
  } else if (surf == DS_AWNING) {
    if (p1 > 0.0) {
      vec3 sc = BLD_STRIPE_COLS[int(clamp(p2, 0.0, 3.0))];
      float st = bPulse(uv.x, fw.x, 2.0 * p1, 0.0, p1);
      s.alb = mix(s.alb, sc, st);
    }
    s.alb *= 0.92 + 0.08 * bn2f(uv * vec2(30.0, 60.0), fp * 60.0);
    s.rough = 0.85;
    // sunlight glowing through the fabric seen from below
    if (dot(N, V) > 0.0 && N.y < -0.2) s.emis += base * 0.12 * uBldDay;
  } else if (surf == DS_EQUIPMENT) {
    if (vertical) {
      float louv = bLine((fract(uv.y / 0.06) - 0.5) * 0.06, 0.02, fw.y);
      s.alb *= 1.0 - 0.35 * louv;
      n.y -= 0.4 * louv * det;
    } else if (p1 > 0.5) {
      float r = length(uv);
      float fan = bFill(r - 0.36, fp);
      float spokes = step(0.5, fract(atan(uv.y, uv.x) * 1.2732)) * det;
      s.alb = mix(s.alb, vec3(0.08) + 0.12 * spokes, fan);
      s.alb *= 1.0 - 0.5 * bLine(r - 0.38, 0.03, fp);
    }
    s.metal = 0.35;
    s.rough = 0.5;
  } else if (surf == DS_GLASS) {
    s.alb = vec3(0.07, 0.09, 0.1);
    s.metal = 0.9;
    s.rough = 0.06;
    s.glass = 1.0;
  } else if (surf == DS_SIGN) {
    float a = texture(uBldSignAtlas, uv).r;
    vec3 tc = BLD_SIGN_COLS[int(clamp(p1, 0.0, 7.0))];
    int mode = int(p2 + 0.5);
    float paint = mode == SIGN_PAINTED ? 0.85 + 0.15 * bn2(vBldWPos.xz * 3.0 + vBldWPos.y * 2.0) : 1.0;
    s.alb = mix(s.alb, tc, a * paint);
    s.rough = mode == SIGN_PAINTED ? 0.85 : 0.4;
    if (mode == SIGN_NEON) {
      s.emis += tc * a * (0.12 + 5.0 * uBldNight);
    } else if (mode == SIGN_BACKLIT) {
      s.emis += (base * 0.5 * (1.0 - a) + tc * a * 1.6) * uBldNight * 2.0;
    }
  } else if (surf == DS_HELIPAD) {
    float r = length(uv);
    float ring = bLine(r - 7.2, 0.45, fp);
    vec2 a = abs(uv);
    float hBars = bFill(max(abs(a.x - 1.6) - 0.35, a.y - 3.0), fp);
    float hCross = bFill(max(a.x - 1.3, a.y - 0.35), fp);
    s.alb = mix(s.alb, vec3(0.85, 0.7, 0.1), ring);
    s.alb = mix(s.alb, vec3(0.92), max(hBars, hCross));
    float ang = atan(uv.y, uv.x);
    float lamp = bFill(length(vec2(r - 8.6, (fract(ang * 2.546) - 0.5) * 8.6 * 0.39)) - 0.12, fp);
    s.emis += vec3(0.3, 1.0, 0.4) * lamp * uBldNight * 6.0;
    s.rough = 0.8;
  } else if (surf == DS_PARKING) {
    float sw = max(p1, 2.0);
    s.alb *= 0.85 + 0.25 * bn2f(uv * 9.0, fp * 9.0) + 0.1 * (big - 0.5);
    float rowV = mod(uv.y, 17.6);
    float inStall = step(0.4, rowV) * step(rowV, 5.6) + step(12.0, rowV) * step(rowV, 17.2);
    float line = bLine((fract(uv.x / sw + 0.5) - 0.5) * sw, 0.1, fw.x) * inStall;
    float oil = smoothstep(0.62, 0.7, bn2(uv * 1.2 + seed)) * inStall;
    s.alb *= 1.0 - 0.25 * oil;
    s.alb = mix(s.alb, vec3(0.8, 0.8, 0.76), line);
    s.rough = 0.88;
  } else if (surf == DS_POOL) {
    vec3 Vt = vec3(dot(V, T), dot(V, B), dot(V, N));
    float depth = 1.4;
    vec2 fl = uv - Vt.xy / max(Vt.z, 0.15) * depth;
    vec2 tl = abs(fract(fl / 0.25) - 0.5) * 0.25;
    float line = max(bLine(tl.x, 0.012, fp), bLine(tl.y, 0.012, fp)) * det;
    vec3 floorC = mix(vec3(0.35, 0.78, 0.86), vec3(0.95), line * 0.6);
    float path = depth / max(Vt.z, 0.15);
    vec3 absorb = exp(-vec3(0.45, 0.09, 0.06) * path);
    float caust = bn2(fl * 3.0 + seed) * bn2(fl * 5.3 - seed);
    s.alb = floorC * absorb * (0.85 + 0.5 * caust * det);
    n.xy += (vec2(bn2(uv * 1.7), bn2(uv * 1.7 + 3.1)) - 0.5) * 0.08;
    s.rough = 0.04;
    s.glass = 0.6;
    s.emis += vec3(0.15, 0.7, 0.85) * uBldNight * 0.35 * absorb;
  } else if (surf == DS_PAVERS) {
    float row = floor(uv.y / 0.1);
    float bx = uv.x / 0.2 + mod(row, 2.0) * 0.5;
    float m = max(bLine((fract(bx) - 0.5) * 0.2, 0.008, fw.x), bLine((fract(uv.y / 0.1) - 0.5) * 0.1, 0.008, fw.y));
    vec3 tint = vec3(1.0) + (bh21(vec2(floor(bx), row) + seed) - 0.5) * 0.18;
    s.alb = mix(s.alb * 0.95, s.alb * tint * (1.0 - 0.3 * m), det);
    s.rough = 0.85;
  } else if (surf == DS_WOOD) {
    float bd = uv.x / 0.14;
    float gap = bLine((fract(bd) - 0.5) * 0.14, 0.012, fw.x);
    s.alb *= (0.85 + 0.3 * mix(bh21(vec2(floor(bd), seed)), 0.5, 1.0 - det)) * (1.0 - 0.5 * gap);
    s.alb *= 0.9 + 0.1 * bn2f(vec2(uv.x * 20.0, uv.y * 1.5), fp * 20.0);
    s.rough = 0.8;
  } else if (surf == DS_SOLAR) {
    vec2 c = abs(fract(uv / vec2(0.165)) - 0.5) * 0.165;
    float grid = max(bLine(c.x, 0.01, fp), bLine(c.y, 0.01, fp));
    s.alb = mix(vec3(0.03, 0.05, 0.12), vec3(0.6), grid * 0.6);
    s.metal = 0.6;
    s.rough = 0.25;
  } else if (surf == DS_LED) {
    s.alb = mix(base, vec3(1.0), 0.45);
    s.emis += base * (0.25 + 4.5 * uBldNight);
    s.rough = 0.4;
  } else if (surf == DS_DARK) {
    s.rough = 0.85;
  } else if (surf == DS_CANOPY) {
    vec2 c = (fract(uv / 1.6) - 0.5) * 1.6;
    float spot = bFill(length(c) - 0.07, fp);
    s.alb = mix(s.alb, vec3(0.95), spot);
    s.emis += vec3(1.0, 0.8, 0.55) * (spot * 8.0 + 0.25 * exp(-dot(c, c) * 3.0)) * uBldNight;
    s.rough = 0.8;
  }
  dNw = normalize(T * n.x + B * n.y + N * max(n.z, 0.2));
  if (dot(dNw, N) < 0.2) dNw = N;
  return s;
}
`;
