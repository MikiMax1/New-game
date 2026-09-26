using Solmar.Traffic;
using UnityEngine;

namespace Solmar.Audio
{
    /// <summary>
    /// Voice-limits ambient traffic engine hum to the 8 nearest <see cref="TrafficCar"/>s within 40 m
    /// of the listener: owns a fixed pool of <see cref="TrafficVoiceAudio"/> instances (never more,
    /// however many traffic cars exist), re-picks the nearest set roughly 5 times a second, and every
    /// frame moves each active voice to its car's position and feeds it that car's speed. The list of
    /// traffic cars to consider is refreshed by <see cref="AudioBootstrap"/>'s once-a-second scan via
    /// <see cref="SetCandidates"/>, not by a per-frame find.
    /// </summary>
    public sealed class TrafficEngineVoices : MonoBehaviour
    {
        const int MaxVoices = 8;
        const float HearingRange = 40f;
        const float ReassignInterval = 0.2f;

        readonly TrafficVoiceAudio[] voices = new TrafficVoiceAudio[MaxVoices];
        readonly TrafficCar[] assignedCar = new TrafficCar[MaxVoices];

        TrafficCar[] candidates = new TrafficCar[0];
        Transform listener;
        float reassignTimer;

        void Awake()
        {
            for (int i = 0; i < MaxVoices; i++)
            {
                var go = new GameObject("Traffic voice " + i);
                go.transform.SetParent(transform, false);
                // TrafficVoiceAudio requires an AudioSource and finds it with GetComponent in
                // OnEnable, so Unity adds the AudioSource for us here.
                voices[i] = go.AddComponent<TrafficVoiceAudio>();
            }
        }

        /// <summary>Replaces the set of traffic cars this manager may pick voices from. Cheap to call
        /// once a second; ranking among them still only happens a few times a second.</summary>
        public void SetCandidates(TrafficCar[] cars)
        {
            candidates = cars ?? System.Array.Empty<TrafficCar>();
        }

        void Update()
        {
            if (listener == null)
            {
                listener = Camera.main != null ? Camera.main.transform : null;
                if (listener == null) return;
            }

            reassignTimer -= Time.deltaTime;
            if (reassignTimer <= 0f)
            {
                reassignTimer = ReassignInterval;
                Reassign(listener.position);
            }

            for (int i = 0; i < MaxVoices; i++)
            {
                TrafficCar car = assignedCar[i];
                if (car == null || !car.Active || car.IsWrecked)
                {
                    if (car != null) Free(i);
                    continue;
                }
                voices[i].transform.position = car.Position;
                voices[i].paramSpeedKmh = car.Speed * 3.6f;
            }
        }

        void Reassign(Vector3 listenerPos)
        {
            // Cheap partial selection: MaxVoices is tiny (8), so a full scan per candidate is fine
            // even with a few dozen traffic cars.
            for (int slot = 0; slot < MaxVoices; slot++)
            {
                if (assignedCar[slot] != null) continue;

                TrafficCar best = null;
                float bestDistSq = HearingRange * HearingRange;
                for (int c = 0; c < candidates.Length; c++)
                {
                    TrafficCar car = candidates[c];
                    if (car == null || !car.Active || car.IsWrecked || IsAlreadyAssigned(car)) continue;
                    float distSq = (car.Position - listenerPos).sqrMagnitude;
                    if (distSq < bestDistSq)
                    {
                        bestDistSq = distSq;
                        best = car;
                    }
                }

                if (best != null)
                {
                    assignedCar[slot] = best;
                    voices[slot].transform.position = best.Position;
                    voices[slot].Activate();
                }
            }

            // Drop any assigned car that has drifted out of range or been out-prioritised by
            // something closer waiting for a free slot.
            for (int slot = 0; slot < MaxVoices; slot++)
            {
                TrafficCar car = assignedCar[slot];
                if (car == null) continue;
                if ((car.Position - listenerPos).sqrMagnitude > HearingRange * HearingRange) Free(slot);
            }
        }

        bool IsAlreadyAssigned(TrafficCar car)
        {
            for (int i = 0; i < MaxVoices; i++)
            {
                if (assignedCar[i] == car) return true;
            }
            return false;
        }

        void Free(int slot)
        {
            assignedCar[slot] = null;
            voices[slot].Deactivate();
        }
    }
}
