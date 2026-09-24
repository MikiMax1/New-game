// Street lighting and utility poles.
//
// streetLightCobra  galvanised pole with an upswept arm reaching towards -Z (place with -Z
//                   pointing at the roadway) and a cobra-head luminaire.
//                   0: 9.0 m pole, 2.4 m arm, flat LED head (4000 K)
//                   1: 10.0 m pole, 2.5 m arm, classic HPS cobra head (2100 K, orange)
//                   2: 9.5 m median pole with twin 2.2 m arms towards -Z and +Z (LED)
// streetLightDeco   4.5 m black ornamental post (beach district). 0: single acorn globe,
//                   1: twin globes on a crossbar along X.
// utilityPole       wooden distribution pole; wires run along X, crossarms along Z.
//                   0: 11 m, one crossarm + transformer can, 1: 12.2 m, double crossarm,
//                   2: 13 m, crossarm + secondary rack + small street light towards -Z.
//                   Anchors: 'primary0..2' (crossarm insulator tops), 'secondary0..2'.

import { rgb, v3, type Part, type PropBuild } from './builder';

// Lamp colours: the lens vertex colour tints both the lens by day and its glow at night.
const LED = rgb(0xfff4e8); // ~4000 K
const HPS = rgb(0xffb060); // high-pressure sodium, ~2100 K (light colour)
const HPS_LENS = rgb(0xffd6a6); // aged sodium lens: glows orange, looks cream by day
const WARM = rgb(0xffe0b8); // ~3000 K

/** Cobra-head luminaire hanging at `end`, long axis along `dir` (-1 = -Z, +1 = +Z). */
function cobraHead(b: PropBuild, x: number, y: number, z: number, dir: number, led: boolean, scale = 1): void {
  const galv = b.part('metalGalv');
  const lamp = b.part('emissiveLamp');
  const paint = b.part('metalPainted');
  const sides = b.seg(8, 6);
  for (const p of [galv, lamp, paint]) p.push().translate(x, y, z).rotateY(dir < 0 ? 0 : Math.PI).scale(scale, scale, scale);
  if (led) {
    // Flat, slightly tapered LED housing (dark grey) with a large flat lens underneath.
    paint.color = rgb(0x4a4d50);
    // Rings CCW from above: (-x,+z) (+x,+z) (+x,-z) (-x,-z).
    paint.hexa([
      v3(-0.17, 0, 0.05), v3(0.17, 0, 0.05), v3(0.15, 0, -0.62), v3(-0.15, 0, -0.62),
      v3(-0.16, 0.1, 0.03), v3(0.16, 0.1, 0.03), v3(0.13, 0.07, -0.6), v3(-0.13, 0.07, -0.6),
    ], 1);
    lamp.color = LED;
    // Flat lens facing down (same winding as the hexa's bottom face).
    lamp.face([v3(-0.13, -0.005, -0.1), v3(-0.12, -0.005, -0.56), v3(0.12, -0.005, -0.56), v3(0.13, -0.005, -0.1)]);
  } else {
    // Classic cobra: half shell of revolution along -Z, flattened, with a drop lens.
    galv.color = rgb(0xd4d6d6);
    galv.push().scale(1, 0.62, 1).rotateX(-Math.PI / 2);
    galv.lathe([[0.05, -0.05], [0.12, 0.06], [0.19, 0.25], [0.2, 0.45], [0.16, 0.66], [0.08, 0.76], [0, 0.78]], sides, { smooth: true, phase: Math.PI, arc: Math.PI, uvScale: 1 });
    galv.pop();
    lamp.color = HPS_LENS;
    // Drop-lens bowl under the shell.
    lamp.push().rotateX(-Math.PI / 2).scale(1, 1, 0.5);
    lamp.lathe([[0.1, 0.12], [0.16, 0.25], [0.165, 0.45], [0.12, 0.62], [0.02, 0.7]], sides, { smooth: true, phase: 0, arc: Math.PI, uvScale: 1 });
    lamp.pop();
  }
  for (const p of [galv, lamp, paint]) p.pop();
  const lz = z + (dir < 0 ? -0.35 : 0.35) * scale;
  b.light(x, y - 0.06, lz, led ? LED : HPS, led ? 1800 : 1500, 'street');
}

export function buildStreetLightCobra(b: PropBuild): void {
  const v = b.variant % 3;
  const Hp = [9.0, 10.0, 9.5][v];
  const arm = [2.4, 2.5, 2.2][v];
  const led = v !== 1;
  const galv = b.part('metalGalv');
  const conc = b.part('concrete');
  const sides = b.seg(8, 6);
  conc.color = rgb(0xbab6ae);
  conc.cylinder(0, -0.12, 0, 0.32, 0.3, 0.2, sides, { uvScale: 1 });
  galv.color = rgb(0xffffff);
  // Transformer base (square, slightly tapered) then the round tapered shaft.
  galv.hexa([v3(-0.2, 0.08, 0.2), v3(0.2, 0.08, 0.2), v3(0.2, 0.08, -0.2), v3(-0.2, 0.08, -0.2), v3(-0.17, 0.62, 0.17), v3(0.17, 0.62, 0.17), v3(0.17, 0.62, -0.17), v3(-0.17, 0.62, -0.17)], 1, ['ny']);
  galv.cylinder(0, 0.62, 0, 0.105, 0.065, Hp - 0.62, sides, { uvScale: 1.5 });
  for (const dir of v === 2 ? [-1, 1] : [-1]) {
    const y0 = Hp - 0.5;
    const pts = [0, 0.3, 0.65, 1].map((s) => v3(0, y0 + 0.75 * (1 - (1 - s) * (1 - s)), dir * (0.04 + arm * s)));
    galv.tube(pts, [0.058, 0.052, 0.046, 0.04], b.seg(6, 4), { uvScale: 1, capEnd: true });
    // Clamp bracket on the shaft.
    galv.box(0, y0 + 0.05, dir * 0.06, 0.12, 0.3, 0.1, { skip: ['ny', 'py'] });
    const end = pts[3];
    cobraHead(b, 0, end.y - 0.06, end.z + dir * 0.02, dir, led);
  }
}

export function buildStreetLightDeco(b: PropBuild): void {
  const v = b.variant % 2;
  const paint = b.part('metalPainted');
  const lamp = b.part('emissiveLamp');
  const sides = b.seg(8, 6);
  paint.color = rgb(0x1d1f20);
  // Fluted cast base, slender shaft, collars.
  const post: [number, number][] = [
    [0.21, 0], [0.2, 0.08], [0.15, 0.55], [0.09, 0.72], [0.06, 1.0], [0.058, 3.5], [0.09, 3.56], [0.05, 3.7], [0.1, 3.92],
  ];
  paint.lathe(post, sides, { uvScale: 1, capTop: true });
  const globe = (x: number, y: number, s: number, finial: boolean) => {
    lamp.color = WARM;
    lamp.push().translate(x, y, 0).scale(s, s, s);
    lamp.lathe([[0.09, 0], [0.2, 0.15], [0.2, 0.33], [0.13, 0.5], [0.05, 0.56]], v === 0 ? sides : 6, { smooth: true, uvScale: 1, capTop: !finial });
    lamp.pop();
    if (finial) {
      paint.push().translate(x, y + 0.56 * s, 0).scale(s, s, s);
      paint.lathe([[0.08, 0], [0.03, 0.08], [0, 0.22]], 6, { uvScale: 1 });
      paint.pop();
    }
    b.light(x, y + 0.28 * s, 0, WARM, 260, 'street');
  };
  if (v === 0) {
    globe(0, 3.92, 1, true);
  } else {
    // Crossbar with two globes.
    paint.box(0, 3.95, 0, 1.12, 0.06, 0.06, {});
    for (const x of [-0.52, 0.52]) {
      paint.cylinder(x, 3.98, 0, 0.08, 0.09, 0.06, 6, { uvScale: 1 });
      globe(x, 4.04, 0.85, false);
    }
  }
}

/** Pin insulator standing on (x, y, z). */
function insulator(p: Part, x: number, y: number, z: number): void {
  p.push().translate(x, y, z);
  p.lathe([[0.03, 0], [0.068, 0.07], [0, 0.16]], 5, { uvScale: 1 });
  p.pop();
}

export function buildUtilityPole(b: PropBuild): void {
  const v = b.variant % 3;
  const rng = b.rng;
  const H = [11.0, 12.2, 13.0][v];
  const wood = b.part('wood');
  const galv = b.part('metalGalv');
  const glass = b.part('plastic');
  const paint = b.part('metalPainted');
  const sides = b.seg(8, 6);
  wood.color = rgb(0x8a7460, rng.range(0.85, 1));
  const lean = rng.range(-0.08, 0.08);
  wood.tube([v3(0, -0.1, 0), v3(lean * 0.4, H * 0.5, 0), v3(lean, H, 0)], [0.17, 0.145, 0.12], sides, { uvScale: 1.5, capEnd: true });
  const top = v3(lean, H, 0);
  const arms = v === 1 ? [H - 0.35, H - 1.05] : [H - 0.35];
  glass.color = rgb(0x6f6a64);
  wood.color = rgb(0x9a8468);
  let a = 0;
  for (const y of arms) {
    // Crossarm bolted to the +X face of the pole, along Z.
    wood.box(top.x + 0.2, y, 0, 0.09, 0.11, 2.44, { uvScale: 1 });
    // Flat steel braces.
    for (const s of [-1, 1]) {
      galv.push().translate(top.x + 0.2, y - 0.45, s * 0.35).rotateX(s * 0.72);
      galv.box(0, 0, 0, 0.03, 0.9, 0.006, { uvScale: 1 });
      galv.pop();
    }
    for (const z of [-1.1, -0.45, 1.1]) {
      insulator(glass, top.x + 0.2, y + 0.055, z);
      b.anchor(`primary${a++}`, top.x + 0.2, y + 0.21, z);
    }
  }
  if (v === 0) {
    // Transformer can on the -X side with hanger brackets.
    const ty = H - 2.7;
    paint.color = rgb(0x9aa1a3);
    paint.push().translate(top.x - 0.46, ty, 0);
    paint.lathe([[0.26, 0], [0.27, 0.05], [0.27, 0.92], [0.12, 1.02], [0, 1.02]], sides, { uvScale: 1, capBottom: true });
    paint.pop();
    galv.box(top.x - 0.2, ty + 0.25, 0, 0.12, 0.08, 0.3, { uvScale: 1 });
    galv.box(top.x - 0.2, ty + 0.75, 0, 0.12, 0.08, 0.3, { uvScale: 1 });
    insulator(glass, top.x - 0.46, ty + 1.02, 0.1);
  }
  if (v === 2) {
    // Secondary rack (spool insulators) on the +Z side, low voltage drops.
    for (let i = 0; i < 3; i++) {
      const y = H - 3.6 - i * 0.3;
      galv.box(top.x, y, 0.2, 0.06, 0.05, 0.1, { uvScale: 1 });
      glass.cylinder(top.x, y - 0.05, 0.26, 0.04, 0.04, 0.1, 5, { uvScale: 1, capTop: false });
      b.anchor(`secondary${i}`, top.x, y, 0.3);
    }
    // Small street light on a bracket towards -Z.
    const y0 = H - 4.6;
    const pts = [v3(top.x, y0, -0.15), v3(top.x, y0 + 0.25, -0.9), v3(top.x, y0 + 0.35, -1.6)];
    galv.tube(pts, [0.035, 0.03, 0.028], 5, { uvScale: 1, capEnd: true });
    cobraHead(b, top.x, y0 + 0.28, -1.62, -1, true, 0.8);
  }
}
