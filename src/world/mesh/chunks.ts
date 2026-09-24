// Builds render meshes for the whole map, grouped into square render chunks so the
// renderer can cull (and later stream / LOD) them independently.
import { MAP_HALF, MAP_SIZE } from '../config';
import { LandModel } from '../gen/land';
import type { WorldData } from '../gen/world';
import { makeNoise } from '../noise';
import { buildBlocks } from './blockMesh';
import { Heights } from './heights';
import { BucketBuilder, type MeshBuckets, type MeshBuilder, type MeshData } from './meshData';
import { generateBuilding } from '../buildings';
import { centroid } from '../geom';
import { buildLandmarks } from './landmarks';
import { buildLightMap } from './lightMap';
import { buildRoads } from './roadMesh';
import { buildBridges, buildHighways } from './structures';
import { buildFarTerrain } from './farTerrain';
import { buildTerrainTile } from './terrainMesh';
import { buildWaterTile } from './waterMesh';

/** Render chunk size (m): 8 x 8 chunks over the map. */
export const RENDER_CHUNK = 512;
export const RENDER_CHUNKS = MAP_SIZE / RENDER_CHUNK;

export interface ChunkMesh {
  i: number;
  j: number;
  /** World-space centre of the chunk. */
  x: number;
  z: number;
  buckets: MeshBuckets;
}

export interface CityMeshes {
  chunks: ChunkMesh[];
  /** Displayed terrain heights (for the camera and later physics). */
  displayHeights: Float32Array;
  /** Road node deck heights. */
  nodeY: Float32Array;
  /** Low-detail land and seabed beyond the map edge. */
  far: MeshData;
  /** Street-light pools (LIGHTMAP_SIZE^2, one byte per texel). */
  lightMap: Uint8Array;
}

export function buildCityMeshes(world: WorldData, progress: (stage: string, f: number) => void = () => {}): CityMeshes {
  const h = new Heights(world);
  const n = RENDER_CHUNKS;
  const builders: BucketBuilder[] = Array.from({ length: n * n }, () => new BucketBuilder());
  const chunkIndex = (x: number, z: number): number => {
    const i = Math.min(n - 1, Math.max(0, Math.floor((x + MAP_HALF) / RENDER_CHUNK)));
    const j = Math.min(n - 1, Math.max(0, Math.floor((z + MAP_HALF) / RENDER_CHUNK)));
    return j * n + i;
  };
  const sink = (x: number, z: number, bucket: string): MeshBuilder => builders[chunkIndex(x, z)].get(bucket);
  const model = new LandModel(world.seed);
  const district = (x: number, z: number) => model.districtAt(x, z);

  progress('Paving roads', 0.82);
  buildRoads(world, h, sink, district);
  progress('Pouring sidewalks', 0.87);
  buildBlocks(world, h, sink);
  progress('Raising highways', 0.92);
  buildHighways(world, h, sink);
  buildBridges(world, h, sink);
  buildLandmarks(world, h, sink);
  // Buildings at two levels of detail per chunk: '@lod0' near, '@lod1' far.
  progress('Raising buildings', 0.93);
  const lodBuilders: [BucketBuilder, BucketBuilder][] = builders.map(() => [new BucketBuilder(), new BucketBuilder()]);
  for (const lot of world.lots) {
    const c = centroid(lot.polygon);
    const [near, far] = lodBuilders[chunkIndex(c.x, c.z)];
    generateBuilding(lot, near, 0);
    generateBuilding(lot, far, 1);
  }

  progress('Shaping terrain', 0.95);
  const noise = makeNoise(world.seed * 101 + 7);
  const TILE = 256;
  for (let z0 = -MAP_HALF; z0 < MAP_HALF; z0 += TILE) {
    for (let x0 = -MAP_HALF; x0 < MAP_HALF; x0 += TILE) {
      buildTerrainTile(world, h, x0, z0, TILE, noise, sink(x0 + TILE / 2, z0 + TILE / 2, 'terrain'));
      buildWaterTile(world, x0, z0, TILE, sink(x0 + TILE / 2, z0 + TILE / 2, 'water'));
    }
  }

  progress('Packing meshes', 0.96);
  const chunks: ChunkMesh[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const buckets = builders[j * n + i].build();
      const [near, far] = lodBuilders[j * n + i];
      for (const [k, m] of near.build()) buckets.set(`${k}@lod0`, m);
      for (const [k, m] of far.build()) buckets.set(`${k}@lod1`, m);
      if (buckets.size === 0) continue;
      chunks.push({ i, j, x: -MAP_HALF + (i + 0.5) * RENDER_CHUNK, z: -MAP_HALF + (j + 0.5) * RENDER_CHUNK, buckets });
    }
  }
  const far = buildFarTerrain(world, h, noise);
  const lightMap = buildLightMap(world.dressing);
  return { chunks, displayHeights: h.display, nodeY: h.nodeY, far, lightMap };
}
