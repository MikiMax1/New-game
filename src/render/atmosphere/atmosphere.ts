import * as THREE from 'three';
import { atLeast, type Quality } from '../../core/quality';
import { LATITUDE } from '../../world/config';
import type { Environment } from '../basicEnvironment';
import { atmosphereUniform, installAtmosphereChunks, registerMaterial, registerObject } from './chunks';
import { DEFAULT_DAY_OF_YEAR, moonPosition, sunPosition } from './ephemeris';
import { SkyEnvironment } from './envmap';
import { AtmosphereLuts } from './luts';
import {
  ATMOSPHERE,
  MOON_ANGULAR_RADIUS,
  MOON_RELATIVE_ILLUMINANCE,
  SUN_ANGULAR_RADIUS,
  SUN_ILLUMINANCE,
  SUN_LUX,
  candelaToScene,
  diskVisibility,
  luminance,
  smoothstep,
  transmittanceToSpace,
  type RGB,
} from './model';
import { cloudThreshold, createCloudNoiseTexture } from './noise';
import { CascadedShadows } from './shadows';
import { CloudPass, SkyDome, createSkyUniforms } from './sky';

export interface AtmosphereOptions {
  /** Day of the year, 1..365 (default 25 September). */
  dayOfYear?: number;
  /** Latitude in degrees north (default: Port Solmar). */
  latitude?: number;
  /** Angle of the moon east of the sun along the ecliptic (180 = full moon). */
  moonElongation?: number;
  /** Cumulus cover, 0..1. */
  clouds?: number;
  /** Multiplier of the humid haze density (1 = typical South Florida day). */
  haze?: number;
  /** Tint each shadow cascade (debug). */
  debugCascades?: boolean;
}

// --- Light adaptation -------------------------------------------------------------------------
// The scene spans ~17 stops between noon and a moonlit night. Two curves of the horizontal
// illuminance E (relative to noon) handle it:
//  - lightScale = (E / E_noon)^-PRE_EXPOSURE multiplies every light the atmosphere owns (sun,
//    moon, sky, environment, fog), keeping night values well inside half-float precision while
//    preserving all ratios within a frame (a partial "pre-exposure");
//  - the displayed exposure = KEY * (E / E_noon)^-ADAPTATION: the eye adapts to 78% of the
//    change, so night reads ~4 stops darker than day, twilight in between.
// renderer.toneMappingExposure = displayed exposure / lightScale.
const NOON_ILLUMINANCE = 0.86;
const PRE_EXPOSURE = 0.6;
const ADAPTATION = 0.74;
const EXPOSURE_KEY = 0.78;
/** Seconds for the eye to adapt most of the way after a sudden change (time skip). */
const ADAPT_TIME = 0.8;

// Night sky radiance in cd/m2: city sky glow (warm, strongest near the horizon; the zenith of a
// suburban-bright sky, so a moonlit sky still reads blue overhead) and airglow.
const CITY_GLOW_ZENITH: RGB = [0.0095, 0.0082, 0.0074];
const CITY_GLOW_HORIZON: RGB = [0.16, 0.105, 0.075];
/** Mean luminance of the lit city seen from above at night (cd/m2): lights up cloud bases. */
const CITY_UPLIGHT = 0.12;
/** Share of that glow in the environment's lower hemisphere (ambient from the ground). */
const CITY_GROUND_GLOW = 0.35;
const AIRGLOW: RGB = [0.00025, 0.00032, 0.0004];
/**
 * Illuminance of a magnitude-0 star relative to the sun at the top of the atmosphere, with a
 * 2.5x boost: a screen cannot show point sources at the eye's acuity, so stars are brightened
 * to read as they do in person.
 */
const STAR_MAG0 = (2.5 * 2.54e-6) / SUN_LUX;
const MOON_DRAW_SCALE = 2;
/** Moonlight looks blue to the dark-adapted eye (Purkinje shift); tint the key light. */
const MOON_TINT: RGB = [0.72, 0.86, 1.18];
const GROUND_ALBEDO = 0.12;

const _v = new THREE.Vector3();
const _rgb: RGB = [0, 0, 0];
const _rgb2: RGB = [0, 0, 0];

/** Cloud raymarch steps for the main camera (in the reduced-resolution cloud pass). */
function cloudStepsFor(q: Quality): number {
  return q.name === 'low' ? 24 : q.name === 'medium' ? 36 : q.name === 'high' ? 56 : 72;
}

/** Cloud pass resolution divisor. */
function cloudDivisorFor(q: Quality): number {
  return q.name === 'low' ? 4 : q.name === 'medium' ? 3 : q.name === 'extreme' ? 1 : 2;
}

const ENV_CLOUD_STEPS = 18;

/** Relative cumulus cover over the day (1 = the configured afternoon cover). */
export function diurnalCumulus(hours: number): number {
  const h = ((hours % 24) + 24) % 24;
  const build = smoothstep(7.5, 13, h);
  const decay = 1 - smoothstep(18, 21, h);
  return 0.35 + 0.65 * build * decay;
}

function envSizeFor(q: Quality): number {
  return q.name === 'low' ? 64 : atLeast(q, 'ultra') ? 256 : 128;
}

/**
 * Physically based sky, sun and moon, cascaded shadows, sky-lit environment and humid
 * aerial perspective for Port Solmar. Implements the game's Environment interface.
 *
 * Construct it before the first frame is rendered (it installs shader chunks globally).
 */
export class Atmosphere implements Environment {
  /** Local solar time, hours 0..24. */
  timeOfDay = 16.5;
  dayOfYear: number;
  latitude: number;
  moonElongation: number;
  /** Cumulus cover 0..1. */
  cloudCoverage: number;
  /** Haze density multiplier. */
  haze: number;

  /** Unit vector toward the sun (apparent position, refraction included). */
  readonly sunDirection = new THREE.Vector3(0, 1, 0);
  /** Unit vector toward the moon. */
  readonly moonDirection = new THREE.Vector3(0, -1, 0);
  /** Apparent elevations in degrees. */
  sunElevation = 0;
  moonElevation = 0;
  /** Colour of direct sunlight at the camera (normalised) and its illuminance in scene units. */
  readonly sunColor = new THREE.Color(1, 1, 1);
  sunIntensity = 0;
  /** 0 in daylight .. 1 at night: drive street lights and lit windows with it. */
  nightFactor = 0;
  /** Skylight illuminance on a horizontal surface (scene units) and its colour. */
  ambientIntensity = 0;
  readonly ambientColor = new THREE.Color(1, 1, 1);
  /**
   * Multiplier the atmosphere applies to its own lights (pre-exposure). Lights of other systems
   * that should be physically consistent can be multiplied by it; lights tuned by eye at night
   * need not be.
   */
  lightScale = 1;
  /** Displayed exposure (lightScale * renderer.toneMappingExposure). */
  displayExposure = EXPOSURE_KEY;
  /** True once the LUTs and the first environment map exist. */
  ready = false;

  /** The key light: the sun by day, the moon by night (cascade 0 of the shadows). */
  readonly keyLight: THREE.DirectionalLight;

  private readonly luts: AtmosphereLuts;
  private readonly skyUniforms = createSkyUniforms();
  private readonly sky: SkyDome;
  private readonly envSky: SkyDome;
  private readonly env: SkyEnvironment;
  private readonly clouds: CloudPass;
  private cloudDivisor: number;
  private readonly shadows = new CascadedShadows();
  private readonly noise: THREE.DataTexture;
  private readonly fog: THREE.FogExp2;
  private first = true;
  private clock = 0;
  private readonly readyCallbacks: (() => void)[] = [];

  // Change tracking for the throttled GPU work.
  private readonly lutSun = new THREE.Vector3();
  private readonly lutMoon = new THREE.Vector3();
  private lutLightScale = 1;
  private lutAltitude = -1;
  private readonly envSun = new THREE.Vector3();
  private readonly envMoon = new THREE.Vector3();
  private envLightScale = 1;
  private envClock = -1e9;
  private envHaze = -1;
  private envClouds = -1;
  private logExposure = Math.log(EXPOSURE_KEY);

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    quality: Quality,
    options: AtmosphereOptions = {},
  ) {
    this.dayOfYear = options.dayOfYear ?? DEFAULT_DAY_OF_YEAR;
    this.latitude = options.latitude ?? LATITUDE;
    this.moonElongation = options.moonElongation ?? 168;
    this.cloudCoverage = options.clouds ?? 0.2;
    this.haze = options.haze ?? 1;

    installAtmosphereChunks(options.debugCascades ?? false);

    this.luts = new AtmosphereLuts();
    this.noise = createCloudNoiseTexture();
    const u = this.skyUniforms;
    u.skyViewLut.value = this.luts.skyView.texture;
    u.transmittanceLut.value = this.luts.transmittance.texture;
    u.noiseTex.value = this.noise;
    u.sunCosRadius.value = Math.cos(SUN_ANGULAR_RADIUS);
    // The moon is drawn at twice its true size (it would be ~6 px at 1080p): a common and
    // believable exaggeration that lets its maria show. Moonlight is unaffected.
    u.moonCosRadius.value = Math.cos(MOON_ANGULAR_RADIUS * MOON_DRAW_SCALE);
    u.hazeRayleigh.value.fromArray(ATMOSPHERE.rayleighScattering).multiplyScalar(1e-3);

    this.clouds = new CloudPass(u, cloudStepsFor(quality));
    this.cloudDivisor = cloudDivisorFor(quality);
    u.cloudBuffer.value = this.clouds.target.texture;
    this.sky = new SkyDome(u, { env: false, cloudSteps: cloudStepsFor(quality) });
    this.envSky = new SkyDome(u, { env: true, cloudSteps: ENV_CLOUD_STEPS });
    this.env = new SkyEnvironment(renderer, this.envSky, envSizeFor(quality));
    scene.add(this.sky.mesh);

    this.shadows.configure(this.cascadeConfig(quality));
    this.keyLight = this.shadows.keyLight;
    scene.add(this.shadows.group);

    this.fog = new THREE.FogExp2(0x8899aa, 0.0002);
    scene.fog = this.fog;
    scene.background = null;

    const a = atmosphereUniform.value;
    a.skyView = this.luts.skyView.texture;
    a.fogB.set(ATMOSPHERE.rayleighScattering[0] * 1e-3, ATMOSPHERE.rayleighScattering[1] * 1e-3, ATMOSPHERE.rayleighScattering[2] * 1e-3, 30000);

    renderer.shadowMap.autoUpdate = false;
  }

  /** Materials of other systems: see chunks.ts. Built-in materials need no registration. */
  registerMaterial(material: THREE.Material): void {
    registerMaterial(material);
  }

  registerObject(root: THREE.Object3D): void {
    registerObject(root);
  }

  /** Called once the first environment map is ready (immediately if it already is). */
  onReady(fn: () => void): void {
    if (this.ready) fn();
    else this.readyCallbacks.push(fn);
  }

  /** Current exposure written to renderer.toneMappingExposure. */
  get exposure(): number {
    return this.renderer.toneMappingExposure;
  }

  /** Shadow split distances of the last frame (m). */
  get cascadeSplits(): readonly number[] {
    return this.shadows.splits;
  }

  /** Number of times the environment map has been regenerated. */
  get environmentUpdates(): number {
    return this.env.generations;
  }

  setQuality(q: Quality): void {
    this.shadows.configure(this.cascadeConfig(q));
    this.clouds.setSteps(cloudStepsFor(q));
    this.cloudDivisor = cloudDivisorFor(q);
    // Resizing drops the PMREM target, which makes the next update regenerate it.
    this.env.setSize(envSizeFor(q));
  }

  private cascadeConfig(q: Quality) {
    return { enabled: q.shadows, count: q.shadowCascades, mapSize: q.shadowMapSize, maxDistance: q.shadowDistance };
  }

  update(dt: number, cameraIn: THREE.Camera): void {
    const renderer = this.renderer;
    const camera = (cameraIn as THREE.PerspectiveCamera).isPerspectiveCamera ? (cameraIn as THREE.PerspectiveCamera) : this.camera;
    this.clock += dt;
    camera.updateMatrixWorld();
    if (this.first) this.luts.renderStatic(renderer);

    // --- Sun and moon -------------------------------------------------------------------------
    const t = ((this.timeOfDay % 24) + 24) % 24;
    const sun = sunPosition(this.dayOfYear, t, this.latitude);
    const moon = moonPosition(this.dayOfYear, t, this.latitude, this.moonElongation);
    this.sunDirection.fromArray(sun.direction);
    this.moonDirection.fromArray(moon.direction);
    this.sunElevation = sun.elevation;
    this.moonElevation = moon.elevation;
    const altitudeM = Math.max(1, camera.position.y);
    const altKm = altitudeM / 1000;

    const sunT = transmittanceToSpace(altKm, this.sunDirection.y);
    const sunVis = diskVisibility(THREE.MathUtils.degToRad(sun.elevation), SUN_ANGULAR_RADIUS);
    const moonT = transmittanceToSpace(altKm, this.moonDirection.y);
    const moonVis = diskVisibility(THREE.MathUtils.degToRad(moon.elevation), MOON_ANGULAR_RADIUS);
    const skySun = this.luts.skyIrradiance(this.sunDirection.y, _rgb);
    const skyMoon = this.luts.skyIrradiance(this.moonDirection.y, _rgb2);

    // --- Adaptation: horizontal illuminance relative to the sun at the top of the atmosphere ---
    const cityGlowIllum = (Math.PI * luminance(CITY_GLOW_ZENITH) * 2.2 + Math.PI * luminance(AIRGLOW)) / SUN_LUX;
    // Metered like an incident-light meter tilted partly toward the light: a low sun still
    // counts, so golden hour does not get pushed until the sunward sky burns out.
    const tilt = (y: number) => 0.35 + 0.65 * Math.max(0, y);
    const E =
      luminance(sunT) * sunVis * tilt(this.sunDirection.y) +
      luminance(skySun) +
      MOON_RELATIVE_ILLUMINANCE * (luminance(moonT) * moonVis * tilt(this.moonDirection.y) + luminance(skyMoon)) +
      cityGlowIllum;
    const rel = Math.max(1e-9, E / NOON_ILLUMINANCE);
    const S = THREE.MathUtils.clamp(Math.pow(rel, -PRE_EXPOSURE), 0.5, 1e5);
    this.lightScale = S;
    const targetLogExposure = Math.log(EXPOSURE_KEY * Math.pow(rel, -ADAPTATION));
    if (this.first) this.logExposure = targetLogExposure;
    else this.logExposure += (targetLogExposure - this.logExposure) * (1 - Math.exp(-dt / (ADAPT_TIME / 3)));
    this.displayExposure = Math.exp(this.logExposure);
    renderer.toneMappingExposure = this.displayExposure / S;

    const unit = SUN_ILLUMINANCE * S;
    this.nightFactor = 1 - smoothstep(-7, 1.5, sun.elevation);

    // --- Key light: the sun, or the moon once the sun has set --------------------------------
    const sunDirect = _v.set(sunT[0], sunT[1], sunT[2]).multiplyScalar(sunVis * unit);
    this.sunIntensity = Math.max(sunDirect.x, sunDirect.y, sunDirect.z);
    if (this.sunIntensity > 0) this.sunColor.setRGB(sunDirect.x / this.sunIntensity, sunDirect.y / this.sunIntensity, sunDirect.z / this.sunIntensity);
    const moonScale = MOON_RELATIVE_ILLUMINANCE * moonVis * unit;
    const moonDirect = [moonT[0] * MOON_TINT[0] * moonScale, moonT[1] * MOON_TINT[1] * moonScale, moonT[2] * MOON_TINT[2] * moonScale];
    const useSun = sun.elevation > -0.8 || luminance(moonDirect as RGB) <= 0;
    const key = this.keyLight;
    const keyDir = useSun ? this.sunDirection : this.moonDirection;
    const kr = useSun ? sunDirect.x : moonDirect[0];
    const kg = useSun ? sunDirect.y : moonDirect[1];
    const kb = useSun ? sunDirect.z : moonDirect[2];
    const kmax = Math.max(kr, kg, kb);
    if (kmax > 0) key.color.setRGB(kr / kmax, kg / kmax, kb / kmax);
    key.intensity = kmax;
    const shadowsActive = kmax * renderer.toneMappingExposure > 0.004 && keyDir.y > 0.005;
    renderer.shadowMap.needsUpdate = this.shadows.update(camera, keyDir, shadowsActive);

    // --- Ambient (skylight) --------------------------------------------------------------------
    const ar = (skySun[0] + MOON_RELATIVE_ILLUMINANCE * skyMoon[0]) * unit;
    const ag = (skySun[1] + MOON_RELATIVE_ILLUMINANCE * skyMoon[1]) * unit;
    const ab = (skySun[2] + MOON_RELATIVE_ILLUMINANCE * skyMoon[2]) * unit;
    const glow = candelaToScene(Math.PI * 2.2) * S;
    const amb: RGB = [ar + glow * CITY_GLOW_ZENITH[0], ag + glow * CITY_GLOW_ZENITH[1], ab + glow * CITY_GLOW_ZENITH[2]];
    this.ambientIntensity = luminance(amb);
    const amax = Math.max(amb[0], amb[1], amb[2], 1e-12);
    this.ambientColor.setRGB(amb[0] / amax, amb[1] / amax, amb[2] / amax);

    // --- Haze ---------------------------------------------------------------------------------
    // Humidity rises toward evening and at night; the low sun also shows more of the haze.
    const hazeMul = this.haze * (1 + 0.22 * (1 - smoothstep(3, 30, sun.elevation)));
    const sigmaM = (ATMOSPHERE.mieExtinction / 1000) * hazeMul;
    const invH = 1 / (ATMOSPHERE.mieScaleHeight * 1000);
    const horizonElev = -Math.acos(ATMOSPHERE.groundRadius / (ATMOSPHERE.groundRadius + altKm));

    // --- Sky-view LUT (throttled) --------------------------------------------------------------
    const lutNeeded =
      this.first ||
      this.lutSun.dot(this.sunDirection) < 0.9999998 ||
      this.lutMoon.dot(this.moonDirection) < 0.999999 ||
      Math.abs(S / this.lutLightScale - 1) > 0.02 ||
      Math.abs(altKm - this.lutAltitude) > 0.02;
    if (lutNeeded) {
      const moonOn = this.moonDirection.y > -0.15 ? 1 : 0;
      const nightScale = candelaToScene(1) * S;
      this.luts.renderSkyView(renderer, {
        cameraAltitudeKm: altKm,
        sunDir: this.sunDirection,
        sunIlluminance: new THREE.Vector3(unit, unit, unit),
        moonDir: this.moonDirection,
        moonIlluminance: new THREE.Vector3(1, 1, 1).multiplyScalar(unit * MOON_RELATIVE_ILLUMINANCE * moonOn),
        nightZenith: new THREE.Vector3(CITY_GLOW_ZENITH[0] + AIRGLOW[0], CITY_GLOW_ZENITH[1] + AIRGLOW[1], CITY_GLOW_ZENITH[2] + AIRGLOW[2]).multiplyScalar(nightScale),
        nightHorizon: new THREE.Vector3(CITY_GLOW_HORIZON[0] + AIRGLOW[0] * 2, CITY_GLOW_HORIZON[1] + AIRGLOW[1] * 2, CITY_GLOW_HORIZON[2] + AIRGLOW[2] * 2).multiplyScalar(nightScale),
      });
      this.lutSun.copy(this.sunDirection);
      this.lutMoon.copy(this.moonDirection);
      this.lutLightScale = S;
      this.lutAltitude = altKm;
    }
    const lutScale = S / this.lutLightScale;

    // --- Shared fog uniforms (every material) --------------------------------------------------
    const a = atmosphereUniform.value;
    a.skyView = this.luts.skyView.texture;
    a.fogA.set(1, sigmaM, invH, lutScale);
    a.fogC.set(camera.far * 0.7, camera.far * 0.97, horizonElev, 0);
    // Classic fog values for shaders outside the atmosphere path, and for N8AO's AO fade.
    this.fog.density = Math.sqrt(sigmaM * 3000) / 3000;
    this.fog.color.setRGB(amb[0], amb[1], amb[2]).multiplyScalar(1 / Math.PI);

    // --- Sky uniforms --------------------------------------------------------------------------
    const u = this.skyUniforms;
    const post = renderer.toneMappingExposure;
    u.lutScale.value = lutScale;
    u.cameraRadius.value = ATMOSPHERE.groundRadius + altKm;
    u.cameraHeight.value = altitudeM;
    u.horizonElev.value = horizonElev;
    u.sunDir.value.copy(this.sunDirection);
    const sunSolid = Math.PI * SUN_ANGULAR_RADIUS * SUN_ANGULAR_RADIUS;
    const sunDisk = Math.min(unit / sunSolid, 45 / post, 30000);
    u.sunDiskRadiance.value.set(sunDisk, sunDisk, sunDisk);
    u.moonDir.value.copy(this.moonDirection);
    const moonSolid = Math.PI * MOON_ANGULAR_RADIUS * MOON_ANGULAR_RADIUS;
    const moonDisk = Math.min((unit * MOON_RELATIVE_ILLUMINANCE) / moonSolid, 2.4 / post);
    u.moonDiskRadiance.value.set(moonDisk, moonDisk * 0.97, moonDisk * 0.92);
    u.starScale.value = STAR_MAG0 * unit;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    u.pixelAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, size.y);
    u.time.value = this.clock;
    u.hazeA.value.set(ATMOSPHERE.mieExtinction / 1000, invH, hazeMul - 1, 0);
    const groundE = (luminance(sunT) * sunVis * Math.max(0, this.sunDirection.y) + MOON_RELATIVE_ILLUMINANCE * luminance(moonT) * moonVis * Math.max(0, this.moonDirection.y)) * unit;
    const cityLights = candelaToScene(CITY_UPLIGHT) * S * this.nightFactor;
    const glowG = cityLights * CITY_GROUND_GLOW;
    u.groundRadiance.value.set(
      (GROUND_ALBEDO / Math.PI) * (groundE * this.sunColor.r + amb[0]) + glowG,
      (GROUND_ALBEDO / Math.PI) * (groundE * this.sunColor.g + amb[1]) + glowG * 0.72,
      (GROUND_ALBEDO / Math.PI) * (groundE * this.sunColor.b + amb[2]) + glowG * 0.5,
    );

    // Clouds: lit by the sun while it still reaches cloud height, then by the moon.
    const cloudBase = 1150;
    const cloudT = transmittanceToSpace(1.6, this.sunDirection.y);
    const sunAtClouds = luminance(cloudT) > 1e-4;
    // Florida's fair-weather cumulus are convective: they build through the late morning, peak
    // in the afternoon and mostly dissipate after sunset.
    const coverage = this.cloudCoverage * diurnalCumulus(t);
    u.cloudA.value.set(cloudThreshold(coverage), cloudBase, 1100, 0.022);
    // Trade-wind drift from the east-south-east, a few m/s (continuous with the time of day).
    const windX = -4.5 * this.clock - 3600 * 3.2 * t;
    const windZ = 1.5 * this.clock + 3600 * 1.1 * t;
    // Wrap at 252 km, a common multiple of every noise tile size, so wrapping never shows.
    u.cloudB.value.set(windX % 252000, windZ % 252000, coverage > 0.001 ? 1 : 0, 1);
    if (sunAtClouds) {
      u.cloudLightDir.value.copy(this.sunDirection);
      u.cloudLightColor.value.set(cloudT[0], cloudT[1], cloudT[2]).multiplyScalar(unit);
    } else {
      u.cloudLightDir.value.copy(this.moonDirection);
      const mT = transmittanceToSpace(1.6, this.moonDirection.y);
      u.cloudLightColor.value.set(mT[0], mT[1], mT[2]).multiplyScalar(unit * MOON_RELATIVE_ILLUMINANCE);
    }
    // Ambient in-scatter = mean radiance arriving at the cloud: mostly sky above, the lit
    // ground (and at night the city's glow) below.
    u.cloudAmbientTop.value.set(amb[0], amb[1], amb[2]).multiplyScalar(0.7 / Math.PI);
    u.cloudAmbientBottom.value
      .set(amb[0], amb[1], amb[2])
      .multiplyScalar(0.2 / Math.PI)
      .addScaledVector(u.groundRadiance.value, 0.9)
      .addScaledVector(new THREE.Vector3(1, 0.66, 0.42), cityLights);

    // Clouds for this frame's view, at reduced resolution.
    if (this.cloudCoverage > 0.001) this.clouds.render(renderer, camera, this.cloudDivisor);

    // --- Environment map (throttled) -----------------------------------------------------------
    const envNeeded =
      !this.env.texture ||
      this.envSun.dot(this.sunDirection) < 0.99999 ||
      this.envMoon.dot(this.moonDirection) < 0.9999 ||
      Math.abs(hazeMul - this.envHaze) > 0.02 ||
      Math.abs(this.cloudCoverage - this.envClouds) > 0.01 ||
      (this.cloudCoverage > 0 && this.clock - this.envClock > 8);
    if (envNeeded) {
      this.scene.environment = this.env.update(renderer);
      this.envSun.copy(this.sunDirection);
      this.envMoon.copy(this.moonDirection);
      this.envLightScale = S;
      this.envClock = this.clock;
      this.envHaze = hazeMul;
      this.envClouds = this.cloudCoverage;
    }
    this.scene.environmentIntensity = S / this.envLightScale;

    this.first = false;
    if (!this.ready) {
      this.ready = true;
      for (const fn of this.readyCallbacks.splice(0)) fn();
    }
  }

  dispose(): void {
    this.scene.remove(this.sky.mesh);
    this.sky.dispose();
    this.envSky.dispose();
    this.clouds.dispose();
    this.env.dispose();
    this.shadows.dispose();
    this.luts.dispose();
    this.noise.dispose();
    if (this.scene.fog === this.fog) this.scene.fog = null;
    if (this.scene.environment) this.scene.environment = null;
    const a = atmosphereUniform.value;
    a.fogA.x = 0;
    a.skyView = null;
    this.renderer.shadowMap.autoUpdate = true;
  }
}
