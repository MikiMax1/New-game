// Named camera spots ("photo spots") used by screenshots and the number keys.
import type { WorldData } from './gen/world';

export interface Spot {
  name: string;
  pos: [number, number, number];
  look: [number, number, number];
}

interface StreetSpec {
  near: [number, number];
  /** Prefer nodes on roads whose name contains this. */
  road?: string;
  /** Preferred view direction (unit-ish x, z); the edge closest to it is used. */
  dir: [number, number];
  minDegree?: number;
}

const AERIAL: Spot[] = [
  { name: 'overview', pos: [1150, 560, 1250], look: [-150, 0, -250] },
  { name: 'skyline', pos: [780, 40, 420], look: [150, 45, -120] },
  { name: 'river', pos: [-80, 28, 200], look: [300, 4, 70] },
  { name: 'port', pos: [620, 90, 380], look: [860, 0, 20] },
  { name: 'beachAerial', pos: [1750, 90, 1200], look: [1250, 0, 700] },
  { name: 'suburbs', pos: [-150, 160, 1650], look: [-700, 0, 1050] },
];

const STREET: Record<string, StreetSpec> = {
  downtown: { near: [160, -40], dir: [0, -1], minDegree: 3 },
  littleSolano: { near: [-800, 150], dir: [1, 0], minDegree: 3 },
  palmHeights: { near: [-500, 1150], dir: [0, 1], minDegree: 3 },
  oceanDrive: { near: [1350, 1000], road: 'Ocean Drive', dir: [0, -1] },
  causeway: { near: [800, -349], road: 'Solmar Causeway', dir: [-1, 0] },
  bayshore: { near: [420, -250], road: 'Bayshore', dir: [0, 1] },
};

export const SPOT_NAMES = ['overview', 'skyline', 'downtown', 'littleSolano', 'palmHeights', 'oceanDrive', 'causeway', 'bayshore', 'river', 'port', 'beachAerial', 'suburbs'];

export function findSpot(name: string, world: WorldData, groundY: (x: number, z: number) => number, nodeY?: Float32Array): Spot | null {
  const aerial = AERIAL.find((s) => s.name === name);
  if (aerial) return aerial;
  const spec = STREET[name];
  if (!spec) return null;
  const { nodes, edges } = world.roads;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.edges.length < (spec.minDegree ?? 2)) continue;
    if (spec.road && !n.edges.some((e) => edges[e].name.includes(spec.road!))) continue;
    const d = Math.hypot(n.x - spec.near[0], n.z - spec.near[1]);
    if (d < bestD) [best, bestD] = [i, d];
  }
  if (best < 0) return null;
  const n = nodes[best];
  // Edge whose direction best matches the requested view direction.
  let dir: [number, number] = spec.dir;
  let bestDot = -Infinity;
  for (const e of n.edges) {
    const E = edges[e];
    const o = nodes[E.a === best ? E.b : E.a];
    const dx = o.x - n.x;
    const dz = o.z - n.z;
    const l = Math.hypot(dx, dz) || 1;
    const dot = (dx / l) * spec.dir[0] + (dz / l) * spec.dir[1];
    if (dot > bestDot) [bestDot, dir] = [dot, [dx / l, dz / l]];
  }
  // Stand in the right-hand lane, eye height 1.7 m.
  const rx = -dir[1];
  const rz = dir[0];
  const x = n.x - rx * 3;
  const z = n.z - rz * 3;
  const y = (nodeY ? nodeY[best] : groundY(x, z)) + 1.7;
  return { name, pos: [x, y, z], look: [x + dir[0] * 120, y - 1, z + dir[1] * 120] };
}
