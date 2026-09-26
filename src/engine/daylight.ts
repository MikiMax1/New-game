// Sun and moon light from the sky: one directional key light with cascaded shadows (whichever
// of the sun or moon is brighter) plus image-based light from the sky's environment map.
import * as THREE from 'three';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import type { Quality } from '../core/quality';
import type { ExposedLights } from './lights';

/** What the key light needs from the sky (PhysicalSky provides it). */
export interface SkyLighting {
  readonly sunDirection: THREE.Vector3;
  readonly moonDirection: THREE.Vector3;
  /** Illuminance at the ground, lux. */
  readonly sunIlluminance: number;
  readonly moonIlluminance: number;
  readonly sunColor: THREE.Color;
  readonly moonColor: THREE.Color;
  readonly environment: THREE.Texture | null;
  /** Multiplier from the environment map's stored values to nits. */
  readonly environmentScale: number;
}

/** Shadow cameras sit this far (m) back from their cascade, so tall towers still cast. */
const LIGHT_MARGIN = 400;

export class Daylight {
  readonly light = new THREE.DirectionalLight();
  private csm: CSMShadowNode | null = null;
  private readonly projection = new THREE.Matrix4();
  private shadowKey = '';

  constructor(
    private readonly scene: THREE.Scene,
    private readonly sky: SkyLighting,
    private readonly lights: ExposedLights,
  ) {
    this.light.name = 'Key light';
    lights.add(this.light, 0);
    scene.add(this.light, this.light.target);
  }

  /** Shadow cascades, resolution and distance from the preset (recreates the shadow maps). */
  setQuality(q: Quality): void {
    const key = `${q.shadows}|${q.shadowCascades}|${q.shadowMapSize}|${q.shadowDistance}`;
    if (key === this.shadowKey) return;
    this.shadowKey = key;
    this.csm?.dispose();
    this.csm = null;
    const light = this.light;
    light.castShadow = q.shadows;
    if (!q.shadows) return;
    const shadow = light.shadow;
    shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    shadow.camera.near = 1;
    shadow.camera.far = LIGHT_MARGIN * 2 + q.shadowDistance;
    shadow.bias = -0.0002;
    shadow.normalBias = 0.02;
    shadow.radius = 2;
    const csm = new CSMShadowNode(light, { cascades: q.shadowCascades, maxFar: q.shadowDistance, mode: 'practical', lightMargin: LIGHT_MARGIN });
    csm.fade = true;
    shadow.shadowNode = csm;
    this.csm = csm;
    shadow.needsUpdate = true;
  }

  /** Points the key light and sets its illuminance; call every frame after the sky updated. */
  update(camera: THREE.PerspectiveCamera): void {
    const sky = this.sky;
    const sunKey = sky.sunIlluminance >= sky.moonIlluminance;
    const dir = sunKey ? sky.sunDirection : sky.moonDirection;
    const light = this.light;
    light.color.copy(sunKey ? sky.sunColor : sky.moonColor);
    this.lights.set(light, sunKey ? sky.sunIlluminance : sky.moonIlluminance);
    light.target.position.copy(camera.position);
    light.position.copy(camera.position).addScaledVector(dir, 100);
    light.target.updateMatrixWorld();
    // The cascades follow the camera's projection (the fly camera moves its near plane).
    if (this.csm?.camera && !this.projection.equals(camera.projectionMatrix)) {
      this.projection.copy(camera.projectionMatrix);
      this.csm.updateFrustums();
    }
  }

  /** Image-based light from the sky, scaled like every other light. */
  applyExposure(exposure: number): void {
    this.scene.environment = this.sky.environment;
    this.scene.environmentIntensity = this.sky.environmentScale * exposure;
  }

  dispose(): void {
    this.csm?.dispose();
    this.lights.remove(this.light);
    this.scene.remove(this.light, this.light.target);
  }
}
