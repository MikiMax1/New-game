using UnityEngine;

namespace Solmar.UI
{
    /// <summary>
    /// The player's vitals and progress, read by the HUD: health and armour (0-100, no health system
    /// exists yet so anything that adds one should write here), money and a 0-5 wanted level. All
    /// static so the HUD (and, later, damage/economy/police systems) can reach it without a scene
    /// reference. <see cref="WantedLevel"/> remembers when it last changed so the HUD can hide the
    /// empty star row once things have been quiet for a while.
    /// </summary>
    public static class PlayerStats
    {
        const float MaxHealthDefault = 100f;
        const float MaxArmourDefault = 100f;
        const float WantedRecentSeconds = 6f;

        public static float MaxHealth = MaxHealthDefault;
        public static float MaxArmour = MaxArmourDefault;

        static float health = MaxHealthDefault;
        static float armour;
        static long money = 500;
        static int wantedLevel;
        static float wantedChangedAtTime = float.NegativeInfinity;

        public static float Health
        {
            get => health;
            set => health = Mathf.Clamp(IsFinite(value) ? value : 0f, 0f, MaxHealth);
        }

        public static float Armour
        {
            get => armour;
            set => armour = Mathf.Clamp(IsFinite(value) ? value : 0f, 0f, MaxArmour);
        }

        public static long Money
        {
            get => money;
            set => money = value < 0 ? 0 : value;
        }

        public static int WantedLevel
        {
            get => wantedLevel;
            set
            {
                int clamped = Mathf.Clamp(value, 0, 5);
                if (clamped != wantedLevel) wantedChangedAtTime = Time.unscaledTime;
                wantedLevel = clamped;
            }
        }

        /// <summary>True while the wanted level is above zero, or changed recently enough that the
        /// (now empty) star row should still be shown briefly.</summary>
        public static bool WantedRecentlyChanged =>
            wantedLevel > 0 || Time.unscaledTime - wantedChangedAtTime < WantedRecentSeconds;

        static bool IsFinite(float v) => !float.IsNaN(v) && !float.IsInfinity(v);
    }
}
