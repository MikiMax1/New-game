using System;
using System.IO;
using UnityEngine;

namespace Solmar
{
    /// <summary>Press F2 to save a timestamped screenshot into &lt;project&gt;/Screenshots.</summary>
    public sealed class ScreenshotKey : MonoBehaviour
    {
#if ENABLE_LEGACY_INPUT_MANAGER
        void Update()
        {
            if (!Input.GetKeyDown(KeyCode.F2)) return;

            string folder = Path.Combine(Application.dataPath, "..", "Screenshots");
            Directory.CreateDirectory(folder);
            string fileName = "solmar-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".png";
            string path = Path.Combine(folder, fileName);
            ScreenCapture.CaptureScreenshot(path, 2);
            Debug.Log("Solmar: saved screenshot to " + path);
        }
#endif
    }
}
