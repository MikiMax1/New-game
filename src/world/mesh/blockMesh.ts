// Blocks: raised sidewalks with vertical curb faces (seawalls where a block meets the
// water), lot ground (lawns, pavers, parking, yards) and park or plaza surfaces.
import { DISTRICTS } from '../authored/districts';
import { difference, offset } from '../clip';
import type { Block } from '../gen/blocks';
import type { WorldData } from '../gen/world';
import { hash01 } from '../rng';
import type { LandUse, Lot, PolygonWithHoles, Ring } from '../types';
import { drapePolygon } from './drape';
import { CURB_HEIGHT, type Heights, blockIsPaved } from './heights';
import type { MeshBuilder } from './meshData';

type Sink = (anchorX: number, anchorZ: number, bucket: string) => MeshBuilder;
type RGB = readonly [number, number, number];

const LAWN: RGB = [0.34, 0.5, 0.2];
const PARK_GRASS: RGB = [0.3, 0.52, 0.18];
const PAVERS: RGB = [0.6, 0.58, 0.54];
const ASPHALT_LOT: RGB = [0.24, 0.24, 0.25];
const YARD: RGB = [0.5, 0.49, 0.46];
const DIRT: RGB = [0.52, 0.46, 0.35];

export function buildBlocks(world: WorldData, h: Heights, sink: Sink): void {
  const lotsByBlock = groupLots(world);
  for (const block of world.blocks) {
    if (!blockIsPaved(block)) continue;
    const c = block.poly.outer[0];
    const spec = DISTRICTS[block.district];
    const sidewalk = Math.max(2, spec.sidewalk || 2.5);
    let inner: PolygonWithHoles[] = block.inner;
    if (block.use !== 'urban') inner = block.use === 'plaza' ? [] : offset([block.poly], -sidewalk, 'miter');
    const ring = inner.length ? difference([block.poly], inner) : [block.poly];
    const top = (x: number, z: number): number => Math.max(0.3, h.ground(x, z)) + CURB_HEIGHT;
    const walk = sink(c.x, c.z, 'sidewalk');
    // Sidewalks are narrow rings: resampled edges are enough to follow the ground.
    for (const p of ring) drapePolygon(p, walk, { cell: Infinity, resample: 8, height: top, uvScale: 1 / 1.5 });

    // Curb faces (or seawalls) along every boundary ring of the block.
    for (const r of [block.poly.outer, ...block.poly.holes]) curbRing(r, h, sink);

    // Ground inside the sidewalk.
    if (block.use === 'urban') {
      // Coarse base under the lots (fills slivers between them), kept a little lower.
      const base = sink(c.x, c.z, 'lotBase');
      const baseTop = (x: number, z: number): number => top(x, z) - 0.04;
      for (const p of inner) drapePolygon(p, base, { cell: 48, height: baseTop, uvScale: 1 / 6, color: block.district === 'palmHeights' || block.district === 'islands' ? LAWN : YARD });
      for (const lot of lotsByBlock.get(block.id) ?? []) {
        const out = sink(lot.polygon[0].x, lot.polygon[0].z, 'lotGround');
        const color = lotColor(lot);
        drapePolygon({ outer: lot.polygon, holes: [] }, out, { cell: 24, height: top, uvScale: 1 / 6, color });
      }
    } else if (inner.length) {
      const green = block.use === 'park' || block.use === 'golf';
      const out = sink(c.x, c.z, 'lotGround');
      const color = green ? PARK_GRASS : block.use === 'stadium' || block.use === 'mall' || block.use === 'hospital' ? ASPHALT_LOT : PAVERS;
      for (const p of inner) drapePolygon(p, out, { cell: 24, height: top, uvScale: 1 / 6, color });
    }
  }
}

function groupLots(world: WorldData): Map<number, Lot[]> {
  // Lots don't store their block, so match by position against block bounds.
  const out = new Map<number, Lot[]>();
  const cell = 128;
  const grid = new Map<string, Block[]>();
  for (const b of world.blocks) {
    if (b.use !== 'urban') continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of b.poly.outer) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++)
      for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
        const k = `${i},${j}`;
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(b);
      }
  }
  for (const lot of world.lots) {
    const p = lot.polygon;
    // A point safely inside the lot: average of the first three vertices.
    const x = (p[0].x + p[1].x + p[2].x) / 3;
    const z = (p[0].z + p[1].z + p[2].z) / 3;
    const cands = grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? [];
    const b = cands.find((bl) => inRing(x, z, bl.poly.outer)) ?? cands[0];
    if (!b) continue;
    let list = out.get(b.id);
    if (!list) out.set(b.id, (list = []));
    list.push(lot);
  }
  return out;
}

function inRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i];
    const b = r[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function lotColor(lot: Lot): RGB {
  const v = 0.9 + 0.2 * hash01(lot.seed, 7);
  const tint = (c: RGB): RGB => [c[0] * v, c[1] * v, c[2] * v];
  const use: LandUse = lot.use;
  if (use === 'parking') return tint(ASPHALT_LOT);
  if (use === 'park') return tint(PARK_GRASS);
  if (use === 'industrial') return tint(YARD);
  if (use === 'residential') {
    if (lot.district === 'downtown') return tint(PAVERS);
    if (lot.district === 'cypressEdge') return tint(DIRT);
    // Lawns vary from lush to sun-burnt.
    const dry = hash01(lot.seed, 11);
    return [LAWN[0] * v + dry * 0.12, LAWN[1] * v + dry * 0.02, LAWN[2] * v + dry * 0.06];
  }
  return tint(PAVERS);
}

/** Vertical faces along a block boundary: 15 cm curbs, or seawalls where the outside is water. */
function curbRing(r: Ring, h: Heights, sink: Sink): void {
  const n = r.length;
  for (let i = 0; i < n; i++) {
    const a = r[i];
    const b = r[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.01) continue;
    // Outward normal for a positive ring (holes are stored reversed, so this also points out of the block).
    const nx = (b.z - a.z) / len;
    const nz = -(b.x - a.x) / len;
    const mx = (a.x + b.x) / 2 + nx * 2;
    const mz = (a.z + b.z) / 2 + nz * 2;
    const wet = h.shoreDist(mx, mz) < 0;
    const out = sink(a.x, a.z, wet ? 'seawall' : 'curb');
    const steps = Math.max(1, Math.ceil(len / 6));
    let prevTop = -1;
    let prevBot = -1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const g = Math.max(0.3, h.ground(x, z));
      const topY = g + CURB_HEIGHT;
      const botY = wet ? -2.6 : g - 0.4;
      const T = out.vertex(x, topY, z, nx, 0, nz, (x + z) * 0.5, topY);
      const B = out.vertex(x, botY, z, nx, 0, nz, (x + z) * 0.5, botY);
      if (prevTop >= 0) out.quad(B, prevBot, prevTop, T);
      prevTop = T;
      prevBot = B;
    }
  }
}
