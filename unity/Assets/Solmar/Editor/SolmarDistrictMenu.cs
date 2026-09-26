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
    /// Editor menu: builds the downtown grid district scene (Solmar > Create District Scene), the
    /// same way SolmarMenu builds the single street scene.
    /// </summary>
    public static class SolmarDistrictMenu
    {
        const string ScenePath = "Assets/Solmar/Scenes/District.unity";
        const string ComputePath = "Assets/Solmar/Runtime/Shaders/ProceduralTextures.compute";

        [MenuItem("Solmar/Create District Scene", priority = 11)]
        public static void CreateDistrictScene()
        {
            if (!SolmarMenu.ConfigurePipeline()) return;
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var districtGo = new GameObject("Solmar District");
            districtGo.SetActive(false);
            var district = districtGo.AddComponent<SolmarDistrict>();
            district.textureShader = AssetDatabase.LoadAssetAtPath<ComputeShader>(ComputePath);
            district.litShader = Shader.Find("HDRP/Lit");
            district.decalShader = Shader.Find("HDRP/Decal");
            if (district.textureShader == null) Debug.LogError("Solmar: " + ComputePath + " not found.");
            if (district.litShader == null || district.decalShader == null) Debug.LogError("Solmar: HDRP shaders not found. Is the High Definition Render Pipeline installed and active?");
            districtGo.SetActive(true);

            // A hero shot over the avenue crossing near the middle of the district, looking down its length.
            float avenueX = DistrictGenerator.AvenueColumn * DistrictGenerator.BlockLengthX;
            float midZ = DistrictGenerator.BlockLengthZ * (DistrictGenerator.Rows - 1) * 0.5f;
            var position = new Vector3(avenueX - 30f, 22f, midZ - 60f);
            var target = new Vector3(avenueX, 2f, midZ);
            Camera cam = Atmosphere.CreateCamera(null, position, target);
            // Fly (right mouse + WASD), F to walk at eye level, F2 for a screenshot.
            cam.gameObject.AddComponent<FreeCamera>();
            cam.gameObject.AddComponent<PlayerWalker>();
            cam.gameObject.AddComponent<ScreenshotKey>();
            // [ and ] change the time of day, T fast-forwards.
            new GameObject("Time of day").AddComponent<TimeOfDay>();

            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            EditorSceneManager.SaveScene(scene, ScenePath);
            SceneView view = SceneView.lastActiveSceneView;
            if (view != null) view.AlignViewToObject(cam.transform);
        }
    }
}
