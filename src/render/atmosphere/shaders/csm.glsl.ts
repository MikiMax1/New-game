/**
 * Cascaded shadow maps for the atmosphere's key light (sun by day, moon by night).
 *
 * The cascades are ordinary shadow-casting DirectionalLights: light 0 carries the light's colour,
 * lights 1..N-1 are black and only exist for their shadow maps. This replaces the directional
 * light loop of three's lights_fragment_begin so that:
 *  - the key light is shaded once, with a shadow taken from the first (finest) cascade whose
 *    shadow map contains the fragment ("map-based" selection: no extra uniforms, so every
 *    material works without registration), blended into the next cascade near its border and
 *    faded out at the edge of the last one;
 *  - the black cascade lights are skipped; other (non shadow-casting) directional lights are
 *    shaded as usual.
 * The Atmosphere owns all shadow-casting directional lights in the scene.
 */

const START = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const END = '#pragma unroll_loop_end';

function csmBlock(blend: number, debug: boolean): string {
  return /* glsl */ `#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )

	DirectionalLight directionalLight;
	float solmarKeyShadow = 1.0;
	${debug ? 'vec3 solmarCsmTint = vec3( 1.0 );' : ''}

	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	{
		DirectionalLightShadow solmarCsm;
		float solmarCsmLeft = 1.0;
		float solmarCsmSum = 0.0;
		vec3 solmarCsmCoord;
		float solmarCsmEdge;
		float solmarCsmW;
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			if ( solmarCsmLeft > 0.001 ) {
				solmarCsmCoord = vDirectionalShadowCoord[ i ].xyz / vDirectionalShadowCoord[ i ].w;
				solmarCsmEdge = min( min( solmarCsmCoord.x, 1.0 - solmarCsmCoord.x ), min( solmarCsmCoord.y, 1.0 - solmarCsmCoord.y ) );
				if ( solmarCsmEdge > 0.0 && solmarCsmCoord.z < 1.0 && solmarCsmCoord.z > 0.0 ) {
					solmarCsmW = clamp( solmarCsmEdge * ${blend.toFixed(2)}, 0.0, 1.0 );
					solmarCsm = directionalLightShadows[ i ];
					solmarCsmSum += solmarCsmLeft * solmarCsmW * getShadow( directionalShadowMap[ i ], solmarCsm.shadowMapSize, solmarCsm.shadowIntensity, solmarCsm.shadowBias, solmarCsm.shadowRadius, vDirectionalShadowCoord[ i ] );
					${debug ? 'solmarCsmTint = mix( solmarCsmTint, vec3( UNROLLED_LOOP_INDEX == 0 ? 1.0 : 0.3, UNROLLED_LOOP_INDEX == 1 ? 1.0 : 0.3, UNROLLED_LOOP_INDEX == 2 ? 1.0 : ( UNROLLED_LOOP_INDEX == 3 ? 0.9 : 0.3 ) ), solmarCsmLeft * solmarCsmW );' : ''}
					solmarCsmLeft *= 1.0 - solmarCsmW;
				}
			}
		}
		#pragma unroll_loop_end
		solmarKeyShadow = solmarCsmSum + solmarCsmLeft;
	}
	#endif

	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		#if ( UNROLLED_LOOP_INDEX == 0 ) || ( UNROLLED_LOOP_INDEX >= NUM_DIR_LIGHT_SHADOWS )
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if ( UNROLLED_LOOP_INDEX == 0 ) && defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )
		directLight.color *= receiveShadow ? solmarKeyShadow : 1.0;
		${debug ? 'directLight.color *= solmarCsmTint;' : ''}
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		#endif
	}
	#pragma unroll_loop_end

#endif`;
}

/**
 * Returns lights_fragment_begin with the cascaded key-light loop, or null when the chunk does
 * not have the expected shape (a different three.js version).
 * @param blend 1 / width of the blend band between cascades, in shadow-map UV units.
 */
export function patchLightsFragmentBegin(source: string, blend = 22, debug = false): string | null {
  const start = source.indexOf(START);
  if (start < 0) return null;
  const endPragma = source.indexOf(END, start);
  if (endPragma < 0) return null;
  const endIf = source.indexOf('#endif', endPragma);
  if (endIf < 0) return null;
  const block = source.slice(start, endIf + '#endif'.length);
  if (!block.includes('directionalShadowMap[ i ]') || !block.includes('RE_Direct(')) return null;
  return source.slice(0, start) + csmBlock(blend, debug) + source.slice(endIf + '#endif'.length);
}
