// The street surface: road, gutters, kerbs, pavements and the kerb ramps at the crossing, as two
// finely tessellated terrain meshes (road and pavements). Heights come from a function of (x, z):
// a crowned road that drains to the gutters, 15 cm kerbs with rounded arrises, pavements that
// fall 1.5% towards the kerb, and kerb ramps at the crossing with 1:10 flares. The materials add
// the texture relief, puddles and road markings on top (see ProceduralCity).
import { BufferAttribute, BufferGeometry } from 'three/webgpu';
import { BUILDING_Z, CROSSING_X, CROSSWALK_WIDTH, KERB_HEIGHT, KERB_Z, RAMP_WIDTH, STREET_HALF_LENGTH } from './layout';

/** Height of the gutter line above the road datum, and the crown at the centre line. */
const GUTTER_Y = 0;
const CROWN = 0.09;
const GUTTER_WIDTH = 0.45;
/** Kerb ramps: run perpendicular to the kerb, and flare length along it. */
const RAMP_RUN = 1.5;
const FLARE = 1.2;
/** Rounded arris radius of the kerb stones. */
const ARRIS = 0.02;
/** Horizontal set-back of the kerb face over its height (batter). */
const BATTER = 0.015;

/** Road height at lateral position z (|z| < KERB_Z). */
export function roadHeight(z: number): number {
  const d = KERB_Z - Math.abs(z);
  if (d < GUTTER_WIDTH) return GUTTER_Y + 0.02 * (d / GUTTER_WIDTH);
  // Parabolic crown from the gutter line to the centre.
  const t = Math.abs(z) / (KERB_Z - GUTTER_WIDTH);
  return GUTTER_Y + 0.02 + (CROWN - 0.02) * (1 - t * t);
}

/** How much a kerb ramp lowers the pavement at x (0 = full kerb, 1 = fully ramped). */
function rampMask(x: number): number {
  const half = RAMP_WIDTH / 2;
  const dx = Math.abs(x - CROSSING_X);
  if (dx <= half) return 1;
  if (dx >= half + FLARE) return 0;
  return 1 - (dx - half) / FLARE;
}

/** Pavement height at (x, distance behind the kerb face). */
export function pavementHeight(x: number, behindKerb: number): number {
  // 1.5% cross-fall towards the kerb.
  const base = GUTTER_Y + KERB_HEIGHT + 0.015 * Math.max(0, behindKerb - 0.3);
  const ramp = rampMask(x) * Math.max(0, 1 - behindKerb / RAMP_RUN);
  return base - (KERB_HEIGHT - 0.012) * ramp;
}

/** Height of the street surface at (x, z), for placing objects on it. */
export function streetHeight(x: number, z: number): number {
  const behind = Math.abs(z) - KERB_Z;
  return behind > 0 ? pavementHeight(x, behind) : roadHeight(z);
}

/** Positions along x: fine near the action, coarser towards the ends of the street. */
function xStations(): number[] {
  const xs: number[] = [];
  const fine = 0.08;
  const coarse = 0.4;
  const fineHalf = 36;
  let x = -STREET_HALF_LENGTH;
  while (x < STREET_HALF_LENGTH) {
    xs.push(x);
    const inFine = x > CROSSING_X - fineHalf && x < CROSSING_X + fineHalf + 30;
    x += inFine ? fine : coarse;
  }
  xs.push(STREET_HALF_LENGTH);
  return xs;
}

/** Builds a grid mesh from x stations × a lateral profile of (z, height(x, i)) columns. */
function grid(xs: number[], zs: number[], height: (x: number, j: number) => number, flip: boolean): BufferGeometry {
  const nx = xs.length;
  const nz = zs.length;
  const positions = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const k = i * nz + j;
      const y = height(xs[i], j);
      positions[k * 3] = xs[i];
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = zs[j];
      // UVs in metres: x along the street, z across (the kerb face gets its height added so its
      // texture isn't squashed).
      uvs[k * 2] = xs[i];
      uvs[k * 2 + 1] = zs[j] + (flip ? -y : y);
    }
  }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let i = 0; i < nx - 1; i++) {
    for (let j = 0; j < nz - 1; j++) {
      const a = i * nz + j;
      const b = a + nz;
      if (!flip) {
        index.set([a, a + 1, b, b, a + 1, b + 1], p);
      } else {
        index.set([a, b, a + 1, b, b + 1, a + 1], p);
      }
      p += 6;
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

/** The road between the kerb faces (gutters included). */
export function buildRoad(): BufferGeometry {
  const zs: number[] = [];
  const step = 0.08;
  for (let z = -KERB_Z; z < KERB_Z; z += step) zs.push(z);
  zs.push(KERB_Z);
  return grid(xStations(), zs, (_x, j) => roadHeight(zs[j]), false);
}

/**
 * One pavement with its kerb, from the kerb face (bottom of the kerb at the gutter) back to the
 * building line. `side` = +1 for the north side (z > 0), -1 for the south.
 */
export function buildPavement(side: 1 | -1): BufferGeometry {
  // Lateral samples as distances behind the kerb face: the face (a few rows up its height), the
  // arris, then the pavement.
  const behind: number[] = [];
  const faceRows = 6;
  for (let k = 0; k <= faceRows; k++) behind.push(-BATTER * (1 - k / faceRows) - 0.0005 * (faceRows - k));
  for (let k = 1; k <= 4; k++) behind.push(ARRIS * (1 - Math.cos((k / 4) * (Math.PI / 2))));
  for (let d = 0.04; d < BUILDING_Z - KERB_Z + 0.3; d += 0.08) behind.push(d);
  const zs = behind.map((d) => side * (KERB_Z + d));
  const height = (x: number, j: number): number => {
    const d = behind[j];
    const top = pavementHeight(x, Math.max(d, 0));
    if (j <= faceRows) {
      // Up the kerb face from the gutter to just below the arris.
      const f = j / faceRows;
      return GUTTER_Y + (top - ARRIS - GUTTER_Y) * f;
    }
    if (j <= faceRows + 4) {
      // The rounded arris.
      const k = j - faceRows;
      return top - ARRIS + Math.sin((k / 4) * (Math.PI / 2)) * ARRIS;
    }
    return top;
  };
  // The south side's z decreases along the profile: flip the winding so it faces up.
  return grid(xStations(), zs, height, side < 0);
}

/** Crosswalk extent along x. */
export const CROSSWALK = { x0: CROSSING_X - CROSSWALK_WIDTH / 2, x1: CROSSING_X + CROSSWALK_WIDTH / 2 };
