using System.Collections.Generic;
using Solmar.City.Roads;
using Solmar.Rendering;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar.Weather
{
    /// <summary>
    /// Wires Weather's Rain/Cloud/Wetness onto the scene: the sun dims and volumetric clouds and fog
    /// thicken as the sky clouds over, and the road, pavement and kerb materials CityMaterials baked
    /// dry get their smoothness, clear coat and a slight darkening turned up as they get wet, with the
    /// puddle decals fading in only once the street is properly wet and out again as it dries. Nothing
    /// here is a MonoBehaviour: Weather owns the instance and drives Rescan/Apply itself, the same
    /// shape NightLighting uses for its own re-find-every-second bookkeeping.
    /// </summary>
    public sealed class WeatherVisuals
    {
        const string SunName = "Sun";
        const string GeneratedCityName = "Generated city";
        const string GeneratedDistrictName = "Generated district";
        const string VolumeName = "Atmosphere and camera";

        // Mirrors CityMaterials' dry smoothness ceilings, so Weather picks up exactly where the
        // baked-dry material left off with no visible pop the moment it starts running.
        const float RoadDryMax = 0.22f, RoadWetMax = 0.94f, RoadWetCoat = 1f;
        const float PavementDryMax = 0.4f, PavementWetMax = 0.7f, PavementWetCoat = 0.5f;
        const float KerbDryMax = 0.55f, KerbWetMax = 0.8f, KerbWetCoat = 0.4f;
        static readonly Color WetDarken = new Color(0.62f, 0.62f, 0.64f);

        const float BaseSunLux = 120000f;
        const float FlashDuration = 0.12f;
        const float FlashPeak = 7f;

        const float ClearFreePath = 900f, StormyFreePath = 110f;
        const float ClearCloudDensity = 0.22f, StormyCloudDensity = 0.95f;

        Light sun;
        VolumetricClouds clouds;
        Fog fog;

        Material road, pavement, kerb;
        readonly List<Material> puddles = new List<Material>();
        bool coatReady;

        float flashTimer;

        /// <summary>0 (flat) to 90 (overhead), from the sun's own rotation; used by Weather to speed
        /// up drying in direct sunlight.</summary>
        public float SunElevationDegrees { get; private set; }

        /// <summary>Re-finds the sun, the scene's atmosphere volume and the shared road materials.
        /// Cheap enough to call every second or so; the city can regenerate and replace all of them.</summary>
        public void Rescan()
        {
            sun = FindSun();
            FindVolume();
            FindMaterials();
        }

        static Light FindSun()
        {
            foreach (Light light in Object.FindObjectsByType<Light>(FindObjectsSortMode.None))
            {
                if (light.type == LightType.Directional && light.name == SunName) return light;
            }
            return null;
        }

        void FindVolume()
        {
            clouds = null;
            fog = null;
            Transform root = FindGeneratedRoot();
            Transform volumeTransform = root != null ? root.Find(VolumeName) : null;
            Volume volume = volumeTransform != null ? volumeTransform.GetComponent<Volume>() : null;
            VolumeProfile profile = volume != null ? volume.sharedProfile : null;
            if (profile == null) return;
            profile.TryGet(out clouds);
            profile.TryGet(out fog);
        }

        static Transform FindGeneratedRoot()
        {
            var city = Object.FindAnyObjectByType<SolmarCity>();
            if (city != null)
            {
                Transform root = city.transform.Find(GeneratedCityName);
                if (root != null) return root;
            }
            var district = Object.FindAnyObjectByType<SolmarDistrict>();
            if (district != null) return district.transform.Find(GeneratedDistrictName);
            return null;
        }

        void FindMaterials()
        {
            Material newRoad = null, newPavement = null, newKerb = null;
            puddles.Clear();
            foreach (Material m in Resources.FindObjectsOfTypeAll<Material>())
            {
                if (m == null) continue;
                switch (m.name)
                {
                    case "Asphalt road": newRoad = m; break;
                    case "Pavement": newPavement = m; break;
                    case "Granite kerb": newKerb = m; break;
                    default:
                        if (m.name.StartsWith("Puddle ")) puddles.Add(m);
                        break;
                }
            }
            if (newRoad != road || newPavement != pavement || newKerb != kerb) coatReady = false;
            road = newRoad;
            pavement = newPavement;
            kerb = newKerb;
        }

        /// <summary>The clear coat keyword only switches on when the shader is validated with a
        /// non-zero _CoatMask; do that once per material instance, then just push the float every
        /// frame from Apply (cheap; ValidateMaterial is not).</summary>
        void EnsureCoatEnabled()
        {
            if (coatReady) return;
            EnableCoat(road);
            EnableCoat(pavement);
            EnableCoat(kerb);
            coatReady = true;
        }

        static void EnableCoat(Material m)
        {
            if (m == null) return;
            m.SetFloat("_CoatMask", 0.001f);
            HDMaterial.ValidateMaterial(m);
        }

        /// <summary>Applies the current wetness/cloud amount to every surface and to the sky, and
        /// decays any lightning flash still in progress.</summary>
        public void Apply(float wetness, float cloud, float dt)
        {
            EnsureCoatEnabled();
            ApplySurface(road, RoadDryMax, RoadWetMax, RoadWetCoat, wetness);
            ApplySurface(pavement, PavementDryMax, PavementWetMax, PavementWetCoat, wetness);
            ApplySurface(kerb, KerbDryMax, KerbWetMax, KerbWetCoat, wetness);

            // Standing water only once the street is properly wet, not from the first drops.
            float puddleVisible = Mathf.Clamp01((wetness - 0.45f) / 0.35f);
            for (int i = 0; i < puddles.Count; i++)
            {
                if (puddles[i] != null) puddles[i].SetFloat("_DecalBlend", puddleVisible);
            }

            if (clouds != null)
            {
                clouds.densityMultiplier.value = Mathf.Lerp(ClearCloudDensity, StormyCloudDensity, cloud);
            }
            if (fog != null)
            {
                fog.meanFreePath.value = Mathf.Lerp(ClearFreePath, StormyFreePath, cloud);
            }

            if (flashTimer > 0f) flashTimer = Mathf.Max(0f, flashTimer - dt);
            if (sun != null)
            {
                SunElevationDegrees = ElevationDegrees(sun);
                float dim = Mathf.Lerp(1f, 0.16f, cloud);
                float flash = flashTimer > 0f ? FlashPeak * (flashTimer / FlashDuration) : 0f;
                sun.intensity = BaseSunLux * (dim + flash);
            }
        }

        /// <summary>A brief bright pulse of the sun light: lightning, for Weather's thunderstorm timer.</summary>
        public void Flash()
        {
            flashTimer = FlashDuration;
        }

        static void ApplySurface(Material m, float dryMax, float wetMax, float wetCoat, float wetness)
        {
            if (m == null) return;
            m.SetFloat("_SmoothnessRemapMin", Mathf.Lerp(0f, 0.05f, wetness));
            m.SetFloat("_SmoothnessRemapMax", Mathf.Lerp(dryMax, wetMax, wetness));
            m.SetFloat("_CoatMask", Mathf.Lerp(0.001f, wetCoat, Mathf.Clamp01((wetness - 0.1f) / 0.9f)));
            m.SetColor("_BaseColor", Color.Lerp(Color.white, WetDarken, wetness * 0.6f));
        }

        /// <summary>Sun elevation above the horizon in degrees, guarded the same way NightLighting
        /// guards it: clamp before asin so a straight up-or-down light can never produce a NaN.</summary>
        static float ElevationDegrees(Light light)
        {
            float sinElevation = Mathf.Clamp(-light.transform.forward.y, -1f, 1f);
            return Mathf.Asin(sinElevation) * Mathf.Rad2Deg;
        }
    }
}
