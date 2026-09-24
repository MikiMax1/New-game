import type { Progress, WorldData } from './gen/world';

/**
 * Generates the world in a Web Worker (falls back to the main thread when workers
 * are unavailable, e.g. in some sandboxed pages).
 */
export async function loadWorld(seed: number, onProgress: Progress = () => {}): Promise<WorldData> {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./gen/worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (worker) {
    const w = worker;
    try {
      return await new Promise<WorldData>((resolve, reject) => {
        w.onmessage = (e: MessageEvent) => {
          if (e.data.type === 'progress') onProgress(e.data.stage, e.data.fraction);
          else if (e.data.type === 'done') resolve(e.data.world as WorldData);
        };
        w.onerror = (e) => reject(new Error(e.message || 'world worker failed'));
        w.postMessage({ seed });
      });
    } catch (err) {
      console.warn('World worker failed, generating on the main thread instead:', err);
    } finally {
      w.terminate();
    }
  }
  const { generateWorld } = await import('./gen/world');
  onProgress('Generating', 0.1);
  await new Promise((r) => setTimeout(r, 0));
  return generateWorld(seed, onProgress);
}
