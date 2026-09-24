// Water: physically based surface (sky reflections, sun glints) with colour and clarity
// driven by the seabed depth baked into the mesh, two scrolling ripple layers, shoreline
// foam and rolling surf lines on the ocean beach.
import * as THREE from 'three';

export interface WaterMaterial {
  material: THREE.MeshStandardMaterial;
  update(time: number): void;
}

export function createWaterMaterial(waves: THREE.Texture): WaterMaterial {
  const uniforms = {
    uTime: { value: 0 },
    uWaves: { value: waves },
    uShallow: { value: new THREE.Color(0x49c4c1).convertSRGBToLinear() },
    uMid: { value: new THREE.Color(0x13808f).convertSRGBToLinear() },
    uDeep: { value: new THREE.Color(0x0a3d57).convertSRGBToLinear() },
    uFoam: { value: new THREE.Color(0xf4f6f4).convertSRGBToLinear() },
  };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.035,
    metalness: 0.0,
    transparent: true,
    depthWrite: false,
    envMapIntensity: 1.0,
  });
  material.name = 'water';
  material.customProgramCacheKey = () => 'solmar-water-v1';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aWater;\nvarying vec3 vWater;\nvarying vec3 vWaterPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWater = aWater;\nvWaterPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform sampler2D uWaves;
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec3 uFoam;
varying vec3 vWater;
varying vec3 vWaterPos;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float wDepth = max(vWater.x, 0.0);
float wShore = vWater.y;
float wSurf = vWater.z;
float wDist = distance(cameraPosition, vWaterPos);
vec3 wCol = mix(uShallow, uMid, smoothstep(0.4, 3.5, wDepth));
wCol = mix(wCol, uDeep, smoothstep(3.5, 14.0, wDepth));
float wAlpha = mix(0.22, 0.94, smoothstep(0.1, 4.5, wDepth));
// Noise from the ripple texture for breaking up foam edges.
float wNoise = texture2D(uWaves, vWaterPos.xz * 0.021 + vec2(uTime * 0.01, 0.0)).r;
// Thin foam hugging every shoreline.
float wFoam = (1.0 - smoothstep(0.02, 0.35 + 0.25 * wNoise, wDepth)) * 0.85;
// Rolling surf lines on the ocean beach, moving toward the sand. Wave crests are broken
// into segments along the shore and vary in spacing, like real sets of waves.
float alongNoise = texture2D(uWaves, vec2(vWaterPos.z * 0.004, vWaterPos.x * 0.002) + vec2(0.0, uTime * 0.003)).g;
float phase = wShore * (0.36 + 0.1 * alongNoise) + uTime * 1.25 + wNoise * 5.0;
float band = sin(phase);
float crest = smoothstep(0.82 + 0.12 * alongNoise, 0.985, band);
float broken = smoothstep(0.35, 0.65, texture2D(uWaves, vWaterPos.xz * 0.013 + vec2(uTime * 0.004, 0.0)).b);
float surfZone = wSurf * smoothstep(-75.0, -10.0, wShore);
wFoam = max(wFoam, surfZone * crest * mix(0.25, 1.0, broken) * (0.6 + 0.4 * wNoise));
// Lingering foam patches in the swash zone.
wFoam = max(wFoam, wSurf * smoothstep(-14.0, -2.0, wShore) * smoothstep(0.55, 0.8, wNoise) * 0.6);
wFoam *= 1.0 - smoothstep(1500.0, 3500.0, wDist) * 0.7;
diffuseColor.rgb = mix(wCol, uFoam, wFoam);
diffuseColor.a = max(wAlpha, wFoam);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.75, wFoam);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec2 uv1 = vWaterPos.xz * 0.045 + vec2(uTime * 0.018, uTime * 0.011);
  vec2 uv2 = vWaterPos.xz * 0.011 - vec2(uTime * 0.007, uTime * 0.013);
  vec3 n1 = texture2D(uWaves, uv1).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uWaves, uv2).xyz * 2.0 - 1.0;
  // Calmer in the shallows and toward the horizon (less shimmer and aliasing).
  float strength = 0.55 * smoothstep(0.0, 2.0, wDepth + 0.3) * (1.0 - 0.75 * smoothstep(250.0, 3000.0, wDist));
  vec2 slope = (n1.xy + n2.xy * 1.4) * strength;
  vec3 nWorld = normalize(vec3(slope.x, 1.0, slope.y));
  normal = normalize((viewMatrix * vec4(nWorld, 0.0)).xyz);
}`,
      );
  };
  return {
    material,
    update(time: number) {
      uniforms.uTime.value = time;
    },
  };
}

/** Sea surface around the playable map (four slabs framing it), deep-water attributes. */
export function farWaterGeometry(mapHalf: number, extent: number): THREE.BufferGeometry {
  const rects: [number, number, number, number][] = [
    [-extent, -extent, extent, -mapHalf],
    [-extent, mapHalf, extent, extent],
    [-extent, -mapHalf, -mapHalf, mapHalf],
    [mapHalf, -mapHalf, extent, mapHalf],
  ];
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const water: number[] = [];
  const idx: number[] = [];
  for (const [x0, z0, x1, z1] of rects) {
    const base = pos.length / 3;
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
      pos.push(x, -0.02, z);
      nrm.push(0, 1, 0);
      uv.push(x / 32, z / 32);
      water.push(25, -500, 0);
    }
    idx.push(base, base + 3, base + 2, base, base + 2, base + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aWater', new THREE.Float32BufferAttribute(water, 3));
  g.setIndex(idx);
  return g;
}
