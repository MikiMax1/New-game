// Procedural daylight: an atmospheric sky, the sun, and image-based light baked from them at
// startup. No HDRI files: the environment is rendered from the sky itself.
//
//   sky        three.js SkyMesh (THREE.Sky for the WebGPU renderer): Preetham's analytic
//              daylight model, with Rayleigh and Mie scattering, turbidity (haze) and
//              procedural clouds
//   sun        a DirectionalLight along the sky's sun direction, golden-hour colour, 4096² soft
//              shadows (PCF; the WebGPU renderer dropped PCFSoftShadowMap, PCF with a filter
//              radius replaces it)
//   IBL        the sky rendered into a float cube map (CubeCamera), pre-filtered by the
//              PMREMGenerator into scene.environment: diffuse sky light and glossy reflections
//   probe      optionally, a second cube capture from street level once the city is built, so
//              reflections and ambient light include the buildings (a baked reflection probe)
//   haze       aerial perspective: distance fog tinted like the sky behind it, brightest towards
//              the sun
import {
  cameraPosition,
  exp,
  float,
  fog,
  max,
  min,
  mix,
  normalize,
  output,
  positionWorld,
  pow,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import {
  Box3,
  Color,
  CubeCamera,
  CubeRenderTarget,
  DirectionalLight,
  FloatType,
  HalfFloatType,
  Mesh,
  PCFShadowMap,
  PMREMGenerator,
  Scene,
  Sphere,
  Vector3,
  type Material,
  type Node,
  type NodeMaterial,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';

export interface SunPosition {
  /** Degrees above the horizon. */
  elevation: number;
  /** Degrees clockwise from +x seen from above (0 = sun towards +x, 90 = towards +z). */
  azimuth: number;
}

export interface AtmosphereOptions {
  /** Haze: 2 = crisp mountain air, 6–10 = humid coast, hazier golden hours. */
  turbidity?: number;
  /** Rayleigh (blue-sky) scattering strength. */
  rayleigh?: number;
  /** Aerosol (Mie) scattering: the glow around the sun. */
  mieCoefficient?: number;
  mieDirectionalG?: number;
  /** Cloud cover 0..1. */
  clouds?: number;
}

/** Warm golden-hour sunlight: about 3,400 K after the long path through the air. */
export const GOLDEN_HOUR_SUN = new Color(1.0, 0.74, 0.5);

export class ProceduralLighting {
  readonly sky = new SkyMesh();
  readonly sun = new DirectionalLight(GOLDEN_HOUR_SUN, 4.5);
  /** Unit vector towards the sun. */
  readonly sunDirection = new Vector3();
  /**
   * Scale from the Preetham model's output to scene radiance. The model is tuned for exposure
   * ≈ 0.5; this puts the sky in the same units as the 4.5-unit sun (a clear sky at golden hour
   * gives roughly a quarter of the sun's illuminance on the ground), so exposure 1.2 is right.
   */
  readonly skyScale = uniform(0.3);
  /** Distance-haze density per metre (0 = none). */
  readonly hazeDensity = uniform(0.0011);
  /** Colour (linear RGB radiance) of the haze away from the sun. */
  readonly hazeColor = uniform(new Vector3(0.2, 0.23, 0.28));
  /** Colour (linear RGB radiance) of the haze towards the sun. */
  readonly hazeSunColor = uniform(new Vector3(0.45, 0.3, 0.18));
  private readonly sunUniform = uniform(new Vector3(0, 1, 0));
  private readonly pmrem: PMREMGenerator;
  private envMap: Texture | null = null;
  private readonly floatCube: boolean;
  private readonly shadowSphere = new Sphere(new Vector3(), 40);

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly scene: Scene,
    sun: SunPosition = { elevation: 12, azimuth: 188 },
    atmosphere: AtmosphereOptions = {},
  ) {
    this.pmrem = new PMREMGenerator(renderer);
    const backend = renderer.backend as { isWebGPUBackend?: boolean; device?: { features?: { has(f: string): boolean } } };
    // 32-bit float capture where float textures can be filtered, half float otherwise.
    this.floatCube = backend.isWebGPUBackend === true && backend.device?.features?.has('float32-filterable') === true;

    const sky = this.sky;
    sky.name = 'Sky';
    sky.scale.setScalar(4000);
    sky.turbidity.value = atmosphere.turbidity ?? 3.2;
    sky.rayleigh.value = atmosphere.rayleigh ?? 1.4;
    sky.mieCoefficient.value = atmosphere.mieCoefficient ?? 0.002;
    sky.mieDirectionalG.value = atmosphere.mieDirectionalG ?? 0.92;
    const skyMaterial = sky.material as NodeMaterial;
    skyMaterial.colorNode = (skyMaterial.colorNode as Node<'vec4'>).mul(vec4(this.skyScale, this.skyScale, this.skyScale, 1));
    sky.cloudCoverage.value = atmosphere.clouds ?? 0.32;
    sky.cloudDensity.value = 0.5;
    sky.cloudElevation.value = 0.45;
    scene.add(sky);

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    const light = this.sun;
    light.name = 'Sun';
    light.castShadow = true;
    light.shadow.mapSize.set(4096, 4096);
    light.shadow.bias = -0.0001;
    light.shadow.normalBias = 0.02;
    // PCF filter radius in texels: soft-edged, like the sun's 0.53° disc through hazy air.
    light.shadow.radius = 3;
    scene.add(light, light.target);

    this.setSun(sun);
  }

  /** Moves the sun (and the sky's sun, clouds' lighting and the haze glow with it). */
  setSun({ elevation, azimuth }: SunPosition): void {
    const el = (elevation * Math.PI) / 180;
    const az = (azimuth * Math.PI) / 180;
    this.sunDirection.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    this.sky.sunPosition.value.copy(this.sunDirection);
    this.sunUniform.value.copy(this.sunDirection);
    this.placeShadow();
  }

  /**
   * Fits the sun's 4096² shadow map around a region (everything in it casts and receives
   * shadows at full resolution).
   */
  fitShadow(bounds: Box3 | Sphere): void {
    this.shadowSphere.copy(bounds instanceof Sphere ? bounds : bounds.getBoundingSphere(new Sphere()));
    this.placeShadow();
  }

  /**
   * Bakes image-based light from the sky alone: the sky (sun disc hidden; the DirectionalLight
   * is the sun) rendered into a float cube map and pre-filtered into scene.environment.
   */
  bakeSky(): Texture {
    const envScene = new Scene();
    const showDisc = this.sky.showSunDisc.value;
    this.sky.showSunDisc.value = 0;
    envScene.add(this.sky);
    const env = this.capture(envScene, new Vector3(0, 0, 0), 256, 1, 10000);
    this.scene.add(this.sky);
    this.sky.showSunDisc.value = showDisc;
    return env;
  }

  /**
   * Bakes a reflection probe of the whole scene from `position` (street level): reflections and
   * ambient light then include the buildings, the street and the sunlit facades, not just the
   * sky. Call after the city is built (and after bakeSky(), which lights the capture).
   */
  bakeProbe(position: Vector3, resolution = 256): Texture {
    const showDisc = this.sky.showSunDisc.value;
    this.sky.showSunDisc.value = 0;
    const env = this.capture(this.scene, position, resolution, 0.1, 5000);
    this.sky.showSunDisc.value = showDisc;
    return env;
  }

  /**
   * Aerial perspective for scene.fogNode: exponential distance haze, lit by the sky and glowing
   * warm towards the sun, fading with height (the air thins above the street canyon).
   */
  fogNode(): Node<'vec4'> {
    const toSurface = positionWorld.sub(cameraPosition);
    const distance = toSurface.length();
    const view = normalize(toSurface);
    const sunward = pow(max(view.dot(this.sunUniform), 0), 6);
    const color = mix(this.hazeColor, this.hazeSunColor, sunward);
    // Density falls off with height (scale height 400 m); the view ray's average density.
    const heightFactor = exp(max(positionWorld.y, 0).mul(-1 / 400));
    const factor = float(1).sub(exp(distance.mul(this.hazeDensity).mul(heightFactor).negate()));
    return fog(color, factor) as unknown as Node<'vec4'>;
  }

  dispose(): void {
    this.envMap?.dispose();
    this.pmrem.dispose();
    this.sun.shadow.dispose();
  }

  private placeShadow(): void {
    const { center, radius } = this.shadowSphere;
    const light = this.sun;
    light.target.position.copy(center);
    light.position.copy(center).addScaledVector(this.sunDirection, radius * 2);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
    const cam = light.shadow.camera;
    cam.left = cam.bottom = -radius;
    cam.right = cam.top = radius;
    cam.near = radius * 0.2;
    cam.far = radius * 4;
    cam.updateProjectionMatrix();
  }

  private capture(scene: Scene, position: Vector3, resolution: number, near: number, far: number): Texture {
    const target = new CubeRenderTarget(resolution, { type: this.floatCube ? FloatType : HalfFloatType, generateMipmaps: false });
    const camera = new CubeCamera(near, far, target);
    camera.position.copy(position);
    // Capture with copies of the materials that clamp radiance (the pre-filter works in half
    // float: the sun's mirror highlight on wet asphalt, ~10⁵, would overflow and smear across
    // every blurred level) and drop their extra MRT outputs (reflectivity for SSR), which have
    // nowhere to go outside the post-processing passes.
    const swapped = swapCaptureMaterials(scene);
    camera.update(this.renderer, scene);
    for (const [mesh, material] of swapped) mesh.material = material;
    this.envMap?.dispose();
    this.envMap = this.pmrem.fromCubemap(target.texture).texture;
    target.dispose();
    this.scene.environment = this.envMap;
    return this.envMap;
  }
}

const captureCopies = new WeakMap<Material, Material>();
/** Brightest radiance a capture keeps: far above any sky or sunlit surface, safe in half float. */
const CAPTURE_MAX = 64;

/**
 * Swaps every mesh's material for a capture copy (radiance clamped, no `mrtNode`), reusing copies
 * between captures, and returns the originals to put back.
 */
function swapCaptureMaterials(scene: Scene): [Mesh, Material | Material[]][] {
  const swapped: [Mesh, Material | Material[]][] = [];
  const copy = (m: Material): Material => {
    if (!(m as NodeMaterial).isNodeMaterial) return m;
    let c = captureCopies.get(m);
    if (!c) {
      const n = m.clone() as NodeMaterial;
      n.mrtNode = null;
      n.outputNode = vec4(min(output.rgb, vec3(CAPTURE_MAX)), output.a);
      captureCopies.set(m, (c = n));
    }
    return c;
  };
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const original = o.material;
    const replaced = Array.isArray(original) ? original.map(copy) : copy(original);
    if (replaced !== original) {
      swapped.push([o, original]);
      o.material = replaced;
    }
  });
  return swapped;
}
