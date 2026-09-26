// Engine-core test scene: a 600 × 600 m district built to check the "done when" criteria of
// DEVELOPMENT_PLAN.md, Step 1 (same scene on WebGPU and WebGL 2, correct brightness from noon to
// night, 200+ lamps, clean thin geometry under temporal anti-aliasing, stable while moving).
//
// Streets run on a 120 m grid through the origin; +X east, +Y up, +Z south, metres. Surfaces use
// physical albedos, glowing parts are authored in nits (units.ts), and street lights and
// headlights are LightPool lamps, not three.js lights. Thin and moving things for the temporal
// core: sagging power lines, balcony railings, a chain-link fence, palm fronds, cars and a
// spinning wheel. Repeated parts are instanced or merged (about 25 draw calls per pass).
import * as THREE from 'three';
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, type Node } from 'three/webgpu';
import {
  abs,
  attribute,
  float,
  floor,
  fract,
  fwidth,
  instancedBufferAttribute,
  max,
  min,
  mix,
  mod,
  mx_cell_noise_float,
  mx_noise_float,
  normalGeometry,
  oneMinus,
  positionWorld,
  round,
  select,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LightPool } from '../src/engine/lights';
import { nits } from '../src/engine/units';
import { Rng } from '../src/world/rng';

export interface CoreSceneContext {
  scene: THREE.Scene;
  lamps: LightPool;
}

export interface CoreScene {
  /** dt and elapsed in seconds; night 0 (day) .. 1 (full night) drives lamps and windows. */
  update(dt: number, elapsed: number, night: number): void;
  /** Named camera spots for screenshots and number-key jumps. */
  spots: Record<string, { pos: [number, number, number]; look: [number, number, number] }>;
}

// District layout.
/** Street centre lines, the same on both axes. */
const STREETS = [-240, -120, 0, 120, 240];
const PITCH = 120;
const HALF = 300;
/** Half width of a carriageway: two 3.5 m lanes each way. */
const ROAD = 7;
const WALK = 4;
/** Height of sidewalks and lots above the road (the curb). */
const CURB = 0.15;
const LANE = 3.5;
/** Lane centre of the outer lanes, from the street centre line. */
const OUTER_LANE = ROAD - LANE / 2;

// Lighting (physical units).
const LAMP_CD = [2800, 3800];
const LAMP_RANGE = 35;
const LAMP_LENS_NITS = 20000;
/** Post-top lanterns in the plaza: lower and dimmer, with a diffusing globe. */
const LANTERN_CD = [900, 1200];
const LANTERN_RANGE = 22;
const LANTERN_NITS = 6000;
const HEADLIGHT_CD = [900, 1400];
const HEADLIGHT_RANGE = 25;
const HEADLIGHT_NITS = 30000;
const TAILLIGHT_NITS = 800;
/** Rotation speed of the wheel (rad/s): one turn in about 25 s. */
const WHEEL_SPEED = 0.25;

type V3 = [number, number, number];
type Float = Node<'float'> | number;

/** Blackbody colour at `k` kelvin in linear sRGB with luminance 1 (Kim et al. 2002 Planckian locus fit). */
function kelvin(k: number): V3 {
  const t = 1000 / k;
  const x =
    k <= 4000
      ? -0.2661239 * t ** 3 - 0.2343589 * t ** 2 + 0.8776956 * t + 0.17991
      : -3.0258469 * t ** 3 + 2.1070379 * t ** 2 + 0.2226347 * t + 0.24039;
  const y =
    k <= 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : k <= 4000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  // XYZ with Y = 1 to linear sRGB; the Y row of the inverse matrix keeps luminance at 1.
  const X = x / y;
  const Z = (1 - x - y) / y;
  return [
    Math.max(0, 3.2406 * X - 1.5372 - 0.4986 * Z),
    Math.max(0, -0.9689 * X + 1.8758 + 0.0415 * Z),
    Math.max(0, 0.0557 * X - 0.204 + 1.057 * Z),
  ];
}

/** `c` scaled to luminance 1 (for nits() and candela colours). */
function unitLuminance(c: V3): V3 {
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return [c[0] / l, c[1] / l, c[2] / l];
}

/** A colour in the linear working space from an sRGB hex code. */
const linear = (hex: number): THREE.Color => new THREE.Color(hex);

// -----------------------------------------------------------------------------------------------
// Procedural pattern helpers (TSL). Edges are anti-aliased over one pixel footprint `w`, so the
// patterns stay clean without TAA and give it a fair test with it.
// -----------------------------------------------------------------------------------------------

const toFloat = (x: Float): Node<'float'> => (typeof x === 'number' ? float(x) : x);

/** 1 where lo < x < hi, with soft edges `w` wide. */
function band(x: Node<'float'>, lo: Float, hi: Float, w: Node<'float'>): Node<'float'> {
  const l = toFloat(lo);
  const h = toFloat(hi);
  return smoothstep(l.sub(w), l.add(w), x).mul(oneMinus(smoothstep(h.sub(w), h.add(w), x)));
}

/** Pixel footprint of `x`, never zero. */
const footprint = (x: Node<'float'>): Node<'float'> => max(fwidth(x), 1e-4);

/** Grid lines every `pitch` metres on the plane `p`, `halfWidth` wide on each side. */
function gridLines(p: Node<'vec2'>, pitch: number, halfWidth: number): Node<'float'> {
  const line = (c: Node<'float'>) => {
    const q = c.div(pitch);
    const d = float(0.5).sub(abs(fract(q).sub(0.5))).mul(pitch);
    const w = footprint(c);
    return oneMinus(smoothstep(float(halfWidth).sub(w), float(halfWidth).add(w), d));
  };
  return max(line(p.x), line(p.y));
}

// -----------------------------------------------------------------------------------------------
// Geometry helpers.
// -----------------------------------------------------------------------------------------------

/** Indexed quads with custom per-vertex attributes, held constant while a part is written. */
class Mesher {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uvs: number[] = [];
  private readonly idx: number[] = [];
  private readonly data = new Map<string, number[]>();
  /** Values of the custom attributes for the next vertices. */
  readonly attr: Record<string, number[]> = {};

  constructor(attributes: Record<string, number>) {
    for (const [name, size] of Object.entries(attributes)) {
      this.data.set(name, []);
      this.attr[name] = new Array<number>(size).fill(0);
    }
  }

  /** The quad o, o+u, o+u+v, o+v facing along u × v; uv in metres. */
  quad(o: V3, u: V3, v: V3): void {
    const n = new THREE.Vector3(...u).cross(new THREE.Vector3(...v)).normalize();
    const lu = Math.hypot(...u);
    const lv = Math.hypot(...v);
    const base = this.pos.length / 3;
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      this.pos.push(o[0] + a * u[0] + b * v[0], o[1] + a * u[1] + b * v[1], o[2] + a * u[2] + b * v[2]);
      this.nrm.push(n.x, n.y, n.z);
      this.uvs.push(a * lu, b * lv);
      for (const [name, values] of this.data) values.push(...this.attr[name]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Faces of the box [x0, x1] × [y0, y1] × [z0, z1] named in `faces` (+x -x +y -y +z -z); `inward` flips them. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces = '+x -x +y -y +z -z', inward = false): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const q = (o: V3, u: V3, v: V3) => (inward ? this.quad(o, v, u) : this.quad(o, u, v));
    for (const f of faces.split(' ')) {
      if (f === '+x') q([x1, y0, z1], [0, 0, -dz], [0, dy, 0]);
      else if (f === '-x') q([x0, y0, z0], [0, 0, dz], [0, dy, 0]);
      else if (f === '+z') q([x0, y0, z1], [dx, 0, 0], [0, dy, 0]);
      else if (f === '-z') q([x1, y0, z0], [-dx, 0, 0], [0, dy, 0]);
      else if (f === '+y') q([x0, y1, z1], [dx, 0, 0], [0, 0, -dz]);
      else if (f === '-y') q([x0, y0, z0], [dx, 0, 0], [0, 0, dz]);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    for (const [name, values] of this.data) g.setAttribute(name, new THREE.Float32BufferAttribute(values, this.attr[name].length));
    g.setIndex(this.idx);
    return g;
  }
}

/** Merges primitives (position, normal and uv only). */
function merge(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const indexed = geometries.every((g) => g.index !== null);
  const list = geometries.map((g) => {
    const h = indexed || g.index === null ? g : g.toNonIndexed();
    for (const name of Object.keys(h.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') h.deleteAttribute(name);
    return h;
  });
  const merged = mergeGeometries(list, false);
  if (!merged) throw new Error('coreScene: geometries could not be merged');
  return merged;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** A cylinder from `a` to `b` (radius `ra` at a, `rb` at b). */
function rod(a: V3, b: V3, ra: number, sides = 6, rb = ra, capped = true): THREE.BufferGeometry {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(rb, ra, len, sides, 1, !capped).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.normalize()));
  return g.translate(...a);
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** A hanging cable between a and b that sags `sag` metres at mid-span (a true catenary). */
class Catenary extends THREE.Curve<THREE.Vector3> {
  private readonly a: THREE.Vector3;
  private readonly b: THREE.Vector3;
  private readonly span: number;
  /** Catenary parameter (horizontal tension over weight per metre). */
  private readonly c: number;

  constructor(a: THREE.Vector3, b: THREE.Vector3, sag: number) {
    super();
    this.a = a;
    this.b = b;
    this.span = Math.hypot(b.x - a.x, b.z - a.z);
    // c (cosh(L / 2c) - 1) = sag, decreasing in c: bisection.
    let lo = this.span * 0.01;
    let hi = (this.span * this.span) / sag;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (mid * (Math.cosh(this.span / (2 * mid)) - 1) > sag) lo = mid;
      else hi = mid;
    }
    this.c = (lo + hi) / 2;
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    target.lerpVectors(this.a, this.b, t);
    const x = (t - 0.5) * this.span;
    target.y -= this.c * (Math.cosh(this.span / (2 * this.c)) - Math.cosh(x / this.c));
    return target;
  }
}

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[], cast: boolean, receive = true): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.computeBoundingSphere();
  return mesh;
}

function meshOf(geometry: THREE.BufferGeometry, material: THREE.Material, cast: boolean, receive = true): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

const placement = (x: number, y: number, z: number, yaw = 0, scale = 1): THREE.Matrix4 =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw), new THREE.Vector3(scale, scale, scale));

// -----------------------------------------------------------------------------------------------
// Layout.
// -----------------------------------------------------------------------------------------------

/** Lot surface inside a block's sidewalk ring. */
const LOT = { grass: 0, plaza: 1, parking: 2 } as const;
type Lot = (typeof LOT)[keyof typeof LOT];

interface Block {
  i: number;
  j: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  lot: Lot;
}

/** Block edges (curb lines) along one axis: [-300, -247], [-233, -127], ... [247, 300]. */
const SPANS: [number, number][] = (() => {
  const edges = [-HALF, ...STREETS.flatMap((c) => [c - ROAD, c + ROAD]), HALF];
  const out: [number, number][] = [];
  for (let k = 0; k < edges.length; k += 2) out.push([edges[k], edges[k + 1]]);
  return out;
})();

const blockAt = (i: number, j: number, lot: Lot = LOT.grass): Block => ({ i, j, x0: SPANS[i][0], x1: SPANS[i][1], z0: SPANS[j][0], z1: SPANS[j][1], lot });

// Special blocks, south of the main east-west street (z = 0).
const PLAZA = blockAt(3, 3, LOT.plaza); // x 7..113, z 7..113
const PARKING = blockAt(2, 3, LOT.parking); // x -113..-7
const FENCED = blockAt(4, 3); // x 127..233, vacant lot behind a chain-link fence
/** Block north of the plaza, across the main street: hand-placed buildings with balconies. */
const NORTH = blockAt(3, 2);

type Style = 'residential' | 'office' | 'glass';

interface Building {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Roof height above the road. */
  h: number;
  style: Style;
  color: THREE.Color;
  balconies: boolean;
}

const PARAPET = 1.0;
const PARAPET_T = 0.3;

/** Floor height, window column pitch, and window extent within a cell (column margin, sill, head). */
const WINDOWS: Record<Style, { floor: number; pitch: number; margin: number; sill: number; head: number; glass: number }> = {
  residential: { floor: 3.1, pitch: 3.2, margin: 0.22, sill: 0.3, head: 0.82, glass: 0 },
  office: { floor: 3.8, pitch: 1.8, margin: 0.06, sill: 0.34, head: 0.9, glass: 0 },
  glass: { floor: 4.0, pitch: 1.5, margin: 0.025, sill: 0.02, head: 0.8, glass: 1 },
};

/** Roof height for about `h` metres, snapped to whole floors. */
const floors = (style: Style, h: number): number => CURB + Math.max(1, Math.round((h - CURB) / WINDOWS[style].floor)) * WINDOWS[style].floor;

/** A random extent `size` wide inside the block span [a0, a1], behind its sidewalk. */
function within(a0: number, a1: number, size: number, r: Rng): [number, number] {
  const lo = a0 + WALK + 2;
  const hi = a1 - WALK - 2;
  const s = Math.min(size, hi - lo);
  const start = r.range(lo, hi - s);
  return [start, start + s];
}

const STUCCO = [0xf2c9c0, 0xbfe3d6, 0xf6e2b3, 0xd9cdea, 0xf4efe6, 0xf3d1a8, 0xc9dff0, 0xe9b8c9, 0xece6da];

function planBuildings(rng: Rng): Building[] {
  const out: Building[] = [
    { x0: 18, z0: -46, x1: 60, z1: -19, h: CURB + 9 * 3.1, style: 'residential', color: linear(0xf3d1a8), balconies: true },
    { x0: 70, z0: -104, x1: 104, z1: -66, h: floors('glass', 118), style: 'glass', color: linear(0x8d949a), balconies: false },
    { x0: 16, z0: -104, x1: 54, z1: -62, h: floors('office', 46), style: 'office', color: linear(0xb9b4aa), balconies: false },
    { x0: 72, z0: -50, x1: 104, z1: -18, h: floors('residential', 14), style: 'residential', color: linear(0xbfe3d6), balconies: false },
  ];
  const special = [PLAZA, PARKING, FENCED, NORTH];
  for (let i = 0; i < SPANS.length; i++) {
    for (let j = 0; j < SPANS.length; j++) {
      if (special.some((b) => b.i === i && b.j === j)) continue;
      const b = blockAt(i, j);
      const inner = i >= 1 && i <= 4 && j >= 1 && j <= 4;
      const core = inner && Math.max(Math.abs(i - 2.5), Math.abs(j - 2.5)) < 1;
      const r = rng.fork(`block-${i}-${j}`);
      if (!inner) {
        // Outer ring: a few low-rise buildings among grass lots.
        if (r.chance(0.35)) {
          const [x0, x1] = within(b.x0, b.x1, r.range(18, 30), r);
          const [z0, z1] = within(b.z0, b.z1, r.range(14, 26), r);
          out.push({ x0, z0, x1, z1, h: floors('residential', r.range(5, 12)), style: 'residential', color: linear(r.pick(STUCCO)), balconies: false });
        }
        continue;
      }
      // Inner blocks: up to one building per quadrant, set back behind the sidewalk.
      const mx = (b.x0 + b.x1) / 2;
      const mz = (b.z0 + b.z1) / 2;
      for (const [qx0, qx1] of [[b.x0 + WALK + 2, mx - 3], [mx + 3, b.x1 - WALK - 2]]) {
        for (const [qz0, qz1] of [[b.z0 + WALK + 2, mz - 3], [mz + 3, b.z1 - WALK - 2]]) {
          if (!r.chance(core ? 0.8 : 0.5)) continue;
          const x0 = qx0 + r.range(0, 6);
          const x1 = qx1 - r.range(0, 6);
          const z0 = qz0 + r.range(0, 6);
          const z1 = qz1 - r.range(0, 6);
          const tall = r.chance(core ? 0.7 : 0.2);
          const style: Style = tall ? (r.chance(0.6) ? 'glass' : 'office') : r.chance(0.7) ? 'residential' : 'office';
          const h = floors(style, tall ? r.range(50, 120) : r.range(10, 36));
          const color = style === 'glass' ? linear(r.pick([0x8d949a, 0x6f7a80, 0xa3a7a8])) : style === 'office' ? linear(r.pick([0xb9b4aa, 0xcfc9bd, 0x9e9a92])) : linear(r.pick(STUCCO));
          out.push({ x0, z0, x1, z1, h, style, color, balconies: false });
        }
      }
    }
  }
  return out;
}

// -----------------------------------------------------------------------------------------------
// Scene.
// -----------------------------------------------------------------------------------------------

export function buildCoreScene(ctx: CoreSceneContext): CoreScene {
  const { scene, lamps } = ctx;
  const rng = new Rng('engine-core-scene');
  const root = new THREE.Group();
  root.name = 'CoreScene';
  scene.add(root);

  // Emission levels, set from `night` in update().
  const lampNits = uniform(0);
  const carLights = uniform(0);
  const windowFraction = uniform(0.1);
  const windowGain = uniform(0.5);

  root.add(buildGround());
  root.add(buildBlocks());
  const buildings = planBuildings(rng.fork('buildings'));
  root.add(...buildBuildings(buildings, windowFraction, windowGain));
  root.add(...buildStreetLamps(rng.fork('lamps'), lamps, lampNits));
  root.add(...buildLanterns(rng.fork('lanterns'), lamps, lampNits));
  root.add(...buildPowerLines());
  root.add(...buildFence());
  root.add(...buildPalms(rng.fork('palms'), buildings));
  const wheel = buildWheel();
  root.add(wheel.stand, wheel.rotor);
  root.add(...buildMaterialRow());
  const cars = buildCars(rng.fork('cars'), lamps, carLights);
  root.add(...cars.meshes);

  return {
    update(_dt: number, elapsed: number, night: number): void {
      // Street lights switch on at dusk (photocells), and so do headlights.
      const on = THREE.MathUtils.smoothstep(night, 0.3, 0.5);
      lamps.dimmer = on;
      lampNits.value = LAMP_LENS_NITS * on;
      carLights.value = on;
      // More windows light up as it gets dark, and interiors get brighter relative to daylight.
      windowFraction.value = 0.1 + 0.35 * night;
      windowGain.value = 0.5 + 0.5 * night;
      wheel.rotor.rotation.z = -elapsed * WHEEL_SPEED;
      cars.update(elapsed);
    },
    spots: {
      plaza: { pos: [40, 1.7, 38.5], look: [40.5, 1.1, 29] },
      street: { pos: [-175, 1.7, 9.5], look: [0, 3, -2] },
      wires: { pos: [70, 1.7, 97], look: [84, 11, 112] },
      overview: { pos: [-230, 120, 250], look: [20, 0, 10] },
      fan: { pos: [92, 2.2, 52], look: [92, 10.5, 28] },
      fence: { pos: [128.5, 1.7, 52], look: [133, 1.2, 24] },
      balconies: { pos: [30, 1.7, 8], look: [40, 14, -19] },
      parking: { pos: [-20, 3, 110], look: [-60, 0, 60] },
    },
  };
}

// -----------------------------------------------------------------------------------------------
// Ground: roads with markings, and a field around the district.
// -----------------------------------------------------------------------------------------------

/** Lane markings of a road: `across` from its centre line, `past` from the nearest cross street's centre line. */
function roadMarkings(across: Node<'float'>, past: Node<'float'>, along: Node<'float'>, stopSign: number) {
  const e = abs(past).sub(ROAD); // distance beyond the cross street's curb line
  const aa = abs(across);
  const wa = footprint(across);
  const we = footprint(e);
  // Zebra crosswalk: 0.6 m bars along the road, 3 m wide, 1 m from the corner.
  const crosswalk = band(e, 1, 4, we).mul(band(aa, 0, 6.3, wa)).mul(band(fract(across.div(1.2)), 0.25, 0.75, wa.div(1.2)));
  // Stop line across the lanes that approach the intersection (traffic keeps right).
  const stop = band(e, 4.6, 5.0, we).mul(band(aa, 0.3, 6.8, wa)).mul(step(0, across.mul(past).mul(stopSign)));
  const open = step(5.2, e);
  // Double yellow centre line and dashed white lane lines (3 m dashes, 12 m period).
  const yellow = band(aa, 0.1, 0.25, wa).mul(open);
  const dash = band(fract(along.div(12)), 0, 0.25, footprint(along).div(12));
  const lanes = band(aa, 3.425, 3.575, wa).mul(dash).mul(open);
  return { white: max(max(crosswalk, stop), lanes), yellow };
}

function buildGround(): THREE.Mesh {
  const p = positionWorld.xz;
  const inside = step(abs(p.x), HALF).mul(step(abs(p.y), HALF));
  const ix = round(p.x.div(PITCH));
  const iz = round(p.y.div(PITCH));
  const ax = p.x.sub(ix.mul(PITCH)); // offset from the nearest north-south centre line
  const az = p.y.sub(iz.mul(PITCH)); // ... and east-west
  const onNS = step(abs(ax), ROAD).mul(step(abs(ix), 2)).mul(inside);
  const onEW = step(abs(az), ROAD).mul(step(abs(iz), 2)).mul(inside);
  const ns = roadMarkings(ax, az, p.y, 1);
  const ew = roadMarkings(az, ax, p.x, -1);
  const white = max(ns.white.mul(onNS), ew.white.mul(onEW));
  const yellow = max(ns.yellow.mul(onNS), ew.yellow.mul(onEW));

  // Worn asphalt (albedo ~0.08-0.13): large patches, fine grain and darker wheel tracks.
  const macro = mx_noise_float(p.mul(0.035));
  const grain = mx_noise_float(p.mul(2.7));
  const tracks = (across: Node<'float'>) => band(abs(fract(abs(across).div(LANE)).sub(0.5)), 0.12, 0.3, footprint(across).div(LANE));
  const track = max(onNS.mul(tracks(ax)), onEW.mul(tracks(az)));
  const asphalt = float(0.105).add(macro.mul(0.02)).add(grain.mul(0.01)).sub(track.mul(0.012));
  const road = vec3(1.0, 0.98, 0.95).mul(asphalt);
  const paint = mix(vec3(0.72, 0.72, 0.7), vec3(0.62, 0.42, 0.06), yellow).mul(float(0.85).add(grain.mul(0.15)));
  const painted = max(white, yellow);
  // Outside the district: rough grass and dry patches (albedo ~0.15-0.2).
  const field = mix(vec3(0.1, 0.15, 0.05), vec3(0.2, 0.18, 0.1), smoothstep(-0.3, 0.6, mx_noise_float(p.mul(0.02))));

  const material = new MeshStandardNodeMaterial();
  material.colorNode = mix(field, mix(road, paint, painted), inside);
  material.roughnessNode = mix(float(0.95), mix(float(0.92), float(0.6), painted), inside);
  const mesh = meshOf(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), material, false);
  mesh.name = 'ground';
  return mesh;
}

// -----------------------------------------------------------------------------------------------
// Blocks: raised sidewalks with curbs around grass lots, the plaza and the parking lot.
// -----------------------------------------------------------------------------------------------

function buildBlocks(): THREE.Mesh {
  const m = new Mesher({ rect: 4, lot: 1 });
  for (let i = 0; i < SPANS.length; i++) {
    for (let j = 0; j < SPANS.length; j++) {
      const b = [PLAZA, PARKING].find((s) => s.i === i && s.j === j) ?? blockAt(i, j);
      m.attr.rect = [b.x0, b.z0, b.x1, b.z1];
      m.attr.lot = [b.lot];
      m.box(b.x0, 0, b.z0, b.x1, CURB, b.z1, '+x -x +y +z -z');
    }
  }
  const rect = attribute('rect', 'vec4');
  const lot = attribute('lot', 'float');
  const p = positionWorld.xz;
  // Distance inside the block from its curb line.
  const d = min(min(p.x.sub(rect.x), rect.z.sub(p.x)), min(p.y.sub(rect.y), rect.w.sub(p.y)));
  const wd = footprint(d);
  const noise = mx_noise_float(p.mul(0.3));

  // Sidewalk: 1.5 m concrete slabs (albedo ~0.33) with dark joints, a lighter curb stone.
  const slabs = float(0.33).mul(float(1).add(noise.mul(0.08))).mul(oneMinus(gridLines(p, 1.5, 0.008).mul(0.4)));
  const curbTop = oneMinus(smoothstep(float(0.2).sub(wd), float(0.2).add(wd), d));
  const walk = mix(vec3(slabs, slabs, slabs.mul(0.96)), vec3(0.4, 0.4, 0.38), curbTop);
  const inWalk = oneMinus(smoothstep(float(WALK).sub(wd), float(WALK).add(wd), d));

  // Lots.
  const grass = mix(vec3(0.09, 0.14, 0.04), vec3(0.17, 0.17, 0.08), smoothstep(-0.4, 0.8, mx_noise_float(p.mul(0.08)))).mul(float(1).add(mx_noise_float(p.mul(1.9)).mul(0.15)));
  const paver = mx_cell_noise_float(p.div(1.2));
  const plazaTone = float(0.36).add(paver.mul(0.08)).mul(oneMinus(gridLines(p, 1.2, 0.006).mul(0.35)));
  const plaza = vec3(plazaTone, plazaTone.mul(0.97), plazaTone.mul(0.92));
  // Parking: asphalt behind a 2 m planting strip, rows of 2.7 m stalls (17 m modules: stall, aisle, stall).
  const lz = mod(p.y.sub(rect.y).sub(8), 17);
  const stallRows = oneMinus(band(lz, 5.5, 11.5, footprint(p.y)));
  const stallLines = oneMinus(smoothstep(0.05, 0.08, float(0.5).sub(abs(fract(p.x.sub(rect.x).sub(8).div(2.7)).sub(0.5))).mul(2.7)));
  const lotAsphalt = float(0.1).add(noise.mul(0.015));
  const stalls = stallRows.mul(stallLines).mul(step(8, d));
  const parking = mix(mix(grass, vec3(lotAsphalt, lotAsphalt, lotAsphalt), step(6, d)), vec3(0.7, 0.7, 0.68), stalls);
  const lotColor = select(lot.lessThan(0.5), grass, select(lot.lessThan(1.5), plaza, parking));
  const lotRough = select(lot.lessThan(0.5), float(0.95), select(lot.lessThan(1.5), float(0.75), mix(float(0.9), float(0.65), stalls)));

  const side = oneMinus(step(0.5, normalGeometry.y)); // curb faces
  const material = new MeshStandardNodeMaterial();
  material.colorNode = mix(mix(lotColor, walk, inWalk), vec3(0.38, 0.38, 0.36), side);
  material.roughnessNode = mix(mix(lotRough, float(0.85), inWalk), float(0.85), side);
  const mesh = meshOf(m.geometry(), material, true);
  mesh.name = 'blocks';
  return mesh;
}

// -----------------------------------------------------------------------------------------------
// Buildings: boxes with parapets and window grids; balconies with thin railings.
// -----------------------------------------------------------------------------------------------

function buildBuildings(list: Building[], windowFraction: Node<'float'>, windowGain: Node<'float'>): THREE.Object3D[] {
  const m = new Mesher({ bRect: 4, bPar: 4, bWin: 4, bCol: 3, facade: 1 });
  const bars: THREE.Matrix4[] = [];
  list.forEach((b, n) => {
    const w = WINDOWS[b.style];
    m.attr.bRect = [b.x0, b.z0, b.x1, b.z1];
    m.attr.bPar = [b.h, w.floor, w.glass, n * 7.31];
    m.attr.bWin = [w.pitch, w.margin, w.sill, w.head];
    m.attr.bCol = [b.color.r, b.color.g, b.color.b];
    // Outer walls (with windows) run up to the parapet top.
    m.attr.facade = [1];
    m.box(b.x0, CURB, b.z0, b.x1, b.h + PARAPET, b.z1, '+x -x +z -z');
    m.attr.facade = [0];
    const t = PARAPET_T;
    m.box(b.x0 + t, b.h, b.z0 + t, b.x1 - t, b.h, b.z1 - t, '+y');
    m.box(b.x0 + t, b.h, b.z0 + t, b.x1 - t, b.h + PARAPET, b.z1 - t, '+x -x +z -z', true);
    const top = b.h + PARAPET;
    m.box(b.x0, top, b.z0, b.x1, top, b.z0 + t, '+y');
    m.box(b.x0, top, b.z1 - t, b.x1, top, b.z1, '+y');
    m.box(b.x0, top, b.z0 + t, b.x0 + t, top, b.z1 - t, '+y');
    m.box(b.x1 - t, top, b.z0 + t, b.x1, top, b.z1 - t, '+y');
    // Rooftop plant room.
    const pw = Math.min(8, (b.x1 - b.x0) * 0.4);
    const pd = Math.min(6, (b.z1 - b.z0) * 0.4);
    const px = (b.x0 + b.x1) / 2 + (n % 3) - 1;
    const pz = (b.z0 + b.z1) / 2;
    m.box(px - pw / 2, b.h, pz - pd / 2, px + pw / 2, b.h + 2.6, pz + pd / 2, '+x -x +y +z -z');
    if (b.balconies) addBalconies(m, b, bars);
  });

  const rect = attribute('bRect', 'vec4');
  const par = attribute('bPar', 'vec4');
  const win = attribute('bWin', 'vec4');
  const base = attribute('bCol', 'vec3');
  const facade = attribute('facade', 'float');
  const p = positionWorld;
  const n = normalGeometry;
  // Walls facing ±Z run along X; walls facing ±X run along Z.
  const alongX = step(0.5, abs(n.z));
  const u = mix(p.z.sub(rect.y), p.x.sub(rect.x), alongX);
  const width = mix(rect.w.sub(rect.y), rect.z.sub(rect.x), alongX);
  // The epsilon keeps exact fits (32 m / 3.2 m) from flickering between column counts.
  const cols = max(floor(width.div(win.x).add(1e-3)), 1);
  const cu = u.div(width.div(cols));
  const cv = p.y.sub(CURB).div(par.y);
  const col = floor(cu);
  const row = floor(cv);
  const groundFloor = step(row, 0.5);
  // Taller shop windows on the ground floor.
  const sill = mix(win.z, float(0.06), groundFloor);
  const inWindow = facade
    .mul(band(fract(cu), win.y, oneMinus(win.y), footprint(cu)))
    .mul(band(fract(cv), sill, win.w, footprint(cv)))
    .mul(step(p.y, par.x.sub(0.2)));
  // Per-window randomness (lit or not, colour temperature, brightness).
  const face = n.x.add(n.z.mul(2)).add(2);
  const seed = par.w.add(face.mul(101));
  const h1 = mx_cell_noise_float(vec3(col, row, seed));
  const h2 = mx_cell_noise_float(vec3(col, row, seed.add(37)));
  const h3 = mx_cell_noise_float(vec3(col.add(0.5).div(3), row, seed.add(71)));
  // Shops and lobbies stay lit; upper floors light up with the night.
  const lit = step(h1, mix(windowFraction, float(0.85), groundFloor));
  const warm = mix(vec3(...kelvin(2700)), vec3(...kelvin(4200)), h2.mul(h2));
  const interior = nits(warm, mix(float(20), float(80), h3).mul(windowGain));

  const roof = step(0.5, n.y).mul(oneMinus(facade));
  const wallTone = float(0.94).add(mx_noise_float(p.mul(0.25)).mul(0.06));
  const wall = mix(base.mul(wallTone), vec3(0.5, 0.5, 0.48).mul(wallTone), roof);
  const glassKind = par.z;
  const glass = mix(vec3(0.02, 0.022, 0.025), vec3(0.2, 0.26, 0.28), glassKind);

  const material = new MeshStandardNodeMaterial();
  material.colorNode = mix(wall, glass, inWindow);
  material.roughnessNode = mix(mix(float(0.85), float(0.35), glassKind.mul(facade)), float(0.04), inWindow);
  material.metalnessNode = mix(glassKind.mul(facade).mul(0.6), glassKind.mul(0.7), inWindow);
  material.emissiveNode = interior.mul(inWindow.mul(lit));
  const mesh = meshOf(m.geometry(), material, true);
  mesh.name = 'buildings';

  const railMaterial = new MeshStandardNodeMaterial({ color: linear(0xe8e6e0), roughness: 0.45 });
  const railings = instanced(new THREE.BoxGeometry(1, 1, 1), railMaterial, bars, false);
  railings.name = 'railings';
  return [mesh, railings];
}

/** Balconies on the ±Z facades: slabs in the building mesh, railing bars as instances. */
function addBalconies(m: Mesher, b: Building, bars: THREE.Matrix4[]): void {
  const w = WINDOWS[b.style];
  const width = b.x1 - b.x0;
  const cols = Math.max(1, Math.floor(width / w.pitch + 1e-3));
  const cw = width / cols;
  const levels = Math.round((b.h - CURB) / w.floor);
  const depth = 1.3;
  const bw = Math.min(2.8, 2 * cw - 0.4);
  const bar = (x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
    bars.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz)));
  for (let f = 1; f < levels; f++) {
    const y = CURB + f * w.floor;
    for (let c = 1; c < cols; c += 2) {
      const cx = b.x0 + c * cw;
      for (const s of [1, -1]) {
        const wall = s > 0 ? b.z1 : b.z0;
        const front = wall + s * depth;
        m.box(cx - bw / 2, y - 0.16, Math.min(wall, front), cx + bw / 2, y, Math.max(wall, front), s > 0 ? '+x -x +y -y +z' : '+x -x +y -y -z');
        const rail = y + 1.0;
        const fz = front - s * 0.03;
        // Top rails (front and sides), then 18 mm balusters every 11 cm.
        bar(cx, rail, fz, bw, 0.045, 0.045);
        for (const sx of [-1, 1]) bar(cx + (sx * bw) / 2 - sx * 0.03, rail, wall + (s * depth) / 2, 0.045, 0.045, depth);
        const nFront = Math.round(bw / 0.11);
        for (let k = 0; k <= nFront; k++) bar(cx - bw / 2 + 0.03 + (k * (bw - 0.06)) / nFront, y + 0.5, fz, 0.018, 1.0, 0.018);
        const nSide = Math.round(depth / 0.11);
        for (const sx of [-1, 1]) {
          for (let k = 1; k < nSide; k++) bar(cx + (sx * bw) / 2 - sx * 0.03, y + 0.5, wall + (s * k * depth) / nSide, 0.018, 1.0, 0.018);
        }
      }
    }
  }
}

// -----------------------------------------------------------------------------------------------
// Street lamps: cobra heads on both sidewalks of every street, each a LightPool lamp.
// -----------------------------------------------------------------------------------------------

/** Lamp point in the pole's frame (arm along +X, towards the road). */
const LAMP_POINT = new THREE.Vector3(2.55, 8.8, 0);

function buildStreetLamps(rng: Rng, lamps: LightPool, lampNits: Node<'float'>): THREE.Object3D[] {
  const matrices: THREE.Matrix4[] = [];
  const color = new THREE.Color(...kelvin(3000));
  const put = (x: number, z: number, yaw: number) => {
    const m = placement(x, CURB, z, yaw);
    matrices.push(m);
    const p = LAMP_POINT.clone().applyMatrix4(m);
    lamps.add(p.x, p.y, p.z, rng.range(LAMP_CD[0], LAMP_CD[1]), color, LAMP_RANGE);
  };
  for (const c of STREETS) {
    for (const s of [-1, 1]) {
      for (let t = -290 + (s > 0 ? 16 : 0); t <= 290; t += 32) {
        // Keep clear of intersections and their corners.
        if (Math.abs(t - Math.round(t / PITCH) * PITCH) < 14) continue;
        const off = c + s * (ROAD + 0.6);
        put(off, t, s > 0 ? Math.PI : 0); // north-south street: arm points across X
        put(t, off, (s * Math.PI) / 2); // east-west street: arm points across Z
      }
    }
  }
  const pole = merge([
    rod([0, 0, 0], [0, 8.9, 0], 0.1, 8, 0.07),
    rod([0, 8.7, 0], [2.3, 9.15, 0], 0.045, 6),
    box(0.72, 0.13, 0.32, 2.55, 9.12, 0),
    box(0.34, 0.45, 0.34, 0, 0.225, 0),
  ]);
  const poleMaterial = new MeshStandardNodeMaterial({ color: linear(0x8f9496), roughness: 0.55, metalness: 0.5 });
  const lensMaterial = new MeshStandardNodeMaterial({ color: linear(0xd8d8d2), roughness: 0.3 });
  lensMaterial.emissiveNode = nits(kelvin(3000), lampNits);
  const poles = instanced(pole, poleMaterial, matrices, true);
  poles.name = 'lamp-poles';
  const lenses = instanced(box(0.5, 0.02, 0.24, 2.55, 9.035, 0), lensMaterial, matrices, false);
  lenses.name = 'lamp-lenses';
  return [poles, lenses];
}

/** Post-top lanterns on a grid over the plaza, two of them lighting the material row from the front. */
function buildLanterns(rng: Rng, lamps: LightPool, lampNits: Node<'float'>): THREE.Object3D[] {
  const spots: [number, number][] = [[34, 37], [47, 37]];
  for (const x of [20, 47, 74, 101]) for (const z of [18, 50, 82]) spots.push([x, z]);
  const color = new THREE.Color(...kelvin(3000));
  const height = 4.45;
  for (const [x, z] of spots) lamps.add(x, CURB + height, z, rng.range(LANTERN_CD[0], LANTERN_CD[1]), color, LANTERN_RANGE);
  const matrices = spots.map(([x, z]) => placement(x, CURB, z));
  const post = merge([box(0.3, 0.4, 0.3, 0, 0.2, 0), rod([0, 0, 0], [0, 4.2, 0], 0.07, 8, 0.05), new THREE.CylinderGeometry(0.25, 0.2, 0.08, 12).translate(0, 4.74, 0)]);
  const dark = new MeshStandardNodeMaterial({ color: linear(0x2b2d2f), roughness: 0.5, metalness: 0.4 });
  const globe = new MeshStandardNodeMaterial({ color: linear(0xe8e4dc), roughness: 0.4 });
  globe.emissiveNode = nits(kelvin(3000), lampNits.mul(LANTERN_NITS / LAMP_LENS_NITS));
  const posts = instanced(post, dark, matrices, true);
  posts.name = 'lantern-posts';
  const globes = instanced(new THREE.CylinderGeometry(0.19, 0.14, 0.5, 12).translate(0, height, 0), globe, matrices, false);
  globes.name = 'lantern-globes';
  return [posts, globes];
}

// -----------------------------------------------------------------------------------------------
// Power lines: wooden poles along the street south of the plaza, 1.5 cm cables that sag.
// -----------------------------------------------------------------------------------------------

function buildPowerLines(): THREE.Object3D[] {
  const z = PLAZA.z1 - 3.2; // back of the plaza's south sidewalk
  const xs = [12, 48, 84, 110, 131, 167, 203, 229];
  const pole = merge([
    rod([0, 0, 0], [0, 11.2, 0], 0.15, 8, 0.11),
    box(0.1, 0.1, 2.5, 0, 10.4, 0),
    ...[-1.05, -0.35, 1.05].map((dz) => rod([0, 10.45, dz], [0, 10.63, dz], 0.05, 6)),
    box(0.08, 0.08, 0.2, 0, 7.6, 0.14),
    box(0.08, 0.08, 0.2, 0, 7.2, 0.14),
  ]);
  const wood = new MeshStandardNodeMaterial({ color: linear(0x6b5a48), roughness: 0.9 });
  const poles = instanced(pole, wood, xs.map((x) => placement(x, CURB, z)), true);
  poles.name = 'utility-poles';

  const cables: THREE.BufferGeometry[] = [];
  for (let k = 0; k + 1 < xs.length; k++) {
    const span = xs[k + 1] - xs[k];
    const wire = (y: number, dz: number, radius: number, sag: number) => {
      const curve = new Catenary(new THREE.Vector3(xs[k], CURB + y, z + dz), new THREE.Vector3(xs[k + 1], CURB + y, z + dz), sag);
      cables.push(new THREE.TubeGeometry(curve, 48, radius, 5, false));
    };
    for (const dz of [-1.05, -0.35, 1.05]) wire(10.64, dz, 0.015, 0.1 + 0.012 * span);
    wire(7.6, 0.2, 0.02, 0.025 * span);
    wire(7.2, 0.2, 0.025, 0.028 * span);
  }
  const cableMaterial = new MeshStandardNodeMaterial({ color: linear(0x1c1c1c), roughness: 0.6 });
  // Too thin for any shadow map: they would only shimmer.
  const wires = meshOf(merge(cables), cableMaterial, false);
  wires.name = 'power-lines';
  return [poles, wires];
}

// -----------------------------------------------------------------------------------------------
// Chain-link fence around the vacant lot east of the plaza (alpha-tested diamond mesh).
// -----------------------------------------------------------------------------------------------

function buildFence(): THREE.Object3D[] {
  const inset = WALK + 0.5;
  const x0 = FENCED.x0 + inset;
  const x1 = FENCED.x1 - inset;
  const z0 = FENCED.z0 + inset;
  const z1 = FENCED.z1 - inset;
  const height = 2.2;
  const bottom = CURB + 0.04;
  const m = new Mesher({});
  // Four panels; uv runs along the fence and up, in metres.
  m.quad([x0, bottom, z0], [x1 - x0, 0, 0], [0, height, 0]);
  m.quad([x1, bottom, z0], [0, 0, z1 - z0], [0, height, 0]);
  m.quad([x1, bottom, z1], [x0 - x1, 0, 0], [0, height, 0]);
  m.quad([x0, bottom, z1], [0, 0, z0 - z1], [0, height, 0]);

  // 3.5 mm wires woven in 50 mm diamonds.
  const q = uv();
  const pitch = 0.07;
  const wire = (c: Node<'float'>) => {
    const d = float(0.5).sub(abs(fract(c.div(pitch)).sub(0.5))).mul(pitch / Math.SQRT2);
    return step(d, 0.00175);
  };
  const chainLink = new MeshStandardNodeMaterial({ color: linear(0x9a9c9a), roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide });
  chainLink.maskNode = max(wire(q.x.add(q.y)), wire(q.x.sub(q.y))).greaterThan(0.5);
  const panels = meshOf(m.geometry(), chainLink, false);
  panels.name = 'chain-link';

  const frame: THREE.BufferGeometry[] = [];
  const top = bottom + height;
  const corners: V3[] = [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]];
  for (let k = 0; k < 4; k++) {
    const a = corners[k];
    const b = corners[(k + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const posts = Math.ceil(len / 3);
    for (let i = 0; i < posts; i++) {
      const t = i / posts;
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      frame.push(rod([x, CURB, z], [x, top + 0.05, z], i === 0 ? 0.045 : 0.03, 6));
    }
    frame.push(rod([a[0], top, a[2]], [b[0], top, b[2]], 0.02, 6, 0.02, false));
  }
  const steel = new MeshStandardNodeMaterial({ color: linear(0x9a9c9a), roughness: 0.4, metalness: 0.6 });
  const posts = meshOf(merge(frame), steel, true);
  posts.name = 'fence-posts';
  return [panels, posts];
}

// -----------------------------------------------------------------------------------------------
// Palms: curved trunks and crowns of alpha-tested pinnate fronds, instanced.
// -----------------------------------------------------------------------------------------------

const PALM_H = 8;
const PALM_LEAN = 0.9;

function trunkGeometry(): THREE.BufferGeometry {
  const rings = 14;
  const sides = 10;
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const y = t * PALM_H;
    const cx = PALM_LEAN * t * t;
    const r = 0.17 * (1 - 0.3 * t) + 0.12 * (1 - t) ** 8;
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      pos.push(cx + r * Math.cos(a), y, r * Math.sin(a));
      uvs.push(j / sides, y);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j;
      const b = a + sides + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A crown of fronds at the trunk top. uv: x across the frond (-1..1), y along it (0..1); `age` 0 young .. 1 old. */
function crownGeometry(rng: Rng): THREE.BufferGeometry {
  const fronds = 16;
  const segments = 12;
  const pos: number[] = [];
  const uvs: number[] = [];
  const age: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < fronds; k++) {
    const a = k / (fronds - 1);
    const yaw = k * 2.39996 + rng.range(-0.15, 0.15); // golden angle
    const pitch = 0.95 - 1.35 * a + rng.range(-0.1, 0.1);
    const droop = 0.9 + 0.9 * a;
    const len = rng.range(4.0, 4.8);
    const hx = Math.cos(yaw);
    const hz = Math.sin(yaw);
    let x = PALM_LEAN + hx * 0.15;
    let y = PALM_H + 0.1;
    let z = hz * 0.15;
    const base = pos.length / 3;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const w = 0.8 * Math.min(1, 0.25 + t * 4);
      const drop = w * 0.35; // leaflets hang below the rachis
      pos.push(x + hz * w, y - drop, z - hx * w, x, y, z, x - hz * w, y - drop, z + hx * w);
      uvs.push(-1, t, 0, t, 1, t);
      age.push(a, a, a);
      if (i < segments) {
        const r = base + i * 3;
        idx.push(r, r + 1, r + 4, r, r + 4, r + 3, r + 1, r + 2, r + 5, r + 1, r + 5, r + 4);
      }
      const ang = pitch - droop * t ** 1.5;
      const step = len / segments;
      x += hx * Math.cos(ang) * step;
      y += Math.sin(ang) * step;
      z += hz * Math.cos(ang) * step;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('age', new THREE.Float32BufferAttribute(age, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildPalms(rng: Rng, buildings: Building[]): THREE.Object3D[] {
  const spots: [number, number][] = [];
  // A row along the plaza's south edge, under the power lines; two by the material row.
  for (let x = 20; x <= 104; x += 14) spots.push([x, PLAZA.z1 - WALK - 9]);
  spots.push([27, 24], [55, 24], [14, 14]);
  // The planting strip along the parking lot.
  for (let x = -104; x <= -16; x += 22) spots.push([x, PARKING.z0 + WALK + 1]);
  // Scattered over the western and eastern blocks, clear of buildings (a crown spans ~9 m).
  const clear = (x: number, z: number) => buildings.every((b) => x < b.x0 - 5 || x > b.x1 + 5 || z < b.z0 - 5 || z > b.z1 + 5);
  for (let n = 0; n < 12; ) {
    const b = blockAt(rng.pick([0, 1, 4, 5]), rng.int(0, 5));
    const x = rng.range(b.x0 + 8, b.x1 - 8);
    const z = rng.range(b.z0 + 8, b.z1 - 8);
    if (!clear(x, z)) continue;
    spots.push([x, z]);
    n++;
  }
  const matrices = spots.map(([x, z]) => placement(x, CURB, z, rng.range(0, Math.PI * 2), rng.range(0.85, 1.15)));

  const bark = new MeshStandardNodeMaterial({ roughness: 0.9 });
  // Leaf-scar rings every ~9 cm.
  const ring = smoothstep(0.55, 0.95, fract(uv().y.div(0.09)));
  bark.colorNode = vec3(0.3, 0.26, 0.21).mul(float(0.85).add(ring.mul(0.25))).mul(float(1).add(mx_noise_float(uv().mul(vec2(3, 0.6))).mul(0.1)));
  const trunks = instanced(trunkGeometry(), bark, matrices, true);
  trunks.name = 'palm-trunks';

  // Pinnate frond: a rachis with ~40 leaflets a side, angled towards the tip, longest mid-frond.
  const q = uv();
  const across = abs(q.x);
  const along = q.y;
  const age = attribute('age', 'float');
  const reach = smoothstep(0.0, 0.15, along).mul(oneMinus(along.mul(along))).mul(0.97).add(0.02);
  const rachis = step(across, mix(float(0.06), float(0.015), along));
  const phase = fract(along.mul(40).sub(across.mul(4)));
  const leaflet = step(phase, oneMinus(across.div(reach)).mul(0.7)).mul(step(across, reach));
  const leaf = new MeshStandardNodeMaterial({ roughness: 0.55, side: THREE.DoubleSide });
  const green = mix(vec3(0.05, 0.1, 0.022), vec3(0.14, 0.12, 0.04), age.mul(age));
  leaf.colorNode = mix(green.mul(float(1).add(across.mul(0.3))), vec3(0.2, 0.18, 0.07), rachis);
  leaf.maskNode = max(rachis, leaflet).greaterThan(0.5);
  const crowns = instanced(crownGeometry(rng.fork('crown')), leaf, matrices, true);
  crowns.name = 'palm-crowns';
  return [trunks, crowns];
}

// -----------------------------------------------------------------------------------------------
// Wheel: a 19 m observation wheel with thin tension spokes in the plaza, turning slowly.
// -----------------------------------------------------------------------------------------------

function buildWheel(): { stand: THREE.Mesh; rotor: THREE.Mesh } {
  const radius = 9.5;
  const hub: V3 = [92, CURB + 11.5, 28];
  const parts: THREE.BufferGeometry[] = [];
  for (const z of [-0.55, 0.55]) parts.push(new THREE.TorusGeometry(radius, 0.07, 6, 128).translate(0, 0, z));
  parts.push(new THREE.CylinderGeometry(0.45, 0.45, 1.5, 16).rotateX(Math.PI / 2));
  const spokes = 24;
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    const rim = (angle: number, z: number): V3 => [radius * Math.cos(angle), radius * Math.sin(angle), z];
    // Tension spokes leave the hub tangentially, crossing each other.
    for (const [z, twist] of [[-0.55, 0.12], [0.55, -0.12]]) {
      parts.push(rod([0.4 * Math.cos(a), 0.4 * Math.sin(a), z * 1.2], rim(a + twist, z), 0.012, 4, 0.012, false));
    }
    parts.push(rod(rim(a, -0.55), rim(a, 0.55), 0.03, 5, 0.03, false));
  }
  const paint = new MeshStandardNodeMaterial({ color: linear(0xf2f0ea), roughness: 0.4 });
  const rotor = meshOf(merge(parts), paint, true);
  rotor.name = 'wheel';
  rotor.position.set(...hub);

  const legs: THREE.BufferGeometry[] = [rod([0, 0, -1.3], [0, 0, 1.3], 0.16, 12)];
  for (const z of [-1.3, 1.3]) {
    for (const x of [-6, 6]) legs.push(rod([x, -hub[1] + CURB, z * 1.5], [0, 0, z], 0.2, 8, 0.14));
  }
  legs.push(box(14, 0.4, 5, 0, -hub[1] + CURB + 0.2, 0));
  const stand = meshOf(merge(legs), paint, true);
  stand.name = 'wheel-stand';
  stand.position.set(...hub);
  return { stand, rotor };
}

// -----------------------------------------------------------------------------------------------
// Material reference row in the plaza: roughness 0 → 1 (dielectric and metal), cards, chrome, paint.
// -----------------------------------------------------------------------------------------------

function buildMaterialRow(): THREE.Object3D[] {
  const r = 0.45;
  const z = 30;
  const x0 = 36.75;
  const steps = 6;
  const plinths: THREE.BufferGeometry[] = [];
  const matrices: THREE.Matrix4[] = [];
  const params = new Float32Array(steps * 2 * 2);
  for (let metal = 0; metal < 2; metal++) {
    for (let i = 0; i < steps; i++) {
      const x = x0 + i * 1.3;
      const zz = z + (metal ? -1.6 : 0);
      const h = metal ? 1.5 : 0.8;
      plinths.push(box(0.5, h, 0.5, x, CURB + h / 2, zz));
      matrices.push(placement(x, CURB + h + r, zz));
      const k = metal * steps + i;
      params[k * 2] = i / (steps - 1);
      params[k * 2 + 1] = metal;
    }
  }
  // Instance k: roughness, metalness. Dielectric: 50% grey; metal: gold.
  const p = instancedBufferAttribute<'vec2'>(new THREE.InstancedBufferAttribute(params, 2), 'vec2');
  const spheresMaterial = new MeshStandardNodeMaterial();
  spheresMaterial.colorNode = mix(vec3(0.5, 0.5, 0.5), vec3(1.0, 0.71, 0.29), p.y);
  spheresMaterial.roughnessNode = p.x;
  spheresMaterial.metalnessNode = p.y;
  const sphere = new THREE.SphereGeometry(r, 48, 24);
  const spheres = instanced(sphere, spheresMaterial, matrices, true);
  spheres.name = 'reference-spheres';

  // Mirror chrome and clear-coated red car paint at the end of the front row.
  const chromeX = x0 + steps * 1.3 + 0.2;
  const paintX = chromeX + 1.4;
  for (const x of [chromeX, paintX]) plinths.push(box(0.5, 0.8, 0.5, x, CURB + 0.4, z));
  const chrome = meshOf(sphere, new MeshStandardNodeMaterial({ color: new THREE.Color(0.55, 0.556, 0.554), metalness: 1, roughness: 0.02 }), true);
  chrome.position.set(chromeX, CURB + 0.8 + r, z);
  chrome.name = 'chrome-sphere';
  const carPaint = new MeshPhysicalNodeMaterial({ color: new THREE.Color(0.45, 0.015, 0.02), metalness: 0.3, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.03 });
  const paint = meshOf(sphere, carPaint, true);
  paint.position.set(paintX, CURB + 0.8 + r, z);
  paint.name = 'car-paint-sphere';

  // White (0.8) and 18% grey cards on posts, tilted back towards the sun.
  const cardMatrices: THREE.Matrix4[] = [];
  const cardColors = [new THREE.Color(0.18, 0.18, 0.18), new THREE.Color(0.8, 0.8, 0.8)];
  cardColors.forEach((_, i) => {
    const x = x0 - 2.9 + i * 1.1;
    plinths.push(box(0.05, 1.0, 0.05, x, CURB + 0.5, z + 0.05));
    cardMatrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, CURB + 1.35, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0, 0)), new THREE.Vector3(1, 1, 1)));
  });
  const cards = instanced(new THREE.BoxGeometry(0.9, 0.9, 0.02), new MeshStandardNodeMaterial({ roughness: 0.95 }), cardMatrices, true);
  cardColors.forEach((c, i) => cards.setColorAt(i, c));
  cards.name = 'reference-cards';

  const concrete = new MeshStandardNodeMaterial({ color: new THREE.Color(0.35, 0.35, 0.33), roughness: 0.85 });
  const stands = meshOf(merge(plinths), concrete, true);
  stands.name = 'plinths';
  return [spheres, chrome, paint, cards, stands];
}

// -----------------------------------------------------------------------------------------------
// Cars: rounded boxes driving clockwise loops around blocks in the outer lanes (traffic keeps
// right), each with two headlight lamps; more parked in the lot.
// -----------------------------------------------------------------------------------------------

/** A clockwise loop (seen from above, north up) with rounded corners around a block, in its outer lane. */
class Loop {
  readonly length: number;
  private readonly x0: number;
  private readonly z0: number;
  private readonly x1: number;
  private readonly z1: number;
  private readonly r = 6;

  constructor(b: Block) {
    const pad = ROAD - OUTER_LANE;
    this.x0 = b.x0 - pad;
    this.z0 = b.z0 - pad;
    this.x1 = b.x1 + pad;
    this.z1 = b.z1 + pad;
    this.length = 2 * (this.x1 - this.x0 + this.z1 - this.z0 - 4 * this.r) + 2 * Math.PI * this.r;
  }

  /** Position (x, z) and heading φ (direction (cos φ, sin φ) in x, z) at distance s. */
  at(s: number, out: { x: number; z: number; heading: number }): void {
    const r = this.r;
    const w = this.x1 - this.x0 - 2 * r;
    const d = this.z1 - this.z0 - 2 * r;
    const arc = (Math.PI / 2) * r;
    // Sides: north (east-bound), east (south-bound), south (west-bound), west (north-bound).
    const corners: [number, number][] = [[this.x1 - r, this.z0 + r], [this.x1 - r, this.z1 - r], [this.x0 + r, this.z1 - r], [this.x0 + r, this.z0 + r]];
    const lengths = [w, d, w, d];
    s = ((s % this.length) + this.length) % this.length;
    for (let k = 0; k < 4; k++) {
      const phi = (k * Math.PI) / 2;
      const prev = corners[(k + 3) % 4];
      if (s < lengths[k]) {
        // Straight from the previous corner's arc end.
        out.x = prev[0] + r * Math.sin(phi) + Math.cos(phi) * s;
        out.z = prev[1] - r * Math.cos(phi) + Math.sin(phi) * s;
        out.heading = phi;
        return;
      }
      s -= lengths[k];
      if (s < arc || k === 3) {
        const a = phi + Math.min(s, arc) / r;
        out.x = corners[k][0] + r * Math.sin(a);
        out.z = corners[k][1] - r * Math.cos(a);
        out.heading = a;
        return;
      }
      s -= arc;
    }
  }
}

function carParts(): { paint: THREE.BufferGeometry; glass: THREE.BufferGeometry; tyres: THREE.BufferGeometry; lights: THREE.BufferGeometry } {
  // Local frame: forward +X, 4.4 × 1.8 m.
  const paint = merge([
    new RoundedBoxGeometry(4.4, 0.75, 1.8, 2, 0.18).translate(0, 0.68, 0),
    new RoundedBoxGeometry(1.95, 0.1, 1.5, 1, 0.04).translate(-0.3, 1.66, 0),
  ]);
  const glass = new RoundedBoxGeometry(2.4, 0.62, 1.62, 2, 0.16).translate(-0.25, 1.33, 0);
  const tyres = merge([1.4, -1.4].flatMap((x) => [0.8, -0.8].map((z) => new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16).rotateX(Math.PI / 2).translate(x, 0.34, z))));
  const m = new Mesher({ head: 1 });
  m.attr.head = [1];
  for (const z of [-0.55, 0.55]) m.box(2.2, 0.72, z - 0.17, 2.22, 0.86, z + 0.17, '+x');
  m.attr.head = [0];
  for (const z of [-0.62, 0.62]) m.box(-2.22, 0.76, z - 0.15, -2.2, 0.87, z + 0.15, '-x');
  return { paint, glass, tyres, lights: m.geometry() };
}

function buildCars(rng: Rng, lamps: LightPool, carLights: Node<'float'>): { meshes: THREE.Object3D[]; update(elapsed: number): void } {
  // Moving cars loop around the blocks on both sides of the main street (z = 0).
  const drivers: { loop: Loop; s0: number; speed: number; lamps: [number, number] }[] = [];
  const white = new THREE.Color(...kelvin(5000));
  for (let i = 1; i <= 4; i++) {
    for (const j of [2, 3]) {
      const loop = new Loop(blockAt(i, j));
      const n = rng.int(3, 4);
      const start = rng.range(0, loop.length);
      // One speed per loop, so cars never catch up with each other.
      const speed = rng.range(8, 12);
      for (let k = 0; k < n; k++) {
        const cd = rng.range(HEADLIGHT_CD[0], HEADLIGHT_CD[1]);
        drivers.push({
          loop,
          s0: start + (k * loop.length) / n + rng.range(-10, 10),
          speed,
          lamps: [lamps.add(0, 0, 0, cd, white, HEADLIGHT_RANGE), lamps.add(0, 0, 0, cd, white, HEADLIGHT_RANGE)],
        });
      }
    }
  }
  // Parked cars nose-in in the lot's stalls.
  const parked: THREE.Matrix4[] = [];
  for (let row = 0; row < 5; row++) {
    for (const side of [0, 1]) {
      const z = PARKING.z0 + 8 + row * 17 + (side ? 14.25 : 2.75);
      if (z > PARKING.z1 - 9) continue;
      for (let k = 0; k < 34; k++) {
        const x = PARKING.x0 + 8 + (k + 0.5) * 2.7;
        if (x > PARKING.x1 - 9 || !rng.chance(0.13)) continue;
        parked.push(placement(x, CURB, z, side ? -Math.PI / 2 : Math.PI / 2));
      }
    }
  }
  const count = drivers.length + parked.length;
  const parts = carParts();
  const paintMaterial = new MeshPhysicalNodeMaterial({ metalness: 0.35, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.05 });
  const glassMaterial = new MeshStandardNodeMaterial({ color: new THREE.Color(0.02, 0.022, 0.025), roughness: 0.05 });
  const tyreMaterial = new MeshStandardNodeMaterial({ color: new THREE.Color(0.035, 0.035, 0.035), roughness: 0.85 });
  // Head and tail lights glow only on moving cars.
  const running = new Float32Array(count);
  running.fill(1, 0, drivers.length);
  const on = instancedBufferAttribute<'float'>(new THREE.InstancedBufferAttribute(running, 1), 'float');
  const head = attribute('head', 'float');
  const lightMaterial = new MeshStandardNodeMaterial({ roughness: 0.2 });
  lightMaterial.colorNode = mix(vec3(0.3, 0.02, 0.02), vec3(0.8, 0.8, 0.8), head);
  lightMaterial.emissiveNode = nits(mix(vec3(...unitLuminance([1, 0.03, 0.015])), vec3(...kelvin(5000)), head), mix(float(TAILLIGHT_NITS), float(HEADLIGHT_NITS), head).mul(carLights).mul(on));

  const meshes = [
    new THREE.InstancedMesh(parts.paint, paintMaterial, count),
    new THREE.InstancedMesh(parts.glass, glassMaterial, count),
    new THREE.InstancedMesh(parts.tyres, tyreMaterial, count),
    new THREE.InstancedMesh(parts.lights, lightMaterial, count),
  ];
  // One matrix buffer drives all four parts.
  const matrices = meshes[0].instanceMatrix;
  matrices.setUsage(THREE.DynamicDrawUsage);
  const colors = [0xf2f2f0, 0xc8cacc, 0x18191b, 0x5d6166, 0x8c1c1c, 0x1d3f73, 0x2f4d3a, 0xb8a78a];
  meshes.forEach((mesh, k) => {
    mesh.instanceMatrix = matrices;
    mesh.frustumCulled = false; // instances move; their bounds are never recomputed
    mesh.castShadow = k < 3;
    mesh.receiveShadow = true;
    mesh.name = ['car-paint', 'car-glass', 'car-tyres', 'car-lights'][k];
  });
  for (let i = 0; i < count; i++) meshes[0].setColorAt(i, linear(rng.pick(colors)));
  parked.forEach((m, k) => meshes[0].setMatrixAt(drivers.length + k, m));

  const pose = { x: 0, z: 0, heading: 0 };
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const update = (elapsed: number) => {
    drivers.forEach((d, i) => {
      d.loop.at(d.s0 + d.speed * elapsed, pose);
      quat.setFromAxisAngle(Y_AXIS, -pose.heading);
      matrix.compose(pos.set(pose.x, 0, pose.z), quat, one);
      meshes[0].setMatrixAt(i, matrix);
      // Headlights a little ahead of the bumper, so they light the road rather than the bonnet.
      const fx = Math.cos(pose.heading);
      const fz = Math.sin(pose.heading);
      for (const [n, side] of [[0, -1], [1, 1]]) {
        lamps.setPosition(d.lamps[n], pose.x + fx * 2.7 - fz * 0.6 * side, 0.75, pose.z + fz * 2.7 + fx * 0.6 * side);
      }
    });
    matrices.needsUpdate = true;
  };
  update(0);
  return { meshes, update };
}
