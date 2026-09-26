using Solmar.Audio;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar.Menus
{
    /// <summary>
    /// Every setting the pause menu's Settings tab exposes, persisted in <see cref="PlayerPrefs"/> and
    /// applied to the rest of the game. Loaded once (<see cref="Load"/>) at bootstrap and re-applied
    /// (<see cref="Apply"/>) whenever a value changes in the menu or a save is loaded with its own
    /// settings snapshot. Camera shake, subtitles, HUD-visible and minimap zoom are read-only static
    /// flags for other systems to pick up later (nothing wires into them yet, per SOLMAR's current
    /// scope); mouse sensitivity/invert-Y are likewise exposed for the look scripts to read later.
    /// </summary>
    public static class GameSettings
    {
        const string KeyPreset = "Solmar.Settings.Preset";
        const string KeyFpsCap = "Solmar.Settings.FpsCap";
        const string KeyFov = "Solmar.Settings.Fov";
        const string KeyMotionBlur = "Solmar.Settings.MotionBlur";
        const string KeyCameraShake = "Solmar.Settings.CameraShake";
        const string KeyMasterVolume = "Solmar.Settings.MasterVolume";
        const string KeySfxVolume = "Solmar.Settings.SfxVolume";
        const string KeyMouseSensitivity = "Solmar.Settings.MouseSensitivity";
        const string KeyInvertY = "Solmar.Settings.InvertY";
        const string KeySubtitles = "Solmar.Settings.Subtitles";
        const string KeyHudEnabled = "Solmar.Settings.HudEnabled";
        const string KeyMinimapZoom = "Solmar.Settings.MinimapZoom";

        public const int PresetCount = 5; // QualityPresets.Preset: Low..Extreme
        public static readonly int[] FpsCapChoices = { 0, 60, 120, 144, 165, 240 };

        public static int Preset = 2; // High
        public static int FpsCap;
        public static float Fov = 60f;
        public static bool MotionBlur = true;
        /// <summary>Read by anything that shakes the camera on impacts/explosions; nothing does yet.</summary>
        public static bool CameraShake = true;
        public static float MasterVolume = 1f;
        public static float SfxVolume = 1f;
        /// <summary>Read by the look scripts (PlayerWalker/OrbitCamera) later; not wired in yet.</summary>
        public static float MouseSensitivity = 1f;
        public static bool InvertY;
        /// <summary>Read by dialogue/interaction UI later; nothing shows subtitles yet.</summary>
        public static bool Subtitles = true;
        /// <summary>Read by <see cref="Solmar.UI.Hud"/> later to hide itself; not wired in yet.</summary>
        public static bool HudEnabled = true;
        /// <summary>0.5 (zoomed in) .. 2 (zoomed out) multiplier on the minimap's zoom-with-speed range.</summary>
        public static float MinimapZoom = 1f;

        static bool loaded;

        /// <summary>Reads every setting from PlayerPrefs (defaults if this is the first run).</summary>
        public static void Load()
        {
            Preset = Mathf.Clamp(PlayerPrefs.GetInt(KeyPreset, Preset), 0, PresetCount - 1);
            FpsCap = PlayerPrefs.GetInt(KeyFpsCap, FpsCap);
            Fov = Mathf.Clamp(PlayerPrefs.GetFloat(KeyFov, Fov), 50f, 100f);
            MotionBlur = PlayerPrefs.GetInt(KeyMotionBlur, MotionBlur ? 1 : 0) != 0;
            CameraShake = PlayerPrefs.GetInt(KeyCameraShake, CameraShake ? 1 : 0) != 0;
            MasterVolume = Mathf.Clamp01(PlayerPrefs.GetFloat(KeyMasterVolume, MasterVolume));
            SfxVolume = Mathf.Clamp01(PlayerPrefs.GetFloat(KeySfxVolume, SfxVolume));
            MouseSensitivity = Mathf.Clamp(PlayerPrefs.GetFloat(KeyMouseSensitivity, MouseSensitivity), 0.1f, 4f);
            InvertY = PlayerPrefs.GetInt(KeyInvertY, InvertY ? 1 : 0) != 0;
            Subtitles = PlayerPrefs.GetInt(KeySubtitles, Subtitles ? 1 : 0) != 0;
            HudEnabled = PlayerPrefs.GetInt(KeyHudEnabled, HudEnabled ? 1 : 0) != 0;
            MinimapZoom = Mathf.Clamp(PlayerPrefs.GetFloat(KeyMinimapZoom, MinimapZoom), 0.5f, 2f);
            loaded = true;
        }

        /// <summary>Writes every setting to PlayerPrefs.</summary>
        public static void Save()
        {
            PlayerPrefs.SetInt(KeyPreset, Preset);
            PlayerPrefs.SetInt(KeyFpsCap, FpsCap);
            PlayerPrefs.SetFloat(KeyFov, Fov);
            PlayerPrefs.SetInt(KeyMotionBlur, MotionBlur ? 1 : 0);
            PlayerPrefs.SetInt(KeyCameraShake, CameraShake ? 1 : 0);
            PlayerPrefs.SetFloat(KeyMasterVolume, MasterVolume);
            PlayerPrefs.SetFloat(KeySfxVolume, SfxVolume);
            PlayerPrefs.SetFloat(KeyMouseSensitivity, MouseSensitivity);
            PlayerPrefs.SetInt(KeyInvertY, InvertY ? 1 : 0);
            PlayerPrefs.SetInt(KeySubtitles, Subtitles ? 1 : 0);
            PlayerPrefs.SetInt(KeyHudEnabled, HudEnabled ? 1 : 0);
            PlayerPrefs.SetFloat(KeyMinimapZoom, MinimapZoom);
            PlayerPrefs.Save();
        }

        /// <summary>Applies every setting to the rest of the game: quality preset and fps cap
        /// (QualityPresets), field of view (the main camera), motion blur (every HDRP Volume), and
        /// master/SFX volume (GameAudio). Safe to call any time, including before the scene finishes
        /// generating - it re-tries the pieces it can't find yet next frame via QualityPresets' and
        /// Weather's own rescans, and simply skips them here.</summary>
        public static void Apply()
        {
            if (!loaded) Load();

            var presets = Object.FindAnyObjectByType<QualityPresets>();
            if (presets != null)
            {
                presets.SetPreset(Preset);
                presets.SetFrameRateCap(FpsCap);
            }

            Camera cam = Camera.main;
            if (cam != null) cam.fieldOfView = Fov;

            GameAudio.MasterVolume = MasterVolume;
            GameAudio.SfxVolume = SfxVolume;

            foreach (Volume volume in Object.FindObjectsByType<Volume>(FindObjectsSortMode.None))
            {
                VolumeProfile profile = volume.sharedProfile;
                if (profile == null) continue;
                foreach (VolumeComponent component in profile.components)
                {
                    if (component is MotionBlur motionBlur) motionBlur.active = MotionBlur;
                }
            }
        }
    }
}
