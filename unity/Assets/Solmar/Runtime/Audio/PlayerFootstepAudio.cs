using System;
using UnityEngine;

namespace Solmar.Audio
{
    /// <summary>
    /// Footsteps and landing thuds for the on-foot player, synthesised per step the same
    /// <c>AudioClip.Create</c> + <c>OnAudioRead</c> way as <see cref="VehicleAudio"/>: cadence comes
    /// from <see cref="PlayerCharacter.Speed"/> (an accumulated-stride-distance trigger, not a fixed
    /// timer, so it naturally speeds up at a run), each step's texture from a downward raycast that
    /// looks at the ground collider's name (asphalt/pavement by default; "Grass", "soil" or
    /// "Planter" in the name gives a softer step), and a heavier thud when <see cref="PlayerCharacter.Grounded"/>
    /// goes true again after a fast enough fall.
    /// </summary>
    [RequireComponent(typeof(AudioSource))]
    public sealed class PlayerFootstepAudio : MonoBehaviour
    {
        const int SampleRate = 48000;
        const int StreamLengthSamples = SampleRate * 10;
        const double Dt = 1.0 / SampleRate;
        const float RaycastHeight = 0.6f;
        const float RaycastLength = 1.4f;

        public PlayerCharacter character;

        AudioSource audioSource;
        AudioClip clip;
        AudioDsp.Rng rng;

        // --- Main thread ---------------------------------------------------------------------
        float strideDistance;
        bool wasGrounded;
        float verticalVelocityBeforeLand;

        volatile float pendingStepStrength;   // 0 when none pending.
        volatile bool pendingStepSoft;
        volatile float pendingLandStrength;

        // --- Audio thread ---------------------------------------------------------------------
        bool stepActive;
        double stepTime;
        float stepStrength;
        bool stepSoft;
        float stepLowState, stepHighState;
        float stepClickState;

        bool landActive;
        double landTime;
        float landStrength;
        float landLpState;

        void OnEnable()
        {
            rng = AudioDsp.Rng.Create((uint)Environment.TickCount ^ 0x51ED270Bu);

            clip = AudioClip.Create("PlayerFootsteps", StreamLengthSamples, 1, SampleRate, true, OnAudioRead);
            audioSource = GetComponent<AudioSource>();
            audioSource.playOnAwake = false;
            audioSource.spatialBlend = 1f;
            audioSource.rolloffMode = AudioRolloffMode.Logarithmic;
            audioSource.minDistance = 1.5f;
            audioSource.maxDistance = 40f;
            audioSource.loop = true;
            audioSource.clip = clip;
            audioSource.Play();

            if (character != null) wasGrounded = character.Grounded;
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

        void Update()
        {
            if (character == null) { enabled = false; return; }

            float dt = Time.deltaTime;
            bool grounded = character.Grounded;
            float speed = character.Speed;

            if (grounded && speed > 0.15f)
            {
                strideDistance += speed * dt;
                // Stride length grows a little with pace, like a real gait (short steps walking,
                // longer ones at a sprint).
                float strideLength = Mathf.Lerp(0.62f, 1.05f, character.NormalizedSpeed);
                if (strideDistance >= strideLength)
                {
                    strideDistance -= strideLength;
                    EmitStep(character.NormalizedSpeed);
                }
            }
            else
            {
                strideDistance = 0f;
            }

            if (!wasGrounded && grounded && verticalVelocityBeforeLand < -6f)
            {
                pendingLandStrength = Mathf.Clamp01(-verticalVelocityBeforeLand / 16f);
            }
            wasGrounded = grounded;
            verticalVelocityBeforeLand = character.VerticalVelocity;
        }

        void EmitStep(float normalizedSpeed)
        {
            bool soft = false;
            Vector3 origin = transform.position + Vector3.up * RaycastHeight;
            if (Physics.Raycast(origin, Vector3.down, out RaycastHit hit, RaycastLength, ~0, QueryTriggerInteraction.Ignore))
            {
                string n = hit.collider.gameObject.name;
                if (n.IndexOf("Grass", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    n.IndexOf("soil", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    n.IndexOf("Planter", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    soft = true;
                }
            }

            pendingStepSoft = soft;
            pendingStepStrength = Mathf.Clamp01(0.45f + normalizedSpeed * 0.55f);
        }

        // Runs on the audio thread: plain fields and pure math only.
        void OnAudioRead(float[] data)
        {
            for (int i = 0; i < data.Length; i++)
            {
                float sample = Step() + Land();
                data[i] = AudioDsp.SoftClip(sample * GameAudio.MasterVolume * GameAudio.SfxVolume);
            }
        }

        float Step()
        {
            if (pendingStepStrength > 0f)
            {
                stepActive = true;
                stepStrength = pendingStepStrength;
                stepSoft = pendingStepSoft;
                stepTime = 0.0;
                pendingStepStrength = 0f;
            }
            if (!stepActive) return 0f;

            stepTime += Dt;
            double decay = stepSoft ? 0.09 : 0.05;
            float envelope = (float)Math.Exp(-stepTime / decay);
            if (envelope < 0.015f) { stepActive = false; return 0f; }

            float white = rng.NextSigned();
            float centerHz = stepSoft ? 320f : 700f;
            float bandwidth = stepSoft ? 500f : 1400f;
            float body = AudioDsp.BandPass(white, ref stepLowState, ref stepHighState, centerHz, bandwidth, Dt);

            float click = 0f;
            if (!stepSoft)
            {
                float clickEnvelope = (float)Math.Exp(-stepTime / 0.008);
                float clickNoise = rng.NextSigned();
                click = AudioDsp.OnePoleApply(clickNoise, ref stepClickState, AudioDsp.OnePoleCoeff(3200f, Dt)) * clickEnvelope * 0.5f;
            }

            return (body * 1.1f + click) * envelope * stepStrength;
        }

        float Land()
        {
            if (pendingLandStrength > 0f)
            {
                landActive = true;
                landStrength = pendingLandStrength;
                landTime = 0.0;
                pendingLandStrength = 0f;
            }
            if (!landActive) return 0f;

            landTime += Dt;
            const double decay = 0.12;
            float envelope = (float)Math.Exp(-landTime / decay);
            if (envelope < 0.015f) { landActive = false; return 0f; }

            float white = rng.NextSigned();
            float body = AudioDsp.OnePoleApply(white, ref landLpState, AudioDsp.OnePoleCoeff(90f, Dt));
            return body * envelope * landStrength * 1.8f;
        }
    }
}
