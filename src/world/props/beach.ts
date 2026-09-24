// Beach props.
//
// lifeguardTower  Miami-Beach style pastel hut on stilts, window and deck facing -Z (the
//                 sea), ramp running down towards +Z (landward) from the back of the deck.
//                 ~2.3 x 2.0 m hut on a 1.75 m high deck, roof to ~4.6 m, flag pole to ~5.3 m.
//                 0: pink / teal / yellow roof, 1: turquoise / pink / white, 2: yellow / blue / coral.
// beachUmbrella   2.2-2.5 m canopy on a 2.3 m pole. 0: red-white stripes, 1: blue-white,
//                 2: yellow-teal, tilted 12 degrees towards -Z.
// lounger         chaise longue 1.95 x 0.65 m, feet towards -Z, backrest at +Z.
//                 0: white plastic, back up 40 deg, 1: aluminium + blue cushion, flat-ish,
//                 2: teak with white cushion, back up 30 deg.

import { SIGN } from './atlas';
import { mulRgb, rgb, v3, type PropBuild, type RGB } from './builder';

export function buildLifeguardTower(b: PropBuild): void {
  const v = b.variant % 3;
  const bodyC: RGB = [rgb(0xf2a3bc), rgb(0x62cfc6), rgb(0xf6d35c)][v];
  const trimC: RGB = [rgb(0x2fb2ad), rgb(0xe8648a), rgb(0x2f78c4)][v];
  const roofC: RGB = [rgb(0xf6d547), rgb(0xf3f0e8), rgb(0xef7a5a)][v];
  const wood = b.part('wood');
  const glass = b.part('glass');
  const sign = b.part('signFace');
  const fabric = b.part('fabric');
  const paint = b.part('metalPainted');
  const deckY = 1.75;
  // Stilts and side braces (white-washed timber).
  wood.color = rgb(0xece8de);
  for (const x of [-1.15, 1.15]) {
    for (const z of [-1.3, 1.1]) wood.box(x, deckY / 2 - 0.05, z, 0.18, deckY + 0.1, 0.18, { skip: ['ny', 'py'], uvScale: 1 });
    wood.push().translate(x, deckY / 2, -0.1).rotateX(Math.atan2(deckY - 0.3, 2.4));
    wood.box(0, 0, 0, 0.08, 0.1, 2.6, { uvScale: 1 });
    wood.pop();
  }
  // Deck.
  wood.color = trimC;
  wood.box(0, deckY + 0.06, 0, 2.9, 0.12, 3.3, { uvScale: 1 });
  const floor = deckY + 0.12;
  // Hut.
  const hw = 2.3, hh = 2.0, hd = 1.9, hz = 0.45;
  wood.color = bodyC;
  wood.box(0, floor + hh / 2, hz, hw, hh, hd, { skip: ['ny'], uvScale: 1 });
  // Contrasting band around the hut.
  wood.color = trimC;
  wood.box(0, floor + 0.55, hz, hw + 0.03, 0.14, hd + 0.03, { skip: ['ny', 'py'], uvScale: 1 });
  // Windows: wide sea-facing window and side windows; a door at the back.
  const fz = hz - hd / 2 - 0.006;
  glass.quad4(v3(0.85, floor + 0.85, fz), v3(-0.85, floor + 0.85, fz), v3(-0.85, floor + 1.65, fz), v3(0.85, floor + 1.65, fz));
  for (const s of [-1, 1]) {
    const x = s * (hw / 2 + 0.006);
    const a = v3(x, floor + 0.9, hz - s * 0.45), c = v3(x, floor + 0.9, hz + s * 0.45);
    glass.quad4(a, c, c.clone().setY(floor + 1.55), a.clone().setY(floor + 1.55));
  }
  wood.color = mulRgb(trimC, 0.85);
  const bz = hz + hd / 2 + 0.006;
  wood.quad4(v3(-0.1 - 0.4, floor, bz), v3(-0.1 + 0.4, floor, bz), v3(-0.1 + 0.4, floor + 1.8, bz), v3(-0.1 - 0.4, floor + 1.8, bz));
  // Sign board above the window.
  sign.color = rgb(0xffffff);
  const sr = SIGN.lifeguard;
  const edge = { u0: sr.u0 + 0.002, v0: sr.v0 + 0.01, u1: sr.u0 + 0.006, v1: sr.v0 + 0.02 };
  sign.box(0, floor + 1.83, fz - 0.02, 1.5, 0.3, 0.04, { rects: { nz: sr, pz: edge, px: edge, nx: edge, py: edge, ny: edge } });
  // Hip roof with overhang and fascia.
  const ry = floor + hh;
  wood.color = roofC;
  wood.hexa([
    v3(-1.45, ry, hz + 1.2), v3(1.45, ry, hz + 1.2), v3(1.45, ry, hz - 1.25), v3(-1.45, ry, hz - 1.25),
    v3(-0.35, ry + 0.75, hz + 0.1), v3(0.35, ry + 0.75, hz + 0.1), v3(0.35, ry + 0.75, hz - 0.1), v3(-0.35, ry + 0.75, hz - 0.1),
  ], 1);
  wood.color = trimC;
  wood.box(0, ry - 0.05, hz - 0.025, 2.94, 0.1, 2.49, { skip: ['py'], uvScale: 1 });
  // Solid parapets around the front deck.
  wood.color = bodyC;
  wood.box(0, floor + 0.45, -1.62, 2.9, 0.9, 0.06, { uvScale: 1 });
  for (const x of [-1.42, 1.42]) wood.box(x, floor + 0.45, -1.07, 0.06, 0.9, 1.05, { uvScale: 1 });
  // Ramp down to the sand towards +Z, with handrails.
  const rampLen = 4.3;
  const ang = Math.atan2(floor, rampLen);
  const len = Math.hypot(floor, rampLen);
  const rx = 0.55;
  wood.color = trimC;
  wood.push().translate(rx, floor / 2, 1.65 + rampLen / 2).rotateX(ang);
  wood.box(0, 0, 0, 1.0, 0.08, len, { uvScale: 1 });
  for (const s of [-1, 1]) wood.box(s * 0.5, 0.85, 0, 0.05, 0.06, len, { uvScale: 1 });
  wood.pop();
  for (const s of [-1, 1]) wood.box(rx + s * 0.5, 0.45, 1.65 + rampLen - 0.15, 0.06, 0.9, 0.06, { skip: ['ny'], uvScale: 1 });
  // Flag pole on the roof with the red-over-yellow lifeguard flag.
  paint.color = rgb(0xdedede);
  paint.cylinder(-1.05, ry + 0.1, hz - 0.9, 0.025, 0.02, 1.35, 5, { uvScale: 1 });
  const fx = -1.05, fy = ry + 1.18, fzz = hz - 0.9;
  fabric.color = rgb(0xd8262c);
  fabric.quad4(v3(fx, fy, fzz), v3(fx + 0.55, fy, fzz + 0.05), v3(fx + 0.55, fy + 0.17, fzz + 0.05), v3(fx, fy + 0.17, fzz));
  fabric.color = rgb(0xf5d000);
  fabric.quad4(v3(fx, fy - 0.17, fzz), v3(fx + 0.55, fy - 0.17, fzz + 0.05), v3(fx + 0.55, fy, fzz + 0.05), v3(fx, fy, fzz));
}

export function buildBeachUmbrella(b: PropBuild): void {
  const v = b.variant % 3;
  const Rc = [1.1, 1.15, 1.25][v];
  const cols: [RGB, RGB] = [
    [rgb(0xd8343c), rgb(0xf2efe8)],
    [rgb(0x2266b0), rgb(0xf2efe8)],
    [rgb(0xf2c230), rgb(0x2aa39a)],
  ][v] as [RGB, RGB];
  const pole = b.part('metalGalv');
  const fabric = b.part('fabric');
  pole.color = rgb(0xf0f0ec);
  const joint = 1.7;
  pole.cylinder(0, -0.25, 0, 0.022, 0.022, joint + 0.25, 6, { uvScale: 1 });
  const tilt = v === 2 ? 0.21 : 0;
  for (const p of [pole, fabric]) p.push().translate(0, joint, 0).rotateX(-tilt);
  pole.cylinder(0, 0, 0, 0.02, 0.02, 0.65, 6, { uvScale: 1 });
  const apex = v3(0, 0.62, 0);
  const n = 8;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
    fabric.color = cols[k % 2];
    const ring = (a: number, r: number, y: number) => v3(Math.cos(a) * r, y, -Math.sin(a) * r);
    const m0 = ring(a0, Rc * 0.55, 0.49), m1 = ring(a1, Rc * 0.55, 0.49);
    const r0 = ring(a0, Rc, 0.24), r1 = ring(a1, Rc, 0.24);
    fabric.face([apex, m0, m1]);
    fabric.face([m0, r0, r1, m1]);
    // Valance flap.
    fabric.face([r0, r0.clone().add(v3(0, -0.13, 0)), r1.clone().add(v3(0, -0.13, 0)), r1]);
  }
  pole.cylinder(0, 0.6, 0, 0.03, 0.0, 0.1, 5, { uvScale: 1 });
  for (const p of [pole, fabric]) p.pop();
}

export function buildLounger(b: PropBuild): void {
  const v = b.variant % 3;
  const frame = v === 0 ? b.part('plastic') : v === 1 ? b.part('metalGalv') : b.part('wood');
  const cushion = b.part('fabric');
  frame.color = [rgb(0xf4f3ef), rgb(0xd8dadb), rgb(0xa77a50)][v];
  const seatY = 0.32;
  const back = [0.7, 0.18, 0.52][v];
  // Legs and side rails.
  for (const x of [-0.29, 0.29]) {
    for (const z of [-0.85, 0.2]) frame.box(x, seatY / 2, z, 0.04, seatY, 0.04, { skip: ['ny'], uvScale: 1 });
    frame.box(x, seatY, -0.3, 0.04, 0.05, 1.3, { uvScale: 1 });
  }
  // Seat bed and hinged backrest (rotates up about the hinge at z = 0.33).
  frame.box(0, seatY + 0.035, -0.31, 0.62, 0.04, 1.28, { uvScale: 1, swap: v === 2 });
  frame.push().translate(0, seatY + 0.035, 0.33).rotateX(-back);
  frame.box(0, 0, 0.34, 0.62, 0.04, 0.68, { uvScale: 1, swap: v === 2 });
  if (v !== 0) {
    cushion.color = v === 1 ? rgb(0x2f64a8) : rgb(0xf0ede4);
    cushion.push().translate(0, seatY + 0.035, 0.33).rotateX(-back);
    cushion.box(0, 0.045, 0.34, 0.6, 0.05, 0.66, { uvScale: 1 });
    cushion.pop();
    cushion.box(0, seatY + 0.08, -0.31, 0.6, 0.05, 1.26, { uvScale: 1 });
  }
  frame.pop();
  // Back legs / prop stand under the raised backrest.
  if (back > 0.3) {
    frame.push().translate(0, seatY + 0.035, 0.33).rotateX(-back);
    frame.box(0, -0.12, 0.45, 0.5, 0.03, 0.03, { uvScale: 1 });
    frame.pop();
  }
}
