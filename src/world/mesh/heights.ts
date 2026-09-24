// Surface heights used by every mesher: natural ground, the lowered ground shown under
// paved areas (so the terrain never z-fights with roads and sidewalks), and road deck
// heights including bridges that rise over water.
import { bufferLines } from '../clip';
import type { Block } from '../gen/blocks';
import { Grid, fillPolygons } from '../gen/raster';
import type { WorldData } from '../gen/world';
import type { P2, PolygonWithHoles } from '../types';

/** Raised surfaces (sidewalks, lots) sit this far above the ground. */
export const CURB_HEIGHT = 0.15;
/** Terrain under paved areas is lowered by this much. */
export const PAVED_DROP = 0.45;
/** Bridge clearance over water at mid-span (m). */
const BRIDGE_CLEARANCE = 7;
const BRIDGE_GRADE = 0.05;

export function blockIsPaved(b: Block): boolean {
  return b.use !== 'beach' && b.use !== 'wild';
}

export class Heights {
  readonly grid: Grid;
  private readonly height: Float32Array;
  /** Terrain as displayed (lowered under paved areas). */
  readonly display: Float32Array;
  /** 1 where roads or paved blocks cover the terrain sample. */
  readonly covered: Uint8Array;
  /** Road node deck heights (ground, or bridge deck). */
  readonly nodeY: Float32Array;

  constructor(readonly world: WorldData) {
    const t = world.terrain;
    this.grid = new Grid(t.res);
    this.height = t.height;

    // Coverage: road corridors (slightly widened) plus paved blocks.
    const { nodes, edges } = world.roads;
    const lines: { pts: P2[]; halfWidth: number }[] = [];
    for (const e of edges) {
      if (e.bridge) continue;
      const a = nodes[e.a];
      const b = nodes[e.b];
      lines.push({ pts: [{ x: a.x, z: a.z }, { x: b.x, z: b.z }], halfWidth: e.width / 2 + 2.2 });
    }
    const roadMask = fillPolygons(this.grid, bufferLines(lines));
    const paved: PolygonWithHoles[] = world.blocks.filter(blockIsPaved).map((b) => b.poly);
    const blockMask = fillPolygons(this.grid, paved);
    this.covered = new Uint8Array(this.grid.count);
    this.display = new Float32Array(this.grid.count);
    for (let k = 0; k < this.grid.count; k++) {
      const c = roadMask[k] | blockMask[k];
      this.covered[k] = c;
      let y = t.height[k] - (c && t.shoreDist[k] > 0 ? PAVED_DROP : 0);
      // Under paved blocks right at the water, drop the terrain below sea level so no
      // ground pokes out in front of the seawall faces.
      if (blockMask[k] && t.shoreDist[k] > 0 && t.shoreDist[k] < 4.5) y = -1;
      this.display[k] = y;
    }
    this.nodeY = this.computeDeckHeights();
  }

  ground(x: number, z: number): number {
    return this.grid.sample(this.height, x, z);
  }

  shoreDist(x: number, z: number): number {
    return this.grid.sample(this.world.terrain.shoreDist, x, z);
  }

  /** Height of a road surface point on edge `e` at parameter t (0 at node a). */
  roadY(e: number, t: number, x: number, z: number): number {
    const E = this.world.roads.edges[e];
    if (!E.bridge) return Math.max(this.ground(x, z), 0.3);
    return this.nodeY[E.a] * (1 - t) + this.nodeY[E.b] * t;
  }

  /**
   * Bridge decks: along each run of bridge edges, the deck climbs from the landings at
   * a 5% grade up to the clearance height.
   */
  private computeDeckHeights(): Float32Array {
    const { nodes, edges } = this.world.roads;
    const y = new Float32Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) y[i] = Math.max(0.3, this.ground(nodes[i].x, nodes[i].z));
    // Distance from each node to the nearest landing along bridge edges (multi-source Dijkstra).
    const isBridgeNode = new Uint8Array(nodes.length);
    for (const e of edges) if (e.bridge) isBridgeNode[e.a] = isBridgeNode[e.b] = 1;
    const dist = new Float64Array(nodes.length).fill(Infinity);
    const landY = new Float32Array(nodes.length);
    const queue: number[] = [];
    for (let i = 0; i < nodes.length; i++) {
      if (!isBridgeNode[i]) continue;
      // A landing touches a non-bridge edge (or is a dead end on land).
      const landing = nodes[i].edges.some((e) => !edges[e].bridge) || this.shoreDist(nodes[i].x, nodes[i].z) > 1;
      if (landing) {
        dist[i] = 0;
        landY[i] = y[i];
        queue.push(i);
      }
    }
    // Simple label-correcting relaxation (graph is small).
    while (queue.length) {
      const n = queue.shift()!;
      for (const e of nodes[n].edges) {
        const E = edges[e];
        if (!E.bridge) continue;
        const o = E.a === n ? E.b : E.a;
        const d = dist[n] + Math.hypot(nodes[o].x - nodes[n].x, nodes[o].z - nodes[n].z);
        if (d < dist[o]) {
          dist[o] = d;
          landY[o] = landY[n];
          queue.push(o);
        }
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      if (!isBridgeNode[i] || dist[i] === 0 || !Number.isFinite(dist[i])) continue;
      y[i] = Math.max(y[i], Math.min(BRIDGE_CLEARANCE, landY[i] + dist[i] * BRIDGE_GRADE));
    }
    return y;
  }
}
