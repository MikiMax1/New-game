// Turns chunk mesh data into three.js meshes with the city's ground materials,
// plus the sea surface.
import * as THREE from 'three';
import type { CityMeshes } from '../world/mesh/chunks';
import { toBufferGeometry } from './meshConvert';
import { asphaltTexture, concreteTexture, detailTexture, slabTexture, waterNormalTexture } from './textures';
import { createWaterMaterial, farWaterGeometry, type WaterMaterial } from './waterMaterial';
import { MAP_HALF } from '../world/config';

interface BucketStyle {
  material: THREE.Material;
  castShadow: boolean;
  receiveShadow: boolean;
  /** Draw order (lower first). */
  order: number;
  /** Hide beyond this distance from the camera to the chunk (m); small details go first. */
  maxDistance: number;
}

/** Per-bucket draw distances, scaled by the quality preset's detail factor. */
const DRAW_DISTANCE: Record<string, number> = {
  paintWhite: 650,
  paintYellow: 650,
  curb: 1000,
  seawall: 1600,
  lotGround: 1600,
  lotBase: 2200,
  sidewalk: 2200,
};

export class CityRenderer {
  readonly root = new THREE.Group();
  readonly materials = new Map<string, BucketStyle>();
  private readonly lodMeshes: { mesh: THREE.Mesh; centre: THREE.Vector3; radius: number; maxDistance: number; minDistance: number }[] = [];
  /** Distance where '@lod0' buckets hand over to '@lod1' (m). */
  lodSwitch = 650;
  /** Multiplies all draw distances (quality preset). */
  detail = 1;
  private readonly water: THREE.Mesh;
  private readonly waterNormal: THREE.Texture;
  private readonly waterMat: WaterMaterial;
  private time = 0;

  constructor(scene: THREE.Scene, city: CityMeshes) {
    this.root.name = 'city';
    const asphalt = asphaltTexture();
    const slab = slabTexture();
    const detail = detailTexture();
    const concrete = concreteTexture();
    this.waterNormal = waterNormalTexture();
    this.waterMat = createWaterMaterial(this.waterNormal);

    const std = (params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial(params);
    const paint = (color: number): THREE.MeshStandardMaterial =>
      std({ color, roughness: 0.62, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const set = (key: string, material: THREE.Material, castShadow: boolean, receiveShadow: boolean, order = 0): void => {
      material.name = key;
      this.materials.set(key, { material, castShadow, receiveShadow, order, maxDistance: DRAW_DISTANCE[key] ?? Infinity });
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
    set('water', this.waterMat.material, false, true, 10);
    set('structure', std({ map: detail, vertexColors: true, roughness: 0.55, metalness: 0.15 }), true, true, 1);
    set('glass', std({ color: 0x1d2b33, roughness: 0.06, metalness: 0.9 }), true, true, 1);
    set('lamp', new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffe2a0, emissiveIntensity: 2.5, roughness: 0.4 }), false, false, 1);

    for (const chunk of city.chunks) {
      const group = new THREE.Group();
      group.name = `chunk ${chunk.i},${chunk.j}`;
      for (const [bucketKey, data] of chunk.buckets) {
        // Keys may carry a level of detail: 'facade@lod0' near, 'facade@lod1' far.
        const [key, lodTag] = bucketKey.split('@');
        const style = this.materials.get(key);
        if (!style) continue;
        const geom = toBufferGeometry(data);
        const needsColor = (style.material as THREE.MeshStandardMaterial).vertexColors;
        if (needsColor && !geom.getAttribute('color')) {
          geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(data.positions.length).fill(1), 3));
        }
        const mesh = new THREE.Mesh(geom, style.material);
        mesh.name = bucketKey;
        mesh.castShadow = style.castShadow;
        mesh.receiveShadow = style.receiveShadow;
        mesh.renderOrder = style.order;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        group.add(mesh);
        const near = lodTag === 'lod0';
        const far = lodTag === 'lod1';
        if (Number.isFinite(style.maxDistance) || near || far) {
          const sphere = geom.boundingSphere!;
          this.lodMeshes.push({
            mesh,
            centre: sphere.center.clone(),
            radius: sphere.radius,
            maxDistance: near ? -1 : style.maxDistance,
            minDistance: far ? -1 : 0,
          });
        }
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

    // Open sea around the map; the map's own water comes from the chunk meshes.
    this.water = new THREE.Mesh(farWaterGeometry(MAP_HALF, 14000), this.waterMat.material);
    this.water.name = 'sea';
    this.water.renderOrder = 10;
    this.water.receiveShadow = true;
    this.water.matrixAutoUpdate = false;
    scene.add(this.water);
  }

  update(dt: number, camera?: THREE.Camera): void {
    this.time += dt;
    this.waterMat.update(this.time);
    if (camera) {
      const p = camera.position;
      for (const l of this.lodMeshes) {
        // Distance from the camera to the nearest point of the mesh's bounding sphere.
        const d = Math.max(0, p.distanceTo(l.centre) - l.radius);
        const toCentre = p.distanceTo(l.centre);
        if (l.maxDistance === -1) l.mesh.visible = toCentre < this.lodSwitch * this.detail + l.radius * 0.5; // near LOD
        else if (l.minDistance === -1) l.mesh.visible = toCentre >= this.lodSwitch * this.detail + l.radius * 0.5; // far LOD
        else l.mesh.visible = d < l.maxDistance * this.detail;
      }
    }
  }

  /** All materials, e.g. for shadow/fog registration by the atmosphere module. */
  allMaterials(): THREE.Material[] {
    return [...[...this.materials.values()].map((s) => s.material), this.water.material as THREE.Material];
  }
}
