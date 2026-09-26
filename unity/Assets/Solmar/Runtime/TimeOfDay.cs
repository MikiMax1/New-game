using UnityEngine;

namespace Solmar
{
    /// <summary>
    /// Drives the scene's directional "Sun" light from a NOAA-style approximate solar position for
    /// Miami (25.77 deg N, 80.19 deg W, UTC-4). It starts at 18:16 on 26 September (day 269), when
    /// the sun stands 12 degrees up in the west-southwest (azimuth 263), the city's designed light. [ and ] step the clock by 15 minutes; holding T runs
    /// time forward at one game-hour per two real seconds. The current time shows top-left for a
    /// couple of seconds after each change. The sun light is (re)found once a second by name, since
    /// the city can regenerate and replace it.
    /// </summary>
    public sealed class TimeOfDay : MonoBehaviour
    {
        const float Latitude = 25.77f;
        const float Longitude = -80.19f;
        const float UtcOffsetHours = -4f;
        const float FastForwardHoursPerSecond = 0.5f; // one game-hour per two real seconds
        const float DisplaySeconds = 2f;
        const string SunName = "Sun";
        const float SunSearchInterval = 1f;

        public int dayOfYear = 269;
        [Tooltip("Time of day at start, hours (18.27 = 18:16).")]
        public float startHours = 18f + 16f / 60f;

        /// <summary>The current time of day, in hours (0-24).</summary>
        public float Hours { get; private set; }

        /// <summary>Jumps the clock to `hours` (0–24), e.g. when a saved game is loaded.</summary>
        public void SetHours(float hours) => Hours = Mathf.Repeat(hours, 24f);
        public float ElevationDegrees { get; private set; }
        public float AzimuthDegrees { get; private set; }

        Light sun;
        float timeSinceSunSearch = float.PositiveInfinity;
        float displayTimer;

        void Awake()
        {
            Hours = Mathf.Repeat(startHours, 24f);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            bool changed = false;

#if ENABLE_LEGACY_INPUT_MANAGER
            if (Input.GetKeyDown(KeyCode.LeftBracket)) { AddMinutes(-15f); changed = true; }
            if (Input.GetKeyDown(KeyCode.RightBracket)) { AddMinutes(15f); changed = true; }
            if (Input.GetKey(KeyCode.T))
            {
                AddMinutes(FastForwardHoursPerSecond * 60f * dt);
                changed = true;
            }
#endif

            timeSinceSunSearch += dt;
            if (sun == null || timeSinceSunSearch >= SunSearchInterval)
            {
                FindSun();
                timeSinceSunSearch = 0f;
            }

            ComputeSolarPosition(out float elevation, out float azimuth);
            ElevationDegrees = elevation;
            AzimuthDegrees = azimuth;

            if (sun != null)
            {
                float elRad = elevation * Mathf.Deg2Rad;
                float azRad = azimuth * Mathf.Deg2Rad;
                var towardsSun = new Vector3(
                    Mathf.Cos(elRad) * Mathf.Sin(azRad),
                    Mathf.Sin(elRad),
                    Mathf.Cos(elRad) * Mathf.Cos(azRad));
                sun.transform.rotation = Quaternion.LookRotation(-towardsSun, Vector3.up);
            }

            if (changed) displayTimer = DisplaySeconds;
            else if (displayTimer > 0f) displayTimer -= dt;
        }

        void AddMinutes(float minutes)
        {
            Hours = Mathf.Repeat(Hours + minutes / 60f, 24f);
        }

        void FindSun()
        {
            sun = null;
            foreach (Light light in Object.FindObjectsByType<Light>(FindObjectsSortMode.None))
            {
                if (light.type == LightType.Directional && light.name == SunName)
                {
                    sun = light;
                    break;
                }
            }
        }

        /// <summary>NOAA-style approximate solar elevation and compass azimuth (degrees) for the configured place, date and time.</summary>
        void ComputeSolarPosition(out float elevationDeg, out float azimuthDeg)
        {
            float gamma = 2f * Mathf.PI / 365f * (dayOfYear - 1 + (Hours - 12f) / 24f);

            float eqTimeMinutes = 229.18f * (0.000075f
                + 0.001868f * Mathf.Cos(gamma)
                - 0.032077f * Mathf.Sin(gamma)
                - 0.014615f * Mathf.Cos(2f * gamma)
                - 0.040849f * Mathf.Sin(2f * gamma));

            float declRad = 0.006918f
                - 0.399912f * Mathf.Cos(gamma)
                + 0.070257f * Mathf.Sin(gamma)
                - 0.006758f * Mathf.Cos(2f * gamma)
                + 0.000907f * Mathf.Sin(2f * gamma)
                - 0.002697f * Mathf.Cos(3f * gamma)
                + 0.00148f * Mathf.Sin(3f * gamma);

            float timeOffsetMinutes = eqTimeMinutes + 4f * Longitude - 60f * UtcOffsetHours;
            float trueSolarTimeMinutes = Hours * 60f + timeOffsetMinutes;
            float hourAngleDeg = trueSolarTimeMinutes / 4f - 180f;

            float latRad = Latitude * Mathf.Deg2Rad;
            float haRad = hourAngleDeg * Mathf.Deg2Rad;

            float cosZenith = Mathf.Clamp(
                Mathf.Sin(latRad) * Mathf.Sin(declRad) + Mathf.Cos(latRad) * Mathf.Cos(declRad) * Mathf.Cos(haRad),
                -1f, 1f);
            float zenithRad = Mathf.Acos(cosZenith);
            elevationDeg = 90f - zenithRad * Mathf.Rad2Deg;

            float sinZenith = Mathf.Sin(zenithRad);
            float denom = Mathf.Cos(latRad) * sinZenith;
            if (Mathf.Abs(denom) < 1e-6f)
            {
                azimuthDeg = hourAngleDeg > 0f ? 180f : 0f;
                return;
            }

            float cosAz = Mathf.Clamp((Mathf.Sin(latRad) * cosZenith - Mathf.Sin(declRad)) / denom, -1f, 1f);
            float acosDeg = Mathf.Acos(cosAz) * Mathf.Rad2Deg;
            azimuthDeg = hourAngleDeg > 0f ? Mathf.Repeat(acosDeg + 180f, 360f) : Mathf.Repeat(540f - acosDeg, 360f);
        }

        void OnGUI()
        {
            if (displayTimer <= 0f) return;
            int totalMinutes = Mathf.RoundToInt(Mathf.Repeat(Hours, 24f) * 60f) % 1440;
            int h = totalMinutes / 60;
            int m = totalMinutes % 60;
            string text = $"{h:00}:{m:00}";

            var style = new GUIStyle(GUI.skin.label);
            style.fontSize = 20;
            style.normal.textColor = Color.white;
            GUI.Label(new Rect(12f, 10f, 140f, 30f), text, style);
        }
    }
}
