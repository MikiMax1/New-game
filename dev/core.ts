// Engine-core test scene: the same district on WebGPU and WebGL 2, lit by the physical sky, sun,
// moon and hundreds of street lamps, through the full frame graph (pre-pass, GTAO, forward+,
// TAAU, bloom, auto-exposure). See DEVELOPMENT_PLAN.md, Part 1, Step 1.
//
//   dev/core.html?time=18.5&spot=street
// Parameters: time (solar hours), spot (plaza|street|wires|overview|fan), cam=x,y,z&look=x,y,z,
// backend=webgpu|webgl, quality=low|medium|high|ultra|extreme, scale (3D render scale, 0.25–2),
// taa=0, ao=0, bloom=0, fps (frame-rate cap), dynres=1, frames (frames before a capture),
// haze (aerosol density multiplier, 1 = a typical humid day), clouds (afternoon cumulus cover 0..1).
import * as THREE from 'three';
import '../src/style.css';
import { isCapture, paramNum, paramNums, paramStr } from '../src/core/params';
import { Daylight } from '../src/engine/daylight';
import { Engine } from '../src/engine/engine';
import { PhysicalSky } from '../src/engine/sky';
import { buildCoreScene } from './coreScene';

const loadingText = document.getElementById('loading-text')!;
const loadingBar = document.getElementById('loading-bar')!;
const setStage = (stage: string, f: number): Promise<void> => {
  loadingText.textContent = stage + '…';
  loadingBar.style.width = `${Math.round(f * 100)}%`;
  // Let the browser paint the loading screen before the next long step.
  return new Promise((r) => setTimeout(r, 30));
};

await setStage('Starting the renderer', 0.1);
const engine = await Engine.create(document.getElementById('app')!);
const { scene, camera } = engine;

await setStage('Building the sky', 0.3);
const sky = new PhysicalSky(engine.renderer);
sky.timeOfDay = paramNum('time', 16.5);
scene.add(sky.mesh);
scene.fogNode = sky.fogNode();
sky.haze.value = paramNum('haze', 1);
const daylight = new Daylight(scene, sky, engine.lights);
daylight.setQuality(engine.quality);
sky.setQuality(engine.quality.name);
sky.clouds.cover = paramNum('clouds', 0.3);
engine.onQualityChange((q) => {
  daylight.setQuality(q);
  sky.setQuality(q.name);
});
engine.onExposure((e) => daylight.applyExposure(e));

await setStage('Building the test district', 0.5);
const district = buildCoreScene({ scene, lamps: engine.lamps });
engine.fly.groundHeight = () => 0;

const spotNames = Object.keys(district.spots);
function goToSpot(name: string): boolean {
  const spot = district.spots[name];
  if (!spot) return false;
  engine.fly.lookAt(new THREE.Vector3(...spot.pos), new THREE.Vector3(...spot.look));
  engine.fly.speed = spot.pos[1] > 20 ? 60 : 12;
  return true;
}
const cam = paramNums('cam');
const look = paramNums('look');
if (cam?.length === 3 && look?.length === 3) {
  engine.fly.lookAt(new THREE.Vector3(cam[0], cam[1], cam[2]), new THREE.Vector3(look[0], look[1], look[2]));
} else if (!goToSpot(paramStr('spot', 'plaza'))) {
  goToSpot(spotNames[0]);
}

engine.onUpdate((dt) => {
  const input = engine.input;
  // Time of day: [ and ] step an hour, hold T to fast-forward.
  if (input.wasPressed('BracketRight')) sky.timeOfDay = (sky.timeOfDay + 1) % 24;
  if (input.wasPressed('BracketLeft')) sky.timeOfDay = (sky.timeOfDay + 23) % 24;
  if (input.isDown('KeyT')) sky.timeOfDay = (sky.timeOfDay + dt * 2) % 24;
  for (let k = 0; k < Math.min(9, spotNames.length); k++) {
    if (input.wasPressed(`Digit${k + 1}`)) {
      goToSpot(spotNames[k]);
      engine.toast(`Spot ${k + 1}: ${spotNames[k]}`);
    }
  }
  sky.update(camera);
  daylight.update(camera);
  district.update(dt, engine.simTime, sky.nightFactor);
});

engine.overlay.addProvider(() => {
  const h = Math.floor(sky.timeOfDay);
  const m = Math.floor((sky.timeOfDay - h) * 60);
  const sunElevation = THREE.MathUtils.radToDeg(Math.asin(sky.sunDirection.y));
  const p = camera.position;
  return [
    `time ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}   sun ${sunElevation.toFixed(1)}° ${formatLux(sky.sunIlluminance)}   moon ${formatLux(sky.moonIlluminance)}   night ${sky.nightFactor.toFixed(2)}`,
    `pos ${p.x.toFixed(0)}, ${p.y.toFixed(1)}, ${p.z.toFixed(0)}   speed ${engine.fly.speed.toFixed(0)} m/s`,
  ];
});

await setStage('Compiling shaders', 0.8);
sky.update(camera);
daylight.update(camera);
await engine.warmUp();
await setStage('Warming up', 1);

const loading = document.getElementById('loading');
let frames = 0;
engine.onUpdate(() => {
  if (++frames !== 3) return;
  if (isCapture) loading?.remove();
  else loading?.classList.add('done');
  if (engine.qualityReason === 'recovered') {
    engine.toast(`The last start didn't finish, so graphics quality is now ${engine.quality.name}. Press O to change it.`, 9000);
  }
});
engine.start();
engine.markReady();
addHint();

function formatLux(lux: number): string {
  return lux >= 1000 ? `${(lux / 1000).toFixed(1)} klux` : lux >= 1 ? `${lux.toFixed(1)} lux` : `${lux.toPrecision(2)} lux`;
}

function addHint(): void {
  if (isCapture) return;
  const el = document.createElement('div');
  el.className = 'hint';
  el.innerHTML =
    `<b>Engine core</b> (${engine.backend})<br>` +
    '<kbd>Click</kbd> look around &nbsp; <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly<br>' +
    '<kbd>E</kbd>/<kbd>Q</kbd> up/down &nbsp; <kbd>Shift</kbd> fast &nbsp; wheel: speed<br>' +
    `<kbd>1</kbd>–<kbd>${Math.min(9, spotNames.length)}</kbd> spots &nbsp; <kbd>[</kbd><kbd>]</kbd> time &nbsp; hold <kbd>T</kbd> fast-forward<br>` +
    '<kbd>O</kbd> quality &nbsp; <kbd>L</kbd> fps cap &nbsp; <kbd>Y</kbd> dynamic res<br>' +
    '<kbd>F3</kbd> stats &nbsp; <kbd>F2</kbd> screenshot';
  document.body.appendChild(el);
}
