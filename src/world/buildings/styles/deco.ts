// Solmar Beach: 1930s Art Deco hotels (pastel stucco, eyebrows over windows, rounded
// corners, a central fin with neon, name on the parapet) and 1950s MiMo slab hotels.

import type { P2, Ring } from '../../types';
import { DECO_TRIMS, DECO_WALLS, WHITES, hex, pickHex, shade } from '../colors';
import { DSURF, FLAG, GLASS, GND, OCC, PAT, SIGN_LIGHT, WSURF } from '../constants';
import { FACE, type FacadeSpec, type WallLayout } from '../emit';
import { type Rect, edgeLength, edgeNormal, rectD, rectW, roundCorner, simplifyRing } from '../geom';
import { buildable, fitRect } from '../lot';
import { signIndex } from '../signs';
import {
  type GenCtx, OUT_FACES, SKIRT, addEntrance, awning, bulkhead, clamp, flatRoof, ledge, lightStrip, mainEdge, rooftopUnits, spec,
  streetEdges, wallFrame, wallSign, withSpec,
} from './common';

const NEON = [1, 2, 5, 3, 0];

/** A wall layout for an edge without emitting it (for ledges on curved strips). */
function layoutOf(p: P2, q: P2, y0: number, y1: number): WallLayout {
  const len = edgeLength(p, q);
  return { p, q, len, n: edgeNormal(p, q), t: { x: (p.x - q.x) / len, z: (p.z - q.z) / len }, nBays: 1, bayW: len, winW: 0, y0, y1 };
}

export function genDeco(g: GenCtx, commercial = false): void {
  const { c, rng, drng, lod, em, base, lot } = g;
  const floors = clamp(Math.round((lot.heightHint - 4.3) / 3.2) + 1, commercial ? 1 : 2, 4);
  const groundH = rng.range(4.0, 4.5);
  const floorH = rng.range(3.1, 3.35);
  const parapet = rng.range(1.0, 1.7);
  const topH = groundH + (floors - 1) * floorH;
  const yTop = base + topH + parapet;
  const front = rng.chance(0.5) ? rng.range(1.5, 3.0) : 0;
  const side = c.width > 22 ? rng.range(1.0, 2.0) : 0;
  let ring: Ring | null = buildable(c, front, side, rng.range(1.5, 3.5));
  if (!ring) return;
  ring = simplifyRing(ring, 0.5);
  // colours: pastel walls with white trim, or white walls with pastel trim
  const pastelWall = rng.chance(0.7);
  const wall = pastelWall ? pickHex(rng, DECO_WALLS, 0.03) : pickHex(rng, WHITES, 0.02);
  const trim = pastelWall ? (rng.chance(0.6) ? hex('#f7f5ef') : pickHex(rng, DECO_TRIMS, 0.03)) : pickHex(rng, DECO_TRIMS.slice(1), 0.03);
  // round the corner between two street edges
  let street = streetEdges(g, ring, front + 2.5);
  let arc: { start: number; end: number } | null = null;
  {
    for (let i = 0; i < ring.length && !arc; i++) {
      const prev = (i - 1 + ring.length) % ring.length;
      if (!street[prev] || !street[i]) continue;
      const r = rng.range(3.0, 4.6);
      const rc = roundCorner(ring, i, r, lod === 1 ? 2 : 5);
      if (rc) {
        const flags = street.slice();
        const arcFlags = new Array(rc.end - rc.start).fill(true);
        flags.splice(i, 0, ...arcFlags);
        ring = rc.ring;
        street = flags;
        arc = { start: rc.start, end: rc.end };
      }
    }
  }
  const main = mainEdge(g, ring, street);
  const occ = commercial ? OCC.RETAIL : OCC.HOTEL;
  const flags = (rng.chance(0.5) ? FLAG.DIVIDERS : 0) | (rng.chance(0.35) ? FLAG.AC : 0);
  const decoSpec: FacadeSpec = spec(g, {
    pattern: PAT.DECO, floorH, bayW: rng.range(2.8, 3.4), groundH, topH,
    winW: rng.range(1.1, 1.35), winH: rng.range(1.35, 1.6), sill: 0.85, depth: 0.2,
    glass: rng.pick([GLASS.CLEAR, GLASS.CLEAR, GLASS.GREEN, GLASS.LOWE]), surface: WSURF.STUCCO,
    wall, trim, occ, flags, ground: GND.SHOP,
  });
  const sideSpec = withSpec(decoSpec, { pattern: PAT.PUNCHED, ground: GND.SAME, flags: flags & FLAG.AC });
  const backSpec = withSpec(decoSpec, { pattern: PAT.PUNCHED, ground: GND.SERVICE, flags: 0, wall: shade(wall, 0.96) });
  const portholes = rng.chance(0.35);
  const finKind = commercial ? (rng.chance(0.4) ? 'fin' : 'none') : rng.pick(['fin', 'fin', 'ziggurat', 'none']);
  const eyebrowMode = rng.pick(['window', 'band', 'band']);
  const eyebrowDepth = rng.range(0.4, 0.6);
  // eyebrows are usually the wall colour (their shadow line does the work), sometimes accented
  const brow = rng.chance(0.7) ? shade(wall, 1.03) : trim;
  const n = ring.length;
  let mainLayout: WallLayout | null = null;
  let finU = 0;
  for (let i = 0; i < n; i++) {
    if (arc && i >= arc.start && i < arc.end) {
      if (i === arc.start) {
        const pts = ring.slice(arc.start, arc.end + 1);
        const prev = (arc.start - 1 + n) % n;
        const nStart = edgeNormal(ring[prev], ring[arc.start]);
        const nEnd = edgeNormal(ring[arc.end], ring[(arc.end + 1) % n]);
        const ribbon = withSpec(decoSpec, { pattern: PAT.RIBBON, bayW: 1.1, winW: 1.0, flags: 0 });
        em.wallStrip(pts, base - SKIRT, yTop, ribbon, GND.SHOP, nStart, nEnd);
        if (lod === 0) {
          for (let k = arc.start; k < arc.end; k++) {
            const w = layoutOf(ring[k], ring[k + 1], base, yTop);
            for (let f = 1; f < floors; f++) {
              const y = base + groundH + (f - 1) * floorH + decoSpec.sill + decoSpec.winH + 0.22;
              ledge(g, w, -0.02, w.len + 0.02, y, 0.1, eyebrowDepth, brow);
            }
            ledge(g, w, -0.02, w.len + 0.02, base + groundH - 0.15, 0.14, 1.0, brow);
          }
        }
      }
      continue;
    }
    const p = ring[i];
    const q = ring[(i + 1) % n];
    if (!street[i]) {
      const back = edgeNormal(p, q);
      const fn = g.c.frame.dir(0, -1);
      const isBack = back.x * fn.x + back.z * fn.z < -0.6;
      em.wall(p, q, base - SKIRT, yTop, isBack ? backSpec : sideSpec);
      continue;
    }
    const isMain = i === main;
    const len = edgeLength(p, q);
    const nb = Math.max(1, Math.round(len / decoSpec.bayW));
    const mid = Math.floor(nb / 2);
    const hasFin = isMain && finKind === 'fin' && nb >= 3;
    const portSpec = withSpec(decoSpec, { flags: decoSpec.flags | FLAG.PORTHOLE });
    const w = em.wall(p, q, base - SKIRT, yTop, decoSpec, {
      bays: nb,
      groundOf: (b) => (isMain && b === mid ? GND.SHOPDOOR : GND.SHOP),
      specOf: (b) => (isMain && portholes && nb >= 5 && (b === mid - 1 || b === mid + 1) ? portSpec : decoSpec),
    });
    if (!w) continue;
    if (isMain) {
      mainLayout = w;
      finU = (mid + 0.5) * w.bayW;
      addEntrance(g, w, finU, 'main');
    }
    if (lod === 1) continue;
    // eyebrows over windows (upper floors) and a deep canopy ledge over the ground floor
    for (let f = 1; f < floors; f++) {
      const y = base + groundH + (f - 1) * floorH + decoSpec.sill + decoSpec.winH + 0.22;
      if (eyebrowMode === 'band' || w.nBays > 5) {
        ledge(g, w, -0.02, w.len + 0.02, y, 0.1, eyebrowDepth, brow);
      } else {
        for (let b = 0; b < w.nBays; b++) {
          if (hasFin && b === mid) continue;
          if (isMain && portholes && w.nBays >= 5 && (b === mid - 1 || b === mid + 1)) continue;
          const uc = (b + 0.5) * w.bayW;
          g.em.box(wallFrame(w), uc - w.winW / 2 - 0.3, uc + w.winW / 2 + 0.3, y - 0.1, y, 0, eyebrowDepth, brow, DSURF.PLAIN, FACE.TOP | FACE.BOTTOM | FACE.BACK);
        }
      }
    }
    const awningHere = isMain && drng.chance(0.45);
    if (awningHere) {
      const col = pickHex(drng, ['#1e4e8c', '#2d8c8c', '#b0302b', '#e3b23c', '#f0e6d2', '#7a2e5a'], 0.03);
      awning(g, w, 0.3, w.len - 0.3, base + groundH - 0.55, Math.min(1.4, 1.2 + front), 0.6, col, drng.chance(0.5) ? 0.3 : 0, drng.int(0, 1));
    } else {
      ledge(g, w, -0.02, w.len + 0.02, base + groundH - 0.15, 0.14, Math.min(1.35, 1.0 + front * 0.2), brow);
    }
    // horizontal speed lines on the parapet
    if (drng.chance(0.5)) {
      for (let k = 0; k < 3; k++) ledge(g, w, 0, w.len, base + topH + 0.25 + k * 0.28, 0.07, 0.06, trim);
    }
  }
  // ---------------------------------------------------------------- central feature and sign
  let topY = yTop;
  if (mainLayout && lod === 0 && finKind !== 'none') {
    const w = mainLayout;
    const f = wallFrame(w);
    const neon = hex(['#ff4fa3', '#39e0ff', '#6dff8a', '#fff2c4', '#b36bff'][drng.int(0, 4)]);
    if (finKind === 'fin') {
      const fw = drng.range(1.2, 1.9);
      const fd = drng.range(0.5, 0.9);
      const fTop = yTop + drng.range(2.5, 5.5);
      em.box(f, finU - fw / 2, finU + fw / 2, base + groundH - 0.3, fTop, 0, fd, drng.chance(0.5) ? trim : wall, DSURF.PLAIN, OUT_FACES);
      em.box(f, finU - fw / 2 - 0.25, finU + fw / 2 + 0.25, fTop, fTop + 0.35, -0.2, fd + 0.2, trim, DSURF.PLAIN, FACE.ALL);
      lightStrip(g, f, finU - 0.06, finU + 0.06, base + groundH + 0.3, fTop - 0.4, fd, fd + 0.08, neon);
      topY = fTop + 0.35;
    } else {
      // stepped ziggurat crown over the entrance
      let wz = drng.range(3.2, 4.4);
      let y = base + topH;
      for (let k = 0; k < 3; k++) {
        const h = drng.range(1.2, 1.7) + (k === 0 ? parapet : 0);
        em.box(f, finU - wz / 2, finU + wz / 2, y, y + h, -1.6, 0.25, k % 2 ? trim : wall, DSURF.PLAIN, FACE.NO_BOTTOM);
        lightStrip(g, f, finU - wz / 2, finU + wz / 2, y + h - 0.12, y + h - 0.04, 0.25, 0.3, neon);
        y += h;
        wz *= 0.68;
      }
      topY = y;
    }
  }
  if (mainLayout && lod === 0 && !commercial) {
    const w = mainLayout;
    const text = signIndex('hotel', Math.floor(g.seed * 1000));
    const H = Math.min(parapet * 0.75, 1.0);
    const W = Math.min(w.len * (finKind === 'fin' ? 0.36 : 0.6), 9);
    const uc = finKind === 'fin' ? (finU > w.len / 2 ? finU - W / 2 - 1.4 : finU + W / 2 + 1.4) : w.len / 2;
    if (uc - W / 2 > 0.2 && uc + W / 2 < w.len - 0.2) {
      wallSign(g, w, uc, base + topH + parapet * 0.5, W, H, text, wall, NEON[drng.int(0, NEON.length - 1)], SIGN_LIGHT.NEON, 0.04);
    }
  } else if (mainLayout && lod === 0 && commercial && drng.chance(0.7)) {
    const w = mainLayout;
    const text = signIndex('shop', Math.floor(g.seed * 1000));
    wallSign(g, w, w.len / 2, base + groundH - 0.55 + 0.9, Math.min(w.len * 0.6, 7), 0.6, text, wall, drng.pick([6, 7, 4]), SIGN_LIGHT.PAINTED, 0.05);
  }
  // front terrace (terrazzo)
  if (lod === 0 && front > 1.2) {
    const r0 = fitRect(g.c, ring);
    if (r0) {
      const tf = g.c.frame;
      const z0 = Math.max(g.c.minZ, r0.z0 - front + 0.1);
      em.box(tf, r0.x0 + 0.5, r0.x1 - 0.5, base - 0.2, base + 0.25, z0, r0.z0, hex('#e9e2d4'), DSURF.PAVERS, FACE.NO_BOTTOM);
    }
  }
  const roof = flatRoof(g, ring, yTop, { parapet, wall, capCol: trim, roofCol: hex(rng.pick(['#e6e4de', '#d4d2cc', '#bdbab2'])), roofSurf: DSURF.MEMBRANE, frame: c.frame });
  if (lod === 0) {
    const avoid: { x: number; z: number; r: number }[] = [];
    if (drng.chance(0.6)) {
      const b = bulkhead(g, roof, c.frame, wall, 2.6, 3.2, 2.6);
      if (b) avoid.push(b);
    }
    rooftopUnits(g, roof, c.frame, drng.int(2, 4), 'mixed', avoid);
  }
  g.info.style = commercial ? 'deco-shop' : 'deco-hotel';
  g.info.floors = floors;
  g.info.height = topH + parapet;
  g.info.roofY = roof.y;
  g.info.topY = topY;
  g.info.roofType = 'flat';
  g.info.footprint = ring;
  g.info.roofAreas.push({ ring: roof.ring, y: roof.y });
}

/** 1950s-60s Miami Modern slab hotel: podium, long balconied slab, screen walls, rooftop sign. */
export function genMimo(g: GenCtx): void {
  const { c, rng, drng, lod, em, base, lot } = g;
  const floorH = rng.range(3.0, 3.2);
  const groundH = rng.range(4.8, 5.6);
  const floors = clamp(Math.round((lot.heightHint - groundH) / floorH) + 1, 6, 17);
  const topH = groundH + (floors - 1) * floorH;
  const wall = pickHex(rng, WHITES, 0.02);
  const trim = pickHex(rng, ['#3fb8b0', '#f08aa0', '#9ccc65', '#f2c94c', '#5aa7d6', '#f7f5ef'], 0.03);
  const region = buildable(c, rng.range(4, 8), rng.range(3, 5), rng.range(4, 8));
  if (!region) return;
  const r0 = fitRect(c, region);
  if (!r0 || rectW(r0) < 10 || rectD(r0) < 10) return;
  // podium: two floors over most of the buildable rectangle
  const podH = groundH + floorH;
  const podSpec = spec(g, {
    pattern: PAT.RIBBON, floorH, bayW: 1.6, groundH, topH: podH, winW: 1.5, winH: 1.9, sill: 0.7, depth: 0.12,
    glass: GLASS.GREEN, surface: WSURF.STUCCO, wall, trim, occ: OCC.HOTEL, ground: GND.LOBBY,
  });
  const podRing = c.frame.rect(r0.x0, r0.x1, r0.z0, r0.z0 + Math.min(rectD(r0), 30));
  const pStreet = streetEdges(g, podRing, 12);
  for (let i = 0; i < 4; i++) {
    const w = em.wall(podRing[i], podRing[(i + 1) % 4], base - SKIRT, base + podH + 0.9, pStreet[i] ? podSpec : withSpec(podSpec, { ground: GND.SERVICE, pattern: PAT.BLANK }));
    if (w && i === 0) addEntrance(g, w, w.len / 2, 'lobby');
    if (w && i === 0 && lod === 0) {
      // long cantilevered canopy (porte-cochere)
      const cw = Math.min(w.len * 0.5, 16);
      em.box(wallFrame(w), w.len / 2 - cw / 2, w.len / 2 + cw / 2, base + groundH - 0.9, base + groundH - 0.5, 0, Math.min(4.5, (r0.z0 - c.minZ) + 1.3), trim, DSURF.PLAIN, OUT_FACES);
    }
  }
  const podRoof = flatRoof(g, podRing, base + podH + 0.9, { parapet: 0.9, wall, roofCol: hex('#cfcac0'), roofSurf: DSURF.MEMBRANE, frame: c.frame });
  // slab
  const along = rectW(r0) >= rectD(r0) * 0.8 || rng.chance(0.6);
  const sd = rng.range(14, 18);
  let sr: Rect;
  if (along) {
    const L = Math.min(rectW(r0), rng.range(45, 75));
    const x0 = (r0.x0 + r0.x1) / 2 - L / 2;
    const z0 = r0.z0 + Math.min(4, rectD(r0) - sd);
    sr = { x0, x1: x0 + L, z0: Math.max(r0.z0, z0), z1: Math.max(r0.z0, z0) + Math.min(sd, rectD(r0)) };
  } else {
    const L = Math.min(rectD(r0), rng.range(40, 70));
    const x0 = (r0.x0 + r0.x1) / 2 - sd / 2;
    sr = { x0, x1: x0 + Math.min(sd, rectW(r0)), z0: r0.z0, z1: r0.z0 + L };
  }
  const slab = c.frame.rect(sr.x0, sr.x1, sr.z0, sr.z1);
  const yTop = base + topH + 1.2;
  const egg = rng.chance(0.55);
  const longSpec = spec(g, {
    pattern: egg ? PAT.EGGCRATE : PAT.BALCONY, floorH, bayW: egg ? rng.range(3.4, 4.2) : rng.range(3.6, 4.4), groundH: podH, topH,
    winW: 9, winH: 2.3, sill: 0.2, depth: egg ? rng.range(0.9, 1.3) : rng.range(1.5, 1.9),
    glass: rng.pick([GLASS.GREEN, GLASS.CLEAR, GLASS.TEAL]), surface: WSURF.STUCCO, wall, trim,
    occ: OCC.HOTEL, flags: FLAG.METAL_RAIL | FLAG.DIVIDERS,
  });
  const endSpec = withSpec(longSpec, { pattern: rng.chance(0.5) ? PAT.SCREEN : PAT.BLANK, wall: shade(wall, 0.97) });
  for (let i = 0; i < 4; i++) {
    const p = slab[i];
    const q = slab[(i + 1) % 4];
    const long = along ? i % 2 === 0 : i % 2 === 1;
    em.wall(p, q, base + podH - 0.3, yTop, long ? longSpec : endSpec);
  }
  const roof = flatRoof(g, slab, yTop, { parapet: 1.2, wall, capCol: trim, roofCol: hex('#d9d6cf'), roofSurf: DSURF.MEMBRANE, frame: c.frame });
  let topY = yTop;
  if (lod === 0) {
    // rooftop sign on a steel frame along the street side
    const text = signIndex('hotel', Math.floor(g.seed * 997));
    const sw = Math.min(along ? rectW(sr) * 0.55 : rectW(sr) * 0.9, 22);
    const sh = drng.range(2.4, 3.4);
    const fz = sr.z0 + 1.5;
    const fx = (sr.x0 + sr.x1) / 2;
    const sf = c.frame.offset(fx, fz);
    const y0 = roof.y + 1.2;
    const steel = hex('#3d3f42');
    for (const x of [-sw / 2 + 0.5, 0, sw / 2 - 0.5]) em.box(sf, x - 0.12, x + 0.12, roof.y, y0 + sh, 0.1, 0.34, steel, DSURF.DARK, FACE.SIDES);
    // sign face toward the street (-z of the frame): right end at -x as seen from the street
    const wl: WallLayout = { p: sf.toWorld(-sw / 2, 0), q: sf.toWorld(sw / 2, 0), len: sw, n: sf.dir(0, -1), t: sf.dir(-1, 0), nBays: 1, bayW: sw, winW: 0, y0, y1: y0 + sh };
    wallSign(g, wl, sw / 2, y0 + sh / 2, sw, sh, text, hex('#202226'), drng.pick([0, 1, 2, 3]), SIGN_LIGHT.NEON, 0);
    topY = y0 + sh;
    rooftopUnits(g, roof, c.frame, drng.int(2, 4), 'rtu', [{ x: fx, z: fz, r: sw / 2 }]);
    rooftopUnits(g, podRoof, c.frame, drng.int(1, 3), 'rtu', [{ x: (sr.x0 + sr.x1) / 2, z: (sr.z0 + sr.z1) / 2, r: Math.hypot(rectW(sr), rectD(sr)) / 2 }]);
  }
  g.info.style = 'mimo-hotel';
  g.info.floors = floors;
  g.info.height = topH + 1.2;
  g.info.roofY = roof.y;
  g.info.topY = topY;
  g.info.roofType = 'flat';
  g.info.footprint = podRing;
  g.info.roofAreas.push({ ring: roof.ring, y: roof.y });
}
