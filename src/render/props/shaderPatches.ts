// Shader patches for prop materials, applied through onBeforeCompile.
//
// Every patch CHAINS: it keeps whatever onBeforeCompile / customProgramCacheKey the material
// already has and runs after it, and it only appends code next to #include lines (the include
// lines themselves are kept). So another module (e.g. cascaded shadows) can wrap these
// materials again later, before or after this module.
//
// Wind (vegetation materials and their depth materials)
//   attribute vec4 aWind: x = sway amplitude (m), y = flutter amplitude (m), z = phase (0-1),
//   w = spare. Displacement is computed in world space from the prop origin (instanceMatrix /
//   batchingMatrix translation) and converted back to model space, so it works for plain
//   meshes, InstancedMesh and BatchedMesh, with any rotation / scale per instance.
//   Per-instance phase comes from a hash of the instance's world position.
//
// Foliage (palmLeaf, oakLeaf)
//   - back faces keep the (bent) front normal, so both sides of a leaf card light the same;
//   - alpha is scaled up with the mip level so alpha-tested cards do not thin out at distance;
//   - a cheap translucency term adds light passing through leaves (strongest when looking
//     towards the sun), shadowed with the light's own shadow term.
//
// Signals (signalLens): attribute float aSignal (SIGNAL_LENS) selects red / amber / green /
//   pedestrian hand / walk; a global 60 s cycle decides which is lit. Heads facing along world
//   Z and heads facing along world X run in opposite phases.

import type * as THREE from 'three';

export interface PropUniforms {
  uPropTime: { value: number };
  /** xy = wind direction (world XZ, unit), z = strength (0 calm .. 1 strong breeze .. 2 gale), w = gustiness 0-1. */
  uPropWind: { value: THREE.Vector4 };
  /** x = diffuse transmission, y = forward-scatter (looking towards the sun). */
  uPropTranslucency: { value: THREE.Vector2 };
  /** Emissive gain for lit signal lenses. */
  uPropSignalGain: { value: number };
}

type Patch = (shader: THREE.WebGLProgramParametersWithUniforms) => void;

/** Chain a shader patch onto a material. `key` must identify the patch variant. */
export function chainPatch(material: THREE.Material, key: string, patch: Patch): void {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = function (this: THREE.Material, shader, renderer) {
    prev.call(this, shader, renderer);
    patch(shader);
  };
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = function (this: THREE.Material) {
    return `${prevKey.call(this)}|${key}`;
  };
  material.needsUpdate = true;
}

function insertAfter(src: string, include: string, code: string): string {
  const tag = `#include <${include}>`;
  return src.includes(tag) ? src.replace(tag, `${tag}\n${code}`) : src;
}

function insertBefore(src: string, include: string, code: string): string {
  const tag = `#include <${include}>`;
  return src.includes(tag) ? src.replace(tag, `${code}\n${tag}`) : src;
}

/** The prop's model->world matrix, accounting for instancing and batching. */
const PROP_MATRIX = /* glsl */ `
	#if defined( USE_BATCHING )
		mat4 propM = modelMatrix * batchingMatrix;
	#elif defined( USE_INSTANCING )
		mat4 propM = modelMatrix * instanceMatrix;
	#else
		mat4 propM = modelMatrix;
	#endif
`;

const WIND_PARS = /* glsl */ `
uniform float uPropTime;
uniform vec4 uPropWind;
attribute vec4 aWind;

vec3 propWindOffset( mat4 propM ) {
	vec3 origin = propM[ 3 ].xyz;
	float h = fract( sin( dot( origin.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	vec2 dir = uPropWind.xy;
	float strength = uPropWind.z;
	float t = uPropTime;
	float along = dot( origin.xz, dir );
	// Gust envelope travelling downwind at ~7 m/s.
	float wave = t * 7.0 - along;
	float g = 0.5 + 0.5 * sin( wave * 0.043 + h * 0.7 ) * sin( wave * 0.017 + 1.3 );
	float gust = mix( 1.0, 0.3 + 1.4 * g, uPropWind.w );
	// Trunk sway: mean lean downwind plus a slow oscillation (0.25-0.4 Hz, per instance).
	float f = 1.55 + h * 0.9;
	float osc = sin( t * f + h * 6.2831 ) * 0.65 + sin( t * f * 2.31 + h * 3.1 ) * 0.2;
	float sway = strength * gust * ( 0.5 + 0.5 * osc );
	float side = strength * gust * 0.22 * sin( t * f * 0.71 + h * 4.0 );
	vec3 windW = vec3( dir.x, 0.0, dir.y );
	vec3 sideW = vec3( -dir.y, 0.0, dir.x );
	vec3 off = ( windW * sway + sideW * side ) * aWind.x;
	// Leaf flutter: faster, per leaf phase, pushed downwind and bobbing vertically.
	float ph = ( aWind.z + h ) * 6.2831;
	float fl = sin( t * 4.7 + ph + along * 0.25 ) * 0.6 + sin( t * 8.3 + ph * 1.73 ) * 0.28 + sin( t * 13.1 + ph * 2.9 ) * 0.12 * aWind.w;
	float flut = strength * ( 0.3 + 0.7 * gust ) * aWind.y;
	off += windW * flut * ( 0.55 + 0.45 * fl );
	off.y += flut * fl * 0.8 - flut * 0.25;
	// World offset -> model space (exact for rotation x per-axis scale).
	mat3 m3 = mat3( propM );
	vec3 local = transpose( m3 ) * off;
	return local / vec3( dot( m3[ 0 ], m3[ 0 ] ), dot( m3[ 1 ], m3[ 1 ] ), dot( m3[ 2 ], m3[ 2 ] ) );
}
`;

const WIND_VERTEX = /* glsl */ `
	{
		${PROP_MATRIX}
		transformed += propWindOffset( propM );
	}
`;

const FOLIAGE_NORMAL = /* glsl */ `
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		normal *= faceDirection; // undo the back-face flip: leaf cards use their bent normal on both sides
		nonPerturbedNormal = normal;
	#endif
`;

const ALPHA_MIP = /* glsl */ `
	#if defined( USE_MAP ) && defined( USE_ALPHATEST )
	{
		vec2 propTs = vec2( textureSize( map, 0 ) );
		vec2 propDx = dFdx( vMapUv * propTs );
		vec2 propDy = dFdy( vMapUv * propTs );
		float propLod = max( 0.0, 0.5 * log2( max( dot( propDx, propDx ), dot( propDy, propDy ) ) ) );
		diffuseColor.a *= 1.0 + propLod * 0.3;
	}
	#endif
`;

/** Leaf cards seen edge-on smear into streaks: fade them using the true (flat) triangle normal. */
const EDGE_FADE = /* glsl */ `
	#if defined( USE_ALPHATEST ) && ! defined( FLAT_SHADED )
	{
		vec3 propFlat = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
		float propFacing = abs( dot( propFlat, normalize( vViewPosition ) ) );
		diffuseColor.a *= smoothstep( 0.04, 0.22, propFacing );
	}
	#endif
`;

const TRANSLUCENCY_PARS = /* glsl */ `
uniform vec2 uPropTranslucency;
`;

const FOLIAGE_SPECULAR = /* glsl */ `
	// Leaves inside a crown are mostly occluded from the sky: damp reflections (and the grazing
	// Fresnel sheen that bent normals would otherwise produce).
	reflectedLight.indirectSpecular *= 0.25;
	reflectedLight.directSpecular *= 0.6;
`;

const TRANSLUCENCY = /* glsl */ `
	#if defined( RE_Direct ) && ( NUM_DIR_LIGHTS > 0 || NUM_SUN_LIGHTS > 0 )
	{
		// directLight still holds the last directional light, including its shadow term.
		vec3 propV = normalize( vViewPosition );
		float propFwd = pow( saturate( dot( - propV, directLight.direction ) ), 4.0 );
		float propThru = saturate( 0.5 - 0.5 * dot( geometryNormal, directLight.direction ) );
		reflectedLight.directDiffuse += diffuseColor.rgb * directLight.color * RECIPROCAL_PI *
			( uPropTranslucency.x * propThru + uPropTranslucency.y * propFwd );
	}
	#endif
`;

/** Wind sway on any Mesh*Material (vertex only). */
export function applyWind(material: THREE.Material, u: PropUniforms): void {
  chainPatch(material, 'propWind1', (shader) => {
    shader.uniforms.uPropTime = u.uPropTime;
    shader.uniforms.uPropWind = u.uPropWind;
    shader.vertexShader = insertAfter(shader.vertexShader, 'common', WIND_PARS);
    shader.vertexShader = insertAfter(shader.vertexShader, 'begin_vertex', WIND_VERTEX);
  });
}

/** Foliage shading tweaks (fragment); `depth` = for a depth material (alpha fix only). */
export function applyFoliage(material: THREE.Material, u: PropUniforms, depth = false): void {
  chainPatch(material, depth ? 'propFoliageDepth1' : 'propFoliage1', (shader) => {
    shader.fragmentShader = insertBefore(shader.fragmentShader, 'alphatest_fragment', ALPHA_MIP);
    if (depth) return;
    shader.fragmentShader = insertBefore(shader.fragmentShader, 'alphatest_fragment', EDGE_FADE);
    shader.uniforms.uPropTranslucency = u.uPropTranslucency;
    shader.fragmentShader = insertAfter(shader.fragmentShader, 'common', TRANSLUCENCY_PARS);
    shader.fragmentShader = insertAfter(shader.fragmentShader, 'normal_fragment_begin', FOLIAGE_NORMAL);
    shader.fragmentShader = insertAfter(shader.fragmentShader, 'lights_fragment_begin', TRANSLUCENCY);
    shader.fragmentShader = insertAfter(shader.fragmentShader, 'lights_fragment_end', FOLIAGE_SPECULAR);
  });
}

/** Emissive = material emissive x vertex colour (one lamp material, many lamp colours). */
export function applyEmissiveVertexColor(material: THREE.Material): void {
  chainPatch(material, 'propEmissiveVC1', (shader) => {
    shader.fragmentShader = insertAfter(
      shader.fragmentShader,
      'emissivemap_fragment',
      /* glsl */ `
	#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
		totalEmissiveRadiance *= vColor.rgb;
	#endif`,
    );
  });
}

const SIGNAL_PARS_VERTEX = /* glsl */ `
uniform float uPropTime;
attribute float aSignal;
varying vec3 vPropSignal;
`;

const SIGNAL_VERTEX = /* glsl */ `
	{
		${PROP_MATRIX}
		vec3 propFwd = normalize( ( propM * vec4( 0.0, 0.0, - 1.0, 0.0 ) ).xyz );
		float propAng = atan( propFwd.x, propFwd.z );
		// Group 0: heads facing along +-Z (traffic moving along Z); group 1: along +-X.
		float propGroup = step( 0.5, fract( ( propAng + 0.7853982 ) / 3.1415927 ) );
		float cyc = 60.0;
		float st = mod( uPropTime + propGroup * cyc * 0.5, cyc );
		float green = step( st, 25.0 );
		float amber = step( 25.0, st ) * step( st, 29.0 );
		float red = 1.0 - green - amber;
		float walk = step( st, 8.0 );
		float clearance = step( 8.0, st ) * step( st, 25.0 );
		float blink = step( 0.5, fract( uPropTime ) );
		float hand = ( 1.0 - walk - clearance ) + clearance * blink;
		int propK = int( aSignal + 0.5 );
		vec3 c = vec3( 0.0 );
		if ( propK == 1 ) c = vec3( 1.0, 0.06, 0.03 ) * red;
		else if ( propK == 2 ) c = vec3( 1.0, 0.42, 0.02 ) * amber;
		else if ( propK == 3 ) c = vec3( 0.12, 1.0, 0.62 ) * green;
		else if ( propK == 4 ) c = vec3( 1.0, 0.42, 0.08 ) * hand;
		else if ( propK == 5 ) c = vec3( 0.92, 0.96, 1.0 ) * walk;
		vPropSignal = c;
	}
`;

const SIGNAL_PARS_FRAGMENT = /* glsl */ `
uniform float uPropSignalGain;
varying vec3 vPropSignal;
`;

const SIGNAL_FRAGMENT = /* glsl */ `
	{
		#ifdef USE_MAP
			float propMask = dot( sampledDiffuseColor.rgb, vec3( 0.3333 ) );
		#else
			float propMask = 1.0;
		#endif
		totalEmissiveRadiance += vPropSignal * propMask * uPropSignalGain;
	}
`;

/** Traffic / pedestrian signal lenses lit by a global cycle. */
export function applySignal(material: THREE.Material, u: PropUniforms): void {
  chainPatch(material, 'propSignal1', (shader) => {
    shader.uniforms.uPropTime = u.uPropTime;
    shader.uniforms.uPropSignalGain = u.uPropSignalGain;
    shader.vertexShader = insertAfter(shader.vertexShader, 'common', SIGNAL_PARS_VERTEX);
    shader.vertexShader = insertAfter(shader.vertexShader, 'begin_vertex', SIGNAL_VERTEX);
    shader.fragmentShader = insertAfter(shader.fragmentShader, 'common', SIGNAL_PARS_FRAGMENT);
    shader.fragmentShader = insertAfter(shader.fragmentShader, 'emissivemap_fragment', SIGNAL_FRAGMENT);
  });
}
