// Drapes flat polygons over the terrain. Polygons are triangulated with earcut and each
// triangle is cut along a fixed world grid, so every vertex lies on an original edge or
// a grid line. Neighbouring triangles then share identical vertices (no T-junctions),
// and heights sampled per vertex never open cracks.
import earcut from 'earcut';
import type { PolygonWithHoles } from '../types';
import type { MeshBuilder } from './meshData';

export type HeightFn = (x: number, z: number) => number;

export interface DrapeOptions {
  /** Grid cell size (m) used to subdivide large triangles (Infinity = none). */
  cell: number;
  /** Resample polygon rings so no edge is longer than this (m) before triangulating. */
  resample?: number;
  /** Height of the surface at (x, z). */
  height: HeightFn;
  /** Texture coordinates = world metres * uvScale. */
  uvScale?: number;
  color?: readonly [number, number, number];
  /** Per-vertex colour function (overrides color). */
  colorFn?: (x: number, z: number) => readonly [number, number, number];
  /** Compute normals from the height function (else straight up). */
  slopeNormals?: boolean;
}

export function drapePolygon(poly: PolygonWithHoles, out: MeshBuilder, opts: DrapeOptions): void {
  const coords: number[] = [];
  const holes: number[] = [];
  const ringPoints = (r: readonly { x: number; z: number }[]): { x: number; z: number }[] => {
    if (!opts.resample) return r as { x: number; z: number }[];
    const out: { x: number; z: number }[] = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / opts.resample));
      for (let k = 0; k < steps; k++) out.push({ x: a.x + ((b.x - a.x) * k) / steps, z: a.z + ((b.z - a.z) * k) / steps });
    }
    return out;
  };
  for (const p of ringPoints(poly.outer)) coords.push(p.x, p.z);
  for (const h of poly.holes) {
    holes.push(coords.length / 2);
    for (const p of ringPoints(h)) coords.push(p.x, p.z);
  }
  if (coords.length < 6) return;
  const tris = earcut(coords, holes.length ? holes : undefined, 2);
  const vmap = new Map<string, number>();
  const vert = (x: number, z: number): number => {
    // Quantise to 1 mm so shared points map to one vertex.
    const key = `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
    let idx = vmap.get(key);
    if (idx !== undefined) return idx;
    const y = opts.height(x, z);
    let nx = 0;
    let ny = 1;
    let nz = 0;
    if (opts.slopeNormals) {
      const e = 1.5;
      const hx = opts.height(x + e, z) - opts.height(x - e, z);
      const hz = opts.height(x, z + e) - opts.height(x, z - e);
      const l = Math.hypot(hx, 2 * e, hz);
      nx = -hx / l;
      ny = (2 * e) / l;
      nz = -hz / l;
    }
    const s = opts.uvScale ?? 1;
    idx = out.vertex(x, y, z, nx, ny, nz, x * s, z * s, opts.colorFn ? opts.colorFn(x, z) : opts.color);
    vmap.set(key, idx);
    return idx;
  };
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 2;
    const b = tris[t + 1] * 2;
    const c = tris[t + 2] * 2;
    clipTriangleToGrid(
      [coords[a], coords[a + 1]],
      [coords[b], coords[b + 1]],
      [coords[c], coords[c + 1]],
      opts.cell,
      (poly) => {
        // Fan-triangulate the convex piece. Earcut's winding is arbitrary; make faces point up.
        const ids = poly.map(([x, z]) => vert(x, z));
        for (let i = 1; i + 1 < poly.length; i++) {
          const [x0, z0] = poly[0];
          const [x1, z1] = poly[i];
          const [x2, z2] = poly[i + 1];
          const cross = (x1 - x0) * (z2 - z0) - (z1 - z0) * (x2 - x0);
          if (Math.abs(cross) < 1e-9) continue;
          // Upward facing (+Y normal) triangles have negative cross in x/z order.
          if (cross < 0) out.tri(ids[0], ids[i], ids[i + 1]);
          else out.tri(ids[0], ids[i + 1], ids[i]);
        }
      },
    );
  }
}

type V2 = [number, number];

/** Splits a triangle into convex pieces, one per grid cell it overlaps. */
function clipTriangleToGrid(a: V2, b: V2, c: V2, cell: number, emit: (poly: V2[]) => void): void {
  const minX = Math.min(a[0], b[0], c[0]);
  const maxX = Math.max(a[0], b[0], c[0]);
  const minZ = Math.min(a[1], b[1], c[1]);
  const maxZ = Math.max(a[1], b[1], c[1]);
  if (!Number.isFinite(cell)) {
    emit([a, b, c]);
    return;
  }
  const i0 = Math.floor(minX / cell);
  const i1 = Math.floor(maxX / cell);
  const j0 = Math.floor(minZ / cell);
  const j1 = Math.floor(maxZ / cell);
  if (i0 === i1 && j0 === j1) {
    emit([a, b, c]);
    return;
  }
  for (let i = i0; i <= i1; i++) {
    // Strip between x = i*cell and (i+1)*cell.
    let strip: V2[] = [a, b, c];
    if (i > i0) strip = clipAxis(strip, 0, i * cell, 1);
    if (i < i1) strip = clipAxis(strip, 0, (i + 1) * cell, -1);
    if (strip.length < 3) continue;
    for (let j = j0; j <= j1; j++) {
      let piece = strip;
      if (j > j0) piece = clipAxis(piece, 1, j * cell, 1);
      if (j < j1) piece = clipAxis(piece, 1, (j + 1) * cell, -1);
      if (piece.length >= 3) emit(piece);
    }
  }
}

/**
 * Keeps the part of a convex polygon where sign * (p[axis] - value) >= 0.
 * Intersection points are computed from the edge endpoints in a canonical order, so
 * the same edge clipped from either neighbouring triangle yields bit-identical points.
 */
function clipAxis(poly: V2[], axis: 0 | 1, value: number, sign: 1 | -1): V2[] {
  const out: V2[] = [];
  const n = poly.length;
  for (let k = 0; k < n; k++) {
    const p = poly[k];
    const q = poly[(k + 1) % n];
    const dp = sign * (p[axis] - value);
    const dq = sign * (q[axis] - value);
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) {
      // Canonical order: lower coordinate on the clip axis first.
      const [s, e] = p[axis] < q[axis] || (p[axis] === q[axis] && p[1 - axis] < q[1 - axis]) ? [p, q] : [q, p];
      const t = (value - s[axis]) / (e[axis] - s[axis]);
      const other = s[1 - axis] + (e[1 - axis] - s[1 - axis]) * t;
      out.push(axis === 0 ? [value, other] : [other, value]);
    }
  }
  return out;
}
