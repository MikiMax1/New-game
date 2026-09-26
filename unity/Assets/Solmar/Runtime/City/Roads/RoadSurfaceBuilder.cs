using System.Collections.Generic;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Builds the road surface for every edge (crowned carriageways, trimmed where they meet an
    /// intersection) and a flat plate filling each intersection footprint, all into one mesh so the
    /// whole district's asphalt costs a single draw call. A street with a median also gets the
    /// median's raised, planted strip: granite edging and a soil bed (the caller plants palms in it,
    /// at the positions returned in `medianPalmBases`).
    /// </summary>
    public static class RoadSurfaceBuilder
    {
        const float WStep = 0.6f;
        const float SStep = 2.5f;

        public static void Build(RoadGraph graph, MeshData road, MeshData medianEdging, MeshData medianSoil, List<Vector3> medianPalmBases, Rng random)
        {
            foreach (RoadEdge edge in graph.Edges) BuildEdge(graph, edge, road, medianEdging, medianSoil, medianPalmBases, random);
            for (int i = 0; i < graph.Nodes.Count; i++) BuildPlate(graph, i, road);
        }

        static List<float> Stations(float from, float to, float step)
        {
            var list = new List<float>();
            if (to <= from) { list.Add(from); return list; }
            float x = from;
            while (x < to)
            {
                list.Add(x);
                x += step;
            }
            list.Add(to);
            return list;
        }

        static void BuildEdge(RoadGraph graph, RoadEdge edge, MeshData road, MeshData medianEdging, MeshData medianSoil, List<Vector3> medianPalmBases, Rng random)
        {
            graph.Span(edge, out float s0, out float s1, out float centre);
            graph.Ends(edge, out int nodeMin, out int nodeMax);
            float a = s0 + graph.TrimAt(edge, nodeMin);
            float b = s1 - graph.TrimAt(edge, nodeMax);
            if (b <= a + 0.5f) return;
            var ss = Stations(a, b, SStep);

            float half = edge.HalfWidth;
            float m = edge.MedianWidth * 0.5f;
            foreach (float sign in new[] { -1f, 1f })
            {
                float wFrom = sign * m;
                float wTo = sign * half;
                var ws = Stations(Mathf.Min(wFrom, wTo), Mathf.Max(wFrom, wTo), WStep);
                BuildGrid(edge, centre, ss, ws, road);
            }
            if (m > 0.1f) BuildMedian(edge, centre, a, b, m, medianEdging, medianSoil, medianPalmBases, random);
        }

        static void BuildGrid(RoadEdge edge, float centre, List<float> ss, List<float> ws, MeshData road)
        {
            int ns = ss.Count, nw = ws.Count;
            if (ns < 2 || nw < 2) return;
            var idx = new int[ns, nw];
            for (int i = 0; i < ns; i++)
            {
                for (int j = 0; j < nw; j++)
                {
                    float w = ws[j];
                    float y = RoadProfile.Height(edge, w, out _) + RoadProfile.Undulation(ss[i], w);
                    Vector2 xz = RoadGraph.WorldAt(edge, centre, ss[i], w);
                    idx[i, j] = road.AddVertex(new Vector3(xz.x, y, xz.y), Vector3.up, new Vector2(xz.x, xz.y));
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

        static void BuildMedian(RoadEdge edge, float centre, float a, float b, float m, MeshData edging, MeshData soil, List<Vector3> palmBases, Rng random)
        {
            const float edgeT = 0.08f;
            float top = RoadWidths.KerbHeight;
            foreach (float sign in new[] { -1f, 1f })
            {
                float w = sign * (m - edgeT * 0.5f);
                edging.Append(Strip(edge, centre, a, b, w, edgeT, top));
            }
            edging.Append(Strip(edge, centre, a, a + edgeT, 0f, 2f * m, top));
            edging.Append(Strip(edge, centre, b - edgeT, b, 0f, 2f * m, top));
            soil.Append(Strip(edge, centre, a + edgeT, b - edgeT, 0f, 2f * (m - edgeT), top - 0.03f));

            for (float s = a + 6f; s < b - 4f; s += 15f)
            {
                Vector2 xz = RoadGraph.WorldAt(edge, centre, s + random.Range(-2f, 2f), 0f);
                palmBases.Add(new Vector3(xz.x, top - 0.03f, xz.y));
            }
        }

        /// <summary>A flat rectangle along an edge's length, from `s0` to `s1`, centred at `w` across, `width` wide, top at `topY`.</summary>
        static MeshData Strip(RoadEdge edge, float centre, float s0, float s1, float w, float width, float topY)
        {
            var m = new MeshData();
            if (s1 <= s0 || width <= 0f) return m;
            Vector2 p0 = RoadGraph.WorldAt(edge, centre, s0, w - width * 0.5f);
            Vector2 p1 = RoadGraph.WorldAt(edge, centre, s1, w - width * 0.5f);
            Vector2 p2 = RoadGraph.WorldAt(edge, centre, s1, w + width * 0.5f);
            Vector2 p3 = RoadGraph.WorldAt(edge, centre, s0, w + width * 0.5f);
            int i0 = m.AddVertex(new Vector3(p0.x, topY, p0.y), Vector3.up, p0);
            int i1 = m.AddVertex(new Vector3(p1.x, topY, p1.y), Vector3.up, p1);
            int i2 = m.AddVertex(new Vector3(p2.x, topY, p2.y), Vector3.up, p2);
            int i3 = m.AddVertex(new Vector3(p3.x, topY, p3.y), Vector3.up, p3);
            m.AddTriangle(i0, i1, i2);
            m.AddTriangle(i0, i2, i3);
            Shapes.FixWinding(m, 0, m.indices.Count);
            return m;
        }

        /// <summary>
        /// The flat plate filling a node's intersection footprint: its height blends the crown of
        /// whichever edges cross there, so it meets each one smoothly at the footprint's edge.
        /// </summary>
        static void BuildPlate(RoadGraph graph, int nodeIndex, MeshData road)
        {
            float ex = graph.HalfExtentX(nodeIndex);
            float ez = graph.HalfExtentZ(nodeIndex);
            if (ex < 0.1f || ez < 0.1f) return;
            Vector2 c = graph.Nodes[nodeIndex].Position;
            RoadEdge vEdge = Dominant(graph, nodeIndex, RoadOrientation.Vertical);
            RoadEdge hEdge = Dominant(graph, nodeIndex, RoadOrientation.Horizontal);
            var xs = Stations(-ex, ex, WStep);
            var zs = Stations(-ez, ez, WStep);
            int nx = xs.Count, nz = zs.Count;
            var idx = new int[nx, nz];
            for (int i = 0; i < nx; i++)
            {
                for (int j = 0; j < nz; j++)
                {
                    float hx = vEdge != null ? RoadProfile.Height(vEdge, xs[i], out _) : RoadWidths.GutterHeight;
                    float hz = hEdge != null ? RoadProfile.Height(hEdge, zs[j], out _) : RoadWidths.GutterHeight;
                    float y = (hx + hz) * 0.5f;
                    var pos = new Vector3(c.x + xs[i], y, c.y + zs[j]);
                    idx[i, j] = road.AddVertex(pos, Vector3.up, new Vector2(pos.x, pos.z));
                }
            }
            int start = road.indices.Count;
            for (int i = 0; i < nx - 1; i++)
            {
                for (int j = 0; j < nz - 1; j++)
                {
                    road.AddTriangle(idx[i, j], idx[i + 1, j], idx[i, j + 1]);
                    road.AddTriangle(idx[i + 1, j], idx[i + 1, j + 1], idx[i, j + 1]);
                }
            }
            Shapes.FixWinding(road, start, road.indices.Count);
        }

        static RoadEdge Dominant(RoadGraph graph, int nodeIndex, RoadOrientation orientation)
        {
            RoadEdge best = null;
            foreach (int id in graph.Nodes[nodeIndex].EdgeIds)
            {
                RoadEdge e = graph.Edges[id];
                if (e.Orientation != orientation) continue;
                if (best == null || e.HalfWidth > best.HalfWidth) best = e;
            }
            return best;
        }
    }
}
