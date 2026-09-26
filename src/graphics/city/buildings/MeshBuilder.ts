// Accumulates the static geometry of many buildings (walls, cornices, copings, roofs) into one
// merged mesh with a draw group per material, so a whole street of walls costs one draw call per
// material instead of one per building.
//
// Geometry is emitted in a building's local frame and transformed to world space as it is
// written (see setFrame): x along the facade (left to right seen from the street), y up, +z out
// of the facade towards the street, facade plane at z = 0. UVs are in metres, box-projected from
// the local position by the face's dominant normal axis (so a facade's u runs along it and v up
// it, whatever side of the street it is on), plus a per-building offset so neighbouring buildings
// don't show the same texture patch.
//
// Every vertex also carries a `weathering` attribute (vec3) read by the wall materials (see
// Weathering.ts): x = position across a streak source (0..1, or -1 for no edge fade), y = streak
// strength (1 right under a sill, fading down the wall), z = run-off under the parapet.
import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Mesh, ShapeUtils, Vector2, Vector3, type Material } from 'three/webgpu';

export type Vec3 = [number, number, number];
export type Weather = Vec3;

const NO_WEATHER: Weather = [0, 0, 0];

class Part {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly wth: number[] = [];
  readonly idx: number[] = [];
  get vertexCount(): number {
    return this.pos.length / 3;
  }
}

const _p = new Vector3();
const _n = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

export class MeshBuilder {
  private readonly parts = new Map<Material, Part>();
  private readonly matrix = new Matrix4();
  private readonly normalMatrix = new Matrix3();
  /** Added to every UV (metres). */
  readonly uvOffset = new Vector2();
  /** Weathering written with vertices that don't give their own. */
  weather: Weather = NO_WEATHER;

  constructor(readonly name: string) {}

  /** Sets the local → world transform for what follows. */
  setFrame(matrix: Matrix4): this {
    this.matrix.copy(matrix);
    this.normalMatrix.getNormalMatrix(matrix);
    return this;
  }

  get triangleCount(): number {
    let n = 0;
    for (const p of this.parts.values()) n += p.idx.length / 3;
    return n;
  }

  private part(material: Material): Part {
    let p = this.parts.get(material);
    if (!p) this.parts.set(material, (p = new Part()));
    return p;
  }

  /** Writes one vertex (local position and normal); returns its index. */
  private vertex(part: Part, x: number, y: number, z: number, nx: number, ny: number, nz: number, w: Weather): number {
    // Box-projected metre UVs from the local position.
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = x;
      v = z;
    } else if (ax >= az) {
      u = nx > 0 ? -z : z;
      v = y;
    } else {
      u = nz > 0 ? x : -x;
      v = y;
    }
    _p.set(x, y, z).applyMatrix4(this.matrix);
    _n.set(nx, ny, nz).applyMatrix3(this.normalMatrix).normalize();
    part.pos.push(_p.x, _p.y, _p.z);
    part.nor.push(_n.x, _n.y, _n.z);
    part.uv.push(u + this.uvOffset.x, v + this.uvOffset.y);
    part.wth.push(w[0], w[1], w[2]);
    return part.vertexCount - 1;
  }

  /**
   * A planar quad a-b-c-d with normal n. The winding is fixed up from the normal, so the corners
   * can be given in either order around the quad. `w` gives each corner's weathering.
   */
  quad(material: Material, a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, w?: [Weather, Weather, Weather, Weather]): void {
    const part = this.part(material);
    const ww = w ?? [this.weather, this.weather, this.weather, this.weather];
    const i0 = this.vertex(part, a[0], a[1], a[2], n[0], n[1], n[2], ww[0]);
    const i1 = this.vertex(part, b[0], b[1], b[2], n[0], n[1], n[2], ww[1]);
    const i2 = this.vertex(part, c[0], c[1], c[2], n[0], n[1], n[2], ww[2]);
    const i3 = this.vertex(part, d[0], d[1], d[2], n[0], n[1], n[2], ww[3]);
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const flip = _c.crossVectors(_a, _b).dot(_n.set(n[0], n[1], n[2])) < 0;
    if (flip) part.idx.push(i0, i2, i1, i0, i3, i2);
    else part.idx.push(i0, i1, i2, i0, i2, i3);
  }

  /** A rectangle in the plane z = const, facing +z (facing = 1) or -z. */
  rectZ(material: Material, x0: number, x1: number, y0: number, y1: number, z: number, facing: 1 | -1, w?: [Weather, Weather, Weather, Weather]): void {
    if (x1 - x0 < 1e-5 || y1 - y0 < 1e-5) return;
    // Corners: bottom-left, bottom-right, top-right, top-left (as seen from +z).
    this.quad(material, [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, facing], w);
  }

  /** A rectangle in the plane x = const, facing +x or -x. */
  rectX(material: Material, z0: number, z1: number, y0: number, y1: number, x: number, facing: 1 | -1): void {
    if (z1 - z0 < 1e-5 || y1 - y0 < 1e-5) return;
    this.quad(material, [x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], [facing, 0, 0]);
  }

  /** A rectangle in the plane y = const, facing up or down. */
  rectY(material: Material, x0: number, x1: number, z0: number, z1: number, y: number, facing: 1 | -1): void {
    if (x1 - x0 < 1e-5 || z1 - z0 < 1e-5) return;
    this.quad(material, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, facing, 0]);
  }

  /**
   * An axis-aligned box with chamfered edges (`c` metres at 45°, shaded as a rounded arris):
   * 24 vertices, 44 triangles. `skip` leaves faces out (e.g. 'nz' for a box against a wall).
   */
  box(material: Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c = 0.015, skip = ''): void {
    const data = chamferBoxData((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, c, skip);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const cz = (z0 + z1) / 2;
    const part = this.part(material);
    const base = part.vertexCount;
    for (let i = 0; i < data.positions.length; i += 3) {
      this.vertex(part, data.positions[i] + cx, data.positions[i + 1] + cy, data.positions[i + 2] + cz, data.normals[i], data.normals[i + 1], data.normals[i + 2], this.weather);
    }
    for (const i of data.indices) part.idx.push(base + i);
  }

  /**
   * Sweeps a closed profile in the (z, y) plane along x from x0 to x1: cornices, string courses,
   * copings. Edges meeting at less than `smooth` radians share normals (curved mouldings shade
   * smoothly, sharp arrises stay crisp). Ends are capped unless told otherwise.
   */
  sweepX(material: Material, profile: [number, number][], x0: number, x1: number, caps: [boolean, boolean] = [true, true], smooth = 0.6): void {
    const part = this.part(material);
    const n = profile.length;
    // Per-edge outward normals in (z, y); the profile winds counter-clockwise seen from +x
    // (z to the right, y up), so the outward normal of edge (dz, dy) is (dy, -dz).
    const edgeN: [number, number][] = [];
    let area = 0;
    for (let i = 0; i < n; i++) {
      const [za, ya] = profile[i];
      const [zb, yb] = profile[(i + 1) % n];
      area += za * yb - zb * ya;
      const len = Math.hypot(zb - za, yb - ya) || 1;
      edgeN.push([(yb - ya) / len, -(zb - za) / len]);
    }
    const sign = area >= 0 ? 1 : -1;
    for (const e of edgeN) {
      e[0] *= sign;
      e[1] *= sign;
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [za, ya] = profile[i];
      const [zb, yb] = profile[j];
      if (Math.hypot(zb - za, yb - ya) < 1e-6) continue;
      const nPrev = edgeN[(i + n - 1) % n];
      const nCur = edgeN[i];
      const nNext = edgeN[j];
      const blend = (a: [number, number], b: [number, number]): [number, number] => {
        const dot = a[0] * b[0] + a[1] * b[1];
        if (Math.acos(Math.max(-1, Math.min(1, dot))) > smooth) return b;
        const s = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
        return [(a[0] + b[0]) / s, (a[1] + b[1]) / s];
      };
      const na = blend(nPrev, nCur);
      const nb = blend(nNext, nCur);
      const i0 = this.vertex(part, x0, ya, za, 0, na[1], na[0], this.weather);
      const i1 = this.vertex(part, x1, ya, za, 0, na[1], na[0], this.weather);
      const i2 = this.vertex(part, x1, yb, zb, 0, nb[1], nb[0], this.weather);
      const i3 = this.vertex(part, x0, yb, zb, 0, nb[1], nb[0], this.weather);
      // Outward = (0, ny, nz); check the winding against it.
      _a.set(0, yb - ya, zb - za);
      _b.set(x1 - x0, 0, 0);
      const geo = _c.crossVectors(_b, _a);
      const flip = geo.dot(_n.set(0, nCur[1], nCur[0])) < 0;
      if (flip) part.idx.push(i0, i2, i1, i0, i3, i2);
      else part.idx.push(i0, i1, i2, i0, i2, i3);
    }
    const contour = profile.map(([z, y]) => new Vector2(z, y));
    const tris = ShapeUtils.triangulateShape(contour, []);
    for (const [end, x, nx] of [
      [0, x0, -1],
      [1, x1, 1],
    ] as const) {
      if (!caps[end]) continue;
      const base = part.vertexCount;
      for (const [z, y] of profile) this.vertex(part, x, y, z, nx, 0, 0, this.weather);
      for (const t of tris) {
        // x-component of (B − A) × (C − A) for points (y, z): u_y·v_z − u_z·v_y.
        const [za, ya] = profile[t[0]];
        const [zb, yb] = profile[t[1]];
        const [zc, yc] = profile[t[2]];
        const gx = (yb - ya) * (zc - za) - (zb - za) * (yc - ya);
        if (gx * nx > 0) part.idx.push(base + t[0], base + t[1], base + t[2]);
        else part.idx.push(base + t[0], base + t[2], base + t[1]);
      }
    }
  }

  /**
   * Extrudes a closed footprint in the (x, z) plane (counter-clockwise seen from above) from y0 to
   * y1: fins, corner towers, bulkheads. Sides meeting at less than `smooth` radians share normals
   * (rounded corners shade smoothly).
   */
  prismY(material: Material, footprint: [number, number][], y0: number, y1: number, top = true, bottom = false, smooth = 0.5): void {
    const part = this.part(material);
    const n = footprint.length;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const [xa, za] = footprint[i];
      const [xb, zb] = footprint[(i + 1) % n];
      area += xa * zb - xb * za;
    }
    // Seen from above (+y) with x right and z down the screen, "counter-clockwise" has negative
    // shoelace area in (x, z); normalise to outward normals either way.
    const sign = area < 0 ? 1 : -1;
    const edgeN: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const [xa, za] = footprint[i];
      const [xb, zb] = footprint[(i + 1) % n];
      const len = Math.hypot(xb - xa, zb - za) || 1;
      // Rotate the edge direction by -90° about y: (dx, dz) → (-dz, dx)·sign.
      edgeN.push([(-(zb - za) / len) * sign, ((xb - xa) / len) * sign]);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [xa, za] = footprint[i];
      const [xb, zb] = footprint[j];
      if (Math.hypot(xb - xa, zb - za) < 1e-6) continue;
      const blend = (a: [number, number], b: [number, number]): [number, number] => {
        const dot = a[0] * b[0] + a[1] * b[1];
        if (Math.acos(Math.max(-1, Math.min(1, dot))) > smooth) return b;
        const s = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
        return [(a[0] + b[0]) / s, (a[1] + b[1]) / s];
      };
      const na = blend(edgeN[(i + n - 1) % n], edgeN[i]);
      const nb = blend(edgeN[j], edgeN[i]);
      const i0 = this.vertex(part, xa, y0, za, na[0], 0, na[1], this.weather);
      const i1 = this.vertex(part, xb, y0, zb, nb[0], 0, nb[1], this.weather);
      const i2 = this.vertex(part, xb, y1, zb, nb[0], 0, nb[1], this.weather);
      const i3 = this.vertex(part, xa, y1, za, na[0], 0, na[1], this.weather);
      _a.set(xb - xa, 0, zb - za);
      _b.set(0, y1 - y0, 0);
      const flip = _c.crossVectors(_a, _b).dot(_n.set(edgeN[i][0], 0, edgeN[i][1])) < 0;
      if (flip) part.idx.push(i0, i2, i1, i0, i3, i2);
      else part.idx.push(i0, i1, i2, i0, i2, i3);
    }
    const contour = footprint.map(([x, z]) => new Vector2(x, z));
    const tris = ShapeUtils.triangulateShape(contour, []);
    for (const [on, y, ny] of [
      [top, y1, 1],
      [bottom, y0, -1],
    ] as const) {
      if (!on) continue;
      const base = part.vertexCount;
      for (const [x, z] of footprint) this.vertex(part, x, y, z, 0, ny, 0, this.weather);
      for (const t of tris) {
        const a = footprint[t[0]];
        const b = footprint[t[1]];
        const c = footprint[t[2]];
        // Normal of (a, b, c) in y: (b - a) × (c - a) has y = dz1·dx2 − dx1·dz2.
        const y2 = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
        if (y2 * ny > 0) part.idx.push(base + t[0], base + t[1], base + t[2]);
        else part.idx.push(base + t[0], base + t[2], base + t[1]);
      }
    }
  }

  /** Builds the merged mesh: one geometry, one draw group per material. */
  build(): Mesh | null {
    const entries = [...this.parts.entries()].filter(([, p]) => p.idx.length > 0);
    if (entries.length === 0) return null;
    let vertices = 0;
    let indices = 0;
    for (const [, p] of entries) {
      vertices += p.vertexCount;
      indices += p.idx.length;
    }
    const pos = new Float32Array(vertices * 3);
    const nor = new Float32Array(vertices * 3);
    const uv = new Float32Array(vertices * 2);
    const wth = new Float32Array(vertices * 3);
    const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    const geometry = new BufferGeometry();
    const materials: Material[] = [];
    let v = 0;
    let k = 0;
    for (const [material, p] of entries) {
      pos.set(p.pos, v * 3);
      nor.set(p.nor, v * 3);
      uv.set(p.uv, v * 2);
      wth.set(p.wth, v * 3);
      for (let i = 0; i < p.idx.length; i++) index[k + i] = p.idx[i] + v;
      geometry.addGroup(k, p.idx.length, materials.length);
      materials.push(material);
      v += p.vertexCount;
      k += p.idx.length;
    }
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new BufferAttribute(nor, 3));
    geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    geometry.setAttribute('weathering', new BufferAttribute(wth, 3));
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, materials);
    mesh.name = this.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

export interface BoxData {
  positions: number[];
  normals: number[];
  indices: number[];
}

/**
 * A box of half-extents (hx, hy, hz) centred on the origin with every edge chamfered by `c`:
 * each face is inset by c, edges are quads between neighbouring faces and corners are triangles.
 * Vertices carry their face's normal, so the chamfers interpolate between the two faces'
 * normals and shade like a rounded arris. `skip` ('px nx py ny pz nz') leaves out faces that are
 * never seen (and the chamfers and corners around them).
 */
export function chamferBoxData(hx: number, hy: number, hz: number, c: number, skip = ''): BoxData {
  c = Math.max(1e-4, Math.min(c, hx * 0.49, hy * 0.49, hz * 0.49));
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const h = [hx, hy, hz];
  // Faces: axis, sign. Each face has 4 corner vertices at (±(h-c) on the other axes, ±h on its own).
  const faces: { axis: number; s: number; key: string }[] = [
    { axis: 0, s: 1, key: 'px' },
    { axis: 0, s: -1, key: 'nx' },
    { axis: 1, s: 1, key: 'py' },
    { axis: 1, s: -1, key: 'ny' },
    { axis: 2, s: 1, key: 'pz' },
    { axis: 2, s: -1, key: 'nz' },
  ];
  // vertexOf[face][corner signs] → index. Corner signs are the signs on the two other axes.
  const vid = new Map<string, number>();
  const vkey = (f: number, sa: number, sb: number) => `${f}:${sa}:${sb}`;
  const others = (axis: number) => [(axis + 1) % 3, (axis + 2) % 3];
  faces.forEach((f, fi) => {
    const [a, b] = others(f.axis);
    for (const sa of [-1, 1]) {
      for (const sb of [-1, 1]) {
        const p = [0, 0, 0];
        p[f.axis] = f.s * h[f.axis];
        p[a] = sa * (h[a] - c);
        p[b] = sb * (h[b] - c);
        const n = [0, 0, 0];
        n[f.axis] = f.s;
        vid.set(vkey(fi, sa, sb), positions.length / 3);
        positions.push(p[0], p[1], p[2]);
        normals.push(n[0], n[1], n[2]);
      }
    }
  });
  const skipped = (fi: number) => skip.includes(faces[fi].key);
  const pushTri = (i0: number, i1: number, i2: number) => {
    // Orient outward: compare the geometric normal with the centroid direction.
    const p = (i: number) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    const A = p(i0);
    const B = p(i1);
    const C = p(i2);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const m = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
    if (g[0] * m[0] + g[1] * m[1] + g[2] * m[2] < 0) indices.push(i0, i2, i1);
    else indices.push(i0, i1, i2);
  };
  // Face quads.
  faces.forEach((_f, fi) => {
    if (skipped(fi)) return;
    const q = [vid.get(vkey(fi, -1, -1))!, vid.get(vkey(fi, 1, -1))!, vid.get(vkey(fi, 1, 1))!, vid.get(vkey(fi, -1, 1))!];
    pushTri(q[0], q[1], q[2]);
    pushTri(q[0], q[2], q[3]);
  });
  // Edge quads between faces on different axes: face F (axis A, sign sA) and face G (axis B,
  // sign sB) share the edge where coordinate A = sA·h and B = sB·h, running along the third axis
  // C. On F, the vertices next to it have sign sB on axis B; on G, sign sA on axis A.
  const cornerOf = (fi: number, signs: number[]) => {
    const [a, b] = others(faces[fi].axis);
    return vid.get(vkey(fi, signs[a], signs[b]))!;
  };
  for (let fi = 0; fi < 6; fi++) {
    for (let gi = fi + 1; gi < 6; gi++) {
      const F = faces[fi];
      const G = faces[gi];
      if (F.axis === G.axis || skipped(fi) || skipped(gi)) continue;
      const along = 3 - F.axis - G.axis;
      const signs = (alongSign: number) => {
        const s = [0, 0, 0];
        s[F.axis] = F.s;
        s[G.axis] = G.s;
        s[along] = alongSign;
        return s;
      };
      const quad = [cornerOf(fi, signs(-1)), cornerOf(fi, signs(1)), cornerOf(gi, signs(1)), cornerOf(gi, signs(-1))];
      pushTri(quad[0], quad[1], quad[2]);
      pushTri(quad[0], quad[2], quad[3]);
    }
  }
  // Corner triangles.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const s = [sx, sy, sz];
        const tri: number[] = [];
        let skip3 = false;
        for (let axis = 0; axis < 3; axis++) {
          const fi = faces.findIndex((f) => f.axis === axis && f.s === s[axis]);
          if (skipped(fi)) skip3 = true;
          const [a, b] = others(axis);
          tri.push(vid.get(vkey(fi, s[a], s[b]))!);
        }
        if (!skip3) pushTri(tri[0], tri[1], tri[2]);
      }
    }
  }
  return { positions, normals, indices };
}
