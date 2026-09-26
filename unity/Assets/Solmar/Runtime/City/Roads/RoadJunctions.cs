using System.Collections.Generic;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Fits every junction to the roads that meet there, at whatever angles they meet.
    ///
    /// Around each node the edges are sorted counter-clockwise. Between each pair of neighbours is a
    /// corner: when the angle between them is under 175° it is a real street corner, where the left
    /// kerb of one road meets the right kerb of the next; there the kerb is rounded with a fillet
    /// (<see cref="RoadWidths.CornerRadius"/>, tighter at sharp corners, none at a bend in one
    /// street). Each edge's road surface stops (its trim) where the corners on both sides of it have
    /// finished; the plate between the trimmed ends is bounded by the edge ends and the corner kerbs.
    ///
    /// For two roads of half widths hi and hj meeting at angle α, the kerb lines cross at
    /// s = (hj + hi·cos α) / sin α along the first road; offsetting both kerbs by the fillet radius
    /// r gives the fillet's centre, and its tangent points lie r·cot(α/2) further out.
    /// </summary>
    public static class RoadJunctions
    {
        const float OpenAngle = 175f * Mathf.Deg2Rad;
        const float ArcStep = 12f * Mathf.Deg2Rad;
        const float MaxAlong = 70f;

        /// <summary>Sorts every node's edges, and computes every trim and kerb corner.</summary>
        public static void Compute(RoadGraph g)
        {
            foreach (RoadNode node in g.Nodes)
            {
                node.Sorted.Clear();
                node.Corners.Clear();
                node.CornerClosed.Clear();
            }
            for (int n = 0; n < g.Nodes.Count; n++) SortEdges(g, n);
            foreach (RoadEdge e in g.Edges) e.TrimA = e.TrimB = 0f;

            for (int n = 0; n < g.Nodes.Count; n++)
            {
                RoadNode node = g.Nodes[n];
                int deg = node.Sorted.Count;
                if (deg == 0) continue;
                var need = new float[deg];
                if (deg >= 2)
                {
                    for (int k = 0; k < deg; k++)
                    {
                        int j = (k + 1) % deg;
                        if (!Solve(g, n, node.Sorted[k], node.Sorted[j], out float sk, out float sj, out _, out _)) continue;
                        need[k] = Mathf.Max(need[k], sk);
                        need[j] = Mathf.Max(need[j], sj);
                    }
                }
                float minTrim = deg >= 3 ? 1.5f : 0f;
                float margin = deg >= 3 ? 0.4f : 0f;
                for (int k = 0; k < deg; k++)
                {
                    RoadEdge e = g.Edges[node.Sorted[k]];
                    float t = Mathf.Max(need[k] + margin, minTrim);
                    if (e.A == n) e.TrimA = Mathf.Max(e.TrimA, t);
                    if (e.B == n) e.TrimB = Mathf.Max(e.TrimB, t);
                }
            }

            // An edge too short for both junctions' plates keeps a sliver of its own surface.
            foreach (RoadEdge e in g.Edges)
            {
                float room = Mathf.Max(0f, g.Length(e) - 1f);
                float sum = e.TrimA + e.TrimB;
                if (sum > room && sum > 1e-4f)
                {
                    float k = room / sum;
                    e.TrimA *= k;
                    e.TrimB *= k;
                }
            }

            for (int n = 0; n < g.Nodes.Count; n++) BuildCorners(g, n);
        }

        /// <summary>
        /// The trim node `n` wants on edge `e` from its two neighbouring corners, before any clamping
        /// to the edge's length (Compute must have sorted the node's edges).
        /// </summary>
        public static float WantedTrim(RoadGraph g, RoadEdge e, int n)
        {
            RoadNode node = g.Nodes[n];
            int deg = node.Sorted.Count;
            int id = g.Edges.IndexOf(e);
            int k = node.Sorted.IndexOf(id);
            if (k < 0 || deg < 2) return 0f;
            float t = 0f;
            int next = (k + 1) % deg, prev = (k + deg - 1) % deg;
            if (Solve(g, n, node.Sorted[k], node.Sorted[next], out float sk, out _, out _, out _)) t = Mathf.Max(t, sk);
            if (Solve(g, n, node.Sorted[prev], node.Sorted[k], out _, out float sj, out _, out _)) t = Mathf.Max(t, sj);
            return t + (deg >= 3 ? 0.4f : 0f);
        }

        static void SortEdges(RoadGraph g, int n)
        {
            RoadNode node = g.Nodes[n];
            node.Sorted.AddRange(node.EdgeIds);
            node.Sorted.Sort((a, b) => Angle(g, g.Edges[a], n).CompareTo(Angle(g, g.Edges[b], n)));
        }

        static float Angle(RoadGraph g, RoadEdge e, int n)
        {
            Vector2 d = g.DirectionFrom(e, n);
            return Mathf.Atan2(d.y, d.x);
        }

        /// <summary>Counter-clockwise angle from direction a to direction b, in (0, 2π].</summary>
        public static float CcwAngle(Vector2 a, Vector2 b)
        {
            float cross = a.x * b.y - a.y * b.x;
            float dot = a.x * b.x + a.y * b.y;
            float t = Mathf.Atan2(cross, dot);
            if (t <= 1e-5f) t += 2f * Mathf.PI;
            return t;
        }

        /// <summary>Fillet radius for a corner of angle α at a node of degree `deg`: none at a bend, tighter at sharp corners.</summary>
        static float Radius(int deg, float alpha)
        {
            if (deg < 3) return 0f;
            float f = Mathf.Clamp((alpha * Mathf.Rad2Deg - 20f) / 70f, 0.25f, 1f);
            return RoadWidths.CornerRadius * f;
        }

        /// <summary>
        /// The corner between edge `ek` and the next edge counter-clockwise, `ej`, at node `n`:
        /// false if it is open (175° or more). Otherwise the along-distances of the fillet's tangent
        /// points on each (sk on ek's left kerb, sj on ej's right kerb) and the fillet's centre and radius.
        /// </summary>
        static bool Solve(RoadGraph g, int n, int ek, int ej, out float sk, out float sj, out Vector2 centre, out float r)
        {
            sk = sj = 0f;
            centre = Vector2.zero;
            r = 0f;
            RoadEdge a = g.Edges[ek], b = g.Edges[ej];
            Vector2 da = g.DirectionFrom(a, n), db = g.DirectionFrom(b, n);
            float alpha = CcwAngle(da, db);
            if (alpha >= OpenAngle || ek == ej) return false;
            float sin = Mathf.Sin(alpha), cos = Mathf.Cos(alpha);
            if (sin < 1e-3f) return false;
            r = Radius(g.Nodes[n].Sorted.Count, alpha);
            float hi = a.HalfWidth + r, hj = b.HalfWidth + r;
            sk = Mathf.Clamp((hj + hi * cos) / sin, -MaxAlong, MaxAlong);
            sj = Mathf.Clamp((hi + hj * cos) / sin, -MaxAlong, MaxAlong);
            centre = g.PointFrom(a, n, sk, a.HalfWidth + r);
            return true;
        }

        static void BuildCorners(RoadGraph g, int n)
        {
            RoadNode node = g.Nodes[n];
            int deg = node.Sorted.Count;
            for (int k = 0; k < deg; k++)
            {
                int j = (k + 1) % deg;
                RoadEdge a = g.Edges[node.Sorted[k]], b = g.Edges[node.Sorted[j]];
                var pts = new List<Vector2>();
                Vector2 ka = g.PointFrom(a, n, g.TrimAt(a, n), a.HalfWidth);
                Vector2 kb = g.PointFrom(b, n, g.TrimAt(b, n), -b.HalfWidth);
                pts.Add(ka);
                float sk = 0f, sj = 0f, r = 0f;
                Vector2 c = Vector2.zero;
                bool closed = false;
                if (deg >= 2) closed = Solve(g, n, node.Sorted[k], node.Sorted[j], out sk, out sj, out c, out r);
                if (closed)
                {
                    Vector2 ta = g.PointFrom(a, n, sk, a.HalfWidth);
                    Vector2 tb = g.PointFrom(b, n, sj, -b.HalfWidth);
                    AddDistinct(pts, ta);
                    if (r > 0.05f)
                    {
                        float a0 = Mathf.Atan2(ta.y - c.y, ta.x - c.x);
                        float a1 = Mathf.Atan2(tb.y - c.y, tb.x - c.x);
                        float delta = Mathf.Repeat(a1 - a0 + Mathf.PI, 2f * Mathf.PI) - Mathf.PI;
                        int steps = Mathf.Max(1, Mathf.CeilToInt(Mathf.Abs(delta) / ArcStep));
                        for (int i = 1; i < steps; i++)
                        {
                            float t = a0 + delta * i / steps;
                            AddDistinct(pts, c + new Vector2(Mathf.Cos(t), Mathf.Sin(t)) * r);
                        }
                    }
                    AddDistinct(pts, tb);
                }
                AddDistinct(pts, kb);
                if (pts.Count == 1) pts.Add(kb);
                node.Corners.Add(pts);
                node.CornerClosed.Add(closed);
            }
        }

        static void AddDistinct(List<Vector2> pts, Vector2 p)
        {
            if ((pts[pts.Count - 1] - p).sqrMagnitude > 0.0025f) pts.Add(p);
        }

        /// <summary>
        /// The outline of a node's junction plate, counter-clockwise: for each edge its trimmed end
        /// (right kerb to left kerb, with stations across it so the plate meets the crowned road),
        /// then the kerb corner to the next edge. `heights` gets the road height at each point.
        /// </summary>
        public static void PlateOutline(RoadGraph g, int n, List<Vector2> pts, List<float> heights, float wStep = 1.2f)
        {
            pts.Clear();
            heights.Clear();
            RoadNode node = g.Nodes[n];
            int deg = node.Sorted.Count;
            for (int k = 0; k < deg; k++)
            {
                RoadEdge e = g.Edges[node.Sorted[k]];
                float trim = g.TrimAt(e, n);
                float half = e.HalfWidth;
                // Across the edge's end, right kerb (-half) to left kerb (+half).
                foreach (float w in RoadSurfaceStations.Across(e, wStep))
                {
                    pts.Add(g.PointFrom(e, n, trim, w));
                    heights.Add(RoadSurfaceStations.EndHeight(e, w));
                }
                // The corner, without its two ends (the left kerb end was just added; the right
                // kerb end of the next edge starts the next edge's crossing).
                List<Vector2> corner = node.Corners[k];
                for (int i = 1; i < corner.Count - 1; i++)
                {
                    pts.Add(corner[i]);
                    heights.Add(RoadProfile.KerbFaceHeight);
                }
            }
        }
    }
}
