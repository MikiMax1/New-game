// Pitched roofs on rectangular volumes (local frame rectangles): hip, gable, shed and
// sawtooth. UVs on roof slopes: u = metres along the eave, v = metres up the slope, so
// the tile / metal shaders can lay courses parallel to the eaves.

import type { RGB } from './colors';
import { DSURF } from './constants';
import type { Emitter, FacadeSpec, UV4, V3 } from './emit';
import { Frame, type Rect, rectD, rectRot90, rectW } from './geom';

export interface PitchedRoof {
  /** Rise over run (tan of the pitch angle). */
  pitch: number;
  overhang: number;
  col: RGB;
  surf: number;
  /** Soffit / fascia colour. */
  trim: RGB;
  lod: 0 | 1;
}

function P(f: Frame, x: number, y: number, z: number): V3 {
  const w = f.toWorld(x, z);
  return [w.x, y, w.z];
}

function normalOf(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/** Quad whose winding is fixed so its normal points along `expect`. */
function oquad(em: Emitter, a: V3, b: V3, c: V3, d: V3, uv: UV4, expect: V3, col: RGB, surf: number, p1 = 0): void {
  const n = normalOf(a, b, c);
  if (n[0] * expect[0] + n[1] * expect[1] + n[2] * expect[2] >= 0) em.quad(a, b, c, d, uv, col, surf, p1);
  else em.quad(a, d, c, b, [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]], col, surf, p1);
}

function otri(em: Emitter, a: V3, b: V3, c: V3, uv: readonly [number, number, number, number, number, number], expect: V3, col: RGB, surf: number): void {
  const n = normalOf(a, b, c);
  if (n[0] * expect[0] + n[1] * expect[1] + n[2] * expect[2] >= 0) em.tri(a, b, c, uv, col, surf);
  else em.tri(a, c, b, [uv[0], uv[1], uv[4], uv[5], uv[2], uv[3]], col, surf);
}

function dirUp(f: Frame, x: number, z: number, up: number): V3 {
  const d = f.dir(x, z);
  return [d.x, up, d.z];
}

/** Hip roof over a local rectangle whose walls end at yWallTop. Returns the ridge height. */
export function hipRoof(em: Emitter, frame: Frame, r: Rect, yWallTop: number, o: PitchedRoof): number {
  let f = frame;
  let rr = r;
  if (rectW(r) < rectD(r)) {
    f = frame.rot90();
    rr = rectRot90(r);
  }
  const { x0, x1, z0, z1 } = rr;
  const hd = (z1 - z0) / 2;
  const zc = (z0 + z1) / 2;
  const ov = o.overhang;
  const k = o.pitch;
  const X0 = x0 - ov;
  const X1 = x1 + ov;
  const Z0 = z0 - ov;
  const Z1 = z1 + ov;
  const yE = yWallTop - ov * k;
  const yR = yWallTop + hd * k;
  const xr0 = x0 + hd;
  const xr1 = Math.max(xr0, x1 - hd);
  const sec = Math.sqrt(1 + k * k);
  const vR = (hd + ov) * sec;
  const E00 = P(f, X0, yE, Z0);
  const E10 = P(f, X1, yE, Z0);
  const E01 = P(f, X0, yE, Z1);
  const E11 = P(f, X1, yE, Z1);
  const R0 = P(f, xr0, yR, zc);
  const R1 = P(f, xr1, yR, zc);
  const up = 1;
  if (xr1 - xr0 > 1e-3) {
    oquad(em, E00, E10, R1, R0, [X1 - X0, 0, 0, 0, X1 - xr1, vR, X1 - xr0, vR], dirUp(f, 0, -1, up), o.col, o.surf);
    oquad(em, E11, E01, R0, R1, [X1 - X0, 0, 0, 0, xr0 - X0, vR, xr1 - X0, vR], dirUp(f, 0, 1, up), o.col, o.surf);
  } else {
    otri(em, E00, E10, R0, [X1 - X0, 0, 0, 0, X1 - xr0, vR], dirUp(f, 0, -1, up), o.col, o.surf);
    otri(em, E11, E01, R0, [X1 - X0, 0, 0, 0, xr0 - X0, vR], dirUp(f, 0, 1, up), o.col, o.surf);
  }
  otri(em, E01, E00, R0, [Z1 - Z0, 0, 0, 0, zc - Z0, vR], dirUp(f, -1, 0, up), o.col, o.surf);
  otri(em, E10, E11, R1, [0, 0, Z1 - Z0, 0, zc - Z0, vR], dirUp(f, 1, 0, up), o.col, o.surf);
  if (o.lod === 0 && ov > 0.05) eaveTrim(em, f, rr, { X0, X1, Z0, Z1 }, yE, o.trim);
  return yR;
}

/** Fascia band around the eave rectangle and the soffit back to the walls. */
function eaveTrim(em: Emitter, f: Frame, w: Rect, e: { X0: number; X1: number; Z0: number; Z1: number }, yE: number, col: RGB): void {
  const fh = 0.2;
  const eave = f.rect(e.X0, e.X1, e.Z0, e.Z1);
  const wall = f.rect(w.x0, w.x1, w.z0, w.z1);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    em.vquad(eave[i], eave[j], yE - fh, yE, col, DSURF.PLAIN);
    em.hquad(eave[i], eave[j], wall[j], wall[i], yE - fh, false, col, DSURF.PLAIN, f);
  }
}

/**
 * Gable roof: ridge along the local x axis (or the longer side when ridgeAlongX is undefined).
 * Gable-end triangles go to the facade bucket with `spec` (blank above topH).
 */
export function gableRoof(em: Emitter, frame: Frame, r: Rect, yWallTop: number, o: PitchedRoof, spec: FacadeSpec, ridgeAlongX?: boolean): number {
  let f = frame;
  let rr = r;
  const alongX = ridgeAlongX ?? rectW(r) >= rectD(r);
  if (!alongX) {
    f = frame.rot90();
    rr = rectRot90(r);
  }
  const { x0, x1, z0, z1 } = rr;
  const hd = (z1 - z0) / 2;
  const zc = (z0 + z1) / 2;
  const ov = o.overhang;
  const rk = ov * 0.8;
  const k = o.pitch;
  const X0 = x0 - rk;
  const X1 = x1 + rk;
  const Z0 = z0 - ov;
  const Z1 = z1 + ov;
  const yE = yWallTop - ov * k;
  const yR = yWallTop + hd * k;
  const sec = Math.sqrt(1 + k * k);
  const vR = (hd + ov) * sec;
  const up = 1;
  const a = P(f, X0, yE, Z0);
  const b = P(f, X1, yE, Z0);
  const c = P(f, X1, yR, zc);
  const d = P(f, X0, yR, zc);
  oquad(em, a, b, c, d, [X1 - X0, 0, 0, 0, 0, vR, X1 - X0, vR], dirUp(f, 0, -1, up), o.col, o.surf);
  const a2 = P(f, X0, yE, Z1);
  const b2 = P(f, X1, yE, Z1);
  oquad(em, b2, a2, d, c, [X1 - X0, 0, 0, 0, 0, vR, X1 - X0, vR], dirUp(f, 0, 1, up), o.col, o.surf);
  // gable ends (walls)
  const ring = f.rect(x0, x1, z0, z1);
  em.gable(ring[1], ring[2], yWallTop, yR, spec);
  em.gable(ring[3], ring[0], yWallTop, yR, spec);
  if (o.lod === 0 && ov > 0.05) {
    const fh = 0.2;
    // eave fascia (full length) and soffits between the gable walls
    const e0 = f.toWorld(X0, Z0);
    const e1 = f.toWorld(X1, Z0);
    const e2 = f.toWorld(X1, Z1);
    const e3 = f.toWorld(X0, Z1);
    em.vquad(e0, e1, yE - fh, yE, o.trim, DSURF.PLAIN);
    em.vquad(e2, e3, yE - fh, yE, o.trim, DSURF.PLAIN);
    em.hquad(f.toWorld(x0, Z0), f.toWorld(x1, Z0), f.toWorld(x1, z0), f.toWorld(x0, z0), yE - fh, false, o.trim, DSURF.PLAIN, f);
    em.hquad(f.toWorld(x0, z1), f.toWorld(x1, z1), f.toWorld(x1, Z1), f.toWorld(x0, Z1), yE - fh, false, o.trim, DSURF.PLAIN, f);
    // rake undersides beyond the gable walls
    for (const [xa, xb] of [[X0, x0], [x1, X1]] as const) {
      if (xb - xa < 0.02) continue;
      oquad(em, P(f, xa, yE, Z0), P(f, xb, yE, Z0), P(f, xb, yR, zc), P(f, xa, yR, zc), [0, 0, 1, 0, 1, 1, 0, 1], dirUp(f, 0, 1, -1), o.trim, DSURF.PLAIN);
      oquad(em, P(f, xa, yE, Z1), P(f, xb, yE, Z1), P(f, xb, yR, zc), P(f, xa, yR, zc), [0, 0, 1, 0, 1, 1, 0, 1], dirUp(f, 0, -1, -1), o.trim, DSURF.PLAIN);
    }
    // barge boards along the rakes
    for (const [x, sx] of [[X0, -1], [X1, 1]] as const) {
      oquad(em, P(f, x, yE - fh, Z0), P(f, x, yR - fh, zc), P(f, x, yR, zc), P(f, x, yE, Z0), [0, 0, 1, 0, 1, 1, 0, 1], dirUp(f, sx, 0, 0), o.trim, DSURF.PLAIN);
      oquad(em, P(f, x, yE - fh, Z1), P(f, x, yR - fh, zc), P(f, x, yR, zc), P(f, x, yE, Z1), [0, 0, 1, 0, 1, 1, 0, 1], dirUp(f, sx, 0, 0), o.trim, DSURF.PLAIN);
    }
  }
  return yR;
}

/**
 * Mono-pitch (shed) roof: high side on the local front (z0) when `highFront`, else the back.
 * Emits the extra wall strip on the high side and the side triangles. Returns the high eave height.
 */
export function shedRoof(em: Emitter, frame: Frame, r: Rect, yWallTop: number, o: PitchedRoof, spec: FacadeSpec, highFront: boolean): number {
  const { x0, x1, z0, z1 } = r;
  const d = z1 - z0;
  const ov = o.overhang;
  const k = o.pitch;
  const yHigh = yWallTop + d * k;
  const ring = frame.rect(x0, x1, z0, z1);
  // roof plane: y(z) = yWallTop + (zLow - z) * k ... measured from the low wall line
  const yAt = (z: number): number => (highFront ? yWallTop + (z1 - z) * k : yWallTop + (z - z0) * k);
  const Z0 = z0 - ov;
  const Z1 = z1 + ov;
  const X0 = x0 - ov * 0.6;
  const X1 = x1 + ov * 0.6;
  const sec = Math.sqrt(1 + k * k);
  const len = (Z1 - Z0) * sec;
  const a = P(frame, X0, yAt(Z0), Z0);
  const b = P(frame, X1, yAt(Z0), Z0);
  const c = P(frame, X1, yAt(Z1), Z1);
  const dd = P(frame, X0, yAt(Z1), Z1);
  const vA = highFront ? len : 0;
  const vB = highFront ? 0 : len;
  oquad(em, a, b, c, dd, [0, vA, X1 - X0, vA, X1 - X0, vB, 0, vB], [0, 1, 0], o.col, o.surf);
  if (o.lod === 0) oquad(em, a, b, c, dd, [0, 0, 1, 0, 1, 1, 0, 1], [0, -1, 0], o.trim, DSURF.PLAIN);
  // high wall strip
  if (highFront) em.wall(ring[0], ring[1], yWallTop, yHigh, spec);
  else em.wall(ring[2], ring[3], yWallTop, yHigh, spec);
  // side triangles: right edge ring[1]->ring[2] (q = ring[2] at z1), left edge ring[3]->ring[0] (q = ring[0] at z0)
  em.gable(ring[1], ring[2], yWallTop, yHigh, spec, highFront ? 1 : 0);
  em.gable(ring[3], ring[0], yWallTop, yHigh, spec, highFront ? 0 : 1);
  return yHigh;
}

/**
 * Sawtooth roof along the local x axis: `teeth` bays, each a sloped roof face rising to a
 * vertical glazed face. Walls must end at yBase. Returns the top height.
 */
export function sawtoothRoof(em: Emitter, frame: Frame, r: Rect, yBase: number, teeth: number, height: number, col: RGB, glassCol: RGB, spec: FacadeSpec): number {
  const { x0, x1, z0, z1 } = r;
  const n = Math.max(1, teeth);
  const step = (x1 - x0) / n;
  const yT = yBase + height;
  const sec = Math.hypot(step, height) / step;
  for (let i = 0; i < n; i++) {
    const xa = x0 + i * step;
    const xb = xa + step;
    // sloped face from (xa, yBase) up to (xb, yT)
    oquad(em, P(frame, xa, yBase, z0), P(frame, xa, yBase, z1), P(frame, xb, yT, z1), P(frame, xb, yT, z0), [0, 0, z1 - z0, 0, z1 - z0, step * sec, 0, step * sec], dirUp(frame, -1, 0, 1), col, DSURF.METAL_ROOF);
    // vertical glazing facing +x (down to the next tooth's low edge)
    const g0 = frame.toWorld(xb, z0);
    const g1 = frame.toWorld(xb, z1);
    em.vquad(g0, g1, yBase, yT, glassCol, DSURF.GLASS);
    // end triangles: front edge (xa,z0)->(xb,z0): left end q = xb -> apexT 0; back edge (xb,z1)->(xa,z1): apex at p -> 1
    em.gable(frame.toWorld(xa, z0), frame.toWorld(xb, z0), yBase, yT, spec, 0);
    em.gable(frame.toWorld(xb, z1), frame.toWorld(xa, z1), yBase, yT, spec, 1);
  }
  return yT;
}
