// Regular grids over the map: land masks, distance fields, heights.
import { MAP_HALF, MAP_SIZE } from '../config';
import type { PolygonWithHoles } from '../types';

/** Samples are at x = origin + i * res (i = 0..n-1), same for z. */
export class Grid {
  readonly n: number;
  readonly res: number;
  readonly origin: number;

  constructor(res: number) {
    this.res = res;
    this.n = Math.round(MAP_SIZE / res) + 1;
    this.origin = -MAP_HALF;
  }

  get count(): number {
    return this.n * this.n;
  }

  x(i: number): number {
    return this.origin + i * this.res;
  }

  /** Bilinear sample of a field stored on this grid (clamped at the edges). */
  sample(field: Float32Array, x: number, z: number): number {
    const n = this.n;
    let fx = (x - this.origin) / this.res;
    let fz = (z - this.origin) / this.res;
    fx = fx < 0 ? 0 : fx > n - 1.0001 ? n - 1.0001 : fx;
    fz = fz < 0 ? 0 : fz > n - 1.0001 ? n - 1.0001 : fz;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const k = j * n + i;
    const a = field[k];
    const b = field[k + 1];
    const c = field[k + n];
    const d = field[k + n + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** Nearest-sample lookup for categorical data. */
  nearest<T extends ArrayLike<number>>(field: T, x: number, z: number): number {
    const n = this.n;
    const i = Math.min(n - 1, Math.max(0, Math.round((x - this.origin) / this.res)));
    const j = Math.min(n - 1, Math.max(0, Math.round((z - this.origin) / this.res)));
    return field[j * n + i];
  }
}

/** Rasterise polygons (even-odd over all rings) into a 0/1 mask sampled at grid points. */
export function fillPolygons(grid: Grid, polys: readonly PolygonWithHoles[]): Uint8Array {
  const mask = new Uint8Array(grid.count);
  const edges: number[] = []; // x0,z0,x1,z1
  for (const p of polys) {
    for (const ring of [p.outer, ...p.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (a.z !== b.z) edges.push(a.x, a.z, b.x, b.z);
      }
    }
  }
  // Bucket edges by row range for speed.
  const n = grid.n;
  const rows: number[][] = Array.from({ length: n }, () => []);
  for (let e = 0; e < edges.length; e += 4) {
    const z0 = Math.min(edges[e + 1], edges[e + 3]);
    const z1 = Math.max(edges[e + 1], edges[e + 3]);
    const j0 = Math.max(0, Math.ceil((z0 - grid.origin) / grid.res));
    const j1 = Math.min(n - 1, Math.floor((z1 - grid.origin) / grid.res));
    for (let j = j0; j <= j1; j++) rows[j].push(e);
  }
  const xs: number[] = [];
  for (let j = 0; j < n; j++) {
    const z = grid.x(j);
    xs.length = 0;
    for (const e of rows[j]) {
      const ax = edges[e];
      const az = edges[e + 1];
      const bx = edges[e + 2];
      const bz = edges[e + 3];
      // Half-open rule so vertices on the scanline are counted once.
      if ((az <= z && bz > z) || (bz <= z && az > z)) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - grid.origin) / grid.res));
      const i1 = Math.min(n - 1, Math.floor((xs[k + 1] - grid.origin) / grid.res));
      for (let i = i0; i <= i1; i++) mask[j * n + i] = 1;
    }
  }
  return mask;
}

/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher).
 * For every grid sample, distance (m) to the nearest sample where mask == target,
 * plus the index of that sample.
 */
export function distanceTo(grid: Grid, mask: Uint8Array, target: number): { dist: Float32Array; nearest: Int32Array } {
  const n = grid.n;
  const INF = 1e20;
  const colDist = new Float64Array(n * n);
  const colNear = new Int32Array(n * n); // nearest row in the same column
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const idx = new Int32Array(n);
  const v = new Int32Array(n);
  const zz = new Float64Array(n + 1);

  // Pass 1: columns (vary j for fixed i).
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) f[j] = mask[j * n + i] === target ? 0 : INF;
    edt1d(f, n, d, idx, v, zz);
    for (let j = 0; j < n; j++) {
      colDist[j * n + i] = d[j];
      colNear[j * n + i] = idx[j];
    }
  }
  // Pass 2: rows.
  const dist = new Float32Array(n * n);
  const nearest = new Int32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) f[i] = colDist[j * n + i];
    edt1d(f, n, d, idx, v, zz);
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (d[i] >= INF * 0.5) {
        dist[k] = Infinity;
        nearest[k] = -1;
      } else {
        dist[k] = Math.sqrt(d[i]) * grid.res;
        const ni = idx[i];
        nearest[k] = colNear[j * n + ni] * n + ni;
      }
    }
  }
  return { dist, nearest };
}

function edt1d(f: Float64Array, n: number, d: Float64Array, idx: Int32Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
    idx[q] = v[k];
  }
}
