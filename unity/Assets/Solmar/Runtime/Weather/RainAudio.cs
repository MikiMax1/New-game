using System;
using UnityEngine;

namespace Solmar.Weather
{
    /// <summary>
    /// Synthesises rain and thunder entirely on the audio thread, the same way CityAmbience
    /// synthesises the city's background hum: a streamed <see cref="AudioClip"/> built from
    /// <see cref="AudioClip.Create"/>, no audio assets involved. A broadband hiss (band-passed white
    /// noise) tracks <see cref="Intensity"/>; calling <see cref="Thunder"/> schedules a low rumble
    /// (filtered brown noise with a fast attack and a long decay) after a delay, so lightning can
    /// flash first and the rumble can arrive the way distant thunder actually does.
    /// </summary>
    public sealed class RainAudio : MonoBehaviour
    {
        /// <summary>0 (dry, silent) to 1 (downpour); set every frame from the main thread.</summary>
        public float Intensity;
        /// <summary>Extra hiss brightness in a thunderstorm's heaviest rain.</summary>
        public float Roughness;

        const int Channels = 2;
        const int SampleRate = 48000;
        const int StreamLengthSamples = SampleRate * 10;
        const double Dt = 1.0 / SampleRate;
        const double TwoPi = Math.PI * 2.0;
        const float HissCenterHz = 3800f;
        const float HissBandwidthHz = 6200f;
        const float ThunderBrownStep = 0.045f;

        AudioSource audioSource;
        AudioClip clip;
        uint rngState;

        float hissLowState, hissHighState;

        // Thunder: a delayed trigger (set from the main thread) counted down on the audio thread.
        volatile int pendingThunderSamples = -1;
        volatile float pendingThunderStrength;
        bool thunderActive;
        float activeThunderStrength;
        double thunderEnvelopeTime;
        float thunderBrown;
        float thunderLpState;

        void OnEnable()
        {
            if (FindAnyObjectByType<AudioListener>() == null)
            {
                gameObject.AddComponent<AudioListener>();
            }

            rngState = (uint)Environment.TickCount ^ 0xB5297A4Du;
            if (rngState == 0u) rngState = 0xB5297A4Du;

            clip = AudioClip.Create("RainAudio", StreamLengthSamples, Channels, SampleRate, true, OnAudioRead);

            audioSource = gameObject.AddComponent<AudioSource>();
            audioSource.playOnAwake = false;
            audioSource.spatialBlend = 0f;
            audioSource.loop = true;
            audioSource.clip = clip;
            audioSource.Play();
        }

        void OnDisable()
        {
            if (audioSource != null)
            {
                audioSource.Stop();
                Destroy(audioSource);
                audioSource = null;
            }
            if (clip != null)
            {
                Destroy(clip);
                clip = null;
            }
        }

        /// <summary>Schedules a rumble `delaySeconds` from now, as far-off lightning would arrive.</summary>
        public void Thunder(float delaySeconds, float strength)
        {
            pendingThunderStrength = strength;
            pendingThunderSamples = Mathf.Max(0, Mathf.RoundToInt(delaySeconds * SampleRate));
        }

        // Runs on the audio thread: no allocations, no Unity API calls beyond reading the plain
        // fields above.
        void OnAudioRead(float[] data)
        {
            int frameCount = data.Length / Channels;
            float intensity = Mathf.Clamp01(Intensity);
            float roughness = Mathf.Clamp01(Roughness);

            for (int i = 0; i < frameCount; i++)
            {
                if (pendingThunderSamples >= 0)
                {
                    if (pendingThunderSamples == 0)
                    {
                        thunderActive = true;
                        activeThunderStrength = Mathf.Max(0.4f, pendingThunderStrength);
                        thunderEnvelopeTime = 0.0;
                        pendingThunderSamples = -1;
                    }
                    else
                    {
                        pendingThunderSamples--;
                    }
                }

                float hiss = BandPass(NextSigned(), ref hissLowState, ref hissHighState, HissCenterHz - roughness * 900f, HissBandwidthHz);
                float center = hiss * (0.22f + 0.55f * intensity) * intensity;

                center += UpdateThunder() * activeThunderStrength;

                float sample = (float)Math.Tanh(center);
                int sampleIndex = i * Channels;
                data[sampleIndex] = sample;
                data[sampleIndex + 1] = sample;
            }
        }

        float UpdateThunder()
        {
            if (!thunderActive) return 0f;

            thunderEnvelopeTime += Dt;
            const double attack = 0.15, decay = 4.5;
            float envelope;
            if (thunderEnvelopeTime < attack)
            {
                envelope = (float)(thunderEnvelopeTime / attack);
            }
            else
            {
                double t = thunderEnvelopeTime - attack;
                envelope = (float)Math.Exp(-t / decay);
                if (envelope < 0.01f)
                {
                    thunderActive = false;
                    return 0f;
                }
            }

            float white = NextSigned();
            thunderBrown = (thunderBrown + ThunderBrownStep * white) / (1f + ThunderBrownStep);
            float rumble = OnePoleApply(thunderBrown, ref thunderLpState, OnePoleCoeff(90f));
            return rumble * envelope * 2.2f;
        }

        uint NextUint()
        {
            uint x = rngState;
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            rngState = x;
            return x;
        }

        float NextUnit() => NextUint() * (1f / 4294967296f);
        float NextSigned() => NextUnit() * 2f - 1f;

        static float OnePoleCoeff(float cutoffHz)
        {
            double w = Math.Exp(-TwoPi * cutoffHz * Dt);
            return (float)(1.0 - w);
        }

        static float OnePoleApply(float x, ref float state, float coeff)
        {
            state += coeff * (x - state);
            return state;
        }

        static float BandPass(float x, ref float lowState, ref float highState, float centerHz, float bandwidthHz)
        {
            float half = bandwidthHz * 0.5f;
            float lo = OnePoleApply(x, ref lowState, OnePoleCoeff(Mathf.Max(20f, centerHz - half)));
            float hi = OnePoleApply(x, ref highState, OnePoleCoeff(centerHz + half));
            return hi - lo;
        }
    }
}
