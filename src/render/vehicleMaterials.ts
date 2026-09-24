import * as THREE from 'three';
import type { VehiclePart } from '../world/vehicles/carModels';

/** Materials for vehicle parts. Paint is tinted per instance (instanceColor). */
export function createVehicleMaterials(): Map<VehiclePart, THREE.Material> {
  const m = new Map<VehiclePart, THREE.Material>();
  m.set('paint', new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.07 }));
  m.set('glass', new THREE.MeshPhysicalMaterial({ color: 0x0b1216, metalness: 0.3, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02 }));
  m.set('tyre', new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }));
  m.set('rim', new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.9, roughness: 0.28 }));
  m.set('trim', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 }));
  m.set('headlight', new THREE.MeshStandardMaterial({ color: 0xf4f6f8, emissive: 0xfff4dc, emissiveIntensity: 0.15, roughness: 0.1, metalness: 0.2 }));
  m.set('taillight', new THREE.MeshStandardMaterial({ color: 0x7a0b0b, emissive: 0xff1a10, emissiveIntensity: 0.15, roughness: 0.2 }));
  m.set('chrome', new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.45 }));
  m.set('sign', new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xffc830, emissiveIntensity: 0.4, roughness: 0.4 }));
  for (const [k, mat] of m) mat.name = `vehicle-${k}`;
  return m;
}

export { PAINT_COLORS, LIVERY } from '../world/vehicles/paint';
