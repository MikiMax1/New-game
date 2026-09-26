using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Builds the road surface for every edge, at whatever angle it runs (crowned carriageways,
    /// trimmed where they meet a junction), a plate filling each junction fitted to the roads that
    /// meet there, and the raised, planted medians of the avenues, the boulevard and the ring road:
    /// granite edging round a soil bed with palms on the avenues and the boulevard, grass on the ring.
    /// Everything goes into the tile it is in (<see cref="CityTiles"/>), so a tile's asphalt is one
    /// draw call.
    /// </summary>
    public static class RoadSurfaceBuilder
    {
        const float WStep = 1.4f;
        const float SStep = 5f;
        const float EdgeT = 0.1f;

        /// <summary>Median palms: positions, and whether they get the detailed model (the boulevard).</summary>
        public struct PalmSpot
        {
            public Vector3 position;
            public bool detailed;
        }

        public static void Build(RoadGraph graph, CityTiles tiles, CityMaterials m, Material lawn, List<PalmSpot> palms, Rng random)
        {
            foreach (RoadEdge edge in graph.Edges) BuildEdge(graph, edge, tiles, m, lawn, palms, random);
            var pts = new List<Vector2>();
            var heights = new List<float>();
            for (int n = 0; n < graph.Nodes.Count; n++)
            {
                RoadJunctions.PlateOutline(graph, n, pts, heights, WStep);
                if (pts.Count < 3) continue;
                List<Vector2> outline = DedupeWith(pts, heights);
                SurfaceMesh.Polygon(tiles.Surface(graph.Nodes[n].Position, "Roads", m.Road), outline, heights);
            }
        }

        /// <summary>Drops near-duplicate outline points, keeping `heights` in step (it is edited in place).</summary>
        static List<Vector2> DedupeWith(List<Vector2> pts, List<float> heights)
        {
            var p = new List<Vector2>();
            var h = new List<float>();
            for (int i = 0; i < pts.Count; i++)
            {
                if (p.Count > 0 && (p[p.Count - 1] - pts[i]).sqrMagnitude < 0.0004f) continue;
                p.Add(pts[i]);
                h.Add(heights[i]);
            }
            while (p.Count > 1 && (p[0] - p[p.Count - 1]).sqrMagnitude < 0.0004f)
            {
                p.RemoveAt(p.Count - 1);
                h.RemoveAt(h.Count - 1);
            }
            heights.Clear();
            heights.AddRange(h);
            return p;
        }

        static void BuildEdge(RoadGraph g, RoadEdge edge, CityTiles tiles, CityMaterials m, Material lawn, List<PalmSpot> palms, Rng random)
        {
            float a = edge.TrimA;
            float b = g.Length(edge) - edge.TrimB;
            if (b <= a + 0.2f) return;
            Vector2 mid = g.PointFrom(edge, edge.A, (a + b) * 0.5f, 0f);
            MeshData road = tiles.Surface(mid, "Roads", m.Road);
            List<float> ss = SurfaceMesh.Stations(a, b, SStep);
            List<float> side = RoadProfile.CarriagewayStations(edge, WStep);
            foreach (float sign in new[] { -1f, 1f })
            {
                var ws = new List<float>(side.Count);
                foreach (float w in side) ws.Add(w * sign);
                Grid(g, edge, ss, ws, a, b, road);
            }
            float med = edge.MedianWidth * 0.5f;
            if (med > 0.1f) BuildMedian(g, edge, a, b, med, tiles, m, lawn, palms, random);
        }

        static void Grid(RoadGraph g, RoadEdge edge, List<float> ss, List<float> ws, float a, float b, MeshData road)
        {
            int ns = ss.Count, nw = ws.Count;
            if (ns < 2 || nw < 2) return;
            var idx = new int[ns, nw];
            for (int i = 0; i < ns; i++)
            {
                // No undulation right at the ends, so the edge meets its plates exactly.
                float fade = Mathf.Clamp01(Mathf.Min(ss[i] - a, b - ss[i]) / 3f);
                for (int j = 0; j < nw; j++)
                {
                    float w = ws[j];
                    float y = RoadProfile.Height(edge, w, out _) + RoadProfile.Undulation(ss[i], w) * fade;
                    Vector2 xz = g.PointFrom(edge, edge.A, ss[i], w);
                    idx[i, j] = road.AddVertex(new Vector3(xz.x, y, xz.y), Vector3.up, xz);
                }
            }
            int start = road.indices.Count;
            for (int i = 0; i < ns - 1; i++)
            {
                for (int j = 0; j < nw - 1; j++)
                {
                    road.AddTriangle(idx[i, j], idx[i + 1, j], idx[i, j + 1]);
                    road.AddTriangle(idx[i + 1, j], idx[i + 1, j + 1], idx[i, j + 1]);
                }
            }
            Shapes.FixWinding(road, start, road.indices.Count);
        }

        /// <summary>The raised median: granite edging on both sides and across the noses, a soil bed (grass on the ring) and palms.</summary>
        static void BuildMedian(RoadGraph g, RoadEdge edge, float a, float b, float med, CityTiles tiles, CityMaterials m, Material lawn, List<PalmSpot> palms, Rng random)
        {
            float top = RoadWidths.KerbHeight;
            Vector2 pa = g.PointFrom(edge, edge.A, a, 0f), pb = g.PointFrom(edge, edge.A, b, 0f);
            Vector2 mid = (pa + pb) * 0.5f;
            MeshData edging = tiles.Surface(mid, "Median edging", m.Granite);
            // Along both sides (the box sits inside the median's outline).
            SurfaceMesh.BoxAlong(edging, pa, pb, med - EdgeT * 0.5f, EdgeT, -0.05f, top);
            SurfaceMesh.BoxAlong(edging, pa, pb, -(med - EdgeT * 0.5f), EdgeT, -0.05f, top);
            // Noses.
            Vector2 d = g.Direction(edge);
            Vector2 left = RoadGraph.Left(d);
            SurfaceMesh.BoxAlong(edging, pa + left * med, pa - left * med, -EdgeT * 0.5f, EdgeT, -0.05f, top);
            SurfaceMesh.BoxAlong(edging, pb - left * med, pb + left * med, -EdgeT * 0.5f, EdgeT, -0.05f, top);

            bool planted = edge.Class == RoadClass.Avenue || edge.Class == RoadClass.Boulevard;
            MeshData soil = tiles.Surface(mid, planted ? "Median soil" : "Median grass", planted ? m.Mulch : lawn, CityTiles.Layer.Ground);
            Vector2 i0 = pa + d * EdgeT + left * (med - EdgeT), i1 = pb - d * EdgeT + left * (med - EdgeT);
            Vector2 i2 = pb - d * EdgeT - left * (med - EdgeT), i3 = pa + d * EdgeT - left * (med - EdgeT);
            if (b - a > EdgeT * 3f) SurfaceMesh.GroundQuad(soil, i0, top - 0.03f, i1, top - 0.03f, i2, top - 0.03f, i3, top - 0.03f);

            if (!planted) return;
            float spacing = edge.Class == RoadClass.Boulevard ? 22f : 26f;
            for (float s = a + 7f; s < b - 5f; s += spacing)
            {
                Vector2 xz = g.PointFrom(edge, edge.A, s + random.Range(-2f, 2f), 0f);
                palms.Add(new PalmSpot { position = new Vector3(xz.x, top - 0.03f, xz.y), detailed = edge.Class == RoadClass.Boulevard });
            }
        }
    }
}
