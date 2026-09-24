// Procedural buildings for Port Solmar. Pure geometry (no three.js): safe in Web Workers.
//
//   const out = new BucketBuilder();
//   for (const lot of chunkLots) generateBuilding(lot, out, lod);
//   const buckets = out.build();   // keys: BUILDING_FACADE_KEY, BUILDING_DETAIL_KEY
//
// Walls go to the facade bucket as plain quads with facade parameters per vertex (the
// facade shader in src/render/buildingMaterials.ts draws windows, frames, storefronts,
// weathering and night lights). Everything else goes to the detail bucket.

import type { BucketBuilder } from '../mesh/meshData';
import { Rng, hash01, hashInts } from '../rng';
import type { Lot } from '../types';
import { Emitter } from './emit';
import type { BuildingInfo } from './info';
import { type LotCtx, analyzeLot, buildable } from './lot';
import { type GenCtx, parkingLot } from './styles/common';
import { genDeco, genMimo } from './styles/deco';
import { genMedHouse, genModernMansion } from './styles/house';
import { genStripMall, genWarehouse } from './styles/industrial';
import { genMidrise } from './styles/midrise';
import { genShack, genTrailer } from './styles/rural';
import { genKiosk, genShop, genSmallHouse } from './styles/shop';
import { genTower } from './styles/tower';
import { fitRect } from './lot';

export type { BuildingInfo, Entrance, RoofArea, RoofType } from './info';
export {
  BUILDING_DETAIL_KEY, BUILDING_FACADE_KEY, BUILDING_KEYS, DETAIL_ATTRS, DSURF, FACADE_ATTRS, FLAG, GLASS, GND, OCC, PAT, WSURF,
} from './constants';
export { SIGN_ATLAS, SIGN_TEXTS } from './signs';

type Gen = (g: GenCtx) => void;

/** Height hints are metres; fall back to something sensible for bad input. */
function sanitize(lot: Lot): Lot {
  const h = Number.isFinite(lot.heightHint) && lot.heightHint > 0 ? Math.min(lot.heightHint, 400) : 8;
  const y = Number.isFinite(lot.groundY) ? lot.groundY : 0;
  return { ...lot, heightHint: h, groundY: y, seed: Number.isFinite(lot.seed) ? lot.seed : 0 };
}

function surfaceParking(g: GenCtx): void {
  const region = buildable(g.c, 1, 1, 1);
  if (!region) return;
  const r = fitRect(g.c, region);
  if (!r) return;
  parkingLot(g, g.c.frame, r.x0, r.x1, r.z0, r.z1);
  g.info.style = 'surface-parking';
}

/** Choose the style generator for a lot from its district, use, height hint and size. */
export function pickStyle(lot: Lot, c: LotCtx, rng: Rng): { id: string; gen: Gen } | null {
  const h = lot.heightHint;
  const minDim = Math.min(c.width, c.depth);
  if (c.area < 10 || minDim < 2.2) return null;
  if (lot.use === 'park' || lot.use === 'vacant') return null;
  const tiny = c.area < 45 || minDim < 4.5;
  if (tiny) return lot.use === 'commercial' || lot.use === 'residential' ? { id: 'kiosk', gen: genKiosk } : null;
  const towerOk = minDim >= 20 && c.area >= 500;
  const big = c.area > 1800;
  const d = lot.district;
  if (lot.use === 'parking') {
    if ((d === 'downtown' || d === 'beach') && h >= 8 && minDim >= 18) return { id: 'parking-garage', gen: (g) => genMidrise(g, 'parking') };
    return { id: 'surface-parking', gen: surfaceParking };
  }
  switch (d) {
    case 'downtown':
      switch (lot.use) {
        case 'office':
          return h >= 45 && towerOk ? { id: 'office-tower', gen: (g) => genTower(g, 'office') } : { id: 'midrise', gen: (g) => genMidrise(g, 'office') };
        case 'hotel':
          return h >= 40 && towerOk ? { id: 'hotel-tower', gen: (g) => genTower(g, 'hotel') } : { id: 'midrise', gen: (g) => genMidrise(g, 'hotel') };
        case 'residential':
          return h >= 40 && towerOk ? { id: 'condo-tower', gen: (g) => genTower(g, 'condo') } : { id: 'midrise', gen: (g) => genMidrise(g, 'residential') };
        case 'commercial':
          return h >= 45 && towerOk ? { id: 'office-tower', gen: (g) => genTower(g, 'office') } : { id: 'lowrise', gen: (g) => genMidrise(g, 'commercial') };
        case 'civic':
          return { id: 'civic', gen: (g) => genMidrise(g, 'civic') };
        default:
          return { id: 'warehouse', gen: (g) => genWarehouse(g) };
      }
    case 'beach':
      switch (lot.use) {
        case 'hotel':
        case 'residential':
          if (h <= 17) return { id: 'deco-hotel', gen: (g) => genDeco(g) };
          if (h <= 55 && minDim >= 24 && rng.chance(0.7)) return { id: 'mimo-hotel', gen: genMimo };
          if (towerOk) return { id: 'beach-condo', gen: (g) => genTower(g, lot.use === 'hotel' ? 'hotel' : 'condo', true) };
          return { id: 'deco-hotel', gen: (g) => genDeco(g) };
        case 'commercial':
          return { id: 'deco-shop', gen: (g) => genDeco(g, true) };
        case 'civic':
          return { id: 'civic', gen: (g) => genMidrise(g, 'civic') };
        case 'office':
          return { id: 'midrise', gen: (g) => genMidrise(g, 'office') };
        default:
          return { id: 'deco-shop', gen: (g) => genDeco(g, true) };
      }
    case 'littleSolano':
      switch (lot.use) {
        case 'residential':
          return { id: 'small-house', gen: genSmallHouse };
        case 'industrial':
          return { id: 'warehouse', gen: (g) => genWarehouse(g) };
        case 'civic':
          return { id: 'civic', gen: (g) => genMidrise(g, 'civic') };
        default:
          return { id: 'stucco-shop', gen: genShop };
      }
    case 'palmHeights':
      switch (lot.use) {
        case 'residential':
          return { id: 'med-house', gen: (g) => genMedHouse(g) };
        case 'commercial':
          return big ? { id: 'strip-mall', gen: genStripMall } : { id: 'stucco-shop', gen: genShop };
        case 'civic':
          return { id: 'civic', gen: (g) => genMidrise(g, 'civic') };
        case 'industrial':
          return { id: 'warehouse', gen: (g) => genWarehouse(g) };
        default:
          return { id: 'midrise', gen: (g) => genMidrise(g, 'commercial') };
      }
    case 'harbor':
      switch (lot.use) {
        case 'office':
        case 'commercial':
        case 'civic':
          return { id: 'port-office', gen: (g) => genMidrise(g, 'port') };
        default:
          return { id: 'harbor-shed', gen: (g) => genWarehouse(g, true) };
      }
    case 'northside':
      switch (lot.use) {
        case 'industrial':
          return { id: 'warehouse', gen: (g) => genWarehouse(g) };
        case 'commercial':
          return big ? { id: 'strip-mall', gen: genStripMall } : { id: 'stucco-shop', gen: genShop };
        case 'residential':
          return rng.chance(0.35) ? { id: 'trailer', gen: genTrailer } : { id: 'small-house', gen: genSmallHouse };
        case 'civic':
          return { id: 'civic', gen: (g) => genMidrise(g, 'civic') };
        default:
          return { id: 'lowrise', gen: (g) => genMidrise(g, 'commercial') };
      }
    case 'islands':
      if (lot.use === 'residential' || lot.use === 'hotel') return rng.chance(0.5) ? { id: 'modern-mansion', gen: genModernMansion } : { id: 'med-mansion', gen: (g) => genMedHouse(g, true) };
      return { id: 'med-mansion', gen: (g) => genMedHouse(g, true) };
    case 'cypressEdge':
      switch (lot.use) {
        case 'commercial':
          return { id: 'bait-shop', gen: (g) => genShack(g, true) };
        case 'residential':
          return rng.chance(0.4) ? { id: 'trailer', gen: genTrailer } : { id: 'shack', gen: (g) => genShack(g) };
        default:
          return { id: 'shack', gen: (g) => genShack(g) };
      }
    default:
      return { id: 'lowrise', gen: (g) => genMidrise(g, 'commercial') };
  }
}

/**
 * Build one lot's building into the shared buckets. lod 0 = full detail, lod 1 = cheap
 * silhouette for far distances (same volumes, colours and facade parameters, no small parts).
 * Never throws; degenerate lots produce nothing (style 'none').
 */
export function generateBuilding(lot: Lot, out: BucketBuilder, lod: 0 | 1): BuildingInfo {
  const safe = sanitize(lot);
  const info: BuildingInfo = {
    style: 'none', district: lot.district, use: lot.use, lod, height: 0, topY: safe.groundY, floors: 0,
    roofY: safe.groundY, roofType: 'none', footprint: [], roofAreas: [], entrances: [], parking: [], triangles: 0,
  };
  let c: LotCtx | null = null;
  try {
    c = analyzeLot(safe);
  } catch {
    c = null;
  }
  if (!c) return info;
  const rng = new Rng(hashInts(safe.seed, 0x51a7));
  const style = pickStyle(safe, c, rng);
  if (!style) return info;
  const em = new Emitter(out, safe.groundY, lod);
  const seed = hash01(safe.seed, 7);
  em.seed = seed;
  const g: GenCtx = { lot: safe, c, lod, rng, drng: new Rng(hashInts(safe.seed, 0xd37a)), em, base: safe.groundY, seed, info };
  try {
    style.gen(g);
  } catch (e) {
    info.style = 'error';
    if (typeof console !== 'undefined') console.warn('generateBuilding failed for lot', lot.id, e);
  }
  info.triangles = em.triangles;
  if (info.style === 'none' && info.triangles > 0) info.style = style.id;
  return info;
}
