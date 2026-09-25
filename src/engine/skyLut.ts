// Atmosphere look-up tables for the engine's physical sky, as TSL passes (WebGPU and WebGL 2).
//
// After Hillaire 2020, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique":
//   transmittance     256×64   (altitude, zenith cosine) → transmittance to space           once
//   multiple scatter   32×32   (altitude, sun cosine) → isotropic multiple scattering        once
//   irradiance         64×1    sun cosine → skylight on flat ground per lux of sunlight      once
//   sky view          192×108  azimuth from the sun × elevation packed at the horizon →      when the
//                              radiance of sky and ground (single + multiple scattering)     sun moves
// Distances in km, coefficients per km (ATMOSPHERE in render/atmosphere/model.ts). The sky-view
// LUT holds radiance divided by a reference luminance (the caller's `scale`), so half floats
// keep their precision at noon and at midnight alike.
//
// Every lookup inside a loop or branch samples with an explicit LOD: WGSL only allows implicit
// derivatives in uniform control flow, and Direct3D compilers unroll loops around them.
import { Vector3 } from 'three';
import {
  Fn,
  If,
  Loop,
  abs,
  acos,
  atan,
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  length,
  max,
  mix,
  pow,
  select,
  sign,
  sin,
  sqrt,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  NodeMaterial,
  QuadMesh,
  RenderTarget,
  RepeatWrapping,
  type Node,
  type TextureNode,
  type WebGPURenderer,
  type Wrapping,
} from 'three/webgpu';
import { ATMOSPHERE as A } from '../render/atmosphere/model';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

const RG = A.groundRadius;
const RT = A.topRadius;
/** Distance from the ground to the top of the atmosphere along the horizon (Bruneton's H). */
const H = Math.sqrt(RT * RT - RG * RG);

const TRANSMITTANCE_W = 256;
const TRANSMITTANCE_H = 64;
const MS_SIZE = 32;
const IRRADIANCE_W = 64;
/** Lowest sun cosine in the irradiance table (sun 20° below the horizon: skylight is gone). */
const IRRADIANCE_MU_MIN = -0.35;
const SKY_VIEW_W = 192;
const SKY_VIEW_H = 108;
const SKY_VIEW_STEPS = 32;

/** A light for the in-scattering integral: direction toward it and its illuminance (scaled units). */
interface Light {
  dir: V3;
  illuminance: V3;
}

/** LUT textures bound in one material. */
interface LutNodes {
  transmittance: TextureNode;
  multiScattering: TextureNode;
}

// --- Participating media ----------------------------------------------------------------------

interface Medium {
  rayleigh: V3;
  mie: F;
  scattering: V3;
  extinction: V3;
}

function medium(altitude: F): Medium {
  const h = max(altitude, 0);
  const dR = exp(h.mul(-1 / A.rayleighScaleHeight));
  const dM = exp(h.mul(-1 / A.mieScaleHeight));
  const dO = max(float(1).sub(abs(h.sub(A.ozoneCenter)).div(A.ozoneHalfWidth)), 0);
  const rayleigh = vec3(...A.rayleighScattering).mul(dR);
  const mie = dM.mul(A.mieScattering);
  return {
    rayleigh,
    mie,
    scattering: rayleigh.add(mie),
    extinction: rayleigh.add(dM.mul(A.mieExtinction)).add(vec3(...A.ozoneAbsorption).mul(dO)),
  };
}

function rayleighPhase(c: F): F {
  return c.mul(c).add(1).mul(3 / (16 * Math.PI));
}

/** Cornette-Shanks: Henyey-Greenstein with a physically nicer back lobe. */
function miePhase(c: F): F {
  const g = A.mieG;
  const k = ((3 / (8 * Math.PI)) * (1 - g * g)) / (2 + g * g);
  return c.mul(c).add(1).mul(k).div(pow(max(float(1 + g * g).sub(c.mul(2 * g)), 1e-4), 1.5));
}

// --- Geometry (planet centre at the origin, viewer at (0, r, 0)) --------------------------------

/**
 * r²(mu² − 1) + RG² written as (r·mu)² − h(r + RG), with h = r − RG given separately: the naive
 * form cancels catastrophically in float32 for a viewer a few metres above the ground.
 */
function groundDiscriminant(r: F, mu: F, h: F): F {
  const rmu = r.mul(mu);
  return rmu.mul(rmu).sub(h.mul(r.add(RG)));
}

function hitsGround(r: F, mu: F, h: F): Node<'bool'> {
  return mu.lessThan(0).and(groundDiscriminant(r, mu, h).greaterThanEqual(0));
}

function distanceToGround(r: F, mu: F, h: F): F {
  return r.mul(mu).negate().sub(sqrt(max(groundDiscriminant(r, mu, h), 0)));
}

function distanceToTop(r: F, mu: F): F {
  const rmu = r.mul(mu);
  return rmu.negate().add(sqrt(max(rmu.mul(rmu).add(float(RT).sub(r).mul(r.add(RT))), 0)));
}

function unitToSub(x: F, res: number): F {
  return x.mul(1 - 1 / res).add(0.5 / res);
}

function subToUnit(u: F, res: number): F {
  return u.sub(0.5 / res).div(1 - 1 / res);
}

// --- LUT parameterisations and lookups ---------------------------------------------------------

/** Bruneton's transmittance mapping: (r, mu) ↔ uv for rays that reach space. */
function transmittanceUv(r: F, mu: F): Node<'vec2'> {
  const rho = sqrt(max(r.sub(RG), 0).mul(r.add(RG)));
  const dMin = float(RT).sub(r);
  const dMax = rho.add(H);
  const xMu = distanceToTop(r, mu).sub(dMin).div(max(dMax.sub(dMin), 1e-6));
  return vec2(unitToSub(xMu, TRANSMITTANCE_W), unitToSub(rho.div(H), TRANSMITTANCE_H));
}

/** Transmittance from radius r toward zenith cosine mu, to space; zero when the ray hits the ground. */
function transmittanceTo(lut: TextureNode, r: F, mu: F): V3 {
  const t = lut.sample(transmittanceUv(r, mu)).level(float(0)).rgb;
  return select(hitsGround(r, mu, max(r.sub(RG), 0)), vec3(0), t);
}

function multiScattering(lut: TextureNode, r: F, muSun: F): V3 {
  const u = unitToSub(clamp(muSun.mul(0.5).add(0.5), 0, 1), MS_SIZE);
  const v = unitToSub(clamp(r.sub(RG).div(RT - RG), 0, 1), MS_SIZE);
  return lut.sample(vec2(u, v)).level(float(0)).rgb;
}

function skyIrradiance(lut: TextureNode, muSun: F): V3 {
  const u = unitToSub(clamp(muSun.sub(IRRADIANCE_MU_MIN).div(1 - IRRADIANCE_MU_MIN), 0, 1), IRRADIANCE_W);
  return lut.sample(vec2(u, 0.5)).level(float(0)).rgb;
}

/**
 * In-scattered radiance along `dir` from a viewer at radius r (single scattering with shadowing
 * by the planet, plus multiple scattering from the LUT) up to distance tMax, and the ray's
 * transmittance. Steps are spaced quadratically: dense near the viewer, where the air is.
 */
function inscatter(luts: LutNodes, r: F, dir: V3, tMax: F, lights: Light[], steps: number): { L: V3; T: V3 } {
  const L = vec3(0).toVar();
  const T = vec3(1).toVar();
  const tEnd = tMax.toVar();
  const phases = lights.map((light) => {
    const c = dot(dir, light.dir).toVar();
    return { rayleigh: rayleighPhase(c).toVar(), mie: miePhase(c).toVar() };
  });
  Loop(steps, ({ i }) => {
    const a = float(i).div(steps);
    const b = float(i).add(1).div(steps);
    const t0 = tEnd.mul(a).mul(a);
    const dt = tEnd.mul(b).mul(b).sub(t0);
    // Midpoints: with quadratic spacing they match a 1500-step reference within 1%, where
    // Hillaire's 0.3 offset overestimates the zenith by ~7%.
    const p = vec3(0, r, 0).add(dir.mul(t0.add(dt.mul(0.5))));
    const pr = length(p);
    const up = p.div(pr);
    const m = medium(pr.sub(RG));
    let S: V3 = vec3(0);
    lights.forEach((light, k) => {
      const mu = dot(up, light.dir);
      const single = transmittanceTo(luts.transmittance, pr, mu).mul(m.rayleigh.mul(phases[k].rayleigh).add(m.mie.mul(phases[k].mie)));
      const multiple = multiScattering(luts.multiScattering, pr, mu).mul(m.scattering);
      S = S.add(single.add(multiple).mul(light.illuminance));
    });
    const sampleT = exp(m.extinction.mul(dt).negate());
    // Energy-conserving integration of S over the segment (Hillaire 2015).
    L.addAssign(T.mul(S.sub(S.mul(sampleT))).div(max(m.extinction, vec3(1e-7))));
    T.mulAssign(sampleT);
  });
  return { L, T };
}

// --- Passes -------------------------------------------------------------------------------------

function transmittancePass(): Node<'vec4'> {
  return Fn(() => {
    const coord = uv();
    const rho = subToUnit(coord.y, TRANSMITTANCE_H).mul(H);
    const r = sqrt(rho.mul(rho).add(RG * RG));
    const dMin = float(RT).sub(r);
    const d = dMin.add(subToUnit(coord.x, TRANSMITTANCE_W).mul(rho.add(H).sub(dMin)));
    const mu = clamp(float(H * H).sub(rho.mul(rho)).sub(d.mul(d)).div(max(r.mul(d).mul(2), 1e-6)), -1, 1);
    const steps = 40;
    const dt = distanceToTop(r, mu).div(steps).toVar();
    const depth = vec3(0).toVar();
    Loop(steps, ({ i }) => {
      const t = float(i).add(0.5).mul(dt);
      const h = sqrt(r.mul(r).add(t.mul(t)).add(r.mul(mu).mul(t).mul(2))).sub(RG);
      depth.addAssign(medium(h).extinction.mul(dt));
    });
    return vec4(exp(depth.negate()), 1);
  })();
}

/**
 * Multiple scattering (Hillaire 2020, section 5.5): second-order isotropic scattering and the
 * transfer factor f_ms averaged over the sphere of directions, summed as a geometric series.
 */
function multiScatteringPass(transmittance: TextureNode): Node<'vec4'> {
  return Fn(() => {
    const coord = uv();
    const muS = subToUnit(coord.x, MS_SIZE).mul(2).sub(1);
    const h = clamp(subToUnit(coord.y, MS_SIZE).mul(RT - RG), 0.002, RT - RG - 0.002).toVar();
    const r = h.add(RG).toVar();
    const sun = vec3(0, muS, sqrt(max(float(1).sub(muS.mul(muS)), 0))).toVar();
    const sumL = vec3(0).toVar();
    const sumF = vec3(0).toVar();
    const side = 8;
    const steps = 20;
    Loop(side * side, ({ i }) => {
      const row = floor(float(i).div(side));
      const col = float(i).sub(row.mul(side));
      const azimuth = row.add(0.5).mul((2 * Math.PI) / side);
      const cosZ = float(1).sub(col.add(0.5).mul(2 / side));
      const sinZ = sqrt(max(float(1).sub(cosZ.mul(cosZ)), 0));
      // Directions and distances are fixed before the inner loop: it must not see the outer index.
      const dir = vec3(cos(azimuth).mul(sinZ), cosZ, sin(azimuth).mul(sinZ)).toVar();
      const ground = hitsGround(r, dir.y, h).toVar();
      const tMax = select(ground, distanceToGround(r, dir.y, h), distanceToTop(r, dir.y)).toVar();
      const dt = tMax.div(steps).toVar();
      const L = vec3(0).toVar();
      const transfer = vec3(0).toVar();
      const T = vec3(1).toVar();
      Loop(steps, ({ i: j }) => {
        const p = vec3(0, r, 0).add(dir.mul(float(j).add(0.5).mul(dt)));
        const pr = length(p);
        const m = medium(pr.sub(RG));
        const sampleT = exp(m.extinction.mul(dt).negate());
        const ext = max(m.extinction, vec3(1e-7));
        const S = transmittanceTo(transmittance, pr, dot(p.div(pr), sun)).mul(m.scattering).mul(1 / (4 * Math.PI));
        L.addAssign(T.mul(S.sub(S.mul(sampleT))).div(ext));
        transfer.addAssign(T.mul(m.scattering.sub(m.scattering.mul(sampleT))).div(ext));
        T.mulAssign(sampleT);
      });
      If(ground, () => {
        const p = vec3(0, r, 0).add(dir.mul(tMax));
        const pr = length(p);
        const mu = dot(p.div(pr), sun);
        L.addAssign(T.mul(transmittanceTo(transmittance, pr, mu)).mul(max(mu, 0)).mul(A.groundAlbedo / Math.PI));
      });
      sumL.addAssign(L);
      sumF.addAssign(transfer);
    });
    const n = side * side;
    return vec4(sumL.div(n).div(max(vec3(1).sub(sumF.div(n)), vec3(1e-4))), 1);
  })();
}

/** Skylight on horizontal ground at sea level per lux of sunlight at the top of the atmosphere. */
function irradiancePass(luts: LutNodes): Node<'vec4'> {
  return Fn(() => {
    const muS = mix(float(IRRADIANCE_MU_MIN), float(1), subToUnit(uv().x, IRRADIANCE_W));
    const sun = vec3(sqrt(max(float(1).sub(muS.mul(muS)), 0)), muS, 0).toVar();
    const r = float(RG + 0.002);
    const azimuths = 12;
    const rings = 8;
    const E = vec3(0).toVar();
    Loop(azimuths * rings, ({ i }) => {
      const a = floor(float(i).div(rings));
      const k = float(i).sub(a.mul(rings));
      // Cosine-weighted directions over the upper hemisphere.
      const xi = k.add(0.5).div(rings);
      const sinT = sqrt(xi);
      const phi = a.add(0.5).mul((2 * Math.PI) / azimuths);
      const dir = vec3(cos(phi).mul(sinT), sqrt(float(1).sub(xi)), sin(phi).mul(sinT)).toVar();
      E.addAssign(inscatter(luts, r, dir, distanceToTop(r, dir.y), [{ dir: sun, illuminance: vec3(1) }], 16).L);
    });
    return vec4(E.mul(Math.PI / (azimuths * rings)), 1);
  })();
}

/** Inputs of the sky-view pass. The lookup (SkyLuts.sample) reads the same horizon and azimuth frame. */
export class SkyViewParams {
  /** Viewer radius and altitude (km). */
  readonly radius = uniform(RG + 0.002);
  readonly altitude = uniform(0.002);
  /** Zenith angle of the horizon, and the angle from it down to the nadir (radians). */
  readonly horizonZenith = uniform(Math.PI / 2);
  readonly beta = uniform(Math.PI / 2);
  /** Horizontal frame of the LUT: toward the sun's azimuth, and 90° to its right. */
  readonly forward = uniform(new Vector3(0, 0, 1));
  readonly right = uniform(new Vector3(1, 0, 0));
  readonly sunDirection = uniform(new Vector3(0, 1, 0));
  readonly moonDirection = uniform(new Vector3(0, -1, 0));
  /** Illuminance at the top of the atmosphere (lux / scale). */
  readonly sunIlluminance = uniform(new Vector3());
  readonly moonIlluminance = uniform(new Vector3());
  /** Night sky (city glow and airglow) at the zenith and at the horizon (nits / scale). */
  readonly nightZenith = uniform(new Vector3());
  readonly nightHorizon = uniform(new Vector3());
  /** Street-lit city seen from above at night (nits / scale). */
  readonly groundGlow = uniform(new Vector3());

  /** Sets the viewer altitude (km) and the horizon angles that go with it. */
  setAltitude(altitudeKm: number): void {
    const r = RG + altitudeKm;
    this.radius.value = r;
    this.altitude.value = altitudeKm;
    this.beta.value = Math.acos(Math.min(1, Math.sqrt(altitudeKm * (2 * RG + altitudeKm)) / r));
    this.horizonZenith.value = Math.PI - this.beta.value;
  }

  /** Sets the sun direction and aligns the LUT's azimuth frame with it. */
  setSun(direction: Vector3): void {
    this.sunDirection.value.copy(direction);
    const f = this.forward.value.set(direction.x, 0, direction.z);
    // The sun never reaches the zenith north of the tropics; keep a frame if it nearly does.
    if (f.lengthSq() < 1e-10) f.set(0, 0, 1);
    f.normalize();
    this.right.value.set(-f.z, 0, f.x);
  }
}

function skyViewPass(luts: LutNodes, irradiance: TextureNode, p: SkyViewParams): Node<'vec4'> {
  return Fn(() => {
    const coord = uv();
    const v = subToUnit(coord.y, SKY_VIEW_H);
    // Rows below v = 0.5 look at the sky, the rest at the ground; both are packed toward the
    // horizon (square law) where the sky changes fastest.
    const ground = v.greaterThanEqual(0.5).toVar();
    const skyT = float(1).sub(v.mul(2));
    const groundT = v.mul(2).sub(1);
    const theta = select(ground, p.horizonZenith.add(p.beta.mul(groundT.mul(groundT))), p.horizonZenith.mul(float(1).sub(skyT.mul(skyT)))).toVar();
    const x = coord.x.mul(2).sub(1);
    const phi = sign(x).mul(x.mul(x)).mul(Math.PI);
    const horizontal = p.forward.mul(cos(phi)).add(p.right.mul(sin(phi)));
    const dir = horizontal.mul(sin(theta)).add(vec3(0, cos(theta), 0)).toVar();
    const r = p.radius;
    const tMax = select(ground, distanceToGround(r, dir.y, p.altitude), distanceToTop(r, dir.y)).toVar();
    const lights: Light[] = [
      { dir: p.sunDirection, illuminance: p.sunIlluminance },
      { dir: p.moonDirection, illuminance: p.moonIlluminance },
    ];
    const { L, T } = inscatter(luts, r, dir, tMax, lights, SKY_VIEW_STEPS);
    const result = L.toVar();
    If(ground, () => {
      // Lambertian ground lit by the sun or moon and by the sky, seen through the air in between.
      const g = vec3(0, r, 0).add(dir.mul(tMax));
      const gr = length(g);
      const up = g.div(gr);
      let E: V3 = vec3(0);
      for (const light of lights) {
        const mu = dot(up, light.dir);
        const direct = transmittanceTo(luts.transmittance, gr, mu).mul(max(mu, 0));
        E = E.add(direct.add(skyIrradiance(irradiance, mu)).mul(light.illuminance));
      }
      const haze = float(1).sub(dot(T, vec3(1 / 3)));
      result.addAssign(T.mul(E.mul(A.groundAlbedo / Math.PI).add(p.groundGlow)).add(p.nightHorizon.mul(haze)));
    }).Else(() => {
      // Night sky: airglow brightens toward the horizon (van Rhijn) and the city's glow is
      // strongest there.
      const elevation = max(float(Math.PI / 2).sub(theta), 0);
      const glow = clamp(exp(elevation.mul(-1 / 0.16)).add(exp(elevation.mul(-1 / 0.5)).mul(0.35)), 0, 1);
      result.addAssign(mix(p.nightZenith, p.nightHorizon, glow));
    });
    return vec4(result, 1);
  })();
}

function lutTarget(width: number, height: number, wrapS: Wrapping = ClampToEdgeWrapping): RenderTarget {
  return new RenderTarget(width, height, {
    type: HalfFloatType,
    magFilter: LinearFilter,
    minFilter: LinearFilter,
    generateMipmaps: false,
    wrapS,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: false,
  });
}

/**
 * The atmosphere's look-up tables. `renderStatic` once (transmittance, multiple scattering,
 * irradiance), then `renderSkyView` whenever the sun, moon or viewer altitude change.
 */
export class SkyLuts {
  readonly transmittance = lutTarget(TRANSMITTANCE_W, TRANSMITTANCE_H);
  readonly multiScattering = lutTarget(MS_SIZE, MS_SIZE);
  readonly irradiance = lutTarget(IRRADIANCE_W, 1);
  readonly skyView = lutTarget(SKY_VIEW_W, SKY_VIEW_H, RepeatWrapping);
  readonly params = new SkyViewParams();
  private readonly transmittanceMaterial = new NodeMaterial();
  private readonly multiScatteringMaterial = new NodeMaterial();
  private readonly irradianceMaterial = new NodeMaterial();
  private readonly skyViewMaterial = new NodeMaterial();
  private readonly quad = new QuadMesh(this.transmittanceMaterial);

  constructor() {
    this.transmittance.texture.name = 'Sky.Transmittance';
    this.multiScattering.texture.name = 'Sky.MultiScattering';
    this.irradiance.texture.name = 'Sky.Irradiance';
    this.skyView.texture.name = 'Sky.View';
    this.transmittanceMaterial.name = 'Sky.TransmittancePass';
    this.transmittanceMaterial.fragmentNode = transmittancePass();
    this.multiScatteringMaterial.name = 'Sky.MultiScatteringPass';
    this.multiScatteringMaterial.fragmentNode = multiScatteringPass(texture(this.transmittance.texture));
    this.irradianceMaterial.name = 'Sky.IrradiancePass';
    this.irradianceMaterial.fragmentNode = irradiancePass(this.lutNodes());
    this.skyViewMaterial.name = 'Sky.ViewPass';
    this.skyViewMaterial.fragmentNode = skyViewPass(this.lutNodes(), texture(this.irradiance.texture), this.params);
  }

  /** Transmittance, multiple scattering and irradiance: the atmosphere itself never changes. */
  renderStatic(renderer: WebGPURenderer): void {
    const previous = renderer.getRenderTarget();
    this.run(renderer, this.transmittance, this.transmittanceMaterial);
    this.run(renderer, this.multiScattering, this.multiScatteringMaterial);
    this.run(renderer, this.irradiance, this.irradianceMaterial);
    renderer.setRenderTarget(previous);
  }

  renderSkyView(renderer: WebGPURenderer): void {
    const previous = renderer.getRenderTarget();
    this.run(renderer, this.skyView, this.skyViewMaterial);
    renderer.setRenderTarget(previous);
  }

  /** Sky-view LUT value (radiance / scale) toward a world direction. */
  sample(dir: V3): V3 {
    const p = this.params;
    const theta = acos(clamp(dir.y, -1, 1));
    const vSky = float(1).sub(sqrt(max(float(1).sub(theta.div(p.horizonZenith)), 0))).mul(0.5);
    const vGround = sqrt(clamp(theta.sub(p.horizonZenith).div(p.beta), 0, 1)).mul(0.5).add(0.5);
    const v = select(theta.greaterThan(p.horizonZenith), vGround, vSky);
    const phi = atan(dot(dir, p.right), dot(dir, p.forward));
    const u = sign(phi).mul(sqrt(abs(phi).div(Math.PI))).mul(0.5).add(0.5);
    return texture(this.skyView.texture, vec2(u, unitToSub(v, SKY_VIEW_H)), 0).rgb;
  }

  /** Transmittance from the viewer toward a world direction (zero below the horizon). */
  viewTransmittance(dir: V3): V3 {
    return transmittanceTo(texture(this.transmittance.texture), this.params.radius, dir.y);
  }

  dispose(): void {
    for (const t of [this.transmittance, this.multiScattering, this.irradiance, this.skyView]) t.dispose();
    for (const m of [this.transmittanceMaterial, this.multiScatteringMaterial, this.irradianceMaterial, this.skyViewMaterial]) m.dispose();
  }

  private lutNodes(): LutNodes {
    return { transmittance: texture(this.transmittance.texture), multiScattering: texture(this.multiScattering.texture) };
  }

  private run(renderer: WebGPURenderer, target: RenderTarget, material: NodeMaterial): void {
    renderer.setRenderTarget(target);
    this.quad.material = material;
    this.quad.render(renderer);
  }
}
