// Atmosphere, lighting and post-processing test page.
//
//   dev/atmosphere.html?time=17.5&cam=x,y,z&look=x,y,z
// Extra parameters: day (1..365), clouds (0..1), haze (multiplier), post=0 (no post-processing),
// tm=agx|aces|neutral (tone mapping), csm=1 (tint shadow cascades), quality=low|medium|high|ultra.
import * as THREE from 'three';
import '../src/style.css';
import { Game } from '../src/game';
import type { Quality } from '../src/core/quality';
import { isCapture, paramBool, paramNum, paramStr } from '../src/core/params';
import { Atmosphere } from '../src/render/atmosphere';
import { PostFX, type ToneMappingName } from '../src/render/post';
import { Rng } from '../src/world/rng';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const game = new Game(document.getElementById('app')!);

const atmosphere = new Atmosphere(game.renderer, game.scene, game.camera, game.quality, {
  dayOfYear: paramNum('day', 268),
  clouds: paramNum('clouds', 0.26),
  haze: paramNum('haze', 1),
  debugCascades: paramBool('csm'),
});
game.setEnvironment(atmosphere);

// Per-effect overrides for testing: ao=0, bloom=0, smaa=0.
const postQuality = (q: Quality): Quality => ({
  ...q,
  ao: q.ao && paramBool('ao', true),
  bloom: q.bloom && paramBool('bloom', true),
  antialias: paramBool('smaa', true) ? q.antialias : 'none',
});
const post = paramBool('post', true)
  ? new PostFX(game.renderer, game.scene, game.camera, postQuality(game.quality), { toneMapping: paramStr('tm', 'agx') as ToneMappingName })
  : null;
if (post) {
  game.renderFn = () => {
    post.scotopic = atmosphere.nightFactor;
    post.render();
  };
} else {
  game.renderer.toneMapping = THREE.AgXToneMapping;
}
game.onQualityChange((q) => {
  post?.setQuality(postQuality(q));
  atmosphere.setQuality(q);
});

buildScene(game.scene);

game.overlay.addProvider(() => {
  const a = atmosphere;
  return [
    `sun ${a.sunElevation.toFixed(1)}°  moon ${a.moonElevation.toFixed(1)}°  night ${a.nightFactor.toFixed(2)}`,
    `exposure ${a.exposure.toExponential(2)}  light scale ${a.lightScale.toFixed(1)}  key ${a.keyLight.intensity.toFixed(3)}`,
    `cascades ${a.cascadeSplits.map((s) => s.toFixed(0)).join(' / ')} m  env updates ${a.environmentUpdates}`,
  ];
});

// ?log=1: print per-frame timings to the console (SHOOT_VERBOSE=1 node tools/shoot.mjs ...).
if (paramBool('log')) {
  let last = performance.now();
  let frames = 0;
  game.add({
    update: () => {
      const now = performance.now();
      const info = game.renderer.info.render;
      console.log(`frame ${frames++}: ${(now - last).toFixed(0)} ms, calls ${info.calls}, tris ${info.triangles}`);
      last = now;
    },
  });
}

const loading = document.getElementById('loading');
if (isCapture) loading?.remove();
atmosphere.onReady(() => {
  loading?.classList.add('done');
  game.markReady();
  if (paramBool('log')) {
    const a = atmosphere;
    console.log(
      `sun ${a.sunElevation.toFixed(2)} deg, sun E ${a.sunIntensity.toFixed(3)} (${a.sunColor.getHexString()}), ` +
        `sky E ${a.ambientIntensity.toFixed(3)} (${a.ambientColor.getHexString()}), key ${a.keyLight.intensity.toFixed(4)}, ` +
        `lightScale ${a.lightScale.toFixed(2)}, exposure ${a.exposure.toExponential(3)}, display ${a.displayExposure.toFixed(3)}, night ${a.nightFactor.toFixed(2)}`,
    );
  }
});
game.start();

// Screenshot tool: once the frame is ready, stop rendering so the capture never waits behind a
// slow software-rendered frame (the canvas keeps showing the last frame).
if (isCapture) {
  const stopWhenReady = () => {
    if (window.__READY) game.renderer.setAnimationLoop(null);
    else requestAnimationFrame(stopWhenReady);
  };
  requestAnimationFrame(stopWhenReady);
}

// -----------------------------------------------------------------------------------------------
// Test scene: ~3 km of flat coastal city stand-ins with the sea to the east.
// -----------------------------------------------------------------------------------------------

function buildScene(scene: THREE.Scene): void {
  const rng = new Rng('atmosphere-test');
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

  const add = (mesh: THREE.Mesh, cast = true, receive = true) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    scene.add(mesh);
    return mesh;
  };

  // Land (west) and sea (east). The coast runs north-south at x = 700.
  const grass = new THREE.MeshStandardMaterial({ color: 0x55653d, roughness: 0.95 });
  add(new THREE.Mesh(new THREE.PlaneGeometry(3400, 5000).rotateX(-Math.PI / 2).translate(-1000, 0.3, 0), grass), false);
  const sand = new THREE.MeshStandardMaterial({ color: 0xcdbb94, roughness: 0.92 });
  add(new THREE.Mesh(new THREE.PlaneGeometry(90, 5000).rotateX(-Math.PI / 2).translate(690, 0.35, 0), sand), false);
  const sea = new THREE.MeshStandardMaterial({ color: 0x0b2630, roughness: 0.09, metalness: 0 });
  add(new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2).translate(20700, 0, 0), sea), false);

  // Asphalt: an east-west avenue to the beach and a north-south boulevard, with sidewalks.
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.88 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9a968e, roughness: 0.9 });
  add(new THREE.Mesh(new THREE.PlaneGeometry(2300, 16).rotateX(-Math.PI / 2).translate(-500, 0.36, 0), asphalt), false);
  add(new THREE.Mesh(new THREE.PlaneGeometry(16, 2600).rotateX(-Math.PI / 2).translate(0, 0.37, -300), asphalt), false);
  for (const s of [-1, 1]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(2300, 0.15, 4).translate(-500, 0.44, s * 10), concrete), false);
    add(new THREE.Mesh(new THREE.BoxGeometry(4, 0.15, 2600).translate(s * 10, 0.44, -300), concrete), false);
  }

  // Pastel stucco blocks along the streets.
  const pastels = [0xf2c9c0, 0xbfe3d6, 0xf6e2b3, 0xd9cdea, 0xf4efe6, 0xf3d1a8, 0xc9dff0, 0xe9b8c9];
  const stucco = pastels.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
  const building = (x: number, z: number, w: number, d: number, h: number, mat: THREE.Material) => {
    const m = add(new THREE.Mesh(box, mat));
    m.scale.set(w, h, d);
    m.position.set(x, 0.3, z);
    return m;
  };
  for (let i = 0; i < 26; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const x = -620 + i * 48 + rng.range(-6, 6);
    if (Math.abs(x) < 40) continue;
    building(x, side * rng.range(24, 30), rng.range(22, 34), rng.range(14, 22), rng.range(7, 22), rng.pick(stucco));
  }
  for (let i = 0; i < 16; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const z = -1000 + i * 70 + rng.range(-8, 8);
    if (Math.abs(z) < 50) continue;
    building(side * rng.range(26, 34), z, rng.range(16, 22), rng.range(24, 36), rng.range(8, 30), rng.pick(stucco));
  }

  // Landmark towers near the crossing.
  const glass = new THREE.MeshStandardMaterial({ color: 0x4f6474, metalness: 1, roughness: 0.05 });
  building(120, -90, 42, 32, 150, glass);
  const white = new THREE.MeshStandardMaterial({ color: 0xefeee8, roughness: 0.8 });
  building(-70, 70, 30, 30, 60, white);
  const concreteTower = new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.85 });

  // A distant skyline 1.2-3 km away: haze and far shadows.
  for (let i = 0; i < 34; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(1100, 3000);
    const x = Math.min(560, Math.cos(a) * r);
    const z = Math.sin(a) * r;
    const h = rng.range(35, 170);
    const mat = rng.chance(0.3) ? glass : rng.chance(0.5) ? concreteTower : rng.pick(stucco);
    building(x, z, rng.range(30, 60), rng.range(30, 60), h, mat);
  }
  // A cluster downtown to the south-west.
  for (let i = 0; i < 14; i++) {
    building(-420 + rng.range(-160, 160), 380 + rng.range(-140, 140), rng.range(28, 44), rng.range(28, 44), rng.range(50, 130), rng.chance(0.4) ? glass : rng.pick([concreteTower, white, ...stucco]));
  }

  // Reference spheres by the avenue: mirror chrome and 18% grey.
  const sphere = new THREE.SphereGeometry(1.2, 48, 24).translate(0, 1.5, 0);
  add(new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.02 }))).position.set(-150, 0.3, -5.5);
  add(new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.9 }))).position.set(-150, 0.3, -9.5);

  // Palms: instanced trunks and crowns of drooping fronds (2 draw calls per pass).
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8c7a62, roughness: 0.9 });
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x3d5a2a, roughness: 0.8, side: THREE.DoubleSide });
  const fronds: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 8; k++) {
    const f = new THREE.ConeGeometry(0.9, 5.2, 4, 1, true).rotateX(Math.PI / 2).translate(0, 0, 2.4);
    f.scale(1, 0.25, 1);
    f.rotateX(0.35 + (k % 3) * 0.12);
    f.rotateY((k / 8) * Math.PI * 2);
    fronds.push(f.toNonIndexed());
  }
  const crownGeo = mergeGeometries(fronds)!;
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1, 8).translate(0, 0.5, 0);
  const palmSpots: [number, number][] = [];
  const palm = (x: number, z: number) => palmSpots.push([x, z]);
  for (let i = 0; i < 18; i++) palm(-380 + i * 34, 14);
  for (let i = 0; i < 14; i++) palm(-14, -520 + i * 38);
  for (let i = 0; i < 12; i++) palm(660 + rng.range(-15, 15), -300 + i * 50);

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, frondMat, palmSpots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  palmSpots.forEach(([x, z], i) => {
    const h = rng.range(11, 17);
    const lean = rng.range(-0.07, 0.07);
    e.set(rng.range(-0.03, 0.03), 0, lean);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, 0.3, z), q, new THREE.Vector3(1, h, 1));
    trunks.setMatrixAt(i, m);
    const top = new THREE.Vector3(0, h, 0).applyQuaternion(q);
    e.set(0, rng.range(0, Math.PI * 2), 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x + top.x, 0.3 + top.y, z + top.z), q, new THREE.Vector3(1, 1, 1).multiplyScalar(rng.range(0.85, 1.15)));
    crowns.setMatrixAt(i, m);
  });
  add(trunks);
  add(crowns);
}
