import * as THREE from 'three';
import type { ParkedCars } from '../world/gen/parking';
import { VEHICLE_TYPES, buildVehicleModel } from '../world/vehicles/carModels';
import { LIVERY, PAINT_COLORS } from '../world/vehicles/paint';
import { InstanceStreamer, type StreamModel } from './instanceStreamer';
import { toBufferGeometry } from './meshConvert';
import { createVehicleMaterials } from './vehicleMaterials';

/** Streams parked cars around the camera as instanced vehicle models. */
export function createParkedCars(scene: THREE.Scene, parked: ParkedCars, radius: number): InstanceStreamer {
  const mats = createVehicleMaterials();
  const models: StreamModel[] = VEHICLE_TYPES.map((type) => {
    const m = buildVehicleModel(type);
    return {
      parts: [...m.parts].map(([part, data]) => ({
        geometry: toBufferGeometry(data),
        material: mats.get(part)!,
        castShadow: part === 'paint' || part === 'glass' || part === 'tyre',
        tint: part === 'paint',
      })),
    };
  });
  const paints = PAINT_COLORS.map((h) => new THREE.Color(h));
  const liveries = VEHICLE_TYPES.map((t) => new THREE.Color(LIVERY[t] ?? 0xffffff));
  return new InstanceStreamer(scene, models, {
    count: parked.count,
    pos: parked.pos,
    yaw: parked.yaw,
    model: (i) => parked.type[i],
    color: (i, out) => out.copy(parked.color[i] === 255 ? liveries[parked.type[i]] : paints[parked.color[i]]),
  }, radius);
}
