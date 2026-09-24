// Street props and vegetation test page.
//
//   dev/props.html                       lineup of every prop and variant (labelled rows)
//   dev/props.html?spot=royal            camera presets: lineup, furniture, tall, palms, royal,
//                                        coconut, sabal, oak, shrubs, street, beach, signal
//   dev/props.html?night=1               night preview (lamps, signals, lit panels, a few real lights)
//   dev/props.html?wind=1.2&t=10         wind strength and a fixed animation time (for screenshots)
//   dev/props.html?cam=x,y,z&look=x,y,z  free camera (handled by Game)
//   dev/props.html?detail=0.5            lower tessellation (far LOD set)
//
// Every prop is drawn with InstancedMesh (createPropInstances), so the wind shader, its
// per-instance phase and the swaying shadow depth materials are exercised instanced.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import '../src/style.css';
import { Game } from '../src/game';
import type { Environment } from '../src/render/basicEnvironment';
import { paramBool, paramNum, paramNums, paramStr } from '../src/core/params';
import {
  createPropInstances,
  createPropLibrary,
  placementMatrix,
  updatePropMaterials,
  yawToFace,
  type PropId,
  type PropPlacement,
} from '../src/render/props';

const NIGHT_SKY = new THREE.Color(0x0d1426);

/**
 * Test-page lighting: the same sun path as BasicEnvironment, but with a realistic sun / sky
 * balance, sky reflections (PMREM of the sky) for metal and glass, and a shadow frustum that
 * follows the view for crisp leaf shadows. The real atmosphere module replaces all of this.
 */
class PropsTestEnvironment implements Environment {
  timeOfDay = 16.5;
  readonly sunDirection = new THREE.Vector3();
  private readonly sky = new Sky();
  private readonly sun = new THREE.DirectionalLight(0xfff1e0, 3.3);
  private readonly hemi = new THREE.HemisphereLight(0xcfe0ff, 0x6b5f4c, 0.5);
  private readonly pmrem: THREE.PMREMGenerator;
  private env: THREE.WebGLRenderTarget | null = null;
  private envTime = -99;
  private readonly envScene = new THREE.Scene();
  private readonly envSky = new Sky();

  constructor(private readonly scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    for (const sky of [this.sky, this.envSky]) {
      const u = sky.material.uniforms;
      u.turbidity.value = 3.5;
      u.rayleigh.value = 1.3;
      u.mieCoefficient.value = 0.004;
      u.mieDirectionalG.value = 0.82;
    }
    this.sky.scale.setScalar(20000);
    this.envSky.scale.setScalar(1000);
    // No sun disc in the reflection probe: the directional light already carries the sun.
    this.envSky.material.uniforms.showSunDisc.value = 0;
    this.envScene.add(this.envSky);
    scene.add(this.sky, this.sun, this.sun.target, this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -75;
    cam.right = cam.top = 75;
    cam.near = 1;
    cam.far = 1500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.35;
  }

  update(_dt: number, camera: THREE.Camera): void {
    const t = ((this.timeOfDay - 6) / 12) * Math.PI;
    const elevation = Math.sin(t) * THREE.MathUtils.degToRad(70);
    this.sunDirection.set(Math.cos(t) * Math.cos(elevation), Math.sin(elevation), 0.35 * Math.cos(elevation)).normalize();
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDirection);
    const day = THREE.MathUtils.clamp(this.sunDirection.y * 4 + 0.2, 0, 1);
    this.sun.intensity = 3.3 * day;
    this.sun.color.setHSL(0.09, 0.6, THREE.MathUtils.lerp(0.72, 0.96, THREE.MathUtils.clamp(this.sunDirection.y * 2.5, 0, 1)));
    this.hemi.intensity = 0.1 + 0.36 * day;
    this.hemi.color.setHex(day > 0.1 ? 0xcfe0ff : 0x5a6a9a);
    // Night: the Sky shader goes black; show a dim, slightly orange-lit city sky instead.
    this.sky.visible = day > 0.02;
    this.scene.background = day > 0.02 ? null : NIGHT_SKY;
    // Shadow frustum centred ~35 m in front of the camera.
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const c = camera.position.clone().addScaledVector(fwd, 35);
    c.y = 0;
    const texel = 150 / 4096;
    c.x = Math.round(c.x / texel) * texel;
    c.z = Math.round(c.z / texel) * texel;
    this.sun.position.copy(c).addScaledVector(this.sunDirection, 600);
    this.sun.target.position.copy(c);
    this.sky.position.copy(camera.position);
    if (Math.abs(this.timeOfDay - this.envTime) > 0.25) {
      this.envTime = this.timeOfDay;
      this.envSky.material.uniforms.sunPosition.value.copy(this.sunDirection);
      this.env?.dispose();
      this.env = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 2000);
      this.scene.environment = this.env.texture;
      this.scene.environmentIntensity = 0.03 + 0.5 * day;
    }
  }

  dispose(): void {
    this.scene.remove(this.sky, this.sun, this.sun.target, this.hemi);
    this.env?.dispose();
    this.pmrem.dispose();
  }
}

const game = new Game(document.getElementById('app')!);
const night = paramBool('night') ? 1 : paramNum('nightAmount', 0);
if (!paramBool('basicenv')) game.setEnvironment(new PropsTestEnvironment(game.scene, game.renderer));
if (night > 0 && paramStr('time', '') === '') game.environment.timeOfDay = 21.25;
const detail = paramNum('detail', 1);
const windStrength = paramNum('wind', 0.7);
const windDir = paramNums('windDir') ?? [1, 0.35];
const fixedTime = paramStr('t', '') === '' ? null : paramNum('t', 0);

const lib = createPropLibrary({ detail });
const atlasView = paramStr('atlas', '');
if (atlasView) showAtlas(atlasView);
const placements: PropPlacement[] = [];
const labels: { text: string; x: number; z: number; w: number }[] = [];
const spots = new Map<string, { cam: THREE.Vector3; look: THREE.Vector3 }>();

// ---------------------------------------------------------------------------------------
// Ground: lawn, a sidewalk strip under the furniture row, a road stub and a beach.
const scene = game.scene;
function plane(w: number, d: number, x: number, z: number, y: number, color: number, rough = 0.95): THREE.Mesh {
  // Tessellated: huge two-triangle planes lose depth precision (roads 3 cm above the lawn
  // flicker under it in SwiftShader).
  const geo = new THREE.PlaneGeometry(w, d, Math.max(1, Math.ceil(w / 25)), Math.max(1, Math.ceil(d / 25))).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: rough }));
  m.position.set(x, y, z);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
if (!paramBool('noground')) plane(3000, 3000, 0, 0, 0, 0x5e6b45);

function person(x: number, z: number): void {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.36, 4, 10), new THREE.MeshStandardMaterial({ color: 0xff7a2f, roughness: 0.6 }));
  m.position.set(x, 0.9, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}

// ---------------------------------------------------------------------------------------
// Lineup rows (every variant, labelled). Props are turned (yaw = PI) so their fronts face +Z,
// towards the default cameras. A 1.8 m orange capsule at the left of each row gives scale.
function row(ids: PropId[], z: number, gap: number, minW = 1.2, sidewalk = false): { x0: number; x1: number; centers: Map<string, number> } {
  const items: { id: PropId; v: number; w: number }[] = [];
  for (const id of ids) {
    const list = lib.models.get(id);
    if (!list) continue;
    list.forEach((m, v) => items.push({ id, v, w: Math.max(minW, 2 * m.radius) }));
  }
  const total = items.reduce((s, it) => s + it.w + gap, -gap);
  let x = -total / 2;
  const centers = new Map<string, number>();
  let depth = 0;
  for (const it of items) {
    const cx = x + it.w / 2;
    const r = lib.models.get(it.id)![it.v].radius;
    placements.push({ id: it.id, variant: it.v, x: cx, y: sidewalk ? 0.15 : 0, z, yaw: Math.PI });
    labels.push({ text: `${it.id} ${it.v}`, x: cx, z: z + Math.max(1.0, Math.min(r, 3)) + 0.9, w: Math.min(4, Math.max(1.6, it.w * 0.9)) });
    centers.set(`${it.id}#${it.v}`, cx);
    depth = Math.max(depth, Math.min(r, 3));
    x += it.w + gap;
  }
  if (sidewalk) plane(total + 6, 2 * depth + 5, 0, z + 1, 0.15, 0xbab6ad, 0.9);
  person(-total / 2 - 1.5, z);
  return { x0: -total / 2, x1: total / 2, centers };
}

const ROW = { small: 0, signs: -10, lights: -24, signals: -42, palms: -66, shrubs: -88, oaks: -120 };
row(['fireHydrant', 'bollard', 'parkingMeter', 'newspaperBox', 'trashCan', 'bench'], ROW.small, 0.8, 0.8, true);
row(['stopSign', 'streetNameSign', 'pedSignal', 'acUnit', 'dumpster', 'lounger', 'beachUmbrella'], ROW.signs, 0.8, 0.8, true);
row(['streetLightCobra', 'streetLightDeco', 'utilityPole', 'busShelter'], ROW.lights, 1.5, 1.2, true);
row(['trafficSignalMast', 'lifeguardTower'], ROW.signals, 1.5);
const palms = row(['palmRoyal', 'palmCoconut', 'palmSabal'], ROW.palms, 1.5);
row(['shrub', 'hedge', 'grassClump'], ROW.shrubs, 0.8, 1);
row(['liveOak'], ROW.oaks, 3);

spots.set('lineup', { cam: new THREE.Vector3(0, 4, 18), look: new THREE.Vector3(0, 3, 0) });
spots.set('overview', { cam: new THREE.Vector3(0, 38, 52), look: new THREE.Vector3(0, 2, -58) });
spots.set('furniture', { cam: new THREE.Vector3(0, 2.4, 14), look: new THREE.Vector3(0, 0.5, ROW.small) });
spots.set('signs', { cam: new THREE.Vector3(0, 2.6, ROW.signs + 15), look: new THREE.Vector3(0, 1.2, ROW.signs) });
spots.set('tall', { cam: new THREE.Vector3(0, 5, ROW.lights + 24), look: new THREE.Vector3(0, 4.5, ROW.lights) });
spots.set('signals', { cam: new THREE.Vector3(-4, 3.5, ROW.signals + 26), look: new THREE.Vector3(-4, 4.5, ROW.signals) });
spots.set('palms', { cam: new THREE.Vector3(0, 4, ROW.palms + 36), look: new THREE.Vector3(0, 9, ROW.palms) });
spots.set('shrubs', { cam: new THREE.Vector3(0, 2.4, ROW.shrubs + 9), look: new THREE.Vector3(0, 0.7, ROW.shrubs) });
spots.set('oak', { cam: new THREE.Vector3(0, 4, ROW.oaks + 42), look: new THREE.Vector3(0, 6.5, ROW.oaks) });
spots.set('oakClose', { cam: new THREE.Vector3(-6, 1.7, ROW.oaks + 13), look: new THREE.Vector3(0, 7, ROW.oaks) });
for (const [id, name] of [['palmRoyal', 'royal'], ['palmCoconut', 'coconut'], ['palmSabal', 'sabal']] as const) {
  const cx = palms.centers.get(`${id}#1`) ?? palms.centers.get(`${id}#0`);
  const m = lib.models.get(id)?.[1] ?? lib.models.get(id)?.[0];
  if (cx === undefined || !m) continue;
  const z = ROW.palms;
  spots.set(name, { cam: new THREE.Vector3(cx + m.height * 0.25, 1.7, z + m.height * 0.7), look: new THREE.Vector3(cx, m.height * 0.62, z) });
  spots.set(`${name}Crown`, { cam: new THREE.Vector3(cx + 7, m.height - 2.5, z + 9), look: new THREE.Vector3(cx, m.height - 2.8, z) });
}


// ---------------------------------------------------------------------------------------
// Street scene (x 120..260): a 4-lane avenue along X, sidewalks, royal palms, cobra lights,
// a signalised cross street at x = 240 with mast arms, bus shelter and furniture.
const SX = 120;
{
  plane(150, 14, SX + 70, 0, 0.03, 0x3b3d40, 0.9); // avenue (z -7..7)
  plane(14, 60, SX + 120, 0, 0.031, 0x3b3d40, 0.9); // cross street (x 233..247)
  plane(150, 4, SX + 70, 9, 0.16, 0xbdb9b0, 0.92); // south sidewalk z 7..11
  plane(150, 4, SX + 70, -9, 0.16, 0xbdb9b0, 0.92); // north sidewalk
  // Lane markings.
  for (let x = SX; x < SX + 110; x += 9) {
    plane(4, 0.15, x, 0, 0.035, 0xe8d36a, 0.6);
    plane(3, 0.12, x, -3.5, 0.035, 0xf2f2ee, 0.6);
    plane(3, 0.12, x, 3.5, 0.035, 0xf2f2ee, 0.6);
  }
  for (let i = 0; i < 8; i++) plane(0.5, 12, SX + 108 + i * 0.9 - 3, 0, 0.036, 0xf2f2ee, 0.6); // crosswalk
  const y = 0.16;
  for (let i = 0; i < 11; i++) {
    const x = SX + 4 + i * 10;
    placements.push({ id: 'palmRoyal', variant: i % 3, x, y, z: 9.6, scale: 0.95 + 0.1 * ((i * 7) % 5) / 4, yaw: i * 1.7 });
    if (i % 3 === 1) placements.push({ id: 'palmRoyal', variant: (i + 1) % 3, x: x + 3, y, z: -9.6, yaw: i });
  }
  for (let i = 0; i < 4; i++) {
    placements.push({ id: 'streetLightCobra', variant: i % 2, x: SX + 9 + i * 30, y, z: 7.6, yaw: yawToFace(0, -1) });
    placements.push({ id: 'streetLightCobra', variant: (i + 1) % 2, x: SX + 24 + i * 30, y, z: -7.6, yaw: yawToFace(0, 1) });
  }
  // Signal mast arms on the far-right corners. Arms reach along local +X, heads face local -Z:
  // eastbound (+X) traffic: SE corner, arm over the avenue towards -Z, heads face west (yaw pi/2);
  // westbound: NW corner, arm towards +Z, heads face east (yaw -pi/2);
  // southbound on the cross street: SW corner, arm towards +X, heads face north (yaw 0).
  placements.push({ id: 'trafficSignalMast', variant: 1, x: SX + 128, y, z: 7.8, yaw: Math.PI / 2 });
  placements.push({ id: 'trafficSignalMast', variant: 0, x: SX + 112, y, z: -7.8, yaw: -Math.PI / 2 });
  placements.push({ id: 'trafficSignalMast', variant: 2, x: SX + 112, y, z: 7.8, yaw: 0 });
  placements.push({ id: 'pedSignal', variant: 1, x: SX + 111, y, z: 10.4, yaw: yawToFace(0, -1) });
  placements.push({ id: 'streetNameSign', variant: 0, x: SX + 110.5, y, z: 10.6 });
  placements.push({ id: 'busShelter', variant: 0, x: SX + 60, y, z: 9.9, yaw: yawToFace(0, -1) });
  placements.push({ id: 'bench', variant: 0, x: SX + 40, y, z: 10.3, yaw: yawToFace(0, -1) });
  placements.push({ id: 'trashCan', variant: 0, x: SX + 43, y, z: 10.3 });
  placements.push({ id: 'trashCan', variant: 2, x: SX + 66, y, z: 10.4 });
  placements.push({ id: 'fireHydrant', variant: 0, x: SX + 30, y, z: 7.7, yaw: yawToFace(0, -1) });
  placements.push({ id: 'fireHydrant', variant: 1, x: SX + 85, y, z: -7.7, yaw: yawToFace(0, 1) });
  for (let i = 0; i < 3; i++) placements.push({ id: 'newspaperBox', variant: i, x: SX + 73 + i * 0.62, y, z: 10.4, yaw: yawToFace(0, -1) });
  for (let i = 0; i < 5; i++) placements.push({ id: 'parkingMeter', variant: i % 2, x: SX + 20 + i * 7, y, z: -7.6, yaw: yawToFace(0, 1) });
  placements.push({ id: 'stopSign', variant: 0, x: SX + 2, y, z: -10.5, yaw: yawToFace(-1, 0) });
  placements.push({ id: 'bollard', variant: 0, x: SX + 100, y, z: 7.5 });
  placements.push({ id: 'bollard', variant: 0, x: SX + 101.5, y, z: 7.5 });
  for (let i = 0; i < 5; i++) placements.push({ id: 'utilityPole', variant: i % 3, x: SX + 5 + i * 35, y: 0, z: -14.5, yaw: 0 });
  for (let i = 0; i < 14; i++) placements.push({ id: 'hedge', variant: i % 2, x: SX + 4 + i * 3.2, y: 0, z: 13.2 });
  for (let i = 0; i < 6; i++) placements.push({ id: 'shrub', variant: i % 3, x: SX + 52 + i * 2.2, y: 0, z: 13.4 });
  placements.push({ id: 'liveOak', variant: 0, x: SX + 30, y: 0, z: -30 });
  placements.push({ id: 'acUnit', variant: 0, x: SX + 90, y: 0, z: 13.0 });
  placements.push({ id: 'dumpster', variant: 0, x: SX + 96, y: 0, z: 14.2 });
  person(SX + 45, 9.8);
  person(SX + 62, 10.6);
  spots.set('street', { cam: new THREE.Vector3(SX + 2, 1.7, 5.5), look: new THREE.Vector3(SX + 60, 4, 2) });
  spots.set('signal', { cam: new THREE.Vector3(SX + 80, 1.6, -3.2), look: new THREE.Vector3(SX + 112, 5, 0) });
}

// ---------------------------------------------------------------------------------------
// Beach scene (x -260..-120): sand, sea, lifeguard tower, umbrellas and loungers, coconut
// palms leaning seaward, sabal palms and dune grass on the dune line, deco lamps.
const BX = -320;
{
  plane(160, 60, BX, -10, 0.025, 0xd9c7a0, 1.0); // sand z -40..20
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(260, 400, 10, 16).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1f6f86, roughness: 0.12, metalness: 0.1 }));
  sea.position.set(BX, 0.04, -240);
  scene.add(sea);
  plane(160, 3, BX, 21.5, 0.05, 0xc9c3b5, 0.9); // promenade
  placements.push({ id: 'lifeguardTower', variant: 1, x: BX + 5, y: 0.02, z: -18, yaw: 0 });
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 2; j++) {
      const x = BX - 30 + i * 6 + j * 2;
      const z = -10 - j * 5;
      placements.push({ id: 'beachUmbrella', variant: (i + j) % 3, x, y: 0.02, z, yaw: i * 0.7 });
      placements.push({ id: 'lounger', variant: (i + j) % 3, x: x - 0.9, y: 0.02, z: z + 1.4, yaw: 0.1 * (i % 3) });
      placements.push({ id: 'lounger', variant: (i + j + 1) % 3, x: x + 0.9, y: 0.02, z: z + 1.4, yaw: -0.1 * (i % 2) });
    }
  }
  for (let i = 0; i < 9; i++) {
    placements.push({ id: 'palmCoconut', variant: i % 4, x: BX - 50 + i * 12 + ((i * 5) % 3), y: 0.02, z: 10 + ((i * 7) % 5), yaw: Math.PI + (i % 3) * 0.4 });
  }
  for (let i = 0; i < 5; i++) placements.push({ id: 'palmSabal', variant: i % 3, x: BX + 20 + i * 9, y: 0.02, z: 16 });
  for (let i = 0; i < 60; i++) {
    const x = BX - 60 + ((i * 37) % 120);
    const z = 5 + ((i * 13) % 12);
    placements.push({ id: 'grassClump', variant: 1 + (i % 2), x, y: 0.02, z, yaw: i, scale: 0.8 + ((i * 7) % 5) * 0.1 });
  }
  for (let i = 0; i < 6; i++) placements.push({ id: 'streetLightDeco', variant: i % 2, x: BX - 50 + i * 20, y: 0.05, z: 23.2, yaw: yawToFace(0, -1) });
  for (let i = 0; i < 8; i++) placements.push({ id: 'bollard', variant: 1, x: BX - 8 + i * 2, y: 0.05, z: 20 });
  person(BX + 1, -14);
  person(BX - 20, -8);
  spots.set('beach', { cam: new THREE.Vector3(BX - 18, 2.2, -30), look: new THREE.Vector3(BX - 5, 4, 8) });
}

// ---------------------------------------------------------------------------------------
const props = createPropInstances(lib, placements);
scene.add(props);
addLabels();

const spot = spots.get(paramStr('spot', paramNums('cam') ? '' : 'lineup'));
if (spot) game.fly.lookAt(spot.cam, spot.look);
if (night > 0) addNightLights();

let t = fixedTime ?? 0;
const wind = { direction: new THREE.Vector2(windDir[0], windDir[1] ?? 0), strength: windStrength };
game.add({
  update(dt) {
    if (fixedTime === null) t += dt;
    updatePropMaterials(lib.materials, t, wind, night);
  },
});
updatePropMaterials(lib.materials, t, wind, night);

// Stats for tools and the F3 overlay.
let tris = 0, instances = 0, meshes = 0;
props.traverse((o) => {
  const m = o as THREE.InstancedMesh;
  if (!m.isInstancedMesh) return;
  meshes++;
  instances += m.count;
  tris += (m.geometry.index!.count / 3) * m.count;
});
game.overlay.addProvider(() => `props: ${placements.length} placements, ${meshes} instanced meshes, ${(tris / 1e6).toFixed(2)} M prop triangles`);
console.log(`props page: ${placements.length} placements, ${meshes} instanced meshes, ${instances} instances, ${tris} triangles`);

document.getElementById('loading')?.remove();
game.start();
game.markReady();

// ---------------------------------------------------------------------------------------
function addLabels(): void {
  if (paramBool('nolabels')) return;
  for (const l of labels) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(20, 22, 26, 0.72)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(l.text, c.width / 2, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const h = l.w * (96 / 512);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(l.w, h).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
    m.position.set(l.x, 0.06, l.z);
    scene.add(m);
  }
}

function addNightLights(): void {
  // A few real spot lights at street-light heads near the street / beach cameras.
  const m4 = new THREE.Matrix4();
  let n = 0;
  const maxLights = paramNum('lights', 10);
  // The lamps nearest to the camera get real lights (the rest only glow).
  const cam = game.camera.position;
  const lamps = placements
    .filter((p) => p.id === 'streetLightCobra' || p.id === 'streetLightDeco')
    .sort((a, b) => Math.hypot(a.x - cam.x, a.z - cam.z) - Math.hypot(b.x - cam.x, b.z - cam.z));
  for (const p of lamps) {
    if (n >= maxLights) break;
    const model = lib.models.get(p.id)?.[(p.variant ?? 0) % (lib.models.get(p.id)?.length ?? 1)];
    const l = model?.lights?.[0];
    if (!l) continue;
    placementMatrix(p, m4);
    const pos = l.position.clone().applyMatrix4(m4);
    const light = new THREE.SpotLight(l.color, l.intensity, 45, 1.15, 0.6, 2);
    light.position.copy(pos);
    light.target.position.set(pos.x, 0, pos.z);
    scene.add(light, light.target);
    n++;
  }
}

/** Debug: ?atlas=palmLeaf|oakLeaf|palmTrunk|signFace|... shows a material's map full screen. */
function showAtlas(key: string): void {
  const mat = lib.materials.get(key) as THREE.MeshStandardMaterial | undefined;
  const map = mat?.map;
  if (!map) return;
  const img = map.image as { width: number; height: number };
  const aspect = img.width / img.height;
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2 * aspect, 2), new THREE.MeshBasicMaterial({ color: paramBool('dark') ? 0x202020 : 0xd8dde0 }));
  const fg = new THREE.Mesh(new THREE.PlaneGeometry(2 * aspect, 2), new THREE.MeshBasicMaterial({ map, transparent: false, alphaTest: 0.5, toneMapped: false }));
  const s = new THREE.Scene();
  s.add(bg, fg);
  fg.position.z = 0.01;
  const cam = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, -10, 10);
  const zoom = paramNums('zoom');
  if (zoom && zoom.length === 3) {
    cam.zoom = zoom[2];
    cam.position.set((zoom[0] * 2 - 1) * aspect, zoom[1] * 2 - 1, 0);
    cam.updateProjectionMatrix();
  }
  game.renderFn = () => {
    const w = game.renderer.domElement.width, h = game.renderer.domElement.height;
    const va = w / h;
    cam.left = -Math.max(aspect, va);
    cam.right = Math.max(aspect, va);
    cam.top = Math.max(1, aspect / va);
    cam.bottom = -cam.top;
    cam.updateProjectionMatrix();
    game.renderer.render(s, cam);
  };
}

