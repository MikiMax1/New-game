// Street-light pools baked into a 2 m/texel map over the whole city. The ground shaders
// add warm light from this map at night, so ~3,000 street lights cost one texture read.
import { MAP_HALF, MAP_SIZE } from '../config';
import { PROP_KINDS, type Dressing } from '../gen/dressing';

export const LIGHTMAP_SIZE = 2048;

export function buildLightMap(dressing: Dressing): Uint8Array {
  const n = LIGHTMAP_SIZE;
  const texel = MAP_SIZE / n;
  const acc = new Float32Array(n * n);
  const cobra = PROP_KINDS.indexOf('streetLightCobra');
  const deco = PROP_KINDS.indexOf('streetLightDeco');
  const shelter = PROP_KINDS.indexOf('busShelter');
  const signal = PROP_KINDS.indexOf('trafficSignalMast');
  for (let i = 0; i < dressing.count; i++) {
    const k = dressing.kind[i];
    let sigma: number;
    let peak: number;
    let reach = 0;
    if (k === cobra) [sigma, peak, reach] = [7.5, 1.0, 2.2];
    else if (k === deco) [sigma, peak, reach] = [5.0, 0.8, 0];
    else if (k === shelter) [sigma, peak, reach] = [2.5, 0.5, 0];
    else if (k === signal) [sigma, peak, reach] = [4.0, 0.25, 3];
    else continue;
    // The lamp head overhangs the road along the prop's facing (yaw turns -Z).
    const yaw = dressing.yaw[i];
    const x = dressing.pos[i * 3] - Math.sin(yaw) * reach;
    const z = dressing.pos[i * 3 + 2] - Math.cos(yaw) * reach;
    const cx = (x + MAP_HALF) / texel;
    const cz = (z + MAP_HALF) / texel;
    const r = Math.ceil((sigma * 3) / texel);
    const inv = 1 / (2 * (sigma / texel) ** 2);
    for (let j = Math.max(0, Math.floor(cz) - r); j <= Math.min(n - 1, Math.floor(cz) + r); j++) {
      for (let ii = Math.max(0, Math.floor(cx) - r); ii <= Math.min(n - 1, Math.floor(cx) + r); ii++) {
        const d2 = (ii + 0.5 - cx) ** 2 + (j + 0.5 - cz) ** 2;
        acc[j * n + ii] += peak * Math.exp(-d2 * inv);
      }
    }
  }
  const out = new Uint8Array(n * n);
  // Soft saturation so overlapping pools don't clip harshly.
  for (let i = 0; i < acc.length; i++) out[i] = Math.round(255 * (1 - Math.exp(-acc[i] * 1.6)));
  return out;
}
