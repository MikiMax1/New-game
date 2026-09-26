using System.Collections.Generic;
using System.IO;
using Solmar.City.Roads;
using Solmar.Rendering;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Solmar.EditorTools
{
    /// <summary>
    /// Editor menu: builds the city scene (Solmar > Create City Scene), the same way SolmarMenu
    /// builds the single street scene, saves it as Assets/Solmar/Scenes/City.unity, makes it the
    /// first scene in the build settings (the one a build starts in) and opens it.
    /// </summary>
    public static class SolmarDistrictMenu
    {
        const string ScenePath = "Assets/Solmar/Scenes/City.unity";
        const string ComputePath = "Assets/Solmar/Runtime/Shaders/ProceduralTextures.compute";

        [MenuItem("Solmar/Create City Scene", priority = 11)]
        public static void CreateCityScene()
        {
            if (!SolmarMenu.ConfigurePipeline()) return;
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var districtGo = new GameObject("Solmar City");
            districtGo.SetActive(false);
            var district = districtGo.AddComponent<SolmarDistrict>();
            district.textureShader = AssetDatabase.LoadAssetAtPath<ComputeShader>(ComputePath);
            district.litShader = Shader.Find("HDRP/Lit");
            district.decalShader = Shader.Find("HDRP/Decal");
            if (district.textureShader == null) Debug.LogError("Solmar: " + ComputePath + " not found.");
            if (district.litShader == null || district.decalShader == null) Debug.LogError("Solmar: HDRP shaders not found. Is the High Definition Render Pipeline installed and active?");
            districtGo.SetActive(true);

            // Behind and above the player's spawn, looking along the street they start on.
            Pose spawn = SolmarDistrict.PlayerSpawn;
            Vector3 along = Vector3.Cross(Vector3.up, spawn.forward);
            if (along.sqrMagnitude < 1e-4f) along = Vector3.forward;
            along.Normalize();
            Vector3 position = spawn.position - along * 45f - spawn.forward * 12f + Vector3.up * 24f;
            Vector3 target = spawn.position + along * 40f + Vector3.up * 2f;
            Camera cam = Atmosphere.CreateCamera(null, position, target);
            // Fly (right mouse + WASD), F to walk at eye level, F2 for a screenshot.
            cam.gameObject.AddComponent<FreeCamera>();
            cam.gameObject.AddComponent<PlayerWalker>();
            cam.gameObject.AddComponent<ScreenshotKey>();
            // [ and ] change the time of day, T fast-forwards.
            new GameObject("Time of day").AddComponent<TimeOfDay>();

            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            EditorSceneManager.SaveScene(scene, ScenePath);
            MakeFirstInBuild(ScenePath);
            // Saving made the new scene the asset that is open; open it only if that somehow failed
            // (opening again would build the whole city a second time).
            if (SceneManager.GetActiveScene().path != ScenePath)
            {
                EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
                cam = Camera.main;
            }
            SceneView view = SceneView.lastActiveSceneView;
            if (view != null && cam != null) view.AlignViewToObject(cam.transform);
        }

        /// <summary>Puts `path` first in the build's scene list, keeping the others after it.</summary>
        static void MakeFirstInBuild(string path)
        {
            var scenes = new List<EditorBuildSettingsScene> { new EditorBuildSettingsScene(path, true) };
            foreach (EditorBuildSettingsScene s in EditorBuildSettings.scenes)
            {
                if (s == null || string.IsNullOrEmpty(s.path) || s.path == path) continue;
                scenes.Add(s);
            }
            EditorBuildSettings.scenes = scenes.ToArray();
        }
    }
}
