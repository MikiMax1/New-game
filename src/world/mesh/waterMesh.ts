// Water surface for the playable map: a grid at sea level over every wet cell, with
// per-vertex seabed depth and distance to shore so the shader can shade shallows,
// depth colour and surf without a depth pre-pass.
import { MAP_HALF } from '../config';
import { SHORE_TYPES } from '../gen/terrain';
import type { WorldData } from '../gen/world';
import type { MeshBuilder } from './meshData';

const STEP = 2; // terrain samples per water vertex (8 m)

export function buildWaterTile(world: WorldData, x0: number, z0: number, size: number, out: MeshBuilder): void {
  const t = world.terrain;
  const n = t.n;
  const i0 = Math.round((x0 - t.origin) / t.res);
  const j0 = Math.round((z0 - t.origin) / t.res);
  const cells = Math.round(size / t.res / STEP);
  const count = cells + 1;
  out.declareExtra('aWater', 3);
  const ids = new Int32Array(count * count);
  const wet = new Uint8Array(count * count);
  for (let jj = 0; jj < count; jj++) {
    for (let ii = 0; ii < count; ii++) {
      const i = Math.min(n - 1, i0 + ii * STEP);
      const j = Math.min(n - 1, j0 + jj * STEP);
      const k = j * n + i;
      const x = t.origin + i * t.res;
      const z = t.origin + j * t.res;
      const depth = -t.height[k];
      const surf = SHORE_TYPES[t.shoreType[k]] === 'beach' && x > 1300 ? 1 : 0;
      wet[jj * count + ii] = depth > -0.25 ? 1 : 0;
      // aWater: seabed depth (m), signed distance to shore (m), surf zone flag.
      ids[jj * count + ii] = out.vertex(x, 0, z, 0, 1, 0, x / 32, z / 32, undefined, { aWater: [depth, t.shoreDist[k], surf] });
    }
  }
  for (let jj = 0; jj + 1 < count; jj++) {
    for (let ii = 0; ii + 1 < count; ii++) {
      const a = jj * count + ii;
      if (!(wet[a] || wet[a + 1] || wet[a + count] || wet[a + count + 1])) continue;
      out.tri(ids[a], ids[a + count], ids[a + count + 1]);
      out.tri(ids[a], ids[a + count + 1], ids[a + 1]);
    }
  }
}

export const WATER_EXTENT = MAP_HALF;
