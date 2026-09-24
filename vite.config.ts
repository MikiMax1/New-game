import { defineConfig } from 'vitest/config';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Every HTML page in the repo root and in dev/ is an entry point, so test pages
// (dev/*.html) are built and served next to the game.
const pages: Record<string, string> = {};
for (const dir of ['', 'dev/']) {
  if (!existsSync(root + dir)) continue;
  for (const file of readdirSync(root + dir)) {
    if (file.endsWith('.html')) pages[(dir + file).replace(/[/.]/g, '_')] = root + dir + file;
  }
}

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2048,
    rollupOptions: { input: pages },
  },
  worker: { format: 'es' },
  server: { host: true },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 180000,
  },
});
