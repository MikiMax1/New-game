import { beforeAll, describe, expect, it } from 'vitest';
import { generateWorld, type WorldData } from '../src/world/gen/world';
import { signedArea } from '../src/world/geom';
import { MAP_HALF } from '../src/world/config';

let world: WorldData;

beforeAll(() => {
  world = generateWorld(1);
  console.log('timings (ms)', world.timings);
  console.log('stats', world.stats);
});

describe('world generation', () => {
  it('produces a city-sized road network', () => {
    expect(world.stats.roadKm).toBeGreaterThan(80);
    expect(world.stats.lots).toBeGreaterThan(3000);
  });

  it('has no zero-length or duplicate road edges', () => {
    const seen = new Set<string>();
    for (const e of world.roads.edges) {
      const a = world.roads.nodes[e.a];
      const b = world.roads.nodes[e.b];
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.2);
      const key = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('keeps every road inside the map', () => {
    for (const n of world.roads.nodes) {
      expect(Math.abs(n.x)).toBeLessThanOrEqual(MAP_HALF + 1);
      expect(Math.abs(n.z)).toBeLessThanOrEqual(MAP_HALF + 1);
    }
  });

  it('is one connected network', () => {
    const { nodes, edges } = world.roads;
    const seen = new Uint8Array(nodes.length);
    const stack = [0];
    seen[0] = 1;
    let count = 0;
    while (stack.length) {
      const n = stack.pop()!;
      count++;
      for (const e of nodes[n].edges) {
        const o = edges[e].a === n ? edges[e].b : edges[e].a;
        if (!seen[o]) {
          seen[o] = 1;
          stack.push(o);
        }
      }
    }
    expect(count).toBe(nodes.length);
  });

  it('has no crossing road edges (planar graph)', () => {
    const { nodes, edges } = world.roads;
    const cell = 50;
    const grid = new Map<string, number[]>();
    edges.forEach((e, i) => {
      const a = nodes[e.a];
      const b = nodes[e.b];
      for (let cx = Math.floor(Math.min(a.x, b.x) / cell); cx <= Math.floor(Math.max(a.x, b.x) / cell); cx++)
        for (let cz = Math.floor(Math.min(a.z, b.z) / cell); cz <= Math.floor(Math.max(a.z, b.z) / cell); cz++) {
          const k = `${cx},${cz}`;
          (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
        }
    });
    let crossings = 0;
    for (const list of grid.values()) {
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const e1 = edges[list[i]];
          const e2 = edges[list[j]];
          if (e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b) continue;
          const p = nodes[e1.a], q = nodes[e1.b], r = nodes[e2.a], s = nodes[e2.b];
          const d = (q.x - p.x) * (s.z - r.z) - (q.z - p.z) * (s.x - r.x);
          if (Math.abs(d) < 1e-9) continue;
          const t = ((r.x - p.x) * (s.z - r.z) - (r.z - p.z) * (s.x - r.x)) / d;
          const u = ((r.x - p.x) * (q.z - p.z) - (r.z - p.z) * (q.x - p.x)) / d;
          if (t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999) crossings++;
        }
    }
    expect(crossings).toBe(0);
  });

  it('makes lots with positive winding, frontage flags and sane heights', () => {
    let withFrontage = 0;
    for (const lot of world.lots) {
      expect(signedArea(lot.polygon)).toBeGreaterThan(0);
      expect(lot.frontage.length).toBe(lot.polygon.length);
      expect(lot.heightHint).toBeGreaterThanOrEqual(0);
      expect(lot.heightHint).toBeLessThan(300);
      if (lot.frontage.some(Boolean)) withFrontage++;
    }
    expect(withFrontage / world.lots.length).toBeGreaterThan(0.85);
  });

  it('is deterministic', () => {
    const again = generateWorld(1);
    expect(again.stats).toEqual(world.stats);
    expect(again.lots[100].polygon).toEqual(world.lots[100].polygon);
  });
});
