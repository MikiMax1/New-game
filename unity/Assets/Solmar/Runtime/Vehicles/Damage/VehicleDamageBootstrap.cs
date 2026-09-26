using UnityEngine;
using Solmar.Traffic;

namespace Solmar.Vehicles.Damage
{
    /// <summary>
    /// Attaches a <see cref="VehicleDamage"/> to every drivable and traffic car automatically, with no
    /// per-frame scanning: a hidden runner object checks once a second for any
    /// <see cref="VehicleController"/> or <see cref="TrafficCar"/> that doesn't have one yet (freshly
    /// spawned traffic, or a car built after the scene loaded) and adds it. Traffic cars are pooled and
    /// reused rather than recreated, so once one has a <see cref="VehicleDamage"/> it keeps it for the
    /// pool's lifetime; <see cref="VehicleDamage"/> itself resets its own damage state when a pooled car
    /// is reactivated.
    /// </summary>
    static class VehicleDamageBootstrap
    {
        const float ScanInterval = 1f;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Init()
        {
            var go = new GameObject("Vehicle damage bootstrap") { hideFlags = HideFlags.HideAndDontSave };
            Object.DontDestroyOnLoad(go);
            go.AddComponent<Runner>().Begin();
        }

        sealed class Runner : MonoBehaviour
        {
            public void Begin() => InvokeRepeating(nameof(Scan), 0f, ScanInterval);

            void Scan()
            {
                var controllers = FindObjectsByType<VehicleController>(FindObjectsSortMode.None);
                for (int i = 0; i < controllers.Length; i++)
                {
                    VehicleController vc = controllers[i];
                    if (vc != null && vc.GetComponent<VehicleDamage>() == null) vc.gameObject.AddComponent<VehicleDamage>();
                }

                var traffic = FindObjectsByType<TrafficCar>(FindObjectsSortMode.None);
                for (int i = 0; i < traffic.Length; i++)
                {
                    TrafficCar tc = traffic[i];
                    if (tc != null && tc.GetComponent<VehicleDamage>() == null) tc.gameObject.AddComponent<VehicleDamage>();
                }
            }
        }
    }
}
