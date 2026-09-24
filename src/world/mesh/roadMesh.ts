// Road surfaces and paint. Each edge is a subdivided strip and each node a disc
// (covering curb returns at intersections). Overlapping pieces share one asphalt
// material with world-space UVs, so overlaps are invisible. Markings follow each
// chain of edges between intersections: centre lines, lane dashes, edge lines,
// crosswalks and stop bars.
import type { DistrictId, RoadClass } from '../types';
import type { WorldData } from '../gen/world';
import type { Heights } from './heights';
import type { MeshBuilder } from './meshData';

export const CURB_RADIUS = 6;

type Sink = (anchorX: number, anchorZ: number, bucket: string) => MeshBuilder;

interface Ctx {
  world: WorldData;
  h: Heights;
  sink: Sink;
  district: (x: number, z: number) => DistrictId;
}

/** Node clearance: how far from the node centre lane paint stops (curb returns). */
export function junctionRadius(world: WorldData, n: number): number {
  const node = world.roads.nodes[n];
  if (node.edges.length < 3) return 0;
  const hws = node.edges.map((e) => world.roads.edges[e].width / 2).sort((a, b) => b - a);
  return Math.sqrt(hws[1] ** 2 + (hws[0] + CURB_RADIUS) ** 2) * 0.92;
}

export function buildRoads(world: WorldData, h: Heights, sink: Sink, district: (x: number, z: number) => DistrictId): void {
  const ctx: Ctx = { world, h, sink, district };
  const { nodes, edges } = world.roads;
  const asphaltTone = (x: number, z: number, cls: RoadClass): [number, number, number] => {
    // Per-road tone variation (newer dark arterials, faded side streets) plus patchy
    // blotches every few tens of metres, so the 8 m texture never visibly repeats.
    const n = Math.sin(x * 0.013 + z * 0.007) * 0.5 + Math.sin(x * 0.0041 - z * 0.0093) * 0.5;
    const blotch = Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2) * Math.sin(z * 0.09 + Math.sin(x * 0.05) * 2);
    const base = cls === 'arterial' ? 0.9 : cls === 'avenue' ? 0.96 : 1.04;
    const v = base + n * 0.05 + blotch * 0.06;
    return [v, v, v * 1.01];
  };

  // Edge strips.
  for (let e = 0; e < edges.length; e++) {
    const E = edges[e];
    const a = nodes[E.a];
    const b = nodes[E.b];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.05) continue;
    const dx = (b.x - a.x) / len;
    const dz = (b.z - a.z) / len;
    const nx = -dz;
    const nz = dx;
    const hw = E.width / 2;
    const out = sink((a.x + b.x) / 2, (a.z + b.z) / 2, 'road');
    const segs = Math.max(1, Math.ceil(len / 6));
    const across = [-hw, 0, hw];
    const ids: number[][] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const cx = a.x + (b.x - a.x) * t;
      const cz = a.z + (b.z - a.z) * t;
      const row: number[] = [];
      for (const o of across) {
        const x = cx + nx * o;
        const z = cz + nz * o;
        const y = h.roadY(e, t, x, z);
        row.push(out.vertex(x, y, z, 0, 1, 0, x / 8, z / 8, asphaltTone(x, z, E.cls)));
      }
      ids.push(row);
    }
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < across.length - 1; j++) {
        const p = ids[i][j];
        const q = ids[i][j + 1];
        const r = ids[i + 1][j + 1];
        const s = ids[i + 1][j];
        if (!E.bridge && overWater(h, out, [p, q, r, s])) continue;
        out.quad(p, q, r, s);
      }
    }
  }

  // Node discs (joints and intersections).
  for (let n = 0; n < nodes.length; n++) {
    const N = nodes[n];
    if (N.edges.length === 0) continue;
    let hwMax = 0;
    let hwMin = Infinity;
    let bridge = true;
    let cls: RoadClass = 'street';
    for (const e of N.edges) {
      const E = edges[e];
      if (E.width / 2 > hwMax) {
        hwMax = E.width / 2;
        cls = E.cls;
      }
      hwMin = Math.min(hwMin, E.width / 2);
      if (!E.bridge) bridge = false;
    }
    const deg = N.edges.length;
    let radius = hwMax;
    if (deg >= 3) radius = Math.sqrt(hwMin ** 2 + (hwMax + CURB_RADIUS) ** 2);
    if (N.culDeSac) radius = Math.max(radius, 12);
    const out = sink(N.x, N.z, 'road');
    const sectors = deg >= 3 || N.culDeSac ? 24 : 12;
    const rings = deg >= 3 || N.culDeSac ? 3 : 1;
    const yAt = (x: number, z: number): number => (bridge ? h.nodeY[n] : Math.max(0.3, h.ground(x, z)));
    const centre = out.vertex(N.x, yAt(N.x, N.z), N.z, 0, 1, 0, N.x / 8, N.z / 8, asphaltTone(N.x, N.z, cls));
    const ringIds: number[][] = [];
    for (let r = 1; r <= rings; r++) {
      const rr = (radius * r) / rings;
      const row: number[] = [];
      for (let s = 0; s < sectors; s++) {
        const ang = (s / sectors) * Math.PI * 2;
        const x = N.x + Math.cos(ang) * rr;
        const z = N.z + Math.sin(ang) * rr;
        row.push(out.vertex(x, yAt(x, z), z, 0, 1, 0, x / 8, z / 8, asphaltTone(x, z, cls)));
      }
      ringIds.push(row);
    }
    for (let s = 0; s < sectors; s++) {
      const s2 = (s + 1) % sectors;
      // Winding: angles increase from +X toward +Z, so (centre, s2, s) faces up.
      if (bridge || !overWater(h, out, [centre, ringIds[0][s2], ringIds[0][s]])) out.tri(centre, ringIds[0][s2], ringIds[0][s]);
      for (let r = 1; r < rings; r++) {
        const quad = [ringIds[r - 1][s], ringIds[r - 1][s2], ringIds[r][s2], ringIds[r][s]];
        if (bridge || !overWater(h, out, quad)) out.quad(quad[0], quad[1], quad[2], quad[3]);
      }
    }
  }

  buildMarkings(ctx);
}

function overWater(h: Heights, out: MeshBuilder, ids: number[]): boolean {
  let x = 0;
  let z = 0;
  for (const i of ids) {
    x += out.positions[i * 3];
    z += out.positions[i * 3 + 2];
  }
  return h.shoreDist(x / ids.length, z / ids.length) < -1;
}

// ---------------------------------------------------------------------------------------
// Markings

interface Chain {
  nodes: number[];
  edges: number[];
}

function chains(world: WorldData): Chain[] {
  const { nodes, edges } = world.roads;
  const done = new Uint8Array(edges.length);
  const out: Chain[] = [];
  const walk = (start: number, first: number): Chain => {
    const c: Chain = { nodes: [start], edges: [] };
    let node = start;
    let edge = first;
    for (;;) {
      done[edge] = 1;
      c.edges.push(edge);
      const E = edges[edge];
      node = E.a === node ? E.b : E.a;
      c.nodes.push(node);
      const N = nodes[node];
      if (N.edges.length !== 2 || node === start) break;
      const next = N.edges[0] === edge ? N.edges[1] : N.edges[0];
      // Split chains where the road class or bridge state changes.
      if (edges[next].cls !== E.cls || edges[next].bridge !== E.bridge || done[next]) break;
      edge = next;
    }
    return c;
  };
  for (let n = 0; n < nodes.length; n++) {
    if (nodes[n].edges.length === 2) continue;
    for (const e of nodes[n].edges) if (!done[e]) out.push(walk(n, e));
  }
  for (let e = 0; e < edges.length; e++) if (!done[e]) out.push(walk(edges[e].a, e));
  return out;
}

interface LineSpec {
  offset: number;
  width: number;
  color: 'white' | 'yellow';
  dash?: [number, number];
}

function lineSpecs(cls: RoadClass, width: number, district: DistrictId): LineSpec[] {
  const hw = width / 2;
  const specs: LineSpec[] = [];
  const doubleYellow = (): void => {
    specs.push({ offset: -0.2, width: 0.12, color: 'yellow' }, { offset: 0.2, width: 0.12, color: 'yellow' });
  };
  if (cls === 'arterial') {
    doubleYellow();
    const lane = (hw - 1) / 3;
    for (const k of [1, 2]) {
      specs.push({ offset: 1 + lane * k, width: 0.12, color: 'white', dash: [3, 9] });
      specs.push({ offset: -(1 + lane * k), width: 0.12, color: 'white', dash: [3, 9] });
    }
    specs.push({ offset: hw - 0.35, width: 0.15, color: 'white' }, { offset: -(hw - 0.35), width: 0.15, color: 'white' });
  } else if (cls === 'avenue') {
    doubleYellow();
    const lane = (hw - 0.5) / 2;
    specs.push({ offset: 0.5 + lane, width: 0.12, color: 'white', dash: [3, 9] }, { offset: -(0.5 + lane), width: 0.12, color: 'white', dash: [3, 9] });
    specs.push({ offset: hw - 0.35, width: 0.15, color: 'white' }, { offset: -(hw - 0.35), width: 0.15, color: 'white' });
  } else if (cls === 'street') {
    if (district === 'downtown' || district === 'littleSolano' || district === 'harbor' || district === 'northside') {
      doubleYellow();
      // Parking lane lines.
      if (hw >= 5.4) specs.push({ offset: hw - 2.3, width: 0.1, color: 'white' }, { offset: -(hw - 2.3), width: 0.1, color: 'white' });
    } else if (district === 'beach') {
      specs.push({ offset: 0, width: 0.12, color: 'yellow', dash: [3, 6] });
    }
  }
  return specs;
}

function buildMarkings(ctx: Ctx): void {
  const { world, h } = ctx;
  const { nodes, edges } = world.roads;
  for (const c of chains(world)) {
    const E0 = edges[c.edges[0]];
    if (E0.cls === 'alley' || E0.cls === 'ramp') continue;
    // Polyline with per-point heights.
    const pts = c.nodes.map((n) => ({ x: nodes[n].x, z: nodes[n].z, y: E0.bridge ? h.nodeY[n] : NaN }));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const total = cum[cum.length - 1];
    const startClear = junctionRadius(world, c.nodes[0]) || (nodes[c.nodes[0]].edges.length === 1 ? 2 : 0);
    const endClear = junctionRadius(world, c.nodes[c.nodes.length - 1]) || (nodes[c.nodes[c.nodes.length - 1]].edges.length === 1 ? 2 : 0);
    if (total - startClear - endClear < 4) continue;
    const mid = pointAt(pts, cum, total / 2);
    const district = ctx.district(mid.x, mid.z);
    const specs = lineSpecs(E0.cls, E0.width, district);
    const heightAt = (p: { x: number; z: number; y: number }): number => (Number.isNaN(p.y) ? Math.max(0.3, h.ground(p.x, p.z)) : p.y);
    for (const spec of specs) {
      const out = ctx.sink(mid.x, mid.z, spec.color === 'white' ? 'paintWhite' : 'paintYellow');
      const ranges: [number, number][] = [];
      if (spec.dash) {
        const [on, off] = spec.dash;
        for (let d = startClear + 1; d + on <= total - endClear - 1; d += on + off) ranges.push([d, d + on]);
      } else ranges.push([startClear + 0.5, total - endClear - 0.5]);
      for (const [d0, d1] of ranges) stripe(out, pts, cum, d0, d1, spec.offset, spec.width, heightAt);
    }
    // Crosswalks and stop bars where the chain meets an urban intersection.
    const urban = district !== 'cypressEdge' && district !== 'islands' && district !== 'palmHeights';
    for (const end of [0, 1] as const) {
      const node = c.nodes[end === 0 ? 0 : c.nodes.length - 1];
      if (nodes[node].edges.length < 3 || !urban || E0.bridge) continue;
      const clear = end === 0 ? startClear : endClear;
      const hw = E0.width / 2;
      const out = ctx.sink(mid.x, mid.z, 'paintWhite');
      // Distance along the chain for the crosswalk band (3 m wide).
      const band0 = end === 0 ? clear - 3.4 : total - clear + 0.4;
      if (band0 < 0.2 || band0 + 3 > total - 0.2) continue;
      for (let o = -hw + 0.8; o <= hw - 0.8; o += 1.2) stripe(out, pts, cum, band0, band0 + 3, o + 0.3, 0.6, heightAt);
      // Stop bar across the approach lanes, just before the crosswalk.
      const stopD = end === 0 ? band0 + 3.6 : band0 - 0.6;
      const side = end === 0 ? -1 : 1; // approaching traffic drives on the right
      stripe(out, pts, cum, stopD, stopD + 0.45, (side * hw) / 2, hw - 0.5, heightAt);
    }
  }
}

function pointAt(pts: { x: number; z: number; y: number }[], cum: number[], d: number): { x: number; z: number; y: number; dx: number; dz: number } {
  let i = 1;
  while (i < pts.length - 1 && cum[i] < d) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const l = cum[i] - cum[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (d - cum[i - 1]) / l));
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    y: Number.isNaN(a.y) ? NaN : a.y + (b.y - a.y) * t,
    dx: (b.x - a.x) / l,
    dz: (b.z - a.z) / l,
  };
}

/** A painted stripe from distance d0 to d1 along the chain, offset sideways. */
function stripe(
  out: MeshBuilder,
  pts: { x: number; z: number; y: number }[],
  cum: number[],
  d0: number,
  d1: number,
  offset: number,
  width: number,
  heightAt: (p: { x: number; z: number; y: number }) => number,
): void {
  const steps = Math.max(1, Math.ceil((d1 - d0) / 8));
  let prevL = -1;
  let prevR = -1;
  for (let i = 0; i <= steps; i++) {
    const d = d0 + ((d1 - d0) * i) / steps;
    const p = pointAt(pts, cum, d);
    const nx = -p.dz;
    const nz = p.dx;
    const lx = p.x + nx * (offset - width / 2);
    const lz = p.z + nz * (offset - width / 2);
    const rx = p.x + nx * (offset + width / 2);
    const rz = p.z + nz * (offset + width / 2);
    const yl = heightAt({ x: lx, z: lz, y: p.y }) + 0.02;
    const yr = heightAt({ x: rx, z: rz, y: p.y }) + 0.02;
    const L = out.vertex(lx, yl, lz, 0, 1, 0, d, 0);
    const R = out.vertex(rx, yr, rz, 0, 1, 0, d, 1);
    if (prevL >= 0) out.quad(prevL, prevR, R, L);
    prevL = L;
    prevR = R;
  }
}
