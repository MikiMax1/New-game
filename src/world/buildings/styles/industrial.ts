// Northside / harbor: warehouses (metal or tilt-up, loading docks, roll-up doors, flat or
// sawtooth roofs), harbor sheds with low gable roofs, and strip malls behind parking.

import { ACCENTS, MEMBRANES, METAL_WALLS, SHOP_WALLS, TILTUP_WALLS, WHITES, hex, pickHex, shade } from '../colors';
import { DSURF, FLAG, GLASS, GND, OCC, PAT, SIGN_LIGHT, WSURF } from '../constants';
import { FACE, type FacadeSpec } from '../emit';
import { rectD, rectW } from '../geom';
import { buildable, fitRect } from '../lot';
import { gableRoof, sawtoothRoof } from '../roofs';
import { signIndex } from '../signs';
import {
  type GenCtx, SKIRT, addEntrance, clamp, flatRoof, parkingLot, rooftopUnits, spec, wallFrame, wallSign, withSpec,
} from './common';

export function genWarehouse(g: GenCtx, harbor = false): void {
  const { c, rng, drng, lod, em, base, lot } = g;
  const H = clamp(lot.heightHint, harbor ? 9 : 7.5, harbor ? 16 : 12.5);
  const region = buildable(c, harbor ? rng.range(4, 10) : rng.range(8, 16), rng.range(3, 6), rng.range(3, 6));
  if (!region) return;
  let r = fitRect(c, region);
  if (!r || rectW(r) < 8 || rectD(r) < 8) return;
  const maxW = harbor ? rng.range(60, 140) : rng.range(40, 110);
  const maxD = harbor ? rng.range(30, 60) : rng.range(25, 70);
  if (rectW(r) > maxW) {
    const cx = (r.x0 + r.x1) / 2;
    r = { ...r, x0: cx - maxW / 2, x1: cx + maxW / 2 };
  }
  if (rectD(r) > maxD) r = { ...r, z1: r.z0 + maxD };
  const metal = harbor ? rng.chance(0.75) : rng.chance(0.5);
  const wall = metal ? pickHex(rng, METAL_WALLS, 0.04) : pickHex(rng, TILTUP_WALLS, 0.04);
  const accent = pickHex(rng, ACCENTS, 0.04);
  const roofKind = harbor ? (rng.chance(0.65) ? 'gable' : 'flat') : rng.chance(0.25) && rectW(r) > 24 ? 'saw' : 'flat';
  const clerestory = rng.chance(0.4);
  const s = spec(g, {
    pattern: PAT.INDUSTRIAL, floorH: H, bayW: metal ? 1.0 : rng.range(6.5, 8.5), groundH: H, topH: H,
    winW: clerestory ? 3.0 : 0, winH: clerestory ? 1.0 : 0, sill: H - 2.6, depth: 0.1,
    glass: GLASS.CLEAR, surface: metal ? WSURF.METAL : WSURF.CONCRETE, wall, trim: accent, occ: OCC.RETAIL,
    flags: !metal && rng.chance(0.6) ? FLAG.SIGNBAND : 0,
  });
  const ring = c.frame.rect(r.x0, r.x1, r.z0, r.z1);
  const parapet = roofKind === 'flat' ? rng.range(0.6, 1.2) : 0;
  const yWall = base + H + parapet;
  // docks on the front (truck court) or on a side; roll-up doors on the ends
  const dockSide = rng.chance(0.6) ? 0 : 1;
  const dockSpec = withSpec(s, { bayW: 4.2 });
  const rollSpec = withSpec(s, { bayW: rng.range(6, 9) });
  for (let i = 0; i < 4; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % 4];
    if (i === dockSide) {
      const w = em.wall(p, q, base - SKIRT, yWall, dockSpec, {
        groundOf: (b, n) => (n >= 4 && b >= n - 2 ? GND.SHOP : n >= 4 && b === n - 3 ? GND.SHOPDOOR : GND.DOCK),
      });
      if (!w) continue;
      addEntrance(g, w, (w.nBays - 2.5) * w.bayW, 'main');
      addEntrance(g, w, 0.5 * w.bayW, 'dock');
      if (lod === 0) {
        // canopy over the docks
        const u1 = Math.max(0, (w.nBays - 3) * w.bayW);
        em.box(wallFrame(w), 0.2, u1, base + 5.0, base + 5.3, 0, 1.6, shade(wall, 0.85), DSURF.METAL_ROOF, FACE.ALL & ~FACE.FRONT);
        // dock apron (concrete) in front of the doors
        em.box(wallFrame(w), 0.2, u1, base - 0.2, base + 0.05, 0, 3.5, hex('#a7a49c'), DSURF.CONCRETE, FACE.NO_BOTTOM);
      }
    } else if (i === (dockSide + 2) % 4 || (harbor && i % 2 === dockSide % 2)) {
      em.wall(p, q, base - SKIRT, yWall, rollSpec, { groundOf: (b, n) => (n >= 3 && (b === 0 || b === n - 1) ? GND.BLANK : GND.ROLLUP) });
    } else {
      em.wall(p, q, base - SKIRT, yWall, withSpec(s, { ground: GND.SERVICE }));
    }
  }
  let roofY = yWall;
  let topY = yWall;
  const roofCol = pickHex(rng, MEMBRANES, 0.03);
  if (roofKind === 'gable') {
    const ridge = gableRoof(em, c.frame, r, base + H, {
      pitch: rng.range(0.14, 0.22), overhang: 0.4, col: pickHex(rng, ['#9aa3a8', '#b7b9b4', '#8a6f5c', '#c9ccc6', '#6f8a8f'], 0.04), surf: DSURF.METAL_ROOF, trim: shade(wall, 0.9), lod,
    }, withSpec(s, { winW: 0 }), rectW(r) >= rectD(r));
    topY = ridge;
    roofY = base + H;
    g.info.roofType = 'gable';
  } else if (roofKind === 'saw') {
    const teeth = clamp(Math.round(rectW(r) / rng.range(9, 12)), 2, 8);
    topY = sawtoothRoof(em, c.frame, r, base + H, teeth, rng.range(2.4, 3.2), pickHex(rng, ['#b9bcbc', '#a9aca8', '#c8c6bd'], 0.03), hex('#6d7f86'), withSpec(s, { winW: 0 }));
    roofY = base + H;
    g.info.roofType = 'sawtooth';
  } else {
    const roof = flatRoof(g, ring, yWall, { parapet, wall, capCol: shade(wall, 0.85), roofCol, roofSurf: DSURF.MEMBRANE, frame: c.frame });
    roofY = roof.y;
    g.info.roofType = 'flat';
    g.info.roofAreas.push({ ring: roof.ring, y: roof.y });
    if (lod === 0) {
      // one or two rows of skylights along the long axis, and a few package units
      const alongX = rectW(r) >= rectD(r);
      const long = alongX ? rectW(r) : rectD(r);
      const nl = clamp(Math.floor(long / 12), 1, 6);
      const nr = long > 50 && Math.min(rectW(r), rectD(r)) > 30 ? 2 : 1;
      const avoid: { x: number; z: number; r: number }[] = [];
      if (drng.chance(0.7)) {
        for (let il = 0; il < nl; il++) {
          for (let ir = 0; ir < nr; ir++) {
            const a = (il + 0.5) / nl;
            const b = (ir + 1) / (nr + 1);
            const x = r.x0 + (alongX ? a : b) * rectW(r);
            const z = r.z0 + (alongX ? b : a) * rectD(r);
            const f = c.frame.offset(x, z);
            em.box(f, -1.2, 1.2, roof.y, roof.y + 0.45, -0.9, 0.9, hex('#d9dcdc'), DSURF.PLAIN, FACE.SIDES, 0, 0);
            em.box(f, -1.15, 1.15, roof.y + 0.45, roof.y + 0.5, -0.85, 0.85, hex('#9fb4bc'), DSURF.GLASS, FACE.TOP);
            avoid.push({ x, z, r: 1.8 });
          }
        }
      }
      rooftopUnits(g, roof, c.frame, drng.int(2, 4), 'rtu', avoid);
    }
  }
  // company sign on the office corner
  if (lod === 0 && drng.chance(0.75)) {
    const text = signIndex('industrial', Math.floor(g.seed * 6007));
    const fr = ring[dockSide];
    const to = ring[(dockSide + 1) % 4];
    const len = Math.hypot(to.x - fr.x, to.z - fr.z);
    const w = { p: fr, q: to, len, n: { x: (to.z - fr.z) / len, z: -(to.x - fr.x) / len }, t: { x: (fr.x - to.x) / len, z: (fr.z - to.z) / len }, nBays: 1, bayW: len, winW: 0, y0: base, y1: yWall };
    const W = Math.min(len * 0.45, 14);
    wallSign(g, w, len * 0.72 > W / 2 + 0.5 && len * 0.72 < len - W / 2 - 0.5 ? len * 0.72 : len / 2, base + H - 1.4, W, 1.1, text, wall, drng.pick([7, 4, 6]), SIGN_LIGHT.PAINTED, 0.04);
  }
  g.info.style = harbor ? 'harbor-shed' : 'warehouse';
  g.info.floors = 1;
  g.info.height = H + parapet;
  g.info.roofY = roofY;
  g.info.topY = topY;
  g.info.footprint = ring;
}

export function genStripMall(g: GenCtx): void {
  const { c, rng, drng, lod, em, base } = g;
  const H = rng.range(5.0, 6.0);
  const parapet = rng.range(1.2, 2.0);
  const front = clamp(c.depth * 0.45, 8, rng.range(18, 34));
  const region = buildable(c, front, rng.range(2, 5), rng.range(3, 6));
  if (!region) return;
  let r = fitRect(c, region);
  if (!r || rectW(r) < 10 || rectD(r) < 8) return;
  const D = Math.min(rectD(r), rng.range(17, 24));
  r = { ...r, z1: r.z0 + D };
  const wall = rng.chance(0.5) ? pickHex(rng, SHOP_WALLS.slice(0, 8), 0.04) : pickHex(rng, WHITES, 0.03);
  const trim = pickHex(rng, ['#8a3a2a', '#2b4c7e', '#3e6b4e', '#c96a2b', '#6b6b6b', '#d8c9a8'], 0.04);
  const bay = rng.range(4.2, 5.4);
  const s: FacadeSpec = spec(g, {
    pattern: PAT.BLANK, floorH: H, bayW: bay, groundH: H, topH: H, winW: 0, winH: 0, sill: 0, depth: 0.1,
    glass: GLASS.CLEAR, surface: WSURF.STUCCO, wall, trim, occ: OCC.RETAIL, ground: GND.SHOP, flags: FLAG.DOOR_ALT,
  });
  const ring = c.frame.rect(r.x0, r.x1, r.z0, r.z1);
  const yWall = base + H + parapet;
  const fw = em.wall(ring[0], ring[1], base - SKIRT, yWall, s);
  for (let i = 1; i < 4; i++) em.wall(ring[i], ring[(i + 1) % 4], base - SKIRT, yWall, withSpec(s, { ground: GND.SERVICE }));
  if (fw) {
    for (let b = 1; b < fw.nBays; b += 2) addEntrance(g, fw, (b + 0.5) * fw.bayW, 'shop');
    // covered walkway: canopy with a tall fascia (the sign band) on columns
    const f = wallFrame(fw);
    const cd = rng.range(2.6, 3.4);
    const yc = base + 3.4;
    const fh = rng.range(1.0, 1.4);
    em.box(f, -0.3, fw.len + 0.3, yc, yc + fh, 0, cd, trim, DSURF.PLAIN, FACE.ALL & ~FACE.FRONT & ~FACE.BOTTOM, 0, 0, hex('#b5b2aa'), DSURF.MEMBRANE);
    em.hquad(f.toWorld(-0.3, 0), f.toWorld(fw.len + 0.3, 0), f.toWorld(fw.len + 0.3, cd), f.toWorld(-0.3, cd), yc, false, hex('#e8e4da'), DSURF.CANOPY, f);
    if (lod === 0) {
      for (let b = 0; b <= fw.nBays; b += 2) {
        const u = clamp(b * fw.bayW, 0.2, fw.len - 0.2);
        em.box(f, u - 0.18, u + 0.18, base, yc, cd - 0.45, cd - 0.09, shade(wall, 0.95), DSURF.PLAIN, FACE.SIDES);
      }
      // walkway slab
      em.box(f, -0.3, fw.len + 0.3, base - 0.2, base + 0.15, 0, cd, hex('#bdb8ad'), DSURF.CONCRETE, FACE.NO_BOTTOM);
      // one backlit sign per shop on the fascia
      for (let b = 0; b + 1 < fw.nBays + 1; b += 2) {
        const u0 = b * fw.bayW;
        const u1 = Math.min(fw.len, (b + 2) * fw.bayW);
        if (u1 - u0 < 3) continue;
        const text = signIndex('mall', Math.floor(g.seed * 3571) + b);
        const col = drng.pick([0, 4, 2, 3, 1, 7]);
        const sw = Math.min(u1 - u0 - 1.2, drng.range(3.5, 6.5));
        // the fascia front is the wall line moved out by the canopy depth
        const fascia = { ...fw, q: f.toWorld(0, cd), p: f.toWorld(fw.len, cd) };
        wallSign(g, fascia, (u0 + u1) / 2, yc + fh / 2, sw, fh * 0.6, text, hex('#1c1d20'), col, SIGN_LIGHT.BACKLIT, 0.03);
      }
    }
  }
  const roof = flatRoof(g, ring, yWall, { parapet: parapet - 0.3, wall, capCol: trim, roofCol: pickHex(rng, MEMBRANES, 0.03), roofSurf: DSURF.MEMBRANE, frame: c.frame });
  if (lod === 0) rooftopUnits(g, roof, c.frame, clamp(Math.round(rectW(r) / 25), 2, 5), 'rtu');
  // parking in front of the stores
  parkingLot(g, c.frame, r.x0, r.x1, Math.max(c.minZ, 0) + 1.0, r.z0 - 4.2);
  g.info.style = 'strip-mall';
  g.info.floors = 1;
  g.info.height = H + parapet;
  g.info.roofY = roof.y;
  g.info.topY = yWall;
  g.info.roofType = 'flat';
  g.info.footprint = ring;
  g.info.roofAreas.push({ ring: roof.ring, y: roof.y });
}
