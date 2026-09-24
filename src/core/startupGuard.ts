// Remembers whether the previous start got the game running. If the browser, the tab or its
// GPU process died while the game was loading, or the graphics driver reset during play, the
// next start uses a lower graphics quality instead of crashing the same way again.
import { isCapture } from './params';
import { loadPref, savePref } from './storage';

const KEY = 'boot';
type State = 'idle' | 'starting' | 'running' | 'failed';
let state: State = 'idle';

/** The game is about to load at quality `q`. */
export function markStarting(q: string): void {
  if (isCapture) return;
  state = 'starting';
  savePref(KEY, `starting:${q}`);
  // Leaving on purpose (closing the tab, reloading) is not a crash; a crash fires no event.
  window.addEventListener('pagehide', () => {
    if (state === 'starting') savePref(KEY, 'ok');
  });
}

/** The game has been running for a while: the start succeeded. */
export function markRunning(): void {
  if (isCapture || state !== 'starting') return;
  state = 'running';
  savePref(KEY, 'ok');
}

/** The graphics driver reset (WebGL context lost) while running at quality `q`. */
export function markFailed(q: string): void {
  if (isCapture) return;
  state = 'failed';
  savePref(KEY, `failed:${q}`);
}

/**
 * Quality name of a previous start that never reached the running state (or lost its GPU),
 * or null. Reading it clears it, so a lower quality is applied once per failure.
 */
export function takeFailedQuality(): string | null {
  if (isCapture) return null;
  const m = /^(starting|failed):(\w+)$/.exec(loadPref(KEY) ?? '');
  if (!m) return null;
  savePref(KEY, 'ok');
  return m[2];
}
