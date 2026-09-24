// Parked cars: along curbs with parking lanes, in surface parking lots, and in
// suburban driveways. Pure data (struct of arrays).
import { minAreaRect } from '../geom';
import { Rng } from '../rng';
import type { DistrictId } from '../types';
import { VEHICLE_TYPES, type VehicleType } from '../vehicles/carModels';
import { LandModel } from './land';
import type { WorldData } from './world';

export interface ParkedCars {
  count: number;
  type: Uint8Array;
  pos: Float32Array;
  /** Rotation about +Y turning the model's forward (-Z) to the car's heading. */
  yaw: Float32Array;
  /** Index into PAINT_COLORS (255 = type colour, e.g. taxi yellow). */
  color: Uint8Array;
}

const OCCUPANCY: Partial<Record<DistrictId, number>> = {
  downtown: 0.82, beach: 0.86, littleSolano: 0.74, northside: 0.45, palmHeights: 0.22, harbor: 0.3,
};

function pickType(rng: Rng, district: DistrictId): VehicleType {
  const w: Record<VehicleType, number> = {
    sedan: 34, hatch: 12, suv: 26, pickup: district === 'northside' || district === 'palmHeights' ? 16 : 8,
    minivan: 8, taxi: district === 'downtown' || district === 'beach' ? 6 : 0.5, police: 0.4,
    bus: 0, boxTruck: district === 'downtown' || district === 'northside' || district === 'littleSolano' ? 2 : 0.3,
  };
  const types = VEHICLE_TYPES.filter((t) => w[t] > 0);
  return rng.weighted(types, types.map((t) => w[t]));
}

export function buildParking(world: WorldData, paintCount: number): ParkedCars {
  const rng = new Rng(world.seed).fork('parking');
  const model = new LandModel(world.seed);
  const t = world.terrain;
  const ground = (x: number, z: number): number => {
    const i = Math.max(0, Math.min(t.n - 1, Math.round((x - t.origin) / t.res)));
    const j = Math.max(0, Math.min(t.n - 1, Math.round((z - t.origin) / t.res)));
    return Math.max(0.3, t.height[j * t.n + i]);
  };
  const out: { type: VehicleType; x: number; y: number; z: number; yaw: number; color: number }[] = [];
  const add = (type: VehicleType, x: number, y: number, z: number, hx: number, hz: number): void => {
    // Heading (hx, hz) -> yaw turning -Z to it.
    const yaw = Math.atan2(-hx, -hz);
    const color = type === 'taxi' || type === 'police' || type === 'bus' ? 255 : rng.int(0, paintCount - 1);
    out.push({ type, x, y, z, yaw, color });
  };

  const { nodes, edges } = world.roads;
  // Curbside parking on streets with parking lanes, both sides.
  for (let e = 0; e < edges.length; e++) {
    const E = edges[e];
    if (E.cls !== 'street' || E.bridge || E.width < 10.5) continue;
    const a = nodes[E.a];
    const b = nodes[E.b];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 8) continue;
    const dx = (b.x - a.x) / len;
    const dz = (b.z - a.z) / len;
    const district = model.districtAt((a.x + b.x) / 2, (a.z + b.z) / 2);
    const occ = OCCUPANCY[district] ?? 0;
    if (occ === 0) continue;
    // Keep clear of intersections at both ends.
    const clearA = nodes[E.a].edges.length >= 3 ? 14 : 2;
    const clearB = nodes[E.b].edges.length >= 3 ? 14 : 2;
    const offset = E.width / 2 - 1.15;
    for (const side of [1, -1]) {
      // Right-hand traffic: cars on the right of (dx, dz) face along it.
      const nx = -dz * side;
      const nz = dx * side;
      const hx = side === -1 ? dx : -dx;
      const hz = side === -1 ? dz : -dz;
      for (let d = clearA + 3.2; d < len - clearB - 3.2; d += 6.4) {
        if (!rng.chance(occ)) continue;
        const x = a.x + dx * d + nx * offset;
        const z = a.z + dz * d + nz * offset;
        add(pickType(rng, district), x + dx * rng.range(-0.3, 0.3), ground(x, z), z + dz * rng.range(-0.3, 0.3), hx, hz);
      }
    }
  }

  // Surface parking lots: rows of 2.6 m stalls with 7 m aisles.
  for (const lot of world.lots) {
    if (lot.use !== 'parking') continue;
    const r = minAreaRect(lot.polygon);
    const lotRng = new Rng(lot.seed).fork('cars');
    const ax = r.axis.x;
    const az = r.axis.z;
    const px = -az;
    const pz = ax;
    const occ = lot.district === 'downtown' ? 0.7 : 0.5;
    // Double rows (two stall depths + aisle = 18 m) across the short side.
    for (let v = -r.halfShort + 5.5; v + 2.7 < r.halfShort; v += 18) {
      for (const facing of [1, -1]) {
        const row = v + (facing === 1 ? 0 : 5.6);
        if (Math.abs(row) > r.halfShort - 2.8) continue;
        for (let u = -r.halfLong + 2.5; u < r.halfLong - 2.5; u += 2.6) {
          if (!lotRng.chance(occ)) continue;
          const x = r.center.x + ax * u + px * row;
          const z = r.center.z + az * u + pz * row;
          add(pickType(lotRng, lot.district), x, lot.groundY + 0.15, z, px * facing, pz * facing);
        }
      }
    }
  }

  // Suburban driveways: one car in front of about half the houses.
  for (const lot of world.lots) {
    if (lot.use !== 'residential' || (lot.district !== 'palmHeights' && lot.district !== 'islands')) continue;
    const lrng = new Rng(lot.seed).fork('driveway');
    if (!lrng.chance(0.55)) continue;
    const fi = lot.frontage.findIndex(Boolean);
    if (fi < 0) continue;
    const a = lot.polygon[fi];
    const b = lot.polygon[(fi + 1) % lot.polygon.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 12) continue;
    const ix = -(b.z - a.z) / len;
    const iz = (b.x - a.x) / len;
    const u = 0.18 * len + 1.5;
    const x = a.x + ((b.x - a.x) / len) * u + ix * 3.6;
    const z = a.z + ((b.z - a.z) / len) * u + iz * 3.6;
    // Parked nose-in, facing the house.
    add(pickType(lrng, lot.district), x, lot.groundY + 0.15, z, ix, iz);
  }

  const count = out.length;
  const res: ParkedCars = { count, type: new Uint8Array(count), pos: new Float32Array(count * 3), yaw: new Float32Array(count), color: new Uint8Array(count) };
  out.forEach((c, i) => {
    res.type[i] = VEHICLE_TYPES.indexOf(c.type);
    res.pos.set([c.x, c.y, c.z], i * 3);
    res.yaw[i] = c.yaw;
    res.color[i] = c.color;
  });
  return res;
}
