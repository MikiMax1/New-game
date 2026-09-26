// The procedural city block: a downtown street at golden hour after rain, generated entirely in
// code. It assembles the street surface (city/Street.ts), the buildings (city/Buildings.ts) and
// the street furniture (city/StreetFurniture.ts), all laid out from city/layout.ts.
import { Box3, Group, Mesh, Vector3 } from 'three/webgpu';
import type { CityMaterials } from './city/CityMaterials';
import { seededRandom, type CityContext } from './city/context';
import { buildBuildings } from './city/Buildings';
import { BUILDING_Z, CROSSING_X, KERB_Z } from './city/layout';
import { buildPavement, buildRoad, streetHeight } from './city/Street';
import { buildStreetFurniture } from './city/StreetFurniture';

export interface CameraSpot {
  position: Vector3;
  target: Vector3;
  /** Vertical field of view, degrees. */
  fov: number;
}

export interface City {
  root: Group;
  /** Region the sun's shadow map covers. */
  shadowBounds: Box3;
  /** Where the reflection probe is captured (street level, mid-street). */
  probe: Vector3;
  spots: Record<string, CameraSpot>;
}

export interface CityOptions {
  seed?: number;
  /** Surfaces for the road and pavements (they add markings, joints and puddles). */
  road: Mesh['material'];
  pavement: Mesh['material'];
}

export function buildCity(materials: CityMaterials, options: CityOptions): City {
  const ctx: CityContext = { materials, height: streetHeight, random: seededRandom(options.seed ?? 7) };
  const root = new Group();
  root.name = 'City';

  const road = new Mesh(buildRoad(), options.road);
  road.name = 'Road';
  root.add(road);
  for (const side of [1, -1] as const) {
    const pavement = new Mesh(buildPavement(side), options.pavement);
    pavement.name = side > 0 ? 'North pavement' : 'South pavement';
    root.add(pavement);
  }
  for (const m of root.children) {
    m.receiveShadow = true;
    m.castShadow = true;
  }

  root.add(buildBuildings(ctx));
  root.add(buildStreetFurniture(ctx));
  root.updateMatrixWorld(true);

  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  return {
    root,
    shadowBounds: new Box3(v(CROSSING_X - 70, -1, -BUILDING_Z - 14), v(CROSSING_X + 70, 45, BUILDING_Z + 14)),
    probe: v(CROSSING_X + 10, 2, 0),
    spots: {
      // Down the street towards the low sun, from just above the wet road: backlit, long shadows.
      hero: { position: v(22, 1.35, -3.4), target: v(-40, 3.2, 1.2), fov: 38 },
      // Across the crossing from the south pavement.
      crossing: { position: v(CROSSING_X + 16, 1.65, -KERB_Z - 2.2), target: v(CROSSING_X - 4, 1.4, 3), fov: 45 },
      // Low over a puddle, reflections in view.
      puddle: { position: v(8, 0.45, -4.5), target: v(-25, 2.5, 0), fov: 42 },
      // Up the facades.
      facades: { position: v(CROSSING_X + 30, 1.7, KERB_Z - 1), target: v(CROSSING_X - 10, 12, BUILDING_Z), fov: 55 },
    },
  };
}
