import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { Rng } from './rng';

/** Seeded 2D simplex noise in [-1, 1]. */
export function makeNoise(seed: number | string): NoiseFunction2D {
  const rng = new Rng(seed);
  return createNoise2D(() => rng.next());
}

/** Fractal (fBm) noise: `octaves` layers, each at double frequency and `gain` amplitude. */
export function fbm(noise: NoiseFunction2D, x: number, z: number, octaves: number, gain = 0.5, lacunarity = 2): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
