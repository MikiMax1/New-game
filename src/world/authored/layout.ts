// Hand-authored macro layout of Port Solmar (map v1, 4 x 4 km).
// The generator adds natural detail (coast wiggles, street grids, lots) on top of this.
// Coordinates: metres, +X east, +Z south, map spans -2048..2048.
//
//     north (-Z)
//   +---------------------------------------------------------------+
//   | Cypress |  Northside (industrial, malls)    |harbor| bay |B | o |
//   |  Edge   |-----------------------------------+------+     |E | c |
//   | (swamp) |  Little Solano  | Downtown (river)| port isl.  |A | e |
//   |         |-----------------------------------+            |C | a |
//   |         |  Palm Heights (suburbs, ridge)    | bay islets |H | n |
//   +---------------------------------------------------------------+
//     south (+Z)                                         east (+X)

import type { DistrictId, P2, RoadClass } from '../types';

const P = (x: number, z: number): P2 => ({ x, z });

/** Mainland: everything west of the bay shore. Extends past the map edge on purpose. */
export const MAINLAND_SHORE: P2[] = [
  P(330, -2300), P(330, -2048), P(360, -1800), P(335, -1620), P(385, -1450), P(372, -1300),
  P(392, -1100), P(410, -900), P(420, -700), P(440, -500), P(452, -350), P(470, -200),
  P(482, -50), P(476, 70), P(478, 160), P(520, 300), P(565, 385), P(540, 455), P(470, 525),
  P(420, 650), P(385, 800), P(335, 950), P(300, 1100), P(245, 1250), P(205, 1400),
  P(160, 1550), P(100, 1700), P(40, 1850), P(-40, 2048), P(-60, 2300),
];
export const MAINLAND: P2[] = [...MAINLAND_SHORE, P(-2300, 2300), P(-2300, -2300)];

/** Barrier island (Solmar Beach): west (bay) and east (ocean) shore x at each z. */
export const BEACH_PROFILE: { z: number; west: number; east: number }[] = [
  { z: -2300, west: 1180, east: 1560 },
  { z: -1800, west: 1170, east: 1540 },
  { z: -1400, west: 1150, east: 1522 },
  { z: -1000, west: 1160, east: 1502 },
  { z: -600, west: 1128, east: 1490 },
  { z: -300, west: 1100, east: 1480 },
  { z: 0, west: 1082, east: 1470 },
  { z: 300, west: 1070, east: 1460 },
  { z: 700, west: 1062, east: 1450 },
  { z: 1100, west: 1062, east: 1440 },
  { z: 1400, west: 1082, east: 1430 },
  { z: 1550, west: 1120, east: 1420 },
  { z: 1640, west: 1250, east: 1395 },
];

export function beachIslandRing(): P2[] {
  const west = BEACH_PROFILE.map((p) => P(p.west, p.z));
  const east = BEACH_PROFILE.map((p) => P(p.east, p.z)).reverse();
  return [...west, P(1330, 1680), ...east];
}

/** Port island (cargo terminal) in the bay east of downtown. */
export const PORT_ISLAND: P2[] = [
  P(612, -58), P(760, -92), P(1000, -112), P(1032, -60), P(1030, 60), P(1012, 172), P(820, 188), P(640, 190), P(600, 110),
];

/** Small residential islands (ellipses: centre, radii, rotation in radians). */
export const BAY_ISLANDS: { name: string; cx: number; cz: number; rx: number; rz: number; rot: number; district: DistrictId }[] = [
  { name: 'Palm Isle', cx: 668, cz: -442, rx: 115, rz: 62, rot: 0.03, district: 'islands' },
  { name: 'Star Isle', cx: 936, cz: -468, rx: 130, rz: 68, rot: -0.04, district: 'islands' },
  { name: 'Hibiscus Isle', cx: 820, cz: -254, rx: 140, rz: 58, rot: 0.02, district: 'islands' },
  { name: 'Venetia North', cx: 690, cz: 470, rx: 58, rz: 44, rot: 0, district: 'islands' },
  { name: 'Venetia Center', cx: 805, cz: 470, rx: 62, rz: 46, rot: 0, district: 'islands' },
  { name: 'Venetia South', cx: 920, cz: 470, rx: 58, rz: 44, rot: 0, district: 'islands' },
  { name: 'Coral Key', cx: 1270, cz: 1830, rx: 150, rz: 105, rot: 0.3, district: 'islands' },
];

/** Solmar River from the swamp to the bay (centreline, west to east) and its width. */
export const RIVER: P2[] = [
  P(-2300, -520), P(-1900, -500), P(-1750, -425), P(-1600, -380), P(-1450, -420), P(-1300, -380),
  P(-1150, -300), P(-1000, -250), P(-850, -262), P(-700, -212), P(-560, -140), P(-400, -118),
  P(-250, -58), P(-120, 18), P(0, 58), P(100, 32), P(200, 42), P(300, 92), P(400, 112), P(520, 116),
];
/** River width (m) as a function of x: wide at the mouth, narrow in the swamp. */
export function riverWidth(x: number): number {
  const t = Math.min(1, Math.max(0, (x + 1500) / 1900));
  return 30 + 32 * t;
}

/** Mainland district seeds for a weighted Voronoi partition. */
export const DISTRICT_SEEDS: { x: number; z: number; district: DistrictId; weight: number }[] = [
  { x: 190, z: -60, district: 'downtown', weight: 1.0 },
  { x: 330, z: 250, district: 'downtown', weight: 0.9 },
  { x: 180, z: -420, district: 'downtown', weight: 0.8 },
  { x: -820, z: 230, district: 'littleSolano', weight: 1.0 },
  { x: -560, z: -80, district: 'littleSolano', weight: 0.85 },
  { x: -1080, z: -120, district: 'littleSolano', weight: 0.85 },
  { x: -900, z: -1350, district: 'northside', weight: 1.1 },
  { x: -250, z: -1150, district: 'northside', weight: 1.0 },
  { x: -300, z: -1750, district: 'northside', weight: 1.0 },
  { x: 230, z: -1650, district: 'harbor', weight: 0.75 },
  { x: -450, z: 1150, district: 'palmHeights', weight: 1.0 },
  { x: -1050, z: 950, district: 'palmHeights', weight: 1.0 },
  { x: 60, z: 1500, district: 'palmHeights', weight: 1.0 },
  { x: -1100, z: 1750, district: 'palmHeights', weight: 1.0 },
  { x: -1880, z: -1300, district: 'cypressEdge', weight: 1.05 },
  { x: -1880, z: 0, district: 'cypressEdge', weight: 1.05 },
  { x: -1880, z: 1300, district: 'cypressEdge', weight: 1.05 },
];

/** Low limestone ridge through Palm Heights (the only real elevation in the city). */
export const RIDGE = { from: P(-1350, 1950), to: P(-150, 650), height: 11, width: 380 };

/** Mainland street lattice: arterials every 800 m, avenues between them. */
export const LATTICE = {
  /** Arterial (6-lane) lines: z of east-west, x of north-south. */
  arterialZ: [-1930, -1130, -330, 470, 1270],
  arterialX: [-1650, -850, -50],
  /** Avenue (4-lane) lines. */
  avenueZ: [-1530, -730, 70, 870, 1670],
  avenueX: [-1250, -450],
  /** Lines that continue as rural roads through the swamp. */
  ruralZ: [-330, 1270],
};

export interface AuthoredRoad {
  name: string;
  cls: RoadClass;
  points: P2[];
  /** Spline-smooth the points (true) or keep straight segments. */
  smooth?: boolean;
  /**
   * How the first point joins the grid: 'deadEnd' moves it onto the nearest dead-end road
   * (e.g. a boulevard that stops at the shore), 'edge' onto the nearest road.
   */
  attach?: 'deadEnd' | 'edge';
}

/** Causeways and special roads inserted after the grid. They overshoot their far end on purpose; the stub is pruned. */
export const AUTHORED_ROADS: AuthoredRoad[] = [
  { name: 'Solmar Causeway', cls: 'arterial', attach: 'deadEnd', smooth: true, points: [P(445, -332), P(600, -338), P(900, -352), P(1120, -360), P(1335, -364)] },
  { name: 'Tuttle Causeway', cls: 'arterial', attach: 'deadEnd', smooth: true, points: [P(385, -1131), P(700, -1150), P(1000, -1168), P(1240, -1180), P(1350, -1182)] },
  { name: 'Venetian Causeway', cls: 'avenue', attach: 'deadEnd', smooth: false, points: [P(508, 470), P(690, 470), P(805, 470), P(920, 470), P(1300, 472)] },
  { name: 'Port Boulevard', cls: 'avenue', attach: 'deadEnd', smooth: true, points: [P(468, 70), P(560, 60), P(640, 50), P(700, 40)] },
  {
    name: 'Dixie Highway', cls: 'arterial', attach: 'edge', smooth: true,
    points: [P(150, 470), P(-150, 700), P(-500, 930), P(-850, 1180), P(-1250, 1480), P(-1700, 1780), P(-2100, 2080)],
  },
];

/** z of each causeway landing on the barrier island (cross streets keep clear of these). */
export const CAUSEWAY_LANDINGS_Z = [-1180, -362, 471];

export interface Highway {
  name: string;
  points: P2[];
  /** Deck height above ground (m). */
  elevation: number;
  lanesPerDirection: number;
}

export const HIGHWAYS: Highway[] = [
  {
    name: 'Interstate 7',
    points: [P(-560, -2300), P(-520, -1600), P(-470, -1000), P(-400, -520), P(-330, -140), P(-300, 220), P(-360, 620), P(-480, 1020), P(-600, 1500), P(-690, 2300)],
    elevation: 10,
    lanesPerDirection: 3,
  },
  {
    name: 'Solmar Expressway',
    points: [P(-2300, -600), P(-1700, -620), P(-1200, -600), P(-800, -570), P(-460, -560)],
    elevation: 16,
    lanesPerDirection: 3,
  },
];

export type LandmarkKind = 'tower' | 'park' | 'stadium' | 'pier' | 'lighthouse' | 'cranes' | 'arena' | 'marina' | 'golf' | 'mall' | 'hospital' | 'dock';

export interface Landmark {
  name: string;
  kind: LandmarkKind;
  at: P2;
  /** Reserved area where the normal street grid is suppressed (optional). */
  reserve?: { halfX: number; halfZ: number };
}

export const LANDMARKS: Landmark[] = [
  { name: 'Solmar Tower', kind: 'tower', at: P(250, -110) },
  { name: 'Bayfront Park', kind: 'park', at: P(445, -160) },
  { name: 'Solmar Arena', kind: 'arena', at: P(425, -520) },
  { name: 'Estadio Solano', kind: 'stadium', at: P(-820, 540), reserve: { halfX: 170, halfZ: 140 } },
  { name: 'Northgate Mall', kind: 'mall', at: P(-150, -1360), reserve: { halfX: 170, halfZ: 110 } },
  { name: 'Mercy General', kind: 'hospital', at: P(20, -880), reserve: { halfX: 110, halfZ: 80 } },
  { name: 'Granada Golf Club', kind: 'golf', at: P(-900, 1720), reserve: { halfX: 260, halfZ: 170 } },
  { name: 'Coconut Marina', kind: 'marina', at: P(200, 1250) },
  { name: 'South Pointe Pier', kind: 'pier', at: P(1395, 1500) },
  { name: 'South Pointe Light', kind: 'lighthouse', at: P(1330, 1650) },
  { name: 'Port Cranes', kind: 'cranes', at: P(1000, 40) },
  { name: 'Airboat Landing', kind: 'dock', at: P(-1780, -470) },
];

export const DISTRICT_LABELS: { district: DistrictId; name: string; at: P2 }[] = [
  { district: 'downtown', name: 'DOWNTOWN', at: P(170, -120) },
  { district: 'beach', name: 'SOLMAR BEACH', at: P(1290, -700) },
  { district: 'littleSolano', name: 'LITTLE SOLANO', at: P(-800, 120) },
  { district: 'palmHeights', name: 'PALM HEIGHTS', at: P(-500, 1350) },
  { district: 'harbor', name: 'PORT OF SOLMAR', at: P(820, 40) },
  { district: 'northside', name: 'NORTHSIDE', at: P(-600, -1450) },
  { district: 'cypressEdge', name: 'CYPRESS EDGE', at: P(-1800, -900) },
  { district: 'islands', name: 'BAY ISLES', at: P(830, -520) },
];
