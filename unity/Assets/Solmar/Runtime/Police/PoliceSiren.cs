using System;
using Solmar.Audio;
using UnityEngine;

namespace Solmar.Police
{
    /// <summary>
    /// A synthesised wail siren on a <see cref="PoliceCar"/>: one streamed mono <see cref="AudioClip"/>
    /// built the same <c>AudioClip.Create</c> + <c>OnAudioRead</c> way as
    /// <see cref="Solmar.Audio.VehicleAudio"/>, a slow LFO sweeping a sine between about 650 and
    /// 1200 Hz. <see cref="SetOn"/> is written from the main thread; the audio thread only ever reads
    /// its own state and the volatile "on" flag.
    /// </summary>
    [RequireComponent(typeof(AudioSource))]
    public sealed class PoliceSiren : MonoBehaviour
    {
        const int SampleRate = 48000;
        const int StreamLengthSamples = SampleRate * 4;
        const double Dt = 1.0 / SampleRate;
        const double WailHz = 0.42; // one full up/down sweep every ~2.4 s

        AudioSource audioSource;
        AudioClip clip;

        volatile bool wailOn;
        float envelope;
        double lfoPhase, tonePhase;

        public void SetOn(bool on) => wailOn = on;

        void OnEnable()
        {
            clip = AudioClip.Create("PoliceSiren", StreamLengthSamples, 1, SampleRate, true, OnAudioRead);
            audioSource = GetComponent<AudioSource>();
            audioSource.playOnAwake = false;
            audioSource.spatialBlend = 1f;
            audioSource.rolloffMode = AudioRolloffMode.Logarithmic;
            audioSource.minDistance = 10f;
            audioSource.maxDistance = 150f;
            audioSource.loop = true;
            audioSource.clip = clip;
            audioSource.Play();
        }

        void OnDisable()
        {
            wailOn = false;
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

        // Runs on the audio thread: only plain fields and pure math from here down.
        void OnAudioRead(float[] data)
        {
            for (int i = 0; i < data.Length; i++)
            {
                float target = wailOn ? 1f : 0f;
                envelope = AudioDsp.Slew(envelope, target, 0.2f, Dt);
                if (envelope < 0.001f) { data[i] = 0f; continue; }

                lfoPhase += AudioDsp.TwoPi * WailHz * Dt;
                if (lfoPhase > AudioDsp.TwoPi) lfoPhase -= AudioDsp.TwoPi;
                float sweep = 0.5f + 0.5f * (float)Math.Sin(lfoPhase);
                float freq = 650f + sweep * 550f;

                tonePhase += AudioDsp.TwoPi * freq * Dt;
                if (tonePhase > AudioDsp.TwoPi) tonePhase -= AudioDsp.TwoPi;
                float tone = (float)Math.Sin(tonePhase) + 0.3f * (float)Math.Sin(tonePhase * 2.0);

                data[i] = AudioDsp.SoftClip(tone * 0.45f * envelope) * GameAudio.MasterVolume * GameAudio.SfxVolume;
            }
        }
    }
}
