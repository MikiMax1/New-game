// Physical light intensities and the lamp pool.
//
// Every light is specified in physical units (lux for the sun and moon, candela for lamps) and
// multiplied by the current exposure before rendering (see exposure.ts). ExposedLights keeps the
// physical values; LightPool maps any number of lamps in the world onto a fixed pool of point
// lights, the ones nearest the camera. The pool never changes size, so shaders never recompile
// as the camera moves, and lamps fade in and out at the edge of the pool instead of popping.
import * as THREE from 'three';

/** Lights whose `intensity` is a physical value times the current exposure. */
export class ExposedLights {
  private readonly entries = new Map<THREE.Light, number>();

  /** Registers `light` with a physical intensity (lux for directional lights, candela for point and spot lights). */
  add<T extends THREE.Light>(light: T, physical: number): T {
    this.entries.set(light, physical);
    return light;
  }

  set(light: THREE.Light, physical: number): void {
    this.entries.set(light, physical);
  }

  get(light: THREE.Light): number {
    return this.entries.get(light) ?? 0;
  }

  remove(light: THREE.Light): void {
    this.entries.delete(light);
  }

  apply(exposure: number): void {
    for (const [light, physical] of this.entries) light.intensity = physical * exposure;
  }
}

/**
 * Indices of the `k` points nearest to (cx, cy, cz), nearest first. `out` receives the
 * indices and `outDist2` their squared distances; returns how many were written. Also returns,
 * through `outDist2[k]` when there are more than k points, the squared distance of the nearest
 * point that was left out (the pool's cut-off), or Infinity.
 */
export function selectNearest(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  zs: ArrayLike<number>,
  n: number,
  cx: number,
  cy: number,
  cz: number,
  k: number,
  out: Int32Array,
  outDist2: Float64Array,
  skip?: (i: number) => boolean,
): number {
  // Max-heap of the k best so far, keyed by squared distance.
  let size = 0;
  let cutoff = Infinity;
  for (let i = 0; i < n; i++) {
    if (skip?.(i)) continue;
    const dx = xs[i] - cx;
    const dy = ys[i] - cy;
    const dz = zs[i] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (size < k) {
      // Sift up.
      let j = size++;
      while (j > 0) {
        const p = (j - 1) >> 1;
        if (outDist2[p] >= d) break;
        out[j] = out[p];
        outDist2[j] = outDist2[p];
        j = p;
      }
      out[j] = i;
      outDist2[j] = d;
    } else if (k > 0 && d < outDist2[0]) {
      cutoff = Math.min(cutoff, outDist2[0]);
      // Replace the root and sift down.
      let j = 0;
      for (;;) {
        const l = 2 * j + 1;
        if (l >= k) break;
        const r = l + 1;
        const c = r < k && outDist2[r] > outDist2[l] ? r : l;
        if (outDist2[c] <= d) break;
        out[j] = out[c];
        outDist2[j] = outDist2[c];
        j = c;
      }
      out[j] = i;
      outDist2[j] = d;
    } else {
      cutoff = Math.min(cutoff, d);
    }
  }
  // Heap to ascending order (insertion sort is fine for pool sizes; they're nearly heap-ordered).
  for (let i = 1; i < size; i++) {
    const idx = out[i];
    const d = outDist2[i];
    let j = i - 1;
    while (j >= 0 && outDist2[j] > d) {
      out[j + 1] = out[j];
      outDist2[j + 1] = outDist2[j];
      j--;
    }
    out[j + 1] = idx;
    outDist2[j + 1] = d;
  }
  if (outDist2.length > size) outDist2[size] = cutoff;
  return size;
}

/** Share of the pool radius over which the farthest pooled lamps fade out. */
const FADE_BAND = 0.2;

/**
 * Lamps in the world (street lights, windows, headlights...) shaded through a fixed pool of
 * point lights. Lamps are stored as flat arrays so the pool can hold tens of thousands.
 */
export class LightPool {
  readonly group = new THREE.Group();
  /** Global dimmer applied to every lamp (e.g. street lights switching on at dusk), 0..1. */
  dimmer = 1;
  private lights: THREE.PointLight[] = [];
  private xs = new Float32Array(64);
  private ys = new Float32Array(64);
  private zs = new Float32Array(64);
  private candela = new Float32Array(64);
  private range = new Float32Array(64);
  private colors = new Float32Array(64 * 3);
  private n = 0;
  private selected = new Int32Array(0);
  private dist2 = new Float64Array(1);
  /** Pooled lamps shaded in the last update. */
  active = 0;

  constructor(size: number) {
    this.group.name = 'LightPool';
    this.resize(size);
  }

  get size(): number {
    return this.lights.length;
  }

  get count(): number {
    return this.n;
  }

  /** Changes the pool size (recompiles lit shaders once). */
  resize(size: number): void {
    size = Math.max(0, Math.floor(size));
    if (size === this.lights.length) return;
    while (this.lights.length > size) {
      const l = this.lights.pop()!;
      this.group.remove(l);
      l.dispose();
    }
    while (this.lights.length < size) {
      const l = new THREE.PointLight(0xffffff, 0, 1, 2);
      l.name = `pool-${this.lights.length}`;
      this.lights.push(l);
      this.group.add(l);
    }
    this.selected = new Int32Array(size);
    this.dist2 = new Float64Array(size + 1);
  }

  /** Adds a lamp; returns its index. Intensity in candela, range in metres (0 = unlimited). */
  add(x: number, y: number, z: number, candela: number, color: THREE.ColorRepresentation, range: number): number {
    if (this.n === this.xs.length) this.grow();
    const i = this.n++;
    this.xs[i] = x;
    this.ys[i] = y;
    this.zs[i] = z;
    this.candela[i] = candela;
    this.range[i] = range;
    const c = new THREE.Color(color);
    this.colors[i * 3] = c.r;
    this.colors[i * 3 + 1] = c.g;
    this.colors[i * 3 + 2] = c.b;
    return i;
  }

  setPosition(i: number, x: number, y: number, z: number): void {
    this.xs[i] = x;
    this.ys[i] = y;
    this.zs[i] = z;
  }

  setCandela(i: number, candela: number): void {
    this.candela[i] = candela;
  }

  /** Assigns the pool to the lamps nearest `camera`, with intensities times `exposure`. */
  update(position: THREE.Vector3, exposure: number): void {
    const k = this.lights.length;
    const on = this.dimmer > 0;
    const count = on
      ? selectNearest(this.xs, this.ys, this.zs, this.n, position.x, position.y, position.z, k, this.selected, this.dist2, (i) => this.candela[i] <= 0)
      : 0;
    const cutoff = Math.sqrt(this.dist2[count] ?? Infinity);
    const fadeStart = cutoff * (1 - FADE_BAND);
    let active = 0;
    for (let s = 0; s < k; s++) {
      const light = this.lights[s];
      if (s >= count) {
        light.intensity = 0;
        continue;
      }
      const i = this.selected[s];
      const d = Math.sqrt(this.dist2[s]);
      const fade = Number.isFinite(cutoff) ? 1 - smoothstep(fadeStart, cutoff, d) : 1;
      light.position.set(this.xs[i], this.ys[i], this.zs[i]);
      light.color.setRGB(this.colors[i * 3], this.colors[i * 3 + 1], this.colors[i * 3 + 2]);
      light.distance = this.range[i];
      light.intensity = this.candela[i] * this.dimmer * fade * exposure;
      if (light.intensity > 0) active++;
    }
    this.active = active;
  }

  private grow(): void {
    const cap = this.xs.length * 2;
    const g = <T extends Float32Array>(a: T, n: number): T => {
      const b = new Float32Array(n) as T;
      b.set(a);
      return b;
    };
    this.xs = g(this.xs, cap);
    this.ys = g(this.ys, cap);
    this.zs = g(this.zs, cap);
    this.candela = g(this.candela, cap);
    this.range = g(this.range, cap);
    this.colors = g(this.colors, cap * 3);
  }
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
