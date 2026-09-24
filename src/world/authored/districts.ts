// Per-district rules: street pattern, lot sizes, sidewalks, heights and land-use mix.
import type { DistrictId, LandUse } from '../types';

export interface DistrictSpec {
  id: DistrictId;
  name: string;
  /** Map colour for urban blocks. */
  mapColor: string;
  /** Local streets inside a 400 m superblock: target spacing of north-south and east-west streets (m). 0 = none. */
  streetSpacingX: number;
  streetSpacingZ: number;
  /** Curvy suburban streets: warp amplitude (m) and cul-de-sac probability per street segment. */
  curvy: number;
  culDeSac: number;
  /** Local street carriageway width (m). */
  streetWidth: number;
  /** Sidewalk width (m) including planting strip. */
  sidewalk: number;
  /** Lot subdivision: stop splitting below this area (m^2); frontage target (m); max depth before splitting into two rows (m). */
  lotMaxArea: number;
  lotFrontage: number;
  lotMaxDepth: number;
  /** Building height: median and max (m). */
  heightMedian: number;
  heightMax: number;
  /** Land-use mix for lots on local streets and on main roads. */
  useLocal: Partial<Record<LandUse, number>>;
  useMain: Partial<Record<LandUse, number>>;
  /** Chance a block becomes a park or plaza. */
  parkChance: number;
}

export const DISTRICTS: Record<DistrictId, DistrictSpec> = {
  downtown: {
    id: 'downtown', name: 'Downtown', mapColor: '#c9c4bd',
    streetSpacingX: 100, streetSpacingZ: 100, curvy: 0, culDeSac: 0, streetWidth: 13, sidewalk: 5,
    lotMaxArea: 3600, lotFrontage: 45, lotMaxDepth: 55, heightMedian: 55, heightMax: 240,
    useLocal: { office: 4, residential: 4, hotel: 1, commercial: 1, parking: 0.6, civic: 0.3 },
    useMain: { office: 5, residential: 3, hotel: 1.5, commercial: 1, civic: 0.3 },
    parkChance: 0.04,
  },
  beach: {
    id: 'beach', name: 'Solmar Beach', mapColor: '#e6d6c3',
    streetSpacingX: 0, streetSpacingZ: 90, curvy: 0, culDeSac: 0, streetWidth: 11, sidewalk: 4,
    lotMaxArea: 1300, lotFrontage: 30, lotMaxDepth: 45, heightMedian: 13, heightMax: 110,
    useLocal: { residential: 6, hotel: 2, commercial: 1 },
    useMain: { hotel: 4, commercial: 3, residential: 3 },
    parkChance: 0.03,
  },
  littleSolano: {
    id: 'littleSolano', name: 'Little Solano', mapColor: '#dcc9b4',
    streetSpacingX: 200, streetSpacingZ: 80, curvy: 0, culDeSac: 0, streetWidth: 11, sidewalk: 3.5,
    lotMaxArea: 620, lotFrontage: 17, lotMaxDepth: 38, heightMedian: 7, heightMax: 16,
    useLocal: { residential: 8, commercial: 1.5, civic: 0.2 },
    useMain: { commercial: 7, residential: 2, civic: 0.4, parking: 0.4 },
    parkChance: 0.03,
  },
  palmHeights: {
    id: 'palmHeights', name: 'Palm Heights', mapColor: '#cfd8bf',
    streetSpacingX: 200, streetSpacingZ: 80, curvy: 34, culDeSac: 0.28, streetWidth: 10, sidewalk: 3.5,
    lotMaxArea: 950, lotFrontage: 24, lotMaxDepth: 42, heightMedian: 7, heightMax: 12,
    useLocal: { residential: 1 },
    useMain: { residential: 3, commercial: 2, civic: 0.3 },
    parkChance: 0.04,
  },
  harbor: {
    id: 'harbor', name: 'Port of Solmar', mapColor: '#bfbab4',
    streetSpacingX: 200, streetSpacingZ: 200, curvy: 0, culDeSac: 0, streetWidth: 12, sidewalk: 2,
    lotMaxArea: 9000, lotFrontage: 80, lotMaxDepth: 110, heightMedian: 11, heightMax: 22,
    useLocal: { industrial: 5, parking: 0.5 },
    useMain: { industrial: 4, commercial: 1 },
    parkChance: 0,
  },
  northside: {
    id: 'northside', name: 'Northside', mapColor: '#d3cabd',
    streetSpacingX: 200, streetSpacingZ: 200, curvy: 0, culDeSac: 0, streetWidth: 12, sidewalk: 2.5,
    lotMaxArea: 5200, lotFrontage: 60, lotMaxDepth: 90, heightMedian: 9, heightMax: 20,
    useLocal: { industrial: 5, commercial: 1.5, residential: 1 },
    useMain: { commercial: 5, industrial: 2, parking: 0.5 },
    parkChance: 0.02,
  },
  cypressEdge: {
    id: 'cypressEdge', name: 'Cypress Edge', mapColor: '#b9c29f',
    streetSpacingX: 0, streetSpacingZ: 0, curvy: 0, culDeSac: 0, streetWidth: 8, sidewalk: 0,
    lotMaxArea: 2000, lotFrontage: 40, lotMaxDepth: 50, heightMedian: 4, heightMax: 6,
    useLocal: { residential: 1 },
    useMain: { residential: 1, commercial: 0.4 },
    parkChance: 0,
  },
  islands: {
    id: 'islands', name: 'Bay Isles', mapColor: '#d6dcc6',
    streetSpacingX: 0, streetSpacingZ: 0, curvy: 0, culDeSac: 0, streetWidth: 9, sidewalk: 2,
    lotMaxArea: 2600, lotFrontage: 45, lotMaxDepth: 60, heightMedian: 9, heightMax: 14,
    useLocal: { residential: 1 },
    useMain: { residential: 1 },
    parkChance: 0,
  },
};

export const DISTRICT_IDS = Object.keys(DISTRICTS) as DistrictId[];

export function districtIndex(id: DistrictId): number {
  return DISTRICT_IDS.indexOf(id);
}
