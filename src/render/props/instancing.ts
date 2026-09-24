// Helpers to put library props into a scene: InstancedMesh groups for many placements, or
// plain meshes for a single prop. Both wire up customDepthMaterial so wind-animated
// vegetation casts swaying shadows.

import * as THREE from 'three';
import type { PropId } from '../../world/props/types';
import type { PropLibrary, PropModel } from './library';
import { getPropDepthMaterial } from './materials';

export interface PropPlacement {
  id: PropId;
  /** Variant index (wrapped to the available count). */
  variant?: number;
  x: number;
  y: number;
  z: number;
  /**
   * Rotation about +Y in radians. yaw = 0 keeps the model facing -Z; yaw = PI/2 turns it to
   * face -X. Use yawToFace(dx, dz) to face a direction.
   */
  yaw?: number;
  /** Uniform scale (default 1). Small variations (0.85-1.15) help vegetation look varied. */
  scale?: number;
  /** Optional per-instance tint, multiplied with the vertex colours (InstancedMesh.setColorAt). */
  color?: THREE.ColorRepresentation;
}

/** Yaw that turns a model's -Z facing towards the world direction (dx, dz). */
export function yawToFace(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export function placementMatrix(p: PropPlacement, target = new THREE.Matrix4()): THREE.Matrix4 {
  _q.setFromAxisAngle(_up, p.yaw ?? 0);
  _s.setScalar(p.scale ?? 1);
  _p.set(p.x, p.y, p.z);
  return target.compose(_p, _q, _s);
}

function modelFor(lib: PropLibrary, id: PropId, variant: number): PropModel | undefined {
  const list = lib.models.get(id);
  if (!list || list.length === 0) return undefined;
  return list[((variant % list.length) + list.length) % list.length];
}

/**
 * One InstancedMesh per (prop, variant, part) for all placements. Returns a Group; its
 * children are named `${id}#${variant}:${materialKey}`.
 */
export function createPropInstances(
  lib: PropLibrary,
  placements: readonly PropPlacement[],
  opts: { castShadow?: boolean; receiveShadow?: boolean } = {},
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'props';
  const buckets = new Map<string, PropPlacement[]>();
  for (const p of placements) {
    const model = modelFor(lib, p.id, p.variant ?? 0);
    if (!model) continue;
    const key = `${p.id}#${model.variant}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(p);
  }
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  for (const [key, list] of buckets) {
    const model = modelFor(lib, list[0].id, list[0].variant ?? 0)!;
    const tinted = list.some((p) => p.color !== undefined);
    for (const part of model.parts) {
      const material = lib.materials.get(part.materialKey);
      if (!material) continue;
      const mesh = new THREE.InstancedMesh(part.geometry, material, list.length);
      mesh.name = `${key}:${part.materialKey}`;
      list.forEach((p, i) => {
        mesh.setMatrixAt(i, placementMatrix(p, m));
        if (tinted) mesh.setColorAt(i, c.set(p.color ?? 0xffffff));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = part.castShadow && (opts.castShadow ?? true);
      mesh.receiveShadow = opts.receiveShadow ?? true;
      const depth = getPropDepthMaterial(material);
      if (depth) mesh.customDepthMaterial = depth;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  return group;
}

/** A single prop as plain meshes (same materials, depth materials wired up). */
export function createPropObject(lib: PropLibrary, id: PropId, variant = 0): THREE.Group {
  const group = new THREE.Group();
  const model = modelFor(lib, id, variant);
  if (!model) return group;
  group.name = `${id}#${model.variant}`;
  for (const part of model.parts) {
    const material = lib.materials.get(part.materialKey);
    if (!material) continue;
    const mesh = new THREE.Mesh(part.geometry, material);
    mesh.name = part.materialKey;
    mesh.castShadow = part.castShadow;
    mesh.receiveShadow = true;
    const depth = getPropDepthMaterial(material);
    if (depth) mesh.customDepthMaterial = depth;
    group.add(mesh);
  }
  return group;
}
