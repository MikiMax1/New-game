// Street furniture: lamps, the crossing's signals, palms, hydrants, bins, signs, pay stations,
// drains, covers and a roadworks site, all placed from layout.ts.
//
// Placement (distances from the kerb face, see layout.ZONES):
//   lamps       0.7 m back (poles clear the kerb by 0.45 m), every LAMP_SPACING m, the two sides
//               staggered by half a spacing; arms reach 2.3 m over the road
//   palms       1.0 m back, halfway between lamps
//   signals     mast-arm poles on the far side of the crossing for each direction of traffic (drive
//               on the right), 0.8 m back; heads over the lane centres, 5.3 m above the road (the
//               bottom of a head at least 4.6 m up), facing the approaching traffic; pedestrian heads
//               on the poles facing across the crosswalk
//   hydrants    0.6 m back, clear of lamps, the crossing and parked cars' doors
//   covers      in the lanes, following the crown; grates in the gutter by the crossing
//   roadworks   in the north parking lane: a taper of drums from the kerb out to the lane edge,
//               then a line of Jersey barriers, a work sign ahead of them, cones inside
import { Color, Group, InstancedMesh, Matrix4, MeshPhysicalNodeMaterial, Quaternion, Vector3, type Material } from 'three/webgpu';
import type { CityContext } from './context';
import { CROSSING_X, CROSSWALK_WIDTH, KERB_Z, LAMP_SPACING, LANE_WIDTH, PARKING_Z, STREET_HALF_LENGTH } from './layout';
import { cone, cover, drainGrate, drum, hydrant, jerseyBarrier, litterBin, payStation, pedestrianHead, signalHead, signalPole, signPost, streetLamp, workSign, type Part } from './furniture/parts';
import { growPalms, palmMeshes } from './furniture/Palms';

/** Lamps are off at this sun elevation; set to true for dusk. */
const LAMPS_ON = false;

interface Placement {
  x: number;
  z: number;
  /** Heading, radians (rotation about y). */
  rot?: number;
  /** Height above the street surface. */
  lift?: number;
  /** Absolute height instead of standing on the surface. */
  y?: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3(1, 1, 1);

export function buildStreetFurniture(ctx: CityContext): Group {
  const group = new Group();
  group.name = 'Street furniture';
  const m = ctx.materials;

  /** Instances a part at the placements, mapping its slots to materials. */
  const place = <S extends string>(name: string, part: Part<S>, materials: Record<S, Material>, at: Placement[]) => {
    if (at.length === 0) return;
    const mesh = new InstancedMesh(
      part.geometry,
      part.slots.map((s) => materials[s]),
      at.length,
    );
    mesh.name = name;
    at.forEach((p, i) => {
      const y = p.y ?? ctx.height(p.x, p.z) + (p.lift ?? 0);
      _q.setFromAxisAngle(_v.set(0, 1, 0), p.rot ?? 0);
      _m.compose(new Vector3(p.x, y, p.z), _q, _s);
      mesh.setMatrixAt(i, _m);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };

  const galv = m.galvanised;
  const lensOff = new MeshPhysicalNodeMaterial({ name: 'Lens', color: new Color(0.3, 0.3, 0.28), roughness: 0.15 });
  const orange = new MeshPhysicalNodeMaterial({ name: 'Orange plastic', color: new Color('#e2531d'), roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.3 });
  const white = new MeshPhysicalNodeMaterial({ name: 'Retroreflective white', color: new Color(0.86, 0.86, 0.84), roughness: 0.3 });
  const signalYellow = m.paintedMetal('#c9a11c', 0.4);
  const black = m.paintedMetal('#1b1c1d', 0.45);
  const iron = m.paintedMetal('#2c2a28', 0.55);

  // Street lamps, staggered along both sides.
  const lamps: Placement[] = [];
  for (let x = CROSSING_X + 6.5 - LAMP_SPACING * 4; x < STREET_HALF_LENGTH; x += LAMP_SPACING) {
    if (x > -STREET_HALF_LENGTH) lamps.push({ x, z: KERB_Z + 0.7, rot: Math.PI });
    const xs = x + LAMP_SPACING / 2;
    if (xs > -STREET_HALF_LENGTH && xs < STREET_HALF_LENGTH) lamps.push({ x: xs, z: -KERB_Z - 0.7 });
  }
  place('Street lamps', streetLamp(), { steel: galv, housing: m.paintedMetal('#8d9291', 0.35), lens: LAMPS_ON ? m.emissive('#ffe2b8', 30) : lensOff }, lamps);

  // Palms, halfway between lamps.
  const palmBases = lamps.map((l) => {
    const x = l.x + LAMP_SPACING / 2;
    const z = Math.sign(l.z) * (KERB_Z + 1.0);
    return new Vector3(x, ctx.height(x, z), z);
  }).filter((p) => Math.abs(p.x) < STREET_HALF_LENGTH - 2 && Math.abs(p.x - CROSSING_X) > 4);
  palmMeshes(growPalms(palmBases, ctx.random), ctx, group);

  // Signals at the crossing. Traffic heading +x uses the north lanes (z > 0): its pole stands on
  // the north pavement past the crossing and its arm reaches south over those lanes, the heads
  // facing -x. The other direction mirrors it.
  const x0 = CROSSING_X - CROSSWALK_WIDTH / 2;
  const x1 = CROSSING_X + CROSSWALK_WIDTH / 2;
  const poleZ = KERB_Z + 0.8;
  const reach = poleZ - 0.6;
  const poles: Placement[] = [
    { x: x1 + 1.2, z: poleZ, rot: Math.PI },
    { x: x0 - 1.2, z: -poleZ },
  ];
  place('Signal poles', signalPole(reach), { steel: galv }, poles);
  const road = ctx.height(0, 0);
  const headY = road + 5.3;
  const heads: Placement[] = [];
  for (const lane of [0.5, 1.5]) {
    heads.push({ x: x1 + 1.2, z: lane * LANE_WIDTH, y: headY, rot: Math.PI });
    heads.push({ x: x0 - 1.2, z: -lane * LANE_WIDTH, y: headY });
  }
  const red = m.emissive('#ff2a14', 28);
  place('Signal heads', signalHead(), { housing: signalYellow, backplate: black, border: m.paintedMetal('#e8d21a', 0.3), red, amber: lensOff, green: lensOff }, heads);
  // Pedestrian heads on the poles, facing across the crosswalk: the walking figure lit.
  const walk = m.emissive('#f2f4ee', 9);
  place('Pedestrian heads', pedestrianHead(), { housing: black, face: walk }, [
    { x: x1 + 1.2, z: poleZ - 0.25, y: ctx.height(x1, poleZ) + 2.8, rot: Math.PI / 2 },
    { x: x0 - 1.2, z: -poleZ + 0.25, y: ctx.height(x0, -poleZ) + 2.8, rot: -Math.PI / 2 },
  ]);

  // Hydrants, bins, pay stations and signs.
  place('Hydrants', hydrant(), { paint: m.paintedMetal('#d9aa1e', 0.45), caps: m.paintedMetal('#c7c2b6', 0.4) }, [
    { x: 4.5, z: -KERB_Z - 0.6, rot: Math.PI / 2 },
    { x: -33, z: KERB_Z + 0.6, rot: -Math.PI / 2 },
  ]);
  place('Litter bins', litterBin(), { body: m.paintedMetal('#1f3328', 0.5), lid: m.paintedMetal('#1f3328', 0.4) }, [
    { x: x0 - 3.2, z: -KERB_Z - 0.9 },
    { x: x1 + 3.4, z: KERB_Z + 0.9 },
    { x: 26, z: KERB_Z + 0.9 },
  ]);
  place('Pay stations', payStation(), { body: m.paintedMetal('#50585a', 0.4), screen: m.emissive('#9fd4ff', 1.5) }, [
    { x: 12, z: KERB_Z + 0.75, rot: Math.PI },
    { x: -44, z: -KERB_Z - 0.75 },
  ]);
  place('No-parking signs', signPost(0.45, 0.6), { post: galv, face: white, border: m.paintedMetal('#b3161b', 0.35) }, [
    { x: -3, z: -KERB_Z - 0.55, rot: Math.PI / 2 },
    { x: -24, z: KERB_Z + 0.55, rot: -Math.PI / 2 },
    { x: 34, z: -KERB_Z - 0.55, rot: Math.PI / 2 },
  ]);

  // Drains in the gutters by the crossing, covers in the lanes.
  place('Drain grates', drainGrate(), { iron }, [
    { x: x0 - 4, z: -KERB_Z + 0.26, lift: -0.012 },
    { x: x1 + 4, z: KERB_Z - 0.26, lift: -0.012 },
  ]);
  place('Manhole covers', cover(0.33), { iron }, [
    { x: 6, z: 1.65, lift: -0.008 },
    { x: -31, z: -4.95, lift: -0.008 },
    { x: -62, z: 1.7, lift: -0.008 },
    { x: 18, z: -1.6, lift: -0.008 },
  ]);
  place('Valve covers', cover(0.12), { iron }, [
    { x: 2.5, z: 5.2, lift: -0.006 },
    { x: -20, z: -2.1, lift: -0.006 },
  ]);

  // Roadworks in the north parking lane, ahead of the crossing (x -52 .. -36).
  const worksZ = PARKING_Z + 0.35;
  const barriers: Placement[] = [];
  for (let k = 0; k < 3; k++) barriers.push({ x: -40 - k * 3.9, z: worksZ, rot: (ctx.random() - 0.5) * 0.02 });
  place('Jersey barriers', jerseyBarrier(), { concrete: m.concrete }, barriers);
  const drums: Placement[] = [];
  // Taper: from the kerb out to the lane edge over 9 m, one drum every 3 m.
  for (let k = 0; k < 4; k++) drums.push({ x: -33.5 + k * 3, z: worksZ + (k / 3) * (KERB_Z - 0.6 - worksZ) });
  place('Drums', drum(), { rubber: m.rubber, orange, white }, drums);
  place('Cones', cone(), { rubber: m.rubber, orange, white }, [
    { x: -44, z: worksZ + 1.1, rot: 0.4 },
    { x: -47.5, z: worksZ + 1.4, rot: 1.1 },
    { x: -51.6, z: worksZ + 0.2, rot: 0.2 },
  ]);
  place('Work sign', workSign(), { stand: galv, face: orange, border: black }, [{ x: -27, z: KERB_Z - 0.55, rot: -Math.PI / 2 - 0.3 }]);

  return group;
}
