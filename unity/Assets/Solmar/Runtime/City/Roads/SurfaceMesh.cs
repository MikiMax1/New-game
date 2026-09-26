using System.Collections.Generic;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Small helpers that write flat and boxy city geometry into MeshData, with UVs in metres
    /// (world x, z for anything facing up), so neighbouring pieces tile seamlessly.
    /// </summary>
    public static class SurfaceMesh
    {
        /// <summary>A flat, upward-facing polygon (any simple outline, either winding) at height `y`.</summary>
        public static void Polygon(MeshData m, IList<Vector2> poly, float y)
        {
            if (poly.Count < 3) return;
            List<int> tris = Polygons.Triangulate(poly);
            int start = m.VertexCount;
            int first = m.indices.Count;
            foreach (Vector2 p in poly) m.AddVertex(new Vector3(p.x, y, p.y), Vector3.up, p);
            for (int t = 0; t + 2 < tris.Count; t += 3) m.AddTriangle(start + tris[t], start + tris[t + 1], start + tris[t + 2]);
            Shapes.FixWinding(m, first, m.indices.Count);
        }

        /// <summary>An upward-facing polygon with its own height at each corner.</summary>
        public static void Polygon(MeshData m, IList<Vector2> poly, IList<float> heights)
        {
            if (poly.Count < 3) return;
            List<int> tris = Polygons.Triangulate(poly);
            int start = m.VertexCount;
            int first = m.indices.Count;
            for (int i = 0; i < poly.Count; i++) m.AddVertex(new Vector3(poly[i].x, heights[i], poly[i].y), Vector3.up, poly[i]);
            for (int t = 0; t + 2 < tris.Count; t += 3) m.AddTriangle(start + tris[t], start + tris[t + 1], start + tris[t + 2]);
            Shapes.FixWinding(m, first, m.indices.Count);
        }

        /// <summary>An upward-facing triangle at height `y`.</summary>
        public static void Triangle(MeshData m, Vector2 a, Vector2 b, Vector2 c, float y)
        {
            if (Mathf.Abs(Polygons.Cross(b - a, c - a)) < 1e-5f) return;
            int first = m.indices.Count;
            int i0 = m.AddVertex(new Vector3(a.x, y, a.y), Vector3.up, a);
            int i1 = m.AddVertex(new Vector3(b.x, y, b.y), Vector3.up, b);
            int i2 = m.AddVertex(new Vector3(c.x, y, c.y), Vector3.up, c);
            m.AddTriangle(i0, i1, i2);
            Shapes.FixWinding(m, first, m.indices.Count);
        }

        /// <summary>A quad a, b, c, d (in order round it) facing `normal`, UVs from `uv` per corner.</summary>
        public static void Quad(MeshData m, Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 normal, Vector2 ua, Vector2 ub, Vector2 uc, Vector2 ud)
        {
            int first = m.indices.Count;
            int i0 = m.AddVertex(a, normal, ua);
            int i1 = m.AddVertex(b, normal, ub);
            int i2 = m.AddVertex(c, normal, uc);
            int i3 = m.AddVertex(d, normal, ud);
            m.AddTriangle(i0, i1, i2);
            m.AddTriangle(i0, i2, i3);
            Shapes.FixWinding(m, first, m.indices.Count);
        }

        /// <summary>An upward-facing quad over four ground points at the given heights (world-xz UVs).</summary>
        public static void GroundQuad(MeshData m, Vector2 a, float ya, Vector2 b, float yb, Vector2 c, float yc, Vector2 d, float yd)
        {
            Quad(m, new Vector3(a.x, ya, a.y), new Vector3(b.x, yb, b.y), new Vector3(c.x, yc, c.y), new Vector3(d.x, yd, d.y), Vector3.up, a, b, c, d);
        }

        /// <summary>
        /// A box lying along the ground segment p→q: `width` across it (centred `offsetRight` to the
        /// right of the segment, looking from p to q), from height y0 to y1, chamfered by `c`.
        /// </summary>
        public static void BoxAlong(MeshData m, Vector2 p, Vector2 q, float offsetRight, float width, float y0, float y1, float c = 0.012f, float extend = 0f)
        {
            Vector2 d = q - p;
            float len = d.magnitude;
            if (len < 1e-3f || y1 <= y0 || width <= 0f) return;
            d /= len;
            Vector2 right = new Vector2(d.y, -d.x);
            Vector2 mid = (p + q) * 0.5f + right * offsetRight;
            float yaw = Mathf.Atan2(d.x, d.y);
            m.Append(Shapes.ChamferBox(width, y1 - y0, len + extend * 2f, Mathf.Min(c, width * 0.3f, (y1 - y0) * 0.3f)).RotateY(yaw).Translate(mid.x, (y0 + y1) * 0.5f, mid.y));
        }

        /// <summary>Evenly spaced stations from `from` to `to` (inclusive), at most `step` apart.</summary>
        public static List<float> Stations(float from, float to, float step)
        {
            var list = new List<float>();
            if (to <= from + 1e-4f)
            {
                list.Add(from);
                return list;
            }
            int n = Mathf.Max(1, Mathf.CeilToInt((to - from) / step));
            for (int i = 0; i <= n; i++) list.Add(from + (to - from) * i / n);
            return list;
        }
    }
}
