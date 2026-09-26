using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Lane markings and crosswalks along every edge, at whatever angle it runs: a double yellow
    /// centre line where a street has no median, dashed lane lines between lanes, solid parking-lane
    /// (or edge) lines, and at every junction a continental crosswalk across the road and a stop line
    /// behind it for the traffic arriving there (which keeps right).
    ///
    /// They are mesh decals: thin strips of the HDRP/Decal road-paint materials laid a centimetre
    /// over the crowned asphalt, following its profile, combined per tile into one mesh per colour
    /// (thousands of decal projectors would cost far more). They have no collider.
    /// </summary>
    public static class RoadMarkings
    {
        const float Lift = 0.012f;
        const float LineWidth = 0.1f;
        const float BarWidth = 0.6f;
        const float BarGap = 0.6f;
        const float Step = 5f;

        public static void Build(RoadGraph graph, CityTiles tiles, CityMaterials m)
        {
            foreach (RoadEdge edge in graph.Edges) BuildEdge(graph, edge, tiles, m);
        }

        static void BuildEdge(RoadGraph g, RoadEdge edge, CityTiles tiles, CityMaterials m)
        {
            float len = g.Length(edge);
            float a = edge.TrimA, b = len - edge.TrimB;
            if (b - a < 3f) return;
            bool juncA = g.IsJunction(edge.A), juncB = g.IsJunction(edge.B);
            float clearance = RoadWidths.CrosswalkDepth + RoadWidths.StopLineGap + 0.6f;
            float from = a + (juncA ? clearance : 0f);
            float to = b - (juncB ? clearance : 0f);
            Vector2 mid = g.PointFrom(edge, edge.A, (a + b) * 0.5f, 0f);
            MeshData white = tiles.Surface(mid, "Road markings", m.DecalWhite, CityTiles.Layer.Marking);
            MeshData yellow = tiles.Surface(mid, "Road markings", m.DecalYellow, CityTiles.Layer.Marking);

            float med = edge.MedianWidth * 0.5f;
            float half = edge.HalfWidth;
            float lanes = edge.LanesPerDirection * RoadWidths.LaneWidth;
            if (to > from + 1f)
            {
                foreach (float sign in new[] { -1f, 1f })
                {
                    if (med <= 0.1f) Line(g, edge, yellow, sign * 0.12f, LineWidth, from, to);
                    if (edge.Parking) Line(g, edge, white, sign * (med + lanes), LineWidth, from, to);
                    else Line(g, edge, white, sign * (half - 0.3f), LineWidth * 1.5f, from, to);
                    for (int lane = 1; lane < edge.LanesPerDirection; lane++) Dashes(g, edge, white, sign * (med + lane * RoadWidths.LaneWidth), from, to);
                }
            }

            if (juncA) Crossing(g, edge, white, a, 1f, med, half, lanes);
            if (juncB) Crossing(g, edge, white, b, -1f, med, half, lanes);
        }

        /// <summary>
        /// The crosswalk at one end of an edge (starting at `end`, running `dir` = +1 into the edge
        /// from node A, -1 from node B) and the stop line behind it on the arriving carriageway.
        /// </summary>
        static void Crossing(RoadGraph g, RoadEdge edge, MeshData white, float end, float dir, float med, float half, float lanes)
        {
            float s0 = end + dir * 0.3f, s1 = end + dir * (RoadWidths.CrosswalkDepth - 0.3f);
            for (float w0 = -half + 0.35f; w0 < half - 0.5f; w0 += BarWidth + BarGap)
            {
                float w1 = Mathf.Min(w0 + BarWidth, half - 0.35f);
                float wc = (w0 + w1) * 0.5f;
                if (med > 0.1f && Mathf.Abs(wc) < med + 0.2f) continue;
                Strip(g, edge, white, wc, w1 - w0, Mathf.Min(s0, s1), Mathf.Max(s0, s1));
            }
            // Traffic keeps right: arriving at A (travelling B→A) it is on the +w side, at B on the -w side.
            float stopS = end + dir * (RoadWidths.CrosswalkDepth + RoadWidths.StopLineGap);
            float sign = dir > 0f ? 1f : -1f;
            float wc2 = sign * (med + lanes * 0.5f);
            Strip(g, edge, white, wc2, lanes, stopS - 0.225f, stopS + 0.225f);
        }

        static void Line(RoadGraph g, RoadEdge edge, MeshData m, float w, float width, float from, float to)
        {
            Strip(g, edge, m, w, width, from, to);
        }

        static void Dashes(RoadGraph g, RoadEdge edge, MeshData m, float w, float from, float to)
        {
            for (float s = from + 1f; s + 3f <= to; s += 12f) Strip(g, edge, m, w, LineWidth, s, s + 3f);
        }

        /// <summary>
        /// A strip of paint centred `w` across the edge, `width` wide, from s0 to s1 along it (from
        /// node A), following the road's crown. UVs: metres along, 0..1 across.
        /// </summary>
        static void Strip(RoadGraph g, RoadEdge edge, MeshData m, float w, float width, float s0, float s1)
        {
            if (s1 <= s0 + 0.05f) return;
            float wl = w - width * 0.5f, wr = w + width * 0.5f;
            List<float> ss = SurfaceMesh.Stations(s0, s1, Step);
            int prevL = -1, prevR = -1;
            int first = m.indices.Count;
            foreach (float s in ss)
            {
                Vector2 pl = g.PointFrom(edge, edge.A, s, wl), pr = g.PointFrom(edge, edge.A, s, wr);
                float yl = RoadProfile.Height(edge, wl, out _) + Lift, yr = RoadProfile.Height(edge, wr, out _) + Lift;
                int il = m.AddVertex(new Vector3(pl.x, yl, pl.y), Vector3.up, new Vector2(s, 0f));
                int ir = m.AddVertex(new Vector3(pr.x, yr, pr.y), Vector3.up, new Vector2(s, 1f));
                if (prevL >= 0)
                {
                    m.AddTriangle(prevL, il, ir);
                    m.AddTriangle(prevL, ir, prevR);
                }
                prevL = il;
                prevR = ir;
            }
            Shapes.FixWinding(m, first, m.indices.Count);
        }
    }
}
