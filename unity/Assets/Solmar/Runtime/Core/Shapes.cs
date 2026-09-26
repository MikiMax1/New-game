using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar
{
    /// <summary>
    /// Growable mesh data (positions, normals, UVs in metres, triangles) with helpers to transform,
    /// append and turn into a Unity Mesh.
    /// </summary>
    public sealed class MeshData
    {
        public readonly List<Vector3> positions = new List<Vector3>();
        public readonly List<Vector3> normals = new List<Vector3>();
        public readonly List<Vector2> uvs = new List<Vector2>();
        public readonly List<int> indices = new List<int>();

        public int VertexCount => positions.Count;

        public int AddVertex(Vector3 p, Vector3 n, Vector2 uv)
        {
            positions.Add(p);
            normals.Add(n);
            uvs.Add(uv);
            return positions.Count - 1;
        }

        public void AddTriangle(int a, int b, int c)
        {
            indices.Add(a);
            indices.Add(b);
            indices.Add(c);
        }

        /// <summary>Applies a transform to positions and normals.</summary>
        public MeshData Transform(Matrix4x4 m)
        {
            Matrix4x4 nm = m.inverse.transpose;
            for (int i = 0; i < positions.Count; i++)
            {
                positions[i] = m.MultiplyPoint3x4(positions[i]);
                normals[i] = nm.MultiplyVector(normals[i]).normalized;
            }
            return this;
        }

        public MeshData Translate(float x, float y, float z)
        {
            return Transform(Matrix4x4.Translate(new Vector3(x, y, z)));
        }

        public MeshData RotateY(float radians)
        {
            return Transform(Matrix4x4.Rotate(Quaternion.Euler(0f, radians * Mathf.Rad2Deg, 0f)));
        }

        public MeshData RotateZ(float radians)
        {
            return Transform(Matrix4x4.Rotate(Quaternion.Euler(0f, 0f, radians * Mathf.Rad2Deg)));
        }

        /// <summary>Appends another mesh's data (optionally transformed).</summary>
        public void Append(MeshData other)
        {
            int baseIndex = positions.Count;
            positions.AddRange(other.positions);
            normals.AddRange(other.normals);
            uvs.AddRange(other.uvs);
            for (int i = 0; i < other.indices.Count; i++) indices.Add(other.indices[i] + baseIndex);
        }

        public MeshData Clone()
        {
            var c = new MeshData();
            c.Append(this);
            return c;
        }

        /// <summary>A single-submesh Unity mesh with tangents for normal mapping.</summary>
        public Mesh ToMesh(string name)
        {
            var mesh = new Mesh { name = name, indexFormat = positions.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            mesh.SetVertices(positions);
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(indices, 0);
            mesh.RecalculateBounds();
            mesh.RecalculateTangents();
            return mesh;
        }
    }

    /// <summary>
    /// A multi-material object: mesh data per named slot, built into one Unity mesh with a submesh
    /// per slot (in the order the slots were first used).
    /// </summary>
    public sealed class Assembly
    {
        readonly List<string> slots = new List<string>();
        readonly Dictionary<string, MeshData> parts = new Dictionary<string, MeshData>();

        public IReadOnlyList<string> Slots => slots;

        public Assembly Add(string slot, MeshData data)
        {
            if (!parts.TryGetValue(slot, out MeshData part))
            {
                part = new MeshData();
                parts.Add(slot, part);
                slots.Add(slot);
            }
            part.Append(data);
            return this;
        }

        public Mesh Build(string name)
        {
            int total = 0;
            foreach (string s in slots) total += parts[s].VertexCount;
            var positions = new List<Vector3>(total);
            var normals = new List<Vector3>(total);
            var uvs = new List<Vector2>(total);
            var mesh = new Mesh { name = name, indexFormat = total > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            var offsets = new List<int>();
            foreach (string s in slots)
            {
                offsets.Add(positions.Count);
                positions.AddRange(parts[s].positions);
                normals.AddRange(parts[s].normals);
                uvs.AddRange(parts[s].uvs);
            }
            mesh.SetVertices(positions);
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uvs);
            mesh.subMeshCount = slots.Count;
            for (int k = 0; k < slots.Count; k++)
            {
                List<int> src = parts[slots[k]].indices;
                var tri = new List<int>(src.Count);
                for (int i = 0; i < src.Count; i++) tri.Add(src[i] + offsets[k]);
                mesh.SetTriangles(tri, k, false);
            }
            mesh.RecalculateBounds();
            mesh.RecalculateTangents();
            return mesh;
        }
    }

    /// <summary>
    /// Parametric shapes with UVs in metres and smooth or crisp normals as the shape needs: surfaces
    /// of revolution, swept tubes, extruded outlines and chamfered boxes.
    /// </summary>
    public static class Shapes
    {
        /// <summary>
        /// A surface of revolution about y from a (radius, height) profile, bottom to top. UVs: u
        /// around the circumference (metres at the widest radius), v along the profile.
        /// </summary>
        public static MeshData Lathe(IList<Vector2> profile, int segments)
        {
            var m = new MeshData();
            int n = profile.Count;
            float maxR = 0f;
            foreach (Vector2 p in profile) maxR = Mathf.Max(maxR, p.x);
            // Profile normals in (r, y): average of the neighbouring segments' outward normals.
            var pn = new Vector2[n];
            var along = new float[n];
            for (int i = 0; i < n; i++)
            {
                Vector2 prev = profile[Mathf.Max(0, i - 1)];
                Vector2 next = profile[Mathf.Min(n - 1, i + 1)];
                Vector2 t = (next - prev).normalized;
                pn[i] = new Vector2(t.y, -t.x);
                if (i > 0) along[i] = along[i - 1] + Vector2.Distance(profile[i], profile[i - 1]);
            }
            for (int s = 0; s <= segments; s++)
            {
                float a = (float)s / segments * Mathf.PI * 2f;
                float ca = Mathf.Cos(a);
                float sa = Mathf.Sin(a);
                for (int i = 0; i < n; i++)
                {
                    Vector2 p = profile[i];
                    var normal = new Vector3(pn[i].x * ca, pn[i].y, pn[i].x * sa);
                    m.AddVertex(new Vector3(p.x * ca, p.y, p.x * sa), normal.normalized, new Vector2((float)s / segments * Mathf.PI * 2f * maxR, along[i]));
                }
            }
            for (int s = 0; s < segments; s++)
            {
                for (int i = 0; i < n - 1; i++)
                {
                    int a = s * n + i;
                    int b = (s + 1) * n + i;
                    // Outward-facing for profiles running bottom to top.
                    m.AddTriangle(a, a + 1, b);
                    m.AddTriangle(b, a + 1, b + 1);
                }
            }
            return m;
        }

        /// <summary>
        /// A tube swept along a path with a radius varying along it (t = 0..1), UVs u around, v along
        /// (metres).
        /// </summary>
        public static MeshData Sweep(IList<Vector3> path, Func<float, float> radius, int radial)
        {
            var m = new MeshData();
            int n = path.Count;
            float along = 0f;
            Vector3 side = Vector3.right;
            for (int i = 0; i < n; i++)
            {
                Vector3 tangent = (path[Mathf.Min(n - 1, i + 1)] - path[Mathf.Max(0, i - 1)]).normalized;
                // Parallel transport of the side vector keeps the rings from twisting.
                if (i == 0)
                {
                    side = Vector3.Cross(tangent, Mathf.Abs(tangent.y) > 0.99f ? Vector3.right : Vector3.up).normalized;
                }
                else
                {
                    side = (side - Vector3.Dot(side, tangent) * tangent).normalized;
                    along += Vector3.Distance(path[i], path[i - 1]);
                }
                Vector3 normal = Vector3.Cross(side, tangent).normalized;
                float r = radius(n > 1 ? (float)i / (n - 1) : 0f);
                for (int k = 0; k <= radial; k++)
                {
                    float a = (float)k / radial * Mathf.PI * 2f;
                    Vector3 dir = side * Mathf.Cos(a) + normal * Mathf.Sin(a);
                    m.AddVertex(path[i] + dir * r, dir, new Vector2((float)k / radial * Mathf.PI * 2f * r, along));
                }
            }
            for (int i = 0; i < n - 1; i++)
            {
                for (int k = 0; k < radial; k++)
                {
                    int a = i * (radial + 1) + k;
                    int b = a + radial + 1;
                    m.AddTriangle(a, b, a + 1);
                    m.AddTriangle(a + 1, b, b + 1);
                }
            }
            FixWinding(m, 0, m.indices.Count);
            return m;
        }

        /// <summary>A tube of constant radius along a smooth curve through the points.</summary>
        public static MeshData Tube(IList<Vector3> points, float radius, int samples = 48, int radial = 12)
        {
            var path = new List<Vector3>(samples + 1);
            for (int i = 0; i <= samples; i++) path.Add(CatmullRom(points, (float)i / samples));
            return Sweep(path, _ => radius, radial);
        }

        /// <summary>
        /// Extrudes a closed outline in the (x, y) plane along +z by `depth`: crisp side faces and
        /// capped ends. The outline may be concave (ear-clipped).
        /// </summary>
        public static MeshData Extrude(IList<Vector2> outline, float depth)
        {
            var m = new MeshData();
            var pts = new List<Vector2>(outline);
            if (SignedArea(pts) < 0f) pts.Reverse();
            int n = pts.Count;
            float along = 0f;
            for (int i = 0; i < n; i++)
            {
                Vector2 a = pts[i];
                Vector2 b = pts[(i + 1) % n];
                Vector2 e = b - a;
                float len = e.magnitude;
                if (len < 1e-6f) continue;
                // Counter-clockwise outline: the outward normal is the edge turned clockwise.
                var normal = new Vector3(e.y / len, -e.x / len, 0f);
                int v0 = m.AddVertex(new Vector3(a.x, a.y, 0f), normal, new Vector2(along, 0f));
                int v1 = m.AddVertex(new Vector3(b.x, b.y, 0f), normal, new Vector2(along + len, 0f));
                int v2 = m.AddVertex(new Vector3(b.x, b.y, depth), normal, new Vector2(along + len, depth));
                int v3 = m.AddVertex(new Vector3(a.x, a.y, depth), normal, new Vector2(along, depth));
                m.AddTriangle(v0, v1, v2);
                m.AddTriangle(v0, v2, v3);
                along += len;
            }
            List<int> tris = Triangulate(pts);
            foreach (float z in new[] { 0f, depth })
            {
                var normal = new Vector3(0f, 0f, z > 0f ? 1f : -1f);
                int start = m.VertexCount;
                foreach (Vector2 p in pts) m.AddVertex(new Vector3(p.x, p.y, z), normal, p);
                for (int t = 0; t < tris.Count; t += 3) m.AddTriangle(start + tris[t], start + tris[t + 1], start + tris[t + 2]);
            }
            FixWinding(m, 0, m.indices.Count);
            return m;
        }

        /// <summary>A disc outline (for lenses, covers and the like).</summary>
        public static List<Vector2> Circle(float radius, int segments, float start = 0f, float end = Mathf.PI * 2f)
        {
            var pts = new List<Vector2>(segments + 1);
            bool full = Mathf.Approximately(end - start, Mathf.PI * 2f);
            int count = full ? segments : segments + 1;
            for (int i = 0; i < count; i++)
            {
                float a = start + (end - start) * i / segments;
                pts.Add(new Vector2(Mathf.Cos(a) * radius, Mathf.Sin(a) * radius));
            }
            return pts;
        }

        /// <summary>
        /// A box with every edge chamfered by `c` (shaded like a rounded arris), centred on the
        /// origin, with box-projected metre UVs. `skip` ("px nx py ny pz nz") leaves faces out.
        /// </summary>
        public static MeshData ChamferBox(float w, float h, float d, float c = 0.01f, string skip = "")
        {
            var m = new MeshData();
            ChamferBoxInto(m, new Vector3(w * 0.5f, h * 0.5f, d * 0.5f), c, skip, Vector3.zero);
            return m;
        }

        /// <summary>Writes a chamfered box of half-extents `half` at `centre` into `m`.</summary>
        public static void ChamferBoxInto(MeshData m, Vector3 half, float c, string skip, Vector3 centre)
        {
            float[] h = { half.x, half.y, half.z };
            c = Mathf.Max(1e-4f, Mathf.Min(c, Mathf.Min(h[0], Mathf.Min(h[1], h[2])) * 0.49f));
            // Faces: (axis, sign, key). Each face has 4 vertices at ±(h - c) on its other axes.
            int[] axes = { 0, 0, 1, 1, 2, 2 };
            int[] signs = { 1, -1, 1, -1, 1, -1 };
            string[] keys = { "px", "nx", "py", "ny", "pz", "nz" };
            int start = m.VertexCount;
            var id = new int[6, 2, 2];
            for (int f = 0; f < 6; f++)
            {
                int ax = axes[f];
                int a = (ax + 1) % 3;
                int b = (ax + 2) % 3;
                for (int ia = 0; ia < 2; ia++)
                {
                    for (int ib = 0; ib < 2; ib++)
                    {
                        float[] p = new float[3];
                        p[ax] = signs[f] * h[ax];
                        p[a] = (ia == 0 ? -1 : 1) * (h[a] - c);
                        p[b] = (ib == 0 ? -1 : 1) * (h[b] - c);
                        float[] nn = new float[3];
                        nn[ax] = signs[f];
                        var pos = new Vector3(p[0], p[1], p[2]) + centre;
                        var normal = new Vector3(nn[0], nn[1], nn[2]);
                        id[f, ia, ib] = m.AddVertex(pos, normal, BoxUV(pos, normal));
                    }
                }
            }
            bool Skipped(int f) => skip.Contains(keys[f]);
            void Tri(int i0, int i1, int i2)
            {
                // Orient outward from the box centre.
                Vector3 A = m.positions[i0] - centre;
                Vector3 B = m.positions[i1] - centre;
                Vector3 C = m.positions[i2] - centre;
                Vector3 g = Vector3.Cross(B - A, C - A);
                if (Vector3.Dot(g, A + B + C) < 0f) m.AddTriangle(i0, i2, i1);
                else m.AddTriangle(i0, i1, i2);
            }
            for (int f = 0; f < 6; f++)
            {
                if (Skipped(f)) continue;
                Tri(id[f, 0, 0], id[f, 1, 0], id[f, 1, 1]);
                Tri(id[f, 0, 0], id[f, 1, 1], id[f, 0, 1]);
            }
            // Corner lookup: the vertex of face f nearest the corner with the given signs.
            int Corner(int f, int[] s)
            {
                int ax = axes[f];
                int a = (ax + 1) % 3;
                int b = (ax + 2) % 3;
                return id[f, s[a] > 0 ? 1 : 0, s[b] > 0 ? 1 : 0];
            }
            for (int f = 0; f < 6; f++)
            {
                for (int g = f + 1; g < 6; g++)
                {
                    if (axes[f] == axes[g] || Skipped(f) || Skipped(g)) continue;
                    int along = 3 - axes[f] - axes[g];
                    var s0 = new int[3];
                    s0[axes[f]] = signs[f];
                    s0[axes[g]] = signs[g];
                    s0[along] = -1;
                    var s1 = (int[])s0.Clone();
                    s1[along] = 1;
                    int q0 = Corner(f, s0), q1 = Corner(f, s1), q2 = Corner(g, s1), q3 = Corner(g, s0);
                    Tri(q0, q1, q2);
                    Tri(q0, q2, q3);
                }
            }
            for (int sx = -1; sx <= 1; sx += 2)
            {
                for (int sy = -1; sy <= 1; sy += 2)
                {
                    for (int sz = -1; sz <= 1; sz += 2)
                    {
                        int[] s = { sx, sy, sz };
                        var tri = new int[3];
                        bool skipped = false;
                        for (int ax = 0; ax < 3; ax++)
                        {
                            int f = ax * 2 + (s[ax] > 0 ? 0 : 1);
                            if (Skipped(f)) skipped = true;
                            tri[ax] = Corner(f, s);
                        }
                        if (!skipped) Tri(tri[0], tri[1], tri[2]);
                    }
                }
            }
        }

        /// <summary>Box-projected UV in metres: the two coordinates across the normal's dominant axis.</summary>
        public static Vector2 BoxUV(Vector3 p, Vector3 n)
        {
            float ax = Mathf.Abs(n.x), ay = Mathf.Abs(n.y), az = Mathf.Abs(n.z);
            if (ay >= ax && ay >= az) return new Vector2(p.x, p.z);
            if (ax >= az) return new Vector2(n.x > 0 ? -p.z : p.z, p.y);
            return new Vector2(n.z > 0 ? p.x : -p.x, p.y);
        }

        /// <summary>Ear-clipping triangulation of a simple polygon; indices into `pts`.</summary>
        public static List<int> Triangulate(IList<Vector2> pts)
        {
            var result = new List<int>();
            var idx = new List<int>();
            for (int i = 0; i < pts.Count; i++) idx.Add(i);
            bool ccw = SignedArea(pts) > 0f;
            int guard = 0;
            while (idx.Count > 3 && guard++ < 10000)
            {
                bool clipped = false;
                for (int i = 0; i < idx.Count; i++)
                {
                    int ia = idx[(i + idx.Count - 1) % idx.Count], ib = idx[i], ic = idx[(i + 1) % idx.Count];
                    Vector2 a = pts[ia], b = pts[ib], c = pts[ic];
                    float cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
                    if (ccw ? cross <= 1e-9f : cross >= -1e-9f) continue;
                    bool inside = false;
                    for (int j = 0; j < idx.Count && !inside; j++)
                    {
                        int k = idx[j];
                        if (k == ia || k == ib || k == ic) continue;
                        inside = PointInTriangle(pts[k], a, b, c);
                    }
                    if (inside) continue;
                    result.Add(ia);
                    result.Add(ib);
                    result.Add(ic);
                    idx.RemoveAt(i);
                    clipped = true;
                    break;
                }
                if (!clipped) break;
            }
            if (idx.Count == 3)
            {
                result.Add(idx[0]);
                result.Add(idx[1]);
                result.Add(idx[2]);
            }
            return result;
        }

        public static float SignedArea(IList<Vector2> pts)
        {
            float a = 0f;
            for (int i = 0; i < pts.Count; i++)
            {
                Vector2 p = pts[i], q = pts[(i + 1) % pts.Count];
                a += p.x * q.y - q.x * p.y;
            }
            return a * 0.5f;
        }

        static bool PointInTriangle(Vector2 p, Vector2 a, Vector2 b, Vector2 c)
        {
            float d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
            float d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
            float d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
            bool neg = d1 < 0 || d2 < 0 || d3 < 0;
            bool pos = d1 > 0 || d2 > 0 || d3 > 0;
            return !(neg && pos);
        }

        /// <summary>Orders each triangle so its geometric normal agrees with its vertex normals.</summary>
        public static void FixWinding(MeshData m, int from, int to)
        {
            for (int t = from; t < to; t += 3)
            {
                int a = m.indices[t], b = m.indices[t + 1], c = m.indices[t + 2];
                Vector3 g = Vector3.Cross(m.positions[b] - m.positions[a], m.positions[c] - m.positions[a]);
                Vector3 n = m.normals[a] + m.normals[b] + m.normals[c];
                if (Vector3.Dot(g, n) < 0f)
                {
                    m.indices[t + 1] = c;
                    m.indices[t + 2] = b;
                }
            }
        }

        /// <summary>Centripetal-ish Catmull-Rom through the points, t in 0..1.</summary>
        public static Vector3 CatmullRom(IList<Vector3> p, float t)
        {
            int n = p.Count;
            if (n == 1) return p[0];
            float f = t * (n - 1);
            int i = Mathf.Min(n - 2, Mathf.FloorToInt(f));
            float u = f - i;
            Vector3 p0 = p[Mathf.Max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Mathf.Min(n - 1, i + 2)];
            float u2 = u * u, u3 = u2 * u;
            return 0.5f * (2f * p1 + (-p0 + p2) * u + (2f * p0 - 5f * p1 + 4f * p2 - p3) * u2 + (-p0 + 3f * p1 - 3f * p2 + p3) * u3);
        }
    }
}
