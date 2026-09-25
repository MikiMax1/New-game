// Image-based lighting from a photographed HDR sky, plus the sun as a shadow-casting light.
//
// An outdoor HDRI already contains the sun: a few pixels tens of thousands of times brighter than
// the sky. Pre-filtered as it is (PMREM), that energy would light everything from all directions
// at once and nothing would cast a shadow. So the sun is found in the image, its pixels are
// clamped down to the brightness of the surrounding sky, and the energy removed becomes a
// DirectionalLight with the same colour, direction and illuminance, casting 4096² soft shadows.
// Light is conserved: sky + sun light the scene exactly as the unclamped HDRI would, but the sun's
// share now casts shadows and gives sharp highlights.
import {
  Box3,
  Color,
  DataUtils,
  DirectionalLight,
  Euler,
  LinearSRGBColorSpace,
  PCFShadowMap,
  PMREMGenerator,
  Sphere,
  Vector3,
  type DataTexture,
  type Scene,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';

/** The sun, as measured in an HDRI. Directions are in the image's frame (before rotation). */
export interface SunEstimate {
  /** Unit vector towards the sun. */
  direction: Vector3;
  /** Linear RGB colour, brightest channel 1. */
  color: Color;
  /** Illuminance on a surface facing the sun, in the HDRI's units (its sky ≈ 1). */
  illuminance: number;
  /** Radiance above which pixels counted as the sun and were clamped. */
  clampLevel: number;
  /** Pixels clamped. */
  pixels: number;
}

export interface EnvironmentOptions {
  /** Rotation of the HDRI about the vertical axis, radians. Turns the sun and the backdrop. */
  rotation?: number;
  /** Multiplier on the HDRI's brightness (sky, sun and backdrop alike). */
  intensity?: number;
  /** Show the HDRI as the backdrop. */
  background?: boolean;
  /** Blur of the backdrop, 0 = sharp photograph. */
  backgroundBlurriness?: number;
  /**
   * The sun is whatever is brighter than this many times the median sky radiance (default 24).
   * Lower takes more of the bright sky around the sun into the light.
   */
  sunThreshold?: number;
}

const _euler = new Euler();

export class LightingManager {
  /** The key light: the sun extracted from the HDRI. */
  readonly sun = new DirectionalLight(0xffffff, 0);
  /** The sun as measured in the current HDRI, or null for an overcast sky (no distinct sun). */
  sunEstimate: SunEstimate | null = null;
  /** World-space unit vector towards the sun (after the HDRI's rotation). */
  readonly sunDirection = new Vector3(0, 1, 0);
  private readonly pmrem: PMREMGenerator;
  private envMap: Texture | null = null;
  private readonly shadowCenter = new Vector3();
  private shadowRadius = 20;

  constructor(
    renderer: WebGPURenderer,
    private readonly scene: Scene,
  ) {
    this.pmrem = new PMREMGenerator(renderer);
    // PCFSoftShadowMap is gone from the WebGPU renderer; PCF with a filter radius replaces it.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;

    const sun = this.sun;
    sun.name = 'Sun';
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0001;
    sun.shadow.normalBias = 0.02;
    // Filter radius in shadow-map texels: a real sun (0.53° wide) casts a penumbra of about 1 cm
    // per metre between occluder and ground.
    sun.shadow.radius = 2;
    scene.add(sun, sun.target);
  }

  /**
   * Lights the scene with an HDRI: pre-filtered environment for diffuse and specular IBL, the
   * photograph as backdrop, and the sun extracted into the shadow-casting key light. The texture's
   * pixels are modified (the sun is clamped), so load a fresh copy for other uses.
   */
  setEnvironment(hdr: DataTexture, options: EnvironmentOptions = {}): SunEstimate | null {
    const { rotation = 0, intensity = 1, background = true, backgroundBlurriness = 0, sunThreshold = 24 } = options;
    const sun = extractSun(hdr, sunThreshold);
    this.sunEstimate = sun;
    hdr.needsUpdate = true;

    this.envMap?.dispose();
    this.envMap = this.pmrem.fromEquirectangular(hdr).texture;
    const scene = this.scene;
    scene.environment = this.envMap;
    scene.environmentIntensity = intensity;
    scene.environmentRotation.set(0, rotation, 0);
    scene.background = background ? hdr : null;
    scene.backgroundIntensity = intensity;
    scene.backgroundBlurriness = backgroundBlurriness;
    scene.backgroundRotation.set(0, rotation, 0);

    // The environment is sampled at R⁻¹·d for a view direction d, so the sun, at s in the image,
    // shows up at R·s.
    if (sun) {
      this.sunDirection.copy(sun.direction).applyEuler(_euler.set(0, rotation, 0));
      this.sun.color.copy(sun.color);
      this.sun.intensity = sun.illuminance * intensity;
    } else {
      this.sunDirection.set(0, 1, 0);
      this.sun.intensity = 0;
    }
    this.sun.visible = this.sun.castShadow = !!sun;
    this.placeSun();
    return sun;
  }

  /**
   * Fits the sun's shadow map around a region: everything inside `bounds` casts and receives
   * shadows at full resolution (4096 texels across its diameter).
   */
  fitShadow(bounds: Box3 | Sphere): void {
    const sphere = bounds instanceof Sphere ? bounds : bounds.getBoundingSphere(new Sphere());
    this.shadowCenter.copy(sphere.center);
    this.shadowRadius = sphere.radius;
    this.placeSun();
  }

  dispose(): void {
    this.envMap?.dispose();
    this.pmrem.dispose();
    this.sun.shadow.dispose();
    this.sun.removeFromParent();
    this.sun.target.removeFromParent();
  }

  private placeSun(): void {
    const r = this.shadowRadius;
    const sun = this.sun;
    sun.target.position.copy(this.shadowCenter);
    sun.position.copy(this.shadowCenter).addScaledVector(this.sunDirection, r * 2);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = r * 0.5;
    cam.far = r * 3.5;
    cam.updateProjectionMatrix();
  }
}

/**
 * Finds the sun in an equirectangular HDRI, clamps it out of the image in place and returns its
 * direction, colour and illuminance. Returns null (image untouched) for an overcast sky, where
 * nothing stands out above `threshold` × the median sky radiance.
 */
export function extractSun(hdr: DataTexture, threshold = 24): SunEstimate | null {
  const { width: w, height: h } = hdr.image;
  const data = hdr.image.data as Uint16Array | Float32Array;
  const half = data instanceof Uint16Array;
  const read = half ? (i: number) => DataUtils.fromHalfFloat(data[i]) : (i: number) => data[i];
  const write = half ? (i: number, v: number) => (data[i] = DataUtils.toHalfFloat(v)) : (i: number, v: number) => (data[i] = v);
  const channels = data.length / (w * h);

  const lumAt = (i: number) => 0.2126 * read(i) + 0.7152 * read(i + 1) + 0.0722 * read(i + 2);
  // Row 0 is the top of the image (the zenith): three.js uploads HDRIs with flipY. Directions
  // follow three.js's equirect mapping, u = atan2(z, x) / 2π + 0.5, v = asin(y) / π + 0.5.
  const elevationOf = (y: number) => (0.5 - (y + 0.5) / h) * Math.PI;
  const directionOf = (x: number, y: number, out: Vector3) => {
    const elevation = elevationOf(y);
    const azimuth = ((x + 0.5) / w - 0.5) * 2 * Math.PI;
    return out.set(Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.sin(azimuth));
  };

  // The sky's level (median radiance above the horizon) and the brightest pixel.
  const sky: number[] = [];
  const step = Math.max(1, Math.floor(w / 512));
  for (let y = 0; y < h / 2; y += step) {
    for (let x = 0; x < w; x += step) sky.push(lumAt((y * w + x) * channels));
  }
  sky.sort((a, b) => a - b);
  const median = sky[sky.length >> 1] || 1;
  const clampLevel = median * threshold;
  let brightest = 0;
  let peakX = 0;
  let peakY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const lum = lumAt((y * w + x) * channels);
      if (lum > brightest) {
        brightest = lum;
        peakX = x;
        peakY = y;
      }
    }
  }
  if (!(brightest > clampLevel)) return null;

  // Energy above the clamp level within 12° of the brightest pixel (the sun and its aureole, not
  // glints elsewhere in the photograph), weighted by each pixel's solid angle, becomes the light.
  const peakDir = directionOf(peakX, peakY, new Vector3());
  const cone = Math.cos((12 * Math.PI) / 180);
  const rows = Math.ceil((12 / 180) * h) + 1;
  const dPhi = (2 * Math.PI) / w;
  const dTheta = Math.PI / h;
  const e = [0, 0, 0];
  const dir = new Vector3();
  const d = new Vector3();
  let pixels = 0;
  for (let y = Math.max(0, peakY - rows); y < Math.min(h, peakY + rows + 1); y++) {
    const solidAngle = dPhi * dTheta * Math.cos(elevationOf(y));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      const r = read(i);
      const g = read(i + 1);
      const b = read(i + 2);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (!(lum > clampLevel) || directionOf(x, y, d).dot(peakDir) < cone) continue;
      const keep = clampLevel / lum;
      const excess = 1 - keep;
      e[0] += r * excess * solidAngle;
      e[1] += g * excess * solidAngle;
      e[2] += b * excess * solidAngle;
      dir.addScaledVector(d, lum * excess * solidAngle);
      write(i, r * keep);
      write(i + 1, g * keep);
      write(i + 2, b * keep);
      pixels++;
    }
  }
  const peak = Math.max(e[0], e[1], e[2]);
  if (pixels === 0 || peak <= 0 || dir.lengthSq() === 0) return null;
  return {
    direction: dir.normalize(),
    color: new Color().setRGB(e[0] / peak, e[1] / peak, e[2] / peak, LinearSRGBColorSpace),
    illuminance: peak,
    clampLevel,
    pixels,
  };
}
