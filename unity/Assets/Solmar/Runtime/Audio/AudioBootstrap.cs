using Solmar.Traffic;
using Solmar.Vehicles;
using UnityEngine;

namespace Solmar.Audio
{
    /// <summary>
    /// Wires up every synthesised gameplay sound in <c>Runtime/Audio</c> without anything else
    /// needing to know these components exist: adds a <see cref="VehicleAudio"/> to every
    /// <see cref="VehicleController"/>, a <see cref="PlayerFootstepAudio"/> to the on-foot player, and
    /// keeps <see cref="TrafficEngineVoices"/> supplied with the current traffic-car list - all found
    /// with a scan once a second (never a per-frame <c>FindObjectsByType</c>), so a car or the player
    /// spawning slightly after scene load still gets sound within a second.
    /// </summary>
    public sealed class AudioBootstrap : MonoBehaviour
    {
        const float ScanInterval = 1f;

        TrafficEngineVoices trafficVoices;
        float scanTimer;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Bootstrap()
        {
            if (FindAnyObjectByType<AudioBootstrap>() != null) return;
            var go = new GameObject("Solmar audio bootstrap");
            go.AddComponent<AudioBootstrap>();
        }

        void Awake()
        {
            var voicesGo = new GameObject("Traffic engine voices");
            voicesGo.transform.SetParent(transform, false);
            trafficVoices = voicesGo.AddComponent<TrafficEngineVoices>();
        }

        void Start()
        {
            Scan();
        }

        void Update()
        {
            scanTimer -= Time.deltaTime;
            if (scanTimer <= 0f)
            {
                scanTimer = ScanInterval;
                Scan();
            }
        }

        void Scan()
        {
            foreach (VehicleController vehicle in FindObjectsByType<VehicleController>(FindObjectsSortMode.None))
            {
                if (vehicle.GetComponent<VehicleAudio>() != null) continue;
                // VehicleAudio requires an AudioSource and finds it with GetComponent in OnEnable,
                // so adding the audio component is enough - Unity adds the AudioSource for us.
                var vehicleAudio = vehicle.gameObject.AddComponent<VehicleAudio>();
                vehicleAudio.vehicle = vehicle;
            }

            trafficVoices.SetCandidates(FindObjectsByType<TrafficCar>(FindObjectsSortMode.None));

            PlayerCharacter player = FindAnyObjectByType<PlayerCharacter>();
            if (player != null && player.gameObject.name == "Player" && player.GetComponent<PlayerFootstepAudio>() == null)
            {
                var footsteps = player.gameObject.AddComponent<PlayerFootstepAudio>();
                footsteps.character = player;
            }
        }
    }
}
