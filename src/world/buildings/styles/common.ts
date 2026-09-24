// Helpers shared by the style generators.

import type { Rng } from '../../rng';
import type { Lot, P2, Ring } from '../../types';
import { type RGB, hex, shade } from '../colors';
import { DSURF, GLASS, GND, OCC, PAT, WSURF } from '../constants';
import { type Emitter, FACE, type FacadeSpec, type WallLayout, wallPoint } from '../emit';
import { Frame, edgeLength, edgeNormal, samplePointInRing } from '../geom';
import type { BuildingInfo, Entrance } from '../info';
import { type LotCtx, streetFacing } from '../lot';
import { signUV } from '../signs';

export interface GenCtx {
  lot: Lot;
  c: LotCtx;
  lod: 0 | 1;
  /** Random stream for everything that exists at both LODs (volumes, colours, facades). */
  rng: Rng;
  /** Random stream for LOD-0-only details, so LOD 0 and LOD 1 stay identical otherwise. */
  drng: Rng;
  em: Emitter;
  /** lot.groundY */
  base: number;
  /** Per-building random in [0, 1). */
  seed: number;
  info: BuildingInfo;
}

/** Walls extend this far below the lot ground so sloped terrain never shows a gap. */
export const SKIRT = 0.8;

/** Box faces pointing away from a wall (everything but the face against the wall). */
export const OUT_FACES = FACE.ALL & ~FACE.FRONT;

export function spec(g: GenCtx, over: Partial<FacadeSpec>): FacadeSpec {
  return {
    floorH: 3.2, bayW: 3.2, groundH: 3.2, topH: 3.2,
    winW: 1.2, winH: 1.5, sill: 0.9, depth: 0.15,
    pattern: PAT.PUNCHED, ground: GND.SAME, glass: GLASS.CLEAR, surface: WSURF.STUCCO,
    seed: g.seed, wall: [0.8, 0.8, 0.8], trim: [0.9, 0.9, 0.9], occ: OCC.RESIDENTIAL, crown: 0, flags: 0,
    ...over,
  };
}

export function withSpec(s: FacadeSpec, over: Partial<FacadeSpec>): FacadeSpec {
  return { ...s, ...over };
}

/** Street-facing flags for each edge of a building ring. */
export function streetEdges(g: GenCtx, ring: readonly P2[], maxDist: number): boolean[] {
  return ring.map((p, i) => streetFacing(g.c, p, ring[(i + 1) % ring.length], maxDist));
}

/** Longest street-facing edge; falls back to the edge best aligned with the lot front. */
export function mainEdge(g: GenCtx, ring: readonly P2[], street: readonly boolean[]): number {
  let best = -1;
  let bestL = -1;
  for (let i = 0; i < ring.length; i++) {
    const l = edgeLength(ring[i], ring[(i + 1) % ring.length]);
    if (street[i] && l > bestL) {
      bestL = l;
      best = i;
    }
  }
  if (best >= 0) return best;
  const f = g.c.frame.dir(0, -1);
  let bestD = -2;
  for (let i = 0; i < ring.length; i++) {
    const n = edgeNormal(ring[i], ring[(i + 1) % ring.length]);
    const d = n.x * f.x + n.z * f.z + edgeLength(ring[i], ring[(i + 1) % ring.length]) * 1e-4;
    if (d > bestD) {
      bestD = d;
      best = i;
    }
  }
  return Math.max(0, best);
}

export function wallFrame(w: WallLayout): Frame {
  return new Frame(w.q.x, w.q.z, w.t.x, w.t.z);
}

export function addEntrance(g: GenCtx, w: WallLayout, u: number, kind: Entrance['kind']): void {
  const p = wallPoint(w, u, 0.3);
  g.info.entrances.push({ x: p.x, y: g.base, z: p.z, nx: w.n.x, nz: w.n.z, kind });
}

export interface FlatRoofOpts {
  parapet: number;
  cap?: number;
  wall: RGB;
  capCol?: RGB;
  roofCol: RGB;
  roofSurf: number;
  frame?: Frame;
}

/** Flat roof on a wall ring ending at yTop: parapet (lod 0) and roof surface. */
export function flatRoof(g: GenCtx, ring: readonly P2[], yTop: number, o: FlatRoofOpts): { ring: Ring; y: number } {
  if (g.lod === 1 || o.parapet <= 0.05) {
    g.em.flat(ring, yTop, true, o.roofCol, o.roofSurf, o.frame);
    return { ring: ring.slice(), y: yTop };
  }
  const yRoof = yTop - o.parapet;
  const inner = g.em.parapet(ring, yRoof, yTop, o.cap ?? 0.25, shade(o.wall, 0.9), o.capCol ?? shade(o.wall, 1.04));
  g.em.flat(inner, yRoof, true, o.roofCol, o.roofSurf, o.frame);
  return { ring: inner, y: yRoof };
}

export const EQUIP_COLS = ['#c9c8c2', '#b9b8b0', '#d8d6cf', '#a9aaa5', '#cfc9b8'];

/** Scatter rooftop equipment (package units / split condensers) on a flat roof. */
export function rooftopUnits(g: GenCtx, roof: { ring: readonly P2[]; y: number }, frame: Frame, n: number, kind: 'rtu' | 'split' | 'mixed', avoid: { x: number; z: number; r: number }[] = []): void {
  if (g.lod === 1 || n <= 0) return;
  const rng = g.drng;
  const local = roof.ring.map((p) => frame.toLocal(p));
  const placed = avoid.slice();
  const col = shade(hex(rng.pick(EQUIP_COLS)), 1);
  for (let i = 0; i < n * 2 && placed.length - avoid.length < n; i++) {
    const big = kind === 'rtu' || (kind === 'mixed' && rng.chance(0.45));
    const w = big ? rng.range(1.6, 3.0) : rng.range(0.8, 1.05);
    const d = big ? rng.range(1.2, 1.9) : rng.range(0.35, 0.5);
    const h = big ? rng.range(1.0, 1.45) : rng.range(0.6, 0.85);
    const r = Math.hypot(w, d) / 2 + 0.35;
    const p = samplePointInRing(local, r + 0.2, () => rng.next(), 10);
    if (!p || placed.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < o.r + r)) continue;
    placed.push({ x: p.x, z: p.z, r });
    const fr = frame.offset(p.x, p.z);
    g.em.box(fr, -w / 2, w / 2, roof.y, roof.y + h, -d / 2, d / 2, col, DSURF.EQUIPMENT, FACE.NO_BOTTOM, big ? 1 : 0);
  }
}

/** Stair / elevator bulkhead box on a roof. Returns its footprint circle for avoidance. */
export function bulkhead(g: GenCtx, roof: { ring: readonly P2[]; y: number }, frame: Frame, wallCol: RGB, w: number, d: number, h: number): { x: number; z: number; r: number } | null {
  if (g.lod === 1) return null;
  const local = roof.ring.map((p) => frame.toLocal(p));
  const p = samplePointInRing(local, Math.hypot(w, d) / 2 + 0.3, () => g.drng.next(), 16);
  if (!p) return null;
  const fr = frame.offset(p.x, p.z);
  g.em.box(fr, -w / 2, w / 2, roof.y, roof.y + h, -d / 2, d / 2, wallCol, DSURF.PLAIN, FACE.SIDES);
  g.em.box(fr, -w / 2 - 0.1, w / 2 + 0.1, roof.y + h, roof.y + h + 0.2, -d / 2 - 0.1, d / 2 + 0.1, shade(wallCol, 0.95), DSURF.PLAIN, FACE.NO_BOTTOM, 0, 0, hex('#8f8d88'), DSURF.MEMBRANE);
  return { x: p.x, z: p.z, r: Math.hypot(w, d) / 2 + 0.3 };
}

/** Old-style water tank on a steel base (older downtown buildings). */
export function waterTank(g: GenCtx, roof: { ring: readonly P2[]; y: number }, frame: Frame, avoid: { x: number; z: number; r: number }[]): { x: number; z: number; r: number } | null {
  if (g.lod === 1) return null;
  const rng = g.drng;
  const r = rng.range(1.4, 2.1);
  const local = roof.ring.map((p) => frame.toLocal(p));
  const p = samplePointInRing(local, r + 0.4, () => rng.next(), 16);
  if (!p || avoid.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < o.r + r)) return null;
  const w = frame.toWorld(p.x, p.z);
  const fr = frame.offset(p.x, p.z);
  const legH = rng.range(1.2, 2.2);
  const steel = hex('#4a4a4a');
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    g.em.box(fr, sx * r * 0.6 - 0.12, sx * r * 0.6 + 0.12, roof.y, roof.y + legH, sz * r * 0.6 - 0.12, sz * r * 0.6 + 0.12, steel, DSURF.DARK, FACE.SIDES);
  }
  g.em.box(fr, -r * 0.8, r * 0.8, roof.y + legH - 0.25, roof.y + legH, -r * 0.8, r * 0.8, steel, DSURF.DARK, FACE.ALL);
  const h = rng.range(2.6, 3.6);
  g.em.cylinder(w.x, w.z, r, roof.y + legH, roof.y + legH + h, 10, hex(rng.pick(['#7a6250', '#8a7058', '#6d5a4a', '#9a9a96'])), DSURF.WOOD, r * 0.55);
  return { x: p.x, z: p.z, r: r + 0.3 };
}

/**
 * Fabric awning on a wall between u0 and u1: attached at yTop, projecting `depth`,
 * front edge `drop` lower, with a valance and triangular side flaps.
 */
export function awning(g: GenCtx, w: WallLayout, u0: number, u1: number, yTop: number, depth: number, drop: number, col: RGB, stripeW: number, stripeIdx: number): void {
  const em = g.em;
  const A0 = wallPoint(w, u0, 0.03);
  const A1 = wallPoint(w, u1, 0.03);
  const F0 = wallPoint(w, u0, depth);
  const F1 = wallPoint(w, u1, depth);
  const yF = yTop - drop;
  const val = 0.28;
  const len = Math.hypot(depth, drop);
  const up: [number, number, number] = [w.n.x * drop, depth, w.n.z * drop];
  const s = DSURF.AWNING;
  em.oquad([A0.x, yTop, A0.z], [A1.x, yTop, A1.z], [F1.x, yF, F1.z], [F0.x, yF, F0.z], [u0, 0, u1, 0, u1, len, u0, len], up, col, s, stripeW, stripeIdx);
  if (g.lod === 0) {
    const under = shade(col, 0.75);
    em.oquad([A0.x, yTop, A0.z], [A1.x, yTop, A1.z], [F1.x, yF, F1.z], [F0.x, yF, F0.z], [u0, 0, u1, 0, u1, len, u0, len], [-up[0], -up[1], -up[2]], under, s, stripeW, stripeIdx);
    em.vquad(F1, F0, yF - val, yF, col, s, stripeW, stripeIdx, u0);
    em.vquad(F0, F1, yF - val, yF, under, s, stripeW, stripeIdx);
    const sideL: [number, number, number] = [-w.t.x, 0, -w.t.z];
    const sideR: [number, number, number] = [w.t.x, 0, w.t.z];
    for (const [A, F, dir] of [[A0, F0, sideL], [A1, F1, sideR]] as const) {
      const a: [number, number, number] = [A.x, yTop, A.z];
      const f: [number, number, number] = [F.x, yF, F.z];
      const fb: [number, number, number] = [F.x, yF - val, F.z];
      em.otri(a, f, fb, [0, 0, len, 0, len, -val], dir, col, s, 0, 0);
      em.otri(a, f, fb, [0, 0, len, 0, len, -val], [-dir[0], 0, -dir[2]], under, s, 0, 0);
    }
  }
}

/** Horizontal ledge / eyebrow / slab along a wall between u0 and u1, top at y. */
export function ledge(g: GenCtx, w: WallLayout, u0: number, u1: number, yTop: number, thick: number, depth: number, col: RGB, surf: number = DSURF.PLAIN): void {
  if (u1 - u0 < 0.05) return;
  g.em.box(wallFrame(w), u0, u1, yTop - thick, yTop, 0, depth, col, surf, OUT_FACES);
}

/** A sign panel on a wall: text slot `text`, centred at (uc, yc), W x H metres, `out` from the wall. */
export function wallSign(g: GenCtx, w: WallLayout, uc: number, yc: number, W: number, H: number, text: number, bg: RGB, textCol: number, light: number, out = 0.08, box = false): void {
  const [u0, v0, u1, v1] = signUV(text, W, H);
  const L = wallPoint(w, uc - W / 2, out);
  const R = wallPoint(w, uc + W / 2, out);
  const y0 = yc - H / 2;
  const y1 = yc + H / 2;
  g.em.quad([L.x, y0, L.z], [R.x, y0, R.z], [R.x, y1, R.z], [L.x, y1, L.z], [u0, v0, u1, v0, u1, v1, u0, v1], bg, DSURF.SIGN, textCol, light);
  if (box && g.lod === 0 && out > 0.1) {
    // sign cabinet sides
    g.em.box(wallFrame(w), uc - W / 2, uc + W / 2, y0, y1, 0, out - 0.01, shade(bg, 0.6), DSURF.PLAIN, FACE.TOP | FACE.BOTTOM | FACE.LEFT | FACE.RIGHT);
  }
}

/** A light strip (neon / LED) box; emissive at night in the detail shader. */
export function lightStrip(g: GenCtx, f: Frame, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: RGB): void {
  g.em.box(f, x0, x1, y0, y1, z0, z1, col, DSURF.LED, FACE.NO_BOTTOM);
}

/** Paved parking (with stalls) inside a local rectangle; recorded in info.parking. */
export function parkingLot(g: GenCtx, frame: Frame, x0: number, x1: number, z0: number, z1: number, stallW = 2.7): void {
  if (x1 - x0 < 4 || z1 - z0 < 5) return;
  const ring = frame.rect(x0, x1, z0, z1);
  g.info.parking.push(ring);
  if (g.lod === 1) return;
  const y = g.base + 0.08;
  // uv: u along the lot front (stalls), v into the lot (rows)
  const f2 = frame.offset(x0, z0);
  g.em.flat(ring, y, true, hex('#4a4b4d'), DSURF.PARKING, f2, stallW, 0);
  g.em.prism(ring, g.base - 0.1, y, hex('#9c9a94'), DSURF.CONCRETE, false, false);
}

/** Pick an int with probability weights (convenience wrapper). */
export function pickW<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
  return rng.weighted(items, weights);
}

export function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}
