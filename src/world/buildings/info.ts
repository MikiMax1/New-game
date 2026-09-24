import type { DistrictId, LandUse, P2 } from '../types';

export type RoofType = 'flat' | 'hip' | 'gable' | 'shed' | 'sawtooth' | 'none';

/** A door on the building, at ground level, with its outward facing direction. */
export interface Entrance {
  x: number;
  y: number;
  z: number;
  /** Outward unit normal (toward the street for main entrances). */
  nx: number;
  nz: number;
  kind: 'main' | 'shop' | 'service' | 'garage' | 'dock' | 'lobby';
}

/** Flat roof area free for props (antennas, solar panels, people...). */
export interface RoofArea {
  ring: P2[];
  y: number;
}

export interface BuildingInfo {
  /** Style id, e.g. 'office-tower', 'deco-hotel', 'med-house'; 'none' when nothing was built. */
  style: string;
  district: DistrictId;
  use: LandUse;
  lod: 0 | 1;
  /** Height of the main roof above lot.groundY (m), excluding spires and antennas. */
  height: number;
  /** World Y of the highest point (including spires, signs, crowns). */
  topY: number;
  /** Floors above ground in the tallest volume. */
  floors: number;
  /** World Y of the main roof surface (flat roofs) or the eave (pitched roofs). */
  roofY: number;
  roofType: RoofType;
  /** Outline of the main volume at ground level (world X/Z, positive winding). */
  footprint: P2[];
  /** Flat roof areas that props could use. */
  roofAreas: RoofArea[];
  entrances: Entrance[];
  /** Paved parking areas this building emitted inside its lot. */
  parking: P2[][];
  /** Triangles emitted for this building. */
  triangles: number;
}
