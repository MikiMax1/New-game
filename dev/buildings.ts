// Building showroom: every district / use style on synthetic lots along simple streets.
//
//   dev/buildings.html?spot=beach            street-level photo spots (see SPOTS below)
//   dev/buildings.html?night=1&hour=21       night lighting (hour picks which windows are lit)
//   dev/buildings.html?lod=1                 far LOD for every building
//   dev/buildings.html?cam=x,y,z&look=x,y,z  free camera (handled by Game)
//   dev/buildings.html?seed=3                another random variant of every lot
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import '../src/style.css';
import { isCapture, paramBool, paramNum, paramNums, paramStr } from '../src/core/params';
import { Game } from '../src/game';
import { createBuildingMaterials, setBuildingNightFactor } from '../src/render/buildingMaterials';
import { toBufferGeometry } from '../src/render/meshConvert';
import { type BuildingInfo, generateBuilding } from '../src/world/buildings';
import { type SampleLayout, sampleLayout } from '../src/world/buildings/samples';
import { BucketBuilder } from '../src/world/mesh/meshData';
import type { DistrictId } from '../src/world/types';

const game = new Game(document.getElementById('app')!);
(window as unknown as { __game: Game }).__game = game; // for poking at the scene from devtools
const night = paramBool('night');
const lod: 0 | 1 = paramNum('lod', 0) >= 1 ? 1 : 0;
const hour = paramNum('hour', night ? 21 : 12);
if (night) game.environment.timeOfDay = paramNum('time', 21.5);
const layout = sampleLayout(paramNum('seed', 1));

// ---------------------------------------------------------------- buildings
const t0 = performance.now();
const out = new BucketBuilder();
const infos: BuildingInfo[] = [];
for (const lot of layout.lots) infos.push(generateBuilding(lot, out, lod));
const buckets = out.build();
const genMs = performance.now() - t0;
const materials = createBuildingMaterials();
setBuildingNightFactor(materials, night ? 1 : 0, hour);
let triangles = 0;
for (const [key, mesh] of buckets) {
  const m = new THREE.Mesh(toBufferGeometry(mesh), materials.get(key));
  m.castShadow = true;
  m.receiveShadow = true;
  game.scene.add(m);
  triangles += mesh.indices.length / 3;
}

// ---------------------------------------------------------------- ground, streets, props
addGround(layout);
addScaleProps(layout);
addEnvironment();

game.overlay.addProvider(() => `buildings ${infos.filter((i) => i.style !== 'none').length}   tris ${triangles}   gen ${genMs.toFixed(0)} ms   lod ${lod}`);

// ---------------------------------------------------------------- photo spots
const streetZ = (d: DistrictId): number => layout.streets.find((s) => s.district === d)?.z ?? 0;
const SPOTS: Record<string, [number, number, number, number, number, number]> = {
  overview: [330, 190, streetZ('beach') + 170, -20, 10, streetZ('downtown') + 20],
  skyline: [420, 60, streetZ('downtown') + 260, 0, 60, streetZ('downtown')],
  downtown: [-120, 1.7, streetZ('downtown') + 4.5, 20, 30, streetZ('downtown') - 20],
  downtownUp: [-70, 1.7, streetZ('downtown') + 3, -20, 60, streetZ('downtown') - 40],
  beach: [-105, 1.7, streetZ('beach') + 4.5, -10, 6, streetZ('beach') - 18],
  beachTowers: [-10, 2, streetZ('beach') + 5, 110, 25, streetZ('beach') - 30],
  littleSolano: [-72, 1.7, streetZ('littleSolano') + 4, 10, 4, streetZ('littleSolano') - 12],
  palmHeights: [-90, 1.7, streetZ('palmHeights') + 3, -10, 3, streetZ('palmHeights') - 25],
  northside: [-40, 1.7, streetZ('northside') + 5, 60, 5, streetZ('northside') - 30],
  harbor: [-160, 2, streetZ('harbor') + 5, -40, 8, streetZ('harbor') - 30],
  islands: [-110, 1.7, streetZ('islands') + 4, -40, 4, streetZ('islands') - 35],
  cypress: [-60, 1.7, streetZ('cypressEdge') + 4, 0, 3, streetZ('cypressEdge') - 20],
  closeup: [-86, 1.7, streetZ('beach') - 8.2, -92, 5.5, streetZ('beach') - 14],
  aerialLow: [-60, 55, streetZ('littleSolano') + 60, 0, 0, streetZ('littleSolano') - 10],
  far: [900, 120, streetZ('beach') + 700, 0, 40, streetZ('downtown')],
};
const spot = SPOTS[paramStr('spot', '')];
if (spot && !paramNums('cam')) game.fly.lookAt(new THREE.Vector3(spot[0], spot[1], spot[2]), new THREE.Vector3(spot[3], spot[4], spot[5]));
if (!spot && !paramNums('cam')) game.fly.lookAt(new THREE.Vector3(...SPOTS.overview.slice(0, 3) as [number, number, number]), new THREE.Vector3(...SPOTS.overview.slice(3) as [number, number, number]));

if (!isCapture) addHint();
if (isCapture) {
  document.getElementById('loading')?.remove();
  // Software WebGL (headless capture) takes seconds per frame and requestAnimationFrame does
  // not wait for it, so frames queue up and the screenshot would wait for all of them.
  // The scene is static: render it once, let the canvas keep showing that frame, and keep
  // reporting that frame's statistics.
  let frames = 0;
  const first = { calls: 0, triangles: 0 };
  game.renderFn = () => {
    const info = game.renderer.info.render;
    if (frames++ === 0) {
      game.renderer.render(game.scene, game.camera);
      first.calls = info.calls;
      first.triangles = info.triangles;
    } else {
      info.calls = first.calls;
      info.triangles = first.triangles;
    }
  };
} else {
  document.getElementById('loading')?.classList.add('done');
}
game.start();
game.markReady();

// ------------------------------------------------------------------------------------------

function addGround(l: SampleLayout): void {
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000, 120, 120).rotateX(-Math.PI / 2), // subdivided: huge triangles lose depth precision
    new THREE.MeshStandardMaterial({ color: night ? 0x3c4630 : 0x6d7a55, roughness: 0.97 }),
  );
  grass.position.y = -0.12;
  grass.receiveShadow = true;
  game.scene.add(grass);
  // lots: light soil / lawn under each parcel so setbacks read
  const lotGeo: THREE.BufferGeometry[] = [];
  for (const lot of l.lots) {
    const shape = new THREE.Shape(lot.polygon.map((p) => new THREE.Vector2(p.x, -p.z)));
    const g = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    g.translate(0, -0.03, 0);
    lotGeo.push(g);
  }
  const lotMat = new THREE.MeshStandardMaterial({ color: 0x7f8a5e, roughness: 0.95 });
  for (const g of paramBool("nolots") ? [] : lotGeo) {
    const m = new THREE.Mesh(g, lotMat);
    m.receiveShadow = true;
    game.scene.add(m);
  }
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x3a3b3d, roughness: 0.9 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.92 });
  const marking = new THREE.MeshStandardMaterial({ color: 0xd8d2b8, roughness: 0.8 });
  const addBox = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, mat: THREE.Material): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.receiveShadow = true;
    game.scene.add(m);
  };
  for (const s of l.streets) {
    addBox(s.x0, s.x1, s.z - s.half, s.z + s.half, -0.1, 0.02, asphalt);
    addBox(s.x0, s.x1, s.z - s.half - s.sidewalk, s.z - s.half, -0.1, 0.15, concrete);
    addBox(s.x0, s.x1, s.z + s.half, s.z + s.half + s.sidewalk, -0.1, 0.15, concrete);
    for (let x = s.x0 + 2; x < s.x1 - 3; x += 9) addBox(x, x + 3, s.z - 0.07, s.z + 0.07, 0.02, 0.025, marking);
  }
  for (const c of l.crossStreets) {
    addBox(c.x - c.half, c.x + c.half, c.z0, c.z1, -0.1, 0.021, asphalt);
    addBox(c.x - c.half - c.sidewalk, c.x - c.half, c.z0, c.z1, -0.1, 0.149, concrete);
    addBox(c.x + c.half, c.x + c.half + c.sidewalk, c.z0, c.z1, -0.1, 0.149, concrete);
  }
}

/** People (1.8 m) and cars on the sidewalks for judging scale. */
function addScaleProps(l: SampleLayout): void {
  const bodyGeo = new THREE.CapsuleGeometry(0.24, 1.3, 4, 8).translate(0, 0.9, 0);
  const carBody = new THREE.BoxGeometry(4.5, 0.75, 1.8).translate(0, 0.55, 0);
  const carCabin = new THREE.BoxGeometry(2.4, 0.6, 1.6).translate(-0.2, 1.2, 0);
  const cols = [0x2b2f3a, 0x6b2b2b, 0xd8d0c0, 0x3b5b3b, 0x1f3f6f, 0x8a6a3a];
  const carCols = [0xe8e8e8, 0x1b1b1d, 0x8a0f14, 0x2d4e7d, 0x9a9b9d, 0xc9b27a];
  let k = 0;
  for (const s of l.streets) {
    for (let x = s.x0 + 25; x < s.x1 - 25; x += 23) {
      k++;
      const side = k % 2 ? -1 : 1;
      const p = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: cols[k % cols.length], roughness: 0.8 }));
      p.position.set(x + (k % 3), 0.15, s.z + side * (s.half + s.sidewalk * 0.5));
      p.castShadow = true;
      game.scene.add(p);
      if (k % 2 === 0) {
        const mat = new THREE.MeshStandardMaterial({ color: carCols[k % carCols.length], roughness: 0.35, metalness: 0.5 });
        const car = new THREE.Group();
        car.add(new THREE.Mesh(carBody, mat), new THREE.Mesh(carCabin, new THREE.MeshStandardMaterial({ color: 0x151a20, roughness: 0.1, metalness: 0.6 })));
        car.position.set(x + 7, 0, s.z + side * (s.half - 1.4));
        car.traverse((o) => ((o as THREE.Mesh).castShadow = true));
        game.scene.add(car);
      }
    }
  }
}

/** Sky-derived environment map (ambient light and glass reflections) and a light humid haze. */
function addEnvironment(): void {
  game.environment.update(0, game.camera);
  // the sky environment map below provides the ambient light; the placeholder's hemisphere
  // light would add it a second time
  game.scene.traverse((o) => {
    if (o instanceof THREE.HemisphereLight) o.visible = false;
  });
  const sun = game.environment.sunDirection.clone();
  const sky = new Sky();
  sky.scale.setScalar(1000);
  const u = sky.material.uniforms;
  u.turbidity.value = 4;
  u.rayleigh.value = 1.2;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(sun);
  const envScene = new THREE.Scene();
  envScene.add(sky);
  if (night) {
    // city glow on the horizon at night
    const glow = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.MeshBasicMaterial({ color: 0x1a1410, side: THREE.BackSide }));
    envScene.add(glow);
  }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: night ? 0x050505 : 0x2c2d2b }));
  ground.position.y = -5;
  envScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(game.renderer);
  game.scene.environment = pmrem.fromScene(envScene, 0, 1, 2000).texture;
  // three's Sky is very bright; scale it to a plausible sky irradiance next to a 3.2 sun
  game.scene.environmentIntensity = paramNum('env', night ? 0.6 : 0.42);
  pmrem.dispose();
  game.scene.fog = night ? new THREE.FogExp2(0x0b0d14, 0.0009) : new THREE.FogExp2(0xb4c3d2, 0.00055);
}

function addHint(): void {
  const el = document.createElement('div');
  el.className = 'hint';
  el.innerHTML =
    '<b>Building showroom</b><br>' +
    'URL: <kbd>?spot=</kbd> ' + Object.keys(SPOTS).join(', ') + '<br>' +
    '<kbd>?night=1</kbd> <kbd>?lod=1</kbd> <kbd>?seed=2</kbd> <kbd>?hour=19</kbd><br>' +
    '<kbd>WASD</kbd> fly &nbsp; <kbd>F3</kbd> stats';
  document.body.appendChild(el);
}
