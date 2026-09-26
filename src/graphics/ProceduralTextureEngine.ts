// Runtime PBR texture generation: 2048² seamless material maps baked on the GPU at startup from
// procedural noise (see noise.ts). No image files: every map is computed.
//
// Each texture set is baked in passes into render targets:
//   fields   height in metres plus masks (half float): the material's structure
//   normal   tangent-space normals from the height field's slopes (OpenGL convention, +Y up)
//   albedo   base colour (sRGB, 8 bits)
//   orm      ambient occlusion, roughness, metalness and a material-specific mask
// Maps are mipmapped with 16× anisotropic filtering and repeat-wrapped; the noise is periodic
// over the tile, so they repeat without seams. A set knows its tile's real-world size, and the
// meshes carry UVs in metres.
//
//   asphalt       bitumen binder with exposed aggregate (two Worley stone layers), fine grain,
//                 cracks, oil stains; the mask is how much water the surface texture holds
//   pavement      broom-finished concrete slabs: brush lines, pits, aggregate specks, gum
//   concrete      architectural concrete: formwork panels, seams, tie holes, bug holes, blotches
//   stucco        sand-float render with trowel marks and hairline cracks (white; tinted later)
//   metal         shared by painted, brushed and galvanised metal: orange-peel normals, and masks
//                 for brush streaks, galvanising spangle, paint chips and grime
//   glass         float-glass waviness, smudges, rain streaks and dust
import {
  abs,
  clamp,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  normalize,
  select,
  smoothstep,
  sqrt,
  step,
  texture,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import {
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  NodeMaterial,
  NoColorSpace,
  QuadMesh,
  RenderTarget,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import { fbm, hash21, worleyTile, type F, type V2, type V3, type V4 } from './noise';

export interface PBRSet {
  name: string;
  /** Real-world size of one tile, metres. */
  tile: number;
  /** Base colour, sRGB. */
  albedo: Texture;
  /** Tangent-space normal (OpenGL convention). */
  normal: Texture;
  /** R ambient occlusion, G roughness, B metalness, A a set-specific mask (see each recipe). */
  orm: Texture;
  /** R height (metres), G/B/A set-specific fields; kept for sets whose materials need them. */
  fields: Texture | null;
}

/** How a set is made: its height and masks, then colour and surface response from those. */
interface Recipe {
  name: string;
  tile: number;
  /** Height in metres (R) and three masks, at a UV in the tile. */
  fields(st: V2): V4;
  /** Base colour (linear) from the fields at this texel. */
  albedo(st: V2, f: V4): V3;
  /** Roughness, metalness and the extra mask (AO is computed from the height field). */
  surface(st: V2, f: V4, cavity: F): V3;
  /** Keep the fields texture for the material. */
  keepFields?: boolean;
  /** Exaggerates the normal map's slopes (1 = physical). */
  normalStrength?: number;
  /** How deep (metres) a texel must sit below its surroundings to count as a full cavity. */
  cavityDepth: number;
}

const quad = new QuadMesh(new NodeMaterial());

export class ProceduralTextureEngine {
  constructor(
    private readonly renderer: WebGPURenderer,
    /** Texture resolution (square), 2048 by default. */
    readonly size = 2048,
  ) {}

  /** Bakes every set used by the city. `onProgress` gets 0..1 and the set's name. */
  async bakeAll(onProgress?: (f: number, name: string) => void | Promise<void>): Promise<Record<SetName, PBRSet>> {
    const out = {} as Record<SetName, PBRSet>;
    const names = Object.keys(RECIPES) as SetName[];
    for (let i = 0; i < names.length; i++) {
      await onProgress?.(i / names.length, names[i]);
      out[names[i]] = this.bake(RECIPES[names[i]]);
    }
    await onProgress?.(1, 'done');
    return out;
  }

  /** Bakes one texture set. */
  bake(recipe: Recipe): PBRSet {
    const size = this.size;
    const st = uv();
    const fieldsRT = this.target(`${recipe.name}.fields`, HalfFloatType, false);
    this.draw(fieldsRT, recipe.fields(st));
    const fieldsTex = fieldsRT.texture;
    const field = (o: V2) => texture(fieldsTex, st.add(o.div(size)));
    const h = (dx: number, dy: number) => field(vec2(dx, dy)).r;

    // Normals from the height field's slopes (Sobel), in physical units: height is in metres and
    // one texel is tile / size metres.
    const texel = recipe.tile / size;
    const gx = h(1, -1).add(h(1, 0).mul(2)).add(h(1, 1)).sub(h(-1, -1)).sub(h(-1, 0).mul(2)).sub(h(-1, 1)).div(8 * texel);
    const gy = h(-1, 1).add(h(0, 1).mul(2)).add(h(1, 1)).sub(h(-1, -1)).sub(h(0, -1).mul(2)).sub(h(1, -1)).div(8 * texel);
    const k = recipe.normalStrength ?? 1;
    const n = normalize(vec3(gx.mul(-k), gy.mul(-k), 1));
    const normalRT = this.target(`${recipe.name}.normal`, UnsignedByteType, false);
    this.draw(normalRT, vec4(n.mul(0.5).add(0.5), 1));

    // Cavity: how far the texel sits below its surroundings (rings at 2, 5 and 11 texels), which
    // drives ambient occlusion and where water and dirt collect.
    const here = h(0, 0);
    let below: F = float(0);
    const rings: [number, number][] = [
      [2, 0.5],
      [5, 0.3],
      [11, 0.2],
    ];
    for (const [r, w] of rings) {
      let ring: F = float(0);
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2 + r;
        ring = ring.add(h(Math.cos(ang) * r, Math.sin(ang) * r));
      }
      below = below.add(max(ring.div(8).sub(here), 0).mul(w));
    }
    const cavity = clamp(below.div(recipe.cavityDepth), 0, 1);

    const f = field(vec2(0, 0));
    const albedoRT = this.target(`${recipe.name}.albedo`, UnsignedByteType, true);
    this.draw(albedoRT, vec4(recipe.albedo(st, f), 1));
    const s = recipe.surface(st, f, cavity);
    const ao = float(1).sub(cavity.mul(0.65));
    const ormRT = this.target(`${recipe.name}.orm`, UnsignedByteType, false);
    this.draw(ormRT, vec4(ao, s.x, s.y, s.z));

    if (!recipe.keepFields) fieldsRT.dispose();
    return {
      name: recipe.name,
      tile: recipe.tile,
      albedo: albedoRT.texture,
      normal: normalRT.texture,
      orm: ormRT.texture,
      fields: recipe.keepFields ? fieldsTex : null,
    };
  }

  private target(name: string, type: typeof HalfFloatType | typeof UnsignedByteType, srgb: boolean): RenderTarget {
    const rt = new RenderTarget(this.size, this.size, { type, depthBuffer: false, generateMipmaps: true });
    const t = rt.texture;
    t.name = name;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = 16;
    t.generateMipmaps = true;
    // An sRGB target stores colour with 8-bit sRGB encoding (rgba8unorm-srgb): the shader writes
    // linear values, the hardware encodes on write and decodes on sampling.
    t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    return rt;
  }

  private draw(target: RenderTarget, node: V4): void {
    const material = new NodeMaterial();
    material.fragmentNode = node;
    quad.material = material;
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    quad.render(this.renderer);
    this.renderer.setRenderTarget(previous);
    material.dispose();
  }
}

// ── Recipes ──────────────────────────────────────────────────────────────────────────────────

const unit = (n: V3) => n.x.mul(0.5).add(0.5);

/** Round stones from Worley cells: (mask, dome height 0..1, stone id) for cells across the tile. */
function stones(st: V2, cells: number, seed: number, fill: number): V3 {
  const w = worleyTile(st, [cells, cells], 0.85, seed);
  const r = float(fill).add(w.z.mul(0.14));
  const d = w.x.div(r);
  const mask = smoothstep(1, 0.8, d);
  const dome = sqrt(max(float(1).sub(d.mul(d)), 0));
  return vec3(mask, dome, w.z);
}

const asphalt: Recipe = {
  name: 'asphalt',
  tile: 4,
  cavityDepth: 0.0025,
  keepFields: true,
  normalStrength: 1.2,
  // R height (m), G stone mask, B crack mask, A stone id.
  fields(st) {
    const coarse = stones(st, 170, 1, 0.34);
    const fine = stones(st, 480, 2, 0.3);
    const binder = fbm(st, { period: [64, 64], octaves: 4, seed: 3 }).x.mul(0.0006).add(fbm(st, { period: [512, 512], octaves: 2, seed: 4 }).x.mul(0.0002));
    // Worn surface: the stones' tops stand proud of the binder, the binder dips between them.
    const top = max(coarse.y.mul(coarse.x).mul(0.0032), fine.y.mul(fine.x).mul(0.0016));
    // Cracks: Worley cell edges on a noise-warped domain (so they wander instead of forming
    // polygons), thin, and only where a low-frequency field allows (most of the road is intact).
    const warp = fbm(st, { period: [8, 8], octaves: 3, seed: 9 });
    const cracks = worleyTile(st.add(vec2(warp.x, warp.y.mul(0.002)).mul(0.035)), [6, 6], 1, 7);
    const sparse = smoothstep(0.62, 0.8, unit(fbm(st, { period: [4, 4], octaves: 3, seed: 8 })));
    const crack = smoothstep(0.018, 0.003, cracks.y.sub(cracks.x)).mul(sparse);
    const height = binder.add(top).sub(crack.mul(0.005));
    const stoneMask = max(coarse.x, fine.x.mul(0.8));
    const id = select(coarse.x.greaterThan(0.5), coarse.z, fine.z);
    return vec4(height, stoneMask, crack, id);
  },
  albedo(st, f) {
    const tone = unit(fbm(st, { period: [6, 6], octaves: 4, seed: 11 }));
    // Oxidised bitumen: dark grey, a little warm.
    const binder = vec3(0.046, 0.045, 0.047).mul(mix(float(0.8), float(1.2), tone));
    // Aggregate: mostly grey granite, some warm and some dark stones.
    const id = f.w;
    const grey = mix(float(0.12), float(0.24), fract(id.mul(7.13)));
    const warm = vec3(1.08, 1.0, 0.9);
    const stone = vec3(grey).mul(mix(vec3(1), warm, step(0.65, id))).mul(mix(float(1), float(0.45), step(0.88, id)));
    // Binder still coats part of each stone.
    let c: V3 = mix(binder, stone, f.y.mul(0.8));
    // Cracks are dark; old oil drips darker still.
    c = c.mul(float(1).sub(f.z.mul(0.5)));
    const oil = smoothstep(0.62, 0.78, unit(fbm(st, { period: [3, 3], octaves: 5, seed: 12 })));
    return c.mul(float(1).sub(oil.mul(0.35)));
  },
  surface(st, f, cavity) {
    // Dry roughness: binder 0.72, aggregate 0.6 (traffic polishes their tops), cracks 0.85.
    const oil = smoothstep(0.62, 0.78, unit(fbm(st, { period: [3, 3], octaves: 5, seed: 12 })));
    const r = mix(float(0.72), float(0.6), f.y).add(f.z.mul(0.13)).sub(oil.mul(0.25));
    // Mask: the water the texture holds when wet (cavities and cracks fill first).
    const water = clamp(cavity.mul(1.4).add(f.z), 0, 1);
    return vec3(r, 0, water);
  },
};

const pavement: Recipe = {
  name: 'pavement',
  tile: 2,
  cavityDepth: 0.0012,
  keepFields: true,
  // R height (m), G gum/stain mask, B pit mask, A speck id.
  fields(st) {
    // Broom finish: fine ridges running along u (the brush was dragged across the slab).
    const broom = fbm(st, { period: [4, 480], octaves: 3, seed: 21 }).x.mul(0.00035);
    const pits = worleyTile(st, [260, 260], 1, 22);
    const pit = smoothstep(0.16, 0.05, pits.x).mul(step(0.55, pits.z));
    const gumCells = worleyTile(st, [22, 22], 1, 23);
    const gum = smoothstep(0.2, 0.15, gumCells.x).mul(step(0.93, gumCells.z));
    const specks = worleyTile(st, [700, 700], 1, 24);
    const undulation = fbm(st, { period: [2, 2], octaves: 3, seed: 25 }).x.mul(0.0015);
    const height = broom.add(undulation).sub(pit.mul(0.0012)).add(gum.mul(0.0006));
    return vec4(height, gum, pit, specks.z);
  },
  albedo(st, f) {
    const blotch = unit(fbm(st, { period: [4, 4], octaves: 5, seed: 26 }));
    const base = vec3(0.31, 0.3, 0.28).mul(mix(float(0.82), float(1.12), blotch));
    const speck = mix(vec3(0.7), vec3(1.35, 1.3, 1.2), step(0.7, f.w)).mul(mix(float(1), float(0.6), step(0.93, f.w)));
    let c: V3 = base.mul(mix(vec3(1), speck, 0.35));
    c = mix(c, vec3(0.08, 0.08, 0.085), f.y.mul(0.9));
    return c.mul(float(1).sub(f.z.mul(0.4)));
  },
  surface(_st, f, cavity) {
    const r = mix(float(0.84), float(0.62), f.y).add(cavity.mul(0.05));
    return vec3(r, 0, clamp(cavity.mul(1.2), 0, 1));
  },
};

const concrete: Recipe = {
  name: 'concrete',
  tile: 2.4,
  cavityDepth: 0.003,
  // R height (m), G seam mask, B tie-hole mask, A panel id. The tile holds two 1.2 × 2.4 m
  // formwork panels side by side; tie holes sit on a 600 mm grid, 300 mm in from the edges.
  fields(st) {
    const panelU = fract(st.x.mul(2));
    const panelId = floor(st.x.mul(2));
    const seamDist = min(min(panelU, float(1).sub(panelU)).mul(1.2), min(st.y, float(1).sub(st.y)).mul(2.4));
    const seam = smoothstep(0.004, 0.0015, seamDist);
    // Tie holes: panel-local metres, holes of 25 mm diameter.
    const px = panelU.mul(1.2);
    const py = st.y.mul(2.4);
    const hx = abs(fract(px.sub(0.3).div(0.6).add(0.5)).sub(0.5)).mul(0.6);
    const hy = abs(fract(py.sub(0.3).div(0.6).add(0.5)).sub(0.5)).mul(0.6);
    const holeR = length(vec2(hx, hy));
    const hole = smoothstep(0.0135, 0.011, holeR);
    const holeDepth = smoothstep(0.0135, 0.0, holeR).mul(0.012);
    const bug = worleyTile(st, [300, 300], 1, 31);
    const bugHole = smoothstep(0.2, 0.06, bug.x).mul(step(0.7, bug.z));
    const surface = fbm(st, { period: [8, 8], octaves: 5, seed: 32 }).x.mul(0.0008);
    const height = surface.add(seam.mul(0.001)).sub(holeDepth).sub(bugHole.mul(0.0015));
    return vec4(height, seam, hole, hash21(vec2(panelId, 3.7)));
  },
  albedo(st, f) {
    const blotch = unit(fbm(st, { period: [6, 12], octaves: 5, seed: 33 }));
    const tone = mix(float(0.86), float(1.1), f.w);
    let c: V3 = vec3(0.4, 0.39, 0.37).mul(tone).mul(mix(float(0.8), float(1.15), blotch));
    // Release-agent and pour lines: faint horizontal bands.
    c = c.mul(float(1).sub(smoothstep(0.35, 0.5, unit(fbm(st, { period: [2, 40], octaves: 3, seed: 34 }))).mul(0.08)));
    c = c.mul(float(1).sub(f.y.mul(0.25)));
    return mix(c, vec3(0.07), f.z.mul(0.85));
  },
  surface(_st, f, cavity) {
    return vec3(mix(float(0.78), float(0.9), f.z).add(cavity.mul(0.05)), 0, f.y);
  },
};

const stucco: Recipe = {
  name: 'stucco',
  tile: 1.6,
  cavityDepth: 0.0006,
  normalStrength: 1.4,
  // R height (m), G crack mask, B trowel swirl, A grain id.
  fields(st) {
    const grains = worleyTile(st, [600, 600], 0.9, 41);
    const grain = smoothstep(0.55, 0.1, grains.x).mul(0.00025);
    // Trowel marks: broad, flowing strokes (rotated-gradient noise gives the swirl).
    const trowel = fbm(st, { period: [6, 6], octaves: 3, seed: 42 }).x;
    const fine = fbm(st, { period: [160, 160], octaves: 3, seed: 43 }).x.mul(0.00018);
    const cracks = worleyTile(st, [3, 3], 1, 44);
    const crack = smoothstep(0.012, 0.002, cracks.y.sub(cracks.x)).mul(smoothstep(0.55, 0.75, unit(fbm(st, { period: [2, 2], octaves: 3, seed: 45 }))));
    const height = grain.add(fine).add(trowel.mul(0.0007)).sub(crack.mul(0.0008));
    return vec4(height, crack, unit(vec3(trowel, 0, 0)), grains.z);
  },
  albedo(st, f) {
    const blotch = unit(fbm(st, { period: [4, 4], octaves: 5, seed: 46 }));
    let c: V3 = vec3(0.82, 0.8, 0.76).mul(mix(float(0.9), float(1.04), blotch));
    c = c.mul(mix(float(0.97), float(1.02), f.w));
    return c.mul(float(1).sub(f.y.mul(0.35)));
  },
  surface(_st, f, cavity) {
    return vec3(float(0.9).sub(f.z.mul(0.08)).add(cavity.mul(0.04)), 0, f.y);
  },
};

const metal: Recipe = {
  name: 'metal',
  tile: 0.6,
  cavityDepth: 0.0002,
  normalStrength: 1,
  // R height (m): orange peel and a few dents. G brush streaks, B galvanising spangle, A chips.
  fields(st) {
    const peel = fbm(st, { period: [48, 48], octaves: 3, seed: 51 }).x.mul(0.00002);
    const dents = worleyTile(st, [3, 3], 1, 52);
    const dent = smoothstep(0.35, 0.0, dents.x).mul(step(0.8, dents.z)).mul(-0.0004);
    const streak = unit(fbm(st, { period: [2, 900], octaves: 3, seed: 53 }));
    const spangle = worleyTile(st, [26, 26], 1, 54).z;
    const chipField = unit(fbm(st, { period: [8, 8], octaves: 6, seed: 55 }));
    const chips = smoothstep(0.7, 0.74, chipField);
    return vec4(peel.add(dent).sub(chips.mul(0.00008)), streak, spangle, chips);
  },
  albedo(st, f) {
    // Bare steel where paint chipped, rust bleeding into the chips.
    const rust = unit(fbm(st, { period: [16, 16], octaves: 4, seed: 56 }));
    const steel = vec3(0.56, 0.57, 0.58);
    const rustC = vec3(0.3, 0.13, 0.05);
    return mix(steel, rustC, smoothstep(0.45, 0.7, rust)).mul(mix(float(0.9), float(1.05), f.y));
  },
  surface(st, f, cavity) {
    const grime = unit(fbm(st, { period: [4, 4], octaves: 4, seed: 57 }));
    // G roughness for bare/brushed metal, B the spangle, A paint chips (the material mixes).
    return vec3(mix(float(0.22), float(0.42), f.y).add(cavity.mul(0.1)).add(grime.mul(0.08)), f.z, f.w);
  },
};

const glass: Recipe = {
  name: 'glass',
  tile: 2,
  cavityDepth: 0.0002,
  normalStrength: 1,
  // R height (m): float-glass waviness. G smudges, B rain streaks, A dust.
  fields(st) {
    const wave = fbm(st, { period: [2, 2], octaves: 3, seed: 61 }).x.mul(0.00012);
    const smudge = smoothstep(0.55, 0.75, unit(fbm(st, { period: [6, 6], octaves: 5, seed: 62 })));
    const streaks = smoothstep(0.62, 0.8, unit(fbm(st, { period: [40, 2], octaves: 4, seed: 63 }))).mul(smoothstep(0.3, 0.9, float(1).sub(st.y)));
    const dust = unit(fbm(st, { period: [64, 64], octaves: 3, seed: 64 }));
    return vec4(wave, smudge, streaks, dust);
  },
  albedo(_st, f) {
    return vec3(0.02, 0.022, 0.025).add(vec3(0.05, 0.048, 0.045).mul(f.y.mul(0.5).add(f.w.mul(0.2))));
  },
  surface(_st, f) {
    return vec3(float(0.02).add(f.y.mul(0.12)).add(f.z.mul(0.08)), 0, f.y.max(f.z));
  },
};

export const RECIPES = { asphalt, pavement, concrete, stucco, metal, glass };
export type SetName = keyof typeof RECIPES;

