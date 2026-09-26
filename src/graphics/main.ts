// Procedural photoreal showcase: a downtown street at golden hour after rain, with no external
// assets at all. Every mesh, texture, the sky and the image-based light are generated at runtime.
// showcase.html runs it.
//
//   WebGPURenderer (WebGL 2 fallback), ACES filmic tone mapping at exposure 1.2, sRGB output
//   procedural sky (Preetham) → float cube map → PMREM image-based light, street reflection probe
//   2048² PBR textures baked on the GPU from simplex, fBm and Worley noise
//   GTAO, SSR, TRAA, bokeh DoF, bloom, chromatic aberration, vignette, grade, film grain
//
// URL parameters: spot (hero | crossing | puddle | facades), cam=x,y,z & look=x,y,z, fov,
// sun=elevation,azimuth (degrees), clouds (0..1), turbidity, textures=0 (flat colours),
// texsize (texture resolution, default 2048), probe=0 (sky-only reflections), backend=webgpu|webgl,
// scale (render scale), frames (frames before a capture), and ao/ssr/taa/dof/bloom/lens/grade=0.
import { ACESFilmicToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, Vector3 } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import '../style.css';
import { isCapture, paramBool, paramNum, paramNums, paramStr } from '../core/params';
import { createRenderer, isBackendChoice } from '../engine/renderer';
import { flatCityMaterials, texturedCityMaterials } from './city/CityMaterials';
import { pavementMaterial, roadMaterial } from './city/StreetMaterials';
import { DEFAULT_POST, PostProcessing, type PostSettings } from './PostProcessing';
import { buildCity } from './ProceduralCity';
import { ProceduralLighting } from './ProceduralLighting';
import { ProceduralTextureEngine } from './ProceduralTextureEngine';

declare global {
  interface Window {
    __READY?: boolean;
    __STATS?: { calls: number; triangles: number; programs: number };
    __SHOWCASE?: unknown;
  }
}

const container = document.getElementById('app')!;
const loadingText = document.getElementById('loading-text')!;
const loadingBar = document.getElementById('loading-bar')!;
const t0 = performance.now();
const log = (what: string) => console.info(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${what}`);
const stage = async (text: string, f: number) => {
  loadingText.textContent = text;
  loadingBar.style.width = `${Math.round(f * 100)}%`;
  log(text);
  // Let the loading screen paint before the next long step.
  await new Promise((r) => setTimeout(r, 20));
};

async function main(): Promise<void> {
  await stage('Starting the renderer…', 0.02);
  const choice = paramStr('backend', 'auto');
  const setup = await createRenderer(isBackendChoice(choice) ? choice : 'auto', (msg) => fail(`The GPU stopped responding (${msg}). Reload to try again.`));
  const { renderer } = setup;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio) * paramNum('scale', 1));
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 5000);

  await stage('Building the sky…', 0.1);
  const sun = paramNums('sun');
  const lighting = new ProceduralLighting(renderer, scene, sun?.length === 2 ? { elevation: sun[0], azimuth: sun[1] } : undefined, {
    clouds: paramNum('clouds', 0.32),
    turbidity: paramNum('turbidity', 3.2),
  });
  scene.fogNode = lighting.fogNode();

  // Materials: 2048² PBR textures generated on the GPU (or flat colours with ?textures=0).
  let materials = flatCityMaterials();
  let road = materials.asphalt;
  let pavement = materials.pavement;
  if (paramBool('textures', true)) {
    const engine = new ProceduralTextureEngine(renderer, paramNum('texsize', 2048));
    const sets = await engine.bakeAll((f, name) => stage(`Generating textures: ${name}…`, 0.15 + f * 0.35));
    materials = texturedCityMaterials(sets);
    road = roadMaterial(sets.asphalt);
    pavement = pavementMaterial(sets.pavement);
  }

  await stage('Building the city…', 0.55);
  const city = buildCity(materials, { road, pavement });
  scene.add(city.root);
  lighting.fitShadow(city.shadowBounds);

  await stage('Baking the sky light…', 0.7);
  lighting.bakeSky();
  if (paramBool('probe', true)) {
    await stage('Baking the street reflection probe…', 0.75);
    lighting.bakeProbe(city.probe);
  }
  if (paramStr('debug', '') === 'env') {
    // Shows the image-based light itself as the backdrop, with the city and sky hidden.
    scene.background = scene.environment;
    city.root.visible = false;
    lighting.sky.visible = false;
  }

  // Camera: a named spot, or cam/look from the URL.
  const spot = city.spots[paramStr('spot', 'hero')] ?? city.spots.hero;
  const cam = paramNums('cam');
  const look = paramNums('look');
  camera.position.copy(cam?.length === 3 ? new Vector3(cam[0], cam[1], cam[2]) : spot.position);
  const target = look?.length === 3 ? new Vector3(look[0], look[1], look[2]) : spot.target.clone();
  camera.fov = paramNum('fov', spot.fov);

  const settings: PostSettings = { ...DEFAULT_POST };
  for (const key of ['ao', 'ssr', 'taa', 'dof', 'bloom', 'lens', 'grade'] as const) settings[key] = paramBool(key, true);
  const post = new PostProcessing(renderer, scene, camera, settings);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.5;
  controls.maxDistance = 200;
  controls.maxPolarAngle = Math.PI * 0.497;
  controls.update();

  // Focus: where the camera looks, but no further than the subject of a street-level shot.
  const focus = new Vector3();
  const updateFocus = () => {
    const d = Math.min(camera.position.distanceTo(controls.target), 25);
    focus.copy(controls.target).sub(camera.position).setLength(d).add(camera.position);
    post.focusOn(focus);
  };

  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();

  await stage('Compiling shaders…', 0.9);
  await renderer.compileAsync(scene, camera);

  window.__SHOWCASE = { renderer, scene, camera, post, lighting, materials, city, controls };
  const captureFrames = paramNum('frames', 24);
  let frame = 0;
  const loading = document.getElementById('loading');
  renderer.setAnimationLoop(() => {
    controls.update();
    updateFocus();
    post.render();
    frame++;
    if (frame === 1 || frame === captureFrames) log(`frame ${frame}`);
    if (frame === 2) {
      if (isCapture) loading?.remove();
      else loading?.classList.add('done');
    }
    if (frame === captureFrames) {
      const info = renderer.info.render as { calls?: number; drawCalls?: number; triangles?: number };
      window.__STATS = { calls: info.calls ?? info.drawCalls ?? 0, triangles: info.triangles ?? 0, programs: 0 };
      window.__READY = true;
    }
  });
  if (!isCapture) addHint(setup.backend);
}

function addHint(backend: string): void {
  const el = document.createElement('div');
  el.className = 'hint';
  el.innerHTML = `<b>Procedural city</b> (${backend}): no external assets<br>Drag to orbit &nbsp; wheel to zoom &nbsp; right-drag to pan`;
  document.body.appendChild(el);
}

function fail(message: string): void {
  loadingText.textContent = message;
  document.getElementById('loading')?.classList.remove('done');
  loadingBar.style.width = '0';
  window.__READY = true;
}

main().catch((e: unknown) => {
  console.error(e);
  fail(`Could not start: ${(e as Error).message}`);
});
