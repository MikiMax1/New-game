using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar.Rendering
{
    /// <summary>
    /// Daylight and the camera's optics, in HDRP's physical units:
    ///
    ///   sky        Physically Based Sky (Rayleigh, Mie and ozone scattering, multiple scattering),
    ///              volumetric clouds, and volumetric fog so the low sun shafts down the street
    ///   sun        a directional light at golden hour; HDRP dims and reddens it through the
    ///              atmosphere. 4096² soft shadows (PCSS on high quality), contact shadows
    ///   exposure   automatic (histogram), +0.26 EV compensation (×1.2), ACES tone mapping
    ///   camera     SSR, GTAO, bloom (intensity 0.15, scatter 0.4, threshold 0.85), depth of field,
    ///              chromatic aberration, vignette, film grain, a warm split-tone grade
    ///   probe      a realtime reflection probe at street level, so reflections include the city
    /// </summary>
    public static class Atmosphere
    {
        /// <summary>Unit vector towards the sun for an elevation and azimuth in degrees.</summary>
        public static Vector3 SunDirection(float elevation, float azimuth)
        {
            float el = elevation * Mathf.Deg2Rad;
            float az = azimuth * Mathf.Deg2Rad;
            return new Vector3(Mathf.Cos(el) * Mathf.Cos(az), Mathf.Sin(el), Mathf.Cos(el) * Mathf.Sin(az)).normalized;
        }

        /// <summary>The sun: a directional light shining along -towardsSun.</summary>
        public static Light CreateSun(Transform parent, Vector3 towardsSun)
        {
            var go = new GameObject("Sun");
            go.transform.SetParent(parent, false);
            go.transform.rotation = Quaternion.LookRotation(-towardsSun, Vector3.up);
            var light = go.AddComponent<Light>();
            light.type = LightType.Directional;
            var hd = go.AddComponent<HDAdditionalLightData>();
            // HDRP's defaults for a scripted light (lux, shadow biases), as its AddHDLight does.
            HDAdditionalLightData.InitDefaultHDAdditionalLightData(hd);
            // Illuminance above the atmosphere; HDRP attenuates it along the sun's path through the
            // physically based sky, which is what turns it golden this low.
            light.lightUnit = LightUnit.Lux;
            light.intensity = 120000f;
            light.useColorTemperature = true;
            light.colorTemperature = 5900f;
            light.shadows = LightShadows.Soft;
            hd.shadowResolution.useOverride = true;
            hd.shadowResolution.@override = 4096;
            hd.useContactShadow.useOverride = true;
            hd.useContactShadow.@override = true;
            return light;
        }

        /// <summary>The global volume: sky, fog, exposure, tone mapping and camera effects.</summary>
        public static Volume CreateVolume(Transform parent, out VolumeProfile profile)
        {
            var go = new GameObject("Atmosphere and camera");
            go.transform.SetParent(parent, false);
            var volume = go.AddComponent<Volume>();
            volume.isGlobal = true;
            volume.priority = 10f;
            profile = ScriptableObject.CreateInstance<VolumeProfile>();
            profile.name = "Solmar golden hour";
            profile.hideFlags = HideFlags.DontSave;
            volume.sharedProfile = profile;

            var env = profile.Add<VisualEnvironment>(true);
            env.skyType.Override((int)SkyType.PhysicallyBased);
            env.skyAmbientMode.Override(SkyAmbientMode.Dynamic);
            profile.Add<PhysicallyBasedSky>(true);

            // Add(..., true) overrides every parameter, so the values the preset writes take effect.
            var clouds = profile.Add<VolumetricClouds>(true);
            clouds.enable.Override(true);
            clouds.cloudPreset = VolumetricClouds.CloudPresets.Sparse;

            var fog = profile.Add<Fog>(true);
            fog.enabled.Override(true);
            fog.meanFreePath.Override(420f);
            fog.baseHeight.Override(0f);
            fog.maximumHeight.Override(140f);
            fog.enableVolumetricFog.Override(true);
            fog.albedo.Override(new Color(0.96f, 0.93f, 0.88f));
            fog.anisotropy.Override(0.72f);

            var exposure = profile.Add<Exposure>(true);
            exposure.mode.Override(ExposureMode.AutomaticHistogram);
            exposure.compensation.Override(Mathf.Log(1.2f, 2f));
            exposure.limitMin.Override(8f);
            exposure.limitMax.Override(16f);

            var tone = profile.Add<Tonemapping>(true);
            tone.mode.Override(TonemappingMode.ACES);

            var bloom = profile.Add<Bloom>(true);
            bloom.intensity.Override(0.15f);
            bloom.scatter.Override(0.4f);
            bloom.threshold.Override(0.85f);

            var ssr = profile.Add<ScreenSpaceReflection>(true);
            ssr.enabled.Override(true);
            ssr.enabledTransparent.Override(true);
            // HDRP only traces surfaces smoother than 0.9 by default; the damp asphalt is rougher.
            ssr.minSmoothness = 0.35f;
            ssr.smoothnessFadeStart = 0.45f;

            var ao = profile.Add<ScreenSpaceAmbientOcclusion>(true);
            ao.intensity.Override(1.1f);
            ao.radius.Override(1.4f);

            var contact = profile.Add<ContactShadows>(true);
            contact.enable.Override(true);
            contact.length.Override(0.25f);

            var shadows = profile.Add<HDShadowSettings>(true);
            shadows.maxShadowDistance.Override(220f);

            var dof = profile.Add<DepthOfField>(true);
            dof.focusMode.Override(DepthOfFieldMode.Manual);
            dof.nearFocusStart.Override(0.05f);
            dof.nearFocusEnd.Override(0.6f);
            dof.farFocusStart.Override(45f);
            dof.farFocusEnd.Override(400f);

            var ca = profile.Add<ChromaticAberration>(true);
            ca.intensity.Override(0.06f);

            var vignette = profile.Add<Vignette>(true);
            vignette.intensity.Override(0.22f);
            vignette.smoothness.Override(0.45f);

            var grain = profile.Add<FilmGrain>(true);
            grain.type.Override(FilmGrainLookup.Thin1);
            grain.intensity.Override(0.12f);
            grain.response.Override(0.8f);

            var white = profile.Add<WhiteBalance>(true);
            white.temperature.Override(6f);

            var adjust = profile.Add<ColorAdjustments>(true);
            adjust.contrast.Override(8f);
            adjust.saturation.Override(4f);

            var split = profile.Add<SplitToning>(true);
            split.shadows.Override(new Color(0.46f, 0.5f, 0.56f));
            split.highlights.Override(new Color(0.58f, 0.52f, 0.44f));
            split.balance.Override(10f);

            return volume;
        }

        /// <summary>
        /// A realtime reflection probe at street level covering the street canyon, re-rendered when
        /// enabled: reflections in the wet road, glass and paint include the buildings.
        /// </summary>
        public static ReflectionProbe CreateProbe(Transform parent, Vector3 position, Vector3 size)
        {
            var go = new GameObject("Street reflection probe");
            go.transform.SetParent(parent, false);
            go.transform.position = position;
            var probe = go.AddComponent<ReflectionProbe>();
            probe.size = size;
            var hd = go.GetComponent<HDAdditionalReflectionData>();
            if (hd == null) hd = go.AddComponent<HDAdditionalReflectionData>();
            hd.mode = ProbeSettings.Mode.Realtime;
            hd.realtimeMode = ProbeSettings.RealtimeMode.OnEnable;
            hd.influenceVolume.shape = InfluenceShape.Box;
            hd.influenceVolume.boxSize = size;
            return probe;
        }

        /// <summary>A physical camera: 35 mm on full frame, temporal anti-aliasing.</summary>
        public static Camera CreateCamera(Transform parent, Vector3 position, Vector3 target)
        {
            var go = new GameObject("Camera");
            go.tag = "MainCamera";
            go.transform.SetParent(parent, false);
            go.transform.position = position;
            go.transform.LookAt(target);
            var cam = go.AddComponent<Camera>();
            cam.nearClipPlane = 0.1f;
            cam.farClipPlane = 4000f;
            cam.usePhysicalProperties = true;
            cam.sensorSize = new Vector2(36f, 24f);
            cam.focalLength = 35f;
            cam.gateFit = Camera.GateFitMode.Horizontal;
            var hd = go.AddComponent<HDAdditionalCameraData>();
            hd.antialiasing = HDAdditionalCameraData.AntialiasingMode.TemporalAntialiasing;
            return cam;
        }
    }
}
