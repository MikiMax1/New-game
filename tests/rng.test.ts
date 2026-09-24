import { describe, expect, it } from 'vitest';
import { Rng, hash01, hashString } from '../src/world/rng';
import { MeshBuilder } from '../src/world/mesh/meshData';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('differs between seeds and stays in [0, 1)', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 1000; i++) {
      const x = a.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      if (x === b.next()) same++;
    }
    expect(same).toBeLessThan(5);
  });

  it('forks independent, stable streams', () => {
    const a = new Rng(7).fork('roads').next();
    const b = new Rng(7).fork('roads').next();
    const c = new Rng(7).fork('lots').next();
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('hashes consistently', () => {
    expect(hashString('solmar')).toBe(hashString('solmar'));
    expect(hash01(1, 2, 3)).toBe(hash01(1, 2, 3));
    expect(hash01(1, 2, 3)).not.toBe(hash01(3, 2, 1));
  });
});

describe('MeshBuilder', () => {
  it('keeps colours aligned when coloured vertices start mid-mesh', () => {
    const m = new MeshBuilder();
    m.vertex(0, 0, 0, 0, 1, 0);
    m.vertex(1, 0, 0, 0, 1, 0, 0, 0, [1, 0, 0]);
    m.vertex(0, 0, 1, 0, 1, 0);
    m.tri(0, 1, 2);
    const d = m.build();
    expect(d.colors).toBeDefined();
    expect(d.colors!.length).toBe(9);
    expect(Array.from(d.colors!.slice(3, 6))).toEqual([1, 0, 0]);
  });
});
