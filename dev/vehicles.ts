// Dev page: every vehicle model in a row, for checking shapes and materials.
import * as THREE from 'three';
import '../src/style.css';
import { Game } from '../src/game';
import { paramNums } from '../src/core/params';
import { toBufferGeometry } from '../src/render/meshConvert';
import { PAINT_COLORS, createVehicleMaterials } from '../src/render/vehicleMaterials';
import { VEHICLE_TYPES, buildVehicleModel } from '../src/world/vehicles/carModels';

const game = new Game(document.getElementById('app')!);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x55575a, roughness: 0.9 }));
ground.receiveShadow = true;
game.scene.add(ground);
const mats = createVehicleMaterials();
const colors: Record<string, number> = { taxi: 0xf2c230, police: 0xf2f2f0, bus: 0xf2f2f0, boxTruck: 0xf2f2f0 };
VEHICLE_TYPES.forEach((type, i) => {
  const model = buildVehicleModel(type);
  const group = new THREE.Group();
  for (const [part, data] of model.parts) {
    const mat = part === 'paint' ? (mats.get('paint') as THREE.MeshPhysicalMaterial).clone() : mats.get(part)!;
    if (part === 'paint') (mat as THREE.MeshPhysicalMaterial).color.setHex(colors[type] ?? PAINT_COLORS[(i * 5) % PAINT_COLORS.length]);
    const mesh = new THREE.Mesh(toBufferGeometry(data), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.position.set((i - (VEHICLE_TYPES.length - 1) / 2) * 4.2, 0, 0);
  group.rotation.y = -0.6;
  game.scene.add(group);
});
if (!paramNums('cam')) game.fly.lookAt(new THREE.Vector3(6, 6, 16), new THREE.Vector3(0, 0.8, 0));
game.start();
game.markReady();
