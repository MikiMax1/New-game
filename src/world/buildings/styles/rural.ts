// Cypress Edge: raised wooden shacks with tin roofs, single-wide trailers, bait shops.

import { SHACK_WALLS, TRAILER_WALLS, hex, pickHex, shade } from '../colors';
import { DSURF, GLASS, GND, OCC, PAT, SIGN_LIGHT, WSURF } from '../constants';
import { FACE } from '../emit';
import { type Rect, rectD, rectW } from '../geom';
import { buildable, fitRect } from '../lot';
import { gableRoof, shedRoof } from '../roofs';
import { signIndex } from '../signs';
import { type GenCtx, addEntrance, spec, wallFrame, wallSign, withSpec } from './common';

const RUST = ['#8a5a3c', '#9a6a48', '#7d7a74', '#a3a29b', '#6f5446', '#8f8b82'];

function placeRect(g: GenCtx, W: number, D: number, front: number, side: number, rear: number): Rect | null {
  const region = buildable(g.c, front, side, rear);
  if (!region) return null;
  const r = fitRect(g.c, region);
  if (!r || rectW(r) < 3 || rectD(r) < 3) return null;
  const w = Math.min(W, rectW(r));
  const d = Math.min(D, rectD(r));
  const cx = (r.x0 + r.x1) / 2 + (rectW(r) - w) * (g.rng.next() - 0.5) * 0.5;
  return { x0: cx - w / 2, x1: cx + w / 2, z0: r.z0, z1: r.z0 + d };
}

/** Raised wooden shack (optionally a bait shop with a porch and a sign). */
export function genShack(g: GenCtx, baitShop = false): void {
  const { c, rng, drng, lod, em, base } = g;
  const r = placeRect(g, baitShop ? rng.range(9, 14) : rng.range(6, 9), baitShop ? rng.range(8, 11) : rng.range(6, 9), rng.range(3, 8), 2, 3);
  if (!r) return;
  const raise = baitShop ? rng.range(0.4, 0.7) : rng.range(0.7, 1.3);
  const floorH = 2.8;
  const wall = pickHex(rng, SHACK_WALLS, 0.05);
  const trim = pickHex(rng, ['#e9e4d8', '#c9c1a8', '#5a4a3a', '#3f5a4a'], 0.04);
  const s = spec(g, {
    pattern: PAT.SIDING, floorH, bayW: rng.range(2.6, 3.2), groundH: floorH, topH: floorH, winW: rng.range(0.8, 1.0),
    winH: 1.05, sill: 0.95, depth: 0.08, glass: GLASS.CLEAR, surface: WSURF.SIDING, wall, trim,
    occ: baitShop ? OCC.RETAIL : OCC.RESIDENTIAL,
  });
  const ring = c.frame.rect(r.x0, r.x1, r.z0, r.z1);
  const yTop = base + raise + floorH;
  for (let i = 0; i < 4; i++) {
    const w = em.wall(ring[i], ring[(i + 1) % 4], base + raise * 0.6, yTop, s, { vBase: base + raise, groundOf: i === 0 ? (b, n) => (b === Math.floor(n / 2) ? GND.DOOR : GND.SAME) : undefined });
    if (w && i === 0) addEntrance(g, w, (Math.floor(w.nBays / 2) + 0.5) * w.bayW, baitShop ? 'shop' : 'main');
  }
  // stilts / piers under the floor
  const post = hex('#5f5548');
  if (lod === 0) {
    const f = c.frame;
    for (const x of [r.x0 + 0.3, (r.x0 + r.x1) / 2, r.x1 - 0.3]) {
      for (const z of [r.z0 + 0.3, r.z1 - 0.3]) em.box(f, x - 0.14, x + 0.14, base - 0.3, base + raise * 0.6 + 0.05, z - 0.14, z + 0.14, post, DSURF.WOOD, FACE.SIDES);
    }
    // front porch deck, steps and porch roof on posts
    const pd = baitShop ? drng.range(2.4, 3.2) : drng.range(1.6, 2.4);
    const wf = { x0: r.x0, x1: r.x1 };
    em.box(f, wf.x0, wf.x1, base + raise - 0.2, base + raise, r.z0 - pd, r.z0, hex('#8b7b66'), DSURF.WOOD, FACE.NO_BOTTOM);
    for (const x of [wf.x0 + 0.2, wf.x1 - 0.2]) {
      em.box(f, x - 0.08, x + 0.08, base - 0.2, base + raise + 2.4, r.z0 - pd + 0.08, r.z0 - pd + 0.24, post, DSURF.WOOD, FACE.SIDES);
    }
    const cx = (r.x0 + r.x1) / 2;
    em.box(f, cx - 0.6, cx + 0.6, base - 0.1, base + raise * 0.5, r.z0 - pd - 0.8, r.z0 - pd, hex('#7d6e5c'), DSURF.WOOD, FACE.NO_BOTTOM);
    shedRoof(em, f, { x0: wf.x0 - 0.1, x1: wf.x1 + 0.1, z0: r.z0 - pd - 0.2, z1: r.z0 }, base + raise + 2.45, {
      pitch: 0.12, overhang: 0.15, col: pickHex(drng, RUST, 0.05), surf: DSURF.METAL_ROOF, trim: shade(trim, 0.9), lod,
    }, withSpec(s, { topH: 0 }), false);
  }
  const roofCol = pickHex(rng, RUST, 0.05);
  const ridge = gableRoof(em, c.frame, r, yTop, { pitch: rng.range(0.3, 0.5), overhang: 0.35, col: roofCol, surf: DSURF.METAL_ROOF, trim: shade(trim, 0.95), lod }, withSpec(s, { winW: 0 }), rng.chance(0.5));
  if (baitShop && lod === 0) {
    const text = signIndex('bait', Math.floor(g.seed * 331));
    const ring0 = ring[0];
    const ring1 = ring[1];
    const len = Math.hypot(ring1.x - ring0.x, ring1.z - ring0.z);
    const w = { p: ring0, q: ring1, len, n: c.frame.dir(0, -1), t: c.frame.dir(-1, 0), nBays: 1, bayW: len, winW: 0, y0: base, y1: yTop };
    // sign board on the porch roof edge
    const f = wallFrame(w);
    const pdz = 2.6;
    const W = Math.min(len - 0.6, 6);
    em.box(f, len / 2 - W / 2, len / 2 + W / 2, base + raise + 2.45, base + raise + 3.4, pdz - 0.08, pdz, hex('#efe8d8'), DSURF.PLAIN, FACE.ALL & ~FACE.BACK);
    wallSign(g, { ...w, p: f.toWorld(len, pdz), q: f.toWorld(0, pdz) }, len / 2, base + raise + 2.92, W - 0.2, 0.8, text, hex('#efe8d8'), drng.pick([4, 7, 6]), SIGN_LIGHT.PAINTED, 0.01);
  }
  g.info.style = baitShop ? 'bait-shop' : 'shack';
  g.info.floors = 1;
  g.info.height = raise + floorH;
  g.info.roofY = yTop;
  g.info.topY = ridge;
  g.info.roofType = 'gable';
  g.info.footprint = ring;
}

/** Single-wide trailer: a long metal box on blocks with skirting and a low roof. */
export function genTrailer(g: GenCtx): void {
  const { c, rng, lod, em, base } = g;
  const long = rng.range(16, 22);
  const wide = rng.range(4.2, 4.6);
  const deep = c.depth > c.width;
  const r0 = placeRect(g, deep ? wide + 0.2 : long, deep ? long : wide + 0.2, rng.range(3, 6), 1.5, 2);
  if (!r0) return;
  const r: Rect = deep ? { ...r0, x1: r0.x0 + Math.min(wide, rectW(r0)) } : { ...r0, z1: r0.z0 + Math.min(wide, rectD(r0)) };
  const wall = pickHex(rng, TRAILER_WALLS, 0.04);
  const stripe = pickHex(rng, ['#7a3b2e', '#2f4d6b', '#3e5b45', '#8a7a55', '#6b6b6b'], 0.04);
  const raise = 0.7;
  const H = 2.6;
  const s = spec(g, {
    pattern: PAT.SIDING, floorH: H, bayW: rng.range(2.4, 3.0), groundH: H, topH: H, winW: rng.range(0.9, 1.2), winH: 1.0,
    sill: 0.95, depth: 0.05, glass: GLASS.CLEAR, surface: WSURF.METAL, wall, trim: stripe, occ: OCC.RESIDENTIAL,
  });
  const ring = c.frame.rect(r.x0, r.x1, r.z0, r.z1);
  const yTop = base + raise + H;
  for (let i = 0; i < 4; i++) {
    const w = em.wall(ring[i], ring[(i + 1) % 4], base - 0.2, yTop, s, { vBase: base + raise, groundOf: i === 0 ? (b, n) => (b === Math.max(0, n - 2) ? GND.DOOR : GND.SAME) : undefined });
    if (w && i === 0) {
      const u = (Math.max(0, w.nBays - 2) + 0.5) * w.bayW;
      addEntrance(g, w, u, 'main');
      if (lod === 0) em.box(wallFrame(w), u - 0.7, u + 0.7, base - 0.1, base + raise - 0.05, 0, 1.1, hex('#8b7b66'), DSURF.WOOD, FACE.NO_BOTTOM);
    }
  }
  const ridge = gableRoof(em, c.frame, r, yTop, { pitch: 0.08, overhang: 0.12, col: hex('#c9c9c4'), surf: DSURF.METAL_ROOF, trim: shade(wall, 0.95), lod }, withSpec(s, { winW: 0 }));
  g.info.style = 'trailer';
  g.info.floors = 1;
  g.info.height = raise + H;
  g.info.roofY = yTop;
  g.info.topY = ridge;
  g.info.roofType = 'gable';
  g.info.footprint = ring;
}
