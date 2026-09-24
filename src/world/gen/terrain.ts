// Terrain: signed distance to the shore and ground height on a 4 m grid.
// Port Solmar is flat (1-3 m above sea level) with a low limestone ridge in Palm Heights,
// dunes behind the ocean beach, a shallow bay and a deeper ocean.
import { RIDGE } from '../authored/layout';
import { smoothstep } from '../geom';
import { fbm, makeNoise } from '../noise';
import type { PolygonWithHoles } from '../types';
import type { LandModel, ShoreType } from './land';
import { Grid, distanceTo, fillPolygons } from './raster';

export interface TerrainResult {
  grid: Grid;
  /** 1 = land, 0 = water, per grid sample. */
  landMask: Uint8Array;
  /** Signed distance to the shoreline in metres (+ on land, - on water). */
  shoreDist: Float32Array;
  /** Ground / seabed height in metres. */
  height: Float32Array;
  /** Shore type code per sample (index into SHORE_TYPES) of the nearest shore. */
  shoreType: Uint8Array;
}

export const SHORE_TYPES: ShoreType[] = ['seawall', 'beach', 'natural', 'marsh'];

export const TERRAIN_RES = 4;

export function buildTerrain(model: LandModel, land: PolygonWithHoles[]): TerrainResult {
  const grid = new Grid(TERRAIN_RES);
  const n = grid.n;
  const landMask = fillPolygons(grid, land);
  const toWater = distanceTo(grid, landMask, 0); // for land samples
  const toLand = distanceTo(grid, landMask, 1); // for water samples
  const shoreDist = new Float32Array(grid.count);
  for (let k = 0; k < grid.count; k++) {
    // Half a cell correction puts the zero crossing between the last land and first water sample.
    shoreDist[k] = landMask[k] ? Math.max(0.5, toWater.dist[k] - grid.res / 2) : -Math.max(0.5, toLand.dist[k] - grid.res / 2);
  }

  // Shore type: classify each sample by the shore nearest to it. Classification is
  // evaluated on a coarse 16 m grid (it only changes across districts) and looked up.
  const coarse = new Grid(16);
  const coarseType = new Uint8Array(coarse.count);
  for (let j = 0; j < coarse.n; j++) {
    for (let i = 0; i < coarse.n; i++) coarseType[j * coarse.n + i] = SHORE_TYPES.indexOf(model.shoreTypeAt(coarse.x(i), coarse.x(j)));
  }
  const shoreType = new Uint8Array(grid.count);
  for (let k = 0; k < grid.count; k++) {
    // Land: its own shore type; water: the type of the nearest land sample.
    const src = landMask[k] ? k : toLand.nearest[k];
    if (src < 0) continue;
    const i = src % n;
    const j = (src - i) / n;
    shoreType[k] = coarse.nearest(coarseType, grid.x(i), grid.x(j));
  }

  const noise = makeNoise(model.seed * 13 + 5);
  const height = new Float32Array(grid.count);
  const rdx = RIDGE.to.x - RIDGE.from.x;
  const rdz = RIDGE.to.z - RIDGE.from.z;
  const rlen2 = rdx * rdx + rdz * rdz;
  for (let j = 0; j < n; j++) {
    const z = grid.x(j);
    for (let i = 0; i < n; i++) {
      const x = grid.x(i);
      const k = j * n + i;
      const d = shoreDist[k];
      const type = SHORE_TYPES[shoreType[k]];
      let h: number;
      if (d > 0) {
        h = landHeight(type, d);
        // Limestone ridge.
        const t = Math.max(0, Math.min(1, ((x - RIDGE.from.x) * rdx + (z - RIDGE.from.z) * rdz) / rlen2));
        const px = RIDGE.from.x + rdx * t - x;
        const pz = RIDGE.from.z + rdz * t - z;
        const ridgeD = Math.hypot(px, pz);
        const along = Math.sin(t * Math.PI) ** 0.6;
        h += RIDGE.height * along * Math.exp(-((ridgeD / RIDGE.width) ** 2)) * smoothstep(0, 250, d);
        // Gentle undulation away from the water.
        h += 0.7 * fbm(noise, x / 380, z / 380, 3) * smoothstep(20, 200, d);
        if (type === 'marsh') h = Math.min(h, 0.9 + 0.2 * noise(x / 60, z / 60));
      } else {
        h = waterDepth(type, -d, x);
      }
      height[k] = h;
    }
  }
  return { grid, landMask, shoreDist, height, shoreType };
}

function landHeight(type: ShoreType, d: number): number {
  switch (type) {
    case 'seawall':
      return 1.6 + 1.2 * smoothstep(0, 500, d);
    case 'beach': {
      // Wet and dry sand, a dune crest ~85 m in, then the town behind at ~2.6 m.
      const sand = Math.min(d, 75) * 0.024;
      const dune = 1.7 * Math.exp(-(((d - 88) / 14) ** 2));
      return sand + dune + 0.85 * smoothstep(80, 130, d);
    }
    case 'natural':
      return 0.5 + 2.3 * smoothstep(0, 420, d);
    case 'marsh':
      return 0.25 + 0.55 * smoothstep(0, 260, d);
  }
}

function waterDepth(type: ShoreType, d: number, x: number): number {
  // d = distance from the shore into the water (m).
  const ocean = x > 1430;
  if (type === 'beach' || ocean) {
    const shelf = Math.min(d * 0.03, 5);
    const deep = ocean ? Math.max(0, d - 150) * 0.045 : 0;
    return -Math.min(20, 0.05 + shelf + deep);
  }
  if (type === 'seawall') return -Math.min(5.5, 2.2 + d * 0.03);
  if (type === 'marsh') return -Math.min(1.8, 0.3 + d * 0.04);
  return -Math.min(4.5, 0.4 + d * 0.035);
}
