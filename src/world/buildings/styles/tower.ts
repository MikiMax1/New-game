// High-rise towers: podium (retail + parking or offices) covering the lot, tower set back
// from the street, crown (steps, mechanical penthouse, helipad, spire, LED lighting).

import type { P2, Ring } from '../../types';
import { CONCRETE, MULLIONS, WHITES, hex, jitter, pickHex, shade } from '../colors';
import { DSURF, GLASS, GND, OCC, PAT, WSURF } from '../constants';
import { FACE, type FacadeSpec } from '../emit';
import { type Rect, bbox, edgeLength, edgeNormal, insetRing, rectD, rectW, signedArea, simplifyRing } from '../geom';
import { buildable, fitRect } from '../lot';
import {
  type GenCtx, SKIRT, addEntrance, bulkhead, clamp, flatRoof, lightStrip, mainEdge, rooftopUnits, spec, streetEdges, wallFrame, withSpec,
} from './common';

type Shape = 'rect' | 'chamfer' | 'ellipse' | 'roundEnds' | 'notched';

/** Local polygon for a tower shape inside rectangle r (positive winding). */
function shapeRing(r: Rect, shape: Shape, k: number, lod: 0 | 1): { pts: P2[]; curved: boolean } {
  const { x0, x1, z0, z1 } = r;
  const w = x1 - x0;
  const d = z1 - z0;
  if (shape === 'chamfer') {
    const c = Math.min(w, d) * k;
    return {
      pts: [
        { x: x0 + c, z: z0 }, { x: x1 - c, z: z0 }, { x: x1, z: z0 + c }, { x: x1, z: z1 - c },
        { x: x1 - c, z: z1 }, { x: x0 + c, z: z1 }, { x: x0, z: z1 - c }, { x: x0, z: z0 + c },
      ],
      curved: false,
    };
  }
  if (shape === 'notched') {
    const c = Math.min(w, d) * k * 0.7;
    return {
      pts: [
        { x: x0 + c, z: z0 }, { x: x1 - c, z: z0 }, { x: x1 - c, z: z0 + c }, { x: x1, z: z0 + c },
        { x: x1, z: z1 - c }, { x: x1 - c, z: z1 - c }, { x: x1 - c, z: z1 }, { x: x0 + c, z: z1 },
        { x: x0 + c, z: z1 - c }, { x: x0, z: z1 - c }, { x: x0, z: z0 + c }, { x: x0 + c, z: z0 + c },
      ],
      curved: false,
    };
  }
  if (shape === 'ellipse') {
    const n = lod === 1 ? 10 : 20;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const pts: P2[] = [];
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2 + Math.PI / 2;
      pts.push({ x: cx + Math.cos(a) * w * 0.5, z: cz + Math.sin(a) * d * 0.5 });
    }
    return { pts, curved: true };
  }
  if (shape === 'roundEnds') {
    const seg = lod === 1 ? 3 : 7;
    const pts: P2[] = [];
    if (w >= d) {
      const r0 = d / 2;
      const cz = (z0 + z1) / 2;
      // right end cap (x1 side) from angle -90 to +90, then left cap from 90 to 270
      for (let i = 0; i <= seg; i++) {
        const a = -Math.PI / 2 + (i / seg) * Math.PI;
        pts.push({ x: x1 - r0 + Math.cos(a) * r0, z: cz + Math.sin(a) * r0 });
      }
      for (let i = 0; i <= seg; i++) {
        const a = Math.PI / 2 + (i / seg) * Math.PI;
        pts.push({ x: x0 + r0 + Math.cos(a) * r0, z: cz + Math.sin(a) * r0 });
      }
    } else {
      const r0 = w / 2;
      const cx = (x0 + x1) / 2;
      for (let i = 0; i <= seg; i++) {
        const a = Math.PI + (i / seg) * Math.PI;
        pts.push({ x: cx + Math.cos(a) * r0, z: z0 + r0 + Math.sin(a) * r0 });
      }
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI;
        pts.push({ x: cx + Math.cos(a) * r0, z: z1 - r0 + Math.sin(a) * r0 });
      }
    }
    return { pts, curved: true };
  }
  return { pts: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], curved: false };
}

/**
 * Walls around a ring. Runs of short edges with small turning angles (curves) become
 * smooth strips with continuous u; long edges are separate walls.
 */
function towerWalls(g: GenCtx, ring: Ring, y0: number, y1: number, s: FacadeSpec, curved: boolean): void {
  const n = ring.length;
  if (!curved) {
    for (let i = 0; i < n; i++) g.em.wall(ring[i], ring[(i + 1) % n], y0, y1, s);
    return;
  }
  // classify edges: "straight" edges are long compared to the average
  const lens = ring.map((p, i) => edgeLength(p, ring[(i + 1) % n]));
  const avg = lens.reduce((a, b) => a + b, 0) / n;
  const straight = lens.map((l) => l > avg * 2.2);
  if (!straight.some((x) => x)) {
    // closed smooth loop: one strip through all points
    const pts = [...ring, ring[0]];
    const n0 = edgeNormal(ring[n - 1], ring[0]);
    const n1 = edgeNormal(ring[0], ring[1]);
    const nm = { x: n0.x + n1.x, z: n0.z + n1.z };
    const l = Math.hypot(nm.x, nm.z) || 1;
    const nn = { x: nm.x / l, z: nm.z / l };
    g.em.wallStrip(pts, y0, y1, s, s.ground, nn, nn);
    return;
  }
  // start at a straight edge, walk runs of curved edges
  const start = straight.indexOf(true);
  for (let k = 0; k < n; ) {
    const i = (start + k) % n;
    if (straight[i]) {
      g.em.wall(ring[i], ring[(i + 1) % n], y0, y1, s);
      k++;
      continue;
    }
    const pts: P2[] = [ring[i]];
    let j = i;
    while (k < n && !straight[j]) {
      pts.push(ring[(j + 1) % n]);
      k++;
      j = (j + 1) % n;
    }
    const prev = (i - 1 + n) % n;
    const nStart = edgeNormal(ring[prev], ring[i]);
    const nEnd = edgeNormal(ring[j], ring[(j + 1) % n]);
    g.em.wallStrip(pts, y0, y1, s, s.ground, straight[prev] ? nStart : undefined, straight[j] ? nEnd : undefined);
  }
}

export function genTower(g: GenCtx, kind: 'office' | 'condo' | 'hotel', beach = false): void {
  const { c, rng, drng, lod, em, base, lot } = g;
  const office = kind === 'office';
  // ---------------------------------------------------------------- palette & facade
  const glass = office
    ? rng.pick([GLASS.TEAL, GLASS.BLUE, GLASS.SILVER, GLASS.DARK, GLASS.BRONZE, GLASS.GREEN, GLASS.LOWE, GLASS.BLUE])
    : rng.pick([GLASS.LOWE, GLASS.GREEN, GLASS.CLEAR, GLASS.BLUE, GLASS.TEAL, GLASS.LOWE]);
  const mullion = pickHex(rng, MULLIONS, 0.03);
  const slab = beach ? pickHex(rng, WHITES, 0.02) : rng.chance(0.6) ? pickHex(rng, WHITES, 0.03) : pickHex(rng, CONCRETE, 0.04);
  const podiumCol = rng.chance(0.5) ? pickHex(rng, CONCRETE, 0.05) : slab;
  const crown = rng.chance(beach ? 0.25 : 0.4) ? rng.int(1, 7) : 0;
  const floorH = office ? rng.range(3.9, 4.2) : rng.range(3.05, 3.3);
  const balcony = !office && (kind === 'condo' || rng.chance(0.6));
  const flags = (office && rng.chance(0.3) ? 512 : 0) | (office && rng.chance(0.3) ? 1024 : 0) | (balcony && rng.chance(0.3) ? 64 : 0) | (balcony && rng.chance(0.6) ? 32 : 0);
  const towerSpec0: FacadeSpec = office
    ? spec(g, {
        pattern: PAT.CURTAIN, floorH, bayW: 1.5, winW: 1.44, sill: rng.pick([0.1, 0.1, 0.75]), winH: 0, depth: 0.08,
        glass, surface: WSURF.PANEL, wall: rng.chance(0.5) ? shade(mullion, 0.9) : jitter(hex('#3a4046'), rng), trim: mullion,
        occ: OCC.OFFICE, crown, flags,
      })
    : balcony
      ? spec(g, {
          pattern: PAT.BALCONY, floorH, bayW: rng.range(3.0, 4.2), winW: 9, sill: 0.25, winH: 2.45, depth: rng.range(1.6, 2.3),
          glass, surface: WSURF.CONCRETE, wall: slab, trim: rng.chance(0.5) ? hex('#d8dde0') : mullion,
          occ: kind === 'hotel' ? OCC.HOTEL : OCC.RESIDENTIAL, crown, flags,
        })
      : spec(g, {
          pattern: PAT.CURTAIN, floorH, bayW: rng.range(1.4, 1.8), winW: 1.6, sill: 0.1, winH: 0, depth: 0.08,
          glass, surface: WSURF.PANEL, wall: slab, trim: mullion, occ: OCC.HOTEL, crown, flags: flags | 1024,
        });
  if (towerSpec0.pattern === PAT.CURTAIN) towerSpec0.winH = floorH - towerSpec0.sill - rng.range(0.9, 1.2);
  // ---------------------------------------------------------------- podium
  const lotRing = simplifyRing(buildable(c, 0, 0, 0) ?? c.ring, 0.6);
  const small = c.area < 1200 || Math.min(c.width, c.depth) < 26;
  const podFloors = small ? 0 : beach ? rng.int(2, 4) : rng.int(office ? 3 : 4, office ? 6 : 8);
  const groundH = rng.range(5.0, 6.0);
  const garage = !office ? rng.chance(0.75) : rng.chance(0.45);
  const podFloorH = garage ? 3.1 : 4.2;
  const podH = podFloors > 0 ? groundH + (podFloors - 1) * podFloorH : 0;
  const podTop = base + podH;
  if (podFloors > 0) {
    const street = streetEdges(g, lotRing, 2.0);
    const main = mainEdge(g, lotRing, street);
    const podSpec = spec(g, {
      pattern: garage ? PAT.GARAGE : PAT.CURTAIN, floorH: podFloorH, bayW: garage ? rng.range(7.8, 9.0) : 1.5,
      groundH, topH: podH, winW: garage ? 8 : 1.44, winH: garage ? 1.9 : podFloorH - 1.2, sill: garage ? 1.0 : 0.1, depth: garage ? 12 : 0.08,
      glass, surface: garage ? WSURF.CONCRETE : WSURF.PANEL, wall: podiumCol, trim: garage ? shade(podiumCol, 0.85) : mullion,
      occ: garage ? OCC.RETAIL : OCC.OFFICE, flags: garage && rng.chance(0.5) ? 512 : 0, ground: GND.SHOP,
    });
    const yTopWall = podTop + 1.1;
    for (let i = 0; i < lotRing.length; i++) {
      const p = lotRing[i];
      const q = lotRing[(i + 1) % lotRing.length];
      if (street[i]) {
        const isMain = i === main;
        const w = em.wall(p, q, base - SKIRT, yTopWall, podSpec, {
          groundOf: (b, n) => {
            if (isMain) {
              const lobbyBays = Math.max(1, Math.round(7 / (edgeLength(p, q) / n)));
              const mid = Math.floor(n / 2);
              if (b >= mid - Math.floor(lobbyBays / 2) && b < mid - Math.floor(lobbyBays / 2) + lobbyBays) return GND.LOBBY;
            }
            return GND.SHOP;
          },
        });
        if (w && isMain) {
          addEntrance(g, w, w.len / 2, 'lobby');
          if (lod === 0) {
            const cw = Math.min(w.len * 0.6, drng.range(8, 12));
            const f = wallFrame(w);
            const u0 = w.len / 2 - cw / 2;
            const u1 = w.len / 2 + cw / 2;
            const yc = base + groundH - 1.2;
            em.box(f, u0, u1, yc, yc + 0.4, 0, 1.4, shade(mullion, 0.8), DSURF.PLAIN, FACE.ALL & ~FACE.FRONT & ~FACE.BOTTOM);
            em.hquad(f.toWorld(u0, 0), f.toWorld(u1, 0), f.toWorld(u1, 1.4), f.toWorld(u0, 1.4), yc, false, hex('#d9d4c8'), DSURF.CANOPY, f);
          }
        }
      } else {
        const w = em.wall(p, q, base - SKIRT, yTopWall, withSpec(podSpec, { ground: GND.SERVICE, pattern: garage ? PAT.GARAGE : PAT.BLANK }));
        if (w && garage && i === (main + 1) % lotRing.length && w.len > 12) addEntrance(g, w, w.len / 2, 'garage');
      }
    }
    flatRoof(g, lotRing, yTopWall, { parapet: 1.1, wall: podiumCol, roofCol: hex('#b9b7b0'), roofSurf: garage ? DSURF.PARKING : DSURF.MEMBRANE, frame: c.frame });
  }
  // ---------------------------------------------------------------- tower footprint
  const sb = podFloors > 0 ? { f: rng.range(5, 9), s: rng.range(3, 6), r: rng.range(3, 6) } : { f: 0, s: 0, r: 0 };
  const region = podFloors > 0 ? buildable(c, sb.f, sb.s, sb.r) : lotRing;
  let rect = region ? fitRect(c, region) : null;
  if (!rect) rect = fitRect(c, lotRing);
  if (!rect) return;
  const maxW = office ? rng.range(34, 50) : rng.range(38, 58);
  const maxD = office ? rng.range(30, 44) : rng.range(20, 28);
  const wantAlongX = rectW(rect) >= rectD(rect);
  const limW = wantAlongX ? maxW : maxD;
  const limD = wantAlongX ? maxD : maxW;
  if (rectW(rect) > limW) {
    const cx = (rect.x0 + rect.x1) / 2 + (rectW(rect) - limW) * (rng.next() - 0.5) * 0.6;
    rect = { ...rect, x0: cx - limW / 2, x1: cx + limW / 2 };
  }
  if (rectD(rect) > limD) {
    const z0 = podFloors > 0 && rng.chance(0.5) ? rect.z0 : (rect.z0 + rect.z1) / 2 - limD / 2;
    rect = { ...rect, z0, z1: z0 + limD };
  }
  if (rectW(rect) < 8 || rectD(rect) < 8) return;
  const shapes: Shape[] = office ? ['rect', 'rect', 'chamfer', 'notched'] : beach ? ['roundEnds', 'ellipse', 'rect', 'chamfer'] : ['rect', 'roundEnds', 'ellipse', 'chamfer'];
  const shape = rng.pick(shapes);
  const { pts, curved } = shapeRing(rect, shape, rng.range(0.1, 0.18), lod);
  const tRing = pts.map((p) => c.frame.toWorld(p.x, p.z));
  if (signedArea(tRing) < 20) return;
  // ---------------------------------------------------------------- tower height
  const minH = office ? 70 : 50;
  const H = clamp(lot.heightHint, minH, office ? 280 : 240);
  const tFloors = Math.max(8, Math.round((H - podH - 3) / floorH));
  const tBase = podFloors > 0 ? podTop : base;
  const firstFloor = podFloors > 0 ? podH : groundH;
  const tTop = base + firstFloor + (podFloors > 0 ? tFloors : tFloors - 1) * floorH;
  const parapetH = office ? rng.range(1.5, 3.5) : rng.range(1.4, 2.6);
  const towerSpec = withSpec(towerSpec0, { groundH: firstFloor, topH: tTop - base, ground: podFloors > 0 ? GND.SAME : GND.LOBBY });
  // stepped crown for offices: last floors set back
  const steps = office && rng.chance(0.45) && tFloors > 20 ? rng.int(1, 2) : 0;
  const stepFloors = rng.int(2, 4);
  const mainTop = tTop - steps * stepFloors * floorH;
  towerWalls(g, tRing, tBase - (podFloors > 0 ? 0.3 : SKIRT), mainTop + (steps > 0 ? 0 : parapetH), withSpec(towerSpec, { topH: mainTop - base }), curved);
  if (podFloors === 0) {
    const street = streetEdges(g, tRing, 3);
    const m = mainEdge(g, tRing, street);
    const a = tRing[m];
    const b = tRing[(m + 1) % tRing.length];
    const n = edgeNormal(a, b);
    const mid = { x: (a.x + b.x) / 2 + n.x * 0.3, z: (a.z + b.z) / 2 + n.z * 0.3 };
    g.info.entrances.push({ x: mid.x, y: base, z: mid.z, nx: n.x, nz: n.z, kind: 'lobby' });
  }
  let topRing = tRing;
  let yWallTop = mainTop;
  for (let s = 0; s < steps; s++) {
    // setback step: the lower roof ring and a smaller volume on top
    const inset = rng.range(2.2, 3.6);
    const next = insetRing(topRing, inset);
    if (!next) break;
    // terrace roof of the step (the smaller volume above hides its middle)
    em.flat(topRing, yWallTop, true, hex('#9e9c96'), DSURF.MEMBRANE);
    const y1 = yWallTop + stepFloors * floorH;
    const last = s === steps - 1;
    towerWalls(g, next, yWallTop - 0.2, y1 + (last ? parapetH : 0), withSpec(towerSpec, { topH: y1 - base }), curved);
    topRing = next;
    yWallTop = y1;
  }
  const roof = flatRoof(g, topRing, yWallTop + parapetH, { parapet: parapetH - 0.2, wall: towerSpec.wall, capCol: shade(mullion, 1.1), roofCol: hex('#a8a6a0'), roofSurf: DSURF.MEMBRANE, frame: c.frame });
  let topY = yWallTop + parapetH;
  // ---------------------------------------------------------------- roof top
  const bb = bbox(roof.ring.map((p) => c.frame.toLocal(p)));
  const rw = bb.maxX - bb.minX;
  const rd = bb.maxZ - bb.minZ;
  const avoid: { x: number; z: number; r: number }[] = [];
  const cx = (bb.minX + bb.maxX) / 2;
  const cz = (bb.minZ + bb.maxZ) / 2;
  const heli = rng.chance(office ? 0.35 : 0.2) && Math.min(rw, rd) > 21;
  if (heli) {
    const r = Math.min(10, Math.min(rw, rd) / 2 - 0.8);
    const oct: P2[] = [];
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * Math.PI * 2;
      oct.push(c.frame.toWorld(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
    }
    const yH = roof.y + 1.6;
    if (lod === 0) {
      em.prism(oct, roof.y, yH, hex('#55575a'), DSURF.CONCRETE, false);
      em.flat(oct, yH, true, hex('#4f5155'), DSURF.HELIPAD, c.frame.offset(cx, cz));
    }
    avoid.push({ x: cx, z: cz, r: r + 0.5 });
    topY = Math.max(topY, yH);
  } else {
    // mechanical penthouse with louvres
    const mw = rw * rng.range(0.35, 0.6);
    const md = rd * rng.range(0.35, 0.6);
    if (mw > 4 && md > 4) {
      const mh = rng.range(4.5, 7.5);
      const mf = c.frame;
      const mring = mf.rect(cx - mw / 2, cx + mw / 2, cz - md / 2, cz + md / 2);
      const ms = withSpec(towerSpec, { pattern: PAT.LOUVER, floorH: mh, groundH: mh, topH: mh + (roof.y - base), bayW: 1.2, ground: GND.SAME, crown: 0 });
      for (let i = 0; i < 4; i++) em.wall(mring[i], mring[(i + 1) % 4], roof.y - 0.1, roof.y + mh, ms);
      em.flat(mring, roof.y + mh, true, hex('#9a9893'), DSURF.MEMBRANE, c.frame);
      avoid.push({ x: cx, z: cz, r: Math.hypot(mw, md) / 2 + 0.5 });
      topY = Math.max(topY, roof.y + mh);
      if (lod === 0 && drng.chance(office ? 0.35 : 0.15)) {
        const sh = drng.range(10, 26);
        const sw = drng.range(0.5, 0.9);
        em.box(c.frame.offset(cx, cz), -sw, sw, roof.y + mh, roof.y + mh + sh, -sw, sw, hex('#b8babd'), DSURF.EQUIPMENT, FACE.NO_BOTTOM);
        lightStrip(g, c.frame.offset(cx, cz), -0.25, 0.25, roof.y + mh + sh, roof.y + mh + sh + 0.4, -0.25, 0.25, [1, 0.05, 0.03]);
        topY = Math.max(topY, roof.y + mh + sh + 0.4);
      }
    }
  }
  if (lod === 0) {
    rooftopUnits(g, roof, c.frame, drng.int(2, 5), 'rtu', avoid);
    if (!heli) {
      const bh = bulkhead(g, roof, c.frame, towerSpec.wall, 3.2, 4.5, 3.2);
      if (bh) avoid.push(bh);
    }
  }
  // ---------------------------------------------------------------- info
  g.info.style = office ? 'office-tower' : kind === 'hotel' ? 'hotel-tower' : beach ? 'beach-condo' : 'condo-tower';
  g.info.floors = (podFloors > 0 ? podFloors : 1) + (podFloors > 0 ? tFloors : tFloors - 1);
  g.info.height = yWallTop + parapetH - base;
  g.info.roofY = roof.y;
  g.info.topY = topY;
  g.info.roofType = 'flat';
  g.info.footprint = podFloors > 0 ? lotRing : tRing;
  g.info.roofAreas.push({ ring: roof.ring, y: roof.y });
}
