// One-off landmark structures that give Port Solmar its identity: container gantry
// cranes, the South Pointe lighthouse, the pier and its Ferris wheel, the stadium, the
// arena, the mall, the hospital, the marina and the airboat landing.
import { LANDMARKS } from '../authored/layout';
import type { WorldData } from '../gen/world';
import { Rng } from '../rng';
import type { Heights } from './heights';
import type { MeshBuilder } from './meshData';
import { type RGB, beam, box, cylinder, hex, prism, quad } from './shapes';

type Sink = (anchorX: number, anchorZ: number, bucket: string) => MeshBuilder;

const WHITE = hex(0xf2f0ea);
const OFFWHITE = hex(0xdcd8cf);
const RED = hex(0xb8312a);
const CRANE_BLUE = hex(0x2f6fa8);
const DARK = hex(0x2a2c30);
const STEEL = hex(0x8c9196);
const WOOD = hex(0x8a6a4a);
const TEAL = hex(0x2aa198);

export function buildLandmarks(world: WorldData, h: Heights, sink: Sink): void {
  const at = (name: string): { x: number; z: number } => LANDMARKS.find((l) => l.name === name)!.at;
  portCranes(h, sink);
  lighthouse(h, sink, at('South Pointe Light'));
  pierAndWheel(h, sink, at('South Pointe Pier'));
  stadium(h, sink, at('Estadio Solano'));
  arena(h, sink, at('Solmar Arena'));
  mall(h, sink, at('Northgate Mall'));
  hospital(h, sink, at('Mercy General'));
  marina(world, h, sink, at('Coconut Marina'));
  airboatLanding(h, sink, at('Airboat Landing'));
}

/** First x going east from x0 along z where the ground turns to water. */
function shoreEast(h: Heights, x0: number, z: number, maxX: number): number {
  for (let x = x0; x < maxX; x += 1) if (h.shoreDist(x, z) < 0) return x;
  return maxX;
}

// ---- Port: ship-to-shore gantry cranes on the east quay --------------------------------
function portCranes(h: Heights, sink: Sink): void {
  const quayX = shoreEast(h, 960, 40, 1080);
  const zs = [-40, 8, 56, 104];
  zs.forEach((z, k) => {
    const out = sink(quayX, z, 'structure');
    const col = k % 2 === 0 ? CRANE_BLUE : RED;
    const g = Math.max(0.5, h.ground(quayX - 15, z));
    const xLand = quayX - 26;
    const xSea = quayX - 4;
    const legH = 42;
    // Four legs, sill and portal beams.
    for (const lx of [xLand, xSea])
      for (const lz of [z - 9, z + 9]) {
        box(out, lx, g + legH / 2, lz, 0.9, legH / 2, 0.9, 0, col);
        box(out, lx, g + 0.8, lz, 1.4, 0.8, 1.4, 0, DARK); // bogie
      }
    for (const lz of [z - 9, z + 9]) beam(out, [xLand, g + legH, lz], [xSea, g + legH, lz], 1.6, col);
    for (const lx of [xLand, xSea]) {
      beam(out, [lx, g + legH, z - 9], [lx, g + legH, z + 9], 1.6, col);
      beam(out, [lx, g + 12, z - 9], [lx, g + 12, z + 9], 1.0, col);
    }
    // Boom out over the water and back-reach over the yard.
    const boomY = g + legH + 3;
    const tip = quayX + 58;
    const back = xLand - 22;
    for (const bz of [z - 1.8, z + 1.8]) {
      beam(out, [back, boomY, bz], [tip, boomY, bz], 1.3, col);
      beam(out, [back, boomY + 3, bz], [quayX + 10, boomY + 3, bz], 0.9, col);
    }
    for (let x = back; x < tip; x += 6) beam(out, [x, boomY, z - 1.8], [x, boomY, z + 1.8], 0.4, col);
    // A-frame apex with stays to the tip and the back.
    const apex: [number, number, number] = [xSea - 4, g + legH + 26, z];
    for (const lz of [z - 9, z + 9]) {
      beam(out, [xSea, g + legH, lz], apex, 1.1, col);
      beam(out, [xLand, g + legH, lz], apex, 1.1, col);
    }
    beam(out, apex, [tip, boomY + 1, z], 0.35, STEEL);
    beam(out, apex, [quayX + 25, boomY + 1, z], 0.35, STEEL);
    beam(out, apex, [back, boomY + 1, z], 0.35, STEEL);
    // Machinery house and operator cab.
    box(out, back + 6, boomY + 3.5, z, 6, 2.5, 3.5, 0, OFFWHITE);
    box(out, quayX + 4, boomY - 2.2, z, 1.6, 1.4, 1.6, 0, WHITE);
    box(out, quayX + 18, boomY - 1.2, z, 1.4, 0.8, 2.2, 0, DARK); // trolley
  });
}

// ---- South Pointe lighthouse ------------------------------------------------------------
function lighthouse(h: Heights, sink: Sink, p: { x: number; z: number }): void {
  const g = Math.max(0.6, h.ground(p.x, p.z));
  const out = sink(p.x, p.z, 'structure');
  cylinder(out, p.x, g, p.z, 5, 5, 1.5, 24, OFFWHITE);
  cylinder(out, p.x, g + 1.5, p.z, 3.3, 2.2, 26, 24, WHITE);
  cylinder(out, p.x, g + 27.5, p.z, 3.3, 3.3, 0.35, 24, DARK); // gallery
  cylinder(out, p.x, g + 27.85, p.z, 2.0, 2.0, 0.9, 16, DARK);
  cylinder(out, p.x, g + 28.75, p.z, 1.9, 1.9, 2.4, 16, hex(0x38444c), false);
  cylinder(out, p.x, g + 31.15, p.z, 2.1, 0.2, 1.8, 16, DARK);
  const lamp = sink(p.x, p.z, 'lamp');
  cylinder(lamp, p.x, g + 29.2, p.z, 0.9, 0.9, 1.4, 12, hex(0xfff3c4));
  // Keeper's cottage.
  const c = sink(p.x, p.z, 'structure');
  box(c, p.x - 11, g + 2.2, p.z + 2, 5, 2.2, 4, 0, WHITE);
  prismRoof(c, p.x - 11, g + 4.4, p.z + 2, 5.4, 4.4, 2, RED);
}

function prismRoof(out: MeshBuilder, cx: number, y: number, cz: number, hx: number, hz: number, rise: number, color: RGB): void {
  // Simple gable roof along x.
  quad(out, [cx - hx, y, cz + hz], [cx + hx, y, cz + hz], [cx + hx, y + rise, cz], [cx - hx, y + rise, cz], color);
  quad(out, [cx + hx, y, cz - hz], [cx - hx, y, cz - hz], [cx - hx, y + rise, cz], [cx + hx, y + rise, cz], color);
  quad(out, [cx + hx, y, cz + hz], [cx + hx, y, cz - hz], [cx + hx, y + rise, cz], [cx + hx, y + rise, cz], color);
  quad(out, [cx - hx, y, cz - hz], [cx - hx, y, cz + hz], [cx - hx, y + rise, cz], [cx - hx, y + rise, cz], color);
}

// ---- Pier with a Ferris wheel -----------------------------------------------------------
function pierAndWheel(h: Heights, sink: Sink, p: { x: number; z: number }): void {
  const z = p.z;
  const shoreX = shoreEast(h, 1300, z, 1600);
  const x0 = shoreX - 30;
  const x1 = shoreX + 250;
  const deckY = 4.6;
  const hw = 5;
  const out = sink((x0 + x1) / 2, z, 'structure');
  const conc = sink((x0 + x1) / 2, z, 'concrete');
  // Deck, fascia, railings.
  box(out, (x0 + x1) / 2, deckY - 0.25, z, (x1 - x0) / 2, 0.25, hw, 0, WOOD);
  for (const side of [-1, 1]) {
    beam(out, [x0, deckY + 1.1, z + side * (hw - 0.1)], [x1, deckY + 1.1, z + side * (hw - 0.1)], 0.12, WHITE);
    beam(out, [x0, deckY + 0.55, z + side * (hw - 0.1)], [x1, deckY + 0.55, z + side * (hw - 0.1)], 0.08, WHITE);
    for (let x = x0; x <= x1; x += 3) beam(out, [x, deckY, z + side * (hw - 0.1)], [x, deckY + 1.1, z + side * (hw - 0.1)], 0.08, WHITE);
  }
  // Piles.
  for (let x = x0 + 4; x <= x1; x += 9) {
    for (const side of [-1, 1]) {
      const bed = Math.min(h.ground(x, z + side * 4), 0) - 1;
      cylinder(conc, x, bed, z + side * 4, 0.4, 0.4, deckY - 0.5 - bed, 8, undefined, false);
    }
  }
  // Pier-end cafe.
  box(out, x1 - 8, deckY + 2.2, z, 7, 2.2, 4.6, 0, TEAL);
  box(out, x1 - 8, deckY + 4.6, z, 7.6, 0.25, 5.2, 0, WHITE);
  // Ferris wheel on the pier.
  const wx = x0 + 70;
  const axleY = deckY + 22;
  const R = 19;
  const wheel = sink(wx, z, 'structure');
  const lamp = sink(wx, z, 'lamp');
  const spokes = 24;
  for (const side of [-2.2, 2.2]) {
    const rim: [number, number, number][] = [];
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      rim.push([wx + Math.cos(a) * R, axleY + Math.sin(a) * R, z + side]);
    }
    for (let i = 0; i < spokes; i++) {
      beam(wheel, rim[i], rim[(i + 1) % spokes], 0.45, WHITE);
      beam(wheel, [wx, axleY, z + side * 0.3], rim[i], 0.14, WHITE);
      // LED sparkle on the rim.
      box(lamp, rim[i][0], rim[i][1], rim[i][2], 0.25, 0.25, 0.25);
    }
    // A-frame legs.
    beam(wheel, [wx - 9, deckY, z + side * 3], [wx, axleY, z + side * 1.2], 0.7, WHITE);
    beam(wheel, [wx + 9, deckY, z + side * 3], [wx, axleY, z + side * 1.2], 0.7, WHITE);
  }
  cylinder(wheel, wx, axleY - 0.8, z, 1.2, 1.2, 1.6, 12, STEEL);
  // Gondolas hanging below the rim.
  const colors = [hex(0xe63946), hex(0xf4a261), hex(0x2a9d8f), hex(0xe9c46a), hex(0x8ecae6), hex(0xb5179e)];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const gx = wx + Math.cos(a) * R;
    const gy = axleY + Math.sin(a) * R - 1.8;
    box(wheel, gx, gy, z, 1.2, 1.1, 1.3, 0, colors[i % colors.length]);
  }
}

// ---- Estadio Solano: an oval bowl with a roof ring and light towers ---------------------
function stadium(h: Heights, sink: Sink, p: { x: number; z: number }): void {
  const g = h.ground(p.x, p.z) + 0.2;
  const out = sink(p.x, p.z, 'structure');
  const conc = sink(p.x, p.z, 'concrete');
  const seg = 48;
  const rxIn = 64, rzIn = 50, rxOut = 100, rzOut = 82;
  const pt = (a: number, rx: number, rz: number): [number, number] => [p.x + Math.cos(a) * rx, p.z + Math.sin(a) * rz];
  const seatColors = [hex(0x1e5aa8), hex(0xf28c28), hex(0x1e5aa8), hex(0xd8d8d8)];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    // Tiers of seating sloping up and out, in coloured bands.
    const tiers = 4;
    for (let t = 0; t < tiers; t++) {
      const f0 = t / tiers;
      const f1 = (t + 1) / tiers;
      const [ix0, iz0] = pt(a0, rxIn + (rxOut - rxIn) * f0, rzIn + (rzOut - rzIn) * f0);
      const [ix1, iz1] = pt(a1, rxIn + (rxOut - rxIn) * f0, rzIn + (rzOut - rzIn) * f0);
      const [ox0, oz0] = pt(a0, rxIn + (rxOut - rxIn) * f1, rzIn + (rzOut - rzIn) * f1);
      const [ox1, oz1] = pt(a1, rxIn + (rxOut - rxIn) * f1, rzIn + (rzOut - rzIn) * f1);
      const y0 = g + 3 + 24 * f0;
      const y1 = g + 3 + 24 * f1;
      // Faces up and toward the field.
      quad(out, [ix0, y0, iz0], [ix1, y0, iz1], [ox1, y1, oz1], [ox0, y1, oz0], seatColors[t]);
    }
    // Outer facade and the podium wall facing the field.
    const [ax, az] = pt(a0, rxOut, rzOut);
    const [bx, bz] = pt(a1, rxOut, rzOut);
    quad(conc, [bx, g - 0.5, bz], [ax, g - 0.5, az], [ax, g + 30, az], [bx, g + 30, bz]);
    const [cx0, cz0] = pt(a0, rxIn, rzIn);
    const [cx1, cz1] = pt(a1, rxIn, rzIn);
    quad(conc, [cx0, g, cz0], [cx1, g, cz1], [cx1, g + 3, cz1], [cx0, g + 3, cz0]);
    // Roof ring cantilevered over the upper stands.
    const [rx0, rz0] = pt(a0, rxOut - 22, rzOut - 18);
    const [rx1, rz1] = pt(a1, rxOut - 22, rzOut - 18);
    quad(out, [rx0, g + 33, rz0], [rx1, g + 33, rz1], [bx, g + 31, bz], [ax, g + 31, az], WHITE);
    quad(out, [ax, g + 30.6, az], [bx, g + 30.6, bz], [rx1, g + 32.6, rz1], [rx0, g + 32.6, rz0], OFFWHITE);
  }
  // Pitch.
  const grass = sink(p.x, p.z, 'structure');
  const ring: { x: number; z: number }[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2; // increasing angle = positive winding
    ring.push({ x: p.x + Math.cos(a) * rxIn, z: p.z + Math.sin(a) * rzIn });
  }
  prism(grass, ring, g - 0.2, g + 0.15, hex(0x3f8a36));
  // Facade fins around the bowl and a coloured crown band.
  for (let i = 0; i < seg * 2; i++) {
    const a = (i / (seg * 2)) * Math.PI * 2;
    const [fx, fz] = pt(a, rxOut + 1.2, rzOut + 1.2);
    box(out, fx, g + 15, fz, 0.6, 15.5, 1.5, -a, OFFWHITE);
  }
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const [ax, az] = pt(a0, rxOut + 1.6, rzOut + 1.6);
    const [bx, bz] = pt(a1, rxOut + 1.6, rzOut + 1.6);
    quad(out, [bx, g + 26, bz], [ax, g + 26, az], [ax, g + 30, az], [bx, g + 30, bz], hex(0x1e5aa8));
  }
  // Light towers.
  const lamp = sink(p.x, p.z, 'lamp');
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.25;
    const [x, zz] = pt(a, rxOut + 4, rzOut + 4);
    cylinder(conc, x, g, zz, 0.9, 0.6, 52, 8);
    box(out, x, g + 53, zz, 4, 2, 0.6, Math.atan2(zz - p.z, x - p.x) + Math.PI / 2, DARK);
    box(lamp, x, g + 53, zz, 3.6, 1.6, 0.7, Math.atan2(zz - p.z, x - p.x) + Math.PI / 2);
  }
}

// ---- Solmar Arena: a round hall under a shallow dome ------------------------------------
function arena(h: Heights, sink: Sink, p: { x: number; z: number }): void {
  const g = h.ground(p.x, p.z) + 0.15;
  const R = 46;
  const out = sink(p.x, p.z, 'structure');
  const glass = sink(p.x, p.z, 'glass');
  cylinder(out, p.x, g, p.z, R + 3, R + 3, 1.2, 48, OFFWHITE);
  cylinder(glass, p.x, g + 1.2, p.z, R, R, 8, 48, undefined, false);
  cylinder(out, p.x, g + 9.2, p.z, R + 1.5, R + 1.5, 12, 48, WHITE, false);
  // Dome as stacked rings.
  const rings = 8;
  for (let i = 0; i < rings; i++) {
    const a0 = (i / rings) * (Math.PI / 2) * 0.55;
    const a1 = ((i + 1) / rings) * (Math.PI / 2) * 0.55;
    const r0 = (R + 1.5) * Math.cos(a0) / Math.cos(0);
    const r1 = (R + 1.5) * Math.cos(a1);
    const y0 = g + 21.2 + (R + 1.5) * (Math.sin(a0)) * 0.55;
    const y1 = g + 21.2 + (R + 1.5) * (Math.sin(a1)) * 0.55;
    cylinder(out, p.x, y0, p.z, r0, r1, y1 - y0, 48, i % 2 ? hex(0xe8e6e0) : WHITE, i === rings - 1);
  }
}

// ---- Northgate Mall: long low box with anchor stores --------------------------------------
function mall(h: Heights, sink: Sink, p: { x: number; z: number }): void {
  const g = h.ground(p.x, p.z) + 0.15;
  const out = sink(p.x, p.z, 'structure');
  const glass = sink(p.x, p.z, 'glass');
  box(out, p.x, g + 7, p.z, 115, 7, 38, 0, hex(0xe7ddcc));
  box(out, p.x - 128, g + 9, p.z, 24, 9, 48, 0, hex(0xd9c9b0));
  box(out, p.x + 128, g + 9, p.z, 24, 9, 48, 0, hex(0xcdd5d8));
  box(out, p.x, g + 16, p.z, 40, 2, 20, 0, WHITE); // skylight crown
  box(glass, p.x, g + 4, p.z + 38.2, 16, 4, 0.3);
  box(glass, p.x, g + 4, p.z - 38.2, 16, 4, 0.3);
  // Rooftop units.
  const rng = new Rng('mall');
  for (let i = 0; i < 24; i++) box(out, p.x + rng.range(-100, 100), g + 14.8, p.z + rng.range(-30, 30), 2, 0.8, 1.4, 0, STEEL);
}

// ---- Mercy General hospital: podium, ward tower, helipad --------------------------------
function hospital(h: Heights, sink: Sink, p: { x: number; z: number }): void {
  const g = h.ground(p.x, p.z) + 0.15;
  const out = sink(p.x, p.z, 'structure');
  const glass = sink(p.x, p.z, 'glass');
  box(out, p.x, g + 6, p.z, 55, 6, 36, 0, hex(0xe9e6df));
  for (let f = 0; f < 9; f++) {
    const y = g + 12 + f * 3.6;
    box(out, p.x + 10, y + 1.1, p.z, 34, 1.1, 12, 0, WHITE);
    box(glass, p.x + 10, y + 2.5, p.z, 33.6, 0.7, 11.6);
  }
  box(out, p.x + 10, g + 12 + 9 * 3.6 + 0.4, p.z, 34.5, 0.4, 12.5, 0, OFFWHITE);
  // Helipad.
  cylinder(out, p.x + 30, g + 12 + 9 * 3.6 + 0.8, p.z, 9, 9, 0.3, 24, hex(0x3b3d40));
  box(out, p.x + 30, g + 12 + 9 * 3.6 + 1.12, p.z, 3, 0.02, 0.4, 0, WHITE);
  box(out, p.x + 27.5, g + 12 + 9 * 3.6 + 1.12, p.z, 0.4, 0.02, 3, 0, WHITE);
  box(out, p.x + 32.5, g + 12 + 9 * 3.6 + 1.12, p.z, 0.4, 0.02, 3, 0, WHITE);
  // Red cross sign.
  box(out, p.x - 24, g + 13.5, p.z - 36.3, 1.2, 3.5, 0.2, 0, RED);
  box(out, p.x - 24, g + 13.5, p.z - 36.3, 3.5, 1.2, 0.2, 0, RED);
}

// ---- Coconut Marina: floating docks with moored boats ------------------------------------
function marina(world: WorldData, h: Heights, sink: Sink, p: { x: number; z: number }): void {
  void world;
  const shoreX = shoreEast(h, p.x - 150, p.z, p.x + 300);
  const x0 = shoreX - 4;
  const len = 150;
  const out = sink(x0 + len / 2, p.z, 'structure');
  const hulls = sink(x0 + len / 2, p.z, 'structure');
  const rng = new Rng('marina');
  const dockY = 0.55;
  box(out, x0 + len / 2, dockY, p.z, len / 2, 0.3, 1.6, 0, WOOD);
  for (let x = x0 + 18; x < x0 + len - 6; x += 13) {
    for (const side of [-1, 1]) {
      box(out, x, dockY, p.z + side * 9, 0.8, 0.3, 7.5, 0, WOOD);
      // A boat in about three out of four slips.
      if (rng.chance(0.75)) {
        const bx = x + 6.3;
        const bz = p.z + side * 9.5;
        const L = rng.range(8, 14);
        const hullColor = rng.pick([WHITE, WHITE, OFFWHITE, hex(0x1d3557), hex(0xe9c46a)]);
        box(hulls, bx, 0.45, bz, 1.4, 0.75, L / 2, 0, hullColor);
        box(hulls, bx, 1.35, bz - 0.6, 1.1, 0.5, L * 0.2, 0, WHITE);
        if (rng.chance(0.4)) beam(hulls, [bx, 1.2, bz], [bx, 1.2 + L * 1.1, bz], 0.14, OFFWHITE); // sailboat mast
      }
    }
  }
}

// ---- Airboat landing on the river in the swamp -----------------------------------------
function airboatLanding(h: Heights, sink: Sink, p: { x: number; z: number }): void {
  const out = sink(p.x, p.z, 'structure');
  const g = Math.max(0.4, h.ground(p.x, p.z));
  box(out, p.x, g + 0.4, p.z, 6, 0.2, 2.5, 0.3, WOOD);
  box(out, p.x - 10, g + 2, p.z - 7, 4, 2, 3, 0.2, hex(0xa3754a)); // bait shack
  prismRoof(out, p.x - 10, g + 4, p.z - 7, 4.5, 3.4, 1.4, hex(0x6b7b5a));
  for (const dz of [5, 9]) {
    const bx = p.x + 3;
    const bz = p.z + dz;
    box(out, bx, 0.3, bz, 1.4, 0.3, 3.2, 0.3, hex(0x5a6b3c));
    cylinder(out, bx, 0.6, bz + 2.4, 1.3, 1.3, 0.2, 12, DARK); // fan cage (flat disc)
    box(out, bx, 1.3, bz + 2.2, 0.3, 0.7, 0.3, 0.3, DARK);
  }
}
