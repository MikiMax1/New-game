// Procedural vehicle models with real proportions. Each model is a set of parts keyed
// by material (paint, glass, tyre, rim, trim, headlight, taillight, chrome, sign), so the
// renderer can instance them and tint the paint per car. Pure data (no three.js).
//
// Model space: metres, origin at ground level under the centre of the car, facing -Z
// (front toward -Z), +X to the car's right.
import { MeshBuilder, type MeshData } from '../mesh/meshData';
import { beam, box, cylinder, quad, type RGB } from '../mesh/shapes';

export const VEHICLE_TYPES = ['sedan', 'hatch', 'suv', 'pickup', 'minivan', 'taxi', 'police', 'bus', 'boxTruck'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export type VehiclePart = 'paint' | 'glass' | 'tyre' | 'rim' | 'trim' | 'headlight' | 'taillight' | 'chrome' | 'sign';

export interface VehicleModel {
  type: VehicleType;
  length: number;
  width: number;
  height: number;
  parts: Map<VehiclePart, MeshData>;
}

interface Profile {
  length: number;
  width: number;
  /** Side silhouette of the lower body from the rear bumper to the front bumper: [z from rear, y]. */
  lower: [number, number][];
  /** Greenhouse: beltline start/end (z from rear), roof start/end (z from rear), beltline and roof heights. */
  glass: { belt0: number; belt1: number; roof0: number; roof1: number; beltY: number; roofY: number } | null;
  wheelR: number;
  wheelbase: number;
  /** Rear axle offset from the rear (m). */
  rearAxle: number;
  /** Tumblehome: how much narrower the roof is than the body (m, total). */
  tumble: number;
  bed?: { from: number; to: number; y: number };
}

const P: Record<VehicleType, Profile> = {
  sedan: {
    length: 4.85, width: 1.85,
    lower: [[0.02, 0.28], [0, 0.66], [0.25, 0.98], [0.9, 1.0], [1.55, 0.99], [3.65, 0.97], [4.5, 0.8], [4.83, 0.68], [4.85, 0.3]],
    glass: { belt0: 1.2, belt1: 3.75, roof0: 1.85, roof1: 3.05, beltY: 0.99, roofY: 1.44 },
    wheelR: 0.33, wheelbase: 2.82, rearAxle: 0.98, tumble: 0.34,
  },
  hatch: {
    length: 4.25, width: 1.8,
    lower: [[0.02, 0.3], [0, 0.95], [0.3, 1.02], [3.0, 1.0], [3.9, 0.82], [4.23, 0.7], [4.25, 0.32]],
    glass: { belt0: 0.15, belt1: 3.1, roof0: 0.45, roof1: 2.35, beltY: 1.0, roofY: 1.48 },
    wheelR: 0.31, wheelbase: 2.6, rearAxle: 0.72, tumble: 0.3,
  },
  suv: {
    length: 4.9, width: 1.96,
    lower: [[0.02, 0.4], [0, 1.08], [0.3, 1.14], [3.85, 1.12], [4.62, 1.0], [4.88, 0.86], [4.9, 0.42]],
    glass: { belt0: 0.12, belt1: 3.95, roof0: 0.3, roof1: 3.2, beltY: 1.13, roofY: 1.76 },
    wheelR: 0.38, wheelbase: 2.9, rearAxle: 0.95, tumble: 0.3,
  },
  pickup: {
    length: 5.8, width: 2.03,
    lower: [[0.02, 0.45], [0, 1.1], [0.1, 1.14], [2.35, 1.14], [4.65, 1.16], [5.5, 1.06], [5.78, 0.9], [5.8, 0.46]],
    glass: { belt0: 2.45, belt1: 4.55, roof0: 2.55, roof1: 3.85, beltY: 1.15, roofY: 1.88 },
    wheelR: 0.4, wheelbase: 3.6, rearAxle: 1.1, tumble: 0.26,
    bed: { from: 0.08, to: 2.35, y: 0.95 },
  },
  minivan: {
    length: 5.15, width: 2.0,
    lower: [[0.02, 0.32], [0, 1.02], [0.2, 1.06], [4.2, 1.03], [4.9, 0.86], [5.13, 0.7], [5.15, 0.34]],
    glass: { belt0: 0.1, belt1: 4.35, roof0: 0.2, roof1: 3.4, beltY: 1.04, roofY: 1.78 },
    wheelR: 0.34, wheelbase: 3.05, rearAxle: 0.95, tumble: 0.22,
  },
  taxi: {
    length: 4.85, width: 1.85,
    lower: [[0.02, 0.28], [0, 0.66], [0.25, 0.98], [0.9, 1.0], [1.55, 0.99], [3.65, 0.97], [4.5, 0.8], [4.83, 0.68], [4.85, 0.3]],
    glass: { belt0: 1.2, belt1: 3.75, roof0: 1.85, roof1: 3.05, beltY: 0.99, roofY: 1.44 },
    wheelR: 0.33, wheelbase: 2.82, rearAxle: 0.98, tumble: 0.34,
  },
  police: {
    length: 5.0, width: 1.9,
    lower: [[0.02, 0.3], [0, 0.7], [0.25, 1.0], [0.9, 1.02], [1.6, 1.01], [3.75, 0.99], [4.62, 0.82], [4.98, 0.7], [5.0, 0.32]],
    glass: { belt0: 1.25, belt1: 3.85, roof0: 1.9, roof1: 3.12, beltY: 1.01, roofY: 1.47 },
    wheelR: 0.34, wheelbase: 2.95, rearAxle: 1.0, tumble: 0.34,
  },
  bus: {
    length: 12.2, width: 2.55,
    lower: [[0.0, 0.35], [0, 1.2], [12.2, 1.2], [12.2, 0.35]],
    glass: { belt0: 0.3, belt1: 12.0, roof0: 0.3, roof1: 11.95, beltY: 1.2, roofY: 2.75 },
    wheelR: 0.5, wheelbase: 7.2, rearAxle: 2.6, tumble: 0.0,
  },
  boxTruck: {
    length: 7.6, width: 2.45,
    lower: [[0.0, 0.45], [0, 1.15], [7.4, 1.15], [7.6, 1.0], [7.6, 0.45]],
    glass: { belt0: 5.9, belt1: 7.45, roof0: 6.0, roof1: 7.1, beltY: 1.15, roofY: 2.35 },
    wheelR: 0.46, wheelbase: 4.6, rearAxle: 1.5, tumble: 0.08,
  },
};

const BLACK: RGB = [0.02, 0.02, 0.02];
const WHITE: RGB = [0.8, 0.8, 0.8];

export function buildVehicleModel(type: VehicleType): VehicleModel {
  const p = P[type];
  const parts = new Map<VehiclePart, MeshBuilder>();
  const part = (k: VehiclePart): MeshBuilder => {
    let b = parts.get(k);
    if (!b) parts.set(k, (b = new MeshBuilder()));
    return b;
  };
  const L = p.length;
  const W = p.width;
  const hw = W / 2;
  // Model z runs front (-L/2) to rear (+L/2); profile z is measured from the rear.
  const Z = (fromRear: number): number => L / 2 - fromRear;

  // Lower body: extrude the side silhouette across the width, with a slight inward
  // chamfer top and bottom so the sides look rounded.
  const paint = part('paint');
  const sil = p.lower;
  const sideRing = (x: number): [number, number, number][] => sil.map(([s, y]) => [x, y, Z(s)]);
  const inset = 0.07;
  const R = sideRing(hw);
  const Lf = sideRing(-hw);
  // Top surfaces (hood, beltline deck, trunk) span between the two sides, chamfered.
  for (let i = 0; i + 1 < sil.length; i++) {
    const [s0, y0] = sil[i];
    const [s1, y1] = sil[i + 1];
    const up = y0 > 0.5 && y1 > 0.5; // skip the bumper ends and the bottom
    if (!up) continue;
    const a: [number, number, number] = [-hw + inset, y0, Z(s0)];
    const b: [number, number, number] = [hw - inset, y0, Z(s0)];
    const c: [number, number, number] = [hw - inset, y1, Z(s1)];
    const d: [number, number, number] = [-hw + inset, y1, Z(s1)];
    quad(paint, a, b, c, d);
    // Chamfers down to the full-width sides.
    quad(paint, b, [hw, y0 - 0.05, Z(s0)], [hw, y1 - 0.05, Z(s1)], c);
    quad(paint, [-hw, y0 - 0.05, Z(s0)], a, d, [-hw, y1 - 0.05, Z(s1)]);
  }
  // Sides: vertical panels under the silhouette (fan from the bottom line).
  const bottom = 0.22 + (p.wheelR > 0.4 ? 0.12 : 0);
  for (const [side, ring] of [[1, R], [-1, Lf]] as const) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const [x, y0, z0] = ring[i];
      const [, y1, z1] = ring[i + 1];
      const t0 = Math.max(bottom, Math.min(y0 - 0.05, y0));
      const t1 = Math.max(bottom, Math.min(y1 - 0.05, y1));
      if (Math.abs(z1 - z0) < 1e-3) continue;
      const lo0: [number, number, number] = [x, bottom, z0];
      const lo1: [number, number, number] = [x, bottom, z1];
      const hi0: [number, number, number] = [x, t0, z0];
      const hi1: [number, number, number] = [x, t1, z1];
      // The ring runs rear to front (z decreasing); order the corners so faces point out.
      if (side === 1) quad(paint, lo0, lo1, hi1, hi0);
      else quad(paint, lo1, lo0, hi0, hi1);
    }
  }
  // Front and rear faces (bumper fascia), full width.
  const front = sil[sil.length - 1];
  const frontTop = sil[sil.length - 2];
  const rear = sil[0];
  const rearTop = sil[1];
  quad(paint, [hw, bottom, Z(front[0])], [-hw, bottom, Z(front[0])], [-hw, frontTop[1] - 0.05, Z(frontTop[0])], [hw, frontTop[1] - 0.05, Z(frontTop[0])]);
  quad(paint, [-hw, bottom, Z(rear[0])], [hw, bottom, Z(rear[0])], [hw, rearTop[1] - 0.05, Z(rearTop[0])], [-hw, rearTop[1] - 0.05, Z(rearTop[0])]);
  // Underbody.
  const under = part('trim');
  box(under, 0, bottom + 0.02, 0, hw - 0.05, 0.03, L / 2 - 0.15, 0, BLACK);

  // Pickup bed: open box behind the cab.
  if (p.bed) {
    const { from, to, y } = p.bed;
    box(under, 0, y - 0.1, (Z(from) + Z(to)) / 2, hw - 0.12, 0.04, (to - from) / 2, 0, [0.05, 0.05, 0.05]);
  }

  // Greenhouse: glass all round, roof panel and pillars in paint.
  if (p.glass) {
    const g = p.glass;
    const glass = part('glass');
    const bw = hw - 0.06;
    const rw = hw - p.tumble / 2 - 0.02;
    const b0 = Z(g.belt0);
    const b1 = Z(g.belt1);
    const r0 = Z(g.roof0);
    const r1 = Z(g.roof1);
    const by = g.beltY;
    const ry = g.roofY;
    // Windscreen (front, toward -z), rear glass, two sides.
    quad(glass, [bw, by, b1], [-bw, by, b1], [-rw, ry, r1], [rw, ry, r1]);
    quad(glass, [-bw, by, b0], [bw, by, b0], [rw, ry, r0], [-rw, ry, r0]);
    quad(glass, [bw, by, b0], [bw, by, b1], [rw, ry, r1], [rw, ry, r0]);
    quad(glass, [-bw, by, b1], [-bw, by, b0], [-rw, ry, r0], [-rw, ry, r1]);
    // Roof panel.
    quad(paint, [-rw, ry, r0], [rw, ry, r0], [rw, ry, r1], [-rw, ry, r1]);
    // Pillars (A, B, C) just outside the glass.
    const pill = (zb: number, zr: number, t: number): void => {
      for (const s of [1, -1]) beam(paint, [s * (bw + 0.01), by, zb], [s * (rw + 0.01), ry, zr], t);
    };
    pill(b1, r1, 0.09);
    pill(b0, r0, 0.14);
    if (type !== 'bus' && type !== 'boxTruck' && type !== 'pickup') pill((b0 + b1) / 2 + 0.2, (r0 + r1) / 2 + 0.2, 0.1);
    if (type === 'bus') for (let s = 1.4; s < L - 0.6; s += 1.6) pill(Z(s), Z(s), 0.12);
  }

  // Box truck cargo box.
  if (type === 'boxTruck') {
    box(paint, 0, 2.05, Z(2.9), hw + 0.02, 1.85, 2.85, 0, WHITE);
  }

  // Wheels: tyre, rim and hub, with dark arches above.
  const tyre = part('tyre');
  const rim = part('rim');
  const axles = [Z(p.rearAxle), Z(p.rearAxle + p.wheelbase)];
  if (type === 'boxTruck' || type === 'bus') axles.push(Z(p.rearAxle - 1.25));
  for (const az of axles) {
    for (const s of [1, -1]) {
      const x = s * (hw - 0.12);
      wheel(tyre, rim, x, p.wheelR, az, 0.24);
      box(under, x, p.wheelR + 0.05, az, 0.13, p.wheelR * 0.75, p.wheelR + 0.1, 0, BLACK);
    }
  }

  // Lights, grille, plates, mirrors.
  const head = part('headlight');
  const tail = part('taillight');
  const chrome = part('chrome');
  const fz = Z(front[0]) - 0.005;
  const rz = Z(rear[0]) + 0.005;
  const headY = frontTop[1] - 0.14;
  const tailY = rearTop[1] - 0.14;
  for (const s of [1, -1]) {
    box(head, s * (hw - 0.3), headY, fz + 0.02, 0.22, 0.07, 0.03);
    box(tail, s * (hw - 0.22), tailY, rz - 0.02, 0.2, 0.07, 0.03);
    if (type !== 'bus' && type !== 'boxTruck') box(paint, s * (hw + 0.08), (p.glass?.beltY ?? 1) + 0.1, Z((p.glass?.belt1 ?? L) - 0.25), 0.09, 0.06, 0.12);
  }
  box(under, 0, headY - 0.14, fz + 0.03, hw * 0.45, 0.09, 0.03, 0, BLACK); // grille
  box(chrome, 0, bottom + 0.22, fz + 0.03, 0.26, 0.07, 0.01, 0, WHITE); // plate
  box(chrome, 0, tailY - 0.18, rz - 0.03, 0.26, 0.07, 0.01, 0, WHITE);

  // Type extras.
  const roofY = p.glass?.roofY ?? p.lower.reduce((m, [, y]) => Math.max(m, y), 0);
  const roofMid = p.glass ? (Z(p.glass.roof0) + Z(p.glass.roof1)) / 2 : 0;
  if (type === 'taxi') {
    const sign = part('sign');
    box(sign, 0, roofY + 0.14, roofMid, 0.35, 0.13, 0.12);
  }
  if (type === 'police') {
    const sign = part('sign');
    box(under, 0, roofY + 0.06, roofMid, 0.62, 0.06, 0.16, 0, BLACK);
    box(sign, 0.3, roofY + 0.14, roofMid, 0.28, 0.06, 0.13);
    box(sign, -0.3, roofY + 0.14, roofMid, 0.28, 0.06, 0.13);
    box(under, 0, 0.5, fz - 0.15, hw * 0.7, 0.18, 0.06, 0, BLACK); // push bar
  }
  if (type === 'bus') {
    const sign = part('sign');
    box(sign, 0, 2.6, fz + 0.03, 0.9, 0.12, 0.02);
  }

  const out = new Map<VehiclePart, MeshData>();
  for (const [k, b] of parts) if (!b.isEmpty) out.set(k, b.build());
  return { type, length: L, width: W, height: roofY, parts: out };
}

function wheel(tyre: MeshBuilder, rim: MeshBuilder, x: number, r: number, z: number, width: number): void {
  // Wheel axis along X: build a cylinder along Y, then swap axes.
  const t = new MeshBuilder();
  cylinder(t, 0, -width / 2, 0, r, r, width, 14);
  const rm = new MeshBuilder();
  cylinder(rm, 0, -width / 2 - 0.005, 0, r * 0.62, r * 0.62, width + 0.01, 10);
  for (const [src, dst] of [[t, tyre], [rm, rim]] as const) {
    const d = src.build();
    for (let i = 0; i < d.positions.length; i += 3) {
      const px = d.positions[i];
      const py = d.positions[i + 1];
      const pz = d.positions[i + 2];
      d.positions[i] = py + x; // axis Y -> X
      d.positions[i + 1] = px + r; // lift to ground
      d.positions[i + 2] = pz + z;
      const nx = d.normals[i];
      const ny = d.normals[i + 1];
      d.normals[i] = ny;
      d.normals[i + 1] = nx;
    }
    // Swapping two axes mirrors the mesh; flip triangle winding to keep faces outward.
    for (let i = 0; i < d.indices.length; i += 3) {
      const tmp = d.indices[i + 1];
      d.indices[i + 1] = d.indices[i + 2];
      d.indices[i + 2] = tmp;
    }
    dst.append(d);
  }
}
