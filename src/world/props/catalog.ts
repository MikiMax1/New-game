// Registry of prop builders: how many variants each prop has and how to build them.
// Pure data + geometry (no three.js objects besides maths), so it also runs in a worker.

import { buildBeachUmbrella, buildLifeguardTower, buildLounger } from './beach';
import { PropBuild } from './builder';
import { buildAcUnit, buildBench, buildBollard, buildBusShelter, buildDumpster, buildFireHydrant, buildNewspaperBox, buildParkingMeter, buildTrashCan } from './furniture';
import { buildCoconutPalm, buildRoyalPalm, buildSabalPalm } from './palms';
import { buildPedSignal, buildStopSign, buildStreetNameSign, buildTrafficSignalMast } from './signals';
import { buildStreetLightCobra, buildStreetLightDeco, buildUtilityPole } from './streetLights';
import type { PropId, PropModelData } from './types';
import { buildGrassClump, buildHedge, buildLiveOak, buildShrub } from './vegetation';

export interface PropBuilderEntry {
  variants: number;
  build: (b: PropBuild) => void;
}

export const PROP_BUILDERS: Record<PropId, PropBuilderEntry> = {
  palmRoyal: { variants: 3, build: buildRoyalPalm },
  palmCoconut: { variants: 4, build: buildCoconutPalm },
  palmSabal: { variants: 3, build: buildSabalPalm },
  liveOak: { variants: 3, build: buildLiveOak },
  shrub: { variants: 4, build: buildShrub },
  hedge: { variants: 3, build: buildHedge },
  grassClump: { variants: 3, build: buildGrassClump },
  streetLightCobra: { variants: 3, build: buildStreetLightCobra },
  streetLightDeco: { variants: 2, build: buildStreetLightDeco },
  trafficSignalMast: { variants: 3, build: buildTrafficSignalMast },
  pedSignal: { variants: 2, build: buildPedSignal },
  stopSign: { variants: 2, build: buildStopSign },
  streetNameSign: { variants: 3, build: buildStreetNameSign },
  fireHydrant: { variants: 3, build: buildFireHydrant },
  bench: { variants: 3, build: buildBench },
  trashCan: { variants: 3, build: buildTrashCan },
  busShelter: { variants: 2, build: buildBusShelter },
  newspaperBox: { variants: 3, build: buildNewspaperBox },
  parkingMeter: { variants: 3, build: buildParkingMeter },
  utilityPole: { variants: 3, build: buildUtilityPole },
  lifeguardTower: { variants: 3, build: buildLifeguardTower },
  beachUmbrella: { variants: 3, build: buildBeachUmbrella },
  lounger: { variants: 3, build: buildLounger },
  bollard: { variants: 3, build: buildBollard },
  acUnit: { variants: 3, build: buildAcUnit },
  dumpster: { variants: 3, build: buildDumpster },
};

/** Number of variants of a prop (models.get(id).length in the render library). */
export function propVariantCount(id: PropId): number {
  return PROP_BUILDERS[id].variants;
}

/** Build one model variant as plain data. `detail` scales tessellation (1 = default). */
export function buildPropModelData(id: PropId, variant: number, detail = 1): PropModelData {
  const entry = PROP_BUILDERS[id];
  const b = new PropBuild(id, ((variant % entry.variants) + entry.variants) % entry.variants, detail);
  entry.build(b);
  return b.finish();
}
