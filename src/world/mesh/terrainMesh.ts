// Terrain tiles: a height grid with land-cover colours (sand, dune grass, lawns, marsh,
// seabed by depth). Triangles hidden under pavement are dropped.
import type { NoiseFunction2D } from 'simplex-noise';
import { SHORE_TYPES } from '../gen/terrain';
import type { WorldData } from '../gen/world';
import type { Heights } from './heights';
import type { MeshBuilder } from './meshData';

type RGB = [number, number, number];

export function terrainColor(world: WorldData, k: number, x: number, z: number, noise: NoiseFunction2D): RGB {
  const t = world.terrain;
  const sd = t.shoreDist[k];
  const hgt = t.height[k];
  const type = SHORE_TYPES[t.shoreType[k]];
  const n1 = noise(x / 37, z / 37);
  const n2 = noise(x / 211 + 40, z / 211 - 17);
  const mix = (a: RGB, b: RGB, f: number): RGB => {
    const q = Math.max(0, Math.min(1, f));
    return [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q, a[2] + (b[2] - a[2]) * q];
  };
  if (sd < 0) {
    // Seabed: bright sand in the shallows, seagrass and silt deeper.
    const depth = -hgt;
    const sand: RGB = [0.72, 0.66, 0.5];
    const grass: RGB = [0.26, 0.32, 0.22];
    const deep: RGB = [0.14, 0.2, 0.22];
    let c = mix(sand, grass, (depth - 1.2) / 3 + n2 * 0.25);
    c = mix(c, deep, (depth - 5) / 10);
    if (type === 'marsh') c = mix(c, [0.2, 0.2, 0.12], 0.6);
    return c;
  }
  const sandC: RGB = [0.8, 0.74, 0.58];
  const wetSand: RGB = [0.58, 0.53, 0.41];
  const grassC: RGB = [0.28, 0.4, 0.16];
  const dryGrass: RGB = [0.46, 0.44, 0.26];
  const marshC: RGB = [0.34, 0.38, 0.2];
  const mud: RGB = [0.26, 0.24, 0.17];
  let c = mix(grassC, dryGrass, 0.35 + 0.35 * n2 + 0.2 * n1);
  if (type === 'beach') {
    if (sd < 78) c = mix(wetSand, sandC, sd / 8 + n1 * 0.2);
    else c = mix(sandC, mix(c, dryGrass, 0.5), (sd - 78) / 30 + n1 * 0.3);
  } else if (type === 'marsh') {
    c = mix(marshC, mud, 0.3 + 0.4 * n1 - Math.min(1, sd / 40) * 0.3);
  } else if (type === 'natural' && sd < 18) {
    c = mix(mud, c, sd / 18);
  } else if (sd < 3) {
    c = mix(mud, c, sd / 3);
  }
  return c;
}

/** Builds the terrain for one square tile [x0, x0 + size] x [z0, z0 + size]. */
export function buildTerrainTile(world: WorldData, h: Heights, x0: number, z0: number, size: number, noise: NoiseFunction2D, out: MeshBuilder): void {
  const t = world.terrain;
  const n = t.n;
  const res = t.res;
  const i0 = Math.round((x0 - t.origin) / res);
  const j0 = Math.round((z0 - t.origin) / res);
  const cells = Math.round(size / res);
  // Deep open water far from shore can use a coarse grid.
  let minSd = Infinity;
  for (let j = j0; j <= Math.min(n - 1, j0 + cells); j += 4) for (let i = i0; i <= Math.min(n - 1, i0 + cells); i += 4) minSd = Math.min(minSd, -t.shoreDist[j * n + i]);
  const step = minSd > 80 ? 8 : 1;
  const count = Math.floor(cells / step) + 1;
  const ids = new Int32Array(count * count);
  const d = h.display;
  for (let jj = 0; jj < count; jj++) {
    const j = Math.min(n - 1, j0 + jj * step);
    for (let ii = 0; ii < count; ii++) {
      const i = Math.min(n - 1, i0 + ii * step);
      const k = j * n + i;
      const x = t.origin + i * res;
      const z = t.origin + j * res;
      const il = Math.max(0, i - 1);
      const ir = Math.min(n - 1, i + 1);
      const jd = Math.max(0, j - 1);
      const ju = Math.min(n - 1, j + 1);
      const hx = (d[j * n + ir] - d[j * n + il]) / ((ir - il) * res);
      const hz = (d[ju * n + i] - d[jd * n + i]) / ((ju - jd) * res);
      const l = Math.hypot(hx, 1, hz);
      ids[jj * count + ii] = out.vertex(x, d[k], z, -hx / l, 1 / l, -hz / l, x / 12, z / 12, terrainColor(world, k, x, z, noise));
    }
  }
  const covered = h.covered;
  for (let jj = 0; jj + 1 < count; jj++) {
    for (let ii = 0; ii + 1 < count; ii++) {
      const ka = (Math.min(n - 1, j0 + jj * step)) * n + Math.min(n - 1, i0 + ii * step);
      const kb = ka + step;
      const kc = ka + step * n;
      const kd = kc + step;
      // Skip cells fully hidden under roads and sidewalks.
      if (step === 1 && covered[ka] && covered[kb] && covered[kc] && covered[kd]) continue;
      const a = ids[jj * count + ii];
      const b = ids[jj * count + ii + 1];
      const c = ids[(jj + 1) * count + ii];
      const e = ids[(jj + 1) * count + ii + 1];
      // (a, c, e) and (a, e, b) face up (x right, z down).
      out.tri(a, c, e);
      out.tri(a, e, b);
    }
  }
}
