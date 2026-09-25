// Photoreal showcase: the graphics pipeline on a rain-soaked street corner, built only from
// loaded photo-scanned assets. showcase.html runs it.
//
//   WebGPURenderer (WebGL 2 fallback), ACES filmic tone mapping at exposure 1.15, sRGB output
//   HDRI image-based lighting with the sun extracted into a 4096² shadow-casting light
//   GTAO, SSR, TRAA, bokeh DoF, bloom, chromatic aberration, vignette, colour grade
//
// URL parameters: hdri (wide_street_01 | venice_sunset | shanghai_bund), rot (HDRI rotation,
// degrees), env (HDRI intensity), cam=x,y,z & look=x,y,z, fov, color (car paint, hex without #),
// backend=webgpu|webgl, scale (render scale), frames (frames before a capture), debug=1 (logs
// model bounds), and ao/ssr/taa/dof/bloom/lens/grade=0 to switch a pass off.
import { ACESFilmicToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, Vector3 } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import '../style.css';
import { isCapture, paramBool, paramNum, paramNums, paramStr } from '../core/params';
import { createRenderer, isBackendChoice } from '../engine/renderer';
import { AssetLoader, MissingAssetsError } from './AssetLoader';
import { LightingManager } from './LightingManager';
import { MaterialLibrary } from './MaterialLibrary';
import { DEFAULT_POST, PostProcessing, type PostSettings } from './PostProcessing';
import { buildStreetScene } from './StreetScene';

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
const stage = (text: string, f?: number) => {
  loadingText.textContent = text;
  if (f !== undefined) loadingBar.style.width = `${Math.round(f * 100)}%`;
};

const t0 = performance.now();
const log = (what: string) => console.info(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${what}`);

async function main(): Promise<void> {
  stage('Starting the renderer…', 0.02);
  const choice = paramStr('backend', 'auto');
  const setup = await createRenderer(isBackendChoice(choice) ? choice : 'auto', (msg) => fail(`The GPU stopped responding (${msg}). Reload to try again.`));
  const { renderer } = setup;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio) * paramNum('scale', 1));
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(paramNum('fov', 38), 1, 0.1, 600);
  // A 35 mm lens at eye level beside the car.
  const cam = paramNums('cam') ?? [-5.6, 1.25, 4.4];
  const look = paramNums('look') ?? [0.4, 0.75, -3.1];
  camera.position.set(cam[0], cam[1], cam[2]);

  const assets = await AssetLoader.create(renderer);
  assets.onProgress((f) => stage('Loading photo-scanned assets…', 0.05 + f * 0.8));

  const lighting = new LightingManager(renderer, scene);
  const materials = new MaterialLibrary();
  const hdriId = paramStr('hdri', 'wide_street_01');
  const [hdr, street] = await Promise.all([assets.hdri(hdriId), buildStreetScene(assets, materials, '#' + paramStr('color', '7d0d12'))]);
  scene.add(street.root);
  log('assets loaded and placed');
  const sun = lighting.setEnvironment(hdr, { rotation: (paramNum('rot', 0) * Math.PI) / 180, intensity: paramNum('env', 1) });
  lighting.fitShadow(street.shadowBounds);
  if (sun) {
    const elevation = (Math.asin(sun.direction.y) * 180) / Math.PI;
    console.info(`sun: elevation ${elevation.toFixed(1)}°, illuminance ${sun.illuminance.toFixed(1)} (clamp ${sun.clampLevel.toFixed(2)}, ${sun.pixels} px)`);
  } else {
    console.info('sun: none found (overcast HDRI)');
  }
  if (paramBool('debug')) {
    for (const [id, b] of Object.entries(street.bounds)) {
      const s = b.getSize(new Vector3());
      console.info(`bounds ${id}: size ${s.x.toFixed(2)} × ${s.y.toFixed(2)} × ${s.z.toFixed(2)}  min ${b.min.x.toFixed(2)},${b.min.y.toFixed(2)},${b.min.z.toFixed(2)}`);
    }
  }

  const settings: PostSettings = { ...DEFAULT_POST };
  for (const key of ['ao', 'ssr', 'taa', 'dof', 'bloom', 'lens', 'grade'] as const) settings[key] = paramBool(key, true);
  const post = new PostProcessing(renderer, scene, camera, settings);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(look[0], look[1], look[2]);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.5;
  controls.maxDistance = 40;
  // Stay above the street.
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.update();

  const focusTarget = new Vector3();
  const updateFocus = () => post.focusOn(controls.target.lengthSq() > 0 ? focusTarget.copy(controls.target) : street.car.position);

  // Resize with the element, not just the window (split views, devtools, rotating phones).
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

  stage('Compiling shaders…', 0.9);
  await renderer.compileAsync(scene, camera);
  log('shaders compiled');

  window.__SHOWCASE = { renderer, scene, camera, post, lighting, materials, street, controls };
  const captureFrames = paramNum('frames', 24);
  let frame = 0;
  const loading = document.getElementById('loading');
  renderer.setAnimationLoop(() => {
    controls.update();
    updateFocus();
    post.render();
    frame++;
    if (frame === 2) {
      if (isCapture) loading?.remove();
      else loading?.classList.add('done');
    }
    if (frame === 1 || frame === captureFrames) log(`frame ${frame}`);
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
  el.innerHTML = `<b>Photoreal showcase</b> (${backend})<br>Drag to orbit &nbsp; wheel to zoom &nbsp; right-drag to pan`;
  document.body.appendChild(el);
}

function fail(message: string): void {
  stage(message);
  document.getElementById('loading')?.classList.remove('done');
  loadingBar.style.width = '0';
  window.__READY = true;
}

main().catch((e: unknown) => {
  console.error(e);
  fail(e instanceof MissingAssetsError ? e.message : `Could not start: ${(e as Error).message}`);
});
