// Printed faces atlas: traffic signs, street-name blades, signal lens and pedestrian symbols,
// bus-shelter posters (original brands), grilles and labels. Opaque.

import type * as THREE from 'three';
import { SIGN, SIGN_SIZE, STREET_NAMES, type PixelRect } from '../../world/props/atlas';
import { Rng } from '../../world/rng';
import { createCanvas, opaqueTexture, type Ctx } from './paint';

const FONT = '"DejaVu Sans Condensed", "Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif';

function fitText(ctx: Ctx, text: string, x: number, y: number, maxW: number, size: number, weight = 'bold'): void {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > maxW && s > 6) {
    s -= 1;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
  ctx.fillText(text, x, y);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function stop(ctx: Ctx, r: PixelRect): void {
  ctx.fillStyle = '#b8102a';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const oct = (rad: number) => {
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k * Math.PI) / 4;
      const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      if (k) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
  };
  oct((r.w / 2) * 0.93);
  ctx.lineWidth = r.w * 0.035;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, 'STOP', cx, cy + 4, r.w * 0.8, Math.round(r.h * 0.33));
}

function streetBlade(ctx: Ctx, r: PixelRect, name: string, rng: Rng): void {
  ctx.fillStyle = '#0b6b3a';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = '#f4f4ee';
  ctx.lineWidth = 4;
  roundRect(ctx, r.x + 6, r.y + 6, r.w - 12, r.h - 12, 8);
  ctx.stroke();
  ctx.fillStyle = '#f7f7f2';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  fitText(ctx, name, r.x + r.w * 0.47, r.y + r.h / 2 + 3, r.w * 0.72, 58);
  ctx.textAlign = 'right';
  ctx.font = `bold 20px ${FONT}`;
  ctx.fillText(String(100 * rng.int(1, 45)), r.x + r.w - 18, r.y + r.h / 2 + 2);
}

function lens(ctx: Ctx, r: PixelRect): void {
  ctx.fillStyle = '#050505';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = r.w * 0.48;
  const g = ctx.createRadialGradient(cx - rad * 0.2, cy - rad * 0.25, rad * 0.05, cx, cy, rad);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.55, '#d8d8d8');
  g.addColorStop(1, '#6a6a6a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  for (let k = 1; k < 6; k++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (rad * k) / 6, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function pedHand(ctx: Ctx, r: PixelRect): void {
  ctx.fillStyle = '#060606';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  const s = r.w / 64;
  ctx.fillStyle = '#ff8a2a';
  const x = r.x, y = r.y;
  // Palm + four fingers + thumb.
  roundRect(ctx, x + 20 * s, y + 28 * s, 24 * s, 24 * s, 6 * s);
  ctx.fill();
  for (let k = 0; k < 4; k++) {
    roundRect(ctx, x + (20 + k * 6.2) * s, y + (10 + (k === 0 || k === 3 ? 4 : 0)) * s, 5 * s, 24 * s, 2.5 * s);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(x + 18 * s, y + 38 * s);
  ctx.rotate(-0.6);
  roundRect(ctx, -3 * s, -12 * s, 6 * s, 16 * s, 3 * s);
  ctx.fill();
  ctx.restore();
}

function pedWalk(ctx: Ctx, r: PixelRect): void {
  ctx.fillStyle = '#060606';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  const s = r.w / 64;
  const x = r.x, y = r.y;
  ctx.strokeStyle = '#f2f6ff';
  ctx.fillStyle = '#f2f6ff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 5 * s;
  ctx.beginPath();
  ctx.arc(x + 33 * s, y + 11 * s, 5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + 32 * s, y + 20 * s);
  ctx.lineTo(x + 30 * s, y + 38 * s);
  ctx.moveTo(x + 30 * s, y + 38 * s);
  ctx.lineTo(x + 22 * s, y + 55 * s);
  ctx.moveTo(x + 30 * s, y + 38 * s);
  ctx.lineTo(x + 40 * s, y + 54 * s);
  ctx.moveTo(x + 32 * s, y + 22 * s);
  ctx.lineTo(x + 22 * s, y + 32 * s);
  ctx.moveTo(x + 32 * s, y + 22 * s);
  ctx.lineTo(x + 42 * s, y + 31 * s);
  ctx.stroke();
}

function poster(ctx: Ctx, r: PixelRect, kind: 'sun' | 'radio', rng: Rng): void {
  const { x, y, w, h } = r;
  if (kind === 'sun') {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#ff5e8a');
    g.addColorStop(0.55, '#ffb05c');
    g.addColorStop(1, '#2ab7c9');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#fff3c0';
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h * 0.55, w * 0.26, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let k = 0; k < 5; k++) ctx.fillRect(x, y + h * (0.58 + k * 0.035), w, 3);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    fitText(ctx, 'SOLMAR SUN', x + w / 2, y + h * 0.2, w * 0.86, 40);
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillText('SPF 50', x + w / 2, y + h * 0.3);
    ctx.fillStyle = '#133b4a';
    ctx.font = `bold 18px ${FONT}`;
    ctx.fillText('stay golden, Port Solmar', x + w / 2, y + h * 0.9);
  } else {
    ctx.fillStyle = '#0e2a3a';
    ctx.fillRect(x, y, w, h);
    const g = ctx.createRadialGradient(x + w * 0.5, y + h * 0.35, 10, x + w * 0.5, y + h * 0.35, w);
    g.addColorStop(0, '#2de2c8');
    g.addColorStop(1, 'rgba(14,42,58,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    // Palm silhouettes.
    ctx.strokeStyle = '#08151d';
    ctx.fillStyle = '#08151d';
    for (let k = 0; k < 3; k++) {
      const px = x + w * (0.2 + k * 0.3), base = y + h * 0.8, top = y + h * (0.32 + rng.range(0, 0.1));
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(px, base);
      ctx.quadraticCurveTo(px + 10, (base + top) / 2, px + 4, top);
      ctx.stroke();
      for (let f = 0; f < 7; f++) {
        const a = -Math.PI + (f / 6) * Math.PI;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px + 4, top);
        ctx.quadraticCurveTo(px + 4 + Math.cos(a) * 30, top + Math.sin(a) * 22, px + 4 + Math.cos(a) * 48, top + Math.sin(a) * 10 + 20);
        ctx.stroke();
      }
    }
    ctx.fillRect(x, y + h * 0.8, w, h * 0.2);
    ctx.fillStyle = '#ff4fa3';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    fitText(ctx, 'SOLMAR FM', x + w / 2, y + h * 0.16, w * 0.86, 42);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 34px ${FONT}`;
    ctx.fillText('97.3', x + w / 2, y + h * 0.93);
  }
}

function fanGrille(ctx: Ctx, r: PixelRect): void {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = r.w * 0.48;
  ctx.fillStyle = '#6e7174';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = '#0f1012';
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3a3c3f';
  ctx.lineWidth = 1.5;
  for (let k = 1; k <= 9; k++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (rad * k) / 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Fan blades in shadow below the grille.
  ctx.fillStyle = 'rgba(70, 72, 76, 0.7)';
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((k * Math.PI) / 2 + 0.3);
    ctx.beginPath();
    ctx.ellipse(rad * 0.45, 0, rad * 0.42, rad * 0.16, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#55585c';
  ctx.beginPath();
  ctx.arc(cx, cy, rad * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

function louver(ctx: Ctx, r: PixelRect): void {
  for (let k = 0; k < 16; k++) {
    const y = r.y + (k * r.h) / 16;
    const g = ctx.createLinearGradient(0, y, 0, y + r.h / 16);
    g.addColorStop(0, '#d8d9d6');
    g.addColorStop(0.6, '#b9bab7');
    g.addColorStop(1, '#5d5f60');
    ctx.fillStyle = g;
    ctx.fillRect(r.x, y, r.w, r.h / 16 + 0.5);
  }
}

function coilGuard(ctx: Ctx, r: PixelRect): void {
  ctx.fillStyle = '#4a4d50';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = '#8c9094';
  ctx.lineWidth = 1;
  for (let k = 0; k <= r.w; k += 3) {
    ctx.beginPath();
    ctx.moveTo(r.x + k, r.y);
    ctx.lineTo(r.x + k, r.y + r.h);
    ctx.stroke();
  }
  ctx.strokeStyle = '#1c1d1f';
  ctx.lineWidth = 2;
  for (let k = 0; k <= r.h; k += 12) {
    ctx.beginPath();
    ctx.moveTo(r.x, r.y + k);
    ctx.lineTo(r.x + r.w, r.y + k);
    ctx.stroke();
  }
}

function label(ctx: Ctx, r: PixelRect, bg: string, fg: string, text: string, size = 36): void {
  ctx.fillStyle = bg;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, text, r.x + r.w / 2, r.y + r.h / 2 + 2, r.w * 0.9, size);
}

export function paintSignAtlas(): THREE.Texture {
  const c = createCanvas(SIGN_SIZE.w, SIGN_SIZE.h);
  const ctx = c.ctx;
  const rng = new Rng('sign-atlas');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, c.w, c.h);
  stop(ctx, SIGN.stop.px);
  label(ctx, SIGN.allWay.px, '#b8102a', '#ffffff', 'ALL WAY', 52);
  {
    const r = SIGN.busStop.px;
    ctx.fillStyle = '#f4f4f0';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#0d4d9c';
    ctx.fillRect(r.x, r.y, r.w, r.h * 0.42);
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, r.x + r.w * 0.2, r.y + r.h * 0.08, r.w * 0.6, r.h * 0.26, 6);
    ctx.fill();
    ctx.fillStyle = '#0d4d9c';
    ctx.fillRect(r.x + r.w * 0.27, r.y + r.h * 0.12, r.w * 0.46, r.h * 0.09);
    ctx.fillStyle = '#0d4d9c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'BUS', r.x + r.w / 2, r.y + r.h * 0.58, r.w * 0.8, 34);
    fitText(ctx, 'STOP', r.x + r.w / 2, r.y + r.h * 0.8, r.w * 0.8, 34);
  }
  pedHand(ctx, SIGN.pedHand.px);
  pedWalk(ctx, SIGN.pedWalk.px);
  lens(ctx, SIGN.lens.px);
  {
    const r = SIGN.pushButton.px;
    ctx.fillStyle = '#f1c21b';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(r.x + r.w / 2, r.y + r.h * 0.6, r.w * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r.x + r.w * 0.2, r.y + r.h * 0.22);
    ctx.lineTo(r.x + r.w * 0.8, r.y + r.h * 0.22);
    ctx.lineTo(r.x + r.w * 0.65, r.y + r.h * 0.1);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#111';
    ctx.stroke();
  }
  STREET_NAMES.forEach((name, i) => streetBlade(ctx, SIGN.streetNames[i].px, name, rng));
  poster(ctx, SIGN.adA.px, 'sun', rng);
  poster(ctx, SIGN.adB.px, 'radio', rng);
  fanGrille(ctx, SIGN.fanGrille.px);
  louver(ctx, SIGN.louver.px);
  coilGuard(ctx, SIGN.coilGuard.px);
  {
    const r = SIGN.meterFace.px;
    ctx.fillStyle = '#2d3033';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#9fb59a';
    ctx.fillRect(r.x + r.w * 0.18, r.y + r.h * 0.2, r.w * 0.64, r.h * 0.28);
    ctx.fillStyle = '#1b2a1b';
    ctx.font = `bold 20px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('0:00', r.x + r.w / 2, r.y + r.h * 0.34);
    ctx.fillStyle = '#111';
    ctx.fillRect(r.x + r.w * 0.44, r.y + r.h * 0.6, r.w * 0.12, r.h * 0.2);
    ctx.fillStyle = '#e8e8e8';
    ctx.font = `bold 12px ${FONT}`;
    ctx.fillText('PAY HERE', r.x + r.w / 2, r.y + r.h * 0.9);
  }
  label(ctx, SIGN.newspaper[0].px, '#1d4f91', '#ffffff', 'THE SOLMAR HERALD', 40);
  label(ctx, SIGN.newspaper[1].px, '#c8202f', '#ffffff', 'EL NUEVO SOLANO', 40);
  label(ctx, SIGN.newspaper[2].px, '#f3c623', '#1a1a1a', 'BEACH WEEKLY', 40);
  label(ctx, SIGN.lifeguard.px, '#f6f2e8', '#d23c5a', 'LIFEGUARD', 44);
  label(ctx, SIGN.trashLabel.px, '#1f4a33', '#f0f0e6', 'PORT SOLMAR', 34);
  {
    const r = SIGN.payStation.px;
    ctx.fillStyle = '#2b2f33';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#1f6fb2';
    ctx.fillRect(r.x, r.y, r.w, r.h * 0.12);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'PAY BY PLATE', r.x + r.w / 2, r.y + r.h * 0.06, r.w * 0.9, 16);
    ctx.fillStyle = '#7fa3b8';
    ctx.fillRect(r.x + r.w * 0.15, r.y + r.h * 0.18, r.w * 0.7, r.h * 0.2);
    ctx.fillStyle = '#c9ccd0';
    for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) ctx.fillRect(r.x + r.w * (0.22 + i * 0.2), r.y + r.h * (0.45 + j * 0.07), r.w * 0.14, r.h * 0.05);
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(r.x + r.w * 0.3, r.y + r.h * 0.78, r.w * 0.4, r.h * 0.03);
  }
  {
    const r = SIGN.stripes.px;
    for (let k = 0; k < 8; k++) {
      ctx.fillStyle = k % 2 ? '#ffffff' : '#e8505b';
      ctx.fillRect(r.x + (k * r.w) / 8, r.y, r.w / 8 + 0.5, r.h);
    }
  }
  {
    const r = SIGN.hazard.px;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.fillStyle = '#f2c417';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#151515';
    for (let k = -4; k < 8; k++) {
      ctx.beginPath();
      ctx.moveTo(r.x + k * 32, r.y);
      ctx.lineTo(r.x + k * 32 + 16, r.y);
      ctx.lineTo(r.x + k * 32 + 16 + r.h, r.y + r.h);
      ctx.lineTo(r.x + k * 32 + r.h, r.y + r.h);
      ctx.fill();
    }
    ctx.restore();
  }
  {
    const r = SIGN.bigBelly.px;
    ctx.fillStyle = '#2f5a3d';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#1b1d1e';
    roundRect(ctx, r.x + r.w * 0.15, r.y + r.h * 0.12, r.w * 0.7, r.h * 0.2, 6);
    ctx.fill();
    ctx.fillStyle = '#9aa0a4';
    ctx.fillRect(r.x + r.w * 0.3, r.y + r.h * 0.34, r.w * 0.4, r.h * 0.03);
    ctx.fillStyle = '#f0f0e6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'TRASH', r.x + r.w / 2, r.y + r.h * 0.5, r.w * 0.8, 26);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 6, r.y + r.h * 0.42, r.w - 12, r.h * 0.52);
  }
  {
    const r = SIGN.transformer.px;
    ctx.fillStyle = '#8d9396';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#f2c417';
    ctx.fillRect(r.x + r.w * 0.3, r.y + r.h * 0.3, r.w * 0.4, r.h * 0.25);
    ctx.fillStyle = '#111';
    ctx.font = `bold 14px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('T-' + rng.int(100, 999), r.x + r.w / 2, r.y + r.h * 0.46);
  }
  label(ctx, SIGN.crosswalkPlaque.px, '#ffffff', '#111111', 'PUSH BUTTON FOR WALK', 26);
  {
    const r = SIGN.oneWay.px;
    ctx.fillStyle = '#111';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(r.x + 16, r.y + r.h * 0.3);
    ctx.lineTo(r.x + r.w * 0.78, r.y + r.h * 0.3);
    ctx.lineTo(r.x + r.w * 0.78, r.y + r.h * 0.12);
    ctx.lineTo(r.x + r.w - 12, r.y + r.h * 0.5);
    ctx.lineTo(r.x + r.w * 0.78, r.y + r.h * 0.88);
    ctx.lineTo(r.x + r.w * 0.78, r.y + r.h * 0.7);
    ctx.lineTo(r.x + 16, r.y + r.h * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'ONE WAY', r.x + r.w * 0.45, r.y + r.h * 0.52, r.w * 0.55, 30);
  }
  return opaqueTexture(c, { color: true });
}
