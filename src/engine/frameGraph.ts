// The frame graph: the passes that make one frame, in order.
//
//   pre-pass  depth and the G-buffer-lite (view normal + roughness, motion vectors); no lighting,
//             so it is cheap. Feeds screen-space effects, the temporal upscaler and the scene
//             pass's depth test.
//   GTAO      ground-truth ambient occlusion from depth and normals (quality.ao)
//   scene     forward+ lighting (clustered point lights on WebGPU); the AO darkens indirect light
//             only, so sunlit ground stays sunlit
//   TAAU      temporal anti-aliasing and upscaling: jittered frames rendered at the scene scale
//             (67–100% of the output) are accumulated into a full-resolution image
//   bloom     glare around the sun, lamps and bright highlights (quality.bloom)
//   output    AgX tone mapping and sRGB encoding (the renderer's output transform)
//   meter     log-average luminance of the scene for auto-exposure, read back asynchronously
//
// The scene is rendered pre-exposed (see exposure.ts), so every buffer holds values near 1.
import { Vector2 } from 'three';
import { builtinAOContext, mrt, normalView, packNormalToRGB, pass, roughness, sample, screenUV, unpackRGBToNormal, velocity, vec4 } from 'three/tsl';
import { PassNode, RenderPipeline, UnsignedByteType, type Camera, type Node, type NodeFrame, type Scene, type WebGPURenderer } from 'three/webgpu';
import { bloom, type default as BloomNode } from 'three/addons/tsl/display/BloomNode.js';
import { ao, type default as GTAONode } from 'three/addons/tsl/display/GTAONode.js';
import { taau, type default as TAAUNode } from 'three/addons/tsl/display/TAAUNode.js';
import { LuminanceMeter } from './metering';

export interface FrameGraphSettings {
  /** Temporal anti-aliasing and upscaling; without it the scene renders at full resolution. */
  taa: boolean;
  /** Ambient occlusion, and its resolution relative to the output (0 = off). */
  aoScale: number;
  bloom: boolean;
}

/** Bloom starts just above display white after exposure: the sun, lamps and glints. */
const BLOOM_THRESHOLD = 1.4;

const _size = new Vector2();

/**
 * The lit scene pass. It starts from a copy of the pre-pass depth instead of a cleared depth
 * buffer, so fragments hidden behind nearer geometry fail the depth test before the lighting
 * runs (early-z) and each pixel is lit about once. (A render target owns its depth texture in
 * three.js, so the two passes can't simply share one.)
 */
class EarlyZScenePass extends PassNode {
  private copied = false;

  constructor(
    scene: Scene,
    camera: Camera,
    private readonly prePass: PassNode,
  ) {
    super(PassNode.COLOR, scene, camera);
  }

  /** True when the last frame reused the pre-pass depth. */
  get earlyZ(): boolean {
    return this.copied;
  }

  override updateBefore(frame: NodeFrame): boolean | undefined {
    const renderer = frame.renderer as WebGPURenderer;
    // The pre-pass renders first this frame (the node frame runs each pass once per frame).
    frame.updateBeforeNode(this.prePass);
    renderer.getDrawingBufferSize(_size);
    this.setSize(_size.width, _size.height);
    const source = this.prePass.renderTarget;
    const target = this.renderTarget;
    this.copied = false;
    if (source.depthTexture && target.depthTexture && source.width === target.width && source.height === target.height) {
      // Allocates the (possibly resized) target before copying into it.
      renderer.initRenderTarget(target);
      renderer.copyTextureToTexture(source.depthTexture, target.depthTexture);
      this.copied = true;
    }
    this.autoClearDepth = !this.copied;
    return super.updateBefore(frame);
  }
}

export class FrameGraph {
  readonly pipeline: RenderPipeline;
  readonly prePass: PassNode;
  readonly scenePass: EarlyZScenePass;
  readonly meter: LuminanceMeter;
  private settings: FrameGraphSettings | null = null;
  private sceneScale = 1;
  private aoNode: GTAONode | null = null;
  private taauNode: TAAUNode | null = null;
  private bloomNode: BloomNode | null = null;

  constructor(
    private readonly renderer: WebGPURenderer,
    scene: Scene,
    private readonly camera: Camera,
  ) {
    this.pipeline = new RenderPipeline(renderer);

    this.prePass = pass(scene, camera);
    this.prePass.name = 'Pre-pass';
    this.prePass.transparent = false;
    this.prePass.setMRT(mrt({ output: vec4(packNormalToRGB(normalView), roughness), velocity }));
    // Normals and roughness fit in 8 bits per channel; motion vectors need half floats.
    this.prePass.getTexture('output').type = UnsignedByteType;

    this.scenePass = new EarlyZScenePass(scene, camera, this.prePass);
    this.scenePass.name = 'Scene';
    this.meter = new LuminanceMeter(this.scenePass.getTextureNode('output'));
  }

  /** Applies settings (rebuilding the graph when passes come or go) and the 3D render scale. */
  configure(settings: FrameGraphSettings, sceneScale: number): void {
    const s = this.settings;
    if (!s || s.taa !== settings.taa || s.aoScale !== settings.aoScale || s.bloom !== settings.bloom) {
      this.settings = { ...settings };
      this.build(settings);
    }
    this.setSceneScale(settings.taa ? sceneScale : 1);
  }

  get scale(): number {
    return this.sceneScale;
  }

  /** 3D render resolution relative to the output (reallocates the scene targets). */
  setSceneScale(scale: number): void {
    if (!this.settings?.taa) scale = 1;
    if (scale === this.sceneScale) return;
    this.sceneScale = scale;
    this.prePass.setResolutionScale(scale);
    this.scenePass.setResolutionScale(scale);
  }

  render(): void {
    this.pipeline.render();
  }

  /** Meters the frame just rendered (see LuminanceMeter.measure). */
  meterExposure(exposure: number, onReading: (nits: number) => void): void {
    this.meter.measure(this.renderer, exposure, onReading);
  }

  dispose(): void {
    this.disposeEffects();
    this.meter.dispose();
    this.prePass.dispose();
    this.scenePass.dispose();
    this.pipeline.dispose();
  }

  private build(settings: FrameGraphSettings): void {
    this.disposeEffects();
    const depth = this.prePass.getTextureNode('depth');

    if (settings.aoScale > 0) {
      const gbuffer = this.prePass.getTextureNode('output');
      const normal = sample((uv) => unpackRGBToNormal(gbuffer.sample(uv).xyz));
      const aoNode = ao(depth, normal, this.camera);
      aoNode.resolutionScale = settings.aoScale;
      // Metres: creases, corners and the ground under cars and benches; not whole streets.
      aoNode.radius.value = 1.5;
      aoNode.thickness.value = 1.5;
      aoNode.samples.value = settings.aoScale < 1 ? 12 : 16;
      // The noise pattern rotates each frame and TAAU averages it away.
      aoNode.useTemporalFiltering = settings.taa;
      this.aoNode = aoNode;
      this.scenePass.contextNode = builtinAOContext(aoNode.getTextureNode().sample(screenUV).r);
    } else {
      this.scenePass.contextNode = null;
    }

    let colour: Node<'vec4'> = this.scenePass.getTextureNode('output');
    if (settings.taa) {
      this.taauNode = taau(this.scenePass.getTextureNode('output'), depth, this.prePass.getTextureNode('velocity'), this.camera);
      colour = this.taauNode.getTextureNode();
    }
    if (settings.bloom) {
      this.bloomNode = bloom(colour, 0.12, 0.55, BLOOM_THRESHOLD);
      colour = colour.add(this.bloomNode);
    }
    this.pipeline.outputNode = colour;
    this.pipeline.needsUpdate = true;
  }

  private disposeEffects(): void {
    this.aoNode?.dispose();
    this.taauNode?.dispose();
    this.bloomNode?.dispose();
    this.aoNode = null;
    this.taauNode = null;
    this.bloomNode = null;
  }
}
