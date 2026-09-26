using UnityEngine;

namespace Solmar
{
    /// <summary>
    /// The controls, bottom-left: shown for the first ten seconds of Play mode, then toggled with H.
    /// </summary>
    public sealed class HelpOverlay : MonoBehaviour
    {
        const string Text =
            "Walk: W A S D, Shift runs, Space jumps; click to look around (Esc frees the mouse), scroll zooms\n" +
            "G by the red car: get in / out (W S drive, A D steer, Space handbrake, V camera, X stability control)\n" +
            "C: free-fly camera (hold right mouse + W A S D, Q/E down/up, Shift faster)\n" +
            "[ ]: time of day   hold T: fast-forward (lamps and windows light up at night)   K: weather\n" +
            "F2: screenshot   F3: performance   F5: quality preset   F6: fps cap\n" +
            "H: hide this help";

        float shownFor = 10f;
        bool pinned;
        GUIStyle style;

        void Update()
        {
#if ENABLE_LEGACY_INPUT_MANAGER
            if (Input.GetKeyDown(KeyCode.H))
            {
                bool visible = pinned || shownFor > 0f;
                pinned = !visible;
                shownFor = 0f;
            }
#endif
            if (shownFor > 0f) shownFor -= Time.unscaledDeltaTime;
        }

        void OnGUI()
        {
            if (!pinned && shownFor <= 0f) return;
            style ??= new GUIStyle(GUI.skin.label) { fontSize = 16 };
            const float w = 640f, h = 150f;
            var rect = new Rect(16f, Screen.height - h - 16f, w, h);
            GUI.color = new Color(0f, 0f, 0f, 0.55f);
            GUI.DrawTexture(new Rect(rect.x - 8f, rect.y - 6f, w + 16f, h + 8f), Texture2D.whiteTexture);
            GUI.color = Color.white;
            GUI.Label(rect, Text, style);
        }
    }
}
