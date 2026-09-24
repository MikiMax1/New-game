import * as THREE from 'three';
import {
  IRRADIANCE_MU_MIN,
  IRRADIANCE_TABLE_SIZE,
  fullscreenVertex,
  irradianceFragment,
  multiScatteringFragment,
  skyViewFragment,
  transmittanceFragment,
} from './shaders/luts.glsl';
import type { RGB } from './model';

/** A full-screen triangle for GPU passes (the vertex shader ignores camera matrices). */
export class FullscreenPass {
  readonly mesh: THREE.Mesh;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(material: THREE.ShaderMaterial) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
  }

  get material(): THREE.ShaderMaterial {
    return this.mesh.material as THREE.ShaderMaterial;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): void {
    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, this.camera);
    renderer.setRenderTarget(prevTarget);
    renderer.xr.enabled = prevXr;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

function lutTarget(width: number, height: number, type: THREE.TextureDataType = THREE.HalfFloatType, wrapS: THREE.Wrapping = THREE.ClampToEdgeWrapping): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(width, height, {
    type,
    format: THREE.RGBAFormat,
    minFilter: type === THREE.FloatType ? THREE.NearestFilter : THREE.LinearFilter,
    magFilter: type === THREE.FloatType ? THREE.NearestFilter : THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false,
    wrapS,
    wrapT: THREE.ClampToEdgeWrapping,
    colorSpace: THREE.NoColorSpace,
  });
  return rt;
}

function lutMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform> = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

export interface SkyViewParams {
  cameraAltitudeKm: number;
  sunDir: THREE.Vector3;
  sunIlluminance: THREE.Vector3;
  moonDir: THREE.Vector3;
  moonIlluminance: THREE.Vector3;
  nightZenith: THREE.Vector3;
  nightHorizon: THREE.Vector3;
}

/**
 * GPU look-up tables of the atmosphere: transmittance (256x64) and multiple scattering (32x32)
 * are computed once; the sky-view LUT (full azimuth, 256x128 by default) whenever the sun, moon
 * or light scale change.
 */
export class AtmosphereLuts {
  readonly transmittance = lutTarget(256, 64);
  readonly multiScattering = lutTarget(32, 32);
  readonly skyView: THREE.WebGLRenderTarget;
  /** Skylight on a horizontal surface for unit sun illuminance, by sun zenith cosine (CPU copy). */
  irradianceTable: Float32Array | null = null;

  private readonly transmittancePass = new FullscreenPass(lutMaterial(transmittanceFragment));
  private readonly multiScatPass: FullscreenPass;
  private readonly skyViewPass: FullscreenPass;
  private staticDone = false;

  constructor(skyViewWidth = 256, skyViewHeight = 128) {
    this.skyView = lutTarget(skyViewWidth, skyViewHeight, THREE.HalfFloatType, THREE.RepeatWrapping);
    this.skyView.texture.name = 'Atmosphere.SkyView';
    this.transmittance.texture.name = 'Atmosphere.Transmittance';
    this.multiScattering.texture.name = 'Atmosphere.MultiScattering';
    this.multiScatPass = new FullscreenPass(lutMaterial(multiScatteringFragment, { transmittanceLut: { value: this.transmittance.texture } }));
    this.skyViewPass = new FullscreenPass(
      lutMaterial(skyViewFragment, {
        transmittanceLut: { value: this.transmittance.texture },
        multiScatLut: { value: this.multiScattering.texture },
        cameraRadius: { value: 6360.01 },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunIlluminance: { value: new THREE.Vector3() },
        moonDir: { value: new THREE.Vector3(0, 1, 0) },
        moonIlluminance: { value: new THREE.Vector3() },
        nightZenith: { value: new THREE.Vector3() },
        nightHorizon: { value: new THREE.Vector3() },
        cityGlowDir: { value: new THREE.Vector3(0, 0, -1) },
      }),
    );
  }

  /** Transmittance, multiple scattering and the CPU irradiance table. Runs once. */
  renderStatic(renderer: THREE.WebGLRenderer): void {
    if (this.staticDone) return;
    this.staticDone = true;
    this.transmittancePass.render(renderer, this.transmittance);
    this.multiScatPass.render(renderer, this.multiScattering);

    // Irradiance table: a tiny float target read back once (a one-off stall of a few ms).
    const rt = lutTarget(IRRADIANCE_TABLE_SIZE, 1, THREE.FloatType);
    const pass = new FullscreenPass(
      lutMaterial(irradianceFragment, {
        transmittanceLut: { value: this.transmittance.texture },
        multiScatLut: { value: this.multiScattering.texture },
      }),
    );
    pass.render(renderer, rt);
    const data = new Float32Array(IRRADIANCE_TABLE_SIZE * 4);
    try {
      renderer.readRenderTargetPixels(rt, 0, 0, IRRADIANCE_TABLE_SIZE, 1, data);
      this.irradianceTable = data;
    } catch {
      this.irradianceTable = null;
    }
    pass.dispose();
    rt.dispose();
  }

  renderSkyView(renderer: THREE.WebGLRenderer, p: SkyViewParams): void {
    const u = this.skyViewPass.material.uniforms;
    u.cameraRadius.value = 6360 + Math.max(0.002, p.cameraAltitudeKm);
    u.sunDir.value.copy(p.sunDir);
    u.sunIlluminance.value.copy(p.sunIlluminance);
    u.moonDir.value.copy(p.moonDir);
    u.moonIlluminance.value.copy(p.moonIlluminance);
    u.nightZenith.value.copy(p.nightZenith);
    u.nightHorizon.value.copy(p.nightHorizon);
    this.skyViewPass.render(renderer, this.skyView);
  }

  /** Skylight irradiance (horizontal, unit sun) for a sun zenith cosine, from the table. */
  skyIrradiance(muSun: number, out: RGB): RGB {
    const t = this.irradianceTable;
    if (!t) {
      // Fallback fit if float read-back is unavailable: bluish skylight fading after sunset.
      const k = Math.max(0, Math.min(1, (muSun + 0.12) / 0.25));
      const s = 0.2 * Math.pow(Math.max(0, muSun), 0.6) + 0.004 * k * k;
      out[0] = s * 0.75;
      out[1] = s * 0.9;
      out[2] = s * 1.2;
      return out;
    }
    const x = ((muSun - IRRADIANCE_MU_MIN) / (1 - IRRADIANCE_MU_MIN)) * (IRRADIANCE_TABLE_SIZE - 1);
    const i = Math.max(0, Math.min(IRRADIANCE_TABLE_SIZE - 2, Math.floor(x)));
    const f = Math.max(0, Math.min(1, x - i));
    for (let c = 0; c < 3; c++) {
      // Interpolate in log space: twilight skylight falls off exponentially.
      const a = Math.max(1e-12, t[i * 4 + c]);
      const b = Math.max(1e-12, t[(i + 1) * 4 + c]);
      out[c] = muSun < IRRADIANCE_MU_MIN ? 0 : Math.exp(Math.log(a) * (1 - f) + Math.log(b) * f);
    }
    return out;
  }

  dispose(): void {
    this.transmittance.dispose();
    this.multiScattering.dispose();
    this.skyView.dispose();
    this.transmittancePass.dispose();
    this.multiScatPass.dispose();
    this.skyViewPass.dispose();
  }
}
