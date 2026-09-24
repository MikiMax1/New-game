// GTA-style radar in the corner (rotates with the camera heading) and a full-screen map
// on M. The 2D map is rendered once into an offscreen canvas at 0.5 px/m; each frame
// only blits a rotated window of it.
import type { FlyCamera } from '../core/flyCamera';
import type { Input } from '../core/input';
import { MAP_HALF, MAP_SIZE } from '../world/config';
import type { WorldData } from '../world/gen/world';
import { MapRenderer } from '../world/map2d/renderMap';

const PX_PER_M = 0.5;

export class Minimap {
  private readonly source: HTMLCanvasElement;
  private readonly radar: HTMLCanvasElement;
  private readonly full: HTMLCanvasElement;
  private fullOpen = false;
  /** Metres shown from the centre to the edge of the radar. */
  range = 220;

  constructor(world: WorldData, private readonly fly: FlyCamera, private readonly input: Input) {
    // Pre-render the city map without labels (labels don't rotate well).
    this.source = document.createElement('canvas');
    this.source.width = this.source.height = Math.round(MAP_SIZE * PX_PER_M);
    const ctx = this.source.getContext('2d')!;
    const r = new MapRenderer(world);
    r.layers = { lots: false, labels: false, debug: false };
    r.render(ctx, { cx: 0, cz: 0, scale: PX_PER_M }, this.source.width, this.source.height);

    this.radar = document.createElement('canvas');
    this.radar.className = 'radar';
    this.full = document.createElement('canvas');
    this.full.className = 'fullmap';
    this.full.hidden = true;
    document.body.append(this.radar, this.full);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(Math.min(220, window.innerWidth * 0.34));
    this.radar.style.width = this.radar.style.height = `${size}px`;
    this.radar.width = this.radar.height = Math.round(size * dpr);
    this.full.width = Math.round(window.innerWidth * dpr);
    this.full.height = Math.round(window.innerHeight * dpr);
  }

  update(): void {
    if (this.input.wasPressed('KeyM')) {
      this.fullOpen = !this.fullOpen;
      this.full.hidden = !this.fullOpen;
      if (this.fullOpen) this.input.releasePointer();
    }
    const p = this.fly.camera.position;
    this.drawRadar(p.x, p.z, this.fly.yaw);
    if (this.fullOpen) this.drawFull(p.x, p.z, this.fly.yaw);
  }

  private drawRadar(x: number, z: number, yaw: number): void {
    const c = this.radar.getContext('2d')!;
    const w = this.radar.width;
    const scale = w / 2 / this.range / PX_PER_M; // screen px per source px
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, w);
    c.save();
    c.beginPath();
    c.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#5f8fae';
    c.fillRect(0, 0, w, w);
    // Rotate so the camera's forward direction points up.
    c.translate(w / 2, w / 2);
    c.rotate(yaw);
    c.scale(scale, scale);
    const sx = (x + MAP_HALF) * PX_PER_M;
    const sz = (z + MAP_HALF) * PX_PER_M;
    c.drawImage(this.source, -sx, -sz);
    c.restore();
    // Player arrow (always pointing up) and a frame.
    c.fillStyle = '#ffffff';
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = w * 0.008;
    c.beginPath();
    c.moveTo(w / 2, w / 2 - w * 0.045);
    c.lineTo(w / 2 + w * 0.03, w / 2 + w * 0.035);
    c.lineTo(w / 2, w / 2 + w * 0.018);
    c.lineTo(w / 2 - w * 0.03, w / 2 + w * 0.035);
    c.closePath();
    c.fill();
    c.stroke();
    c.beginPath();
    c.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2);
    c.lineWidth = w * 0.02;
    c.strokeStyle = 'rgba(20,20,24,0.85)';
    c.stroke();
    // North marker on the rim.
    const nx = w / 2 + Math.sin(-yaw) * 0 - Math.sin(yaw) * (w / 2 - w * 0.06) * 0;
    void nx;
    const ang = -Math.PI / 2 + yaw;
    const rx = w / 2 + Math.cos(ang) * (w / 2 - w * 0.07);
    const ry = w / 2 + Math.sin(ang) * (w / 2 - w * 0.07);
    c.fillStyle = 'rgba(20,20,24,0.85)';
    c.beginPath();
    c.arc(rx, ry, w * 0.055, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#fff';
    c.font = `700 ${Math.round(w * 0.07)}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', rx, ry + 1);
  }

  private drawFull(x: number, z: number, yaw: number): void {
    const c = this.full.getContext('2d')!;
    const w = this.full.width;
    const h = this.full.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = 'rgba(10,12,16,0.92)';
    c.fillRect(0, 0, w, h);
    const size = Math.min(w, h) * 0.92;
    const ox = (w - size) / 2;
    const oy = (h - size) / 2;
    c.drawImage(this.source, ox, oy, size, size);
    const px = ox + ((x + MAP_HALF) / MAP_SIZE) * size;
    const py = oy + ((z + MAP_HALF) / MAP_SIZE) * size;
    c.save();
    c.translate(px, py);
    c.rotate(-yaw);
    c.fillStyle = '#ff4f9a';
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -12);
    c.lineTo(8, 9);
    c.lineTo(0, 4);
    c.lineTo(-8, 9);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
    c.fillStyle = '#f2efe8';
    c.font = `600 ${Math.round(Math.max(14, size * 0.022))}px system-ui, sans-serif`;
    c.textAlign = 'left';
    c.fillText('PORT SOLMAR  ·  press M to close', ox + 8, oy + 24);
  }
}
