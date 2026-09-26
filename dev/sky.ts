// Physical sky test page: the engine core's sky, sun and moon light and sky-lit environment.
//
//   dev/sky.html?time=17.5&backend=webgl&cam=x,y,z&look=x,y,z
// Extra parameters: ev (fixed EV100 instead of the estimate), day (1..365), fov (vertical,
// degrees), aim=sun|moon (look straight at it), speed (hours of sky time per second), hud=0
// (hide the numbers). Without cam/look the camera faces the sun's azimuth (the moon's at night)
// over a few test objects. Sky values are printed to the console
// (SHOOT_VERBOSE=1 node tools/shoot.mjs "dev/sky.html?time=12" out.png).
import { AgXToneMapping, BoxGeometry, Color, DirectionalLight, Mesh, PerspectiveCamera, PlaneGeometry, Scene, SphereGeometry, Vector3 } from 'three';
import { pass } from 'three/tsl';
import { MeshStandardNodeMaterial, RenderPipeline, WebGPURenderer } from 'three/webgpu';
import '../src/style.css';
import { paramBool, paramNum, paramNums, paramStr } from '../src/core/params';
import { exposureFromEv100, targetEv100 } from '../src/engine/exposure';
import { installWebGPUCompat } from '../src/engine/renderer';
import { PhysicalSky } from '../src/engine/sky';
import { exposureNode } from '../src/engine/units';

const DEG = Math.PI / 180;

installWebGPUCompat();
const renderer = new WebGPURenderer({ forceWebGL: paramStr('backend', 'auto') === 'webgl', antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = AgXToneMapping;
renderer.shadowMap.enabled = true;
document.getElementById('app')!.appendChild(renderer.domElement);
await renderer.init();
const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2';

const scene = new Scene();
const camera = new PerspectiveCamera(paramNum('fov', 70), innerWidth / innerHeight, 0.1, 20000);
const sky = new PhysicalSky(renderer, { dayOfYear: paramNum('day', 268) });
sky.timeOfDay = paramNum('time', 12);
scene.add(sky.mesh);

// Ground and a few test objects: grey and white diffuse, a mirror and a brushed-metal ball.
const matte = (grey: number) => new MeshStandardNodeMaterial({ color: new Color(grey, grey, grey), roughness: 0.9 });
const ground = new Mesh(new PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2), matte(0.2));
ground.receiveShadow = true;
scene.add(ground);
const objects: [Mesh, number, number][] = [
  [new Mesh(new BoxGeometry(2, 2, 2).translate(0, 1, 0), matte(0.6)), -3.5, 0],
  [new Mesh(new SphereGeometry(1, 48, 24).translate(0, 1, 0), matte(0.2)), -1.2, 1.5],
  [new Mesh(new SphereGeometry(1, 48, 24).translate(0, 1, 0), new MeshStandardNodeMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04 })), 1.2, 1.5],
  [new Mesh(new SphereGeometry(1, 48, 24).translate(0, 1, 0), new MeshStandardNodeMaterial({ color: 0xffffff, metalness: 1, roughness: 0.35 })), 3.5, 0],
];
for (const [mesh] of objects) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

const sunLight = new DirectionalLight(0xffffff, 0);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 200 });
sunLight.shadow.bias = -0.0005;
const moonLight = new DirectionalLight(0xffffff, 0);
scene.add(sunLight, sunLight.target, moonLight, moonLight.target);

const pipeline = new RenderPipeline(renderer);
pipeline.outputNode = pass(scene, camera);

// Camera: ?cam/&look, or facing the sun's azimuth (the moon's once the sun is well down) with
// the test objects between the camera and the light.
sky.update(camera);
const cam = paramNums('cam');
const look = paramNums('look');
const facing = sky.sunElevation > -10 || sky.moonElevation < 0 ? sky.sunDirection : sky.moonDirection;
const ahead = new Vector3(facing.x, 0, facing.z).normalize();
const right = new Vector3(-ahead.z, 0, ahead.x);
for (const [mesh, across, along] of objects) mesh.position.copy(right).multiplyScalar(across).addScaledVector(ahead, along);
camera.position.copy(cam ? new Vector3(...cam) : ahead.clone().multiplyScalar(-11).setY(1.7));
const aim = paramStr('aim', '');
if (aim === 'sun' || aim === 'moon') camera.lookAt(camera.position.clone().add(aim === 'sun' ? sky.sunDirection : sky.moonDirection));
else camera.lookAt(look ? new Vector3(...look) : ahead.clone().multiplyScalar(30).setY(6));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Sky probes, in the frame of the sun's azimuth: [label, azimuth from the sun (deg), elevation (deg)].
const PROBES: [string, number, number][] = [
  ['zenith', 0, 90],
  ['sun 0.5°', 0, 0.5],
  ['sun 5°', 0, 5],
  ['sun 20°', 0, 20],
  ['side 0.5°', 90, 0.5],
  ['side 45°', 90, 45],
  ['anti 0.5°', 180, 0.5],
  ['anti 20°', 180, 20],
  ['ground -5°', 0, -5],
  ['nadir', 0, -89],
];
/** Cosine-weighted directions over the upper hemisphere, for the sky's horizontal illuminance. */
const HEMISPHERE = Array.from({ length: 48 }, (_, i) => {
  const xi = (i % 8 + 0.5) / 8;
  const phi = (Math.floor(i / 8) + 0.5) * ((2 * Math.PI) / 6);
  const s = Math.sqrt(xi);
  return new Vector3(Math.cos(phi) * s, Math.sqrt(1 - xi), Math.sin(phi) * s);
});
const lum = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

let exposure = 1;
let ev = 0;
let skyIlluminance = 0;
let probeText: string[] = [];

async function measure(): Promise<void> {
  const f = new Vector3(sky.sunDirection.x, 0, sky.sunDirection.z).normalize();
  const r = new Vector3(-f.z, 0, f.x);
  const dirs = PROBES.map(([, az, el]) => {
    const h = f.clone().multiplyScalar(Math.cos(az * DEG)).addScaledVector(r, Math.sin(az * DEG));
    return h.multiplyScalar(Math.cos(el * DEG)).setY(Math.sin(el * DEG));
  });
  const values = await sky.sampleSky([...dirs, ...HEMISPHERE]);
  const hemi = values.slice(PROBES.length);
  skyIlluminance = (Math.PI * hemi.reduce((s, c) => s + lum(c), 0)) / hemi.length;
  // A street view: about half sky, half ground of albedo 0.2 lit by the sun, moon and sky.
  const direct = sky.sunIlluminance * Math.max(0, sky.sunDirection.y) + sky.moonIlluminance * Math.max(0, sky.moonDirection.y);
  const average = 0.5 * (skyIlluminance / Math.PI) + 0.5 * ((0.2 * (direct + skyIlluminance)) / Math.PI);
  ev = paramNum('ev', targetEv100(average));
  exposure = exposureFromEv100(ev);
  probeText = PROBES.map(([label], i) => {
    const c = values[i];
    const l = lum(c);
    return `${label.padEnd(11)} ${l.toPrecision(4).padStart(9)} nits  rgb/L ${[c.r, c.g, c.b].map((v) => (v / Math.max(l, 1e-12)).toFixed(2)).join(' ')}`;
  });
  probeText.push(`sky E ${skyIlluminance.toPrecision(4)} lux, scene avg ≈ ${average.toPrecision(3)} nits`);
}

const hud = document.getElementById('hud')!;
hud.hidden = !paramBool('hud', true);
function report(): string[] {
  const s = sky;
  return [
    `${backend}  time ${s.timeOfDay.toFixed(2)} h  day ${s.dayOfYear}`,
    `sun ${s.sunElevation.toFixed(2)}°  E ${s.sunIlluminance.toFixed(0)} lux  colour ${[s.sunColor.r, s.sunColor.g, s.sunColor.b].map((v) => v.toFixed(3)).join(' ')}`,
    `moon ${s.moonElevation.toFixed(2)}°  E ${s.moonIlluminance.toFixed(4)} lux  colour ${[s.moonColor.r, s.moonColor.g, s.moonColor.b].map((v) => v.toFixed(3)).join(' ')}`,
    `night ${s.nightFactor.toFixed(2)}  EV100 ${ev.toFixed(2)}  exposure ${exposure.toExponential(3)}`,
    `environment ×${s.environmentScale.toPrecision(4)} nits  updates: LUT ${s.lutUpdates}, environment ${s.environmentUpdates}`,
    ...probeText,
  ];
}

let measuring = false;
/** Time of the last exposure measurement (ms), or -1 before the first. */
let measuredAt = -1;
let settled = 0;
const speed = paramNum('speed', 0);
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  sky.timeOfDay += (speed * (now - last)) / 1000;
  last = now;
  sky.update(camera);
  exposureNode.value = exposure;
  sunLight.position.copy(sky.sunDirection).multiplyScalar(100);
  sunLight.color.copy(sky.sunColor);
  sunLight.intensity = sky.sunIlluminance * exposure;
  moonLight.position.copy(sky.moonDirection).multiplyScalar(100);
  moonLight.color.copy(sky.moonColor);
  moonLight.intensity = sky.moonIlluminance * exposure;
  scene.environment = sky.environment;
  scene.environmentIntensity = sky.environmentScale * exposure;
  pipeline.render();
  // Exposure from the sky: at the start, then every half second while the time runs.
  if (!measuring && (measuredAt < 0 || (speed !== 0 && now - measuredAt > 500))) {
    measuring = true;
    measure().then(() => {
      if (measuredAt < 0) for (const line of report()) console.log(line);
      measuring = false;
      measuredAt = performance.now();
    });
  }
  if (measuredAt < 0) return;
  hud.textContent = report().join('\n');
  // Screenshot tool: a few frames after the exposure is known.
  if (!window.__READY && ++settled > 3) window.__READY = true;
});
