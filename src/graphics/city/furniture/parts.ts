// Parametric street furniture, modelled from real dimensions. Each builder returns one merged
// geometry with a draw group per material slot, so an object is instanced as a single
// InstancedMesh whatever its number of parts. Local frame: y up from the ground at 0; objects that
// reach over the road (lamp arms, signal mast arms) reach towards +z.
import { BufferGeometry, Shape, Vector3 } from 'three/webgpu';
import { bevelBox, extrude, lathe, merge, tube } from '../geometry';

/** A multi-part object: its geometry (one group per slot) and the slot names in group order. */
export interface Part<S extends string> {
  geometry: BufferGeometry;
  slots: S[];
}

/** Collects pieces per material slot and merges them in slot order. */
class Assembly<S extends string> {
  private readonly pieces = new Map<S, BufferGeometry[]>();
  add(slot: S, g: BufferGeometry): this {
    const list = this.pieces.get(slot) ?? [];
    list.push(g);
    this.pieces.set(slot, list);
    return this;
  }
  build(): Part<S> {
    const slots = [...this.pieces.keys()];
    const perSlot = slots.map((s) => (this.pieces.get(s)!.length === 1 ? this.pieces.get(s)![0] : merge(this.pieces.get(s)!, false)));
    return { geometry: merge(perSlot, true), slots };
  }
}

const at = (g: BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);

/**
 * LED cobra-head street lamp on a tapered galvanised pole: anchor-base shroud, 8.5 m shaft, a
 * curved mast arm reaching 2.3 m over the road and the luminaire with its lens.
 */
export function streetLamp(): Part<'steel' | 'housing' | 'lens'> {
  const a = new Assembly<'steel' | 'housing' | 'lens'>();
  a.add('steel', lathe([[0, 0], [0.25, 0], [0.25, 0.04], [0.21, 0.08], [0.17, 0.42], [0.12, 0.48], [0, 0.48]], 24));
  a.add('steel', lathe([[0, 0.45], [0.105, 0.45], [0.1, 1.2], [0.062, 8.5], [0.05, 8.56], [0, 8.6]], 20));
  a.add('steel', tube([new Vector3(0, 8.1, 0), new Vector3(0, 8.62, 0.28), new Vector3(0, 8.92, 1.1), new Vector3(0, 9.02, 2.25)], 0.042, 48, 12));
  // Luminaire: a teardrop side profile (z, y) extruded across its width.
  const head = new Shape();
  const profile: [number, number][] = [[0, -0.02], [0.08, 0.06], [0.3, 0.1], [0.58, 0.085], [0.74, 0.035], [0.73, -0.02], [0.45, -0.04], [0.08, -0.035]];
  head.moveTo(profile[0][0], profile[0][1]);
  for (const [z, y] of profile.slice(1)) head.lineTo(z, y);
  head.closePath();
  const body = extrude(head, 0.32, 0.012, 8);
  body.rotateY(-Math.PI / 2);
  body.translate(0.16, 0, 0);
  a.add('housing', at(body, 0, 9.0, 2.12));
  a.add('lens', at(bevelBox(0.26, 0.012, 0.5, 0.004), 0, 8.955, 2.47));
  return a.build();
}

/** Traffic-signal mast-arm pole: pole, arm over the lanes (length `reach` towards +z). */
export function signalPole(reach: number): Part<'steel'> {
  const a = new Assembly<'steel'>();
  a.add('steel', lathe([[0, 0], [0.3, 0], [0.3, 0.05], [0.2, 0.1], [0.19, 0.55], [0, 0.55]], 24));
  a.add('steel', lathe([[0, 0.5], [0.16, 0.5], [0.15, 1.5], [0.11, 6.9], [0.08, 6.95], [0, 7]], 20));
  a.add('steel', tube([new Vector3(0, 6.35, 0.1), new Vector3(0, 6.42, reach * 0.5), new Vector3(0, 6.5, reach)], 0.075, 48, 12));
  // Gusset plate between arm and pole.
  a.add('steel', at(bevelBox(0.02, 0.5, 0.45, 0.004), 0, 6.1, 0.3));
  return a.build();
}

/**
 * A three-section vehicle signal head facing +x (towards traffic coming from +x): housing,
 * backplate with a retroreflective border, visors over the lenses. `slots` hold the three lenses
 * (top red, amber, bottom green) so any can be lit.
 */
export function signalHead(): Part<'housing' | 'backplate' | 'border' | 'red' | 'amber' | 'green'> {
  const a = new Assembly<'housing' | 'backplate' | 'border' | 'red' | 'amber' | 'green'>();
  a.add('housing', bevelBox(0.24, 1.02, 0.34, 0.03));
  a.add('backplate', at(bevelBox(0.015, 1.3, 0.56, 0.005), -0.13, 0, 0));
  a.add('border', at(bevelBox(0.012, 1.38, 0.64, 0.004), -0.145, 0, 0));
  const lenses: ('red' | 'amber' | 'green')[] = ['red', 'amber', 'green'];
  lenses.forEach((slot, k) => {
    const y = 0.32 - k * 0.32;
    const disc = new Shape().absarc(0, 0, 0.1, 0, Math.PI * 2, false);
    const lens = extrude(disc, 0.015, 0.003, 24);
    lens.rotateY(Math.PI / 2);
    a.add(slot, at(lens, 0.12, y, 0));
    // Visor: a hood over the top of the lens, open at the bottom.
    const hood = new Shape();
    hood.absarc(0, 0, 0.13, -0.35, Math.PI + 0.35, false);
    hood.absarc(0, 0, 0.12, Math.PI + 0.35, -0.35, true);
    const visor = extrude(hood, 0.22, 0.002, 16);
    visor.rotateY(Math.PI / 2);
    a.add('housing', at(visor, 0.12, y, 0));
  });
  return a.build();
}

/** Pedestrian signal head (a lit hand or walking figure in a box) facing +x. */
export function pedestrianHead(): Part<'housing' | 'face'> {
  const a = new Assembly<'housing' | 'face'>();
  a.add('housing', bevelBox(0.2, 0.46, 0.46, 0.02));
  a.add('face', at(bevelBox(0.01, 0.34, 0.34, 0.003), 0.1, 0, 0));
  // Egg-crate visor.
  a.add('housing', at(bevelBox(0.12, 0.02, 0.44, 0.004), 0.16, 0.2, 0));
  return a.build();
}

/** US-style fire hydrant: flanged base, barrel, bonnet, operating nut, two hose and one pumper outlet. */
export function hydrant(): Part<'paint' | 'caps'> {
  const a = new Assembly<'paint' | 'caps'>();
  a.add(
    'paint',
    lathe([[0, 0], [0.17, 0], [0.17, 0.045], [0.125, 0.07], [0.112, 0.1], [0.11, 0.56], [0.132, 0.58], [0.132, 0.63], [0.1, 0.69], [0.045, 0.745], [0, 0.75]], 28),
  );
  a.add('caps', lathe([[0, 0.74], [0.034, 0.74], [0.034, 0.8], [0, 0.8]], 5));
  const outlet = (r: number, len: number, y: number, dir: 1 | -1, axis: 'x' | 'z') => {
    const g = lathe([[0, 0], [r, 0], [r, len * 0.7], [r * 1.12, len * 0.72], [r * 1.12, len], [0, len]], 20);
    g.rotateZ(-Math.PI / 2 * dir);
    if (axis === 'z') g.rotateY(Math.PI / 2);
    a.add('caps', at(g, 0, y, 0));
  };
  outlet(0.045, 0.2, 0.42, 1, 'x');
  outlet(0.045, 0.2, 0.42, -1, 'x');
  outlet(0.07, 0.2, 0.36, 1, 'z');
  return a.build();
}

/** A litter bin: tapered steel drum with a rim and a domed lid with an opening band. */
export function litterBin(): Part<'body' | 'lid'> {
  const a = new Assembly<'body' | 'lid'>();
  a.add('body', lathe([[0, 0.02], [0.26, 0.02], [0.3, 0.8], [0.315, 0.82], [0.315, 0.86], [0, 0.86]], 28));
  a.add('lid', lathe([[0, 0.98], [0.2, 0.97], [0.3, 0.93], [0.32, 0.92], [0.32, 0.9], [0.28, 0.9], [0, 0.9]], 28));
  // Posts holding the lid over the opening.
  for (const r of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) a.add('lid', at(bevelBox(0.03, 0.06, 0.03, 0.005), Math.cos(r) * 0.28, 0.88, Math.sin(r) * 0.28));
  return a.build();
}

/** Concrete Jersey barrier (F-shape profile, 0.81 m high, 0.61 m base, 3.8 m long) along x. */
export function jerseyBarrier(): Part<'concrete'> {
  const s = new Shape();
  const half: [number, number][] = [[0.305, 0], [0.305, 0.075], [0.179, 0.255], [0.075, 0.81]];
  s.moveTo(-half[0][0], 0);
  for (const [z, y] of half) s.lineTo(z, y);
  for (const [z, y] of [...half].reverse()) s.lineTo(-z, y);
  s.closePath();
  const g = extrude(s, 3.8, 0.012, 1);
  // Profile in the (z, y) plane, length along x.
  g.rotateY(-Math.PI / 2);
  g.translate(1.9, 0, 0);
  return { geometry: merge([g], true), slots: ['concrete'] };
}

/** Channelizer drum: orange ribbed body with two retroreflective white bands on a rubber base. */
export function drum(): Part<'rubber' | 'orange' | 'white'> {
  const a = new Assembly<'rubber' | 'orange' | 'white'>();
  a.add('rubber', lathe([[0, 0], [0.4, 0], [0.4, 0.04], [0.3, 0.08], [0, 0.08]], 24));
  const bands: [number, number, 'orange' | 'white'][] = [[0.08, 0.28, 'orange'], [0.28, 0.43, 'white'], [0.43, 0.56, 'orange'], [0.56, 0.71, 'white'], [0.71, 0.96, 'orange']];
  for (const [y0, y1, slot] of bands) {
    const r = (y: number) => 0.28 - (y / 1.0) * 0.04;
    a.add(slot, lathe([[r(y0), y0], [r(y0) + 0.008, y0 + 0.01], [r(y1) + 0.008, y1 - 0.01], [r(y1), y1]], 24));
  }
  a.add('orange', lathe([[0.24, 0.96], [0.2, 1.0], [0.06, 1.02], [0, 1.02]], 24));
  return a.build();
}

/** Traffic cone, 0.7 m, with two white bands on a square rubber base. */
export function cone(): Part<'rubber' | 'orange' | 'white'> {
  const a = new Assembly<'rubber' | 'orange' | 'white'>();
  a.add('rubber', at(bevelBox(0.38, 0.035, 0.38, 0.01), 0, 0.0175, 0));
  const r = (y: number) => 0.15 - (y / 0.72) * 0.13;
  const bands: [number, number, 'orange' | 'white'][] = [[0.035, 0.3, 'orange'], [0.3, 0.42, 'white'], [0.42, 0.5, 'orange'], [0.5, 0.58, 'white'], [0.58, 0.72, 'orange']];
  for (const [y0, y1, slot] of bands) a.add(slot, lathe([[r(y0), y0], [r(y1), y1], ...(y1 >= 0.72 ? ([[0, 0.72]] as [number, number][]) : [])], 20));
  return a.build();
}

/** Cast-iron cover (manhole or valve), flush in the surface: a disc with a raised rim and ribs. */
export function cover(radius: number): Part<'iron'> {
  const a = new Assembly<'iron'>();
  a.add('iron', lathe([[0, 0.006], [radius - 0.03, 0.006], [radius - 0.02, 0.012], [radius, 0.012], [radius + 0.02, 0.0], [0, 0]], 40));
  for (let k = -3; k <= 3; k++) a.add('iron', at(bevelBox(radius * 1.5, 0.006, 0.02, 0.002), 0, 0.012, k * radius * 0.2));
  return a.build();
}

/** Storm-drain grate in the gutter: frame and bars (0.9 × 0.45 m), bars along x. */
export function drainGrate(): Part<'iron'> {
  const a = new Assembly<'iron'>();
  a.add('iron', at(bevelBox(0.95, 0.02, 0.5, 0.005), 0, 0.01, 0));
  for (let k = 0; k < 9; k++) a.add('iron', at(bevelBox(0.85, 0.03, 0.025, 0.004), 0, 0.02, -0.19 + k * 0.0475));
  return a.build();
}

/** Parking pay station on a plinth, screen facing +z. */
export function payStation(): Part<'body' | 'screen'> {
  const a = new Assembly<'body' | 'screen'>();
  a.add('body', at(bevelBox(0.34, 0.1, 0.3, 0.01), 0, 0.05, 0));
  a.add('body', at(bevelBox(0.32, 1.45, 0.26, 0.03), 0, 0.8, 0));
  a.add('body', at(bevelBox(0.36, 0.06, 0.3, 0.02), 0, 1.53, 0.02));
  a.add('screen', at(bevelBox(0.18, 0.12, 0.01, 0.003), 0, 1.25, 0.13));
  return a.build();
}

/** A sign on a square post: plate facing +z at 2.3 m, border plate behind it. */
export function signPost(width: number, height: number): Part<'post' | 'face' | 'border'> {
  const a = new Assembly<'post' | 'face' | 'border'>();
  a.add('post', at(bevelBox(0.05, 3.0, 0.05, 0.004), 0, 1.5, 0));
  a.add('face', at(bevelBox(width, height, 0.004, 0.002), 0, 2.4, 0.034));
  a.add('border', at(bevelBox(width + 0.04, height + 0.04, 0.004, 0.002), 0, 2.4, 0.029));
  return a.build();
}

/** A diamond work-zone sign on a folding stand, face towards +z. */
export function workSign(): Part<'stand' | 'face' | 'border'> {
  const a = new Assembly<'stand' | 'face' | 'border'>();
  const diamond = (s: number) => {
    const d = new Shape();
    d.moveTo(0, -s);
    d.lineTo(s, 0);
    d.lineTo(0, s);
    d.lineTo(-s, 0);
    d.closePath();
    return d;
  };
  a.add('face', at(extrude(diamond(0.55), 0.008, 0.002, 1), 0, 1.35, 0.03));
  a.add('border', at(extrude(diamond(0.6), 0.008, 0.002, 1), 0, 1.35, 0.02));
  for (const s of [-1, 1]) {
    const leg = tube([new Vector3(s * 0.05, 0.8, 0.0), new Vector3(s * 0.45, 0.0, s * 0.02)], 0.015, 8, 6);
    a.add('stand', leg);
    const back = tube([new Vector3(0, 0.8, 0), new Vector3(s * 0.05, 0, -0.45)], 0.015, 8, 6);
    a.add('stand', back);
  }
  a.add('stand', tube([new Vector3(0, 0.75, 0.01), new Vector3(0, 1.8, 0.01)], 0.02, 8, 6));
  return a.build();
}
