// Street props and vegetation: shared types.
//
// CONVENTIONS (see src/world/types.ts for world axes)
// - Metres. Model origin = centre of the base, on the ground (y = 0). +Y up.
// - Orientation: where it matters, a prop "faces" -Z. For kerb-side props this means
//   "-Z points at the roadway" (bench seat, hydrant pumper nozzle, bus shelter opening,
//   street-light arm, newspaper box door...). Traffic-signal mast arms reach along +X with
//   their signal heads facing -Z. Each builder documents its own orientation.
// - Geometry is built as plain MeshData (worker-safe, see src/world/mesh/meshData.ts) and
//   turned into THREE.BufferGeometry by the render-side library (src/render/props).

import type { MeshData } from '../mesh/meshData';

export const PROP_IDS = [
  'palmRoyal', 'palmCoconut', 'palmSabal', 'liveOak', 'shrub', 'hedge', 'grassClump',
  'streetLightCobra', 'streetLightDeco', 'trafficSignalMast', 'pedSignal', 'stopSign', 'streetNameSign',
  'fireHydrant', 'bench', 'trashCan', 'busShelter', 'newspaperBox', 'parkingMeter', 'utilityPole',
  'lifeguardTower', 'beachUmbrella', 'lounger', 'bollard', 'acUnit', 'dumpster',
] as const;

export type PropId = (typeof PROP_IDS)[number];

/**
 * Material keys shared by every prop. Few and shared on purpose: each (variant, part) becomes
 * one InstancedMesh, and colour variation lives in vertex colours, not in extra materials.
 */
export const MATERIAL_KEYS = [
  'palmTrunk', // palm trunks, crownshafts, petioles, coconuts (atlas, wind)
  'palmLeaf', // palm fronds, fan leaves, trunk "boots" (alpha-tested cards, wind)
  'bark', // live-oak trunk and limbs, shrub stems (wind)
  'oakLeaf', // oak / shrub / hedge / grass / Spanish-moss foliage cards (alpha-tested, wind)
  'metalGalv', // galvanised steel: poles, arms, sign posts
  'metalPainted', // painted metal (colour from vertex colours)
  'plastic', // plastic / fibreglass (colour from vertex colours)
  'glass', // transparent glazing
  'concrete', // concrete, stone, footings
  'wood', // timber (poles, slats, lifeguard tower planks), tinted by vertex colours
  'fabric', // umbrella canopies, cushions (double-sided)
  'signFace', // printed faces: sign atlas (stop, street names, grilles, labels)
  'emissiveLamp', // luminaire lenses and globes; glow driven by `night`
  'signalLens', // traffic / pedestrian signal lenses; states cycle in the shader
  'adPanel', // back-lit advertising panels (bus shelter)
] as const;

export type MaterialKey = (typeof MATERIAL_KEYS)[number];

export interface MaterialInfo {
  castShadow: boolean;
  /** Vertices carry the `aWind` attribute (vec4) used by the wind shader. */
  wind: boolean;
  /** Vertices carry the `aSignal` attribute (float lens type) used by the signal shader. */
  signal?: boolean;
}

export const MATERIAL_INFO: Record<MaterialKey, MaterialInfo> = {
  palmTrunk: { castShadow: true, wind: true },
  palmLeaf: { castShadow: true, wind: true },
  bark: { castShadow: true, wind: true },
  oakLeaf: { castShadow: true, wind: true },
  metalGalv: { castShadow: true, wind: false },
  metalPainted: { castShadow: true, wind: false },
  plastic: { castShadow: true, wind: false },
  glass: { castShadow: false, wind: false },
  concrete: { castShadow: true, wind: false },
  wood: { castShadow: true, wind: false },
  fabric: { castShadow: true, wind: false },
  signFace: { castShadow: true, wind: false },
  emissiveLamp: { castShadow: false, wind: false },
  signalLens: { castShadow: false, wind: false, signal: true },
  adPanel: { castShadow: false, wind: false },
};

/**
 * Signal lens types stored in the `aSignal` vertex attribute. The signal shader lights them
 * according to a global cycle (see src/render/props/signals.ts).
 */
export const SIGNAL_LENS = { red: 1, amber: 2, green: 3, pedHand: 4, pedWalk: 5 } as const;

export interface PropLightData {
  position: [number, number, number];
  /** Linear RGB. */
  color: [number, number, number];
  /** Luminous intensity in candela (three.js physical units for Point/SpotLight). */
  intensity: number;
  kind: 'street' | 'signal' | 'sign';
}

export interface PropPartData {
  materialKey: MaterialKey;
  mesh: MeshData;
  castShadow: boolean;
}

/** A model as plain data (no three.js objects), e.g. for building inside a worker. */
export interface PropModelData {
  id: PropId;
  variant: number;
  parts: PropPartData[];
  /** Horizontal radius (m) around the Y axis that contains the whole model. */
  radius: number;
  /** Top of the model (m) above its base. */
  height: number;
  lights?: PropLightData[];
  /** Named attachment points in model space (e.g. overhead wire insulators on utility poles). */
  anchors?: { name: string; position: [number, number, number] }[];
}
