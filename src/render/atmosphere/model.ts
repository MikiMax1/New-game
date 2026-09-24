// Physical atmosphere parameters shared by the CPU code (sun colour, exposure) and the GLSL
// look-up-table shaders. Distances in km, coefficients per km (as in Hillaire 2020,
// "A Scalable and Production Ready Sky and Atmosphere Rendering Technique").
//
// Port Solmar is humid and subtropical: the aerosol optical depth is ~0.12 at 550 nm
// (about 25x the "clear" reference atmosphere), which gives the milky horizon, ~25 km
// visibility and deep orange sunsets typical of South Florida.

export type RGB = [number, number, number];

export const ATMOSPHERE = {
  /** Planet radius (km). */
  groundRadius: 6360,
  /** Top of the atmosphere (km). */
  topRadius: 6460,
  /** Rayleigh scattering at sea level (1/km) for R, G, B (680, 550, 440 nm). */
  rayleighScattering: [5.802e-3, 13.558e-3, 33.1e-3] as RGB,
  rayleighScaleHeight: 8.0,
  /** Aerosol (Mie) scattering and extinction at sea level (1/km). */
  mieScattering: 0.093,
  mieExtinction: 0.1,
  mieScaleHeight: 1.2,
  /** Henyey-Greenstein asymmetry of the humid haze. */
  mieG: 0.76,
  /** Ozone absorption (1/km) at the peak of the ozone layer. */
  ozoneAbsorption: [0.65e-3, 1.881e-3, 0.085e-3] as RGB,
  ozoneCenter: 25,
  ozoneHalfWidth: 15,
  /** Mean albedo of the ground seen from the sky (city, bay and ocean). */
  groundAlbedo: 0.15,
} as const;

/** Angular radius of the sun disk (radians). */
export const SUN_ANGULAR_RADIUS = 0.2667 * (Math.PI / 180);
/** Angular radius of the moon disk (radians). */
export const MOON_ANGULAR_RADIUS = 0.2575 * (Math.PI / 180);

/**
 * Scene units: the solar illuminance at the top of the atmosphere (~128,000 lux) maps to
 * this value before the time-of-day light scale (see Atmosphere.lightScale) is applied.
 */
export const SUN_ILLUMINANCE = 8;
/** Solar illuminance at the top of the atmosphere, lux. */
export const SUN_LUX = 128000;
/** Full-moon illuminance relative to the sun (0.25 lux / 128,000 lux, bright gibbous moon). */
export const MOON_RELATIVE_ILLUMINANCE = 2.0e-6;

/** Scene radiance units for a luminance in cd/m2 (relative to SUN_ILLUMINANCE at light scale 1). */
export function candelaToScene(cdPerM2: number): number {
  return (cdPerM2 * SUN_ILLUMINANCE) / SUN_LUX;
}

export function rayleighDensity(hKm: number): number {
  return Math.exp(-Math.max(0, hKm) / ATMOSPHERE.rayleighScaleHeight);
}

export function mieDensity(hKm: number): number {
  return Math.exp(-Math.max(0, hKm) / ATMOSPHERE.mieScaleHeight);
}

export function ozoneDensity(hKm: number): number {
  return Math.max(0, 1 - Math.abs(hKm - ATMOSPHERE.ozoneCenter) / ATMOSPHERE.ozoneHalfWidth);
}

/** Distance from a point at radius r along a ray with zenith cosine mu to the sphere of radius R (or -1). */
export function raySphere(r: number, mu: number, R: number): number {
  const disc = r * r * (mu * mu - 1) + R * R;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t0 = -r * mu - s;
  const t1 = -r * mu + s;
  if (t0 > 0) return t0;
  return t1 > 0 ? t1 : -1;
}

/** True when a ray from radius r with zenith cosine mu hits the ground. */
export function rayHitsGround(r: number, mu: number): boolean {
  const Rg = ATMOSPHERE.groundRadius;
  return mu < 0 && r * r * (mu * mu - 1) + Rg * Rg >= 0;
}

/**
 * Transmittance of the atmosphere from altitude `altitudeKm` toward a direction with zenith
 * cosine `mu`, all the way to space. Zero when the ray hits the ground.
 */
export function transmittanceToSpace(altitudeKm: number, mu: number, steps = 48): RGB {
  const Rg = ATMOSPHERE.groundRadius;
  const r = Rg + Math.max(0.001, altitudeKm);
  if (rayHitsGround(r, mu)) return [0, 0, 0];
  const dist = raySphere(r, mu, ATMOSPHERE.topRadius);
  if (dist <= 0) return [1, 1, 1];
  let tauR = 0;
  let tauM = 0;
  let tauO = 0;
  // Midpoint rule with quadratic step distribution (denser near the ground).
  let prevT = 0;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const t = dist * f * f;
    const tm = 0.5 * (t + prevT);
    const dt = t - prevT;
    prevT = t;
    const h = Math.sqrt(r * r + tm * tm + 2 * r * mu * tm) - Rg;
    tauR += rayleighDensity(h) * dt;
    tauM += mieDensity(h) * dt;
    tauO += ozoneDensity(h) * dt;
  }
  const A = ATMOSPHERE;
  const out: RGB = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const tau = A.rayleighScattering[c] * tauR + A.mieExtinction * tauM + A.ozoneAbsorption[c] * tauO;
    out[c] = Math.exp(-tau);
  }
  return out;
}

/** Fraction of a disk of angular radius `radius` (radians) above the horizon at apparent elevation `elevation` (radians). */
export function diskVisibility(elevation: number, radius: number): number {
  const x = Math.max(-1, Math.min(1, elevation / radius));
  // Area fraction of a circle above a chord at signed distance x (in radii).
  return 0.5 + (x * Math.sqrt(1 - x * x) + Math.asin(x)) / Math.PI;
}

/** Relative luminance (Rec. 709 / linear sRGB). */
export function luminance(c: RGB | { r: number; g: number; b: number }): number {
  if (Array.isArray(c)) return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const o = c as { r: number; g: number; b: number };
  return 0.2126 * o.r + 0.7152 * o.g + 0.0722 * o.b;
}

/** Henyey-Greenstein phase function. */
export function phaseHG(cosTheta: number, g: number): number {
  const g2 = g * g;
  return (1 - g2) / (4 * Math.PI * Math.pow(Math.max(1e-6, 1 + g2 - 2 * g * cosTheta), 1.5));
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
