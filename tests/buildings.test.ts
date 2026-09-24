import { describe, expect, it } from 'vitest';
import { BUILDING_DETAIL_KEY, BUILDING_FACADE_KEY, DETAIL_ATTRS, FACADE_ATTRS, generateBuilding } from '../src/world/buildings';
import { distToRing, pointInRing } from '../src/world/buildings/geom';
import { degenerateLots, sampleLayout } from '../src/world/buildings/samples';
import { BucketBuilder, type MeshBuckets, type MeshData } from '../src/world/mesh/meshData';
import type { Lot } from '../src/world/types';

const layout = sampleLayout(1);
const layout2 = sampleLayout(2);
const lots = [...layout.lots, ...layout2.lots];

function build(lot: Lot, lod: 0 | 1): { buckets: MeshBuckets; info: ReturnType<typeof generateBuilding> } {
  const out = new BucketBuilder();
  const info = generateBuilding(lot, out, lod);
  return { buckets: out.build(), info };
}

function checkMesh(m: MeshData, key: string): void {
  const n = m.positions.length / 3;
  expect(m.normals.length).toBe(n * 3);
  expect(m.uvs.length).toBe(n * 2);
  expect(m.colors?.length).toBe(n * 3);
  const attrs = key === BUILDING_FACADE_KEY ? FACADE_ATTRS : DETAIL_ATTRS;
  for (const [name, size] of Object.entries(attrs)) {
    expect(m.extra?.[name]?.itemSize).toBe(size);
    expect(m.extra?.[name]?.array.length).toBe(n * size);
    for (const v of m.extra![name].array) expect(Number.isFinite(v)).toBe(true);
  }
  expect(m.indices.length % 3).toBe(0);
  for (const i of m.indices) expect(i).toBeLessThan(n);
  for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
  for (const v of m.uvs) expect(Number.isFinite(v)).toBe(true);
  for (const v of m.colors!) {
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1.0001);
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]);
    expect(Math.abs(l - 1)).toBeLessThan(1e-3);
  }
}

/** Triangle budgets per style at lod 0 (upper bounds). */
const BUDGET: Record<string, number> = {
  'office-tower': 1200, 'condo-tower': 1200, 'hotel-tower': 1200, 'beach-condo': 1200,
  'deco-hotel': 450, 'deco-shop': 350, 'mimo-hotel': 600,
  'stucco-shop': 300, 'small-house': 400, 'garden-apartments': 400, kiosk: 120,
  'med-house': 400, 'med-mansion': 500, 'modern-mansion': 450,
  warehouse: 250, 'harbor-shed': 250, 'strip-mall': 400,
  'port-office': 300, civic: 350, 'old-midrise': 400, 'modern-midrise': 400, 'old-lowrise': 350, 'modern-lowrise': 350, 'parking-garage': 300,
  shack: 250, 'bait-shop': 300, trailer: 150, 'surface-parking': 20,
};

describe('generateBuilding', () => {
  it('builds every sample lot with a known style', () => {
    const styles = new Set<string>();
    for (const lot of lots) {
      const { info } = build(lot, 0);
      expect(info.style).not.toBe('error');
      expect(info.style).not.toBe('none');
      expect(info.triangles).toBeGreaterThan(0);
      expect(BUDGET[info.style], `budget for ${info.style}`).toBeDefined();
      styles.add(info.style);
    }
    for (const s of ['office-tower', 'deco-hotel', 'stucco-shop', 'med-house', 'warehouse', 'strip-mall', 'mimo-hotel', 'shack', 'trailer', 'bait-shop', 'harbor-shed', 'port-office']) {
      expect(styles.has(s), `style ${s} present`).toBe(true);
    }
  });

  it('is deterministic', () => {
    for (const lot of lots.slice(0, 40)) {
      for (const lod of [0, 1] as const) {
        const a = build(lot, lod).buckets;
        const b = build(lot, lod).buckets;
        expect([...a.keys()]).toEqual([...b.keys()]);
        for (const [k, m] of a) {
          const o = b.get(k)!;
          expect(Array.from(o.positions)).toEqual(Array.from(m.positions));
          expect(Array.from(o.indices)).toEqual(Array.from(m.indices));
          for (const name of Object.keys(m.extra ?? {})) expect(Array.from(o.extra![name].array)).toEqual(Array.from(m.extra![name].array));
        }
      }
    }
  });

  it('produces valid meshes at both LODs', () => {
    for (const lot of lots) {
      for (const lod of [0, 1] as const) {
        const { buckets } = build(lot, lod);
        for (const [k, m] of buckets) {
          expect([BUILDING_FACADE_KEY, BUILDING_DETAIL_KEY]).toContain(k);
          checkMesh(m, k);
        }
      }
    }
  });

  it('stays inside the lot (1.5 m slack for eaves and awnings)', () => {
    for (const lot of lots) {
      for (const lod of [0, 1] as const) {
        const { buckets, info } = build(lot, lod);
        let worst = 0;
        for (const m of buckets.values()) {
          for (let i = 0; i < m.positions.length; i += 3) {
            const p = { x: m.positions[i], z: m.positions[i + 2] };
            if (!pointInRing(p, lot.polygon)) worst = Math.max(worst, distToRing(p, lot.polygon));
          }
        }
        expect(worst, `lot ${lot.id} ${info.style} lod ${lod}`).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it('respects triangle budgets', () => {
    for (const lot of lots) {
      const lod0 = build(lot, 0).info;
      expect(lod0.triangles, `${lod0.style} lod0`).toBeLessThanOrEqual(BUDGET[lod0.style] ?? 400);
      const lod1 = build(lot, 1).info;
      expect(lod1.triangles, `${lod1.style} lod1 (lot ${lot.id})`).toBeLessThanOrEqual(64);
      expect(lod1.triangles).toBeLessThanOrEqual(lod0.triangles);
    }
  });

  it('keeps volumes and colours identical between LODs', () => {
    for (const lot of lots) {
      const a = build(lot, 0).info;
      const b = build(lot, 1).info;
      expect(b.style).toBe(a.style);
      expect(b.floors).toBe(a.floors);
      expect(b.height).toBeCloseTo(a.height, 6);
    }
  });

  it('lays facade u along cross(up, normal) in metres', () => {
    for (const lot of lots.slice(0, 60)) {
      const m = build(lot, 0).buckets.get(BUILDING_FACADE_KEY);
      if (!m) continue;
      for (let t = 0; t < m.indices.length; t += 3) {
        const ids = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
        for (let a = 0; a < 3; a++) {
          const i = ids[a];
          const j = ids[(a + 1) % 3];
          const dy = m.positions[j * 3 + 1] - m.positions[i * 3 + 1];
          const dx = m.positions[j * 3] - m.positions[i * 3];
          const dz = m.positions[j * 3 + 2] - m.positions[i * 3 + 2];
          if (Math.abs(dy) > 1e-5 || Math.hypot(dx, dz) < 1e-3) continue;
          const nx = (m.normals[i * 3] + m.normals[j * 3]) / 2;
          const nz = (m.normals[i * 3 + 2] + m.normals[j * 3 + 2]) / 2;
          const tl = Math.hypot(nz, nx);
          const s = (dx * nz - dz * nx) / tl; // distance along T = (nz, -nx)
          const du = m.uvs[j * 2] - m.uvs[i * 2];
          expect(Math.abs(du - s)).toBeLessThan(0.02 * Math.max(1, Math.abs(s)));
        }
      }
    }
  });

  it('reports useful info', () => {
    for (const lot of lots) {
      const { info } = build(lot, 0);
      if (info.style === 'surface-parking') continue;
      expect(info.height).toBeGreaterThan(2);
      expect(info.floors).toBeGreaterThanOrEqual(1);
      expect(info.topY).toBeGreaterThanOrEqual(info.roofY - 1e-6);
      expect(info.footprint.length).toBeGreaterThanOrEqual(3);
      for (const e of info.entrances) {
        const p = { x: e.x, z: e.z };
        expect(pointInRing(p, lot.polygon) || distToRing(p, lot.polygon) < 1.5).toBe(true);
        expect(Math.hypot(e.nx, e.nz)).toBeCloseTo(1, 3);
      }
    }
  });

  it('handles degenerate lots without throwing', () => {
    for (const lot of degenerateLots()) {
      for (const lod of [0, 1] as const) {
        let res: ReturnType<typeof build> | null = null;
        expect(() => {
          res = build(lot, lod);
        }).not.toThrow();
        const r = res as unknown as ReturnType<typeof build>;
        expect(r.info.style).not.toBe('error');
        for (const [k, m] of r.buckets) checkMesh(m, k);
      }
    }
  });

  it('generates a chunk worth of buildings quickly', () => {
    const t0 = performance.now();
    const out = new BucketBuilder();
    let tris = 0;
    for (const lot of layout.lots) tris += generateBuilding(lot, out, 0).triangles;
    out.build();
    const ms = performance.now() - t0;
    // ~60 varied buildings (towers included); generous bound for slow CI machines
    expect(ms).toBeLessThan(1500);
    expect(tris).toBeGreaterThan(1000);
  });
});
