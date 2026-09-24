// Shared prop materials. One MeshStandardMaterial per material key; colour variation comes
// from vertex colours (and optionally InstancedMesh.instanceColor), so all variants of all
// props share these few materials.
//
// Wind materials (palmTrunk, palmLeaf, bark, oakLeaf) get a matching depth material in
// `material.userData.depthMaterial`; set it as `mesh.customDepthMaterial` so shadows sway too
// (createPropInstances / createPropObject do this for you).

import * as THREE from 'three';
import { MATERIAL_INFO, MATERIAL_KEYS, type MaterialKey } from '../../world/props/types';
import { applyEmissiveVertexColor, applyFoliage, applySignal, applyWind, type PropUniforms } from './shaderPatches';
import { createPropTextures, type PropTextures } from './textures';
import { canPaint } from './paint';

export interface PropMaterialUserData {
  propKey: MaterialKey;
  propUniforms: PropUniforms;
  /** Depth material with the same vertex animation, for Mesh.customDepthMaterial. */
  depthMaterial?: THREE.Material;
  /** Emissive intensity by day and by night; updatePropMaterials interpolates with `night`. */
  propEmissive?: { day: number; night: number };
}

export function createPropUniforms(): PropUniforms {
  return {
    uPropTime: { value: 0 },
    uPropWind: { value: new THREE.Vector4(1, 0, 0.5, 0.7) },
    uPropTranslucency: { value: new THREE.Vector2(0.35, 0.9) },
    uPropSignalGain: { value: 9 },
  };
}

export function createPropMaterials(): Map<string, THREE.Material> {
  const u = createPropUniforms();
  const tex: PropTextures | null = canPaint() ? createPropTextures() : null;
  const out = new Map<string, THREE.Material>();
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...p });

  const defs: Record<MaterialKey, () => THREE.MeshStandardMaterial> = {
    palmTrunk: () => std({ map: tex?.palmTrunk ?? null, roughnessMap: tex?.palmTrunkRoughness ?? null, roughness: 1, metalness: 0 }),
    palmLeaf: () => std({ map: tex?.palmLeaf ?? null, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.72, metalness: 0, envMapIntensity: 0.45 }),
    bark: () => std({ map: tex?.bark ?? null, roughness: 0.95, metalness: 0 }),
    oakLeaf: () => std({ map: tex?.foliage ?? null, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, metalness: 0, envMapIntensity: 0.4 }),
    metalGalv: () => std({ color: 0xc9ccce, map: tex?.metal ?? null, metalness: 0.55, roughness: 0.42 }),
    metalPainted: () => std({ map: tex?.grime ?? null, metalness: 0.25, roughness: 0.5 }),
    plastic: () => std({ map: tex?.grime ?? null, metalness: 0, roughness: 0.55 }),
    glass: () =>
      std({ color: 0xa9c2c8, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }),
    concrete: () => std({ map: tex?.concrete ?? null, roughness: 0.93, metalness: 0 }),
    wood: () => std({ map: tex?.wood ?? null, roughness: 0.82, metalness: 0 }),
    fabric: () => std({ map: tex?.fabric ?? null, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }),
    signFace: () => std({ map: tex?.sign ?? null, emissiveMap: tex?.sign ?? null, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.4, metalness: 0.1 }),
    emissiveLamp: () => std({ color: 0xf2f0ea, roughness: 0.22, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0 }),
    signalLens: () => std({ map: tex?.sign ?? null, roughness: 0.2, metalness: 0 }),
    adPanel: () => std({ map: tex?.sign ?? null, emissiveMap: tex?.sign ?? null, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.25, metalness: 0 }),
  };

  for (const key of MATERIAL_KEYS) {
    const m = defs[key]();
    m.name = `prop:${key}`;
    const data: PropMaterialUserData = { propKey: key, propUniforms: u };
    const info = MATERIAL_INFO[key];
    const foliage = key === 'palmLeaf' || key === 'oakLeaf';
    if (info.wind) {
      applyWind(m, u);
      const depth = new THREE.MeshDepthMaterial();
      depth.name = `prop:${key}:depth`;
      applyWind(depth, u);
      if (foliage) applyFoliage(depth, u, true);
      data.depthMaterial = depth;
    }
    if (foliage) applyFoliage(m, u);
    if (key === 'emissiveLamp') {
      applyEmissiveVertexColor(m);
      data.propEmissive = { day: 0, night: 7 };
    }
    if (key === 'signFace') data.propEmissive = { day: 0, night: 0.05 };
    if (key === 'adPanel') data.propEmissive = { day: 0.45, night: 1.1 };
    if (key === 'signalLens') applySignal(m, u);
    m.userData = data as unknown as Record<string, unknown>;
    out.set(key, m);
  }
  return out;
}

/** The depth material to use as `customDepthMaterial` for meshes using `material`, if any. */
export function getPropDepthMaterial(material: THREE.Material): THREE.Material | undefined {
  return (material.userData as Partial<PropMaterialUserData>).depthMaterial;
}

/**
 * Advance wind / signal animation and night lighting for a prop material map.
 * @param timeSeconds  monotonically increasing time (drives sway, flutter and signal cycles)
 * @param wind  direction the wind blows TOWARDS in world XZ (x = +X east, y = +Z south; need not
 *              be normalised) and strength (0 calm, 0.5 breeze, 1 strong breeze, 2 gale)
 * @param night 0 = day, 1 = full night (lamps and back-lit panels glow)
 */
export function updatePropMaterials(
  materials: Map<string, THREE.Material>,
  timeSeconds: number,
  wind: { direction: THREE.Vector2; strength: number },
  night: number,
): void {
  const n = Math.min(1, Math.max(0, night));
  let uniforms: PropUniforms | undefined;
  for (const m of materials.values()) {
    const d = m.userData as Partial<PropMaterialUserData>;
    if (!uniforms && d.propUniforms) uniforms = d.propUniforms;
    if (d.propEmissive && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      (m as THREE.MeshStandardMaterial).emissiveIntensity = d.propEmissive.day + (d.propEmissive.night - d.propEmissive.day) * n;
    }
  }
  if (!uniforms) return;
  uniforms.uPropTime.value = timeSeconds;
  const len = wind.direction.length();
  const dx = len > 1e-6 ? wind.direction.x / len : 1;
  const dz = len > 1e-6 ? wind.direction.y / len : 0;
  uniforms.uPropWind.value.set(dx, dz, Math.max(0, wind.strength), 0.75);
  uniforms.uPropSignalGain.value = 10 - 5 * n;
}
