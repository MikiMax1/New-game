using System.IO;
using UnityEditor;
using UnityEngine;

namespace Solmar.EditorTools
{
    /// <summary>
    /// Editor menu: moves the main camera to each marker under "Camera spots" in turn, renders
    /// enough frames for TAA, auto exposure and the volumetric clouds to settle, and saves a PNG per
    /// spot (Solmar > Capture Spot Screenshots).
    /// </summary>
    public static class SolmarCapture
    {
        const int Width = 1920;
        const int Height = 1080;
        const int SettleFrames = 64;
        const string SpotsName = "Camera spots";
        const string OutputFolder = "Screenshots";

        [MenuItem("Solmar/Capture Spot Screenshots", priority = 4)]
        public static void Capture()
        {
            Camera cam = Camera.main;
            if (cam == null)
            {
                Debug.LogError("Solmar: no main camera found (tag a camera \"MainCamera\") -- can't capture spot screenshots.");
                return;
            }

            GameObject spots = GameObject.Find(SpotsName);
            if (spots == null || spots.transform.childCount == 0)
            {
                Debug.LogError("Solmar: no \"" + SpotsName + "\" group with marker children found in the scene -- can't capture spot screenshots.");
                return;
            }

            Vector3 originalPosition = cam.transform.position;
            Quaternion originalRotation = cam.transform.rotation;
            RenderTexture originalTarget = cam.targetTexture;

            string folder = Path.Combine(Application.dataPath, "..", OutputFolder);
            Directory.CreateDirectory(folder);

            var rt = new RenderTexture(Width, Height, 24, RenderTextureFormat.ARGB32);
            rt.Create();
            var tex = new Texture2D(Width, Height, TextureFormat.RGB24, false);
            try
            {
                cam.targetTexture = rt;
                foreach (Transform marker in spots.transform)
                {
                    cam.transform.SetPositionAndRotation(marker.position, marker.rotation);
                    for (int i = 0; i < SettleFrames; i++) cam.Render();

                    RenderTexture previousActive = RenderTexture.active;
                    RenderTexture.active = rt;
                    tex.ReadPixels(new Rect(0f, 0f, Width, Height), 0, 0);
                    tex.Apply();
                    RenderTexture.active = previousActive;

                    string path = Path.Combine(folder, marker.name + ".png");
                    File.WriteAllBytes(path, tex.EncodeToPNG());
                    Debug.Log("Solmar: saved " + path);
                }
            }
            finally
            {
                cam.transform.SetPositionAndRotation(originalPosition, originalRotation);
                cam.targetTexture = originalTarget;
                Object.DestroyImmediate(rt);
                Object.DestroyImmediate(tex);
            }

            EditorUtility.RevealInFinder(folder);
        }
    }
}
