// The road and pavement materials: procedural textures plus everything that depends on where a
// point is on the street, computed from its world position.
//
// Road (wet asphalt after rain):
//   wheel paths    two per lane, polished and dark with rubber, sunk 3–4 mm into ruts
//   puddles        water fills the surface below a level: ruts, slow undulations of the road and
//                  the texture's cavities; flat, mirror-like (roughness 0.001, water IOR 1.333),
//                  with rain ripples; a wet film everywhere else (clear coat 1.0, roughness 0.05)
//   markings       double yellow centre line, dashed lane lines, parking lane edge lines with bay
//                  ticks, a continental crosswalk and stop lines, all worn in the wheel paths
//   repairs        tar snakes (sealed cracks) and a couple of patched utility trenches
// Pavement:
//   slabs          1.5 m concrete slabs with sawn joints and slab-to-slab tone variation
//   kerb           granite kerb stones, 1.2 m long, including the kerb face
//   tactile        yellow truncated-dome warning paving at the bottom of the kerb ramps
//   damp           darker, with a thin sheen, water standing in the joints
import {
  abs,
  clamp,
  float,
  floor,
  fract,
  fwidth,
  hash,
  length,
  max,
  mix,
  mx_fractal_noise_float,
  normalMap,
  normalView,
  positionLocal,
  positionWorld,
  smoothstep,
  step,
  texture,
  time,
  transformNormalToView,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import type { PBRSet } from '../ProceduralTextureEngine';
import { fresnel, markReflective } from '../PostProcessing';
import type { F, V2, V3 } from '../noise';
import { CROSSING_X, CROSSWALK_WIDTH, KERB_Z, LANE_WIDTH, PARKING_Z, RAMP_WIDTH } from './layout';

/** Weather shared by the street materials. */
export const weather = {
  /** 0 = dry, 1 = soaked. */
  wetness: uniform(1),
  /** Height of standing water relative to the road's smooth crown, metres (higher = bigger puddles). */
  waterLevel: uniform(-0.0026),
  /** Raindrop rate on the puddles (0 = no rain). */
  rain: uniform(0.35),
};

/** Anti-aliased band: 1 where |d| < halfWidth, with a one-pixel soft edge. */
function band(d: F, halfWidth: number): F {
  const w = fwidth(d).max(1e-5);
  return float(1).sub(smoothstep(float(halfWidth).sub(w), float(halfWidth).add(w), abs(d)));
}

/** Axis-aligned rectangle mask (x0..x1, z0..z1), anti-aliased. */
function rect(p: V2, x0: number, x1: number, z0: number, z1: number): F {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  return band(p.x.sub(cx), (x1 - x0) / 2).mul(band(p.y.sub(cz), (z1 - z0) / 2));
}

/**
 * Raindrop ripples: rings spreading from random points, one drop per 0.3 m cell per cycle, two
 * offset layers. Returns a world-space normal perturbation (x, z) for the water surface.
 */
function ripples(p: V2, rate: F): V2 {
  let sum: V2 = vec2(0);
  for (let layer = 0; layer < 2; layer++) {
    const cellSize = 0.3;
    const q = p.div(cellSize).add(layer * 0.5);
    const cell = floor(q);
    const h1 = hash(cell.x.add(cell.y.mul(157)).add(layer * 311));
    const h2 = hash(cell.x.mul(3.1).add(cell.y.mul(71)).add(layer * 97));
    const centre = vec2(h1, h2).mul(0.5).add(0.25);
    const local = fract(q).sub(centre).mul(cellSize);
    const r = length(local);
    const phase = fract(time.mul(rate).mul(0.9).add(h1.mul(7.3)));
    const radius = phase.mul(0.12);
    const x = r.sub(radius).div(0.006);
    // Derivative of a Gaussian ring, fading as it spreads.
    const slope = x.mul(-2).mul(x.mul(x).negate().exp()).mul(float(1).sub(phase)).mul(0.35);
    sum = sum.add(local.div(r.max(1e-4)).mul(slope));
  }
  return sum;
}

/** Wet asphalt road with markings and puddles (world-aligned; the road's UVs are in metres). */
export function roadMaterial(set: PBRSet): MeshPhysicalNodeMaterial {
  const m = new MeshPhysicalNodeMaterial({ name: 'Road' });
  const st = uv().div(set.tile);
  const albedo = texture(set.albedo, st).rgb;
  const orm = texture(set.orm, st);
  const fields = texture(set.fields!, st);
  const p = positionWorld.xz;
  const az = abs(p.y);

  // Wheel paths: two per traffic lane, 0.9 m either side of the lane centre.
  const inLane = step(az, PARKING_Z);
  const laneOffset = abs(fract(az.div(LANE_WIDTH)).sub(0.5)).mul(LANE_WIDTH);
  const wheel = smoothstep(0.42, 0.12, abs(laneOffset.sub(0.9))).mul(inLane);

  // Large-scale shape of the surface relative to its crown (metres): slow undulations and ruts.
  const undulation = (q: V2): F => mx_fractal_noise_float(vec3(q.x.mul(0.11), q.y.mul(0.16), 1.7), 4, 2, 0.5).mul(0.0045);
  const surfaceShape = undulation(p).sub(wheel.mul(0.0035));

  // Vertex displacement: the same undulations and ruts in the geometry.
  const pl = positionLocal;
  const shapeAtVertex = undulation(pl.xz).sub(
    smoothstep(0.42, 0.12, abs(abs(fract(abs(pl.z).div(LANE_WIDTH)).sub(0.5)).mul(LANE_WIDTH).sub(0.9))).mul(step(abs(pl.z), PARKING_Z)).mul(0.0035),
  );
  m.positionNode = pl.add(vec3(0, shapeAtVertex, 0));

  // Standing water: below the water level, plus the gutters (the road drains to them), plus
  // what the texture's cavities hold.
  const textureRelief = fields.r.sub(0.0012);
  const depth = weather.waterLevel.sub(surfaceShape.add(textureRelief.mul(0.6)));
  const gutter = smoothstep(0.5, 0.08, float(KERB_Z).sub(az)).mul(0.9);
  const puddle = clamp(max(smoothstep(0, 0.0012, depth), gutter), 0, 1).mul(weather.wetness);
  // Where the water film is smooth enough to flatten the coat: the texture's wettest cavities.
  const film = clamp(orm.a.mul(0.45).add(puddle), 0, 1);

  // Markings. Distances in metres from each line's centre.
  const dashes = step(fract(p.x.div(12).add(0.3)), 0.25);
  const centre = band(az.sub(0.12), 0.05);
  const lanes = band(az.sub(LANE_WIDTH), 0.05).mul(dashes);
  const edge = band(az.sub(PARKING_Z), 0.05);
  // Parking bay ticks every 6.5 m on the parking lane edge.
  const ticks = band(fract(p.x.div(6.5)).sub(0.5).mul(6.5), 0.05).mul(band(az.sub(PARKING_Z + 0.3), 0.3));
  const x0 = CROSSING_X - CROSSWALK_WIDTH / 2;
  const x1 = CROSSING_X + CROSSWALK_WIDTH / 2;
  // Continental crosswalk: 0.6 m bars parallel to traffic with 0.6 m gaps, kerb to kerb.
  const bars = band(fract(p.y.div(1.2).add(0.25)).sub(0.5), 0.25).mul(rect(p, x0, x1, -KERB_Z + 0.4, KERB_Z - 0.4));
  // Stop lines 1.2 m before the crosswalk, across the approach lanes (drive on the right).
  const stops = rect(p, x0 - 1.65, x0 - 1.2, 0.2, PARKING_Z).add(rect(p, x1 + 1.2, x1 + 1.65, -PARKING_Z, -0.2));
  const white = clamp(lanes.add(edge).add(ticks).add(bars).add(stops), 0, 1);
  const yellow = centre;
  // Paint wears away in the wheel paths and in patches.
  const wearNoise = mx_fractal_noise_float(vec3(p.x.mul(1.3), p.y.mul(1.3), 5.2), 4, 2, 0.55).mul(0.5).add(0.5);
  const wear = smoothstep(0.35, 0.75, wearNoise.add(wheel.mul(0.35)));
  const paint = clamp(white.add(yellow), 0, 1).mul(float(1).sub(wear.mul(0.85)));

  // Tar snakes: sealed cracks, glossy black ribbons along noise isolines.
  const snakeField = mx_fractal_noise_float(vec3(p.x.mul(0.35), p.y.mul(0.35), 9.1), 3, 2, 0.5);
  const snakeArea = smoothstep(0.1, 0.3, mx_fractal_noise_float(vec3(p.x.mul(0.05), p.y.mul(0.05), 3.3), 2, 2, 0.5));
  const snake = band(snakeField, 0.012).mul(snakeArea).mul(float(1).sub(paint));
  // Patched utility trenches: fresher, darker asphalt.
  const patch = max(rect(p, 6, 17, -5.2, -4.1), rect(p, -38, -36.8, -8.6, 1.5));

  // Base colour: darker where wet, darker still under water; paint on top.
  const wetDarken = mix(float(1), float(0.55), weather.wetness).mul(mix(float(1), float(0.62), puddle));
  const asphalt = albedo.mul(mix(float(1), float(0.72), patch)).mul(mix(float(1), float(0.85), wheel));
  const paintColor = mix(vec3(0.72, 0.72, 0.7), vec3(0.78, 0.52, 0.07), yellow);
  let base: V3 = mix(asphalt.mul(wetDarken), paintColor.mul(mix(float(1), float(0.85), weather.wetness)), paint);
  base = mix(base, vec3(0.018, 0.018, 0.02), snake);
  m.colorNode = base;

  // Roughness: dry aggregate 0.6 (texture), paint 0.5, tar 0.3, polished wheel paths; wet film
  // smooths it; standing water is a mirror (0.001).
  let rough: F = mix(orm.g, float(0.5), paint);
  rough = mix(rough, float(0.3), snake).sub(wheel.mul(0.08));
  rough = mix(rough, rough.mul(0.7), weather.wetness);
  m.roughnessNode = mix(rough, float(0.001), puddle);
  m.metalnessNode = float(0);
  m.aoNode = orm.r;
  m.iorNode = mix(float(1.5), float(1.333), puddle);

  // Normals: the texture's relief; flat water in puddles, with raindrop ripples.
  const bumpy = normalMap(texture(set.normal, st), vec2(1)) as unknown as V3;
  const ripple = ripples(p, weather.rain.mul(3)).mul(weather.rain.greaterThan(0).select(1, 0));
  const water = transformNormalToView(vec3(ripple.x.negate(), 1, ripple.y.negate()).normalize()) as unknown as V3;
  const surfaceNormal = mix(bumpy, water, puddle).normalize();
  m.normalNode = surfaceNormal;

  // The water film is the clear coat (1.0, roughness 0.05): on damp asphalt it follows the
  // texture; in puddles it is the flat, rippled water surface.
  m.clearcoatNode = weather.wetness;
  m.clearcoatRoughnessNode = float(0.05);
  m.clearcoatNormalNode = mix(bumpy, water, film).normalize();

  // Screen-space reflections: water's Fresnel reflectance (F0 0.02), sharp in puddles, blurred on
  // the damp texture.
  markReflective(m, fresnel(normalView, 0.02).mul(mix(float(0.5), float(1), puddle)).mul(weather.wetness), mix(float(0.22), float(0.015), puddle));
  return m;
}

/** Concrete pavement slabs, granite kerbs and tactile paving, damp after rain. */
export function pavementMaterial(set: PBRSet): MeshPhysicalNodeMaterial {
  const m = new MeshPhysicalNodeMaterial({ name: 'Pavement' });
  const st = uv().div(set.tile);
  const albedo = texture(set.albedo, st).rgb;
  const orm = texture(set.orm, st);
  const p = positionWorld;
  const behind = abs(p.z).sub(KERB_Z);

  // Kerb stones: the 0.3 m strip at the kerb (and its face), in 1.2 m lengths.
  const kerb = step(behind, 0.3);
  const kerbJoint = band(fract(p.x.div(1.2)).sub(0.5).mul(1.2), 0.004).mul(kerb);
  // Slabs: 1.5 m along the street, 1.25 m across, from the back of the kerb.
  const across = behind.sub(0.3).div(1.25);
  const along = p.x.div(1.5);
  const slabId = floor(across).add(floor(along).mul(17.3));
  const joint = max(band(fract(across).sub(0.5).mul(1.25), 0.005), band(fract(along).sub(0.5).mul(1.5), 0.005)).mul(float(1).sub(kerb));
  const slabTone = hash(slabId.add(3.1)).mul(0.16).add(0.92);
  // Tactile paving at the ramp bottoms: yellow truncated domes on a 60 mm grid, 0.6 m deep.
  const inRamp = step(abs(p.x.sub(CROSSING_X)), RAMP_WIDTH / 2).mul(step(behind, 0.9)).mul(step(0.3, behind));
  const domeCell = fract(vec2(p.x, behind).div(0.06)).sub(0.5).mul(0.06);
  const domeR = length(domeCell);
  const dome = smoothstep(0.0125, 0.01, domeR).mul(inRamp);

  // Granite for the kerb: the concrete texture desaturated and speckled.
  const grey = albedo.dot(vec3(0.33, 0.34, 0.33));
  const speck = hash(floor(vec2(p.x, p.y.add(p.z)).mul(400)).dot(vec2(1, 157))).mul(0.4).add(0.8);
  const granite = vec3(grey.mul(0.9).mul(speck));
  let base: V3 = mix(albedo.mul(slabTone), granite, kerb);
  base = mix(base, vec3(0.62, 0.45, 0.04), inRamp);
  base = base.mul(float(1).sub(max(joint, kerbJoint).mul(0.55)));
  // Damp: porous concrete darkens; water stands in the joints.
  const wet = weather.wetness;
  const damp = mix(float(1), float(0.72), wet);
  m.colorNode = base.mul(damp).mul(mix(float(1), float(0.6), joint.mul(wet)));
  const rough = mix(orm.g, float(0.55), kerb).add(joint.mul(0.1));
  m.roughnessNode = mix(rough, rough.mul(0.75), wet);
  m.metalnessNode = float(0);
  m.aoNode = orm.r.mul(float(1).sub(joint.mul(0.4)));

  // Normals: texture relief, joints as grooves, domes as bumps (analytic slopes).
  const bumpy = normalMap(texture(set.normal, st), vec2(1)) as unknown as V3;
  const domeSlope = domeCell.div(domeR.max(1e-4)).mul(smoothstep(0.0125, 0.009, domeR).sub(smoothstep(0.009, 0.0, domeR)).mul(-1.5)).mul(inRamp);
  const perturbed = transformNormalToView(vec3(domeSlope.x, 1, domeSlope.y).normalize()) as unknown as V3;
  m.normalNode = mix(bumpy, perturbed, dome.mul(0.9)).normalize();

  // A thin wet sheen.
  m.clearcoatNode = wet.mul(0.6);
  m.clearcoatRoughnessNode = float(0.3);
  markReflective(m, fresnel(normalView, 0.02).mul(wet).mul(0.35), float(0.3));
  return m;
}
