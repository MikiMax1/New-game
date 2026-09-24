import * as THREE from 'three';
import './style.css';
import { Game } from './game';
import { Atmosphere } from './render/atmosphere';
import { PostFX } from './render/post';
import { isCapture, paramNum, paramNums, paramStr } from './core/params';
import { markRunning, markStarting } from './core/startupGuard';
import { CityRenderer } from './render/cityRenderer';
import { createBuildingMaterials, setBuildingNightFactor } from './render/buildingMaterials';
import { createParkedCars } from './render/parkedCars';
import { CityProps } from './render/cityProps';
import { NightLights } from './render/nightLights';
import { DEFAULT_SEED } from './world/config';
import { Grid } from './world/gen/raster';
import { loadCity } from './world/loadWorld';
import { SPOT_NAMES, findSpot } from './world/spots';
import { Minimap } from './ui/minimap';
import { Traffic } from './sim/traffic';
import { TrafficRenderer } from './render/trafficRenderer';

const game = new Game(document.getElementById('app')!);
// Physically based sky, sun/moon, cascaded shadows, sky reflections and haze. Created
// before anything renders: it patches the shader chunks every material uses.
const atmosphere = new Atmosphere(game.renderer, game.scene, game.camera, game.quality);
game.setEnvironment(atmosphere);
const post = new PostFX(game.renderer, game.scene, game.camera, game.quality);
game.renderFn = () => {
  post.scotopic = atmosphere.nightFactor;
  post.render();
};
game.onQualityChange((q) => {
  atmosphere.setQuality(q);
  post.setQuality(q);
});
const seed = paramNum('seed', DEFAULT_SEED);
const loadingText = document.getElementById('loading-text')!;
const loadingBar = document.getElementById('loading-bar')!;
const setStage = (stage: string, f: number): void => {
  loadingText.textContent = stage + '…';
  loadingBar.style.width = `${Math.round(f * 100)}%`;
};
/** Gives the browser a moment to paint the loading screen before the next long step. */
const paint = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

// If this start never reaches the running state (the tab or GPU process crashes), the next
// start drops the quality a step.
markStarting(game.quality.name);

const { world, city } = await loadCity(seed, setStage, true);
if (!city) throw new Error('city meshes missing');
setStage('Building the city', 0.97);
await paint();

const buildingMaterials = createBuildingMaterials();
const cityRenderer = new CityRenderer(game.scene, city, buildingMaterials);
game.add({ update: (dt) => cityRenderer.update(dt, game.camera) });
cityRenderer.detail = game.quality.detail;
game.onQualityChange((q) => (cityRenderer.detail = q.detail));

// Street-light pools on the ground at night.
const night = new NightLights(city.lightMap);
for (const key of ['road', 'sidewalk', 'lotGround', 'lotBase', 'terrain', 'paintWhite', 'paintYellow', 'curb']) {
  const m = cityRenderer.materials.get(key);
  if (m) night.apply(m.material);
}
game.add({
  update: () => {
    const n = atmosphere.nightFactor;
    night.setNight(n);
    setBuildingNightFactor(buildingMaterials, n, game.environment.timeOfDay);
  },
});

const parkedCars = createParkedCars(game.scene, world.parked, 280 * game.quality.detail);
game.add({ update: () => parkedCars.update(game.camera) });
game.onQualityChange((q) => {
  parkedCars.radius = 280 * q.detail;
  parkedCars.invalidate();
});

setStage('Parking cars and planting palms', 0.98);
await paint();

// Palms, trees and street furniture.
const props = new CityProps(game.scene, world.dressing, game.quality.detail);
game.onQualityChange((q) => props.setDetail(q.detail));

// Ambient traffic around the camera.
const trafficGrid = new Grid(world.terrain.res);
const traffic = new Traffic(world, (x, z, edge, t) => {
  const E = world.roads.edges[edge];
  if (E.bridge) return city.nodeY[E.a] * (1 - t) + city.nodeY[E.b] * t;
  return Math.max(0.3, trafficGrid.sample(world.terrain.height, x, z));
});
traffic.density = Math.round(150 * game.quality.detail);
const trafficRenderer = new TrafficRenderer(game.scene, traffic, 260);
const fwd = new THREE.Vector3();
game.add({
  update: (dt) => {
    game.camera.getWorldDirection(fwd);
    traffic.update(dt, game.camera.position.x, game.camera.position.z, fwd.x, fwd.z);
    trafficRenderer.update(atmosphere.nightFactor);
    // Props share the traffic clock so signal lenses match what cars obey.
    props.update(game.camera, traffic.clock, atmosphere.nightFactor);
  },
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

// Compile the scene's shaders before the first frame, in the background where the browser
// supports it (KHR_parallel_shader_compile), instead of stalling the first frame on them.
setStage('Compiling shaders', 0.99);
await paint();
await game.renderer.compileAsync(game.scene, game.camera);
setStage('Warming up', 1);
await paint();

// The loading screen stays up over the first frames, which still set up the sky and shadows.
const loading = document.getElementById('loading');
const startedAt = performance.now();
let frames = 0;
game.add({
  update: () => {
    frames++;
    if (frames === 3) {
      if (isCapture) loading?.remove();
      else loading?.classList.add('done');
      if (game.qualityReason === 'recovered') {
        game.toast(`The last start didn't finish, so graphics quality is now ${game.quality.name}. Press O to change it.`, 9000);
      }
    }
    if (frames > 30 && performance.now() - startedAt > 6000) markRunning();
  },
});
game.start();
atmosphere.onReady(() => game.markReady());

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
