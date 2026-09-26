// Street furniture: lamps, traffic signals, barriers, hydrants and the rest (see layout.ts for the
// pavement zones). Stub: being built out; until then this returns an empty group.
import { Group } from 'three/webgpu';
import type { CityContext } from './context';

export function buildStreetFurniture(_ctx: CityContext): Group {
  const group = new Group();
  group.name = 'Street furniture';
  return group;
}
