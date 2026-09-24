// Lot analysis: clean the polygon, pick the main street frontage, build a local frame
// (x along the front edge, z into the lot), and derive buildable areas from setbacks.

import type { Lot, P2, Ring } from '../types';
import { Frame, type Rect, bbox, cleanRing, edgeLength, edgeNormal, insetRing, largestRect, signedArea } from './geom';

export interface LotCtx {
  lot: Lot;
  /** Cleaned lot ring (world, positive winding). */
  ring: Ring;
  /** frontage[i] for edge ring[i] -> ring[i+1]. */
  frontage: boolean[];
  /** Index of the main street edge. */
  front: number;
  /** Local frame: origin at the start of the front edge, x along it, z into the lot. */
  frame: Frame;
  local: Ring;
  area: number;
  /** Local bounding box of the lot. */
  width: number;
  depth: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** More than one street-facing direction (corner lot). */
  corner: boolean;
}

export function analyzeLot(lot: Lot): LotCtx | null {
  const cleaned = cleanRing(lot.polygon ?? [], lot.frontage ?? [], 0.05);
  if (!cleaned) return null;
  const { ring, frontage } = cleaned;
  const area = signedArea(ring);
  if (!(area >= 4)) return null;
  let front = -1;
  let best = -1;
  for (let i = 0; i < ring.length; i++) {
    const l = edgeLength(ring[i], ring[(i + 1) % ring.length]);
    if (frontage[i] && l > best) {
      best = l;
      front = i;
    }
  }
  if (front < 0) {
    for (let i = 0; i < ring.length; i++) {
      const l = edgeLength(ring[i], ring[(i + 1) % ring.length]);
      if (l > best) {
        best = l;
        front = i;
      }
    }
  }
  const a = ring[front];
  const b = ring[(front + 1) % ring.length];
  const l = edgeLength(a, b);
  const frame = new Frame(a.x, a.z, (b.x - a.x) / l, (b.z - a.z) / l);
  const local = ring.map((p) => frame.toLocal(p));
  const bb = bbox(local);
  const fn = edgeNormal(a, b);
  let corner = false;
  for (let i = 0; i < ring.length; i++) {
    if (!frontage[i] || i === front) continue;
    const n = edgeNormal(ring[i], ring[(i + 1) % ring.length]);
    if (n.x * fn.x + n.z * fn.z < 0.7 && edgeLength(ring[i], ring[(i + 1) % ring.length]) > 4) corner = true;
  }
  return {
    lot, ring, frontage, front, frame, local, area,
    width: bb.maxX - bb.minX, depth: bb.maxZ - bb.minZ,
    minX: bb.minX, maxX: bb.maxX, minZ: bb.minZ, maxZ: bb.maxZ,
    corner,
  };
}

/** Per-edge setbacks: street edges get `front`, edges facing away from the main street `rear`, others `side`. */
export function edgeSetbacks(c: LotCtx, front: number, side: number, rear: number): number[] {
  const fa = c.ring[c.front];
  const fb = c.ring[(c.front + 1) % c.ring.length];
  const fn = edgeNormal(fa, fb);
  return c.ring.map((p, i) => {
    if (c.frontage[i] || i === c.front) return front;
    const n = edgeNormal(p, c.ring[(i + 1) % c.ring.length]);
    return n.x * fn.x + n.z * fn.z < -0.7 ? rear : side;
  });
}

/** Buildable ring after setbacks (world); shrinks setbacks if the lot is too small. */
export function buildable(c: LotCtx, front: number, side: number, rear: number): Ring | null {
  for (const k of [1, 0.6, 0.3, 0]) {
    const r = insetRing(c.ring, edgeSetbacks(c, front * k, side * k, rear * k));
    if (r && signedArea(r) > 6) return r;
  }
  return null;
}

/** Largest local-frame rectangle inside a world ring. */
export function fitRect(c: LotCtx, ring: readonly P2[]): Rect | null {
  return largestRect(ring.map((p) => c.frame.toLocal(p)));
}

/**
 * True when wall edge p->q (positive ring) faces one of the lot's street edges:
 * normals within ~35 degrees and the wall within `maxDist` of that street edge.
 */
export function streetFacing(c: LotCtx, p: P2, q: P2, maxDist: number): boolean {
  const n = edgeNormal(p, q);
  const m = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
  for (let i = 0; i < c.ring.length; i++) {
    if (!c.frontage[i] && i !== c.front) continue;
    const a = c.ring[i];
    const b = c.ring[(i + 1) % c.ring.length];
    const fn = edgeNormal(a, b);
    if (n.x * fn.x + n.z * fn.z < 0.82) continue;
    // distance from the wall midpoint to the street edge's line, measured along the normal
    const d = (m.x - a.x) * -fn.x + (m.z - a.z) * -fn.z;
    if (d < -0.5 || d > maxDist) continue;
    // the midpoint must project onto the edge (with some slack)
    const l = edgeLength(a, b);
    const t = ((m.x - a.x) * (b.x - a.x) + (m.z - a.z) * (b.z - a.z)) / (l * l);
    if (t > -0.25 && t < 1.25) return true;
  }
  return false;
}
