// Plain typed-array meshes. World generation (which may run in a Web Worker) builds
// these; the renderer turns them into THREE.BufferGeometry. Keeping them free of
// three.js objects lets them be transferred between threads without copying.

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Optional per-vertex linear RGB colour. */
  colors?: Float32Array;
  /** Optional extra attributes, e.g. facade parameters for a custom shader. */
  extra?: Record<string, { itemSize: number; array: Float32Array }>;
  indices: Uint32Array;
}

/** Mesh parts grouped by material key (e.g. 'asphalt', 'facade', 'glass'). */
export type MeshBuckets = Map<string, MeshData>;

/** Incrementally builds a MeshData. */
export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];
  private readonly extraData = new Map<string, { itemSize: number; data: number[] }>();
  private hasColor = false;

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get isEmpty(): boolean {
    return this.indices.length === 0;
  }

  /** Declare an extra attribute before adding vertices. */
  declareExtra(name: string, itemSize: number): void {
    if (!this.extraData.has(name)) this.extraData.set(name, { itemSize, data: [] });
  }

  /** Add a vertex; returns its index. `extra` values must match declared attributes. */
  vertex(
    px: number, py: number, pz: number,
    nx: number, ny: number, nz: number,
    u = 0, v = 0,
    color?: readonly [number, number, number],
    extra?: Record<string, readonly number[]>,
  ): number {
    const index = this.vertexCount;
    if (color && !this.hasColor) this.backfillColors(index);
    this.positions.push(px, py, pz);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, v);
    if (color) {
      this.colors.push(color[0], color[1], color[2]);
    } else if (this.hasColor) {
      this.colors.push(1, 1, 1);
    }
    for (const [name, attr] of this.extraData) {
      const values = extra?.[name];
      for (let i = 0; i < attr.itemSize; i++) attr.data.push(values ? values[i] ?? 0 : 0);
    }
    return index;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  /** Quad a-b-c-d in counter-clockwise order as seen from the front face. */
  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  /** Append another MeshData, optionally translated. */
  append(m: MeshData, dx = 0, dy = 0, dz = 0): void {
    const base = this.vertexCount;
    for (let i = 0; i < m.positions.length; i += 3) {
      this.positions.push(m.positions[i] + dx, m.positions[i + 1] + dy, m.positions[i + 2] + dz);
    }
    for (const n of m.normals) this.normals.push(n);
    for (const t of m.uvs) this.uvs.push(t);
    if (m.colors) {
      if (!this.hasColor) this.backfillColors(base);
      for (const c of m.colors) this.colors.push(c);
    } else if (this.hasColor) {
      for (let i = 0; i < m.positions.length / 3; i++) this.colors.push(1, 1, 1);
    }
    for (const [name, attr] of this.extraData) {
      const src = m.extra?.[name];
      const count = m.positions.length / 3;
      if (src) for (const v of src.array) attr.data.push(v);
      else for (let i = 0; i < count * attr.itemSize; i++) attr.data.push(0);
    }
    for (const idx of m.indices) this.indices.push(idx + base);
  }

  build(): MeshData {
    const out: MeshData = {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      indices: new Uint32Array(this.indices),
    };
    if (this.hasColor) out.colors = new Float32Array(this.colors);
    if (this.extraData.size > 0) {
      out.extra = {};
      for (const [name, attr] of this.extraData) {
        out.extra[name] = { itemSize: attr.itemSize, array: new Float32Array(attr.data) };
      }
    }
    return out;
  }

  private backfillColors(count = this.vertexCount): void {
    this.hasColor = true;
    for (let i = this.colors.length / 3; i < count; i++) this.colors.push(1, 1, 1);
  }
}

/** Builders keyed by material, created on demand. */
export class BucketBuilder {
  readonly builders = new Map<string, MeshBuilder>();

  get(key: string): MeshBuilder {
    let b = this.builders.get(key);
    if (!b) {
      b = new MeshBuilder();
      this.builders.set(key, b);
    }
    return b;
  }

  build(): MeshBuckets {
    const out: MeshBuckets = new Map();
    for (const [key, b] of this.builders) if (!b.isEmpty) out.set(key, b.build());
    return out;
  }
}

/** Transferable buffers of a MeshData, for postMessage. */
export function meshTransferables(m: MeshData): ArrayBuffer[] {
  const list: ArrayBuffer[] = [m.positions.buffer, m.normals.buffer, m.uvs.buffer, m.indices.buffer] as ArrayBuffer[];
  if (m.colors) list.push(m.colors.buffer as ArrayBuffer);
  if (m.extra) for (const a of Object.values(m.extra)) list.push(a.array.buffer as ArrayBuffer);
  return list;
}
