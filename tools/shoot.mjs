#!/usr/bin/env node
// Renders pages in headless Chromium (software WebGL / WebGPU via SwiftShader) and saves screenshots.
//
//   node tools/shoot.mjs "index.html?cam=0,50,200&look=0,0,0" out.png ["map.html?seed=2" map.png ...]
//
// Options:  --size 1280x720   --timeout 240 (seconds per shot)   --url http://host:port (use a running server)   --ui 1 (keep the HUD)
// Pages set window.__READY = true when they are ready to be captured; `capture=1` is added automatically.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const opts = { size: '1280x720', timeout: 240, url: '', ui: '' };
const shots = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    opts[a.slice(2)] = args[++i];
  } else {
    shots.push({ page: a, out: args[++i] });
  }
}
if (shots.length === 0 || shots.some((s) => !s.out)) {
  console.error('usage: node tools/shoot.mjs <page?params> <out.png> [...] [--size WxH] [--timeout s] [--url base]');
  process.exit(2);
}
const [width, height] = opts.size.split('x').map(Number);

let server = null;
let base = opts.url;
if (!base) {
  server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'warn' });
  await server.listen();
  const addr = server.httpServer.address();
  base = `http://127.0.0.1:${addr.port}`;
}

// WebGPU needs a secure context: the local server is http://127.0.0.1, which counts as one.
// Without Vulkan on SwiftShader, presenting WebGPU to a page canvas loses the device.
const browser = await chromium.launch({
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--enable-unsafe-webgpu',
    '--use-vulkan=swiftshader',
    '--enable-features=Vulkan',
  ],
});
let failures = 0;
try {
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
      else if (process.env.SHOOT_VERBOSE) console.log(`  [page] ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
    const sep = shot.page.includes('?') ? '&' : '?';
    // --ui 1 keeps the HUD (no capture mode).
    const url = opts.ui ? `${base}/${shot.page}` : `${base}/${shot.page}${sep}capture=1`;
    const t0 = Date.now();
    process.stdout.write(`shot ${shot.page} -> ${shot.out} ... `);
    try {
      await page.goto(url, { waitUntil: 'load', timeout: opts.timeout * 1000 });
      await page.waitForFunction(() => window.__READY === true, null, { timeout: opts.timeout * 1000, polling: 250 });
      const stats = await page.evaluate(() => window.__STATS ?? null);
      mkdirSync(dirname(resolve(shot.out)), { recursive: true });
      await page.screenshot({ path: shot.out, timeout: opts.timeout * 1000 });
      console.log(`ok ${((Date.now() - t0) / 1000).toFixed(1)}s${stats ? `  calls=${stats.calls} tris=${stats.triangles}` : ''}`);
    } catch (e) {
      failures++;
      console.log(`FAILED: ${e.message.split('\n')[0]}`);
      try {
        mkdirSync(dirname(resolve(shot.out)), { recursive: true });
        await page.screenshot({ path: shot.out.replace(/\.png$/, '.failed.png') });
      } catch {
        /* page may be gone */
      }
    }
    for (const e of errors.slice(0, 20)) console.log('  ' + e);
    await page.close();
  }
} finally {
  await browser.close();
  if (server) await server.close();
}
process.exit(failures ? 1 : 0);
