// Frame timing: a fixed-rate simulation clock and an optional frame-rate cap.
//
// Rendering runs as fast as the browser presents frames (the monitor's refresh rate, e.g. 240
// Hz) with no limiter unless the player picks a cap. Simulation (physics, traffic) steps at a
// fixed 120 Hz whatever the frame rate, and rendering interpolates between the last two steps.

/** Simulation steps per second. */
export const SIM_RATE = 120;

/** Frame-rate caps the player can cycle through; 0 means no cap. */
export const FPS_CAPS = [0, 60, 120, 144, 165, 240] as const;

/**
 * Turns variable frame times into a whole number of fixed simulation steps. The remainder is
 * carried to the next frame; `alpha` (0..1) says how far the render time is between the last
 * step and the next, for interpolation.
 */
export class FixedStepper {
  /** Fraction of a step left over after the last advance (0..1). */
  alpha = 0;
  /** Steps dropped because a frame took too long (the simulation slows down instead). */
  dropped = 0;
  private accumulator = 0;

  constructor(
    readonly step = 1 / SIM_RATE,
    /** Most steps per frame, so a long stall cannot snowball ("spiral of death"). */
    readonly maxSteps = 8,
  ) {}

  /** Adds a frame of `dt` seconds; returns how many fixed steps to run now. */
  advance(dt: number): number {
    this.accumulator += Math.max(0, dt);
    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSteps) {
      this.accumulator -= this.step;
      steps++;
    }
    if (this.accumulator >= this.step) {
      this.dropped += Math.floor(this.accumulator / this.step);
      this.accumulator %= this.step;
    }
    this.alpha = this.accumulator / this.step;
    return steps;
  }

  reset(): void {
    this.accumulator = 0;
    this.alpha = 0;
  }
}

/**
 * Optional frame-rate cap on top of the browser's frame callbacks. A callback that arrives
 * before the next frame is due is skipped. Deadlines advance by exact intervals, so a 144 fps
 * cap on a 240 Hz monitor averages 144 fps rather than rounding to every second refresh.
 */
export class FrameLimiter {
  /** Frames per second, or 0 for no cap. */
  private fps = 0;
  private next = -Infinity;

  /** Callbacks up to this early (ms) still count as on time: browser timestamps jitter. */
  static readonly TOLERANCE_MS = 0.75;

  get cap(): number {
    return this.fps;
  }

  set cap(fps: number) {
    this.fps = Math.max(0, fps);
    this.next = -Infinity;
  }

  /** Whether the frame callback at `now` (ms) should render. */
  shouldRender(now: number): boolean {
    if (this.fps <= 0) return true;
    if (now + FrameLimiter.TOLERANCE_MS < this.next) return false;
    const interval = 1000 / this.fps;
    this.next += interval;
    // Far behind (first frame, a hidden tab, a stall): restart the schedule from now.
    if (this.next < now) this.next = now + interval;
    return true;
  }
}

/** The next cap in FPS_CAPS after `fps` (wrapping to "no cap"). */
export function nextFpsCap(fps: number): number {
  const i = FPS_CAPS.indexOf(fps as (typeof FPS_CAPS)[number]);
  return FPS_CAPS[(i + 1) % FPS_CAPS.length];
}
