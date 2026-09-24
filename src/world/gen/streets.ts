// Street network of Port Solmar: a Miami-style grid on the mainland (arterials every
// 800 m, avenues between, local streets by district), a long-avenue grid on the barrier
// island, island loops, causeways, the bayfront drive and the diagonal Dixie Highway.
import type { NoiseFunction2D } from 'simplex-noise';
import { DISTRICTS } from '../authored/districts';
import { AUTHORED_ROADS, BAY_ISLANDS, CAUSEWAY_LANDINGS_Z, LANDMARKS, LATTICE, MAINLAND_SHORE, PORT_ISLAND } from '../authored/layout';
import { offset } from '../clip';
import { MAP_HALF } from '../config';
import { asOuter, catmullRom, chaikin, dist, ellipseRing, resamplePolyline } from '../geom';
import { makeNoise } from '../noise';
import { Rng } from '../rng';
import type { DistrictId, P2, RoadClass } from '../types';
import { beachShoresAt, type LandModel } from './land';
import { RoadGraph, type RoadProps } from './roadGraph';
import type { TerrainResult } from './terrain';

export const ROAD_WIDTH: Record<RoadClass, number> = {
  highway: 30,
  arterial: 22,
  avenue: 15,
  street: 11,
  alley: 5,
  ramp: 8,
};

export function roadProps(cls: RoadClass, name: string, district?: DistrictId): RoadProps {
  let width = ROAD_WIDTH[cls];
  if (cls === 'street' && district) width = DISTRICTS[district].streetWidth;
  const lanes = cls === 'arterial' ? 3 : cls === 'avenue' ? 2 : 1;
  return { cls, width, lanes, name };
}

const ARTERIAL_NAMES_Z: Record<number, string> = {
  [-1930]: 'Northgate Boulevard', [-1130]: 'Tuttle Boulevard', [-330]: 'Flamingo Boulevard',
  470: 'Coral Way', 1270: 'Sunset Drive',
};
const ARTERIAL_NAMES_X: Record<number, string> = { [-1650]: 'Everglade Avenue', [-850]: 'Solano Avenue', [-50]: 'Miramar Avenue' };
const AVENUE_NAMES_Z: Record<number, string> = {
  [-1530]: 'Heron Street', [-730]: 'Mangrove Street', 70: 'Flagler Street', 870: 'Granada Street', 1670: 'Kingfisher Street',
};
const AVENUE_NAMES_X: Record<number, string> = { [-1250]: 'Poinciana Avenue', [-450]: 'Tamarind Avenue' };

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

/** Miami-style numbered street names from grid position. */
function numberedName(x: number, z: number, northSouth: boolean): string {
  const ns = z < 0 ? 'N' : 'S';
  const ew = x < 0 ? 'W' : 'E';
  if (northSouth) return `${ns}${ew} ${ordinal(Math.max(1, Math.round((420 - x) / 100)))} Avenue`;
  return `${ns}${ew} ${ordinal(Math.max(1, Math.round(Math.abs(z) / 80)))} Street`;
}

interface Ctx {
  graph: RoadGraph;
  model: LandModel;
  terrain: TerrainResult;
  rng: Rng;
  warpA: NoiseFunction2D;
  warpB: NoiseFunction2D;
  curvyA: NoiseFunction2D;
  curvyB: NoiseFunction2D;
}

export interface StreetsResult {
  graph: RoadGraph;
  /** Node ids that are cul-de-sac ends (turnaround bulbs). */
  culDeSacs: number[];
}

export function buildStreets(model: LandModel, terrain: TerrainResult): StreetsResult {
  const ctx: Ctx = {
    graph: new RoadGraph(),
    model,
    terrain,
    rng: new Rng(model.seed).fork('streets'),
    warpA: makeNoise(model.seed * 17 + 1),
    warpB: makeNoise(model.seed * 17 + 2),
    curvyA: makeNoise(model.seed * 17 + 3),
    curvyB: makeNoise(model.seed * 17 + 4),
  };

  addLatticeMainRoads(ctx);
  addLocalStreets(ctx);
  addBeachIsland(ctx);
  addPort(ctx);
  addIslands(ctx);
  addAuthoredRoads(ctx);
  addBayshoreDrive(ctx);
  const culDeSacs = addCulDeSacs(ctx);

  const g = ctx.graph;
  g.pruneDeadEnds(42, (e) => culDeSacs.includes(g.edges[e].a) || culDeSacs.includes(g.edges[e].b));
  // Drop small disconnected fragments (cut off by water); keep the island loops that
  // connect through bridges, which are part of the main component anyway.
  const comps = g.components();
  for (let c = 1; c < comps.length; c++) {
    let len = 0;
    const edges = new Set<number>();
    for (const n of comps[c]) for (const e of g.nodes[n].edges) edges.add(e);
    for (const e of edges) len += g.edgeLength(e) / 1;
    if (len < 600) for (const e of edges) g.removeEdge(e);
  }
  markBridges(ctx);
  return { graph: g, culDeSacs: culDeSacs.filter((n) => g.nodes[n].alive && g.degree(n) === 1) };
}

// ---------------------------------------------------------------------------------------

function warp(ctx: Ctx, p: P2): P2 {
  const s = 1 / 1300;
  return { x: p.x + 16 * ctx.warpA(p.x * s, p.z * s), z: p.z + 16 * ctx.warpB(p.x * s, p.z * s) };
}

function shoreDist(ctx: Ctx, p: P2): number {
  return ctx.terrain.grid.sample(ctx.terrain.shoreDist, p.x, p.z);
}

function inMap(p: P2, margin = -1): boolean {
  return Math.abs(p.x) <= MAP_HALF + margin && Math.abs(p.z) <= MAP_HALF + margin;
}

/**
 * Splits a sampled line into drivable runs: on land with clearance, optionally bridging
 * short water gaps. `allowed(p)` can veto samples (districts, reserves).
 */
function drivableRuns(ctx: Ctx, pts: P2[], clearance: number, maxBridge: number, allowed?: (p: P2) => boolean): P2[][] {
  const ok = pts.map((p) => inMap(p) && shoreDist(ctx, p) > clearance && (!allowed || allowed(p)));
  // Bridge short gaps (water, or land too close to water) that have road on both sides.
  if (maxBridge > 0) {
    let i = 0;
    while (i < pts.length) {
      if (ok[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < pts.length && !ok[j]) j++;
      if (i > 0 && j < pts.length) {
        const gap = dist(pts[i - 1], pts[j]);
        const allAllowed = !allowed || pts.slice(i, j).every((p) => allowed(p) || shoreDist(ctx, p) < 0);
        if (gap <= maxBridge && allAllowed) for (let k = i; k < j; k++) ok[k] = true;
      }
      i = j;
    }
  }
  const runs: P2[][] = [];
  let cur: P2[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (ok[i]) cur.push(pts[i]);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length >= 2);
}

function insertRuns(ctx: Ctx, runs: P2[][], props: RoadProps, minLength: number): void {
  for (const r of runs) {
    let len = 0;
    for (let i = 1; i < r.length; i++) len += dist(r[i - 1], r[i]);
    if (len >= minLength) ctx.graph.insertPolyline(r, props);
  }
}

function lineZ(z: number, x0: number, x1: number, step: number): P2[] {
  const out: P2[] = [];
  const n = Math.max(1, Math.round((x1 - x0) / step));
  for (let i = 0; i <= n; i++) out.push({ x: x0 + ((x1 - x0) * i) / n, z });
  return out;
}

function lineX(x: number, z0: number, z1: number, step: number): P2[] {
  const out: P2[] = [];
  const n = Math.max(1, Math.round((z1 - z0) / step));
  for (let i = 0; i <= n; i++) out.push({ x, z: z0 + ((z1 - z0) * i) / n });
  return out;
}

function mainlandOnly(ctx: Ctx, rural: boolean) {
  return (p: P2): boolean => {
    const lm = ctx.model.landmassAt(p.x, p.z);
    if (lm !== 'mainland' && lm !== 'water') return false;
    return rural || ctx.model.districtAt(p.x, p.z) !== 'cypressEdge';
  };
}

function addLatticeMainRoads(ctx: Ctx): void {
  const E = MAP_HALF + 40;
  const W = -MAP_HALF - 40;
  for (const z of LATTICE.arterialZ) {
    const rural = LATTICE.ruralZ.includes(z);
    const pts = lineZ(z, W, 700, 25).map((p) => warp(ctx, p));
    insertRuns(ctx, drivableRuns(ctx, pts, 16, 260, mainlandOnly(ctx, rural)), roadProps('arterial', ARTERIAL_NAMES_Z[z] ?? 'Boulevard'), 80);
  }
  for (const x of LATTICE.arterialX) {
    const pts = lineX(x, W, E, 25).map((p) => warp(ctx, p));
    insertRuns(ctx, drivableRuns(ctx, pts, 16, 260, mainlandOnly(ctx, false)), roadProps('arterial', ARTERIAL_NAMES_X[x] ?? 'Avenue'), 80);
  }
  for (const z of LATTICE.avenueZ) {
    const pts = lineZ(z, W, 700, 25).map((p) => warp(ctx, p));
    insertRuns(ctx, drivableRuns(ctx, pts, 12, 140, mainlandOnly(ctx, false)), roadProps('avenue', AVENUE_NAMES_Z[z] ?? 'Street'), 80);
  }
  for (const x of LATTICE.avenueX) {
    const pts = lineX(x, W, E, 25).map((p) => warp(ctx, p));
    insertRuns(ctx, drivableRuns(ctx, pts, 12, 140, mainlandOnly(ctx, false)), roadProps('avenue', AVENUE_NAMES_X[x] ?? 'Avenue'), 80);
  }
}

function inReserve(p: P2, margin: number): boolean {
  for (const l of LANDMARKS) {
    if (!l.reserve) continue;
    if (Math.abs(p.x - l.at.x) < l.reserve.halfX + margin && Math.abs(p.z - l.at.z) < l.reserve.halfZ + margin) return true;
  }
  return false;
}

function dominantDistrict(ctx: Ctx, u0: number, u1: number, v0: number, v1: number): DistrictId | null {
  const counts = new Map<DistrictId, number>();
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const x = u0 + ((u1 - u0) * (i + 0.5)) / 5;
      const z = v0 + ((v1 - v0) * (j + 0.5)) / 5;
      if (ctx.model.landmassAt(x, z) !== 'mainland' || shoreDist(ctx, { x, z }) < 0) continue;
      const d = ctx.model.districtAt(x, z);
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  let best: DistrictId | null = null;
  let bestC = 0;
  for (const [d, c] of counts) if (c > bestC) [best, bestC] = [d, c];
  return best;
}

/** Positions of internal lines inside [a, b] at roughly `spacing`. Open sides use fixed spacing. */
function internalLines(a: number, b: number, spacing: number, openLow: boolean, openHigh: boolean): number[] {
  if (spacing <= 0) return [];
  const out: number[] = [];
  if (openHigh && !openLow) {
    for (let p = a + spacing; p < b - 25; p += spacing) out.push(p);
  } else if (openLow && !openHigh) {
    for (let p = b - spacing; p > a + 25; p -= spacing) out.push(p);
  } else {
    const count = Math.max(0, Math.round((b - a) / spacing) - 1);
    for (let k = 1; k <= count; k++) out.push(a + ((b - a) * k) / (count + 1));
  }
  return out;
}

function addLocalStreets(ctx: Ctx): void {
  const us = [-MAP_HALF - 40, ...LATTICE.arterialX, ...LATTICE.avenueX, 700].sort((p, q) => p - q);
  const vs = [-MAP_HALF - 40, ...LATTICE.arterialZ, ...LATTICE.avenueZ, MAP_HALF + 40].sort((p, q) => p - q);
  for (let iu = 0; iu + 1 < us.length; iu++) {
    for (let iv = 0; iv + 1 < vs.length; iv++) {
      const u0 = us[iu];
      const u1 = us[iu + 1];
      const v0 = vs[iv];
      const v1 = vs[iv + 1];
      const district = dominantDistrict(ctx, u0, u1, v0, v1);
      if (!district) continue;
      const spec = DISTRICTS[district];
      const rng = ctx.rng.fork(iu * 100 + iv);
      let sx = spec.streetSpacingX;
      let sz = spec.streetSpacingZ;
      // Occasional variation: a superblock with bigger blocks (school, mall, factory).
      if (rng.chance(district === 'northside' ? 0.15 : 0.06)) sz = sz * 2;
      if (district === 'downtown' && rng.chance(0.3)) sx = 130;
      const openLowU = iu === 0;
      const openHighU = iu + 1 === us.length - 1;
      const openLowV = iv === 0;
      const openHighV = iv + 1 === vs.length - 1;
      const xLines = internalLines(u0, u1, sx, openLowU, openHighU);
      const zLines = internalLines(v0, v1, sz, openLowV, openHighV);
      const cellWarp = (p: P2): P2 => {
        let q = p;
        if (spec.curvy > 0) {
          const bu = Math.sin((Math.PI * (p.x - u0)) / (u1 - u0));
          const bv = Math.sin((Math.PI * (p.z - v0)) / (v1 - v0));
          const bump = Math.max(0, bu) * Math.max(0, bv);
          const s = 1 / 420;
          q = {
            x: p.x + spec.curvy * bump * ctx.curvyA(p.x * s, p.z * s),
            z: p.z + spec.curvy * bump * ctx.curvyB(p.x * s, p.z * s),
          };
        }
        return warp(ctx, q);
      };
      const allowed = (p: P2): boolean =>
        !inReserve(p, 8) &&
        ctx.model.landmassAt(p.x, p.z) === 'mainland' &&
        DISTRICTS[ctx.model.districtAt(p.x, p.z)].streetSpacingZ > 0;
      const clearance = spec.streetWidth / 2 + 5;
      for (const x of xLines) {
        const pts = lineX(x, Math.max(v0, -MAP_HALF - 20), Math.min(v1, MAP_HALF + 20), 20).map(cellWarp);
        insertRuns(ctx, drivableRuns(ctx, pts, clearance, 0, allowed), roadProps('street', numberedName(x, (v0 + v1) / 2, true), district), 30);
      }
      for (const z of zLines) {
        const pts = lineZ(z, Math.max(u0, -MAP_HALF - 20), Math.min(u1, MAP_HALF + 20), 20).map(cellWarp);
        insertRuns(ctx, drivableRuns(ctx, pts, clearance, 0, allowed), roadProps('street', numberedName((u0 + u1) / 2, z, false), district), 30);
      }
    }
  }
}

function addBeachIsland(ctx: Ctx): void {
  const zs: number[] = [];
  for (let z = -MAP_HALF - 40; z <= 1600; z += 20) zs.push(z);
  const onIsland = (p: P2): boolean => ctx.model.landmassAt(p.x, p.z) === 'beach';
  const collins = zs.filter((z) => z <= 1540).map((z) => ({ x: beachShoresAt(z).east - 175, z }));
  const alton = zs.filter((z) => z <= 1480).map((z) => ({ x: beachShoresAt(z).west + 80, z }));
  const ocean = zs.filter((z) => z >= 640 && z <= 1545).map((z) => ({ x: beachShoresAt(z).east - 96, z }));
  insertRuns(ctx, drivableRuns(ctx, collins, 14, 0, onIsland), roadProps('arterial', 'Coquina Avenue'), 80);
  insertRuns(ctx, drivableRuns(ctx, alton, 10, 0, onIsland), roadProps('avenue', 'Laguna Road'), 80);
  insertRuns(ctx, drivableRuns(ctx, ocean, 8, 0, onIsland), roadProps('street', 'Ocean Drive', 'beach'), 80);
  // Washington-style middle street where the island is wide enough.
  const mid = zs
    .filter((z) => z <= 1450)
    .map((z) => {
      const s = beachShoresAt(z);
      return { x: (s.west + 80 + s.east - 175) / 2, z, wide: s.east - 175 - (s.west + 80) > 150 };
    });
  let run: P2[] = [];
  const runs: P2[][] = [];
  for (const m of mid) {
    if (m.wide) run.push({ x: m.x, z: m.z });
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  for (const r of runs) insertRuns(ctx, drivableRuns(ctx, r, 8, 0, onIsland), roadProps('street', 'Palmetto Avenue', 'beach'), 150);

  // Cross streets every ~88 m from the bay road to the ocean-side road.
  for (let z = 1500; z > -MAP_HALF - 20; z -= 88) {
    if (CAUSEWAY_LANDINGS_Z.some((c) => Math.abs(c - z) < 50)) continue;
    const s = beachShoresAt(z);
    const x0 = s.west + 80;
    const x1 = z >= 660 && z <= 1540 ? s.east - 96 : s.east - 175;
    const pts = lineZ(z, x0, x1, 20);
    const name = z >= 0 ? `${ordinal(Math.max(1, Math.round((1560 - z) / 88)))} Street` : `${ordinal(20 + Math.round(-z / 88))} Street`;
    insertRuns(ctx, drivableRuns(ctx, pts, 7, 0, onIsland), roadProps('street', name, 'beach'), 60);
  }
  // South Pointe Drive around the tip.
  const sp = [{ x: beachShoresAt(1480).west + 80, z: 1480 }, { x: 1250, z: 1560 }, { x: beachShoresAt(1545).east - 96, z: 1545 }];
  insertRuns(ctx, drivableRuns(ctx, catmullRom(sp, 15), 7, 0, onIsland), roadProps('street', 'South Pointe Drive', 'beach'), 60);
}

function addPort(ctx: Ctx): void {
  const inset = offset([{ outer: asOuter(PORT_ISLAND), holes: [] }], -26, 'round');
  for (const p of inset) {
    const ring = resamplePolyline([...p.outer, p.outer[0]], 20);
    ctx.graph.insertPolyline(ring, roadProps('avenue', 'Port Loop'));
  }
  ctx.graph.insertPolyline(resamplePolyline([{ x: 640, z: 42 }, { x: 1004, z: 38 }], 20), roadProps('street', 'Terminal Way', 'harbor'));
  ctx.graph.insertPolyline(resamplePolyline([{ x: 830, z: -80 }, { x: 830, z: 160 }], 20), roadProps('street', 'Crane Street', 'harbor'));
}

function addIslands(ctx: Ctx): void {
  for (const isl of BAY_ISLANDS) {
    if (isl.rz < 40 || isl.rx < 100 || isl.name === 'Coral Key') continue;
    // Ring road ~34 m in from the shore: estates on the waterfront outside it, more inside.
    const loop = offset([{ outer: ellipseRing(isl.cx, isl.cz, isl.rx, isl.rz, isl.rot, 48), holes: [] }], -34, 'round');
    for (const p of loop) {
      ctx.graph.insertPolyline(resamplePolyline([...p.outer, p.outer[0]], 15), roadProps('street', `${isl.name} Drive`, 'islands'));
    }
  }
}

function addAuthoredRoads(ctx: Ctx): void {
  const g = ctx.graph;
  for (const r of AUTHORED_ROADS) {
    const points = r.points.slice();
    if (r.attach === 'deadEnd') {
      // Join the grid at the dead end nearest the first point (a boulevard ending at the shore).
      let best = -1;
      let bestD = 80;
      for (const n of g.nodesNear(points[0].x, points[0].z, 80)) {
        if (g.degree(n) !== 1) continue;
        const d = Math.hypot(g.nodes[n].x - points[0].x, g.nodes[n].z - points[0].z);
        if (d < bestD) [best, bestD] = [n, d];
      }
      if (best >= 0) points[0] = { x: g.nodes[best].x, z: g.nodes[best].z };
    } else if (r.attach === 'edge') {
      const ne = g.nearestEdge(points[0].x, points[0].z, 40);
      if (ne) {
        const E = g.edges[ne.edge];
        const a = g.nodes[E.a];
        const b = g.nodes[E.b];
        points[0] = { x: a.x + (b.x - a.x) * ne.t, z: a.z + (b.z - a.z) * ne.t };
      }
    }
    const pts = r.smooth ? catmullRom(points, 20) : resamplePolyline(points, 20);
    const props = roadProps(r.cls, r.name);
    const inside = pts.filter((p) => inMap(p));
    if (r.name === 'Dixie Highway') {
      // Crosses land; only short water gaps are bridged.
      insertRuns(ctx, drivableRuns(ctx, inside, 10, 200), props, 80);
    } else {
      // Causeways cross open water.
      g.insertPolyline(inside, props);
    }
    // Short bridges from the main causeway to the islands beside it. Each overshoots
    // both the island loop and the causeway so it forms real intersections.
    if (r.name === 'Solmar Causeway') {
      for (const name of ['Palm Isle', 'Star Isle', 'Hibiscus Isle']) {
        const isl = BAY_ISLANDS.find((b) => b.name === name)!;
        const causewayZ = -345 - (isl.cx - 700) * 0.03;
        const side = isl.cz > causewayZ ? 1 : -1;
        const inside0 = isl.cz - side * (isl.rz - 46);
        const beyond = causewayZ - side * 12;
        g.insertPolyline(resamplePolyline([{ x: isl.cx, z: inside0 }, { x: isl.cx, z: beyond }], 10), roadProps('street', `${name} Bridge`, 'islands'));
      }
    }
  }
}

function addBayshoreDrive(ctx: Ctx): void {
  // Follows the mainland shore ~70 m inland, like a bayfront boulevard.
  const shore = catmullRom(MAINLAND_SHORE.filter((p) => p.z > -2100 && p.z < 2100), 25);
  const off: P2[] = [];
  for (let i = 0; i < shore.length; i++) {
    const a = shore[Math.max(0, i - 2)];
    const b = shore[Math.min(shore.length - 1, i + 2)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    off.push({ x: shore[i].x - (dz / l) * 72, z: shore[i].z + (dx / l) * 72 });
  }
  const smooth = resamplePolyline(chaikin(off, 3, false), 20);
  insertRuns(ctx, drivableRuns(ctx, smooth, 12, 220, mainlandOnly(ctx, false)), roadProps('avenue', 'Bayshore Drive'), 100);
}

/** Palm Heights style: close off some local streets into cul-de-sacs. */
function addCulDeSacs(ctx: Ctx): number[] {
  const g = ctx.graph;
  const rng = ctx.rng.fork('culdesac');
  const ends: number[] = [];
  const visited = new Set<number>();
  for (let n = 0; n < g.nodes.length; n++) {
    const N = g.nodes[n];
    if (!N.alive || g.degree(n) < 3) continue;
    for (const e of N.edges.slice()) {
      if (visited.has(e) || !g.edges[e].alive || g.edges[e].props.cls !== 'street') continue;
      const chain = g.walkChain(n, e);
      for (const ce of chain.edges) visited.add(ce);
      if (g.degree(chain.end) < 3) continue;
      const district = ctx.model.districtAt(N.x, N.z);
      const spec = DISTRICTS[district];
      if (spec.culDeSac <= 0 || !rng.chance(spec.culDeSac)) continue;
      if (chain.length < 150) continue;
      // Remove the middle of the chain, leaving two stubs of ~40-45% length.
      const keepLen = chain.length * rng.range(0.36, 0.44);
      let acc = 0;
      const middle: number[] = [];
      let firstStubEnd = -1;
      let node = n;
      for (const ce of chain.edges) {
        const next = g.other(ce, node);
        const l = g.edgeLength(ce);
        if (acc >= keepLen && acc + l <= chain.length - keepLen) middle.push(ce);
        else if (acc < keepLen && acc + l >= keepLen && firstStubEnd < 0) firstStubEnd = next;
        acc += l;
        node = next;
      }
      if (middle.length === 0) continue;
      const removed = new Set(middle);
      if (!g.connectedWithout(n, chain.end, removed)) continue;
      const touched = new Set<number>();
      for (const me of middle) {
        touched.add(g.edges[me].a);
        touched.add(g.edges[me].b);
        g.removeEdge(me);
      }
      for (const t of touched) if (g.nodes[t].alive && g.degree(t) === 1) ends.push(t);
    }
  }
  return ends;
}

function markBridges(ctx: Ctx): void {
  const g = ctx.graph;
  for (const e of g.liveEdges()) {
    const E = g.edges[e];
    const a = g.nodes[E.a];
    const b = g.nodes[E.b];
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const wet = shoreDist(ctx, mid) < 1 || shoreDist(ctx, a) < -2 || shoreDist(ctx, b) < -2;
    if (wet) E.props = { ...E.props, bridge: true };
  }
}
