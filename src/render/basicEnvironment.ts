import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

/**
 * Minimal sky and sun used until the full atmosphere module (src/render/atmosphere)
 * takes over. Same interface, so the game can swap between them.
 */
export interface Environment {
  /** Hours since midnight, 0-24. */
  timeOfDay: number;
  readonly sunDirection: THREE.Vector3;
  update(dt: number, camera: THREE.Camera): void;
  dispose(): void;
}

export class BasicEnvironment implements Environment {
  timeOfDay: number;
  readonly sunDirection = new THREE.Vector3();
  private readonly sky = new Sky();
  private readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  private readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6b5a45, 1.2);

  constructor(private readonly scene: THREE.Scene, time = 16.5) {
    this.timeOfDay = time;
    this.sky.scale.setScalar(20000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    scene.add(this.sky, this.sun, this.sun.target, this.hemi);
    // Humid haze so the horizon fades out (placeholder until the atmosphere module).
    scene.fog = new THREE.FogExp2(0xc9d6df, 0.00022);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -150;
    cam.right = cam.top = 150;
    cam.near = 1;
    cam.far = 2000;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.5;
  }

  update(_dt: number, camera: THREE.Camera): void {
    // Simple sun arc: rises in the east at 6:00, highest at 12:00, sets in the west at 18:00.
    const t = ((this.timeOfDay - 6) / 12) * Math.PI;
    const elevation = Math.sin(t) * THREE.MathUtils.degToRad(70);
    const azimuth = t; // 0 = east, pi = west
    this.sunDirection.set(Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation), 0.35 * Math.cos(elevation)).normalize();
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDirection);
    const day = THREE.MathUtils.clamp(this.sunDirection.y * 4 + 0.2, 0, 1);
    this.sun.intensity = 3.2 * day;
    this.hemi.intensity = 0.15 + 1.1 * day;
    const p = camera.position;
    this.sun.position.set(p.x + this.sunDirection.x * 800, p.y + this.sunDirection.y * 800, p.z + this.sunDirection.z * 800);
    this.sun.target.position.copy(p);
    this.sky.position.copy(p);
  }

  dispose(): void {
    this.scene.fog = null;
    this.scene.remove(this.sky, this.sun, this.sun.target, this.hemi);
    this.sky.geometry.dispose();
    this.sky.material.dispose();
  }
}
