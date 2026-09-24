import * as THREE from 'three';

export interface CascadeConfig {
  enabled: boolean;
  count: number;
  mapSize: number;
  /** Farthest distance (m) that gets shadows. */
  maxDistance: number;
}

/** Tallest expected shadow caster (m); sets how far toward the light each shadow camera reaches. */
const MAX_CASTER_HEIGHT = 260;
/** Split scheme blend between logarithmic (1) and uniform (0) splits. */
const SPLIT_LAMBDA = 0.86;
/** Radius padding of the far cascades so they can skip frames while the camera moves. */
const FAR_PADDING = 1.06;

const _forward = new THREE.Vector3();
const _center = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _up = new THREE.Vector3();

interface CascadeState {
  light: THREE.DirectionalLight;
  /** Sphere the shadow map was last rendered for (world space). */
  center: THREE.Vector3;
  radius: number;
  valid: boolean;
}

/**
 * Cascaded shadow maps for one directional key light, built from plain DirectionalLights so the
 * renderer's shadow system does the culling and rendering. Light 0 carries the key light's
 * colour; the others are black and only provide shadow maps (see shaders/csm.glsl.ts).
 *
 * Each cascade is fitted to the bounding sphere of its slice of the view frustum (its size does
 * not change when the camera turns), and the sphere centre is snapped to shadow-map texels in
 * light space, so shadows do not shimmer when the camera moves. The two nearest cascades update
 * every frame; the far ones alternate frames unless the view left their padded sphere.
 */
export class CascadedShadows {
  readonly group = new THREE.Group();
  /** Split distances (m) of the last update: [near, s1, ..., far]. */
  readonly splits: number[] = [];
  private cascades: CascadeState[] = [];
  private config: CascadeConfig = { enabled: true, count: 0, mapSize: 0, maxDistance: 0 };
  private frame = 0;
  private readonly lastLightDir = new THREE.Vector3();

  constructor() {
    this.group.name = 'SolmarCascadedShadows';
  }

  /** The key light (cascade 0); its colour and intensity light the scene. */
  get keyLight(): THREE.DirectionalLight {
    return this.cascades[0].light;
  }

  get count(): number {
    return this.cascades.length;
  }

  configure(config: CascadeConfig): void {
    const count = Math.max(1, Math.min(4, Math.round(config.count)));
    const prev = this.config;
    this.config = { ...config, count };
    if (count !== this.cascades.length) {
      const keep = this.cascades[0]?.light;
      for (let i = 0; i < this.cascades.length; i++) {
        const c = this.cascades[i];
        if (i > 0 || count === 0) {
          c.light.shadow.map?.dispose();
          this.group.remove(c.light, c.light.target);
        }
      }
      const next: CascadeState[] = [];
      for (let i = 0; i < count; i++) {
        const light = i === 0 && keep ? keep : new THREE.DirectionalLight(0xffffff, 0);
        light.name = `SolmarCascade${i}`;
        light.castShadow = true;
        light.shadow.autoUpdate = false;
        light.shadow.intensity = 1;
        light.shadow.radius = 1.6;
        const cam = light.shadow.camera;
        cam.up.set(0, 0, -1);
        this.group.add(light, light.target);
        next.push({ light, center: new THREE.Vector3(), radius: 0, valid: false });
      }
      this.cascades = next;
    }
    for (const c of this.cascades) {
      if (c.light.shadow.mapSize.x !== config.mapSize) {
        c.light.shadow.mapSize.set(config.mapSize, config.mapSize);
        c.light.shadow.map?.dispose();
        c.light.shadow.map = null;
        c.valid = false;
      }
    }
    if (prev.maxDistance !== config.maxDistance) this.invalidate();
  }

  invalidate(): void {
    for (const c of this.cascades) c.valid = false;
  }

  /**
   * Fits the cascades to the camera. `toLight` points from the scene toward the light.
   * Returns true when any shadow map needs rendering this frame.
   */
  update(camera: THREE.PerspectiveCamera, toLight: THREE.Vector3, active: boolean): boolean {
    this.frame++;
    const n = this.cascades.length;
    if (!active || !this.config.enabled) {
      // Idle (no key light): skip the shadow passes, but every cascade must own a depth map;
      // a shadow sampler without one makes three.js bind a colour texture, and every lit draw
      // call then fails. So a map that was never rendered (or was dropped by a quality change)
      // is still rendered once, with the current fit.
      let any = false;
      for (const c of this.cascades) {
        const missing = this.config.enabled && c.light.shadow.map === null;
        c.light.shadow.needsUpdate = missing;
        if (missing) c.valid = false;
        any ||= missing;
      }
      if (!any) return false;
    }

    // A light that turned more than ~0.02 deg forces all cascades (shadows crawl slightly
    // while time runs; far cascades never lag behind the near ones).
    const dirChanged = this.lastLightDir.dot(toLight) < 0.99999994;
    if (dirChanged) {
      this.lastLightDir.copy(toLight);
      this.invalidate();
    }

    // Split range: cameras high above the city see nothing in the first few hundred metres,
    // so the cascades start further out and reach further.
    const altitude = Math.max(0, camera.position.y);
    const nearEff = Math.max(camera.near, 0.6 * (altitude - 120));
    const splitNear = Math.max(nearEff, 3);
    const far = Math.min(camera.far, this.config.maxDistance + nearEff);
    this.splits.length = 0;
    this.splits.push(splitNear);
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const log = splitNear * Math.pow(far / splitNear, f);
      const uni = splitNear + (far - splitNear) * f;
      this.splits.push(SPLIT_LAMBDA * log + (1 - SPLIT_LAMBDA) * uni);
    }
    this.splits.push(far);

    // Light-space basis, matching Object3D.lookAt for the shadow cameras.
    _up.set(0, 0, -1);
    if (Math.abs(toLight.z) > 0.9) _up.set(1, 0, 0);
    _x.crossVectors(_up, toLight).normalize();
    _y.crossVectors(toLight, _x);

    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / camera.zoom;
    const tanX = tanY * camera.aspect;
    const k2 = tanX * tanX + tanY * tanY;
    camera.getWorldDirection(_forward);
    const sinElev = Math.max(0.06, toLight.y);
    const casterReach = Math.min(3000, MAX_CASTER_HEIGHT / sinElev);

    let any = false;
    for (let i = 0; i < n; i++) {
      const c = this.cascades[i];
      const near = i === 0 ? Math.min(splitNear, camera.near) : this.splits[i];
      const farI = this.splits[i + 1];
      // Minimal sphere around the frustum slice [near, farI].
      let cd = ((near + farI) / 2) * (1 + k2);
      let radius: number;
      if (cd >= farI) {
        cd = farI;
        radius = farI * Math.sqrt(k2);
      } else {
        radius = Math.sqrt((farI - cd) * (farI - cd) + farI * farI * k2);
      }
      const pad = i >= 2 ? FAR_PADDING : 1.0;
      const renderRadius = radius * pad;
      _center.copy(camera.position).addScaledVector(_forward, cd);

      // Near cascades every frame; far cascades on alternate frames if the view is still inside
      // the padded sphere they were rendered for.
      let needs = !c.valid || i < 2;
      if (!needs) {
        const due = (this.frame + i) % 2 === 0;
        const inside = c.center.distanceTo(_center) + radius <= c.radius;
        needs = due || !inside;
      }
      if (!needs) {
        c.light.shadow.needsUpdate = false;
        continue;
      }

      const texel = (2 * renderRadius) / this.config.mapSize;
      // Snap the centre to the texel grid in light space.
      const sx = _center.dot(_x);
      const sy = _center.dot(_y);
      _center.addScaledVector(_x, Math.round(sx / texel) * texel - sx);
      _center.addScaledVector(_y, Math.round(sy / texel) * texel - sy);

      const light = c.light;
      const back = renderRadius + casterReach;
      light.position.copy(_center).addScaledVector(toLight, back);
      light.target.position.copy(_center);
      light.updateMatrixWorld();
      light.target.updateMatrixWorld();
      const cam = light.shadow.camera;
      cam.left = -renderRadius;
      cam.right = renderRadius;
      cam.top = renderRadius;
      cam.bottom = -renderRadius;
      cam.near = 0.5;
      cam.far = back + renderRadius + 50;
      cam.updateProjectionMatrix();
      // Bias in world units: back faces are rendered into the map, so a small normal offset
      // (about one texel) handles thin double-sided geometry without visible peter-panning.
      light.shadow.normalBias = texel * 1.1;
      light.shadow.bias = -(texel * 0.4) / (cam.far - cam.near);
      light.shadow.needsUpdate = true;
      c.center.copy(_center);
      c.radius = renderRadius;
      c.valid = true;
      any = true;
    }
    return any;
  }

  dispose(): void {
    for (const c of this.cascades) {
      c.light.shadow.map?.dispose();
      c.light.dispose();
    }
    this.group.removeFromParent();
    this.cascades = [];
  }
}
