// 2D polygon helpers for building footprints (world X/Z, metres).
// Rings follow src/world/types.ts: open, positive signed area, and the outward normal
// of edge a->b is normalize(b.z - a.z, -(b.x - a.x)).

import type { P2, Ring } from '../types';

export function signedArea(r: readonly P2[]): number {
  let s = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const a = r[i];
    const b = r[(i + 1) % n];
    s += a.x * b.z - b.x * a.z;
  }
  return s / 2;
}

export function edgeLength(a: P2, b: P2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Outward unit normal of edge a->b of a positive ring. */
export function edgeNormal(a: P2, b: P2): P2 {
  const l = edgeLength(a, b) || 1;
  return { x: (b.z - a.z) / l, z: -(b.x - a.x) / l };
}

export function perimeter(r: readonly P2[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) s += edgeLength(r[i], r[(i + 1) % r.length]);
  return s;
}

export function centroid(r: readonly P2[]): P2 {
  const a = signedArea(r);
  if (Math.abs(a) < 1e-9) {
    let x = 0;
    let z = 0;
    for (const p of r) {
      x += p.x;
      z += p.z;
    }
    return { x: x / Math.max(1, r.length), z: z / Math.max(1, r.length) };
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    const c = p.x * q.z - q.x * p.z;
    cx += (p.x + q.x) * c;
    cz += (p.z + q.z) * c;
  }
  return { x: cx / (6 * a), z: cz / (6 * a) };
}

export function bbox(r: readonly P2[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of r) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}

export function pointInRing(p: P2, r: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i];
    const b = r[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function distPointSeg(p: P2, a: P2, b: P2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

export function distToRing(p: P2, r: readonly P2[]): number {
  let d = Infinity;
  for (let i = 0; i < r.length; i++) d = Math.min(d, distPointSeg(p, r[i], r[(i + 1) % r.length]));
  return d;
}

/** Signed distance: negative inside the ring, positive outside. */
export function signedDistToRing(p: P2, r: readonly P2[]): number {
  const d = distToRing(p, r);
  return pointInRing(p, r) ? -d : d;
}

function segCross(a: P2, b: P2, c: P2, d: P2): boolean {
  // Proper intersection (touching endpoints do not count).
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

function orient(a: P2, b: P2, c: P2): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

export function isSimple(r: readonly P2[]): boolean {
  const n = r.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = r[i];
    const b = r[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segCross(a, b, r[j], r[(j + 1) % n])) return false;
    }
  }
  return true;
}

function finite(p: P2 | undefined): p is P2 {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.z);
}

/**
 * Clean a lot ring: drop non-finite points, duplicates and near-collinear vertices,
 * make the winding positive. Returns the ring plus the frontage flag of each new edge.
 */
export function cleanRing(poly: readonly P2[], frontage: readonly boolean[] | undefined, minEdge = 0.05): { ring: Ring; frontage: boolean[] } | null {
  if (!Array.isArray(poly)) return null;
  let pts: { p: P2; f: boolean }[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    if (!finite(p)) continue;
    pts.push({ p: { x: p.x, z: p.z }, f: !!frontage?.[i] });
  }
  if (pts.length < 3) return null;
  // Winding: if negative, reverse points; edge i of the reversed ring is the old edge (n-2-i).
  const area = signedArea(pts.map((e) => e.p));
  if (!Number.isFinite(area) || Math.abs(area) < 1e-6) return null;
  if (area < 0) {
    const n = pts.length;
    const rev: { p: P2; f: boolean }[] = [];
    for (let j = 0; j < n; j++) rev.push({ p: pts[n - 1 - j].p, f: pts[(((n - 2 - j) % n) + n) % n].f });
    pts = rev;
  }
  // Remove short edges (merge into the previous vertex; keep frontage if either was frontage).
  let changed = true;
  let guard = 0;
  while (changed && pts.length >= 3 && guard++ < 1000) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (edgeLength(a.p, b.p) < minEdge) {
        // drop b, the edge a->b disappears; a now connects to b's successor with b's edge flag OR a's
        a.f = a.f || b.f;
        pts.splice((i + 1) % pts.length, 1);
        changed = true;
        break;
      }
    }
    if (changed) continue;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      const l1 = edgeLength(prev.p, cur.p);
      const l2 = edgeLength(cur.p, next.p);
      const cr = orient(prev.p, cur.p, next.p) / (l1 * l2);
      if (Math.abs(cr) < 0.02) {
        // collinear (or a zero-width spike): merge edges prev->cur and cur->next into prev->next
        prev.f = prev.f || cur.f;
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  if (pts.length < 3) return null;
  const ring = pts.map((e) => e.p);
  if (signedArea(ring) < 1e-3) return null;
  return { ring, frontage: pts.map((e) => e.f) };
}

function lineIntersect(p: P2, d: P2, q: P2, e: P2): P2 | null {
  const den = d.x * e.z - d.z * e.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q.x - p.x) * e.z - (q.z - p.z) * e.x) / den;
  return { x: p.x + d.x * t, z: p.z + d.z * t };
}

/**
 * Inset a positive ring by a per-edge distance (edge i = ring[i] -> ring[i+1]).
 * Edges that collapse are removed. Returns null if the result degenerates or self-intersects.
 */
export function insetRing(ring: readonly P2[], dist: number | readonly number[]): Ring | null {
  const n0 = ring.length;
  if (n0 < 3) return null;
  const ds = ring.map((_, i) => (typeof dist === 'number' ? dist : dist[i] ?? 0));
  if (ds.every((d) => d === 0)) return ring.slice();
  // Offset lines of every edge; collapsing edges drop their line so neighbours meet directly.
  let lines: { p: P2; d: P2 }[] = [];
  for (let i = 0; i < n0; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n0];
    const nrm = edgeNormal(a, b);
    const l = edgeLength(a, b) || 1;
    lines.push({ p: { x: a.x - nrm.x * ds[i], z: a.z - nrm.z * ds[i] }, d: { x: (b.x - a.x) / l, z: (b.z - a.z) / l } });
  }
  const bb0 = bbox(ring);
  for (let iter = 0; iter <= n0; iter++) {
    const n = lines.length;
    if (n < 3) return null;
    const out: P2[] = [];
    for (let i = 0; i < n; i++) {
      const l0 = lines[(i - 1 + n) % n];
      const l1 = lines[i];
      const x = lineIntersect(l0.p, l0.d, l1.p, l1.d);
      out.push(x ?? { x: l1.p.x, z: l1.p.z });
    }
    // an edge whose segment runs against its line direction has collapsed
    let worst = -1;
    let worstVal = 1e-6;
    for (let i = 0; i < n; i++) {
      const a = out[i];
      const b = out[(i + 1) % n];
      const dot = (b.x - a.x) * lines[i].d.x + (b.z - a.z) * lines[i].d.z;
      if (dot < worstVal) {
        worstVal = dot;
        worst = i;
      }
    }
    if (worst < 0) {
      if (signedArea(out) <= 0.25 || !isSimple(out)) return null;
      // spikes from nearly parallel neighbours can shoot outside the original ring
      for (const p of out) {
        if (p.x < bb0.minX - 1e-6 || p.x > bb0.maxX + 1e-6 || p.z < bb0.minZ - 1e-6 || p.z > bb0.maxZ + 1e-6) return null;
      }
      return out;
    }
    lines = lines.filter((_, i) => i !== worst);
  }
  return null;
}

/** Remove vertices closer than `minEdge` and near-collinear ones; keeps winding. */
export function simplifyRing(r: readonly P2[], minEdge = 0.3): Ring {
  const c = cleanRing(r, undefined, minEdge);
  return c ? c.ring : r.slice();
}

/** A 2D orthonormal frame on the ground: x axis along `ax`, z axis along `az` (proper rotation). */
export class Frame {
  constructor(
    readonly ox: number,
    readonly oz: number,
    readonly axx: number,
    readonly axz: number,
  ) {}

  /** z axis = x axis rotated so that (ax, az) keeps positive winding: az = (-axz, axx). */
  get azx(): number {
    return -this.axz;
  }

  get azz(): number {
    return this.axx;
  }

  toWorld(x: number, z: number): P2 {
    return { x: this.ox + this.axx * x + this.azx * z, z: this.oz + this.axz * x + this.azz * z };
  }

  toLocal(p: P2): P2 {
    const dx = p.x - this.ox;
    const dz = p.z - this.oz;
    return { x: dx * this.axx + dz * this.axz, z: dx * this.azx + dz * this.azz };
  }

  /** World direction of a local direction. */
  dir(x: number, z: number): P2 {
    return { x: this.axx * x + this.azx * z, z: this.axz * x + this.azz * z };
  }

  /** Axis-aligned local rectangle as a positive world ring (front edge first: z0 side). */
  rect(x0: number, x1: number, z0: number, z1: number): Ring {
    return [this.toWorld(x0, z0), this.toWorld(x1, z0), this.toWorld(x1, z1), this.toWorld(x0, z1)];
  }

  /** A frame translated to local point (x, z), same axes. */
  offset(x: number, z: number): Frame {
    const o = this.toWorld(x, z);
    return new Frame(o.x, o.z, this.axx, this.axz);
  }

  /** Same origin, axes turned so the new x axis is the old z axis (new z = old -x). */
  rot90(): Frame {
    return new Frame(this.ox, this.oz, this.azx, this.azz);
  }
}

/** A local rectangle expressed in the rot90() frame. */
export function rectRot90(r: Rect): Rect {
  return { x0: r.z0, x1: r.z1, z0: -r.x1, z1: -r.x0 };
}

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export function rectW(r: Rect): number {
  return r.x1 - r.x0;
}

export function rectD(r: Rect): number {
  return r.z1 - r.z0;
}

/** True when the axis-aligned rectangle lies inside the (local) ring. */
export function rectInside(r: Rect, ring: readonly P2[], eps = 1e-4): boolean {
  const x0 = r.x0 + eps;
  const x1 = r.x1 - eps;
  const z0 = r.z0 + eps;
  const z1 = r.z1 - eps;
  if (x1 <= x0 || z1 <= z0) return false;
  const corners: P2[] = [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ];
  for (const c of corners) if (!pointInRing(c, ring)) return false;
  for (const p of ring) if (p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1) return false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    for (let k = 0; k < 4; k++) if (segCross(a, b, corners[k], corners[(k + 1) % 4])) return false;
  }
  return true;
}

/**
 * Largest (approximately) axis-aligned rectangle inside a local ring. Rasterises the ring,
 * finds the largest all-inside block, then grows each side analytically to touch the boundary
 * (the front side z0 first, so buildings meet the street line).
 */
// Both levels of detail fit the same rectangles for a lot, so remember recent results.
const rectCache = new Map<string, Rect | null>();

export function largestRect(ring: readonly P2[], maxCells = 56): Rect | null {
  let key = `${maxCells}`;
  for (const p of ring) key += `|${Math.round(p.x * 100)},${Math.round(p.z * 100)}`;
  const hit = rectCache.get(key);
  if (hit !== undefined) return hit ? { ...hit } : null;
  const r = largestRectUncached(ring, maxCells);
  if (rectCache.size > 20000) rectCache.clear();
  rectCache.set(key, r ? { ...r } : null);
  return r;
}

function largestRectUncached(ring: readonly P2[], maxCells: number): Rect | null {
  const bb = bbox(ring);
  const w = bb.maxX - bb.minX;
  const d = bb.maxZ - bb.minZ;
  if (!(w > 0.5 && d > 0.5)) return null;
  const cell = Math.max(0.25, Math.max(w, d) / maxCells);
  const nx = Math.max(1, Math.floor(w / cell));
  const nz = Math.max(1, Math.floor(d / cell));
  const cx = w / nx;
  const cz = d / nz;
  const half = Math.hypot(cx, cz) * 0.5;
  const inside = new Uint8Array(nx * nz);
  // Scanline test: a cell is inside when its whole x-range lies inside the polygon at
  // its top, middle and bottom (exact for straight walls, far cheaper than per-cell
  // point and distance tests; rectInside below still validates the result).
  const intervals = (z: number): number[] => {
    const xs: number[] = [];
    for (let k = 0, m = ring.length - 1; k < ring.length; m = k++) {
      const a = ring[k];
      const b = ring[m];
      if ((a.z <= z && b.z > z) || (b.z <= z && a.z > z)) xs.push(a.x + ((z - a.z) / (b.z - a.z)) * (b.x - a.x));
    }
    return xs.sort((p, q) => p - q);
  };
  const covered = (xs: number[], x0: number, x1: number): boolean => {
    for (let k = 0; k + 1 < xs.length; k += 2) if (x0 >= xs[k] && x1 <= xs[k + 1]) return true;
    return false;
  };
  for (let j = 0; j < nz; j++) {
    const zTop = bb.minZ + j * cz + 1e-6;
    const lines = [intervals(zTop), intervals(zTop + cz * 0.5), intervals(zTop + cz - 2e-6)];
    for (let i = 0; i < nx; i++) {
      const x0 = bb.minX + i * cx;
      const x1 = x0 + cx;
      if (lines[0].length && covered(lines[0], x0, x1) && covered(lines[1], x0, x1) && covered(lines[2], x0, x1)) inside[j * nx + i] = 1;
    }
  }
  // largest rectangle of ones (histogram method)
  const heights = new Int32Array(nx);
  let best = 0;
  let bi0 = 0;
  let bi1 = 0;
  let bj0 = 0;
  let bj1 = 0;
  const stack: number[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) heights[i] = inside[j * nx + i] ? heights[i] + 1 : 0;
    stack.length = 0;
    for (let i = 0; i <= nx; i++) {
      const h = i < nx ? heights[i] : 0;
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const top = stack.pop()!;
        const hh = heights[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const area = hh * cx * (i - left) * cz;
        if (area > best) {
          best = area;
          bi0 = left;
          bi1 = i;
          bj1 = j + 1;
          bj0 = j + 1 - hh;
        }
      }
      stack.push(i);
    }
  }
  if (best <= 0) return null;
  const r: Rect = { x0: bb.minX + bi0 * cx, x1: bb.minX + bi1 * cx, z0: bb.minZ + bj0 * cz, z1: bb.minZ + bj1 * cz };
  if (!rectInside(r, ring, 1e-3)) {
    // shrink slightly until inside (rasterisation can be optimistic on spikes)
    for (let k = 0; k < 8; k++) {
      const s = half * (k + 1) * 0.5;
      const t = { x0: r.x0 + s, x1: r.x1 - s, z0: r.z0 + s, z1: r.z1 - s };
      if (t.x1 > t.x0 && t.z1 > t.z0 && rectInside(t, ring, 1e-3)) return growRect(t, ring, bb);
    }
    return null;
  }
  return growRect(r, ring, bb);
}

/** Grow each side of an inside rectangle until it touches the ring (front z0 first). */
export function growRect(r: Rect, ring: readonly P2[], bb = bbox(ring)): Rect {
  const out = { ...r };
  const sides: (keyof Rect)[] = ['z0', 'x0', 'x1', 'z1'];
  for (const s of sides) {
    const limit = s === 'x0' ? out.x0 - bb.minX : s === 'x1' ? bb.maxX - out.x1 : s === 'z0' ? out.z0 - bb.minZ : bb.maxZ - out.z1;
    if (limit <= 1e-3) continue;
    let lo = 0;
    let hi = limit;
    for (let k = 0; k < 16; k++) {
      const mid = (lo + hi) / 2;
      const t = { ...out };
      if (s === 'x0') t.x0 -= mid;
      else if (s === 'x1') t.x1 += mid;
      else if (s === 'z0') t.z0 -= mid;
      else t.z1 += mid;
      if (rectInside(t, ring, 1e-3)) lo = mid;
      else hi = mid;
    }
    if (s === 'x0') out.x0 -= lo;
    else if (s === 'x1') out.x1 += lo;
    else if (s === 'z0') out.z0 -= lo;
    else out.z1 += lo;
  }
  return out;
}

/**
 * Replace convex corner `i` of a positive ring by a circular arc of `segments` pieces.
 * Returns the new ring and the index range [start, end] of the arc vertices.
 */
export function roundCorner(ring: readonly P2[], i: number, radius: number, segments: number): { ring: Ring; start: number; end: number } | null {
  const n = ring.length;
  const prev = ring[(i - 1 + n) % n];
  const cur = ring[i];
  const next = ring[(i + 1) % n];
  const l1 = edgeLength(prev, cur);
  const l2 = edgeLength(cur, next);
  if (l1 < 1e-3 || l2 < 1e-3) return null;
  const d1 = { x: (cur.x - prev.x) / l1, z: (cur.z - prev.z) / l1 };
  const d2 = { x: (next.x - cur.x) / l2, z: (next.z - cur.z) / l2 };
  const turn = d1.x * d2.z - d1.z * d2.x; // positive = convex for a positive ring
  if (turn <= 0.05) return null;
  const cosA = -(d1.x * d2.x + d1.z * d2.z); // cos of interior angle
  const interior = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const t = radius / Math.tan(interior / 2);
  if (t > l1 * 0.45 || t > l2 * 0.45) return null;
  const t1 = { x: cur.x - d1.x * t, z: cur.z - d1.z * t };
  const t2 = { x: cur.x + d2.x * t, z: cur.z + d2.z * t };
  // centre is inward: inward normal of d1 for a positive ring is (-d1.z, d1.x)... check with outward normal
  const nOut = { x: d1.z, z: -d1.x }; // outward normal of edge prev->cur (edgeNormal formula)
  const c = { x: t1.x - nOut.x * radius, z: t1.z - nOut.z * radius };
  const a0 = Math.atan2(t1.z - c.z, t1.x - c.x);
  let a1 = Math.atan2(t2.z - c.z, t2.x - c.x);
  // sweep direction: for a positive ring, going around a convex corner the angle increases
  let sweep = a1 - a0;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  a1 = a0 + sweep;
  const arc: P2[] = [];
  for (let k = 0; k <= segments; k++) {
    const a = a0 + ((a1 - a0) * k) / segments;
    arc.push({ x: c.x + Math.cos(a) * radius, z: c.z + Math.sin(a) * radius });
  }
  const out: P2[] = [];
  for (let k = 0; k < n; k++) {
    if (k === i) {
      for (const p of arc) out.push(p);
    } else {
      out.push(ring[k]);
    }
  }
  return { ring: out, start: i, end: i + segments };
}

/** Uniform inward offset used for parapets; falls back to scaling toward the centroid. */
export function insetUniform(ring: readonly P2[], d: number): Ring {
  const r = insetRing(ring, d);
  if (r) return r;
  const c = centroid(ring);
  const bb = bbox(ring);
  const size = Math.max(1e-3, Math.min(bb.maxX - bb.minX, bb.maxZ - bb.minZ));
  const s = Math.max(0.1, 1 - (2 * d) / size);
  return ring.map((p) => ({ x: c.x + (p.x - c.x) * s, z: c.z + (p.z - c.z) * s }));
}

/** Random point inside a ring at least `margin` from its edges (rejection sampling). */
export function samplePointInRing(ring: readonly P2[], margin: number, rnd: () => number, tries = 24): P2 | null {
  const bb = bbox(ring);
  for (let k = 0; k < tries; k++) {
    const p = { x: bb.minX + (bb.maxX - bb.minX) * rnd(), z: bb.minZ + (bb.maxZ - bb.minZ) * rnd() };
    if (pointInRing(p, ring) && distToRing(p, ring) >= margin) return p;
  }
  return null;
}
