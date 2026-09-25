// The engine's sky: physically based atmosphere, sun and moon for Port Solmar, in physical units.
//
// The sky dome samples a sky-view LUT (skyLut.ts) that is re-rendered only when the sun, the
// moon or the viewer's altitude change, adds the sun and moon discs, and writes nits × exposure.
// The same LUT without the discs is captured into a PMREM environment for image-based lighting.
// Sun and moon light are reported as physical values (lux at the ground, colour normalised to
// luminance 1); the engine applies the exposure to its lights.
//
// Night: the moonlit atmosphere plus the city's warm light pollution (strongest at the horizon)
// and airglow, so the sky is dark but never black.
import { BackSide, Color, Mesh, Scene, SphereGeometry, Vector3, Vector4, type PerspectiveCamera, type Texture } from 'three';
import { Fn, cross, dot, float, fwidth, int, length, max, min, normalize, positionLocal, pow, screenCoordinate, smoothstep, sqrt, step, uniform, uniformArray, vec3, vec4 } from 'three/tsl';
import { FloatType, MeshBasicNodeMaterial, NodeMaterial, PMREMGenerator, QuadMesh, RenderTarget, type Node, type WebGPURenderer } from 'three/webgpu';
import { DEFAULT_DAY_OF_YEAR, moonPosition, sunPosition } from '../render/atmosphere/ephemeris';
import {
  MOON_ANGULAR_RADIUS,
  SUN_ANGULAR_RADIUS,
  SUN_LUX,
  diskVisibility,
  luminance,
  smoothstep as smoothstepCpu,
  transmittanceToSpace,
  type RGB,
} from '../render/atmosphere/model';
import { LATITUDE } from '../world/config';
import { SkyLuts } from './skyLut';
import { exposureNode } from './units';

type V3 = Node<'vec3'>;

export interface SkyOptions {
  /** Day of the year, 1..365 (default 25 September). */
  dayOfYear?: number;
  /** Latitude in degrees north (default: Port Solmar). */
  latitude?: number;
  /** Angle of the moon east of the sun along the ecliptic (180 = full moon; default a bright gibbous moon). */
  moonElongation?: number;
}

const DEG = Math.PI / 180;

/** Full-moon illuminance at the top of the atmosphere (lux, mean distance, opposition surge included). */
const MOON_FULL_LUX = 0.25;
/** Colour of moonlight relative to sunlight: the regolith reflects red a little better than blue. */
const MOON_TINT: RGB = [1.04, 1.0, 0.94];
const SUN_SOLID_ANGLE = 2 * Math.PI * (1 - Math.cos(SUN_ANGULAR_RADIUS));
const MOON_SOLID_ANGLE = 2 * Math.PI * (1 - Math.cos(MOON_ANGULAR_RADIUS));
/**
 * Solar limb darkening I(mu) = mu^k per channel (R, G, B): the edge is darker and redder. The
 * centre is scaled by (k + 2) / 2 so the disc still averages to the full solar luminance.
 */
const LIMB_DARKENING: RGB = [0.397, 0.503, 0.652];

// Night sky radiance in nits: the city's sky glow (a bright suburban sky from a warm sodium/LED
// mix; Rayleigh scattering makes it bluer overhead than along the reddened horizon), the natural
// airglow, and the street-lit city seen from above.
const CITY_GLOW_ZENITH: RGB = [0.0082, 0.0083, 0.0092];
const CITY_GLOW_HORIZON: RGB = [0.16, 0.105, 0.075];
const AIRGLOW: RGB = [0.00025, 0.00032, 0.0004];
const CITY_GROUND_GLOW: RGB = [0.05, 0.036, 0.025];

/** Largest pre-exposed value the dome writes: half floats stop at 65504 and bloom needs headroom. */
const MAX_PRE_EXPOSED = 4000;
/** Dome radius as a fraction of camera.far. */
const DOME_FAR_FRACTION = 0.9;
const MIN_ALTITUDE_M = 1;
/** Sky-view LUT refresh: sun or moon moved by more than these angles. */
const LUT_SUN_COS = Math.cos(0.03 * DEG);
const LUT_MOON_COS = Math.cos(0.25 * DEG);
/** Environment refresh: coarser, except around sunrise and sunset when the sky changes fastest. */
const ENV_SUN_COS = Math.cos(1 * DEG);
const ENV_SUN_COS_TWILIGHT = Math.cos(0.25 * DEG);
const ENV_MOON_COS = Math.cos(2 * DEG);
/** ...and at most this often (ms), so fast-forwarding time can't turn it into a per-frame cost. */
const ENV_MIN_INTERVAL_MS = 250;
/** PMREM cube face size. */
const ENV_SIZE = 128;
/** Directions sampleSky() evaluates per call. */
const PROBE_SIZE = 64;

/** Moon brightness relative to full at a phase angle (radians): Allen's lunar phase law. */
function moonPhaseFactor(phaseAngle: number): number {
  const a = Math.abs(phaseAngle) / DEG;
  return Math.pow(10, -0.4 * (0.026 * a + 4e-9 * a ** 4));
}

/**
 * Rough mean sky luminance (nits) for a sun elevation (degrees): the unit in which the LUT and
 * the environment are stored. It only has to stay within ~10× of the truth to keep half floats
 * precise; in twilight the sky dims about tenfold per 2.7° of solar depression.
 */
export function referenceLuminance(sunElevationDeg: number): number {
  const h = sunElevationDeg;
  const sky = h >= 0 ? 180 + 7000 * Math.pow(Math.sin(h * DEG), 1.1) : 180 * Math.pow(10, 0.37 * h);
  return Math.max(0.01, sky);
}

/** Sets `out` to `rgb` normalised to luminance 1 (unchanged when rgb is black). */
function setNormalized(out: Color, rgb: RGB): void {
  const l = luminance(rgb);
  if (l > 1e-12) out.setRGB(rgb[0] / l, rgb[1] / l, rgb[2] / l);
}

/** Antialiased coverage of a disc: x is the angular distance from its centre in disc radii. */
function discCoverage(x: Node<'float'>, facing: Node<'float'>): Node<'float'> {
  const w = max(fwidth(x), 1e-3);
  return float(1).sub(smoothstep(float(1).sub(w), w.add(1), x)).mul(step(0, facing));
}

const _position = new Vector3();

export class PhysicalSky {
  /** Local solar time in hours (0..24). */
  timeOfDay = 12;
  dayOfYear: number;
  latitude: number;
  moonElongation: number;
  /** Sky sphere for the main view; add it to the scene. Outputs nits × exposureNode. */
  readonly mesh: Mesh;
  /** Unit vectors toward the sun and moon (apparent positions, refraction included). */
  readonly sunDirection = new Vector3(0, 1, 0);
  readonly moonDirection = new Vector3(0, -1, 0);
  /** Light colours: linear RGB normalised to luminance 1. */
  readonly sunColor = new Color(1, 1, 1);
  readonly moonColor = new Color(1, 1, 1);

  private readonly luts = new SkyLuts();
  /** Radiance unit of the sky-view LUT (nits). */
  private readonly lutScale = uniform(1);
  private readonly domeSun = uniform(new Vector3(0, 1, 0));
  private readonly domeMoon = uniform(new Vector3(0, -1, 0));
  /** Luminance of the moon's lit face (nits, top of the atmosphere, tinted). */
  private readonly moonRadiance = uniform(new Vector3());

  private readonly envScene = new Scene();
  private readonly envMesh: Mesh;
  private readonly pmrem: PMREMGenerator;
  private pmremTarget: RenderTarget | null = null;

  private probeQuad: QuadMesh | null = null;
  private probeTarget: RenderTarget | null = null;
  private readonly probeDirections = Array.from({ length: PROBE_SIZE }, () => new Vector4());

  private _sunIlluminance = 0;
  private _moonIlluminance = 0;
  private _nightFactor = 0;
  private _sunElevation = 90;
  private _moonElevation = -90;
  /** referenceLuminance() for the current sun. */
  private reference = 1;

  private staticDone = false;
  private lutDone = false;
  private readonly lutSun = new Vector3();
  private readonly lutMoon = new Vector3();
  private lutAltitude = 0;
  private lutNight = 0;
  private readonly envSun = new Vector3();
  private readonly envMoon = new Vector3();
  private envNight = 0;
  private envAltitude = 0;
  private envScale = 1;
  private envReference = 1;
  private envTime = 0;
  private _lutUpdates = 0;
  private _environmentUpdates = 0;

  constructor(
    private readonly renderer: WebGPURenderer,
    options: SkyOptions = {},
  ) {
    this.dayOfYear = options.dayOfYear ?? DEFAULT_DAY_OF_YEAR;
    this.latitude = options.latitude ?? LATITUDE;
    this.moonElongation = options.moonElongation ?? 168;

    this.mesh = new Mesh(new SphereGeometry(1, 48, 24), this.createDomeMaterial());
    this.mesh.name = 'Sky';
    this.mesh.frustumCulled = false;
    // Drawn first; depthWrite off, so everything else simply draws over it.
    this.mesh.renderOrder = -1e6;

    // The environment sees the same LUT without the discs: the sun's specular comes from the
    // DirectionalLight, and a 0.5° disc at 1e9 nits would only add fireflies to the prefilter.
    const envMaterial = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, depthTest: false, fog: false });
    envMaterial.name = 'Sky.Environment';
    envMaterial.lights = false;
    envMaterial.colorNode = this.luts.sample(normalize(positionLocal));
    this.envMesh = new Mesh(new SphereGeometry(10, 32, 16), envMaterial);
    this.envMesh.frustumCulled = false;
    this.envScene.add(this.envMesh);
    this.pmrem = new PMREMGenerator(renderer);
  }

  /** Illuminance at the ground (lux) after atmospheric transmittance, for DirectionalLights. */
  get sunIlluminance(): number {
    return this._sunIlluminance;
  }

  get moonIlluminance(): number {
    return this._moonIlluminance;
  }

  /** 0 by day, 1 at full night (for street lights / windows). */
  get nightFactor(): number {
    return this._nightFactor;
  }

  /** Apparent elevations above the horizon (degrees). */
  get sunElevation(): number {
    return this._sunElevation;
  }

  get moonElevation(): number {
    return this._moonElevation;
  }

  /** PMREM environment (sky + ground below the horizon, no sun or moon disc), or null before the first one. */
  get environment(): Texture | null {
    return this.pmremTarget?.texture ?? null;
  }

  /**
   * Converts the environment's stored values to nits. Between regenerations it follows the
   * reference luminance, so the image-based light keeps dimming smoothly through dusk.
   */
  get environmentScale(): number {
    return this.envScale * (this.reference / this.envReference);
  }

  /** Number of times the sky-view LUT and the environment were regenerated (for stats). */
  get lutUpdates(): number {
    return this._lutUpdates;
  }

  get environmentUpdates(): number {
    return this._environmentUpdates;
  }

  /** Updates sun/moon, the LUT (only when the sun moved), recentres/scales the mesh on the camera. Call once per frame before rendering. */
  update(camera: PerspectiveCamera): void {
    if (!this.staticDone) {
      this.luts.renderStatic(this.renderer);
      this.staticDone = true;
    }
    const hours = ((this.timeOfDay % 24) + 24) % 24;
    const sun = sunPosition(this.dayOfYear, hours, this.latitude);
    const moon = moonPosition(this.dayOfYear, hours, this.latitude, this.moonElongation);
    this.sunDirection.fromArray(sun.direction);
    this.moonDirection.fromArray(moon.direction);
    this._sunElevation = sun.elevation;
    this._moonElevation = moon.elevation;
    camera.getWorldPosition(_position);
    const altitudeKm = Math.max(MIN_ALTITUDE_M, _position.y) / 1000;

    // Direct sunlight and moonlight at the viewer.
    const sunT = transmittanceToSpace(altitudeKm, this.sunDirection.y);
    this._sunIlluminance = SUN_LUX * luminance(sunT) * diskVisibility(sun.elevation * DEG, SUN_ANGULAR_RADIUS);
    setNormalized(this.sunColor, sunT);
    // Phase angle (sun-moon-earth) is the supplement of the elongation seen from here.
    const phase = Math.PI - Math.acos(Math.min(1, Math.max(-1, this.sunDirection.dot(this.moonDirection))));
    const moonTop = MOON_FULL_LUX * moonPhaseFactor(phase);
    const moonT = transmittanceToSpace(altitudeKm, this.moonDirection.y);
    const moonLight: RGB = [moonT[0] * MOON_TINT[0], moonT[1] * MOON_TINT[1], moonT[2] * MOON_TINT[2]];
    this._moonIlluminance = moonTop * luminance(moonLight) * diskVisibility(moon.elevation * DEG, MOON_ANGULAR_RADIUS);
    setNormalized(this.moonColor, moonLight);
    this._nightFactor = 1 - smoothstepCpu(-7, 1.5, sun.elevation);
    this.reference = referenceLuminance(sun.elevation);

    if (this.lutStale(altitudeKm)) this.renderSkyView(altitudeKm, moonTop);

    this.domeSun.value.copy(this.sunDirection);
    this.domeMoon.value.copy(this.moonDirection);
    // The lit part's luminance: the phase law dims the whole moon faster than its lit fraction shrinks.
    const litFraction = Math.max(0.05, (1 + Math.cos(phase)) / 2);
    this.moonRadiance.value.fromArray(MOON_TINT).multiplyScalar(moonTop / (MOON_SOLID_ANGLE * litFraction));
    // The dome follows the camera, so its motion vectors hold camera rotation only.
    this.mesh.position.copy(_position);
    this.mesh.scale.setScalar(camera.far * DOME_FAR_FRACTION);

    if (this.environmentStale()) this.renderEnvironment();
  }

  /**
   * Sky radiance in nits (linear RGB, without the sun and moon discs) toward up to 64 world
   * directions, read back from the GPU: for tests, fog colours and exposure estimates.
   */
  async sampleSky(directions: readonly Vector3[]): Promise<Color[]> {
    const n = Math.min(directions.length, PROBE_SIZE);
    if (!this.probeQuad || !this.probeTarget) {
      const dirs = uniformArray(this.probeDirections, 'vec4' as const);
      const material = new NodeMaterial();
      material.name = 'Sky.Probe';
      material.fragmentNode = Fn(() => {
        const dir = normalize(dirs.element(int(screenCoordinate.x)).xyz);
        return vec4(this.luts.sample(dir).mul(this.lutScale), 1);
      })();
      this.probeQuad = new QuadMesh(material);
      this.probeTarget = new RenderTarget(PROBE_SIZE, 1, { type: FloatType, depthBuffer: false });
    }
    for (let i = 0; i < n; i++) this.probeDirections[i].set(directions[i].x, directions[i].y, directions[i].z, 0);
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.probeTarget);
    this.probeQuad.render(this.renderer);
    this.renderer.setRenderTarget(previous);
    const px = await this.renderer.readRenderTargetPixelsAsync(this.probeTarget, 0, 0, n, 1);
    const out: Color[] = [];
    for (let i = 0; i < n; i++) out.push(new Color(Number(px[i * 4]), Number(px[i * 4 + 1]), Number(px[i * 4 + 2])));
    return out;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as NodeMaterial).dispose();
    this.envMesh.geometry.dispose();
    (this.envMesh.material as NodeMaterial).dispose();
    this.pmremTarget?.dispose();
    this.pmrem.dispose();
    this.luts.dispose();
    (this.probeQuad?.material as NodeMaterial | undefined)?.dispose();
    this.probeTarget?.dispose();
  }

  private createDomeMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
    material.name = 'Sky.Dome';
    material.lights = false;
    const dir = normalize(positionLocal);
    const toSpace = this.luts.viewTransmittance(dir);

    // Sun: limb-darkened disc whose integral is the solar illuminance.
    const sunX = length(cross(dir, this.domeSun)).div(Math.sin(SUN_ANGULAR_RADIUS));
    const sunMu = sqrt(max(float(1).sub(min(sunX, 1).mul(min(sunX, 1))), 0));
    const limb = pow(vec3(max(sunMu, 0.02)), vec3(...LIMB_DARKENING)).mul(vec3(...LIMB_DARKENING.map((k) => (k + 2) / 2)));
    const sunDisc = limb.mul(discCoverage(sunX, dot(dir, this.domeSun))).mul(SUN_LUX / SUN_SOLID_ANGLE);

    // Moon: flat-lit disc with the terminator where the lunar sphere turns away from the sun.
    const moonCos = dot(dir, this.domeMoon);
    const onDisc = dir.sub(this.domeMoon.mul(moonCos)).div(Math.sin(MOON_ANGULAR_RADIUS));
    const moonX = length(onDisc);
    const normal = onDisc.sub(this.domeMoon.mul(sqrt(max(float(1).sub(moonX.mul(moonX)), 0))));
    const lit = smoothstep(-0.03, 0.03, dot(normal, this.domeSun));
    const moonDisc = this.moonRadiance.mul(discCoverage(moonX, moonCos)).mul(lit);

    const sky: V3 = this.luts.sample(dir).mul(this.lutScale);
    const radiance = sky.add(sunDisc.add(moonDisc).mul(toSpace));
    // Pre-exposed; the sun is scaled down (hue kept) to stay inside half-float range.
    const exposed = radiance.mul(exposureNode);
    const peak = max(max(exposed.r, exposed.g), exposed.b);
    material.colorNode = exposed.mul(min(float(1), float(MAX_PRE_EXPOSED).div(max(peak, 1e-6))));
    return material;
  }

  private lutStale(altitudeKm: number): boolean {
    return (
      !this.lutDone ||
      this.lutSun.dot(this.sunDirection) < LUT_SUN_COS ||
      this.lutMoon.dot(this.moonDirection) < LUT_MOON_COS ||
      Math.abs(altitudeKm - this.lutAltitude) > Math.max(0.005, 0.1 * this.lutAltitude) ||
      Math.abs(this._nightFactor - this.lutNight) > 0.005
    );
  }

  private renderSkyView(altitudeKm: number, moonTop: number): void {
    const p = this.luts.params;
    const scale = this.reference;
    const city = this._nightFactor;
    p.setAltitude(altitudeKm);
    p.setSun(this.sunDirection);
    p.moonDirection.value.copy(this.moonDirection);
    p.sunIlluminance.value.setScalar(SUN_LUX / scale);
    p.moonIlluminance.value.fromArray(MOON_TINT).multiplyScalar(moonTop / scale);
    p.nightZenith.value.set(
      (CITY_GLOW_ZENITH[0] * city + AIRGLOW[0]) / scale,
      (CITY_GLOW_ZENITH[1] * city + AIRGLOW[1]) / scale,
      (CITY_GLOW_ZENITH[2] * city + AIRGLOW[2]) / scale,
    );
    // Airglow doubles toward the horizon (longer path through the emitting layer).
    p.nightHorizon.value.set(
      (CITY_GLOW_HORIZON[0] * city + 2 * AIRGLOW[0]) / scale,
      (CITY_GLOW_HORIZON[1] * city + 2 * AIRGLOW[1]) / scale,
      (CITY_GLOW_HORIZON[2] * city + 2 * AIRGLOW[2]) / scale,
    );
    p.groundGlow.value.fromArray(CITY_GROUND_GLOW).multiplyScalar(city / scale);
    this.luts.renderSkyView(this.renderer);
    this.lutScale.value = scale;
    this.lutSun.copy(this.sunDirection);
    this.lutMoon.copy(this.moonDirection);
    this.lutAltitude = altitudeKm;
    this.lutNight = city;
    this.lutDone = true;
    this._lutUpdates++;
  }

  private environmentStale(): boolean {
    if (!this.pmremTarget) return true;
    if (performance.now() - this.envTime < ENV_MIN_INTERVAL_MS) return false;
    const twilight = this._sunElevation > -14 && this._sunElevation < 12;
    return (
      this.envSun.dot(this.sunDirection) < (twilight ? ENV_SUN_COS_TWILIGHT : ENV_SUN_COS) ||
      this.envMoon.dot(this.moonDirection) < ENV_MOON_COS ||
      Math.abs(this._nightFactor - this.envNight) > 0.05 ||
      Math.abs(this.lutAltitude - this.envAltitude) > Math.max(0.05, 0.5 * this.envAltitude)
    );
  }

  private renderEnvironment(): void {
    // The first call allocates the PMREM target; later calls render into it again.
    this.pmremTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 100, { size: ENV_SIZE, renderTarget: this.pmremTarget });
    this.envScale = this.lutScale.value;
    this.envReference = this.reference;
    this.envSun.copy(this.sunDirection);
    this.envMoon.copy(this.moonDirection);
    this.envNight = this._nightFactor;
    this.envAltitude = this.lutAltitude;
    this.envTime = performance.now();
    this._environmentUpdates++;
  }
}
