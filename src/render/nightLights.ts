// Adds baked street-light pools to ground materials at night. The pool map covers the
// whole city (see world/mesh/lightMap.ts); light is applied as warm illumination of the
// surface albedo, fading in with the night factor.
import * as THREE from 'three';
import { MAP_HALF, MAP_SIZE } from '../world/config';
import { LIGHTMAP_SIZE } from '../world/mesh/lightMap';

export class NightLights {
  readonly uniforms = {
    uLightPool: { value: null as THREE.Texture | null },
    uNight: { value: 0 },
    uPoolColor: { value: new THREE.Color(1.0, 0.72, 0.42).multiplyScalar(2.2) },
  };

  constructor(lightMap: Uint8Array) {
    const tex = new THREE.DataTexture(lightMap, LIGHTMAP_SIZE, LIGHTMAP_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.flipY = false;
    tex.needsUpdate = true;
    this.uniforms.uLightPool.value = tex;
  }

  /** Patches a MeshStandardMaterial (keeps any existing onBeforeCompile). */
  apply(material: THREE.Material): void {
    const m = material as THREE.MeshStandardMaterial;
    const previous = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey;
    const u = this.uniforms;
    m.onBeforeCompile = (shader, renderer) => {
      previous?.call(m, shader, renderer);
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vPoolUv;')
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
{
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  #endif
  vPoolUv = (wp.xz + ${MAP_HALF.toFixed(1)}) / ${MAP_SIZE.toFixed(1)};
}`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uLightPool;\nuniform float uNight;\nuniform vec3 uPoolColor;\nvarying vec2 vPoolUv;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
if (uNight > 0.001) {
  float pool = texture2D(uLightPool, vPoolUv).r;
  totalEmissiveRadiance += diffuseColor.rgb * uPoolColor * pool * pool * uNight;
}`,
        );
    };
    m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|nightpools';
    m.needsUpdate = true;
  }

  setNight(f: number): void {
    this.uniforms.uNight.value = f;
  }
}

/** Night factor from a sun direction: 0 in daylight, 1 once the sun is well below the horizon. */
export function nightFromSun(sun: THREE.Vector3): number {
  return THREE.MathUtils.clamp((0.06 - sun.y) / 0.16, 0, 1);
}
