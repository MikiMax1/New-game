// Apartment buildings assembled from Poly Haven's Modular Urban Apartments Facade kit (CC0).
//
// The kit's glTF is a catalogue: every module sits at its own spot, grouped in columns by bay
// type. A bay is 3 m wide and a storey 3 m high; in the catalogue the storeys of one column sit
// 4 m apart (ground floor at y 0–3, then 4–7, 8–11 and the top floor at 12–15), with the wall
// plane at z = 0 and the window or door insert that fits it at the same x. Assembling a building
// is moving each module (with its insert) from its catalogue slot to its bay and storey.
//
//   base      plinth, below the ground floor          dado      band along the foot of the walls
//   wall_*    3 × 3 m wall with an opening             door_* / window_* / door_window_*: inserts
//   cornice   band between ground and first floor     crown     the cornice along the roof
//   *_pier_*  pilasters between bays                   *_end_*   caps at the ends of a building
import { Box3, Group, Mesh, Object3D, Vector3, type Material } from 'three/webgpu';
import type { AssetLoader } from './AssetLoader';
import type { MaterialLibrary } from './MaterialLibrary';

/** Bay types: the catalogue column (its x range starts at `x`) and the modules for each storey. */
interface BayType {
  x: number;
  ground: string[];
  /** First, second and top floor. */
  floors: [string[], string[], string[]];
  /** Dado band for this bay's ground floor. */
  dado: string;
}

const BAYS: Record<string, BayType> = {
  large: {
    x: 8,
    ground: ['wall_door_centered_large_01', 'door_centered_large_01'],
    floors: [
      ['wall_window_centered_large_01', 'window_centered_large_01'],
      ['wall_window_centered_large_02', 'window_centered_large_02'],
      ['wall_window_centered_large_03', 'window_centered_large_03'],
    ],
    dado: 'dado_door_centered_large_01',
  },
  small: {
    x: 12,
    ground: ['wall_door_centered_small_01', 'door_centered_small_01'],
    floors: [
      ['wall_window_centered_small_01', 'window_centered_small_01'],
      ['wall_window_centered_small_02', 'window_centered_small_02'],
      ['wall_window_centered_small_03', 'window_centered_small_03'],
    ],
    dado: 'dado_door_centered_small_01',
  },
  double: {
    x: 16,
    ground: ['wall_door_centered_small_02', 'door_centered_small_02'],
    floors: [
      ['wall_window_centered_double_01', 'window_centered_double_01'],
      ['wall_window_centered_double_02', 'window_centered_double_02'],
      ['wall_window_centered_double_03', 'window_centered_double_03'],
    ],
    dado: 'dado_door_centered_small_02',
  },
  offset: {
    x: 20,
    ground: ['wall_door_offset_small_01', 'door_offset_small_01'],
    floors: [
      ['wall_window_offset_small_01', 'window_offset_small_01'],
      ['wall_window_offset_small_03', 'window_offset_small_03'],
      ['wall_window_offset_small_05', 'window_offset_small_05'],
    ],
    dado: 'dado_door_offset_small_01',
  },
  balcony: {
    x: 24,
    ground: ['wall_door_offset_small_01', 'door_offset_small_01'],
    floors: [
      ['wall_door_window_small_01', 'door_window_small_01'],
      ['wall_door_window_small_05', 'door_window_small_05'],
      ['wall_door_window_small_09', 'door_window_small_09'],
    ],
    dado: 'dado_door_window_small_01',
  },
};

/** Catalogue y of the bottom of each storey (ground, first, second, top). */
const CATALOGUE_STOREY_Y = [0, 4, 8, 12];
const BAY = 3;
const PIER = 0.25;
const STOREY = 3;

export interface BuildingSpec {
  /** Bay types from left to right (keys of BAYS); a leading '-' gives that bay a plain ground floor. */
  bays: string[];
  /** Upper storeys above the ground floor, 1–3. */
  floors?: number;
}

export interface FacadeRowOptions {
  /** x where the row starts; buildings follow each other towards +x. */
  x: number;
  /** z of the building line (the wall plane). */
  z: number;
  /** Height of the ground floor's floor (the pavement at the building line, plus a step). */
  y: number;
  buildings: BuildingSpec[];
  /** Gap between neighbouring buildings, metres. */
  gap?: number;
}

/** A row of buildings along the building line, facing +z. */
export async function buildFacadeRow(assets: AssetLoader, materials: MaterialLibrary, options: FacadeRowOptions): Promise<Group> {
  const gltf = await assets.gltf('modular_urban_apartments_facade');
  const kit = new Map<string, Object3D>();
  for (const child of gltf.scene.children) kit.set(child.name, child);

  // Window glass is dark, glossy and opaque: there are no rooms behind the wall planes.
  const glass = materials.windowGlass();
  const upgraded = new Map<string, Object3D>();
  const piece = (name: string): Object3D | null => {
    let proto = upgraded.get(name);
    if (!proto) {
      const src = kit.get(name);
      if (!src) {
        console.warn(`facade kit: no module "${name}"`);
        return null;
      }
      proto = src.clone(true);
      materials.upgrade(proto, (m: Material) => (/glass/i.test(m.name) ? glass : null));
      upgraded.set(name, proto);
    }
    return proto.clone(true);
  };

  const row = new Group();
  row.name = 'Facades';
  const { gap = 0.3 } = options;
  let x = options.x;
  const box = new Box3();
  const put = (name: string, from: Vector3, to: Vector3, parent: Group) => {
    const p = piece(name);
    if (!p) return;
    p.position.add(to).sub(from);
    parent.add(p);
  };
  const from = new Vector3();
  const to = new Vector3();

  for (const spec of options.buildings) {
    const building = new Group();
    building.name = `Building ${row.children.length + 1}`;
    const floors = Math.max(1, Math.min(3, spec.floors ?? 3));
    const top = options.y + STOREY * (floors + 1);
    let bx = x;
    // Pilaster at the left end, then bay, pilaster, bay, …
    const pier = (px: number) => {
      from.set(-22.13, 0, 0);
      to.set(px, options.y, options.z);
      put('wall_pier_standard_01', from, to, building);
      for (let f = 1; f <= floors; f++) {
        to.y = options.y + STOREY * f;
        put('wall_pier_standard_01', from, to, building);
      }
      from.set(-22.2, -1, 0);
      to.set(px - 0.07, options.y, options.z);
      put('dado_pier_pedestal_01', from, to, building);
      from.set(-22.18, 3.4, 0);
      to.set(px - 0.05, options.y + STOREY, options.z);
      put('cornice_pier_standard_01', from, to, building);
      from.set(-22.36, 3.95, -0.1);
      to.set(px - 0.23, top, options.z - 0.1);
      put('crown_pier_pedestal_01', from, to, building);
    };
    pier(bx);
    bx += PIER;
    for (const key of spec.bays) {
      const plain = key.startsWith('-');
      const type = BAYS[plain ? key.slice(1) : key] ?? BAYS.large;
      // Ground floor: a door, or a plain wall.
      from.set(type.x, CATALOGUE_STOREY_Y[0], 0);
      to.set(bx, options.y, options.z);
      if (plain) {
        from.set(-3, 0, 0);
        put('wall_standard_standard_01', from, to, building);
        from.set(-3, -1, 0);
        to.set(bx, options.y, options.z);
        put('dado_standard_standard_01', from, to, building);
      } else {
        for (const name of type.ground) put(name, from, to, building);
        from.set(type.x, -1, 0);
        put(type.dado, from, to, building);
      }
      // Plinth under the ground floor, band above it, upper floors, crown on top.
      from.set(-3, -1.25, 0);
      to.set(bx, options.y, options.z);
      put('base_standard_01', from, to, building);
      from.set(-3, 3.4, 0);
      to.set(bx, options.y + STOREY, options.z);
      put('cornice_standard_standard_01', from, to, building);
      for (let f = 1; f <= floors; f++) {
        // The top floor uses the kit's top-floor modules; lower ones alternate the other two.
        const variant = f === floors ? 2 : (f - 1) % 2;
        from.set(type.x, CATALOGUE_STOREY_Y[variant + 1], 0);
        to.set(bx, options.y + STOREY * f, options.z);
        for (const name of type.floors[variant]) put(name, from, to, building);
      }
      from.set(-3, 4, 0);
      to.set(bx, top, options.z);
      put('crown_standard_standard_01', from, to, building);
      bx += BAY;
      pier(bx);
      bx += PIER;
    }
    // End caps for the crown.
    from.set(-24.53, 4, 0);
    to.set(x - 0.43, top, options.z);
    put('crown_end_01', from, to, building);
    from.set(-23.9, 4, 0);
    to.set(bx, top, options.z);
    put('crown_end_02', from, to, building);

    building.traverse((o) => {
      if (o instanceof Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    row.add(building);
    box.setFromObject(building);
    x = bx + gap;
  }
  return row;
}
