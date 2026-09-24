// Lots: each urban block's inner area is split recursively along its oriented bounding
// box into street-facing parcels sized for the district.
import { DISTRICTS, type DistrictSpec } from '../authored/districts';
import { LANDMARKS } from '../authored/layout';
import { intersection, polyArea } from '../clip';
import { asOuter, centroid, cleanRing, minAreaRect, signedArea } from '../geom';
import { Rng, hashInts } from '../rng';
import type { LandUse, Lot, P2, Ring } from '../types';
import type { Block } from './blocks';
import { beachShoresAt } from './land';
import type { RoadGraph } from './roadGraph';
import type { TerrainResult } from './terrain';

export function buildLots(seed: number, blocks: Block[], graph: RoadGraph, terrain: TerrainResult): Lot[] {
  const lots: Lot[] = [];
  const rng = new Rng(seed).fork('lots');
  for (const block of blocks) {
    if (block.use !== 'urban') continue;
    const spec = DISTRICTS[block.district];
    const brng = rng.fork(block.id);
    for (const inner of block.inner) {
      const pieces: Ring[] = [];
      const outer = asOuter(inner.outer);
      const front = computeFrontage(outer, spec.sidewalk, graph);
      const frontSegs: Seg[] = [];
      for (let i = 0; i < outer.length; i++) if (front.flags[i]) frontSegs.push([outer[i], outer[(i + 1) % outer.length]]);
      subdivide(outer, spec, brng, 0, pieces, frontSegs);
      for (const piece of pieces) {
        let ring = cleanRing(asOuter(piece), 0.2);
        if (ring.length < 3) continue;
        // Lots overlapping a hole of the inner area are trimmed by it.
        if (inner.holes.length) {
          const cut = intersection([{ outer: ring, holes: [] }], [inner]);
          if (cut.length !== 1 || cut[0].holes.length) continue;
          ring = cleanRing(asOuter(cut[0].outer), 0.2);
        }
        const area = Math.abs(signedArea(ring));
        if (area < 35) continue;
        const frontage = computeFrontage(ring, spec.sidewalk, graph);
        const lot: Lot = {
          id: lots.length,
          district: block.district,
          use: 'residential',
          polygon: ring,
          frontage: frontage.flags,
          groundY: groundHeight(ring, terrain),
          heightHint: 0,
          seed: hashInts(seed, lots.length, 0x5eed),
        };
        lot.use = chooseUse(lot, spec, frontage, brng);
        lot.heightHint = chooseHeight(lot, spec, brng);
        lots.push(lot);
      }
    }
  }
  applyLandmarkLots(lots);
  return lots;
}

type Seg = [P2, P2];

/** True when some edge of `ring` lies on a street-facing segment of the parent block. */
function touchesFrontage(ring: Ring, segs: Seg[]): boolean {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (Math.hypot(b.x - a.x, b.z - a.z) < 3) continue;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    for (const [p, q] of segs) {
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((mx - p.x) * dx + (mz - p.z) * dz) / (l2 || 1)));
      if ((p.x + dx * t - mx) ** 2 + (p.z + dz * t - mz) ** 2 < 0.04) return true;
    }
  }
  return false;
}

function subdivide(ring: Ring, spec: DistrictSpec, rng: Rng, depth: number, out: Ring[], segs: Seg[]): void {
  const area = Math.abs(signedArea(ring));
  if (area <= spec.lotMaxArea * rng.range(0.75, 1.3) || depth > 14 || ring.length < 3) {
    out.push(ring);
    return;
  }
  const obb = minAreaRect(ring);
  const long = obb.halfLong * 2;
  const short = obb.halfShort * 2;
  const perp = { x: -obb.axis.z, z: obb.axis.x };
  // Candidate cuts, preferred first: deep blocks split into two back-to-back rows,
  // otherwise across into narrower street-facing lots.
  const across = (): [P2, P2] => {
    const n = Math.max(2, Math.round(long / spec.lotFrontage));
    const k = Math.floor(n / 2);
    const t = (k / n - 0.5) * long + long * rng.range(-0.04, 0.04);
    return [obb.axis, { x: obb.center.x + obb.axis.x * t, z: obb.center.z + obb.axis.z * t }];
  };
  const lengthwise = (): [P2, P2] => {
    const off = short * rng.range(-0.05, 0.05);
    return [perp, { x: obb.center.x + perp.x * off, z: obb.center.z + perp.z * off }];
  };
  const candidates = short > spec.lotMaxDepth * 2 ? [lengthwise(), across()] : [across(), lengthwise()];
  for (const [normal, origin] of candidates) {
    const [a, b] = splitByLine(ring, origin, normal);
    if (a.length === 0 || b.length === 0) continue;
    const pieces = [...a, ...b].filter((p) => Math.abs(signedArea(p)) >= 20);
    // Every piece must still reach a street and stay wide enough, otherwise try the other cut.
    if (segs.length && !pieces.every((p) => touchesFrontage(p, segs))) continue;
    if (!pieces.every((p) => minAreaRect(p).halfShort * 2 >= spec.lotFrontage * 0.55)) continue;
    for (const piece of pieces) subdivide(piece, spec, rng, depth + 1, out, segs);
    return;
  }
  out.push(ring);
}

/** Splits a ring by the line through `origin` with normal `n`. Fast path for convex rings. */
export function splitByLine(ring: Ring, origin: P2, n: P2): [Ring[], Ring[]] {
  if (isConvex(ring)) {
    const a = clipHalfPlane(ring, origin, n, 1);
    const b = clipHalfPlane(ring, origin, n, -1);
    return [a.length >= 3 ? [a] : [], b.length >= 3 ? [b] : []];
  }
  const L = 20000;
  const t = { x: -n.z, z: n.x };
  const half = (sign: number): Ring =>
    asOuter([
      { x: origin.x + t.x * L, z: origin.z + t.z * L },
      { x: origin.x + t.x * L + n.x * L * sign, z: origin.z + t.z * L + n.z * L * sign },
      { x: origin.x - t.x * L + n.x * L * sign, z: origin.z - t.z * L + n.z * L * sign },
      { x: origin.x - t.x * L, z: origin.z - t.z * L },
    ]);
  const subj = [{ outer: ring, holes: [] }];
  const pa = intersection(subj, [{ outer: half(1), holes: [] }]).filter((p) => polyArea(p) > 1).map((p) => p.outer);
  const pb = intersection(subj, [{ outer: half(-1), holes: [] }]).filter((p) => polyArea(p) > 1).map((p) => p.outer);
  return [pa, pb];
}

function isConvex(r: Ring): boolean {
  let sign = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const c = r[(i + 2) % r.length];
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Sutherland-Hodgman clip of a convex ring to the side where sign * dot(p - o, n) >= 0. */
function clipHalfPlane(ring: Ring, o: P2, n: P2, sign: number): Ring {
  const out: Ring = [];
  const side = (p: P2): number => sign * ((p.x - o.x) * n.x + (p.z - o.z) * n.z);
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
    }
  }
  return out;
}

interface Frontage {
  flags: boolean[];
  /** Most important road class the lot faces (0 none, 2 street, 3 avenue, 4 arterial). */
  best: number;
  length: number;
}

function computeFrontage(ring: Ring, sidewalk: number, graph: RoadGraph): Frontage {
  const flags: boolean[] = [];
  let best = 0;
  let length = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l < 2) {
      flags.push(false);
      continue;
    }
    const nx = (b.z - a.z) / l;
    const nz = -(b.x - a.x) / l;
    const tx = (a.x + b.x) / 2 + nx * (sidewalk + 3);
    const tz = (a.z + b.z) / 2 + nz * (sidewalk + 3);
    const ne = graph.nearestEdge(tx, tz, 16);
    const faces = !!ne && ne.d <= graph.edges[ne.edge].props.width / 2 + 2.5;
    flags.push(faces);
    if (faces) {
      length += l;
      const c = graph.edges[ne!.edge].props.cls;
      best = Math.max(best, c === 'arterial' ? 4 : c === 'avenue' ? 3 : 2);
    }
  }
  return { flags, best, length };
}

function groundHeight(ring: Ring, terrain: TerrainResult): number {
  let h = Infinity;
  for (const p of ring) h = Math.min(h, terrain.grid.sample(terrain.height, p.x, p.z));
  const c = centroid(ring);
  h = Math.min(h, terrain.grid.sample(terrain.height, c.x, c.z));
  return Math.max(0.3, h);
}

function chooseUse(lot: Lot, spec: DistrictSpec, f: Frontage, rng: Rng): LandUse {
  if (f.length === 0) return lot.district === 'palmHeights' || lot.district === 'islands' ? 'park' : 'parking';
  const mix = f.best >= 3 ? spec.useMain : spec.useLocal;
  const uses = Object.keys(mix) as LandUse[];
  let use = rng.weighted(uses, uses.map((u) => mix[u] ?? 0));
  // Ocean-front lots on the barrier island are hotels and condos.
  if (lot.district === 'beach') {
    const c = centroid(lot.polygon);
    if (c.x > beachShoresAt(c.z).east - 175) use = rng.chance(0.55) ? 'hotel' : 'residential';
  }
  return use;
}

function chooseHeight(lot: Lot, spec: DistrictSpec, rng: Rng): number {
  const c = centroid(lot.polygon);
  const jitter = Math.exp(0.35 * rng.gauss());
  switch (lot.district) {
    case 'downtown': {
      const core = Math.exp(-(((c.x - 240) ** 2 + (c.z + 60) ** 2) / 620 ** 2));
      const base = lot.use === 'parking' ? 0 : 22 + 110 * core;
      const tall = lot.use === 'office' || lot.use === 'hotel' ? 1.25 : lot.use === 'residential' ? 1 : 0.55;
      return clampH(base * tall * Math.exp(0.5 * rng.gauss()), lot.use === 'parking' ? 0 : 10, spec.heightMax);
    }
    case 'beach': {
      const s = beachShoresAt(c.z);
      const oceanfront = c.x > s.east - 175;
      if (oceanfront && c.z < -650) return clampH(55 * jitter * (1 + rng.next()), 30, spec.heightMax);
      if (oceanfront) return clampH(16 * jitter * (lot.use === 'hotel' ? 1.6 : 1), 9, 60);
      return clampH(spec.heightMedian * jitter, 7, 30);
    }
    default:
      if (lot.use === 'parking' || lot.use === 'park') return 0;
      return clampH(spec.heightMedian * jitter, 3.5, spec.heightMax);
  }
}

function clampH(h: number, lo: number, hi: number): number {
  return Math.round(Math.min(hi, Math.max(lo, h)) * 10) / 10;
}

/** Landmark towers take the lot nearest their position. */
function applyLandmarkLots(lots: Lot[]): void {
  for (const l of LANDMARKS) {
    if (l.kind !== 'tower') continue;
    let best: Lot | null = null;
    let bestD = 150;
    for (const lot of lots) {
      const c = centroid(lot.polygon);
      const d = Math.hypot(c.x - l.at.x, c.z - l.at.z);
      if (d < bestD && Math.abs(signedArea(lot.polygon)) > 1200) [best, bestD] = [lot, d];
    }
    if (best) {
      best.use = 'office';
      best.heightHint = 285;
    }
  }
}
