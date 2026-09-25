// Dynamic resolution: lowers the 3D render scale when the GPU can't keep up with the target
// frame time and raises it again when there is headroom. The temporal upscaler rebuilds the
// output at full resolution, so a lower scale softens the image instead of dropping frames.

/** Scales are multiples of this step, so the render targets are reallocated rarely. */
export const SCALE_STEP = 0.05;

export class DynamicResolution {
  enabled = false;
  /** Current scale (fraction of the output resolution per axis). */
  scale: number;
  /** Smoothed GPU (or frame) time in ms. */
  smoothedMs = 0;
  private overSince = -1;
  private underSince = -1;
  private lastChange = -Infinity;

  constructor(
    /** Scale when there is headroom (the quality preset's scene scale). */
    public maxScale: number,
    public minScale: number,
  ) {
    this.scale = maxScale;
  }

  setRange(minScale: number, maxScale: number): void {
    this.minScale = Math.min(minScale, maxScale);
    this.maxScale = maxScale;
    this.scale = this.enabled ? clampQuantize(this.scale, this.minScale, this.maxScale) : maxScale;
  }

  /**
   * Feeds one frame's GPU time (ms) and the time budget (ms) at `now` (s). Returns true when
   * the scale changed.
   */
  update(gpuMs: number, budgetMs: number, now: number): boolean {
    if (!this.enabled) {
      if (this.scale !== this.maxScale) {
        this.scale = this.maxScale;
        return true;
      }
      return false;
    }
    if (!(gpuMs > 0) || !(budgetMs > 0)) return false;
    this.smoothedMs = this.smoothedMs > 0 ? this.smoothedMs + (gpuMs - this.smoothedMs) * 0.1 : gpuMs;
    const load = this.smoothedMs / budgetMs;
    this.overSince = load > 0.92 ? (this.overSince < 0 ? now : this.overSince) : -1;
    this.underSince = load < 0.7 ? (this.underSince < 0 ? now : this.underSince) : -1;
    if (now - this.lastChange < 0.75) return false;

    let next = this.scale;
    if (this.overSince >= 0 && now - this.overSince > 0.4) {
      // GPU cost is roughly proportional to the pixel count, i.e. scale squared.
      next = this.scale * Math.sqrt(0.85 / load);
      next = Math.min(next, this.scale - SCALE_STEP);
    } else if (this.underSince >= 0 && now - this.underSince > 2) {
      next = this.scale + SCALE_STEP;
    }
    next = clampQuantize(next, this.minScale, this.maxScale);
    if (next === this.scale) return false;
    // The new scale changes the cost: start the average from the prediction.
    this.smoothedMs *= (next * next) / (this.scale * this.scale);
    this.scale = next;
    this.lastChange = now;
    this.overSince = -1;
    this.underSince = -1;
    return true;
  }
}

function clampQuantize(s: number, min: number, max: number): number {
  const q = Math.round(s / SCALE_STEP) * SCALE_STEP;
  return Math.round(Math.min(max, Math.max(min, q)) * 1000) / 1000;
}
