// Ambient traffic: cars drive in right-hand lanes along the road graph, follow the car
// ahead, turn through intersections on smooth curves, stop at red lights and pause at
// stop signs. Cars spawn around the player and despawn far away, like GTA.
import type { RoadEdgeData, RoadNodeData, WorldData } from '../world/gen/world';
import { Rng } from '../world/rng';
import type { VehicleType } from '../world/vehicles/carModels';
import { VEHICLE_TYPES } from '../world/vehicles/carModels';

const LANE_W = 3.3;
/** Vehicle lengths by type index (VEHICLE_TYPES order). */
const LENGTH = [4.85, 4.25, 4.9, 5.8, 5.15, 4.85, 5.0, 12.2, 7.6];
/** Comfortable braking used to pick safe speeds (m/s^2). */
const BRAKE = 4.5;
const safeSpeed = (dist: number): number => Math.sqrt(2 * BRAKE * Math.max(0, dist));

export interface TrafficCar {
  id: number;
  type: number;
  color: number;
  /** Directed edge: edge id and direction (true = a -> b). */
  edge: number;
  forward: boolean;
  lane: number;
  /** Distance along the edge's usable lane (m). */
  s: number;
  speed: number;
  /** Turning through a junction: Bezier from p0 via p1 to p2. */
  turn: { p0: [number, number]; p1: [number, number]; p2: [number, number]; t: number; len: number; nextEdge: number; nextForward: boolean } | null;
  /** Next edge chosen on the approach to the coming junction (-1 = not chosen yet). */
  plan: number;
  /** Seconds left waiting at a stop sign. */
  stopTimer: number;
  stoppedAtSign: boolean;
  /** Debug: what limited the speed this frame. */
  reason?: string;
  /** World pose for rendering. */
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface NodeInfo {
  signal: boolean;
  stop: boolean;
  radius: number;
  /** For signals: angle of phase group A. */
  axis: number;
  offset: number;
}

export class Traffic {
  readonly cars: TrafficCar[] = [];
  private readonly nodes: RoadNodeData[];
  private readonly edges: RoadEdgeData[];
  private readonly info: NodeInfo[];
  private readonly edgeLen: Float32Array;
  private readonly rng = new Rng('traffic');
  private nextId = 1;
  private time = 0;
  /** Target number of cars around the player. */
  density = 140;
  spawnRadius = 380;
  private readonly edgeGrid = new Map<number, number[]>();
  private readonly yOf: (x: number, z: number, edge: number, t: number) => number;

  constructor(world: WorldData, heightAt: (x: number, z: number, edge: number, t: number) => number) {
    this.nodes = world.roads.nodes;
    this.edges = world.roads.edges;
    this.yOf = heightAt;
    this.edgeLen = new Float32Array(this.edges.length);
    this.edges.forEach((e, i) => {
      const a = this.nodes[e.a];
      const b = this.nodes[e.b];
      this.edgeLen[i] = Math.hypot(b.x - a.x, b.z - a.z);
      const mx = Math.floor((a.x + b.x) / 2 / 64);
      const mz = Math.floor((a.z + b.z) / 2 / 64);
      const k = mx * 4096 + mz;
      let list = this.edgeGrid.get(k);
      if (!list) this.edgeGrid.set(k, (list = []));
      list.push(i);
    });
    // Junction control, mirroring the street dressing: signals where main roads cross
    // (and throughout downtown), stop signs elsewhere.
    this.info = this.nodes.map((n, i) => {
      const deg = n.edges.length;
      if (deg < 3) return { signal: false, stop: false, radius: 0, axis: 0, offset: 0 };
      const major = new Set(n.edges.filter((e) => this.edges[e].cls === 'arterial' || this.edges[e].cls === 'avenue').map((e) => this.edges[e].name)).size;
      const hws = n.edges.map((e) => this.edges[e].width / 2).sort((p, q) => q - p);
      const radius = Math.sqrt(hws[1] ** 2 + (hws[0] + 6) ** 2) * 0.92;
      const first = this.edges[n.edges[0]];
      const o = this.nodes[first.a === i ? first.b : first.a];
      const axis = Math.atan2(o.z - n.z, o.x - n.x);
      const signal = major >= 2 || (major >= 1 && deg >= 4 && Math.abs(n.x) < 600 && Math.abs(n.z) < 600);
      return { signal, stop: !signal, radius, axis, offset: (i * 7.31) % 60 };
    });
  }

  /** Usable lane length of a directed edge (between junction stop lines). */
  private laneSpan(edge: number, forward: boolean): [number, number] {
    const E = this.edges[edge];
    const from = forward ? E.a : E.b;
    const to = forward ? E.b : E.a;
    const r0 = this.info[from].radius;
    const r1 = this.info[to].radius;
    const len = this.edgeLen[edge];
    return [Math.min(r0, len * 0.45), Math.max(len - r1, len * 0.55)];
  }

  private lanesFor(edge: number): number {
    return Math.max(1, this.edges[edge].lanes);
  }

  /** World position of a lane point at distance s along the directed edge. */
  private lanePoint(edge: number, forward: boolean, lane: number, s: number): [number, number, number, number] {
    const E = this.edges[edge];
    const a = this.nodes[forward ? E.a : E.b];
    const b = this.nodes[forward ? E.b : E.a];
    const len = this.edgeLen[edge] || 1;
    const dx = (b.x - a.x) / len;
    const dz = (b.z - a.z) / len;
    // Right of travel: (-dz, dx). Lanes counted from the centre line outward.
    const off = (lane + 0.5) * LANE_W + (E.cls === 'arterial' ? 1 : E.cls === 'avenue' ? 0.5 : 0);
    return [a.x + dx * s - dz * off, a.z + dz * s + dx * off, dx, dz];
  }

  /** At unsignalised junctions side streets stop for main roads; all-way stop otherwise. */
  private mustStop(node: number, edge: number): boolean {
    const cls = this.edges[edge].cls;
    if (cls === 'street' || cls === 'alley') return true;
    return !this.nodes[node].edges.some((e) => e !== edge && (this.edges[e].cls === 'arterial' || this.edges[e].cls === 'avenue') && this.edges[e].name !== this.edges[edge].name);
  }

  private greenFor(node: number, edge: number, forward: boolean): boolean {
    const inf = this.info[node];
    const E = this.edges[edge];
    const a = this.nodes[forward ? E.a : E.b];
    const n = this.nodes[node];
    // Approach direction angle, folded to [0, pi).
    let ang = Math.atan2(a.z - n.z, a.x - n.x) - inf.axis;
    ang = ((ang % Math.PI) + Math.PI) % Math.PI;
    const groupA = ang < Math.PI / 4 || ang > (3 * Math.PI) / 4;
    const cycle = 56;
    const t = (this.time + inf.offset) % cycle;
    // A green 0-24, amber 24-27, all-red 27-28; B green 28-52, amber 52-55, all-red 55-56.
    return groupA ? t < 25 : t >= 28 && t < 53;
  }

  update(dt: number, camX: number, camZ: number, fwdX = 0, fwdZ = -1): void {
    this.time += dt;
    dt = Math.min(dt, 0.1);
    this.maintainPopulation(camX, camZ, fwdX, fwdZ);
    // Cars on each directed edge + lane, sorted by distance, for car-following.
    const queues = new Map<number, TrafficCar[]>();
    for (const c of this.cars) {
      if (c.turn) continue;
      const k = (c.edge * 2 + (c.forward ? 1 : 0)) * 8 + c.lane;
      let q = queues.get(k);
      if (!q) queues.set(k, (q = []));
      q.push(c);
    }
    for (const q of queues.values()) q.sort((p, r) => p.s - r.s);

    for (const c of this.cars) {
      if (c.turn) {
        this.advanceTurn(c, dt);
        continue;
      }
      const E = this.edges[c.edge];
      const [, end] = this.laneSpan(c.edge, c.forward);
      const limit = E.cls === 'arterial' ? 19 : E.cls === 'avenue' ? 15 : 10.5;
      let target = limit;
      c.reason = 'free';
      // Follow the car ahead.
      const q = queues.get((c.edge * 2 + (c.forward ? 1 : 0)) * 8 + c.lane)!;
      const idx = q.indexOf(c);
      const ahead = q[idx + 1];
      if (ahead) {
        // Bumper-to-bumper gap; always keep a speed we can stop from before reaching 2.5 m.
        const gap = ahead.s - c.s - (LENGTH[ahead.type] + LENGTH[c.type]) / 2;
        const v = safeSpeed(gap - 2.5);
        if (v < target) {
          target = v;
          c.reason = 'follow';
        }
      }
      // Stop line: signals and stop signs.
      const toNode = c.forward ? E.b : E.a;
      const inf = this.info[toNode];
      const distToStop = end - c.s;
      const canStop = distToStop > (c.speed * c.speed) / (2 * 5.5);
      const frontToLine = distToStop - LENGTH[c.type] / 2;
      if (inf.signal && !this.greenFor(toNode, c.edge, c.forward) && distToStop > -1 && canStop) {
        const v = safeSpeed(frontToLine - 0.5);
        if (v < target) [target, c.reason] = [v, 'signal'];
      } else if (inf.stop && !c.stoppedAtSign && distToStop < 25 && this.mustStop(toNode, c.edge)) {
        const v = safeSpeed(frontToLine - 0.3);
        if (v < target) [target, c.reason] = [v, 'stopsign'];
        // Stopped with the front bumper at the line: wait a moment, then go.
        if (frontToLine < 1.2 && c.speed < 0.5) {
          c.stopTimer = 1.2 + this.rng.next();
          c.stoppedAtSign = true;
        }
      }
      if (c.stopTimer > 0) {
        c.stopTimer -= dt;
        target = 0;
        c.reason = 'stopTimer';
      }
      // Pick the next road on the approach. Follow the first car on it (across the
      // junction), and don't block the box: wait at the line until there is room.
      if (distToStop < 40) {
        if (c.plan < 0) c.plan = this.chooseNext(c);
        const nextE = this.edges[c.plan];
        const nf = nextE.a === toNode;
        const nextLane = Math.min(c.lane, this.lanesFor(c.plan) - 1);
        if (!ahead) {
          const room = this.exitRoom(c.plan, nf, c, nextLane);
          if (Number.isFinite(room)) {
            const v = safeSpeed(room + Math.max(0, distToStop) - 2.5);
            if (v < target) [target, c.reason] = [v, 'follow'];
          }
        }
        if (!this.exitClear(c.plan, nf, nextLane, c)) {
          const v = safeSpeed(frontToLine - 0.5);
          if (v < target) [target, c.reason] = [v, 'exitBlocked'];
        }
      }
      // Smooth acceleration; braking up to 7 m/s^2 (the safe speeds assume 4.5).
      const accel = target > c.speed ? 2.6 : -7;
      c.speed = target > c.speed ? Math.min(target, c.speed + accel * dt) : Math.max(target, c.speed + accel * dt);
      c.s += c.speed * dt;
      if (c.s >= end && c.stopTimer <= 0) {
        const nf = c.plan >= 0 && this.edges[c.plan].a === toNode;
        if (c.plan < 0 || this.exitClear(c.plan, nf, Math.min(c.lane, this.lanesFor(c.plan) - 1), c)) this.enterJunction(c);
        else {
          c.s = end;
          c.speed = 0;
          this.pose(c);
        }
      } else this.pose(c);
    }
    // Despawn cars that wandered far away.
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if ((c.x - camX) ** 2 + (c.z - camZ) ** 2 > (this.spawnRadius + 120) ** 2) this.cars.splice(i, 1);
    }
  }

  private pose(c: TrafficCar): void {
    const [x, z, dx, dz] = this.lanePoint(c.edge, c.forward, c.lane, c.s);
    c.x = x;
    c.z = z;
    const t = c.forward ? c.s / (this.edgeLen[c.edge] || 1) : 1 - c.s / (this.edgeLen[c.edge] || 1);
    c.y = this.yOf(x, z, c.edge, t);
    c.yaw = Math.atan2(-dx, -dz);
  }

  private chooseNext(c: TrafficCar): number {
    const E = this.edges[c.edge];
    const node = c.forward ? E.b : E.a;
    const N = this.nodes[node];
    const options = N.edges.filter((e) => e !== c.edge || N.edges.length === 1);
    return options.length ? this.rng.pick(options) : c.edge;
  }

  /** No car in the first metres of the lane, and nobody else turning into it. */
  private exitClear(edge: number, forward: boolean, lane: number, self: TrafficCar): boolean {
    const [start] = this.laneSpan(edge, forward);
    for (const o of this.cars) {
      if (o === self) continue;
      if (o.turn) {
        if (o.turn.nextEdge === edge && o.turn.nextForward === forward && o.lane === lane) return false;
      } else if (o.edge === edge && o.forward === forward && o.lane === lane && o.s - LENGTH[o.type] / 2 < start + LENGTH[self.type] / 2 + 2) return false;
    }
    return true;
  }

  /** Free distance from the start of an exit lane to the rear of the first car on it. */
  private exitRoom(edge: number, forward: boolean, self: TrafficCar, lane = self.lane): number {
    const [start] = this.laneSpan(edge, forward);
    let room = Infinity;
    for (const o of this.cars) {
      if (o === self || o.turn || o.edge !== edge || o.forward !== forward || o.lane !== lane) continue;
      room = Math.min(room, o.s - LENGTH[o.type] / 2 - (start + LENGTH[self.type] / 2));
    }
    return room;
  }

  /** Room for this car at the start of the exit lane (only cars already on the lane count). */
  private landingClear(edge: number, forward: boolean, self: TrafficCar): boolean {
    const [start] = this.laneSpan(edge, forward);
    for (const o of this.cars) {
      if (o === self || o.turn || o.edge !== edge || o.forward !== forward || o.lane !== self.lane) continue;
      if (o.s - LENGTH[o.type] / 2 < start + LENGTH[self.type] / 2 + 1) return false;
    }
    return true;
  }

  private enterJunction(c: TrafficCar): void {
    const E = this.edges[c.edge];
    const node = c.forward ? E.b : E.a;
    const next = c.plan >= 0 ? c.plan : this.chooseNext(c);
    c.plan = -1;
    const nextE = this.edges[next];
    const nextForward = nextE.a === node;
    const [, end] = this.laneSpan(c.edge, c.forward);
    const [start] = this.laneSpan(next, nextForward);
    const lane = Math.min(c.lane, this.lanesFor(next) - 1);
    const [x0, z0, dx0, dz0] = this.lanePoint(c.edge, c.forward, c.lane, end);
    const [x2, z2, dx2, dz2] = this.lanePoint(next, nextForward, lane, start);
    // Control point where the two lane lines meet (or the midpoint if nearly parallel).
    const den = dx0 * dz2 - dz0 * dx2;
    let p1: [number, number];
    if (Math.abs(den) > 0.15) {
      const t = ((x2 - x0) * dz2 - (z2 - z0) * dx2) / den;
      p1 = [x0 + dx0 * t, z0 + dz0 * t];
    } else p1 = [(x0 + x2) / 2, (z0 + z2) / 2];
    const len = Math.hypot(p1[0] - x0, p1[1] - z0) + Math.hypot(x2 - p1[0], z2 - p1[1]);
    c.turn = { p0: [x0, z0], p1, p2: [x2, z2], t: 0, len: Math.max(0.5, len), nextEdge: next, nextForward };
    c.lane = lane;
    c.stoppedAtSign = false;
    // Slow for sharp turns.
    const turnAngle = Math.acos(Math.max(-1, Math.min(1, dx0 * dx2 + dz0 * dz2)));
    c.speed = Math.min(c.speed, turnAngle > 0.6 ? 6 : 12);
  }

  private advanceTurn(c: TrafficCar, dt: number): void {
    const tr = c.turn!;
    // Look ahead into the exit lane: slow down so we can stop behind anyone there.
    const room = this.exitRoom(tr.nextEdge, tr.nextForward, c) + tr.len * (1 - tr.t);
    const target = Math.min(9, safeSpeed(room - 1.5));
    c.speed = target > c.speed ? Math.min(target, c.speed + 2.2 * dt) : Math.max(target, c.speed - 7 * dt);
    const nextT = tr.t + (c.speed * dt) / tr.len;
    if (nextT >= 1 && !this.landingClear(tr.nextEdge, tr.nextForward, c)) {
      // Someone stopped where we would come out: wait inside the junction.
      c.speed = 0;
      return;
    }
    tr.t = nextT;
    if (tr.t >= 1) {
      c.edge = tr.nextEdge;
      c.forward = tr.nextForward;
      c.s = this.laneSpan(c.edge, c.forward)[0];
      c.turn = null;
      this.pose(c);
      return;
    }
    const t = tr.t;
    const u = 1 - t;
    const x = u * u * tr.p0[0] + 2 * u * t * tr.p1[0] + t * t * tr.p2[0];
    const z = u * u * tr.p0[1] + 2 * u * t * tr.p1[1] + t * t * tr.p2[1];
    const dx = 2 * u * (tr.p1[0] - tr.p0[0]) + 2 * t * (tr.p2[0] - tr.p1[0]);
    const dz = 2 * u * (tr.p1[1] - tr.p0[1]) + 2 * t * (tr.p2[1] - tr.p1[1]);
    c.x = x;
    c.z = z;
    c.y = this.yOf(x, z, tr.nextEdge, tr.nextForward ? 0 : 1);
    if (dx * dx + dz * dz > 1e-8) c.yaw = Math.atan2(-dx, -dz);
  }

  private maintainPopulation(camX: number, camZ: number, fwdX: number, fwdZ: number): void {
    let attempts = 0;
    const initialFill = this.cars.length < this.density * 0.5;
    while (this.cars.length < this.density && attempts++ < 30) {
      // Random edge within the spawn radius; once populated, new cars appear out of
      // view (behind the camera or far ahead) so they don't pop in.
      const ang = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng.next()) * this.spawnRadius;
      const px = camX + Math.cos(ang) * r;
      const pz = camZ + Math.sin(ang) * r;
      if (!initialFill) {
        const ahead = (Math.cos(ang) * fwdX + Math.sin(ang) * fwdZ) > 0.2;
        if (ahead && r < this.spawnRadius * 0.8) continue;
      }
      const list = this.edgeGrid.get(Math.floor(px / 64) * 4096 + Math.floor(pz / 64));
      if (!list || list.length === 0) continue;
      const edge = this.rng.pick(list);
      const E = this.edges[edge];
      if (E.cls === 'alley' || this.edgeLen[edge] < 12) continue;
      const forward = this.rng.chance(0.5);
      const lane = this.rng.int(0, this.lanesFor(edge) - 1);
      const [s0, s1] = this.laneSpan(edge, forward);
      if (s1 - s0 < 6) continue;
      if (s1 - s0 < 22) continue;
      const s = this.rng.range(s0 + 12, s1 - 4);
      // Keep a gap to cars already on this lane (and those about to turn into it).
      if (this.cars.some((c) => (!c.turn && c.edge === edge && c.forward === forward && c.lane === lane && Math.abs(c.s - s) < 16) || (c.turn && c.turn.nextEdge === edge && c.turn.nextForward === forward && c.lane === lane))) continue;
      const type = pickType(this.rng, E.cls);
      const car: TrafficCar = {
        id: this.nextId++, type: VEHICLE_TYPES.indexOf(type), color: this.rng.int(0, 17), edge, forward, lane, s,
        speed: 6, turn: null, plan: -1, stopTimer: 0, stoppedAtSign: false, x: 0, y: 0, z: 0, yaw: 0,
      };
      this.pose(car);
      this.cars.push(car);
    }
  }
}

function pickType(rng: Rng, cls: string): VehicleType {
  const types: VehicleType[] = ['sedan', 'hatch', 'suv', 'pickup', 'minivan', 'taxi', 'police', 'bus', 'boxTruck'];
  const w = [32, 12, 26, 10, 8, 4, 1, cls === 'arterial' ? 2 : 0, 3];
  return rng.weighted(types, w);
}
