import * as THREE from 'three';
import { SIGN_ATLAS, SIGN_TEXTS } from '../../world/buildings/signs';

/**
 * Single-channel text atlas for building signs (one text per slot, layout shared with the
 * generator's UVs). Drawn with a 2D canvas at runtime; falls back to an empty texture when
 * no canvas is available (tests, workers).
 */
export function createSignAtlas(): THREE.Texture {
  const A = SIGN_ATLAS;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = canvas?.getContext('2d', { willReadFrequently: true }) ?? null;
  if (!canvas || !ctx) {
    const t = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
    t.needsUpdate = true;
    return t;
  }
  canvas.width = A.width;
  canvas.height = A.height;
  ctx.clearRect(0, 0, A.width, A.height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${A.fontPx}px "Liberation Sans", "Helvetica Neue", Arial, "DejaVu Sans", sans-serif`;
  SIGN_TEXTS.forEach((text, i) => {
    const col = Math.floor(i / A.rows) % A.cols;
    const row = i % A.rows;
    const cx = col * A.slotW + A.slotW / 2;
    const cy = row * A.slotH + A.slotH / 2 + 2;
    const w = ctx.measureText(text).width;
    const maxW = A.slotW - 48;
    ctx.save();
    ctx.translate(cx, cy);
    if (w > maxW) ctx.scale(maxW / w, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  });
  const img = ctx.getImageData(0, 0, A.width, A.height).data;
  const data = new Uint8Array(A.width * A.height);
  // flip rows so canvas row 0 ends up at v = 1 (the generator's UV convention)
  for (let y = 0; y < A.height; y++) {
    const src = y * A.width * 4;
    const dst = (A.height - 1 - y) * A.width;
    for (let x = 0; x < A.width; x++) data[dst + x] = img[src + x * 4 + 3];
  }
  const tex = new THREE.DataTexture(data, A.width, A.height, THREE.RedFormat, THREE.UnsignedByteType);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
