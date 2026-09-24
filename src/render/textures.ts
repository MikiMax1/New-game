// Procedural textures drawn on canvases (no downloaded assets). Deterministic.
import * as THREE from 'three';
import { Rng } from '../world/rng';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Tileable value noise (wraps at `period` cells). */
function tileNoise(rng: Rng, period: number): (x: number, y: number) => number {
  const g = new Float32Array(period * period).map(() => rng.next());
  const at = (i: number, j: number): number => g[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(i, j);
    const b = at(i + 1, j);
    const c = at(i, j + 1);
    const d = at(i + 1, j + 1);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  };
}

function fbmTile(rng: Rng, size: number, octaves: number, base: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const period = base << o;
    const n = tileNoise(rng, period);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] += amp * n((x / size) * period, (y / size) * period);
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** Asphalt: aggregate speckle, blotchy wear, tar-sealed cracks. One tile = 8 m. */
export function asphaltTexture(): THREE.CanvasTexture {
  const size = 1024;
  const [c, ctx] = canvas(size);
  const rng = new Rng('asphalt');
  const blot = fbmTile(rng, size, 5, 4);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const speck = rng.next();
    let v = 78 + (blot[i] - 0.5) * 34 + (speck - 0.5) * 26;
    if (speck > 0.985) v += 38; // light aggregate
    if (speck < 0.012) v -= 26; // dark voids
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v * 1.02;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // A couple of faint tar-sealed cracks (the texture repeats every 8 m, so keep them subtle).
  ctx.strokeStyle = 'rgba(30,30,32,0.28)';
  ctx.lineCap = 'round';
  for (let k = 0; k < 2; k++) {
    let x = rng.range(0, size);
    let y = rng.range(0, size);
    let a = rng.range(0, Math.PI * 2);
    ctx.lineWidth = rng.range(1.5, 3);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 40; s++) {
      a += rng.range(-0.5, 0.5);
      x += Math.cos(a) * 9;
      y += Math.sin(a) * 9;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return toTexture(c);
}

/** Concrete sidewalk slab (one tile = one 1.5 m slab) with scored joints. */
export function slabTexture(): THREE.CanvasTexture {
  const size = 512;
  const [c, ctx] = canvas(size);
  const rng = new Rng('slab');
  const n = fbmTile(rng, size, 5, 4);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 196 + (n[i] - 0.5) * 30 + (rng.next() - 0.5) * 14;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v * 0.99;
    img.data[i * 4 + 2] = v * 0.955;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(70,66,60,0.55)';
  ctx.fillRect(0, 0, size, 4);
  ctx.fillRect(0, 0, 4, size);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(0, 4, size, 2);
  ctx.fillRect(4, 0, 2, size);
  return toTexture(c);
}

/** Near-white detail noise to multiply over vertex colours (grass, sand, lots). */
export function detailTexture(): THREE.CanvasTexture {
  const size = 512;
  const [c, ctx] = canvas(size);
  const rng = new Rng('detail');
  const n = fbmTile(rng, size, 6, 4);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 205 + (n[i] - 0.5) * 70 + (rng.next() - 0.5) * 34;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c);
}

/** Cast concrete for structures and curbs, with faint form-work lines and streaks. */
export function concreteTexture(): THREE.CanvasTexture {
  const size = 512;
  const [c, ctx] = canvas(size);
  const rng = new Rng('concrete');
  const n = fbmTile(rng, size, 6, 3);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const y = Math.floor(i / size);
    const streak = Math.sin((i % size) * 0.05 + n[i] * 6) * 4;
    const v = 172 + (n[i] - 0.5) * 40 + (rng.next() - 0.5) * 12 + streak - (y % 128 < 2 ? 18 : 0);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v * 0.985;
    img.data[i * 4 + 2] = v * 0.95;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c);
}

/** Tileable ripple normal map for water (tangent space, linear). */
export function waterNormalTexture(): THREE.CanvasTexture {
  const size = 512;
  const [c, ctx] = canvas(size);
  const rng = new Rng('water');
  const hgt = fbmTile(rng, size, 5, 8);
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number): number => hgt[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 6;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 6;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, false);
}
