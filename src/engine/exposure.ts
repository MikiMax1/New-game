// Physical camera exposure (EV100) and eye adaptation.
//
// Lights, emissive surfaces and the sky are given in physical units: lux for the sun and moon,
// candela for lamps, nits (cd/m²) for glowing surfaces and the sky. The scene is rendered
// pre-exposed: every radiance is multiplied by the current exposure before it is written to
// the half-float frame buffer, so values stay near 1 at noon and at night alike (a sunlit wall
// and a moonlit one differ by about 18 stops, far beyond half-float precision otherwise).
//
// Exposure uses the photographic conventions of Lagarde & de Rousiers, "Moving Frostbite to
// Physically Based Rendering" (2014):
//   EV100    = log2(L_avg * S / K)       average-reading reflected-light meter, S = 100, K = 12.5
//   exposure = 1 / (1.2 * 2^EV100)       saturation-based sensitivity: 1.2 * 2^EV100 maps to 1.0
//
// A meter alone would make midnight look like noon. The eye does not fully adapt: dim scenes
// are shown darker than bright ones. The target brightness of the scene average (the "key")
// follows Krawczyk, Myszkowski & Seidel, "Lightness Perception in Tone Reproduction for High
// Dynamic Range Images" (2005), normalised so a sunny day lands on photographic mid-grey.

/** Reflected-light meter calibration constant. */
export const METER_K = 12.5;
/** Display value the meter maps the scene average to: K / (1.2 * S) ≈ 0.104. */
export const METER_KEY = METER_K / (1.2 * 100);
/** Mid-grey: the key for a bright sunny scene. */
export const DAY_KEY = 0.18;
/** Darkest key (moonlight): keeps a dark night readable. */
export const MIN_KEY = 0.03;
/** Scene average (nits) of a typical sunny street view, where the key is DAY_KEY. */
const DAY_LUMINANCE = 4000;

/** Range the camera can adapt over (EV100): a bright beach at noon to a moonlit field. */
export const MIN_EV100 = -5;
export const MAX_EV100 = 17;

/** EV100 a reflected-light meter reads for an average scene luminance (nits). */
export function ev100FromLuminance(luminance: number): number {
  return Math.log2((Math.max(luminance, 1e-9) * 100) / METER_K);
}

/** Linear exposure (pre-exposure multiplier) for an EV100. */
export function exposureFromEv100(ev100: number): number {
  return 1 / (1.2 * Math.pow(2, ev100));
}

export function ev100FromExposure(exposure: number): number {
  return Math.log2(1 / (1.2 * exposure));
}

/** Krawczyk et al. key value for an average luminance in nits. */
function krawczykKey(luminance: number): number {
  return 1.03 - 2 / (2 + Math.log10(Math.max(0, luminance) + 1));
}

/**
 * Display value (linear, before tone mapping) the scene average should land on: mid-grey in
 * daylight, darker at dusk and night, as the eye sees it.
 */
export function sceneKey(luminance: number): number {
  const k = (DAY_KEY * krawczykKey(luminance)) / krawczykKey(DAY_LUMINANCE);
  return Math.min(DAY_KEY, Math.max(MIN_KEY, k));
}

/** EV100 the eye settles on for an average scene luminance (nits), including the key. */
export function targetEv100(luminance: number, compensation = 0): number {
  // The meter maps L to METER_KEY; shift by the stops between that and the wanted key.
  const ev = ev100FromLuminance(luminance) - Math.log2(sceneKey(luminance) / METER_KEY) - compensation;
  return Math.min(MAX_EV100, Math.max(MIN_EV100, ev));
}

/**
 * Eye adaptation: EV100 moves toward the metered target exponentially, faster when the scene
 * gets brighter (the pupil closes in a fraction of a second) than when it gets darker.
 */
export class EyeAdaptation {
  ev100: number;
  /** Extra exposure in stops (positive brightens), e.g. a player setting. */
  compensation = 0;
  /** Time constants (s): adapting to brighter and to darker scenes. */
  brighterTime = 0.4;
  darkerTime = 1.2;
  /** Last metered average scene luminance (nits). */
  luminance = DAY_LUMINANCE;
  private target: number;
  private hasMeasurement = false;

  constructor(ev100 = targetEv100(DAY_LUMINANCE)) {
    this.ev100 = ev100;
    this.target = ev100;
  }

  get exposure(): number {
    return exposureFromEv100(this.ev100);
  }

  get targetEv100(): number {
    return this.target;
  }

  /** A new meter reading: average scene luminance in nits. */
  measure(luminance: number): void {
    if (!Number.isFinite(luminance)) return;
    this.luminance = luminance;
    this.target = targetEv100(luminance, this.compensation);
    // The first reading snaps: no fade-in from the wrong exposure at start-up.
    if (!this.hasMeasurement) {
      this.hasMeasurement = true;
      this.ev100 = this.target;
    }
  }

  /** Jump straight to the target (after a teleport or a time-of-day skip). */
  snap(): void {
    this.ev100 = this.target;
  }

  update(dt: number): void {
    const brighter = this.target > this.ev100;
    const tau = brighter ? this.brighterTime : this.darkerTime;
    this.ev100 += (this.target - this.ev100) * (1 - Math.exp(-Math.max(0, dt) / tau));
  }
}
