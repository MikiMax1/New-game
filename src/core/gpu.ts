// What kind of GPU the browser renders with, from the WebGL renderer string. Used to pick a
// default quality the machine can handle; the player can always change it (O).

export type GpuKind = 'software' | 'integrated' | 'discrete' | 'unknown';

export interface GpuInfo {
  /** Renderer string, e.g. "ANGLE (Intel, Intel(R) UHD Graphics 620 ... Direct3D11 ...)". */
  renderer: string;
  kind: GpuKind;
}

export function detectGpu(gl: WebGLRenderingContext | WebGL2RenderingContext): GpuInfo {
  let renderer = '';
  try {
    // Chromium exposes the real name through this extension; Firefox and Safari report a
    // (sanitised) name through RENDERER and deprecate the extension.
    const ext = navigator.userAgent.includes('Firefox') ? null : gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch {
    renderer = '';
  }
  return { renderer, kind: classifyGpu(renderer) };
}

export function classifyGpu(renderer: string): GpuKind {
  const r = renderer.toLowerCase();
  if (!r || r === 'webkit webgl') return 'unknown';
  if (/swiftshader|llvmpipe|softpipe|lavapipe|basic render|software|offscreen/.test(r)) return 'software';
  if (/nvidia|geforce|quadro|radeon (rx|pro|vii)|radeon hd|\brx \d{3,4}|arc\(tm\) a\d|arc a\d|firepro/.test(r)) return 'discrete';
  if (/intel|iris|uhd|hd graphics|mali|adreno|powervr|apple|videocore|radeon\(tm\)( \w+)? graphics|radeon graphics|vega \d+|radeon r\d/.test(r)) {
    return 'integrated';
  }
  return 'unknown';
}
