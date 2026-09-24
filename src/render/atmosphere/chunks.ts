import * as THREE from 'three';
import { patchLightsFragmentBegin } from './shaders/csm.glsl';
import { fogFragment, fogParsFragment, fogParsVertex, fogVertex, tonemappingFragment } from './shaders/fog.glsl';

/** Values of the `solmarAtmo` struct uniform, shared by reference by every material. */
export interface AtmosphereUniformValues {
  skyView: THREE.Texture | null;
  fogA: THREE.Vector4;
  fogB: THREE.Vector4;
  fogC: THREE.Vector4;
}

/**
 * The shared uniform. Its value is a plain object, which three.js' UniformsUtils.clone copies
 * by reference, so every material cloned from ShaderLib points at the same values (including
 * the sky-view texture) and the atmosphere updates them once per frame for all of them.
 */
export const atmosphereUniform: THREE.IUniform<AtmosphereUniformValues> = {
  value: {
    skyView: null,
    fogA: new THREE.Vector4(0, 1e-4, 1 / 1200, 1),
    fogB: new THREE.Vector4(5.8e-6, 13.6e-6, 33.1e-6, 30000),
    fogC: new THREE.Vector4(1e9, 2e9, 0, 0),
  },
};

export interface ChunkInstallResult {
  /** True when lights_fragment_begin was patched for cascaded shadows. */
  cascades: boolean;
}

let installed: ChunkInstallResult | null = null;

/**
 * Installs the atmosphere shader chunks globally (idempotent). Must run before the first frame
 * is rendered: three.js caches built-in programs without looking at chunk text.
 */
export function installAtmosphereChunks(csmDebug = false): ChunkInstallResult {
  if (installed) return installed;
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  chunks.fog_pars_vertex = fogParsVertex;
  chunks.fog_vertex = fogVertex;
  chunks.fog_pars_fragment = fogParsFragment;
  chunks.fog_fragment = fogFragment;
  chunks.tonemapping_fragment = tonemappingFragment;

  const patched = patchLightsFragmentBegin(chunks.lights_fragment_begin, 22, csmDebug);
  if (patched) chunks.lights_fragment_begin = patched;
  else console.warn('Atmosphere: unexpected lights_fragment_begin chunk; cascaded shadows limited to the first cascade.');

  // Built-in materials get the shared uniform and a marker define that enables the atmosphere
  // path of the fog chunks.
  const lib = THREE.ShaderLib as unknown as Record<string, { uniforms: Record<string, THREE.IUniform>; fragmentShader: string }>;
  for (const shader of Object.values(lib)) {
    if (!shader.uniforms || !('fogColor' in shader.uniforms)) continue;
    shader.uniforms.solmarAtmo = atmosphereUniform;
    if (!shader.fragmentShader.startsWith('#define SOLMAR_BUILTIN')) shader.fragmentShader = '#define SOLMAR_BUILTIN\n' + shader.fragmentShader;
  }
  // Custom shaders built from UniformsLib.fog carry the uniform too (they still need
  // registerMaterial to opt in to the atmosphere fog path).
  (THREE.UniformsLib.fog as Record<string, THREE.IUniform>).solmarAtmo = atmosphereUniform;

  installed = { cascades: patched !== null };
  return installed;
}

const REGISTERED = Symbol('solmarAtmosphere');

type Registrable = THREE.Material & { [REGISTERED]?: true; isShaderMaterial?: boolean; isRawShaderMaterial?: boolean };

/**
 * Prepares a material for the atmosphere. Built-in materials already work without it; this
 * - opts custom ShaderMaterials (with `fog: true` and three's fog chunks) into the atmospheric
 *   fog path and gives them the shared uniform,
 * - fixes up materials that were compiled before the atmosphere was installed.
 * Cascaded shadows need nothing per material (the cascade is chosen from the shadow maps).
 *
 * An existing onBeforeCompile is kept and called first; customProgramCacheKey is combined.
 * Safe to call more than once.
 */
export function registerMaterial(material: THREE.Material): void {
  const m = material as Registrable;
  if (m[REGISTERED] || m.isRawShaderMaterial) return;
  m[REGISTERED] = true;

  if (m.isShaderMaterial) {
    const sm = m as unknown as THREE.ShaderMaterial;
    sm.defines = { ...(sm.defines ?? {}), SOLMAR_ATMOSPHERE: '' };
    if (sm.uniforms && !sm.uniforms.solmarAtmo) sm.uniforms.solmarAtmo = atmosphereUniform;
  }

  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = function (this: THREE.Material, shader, renderer) {
    previousCompile.call(this, shader, renderer);
    if (!shader.uniforms.solmarAtmo) shader.uniforms.solmarAtmo = atmosphereUniform;
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = function (this: THREE.Material) {
    return previousKey.call(this) + '|solmar-atmosphere';
  };
  material.needsUpdate = true;
}

/** registerMaterial for every material under `root`. */
export function registerObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    if (Array.isArray(mat)) mat.forEach(registerMaterial);
    else registerMaterial(mat);
  });
}
