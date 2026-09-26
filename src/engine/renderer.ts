// The engine's renderer: three.js WebGPURenderer, on WebGPU where the browser has it and on
// WebGL 2 otherwise (same node materials and TSL shaders on both). ?backend=webgl forces the
// fallback, e.g. to compare the two.
import { WebGPURenderer } from 'three/webgpu';
import { classifyGpu, detectGpu, type GpuInfo } from '../core/gpu';

export type BackendName = 'WebGPU' | 'WebGL 2';
export type BackendChoice = 'auto' | 'webgpu' | 'webgl';

// The few WebGPU API types used here (the project doesn't depend on @webgpu/types).
interface AdapterInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  isFallbackAdapter?: boolean;
}
interface Adapter {
  info?: AdapterInfo;
}
interface NavigatorGpu {
  requestAdapter(options?: { powerPreference?: string }): Promise<Adapter | null>;
}

export interface RendererSetup {
  renderer: WebGPURenderer;
  backend: BackendName;
  gpu: GpuInfo;
  /** Why WebGPU was not used, when it wasn't. */
  fallbackReason: string;
  /** True when the backend reports GPU times (timestamp queries). */
  gpuTimer: boolean;
}

export function isBackendChoice(v: string): v is BackendChoice {
  return v === 'auto' || v === 'webgpu' || v === 'webgl';
}

type CreateView = (this: unknown, descriptor?: { swizzle?: unknown }) => unknown;
let compatInstalled = false;

/**
 * three r186 passes the identity swizzle 'rgba' to every GPUTexture.createView(); browsers from
 * before texture-component-swizzle (e.g. Chromium 141) reject the unknown member and WebGPU
 * fails. Leaving an identity swizzle out means the same thing, so drop it. Call before
 * creating a WebGPURenderer.
 */
export function installWebGPUCompat(): void {
  if (compatInstalled) return;
  compatInstalled = true;
  const gpuTexture = (globalThis as { GPUTexture?: { prototype: { createView: CreateView } } }).GPUTexture;
  if (!gpuTexture) return;
  const createView = gpuTexture.prototype.createView;
  gpuTexture.prototype.createView = function (descriptor) {
    if (descriptor?.swizzle !== 'rgba') return createView.call(this, descriptor);
    const plain = { ...descriptor };
    delete plain.swizzle;
    return createView.call(this, plain);
  };
}

/**
 * Creates and initialises the renderer. `onLost` runs when the GPU device or WebGL context is
 * lost (driver reset, out of memory, GPU process crash).
 */
export async function createRenderer(choice: BackendChoice, onLost: (message: string) => void): Promise<RendererSetup> {
  installWebGPUCompat();
  let fallbackReason = '';
  let adapter: Adapter | null = null;
  const wantWebGPU = choice !== 'webgl';
  if (wantWebGPU) {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) fallbackReason = 'this browser has no WebGPU';
    else {
      try {
        adapter = await (navigator as Navigator & { gpu: NavigatorGpu }).gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) fallbackReason = 'no WebGPU adapter (GPU blocklisted or disabled)';
      } catch (e) {
        fallbackReason = `WebGPU adapter request failed: ${(e as Error).message}`;
      }
    }
  } else {
    fallbackReason = 'WebGL 2 requested (?backend=webgl)';
  }

  const renderer = new WebGPURenderer({
    forceWebGL: !adapter,
    powerPreference: 'high-performance',
    antialias: false,
    alpha: false,
    stencil: false,
    trackTimestamp: true,
  });
  renderer.onDeviceLost = (info: { message?: string }) => onLost(info.message ?? 'device lost');
  await renderer.init();

  const onWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  if (!onWebGPU && !fallbackReason) fallbackReason = 'WebGPU device creation failed';
  let gpu: GpuInfo;
  if (onWebGPU && adapter) {
    gpu = gpuFromAdapter(adapter);
  } else {
    const gl = (renderer.backend as { gl?: WebGL2RenderingContext }).gl;
    gpu = gl ? detectGpu(gl) : { renderer: '', kind: 'unknown' };
  }
  const backend = renderer.backend as { trackTimestamp?: boolean; disjoint?: unknown };
  const gpuTimer = backend.trackTimestamp === true && (onWebGPU || !!backend.disjoint);
  return { renderer, backend: onWebGPU ? 'WebGPU' : 'WebGL 2', gpu, fallbackReason: onWebGPU ? '' : fallbackReason, gpuTimer };
}

/** GPU name and kind from a WebGPU adapter (browsers may hide the exact model). */
export function gpuFromAdapter(adapter: Adapter): GpuInfo {
  const info = adapter.info;
  const name = info ? [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' ') : '';
  return { renderer: name, kind: info?.isFallbackAdapter ? 'software' : classifyGpu(name) };
}
