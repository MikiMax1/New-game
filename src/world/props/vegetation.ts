// Broadleaf vegetation: live oak (Quercus virginiana), shrubs, hedges and grass clumps.
// Orientation: trees and shrubs are radially symmetric; hedges run along X (length) with
// their depth along Z, centred on the origin, so segments can be laid end to end.
//
// Leaf mass is made of "clumps": two crossed alpha-tested cards carrying a painted leaf
// cluster, placed on the surfaces of a few canopy lobes (ellipsoids) and facing outward.
// Normals are bent towards the lobe / canopy normal so the canopy shades like a volume.

import * as THREE from 'three';
import type { Rng } from '../rng';
import { FOLIAGE, TILE_METRES, type UvRect } from './atlas';
import { clamp01, lerp, mixRgb, mulRgb, rgb, smoothstep, v3, type Part, type PropBuild, type RGB, type V3, type Wind4 } from './builder';

const UP = new THREE.Vector3(0, 1, 0);

function perpendicular(n: V3): V3 {
  const a = Math.abs(n.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0);
  return new THREE.Vector3().crossVectors(n, a).normalize();
}

interface ClumpOpts {
  rect: UvRect;
  color: RGB;
  wind: Wind4;
  center: V3;
  crossed?: boolean;
  /** Weight of the lobe normal vs the canopy-radial direction in the bent normal. */
  lobeWeight?: number;
}

/** Leaf clump: a card facing `n` plus (optionally) a crossed card standing out along `n`. */
function addClump(part: Part, rng: Rng, c: V3, n: V3, size: number, o: ClumpOpts): void {
  const t1 = perpendicular(n).applyAxisAngle(n, rng.range(0, Math.PI * 2));
  const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
  const h = size / 2;
  const flip = rng.chance(0.5);
  const r = flip ? { u0: o.rect.u1, u1: o.rect.u0, v0: o.rect.v0, v1: o.rect.v1 } : o.rect;
  const lw = o.lobeWeight ?? 0.55;
  const bend = (p: V3): V3 => {
    const radial = p.clone().sub(o.center).normalize();
    return n.clone().multiplyScalar(lw).addScaledVector(radial, 1 - lw).addScaledVector(UP, 0.2).normalize();
  };
  const card = (p0: V3, p1: V3, p2: V3, p3: V3) => {
    const w = o.wind;
    const i0 = part.vtx(p0, bend(p0), r.u0, r.v0, o.color, w);
    const i1 = part.vtx(p1, bend(p1), r.u1, r.v0, o.color, w);
    const i2 = part.vtx(p2, bend(p2), r.u1, r.v1, o.color, w);
    const i3 = part.vtx(p3, bend(p3), r.u0, r.v1, o.color, w);
    part.quad(i0, i1, i2, i3);
  };
  const a = c.clone().addScaledVector(t1, -h), b = c.clone().addScaledVector(t1, h);
  card(a.clone().addScaledVector(t2, -h), b.clone().addScaledVector(t2, -h), b.clone().addScaledVector(t2, h), a.clone().addScaledVector(t2, h));
  if (o.crossed !== false) {
    const lift = n.clone().multiplyScalar(h * 0.75);
    const base = c.clone().addScaledVector(n, -h * 0.25);
    card(a.clone().sub(c).add(base), b.clone().sub(c).add(base), b.clone().sub(c).add(base).add(lift), a.clone().sub(c).add(base).add(lift));
  }
}

function pointOnPath(path: readonly V3[], t: number): V3 {
  const f = clamp01(t) * (path.length - 1);
  const i = Math.min(path.length - 2, Math.floor(f));
  return path[i].clone().lerp(path[i + 1], f - i);
}

// ---------------------------------------------------------------------------------------
// Live oak: short massive trunk splitting at 2-3 m into 4-6 sinuous limbs that spread almost
// horizontally; broad dome canopy 15-24 m wide and 11-13.5 m tall; Spanish moss.

export function buildLiveOak(b: PropBuild): void {
  const rng = b.rng;
  const v = b.variant % 3;
  const R = [9.2, 11.6, 7.8][v];
  const H = [11.4, 13.2, 12.2][v];
  const hs = rng.range(2.2, 3.0);
  const bark = b.part('bark');
  const leaf = b.part('oakLeaf');
  const sw = (y: number): Wind4 => [0.14 * clamp01(y / H) ** 2, 0, 0, 0];
  const barkCol = (y: number): RGB => mixRgb(rgb(0x6c645c), rgb(0xcfc8c0), smoothstep(0, 2.5, y));
  const s = R / 10;

  // Trunk with root flare.
  const lean = v3(rng.range(-0.35, 0.35), 0, rng.range(-0.35, 0.35));
  const top = v3(lean.x, hs, lean.z);
  const tp = [v3(0, -0.15, 0), v3(0, 0.3, 0), v3(lean.x * 0.45, hs * 0.55, lean.z * 0.45), top];
  const tr = [1.05, 0.8, 0.66, 0.6].map((r) => r * (0.85 + 0.15 * s));
  bark.tube(tp, tr, b.seg(8, 5), { uvScale: TILE_METRES.bark, colors: tp.map((p) => barkCol(p.y)), winds: tp.map((p) => sw(Math.max(0, p.y))) });

  const lobes: { c: V3; r: V3 }[] = [];
  const mossAt: V3[] = [];
  const nLimbs = [5, 6, 4][v];
  const az0 = rng.range(0, Math.PI * 2);
  const limbSides = b.seg(6, 4);
  const limbSegs = b.seg(6, 3);
  for (let i = 0; i < nLimbs; i++) {
    const az = az0 + (i / nLimbs) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const e0 = rng.range(0.55, 0.95);
    const L = R * rng.range(0.7, 0.86);
    const wig = rng.range(0, 6.28);
    const rise = rng.range(0.1, 0.45);
    const path: V3[] = [top.clone().add(v3(Math.cos(az) * 0.18, rng.range(-0.45, 0), Math.sin(az) * 0.18))];
    const p = path[0].clone();
    for (let k = 1; k <= limbSegs; k++) {
      const t = (k - 0.5) / limbSegs;
      const el = e0 * (1 - 1.25 * smoothstep(0, 0.7, t)) + rise * smoothstep(0.6, 1, t) + 0.12 * Math.sin(t * 7 + wig);
      const a = az + 0.3 * Math.sin(t * 4 + wig);
      p.add(v3(Math.cos(el) * Math.cos(a), Math.sin(el), Math.cos(el) * Math.sin(a)).multiplyScalar(L / limbSegs));
      p.y = Math.min(Math.max(p.y, 2.2), H - 3.6);
      path.push(p.clone());
    }
    const radii = path.map((_, k) => lerp(0.44, 0.08, Math.pow(k / limbSegs, 0.85)) * (0.85 + 0.15 * s));
    bark.tube(path, radii, limbSides, {
      uvScale: TILE_METRES.bark,
      colors: path.map((q) => barkCol(q.y)),
      winds: path.map((q) => sw(q.y)),
      capEnd: true,
    });
    const end = path[limbSegs];
    // Broad, flattish lobes: one over the limb tip, one over its middle.
    lobes.push({ c: end.clone().add(v3(0, rng.range(1.1, 1.6), 0)), r: v3(rng.range(3.4, 4.0) * s, rng.range(1.5, 1.9), rng.range(3.4, 4.0) * s) });
    lobes.push({ c: pointOnPath(path, 0.5).add(v3(0, rng.range(2.4, 3.1), 0)), r: v3(rng.range(2.6, 3.1) * s, rng.range(1.5, 1.8), rng.range(2.6, 3.1) * s) });
    for (let k = 0; k < 3; k++) mossAt.push(pointOnPath(path, rng.range(0.3, 0.95)));
    // Secondary branches rising into the canopy.
    const nb = rng.int(1, 2);
    for (let j = 0; j < nb; j++) {
      const t = rng.range(0.35, 0.75);
      const base = pointOnPath(path, t);
      const baz = az + (rng.chance(0.5) ? 1 : -1) * rng.range(0.5, 1.0);
      const bel = rng.range(0.45, 0.85);
      const bl = rng.range(2.4, 3.6) * s;
      const d = v3(Math.cos(bel) * Math.cos(baz), Math.sin(bel), Math.cos(bel) * Math.sin(baz));
      const bp = [base, base.clone().addScaledVector(d, bl * 0.5), base.clone().addScaledVector(d, bl).add(v3(0, bl * 0.15, 0))];
      for (const q of bp) q.y = Math.min(q.y, H - 2.8);
      bark.tube(bp, [0.15, 0.09, 0.035], b.seg(4, 3), { uvScale: TILE_METRES.bark, colors: bp.map((q) => barkCol(q.y)), winds: bp.map((q) => sw(q.y)), capEnd: true });
      lobes.push({ c: bp[2].clone().add(v3(0, 0.8, 0)), r: v3(rng.range(2.2, 2.7) * s, rng.range(1.4, 1.8), rng.range(2.2, 2.7) * s) });
    }
  }
  // Central dome over the trunk (flattened: live oaks are wider than tall).
  lobes.push({ c: v3(top.x, H - 2.3, top.z), r: v3(R * 0.5, 2.1, R * 0.5) });
  // Keep lobes inside the R x H envelope.
  for (const l of lobes) {
    const d = Math.hypot(l.c.x, l.c.z);
    const maxD = R - l.r.x - 0.6;
    if (d > maxD) {
      l.c.x *= maxD / d;
      l.c.z *= maxD / d;
    }
    const maxTop = H - 0.25 - l.r.y * 1.1;
    if (l.c.y > maxTop) l.c.y = maxTop;
  }
  // Leaf clumps on the lobe surfaces, skipping points buried inside other lobes.
  const areas = lobes.map((l) => l.r.x * l.r.z + l.r.x * l.r.y + l.r.z * l.r.y);
  const totalArea = areas.reduce((a, x) => a + x, 0);
  const budget = Math.round(330 * (0.5 + 0.5 * b.detail));
  const centre = v3(top.x, H * 0.55, top.z);
  const baseCol = rgb(0xffffff);
  let placed = 0;
  lobes.forEach((l, li) => {
    const n = Math.max(6, Math.round(((budget * areas[li]) / totalArea) * 1.45) + 4);
    for (let k = 0; k < n && placed < budget; k++) {
      const y = 1 - (2 * (k + 0.5)) / n;
      const rr = Math.sqrt(Math.max(0, 1 - y * y));
      const th = k * 2.39996 + rng.range(-0.3, 0.3) + li;
      const dir = v3(rr * Math.cos(th), y, rr * Math.sin(th));
      if (dir.y < -0.45 && rng.chance(0.55)) continue;
      const p = l.c.clone().add(v3(dir.x * l.r.x, dir.y * l.r.y, dir.z * l.r.z));
      let buried = false;
      for (let m = 0; m < lobes.length && !buried; m++) {
        if (m === li) continue;
        const o = lobes[m];
        const q = v3((p.x - o.c.x) / o.r.x, (p.y - o.c.y) / o.r.y, (p.z - o.c.z) / o.r.z);
        if (q.lengthSq() < 0.72) buried = true;
      }
      if (buried) continue;
      const nrm = v3(dir.x / l.r.x, dir.y / l.r.y, dir.z / l.r.z).normalize();
      // Break up the shell: push clumps in / out and tilt them off the lobe normal.
      p.addScaledVector(nrm, rng.range(-0.4, 0.25));
      const tilted = nrm.clone().add(v3(rng.range(-0.55, 0.55), rng.range(-0.3, 0.45), rng.range(-0.55, 0.55))).normalize();
      const depth = smoothstep(hs, H, p.y) * (0.65 + 0.35 * Math.max(0, nrm.y));
      const ao = lerp(0.5, 1.08, depth) * rng.range(0.88, 1.08);
      const hue = rng.chance(0.3) ? rgb(0xf0ffd8) : baseCol;
      addClump(leaf, rng, p, tilted, rng.range(1.9, 2.5) * (0.8 + 0.2 * s), {
        rect: rng.chance(0.5) ? FOLIAGE.oakA : FOLIAGE.oakB,
        color: mulRgb(hue, ao),
        wind: [sw(p.y)[0], rng.range(0.05, 0.09), rng.next(), 1],
        center: centre,
      });
      placed++;
    }
  });
  // Spanish moss hanging under the limbs (larger / older trees).
  const mossCount = [10, 16, 6][v];
  const moss = FOLIAGE.moss;
  for (let i = 0; i < mossCount && i < mossAt.length; i++) {
    const a = mossAt[(i * 7) % mossAt.length].clone().add(v3(rng.range(-0.3, 0.3), -0.12, rng.range(-0.3, 0.3)));
    const len = rng.range(0.9, 1.7);
    const w = rng.range(0.45, 0.7);
    const ang = rng.range(0, Math.PI);
    const col = rgb(0xffffff, rng.range(0.85, 1.05));
    for (const da of [0, Math.PI / 2]) {
      const dx = Math.cos(ang + da) * w * 0.5, dz = Math.sin(ang + da) * w * 0.5;
      const nrm = v3(Math.sin(ang + da), 0.4, -Math.cos(ang + da)).normalize();
      const wTop: Wind4 = [sw(a.y)[0], 0.02, (i * 0.37) % 1, 0];
      const wBot: Wind4 = [sw(a.y)[0], 0.16, (i * 0.37 + 0.2) % 1, 1];
      const i0 = leaf.vert(a.x - dx, a.y - len, a.z - dz, nrm.x, nrm.y, nrm.z, moss.u0, moss.v0, col, wBot);
      const i1 = leaf.vert(a.x + dx, a.y - len, a.z + dz, nrm.x, nrm.y, nrm.z, moss.u1, moss.v0, col, wBot);
      const i2 = leaf.vert(a.x + dx, a.y, a.z + dz, nrm.x, nrm.y, nrm.z, moss.u1, moss.v1, col, wTop);
      const i3 = leaf.vert(a.x - dx, a.y, a.z - dz, nrm.x, nrm.y, nrm.z, moss.u0, moss.v1, col, wTop);
      leaf.quad(i0, i1, i2, i3);
    }
  }
}

// ---------------------------------------------------------------------------------------
// Shrubs: 0: clusia / sea-grape-like green shrub 1.4 m, 1: croton 1.0 m (red / yellow /
// green variegated), 2: bougainvillea 1.9 m (magenta bracts), 3: ixora 0.85 m (red flowers).

export function buildShrub(b: PropBuild): void {
  const rng = b.rng;
  const v = b.variant % 4;
  const h = [1.4, 1.0, 1.9, 0.85][v];
  const rx = [0.85, 0.6, 1.1, 0.65][v];
  const rect = [FOLIAGE.shrubGreen, FOLIAGE.shrubCroton, FOLIAGE.shrubFlower, FOLIAGE.ixora][v];
  const leaf = b.part('oakLeaf');
  const bark = b.part('bark');
  const stems = rng.int(3, 4);
  for (let i = 0; i < stems; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0.05, 0.15);
    const p0 = v3(Math.cos(a) * d, -0.05, Math.sin(a) * d);
    const p1 = v3(Math.cos(a) * (d + rx * 0.25), h * 0.3, Math.sin(a) * (d + rx * 0.25));
    const p2 = v3(Math.cos(a) * (d + rx * 0.45), h * 0.55, Math.sin(a) * (d + rx * 0.45));
    bark.tube([p0, p1, p2], [0.03, 0.022, 0.012], 3, {
      uvScale: 0.6,
      colors: [rgb(0x806a58), rgb(0x907868), rgb(0x9a8070)],
      winds: [[0, 0, 0, 0], [0.01, 0.01, 0, 0], [0.02, 0.02, 0, 0]],
    });
  }
  const c = v3(0, h * 0.56, 0);
  const r = v3(rx, h * 0.44, rx * 0.92);
  const n = Math.max(8, Math.round([14, 12, 16, 11][v] * (0.6 + 0.4 * b.detail)));
  for (let k = 0; k < n; k++) {
    const y = 1 - (2 * (k + 0.5)) / n;
    if (y < -0.75) continue;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = k * 2.39996 + rng.range(-0.3, 0.3);
    const dir = v3(rr * Math.cos(th), y, rr * Math.sin(th));
    const p = c.clone().add(v3(dir.x * r.x * 0.8, dir.y * r.y * 0.8, dir.z * r.z * 0.8));
    const nrm = v3(dir.x / r.x, dir.y / r.y, dir.z / r.z).normalize();
    const ao = lerp(0.6, 1.05, clamp01(p.y / h)) * rng.range(0.92, 1.06);
    addClump(leaf, rng, p, nrm, rx * rng.range(1.0, 1.25), {
      rect,
      color: rgb(0xffffff, ao),
      wind: [0, 0.03 + 0.03 * clamp01(p.y / h), rng.next(), 1],
      center: c,
      lobeWeight: 0.45,
    });
  }
  // Core fill so the shrub is not hollow.
  addClump(leaf, rng, c.clone(), UP.clone(), rx * 1.5, { rect, color: rgb(0xffffff, 0.62), wind: [0, 0.02, 0.3, 0], center: c, lobeWeight: 0.2 });
}

// ---------------------------------------------------------------------------------------
// Hedges (clipped ficus / clusia): length along X, depth along Z, origin at the centre of the
// base. 0: 2.0 x 0.8 x 1.2 m, 1: 3.0 x 1.0 x 1.8 m, 2: 1.5 x 0.7 x 0.9 m (low border).

export function buildHedge(b: PropBuild): void {
  const rng = b.rng;
  const v = b.variant % 3;
  const [L, H, D] = [[2.0, 1.2, 0.8], [3.0, 1.8, 1.0], [1.5, 0.9, 0.7]][v];
  const leaf = b.part('oakLeaf');
  const rr = Math.min(0.16, D * 0.2);
  const hx = L / 2, hz = D / 2;
  const inner = (p: V3): V3 => v3(Math.min(hx - rr, Math.max(-hx + rr, p.x)), Math.min(H - rr, p.y), Math.min(hz - rr, Math.max(-hz + rr, p.z)));
  const bump = (p: V3): number => 0.035 * Math.sin(p.x * 7.3 + p.y * 3.1) * Math.cos(p.z * 5.7 - p.y * 4.3);
  const round = (p: V3): { p: V3; n: V3 } => {
    const q = inner(p);
    const d = p.clone().sub(q);
    const n = d.lengthSq() > 1e-10 ? d.normalize() : UP.clone();
    const out = q.clone().addScaledVector(n, rr + bump(p));
    return { p: out, n };
  };
  const rect = FOLIAGE.hedge;
  const cell = 0.62;
  const face = (origin: V3, du: V3, dv: V3, nu: number, nv: number) => {
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const corners = [
          [i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1],
        ].map(([a, c]) => round(origin.clone().addScaledVector(du, a / nu).addScaledVector(dv, c / nv)));
        const ids = corners.map((k, m) => {
          const [u, vv] = [[rect.u0, rect.v0], [rect.u1, rect.v0], [rect.u1, rect.v1], [rect.u0, rect.v1]][m];
          const shade = lerp(0.62, 1.0, clamp01(k.p.y / H));
          return leaf.vtx(k.p, k.n, u, vv, rgb(0xffffff, shade), [0, 0.006, 0, 0]);
        });
        leaf.quad(ids[0], ids[1], ids[2], ids[3]);
      }
    }
  };
  const nx = Math.max(2, Math.round((L / cell) * b.detail));
  const ny = Math.max(1, Math.round((H / cell) * b.detail));
  const nz = Math.max(1, Math.round((D / cell) * b.detail));
  // Sides (bottom edge at y = 0.02), ends and top; viewed from outside each is CCW.
  face(v3(hx, 0.02, -hz), v3(-L, 0, 0), v3(0, H, 0), nx, ny); // -Z
  face(v3(-hx, 0.02, hz), v3(L, 0, 0), v3(0, H, 0), nx, ny); // +Z
  face(v3(hx, 0.02, hz), v3(0, 0, -D), v3(0, H, 0), nz, ny); // +X
  face(v3(-hx, 0.02, -hz), v3(0, 0, D), v3(0, H, 0), nz, ny); // -X
  face(v3(-hx, H, hz), v3(L, 0, 0), v3(0, 0, -D), nx, nz); // top
  // Fringe of loose shoots along the top edges.
  const shoots = Math.max(2, Math.round((L / 0.34) * b.detail));
  for (const side of [-1, 1]) {
    for (let i = 0; i < shoots; i++) {
      const x = -hx + ((i + rng.range(0.1, 0.9)) / shoots) * L;
      const base = v3(x, H - rng.range(0.03, 0.12), side * (hz - 0.06));
      const out = v3(rng.range(-0.3, 0.3), rng.range(0.5, 0.9), side * rng.range(0.5, 0.8)).normalize();
      addClump(leaf, rng, base.clone().addScaledVector(out, 0.06), out, rng.range(0.2, 0.3), {
        rect: FOLIAGE.shrubGreen,
        color: rgb(0xffffff, 1.0),
        wind: [0, 0.03, rng.next(), 1],
        center: v3(x, H * 0.5, 0),
        crossed: false,
        lobeWeight: 0.7,
      });
    }
  }
}

// ---------------------------------------------------------------------------------------
// Grass clumps: 0: lawn / roadside tuft 0.45 m, 1: sea oats on dunes 1.1 m (seed heads),
// 2: dry bunch grass 0.65 m. Three crossed, slightly bent cards.

export function buildGrassClump(b: PropBuild): void {
  const rng = b.rng;
  const v = b.variant % 3;
  const h = [0.45, 1.1, 0.65][v];
  const w = [0.55, 0.75, 0.6][v];
  const rect = [FOLIAGE.grass, FOLIAGE.duneGrass, FOLIAGE.grassDry][v];
  const leaf = b.part('oakLeaf');
  const cards = 3;
  const a0 = rng.range(0, Math.PI);
  for (let k = 0; k < cards; k++) {
    const a = a0 + (k * Math.PI) / cards + rng.range(-0.2, 0.2);
    const dx = (Math.cos(a) * w) / 2, dz = (Math.sin(a) * w) / 2;
    const lean = v3(rng.range(-0.12, 0.12), 0, rng.range(-0.12, 0.12)).multiplyScalar(h);
    const rows: [number, number][] = [];
    for (let j = 0; j <= 2; j++) {
      const t = j / 2;
      const y = h * t * (1 - 0.08 * t);
      const off = lean.clone().multiplyScalar(t * t);
      const spread = 1 + 0.35 * t;
      const nrm = v3(Math.sin(a) * 0.3, 1, -Math.cos(a) * 0.3).normalize();
      const col = rgb(0xffffff, lerp(0.65, 1.05, t));
      const wind: Wind4 = [0, 0.1 * h * Math.pow(t, 1.5), (k * 0.31 + rng.next() * 0.2) % 1, 1];
      const [u0, u1] = [rect.u0, rect.u1];
      const vv = rect.v0 + (rect.v1 - rect.v0) * t;
      const i0 = leaf.vert(-dx * spread + off.x, y, -dz * spread + off.z, nrm.x, nrm.y, nrm.z, u0, vv, col, wind);
      const i1 = leaf.vert(dx * spread + off.x, y, dz * spread + off.z, nrm.x, nrm.y, nrm.z, u1, vv, col, wind);
      rows.push([i0, i1]);
    }
    for (let j = 0; j < 2; j++) leaf.quad(rows[j][0], rows[j][1], rows[j + 1][1], rows[j + 1][0]);
  }
}
