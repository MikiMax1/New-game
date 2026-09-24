import * as THREE from 'three';
import type { Input } from './input';

/**
 * Free-fly camera for exploring the map before gameplay exists.
 * WASD move, Space/E up, Ctrl/Q down, Shift faster, mouse wheel changes speed.
 */
export class FlyCamera {
  yaw = 0; // radians, 0 looks north (-Z)
  pitch = 0; // radians, positive looks up
  speed = 40; // m/s
  /** Optional ground height lookup so the camera never goes below ground. */
  groundHeight: ((x: number, z: number) => number) | null = null;
  minClearance = 1.6;

  constructor(readonly camera: THREE.PerspectiveCamera) {
    camera.rotation.order = 'YXZ';
  }

  setPose(pos: THREE.Vector3, yaw: number, pitch: number): void {
    this.camera.position.copy(pos);
    this.yaw = yaw;
    this.pitch = pitch;
    this.apply();
  }

  lookAt(pos: THREE.Vector3, target: THREE.Vector3): void {
    const d = target.clone().sub(pos);
    const yaw = Math.atan2(-d.x, -d.z);
    const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    this.setPose(pos, yaw, pitch);
  }

  update(dt: number, input: Input): void {
    if (input.locked) {
      this.yaw -= input.mouseDX * 0.0022;
      this.pitch -= input.mouseDY * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.55, 1.55);
    }
    if (input.wheel !== 0) {
      this.speed = THREE.MathUtils.clamp(this.speed * Math.pow(1.25, -input.wheel), 2, 2000);
    }
    // Arrow keys also turn, so the map can be explored without pointer lock.
    const turn = 1.6 * dt;
    if (input.isDown('ArrowLeft')) this.yaw += turn;
    if (input.isDown('ArrowRight')) this.yaw -= turn;
    if (input.isDown('ArrowUp')) this.pitch = Math.min(1.55, this.pitch + turn * 0.6);
    if (input.isDown('ArrowDown')) this.pitch = Math.max(-1.55, this.pitch - turn * 0.6);

    const forward = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = new THREE.Vector3();
    if (input.isDown('KeyW')) move.add(forward);
    if (input.isDown('KeyS')) move.sub(forward);
    if (input.isDown('KeyD')) move.add(right);
    if (input.isDown('KeyA')) move.sub(right);
    if (input.isDown('Space') || input.isDown('KeyE')) move.y += 1;
    if (input.isDown('ControlLeft') || input.isDown('KeyQ')) move.y -= 1;
    if (move.lengthSq() > 0) {
      const boost = input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? 5 : 1;
      move.normalize().multiplyScalar(this.speed * boost * dt);
      this.camera.position.add(move);
    }
    this.apply();
  }

  private apply(): void {
    const p = this.camera.position;
    if (this.groundHeight) {
      const g = this.groundHeight(p.x, p.z);
      if (p.y < g + this.minClearance) p.y = g + this.minClearance;
      // Push the near plane out when high above the ground: far more depth
      // precision for aerial views, no visible clipping.
      const altitude = Math.max(0, p.y - g);
      const near = THREE.MathUtils.clamp(altitude * 0.02, 0.25, 12);
      if (Math.abs(near - this.camera.near) > 0.01) {
        this.camera.near = near;
        this.camera.updateProjectionMatrix();
      }
    }
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
