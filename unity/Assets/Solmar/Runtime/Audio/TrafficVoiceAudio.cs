using System;
using UnityEngine;

namespace Solmar.Audio
{
    /// <summary>
    /// One cheap 3D engine-hum voice for ambient traffic: two harmonics of an approximate firing
    /// frequency derived from speed (traffic cars don't simulate an engine/RPM) plus a touch of
    /// low-passed road noise, far lighter than <see cref="VehicleAudio"/>'s full synth. Owned and
    /// positioned by <see cref="TrafficEngineVoices"/>, which hands out only as many of these as
    /// there are near-enough traffic cars to hear (voice-limited), starting and stopping playback as
    /// a car is assigned or freed so idle voices cost nothing.
    /// </summary>
    [RequireComponent(typeof(AudioSource))]
    public sealed class TrafficVoiceAudio : MonoBehaviour
    {
        const int SampleRate = 44100;
        const int StreamLengthSamples = SampleRate * 6;
        const double Dt = 1.0 / SampleRate;
        const float CylinderFactor = 3f;

        /// <summary>Set every frame by <see cref="TrafficEngineVoices"/> from the assigned car's speed.</summary>
        public float paramSpeedKmh;

        AudioSource audioSource;
        AudioClip clip;
        AudioDsp.Rng rng;
        bool assigned;

        float smSpeedKmh;
        double harm1Phase, harm2Phase;
        float rumbleBrown, rumbleLpState;

        void OnEnable()
        {
            rng = AudioDsp.Rng.Create((uint)Environment.TickCount ^ 0x7EA5C0DEu ^ (uint)GetHashCode());

            clip = AudioClip.Create("TrafficVoice", StreamLengthSamples, 1, SampleRate, true, OnAudioRead);
            audioSource = GetComponent<AudioSource>();
            audioSource.playOnAwake = false;
            audioSource.spatialBlend = 1f;
            audioSource.rolloffMode = AudioRolloffMode.Logarithmic;
            audioSource.minDistance = 4f;
            audioSource.maxDistance = 45f;
            audioSource.loop = true;
            audioSource.clip = clip;
        }

        void OnDisable()
        {
            if (audioSource != null)
            {
                audioSource.Stop();
                Destroy(audioSource);
            }
            if (clip != null)
            {
                Destroy(clip);
                clip = null;
            }
        }

        /// <summary>Starts this voice playing for a newly-assigned car (idempotent).</summary>
        public void Activate()
        {
            if (assigned) return;
            assigned = true;
            if (audioSource != null && !audioSource.isPlaying) audioSource.Play();
        }

        /// <summary>Frees this voice: playback stops, so an unassigned voice costs nothing.</summary>
        public void Deactivate()
        {
            if (!assigned) return;
            assigned = false;
            paramSpeedKmh = 0f;
            if (audioSource != null) audioSource.Stop();
        }

        void OnAudioRead(float[] data)
        {
            for (int i = 0; i < data.Length; i++)
            {
                smSpeedKmh = AudioDsp.Slew(smSpeedKmh, paramSpeedKmh, 0.08f, Dt);

                // A rough rpm from speed (no gearbox to read): idle-ish at a stop, climbing with pace.
                float rpmApprox = 900f + smSpeedKmh * 42f;
                float firing = (rpmApprox / 60f) * CylinderFactor;

                harm1Phase += AudioDsp.TwoPi * firing * Dt; Wrap(ref harm1Phase);
                harm2Phase += AudioDsp.TwoPi * firing * 2.0 * Dt; Wrap(ref harm2Phase);
                float harmonics = (float)Math.Sin(harm1Phase) + (float)Math.Sin(harm2Phase) * 0.4f;

                float white = rng.NextSigned();
                rumbleBrown = (rumbleBrown + 0.03f * white) / 1.03f;
                float rumble = AudioDsp.OnePoleApply(rumbleBrown, ref rumbleLpState, AudioDsp.OnePoleCoeff(160f, Dt));

                float speedFrac = Mathf.Clamp01(smSpeedKmh / 70f);
                float sample = harmonics * 0.12f + rumble * (0.5f + speedFrac * 1.2f);

                data[i] = AudioDsp.SoftClip(sample * GameAudio.MasterVolume * GameAudio.SfxVolume);
            }
        }

        static void Wrap(ref double phase)
        {
            if (phase > AudioDsp.TwoPi) phase -= AudioDsp.TwoPi;
            else if (phase < 0.0) phase += AudioDsp.TwoPi;
        }
    }
}
