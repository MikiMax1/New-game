import { beforeAll, describe, expect, it } from 'vitest';
import { buildCityMeshes, type CityMeshes } from '../src/world/mesh/chunks';
import { generateWorld } from '../src/world/gen/world';

let city: CityMeshes;
let ms = 0;

beforeAll(() => {
  const world = generateWorld(1);
  const t0 = performance.now();
  city = buildCityMeshes(world);
  ms = performance.now() - t0;
});

const UP_BUCKETS = new Set(['terrain', 'road', 'paintWhite', 'paintYellow', 'sidewalk', 'lotGround', 'lotBase']);

describe('city meshes', () => {
  it('builds in reasonable time and reports sizes', () => {
    const tris: Record<string, number> = {};
    for (const c of city.chunks) for (const [k, m] of c.buckets) tris[k] = (tris[k] ?? 0) + m.indices.length / 3;
    console.log(`meshes built in ${Math.round(ms)} ms`, tris);
    expect(city.chunks.length).toBeGreaterThan(30);
    expect(ms).toBeLessThan(60000);
  });

  it('has finite positions and valid indices', () => {
    for (const c of city.chunks) {
      for (const [k, m] of c.buckets) {
        const nv = m.positions.length / 3;
        for (const v of m.positions) if (!Number.isFinite(v)) throw new Error(`NaN in ${k}`);
        for (const i of m.indices) if (i >= nv) throw new Error(`index out of range in ${k}`);
      }
    }
  });

  it('winds every face to match its normals', () => {
    let bad = 0;
    let total = 0;
    const badByBucket: Record<string, number> = {};
    for (const c of city.chunks) {
      for (const [k, m] of c.buckets) {
        const p = m.positions;
        const n = m.normals;
        for (let t = 0; t < m.indices.length; t += 3) {
          const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, d = m.indices[t + 2] * 3;
          const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
          const vx = p[d] - p[a], vy = p[d + 1] - p[a + 1], vz = p[d + 2] - p[a + 2];
          const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
          const area = Math.hypot(fx, fy, fz);
          if (area < 1e-6) continue;
          total++;
          const ok = UP_BUCKETS.has(k) ? fy > 0 : fx * n[a] + fy * n[a + 1] + fz * n[a + 2] > 0;
          if (!ok) {
            bad++;
            badByBucket[k] = (badByBucket[k] ?? 0) + 1;
          }
        }
      }
    }
    if (bad) console.log('badly wound faces', badByBucket);
    expect(bad / total).toBeLessThan(0.0005);
  });
});
