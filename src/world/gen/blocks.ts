// City blocks: land minus road corridors, with rounded curb returns; the lot area inside
// each block after the sidewalk; land use per block.
import { DISTRICTS } from '../authored/districts';
import { HIGHWAYS, LANDMARKS, type LandmarkKind } from '../authored/layout';
import { bufferLines, difference, intersection, offset, opening, polyArea } from '../clip';
import { asOuter, centroid, pointInRing, ringBounds } from '../geom';
import { Rng } from '../rng';
import type { DistrictId, P2, PolygonWithHoles } from '../types';
import { beachCentreX, type LandModel } from './land';
import type { RoadGraph } from './roadGraph';

export type BlockUse =
  | 'urban' // subdivided into lots
  | 'park'
  | 'plaza' // small traffic island or square
  | 'beach'
  | 'wild' // swamp, open land
  | LandmarkKind;

export interface Block {
  id: number;
  /** Curb line (outer edge of the sidewalk). */
  poly: PolygonWithHoles;
  /** Area inside the sidewalk, available for lots (urban blocks only). */
  inner: PolygonWithHoles[];
  district: DistrictId;
  use: BlockUse;
  area: number;
  /** Landmark name when the block is reserved for one. */
  landmark?: string;
}

export interface BlocksResult {
  blocks: Block[];
  roadArea: PolygonWithHoles[];
  highwayArea: PolygonWithHoles[];
}

const CURB_RADIUS = 6;
const DEBUG_TIMING = typeof process !== 'undefined' && !!process.env?.SOLMAR_TIMING;

export function buildBlocks(model: LandModel, graph: RoadGraph, land: PolygonWithHoles[]): BlocksResult {
  const rng = new Rng(model.seed).fork('blocks');
  // Buffer whole chains of edges (intersection to intersection) rather than single
  // edges: far fewer round caps, so much smaller polygons.
  const lines: { pts: P2[]; halfWidth: number }[] = [];
  const done = new Set<number>();
  for (let n = 0; n < graph.nodes.length; n++) {
    const N = graph.nodes[n];
    if (!N.alive || graph.degree(n) === 2) continue;
    for (const e of N.edges) {
      if (done.has(e)) continue;
      const chain = graph.walkChain(n, e);
      let node = n;
      const pts: P2[] = [{ x: N.x, z: N.z }];
      let width = 0;
      for (const ce of chain.edges) {
        done.add(ce);
        node = graph.other(ce, node);
        pts.push({ x: graph.nodes[node].x, z: graph.nodes[node].z });
        width = Math.max(width, graph.edges[ce].props.width);
      }
      lines.push({ pts, halfWidth: width / 2 });
    }
  }
  // Loops made only of degree-2 nodes (e.g. an island ring road).
  for (const e of graph.liveEdges()) {
    if (done.has(e)) continue;
    const E = graph.edges[e];
    const chain = graph.walkChain(E.a, e);
    let node = E.a;
    const pts: P2[] = [{ x: graph.nodes[E.a].x, z: graph.nodes[E.a].z }];
    for (const ce of chain.edges) {
      done.add(ce);
      node = graph.other(ce, node);
      pts.push({ x: graph.nodes[node].x, z: graph.nodes[node].z });
    }
    lines.push({ pts, halfWidth: E.props.width / 2 });
  }
  const T = (label: string, t0: number): void => { if (DEBUG_TIMING) console.log(label, Math.round(performance.now() - t0)); };
  let t0 = performance.now();
  const roadArea = bufferLines(lines);
  T('buffer', t0); t0 = performance.now();
  const raw = difference(land, roadArea);
  T('difference', t0); t0 = performance.now();
  // The ocean side of the barrier island: an ~85 m sand strip in front of the hotels.
  // Only blocks near the strip go through the extra boolean ops.
  const strip = oceanBeachStrip(land);
  const sb = strip.length ? ringBounds(strip.flatMap((p) => p.outer)) : null;
  const nearStrip = (p: PolygonWithHoles): boolean => {
    if (!sb) return false;
    const b = ringBounds(p.outer);
    return b.maxX >= sb.minX && b.minX <= sb.maxX && b.maxZ >= sb.minZ && b.minZ <= sb.maxZ;
  };
  const rawNear = raw.filter(nearStrip);
  const rawFar = raw.filter((p) => !nearStrip(p));
  // Clipper is much faster on many small problems than one big one, so open block by block.
  const openEach = (polys: PolygonWithHoles[], r: number): PolygonWithHoles[] => polys.flatMap((p) => opening([p], r));
  const sand = openEach(intersection(rawNear, strip), 3).map((poly) => ({ poly, sand: true }));
  const rest = openEach([...difference(rawNear, strip), ...rawFar], CURB_RADIUS).map((poly) => ({ poly, sand: false }));
  const blocksPolys = [...rest, ...sand];
  T('strip+opening', t0); t0 = performance.now();
  const highwayArea = bufferLines(HIGHWAYS.map((h) => ({ pts: h.points, halfWidth: 17 })), 'butt');

  const blocks: Block[] = [];
  for (const { poly, sand: isSand } of blocksPolys) {
    const area = polyArea(poly);
    if (area < 40) continue;
    const c = interiorPoint(poly);
    const district = model.districtAt(c.x, c.z);
    const spec = DISTRICTS[district];
    let use: BlockUse = 'urban';
    let landmark: string | undefined;

    const lm = LANDMARKS.find((l) => {
      if (l.reserve) return Math.abs(c.x - l.at.x) < l.reserve.halfX && Math.abs(c.z - l.at.z) < l.reserve.halfZ;
      return pointInRing(l.at.x, l.at.z, poly.outer) && ['park', 'arena', 'marina'].includes(l.kind);
    });
    if (isSand) use = 'beach';
    else if (district === 'cypressEdge') use = 'wild';
    else if (lm && lm.kind !== 'tower' && lm.kind !== 'cranes' && lm.kind !== 'lighthouse' && lm.kind !== 'pier') {
      use = lm.kind;
      landmark = lm.name;
    } else if (area < 450) use = 'plaza';
    else if (area < 30000 && rng.chance(spec.parkChance)) use = 'park';

    let inner: PolygonWithHoles[] = [];
    if (use === 'urban') {
      inner = offset([poly], -spec.sidewalk, 'miter');
      inner = difference(inner, highwayArea).filter((p) => polyArea(p) > 60);
    }
    blocks.push({ id: blocks.length, poly, inner, district, use, area, landmark });
  }
  T('per-block', t0);
  return { blocks, roadArea, highwayArea };
}

/** Sand strip along the ocean shore of the barrier island (from the waterline ~85 m inland). */
function oceanBeachStrip(land: PolygonWithHoles[]): PolygonWithHoles[] {
  const island = land.filter((p) => pointInRing(1300, 0, p.outer));
  if (island.length === 0) return [];
  const band = difference(island, offset(island, -85, 'round'));
  // Keep the ocean (east) half only.
  const east: P2[] = [];
  for (let z = -2200; z <= 1800; z += 50) east.push({ x: beachCentreX(z), z });
  east.push({ x: 2300, z: 1800 }, { x: 2300, z: -2200 });
  return intersection(band, [{ outer: asOuter(east), holes: [] }]);
}

/** A point guaranteed to be inside the polygon (centroid if inside, else a nearby vertex-based guess). */
export function interiorPoint(poly: PolygonWithHoles): P2 {
  const c = centroid(poly.outer);
  const inside = (p: P2): boolean => pointInRing(p.x, p.z, poly.outer) && !poly.holes.some((h) => pointInRing(p.x, p.z, h));
  if (inside(c)) return c;
  // Try points slightly inside from each edge midpoint.
  const r = poly.outer;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    // Inward normal for a positive ring is (-(b.z - a.z), b.x - a.x).
    for (const d of [1, 3, 8]) {
      const p = { x: mx - ((b.z - a.z) / l) * d, z: mz + ((b.x - a.x) / l) * d };
      if (inside(p)) return p;
    }
  }
  return c;
}
