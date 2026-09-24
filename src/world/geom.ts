// 2D geometry helpers in the world X/Z plane (see types.ts for conventions).
import type { P2, Ring } from './types';

export function p2(x: number, z: number): P2 {
  return { x, z };
}

export function dist(a: P2, b: P2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export function lerpP(a: P2, b: P2, t: number): P2 {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Signed area; positive for the "outer ring" winding used across the project. */
export function signedArea(r: Ring): number {
  let s = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const a = r[i];
    const b = r[(i + 1) % n];
    s += a.x * b.z - b.x * a.z;
  }
  return s / 2;
}

/** Returns the ring with positive winding (reversed copy if needed). */
export function asOuter(r: Ring): Ring {
  return signedArea(r) < 0 ? r.slice().reverse() : r;
}

/** Returns the ring with negative winding (for holes). */
export function asHole(r: Ring): Ring {
  return signedArea(r) > 0 ? r.slice().reverse() : r;
}

/** Even-odd point in polygon test. */
export function pointInRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i];
    const b = r[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export interface Bounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function ringBounds(r: readonly P2[]): Bounds {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of r) {
    if (p.x < minX) minX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, minZ, maxX, maxZ };
}

/** Area-weighted centroid of a ring. */
export function centroid(r: Ring): P2 {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i];
    const q = r[(i + 1) % n];
    const c = p.x * q.z - q.x * p.z;
    a += c;
    cx += (p.x + q.x) * c;
    cz += (p.z + q.z) * c;
  }
  if (Math.abs(a) < 1e-9) {
    const b = ringBounds(r);
    return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  }
  return { x: cx / (3 * a), z: cz / (3 * a) };
}

/** Squared distance from point p to segment ab. */
export function distToSegmentSq(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + dx * t - px;
  const z = az + dz * t - pz;
  return x * x + z * z;
}

/** Parameter t in [0,1] of the closest point on segment ab to p. */
export function projectOnSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 === 0) return 0;
  return clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1);
}

/**
 * Intersection of segments ab and cd. Returns params (t on ab, u on cd) or null when
 * they don't cross (parallel segments return null).
 */
export function segmentIntersection(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): { t: number; u: number } | null {
  const rx = bx - ax;
  const rz = bz - az;
  const sx = dx - cx;
  const sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = cx - ax;
  const qz = cz - az;
  const t = (qx * sz - qz * sx) / den;
  const u = (qx * rz - qz * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

export function polylineLength(pts: readonly P2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

/** Points every `step` metres along a polyline (always includes both ends). */
export function resamplePolyline(pts: readonly P2[], step: number): P2[] {
  if (pts.length < 2) return pts.slice();
  const total = polylineLength(pts);
  const n = Math.max(1, Math.round(total / step));
  const out: P2[] = [];
  let seg = 0;
  let segStart = 0;
  let segLen = dist(pts[0], pts[1]);
  for (let i = 0; i <= n; i++) {
    const d = (total * i) / n;
    while (seg < pts.length - 2 && d > segStart + segLen) {
      segStart += segLen;
      seg++;
      segLen = dist(pts[seg], pts[seg + 1]);
    }
    const t = segLen > 0 ? clamp((d - segStart) / segLen, 0, 1) : 0;
    out.push(lerpP(pts[seg], pts[seg + 1], t));
  }
  return out;
}

/** Point and unit tangent at distance d along a polyline. */
export function pointAlong(pts: readonly P2[], d: number): { p: P2; dir: P2 } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    if (acc + l >= d || i === pts.length - 1) {
      const t = l > 0 ? clamp((d - acc) / l, 0, 1) : 0;
      const dx = (pts[i].x - pts[i - 1].x) / (l || 1);
      const dz = (pts[i].z - pts[i - 1].z) / (l || 1);
      return { p: lerpP(pts[i - 1], pts[i], t), dir: { x: dx, z: dz } };
    }
    acc += l;
  }
  return { p: pts[0], dir: { x: 1, z: 0 } };
}

/** Centripetal Catmull-Rom spline through the points, sampled about every `step` metres. */
export function catmullRom(points: readonly P2[], step: number, closed = false): P2[] {
  const n = points.length;
  if (n < 3) return resamplePolyline(points, step);
  const get = (i: number): P2 => {
    if (closed) return points[((i % n) + n) % n];
    if (i < 0) return { x: 2 * points[0].x - points[1].x, z: 2 * points[0].z - points[1].z };
    if (i >= n) return { x: 2 * points[n - 1].x - points[n - 2].x, z: 2 * points[n - 1].z - points[n - 2].z };
    return points[i];
  };
  const out: P2[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2v = get(i + 1);
    const p3 = get(i + 2);
    const samples = Math.max(1, Math.ceil(dist(p1, p2v) / step));
    for (let s = 0; s < samples; s++) out.push(catmullPoint(p0, p1, p2v, p3, s / samples));
  }
  if (!closed) out.push(points[n - 1]);
  return out;
}

function catmullPoint(p0: P2, p1: P2, p2v: P2, p3: P2, t: number): P2 {
  // Centripetal parameterisation (alpha = 0.5) avoids cusps and self-intersections.
  const d01 = Math.max(1e-4, Math.sqrt(dist(p0, p1)));
  const d12 = Math.max(1e-4, Math.sqrt(dist(p1, p2v)));
  const d23 = Math.max(1e-4, Math.sqrt(dist(p2v, p3)));
  const t0 = 0;
  const t1 = t0 + d01;
  const t2 = t1 + d12;
  const t3 = t2 + d23;
  const tt = t1 + (t2 - t1) * t;
  const lerp = (a: P2, b: P2, ta: number, tb: number): P2 => {
    const w = (tt - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2v, t1, t2);
  const a3 = lerp(p2v, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/** Chaikin corner cutting (smooths a polyline or ring). */
export function chaikin(pts: readonly P2[], iterations: number, closed: boolean): P2[] {
  let cur = pts.slice();
  for (let it = 0; it < iterations; it++) {
    const next: P2[] = [];
    const n = cur.length;
    if (!closed) next.push(cur[0]);
    const lim = closed ? n : n - 1;
    for (let i = 0; i < lim; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % n];
      next.push(lerpP(a, b, 0.25), lerpP(a, b, 0.75));
    }
    if (!closed) next.push(cur[n - 1]);
    cur = next;
  }
  return cur;
}

/** Ring of an ellipse (positive winding). */
export function ellipseRing(cx: number, cz: number, rx: number, rz: number, rotation = 0, segments = 32): Ring {
  const out: Ring = [];
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const z = Math.sin(a) * rz;
    out.push({ x: cx + x * c - z * s, z: cz + x * s + z * c });
  }
  return asOuter(out);
}

/** Convex hull (monotone chain), positive winding. */
export function convexHull(points: readonly P2[]): Ring {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  if (pts.length < 3) return pts;
  const cross = (o: P2, a: P2, b: P2): number => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: P2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: P2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return asOuter(lower.concat(upper));
}

export interface OrientedRect {
  center: P2;
  /** Unit vector of the long side. */
  axis: P2;
  /** Half length along axis. */
  halfLong: number;
  /** Half length across. */
  halfShort: number;
}

/** Minimum-area oriented bounding rectangle (rotating calipers over hull edges). */
export function minAreaRect(points: readonly P2[]): OrientedRect {
  const hull = convexHull(points);
  let best: OrientedRect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const len = dist(a, b);
    if (len < 1e-9) continue;
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.z * uz;
      const v = -p.x * uz + p.z * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      const center = { x: cu * ux - cv * uz, z: cu * uz + cv * ux };
      const lu = (maxU - minU) / 2;
      const lv = (maxV - minV) / 2;
      best = lu >= lv
        ? { center, axis: { x: ux, z: uz }, halfLong: lu, halfShort: lv }
        : { center, axis: { x: -uz, z: ux }, halfLong: lv, halfShort: lu };
    }
  }
  if (!best) {
    const b = ringBounds(points);
    return {
      center: { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 },
      axis: { x: 1, z: 0 },
      halfLong: (b.maxX - b.minX) / 2,
      halfShort: (b.maxZ - b.minZ) / 2,
    };
  }
  return best;
}

/** Removes consecutive points closer than `eps` and collinear points (within angle tolerance). */
export function cleanRing(r: Ring, eps = 0.05, collinearSin = 0.002): Ring {
  const out: Ring = [];
  for (const p of r) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > eps) out.push(p);
  }
  if (out.length > 1 && dist(out[0], out[out.length - 1]) <= eps) out.pop();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i + out.length - 1) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const bcx = c.x - b.x;
      const bcz = c.z - b.z;
      const cross = abx * bcz - abz * bcx;
      const la = Math.hypot(abx, abz);
      const lb = Math.hypot(bcx, bcz);
      if (la * lb > 0 && Math.abs(cross) / (la * lb) < collinearSin && abx * bcx + abz * bcz > 0) {
        out.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return out;
}
