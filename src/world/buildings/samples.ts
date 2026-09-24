// A showroom of synthetic lots covering every district / use style: rectangles of many
// sizes, trapezoids, L-shapes, a very narrow lot, a huge downtown lot and corner lots.
// Used by dev/buildings.html and tests/buildings.test.ts.

import type { DistrictId, LandUse, Lot, P2 } from '../types';

export interface SampleStreet {
  district: DistrictId;
  /** Street centre line z (streets run along x). */
  z: number;
  x0: number;
  x1: number;
  /** Half width of the carriageway and the sidewalk width. */
  half: number;
  sidewalk: number;
}

export interface SampleLayout {
  lots: Lot[];
  streets: SampleStreet[];
  /** Cross streets (run along z) at these x positions, spanning z0..z1 of a row. */
  crossStreets: { x: number; z0: number; z1: number; half: number; sidewalk: number }[];
}

type Shape = 'rect' | 'trap' | 'L' | 'skew';

interface LotSpec {
  w: number;
  d: number;
  use: LandUse;
  h: number;
  shape?: Shape;
  /** Extra frontage on the west (-x) or east (+x) side edge (corner lot). */
  corner?: 'w' | 'e';
  gap?: number;
}

interface RowSpec {
  district: DistrictId;
  north: LotSpec[];
  south: LotSpec[];
}

const ROWS: RowSpec[] = [
  {
    district: 'downtown',
    north: [
      { w: 110, d: 90, use: 'office', h: 210, corner: 'w' },
      { w: 60, d: 60, use: 'residential', h: 150 },
      { w: 40, d: 45, use: 'office', h: 42 },
      { w: 8, d: 32, use: 'residential', h: 30 },
      { w: 45, d: 50, use: 'hotel', h: 115, shape: 'trap' },
      { w: 30, d: 40, use: 'commercial', h: 14, corner: 'e' },
    ],
    south: [
      { w: 50, d: 50, use: 'parking', h: 18, corner: 'w' },
      { w: 45, d: 55, use: 'civic', h: 20 },
      { w: 60, d: 60, use: 'office', h: 95, shape: 'L' },
      { w: 35, d: 40, use: 'residential', h: 45 },
      { w: 42, d: 45, use: 'residential', h: 125, corner: 'e' },
    ],
  },
  {
    district: 'beach',
    north: [
      { w: 26, d: 35, use: 'hotel', h: 12, corner: 'w' },
      { w: 22, d: 35, use: 'hotel', h: 10 },
      { w: 28, d: 35, use: 'hotel', h: 14 },
      { w: 18, d: 30, use: 'commercial', h: 6 },
      { w: 62, d: 55, use: 'hotel', h: 42 },
      { w: 55, d: 55, use: 'residential', h: 95, corner: 'e' },
    ],
    south: [
      { w: 25, d: 30, use: 'hotel', h: 9, corner: 'w' },
      { w: 30, d: 35, use: 'hotel', h: 13 },
      { w: 20, d: 30, use: 'commercial', h: 5 },
      { w: 24, d: 32, use: 'residential', h: 12, shape: 'skew' },
      { w: 50, d: 50, use: 'hotel', h: 36, corner: 'e' },
    ],
  },
  {
    district: 'littleSolano',
    north: [
      { w: 12, d: 25, use: 'commercial', h: 5, corner: 'w' },
      { w: 8, d: 25, use: 'commercial', h: 8 },
      { w: 10, d: 25, use: 'commercial', h: 11 },
      { w: 7, d: 25, use: 'commercial', h: 4.5 },
      { w: 15, d: 25, use: 'commercial', h: 8 },
      { w: 9, d: 25, use: 'commercial', h: 5 },
      { w: 14, d: 25, use: 'commercial', h: 11, corner: 'e' },
    ],
    south: [
      { w: 15, d: 30, use: 'residential', h: 3.5, gap: 1 },
      { w: 14, d: 28, use: 'residential', h: 3.5, gap: 1 },
      { w: 16, d: 30, use: 'residential', h: 3.5, gap: 1 },
      { w: 25, d: 35, use: 'residential', h: 8, gap: 1 },
      { w: 11, d: 25, use: 'commercial', h: 8 },
      { w: 16, d: 26, use: 'commercial', h: 5, shape: 'trap' },
    ],
  },
  {
    district: 'palmHeights',
    north: [
      { w: 25, d: 40, use: 'residential', h: 3.5, gap: 1 },
      { w: 28, d: 42, use: 'residential', h: 7, gap: 1 },
      { w: 30, d: 45, use: 'residential', h: 7, gap: 1 },
      { w: 34, d: 45, use: 'residential', h: 3.5, shape: 'L', gap: 1 },
      { w: 26, d: 40, use: 'residential', h: 6, gap: 1 },
    ],
    south: [
      { w: 125, d: 80, use: 'commercial', h: 6, gap: 4 },
      { w: 50, d: 50, use: 'civic', h: 12 },
    ],
  },
  {
    district: 'northside',
    north: [
      { w: 80, d: 60, use: 'industrial', h: 10, gap: 4 },
      { w: 70, d: 55, use: 'industrial', h: 11, gap: 4 },
      { w: 110, d: 75, use: 'commercial', h: 6 },
    ],
    south: [
      { w: 18, d: 32, use: 'residential', h: 3.5, gap: 1 },
      { w: 18, d: 32, use: 'residential', h: 3.5, gap: 1 },
      { w: 18, d: 32, use: 'residential', h: 3.5, gap: 1 },
      { w: 15, d: 25, use: 'commercial', h: 5, gap: 1 },
      { w: 65, d: 50, use: 'industrial', h: 9, gap: 4 },
    ],
  },
  {
    district: 'harbor',
    north: [
      { w: 120, d: 60, use: 'industrial', h: 14, gap: 6 },
      { w: 90, d: 50, use: 'industrial', h: 12, gap: 6 },
      { w: 40, d: 35, use: 'office', h: 10 },
    ],
    south: [
      { w: 100, d: 55, use: 'industrial', h: 12, gap: 6 },
      { w: 35, d: 30, use: 'office', h: 14 },
    ],
  },
  {
    district: 'islands',
    north: [
      { w: 60, d: 70, use: 'residential', h: 7, gap: 2 },
      { w: 55, d: 65, use: 'residential', h: 10, gap: 2 },
      { w: 70, d: 75, use: 'residential', h: 7, gap: 2 },
    ],
    south: [
      { w: 60, d: 70, use: 'residential', h: 10, gap: 2 },
      { w: 65, d: 70, use: 'residential', h: 7, gap: 2 },
    ],
  },
  {
    district: 'cypressEdge',
    north: [
      { w: 25, d: 30, use: 'residential', h: 3.5, gap: 4 },
      { w: 25, d: 30, use: 'residential', h: 3.5, gap: 4 },
      { w: 30, d: 30, use: 'commercial', h: 4, gap: 4 },
      { w: 22, d: 35, use: 'residential', h: 3.5, gap: 4 },
    ],
    south: [
      { w: 25, d: 30, use: 'residential', h: 3.5, gap: 4 },
      { w: 25, d: 32, use: 'industrial', h: 4, gap: 4 },
      { w: 22, d: 35, use: 'residential', h: 3.5, gap: 4 },
    ],
  },
];

function lotRing(x0: number, x1: number, zStreet: number, zBack: number, shape: Shape): P2[] {
  // north side lots have zBack < zStreet; ring starts with the street edge
  const north = zBack < zStreet;
  const w = x1 - x0;
  const d = Math.abs(zBack - zStreet);
  const sgn = north ? -1 : 1;
  let pts: P2[];
  if (shape === 'trap') {
    const k = w * 0.18;
    pts = [
      { x: x0, z: zStreet }, { x: x1, z: zStreet }, { x: x1 - k, z: zBack }, { x: x0 + k * 0.4, z: zBack },
    ];
  } else if (shape === 'skew') {
    const k = d * 0.25;
    pts = [
      { x: x0, z: zStreet }, { x: x1, z: zStreet }, { x: x1 + k, z: zBack }, { x: x0 + k, z: zBack },
    ];
  } else if (shape === 'L') {
    const cx = x0 + w * 0.55;
    const cz = zStreet + sgn * d * 0.5;
    pts = [
      { x: x0, z: zStreet }, { x: x1, z: zStreet }, { x: x1, z: cz }, { x: cx, z: cz }, { x: cx, z: zBack }, { x: x0, z: zBack },
    ];
  } else {
    pts = [{ x: x0, z: zStreet }, { x: x1, z: zStreet }, { x: x1, z: zBack }, { x: x0, z: zBack }];
  }
  // north side: the street edge must run east -> west for a positive ring, so reverse
  if (north) {
    pts = [pts[1], pts[0], ...pts.slice(2).reverse()];
  }
  return pts;
}

/** Build the showroom lots. `seed` varies every building. */
export function sampleLayout(seed = 1): SampleLayout {
  const lots: Lot[] = [];
  const streets: SampleStreet[] = [];
  const crossStreets: SampleLayout['crossStreets'] = [];
  let z = 0;
  let id = 1;
  const half = 7;
  const sidewalk = 3;
  for (const row of ROWS) {
    const maxNorth = Math.max(...row.north.map((l) => l.d));
    const maxSouth = Math.max(...row.south.map((l) => l.d));
    z += maxNorth + half + sidewalk + 20;
    let xmin = Infinity;
    let xmax = -Infinity;
    for (const [side, list] of [['n', row.north], ['s', row.south]] as const) {
      const total = list.reduce((s, l) => s + l.w + (l.gap ?? 0), 0);
      let x = -total / 2;
      for (const l of list) {
        const x0 = x;
        const x1 = x + l.w;
        x = x1 + (l.gap ?? 0);
        xmin = Math.min(xmin, x0);
        xmax = Math.max(xmax, x1);
        const zStreet = side === 'n' ? z - half - sidewalk : z + half + sidewalk;
        const zBack = side === 'n' ? zStreet - l.d : zStreet + l.d;
        const ring = lotRing(x0, x1, zStreet, zBack, l.shape ?? 'rect');
        const frontage = ring.map((_, i) => i === 0);
        if (l.corner) {
          // mark the side edge facing the cross street
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i];
            const b = ring[(i + 1) % ring.length];
            const vertical = Math.abs(a.x - b.x) < 1e-6;
            if (vertical && ((l.corner === 'w' && Math.abs(a.x - x0) < 1e-6) || (l.corner === 'e' && Math.abs(a.x - x1) < 1e-6))) frontage[i] = true;
          }
        }
        lots.push({
          id: id,
          district: row.district,
          use: l.use,
          polygon: ring,
          frontage,
          groundY: 0,
          heightHint: l.h,
          seed: (seed * 7919 + id * 104729) >>> 0,
        });
        id++;
      }
    }
    streets.push({ district: row.district, z, x0: xmin - 30, x1: xmax + 30, half, sidewalk });
    crossStreets.push({ x: xmin - half - sidewalk, z0: z - maxNorth - half - sidewalk - 6, z1: z + maxSouth + half + sidewalk + 6, half, sidewalk });
    crossStreets.push({ x: xmax + half + sidewalk, z0: z - maxNorth - half - sidewalk - 6, z1: z + maxSouth + half + sidewalk + 6, half, sidewalk });
    z += maxSouth + half + sidewalk;
  }
  return { lots, streets, crossStreets };
}

/** Degenerate lots that must not crash the generator. */
export function degenerateLots(): Lot[] {
  const base = { district: 'downtown' as DistrictId, use: 'office' as LandUse, groundY: 0, heightHint: 100, seed: 5 };
  const mk = (id: number, polygon: P2[], extra: Partial<Lot> = {}): Lot => ({ ...base, id, polygon, frontage: polygon.map((_, i) => i === 0), ...extra });
  return [
    mk(1001, []),
    mk(1002, [{ x: 0, z: 0 }, { x: 10, z: 0 }]),
    mk(1003, [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }]),
    mk(1004, [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }]),
    mk(1005, [{ x: 0, z: 0 }, { x: 10, z: 10 }, { x: 10, z: 0 }, { x: 0, z: 10 }]),
    mk(1006, [{ x: 0, z: 0 }, { x: 0, z: 30 }, { x: 30, z: 30 }, { x: 30, z: 0 }]),
    mk(1007, [{ x: NaN, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }]),
    mk(1008, [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 0.4 }, { x: 0, z: 0.4 }]),
    mk(1009, [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }, { x: 0, z: 3 }], { use: 'commercial', district: 'littleSolano' }),
    mk(1010, [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 30 }, { x: 0, z: 30 }], { heightHint: NaN }),
    mk(1011, [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 30 }, { x: 0, z: 30 }], { heightHint: -5, groundY: Infinity }),
    mk(1012, [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 30 }, { x: 0, z: 30 }], { heightHint: 5000 }),
    mk(1013, [{ x: 0, z: 0 }, { x: 60, z: 0 }, { x: 60, z: 6 }, { x: 0, z: 6 }], { district: 'beach', use: 'hotel', heightHint: 60 }),
    mk(1014, [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 25, z: 43 }], { district: 'palmHeights', use: 'residential', heightHint: 6 }),
    mk(1015, [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 20 }, { x: 0, z: 20 }], { frontage: [] }),
    mk(1016, [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 0.00001 }, { x: 5, z: 12 }, { x: 0, z: 12 }], { district: 'littleSolano', use: 'commercial' }),
  ];
}
