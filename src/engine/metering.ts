// Scene luminance metering for auto-exposure, on the GPU.
//
// The pre-exposed HDR frame is reduced to a single log-average luminance in three small passes
// (frame → 64² → 8² → 1²), centre-weighted like a camera's metering. The 1×1 result is read
// back asynchronously, so the CPU never waits for the GPU; readings arrive a frame or two late,
// which eye adaptation smooths over anyway. Works the same on WebGPU and WebGL 2.
import { Fn, Loop, clamp, dot, exp, float, ivec2, log2, luminance, mix, screenCoordinate, textureLoad, uv, vec2, vec4 } from 'three/tsl';
import { FloatType, NodeMaterial, QuadMesh, RenderTarget, type TextureNode, type WebGPURenderer } from 'three/webgpu';

/** Side of the first reduction target; each of its texels averages 4×4 bilinear taps. */
const FIRST = 64;
/** Texels summed per axis by the later passes (64 → 8 → 1). */
const BLOCK = 8;
/** Luminance range considered (pre-exposed units): ignores black pixels and the sun disc. */
const MIN_LUMINANCE = 1e-5;
const MAX_LUMINANCE = 6e4;

export class LuminanceMeter {
  /** Average scene luminance in nits of the last reading, or -1 before the first. */
  luminance = -1;
  /** Readings received so far. */
  readings = 0;
  private readonly first = target(FIRST);
  private readonly second = target(FIRST / BLOCK);
  private readonly third = target(1);
  private readonly firstMaterial = new NodeMaterial();
  private readonly secondMaterial = new NodeMaterial();
  private readonly thirdMaterial = new NodeMaterial();
  private readonly quad = new QuadMesh(this.firstMaterial);
  private pending = false;
  private disposed = false;

  /** `source` is the pre-exposed HDR scene colour (a pass's texture node). */
  constructor(source: TextureNode) {
    this.firstMaterial.name = 'Meter.logLuminance';
    this.firstMaterial.fragmentNode = Fn(() => {
      const centre = uv();
      const sum = float(0).toVar();
      Loop(span(4), span(4), ({ i, j }) => {
        const offset = vec2(float(i), float(j)).add(0.5).div(4).sub(0.5).div(FIRST);
        const l = luminance(source.sample(centre.add(offset)).rgb);
        sum.addAssign(log2(clamp(l, MIN_LUMINANCE, MAX_LUMINANCE)));
      });
      // Centre-weighted: the middle of the view counts about three times the corners.
      const d = centre.sub(0.5).mul(2);
      const weight = mix(0.35, 1, exp(dot(d, d).mul(-1.5)));
      return vec4(sum.div(16).mul(weight), weight, 0, 1);
    })();
    this.secondMaterial.name = 'Meter.reduce';
    this.secondMaterial.fragmentNode = reduce(this.first);
    this.thirdMaterial.name = 'Meter.reduce';
    this.thirdMaterial.fragmentNode = reduce(this.second);
  }

  /**
   * Meters the frame just rendered. `exposure` is the pre-exposure it was rendered with (the
   * reading is converted back to physical nits). `onReading` receives the luminance in nits.
   */
  measure(renderer: WebGPURenderer, exposure: number, onReading: (nits: number) => void): void {
    const previous = renderer.getRenderTarget();
    this.run(renderer, this.first, this.firstMaterial);
    this.run(renderer, this.second, this.secondMaterial);
    this.run(renderer, this.third, this.thirdMaterial);
    renderer.setRenderTarget(previous);
    if (this.pending) return;
    this.pending = true;
    renderer
      .readRenderTargetPixelsAsync(this.third, 0, 0, 1, 1)
      .then((px) => {
        this.pending = false;
        if (this.disposed) return;
        const weight = Number(px[1]);
        if (!(weight > 0)) return;
        const nits = Math.pow(2, Number(px[0]) / weight) / exposure;
        if (!Number.isFinite(nits)) return;
        this.luminance = nits;
        this.readings++;
        onReading(nits);
      })
      .catch(() => {
        this.pending = false;
      });
  }

  dispose(): void {
    this.disposed = true;
    for (const t of [this.first, this.second, this.third]) t.dispose();
    for (const m of [this.firstMaterial, this.secondMaterial, this.thirdMaterial]) m.dispose();
  }

  private run(renderer: WebGPURenderer, rt: RenderTarget, material: NodeMaterial): void {
    renderer.setRenderTarget(rt);
    this.quad.material = material;
    this.quad.render(renderer);
  }
}

/** Loop bounds 0..n-1 with an int counter. */
function span(n: number) {
  return { type: 'int' as const, start: 0, end: n };
}

function target(size: number): RenderTarget {
  const rt = new RenderTarget(size, size, { type: FloatType, depthBuffer: false });
  rt.texture.name = `Meter.${size}`;
  return rt;
}

/** Sums BLOCK×BLOCK texels of `input` (weighted log sum in r, weight in g) into one. */
function reduce(input: RenderTarget) {
  return Fn(() => {
    const base = ivec2(screenCoordinate.xy).mul(BLOCK);
    const sum = vec2(0).toVar();
    Loop(span(BLOCK), span(BLOCK), ({ i, j }) => {
      sum.addAssign(textureLoad(input.texture, base.add(ivec2(i, j))).xy);
    });
    return vec4(sum, 0, 1);
  })();
}
