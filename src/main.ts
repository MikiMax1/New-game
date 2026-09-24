import * as THREE from 'three';
import './style.css';
import { Game } from './game';
import { isCapture, paramNum, paramNums, paramStr } from './core/params';
import { CityRenderer } from './render/cityRenderer';
import { createParkedCars } from './render/parkedCars';
import { NightLights, nightFromSun } from './render/nightLights';
import { DEFAULT_SEED } from './world/config';
import { Grid } from './world/gen/raster';
import { loadCity } from './world/loadWorld';
import { SPOT_NAMES, findSpot } from './world/spots';
import { Minimap } from './ui/minimap';

const game = new Game(document.getElementById('app')!);
const seed = paramNum('seed', DEFAULT_SEED);
const loadingText = document.getElementById('loading-text')!;
const loadingBar = document.getElementById('loading-bar')!;

const { world, city } = await loadCity(
  seed,
  (stage, f) => {
    loadingText.textContent = stage + '…';
    loadingBar.style.width = `${Math.round(f * 100)}%`;
  },
  true,
);
if (!city) throw new Error('city meshes missing');

const cityRenderer = new CityRenderer(game.scene, city);
game.add({ update: (dt) => cityRenderer.update(dt, game.camera) });
cityRenderer.detail = game.quality.detail;
game.onQualityChange((q) => (cityRenderer.detail = q.detail));

// Street-light pools on the ground at night.
const night = new NightLights(city.lightMap);
for (const key of ['road', 'sidewalk', 'lotGround', 'lotBase', 'terrain', 'paintWhite', 'paintYellow', 'curb']) {
  const m = cityRenderer.materials.get(key);
  if (m) night.apply(m.material);
}
game.add({ update: () => night.setNight(nightFromSun(game.environment.sunDirection)) });

const parkedCars = createParkedCars(game.scene, world.parked, 280 * game.quality.detail);
game.add({ update: () => parkedCars.update(game.camera) });
game.onQualityChange((q) => {
  parkedCars.radius = 280 * q.detail;
  parkedCars.invalidate();
});

// The camera never goes below the displayed ground (or the sea surface).
const grid = new Grid(world.terrain.res);
const ground = (x: number, z: number): number => Math.max(0, grid.sample(world.terrain.height, x, z));
game.fly.groundHeight = ground;

function goToSpot(name: string): boolean {
  const spot = findSpot(name, world, ground);
  if (!spot) return false;
  game.fly.lookAt(new THREE.Vector3(...spot.pos), new THREE.Vector3(...spot.look));
  game.fly.speed = spot.pos[1] > 20 ? 80 : 15;
  return true;
}

const spotParam = paramStr('spot', '');
if (spotParam) goToSpot(spotParam);
else if (!paramNums('cam')) goToSpot('skyline');

// Number keys jump between photo spots.
game.add({
  update: () => {
    for (let k = 0; k < Math.min(9, SPOT_NAMES.length); k++) {
      if (game.input.wasPressed(`Digit${k + 1}`)) {
        goToSpot(SPOT_NAMES[k]);
        game.toast(`Spot ${k + 1}: ${SPOT_NAMES[k]}`);
      }
    }
  },
});

if (!isCapture) {
  const minimap = new Minimap(world, game.fly, game.input);
  game.add({ update: () => minimap.update() });
}

game.overlay.addProvider(() => `world seed ${seed}   roads ${world.stats.roadKm} km   lots ${world.stats.lots}   props ${world.stats.props}   parked cars ${world.stats.parkedCars}`);

addHint();
const loading = document.getElementById('loading');
if (isCapture) loading?.remove();
else loading?.classList.add('done');
game.start();
game.markReady();

function addHint(): void {
  if (isCapture) return;
  const el = document.createElement('div');
  el.className = 'hint';
  el.innerHTML =
    '<b>Port Solmar</b> (early build)<br>' +
    '<kbd>Click</kbd> look around &nbsp; <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly<br>' +
    '<kbd>E</kbd>/<kbd>Q</kbd> up/down &nbsp; <kbd>Shift</kbd> fast &nbsp; wheel: speed<br>' +
    '<kbd>1</kbd>–<kbd>9</kbd> photo spots &nbsp; <kbd>[</kbd><kbd>]</kbd> time of day<br>' +
    '<kbd>M</kbd> map &nbsp; <kbd>O</kbd> quality &nbsp; <kbd>F3</kbd> stats &nbsp; <kbd>F2</kbd> screenshot';
  document.body.appendChild(el);
}
