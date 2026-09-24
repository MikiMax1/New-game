// Colour helpers and palettes. Palettes are written in sRGB hex (as picked from
// photos) and converted to the linear RGB the vertex colours expect.

import type { Rng } from '../rng';

export type RGB = readonly [number, number, number];

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function toSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** '#rrggbb' (sRGB) -> linear RGB. */
export function hex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16);
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)];
}

/** Multiply brightness in sRGB space (perceptually even), returns linear. */
export function shade(c: RGB, k: number): RGB {
  return [toLinear(Math.min(1, toSrgb(c[0]) * k)), toLinear(Math.min(1, toSrgb(c[1]) * k)), toLinear(Math.min(1, toSrgb(c[2]) * k))];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Small random variation of a colour (brightness and a slight hue drift), in sRGB space. */
export function jitter(c: RGB, rng: Rng, amount = 0.05): RGB {
  const k = 1 + (rng.next() - 0.5) * 2 * amount;
  const r = toSrgb(c[0]) * k * (1 + (rng.next() - 0.5) * amount * 0.6);
  const g = toSrgb(c[1]) * k * (1 + (rng.next() - 0.5) * amount * 0.6);
  const b = toSrgb(c[2]) * k * (1 + (rng.next() - 0.5) * amount * 0.6);
  return [toLinear(clamp01(r)), toLinear(clamp01(g)), toLinear(clamp01(b))];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function pickHex(rng: Rng, list: readonly string[], amount = 0.04): RGB {
  return jitter(hex(rng.pick(list)), rng, amount);
}

// ---- Palettes (sRGB) ----

/** Miami Beach Art Deco pastels. */
export const DECO_WALLS = ['#bfe6d2', '#f5c4c8', '#f6eaa4', '#bfdff2', '#d9c9ee', '#f5f1e8', '#f8d4b4', '#aee0da', '#f2f0e6', '#ffd9e0'];
export const DECO_TRIMS = ['#f7f5ef', '#3fa9a2', '#e96f86', '#8e79c9', '#f2c94c', '#56b6d6', '#6fc49a', '#f08a5d'];
/** Little Solano stucco (vivid and faded). */
export const SHOP_WALLS = ['#efe3c8', '#f0c9a0', '#d98e63', '#bfd8b0', '#a9c8da', '#f2a488', '#e8c465', '#eeeae0', '#eab6b0', '#7cc8c0', '#f4d58d', '#c9a0c8', '#9fc4a0'];
export const SHOP_TRIMS = ['#f4f1ea', '#2f5d8a', '#8a2f2f', '#2e6b4f', '#e0b040', '#5a3e2b', '#d8d2c4'];
/** Mediterranean Revival stucco. */
export const MED_WALLS = ['#efe2c6', '#e3cfa8', '#f1cfb0', '#ddb77a', '#f2e3b3', '#f1ece2', '#f0d4c8', '#e8d6b8'];
export const MED_TRIMS = ['#f4f0e6', '#6b4a2f', '#3e5b45', '#7a3b2e', '#d9c7a4'];
export const ROOF_TILES = ['#b5553a', '#a84b32', '#c0673f', '#9e4a33', '#b86a45', '#a45a3c'];
/** Concrete / older downtown stucco. */
export const CONCRETE = ['#bdb8ae', '#cfc9bd', '#a9a59c', '#d8d2c4', '#c4bba9', '#b3aea3', '#e0dacd'];
/** Modern white-ish. */
export const WHITES = ['#f3f2ee', '#ecebe6', '#f6f4ef', '#e6e4dd', '#f0eee9'];
/** Curtain-wall frames. */
export const MULLIONS = ['#c9ccce', '#8a8d90', '#2a2c2e', '#5b5048', '#b8bcc0', '#e8e8e6'];
/** Warehouses. */
export const METAL_WALLS = ['#d9d4c7', '#c8cdd2', '#ededE8', '#9db3c4', '#b7b7ae', '#cfc8b8', '#a8b5a2'];
export const TILTUP_WALLS = ['#d8cfbf', '#cfc6b4', '#e0d9cb', '#c9c2b3', '#d6d1c6'];
export const ACCENTS = ['#4e6e8e', '#8b3a3a', '#3e6b4e', '#c96a2b', '#2b4c7e', '#6b6b6b', '#a33d5b'];
/** Weathered wood / cypress shacks. */
export const SHACK_WALLS = ['#8c8373', '#9fa79a', '#7e8c96', '#b8a58a', '#6e6153', '#a39e8c', '#c9c1a8', '#7d9b8c'];
export const TRAILER_WALLS = ['#e9e6dc', '#d9d6c8', '#cfd9dc', '#e6dcc3', '#c7cfc0'];
/** Awning fabrics. */
export const AWNINGS = ['#b0302b', '#1f6b45', '#1e4e8c', '#e3b23c', '#2a2a2a', '#7a2e5a', '#d06a2a', '#2d8c8c', '#f0e6d2'];
/** Roof membranes / gravel. */
export const MEMBRANES = ['#e8e8e4', '#d6d6d0', '#c2c1bb', '#9a9994', '#dcd9cf', '#b5b2aa'];
