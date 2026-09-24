import { ATMOSPHERE } from '../model';

const f = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const v3 = (a: readonly number[]) => `vec3(${a.map(f).join(', ')})`;

/**
 * Shared GLSL for the atmosphere look-up tables and the sky: physical constants, participating
 * media, phase functions and the LUT parameterisations (after Bruneton 2017 / Hillaire 2020).
 * All distances are in km.
 */
export const atmosphereCommon = /* glsl */ `
#ifndef SOLMAR_ATMOSPHERE_COMMON
#define SOLMAR_ATMOSPHERE_COMMON

#define ATM_PI 3.14159265358979
#define ATM_RG ${f(ATMOSPHERE.groundRadius)}
#define ATM_RT ${f(ATMOSPHERE.topRadius)}
#define ATM_MIE_S ${f(ATMOSPHERE.mieScattering)}
#define ATM_MIE_E ${f(ATMOSPHERE.mieExtinction)}
#define ATM_MIE_H ${f(ATMOSPHERE.mieScaleHeight)}
#define ATM_MIE_G ${f(ATMOSPHERE.mieG)}
#define ATM_RAY_H ${f(ATMOSPHERE.rayleighScaleHeight)}
#define ATM_OZ_C ${f(ATMOSPHERE.ozoneCenter)}
#define ATM_OZ_W ${f(ATMOSPHERE.ozoneHalfWidth)}
#define ATM_GROUND_ALBEDO ${f(ATMOSPHERE.groundAlbedo)}
#define TRANSMITTANCE_W 256.0
#define TRANSMITTANCE_H 64.0
#define MULTISCAT_RES 32.0

const vec3 ATM_RAYLEIGH = ${v3(ATMOSPHERE.rayleighScattering)};
const vec3 ATM_OZONE = ${v3(ATMOSPHERE.ozoneAbsorption)};

struct AtmMedium {
  vec3 rayleigh;   // Rayleigh scattering
  float mie;       // Mie scattering
  vec3 scattering; // total scattering
  vec3 extinction; // total extinction
};

AtmMedium atmMedium(float h) {
  h = max(h, 0.0);
  float dR = exp(-h / ATM_RAY_H);
  float dM = exp(-h / ATM_MIE_H);
  float dO = max(0.0, 1.0 - abs(h - ATM_OZ_C) / ATM_OZ_W);
  AtmMedium m;
  m.rayleigh = ATM_RAYLEIGH * dR;
  m.mie = ATM_MIE_S * dM;
  m.scattering = m.rayleigh + m.mie;
  m.extinction = m.rayleigh + ATM_MIE_E * dM + ATM_OZONE * dO;
  return m;
}

float atmRayleighPhase(float c) {
  return 3.0 / (16.0 * ATM_PI) * (1.0 + c * c);
}

// Cornette-Shanks phase function: Henyey-Greenstein with a physically nicer back lobe.
float atmMiePhase(float c, float g) {
  float g2 = g * g;
  float k = 3.0 / (8.0 * ATM_PI) * (1.0 - g2) / (2.0 + g2);
  return k * (1.0 + c * c) / pow(max(1e-4, 1.0 + g2 - 2.0 * g * c), 1.5);
}

// Distance along a ray (origin at radius r, zenith cosine mu) to a sphere of radius R;
// the far intersection when inside, the near one when outside. -1 when missing.
float atmRaySphere(float r, float mu, float R) {
  float disc = r * r * (mu * mu - 1.0) + R * R;
  if (disc < 0.0) return -1.0;
  float s = sqrt(disc);
  float t0 = -r * mu - s;
  float t1 = -r * mu + s;
  return t0 > 0.0 ? t0 : (t1 > 0.0 ? t1 : -1.0);
}

bool atmHitsGround(float r, float mu) {
  return mu < 0.0 && r * r * (mu * mu - 1.0) + ATM_RG * ATM_RG >= 0.0;
}

float atmUnitToSub(float u, float res) { return 0.5 / res + u * (1.0 - 1.0 / res); }
float atmSubToUnit(float u, float res) { return (u - 0.5 / res) / (1.0 - 1.0 / res); }

// Transmittance LUT parameterisation (Bruneton): (r, mu) <-> uv, rays that do not hit the ground.
vec2 atmTransmittanceUv(float r, float mu) {
  float H = sqrt(ATM_RT * ATM_RT - ATM_RG * ATM_RG);
  float rho = sqrt(max(0.0, r * r - ATM_RG * ATM_RG));
  float disc = r * r * (mu * mu - 1.0) + ATM_RT * ATM_RT;
  float d = max(0.0, -r * mu + sqrt(max(0.0, disc)));
  float dMin = ATM_RT - r;
  float dMax = rho + H;
  float xMu = (d - dMin) / max(1e-6, dMax - dMin);
  float xR = rho / H;
  return vec2(atmUnitToSub(xMu, TRANSMITTANCE_W), atmUnitToSub(xR, TRANSMITTANCE_H));
}

void atmTransmittanceParams(vec2 uv, out float r, out float mu) {
  float xMu = atmSubToUnit(uv.x, TRANSMITTANCE_W);
  float xR = atmSubToUnit(uv.y, TRANSMITTANCE_H);
  float H = sqrt(ATM_RT * ATM_RT - ATM_RG * ATM_RG);
  float rho = H * xR;
  r = sqrt(rho * rho + ATM_RG * ATM_RG);
  float dMin = ATM_RT - r;
  float dMax = rho + H;
  float d = dMin + xMu * (dMax - dMin);
  mu = d == 0.0 ? 1.0 : (H * H - rho * rho - d * d) / (2.0 * r * d);
  mu = clamp(mu, -1.0, 1.0);
}

vec2 atmMultiScatUv(float r, float muSun) {
  float u = clamp(muSun * 0.5 + 0.5, 0.0, 1.0);
  float v = clamp((r - ATM_RG) / (ATM_RT - ATM_RG), 0.0, 1.0);
  return vec2(atmUnitToSub(u, MULTISCAT_RES), atmUnitToSub(v, MULTISCAT_RES));
}

#endif
`;

/**
 * GLSL helpers that sample the transmittance and multiple-scattering LUTs. They are called inside
 * integration loops, so they sample with an explicit LOD: implicit-gradient lookups in a loop make
 * Direct3D's shader compiler (Chrome and Edge on Windows) unroll the whole loop nest, which can
 * take long enough to hang the GPU process.
 */
export const atmosphereLutSampling = /* glsl */ `
vec3 atmTransmittance(sampler2D lut, float r, float mu) {
  if (atmHitsGround(r, mu)) return vec3(0.0);
  return textureLod(lut, atmTransmittanceUv(r, mu), 0.0).rgb;
}

vec3 atmMultiScattering(sampler2D lut, float r, float muSun) {
  return textureLod(lut, atmMultiScatUv(r, muSun), 0.0).rgb;
}
`;

/**
 * Sky-view LUT parameterisation: full world azimuth on u (0 = north, 0.25 = east), elevation on
 * v with a square-root warp that packs texels around the (slightly dipped) horizon.
 */
export const skyViewMapping = /* glsl */ `
#ifndef SOLMAR_SKYVIEW_MAPPING
#define SOLMAR_SKYVIEW_MAPPING
vec2 solmarSkyViewUv(vec3 dir, float horizonElev) {
  float elev = asin(clamp(dir.y, -1.0, 1.0));
  float u = fract(atan(dir.x, -dir.z) * 0.15915494309 + 1.0);
  float v;
  if (elev >= horizonElev) {
    v = 0.5 + 0.5 * sqrt(clamp((elev - horizonElev) / (1.5707963 - horizonElev), 0.0, 1.0));
  } else {
    v = 0.5 - 0.5 * sqrt(clamp((horizonElev - elev) / (horizonElev + 1.5707963), 0.0, 1.0));
  }
  return vec2(u, v);
}
#endif
`;
