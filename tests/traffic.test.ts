import { beforeAll, describe, expect, it } from 'vitest';
import { Traffic } from '../src/sim/traffic';
import { generateWorld, type WorldData } from '../src/world/gen/world';

let world: WorldData;
beforeAll(() => {
  world = generateWorld(1);
});

describe('traffic', () => {
  it('drives, follows and stops sensibly for two simulated minutes', () => {
    const t = new Traffic(world, () => 1);
    t.density = 150;
    const cam = { x: 150, z: -40 };
    let minGap = Infinity;
    let stoppedSamples = 0;
    let speedSum = 0;
    let speedN = 0;
    let maxSpeed = 0;
    for (let step = 0; step < 2400; step++) {
      t.update(0.05, cam.x, cam.z);
      if (step < 200 || step % 20 !== 0) continue;
      // Gaps between consecutive cars on the same lane.
      const lanes = new Map<string, number[]>();
      for (const c of t.cars) {
        expect(Number.isFinite(c.x) && Number.isFinite(c.z) && Number.isFinite(c.yaw)).toBe(true);
        maxSpeed = Math.max(maxSpeed, c.speed);
        speedSum += c.speed;
        speedN++;
        if (c.speed < 0.3) stoppedSamples++;
        if (c.turn) continue;
        const key = `${c.edge}:${c.forward}:${c.lane}`;
        (lanes.get(key) ?? lanes.set(key, []).get(key)!).push(c.s);
      }
      for (const list of lanes.values()) {
        list.sort((a, b) => a - b);
        for (let i = 1; i < list.length; i++) minGap = Math.min(minGap, list[i] - list[i - 1]);
      }
    }
    console.log(`cars ${t.cars.length}, mean speed ${(speedSum / speedN).toFixed(1)} m/s, max ${maxSpeed.toFixed(1)}, min gap ${minGap.toFixed(1)} m, stopped samples ${stoppedSamples}`);
    expect(t.cars.length).toBeGreaterThan(100);
    expect(speedSum / speedN).toBeGreaterThan(3);
    expect(maxSpeed).toBeLessThanOrEqual(19.01);
    expect(stoppedSamples).toBeGreaterThan(0); // somebody waits at lights or signs
    expect(minGap).toBeGreaterThan(4.3); // centre to centre: no cars inside each other in a lane
  });
});
