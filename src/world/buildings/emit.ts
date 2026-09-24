// Writes building geometry into the shared buckets: facade walls (with the per-vertex
// facade parameters the facade shader reads) and detail surfaces (roofs, parapets,
// awnings, equipment...). No three.js here: this runs in workers too.

import earcut from 'earcut';
import type { BucketBuilder, MeshBuilder } from '../mesh/meshData';
import type { P2, Ring } from '../types';
import type { RGB } from './colors';
import { BUILDING_DETAIL_KEY, BUILDING_FACADE_KEY, DETAIL_ATTRS, FACADE_ATTRS } from './constants';
import { Frame, centroid, edgeLength, edgeNormal, insetRing } from './geom';

export type V3 = readonly [number, number, number];
export type UV4 = readonly [number, number, number, number, number, number, number, number];

/** Everything the facade shader needs to draw one wall. Lengths in metres. */
export interface FacadeSpec {
  floorH: number;
  /** Target bay width; walls fit a whole number of bays. */
  bayW: number;
  groundH: number;
  /** Height above the base where the window zone ends (parapet above). */
  topH: number;
  winW: number;
  winH: number;
  sill: number;
  depth: number;
  pattern: number;
  ground: number;
  glass: number;
  surface: number;
  /** Per-building random in [0, 1). */
  seed: number;
  wall: RGB;
  trim: RGB;
  occ: number;
  crown: number;
  flags: number;
}

/** How a straight wall was laid out (for placing eyebrows, awnings, signs, doors). */
export interface WallLayout {
  /** Right end (as seen from outside) = ring edge start. */
  p: P2;
  /** Left end = ring edge end; u = 0 here. */
  q: P2;
  len: number;
  /** Outward normal. */
  n: P2;
  /** Unit vector from q to p (direction of increasing u). */
  t: P2;
  nBays: number;
  bayW: number;
  winW: number;
  y0: number;
  y1: number;
}

export function wallPoint(w: WallLayout, u: number, out = 0): P2 {
  return { x: w.q.x + w.t.x * u + w.n.x * out, z: w.q.z + w.t.z * u + w.n.z * out };
}

export interface WallOpts {
  /** Ground floor treatment per bay (consecutive equal bays share one quad). */
  groundOf?: (bay: number, nBays: number) => number;
  /** Facade spec per bay (return the same object for bays that belong together). */
  specOf?: (bay: number, nBays: number) => FacadeSpec;
  /** Force the number of bays. */
  bays?: number;
  /** World Y where v = 0 (the ground floor level); defaults to the building base. */
  vBase?: number;
}

/** Box face masks. */
export const FACE = { BOTTOM: 1, TOP: 2, FRONT: 4, BACK: 8, LEFT: 16, RIGHT: 32, SIDES: 60, ALL: 63, NO_BOTTOM: 62 } as const;

export class Emitter {
  readonly fac: MeshBuilder;
  readonly det: MeshBuilder;
  private readonly tris0: number;
  /** Per-building random written into the detail attribute. */
  seed = 0;

  /** lod 1 merges each wall into a single quad (no per-bay ground floor segments). */
  constructor(out: BucketBuilder, readonly baseY: number, readonly lod: 0 | 1 = 0) {
    this.fac = out.get(BUILDING_FACADE_KEY);
    for (const [k, n] of Object.entries(FACADE_ATTRS)) this.fac.declareExtra(k, n);
    this.det = out.get(BUILDING_DETAIL_KEY);
    for (const [k, n] of Object.entries(DETAIL_ATTRS)) this.det.declareExtra(k, n);
    this.tris0 = (this.fac.indices.length + this.det.indices.length) / 3;
  }

  /** Triangles emitted by this emitter so far. */
  get triangles(): number {
    return (this.fac.indices.length + this.det.indices.length) / 3 - this.tris0;
  }

  // ------------------------------------------------------------------ facade walls

  private facExtra(s: FacadeSpec, bayW: number, winW: number, ground: number): Record<string, readonly number[]> {
    return {
      facA: [s.floorH, bayW, s.groundH, s.topH],
      facB: [winW, s.winH, s.sill, s.depth],
      facC: [s.pattern, ground, s.seed, s.glass + 8 * s.surface],
      facD: [s.trim[0], s.trim[1], s.trim[2], s.occ + 4 * s.crown + 32 * s.flags],
    };
  }

  private facQuad(a: P2, b: P2, na: P2, nb: P2, ua: number, ub: number, y0: number, y1: number, col: RGB, extra: Record<string, readonly number[]>, vBase = this.baseY): void {
    const v0 = y0 - vBase;
    const v1 = y1 - vBase;
    const f = this.fac;
    const i0 = f.vertex(a.x, y0, a.z, na.x, 0, na.z, ua, v0, col, extra);
    const i1 = f.vertex(b.x, y0, b.z, nb.x, 0, nb.z, ub, v0, col, extra);
    const i2 = f.vertex(b.x, y1, b.z, nb.x, 0, nb.z, ub, v1, col, extra);
    const i3 = f.vertex(a.x, y1, a.z, na.x, 0, na.z, ua, v1, col, extra);
    f.quad(i0, i1, i2, i3);
  }

  /**
   * A facade wall along ring edge p->q (positive ring, outward normal on the street side),
   * from y0 to y1 (world). Bays are fitted to the wall length; `groundOf` picks the ground
   * floor treatment per bay (consecutive equal bays share one quad).
   */
  wall(p: P2, q: P2, y0: number, y1: number, s: FacadeSpec, opts?: WallOpts): WallLayout | null {
    const len = edgeLength(p, q);
    if (len < 0.05 || y1 - y0 < 0.01) return null;
    const n = edgeNormal(p, q);
    const t = { x: (p.x - q.x) / len, z: (p.z - q.z) / len };
    const nBays = Math.max(1, opts?.bays ?? Math.round(len / Math.max(0.3, s.bayW)));
    const bayW = len / nBays;
    const winW = fitWindow(s, bayW);
    const layout: WallLayout = { p, q, len, n, t, nBays, bayW, winW, y0, y1 };
    const merge = this.lod === 1;
    const g = (b: number): number => (opts?.groundOf && !merge ? opts.groundOf(b, nBays) : s.ground);
    const sp = (b: number): FacadeSpec => (opts?.specOf && !merge ? opts.specOf(b, nBays) : s);
    let start = 0;
    let gs = g(0);
    let ss = sp(0);
    for (let b = 1; b <= nBays; b++) {
      const gb = b < nBays ? g(b) : -1;
      const sb = b < nBays ? sp(b) : null;
      if (gb !== gs || sb !== ss) {
        const ua = start * bayW;
        const ub = b * bayW;
        this.facQuad(wallPoint(layout, ua), wallPoint(layout, ub), n, n, ua, ub, y0, y1, ss.wall, this.facExtra(ss, bayW, fitWindow(ss, bayW), gs), opts?.vBase);
        start = b;
        gs = gb;
        if (sb) ss = sb;
      }
    }
    return layout;
  }

  /**
   * Gable-end triangle above ring edge p->q (facade bucket; blank because it lies above topH).
   * The apex sits at fraction `apexT` of the way from the left end q to p.
   */
  gable(p: P2, q: P2, yEave: number, yRidge: number, s: FacadeSpec, apexT = 0.5): void {
    const len = edgeLength(p, q);
    if (len < 0.05 || yRidge - yEave < 0.01) return;
    const n = edgeNormal(p, q);
    const ex = this.facExtra(s, len, 0, s.ground);
    const f = this.fac;
    const m = { x: q.x + (p.x - q.x) * apexT, z: q.z + (p.z - q.z) * apexT };
    const v0 = yEave - this.baseY;
    const i0 = f.vertex(q.x, yEave, q.z, n.x, 0, n.z, 0, v0, s.wall, ex);
    const i1 = f.vertex(p.x, yEave, p.z, n.x, 0, n.z, len, v0, s.wall, ex);
    const i2 = f.vertex(m.x, yRidge, m.z, n.x, 0, n.z, len * apexT, yRidge - this.baseY, s.wall, ex);
    f.tri(i0, i1, i2);
  }

  /**
   * A curved or faceted run of walls through ring points pts[0..k] (in ring order), with
   * continuous u and smooth normals. nStart / nEnd override the end normals (tangent walls).
   */
  wallStrip(pts: readonly P2[], y0: number, y1: number, s: FacadeSpec, ground: number, nStart?: P2, nEnd?: P2): { us: number[]; normals: P2[]; bayW: number; winW: number } | null {
    const k = pts.length - 1;
    if (k < 1) return null;
    const lens: number[] = [];
    let total = 0;
    for (let j = 0; j < k; j++) {
      const l = edgeLength(pts[j], pts[j + 1]);
      lens.push(l);
      total += l;
    }
    if (total < 0.05) return null;
    // u runs from the left end (last point) to the right end (first point)
    const us: number[] = new Array(k + 1).fill(0);
    for (let j = k - 1; j >= 0; j--) us[j] = us[j + 1] + lens[j];
    const facetN = pts.slice(0, k).map((p, j) => edgeNormal(p, pts[j + 1]));
    const normals: P2[] = [];
    for (let j = 0; j <= k; j++) {
      let nx: number;
      let nz: number;
      if (j === 0) {
        const e = nStart ?? facetN[0];
        nx = e.x;
        nz = e.z;
      } else if (j === k) {
        const e = nEnd ?? facetN[k - 1];
        nx = e.x;
        nz = e.z;
      } else {
        nx = facetN[j - 1].x + facetN[j].x;
        nz = facetN[j - 1].z + facetN[j].z;
      }
      const l = Math.hypot(nx, nz) || 1;
      normals.push({ x: nx / l, z: nz / l });
    }
    const nBays = Math.max(1, Math.round(total / Math.max(0.3, s.bayW)));
    const bayW = total / nBays;
    const winW = fitWindow(s, bayW);
    const ex = this.facExtra(s, bayW, winW, ground);
    for (let j = 0; j < k; j++) {
      // edge pts[j] -> pts[j+1]: left end is pts[j+1]
      this.facQuad(pts[j + 1], pts[j], normals[j + 1], normals[j], us[j + 1], us[j], y0, y1, s.wall, ex);
    }
    return { us, normals, bayW, winW };
  }

  // ------------------------------------------------------------------ detail geometry

  private dv(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, col: RGB, surf: number, p1: number, p2: number): number {
    return this.det.vertex(x, y, z, nx, ny, nz, u, v, col, { detA: [surf, this.seed, p1, p2] });
  }

  /** Planar quad a-b-c-d, counter-clockwise seen from the front. uv = [ua,va, ub,vb, uc,vc, ud,vd]. */
  quad(a: V3, b: V3, c: V3, d: V3, uv: UV4, col: RGB, surf: number, p1 = 0, p2 = 0): void {
    const n = triNormal(a, b, c) ?? triNormal(a, c, d);
    if (!n) return;
    const i0 = this.dv(a[0], a[1], a[2], n[0], n[1], n[2], uv[0], uv[1], col, surf, p1, p2);
    const i1 = this.dv(b[0], b[1], b[2], n[0], n[1], n[2], uv[2], uv[3], col, surf, p1, p2);
    const i2 = this.dv(c[0], c[1], c[2], n[0], n[1], n[2], uv[4], uv[5], col, surf, p1, p2);
    const i3 = this.dv(d[0], d[1], d[2], n[0], n[1], n[2], uv[6], uv[7], col, surf, p1, p2);
    this.det.quad(i0, i1, i2, i3);
  }

  tri(a: V3, b: V3, c: V3, uv: readonly [number, number, number, number, number, number], col: RGB, surf: number, p1 = 0, p2 = 0): void {
    const n = triNormal(a, b, c);
    if (!n) return;
    const i0 = this.dv(a[0], a[1], a[2], n[0], n[1], n[2], uv[0], uv[1], col, surf, p1, p2);
    const i1 = this.dv(b[0], b[1], b[2], n[0], n[1], n[2], uv[2], uv[3], col, surf, p1, p2);
    const i2 = this.dv(c[0], c[1], c[2], n[0], n[1], n[2], uv[4], uv[5], col, surf, p1, p2);
    this.det.tri(i0, i1, i2);
  }

  /** Quad whose winding is chosen so that its normal points along `expect`. */
  oquad(a: V3, b: V3, c: V3, d: V3, uv: UV4, expect: V3, col: RGB, surf: number, p1 = 0, p2 = 0): void {
    const n = triNormal(a, b, c) ?? triNormal(a, c, d);
    if (!n) return;
    if (n[0] * expect[0] + n[1] * expect[1] + n[2] * expect[2] >= 0) this.quad(a, b, c, d, uv, col, surf, p1, p2);
    else this.quad(a, d, c, b, [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]], col, surf, p1, p2);
  }

  otri(a: V3, b: V3, c: V3, uv: readonly [number, number, number, number, number, number], expect: V3, col: RGB, surf: number, p1 = 0, p2 = 0): void {
    const n = triNormal(a, b, c);
    if (!n) return;
    if (n[0] * expect[0] + n[1] * expect[1] + n[2] * expect[2] >= 0) this.tri(a, b, c, uv, col, surf, p1, p2);
    else this.tri(a, c, b, [uv[0], uv[1], uv[4], uv[5], uv[2], uv[3]], col, surf, p1, p2);
  }

  /** Vertical detail quad along ring edge p->q (outward normal like a wall). v = y - base. */
  vquad(p: P2, q: P2, y0: number, y1: number, col: RGB, surf: number, p1 = 0, p2 = 0, u0 = 0): void {
    const len = edgeLength(p, q);
    if (len < 1e-3 || y1 - y0 < 1e-3) return;
    const b = this.baseY;
    this.quad([q.x, y0, q.z], [p.x, y0, p.z], [p.x, y1, p.z], [q.x, y1, q.z], [u0, y0 - b, u0 + len, y0 - b, u0 + len, y1 - b, u0, y1 - b], col, surf, p1, p2);
  }

  /** Horizontal quad at height y (corners in any consistent order), facing up or down. */
  hquad(a: P2, b: P2, c: P2, d: P2, y: number, up: boolean, col: RGB, surf: number, frame?: Frame, p1 = 0, p2 = 0): void {
    let pts = [a, b, c, d];
    const cy = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if ((cy > 0) !== up) pts = [a, d, c, b];
    const uv = pts.map((p) => (frame ? frame.toLocal(p) : p));
    this.quad(
      [pts[0].x, y, pts[0].z], [pts[1].x, y, pts[1].z], [pts[2].x, y, pts[2].z], [pts[3].x, y, pts[3].z],
      [uv[0].x, uv[0].z, uv[1].x, uv[1].z, uv[2].x, uv[2].z, uv[3].x, uv[3].z],
      col, surf, p1, p2,
    );
  }

  /** Flat polygon (earcut) at height y. UVs are local frame coordinates (or world x/z). */
  flat(ring: readonly P2[], y: number, up: boolean, col: RGB, surf: number, frame?: Frame, p1 = 0, p2 = 0): void {
    if (ring.length < 3) return;
    const coords: number[] = [];
    for (const p of ring) coords.push(p.x, p.z);
    const idx = earcut(coords);
    if (idx.length === 0) return;
    const ny = up ? 1 : -1;
    const base: number[] = [];
    for (const p of ring) {
      const uv = frame ? frame.toLocal(p) : p;
      base.push(this.dv(p.x, y, p.z, 0, ny, 0, uv.x, uv.z, col, surf, p1, p2));
    }
    for (let i = 0; i < idx.length; i += 3) {
      const a = ring[idx[i]];
      const b = ring[idx[i + 1]];
      const c = ring[idx[i + 2]];
      const cy = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      if (Math.abs(cy) < 1e-12) continue;
      if ((cy > 0) === up) this.det.tri(base[idx[i]], base[idx[i + 1]], base[idx[i + 2]]);
      else this.det.tri(base[idx[i]], base[idx[i + 2]], base[idx[i + 1]]);
    }
  }

  /** Vertical prism of a ring (detail bucket): sides, optional top and bottom. */
  prism(ring: readonly P2[], y0: number, y1: number, col: RGB, surf: number, top = true, bottom = false, frame?: Frame, topCol?: RGB, topSurf?: number, p1 = 0, p2 = 0): void {
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      this.vquad(p, q, y0, y1, col, surf, p1, p2, u);
      u += edgeLength(p, q);
    }
    if (top) this.flat(ring, y1, true, topCol ?? col, topSurf ?? surf, frame, p1, p2);
    if (bottom) this.flat(ring, y0, false, col, surf, frame, p1, p2);
  }

  /** Axis-aligned box in a local frame (x across, z depth). */
  box(f: Frame, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: RGB, surf: number, faces: number = FACE.NO_BOTTOM, p1 = 0, p2 = 0, topCol?: RGB, topSurf?: number): void {
    if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return;
    const c00 = f.toWorld(x0, z0);
    const c10 = f.toWorld(x1, z0);
    const c11 = f.toWorld(x1, z1);
    const c01 = f.toWorld(x0, z1);
    if (faces & FACE.FRONT) this.vquad(c00, c10, y0, y1, col, surf, p1, p2);
    if (faces & FACE.RIGHT) this.vquad(c10, c11, y0, y1, col, surf, p1, p2);
    if (faces & FACE.BACK) this.vquad(c11, c01, y0, y1, col, surf, p1, p2);
    if (faces & FACE.LEFT) this.vquad(c01, c00, y0, y1, col, surf, p1, p2);
    if (faces & FACE.TOP) this.hquad(c00, c10, c11, c01, y1, true, topCol ?? col, topSurf ?? surf, f, p1, p2);
    if (faces & FACE.BOTTOM) this.hquad(c00, c10, c11, c01, y0, false, col, surf, f, p1, p2);
  }

  /** Vertical cylinder (n sides) with optional flat or conical top. */
  cylinder(cx: number, cz: number, r: number, y0: number, y1: number, sides: number, col: RGB, surf: number, cone = 0, topCol?: RGB): void {
    const ring: P2[] = [];
    for (let i = 0; i < sides; i++) {
      // increasing angle in x/z = positive signed area (see types.ts)
      const a = (i / sides) * Math.PI * 2;
      ring.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
    }
    let u = 0;
    for (let i = 0; i < sides; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % sides];
      this.vquad(p, q, y0, y1, col, surf, 0, 0, u);
      u += edgeLength(p, q);
    }
    const tc = topCol ?? col;
    if (cone > 0) {
      for (let i = 0; i < sides; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % sides];
        // front-facing from outside/above: q, p, apex
        this.tri([q.x, y1, q.z], [p.x, y1, p.z], [cx, y1 + cone, cz], [0, 0, r, 0, r / 2, r], tc, surf);
      }
    } else {
      this.flat(ring, y1, true, tc, surf);
    }
  }

  /**
   * Parapet on a flat roof: inner faces from the roof up to the top and the coping cap.
   * `outer` is the wall ring; the cap is `thick` wide.
   */
  parapet(outer: readonly P2[], yRoof: number, yTop: number, thick: number, innerCol: RGB, capCol: RGB): Ring {
    const inner = insetSameCount(outer, thick);
    for (let i = 0; i < inner.length; i++) {
      const p = inner[i];
      const q = inner[(i + 1) % inner.length];
      // reversed edge so the face points inward (toward the roof)
      this.vquad(q, p, yRoof, yTop, innerCol, 0);
    }
    for (let i = 0; i < outer.length; i++) {
      const j = (i + 1) % outer.length;
      this.hquad(outer[i], outer[j], inner[j], inner[i], yTop, true, capCol, 0);
    }
    return inner;
  }
}

/** Window width that fits a bay for the pattern (0 = no windows). */
export function fitWindow(s: FacadeSpec, bayW: number): number {
  const pier = s.pattern === 2 || s.pattern === 3 || s.pattern === 4 || s.pattern === 6 ? 0.08 : 0.45;
  const w = Math.min(s.winW, bayW - pier);
  return w < 0.35 ? 0 : w;
}

function triNormal(a: V3, b: V3, c: V3): V3 | null {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-10) return null;
  return [nx / l, ny / l, nz / l];
}

/** Inset keeping the vertex count (needed to pair outer/inner rings for parapet caps). */
export function insetSameCount(ring: readonly P2[], d: number): Ring {
  const r = insetRing(ring, d);
  if (r && r.length === ring.length) return r;
  const c = centroid(ring);
  return ring.map((p) => {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const l = Math.hypot(dx, dz) || 1;
    const k = Math.max(0.05, (l - d * 1.2) / l);
    return { x: c.x + dx * k, z: c.z + dz * k };
  });
}
