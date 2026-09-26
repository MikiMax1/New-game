using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar
{
    /// <summary>
    /// Quality presets from Low to Extreme, and the frame-rate cap.
    ///
    /// There is no cap by default: vsync is off, so the frame rate is limited only by the GPU. F6
    /// steps the cap through off, 60, 120, 144, 165 and 240. F5 steps the preset. A preset sets the
    /// quality level of HDRP's scalable effects (reflections, ambient occlusion, contact shadows,
    /// fog, depth of field, bloom) on every volume in the scene, the volumetric clouds' sample
    /// counts, the shadow distance and the level-of-detail bias. Extreme goes past HDRP's High
    /// level with custom sample counts: full-resolution ambient occlusion, longer reflection rays,
    /// more cloud and contact-shadow samples and a bigger fog budget. The preset and cap show
    /// top-right for a couple of seconds after a change.
    /// </summary>
    public sealed class QualityPresets : MonoBehaviour
    {
        public enum Preset { Low, Medium, High, Ultra, Extreme }

        public Preset preset = Preset.High;
        [Tooltip("Frame-rate cap in fps; 0 for none.")]
        public int frameRateCap;

        static readonly int[] Caps = { 0, 60, 120, 144, 165, 240 };
        const float VolumeSearchInterval = 1f;

        float timeSinceApply = float.PositiveInfinity;
        float displayTimer;
        GUIStyle style;

        /// <summary>
        /// Adds the presets, the F3 overlay and the help when a scene with the city starts playing, so scenes
        /// made before they existed get them too.
        /// </summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void AddToScene()
        {
            if (FindAnyObjectByType<SolmarCity>() == null || FindAnyObjectByType<QualityPresets>() != null) return;
            var go = new GameObject("Game settings");
            go.AddComponent<QualityPresets>();
            go.AddComponent<PerformanceOverlay>();
            go.AddComponent<HelpOverlay>();
        }

        void OnEnable()
        {
            ApplyFrameRate();
            timeSinceApply = float.PositiveInfinity;
        }

        void Update()
        {
#if ENABLE_LEGACY_INPUT_MANAGER
            if (Input.GetKeyDown(KeyCode.F5))
            {
                preset = (Preset)(((int)preset + 1) % 5);
                timeSinceApply = float.PositiveInfinity;
                displayTimer = 2.5f;
            }
            if (Input.GetKeyDown(KeyCode.F6))
            {
                int i = System.Array.IndexOf(Caps, frameRateCap);
                frameRateCap = Caps[(i + 1) % Caps.Length];
                ApplyFrameRate();
                displayTimer = 2.5f;
            }
#endif
            if (displayTimer > 0f) displayTimer -= Time.unscaledDeltaTime;
            // The city can regenerate and replace its volume, so the preset is re-applied now and then.
            timeSinceApply += Time.unscaledDeltaTime;
            if (timeSinceApply >= VolumeSearchInterval)
            {
                timeSinceApply = 0f;
                ApplyPreset();
            }
        }

        void ApplyFrameRate()
        {
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = frameRateCap > 0 ? frameRateCap : -1;
        }

        void ApplyPreset()
        {
            int p = (int)preset;
            bool extreme = preset == Preset.Extreme;
            // HDRP's scalable levels: Low, Medium, High (Ultra and Extreme start from High).
            int level = Mathf.Min(p, (int)ScalableSettingLevelParameter.Level.High);
            QualitySettings.lodBias = new[] { 1f, 1.5f, 2f, 3f, 4f }[p];
            int primarySteps = new[] { 32, 48, 64, 96, 128 }[p];
            int lightSteps = new[] { 2, 4, 6, 8, 12 }[p];
            float shadowDistance = new[] { 120f, 160f, 220f, 350f, 500f }[p];

            foreach (Volume volume in FindObjectsByType<Volume>(FindObjectsSortMode.None))
            {
                VolumeProfile profile = volume.sharedProfile;
                if (profile == null) continue;
                foreach (VolumeComponent component in profile.components)
                {
                    if (component is VolumeComponentWithQuality q)
                    {
                        bool custom = extreme && (q is ScreenSpaceReflection || q is ScreenSpaceAmbientOcclusion || q is ContactShadows || q is Fog);
                        q.quality.levelAndOverride = (level, custom);
                        q.quality.overrideState = true;
                    }
                    switch (component)
                    {
                        case ScreenSpaceReflection ssr when extreme:
                            ssr.rayMaxIterations = 96;
                            break;
                        case ScreenSpaceAmbientOcclusion ao when extreme:
                            ao.stepCount = 32;
                            ao.fullResolution = true;
                            break;
                        case ContactShadows contact:
                            contact.enable.Override(preset != Preset.Low);
                            if (extreme) contact.sampleCount = 32;
                            break;
                        case Fog fog when extreme:
                            fog.volumetricFogBudget = 0.7f;
                            break;
                        case VolumetricClouds clouds:
                            clouds.numPrimarySteps.Override(primarySteps);
                            clouds.numLightSteps.Override(lightSteps);
                            break;
                        case HDShadowSettings shadows:
                            shadows.maxShadowDistance.Override(shadowDistance);
                            break;
                    }
                }
            }
        }

        void OnGUI()
        {
            if (displayTimer <= 0f) return;
            style ??= new GUIStyle(GUI.skin.label) { fontSize = 22, alignment = TextAnchor.UpperRight };
            string cap = frameRateCap > 0 ? frameRateCap + " fps cap" : "no fps cap";
            string text = preset + " quality · " + cap;
            var rect = new Rect(Screen.width - 520f, 16f, 500f, 40f);
            GUI.color = new Color(0f, 0f, 0f, 0.6f);
            GUI.Label(new Rect(rect.x + 2f, rect.y + 2f, rect.width, rect.height), text, style);
            GUI.color = Color.white;
            GUI.Label(rect, text, style);
        }
    }
}
