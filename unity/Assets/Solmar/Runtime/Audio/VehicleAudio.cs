using System;
using Solmar.Vehicles;
using UnityEngine;

namespace Solmar.Audio
{
    /// <summary>
    /// One 3D <see cref="AudioSource"/> per <see cref="VehicleController"/> (player car today, any
    /// AI-driven one later) carrying its whole engine-and-road voice: a harmonic engine synth driven
    /// by RPM/throttle/load, tyre squeal from wheel slip, speed-scaled road rumble, a suspension
    /// thump, crash impacts, a horn (Q, while driving) and speed-scaled wind - all mixed into one
    /// streamed mono <see cref="AudioClip"/>, the same <c>AudioClip.Create</c> + <c>OnAudioRead</c>
    /// technique as <see cref="CityAmbience"/> and <see cref="Weather.RainAudio"/>. Everything the
    /// audio thread needs is copied onto plain fields from <see cref="Update"/>/<see cref="FixedUpdate"/>
    /// (main thread); the audio callback only ever reads those fields and its own state - no Unity
    /// API calls, no allocations.
    /// </summary>
    [RequireComponent(typeof(AudioSource))]
    public sealed class VehicleAudio : MonoBehaviour
    {
        const int SampleRate = 48000;
        const int StreamLengthSamples = SampleRate * 10;
        const double Dt = 1.0 / SampleRate;

        /// <summary>Cylinders/2 in the rpm/60 x cylinders/2 firing-frequency formula (a V6 feel).</summary>
        const float CylinderFactor = 3f;
        const float ParamSlewSeconds = 0.05f;

        public VehicleController vehicle;

        AudioSource audioSource;
        AudioClip clip;
        AudioDsp.Rng rng;

        // --- Written on the main thread, read on the audio thread -------------------------------
        float paramRpm;
        float paramIdleRpm = 900f;
        float paramRedlineRpm = 7000f;
        float paramThrottle;
        float paramSpeedKmh;
        float paramMaxTyreSlip;
        bool paramHornHeld;

        volatile float pendingShiftDip;   // >0 to arm a shift dip; consumed by the audio thread.
        volatile float pendingPopStrength; // >0 to arm a lift-off pop train.
        volatile float pendingThumpStrength; // >0 to arm a suspension thump.
        volatile float pendingCrashStrength; // >0 (m/s of impact) to arm a crash hit.
        volatile bool pendingCrashGlass;

        // Main-thread-only bookkeeping for edge detection.
        float lastThrottleSeen;
        float lastRpmSeen;
        int lastGearSeen = int.MinValue;
        float[] lastWheelCompression = new float[4];
        bool compressionPrimed;

        // --- Audio-thread state -----------------------------------------------------------------
        float smRpm, smThrottle, smSpeedKmh, smSlip;

        double harm1Phase, harm2Phase, harm3Phase, harm4Phase;
        double turboPhase;
        double idleWobblePhase;
        float intakeLowState, intakeHighState;
        float exhaustBrown, exhaustLpState;

        float shiftDipEnvelope;
        bool shiftDipActive;

        bool popActive;
        bool popInBurst;
        int popsRemaining;
        double popTimer;
        float popBrown;
        float popLpState;

        bool thumpActive;
        double thumpTime;
        float thumpStrength;
        float thumpLpState;

        bool crashActive;
        double crashTime;
        float crashStrength;
        bool crashGlass;
        float crashLowState, crashHighState;
        float glassLowState, glassHighState;

        float squealLowState, squealHighState;
        double squealPitchPhase;
        float rumbleBrown, rumbleLpState;
        float windLowState, windHighState;

        double hornPhaseA, hornPhaseB;
        float hornLevel;

        void OnEnable()
        {
            rng = AudioDsp.Rng.Create((uint)Environment.TickCount ^ 0xC0FFEE1u ^ (uint)GetInstanceIdSafe());

            clip = AudioClip.Create("VehicleAudio", StreamLengthSamples, 1, SampleRate, true, OnAudioRead);
            audioSource = GetComponent<AudioSource>();
            audioSource.playOnAwake = false;
            audioSource.spatialBlend = 1f;
            audioSource.rolloffMode = AudioRolloffMode.Logarithmic;
            audioSource.minDistance = 3f;
            audioSource.maxDistance = 90f;
            audioSource.loop = true;
            audioSource.clip = clip;
            audioSource.Play();

            paramIdleRpm = vehicle != null ? vehicle.idleRpm : 900f;
            paramRedlineRpm = vehicle != null ? vehicle.redlineRpm : 7000f;
            paramRpm = paramIdleRpm;
            lastRpmSeen = paramIdleRpm;
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

        // A stand-in for GetInstanceID (unavailable on this Unity version) just to vary the seed a
        // little between vehicles created in the same frame.
        int GetInstanceIdSafe() => (int)(transform.position.x * 977f) ^ (int)(transform.position.z * 613f);

        void Update()
        {
            if (vehicle == null) { enabled = false; return; }

            paramIdleRpm = vehicle.idleRpm;
            paramRedlineRpm = Mathf.Max(1f, vehicle.redlineRpm);
            paramRpm = vehicle.Rpm;
            paramSpeedKmh = vehicle.SpeedKmh;

            bool playerControlled = vehicle.IsPlayerControlled;
#if ENABLE_LEGACY_INPUT_MANAGER
            paramThrottle = playerControlled && Input.GetKey(KeyCode.W) ? 1f : 0f;
#else
            paramThrottle = 0f;
#endif
            if (!playerControlled)
            {
                // No AI driver yet, but keep this reasonable for when one exists: treat a rising rpm
                // as "on throttle", a falling one as coasting.
                float rpmDelta = paramRpm - lastRpmSeen;
                paramThrottle = rpmDelta > 1f ? 0.55f : 0.1f;
            }
            lastRpmSeen = paramRpm;

            // Lift-off pop: throttle just dropped from a decent load while the engine was spinning
            // fast enough to have unburnt fuel in a hot exhaust.
            float rpmNorm = paramRedlineRpm > 1f ? paramRpm / paramRedlineRpm : 0f;
            if (lastThrottleSeen > 0.55f && paramThrottle < 0.1f && rpmNorm > 0.5f)
            {
                pendingPopStrength = Mathf.Clamp01(0.4f + rpmNorm * 0.6f);
            }
            lastThrottleSeen = paramThrottle;

            int gear = vehicle.GearNumber;
            if (lastGearSeen != int.MinValue && gear != lastGearSeen && paramSpeedKmh > 3f)
            {
                pendingShiftDip = 1f;
            }
            lastGearSeen = gear;

#if ENABLE_LEGACY_INPUT_MANAGER
            paramHornHeld = playerControlled && Input.GetKey(KeyCode.Q);
#else
            paramHornHeld = false;
#endif
        }

        void FixedUpdate()
        {
            if (vehicle == null) return;

            float rearSlip = MaxSlip(vehicle.wheelRL, vehicle.wheelRR);
            float frontSlip = MaxSlip(vehicle.wheelFL, vehicle.wheelFR);
            paramMaxTyreSlip = Mathf.Max(rearSlip, frontSlip);

            // Suspension thump: any wheel's compression (0 relaxed .. 1 fully compressed) jumping a
            // lot in one physics step means a pothole, a kerb or a hard landing.
            float worstJump = 0f;
            worstJump = Mathf.Max(worstJump, CompressionJump(vehicle.wheelFL, 0));
            worstJump = Mathf.Max(worstJump, CompressionJump(vehicle.wheelFR, 1));
            worstJump = Mathf.Max(worstJump, CompressionJump(vehicle.wheelRL, 2));
            worstJump = Mathf.Max(worstJump, CompressionJump(vehicle.wheelRR, 3));
            compressionPrimed = true;
            if (worstJump > 0.22f) pendingThumpStrength = Mathf.Clamp01(worstJump);
        }

        static float MaxSlip(WheelCollider a, WheelCollider b)
        {
            float sa = SlipOf(a);
            float sb = SlipOf(b);
            return Mathf.Max(sa, sb);
        }

        static float SlipOf(WheelCollider wc)
        {
            if (wc == null || !wc.GetGroundHit(out WheelHit hit)) return 0f;
            float f = float.IsFinite(hit.forwardSlip) ? Mathf.Abs(hit.forwardSlip) : 0f;
            float s = float.IsFinite(hit.sidewaysSlip) ? Mathf.Abs(hit.sidewaysSlip) : 0f;
            return Mathf.Max(f, s);
        }

        float CompressionJump(WheelCollider wc, int index)
        {
            if (wc == null) return 0f;
            float travel = 1f; // 1 = fully extended/airborne, 0 = fully compressed.
            if (wc.GetGroundHit(out WheelHit hit))
            {
                float d = (-wc.transform.InverseTransformPoint(hit.point).y - wc.radius) / Mathf.Max(0.01f, wc.suspensionDistance);
                if (float.IsFinite(d)) travel = Mathf.Clamp01(d);
            }
            float previous = compressionPrimed ? lastWheelCompression[index] : travel;
            lastWheelCompression[index] = travel;
            return Mathf.Max(0f, previous - travel);
        }

        void OnCollisionEnter(Collision collision)
        {
            float rel = collision.relativeVelocity.magnitude;
            if (!float.IsFinite(rel) || rel < 2.5f) return;
            pendingCrashStrength = Mathf.Clamp(rel, 0f, 25f);
            pendingCrashGlass = rel > 6f;
        }

        // Runs on the audio thread: only plain fields and pure math from here down.
        void OnAudioRead(float[] data)
        {
            for (int i = 0; i < data.Length; i++)
            {
                smRpm = AudioDsp.Slew(smRpm, paramRpm, ParamSlewSeconds, Dt);
                smThrottle = AudioDsp.Slew(smThrottle, paramThrottle, ParamSlewSeconds, Dt);
                smSpeedKmh = AudioDsp.Slew(smSpeedKmh, paramSpeedKmh, ParamSlewSeconds, Dt);
                smSlip = AudioDsp.Slew(smSlip, paramMaxTyreSlip, 0.03f, Dt);

                float idle = Mathf.Max(1f, paramIdleRpm);
                float redline = Mathf.Max(idle + 1f, paramRedlineRpm);
                float rpmNorm = Mathf.Clamp01((smRpm - idle) / (redline - idle));

                float sample = 0f;
                sample += Engine(rpmNorm, redline);
                sample += Pops();
                sample += Thump();
                sample += Crash();
                sample += Squeal();
                sample += RoadRumble();
                sample += Wind();
                sample += Horn();

                data[i] = AudioDsp.SoftClip(sample * GameAudio.MasterVolume * GameAudio.SfxVolume);
            }
        }

        float Engine(float rpmNorm, float redline)
        {
            // Firing frequency: rpm/60 x cylinders/2 (a V6/4-cyl idle-through-redline feel).
            float firing = (smRpm / 60f) * CylinderFactor;
            if (!float.IsFinite(firing) || firing < 1f) firing = 1f;

            // Idle wobble: a slow FM hunt around idle, fading out once the engine is loaded up.
            idleWobblePhase += AudioDsp.TwoPi * 5.3 * Dt;
            if (idleWobblePhase > AudioDsp.TwoPi) idleWobblePhase -= AudioDsp.TwoPi;
            float idleAmount = 1f - Mathf.Clamp01(rpmNorm * 6f);
            float wobble = (float)Math.Sin(idleWobblePhase) * idleAmount * 6f;
            float f = firing + wobble;

            // Shift dip: the moment a gear change is detected, cut torque/volume briefly like a
            // clutch disengaging, then recover.
            if (pendingShiftDip > 0f)
            {
                pendingShiftDip = 0f;
                shiftDipActive = true;
                shiftDipEnvelope = 1f;
            }
            float shiftGain = 1f;
            if (shiftDipActive)
            {
                shiftDipEnvelope -= (float)(Dt / 0.14);
                if (shiftDipEnvelope <= 0f) { shiftDipActive = false; shiftGain = 1f; }
                else shiftGain = 1f - shiftDipEnvelope * 0.7f;
            }

            // Harmonic stack: brighter (more upper harmonics) under load.
            float load = Mathf.Clamp01(smThrottle * 0.6f + rpmNorm * 0.4f);
            harm1Phase += AudioDsp.TwoPi * f * Dt; Wrap(ref harm1Phase);
            harm2Phase += AudioDsp.TwoPi * f * 2.0 * Dt; Wrap(ref harm2Phase);
            harm3Phase += AudioDsp.TwoPi * f * 3.0 * Dt; Wrap(ref harm3Phase);
            harm4Phase += AudioDsp.TwoPi * f * 4.0 * Dt; Wrap(ref harm4Phase);

            float h1 = (float)Math.Sin(harm1Phase);
            float h2 = (float)Math.Sin(harm2Phase) * (0.45f + 0.25f * load);
            float h3 = (float)Math.Sin(harm3Phase) * (0.22f + 0.35f * load);
            float h4 = (float)Math.Sin(harm4Phase) * (0.10f + 0.30f * load);
            float harmonics = h1 + h2 + h3 + h4;

            // Intake/mechanical roughness: band-passed noise that grows with load.
            float noise = rng.NextSigned();
            float intake = AudioDsp.BandPass(noise, ref intakeLowState, ref intakeHighState, 900f + load * 700f, 1400f, Dt);
            float roughness = intake * (0.08f + load * 0.22f);

            // Exhaust body: brown-noise rumble under the harmonics, louder under load.
            float white = rng.NextSigned();
            exhaustBrown = (exhaustBrown + 0.03f * white) / 1.03f;
            float exhaustFiltered = AudioDsp.OnePoleApply(exhaustBrown, ref exhaustLpState, AudioDsp.OnePoleCoeff(110f, Dt));
            float exhaust = exhaustFiltered * (1.1f + load * 1.6f);

            // Turbo whistle: a faint rising sine once there's real load and rpm.
            float turboAmount = Mathf.Clamp01((rpmNorm - 0.3f) / 0.7f) * load;
            turboPhase += AudioDsp.TwoPi * (2800.0 + rpmNorm * 5200.0) * Dt;
            Wrap(ref turboPhase);
            float turbo = (float)Math.Sin(turboPhase) * turboAmount * 0.05f;

            float volume = 0.22f + rpmNorm * 0.35f + load * 0.18f;
            float engine = (harmonics * 0.18f + roughness + exhaust * 0.5f + turbo) * volume * shiftGain;
            return engine;
        }

        float Pops()
        {
            if (pendingPopStrength > 0f)
            {
                popActive = true;
                popInBurst = true;
                popsRemaining = 3 + (int)(pendingPopStrength * 4f);
                popTimer = 0.0;
                pendingPopStrength = 0f;
            }
            if (!popActive) return 0f;

            popTimer += Dt;

            if (!popInBurst)
            {
                if (popTimer < 0.0) return 0f;
                popInBurst = true;
                popTimer = 0.0;
            }

            const double burstLength = 0.045;
            if (popTimer >= burstLength)
            {
                popsRemaining--;
                if (popsRemaining <= 0) { popActive = false; return 0f; }
                popInBurst = false;
                popTimer = -rng.Range(0.07f, 0.2f);
                return 0f;
            }

            float envelope = (float)Math.Exp(-popTimer / 0.014);
            float white = rng.NextSigned();
            popBrown = (popBrown + 0.35f * white) / 1.35f;
            float body = AudioDsp.OnePoleApply(popBrown, ref popLpState, AudioDsp.OnePoleCoeff(250f, Dt));
            return body * envelope * 1.6f;
        }

        float Thump()
        {
            if (pendingThumpStrength > 0f)
            {
                thumpActive = true;
                thumpStrength = pendingThumpStrength;
                thumpTime = 0.0;
                pendingThumpStrength = 0f;
            }
            if (!thumpActive) return 0f;

            thumpTime += Dt;
            const double decay = 0.09;
            float envelope = (float)Math.Exp(-thumpTime / decay);
            if (envelope < 0.02f) { thumpActive = false; return 0f; }

            float white = rng.NextSigned();
            float body = AudioDsp.OnePoleApply(white, ref thumpLpState, AudioDsp.OnePoleCoeff(70f, Dt));
            return body * envelope * thumpStrength * 2.2f;
        }

        float Crash()
        {
            if (pendingCrashStrength > 0f)
            {
                crashActive = true;
                crashStrength = Mathf.Clamp01(pendingCrashStrength / 14f);
                crashGlass = pendingCrashGlass;
                crashTime = 0.0;
                pendingCrashStrength = 0f;
            }
            if (!crashActive) return 0f;

            crashTime += Dt;
            const double decay = 0.5;
            float envelope = (float)Math.Exp(-crashTime / decay);
            if (envelope < 0.01f) { crashActive = false; return 0f; }

            // Metal crunch: broadband noise low-passed around 500 Hz.
            float noise = rng.NextSigned();
            float crunch = AudioDsp.BandPass(noise, ref crashLowState, ref crashHighState, 500f, 900f, Dt);

            float glass = 0f;
            if (crashGlass)
            {
                float glassEnvelope = (float)Math.Exp(-crashTime / 0.22);
                float glassNoise = rng.NextSigned();
                glass = AudioDsp.BandPass(glassNoise, ref glassLowState, ref glassHighState, 5200f, 4000f, Dt) * glassEnvelope * 0.6f;
            }

            return (crunch * 1.6f + glass) * envelope * (0.5f + crashStrength);
        }

        float Squeal()
        {
            float slip = smSlip;
            if (slip < 0.28f || smSpeedKmh < 4f) return 0f;
            float amount = Mathf.Clamp01((slip - 0.28f) / 0.7f);

            squealPitchPhase += AudioDsp.TwoPi * (2400.0 + amount * 900.0) * Dt;
            Wrap(ref squealPitchPhase);
            float tone = (float)Math.Sin(squealPitchPhase);

            float noise = rng.NextSigned();
            float filtered = AudioDsp.BandPass(noise, ref squealLowState, ref squealHighState, 2600f, 1800f, Dt);

            return (tone * 0.55f + filtered * 0.6f) * amount * 0.5f;
        }

        float RoadRumble()
        {
            float speedFrac = Mathf.Clamp01(smSpeedKmh / 140f);
            if (speedFrac < 0.01f) return 0f;
            float white = rng.NextSigned();
            rumbleBrown = (rumbleBrown + 0.02f * white) / 1.02f;
            float filtered = AudioDsp.OnePoleApply(rumbleBrown, ref rumbleLpState, AudioDsp.OnePoleCoeff(140f, Dt));
            return filtered * speedFrac * 0.9f;
        }

        float Wind()
        {
            float speedFrac = Mathf.Clamp01(smSpeedKmh / 200f);
            if (speedFrac < 0.02f) return 0f;
            float noise = rng.NextSigned();
            float centerFreq = 900f + speedFrac * 2600f;
            float filtered = AudioDsp.BandPass(noise, ref windLowState, ref windHighState, centerFreq, 1600f, Dt);
            return filtered * speedFrac * speedFrac * 0.5f;
        }

        float Horn()
        {
            float target = paramHornHeld ? 1f : 0f;
            hornLevel = AudioDsp.Slew(hornLevel, target, 0.02f, Dt);
            if (hornLevel < 0.01f) return 0f;

            hornPhaseA += AudioDsp.TwoPi * 415.0 * Dt; Wrap(ref hornPhaseA);
            hornPhaseB += AudioDsp.TwoPi * 523.0 * Dt; Wrap(ref hornPhaseB);
            float wave = (float)(Math.Sin(hornPhaseA) * 0.6 + Math.Sin(hornPhaseB) * 0.4);
            return wave * hornLevel * 0.35f;
        }

        static void Wrap(ref double phase)
        {
            if (phase > AudioDsp.TwoPi) phase -= AudioDsp.TwoPi;
            else if (phase < 0.0) phase += AudioDsp.TwoPi;
        }
    }
}
