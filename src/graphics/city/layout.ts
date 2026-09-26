// The street's plan, in metres. Everything in the procedural city is placed from these numbers.
//
// The street runs along x: a downtown street with two traffic lanes and a parking lane each way,
// 4 m pavements and buildings on both sides. y is up; the road surface is at about y = 0 (a few
// centimetres of crown), the pavements at y ≈ 0.15.
//
//   z:  +13.0 ── building line (north)
//       +9.0 ─── kerb face (north); pavement 4 m wide between
//       +6.6 ─── parking lane edge line (solid white)
//       +3.3 ─── lane line (dashed white)
//        0 ───── centre line (double yellow)
//       -3.3 ─── lane line (dashed white)
//       -6.6 ─── parking lane edge line (solid white)
//       -9.0 ─── kerb face (south)
//       -13.0 ── building line (south)
//
// A signalised crossing with a zebra crosswalk and kerb ramps sits at x = CROSSING_X; the street
// continues for STREET_HALF_LENGTH metres either side of x = 0, then the buildings run on into
// the haze.

export const LANE_WIDTH = 3.3;
export const PARKING_WIDTH = 2.4;
/** z of the kerb faces (road half-width): two lanes and a parking lane each way. */
export const KERB_Z = LANE_WIDTH * 2 + PARKING_WIDTH;
/** Kerb height above the gutter, metres. */
export const KERB_HEIGHT = 0.15;
export const PAVEMENT_WIDTH = 4;
/** z of the building lines (wall planes). */
export const BUILDING_Z = KERB_Z + PAVEMENT_WIDTH;
/** z of the parking-lane edge lines. */
export const PARKING_Z = KERB_Z - PARKING_WIDTH;
/** Half the length of the modelled street; buildings continue beyond as distant blocks. */
export const STREET_HALF_LENGTH = 90;
/** x of the pedestrian crossing (zebra, stop lines, kerb ramps, signals). */
export const CROSSING_X = -14;
/** Crosswalk width along x, metres. */
export const CROSSWALK_WIDTH = 4;
/** Kerb-ramp width along the kerb, metres (plus 1:10 flares either side). */
export const RAMP_WIDTH = 2.4;

/** Pavement zones measured from the kerb face towards the buildings (metres). */
export const ZONES = {
  /** Street furniture (lamps, signals, hydrants, bins, trees) sits in this band. */
  furniture: [0.45, 1.2] as const,
  /** Clear walking path. */
  walk: [1.2, 3.3] as const,
  /** Shop frontage (planters, café tables, steps). */
  frontage: [3.3, PAVEMENT_WIDTH] as const,
};

/** Street lamps: spacing along each side (staggered between the two sides). */
export const LAMP_SPACING = 26;
