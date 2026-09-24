import * as THREE from 'three';
import { hashString } from '../../world/rng';

// Tiling noise for the cloud layer, generated once on the CPU from a fixed seed.
//   R: smooth fBm (weather: where clouds cluster)
//   G: inverted Worley cells + fBm (one cumulus per cell)
//   B: medium fBm (cauliflower detail)
//   A: fine cells + fBm (small puffs)
// Every channel is histogram-equalised, so its values are uniformly distributed in [0, 1]:
// a threshold t on a channel covers exactly (1 - t) of the sky, which makes the coverage
// setting predictable.

const SEED = hashString('solmar-clouds');

/** Small integer hash (lowbias32) of a lattice point, to [0, 1). */
function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const wrap = (i: number, p: number) => ((i % p) + p) % p;

/** Periodic 2D gradient noise in about [-0.7, 0.7]; `period` in lattice cells. */
function gradientNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const x0 = wrap(xi, period);
  const y0 = wrap(yi, period);
  const x1 = wrap(xi + 1, period);
  const y1 = wrap(yi + 1, period);
  const g = (px: number, py: number, dx: number, dy: number) => {
    const a = hash2(px, py, seed) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const a = g(x0, y0, xf, yf) + u * (g(x1, y0, xf - 1, yf) - g(x0, y0, xf, yf));
  const b = g(x0, y1, xf, yf - 1) + u * (g(x1, y1, xf - 1, yf - 1) - g(x0, y1, xf, yf - 1));
  return a + v * (b - a);
}

function fbm(x: number, y: number, period: number, octaves: number, seed: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * gradientNoise(x * f, y * f, period * f, seed + o * 101);
    amp *= gain;
    f *= 2;
  }
  return sum;
}

/** Periodic Worley F1 distance in cells. */
function worley(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let best = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const px = wrap(cx, period);
      const py = wrap(cy, period);
      const dx = cx + 0.15 + 0.7 * hash2(px, py, seed) - x;
      const dy = cy + 0.15 + 0.7 * hash2(px, py, seed ^ 0x9e37) - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

/** Replace values by their rank / count: a uniform distribution with the same ordering. */
function equalize(values: Float32Array): Uint8Array {
  const n = values.length;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => values[a] - values[b]);
  const out = new Uint8Array(n);
  for (let r = 0; r < n; r++) out[order[r]] = Math.min(255, Math.floor((r / n) * 256));
  return out;
}

export function createCloudNoiseTexture(size = 256): THREE.DataTexture {
  const n = size * size;
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = y * size + x;
      ch[0][i] = fbm(u * 4, v * 4, 4, 4, SEED);
      ch[1][i] = (1 - worley(u * 6, v * 6, 6, SEED + 11)) + 0.35 * fbm(u * 12, v * 12, 12, 3, SEED + 23);
      ch[2][i] = fbm(u * 8, v * 8, 8, 4, SEED + 47);
      ch[3][i] = (1 - worley(u * 16, v * 16, 16, SEED + 59)) * 0.7 + fbm(u * 16, v * 16, 16, 2, SEED + 71) * 0.4;
    }
  }
  const eq = ch.map(equalize);
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = eq[0][i];
    data[i * 4 + 1] = eq[1][i];
    data[i * 4 + 2] = eq[2][i];
    data[i * 4 + 3] = eq[3][i];
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = 'Atmosphere.CloudNoise';
  tex.needsUpdate = true;
  return tex;
}

/**
 * Threshold t such that the field 0.7 * G + 0.3 * R (two independent uniform variables) exceeds
 * t over a fraction `coverage` of the sky.
 */
export function cloudThreshold(coverage: number): number {
  const c = Math.max(0, Math.min(1, coverage));
  const a = 0.7;
  const b = 0.3;
  // P(X > t) for X = aU + bV: piecewise (triangular corners, linear middle).
  const cornerMass = (b * b) / (2 * a * b); // mass of each corner region = b / (2a)
  if (c <= cornerMass) return 1 - Math.sqrt(2 * a * b * c);
  if (c >= 1 - cornerMass) return Math.sqrt(2 * a * b * (1 - c));
  return (1 - c) * a + b / 2;
}
