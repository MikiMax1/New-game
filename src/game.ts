import * as THREE from 'three';
import { DebugOverlay } from './core/debugOverlay';
import { FlyCamera } from './core/flyCamera';
import { Input } from './core/input';
import { isCapture, paramNum, paramNums } from './core/params';
import { initialQuality, nextQuality, type Quality } from './core/quality';
import { BasicEnvironment, type Environment } from './render/basicEnvironment';

declare global {
  interface Window {
    /** Set when the world is loaded and a few frames have rendered (used by tools/shoot.mjs). */
    __READY?: boolean;
    /** Frame statistics for tools. */
    __STATS?: { calls: number; triangles: number };
  }
}

/** Something updated every frame (world streaming, traffic, UI...). */
export interface Updatable {
  update(dt: number, game: Game): void;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  readonly fly: FlyCamera;
  readonly overlay: DebugOverlay;
  environment: Environment;
  quality: Quality;
  /** Custom render function (post-processing); defaults to a plain render. */
  renderFn: (() => void) | null = null;
  private readonly updatables: Updatable[] = [];
  private readonly timer = new THREE.Timer();
  private readyFrames = -1;
  private screenshotRequested = false;
  private toastEl: HTMLDivElement;
  private toastTimer = 0;
  private readonly qualityListeners: ((q: Quality) => void)[] = [];

  constructor(container: HTMLElement) {
    this.quality = initialQuality();
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, this.quality.drawDistance);
    this.input = new Input(this.renderer.domElement, !isCapture);
    this.fly = new FlyCamera(this.camera);
    this.overlay = new DebugOverlay(this.renderer);
    this.environment = new BasicEnvironment(this.scene, paramNum('time', 16.5));

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    document.body.appendChild(this.toastEl);
    if (isCapture) document.body.classList.add('capture');

    this.overlay.addProvider(() => {
      const p = this.camera.position;
      const heading = ((-THREE.MathUtils.radToDeg(this.fly.yaw) % 360) + 360) % 360;
      const h = Math.floor(this.environment.timeOfDay);
      const m = Math.floor((this.environment.timeOfDay - h) * 60);
      return [
        `pos ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}   heading ${heading.toFixed(0)}°   speed ${this.fly.speed.toFixed(0)} m/s`,
        `time ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}   quality ${this.quality.name}   near ${this.camera.near.toFixed(2)}`,
      ];
    });

    this.applyQuality();
    window.addEventListener('resize', () => this.resize());
    this.resize();

    // Initial camera: ?cam=x,y,z&look=x,y,z, or a default overview.
    const cam = paramNums('cam');
    const look = paramNums('look');
    const pos = cam && cam.length === 3 ? new THREE.Vector3(cam[0], cam[1], cam[2]) : new THREE.Vector3(0, 120, 300);
    const target = look && look.length === 3 ? new THREE.Vector3(look[0], look[1], look[2]) : new THREE.Vector3(0, 0, 0);
    this.fly.lookAt(pos, target);
  }

  add(u: Updatable): void {
    this.updatables.push(u);
  }

  onQualityChange(fn: (q: Quality) => void): void {
    this.qualityListeners.push(fn);
  }

  setEnvironment(env: Environment): void {
    const time = this.environment.timeOfDay;
    this.environment.dispose();
    this.environment = env;
    env.timeOfDay = time;
  }

  /** Mark the game as loaded: tools take their screenshot a few frames later. */
  markReady(): void {
    this.readyFrames = 0;
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1800);
  }

  start(): void {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.handleKeys(dt);
    this.fly.update(dt, this.input);
    for (const u of this.updatables) u.update(dt, this);
    this.environment.update(dt, this.camera);

    this.renderer.info.reset();
    if (this.renderFn) this.renderFn();
    else this.renderer.render(this.scene, this.camera);

    if (this.screenshotRequested) {
      this.screenshotRequested = false;
      this.saveScreenshot();
    }
    this.overlay.frame(dt * 1000);
    window.__STATS = this.overlay.stats;
    this.input.endFrame();

    if (this.readyFrames >= 0 && ++this.readyFrames === 4) {
      window.__READY = true;
      // Screenshot tools only need this frame; stop rendering so the capture is quick.
      if (isCapture) this.renderer.setAnimationLoop(null);
    }
  }

  private handleKeys(dt: number): void {
    const i = this.input;
    if (i.wasPressed('F3')) this.overlay.toggle();
    if (i.wasPressed('F2')) this.screenshotRequested = true;
    if (i.wasPressed('KeyO')) {
      this.quality = nextQuality(this.quality);
      this.applyQuality();
      this.toast(`Quality: ${this.quality.name}`);
    }
    // Time of day: [ and ] step an hour, hold T to fast-forward.
    const env = this.environment;
    if (i.wasPressed('BracketRight')) env.timeOfDay = (env.timeOfDay + 1) % 24;
    if (i.wasPressed('BracketLeft')) env.timeOfDay = (env.timeOfDay + 23) % 24;
    if (i.isDown('KeyT')) env.timeOfDay = (env.timeOfDay + dt * 2) % 24;
  }

  private applyQuality(): void {
    const q = this.quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio) * q.renderScale);
    this.renderer.shadowMap.enabled = q.shadows;
    this.camera.far = q.drawDistance;
    this.camera.updateProjectionMatrix();
    for (const fn of this.qualityListeners) fn(q);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const fn of this.qualityListeners) fn(this.quality);
  }

  private saveScreenshot(): void {
    const url = this.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `solmar-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    a.click();
    this.toast('Screenshot saved');
  }
}
