// Physically based materials for the showcase, all MeshPhysicalNodeMaterial (three.js's
// MeshPhysicalMaterial for the WebGPU renderer, with the same parameters plus TSL shader nodes):
//
//   wetAsphalt    photo-scanned asphalt after rain: darkened where water soaks in, a water film
//                 (clear coat 1.0, roughness 0.1) that pools into flat, mirror-like puddles in the
//                 low spots of the scan, and real displacement from the scan's height map
//   scanned       any photo-scanned set (concrete, plaster, paving), optionally damp
//   carPaint      metallic paint: tinted base with aluminium flakes under a clear coat (1.0 / 0.1)
//   tintedGlass   thin automotive glass: transmission with a tinted absorption and Fresnel reflections
//
// upgrade() converts the materials of loaded glTF models to MeshPhysicalNodeMaterial, keeping
// every map and factor, and marks glossy surfaces for screen-space reflections (see reflective()).
import {
  float,
  fwidth,
  mix,
  mrt,
  mx_cell_noise_float,
  mx_fractal_noise_float,
  normalLocal,
  normalMap,
  normalViewGeometry,
  positionLocal,
  positionViewDirection,
  positionWorld,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  normalView,
} from 'three/tsl';
import {
  Color,
  DoubleSide,
  FrontSide,
  Material,
  Mesh,
  MeshPhysicalNodeMaterial,
  MeshStandardMaterial,
  type Node,
  type Object3D,
  type Texture,
  type UniformNode,
} from 'three/webgpu';
import type { TextureSet } from './AssetLoader';

export interface ScannedOptions {
  /** Size of one texture tile in metres (the mesh's UVs are in metres). */
  tileSize?: number;
  /** 0 = dry, 1 = soaked: darker, glossier, with a water film (clear coat). */
  wetness?: number;
  /** Fraction of the surface under standing water, 0..1. */
  puddles?: number;
  /** Relief from the height map, metres peak to peak (0 = none). Needs a finely tessellated mesh. */
  displacement?: number;
  /** Normal map strength. */
  normalScale?: number;
  /** Tint multiplied into the albedo. */
  tint?: Color;
  /** Shifts the puddle pattern. */
  seed?: number;
}

export interface CarPaintOptions {
  color?: Color | string | number;
  /** Share of metallic flakes in the base coat, 0..1. */
  metallic?: number;
  /** Roughness of the base coat under the clear coat. */
  baseRoughness?: number;
  /** Flake sparkle strength, 0..1. */
  flakes?: number;
}

export interface GlassOptions {
  /** Colour of the glass seen through a thick edge. */
  tint?: Color | string | number;
  /** Fraction of light passing straight through, 0..1 (car privacy glass ≈ 0.2–0.35). */
  transmittance?: number;
}

/** Wetness controls shared by every wet material, so rain can come and go. */
export interface Weather {
  wetness: UniformNode<'float', number>;
  puddles: UniformNode<'float', number>;
}

/** Fresnel reflectance of a dielectric (F0 = 0.04, i.e. water, glass, lacquer) seen along the view. */
const dielectricFresnel = (normal: Node<'vec3'>) => {
  const f = float(1).sub(normal.dot(positionViewDirection).clamp(0, 1));
  return f.pow(5).mul(0.96).add(0.04);
};

export class MaterialLibrary {
  readonly weather: Weather = { wetness: uniform(1), puddles: uniform(0.35) };
  private readonly cache = new Map<string, Material>();

  /**
   * Asphalt after rain. The scan's height map decides where water pools: low spots fill first, a
   * slow noise field varies the depth across the road, and the puddles' surfaces are flat.
   */
  wetAsphalt(set: TextureSet, options: ScannedOptions = {}): MeshPhysicalNodeMaterial {
    return this.scanned(set, { tileSize: 3, displacement: 0.012, puddles: 1, wetness: 1, ...options }, true);
  }

  /** A photo-scanned surface. `standingWater` enables puddles (roads, flat paving). */
  scanned(set: TextureSet, options: ScannedOptions = {}, standingWater = false): MeshPhysicalNodeMaterial {
    const { tileSize = 2, wetness = 0, puddles = 0, displacement = 0, normalScale = 1, tint, seed = 0 } = options;
    const m = new MeshPhysicalNodeMaterial({ name: `${set.id}${wetness > 0 ? ' (wet)' : ''}` });
    const st = uv().div(tileSize);
    const albedo = texture(set.map, st).rgb.mul(tint ? vec3(tint.r, tint.g, tint.b) : vec3(1));
    const arm = texture(set.arm, st);
    const height = set.displacementMap ? texture(set.displacementMap, st).r : float(0.5);
    const wet = this.weather.wetness.mul(wetness);

    // Standing water: the low parts of the scan, modulated by a slow noise field so it pools in
    // patches (0 = dry ground, 1 = under water).
    let puddle: Node<'float'> = float(0);
    if (standingWater && puddles > 0) {
      const field = mx_fractal_noise_float(vec3(positionWorld.xz.mul(0.16), seed), 3, 2, 0.5).mul(0.5).add(0.5);
      const water = field.mul(0.75).add(height.oneMinus().mul(0.25));
      const level = float(1).sub(this.weather.puddles.mul(puddles).mul(wet.clamp(0, 1)).mul(0.62));
      puddle = smoothstep(level, level.add(0.035), water);
    }

    // Water soaks into porous stone and asphalt: it darkens (light scatters less at the
    // water-filled pores) and looks glossier. Under standing water even more so.
    const darken = mix(float(1), float(0.5), wet.clamp(0, 1)).mul(mix(float(1), float(0.75), puddle));
    m.colorNode = albedo.mul(darken);
    m.roughnessNode = mix(arm.g, arm.g.mul(0.62), wet.clamp(0, 1)).mul(puddle.oneMinus()).add(puddle.mul(0.04));
    m.metalnessNode = float(0);
    m.aoNode = arm.r;
    const bumpy = normalMap(texture(set.normalMap, st), vec2(normalScale)) as unknown as Node<'vec3'>;
    // A water surface is flat: in puddles the relief disappears.
    const surfaceNormal: Node<'vec3'> = standingWater ? mix(bumpy, normalViewGeometry, puddle).normalize() : bumpy;
    m.normalNode = surfaceNormal;

    if (wetness > 0) {
      // The water film is the clear coat: full strength (1.0, roughness 0.1) where wet. On damp
      // ground it follows the relief of the scan; in puddles it is a flat mirror.
      const coat: Node<'float'> = wet.clamp(0, 1);
      m.clearcoatNode = coat;
      m.clearcoatRoughnessNode = float(0.1);
      m.clearcoatNormalNode = surfaceNormal;
      reflective(m, dielectricFresnel(normalView).mul(coat), float(0.1));
    }

    if (displacement > 0 && set.displacementMap) {
      // Real relief from the height map; puddles fill up to a flat water line.
      const h: Node<'float'> = texture(set.displacementMap, st).r;
      const surface: Node<'float'> = standingWater ? h.max(puddle.mul(0.55)) : h;
      const offset: Node<'float'> = surface.sub(0.5).mul(displacement);
      m.positionNode = positionLocal.add((normalLocal as Node<'vec3'>).mul(offset));
    }
    return m;
  }

  /** Metallic car paint under a clear coat (clear coat 1.0, roughness 0.1). */
  carPaint(options: CarPaintOptions = {}): MeshPhysicalNodeMaterial {
    const { color = '#8a0f14', metallic = 0.6, baseRoughness = 0.38, flakes = 0.6 } = options;
    const m = new MeshPhysicalNodeMaterial({
      name: 'Car paint',
      color: new Color(color),
      metalness: metallic,
      roughness: baseRoughness,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
    });
    if (flakes > 0) {
      // Aluminium flakes, about 0.4 mm across: each is a tiny mirror at its own angle, so some
      // catch the light and sparkle. Per-flake roughness and metalness give that effect without
      // perturbing the normals (which the reflections and AO read).
      const flakeSpace = positionLocal.mul(2500);
      const cell = mx_cell_noise_float(flakeSpace);
      // Flakes smaller than a pixel average out to an even metallic sheen (no aliasing grain):
      // fade the per-flake variation as the pixel footprint grows past one flake.
      const footprint = fwidth(flakeSpace).length();
      const sparkle = cell.mul(cell).mul(flakes).mul(float(1).sub(smoothstep(0.3, 1.5, footprint)));
      m.roughnessNode = float(baseRoughness).mul(float(1).sub(sparkle.mul(0.75)));
      m.metalnessNode = float(metallic).add(sparkle.mul(float(1).sub(metallic)));
    }
    reflective(m, dielectricFresnel(normalView), float(0.1));
    return m;
  }

  /** Automotive glass: thin, slightly tinted, reflective. */
  tintedGlass(options: GlassOptions = {}): MeshPhysicalNodeMaterial {
    const { tint = '#1d2a2e', transmittance = 0.3 } = options;
    const m = new MeshPhysicalNodeMaterial({
      name: 'Tinted glass',
      color: new Color(tint).lerp(new Color(1, 1, 1), 0.5),
      metalness: 0,
      roughness: 0.02,
      ior: 1.52,
      transmission: 1,
      thickness: 0.005,
      attenuationColor: new Color(tint),
      // Beer–Lambert: light through 5 mm of glass keeps `transmittance` of its energy.
      attenuationDistance: 0.005 / Math.max(1e-3, -Math.log(Math.max(1e-3, transmittance))),
      side: FrontSide,
    });
    reflective(m, dielectricFresnel(normalView), float(0.02));
    return m;
  }

  /**
   * Window glass on building facades: opaque (the walls are single planes with no rooms behind),
   * dark and glossy, so it shows reflections of the street and sky the way real windows do in
   * daylight.
   */
  windowGlass(): MeshPhysicalNodeMaterial {
    const m = new MeshPhysicalNodeMaterial({
      name: 'Window glass',
      color: new Color(0.02, 0.025, 0.03),
      metalness: 0,
      roughness: 0.04,
      ior: 1.52,
      specularIntensity: 1,
    });
    reflective(m, dielectricFresnel(normalView).mul(0.8).add(0.12), float(0.04));
    return m;
  }

  /**
   * Converts every material under `root` to MeshPhysicalNodeMaterial (keeping maps and factors)
   * and turns on shadows. `replace` swaps named materials for library ones, e.g. car paint.
   */
  upgrade(root: Object3D, replace: (material: Material, mesh: Mesh) => Material | null = () => null): void {
    root.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      const convert = (mat: Material): Material => {
        const swapped = replace(mat, obj);
        if (swapped) return swapped;
        let out = this.cache.get(mat.uuid);
        if (!out) {
          out = toPhysical(mat);
          this.cache.set(mat.uuid, out);
        }
        return out;
      };
      obj.material = Array.isArray(obj.material) ? obj.material.map(convert) : convert(obj.material);
    });
  }
}

/**
 * Marks a material as reflective for the screen-space reflection pass: `weight` is the share of
 * light it reflects (0 = none), `roughness` how blurry the reflection is. Written into the
 * pre-pass's `reflect` target (see PostProcessing).
 */
export function reflective(material: MeshPhysicalNodeMaterial, weight: Node<'float'>, roughness: Node<'float'>): void {
  material.mrtNode = mrt({ reflect: vec2(weight, roughness) });
}

const TEXTURE_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
  'bumpMap',
  'displacementMap',
  'lightMap',
  'clearcoatMap',
  'clearcoatRoughnessMap',
  'clearcoatNormalMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'specularIntensityMap',
  'specularColorMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'anisotropyMap',
] as const;

const VALUE_KEYS = [
  'name',
  'color',
  'roughness',
  'metalness',
  'emissive',
  'emissiveIntensity',
  'normalMapType',
  'normalScale',
  'aoMapIntensity',
  'bumpScale',
  'displacementScale',
  'displacementBias',
  'envMapIntensity',
  'flatShading',
  'transparent',
  'opacity',
  'alphaTest',
  'alphaToCoverage',
  'side',
  'depthWrite',
  'vertexColors',
  'clearcoat',
  'clearcoatRoughness',
  'clearcoatNormalScale',
  'ior',
  'reflectivity',
  'iridescence',
  'iridescenceIOR',
  'iridescenceThicknessRange',
  'sheen',
  'sheenColor',
  'sheenRoughness',
  'transmission',
  'thickness',
  'attenuationDistance',
  'attenuationColor',
  'specularIntensity',
  'specularColor',
  'dispersion',
  'anisotropy',
  'anisotropyRotation',
] as const;

/** A MeshPhysicalNodeMaterial with the same maps and parameters as a glTF (standard/physical) material. */
export function toPhysical(source: Material): Material {
  if (source instanceof MeshPhysicalNodeMaterial) return source;
  if (!(source instanceof MeshStandardMaterial)) return source;
  const m = new MeshPhysicalNodeMaterial();
  const src = source as unknown as Record<string, unknown>;
  const dst = m as unknown as Record<string, unknown>;
  for (const key of VALUE_KEYS) {
    if (!(key in src)) continue;
    const v = src[key];
    const cur = dst[key] as { copy?: (x: unknown) => unknown } | undefined;
    if (v && typeof v === 'object' && cur && typeof cur.copy === 'function') cur.copy(v);
    else if (Array.isArray(v)) dst[key] = [...v];
    else dst[key] = v;
  }
  for (const key of TEXTURE_KEYS) {
    const t = src[key] as Texture | null | undefined;
    if (t) dst[key] = t;
  }
  // Foliage cards and other cut-outs are seen from both sides.
  if (source.alphaTest > 0 || source.side === DoubleSide) m.side = DoubleSide;
  m.userData = { ...source.userData };
  return m;
}
