import type { CityMeshes } from './mesh/chunks';
import type { Progress, WorldData } from './gen/world';

export interface LoadedCity {
  world: WorldData;
  city: CityMeshes | null;
}

/**
 * Generates the world (and optionally its render meshes) in a Web Worker. Falls back to
 * the main thread when workers are unavailable, e.g. in some sandboxed pages.
 */
export async function loadCity(seed: number, onProgress: Progress = () => {}, meshes = false): Promise<LoadedCity> {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./gen/worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (worker) {
    const w = worker;
    try {
      return await new Promise<LoadedCity>((resolve, reject) => {
        w.onmessage = (e: MessageEvent) => {
          if (e.data.type === 'progress') onProgress(e.data.stage, e.data.fraction);
          else if (e.data.type === 'done') resolve({ world: e.data.world as WorldData, city: e.data.city as CityMeshes | null });
        };
        w.onerror = (e) => reject(new Error(e.message || 'world worker failed'));
        w.postMessage({ seed, meshes });
      });
    } catch (err) {
      console.warn('World worker failed, generating on the main thread instead:', err);
    } finally {
      w.terminate();
    }
  }
  const { generateWorld } = await import('./gen/world');
  const yieldFrame = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  onProgress('Generating', 0.05);
  await yieldFrame();
  const world = generateWorld(seed, (s, f) => onProgress(s, meshes ? f * 0.8 : f));
  let city: CityMeshes | null = null;
  if (meshes) {
    await yieldFrame();
    const { buildCityMeshes } = await import('./mesh/chunks');
    city = buildCityMeshes(world, onProgress);
  }
  return { world, city };
}

export async function loadWorld(seed: number, onProgress: Progress = () => {}): Promise<WorldData> {
  return (await loadCity(seed, onProgress, false)).world;
}
