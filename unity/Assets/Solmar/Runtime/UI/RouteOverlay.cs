using System.Collections.Generic;
using UnityEngine;

namespace Solmar.UI
{
    /// <summary>
    /// A transparent overlay the same size as <see cref="RoadMapTexture"/>'s baked texture, holding
    /// the purple waypoint route (and a marker at its destination) so the minimap and full map can
    /// draw it with exactly the same rotation/pan/zoom transform as the road texture underneath --
    /// just one more <c>GUI.DrawTextureWithTexCoords</c> call, alpha-blended on top. Rebuilt only when
    /// the route or waypoint changes, never per frame.
    /// </summary>
    public sealed class RouteOverlay
    {
        static readonly Color32 RouteColor = new Color32(176, 64, 255, 235);
        static readonly Color32 MarkerColor = new Color32(255, 72, 220, 255);
        const float RouteHalfWidthMetres = 1.3f;
        const float MarkerRadiusMetres = 3.4f;

        public static readonly RouteOverlay Instance = new RouteOverlay();

        public Texture2D Texture { get; private set; }
        public bool Ready => Texture != null;

        /// <summary>Bakes a route (world x,z positions, start to destination) into the overlay, sized
        /// and mapped to match <paramref name="map"/>'s current texture.</summary>
        public void SetRoute(RoadMapTexture map, List<Vector2> routeWorld)
        {
            if (map == null || !map.Ready || routeWorld == null || routeWorld.Count == 0)
            {
                Clear();
                return;
            }

            int w = map.Texture.width, h = map.Texture.height;
            var pixels = new Color32[w * h];

            float halfWidthPx = Mathf.Max(1f, RouteHalfWidthMetres * map.PixelsPerMetre);
            for (int i = 0; i < routeWorld.Count - 1; i++)
            {
                Vector2 a = map.WorldToPixel(routeWorld[i]);
                Vector2 b = map.WorldToPixel(routeWorld[i + 1]);
                PaintLine(pixels, w, h, a, b, halfWidthPx, RouteColor);
            }
            Vector2 dest = map.WorldToPixel(routeWorld[routeWorld.Count - 1]);
            PaintCircle(pixels, w, h, dest, Mathf.Max(2f, MarkerRadiusMetres * map.PixelsPerMetre), MarkerColor);

            if (Texture == null || Texture.width != w || Texture.height != h)
            {
                if (Texture != null) Object.Destroy(Texture);
                Texture = new Texture2D(w, h, TextureFormat.RGBA32, false, false)
                {
                    wrapMode = TextureWrapMode.Clamp,
                    filterMode = FilterMode.Bilinear,
                    name = "SolmarRouteOverlay",
                };
            }
            Texture.SetPixels32(pixels);
            Texture.Apply(false, false);
        }

        public void Clear()
        {
            if (Texture != null) Object.Destroy(Texture);
            Texture = null;
        }

        static void PaintLine(Color32[] pixels, int width, int height, Vector2 a, Vector2 b, float halfWidthPx, Color32 color)
        {
            if (!float.IsFinite(a.x) || !float.IsFinite(a.y) || !float.IsFinite(b.x) || !float.IsFinite(b.y)) return;

            int minX = Mathf.Clamp(Mathf.FloorToInt(Mathf.Min(a.x, b.x) - halfWidthPx), 0, width - 1);
            int maxX = Mathf.Clamp(Mathf.CeilToInt(Mathf.Max(a.x, b.x) + halfWidthPx), 0, width - 1);
            int minY = Mathf.Clamp(Mathf.FloorToInt(Mathf.Min(a.y, b.y) - halfWidthPx), 0, height - 1);
            int maxY = Mathf.Clamp(Mathf.CeilToInt(Mathf.Max(a.y, b.y) + halfWidthPx), 0, height - 1);

            Vector2 ab = b - a;
            float abLenSq = Vector2.Dot(ab, ab);
            for (int y = minY; y <= maxY; y++)
            {
                for (int x = minX; x <= maxX; x++)
                {
                    var p = new Vector2(x + 0.5f, y + 0.5f);
                    float t = abLenSq > 1e-6f ? Mathf.Clamp01(Vector2.Dot(p - a, ab) / abLenSq) : 0f;
                    Vector2 closest = a + ab * t;
                    if ((p - closest).sqrMagnitude <= halfWidthPx * halfWidthPx) pixels[y * width + x] = color;
                }
            }
        }

        static void PaintCircle(Color32[] pixels, int width, int height, Vector2 centre, float radiusPx, Color32 color)
        {
            if (!float.IsFinite(centre.x) || !float.IsFinite(centre.y)) return;
            int minX = Mathf.Clamp(Mathf.FloorToInt(centre.x - radiusPx), 0, width - 1);
            int maxX = Mathf.Clamp(Mathf.CeilToInt(centre.x + radiusPx), 0, width - 1);
            int minY = Mathf.Clamp(Mathf.FloorToInt(centre.y - radiusPx), 0, height - 1);
            int maxY = Mathf.Clamp(Mathf.CeilToInt(centre.y + radiusPx), 0, height - 1);
            float r2 = radiusPx * radiusPx;
            for (int y = minY; y <= maxY; y++)
            {
                for (int x = minX; x <= maxX; x++)
                {
                    float dx = x + 0.5f - centre.x, dy = y + 0.5f - centre.y;
                    if (dx * dx + dy * dy <= r2) pixels[y * width + x] = color;
                }
            }
        }
    }
}
