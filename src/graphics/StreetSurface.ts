// The street surface: road, gutter, kerb and pavement as one continuous, finely tessellated
// terrain mesh (5 cm vertex spacing; the photo-scanned height maps displace it further in the
// material). This is the one mesh in the showcase built in code: there is no photographed road to
// load, and ground in a game engine is terrain like this, not a model. Every object standing on it
// is a loaded, photo-scanned glTF model.
//
// The street runs along x. Cross-section (z): building line at z = -8.6, pavement falling 1%
// towards the kerb, a 15 cm kerb with a rounded arris at z = -4, a gutter, and a crowned road.
import { BufferAttribute, BufferGeometry } from 'three/webgpu';

export interface StreetLayout {
  /** Street length along x, metres (centred on 0). */
  length: number;
  /** z of the building line (back of the pavement). */
  buildingLine: number;
  /** z of the kerb face. */
  kerb: number;
  /** z where the road ends (far edge of the modelled surface). */
  roadEnd: number;
  /** Kerb height, metres. */
  kerbHeight: number;
  /** Vertex spacing, metres. */
  spacing: number;
}

export const DEFAULT_STREET: StreetLayout = { length: 64, buildingLine: -8.6, kerb: -4, roadEnd: 12, kerbHeight: 0.15, spacing: 0.05 };

/** A cross-section: points (z, y) in order, with their distance along the profile for texturing. */
interface Profile {
  z: number[];
  y: number[];
}

/** Height of the street surface at z (for placing objects on it). */
export function streetHeight(layout: StreetLayout, z: number): number {
  if (z <= layout.kerb - 0.02) return pavementY(layout, z);
  return roadY(layout, z);
}

function pavementY(l: StreetLayout, z: number): number {
  // 1% cross-fall towards the kerb, so rain runs off into the gutter.
  return l.kerbHeight + 0.01 * (l.kerb - 0.25 - Math.min(z, l.kerb - 0.25));
}

function roadY(l: StreetLayout, z: number): number {
  const gutter = l.kerb + 0.45;
  if (z < gutter) return 0.02 * ((z - l.kerb) / (gutter - l.kerb));
  // A crowned road: highest along its centre line, 7 cm above the gutter.
  const centre = (gutter + l.roadEnd) / 2;
  const half = (l.roadEnd - gutter) / 2;
  const t = (z - centre) / half;
  return 0.02 + 0.07 * Math.max(0, 1 - t * t);
}

function pavementProfile(l: StreetLayout): Profile {
  const z: number[] = [];
  const y: number[] = [];
  for (let s = l.buildingLine; s < l.kerb - 0.03; s += l.spacing) {
    z.push(s);
    y.push(pavementY(l, s));
  }
  // Rounded arris (1.5 cm radius) and the kerb face down to the gutter, with a slight batter.
  const top = pavementY(l, l.kerb - 0.03);
  const r = 0.015;
  for (let k = 0; k <= 4; k++) {
    const a = (k / 4) * (Math.PI / 2);
    z.push(l.kerb - r + Math.sin(a) * r);
    y.push(top - r + Math.cos(a) * r);
  }
  const steps = Math.max(2, Math.round(l.kerbHeight / l.spacing) + 1);
  for (let k = 1; k <= steps; k++) {
    const f = k / steps;
    z.push(l.kerb + 0.012 * f);
    y.push(top - r - (top - r) * f);
  }
  return { z, y };
}

function roadProfile(l: StreetLayout): Profile {
  const z: number[] = [];
  const y: number[] = [];
  for (let s = l.kerb + 0.012; s <= l.roadEnd + 1e-6; s += l.spacing) {
    z.push(s);
    y.push(roadY(l, s));
  }
  return { z, y };
}

/**
 * A strip of the street swept along x from a cross-section. UVs are in metres: u along the
 * street, v along the surface of the profile (so the kerb face isn't stretched).
 */
function sweep(profile: Profile, l: StreetLayout): BufferGeometry {
  const nx = Math.round(l.length / l.spacing) + 1;
  const nz = profile.z.length;
  const positions = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  const along = new Float32Array(nz);
  for (let j = 1; j < nz; j++) {
    along[j] = along[j - 1] + Math.hypot(profile.z[j] - profile.z[j - 1], profile.y[j] - profile.y[j - 1]);
  }
  for (let i = 0; i < nx; i++) {
    const x = -l.length / 2 + i * l.spacing;
    for (let j = 0; j < nz; j++) {
      const k = i * nz + j;
      positions[k * 3] = x;
      positions[k * 3 + 1] = profile.y[j];
      positions[k * 3 + 2] = profile.z[j];
      uvs[k * 2] = x;
      uvs[k * 2 + 1] = profile.z[0] + along[j];
    }
  }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let i = 0; i < nx - 1; i++) {
    for (let j = 0; j < nz - 1; j++) {
      const a = i * nz + j;
      const b = a + nz;
      // Wound so the surface faces up (+y).
      index[p++] = a;
      index[p++] = a + 1;
      index[p++] = b;
      index[p++] = b;
      index[p++] = a + 1;
      index[p++] = b + 1;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** The pavement with its kerb, and the road with its gutter. */
export function buildStreet(layout: StreetLayout = DEFAULT_STREET): { pavement: BufferGeometry; road: BufferGeometry } {
  return { pavement: sweep(pavementProfile(layout), layout), road: sweep(roadProfile(layout), layout) };
}
