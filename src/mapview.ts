import './style.css';
import './mapview.css';
import { isCapture, paramBool, paramNum, paramNums } from './core/params';
import { DEFAULT_SEED, MAP_SIZE } from './world/config';
import { loadWorld } from './world/loadWorld';
import { MapRenderer, type MapView } from './world/map2d/renderMap';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const seed = paramNum('seed', DEFAULT_SEED);
const loadingText = document.getElementById('loading-text')!;
const loadingBar = document.getElementById('loading-bar')!;

const world = await loadWorld(seed, (stage, f) => {
  loadingText.textContent = stage + '…';
  loadingBar.style.width = `${Math.round(f * 100)}%`;
});
const renderer = new MapRenderer(world);
renderer.layers.lots = paramBool('lots', true);
renderer.layers.debug = paramBool('debug', false);
renderer.layers.labels = paramBool('labels', true);

let dpr = 1;
const view: MapView = { cx: 0, cz: 0, scale: 0.2 };
const v = paramNums('view');
function fit(): void {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
}
fit();
if (v && v.length === 3) {
  [view.cx, view.cz, view.scale] = v;
} else {
  view.scale = (Math.min(window.innerWidth, window.innerHeight) / MAP_SIZE) * 0.98;
}

let pending = false;
function draw(): void {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    renderer.render(ctx, view, window.innerWidth, window.innerHeight);
    drawScaleBar();
  });
}

function drawScaleBar(): void {
  const targets = [50, 100, 200, 500, 1000, 2000];
  const metres = targets.find((m) => m * view.scale > 80) ?? 2000;
  const px = metres * view.scale;
  const x = 16;
  const y = window.innerHeight - 22;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(x - 6, y - 18, px + 60, 30);
  ctx.fillStyle = '#222';
  ctx.fillRect(x, y, px, 3);
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, x + px + 6, y + 3);
}

// Info panel.
const panel = document.createElement('div');
panel.className = 'map-panel';
const st = world.stats;
panel.innerHTML = `
  <h1>Port Solmar</h1>
  <p class="sub">Seed ${seed} &middot; 4 &times; 4 km</p>
  <dl>
    <dt>Roads</dt><dd>${st.roadKm} km</dd>
    <dt>Intersections</dt><dd>${world.roads.nodes.filter((n) => n.edges.length >= 3).length}</dd>
    <dt>Blocks</dt><dd>${st.blocks}</dd>
    <dt>Lots</dt><dd>${st.lots}</dd>
    <dt>Generated in</dt><dd>${Object.values(world.timings).reduce((a, b) => a + b, 0)} ms</dd>
  </dl>
  <div class="toggles">
    <label><input type="checkbox" data-layer="lots" ${renderer.layers.lots ? 'checked' : ''}> Lots</label>
    <label><input type="checkbox" data-layer="labels" ${renderer.layers.labels ? 'checked' : ''}> Labels</label>
    <label><input type="checkbox" data-layer="debug" ${renderer.layers.debug ? 'checked' : ''}> Dead ends</label>
  </div>
  <p class="hint-line">Drag to pan &middot; scroll to zoom &middot; <a href="./index.html">3D view</a></p>
  <div class="hover" id="hover"></div>`;
if (!isCapture) document.body.appendChild(panel);
panel.querySelectorAll<HTMLInputElement>('input[data-layer]').forEach((input) => {
  input.addEventListener('change', () => {
    renderer.layers[input.dataset.layer as 'lots' | 'labels' | 'debug'] = input.checked;
    draw();
  });
});

// Pan and zoom.
let drag: { x: number; y: number; cx: number; cz: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (drag) {
    view.cx = drag.cx - (e.clientX - drag.x) / view.scale;
    view.cz = drag.cz - (e.clientY - drag.y) / view.scale;
    draw();
  }
  showHover(e.clientX, e.clientY);
});
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const factor = Math.pow(1.0015, -e.deltaY);
    const wx = view.cx + (e.clientX - window.innerWidth / 2) / view.scale;
    const wz = view.cz + (e.clientY - window.innerHeight / 2) / view.scale;
    view.scale = Math.min(12, Math.max(0.08, view.scale * factor));
    view.cx = wx - (e.clientX - window.innerWidth / 2) / view.scale;
    view.cz = wz - (e.clientY - window.innerHeight / 2) / view.scale;
    draw();
  },
  { passive: false },
);
window.addEventListener('resize', () => {
  fit();
  draw();
});

const hover = panel.querySelector('#hover') as HTMLDivElement;
function showHover(sx: number, sy: number): void {
  const x = view.cx + (sx - window.innerWidth / 2) / view.scale;
  const z = view.cz + (sy - window.innerHeight / 2) / view.scale;
  let best = '';
  let bestD = 25;
  const { nodes, edges } = world.roads;
  for (const e of edges) {
    const a = nodes[e.a];
    const b = nodes[e.b];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
    if (d < bestD) {
      bestD = d;
      best = `${e.name}${e.bridge ? ' (bridge)' : ''}`;
    }
  }
  hover.textContent = `${Math.round(x)}, ${Math.round(z)}${best ? ' · ' + best : ''}`;
}

if (isCapture) document.getElementById('loading')?.remove();
else document.getElementById('loading')?.classList.add('done');
draw();
requestAnimationFrame(() => requestAnimationFrame(() => (window.__READY = true)));

declare global {
  interface Window {
    __READY?: boolean;
  }
}
