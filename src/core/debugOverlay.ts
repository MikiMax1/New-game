import type * as THREE from 'three';

type Provider = () => string | string[];

/** F3 performance overlay: fps, frame times, draw calls, triangles, memory and custom lines. */
export class DebugOverlay {
  private readonly el: HTMLDivElement;
  private visible = false;
  private frames = 0;
  private accum = 0;
  private worst = 0;
  private lastUpdate = 0;
  private readonly providers: Provider[] = [];
  private calls = 0;
  private triangles = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.el = document.createElement('div');
    this.el.className = 'debug-overlay';
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  addProvider(p: Provider): void {
    this.providers.push(p);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
  }

  /** Call after all rendering for the frame is done (renderer.info.autoReset must be false). */
  frame(dtMs: number): void {
    this.frames++;
    this.accum += dtMs;
    this.worst = Math.max(this.worst, dtMs);
    this.calls = this.renderer.info.render.calls;
    this.triangles = this.renderer.info.render.triangles;
    const now = performance.now();
    if (!this.visible || now - this.lastUpdate < 250) return;
    const avg = this.accum / Math.max(1, this.frames);
    const info = this.renderer.info;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const lines = [
      `FPS ${(1000 / avg).toFixed(0)}   ${avg.toFixed(1)} ms avg   ${this.worst.toFixed(1)} ms worst`,
      `draw calls ${this.calls}   triangles ${(this.triangles / 1e6).toFixed(2)} M`,
      `geometries ${info.memory.geometries}   textures ${info.memory.textures}   programs ${info.programs?.length ?? 0}`,
    ];
    if (mem) lines.push(`JS heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB`);
    for (const p of this.providers) {
      const r = p();
      if (Array.isArray(r)) lines.push(...r);
      else lines.push(r);
    }
    this.el.textContent = lines.join('\n');
    this.frames = 0;
    this.accum = 0;
    this.worst = 0;
    this.lastUpdate = now;
  }

  get stats(): { calls: number; triangles: number } {
    return { calls: this.calls, triangles: this.triangles };
  }
}
