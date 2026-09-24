import * as THREE from 'three';
import type { Traffic } from '../sim/traffic';
import { VEHICLE_TYPES, buildVehicleModel } from '../world/vehicles/carModels';
import { LIVERY, PAINT_COLORS } from '../world/vehicles/paint';
import { toBufferGeometry } from './meshConvert';
import { createVehicleMaterials } from './vehicleMaterials';

/** Draws moving traffic with one InstancedMesh per vehicle type and part. */
export class TrafficRenderer {
  private readonly meshes: { type: number; mesh: THREE.InstancedMesh; tint: boolean }[] = [];
  private readonly lights: THREE.MeshStandardMaterial[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly c = new THREE.Color();
  private readonly paints = PAINT_COLORS.map((h) => new THREE.Color(h));
  private readonly liveries = VEHICLE_TYPES.map((t) => new THREE.Color(LIVERY[t] ?? 0xffffff));

  constructor(scene: THREE.Scene, private readonly traffic: Traffic, capacity: number) {
    const mats = createVehicleMaterials();
    // Traffic has its lights on at night (separate materials from parked cars).
    for (const k of ['headlight', 'taillight'] as const) {
      const mat = (mats.get(k) as THREE.MeshStandardMaterial).clone();
      mats.set(k, mat);
      this.lights.push(mat);
    }
    const group = new THREE.Group();
    group.name = 'traffic';
    VEHICLE_TYPES.forEach((type, ti) => {
      const model = buildVehicleModel(type);
      for (const [part, data] of model.parts) {
        const mesh = new THREE.InstancedMesh(toBufferGeometry(data), mats.get(part)!, capacity);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = part === 'paint' || part === 'glass';
        mesh.receiveShadow = true;
        const tint = part === 'paint';
        if (tint) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        group.add(mesh);
        this.meshes.push({ type: ti, mesh, tint });
      }
    });
    scene.add(group);
  }

  update(night: number): void {
    const byType: number[][] = VEHICLE_TYPES.map(() => []);
    this.traffic.cars.forEach((car, i) => byType[car.type].push(i));
    for (const { type, mesh, tint } of this.meshes) {
      const list = byType[type];
      const n = Math.min(list.length, mesh.instanceMatrix.count);
      for (let k = 0; k < n; k++) {
        const car = this.traffic.cars[list[k]];
        this.p.set(car.x, car.y, car.z);
        this.q.setFromAxisAngle(this.up, car.yaw);
        this.m.compose(this.p, this.q, this.one);
        mesh.setMatrixAt(k, this.m);
        if (tint) {
          const t = VEHICLE_TYPES[car.type];
          this.c.copy(LIVERY[t] ? this.liveries[car.type] : this.paints[car.color % this.paints.length]);
          mesh.setColorAt(k, this.c);
        }
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    const glow = 0.15 + night * 6;
    for (const l of this.lights) l.emissiveIntensity = glow;
  }
}
