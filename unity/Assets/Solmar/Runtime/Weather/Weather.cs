using Solmar.City.Roads;
using UnityEngine;

namespace Solmar.Weather
{
    /// <summary>
    /// Miami's sky: Clear, Humid haze, Overcast, Rain and Thunderstorm, cycling on their own every
    /// few in-game hours (random, weighted heavily toward Clear) and smoothly crossfading into one
    /// another; K steps to the next one by hand. Drives the rain particles and synthesised rain and
    /// thunder audio, dims the sun and thickens the volumetric clouds and fog as it clouds over, and
    /// wets the road, pavement, kerb and puddle materials CityMaterials bakes dry - drying them out
    /// again over about ten real minutes, faster in direct sun.
    ///
    /// Exposes <see cref="Rain"/> (0..1, the current rain rate) and <see cref="Wetness"/> (0..1, how
    /// wet the ground actually is right now) as static properties for anything else that wants them.
    ///
    /// Bootstrapped once into any Play-mode scene with a SolmarCity or SolmarDistrict, the same way
    /// QualityPresets and NightLighting are; it re-finds the sun, the atmosphere volume and the road
    /// materials once a second since the city can regenerate and replace all of them.
    /// </summary>
    public sealed class Weather : MonoBehaviour
    {
        public enum Kind { Clear, HumidHaze, Overcast, Rain, Thunderstorm }

        // Per-state sky murk (drives clouds, fog and sun dimming) and the rain rate it settles at.
        static readonly float[] CloudTarget = { 0.15f, 0.4f, 0.75f, 0.85f, 1f };
        static readonly float[] RainTarget = { 0f, 0f, 0f, 0.6f, 1f };
        // Weighted toward Clear, the way Miami mostly is: Clear, Humid haze, Overcast, Rain, Thunderstorm.
        static readonly float[] AutoWeights = { 0.45f, 0.2f, 0.15f, 0.13f, 0.07f };
        static readonly string[] Names = { "Clear", "Humid haze", "Overcast", "Rain", "Thunderstorm" };

        const float TransitionSeconds = 26f;
        const float WetRiseSeconds = 55f;
        const float DrySeconds = 600f; // 10 real minutes baseline
        const float DrySunMultiplier = 3f;
        const float DryHazeMultiplier = 1.2f;
        const float MinCycleHours = 2f, MaxCycleHours = 6f;
        const float FallbackHoursPerSecond = 1f / 150f; // no TimeOfDay in the scene: a slow real-time proxy
        const float DisplaySeconds = 3.5f;
        const float RescanInterval = 1f;
        const float MinLightningGapSeconds = 4f, MaxLightningGapSeconds = 14f;
        const float ThunderDelayPerMetre = 1f / 340f; // sound at ~340 m/s from an assumed strike distance

        /// <summary>The weather right now.</summary>
        public static Kind Current { get; private set; } = Kind.Clear;

        /// <summary>Switches to `kind` (e.g. when a saved game is loaded); the sky, rain and wetness
        /// then ease towards it over the usual transition.</summary>
        public static void Set(Kind kind) => Current = kind;
        /// <summary>0 (dry) to 1 (downpour): the current rain rate, smoothly transitioning between states.</summary>
        public static float Rain { get; private set; }
        /// <summary>0 (bone dry) to 1 (soaked): how wet the ground is right now. Rises in rain, dries
        /// slowly after - about ten real minutes to fully dry, faster in direct sun.</summary>
        public static float Wetness { get; private set; }

        readonly WeatherVisuals visuals = new WeatherVisuals();
        readonly RainEffect rain = new RainEffect();
        RainAudio rainAudio;
        Shader unlitShader;

        float cloudCurrent, rainCurrent, wetness;
        float gameHoursSinceChange;
        float nextChangeHours = 3f;
        float lightningTimer;

        Camera cam;
        TimeOfDay timeOfDay;
        bool hasLastHours;
        float lastHours;

        float timeSinceScan = float.PositiveInfinity;
        float displayTimer;
        GUIStyle style;

        /// <summary>
        /// Adds the weather system to any Play-mode scene with a city or district, so scenes made
        /// before it existed get it too (mirrors QualityPresets.AddToScene).
        /// </summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void AddToScene()
        {
            if ((FindAnyObjectByType<SolmarCity>() == null && FindAnyObjectByType<SolmarDistrict>() == null) || FindAnyObjectByType<Weather>() != null) return;
            new GameObject("Weather").AddComponent<Weather>();
        }

        void OnEnable()
        {
            unlitShader = Shader.Find("HDRP/Unlit");
            rainAudio = gameObject.AddComponent<RainAudio>();
            nextChangeHours = Random.Range(MinCycleHours, MaxCycleHours);
            lightningTimer = Random.Range(MinLightningGapSeconds, MaxLightningGapSeconds);
        }

        void Update()
        {
            float dt = Time.unscaledDeltaTime;

#if ENABLE_LEGACY_INPUT_MANAGER
            if (Input.GetKeyDown(KeyCode.K)) ManualCycle();
#endif

            timeSinceScan += dt;
            if (timeSinceScan >= RescanInterval)
            {
                Rescan();
                timeSinceScan = 0f;
            }

            AdvanceCycle(dt);

            float cloudTarget = CloudTarget[(int)Current];
            float rainTarget = RainTarget[(int)Current];
            float smoothing = 1f - Mathf.Exp(-dt / TransitionSeconds);
            cloudCurrent = Mathf.Lerp(cloudCurrent, cloudTarget, smoothing);
            rainCurrent = Mathf.Lerp(rainCurrent, rainTarget, smoothing);

            UpdateWetness(dt);

            Rain = rainCurrent;
            Wetness = wetness;

            visuals.Apply(wetness, cloudCurrent, dt);
            rain.Advance(transform, unlitShader, cam != null ? cam.transform : null, rainCurrent, dt);
            if (rainAudio != null)
            {
                rainAudio.Intensity = rainCurrent;
                rainAudio.Roughness = Current == Kind.Thunderstorm ? 1f : 0f;
            }

            UpdateLightning(dt);

            if (displayTimer > 0f) displayTimer -= dt;
        }

        void Rescan()
        {
            visuals.Rescan();
            if (cam == null) cam = Camera.main;
            if (cam == null) cam = FindAnyObjectByType<Camera>();
            if (timeOfDay == null) timeOfDay = FindAnyObjectByType<TimeOfDay>();
        }

        /// <summary>Counts in-game hours forward (via TimeOfDay if the scene has one, otherwise a
        /// slow real-time stand-in) and rolls a new, weighted-random weather state once enough of
        /// them have passed.</summary>
        void AdvanceCycle(float dt)
        {
            float gameHours;
            if (timeOfDay != null)
            {
                float hours = timeOfDay.Hours;
                if (!hasLastHours)
                {
                    lastHours = hours;
                    hasLastHours = true;
                }
                float delta = hours - lastHours;
                if (delta < -12f) delta += 24f;
                else if (delta > 12f) delta -= 24f;
                lastHours = hours;
                gameHours = Mathf.Max(0f, delta);
            }
            else
            {
                gameHours = dt * FallbackHoursPerSecond;
            }

            gameHoursSinceChange += gameHours;
            if (gameHoursSinceChange >= nextChangeHours)
            {
                SetState(PickWeighted());
            }
        }

        void UpdateWetness(float dt)
        {
            if (rainCurrent > 0.02f)
            {
                wetness = Mathf.Min(1f, wetness + rainCurrent * dt / WetRiseSeconds);
                return;
            }
            float dryPerSecond = 1f / DrySeconds;
            bool sunny = Current == Kind.Clear && visuals.SunElevationDegrees > 5f;
            if (sunny) dryPerSecond *= DrySunMultiplier;
            else if (Current == Kind.HumidHaze) dryPerSecond *= DryHazeMultiplier;
            wetness = Mathf.Max(0f, wetness - dryPerSecond * dt);
        }

        void UpdateLightning(float dt)
        {
            if (Current != Kind.Thunderstorm)
            {
                lightningTimer = Random.Range(MinLightningGapSeconds, MaxLightningGapSeconds);
                return;
            }
            lightningTimer -= dt;
            if (lightningTimer > 0f) return;
            lightningTimer = Random.Range(MinLightningGapSeconds, MaxLightningGapSeconds);

            visuals.Flash();
            float distanceMetres = Random.Range(200f, 3500f);
            if (rainAudio != null) rainAudio.Thunder(distanceMetres * ThunderDelayPerMetre, Mathf.Clamp01(1.3f - distanceMetres / 3500f));
        }

        void ManualCycle()
        {
            var next = (Kind)(((int)Current + 1) % Names.Length);
            SetState(next);
        }

        void SetState(Kind next)
        {
            Current = next;
            gameHoursSinceChange = 0f;
            nextChangeHours = Random.Range(MinCycleHours, MaxCycleHours);
            displayTimer = DisplaySeconds;
        }

        static Kind PickWeighted()
        {
            float total = 0f;
            for (int i = 0; i < AutoWeights.Length; i++) total += AutoWeights[i];
            float r = Random.value * total;
            float acc = 0f;
            for (int i = 0; i < AutoWeights.Length; i++)
            {
                acc += AutoWeights[i];
                if (r <= acc) return (Kind)i;
            }
            return Kind.Clear;
        }

        void OnGUI()
        {
            if (displayTimer <= 0f) return;
            style ??= new GUIStyle(GUI.skin.label) { fontSize = 20, alignment = TextAnchor.UpperRight };
            string text = Names[(int)Current];
            var rect = new Rect(Screen.width - 520f, 58f, 500f, 34f);
            GUI.color = new Color(0f, 0f, 0f, 0.6f);
            GUI.Label(new Rect(rect.x + 2f, rect.y + 2f, rect.width, rect.height), text, style);
            GUI.color = Color.white;
            GUI.Label(rect, text, style);
        }
    }
}
