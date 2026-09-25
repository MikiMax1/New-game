// Volumetric clouds for the engine's sky (plan 7.1–7.5): South Florida's fair-weather cumulus.
//
// The density field is 2.5D (a design carried over from the legacy renderer, which runs the same
// on WebGPU and WebGL 2 because it needs no 3D texture): a tiling 2D noise texture says where the
// clouds are (a broad weather field and one cumulus per Worley cell); a vertical profile gives
// each cloud a flat base and a rounded top that grows with the local coverage; two detail layers
// sampled at height-rotated offsets erode the edges into cauliflower billows.
//
// Each sample is lit by the key light (the sun, or the moon at night) through two shadow taps
// toward it, with a dual-lobe phase function (silver linings toward the sun), a softer term for
// multiple scattering and the "powder" darkening of edges facing the light, plus ambient light
// from the sky above and the lit ground (and the city's orange glow at night) below. Radiance is
// in the sky-view LUT's units (nits / scale), so the view and the environment map share it.
//
// The view's clouds are marched at a fraction of the screen resolution with a per-frame jitter
// that the temporal upscaler averages away; the environment map marches a few coarse steps.
import { HalfFloatType, LinearFilter, Matrix4, Vector2, Vector3, type PerspectiveCamera } from 'three';
import {
  Break,
  Fn,
  If,
  Loop,
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  getViewPosition,
  length,
  log2,
  max,
  mix,
  normalize,
  pow,
  screenCoordinate,
  screenUV,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { NodeMaterial, QuadMesh, RenderTarget, type Node, type WebGPURenderer } from 'three/webgpu';
import { ATMOSPHERE, luminance, smoothstep as smoothstepCpu, transmittanceToSpace } from '../render/atmosphere/model';
import { cloudThreshold, createCloudNoiseTexture } from '../render/atmosphere/noise';
import { airTransmittance, type SkyLuts } from './skyLut';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

/** Fair-weather cumulus over Miami: bases near 1.1 km, tops near 2.3 km. */
export const CLOUD_BASE = 1150;
export const CLOUD_THICKNESS = 1100;
/** Extinction (1/m) at density 1: a kilometre of cumulus core is optically thick. */
const SIGMA = 0.022;
/** Clouds beyond this distance (m) are lost in the haze anyway. */
const MAX_DISTANCE = 60000;
const PLANET_RADIUS = ATMOSPHERE.groundRadius * 1000;
const NOISE_SIZE = 256;
/** Tile sizes (m) of the noise layers: weather, cumulus cells, billows, small puffs. */
const WEATHER_TILE = 21000;
const CELL_TILE = 7200;
const DETAIL_TILE = 700;
const FINE_TILE = 190;
/** The wind offset wraps at a common multiple of every tile size, so the wrap never shows. */
const WIND_WRAP = 252000;
/** Trade-wind drift from the east-south-east (m/s). */
const WIND = new Vector2(-4.5, 1.5);
/** Share of the moon's illuminance (full moon ~0.25 lux) relative to the sun's at the top of the atmosphere. */
const MOON_TOP_LUX = 0.25;
const SUN_TOP_LUX = 128000;

/** Relative cumulus cover over the day: convective clouds build by early afternoon and die after sunset. */
export function diurnalCumulus(hours: number): number {
  const h = ((hours % 24) + 24) % 24;
  return 0.35 + 0.65 * smoothstepCpu(7.5, 13, h) * (1 - smoothstepCpu(18, 21, h));
}

/** Raymarch steps and resolution divisor of the view's cloud pass for a quality preset name. */
export function cloudSettings(quality: string): { steps: number; divisor: number } {
  switch (quality) {
    case 'low':
      return { steps: 24, divisor: 4 };
    case 'medium':
      return { steps: 36, divisor: 3 };
    case 'high':
      return { steps: 56, divisor: 2 };
    case 'ultra':
      return { steps: 72, divisor: 2 };
    default:
      return { steps: 80, divisor: 1 };
  }
}

const _size = new Vector2();

export class CloudLayer {
  /** Afternoon cumulus cover, 0..1 (the time of day scales it, see diurnalCumulus). */
  cover = 0.3;
  readonly target = new RenderTarget(1, 1, {
    type: HalfFloatType,
    magFilter: LinearFilter,
    minFilter: LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
  });
  private readonly noise = createCloudNoiseTexture(NOISE_SIZE);
  /** Coverage threshold of the combined noise field (1 = clear sky) and density scale (0 = off). */
  private readonly threshold = uniform(1);
  private readonly density = uniform(0);
  private readonly wind = uniform(new Vector2());
  /** Key light: direction, and illuminance at the top of the atmosphere in LUT units. */
  private readonly keyDirection = uniform(new Vector3(0, 1, 0));
  private readonly keyTop = uniform(new Vector3());
  /** View pass: camera position (m), matrices, jitter phase and the angle of one buffer pixel. */
  private readonly cameraPosition = uniform(new Vector3());
  private readonly projectionInverse = uniform(new Matrix4());
  private readonly cameraWorld = uniform(new Matrix4());
  private readonly frame = uniform(0);
  private readonly pixelAngle = uniform(0.002);
  private readonly material = new NodeMaterial();
  private readonly quad = new QuadMesh(this.material);
  /** One buffer texel in uv units, for the upsampling filter. */
  private readonly texel = uniform(new Vector2(1, 1));
  private steps = 0;
  private readonly windOffset = new Vector2();
  private hours = 12;

  constructor(
    private readonly luts: SkyLuts,
    private readonly haze: Node<'float'>,
  ) {
    this.target.texture.name = 'Sky.Clouds';
    this.material.name = 'Sky.CloudsPass';
    this.setSteps(cloudSettings('high').steps);
  }

  /** The camera position the clouds are marched from (world, m). */
  get origin(): Node<'vec3'> {
    return this.cameraPosition;
  }

  /** True when there are clouds to draw. */
  get active(): boolean {
    return this.density.value > 0;
  }

  setSteps(steps: number): void {
    if (steps === this.steps) return;
    this.steps = steps;
    this.material.fragmentNode = Fn(() => {
      // One ray per buffer pixel, from the camera through the pixel centre.
      const view = getViewPosition(uv(), float(0.5), this.projectionInverse);
      const dir = normalize(this.cameraWorld.mul(vec4(view, 0)).xyz);
      // Interleaved gradient noise, rotated each frame: the upscaler averages the banding away.
      const p = screenCoordinate.xy.add(vec2(this.frame.mul(5.588238), this.frame.mul(3.1415926)));
      const jitter = fract(fract(dot(p, vec2(0.06711056, 0.00583715))).mul(52.9829189));
      return this.layer(dir, this.cameraPosition, steps, jitter, this.pixelAngle.mul(3));
    })();
    this.material.needsUpdate = true;
  }

  /**
   * Updates the wind, the coverage for the time of day and the lighting, then marches the view's
   * clouds at 1/`divisor` of the drawing-buffer resolution. `scale` is the sky LUT's unit (nits).
   */
  update(renderer: WebGPURenderer, camera: PerspectiveCamera, hours: number, dt: number, divisor: number, sun: Vector3, moon: Vector3, moonFraction: number, scale: number): void {
    // The drift follows both real time and the time of day, so skipping hours moves the clouds.
    const hourStep = ((hours - this.hours + 36) % 24) - 12;
    this.hours = hours;
    this.windOffset.addScaledVector(WIND, dt + hourStep * 3600 * 0.7);
    this.windOffset.set(this.windOffset.x % WIND_WRAP, this.windOffset.y % WIND_WRAP);
    this.wind.value.copy(this.windOffset);

    const coverage = this.cover * diurnalCumulus(hours);
    this.threshold.value = cloudThreshold(coverage);
    this.density.value = coverage > 0.001 ? 1 : 0;

    // Lit by the sun while it still reaches cloud height (a few degrees after sunset), then by
    // the moon.
    const cloudAltitude = (CLOUD_BASE + CLOUD_THICKNESS / 2) / 1000;
    const sunAtClouds = luminance(transmittanceToSpace(cloudAltitude, sun.y)) > 1e-4;
    this.keyDirection.value.copy(sunAtClouds ? sun : moon);
    this.keyTop.value.setScalar(sunAtClouds ? SUN_TOP_LUX / scale : (MOON_TOP_LUX * moonFraction) / scale);

    if (!this.active) return;
    renderer.getDrawingBufferSize(_size);
    const w = Math.max(1, Math.ceil(_size.x / divisor));
    const h = Math.max(1, Math.ceil(_size.y / divisor));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    this.texel.value.set(1 / w, 1 / h);
    camera.updateMatrixWorld();
    this.cameraPosition.value.setFromMatrixPosition(camera.matrixWorld);
    this.projectionInverse.value.copy(camera.projectionMatrixInverse);
    this.cameraWorld.value.copy(camera.matrixWorld);
    this.pixelAngle.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / h;
    this.frame.value = (this.frame.value + 1) % 64;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
    renderer.setRenderTarget(previous);
  }

  /** The view's clouds (premultiplied radiance in LUT units, opacity) at this pixel, tent-filtered. */
  sample(): Node<'vec4'> {
    const tex = texture(this.target.texture);
    return Fn(() => {
      // Four bilinear taps half a buffer texel apart: a tent filter hides the coarse grid.
      const o = this.texel.mul(0.5);
      const c = screenUV;
      return tex
        .sample(c.add(vec2(o.x.negate(), o.y.negate())))
        .add(tex.sample(c.add(vec2(o.x, o.y.negate()))))
        .add(tex.sample(c.add(vec2(o.x.negate(), o.y))))
        .add(tex.sample(c.add(o)))
        .mul(0.25);
    })();
  }

  /**
   * Clouds toward `dir` from `origin` (world, m) as premultiplied radiance in LUT units and
   * opacity, with the haze in front of them folded in. `footprintScale` is the cone angle one
   * output pixel covers (radians), which picks the detail noise's level of detail.
   */
  layer(dir: V3, origin: V3, steps: number, jitter: F, footprintScale: F): Node<'vec4'> {
    const luts = this.luts;
    const p = luts.params;
    const noise = texture(this.noise);
    const sampleNoise = (at: V2, lod: F) => noise.sample(at).level(lod);

    // Bilinear filtering of a thresholded field shows the texel grid as kinked outlines; the
    // cell field uses a cubic B-spline built from four bilinear taps (GPU Gems 2, ch. 20).
    const bicubic = (at: V2) => {
      const q = at.mul(NOISE_SIZE).sub(0.5);
      const i = floor(q);
      const f = q.sub(i);
      const f2 = f.mul(f);
      const f3 = f2.mul(f);
      const w0 = f3.negate().add(f2.mul(3)).sub(f.mul(3)).add(1).div(6);
      const w1 = f3.mul(3).sub(f2.mul(6)).add(4).div(6);
      const w2 = f3.mul(-3).add(f2.mul(3)).add(f.mul(3)).add(1).div(6);
      const w3 = f3.div(6);
      const g0 = w0.add(w1);
      const g1 = w2.add(w3);
      const h0 = i.sub(0.5).add(w1.div(g0)).div(NOISE_SIZE);
      const h1 = i.add(1.5).add(w3.div(g1)).div(NOISE_SIZE);
      const zero = float(0);
      return sampleNoise(h0, zero)
        .mul(g0.x)
        .add(sampleNoise(vec2(h1.x, h0.y), zero).mul(g1.x))
        .mul(g0.y)
        .add(sampleNoise(vec2(h0.x, h1.y), zero).mul(g0.x).add(sampleNoise(h1, zero).mul(g1.x)).mul(g1.y));
    };

    // Density at world position `at` (y = height above the ground), normalised height hn, level
    // of detail `soft` (long steps sample a coarser, softer field) and cone width `footprint` (m).
    const density = Fn(([at, hn, soft, footprint]: [V3, F, F, F]) => {
      const d = float(0).toVar();
      const q = at.xz.add(this.wind);
      const weather = sampleNoise(q.div(WEATHER_TILE), float(0)).r;
      const cells = vec2(q.div(CELL_TILE).add(vec2(0.37, 0.61))).toVar();
      const cellField = float(0).toVar();
      If(soft.lessThan(0.08), () => {
        cellField.assign(bicubic(cells).g);
      }).Else(() => {
        cellField.assign(sampleNoise(cells, soft.mul(3.2)).g);
      });
      const cover = clamp(cellField.mul(0.7).add(weather.mul(0.3)).sub(this.threshold).div(max(float(1).sub(this.threshold), 0.02)), 0, 1);
      If(cover.greaterThan(0), () => {
        // Flat base, rounded top whose height follows the local coverage; clouds in the denser
        // parts of the weather field grow taller.
        const top = pow(cover, 0.85).mul(0.9).add(0.1).mul(weather.mul(0.45).add(0.55));
        const shape = smoothstep(0, soft.mul(0.3).add(0.32), top.sub(hn)).mul(smoothstep(0, soft.mul(0.08).add(0.05), hn));
        // Erode the edges, more toward the top (cauliflower tops, crisp bases), with two layers
        // at height-rotated offsets so the billows vary with height instead of forming pillars.
        const angle = at.y.mul(0.0021);
        const rotated = vec2(q.x.mul(cos(angle)).sub(q.y.mul(sin(angle))), q.x.mul(sin(angle)).add(q.y.mul(cos(angle)))).add(vec2(at.y.mul(1.7), at.y.mul(-1.3)));
        const lod = (tile: number) => max(log2(footprint.div(tile / NOISE_SIZE)), 0);
        const detail = sampleNoise(rotated.div(DETAIL_TILE), lod(DETAIL_TILE))
          .b.mul(0.6)
          .add(sampleNoise(rotated.add(vec2(37, 91).mul(at.y.mul(0.05))).div(FINE_TILE), lod(FINE_TILE)).a.mul(0.4));
        const erosion = detail.mul(hn.mul(0.55).add(0.18)).mul(float(1).sub(soft));
        d.assign(clamp(shape.sub(erosion).div(max(float(1).sub(erosion), 1e-3)), 0, 1).mul(this.density));
      });
      return d;
    });

    return Fn(() => {
      const result = vec4(0).toVar();
      const h0 = origin.y;
      const mu = dir.y;
      const base = float(CLOUD_BASE);
      const topH = float(CLOUD_BASE + CLOUD_THICKNESS);
      // Distance along the ray to a spherical shell at height hs (m); -1 when missed.
      const shell = (hs: F, far: boolean): F => {
        const r = h0.add(PLANET_RADIUS);
        const b = r.mul(mu);
        const c = h0.sub(hs).mul(h0.add(hs).add(2 * PLANET_RADIUS));
        const disc = b.mul(b).sub(c);
        const s = disc.max(0).sqrt();
        const t = far ? b.negate().add(s) : b.negate().sub(s);
        return select(disc.lessThan(0), float(-1), t);
      };
      // Below the layer: enter at the base, leave through the top. Inside: march to whichever
      // boundary comes first. Above: enter through the top going down.
      const below = h0.lessThan(base);
      const above = h0.greaterThan(topH);
      const insideEnd = select(mu.greaterThan(0), shell(topH, true), select(shell(base, false).greaterThan(0), shell(base, false), shell(topH, true)));
      const t0 = select(below, shell(base, true), select(above, shell(topH, false), float(0))).toVar();
      const t1 = select(below, shell(topH, true), select(above, select(shell(base, false).greaterThan(0), shell(base, false), shell(topH, true)), insideEnd))
        .min(MAX_DISTANCE)
        .toVar();
      const visible = select(below, mu.greaterThan(0), select(above, mu.lessThan(0), float(1).greaterThan(0)))
        .and(t0.greaterThanEqual(0))
        .and(t0.lessThan(MAX_DISTANCE))
        .and(t1.greaterThan(t0));

      If(visible, () => {
        // Steps grow with distance; long grazing paths near the horizon are cut short.
        const dt = clamp(t1.sub(t0).div(steps), 25, t0.mul(0.012).add(60)).toVar();
        const soft = clamp(dt.sub(35).div(180), 0, 1).toVar();
        const key = normalize(this.keyDirection);
        const cosTheta = dot(dir, key);
        const phase = dualLobePhase(cosTheta);
        // Light arriving at cloud height: the key light through the air above, skylight from
        // above, and the lit ground (plus the city's glow at night) from below.
        const cloudRadius = float(ATMOSPHERE.groundRadius + (CLOUD_BASE + CLOUD_THICKNESS / 2) / 1000);
        const keyAtClouds = luts.transmittanceFrom(cloudRadius, key.y).mul(this.keyTop).toVar();
        const skyE = luts.skylight(p.sunDirection.y).mul(p.sunIlluminance).add(luts.skylight(p.moonDirection.y).mul(p.moonIlluminance));
        const groundRadius = float(ATMOSPHERE.groundRadius + 0.002);
        const groundE = luts
          .transmittanceFrom(groundRadius, p.sunDirection.y)
          .mul(max(p.sunDirection.y, 0))
          .mul(p.sunIlluminance)
          .add(luts.transmittanceFrom(groundRadius, p.moonDirection.y).mul(max(p.moonDirection.y, 0)).mul(p.moonIlluminance))
          .add(skyE);
        const ambientTop = skyE.mul(0.7 / Math.PI).add(p.nightZenith).toVar();
        const ambientBottom = skyE
          .mul(0.2 / Math.PI)
          .add(groundE.mul((0.9 * ATMOSPHERE.groundAlbedo) / Math.PI))
          .add(p.groundGlow.mul(2.5))
          .toVar();

        const radiance = vec3(0).toVar();
        const transmittance = float(1).toVar();
        const weight = float(0).toVar();
        const distance = float(0).toVar();
        const t = t0.add(jitter.mul(dt)).toVar();
        Loop(steps, () => {
          If(t.greaterThan(t1).or(transmittance.lessThan(0.01)), () => {
            Break();
          });
          const at = origin.add(dir.mul(t));
          // Height above the curved ground under the camera.
          const flat = at.sub(origin);
          const height = length(vec3(flat.x, at.y.add(PLANET_RADIUS), flat.z)).sub(PLANET_RADIUS);
          const hn = height.sub(CLOUD_BASE).div(CLOUD_THICKNESS);
          const footprint = max(t.mul(footprintScale), 1);
          const d = float(0).toVar();
          If(inRange(hn), () => {
            d.assign(density(vec3(at.x, height, at.z), hn, soft, footprint));
          });
          If(d.greaterThan(0.002), () => {
            // Two taps toward the light for self-shadowing.
            const hn1 = hn.add(key.y.mul(70 / CLOUD_THICKNESS));
            const hn2 = hn.add(key.y.mul(260 / CLOUD_THICKNESS));
            const p1 = at.add(key.mul(70));
            const p2 = at.add(key.mul(260));
            const d1 = float(0).toVar();
            const d2 = float(0).toVar();
            If(inRange(hn1), () => {
              d1.assign(density(vec3(p1.x, height.add(key.y.mul(70)), p1.z), hn1, soft, footprint));
            });
            If(inRange(hn2), () => {
              d2.assign(density(vec3(p2.x, height.add(key.y.mul(260)), p2.z), hn2, max(soft, 0.5), footprint));
            });
            const depth = d.mul(20).add(d1.mul(120)).add(d2.mul(260)).mul(SIGMA);
            // Single scattering, plus a softer, more isotropic term standing in for multiple
            // scattering (sunlit cumulus are bright white, not grey), darkened at thin edges
            // facing the light (powder).
            const single = phase.mul(exp(depth.negate()));
            const multiple = exp(depth.mul(-0.2)).mul(2.4 / (4 * Math.PI));
            const powder = float(1).sub(exp(d.mul(-SIGMA * 200)).mul(0.55));
            const direct = keyAtClouds.mul(single.add(multiple)).mul(powder);
            const ambient = mix(ambientBottom, ambientTop, clamp(hn.mul(1.2).add(0.1), 0, 1));
            const stepT = exp(d.mul(dt).mul(-SIGMA));
            const absorbed = transmittance.mul(float(1).sub(stepT));
            radiance.addAssign(direct.mul(0.96).add(ambient).mul(absorbed));
            weight.addAssign(absorbed);
            distance.addAssign(t.mul(absorbed));
            transmittance.mulAssign(stepT);
          });
          t.addAssign(dt);
        });

        If(weight.greaterThan(0), () => {
          // The haze between the eye and the cloud looks like the sky behind it.
          const mean = distance.div(weight);
          const alpha = float(1).sub(transmittance);
          const h0km = max(h0, 0).mul(0.001);
          const h1km = max(h0.add(dir.y.mul(mean)), 0).mul(0.001);
          const haze = airTransmittance(h0km, h1km, mean.mul(0.001), this.haze);
          const sky = luts.sample(dir);
          result.assign(vec4(haze.mul(radiance).add(vec3(1).sub(haze).mul(sky).mul(alpha)), alpha));
        });
      });
      return result;
    })();
  }

  dispose(): void {
    this.target.dispose();
    this.noise.dispose();
    this.material.dispose();
  }
}

function inRange(hn: F): Node<'bool'> {
  return hn.greaterThanEqual(0).and(hn.lessThanEqual(1));
}

/** Dual-lobe Henyey-Greenstein phase: a strong forward lobe and a weak backward one. */
function dualLobePhase(c: F): F {
  const lobe = (g: number) => float(1 - g * g).div(pow(max(float(1 + g * g).sub(c.mul(2 * g)), 1e-4), 1.5));
  return lobe(0.7).mul(0.75).add(lobe(-0.2).mul(0.25)).div(4 * Math.PI);
}
