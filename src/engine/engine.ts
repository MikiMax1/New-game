// The engine core: renderer, frame graph, exposure, lights, quality and the frame loop.
//
// Each browser frame (the monitor's refresh rate; no frame cap unless the player sets one):
//   input and camera → fixed 120 Hz simulation steps → per-frame updates → exposure and lights
//   → frame graph (pre-pass, AO, forward+ scene, TAAU, bloom, tone mapping) → luminance meter
// Frame times, CPU time and GPU time (timestamp queries) feed the F3 overlay and dynamic
// resolution.
import * as THREE from 'three';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { AgXToneMapping, PCFShadowMap, type WebGPURenderer } from 'three/webgpu';
import { FlyCamera } from '../core/flyCamera';
import { Input } from '../core/input';
import { isCapture, paramBool, paramNum, paramStr } from '../core/params';
import { initialQuality, lowerQuality, nextQuality, type Quality, type QualityChoice } from '../core/quality';
import { markFailed, markRunning, markStarting } from '../core/startupGuard';
import { loadPref, savePref } from '../core/storage';
import { DynamicResolution } from './dynamicResolution';
import { EyeAdaptation } from './exposure';
import { FrameGraph, type FrameGraphSettings } from './frameGraph';
import { FrameStats } from './frameStats';
import { ExposedLights, LightPool } from './lights';
import { createRenderer, isBackendChoice, type BackendName } from './renderer';
import { StatsOverlay } from './statsOverlay';
import { FixedStepper, FrameLimiter, nextFpsCap } from './timing';
import { exposureNode } from './units';

declare global {
  interface Window {
    /** Set when the page is loaded and a few frames have rendered (used by tools/shoot.mjs). */
    __READY?: boolean;
    /** Frame statistics for tools. */
    __STATS?: { calls: number; triangles: number; programs: number };
  }
}

/** Lamps shaded at once on WebGL 2, which has no clustered lighting (every lamp costs every pixel). */
const WEBGL_MAX_LIGHTS = 16;
/** Most point lights the clustered lighting (WebGPU) takes; the pool size stays below it. */
const CLUSTERED_CAPACITY = 1024;

export type FrameCallback = (dt: number, engine: Engine) => void;

export class Engine {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.3, 6000);
  readonly input: Input;
  readonly fly: FlyCamera;
  quality: Quality;
  readonly qualityReason: QualityChoice['reason'];
  /** Auto-exposure (EV100) with eye adaptation. */
  readonly eye = new EyeAdaptation();
  /** Lights with physical intensities (lux, candela). */
  readonly lights = new ExposedLights();
  /** Lamps in the world, shaded through a pool of point lights nearest the camera. */
  readonly lamps: LightPool;
  readonly frameGraph: FrameGraph;
  readonly stats = new FrameStats();
  readonly overlay: StatsOverlay;
  readonly stepper = new FixedStepper();
  readonly limiter = new FrameLimiter();
  readonly dynamicResolution: DynamicResolution;
  /** Display refresh interval (ms), measured at start-up. */
  refreshMs = 1000 / 60;
  /** Seconds since start (simulation time, advanced in fixed steps). */
  simTime = 0;
  private readonly updates: FrameCallback[] = [];
  private readonly fixedUpdates: FrameCallback[] = [];
  private readonly exposureListeners: ((exposure: number) => void)[] = [];
  private readonly qualityListeners: ((q: Quality) => void)[] = [];
  private readonly toastEl: HTMLDivElement;
  private toastTimer = 0;
  private lastFrame = -1;
  private readyFrames = -1;
  private readingsSinceReady = 0;
  /** Frames rendered after markReady() before tools may capture (?frames=). */
  private readonly readyAfter = Math.max(4, paramNum('frames', 32));
  private framesRendered = 0;
  private startedAt = 0;
  private screenshotRequested = false;
  private gpuPending = false;
  /** Latest GPU frame time (ms) the timestamp queries reported, or -1. */
  private lastGpuMs = -1;
  private readonly sceneScaleOverride: number;
  private readonly taa: boolean;

  private constructor(
    readonly renderer: WebGPURenderer,
    readonly backend: BackendName,
    readonly gpu: { renderer: string; kind: string },
    readonly fallbackReason: string,
    readonly gpuTimer: boolean,
    container: HTMLElement,
    choice: QualityChoice,
  ) {
    this.quality = choice.quality;
    this.qualityReason = choice.reason;
    renderer.toneMapping = AgXToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.info.autoReset = false;
    if (backend === 'WebGPU') renderer.lighting = new ClusteredLighting(CLUSTERED_CAPACITY);
    container.appendChild(renderer.domElement);

    this.input = new Input(renderer.domElement, !isCapture);
    this.fly = new FlyCamera(this.camera);
    this.lamps = new LightPool(this.poolSize(this.quality));
    this.scene.add(this.lamps.group);
    this.frameGraph = new FrameGraph(renderer, this.scene, this.camera);
    this.taa = paramBool('taa', true);
    this.sceneScaleOverride = paramNum('scale', 0);
    this.dynamicResolution = new DynamicResolution(1, 1);
    this.dynamicResolution.enabled = paramBool('dynres', loadPref('dynres') === '1');
    this.limiter.cap = paramNum('fps', Number(loadPref('fpsCap') ?? 0) || 0);

    this.overlay = new StatsOverlay(this.stats);
    this.overlay.addProvider(() => this.overlayLines());

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    document.body.appendChild(this.toastEl);
    if (isCapture) document.body.classList.add('capture');

    window.addEventListener('resize', () => this.resize());
    this.applyQuality();
    this.resize();
    markStarting(this.quality.name);
  }

  /** Creates the renderer (WebGPU, or WebGL 2) and the engine. ?backend=webgl|webgpu picks one. */
  static async create(container: HTMLElement): Promise<Engine> {
    const param = paramStr('backend', 'auto');
    let engine: Engine | null = null;
    // Measured while the GPU device starts up: the main thread is idle then, so frame
    // callbacks arrive at the display's rate (shader compiles later would slow them).
    const refresh = measureRefreshMs();
    const setup = await createRenderer(isBackendChoice(param) ? param : 'auto', (message) => engine?.deviceLost(message));
    engine = new Engine(setup.renderer, setup.backend, setup.gpu, setup.fallbackReason, setup.gpuTimer, container, initialQuality(setup.gpu));
    engine.refreshMs = await refresh;
    if (setup.fallbackReason && setup.backend !== 'WebGPU') console.warn(`Engine: running on WebGL 2 (${setup.fallbackReason}).`);
    return engine;
  }

  /** Runs every rendered frame before rendering; dt in seconds (capped at 0.1). */
  onUpdate(fn: FrameCallback): void {
    this.updates.push(fn);
  }

  /** Runs at a fixed 120 Hz, independent of the frame rate; dt is always 1/120 s. */
  onFixedUpdate(fn: FrameCallback): void {
    this.fixedUpdates.push(fn);
  }

  /** Runs every frame once this frame's exposure is known, before rendering (scale custom lights with it). */
  onExposure(fn: (exposure: number) => void): void {
    this.exposureListeners.push(fn);
  }

  onQualityChange(fn: (q: Quality) => void): void {
    this.qualityListeners.push(fn);
  }

  /** Compiles every shader in the scene before the first frame (behind the loading screen). */
  async warmUp(): Promise<void> {
    await this.renderer.compileAsync(this.scene, this.camera);
  }

  start(): void {
    this.startedAt = performance.now();
    void this.renderer.setAnimationLoop((t: number) => this.frame(t));
  }

  /** Marks the page as loaded: tools take their screenshot a few frames later. */
  markReady(): void {
    this.readyFrames = 0;
  }

  toast(text: string, ms = 1800): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.applyQuality();
  }

  private frame(now: number): void {
    if (!this.limiter.shouldRender(now)) return;
    const cpuStart = performance.now();
    const frameMs = this.lastFrame < 0 ? this.refreshMs : now - this.lastFrame;
    this.lastFrame = now;
    const dt = Math.min(frameMs / 1000, 0.1);

    this.handleKeys();
    this.fly.update(dt, this.input);
    const steps = this.stepper.advance(dt);
    for (let s = 0; s < steps; s++) {
      this.simTime += this.stepper.step;
      for (const fn of this.fixedUpdates) fn(this.stepper.step, this);
    }
    for (const fn of this.updates) fn(dt, this);

    // Exposure first: every light and glowing surface is scaled by it.
    this.eye.update(dt);
    const exposure = this.eye.exposure;
    exposureNode.value = exposure;
    this.lights.apply(exposure);
    this.lamps.update(this.camera.position, exposure);
    for (const fn of this.exposureListeners) fn(exposure);

    this.renderer.info.reset();
    this.frameGraph.render();
    this.frameGraph.meterExposure(exposure, (nits) => {
      this.eye.measure(nits);
      // Behind the loading screen (and for screenshots) the exposure jumps straight to the target.
      if (!window.__READY) this.eye.snap();
      if (this.readyFrames >= 0) this.readingsSinceReady++;
    });
    if (this.screenshotRequested) {
      this.screenshotRequested = false;
      this.saveScreenshot();
    }
    this.input.endFrame();

    this.stats.push(frameMs, performance.now() - cpuStart);
    this.readGpuTime();
    this.updateResolution(now / 1000);
    this.overlay.update(now);
    const info = this.renderer.info.render;
    // Shader programs aren't counted by this renderer's info.
    window.__STATS = { calls: info.drawCalls, triangles: info.triangles, programs: 0 };
    this.framesRendered++;
    if (this.framesRendered > 30 && now - this.startedAt > 6000) markRunning();
    // Tools wait for the TAAU history to fill and for exposure readings of the finished scene.
    if (this.readyFrames >= 0 && ++this.readyFrames >= this.readyAfter && this.readingsSinceReady >= 3) {
      if (!window.__READY) {
        window.__READY = true;
        if (isCapture) void this.renderer.setAnimationLoop(null);
      }
    }
  }

  private readGpuTime(): void {
    if (!this.gpuTimer || this.gpuPending) return;
    this.gpuPending = true;
    Promise.all([this.renderer.resolveTimestampsAsync('render'), this.renderer.resolveTimestampsAsync('compute')])
      .then(([render, compute]) => {
        const ms = (Number(render) || 0) + (Number(compute) || 0);
        if (ms > 0) {
          this.stats.setGpu(ms);
          this.lastGpuMs = ms;
        }
      })
      .catch(() => undefined)
      .finally(() => (this.gpuPending = false));
  }

  /**
   * Dynamic resolution aims the GPU time at the frame-rate cap, or the display's refresh rate.
   * It needs GPU timings: frame times alone can't tell a busy GPU from waiting for the display.
   */
  private updateResolution(now: number): void {
    const budget = this.limiter.cap > 0 ? 1000 / this.limiter.cap : this.refreshMs;
    if (this.dynamicResolution.update(this.lastGpuMs, budget, now)) {
      this.frameGraph.setSceneScale(this.dynamicResolution.scale);
    }
  }

  private handleKeys(): void {
    const i = this.input;
    if (i.wasPressed('F3')) this.overlay.toggle();
    if (i.wasPressed('F2')) this.screenshotRequested = true;
    if (i.wasPressed('KeyO')) {
      this.setQuality(nextQuality(this.quality));
      this.toast(`Quality: ${this.quality.name}`);
    }
    if (i.wasPressed('KeyL')) {
      this.limiter.cap = nextFpsCap(this.limiter.cap);
      savePref('fpsCap', String(this.limiter.cap));
      this.toast(this.limiter.cap ? `Frame-rate cap: ${this.limiter.cap} fps` : 'Frame-rate cap: off');
    }
    if (i.wasPressed('KeyY')) {
      this.dynamicResolution.enabled = !this.dynamicResolution.enabled;
      savePref('dynres', this.dynamicResolution.enabled ? '1' : '0');
      const note = this.dynamicResolution.enabled && !this.gpuTimer ? ' (needs GPU timing, which this browser does not report)' : '';
      this.toast(`Dynamic resolution: ${this.dynamicResolution.enabled ? 'on' : 'off'}${note}`, note ? 4000 : 1800);
    }
  }

  private poolSize(q: Quality): number {
    return this.backend === 'WebGPU' ? Math.min(q.maxLights, CLUSTERED_CAPACITY) : Math.min(q.maxLights, WEBGL_MAX_LIGHTS);
  }

  private applyQuality(): void {
    const q = this.quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio));
    this.camera.far = q.drawDistance;
    this.camera.updateProjectionMatrix();
    this.lamps.resize(this.poolSize(q));
    const scale = this.sceneScaleOverride > 0 ? Math.min(2, Math.max(0.25, this.sceneScaleOverride)) : q.sceneScale;
    this.dynamicResolution.setRange(Math.min(q.minSceneScale, scale), scale);
    const settings: FrameGraphSettings = {
      taa: this.taa,
      aoScale: q.ao && paramBool('ao', true) ? (q.name === 'medium' || q.name === 'high' ? 0.5 : 1) : 0,
      bloom: q.bloom && paramBool('bloom', true),
    };
    this.frameGraph.configure(settings, this.dynamicResolution.scale);
    for (const fn of this.qualityListeners) fn(q);
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera.updateProjectionMatrix();
  }

  private overlayLines(): string[] {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const scale = this.frameGraph.scale;
    const info = r.info;
    const mem = info.memory as { total?: number };
    const e = this.eye;
    return [
      `${this.backend}${this.fallbackReason ? ` (${this.fallbackReason})` : ''}   gpu ${this.gpu.kind}: ${this.gpu.renderer.slice(0, 70)}`,
      `quality ${this.quality.name}   output ${size.x}×${size.y}   scene ${Math.round(size.x * scale)}×${Math.round(size.y * scale)} (${Math.round(scale * 100)}%${this.dynamicResolution.enabled ? ' dynamic' : ''})   cap ${this.limiter.cap || 'off'}`,
      `EV100 ${e.ev100.toFixed(2)} → ${e.targetEv100.toFixed(2)}   scene ${formatNits(e.luminance)}   refresh ${(1000 / this.refreshMs).toFixed(0)} Hz`,
      `draw calls ${info.render.drawCalls}   triangles ${(info.render.triangles / 1e6).toFixed(2)} M   early-z ${this.frameGraph.scenePass.earlyZ ? 'on' : 'off'}   lamps ${this.lamps.active}/${this.lamps.size} of ${this.lamps.count}${this.backend === 'WebGPU' ? ' (clustered)' : ''}`,
      `GPU memory ${mem.total ? (mem.total / 1048576).toFixed(0) + ' MB' : 'n/a'}   geometries ${info.memory.geometries}   textures ${info.memory.textures}`,
    ];
  }

  private deviceLost(message: string): void {
    void this.renderer.setAnimationLoop(null);
    markFailed(this.quality.name);
    const lower = lowerQuality(this.quality);
    const box = document.createElement('div');
    box.className = 'gpu-lost';
    const inner = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = 'The graphics driver stopped responding';
    const text = document.createElement('p');
    text.textContent = `The browser lost the GPU device (${message}), usually because it ran out of memory or a frame took too long. The game will start at a lower quality next time.`;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Restart at ${lower.name} quality`;
    button.addEventListener('click', () => {
      savePref('quality', lower.name);
      location.reload();
    });
    inner.append(title, text, button);
    box.append(inner);
    document.body.appendChild(box);
  }

  private saveScreenshot(): void {
    // Same task as the render, so the WebGPU canvas still holds this frame.
    const url = this.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `solmar-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    a.click();
    this.toast('Screenshot saved');
  }
}

function formatNits(l: number): string {
  if (l < 0) return '…';
  return l >= 100 ? `${l.toFixed(0)} nits` : l >= 1 ? `${l.toFixed(1)} nits` : `${l.toPrecision(2)} nits`;
}

/** The display's refresh interval (ms): median of a few frame callbacks before the scene is heavy. */
function measureRefreshMs(frames = 24): Promise<number> {
  return new Promise((resolve) => {
    const deltas: number[] = [];
    let last = -1;
    const tick = (t: number): void => {
      if (last >= 0) deltas.push(t - last);
      last = t;
      if (deltas.length < frames) requestAnimationFrame(tick);
      else {
        deltas.sort((a, b) => a - b);
        resolve(Math.max(1, deltas[deltas.length >> 1]));
      }
    };
    requestAnimationFrame(tick);
    // Hidden tabs get no frame callbacks: assume 60 Hz rather than wait.
    setTimeout(() => resolve(1000 / 60), 1500);
  });
}
