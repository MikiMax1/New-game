using System.Collections.Generic;
using Solmar.City.Roads;
using Solmar.UI;
using Solmar.Vehicles;
using Solmar.Vehicles.Damage;
using UnityEngine;

namespace Solmar.Menus
{
    /// <summary>
    /// Play-session stats for the pause menu's Stats tab: time played, distance covered on foot and
    /// behind the wheel, how many cars have taken damage, the highest wanted level reached, and the
    /// player's money (read straight from <see cref="PlayerStats"/> when needed, not tracked here).
    /// All static so the menu can read them without a scene reference; <see cref="Tracker"/> is the
    /// MonoBehaviour that actually samples them once a second, bootstrapped alongside the pause menu.
    /// </summary>
    public static class GameStats
    {
        public static float TimePlayedSeconds;
        public static float DistanceWalkedMetres;
        public static float DistanceDrivenMetres;
        public static int CarsDamaged;
        public static int MaxWantedLevel;

        static readonly HashSet<VehicleDamage> DamagedCars = new HashSet<VehicleDamage>();

        /// <summary>Restores stats read back from a save file; distinct from Reset, which is for a
        /// fresh game.</summary>
        public static void ApplyLoaded(float timePlayed, float distanceWalked, float distanceDriven, int carsDamaged, int maxWanted)
        {
            TimePlayedSeconds = timePlayed;
            DistanceWalkedMetres = distanceWalked;
            DistanceDrivenMetres = distanceDriven;
            CarsDamaged = Mathf.Max(carsDamaged, DamagedCars.Count);
            MaxWantedLevel = maxWanted;
        }

        /// <summary>
        /// Samples position and wanted level once a second (per the spec) to accumulate distance and
        /// time played, and scans for newly damaged cars. Bootstrapped by <see cref="PauseMenu"/> into
        /// the same scenes as the rest of the menu system.
        /// </summary>
        public sealed class Tracker : MonoBehaviour
        {
            const float SampleInterval = 1f;

            float timer;
            bool hasLastCarPos;
            Vector3 lastCarPos;
            bool hasLastWalkPos;
            Vector3 lastWalkPos;

            [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
            static void AddToScene()
            {
                if ((FindAnyObjectByType<Solmar.SolmarCity>() == null && FindAnyObjectByType<SolmarDistrict>() == null) || FindAnyObjectByType<Tracker>() != null) return;
                new GameObject("Game stats tracker").AddComponent<Tracker>();
            }

            void Update()
            {
                timer += Time.unscaledDeltaTime;
                if (timer < SampleInterval) return;
                timer = 0f;

                TimePlayedSeconds += SampleInterval;
                MaxWantedLevel = Mathf.Max(MaxWantedLevel, PlayerStats.WantedLevel);

                VehicleController playerCar = null;
                foreach (VehicleController vc in FindObjectsByType<VehicleController>(FindObjectsSortMode.None))
                {
                    if (vc.IsPlayerControlled) { playerCar = vc; break; }
                    VehicleDamage damage = vc.GetComponent<VehicleDamage>();
                    if (damage != null && damage.EngineHealth01 < 1f) DamagedCars.Add(damage);
                }
                CarsDamaged = DamagedCars.Count;

                if (playerCar != null)
                {
                    Vector3 pos = playerCar.transform.position;
                    if (hasLastCarPos) DistanceDrivenMetres += Vector3.Distance(lastCarPos, pos);
                    lastCarPos = pos;
                    hasLastCarPos = true;
                    hasLastWalkPos = false;
                }
                else
                {
                    hasLastCarPos = false;
                    GameObject player = GameObject.Find("Player");
                    if (player != null && player.activeInHierarchy)
                    {
                        Vector3 pos = player.transform.position;
                        if (hasLastWalkPos) DistanceWalkedMetres += Vector3.Distance(lastWalkPos, pos);
                        lastWalkPos = pos;
                        hasLastWalkPos = true;
                    }
                    else
                    {
                        hasLastWalkPos = false;
                    }
                }
            }
        }
    }
}
