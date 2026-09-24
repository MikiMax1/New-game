// Sun and moon positions for Port Solmar.
//
// Low-precision solar ephemeris (Astronomical Almanac, good to ~0.01 deg) and a simple moon
// model: the moon sits on the ecliptic at a fixed elongation from the sun. Time is local
// *solar* time in hours (12.0 = the sun crosses the meridian), so the sun rises roughly at
// 6:00 near the equinoxes. Directions use world axes: +X east, +Y up, +Z south.

const DEG = Math.PI / 180;
/** Obliquity of the ecliptic (radians). */
const OBLIQUITY = 23.439 * DEG;
/** Days from J2000.0 to 2025-01-01 12:00 UT; the year only shifts results by minutes of arc. */
const J2000_TO_REF_YEAR = 9131;

export interface SkyPosition {
  /** Unit vector toward the body, world space, including atmospheric refraction. */
  direction: [number, number, number];
  /** Apparent elevation above the horizon (degrees, refraction included). */
  elevation: number;
  /** Geometric (true) elevation (degrees). */
  trueElevation: number;
  /** Azimuth clockwise from north (degrees, 90 = east). */
  azimuth: number;
}

/** Ecliptic longitude of the sun (radians) for a day of the year (1 = Jan 1) at local noon. */
export function sunEclipticLongitude(dayOfYear: number): number {
  const d = J2000_TO_REF_YEAR + dayOfYear;
  const g = (357.529 + 0.98560028 * d) * DEG; // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude (deg)
  return (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
}

/** Declination and right ascension (radians) of a point on the ecliptic at longitude `lambda`. */
export function eclipticToEquatorial(lambda: number): { dec: number; ra: number } {
  return {
    dec: Math.asin(Math.sin(OBLIQUITY) * Math.sin(lambda)),
    ra: Math.atan2(Math.cos(OBLIQUITY) * Math.sin(lambda), Math.cos(lambda)),
  };
}

/**
 * Atmospheric refraction (degrees) for a true elevation in degrees (Saemundsson). Fades to zero
 * below -2 deg so directions stay continuous when a body is well under the horizon.
 */
export function refraction(trueElevationDeg: number): number {
  const h = Math.max(trueElevationDeg, -1.9);
  const r = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * DEG) / 60;
  if (trueElevationDeg >= -1) return r;
  // Blend to zero between -1 and -3 deg.
  const t = Math.min(1, (-1 - trueElevationDeg) / 2);
  return r * (1 - t * t * (3 - 2 * t));
}

/** Local horizontal position of a body with declination `dec` at hour angle `hourAngle` (radians). */
export function horizontalPosition(dec: number, hourAngle: number, latitudeDeg: number): SkyPosition {
  const phi = latitudeDeg * DEG;
  const east = -Math.cos(dec) * Math.sin(hourAngle);
  const north = Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.cos(hourAngle) * Math.sin(phi);
  const up = Math.sin(dec) * Math.sin(phi) + Math.cos(dec) * Math.cos(hourAngle) * Math.cos(phi);
  const trueElevation = Math.asin(Math.max(-1, Math.min(1, up))) / DEG;
  const azimuth = ((Math.atan2(east, north) / DEG) % 360 + 360) % 360;
  const elevation = trueElevation + refraction(trueElevation);
  const ce = Math.cos(elevation * DEG);
  const az = azimuth * DEG;
  return {
    direction: [Math.sin(az) * ce, Math.sin(elevation * DEG), -Math.cos(az) * ce],
    elevation,
    trueElevation,
    azimuth,
  };
}

/** Position of the sun for a day of the year and local solar time (hours). */
export function sunPosition(dayOfYear: number, solarHours: number, latitudeDeg: number): SkyPosition {
  const { dec } = eclipticToEquatorial(sunEclipticLongitude(dayOfYear));
  const hourAngle = (solarHours - 12) * 15 * DEG;
  return horizontalPosition(dec, hourAngle, latitudeDeg);
}

/**
 * Position of the moon, modelled on the ecliptic `elongationDeg` east of the sun
 * (180 = full moon, rises at sunset). The default 168 deg is a bright waxing gibbous moon
 * that is already up in the east during golden hour and high in the south late at night.
 */
export function moonPosition(dayOfYear: number, solarHours: number, latitudeDeg: number, elongationDeg = 168): SkyPosition {
  const lambdaSun = sunEclipticLongitude(dayOfYear);
  const sun = eclipticToEquatorial(lambdaSun);
  const moon = eclipticToEquatorial(lambdaSun + elongationDeg * DEG);
  let dRa = moon.ra - sun.ra;
  dRa = Math.atan2(Math.sin(dRa), Math.cos(dRa));
  if (dRa < 0 && elongationDeg > 0) dRa += 2 * Math.PI;
  const hourAngle = (solarHours - 12) * 15 * DEG - dRa;
  return horizontalPosition(moon.dec, hourAngle, latitudeDeg);
}

/** Day of the year (1..365) for a month (1..12) and day of month; ignores leap years. */
export function dayOfYearFor(month: number, day: number): number {
  const starts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return starts[Math.max(1, Math.min(12, month)) - 1] + day;
}

/** Default day: 25 September, humid late-summer weather in South Florida. */
export const DEFAULT_DAY_OF_YEAR = dayOfYearFor(9, 25);
