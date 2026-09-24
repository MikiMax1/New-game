// Public API of the street props and vegetation kit.
//
//   const lib = createPropLibrary();                    // { models, materials }
//   scene.add(createPropInstances(lib, placements));    // InstancedMesh per (prop, variant, part)
//   updatePropMaterials(lib.materials, t, { direction, strength }, night);   // every frame
//
// See src/world/props/types.ts for conventions (origin, facing) and each builder file for the
// orientation and real-world dimensions of every model.

export { PROP_IDS, MATERIAL_KEYS, SIGNAL_LENS, type PropId, type MaterialKey, type PropModelData } from '../../world/props/types';
export { buildPropModelData, propVariantCount } from '../../world/props/catalog';
export { createPropLibrary, propModelFromData, type PropLibrary, type PropModel, type PropPart, type PropLight } from './library';
export { createPropMaterials, updatePropMaterials, getPropDepthMaterial, createPropUniforms, type PropMaterialUserData } from './materials';
export { createPropInstances, createPropObject, placementMatrix, yawToFace, type PropPlacement } from './instancing';
export { chainPatch, applyWind, applyFoliage, type PropUniforms } from './shaderPatches';
