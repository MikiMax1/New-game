#!/usr/bin/env node
// Downloads the showcase's photographic assets into public/content/ (about 120 MB, not committed):
// HDRI skies, 2K photo-scanned PBR texture sets and high-poly glTF models, listed in
// tools/assets/manifest.json. Poly Haven assets are CC0; others carry their own licence, which
// is written to public/content/CREDITS.md.
//
//   node tools/assets/fetch.mjs          fetch whatever is missing
//   node tools/assets/fetch.mjs --force  fetch everything again
//   node tools/assets/fetch.mjs --soft   never fail (offline is fine)
//   node tools/assets/fetch.mjs --only a,b   (re)fetch just these asset ids
//
// Poly Haven models arrive as .gltf + .bin + textures and are packed into one .glb each with
// glTF-Transform (fetched on demand through npx): meshopt-compressed geometry, WebP textures at
// 2K. The Draco and Basis decoders three.js needs for compressed assets are copied next to them.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'public/content');
const manifest = JSON.parse(readFileSync(join(root, 'tools/assets/manifest.json'), 'utf8'));
const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const soft = args.has('--soft');
const onlyArg = process.argv.slice(2).find((a, i, all) => all[i - 1] === '--only');
const only = onlyArg ? new Set(onlyArg.split(',')) : null;
/** Whether to (re)fetch an asset: --only picks ids and forces them; otherwise what's missing, or all with --force. */
const wanted = (id, path) => (only ? only.has(id) : force || !existsSync(path));
// Some CDNs turn away generic library user agents.
const headers = { 'User-Agent': 'SolmarAssetFetcher/1.0 (+https://github.com/MikiMax1/New-game)' };
const API = 'https://api.polyhaven.com';
/** Texture maps fetched per set: albedo, OpenGL normal, packed AO/roughness/metalness, height. */
const TEXTURE_MAPS = { Diffuse: 'diff', nor_gl: 'nor_gl', arm: 'arm', Displacement: 'disp' };

async function json(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function download(url, dest, md5, id) {
  if (!wanted(id, dest)) return false;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (md5 && createHash('md5').update(data).digest('hex') !== md5) throw new Error(`${url}: checksum mismatch`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest + '.part', data);
  renameSync(dest + '.part', dest);
  return true;
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const log = (s) => process.stdout.write(s + '\n');

async function main() {
  const index = { hdris: {}, textures: {}, models: {} };
  const credits = [];
  let fetched = 0;

  for (const h of manifest.hdris) {
    const files = await json(`${API}/files/${h.id}`);
    const f = files.hdri[h.res].hdr;
    const path = `hdri/${h.id}_${h.res}.hdr`;
    if (await download(f.url, join(out, path), f.md5, h.id)) {
      fetched++;
      log(`hdri    ${h.id} ${h.res} (${mb(f.size)})`);
    }
    index.hdris[h.id] = path;
    credits.push(await credit(h.id, 'HDRI'));
  }

  for (const t of manifest.textures) {
    const files = await json(`${API}/files/${t.id}`);
    const maps = {};
    for (const [key, name] of Object.entries(TEXTURE_MAPS)) {
      const f = files[key]?.[t.res]?.jpg ?? files[key]?.[t.res]?.png;
      if (!f) continue;
      const ext = f.url.split('.').pop();
      const path = `textures/${t.id}/${t.id}_${name}_${t.res}.${ext}`;
      if (await download(f.url, join(out, path), f.md5, t.id)) {
        fetched++;
        log(`texture ${t.id} ${name} (${mb(f.size)})`);
      }
      maps[name] = path;
    }
    index.textures[t.id] = maps;
    credits.push(await credit(t.id, 'texture'));
  }

  for (const m of manifest.models) {
    const glb = `models/${m.id}/${m.id}.glb`;
    index.models[m.id] = glb;
    credits.push(await credit(m.id, 'model'));
    if (!wanted(m.id, join(out, glb))) continue;
    const files = await json(`${API}/files/${m.id}`);
    const g = files.gltf[m.res].gltf;
    const dir = join(out, 'models', m.id, 'src');
    const gltfPath = join(dir, `${m.id}.gltf`);
    await download(g.url, gltfPath, g.md5, m.id);
    let size = g.size;
    for (const [rel, f] of Object.entries(g.include)) {
      await download(f.url, join(dir, rel), f.md5, m.id);
      size += f.size;
    }
    // One .glb with meshopt-compressed geometry and WebP textures (still 2K): 4–8× smaller
    // downloads for the same detail. Modular kits (`keep`) stay as separate, named pieces;
    // other models have their meshes merged per material for fewer draw calls.
    const gltfTransform = ['--yes', '@gltf-transform/cli@4'];
    const optimise = ['--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '2048', '--simplify', 'false', '--palette', 'false'];
    if (m.keep) optimise.push('--join', 'false', '--flatten', 'false', '--instance', 'false');
    execFileSync('npx', [...gltfTransform, 'optimize', gltfPath, join(out, glb), ...optimise], { stdio: 'ignore' });
    rmSync(dir, { recursive: true, force: true });
    fetched++;
    log(`model   ${m.id} ${m.res} (${mb(size)})`);
  }

  for (const f of manifest.files) {
    if (await download(f.url, join(out, f.path), undefined, f.id)) {
      fetched++;
      log(`file    ${f.id}`);
    }
    index.models[f.id] = f.path;
    credits.push(`- **${f.id}**: ${f.credit}. Licence: ${f.license}. Source: ${f.source}`);
  }

  // Decoders for Draco-compressed meshes and KTX2 (Basis) textures, served next to the assets.
  const libs = join(root, 'node_modules/three/examples/jsm/libs');
  cpSync(join(libs, 'draco/gltf'), join(out, 'decoders/draco'), { recursive: true });
  cpSync(join(libs, 'basis'), join(out, 'decoders/basis'), { recursive: true });

  writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  writeFileSync(
    join(out, 'CREDITS.md'),
    '# Asset credits\n\nFetched by `tools/assets/fetch.mjs`. Poly Haven assets are CC0 (public domain).\n\n' + credits.join('\n') + '\n',
  );
  log(fetched ? `assets: ${fetched} fetched into public/content/` : 'assets: up to date');
}

async function credit(id, kind) {
  const info = await json(`${API}/info/${id}`);
  const authors = Object.keys(info.authors ?? {}).join(', ');
  return `- **${info.name ?? id}** (${kind}) by ${authors || 'Poly Haven'}. Licence: CC0. Source: https://polyhaven.com/a/${id}`;
}

main().catch((e) => {
  process.stderr.write(`assets: ${e.message}\n`);
  if (soft) {
    process.stderr.write('assets: continuing without them (run `npm run assets` when online)\n');
    process.exit(0);
  }
  process.exit(1);
});
