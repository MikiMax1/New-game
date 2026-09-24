// Low-detail land and seabed beyond the playable map, out to the horizon. Each far
// vertex copies the nearest map-edge sample, so coastlines, the bay and the barrier
// island visibly continue past the edge instead of ending at a cliff.
import type { NoiseFunction2D } from 'simplex-noise';
import { MAP_HALF } from '../config';
import type { WorldData } from '../gen/world';
import type { Heights } from './heights';
import { MeshBuilder, type MeshData } from './meshData';
import { terrainColor } from './terrainMesh';

const FAR = 9000;
const CELL = 64;

export function buildFarTerrain(world: WorldData, h: Heights, noise: NoiseFunction2D): MeshData {
  const out = new MeshBuilder();
  const t = world.terrain;
  const n = t.n;
  const count = Math.round((2 * FAR) / CELL) + 1;
  const ids = new Int32Array(count * count).fill(-1);
  const inside = (x: number, z: number): boolean => Math.abs(x) < MAP_HALF - 1 && Math.abs(z) < MAP_HALF - 1;
  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const x = -FAR + i * CELL;
      const z = -FAR + j * CELL;
      // Snap vertices near the map edge onto it so the far mesh meets the map exactly.
      const cx = Math.max(-MAP_HALF, Math.min(MAP_HALF, x));
      const cz = Math.max(-MAP_HALF, Math.min(MAP_HALF, z));
      const si = Math.round((cx - t.origin) / t.res);
      const sj = Math.round((cz - t.origin) / t.res);
      const k = Math.min(n - 1, sj) * n + Math.min(n - 1, si);
      const dist = Math.max(Math.abs(x) - MAP_HALF, Math.abs(z) - MAP_HALF, 0);
      let y = h.display[k];
      // Far land settles to a flat plain; far water deepens.
      if (y > 0) y = y + (1.4 - y) * Math.min(1, dist / 1500) + 0.6 * noise(x / 900, z / 900) * Math.min(1, dist / 800);
      else y = y - Math.min(12, dist * 0.004);
      ids[j * count + i] = out.vertex(x, y, z, 0, 1, 0, x / 40, z / 40, terrainColor(world, k, cx, cz, noise));
    }
  }
  for (let j = 0; j + 1 < count; j++) {
    for (let i = 0; i + 1 < count; i++) {
      const x0 = -FAR + i * CELL;
      const z0 = -FAR + j * CELL;
      // Skip cells fully inside the map (the detailed terrain covers them).
      if (inside(x0, z0) && inside(x0 + CELL, z0) && inside(x0, z0 + CELL) && inside(x0 + CELL, z0 + CELL)) continue;
      const a = ids[j * count + i];
      const b = ids[j * count + i + 1];
      const c = ids[(j + 1) * count + i];
      const e = ids[(j + 1) * count + i + 1];
      out.tri(a, c, e);
      out.tri(a, e, b);
    }
  }
  return out.build();
}
