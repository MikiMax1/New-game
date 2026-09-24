import { N8AOPostPass } from 'n8ao';
import {
  BloomEffect,
  EdgeDetectionMode,
  Effect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type EffectMaterial,
} from 'postprocessing';
import * as THREE from 'three';
import type { Quality } from '../../core/quality';
import { GradeEffect } from './gradeEffect';

export type ToneMappingName = 'agx' | 'aces' | 'neutral';

export interface PostFXOptions {
  /** Tone mapping operator (default AgX). */
  toneMapping?: ToneMappingName;
}

/** Bloom starts above display white (after exposure): only the sun, glints and lights bloom. */
const BLOOM_THRESHOLD = 1.25;
const BLOOM_SMOOTHING = 0.9;

/**
 * Post-processing on a half-float frame buffer:
 *   scene -> N8AO (quality.ao) -> [bloom (quality.bloom), tone mapping, vignette, grade]
 *         -> SMAA (quality.antialias === 'smaa')
 * Exposure comes from renderer.toneMappingExposure, which the Atmosphere sets every frame; the
 * bloom threshold is rescaled with it so it stays fixed in display terms.
 *
 * Tone mapping is AgX: it keeps saturated sunset colours and a bright sky from skewing toward
 * yellow and cyan the way the ACES fit does, and rolls off highlights gracefully. The grade
 * restores the contrast and saturation AgX gives up.
 */
export class PostFX {
  readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private gradeEffect: GradeEffect | null = null;
  private bloom: BloomEffect | null = null;
  private ao: N8AOPostPass | null = null;
  private mainPass: EffectPass | null = null;
  private smaaPass: EffectPass | null = null;
  private layoutKey = '';
  private readonly toneMappingMode: ToneMappingMode;
  private readonly previousToneMapping: THREE.ToneMapping;
  private readonly timer = new THREE.Timer();
  private readonly size = new THREE.Vector2();
  /** Strength of the night-vision shift in the grade (0..1); e.g. atmosphere.nightFactor. */
  scotopic = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    quality: Quality,
    options: PostFXOptions = {},
  ) {
    // Tone mapping happens in the effect chain; materials render linear HDR.
    this.previousToneMapping = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    this.toneMappingMode =
      options.toneMapping === 'aces' ? ToneMappingMode.ACES_FILMIC : options.toneMapping === 'neutral' ? ToneMappingMode.NEUTRAL : ToneMappingMode.AGX;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.setQuality(quality);
  }

  get grade(): GradeEffect | null {
    return this.gradeEffect;
  }

  /** Cheap and idempotent: rebuilds the chain only when ao/bloom/antialias change; syncs size. */
  setQuality(q: Quality): void {
    const key = `${q.ao ? (q.name === 'medium' ? 'ao-half' : 'ao') : ''}|${q.bloom ? 'bloom' : ''}|${q.antialias}`;
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.rebuild(q);
    }
    this.setSize();
  }

  /** Match the renderer's drawing-buffer size, or resize the renderer to width x height (CSS px). */
  setSize(width?: number, height?: number): void {
    if (width === undefined || height === undefined) {
      this.renderer.getSize(this.size);
      width = this.size.x;
      height = this.size.y;
    }
    this.composer.setSize(width, height);
  }

  private rebuild(q: Quality): void {
    const composer = this.composer;
    composer.removeAllPasses();
    this.mainPass?.dispose();
    this.smaaPass?.dispose();
    this.ao?.dispose();
    this.mainPass = null;
    this.smaaPass = null;
    this.ao = null;
    this.bloom = null;

    composer.addPass(this.renderPass);

    if (q.ao) {
      this.renderer.getDrawingBufferSize(this.size);
      const ao = new N8AOPostPass(this.scene, this.camera, this.size.x, this.size.y);
      // Metres: occlusion within ~3 m (recesses, street corners, building bases) with a falloff
      // that keeps towers from casting dark halos onto the sky or the street far behind them.
      ao.autoDetectTransparency = false;
      const c = ao.configuration;
      c.aoRadius = 3.0;
      c.distanceFalloff = 1.0;
      c.intensity = 2.2;
      c.aoSamples = q.name === 'medium' ? 12 : 16;
      c.denoiseSamples = q.name === 'medium' ? 4 : 8;
      c.denoiseRadius = 12;
      c.halfRes = q.name === 'medium';
      c.depthAwareUpsampling = true;
      c.gammaCorrection = false;
      c.screenSpaceRadius = false;
      composer.addPass(ao);
      this.ao = ao;
    }

    const smaa = q.antialias === 'smaa';
    const grade = new GradeEffect();
    grade.setOutputGamma(smaa);
    this.gradeEffect = grade;
    const toneMapping = new ToneMappingEffect({ mode: this.toneMappingMode });
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.42 });
    const effects: Effect[] = [toneMapping, vignette, grade];
    if (q.bloom) {
      this.bloom = new BloomEffect({
        mipmapBlur: true,
        intensity: 0.55,
        radius: 0.7,
        levels: 7,
        luminanceThreshold: BLOOM_THRESHOLD,
        luminanceSmoothing: BLOOM_SMOOTHING,
      });
      effects.unshift(this.bloom);
    }
    const main = new EffectPass(this.camera, ...effects);
    composer.addPass(main);
    this.mainPass = main;

    if (smaa) {
      const pass = new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH, edgeDetectionMode: EdgeDetectionMode.COLOR }));
      // Receives sRGB-encoded colour from the grade and writes it to the screen unchanged.
      (pass.fullscreenMaterial as EffectMaterial).encodeOutput = false;
      pass.dithering = true;
      composer.addPass(pass);
      this.smaaPass = pass;
    } else {
      main.dithering = true;
    }
  }

  /** Renders a frame. `dt` in seconds (measured internally when omitted). */
  render(dt?: number): void {
    if (dt === undefined) {
      this.timer.update();
      dt = this.timer.getDelta();
    }
    const exposure = Math.max(1e-6, this.renderer.toneMappingExposure);
    if (this.bloom) {
      const lum = this.bloom.luminanceMaterial;
      lum.threshold = BLOOM_THRESHOLD / exposure;
      lum.smoothing = BLOOM_SMOOTHING / exposure;
    }
    if (this.gradeEffect) this.gradeEffect.scotopic = this.scotopic;
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
    this.timer.dispose();
    this.renderer.toneMapping = this.previousToneMapping;
    this.renderer.autoClear = true;
  }
}
