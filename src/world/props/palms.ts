// Palms: royal (Roystonea regia), coconut (Cocos nucifera) and sabal / cabbage palm
// (Sabal palmetto). Orientation does not matter (radially symmetric apart from lean).
//
// Construction
// - Trunks are swept tubes with an atlas texture that wraps once around and tiles along the
//   length (smooth grey concrete-like royal trunk, ringed coconut trunk, booted sabal trunk).
// - Pinnate fronds are curved, V-folded card strips (3 vertices across per station): the
//   rachis follows a drooping curve and each side's leaflets come from an alpha-tested
//   texture. Royal fronds use two ranks (up and down V) for their plumose look; coconut
//   fronds a single inverted V so leaflets hang down.
// - Sabal fan leaves are a polar grid (angle x radius) folded along the costa, with drooping
//   segment tips, on a petiole prism.
// - Normals on leaf cards are bent outward from the crown (plus up) so lighting is soft and
//   consistent from both sides (the leaf shader does not flip back-face normals).
// - `aWind` per vertex: x = sway metres (trunk bends with height^2, the crown moves with the
//   trunk top), y = flutter metres (grows towards frond tips), z = phase (per frond).

import * as THREE from 'three';
import { PALM_LEAF, PALM_TRUNK, PALM_TRUNK_TILE, regionUv, type UvRect } from './atlas';
import { clamp01, lerp, mixRgb, mulRgb, rgb, smoothstep, v3, type Part, type PropBuild, type RGB, type V3, type Wind4 } from './builder';

const UP = new THREE.Vector3(0, 1, 0);

interface FrondRank {
  /** Leaflet fold angle at the base (radians): + = V opening upward, - = drooping. */
  fold: number;
  /** Fold angle at the tip. */
  foldTip: number;
  rect: UvRect;
  widthScale: number;
  shade: number;
}

export interface FrondSpec {
  base: V3;
  /** Direction around the trunk (radians, 0 = +X, pi/2 = +Z). */
  azimuth: number;
  /** Initial elevation above horizontal (radians). */
  elevation: number;
  length: number;
  /** Total downward bend along the frond (radians). */
  droop: number;
  droopPow: number;
  halfWidth: number;
  width: (t: number) => number;
  ranks: FrondRank[];
  roll: number;
  twist: number;
  /** Sideways drift of the azimuth along the frond (radians). */
  curl: number;
  segments: number;
  tint: RGB;
  crown: V3;
  sway: number;
  flutter: number;
  phase: number;
}

/** Curved, folded pinnate frond. */
export function addFrond(part: Part, f: FrondSpec): void {
  const n = f.segments;
  const dirAt = (t: number): V3 => {
    const el = f.elevation - f.droop * Math.pow(t, f.droopPow);
    const az = f.azimuth + f.curl * t;
    return v3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
  };
  // Integrate the rachis.
  const pts: V3[] = [f.base.clone()];
  const p = f.base.clone();
  const sub = 5;
  for (let i = 0; i < n; i++) {
    for (let s = 0; s < sub; s++) p.addScaledVector(dirAt((i + (s + 0.5) / sub) / n), f.length / (n * sub));
    pts.push(p.clone());
  }
  const lift = v3(0, 0.9, 0);
  for (const rank of f.ranks) {
    const rows: [number, number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const T = dirAt(t);
      const az = f.azimuth + f.curl * t;
      const S = v3(-Math.sin(az), 0, Math.cos(az));
      const U = new THREE.Vector3().crossVectors(S, T).normalize();
      const r = f.roll + f.twist * t;
      const S2 = S.clone().multiplyScalar(Math.cos(r)).addScaledVector(U, Math.sin(r));
      const U2 = U.clone().multiplyScalar(Math.cos(r)).addScaledVector(S, -Math.sin(r));
      const a = lerp(rank.fold, rank.foldTip, t);
      const eR = S2.clone().multiplyScalar(Math.cos(a)).addScaledVector(U2, Math.sin(a));
      const eL = S2.clone().multiplyScalar(-Math.cos(a)).addScaledVector(U2, Math.sin(a));
      const w = f.halfWidth * f.width(t) * rank.widthScale;
      const P = pts[i];
      const PL = P.clone().addScaledVector(eL, w);
      const PR = P.clone().addScaledVector(eR, w);
      // Upward-facing strip normals, then bent outward from the crown.
      const nL = U2.clone().multiplyScalar(Math.cos(a)).addScaledVector(S2, Math.sin(a));
      const nR = U2.clone().multiplyScalar(Math.cos(a)).addScaledVector(S2, -Math.sin(a));
      const bend = (q: V3, face: V3): V3 => {
        const radial = q.clone().sub(f.crown).add(lift).normalize();
        return face.clone().multiplyScalar(0.45).addScaledVector(radial, 0.55).addScaledVector(UP, 0.3).normalize();
      };
      const ao = lerp(0.42, 1.0, smoothstep(0.0, 0.45, t)) * rank.shade;
      const col = mulRgb(f.tint, ao);
      const colEdge = mulRgb(f.tint, ao * 1.06);
      const fl = f.flutter * Math.pow(t, 1.5);
      const ph = (f.phase + t * 0.22) % 1;
      const wMid: Wind4 = [f.sway, fl, ph, 0];
      const wEdge: Wind4 = [f.sway, fl * 1.3 + 0.02 * t, (ph + 0.07) % 1, 1];
      const [um, v] = regionUv(rank.rect, 0.5, t);
      const [u0] = regionUv(rank.rect, 0, t);
      const [u1] = regionUv(rank.rect, 1, t);
      const iM = part.vtx(P, bend(P, U2), um, v, col, wMid);
      const iL = part.vtx(PL, bend(PL, nL), u0, v, colEdge, wEdge);
      const iR = part.vtx(PR, bend(PR, nR), u1, v, colEdge, wEdge);
      rows.push([iM, iL, iR]);
    }
    for (let i = 0; i < n; i++) {
      const [m0, l0, r0] = rows[i];
      const [m1, l1, r1] = rows[i + 1];
      part.quad(m0, m1, l1, l0);
      part.quad(m0, r0, r1, m1);
    }
  }
}

/** Sabal costapalmate fan leaf on a petiole. */
interface FanSpec {
  crown: V3;
  /** Petiole direction (unit). */
  dir: V3;
  petiole: number;
  radius: number;
  spread: number;
  fold: number;
  droop: number;
  rect: UvRect;
  tint: RGB;
  sway: number;
  flutter: number;
  phase: number;
  segA: number;
  segR: number;
  petioleColor: RGB;
  /** Rotation of the blade about the costa (radians), so blades are not all held flat. */
  tilt: number;
}

function addFanLeaf(leaf: Part, stalk: Part, f: FanSpec): void {
  // Petiole: slightly arched prism from the crown to the hastula.
  const F0 = f.dir.clone().normalize();
  const h0 = f.crown.clone().addScaledVector(F0, 0.12);
  const hastula = f.crown.clone().addScaledVector(F0, f.petiole).add(v3(0, -0.06 * f.petiole, 0));
  const mid = h0.clone().lerp(hastula, 0.5).add(v3(0, 0.05 * f.petiole, 0));
  const pr = f.petiole * 0.018 + 0.012;
  stalk.tube([h0, mid, hastula], [pr * 1.3, pr, pr * 0.7], 3, {
    rect: PALM_TRUNK.crownshaft,
    colors: [f.petioleColor, f.petioleColor, f.petioleColor],
    winds: [[f.sway, 0, f.phase, 0], [f.sway, f.flutter * 0.25, f.phase, 0], [f.sway, f.flutter * 0.45, f.phase, 0]],
  });
  // Blade frame: F along the (drooping) costa, N the blade's upper side, S across.
  const F = hastula.clone().sub(mid).normalize().lerp(F0, 0.5).normalize();
  let N = UP.clone().addScaledVector(F, -UP.dot(F));
  if (N.lengthSq() < 1e-4) N = v3(Math.cos(f.phase * 6.28), 0, Math.sin(f.phase * 6.28));
  N.normalize();
  const side0 = new THREE.Vector3().crossVectors(F, N).normalize();
  N.multiplyScalar(Math.cos(f.tilt)).addScaledVector(side0, Math.sin(f.tilt)).normalize();
  const S = new THREE.Vector3().crossVectors(F, N).normalize();
  const rows: number[][] = [];
  const rho0 = f.radius * 0.07;
  for (let j = 0; j <= f.segR; j++) {
    const rt = j / f.segR;
    const rho = lerp(rho0, f.radius, rt);
    const row: number[] = [];
    for (let k = 0; k <= f.segA; k++) {
      const st = k / f.segA;
      const a = (st * 2 - 1) * f.spread;
      const inPlane = F.clone().multiplyScalar(Math.cos(a)).addScaledVector(S, Math.sin(a));
      const q = hastula.clone().addScaledVector(inPlane, rho);
      // Fold the halves up along the costa, droop the outer segments.
      q.addScaledVector(N, Math.abs(Math.sin(a)) * rho * f.fold);
      q.addScaledVector(N, -Math.pow(rt, 2) * f.droop * (0.55 + 0.45 * Math.cos(a)));
      const radial = q.clone().sub(f.crown).add(v3(0, 0.6, 0)).normalize();
      const nrm = N.clone().multiplyScalar(0.5).addScaledVector(radial, 0.6).addScaledVector(UP, 0.25).normalize();
      const [u, v] = regionUv(f.rect, st, rt);
      const ao = lerp(0.55, 1.0, smoothstep(0, 0.6, rt));
      const fl = f.flutter * (0.45 + 0.55 * Math.pow(rt, 1.4));
      row.push(leaf.vtx(q, nrm, u, v, mulRgb(f.tint, ao), [f.sway, fl, (f.phase + st * 0.15) % 1, rt]));
    }
    rows.push(row);
  }
  for (let j = 0; j < f.segR; j++) {
    for (let k = 0; k < f.segA; k++) leaf.quad(rows[j][k], rows[j][k + 1], rows[j + 1][k + 1], rows[j + 1][k]);
  }
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// ---------------------------------------------------------------------------------------
// Royal palm: smooth grey column 15-21 m with a slight swelling, bright green crownshaft
// (~2 m), 13-16 arching plumose fronds 3.2-3.9 m.

const royalWidth = (t: number) => 0.12 + 0.88 * smoothstep(0.04, 0.3, t) * (1 - 0.72 * smoothstep(0.55, 1.0, t));

export function buildRoyalPalm(b: PropBuild): void {
  const rng = b.rng;
  const colH = [15.2, 18.2, 21.2][b.variant % 3] + rng.range(-0.4, 0.4);
  const csLen = rng.range(1.9, 2.3);
  const trunkH = colH - csLen;
  const sides = b.seg(10, 5);
  const leanAz = rng.range(0, Math.PI * 2);
  const lean = rng.range(0.0, 0.012);
  const bow = rng.range(-0.18, 0.18);
  const at = (y: number): V3 => {
    const off = lean * y + bow * Math.sin((Math.PI * y) / colH);
    return v3(Math.cos(leanAz) * off, y, Math.sin(leanAz) * off);
  };
  const bulgeAt = rng.range(0.28, 0.55);
  const bulge = rng.range(0.035, 0.07);
  const rAt = (y: number): number => {
    const f = y / trunkH;
    return (0.31 + 0.11 * Math.exp(-y / 0.28) + bulge * Math.exp(-(((f - bulgeAt) / 0.2) ** 2))) * (1 - 0.26 * Math.pow(f, 1.5));
  };
  const sway = 0.26 + 0.05 * b.variant;
  const windAt = (y: number): Wind4 => [sway * (y / colH) ** 2, 0, 0, 0];

  const trunk = b.part('palmTrunk');
  const ys = [0, 0.14, 0.42];
  const segs = b.seg(6, 3);
  for (let k = 0; k <= segs; k++) ys.push(lerp(0.9, trunkH, k / segs));
  const grey = rgb(0xffffff);
  const dirt = rgb(0xb8ada0);
  trunk.tube(ys.map(at), ys.map(rAt), sides, {
    rect: PALM_TRUNK.royal,
    vTile: PALM_TRUNK_TILE.royal,
    colors: ys.map((y) => mixRgb(dirt, grey, smoothstep(0, 0.9, y))),
    winds: ys.map(windAt),
  });
  // Crownshaft: slightly proud of the trunk top, swelling a little, tapering to the crown.
  const rTop = rAt(trunkH);
  const csY = [trunkH - 0.03, trunkH + 0.1, trunkH + csLen * 0.45, colH - 0.1, colH + 0.25];
  const csR = [rTop * 0.98, rTop + 0.04, rTop + 0.045, rTop * 0.75, rTop * 0.45];
  const csCol = rgb(0xf4fff0);
  trunk.tube(csY.map(at), csR, sides, {
    rect: PALM_TRUNK.crownshaft,
    vTile: PALM_TRUNK_TILE.crownshaft,
    colors: csY.map((_, i) => mulRgb(csCol, i === 0 ? 0.85 : 1)),
    winds: csY.map(windAt),
  });
  // Spear leaf (the unopened new frond) sticking up from the crown.
  const crown = at(colH);
  const spearH = rng.range(0.9, 1.4);
  trunk.tube([crown.clone().add(v3(0, 0.1, 0)), crown.clone().add(v3(0.02, spearH * 0.6, 0)), crown.clone().add(v3(0.05, spearH + 0.25, 0.02))], [0.07, 0.045, 0.004], 4, {
    rect: PALM_TRUNK.crownshaft,
    colors: [rgb(0xd0e0a0), rgb(0xd8e6a8), rgb(0xe0e8b0)],
    winds: [windAt(colH), [sway, 0.05, 0.3, 0], [sway, 0.12, 0.3, 0]],
  });

  // Fronds.
  const leaves = b.part('palmLeaf');
  const count = Math.max(8, Math.round([16, 17, 18][b.variant % 3] * (0.55 + 0.45 * b.detail)));
  const fsegs = b.seg(6, 3);
  const young = rgb(0xd9e8a6);
  const mature = rgb(0xffffff);
  const old = rgb(0xf2e0a0);
  const az0 = rng.range(0, Math.PI * 2);
  for (let i = 0; i < count; i++) {
    const a = i / (count - 1);
    const tint = a < 0.3 ? mixRgb(young, mature, a / 0.3) : mixRgb(mature, old, smoothstep(0.75, 1, a));
    const az = az0 + i * GOLDEN + rng.range(-0.15, 0.15);
    const base = crown.clone().add(v3(Math.cos(az) * (0.1 + 0.1 * a), -0.05 - 0.3 * a, Math.sin(az) * (0.1 + 0.1 * a)));
    addFrond(leaves, {
      base,
      azimuth: az,
      elevation: lerp(1.35, -0.55, Math.pow(a, 0.75)) + rng.range(-0.12, 0.12),
      length: rng.range(3.4, 4.1) * (a < 0.12 ? 0.85 : 1),
      droop: lerp(0.75, 1.75, a) + rng.range(-0.12, 0.12),
      droopPow: 1.3,
      halfWidth: rng.range(0.8, 0.92),
      width: royalWidth,
      ranks: [
        { fold: 0.72, foldTip: 0.42, rect: i % 2 ? PALM_LEAF.royalA : PALM_LEAF.royalB, widthScale: 1, shade: 1 },
        { fold: -0.42, foldTip: -0.85, rect: i % 2 ? PALM_LEAF.royalB : PALM_LEAF.royalA, widthScale: 0.9, shade: 0.84 },
      ],
      roll: rng.range(-0.15, 0.15),
      twist: rng.range(-0.35, 0.35),
      curl: rng.range(-0.25, 0.25),
      segments: fsegs,
      tint,
      crown,
      sway,
      flutter: rng.range(0.14, 0.22),
      phase: rng.next(),
    });
  }
}

// ---------------------------------------------------------------------------------------
// Coconut palm: slender ringed trunk 8.5-14 m, leaning and curving back up, bulbous base,
// 16-20 drooping fronds 3.8-5 m with hanging leaflets, coconut clusters, dead fronds.

const coconutWidth = (t: number) => 0.1 + 0.9 * smoothstep(0.08, 0.32, t) * (1 - 0.78 * smoothstep(0.58, 1.0, t));

export function buildCoconutPalm(b: PropBuild): void {
  const rng = b.rng;
  const v = b.variant % 4;
  const length = [8.6, 11.2, 13.8, 10.2][v] + rng.range(-0.3, 0.3);
  const lean0 = [0.22, 0.34, 0.26, 0.5][v] + rng.range(-0.04, 0.04);
  const leanAz = rng.range(0, Math.PI * 2);
  const recover = [0.7, 0.75, 0.55, 0.85][v];
  const sides = b.seg(9, 5);
  const nRing = b.seg(13, 6);
  // Integrate the trunk curve: tilt decreases with height (the palm curves back up).
  const path: V3[] = [v3(0, 0, 0)];
  const p = v3();
  const wob = rng.range(0, Math.PI * 2);
  for (let i = 0; i < nRing; i++) {
    const sub = 4;
    for (let s = 0; s < sub; s++) {
      const f = (i + (s + 0.5) / sub) / nRing;
      const tilt = lean0 * (1 - recover * Math.pow(f, 1.1)) + 0.05 * Math.sin(f * 5 + wob);
      const azm = leanAz + 0.15 * Math.sin(f * 3 + wob);
      p.add(v3(Math.sin(tilt) * Math.cos(azm), Math.cos(tilt), Math.sin(tilt) * Math.sin(azm)).multiplyScalar(length / (nRing * sub)));
    }
    path.push(p.clone());
  }
  const radii = path.map((_, i) => {
    const s = (i / nRing) * length;
    const bole = 0.13 * Math.exp(-s / 0.55);
    return (0.195 + bole) * (1 - 0.3 * (i / nRing)) * (1 + 0.04 * Math.sin(i * 2.7 + wob));
  });
  // Push the first ring a little into the ground for sloped placement.
  path[0] = v3(0, -0.05, 0);
  const top = path[path.length - 1];
  const H = top.y;
  const sway = 0.22 + 0.04 * v;
  const windOf = (q: V3): Wind4 => [sway * clamp01(q.y / H) ** 2, 0, 0, 0];
  const trunk = b.part('palmTrunk');
  trunk.tube(path, radii, sides, {
    rect: PALM_TRUNK.coconut,
    vTile: PALM_TRUNK_TILE.coconut,
    colors: path.map((q) => mixRgb(rgb(0xb9aa98), rgb(0xffffff), smoothstep(0, 1.2, q.y))),
    winds: path.map(windOf),
    capEnd: true,
  });
  const dirTop = top.clone().sub(path[path.length - 2]).normalize();
  const crown = top.clone().addScaledVector(dirTop, 0.25);
  // Fibrous crown knot hiding the frond bases.
  trunk.tube(
    [top.clone().addScaledVector(dirTop, -0.3), crown.clone(), crown.clone().addScaledVector(dirTop, 0.3)],
    [radii[radii.length - 1] * 1.05, 0.27, 0.12],
    b.seg(7, 4),
    { rect: PALM_TRUNK.coconut, vTile: 0.6, colors: [rgb(0x8a7458), rgb(0x9a8260), rgb(0x8f8a50)], winds: [windOf(top), [sway, 0, 0, 0], [sway, 0.02, 0, 0]], capEnd: true },
  );

  const leaves = b.part('palmLeaf');
  const count = Math.max(9, Math.round([16, 18, 20, 17][v] * (0.55 + 0.45 * b.detail)));
  const fsegs = b.seg(7, 3);
  const young = rgb(0xe4ecb0);
  const mature = rgb(0xffffff);
  const old = rgb(0xf6dc96);
  const az0 = rng.range(0, Math.PI * 2);
  for (let i = 0; i < count; i++) {
    const a = i / (count - 1);
    const az = az0 + i * GOLDEN + rng.range(-0.18, 0.18);
    const tint = a < 0.25 ? mixRgb(young, mature, a / 0.25) : mixRgb(mature, old, smoothstep(0.65, 1, a));
    const base = crown.clone().add(v3(Math.cos(az) * 0.14, -0.1 - 0.3 * a, Math.sin(az) * 0.14));
    addFrond(leaves, {
      base,
      azimuth: az,
      elevation: lerp(1.15, -0.55, Math.pow(a, 0.8)) + rng.range(-0.15, 0.15),
      length: rng.range(3.9, 4.9) * (a < 0.12 ? 0.85 : 1),
      droop: lerp(0.8, 1.75, a) + rng.range(-0.15, 0.15),
      droopPow: 1.25,
      halfWidth: rng.range(0.74, 0.86),
      width: coconutWidth,
      ranks: [{ fold: -0.62, foldTip: -1.15, rect: i % 2 ? PALM_LEAF.coconutA : PALM_LEAF.coconutB, widthScale: 1, shade: 1 }],
      roll: rng.range(-0.2, 0.2),
      twist: rng.range(-0.5, 0.5),
      curl: rng.range(-0.3, 0.3),
      segments: fsegs,
      tint,
      crown,
      sway,
      flutter: rng.range(0.2, 0.3),
      phase: rng.next(),
    });
  }
  // Dead fronds hanging against the trunk.
  const dead = [0, 1, 2, 1][v];
  for (let i = 0; i < dead; i++) {
    const az = rng.range(0, Math.PI * 2);
    addFrond(leaves, {
      base: crown.clone().add(v3(Math.cos(az) * 0.2, -0.45, Math.sin(az) * 0.2)),
      azimuth: az,
      elevation: rng.range(-1.2, -1.0),
      length: rng.range(3.0, 3.8),
      droop: 0.3,
      droopPow: 1,
      halfWidth: 0.5,
      width: coconutWidth,
      ranks: [{ fold: -1.05, foldTip: -1.25, rect: PALM_LEAF.dead, widthScale: 1, shade: 0.9 }],
      roll: 0,
      twist: rng.range(-0.3, 0.3),
      curl: 0,
      segments: Math.max(3, fsegs - 2),
      tint: rgb(0xffffff),
      crown,
      sway,
      flutter: 0.06,
      phase: rng.next(),
    });
  }
  // Coconut clusters under the crown.
  const nuts = b.part('palmTrunk');
  const clusters = [2, 3, 2, 2][v];
  for (let c = 0; c < clusters; c++) {
    const az = az0 + (c / clusters) * Math.PI * 2 + 0.6;
    const n = rng.int(3, 5);
    const ripe = rng.chance(0.35);
    const col = ripe ? rgb(0x9a7a46) : rgb(0xc8d070);
    for (let k = 0; k < n; k++) {
      const a2 = az + rng.range(-0.45, 0.45);
      const rr = rng.range(0.24, 0.34);
      const q = crown.clone().add(v3(Math.cos(a2) * rr, -rng.range(0.3, 0.62), Math.sin(a2) * rr));
      const r = rng.range(0.12, 0.15);
      nuts.color = mulRgb(col, rng.range(0.85, 1.05));
      nuts.wind = [sway, 0.015, 0, 0];
      const [u, vv] = regionUv(PALM_TRUNK.crownshaft, 0.5, 0.5);
      nuts.octa(q.x, q.y, q.z, r, r * 1.12, r, u, vv);
    }
  }
  nuts.color = [1, 1, 1];
  nuts.wind = [0, 0, 0, 0];
}

// ---------------------------------------------------------------------------------------
// Sabal (cabbage) palm: 7-12 m, rough trunk with criss-cross "boots" on its upper part,
// round head of 20-26 costapalmate fan leaves on long petioles.

export function buildSabalPalm(b: PropBuild): void {
  const rng = b.rng;
  const v = b.variant % 3;
  const trunkH = [4.9, 7.1, 9.4][v] + rng.range(-0.3, 0.3);
  const sides = b.seg(8, 5);
  const leanAz = rng.range(0, Math.PI * 2);
  const lean = rng.range(0.01, 0.05);
  const at = (y: number): V3 => {
    const off = lean * y + 0.08 * Math.sin(y * 0.6 + leanAz);
    return v3(Math.cos(leanAz) * off, y, Math.sin(leanAz) * off);
  };
  const bootFrom = trunkH * [0.45, 0.55, 0.62][v];
  const sway = 0.15 + 0.04 * v;
  const crownY = trunkH + 0.25;
  const H = crownY + 1.6;
  const windAt = (y: number): Wind4 => [sway * clamp01(y / H) ** 2, 0, 0, 0];
  const trunk = b.part('palmTrunk');
  const lowYs = [-0.05, 0.12, 0.4];
  const nLow = b.seg(4, 2);
  for (let k = 1; k <= nLow; k++) lowYs.push(lerp(0.4, bootFrom + 0.05, k / nLow));
  const rLow = (y: number) => 0.2 + 0.08 * Math.exp(-y / 0.25) + 0.008 * Math.sin(y * 3.1);
  trunk.tube(lowYs.map(at), lowYs.map(rLow), sides, {
    rect: PALM_TRUNK.sabal,
    vTile: PALM_TRUNK_TILE.sabal,
    colors: lowYs.map((y) => mixRgb(rgb(0xb0a494), rgb(0xffffff), smoothstep(0, 1, y))),
    winds: lowYs.map(windAt),
  });
  const upYs: number[] = [];
  const nUp = b.seg(4, 2);
  for (let k = 0; k <= nUp; k++) upYs.push(lerp(bootFrom - 0.05, crownY, k / nUp));
  trunk.tube(upYs.map(at), upYs.map((y, i) => (i === 0 ? rLow(y) + 0.02 : 0.27 + 0.015 * Math.sin(i * 2.1))), sides, {
    rect: PALM_TRUNK.sabalBoots,
    vTile: PALM_TRUNK_TILE.sabalBoots,
    colors: upYs.map(() => rgb(0xffffff)),
    winds: upYs.map(windAt),
    capEnd: true,
  });
  // Boot stubs: short split leaf bases sticking out of the upper trunk.
  const leaves = b.part('palmLeaf');
  const stubs = b.seg(14, 6);
  for (let i = 0; i < stubs; i++) {
    const y = lerp(bootFrom + 0.2, crownY - 0.3, rng.next());
    const az = i * GOLDEN * 1.7 + rng.range(-0.3, 0.3);
    const c = at(y);
    const out = v3(Math.cos(az), 0, Math.sin(az));
    const side = v3(-Math.sin(az), 0, Math.cos(az));
    const p0 = c.clone().addScaledVector(out, 0.2);
    const dir = out.clone().multiplyScalar(0.55).add(v3(0, 0.83, 0)).normalize();
    const len = rng.range(0.22, 0.34);
    const w = rng.range(0.1, 0.14);
    const a = p0.clone().addScaledVector(side, -w);
    const bb = p0.clone().addScaledVector(side, w);
    const cc = bb.clone().addScaledVector(dir, len);
    const d = a.clone().addScaledVector(dir, len);
    const nrm = out.clone().add(v3(0, 0.3, 0)).normalize();
    const wnd: Wind4 = [sway * clamp01(y / H) ** 2, 0, 0, 0];
    const r = PALM_LEAF.boot;
    const col = rgb(0xffffff, rng.range(0.8, 1));
    const i0 = leaves.vtx(a, nrm, r.u0, r.v0, col, wnd);
    const i1 = leaves.vtx(bb, nrm, r.u1, r.v0, col, wnd);
    const i2 = leaves.vtx(cc, nrm, r.u1, r.v1, col, wnd);
    const i3 = leaves.vtx(d, nrm, r.u0, r.v1, col, wnd);
    leaves.quad(i0, i1, i2, i3);
  }
  // Fan leaves.
  const crown = at(crownY);
  const count = Math.max(10, Math.round([23, 26, 29][v] * (0.55 + 0.45 * b.detail)));
  const segA = b.seg(4, 2);
  const segR = b.seg(2, 1);
  const az0 = rng.range(0, Math.PI * 2);
  const stalk = b.part('palmTrunk');
  for (let i = 0; i < count; i++) {
    const a = (i + 0.5) / count;
    const el = lerp(1.25, -0.85, Math.pow(a, 0.9)) + rng.range(-0.12, 0.12);
    const az = az0 + i * GOLDEN + rng.range(-0.2, 0.2);
    const dir = v3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    const tint = mixRgb(rgb(0xe8f0c0), rgb(0xffffff), smoothstep(0, 0.3, a));
    addFanLeaf(leaves, stalk, {
      crown,
      dir,
      petiole: rng.range(0.9, 1.35) * (a < 0.15 ? 0.8 : 1),
      radius: rng.range(1.0, 1.3),
      spread: rng.range(1.6, 1.85),
      fold: rng.range(0.6, 0.85),
      droop: rng.range(0.5, 0.8),
      tilt: rng.range(-0.55, 0.55),
      rect: PALM_LEAF.sabalFan,
      tint,
      sway,
      flutter: rng.range(0.1, 0.16),
      phase: rng.next(),
      segA,
      segR,
      petioleColor: rgb(0xb8c070),
    });
  }
  // Natural (untrimmed) palms keep a skirt of dead leaves hanging below the head.
  const deadLeaves = [0, 3, 5][v];
  for (let i = 0; i < deadLeaves; i++) {
    const az = az0 + (i / Math.max(1, deadLeaves)) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const el = rng.range(-1.5, -1.3);
    addFanLeaf(leaves, stalk, {
      crown: crown.clone().add(v3(0, -0.2, 0)),
      dir: v3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)),
      petiole: rng.range(0.6, 0.9),
      radius: rng.range(0.9, 1.1),
      spread: 1.2,
      fold: 0.9,
      droop: 0.2,
      tilt: rng.range(-0.3, 0.3),
      rect: PALM_LEAF.sabalFanDead,
      tint: rgb(0xffffff),
      sway,
      flutter: 0.04,
      phase: rng.next(),
      segA,
      segR,
      petioleColor: rgb(0x9a8058),
    });
  }
}
