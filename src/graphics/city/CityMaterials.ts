// The procedural city's material palette. Every surface is a MeshPhysicalNodeMaterial whose maps
// are generated at runtime by the ProceduralTextureEngine; geometry supplies UVs in metres (see
// geometry.ts), and each material knows the real-world size of its texture tile.
//
// Until the textures are baked (or with ?textures=0) the same palette is available untextured
// (flat colours with plausible roughness), so geometry can be developed on its own.
import { float, mix, normalMap, normalView, positionWorld, smoothstep, texture, uv, vec2, vec3 } from 'three/tsl';
import { Color, MeshPhysicalNodeMaterial, type Node } from 'three/webgpu';
import { fresnel, markReflective } from '../PostProcessing';
import type { PBRSet, SetName } from '../ProceduralTextureEngine';

export type ColorLike = Color | string | number;

/** Radiance of a white (albedo 1) surface facing the 4.5-unit sun: the unit of emissive strength. */
export const WHITE_IN_SUN = 4.5 / Math.PI;

export interface CityMaterials {
  /** Wet asphalt for the road; road markings and puddles are part of the road's own material. */
  asphalt: MeshPhysicalNodeMaterial;
  /** Pavement slabs and kerb stones. */
  pavement: MeshPhysicalNodeMaterial;
  /** Cast concrete: barriers, plinths, bases, foundations. */
  concrete: MeshPhysicalNodeMaterial;
  /** Architectural concrete for facades (formwork panels, tie holes). */
  facadeConcrete: MeshPhysicalNodeMaterial;
  /** Painted render (stucco), tinted per building: e.g. '#e8dcc8', or a muted Miami pastel. */
  stucco(tint: ColorLike): MeshPhysicalNodeMaterial;
  /** Window glass: dark, reflective, slightly wavy. */
  glass: MeshPhysicalNodeMaterial;
  /** Painted or powder-coated steel: lamp posts, signal poles, railings, frames. */
  paintedMetal(color: ColorLike, roughness?: number): MeshPhysicalNodeMaterial;
  /** Brushed stainless steel / aluminium: window frames, fittings, HVAC casings. */
  brushedMetal: MeshPhysicalNodeMaterial;
  /** Hot-dip galvanised steel: poles, conduit, barriers' fittings. */
  galvanised: MeshPhysicalNodeMaterial;
  /** Black rubber and plastics. */
  rubber: MeshPhysicalNodeMaterial;
  /**
   * A light-emitting surface (lamp and signal lenses, lit windows). `strength` is in multiples of
   * a white surface in full sun, so 1 ≈ as bright as sunlit paper, 20+ glows and blooms.
   */
  emissive(color: ColorLike, strength: number): MeshPhysicalNodeMaterial;
}

/** The palette without textures: flat colours, correct roughness and metalness. */
export function flatCityMaterials(): CityMaterials {
  const cache = new Map<string, MeshPhysicalNodeMaterial>();
  const cached = (key: string, make: () => MeshPhysicalNodeMaterial) => {
    let m = cache.get(key);
    if (!m) cache.set(key, (m = make()));
    return m;
  };
  const physical = (name: string, color: ColorLike, roughness: number, metalness = 0) =>
    new MeshPhysicalNodeMaterial({ name, color: new Color(color), roughness, metalness });
  return {
    asphalt: physical('Asphalt', '#2c2c2e', 0.7),
    pavement: physical('Pavement', '#9d9a94', 0.8),
    concrete: physical('Concrete', '#a8a49c', 0.85),
    facadeConcrete: physical('Facade concrete', '#b3aea5', 0.8),
    stucco: (tint) => cached(`stucco:${new Color(tint).getHexString()}`, () => physical('Stucco', tint, 0.9)),
    glass: new MeshPhysicalNodeMaterial({ name: 'Glass', color: new Color(0.02, 0.025, 0.03), roughness: 0.03, metalness: 0, ior: 1.52 }),
    paintedMetal: (color, roughness = 0.4) => cached(`paint:${new Color(color).getHexString()}:${roughness}`, () => physical('Painted metal', color, roughness, 0.2)),
    brushedMetal: physical('Brushed metal', '#b8b8b6', 0.3, 1),
    galvanised: physical('Galvanised steel', '#9fa3a3', 0.45, 1),
    rubber: physical('Rubber', '#141414', 0.85),
    emissive: (color, strength) =>
      cached(`emissive:${new Color(color).getHexString()}:${strength}`, () => {
        const m = physical('Emissive', '#050505', 0.3);
        m.emissive = new Color(color);
        m.emissiveIntensity = strength * WHITE_IN_SUN;
        return m;
      }),
  };
}

/**
 * The palette with procedural textures (see ProceduralTextureEngine): every material samples its
 * set at the set's real-world tile size, using the geometry's metre UVs.
 */
export function texturedCityMaterials(sets: Record<SetName, PBRSet>): CityMaterials {
  const cache = new Map<string, MeshPhysicalNodeMaterial>();
  const cached = (key: string, make: () => MeshPhysicalNodeMaterial) => {
    let m = cache.get(key);
    if (!m) cache.set(key, (m = make()));
    return m;
  };
  /** Samples a set at `tile` metres per repeat: albedo, orm, fields and the normal-mapped normal. */
  const sample = (set: PBRSet, tile = set.tile, normalScale = 1) => {
    const st = uv().div(tile);
    return {
      albedo: texture(set.albedo, st).rgb,
      orm: texture(set.orm, st),
      normal: normalMap(texture(set.normal, st), vec2(normalScale)) as unknown as Node<'vec3'>,
    };
  };
  /** Dirt splashed up from the pavement: darker towards the ground, fading out by ~1.2 m. */
  const groundGrime = (): Node<'float'> => mix(float(0.7), float(1), smoothstep(0.15, 1.3, positionWorld.y));

  const surface = (name: string, set: PBRSet, tile: number, tint: Color, roughnessBias = 0, grime = false) => {
    const m = new MeshPhysicalNodeMaterial({ name });
    const s = sample(set, tile);
    const c = s.albedo.mul(vec3(tint.r, tint.g, tint.b));
    m.colorNode = grime ? c.mul(groundGrime()) : c;
    m.roughnessNode = s.orm.g.add(roughnessBias).clamp(0.04, 1);
    m.metalnessNode = float(0);
    m.aoNode = s.orm.r;
    m.normalNode = s.normal;
    return m;
  };

  const metalSet = sets.metal;
  const metal = (name: string, make: (orm: Node<'vec4'>, albedo: Node<'vec3'>) => { color: Node<'vec3'>; rough: Node<'float'>; metal: Node<'float'> }) => {
    const m = new MeshPhysicalNodeMaterial({ name });
    const s = sample(metalSet);
    const r = make(s.orm, s.albedo);
    m.colorNode = r.color;
    m.roughnessNode = r.rough;
    m.metalnessNode = r.metal;
    m.aoNode = s.orm.r;
    m.normalNode = s.normal;
    return m;
  };

  const glass = new MeshPhysicalNodeMaterial({ name: 'Glass', ior: 1.52 });
  {
    const s = sample(sets.glass);
    glass.colorNode = s.albedo;
    glass.roughnessNode = s.orm.g;
    glass.metalnessNode = float(0);
    glass.normalNode = s.normal;
    markReflective(glass, fresnel(normalView, 0.04).mul(float(1).sub(s.orm.a.mul(0.4))), s.orm.g);
  }

  return {
    asphalt: surface('Asphalt', sets.asphalt, sets.asphalt.tile, new Color(1, 1, 1)),
    pavement: surface('Pavement', sets.pavement, sets.pavement.tile, new Color(1, 1, 1)),
    concrete: surface('Concrete', sets.concrete, 1.2, new Color(1.05, 1.04, 1.02), 0, true),
    facadeConcrete: surface('Facade concrete', sets.concrete, sets.concrete.tile, new Color(1, 1, 1), 0, true),
    stucco: (tint) => {
      const c = new Color(tint);
      return cached(`stucco:${c.getHexString()}`, () => surface('Stucco', sets.stucco, sets.stucco.tile, c, 0, true));
    },
    glass,
    paintedMetal: (color, roughness = 0.4) => {
      const c = new Color(color);
      return cached(`paint:${c.getHexString()}:${roughness}`, () =>
        metal('Painted metal', (orm, bare) => {
          // Paint over steel: chips (orm.a) show bare, rusting steel; the paint has an orange-peel
          // sheen and a little grime.
          const chips = orm.a;
          return {
            color: mix(vec3(c.r, c.g, c.b), bare, chips),
            rough: mix(float(roughness).add(orm.g.sub(0.3).mul(0.25)), orm.g.add(0.25), chips).clamp(0.05, 1),
            metal: chips.mul(0.6),
          };
        }),
      );
    },
    brushedMetal: metal('Brushed metal', (orm) => ({ color: vec3(0.62, 0.62, 0.6), rough: orm.g, metal: float(1) })),
    galvanised: metal('Galvanised steel', (orm) => {
      // Hot-dip galvanising: zinc spangle crystals (orm.b), each its own tone and sheen.
      const spangle = orm.b;
      return { color: vec3(0.55, 0.57, 0.58).mul(spangle.mul(0.18).add(0.9)), rough: spangle.mul(0.22).add(0.28), metal: float(1) };
    }),
    rubber: metal('Rubber', (orm) => ({ color: vec3(0.022, 0.022, 0.024), rough: orm.g.mul(0.3).add(0.72), metal: float(0) })),
    emissive: (color, strength) =>
      cached(`emissive:${new Color(color).getHexString()}:${strength}`, () => {
        const m = new MeshPhysicalNodeMaterial({ name: 'Emissive', color: new Color('#050505'), roughness: 0.25 });
        m.emissive = new Color(color);
        m.emissiveIntensity = strength * WHITE_IN_SUN;
        return m;
      }),
  };
}
