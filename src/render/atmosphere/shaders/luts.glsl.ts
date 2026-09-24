import { atmosphereCommon, atmosphereLutSampling } from './common.glsl';

export const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Transmittance from (r, mu) to the top of the atmosphere. */
export const transmittanceFragment = /* glsl */ `
${atmosphereCommon}
varying vec2 vUv;
void main() {
  float r, mu;
  atmTransmittanceParams(vUv, r, mu);
  float dist = atmRaySphere(r, mu, ATM_RT);
  const int N = 40;
  vec3 od = vec3(0.0);
  float dt = dist / float(N);
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) * dt;
    float h = sqrt(r * r + t * t + 2.0 * r * mu * t) - ATM_RG;
    od += atmMedium(h).extinction * dt;
  }
  gl_FragColor = vec4(exp(-od), 1.0);
}
`;

/**
 * Multiple scattering (Hillaire 2020, section 5.5): isotropic second-order scattering and the
 * transfer factor f_ms integrated over the sphere, summed as a geometric series.
 */
export const multiScatteringFragment = /* glsl */ `
${atmosphereCommon}
${atmosphereLutSampling}
uniform sampler2D transmittanceLut;
varying vec2 vUv;

void integrate(float r, vec3 dir, vec3 sunDir, out vec3 L, out vec3 F) {
  L = vec3(0.0);
  F = vec3(0.0);
  float mu = dir.y;
  bool ground = atmHitsGround(r, mu);
  float tMax = ground ? atmRaySphere(r, mu, ATM_RG) : atmRaySphere(r, mu, ATM_RT);
  if (tMax <= 0.0) return;
  const int N = 20;
  float dt = tMax / float(N);
  vec3 T = vec3(1.0);
  const float isotropic = 1.0 / (4.0 * ATM_PI);
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.3) * dt;
    vec3 p = vec3(0.0, r, 0.0) + t * dir;
    float pr = length(p);
    AtmMedium m = atmMedium(pr - ATM_RG);
    vec3 ext = max(m.extinction, vec3(1e-7));
    vec3 sampleT = exp(-m.extinction * dt);
    vec3 Ts = atmTransmittance(transmittanceLut, pr, dot(p / pr, sunDir));
    vec3 S = m.scattering * isotropic * Ts;
    L += T * (S - S * sampleT) / ext;
    F += T * (m.scattering - m.scattering * sampleT) / ext;
    T *= sampleT;
  }
  if (ground) {
    vec3 p = vec3(0.0, r, 0.0) + tMax * dir;
    float pr = length(p);
    vec3 up = p / pr;
    vec3 Ts = atmTransmittance(transmittanceLut, pr, dot(up, sunDir));
    L += T * Ts * max(dot(up, sunDir), 0.0) * ATM_GROUND_ALBEDO / ATM_PI;
  }
}

void main() {
  float muS = atmSubToUnit(vUv.x, MULTISCAT_RES) * 2.0 - 1.0;
  float r = ATM_RG + atmSubToUnit(vUv.y, MULTISCAT_RES) * (ATM_RT - ATM_RG);
  r = clamp(r, ATM_RG + 0.002, ATM_RT - 0.002);
  vec3 sunDir = vec3(0.0, muS, sqrt(max(0.0, 1.0 - muS * muS)));
  vec3 Lsum = vec3(0.0);
  vec3 Fsum = vec3(0.0);
  // One flat loop over the SQ x SQ directions (nested loops invite the compiler to unroll).
  const int SQ = 8;
  for (int s = 0; s < SQ * SQ; s++) {
    int i = s / SQ;
    int j = s - i * SQ;
    float theta = 6.28318530718 * (float(i) + 0.5) / float(SQ);
    float cosPhi = 1.0 - 2.0 * (float(j) + 0.5) / float(SQ);
    float sinPhi = sqrt(max(0.0, 1.0 - cosPhi * cosPhi));
    vec3 dir = vec3(cos(theta) * sinPhi, cosPhi, sin(theta) * sinPhi);
    vec3 L, F;
    integrate(r, dir, sunDir, L, F);
    Lsum += L;
    Fsum += F;
  }
  float n = float(SQ * SQ);
  // Isotropic phase over the sphere: the average over directions.
  vec3 L2 = Lsum / n;
  vec3 fms = Fsum / n;
  gl_FragColor = vec4(L2 / max(vec3(1e-4), 1.0 - fms), 1.0);
}
`;

/** In-scattered radiance along a view ray, from one distant light (sun or moon). */
const skyRadiance = /* glsl */ `
uniform sampler2D transmittanceLut;
uniform sampler2D multiScatLut;

// Radiance scattered toward the viewer along dir from a light of illuminance E coming from
// lightDir (world space). The viewer is at radius r above the planet centre, local up = +Y.
vec3 atmSkyRadiance(float r, vec3 dir, vec3 lightDir, vec3 E, int steps) {
  float mu = dir.y;
  bool ground = atmHitsGround(r, mu);
  float tMax = ground ? atmRaySphere(r, mu, ATM_RG) : atmRaySphere(r, mu, ATM_RT);
  if (tMax <= 0.0) return vec3(0.0);
  float c = dot(dir, lightDir);
  float phR = atmRayleighPhase(c);
  float phM = atmMiePhase(c, ATM_MIE_G);
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  float fn = float(steps);
  for (int i = 0; i < steps; i++) {
    float a = float(i) / fn;
    float b = float(i + 1) / fn;
    float t0 = tMax * a * a;
    float t1 = tMax * b * b;
    float dt = t1 - t0;
    float t = t0 + 0.3 * dt;
    vec3 p = vec3(0.0, r, 0.0) + t * dir;
    float pr = length(p);
    float muL = dot(p / pr, lightDir);
    AtmMedium m = atmMedium(pr - ATM_RG);
    vec3 ext = max(m.extinction, vec3(1e-7));
    vec3 sampleT = exp(-m.extinction * dt);
    vec3 Tl = atmTransmittance(transmittanceLut, pr, muL);
    vec3 ms = atmMultiScattering(multiScatLut, pr, muL);
    vec3 S = Tl * (m.rayleigh * phR + m.mie * phM) + ms * m.scattering;
    L += T * (S - S * sampleT) / ext;
    T *= sampleT;
  }
  return L * E;
}
`;

/**
 * Sky-view LUT: radiance of the sky for every world direction as seen from the camera altitude,
 * lit by the sun and the moon, plus the city's light-pollution glow and airglow. Values are in
 * scene units, already multiplied by the time-of-day light scale.
 */
export const skyViewFragment = /* glsl */ `
${atmosphereCommon}
${atmosphereLutSampling}
${skyRadiance}
uniform float cameraRadius;
uniform vec3 sunDir;
uniform vec3 sunIlluminance;
uniform vec3 moonDir;
uniform vec3 moonIlluminance;
uniform vec3 nightZenith;
uniform vec3 nightHorizon;
uniform vec3 cityGlowDir;
varying vec2 vUv;

void main() {
  float horizonElev = -acos(clamp(ATM_RG / cameraRadius, 0.0, 1.0));
  float e;
  if (vUv.y >= 0.5) {
    float t = (vUv.y - 0.5) * 2.0;
    e = horizonElev + (1.5707963 - horizonElev) * t * t;
  } else {
    float t = (0.5 - vUv.y) * 2.0;
    e = horizonElev - (horizonElev + 1.5707963) * t * t;
  }
  float phi = vUv.x * 6.28318530718;
  vec3 dir = vec3(sin(phi) * cos(e), sin(e), -cos(phi) * cos(e));

  vec3 L = vec3(0.0);
  if (max(sunIlluminance.r, max(sunIlluminance.g, sunIlluminance.b)) > 0.0) {
    L += atmSkyRadiance(cameraRadius, dir, sunDir, sunIlluminance, 30);
  }
  if (max(moonIlluminance.r, max(moonIlluminance.g, moonIlluminance.b)) > 0.0) {
    L += atmSkyRadiance(cameraRadius, dir, moonDir, moonIlluminance, 20);
  }

  // Night sky: airglow brightens toward the horizon (van Rhijn), and the city's sky glow is
  // strongest near the horizon, a little stronger toward the city centre.
  float el = max(e, 0.0);
  float glow = exp(-el / 0.16) + 0.35 * exp(-el / 0.5);
  float toward = 0.75 + 0.25 * max(0.0, dot(normalize(vec3(dir.x, 0.0, dir.z) + 1e-5), cityGlowDir));
  L += nightZenith + (nightHorizon - nightZenith) * clamp(glow * toward, 0.0, 1.0);
  gl_FragColor = vec4(L, 1.0);
}
`;

/**
 * Irradiance table for the CPU (exposure, ambient): skylight on a horizontal surface at sea
 * level for 64 sun zenith cosines from -0.4 to 1, for unit sun illuminance.
 */
export const IRRADIANCE_TABLE_SIZE = 64;
export const IRRADIANCE_MU_MIN = -0.4;

export const irradianceFragment = /* glsl */ `
${atmosphereCommon}
${atmosphereLutSampling}
${skyRadiance}
void main() {
  float muS = mix(${IRRADIANCE_MU_MIN.toFixed(2)}, 1.0, (gl_FragCoord.x - 0.5) / ${(IRRADIANCE_TABLE_SIZE - 1).toFixed(1)});
  vec3 sunDir = vec3(0.0, muS, sqrt(max(0.0, 1.0 - muS * muS)));
  float r = ATM_RG + 0.005;
  vec3 E = vec3(0.0);
  const int NA = 12;
  const int NE = 8;
  for (int s = 0; s < NA * NE; s++) {
    int a = s / NE;
    int k = s - a * NE;
    // Cosine-weighted directions over the upper hemisphere.
    float xi = (float(k) + 0.5) / float(NE);
    float cosT = sqrt(1.0 - xi);
    float sinT = sqrt(xi);
    float ph = 6.28318530718 * (float(a) + 0.5) / float(NA);
    vec3 dir = vec3(cos(ph) * sinT, cosT, sin(ph) * sinT);
    E += atmSkyRadiance(r, dir, sunDir, vec3(1.0), 24);
  }
  E *= ATM_PI / float(NA * NE);
  gl_FragColor = vec4(E, 1.0);
}
`;
