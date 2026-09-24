// Facade shader: draws every wall of every building from the per-vertex facade
// parameters (see FACADE_ATTRS in src/world/buildings/constants.ts). Near the camera it
// ray-marches window recesses (parallax reveals with sun shadows), maps fake rooms
// behind the glass and draws frames, blinds, AC units, doors and storefronts; farther
// away it switches to exact box-filtered window coverage so the grid never aliases, and
// at night lit windows cluster hierarchically instead of flickering.

import { CROWN_COLORS } from '../../world/buildings/constants';

const crown = CROWN_COLORS.map((c) => `vec3(${c.map((v) => v.toFixed(3)).join(', ')})`).join(', ');

export const FACADE_VERT_PARS = /* glsl */ `
attribute vec4 facA;
attribute vec4 facB;
attribute vec4 facC;
attribute vec4 facD;
flat varying vec4 vFacA;
flat varying vec4 vFacB;
flat varying vec4 vFacC;
flat varying vec4 vFacD;
varying vec2 vBldUv;
varying vec3 vBldWPos;
varying vec3 vBldWNrm;
`;

export const FACADE_VERT_MAIN = /* glsl */ `
vBldUv = uv;
vBldWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vBldWNrm = normalize(mat3(modelMatrix) * objectNormal);
vFacA = facA;
vFacB = facB;
vFacC = facC;
vFacD = facD;
`;

export const FACADE_FRAG_PARS = /* glsl */ `
flat varying vec4 vFacA;
flat varying vec4 vFacB;
flat varying vec4 vFacC;
flat varying vec4 vFacD;
varying vec2 vBldUv;
varying vec3 vBldWPos;
varying vec3 vBldWNrm;

const vec3 BLD_CROWN[8] = vec3[8](${crown});

// decoded facade parameters (set once per fragment)
float bF; float bBay; float bG; float bTop; float bWW; float bWH; float bSill; float bDep; float bSeed;
int bPat; int bGnd; int bGlassT; int bSurf; int bOcc; int bCrown; int bFlags;
vec3 bTrim; vec3 bWallC;
vec2 bFw; float bFp; float bDet;
vec3 bVt; vec3 bLt; float bLitF;
vec3 bNw;

bool bHas(int f) { return (bFlags & f) != 0; }

vec3 bGlassF0() {
  if (bGlassT == GLASS_TEAL) return vec3(0.10, 0.19, 0.20);
  if (bGlassT == GLASS_BLUE) return vec3(0.11, 0.17, 0.30);
  if (bGlassT == GLASS_BRONZE) return vec3(0.21, 0.15, 0.10);
  if (bGlassT == GLASS_SILVER) return vec3(0.42, 0.45, 0.48);
  if (bGlassT == GLASS_DARK) return vec3(0.07, 0.075, 0.08);
  if (bGlassT == GLASS_GREEN) return vec3(0.09, 0.19, 0.13);
  if (bGlassT == GLASS_LOWE) return vec3(0.09, 0.13, 0.16);
  return vec3(0.04);
}

float bGlassTrans() {
  if (bGlassT == GLASS_CLEAR) return 0.9;
  if (bGlassT == GLASS_LOWE) return 0.65;
  if (bGlassT == GLASS_SILVER) return 0.18;
  if (bGlassT == GLASS_DARK) return 0.3;
  if (bGlassT == GLASS_BRONZE) return 0.35;
  return 0.5;
}

// Glass surface over "behind" radiance (interior, blinds...). jit tilts the pane normal.
void bToGlass(inout BldS s, vec3 behind, vec2 jit, bool clearGlass) {
  bool cl = clearGlass || bGlassT == GLASS_CLEAR;
  vec3 f0 = cl ? vec3(0.04) : bGlassF0();
  s.alb = cl ? vec3(0.012) : f0;
  s.metal = cl ? 0.0 : 0.92;
  s.rough = 0.03;
  s.n = normalize(vec3(jit, 1.0));
  float F = bFresnel(bVt.z, cl ? 0.04 : dot(f0, vec3(0.3333)));
  s.emis = behind * (cl ? 0.9 : bGlassTrans()) * (1.0 - F);
  s.glass = 1.0;
  s.ao = 1.0;
}

// ---------------------------------------------------------------- lit windows
float bBlockLit(vec2 cid, float level) {
  vec2 bid = floor(cid / exp2(level));
  return step(bh21(bid * vec2(1.13, 1.71) + bSeed * 131.0 + 3.1 + level * 17.0), bLitF);
}
// Lit state of a window cell; when cells get smaller than ~3 px, lit windows are grouped in
// 2^k blocks (whole apartments / office floors) so the night skyline stays stable.
float bLitAt(vec2 cid, float cellPx) {
  if (uBldNight <= 0.0) return 0.0;
  float L = clamp(log2(3.0 / max(cellPx, 1e-3)), 0.0, 5.0);
  float l0 = floor(L);
  float a = bBlockLit(cid, l0);
  float b = bBlockLit(cid, l0 + 1.0);
  return mix(a, b, L - l0) * uBldNight;
}

// ---------------------------------------------------------------- wall surface
BldS bWall(vec2 uv) {
  BldS s = bNew(bWallC);
  float big = bn2(uv * vec2(0.045, 0.07) + bSeed * 37.0);
  float mid = bn2f(uv * 0.55 + bSeed * 11.0, bFp * 0.55);
  s.alb *= 0.93 + 0.11 * big + 0.06 * (mid - 0.5);
  vec3 n = vec3(0.0, 0.0, 1.0);
  if (bSurf == WSURF_STUCCO) {
    float f = 1.0 - smoothstep(0.008, 0.04, bFp);
    if (f > 0.0) {
      vec2 p = uv * 7.0;
      float n0 = bn2(p);
      n.xy += (vec2(bn2(p + vec2(0.23, 0.0)), bn2(p + vec2(0.0, 0.23))) - n0) * 0.9 * f;
      s.alb *= 1.0 + (n0 - 0.5) * 0.07 * f;
    }
    s.rough = 0.93;
  } else if (bSurf == WSURF_CONCRETE) {
    vec2 pp = uv / vec2(2.4, 1.2);
    vec2 fpp = abs(fract(pp) - 0.5) * vec2(2.4, 1.2);
    float jf = 1.0 - smoothstep(0.015, 0.06, bFp);
    float joint = max(bLine(1.2 - fpp.x, 0.015, bFw.x), bLine(0.6 - fpp.y, 0.015, bFw.y));
    s.alb *= 1.0 - 0.18 * joint * jf;
    vec2 th = (fract(uv / 0.6 + 0.5) - 0.5) * 0.6;
    s.alb *= 1.0 - 0.3 * bFill(length(th) - 0.018, bFp) * (1.0 - smoothstep(0.006, 0.02, bFp));
    s.alb *= 0.88 + 0.22 * bn2f(uv * 1.1 + bSeed * 5.0, bFp * 1.1);
    s.rough = 0.95;
  } else if (bSurf == WSURF_METAL) {
    float ph = uv.x / 0.2 * 6.2831853;
    float rf = 1.0 - smoothstep(0.02, 0.07, bFp);
    n.x += sin(ph) * 0.5 * rf;
    s.alb *= 1.0 - 0.07 * (0.5 + 0.5 * cos(ph)) * rf - 0.035 * (1.0 - rf);
    float seam = bLine((fract(uv.x / 0.914 + 0.5) - 0.5) * 0.914, 0.02, bFw.x);
    s.alb *= 1.0 - 0.15 * seam;
    s.rough = 0.5;
    s.metal = 0.3;
    float rust = smoothstep(0.6, 0.85, bn2(uv * vec2(0.7, 0.2) + bSeed * 3.0)) * (1.0 - smoothstep(0.0, 3.5, uv.y));
    s.alb = mix(s.alb, vec3(0.3, 0.16, 0.08), rust * 0.45);
  } else if (bSurf == WSURF_SIDING) {
    float bd = uv.y / 0.19;
    float fb = fract(bd);
    float sf = 1.0 - smoothstep(0.012, 0.05, bFp);
    n.y += (0.5 - fb) * 0.6 * sf;
    s.alb *= 1.0 - (1.0 - smoothstep(0.0, 0.14, fb)) * 0.4 * sf - 0.05 * (1.0 - sf);
    s.alb *= 0.9 + 0.2 * mix(bh21(vec2(floor(bd), bSeed * 17.0)), 0.5, 1.0 - sf);
    s.alb *= 0.9 + 0.1 * bn2f(vec2(uv.x * 2.5, floor(bd) * 1.7), bFp * 2.5);
    s.rough = 0.88;
  } else if (bSurf == WSURF_PANEL) {
    vec2 fpp = abs(fract(uv / vec2(1.5, 1.2) + 0.5) - 0.5) * vec2(1.5, 1.2);
    float joint = max(bLine(fpp.x, 0.012, bFw.x), bLine(fpp.y, 0.012, bFw.y));
    s.alb *= 1.0 - 0.35 * joint;
    s.rough = 0.38;
    s.metal = 0.45;
  } else if (bSurf == WSURF_WOOD) {
    float bd = uv.x / 0.14;
    s.alb *= 0.85 + 0.3 * mix(bh21(vec2(floor(bd), bSeed)), 0.5, smoothstep(0.02, 0.06, bFp));
    s.alb *= 1.0 - 0.3 * bLine((fract(bd) - 0.5) * 0.14, 0.01, bFw.x);
    s.rough = 0.8;
  }
  // weathering: splash dirt near the ground, rain streaks from the roof line, sun bleaching
  float gd = (1.0 - smoothstep(0.0, 1.5, uv.y)) * (0.55 + 0.45 * bn2f(vec2(uv.x * 1.7, uv.y * 3.0) + bSeed * 13.0, bFp * 3.0));
  s.alb *= 1.0 - 0.32 * gd;
  float streak = bn2f(vec2(uv.x * 2.3 + bSeed * 9.0, uv.y * 0.1), bFp * 2.3);
  float nearTop = 1.0 - smoothstep(0.5, 7.0, bTop - uv.y);
  s.alb *= 1.0 - 0.13 * smoothstep(0.5, 0.9, streak) * (0.35 + 0.65 * nearTop);
  s.n = normalize(n);
  return s;
}

// ---------------------------------------------------------------- recessed openings
// Signed distance to an opening centred at 0 with half size hs. shape: 0 rect, 1 arched head, 2 circle.
float bShapeSD(vec2 p, vec2 hs, int shape) {
  if (shape == 2) return length(p) - min(hs.x, hs.y);
  if (shape == 1) {
    float ya = hs.y - hs.x;
    if (p.y > ya) return length(p - vec2(0.0, ya)) - hs.x;
  }
  vec2 d = abs(p) - hs;
  return max(d.x, d.y);
}

vec2 bShapeGrad(vec2 p, vec2 hs, int shape) {
  if (shape == 2) return normalize(p + 1e-5);
  if (shape == 1) {
    float ya = hs.y - hs.x;
    if (p.y > ya) return normalize(p - vec2(0.0, ya) + 1e-5);
  }
  vec2 d = abs(p) - hs;
  return d.x > d.y ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y));
}

// Follow the view ray into an opening of depth dep. Returns true if it reaches the back plane
// (q = back point); otherwise q is where it hits the reveal at depth td with normal rn.
bool bRecess(vec2 p, vec2 hs, int shape, float dep, out vec2 q, out vec3 rn, out float td) {
  float vz = max(bVt.z, 0.06);
  vec2 off = -bVt.xy / vz;
  q = p + off * dep;
  rn = vec3(0.0, 0.0, 1.0);
  td = dep;
  if (bShapeSD(q, hs, shape) <= 0.0) return true;
  float lo = 0.0;
  float hi = dep;
  for (int i = 0; i < 6; i++) {
    float m = 0.5 * (lo + hi);
    if (bShapeSD(p + off * m, hs, shape) <= 0.0) lo = m; else hi = m;
  }
  td = 0.5 * (lo + hi);
  q = p + off * td;
  rn = vec3(-bShapeGrad(q, hs, shape), 0.0);
  return false;
}

// Is a point at depth td inside an opening reached by the sun (1) or shaded by the wall (0)?
float bRecessShadow(vec2 e, float td, vec2 hs, int shape) {
  if (bLt.z <= 0.02) return 1.0;
  vec2 lp = e + bLt.xy / bLt.z * td;
  return bFill(bShapeSD(lp, hs, shape), 0.02 + td * 0.05);
}

// Average look of window glass (far away): dim interior by day, lit rooms at night.
void bGlassAvg(inout BldS s, float cov, float lit, vec3 lc, bool clearGlass) {
  if (cov <= 0.0) return;
  BldS g = s;
  vec3 behind = vec3(0.07, 0.066, 0.06) * uBldDay + lit * lc * 0.55 + vec3(0.003, 0.004, 0.007) * uBldNight;
  bToGlass(g, behind, vec2(0.0), clearGlass);
  s = bMix(s, g, cov);
}

// ---------------------------------------------------------------- punched window (near)
// p: point relative to the window centre; hs: half size; cid: window id; shape; layout of
// the sash (0 slider, 1 casement grid, 2 deco lights, 3 fixed, 4 cross); fh: floor height.
void bPunched(inout BldS s, vec2 p, vec2 hs, vec2 cid, int shape, int lay, float fh, float ground, float lit, vec3 lc) {
  float w = bFp;
  vec3 r = bh32(cid + bSeed * 71.3);
  vec3 r2 = bh32(cid * 1.37 + bSeed * 13.1 + 7.0);
  float sw = bPat == PAT_MED ? 0.1 : bPat == PAT_SIDING ? 0.07 : 0.055;
  float sdO = bShapeSD(p, hs, shape);
  float open = bFill(sdO, w);
  float surround = bFill(bShapeSD(p, hs + sw, shape), w) * (1.0 - open);
  float sillM = bRect(p, bFw, vec2(-hs.x - sw - 0.05, -hs.y - sw - 0.07), vec2(hs.x + sw + 0.05, -hs.y - sw + 0.004));
  // rain streaks and the sill shadow below the window
  float below = -hs.y - sw - 0.07 - p.y;
  if (below > 0.0 && abs(p.x) < hs.x + 0.12) {
    float str = bn2(vec2(p.x * 9.0 + r.x * 20.0, 0.3)) * (1.0 - smoothstep(0.0, 1.7, below)) * (1.0 - smoothstep(hs.x - 0.2, hs.x + 0.12, abs(p.x)));
    s.alb *= 1.0 - 0.2 * str;
    s.ao *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.1, below));
  }
  if (surround > 0.0) {
    s.alb = mix(s.alb, bTrim, surround);
    s.rough = mix(s.rough, 0.75, surround);
  }
  if (sillM > 0.0) {
    s.alb = mix(s.alb, bTrim * 1.04, sillM);
    s.n = normalize(mix(s.n, vec3(0.0, 0.85, 0.5), sillM));
  }
  // through-wall AC unit under some windows (older buildings)
  if (bHas(FLAG_AC) && r2.x < 0.3 && fh > 2.5) {
    vec2 ac = p - vec2((r2.y - 0.5) * hs.x, -hs.y - 0.55);
    float sd = max(abs(ac.x) - 0.34, abs(ac.y) - 0.21);
    float m = bFill(sd, w);
    if (m > 0.0) {
      vec3 acC = mix(vec3(0.6, 0.58, 0.53), vec3(0.8, 0.79, 0.75), r2.z);
      acC *= 1.0 - 0.3 * bLine((fract(ac.y / 0.035) - 0.5) * 0.035, 0.012, bFw.y);
      float top = smoothstep(0.16, 0.21, ac.y);
      s.alb = mix(s.alb, acC, m);
      s.n = normalize(mix(s.n, vec3(0.0, top * 0.9, 1.0), m));
      s.rough = mix(s.rough, 0.45, m);
      s.metal = mix(s.metal, 0.3, m);
    }
    float sb = -0.21 - ac.y;
    if (sb > 0.0 && abs(ac.x) < 0.36) {
      s.alb *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.16, sb));
      s.alb *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 1.4, sb)) * bn2(vec2(ac.x * 12.0, 0.5));
    }
  }
  // louvred shutters beside the window
  if (bHas(FLAG_SHUTTERS) && shape != 2) {
    float sx = abs(p.x) - hs.x - sw - 0.02;
    float sm = bBox(sx, bFw.x, 0.0, hs.x * 0.95) * bBox(p.y, bFw.y, -hs.y, hs.y);
    if (sm > 0.0) {
      vec3 shC = mix(bTrim, vec3(0.2, 0.35, 0.3), 0.5);
      float louv = fract(p.y / 0.05);
      shC *= 0.8 + 0.3 * mix(louv, 0.5, smoothstep(0.01, 0.03, w));
      s.alb = mix(s.alb, shC, sm);
      s.n = normalize(mix(s.n, vec3(0.0, (louv - 0.5) * 0.6, 1.0), sm * (1.0 - smoothstep(0.01, 0.03, w))));
    }
  }
  if (open <= 0.0) return;
  BldS o = s;
  vec2 q;
  vec3 rn;
  float td;
  bool back = bRecess(p, hs, shape, bDep, q, rn, td);
  if (!back) {
    o.alb = bWallC * 0.9;
    o.n = rn;
    o.ao = 1.0 - 0.45 * td / max(bDep, 0.01);
    o.sh = bRecessShadow(q, td, hs, shape);
    o.rough = 0.9;
    o.metal = 0.0;
    o.emis = vec3(0.0);
    o.glass = 0.0;
  } else {
    float sdq = bShapeSD(q, hs, shape);
    float frame = 1.0 - bFill(sdq + 0.05, w);
    float mull = 0.0;
    if (lay == 0) mull = bLine(q.x, 0.05, w);
    else if (lay == 1) {
      mull = max(bLine(q.x, 0.045, w), bLine(q.y - hs.y * 0.3, 0.045, w));
      mull = max(mull, max(bLine((fract(q.x / (hs.x * 0.667) + 0.5) - 0.5) * hs.x * 0.667, 0.022, w), bLine((fract((q.y + hs.y) / (hs.y * 0.43)) - 0.5) * hs.y * 0.43, 0.022, w)));
    } else if (lay == 2) mull = max(bLine(q.x, 0.04, w), max(bLine(q.y - hs.y / 3.0, 0.03, w), bLine(q.y + hs.y / 3.0, 0.03, w)));
    else if (lay == 4) mull = max(bLine(q.x, 0.04, w), bLine(q.y + hs.y * 0.1, 0.04, w));
    float solid = max(frame, mull);
    // what is behind the glass: blinds, curtains or the room
    vec3 behind;
    float blind = r.x < 0.45 ? r.y * 0.9 : r.x < 0.55 ? 1.0 : 0.0;
    float by = hs.y - blind * 2.0 * hs.y;
    bool curtain = r2.z > 0.7;
    float cw = 0.18 + 0.2 * r2.y;
    if (q.y > by) {
      vec3 bc = mix(vec3(0.86, 0.84, 0.79), vec3(0.72, 0.66, 0.55), r.z);
      bc *= 1.0 - 0.28 * bLine((fract(q.y / 0.03) - 0.5) * 0.03, 0.007, bFw.y);
      behind = bc * (uBldDay * 0.32 + lit * lc * 0.5 + 0.004 * uBldNight);
    } else if (curtain && abs(q.x) > hs.x * (1.0 - 2.0 * cw)) {
      vec3 cc = mix(vec3(0.8, 0.74, 0.6), vec3(0.62, 0.32, 0.3), r2.x);
      cc *= 0.88 + 0.12 * sin(q.x * 45.0) * (1.0 - smoothstep(0.01, 0.03, w));
      behind = cc * (uBldDay * 0.24 + lit * lc * 0.42);
    } else {
      vec3 rp = vec3(q.x + 0.5 * bBay, q.y + bSill + hs.y, 0.0);
      vec3 rd = vec3(-bVt.x, -bVt.y, max(bVt.z, 0.05));
      int kind = bOcc == OCC_OFFICE ? ROOM_OFFICE : ROOM_HOME;
      behind = bRoom(rp, normalize(rd), vec3(bBay, fh - 0.3, bOcc == OCC_OFFICE ? 9.0 : 4.5), r2, kind, lit, lc);
    }
    BldS g = o;
    bToGlass(g, behind, (r.xy - 0.5) * 0.025, false);
    g.sh = bRecessShadow(q, bDep, hs, shape);
    BldS f = o;
    f.alb = mix(bTrim, vec3(0.9), 0.25);
    f.rough = 0.5;
    f.metal = 0.0;
    f.n = vec3(0.0, 0.0, 1.0);
    f.emis = vec3(0.0);
    f.glass = 0.0;
    f.sh = g.sh;
    f.ao = 0.85;
    o = bMix(g, f, solid);
  }
  if (bHas(FLAG_BARS) && (ground > 0.5 || r2.y < 0.35)) {
    float bars = max(bLine((fract(p.x / 0.12) - 0.5) * 0.12, 0.022, w), max(bLine(p.y - hs.y + 0.08, 0.03, w), bLine(p.y + hs.y - 0.08, 0.03, w)));
    o.alb = mix(o.alb, vec3(0.04), bars);
    o.emis *= 1.0 - bars;
    o.glass *= 1.0 - bars;
    o.metal = mix(o.metal, 0.3, bars);
    o.rough = mix(o.rough, 0.55, bars);
    o.n = normalize(mix(o.n, vec3(0.0, 0.0, 1.0), bars));
  }
  s = bMix(s, o, open);
}

// ---------------------------------------------------------------- patterns
void bDecoExtras(inout BldS s, vec2 uv, float cx, float cy, float fh, vec2 hs) {
  // vertical fluting centred on the piers between windows
  if (bHas(FLAG_DIVIDERS)) {
    float dx = abs(abs(cx) - 0.5 * bBay);
    float fl = 0.0;
    for (int k = 0; k < 3; k++) fl = max(fl, bLine(dx - float(k - 1) * 0.13, 0.05, bFw.x));
    fl *= step(dx, 0.3);
    s.alb *= 1.0 - 0.2 * fl;
    s.n = normalize(s.n + vec3(sign(cx) * 0.4 * fl * (1.0 - smoothstep(0.02, 0.06, bFp)), 0.0, 0.0));
  }
  // chevron relief panel between a window head and the next sill
  float y0 = bSill + 2.0 * hs.y + 0.4;
  float y1 = fh + bSill - 0.12;
  if (fract(bSeed * 3.7) > 0.45 && y1 - y0 > 0.25) {
    float m = bRect(vec2(cx, cy), bFw, vec2(-hs.x, y0), vec2(hs.x, y1));
    if (m > 0.0) {
      float ch = fract((abs(cx) * 1.2 + cy) / 0.22);
      float det = 1.0 - smoothstep(0.02, 0.06, bFp);
      s.alb = mix(s.alb, mix(bTrim, bTrim * (0.8 + 0.3 * ch), det), m * 0.85);
      s.n = normalize(mix(s.n, vec3(0.0, (ch - 0.5) * 0.8, 1.0), m * det));
    }
  }
}

void bCurtain(inout BldS s, vec2 uv, float fi, float cy, float fh, float yF) {
  float vis0 = bSill;
  float vis1 = bSill + bWH;
  float mw = bHas(FLAG_FINS) ? 0.16 : 0.075;
  float mull = bPulse(uv.x + 0.5 * mw, bFw.x, bBay, 0.0, mw);
  float tr = max(bPulse(yF - vis0 + 0.04, bFw.y, fh, 0.0, 0.08), bPulse(yF - vis1 + 0.04, bFw.y, fh, 0.0, 0.08));
  float visCov = bPulse(yF, bFw.y, fh, vis0, vis1);
  float roomW = bBay * 4.0;
  float room = floor(uv.x / roomW);
  vec2 rid = vec2(room, fi);
  float lit = bLitAt(rid, min(roomW, fh) / bFp);
  vec3 lc = bLightCol(bh21(rid + bSeed * 5.0), OCC_OFFICE) * (0.75 + 0.5 * bh21(rid + 9.0));
  vec3 behind = vec3(0.05, 0.05, 0.048) * uBldDay + lit * lc * 0.6;
  if (bDet > 0.0 && cy >= vis0 && cy < vis1) {
    vec3 rp = vec3(uv.x - room * roomW, cy, 0.3);
    vec3 rd = normalize(vec3(-bVt.x, -bVt.y, max(bVt.z, 0.05)));
    behind = mix(behind, bRoom(rp, rd, vec3(roomW, vis1 + 0.05, 12.0), bh32(rid + bSeed * 3.0), ROOM_OFFICE, lit, lc), bDet);
  }
  vec2 pane = vec2(floor(uv.x / bBay), floor(yF / fh * 2.0));
  vec2 jit = (bh22(pane + bSeed * 3.0) - 0.5) * 0.035 * (1.0 - smoothstep(0.15, 0.5, bFp / min(bBay, 1.0)));
  BldS vis = s;
  bToGlass(vis, behind, jit, false);
  BldS spd = s;
  if (bHas(FLAG_SPANDREL_PANEL)) {
    spd.alb = bWallC;
    spd.metal = 0.5;
    spd.rough = 0.35;
    spd.n = vec3(jit * 0.5, 1.0);
  } else {
    bToGlass(spd, vec3(0.0), jit, false);
    spd.alb *= 0.85;
  }
  BldS g = bMix(spd, vis, visCov);
  BldS f = s;
  f.alb = bTrim;
  f.metal = 0.6;
  f.rough = 0.35;
  f.n = vec3(0.0, 0.0, 1.0);
  f.emis = vec3(0.0);
  f.glass = 0.0;
  float frame = bSat(mull + tr * (1.0 - mull));
  s = bMix(g, f, frame);
  if (bHas(FLAG_FINS)) s.ao *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.35, abs(fract(uv.x / bBay + 0.5) - 0.5) * bBay));
}

void bRibbon(inout BldS s, vec2 uv, float fi, float cy, float fh, float yF, float bandCov) {
  float mull = bPulse(uv.x + 0.03, bFw.x, bBay, 0.0, 0.06);
  float roomW = bBay * 2.0;
  vec2 rid = vec2(floor(uv.x / roomW), fi);
  float lit = bLitAt(rid, min(roomW, fh) / bFp);
  vec3 lc = bLightCol(bh21(rid + bSeed * 5.0), bOcc);
  BldS g = s;
  vec3 behind = vec3(0.06) * uBldDay + lit * lc * 0.55;
  if (bDet > 0.0 && cy >= bSill && cy < bSill + bWH) {
    vec3 rp = vec3(uv.x - rid.x * roomW, cy, 0.1);
    vec3 rd = normalize(vec3(-bVt.x, -bVt.y, max(bVt.z, 0.05)));
    behind = mix(behind, bRoom(rp, rd, vec3(roomW, fh - 0.3, bOcc == OCC_OFFICE ? 9.0 : 5.0), bh32(rid + bSeed * 3.0), bOcc == OCC_OFFICE ? ROOM_OFFICE : ROOM_HOME, lit, lc), bDet);
    // shadow under the head of the band
    float head = bSill + bWH - cy;
    behind *= 0.8 + 0.2 * smoothstep(0.0, 0.3, head);
  }
  bToGlass(g, behind, (bh22(rid) - 0.5) * 0.02, false);
  float headSh = 1.0 - (1.0 - smoothstep(0.0, 0.25, bSill + bWH - cy)) * bDet * step(bSill, cy);
  g.sh = headSh;
  BldS f = s;
  f.alb = bTrim;
  f.rough = 0.45;
  f.metal = 0.3;
  f.n = vec3(0.0, 0.0, 1.0);
  f.emis = vec3(0.0);
  f.glass = 0.0;
  g = bMix(g, f, mull);
  s = bMix(s, g, bandCov);
}

void bBalcony(inout BldS s, vec2 uv, float bi, float fi, float cx, float cy, float fh, float yF) {
  bool egg = bPat == PAT_EGGCRATE;
  bool div = egg || bHas(FLAG_DIVIDERS);
  float slabT = egg ? 0.34 : 0.28;
  float railH = 1.07;
  float fin = egg ? 0.24 : 0.0;
  vec2 cid = vec2(bi, fi);
  float lit = bLitAt(cid, min(bBay, fh) / bFp);
  vec3 lc = bLightCol(bh21(cid + bSeed * 5.0), bOcc) * (0.8 + 0.4 * bh21(cid + 2.0));
  // far look: slab bands over dark recessed balconies
  float slabCov = bPulse(yF, bFw.y, fh, 0.0, slabT);
  float finCov = egg ? bPulse(uv.x + 0.5 * fin, bFw.x, bBay, 0.0, fin) : 0.0;
  float solid = bSat(slabCov + finCov - slabCov * finCov);
  BldS far = s;
  far.alb = bWallC * 0.38 + bGlassF0() * 0.3;
  far.rough = 0.35;
  far.metal = 0.2;
  far.glass = 0.5;
  far.emis = vec3(0.03, 0.03, 0.028) * uBldDay + lit * lc * 0.42;
  far = bMix(far, s, solid);
  if (bDet <= 0.0) { s = far; return; }
  BldS d = s;
  if (cy < slabT) {
    // slab edge with a drip groove
    d.alb *= 1.0 - 0.35 * bLine(cy - 0.035, 0.02, bFw.y);
    d.rough = 0.7;
  } else if (egg && abs(cx) > 0.5 * bBay - 0.5 * fin) {
    d.rough = 0.8;
  } else {
    vec3 ro = vec3(cx + 0.5 * bBay, cy - slabT, 0.0);
    vec3 rd = normalize(vec3(-bVt.x, -bVt.y, max(bVt.z, 0.05)));
    float H = fh - slabT;
    float W = bBay;
    float D = max(bDep, 0.5);
    float ty = rd.y > 0.0 ? (H - ro.y) / max(rd.y, 1e-4) : ro.y / max(-rd.y, 1e-4);
    float tz = D / rd.z;
    float x0 = 0.5 * fin + 0.02;
    float x1 = W - 0.5 * fin - 0.02;
    float tx = div ? (rd.x > 0.0 ? (x1 - ro.x) / max(rd.x, 1e-4) : (ro.x - x0) / max(-rd.x, 1e-4)) : 1e5;
    float t = min(min(tx, ty), tz);
    vec3 h = ro + rd * t;
    BldS b = bNew(bWallC);
    b.rough = 0.8;
    vec3 rr = bh32(cid + bSeed * 19.0);
    if (t == tz) {
      if (h.y < bWH) {
        // sliding doors with frames, sheer curtains, the apartment behind
        float frame = max(bLine((fract(h.x / (W * 0.5)) - 0.5) * W * 0.5, 0.06, bFp), bLine(h.y - bWH + 0.03, 0.06, bFp));
        vec3 behindR;
        if (rr.x < 0.45 && abs(h.x - W * 0.5) > W * (0.1 + 0.3 * rr.y)) {
          behindR = mix(vec3(0.85, 0.83, 0.78), vec3(0.75, 0.72, 0.64), rr.z) * (uBldDay * 0.25 + lit * lc * 0.45);
        } else {
          behindR = bRoom(vec3(h.x, h.y, 0.0), rd, vec3(W, H - 0.2, 6.0), rr, ROOM_HOME, lit, lc);
        }
        bToGlass(b, behindR, (rr.xy - 0.5) * 0.02, false);
        BldS fr = b;
        fr.alb = bTrim;
        fr.rough = 0.4;
        fr.metal = 0.5;
        fr.n = vec3(0.0, 0.0, 1.0);
        fr.emis = vec3(0.0);
        fr.glass = 0.0;
        b = bMix(b, fr, frame);
      } else {
        b.alb = bWallC * 0.95;
      }
    } else if (t == ty) {
      if (rd.y < 0.0) {
        b.alb = mix(vec3(0.72, 0.7, 0.66), bWallC, 0.3);
        b.n = vec3(0.0, 1.0, 0.0);
      } else {
        b.alb = bWallC * 0.95;
        b.n = vec3(0.0, -1.0, 0.0);
        float spot = 1.0 - smoothstep(0.08, 0.14, length(h.xz - vec2(W * 0.5, D * 0.5)));
        b.emis += spot * lit * lc * 3.0;
      }
    } else {
      b.alb = bWallC * 0.92;
      b.n = vec3(rd.x > 0.0 ? -1.0 : 1.0, 0.0, 0.0);
    }
    // sun and sky occlusion inside the balcony
    b.ao = 0.5 + 0.5 * (1.0 - h.z / D);
    if (bLt.z > 0.02) {
      vec2 lp = h.xy + bLt.xy / bLt.z * h.z;
      float inside = step(0.0, lp.y) * step(lp.y, H);
      if (div) inside *= step(x0, lp.x) * step(lp.x, x1);
      b.sh = inside;
    }
    // railing at the front
    float ry = cy - slabT;
    if (ry < railH) {
      if (bHas(FLAG_METAL_RAIL)) {
        float pk = max(bLine((fract(cx / 0.11) - 0.5) * 0.11, 0.02, bFp), bLine(ry - railH + 0.03, 0.05, bFp));
        b.alb = mix(b.alb, bTrim * 0.6, pk);
        b.emis *= 1.0 - pk;
        b.glass *= 1.0 - pk;
        b.metal = mix(b.metal, 0.5, pk);
        b.n = normalize(mix(b.n, vec3(0.0, 0.0, 1.0), pk));
        b.sh = mix(b.sh, 1.0, pk);
      } else {
        b.alb *= vec3(0.78, 0.86, 0.86);
        b.emis *= vec3(0.8, 0.88, 0.88);
        b.rough = mix(b.rough, 0.15, 0.5);
        b.glass = max(b.glass, 0.25);
        float rail = bLine(ry - railH + 0.025, 0.05, bFp);
        b.alb = mix(b.alb, bTrim, rail);
        b.metal = mix(b.metal, 0.6, rail);
        b.n = normalize(mix(b.n, vec3(0.0, 0.0, 1.0), rail));
      }
    }
    d = b;
  }
  s = bMix(far, d, bDet);
}

void bGarageDeck(inout BldS s, vec2 uv, float bi, float fi, float cx, float cy, float fh, float cov) {
  float lit = uBldNight * 0.9;
  vec3 lc = vec3(0.8, 0.88, 1.0);
  BldS g = s;
  g.alb = vec3(0.06);
  g.rough = 0.95;
  g.n = vec3(0.0, 0.0, 1.0);
  g.emis = vec3(0.02) * uBldDay + lit * lc * 0.28;
  if (bDet > 0.0) {
    vec3 ro = vec3(cx + 0.5 * bBay, cy, 0.0);
    vec3 rd = normalize(vec3(-bVt.x, -bVt.y, max(bVt.z, 0.05)));
    vec3 inner = bRoom(ro, rd, vec3(bBay, fh, max(bDep, 6.0)), bh32(vec2(bi, fi) + bSeed), ROOM_PARKING, lit, lc);
    g.emis = mix(g.emis, inner, bDet);
    g.alb = mix(g.alb, vec3(0.02), bDet);
  }
  s = bMix(s, g, cov);
  if (bHas(FLAG_FINS)) {
    float fin = bPulse(uv.x, bFw.x, 0.3, 0.0, 0.06);
    s.alb = mix(s.alb, bTrim, fin * cov);
    s.emis *= 1.0 - fin * cov;
  }
}

void bModern(inout BldS s, vec2 uv, float bi, float fi, float cx, float cy, float fh) {
  float r = bh21(vec2(bi, fi) + bSeed * 17.0);
  if (r < 0.64) {
    float hx = 0.5 * bBay - 0.06;
    float cov = bBox(cx, bFw.x, -hx, hx) * bBox(cy, bFw.y, bSill, bSill + bWH);
    vec2 cid = vec2(bi, fi);
    float lit = bLitAt(cid, min(bBay, fh) / bFp);
    vec3 lc = bLightCol(bh21(cid + bSeed), bOcc);
    BldS g = s;
    vec3 behind = vec3(0.08) * uBldDay + lit * lc * 0.6;
    if (bDet > 0.0) {
      vec3 rd = normalize(vec3(-bVt.x, -bVt.y, max(bVt.z, 0.05)));
      behind = mix(behind, bRoom(vec3(cx + 0.5 * bBay, cy, 0.0), rd, vec3(bBay, fh - 0.25, 7.0), bh32(cid + bSeed), ROOM_HOME, lit, lc), bDet);
    }
    bToGlass(g, behind, (bh22(cid) - 0.5) * 0.02, false);
    float fr = max(bLine(abs(cx) - hx + 0.03, 0.05, bFp), max(bLine(cx - hx * (bh21(cid + 3.0) - 0.5), 0.05, bFp), bLine(cy - bSill - bWH + 0.03, 0.05, bFp)));
    BldS f = s;
    f.alb = vec3(0.05);
    f.metal = 0.4;
    f.rough = 0.4;
    f.n = vec3(0.0, 0.0, 1.0);
    f.emis = vec3(0.0);
    f.glass = 0.0;
    g = bMix(g, f, fr);
    s = bMix(s, g, cov);
  } else if (r > 0.86) {
    float slat = bLine((fract(uv.x / 0.09) - 0.5) * 0.09, 0.02, bFw.x);
    s.alb = mix(bTrim * (0.9 + 0.2 * bh21(vec2(floor(uv.x / 0.09), 1.0))), vec3(0.05), slat * 0.7);
    s.rough = 0.75;
  }
}

void bLouver(inout BldS s, vec2 uv) {
  float ph = fract(uv.y / 0.15);
  float det = 1.0 - smoothstep(0.03, 0.08, bFp);
  float blade = smoothstep(0.0, 0.1, ph) * (1.0 - smoothstep(0.7, 0.8, ph));
  float k = mix(0.55, blade * 0.9 + 0.1, det);
  s.alb = mix(vec3(0.05), bWallC, k);
  s.n = normalize(mix(vec3(0.0, 0.0, 1.0), vec3(0.0, -0.55, 0.85), blade * det));
  float mull = bPulse(uv.x + 0.04, bFw.x, bBay, 0.0, 0.08);
  s.alb = mix(s.alb, bWallC * 0.7, mull);
  s.metal = 0.3;
  s.rough = 0.55;
}

void bScreenWall(inout BldS s, vec2 uv) {
  vec2 gp = uv / 0.55;
  float row = floor(gp.y);
  gp.x += mod(row, 2.0) * 0.5;
  vec2 f = (fract(gp) - 0.5) * 0.55;
  float hole = bFill(length(f) - 0.17, bFp);
  float det = 1.0 - smoothstep(0.04, 0.1, bFp);
  float cov = mix(0.3, hole, det);
  s.alb = mix(s.alb, vec3(0.03, 0.03, 0.035), cov);
  s.ao *= 1.0 - 0.3 * cov;
  if (det > 0.0) s.n = normalize(s.n + vec3(-f * 3.0 * (1.0 - hole) * step(length(f), 0.24) * det, 0.0));
}

void bMural(inout BldS s, vec2 uv) {
  float edge = bBox(uv.y, bFw.y, 0.7, bTop - 0.5);
  if (edge <= 0.0) return;
  vec2 m = uv * 0.1 + bSeed * 7.0;
  float w1 = bn2(m * 1.3);
  float w2 = bn2(m * 2.7 + 5.2);
  float band = fract(uv.x * 0.06 + uv.y * 0.035 + w1 * 1.2 + w2 * 0.3 + bSeed * 3.0);
  vec3 c = 0.5 + 0.5 * cos(6.2831853 * (vec3(band) * 0.8 + vec3(0.0, 0.33, 0.67) + bSeed * 2.0));
  c = pow(c, vec3(1.8)) * 0.9;
  float sun = 1.0 - smoothstep(2.2, 2.35, length(uv - vec2(4.0 + 6.0 * fract(bSeed * 5.0), bTop * 0.6)));
  c = mix(c, vec3(1.0, 0.75, 0.2), sun);
  s.alb = mix(s.alb, c, 0.92 * edge);
  s.rough = 0.8;
}

void bIndustrialWall(inout BldS s, vec2 uv) {
  if (bSurf != WSURF_METAL) {
    float j = bPulse(uv.x + 0.02, bFw.x, bBay, 0.0, 0.04);
    s.alb *= 1.0 - 0.4 * j;
    float reveal = bLine(uv.y - bTop * 0.72, 0.03, bFw.y) + bLine(uv.y - bTop * 0.78, 0.03, bFw.y);
    s.alb *= 1.0 - 0.25 * reveal * step(0.5, fract(bSeed * 9.1));
  }
  if (bHas(FLAG_SIGNBAND)) {
    float band = bBox(uv.y, bFw.y, bTop - 1.9, bTop - 1.25);
    s.alb = mix(s.alb, bTrim, band);
  }
  if (bWW > 0.0) {
    float cov = bPulse(uv.x, bFw.x, bBay, 0.5 * (bBay - bWW), 0.5 * (bBay + bWW)) * bBox(uv.y, bFw.y, bSill, bSill + bWH);
    float bi = floor(uv.x / bBay);
    float lit = step(bh21(vec2(bi, 4.0) + bSeed * 7.0), 0.4) * uBldNight;
    BldS g = s;
    bToGlass(g, vec3(0.02) * uBldDay + lit * vec3(0.9, 0.92, 1.0) * 0.5, vec2(0.0), true);
    float fr = bPulse(uv.x + 0.03, bFw.x, bBay * 0.25, 0.0, 0.06);
    g.alb = mix(g.alb, vec3(0.2), fr);
    g.metal *= 1.0 - fr;
    g.emis *= 1.0 - fr;
    s = bMix(s, g, cov);
  }
}

// ---------------------------------------------------------------- upper floors
void bUpperFloors(inout BldS s, vec2 uv, float fi, float cy, float fh, float ground) {
  float bi = floor(uv.x / bBay);
  float cx = uv.x - (bi + 0.5) * bBay;
  // continuous floor coordinate for exact filtering across floors
  float yF = ground > 0.5 ? cy : uv.y - bG;
  float fhP = ground > 0.5 ? max(fh, 1.0) : bF;
  if (bPat == PAT_PUNCHED || bPat == PAT_DECO || bPat == PAT_MED || bPat == PAT_SIDING) {
    if (bWW <= 0.0) return;
    vec2 hs = vec2(bWW, bWH) * 0.5;
    int shape = 0;
    if (bPat == PAT_MED && bHas(FLAG_ARCHED)) shape = 1;
    if (bPat == PAT_DECO && bHas(FLAG_PORTHOLE)) {
      shape = 2;
      hs = vec2(min(hs.x, hs.y) * 0.85);
    }
    int lay = bPat == PAT_MED ? 1 : bPat == PAT_DECO ? 2 : bPat == PAT_SIDING ? 4 : 0;
    vec2 cid = vec2(bi, fi);
    float cellPx = min(bBay, fh) / bFp;
    float lit = bLitAt(cid, cellPx);
    vec3 lc = bLightCol(bh21(cid + bSeed * 5.0), bOcc) * (0.75 + 0.5 * bh21(cid * 3.1 + bSeed));
    float yc = bSill + hs.y;
    float cov = bPulse(uv.x, bFw.x, bBay, 0.5 * bBay - hs.x, 0.5 * bBay + hs.x) *
      (ground > 0.5 ? bBox(cy, bFw.y, yc - hs.y, yc + hs.y) : bPulse(yF, bFw.y, fhP, yc - hs.y, yc + hs.y));
    if (shape == 2) cov *= 0.785;
    if (shape == 1) cov *= 0.95;
    BldS avg = s;
    if (bPat == PAT_DECO) bDecoExtras(avg, uv, cx, cy, fh, hs);
    bGlassAvg(avg, cov, lit, lc, false);
    if (bDet > 0.0) {
      BldS d = s;
      if (bPat == PAT_DECO) bDecoExtras(d, uv, cx, cy, fh, hs);
      bPunched(d, vec2(cx, cy - yc), hs, cid, shape, lay, fh, ground, lit, lc);
      s = bMix(avg, d, bDet);
    } else {
      s = avg;
    }
  } else if (bPat == PAT_CURTAIN) {
    bCurtain(s, uv, fi, cy, fh, yF);
  } else if (bPat == PAT_RIBBON) {
    float band = ground > 0.5 ? bBox(cy, bFw.y, bSill, bSill + bWH) : bPulse(yF, bFw.y, fhP, bSill, bSill + bWH);
    bRibbon(s, uv, fi, cy, fh, yF, band);
  } else if (bPat == PAT_BALCONY || bPat == PAT_EGGCRATE) {
    bBalcony(s, uv, bi, fi, cx, cy, fh, yF);
  } else if (bPat == PAT_GARAGE) {
    float hx = 0.5 * bWW;
    float cov = bPulse(uv.x, bFw.x, bBay, 0.5 * bBay - hx, 0.5 * bBay + hx) *
      (ground > 0.5 ? bBox(cy, bFw.y, bSill, bSill + bWH) : bPulse(yF, bFw.y, fhP, bSill, bSill + bWH));
    bGarageDeck(s, uv, bi, fi, cx, cy, fh, cov);
  } else if (bPat == PAT_MODERN) {
    bModern(s, uv, bi, fi, cx, cy, fh);
  } else if (bPat == PAT_LOUVER) {
    bLouver(s, uv);
  } else if (bPat == PAT_SCREEN) {
    bScreenWall(s, uv);
  } else if (bPat == PAT_INDUSTRIAL) {
    bIndustrialWall(s, uv);
  } else if (bPat == PAT_BLANK) {
    if (bHas(FLAG_MURAL)) bMural(s, uv);
  }
}

// ---------------------------------------------------------------- ground floor
// A door leaf (or glass door) in a recess; p relative to the door's bottom centre.
void bDoor(inout BldS s, vec2 p, float dw, float dh, bool glassDoor, bool arched, float lit, vec3 lc) {
  vec2 hs = vec2(0.5 * dw, 0.5 * dh);
  vec2 c = p - vec2(0.0, hs.y);
  int shape = arched ? 1 : 0;
  float surround = bFill(bShapeSD(c, hs + 0.1, shape), bFp) * (1.0 - bFill(bShapeSD(c, hs, shape), bFp));
  s.alb = mix(s.alb, bTrim, surround);
  float m = bFill(bShapeSD(c, hs, shape), bFp);
  if (m <= 0.0) return;
  BldS d = s;
  vec2 q;
  vec3 rn;
  float td;
  bool back = bRecess(c, hs, shape, 0.14, q, rn, td);
  if (!back) {
    d.alb = bWallC * 0.85;
    d.n = rn;
    d.ao = 0.8;
    d.sh = bRecessShadow(q, td, hs, shape);
  } else if (glassDoor) {
    float fr = 1.0 - bFill(bShapeSD(q, hs, shape) + 0.07, bFp);
    fr = max(fr, bLine(q.y + hs.y - 1.05, 0.05, bFp));
    if (dw > 1.4) fr = max(fr, bLine(q.x, 0.06, bFp));
    vec3 rd = normalize(vec3(-bVt.x, -bVt.y, max(bVt.z, 0.05)));
    vec3 behind = bRoom(vec3(q.x + 3.0, q.y + hs.y, 0.0), rd, vec3(6.0, 3.2, 8.0), bh32(p + bSeed), ROOM_SHOP, lit, lc);
    bToGlass(d, behind, vec2(0.0), true);
    d.alb = mix(d.alb, vec3(0.12, 0.12, 0.13), fr);
    d.metal = mix(d.metal, 0.6, fr);
    d.rough = mix(d.rough, 0.35, fr);
    d.emis *= 1.0 - fr;
    d.glass *= 1.0 - fr;
  } else {
    vec3 wood = fract(bSeed * 23.0) < 0.55 ? vec3(0.23, 0.13, 0.07) : bTrim * 0.75;
    vec2 pq = abs(vec2(abs(q.x) - hs.x * 0.5, q.y - hs.y * 0.15)) - vec2(hs.x * 0.32, hs.y * 0.38);
    float panel = bLine(max(pq.x, pq.y), 0.02, bFp);
    d.alb = wood * (1.0 - 0.3 * panel);
    d.rough = 0.6;
    d.n = vec3(0.0, 0.0, 1.0);
    d.sh = bRecessShadow(q, 0.14, hs, shape);
    float knob = bFill(length(q - vec2(hs.x * 0.75 * (dw > 1.4 ? 0.1 : 1.0), -hs.y * 0.05)) - 0.035, bFp);
    d.alb = mix(d.alb, vec3(0.7, 0.6, 0.3), knob);
    d.metal = mix(d.metal, 1.0, knob);
    if (dw > 1.4) d.alb *= 1.0 - 0.6 * bLine(q.x, 0.015, bFp);
  }
  s = bMix(s, d, m);
}

// Wall lamp that glows at night.
void bLamp(inout BldS s, vec2 p) {
  float m = bFill(max(abs(p.x) - 0.09, abs(p.y) - 0.14), bFp);
  s.alb = mix(s.alb, vec3(0.08), m * 0.6);
  float glow = bFill(length(p) - 0.07, bFp);
  s.emis += vec3(1.0, 0.72, 0.4) * glow * uBldNight * 6.0;
  s.emis += vec3(1.0, 0.72, 0.4) * uBldNight * 0.35 * exp(-dot(p, p) * 6.0) * (1.0 - m);
}

void bStorefront(inout BldS s, vec2 uv, float bi, float cx, float cy) {
  float gTop = bG < 3.9 ? bG - 0.55 : min(bG - 0.95, 3.4);
  float pier = bBay >= 2.4 ? 0.34 : 0.07;
  float bulk = 0.45;
  float hx = 0.5 * bBay - 0.5 * pier;
  vec3 rr = bh32(vec2(bi, 7.7) + bSeed * 29.0);
  bool door = bGnd == GND_SHOPDOOR || (bHas(FLAG_DOOR_ALT) ? mod(bi, 2.0) > 0.5 : (bBay >= 2.4 ? rr.x < 0.28 : rr.x < 0.08));
  float dW = bBay >= 4.6 ? 1.8 : min(1.0, bBay * 0.45);
  float dX = bBay >= 2.4 ? (rr.y - 0.5) * max(0.0, hx - 0.5 * dW - 0.15) * 1.8 : 0.0;
  float dH = min(2.3, gTop - 0.05);
  float glassCov = bPulse(uv.x, bFw.x, bBay, 0.5 * pier, bBay - 0.5 * pier) * bBox(cy, bFw.y, bulk, gTop);
  float doorCov = door ? bRect(vec2(cx - dX, cy), bFw, vec2(-0.5 * dW, 0.0), vec2(0.5 * dW, dH)) : 0.0;
  float open = max(glassCov, doorCov);
  // shops light up at night (some close), security shutters come down
  float lit = step(bh21(vec2(bi, 3.3) + bSeed * 41.0), max(uBldOcc.w, 0.12)) * uBldNight;
  vec3 lc = bLightCol(rr.z, OCC_RETAIL) * 1.35;
  float shut = 0.0;
  if (bGnd == GND_SHUTTER) {
    float nightShut = step(0.25, rr.z) * smoothstep(0.3, 0.8, uBldNight) * (1.0 - lit);
    float dayShut = rr.x < 0.55 ? 0.0 : rr.x < 0.78 ? 0.3 + 0.5 * rr.y : 1.0;
    shut = max(dayShut * (1.0 - uBldNight), nightShut);
    if (door && rr.x < 0.78) shut = min(shut, 0.4);
  }
  // transom / painted sign band and bulkhead
  if (cy > gTop) {
    if (bHas(FLAG_SIGNBAND)) s.alb = mix(s.alb, bTrim, bBox(cy, bFw.y, gTop + 0.12, bG - 0.1));
    s.alb *= 1.0 - 0.35 * bLine(cy - gTop - 0.04, 0.08, bFw.y);
  }
  float bulkM = bBox(cy, bFw.y, 0.0, bulk) * bPulse(uv.x, bFw.x, bBay, 0.5 * pier, bBay - 0.5 * pier) * (1.0 - doorCov);
  s.alb = mix(s.alb, bTrim * 0.7, bulkM);
  s.rough = mix(s.rough, 0.45, bulkM);
  BldS avg = s;
  bGlassAvg(avg, open * (1.0 - shut), lit * 1.6, lc, true);
  if (shut > 0.0) {
    float sc = open * shut;
    avg.alb = mix(avg.alb, vec3(0.55, 0.56, 0.57), sc);
    avg.emis *= 1.0 - sc;
    avg.metal = mix(avg.metal, 0.4, sc);
    avg.rough = mix(avg.rough, 0.5, sc);
    avg.glass *= 1.0 - sc;
    avg.n = normalize(mix(avg.n, vec3(0.0, 0.0, 1.0), sc));
  }
  if (bDet <= 0.0) { s = avg; return; }
  BldS d = s;
  float inGlass = bBox(cx, bFw.x, -hx, hx) * bBox(cy, bFw.y, bulk, gTop);
  if (inGlass > 0.0) {
    BldS g = d;
    vec3 rd = normalize(vec3(-bVt.x, -bVt.y, max(bVt.z, 0.05)));
    vec3 behind = bRoom(vec3(cx + hx, cy, 0.0), rd, vec3(2.0 * hx, bG - 0.35, 7.0 + 4.0 * rr.y), rr, ROOM_SHOP, lit * 1.6, lc);
    bToGlass(g, behind, (rr.xy - 0.5) * 0.015, true);
    float fr = max(bLine(abs(cx) - hx + 0.03, 0.06, bFp), max(bLine(cy - gTop + 0.03, 0.06, bFp), bLine(cy - bulk - 0.03, 0.06, bFp)));
    if (2.0 * hx > 2.8) fr = max(fr, bLine(cx - dX * 0.3, 0.05, bFp));
    g.alb = mix(g.alb, mix(vec3(0.1), bTrim * 0.5, 0.4), fr);
    g.metal = mix(g.metal, 0.6, fr);
    g.rough = mix(g.rough, 0.35, fr);
    g.emis *= 1.0 - fr;
    g.glass *= 1.0 - fr;
    g.n = normalize(mix(g.n, vec3(0.0, 0.0, 1.0), fr));
    d = bMix(d, g, inGlass);
  }
  if (door) {
    bDoor(d, vec2(cx - dX, cy), dW, dH, true, false, lit, lc);
  }
  if (shut > 0.0) {
    float top = gTop - shut * gTop;
    float sm = bBox(cx, bFw.x, -hx, hx) * bBox(cy, bFw.y, top, gTop);
    if (sm > 0.0) {
      float rib = fract(cy / 0.075);
      vec3 sc = vec3(0.56, 0.57, 0.58) * (0.85 + 0.25 * rib);
      float graf = smoothstep(0.55, 0.62, bn2(vec2(cx, cy) * 1.4 + bSeed * 33.0 + bi * 7.0)) * step(0.5, rr.y);
      sc = mix(sc, 0.2 + 0.7 * bh32(vec2(bi, floor(cy * 2.0))), graf * 0.7);
      d.alb = mix(d.alb, sc, sm);
      d.metal = mix(d.metal, 0.4, sm);
      d.rough = mix(d.rough, 0.5, sm);
      d.emis *= 1.0 - sm;
      d.glass *= 1.0 - sm;
      d.n = normalize(mix(d.n, vec3(0.0, (rib - 0.5) * 0.7, 1.0), sm));
    }
    // shutter housing
    float hsg = bBox(cx, bFw.x, -hx, hx) * bBox(cy, bFw.y, gTop, gTop + 0.3);
    d.alb = mix(d.alb, vec3(0.5, 0.51, 0.52), hsg);
  }
  s = bMix(avg, d, bDet);
}

void bGroundFloor(inout BldS s, vec2 uv) {
  float cy = uv.y;
  float bi = floor(uv.x / bBay);
  float cx = uv.x - (bi + 0.5) * bBay;
  vec3 rr = bh32(vec2(bi, 11.0) + bSeed * 19.0);
  if (bPat == PAT_INDUSTRIAL) bIndustrialWall(s, uv);
  if (bGnd == GND_SAME) {
    bUpperFloors(s, uv, -1.0, cy, bG, 1.0);
  } else if (bGnd == GND_SHOP || bGnd == GND_SHOPDOOR || bGnd == GND_SHUTTER) {
    bStorefront(s, uv, bi, cx, cy);
  } else if (bGnd == GND_LOBBY) {
    float top = bG - 0.4;
    float cov = bBox(cy, bFw.y, 0.05, top);
    float lit = uBldNight * 0.95;
    vec3 lc = vec3(1.0, 0.78, 0.5) * 1.3;
    BldS g = s;
    vec3 behind = vec3(0.08) * uBldDay + lit * lc * 0.6;
    if (bDet > 0.0) {
      vec3 rd = normalize(vec3(-bVt.x, -bVt.y, max(bVt.z, 0.05)));
      float W = bBay * 3.0;
      float rx = uv.x - floor(uv.x / W) * W;
      behind = mix(behind, bRoom(vec3(rx, cy, 0.0), rd, vec3(W, top + 0.3, 12.0), bh32(vec2(floor(uv.x / W), 5.0) + bSeed), ROOM_LOBBY, lit, lc), bDet);
    }
    bToGlass(g, behind, vec2(0.0), true);
    float mod15 = bBay < 2.0 ? bBay : bBay / max(1.0, floor(bBay / 1.5));
    float fr = max(bPulse(uv.x + 0.04, bFw.x, mod15, 0.0, 0.08), bLine(cy - 2.8, 0.08, bFw.y));
    g.alb = mix(g.alb, bTrim, fr);
    g.metal = mix(g.metal, 0.6, fr);
    g.emis *= 1.0 - fr;
    g.glass *= 1.0 - fr;
    s = bMix(s, g, cov);
  } else if (bGnd == GND_BLANK || bGnd == GND_SERVICE) {
    s.alb = mix(s.alb, bWallC * 0.72, bBox(cy, bFw.y, 0.0, 0.35));
    if (bGnd == GND_SERVICE && rr.x < 0.22 && bBay > 1.6 && bDet > 0.0) {
      BldS d = s;
      float dx = (rr.y - 0.5) * max(0.0, bBay - 1.6);
      bDoor(d, vec2(cx - dx, cy), 1.0, 2.2, false, false, 0.0, vec3(0.0));
      bLamp(d, vec2(cx - dx, cy - 2.55));
      s = bMix(s, d, bDet);
    }
  } else if (bGnd == GND_DOOR) {
    bool med = bPat == PAT_MED;
    float dw = bBay > 4.2 ? 1.8 : 1.0;
    float dh = med ? 2.45 : 2.2;
    bool glassDoor = bPat == PAT_MODERN;
    if (bDet > 0.0) {
      BldS d = s;
      bDoor(d, vec2(cx, cy), dw, dh, glassDoor, med && dw < 1.4, uBldNight * 0.8, vec3(1.0, 0.7, 0.4));
      bLamp(d, vec2(cx - 0.5 * dw - 0.4, cy - 1.95));
      s = bMix(s, d, bDet);
    } else {
      s.alb = mix(s.alb, vec3(0.2, 0.14, 0.1), bRect(vec2(cx, cy), bFw, vec2(-0.5 * dw, 0.0), vec2(0.5 * dw, dh)));
      s.emis += vec3(1.0, 0.7, 0.4) * uBldNight * 0.4 * bRect(vec2(cx, cy), bFw, vec2(-0.5 * dw - 0.6, 1.8), vec2(-0.5 * dw - 0.2, 2.1));
    }
  } else if (bGnd == GND_GARAGE) {
    float gw = bBay >= 5.6 ? 4.9 : min(2.75, bBay - 0.6);
    float gh = min(2.2, bG - 0.6);
    float m = bRect(vec2(cx, cy), bFw, vec2(-0.5 * gw, 0.0), vec2(0.5 * gw, gh));
    vec3 gc = fract(bSeed * 13.0) < 0.6 ? vec3(0.85, 0.84, 0.8) : bTrim;
    float det = bDet;
    float pnl = bLine((fract(cy / (gh * 0.25)) - 0.5) * gh * 0.25, 0.02, bFw.y) * det;
    BldS g = s;
    g.alb = gc * (1.0 - 0.3 * pnl);
    g.n = normalize(vec3(0.0, (fract(cy / (gh * 0.25)) - 0.5) * 0.3 * det, 1.0));
    g.rough = 0.5;
    g.metal = 0.2;
    g.ao = 0.9;
    if (bLt.z > 0.02) g.sh = 1.0 - (1.0 - smoothstep(0.0, 0.12 * bLt.y / bLt.z + 0.02, gh - cy)) * 0.9;
    s = bMix(s, g, m);
    s.alb = mix(s.alb, bTrim, bFill(max(abs(cx) - 0.5 * gw - 0.08, abs(cy - 0.5 * gh) - 0.5 * gh - 0.08), bFp) * (1.0 - m));
  } else if (bGnd == GND_DOCK || bGnd == GND_ROLLUP) {
    bool dock = bGnd == GND_DOCK;
    float dw = dock ? min(3.0, bBay - 1.0) : min(4.3, bBay - 1.2);
    float y0 = dock ? 1.2 : 0.0;
    float y1 = dock ? min(bG - 0.8, 4.2) : min(4.9, bG - 1.0);
    float m = bRect(vec2(cx, cy), bFw, vec2(-0.5 * dw, y0), vec2(0.5 * dw, y1));
    bool openDoor = rr.x < 0.16 && uBldNight < 0.5;
    BldS g = s;
    if (openDoor) {
      vec3 rd = normalize(vec3(-bVt.x, -bVt.y, max(bVt.z, 0.05)));
      g.alb = vec3(0.02);
      g.emis = bDet > 0.0 ? bRoom(vec3(cx + 0.5 * dw, cy - y0, 0.0), rd, vec3(dw, y1 - y0, 20.0), rr, ROOM_WAREHOUSE, 0.5, vec3(0.9, 0.95, 1.0)) : vec3(0.02) * uBldDay;
      g.n = vec3(0.0, 0.0, 1.0);
    } else {
      float slat = fract(cy / 0.09);
      vec3 dc = fract(bSeed * 7.0) < 0.5 ? vec3(0.75, 0.76, 0.76) : bTrim;
      g.alb = dc * (0.88 + 0.18 * mix(slat, 0.5, smoothstep(0.02, 0.05, bFp)));
      g.n = normalize(vec3(0.0, (slat - 0.5) * 0.5 * (1.0 - smoothstep(0.02, 0.05, bFp)), 1.0));
      g.metal = 0.35;
      g.rough = 0.5;
    }
    s = bMix(s, g, m);
    if (dock) {
      float seal = bRect(vec2(cx, cy), bFw, vec2(-0.5 * dw - 0.25, y0), vec2(0.5 * dw + 0.25, y1 + 0.25)) * (1.0 - m);
      s.alb = mix(s.alb, vec3(0.03), seal);
      s.rough = mix(s.rough, 0.9, seal);
      float bump = max(bRect(vec2(cx, cy), bFw, vec2(-0.5 * dw - 0.1, 0.72), vec2(-0.5 * dw + 0.18, 1.15)), bRect(vec2(cx, cy), bFw, vec2(0.5 * dw - 0.18, 0.72), vec2(0.5 * dw + 0.1, 1.15)));
      s.alb = mix(s.alb, vec3(0.02), bump);
      s.alb *= 1.0 - 0.25 * bBox(cy, bFw.y, 0.0, 1.2) * bBox(cx, bFw.x, -0.5 * dw - 0.4, 0.5 * dw + 0.4);
    } else {
      float fr = bRect(vec2(cx, cy), bFw, vec2(-0.5 * dw - 0.1, 0.0), vec2(0.5 * dw + 0.1, y1 + 0.1)) * (1.0 - m);
      s.alb = mix(s.alb, vec3(0.18), fr);
    }
  } else if (bGnd == GND_ARCADE) {
    float aw = bBay - 0.55;
    float spring = min(bG - 0.35 - 0.5 * aw, 2.5);
    vec2 hs = vec2(0.5 * aw, 0.5 * (spring + 0.5 * aw));
    vec2 c = vec2(cx, cy - hs.y);
    float m = bFill(bShapeSD(c, hs, 1), bFp);
    if (m > 0.0) {
      BldS a = s;
      vec3 ro = vec3(cx + 0.5 * bBay, cy, 0.0);
      vec3 rd = normalize(vec3(-bVt.x, -bVt.y, max(bVt.z, 0.05)));
      float D = max(bDep, 1.5);
      float H = spring + 0.5 * aw;
      float ty = rd.y > 0.0 ? (H - ro.y) / max(rd.y, 1e-4) : ro.y / max(-rd.y, 1e-4);
      float tz = D / rd.z;
      float t = min(ty, tz);
      vec3 h = ro + rd * t;
      if (t == tz) {
        a.alb = bWallC * 0.85;
        float win = bRect(h.xy, vec2(bFp), vec2(0.5 * bBay - 0.55, 0.0), vec2(0.5 * bBay + 0.55, 2.3));
        a.alb = mix(a.alb, vec3(0.05, 0.05, 0.06), win);
        a.emis += win * uBldNight * vec3(1.0, 0.7, 0.4) * 0.6;
        a.n = vec3(0.0, 0.0, 1.0);
      } else if (rd.y < 0.0) {
        a.alb = vec3(0.48, 0.25, 0.14) * (0.85 + 0.15 * step(0.5, fract(h.x / 0.4)));
        a.n = vec3(0.0, 1.0, 0.0);
      } else {
        a.alb = bWallC * 0.9;
        a.n = vec3(0.0, -1.0, 0.0);
      }
      a.ao = 0.55 + 0.45 * (1.0 - h.z / D);
      if (bLt.z > 0.02) {
        vec2 lp = h.xy - vec2(0.5 * bBay, hs.y) + bLt.xy / bLt.z * h.z;
        a.sh = bFill(bShapeSD(lp, hs, 1), 0.05);
      }
      a.metal = 0.0;
      a.rough = 0.85;
      a.glass = 0.0;
      s = bMix(s, a, m);
    }
  } else if (bGnd == GND_PARKING) {
    float hx = 0.5 * bBay - 0.3;
    float cov = bBox(cx, bFw.x, -hx, hx) * bBox(cy, bFw.y, 0.3, bG - 0.5);
    bGarageDeck(s, uv, bi, -1.0, cx, cy, bG, cov);
  }
}

// ---------------------------------------------------------------- parapet / crown
void bParapet(inout BldS s, vec2 uv) {
  if (bPat == PAT_CURTAIN) {
    BldS g = s;
    vec2 jit = (bh22(vec2(floor(uv.x / bBay), 99.0) + bSeed) - 0.5) * 0.03;
    bToGlass(g, vec3(0.0), jit, false);
    g.alb *= 0.9;
    float mull = bPulse(uv.x + 0.04, bFw.x, bBay, 0.0, 0.08);
    g.alb = mix(g.alb, bTrim, mull);
    g.metal = mix(g.metal, 0.6, mull);
    s = g;
  } else if (bPat == PAT_BALCONY || bPat == PAT_EGGCRATE) {
    s.alb *= 1.0 - 0.3 * bLine(uv.y - bTop - 0.3, 0.03, bFw.y);
  }
  if (bCrown > 0 && uBldNight > 0.0) {
    vec3 cc = BLD_CROWN[bCrown];
    float h = uv.y - bTop;
    float wash = 0.5 + 0.5 * exp(-h * 0.6);
    s.emis += cc * uBldNight * 1.6 * wash;
  }
}

BldS bldFacade(vec3 wallC) {
  bF = max(vFacA.x, 0.5);
  bBay = max(vFacA.y, 0.3);
  bG = vFacA.z;
  bTop = vFacA.w;
  bWW = vFacB.x;
  bWH = vFacB.y;
  bSill = vFacB.z;
  bDep = vFacB.w;
  bPat = int(vFacC.x + 0.5);
  bGnd = int(vFacC.y + 0.5);
  bSeed = vFacC.z;
  int gs = int(vFacC.w + 0.5);
  bGlassT = gs & 7;
  bSurf = gs >> 3;
  bTrim = vFacD.rgb;
  int fl = int(vFacD.w + 0.5);
  bOcc = fl & 3;
  bCrown = (fl >> 2) & 7;
  bFlags = fl >> 5;
  bWallC = wallC;
  vec2 uv = vBldUv;
  bFw = max(fwidth(uv), vec2(1e-4));
  bFp = max(bFw.x, bFw.y);
  bDet = 1.0 - smoothstep(0.09, 0.2, bFp);
  vec3 N = normalize(vBldWNrm);
  vec3 T = normalize(vec3(N.z, 0.0, -N.x) + vec3(1e-6, 0.0, 0.0));
  vec3 V = normalize(cameraPosition - vBldWPos);
  bVt = vec3(dot(V, T), V.y, dot(V, N));
  vec3 L = bLightDir();
  bLt = vec3(dot(L, T), L.y, dot(L, N));
  bLitF = clamp(uBldOcc[bOcc] * (0.55 + 0.9 * fract(bSeed * 7.13)), 0.0, 0.97);
  BldS s = bWall(uv);
  if (uv.y < 0.0) {
    s.alb *= 0.6;
    s.rough = 0.95;
  } else if (uv.y >= bTop) {
    bParapet(s, uv);
  } else if (uv.y < bG) {
    bGroundFloor(s, uv);
  } else {
    float fy = uv.y - bG;
    float fi = floor(fy / bF);
    bUpperFloors(s, uv, fi, fy - fi * bF, bF, 0.0);
  }
  bNw = normalize(T * s.n.x + vec3(0.0, 1.0, 0.0) * s.n.y + N * s.n.z);
  return s;
}
`;
