// Land and water as vector polygons: coastlines with natural detail, the river,
// swamp ponds, islands. Also the district map.
import type { NoiseFunction2D } from 'simplex-noise';
import {
  BAY_ISLANDS, BEACH_PROFILE, DISTRICT_SEEDS, HIGHWAYS, LATTICE, MAINLAND, PORT_ISLAND, RIVER,
  beachIslandRing, riverWidth,
} from '../authored/layout';
import { bufferLines, difference, intersection, union } from '../clip';
import { MAP_HALF } from '../config';
import { asOuter, catmullRom, chaikin, ellipseRing, pointInRing, resamplePolyline } from '../geom';
import { fbm, makeNoise } from '../noise';
import { Rng } from '../rng';
import type { DistrictId, P2, PolygonWithHoles, Ring } from '../types';

export type ShoreType = 'seawall' | 'beach' | 'natural' | 'marsh';
export type Landmass = 'mainland' | 'beach' | 'port' | 'islands' | 'water';

export interface LandResult {
  land: PolygonWithHoles[];
  /** River polygons (for rendering and bridges). */
  river: PolygonWithHoles[];
  /** Coarse landmass shapes for classification. */
  landmass: { kind: Landmass; ring: Ring }[];
  riverLine: P2[];
}

/** Everything the land/district functions need, created once per seed. */
export class LandModel {
  readonly noiseA: NoiseFunction2D;
  readonly noiseB: NoiseFunction2D;
  readonly beachRing: Ring;
  readonly islandRings: { ring: Ring; district: DistrictId }[];

  constructor(readonly seed: number) {
    this.noiseA = makeNoise(seed * 31 + 1);
    this.noiseB = makeNoise(seed * 31 + 2);
    this.beachRing = asOuter(beachIslandRing());
    this.islandRings = BAY_ISLANDS.map((b) => ({ ring: ellipseRing(b.cx, b.cz, b.rx, b.rz, b.rot, 40), district: b.district }));
  }

  landmassAt(x: number, z: number): Landmass {
    if (pointInRing(x, z, this.beachRing)) return 'beach';
    if (pointInRing(x, z, PORT_ISLAND)) return 'port';
    for (const i of this.islandRings) if (pointInRing(x, z, i.ring)) return 'islands';
    if (pointInRing(x, z, MAINLAND)) return 'mainland';
    return 'water';
  }

  /** District at a point. Water points get the district of the landmass they'd belong to. */
  districtAt(x: number, z: number): DistrictId {
    const lm = this.landmassAt(x, z);
    if (lm === 'beach') return 'beach';
    if (lm === 'port') return 'harbor';
    if (lm === 'islands') return 'islands';
    // Mainland (or water next to it): weighted Voronoi with noisy borders.
    const px = x + 110 * this.noiseA(x / 700, z / 700);
    const pz = z + 110 * this.noiseB(x / 700, z / 700);
    if (px < -1520) return 'cypressEdge';
    let best = DISTRICT_SEEDS[0];
    let bestD = Infinity;
    for (const s of DISTRICT_SEEDS) {
      const d = Math.hypot(px - s.x, pz - s.z) / s.weight;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best.district;
  }

  shoreTypeAt(x: number, z: number): ShoreType {
    const lm = this.landmassAt(x, z);
    if (lm === 'beach' || (lm === 'water' && x > 1000)) {
      // Ocean side of the barrier island is sand; the bay side has seawalls.
      return x > beachCentreX(z) ? 'beach' : 'seawall';
    }
    if (lm === 'port' || lm === 'islands') return 'seawall';
    const d = this.districtAt(x, z);
    if (d === 'palmHeights') return 'natural';
    if (d === 'cypressEdge') return 'marsh';
    return 'seawall';
  }
}

/** x of the barrier island centreline at z (linear in the authored profile). */
export function beachCentreX(z: number): number {
  const p = BEACH_PROFILE;
  if (z <= p[0].z) return (p[0].west + p[0].east) / 2;
  for (let i = 1; i < p.length; i++) {
    if (z <= p[i].z) {
      const t = (z - p[i - 1].z) / (p[i].z - p[i - 1].z);
      return ((p[i - 1].west + p[i - 1].east) / 2) * (1 - t) + ((p[i].west + p[i].east) / 2) * t;
    }
  }
  const l = p[p.length - 1];
  return (l.west + l.east) / 2;
}

/** West and east shore x of the (authored, smooth) barrier island at z. */
export function beachShoresAt(z: number): { west: number; east: number } {
  const p = BEACH_PROFILE;
  if (z <= p[0].z) return { west: p[0].west, east: p[0].east };
  for (let i = 1; i < p.length; i++) {
    if (z <= p[i].z) {
      const t = (z - p[i - 1].z) / (p[i].z - p[i - 1].z);
      const s = t * t * (3 - 2 * t) * 0.35 + t * 0.65; // slightly eased
      return { west: p[i - 1].west * (1 - s) + p[i].west * s, east: p[i - 1].east * (1 - s) + p[i].east * s };
    }
  }
  const l = p[p.length - 1];
  return { west: l.west, east: l.east };
}

/** Adds natural wiggle to a ring along its normals; amplitude depends on shore type. */
function detailShore(model: LandModel, ring: Ring, noise: NoiseFunction2D): Ring {
  const pts = resamplePolyline([...ring, ring[0]], 10);
  pts.pop();
  const out: Ring = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    const p = pts[i];
    let nx = b.z - a.z;
    let nz = -(b.x - a.x);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    const type = model.shoreTypeAt(p.x - nx * 6, p.z - nz * 6);
    let amp = 0;
    let freq = 1 / 150;
    if (type === 'natural') {
      amp = 13;
      freq = 1 / 140;
    } else if (type === 'marsh') {
      amp = 26;
      freq = 1 / 110;
    } else if (type === 'beach') {
      amp = 4;
      freq = 1 / 420;
    }
    const disp = amp * fbm(noise, p.x * freq, p.z * freq, 3, 0.55);
    out.push({ x: p.x + nx * disp, z: p.z + nz * disp });
  }
  return chaikin(out, 1, true);
}

export function buildLand(model: LandModel): LandResult {
  const rng = new Rng(model.seed).fork('land');
  const noise = makeNoise(model.seed * 7 + 3);

  const mainland = detailShore(model, asOuter(MAINLAND), noise);
  // The bay side of the barrier island stays crisp (seawalls), the ocean side gets a soft beach curve.
  const beach = detailShore(model, asOuter(catmullRom(beachIslandRing(), 25, true)), noise);
  const port = asOuter(PORT_ISLAND);
  const islands = model.islandRings.map((i) => detailShore(model, i.ring, noise));

  let land = union([{ outer: mainland, holes: [] }, { outer: beach, holes: [] }, { outer: port, holes: [] }, ...islands.map((r) => ({ outer: r, holes: [] }))]);

  // River: buffer the smoothed centreline in short pieces so the width can taper.
  const riverLine = catmullRom(RIVER, 20);
  const pieces: { pts: P2[]; halfWidth: number }[] = [];
  for (let i = 0; i + 1 < riverLine.length; i += 4) {
    const seg = riverLine.slice(i, Math.min(riverLine.length, i + 6));
    const mid = seg[Math.floor(seg.length / 2)];
    const wobble = 1 + 0.15 * noise(mid.x / 90, mid.z / 90);
    pieces.push({ pts: seg, halfWidth: (riverWidth(mid.x) * wobble) / 2 });
  }
  const river = bufferLines(pieces);

  // Swamp ponds and sloughs in Cypress Edge, keeping clear of the rural roads and highways.
  const ponds: PolygonWithHoles[] = [];
  const keepClear = (x: number, z: number): boolean => {
    for (const rz of LATTICE.ruralZ) if (Math.abs(z - rz) < 55) return true;
    for (const h of HIGHWAYS) {
      for (let i = 1; i < h.points.length; i++) {
        const a = h.points[i - 1];
        const b = h.points[i];
        const t = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / ((b.x - a.x) ** 2 + (b.z - a.z) ** 2)));
        if (Math.hypot(a.x + (b.x - a.x) * t - x, a.z + (b.z - a.z) * t - z) < 60) return true;
      }
    }
    return false;
  };
  for (let tries = 0; tries < 400 && ponds.length < 70; tries++) {
    const x = rng.range(-MAP_HALF - 50, -1560);
    const z = rng.range(-MAP_HALF - 50, MAP_HALF + 50);
    if (model.districtAt(x, z) !== 'cypressEdge') continue;
    const r = rng.range(18, 85);
    if (keepClear(x, z) || keepClear(x + r, z) || keepClear(x - r, z) || keepClear(x, z + r) || keepClear(x, z - r)) continue;
    const ring: Ring = [];
    const k = 20;
    const rot = rng.range(0, Math.PI);
    const squash = rng.range(0.45, 1);
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2;
      const rr = r * (0.75 + 0.35 * noise(x / 40 + Math.cos(a), z / 40 + Math.sin(a)));
      const lx = Math.cos(a) * rr;
      const lz = Math.sin(a) * rr * squash;
      ring.push({ x: x + lx * Math.cos(rot) - lz * Math.sin(rot), z: z + lx * Math.sin(rot) + lz * Math.cos(rot) });
    }
    ponds.push({ outer: asOuter(ring), holes: [] });
  }

  land = difference(land, [...river, ...ponds]);
  // Clip to the map square (a little margin so terrain meshes at the edge are complete).
  const m = MAP_HALF + 8;
  land = intersection(land, [{ outer: asOuter([{ x: -m, z: -m }, { x: m, z: -m }, { x: m, z: m }, { x: -m, z: m }]), holes: [] }]);

  return {
    land,
    river,
    riverLine,
    landmass: [
      { kind: 'mainland', ring: mainland },
      { kind: 'beach', ring: beach },
      { kind: 'port', ring: port },
      ...islands.map((ring) => ({ kind: 'islands' as const, ring })),
    ],
  };
}
