import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Rng } from '../src/world/rng';
import {
  DAY_KEY,
  EyeAdaptation,
  MAX_EV100,
  METER_KEY,
  MIN_EV100,
  MIN_KEY,
  ev100FromExposure,
  ev100FromLuminance,
  exposureFromEv100,
  sceneKey,
  targetEv100,
} from '../src/engine/exposure';
import { FPS_CAPS, FixedStepper, FrameLimiter, SIM_RATE, nextFpsCap } from '../src/engine/timing';
import { FrameStats, HISTORY } from '../src/engine/frameStats';
import { DynamicResolution, SCALE_STEP } from '../src/engine/dynamicResolution';
import { ExposedLights, LightPool, selectNearest } from '../src/engine/lights';
import { QUALITY, atLeast, autoQuality, isQualityName, lowerQuality, nextQuality, type QualityName } from '../src/core/quality';

/** Luminance (nits) sweep on a log scale, from starlight to beyond the sun's glare. */
function luminanceSweep(): number[] {
  const out: number[] = [0];
  for (let e = -6; e <= 9; e += 0.05) out.push(10 ** e);
  return out;
}

/** Scene averages (nits): a sunny street at noon, a street at dusk, a lit street at night. */
const NOON = 5000;
const DUSK = 80;
const NIGHT = 1;

describe('exposure', () => {
  it('meters luminance to EV100 on the photographic scale', () => {
    for (let k = -6; k <= 18; k++) expect(ev100FromLuminance((12.5 / 100) * 2 ** k)).toBeCloseTo(k, 10);
    expect(exposureFromEv100(0)).toBeCloseTo(1 / 1.2, 12);
    expect(exposureFromEv100(1)).toBeCloseTo(1 / 2.4, 12);
    expect(exposureFromEv100(-1)).toBeCloseTo(1 / 0.6, 12);
  });

  it('round-trips EV100, exposure and luminance', () => {
    for (let ev = -8; ev <= 20; ev += 0.25) expect(ev100FromExposure(exposureFromEv100(ev))).toBeCloseTo(ev, 10);
    // A bare meter maps any scene average to the same display value.
    for (const l of [1e-3, 0.5, 1, 30, 4000, 1e5]) {
      expect(l * exposureFromEv100(ev100FromLuminance(l))).toBeCloseTo(METER_KEY, 12);
    }
    expect(METER_KEY).toBeCloseTo(12.5 / 120, 12);
  });

  it('sceneKey rises with luminance and stays within [MIN_KEY, DAY_KEY]', () => {
    let prev = -Infinity;
    for (const l of luminanceSweep()) {
      const k = sceneKey(l);
      expect(k).toBeGreaterThanOrEqual(prev);
      expect(k).toBeGreaterThanOrEqual(MIN_KEY);
      expect(k).toBeLessThanOrEqual(DAY_KEY);
      prev = k;
    }
    expect(sceneKey(0)).toBe(MIN_KEY);
    expect(sceneKey(1e9)).toBe(DAY_KEY);
    expect(sceneKey(4000)).toBeCloseTo(DAY_KEY, 12);
    // A lit night street is between the extremes, not pinned to either.
    expect(sceneKey(NIGHT)).toBeGreaterThan(MIN_KEY);
    expect(sceneKey(NIGHT)).toBeLessThan(DAY_KEY);
  });

  it('targetEv100 orders noon > dusk > night and clamps to the adaptation range', () => {
    expect(targetEv100(NOON)).toBeGreaterThan(targetEv100(DUSK));
    expect(targetEv100(DUSK)).toBeGreaterThan(targetEv100(NIGHT));
    let prev = -Infinity;
    for (const l of luminanceSweep()) {
      const ev = targetEv100(l);
      expect(ev).toBeGreaterThanOrEqual(prev);
      expect(ev).toBeGreaterThanOrEqual(MIN_EV100);
      expect(ev).toBeLessThanOrEqual(MAX_EV100);
      prev = ev;
    }
    expect(targetEv100(0)).toBe(MIN_EV100);
    expect(targetEv100(1e12)).toBe(MAX_EV100);
    // The clamp applies after compensation.
    expect(targetEv100(1e12, 100)).toBe(MIN_EV100);
    expect(targetEv100(0, -100)).toBe(MAX_EV100);
  });

  it('applies exposure compensation in stops (positive brightens)', () => {
    for (const l of [NIGHT, DUSK, NOON]) {
      expect(targetEv100(l, 1)).toBeCloseTo(targetEv100(l) - 1, 12);
      const shown = l * exposureFromEv100(targetEv100(l, 1));
      expect(shown).toBeCloseTo(2 * l * exposureFromEv100(targetEv100(l)), 12);
    }
  });

  it('lands a sunny scene on mid-grey', () => {
    expect(4000 * exposureFromEv100(targetEv100(4000))).toBeCloseTo(0.18, 4);
    expect(NOON * exposureFromEv100(targetEv100(NOON))).toBeCloseTo(0.18, 4);
    expect(targetEv100(4000)).toBeGreaterThan(13);
    expect(targetEv100(4000)).toBeLessThan(16);
  });

  it('shows a night street darker than mid-grey but not black', () => {
    const night = NIGHT * exposureFromEv100(targetEv100(NIGHT));
    const dusk = DUSK * exposureFromEv100(targetEv100(DUSK));
    expect(night).toBeLessThan(0.18 / 2);
    expect(night).toBeGreaterThan(0.03);
    expect(dusk).toBeLessThan(0.18);
    expect(dusk).toBeGreaterThan(night);
    // Moonlight still reads: the key never drops under MIN_KEY.
    expect(0.01 * exposureFromEv100(targetEv100(0.01))).toBeCloseTo(MIN_KEY, 6);
  });
});

describe('EyeAdaptation', () => {
  it('starts at the daylight exposure and snaps on the first reading only', () => {
    const eye = new EyeAdaptation();
    expect(eye.ev100).toBe(targetEv100(eye.luminance));
    eye.measure(NIGHT);
    expect(eye.ev100).toBe(targetEv100(NIGHT));
    expect(eye.exposure).toBe(exposureFromEv100(eye.ev100));
    eye.measure(NOON);
    expect(eye.ev100).toBe(targetEv100(NIGHT));
    expect(eye.targetEv100).toBe(targetEv100(NOON));
    expect(eye.luminance).toBe(NOON);
  });

  it('converges exponentially, independent of the frame rate', () => {
    const eye = new EyeAdaptation();
    eye.measure(NIGHT);
    eye.measure(NOON);
    const start = eye.ev100;
    const target = eye.targetEv100;
    eye.update(eye.brighterTime);
    expect((target - eye.ev100) / (target - start)).toBeCloseTo(Math.exp(-1), 10);

    const fine = new EyeAdaptation();
    const coarse = new EyeAdaptation();
    for (const e of [fine, coarse]) {
      e.measure(NOON);
      e.measure(NIGHT);
    }
    for (let i = 0; i < 240; i++) fine.update(1 / 240);
    coarse.update(1);
    expect(fine.ev100).toBeCloseTo(coarse.ev100, 10);
    expect(Math.exp(-1 / fine.darkerTime)).toBeCloseTo((fine.ev100 - fine.targetEv100) / (targetEv100(NOON) - targetEv100(NIGHT)), 10);

    for (let i = 0; i < 60 * 20; i++) fine.update(1 / 60);
    expect(fine.ev100).toBeCloseTo(fine.targetEv100, 4);
  });

  it('adapts faster to brighter scenes than to darker ones', () => {
    const remaining = (from: number, to: number): number => {
      const eye = new EyeAdaptation();
      eye.measure(from);
      eye.measure(to);
      const start = eye.ev100;
      eye.update(0.5);
      return (eye.ev100 - eye.targetEv100) / (start - eye.targetEv100);
    };
    const toBrighter = remaining(NIGHT, NOON);
    const toDarker = remaining(NOON, NIGHT);
    expect(toBrighter).toBeGreaterThan(0);
    expect(toDarker).toBeLessThan(1);
    expect(toBrighter).toBeLessThan(toDarker);
  });

  it('ignores non-finite readings', () => {
    const eye = new EyeAdaptation();
    eye.measure(NaN);
    eye.measure(Infinity);
    // The first finite reading still snaps.
    eye.measure(DUSK);
    expect(eye.ev100).toBe(targetEv100(DUSK));
    const target = eye.targetEv100;
    for (const bad of [NaN, Infinity, -Infinity]) {
      eye.measure(bad);
      eye.update(1 / 60);
      expect(eye.targetEv100).toBe(target);
      expect(eye.luminance).toBe(DUSK);
      expect(Number.isFinite(eye.ev100)).toBe(true);
    }
  });

  it('honours compensation', () => {
    const eye = new EyeAdaptation();
    eye.compensation = 1;
    eye.measure(DUSK);
    expect(eye.targetEv100).toBeCloseTo(targetEv100(DUSK) - 1, 12);
    expect(eye.exposure).toBeCloseTo(2 * exposureFromEv100(targetEv100(DUSK)), 12);
  });

  it('holds still for dt <= 0 and snaps on request', () => {
    const eye = new EyeAdaptation();
    eye.measure(NOON);
    eye.measure(NIGHT);
    const ev = eye.ev100;
    eye.update(0);
    eye.update(-1);
    expect(eye.ev100).toBe(ev);
    eye.snap();
    expect(eye.ev100).toBe(eye.targetEv100);
  });
});

describe('FixedStepper', () => {
  it('runs whole fixed steps per frame and carries the remainder', () => {
    // A power-of-two step keeps the arithmetic exact.
    const s = new FixedStepper(0.25);
    expect(s.advance(0.5)).toBe(2);
    expect(s.alpha).toBe(0);
    expect(s.advance(0.375)).toBe(1);
    expect(s.alpha).toBe(0.5);
    expect(s.advance(0.125)).toBe(1);
    expect(s.alpha).toBe(0);
    expect(s.advance(0.0625)).toBe(0);
    expect(s.alpha).toBe(0.25);
    expect(s.advance(-1)).toBe(0);
    expect(s.alpha).toBe(0.25);
  });

  it('defaults to SIM_RATE and keeps alpha in [0, 1)', () => {
    const s = new FixedStepper();
    expect(s.step).toBe(1 / SIM_RATE);
    expect(SIM_RATE).toBe(120);
    const rng = new Rng('stepper');
    let time = 0;
    let steps = 0;
    for (let i = 0; i < 5000; i++) {
      const dt = rng.range(0, 0.05);
      time += dt;
      steps += s.advance(dt);
      expect(s.alpha).toBeGreaterThanOrEqual(0);
      expect(s.alpha).toBeLessThan(1);
    }
    expect(s.dropped).toBe(0);
    expect(Math.abs(steps + s.alpha - time * SIM_RATE)).toBeLessThan(1e-6);
  });

  it('runs 2 steps per frame at 60 fps and one every other frame at 240 fps', () => {
    const s = new FixedStepper();
    for (let i = 0; i < 10; i++) expect(s.advance(1 / 60)).toBe(2);
    const t = new FixedStepper();
    let steps = 0;
    for (let i = 0; i < 240; i++) {
      const n = t.advance(1 / 240);
      expect(n).toBeLessThanOrEqual(1);
      steps += n;
    }
    expect(Math.abs(steps - SIM_RATE)).toBeLessThanOrEqual(1);
  });

  it('caps the steps per frame and counts the dropped ones', () => {
    const s = new FixedStepper(0.25, 4);
    expect(s.advance(2.125)).toBe(4);
    expect(s.dropped).toBe(4);
    expect(s.alpha).toBe(0.5);
    // The partial step survives the drop.
    expect(s.advance(0.125)).toBe(1);
    expect(s.alpha).toBe(0);
    const d = new FixedStepper();
    expect(d.advance(1)).toBe(d.maxSteps);
    expect(d.maxSteps).toBe(8);
    expect(d.dropped).toBeGreaterThanOrEqual(111);
    expect(d.dropped).toBeLessThanOrEqual(112);
  });

  it('reset clears the remainder', () => {
    const s = new FixedStepper(0.25);
    s.advance(0.375);
    expect(s.alpha).toBe(0.5);
    s.reset();
    expect(s.alpha).toBe(0);
    expect(s.advance(0.125)).toBe(0);
    expect(s.alpha).toBe(0.5);
  });
});

/** Timestamps (ms) of the frames `limiter` renders out of `seconds` of `hz` callbacks jittered by ±`jitter` ms. */
function runLimiter(limiter: FrameLimiter, hz: number, seconds: number, rng: Rng, t0 = 0, jitter = 0.3): number[] {
  const rendered: number[] = [];
  const period = 1000 / hz;
  const n = Math.round(seconds * hz);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * period + rng.range(-jitter, jitter);
    if (limiter.shouldRender(t)) rendered.push(t);
  }
  return rendered;
}

describe('FrameLimiter', () => {
  it('renders every callback without a cap', () => {
    const l = new FrameLimiter();
    expect(l.cap).toBe(0);
    for (let i = 0; i < 100; i++) expect(l.shouldRender(i * 0.1)).toBe(true);
    expect(l.shouldRender(10)).toBe(true);
    l.cap = -30;
    expect(l.cap).toBe(0);
  });

  it.each([60, 120, 144, 165])('averages %i fps within 2%% on a 240 Hz display', (cap) => {
    const l = new FrameLimiter();
    l.cap = cap;
    const frames = runLimiter(l, 240, 10, new Rng(cap));
    expect(frames.length / 10).toBeGreaterThan(cap * 0.98);
    expect(frames.length / 10).toBeLessThan(cap * 1.02);
  });

  it.each([
    [240, 240],
    [240, 300],
    [144, 144],
    [144, 165],
    [60, 60],
  ])('renders every frame on a %i Hz display with a cap of %i', (hz, cap) => {
    const l = new FrameLimiter();
    l.cap = cap;
    expect(runLimiter(l, hz, 5, new Rng(hz * 1000 + cap)).length).toBe(hz * 5);
  });

  it('does not burst-render to catch up after a stall', () => {
    const l = new FrameLimiter();
    l.cap = 60;
    const rng = new Rng('stall');
    runLimiter(l, 240, 1, rng, 0);
    // Nothing for half a second (a hitch, a hidden tab), then 240 Hz callbacks again.
    const after = runLimiter(l, 240, 1, rng, 1500);
    expect(after[0]).toBeLessThan(1500 + 1);
    expect(after.filter((t) => t < 1600).length).toBeLessThanOrEqual(7);
    expect(after.length).toBeGreaterThanOrEqual(59);
    expect(after.length).toBeLessThanOrEqual(61);
  });

  it('restarts its schedule when the cap changes', () => {
    const l = new FrameLimiter();
    l.cap = 60;
    expect(l.shouldRender(0)).toBe(true);
    expect(l.shouldRender(4)).toBe(false);
    l.cap = 120;
    expect(l.cap).toBe(120);
    expect(l.shouldRender(5)).toBe(true);
    expect(l.shouldRender(9)).toBe(false);
    expect(l.shouldRender(13)).toBe(true);
  });
});

describe('nextFpsCap', () => {
  it('cycles through FPS_CAPS and wraps to no cap', () => {
    expect([...FPS_CAPS]).toEqual([0, 60, 120, 144, 165, 240]);
    const seen: number[] = [];
    let cap = 0;
    for (let i = 0; i < FPS_CAPS.length; i++) {
      cap = nextFpsCap(cap);
      seen.push(cap);
    }
    expect(seen).toEqual([60, 120, 144, 165, 240, 0]);
    expect(nextFpsCap(240)).toBe(0);
    // An unknown value (e.g. an old saved setting) goes back to the start of the cycle.
    expect(nextFpsCap(75)).toBe(0);
  });
});

describe('FrameStats', () => {
  it('is empty before the first frame', () => {
    const s = new FrameStats();
    s.setGpu(5);
    expect(s.summary()).toEqual({ frames: 0, fps: 0, low1: 0, frameMs: 0, worstMs: 0, cpuMs: 0, gpuMs: -1 });
    expect(Array.from(s.gpuMs).every((g) => g === -1)).toBe(true);
  });

  it('averages the frame rate, frame time and CPU time', () => {
    const s = new FrameStats();
    for (let i = 0; i < 4; i++) s.push(4, 1);
    for (let i = 0; i < 4; i++) s.push(8, 3);
    const r = s.summary();
    expect(r.frames).toBe(8);
    expect(r.frameMs).toBeCloseTo(6, 6);
    expect(r.fps).toBeCloseTo(1000 / 6, 6);
    expect(r.cpuMs).toBeCloseTo(2, 6);
    expect(r.worstMs).toBe(8);
    expect(r.gpuMs).toBe(-1);
  });

  it('takes the 1% low from the 99th-percentile frame time', () => {
    const rng = new Rng('low1');
    const run = (fast: number, slow: number): FrameStats => {
      const s = new FrameStats();
      const frames = rng.shuffle([...Array<number>(fast).fill(4), ...Array<number>(slow).fill(20)]);
      for (const f of frames) s.push(f, 1);
      return s;
    };
    // 10 slow frames in 1000: the 1% low is the slow frame rate.
    let r = run(990, 10).summary();
    expect(r.frames).toBe(1000);
    expect(r.low1).toBeCloseTo(50, 6);
    expect(r.worstMs).toBe(20);
    expect(r.fps).toBeCloseTo(1000 / 4.16, 4);
    // 9 in 1000: fewer than 1%, so the 99th percentile is a fast frame.
    r = run(991, 9).summary();
    expect(r.low1).toBeCloseTo(250, 6);
    expect(r.worstMs).toBe(20);
    // With 100 frames the 1% low is the single slowest frame.
    r = run(99, 1).summary();
    expect(r.low1).toBeCloseTo(50, 6);
  });

  it('attaches GPU times to the newest frame and averages only known ones', () => {
    const s = new FrameStats();
    s.push(4, 1);
    s.setGpu(2);
    s.push(4, 1);
    s.push(4, 1);
    s.setGpu(9);
    // A later reading for the same frame replaces the earlier one.
    s.setGpu(4);
    s.push(4, 1);
    expect(s.recent(s.gpuMs, 0)).toBe(-1);
    expect(s.recent(s.gpuMs, 1)).toBe(4);
    expect(s.recent(s.gpuMs, 2)).toBe(-1);
    expect(s.recent(s.gpuMs, 3)).toBe(2);
    expect(s.summary().gpuMs).toBeCloseTo(3, 6);
    // Only frames in the window count.
    expect(s.summary(1).gpuMs).toBe(-1);
    expect(s.summary(2).gpuMs).toBe(4);
  });

  it('wraps the ring buffer at HISTORY', () => {
    const s = new FrameStats();
    s.push(1, 0);
    s.setGpu(7);
    for (let i = 2; i <= HISTORY + 10; i++) s.push(i, 0);
    expect(s.count).toBe(HISTORY);
    expect(s.head).toBe(10);
    expect(s.recent(s.frameMs, 0)).toBe(HISTORY + 10);
    expect(s.recent(s.frameMs, HISTORY - 1)).toBe(11);
    // The overwritten frame's GPU time is gone with it.
    expect(Array.from(s.gpuMs).every((g) => g === -1)).toBe(true);
    const r = s.summary();
    expect(r.frames).toBe(HISTORY);
    expect(r.worstMs).toBe(HISTORY + 10);
    expect(r.frameMs).toBeCloseTo((11 + HISTORY + 10) / 2, 6);
    expect(r.gpuMs).toBe(-1);
  });

  it('summarises the newest `window` frames', () => {
    const s = new FrameStats();
    for (let i = 0; i < 100; i++) s.push(10, 2);
    for (let i = 0; i < 20; i++) s.push(5, 1);
    expect(s.summary(20).fps).toBeCloseTo(200, 6);
    expect(s.summary(20).cpuMs).toBeCloseTo(1, 6);
    expect(s.summary(20).worstMs).toBe(5);
    expect(s.summary(20).frames).toBe(20);
    expect(s.summary(500).frames).toBe(120);
    expect(s.summary().worstMs).toBe(10);
    expect(s.summary(0).frames).toBe(0);
  });
});

interface ScaleChange {
  t: number;
  scale: number;
}

/**
 * Drives `dr` with 60 fps frames for `seconds` from `t0` (s). The GPU time is `msAtFull` times
 * the scale squared (cost follows the pixel count). Returns the end time.
 */
function driveResolution(
  dr: DynamicResolution,
  t0: number,
  seconds: number,
  msAtFull: number,
  budgetMs: number,
  changes: ScaleChange[],
  scales?: number[],
): number {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    const t = t0 + i / 60;
    if (dr.update(msAtFull * dr.scale * dr.scale, budgetMs, t)) changes.push({ t, scale: dr.scale });
    scales?.push(dr.scale);
  }
  return t0 + n / 60;
}

const isStepMultiple = (s: number): boolean => Math.abs(s / SCALE_STEP - Math.round(s / SCALE_STEP)) < 1e-6;
const BUDGET_60 = 1000 / 60;

describe('DynamicResolution', () => {
  it('stays at the maximum while disabled', () => {
    const dr = new DynamicResolution(1, 0.5);
    const changes: ScaleChange[] = [];
    driveResolution(dr, 0, 5, 60, BUDGET_60, changes);
    expect(changes).toEqual([]);
    expect(dr.scale).toBe(1);
  });

  it('drops when over budget for a while and settles within budget', () => {
    const dr = new DynamicResolution(1, 0.5);
    dr.enabled = true;
    const changes: ScaleChange[] = [];
    const scales: number[] = [];
    driveResolution(dr, 0, 30, 40, BUDGET_60, changes, scales);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0].scale).toBeLessThan(1);
    // Not on the first slow frames: the load must last.
    expect(changes[0].t).toBeGreaterThan(0.4);
    expect(40 * dr.scale * dr.scale).toBeLessThanOrEqual(0.92 * BUDGET_60);
    for (const s of scales) {
      expect(s).toBeGreaterThanOrEqual(0.5);
      expect(s).toBeLessThanOrEqual(1);
      expect(isStepMultiple(s)).toBe(true);
    }
  });

  it('never drops below the minimum', () => {
    const dr = new DynamicResolution(1, 0.5);
    dr.enabled = true;
    const changes: ScaleChange[] = [];
    const scales: number[] = [];
    driveResolution(dr, 0, 20, 200, BUDGET_60, changes, scales);
    expect(dr.scale).toBe(0.5);
    expect(Math.min(...scales)).toBe(0.5);
  });

  it('changes no more often than its cooldown', () => {
    const dr = new DynamicResolution(1, 0.3);
    dr.enabled = true;
    const changes: ScaleChange[] = [];
    let t = driveResolution(dr, 0, 20, 400, BUDGET_60, changes);
    t = driveResolution(dr, t, 40, 2, BUDGET_60, changes);
    driveResolution(dr, t, 20, 400, BUDGET_60, changes);
    expect(changes.length).toBeGreaterThan(5);
    for (let i = 1; i < changes.length; i++) expect(changes[i].t - changes[i - 1].t).toBeGreaterThanOrEqual(0.75);
  });

  it('ignores a single slow frame', () => {
    const dr = new DynamicResolution(1, 0.5);
    dr.enabled = true;
    const changes: ScaleChange[] = [];
    let t = driveResolution(dr, 0, 2, 8, BUDGET_60, changes);
    dr.update(100, BUDGET_60, t);
    driveResolution(dr, t + 1 / 60, 3, 8, BUDGET_60, changes);
    expect(changes).toEqual([]);
    expect(dr.scale).toBe(1);
  });

  it('climbs back in SCALE_STEP increments after more than 2 s under budget', () => {
    const dr = new DynamicResolution(1, 0.5);
    dr.enabled = true;
    const drops: ScaleChange[] = [];
    const t = driveResolution(dr, 0, 20, 200, BUDGET_60, drops);
    expect(dr.scale).toBe(0.5);
    const climbs: ScaleChange[] = [];
    const scales: number[] = [];
    driveResolution(dr, t, 40, 4, BUDGET_60, climbs, scales);
    expect(dr.scale).toBe(1);
    expect(climbs.length).toBe(Math.round(0.5 / SCALE_STEP));
    let prev = { t, scale: 0.5 };
    for (const c of climbs) {
      expect(c.scale - prev.scale).toBeCloseTo(SCALE_STEP, 9);
      expect(c.t - prev.t).toBeGreaterThan(2);
      prev = c;
    }
    for (const s of scales) expect(isStepMultiple(s)).toBe(true);
  });

  it('keeps preset ranges that are not step multiples within [min, max] and settles', () => {
    for (const name of ['low', 'ultra'] as const) {
      const q = QUALITY[name];
      const dr = new DynamicResolution(q.sceneScale, q.minSceneScale);
      dr.enabled = true;
      // Headroom from the start: nothing to change.
      expect(dr.update(1, BUDGET_60, 0)).toBe(false);
      expect(dr.scale).toBe(q.sceneScale);
      const changes: ScaleChange[] = [];
      const scales: number[] = [];
      let t = driveResolution(dr, 1, 20, 400, BUDGET_60, changes, scales);
      expect(dr.scale).toBe(q.minSceneScale);
      t = driveResolution(dr, t, 40, 2, BUDGET_60, changes, scales);
      expect(dr.scale).toBe(q.sceneScale);
      for (const s of scales) {
        expect(s).toBeGreaterThanOrEqual(q.minSceneScale);
        expect(s).toBeLessThanOrEqual(q.sceneScale);
        // Only the preset's own end points may fall between steps.
        expect(isStepMultiple(s) || s === q.minSceneScale || s === q.sceneScale).toBe(true);
      }
      // Back at the top with headroom it stays put (no flipping between 0.65 and 0.67).
      const later: ScaleChange[] = [];
      driveResolution(dr, t, 20, 2, BUDGET_60, later);
      expect(later).toEqual([]);
    }
  });

  it('returns to the maximum when disabled later', () => {
    const dr = new DynamicResolution(1, 0.5);
    dr.enabled = true;
    const t = driveResolution(dr, 0, 10, 60, BUDGET_60, []);
    expect(dr.scale).toBeLessThan(1);
    dr.enabled = false;
    expect(dr.update(60, BUDGET_60, t)).toBe(true);
    expect(dr.scale).toBe(1);
    expect(dr.update(60, BUDGET_60, t + 1)).toBe(false);
  });

  it('ignores unknown GPU times and budgets', () => {
    const dr = new DynamicResolution(1, 0.5);
    dr.enabled = true;
    for (let i = 0; i < 600; i++) {
      const t = i / 60;
      expect(dr.update(-1, BUDGET_60, t)).toBe(false);
      expect(dr.update(NaN, BUDGET_60, t)).toBe(false);
      expect(dr.update(100, 0, t)).toBe(false);
    }
    expect(dr.scale).toBe(1);
    expect(dr.smoothedMs).toBe(0);
  });

  it('setRange clamps the current scale to the new range', () => {
    const dr = new DynamicResolution(1, 0.5);
    dr.setRange(0.5, 0.8);
    expect(dr.scale).toBe(0.8);
    dr.enabled = true;
    dr.setRange(0.5, 1);
    expect(dr.scale).toBe(0.8);
    dr.setRange(0.9, 1.5);
    expect(dr.scale).toBe(0.9);
    expect(dr.minScale).toBe(0.9);
    expect(dr.maxScale).toBe(1.5);
    dr.setRange(0.3, 0.6);
    expect(dr.scale).toBe(0.6);
    // A minimum above the maximum collapses to the maximum.
    dr.setRange(0.9, 0.7);
    expect(dr.minScale).toBe(0.7);
    expect(dr.maxScale).toBe(0.7);
    expect(dr.scale).toBe(0.7);
  });
});

interface Nearest {
  idx: number[];
  dist2: number[];
  cutoff: number;
}

function bruteNearest(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  zs: ArrayLike<number>,
  n: number,
  c: [number, number, number],
  k: number,
  skip?: (i: number) => boolean,
): Nearest {
  const all: { i: number; d: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (skip?.(i)) continue;
    const dx = xs[i] - c[0];
    const dy = ys[i] - c[1];
    const dz = zs[i] - c[2];
    all.push({ i, d: dx * dx + dy * dy + dz * dz });
  }
  all.sort((a, b) => a.d - b.d);
  const best = all.slice(0, k);
  return { idx: best.map((e) => e.i), dist2: best.map((e) => e.d), cutoff: all.length > k ? all[k].d : Infinity };
}

function runSelect(
  xs: Float64Array,
  ys: Float64Array,
  zs: Float64Array,
  c: [number, number, number],
  k: number,
  skip?: (i: number) => boolean,
): Nearest & { count: number } {
  const out = new Int32Array(k);
  const outDist2 = new Float64Array(k + 1);
  const count = selectNearest(xs, ys, zs, xs.length, c[0], c[1], c[2], k, out, outDist2, skip);
  return { count, idx: Array.from(out.subarray(0, count)), dist2: Array.from(outDist2.subarray(0, count)), cutoff: outDist2[count] };
}

function randomPoints(rng: Rng, n: number, extent: number): [Float64Array, Float64Array, Float64Array] {
  const p = [new Float64Array(n), new Float64Array(n), new Float64Array(n)] as [Float64Array, Float64Array, Float64Array];
  for (let i = 0; i < n; i++) {
    p[0][i] = rng.range(-extent, extent);
    p[1][i] = rng.range(0, extent / 10);
    p[2][i] = rng.range(-extent, extent);
  }
  return p;
}

describe('selectNearest', () => {
  it('matches a brute-force sort on random points', () => {
    const rng = new Rng('selectNearest');
    for (const n of [0, 1, 2, 7, 100, 1000]) {
      for (const k of [0, 1, 3, 16, 64, n, n + 5]) {
        for (let trial = 0; trial < 3; trial++) {
          const [xs, ys, zs] = randomPoints(rng, n, 500);
          const c: [number, number, number] = [rng.range(-600, 600), rng.range(0, 20), rng.range(-600, 600)];
          const got = runSelect(xs, ys, zs, c, k);
          const want = bruteNearest(xs, ys, zs, n, c, k);
          expect(got.count).toBe(Math.min(k, n));
          expect(got.idx).toEqual(want.idx);
          expect(got.dist2).toEqual(want.dist2);
          expect(got.cutoff).toBe(want.cutoff);
        }
      }
    }
  });

  it('returns the nearest distance as the cut-off when k = 0', () => {
    const [xs, ys, zs] = randomPoints(new Rng(3), 50, 100);
    const got = runSelect(xs, ys, zs, [0, 0, 0], 0);
    expect(got.count).toBe(0);
    expect(got.cutoff).toBe(bruteNearest(xs, ys, zs, 50, [0, 0, 0], 1).dist2[0]);
  });

  it('reports no cut-off when every point fits', () => {
    const [xs, ys, zs] = randomPoints(new Rng(4), 10, 100);
    const got = runSelect(xs, ys, zs, [5, 5, 5], 32);
    expect(got.count).toBe(10);
    expect(got.cutoff).toBe(Infinity);
    for (let i = 1; i < got.count; i++) expect(got.dist2[i]).toBeGreaterThanOrEqual(got.dist2[i - 1]);
  });

  it('leaves out skipped points, including from the cut-off', () => {
    const rng = new Rng('skip');
    const skip = (i: number): boolean => i % 3 !== 0;
    for (const k of [0, 1, 8, 40, 400]) {
      const [xs, ys, zs] = randomPoints(rng, 300, 200);
      const got = runSelect(xs, ys, zs, [0, 1, 0], k, skip);
      const want = bruteNearest(xs, ys, zs, 300, [0, 1, 0], k, skip);
      expect(got.count).toBe(Math.min(k, 100));
      expect(got.idx).toEqual(want.idx);
      expect(got.cutoff).toBe(want.cutoff);
      expect(got.idx.every((i) => i % 3 === 0)).toBe(true);
    }
    const [xs, ys, zs] = randomPoints(rng, 20, 50);
    const none = runSelect(xs, ys, zs, [0, 0, 0], 4, () => true);
    expect(none.count).toBe(0);
    expect(none.cutoff).toBe(Infinity);
  });

  it('handles equal distances', () => {
    // Integer grid: many points share a distance, so only the distances are unique.
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (let x = -5; x <= 5; x++) {
      for (let z = -5; z <= 5; z++) {
        xs.push(x);
        ys.push(0);
        zs.push(z);
      }
    }
    const [fx, fy, fz] = [Float64Array.from(xs), Float64Array.from(ys), Float64Array.from(zs)];
    for (const k of [1, 5, 9, 13, 50]) {
      const got = runSelect(fx, fy, fz, [0, 0, 0], k);
      const want = bruteNearest(fx, fy, fz, fx.length, [0, 0, 0], k);
      expect(got.dist2).toEqual(want.dist2);
      expect(got.cutoff).toBe(want.cutoff);
      expect(new Set(got.idx).size).toBe(k);
    }
  });
});

describe('LightPool', () => {
  const origin = new THREE.Vector3();
  const lightsOf = (pool: LightPool): THREE.PointLight[] => pool.group.children as THREE.PointLight[];
  /** Lamps at x = 1..n on a line through the origin, added in a shuffled order. */
  const lampLine = (pool: LightPool, n: number, candela = 100): void => {
    const xs = new Rng(n).shuffle(Array.from({ length: n }, (_, i) => i + 1));
    for (const x of xs) pool.add(x, 0, 0, candela, 0xffffff, 30);
  };

  it('keeps a fixed pool of point lights and resizes it', () => {
    const pool = new LightPool(8);
    expect(pool.size).toBe(8);
    expect(pool.count).toBe(0);
    expect(lightsOf(pool).length).toBe(8);
    for (const l of lightsOf(pool)) {
      expect(l).toBeInstanceOf(THREE.PointLight);
      expect(l.intensity).toBe(0);
    }
    const kept = lightsOf(pool)[0];
    pool.resize(3);
    expect(pool.size).toBe(3);
    expect(lightsOf(pool).length).toBe(3);
    expect(lightsOf(pool)[0]).toBe(kept);
    pool.resize(12.7);
    expect(pool.size).toBe(12);
    expect(lightsOf(pool).length).toBe(12);
    pool.resize(-4);
    expect(pool.size).toBe(0);
    lampLine(pool, 5);
    pool.update(origin, 1);
    expect(pool.active).toBe(0);
  });

  it('lights only the lamps nearest the camera', () => {
    const pool = new LightPool(8);
    lampLine(pool, 20);
    pool.update(origin, 1);
    const xs = lightsOf(pool).map((l) => l.position.x).sort((a, b) => a - b);
    expect(xs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(pool.active).toBe(8);
    pool.update(new THREE.Vector3(100, 0, 0), 1);
    expect(lightsOf(pool).map((l) => l.position.x).sort((a, b) => a - b)).toEqual([13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it('sets intensity = candela x dimmer x exposure for close lamps', () => {
    const pool = new LightPool(8);
    lampLine(pool, 20, 250);
    pool.dimmer = 0.5;
    pool.update(origin, 0.01);
    for (const l of lightsOf(pool)) {
      // The cut-off is 9 m (the nearest lamp left out); the fade starts at 80% of it.
      if (l.position.x <= 7) expect(l.intensity).toBeCloseTo(250 * 0.5 * 0.01, 9);
      else expect(l.intensity).toBeLessThan(250 * 0.5 * 0.01);
    }
  });

  it('fades the farthest pooled lamps toward 0 near the cut-off', () => {
    const pool = new LightPool(8);
    lampLine(pool, 8);
    // The nearest lamp left out is just beyond the farthest pooled one.
    pool.add(8.02, 0, 0, 100, 0xffffff, 30);
    pool.update(origin, 1);
    const byDistance = [...lightsOf(pool)].sort((a, b) => a.position.x - b.position.x);
    expect(byDistance[0].intensity).toBeCloseTo(100, 9);
    for (let i = 1; i < byDistance.length; i++) expect(byDistance[i].intensity).toBeLessThanOrEqual(byDistance[i - 1].intensity);
    expect(byDistance[7].position.x).toBe(8);
    expect(byDistance[7].intensity).toBeGreaterThan(0);
    expect(byDistance[7].intensity).toBeLessThan(1);
  });

  it('does not fade when the pool holds every lamp', () => {
    const pool = new LightPool(8);
    lampLine(pool, 3);
    pool.update(origin, 2);
    const lit = lightsOf(pool).filter((l) => l.intensity > 0);
    expect(lit.length).toBe(3);
    expect(pool.active).toBe(3);
    for (const l of lit) expect(l.intensity).toBe(200);
  });

  it('switches every lamp off at dimmer 0', () => {
    const pool = new LightPool(8);
    lampLine(pool, 20);
    pool.update(origin, 1);
    pool.dimmer = 0;
    pool.update(origin, 1);
    expect(pool.active).toBe(0);
    for (const l of lightsOf(pool)) expect(l.intensity).toBe(0);
  });

  it('skips lamps with no candela', () => {
    const pool = new LightPool(4);
    const first = pool.add(1, 0, 0, 100, 0xffffff, 30);
    for (let x = 2; x <= 10; x++) pool.add(x, 0, 0, 100, 0xffffff, 30);
    pool.setCandela(first, 0);
    pool.update(origin, 1);
    expect(lightsOf(pool).map((l) => l.position.x).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });

  it('copies colour and range, and follows moved lamps', () => {
    const pool = new LightPool(2);
    const red = pool.add(3, 4, 0, 100, 0xff0000, 25);
    pool.add(50, 0, 0, 100, 0x0000ff, 40);
    pool.update(origin, 1);
    const near = lightsOf(pool).find((l) => l.position.x === 3)!;
    expect([near.color.r, near.color.g, near.color.b]).toEqual([1, 0, 0]);
    expect(near.distance).toBe(25);
    expect(near.position.y).toBe(4);
    pool.setPosition(red, 60, 0, 0);
    pool.update(origin, 1);
    expect(lightsOf(pool).map((l) => l.position.x).sort((a, b) => a - b)).toEqual([50, 60]);
  });

  it('grows past its initial capacity without losing lamps', () => {
    const pool = new LightPool(4);
    const first = pool.add(1000, 0, 0, 100, 0xffffff, 30);
    for (let i = 1; i < 300; i++) pool.add(1000 - i * 3, 5, 0, 100, 0xffffff, 30);
    expect(pool.count).toBe(300);
    pool.update(new THREE.Vector3(0, 5, 0), 1);
    expect(lightsOf(pool).map((l) => l.position.x).sort((a, b) => a - b)).toEqual([103, 106, 109, 112]);
    // The first lamp's data survived every reallocation.
    pool.setPosition(first, 0, 5, 0);
    pool.update(new THREE.Vector3(0, 5, 0), 1);
    expect(lightsOf(pool).map((l) => l.position.x).sort((a, b) => a - b)).toEqual([0, 103, 106, 109]);
    expect(pool.active).toBe(4);
  });
});

describe('ExposedLights', () => {
  it('sets intensity = physical value x exposure', () => {
    const lights = new ExposedLights();
    const sun = new THREE.DirectionalLight();
    const lamp = new THREE.PointLight();
    expect(lights.add(sun, 100000)).toBe(sun);
    lights.add(lamp, 800);
    lights.apply(1e-4);
    expect(sun.intensity).toBeCloseTo(10, 9);
    expect(lamp.intensity).toBeCloseTo(0.08, 9);
    expect(lights.get(sun)).toBe(100000);
    lights.set(sun, 50000);
    lights.remove(lamp);
    expect(lights.get(lamp)).toBe(0);
    lights.apply(2e-4);
    expect(sun.intensity).toBeCloseTo(10, 9);
    expect(lamp.intensity).toBeCloseTo(0.08, 9);
  });
});

describe('quality presets', () => {
  const ORDER: QualityName[] = ['low', 'medium', 'high', 'ultra', 'extreme'];

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has an extreme preset at or above ultra', () => {
    const u = QUALITY.ultra;
    const x = QUALITY.extreme;
    expect(isQualityName('extreme')).toBe(true);
    expect(x.name).toBe('extreme');
    expect(x.shadowMapSize).toBeGreaterThanOrEqual(u.shadowMapSize);
    expect(x.shadowDistance).toBeGreaterThanOrEqual(u.shadowDistance);
    expect(x.drawDistance).toBeGreaterThanOrEqual(u.drawDistance);
    expect(x.detail).toBeGreaterThanOrEqual(u.detail);
    expect(x.maxLights).toBeGreaterThanOrEqual(u.maxLights);
    expect(x.shadows).toBe(true);
  });

  it('scales up with each preset', () => {
    for (let i = 0; i < ORDER.length; i++) {
      const q = QUALITY[ORDER[i]];
      expect(q.name).toBe(ORDER[i]);
      expect(q.sceneScale).toBeGreaterThan(0);
      expect(q.sceneScale).toBeLessThanOrEqual(2);
      expect(q.minSceneScale).toBeGreaterThan(0);
      expect(q.minSceneScale).toBeLessThanOrEqual(q.sceneScale);
      expect(Number.isInteger(q.maxLights) && q.maxLights > 0).toBe(true);
      if (i === 0) continue;
      const p = QUALITY[ORDER[i - 1]];
      expect(q.drawDistance).toBeGreaterThanOrEqual(p.drawDistance);
      expect(q.shadowDistance).toBeGreaterThanOrEqual(p.shadowDistance);
      expect(q.detail).toBeGreaterThanOrEqual(p.detail);
      expect(q.maxLights).toBeGreaterThanOrEqual(p.maxLights);
    }
  });

  it('cycles low -> medium -> high -> ultra -> extreme -> low', () => {
    let q = QUALITY.low;
    const seen: QualityName[] = [];
    for (let i = 0; i < ORDER.length; i++) {
      q = nextQuality(q);
      seen.push(q.name);
    }
    expect(seen).toEqual(['medium', 'high', 'ultra', 'extreme', 'low']);
    expect(lowerQuality(QUALITY.extreme).name).toBe('ultra');
    expect(lowerQuality(QUALITY.low).name).toBe('low');
  });

  it('atLeast compares presets by rank', () => {
    for (let i = 0; i < ORDER.length; i++) {
      for (let j = 0; j < ORDER.length; j++) expect(atLeast(QUALITY[ORDER[i]], ORDER[j])).toBe(i >= j);
    }
  });

  it('autoQuality picks by GPU kind, memory and cores as before', () => {
    // Node has its own navigator (with this machine's core count): pin a typical PC.
    vi.stubGlobal('navigator', { hardwareConcurrency: 8, deviceMemory: 8 });
    expect(autoQuality({ renderer: 'NVIDIA GeForce RTX 4080', kind: 'discrete' })).toBe('high');
    expect(autoQuality({ renderer: 'SwiftShader', kind: 'software' })).toBe('low');
    expect(autoQuality({ renderer: 'Intel UHD 620', kind: 'integrated' })).toBe('medium');
    expect(autoQuality({ renderer: '', kind: 'unknown' })).toBe('medium');
    expect(autoQuality()).toBe('medium');
    vi.stubGlobal('navigator', { hardwareConcurrency: 4, deviceMemory: 8 });
    expect(autoQuality({ renderer: 'NVIDIA GeForce GTX 1060', kind: 'discrete' })).toBe('medium');
    vi.stubGlobal('navigator', { hardwareConcurrency: 16, deviceMemory: 2 });
    expect(autoQuality({ renderer: 'NVIDIA GeForce RTX 4080', kind: 'discrete' })).toBe('low');
    // Auto-detection never picks extreme: strong PCs opt in.
    vi.stubGlobal('navigator', { hardwareConcurrency: 64, deviceMemory: 64 });
    expect(autoQuality({ renderer: 'NVIDIA GeForce RTX 5090', kind: 'discrete' })).toBe('high');
  });
});
