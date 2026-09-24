import { atmosphereCommon, atmosphereLutSampling, skyViewMapping } from './common.glsl';
import { hazeFunctions } from './fog.glsl';

/**
 * Full-screen sky. The triangle is drawn at the far plane after all opaque geometry, so only
 * pixels not covered by the scene run this shader. The view direction comes from the inverse
 * projection of whichever camera renders it (main camera, cloud pass, environment cube face).
 */
export const skyVertex = /* glsl */ `
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
varying vec3 vDir;
void main() {
  vec4 v = uProjInv * vec4(position.xy, 1.0, 1.0);
  vDir = mat3(uCamWorld) * (v.xyz / v.w);
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const skyHead = /* glsl */ `
${atmosphereCommon}
${atmosphereLutSampling}
${skyViewMapping}
${hazeFunctions}

uniform sampler2D skyViewLut;
uniform sampler2D transmittanceLut;
uniform sampler2D noiseTex;
uniform sampler2D cloudBuffer;
uniform vec2 cloudBufferSize;  // full-resolution size the buffer is stretched over (px)
uniform vec2 cloudBufferTexel; // one buffer texel in uv units
uniform float lutScale;
uniform float cameraRadius;   // km, from the planet centre
uniform float cameraHeight;   // m above sea level
uniform float horizonElev;
uniform vec3 sunDir;
uniform vec3 sunDiskRadiance;
uniform float sunCosRadius;
uniform vec3 moonDir;
uniform vec3 moonDiskRadiance;
uniform float moonCosRadius;
uniform float starScale;      // illuminance of a magnitude-0 star (scene units)
uniform float pixelAngle;     // radians per pixel
uniform float time;
uniform vec4 hazeA;           // haze extinction at sea level (1/m), 1/H (1/m), extra haze factor, -
uniform vec3 hazeRayleigh;    // Rayleigh extinction at sea level (1/m)
uniform vec3 groundRadiance;  // lit ground seen below the horizon (environment map)
uniform vec4 cloudA;          // coverage threshold, base (m), thickness (m), extinction (1/m)
uniform vec4 cloudB;          // wind offset x, z (m), density scale (0 = off), ambient scale
uniform vec3 cloudLightDir;
uniform vec3 cloudLightColor; // illuminance of the key light at cloud height
uniform vec3 cloudAmbientTop;
uniform vec3 cloudAmbientBottom;
varying vec3 vDir;

// PCG-style integer hash -> [0, 1).
uint solmarHash(uint x) {
  x = x * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (x >> 22u) ^ x;
}
float solmarHash01(uvec3 v) {
  return float(solmarHash(v.x ^ solmarHash(v.y ^ solmarHash(v.z)))) / 4294967296.0;
}

vec3 skyLut(vec3 dir) {
  return texture2D(skyViewLut, solmarSkyViewUv(dir, horizonElev)).rgb * lutScale;
}

vec3 horizonLut(vec3 dir) {
  // A hair above the true horizon so the lookup never blends with the rows below it.
  float y = sin(horizonElev + 0.004);
  vec2 h = normalize(dir.xz + vec2(1e-6, 0.0)) * sqrt(1.0 - y * y);
  return skyLut(vec3(h.x, y, h.y));
}

// Sky with the extra (evening, night) haze that the LUT does not contain.
vec3 hazySky(vec3 dir) {
  vec3 sky = skyLut(dir);
  if (hazeA.z > 0.0 && dir.y > -0.05) {
    float tau = solmarHazeDepthToSpace(cameraHeight, dir.y, hazeA.x * hazeA.z, hazeA.y);
    sky = mix(horizonLut(dir), sky, exp(-tau));
  }
  return sky;
}
`;

/** Cumulus layer: coverage from the noise texture, raymarched with self-shadowing. */
const cloudFunctions = /* glsl */ `
#define NOISE_SIZE 256.0
// Distance along the ray to a spherical shell at height hShell (m); camera at height h0.
float shellHit(float h0, float mu, float hShell, bool farRoot) {
  const float R = ATM_RG * 1000.0;
  float r = R + h0;
  float b = r * mu;
  float c = (h0 - hShell) * (2.0 * R + h0 + hShell);
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  float s = sqrt(disc);
  return farRoot ? -b + s : -b - s;
}

// Everything below runs inside the raymarch loop, so every lookup uses an explicit LOD:
// implicit-gradient lookups in a loop make Direct3D's shader compiler (Chrome and Edge on
// Windows) unroll it, which can take long enough to hang the GPU process.
//
// Width (m) of the cone one cloud-buffer pixel covers at the current sample; picks the mip
// level of the detail noise.
float cloudFootprint = 1.0;
float noiseLod(float metresPerTexel) {
  return max(0.0, log2(cloudFootprint / metresPerTexel));
}

// Bilinear filtering of a thresholded field shows the texel grid as kinked, faceted cloud
// outlines. The cell field uses a cubic B-spline instead (C2-smooth), built from four bilinear
// taps (GPU Gems 2, ch. 20).
vec4 noiseBicubic(vec2 uv) {
  vec2 p = uv * NOISE_SIZE - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 / 6.0) * (-f3 + 3.0 * f2 - 3.0 * f + 1.0);
  vec2 w1 = (1.0 / 6.0) * (3.0 * f3 - 6.0 * f2 + 4.0);
  vec2 w2 = (1.0 / 6.0) * (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0);
  vec2 w3 = (1.0 / 6.0) * f3;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / NOISE_SIZE;
  vec2 h1 = (i + 1.5 + w3 / g1) / NOISE_SIZE;
  return g0.y * (g0.x * textureLod(noiseTex, h0, 0.0) + g1.x * textureLod(noiseTex, vec2(h1.x, h0.y), 0.0))
       + g1.y * (g0.x * textureLod(noiseTex, vec2(h0.x, h1.y), 0.0) + g1.x * textureLod(noiseTex, h1, 0.0));
}

// lod: mip level of the cell field; long steps sample a pre-filtered (coarser) field so that
// clouds far away stay smooth instead of turning into speckle.
float cloudCoverage(vec2 xz, float lod) {
  vec2 q = xz + cloudB.xy;
  float weather = textureLod(noiseTex, q * (1.0 / 21000.0), 0.0).r;
  vec2 cuv = q * (1.0 / 7200.0) + vec2(0.37, 0.61);
  float cells = lod < 0.25 ? noiseBicubic(cuv).g : textureLod(noiseTex, cuv, lod).g;
  float f = cells * 0.7 + weather * 0.3;
  return clamp((f - cloudA.x) / max(0.02, 1.0 - cloudA.x), 0.0, 1.0);
}

// soft (0..1): level of detail for long steps. Distant clouds are marched with steps of up to
// a few hundred metres; sharp edges and fine erosion would then be undersampled into speckle,
// so edges widen and the fine detail fades with the step length.
float cloudDensity(vec3 p, float hn, float soft) {
  float cov = cloudCoverage(p.xz, soft * 3.2);
  if (cov <= 0.0) return 0.0;
  // Fair-weather cumulus: flat base, rounded top whose height follows the local coverage;
  // clouds in the denser parts of the weather field grow taller.
  float weather = textureLod(noiseTex, (p.xz + cloudB.xy) * (1.0 / 21000.0), 0.0).r;
  float top = (0.1 + 0.9 * pow(cov, 0.85)) * (0.55 + 0.45 * weather);
  // Softer, rounder tops (a wide ramp) instead of flat plateaus.
  float d = smoothstep(0.0, 0.32 + 0.3 * soft, top - hn) * smoothstep(0.0, 0.05 + 0.08 * soft, hn);
  if (d <= 0.0) return 0.0;
  float detailAmount = 1.0 - soft;
  if (detailAmount > 0.0) {
    // Erode only the edges (remap), more toward the top: cauliflower tops, crisp flat bases.
    // Two detail layers sampled at height-rotated offsets so erosion varies with height
    // (billows instead of vertical pillars).
    float ang = p.y * 0.0021;
    vec2 q = p.xz + cloudB.xy * 1.2;
    vec2 qr = vec2(q.x * cos(ang) - q.y * sin(ang), q.x * sin(ang) + q.y * cos(ang)) + vec2(p.y * 1.7, -p.y * 1.3);
    float detail = textureLod(noiseTex, qr * (1.0 / 700.0), noiseLod(700.0 / NOISE_SIZE)).b * 0.6
                 + textureLod(noiseTex, (qr + vec2(37.0, 91.0) * p.y * 0.05) * (1.0 / 190.0), noiseLod(190.0 / NOISE_SIZE)).a * 0.4;
    float erosion = detail * (0.18 + 0.55 * hn) * detailAmount;
    d = clamp((d - erosion) / (1.0 - erosion), 0.0, 1.0);
  }
  return d * cloudB.z;
}

float cloudPhase(float c) {
  float g1 = 0.7;
  float g2 = -0.2;
  float p1 = (1.0 - g1 * g1) / pow(1.0 + g1 * g1 - 2.0 * g1 * c, 1.5);
  float p2 = (1.0 - g2 * g2) / pow(1.0 + g2 * g2 - 2.0 * g2 * c, 1.5);
  return (0.75 * p1 + 0.25 * p2) / (4.0 * ATM_PI);
}

// Clouds along dir as a premultiplied colour and opacity, with the haze between the eye and the
// cloud folded in (the haze in front of a cloud looks like the sky behind it).
vec4 cloudLayer(vec3 dir, vec3 sky, float jitter, int steps) {
  float base = cloudA.y;
  float topH = cloudA.y + cloudA.z;
  float h0 = cameraHeight;
  float mu = dir.y;
  float t0, t1;
  if (h0 < base) {
    if (mu <= 0.0) return vec4(0.0);
    t0 = shellHit(h0, mu, base, true);
    t1 = shellHit(h0, mu, topH, true);
  } else if (h0 < topH) {
    t0 = 0.0;
    t1 = mu > 0.0 ? shellHit(h0, mu, topH, true) : shellHit(h0, mu, base, false);
    if (t1 < 0.0) t1 = shellHit(h0, mu, topH, true);
  } else {
    if (mu >= 0.0) return vec4(0.0);
    t0 = shellHit(h0, mu, topH, false);
    t1 = shellHit(h0, mu, base, false);
    if (t0 < 0.0) return vec4(0.0);
    if (t1 < 0.0) t1 = shellHit(h0, mu, topH, true);
  }
  const float maxDist = 60000.0;
  if (t0 < 0.0 || t0 > maxDist) return vec4(0.0);
  t1 = min(t1, maxDist);
  // Steps grow with distance; long grazing paths near the horizon are cut short (hidden by haze).
  float dt = clamp((t1 - t0) / float(steps), 25.0, 60.0 + t0 * 0.012);
  float soft = clamp((dt - 35.0) / 180.0, 0.0, 1.0);
  float sigma = cloudA.w;
  float ph = cloudPhase(dot(dir, cloudLightDir));
  vec3 Lc = vec3(0.0);
  float T = 1.0;
  float wsum = 0.0;
  float dist = 0.0;
  float t = t0 + jitter * dt;
  for (int i = 0; i < steps; i++) {
    if (t > t1 || T < 0.01) break;
    // The cloud buffer is a fraction of the screen resolution and then tent-filtered.
    cloudFootprint = max(1.0, t * pixelAngle * 3.0);
    vec3 p = vec3(0.0, h0, 0.0) + dir * t;
    float h = length(vec3(p.x, p.y + ATM_RG * 1000.0, p.z)) - ATM_RG * 1000.0;
    float hn = (h - base) / cloudA.z;
    float d = (hn >= 0.0 && hn <= 1.0) ? cloudDensity(vec3(p.x, h, p.z), hn, soft) : 0.0;
    if (d > 0.002) {
      // Two samples toward the light for self-shadowing.
      vec3 l1 = p + cloudLightDir * 70.0;
      vec3 l2 = p + cloudLightDir * 260.0;
      float hn1 = hn + cloudLightDir.y * 70.0 / cloudA.z;
      float hn2 = hn + cloudLightDir.y * 260.0 / cloudA.z;
      float d1 = (hn1 >= 0.0 && hn1 <= 1.0) ? cloudDensity(vec3(l1.x, h, l1.z), hn1, soft) : 0.0;
      float d2 = (hn2 >= 0.0 && hn2 <= 1.0) ? cloudDensity(vec3(l2.x, h, l2.z), hn2, max(soft, 0.5)) : 0.0;
      float od = sigma * (d * 20.0 + d1 * 120.0 + d2 * 260.0);
      // Single scattering with a dual-lobe phase, plus a softer, more isotropic term standing
      // in for multiple scattering (sunlit cumulus are bright white, not grey).
      float single = ph * exp(-od);
      float multi = (2.4 / (4.0 * ATM_PI)) * exp(-od * 0.2);
      float powder = 1.0 - 0.55 * exp(-sigma * d * 200.0);
      vec3 direct = cloudLightColor * (single + multi) * powder;
      vec3 ambient = mix(cloudAmbientBottom, cloudAmbientTop, clamp(hn * 1.2 + 0.1, 0.0, 1.0)) * cloudB.w;
      float sT = exp(-sigma * d * dt);
      vec3 S = direct * 0.96 + ambient;
      Lc += T * S * (1.0 - sT);
      wsum += T * (1.0 - sT);
      dist += t * T * (1.0 - sT);
      T *= sT;
    }
    t += dt;
  }
  if (wsum <= 0.0) return vec4(0.0);
  dist /= wsum;
  float alpha = 1.0 - T;
  vec3 Tf = solmarHazeTransmittance(cameraHeight, dir.y, dist, hazeA.x * (1.0 + hazeA.z), hazeA.y, hazeRayleigh);
  return vec4(Tf * Lc + (1.0 - Tf) * alpha * sky, alpha);
}
`;

const stars = /* glsl */ `
vec3 starField(vec3 dir, vec3 background) {
  vec3 a = abs(dir);
  uint face;
  vec2 uv;
  if (a.x >= a.y && a.x >= a.z) { face = dir.x > 0.0 ? 0u : 1u; uv = dir.zy / a.x; }
  else if (a.y >= a.z) { face = dir.y > 0.0 ? 2u : 3u; uv = dir.xz / a.y; }
  else { face = dir.z > 0.0 ? 4u : 5u; uv = dir.xy / a.z; }
  const float N = 90.0;
  vec2 g = (uv * 0.5 + 0.5) * N;
  vec2 cellF = floor(g);
  uvec3 cell = uvec3(uvec2(cellF), face);
  if (solmarHash01(cell) > 0.15) return vec3(0.0);
  vec2 pos = 0.15 + 0.7 * vec2(solmarHash01(cell + uvec3(0u, 0u, 17u)), solmarHash01(cell + uvec3(0u, 0u, 31u)));
  // Angular distance: one uv unit spans ~1/(1+|uv|^2) radians around this point of the face.
  float scale = (2.0 / N) / (1.0 + dot(uv, uv));
  float d = length(g - cellF - pos) * scale;
  float sigma = pixelAngle * 0.85;
  // Magnitudes follow N(<m) ~ 10^(0.5 m): most stars faint, a few bright ones.
  float xi = max(1e-4, solmarHash01(cell + uvec3(0u, 0u, 53u)));
  float mag = max(-1.2, 5.6 + 2.0 * log(xi) / log(10.0));
  float E = starScale * pow(10.0, -0.4 * mag);
  float h1 = solmarHash01(cell + uvec3(0u, 0u, 71u));
  float h2 = solmarHash01(cell + uvec3(0u, 0u, 97u));
  // Scintillation, stronger near the horizon.
  float tw = 1.0 + (0.12 + 0.5 * (1.0 - clamp(dir.y * 2.5, 0.0, 1.0))) * sin(time * (5.0 + 9.0 * h1) + 40.0 * h2);
  vec3 tint = mix(vec3(0.78, 0.88, 1.12), vec3(1.12, 0.94, 0.74), h1 * h1);
  vec3 L = tint * E * tw * exp(-d * d / (2.0 * sigma * sigma)) / (6.2832 * sigma * sigma);
  // The eye and a camera need contrast to see a point source against a bright sky.
  float bg = dot(background, vec3(0.2126, 0.7152, 0.0722));
  float peak = dot(L, vec3(0.2126, 0.7152, 0.0722));
  return L * smoothstep(0.25, 2.0, peak / max(bg, 1e-9));
}

float moonNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  uvec3 c = uvec3(uvec2(ivec2(i) + 64), 5u);
  float a = solmarHash01(c);
  float b = solmarHash01(c + uvec3(1u, 0u, 0u));
  float cc = solmarHash01(c + uvec3(0u, 1u, 0u));
  float d = solmarHash01(c + uvec3(1u, 1u, 0u));
  return mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
}

vec3 moonDisk(vec3 dir) {
  float c = dot(dir, moonDir);
  float sinR = sqrt(1.0 - moonCosRadius * moonCosRadius);
  float edge = pixelAngle / sinR;
  if (c < moonCosRadius - pixelAngle * sinR * 2.0) return vec3(0.0);
  vec3 right = normalize(cross(moonDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0));
  vec3 up = cross(right, moonDir);
  vec2 q = vec2(dot(dir, right), dot(dir, up)) / sinR;
  float r = length(q);
  float cover = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, r);
  if (cover <= 0.0) return vec3(0.0);
  // Maria: large dark basins plus finer mottling; a faint limb darkening gives it volume.
  float n = moonNoise(q * 2.3 + vec2(3.1, 7.7)) * 0.62 + moonNoise(q * 5.1 + vec2(1.3, 2.9)) * 0.28 + moonNoise(q * 11.0) * 0.1;
  float maria = smoothstep(0.42, 0.62, n);
  float mu = sqrt(max(0.0, 1.0 - r * r));
  float albedo = mix(1.0, 0.62, maria) * (0.82 + 0.18 * mu);
  vec3 T = atmTransmittance(transmittanceLut, cameraRadius, dir.y);
  return moonDiskRadiance * albedo * cover * T;
}

vec3 sunDisk(vec3 dir) {
  float cs = dot(dir, sunDir);
  float sinR = sqrt(1.0 - sunCosRadius * sunCosRadius);
  if (cs < sunCosRadius - 2.0 * pixelAngle * sinR) return vec3(0.0);
  float x = sqrt(max(0.0, 1.0 - cs * cs)) / sinR;
  float cover = 1.0 - smoothstep(1.0 - pixelAngle / sinR, 1.0 + pixelAngle / sinR, x);
  float mu = sqrt(max(0.0, 1.0 - min(x, 1.0) * min(x, 1.0)));
  vec3 limb = pow(vec3(max(mu, 0.02)), vec3(0.397, 0.503, 0.652));
  return sunDiskRadiance * limb * cover * atmTransmittance(transmittanceLut, cameraRadius, dir.y);
}
`;

/** Main-camera sky (SKY_CLOUD_BUFFER) and environment-map sky (SKY_ENV). */
export const skyFragment = /* glsl */ `
${skyHead}
${cloudFunctions}
${stars}

void main() {
  vec3 dir = normalize(vDir);
#ifdef SKY_ENV
  vec3 sky = skyLut(dir);
  // Environment map: the lower hemisphere is the lit city and sea fading into the haze.
  if (dir.y < 0.0) {
    float d = min(max(cameraHeight, 2.0) / max(-dir.y, 1e-3), 60000.0);
    vec3 T = solmarHazeTransmittance(cameraHeight, dir.y, d, hazeA.x * (1.0 + hazeA.z), hazeA.y, hazeRayleigh);
    sky = groundRadiance * T + horizonLut(dir) * (1.0 - T);
  } else {
    sky = hazySky(dir);
  }
  vec3 L = sky;
  #ifdef SKY_CLOUDS
    if (cloudB.z > 0.0 && dir.y > 0.0) {
      vec4 c = cloudLayer(dir, sky, 0.5, CLOUD_STEPS);
      L = c.rgb + (1.0 - c.a) * L;
    }
  #endif
#else
  vec3 sky = hazySky(dir);
  // Below the horizon the view ray meets sea or land beyond the far plane: show what far
  // geometry fades into (the horizon haze), so the clipped world blends into it seamlessly.
  if (dir.y < sin(horizonElev + 0.004)) sky = horizonLut(dir);
  vec3 L = sky + starField(dir, sky) * atmTransmittance(transmittanceLut, cameraRadius, dir.y) + moonDisk(dir) + sunDisk(dir);
  #ifdef SKY_CLOUD_BUFFER
    if (cloudB.z > 0.0) {
      // Four bilinear taps at half-texel offsets: a tent filter over the low-resolution buffer
      // that also removes the per-pixel step jitter.
      vec2 uv = gl_FragCoord.xy / cloudBufferSize;
      vec2 o = 0.5 * cloudBufferTexel;
      vec4 c = 0.25 * (texture2D(cloudBuffer, uv + vec2(-o.x, -o.y)) + texture2D(cloudBuffer, uv + vec2(o.x, -o.y))
                     + texture2D(cloudBuffer, uv + vec2(-o.x, o.y)) + texture2D(cloudBuffer, uv + vec2(o.x, o.y)));
      L = c.rgb + (1.0 - c.a) * L;
    }
  #endif
#endif
  gl_FragColor = vec4(max(L, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Cloud pass for the main camera, rendered at reduced resolution into a half-float buffer that
 * the sky shader upsamples: premultiplied radiance in rgb, opacity in a.
 */
export const cloudPassFragment = /* glsl */ `
${skyHead}
${cloudFunctions}
void main() {
  vec3 dir = normalize(vDir);
  if (dir.y <= -0.02 && cameraHeight < cloudA.y) {
    gl_FragColor = vec4(0.0);
    return;
  }
  // R2 low-discrepancy sequence over pixels: evenly spread step offsets whose residual pattern
  // the sky's tent-filtered upsample removes.
  float jitter = fract(dot(gl_FragCoord.xy, vec2(0.7548776662, 0.5698402910)));
  gl_FragColor = cloudLayer(dir, hazySky(dir), jitter, CLOUD_STEPS);
}
`;
