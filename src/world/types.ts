// Core world types and conventions shared by every generator and renderer.
//
// COORDINATES
// - Metres. Three.js axes: +X = east, +Y = up, +Z = south (so north is -Z).
// - The map is a square from -MAP_HALF to +MAP_HALF on X and Z (see config.ts).
// - Sea level is y = 0.
// - 2D generator geometry uses P2 {x, z} in the same world X/Z coordinates.
//
// POLYGON WINDING
// - Rings are open (the last point is not repeated).
// - Outer rings have POSITIVE signed area by `signedArea()` in geom.ts
//   (sum of x_i*z_{i+1} - x_{i+1}*z_i). Seen from above with north up, that is clockwise.
// - For a positive ring, the outward normal of edge a->b is normalize(b.z - a.z, -(b.x - a.x)).

export interface P2 {
  x: number;
  z: number;
}

export type Ring = P2[];

export interface PolygonWithHoles {
  outer: Ring;
  holes: Ring[];
}

export type DistrictId =
  | 'downtown'
  | 'beach'
  | 'littleSolano'
  | 'palmHeights'
  | 'harbor'
  | 'northside'
  | 'cypressEdge'
  | 'islands';

export type RoadClass = 'highway' | 'arterial' | 'avenue' | 'street' | 'alley' | 'ramp';

export type LandUse =
  | 'residential' // houses, apartments
  | 'commercial' // shops, restaurants, malls
  | 'office' // office towers
  | 'hotel' // beach hotels, condos
  | 'industrial' // warehouses, factories, port
  | 'civic' // schools, hospital, police, stadium
  | 'park' // green space, plazas
  | 'parking' // surface parking lots
  | 'vacant';

/** A parcel of land facing a street, where one building (or a park/parking lot) goes. */
export interface Lot {
  id: number;
  district: DistrictId;
  use: LandUse;
  /** Positive-winding ring (see above). Already inset from the sidewalk. */
  polygon: Ring;
  /** frontage[i] is true when edge polygon[i] -> polygon[i+1] faces a street. */
  frontage: boolean[];
  /** Ground height (m) under the lot; buildings sit at this height. */
  groundY: number;
  /** Suggested building height in metres, from the district's density map. */
  heightHint: number;
  /** Per-lot seed for deterministic variation. */
  seed: number;
}
