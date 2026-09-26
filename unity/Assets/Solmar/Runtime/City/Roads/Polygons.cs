using System.Collections.Generic;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>Plane geometry on (x, z) polygons for the city's blocks, lots and footprints.</summary>
    public static class Polygons
    {
        /// <summary>Twice-signed area / 2: positive for counter-clockwise (seen from above, x right, z up).</summary>
        public static float SignedArea(IList<Vector2> p)
        {
            float a = 0f;
            for (int i = 0; i < p.Count; i++)
            {
                Vector2 u = p[i], v = p[(i + 1) % p.Count];
                a += u.x * v.y - v.x * u.y;
            }
            return a * 0.5f;
        }

        public static Vector2 Centroid(IList<Vector2> p)
        {
            float a = 0f, cx = 0f, cy = 0f;
            for (int i = 0; i < p.Count; i++)
            {
                Vector2 u = p[i], v = p[(i + 1) % p.Count];
                float c = u.x * v.y - v.x * u.y;
                a += c;
                cx += (u.x + v.x) * c;
                cy += (u.y + v.y) * c;
            }
            if (Mathf.Abs(a) < 1e-4f)
            {
                Vector2 s = Vector2.zero;
                foreach (Vector2 q in p) s += q;
                return p.Count > 0 ? s / p.Count : s;
            }
            return new Vector2(cx / (3f * a), cy / (3f * a));
        }

        public static float Perimeter(IList<Vector2> p, bool closed = true)
        {
            float l = 0f;
            int n = closed ? p.Count : p.Count - 1;
            for (int i = 0; i < n; i++) l += Vector2.Distance(p[i], p[(i + 1) % p.Count]);
            return l;
        }

        public static bool Contains(IList<Vector2> poly, Vector2 pt)
        {
            bool inside = false;
            for (int i = 0, j = poly.Count - 1; i < poly.Count; j = i++)
            {
                Vector2 a = poly[i], b = poly[j];
                if ((a.y > pt.y) != (b.y > pt.y))
                {
                    float x = (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x;
                    if (pt.x < x) inside = !inside;
                }
            }
            return inside;
        }

        /// <summary>Do segments p→q and r→s cross (strictly, not merely touch at their ends)?</summary>
        public static bool SegmentsCross(Vector2 p, Vector2 q, Vector2 r, Vector2 s)
        {
            float d1 = Cross(q - p, r - p), d2 = Cross(q - p, s - p);
            float d3 = Cross(s - r, p - r), d4 = Cross(s - r, q - r);
            return ((d1 > 1e-4f && d2 < -1e-4f) || (d1 < -1e-4f && d2 > 1e-4f)) && ((d3 > 1e-4f && d4 < -1e-4f) || (d3 < -1e-4f && d4 > 1e-4f));
        }

        public static float Cross(Vector2 a, Vector2 b) => a.x * b.y - a.y * b.x;

        /// <summary>Distance from `p` to the segment a→b.</summary>
        public static float DistanceToSegment(Vector2 p, Vector2 a, Vector2 b)
        {
            Vector2 d = b - a;
            float len2 = d.sqrMagnitude;
            float t = len2 > 1e-8f ? Mathf.Clamp01(Vector2.Dot(p - a, d) / len2) : 0f;
            return Vector2.Distance(p, a + d * t);
        }

        /// <summary>Distance from `p` to the nearest edge of a closed polygon.</summary>
        public static float DistanceToEdges(IList<Vector2> poly, Vector2 p)
        {
            float best = float.MaxValue;
            for (int i = 0; i < poly.Count; i++) best = Mathf.Min(best, DistanceToSegment(p, poly[i], poly[(i + 1) % poly.Count]));
            return best;
        }

        /// <summary>
        /// Is the (convex or not) polygon `inner` fully inside `outer`: every corner inside, and no
        /// edges crossing?
        /// </summary>
        public static bool Inside(IList<Vector2> inner, IList<Vector2> outer)
        {
            foreach (Vector2 p in inner)
            {
                if (!Contains(outer, p)) return false;
            }
            for (int i = 0; i < inner.Count; i++)
            {
                Vector2 a = inner[i], b = inner[(i + 1) % inner.Count];
                for (int j = 0; j < outer.Count; j++)
                {
                    if (SegmentsCross(a, b, outer[j], outer[(j + 1) % outer.Count])) return false;
                }
            }
            return true;
        }

        /// <summary>Do two convex polygons overlap (separating axis test)?</summary>
        public static bool ConvexOverlap(IList<Vector2> a, IList<Vector2> b)
        {
            return !HasSeparatingAxis(a, b) && !HasSeparatingAxis(b, a);
        }

        static bool HasSeparatingAxis(IList<Vector2> a, IList<Vector2> b)
        {
            for (int i = 0; i < a.Count; i++)
            {
                Vector2 e = a[(i + 1) % a.Count] - a[i];
                var axis = new Vector2(-e.y, e.x);
                if (axis.sqrMagnitude < 1e-10f) continue;
                float minA = float.MaxValue, maxA = float.MinValue, minB = float.MaxValue, maxB = float.MinValue;
                foreach (Vector2 p in a)
                {
                    float d = Vector2.Dot(p, axis);
                    minA = Mathf.Min(minA, d);
                    maxA = Mathf.Max(maxA, d);
                }
                foreach (Vector2 p in b)
                {
                    float d = Vector2.Dot(p, axis);
                    minB = Mathf.Min(minB, d);
                    maxB = Mathf.Max(maxB, d);
                }
                if (maxA <= minB || maxB <= minA) return true;
            }
            return false;
        }

        /// <summary>
        /// Moves every edge of a closed polygon `d[i]` to its left (inwards for a counter-clockwise
        /// polygon), joining neighbours at the crossing of their offset lines. Nearly parallel
        /// neighbours share the average of their offset points; a mitre longer than `maxMiter`
        /// times the offset is clipped to that length along the bisector. The result has one point
        /// per input point.
        /// </summary>
        public static List<Vector2> Offset(IList<Vector2> poly, IList<float> d, float maxMiter = 4f)
        {
            int n = poly.Count;
            var result = new List<Vector2>(n);
            for (int i = 0; i < n; i++)
            {
                int prev = (i + n - 1) % n;
                Vector2 a0 = poly[prev], a1 = poly[i], b1 = poly[(i + 1) % n];
                Vector2 da = RoadGraph.SafeNormal(a1 - a0), db = RoadGraph.SafeNormal(b1 - a1);
                Vector2 na = RoadGraph.Left(da), nb = RoadGraph.Left(db);
                float oa = d[prev], ob = d[i];
                Vector2 pa = a1 + na * oa, pb = a1 + nb * ob;
                float denom = Cross(da, db);
                Vector2 p;
                if (Mathf.Abs(denom) < 0.03f) p = (pa + pb) * 0.5f;
                else
                {
                    float t = Cross(pb - pa, db) / denom;
                    p = pa + da * t;
                }
                float limit = maxMiter * Mathf.Max(oa, ob);
                Vector2 off = p - a1;
                if (off.magnitude > limit) p = a1 + RoadGraph.SafeNormal(off) * limit;
                result.Add(p);
            }
            return result;
        }

        /// <summary>An open polyline moved `d` to its left, mitred at its bends (clipped at `maxMiter` × d), square at its ends.</summary>
        public static List<Vector2> OffsetOpen(IList<Vector2> line, float d, float maxMiter = 3f)
        {
            int n = line.Count;
            var result = new List<Vector2>(n);
            for (int i = 0; i < n; i++)
            {
                Vector2 dirIn = i > 0 ? RoadGraph.SafeNormal(line[i] - line[i - 1]) : Vector2.zero;
                Vector2 dirOut = i < n - 1 ? RoadGraph.SafeNormal(line[i + 1] - line[i]) : Vector2.zero;
                if (dirIn == Vector2.zero) dirIn = dirOut;
                if (dirOut == Vector2.zero) dirOut = dirIn;
                Vector2 bis = RoadGraph.SafeNormal(RoadGraph.Left(dirIn) + RoadGraph.Left(dirOut));
                float cos = Vector2.Dot(bis, RoadGraph.Left(dirIn));
                float len = cos > 1e-3f ? Mathf.Min(d / cos, d * maxMiter) : d * maxMiter;
                result.Add(line[i] + bis * len);
            }
            return result;
        }

        /// <summary>
        /// Checks an offset polygon kept its shape: every edge still runs the same way as the
        /// original's (not folded back) and is at least `minEdge` long where the original was.
        /// </summary>
        public static bool OffsetValid(IList<Vector2> original, IList<Vector2> offset, float minEdge = 0.5f)
        {
            int n = original.Count;
            if (offset.Count != n || n < 3) return false;
            for (int i = 0; i < n; i++)
            {
                Vector2 o = original[(i + 1) % n] - original[i];
                Vector2 f = offset[(i + 1) % n] - offset[i];
                float len = o.magnitude;
                // Skip degenerate edges, and ones CollapseFolds shrank to a point on purpose.
                if (len < 1e-3f || f.sqrMagnitude < 1e-8f) continue;
                float along = Vector2.Dot(f, o / len);
                if (along < Mathf.Min(minEdge, len * 0.2f)) return false;
            }
            if (Mathf.Sign(SignedArea(offset)) != Mathf.Sign(SignedArea(original))) return false;
            // No two non-adjacent edges crossing.
            for (int i = 0; i < n; i++)
            {
                for (int j = i + 2; j < n; j++)
                {
                    if (i == 0 && j == n - 1) continue;
                    if (SegmentsCross(offset[i], offset[(i + 1) % n], offset[j], offset[(j + 1) % n])) return false;
                }
            }
            return true;
        }

        /// <summary>
        /// Mends an offset polygon where an edge came out running backwards (the offset of a short
        /// edge in a tight concave bend): its two ends meet at their midpoint, until none is left.
        /// Keeps one point per original point.
        /// </summary>
        public static void CollapseFolds(IList<Vector2> original, IList<Vector2> offset)
        {
            int n = original.Count;
            if (offset.Count != n) return;
            for (int iter = 0; iter < 12; iter++)
            {
                bool changed = false;
                for (int i = 0; i < n; i++)
                {
                    int j = (i + 1) % n;
                    Vector2 o = original[j] - original[i];
                    Vector2 f = offset[j] - offset[i];
                    float len = o.magnitude;
                    if (len < 1e-3f || f.sqrMagnitude < 1e-8f) continue;
                    if (Vector2.Dot(f, o / len) >= Mathf.Min(0.5f, len * 0.2f)) continue;
                    Vector2 mid = (offset[i] + offset[j]) * 0.5f;
                    offset[i] = mid;
                    offset[j] = mid;
                    changed = true;
                }
                if (!changed) return;
            }
        }

        /// <summary>Removes consecutive points closer than `eps` (and a closing duplicate).</summary>
        public static List<Vector2> Dedupe(IList<Vector2> p, float eps = 0.05f)
        {
            var r = new List<Vector2>();
            foreach (Vector2 q in p)
            {
                if (r.Count == 0 || (r[r.Count - 1] - q).sqrMagnitude > eps * eps) r.Add(q);
            }
            while (r.Count > 1 && (r[0] - r[r.Count - 1]).sqrMagnitude <= eps * eps) r.RemoveAt(r.Count - 1);
            return r;
        }

        /// <summary>Removes points where the polygon runs straight on (turn under `degrees`), so long straight sides are one edge.</summary>
        public static List<Vector2> Simplify(IList<Vector2> p, float degrees, List<int> keptIndices = null)
        {
            int n = p.Count;
            var r = new List<Vector2>();
            keptIndices?.Clear();
            float limit = Mathf.Sin(degrees * Mathf.Deg2Rad);
            for (int i = 0; i < n; i++)
            {
                Vector2 a = p[(i + n - 1) % n], b = p[i], c = p[(i + 1) % n];
                Vector2 u = RoadGraph.SafeNormal(b - a), v = RoadGraph.SafeNormal(c - b);
                if (Mathf.Abs(Cross(u, v)) < limit && Vector2.Dot(u, v) > 0f) continue;
                r.Add(b);
                keptIndices?.Add(i);
            }
            if (r.Count < 3)
            {
                r.Clear();
                keptIndices?.Clear();
                for (int i = 0; i < n; i++)
                {
                    r.Add(p[i]);
                    keptIndices?.Add(i);
                }
            }
            return r;
        }

        /// <summary>Ear-clipping triangulation of a simple polygon (either winding); indices into `pts`.</summary>
        public static List<int> Triangulate(IList<Vector2> pts)
        {
            var result = new List<int>();
            int count = pts.Count;
            if (count < 3) return result;
            var idx = new List<int>(count);
            for (int i = 0; i < count; i++) idx.Add(i);
            bool ccw = SignedArea(pts) > 0f;
            int guard = 0;
            int start = 0;
            while (idx.Count > 3 && guard++ < count * count + 100)
            {
                bool clipped = false;
                int m = idx.Count;
                for (int step = 0; step < m; step++)
                {
                    int i = (start + step) % m;
                    int ia = idx[(i + m - 1) % m], ib = idx[i], ic = idx[(i + 1) % m];
                    Vector2 a = pts[ia], b = pts[ib], c = pts[ic];
                    float cross = Cross(b - a, c - a);
                    if (ccw ? cross <= 1e-7f : cross >= -1e-7f) continue;
                    bool inside = false;
                    for (int j = 0; j < m && !inside; j++)
                    {
                        int k = idx[j];
                        if (k == ia || k == ib || k == ic) continue;
                        Vector2 p = pts[k];
                        if ((p - a).sqrMagnitude < 1e-8f || (p - b).sqrMagnitude < 1e-8f || (p - c).sqrMagnitude < 1e-8f) continue;
                        inside = InTriangle(p, a, b, c);
                    }
                    if (inside) continue;
                    result.Add(ia);
                    result.Add(ib);
                    result.Add(ic);
                    idx.RemoveAt(i);
                    start = i % Mathf.Max(1, idx.Count);
                    clipped = true;
                    break;
                }
                if (!clipped)
                {
                    // Degenerate remainder (collinear or self-touching): drop a vertex and go on.
                    idx.RemoveAt(start % idx.Count);
                }
            }
            if (idx.Count == 3)
            {
                result.Add(idx[0]);
                result.Add(idx[1]);
                result.Add(idx[2]);
            }
            return result;
        }

        static bool InTriangle(Vector2 p, Vector2 a, Vector2 b, Vector2 c)
        {
            float d1 = Cross(b - a, p - a), d2 = Cross(c - b, p - b), d3 = Cross(a - c, p - c);
            bool neg = d1 < 0f || d2 < 0f || d3 < 0f;
            bool pos = d1 > 0f || d2 > 0f || d3 > 0f;
            return !(neg && pos);
        }
    }
}
