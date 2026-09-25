// The showcase set: a rain-soaked street corner. Every object is a loaded, photo-scanned glTF
// model (Poly Haven, CC0) or the Khronos Car Concept (CC-BY 4.0); only the street surface under
// them is terrain built in code (StreetSurface.ts). Positions are in metres: the street runs along
// x, the building line is at z = -8.6 and the kerb at z = -4 (see DEFAULT_STREET).
import { Box3, Group, Mesh, Vector3, type Material, type Object3D } from 'three/webgpu';
import type { AssetLoader } from './AssetLoader';
import { buildFacadeRow } from './FacadeBuilder';
import { MaterialLibrary } from './MaterialLibrary';
import { buildStreet, DEFAULT_STREET, streetHeight, type StreetLayout } from './StreetSurface';

export interface Placement {
  x: number;
  z: number;
  /** Turn about the vertical axis, degrees. */
  rotY?: number;
  /** Height above the street surface (0 = standing on it). */
  lift?: number;
  scale?: number;
  /** Absolute height of the model's base, instead of standing on the street. */
  y?: number;
  /**
   * Keep only the model's top-level parts whose names match (Poly Haven files often hold
   * several variants side by side, e.g. a new and an aged hydrant).
   */
  pick?: RegExp;
  /** Stand the model on the parts whose material names match (e.g. a car's tyres). */
  groundOn?: RegExp;
}

export interface StreetScene {
  root: Group;
  /** The hero car, for the camera to look at and the lens to focus on. */
  car: Object3D;
  /** Region the sun's shadow map covers. */
  shadowBounds: Box3;
  layout: StreetLayout;
  /** Bounds of every placed model, for tools. */
  bounds: Record<string, Box3>;
}

const _box = new Box3();
const _size = new Vector3();

export async function buildStreetScene(assets: AssetLoader, materials: MaterialLibrary, carColor = '#7d0d12'): Promise<StreetScene> {
  const layout = DEFAULT_STREET;
  const root = new Group();
  root.name = 'Street';
  const bounds: Record<string, Box3> = {};

  // Street surface: wet asphalt with puddles, damp concrete pavement.
  const [asphalt, pavement] = await Promise.all([assets.textureSet('asphalt_02'), assets.textureSet('concrete_pavement')]);
  const street = buildStreet(layout);
  const road = new Mesh(street.road, materials.wetAsphalt(asphalt, { tileSize: 3.2, puddles: 1, seed: 3 }));
  road.name = 'Road';
  const walk = new Mesh(street.pavement, materials.scanned(pavement, { tileSize: 2.4, wetness: 0.7, puddles: 0.4, displacement: 0.006, seed: 7 }, true));
  walk.name = 'Pavement';
  for (const m of [road, walk]) {
    m.receiveShadow = true;
    m.castShadow = true;
    root.add(m);
  }

  /** Loads a model, upgrades its materials and stands it on the street. */
  const place = async (id: string, at: Placement, replace?: (m: Material, mesh: Mesh) => Material | null): Promise<Object3D> => {
    const model = await assets.model(id);
    if (at.pick) {
      for (const child of [...model.children]) if (!at.pick.test(child.name)) child.removeFromParent();
      // Centre what's left on the placement point.
      _box.setFromObject(model);
      const c = _box.getCenter(_size);
      for (const child of model.children) child.position.x -= c.x, child.position.z -= c.z;
    }
    materials.upgrade(model, replace);
    if (at.scale) model.scale.setScalar(at.scale);
    model.rotation.y = ((at.rotY ?? 0) * Math.PI) / 180;
    model.position.set(at.x, 0, at.z);
    model.updateMatrixWorld(true);
    _box.makeEmpty();
    if (at.groundOn) {
      model.traverse((o) => {
        if (o instanceof Mesh && [o.material].flat().some((m) => at.groundOn!.test(m.name))) _box.expandByObject(o, true);
      });
    }
    if (_box.isEmpty()) _box.setFromObject(model, true);
    const base = at.y ?? streetHeight(layout, at.z) + (at.lift ?? 0);
    model.position.y += base - _box.min.y;
    model.updateMatrixWorld(true);
    bounds[`${id}@${at.x},${at.z}`] = new Box3().setFromObject(model);
    root.add(model);
    return model;
  };

  const paint = materials.carPaint({ color: carColor });
  const glass = materials.tintedGlass();
  const carPromise = place('car_concept', { x: 0.6, z: -2.95, rotY: 90, groundOn: /Tire/ }, (m) => {
    if (/^Paint/.test(m.name)) return paint;
    if (/Glass/.test(m.name)) return glass;
    return null;
  });

  await Promise.all([
    carPromise,
    place('covered_car', { x: -9.2, z: -3.0, rotY: 90 }),
    place('street_lamp_01', { x: 5.2, z: -4.45, rotY: 90 }),
    place('fire_hydrant', { x: -3.6, z: -4.6, rotY: 20, pick: /^fire_hydrant_aged$/ }),
    place('metal_trash_can', { x: 7.4, z: -7.9, rotY: 0, pick: /^metal_trash_can_rust$/ }),
    place('utility_box_01', { x: -6.2, z: -8.25, rotY: 0 }),
    place('water_manhole_cover', { x: 3.2, z: 0.4, lift: -0.012 }),
    place('modular_street_seating', { x: -1.4, z: -7.7, rotY: 0 }),
    place('potted_plant_01', { x: 2.2, z: -8.1 }),
    place('potted_plant_01', { x: 4.1, z: -8.1, rotY: 70 }),
    place('shrub_01', { x: -11.5, z: -8.2 }),
    place('island_tree_01', { x: -14, z: -5.8, rotY: 30 }),
    place('concrete_road_barrier', { x: 16, z: -2.2, rotY: 90 }),
    place('exterior_aircon_unit', { x: -3.2, z: -8.45, y: 3.9, pick: /^exterior_aircon_unit$/ }),
  ]);
  const facades = await buildFacadeRow(assets, materials, {
    x: -layout.length / 2,
    z: layout.buildingLine,
    y: streetHeight(layout, layout.buildingLine + 0.05) + 0.12,
    buildings: [
      { bays: ['-large', 'small', 'small', '-large'], floors: 3 },
      { bays: ['double', 'double', 'large', 'double'], floors: 2 },
      { bays: ['balcony', '-offset', 'balcony', 'balcony', 'offset'], floors: 3 },
      { bays: ['large', 'small', 'large'], floors: 3 },
      { bays: ['double', '-double', 'double'], floors: 2 },
    ],
  });
  root.add(facades);

  const car = await carPromise;
  root.updateMatrixWorld(true);
  const shadowBounds = new Box3(new Vector3(-18, -0.5, -12), new Vector3(18, 16, 8));
  return { root, car, shadowBounds, layout, bounds };
}
