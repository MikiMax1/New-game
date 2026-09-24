// Low and mid-rise buildings: older downtown concrete blocks with punched or ribbon
// windows (water tanks, bulkheads, cornices), low-rise commercial, civic buildings,
// port offices and parking garages.

import { CONCRETE, MEMBRANES, SHOP_WALLS, WHITES, hex, pickHex, shade } from '../colors';
import { DSURF, FLAG, GLASS, GND, OCC, PAT, WSURF } from '../constants';
import type { FacadeSpec } from '../emit';
import { edgeNormal, rectD, rectW, simplifyRing } from '../geom';
import { buildable, fitRect } from '../lot';
import {
  type GenCtx, SKIRT, addEntrance, bulkhead, clamp, flatRoof, ledge, mainEdge, rooftopUnits, spec, streetEdges, waterTank, withSpec,
} from './common';

export type MidKind = 'office' | 'residential' | 'hotel' | 'commercial' | 'civic' | 'port' | 'parking';

export function genMidrise(g: GenCtx, kind: MidKind): void {
  const { c, rng, drng, lod, em, base, lot } = g;
  const office = kind === 'office' || kind === 'port' || kind === 'civic';
  const parking = kind === 'parking';
  const floorH = parking ? 3.05 : office ? rng.range(3.5, 3.9) : rng.range(3.0, 3.3);
  const groundH = parking ? 3.6 : rng.range(4.2, 5.0);
  const minF = kind === 'commercial' ? 1 : kind === 'port' ? 2 : 3;
  const maxF = kind === 'port' ? 4 : kind === 'commercial' ? 5 : kind === 'civic' ? 6 : parking ? 8 : 15;
  // narrow lots cannot carry tall buildings
  const slender = Math.min(c.width, c.depth);
  const hMax = Math.max(groundH + floorH * minF, slender * 5);
  const H = Math.min(lot.heightHint, hMax);
  const floors = clamp(Math.round((H - groundH) / floorH) + 1, minF, maxF);
  const topH = groundH + (floors - 1) * floorH;
  const setback = kind === 'civic' ? rng.range(4, 8) : kind === 'port' ? rng.range(3, 6) : 0;
  let ring = buildable(c, setback, kind === 'civic' ? 3 : 0, kind === 'civic' ? 4 : rng.range(0, 2));
  if (!ring) return;
  ring = simplifyRing(ring, 0.5);
  if (kind === 'civic' || kind === 'port') {
    const r = fitRect(c, ring);
    if (!r || rectW(r) < 6 || rectD(r) < 6) return;
    ring = c.frame.rect(r.x0, r.x1, r.z0, r.z1);
  }
  const old = kind !== 'civic' && kind !== 'port' && rng.chance(0.65);
  const wall = parking ? pickHex(rng, CONCRETE, 0.04) : kind === 'commercial' ? pickHex(rng, [...SHOP_WALLS.slice(0, 6), ...CONCRETE], 0.04) : old ? pickHex(rng, CONCRETE, 0.05) : pickHex(rng, [...WHITES, ...CONCRETE], 0.04);
  const trim = shade(wall, rng.range(0.78, 1.08));
  const ribbon = !parking && (kind === 'port' || kind === 'civic' || (office && rng.chance(0.55)));
  const occ = kind === 'hotel' ? OCC.HOTEL : office ? OCC.OFFICE : kind === 'commercial' ? OCC.RETAIL : OCC.RESIDENTIAL;
  const base0: FacadeSpec = parking
    ? spec(g, {
        pattern: PAT.GARAGE, floorH, bayW: rng.range(7.8, 8.8), groundH, topH, winW: 8, winH: 1.9, sill: 1.0, depth: 14,
        glass: GLASS.CLEAR, surface: WSURF.CONCRETE, wall, trim: shade(wall, 0.85), occ: OCC.RETAIL, ground: GND.PARKING,
      })
    : ribbon
      ? spec(g, {
          pattern: PAT.RIBBON, floorH, bayW: rng.range(1.3, 1.7), groundH, topH, winW: 1.6, winH: rng.range(1.5, 1.9), sill: rng.range(0.8, 1.0),
          depth: 0.12, glass: rng.pick([GLASS.TEAL, GLASS.DARK, GLASS.CLEAR, GLASS.GREEN, GLASS.BRONZE]), surface: rng.chance(0.5) ? WSURF.CONCRETE : WSURF.PANEL,
          wall, trim: rng.chance(0.5) ? hex('#3b3d40') : shade(wall, 0.8), occ, ground: GND.SHOP,
        })
      : spec(g, {
          pattern: PAT.PUNCHED, floorH, bayW: rng.range(2.9, 3.6), groundH, topH, winW: rng.range(1.1, 1.5), winH: rng.range(1.4, 1.75), sill: 0.85,
          depth: 0.18, glass: rng.pick([GLASS.CLEAR, GLASS.CLEAR, GLASS.TEAL, GLASS.DARK]), surface: old ? WSURF.CONCRETE : WSURF.STUCCO,
          wall, trim, occ, ground: GND.SHOP, flags: (old && rng.chance(0.6) ? FLAG.AC : 0) | (old && rng.chance(0.25) ? FLAG.BARS : 0),
        });
  const street = streetEdges(g, ring, setback + 2);
  const main = mainEdge(g, ring, street);
  const parapet = rng.range(0.9, 1.4);
  const yTop = base + topH + parapet;
  const groundFront = kind === 'civic' || kind === 'hotel' || kind === 'port' ? GND.LOBBY : parking ? GND.PARKING : GND.SHOP;
  const fn = c.frame.dir(0, -1);
  const layouts = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const isMain = i === main;
    if (street[i] || isMain) {
      const w = em.wall(p, q, base - SKIRT, yTop, withSpec(base0, { ground: groundFront }), {
        groundOf: (b, n) => (b === Math.floor(n / 2) ? (groundFront === GND.SHOP ? GND.SHOPDOOR : groundFront) : groundFront),
      });
      if (w) {
        layouts.push(w);
        if (isMain) addEntrance(g, w, (Math.floor(w.nBays / 2) + 0.5) * w.bayW, parking ? 'garage' : groundFront === GND.LOBBY ? 'lobby' : 'shop');
      }
    } else {
      const n = edgeNormal(p, q);
      const back = n.x * fn.x + n.z * fn.z < -0.6;
      // party walls (zero setback, not on the street) are mostly blank
      const blank = setback === 0 && !back && rng.chance(0.7);
      em.wall(p, q, base - SKIRT, yTop, withSpec(base0, { ground: parking ? GND.PARKING : GND.SERVICE, pattern: blank && !parking ? PAT.BLANK : base0.pattern }));
    }
  }
  if (lod === 0 && !parking) {
    for (const w of layouts) {
      // cornice on older buildings, sunshade fins on 1960s offices
      if (old && drng.chance(0.6)) ledge(g, w, -0.15, w.len + 0.15, base + topH + parapet - 0.25, 0.3, 0.35, trim);
      if (ribbon && drng.chance(0.35)) {
        for (let f = 1; f < floors; f++) ledge(g, w, 0, w.len, base + groundH + (f - 1) * floorH + base0.sill + base0.winH + 0.25, 0.12, 0.7, trim);
      }
      // canopy over the ground floor
      if (!old && drng.chance(0.5)) ledge(g, w, 0.4, w.len - 0.4, base + groundH - 0.6, 0.25, 1.35, shade(trim, 0.9));
    }
  }
  const roof = flatRoof(g, ring, yTop, { parapet, wall, capCol: shade(wall, 1.05), roofCol: parking ? hex('#6d6e70') : pickHex(rng, MEMBRANES, 0.04), roofSurf: parking ? DSURF.PARKING : old ? DSURF.GRAVEL : DSURF.MEMBRANE, frame: c.frame });
  if (lod === 0) {
    const avoid: { x: number; z: number; r: number }[] = [];
    if (!parking && floors >= 3) {
      const b = bulkhead(g, roof, c.frame, wall, drng.range(3, 4.5), drng.range(3.5, 6), drng.range(2.8, 3.6));
      if (b) avoid.push(b);
    }
    if (old && floors >= 5 && drng.chance(0.45)) {
      const t = waterTank(g, roof, c.frame, avoid);
      if (t) avoid.push(t);
    }
    if (!parking) rooftopUnits(g, roof, c.frame, drng.int(1, 4), 'mixed', avoid);
  }
  g.info.style = parking ? 'parking-garage' : kind === 'civic' ? 'civic' : kind === 'port' ? 'port-office' : `${old ? 'old' : 'modern'}-${kind === 'commercial' ? 'lowrise' : 'midrise'}`;
  g.info.floors = floors;
  g.info.height = topH + parapet;
  g.info.roofY = roof.y;
  g.info.topY = yTop;
  g.info.roofType = 'flat';
  g.info.footprint = ring;
  g.info.roofAreas.push({ ring: roof.ring, y: roof.y });
}
