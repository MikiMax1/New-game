import { BlendFunction, Effect } from 'postprocessing';
import * as THREE from 'three';

const fragmentShader = /* glsl */ `
uniform float saturation;
uniform float power;
uniform vec3 shadowTint;
uniform vec3 highlightTint;
uniform float scotopic;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // AgX outputs pow(v, 2.2) of its display-encoded value v; grade v like Blender's AgX looks.
  vec3 v = pow(max(inputColor.rgb, vec3(0.0)), vec3(1.0 / 2.2));
  const vec3 W = vec3(0.2126, 0.7152, 0.0722);
  // Look: power (deeper shadows, more contrast) and saturation, a milder "Punchy".
  v = pow(v, vec3(power));
  float l = dot(v, W);
  v = l + saturation * (v - l);
  l = clamp(dot(v, W), 0.0, 1.0);
  // Night vision: in dim scenes colours desaturate and shift toward blue (Purkinje effect).
  float dark = scotopic * (1.0 - smoothstep(0.02, 0.5, l));
  v = mix(v, vec3(l) * vec3(0.76, 0.92, 1.3), dark * 0.72);
  // Split toning: cool shadows, warm highlights.
  float sh = (1.0 - l) * (1.0 - l);
  float hi = l * l;
  v *= mix(vec3(1.0), shadowTint, sh) * mix(vec3(1.0), highlightTint, hi);
  vec3 lin = pow(clamp(v, 0.0, 1.0), vec3(2.2));
#ifdef OUTPUT_GAMMA
  // A later pass (SMAA) works on perceptual values and writes them to the screen as they are.
  lin = mix(lin * 12.92, 1.055 * pow(max(lin, vec3(1e-7)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), lin));
#endif
  outputColor = vec4(lin, inputColor.a);
}
`;

export interface GradeOptions {
  saturation?: number;
  /** Power applied to AgX's encoded values (Blender's "Punchy" look uses 1.35). */
  power?: number;
  shadowTint?: THREE.ColorRepresentation;
  highlightTint?: THREE.ColorRepresentation;
}

/**
 * Restrained colour grade applied after AgX tone mapping: a mild version of AgX's "Punchy" look
 * (AgX alone is deliberately flat), cool shadows and warm highlights, and a scotopic shift for
 * dark scenes.
 */
export class GradeEffect extends Effect {
  constructor(options: GradeOptions = {}) {
    super('GradeEffect', fragmentShader, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['saturation', new THREE.Uniform(options.saturation ?? 1.2)],
        ['power', new THREE.Uniform(options.power ?? 1.15)],
        ['shadowTint', new THREE.Uniform(new THREE.Color(options.shadowTint ?? 0xf1f8ff))],
        ['highlightTint', new THREE.Uniform(new THREE.Color(options.highlightTint ?? 0xfff6ea))],
        ['scotopic', new THREE.Uniform(0)],
      ]),
    });
  }

  /** 0 by day, 1 at night: strength of the night-vision shift. */
  set scotopic(v: number) {
    this.uniforms.get('scotopic')!.value = v;
  }

  get scotopic(): number {
    return this.uniforms.get('scotopic')!.value as number;
  }

  /** Emit sRGB-encoded values (when a later pass writes them straight to the screen). */
  setOutputGamma(on: boolean): void {
    const has = this.defines.has('OUTPUT_GAMMA');
    if (has === on) return;
    if (on) this.defines.set('OUTPUT_GAMMA', '1');
    else this.defines.delete('OUTPUT_GAMMA');
    this.setChanged();
  }
}
