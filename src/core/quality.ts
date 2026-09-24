import { paramStr } from './params';
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

/** Quality from ?quality=, else the saved preference, else 'high'. */
export function initialQuality(): Quality {
  const fromUrl = paramStr('quality', '');
  if (isQualityName(fromUrl)) return QUALITY[fromUrl];
  const saved = loadPref('quality');
  return QUALITY[isQualityName(saved) ? saved : 'high'];
}

export function nextQuality(q: Quality): Quality {
  const next = QUALITY[ORDER[(ORDER.indexOf(q.name) + 1) % ORDER.length]];
  savePref('quality', next.name);
  return next;
}
