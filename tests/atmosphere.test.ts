import { describe, expect, it } from 'vitest';
import { DEFAULT_DAY_OF_YEAR, dayOfYearFor, moonPosition, refraction, sunPosition } from '../src/render/atmosphere/ephemeris';
import { diskVisibility, transmittanceToSpace } from '../src/render/atmosphere/model';
import { cloudThreshold } from '../src/render/atmosphere/noise';
import { diurnalCumulus } from '../src/render/atmosphere/atmosphere';
import { LATITUDE } from '../src/world/config';

const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);

describe('sun ephemeris', () => {
  it('defaults to late September', () => {
    expect(DEFAULT_DAY_OF_YEAR).toBe(268);
    expect(dayOfYearFor(1, 1)).toBe(1);
    expect(dayOfYearFor(12, 31)).toBe(365);
  });

  it('culminates in the south at solar noon with the right elevation', () => {
    const noon = sunPosition(DEFAULT_DAY_OF_YEAR, 12, LATITUDE);
    // Declination is about -1.8 deg on 25 September: elevation ~ 90 - 25.8 - 1.8.
    expect(noon.trueElevation).toBeGreaterThan(61.5);
    expect(noon.trueElevation).toBeLessThan(63.5);
    expect(noon.azimuth).toBeCloseTo(180, 0);
    expect(noon.direction[2]).toBeGreaterThan(0); // +Z is south
    expect(Math.abs(noon.direction[0])).toBeLessThan(1e-6);
    expect(len(noon.direction)).toBeCloseTo(1, 6);
  });

  it('rises roughly east in the morning and sets roughly west in the evening', () => {
    const morning = sunPosition(DEFAULT_DAY_OF_YEAR, 6.5, LATITUDE);
    const evening = sunPosition(DEFAULT_DAY_OF_YEAR, 17.5, LATITUDE);
    expect(morning.direction[0]).toBeGreaterThan(0.9);
    expect(evening.direction[0]).toBeLessThan(-0.9);
    expect(morning.elevation).toBeGreaterThan(3);
    expect(morning.elevation).toBeLessThan(9);
    // Symmetric around noon.
    const a = sunPosition(DEFAULT_DAY_OF_YEAR, 9, LATITUDE);
    const b = sunPosition(DEFAULT_DAY_OF_YEAR, 15, LATITUDE);
    expect(a.trueElevation).toBeCloseTo(b.trueElevation, 6);
    expect(a.azimuth + b.azimuth).toBeCloseTo(360, 6);
  });

  it('is below the horizon at night and higher in June than in December', () => {
    expect(sunPosition(DEFAULT_DAY_OF_YEAR, 23, LATITUDE).elevation).toBeLessThan(-30);
    const june = sunPosition(dayOfYearFor(6, 21), 12, LATITUDE).trueElevation;
    const dec = sunPosition(dayOfYearFor(12, 21), 12, LATITUDE).trueElevation;
    expect(june).toBeGreaterThan(87);
    expect(dec).toBeLessThan(41);
  });

  it('refracts about half a degree at the horizon and fades out below it', () => {
    expect(refraction(0)).toBeGreaterThan(0.45);
    expect(refraction(0)).toBeLessThan(0.6);
    expect(refraction(45)).toBeLessThan(0.02);
    expect(refraction(-5)).toBe(0);
  });
});

describe('moon', () => {
  it('is up in the east during the evening and high in the south late at night', () => {
    const dusk = moonPosition(DEFAULT_DAY_OF_YEAR, 19, LATITUDE);
    expect(dusk.elevation).toBeGreaterThan(5);
    expect(dusk.direction[0]).toBeGreaterThan(0.5); // east
    const late = moonPosition(DEFAULT_DAY_OF_YEAR, 23.5, LATITUDE);
    expect(late.elevation).toBeGreaterThan(50);
    expect(late.direction[2]).toBeGreaterThan(0); // south
  });
});

describe('atmosphere model', () => {
  it('reddens and dims the sun toward the horizon', () => {
    const high = transmittanceToSpace(0.01, Math.sin((60 * Math.PI) / 180));
    const low = transmittanceToSpace(0.01, Math.sin((3 * Math.PI) / 180));
    expect(high[1]).toBeGreaterThan(0.7);
    expect(high[1]).toBeLessThan(0.95);
    expect(low[1]).toBeLessThan(high[1]);
    // Blue is lost much faster than red at low sun.
    expect(low[0] / low[2]).toBeGreaterThan(4);
    expect(transmittanceToSpace(0.01, -0.2)).toEqual([0, 0, 0]);
  });

  it('computes the visible fraction of the sun disk', () => {
    const r = 0.00465;
    expect(diskVisibility(1, r)).toBe(1);
    expect(diskVisibility(-1, r)).toBe(0);
    expect(diskVisibility(0, r)).toBeCloseTo(0.5, 6);
  });
});

describe('clouds', () => {
  it('maps coverage to a threshold on the equalised cell field', () => {
    expect(cloudThreshold(0)).toBeCloseTo(1, 6);
    expect(cloudThreshold(1)).toBeCloseTo(0, 6);
    let prev = 2;
    for (let c = 0; c <= 1.0001; c += 0.05) {
      const t = cloudThreshold(c);
      expect(t).toBeLessThan(prev);
      prev = t;
    }
    // P(0.7 U + 0.3 V > t) equals the requested coverage (quasi-Monte Carlo check).
    const t = cloudThreshold(0.3);
    let hits = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const u = (i * 0.7548776662) % 1;
      const v = (i * 0.569840291) % 1;
      if (0.7 * u + 0.3 * v > t) hits++;
    }
    expect(hits / n).toBeCloseTo(0.3, 2);
  });

  it('builds cumulus through the day and lets them decay at night', () => {
    expect(diurnalCumulus(15)).toBeCloseTo(1, 6);
    expect(diurnalCumulus(3)).toBeCloseTo(0.35, 6);
    expect(diurnalCumulus(9)).toBeGreaterThan(0.35);
    expect(diurnalCumulus(9)).toBeLessThan(1);
  });
});
