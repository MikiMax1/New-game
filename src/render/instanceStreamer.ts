// Draws only the instances near the camera. Items are bucketed in a coarse grid; when
// the camera has moved far enough, the nearby items are re-packed into one
// InstancedMesh per (model, part). Keeps tens of thousands of props and parked cars
// cheap: only a few hundred are ever on the GPU.
import * as THREE from 'three';

export interface StreamPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow: boolean;
  /** Per-instance colour (e.g. car paint). */
  tint?: boolean;
}

export interface StreamModel {
  parts: StreamPart[];
}

export interface StreamSource {
  count: number;
  /** x, y, z per item. */
  pos: Float32Array;
  yaw: Float32Array;
  scale?: Float32Array;
  /** Model index for item i. */
  model(i: number): number;
  /** Instance colour for tinted parts. */
  color?(i: number, out: THREE.Color): void;
}

const CELL = 64;

export class InstanceStreamer {
  readonly group = new THREE.Group();
  radius: number;
  private readonly grid = new Map<number, number[]>();
  private readonly meshes: (THREE.InstancedMesh | null)[][];
  private readonly last = new THREE.Vector3(Infinity, 0, Infinity);
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly tmpC = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Object3D, private readonly models: StreamModel[], private readonly source: StreamSource, radius: number, private readonly rebuildDistance = 25) {
    this.radius = radius;
    for (let i = 0; i < source.count; i++) {
      const k = key(Math.floor(source.pos[i * 3] / CELL), Math.floor(source.pos[i * 3 + 2] / CELL));
      let list = this.grid.get(k);
      if (!list) this.grid.set(k, (list = []));
      list.push(i);
    }
    this.meshes = models.map((m) => m.parts.map(() => null));
    scene.add(this.group);
  }

  /** Forces a rebuild on the next update (e.g. after changing the radius). */
  invalidate(): void {
    this.last.set(Infinity, 0, Infinity);
  }

  update(camera: THREE.Camera): void {
    const c = camera.position;
    if (Math.hypot(c.x - this.last.x, c.z - this.last.z) < this.rebuildDistance) return;
    this.last.copy(c);
    const r = this.radius;
    const perModel: number[][] = this.models.map(() => []);
    const s = this.source;
    for (let cx = Math.floor((c.x - r) / CELL); cx <= Math.floor((c.x + r) / CELL); cx++) {
      for (let cz = Math.floor((c.z - r) / CELL); cz <= Math.floor((c.z + r) / CELL); cz++) {
        const list = this.grid.get(key(cx, cz));
        if (!list) continue;
        for (const i of list) {
          const dx = s.pos[i * 3] - c.x;
          const dz = s.pos[i * 3 + 2] - c.z;
          if (dx * dx + dz * dz <= r * r) perModel[s.model(i)]?.push(i);
        }
      }
    }
    perModel.forEach((items, mi) => {
      const model = this.models[mi];
      if (!model) return;
      model.parts.forEach((part, pi) => {
        let mesh = this.meshes[mi][pi];
        if (items.length === 0) {
          if (mesh) mesh.count = 0;
          return;
        }
        if (!mesh || mesh.instanceMatrix.count < items.length) {
          if (mesh) {
            this.group.remove(mesh);
            mesh.dispose();
          }
          const capacity = Math.ceil(items.length * 1.5) + 8;
          mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
          mesh.castShadow = part.castShadow;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;
          if (part.tint) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
          this.group.add(mesh);
          this.meshes[mi][pi] = mesh;
        }
        for (let k = 0; k < items.length; k++) {
          const i = items[k];
          this.tmpP.set(s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]);
          this.tmpQ.setFromAxisAngle(this.up, s.yaw[i]);
          const sc = s.scale ? s.scale[i] : 1;
          this.tmpS.set(sc, sc, sc);
          this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
          mesh.setMatrixAt(k, this.tmpM);
          if (part.tint && s.color) {
            s.color(i, this.tmpC);
            mesh.setColorAt(k, this.tmpC);
          }
        }
        mesh.count = items.length;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      });
    });
  }
}

function key(cx: number, cz: number): number {
  return (cx + 2048) * 4096 + (cz + 2048);
}
