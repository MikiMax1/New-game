using Solmar.City;
using Solmar.City.Roads;
using UnityEngine;

namespace Solmar.UI
{
    /// <summary>
    /// Bakes the road network into one Texture2D at load (roads light grey over a dark green/sand
    /// backdrop, wider avenues drawn wider since each edge's own <see cref="RoadEdge.HalfWidth"/> is
    /// used), and keeps the world-space <-> pixel/UV mapping the minimap and full map draw from.
    ///
    /// Reads only node positions and edge endpoints from <see cref="RoadGraph"/> -- never
    /// <see cref="RoadOrientation"/> -- so it keeps working while the road generator is reworked to
    /// build streets at any angle. When there is no <see cref="RoadGraph.Current"/> (the single-street
    /// scene, <see cref="SolmarCity"/>) it instead bakes the one street described by <see cref="Layout"/>.
    /// Rebuilds itself automatically whenever <see cref="RoadGraph.Current"/> is swapped for a new
    /// instance (the map generator replaces it wholesale when it regenerates).
    /// </summary>
    public sealed class RoadMapTexture
    {
        const int MaxDimension = 768;
        const int MinDimension = 64;
        const float BoundsMargin = 18f;
        const float NoiseScale = 0.035f;

        static readonly Color RoadColor = new Color(0.74f, 0.74f, 0.78f);
        static readonly Color BackgroundGreen = new Color(0.05f, 0.13f, 0.07f);
        static readonly Color BackgroundSand = new Color(0.20f, 0.17f, 0.11f);

        public static readonly RoadMapTexture Instance = new RoadMapTexture();

        public Texture2D Texture { get; private set; }
        public Vector2 WorldMin { get; private set; }
        public Vector2 WorldSize { get; private set; }
        public float PixelsPerMetre { get; private set; } = 1f;
        public bool Ready => Texture != null;

        RoadGraph lastSeenGraph;
        bool built;

        /// <summary>Rebuilds the baked texture if it is missing or the source road graph changed
        /// (a fresh graph instance after a regenerate, or the graph appearing/disappearing). The
        /// check is a plain reference compare against whatever <see cref="RoadGraph.Current"/> is
        /// right now, so it also catches a graph instance that stayed empty or gained/lost nodes.</summary>
        public void EnsureCurrent()
        {
            RoadGraph graph = RoadGraph.Current;
            if (built && graph == lastSeenGraph) return;
            lastSeenGraph = graph;
            built = true;
            Build(graph != null && graph.Nodes.Count > 0 ? graph : null);
        }

        public Vector2 WorldToPixel(Vector2 worldXZ) => (worldXZ - WorldMin) * PixelsPerMetre;
        public Vector2 WorldToUV(Vector2 worldXZ)
        {
            if (Texture == null) return Vector2.zero;
            Vector2 px = WorldToPixel(worldXZ);
            return new Vector2(px.x / Texture.width, px.y / Texture.height);
        }

        public Vector2 UVToWorld(Vector2 uv)
        {
            return WorldMin + new Vector2(uv.x * WorldSize.x, uv.y * WorldSize.y);
        }

        void Build(RoadGraph graph)
        {
            float minX, maxX, minZ, maxZ;
            if (graph != null)
            {
                minX = maxX = graph.Nodes[0].Position.x;
                minZ = maxZ = graph.Nodes[0].Position.y;
                float maxHalf = 0f;
                foreach (RoadNode n in graph.Nodes)
                {
                    if (n.Position.x < minX) minX = n.Position.x;
                    if (n.Position.x > maxX) maxX = n.Position.x;
                    if (n.Position.y < minZ) minZ = n.Position.y;
                    if (n.Position.y > maxZ) maxZ = n.Position.y;
                }
                foreach (RoadEdge e in graph.Edges) if (e.HalfWidth > maxHalf) maxHalf = e.HalfWidth;
                float margin = BoundsMargin + maxHalf;
                minX -= margin; maxX += margin; minZ -= margin; maxZ += margin;
            }
            else
            {
                minX = -Layout.StreetHalfLength - BoundsMargin;
                maxX = Layout.StreetHalfLength + BoundsMargin;
                minZ = -Layout.BuildingZ - BoundsMargin;
                maxZ = Layout.BuildingZ + BoundsMargin;
            }

            float worldWidth = Mathf.Max(1f, maxX - minX);
            float worldHeight = Mathf.Max(1f, maxZ - minZ);
            float ppm = MaxDimension / Mathf.Max(worldWidth, worldHeight);
            int width = Mathf.Clamp(Mathf.RoundToInt(worldWidth * ppm), MinDimension, MaxDimension);
            int height = Mathf.Clamp(Mathf.RoundToInt(worldHeight * ppm), MinDimension, MaxDimension);
            // Recompute ppm from the clamped pixel size so world<->pixel round-trips stay exact.
            ppm = Mathf.Min(width / worldWidth, height / worldHeight);

            WorldMin = new Vector2(minX, minZ);
            WorldSize = new Vector2(worldWidth, worldHeight);
            PixelsPerMetre = ppm;

            var pixels = new Color32[width * height];
            Color32 green32 = BackgroundGreen;
            Color32 sand32 = BackgroundSand;
            for (int y = 0; y < height; y++)
            {
                for (int x = 0; x < width; x++)
                {
                    float n = Mathf.PerlinNoise(x * NoiseScale, y * NoiseScale);
                    pixels[y * width + x] = Color32.Lerp(green32, sand32, n);
                }
            }

            if (graph != null)
            {
                foreach (RoadEdge e in graph.Edges)
                {
                    Vector2 a = WorldToPixel(graph.Nodes[e.A].Position);
                    Vector2 b = WorldToPixel(graph.Nodes[e.B].Position);
                    PaintSegment(pixels, width, height, a, b, e.HalfWidth * ppm);
                }
            }
            else
            {
                Vector2 a = WorldToPixel(new Vector2(-Layout.StreetHalfLength, 0f));
                Vector2 b = WorldToPixel(new Vector2(Layout.StreetHalfLength, 0f));
                PaintSegment(pixels, width, height, a, b, Layout.KerbZ * ppm);
            }

            if (Texture != null) Object.Destroy(Texture);
            Texture = new Texture2D(width, height, TextureFormat.RGBA32, false, false)
            {
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
                name = "SolmarRoadMap",
            };
            Texture.SetPixels32(pixels);
            Texture.Apply(false, false);
        }

        static void PaintSegment(Color32[] pixels, int width, int height, Vector2 a, Vector2 b, float halfWidthPx)
        {
            if (!IsFinite(a) || !IsFinite(b) || !float.IsFinite(halfWidthPx)) return;
            halfWidthPx = Mathf.Max(1f, halfWidthPx);

            int minX = Mathf.Clamp(Mathf.FloorToInt(Mathf.Min(a.x, b.x) - halfWidthPx), 0, width - 1);
            int maxX = Mathf.Clamp(Mathf.CeilToInt(Mathf.Max(a.x, b.x) + halfWidthPx), 0, width - 1);
            int minY = Mathf.Clamp(Mathf.FloorToInt(Mathf.Min(a.y, b.y) - halfWidthPx), 0, height - 1);
            int maxY = Mathf.Clamp(Mathf.CeilToInt(Mathf.Max(a.y, b.y) + halfWidthPx), 0, height - 1);

            Vector2 ab = b - a;
            float abLenSq = Vector2.Dot(ab, ab);
            Color32 road32 = RoadColor;
            for (int y = minY; y <= maxY; y++)
            {
                for (int x = minX; x <= maxX; x++)
                {
                    var p = new Vector2(x + 0.5f, y + 0.5f);
                    float t = abLenSq > 1e-6f ? Mathf.Clamp01(Vector2.Dot(p - a, ab) / abLenSq) : 0f;
                    Vector2 closest = a + ab * t;
                    if ((p - closest).sqrMagnitude <= halfWidthPx * halfWidthPx)
                    {
                        pixels[y * width + x] = road32;
                    }
                }
            }
        }

        static bool IsFinite(Vector2 v) => float.IsFinite(v.x) && float.IsFinite(v.y);
    }
}
