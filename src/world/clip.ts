// Polygon booleans and offsets via Clipper (integer coordinates, centimetre precision).
import ClipperLib from 'clipper-lib';
import { asHole, asOuter, signedArea } from './geom';
import type { P2, PolygonWithHoles, Ring } from './types';

const SCALE = 100;
type Path = ClipperLib.Path;
type Paths = ClipperLib.Paths;

export function toPath(r: readonly P2[]): Path {
  const p: Path = new Array(r.length);
  for (let i = 0; i < r.length; i++) p[i] = { X: Math.round(r[i].x * SCALE), Y: Math.round(r[i].z * SCALE) };
  return p;
}

export function fromPath(p: Path): Ring {
  const r: Ring = new Array(p.length);
  for (let i = 0; i < p.length; i++) r[i] = { x: p[i].X / SCALE, z: p[i].Y / SCALE };
  return r;
}

/** Polygons with holes as Clipper paths (outer positive, holes negative winding). */
export function polysToPaths(polys: readonly PolygonWithHoles[]): Paths {
  const ps: Paths = [];
  for (const poly of polys) {
    if (poly.outer.length >= 3) ps.push(toPath(asOuter(poly.outer)));
    for (const h of poly.holes) if (h.length >= 3) ps.push(toPath(asHole(h)));
  }
  return ps;
}

function treeToPolys(node: ClipperLib.PolyNode, out: PolygonWithHoles[]): void {
  for (const outerNode of node.Childs()) {
    const outer = asOuter(fromPath(outerNode.Contour()));
    const holes: Ring[] = [];
    for (const holeNode of outerNode.Childs()) {
      holes.push(asHole(fromPath(holeNode.Contour())));
      // Islands inside holes become separate polygons.
      treeToPolys(holeNode, out);
    }
    if (outer.length >= 3) out.push({ outer, holes });
  }
}

function run(clipType: ClipperLib.ClipType, subject: Paths, clip: Paths | null): PolygonWithHoles[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  if (clip) c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(clipType, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const out: PolygonWithHoles[] = [];
  treeToPolys(tree, out);
  return out;
}

export function union(a: readonly PolygonWithHoles[], b: readonly PolygonWithHoles[] = []): PolygonWithHoles[] {
  return run(ClipperLib.ClipType.ctUnion, polysToPaths([...a, ...b]), null);
}

export function difference(a: readonly PolygonWithHoles[], b: readonly PolygonWithHoles[]): PolygonWithHoles[] {
  return run(ClipperLib.ClipType.ctDifference, polysToPaths(a), polysToPaths(b));
}

export function intersection(a: readonly PolygonWithHoles[], b: readonly PolygonWithHoles[]): PolygonWithHoles[] {
  return run(ClipperLib.ClipType.ctIntersection, polysToPaths(a), polysToPaths(b));
}

function joinType(j: 'round' | 'miter' | 'square'): ClipperLib.JoinType {
  return j === 'round' ? ClipperLib.JoinType.jtRound : j === 'miter' ? ClipperLib.JoinType.jtMiter : ClipperLib.JoinType.jtSquare;
}

/** Grow (delta > 0) or shrink (delta < 0) polygons, in metres. */
export function offset(polys: readonly PolygonWithHoles[], delta: number, join: 'round' | 'miter' | 'square' = 'round'): PolygonWithHoles[] {
  const co = new ClipperLib.ClipperOffset(join === 'miter' ? 3 : 2, 0.25 * SCALE);
  co.AddPaths(polysToPaths(polys), joinType(join), ClipperLib.EndType.etClosedPolygon);
  const tree = new ClipperLib.PolyTree();
  co.Execute(tree, delta * SCALE);
  const out: PolygonWithHoles[] = [];
  treeToPolys(tree, out);
  return out;
}

/**
 * Morphological opening: shrink then grow by r. Rounds convex corners (curb returns)
 * and removes parts narrower than 2r.
 */
export function opening(polys: readonly PolygonWithHoles[], r: number): PolygonWithHoles[] {
  return offset(offset(polys, -r, 'miter'), r, 'round');
}

/** Buffer polylines into areas: each line is grown by its half width with round or flat ends. */
export function bufferLines(lines: readonly { pts: readonly P2[]; halfWidth: number }[], ends: 'round' | 'butt' = 'round'): PolygonWithHoles[] {
  const groups = new Map<number, Paths>();
  for (const l of lines) {
    if (l.pts.length < 2 || l.halfWidth <= 0) continue;
    const key = Math.round(l.halfWidth * 100) / 100;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(toPath(l.pts));
  }
  const all: Paths = [];
  for (const [halfWidth, paths] of groups) {
    const co = new ClipperLib.ClipperOffset(2, 0.4 * SCALE);
    co.AddPaths(paths, ClipperLib.JoinType.jtRound, ends === 'round' ? ClipperLib.EndType.etOpenRound : ClipperLib.EndType.etOpenButt);
    const res: Paths = [];
    co.Execute(res, halfWidth * SCALE);
    for (const p of res) all.push(p);
  }
  return run(ClipperLib.ClipType.ctUnion, all, null);
}

export function polyArea(p: PolygonWithHoles): number {
  let a = Math.abs(signedArea(p.outer));
  for (const h of p.holes) a -= Math.abs(signedArea(h));
  return a;
}

export function simplifyRing(r: Ring, epsilon: number): Ring {
  return fromPath(ClipperLib.Clipper.CleanPolygon(toPath(r), epsilon * SCALE));
}
