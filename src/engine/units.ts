// Physical units in shaders. Everything that glows (sky, lamps, windows, signs) is authored in
// nits (cd/m²) and multiplied by the current pre-exposure before it reaches the frame buffer
// (see exposure.ts). Lights take lux or candela through ExposedLights / LightPool instead.
import { float, uniform, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';

/** Current exposure (linear multiplier), shared by every shader. The engine sets it each frame. */
export const exposureNode = uniform(1).setName('preExposure');

/**
 * A radiance of `luminance` nits with colour `color` (linear RGB, luminance ~1), pre-exposed:
 * use it as a material's emissiveNode or a sky's colorNode.
 */
export function nits(color: Node<'vec3'> | [number, number, number], luminance: Node<'float'> | number): Node<'vec3'> {
  const c = Array.isArray(color) ? vec3(...color) : color;
  const l = typeof luminance === 'number' ? float(luminance) : luminance;
  return c.mul(l).mul(exposureNode);
}
