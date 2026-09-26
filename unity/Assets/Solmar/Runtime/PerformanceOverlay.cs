using Unity.Profiling;
using UnityEngine;

namespace Solmar
{
    /// <summary>
    /// F3 shows a performance overlay top-left: fps, average frame time and the 1% low over the last
    /// few seconds, CPU and GPU time (from FrameTimingManager; GPU time needs Project Settings >
    /// Player > Frame Timing Stats on), draw calls and triangles (in the Editor and development
    /// builds), memory, the screen size, and a frame-time graph with 60, 120 and 240 fps lines.
    /// </summary>
    public sealed class PerformanceOverlay : MonoBehaviour
    {
        public bool visible;

        const int History = 300;
        readonly float[] frameMs = new float[History];
        readonly float[] sorted = new float[History];
        int head;
        int filled;
        readonly FrameTiming[] timings = new FrameTiming[1];
        double cpuMs, gpuMs;
        float refreshTimer;
        string text = "";
        GUIStyle style;

        ProfilerRecorder drawCalls, triangles, systemMemory;

        void OnEnable()
        {
            drawCalls = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Draw Calls Count");
            triangles = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Triangles Count");
            systemMemory = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "System Used Memory");
        }

        void OnDisable()
        {
            drawCalls.Dispose();
            triangles.Dispose();
            systemMemory.Dispose();
        }

        void Update()
        {
#if ENABLE_LEGACY_INPUT_MANAGER
            if (Input.GetKeyDown(KeyCode.F3)) visible = !visible;
#endif
            frameMs[head] = Time.unscaledDeltaTime * 1000f;
            head = (head + 1) % History;
            filled = Mathf.Min(filled + 1, History);

            FrameTimingManager.CaptureFrameTimings();
            if (FrameTimingManager.GetLatestTimings(1, timings) > 0)
            {
                cpuMs = timings[0].cpuFrameTime;
                gpuMs = timings[0].gpuFrameTime;
            }

            refreshTimer -= Time.unscaledDeltaTime;
            if (visible && refreshTimer <= 0f)
            {
                refreshTimer = 0.25f;
                text = Summary();
            }
        }

        string Summary()
        {
            float sum = 0f;
            for (int i = 0; i < filled; i++)
            {
                sorted[i] = frameMs[i];
                sum += frameMs[i];
            }
            System.Array.Sort(sorted, 0, filled);
            float average = sum / Mathf.Max(1, filled);
            // 1% low: the average frame rate over the slowest 1% of frames.
            int worst = Mathf.Max(1, filled / 100);
            float worstSum = 0f;
            for (int i = filled - worst; i < filled; i++) worstSum += sorted[i];
            float low = 1000f / Mathf.Max(0.001f, worstSum / worst);

            var sb = new System.Text.StringBuilder();
            sb.AppendFormat("{0:0} fps   {1:0.00} ms   1% low {2:0} fps\n", 1000f / Mathf.Max(0.001f, average), average, low);
            sb.AppendFormat("CPU {0:0.00} ms   GPU {1}\n", cpuMs, gpuMs > 0 ? gpuMs.ToString("0.00") + " ms" : "n/a (turn on Frame Timing Stats)");
            if (drawCalls.Valid) sb.AppendFormat("draw calls {0:N0}   triangles {1:N0}\n", drawCalls.LastValue, triangles.LastValue);
            if (systemMemory.Valid) sb.AppendFormat("memory {0:0} MB   ", systemMemory.LastValue / (1024f * 1024f));
            sb.AppendFormat("{0} × {1}   {2}", Screen.width, Screen.height, SystemInfo.graphicsDeviceName);
            return sb.ToString();
        }

        void OnGUI()
        {
            if (!visible) return;
            style ??= new GUIStyle(GUI.skin.label) { fontSize = 16, richText = false };
            const float x = 16f, y = 16f, w = 560f, graphH = 70f;
            GUI.color = new Color(0f, 0f, 0f, 0.55f);
            GUI.DrawTexture(new Rect(x - 8f, y - 6f, w + 16f, 104f + graphH), Texture2D.whiteTexture);
            GUI.color = Color.white;
            GUI.Label(new Rect(x, y, w, 100f), text, style);

            // Frame-time graph: one bar per frame, 0 to 33 ms, with lines at 60, 120 and 240 fps.
            float gy = y + 100f;
            const float maxMs = 33.3f;
            float bar = w / History;
            for (int i = 0; i < filled; i++)
            {
                float ms = frameMs[(head - filled + i + History) % History];
                float h = Mathf.Min(1f, ms / maxMs) * graphH;
                GUI.color = ms > 16.7f ? new Color(1f, 0.35f, 0.3f) : ms > 8.4f ? new Color(1f, 0.8f, 0.3f) : new Color(0.45f, 0.9f, 0.5f);
                GUI.DrawTexture(new Rect(x + i * bar, gy + graphH - h, Mathf.Max(1f, bar), h), Texture2D.whiteTexture);
            }
            GUI.color = new Color(1f, 1f, 1f, 0.35f);
            foreach (float fps in new[] { 60f, 120f, 240f })
            {
                float ly = gy + graphH - 1000f / fps / maxMs * graphH;
                GUI.DrawTexture(new Rect(x, ly, w, 1f), Texture2D.whiteTexture);
            }
            GUI.color = Color.white;
        }
    }
}
