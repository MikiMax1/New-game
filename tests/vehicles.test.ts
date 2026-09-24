import { describe, expect, it } from 'vitest';
import { VEHICLE_TYPES, buildVehicleModel } from '../src/world/vehicles/carModels';

describe('vehicle models', () => {
  for (const type of VEHICLE_TYPES) {
    it(`${type}: valid geometry within budget`, () => {
      const m = buildVehicleModel(type);
      let tris = 0;
      for (const [, d] of m.parts) {
        const nv = d.positions.length / 3;
        for (const v of d.positions) expect(Number.isFinite(v)).toBe(true);
        for (const i of d.indices) expect(i).toBeLessThan(nv);
        tris += d.indices.length / 3;
      }
      // Side panels must face outward: sample the body side at mid length.
      const paint = m.parts.get('paint')!;
      const p = paint.positions;
      let outward = 0;
      let checked = 0;
      for (let t = 0; t < paint.indices.length; t += 3) {
        const a = paint.indices[t] * 3, b = paint.indices[t + 1] * 3, c = paint.indices[t + 2] * 3;
        const cx = (p[a] + p[b] + p[c]) / 3;
        const cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
        if (Math.abs(Math.abs(cx) - m.width / 2) > 0.003 || Math.abs(cz) > m.length / 4) continue;
        const uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        const vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        const nx = uy * vz - uz * vy;
        checked++;
        if (nx * cx > 0) outward++;
      }
      expect(checked).toBeGreaterThan(0);
      expect(outward).toBe(checked);
      expect(tris).toBeLessThan(type === 'bus' ? 2600 : 1800);
    });
  }
});
