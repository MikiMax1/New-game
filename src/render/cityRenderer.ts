// Turns chunk mesh data into three.js meshes with the city's ground materials,
// plus the sea surface.
import * as THREE from 'three';
import type { CityMeshes } from '../world/mesh/chunks';
import { toBufferGeometry } from './meshConvert';
import { asphaltTexture, concreteTexture, detailTexture, slabTexture, waterNormalTexture } from './textures';

interface BucketStyle {
  material: THREE.Material;
  castShadow: boolean;
  receiveShadow: boolean;
  /** Draw order (lower first). */
  order: number;
}

export class CityRenderer {
  readonly root = new THREE.Group();
  readonly materials = new Map<string, BucketStyle>();
  private readonly water: THREE.Mesh;
  private readonly waterNormal: THREE.Texture;
  private time = 0;

  constructor(scene: THREE.Scene, city: CityMeshes) {
    this.root.name = 'city';
    const asphalt = asphaltTexture();
    const slab = slabTexture();
    const detail = detailTexture();
    const concrete = concreteTexture();
    this.waterNormal = waterNormalTexture();

    const std = (params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial(params);
    const paint = (color: number): THREE.MeshStandardMaterial =>
      std({ color, roughness: 0.62, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const set = (key: string, material: THREE.Material, castShadow: boolean, receiveShadow: boolean, order = 0): void => {
      material.name = key;
      this.materials.set(key, { material, castShadow, receiveShadow, order });
    };
    set('terrain', std({ map: detail, vertexColors: true, roughness: 0.96 }), false, true, 0);
    set('road', std({ map: asphalt, vertexColors: true, roughness: 0.9 }), false, true, 1);
    set('paintWhite', paint(0xe9e7e0), false, true, 2);
    set('paintYellow', paint(0xe0a92a), false, true, 2);
    set('sidewalk', std({ map: slab, color: 0xd8d4cc, roughness: 0.86 }), false, true, 1);
    set('curb', std({ map: concrete, color: 0xd6d2ca, roughness: 0.8 }), true, true, 1);
    set('seawall', std({ map: concrete, color: 0x8f8a80, roughness: 0.9 }), true, true, 1);
    set('lotBase', std({ map: detail, vertexColors: true, roughness: 0.95 }), false, true, 1);
    set('lotGround', std({ map: detail, vertexColors: true, roughness: 0.93, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), false, true, 2);
    set('concrete', std({ map: concrete, color: 0xcfcac1, roughness: 0.82 }), true, true, 1);

    for (const chunk of city.chunks) {
      const group = new THREE.Group();
      group.name = `chunk ${chunk.i},${chunk.j}`;
      for (const [key, data] of chunk.buckets) {
        const style = this.materials.get(key);
        if (!style) continue;
        const geom = toBufferGeometry(data);
        const needsColor = (style.material as THREE.MeshStandardMaterial).vertexColors;
        if (needsColor && !geom.getAttribute('color')) {
          geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(data.positions.length).fill(1), 3));
        }
        const mesh = new THREE.Mesh(geom, style.material);
        mesh.name = key;
        mesh.castShadow = style.castShadow;
        mesh.receiveShadow = style.receiveShadow;
        mesh.renderOrder = style.order;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        group.add(mesh);
      }
      this.root.add(group);
    }
    // Land and seabed beyond the map edge.
    const farStyle = this.materials.get('terrain')!;
    const far = new THREE.Mesh(toBufferGeometry(city.far), farStyle.material);
    far.name = 'far terrain';
    far.receiveShadow = true;
    far.matrixAutoUpdate = false;
    this.root.add(far);
    scene.add(this.root);

    // Sea surface: one big plane at sea level, larger than the map so the horizon is water.
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0f3c46,
      roughness: 0.06,
      metalness: 0.0,
      normalMap: this.waterNormal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
    });
    this.waterNormal.repeat.set(900, 900);
    const plane = new THREE.PlaneGeometry(24000, 24000, 1, 1).rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(plane, waterMat);
    this.water.name = 'sea';
    this.water.position.y = 0;
    this.water.renderOrder = 5;
    this.water.receiveShadow = true;
    scene.add(this.water);
  }

  update(dt: number): void {
    this.time += dt;
    this.waterNormal.offset.set(this.time * 0.004, this.time * 0.0025);
  }

  /** All materials, e.g. for shadow/fog registration by the atmosphere module. */
  allMaterials(): THREE.Material[] {
    return [...[...this.materials.values()].map((s) => s.material), this.water.material as THREE.Material];
  }
}
