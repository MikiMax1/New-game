// 2D map of Port Solmar drawn with Canvas 2D: water depth, land cover, blocks, lots,
// roads by class, highways, landmarks and labels. Used by map.html and later the in-game map.
import { DISTRICTS } from '../authored/districts';
import { DISTRICT_LABELS, LANDMARKS } from '../authored/layout';
import type { Block } from '../gen/blocks';
import type { WorldData } from '../gen/world';
import type { PolygonWithHoles, Ring } from '../types';

export interface MapView {
  /** World point at the canvas centre. */
  cx: number;
  cz: number;
  /** Pixels per metre. */
  scale: number;
}

export interface MapLayers {
  lots: boolean;
  labels: boolean;
  debug: boolean;
}

const ROAD_STYLE = {
  arterial: { fill: '#f6c667', casing: '#b8862f' },
  avenue: { fill: '#fbe7b0', casing: '#b9a476' },
  street: { fill: '#ffffff', casing: '#b7b0a6' },
  alley: { fill: '#f1eee9', casing: '#c4bdb3' },
  ramp: { fill: '#f6c667', casing: '#b8862f' },
  highway: { fill: '#f08a4b', casing: '#8f4a1f' },
} as const;

const BLOCK_FILL: Record<string, string> = {
  park: '#a9d18e',
  golf: '#b7dc97',
  plaza: '#dedbd5',
  beach: '#f1e2b8',
  wild: '#b4c59a',
  stadium: '#cbb9a6',
  arena: '#cbb9a6',
  mall: '#d7cbbd',
  hospital: '#e2c9c9',
  marina: '#d6d2cb',
};

const LOT_FILL: Record<string, string> = {
  residential: '#e8dccb',
  commercial: '#efc9b0',
  office: '#c9cfd8',
  hotel: '#f1c7d3',
  industrial: '#cfc6ba',
  civic: '#d9c2e0',
  park: '#b9d9a1',
  parking: '#d4d2cf',
  vacant: '#e3dfd6',
};

export class MapRenderer {
  private base: HTMLCanvasElement | null = null;
  layers: MapLayers = { lots: true, labels: true, debug: false };

  constructor(private readonly world: WorldData) {}

  /** Water depth and land cover as a bitmap, one pixel per terrain sample. */
  private baseImage(): HTMLCanvasElement {
    if (this.base) return this.base;
    const t = this.world.terrain;
    const c = document.createElement('canvas');
    c.width = t.n;
    c.height = t.n;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(t.n, t.n);
    for (let k = 0; k < t.n * t.n; k++) {
      const h = t.height[k];
      let r: number, g: number, b: number;
      if (t.shoreDist[k] < 0) {
        const d = Math.min(1, -h / 14);
        r = 150 - 110 * d;
        g = 212 - 95 * d;
        b = 225 - 55 * d;
      } else {
        const e = Math.min(1, h / 14);
        r = 196 - 30 * e;
        g = 206 - 18 * e;
        b = 170 - 30 * e;
      }
      img.data[k * 4] = r;
      img.data[k * 4 + 1] = g;
      img.data[k * 4 + 2] = b;
      img.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.base = c;
    return c;
  }

  render(ctx: CanvasRenderingContext2D, view: MapView, width: number, height: number): void {
    const w = this.world;
    const s = view.scale;
    const tx = (x: number): number => (x - view.cx) * s + width / 2;
    const tz = (z: number): number => (z - view.cz) * s + height / 2;
    // Visible world bounds (for culling).
    const minX = view.cx - width / 2 / s;
    const maxX = view.cx + width / 2 / s;
    const minZ = view.cz - height / 2 / s;
    const maxZ = view.cz + height / 2 / s;

    ctx.save();
    ctx.fillStyle = '#5f8fae';
    ctx.fillRect(0, 0, width, height);
    // Terrain bitmap: sample k covers world x = origin + i * res.
    const t = w.terrain;
    ctx.imageSmoothingEnabled = s < 2;
    const size = (t.n - 1) * t.res;
    ctx.drawImage(this.baseImage(), tx(t.origin - t.res / 2), tz(t.origin - t.res / 2), (size + t.res) * s, (size + t.res) * s);

    const path = (polys: readonly PolygonWithHoles[]): Path2D => {
      const p = new Path2D();
      for (const poly of polys) for (const ring of [poly.outer, ...poly.holes]) addRing(p, ring, tx, tz);
      return p;
    };

    // Blocks.
    for (const b of w.blocks) {
      if (!visible(b.poly.outer, minX, minZ, maxX, maxZ)) continue;
      ctx.fillStyle = blockFill(b);
      ctx.fill(path([b.poly]), 'evenodd');
      if (b.use === 'urban' && s < 0.9) {
        // Sidewalk tint.
        ctx.fillStyle = 'rgba(0,0,0,0.035)';
        ctx.fill(path([b.poly]), 'evenodd');
      }
    }

    // Lots.
    if (this.layers.lots && s >= 0.35) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(90,80,70,0.35)';
      for (const lot of w.lots) {
        if (!visible(lot.polygon, minX, minZ, maxX, maxZ)) continue;
        const p = new Path2D();
        addRing(p, lot.polygon, tx, tz);
        ctx.fillStyle = LOT_FILL[lot.use] ?? '#e3dfd6';
        ctx.fill(p);
        if (s >= 0.8) ctx.stroke(p);
        if (s >= 1.2 && lot.heightHint > 0) {
          // Building height hint: darker = taller.
          const k = Math.min(1, lot.heightHint / 150);
          ctx.fillStyle = `rgba(40,40,60,${0.08 + 0.35 * k})`;
          ctx.fill(p);
        }
      }
    }

    // Roads: casings first, then fills, by class so arterials sit on top.
    const order = ['alley', 'street', 'avenue', 'arterial'] as const;
    const nodes = w.roads.nodes;
    for (const pass of ['casing', 'fill'] as const) {
      for (const cls of order) {
        const style = ROAD_STYLE[cls];
        ctx.beginPath();
        for (const e of w.roads.edges) {
          if (e.cls !== cls) continue;
          const a = nodes[e.a];
          const b = nodes[e.b];
          if (Math.max(a.x, b.x) < minX - 30 || Math.min(a.x, b.x) > maxX + 30 || Math.max(a.z, b.z) < minZ - 30 || Math.min(a.z, b.z) > maxZ + 30) continue;
          ctx.moveTo(tx(a.x), tz(a.z));
          ctx.lineTo(tx(b.x), tz(b.z));
        }
        const width = roadPixelWidth(cls, s);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = pass === 'casing' ? style.casing : style.fill;
        ctx.lineWidth = pass === 'casing' ? width + Math.max(1, Math.min(2.5, s * 1.5)) : width;
        ctx.stroke();
      }
    }
    // Bridges get a dark outline so they read over water.
    ctx.beginPath();
    for (const e of w.roads.edges) {
      if (!e.bridge) continue;
      const a = nodes[e.a];
      const b = nodes[e.b];
      ctx.moveTo(tx(a.x), tz(a.z));
      ctx.lineTo(tx(b.x), tz(b.z));
    }
    ctx.strokeStyle = 'rgba(40,40,40,0.55)';
    ctx.lineWidth = Math.max(1.5, 24 * s);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    // Elevated highways.
    for (const h of w.highways) {
      for (const pass of ['casing', 'fill'] as const) {
        ctx.beginPath();
        h.line.forEach((p, i) => (i === 0 ? ctx.moveTo(tx(p.x), tz(p.z)) : ctx.lineTo(tx(p.x), tz(p.z))));
        const width = Math.max(3, 30 * s);
        ctx.strokeStyle = pass === 'casing' ? ROAD_STYLE.highway.casing : ROAD_STYLE.highway.fill;
        ctx.lineWidth = pass === 'casing' ? width + 2 : width;
        ctx.stroke();
      }
    }

    if (this.layers.debug) this.drawDebug(ctx, tx, tz);
    if (this.layers.labels) this.drawLabels(ctx, view, tx, tz, width, height);
    ctx.restore();
  }

  private drawDebug(ctx: CanvasRenderingContext2D, tx: (x: number) => number, tz: (z: number) => number): void {
    const { nodes, edges } = this.world.roads;
    for (const n of nodes) {
      if (n.edges.length === 1) {
        ctx.fillStyle = n.culDeSac ? '#2a9d3a' : '#d62828';
        ctx.beginPath();
        ctx.arc(tx(n.x), tz(n.z), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    void edges;
  }

  private drawLabels(ctx: CanvasRenderingContext2D, view: MapView, tx: (x: number) => number, tz: (z: number) => number, width: number, height: number): void {
    const s = view.scale;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // District names: large, letter-spaced.
    const districtSize = Math.max(11, Math.min(34, 42 * s));
    ctx.font = `800 ${districtSize}px system-ui, sans-serif`;
    for (const l of DISTRICT_LABELS) {
      const x = tx(l.at.x);
      const y = tz(l.at.z);
      if (x < -200 || y < -50 || x > width + 200 || y > height + 50) continue;
      const text = l.name.split('').join(String.fromCharCode(8202));
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = 'rgba(60,50,70,0.8)';
      ctx.fillText(text, x, y);
    }
    // Landmarks.
    ctx.font = `600 ${Math.max(10, Math.min(14, 18 * s))}px system-ui, sans-serif`;
    for (const l of LANDMARKS) {
      const x = tx(l.at.x);
      const y = tz(l.at.z);
      if (x < -50 || y < -50 || x > width + 50 || y > height + 50) continue;
      ctx.fillStyle = '#d6336c';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(l.name, x, y - 12);
      ctx.fillStyle = '#5b1733';
      ctx.fillText(l.name, x, y - 12);
    }
    // Road names along long straight-ish main roads when zoomed in.
    if (s >= 0.5) this.drawRoadNames(ctx, tx, tz, s, width, height);
  }

  private drawRoadNames(ctx: CanvasRenderingContext2D, tx: (x: number) => number, tz: (z: number) => number, s: number, width: number, height: number): void {
    const { nodes, edges } = this.world.roads;
    const placed: { x: number; y: number }[] = [];
    ctx.font = `500 ${Math.max(9, Math.min(13, 11 * s))}px system-ui, sans-serif`;
    for (const e of edges) {
      if (e.cls === 'street' && s < 1.1) continue;
      const a = nodes[e.a];
      const b = nodes[e.b];
      const len = Math.hypot(b.x - a.x, b.z - a.z) * s;
      const textW = ctx.measureText(e.name).width;
      if (len < textW * 0.7) continue;
      const x = (tx(a.x) + tx(b.x)) / 2;
      const y = (tz(a.z) + tz(b.z)) / 2;
      if (x < 0 || y < 0 || x > width || y > height) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < 140)) continue;
      placed.push({ x, y });
      let ang = Math.atan2(tz(b.z) - tz(a.z), tx(b.x) - tx(a.x));
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(e.name, 0, 0);
      ctx.fillStyle = '#3d3a36';
      ctx.fillText(e.name, 0, 0);
      ctx.restore();
    }
  }
}

function roadPixelWidth(cls: string, s: number): number {
  const metres = cls === 'arterial' ? 22 : cls === 'avenue' ? 15 : cls === 'street' ? 11 : 5;
  const min = cls === 'arterial' ? 2.4 : cls === 'avenue' ? 1.8 : 1;
  return Math.max(min, metres * s);
}

function blockFill(b: Block): string {
  if (b.use === 'urban') return DISTRICTS[b.district].mapColor;
  return BLOCK_FILL[b.use] ?? '#d9d4cc';
}

function addRing(p: Path2D, ring: Ring, tx: (x: number) => number, tz: (z: number) => number): void {
  ring.forEach((q, i) => (i === 0 ? p.moveTo(tx(q.x), tz(q.z)) : p.lineTo(tx(q.x), tz(q.z))));
  p.closePath();
}

function visible(ring: Ring, minX: number, minZ: number, maxX: number, maxZ: number): boolean {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of ring) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.z < z0) z0 = p.z;
    if (p.z > z1) z1 = p.z;
  }
  return x1 >= minX && x0 <= maxX && z1 >= minZ && z0 <= maxZ;
}
