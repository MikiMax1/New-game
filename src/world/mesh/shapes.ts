// Primitive shape builders (boxes, beams, cylinders, prisms) writing into a MeshBuilder,
// with optional vertex colours. Used by structures and landmarks.
import type { MeshBuilder } from './meshData';

export type RGB = readonly [number, number, number];

/** sRGB hex to linear RGB (vertex colours are linear). */
export function hex(h: number): RGB {
  const c = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [c((h >> 16) & 255), c((h >> 8) & 255), c(h & 255)];
}

type V3 = [number, number, number];

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Quad from four corners in counter-clockwise order seen from the front; flat normal. */
export function quad(out: MeshBuilder, a: V3, b: V3, c: V3, d: V3, color?: RGB, uvScale = 0.5): void {
  const n = norm(cross(sub(b, a), sub(d, a)));
  // Planar UVs on the dominant axis plane.
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const uv = (p: V3): [number, number] => (ay > ax && ay > Math.abs(n[2]) ? [p[0], p[2]] : ax > Math.abs(n[2]) ? [p[2], p[1]] : [p[0], p[1]]);
  const ids = [a, b, c, d].map((p) => {
    const [u, v] = uv(p);
    return out.vertex(p[0], p[1], p[2], n[0], n[1], n[2], u * uvScale, v * uvScale, color);
  });
  out.quad(ids[0], ids[1], ids[2], ids[3]);
}

/** Oriented box: centre, half extents, rotation about Y. */
export function box(out: MeshBuilder, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw = 0, color?: RGB, uvScale = 0.5): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const P = (x: number, y: number, z: number): V3 => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
  const p000 = P(-hx, -hy, -hz), p100 = P(hx, -hy, -hz), p110 = P(hx, hy, -hz), p010 = P(-hx, hy, -hz);
  const p001 = P(-hx, -hy, hz), p101 = P(hx, -hy, hz), p111 = P(hx, hy, hz), p011 = P(-hx, hy, hz);
  quad(out, p001, p101, p111, p011, color, uvScale); // +z
  quad(out, p100, p000, p010, p110, color, uvScale); // -z
  quad(out, p101, p100, p110, p111, color, uvScale); // +x
  quad(out, p000, p001, p011, p010, color, uvScale); // -x
  quad(out, p011, p111, p110, p010, color, uvScale); // top
  quad(out, p000, p100, p101, p001, color, uvScale); // bottom
}

/** Square-section beam between two 3D points (truss members, cables, spokes). */
export function beam(out: MeshBuilder, a: V3, b: V3, thickness: number, color?: RGB): void {
  const dir = norm(sub(b, a));
  const up: V3 = Math.abs(dir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(dir, up));
  const v = norm(cross(u, dir));
  const h = thickness / 2;
  const corner = (p: V3, su: number, sv: number): V3 => [p[0] + (u[0] * su + v[0] * sv) * h, p[1] + (u[1] * su + v[1] * sv) * h, p[2] + (u[2] * su + v[2] * sv) * h];
  const A = [corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1)];
  const B = [corner(b, -1, -1), corner(b, 1, -1), corner(b, 1, 1), corner(b, -1, 1)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(out, A[i], B[i], B[j], A[j], color);
  }
}

/** Cylinder or cone frustum along +Y from y0 to y1, optional caps. */
export function cylinder(out: MeshBuilder, cx: number, y0: number, cz: number, r0: number, r1: number, height: number, segments: number, color?: RGB, caps = true, uvScale = 0.5): void {
  const y1 = y0 + height;
  const slope = (r0 - r1) / height;
  const ring0: number[] = [];
  const ring1: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const l = Math.hypot(1, slope);
    const nx = ca / l;
    const ny = slope / l;
    const nz = sa / l;
    const u = (i / segments) * 2 * Math.PI * Math.max(r0, r1) * uvScale;
    ring0.push(out.vertex(cx + ca * r0, y0, cz + sa * r0, nx, ny, nz, u, y0 * uvScale, color));
    ring1.push(out.vertex(cx + ca * r1, y1, cz + sa * r1, nx, ny, nz, u, y1 * uvScale, color));
  }
  for (let i = 0; i < segments; i++) out.quad(ring0[i], ring1[i], ring1[i + 1], ring0[i + 1]);
  if (!caps) return;
  for (const [y, r, up] of [[y1, r1, 1], [y0, r0, -1]] as const) {
    if (r <= 0) continue;
    const c = out.vertex(cx, y, cz, 0, up, 0, cx * uvScale, cz * uvScale, color);
    const ring: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      ring.push(out.vertex(x, y, z, 0, up, 0, x * uvScale, z * uvScale, color));
    }
    for (let i = 0; i < segments; i++) {
      if (up > 0) out.tri(c, ring[i + 1], ring[i]);
      else out.tri(c, ring[i], ring[i + 1]);
    }
  }
}

/** Vertical prism from a positive-winding XZ polygon (walls + flat top). */
export function prism(out: MeshBuilder, ring: { x: number; z: number }[], y0: number, y1: number, color?: RGB, top = true, uvScale = 0.25): void {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    // Outward faces for a positive ring: (b.bottom, a.bottom, a.top, b.top) order.
    quad(out, [b.x, y0, b.z], [a.x, y0, a.z], [a.x, y1, a.z], [b.x, y1, b.z], color, uvScale);
  }
  if (!top) return;
  // Fan triangulation is fine for the convex outlines used here.
  const ids = ring.map((p) => out.vertex(p.x, y1, p.z, 0, 1, 0, p.x * uvScale, p.z * uvScale, color));
  for (let i = 1; i + 1 < n; i++) {
    // Positive rings are clockwise seen from above, so (0, i+1, i) faces up.
    out.tri(ids[0], ids[i + 1], ids[i]);
  }
}
