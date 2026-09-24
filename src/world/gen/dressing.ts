// Street dressing and vegetation placement (pure data). Decides where every street
// light, traffic signal, stop sign, hydrant, bus shelter, utility pole, tree, palm and
// beach item goes, following how Miami-like streets are actually furnished.
import { DISTRICTS } from '../authored/districts';
import type { DistrictId } from '../types';
import { pointInRing } from '../geom';
import { makeNoise } from '../noise';
import { Rng, hash01 } from '../rng';
import type { Block } from './blocks';
import { LandModel } from './land';
import type { WorldData } from './world';

export const PROP_KINDS = [
  'palmRoyal', 'palmCoconut', 'palmSabal', 'liveOak', 'shrub', 'hedge', 'grassClump',
  'streetLightCobra', 'streetLightDeco', 'trafficSignalMast', 'pedSignal', 'stopSign', 'streetNameSign',
  'fireHydrant', 'bench', 'trashCan', 'busShelter', 'newspaperBox', 'parkingMeter', 'utilityPole',
  'lifeguardTower', 'beachUmbrella', 'lounger', 'bollard', 'acUnit', 'dumpster',
] as const;
export type PropKind = (typeof PROP_KINDS)[number];

/** Struct-of-arrays so it can be transferred between threads cheaply. */
export interface Dressing {
  count: number;
  kind: Uint8Array;
  /** x, y, z per instance. */
  pos: Float32Array;
  /**
   * Rotation about +Y (radians, three.js convention) that turns the model's forward
   * (-Z) to face the intended direction: roads for lights and signal arms, oncoming
   * traffic for signs, the ocean for lifeguard towers.
   */
  yaw: Float32Array;
  scale: Float32Array;
  variant: Uint8Array;
  /** Extra per-instance parameter (e.g. signal arm length in metres). */
  param: Float32Array;
  /** 1 for road nodes controlled by traffic signals (shared with the traffic sim). */
  signalNodes: Uint8Array;
}

interface Placed {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  variant: number;
  param: number;
}

/** Yaw that turns the model's -Z forward axis to point along (fx, fz). */
export function yawFacing(fx: number, fz: number): number {
  return Math.atan2(-fx, -fz);
}

const CURB = 0.15;

export function buildDressing(world: WorldData): Dressing {
  const out: Placed[] = [];
  const rng = new Rng(world.seed).fork('dressing');
  const noise = makeNoise(world.seed * 29 + 11);
  const model = new LandModel(world.seed);
  const t = world.terrain;
  const sample = (f: Float32Array, x: number, z: number): number => {
    const fx = Math.max(0, Math.min(t.n - 1.001, (x - t.origin) / t.res));
    const fz = Math.max(0, Math.min(t.n - 1.001, (z - t.origin) / t.res));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * t.n + i;
    return (f[k] * (1 - u) + f[k + 1] * u) * (1 - v) + (f[k + t.n] * (1 - u) + f[k + t.n + 1] * u) * v;
  };
  const ground = (x: number, z: number): number => Math.max(0.3, sample(t.height, x, z));
  const shore = (x: number, z: number): number => sample(t.shoreDist, x, z);

  // Spatial index of paved blocks, to know whether a point is on a sidewalk.
  const cell = 96;
  const blockGrid = new Map<string, Block[]>();
  for (const b of world.blocks) {
    if (b.use === 'beach' || b.use === 'wild') continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of b.poly.outer) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++)
      for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
        const key = `${i},${j}`;
        let list = blockGrid.get(key);
        if (!list) blockGrid.set(key, (list = []));
        list.push(b);
      }
  }
  const blockAt = (x: number, z: number): Block | null => {
    for (const b of blockGrid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []) {
      if (pointInRing(x, z, b.poly.outer) && !b.poly.holes.some((hh) => pointInRing(x, z, hh))) return b;
    }
    return null;
  };

  // Keep objects from piling up on each other.
  const occupied = new Map<string, { x: number; z: number; r: number }[]>();
  const free = (x: number, z: number, r: number): boolean => {
    const ci = Math.floor(x / 8);
    const cj = Math.floor(z / 8);
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++)
        for (const o of occupied.get(`${i},${j}`) ?? []) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false;
    return true;
  };
  const place = (p: Placed, r: number): boolean => {
    if (!free(p.x, p.z, r)) return false;
    const key = `${Math.floor(p.x / 8)},${Math.floor(p.z / 8)}`;
    let list = occupied.get(key);
    if (!list) occupied.set(key, (list = []));
    list.push({ x: p.x, z: p.z, r });
    out.push(p);
    return true;
  };

  const { nodes, edges } = world.roads;
  const junctionClear = (n: number): number => {
    const N = nodes[n];
    if (N.edges.length < 3) return N.edges.length === 1 ? 3 : 0;
    const hws = N.edges.map((e) => edges[e].width / 2).sort((a, b) => b - a);
    return Math.sqrt(hws[1] ** 2 + (hws[0] + 6) ** 2) + 1.5;
  };

  // ---- Along every chain of road between intersections -------------------------------
  const done = new Uint8Array(edges.length);
  const chainsList: { nodes: number[]; edges: number[] }[] = [];
  const walk = (start: number, first: number): void => {
    const c = { nodes: [start], edges: [] as number[] };
    let node = start;
    let edge = first;
    for (;;) {
      done[edge] = 1;
      c.edges.push(edge);
      const E = edges[edge];
      node = E.a === node ? E.b : E.a;
      c.nodes.push(node);
      if (nodes[node].edges.length !== 2 || node === start) break;
      const next = nodes[node].edges[0] === edge ? nodes[node].edges[1] : nodes[node].edges[0];
      if (done[next] || edges[next].cls !== E.cls || edges[next].bridge !== E.bridge) break;
      edge = next;
    }
    chainsList.push(c);
  };
  for (let n = 0; n < nodes.length; n++) if (nodes[n].edges.length !== 2) for (const e of nodes[n].edges) if (!done[e]) walk(n, e);
  for (let e = 0; e < edges.length; e++) if (!done[e]) walk(edges[e].a, e);

  for (const c of chainsList) {
    const E0 = edges[c.edges[0]];
    if (E0.bridge) continue;
    const pts = c.nodes.map((n) => nodes[n]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const total = cum[cum.length - 1];
    const s0 = junctionClear(c.nodes[0]);
    const s1 = total - junctionClear(c.nodes[c.nodes.length - 1]);
    if (s1 - s0 < 6) continue;
    const at = (d: number): { x: number; z: number; dx: number; dz: number } => {
      let i = 1;
      while (i < pts.length - 1 && cum[i] < d) i++;
      const a = pts[i - 1];
      const b = pts[i];
      const l = cum[i] - cum[i - 1] || 1;
      const u = Math.max(0, Math.min(1, (d - cum[i - 1]) / l));
      return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, dx: (b.x - a.x) / l, dz: (b.z - a.z) / l };
    };
    const mid = at(total / 2);
    const district: DistrictId = model.districtAt(mid.x, mid.z);
    const spec = DISTRICTS[district];
    const hw = E0.width / 2;
    const crng = rng.fork(c.edges[0]);

    for (const side of [1, -1] as const) {
      // Left normal of the chain direction is (-dz, dx); side +1 = left.
      const probe = at((s0 + s1) / 2);
      const nx = -probe.dz * side;
      const nz = probe.dx * side;
      const blk = blockAt(probe.x + nx * (hw + 1.2), probe.z + nz * (hw + 1.2));
      const sidewalk = blk && spec.sidewalk > 0;
      const rural = !blk;
      if (rural && district !== 'cypressEdge') continue;
      const sideStagger = side === 1 ? 0 : 0.5;

      // Street lights.
      const lightSpacing = E0.cls === 'arterial' ? 34 : E0.cls === 'avenue' ? 38 : district === 'downtown' ? 32 : 46;
      const lightsThisSide = E0.cls !== 'street' || district === 'downtown' || district === 'beach' || side === 1;
      const deco = district === 'beach' && (E0.name === 'Ocean Drive' || E0.cls === 'street');
      if (lightsThisSide && (sidewalk || E0.cls !== 'street')) {
        for (let d = s0 + lightSpacing * (0.5 + sideStagger); d < s1 - 2; d += lightSpacing) {
          const p = at(d);
          const lx = -p.dz * side;
          const lz = p.dx * side;
          const off = hw + (sidewalk ? 0.7 : 2.5);
          const x = p.x + lx * off;
          const z = p.z + lz * off;
          if (shore(x, z) < 1) continue;
          place({ kind: deco ? 'streetLightDeco' : 'streetLightCobra', x, y: ground(x, z) + (sidewalk ? CURB : 0), z, yaw: yawFacing(-lx, -lz), scale: 1, variant: 0, param: 0 }, 1.2);
        }
      }

      // Utility poles (older districts), on the side without street lights.
      if ((district === 'littleSolano' || district === 'northside' || district === 'cypressEdge') && side === -1 && E0.cls === 'street') {
        for (let d = s0 + 20; d < s1 - 2; d += 38) {
          const p = at(d);
          const lx = -p.dz * side;
          const lz = p.dx * side;
          const off = hw + (sidewalk ? 0.5 : 2.5);
          const x = p.x + lx * off;
          const z = p.z + lz * off;
          if (shore(x, z) < 1) continue;
          // Crossarms run along the pole's Z, so wires (along X) follow the curb.
          place({ kind: 'utilityPole', x, y: ground(x, z) + (sidewalk ? CURB : 0), z, yaw: Math.atan2(-p.dz, p.dx), scale: 1, variant: crng.int(0, 2), param: 0 }, 1.0);
        }
      }

      if (!sidewalk) continue;

      // Street trees in the planting strip.
      const species = streetTree(district, E0.cls, E0.name);
      if (species) {
        const spacing = species.spacing;
        for (let d = s0 + spacing * 0.5 + crng.range(0, 3); d < s1 - 2; d += spacing * crng.range(0.85, 1.15)) {
          if (!crng.chance(species.density)) continue;
          const p = at(d);
          const lx = -p.dz * side;
          const lz = p.dx * side;
          const off = hw + Math.min(1.3, spec.sidewalk * 0.4);
          const x = p.x + lx * off;
          const z = p.z + lz * off;
          const kind = crng.weighted(species.kinds, species.weights);
          place({ kind, x, y: ground(x, z) + CURB, z, yaw: crng.range(0, Math.PI * 2), scale: crng.range(0.85, 1.15), variant: crng.int(0, 3), param: 0 }, kind === 'liveOak' ? 4 : 1.6);
        }
      }

      // Fire hydrants.
      if (side === 1) {
        for (let d = s0 + 12 + crng.range(0, 30); d < s1 - 3; d += 95) {
          const p = at(d);
          const lx = -p.dz * side;
          const lz = p.dx * side;
          const x = p.x + lx * (hw + 0.55);
          const z = p.z + lz * (hw + 0.55);
          place({ kind: 'fireHydrant', x, y: ground(x, z) + CURB, z, yaw: yawFacing(-lx, -lz), scale: 1, variant: 0, param: 0 }, 0.6);
        }
      }

      // Bus shelters on arterials and avenues: about one per 350 m of road, mid-block.
      if ((E0.cls === 'arterial' || E0.cls === 'avenue') && side === -1 && spec.sidewalk >= 3 && s1 - s0 > 24) {
        if (crng.chance(Math.min(1, (s1 - s0) / 300))) {
          const p = at((s0 + s1) / 2 + crng.range(-10, 10));
          const lx = -p.dz * side;
          const lz = p.dx * side;
          const x = p.x + lx * (hw + spec.sidewalk * 0.55);
          const z = p.z + lz * (hw + spec.sidewalk * 0.55);
          if (place({ kind: 'busShelter', x, y: ground(x, z) + CURB, z, yaw: yawFacing(-lx, -lz), scale: 1, variant: 0, param: 0 }, 2.4)) {
            const bx = x + p.dx * 3.2;
            const bz = z + p.dz * 3.2;
            place({ kind: 'trashCan', x: bx, y: ground(bx, bz) + CURB, z: bz, yaw: 0, scale: 1, variant: 0, param: 0 }, 0.5);
          }
        }
      }

      // Busy sidewalks: bins, newspaper boxes, parking meters.
      if (district === 'downtown' || district === 'beach' || district === 'littleSolano') {
        for (const d of [s0 + 2.5, s1 - 2.5]) {
          if (!crng.chance(0.45)) continue;
          const p = at(d);
          const lx = -p.dz * side;
          const lz = p.dx * side;
          const x = p.x + lx * (hw + 0.8);
          const z = p.z + lz * (hw + 0.8);
          const kind: PropKind = crng.chance(0.6) ? 'trashCan' : 'newspaperBox';
          place({ kind, x, y: ground(x, z) + CURB, z, yaw: yawFacing(-lx, -lz), scale: 1, variant: 0, param: 0 }, 0.6);
        }
        if (E0.cls === 'street' && district !== 'littleSolano') {
          for (let d = s0 + 6; d < s1 - 6; d += 13) {
            const p = at(d);
            const lx = -p.dz * side;
            const lz = p.dx * side;
            const x = p.x + lx * (hw + 0.45);
            const z = p.z + lz * (hw + 0.45);
            place({ kind: 'parkingMeter', x, y: ground(x, z) + CURB, z, yaw: yawFacing(-lx, -lz), scale: 1, variant: 0, param: 0 }, 0.4);
          }
        }
      }
    }
  }

  // ---- Intersections: signals and stop signs ---------------------------------------
  const signalNodes = new Uint8Array(nodes.length);
  for (let n = 0; n < nodes.length; n++) {
    const N = nodes[n];
    if (N.edges.length < 3) continue;
    // Distinct main roads meeting here (a boulevard passing through counts once).
    const major = new Set(N.edges.filter((e) => edges[e].cls === 'arterial' || edges[e].cls === 'avenue').map((e) => edges[e].name)).size;
    if (N.edges.some((e) => edges[e].bridge)) continue;
    const clear = junctionClear(n) - 1.5;
    const district = model.districtAt(N.x, N.z);
    const urban = district !== 'cypressEdge';
    const signalised = (major >= 2 || (district === 'downtown' && major + N.edges.length >= 4)) && urban;
    if (signalised) signalNodes[n] = 1;
    for (const e of N.edges) {
      const E = edges[e];
      const o = nodes[E.a === n ? E.b : E.a];
      const len = Math.hypot(o.x - N.x, o.z - N.z) || 1;
      const dx = (o.x - N.x) / len;
      const dz = (o.z - N.z) / len;
      // Traffic approaching the junction along this edge travels (-dx, -dz); its right is (-dz... ) below.
      const tx = -dx;
      const tz = -dz;
      const rx = -tz;
      const rz = tx;
      const hw = E.width / 2;
      const x = N.x + dx * (clear - 0.5) + rx * (hw + 0.8);
      const z = N.z + dz * (clear - 0.5) + rz * (hw + 0.8);
      if (shore(x, z) < 1) continue;
      const y = ground(x, z) + (blockAt(x, z) ? CURB : 0);
      const isMajor = E.cls === 'arterial' || E.cls === 'avenue';
      if (signalised) {
        // A mast arm on each approach's right corner. The heads (model -Z) face the
        // oncoming traffic and the arm (model +X) then reaches left over its lanes.
        const arm = hw >= 7 ? 12 : 8;
        place({ kind: 'trafficSignalMast', x, y, z, yaw: yawFacing(dx, dz), scale: 1, variant: arm >= 12 ? 1 : 0, param: arm }, 1.2);
      } else if (urban && !isMajor) {
        // Side streets stop for main roads; residential corners are all-way stops.
        place({ kind: 'stopSign', x, y, z, yaw: yawFacing(dx, dz), scale: 1, variant: 0, param: 0 }, 0.6);
      }
    }
  }

  // ---- Beach: lifeguard towers, umbrellas and loungers, coconut palms on the dunes ----
  for (let z = -2000; z < 1560; z += 6) {
    // Find the ocean shoreline x at this z by scanning east to west.
    let xShore = NaN;
    for (let x = 1600; x > 1300; x -= 2) {
      if (shore(x, z) > 0) {
        xShore = x;
        break;
      }
    }
    if (Number.isNaN(xShore)) continue;
    const r = hash01(Math.round(z), world.seed, 3);
    if ((((Math.round(z) % 282) + 282) % 282) < 6) {
      const x = xShore - 34;
      place({ kind: 'lifeguardTower', x, y: ground(x, z), z, yaw: yawFacing(1, 0), scale: 1, variant: Math.floor(r * 4), param: 0 }, 4);
    }
    if (r < 0.1) {
      // A cluster of hotel umbrellas and loungers in rows.
      for (let k = 0; k < 6; k++) {
        const x = xShore - 48 - (k % 3) * 5;
        const zz = z + Math.floor(k / 3) * 5;
        place({ kind: 'beachUmbrella', x, y: ground(x, zz), z: zz, yaw: 0, scale: 1, variant: Math.floor(r * 30) % 3, param: 0 }, 1.8);
        place({ kind: 'lounger', x: x + 2.6, y: ground(x + 2.6, zz), z: zz, yaw: yawFacing(1, 0), scale: 1, variant: 0, param: 0 }, 0.7);
      }
    }
    if (hash01(Math.round(z), world.seed, 5) < 0.3) {
      const x = xShore - 82 - hash01(Math.round(z), 9) * 12;
      place({ kind: 'palmCoconut', x, y: ground(x, z), z, yaw: hash01(z, 1) * 6.28, scale: 0.85 + hash01(z, 2) * 0.3, variant: Math.floor(hash01(z, 3) * 4), param: 0 }, 2);
    }
  }

  // ---- Parks, yards and wild land ------------------------------------------------------
  for (const b of world.blocks) {
    if (b.use !== 'park' && b.use !== 'golf' && b.use !== 'wild') continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of b.poly.outer) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    const wild = b.use === 'wild';
    const spacing = wild ? 22 : b.use === 'golf' ? 30 : 14;
    const brng = rng.fork(`park${b.id}`);
    for (let z = z0 + spacing / 2; z < z1; z += spacing) {
      for (let x = x0 + spacing / 2; x < x1; x += spacing) {
        const px = x + brng.range(-spacing, spacing) * 0.45;
        const pz = z + brng.range(-spacing, spacing) * 0.45;
        const cluster = noise(px / 140, pz / 140);
        if (wild ? cluster < 0.05 : brng.chance(0.35)) continue;
        if (!pointInRing(px, pz, b.poly.outer) || shore(px, pz) < 4) continue;
        let kind: PropKind;
        if (wild) kind = brng.weighted(['palmSabal', 'liveOak', 'shrub', 'grassClump'] as PropKind[], [3, 1.2, 2, 3]);
        else kind = brng.weighted(['palmRoyal', 'palmSabal', 'liveOak', 'shrub'] as PropKind[], [2, 2, 2, 1]);
        const y = ground(px, pz) + (wild ? 0 : CURB);
        place({ kind, x: px, y, z: pz, yaw: brng.range(0, 6.28), scale: brng.range(0.8, 1.2), variant: brng.int(0, 3), param: 0 }, kind === 'liveOak' ? 5 : kind === 'grassClump' ? 0.6 : 1.8);
      }
    }
  }
  // Front-yard trees in the suburbs and on the islands.
  for (const lot of world.lots) {
    if (lot.use !== 'residential' || (lot.district !== 'palmHeights' && lot.district !== 'islands' && lot.district !== 'littleSolano')) continue;
    const lrng = new Rng(lot.seed).fork('yard');
    if (!lrng.chance(lot.district === 'littleSolano' ? 0.25 : 0.7)) continue;
    const ring = lot.polygon;
    const fi = lot.frontage.findIndex(Boolean);
    if (fi < 0) continue;
    const a = ring[fi];
    const b = ring[(fi + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    // Inward normal of a positive ring edge is (-(b.z - a.z), b.x - a.x) / len.
    const ix = -(b.z - a.z) / len;
    const iz = (b.x - a.x) / len;
    const u = lrng.range(0.2, 0.8);
    const x = a.x + (b.x - a.x) * u + ix * lrng.range(2.5, 4.5);
    const z = a.z + (b.z - a.z) * u + iz * lrng.range(2.5, 4.5);
    const kind: PropKind = lot.district === 'islands' ? 'palmRoyal' : lrng.weighted(['palmSabal', 'palmRoyal', 'liveOak', 'palmCoconut'] as PropKind[], [3, 1.5, 2, 1.5]);
    place({ kind, x, y: ground(x, z) + CURB, z, yaw: lrng.range(0, 6.28), scale: lrng.range(0.75, 1.1), variant: lrng.int(0, 3), param: 0 }, kind === 'liveOak' ? 3.5 : 1.5);
  }

  // Pack.
  const count = out.length;
  const d: Dressing = {
    signalNodes,
    count,
    kind: new Uint8Array(count),
    pos: new Float32Array(count * 3),
    yaw: new Float32Array(count),
    scale: new Float32Array(count),
    variant: new Uint8Array(count),
    param: new Float32Array(count),
  };
  out.forEach((p, i) => {
    d.kind[i] = PROP_KINDS.indexOf(p.kind);
    d.pos[i * 3] = p.x;
    d.pos[i * 3 + 1] = p.y;
    d.pos[i * 3 + 2] = p.z;
    d.yaw[i] = p.yaw;
    d.scale[i] = p.scale;
    d.variant[i] = p.variant;
    d.param[i] = p.param;
  });
  return d;
}

function streetTree(district: DistrictId, cls: string, name: string): { kinds: PropKind[]; weights: number[]; spacing: number; density: number } | null {
  switch (district) {
    case 'downtown':
      return { kinds: ['palmRoyal', 'palmSabal'], weights: [3, 1], spacing: 11, density: 0.8 };
    case 'beach':
      if (name === 'Ocean Drive') return { kinds: ['palmCoconut', 'palmRoyal'], weights: [2, 1], spacing: 9, density: 0.9 };
      return { kinds: ['palmRoyal', 'palmCoconut', 'palmSabal'], weights: [2, 2, 1], spacing: 12, density: 0.75 };
    case 'littleSolano':
      return { kinds: ['palmSabal', 'liveOak', 'palmRoyal'], weights: [2, 1, 1], spacing: 16, density: 0.35 };
    case 'palmHeights':
      if (cls === 'arterial') return { kinds: ['palmRoyal'], weights: [1], spacing: 12, density: 0.9 };
      // The Coral Gables look: live oak canopies over residential streets.
      return { kinds: ['liveOak', 'palmSabal'], weights: [4, 1], spacing: 17, density: 0.75 };
    case 'islands':
      return { kinds: ['palmRoyal'], weights: [1], spacing: 12, density: 0.9 };
    case 'northside':
      return { kinds: ['palmSabal'], weights: [1], spacing: 22, density: 0.3 };
    case 'harbor':
      return null;
    case 'cypressEdge':
      return null;
  }
}
