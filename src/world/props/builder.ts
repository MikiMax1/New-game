// Geometry toolkit for props: a transform stack over MeshBuilder plus the primitives the
// prop builders need (boxes, hexahedra, lathes, swept tubes, extrusions, cards, discs).
// Pure math (three.js maths classes only), so it runs in workers and in node tests.

import * as THREE from 'three';
import earcut from 'earcut';
import { MeshBuilder } from '../mesh/meshData';
import { Rng } from '../rng';
import type { UvRect } from './atlas';
import { MATERIAL_INFO, type MaterialKey, type PropId, type PropLightData, type PropModelData } from './types';

export type RGB = readonly [number, number, number];
export type Wind4 = readonly [number, number, number, number];
export type V3 = THREE.Vector3;

export const WHITE: RGB = [1, 1, 1];
export const NO_WIND: Wind4 = [0, 0, 0, 0];
export const FULL_RECT: UvRect = { u0: 0, v0: 0, u1: 1, v1: 1 };

const _col = new THREE.Color();
/** sRGB hex colour -> linear RGB (vertex colours are linear), optionally scaled. */
export function rgb(hex: number, scale = 1): RGB {
  _col.setHex(hex);
  return [_col.r * scale, _col.g * scale, _col.b * scale];
}
export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function mulRgb(a: RGB, k: number | RGB): RGB {
  return typeof k === 'number' ? [a[0] * k, a[1] * k, a[2] * k] : [a[0] * k[0], a[1] * k[1], a[2] * k[2]];
}

export const v3 = (x = 0, y = 0, z = 0): V3 => new THREE.Vector3(x, y, z);
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export type BoxFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

export interface BoxOpts {
  /** Metres per texture repeat for metric UVs (default 1). */
  uvScale?: number;
  /** Faces to leave out. */
  skip?: readonly BoxFace[];
  /** Map a face to an atlas rectangle (the image reads upright from outside the face). */
  rects?: Partial<Record<BoxFace, UvRect>>;
  /** Per-face colour override. */
  colors?: Partial<Record<BoxFace, RGB>>;
  /** Swap metric u and v (e.g. wood grain along a horizontal slat). */
  swap?: boolean;
}

export interface LatheOpts {
  /** Share normals between profile segments (smooth curve) instead of a crisp profile. */
  smooth?: boolean;
  /** Atlas rectangle: u wraps around once, v follows the profile length. */
  rect?: UvRect;
  /** With a rect: tile v every `vTile` metres (the texture must repeat in v). */
  vTile?: number;
  /** Without a rect: metres per texture repeat (metric UVs). */
  uvScale?: number;
  capBottom?: boolean;
  capTop?: boolean;
  /** Start angle (radians). */
  phase?: number;
  /** Swept angle (radians, default full turn). */
  arc?: number;
  /** Per-profile-point colours. */
  colors?: readonly RGB[];
  /** Per-profile-point wind data. */
  winds?: readonly Wind4[];
}

export interface TubeOpts {
  rect?: UvRect;
  /** Metres per v repeat (texture must repeat in v); otherwise v spans the rect once. */
  vTile?: number;
  uvScale?: number;
  capStart?: boolean;
  capEnd?: boolean;
  colors?: readonly RGB[];
  winds?: readonly Wind4[];
  /** Reference direction for the first ring's 0-angle (default +X, or +Z if the path starts along X). */
  ref?: V3;
  /** Rotate the ring start angle (radians). */
  phase?: number;
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** One material bucket of a prop, with a transform stack. */
export class Part {
  readonly mesh = new MeshBuilder();
  /** Default vertex colour (linear RGB). */
  color: RGB = WHITE;
  /** Default wind data: [sway metres, flutter metres, phase 0-1, spare]. */
  wind: Wind4 = NO_WIND;
  /** Signal lens type for the next vertices (SIGNAL_LENS). */
  signal = 0;
  readonly hasWind: boolean;
  readonly hasSignal: boolean;
  private readonly m = new THREE.Matrix4();
  private readonly nm = new THREE.Matrix3();
  private readonly stack: THREE.Matrix4[] = [];

  constructor(readonly key: MaterialKey, readonly castShadow: boolean) {
    const info = MATERIAL_INFO[key];
    this.hasWind = info.wind;
    this.hasSignal = !!info.signal;
    if (this.hasWind) this.mesh.declareExtra('aWind', 4);
    if (this.hasSignal) this.mesh.declareExtra('aSignal', 1);
  }

  // ---- transform stack --------------------------------------------------------------
  push(): this {
    this.stack.push(this.m.clone());
    return this;
  }
  pop(): this {
    const m = this.stack.pop();
    if (m) this.setMatrix(m);
    return this;
  }
  setMatrix(mat: THREE.Matrix4): this {
    this.m.copy(mat);
    this.nm.getNormalMatrix(this.m);
    return this;
  }
  apply(mat: THREE.Matrix4): this {
    this.m.multiply(mat);
    this.nm.getNormalMatrix(this.m);
    return this;
  }
  translate(x: number, y: number, z: number): this {
    return this.apply(_m.makeTranslation(x, y, z));
  }
  rotateX(a: number): this {
    return this.apply(_m.makeRotationX(a));
  }
  rotateY(a: number): this {
    return this.apply(_m.makeRotationY(a));
  }
  rotateZ(a: number): this {
    return this.apply(_m.makeRotationZ(a));
  }
  scale(x: number, y: number, z: number): this {
    return this.apply(_m.makeScale(x, y, z));
  }
  /** Orient local +Y along `dir` (and local +Z roughly along `zHint`), positioned at `at`. */
  orient(at: V3, dir: V3, zHint: V3 = new THREE.Vector3(0, 0, 1)): this {
    const y = dir.clone().normalize();
    let x = new THREE.Vector3().crossVectors(y, zHint);
    if (x.lengthSq() < 1e-8) x = new THREE.Vector3().crossVectors(y, new THREE.Vector3(1, 0, 0));
    x.normalize();
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    return this.apply(_m.makeBasis(x, y, z).setPosition(at));
  }

  // ---- raw vertices -----------------------------------------------------------------
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, v = 0, color: RGB = this.color, wind: Wind4 = this.wind): number {
    _p.set(x, y, z).applyMatrix4(this.m);
    _n.set(nx, ny, nz).applyMatrix3(this.nm).normalize();
    let extra: Record<string, readonly number[]> | undefined;
    if (this.hasWind) extra = { aWind: wind };
    else if (this.hasSignal) extra = { aSignal: [this.signal] };
    return this.mesh.vertex(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z, u, v, color, extra);
  }
  vtx(p: V3, n: V3, u = 0, v = 0, color: RGB = this.color, wind: Wind4 = this.wind): number {
    return this.vert(p.x, p.y, p.z, n.x, n.y, n.z, u, v, color, wind);
  }
  tri(a: number, b: number, c: number): void {
    this.mesh.tri(a, b, c);
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.mesh.quad(a, b, c, d);
  }

  // ---- flat faces -------------------------------------------------------------------
  /**
   * Convex planar polygon (counter-clockwise seen from the front), fan-triangulated, flat
   * normal. `uvs` per point, or metric UVs projected on the face plane.
   */
  face(pts: readonly V3[], uvs?: readonly (readonly [number, number])[], uvScale = 1, color: RGB = this.color): void {
    const n = newellNormal(pts);
    let t: V3 | null = null;
    let bt: V3 | null = null;
    if (!uvs) {
      t = new THREE.Vector3().crossVectors(UP, n);
      if (t.lengthSq() < 1e-6) t.set(1, 0, 0);
      t.normalize();
      bt = new THREE.Vector3().crossVectors(n, t).normalize();
    }
    const base = this.mesh.vertexCount;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const uv = uvs ? uvs[i] : [p.dot(t!) / uvScale, p.dot(bt!) / uvScale];
      this.vert(p.x, p.y, p.z, n.x, n.y, n.z, uv[0], uv[1], color);
    }
    for (let i = 1; i < pts.length - 1; i++) this.tri(base, base + i, base + i + 1);
  }

  /** Quad p0..p3 CCW from the front; the rect maps p0 = (u0,v0) .. p2 = (u1,v1). */
  quad4(p0: V3, p1: V3, p2: V3, p3: V3, rect: UvRect | null = null, uvScale = 1, color: RGB = this.color): void {
    if (rect) {
      this.face([p0, p1, p2, p3], [[rect.u0, rect.v0], [rect.u1, rect.v0], [rect.u1, rect.v1], [rect.u0, rect.v1]], 1, color);
    } else {
      this.face([p0, p1, p2, p3], undefined, uvScale, color);
    }
  }

  /** Axis-aligned box in the current frame. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, opts: BoxOpts = {}): void {
    const x = sx / 2, y = sy / 2, z = sz / 2;
    const s = opts.uvScale ?? 1;
    const faces: Record<BoxFace, [number, number, number][]> = {
      nz: [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]],
      pz: [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]],
      px: [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]],
      nx: [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]],
      py: [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]],
      ny: [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]],
    };
    const dims: Record<BoxFace, [number, number]> = { nz: [sx, sy], pz: [sx, sy], px: [sz, sy], nx: [sz, sy], py: [sx, sz], ny: [sx, sz] };
    for (const f of ['nz', 'pz', 'px', 'nx', 'py', 'ny'] as BoxFace[]) {
      if (opts.skip?.includes(f)) continue;
      const c = faces[f].map(([a, b, d]) => v3(cx + a, cy + b, cz + d));
      const color = opts.colors?.[f] ?? this.color;
      const rect = opts.rects?.[f];
      if (rect) {
        this.quad4(c[0], c[1], c[2], c[3], rect, 1, color);
      } else {
        const [w, h] = dims[f];
        const ou = (cx + cz) / s, ov = cy / s;
        const uv: [number, number][] = [[ou, ov], [ou + w / s, ov], [ou + w / s, ov + h / s], [ou, ov + h / s]];
        this.face(c, opts.swap ? uv.map(([a, b]) => [b, a] as [number, number]) : uv, 1, color);
      }
    }
  }

  /**
   * Hexahedron from 8 corners: bottom ring b0..b3 then top ring t0..t3, each counter-clockwise
   * seen from above. Flat faces, metric UVs. `skip` uses the box face names relative to the ring
   * order: 'ny' bottom, 'py' top, and sides 's0'..'s3' (edge i -> i+1).
   */
  hexa(c: readonly V3[], uvScale = 1, skip: readonly string[] = [], colors: Partial<Record<string, RGB>> = {}): void {
    const [b0, b1, b2, b3, t0, t1, t2, t3] = c;
    if (!skip.includes('ny')) this.face([b0, b3, b2, b1], undefined, uvScale, colors.ny ?? this.color);
    if (!skip.includes('py')) this.face([t0, t1, t2, t3], undefined, uvScale, colors.py ?? this.color);
    const bot = [b0, b1, b2, b3];
    const top = [t0, t1, t2, t3];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      if (skip.includes('s' + i)) continue;
      // The ring is CCW from above, so (b_i, b_j, t_j, t_i) is CCW seen from outside.
      this.face([bot[i], bot[j], top[j], top[i]], undefined, uvScale, colors['s' + i] ?? this.color);
    }
  }

  /** Surface of revolution around local +Y. profile = [radius, y] from bottom to top. */
  lathe(profile: readonly (readonly [number, number])[], sides: number, opts: LatheOpts = {}): void {
    const phase = opts.phase ?? 0;
    const arc = opts.arc ?? Math.PI * 2;
    const full = Math.abs(arc - Math.PI * 2) < 1e-6;
    const np = profile.length;
    // Cumulative profile length for v.
    const len: number[] = [0];
    for (let i = 1; i < np; i++) len.push(len[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
    const total = len[np - 1] || 1;
    const vOf = (i: number): number => {
      if (opts.rect) return opts.vTile ? opts.rect.v0 + len[i] / opts.vTile : opts.rect.v0 + (opts.rect.v1 - opts.rect.v0) * (len[i] / total);
      return len[i] / (opts.uvScale ?? 1);
    };
    const uOf = (k: number, r: number): number => {
      if (opts.rect) return opts.rect.u0 + (opts.rect.u1 - opts.rect.u0) * (k / sides);
      return ((arc * r) / (opts.uvScale ?? 1)) * (k / sides);
    };
    // Segment normals in the profile plane: (dy, -dr) normalised.
    const segN: [number, number][] = [];
    for (let i = 0; i < np - 1; i++) {
      const dr = profile[i + 1][0] - profile[i][0];
      const dy = profile[i + 1][1] - profile[i][1];
      const l = Math.hypot(dr, dy) || 1;
      segN.push([dy / l, -dr / l]);
    }
    const ring = (i: number, nr: number, ny: number): number => {
      const [r, y] = profile[i];
      const base = this.mesh.vertexCount;
      const color = opts.colors?.[i] ?? this.color;
      const wind = opts.winds?.[i] ?? this.wind;
      for (let k = 0; k <= sides; k++) {
        const th = phase + (arc * k) / sides;
        const c = Math.cos(th), s = -Math.sin(th);
        this.vert(r * c, y, r * s, nr * c, ny, nr * s, uOf(k, r), vOf(i), color, wind);
      }
      return base;
    };
    const stitch = (lo: number, hi: number) => {
      for (let k = 0; k < sides; k++) this.quad(lo + k, lo + k + 1, hi + k + 1, hi + k);
    };
    if (opts.smooth) {
      let prev = -1;
      for (let i = 0; i < np; i++) {
        const a = segN[Math.max(0, i - 1)];
        const b = segN[Math.min(np - 2, i)];
        let nr = a[0] + b[0], ny = a[1] + b[1];
        const l = Math.hypot(nr, ny) || 1;
        nr /= l; ny /= l;
        const cur = ring(i, nr, ny);
        if (prev >= 0) stitch(prev, cur);
        prev = cur;
      }
    } else {
      for (let i = 0; i < np - 1; i++) {
        const [nr, ny] = segN[i];
        if (Math.abs(profile[i][0]) < 1e-9 && Math.abs(profile[i + 1][0]) < 1e-9) continue;
        const lo = ring(i, nr, ny);
        const hi = ring(i + 1, nr, ny);
        stitch(lo, hi);
      }
    }
    const cap = (i: number, up: boolean) => {
      const [r, y] = profile[i];
      if (r <= 1e-6) return;
      const base = this.mesh.vertexCount;
      const color = opts.colors?.[i] ?? this.color;
      const wind = opts.winds?.[i] ?? this.wind;
      const s = opts.uvScale ?? 1;
      const cu = opts.rect ? (opts.rect.u0 + opts.rect.u1) / 2 : 0;
      const cv = opts.rect ? (opts.rect.v0 + opts.rect.v1) / 2 : 0;
      const ru = opts.rect ? (opts.rect.u1 - opts.rect.u0) / 2 : r / s;
      const rv = opts.rect ? (opts.rect.v1 - opts.rect.v0) / 2 : r / s;
      const n = full ? sides : sides + 1;
      for (let k = 0; k < n; k++) {
        const th = phase + (arc * k) / sides;
        const c = Math.cos(th), sn = -Math.sin(th);
        this.vert(r * c, y, r * sn, 0, up ? 1 : -1, 0, cu + ru * c, cv - rv * sn, color, wind);
      }
      for (let k = 1; k < n - 1; k++) {
        if (up) this.tri(base, base + k, base + k + 1);
        else this.tri(base, base + k + 1, base + k);
      }
    };
    if (opts.capBottom) cap(0, false);
    if (opts.capTop) cap(np - 1, true);
  }

  /** Cylinder / cone frustum standing on (x, y, z), axis +Y. */
  cylinder(x: number, y: number, z: number, r0: number, r1: number, h: number, sides: number, opts: LatheOpts = {}): void {
    this.push().translate(x, y, z);
    this.lathe([[r0, 0], [r1, h]], sides, { capTop: true, ...opts });
    this.pop();
  }

  /** Tube swept along a path with per-point radii (parallel-transport frames). */
  tube(path: readonly V3[], radii: readonly number[], sides: number, opts: TubeOpts = {}): void {
    const n = path.length;
    if (n < 2) return;
    const T: V3[] = [];
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)];
      const b = path[Math.min(n - 1, i + 1)];
      T.push(b.clone().sub(a).normalize());
    }
    const N: V3[] = [];
    let ref = opts.ref ? opts.ref.clone() : new THREE.Vector3(1, 0, 0);
    if (Math.abs(ref.dot(T[0])) > 0.95) ref = new THREE.Vector3(0, 0, 1);
    N.push(ref.sub(T[0].clone().multiplyScalar(ref.dot(T[0]))).normalize());
    for (let i = 1; i < n; i++) {
      const prev = N[i - 1];
      const cur = prev.clone().sub(T[i].clone().multiplyScalar(prev.dot(T[i])));
      if (cur.lengthSq() < 1e-10) cur.copy(prev);
      N.push(cur.normalize());
    }
    const len: number[] = [0];
    for (let i = 1; i < n; i++) len.push(len[i - 1] + path[i].distanceTo(path[i - 1]));
    const total = len[n - 1] || 1;
    const phase = opts.phase ?? 0;
    const rings: number[] = [];
    for (let i = 0; i < n; i++) {
      const B = new THREE.Vector3().crossVectors(T[i], N[i]).normalize();
      const dr = (radii[Math.min(n - 1, i + 1)] - radii[Math.max(0, i - 1)]) / Math.max(1e-6, len[Math.min(n - 1, i + 1)] - len[Math.max(0, i - 1)]);
      const color = opts.colors?.[i] ?? this.color;
      const wind = opts.winds?.[i] ?? this.wind;
      let v: number;
      if (opts.rect) v = opts.vTile ? opts.rect.v0 + len[i] / opts.vTile : opts.rect.v0 + (opts.rect.v1 - opts.rect.v0) * (len[i] / total);
      else v = len[i] / (opts.uvScale ?? 1);
      rings.push(this.mesh.vertexCount);
      for (let k = 0; k <= sides; k++) {
        const th = phase + (Math.PI * 2 * k) / sides;
        _a.copy(N[i]).multiplyScalar(Math.cos(th)).addScaledVector(B, Math.sin(th));
        const p = _b.copy(path[i]).addScaledVector(_a, radii[i]);
        const nn = _c.copy(_a).addScaledVector(T[i], -dr).normalize();
        const u = opts.rect ? opts.rect.u0 + (opts.rect.u1 - opts.rect.u0) * (k / sides) : ((Math.PI * 2 * radii[i]) / (opts.uvScale ?? 1)) * (k / sides);
        this.vert(p.x, p.y, p.z, nn.x, nn.y, nn.z, u, v, color, wind);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const lo = rings[i], hi = rings[i + 1];
      for (let k = 0; k < sides; k++) this.quad(lo + k, lo + k + 1, hi + k + 1, hi + k);
    }
    const cap = (i: number, end: boolean) => {
      if (radii[i] <= 1e-6) return;
      const B = new THREE.Vector3().crossVectors(T[i], N[i]).normalize();
      const nrm = T[i].clone().multiplyScalar(end ? 1 : -1);
      const base = this.mesh.vertexCount;
      const color = opts.colors?.[i] ?? this.color;
      const wind = opts.winds?.[i] ?? this.wind;
      for (let k = 0; k < sides; k++) {
        const th = phase + (Math.PI * 2 * k) / sides;
        const p = _b.copy(path[i]).addScaledVector(N[i], Math.cos(th) * radii[i]).addScaledVector(B, Math.sin(th) * radii[i]);
        const cu = opts.rect ? (opts.rect.u0 + opts.rect.u1) / 2 : 0;
        const cv = opts.rect ? (opts.rect.v0 + opts.rect.v1) / 2 : 0;
        this.vert(p.x, p.y, p.z, nrm.x, nrm.y, nrm.z, cu, cv, color, wind);
      }
      for (let k = 1; k < sides - 1; k++) {
        if (end) this.tri(base, base + k, base + k + 1);
        else this.tri(base, base + k + 1, base + k);
      }
    };
    if (opts.capStart) cap(0, false);
    if (opts.capEnd) cap(n - 1, true);
  }

  /**
   * Polygon in the local XY plane extruded along Z from -depth/2 to +depth/2 (earcut, so
   * concave outlines work). The FRONT face looks towards -Z; its rect maps so the image reads
   * upright to a viewer standing at -Z. The back face uses `backRect` or metric UVs.
   */
  extrude(poly: readonly (readonly [number, number])[], depth: number, opts: { frontRect?: UvRect; backRect?: UvRect; sides?: boolean; uvScale?: number; frontColor?: RGB; backColor?: RGB; sideColor?: RGB; back?: boolean; front?: boolean } = {}): void {
    const flat: number[] = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of poly) {
      flat.push(x, y);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    // Signed area (CCW positive in XY seen from +Z).
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      area += x0 * y1 - x1 * y0;
    }
    const ccw = area > 0;
    const raw = earcut(flat);
    // Normalise every triangle to CCW in XY (seen from +Z).
    const tris: number[] = [];
    for (let i = 0; i < raw.length; i += 3) {
      const [a, b, c] = [raw[i], raw[i + 1], raw[i + 2]];
      const [ax, ay] = poly[a], [bx, by] = poly[b], [cx, cy] = poly[c];
      const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (cross >= 0) tris.push(a, b, c);
      else tris.push(a, c, b);
    }
    const z0 = -depth / 2, z1 = depth / 2;
    const s = opts.uvScale ?? 1;
    const w = maxX - minX || 1, h = maxY - minY || 1;
    // Front (-Z): the viewer's right is -X, and CCW-from-the-front means CW in XY.
    if (opts.front !== false) {
      const base = this.mesh.vertexCount;
      const r = opts.frontRect;
      for (const [x, y] of poly) {
        const u = r ? r.u0 + ((maxX - x) / w) * (r.u1 - r.u0) : -x / s;
        const v = r ? r.v0 + ((y - minY) / h) * (r.v1 - r.v0) : y / s;
        this.vert(x, y, z0, 0, 0, -1, u, v, opts.frontColor ?? this.color);
      }
      for (let i = 0; i < tris.length; i += 3) this.tri(base + tris[i], base + tris[i + 2], base + tris[i + 1]);
    }
    if (opts.back !== false) {
      const base = this.mesh.vertexCount;
      const r = opts.backRect;
      for (const [x, y] of poly) {
        const u = r ? r.u0 + ((x - minX) / w) * (r.u1 - r.u0) : x / s;
        const v = r ? r.v0 + ((y - minY) / h) * (r.v1 - r.v0) : y / s;
        this.vert(x, y, z1, 0, 0, 1, u, v, opts.backColor ?? this.color);
      }
      for (let i = 0; i < tris.length; i += 3) this.tri(base + tris[i], base + tris[i + 1], base + tris[i + 2]);
    }
    if (opts.sides !== false && depth > 0) {
      let acc = 0;
      for (let i = 0; i < poly.length; i++) {
        const [x0, y0] = poly[i];
        const [x1, y1] = poly[(i + 1) % poly.length];
        const l = Math.hypot(x1 - x0, y1 - y0);
        if (l < 1e-9) continue;
        // Outward normal of edge in XY.
        let nx = (y1 - y0) / l, ny = -(x1 - x0) / l;
        if (!ccw) { nx = -nx; ny = -ny; }
        const base = this.mesh.vertexCount;
        const c = opts.sideColor ?? this.color;
        this.vert(x0, y0, z0, nx, ny, 0, acc / s, 0, c);
        this.vert(x1, y1, z0, nx, ny, 0, (acc + l) / s, 0, c);
        this.vert(x1, y1, z1, nx, ny, 0, (acc + l) / s, depth / s, c);
        this.vert(x0, y0, z1, nx, ny, 0, acc / s, depth / s, c);
        if (ccw) this.quad(base, base + 1, base + 2, base + 3);
        else this.quad(base, base + 3, base + 2, base + 1);
        acc += l;
      }
    }
  }

  /** Flat regular polygon (disc) in the local XZ plane facing +Y, UVs inscribed in `rect`. */
  disc(cx: number, cy: number, cz: number, radius: number, sides: number, rect: UvRect | null = null, phase = 0): void {
    const base = this.mesh.vertexCount;
    const cu = rect ? (rect.u0 + rect.u1) / 2 : 0.5, cv = rect ? (rect.v0 + rect.v1) / 2 : 0.5;
    const ru = rect ? (rect.u1 - rect.u0) / 2 : 0.5, rv = rect ? (rect.v1 - rect.v0) / 2 : 0.5;
    for (let k = 0; k < sides; k++) {
      const th = phase + (Math.PI * 2 * k) / sides;
      const c = Math.cos(th), s = -Math.sin(th);
      this.vert(cx + radius * c, cy, cz + radius * s, 0, 1, 0, cu + ru * c, cv - rv * s);
    }
    for (let k = 1; k < sides - 1; k++) this.tri(base, base + k, base + k + 1);
  }

  /** Smooth low-poly ellipsoid (octahedron, 8 triangles). */
  octa(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, u = 0, v = 0): void {
    const b = this.mesh.vertexCount;
    const pts: [number, number, number][] = [[1, 0, 0], [0, 0, -1], [-1, 0, 0], [0, 0, 1], [0, 1, 0], [0, -1, 0]];
    for (const [x, y, z] of pts) this.vert(cx + x * rx, cy + y * ry, cz + z * rz, x, y, z, u, v);
    for (let k = 0; k < 4; k++) {
      const a = b + k, c = b + ((k + 1) % 4);
      this.tri(a, c, b + 4);
      this.tri(c, a, b + 5);
    }
  }

  /** Low-poly UV sphere / ellipsoid (smooth normals). */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, sides: number, rings: number, rect: UvRect | null = null): void {
    const profile: [number, number][] = [];
    for (let i = 0; i <= rings; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / rings;
      profile.push([Math.cos(a), Math.sin(a)]);
    }
    this.push().translate(cx, cy, cz).scale(rx, ry, rz);
    this.lathe(profile, sides, { smooth: true, rect: rect ?? undefined });
    this.pop();
  }
}

/** Polygon normal by Newell's method. */
export function newellNormal(pts: readonly V3[]): V3 {
  const n = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n.normalize();
}

/** Collects the parts of one prop model variant and produces PropModelData. */
export class PropBuild {
  readonly parts = new Map<MaterialKey, Part>();
  readonly lights: PropLightData[] = [];
  readonly anchors: { name: string; position: [number, number, number] }[] = [];
  readonly rng: Rng;

  constructor(readonly id: PropId, readonly variant: number, readonly detail: number) {
    this.rng = new Rng(`prop:${id}:${variant}`);
  }

  part(key: MaterialKey): Part {
    let p = this.parts.get(key);
    if (!p) {
      p = new Part(key, MATERIAL_INFO[key].castShadow);
      this.parts.set(key, p);
    }
    return p;
  }

  /** Segment count scaled by the detail level. */
  seg(n: number, min = 3): number {
    return Math.max(min, Math.round(n * this.detail));
  }

  light(x: number, y: number, z: number, color: RGB, intensity: number, kind: PropLightData['kind']): void {
    this.lights.push({ position: [x, y, z], color: [color[0], color[1], color[2]], intensity, kind });
  }

  anchor(name: string, x: number, y: number, z: number): void {
    this.anchors.push({ name, position: [x, y, z] });
  }

  finish(): PropModelData {
    const parts: PropModelData['parts'] = [];
    let r2 = 0, top = 0;
    for (const [key, p] of this.parts) {
      if (p.mesh.isEmpty) continue;
      const mesh = p.mesh.build();
      const pos = mesh.positions;
      for (let i = 0; i < pos.length; i += 3) {
        r2 = Math.max(r2, pos[i] * pos[i] + pos[i + 2] * pos[i + 2]);
        top = Math.max(top, pos[i + 1]);
      }
      parts.push({ materialKey: key, mesh, castShadow: p.castShadow });
    }
    const out: PropModelData = {
      id: this.id,
      variant: this.variant,
      parts,
      radius: Math.ceil(Math.sqrt(r2) * 100 + 1) / 100,
      height: Math.ceil(top * 100 + 1) / 100,
    };
    if (this.lights.length) out.lights = this.lights;
    if (this.anchors.length) out.anchors = this.anchors;
    return out;
  }
}
