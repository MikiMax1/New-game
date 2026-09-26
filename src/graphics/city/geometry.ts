// Geometry helpers for the procedural city. Every generator returns BufferGeometry with UVs in
// metres (so a tiling material has real-world scale on any object) and smooth, bevelled edges
// (real objects have no knife-sharp edges; a few millimetres of bevel catch the light).
import { BufferAttribute, BufferGeometry, CatmullRomCurve3, ExtrudeGeometry, LatheGeometry, Shape, TubeGeometry, Vector2, Vector3 } from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Box-projects UVs in metres: each vertex takes the two coordinates perpendicular to its
 * normal's dominant axis (u horizontal, v up on walls). `offset` shifts the pattern so repeated
 * objects don't all show the same patch.
 */
export function boxUVs(geometry: BufferGeometry, scale = 1, offset = new Vector2()): BufferGeometry {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = x;
      v = z;
    } else if (ax >= az) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    uv[i * 2] = u * scale + offset.x;
    uv[i * 2 + 1] = v * scale + offset.y;
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  return geometry;
}

/** A box with rounded edges (radius in metres), centred on the origin, metre UVs. */
export function bevelBox(width: number, height: number, depth: number, radius = 0.01, segments = 2): BufferGeometry {
  const r = Math.min(radius, width / 2 - 1e-4, height / 2 - 1e-4, depth / 2 - 1e-4);
  return boxUVs(new RoundedBoxGeometry(width, height, depth, segments, Math.max(r, 1e-4)));
}

/**
 * A surface of revolution about y from a profile of (radius, height) points, metre UVs
 * (u around the circumference at the widest radius, v along the profile).
 */
export function lathe(profile: [number, number][], segments = 32): BufferGeometry {
  const points = profile.map(([r, y]) => new Vector2(r, y));
  const g = new LatheGeometry(points, segments);
  const maxR = Math.max(...profile.map(([r]) => r));
  // LatheGeometry's u runs 0..1 around, v 0..1 along the profile: rescale to metres.
  let along = 0;
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    along += points[i].distanceTo(points[i - 1]);
    lengths.push(along);
  }
  const uv = g.getAttribute('uv');
  const perRing = points.length;
  for (let i = 0; i < uv.count; i++) {
    const j = i % perRing;
    uv.setXY(i, uv.getX(i) * 2 * Math.PI * maxR, lengths[j]);
  }
  return g;
}

/** A tube of `radius` along a smooth curve through `points`, metre UVs (u along, v around). */
export function tube(points: Vector3[], radius: number, tubularSegments = 64, radialSegments = 16): BufferGeometry {
  const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.1);
  const g = new TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
  const length = curve.getLength();
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * length, uv.getY(i) * 2 * Math.PI * radius);
  return g;
}

/** A 2D shape extruded along z by `depth`, with a rounded bevel of `bevel` metres; metre UVs. */
export function extrude(shape: Shape, depth: number, bevel = 0.005, curveSegments = 12): BufferGeometry {
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments,
  });
  g.translate(0, 0, bevel);
  g.computeVertexNormals();
  return boxUVs(g);
}

/**
 * Merges geometries into one, one draw group per input (for multi-material meshes). Mixed indexed
 * and non-indexed inputs (extrusions are non-indexed) are all converted to non-indexed.
 */
export function merge(geometries: BufferGeometry[], groups = true): BufferGeometry {
  const mixed = geometries.some((g) => g.index) && geometries.some((g) => !g.index);
  const prepared = geometries.map((g) => {
    const n = mixed && g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') n.deleteAttribute(name);
    n.clearGroups();
    return n;
  });
  const merged = mergeGeometries(prepared, groups);
  if (!merged) throw new Error('merge: incompatible geometries');
  return merged;
}

/** Welds duplicate vertices (smooth shading across seams) and recomputes normals. */
export function weld(geometry: BufferGeometry, tolerance = 1e-4): BufferGeometry {
  const g = mergeVertices(geometry, tolerance);
  g.computeVertexNormals();
  return g;
}
