using System.Collections.Generic;
using System.IO;
using Solmar.City;
using Solmar.Rendering;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;
using UnityEngine.SceneManagement;

namespace Solmar.EditorTools
{
    /// <summary>
    /// Editor menu: sets up the HDRP asset for the city's look and builds the street scene
    /// (Solmar > Create Street Scene).
    /// </summary>
    public static class SolmarMenu
    {
        const string ScenePath = "Assets/Solmar/Scenes/Street.unity";
        const string ComputePath = "Assets/Solmar/Runtime/Shaders/ProceduralTextures.compute";

        /// <summary>Camera spots (position, target), the same as the browser version's.</summary>
        static readonly (string name, Vector3 position, Vector3 target)[] Spots =
        {
            ("Hero", new Vector3(22f, 1.35f, -3.4f), new Vector3(-40f, 3.2f, 1.2f)),
            ("Crossing", new Vector3(Layout.CrossingX + 16f, 1.65f, -Layout.KerbZ - 2.2f), new Vector3(Layout.CrossingX - 4f, 1.4f, 3f)),
            ("Puddle", new Vector3(8f, 0.45f, -4.5f), new Vector3(-25f, 2.5f, 0f)),
        };

        [MenuItem("Solmar/Create Street Scene", priority = 1)]
        public static void CreateStreetScene()
        {
            if (!ConfigurePipeline()) return;
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var cityGo = new GameObject("Solmar City");
            cityGo.SetActive(false);
            var city = cityGo.AddComponent<SolmarCity>();
            city.textureShader = AssetDatabase.LoadAssetAtPath<ComputeShader>(ComputePath);
            city.litShader = Shader.Find("HDRP/Lit");
            city.decalShader = Shader.Find("HDRP/Decal");
            if (city.textureShader == null) Debug.LogError("Solmar: " + ComputePath + " not found.");
            if (city.litShader == null || city.decalShader == null) Debug.LogError("Solmar: HDRP shaders not found. Is the High Definition Render Pipeline installed and active?");
            cityGo.SetActive(true);

            Camera cam = Atmosphere.CreateCamera(null, Spots[0].position, Spots[0].target);
            // Fly (right mouse + WASD), F to walk at eye level, F2 for a screenshot.
            cam.gameObject.AddComponent<FreeCamera>();
            cam.gameObject.AddComponent<PlayerWalker>();
            cam.gameObject.AddComponent<ScreenshotKey>();
            // [ and ] change the time of day, T fast-forwards.
            new GameObject("Time of day").AddComponent<TimeOfDay>();
            // Extra camera spots as empty markers: select one and use GameObject > Align View to Selected.
            var spots = new GameObject("Camera spots");
            foreach ((string name, Vector3 position, Vector3 target) in Spots)
            {
                var marker = new GameObject(name);
                marker.transform.SetParent(spots.transform, false);
                marker.transform.position = position;
                marker.transform.LookAt(target);
            }

            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            EditorSceneManager.SaveScene(scene, ScenePath);
            SceneView view = SceneView.lastActiveSceneView;
            if (view != null) view.AlignViewToObject(cam.transform);
        }

        /// <summary>
        /// Turns on the HDRP asset features the city's look depends on, which a new HDRP asset
        /// leaves off: screen-space reflections (also on glass), volumetric clouds and fog, decals,
        /// ambient occlusion, and 4096² directional shadows with PCSS filtering.
        /// </summary>
        [MenuItem("Solmar/Configure HDRP Asset", priority = 3)]
        public static bool ConfigurePipeline()
        {
            if (!(GraphicsSettings.currentRenderPipeline is HDRenderPipelineAsset asset))
            {
                Debug.LogError("Solmar: HDRP isn't the active render pipeline. Run Window > Rendering > HDRP Wizard and press Fix All, then try again.");
                return false;
            }
            RenderPipelineSettings s = asset.currentPlatformRenderPipelineSettings;
            var changed = new List<string>();
            void Enable(ref bool setting, string name)
            {
                if (setting) return;
                setting = true;
                changed.Add(name);
            }
            Enable(ref s.supportSSR, "screen space reflections");
            Enable(ref s.supportSSRTransparent, "screen space reflections on transparents");
            Enable(ref s.supportTransparentDepthPrepass, "transparent depth prepass");
            Enable(ref s.supportVolumetrics, "volumetric fog");
            Enable(ref s.supportVolumetricClouds, "volumetric clouds");
            Enable(ref s.supportDecals, "decals");
            Enable(ref s.supportSSAO, "screen space ambient occlusion");
            if (s.hdShadowInitParams.maxDirectionalShadowMapResolution < 4096)
            {
                s.hdShadowInitParams.maxDirectionalShadowMapResolution = 4096;
                changed.Add("directional shadow resolution 4096");
            }
            if (s.hdShadowInitParams.directionalShadowFilteringQuality != HDShadowFilteringQuality.High)
            {
                s.hdShadowInitParams.directionalShadowFilteringQuality = HDShadowFilteringQuality.High;
                changed.Add("high quality (PCSS) directional shadow filtering");
            }
            if (changed.Count > 0)
            {
                asset.currentPlatformRenderPipelineSettings = s;
                EditorUtility.SetDirty(asset);
                AssetDatabase.SaveAssetIfDirty(asset);
                Debug.Log("Solmar: enabled in " + asset.name + ": " + string.Join(", ", changed) + ".", asset);
            }
            return true;
        }

        [MenuItem("Solmar/Regenerate City", priority = 2)]
        public static void Regenerate()
        {
            foreach (SolmarCity city in Object.FindObjectsByType<SolmarCity>(FindObjectsSortMode.None)) city.Regenerate();
        }
    }
}
