// Runs world generation (and optionally meshing) off the main thread.
import { meshTransferables } from '../mesh/meshData';
import { buildCityMeshes } from '../mesh/chunks';
import { generateWorld } from './world';

self.onmessage = (e: MessageEvent<{ seed: number; meshes: boolean }>) => {
  const progress = (stage: string, fraction: number): void => self.postMessage({ type: 'progress', stage, fraction });
  const world = generateWorld(e.data.seed, (stage, f) => progress(stage, e.data.meshes ? f * 0.8 : f));
  const city = e.data.meshes ? buildCityMeshes(world, progress) : null;
  const t = world.terrain;
  const transfer: ArrayBuffer[] = [t.height.buffer, t.shoreDist.buffer, t.shoreType.buffer] as ArrayBuffer[];
  if (city) {
    transfer.push(city.displayHeights.buffer as ArrayBuffer, city.nodeY.buffer as ArrayBuffer);
    for (const c of city.chunks) for (const m of c.buckets.values()) transfer.push(...meshTransferables(m));
  }
  self.postMessage({ type: 'done', world, city }, { transfer });
};
