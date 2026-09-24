// Planar road graph. Roads are inserted as polylines; every crossing with an existing
// road becomes an intersection node, and endpoints snap to nearby roads. That keeps the
// graph planar, so blocks, lanes and traffic can all be derived from it.
import { distToSegmentSq, projectOnSegment, segmentIntersection } from '../geom';
import type { RoadClass } from '../types';

export interface RoadProps {
  cls: RoadClass;
  /** Carriageway width, curb to curb (m). */
  width: number;
  /** Lanes per direction. */
  lanes: number;
  name: string;
  /** Set during generation for roads allowed to cross water. */
  bridge?: boolean;
}

export interface RNode {
  x: number;
  z: number;
  edges: number[];
  alive: boolean;
}

export interface REdge {
  a: number;
  b: number;
  props: RoadProps;
  alive: boolean;
}

interface Hit {
  t: number;
  node?: number;
  edge?: number;
  x: number;
  z: number;
  /** Within half the snap distance of the segment start. */
  nearStart: boolean;
}

const CELL = 64;

export class RoadGraph {
  readonly nodes: RNode[] = [];
  readonly edges: REdge[] = [];
  private readonly edgeCells = new Map<number, number[]>();
  private readonly nodeCells = new Map<number, number[]>();

  private static key(cx: number, cz: number): number {
    return (cx + 4096) * 16384 + (cz + 4096);
  }

  addNode(x: number, z: number): number {
    const id = this.nodes.length;
    this.nodes.push({ x, z, edges: [], alive: true });
    const k = RoadGraph.key(Math.floor(x / CELL), Math.floor(z / CELL));
    let cell = this.nodeCells.get(k);
    if (!cell) this.nodeCells.set(k, (cell = []));
    cell.push(id);
    return id;
  }

  findEdge(a: number, b: number): number {
    for (const e of this.nodes[a].edges) {
      const E = this.edges[e];
      if (E.alive && ((E.a === a && E.b === b) || (E.a === b && E.b === a))) return e;
    }
    return -1;
  }

  addEdge(a: number, b: number, props: RoadProps): number {
    if (a === b) return -1;
    const existing = this.findEdge(a, b);
    if (existing >= 0) {
      // Keep the more important road class when two roads share a segment.
      if (rank(props.cls) > rank(this.edges[existing].props.cls)) this.edges[existing].props = props;
      return existing;
    }
    const id = this.edges.length;
    this.edges.push({ a, b, props, alive: true });
    this.nodes[a].edges.push(id);
    this.nodes[b].edges.push(id);
    this.indexEdge(id);
    return id;
  }

  removeEdge(id: number): void {
    const E = this.edges[id];
    if (!E.alive) return;
    E.alive = false;
    for (const n of [E.a, E.b]) {
      const N = this.nodes[n];
      N.edges = N.edges.filter((x) => x !== id);
      if (N.edges.length === 0) N.alive = false;
    }
  }

  /** Splits edge `id` at (x, z); returns the new middle node. */
  splitEdge(id: number, x: number, z: number): number {
    const E = this.edges[id];
    const mid = this.addNode(x, z);
    const oldB = E.b;
    // Edge id becomes a -> mid; a new edge carries mid -> b.
    const bn = this.nodes[oldB];
    bn.edges = bn.edges.filter((e) => e !== id);
    E.b = mid;
    this.nodes[mid].edges.push(id);
    const nid = this.edges.length;
    this.edges.push({ a: mid, b: oldB, props: E.props, alive: true });
    this.nodes[mid].edges.push(nid);
    bn.edges.push(nid);
    this.indexEdge(nid);
    return mid;
  }

  degree(n: number): number {
    return this.nodes[n].edges.length;
  }

  edgeLength(id: number): number {
    const E = this.edges[id];
    const a = this.nodes[E.a];
    const b = this.nodes[E.b];
    return Math.hypot(b.x - a.x, b.z - a.z);
  }

  other(edge: number, node: number): number {
    const E = this.edges[edge];
    return E.a === node ? E.b : E.a;
  }

  nodesNear(x: number, z: number, r: number): number[] {
    const out: number[] = [];
    const c0x = Math.floor((x - r) / CELL);
    const c1x = Math.floor((x + r) / CELL);
    const c0z = Math.floor((z - r) / CELL);
    const c1z = Math.floor((z + r) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const cell = this.nodeCells.get(RoadGraph.key(cx, cz));
        if (!cell) continue;
        for (const n of cell) {
          const N = this.nodes[n];
          if (N.alive && (N.x - x) ** 2 + (N.z - z) ** 2 <= r * r) out.push(n);
        }
      }
    }
    return out;
  }

  edgesNear(minX: number, minZ: number, maxX: number, maxZ: number): number[] {
    const seen = new Set<number>();
    const out: number[] = [];
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const cell = this.edgeCells.get(RoadGraph.key(cx, cz));
        if (!cell) continue;
        for (const e of cell) {
          if (seen.has(e) || !this.edges[e].alive) continue;
          seen.add(e);
          out.push(e);
        }
      }
    }
    return out;
  }

  /** Closest live edge within r of (x, z), with the projection parameter. */
  nearestEdge(x: number, z: number, r: number): { edge: number; t: number; d: number } | null {
    let best: { edge: number; t: number; d: number } | null = null;
    for (const e of this.edgesNear(x - r, z - r, x + r, z + r)) {
      const E = this.edges[e];
      const a = this.nodes[E.a];
      const b = this.nodes[E.b];
      const d2 = distToSegmentSq(x, z, a.x, a.z, b.x, b.z);
      if (d2 <= r * r && (!best || d2 < best.d * best.d)) {
        best = { edge: e, t: projectOnSegment(x, z, a.x, a.z, b.x, b.z), d: Math.sqrt(d2) };
      }
    }
    return best;
  }

  /** Node at (x, z): an existing node within `snap`, a split of a nearby edge, or a new node. */
  snapPoint(x: number, z: number, snap: number): number {
    let bestN = -1;
    let bestD = snap * snap;
    for (const n of this.nodesNear(x, z, snap)) {
      const N = this.nodes[n];
      const d = (N.x - x) ** 2 + (N.z - z) ** 2;
      if (d <= bestD) {
        bestD = d;
        bestN = n;
      }
    }
    if (bestN >= 0) return bestN;
    const ne = this.nearestEdge(x, z, snap);
    if (ne) {
      const E = this.edges[ne.edge];
      const a = this.nodes[E.a];
      const b = this.nodes[E.b];
      return this.splitEdge(ne.edge, a.x + (b.x - a.x) * ne.t, a.z + (b.z - a.z) * ne.t);
    }
    return this.addNode(x, z);
  }

  /**
   * Insert a road along `pts`. Crossings with existing roads become intersections;
   * points within `snap` metres of existing roads join them. Returns the node path.
   */
  insertPolyline(pts: readonly { x: number; z: number }[], props: RoadProps, snap = 2.5): number[] {
    if (pts.length < 2) return [];
    let cur = this.snapPoint(pts[0].x, pts[0].z, snap);
    const path = [cur];
    for (let i = 1; i < pts.length; i++) {
      const q = pts[i];
      const last = i === pts.length - 1;
      // Walk towards q, resolving one crossing at a time (splits change the graph).
      for (let guard = 0; guard < 64; guard++) {
        const P = this.nodes[cur];
        const hits = this.crossings(P.x, P.z, q.x, q.z, cur, snap);
        if (hits.length === 0) break;
        const h = hits[0];
        let node: number;
        if (h.nearStart) {
          // A road passes (or ends) within snap of the current node: route it through the node.
          node = h.node ?? this.splitEdge(h.edge!, h.x, h.z);
          if (node !== cur) this.mergeNodes(cur, node);
          continue;
        }
        node = h.node ?? this.splitEdge(h.edge!, h.x, h.z);
        if (node === cur) break;
        this.addEdge(cur, node, props);
        cur = node;
        path.push(node);
      }
      const C = this.nodes[cur];
      const remaining = Math.hypot(q.x - C.x, q.z - C.z);
      if (!last && remaining < snap * 2) continue; // avoid tiny edges right after an intersection
      const end = this.snapPoint(q.x, q.z, last ? snap : snap * 0.5);
      if (end !== cur) {
        this.addEdge(cur, end, props);
        cur = end;
        path.push(end);
      }
    }
    return path;
  }

  /** Moves every edge of `drop` onto `keep` and deletes `drop`. */
  mergeNodes(keep: number, drop: number): void {
    if (keep === drop) return;
    const D = this.nodes[drop];
    for (const e of D.edges.slice()) {
      const E = this.edges[e];
      if (!E.alive) continue;
      const other = E.a === drop ? E.b : E.a;
      const props = E.props;
      this.removeEdge(e);
      if (other !== keep) this.addEdge(keep, other, props);
    }
    D.edges = [];
    D.alive = false;
  }

  private crossings(ax: number, az: number, bx: number, bz: number, from: number, snap: number): Hit[] {
    const hits: Hit[] = [];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) return hits;
    const cand = this.edgesNear(Math.min(ax, bx) - snap, Math.min(az, bz) - snap, Math.max(ax, bx) + snap, Math.max(az, bz) + snap);
    const near = snap * 0.5;
    const seenNodes = new Set<number>();
    for (const e of cand) {
      const E = this.edges[e];
      if (E.a === from || E.b === from) continue;
      const c = this.nodes[E.a];
      const d = this.nodes[E.b];
      const r = segmentIntersection(ax, az, bx, bz, c.x, c.z, d.x, d.z);
      if (r) {
        const x = ax + (bx - ax) * r.t;
        const z = az + (bz - az) * r.t;
        const nearStart = r.t * len < near;
        if ((x - c.x) ** 2 + (z - c.z) ** 2 < snap * snap) hits.push({ t: r.t, node: E.a, x: c.x, z: c.z, nearStart });
        else if ((x - d.x) ** 2 + (z - d.z) ** 2 < snap * snap) hits.push({ t: r.t, node: E.b, x: d.x, z: d.z, nearStart });
        else hits.push({ t: r.t, edge: e, x, z, nearStart });
        continue;
      }
      // An existing road ends right next to our path: connect through its end node.
      for (const n of [E.a, E.b]) {
        if (seenNodes.has(n)) continue;
        const N = this.nodes[n];
        if (distToSegmentSq(N.x, N.z, ax, az, bx, bz) >= snap * snap) continue;
        const t = projectOnSegment(N.x, N.z, ax, az, bx, bz);
        if ((1 - t) * len < 0.01) continue; // at our far end: the end snap handles it
        seenNodes.add(n);
        hits.push({ t, node: n, x: N.x, z: N.z, nearStart: t * len < near });
      }
      // The current node sits on (or right next to) an existing road without crossing it.
      const dStart = distToSegmentSq(ax, az, c.x, c.z, d.x, d.z);
      if (dStart < near * near) {
        const t = projectOnSegment(ax, az, c.x, c.z, d.x, d.z);
        const px = c.x + (d.x - c.x) * t;
        const pz = c.z + (d.z - c.z) * t;
        if ((px - c.x) ** 2 + (pz - c.z) ** 2 < near * near) hits.push({ t: 0, node: E.a, x: c.x, z: c.z, nearStart: true });
        else if ((px - d.x) ** 2 + (pz - d.z) ** 2 < near * near) hits.push({ t: 0, node: E.b, x: d.x, z: d.z, nearStart: true });
        else hits.push({ t: 0, edge: e, x: px, z: pz, nearStart: true });
      }
    }
    hits.sort((p, q) => (p.nearStart === q.nearStart ? p.t - q.t : p.nearStart ? -1 : 1));
    return hits;
  }

  private indexEdge(id: number): void {
    const E = this.edges[id];
    const a = this.nodes[E.a];
    const b = this.nodes[E.b];
    for (let cx = Math.floor(Math.min(a.x, b.x) / CELL); cx <= Math.floor(Math.max(a.x, b.x) / CELL); cx++) {
      for (let cz = Math.floor(Math.min(a.z, b.z) / CELL); cz <= Math.floor(Math.max(a.z, b.z) / CELL); cz++) {
        const k = RoadGraph.key(cx, cz);
        let cell = this.edgeCells.get(k);
        if (!cell) this.edgeCells.set(k, (cell = []));
        cell.push(id);
      }
    }
  }

  /**
   * Chain of edges from `start` through `firstEdge`, continuing through degree-2 nodes.
   * Returns the edges, the end node and the total length.
   */
  walkChain(start: number, firstEdge: number): { edges: number[]; end: number; length: number } {
    const edges = [firstEdge];
    let length = this.edgeLength(firstEdge);
    let prevEdge = firstEdge;
    let node = this.other(firstEdge, start);
    while (this.degree(node) === 2 && node !== start) {
      const next = this.nodes[node].edges[0] === prevEdge ? this.nodes[node].edges[1] : this.nodes[node].edges[0];
      edges.push(next);
      length += this.edgeLength(next);
      prevEdge = next;
      node = this.other(next, node);
      if (edges.length > 100000) break;
    }
    return { edges, end: node, length };
  }

  /** Removes dead-end stubs shorter than `minLength` (repeats until stable). */
  pruneDeadEnds(minLength: number, keep?: (edge: number) => boolean): number {
    let removed = 0;
    let changed = true;
    while (changed) {
      changed = false;
      for (let n = 0; n < this.nodes.length; n++) {
        const N = this.nodes[n];
        if (!N.alive || N.edges.length !== 1) continue;
        const chain = this.walkChain(n, N.edges[0]);
        const endDeg = this.degree(chain.end);
        const isolated = endDeg === 1;
        if (chain.length < (isolated ? minLength * 3 : minLength) && !(keep && chain.edges.some(keep))) {
          for (const e of chain.edges) this.removeEdge(e);
          removed += chain.edges.length;
          changed = true;
        }
      }
    }
    return removed;
  }

  /** Connected components (lists of live node ids), largest first. */
  components(): number[][] {
    const seen = new Uint8Array(this.nodes.length);
    const comps: number[][] = [];
    for (let s = 0; s < this.nodes.length; s++) {
      if (!this.nodes[s].alive || seen[s]) continue;
      const comp: number[] = [];
      const stack = [s];
      seen[s] = 1;
      while (stack.length) {
        const n = stack.pop()!;
        comp.push(n);
        for (const e of this.nodes[n].edges) {
          const o = this.other(e, n);
          if (!seen[o]) {
            seen[o] = 1;
            stack.push(o);
          }
        }
      }
      comps.push(comp);
    }
    return comps.sort((a, b) => b.length - a.length);
  }

  /** True if removing the given edges keeps nodes a and b connected. */
  connectedWithout(a: number, b: number, removed: Set<number>): boolean {
    const seen = new Set<number>([a]);
    const stack = [a];
    while (stack.length) {
      const n = stack.pop()!;
      if (n === b) return true;
      for (const e of this.nodes[n].edges) {
        if (removed.has(e)) continue;
        const o = this.other(e, n);
        if (!seen.has(o)) {
          seen.add(o);
          stack.push(o);
        }
      }
    }
    return false;
  }

  liveEdges(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.edges.length; i++) if (this.edges[i].alive) out.push(i);
    return out;
  }
}

function rank(c: RoadClass): number {
  return c === 'highway' ? 5 : c === 'arterial' ? 4 : c === 'avenue' ? 3 : c === 'street' ? 2 : c === 'ramp' ? 1 : 0;
}
