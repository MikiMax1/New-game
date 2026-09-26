// Procedural buildings along both sides of the street (see layout.ts for the building lines).
// Stub: the architecture is being built out; until then this returns an empty group.
import { Group } from 'three/webgpu';
import type { CityContext } from './context';

export function buildBuildings(_ctx: CityContext): Group {
  const group = new Group();
  group.name = 'Buildings';
  return group;
}
