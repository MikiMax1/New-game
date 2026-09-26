using UnityEngine;

namespace Solmar.Audio
{
    /// <summary>
    /// The small master mixer every synthesised sound in <c>Runtime/Audio</c> reads from: a single
    /// master gain and a gain for sound effects (engines, tyres, footsteps, impacts, horn) separate
    /// from music/ambience/weather, so a settings menu has one place to plug volume sliders into.
    /// Values are clamped 0..1; every audio-thread reader treats a not-yet-initialised value safely
    /// because the defaults are 1.
    /// </summary>
    public static class GameAudio
    {
        static float masterVolume = 1f;
        static float sfxVolume = 1f;

        public static float MasterVolume
        {
            get => masterVolume;
            set => masterVolume = Clamp01(value);
        }

        public static float SfxVolume
        {
            get => sfxVolume;
            set => sfxVolume = Clamp01(value);
        }

        static float Clamp01(float v)
        {
            if (!float.IsFinite(v)) return 1f;
            if (v < 0f) return 0f;
            if (v > 1f) return 1f;
            return v;
        }
    }
}
