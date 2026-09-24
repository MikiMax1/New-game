// Broadleaf foliage atlas: live-oak leaf clusters, shrub leaves (green, croton, bougainvillea,
// ixora), an opaque tileable hedge surface, lawn / dune / dry grass and Spanish moss.

import type * as THREE from 'three';
import { FOLIAGE, FOLIAGE_SIZE, type PixelRect } from '../../world/props/atlas';
import { Rng } from '../../world/rng';
import { alphaTexture, createCanvas, drawBlade, hsl, TileNoise, type Ctx } from './paint';

interface ClusterStyle {
  leaves: number;
  size: [number, number];
  aspect: number;
  hue: [number, number];
  sat: [number, number];
  light: [number, number];
  blobs: number;
  twigs: number;
  under: number;
  pointed: boolean;
  midrib: boolean;
  /** Extra colour picker for variegated / flowering shrubs. */
  paint?: (rng: Rng, depth: number) => string | null;
}

function leafShape(ctx: Ctx, x: number, y: number, len: number, wid: number, ang: number, pointed: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  if (pointed) {
    ctx.moveTo(-len / 2, 0);
    ctx.quadraticCurveTo(-len * 0.1, -wid, len / 2, 0);
    ctx.quadraticCurveTo(-len * 0.1, wid, -len / 2, 0);
  } else {
    ctx.ellipse(0, 0, len / 2, wid / 2, 0, 0, Math.PI * 2);
  }
  ctx.restore();
}

function paintCluster(ctx: Ctx, r: PixelRect, rng: Rng, s: ClusterStyle): void {
  const circles: [number, number, number][] = [];
  for (let i = 0; i < s.blobs; i++) {
    circles.push([rng.range(0.28, 0.72), rng.range(0.25, 0.7), rng.range(0.17, 0.3)]);
  }
  circles.push([0.5, 0.48, 0.3]);
  const inside = (u: number, v: number): number => {
    let best = -1;
    for (const [cx, cy, cr] of circles) best = Math.max(best, 1 - Math.hypot(u - cx, v - cy) / cr);
    return best;
  };
  // Twigs from the lower middle out into the cluster.
  ctx.lineCap = 'round';
  for (let i = 0; i < s.twigs; i++) {
    const [cx, cy] = circles[i % circles.length];
    const tx = r.x + (cx + rng.range(-0.12, 0.12)) * r.w;
    const ty = r.y + (cy + rng.range(-0.12, 0.12)) * r.h;
    ctx.strokeStyle = hsl(28, 0.25, rng.range(0.16, 0.26));
    ctx.lineWidth = rng.range(1.2, 2.6);
    ctx.beginPath();
    ctx.moveTo(r.x + r.w * rng.range(0.42, 0.58), r.y + r.h * 0.97);
    ctx.quadraticCurveTo(r.x + r.w * rng.range(0.35, 0.65), r.y + r.h * 0.7, tx, ty);
    ctx.stroke();
  }
  const list: { x: number; y: number; d: number; a: number; l: number }[] = [];
  let tries = 0;
  while (list.length < s.leaves && tries++ < s.leaves * 8) {
    const u = rng.next(), v = rng.next();
    const d = inside(u, v);
    if (d <= 0 && !rng.chance(0.01)) continue;
    if (d < 0.25 && rng.chance(0.5)) continue;
    const a = Math.atan2(v - 0.5, u - 0.5) + rng.range(-1.2, 1.2);
    list.push({ x: r.x + u * r.w, y: r.y + v * r.h, d: rng.next(), a, l: rng.range(s.size[0], s.size[1]) });
  }
  list.sort((p, q) => p.d - q.d);
  for (const lf of list) {
    const hue = s.hue[0] + (s.hue[1] - s.hue[0]) * rng.next();
    const sat = s.sat[0] + (s.sat[1] - s.sat[0]) * rng.next();
    let light = s.light[0] + (s.light[1] - s.light[0]) * lf.d * rng.range(0.85, 1.1);
    let fill = hsl(hue, sat, light);
    if (rng.chance(s.under)) {
      light = s.light[1] * 1.3;
      fill = hsl(hue - 10, sat * 0.45, light);
    }
    const custom = s.paint?.(rng, lf.d);
    if (custom) fill = custom;
    leafShape(ctx, lf.x, lf.y, lf.l, lf.l * s.aspect, lf.a, s.pointed);
    ctx.fillStyle = fill;
    ctx.fill();
    if (s.midrib && lf.l > 11) {
      ctx.strokeStyle = hsl(hue - 15, sat * 0.6, Math.min(0.8, light * 1.5), 0.55);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(lf.x - (Math.cos(lf.a) * lf.l) / 2.2, lf.y - (Math.sin(lf.a) * lf.l) / 2.2);
      ctx.lineTo(lf.x + (Math.cos(lf.a) * lf.l) / 2.4, lf.y + (Math.sin(lf.a) * lf.l) / 2.4);
      ctx.stroke();
    }
  }
}

/**
 * Tree leaf cluster (live oak): several small, irregular sprays of tiny leaves on twigs spread
 * over the whole card, so a card never reads as one round disc. Leaves near each spray's
 * centre are drawn last and lighter, which gives each spray a rounded, sunlit top.
 */
function paintTreeCluster(ctx: Ctx, r: PixelRect, rng: Rng, s: { sprays: number; leaves: number; hue: [number, number]; light: [number, number] }): void {
  const noise = new TileNoise(6, 6, rng.fork('n'));
  const sprays: [number, number, number][] = [];
  for (let i = 0; i < s.sprays; i++) sprays.push([rng.range(0.18, 0.82), rng.range(0.15, 0.78), rng.range(0.11, 0.2)]);
  // Short twigs inside each spray only (twigs reaching the card edge show up as lines in the sky).
  ctx.lineCap = 'round';
  for (const [cx, cy, cr] of sprays) {
    ctx.strokeStyle = hsl(26, 0.2, rng.range(0.14, 0.22));
    ctx.lineWidth = rng.range(1.2, 2.0);
    const a = rng.range(0, Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(r.x + (cx - Math.cos(a) * cr * 0.7) * r.w, r.y + (cy - Math.sin(a) * cr * 0.7) * r.h);
    ctx.quadraticCurveTo(r.x + (cx + rng.range(-0.03, 0.03)) * r.w, r.y + (cy + rng.range(-0.03, 0.03)) * r.h, r.x + (cx + Math.cos(a) * cr * 0.6) * r.w, r.y + (cy + Math.sin(a) * cr * 0.6) * r.h);
    ctx.stroke();
  }
  const leaves: { x: number; y: number; d: number; a: number; l: number }[] = [];
  let tries = 0;
  while (leaves.length < s.leaves && tries++ < s.leaves * 10) {
    const u = rng.next(), v = rng.next();
    let best = 0;
    for (const [cx, cy, cr] of sprays) best = Math.max(best, 1 - Math.hypot(u - cx, (v - cy) * 1.15) / cr);
    const dens = best * (0.7 + 0.6 * noise.sample(u, v));
    if (dens <= 0.05 || !rng.chance(Math.min(1, dens * 2.2))) continue;
    leaves.push({ x: r.x + u * r.w, y: r.y + v * r.h, d: Math.min(1, best + rng.range(-0.25, 0.25)), a: rng.range(0, Math.PI * 2), l: rng.range(7, 13) });
  }
  leaves.sort((p, q) => p.d - q.d);
  for (const lf of leaves) {
    const hue = s.hue[0] + (s.hue[1] - s.hue[0]) * rng.next();
    const light = s.light[0] + (s.light[1] - s.light[0]) * Math.max(0, lf.d) * rng.range(0.85, 1.1);
    leafShape(ctx, lf.x, lf.y, lf.l, lf.l * 0.48, lf.a, false);
    ctx.fillStyle = rng.chance(0.06) ? hsl(hue - 12, 0.14, light * 1.6 + 0.08) : hsl(hue, rng.range(0.3, 0.42), light);
    ctx.fill();
  }
}

function paintHedge(ctx: Ctx, r: PixelRect, rng: Rng): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.fillStyle = hsl(100, 0.35, 0.09);
  ctx.fillRect(r.x, r.y, r.w, r.h);
  const n = 2600;
  for (let i = 0; i < n; i++) {
    const d = i / n;
    const x = rng.range(0, r.w), y = rng.range(0, r.h);
    const l = rng.range(7, 13);
    const fill = hsl(rng.range(92, 112), rng.range(0.35, 0.5), 0.1 + 0.26 * d * rng.range(0.8, 1.15));
    for (const dx of [-r.w, 0, r.w]) {
      for (const dy of [-r.h, 0, r.h]) {
        const px = r.x + x + dx, py = r.y + y + dy;
        if (px < r.x - 20 || px > r.x + r.w + 20 || py < r.y - 20 || py > r.y + r.h + 20) continue;
        leafShape(ctx, px, py, l, l * 0.55, rng.range(0, Math.PI * 2), true);
        ctx.fillStyle = fill;
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function paintGrass(ctx: Ctx, r: PixelRect, rng: Rng, blades: number, hue: [number, number], light: [number, number], sat: number, widthPx: number): void {
  const X = (u: number) => r.x + u * r.w;
  const Y = (t: number) => r.y + (1 - t) * r.h;
  for (let i = 0; i < blades; i++) {
    const x0 = rng.range(0.08, 0.92);
    const h = rng.range(0.45, 0.97);
    const lean = rng.range(-0.3, 0.3);
    const x1 = Math.min(0.99, Math.max(0.01, x0 + lean));
    const d = i / blades;
    const g = ctx.createLinearGradient(0, Y(0), 0, Y(h));
    const hu = rng.range(hue[0], hue[1]);
    g.addColorStop(0, hsl(hu + 8, sat, light[0] * 0.7));
    g.addColorStop(1, hsl(hu - 6, sat, light[0] + (light[1] - light[0]) * d));
    drawBlade(ctx, X(x0), Y(0), X(x0 + lean * 0.3), Y(h * 0.6), X(x1), Y(h), rng.range(widthPx * 0.7, widthPx * 1.3), g, { base: 1, widest: 0.05, steps: 8 });
  }
}

function paintDuneGrass(ctx: Ctx, r: PixelRect, rng: Rng): void {
  paintGrass(ctx, r, rng, 55, [58, 75], [0.3, 0.55], 0.32, 3.2);
  const X = (u: number) => r.x + u * r.w;
  const Y = (t: number) => r.y + (1 - t) * r.h;
  // Sea-oat seed heads: arching stalks with hanging flat spikelets.
  for (let i = 0; i < 5; i++) {
    const x0 = rng.range(0.25, 0.75);
    const top = rng.range(0.85, 0.97);
    const tipX = x0 + rng.range(-0.15, 0.15);
    ctx.strokeStyle = hsl(45, 0.35, 0.55);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(X(x0), Y(0));
    ctx.quadraticCurveTo(X(x0), Y(top * 0.7), X(tipX), Y(top));
    ctx.stroke();
    for (let k = 0; k < 9; k++) {
      const t = top - k * 0.035;
      const sx = X(tipX + (x0 - tipX) * (k / 30) + (k % 2 ? 0.03 : -0.03));
      ctx.fillStyle = hsl(42, 0.45, rng.range(0.55, 0.7));
      ctx.beginPath();
      ctx.ellipse(sx, Y(t) + 6, 3.2, 7, k % 2 ? 0.4 : -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function paintMoss(ctx: Ctx, r: PixelRect, rng: Rng): void {
  // Strands hang from the top edge (t = 1) downwards.
  // A few bunches of thin, wiry strands (Spanish moss hangs in wisps, not sheets).
  ctx.lineCap = 'round';
  const bunches = [0.22, 0.4, 0.58, 0.78].map((c) => c + rng.range(-0.05, 0.05));
  for (let i = 0; i < 36; i++) {
    const c = bunches[i % bunches.length];
    const x = r.x + r.w * Math.min(0.94, Math.max(0.06, c + rng.range(-0.09, 0.09)));
    const center = 1 - Math.abs((x - r.x) / r.w - 0.5) * 1.3;
    const len = r.h * rng.range(0.3, 0.95) * Math.max(0.35, center);
    ctx.strokeStyle = hsl(rng.range(70, 95), rng.range(0.07, 0.13), rng.range(0.36, 0.52), 0.95);
    ctx.lineWidth = rng.range(0.8, 1.5);
    ctx.beginPath();
    let px = x, py = r.y;
    ctx.moveTo(px, py);
    const steps = 12;
    for (let k = 1; k <= steps; k++) {
      px += rng.range(-3, 3);
      py = r.y + (len * k) / steps;
      ctx.lineTo(px, py);
      if (rng.chance(0.25)) {
        ctx.moveTo(px, py);
        ctx.lineTo(px + rng.range(-7, 7), py + rng.range(3, 10));
        ctx.moveTo(px, py);
      }
    }
    ctx.stroke();
  }
}

export function paintFoliageAtlas(): THREE.Texture {
  const c = createCanvas(FOLIAGE_SIZE.w, FOLIAGE_SIZE.h);
  const rng = new Rng('foliage-atlas');
  const ctx = c.ctx;
  paintTreeCluster(ctx, FOLIAGE.oakA.px, rng.fork('oakA'), { sprays: 7, leaves: 3400, hue: [88, 106], light: [0.07, 0.25] });
  paintTreeCluster(ctx, FOLIAGE.oakB.px, rng.fork('oakB'), { sprays: 9, leaves: 3600, hue: [80, 98], light: [0.08, 0.27] });
  paintCluster(ctx, FOLIAGE.shrubGreen.px, rng.fork('green'), {
    leaves: 420, size: [14, 26], aspect: 0.55, hue: [95, 120], sat: [0.4, 0.6], light: [0.1, 0.34],
    blobs: 5, twigs: 6, under: 0.05, pointed: true, midrib: true,
  });
  paintCluster(ctx, FOLIAGE.shrubCroton.px, rng.fork('croton'), {
    leaves: 300, size: [18, 30], aspect: 0.42, hue: [80, 110], sat: [0.5, 0.7], light: [0.12, 0.32],
    blobs: 5, twigs: 5, under: 0, pointed: true, midrib: true,
    paint: (g, d) => {
      const k = g.next();
      if (k < 0.3) return hsl(g.range(40, 52), 0.85, 0.38 + 0.2 * d);
      if (k < 0.5) return hsl(g.range(8, 22), 0.75, 0.3 + 0.15 * d);
      if (k < 0.62) return hsl(g.range(345, 360), 0.55, 0.22 + 0.1 * d);
      return null;
    },
  });
  paintCluster(ctx, FOLIAGE.shrubFlower.px, rng.fork('bougainvillea'), {
    leaves: 460, size: [10, 18], aspect: 0.65, hue: [95, 115], sat: [0.4, 0.55], light: [0.1, 0.3],
    blobs: 6, twigs: 6, under: 0, pointed: true, midrib: false,
    paint: (g, d) => (g.chance(0.42) ? hsl(g.range(312, 330), 0.75, 0.38 + 0.2 * d) : null),
  });
  paintHedge(ctx, FOLIAGE.hedge.px, rng.fork('hedge'));
  paintGrass(ctx, FOLIAGE.grass.px, rng.fork('grass'), 80, [78, 100], [0.2, 0.42], 0.42, 4.5);
  paintDuneGrass(ctx, FOLIAGE.duneGrass.px, rng.fork('dune'));
  paintMoss(ctx, FOLIAGE.moss.px, rng.fork('moss'));
  paintGrass(ctx, FOLIAGE.grassDry.px, rng.fork('dry'), 40, [38, 52], [0.32, 0.58], 0.35, 3.5);
  paintCluster(ctx, FOLIAGE.ixora.px, rng.fork('ixora'), {
    leaves: 520, size: [10, 16], aspect: 0.45, hue: [100, 118], sat: [0.45, 0.6], light: [0.09, 0.28],
    blobs: 6, twigs: 5, under: 0, pointed: true, midrib: false,
    paint: (g, d) => (g.chance(0.22) ? hsl(g.range(2, 16), 0.85, 0.42 + 0.12 * d) : null),
  });
  return alphaTexture(c, [45, 62, 30]);
}
