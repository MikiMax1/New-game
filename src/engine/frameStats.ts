// Rolling frame statistics for the F3 overlay and for tools: average and 1%-low frame rate,
// CPU time (JavaScript work per frame) and GPU time (timestamp queries, when available).

/** Frames kept for the statistics: about 4 s at 240 fps, 17 s at 60 fps. */
export const HISTORY = 1000;

export interface FrameSummary {
  /** Frames in the window. */
  frames: number;
  fps: number;
  /** Frame rate of the slowest 1% of frames (99th-percentile frame time). */
  low1: number;
  frameMs: number;
  worstMs: number;
  cpuMs: number;
  /** Average GPU time per frame, or -1 when the backend can't measure it. */
  gpuMs: number;
}

export class FrameStats {
  /** Frame-to-frame times (ms), CPU times (ms) and GPU times (ms, -1 = unknown). */
  readonly frameMs = new Float32Array(HISTORY);
  readonly cpuMs = new Float32Array(HISTORY);
  readonly gpuMs = new Float32Array(HISTORY).fill(-1);
  /** Index of the next write. */
  head = 0;
  count = 0;
  private readonly sorted = new Float32Array(HISTORY);

  /** Records a frame: time since the previous frame and the CPU time spent on this one. */
  push(frameMs: number, cpuMs: number): void {
    this.frameMs[this.head] = frameMs;
    this.cpuMs[this.head] = cpuMs;
    this.gpuMs[this.head] = -1;
    this.head = (this.head + 1) % HISTORY;
    this.count = Math.min(HISTORY, this.count + 1);
  }

  /** GPU time arrives a few frames late; it is attached to the newest frame. */
  setGpu(ms: number): void {
    if (this.count === 0) return;
    this.gpuMs[(this.head + HISTORY - 1) % HISTORY] = ms;
  }

  /** i-th most recent value of a series (0 = newest). */
  recent(series: Float32Array, i: number): number {
    return series[(this.head + HISTORY - 1 - i) % HISTORY];
  }

  /** Summary over the newest `window` frames (default: all kept frames). */
  summary(window = HISTORY): FrameSummary {
    const n = Math.min(window, this.count);
    if (n === 0) return { frames: 0, fps: 0, low1: 0, frameMs: 0, worstMs: 0, cpuMs: 0, gpuMs: -1 };
    let sum = 0;
    let cpu = 0;
    let worst = 0;
    let gpu = 0;
    let gpuN = 0;
    for (let i = 0; i < n; i++) {
      const f = this.recent(this.frameMs, i);
      sum += f;
      worst = Math.max(worst, f);
      cpu += this.recent(this.cpuMs, i);
      const g = this.recent(this.gpuMs, i);
      if (g >= 0) {
        gpu += g;
        gpuN++;
      }
      this.sorted[i] = f;
    }
    const sorted = this.sorted.subarray(0, n).sort();
    const p99 = sorted[Math.min(n - 1, Math.floor(n * 0.99))];
    const avg = sum / n;
    return {
      frames: n,
      fps: avg > 0 ? 1000 / avg : 0,
      low1: p99 > 0 ? 1000 / p99 : 0,
      frameMs: avg,
      worstMs: worst,
      cpuMs: cpu / n,
      gpuMs: gpuN ? gpu / gpuN : -1,
    };
  }
}
