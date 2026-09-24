// Low-level helpers for procedural textures: canvases (DOM or OffscreenCanvas), colour
// strings, tileable noise, and conversion to three.js textures.

import * as THREE from 'three';
import { Rng } from '../../world/rng';

export type Ctx = CanvasRenderingContext2D;
export interface Canvas {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: Ctx;
  w: number;
  h: number;
}

/** True where a 2D canvas can be created (browser main thread or worker). */
export function canPaint(): boolean {
  return typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined';
}

export function createCanvas(w: number, h: number): Canvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return { canvas: c, ctx: c.getContext('2d', { willReadFrequently: true })!, w, h };
  }
  const c = new OffscreenCanvas(w, h);
  return { canvas: c, ctx: c.getContext('2d', { willReadFrequently: true }) as unknown as Ctx, w, h };
}

export function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h.toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%, ${a})`;
}

/** Periodic value noise on a gx x gy lattice, sampled in [0,1)^2 (tiles seamlessly). */
export class TileNoise {
  private readonly v: Float32Array;
  constructor(readonly gx: number, readonly gy: number, rng: Rng) {
    this.v = new Float32Array(gx * gy);
    for (let i = 0; i < this.v.length; i++) this.v[i] = rng.next();
  }
  sample(x: number, y: number): number {
    const fx = (((x % 1) + 1) % 1) * this.gx;
    const fy = (((y % 1) + 1) % 1) * this.gy;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const x1 = (x0 + 1) % this.gx, y1 = (y0 + 1) % this.gy;
    const a = this.v[y0 * this.gx + x0], b = this.v[y0 * this.gx + x1];
    const c = this.v[y1 * this.gx + x0], d = this.v[y1 * this.gx + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
}

/** Tileable fBm in [0, 1] from several TileNoise octaves (frequencies base * 2^i per axis). */
export class TileFbm {
  private readonly layers: TileNoise[] = [];
  constructor(gx: number, gy: number, octaves: number, rng: Rng, private readonly gain = 0.5) {
    for (let i = 0; i < octaves; i++) this.layers.push(new TileNoise(gx << i, gy << i, rng));
  }
  sample(x: number, y: number): number {
    let sum = 0, amp = 1, norm = 0;
    for (const l of this.layers) {
      sum += l.sample(x, y) * amp;
      norm += amp;
      amp *= this.gain;
    }
    return sum / norm;
  }
}

/** Fill a pixel rectangle from a per-pixel function returning sRGB 0-255 [r, g, b]. */
export function fillPixels(c: Canvas, x0: number, y0: number, w: number, h: number, fn: (x: number, y: number) => [number, number, number]): void {
  const img = c.ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  c.ctx.putImageData(img, x0, y0);
}

function finishTexture(tex: THREE.Texture, color: boolean, repeat: boolean): THREE.Texture {
  tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Opaque canvas -> texture (canvas top row = v 1). */
export function opaqueTexture(c: Canvas, opts: { color?: boolean; repeat?: boolean; wrapT?: boolean } = {}): THREE.Texture {
  const tex = new THREE.CanvasTexture(c.canvas as HTMLCanvasElement);
  finishTexture(tex, opts.color ?? true, opts.repeat ?? false);
  if (opts.wrapT) tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Alpha-tested canvas -> DataTexture. Transparent texels get the colour of nearby opaque
 * texels (blur-based dilation), so bilinear filtering and mipmaps never pull black into leaf
 * edges. Rows are flipped so the canvas top row is v = 1 (same as CanvasTexture).
 */
export function alphaTexture(c: Canvas, fallback: [number, number, number]): THREE.DataTexture {
  const { w, h } = c;
  const sharp = c.ctx.getImageData(0, 0, w, h).data;
  const soft1 = blurred(c, 3).data;
  const soft2 = blurred(c, 14).data;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = ((h - 1 - y) * w + x) * 4;
      const a = sharp[si + 3];
      let r: number, g: number, b: number;
      if (a >= 48) {
        r = sharp[si]; g = sharp[si + 1]; b = sharp[si + 2];
      } else if (soft1[si + 3] >= 24) {
        r = soft1[si]; g = soft1[si + 1]; b = soft1[si + 2];
      } else if (soft2[si + 3] >= 6) {
        r = soft2[si]; g = soft2[si + 1]; b = soft2[si + 2];
      } else {
        [r, g, b] = fallback;
      }
      out[di] = r; out[di + 1] = g; out[di + 2] = b; out[di + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  finishTexture(tex, true, false);
  return tex;
}

function blurred(c: Canvas, radius: number): ImageData {
  const b = createCanvas(c.w, c.h);
  b.ctx.filter = `blur(${radius}px)`;
  b.ctx.drawImage(c.canvas as HTMLCanvasElement, 0, 0);
  b.ctx.filter = 'none';
  // Stack a few times so thin features spread far enough.
  b.ctx.globalCompositeOperation = 'destination-over';
  b.ctx.filter = `blur(${radius * 2}px)`;
  b.ctx.drawImage(c.canvas as HTMLCanvasElement, 0, 0);
  b.ctx.filter = 'none';
  return b.ctx.getImageData(0, 0, c.w, c.h);
}

/** Tileable greyscale / colour DataTexture from a per-pixel function in [0,1]^2 (u, v). */
export function dataTexture(w: number, h: number, fn: (u: number, v: number) => [number, number, number], opts: { color?: boolean } = {}): THREE.DataTexture {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn((x + 0.5) / w, (y + 0.5) / h);
      const i = (y * w + x) * 4;
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  finishTexture(tex, opts.color ?? true, true);
  return tex;
}

export const clampByte = (x: number): number => (x < 0 ? 0 : x > 255 ? 255 : Math.round(x));

/** Draw a tapered leaf / blade along a quadratic Bezier (base -> tip). */
export function drawBlade(
  ctx: Ctx,
  x0: number, y0: number, cx: number, cy: number, x1: number, y1: number,
  width: number, fill: string | CanvasGradient, opts: { base?: number; widest?: number; steps?: number } = {},
): void {
  const steps = opts.steps ?? 10;
  const baseW = opts.base ?? 0.35;
  const widest = opts.widest ?? 0.2;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const px = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * cx + u * u * x1;
    const py = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * cy + u * u * y1;
    let tx = 2 * (1 - u) * (cx - x0) + 2 * u * (x1 - cx);
    let ty = 2 * (1 - u) * (cy - y0) + 2 * u * (y1 - cy);
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    const wf = u < widest ? baseW + (1 - baseW) * (u / widest) : 1 - Math.pow((u - widest) / (1 - widest), 1.6);
    const hw = (width / 2) * Math.max(0, wf);
    left.push([px - ty * hw, py + tx * hw]);
    right.push([px + ty * hw, py - tx * hw]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}
