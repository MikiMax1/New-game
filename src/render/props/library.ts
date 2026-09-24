// The prop library: every prop id with its variants as BufferGeometry parts, plus the shared
// materials. Build it once (per detail level) and instance from it.

import * as THREE from 'three';
import { toBufferGeometry } from '../meshConvert';
import { buildPropModelData, propVariantCount } from '../../world/props/catalog';
import { PROP_IDS, type PropId, type PropModelData } from '../../world/props/types';
import { createPropMaterials } from './materials';

export interface PropPart {
  materialKey: string;
  geometry: THREE.BufferGeometry;
  castShadow: boolean;
}

export interface PropLight {
  /** Model-space position of the emitter. */
  position: THREE.Vector3;
  /** Linear RGB. */
  color: THREE.Color;
  /** Candela (three.js physical units for PointLight / SpotLight intensity). */
  intensity: number;
  kind: 'street' | 'signal' | 'sign';
}

export interface PropModel {
  id: PropId;
  /** Index into models.get(id). */
  variant: number;
  parts: PropPart[];
  /** Horizontal radius (m) around the model's Y axis containing all geometry. */
  radius: number;
  /** Height (m) of the highest vertex above the base. */
  height: number;
  /** Light emitters in model space for night lighting (street lights, signals, lit panels). */
  lights?: PropLight[];
  /** Named attachment points in model space (e.g. utility-pole wire insulators). */
  anchors?: { name: string; position: THREE.Vector3 }[];
  /** Total triangles over all parts. */
  triangles: number;
}

export interface PropLibrary {
  models: Map<PropId, PropModel[]>;
  materials: Map<string, THREE.Material>;
}

export function propModelFromData(d: PropModelData): PropModel {
  let triangles = 0;
  const parts: PropPart[] = d.parts.map((p) => {
    const geometry = toBufferGeometry(p.mesh);
    geometry.name = `prop:${d.id}:${d.variant}:${p.materialKey}`;
    triangles += p.mesh.indices.length / 3;
    return { materialKey: p.materialKey, geometry, castShadow: p.castShadow };
  });
  const model: PropModel = { id: d.id, variant: d.variant, parts, radius: d.radius, height: d.height, triangles };
  if (d.lights) {
    model.lights = d.lights.map((l) => ({
      position: new THREE.Vector3(...l.position),
      color: new THREE.Color(l.color[0], l.color[1], l.color[2]),
      intensity: l.intensity,
      kind: l.kind,
    }));
  }
  if (d.anchors) model.anchors = d.anchors.map((a) => ({ name: a.name, position: new THREE.Vector3(...a.position) }));
  return model;
}

/**
 * Build every prop and its variants.
 * @param opts.detail  tessellation scale (1 = default budgets; ~0.5 for a far LOD set)
 * @param opts.materials  reuse the materials (and textures) of another library, e.g. for LODs
 */
export function createPropLibrary(opts: { detail?: number; materials?: Map<string, THREE.Material> } = {}): PropLibrary {
  const detail = opts.detail ?? 1;
  const materials = opts.materials ?? createPropMaterials();
  const models = new Map<PropId, PropModel[]>();
  for (const id of PROP_IDS) {
    const n = propVariantCount(id);
    if (n === 0) continue;
    const list: PropModel[] = [];
    for (let v = 0; v < n; v++) list.push(propModelFromData(buildPropModelData(id, v, detail)));
    models.set(id, list);
  }
  return { models, materials };
}
