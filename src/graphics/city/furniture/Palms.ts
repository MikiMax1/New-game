// Royal and coconut-style palms for the pavements, grown procedurally.
//
// Trunk: a circle swept up a gently leaning curve, 0.2 m thick and tapering, with a swollen base
// and the ring scars of fallen fronds every ~9 cm (radius bumps, so they catch the low sun).
// Crown: 16–20 fronds. Each frond's rachis leaves the crown at its own angle, arcs out and droops
// under its weight; leaflets (pinnae) are thin quads on both sides of it, longest mid-frond, held
// up in a V and swept forward. A few dead fronds hang brown below the crown, with a cluster of
// coconuts. Everything is real geometry: no alpha textures.
//
// The leaf material is double-sided and translucent to the low sun: seen against the light the
// leaflets glow yellow-green, which is most of what makes palms look alive at golden hour.
import { cameraPosition, float, max, mix, normalize, positionWorld, pow, uniform, vec3 } from 'three/tsl';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshPhysicalNodeMaterial, Vector3, type Group } from 'three/webgpu';
import { lathe, merge } from '../geometry';
import type { CityContext } from '../context';

interface Mesher {
  pos: number[];
  idx: number[];
  uv: number[];
}

const up = new Vector3(0, 1, 0);

/** Sweeps a varying-radius circle along points; returns the trunk vertices into `m`. */
function sweep(m: Mesher, path: Vector3[], radius: (t: number) => number, radial: number): void {
  const base = m.pos.length / 3;
  const n = path.length;
  const tangent = new Vector3();
  const side = new Vector3();
  const normal = new Vector3();
  let along = 0;
  for (let i = 0; i < n; i++) {
    tangent.subVectors(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)]).normalize();
    side.crossVectors(tangent, Math.abs(tangent.y) > 0.99 ? new Vector3(1, 0, 0) : up).normalize();
    normal.crossVectors(side, tangent).normalize();
    if (i > 0) along += path[i].distanceTo(path[i - 1]);
    const r = radius(i / (n - 1));
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      m.pos.push(path[i].x + (side.x * c + normal.x * s) * r, path[i].y + (side.y * c + normal.y * s) * r, path[i].z + (side.z * c + normal.z * s) * r);
      m.uv.push((k / radial) * 2 * Math.PI * 0.2, along);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = base + i * (radial + 1) + k;
      const b = a + radial + 1;
      m.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
}

function finish(m: Mesher): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(m.pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(m.uv), 2));
  g.setIndex(m.idx);
  g.computeVertexNormals();
  return g;
}

/** One frond into `m`: rachis (thin tube) and leaflets. */
function frond(leaves: Mesher, stems: Mesher, start: Vector3, heading: number, pitch: number, length: number, droop: number, random: () => number): void {
  const dir = new Vector3(Math.cos(heading) * Math.cos(pitch), Math.sin(pitch), Math.sin(heading) * Math.cos(pitch));
  const steps = 26;
  const pts: Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    pts.push(start.clone().addScaledVector(dir, s * length).add(new Vector3(0, -droop * s * s * length, 0)));
  }
  sweep(stems, pts, (t) => 0.035 * (1 - t) + 0.006, 5);
  // Leaflets: pairs along the rachis from 12% of its length, in a V, swept towards the tip.
  const tangent = new Vector3();
  const lateral = new Vector3();
  const lift = new Vector3();
  const pairs = 38;
  for (let i = 0; i < pairs; i++) {
    const s = 0.12 + (i / (pairs - 1)) * 0.86;
    const f = s * steps;
    const i0 = Math.floor(f);
    const p = pts[i0].clone().lerp(pts[Math.min(steps, i0 + 1)], f - i0);
    tangent.subVectors(pts[Math.min(steps, i0 + 1)], pts[i0]).normalize();
    lateral.crossVectors(tangent, up).normalize();
    lift.crossVectors(lateral, tangent).normalize();
    const len = 0.85 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05)), 0.55) + 0.1;
    for (const sideSign of [-1, 1]) {
      // Leaflet direction: out to the side, raised in a V, swept 40° forward, a little random.
      const d = lateral
        .clone()
        .multiplyScalar(sideSign)
        .addScaledVector(lift, 0.55 + random() * 0.2)
        .addScaledVector(tangent, 0.75)
        .normalize();
      const tipDroop = new Vector3(0, -0.25 * len, 0);
      const w = 0.035;
      const base = leaves.pos.length / 3;
      const a = p.clone().addScaledVector(tangent, -w);
      const b = p.clone().addScaledVector(tangent, w);
      const mid = p.clone().addScaledVector(d, len * 0.55).addScaledVector(tipDroop, 0.3);
      const tip = p.clone().addScaledVector(d, len).add(tipDroop);
      // A narrow blade: base pair, a mid pair (widest), the tip.
      const mid0 = mid.clone().addScaledVector(tangent, -w * 1.3);
      const mid1 = mid.clone().addScaledVector(tangent, w * 1.3);
      for (const v of [a, b, mid0, mid1, tip]) leaves.pos.push(v.x, v.y, v.z);
      leaves.uv.push(0, 0, 1, 0, 0, 0.55, 1, 0.55, 0.5, 1);
      leaves.idx.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 4);
    }
  }
}

export interface PalmSet {
  trunks: BufferGeometry;
  leaves: BufferGeometry;
  dead: BufferGeometry;
  stems: BufferGeometry;
  nuts: BufferGeometry;
}

/** Grows palms at the given bases (world positions on the pavement). */
export function growPalms(bases: Vector3[], random: () => number): PalmSet {
  const trunks: Mesher = { pos: [], idx: [], uv: [] };
  const leaves: Mesher = { pos: [], idx: [], uv: [] };
  const dead: Mesher = { pos: [], idx: [], uv: [] };
  const stems: Mesher = { pos: [], idx: [], uv: [] };
  const nuts: BufferGeometry[] = [];
  for (const base of bases) {
    const height = 8 + random() * 4;
    const leanDir = random() * Math.PI * 2;
    const lean = 0.3 + random() * 0.9;
    const path: Vector3[] = [];
    const rings = 90;
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      path.push(new Vector3(base.x + Math.cos(leanDir) * lean * t * t, base.y + height * t - 0.1, base.z + Math.sin(leanDir) * lean * t * t));
    }
    const scars = height / 0.09;
    sweep(
      trunks,
      path,
      (t) => {
        const taper = 0.21 - 0.06 * t;
        const bulb = 0.12 * Math.exp(-t * 14);
        const ring = Math.pow(Math.abs(Math.sin(t * scars * Math.PI)), 12) * 0.012;
        return taper + bulb + ring;
      },
      16,
    );
    const top = path[rings];
    const count = 16 + Math.floor(random() * 5);
    for (let k = 0; k < count; k++) {
      const heading = (k / count) * Math.PI * 2 + random() * 0.3;
      const pitch = 0.75 - (k % 3) * 0.35 - random() * 0.25;
      frond(leaves, stems, top.clone().add(new Vector3(0, 0.25, 0)), heading, pitch, 2.8 + random() * 0.9, 0.35 + random() * 0.25, random);
    }
    // Dead fronds hanging below the crown.
    for (let k = 0; k < 4; k++) {
      const heading = random() * Math.PI * 2;
      frond(dead, stems, top.clone().add(new Vector3(0, -0.1, 0)), heading, -1.15 - random() * 0.2, 2.2 + random() * 0.5, 0.1, random);
    }
    // Coconuts.
    for (let k = 0; k < 5; k++) {
      const a = random() * Math.PI * 2;
      const nut = lathe(
        Array.from({ length: 9 }, (_, i): [number, number] => {
          const phi = -Math.PI / 2 + (i / 8) * Math.PI;
          return [Math.max(0.0001, Math.cos(phi) * 0.1), Math.sin(phi) * 0.12];
        }),
        10,
      );
      nuts.push(nut.translate(top.x + Math.cos(a) * 0.22, top.y - 0.15 - random() * 0.15, top.z + Math.sin(a) * 0.22));
    }
  }
  return { trunks: finish(trunks), leaves: finish(leaves), dead: finish(dead), stems: finish(stems), nuts: merge(nuts, false) };
}

/** Palm materials: bark, living leaves (translucent against the sun), dead fronds, coconuts. */
export function palmMeshes(set: PalmSet, ctx: CityContext, group: Group): void {
  const sun = uniform(ctx.sun);
  const bark = new MeshPhysicalNodeMaterial({ name: 'Palm bark', color: new Color(0.36, 0.33, 0.29), roughness: 0.9 });
  const leaf = new MeshPhysicalNodeMaterial({ name: 'Palm leaf', color: new Color(0.1, 0.19, 0.05), roughness: 0.55, side: DoubleSide, sheen: 0.4, sheenColor: new Color(0.5, 0.6, 0.3) });
  // Translucency: light passing through the leaflets towards the viewer when the sun is behind.
  const view = normalize(positionWorld.sub(cameraPosition));
  const backlight = pow(max(view.dot(sun), 0), 4);
  leaf.emissiveNode = vec3(0.4, 0.55, 0.14).mul(backlight.mul(1.1)).mul(mix(float(0.7), float(1), positionWorld.y.mul(0.37).fract()));
  const deadLeaf = new MeshPhysicalNodeMaterial({ name: 'Dead frond', color: new Color(0.33, 0.24, 0.13), roughness: 0.85, side: DoubleSide });
  const stem = new MeshPhysicalNodeMaterial({ name: 'Palm stem', color: new Color(0.2, 0.22, 0.09), roughness: 0.7 });
  const nut = new MeshPhysicalNodeMaterial({ name: 'Coconut', color: new Color(0.2, 0.2, 0.06), roughness: 0.6 });
  const parts: [BufferGeometry, MeshPhysicalNodeMaterial, string][] = [
    [set.trunks, bark, 'Palm trunks'],
    [set.leaves, leaf, 'Palm leaves'],
    [set.dead, deadLeaf, 'Dead fronds'],
    [set.stems, stem, 'Palm stems'],
    [set.nuts, nut, 'Coconuts'],
  ];
  for (const [g, m, name] of parts) {
    const mesh = new Mesh(g, m);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}
