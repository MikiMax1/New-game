// What every part of the procedural city is built with.
import type { CityMaterials } from './CityMaterials';

export interface CityContext {
  materials: CityMaterials;
  /** Height of the street surface (road or pavement) at (x, z), metres. */
  height(x: number, z: number): number;
  /** Deterministic pseudo-random numbers in [0, 1) (the same city on every run). */
  random(): number;
}

/** A small deterministic PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
