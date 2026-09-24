import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildPropModelData, propVariantCount } from '../src/world/props/catalog';
import { MATERIAL_INFO, MATERIAL_KEYS, PROP_IDS, type PropId, type PropModelData } from '../src/world/props/types';
import { createPropLibrary, updatePropMaterials } from '../src/render/props';

/** Triangle budget per model variant at detail = 1. */
const BUDGET: Record<PropId, [number, number]> = {
  palmRoyal: [400, 1200],
  palmCoconut: [400, 1200],
  palmSabal: [400, 1200],
  liveOak: [800, 2000],
  shrub: [40, 400],
  hedge: [20, 300],
  grassClump: [6, 80],
  streetLightCobra: [20, 300],
  streetLightDeco: [20, 300],
  trafficSignalMast: [20, 300],
  pedSignal: [20, 300],
  stopSign: [20, 300],
  streetNameSign: [20, 300],
  fireHydrant: [20, 300],
  bench: [20, 300],
  trashCan: [20, 300],
  busShelter: [20, 300],
  newspaperBox: [20, 300],
  parkingMeter: [20, 300],
  utilityPole: [20, 300],
  lifeguardTower: [20, 300],
  beachUmbrella: [20, 300],
  lounger: [20, 300],
  bollard: [20, 300],
  acUnit: [20, 300],
  dumpster: [20, 300],
};

/** Real-world envelope of each prop: [min height, max height, max radius] in metres. */
const REAL: Record<PropId, [number, number, number]> = {
  palmRoyal: [15, 25, 5.5],
  palmCoconut: [8, 17, 9],
  palmSabal: [6, 13, 4],
  liveOak: [10, 16, 13.5],
  shrub: [0.6, 2.2, 1.6],
  hedge: [0.8, 2.2, 2.0],
  grassClump: [0.25, 1.4, 0.8],
  streetLightCobra: [8.5, 11, 3.5],
  streetLightDeco: [3.8, 5.2, 1.0],
  trafficSignalMast: [6, 8.5, 12.8],
  pedSignal: [2.5, 3.6, 0.6],
  stopSign: [2.4, 3.2, 0.6],
  streetNameSign: [2.8, 4.2, 0.9],
  fireHydrant: [0.65, 0.95, 0.45],
  bench: [0.4, 1.0, 1.2],
  trashCan: [0.8, 1.3, 0.6],
  busShelter: [2.4, 3.2, 2.6],
  newspaperBox: [0.9, 1.3, 0.5],
  parkingMeter: [1.2, 1.9, 0.5],
  utilityPole: [10.5, 13.5, 2.3],
  lifeguardTower: [3.5, 5.5, 6.5],
  beachUmbrella: [2.0, 2.8, 1.4],
  lounger: [0.3, 1.1, 1.1],
  bollard: [0.6, 1.2, 0.25],
  acUnit: [0.6, 1.6, 1.3],
  dumpster: [1.2, 1.9, 1.3],
};

const models: PropModelData[] = [];
for (const id of PROP_IDS) {
  const n = propVariantCount(id);
  for (let v = 0; v < n; v++) models.push(buildPropModelData(id, v));
}

function tris(m: PropModelData): number {
  return m.parts.reduce((s, p) => s + p.mesh.indices.length / 3, 0);
}

describe('prop catalog', () => {
  it('has 2-4 variants for every prop id', () => {
    for (const id of PROP_IDS) {
      const n = propVariantCount(id);
      expect(n, id).toBeGreaterThanOrEqual(2);
      expect(n, id).toBeLessThanOrEqual(4);
    }
  });

  it('is deterministic', () => {
    for (const id of PROP_IDS) {
      const a = buildPropModelData(id, 1);
      const b = buildPropModelData(id, 1);
      expect(a.parts.length).toBe(b.parts.length);
      a.parts.forEach((p, i) => {
        expect(Array.from(p.mesh.positions)).toEqual(Array.from(b.parts[i].mesh.positions));
      });
    }
  });

  it('prints a triangle report', () => {
    const lines = models.map((m) => `${m.id}#${m.variant}: ${tris(m)} tris, r ${m.radius} m, h ${m.height} m, parts ${m.parts.map((p) => p.materialKey).join('+')}`);
    console.log(lines.join('\n'));
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe.each(models.map((m) => [`${m.id}#${m.variant}`, m] as const))('%s', (_name, m) => {
  it('has valid geometry', () => {
    expect(m.parts.length).toBeGreaterThan(0);
    for (const p of m.parts) {
      const { positions, normals, uvs, indices, colors } = p.mesh;
      const n = positions.length / 3;
      expect(MATERIAL_KEYS).toContain(p.materialKey);
      expect(normals.length).toBe(positions.length);
      expect(uvs.length).toBe(n * 2);
      expect(colors, 'vertex colours').toBeDefined();
      expect(colors!.length).toBe(positions.length);
      expect(indices.length % 3).toBe(0);
      expect(indices.length).toBeGreaterThan(0);
      for (const a of [positions, normals, uvs, colors!]) for (const x of a) expect(Number.isFinite(x)).toBe(true);
      for (const i of indices) expect(i).toBeLessThan(n);
      for (let i = 0; i < normals.length; i += 3) {
        const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
        expect(Math.abs(l - 1)).toBeLessThan(1e-3);
      }
      const info = MATERIAL_INFO[p.materialKey];
      if (info.wind) {
        const w = p.mesh.extra?.aWind;
        expect(w, 'aWind').toBeDefined();
        expect(w!.itemSize).toBe(4);
        expect(w!.array.length).toBe(n * 4);
        for (const x of w!.array) expect(Number.isFinite(x)).toBe(true);
        // Sway never exceeds a metre and is zero at ground level.
        for (let i = 0; i < n; i++) {
          expect(w!.array[i * 4]).toBeGreaterThanOrEqual(0);
          expect(w!.array[i * 4]).toBeLessThan(1);
          if (positions[i * 3 + 1] < 0.05) expect(w!.array[i * 4]).toBeLessThan(0.01);
        }
      }
      if (info.signal) expect(p.mesh.extra?.aSignal?.itemSize).toBe(1);
    }
  });

  it('fits its declared radius and height, sitting on the ground', () => {
    let minY = Infinity, maxY = -Infinity, maxR = 0;
    for (const p of m.parts) {
      const a = p.mesh.positions;
      for (let i = 0; i < a.length; i += 3) {
        minY = Math.min(minY, a[i + 1]);
        maxY = Math.max(maxY, a[i + 1]);
        maxR = Math.max(maxR, Math.hypot(a[i], a[i + 2]));
      }
    }
    expect(maxR).toBeLessThanOrEqual(m.radius + 1e-6);
    expect(maxY).toBeLessThanOrEqual(m.height + 1e-6);
    expect(minY).toBeGreaterThanOrEqual(-0.3);
    expect(minY).toBeLessThan(0.25);
    const [hMin, hMax, rMax] = REAL[m.id];
    expect(m.height, 'real-world height').toBeGreaterThanOrEqual(hMin);
    expect(m.height, 'real-world height').toBeLessThanOrEqual(hMax);
    expect(m.radius, 'real-world radius').toBeLessThanOrEqual(rMax);
  });

  it('respects its triangle budget', () => {
    const [lo, hi] = BUDGET[m.id];
    const t = tris(m);
    expect(t).toBeGreaterThanOrEqual(lo);
    expect(t).toBeLessThanOrEqual(hi);
  });

  it('winds opaque faces consistently with their normals', () => {
    let bad = 0, total = 0;
    for (const p of m.parts) {
      // Leaf cards are double-sided with bent normals; skip them.
      if (p.materialKey === 'palmLeaf' || p.materialKey === 'oakLeaf') continue;
      const { positions: P, normals: N, indices: I } = p.mesh;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
      for (let i = 0; i < I.length; i += 3) {
        a.fromArray(P, I[i] * 3);
        b.fromArray(P, I[i + 1] * 3);
        c.fromArray(P, I[i + 2] * 3);
        const f = b.sub(a).cross(c.sub(a));
        if (f.lengthSq() < 1e-12) continue;
        n.fromArray(N, I[i] * 3).add(new THREE.Vector3().fromArray(N, I[i + 1] * 3)).add(new THREE.Vector3().fromArray(N, I[i + 2] * 3));
        total++;
        if (f.dot(n) <= 0) bad++;
      }
    }
    expect(bad, `${bad} of ${total} triangles face against their normals`).toBeLessThanOrEqual(total * 0.02);
  });
});

describe('lower detail', () => {
  it('never adds triangles', () => {
    for (const id of PROP_IDS) {
      for (let v = 0; v < propVariantCount(id); v++) {
        expect(tris(buildPropModelData(id, v, 0.5)), `${id}#${v}`).toBeLessThanOrEqual(tris(buildPropModelData(id, v, 1)));
      }
    }
  });
});

describe('lights', () => {
  it('street lights and signals declare emitters inside their bounds', () => {
    for (const id of ['streetLightCobra', 'streetLightDeco', 'trafficSignalMast', 'pedSignal'] as PropId[]) {
      for (let v = 0; v < propVariantCount(id); v++) {
        const m = buildPropModelData(id, v);
        expect(m.lights?.length, `${id}#${v}`).toBeGreaterThan(0);
        for (const l of m.lights!) {
          expect(l.position[1]).toBeGreaterThan(0.5);
          expect(l.position[1]).toBeLessThanOrEqual(m.height);
          expect(Math.hypot(l.position[0], l.position[2])).toBeLessThanOrEqual(m.radius);
          expect(l.intensity).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('createPropLibrary (node, no canvas)', () => {
  const lib = createPropLibrary();
  it('builds every prop with materials for every part', () => {
    for (const id of PROP_IDS) {
      const list = lib.models.get(id);
      expect(list, id).toBeDefined();
      expect(list!.length).toBe(propVariantCount(id));
      for (const model of list!) {
        for (const part of model.parts) {
          expect(lib.materials.has(part.materialKey), part.materialKey).toBe(true);
          expect(part.geometry.getAttribute('position').count).toBeGreaterThan(0);
          expect(part.geometry.getAttribute('color')).toBeDefined();
          if (MATERIAL_INFO[part.materialKey as keyof typeof MATERIAL_INFO].wind) expect(part.geometry.getAttribute('aWind')).toBeDefined();
        }
      }
    }
  });

  it('shares one material per key, with depth materials for wind materials', () => {
    expect(lib.materials.size).toBe(MATERIAL_KEYS.length);
    for (const key of MATERIAL_KEYS) {
      const m = lib.materials.get(key)!;
      expect(m.customProgramCacheKey()).toContain(MATERIAL_INFO[key].wind ? 'propWind' : '');
      if (MATERIAL_INFO[key].wind) expect((m.userData as { depthMaterial?: THREE.Material }).depthMaterial).toBeInstanceOf(THREE.Material);
    }
  });

  it('updates wind and night uniforms', () => {
    updatePropMaterials(lib.materials, 12.5, { direction: new THREE.Vector2(3, 4), strength: 0.8 }, 1);
    const u = (lib.materials.get('palmLeaf')!.userData as { propUniforms: { uPropTime: { value: number }; uPropWind: { value: THREE.Vector4 } } }).propUniforms;
    expect(u.uPropTime.value).toBe(12.5);
    expect(u.uPropWind.value.x).toBeCloseTo(0.6);
    expect(u.uPropWind.value.y).toBeCloseTo(0.8);
    expect(u.uPropWind.value.z).toBeCloseTo(0.8);
    expect((lib.materials.get('emissiveLamp') as THREE.MeshStandardMaterial).emissiveIntensity).toBeGreaterThan(1);
    updatePropMaterials(lib.materials, 13, { direction: new THREE.Vector2(1, 0), strength: 0.5 }, 0);
    expect((lib.materials.get('emissiveLamp') as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0);
  });

  it('chains onBeforeCompile patches (another module can wrap them)', () => {
    const m = lib.materials.get('palmLeaf')!;
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
      fragmentShader:
        '#include <common>\nvoid main() {\n#include <normal_fragment_begin>\n#include <alphatest_fragment>\n#include <lights_fragment_begin>\n#include <lights_fragment_end>\n}',
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    let outer = false;
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = function (s, r) {
      prev.call(this, s, r);
      outer = true;
    };
    m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    m.onBeforeCompile = prev;
    expect(outer).toBe(true);
    expect(shader.vertexShader).toContain('propWindOffset');
    expect(shader.vertexShader).toContain('#include <begin_vertex>');
    expect(shader.fragmentShader).toContain('uPropTranslucency');
    expect(shader.uniforms.uPropTime).toBeDefined();
  });
});
