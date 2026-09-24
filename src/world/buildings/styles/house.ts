// Palm Heights / islands: Mediterranean Revival houses (stucco, barrel-tile hip roofs,
// arched loggias, chimneys, garages, pools) and modern island mansions.

import type { P2 } from '../../types';
import { MED_TRIMS, MED_WALLS, ROOF_TILES, WHITES, hex, pickHex, shade } from '../colors';
import { DSURF, FLAG, GLASS, GND, OCC, PAT, WSURF } from '../constants';
import { FACE, type FacadeSpec, type WallLayout } from '../emit';
import { Frame, type Rect, rectD, rectInside, rectW } from '../geom';
import { buildable, fitRect } from '../lot';
import { hipRoof } from '../roofs';
import { type GenCtx, SKIRT, addEntrance, clamp, rooftopUnits, spec, wallFrame, withSpec } from './common';

/** Emit 4 walls of a local rectangle; `front` options apply to the street-side wall (index 0). */
function boxWalls(g: GenCtx, f: Frame, r: Rect, y0: number, y1: number, s: FacadeSpec, frontGround?: (b: number, n: number) => number, sideSpec?: FacadeSpec): (WallLayout | null)[] {
  const ring = f.rect(r.x0, r.x1, r.z0, r.z1);
  const out: (WallLayout | null)[] = [];
  for (let i = 0; i < 4; i++) {
    const sp = i === 0 ? s : sideSpec ?? s;
    out.push(g.em.wall(ring[i], ring[(i + 1) % 4], y0, y1, sp, i === 0 && frontGround ? { groundOf: frontGround } : undefined));
  }
  return out;
}

/** Pool with a raised coping deck in the back yard (local rect). */
function pool(g: GenCtx, f: Frame, r: Rect): void {
  if (g.lod === 1) return;
  const y = g.base;
  const cope = 0.45;
  const deck = hex('#e6dfd0');
  g.em.box(f, r.x0 - cope, r.x1 + cope, y - 0.2, y + 0.16, r.z0 - cope, r.z0, deck, DSURF.PAVERS, FACE.NO_BOTTOM);
  g.em.box(f, r.x0 - cope, r.x1 + cope, y - 0.2, y + 0.16, r.z1, r.z1 + cope, deck, DSURF.PAVERS, FACE.NO_BOTTOM);
  g.em.box(f, r.x0 - cope, r.x0, y - 0.2, y + 0.16, r.z0, r.z1, deck, DSURF.PAVERS, FACE.NO_BOTTOM);
  g.em.box(f, r.x1, r.x1 + cope, y - 0.2, y + 0.16, r.z0, r.z1, deck, DSURF.PAVERS, FACE.NO_BOTTOM);
  const water = f.rect(r.x0, r.x1, r.z0, r.z1);
  g.em.flat(water, y + 0.06, true, hex('#3fb6c9'), DSURF.POOL, f.offset(r.x0, r.z0));
}

/** Driveway pavers between two local z values, width w centred on x. */
function driveway(g: GenCtx, x: number, w: number, z0: number, z1: number): void {
  if (g.lod === 1 || z1 - z0 < 1) return;
  const f = g.c.frame;
  g.em.flat(f.rect(x - w / 2, x + w / 2, z0, z1), g.base + 0.07, true, hex('#cdbfa6'), DSURF.PAVERS, f);
}

export function genMedHouse(g: GenCtx, mansion = false): void {
  const { c, rng, drng, lod, em, base, lot } = g;
  const floors = mansion ? (lot.heightHint > 9.5 ? 3 : 2) : lot.heightHint >= 5.8 ? 2 : 1;
  const floorH = 3.0;
  const groundH = 3.3;
  const region = buildable(c, mansion ? rng.range(10, 14) : rng.range(6.5, 8), mansion ? rng.range(5, 7) : rng.range(2.5, 3.5), mansion ? 8 : 6);
  if (!region) return;
  const r0 = fitRect(c, region);
  if (!r0 || rectW(r0) < 6 || rectD(r0) < 6) return;
  const wall = pickHex(rng, MED_WALLS, 0.04);
  const trim = pickHex(rng, MED_TRIMS, 0.03);
  const tile = pickHex(rng, ROOF_TILES, 0.05);
  const garageWing = rectW(r0) > 17 && rng.chance(mansion ? 0.5 : 0.7);
  const gw = garageWing ? rng.range(6.2, 7.2) : 0;
  const W = Math.min(rectW(r0) - gw, mansion ? rng.range(20, 30) : rng.range(11, 17));
  const D = Math.min(rectD(r0), mansion ? rng.range(13, 18) : rng.range(9, 12.5));
  const garageLeft = rng.chance(0.5);
  // main block x range, garage on one side
  const slack = rectW(r0) - W - gw;
  const x0 = r0.x0 + slack * (garageLeft ? 0.7 : 0.3) + (garageLeft ? gw : 0);
  const main: Rect = { x0, x1: x0 + W, z0: r0.z0, z1: r0.z0 + D };
  const topH = groundH + (floors - 1) * floorH;
  const flags = (rng.chance(0.45) ? FLAG.ARCHED : 0) | (rng.chance(0.35) ? FLAG.SHUTTERS : 0);
  const s = spec(g, {
    pattern: PAT.MED, floorH, bayW: rng.range(3.1, 3.7), groundH, topH, winW: rng.range(1.0, 1.25), winH: rng.range(1.45, 1.7),
    sill: 0.8, depth: 0.22, glass: GLASS.CLEAR, surface: WSURF.STUCCO, wall, trim, occ: OCC.RESIDENTIAL, flags,
  });
  const loggia = rng.chance(0.35);
  const doorOff = rng.int(-1, 1);
  const fw = boxWalls(g, c.frame, main, base - SKIRT, base + topH + 0.15, s, (b, n) => {
    const door = clamp(Math.floor(n / 2) + doorOff, 0, n - 1);
    if (b === door) return GND.DOOR;
    if (loggia && n >= 4 && (b === door + 1 || b === door + 2) && b < n) return GND.ARCADE;
    return GND.SAME;
  }, withSpec(s, { flags: flags & ~FLAG.SHUTTERS }));
  const front = fw[0];
  const pitch = rng.range(0.36, 0.46);
  const ov = rng.range(0.45, 0.62);
  const roofOpts = { pitch, overhang: ov, col: tile, surf: DSURF.TILE, trim: shade(wall, 0.97), lod } as const;
  let ridge = hipRoof(em, c.frame, main, base + topH + 0.15, roofOpts);
  if (front) {
    const door = clamp(Math.floor(front.nBays / 2) + doorOff, 0, front.nBays - 1);
    const uDoor = (door + 0.5) * front.bayW;
    addEntrance(g, front, uDoor, 'main');
    if (lod === 0 && !loggia && drng.chance(0.45)) {
      // arched entry portico with its own little hip roof
      const f = wallFrame(front);
      const pw = 2.6;
      const pd = 1.7;
      const u0 = clamp(uDoor - pw / 2, 0.1, front.len - pw - 0.1);
      const yE = base + 2.9;
      for (const x of [u0 + 0.2, u0 + pw - 0.2]) em.box(f, x - 0.2, x + 0.2, base, yE, pd - 0.4, pd, wall, DSURF.PLAIN, FACE.SIDES);
      em.box(f, u0, u0 + pw, yE - 0.45, yE, 0, pd, wall, DSURF.PLAIN, FACE.ALL & ~FACE.FRONT & ~FACE.TOP);
      hipRoof(em, f, { x0: u0, x1: u0 + pw, z0: 0.0, z1: pd }, yE, { ...roofOpts, overhang: 0.3 });
    }
  }
  // garage wing: one floor, set back a little
  let garageDoorX = (main.x0 + main.x1) / 2;
  if (garageWing) {
    const gx0 = garageLeft ? main.x0 - gw : main.x1;
    const gz0 = main.z0 + rng.range(0.5, 2.5);
    const gr: Rect = { x0: gx0, x1: gx0 + gw, z0: gz0, z1: gz0 + Math.min(D - 0.5, rng.range(6.5, 7.5)) };
    const gs = withSpec(s, { groundH: 3.0, topH: 3.0, flags: flags & FLAG.ARCHED });
    const gws = boxWalls(g, c.frame, gr, base - SKIRT, base + 3.0, gs, () => GND.GARAGE);
    if (gws[0]) addEntrance(g, gws[0], gws[0].len / 2, 'garage');
    hipRoof(em, c.frame, gr, base + 3.0, roofOpts);
    garageDoorX = (gr.x0 + gr.x1) / 2;
    driveway(g, garageDoorX, 5.2, c.minZ + 0.1, gz0);
  } else if (lod === 0) {
    driveway(g, main.x0 + 2.6, 4.5, c.minZ + 0.1, main.z0);
  }
  // rear wing (L-shape)
  if (rng.chance(mansion ? 0.8 : 0.3) && rectD(r0) > D + 5) {
    const ww = W * rng.range(0.35, 0.5);
    const wd = Math.min(rectD(r0) - D, rng.range(6, 10));
    const onLeft = rng.chance(0.5);
    const wr: Rect = { x0: onLeft ? main.x0 : main.x1 - ww, x1: onLeft ? main.x0 + ww : main.x1, z0: main.z1 - 0.4, z1: main.z1 + wd };
    const wf = mansion ? floors : 1;
    const wTop = groundH + (wf - 1) * floorH;
    boxWalls(g, c.frame, wr, base - SKIRT, base + wTop + 0.15, withSpec(s, { topH: wTop, flags: flags & ~FLAG.SHUTTERS }));
    hipRoof(em, c.frame, wr, base + wTop + 0.15, roofOpts);
  }
  // mansion tower
  if (mansion && rng.chance(0.4)) {
    const ts = 5.2;
    const tx = rng.chance(0.5) ? main.x0 : main.x1 - ts;
    const tr: Rect = { x0: tx, x1: tx + ts, z0: main.z0 - 0.6, z1: main.z0 - 0.6 + ts };
    const tTop = topH + floorH;
    boxWalls(g, c.frame, tr, base - SKIRT, base + tTop + 0.15, withSpec(s, { topH: tTop }));
    ridge = Math.max(ridge, hipRoof(em, c.frame, tr, base + tTop + 0.15, roofOpts));
  }
  // chimney on a side wall
  const side = fw[garageLeft ? 1 : 3];
  if (side && lod === 0 && drng.chance(0.3)) {
    const f = wallFrame(side);
    const u = side.len * drng.range(0.3, 0.7);
    em.box(f, u - 0.55, u + 0.55, base - 0.2, ridge + 0.6, 0, 0.75 + ov, wall, DSURF.PLAIN, FACE.ALL & ~FACE.FRONT & ~FACE.BOTTOM);
    em.box(f, u - 0.65, u + 0.65, ridge + 0.6, ridge + 0.8, -0.1, 0.85 + ov, trim, DSURF.PLAIN, FACE.ALL);
  }
  // pool in the back yard
  if (rng.chance(mansion ? 0.85 : 0.4)) {
    const pw = mansion ? rng.range(5, 7) : rng.range(3.6, 4.6);
    const pl = mansion ? rng.range(11, 16) : rng.range(7, 9.5);
    const pz0 = main.z1 + 2.5;
    const pr: Rect = { x0: (main.x0 + main.x1) / 2 - pl / 2, x1: (main.x0 + main.x1) / 2 + pl / 2, z0: pz0, z1: pz0 + pw };
    const regionLocal: P2[] = region.map((p) => c.frame.toLocal(p));
    if (rectInside({ x0: pr.x0 - 0.6, x1: pr.x1 + 0.6, z0: pr.z0 - 0.6, z1: pr.z1 + 0.6 }, regionLocal)) pool(g, c.frame, pr);
  }
  g.info.style = mansion ? 'med-mansion' : 'med-house';
  g.info.floors = floors;
  g.info.height = topH + 0.15;
  g.info.roofY = base + topH + 0.15;
  g.info.topY = ridge;
  g.info.roofType = 'hip';
  g.info.footprint = c.frame.rect(main.x0, main.x1, main.z0, main.z1);
}

/** Modern island mansion: stacked white boxes, big glass, floating roof plates, pool. */
export function genModernMansion(g: GenCtx): void {
  const { c, rng, drng, lod, em, base, lot } = g;
  const floors = lot.heightHint > 9.5 ? 3 : 2;
  const floorH = 3.5;
  const region = buildable(c, rng.range(9, 13), rng.range(5, 7), 8);
  if (!region) return;
  const r0 = fitRect(c, region);
  if (!r0 || rectW(r0) < 8 || rectD(r0) < 8) return;
  const wall = pickHex(rng, WHITES, 0.02);
  const wood = pickHex(rng, ['#8a6a4d', '#a07e5c', '#6f5640', '#b89a78'], 0.03);
  const W = Math.min(rectW(r0), rng.range(20, 32));
  const D = Math.min(rectD(r0), rng.range(12, 17));
  const x0 = (r0.x0 + r0.x1) / 2 - W / 2;
  const lower: Rect = { x0, x1: x0 + W, z0: r0.z0 + 1.5, z1: r0.z0 + 1.5 + D };
  const s = spec(g, {
    pattern: PAT.MODERN, floorH, bayW: rng.range(3.6, 4.6), groundH: floorH, topH: floorH, winW: 9, winH: 2.75, sill: 0.08, depth: 0.25,
    glass: rng.pick([GLASS.CLEAR, GLASS.LOWE, GLASS.DARK]), surface: WSURF.STUCCO, wall, trim: wood, occ: OCC.RESIDENTIAL,
  });
  const fw = boxWalls(g, c.frame, lower, base - SKIRT, base + floorH, s, (b, n) => (b === 0 ? GND.GARAGE : b === Math.floor(n / 2) ? GND.DOOR : GND.SAME));
  if (fw[0]) {
    addEntrance(g, fw[0], (Math.floor(fw[0].nBays / 2) + 0.5) * fw[0].bayW, 'main');
    addEntrance(g, fw[0], 0.5 * fw[0].bayW, 'garage');
  }
  const plate = (r: Rect, y: number, over: number): void => {
    em.box(c.frame, r.x0 - over, r.x1 + over, y, y + 0.35, r.z0 - over, r.z1 + over, wall, DSURF.PLAIN, FACE.SIDES | FACE.TOP, 0, 0, hex('#d5d3cc'), DSURF.MEMBRANE);
    em.hquad(c.frame.toWorld(r.x0 - over, r.z0 - over), c.frame.toWorld(r.x1 + over, r.z0 - over), c.frame.toWorld(r.x1 + over, r.z1 + over), c.frame.toWorld(r.x0 - over, r.z1 + over), y, false, wall, DSURF.CANOPY, c.frame);
  };
  plate(lower, base + floorH, rng.range(0.8, 1.6));
  let yTop = base + floorH + 0.35;
  let top = lower;
  for (let f = 1; f < floors; f++) {
    const w2 = W * rng.range(0.55, 0.85);
    const d2 = D * rng.range(0.7, 1.0);
    const shift = rng.range(-0.25, 0.25) * (W - w2);
    const ux0 = (lower.x0 + lower.x1) / 2 - w2 / 2 + shift;
    const uz0 = lower.z0 + rng.range(-1.5, 1.0);
    const upper: Rect = { x0: ux0, x1: ux0 + w2, z0: Math.max(r0.z0, uz0), z1: Math.max(r0.z0, uz0) + d2 };
    const y0 = yTop;
    boxWalls(g, c.frame, upper, y0 - 0.2, y0 + floorH, withSpec(s, { groundH: y0 - base, topH: y0 - base + floorH }));
    plate(upper, y0 + floorH, rng.range(0.8, 1.8));
    yTop = y0 + floorH + 0.35;
    top = upper;
  }
  const roofRing = c.frame.rect(top.x0, top.x1, top.z0, top.z1);
  if (lod === 0) rooftopUnits(g, { ring: roofRing, y: yTop }, c.frame, drng.int(1, 3), 'split');
  // pool and deck behind
  const pw = rng.range(4.5, 6.5);
  const pl = Math.min(W * 0.8, rng.range(12, 18));
  const pr: Rect = { x0: (lower.x0 + lower.x1) / 2 - pl / 2, x1: (lower.x0 + lower.x1) / 2 + pl / 2, z0: lower.z1 + 3, z1: lower.z1 + 3 + pw };
  const regionLocal: P2[] = region.map((p) => c.frame.toLocal(p));
  if (rectInside({ x0: pr.x0 - 0.6, x1: pr.x1 + 0.6, z0: pr.z0 - 0.6, z1: pr.z1 + 0.6 }, regionLocal)) pool(g, c.frame, pr);
  driveway(g, lower.x0 + s.bayW / 2, 5, c.minZ + 0.1, lower.z0);
  g.info.style = 'modern-mansion';
  g.info.floors = floors;
  g.info.height = yTop - base;
  g.info.roofY = yTop;
  g.info.topY = yTop;
  g.info.roofType = 'flat';
  g.info.footprint = c.frame.rect(lower.x0, lower.x1, lower.z0, lower.z1);
  g.info.roofAreas.push({ ring: roofRing, y: yTop });
}
