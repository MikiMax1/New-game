// Runs world generation off the main thread.
import { generateWorld } from './world';

self.onmessage = (e: MessageEvent<{ seed: number }>) => {
  const world = generateWorld(e.data.seed, (stage, fraction) => self.postMessage({ type: 'progress', stage, fraction }));
  const t = world.terrain;
  self.postMessage({ type: 'done', world }, { transfer: [t.height.buffer, t.shoreDist.buffer, t.shoreType.buffer] as ArrayBuffer[] });
};
