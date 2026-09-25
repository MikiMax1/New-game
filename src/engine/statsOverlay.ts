// F3 performance overlay: frame rate, 1% low, frame, CPU and GPU times, a frame-time graph and
// extra lines from providers (backend, exposure, lights, draw calls...).
//
// The text refreshes 4 times a second; the graph redraws every frame while the overlay is
// visible, straight from the FrameStats ring buffer, without allocating. Hidden, update() costs
// one branch.
import type { FrameStats } from './frameStats';

type Provider = () => string | string[];

/** Frames in the graph: 1 s at 240 fps, 4 s at 60 fps. */
const GRAPH_FRAMES = 240;
/** Text refresh interval (ms). */
const TEXT_INTERVAL = 250;
/** Averages cover about the last second; the 1% low and the worst frame need more frames, so they use the whole history. */
const AVERAGE_MS = 1000;
/** Graph y-axis tops (ms): the smallest one that fits every frame shown. */
const Y_TOPS = [8, 17, 33, 50, 100];
const Y_LABELS = Y_TOPS.map((ms) => `${ms} ms`);
/** Dashed guides, slowest first: 60, 144 and 240 fps. */
const GUIDE_MS = [1000 / 60, 1000 / 144, 1000 / 240];
const GUIDE_LABELS = ['60 fps', '144 fps', '240 fps'];
/** Bars under FAST_MS (240 fps) are good, under OK_MS (60 fps) fair, slower ones bad. */
const FAST_MS = 4.2;
const OK_MS = 16.7;
/** Layout in CSS px (scaled by the device pixel ratio). */
const PAD = 4;
const FONT_PX = 10;
const DASH = [4, 3];
const NO_DASH: number[] = [];

const COLORS = {
  plot: 'rgba(0, 0, 0, 0.35)',
  // Status colours for the bars; two distinct categorical hues for the lines.
  fast: '#0ca30c',
  ok: '#fab219',
  slow: '#d03b3b',
  cpu: '#3987e5',
  gpu: '#d55181',
  // Dark ring under lines and labels so they read on top of the bars.
  ring: 'rgba(8, 10, 12, 0.9)',
  guide: 'rgba(255, 255, 255, 0.55)',
  label: '#c3c2b7',
  muted: '#9a988f',
};

export class StatsOverlay {
  private readonly el: HTMLDivElement;
  private readonly summaryEl: HTMLDivElement;
  private readonly linesEl: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly providers: Provider[] = [];
  private shown = false;
  private lastText = -Infinity;
  /** Canvas pixels per CSS pixel. */
  private dpr = 1;
  /** Label widths (canvas px), measured when the canvas is sized. */
  private legendLabelW = 0;
  private readonly topLabelW = new Float64Array(Y_TOPS.length);
  /** Guide line positions (canvas px) in the current frame, -1 when left out. */
  private readonly guideY = new Float64Array(GUIDE_MS.length);

  constructor(
    private readonly stats: FrameStats,
    parent: HTMLElement = document.body,
  ) {
    this.el = document.createElement('div');
    // .debug-overlay: the shared panel look, hidden in capture mode.
    this.el.className = 'debug-overlay stats-overlay';
    this.el.hidden = true;
    this.summaryEl = document.createElement('div');
    this.summaryEl.className = 'stats-text';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stats-graph';
    this.linesEl = document.createElement('div');
    this.linesEl.className = 'stats-text';
    this.el.append(this.summaryEl, this.canvas, this.linesEl);
    this.ctx = this.canvas.getContext('2d');
    parent.appendChild(this.el);
  }

  get visible(): boolean {
    return this.shown;
  }

  toggle(): void {
    this.shown = !this.shown;
    this.el.hidden = !this.shown;
    this.lastText = -Infinity;
  }

  /** Extra lines (backend, exposure, lights, draw calls...), re-evaluated on each text refresh. */
  addProvider(fn: Provider): void {
    this.providers.push(fn);
  }

  /** Call once per rendered frame after FrameStats.push; `now` in ms. */
  update(now: number): void {
    if (!this.shown) return;
    if (now - this.lastText >= TEXT_INTERVAL) {
      this.lastText = now;
      // Size first: reading the layout before the text changes it avoids a forced reflow.
      this.fitCanvas();
      this.refreshText();
    }
    this.drawGraph();
  }

  dispose(): void {
    this.shown = false;
    this.providers.length = 0;
    this.el.remove();
  }

  private refreshText(): void {
    const s = this.stats;
    const recent = s.summary(this.framesWithin(AVERAGE_MS));
    const all = s.summary();
    const gpu = recent.gpuMs >= 0 ? `${recent.gpuMs.toFixed(2)} ms` : 'n/a';
    this.summaryEl.textContent =
      `FPS ${recent.fps.toFixed(0)}   1% low ${all.low1.toFixed(0)}   ` +
      `frame ${recent.frameMs.toFixed(2)} ms (worst ${all.worstMs.toFixed(1)})   ` +
      `CPU ${recent.cpuMs.toFixed(2)} ms   GPU ${gpu}`;
    const lines: string[] = [];
    for (const p of this.providers) {
      const r = p();
      if (Array.isArray(r)) lines.push(...r);
      else lines.push(r);
    }
    this.linesEl.textContent = lines.join('\n');
    this.linesEl.hidden = lines.length === 0;
  }

  /** Newest frames adding up to about `ms` (all kept frames if fewer). */
  private framesWithin(ms: number): number {
    const s = this.stats;
    let t = 0;
    let n = 0;
    while (n < s.count && t < ms) t += s.recent(s.frameMs, n++);
    return n;
  }

  /** Matches the canvas to its CSS size times the pixel ratio, so the graph stays crisp on HiDPI screens. */
  private fitCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (w === this.canvas.width && h === this.canvas.height && dpr === this.dpr) return;
    this.dpr = dpr;
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.ctx;
    if (!ctx) return;
    // Resizing resets the context state.
    ctx.font = `${Math.round(FONT_PX * dpr)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.lineJoin = 'round';
    this.legendLabelW = ctx.measureText('GPU').width;
    for (let i = 0; i < Y_LABELS.length; i++) this.topLabelW[i] = ctx.measureText(Y_LABELS[i]).width;
  }

  private drawGraph(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!ctx || w === 0 || h === 0) return;
    const s = this.stats;
    const n = Math.min(GRAPH_FRAMES, s.count);
    const dpr = this.dpr;

    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, s.recent(s.frameMs, i), s.recent(s.cpuMs, i), s.recent(s.gpuMs, i));
    let top = 0;
    while (top < Y_TOPS.length - 1 && Y_TOPS[top] < peak) top++;
    const topMs = Y_TOPS[top];
    const yScale = h / topMs;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.plot;
    ctx.fillRect(0, 0, w, h);

    this.bars(n, 0, FAST_MS, COLORS.fast, topMs, yScale);
    this.bars(n, FAST_MS, OK_MS, COLORS.ok, topMs, yScale);
    this.bars(n, OK_MS, Infinity, COLORS.slow, topMs, yScale);

    // Guides, slowest first. On a tall axis the faster ones bunch up at the bottom: a guide
    // closer than a label's height to the next slower one is left out.
    const pad = PAD * dpr;
    const labelH = (FONT_PX + 2) * dpr;
    const guideW = Math.max(1, Math.round(dpr));
    // Whole-pixel lines, offset half a pixel when odd-width, stay sharp.
    const offset = guideW % 2 ? 0.5 : 0;
    let prevY = -Infinity;
    for (let g = 0; g < GUIDE_MS.length; g++) {
      const y = Math.round(h - GUIDE_MS[g] * yScale) + offset;
      const inside = GUIDE_MS[g] < topMs;
      this.guideY[g] = inside && y - prevY >= labelH ? y : -1;
      if (inside) prevY = y;
    }
    ctx.setLineDash(DASH);
    ctx.lineWidth = guideW;
    ctx.strokeStyle = COLORS.guide;
    ctx.beginPath();
    for (let g = 0; g < GUIDE_MS.length; g++) {
      if (this.guideY[g] < 0) continue;
      ctx.moveTo(0, this.guideY[g]);
      ctx.lineTo(w, this.guideY[g]);
    }
    ctx.stroke();
    ctx.setLineDash(NO_DASH);

    this.line(s.cpuMs, n, COLORS.cpu, yScale);
    this.line(s.gpuMs, n, COLORS.gpu, yScale);

    // Guide labels at the left edge: above the line, or below it when there is no room.
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = COLORS.ring;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    let taken = 0;
    for (let g = 0; g < GUIDE_MS.length; g++) {
      const y = this.guideY[g];
      if (y < 0) continue;
      const bottom = y - 2 * dpr - labelH >= taken ? y - 2 * dpr : y + 2 * dpr + labelH;
      if (bottom - labelH < taken || bottom > h) continue;
      this.label(GUIDE_LABELS[g], pad, bottom, COLORS.label);
      taken = bottom;
    }
    // Legend and the axis top at the top right.
    ctx.textBaseline = 'top';
    const swatch = 10 * dpr;
    const gap = 4 * dpr;
    let x = w - pad - this.topLabelW[top];
    this.label(Y_LABELS[top], x, pad, COLORS.muted);
    x -= 3 * gap + this.legendLabelW;
    this.label('GPU', x, pad, COLORS.label);
    x -= gap + swatch;
    this.swatch(x, pad + labelH / 2 - dpr, swatch, COLORS.gpu);
    x -= 3 * gap + this.legendLabelW;
    this.label('CPU', x, pad, COLORS.label);
    x -= gap + swatch;
    this.swatch(x, pad + labelH / 2 - dpr, swatch, COLORS.cpu);
  }

  /** Bars for the frames whose time is in [lo, hi), newest on the right, clipped at the top. */
  private bars(n: number, lo: number, hi: number, color: string, topMs: number, yScale: number): void {
    const ctx = this.ctx!;
    const s = this.stats;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const f = s.recent(s.frameMs, i);
      if (f < lo || f >= hi) continue;
      // Whole-pixel edges: no blurred seams between neighbouring bars.
      const col = GRAPH_FRAMES - 1 - i;
      const x0 = Math.round((col * w) / GRAPH_FRAMES);
      const x1 = Math.round(((col + 1) * w) / GRAPH_FRAMES);
      const y = Math.round(h - Math.min(f, topMs) * yScale);
      ctx.rect(x0, y, x1 - x0, h - y);
    }
    ctx.fill();
  }

  /** A time series as a 2 px line on a dark ring; unknown values (< 0) are bridged. */
  private line(series: Float32Array, n: number, color: string, yScale: number): void {
    const ctx = this.ctx!;
    const s = this.stats;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const dpr = this.dpr;
    ctx.beginPath();
    let started = false;
    for (let i = n - 1; i >= 0; i--) {
      const v = s.recent(series, i);
      if (v < 0) continue;
      const x = ((GRAPH_FRAMES - 0.5 - i) * w) / GRAPH_FRAMES;
      const y = Math.min(h - dpr, Math.max(dpr, h - v * yScale));
      if (started) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      started = true;
    }
    if (!started) return;
    ctx.lineWidth = 4 * dpr;
    ctx.strokeStyle = COLORS.ring;
    ctx.stroke();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  /** Text on a dark ring (the caller sets the ring's stroke style, width, alignment and baseline). */
  private label(text: string, x: number, y: number, color: string): void {
    const ctx = this.ctx!;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  private swatch(x: number, y: number, width: number, color: string): void {
    const ctx = this.ctx!;
    ctx.fillStyle = COLORS.ring;
    ctx.fillRect(x - this.dpr, y - this.dpr, width + 2 * this.dpr, 4 * this.dpr);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, 2 * this.dpr);
  }
}
