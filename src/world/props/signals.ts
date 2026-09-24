// Traffic control: signal mast arms, pedestrian signals, stop signs, street-name signs.
//
// trafficSignalMast  pole at the origin, arm reaching along +X, signal heads facing -Z
//                    (towards drivers approaching from -Z). Heads hang >= 5.1 m above ground.
//                    0: 8 m arm, 2 heads + overhead street-name sign
//                    1: 12 m arm, 3 heads + overhead street-name sign
//                    2: 10 m arm, 3 heads, pedestrian head on the pole (facing -X)
// pedSignal          3.1 m pole, hand / walking-person head facing -Z, push button.
//                    0: one head, 1: corner pole with heads facing -Z and -X.
// stopSign           0.76 m octagon (30 in) on a square post, face towards -Z, bottom 2.1 m.
//                    0: plain, 1: with ALL WAY plaque.
// streetNameSign     3.4 m post with two crossed blades (along X at 3.1 m, along Z at 3.35 m).
//                    Variants use different name pairs.
//
// Signal lenses use the 'signalLens' material; the shader cycles red / amber / green and the
// pedestrian symbols (see src/render/props/shaderPatches.ts). Lights list every lens.

import { SIGN } from './atlas';
import { rgb, v3, type Part, type PropBuild, type RGB } from './builder';
import { SIGNAL_LENS } from './types';

const YELLOW = rgb(0xe3b21c);
const BLACK = rgb(0x151617);
const LENS_TINT: Record<number, RGB> = {
  [SIGNAL_LENS.red]: rgb(0x5a0c08),
  [SIGNAL_LENS.amber]: rgb(0x5a3606),
  [SIGNAL_LENS.green]: rgb(0x08402c),
  [SIGNAL_LENS.pedHand]: rgb(0x6a4a3a),
  [SIGNAL_LENS.pedWalk]: rgb(0x5a6068),
};
const LENS_LIGHT: Record<number, RGB> = {
  [SIGNAL_LENS.red]: [1, 0.06, 0.03],
  [SIGNAL_LENS.amber]: [1, 0.42, 0.02],
  [SIGNAL_LENS.green]: [0.12, 1, 0.62],
  [SIGNAL_LENS.pedHand]: [1, 0.42, 0.08],
  [SIGNAL_LENS.pedWalk]: [0.92, 0.96, 1],
};

/** A hood over a lens: open half-tube along -Z, both inner and outer faces. */
function visor(p: Part, x: number, y: number, z: number, r: number, len: number): void {
  const segs = 2;
  const pts: [number, number][] = [];
  for (let i = 0; i <= segs; i++) {
    const a = Math.PI * 0.95 - (Math.PI * 0.9 * i) / segs; // 171 -> 9 degrees (left, over the top, right)
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  for (let i = 0; i < segs; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const l = Math.hypot(mx, my) || 1;
    const nx = mx / l, ny = my / l;
    // Outer face (normal away from the axis), then inner face (towards the axis).
    const a0 = p.vert(x + x0, y + y0, z, nx, ny, 0), a1 = p.vert(x + x1, y + y1, z, nx, ny, 0);
    const a2 = p.vert(x + x1, y + y1 * 0.7, z - len, nx, ny, 0), a3 = p.vert(x + x0, y + y0 * 0.7, z - len, nx, ny, 0);
    p.quad(a0, a1, a2, a3);
    const b0 = p.vert(x + x0, y + y0, z, -nx, -ny, 0), b1 = p.vert(x + x1, y + y1, z, -nx, -ny, 0);
    const b2 = p.vert(x + x1, y + y1 * 0.7, z - len, -nx, -ny, 0), b3 = p.vert(x + x0, y + y0 * 0.7, z - len, -nx, -ny, 0);
    p.quad(b0, b3, b2, b1);
  }
}

/** Round lens facing -Z at (x, y, z). */
function lens(b: PropBuild, x: number, y: number, z: number, r: number, kind: number, rect = SIGN.lens): void {
  const p = b.part('signalLens');
  p.signal = kind;
  p.color = LENS_TINT[kind];
  p.push().translate(x, y, z).rotateX(-Math.PI / 2);
  p.disc(0, 0, 0, r, 6, rect, Math.PI / 6);
  p.pop();
  b.light(x, y, z - 0.02, LENS_LIGHT[kind], 300, 'signal');
}

/** Square symbol lens (pedestrian heads) facing -Z. */
function symbolLens(b: PropBuild, x: number, y: number, z: number, w: number, h: number, kind: number, rect = SIGN.pedHand): void {
  const p = b.part('signalLens');
  p.signal = kind;
  p.color = LENS_TINT[kind];
  p.quad4(v3(x + w / 2, y - h / 2, z), v3(x - w / 2, y - h / 2, z), v3(x - w / 2, y + h / 2, z), v3(x + w / 2, y + h / 2, z), rect);
  b.light(x, y, z - 0.02, LENS_LIGHT[kind], 120, 'signal');
}

/** Three-section vehicle signal head hanging from (x, yTop, z), facing -Z. */
function vehicleHead(b: PropBuild, x: number, yTop: number, z: number): void {
  const paint = b.part('metalPainted');
  const W = 0.34, D = 0.25, Hh = 1.06;
  const cy = yTop - 0.14 - Hh / 2;
  paint.color = YELLOW;
  paint.box(x, yTop - 0.07, z, 0.06, 0.14, 0.06, { skip: ['py', 'ny'] }); // hanger
  paint.box(x, cy, z, W, Hh, D, { skip: ['pz'] });
  // Backplate (black, 5 in border look) as a double-sided panel just behind the housing.
  paint.color = BLACK;
  const bz = z + D / 2 + 0.005;
  const bw = 0.31, bh = 0.68;
  paint.quad4(v3(x + bw, cy - bh, bz), v3(x - bw, cy - bh, bz), v3(x - bw, cy + bh, bz), v3(x + bw, cy + bh, bz));
  paint.quad4(v3(x - bw, cy - bh, bz + 0.003), v3(x + bw, cy - bh, bz + 0.003), v3(x + bw, cy + bh, bz + 0.003), v3(x - bw, cy + bh, bz + 0.003));
  const fz = z - D / 2;
  const kinds = [SIGNAL_LENS.red, SIGNAL_LENS.amber, SIGNAL_LENS.green];
  kinds.forEach((k, i) => {
    const ly = cy + (1 - i) * 0.35;
    lens(b, x, ly, fz - 0.004, 0.15, k);
    paint.color = YELLOW;
    visor(paint, x, ly, fz, 0.17, 0.22);
  });
}

function pedHead(b: PropBuild, x: number, y: number, z: number, yaw: number): void {
  const paint = b.part('metalPainted');
  for (const p of [paint, b.part('signalLens')]) p.push().translate(x, y, z).rotateY(yaw);
  paint.color = BLACK;
  paint.box(0, 0, 0, 0.44, 0.5, 0.22, {});
  const fz = -0.11 - 0.004;
  symbolLens(b, 0, 0.115, fz, 0.3, 0.2, SIGNAL_LENS.pedHand, SIGN.pedHand);
  symbolLens(b, 0, -0.115, fz, 0.3, 0.2, SIGNAL_LENS.pedWalk, SIGN.pedWalk);
  // Flat sun cap over the face (both sides, slanted down towards the front).
  const cy = 0.25, cz = -0.11;
  paint.quad4(v3(0.23, cy, cz), v3(-0.23, cy, cz), v3(-0.23, cy - 0.05, cz - 0.16), v3(0.23, cy - 0.05, cz - 0.16));
  paint.quad4(v3(-0.23, cy, cz), v3(0.23, cy, cz), v3(0.23, cy - 0.05, cz - 0.16), v3(-0.23, cy - 0.05, cz - 0.16));
  for (const p of [paint, b.part('signalLens')]) p.pop();
  // Lights were recorded in the head's local frame; move them to model space.
  const ls = b.lights.slice(-2);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const l of ls) {
    const [lx, ly, lz] = l.position;
    l.position = [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
  }
}

export function buildTrafficSignalMast(b: PropBuild): void {
  const v = b.variant % 3;
  const L = [8, 12, 10][v];
  const galv = b.part('metalGalv');
  const conc = b.part('concrete');
  const sides = b.seg(8, 6);
  conc.color = rgb(0xb6b2aa);
  conc.box(0, 0.0, 0, 0.9, 0.3, 0.9, { skip: ['ny'], uvScale: 1 });
  galv.color = rgb(0xffffff);
  galv.cylinder(0, 0.15, 0, 0.3, 0.26, 0.25, sides, { uvScale: 1, capTop: false }); // anchor-bolt skirt
  const Hp = 7.3;
  galv.cylinder(0, 0.4, 0, 0.19, 0.145, Hp - 0.4, sides, { uvScale: 1.5 });
  const ya = 6.45;
  galv.box(0.19, ya, 0, 0.08, 0.5, 0.4, { skip: ['nx'] }); // arm plate
  const arm = [0, 0.4, 1].map((s) => v3(0.22 + (L - 0.22) * s, ya + 0.35 * s * s, 0));
  galv.tube(arm, [0.14, 0.12, 0.075], b.seg(6, 4), { uvScale: 1.5, capEnd: true });
  const armY = (x: number) => ya + 0.35 * ((x - 0.22) / (L - 0.22)) ** 2;
  const heads = v === 0 ? [L * 0.6, L - 0.45] : [L * 0.37, L * 0.68, L - 0.45];
  for (const x of heads) vehicleHead(b, x, armY(x) - 0.1, 0);
  if (v !== 2) {
    // Overhead street-name sign hanging under the arm near the pole.
    const sign = b.part('signFace');
    const name = SIGN.streetNames[b.variant === 0 ? 0 : 2];
    const x = 2.1, w = 2.0, h = 0.42;
    const edge = { u0: name.u0 + 0.002, v0: name.v0 + 0.01, u1: name.u0 + 0.006, v1: name.v0 + 0.02 };
    sign.box(x, armY(x) - 0.12 - h / 2, 0, w, h, 0.03, { rects: { nz: name, pz: name, px: edge, nx: edge, py: edge, ny: edge } });
    galv.box(x - 0.7, armY(x) - 0.08, 0, 0.04, 0.12, 0.04, { skip: ['py', 'ny'] });
    galv.box(x + 0.7, armY(x) - 0.08, 0, 0.04, 0.12, 0.04, { skip: ['py', 'ny'] });
  } else {
    pedHead(b, -0.3, 3.1, 0, Math.PI / 2);
  }
}

export function buildPedSignal(b: PropBuild): void {
  const v = b.variant % 2;
  const galv = b.part('metalGalv');
  const paint = b.part('metalPainted');
  const sign = b.part('signFace');
  const sides = b.seg(8, 6);
  galv.color = rgb(0xffffff);
  galv.cylinder(0, -0.05, 0, 0.13, 0.1, 0.2, sides, { uvScale: 1 });
  galv.cylinder(0, 0.15, 0, 0.058, 0.055, 2.95, sides, { uvScale: 1.5 });
  pedHead(b, 0, 2.75, -0.2, 0);
  if (v === 1) pedHead(b, -0.2, 2.75, 0, Math.PI / 2);
  // Push button assembly on the -Z face.
  paint.color = YELLOW;
  paint.box(0, 1.06, -0.085, 0.1, 0.16, 0.06, {});
  const plaque = SIGN.crosswalkPlaque;
  sign.box(0, 1.34, -0.068, 0.23, 0.29, 0.008, { rects: { nz: plaque, pz: { u0: plaque.u0 + 0.01, v0: plaque.v0 + 0.01, u1: plaque.u0 + 0.02, v1: plaque.v0 + 0.02 } } });
}

export function buildStopSign(b: PropBuild): void {
  const v = b.variant % 2;
  const galv = b.part('metalGalv');
  const sign = b.part('signFace');
  galv.color = rgb(0xffffff);
  // Square perforated post.
  galv.box(0, 1.35, 0.02, 0.05, 2.9, 0.05, { skip: ['ny'], uvScale: 1 });
  const R = 0.38 / Math.cos(Math.PI / 8);
  const oct: [number, number][] = [];
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    oct.push([Math.cos(a) * R, Math.sin(a) * R]);
  }
  const cy = v === 1 ? 2.62 : 2.48;
  for (const p of [sign, galv]) p.push().translate(0, cy, -0.01);
  sign.color = rgb(0xffffff);
  sign.extrude(oct, 0.004, { frontRect: SIGN.stop, back: false, sides: false });
  galv.extrude(oct, 0.004, { front: false });
  for (const p of [sign, galv]) p.pop();
  if (v === 1) {
    const r = SIGN.allWay;
    const edge = { u0: r.u0 + 0.004, v0: r.v0 + 0.01, u1: r.u0 + 0.008, v1: r.v0 + 0.02 };
    sign.box(0, cy - R - 0.14, -0.01, 0.46, 0.17, 0.004, { rects: { nz: r, pz: edge, px: edge, nx: edge, py: edge, ny: edge } });
  }
}

export function buildStreetNameSign(b: PropBuild): void {
  const v = b.variant % 3;
  const galv = b.part('metalGalv');
  const sign = b.part('signFace');
  const sides = b.seg(8, 6);
  galv.color = rgb(0xffffff);
  galv.cylinder(0, -0.05, 0, 0.045, 0.04, 3.45, sides, { uvScale: 1.5, capTop: true });
  const names = [SIGN.streetNames[2 * v], SIGN.streetNames[2 * v + 1]];
  const blade = (y: number, rot: number, r: (typeof names)[number]) => {
    const edge = { u0: r.u0 + 0.004, v0: r.v0 + 0.01, u1: r.u0 + 0.008, v1: r.v0 + 0.02 };
    sign.push().translate(0, y, 0).rotateY(rot);
    sign.box(0.03, 0, 0, 0.92, 0.2, 0.012, { rects: { nz: r, pz: r, px: edge, nx: edge, py: edge, ny: edge } });
    sign.pop();
    galv.push().translate(0, y, 0).rotateY(rot);
    galv.box(0, 0, 0, 0.1, 0.22, 0.03, { skip: ['py', 'ny'] });
    galv.pop();
  };
  blade(3.12, 0, names[0]);
  blade(3.36, Math.PI / 2, names[1]);
}
