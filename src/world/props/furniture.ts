// Street furniture. Unless noted, the functional front faces -Z (place with -Z towards the
// roadway / the user).
//
// fireHydrant   0.78 m, pumper nozzle towards -Z, hose nozzles along +-X.
//               0: yellow (Miami-Dade), 1: red with white bonnet, 2: yellow with blue caps.
// bench         seat faces -Z, 0: cast-iron ends + wood slats 1.8 m, 1: backless steel +
//               wood 1.6 m, 2: concrete blocks + wood 2.0 m.
// trashCan      0: green painted can with label (faces -Z), 1: black steel-mesh can,
//               2: solar compactor kiosk (door towards -Z).
// busShelter    4.0 x 1.5 x 2.6 m, open side towards -Z, back glass at +Z. 0: ad panel at
//               +X end + glass at -X end, 1: compact 3.2 m with glass both ends.
// newspaperBox  0.5 x 0.44 x 1.07 m, door / window towards -Z; 3 publications.
// parkingMeter  0: single head 1.4 m, 1: double head, 2: pay-by-plate kiosk 1.75 m (face -Z).
// bollard       0: yellow steel pipe 1.03 m, 1: black cast-iron 0.94 m, 2: concrete 0.83 m.
// acUnit        condensing units, service side -Z. 0: 0.75 m residential on a pad,
//               1: 1.0 m, 2: 2.0 x 1.1 m rooftop package unit on rails (long side along X).
// dumpster      4-yard front-load, 1.9 m wide (X), front (sloped) towards -Z, lids at the top.

import { SIGN, TILE_METRES } from './atlas';
import { rgb, v3, type PropBuild, type RGB } from './builder';

export function buildFireHydrant(b: PropBuild): void {
  const v = b.variant % 3;
  const body = [rgb(0xf2c200), rgb(0xc62a1e), rgb(0xf2c200)][v];
  const cap = [rgb(0xf2c200), rgb(0xe8e6de), rgb(0x2f6fc2)][v];
  const paint = b.part('metalPainted');
  const sides = b.seg(8, 6);
  paint.color = body;
  paint.lathe([[0.15, 0], [0.15, 0.045], [0.11, 0.06], [0.1, 0.1], [0.1, 0.5], [0.122, 0.515], [0.122, 0.56], [0.1, 0.575]], sides, { uvScale: 0.5 });
  paint.color = cap;
  paint.push().translate(0, 0.575, 0);
  paint.lathe([[0.1, 0], [0.086, 0.07], [0.045, 0.11], [0.04, 0.115]], sides, { smooth: true, uvScale: 0.5 });
  paint.lathe([[0.03, 0.115], [0.03, 0.165], [0, 0.165]], 5, { uvScale: 0.5 });
  paint.pop();
  const nozzle = (rot: 'px' | 'nx' | 'nz', r: number, len: number, y: number) => {
    paint.push().translate(0, y, 0);
    if (rot === 'px') paint.rotateZ(-Math.PI / 2);
    else if (rot === 'nx') paint.rotateZ(Math.PI / 2);
    else paint.rotateX(-Math.PI / 2);
    paint.cylinder(0, 0.07, 0, r, r * 0.95, len, 6, { uvScale: 0.5 });
    paint.pop();
  };
  nozzle('px', 0.045, 0.1, 0.4);
  nozzle('nx', 0.045, 0.1, 0.4);
  nozzle('nz', 0.062, 0.1, 0.36);
}

export function buildBench(b: PropBuild): void {
  const v = b.variant % 3;
  const wood = b.part('wood');
  const iron = b.part('metalPainted');
  const conc = b.part('concrete');
  wood.color = [rgb(0xb07a4c), rgb(0xa06e44), rgb(0x9c7652)][v];
  const slat = (x: number, y: number, z: number, len: number, d: number, t: number, tilt = 0) => {
    wood.push().translate(x, y, z).rotateX(tilt);
    wood.box(0, 0, 0, len, t, d, { swap: true, uvScale: TILE_METRES.wood });
    wood.pop();
  };
  if (v === 0) {
    iron.color = rgb(0x1e2022);
    const frame: [number, number][] = [
      [-0.27, 0], [-0.2, 0], [-0.19, 0.36], [0.14, 0.36], [0.2, 0], [0.27, 0], [0.23, 0.42],
      [0.33, 0.86], [0.27, 0.87], [0.17, 0.44], [-0.26, 0.44],
    ];
    for (const x of [-0.8, 0.8]) {
      iron.push().translate(x, 0, 0).rotateY(-Math.PI / 2);
      iron.extrude(frame, 0.05, { uvScale: 0.5 });
      iron.pop();
    }
    for (let i = 0; i < 5; i++) slat(0, 0.458, -0.23 + i * 0.085, 1.8, 0.07, 0.035);
    const tilt = Math.atan2(0.1, 0.43);
    for (let i = 0; i < 3; i++) {
      const y = 0.55 + i * 0.13;
      slat(0, y, 0.17 + (y - 0.44) * 0.233 - 0.02, 1.8, 0.035, 0.09, tilt);
    }
  } else if (v === 1) {
    iron.color = rgb(0x3a3e42);
    for (const x of [-0.62, 0.62]) {
      iron.box(x, 0.21, -0.18, 0.05, 0.42, 0.05, { skip: ['ny'], uvScale: 1 });
      iron.box(x, 0.21, 0.18, 0.05, 0.42, 0.05, { skip: ['ny'], uvScale: 1 });
      iron.box(x, 0.43, 0, 0.06, 0.04, 0.46, { uvScale: 1 });
    }
    for (let i = 0; i < 6; i++) slat(0, 0.47, -0.2 + i * 0.08, 1.6, 0.065, 0.035);
  } else {
    conc.color = rgb(0xc9c3b6);
    for (const x of [-0.72, 0.72]) conc.box(x, 0.21, 0, 0.36, 0.42, 0.44, { skip: ['ny'], uvScale: 1 });
    for (let i = 0; i < 4; i++) slat(0, 0.445, -0.18 + i * 0.12, 2.0, 0.1, 0.05);
  }
}

export function buildTrashCan(b: PropBuild): void {
  const v = b.variant % 3;
  const sides = b.seg(12, 8);
  if (v === 0) {
    const paint = b.part('metalPainted');
    const sign = b.part('signFace');
    paint.color = rgb(0x24503a);
    paint.lathe([[0.27, 0], [0.29, 0.02], [0.3, 0.1], [0.3, 0.8], [0.315, 0.82], [0.315, 0.86]], sides, { uvScale: 1 });
    paint.color = rgb(0x1f3f2f);
    paint.push().translate(0, 0.86, 0);
    paint.lathe([[0.315, 0], [0.29, 0.06], [0.2, 0.12], [0.08, 0.15], [0, 0.155]], sides, { smooth: true, uvScale: 1 });
    paint.pop();
    // Label band on the front (-Z) side.
    sign.color = rgb(0xffffff);
    sign.lathe([[0.302, 0.52], [0.302, 0.6]], 4, { rect: SIGN.trashLabel, phase: Math.PI / 2 - 0.55, arc: 1.1 });
  } else if (v === 1) {
    const mesh = b.part('signFace');
    const paint = b.part('metalPainted');
    mesh.color = rgb(0x2a2c2e);
    // Steel mesh body (coil-guard texture wrapped around), solid rim and flat lid.
    mesh.lathe([[0.27, 0.02], [0.28, 0.85]], sides, { rect: SIGN.coilGuard });
    paint.color = rgb(0x1a1b1c);
    paint.lathe([[0.26, 0], [0.27, 0.02]], sides, { uvScale: 1 });
    paint.lathe([[0.285, 0.84], [0.295, 0.9], [0.295, 0.94], [0.2, 0.96], [0, 0.965]], sides, { uvScale: 1 });
    paint.lathe([[0.2, 0.02], [0.2, 0.1], [0, 0.1]], 6, { uvScale: 1 }); // base plinth hidden inside
  } else {
    // Solar compactor: boxy steel body, slanted solar lid, front hopper door.
    const paint = b.part('metalPainted');
    const sign = b.part('signFace');
    paint.color = rgb(0x3d6b4a);
    paint.hexa([v3(-0.33, 0, 0.34), v3(0.33, 0, 0.34), v3(0.33, 0, -0.34), v3(-0.33, 0, -0.34), v3(-0.33, 1.2, 0.34), v3(0.33, 1.2, 0.34), v3(0.33, 1.12, -0.34), v3(-0.33, 1.12, -0.34)], 1, ['ny']);
    sign.color = rgb(0xffffff);
    sign.quad4(v3(0.29, 0.1, -0.345), v3(-0.29, 0.1, -0.345), v3(-0.29, 1.06, -0.345), v3(0.29, 1.06, -0.345), SIGN.bigBelly);
    paint.color = rgb(0x1b2330);
    paint.hexa([v3(-0.31, 1.2, 0.32), v3(0.31, 1.2, 0.32), v3(0.31, 1.12, -0.32), v3(-0.31, 1.12, -0.32), v3(-0.31, 1.24, 0.32), v3(0.31, 1.24, 0.32), v3(0.31, 1.16, -0.32), v3(-0.31, 1.16, -0.32)], 1, ['ny']);
  }
}

export function buildBusShelter(b: PropBuild): void {
  const v = b.variant % 2;
  const W = v === 0 ? 4.0 : 3.2;
  const D = 1.5;
  const hx = W / 2 - 0.05, hz = D / 2 - 0.1;
  const frame = b.part('metalPainted');
  const glass = b.part('glass');
  const wood = b.part('wood');
  const sign = b.part('signFace');
  const ad = b.part('adPanel');
  frame.color = rgb(0x3b4146);
  for (const x of [-hx, hx]) for (const z of [-hz, hz]) frame.box(x, 1.25, z, 0.08, 2.5, 0.08, { skip: ['ny'], uvScale: 1 });
  // Roof with a slight fall towards the back and a coloured fascia.
  frame.color = rgb(0xe9e7e2);
  frame.hexa([
    v3(-W / 2 - 0.15, 2.5, D / 2 + 0.05), v3(W / 2 + 0.15, 2.5, D / 2 + 0.05), v3(W / 2 + 0.15, 2.56, -D / 2 - 0.25), v3(-W / 2 - 0.15, 2.56, -D / 2 - 0.25),
    v3(-W / 2 - 0.15, 2.6, D / 2 + 0.05), v3(W / 2 + 0.15, 2.6, D / 2 + 0.05), v3(W / 2 + 0.15, 2.68, -D / 2 - 0.25), v3(-W / 2 - 0.15, 2.68, -D / 2 - 0.25),
  ], 1);
  frame.color = rgb(0x1f6fb2);
  frame.box(0, 2.6, -D / 2 - 0.27, W + 0.34, 0.2, 0.04, { uvScale: 1 });
  sign.color = rgb(0xffffff);
  sign.quad4(v3(W / 2 - 0.1, 2.52, -D / 2 - 0.292), v3(W / 2 - 0.4, 2.52, -D / 2 - 0.292), v3(W / 2 - 0.4, 2.68, -D / 2 - 0.292), v3(W / 2 - 0.1, 2.68, -D / 2 - 0.292), SIGN.busStop);
  // Back glass (+Z) with rails.
  frame.color = rgb(0x3b4146);
  glass.quad4(v3(-hx, 0.25, hz), v3(hx, 0.25, hz), v3(hx, 2.2, hz), v3(-hx, 2.2, hz));
  frame.box(0, 0.23, hz, W - 0.1, 0.05, 0.05, { uvScale: 1 });
  frame.box(0, 2.22, hz, W - 0.1, 0.05, 0.05, { uvScale: 1 });
  // End panels.
  const endGlass = (x: number) => {
    glass.quad4(v3(x, 0.25, -hz), v3(x, 0.25, hz), v3(x, 2.2, hz), v3(x, 2.2, -hz));
    frame.box(x, 0.23, 0, 0.05, 0.05, D - 0.2, { uvScale: 1 });
    frame.box(x, 2.22, 0, 0.05, 0.05, D - 0.2, { uvScale: 1 });
  };
  endGlass(-hx);
  if (v === 0) {
    // Back-lit advertising panel at +X, posters on both faces.
    frame.box(hx, 1.2, 0, 0.14, 2.0, D - 0.12, { uvScale: 1 });
    const x0 = hx - 0.071, x1 = hx + 0.071, zA = -hz + 0.08, zB = hz - 0.08;
    ad.color = rgb(0xffffff);
    ad.quad4(v3(x0, 0.35, zA), v3(x0, 0.35, zB), v3(x0, 2.05, zB), v3(x0, 2.05, zA), SIGN.adA);
    ad.quad4(v3(x1, 0.35, zB), v3(x1, 0.35, zA), v3(x1, 2.05, zA), v3(x1, 2.05, zB), SIGN.adB);
    b.light(hx, 1.2, 0, [1, 0.95, 0.9], 60, 'sign');
  } else {
    endGlass(hx);
  }
  // Bench.
  wood.color = rgb(0xa47450);
  for (let i = 0; i < 3; i++) {
    wood.box(-0.2, 0.46, 0.25 + i * 0.12, 2.2, 0.035, 0.1, { swap: true, uvScale: TILE_METRES.wood });
  }
  for (const x of [-1.1, 0.7]) frame.box(x, 0.22, 0.37, 0.05, 0.44, 0.3, { skip: ['ny'], uvScale: 1 });
}

export function buildNewspaperBox(b: PropBuild): void {
  const v = b.variant % 3;
  const paint = b.part('metalPainted');
  const glass = b.part('glass');
  const sign = b.part('signFace');
  const galv = b.part('metalGalv');
  const body = [rgb(0x1d4f91), rgb(0xc8202f), rgb(0xf3c623)][v];
  paint.color = rgb(0x2a2c2e);
  paint.box(0, 0.22, 0, 0.1, 0.44, 0.1, { skip: ['ny'], uvScale: 1 });
  paint.box(0, 0.01, 0, 0.36, 0.02, 0.32, { skip: ['ny'], uvScale: 1 });
  paint.color = body;
  paint.box(0, 0.75, 0, 0.5, 0.62, 0.44, { uvScale: 1 });
  paint.hexa([v3(-0.26, 1.06, 0.23), v3(0.26, 1.06, 0.23), v3(0.26, 1.06, -0.23), v3(-0.26, 1.06, -0.23), v3(-0.26, 1.08, 0.23), v3(0.26, 1.08, 0.23), v3(0.26, 1.06 + 0.035, -0.23), v3(-0.26, 1.06 + 0.035, -0.23)], 1);
  // Newsprint behind the window, then the window.
  paint.color = rgb(0xd8d6d0);
  paint.quad4(v3(0.18, 0.72, -0.2205), v3(-0.18, 0.72, -0.2205), v3(-0.18, 0.98, -0.2205), v3(0.18, 0.98, -0.2205));
  glass.quad4(v3(0.19, 0.71, -0.226), v3(-0.19, 0.71, -0.226), v3(-0.19, 0.99, -0.226), v3(0.19, 0.99, -0.226));
  sign.color = rgb(0xffffff);
  sign.quad4(v3(0.24, 1.0, -0.2215), v3(-0.24, 1.0, -0.2215), v3(-0.24, 1.055, -0.2215), v3(0.24, 1.055, -0.2215), SIGN.newspaper[v]);
  galv.color = rgb(0xffffff);
  galv.box(0.17, 0.6, -0.235, 0.09, 0.1, 0.03, { uvScale: 1 });
}

export function buildParkingMeter(b: PropBuild): void {
  const v = b.variant % 3;
  const galv = b.part('metalGalv');
  const paint = b.part('metalPainted');
  const sign = b.part('signFace');
  const sides = b.seg(6, 5);
  galv.color = rgb(0xffffff);
  if (v < 2) {
    galv.cylinder(0, -0.05, 0, 0.035, 0.035, 1.12, sides, { uvScale: 1 });
    const head = (x: number) => {
      paint.color = rgb(0x3a3d40);
      paint.box(x, 1.22, 0, 0.2, 0.26, 0.14, { uvScale: 1 });
      paint.push().translate(x, 1.35, 0).scale(1, 0.8, 0.7);
      paint.lathe([[0.1, 0], [0.085, 0.05], [0.05, 0.09], [0, 0.1]], sides, { smooth: true, uvScale: 1 });
      paint.pop();
      sign.color = rgb(0xffffff);
      sign.quad4(v3(x + 0.08, 1.12, -0.0705), v3(x - 0.08, 1.12, -0.0705), v3(x - 0.08, 1.33, -0.0705), v3(x + 0.08, 1.33, -0.0705), SIGN.meterFace);
    };
    if (v === 0) head(0);
    else {
      paint.color = rgb(0x3a3d40);
      paint.box(0, 1.1, 0, 0.36, 0.05, 0.08, { uvScale: 1 });
      head(-0.13);
      head(0.13);
    }
  } else {
    paint.color = rgb(0x2e3b4a);
    paint.box(0, 0.78, 0, 0.42, 1.52, 0.3, { uvScale: 1 });
    paint.color = rgb(0x1f2a36);
    paint.box(0, 1.57, 0, 0.48, 0.06, 0.36, { uvScale: 1 });
    sign.color = rgb(0xffffff);
    sign.quad4(v3(0.19, 0.55, -0.1505), v3(-0.19, 0.55, -0.1505), v3(-0.19, 1.5, -0.1505), v3(0.19, 1.5, -0.1505), SIGN.payStation);
    // Small solar panel on a tilted bracket.
    paint.color = rgb(0x18243a);
    paint.push().translate(0, 1.68, 0.02).rotateX(-0.45);
    paint.box(0, 0, 0, 0.4, 0.02, 0.3, { uvScale: 1 });
    paint.pop();
    galv.box(0, 1.62, 0.02, 0.04, 0.08, 0.04, { skip: ['ny', 'py'] });
  }
}

export function buildBollard(b: PropBuild): void {
  const v = b.variant % 3;
  const sides = b.seg(8, 6);
  if (v === 0) {
    const p = b.part('metalPainted');
    const Y = rgb(0xf0c010), Wt = rgb(0xf4f4ee);
    p.lathe([[0.1, -0.05], [0.1, 0.78], [0.1, 0.8], [0.1, 0.88], [0.1, 0.9], [0.1, 0.95], [0.075, 1.0], [0.035, 1.025], [0, 1.03]], sides, {
      uvScale: 1, colors: [Y, Y, Wt, Wt, Y, Y, Y, Y, Y],
    });
  } else if (v === 1) {
    const p = b.part('metalPainted');
    p.color = rgb(0x1c1e20);
    p.lathe([[0.11, -0.03], [0.11, 0.05], [0.085, 0.1], [0.075, 0.6], [0.092, 0.64], [0.092, 0.7], [0.06, 0.74], [0.075, 0.8], [0.075, 0.84], [0.058, 0.9], [0.022, 0.93], [0, 0.94]], sides, { smooth: false, uvScale: 1 });
  } else {
    const p = b.part('concrete');
    p.color = rgb(0xd0cbc0);
    p.lathe([[0.2, -0.03], [0.19, 0.7], [0.16, 0.78], [0.09, 0.82], [0, 0.83]], sides, { smooth: true, uvScale: 1 });
  }
}

export function buildAcUnit(b: PropBuild): void {
  const v = b.variant % 3;
  const paint = b.part('metalPainted');
  const sign = b.part('signFace');
  const conc = b.part('concrete');
  const galv = b.part('metalGalv');
  const housing = rgb(0xd6d2c6);
  if (v < 2) {
    const s = v === 0 ? 0.75 : 1.0;
    const h = v === 0 ? 0.78 : 0.95;
    conc.color = rgb(0xbdb8ad);
    conc.box(0, 0.035, 0, s + 0.2, 0.07, s + 0.2, { skip: ['ny'], uvScale: 1 });
    const y0 = 0.07;
    paint.color = housing;
    // Corner posts, top cap and base; coil guards fill the four sides.
    for (const x of [-1, 1]) for (const z of [-1, 1]) paint.box((x * (s - 0.05)) / 2, y0 + h / 2, (z * (s - 0.05)) / 2, 0.05, h, 0.05, { skip: ['ny', 'py'], uvScale: 1 });
    paint.box(0, y0 + 0.04, 0, s, 0.08, s, { skip: ['ny'], uvScale: 1 });
    paint.box(0, y0 + h - 0.05, 0, s + 0.02, 0.1, s + 0.02, { uvScale: 1 });
    sign.color = rgb(0xffffff);
    const e = s / 2 - 0.02, yA = y0 + 0.08, yB = y0 + h - 0.1;
    const g = SIGN.coilGuard;
    sign.quad4(v3(e, yA, -e), v3(-e, yA, -e), v3(-e, yB, -e), v3(e, yB, -e), g);
    sign.quad4(v3(-e, yA, e), v3(e, yA, e), v3(e, yB, e), v3(-e, yB, e), g);
    sign.quad4(v3(e, yA, e), v3(e, yA, -e), v3(e, yB, -e), v3(e, yB, e), g);
    sign.quad4(v3(-e, yA, -e), v3(-e, yA, e), v3(-e, yB, e), v3(-e, yB, -e), g);
    const f = s * 0.4, top = y0 + h + 0.002;
    sign.quad4(v3(-f, top, f), v3(f, top, f), v3(f, top, -f), v3(-f, top, -f), SIGN.fanGrille);
    // Service panel and refrigerant lines on the -Z side.
    paint.box(s / 2 - 0.12, y0 + h * 0.55, -s / 2 - 0.01, 0.2, h * 0.5, 0.03, { uvScale: 1 });
    galv.cylinder(-s / 2 + 0.12, y0 + 0.15, -s / 2 - 0.05, 0.015, 0.015, 0.3, 5, { uvScale: 1 });
  } else {
    // Rooftop package unit on two galvanised rails, long side along X.
    galv.color = rgb(0xffffff);
    for (const z of [-0.42, 0.42]) galv.box(0, 0.06, z, 2.1, 0.12, 0.1, { skip: ['ny'], uvScale: 1 });
    paint.color = housing;
    paint.box(0, 0.12 + 0.5, 0, 2.0, 1.0, 1.1, { skip: ['ny'], uvScale: 1 });
    sign.color = rgb(0xffffff);
    const top = 1.122;
    for (const x of [-0.5, 0.5]) sign.quad4(v3(x - 0.36, top, 0.36), v3(x + 0.36, top, 0.36), v3(x + 0.36, top, -0.36), v3(x - 0.36, top, -0.36), SIGN.fanGrille);
    const l = SIGN.louver;
    sign.quad4(v3(0.9, 0.3, -0.551), v3(-0.2, 0.3, -0.551), v3(-0.2, 0.95, -0.551), v3(0.9, 0.95, -0.551), l);
    sign.quad4(v3(-0.9, 0.3, 0.551), v3(0.9, 0.3, 0.551), v3(0.9, 0.95, 0.551), v3(-0.9, 0.95, 0.551), l);
    sign.quad4(v3(1.001, 0.3, 0.45), v3(1.001, 0.3, -0.45), v3(1.001, 0.95, -0.45), v3(1.001, 0.95, 0.45), SIGN.coilGuard);
    paint.color = rgb(0xc2beb2);
    paint.box(-0.65, 0.62, -0.56, 0.5, 0.8, 0.02, { uvScale: 1 });
  }
}

export function buildDumpster(b: PropBuild): void {
  const v = b.variant % 3;
  const paint = b.part('metalPainted');
  const lid = b.part('plastic');
  const color: RGB = [rgb(0x2f5a3a), rgb(0x2a5aa0), rgb(0x6a4a36)][v];
  paint.color = color;
  const hx = 0.95;
  // Body: vertical back, front sloping out at the top; open top (lids cover it).
  paint.hexa([
    v3(-hx, 0.12, 0.72), v3(hx, 0.12, 0.72), v3(hx, 0.12, -0.5), v3(-hx, 0.12, -0.5),
    v3(-hx, 1.45, 0.72), v3(hx, 1.45, 0.72), v3(hx, 1.24, -0.78), v3(-hx, 1.24, -0.78),
  ], 1, ['py']);
  // Top rim and fork pockets.
  paint.color = [color[0] * 0.8, color[1] * 0.8, color[2] * 0.8];
  paint.box(0, 1.235, -0.8, 2 * hx + 0.04, 0.06, 0.06, { uvScale: 1 });
  for (const x of [-hx - 0.05, hx + 0.05]) paint.box(x, 1.0, -0.05, 0.1, 0.16, 1.1, { uvScale: 1 });
  for (const x of [-hx + 0.08, hx - 0.08]) for (const z of [-0.42, 0.64]) paint.box(x, 0.06, z, 0.1, 0.12, 0.1, { skip: ['ny'], uvScale: 1 });
  // Two plastic lids following the top slope.
  lid.color = v === 1 ? rgb(0x1b1c1e) : rgb(0x23262a);
  const slope = Math.atan2(1.45 - 1.24, 0.72 + 0.78);
  for (const x of [-hx / 2, hx / 2]) {
    lid.push().translate(x, 1.36, -0.03).rotateX(-slope);
    lid.box(0, 0, 0, hx - 0.03, 0.045, 1.58, { uvScale: 1 });
    lid.pop();
  }
}
