// Window glass with rooms behind it (interior mapping, after van Dongen 2008): each pane shades
// the room that would be behind it by tracing the view ray into a box — back wall, side walls,
// floor and ceiling — so windows show depth and parallax instead of flat dark rectangles, with
// no geometry behind the facade.
//
// Per pane the geometry supplies UVs 0..1 across the glass and a `weathering` attribute of (seed,
// width, height) in metres (MeshBuilder.pane). The seed picks the room: its depth, wall, floor and
// ceiling colours, whether a lamp is on (warm light, some windows at golden hour), and whether the
// blinds are down and how far. The glass itself is a Fresnel reflector over the room, so it
// reflects the street and sky (image-based light and screen-space reflections) and you see into
// the room more when looking straight in than at a glancing angle.
import {
  abs,
  attribute,
  cameraPosition,
  cross,
  dot,
  float,
  fract,
  hash,
  max,
  min,
  mix,
  normalize,
  normalView,
  normalWorld,
  positionWorld,
  select,
  smoothstep,
  step,
  uv,
  vec3,
} from 'three/tsl';
import { Color, MeshPhysicalNodeMaterial } from 'three/webgpu';
import { fresnel, markReflective } from '../../PostProcessing';
import type { F, V3 } from '../../noise';

export interface WindowStyle {
  /** Glass tint (linear RGB multiplier on what shows through). */
  tint?: Color;
  /** Share of rooms with the lights on. */
  litShare?: number;
  /** Shop interiors: deeper, brighter, all lit. */
  shop?: boolean;
  /** Mirror coating (reflective curtain-wall glass): 0 clear … 1 mirrored. */
  coating?: number;
}

/** Interior-mapped window glass. One material serves every pane of a style. */
export function windowGlass(style: WindowStyle = {}): MeshPhysicalNodeMaterial {
  const { tint = new Color(0.82, 0.88, 0.86), litShare = 0.18, shop = false, coating = 0 } = style;
  const m = new MeshPhysicalNodeMaterial({ name: shop ? 'Shop window' : 'Window' });
  const w = attribute('weathering', 'vec3') as unknown as V3;
  const seed = w.x;
  const size = w.yz;
  const r = (k: number): F => hash(seed.mul(1000).add(k * 17.31));

  // Tangent frame of the pane: right, up and into the building.
  const n = normalize(normalWorld);
  const up = vec3(0, 1, 0);
  const right = normalize(cross(up, n));
  const inward = n.negate();
  const view = normalize(positionWorld.sub(cameraPosition));
  const d = vec3(dot(view, right), dot(view, up), max(dot(view, inward), 1e-3));

  // The ray starts on the glass at (x, y) metres from the pane's bottom-left corner.
  const p = uv().mul(size);
  // Room: a little wider than the pane, floor below the sill, ceiling above the head.
  const depth = shop ? r(1).mul(4).add(5) : r(1).mul(3).add(3);
  const x0 = float(-0.8);
  const x1 = size.x.add(0.8);
  const y0 = float(shop ? -0.4 : -0.95);
  const y1 = size.y.add(shop ? 0.6 : 0.45);
  const tx = select(d.x.greaterThan(0), x1.sub(p.x), x0.sub(p.x)).div(d.x.add(select(d.x.greaterThan(0), 1e-4, -1e-4)));
  const ty = select(d.y.greaterThan(0), y1.sub(p.y), y0.sub(p.y)).div(d.y.add(select(d.y.greaterThan(0), 1e-4, -1e-4)));
  const tz = depth.div(d.z);
  const t = min(min(tx, ty), tz);
  const hit = vec3(p.x, p.y, 0).add(d.mul(t));

  // Which surface: back wall, side wall, floor or ceiling.
  const isBack = step(tz, min(tx, ty));
  const isSide = step(tx, min(ty, tz)).mul(float(1).sub(isBack));
  const isFloor = step(ty, min(tx, tz)).mul(step(d.y, 0)).mul(float(1).sub(isBack)).mul(float(1).sub(isSide));
  const isCeil = float(1).sub(isBack).sub(isSide).sub(isFloor).clamp(0, 1);

  // Colours from the seed: whites and pale plasters, wood or grey floors, white ceilings.
  const wallTone = r(2);
  const wall = mix(vec3(0.78, 0.76, 0.72), mix(vec3(0.72, 0.62, 0.5), vec3(0.55, 0.62, 0.66), step(0.5, r(3))), step(0.7, wallTone));
  const floorC = mix(vec3(0.32, 0.2, 0.11), vec3(0.3, 0.3, 0.31), step(0.55, r(4)));
  const ceiling = vec3(0.85, 0.84, 0.82);
  // A picture or shelf on the back wall: a darker rectangle.
  const art = step(abs(hit.x.sub(size.x.mul(r(5)))), 0.45).mul(step(abs(hit.y.sub(size.y.mul(0.55))), 0.3)).mul(isBack).mul(step(0.5, r(6)));
  let surface: V3 = wall.mul(isBack.add(isSide.mul(0.85))).add(floorC.mul(isFloor)).add(ceiling.mul(isCeil));
  surface = mix(surface, vec3(0.12, 0.1, 0.09), art);

  // Light: dim daylight from the window (falls off into the room), or a warm lamp.
  const lit = shop ? float(1) : step(float(1).sub(litShare), r(7));
  const daylight = float(0.07).mul(float(1).sub(hit.z.div(depth).mul(0.6)));
  const lamp = vec3(1.0, 0.72, 0.45).mul(shop ? 0.55 : 0.32).mul(float(1).sub(isCeil.mul(0.3)));
  let room: V3 = surface.mul(vec3(daylight)).add(surface.mul(lamp).mul(lit));
  // Ceiling lights: a bright panel in lit rooms.
  const panel = step(abs(hit.x.sub(size.x.mul(0.5))), 0.5).mul(step(abs(hit.z.sub(depth.mul(0.5))), 0.35)).mul(isCeil).mul(lit);
  room = room.add(vec3(1.0, 0.85, 0.65).mul(panel).mul(3));

  // Blinds: horizontal slats from the head down to a random height, just behind the glass.
  const blindTo = select(step(0.45, r(8)).greaterThan(0), size.y.mul(r(9).mul(0.8)), size.y.add(1));
  const slat = smoothstep(0.35, 0.5, abs(fract(p.y.div(0.025)).sub(0.5)));
  const blindLight = mix(float(0.09), float(0.3), lit);
  const blinds = vec3(0.86, 0.84, 0.8).mul(blindLight).mul(float(0.85).add(slat.mul(0.15)));
  room = select(p.y.greaterThan(blindTo), blinds, room);

  // Glass: tinted transmission of the room (less at glancing angles, where it reflects), dirt.
  const f = fresnel(normalView, 0.04);
  const through = float(1).sub(f).mul(1 - coating * 0.85);
  m.colorNode = vec3(0.01, 0.012, 0.014);
  m.emissiveNode = room.mul(vec3(tint.r, tint.g, tint.b)).mul(through);
  m.roughnessNode = float(0.03);
  m.metalnessNode = float(coating * 0.6);
  m.ior = 1.52;
  // Rooms hide behind reflections as they do in real facades: the reflection weight for SSR.
  markReflective(m, max(f, float(coating * 0.5)), float(0.03));
  return m;
}
