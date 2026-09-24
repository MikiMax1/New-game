// Materials for procedural buildings (src/world/buildings). Two shared materials, one per
// bucket key, both MeshStandardMaterial with onBeforeCompile hooks, so they get normal PBR
// lighting, shadows, fog and scene.environment reflections:
//
//   bldFacade  walls: windows, frames, glass, interiors, storefronts, doors, weathering, night lights
//   bldDetail  roofs, parapets, ledges, awnings, equipment, signs, helipads, pools, parking...
//
// The hooks only append code after standard chunk includes (color, roughness, metalness,
// normal maps, emissive, AO) and keep every include, so other modules can wrap
// onBeforeCompile (e.g. cascaded shadows) before or after this one.

import * as THREE from 'three';
import { BUILDING_DETAIL_KEY, BUILDING_FACADE_KEY } from '../world/buildings/constants';
import { BLD_COMMON_GLSL, BLD_DEFINES, BLD_UNIFORMS_GLSL } from './buildings/commonGlsl';
import { DETAIL_FRAG_PARS, DETAIL_VERT_MAIN, DETAIL_VERT_PARS } from './buildings/detailGlsl';
import { FACADE_FRAG_PARS, FACADE_VERT_MAIN, FACADE_VERT_PARS } from './buildings/facadeGlsl';
import { createSignAtlas } from './buildings/signAtlas';

export interface BuildingUniforms {
  uBldNight: { value: number };
  uBldDay: { value: number };
  /** Lit window fraction per occupancy profile: residential, office, hotel, retail. */
  uBldOcc: { value: THREE.Vector4 };
  uBldSkyZ: { value: THREE.Color };
  uBldSkyH: { value: THREE.Color };
  uBldGnd: { value: THREE.Color };
  uBldSignAtlas: { value: THREE.Texture };
}

const PROGRAM_VERSION = 1;

function replaceOnce(src: string, find: string, add: string): string {
  if (!src.includes(find)) {
    console.warn(`buildingMaterials: shader chunk ${find} not found`);
    return src;
  }
  return src.replace(find, `${find}\n${add}`);
}

function hookShader(shader: THREE.WebGLProgramParametersWithUniforms, u: BuildingUniforms, kind: 'facade' | 'detail'): void {
  Object.assign(shader.uniforms, u);
  const facade = kind === 'facade';
  let v = shader.vertexShader;
  v = replaceOnce(v, '#include <common>', facade ? FACADE_VERT_PARS : DETAIL_VERT_PARS);
  v = replaceOnce(v, '#include <project_vertex>', facade ? FACADE_VERT_MAIN : DETAIL_VERT_MAIN);
  shader.vertexShader = v;
  const fn = facade ? 'bldFacade' : 'bldDetail';
  const nw = facade ? 'bNw' : 'dNw';
  let f = shader.fragmentShader;
  f = replaceOnce(f, '#include <common>', BLD_DEFINES);
  f = replaceOnce(f, '#include <clipping_planes_pars_fragment>', BLD_UNIFORMS_GLSL + BLD_COMMON_GLSL + (facade ? FACADE_FRAG_PARS : DETAIL_FRAG_PARS));
  f = replaceOnce(f, '#include <color_fragment>', `BldS bldS = ${fn}(diffuseColor.rgb);\ndiffuseColor.rgb = bldS.alb;`);
  f = replaceOnce(f, '#include <roughnessmap_fragment>', 'roughnessFactor = bldS.rough;');
  f = replaceOnce(f, '#include <metalnessmap_fragment>', 'metalnessFactor = bldS.metal;');
  f = replaceOnce(f, '#include <normal_fragment_maps>', `normal = normalize((viewMatrix * vec4(${nw}, 0.0)).xyz);`);
  f = replaceOnce(f, '#include <emissivemap_fragment>', 'totalEmissiveRadiance += bldS.emis;');
  f = replaceOnce(
    f,
    '#include <aomap_fragment>',
    /* glsl */ `
reflectedLight.indirectDiffuse *= bldS.ao;
reflectedLight.indirectSpecular *= mix(1.0, bldS.ao, 0.6);
reflectedLight.directDiffuse *= bldS.sh;
reflectedLight.directSpecular *= bldS.sh;
#ifndef USE_ENVMAP
{
  // no scene.environment: reflect a simple sky so glass never turns black
  vec3 bldV = normalize(cameraPosition - vBldWPos);
  float bldF0 = mix(0.04, dot(bldS.alb, vec3(0.3333)), bldS.metal);
  float bldFr = bFresnel(dot(${nw}, bldV), bldF0);
  reflectedLight.indirectSpecular += bldS.glass * bldFr * bSkyFallback(reflect(-bldV, ${nw}));
}
#endif
`,
  );
  shader.fragmentShader = f;
}

function makeMaterial(u: BuildingUniforms, kind: 'facade' | 'detail'): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  m.name = kind === 'facade' ? BUILDING_FACADE_KEY : BUILDING_DETAIL_KEY;
  m.userData.bldUniforms = u;
  m.onBeforeCompile = (shader) => hookShader(shader, u, kind);
  m.customProgramCacheKey = () => `${m.name}-v${PROGRAM_VERSION}`;
  return m;
}

/** Materials keyed by the bucket keys generateBuilding emits. Both share one uniform set. */
export function createBuildingMaterials(): Map<string, THREE.Material> {
  const u: BuildingUniforms = {
    uBldNight: { value: 0 },
    uBldDay: { value: 1 },
    uBldOcc: { value: new THREE.Vector4() },
    uBldSkyZ: { value: new THREE.Color() },
    uBldSkyH: { value: new THREE.Color() },
    uBldGnd: { value: new THREE.Color() },
    uBldSignAtlas: { value: createSignAtlas() },
  };
  const map = new Map<string, THREE.Material>([
    [BUILDING_FACADE_KEY, makeMaterial(u, 'facade')],
    [BUILDING_DETAIL_KEY, makeMaterial(u, 'detail')],
  ]);
  setBuildingNightFactor(map, 0);
  return map;
}

type Key = [hour: number, value: number];

// Fraction of windows lit by hour for each occupancy profile.
const OCC_CURVES: Key[][] = [
  // residential
  [[0, 0.22], [2, 0.1], [5, 0.06], [6.5, 0.25], [8.5, 0.12], [17, 0.14], [19, 0.42], [22, 0.5], [23.5, 0.3], [24, 0.22]],
  // office
  [[0, 0.08], [6, 0.1], [8, 0.6], [17, 0.8], [18.5, 0.62], [20, 0.36], [22, 0.18], [24, 0.08]],
  // hotel
  [[0, 0.3], [3, 0.12], [6, 0.2], [9, 0.15], [18, 0.35], [21, 0.55], [24, 0.3]],
  // retail (fraction of shops open / lit)
  [[0, 0.08], [7, 0.1], [9, 0.9], [20, 0.9], [22, 0.55], [23.5, 0.15], [24, 0.08]],
];

function curve(keys: Key[], hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < keys.length; i++) {
    if (h <= keys[i][0]) {
      const [h0, v0] = keys[i - 1];
      const [h1, v1] = keys[i];
      return v0 + ((v1 - v0) * (h - h0)) / Math.max(1e-6, h1 - h0);
    }
  }
  return keys[keys.length - 1][1];
}

const DAY_Z = new THREE.Color(0.2, 0.38, 0.78);
const DAY_H = new THREE.Color(0.66, 0.75, 0.86);
const DAY_G = new THREE.Color(0.2, 0.19, 0.17);
const NIGHT_Z = new THREE.Color(0.003, 0.005, 0.012);
const NIGHT_H = new THREE.Color(0.03, 0.028, 0.035);
const NIGHT_G = new THREE.Color(0.01, 0.01, 0.01);

/**
 * night: 0 = full day .. 1 = full night (window lights, neon, crown LEDs fade in; daylight in
 * interiors fades out). hour (optional, default 21) picks which windows are lit: offices
 * empty out after work, homes light up in the evening, shops close late at night.
 */
export function setBuildingNightFactor(materials: Map<string, THREE.Material>, night: number, hour = 21): void {
  const n = THREE.MathUtils.clamp(night, 0, 1);
  for (const m of materials.values()) {
    const u = m.userData.bldUniforms as BuildingUniforms | undefined;
    if (!u) continue;
    u.uBldNight.value = n;
    u.uBldDay.value = THREE.MathUtils.clamp(1 - n * 1.15, 0, 1);
    u.uBldOcc.value.set(curve(OCC_CURVES[0], hour), curve(OCC_CURVES[1], hour), curve(OCC_CURVES[2], hour), curve(OCC_CURVES[3], hour));
    u.uBldSkyZ.value.copy(DAY_Z).lerp(NIGHT_Z, n);
    u.uBldSkyH.value.copy(DAY_H).lerp(NIGHT_H, n);
    u.uBldGnd.value.copy(DAY_G).lerp(NIGHT_G, n);
    break; // all building materials share one uniform object
  }
}
