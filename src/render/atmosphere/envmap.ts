import * as THREE from 'three';
import type { SkyDome } from './sky';

/**
 * Image-based lighting from the sky: the environment variant of the sky (no sun disk or stars,
 * lit ground below the horizon) is rendered into a small cube map and prefiltered with
 * PMREMGenerator for scene.environment. Both render targets are reused between updates.
 */
export class SkyEnvironment {
  private cubeTarget: THREE.WebGLCubeRenderTarget;
  private readonly cubeCamera: THREE.CubeCamera;
  private readonly scene = new THREE.Scene();
  private readonly pmrem: THREE.PMREMGenerator;
  private pmremTarget: THREE.WebGLRenderTarget | null = null;
  /** Number of times the environment was regenerated (for stats). */
  generations = 0;

  constructor(renderer: THREE.WebGLRenderer, private readonly sky: SkyDome, private size = 128) {
    this.cubeTarget = this.createCubeTarget(size);
    this.cubeCamera = new THREE.CubeCamera(0.1, 10, this.cubeTarget);
    this.scene.add(sky.mesh);
    this.scene.add(this.cubeCamera);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  private createCubeTarget(size: number): THREE.WebGLCubeRenderTarget {
    return new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      colorSpace: THREE.NoColorSpace,
    });
  }

  get texture(): THREE.Texture | null {
    return this.pmremTarget ? this.pmremTarget.texture : null;
  }

  setSize(size: number): void {
    if (size === this.size) return;
    this.size = size;
    this.cubeTarget.dispose();
    this.cubeTarget = this.createCubeTarget(size);
    this.cubeCamera.renderTarget = this.cubeTarget;
    this.pmremTarget?.dispose();
    this.pmremTarget = null;
  }

  update(renderer: THREE.WebGLRenderer): THREE.Texture {
    const prevTarget = renderer.getRenderTarget();
    this.cubeCamera.update(renderer, this.scene);
    // The first call allocates the PMREM target; later calls reuse it.
    this.pmremTarget = this.pmrem.fromCubemap(this.cubeTarget.texture, this.pmremTarget);
    renderer.setRenderTarget(prevTarget);
    this.generations++;
    return this.pmremTarget.texture;
  }

  dispose(): void {
    this.scene.remove(this.sky.mesh);
    this.cubeTarget.dispose();
    this.pmremTarget?.dispose();
    this.pmrem.dispose();
  }
}
