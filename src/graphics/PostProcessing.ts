// The showcase's camera and post-processing chain, on three.js's node RenderPipeline. (The
// EffectComposer passes are WebGL-only; these are the WebGPU renderer's equivalents, and they run
// on its WebGL 2 fallback too.)
//
//   pre-pass   depth, view normals, motion vectors and reflectivity; no lighting
//   GTAO       ground-truth ambient occlusion; it darkens the ambient (image-based) light only,
//              so sunlit surfaces stay sunlit and contact shadows appear where objects meet
//   scene      the lit HDR frame
//   SSR        screen-space reflections on glossy surfaces: paint, glass, chrome, wet road
//   TRAA       temporal anti-aliasing; also resolves GTAO's and the flakes' noise
//   DoF        bokeh depth of field focused on the subject
//   bloom      UnrealBloom-style glare (strength 0.15, radius 0.4, threshold 0.85)
//   lens       chromatic aberration and vignetting (cos⁴ fall-off of a real lens, plus a touch more)
//   grade      Unreal-style colour grading in scene-linear light: white balance, contrast about
//              18% grey, saturation, split toning; then ACES filmic tone mapping (the renderer's
//              exposure) and sRGB output
//   grain      sensor noise after the tone curve, strongest in the mid-tones, new every frame;
//              it also dithers away banding in 8-bit gradients
import {
  builtinAOContext,
  dot,
  hash,
  float,
  interleavedGradientNoise,
  luminance,
  metalness,
  mix,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  positionViewDirection,
  renderOutput,
  roughness,
  sample,
  screenCoordinate,
  screenUV,
  smoothstep,
  time,
  uniform,
  unpackRGBToNormal,
  vec2,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
import {
  RenderPipeline,
  UnsignedByteType,
  type NodeMaterial,
  Vector2,
  Vector3,
  type Node,
  type PerspectiveCamera,
  type Scene,
  type UniformNode,
  type WebGPURenderer,
} from 'three/webgpu';
import { bloom, type default as BloomNode } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { ao, type default as GTAONode } from 'three/addons/tsl/display/GTAONode.js';
import { ssr, type default as SSRNode } from 'three/addons/tsl/display/SSRNode.js';
import { traa, type default as TRAANode } from 'three/addons/tsl/display/TRAANode.js';

export interface PostSettings {
  ao: boolean;
  ssr: boolean;
  taa: boolean;
  dof: boolean;
  bloom: boolean;
  lens: boolean;
  grade: boolean;
  /** Resolution of the SSR and GTAO passes relative to the frame. */
  effectScale: number;
}

export const DEFAULT_POST: PostSettings = { ao: true, ssr: true, taa: true, dof: true, bloom: true, lens: true, grade: true, effectScale: 0.5 };

type Uniform<T extends 'float' | 'vec3'> = T extends 'float' ? UniformNode<'float', number> : UniformNode<'vec3', Vector3>;

/** Colour grading controls, in the spirit of Unreal's post-process volume. */
export interface Grade {
  /** White balance: + warmer, − cooler (roughly mireds / 100). */
  temperature: Uniform<'float'>;
  /** + magenta, − green. */
  tint: Uniform<'float'>;
  /** Contrast about 18% grey (1 = neutral). */
  contrast: Uniform<'float'>;
  saturation: Uniform<'float'>;
  /** Colour added to the shadows and highlights (split toning), linear RGB multipliers. */
  shadows: Uniform<'vec3'>;
  highlights: Uniform<'vec3'>;
  /** Extra vignette on top of the lens's natural fall-off, 0..1. */
  vignette: Uniform<'float'>;
  /** Chromatic aberration strength (0 = none). */
  chromaticAberration: Uniform<'float'>;
  /** Film grain amplitude in display values (0 = none). */
  grain: Uniform<'float'>;
}

/**
 * Marks a material as reflective for the screen-space reflection pass: `weight` is the share of
 * light it reflects at this view angle (0 = none; e.g. the Fresnel term of water or lacquer),
 * `roughness` how blurry its reflection is. Written into the pre-pass's `reflect` target; by
 * default that target holds metalness and roughness, so metals reflect without this.
 */
export function markReflective(material: NodeMaterial, weight: Node<'float'>, roughness: Node<'float'>): void {
  material.mrtNode = mrt({ reflect: vec2(weight, roughness) });
}

/** Fresnel reflectance of a dielectric surface (F0 = 0.02 water … 0.04 glass) along the view. */
export function fresnel(normal: Node<'vec3'>, f0 = 0.04): Node<'float'> {
  const f = float(1).sub(normal.dot(positionViewDirection).clamp(0, 1));
  return f.pow(5).mul(1 - f0).add(f0);
}

export class PostProcessing {
  readonly pipeline: RenderPipeline;
  /** Distance to the plane in focus, metres. */
  readonly focusDistance = uniform(20);
  /** Distance from the focal plane at which things are fully out of focus, metres. */
  readonly focusRange = uniform(90);
  /** Largest blur, in pixels at 1080p. */
  readonly bokehScale = uniform(1.6);
  readonly grade: Grade = {
    temperature: uniform(0.35),
    tint: uniform(0.05),
    contrast: uniform(1.1),
    saturation: uniform(1.06),
    shadows: uniform(new Vector3(0.97, 1.0, 1.04)),
    highlights: uniform(new Vector3(1.03, 1.0, 0.96)),
    vignette: uniform(0.22),
    chromaticAberration: uniform(0.12),
    grain: uniform(0.022),
  };
  readonly aoNode: GTAONode | null = null;
  readonly ssrNode: SSRNode | null = null;
  readonly traaNode: TRAANode | null = null;
  readonly bloomNode: BloomNode | null = null;

  constructor(
    renderer: WebGPURenderer,
    scene: Scene,
    private readonly camera: PerspectiveCamera,
    readonly settings: PostSettings = DEFAULT_POST,
  ) {
    this.pipeline = new RenderPipeline(renderer);
    // Tone mapping and sRGB are applied explicitly below, after the grade.
    this.pipeline.outputColorTransform = false;

    // Pre-pass: the G-buffer the screen-space effects read. `reflect` is (share of light
    // reflected, blur) for SSR: metals by default, lacquer, glass and water through the
    // materials' own MRT outputs (MaterialLibrary.reflective()).
    const prePass = pass(scene, camera);
    prePass.name = 'Pre-pass';
    prePass.transparent = false;
    prePass.setMRT(mrt({ output: vec4(packNormalToRGB(normalView), 1), velocity, reflect: vec2(metalness, roughness) }));
    prePass.getTexture('output').type = UnsignedByteType;
    prePass.getTexture('reflect').type = UnsignedByteType;
    const depth = prePass.getTextureNode('depth');
    const normalTexture = prePass.getTextureNode('output');
    const normal = sample((uv) => unpackRGBToNormal(normalTexture.sample(uv).rgb));

    // The lit scene. Its MRT makes materials' own outputs merge with (not replace) the colour.
    const scenePass = pass(scene, camera);
    scenePass.name = 'Scene';
    scenePass.setMRT(mrt({ output }));

    if (settings.ao) {
      const aoNode = ao(depth, normal, camera);
      aoNode.resolutionScale = settings.effectScale;
      aoNode.radius.value = 0.6;
      aoNode.distanceExponent.value = 1.4;
      aoNode.thickness.value = 1.5;
      aoNode.scale.value = 1.1;
      aoNode.samples.value = 16;
      scenePass.contextNode = builtinAOContext(aoNode.getTextureNode().sample(screenUV).r);
      this.aoNode = aoNode;
    }

    let color: Node<'vec4'> = scenePass.getTextureNode('output');

    if (settings.ssr) {
      const reflect = prePass.getTextureNode('reflect');
      const ssrNode = ssr(color, depth, normal, { metalnessNode: reflect.r, roughnessNode: reflect.g, camera });
      ssrNode.resolutionScale = settings.effectScale;
      ssrNode.maxDistance.value = 18;
      ssrNode.thickness.value = 0.08;
      ssrNode.quality.value = 0.6;
      ssrNode.blurQuality = 2;
      ssrNode.screenEdgeFade.value = 0.15;
      ssrNode.maxLuminance.value = 40;
      // SSR returns premultiplied reflections: add them to the frame.
      color = color.add(vec4(ssrNode.rgb, 0));
      this.ssrNode = ssrNode;
    }

    if (settings.taa) {
      const traaNode = traa(color, depth, prePass.getTextureNode('velocity'), camera);
      color = (traaNode as unknown as { getTextureNode(): Node<'vec4'> }).getTextureNode();
      this.traaNode = traaNode;
    }

    if (settings.dof) {
      color = dof(color, prePass.getViewZNode(), this.focusDistance, this.focusRange, this.bokehScale) as unknown as Node<'vec4'>;
    }

    if (settings.bloom) {
      const bloomNode = bloom(color, 0.15, 0.4, 0.85);
      color = color.add(bloomNode);
      this.bloomNode = bloomNode;
    }

    if (settings.lens) {
      color = chromaticAberration(color, this.grade.chromaticAberration, vec2(0.5, 0.5), float(1)) as unknown as Node<'vec4'>;
      color = vec4(color.rgb.mul(this.vignette()), 1);
    }

    if (settings.grade) color = vec4(this.colorGrade(color.rgb), 1);

    // ACES filmic tone mapping (renderer.toneMappingExposure) and sRGB, then grain: film/sensor
    // noise, strongest in the mid-tones (none in pure black or white), different every frame.
    const display = renderOutput(color);
    const lum = luminance(display.rgb);
    const midtones = lum.mul(float(1).sub(lum)).mul(4).add(0.15);
    const seed = screenCoordinate.xy.add(time.mul(vec2(97.13, 61.7)).fract().mul(1000));
    const noise = hash(seed.x.add(seed.y.mul(4096)).add(interleavedGradientNoise(screenCoordinate.xy))).sub(0.5);
    this.pipeline.outputNode = vec4(display.rgb.add(noise.mul(this.grade.grain).mul(midtones)), 1);
  }

  /** Focuses on a point in the world. */
  focusOn(point: Vector3): void {
    this.focusDistance.value = Math.max(0.1, -point.clone().applyMatrix4(this.camera.matrixWorldInverse).z);
  }

  render(): void {
    this.pipeline.render();
  }

  dispose(): void {
    this.pipeline.dispose();
  }

  /**
   * Vignetting: a real lens darkens towards the corners as cos⁴ of the angle off its axis (the
   * wider the lens, the more), and grading adds a little on top.
   */
  private vignette(): Node<'float'> {
    const camera = this.camera;
    const tanHalf = uniform(new Vector2()).onRenderUpdate(() => {
      const t = Math.tan((camera.fov * Math.PI) / 360);
      return new Vector2(t * camera.aspect, t);
    });
    const ndc = screenUV.mul(2).sub(1).mul(tanHalf);
    const cos2 = float(1).div(float(1).add(dot(ndc, ndc)));
    const natural = cos2.mul(cos2);
    const r = screenUV.sub(0.5).mul(vec2(1.15, 1)).length();
    const artistic = float(1).sub(smoothstep(0.35, 0.95, r).mul(this.grade.vignette));
    return natural.mul(artistic);
  }

  /** Unreal-style grade in linear scene light (ACES comes after). */
  private colorGrade(c: Node<'vec3'>): Node<'vec3'> {
    const g = this.grade;
    // White balance as gains: warm = more red, less blue; tint = magenta vs green.
    const wb = vec3(float(1).add(g.temperature.mul(0.1)), float(1).sub(g.tint.mul(0.05)), float(1).sub(g.temperature.mul(0.1)));
    const balanced = c.mul(wb).max(0);
    // Contrast about middle grey, in log space (as Unreal does): a steeper curve through 0.18.
    const contrasted = balanced.add(1e-5).div(0.18).pow(vec3(g.contrast)).mul(0.18);
    // Saturation about luminance.
    const lum = luminance(contrasted);
    const saturated = mix(vec3(lum), contrasted, g.saturation);
    // Split toning: shadows and highlights nudged towards their tints, weighted by luminance.
    const toneWeight = smoothstep(0.02, 1.2, lum);
    return saturated.mul(mix(g.shadows, g.highlights, toneWeight));
  }
}
