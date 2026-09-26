// Procedural noise for the texture engine, in TSL (runs on the GPU, WebGPU or WebGL 2).
//
// Everything here is periodic: evaluated over a texture's 0..1 UV square with integer periods,
// the result tiles seamlessly, so baked textures can repeat across a street without seams.
//
//   psrdnoise2   periodic simplex noise with its analytic gradient (Gustavson & McEwan 2022,
//                "Tiling simplex noise and flow noise in two and three dimensions", JCGT 11(1)),
//                so normal maps come from exact derivatives rather than finite differences
//   fbm          fractional Brownian motion: octaves of psrdnoise2, value and gradient
//   worley       periodic Worley (cellular / Voronoi) noise: distances to the nearest and second
//                nearest feature points, and a random id for the nearest cell
//   hash21/22    sine-free hashes (Hoskins, "Hash without Sine"), identical on every GPU
import { Fn, cos, dot, float, floor, fract, max, min, mod, select, sin, sqrt, step, vec2, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';

export type F = Node<'float'>;
export type V2 = Node<'vec2'>;
export type V3 = Node<'vec3'>;
export type V4 = Node<'vec4'>;

/** A random number in [0, 1) for a 2D lattice point. */
export const hash21 = Fn(([p]: [V2]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'hash21', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] }) as unknown as (p: V2) => F;

/** Two random numbers in [0, 1) for a 2D lattice point. */
export const hash22 = Fn(([p]: [V2]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(vec2(p3.x.add(p3.y), p3.x.add(p3.z)).mul(p3.zy));
}).setLayout({ name: 'hash22', type: 'vec2', inputs: [{ name: 'p', type: 'vec2' }] }) as unknown as (p: V2) => V2;

/**
 * Periodic 2D simplex noise with analytic derivatives. Returns (value in about [-1, 1], d/dx,
 * d/dy). `period` must be even integers; `alpha` rotates the gradients (flow noise).
 */
export const psrdnoise2 = Fn(([x, period, alpha]: [V2, V2, F]) => {
  // Skew to the simplex grid and find the three corners of the triangle we are in.
  const uv = vec2(x.x.add(x.y.mul(0.5)), x.y);
  const i0 = floor(uv);
  const f0 = fract(uv);
  const cmp = step(f0.y, f0.x);
  const o1 = vec2(cmp, float(1).sub(cmp));
  const v0 = vec2(i0.x.sub(i0.y.mul(0.5)), i0.y);
  const v1 = vec2(v0.x.add(o1.x).sub(o1.y.mul(0.5)), v0.y.add(o1.y));
  const v2 = vec2(v0.x.add(0.5), v0.y.add(1));
  const x0 = x.sub(v0);
  const x1 = x.sub(v1);
  const x2 = x.sub(v2);
  // Wrap the corners to the period, back in simplex space (rounding fixes float error).
  const xw = mod(vec3(v0.x, v1.x, v2.x), period.x);
  const yw = mod(vec3(v0.y, v1.y, v2.y), period.y);
  const iu = floor(xw.add(yw.mul(0.5)).add(0.5));
  const iv = floor(yw.add(0.5));
  // Permutation-polynomial hash → gradient angle per corner.
  const h0 = mod(iu, 289);
  const h1 = mod(h0.mul(51).add(2).mul(h0).add(iv), 289);
  const h2 = mod(h1.mul(34).add(10).mul(h1), 289);
  const psi = h2.mul(0.07482).add(alpha);
  const gx = cos(psi);
  const gy = sin(psi);
  const g0 = vec2(gx.x, gy.x);
  const g1 = vec2(gx.y, gy.y);
  const g2 = vec2(gx.z, gy.z);
  // Radial falloff from each corner, and the ramps.
  const w = max(vec3(0.8).sub(vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2))), 0);
  const w2 = w.mul(w);
  const w4 = w2.mul(w2);
  const gdotx = vec3(dot(g0, x0), dot(g1, x1), dot(g2, x2));
  const n = dot(w4, gdotx);
  const dw = w2.mul(w).mul(gdotx).mul(-8);
  const dn = g0.mul(w4.x).add(x0.mul(dw.x)).add(g1.mul(w4.y)).add(x1.mul(dw.y)).add(g2.mul(w4.z)).add(x2.mul(dw.z));
  return vec3(n, dn.x, dn.y).mul(10.9);
}).setLayout({
  name: 'psrdnoise2',
  type: 'vec3',
  inputs: [
    { name: 'x', type: 'vec2' },
    { name: 'period', type: 'vec2' },
    { name: 'alpha', type: 'float' },
  ],
}) as unknown as (x: V2, period: V2, alpha: F | number) => V3;

export interface FbmOptions {
  /** Cells across the tile for the first octave, per axis (even integers). */
  period: [number, number];
  octaves: number;
  /** Amplitude falloff per octave (0.5 = pink noise). */
  gain?: number;
  /** Rotates the gradients of every octave: a seed. */
  seed?: number;
}

/**
 * Fractional Brownian motion over the tile's UV square: value (about [-1, 1]) and its gradient
 * with respect to UV. Each octave doubles the period, so the sum tiles.
 */
export function fbm(uv: V2, { period, octaves, gain = 0.5, seed = 0 }: FbmOptions): V3 {
  let sum: V3 = vec3(0);
  let amp = 1;
  let norm = 0;
  for (let k = 0; k < octaves; k++) {
    const fx = period[0] * 2 ** k;
    const fy = period[1] * 2 ** k;
    const n = psrdnoise2(uv.mul(vec2(fx, fy)), vec2(fx, fy), seed * 1.618 + k * 2.39);
    // Chain rule: d/duv = d/dx · frequency.
    sum = sum.add(vec3(n.x, n.y.mul(fx), n.z.mul(fy)).mul(amp));
    norm += amp;
    amp *= gain;
  }
  return sum.div(norm);
}

/**
 * Periodic Worley noise at `p` (in cells; `period` cells across the tile): (F1, F2, id, 0) where
 * F1/F2 are distances to the nearest and second-nearest feature points in cell units and id is
 * a random number for the nearest cell. `jitter` 0..1 moves feature points off the cell centres.
 */
export const worley = Fn(([p, period, jitter, seed]: [V2, V2, F, F]) => {
  const i = floor(p);
  const f = fract(p);
  const f1 = float(8).toVar();
  const f2 = float(8).toVar();
  const id = float(0).toVar();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const offset = vec2(dx, dy);
      const cell = mod(i.add(offset), period).add(seed.mul(vec2(17.13, 31.71)));
      const r = hash22(cell);
      const v = offset.add(r.sub(0.5).mul(jitter).add(0.5)).sub(f);
      const d = dot(v, v);
      const nearer = d.lessThan(f1);
      f2.assign(min(f2, max(f1, d)));
      id.assign(select(nearer, hash21(cell.add(7.7)), id));
      f1.assign(min(f1, d));
    }
  }
  return vec4(sqrt(f1), sqrt(f2), id, 0);
}).setLayout({
  name: 'worley',
  type: 'vec4',
  inputs: [
    { name: 'p', type: 'vec2' },
    { name: 'period', type: 'vec2' },
    { name: 'jitter', type: 'float' },
    { name: 'seed', type: 'float' },
  ],
}) as unknown as (p: V2, period: V2, jitter: F | number, seed: F | number) => V4;

/** Worley noise over the tile's UV square with `cells` cells across (per axis). */
export function worleyTile(uv: V2, cells: [number, number], jitter = 1, seed = 0): V4 {
  return worley(uv.mul(vec2(cells[0], cells[1])), vec2(cells[0], cells[1]), jitter, seed);
}
