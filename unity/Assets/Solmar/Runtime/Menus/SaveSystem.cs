using System;
using System.IO;
using Solmar.UI;
using Solmar.Vehicles;
using UnityEngine;
using WeatherSystem = Solmar.Weather.Weather;

namespace Solmar.Menus
{
    /// <summary>One save file's worth of state: player transform, whether they were driving, time of
    /// day, weather, vitals, stats and a settings snapshot. Plain data, written and read with
    /// <see cref="JsonUtility"/> - no packages, no binary formatter.</summary>
    [Serializable]
    public sealed class SolmarSaveData
    {
        public int version = 1;
        public string savedAtIso = "";

        public float posX, posY, posZ;
        public float rotX, rotY, rotZ, rotW = 1f;
        public bool wasInCar;

        public float timeHours = 18f;
        public int weatherKind;

        public long money;
        public float health = 100f;
        public float armour;

        public float timePlayedSeconds;
        public float distanceWalkedMetres;
        public float distanceDrivenMetres;
        public int carsDamaged;
        public int maxWantedLevel;

        public int settingsPreset;
        public int settingsFpsCap;
        public float settingsFov = 60f;
        public bool settingsMotionBlur = true;
        public bool settingsCameraShake = true;
        public float settingsMasterVolume = 1f;
        public float settingsSfxVolume = 1f;
        public float settingsMouseSensitivity = 1f;
        public bool settingsInvertY;
        public bool settingsSubtitles = true;
        public bool settingsHudEnabled = true;
        public float settingsMinimapZoom = 1f;
    }

    /// <summary>
    /// Three numbered save slots plus one autosave slot, as JSON files under
    /// <see cref="Application.persistentDataPath"/>/saves. Loading teleports the "Player" GameObject
    /// (<see cref="Solmar.Player.PlayerSpawner"/>'s third-person root) to the saved spot; if the player
    /// was driving when they saved, that spot is where their car was, not the (stale) hidden player
    /// transform. Time of day and weather are restored best-effort via reflection onto their private
    /// setters, since neither exposes a public one - if that ever fails (an API change), the load
    /// simply leaves the current time/weather alone rather than throwing.
    /// </summary>
    public static class SaveSystem
    {
        public const int SlotCount = 3;
        const string AutosaveName = "autosave";

        static string Dir => Path.Combine(Application.persistentDataPath, "saves");
        static string SlotPath(int slot) => Path.Combine(Dir, "slot" + slot + ".json");
        static string AutosavePath => Path.Combine(Dir, AutosaveName + ".json");

        /// <summary>Whether a numbered slot (0-based) has a save file, and when it was written; for
        /// the Load tab's listing.</summary>
        public static bool TryDescribeSlot(int slot, out string savedAtIso)
        {
            savedAtIso = "";
            string path = SlotPath(slot);
            if (!File.Exists(path)) return false;
            try
            {
                var data = JsonUtility.FromJson<SolmarSaveData>(File.ReadAllText(path));
                savedAtIso = data != null ? data.savedAtIso : "";
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        public static bool AutosaveExists(out string savedAtIso)
        {
            savedAtIso = "";
            if (!File.Exists(AutosavePath)) return false;
            try
            {
                var data = JsonUtility.FromJson<SolmarSaveData>(File.ReadAllText(AutosavePath));
                savedAtIso = data != null ? data.savedAtIso : "";
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        public static void SaveToSlot(int slot) => WriteFile(SlotPath(slot));

        public static void SaveAutosave() => WriteFile(AutosavePath);

        public static bool LoadFromSlot(int slot) => ReadFile(SlotPath(slot));

        public static bool LoadAutosave() => ReadFile(AutosavePath);

        static void WriteFile(string path)
        {
            try
            {
                Directory.CreateDirectory(Dir);
                File.WriteAllText(path, JsonUtility.ToJson(Capture(), true));
            }
            catch (Exception e)
            {
                Debug.LogWarning("SOLMAR: failed to save game - " + e.Message);
            }
        }

        static bool ReadFile(string path)
        {
            if (!File.Exists(path)) return false;
            try
            {
                var data = JsonUtility.FromJson<SolmarSaveData>(File.ReadAllText(path));
                if (data == null) return false;
                Apply(data);
                return true;
            }
            catch (Exception e)
            {
                Debug.LogWarning("SOLMAR: failed to load game - " + e.Message);
                return false;
            }
        }

        static SolmarSaveData Capture()
        {
            var data = new SolmarSaveData
            {
                savedAtIso = DateTime.UtcNow.ToString("o"),
                money = PlayerStats.Money,
                health = PlayerStats.Health,
                armour = PlayerStats.Armour,
                timePlayedSeconds = GameStats.TimePlayedSeconds,
                distanceWalkedMetres = GameStats.DistanceWalkedMetres,
                distanceDrivenMetres = GameStats.DistanceDrivenMetres,
                carsDamaged = GameStats.CarsDamaged,
                maxWantedLevel = GameStats.MaxWantedLevel,
                weatherKind = (int)WeatherSystem.Current,

                settingsPreset = GameSettings.Preset,
                settingsFpsCap = GameSettings.FpsCap,
                settingsFov = GameSettings.Fov,
                settingsMotionBlur = GameSettings.MotionBlur,
                settingsCameraShake = GameSettings.CameraShake,
                settingsMasterVolume = GameSettings.MasterVolume,
                settingsSfxVolume = GameSettings.SfxVolume,
                settingsMouseSensitivity = GameSettings.MouseSensitivity,
                settingsInvertY = GameSettings.InvertY,
                settingsSubtitles = GameSettings.Subtitles,
                settingsHudEnabled = GameSettings.HudEnabled,
                settingsMinimapZoom = GameSettings.MinimapZoom,
            };

            var timeOfDay = UnityEngine.Object.FindAnyObjectByType<TimeOfDay>();
            data.timeHours = timeOfDay != null ? timeOfDay.Hours : 18f;

            VehicleController playerCar = null;
            foreach (VehicleController vc in UnityEngine.Object.FindObjectsByType<VehicleController>(FindObjectsSortMode.None))
            {
                if (vc.IsPlayerControlled) { playerCar = vc; break; }
            }

            Transform source;
            if (playerCar != null)
            {
                data.wasInCar = true;
                source = playerCar.transform;
            }
            else
            {
                data.wasInCar = false;
                GameObject player = GameObject.Find("Player");
                source = player != null ? player.transform : null;
            }

            if (source != null)
            {
                Vector3 p = source.position;
                data.posX = p.x; data.posY = p.y; data.posZ = p.z;
                Quaternion r = source.rotation;
                data.rotX = r.x; data.rotY = r.y; data.rotZ = r.z; data.rotW = r.w;
            }

            return data;
        }

        static void Apply(SolmarSaveData data)
        {
            PlayerStats.Money = data.money;
            PlayerStats.Health = data.health;
            PlayerStats.Armour = data.armour;
            GameStats.ApplyLoaded(data.timePlayedSeconds, data.distanceWalkedMetres, data.distanceDrivenMetres, data.carsDamaged, data.maxWantedLevel);

            GameSettings.Preset = data.settingsPreset;
            GameSettings.FpsCap = data.settingsFpsCap;
            GameSettings.Fov = data.settingsFov;
            GameSettings.MotionBlur = data.settingsMotionBlur;
            GameSettings.CameraShake = data.settingsCameraShake;
            GameSettings.MasterVolume = data.settingsMasterVolume;
            GameSettings.SfxVolume = data.settingsSfxVolume;
            GameSettings.MouseSensitivity = data.settingsMouseSensitivity;
            GameSettings.InvertY = data.settingsInvertY;
            GameSettings.Subtitles = data.settingsSubtitles;
            GameSettings.HudEnabled = data.settingsHudEnabled;
            GameSettings.MinimapZoom = data.settingsMinimapZoom;
            GameSettings.Save();
            GameSettings.Apply();

            TrySetHours(data.timeHours);
            TrySetWeather((WeatherSystem.Kind)data.weatherKind);

            // Just place the player where they were (or where their car was) - no attempt to re-enter
            // the car or restore any driving state, per spec.
            GameObject player = GameObject.Find("Player");
            if (player != null)
            {
                player.transform.SetPositionAndRotation(
                    new Vector3(data.posX, data.posY, data.posZ),
                    new Quaternion(data.rotX, data.rotY, data.rotZ, data.rotW));
            }
        }

        static void TrySetHours(float hours)
        {
            var timeOfDay = UnityEngine.Object.FindAnyObjectByType<TimeOfDay>();
            if (timeOfDay != null) timeOfDay.SetHours(hours);
        }

        static void TrySetWeather(WeatherSystem.Kind kind) => WeatherSystem.Set(kind);
    }
}
