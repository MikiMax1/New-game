import { skyViewMapping } from './common.glsl';

/**
 * Height-dependent haze. The optical depth of an exponential layer (extinction sigma0 at sea
 * level, falloff 1/H) along a ray from height y0 with direction y-component dy over distance d
 * has a closed form, so fog costs a couple of exp() per pixel.
 */
export const hazeFunctions = /* glsl */ `
#ifndef SOLMAR_HAZE_FUNCTIONS
#define SOLMAR_HAZE_FUNCTIONS
float solmarLayerDepth(float y0, float dy, float d, float sigma0, float invH) {
  float a = sigma0 * exp(-max(y0, -50.0) * invH);
  float k = dy * d * invH;
  float f = abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0 - 0.5 * k;
  return a * d * f;
}
vec3 solmarHazeTransmittance(float y0, float dy, float d, float sigmaM, float invHM, vec3 sigmaR) {
  float odM = solmarLayerDepth(y0, dy, d, sigmaM, invHM);
  float odR = solmarLayerDepth(y0, dy, d, 1.0, 1.0 / 8000.0);
  return exp(-(vec3(odM) + sigmaR * odR));
}
// Optical depth of the haze layer from y0 to space along a ray pointing up (dy > 0).
float solmarHazeDepthToSpace(float y0, float dy, float sigma0, float invH) {
  float mu = max(dy, 0.015);
  return sigma0 * exp(-max(y0, 0.0) * invH) / (invH * mu);
}
#endif
`;

// ---------------------------------------------------------------------------------------------
// Global replacements for three.js' fog chunks. Every material with fog enabled (the default for
// the built-in lit materials) gets aerial perspective without any per-material setup.
//
// - The atmosphere path only compiles for built-in materials (SOLMAR_BUILTIN, injected into
//   ShaderLib) and for materials passed to Atmosphere.registerMaterial (SOLMAR_ATMOSPHERE).
//   Other custom shaders keep three's standard fog, so an unset sampler can never be bound.
// - Fog is applied in the tone-mapping chunk, i.e. in linear HDR before tone mapping and colour
//   encoding, which is correct both for post-processing (HDR target) and direct rendering.
//   If a shader has no tone-mapping chunk the fog chunk applies it instead.
// ---------------------------------------------------------------------------------------------

export const fogParsVertex = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vSolmarFogRay;
#endif
`;

export const fogVertex = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	// World-space vector from the camera to the vertex (inverse view rotation = transpose).
	vSolmarFogRay = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif
`;

export const fogParsFragment = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vSolmarFogRay;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
	#if defined( SOLMAR_BUILTIN ) || defined( SOLMAR_ATMOSPHERE )
		#define SOLMAR_FOG
		struct SolmarAtmosphere {
			sampler2D skyView; // sky-view LUT: sky radiance for every direction, scene units
			vec4 fogA;         // enabled, haze extinction at sea level (1/m), 1/H (1/m), LUT scale
			vec4 fogB;         // Rayleigh extinction at sea level (1/m) rgb, HDR output clamp
			vec4 fogC;         // far fade start (m), far fade end (m), horizon elevation (rad), -
		};
		uniform SolmarAtmosphere solmarAtmo;
		${hazeFunctions}
		${skyViewMapping}
		vec3 solmarApplyFog( vec3 color, vec3 ray ) {
			float d = length( ray );
			vec3 dir = ray / max( d, 1e-4 );
			vec3 T = solmarHazeTransmittance( cameraPosition.y, dir.y, d, solmarAtmo.fogA.y, solmarAtmo.fogA.z, solmarAtmo.fogB.xyz );
			// Fade into the sky before the far plane so the edge of the world never shows.
			T *= 1.0 - smoothstep( solmarAtmo.fogC.x, solmarAtmo.fogC.y, d );
			// Light scattered toward the eye tends to the sky radiance behind the object (the
			// horizon for rays pointing down), which also keeps far geometry continuous with the sky.
			float minY = sin( solmarAtmo.fogC.z + 0.004 );
			vec3 fdir = dir;
			if ( fdir.y < minY ) {
				vec2 h = normalize( dir.xz + vec2( 1e-6, 0.0 ) ) * sqrt( 1.0 - minY * minY );
				fdir = vec3( h.x, minY, h.y );
			}
			vec3 inscatter = texture2D( solmarAtmo.skyView, solmarSkyViewUv( fdir, solmarAtmo.fogC.z ) ).rgb * solmarAtmo.fogA.w;
			return min( color * T + inscatter * ( 1.0 - T ), vec3( solmarAtmo.fogB.w ) );
		}
	#endif
#endif
`;

const classicFog = /* glsl */ `
		#ifdef FOG_EXP2
			float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
		#else
			float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		#endif
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
`;

/** three's tonemapping_fragment with the atmosphere fog applied first (linear HDR). */
export const tonemappingFragment = /* glsl */ `
#if defined( SOLMAR_FOG ) && ! defined( SOLMAR_FOG_DONE )
	#define SOLMAR_FOG_DONE
	if ( solmarAtmo.fogA.x > 0.5 ) gl_FragColor.rgb = solmarApplyFog( gl_FragColor.rgb, vSolmarFogRay );
#endif
#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif
`;

export const fogFragment = /* glsl */ `
#ifdef USE_FOG
	#if defined( SOLMAR_FOG ) && ! defined( SOLMAR_FOG_DONE )
		#define SOLMAR_FOG_DONE
		if ( solmarAtmo.fogA.x > 0.5 ) {
			gl_FragColor.rgb = solmarApplyFog( gl_FragColor.rgb, vSolmarFogRay );
		} else {
			${classicFog}
		}
	#elif defined( SOLMAR_FOG )
		if ( solmarAtmo.fogA.x <= 0.5 ) {
			${classicFog}
		}
	#else
		${classicFog}
	#endif
#endif
`;
