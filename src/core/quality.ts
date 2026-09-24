import type { GpuInfo } from './gpu';
import { paramStr } from './params';
import { takeFailedQuality } from './startupGuard';
import { loadPref, savePref } from './storage';

export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

export interface Quality {
  name: QualityName;
  /** Cap for devicePixelRatio. */
  maxPixelRatio: number;
  /** Render-resolution scale on top of the pixel ratio (upscaled by the browser). */
  renderScale: number;
  shadows: boolean;
  shadowMapSize: number;
  shadowCascades: number;
  /** Farthest distance (m) shadows are drawn to. */
  shadowDistance: number;
  ao: boolean;
  bloom: boolean;
  antialias: 'none' | 'smaa';
  /** Camera far plane / world draw distance in metres. */
  drawDistance: number;
  /** Multiplier for detail props, vegetation and crowd density. */
  detail: number;
}

export const QUALITY: Record<QualityName, Quality> = {
  low: {
    name: 'low', maxPixelRatio: 1, renderScale: 0.75, shadows: true, shadowMapSize: 1024,
    shadowCascades: 2, shadowDistance: 250, ao: false, bloom: false, antialias: 'none',
    drawDistance: 2500, detail: 0.4,
  },
  medium: {
    name: 'medium', maxPixelRatio: 1, renderScale: 1, shadows: true, shadowMapSize: 2048,
    shadowCascades: 3, shadowDistance: 500, ao: true, bloom: true, antialias: 'smaa',
    drawDistance: 4000, detail: 0.7,
  },
  high: {
    name: 'high', maxPixelRatio: 1.5, renderScale: 1, shadows: true, shadowMapSize: 2048,
    shadowCascades: 4, shadowDistance: 900, ao: true, bloom: true, antialias: 'smaa',
    drawDistance: 6000, detail: 1,
  },
  ultra: {
    name: 'ultra', maxPixelRatio: 2, renderScale: 1, shadows: true, shadowMapSize: 4096,
    shadowCascades: 4, shadowDistance: 1400, ao: true, bloom: true, antialias: 'smaa',
    drawDistance: 9000, detail: 1.3,
  },
};

const ORDER: QualityName[] = ['low', 'medium', 'high', 'ultra'];

export function isQualityName(v: string | null): v is QualityName {
  return v !== null && (ORDER as string[]).includes(v);
}

export interface QualityChoice {
  quality: Quality;
  /** url: ?quality=; recovered: one step below a start that crashed; saved: the player's pick. */
  reason: 'url' | 'recovered' | 'saved' | 'auto';
}

/**
 * Quality from ?quality=; else one step below the quality of a previous start that crashed;
 * else the saved preference; else a default for this machine's GPU, memory and cores.
 */
export function initialQuality(gpu?: GpuInfo): QualityChoice {
  const fromUrl = paramStr('quality', '');
  if (isQualityName(fromUrl)) return { quality: QUALITY[fromUrl], reason: 'url' };
  const failed = takeFailedQuality();
  if (isQualityName(failed)) {
    const lower = ORDER[Math.max(0, ORDER.indexOf(failed) - 1)];
    savePref('quality', lower);
    return { quality: QUALITY[lower], reason: 'recovered' };
  }
  const saved = loadPref('quality');
  if (isQualityName(saved)) return { quality: QUALITY[saved], reason: 'saved' };
  return { quality: QUALITY[autoQuality(gpu)], reason: 'auto' };
}

/** Default quality: high on a discrete GPU, medium on integrated graphics, low without a GPU. */
export function autoQuality(gpu?: GpuInfo): QualityName {
  let q: QualityName = gpu?.kind === 'discrete' ? 'high' : gpu?.kind === 'software' ? 'low' : 'medium';
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number });
  const memory = nav?.deviceMemory ?? 8;
  const cores = nav?.hardwareConcurrency ?? 8;
  if (memory <= 2 || cores <= 2) q = 'low';
  else if ((memory <= 4 || cores <= 4) && q === 'high') q = 'medium';
  return q;
}

export function lowerQuality(q: Quality): Quality {
  return QUALITY[ORDER[Math.max(0, ORDER.indexOf(q.name) - 1)]];
}

export function nextQuality(q: Quality): Quality {
  const next = QUALITY[ORDER[(ORDER.indexOf(q.name) + 1) % ORDER.length]];
  savePref('quality', next.name);
  return next;
}
