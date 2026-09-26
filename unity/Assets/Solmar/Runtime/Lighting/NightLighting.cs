using System.Collections.Generic;
using Solmar.City;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar.Lighting
{
    /// <summary>
    /// Turns the city's night lighting on and off as the sun crosses the horizon: real HDRP spot
    /// lights at every street lamp's luminaire, a glow on lit window rooms and shopfronts, and a
    /// lower exposure floor so the street reads dark but not black. Driven purely by the "Sun"
    /// light's elevation (whatever set its rotation - TimeOfDay in Play mode, or the city's own
    /// sunElevation field in the editor), so it needs no changes to either.
    ///
    /// Lights are off with the sun above <see cref="fullDayElevation"/> (about 3 degrees, matching
    /// the "T" key / TimeOfDay's comment that dusk starts turning the lamps on), fade in through
    /// twilight, and are fully on at or below <see cref="fullNightElevation"/>.
    ///
    /// Bootstrapped once into any Play-mode scene with a SolmarCity, the same way QualityPresets
    /// is; add the component to a scene yourself (it is [ExecuteAlways]) to see it work in the
    /// editor too. It re-finds the generated street lamps and building materials once a second,
    /// since the city can regenerate and replace them.
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class NightLighting : MonoBehaviour
    {
        [Header("Twilight")]
        [Tooltip("Sun elevation, degrees, at and above which every night light is off.")]
        public float fullDayElevation = 3f;
        [Tooltip("Sun elevation, degrees, at and below which every night light is fully on.")]
        public float fullNightElevation = -6f;

        [Header("Street lamps")]
        [Tooltip("Luminous flux of one lamp head once fully on.")]
        public float lampLumens = 12000f;
        [Tooltip("LED colour temperature, kelvin.")]
        [Range(2700f, 4000f)] public float lampKelvin = 3200f;
        [Tooltip("How many of the lamps nearest the camera cast shadows; the rest don't, for performance.")]
        public int maxShadowCastingLamps = 6;
        [Tooltip("Lamps farther than this from the camera skip contributing to volumetric fog.")]
        public float lampVolumetricRange = 90f;

        [Header("Exposure")]
        [Tooltip("Volume exposure limitMin (EV100) by day.")]
        public float dayExposureLimitMin = 8f;
        [Tooltip("Volume exposure limitMin (EV100) by night: low enough to read as dark, high enough to stay readable.")]
        public float nightExposureLimitMin = -2f;

        const string SunName = "Sun";
        const string GeneratedCityName = "Generated city";
        const string StreetFurnitureName = "Street furniture";
        const string StreetLampsName = "Street lamps";
        const string BuildingsName = "Buildings";
        const string VolumeName = "Atmosphere and camera";
        const string LampLightName = "Night light";
        const float RescanInterval = 1f;

        // The exact colours Buildings.cs and StreetFurniture.cs bake their emissive materials from;
        // CityMaterials names each one "Emissive " + its hex, so matching on that name finds the
        // very material every lit room, shopfront or lamp lens in the city shares, with no need to
        // touch those files.
        static readonly Color LensOffColor = new Color(0.3f, 0.3f, 0.28f);
        static readonly Color LampWarmColor = new Color(1f, 0.89f, 0.72f);
        static readonly Color RoomLitColor = new Color(1f, 0.78f, 0.55f);
        static readonly Color ShopRoomColor = new Color(1f, 0.93f, 0.84f);
        static readonly Color PanelColor = new Color(1f, 0.9f, 0.78f);

        const float RoomLitDayNits = 35f, RoomLitNightNits = 300f;
        const float ShopRoomDayNits = 90f, ShopRoomNightNits = 550f;
        const float PanelDayNits = 1400f, PanelNightNits = 3600f;
        const float LampMaxNits = 30000f;

        Light sun;
        Exposure exposure;
        Camera cam;

        Material lensMaterial;
        Material roomLitMaterial;
        Material shopRoomMaterial;
        Material panelMaterial;

        readonly List<Light> lampLights = new List<Light>();
        readonly List<HDAdditionalLightData> lampData = new List<HDAdditionalLightData>();
        float[] nearestDistanceSq;
        int[] nearestIndex;

        float timeSinceScan = float.PositiveInfinity;

        /// <summary>0 (day) to 1 (full night), smoothed across twilight. Read by anything else that
        /// wants to fade in with the street lights (none yet; exposed for convenience).</summary>
        public float NightAmount { get; private set; }

        /// <summary>
        /// Adds night lighting to any Play-mode scene that has a SolmarCity, so scenes made before
        /// this existed get it too (mirrors QualityPresets.AddToScene).
        /// </summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void AddToScene()
        {
            if (FindAnyObjectByType<SolmarCity>() == null || FindAnyObjectByType<NightLighting>() != null) return;
            new GameObject("Night lighting").AddComponent<NightLighting>();
        }

        void Update()
        {
            float dt = Time.unscaledDeltaTime;
            timeSinceScan += dt;
            if (sun == null || timeSinceScan >= RescanInterval)
            {
                Rescan();
                timeSinceScan = 0f;
            }
            if (sun == null) return;

            float elevation = SunElevationDegrees(sun);
            float t = Mathf.InverseLerp(fullDayElevation, fullNightElevation, elevation);
            t = t * t * (3f - 2f * t); // smoothstep, so the fade isn't linear-flat at the ends
            NightAmount = t;

            ApplyLamps(t);
            ApplyWindows(t);
            ApplyExposure(t);
            // Keep the flag StreetFurniture bakes new lamp lenses from in step with reality, for
            // whatever regenerates the city next.
            StreetFurniture.LampsOn = t > 0.5f;
        }

        /// <summary>The sun's elevation above the horizon, from the light's own rotation (however it
        /// got there), clamped so a straight-up or straight-down light can't produce a NaN.</summary>
        static float SunElevationDegrees(Light sun)
        {
            float sinElevation = Mathf.Clamp(-sun.transform.forward.y, -1f, 1f);
            return Mathf.Asin(sinElevation) * Mathf.Rad2Deg;
        }

        void Rescan()
        {
            SolmarCity city = FindAnyObjectByType<SolmarCity>();
            Transform root = city != null ? city.transform.Find(GeneratedCityName) : null;

            sun = FindSun();
            FindLamps(root);
            FindBuildingMaterials(root);
            FindExposure(root);
            if (cam == null) cam = Camera.main;
            if (cam == null) cam = FindAnyObjectByType<Camera>();
        }

        static Light FindSun()
        {
            foreach (Light light in FindObjectsByType<Light>(FindObjectsSortMode.None))
            {
                if (light.type == LightType.Directional && light.name == SunName) return light;
            }
            return null;
        }

        void FindLamps(Transform root)
        {
            lampLights.Clear();
            lampData.Clear();
            lensMaterial = null;
            if (root == null) return;

            Transform furniture = root.Find(StreetFurnitureName);
            Transform group = furniture != null ? furniture.Find(StreetLampsName) : null;
            if (group == null) return;

            for (int i = 0; i < group.childCount; i++)
            {
                Transform lamp = group.GetChild(i);
                var renderer = lamp.GetComponent<MeshRenderer>();
                if (renderer == null) continue;

                if (lensMaterial == null)
                {
                    lensMaterial = FindLensMaterial(renderer);
                    if (lensMaterial != null) EnsureLensIsEmissive(lensMaterial);
                }

                Transform lightTransform = lamp.Find(LampLightName);
                Light light = lightTransform != null ? lightTransform.GetComponent<Light>() : null;
                HDAdditionalLightData hd = lightTransform != null ? lightTransform.GetComponent<HDAdditionalLightData>() : null;
                if (light == null || hd == null) CreateLampLight(lamp, out light, out hd);
                if (light == null || hd == null) continue;

                lampLights.Add(light);
                lampData.Add(hd);
            }
        }

        /// <summary>The lens material shared by every lamp, whichever slot it lives in: the dark
        /// "off" material baked when the city was generated, or an already-emissive one.</summary>
        static Material FindLensMaterial(Renderer renderer)
        {
            string offName = "Painted " + ColorUtility.ToHtmlStringRGB(LensOffColor);
            string onName = "Emissive " + ColorUtility.ToHtmlStringRGB(LampWarmColor);
            foreach (Material m in renderer.sharedMaterials)
            {
                if (m == null) continue;
                if (m.name == offName || m.name == onName) return m;
            }
            return null;
        }

        static void EnsureLensIsEmissive(Material m)
        {
            if (HDMaterial.GetUseEmissiveIntensity(m)) return;
            HDMaterial.SetUseEmissiveIntensity(m, true);
            HDMaterial.SetEmissiveColor(m, LampWarmColor);
            HDMaterial.SetEmissiveIntensity(m, 0f, EmissiveIntensityUnit.Nits);
            HDMaterial.ValidateMaterial(m);
        }

        /// <summary>A real HDRP spot light at the luminaire (local y=8.9, 2.3 m out over the road,
        /// matching FurnitureParts.StreetLamp's lens), pointing straight down: the lamp only ever
        /// rotates about y, so local -y is world -y regardless of which side of the street it's on.</summary>
        void CreateLampLight(Transform lamp, out Light light, out HDAdditionalLightData hd)
        {
            var go = new GameObject(LampLightName) { hideFlags = HideFlags.DontSave };
            go.transform.SetParent(lamp, false);
            go.transform.localPosition = new Vector3(0f, 8.9f, 2.3f);
            go.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);

            light = go.AddComponent<Light>();
            light.type = LightType.Spot;
            hd = go.AddComponent<HDAdditionalLightData>();
            HDAdditionalLightData.InitDefaultHDAdditionalLightData(hd);

            light.range = 22f;
            light.color = Color.white;
            light.useColorTemperature = true;
            light.colorTemperature = lampKelvin;
            light.lightUnit = LightUnit.Lumen;
            light.intensity = 0f;
            light.shadows = LightShadows.None;
            light.enabled = false;

            hd.SetSpotAngle(100f, 55f);
            hd.affectsVolumetric = true;
            hd.volumetricDimmer = 1f;
            hd.EnableShadows(false);
            hd.shadowResolution.useOverride = true;
            hd.shadowResolution.@override = 512;
            hd.SetShadowDimmer(0.85f);
        }

        void FindBuildingMaterials(Transform root)
        {
            roomLitMaterial = null;
            shopRoomMaterial = null;
            panelMaterial = null;
            if (root == null) return;
            Transform buildings = root.Find(BuildingsName);
            if (buildings == null) return;

            string roomLitName = "Emissive " + ColorUtility.ToHtmlStringRGB(RoomLitColor);
            string shopRoomName = "Emissive " + ColorUtility.ToHtmlStringRGB(ShopRoomColor);
            string panelName = "Emissive " + ColorUtility.ToHtmlStringRGB(PanelColor);
            foreach (MeshRenderer renderer in buildings.GetComponentsInChildren<MeshRenderer>(true))
            {
                foreach (Material m in renderer.sharedMaterials)
                {
                    if (m == null) continue;
                    if (roomLitMaterial == null && m.name == roomLitName) roomLitMaterial = m;
                    else if (shopRoomMaterial == null && m.name == shopRoomName) shopRoomMaterial = m;
                    else if (panelMaterial == null && m.name == panelName) panelMaterial = m;
                }
            }
        }

        void FindExposure(Transform root)
        {
            exposure = null;
            if (root == null) return;
            Transform volumeTransform = root.Find(VolumeName);
            Volume volume = volumeTransform != null ? volumeTransform.GetComponent<Volume>() : null;
            VolumeProfile profile = volume != null ? volume.sharedProfile : null;
            if (profile != null) profile.TryGet(out exposure);
        }

        void ApplyLamps(float t)
        {
            if (lensMaterial != null)
            {
                HDMaterial.SetEmissiveIntensity(lensMaterial, Mathf.Lerp(0f, LampMaxNits, t), EmissiveIntensityUnit.Nits);
            }

            int n = lampLights.Count;
            if (n == 0) return;

            int shadowSlots = Mathf.Max(0, maxShadowCastingLamps);
            if (nearestDistanceSq == null || nearestDistanceSq.Length != shadowSlots)
            {
                nearestDistanceSq = new float[shadowSlots];
                nearestIndex = new int[shadowSlots];
            }
            for (int j = 0; j < shadowSlots; j++)
            {
                nearestDistanceSq[j] = float.PositiveInfinity;
                nearestIndex[j] = -1;
            }

            bool on = t > 0.001f;
            float lumens = lampLumens * t;
            Vector3 camPos = cam != null ? cam.transform.position : Vector3.zero;
            float volumetricRangeSq = lampVolumetricRange * lampVolumetricRange;

            for (int i = 0; i < n; i++)
            {
                Light light = lampLights[i];
                HDAdditionalLightData hd = lampData[i];
                if (light == null || hd == null) continue;

                light.enabled = on;
                light.intensity = lumens;
                light.colorTemperature = lampKelvin;
                hd.EnableShadows(false);
                if (!on) continue;

                float dSq = (light.transform.position - camPos).sqrMagnitude;
                if (float.IsNaN(dSq) || float.IsInfinity(dSq)) dSq = float.MaxValue;
                hd.affectsVolumetric = dSq <= volumetricRangeSq;

                if (shadowSlots > 0 && dSq < nearestDistanceSq[shadowSlots - 1])
                {
                    int insertAt = shadowSlots - 1;
                    while (insertAt > 0 && nearestDistanceSq[insertAt - 1] > dSq)
                    {
                        nearestDistanceSq[insertAt] = nearestDistanceSq[insertAt - 1];
                        nearestIndex[insertAt] = nearestIndex[insertAt - 1];
                        insertAt--;
                    }
                    nearestDistanceSq[insertAt] = dSq;
                    nearestIndex[insertAt] = i;
                }
            }

            for (int j = 0; j < shadowSlots; j++)
            {
                int idx = nearestIndex[j];
                if (idx >= 0) lampData[idx].EnableShadows(true);
            }
        }

        void ApplyWindows(float t)
        {
            SetEmissive(roomLitMaterial, RoomLitDayNits, RoomLitNightNits, t);
            SetEmissive(shopRoomMaterial, ShopRoomDayNits, ShopRoomNightNits, t);
            SetEmissive(panelMaterial, PanelDayNits, PanelNightNits, t);
        }

        static void SetEmissive(Material m, float dayNits, float nightNits, float t)
        {
            if (m == null) return;
            HDMaterial.SetEmissiveIntensity(m, Mathf.Lerp(dayNits, nightNits, t), EmissiveIntensityUnit.Nits);
        }

        void ApplyExposure(float t)
        {
            if (exposure == null) return;
            exposure.limitMin.value = Mathf.Lerp(dayExposureLimitMin, nightExposureLimitMin, t);
        }
    }
}
