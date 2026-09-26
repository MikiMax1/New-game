using Solmar.City.Roads;
using Solmar.UI;
using UnityEngine;

namespace Solmar.Police
{
    /// <summary>
    /// The static entry point every other system reports crimes through, so melee, weapons or
    /// anything else added later can raise the player's wanted level without knowing anything about
    /// <see cref="PoliceManager"/>. Also bootstraps <see cref="PoliceManager"/> into any Play-mode
    /// scene with a city, and stores the "search circle" (last known player location once contact is
    /// lost) for the HUD to draw later.
    /// </summary>
    public static class Police
    {
        /// <summary>Centre of the area police are searching once they've lost the player; only meaningful while <see cref="PlayerStats.WantedLevel"/> is above zero.</summary>
        public static Vector3 SearchCircleCenter { get; internal set; }
        /// <summary>Radius, metres, of the area above.</summary>
        public static float SearchCircleRadius { get; internal set; }
        /// <summary>Whether a search circle is currently meaningful (the player is wanted at all).</summary>
        public static bool HasSearchCircle => PlayerStats.WantedLevel > 0;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Bootstrap()
        {
            bool hasCity = Object.FindAnyObjectByType<SolmarCity>() != null || Object.FindAnyObjectByType<SolmarDistrict>() != null;
            if (!hasCity || Object.FindAnyObjectByType<PoliceManager>() != null) return;
            var go = new GameObject("Police manager");
            go.AddComponent<PoliceManager>();
        }

        /// <summary>
        /// Raises the player's wanted level by <paramref name="stars"/> (clamped 0-5 by
        /// <see cref="PlayerStats.WantedLevel"/> itself) and tells police the player was just seen at
        /// <paramref name="position"/>, so pursuit spawns towards them and the search circle centres
        /// there. Safe to call from anywhere, including before <see cref="PoliceManager"/> exists.
        /// </summary>
        public static void ReportCrime(Vector3 position, int stars)
        {
            if (stars <= 0 || !IsFinite(position)) return;
            PlayerStats.WantedLevel += stars;
            if (PoliceManager.Instance != null) PoliceManager.Instance.NotifySeen(position);
        }

        static bool IsFinite(Vector3 v) => float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z);
    }
}
