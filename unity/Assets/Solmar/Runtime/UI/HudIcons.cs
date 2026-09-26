using UnityEngine;

namespace Solmar.UI
{
    /// <summary>
    /// Small procedural icons the HUD tints and reuses every frame (an up-pointing arrow for the
    /// player blip, a five-lobe star badge for the wanted row, and a rounded-square frame that hides
    /// the minimap's sharp corners): built once, on first use, since none of it changes afterwards.
    /// Everything here is plain white with shape carried in alpha, so callers tint with GUI.color.
    /// </summary>
    static class HudIcons
    {
        const int ArrowSize = 48;
        const int RingSize = 96;
        const int StarSize = 32;

        public static Texture2D Arrow { get; private set; }
        public static Texture2D RingFrame { get; private set; }
        public static Texture2D Star { get; private set; }

        public static void EnsureBuilt()
        {
            if (Arrow == null) Arrow = BuildArrow();
            if (RingFrame == null) RingFrame = BuildRingFrame();
            if (Star == null) Star = BuildStar();
        }

        static Texture2D BuildArrow()
        {
            const int n = ArrowSize;
            var pixels = new Color32[n * n];
            float baseHalfWidth = n * 0.34f;
            float tailHalfWidth = n * 0.14f;
            for (int y = 0; y < n; y++)
            {
                float t = y / (float)(n - 1); // 0 at bottom, 1 at top (the point)
                float half = Mathf.Lerp(tailHalfWidth, 0f, Mathf.Clamp01((t - 0.05f) / 0.9f));
                if (t < 0.22f) half = Mathf.Lerp(baseHalfWidth, tailHalfWidth, t / 0.22f); // flared tail
                int minX = Mathf.Clamp(Mathf.RoundToInt(n * 0.5f - half), 0, n - 1);
                int maxX = Mathf.Clamp(Mathf.RoundToInt(n * 0.5f + half), 0, n - 1);
                for (int x = 0; x < n; x++)
                    pixels[y * n + x] = (x >= minX && x <= maxX) ? (Color32)Color.white : new Color32(255, 255, 255, 0);
            }
            return MakeTexture(n, n, pixels, "SolmarHudArrow");
        }

        static Texture2D BuildRingFrame()
        {
            const int n = RingSize;
            float outerRadius = n * 0.22f;
            float border = n * 0.09f;
            float innerRadius = Mathf.Max(0f, outerRadius - border);
            var pixels = new Color32[n * n];
            for (int y = 0; y < n; y++)
            {
                for (int x = 0; x < n; x++)
                {
                    bool outer = InsideRoundedRect(x + 0.5f, y + 0.5f, 0f, 0f, n, n, outerRadius);
                    bool inner = InsideRoundedRect(x + 0.5f, y + 0.5f, border, border, n - 2f * border, n - 2f * border, innerRadius);
                    pixels[y * n + x] = (outer && !inner) ? (Color32)Color.white : new Color32(255, 255, 255, 0);
                }
            }
            return MakeTexture(n, n, pixels, "SolmarHudRing");
        }

        static Texture2D BuildStar()
        {
            const int n = StarSize;
            var pixels = new Color32[n * n];
            float cx = n * 0.5f, cy = n * 0.5f;
            float outerR = n * 0.46f;
            for (int y = 0; y < n; y++)
            {
                for (int x = 0; x < n; x++)
                {
                    float dx = x + 0.5f - cx, dy = y + 0.5f - cy;
                    float r = Mathf.Sqrt(dx * dx + dy * dy);
                    float theta = Mathf.Atan2(dy, dx);
                    float starR = outerR * (0.42f + 0.58f * Mathf.Cos(5f * theta - Mathf.PI * 0.5f));
                    pixels[y * n + x] = (r <= starR) ? (Color32)Color.white : new Color32(255, 255, 255, 0);
                }
            }
            return MakeTexture(n, n, pixels, "SolmarHudStar");
        }

        static bool InsideRoundedRect(float px, float py, float x0, float y0, float w, float h, float radius)
        {
            float lx = px - x0, ly = py - y0;
            if (lx < 0f || lx > w || ly < 0f || ly > h) return false;
            radius = Mathf.Clamp(radius, 0f, Mathf.Min(w, h) * 0.5f);
            float cx = Mathf.Clamp(lx, radius, w - radius);
            float cy = Mathf.Clamp(ly, radius, h - radius);
            float dx = lx - cx, dy = ly - cy;
            return dx * dx + dy * dy <= radius * radius;
        }

        static Texture2D MakeTexture(int w, int h, Color32[] pixels, string name)
        {
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, false, false)
            {
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
                name = name,
            };
            tex.SetPixels32(pixels);
            tex.Apply(false, false);
            return tex;
        }
    }
}
