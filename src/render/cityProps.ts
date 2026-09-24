// Street props and vegetation at the dressing placements: every prop near the camera
// at full detail, and palms and oaks further out at half detail so the skyline keeps
// its trees. Both streams share materials (wind sway, night lamps, signal lenses).
import * as THREE from 'three';
import { PROP_KINDS, type Dressing } from '../world/gen/dressing';
import { InstanceStreamer, type StreamModel } from './instanceStreamer';
import { createPropLibrary, getPropDepthMaterial, updatePropMaterials, type PropId, type PropLibrary } from './props';

const MAX_VARIANTS = 4;
const TREES = new Set<string>(['palmRoyal', 'palmCoconut', 'palmSabal', 'liveOak']);

function streamModels(lib: PropLibrary, include: (kind: string) => boolean, shadows: boolean): StreamModel[] {
  const models: StreamModel[] = [];
  for (const kind of PROP_KINDS) {
    const variants = include(kind) ? lib.models.get(kind as PropId) ?? [] : [];
    for (let v = 0; v < MAX_VARIANTS; v++) {
      const m = variants.length ? variants[v % variants.length] : null;
      models.push({
        parts: m
          ? m.parts.map((part) => {
              const material = lib.materials.get(part.materialKey)!;
              return { geometry: part.geometry, material, castShadow: shadows && part.castShadow, depthMaterial: getPropDepthMaterial(material) };
            })
          : [],
      });
    }
  }
  return models;
}

export class CityProps {
  readonly near: InstanceStreamer;
  readonly far: InstanceStreamer;
  private readonly lib: PropLibrary;
  private readonly wind = { direction: new THREE.Vector2(-1, 0.25), strength: 0.55 };

  constructor(scene: THREE.Scene, dressing: Dressing, detail: number) {
    this.lib = createPropLibrary({ detail: 1 });
    const farLib = createPropLibrary({ detail: 0.5, materials: this.lib.materials });
    const source = {
      count: dressing.count,
      pos: dressing.pos,
      yaw: dressing.yaw,
      scale: dressing.scale,
      model: (i: number) => dressing.kind[i] * MAX_VARIANTS + (dressing.variant[i] % MAX_VARIANTS),
    };
    this.near = new InstanceStreamer(scene, streamModels(this.lib, () => true, true), source, 1, 20);
    this.far = new InstanceStreamer(scene, streamModels(farLib, (k) => TREES.has(k), false), source, 1, 60);
    this.setDetail(detail);
  }

  setDetail(detail: number): void {
    this.near.radius = 320 * detail;
    this.far.innerRadius = this.near.radius;
    this.far.radius = 1100 * detail;
    this.near.invalidate();
    this.far.invalidate();
  }

  update(camera: THREE.Camera, time: number, night: number): void {
    this.near.update(camera);
    this.far.update(camera);
    updatePropMaterials(this.lib.materials, time, this.wind, night);
  }
}
