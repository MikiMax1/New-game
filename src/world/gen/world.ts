// World generation pipeline: seed -> land -> terrain -> streets -> blocks -> lots.
// Pure data (no three.js), so it runs in a Web Worker or in Node tests.
import { HIGHWAYS, type Highway } from '../authored/layout';
import { catmullRom } from '../geom';
import type { DistrictId, Lot, P2, PolygonWithHoles, RoadClass } from '../types';
import { buildBlocks, type Block } from './blocks';
import { buildDressing, type Dressing } from './dressing';
import { buildParking, type ParkedCars } from './parking';
import { PAINT_COLORS } from '../vehicles/paint';
import { LandModel, buildLand } from './land';
import { buildLots } from './lots';
import { buildStreets } from './streets';
import { TERRAIN_RES, buildTerrain } from './terrain';

export interface RoadNodeData {
  x: number;
  z: number;
  /** Ground height at the node (m). */
  y: number;
  /** Edge ids touching this node. */
  edges: number[];
  culDeSac?: boolean;
}

export interface RoadEdgeData {
  a: number;
  b: number;
  cls: RoadClass;
  width: number;
  lanes: number;
  name: string;
  bridge: boolean;
}

export interface HighwayData extends Highway {
  /** Smoothed centreline. */
  line: P2[];
}

export interface WorldData {
  seed: number;
  terrain: {
    res: number;
    n: number;
    origin: number;
    height: Float32Array;
    shoreDist: Float32Array;
    shoreType: Uint8Array;
  };
  land: PolygonWithHoles[];
  river: PolygonWithHoles[];
  roads: { nodes: RoadNodeData[]; edges: RoadEdgeData[] };
  roadArea: PolygonWithHoles[];
  highways: HighwayData[];
  blocks: Block[];
  lots: Lot[];
  /** Street furniture and vegetation placements. */
  dressing: Dressing;
  /** Parked cars. */
  parked: ParkedCars;
  stats: Record<string, number>;
  timings: Record<string, number>;
}

export type Progress = (stage: string, fraction: number) => void;

export function generateWorld(seed: number, progress: Progress = () => {}): WorldData {
  const timings: Record<string, number> = {};
  let t = performance.now();
  const lap = (name: string): void => {
    const now = performance.now();
    timings[name] = Math.round(now - t);
    t = now;
  };

  progress('Shaping the coastline', 0.05);
  const model = new LandModel(seed);
  const land = buildLand(model);
  lap('land');

  progress('Raising the land', 0.2);
  const terrain = buildTerrain(model, land.land);
  lap('terrain');

  progress('Laying out streets', 0.35);
  const streets = buildStreets(model, terrain);
  lap('streets');

  progress('Cutting city blocks', 0.6);
  const blocksRes = buildBlocks(model, streets.graph, land.land);
  lap('blocks');

  progress('Dividing lots', 0.75);
  const lots = buildLots(seed, blocksRes.blocks, streets.graph, terrain);
  lap('lots');

  // Compact the road graph into plain data.
  const g = streets.graph;
  const nodeMap = new Map<number, number>();
  const nodes: RoadNodeData[] = [];
  const edges: RoadEdgeData[] = [];
  const culs = new Set(streets.culDeSacs);
  for (const e of g.liveEdges()) {
    const E = g.edges[e];
    for (const n of [E.a, E.b]) {
      if (!nodeMap.has(n)) {
        const N = g.nodes[n];
        nodeMap.set(n, nodes.length);
        nodes.push({ x: N.x, z: N.z, y: terrain.grid.sample(terrain.height, N.x, N.z), edges: [], culDeSac: culs.has(n) || undefined });
      }
    }
    const id = edges.length;
    const a = nodeMap.get(E.a)!;
    const b = nodeMap.get(E.b)!;
    edges.push({ a, b, cls: E.props.cls, width: E.props.width, lanes: E.props.lanes, name: E.props.name, bridge: !!E.props.bridge });
    nodes[a].edges.push(id);
    nodes[b].edges.push(id);
  }

  const highways: HighwayData[] = HIGHWAYS.map((h) => ({ ...h, line: catmullRom(h.points, 20) }));

  let roadLength = 0;
  for (const e of edges) roadLength += Math.hypot(nodes[e.b].x - nodes[e.a].x, nodes[e.b].z - nodes[e.a].z);
  const districtCounts: Partial<Record<DistrictId, number>> = {};
  for (const l of lots) districtCounts[l.district] = (districtCounts[l.district] ?? 0) + 1;

  progress('Planting palms', 0.78);
  const partial = { seed, terrain: { res: TERRAIN_RES, n: terrain.grid.n, origin: terrain.grid.origin, height: terrain.height, shoreDist: terrain.shoreDist, shoreType: terrain.shoreType }, roads: { nodes, edges }, blocks: blocksRes.blocks, lots } as unknown as WorldData;
  const dressing = buildDressing(partial);
  const parked = buildParking(partial, PAINT_COLORS.length);
  lap('dressing');

  progress('Done', 1);
  return {
    seed,
    terrain: {
      res: TERRAIN_RES,
      n: terrain.grid.n,
      origin: terrain.grid.origin,
      height: terrain.height,
      shoreDist: terrain.shoreDist,
      shoreType: terrain.shoreType,
    },
    land: land.land,
    river: land.river,
    roads: { nodes, edges },
    roadArea: blocksRes.roadArea,
    highways,
    blocks: blocksRes.blocks,
    lots,
    dressing,
    parked,
    stats: {
      roadNodes: nodes.length,
      roadEdges: edges.length,
      roadKm: Math.round(roadLength / 100) / 10,
      blocks: blocksRes.blocks.length,
      lots: lots.length,
      culDeSacs: streets.culDeSacs.length,
      props: dressing.count,
      parkedCars: parked.count,
      ...Object.fromEntries(Object.entries(districtCounts).map(([k, v]) => [`lots_${k}`, v])),
    },
    timings,
  };
}
