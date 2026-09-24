import * as THREE from 'three';
import { cloudPassFragment, skyFragment, skyVertex } from './shaders/sky.glsl';

export interface SkyUniforms {
  [name: string]: THREE.IUniform;
  skyViewLut: THREE.IUniform<THREE.Texture | null>;
  transmittanceLut: THREE.IUniform<THREE.Texture | null>;
  noiseTex: THREE.IUniform<THREE.Texture | null>;
  cloudBuffer: THREE.IUniform<THREE.Texture | null>;
  cloudBufferSize: THREE.IUniform<THREE.Vector2>;
  cloudBufferTexel: THREE.IUniform<THREE.Vector2>;
  lutScale: THREE.IUniform<number>;
  cameraRadius: THREE.IUniform<number>;
  cameraHeight: THREE.IUniform<number>;
  horizonElev: THREE.IUniform<number>;
  sunDir: THREE.IUniform<THREE.Vector3>;
  sunDiskRadiance: THREE.IUniform<THREE.Vector3>;
  sunCosRadius: THREE.IUniform<number>;
  moonDir: THREE.IUniform<THREE.Vector3>;
  moonDiskRadiance: THREE.IUniform<THREE.Vector3>;
  moonCosRadius: THREE.IUniform<number>;
  starScale: THREE.IUniform<number>;
  pixelAngle: THREE.IUniform<number>;
  time: THREE.IUniform<number>;
  hazeA: THREE.IUniform<THREE.Vector4>;
  hazeRayleigh: THREE.IUniform<THREE.Vector3>;
  groundRadiance: THREE.IUniform<THREE.Vector3>;
  cloudA: THREE.IUniform<THREE.Vector4>;
  cloudB: THREE.IUniform<THREE.Vector4>;
  cloudLightDir: THREE.IUniform<THREE.Vector3>;
  cloudLightColor: THREE.IUniform<THREE.Vector3>;
  cloudAmbientTop: THREE.IUniform<THREE.Vector3>;
  cloudAmbientBottom: THREE.IUniform<THREE.Vector3>;
}

export function createSkyUniforms(): SkyUniforms {
  return {
    skyViewLut: { value: null },
    transmittanceLut: { value: null },
    noiseTex: { value: null },
    cloudBuffer: { value: null },
    cloudBufferSize: { value: new THREE.Vector2(1, 1) },
    cloudBufferTexel: { value: new THREE.Vector2(1, 1) },
    lutScale: { value: 1 },
    cameraRadius: { value: 6360.002 },
    cameraHeight: { value: 2 },
    horizonElev: { value: 0 },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunDiskRadiance: { value: new THREE.Vector3() },
    sunCosRadius: { value: Math.cos(0.00465) },
    moonDir: { value: new THREE.Vector3(0, -1, 0) },
    moonDiskRadiance: { value: new THREE.Vector3() },
    moonCosRadius: { value: Math.cos(0.0045) },
    starScale: { value: 0 },
    pixelAngle: { value: 0.001 },
    time: { value: 0 },
    hazeA: { value: new THREE.Vector4() },
    hazeRayleigh: { value: new THREE.Vector3() },
    groundRadiance: { value: new THREE.Vector3() },
    cloudA: { value: new THREE.Vector4(0, 1200, 1400, 0.03) },
    cloudB: { value: new THREE.Vector4(0, 0, 1, 1) },
    cloudLightDir: { value: new THREE.Vector3(0, 1, 0) },
    cloudLightColor: { value: new THREE.Vector3() },
    cloudAmbientTop: { value: new THREE.Vector3() },
    cloudAmbientBottom: { value: new THREE.Vector3() },
  };
}

function skyGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  // Never culled; a huge bounding sphere keeps any code that inspects bounds happy.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}

export interface SkyMaterialOptions {
  /** Environment-map variant: no sun disk, moon or stars; lit ground below the horizon. */
  env: boolean;
  cloudSteps: number;
}

/**
 * The sky, drawn as a full-screen triangle at the far plane. In the main scene it renders after
 * every opaque object (renderOrder) with depth test, so it only shades pixels the city leaves
 * uncovered, never writes depth (post effects see it as background) and is never fogged.
 */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly projInv = new THREE.Matrix4();
  private readonly camWorld = new THREE.Matrix4();

  constructor(readonly uniforms: SkyUniforms, options: SkyMaterialOptions) {
    const defines: Record<string, string | number> = { CLOUD_STEPS: options.cloudSteps };
    // The environment map marches clouds per texel; the main sky reads the cloud pass.
    if (options.env) {
      defines.SKY_ENV = '';
      defines.SKY_CLOUDS = '';
    } else defines.SKY_CLOUD_BUFFER = '';
    this.material = new THREE.ShaderMaterial({
      name: options.env ? 'SolmarSkyEnv' : 'SolmarSky',
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: { ...uniforms, uProjInv: { value: this.projInv }, uCamWorld: { value: this.camWorld } },
      defines,
      depthWrite: false,
      depthTest: !options.env,
      fog: false,
      toneMapped: true,
    });
    this.mesh = new THREE.Mesh(skyGeometry(), this.material);
    this.mesh.name = options.env ? 'SolmarSkyEnv' : 'SolmarSky';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = options.env ? 0 : 1e9;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.onBeforeRender = (_r, _s, camera) => {
      this.projInv.copy(camera.projectionMatrixInverse);
      this.camWorld.copy(camera.matrixWorld);
    };
  }

  setCloudSteps(steps: number): void {
    const d = this.material.defines as Record<string, string | number>;
    if (d.CLOUD_STEPS === steps) return;
    d.CLOUD_STEPS = steps;
    this.material.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Clouds for the main camera, raymarched at a fraction of the screen resolution into a
 * half-float buffer (premultiplied colour + opacity) that the sky upsamples. Clouds are soft,
 * so this looks the same as full resolution at a fraction of the cost, and lets the march take
 * enough steps to be free of noise.
 */
export class CloudPass {
  readonly target: THREE.WebGLRenderTarget;
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly projInv = new THREE.Matrix4();
  private readonly camWorld = new THREE.Matrix4();
  private readonly full = new THREE.Vector2();

  constructor(private readonly uniforms: SkyUniforms, steps: number) {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: THREE.NoColorSpace,
    });
    this.target.texture.name = 'Atmosphere.Clouds';
    this.material = new THREE.ShaderMaterial({
      name: 'SolmarClouds',
      vertexShader: skyVertex,
      fragmentShader: cloudPassFragment,
      uniforms: { ...uniforms, uProjInv: { value: this.projInv }, uCamWorld: { value: this.camWorld } },
      defines: { CLOUD_STEPS: steps },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(skyGeometry(), this.material);
    this.mesh.frustumCulled = false;
  }

  setSteps(steps: number): void {
    const d = this.material.defines as Record<string, number>;
    if (d.CLOUD_STEPS === steps) return;
    d.CLOUD_STEPS = steps;
    this.material.needsUpdate = true;
  }

  /** Renders the clouds for `camera` at 1/`divisor` of the renderer's drawing-buffer size. */
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, divisor: number): void {
    renderer.getDrawingBufferSize(this.full);
    const w = Math.max(1, Math.ceil(this.full.x / divisor));
    const h = Math.max(1, Math.ceil(this.full.y / divisor));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    // The buffer maps onto the full-resolution frame by uv = gl_FragCoord / size.
    this.uniforms.cloudBufferSize.value.set(w * divisor, h * divisor);
    this.uniforms.cloudBufferTexel.value.set(1 / w, 1 / h);
    this.projInv.copy(camera.projectionMatrixInverse);
    this.camWorld.copy(camera.matrixWorld);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.mesh, this.camera);
    renderer.setRenderTarget(prev);
  }

  dispose(): void {
    this.target.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
