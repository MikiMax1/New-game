// Procedural buildings along both sides of the street.
//
// Each side is a row of buildings, 9–34 m wide, laid end to end along the building line (see
// layout.ts) from far down the street (x = -520) to behind the camera (x = +140). Within 110 m of
// the crossing they are modelled in full; beyond that they are simpler blocks that only need to
// read at a distance through the haze.
//
// A building is described in its own frame: x along the facade from its left end (as seen from
// the street), y up from the pavement, z out of the facade towards the street, with the facade
// plane at z = 0. Its facade is a grid of bays × storeys: a 4.5 m ground floor (shop fronts or a
// lobby) under 3.3 m upper storeys. Each upper-storey bay has a window opening with 15–25 cm
// reveals, a frame with mullions, a projecting sill and, depending on the style:
//
//   deco      Miami Art Deco: pastel stucco, eyebrow ledges over the windows, string courses at
//             each floor, a central tower of vertical fins rising above a stepped parapet
//   mimo      Miami Modern: cantilevered balconies with ship's-rail railings, deep slabs
//   classic   older masonry style: a moulded cornice, lintels and heavy sills, darker render
//   glass     a curtain-wall tower: storey-high glazing between mullions, spandrel bands
//
// All of it goes into one MeshBuilder: one merged mesh with a draw group per material, so the
// whole street costs a draw call per material rather than per building or per window.
import { Color, Group, Matrix4, type Material } from 'three/webgpu';
import type { CityContext } from './context';
import { BUILDING_Z, CROSSING_X } from './layout';
import { MeshBuilder } from './buildings/MeshBuilder';
import { windowGlass } from './buildings/Windows';
import { pavementHeight } from './Street';

type Style = 'deco' | 'mimo' | 'classic' | 'glass';

interface Building {
  /** +1 north side (facing -z), -1 south side (facing +z). */
  side: 1 | -1;
  /** World x of the facade's local x = 0. */
  x: number;
  width: number;
  depth: number;
  /** Upper storeys above the ground floor. */
  storeys: number;
  style: Style;
  tint: string;
  /** Bay width, metres (the facade is width / bays). */
  bays: number;
  seed: number;
  detailed: boolean;
}

const GROUND = 4.5;
const STOREY = 3.3;
const PARAPET = 1.1;
/** Buildings run from here to here along each side. */
const ROW_START = -520;
const ROW_END = 140;
/** Full detail within this distance of the crossing; simple blocks beyond. */
const DETAIL_RANGE = 110;

/** Muted Miami palette (linear-ish sRGB hex), plus plainer renders. */
const TINTS: Record<Style, string[]> = {
  deco: ['#e9d8c4', '#e8c9c3', '#cfe0d6', '#f0e2b8', '#d8d2e6', '#f2ece0'],
  mimo: ['#ece8df', '#dfe3e2', '#f1e6d3'],
  classic: ['#c9b49c', '#b89a82', '#d6c8b2', '#a88f7c'],
  glass: ['#9aa4a6'],
};

interface Palette {
  wall(tint: string): Material;
  trim: Material;
  frame: Material;
  darkFrame: Material;
  glass: Material;
  shop: Material;
  tower: Material;
  spandrel: Material;
  rail: Material;
  plant: Material;
  roof: Material;
}

export function buildBuildings(ctx: CityContext): Group {
  const group = new Group();
  group.name = 'Buildings';
  const m = ctx.materials;
  const palette: Palette = {
    wall: (tint) => m.stucco(tint),
    trim: m.stucco('#f4f1ea'),
    frame: m.paintedMetal('#e8e6e0', 0.35),
    darkFrame: m.paintedMetal('#2a2c2e', 0.4),
    glass: windowGlass(),
    shop: windowGlass({ shop: true, tint: new Color(0.9, 0.93, 0.92) }),
    tower: windowGlass({ coating: 0.75, tint: new Color(0.55, 0.68, 0.7), litShare: 0.25 }),
    spandrel: m.paintedMetal('#3b4548', 0.3),
    rail: m.paintedMetal('#f2f2ee', 0.3),
    plant: m.galvanised,
    roof: m.concrete,
  };

  const builder = new MeshBuilder('Buildings');
  const distant = new MeshBuilder('Distant buildings');
  for (const side of [1, -1] as const) {
    for (const b of layoutRow(side, ctx.random)) {
      const target = b.detailed ? builder : distant;
      target.setFrame(frameOf(b));
      target.uvOffset.set(b.seed * 37.1, b.seed * 11.7);
      if (b.detailed) buildDetailed(target, b, palette, ctx.random);
      else buildSimple(target, b, palette);
    }
  }
  for (const mesh of [builder.build(), distant.build()]) if (mesh) group.add(mesh);
  return group;
}

/** Local → world: south buildings face +z as built; north ones are turned to face -z. */
function frameOf(b: Building): Matrix4 {
  const y = pavementHeight(b.x, BUILDING_Z) - 0.02;
  const m = new Matrix4();
  if (b.side < 0) return m.makeTranslation(b.x, y, -BUILDING_Z);
  m.makeRotationY(Math.PI);
  m.setPosition(b.x, y, BUILDING_Z);
  return m;
}

/**
 * The buildings along one side: widths and heights drawn at random, with the styles weighted
 * towards Art Deco near the crossing and a glass tower on each side.
 */
function layoutRow(side: 1 | -1, random: () => number): Building[] {
  const out: Building[] = [];
  let x = ROW_START;
  let towerPlaced = false;
  while (x < ROW_END) {
    const near = Math.abs(x - CROSSING_X) < DETAIL_RANGE;
    const roll = random();
    let style: Style = roll < 0.45 ? 'deco' : roll < 0.7 ? 'mimo' : 'classic';
    // One tower per side, a little way down the street from the crossing where it's in view.
    const towerAt = side > 0 ? -70 : -46;
    if (!towerPlaced && x > towerAt - 30 && x < towerAt) {
      style = 'glass';
      towerPlaced = true;
    }
    const width = style === 'glass' ? 30 : Math.round((9 + random() * 22) * 2) / 2;
    const storeys = style === 'glass' ? 13 + Math.floor(random() * 5) : style === 'mimo' ? 5 + Math.floor(random() * 5) : 2 + Math.floor(random() * (style === 'deco' ? 5 : 4));
    const bay = style === 'glass' ? 1.5 : style === 'mimo' ? 3.4 + random() * 0.6 : 2.6 + random() * 0.8;
    const tints = TINTS[style];
    const b: Building = {
      side,
      // North buildings are built towards -x from their local origin, so start at the far end.
      x: side > 0 ? x + width : x,
      width,
      depth: 18,
      storeys,
      style,
      tint: tints[Math.floor(random() * tints.length)],
      bays: Math.max(2, Math.round(width / bay)),
      seed: random(),
      detailed: near,
    };
    out.push(b);
    // Party walls: mostly butted together, sometimes a narrow service alley.
    x += width + (random() < 0.12 ? 1.6 : 0);
  }
  return out;
}

/** A building in full detail. */
function buildDetailed(mb: MeshBuilder, b: Building, p: Palette, random: () => number): void {
  const W = b.width;
  const top = GROUND + b.storeys * STOREY;
  const wall = b.style === 'glass' ? p.spandrel : p.wall(b.tint);
  const trim = b.style === 'classic' ? p.wall(b.tint) : p.trim;
  const bay = W / b.bays;

  // Plinth (a little proud of the wall, running below the pavement so there's never a gap).
  mb.box(trim, 0, -0.4, 0, W, 0.5, 0.06, 0.01, 'ny');
  groundFloor(mb, b, p, wall, trim, bay, random);
  if (b.style === 'glass') curtainWall(mb, b, p);
  else upperFloors(mb, b, p, wall, trim, bay);

  // Parapet and roof: the wall rises PARAPET above the roof with a coping on top.
  const parapetTop = top + PARAPET;
  if (b.style !== 'glass') mb.rectZ(wall, 0, W, top, parapetTop, 0, 1);
  mb.box(trim, -0.05, parapetTop, -0.25, W + 0.05, parapetTop + 0.12, 0.08, 0.015);
  if (b.style === 'classic') cornice(mb, trim, W, top);
  if (b.style === 'deco') decoTower(mb, b, p, trim, bay, top);
  // Side walls (seen where a neighbour is lower or across an alley) and the roof.
  const sideWall = b.style === 'glass' ? p.spandrel : wall;
  mb.rectX(sideWall, -b.depth, 0, -0.4, parapetTop, 0, -1);
  mb.rectX(sideWall, -b.depth, 0, -0.4, parapetTop, W, 1);
  mb.rectY(p.roof, 0, W, -b.depth, 0, top, 1);
  rooftop(mb, b, p, top, random);
}

/** Shop fronts (or a lobby) in the ground floor: piers, stall risers, glazing, a sign band. */
function groundFloor(mb: MeshBuilder, b: Building, p: Palette, wall: Material, trim: Material, bay: number, random: () => number): void {
  const W = b.width;
  const pier = 0.45;
  const glazeTop = 3.3;
  const recess = 0.22;
  const doorBay = Math.floor(random() * b.bays);
  for (let i = 0; i < b.bays; i++) {
    const x0 = i * bay + pier / 2;
    const x1 = (i + 1) * bay - pier / 2;
    const riser = i === doorBay ? 0.02 : 0.5;
    // Piers between shop fronts and the wall over them.
    mb.rectZ(wall, i * bay, x0, 0.5, GROUND, 0, 1);
    mb.rectZ(wall, x1, (i + 1) * bay, 0.5, GROUND, 0, 1);
    mb.rectZ(wall, x0, x1, glazeTop, GROUND, 0, 1);
    // Reveals of the opening.
    mb.rectX(wall, -recess, 0, riser, glazeTop, x0, 1);
    mb.rectX(wall, -recess, 0, riser, glazeTop, x1, -1);
    mb.rectY(wall, x0, x1, -recess, 0, glazeTop, -1);
    // Stall riser under the glass (none at the door).
    if (riser > 0.1) mb.box(trim, x0, 0.4, -recess, x1, riser, 0.02, 0.01, 'nz');
    else mb.rectY(trim, x0, x1, -recess, 0, 0.02, 1);
    // Glazing with a frame and a transom bar; doors get a middle stile.
    const gz = -recess + 0.05;
    mb.pane(p.shop, x0, x1, riser, glazeTop, gz, b.seed * 131 + i * 7.3 + 0.5);
    frameRect(mb, p.darkFrame, x0, x1, riser, glazeTop, gz, 0.06);
    mb.box(p.darkFrame, x0, glazeTop - 0.55, gz - 0.03, x1, glazeTop - 0.5, gz + 0.04, 0.005);
    const mid = (x0 + x1) / 2;
    if (i === doorBay || x1 - x0 > 3) mb.box(p.darkFrame, mid - 0.03, riser, gz - 0.03, mid + 0.03, glazeTop - 0.55, gz + 0.04, 0.005);
  }
  // Sign band: a slightly proud fascia over the shop fronts.
  mb.box(trim, 0, glazeTop + 0.2, 0, W, GROUND - 0.25, 0.12, 0.015);
  // String course between the ground floor and the storeys above.
  mb.box(trim, -0.02, GROUND - 0.05, 0, W + 0.02, GROUND + 0.1, 0.1, 0.02);
}

/** Punched windows in the upper storeys, per bay, with the style's details. */
function upperFloors(mb: MeshBuilder, b: Building, p: Palette, wall: Material, trim: Material, bay: number): void {
  const recess = b.style === 'classic' ? 0.25 : 0.18;
  const winW = bay * (b.style === 'mimo' ? 0.62 : 0.5);
  const sill = b.style === 'mimo' ? 0.55 : 0.9;
  const head = b.style === 'mimo' ? 2.55 : 2.45;
  const frame = b.style === 'classic' ? p.darkFrame : p.frame;
  for (let s = 0; s < b.storeys; s++) {
    const floorY = GROUND + s * STOREY;
    const y0 = floorY + sill;
    const y1 = floorY + head;
    for (let i = 0; i < b.bays; i++) {
      const cx = (i + 0.5) * bay;
      const x0 = cx - winW / 2;
      const x1 = cx + winW / 2;
      // Wall around the opening: below, above, and the piers either side.
      mb.rectZ(wall, i * bay, (i + 1) * bay, floorY, y0, 0, 1);
      mb.rectZ(wall, i * bay, (i + 1) * bay, y1, floorY + STOREY, 0, 1);
      mb.rectZ(wall, i * bay, x0, y0, y1, 0, 1);
      mb.rectZ(wall, x1, (i + 1) * bay, y0, y1, 0, 1);
      // Reveals.
      mb.rectX(wall, -recess, 0, y0, y1, x0, 1);
      mb.rectX(wall, -recess, 0, y0, y1, x1, -1);
      mb.rectY(wall, x0, x1, -recess, 0, y1, -1);
      mb.rectY(wall, x0, x1, -recess, 0, y0, 1);
      // Glass, frame and mullions (a centre mullion in wide windows, a transom near the top).
      const gz = -recess + 0.06;
      mb.pane(p.glass, x0, x1, y0, y1, gz, b.seed * 977 + s * 31.7 + i * 3.1);
      frameRect(mb, frame, x0, x1, y0, y1, gz, 0.055);
      if (x1 - x0 > 1.3) mb.box(frame, cx - 0.025, y0, gz - 0.025, cx + 0.025, y1, gz + 0.035, 0.004);
      mb.box(frame, x0, y1 - 0.5, gz - 0.025, x1, y1 - 0.45, gz + 0.035, 0.004);
      // Sill: projects 7 cm and drips water clear of the wall.
      mb.box(trim, x0 - 0.06, y0 - 0.07, -recess, x1 + 0.06, y0, 0.07, 0.012);
      if (b.style === 'deco') {
        // Eyebrow: a thin ledge over the window, the signature of Miami Deco.
        mb.box(trim, x0 - 0.18, y1 + 0.18, 0, x1 + 0.18, y1 + 0.26, 0.5, 0.02);
      } else if (b.style === 'classic') {
        // Lintel with a keystone.
        mb.box(trim, x0 - 0.12, y1, 0, x1 + 0.12, y1 + 0.22, 0.05, 0.01);
        mb.box(trim, cx - 0.12, y1 - 0.02, 0, cx + 0.12, y1 + 0.28, 0.08, 0.01);
      } else if (b.style === 'mimo' && (i + s) % 2 === 0) {
        balcony(mb, p, trim, i * bay + 0.25, (i + 1) * bay - 0.25, floorY);
      }
    }
    if (b.style === 'deco') {
      // String course at each floor line.
      mb.box(trim, -0.02, floorY - 0.06, 0, b.width + 0.02, floorY + 0.04, 0.06, 0.012);
    }
  }
}

/** Curtain wall: storey-high glass in 1.5 m modules, mullions, spandrel bands at the floors. */
function curtainWall(mb: MeshBuilder, b: Building, p: Palette): void {
  const W = b.width;
  const module = W / b.bays;
  for (let s = 0; s < b.storeys; s++) {
    const y0 = GROUND + s * STOREY;
    // Spandrel at the floor slab, glass above it.
    mb.box(p.spandrel, 0, y0 - 0.1, -0.05, W, y0 + 0.75, 0, 0.005, 'nz');
    for (let i = 0; i < b.bays; i++) {
      mb.pane(p.tower, i * module, (i + 1) * module, y0 + 0.75, y0 + STOREY - 0.1, -0.08, b.seed * 311 + s * 13.3 + i * 1.7);
    }
  }
  const top = GROUND + b.storeys * STOREY;
  // Mullions: vertical fins over the glass, full height.
  for (let i = 0; i <= b.bays; i++) {
    const x = i * module;
    mb.box(p.spandrel, x - 0.04, GROUND - 0.1, -0.08, x + 0.04, top + PARAPET, 0.14, 0.008);
  }
  // Parapet band.
  mb.box(p.spandrel, 0, top - 0.1, -0.05, W, top + PARAPET, 0.02, 0.01);
}

/** A cantilevered balcony: slab, three-rail ship's railing and posts. */
function balcony(mb: MeshBuilder, p: Palette, trim: Material, x0: number, x1: number, floorY: number): void {
  const depth = 1.25;
  mb.box(trim, x0, floorY - 0.18, 0, x1, floorY, depth, 0.02);
  for (const h of [0.35, 0.65, 1.0]) mb.box(p.rail, x0 + 0.05, floorY + h - 0.02, depth - 0.07, x1 - 0.05, floorY + h + 0.02, depth - 0.03, 0.006);
  for (const x of [x0 + 0.07, x1 - 0.07]) {
    mb.box(p.rail, x - 0.025, floorY, depth - 0.08, x + 0.025, floorY + 1.02, depth - 0.02, 0.006);
    for (const h of [0.35, 0.65, 1.0]) mb.box(p.rail, x - 0.02, floorY + h - 0.02, 0.05, x + 0.02, floorY + h + 0.02, depth - 0.03, 0.006);
  }
}

/** A moulded cornice along the top of the wall (profile in z, y; projecting up to 0.45 m). */
function cornice(mb: MeshBuilder, trim: Material, W: number, top: number): void {
  const y = top - 0.35;
  const profile: [number, number][] = [
    [0, y],
    [0.08, y],
    [0.08, y + 0.08],
    [0.14, y + 0.12],
    [0.2, y + 0.2],
    [0.3, y + 0.26],
    [0.42, y + 0.3],
    [0.45, y + 0.36],
    [0.45, y + 0.42],
    [0, y + 0.42],
  ];
  mb.sweepX(trim, profile, -0.3, W + 0.3);
}

/** Art Deco centre tower: vertical fins rising above a stepped parapet. */
function decoTower(mb: MeshBuilder, b: Building, p: Palette, trim: Material, bay: number, top: number): void {
  const mid = Math.floor(b.bays / 2);
  const x0 = mid * bay;
  const x1 = x0 + bay;
  const rise = 2.4;
  // Stepped parapet over the centre bay.
  mb.box(p.wall(b.tint), x0 - 0.4, top, -0.3, x1 + 0.4, top + PARAPET + rise * 0.5, 0.1, 0.02);
  mb.box(p.wall(b.tint), x0 + 0.1, top, -0.3, x1 - 0.1, top + PARAPET + rise, 0.14, 0.02);
  // Fins: three thin vertical blades from the second floor up past the parapet.
  for (let k = 0; k < 3; k++) {
    const x = x0 + bay * (0.25 + k * 0.25);
    mb.box(trim, x - 0.07, GROUND + STOREY, 0, x + 0.07, top + PARAPET + rise + 0.6, 0.38, 0.02);
  }
}

/** Plant on the roof: condensers, a water tank on legs, a stair bulkhead. */
function rooftop(mb: MeshBuilder, b: Building, p: Palette, top: number, random: () => number): void {
  const units = Math.floor(b.width / 7);
  for (let k = 0; k < units; k++) {
    const x = 2 + random() * (b.width - 5);
    const z = -3 - random() * (b.depth - 6);
    const w = 1.2 + random() * 1.4;
    mb.box(p.plant, x, top, z, x + w, top + 1.1 + random() * 0.6, z + 1.1, 0.02);
  }
  if (random() < 0.6) {
    const bx = b.width * (0.2 + random() * 0.5);
    mb.box(p.wall(b.tint), bx, top, -b.depth + 2, bx + 3.2, top + 2.8, -b.depth + 5.4, 0.02);
  }
  if (b.style !== 'glass' && random() < 0.35) {
    // Water tank on steel legs.
    const tx = b.width * (0.3 + random() * 0.4);
    const tz = -b.depth * 0.5;
    const oct: [number, number][] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      oct.push([tx + Math.cos(a) * 1.4, tz + Math.sin(a) * 1.4]);
    }
    mb.prismY(p.plant, oct, top + 2.2, top + 5.2, true, true);
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      mb.box(p.darkFrame, tx + dx * 0.9 - 0.06, top, tz + dz * 0.9 - 0.06, tx + dx * 0.9 + 0.06, top + 2.25, tz + dz * 0.9 + 0.06, 0.01);
    }
  }
}

/** A window frame: four bars around the opening, standing a little proud of the glass. */
function frameRect(mb: MeshBuilder, m: Material, x0: number, x1: number, y0: number, y1: number, z: number, t: number): void {
  mb.box(m, x0, y0, z - 0.03, x0 + t, y1, z + 0.04, 0.004);
  mb.box(m, x1 - t, y0, z - 0.03, x1, y1, z + 0.04, 0.004);
  mb.box(m, x0 + t, y0, z - 0.03, x1 - t, y0 + t, z + 0.04, 0.004);
  mb.box(m, x0 + t, y1 - t, z - 0.03, x1 - t, y1, z + 0.04, 0.004);
}

/** A distant building: the mass, flush windows, a coping. It only has to read through the haze. */
function buildSimple(mb: MeshBuilder, b: Building, p: Palette): void {
  const W = b.width;
  const top = GROUND + b.storeys * STOREY;
  const wall = b.style === 'glass' ? p.spandrel : p.wall(b.tint);
  const bay = W / b.bays;
  mb.rectZ(wall, 0, W, -0.4, GROUND, 0, 1);
  mb.pane(p.shop, 0.4, W - 0.4, 0.5, 3.3, 0.01, b.seed * 53);
  for (let s = 0; s < b.storeys; s++) {
    const y0 = GROUND + s * STOREY;
    mb.rectZ(wall, 0, W, y0, y0 + STOREY, 0, 1);
    for (let i = 0; i < b.bays; i++) {
      const glass = b.style === 'glass' ? p.tower : p.glass;
      const ww = b.style === 'glass' ? bay : bay * 0.5;
      const cx = (i + 0.5) * bay;
      mb.pane(glass, cx - ww / 2, cx + ww / 2, y0 + (b.style === 'glass' ? 0.75 : 0.9), y0 + (b.style === 'glass' ? STOREY - 0.1 : 2.45), 0.01, b.seed * 71 + s * 5.3 + i);
    }
  }
  mb.rectZ(wall, 0, W, top, top + PARAPET, 0, 1);
  mb.box(p.trim, -0.05, top + PARAPET, -0.25, W + 0.05, top + PARAPET + 0.12, 0.08, 0.015);
  mb.rectX(wall, -b.depth, 0, -0.4, top + PARAPET, 0, -1);
  mb.rectX(wall, -b.depth, 0, -0.4, top + PARAPET, W, 1);
}
