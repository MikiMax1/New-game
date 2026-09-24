// Elevated highways (deck, parapets, median, piers, lane paint) and street bridges
// (deck slab, parapets, piers).
import { resamplePolyline } from '../geom';
import type { WorldData } from '../gen/world';
import type { P2 } from '../types';
import type { Heights } from './heights';
import type { MeshBuilder } from './meshData';
import { junctionRadius } from './roadMesh';

type Sink = (anchorX: number, anchorZ: number, bucket: string) => MeshBuilder;

/** Adds a box (centre, half extents, yaw) with outward normals. */
export function addBox(out: MeshBuilder, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number, uvScale = 0.5): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const P = (x: number, y: number, z: number): [number, number, number] => [cx + x * c - z * s, cy + y, cz + x * s + z * c];
  const faces: [number, number, number, [number, number, number][]][] = [
    [1, 0, 0, [[hx, -hy, -hz], [hx, -hy, hz], [hx, hy, hz], [hx, hy, -hz]]],
    [-1, 0, 0, [[-hx, -hy, hz], [-hx, -hy, -hz], [-hx, hy, -hz], [-hx, hy, hz]]],
    [0, 1, 0, [[-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz]]],
    [0, -1, 0, [[-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz], [-hx, -hy, -hz]]],
    [0, 0, 1, [[hx, -hy, hz], [-hx, -hy, hz], [-hx, hy, hz], [hx, hy, hz]]],
    [0, 0, -1, [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz]]],
  ];
  for (const [lx, ly, lz, corners] of faces) {
    const nx = lx * c - lz * s;
    const nz = lx * s + lz * c;
    const ids = corners.map(([x, y, z]) => {
      const p = P(x, y, z);
      // Planar UVs in metres on the dominant plane.
      const u = ly !== 0 ? p[0] : lx !== 0 ? p[2] : p[0];
      const v = ly !== 0 ? p[2] : p[1];
      return out.vertex(p[0], p[1], p[2], nx, ly, nz, u * uvScale, v * uvScale);
    });
    out.quad(ids[0], ids[3], ids[2], ids[1]);
  }
}

/** A vertical wall strip along a polyline, from yBottom to yTop, facing `side` (+1 left normal, -1 right). */
function wallStrip(out: MeshBuilder, pts: { x: number; z: number; y0: number; y1: number }[], nrm: P2[], side: 1 | -1): void {
  let pa = -1;
  let pb = -1;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const nx = nrm[i].x * side;
    const nz = nrm[i].z * side;
    const a = out.vertex(p.x, p.y0, p.z, nx, 0, nz, (p.x + p.z) * 0.5, p.y0 * 0.5);
    const b = out.vertex(p.x, p.y1, p.z, nx, 0, nz, (p.x + p.z) * 0.5, p.y1 * 0.5);
    if (pa >= 0) {
      if (side === 1) out.quad(pa, a, b, pb);
      else out.quad(a, pa, pb, b);
    }
    pa = a;
    pb = b;
  }
}

/** A horizontal strip between two offsets from a polyline at heights y (faces up or down). */
function flatStrip(out: MeshBuilder, pts: P2[], nrm: P2[], ys: number[], o0: number, o1: number, up: boolean, uvScale: number, dy = 0): void {
  let pa = -1;
  let pb = -1;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const ax = p.x + nrm[i].x * o0;
    const az = p.z + nrm[i].z * o0;
    const bx = p.x + nrm[i].x * o1;
    const bz = p.z + nrm[i].z * o1;
    const ny = up ? 1 : -1;
    const a = out.vertex(ax, ys[i] + dy, az, 0, ny, 0, ax * uvScale, az * uvScale);
    const b = out.vertex(bx, ys[i] + dy, bz, 0, ny, 0, bx * uvScale, bz * uvScale);
    if (pa >= 0) {
      // Left normal n = (-dz, dx): offsets increase to the left. Choose winding by facing.
      if (up) out.quad(pa, pb, b, a);
      else out.quad(pa, a, b, pb);
    }
    pa = a;
    pb = b;
  }
}

function normals(pts: P2[]): P2[] {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: -dz / l, z: dx / l };
  });
}

export function buildHighways(world: WorldData, h: Heights, sink: Sink): void {
  for (const hw of world.highways) {
    const pts = resamplePolyline(hw.line, 8);
    const nrm = normals(pts);
    // Smooth the ground profile so the deck doesn't follow every bump.
    const g = pts.map((p) => Math.max(0.3, h.ground(p.x, p.z)));
    const ys = g.map((_, i) => {
      let s = 0;
      let c = 0;
      for (let k = Math.max(0, i - 10); k <= Math.min(g.length - 1, i + 10); k++) {
        s += g[k];
        c++;
      }
      return Math.max(s / c, g[i] - 1) + hw.elevation;
    });
    const half = 15;
    // Process in pieces of ~96 m so each lands in a sensible render chunk.
    const PIECE = 12;
    for (let s0 = 0; s0 < pts.length - 1; s0 += PIECE) {
      const s1 = Math.min(pts.length - 1, s0 + PIECE);
      const P = pts.slice(s0, s1 + 1);
      const N = nrm.slice(s0, s1 + 1);
      const Y = ys.slice(s0, s1 + 1);
      const mid = P[Math.floor(P.length / 2)];
      const road = sink(mid.x, mid.z, 'road');
      const conc = sink(mid.x, mid.z, 'concrete');
      const white = sink(mid.x, mid.z, 'paintWhite');
      const yellow = sink(mid.x, mid.z, 'paintYellow');
      flatStrip(road, P, N, Y, -half + 0.5, half - 0.5, true, 1 / 8);
      // Parapets (outer), median barrier, deck slab.
      for (const side of [1, -1] as const) {
        const edgeOuter = P.map((p, i) => ({ x: p.x + N[i].x * half * side, z: p.z + N[i].z * half * side }));
        const edgeInner = P.map((p, i) => ({ x: p.x + N[i].x * (half - 0.5) * side, z: p.z + N[i].z * (half - 0.5) * side }));
        wallStrip(conc, edgeOuter.map((p, i) => ({ ...p, y0: Y[i] - 1.9, y1: Y[i] + 1.05 })), N, side);
        wallStrip(conc, edgeInner.map((p, i) => ({ ...p, y0: Y[i], y1: Y[i] + 1.05 })), N, (side * -1) as 1 | -1);
        flatStrip(conc, P, N, Y, side === 1 ? half - 0.5 : -half, side === 1 ? half : -half + 0.5, true, 0.5, 1.05);
        // Lane paint: edge line and two dashed lane lines per direction.
        flatPaint(white, P, N, Y, side * (half - 1.2), 0.15, null);
        flatPaint(yellow, P, N, Y, side * 1.3, 0.15, null);
        for (const k of [1, 2]) flatPaint(white, P, N, Y, side * (1.6 + 3.65 * k), 0.13, [3, 9], s0 * 8);
      }
      flatStrip(conc, P, N, Y, -half, half, false, 0.5, -1.9);
      wallStrip(conc, P.map((p, i) => ({ x: p.x + N[i].x * 0.3, z: p.z + N[i].z * 0.3, y0: Y[i], y1: Y[i] + 0.9 })), N, 1);
      wallStrip(conc, P.map((p, i) => ({ x: p.x - N[i].x * 0.3, z: p.z - N[i].z * 0.3, y0: Y[i], y1: Y[i] + 0.9 })), N, -1);
      flatStrip(conc, P, N, Y, -0.3, 0.3, true, 0.5, 0.9);
    }
    // Piers every 40 m: a column pair and a cap beam.
    for (let i = 2; i < pts.length - 2; i += 5) {
      const p = pts[i];
      const yaw = Math.atan2(nrm[i].z, nrm[i].x);
      const top = ys[i] - 1.9;
      const base = Math.min(h.ground(p.x, p.z), 0) - 0.5;
      const out = sink(p.x, p.z, 'concrete');
      addBox(out, p.x, top - 0.8, p.z, 11, 0.8, 1.3, yaw);
      for (const o of [-6, 6]) {
        const x = p.x + nrm[i].x * o;
        const z = p.z + nrm[i].z * o;
        const b = Math.min(h.ground(x, z), base) - 0.2;
        addBox(out, x, (b + top - 1.6) / 2, z, 1.1, (top - 1.6 - b) / 2, 1.1, yaw);
      }
    }
  }
}

function flatPaint(out: MeshBuilder, P: P2[], N: P2[], Y: number[], offset: number, width: number, dash: [number, number] | null, d0 = 0): void {
  if (!dash) {
    flatStrip(out, P, N, Y, offset - width / 2, offset + width / 2, true, 1, 0.03);
    return;
  }
  // Dashes: emit short strips where (distance mod period) < on.
  const [on, off] = dash;
  let d = d0;
  for (let i = 0; i + 1 < P.length; i++) {
    const seg = Math.hypot(P[i + 1].x - P[i].x, P[i + 1].z - P[i].z);
    const phase = d % (on + off);
    if (phase < on) {
      const a = P[i];
      const t = Math.min(1, (on - phase) / seg);
      const b = { x: a.x + (P[i + 1].x - a.x) * t, z: a.z + (P[i + 1].z - a.z) * t };
      flatStrip(out, [a, b], [N[i], N[i]], [Y[i], Y[i] + (Y[i + 1] - Y[i]) * t], offset - width / 2, offset + width / 2, true, 1, 0.03);
    }
    d += seg;
  }
}

export function buildBridges(world: WorldData, h: Heights, sink: Sink): void {
  const { nodes, edges } = world.roads;
  let pierAcc = 0;
  for (let e = 0; e < edges.length; e++) {
    const E = edges[e];
    if (!E.bridge) continue;
    const a = nodes[E.a];
    const b = nodes[E.b];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.1) continue;
    const pts = [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
    const nrm = normals(pts);
    const ys = [h.nodeY[E.a], h.nodeY[E.b]];
    const hw = E.width / 2;
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const conc = sink(mid.x, mid.z, 'concrete');
    // Slab underside and fascia.
    flatStrip(conc, pts, nrm, ys, -hw - 0.4, hw + 0.4, false, 0.5, -1.1);
    for (const side of [1, -1] as const) {
      const edge = pts.map((p, i) => ({ x: p.x + nrm[i].x * (hw + 0.4) * side, z: p.z + nrm[i].z * (hw + 0.4) * side }));
      wallStrip(conc, edge.map((p, i) => ({ ...p, y0: ys[i] - 1.1, y1: ys[i] + 0.95 })), nrm, side);
      // Parapet, skipped near junctions so side roads can join.
      const ra = junctionRadius(world, E.a);
      const rb = junctionRadius(world, E.b);
      if (ra + rb < len - 1) {
        const t0 = ra / len;
        const t1 = 1 - rb / len;
        const pp = [0, 1].map((k) => {
          const t = k === 0 ? t0 : t1;
          return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: ys[0] + (ys[1] - ys[0]) * t };
        });
        const inner = pp.map((p) => ({ x: p.x + nrm[0].x * (hw + 0.05) * side, z: p.z + nrm[0].z * (hw + 0.05) * side, y0: p.y, y1: p.y + 0.95 }));
        wallStrip(conc, inner, [nrm[0], nrm[0]], (side * -1) as 1 | -1);
        flatStrip(conc, pp.map((p) => ({ x: p.x, z: p.z })), [nrm[0], nrm[0]], pp.map((p) => p.y), side === 1 ? hw + 0.05 : -hw - 0.4, side === 1 ? hw + 0.4 : -hw - 0.05, true, 0.5, 0.95);
      }
    }
    // Piers roughly every 32 m along bridges.
    pierAcc += len;
    if (pierAcc >= 32) {
      pierAcc = 0;
      const yaw = Math.atan2(nrm[0].z, nrm[0].x);
      const top = (ys[0] + ys[1]) / 2 - 1.1;
      const offsets = hw > 7 ? [-hw * 0.55, hw * 0.55] : [0];
      for (const o of offsets) {
        const x = mid.x + nrm[0].x * o;
        const z = mid.z + nrm[0].z * o;
        const base = Math.min(h.ground(x, z), -0.5) - 0.5;
        if (top - base < 0.5) continue;
        addBox(conc, x, (top + base) / 2, z, 0.9, (top - base) / 2, 0.9, yaw);
      }
    }
  }
}
