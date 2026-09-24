// Palm textures: pinnate frond columns, sabal fan leaves, boot stubs (alpha atlas) and the
// trunk atlas (royal, crownshaft, coconut, sabal, sabal boots) with a matching roughness map.

import type * as THREE from 'three';
import { PALM_LEAF, PALM_LEAF_SIZE, PALM_TRUNK, PALM_TRUNK_SIZE, type PixelRect } from '../../world/props/atlas';
import { Rng } from '../../world/rng';
import { alphaTexture, clampByte, createCanvas, drawBlade, fillPixels, hsl, opaqueTexture, TileFbm, TileNoise, type Canvas, type Ctx } from './paint';

interface PinnateStyle {
  perSide: number;
  tStart: number;
  tEnd: number;
  /** Leaflet length as a fraction of the half width at t. */
  len: (t: number) => number;
  /** Forward reach of a leaflet tip (in t units) at t. */
  fwd: (t: number) => number;
  width: number;
  hue: number;
  sat: number;
  lightBase: number;
  lightTip: number;
  brownTips: number;
  missing: number;
  rachisW: [number, number];
  rachisColor: [string, string];
  dead?: boolean;
}

function paintPinnate(ctx: Ctx, r: PixelRect, rng: Rng, s: PinnateStyle): void {
  const X = (u: number) => r.x + u * r.w;
  const Y = (t: number) => r.y + (1 - t) * r.h;
  const leaflets: (() => void)[] = [];
  for (const side of [-1, 1]) {
    for (let j = 0; j < s.perSide; j++) {
      const t0 = s.tStart + ((j + rng.range(-0.35, 0.35)) / s.perSide) * (s.tEnd - s.tStart);
      if (rng.chance(s.missing)) continue;
      const len = s.len(t0) * rng.range(0.9, 1.04) * 0.47;
      const fwd = s.fwd(t0) * rng.range(0.85, 1.15);
      const ex = 0.5 + side * len;
      const et = Math.min(0.998, t0 + fwd);
      const cxu = 0.5 + side * len * 0.42;
      const ct = t0 + fwd * 0.3;
      const w = s.width * rng.range(0.8, 1.15) * (0.55 + 0.45 * Math.min(1, s.len(t0) * 1.3));
      const hue = s.hue + rng.range(-6, 6);
      const sat = s.sat * rng.range(0.85, 1.1);
      const lb = s.lightBase * rng.range(0.85, 1.15);
      const lt = s.lightTip * rng.range(0.88, 1.12);
      const brown = rng.chance(s.brownTips);
      const bend = rng.range(-0.012, 0.012);
      leaflets.push(() => {
        const g = ctx.createLinearGradient(X(0.5), Y(t0), X(ex), Y(et));
        g.addColorStop(0, hsl(hue + 6, sat * 0.8, lb * 0.8));
        g.addColorStop(0.35, hsl(hue, sat, lb));
        if (brown) {
          g.addColorStop(0.75, hsl(hue - 8, sat, lt));
          g.addColorStop(0.86, hsl(38, 0.4, 0.42));
          g.addColorStop(1, hsl(32, 0.35, 0.36));
        } else {
          g.addColorStop(1, hsl(hue - 8, sat * 1.05, lt));
        }
        drawBlade(ctx, X(0.5), Y(t0), X(cxu), Y(ct + bend), X(ex), Y(et), w, g, { base: 0.45, widest: 0.25, steps: 12 });
        // Midrib highlight.
        ctx.strokeStyle = hsl(hue - 10, sat * 0.6, Math.min(0.85, lt * 1.35), 0.45);
        ctx.lineWidth = Math.max(0.8, w * 0.14);
        ctx.beginPath();
        ctx.moveTo(X(0.5), Y(t0));
        ctx.quadraticCurveTo(X(cxu), Y(ct + bend), X(0.5 + (ex - 0.5) * 0.8), Y(t0 + (et - t0) * 0.8));
        ctx.stroke();
      });
    }
  }
  // Random draw order gives natural overlaps.
  rng.shuffle(leaflets);
  for (const f of leaflets) f();
  // Rachis on top: tapered, lighter along its upper edge.
  const steps = 24;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 0.995;
    const hw = (s.rachisW[0] + (s.rachisW[1] - s.rachisW[0]) * t) / 2;
    ctx.lineTo(X(0.5) - hw, Y(t));
  }
  for (let i = steps; i >= 0; i--) {
    const t = (i / steps) * 0.995;
    const hw = (s.rachisW[0] + (s.rachisW[1] - s.rachisW[0]) * t) / 2;
    ctx.lineTo(X(0.5) + hw, Y(t));
  }
  ctx.closePath();
  const rg = ctx.createLinearGradient(X(0.5) - s.rachisW[0], 0, X(0.5) + s.rachisW[0], 0);
  rg.addColorStop(0, s.rachisColor[1]);
  rg.addColorStop(0.45, s.rachisColor[0]);
  rg.addColorStop(1, s.rachisColor[1]);
  ctx.fillStyle = rg;
  ctx.fill();
}

interface FanStyle {
  segs: number;
  split: number;
  hue: number;
  sat: number;
  light: number;
  dead: boolean;
}

function paintFan(ctx: Ctx, r: PixelRect, rng: Rng, s: FanStyle): void {
  const X = (u: number) => r.x + u * r.w;
  const Y = (t: number) => r.y + (1 - t) * r.h;
  const segW = 1 / s.segs;
  const colL = (k: number, l: number, a = 1) => (s.dead ? hsl(32 + k, 0.24, l, a) : hsl(s.hue + k, s.sat, l, a));
  for (let k = 0; k < s.segs; k++) {
    const s0 = k * segW, s1 = (k + 1) * segW, sc = (s0 + s1) / 2;
    const edge = Math.abs(sc - 0.5) * 2;
    const tEnd = 0.985 - 0.22 * Math.pow(edge, 1.8) - rng.range(0, 0.05);
    const tSplit = Math.min(tEnd - 0.12, s.split * (0.9 + 0.2 * rng.next()) * (1 - 0.25 * edge));
    const hueJ = rng.range(-4, 4);
    const lJ = rng.range(0.9, 1.1);
    // Continuous (pleated) part: light and dark halves of each fold.
    const gl = ctx.createLinearGradient(0, Y(0), 0, Y(tSplit));
    gl.addColorStop(0, colL(hueJ + 6, s.light * 0.75 * lJ));
    gl.addColorStop(1, colL(hueJ, s.light * 1.12 * lJ));
    ctx.fillStyle = gl;
    ctx.fillRect(X(s0), Y(tSplit + 0.01), X(sc) - X(s0) + 0.6, Y(0) - Y(tSplit + 0.01));
    const gd = ctx.createLinearGradient(0, Y(0), 0, Y(tSplit));
    gd.addColorStop(0, colL(hueJ + 6, s.light * 0.55 * lJ));
    gd.addColorStop(1, colL(hueJ, s.light * 0.8 * lJ));
    ctx.fillStyle = gd;
    ctx.fillRect(X(sc), Y(tSplit + 0.01), X(s1) - X(sc) + 0.6, Y(0) - Y(tSplit + 0.01));
    // Free segment: narrowing strip ending in a split tip.
    const hw = segW * 0.42;
    const tipT = tEnd;
    const notch = tEnd - rng.range(0.05, 0.1);
    ctx.beginPath();
    ctx.moveTo(X(sc - hw), Y(tSplit));
    ctx.lineTo(X(sc - hw * 0.8), Y(tSplit + (tipT - tSplit) * 0.6));
    ctx.lineTo(X(sc - hw * 0.35), Y(tipT - 0.005));
    ctx.lineTo(X(sc - 0.1 * hw), Y(notch + 0.02));
    ctx.lineTo(X(sc), Y(notch));
    ctx.lineTo(X(sc + 0.1 * hw), Y(notch + 0.02));
    ctx.lineTo(X(sc + hw * 0.35), Y(tipT - 0.02));
    ctx.lineTo(X(sc + hw * 0.8), Y(tSplit + (tipT - tSplit) * 0.55));
    ctx.lineTo(X(sc + hw), Y(tSplit));
    ctx.closePath();
    const gs = ctx.createLinearGradient(X(sc - hw), 0, X(sc + hw), 0);
    const brown = s.dead || rng.chance(0.12);
    gs.addColorStop(0, colL(hueJ, s.light * 1.12 * lJ));
    gs.addColorStop(0.5, colL(hueJ, s.light * 0.95 * lJ));
    gs.addColorStop(1, colL(hueJ, s.light * 0.72 * lJ));
    ctx.fillStyle = gs;
    ctx.fill();
    if (brown && !s.dead) {
      ctx.fillStyle = hsl(36, 0.35, 0.4, 0.85);
      ctx.fillRect(X(sc - hw), Y(tipT), X(sc + hw) - X(sc - hw), Y(tipT - 0.07) - Y(tipT));
    }
    // Fold line.
    ctx.strokeStyle = colL(hueJ, s.light * 0.45, 0.6);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(X(sc), Y(0.02));
    ctx.lineTo(X(sc), Y(notch));
    ctx.stroke();
    // Thread-like filaments between segments.
    if (rng.chance(0.45)) {
      ctx.strokeStyle = s.dead ? hsl(35, 0.2, 0.55, 0.9) : hsl(50, 0.25, 0.62, 0.9);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      const fx = X(s1);
      ctx.moveTo(fx, Y(tSplit));
      ctx.quadraticCurveTo(fx + rng.range(-4, 4), Y((tSplit + tEnd) / 2), fx + rng.range(-8, 8), Y(Math.min(0.995, tEnd + rng.range(-0.05, 0.04))));
      ctx.stroke();
    }
  }
  // Costa (midrib) running into the blade.
  const cg = ctx.createLinearGradient(0, Y(0), 0, Y(0.5));
  cg.addColorStop(0, s.dead ? hsl(35, 0.25, 0.5) : hsl(60, 0.35, 0.55));
  cg.addColorStop(1, s.dead ? hsl(35, 0.25, 0.45, 0) : hsl(70, 0.35, 0.45, 0));
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.moveTo(X(0.5) - 6, Y(0));
  ctx.lineTo(X(0.5) - 1.5, Y(0.5));
  ctx.lineTo(X(0.5) + 1.5, Y(0.5));
  ctx.lineTo(X(0.5) + 6, Y(0));
  ctx.fill();
}

function paintBoot(ctx: Ctx, r: PixelRect, rng: Rng): void {
  // A split leaf base: two fibrous prongs diverging upward from the trunk.
  const X = (u: number) => r.x + u * r.w;
  const Y = (t: number) => r.y + (1 - t) * r.h;
  for (const side of [-1, 1]) {
    const g = ctx.createLinearGradient(0, Y(0), 0, Y(1));
    g.addColorStop(0, hsl(30, 0.16, 0.2));
    g.addColorStop(0.6, hsl(32, 0.18, 0.28));
    g.addColorStop(1, hsl(34, 0.2, 0.34));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(X(0.5 + side * 0.05), Y(0));
    ctx.lineTo(X(0.5 + side * 0.42), Y(0.05));
    ctx.lineTo(X(0.5 + side * 0.46), Y(0.7));
    ctx.lineTo(X(0.5 + side * 0.3), Y(0.98));
    ctx.lineTo(X(0.5 + side * 0.1), Y(0.62));
    ctx.closePath();
    ctx.fill();
    // Fibres.
    ctx.strokeStyle = hsl(30, 0.15, 0.25, 0.7);
    ctx.lineWidth = 1;
    for (let i = 0; i < 16; i++) {
      const u = 0.5 + side * rng.range(0.08, 0.42);
      ctx.beginPath();
      ctx.moveTo(X(u), Y(rng.range(0, 0.2)));
      ctx.lineTo(X(u + side * rng.range(-0.03, 0.05)), Y(rng.range(0.5, 0.95)));
      ctx.stroke();
    }
  }
}

export function paintPalmLeafAtlas(): THREE.Texture {
  const c = createCanvas(PALM_LEAF_SIZE.w, PALM_LEAF_SIZE.h);
  const rng = new Rng('palm-leaf-atlas');
  const royalLen = (t: number) => 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, (t - 0.05) / 0.98));
  const royal: PinnateStyle = {
    perSide: 62, tStart: 0.06, tEnd: 0.985,
    len: royalLen,
    fwd: (t) => 0.05 + 0.05 * t,
    width: 7.5, hue: 96, sat: 0.48, lightBase: 0.2, lightTip: 0.33,
    brownTips: 0.04, missing: 0.03,
    rachisW: [9, 2], rachisColor: [hsl(75, 0.4, 0.52), hsl(85, 0.4, 0.3)],
  };
  paintPinnate(c.ctx, PALM_LEAF.royalA.px, rng.fork('ra'), royal);
  paintPinnate(c.ctx, PALM_LEAF.royalB.px, rng.fork('rb'), { ...royal, perSide: 58, hue: 92, lightBase: 0.18, lightTip: 0.3 });
  const coco: PinnateStyle = {
    perSide: 52, tStart: 0.1, tEnd: 0.985,
    len: (t) => 0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, (t - 0.08) / 0.96)),
    fwd: (t) => 0.075 + 0.06 * t,
    width: 10.5, hue: 78, sat: 0.5, lightBase: 0.25, lightTip: 0.42,
    brownTips: 0.08, missing: 0.05,
    rachisW: [11, 2.5], rachisColor: [hsl(58, 0.45, 0.6), hsl(70, 0.4, 0.36)],
  };
  paintPinnate(c.ctx, PALM_LEAF.coconutA.px, rng.fork('ca'), coco);
  paintPinnate(c.ctx, PALM_LEAF.coconutB.px, rng.fork('cb'), { ...coco, perSide: 48, hue: 74, lightTip: 0.45, brownTips: 0.12 });
  paintPinnate(c.ctx, PALM_LEAF.dead.px, rng.fork('d'), {
    ...coco, perSide: 40, hue: 36, sat: 0.3, lightBase: 0.32, lightTip: 0.5, width: 8, missing: 0.2, brownTips: 0,
    len: (t) => (0.4 + 0.5 * Math.sin(Math.PI * Math.min(1, t))) * 0.9,
    fwd: (t) => 0.12 + 0.08 * t,
    rachisColor: [hsl(35, 0.3, 0.55), hsl(30, 0.25, 0.35)],
  });
  paintFan(c.ctx, PALM_LEAF.sabalFan.px, rng.fork('sf'), { segs: 44, split: 0.55, hue: 88, sat: 0.3, light: 0.3, dead: false });
  paintFan(c.ctx, PALM_LEAF.sabalFanDead.px, rng.fork('sd'), { segs: 40, split: 0.45, hue: 34, sat: 0.24, light: 0.3, dead: true });
  paintBoot(c.ctx, PALM_LEAF.boot.px, rng.fork('boot'));
  return alphaTexture(c, [70, 90, 40]);
}

// ---------------------------------------------------------------------------------------

function wrapLine(ctx: Ctx, r: PixelRect, pts: [number, number][]): void {
  // Draw a polyline three times (x - w, x, x + w) so it wraps around the trunk seamlessly.
  for (const dx of [-r.w, 0, r.w]) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(r.x + x + dx, r.y + y) : ctx.moveTo(r.x + x + dx, r.y + y)));
    ctx.stroke();
  }
}

function clipRect(ctx: Ctx, r: PixelRect, fn: () => void): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  fn();
  ctx.restore();
}

export interface TrunkTextures {
  map: THREE.Texture;
  roughness: THREE.Texture;
}

export function paintPalmTrunkAtlas(): TrunkTextures {
  const c = createCanvas(PALM_TRUNK_SIZE.w, PALM_TRUNK_SIZE.h);
  const rng = new Rng('palm-trunk-atlas');
  const ctx = c.ctx;

  // Royal: smooth pale grey, faint leaf-scar rings, a few vertical hairline cracks, lichen.
  {
    const r = PALM_TRUNK.royal.px;
    const n = new TileFbm(4, 8, 5, rng.fork('royal'));
    const f = new TileNoise(64, 256, rng.fork('royal-f'));
    fillPixels(c, r.x, r.y, r.w, r.h, (x, y) => {
      const u = x / r.w, v = y / r.h;
      const k = 0.9 + 0.2 * (n.sample(u, v) - 0.5) + 0.06 * (f.sample(u, v) - 0.5);
      return [clampByte(150 * k), clampByte(146 * k), clampByte(136 * k)];
    });
    clipRect(ctx, r, () => {
      let y = 4;
      while (y < r.h) {
        ctx.strokeStyle = `rgba(90, 86, 78, ${rng.range(0.12, 0.3).toFixed(2)})`;
        ctx.lineWidth = rng.range(1, 2.2);
        const pts: [number, number][] = [];
        const ph = rng.range(0, 6.28);
        for (let x = 0; x <= r.w; x += 8) pts.push([x, y + 1.5 * Math.sin((x / r.w) * Math.PI * 2 * 2 + ph)]);
        wrapLine(ctx, r, pts);
        y += rng.range(22, 44);
      }
      ctx.strokeStyle = 'rgba(80, 76, 70, 0.25)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 30; i++) {
        const x = rng.range(0, r.w), y0 = rng.range(0, r.h), l = rng.range(10, 60);
        wrapLine(ctx, r, [[x, y0], [x + rng.range(-2, 2), y0 + l]]);
      }
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = rng.chance(0.5) ? 'rgba(200, 205, 170, 0.18)' : 'rgba(120, 118, 100, 0.12)';
        ctx.beginPath();
        ctx.ellipse(r.x + rng.range(0, r.w), r.y + rng.range(0, r.h), rng.range(6, 20), rng.range(4, 14), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // Crownshaft: glossy bright green, fine vertical striations, overlapping sheath edges.
  {
    const r = PALM_TRUNK.crownshaft.px;
    const n = new TileFbm(4, 4, 4, rng.fork('cs'));
    const st = new TileNoise(96, 4, rng.fork('cs-s'));
    fillPixels(c, r.x, r.y, r.w, r.h, (x, y) => {
      const u = x / r.w, v = y / r.h;
      const k = 0.92 + 0.16 * (n.sample(u, v) - 0.5) + 0.1 * (st.sample(u, v) - 0.5);
      return [clampByte(104 * k), clampByte(150 * k), clampByte(58 * k)];
    });
    clipRect(ctx, r, () => {
      for (let i = 0; i < 3; i++) {
        const y = rng.range(0, r.h);
        const g = ctx.createLinearGradient(0, r.y + y - 10, 0, r.y + y + 6);
        g.addColorStop(0, 'rgba(60, 90, 30, 0)');
        g.addColorStop(0.7, 'rgba(60, 90, 30, 0.35)');
        g.addColorStop(1, 'rgba(170, 200, 110, 0.35)');
        ctx.fillStyle = g;
        ctx.fillRect(r.x, r.y + y - 10, r.w, 16);
      }
    });
  }
  // Coconut: grey-brown with pronounced irregular ring scars and fissures.
  {
    const r = PALM_TRUNK.coconut.px;
    const n = new TileFbm(4, 6, 5, rng.fork('coco'));
    const f = new TileNoise(128, 16, rng.fork('coco-f'));
    fillPixels(c, r.x, r.y, r.w, r.h, (x, y) => {
      const u = x / r.w, v = y / r.h;
      const k = 0.88 + 0.26 * (n.sample(u, v) - 0.5) + 0.12 * (f.sample(u, v) - 0.5);
      return [clampByte(142 * k), clampByte(130 * k), clampByte(114 * k)];
    });
    clipRect(ctx, r, () => {
      let y = 3;
      while (y < r.h - 6) {
        const ph = rng.range(0, 6.28);
        const amp = rng.range(1, 3);
        const pts: [number, number][] = [];
        for (let x = 0; x <= r.w; x += 8) pts.push([x, y + amp * Math.sin((x / r.w) * Math.PI * 2 + ph)]);
        ctx.strokeStyle = 'rgba(62, 54, 44, 0.75)';
        ctx.lineWidth = rng.range(2, 3.5);
        wrapLine(ctx, r, pts);
        ctx.strokeStyle = 'rgba(190, 178, 158, 0.45)';
        ctx.lineWidth = 1.5;
        wrapLine(ctx, r, pts.map(([x, yy]) => [x, yy - 3]));
        y += rng.range(18, 34);
      }
      ctx.strokeStyle = 'rgba(70, 62, 52, 0.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 60; i++) {
        const x = rng.range(0, r.w), y0 = rng.range(0, r.h);
        wrapLine(ctx, r, [[x, y0], [x + rng.range(-1, 1), y0 + rng.range(6, 18)]]);
      }
    });
  }
  // Sabal lower trunk: rough fibrous grey-brown.
  {
    const r = PALM_TRUNK.sabal.px;
    const n = new TileFbm(3, 6, 5, rng.fork('sab'));
    const fib = new TileNoise(64, 12, rng.fork('sab-f'));
    fillPixels(c, r.x, r.y, r.w, r.h, (x, y) => {
      const u = x / r.w, v = y / r.h;
      const k = 0.85 + 0.3 * (n.sample(u, v) - 0.5) + 0.22 * (fib.sample(u, v) - 0.5);
      return [clampByte(112 * k), clampByte(102 * k), clampByte(90 * k)];
    });
  }
  // Sabal boots: criss-cross split leaf bases over deep shadow.
  {
    const r = PALM_TRUNK.sabalBoots.px;
    ctx.fillStyle = '#231d17';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    clipRect(ctx, r, () => {
      const cols = 5, rows = 5;
      const cw = r.w / cols, rh = r.h / rows;
      for (let j = -1; j <= rows; j++) {
        for (let i = -1; i <= cols; i++) {
          const cx = r.x + (i + 0.5 + (j % 2 ? 0.5 : 0)) * cw;
          const cy = r.y + (j + 0.5) * rh;
          for (const dx of [-r.w, 0, r.w]) {
            const x = cx + dx;
            const g = ctx.createLinearGradient(0, cy + rh * 0.6, 0, cy - rh * 0.7);
            const l = rng.range(0.34, 0.46);
            g.addColorStop(0, hsl(32, 0.16, l * 0.7));
            g.addColorStop(1, hsl(34, 0.2, l));
            ctx.fillStyle = g;
            // U-shaped boot with a V notch at the top (upward on the trunk = smaller canvas y).
            ctx.beginPath();
            ctx.moveTo(x - cw * 0.5, cy - rh * 0.55);
            ctx.lineTo(x - cw * 0.1, cy - rh * 0.15);
            ctx.lineTo(x, cy - rh * 0.25);
            ctx.lineTo(x + cw * 0.1, cy - rh * 0.15);
            ctx.lineTo(x + cw * 0.5, cy - rh * 0.55);
            ctx.lineTo(x + cw * 0.42, cy + rh * 0.45);
            ctx.quadraticCurveTo(x, cy + rh * 0.75, x - cw * 0.42, cy + rh * 0.45);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = 'rgba(30, 24, 18, 0.5)';
            ctx.lineWidth = 1;
            for (let k = 0; k < 4; k++) {
              const fx = x + rng.range(-0.35, 0.35) * cw;
              ctx.beginPath();
              ctx.moveTo(fx, cy + rh * 0.4);
              ctx.lineTo(fx + rng.range(-2, 2), cy - rh * 0.4);
              ctx.stroke();
            }
          }
        }
      }
    });
  }
  const map = opaqueTexture(c, { color: true, wrapT: true });

  // Roughness (green channel): glossy crownshaft, rough trunks.
  const rc = createCanvas(PALM_TRUNK_SIZE.w, PALM_TRUNK_SIZE.h);
  const rough: [PixelRect, number][] = [
    [PALM_TRUNK.royal.px, 0.78],
    [PALM_TRUNK.crownshaft.px, 0.38],
    [PALM_TRUNK.coconut.px, 0.9],
    [PALM_TRUNK.sabal.px, 0.95],
    [PALM_TRUNK.sabalBoots.px, 0.95],
  ];
  for (const [r, v] of rough) {
    const g = Math.round(v * 255);
    rc.ctx.fillStyle = `rgb(${g}, ${g}, ${g})`;
    rc.ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  const roughness = opaqueTexture(rc, { color: false, wrapT: true });
  return { map, roughness };
}

export type { Canvas };
