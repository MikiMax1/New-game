// Loads the showcase's photographic assets from content/ (downloaded by `npm run assets`, see
// tools/assets/fetch.mjs):
//
//   models    glTF 2.0 (.glb/.gltf) with Draco or meshopt geometry and KTX2 (Basis) textures
//   textures  2K photo-scanned PBR sets: albedo, OpenGL normal, packed AO/roughness/metalness
//             and height; .jpg/.png/.webp through the browser's decoder, .ktx2 through Basis
//   HDRIs     Radiance .hdr environment maps, as half-float equirectangular textures
//
// Every request is cached, so an asset asked for twice downloads once. model() returns a new
// copy of the scene graph each time; the copies share geometry, materials and textures.
import {
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearSRGBColorSpace,
  LoadingManager,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type DataTexture,
  type Group,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

/** content/index.json, written by the fetch script: asset id → path(s) relative to content/. */
export interface AssetIndex {
  hdris: Record<string, string>;
  textures: Record<string, Partial<Record<TextureMapName, string>>>;
  models: Record<string, string>;
}

/** The maps of a texture set, named as the fetch script names the files. */
export type TextureMapName = 'diff' | 'nor_gl' | 'arm' | 'disp';

/** A photo-scanned PBR texture set. Tiling is left to the material (see MaterialLibrary). */
export interface TextureSet {
  id: string;
  /** Albedo (base colour), sRGB. */
  map: Texture;
  /** Tangent-space normals, OpenGL convention (green = up). */
  normalMap: Texture;
  /** Ambient occlusion (R), roughness (G) and metalness (B), packed as glTF packs them. */
  arm: Texture;
  /** Height, black = low. */
  displacementMap: Texture | null;
}

/** The assets haven't been downloaded yet (content/index.json is missing). */
export class MissingAssetsError extends Error {
  constructor() {
    super('The photographic assets are not downloaded yet. Run `npm run assets` (about 370 MB to download, 134 MB on disk), then reload.');
    this.name = 'MissingAssetsError';
  }
}

export type ProgressCallback = (fraction: number, url: string) => void;

export class AssetLoader {
  readonly manager = new LoadingManager();
  private readonly gltfLoader: GLTFLoader;
  private readonly dracoLoader: DRACOLoader;
  private readonly ktx2Loader: KTX2Loader;
  private readonly textureLoader: TextureLoader;
  private readonly hdrLoader: HDRLoader;
  private readonly cache = new Map<string, Promise<unknown>>();
  private readonly anisotropy: number;

  private constructor(
    renderer: WebGPURenderer,
    /** URL of the content/ folder, ending in a slash. */
    readonly base: string,
    readonly index: AssetIndex,
  ) {
    this.anisotropy = Math.min(16, renderer.getMaxAnisotropy());
    this.dracoLoader = new DRACOLoader(this.manager).setDecoderPath(base + 'decoders/draco/');
    this.ktx2Loader = new KTX2Loader(this.manager).setTranscoderPath(base + 'decoders/basis/');
    this.ktx2Loader.detectSupport(renderer);
    this.gltfLoader = new GLTFLoader(this.manager)
      .setDRACOLoader(this.dracoLoader)
      .setKTX2Loader(this.ktx2Loader)
      .setMeshoptDecoder(MeshoptDecoder);
    this.textureLoader = new TextureLoader(this.manager);
    this.hdrLoader = new HDRLoader(this.manager).setDataType(HalfFloatType);
  }

  /**
   * Reads content/index.json and sets up the loaders. The renderer must be initialised (KTX2
   * picks a GPU texture format from its features). Throws MissingAssetsError when the assets
   * haven't been downloaded.
   */
  static async create(renderer: WebGPURenderer, base = 'content/'): Promise<AssetLoader> {
    const url = new URL(base, document.baseURI).href;
    const res = await fetch(url + 'index.json').catch(() => null);
    if (!res?.ok) throw new MissingAssetsError();
    const index = (await res.json()) as AssetIndex;
    return new AssetLoader(renderer, url, index);
  }

  /** Reports overall progress (0..1) of everything requested so far. */
  onProgress(callback: ProgressCallback): void {
    this.manager.onProgress = (url, loaded, total) => callback(total ? loaded / total : 1, url);
  }

  has(kind: keyof AssetIndex, id: string): boolean {
    return id in this.index[kind];
  }

  /** The parsed glTF (scene, animations, cameras, material variants), loaded once. */
  gltf(id: string): Promise<GLTF> {
    const path = this.index.models[id];
    if (!path) return Promise.reject(new Error(`unknown model "${id}"`));
    return this.cached(`model:${id}`, () => this.gltfLoader.loadAsync(this.base + path));
  }

  /** A new copy of a model's scene, sharing geometry, materials and textures with the others. */
  async model(id: string): Promise<Group> {
    const gltf = await this.gltf(id);
    const copy = gltf.scene.clone(true);
    copy.name = id;
    return copy;
  }

  /** A photo-scanned PBR texture set, with repeat wrapping, mipmaps and anisotropic filtering. */
  textureSet(id: string): Promise<TextureSet> {
    const maps = this.index.textures[id];
    if (!maps?.diff || !maps.nor_gl || !maps.arm) return Promise.reject(new Error(`unknown or incomplete texture set "${id}"`));
    return this.cached(`textures:${id}`, async () => {
      const [map, normalMap, arm, displacementMap] = await Promise.all([
        this.texture(maps.diff!, true),
        this.texture(maps.nor_gl!, false),
        this.texture(maps.arm!, false),
        maps.disp ? this.texture(maps.disp, false) : Promise.resolve(null),
      ]);
      return { id, map, normalMap, arm, displacementMap };
    });
  }

  /** A single tiling texture; `srgb` for colour data, linear otherwise. */
  texture(path: string, srgb: boolean): Promise<Texture> {
    return this.cached(`texture:${path}`, async () => {
      const url = this.base + path;
      const tex = path.endsWith('.ktx2') ? await this.ktx2Loader.loadAsync(url) : await this.textureLoader.loadAsync(url);
      tex.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
      tex.wrapS = tex.wrapT = RepeatWrapping;
      tex.anisotropy = this.anisotropy;
      tex.name = path;
      return tex;
    });
  }

  /** An HDR environment map as a half-float equirectangular texture, with its pixels kept on the CPU. */
  hdri(id: string): Promise<DataTexture> {
    const path = this.index.hdris[id];
    if (!path) return Promise.reject(new Error(`unknown HDRI "${id}"`));
    return this.cached(`hdri:${id}`, async () => {
      const tex = await this.hdrLoader.loadAsync(this.base + path);
      tex.mapping = EquirectangularReflectionMapping;
      tex.name = id;
      return tex;
    });
  }

  dispose(): void {
    this.dracoLoader.dispose();
    this.ktx2Loader.dispose();
    this.cache.clear();
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    let p = this.cache.get(key) as Promise<T> | undefined;
    if (!p) {
      p = load();
      // A failed request can be retried.
      p.catch(() => this.cache.delete(key));
      this.cache.set(key, p);
    }
    return p;
  }
}
