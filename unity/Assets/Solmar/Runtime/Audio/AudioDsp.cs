using System;

namespace Solmar.Audio
{
    /// <summary>
    /// Small allocation-free DSP building blocks shared by every synthesiser in
    /// <c>Runtime/Audio</c> (and mirroring the private helpers in <see cref="CityAmbience"/> and
    /// <see cref="Weather.RainAudio"/>): a one-pole low-pass, a band-pass built from two of them, a
    /// soft clipper, and a tiny xorshift RNG. Everything here is pure math on plain floats/doubles -
    /// safe to call from an <c>OnAudioRead</c> callback on the audio thread.
    /// </summary>
    public static class AudioDsp
    {
        public const double TwoPi = Math.PI * 2.0;

        /// <summary>Coefficient for <see cref="OnePoleApply"/> giving a low-pass at <paramref name="cutoffHz"/>.</summary>
        public static float OnePoleCoeff(float cutoffHz, double dt)
        {
            if (cutoffHz < 1f) cutoffHz = 1f;
            double w = Math.Exp(-TwoPi * cutoffHz * dt);
            return (float)(1.0 - w);
        }

        public static float OnePoleApply(float x, ref float state, float coeff)
        {
            state += coeff * (x - state);
            if (!float.IsFinite(state)) state = 0f;
            return state;
        }

        /// <summary>Band-pass = high-pass (input minus a low-pass) minus a lower low-pass, the same
        /// trick <see cref="CityAmbience"/> uses for its wind and pass-by layers.</summary>
        public static float BandPass(float x, ref float lowState, ref float highState, float centerHz, float bandwidthHz, double dt)
        {
            float half = bandwidthHz * 0.5f;
            float lo = OnePoleApply(x, ref lowState, OnePoleCoeff(centerHz - half, dt));
            float hi = OnePoleApply(x, ref highState, OnePoleCoeff(centerHz + half, dt));
            return hi - lo;
        }

        public static float SoftClip(float x)
        {
            if (!float.IsFinite(x)) return 0f;
            return (float)Math.Tanh(x);
        }

        public static float Clamp01(float v)
        {
            if (!float.IsFinite(v)) return 0f;
            if (v < 0f) return 0f;
            if (v > 1f) return 1f;
            return v;
        }

        public static float Clamp(float v, float min, float max)
        {
            if (!float.IsFinite(v)) return min;
            if (v < min) return min;
            if (v > max) return max;
            return v;
        }

        /// <summary>Exponential smoothing towards <paramref name="target"/> at a fixed time constant
        /// (in seconds), used to slew synth parameters across buffers so nothing zippers.</summary>
        public static float Slew(float current, float target, float timeConstantSeconds, double dt)
        {
            if (timeConstantSeconds <= 0.0001f) return target;
            float coeff = (float)(1.0 - Math.Exp(-dt / timeConstantSeconds));
            float next = current + (target - current) * coeff;
            return float.IsFinite(next) ? next : target;
        }

        /// <summary>A tiny xorshift32 RNG: cheap, allocation-free and safe on the audio thread.</summary>
        public struct Rng
        {
            uint state;

            public static Rng Create(uint seed)
            {
                if (seed == 0u) seed = 0x9E3779B9u;
                return new Rng { state = seed };
            }

            public uint NextUint()
            {
                uint x = state;
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                state = x;
                return x;
            }

            public float NextUnit() => NextUint() * (1f / 4294967296f);
            public float NextSigned() => NextUnit() * 2f - 1f;
            public float Range(float min, float max) => min + NextUnit() * (max - min);
        }
    }
}
