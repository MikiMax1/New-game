// Little Solano: 1-3 floor stucco shops built to the sidewalk (storefronts, awnings,
// shutters, painted sign bands, murals on side walls) and small 1-floor houses.

import { AWNINGS, MEMBRANES, ROOF_TILES, SHOP_TRIMS, SHOP_WALLS, hex, pickHex, shade } from '../colors';
import { AWNING_STRIPE_COLORS, DSURF, FLAG, GLASS, GND, OCC, PAT, SIGN_LIGHT, WSURF } from '../constants';
import { FACE } from '../emit';
import { edgeNormal, rectD, rectW, simplifyRing } from '../geom';
import { buildable, fitRect } from '../lot';
import { hipRoof } from '../roofs';
import { signIndex } from '../signs';
import {
  type GenCtx, SKIRT, addEntrance, awning, clamp, flatRoof, mainEdge, rooftopUnits, spec, streetEdges, wallFrame, wallSign, withSpec,
} from './common';

export function genShop(g: GenCtx): void {
  const { c, rng, drng, lod, em, base, lot } = g;
  const floors = clamp(Math.round((lot.heightHint - 4.4) / 3.2) + 1, 1, 3);
  const groundH = floors === 1 ? rng.range(4.2, 5.2) : rng.range(3.9, 4.5);
  const floorH = rng.range(3.0, 3.3);
  const topH = groundH + (floors - 1) * floorH;
  const parapet = floors === 1 ? rng.range(0.9, 1.8) : rng.range(0.8, 1.3);
  const yTop = base + topH + parapet;
  let ring = buildable(c, 0, 0, rng.range(1.5, 4));
  if (!ring) return;
  ring = simplifyRing(ring, 0.4);
  const wall = pickHex(rng, SHOP_WALLS, 0.05);
  const trim = pickHex(rng, SHOP_TRIMS, 0.04);
  const street = streetEdges(g, ring, 1.5);
  const main = mainEdge(g, ring, street);
  const shutters = rng.chance(0.45);
  const upperFlags = (rng.chance(0.45) ? FLAG.BARS : 0) | (rng.chance(0.5) ? FLAG.AC : 0);
  const frontSpec = spec(g, {
    pattern: PAT.PUNCHED, floorH, bayW: rng.range(3.0, 3.8), groundH, topH, winW: rng.range(1.0, 1.3), winH: rng.range(1.3, 1.5),
    sill: 0.9, depth: 0.14, glass: GLASS.CLEAR, surface: WSURF.STUCCO, wall, trim, occ: OCC.RETAIL,
    flags: upperFlags | (rng.chance(0.55) ? FLAG.SIGNBAND : 0), ground: shutters ? GND.SHUTTER : GND.SHOP,
  });
  const mural = c.corner || rng.chance(0.15);
  const sideSpec = withSpec(frontSpec, { pattern: PAT.BLANK, ground: GND.BLANK, flags: mural && rng.chance(0.7) ? FLAG.MURAL : 0 });
  const backSpec = withSpec(frontSpec, { ground: GND.SERVICE, flags: upperFlags & FLAG.BARS, wall: shade(wall, 0.95) });
  const fn = c.frame.dir(0, -1);
  let mainW = null;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    if (street[i]) {
      const isMain = i === main;
      const w = em.wall(p, q, base - SKIRT, yTop, frontSpec, {
        groundOf: (b, n) => (b === Math.floor(n / 2) ? GND.SHOPDOOR : frontSpec.ground),
      });
      if (!w) continue;
      addEntrance(g, w, (Math.floor(w.nBays / 2) + 0.5) * w.bayW, isMain ? 'shop' : 'service');
      if (isMain) mainW = w;
      if (lod === 0 && (isMain || drng.chance(0.5)) && drng.chance(0.75)) {
        // awning over the storefront
        const col = pickHex(drng, AWNINGS, 0.04);
        const stripes = drng.chance(0.45) ? drng.pick([0.3, 0.45, 0.6]) : 0;
        const per = w.nBays >= 2 && drng.chance(0.5);
        const depth = Math.min(1.4, drng.range(1.0, 1.4));
        const stripeCol = drng.int(0, AWNING_STRIPE_COLORS.length - 1);
        if (per) {
          for (let b = 0; b < w.nBays; b++) awning(g, w, b * w.bayW + 0.25, (b + 1) * w.bayW - 0.25, base + groundH - 0.95, depth, 0.65, col, stripes, stripeCol);
        } else {
          awning(g, w, 0.35, w.len - 0.35, base + groundH - 0.95, depth, 0.65, col, stripes, stripeCol);
        }
      }
    } else {
      const n = edgeNormal(p, q);
      const isBack = n.x * fn.x + n.z * fn.z < -0.6;
      em.wall(p, q, base - SKIRT, yTop, isBack ? backSpec : sideSpec);
    }
  }
  // painted / box sign above the storefront
  if (mainW && lod === 0 && drng.chance(0.85)) {
    const w = mainW;
    const text = signIndex('shop', Math.floor(g.seed * 7919));
    const W = Math.min(w.len - 0.8, drng.range(4.5, 9));
    const painted = drng.chance(0.55);
    const y = base + groundH - 0.5 + (floors === 1 ? 0.2 : 0);
    if (W > 2) {
      wallSign(g, w, w.len / 2, y, W, painted ? 0.62 : 0.75, text, painted ? wall : pickHex(drng, ['#f2efe6', '#1f3b66', '#8a1f1f', '#f2d24b'], 0.02), drng.pick([6, 7, 4, 0, 2]), painted ? SIGN_LIGHT.PAINTED : SIGN_LIGHT.BACKLIT, painted ? 0.04 : 0.16, !painted);
    }
  }
  // raised front parapet ("false front")
  if (mainW && lod === 0 && drng.chance(0.55)) {
    const w = mainW;
    const f = wallFrame(w);
    const rw = w.len * drng.range(0.35, 0.65);
    const rh = drng.range(0.7, 1.6);
    em.box(f, w.len / 2 - rw / 2, w.len / 2 + rw / 2, yTop - 0.1, yTop + rh, -0.3, 0.0, wall, DSURF.PLAIN, FACE.ALL & ~FACE.BOTTOM, 0, 0, shade(wall, 1.04));
    em.box(f, w.len / 2 - rw / 2 - 0.08, w.len / 2 + rw / 2 + 0.08, yTop + rh, yTop + rh + 0.12, -0.38, 0.08, trim, DSURF.PLAIN, FACE.ALL);
  }
  const roof = flatRoof(g, ring, yTop, { parapet, wall, capCol: shade(trim, 1.0), roofCol: pickHex(rng, MEMBRANES, 0.03), roofSurf: rng.chance(0.5) ? DSURF.GRAVEL : DSURF.MEMBRANE, frame: c.frame });
  rooftopUnits(g, roof, c.frame, drng.int(1, 3), 'mixed');
  g.info.style = 'stucco-shop';
  g.info.floors = floors;
  g.info.height = topH + parapet;
  g.info.roofY = roof.y;
  g.info.topY = yTop + 1.8;
  g.info.roofType = 'flat';
  g.info.footprint = ring;
  g.info.roofAreas.push({ ring: roof.ring, y: roof.y });
}

/** Small 1-floor house (or 2-3 floor garden apartments) with bars on the windows. */
export function genSmallHouse(g: GenCtx): void {
  const { c, rng, drng, lod, em, base, lot } = g;
  const apartments = lot.heightHint > 6.5;
  const floors = apartments ? clamp(Math.round(lot.heightHint / 3.0), 2, 3) : 1;
  const floorH = 3.0;
  const region = buildable(c, rng.range(3.5, 6), rng.range(1.2, 2.0), rng.range(2.5, 4));
  if (!region) return;
  let r = fitRect(c, region);
  if (!r || rectW(r) < 4 || rectD(r) < 4) return;
  const W = Math.min(rectW(r), apartments ? rng.range(14, 24) : rng.range(8.5, 13));
  const D = Math.min(rectD(r), apartments ? rng.range(12, 18) : rng.range(9.5, 14));
  const cx = (r.x0 + r.x1) / 2 + (rectW(r) - W) * (rng.next() - 0.5) * 0.4;
  r = { x0: cx - W / 2, x1: cx + W / 2, z0: r.z0, z1: r.z0 + D };
  const ring = c.frame.rect(r.x0, r.x1, r.z0, r.z1);
  const wall = pickHex(rng, SHOP_WALLS, 0.05);
  const trim = pickHex(rng, ['#f4f1ea', '#e8e2d2', '#2f5d8a', '#5a3e2b'], 0.03);
  const topH = floors * floorH + 0.3;
  const hip = !apartments && rng.chance(0.6);
  const parapet = hip ? 0 : rng.range(0.5, 0.9);
  const yWall = base + topH + parapet;
  const s = spec(g, {
    pattern: PAT.PUNCHED, floorH, bayW: rng.range(2.8, 3.4), groundH: floorH + 0.3, topH, winW: rng.range(0.9, 1.15), winH: rng.range(1.2, 1.4),
    sill: 0.95, depth: 0.12, glass: GLASS.CLEAR, surface: WSURF.STUCCO, wall, trim, occ: OCC.RESIDENTIAL,
    flags: (rng.chance(0.6) ? FLAG.BARS : 0) | (rng.chance(0.45) ? FLAG.AC : 0),
  });
  const doorBay = rng.int(0, 2);
  for (let i = 0; i < 4; i++) {
    const w = em.wall(ring[i], ring[(i + 1) % 4], base - SKIRT, yWall, s, i === 0 ? { groundOf: (b, n) => (b === Math.min(n - 1, doorBay) ? GND.DOOR : GND.SAME) } : undefined);
    if (w && i === 0) {
      const uDoor = (Math.min(w.nBays - 1, doorBay) + 0.5) * w.bayW;
      addEntrance(g, w, uDoor, 'main');
      if (lod === 0 && drng.chance(0.55)) {
        // porch roof on two posts
        const f = wallFrame(w);
        const pw = Math.min(w.len - 0.4, drng.range(2.6, 4.2));
        const pd = drng.range(1.6, 2.2);
        const u0 = clamp(uDoor - pw / 2, 0.2, w.len - pw - 0.2);
        const yp = base + 2.7;
        em.box(f, u0, u0 + pw, yp, yp + 0.18, 0, pd, trim, DSURF.PLAIN, FACE.ALL & ~FACE.FRONT);
        for (const x of [u0 + 0.12, u0 + pw - 0.12]) em.box(f, x - 0.08, x + 0.08, base, yp, pd - 0.25, pd - 0.09, trim, DSURF.PLAIN, FACE.SIDES);
        em.box(f, u0, u0 + pw, base - 0.2, base + 0.18, 0, pd, hex('#bdb6a8'), DSURF.CONCRETE, FACE.NO_BOTTOM);
      }
    }
  }
  let roofY = yWall;
  if (hip) {
    const tile = rng.chance(0.5);
    const ridge = hipRoof(em, c.frame, r, yWall, {
      pitch: rng.range(0.25, 0.4), overhang: rng.range(0.35, 0.55), col: tile ? pickHex(rng, ROOF_TILES, 0.05) : pickHex(rng, ['#5b5a58', '#7a6a5a', '#8a8d90', '#6b4f45'], 0.04),
      surf: tile ? DSURF.TILE : DSURF.SHINGLE, trim: shade(trim, 1), lod,
    });
    g.info.topY = ridge;
    g.info.roofType = 'hip';
  } else {
    const roof = flatRoof(g, ring, yWall, { parapet, wall, roofCol: pickHex(rng, MEMBRANES, 0.03), roofSurf: DSURF.GRAVEL, frame: c.frame });
    rooftopUnits(g, roof, c.frame, drng.int(0, 2), 'split');
    roofY = roof.y;
    g.info.topY = yWall;
    g.info.roofType = 'flat';
    g.info.roofAreas.push({ ring: roof.ring, y: roof.y });
  }
  g.info.style = apartments ? 'garden-apartments' : 'small-house';
  g.info.floors = floors;
  g.info.height = topH + parapet;
  g.info.roofY = roofY;
  g.info.footprint = ring;
}

/** Tiny lots: a kiosk with a roll-down front, or nothing when there is no room. */
export function genKiosk(g: GenCtx): void {
  const { c, rng, em, base } = g;
  const r0 = fitRect(c, c.ring);
  if (!r0 || rectW(r0) < 1.6 || rectD(r0) < 1.6) return;
  const W = Math.min(rectW(r0), 6);
  const D = Math.min(rectD(r0), 5);
  const r = { x0: (r0.x0 + r0.x1) / 2 - W / 2, x1: (r0.x0 + r0.x1) / 2 + W / 2, z0: r0.z0, z1: r0.z0 + D };
  const ring = c.frame.rect(r.x0, r.x1, r.z0, r.z1);
  const wall = pickHex(rng, SHOP_WALLS, 0.05);
  const s = spec(g, {
    pattern: PAT.BLANK, floorH: 3, bayW: Math.max(1.5, W / 2), groundH: 2.9, topH: 2.9, winW: 0, winH: 0, sill: 0, depth: 0.1,
    wall, trim: pickHex(rng, SHOP_TRIMS, 0.03), occ: OCC.RETAIL, ground: GND.SHUTTER,
  });
  for (let i = 0; i < 4; i++) {
    const w = em.wall(ring[i], ring[(i + 1) % 4], base - SKIRT, base + 3.3, i === 0 ? s : withSpec(s, { ground: GND.BLANK }));
    if (w && i === 0) addEntrance(g, w, w.len / 2, 'shop');
  }
  flatRoof(g, ring, base + 3.3, { parapet: 0.3, wall, roofCol: hex('#b5b2aa'), roofSurf: DSURF.MEMBRANE, frame: c.frame });
  g.info.style = 'kiosk';
  g.info.floors = 1;
  g.info.height = 3.3;
  g.info.roofY = base + 3.0;
  g.info.topY = base + 3.3;
  g.info.roofType = 'flat';
  g.info.footprint = ring;
}
