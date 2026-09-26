using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar.City
{
    /// <summary>
    /// Palms in tree pits, grown procedurally.
    ///
    /// Pit: a 1.4 m opening in the pavement edged with granite kerbs 3 cm proud of the paving, a bed
    /// of bark mulch and tufts of ground cover (mondo grass). Palms don't grow out of concrete.
    ///
    /// Trunk: a circle swept up a gently leaning curve, 0.21 m tapering to 0.15, a swollen base and
    /// the ring scars of fallen fronds every ~9 cm. Crown: 16–20 fronds, each a rachis arcing out
    /// and drooping under its weight with leaflets in a V along both sides, longest mid-frond; a
    /// few dead fronds hang below with a cluster of coconuts. All real geometry, no alpha cut-outs.
    /// </summary>
    public static class Palms
    {
        const float Pit = 1.4f;

        public static void Build(Transform parent, IList<Vector3> bases, CityMaterials m, Rng random)
        {
            var trunks = new MeshData();
            var leaves = new MeshData();
            var dead = new MeshData();
            var stems = new MeshData();
            var nuts = new MeshData();
            var edging = new MeshData();
            var soil = new MeshData();
            var cover = new MeshData();
            foreach (Vector3 b in bases)
            {
                TreePit(b, edging, soil, cover, random);
                Tree(b, trunks, leaves, dead, stems, nuts, random);
            }
            var root = new GameObject("Palms");
            root.transform.SetParent(parent, false);
            Add(root.transform, "Tree pit edging", edging, m.Granite);
            Add(root.transform, "Tree pit mulch", soil, m.Mulch);
            Add(root.transform, "Ground cover", cover, m.GroundCover);
            Add(root.transform, "Palm trunks", trunks, m.Bark);
            Add(root.transform, "Palm leaves", leaves, m.Leaf);
            Add(root.transform, "Dead fronds", dead, m.DeadLeaf);
            Add(root.transform, "Palm stems", stems, m.Leaf);
            Add(root.transform, "Coconuts", nuts, m.Bark);
        }

        static void Add(Transform parent, string name, MeshData data, Material material)
        {
            if (data.VertexCount == 0) return;
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            Mesh mesh = data.ToMesh(name);
            mesh.hideFlags = HideFlags.DontSave;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = material;
            r.shadowCastingMode = ShadowCastingMode.On;
            go.isStatic = true;
        }

        static void TreePit(Vector3 b, MeshData edging, MeshData soil, MeshData cover, Rng random)
        {
            float h = Pit / 2f;
            const float e = 0.08f;
            // Edging: four granite kerbs, their tops 3 cm above the paving.
            edging.Append(Shapes.ChamferBox(Pit + 2f * e, 0.2f, e, 0.012f).Translate(b.x, b.y - 0.07f, b.z - h - e / 2f));
            edging.Append(Shapes.ChamferBox(Pit + 2f * e, 0.2f, e, 0.012f).Translate(b.x, b.y - 0.07f, b.z + h + e / 2f));
            edging.Append(Shapes.ChamferBox(e, 0.2f, Pit, 0.012f).Translate(b.x - h - e / 2f, b.y - 0.07f, b.z));
            edging.Append(Shapes.ChamferBox(e, 0.2f, Pit, 0.012f).Translate(b.x + h + e / 2f, b.y - 0.07f, b.z));
            // Mulch bed: just over the paving under it, 2.5 cm below the edging's top.
            soil.Append(Shapes.ChamferBox(Pit, 0.1f, Pit, 0.02f).Translate(b.x, b.y - 0.045f, b.z));
            // Ground cover: tufts of narrow arching blades.
            for (int t = 0; t < 14; t++)
            {
                float a = t / 14f * Mathf.PI * 2f + random.Next();
                float r = 0.28f + random.Next() * 0.32f;
                float cx = b.x + Mathf.Clamp(Mathf.Cos(a) * r, -h + 0.12f, h - 0.12f);
                float cz = b.z + Mathf.Clamp(Mathf.Sin(a) * r, -h + 0.12f, h - 0.12f);
                for (int k = 0; k < 26; k++)
                {
                    float dir = random.Next() * Mathf.PI * 2f;
                    float len = 0.24f + random.Next() * 0.2f;
                    float lean = 0.35f + random.Next() * 0.5f;
                    float dx = Mathf.Cos(dir), dz = Mathf.Sin(dir);
                    const float w = 0.006f;
                    var p0 = new Vector3(cx - dz * w, b.y, cz + dx * w);
                    var p1 = new Vector3(cx + dz * w, b.y, cz - dx * w);
                    var p2 = new Vector3(cx + dx * len * lean, b.y + len * (1f - lean * 0.5f), cz + dz * len * lean);
                    Vector3 n = Vector3.Cross(p1 - p0, p2 - p0).normalized;
                    int i0 = cover.AddVertex(p0, n, new Vector2(0, 0));
                    int i1 = cover.AddVertex(p1, n, new Vector2(1, 0));
                    int i2 = cover.AddVertex(p2, n, new Vector2(0.5f, 1));
                    cover.AddTriangle(i0, i1, i2);
                }
            }
        }

        static void Tree(Vector3 b, MeshData trunks, MeshData leaves, MeshData dead, MeshData stems, MeshData nuts, Rng random)
        {
            float height = 8f + random.Next() * 4f;
            float leanDir = random.Next() * Mathf.PI * 2f;
            float lean = 0.3f + random.Next() * 0.9f;
            var path = new List<Vector3>();
            const int rings = 90;
            for (int i = 0; i <= rings; i++)
            {
                float t = (float)i / rings;
                path.Add(new Vector3(b.x + Mathf.Cos(leanDir) * lean * t * t, b.y + height * t - 0.1f, b.z + Mathf.Sin(leanDir) * lean * t * t));
            }
            float scars = height / 0.09f;
            trunks.Append(Shapes.Sweep(path, t =>
            {
                float taper = 0.21f - 0.06f * t;
                float bulb = 0.12f * Mathf.Exp(-t * 14f);
                float ring = Mathf.Pow(Mathf.Abs(Mathf.Sin(t * scars * Mathf.PI)), 12f) * 0.012f;
                return taper + bulb + ring;
            }, 16));
            Vector3 top = path[rings];
            int count = 16 + (int)(random.Next() * 5);
            for (int k = 0; k < count; k++)
            {
                float heading = (float)k / count * Mathf.PI * 2f + random.Next() * 0.3f;
                float pitch = 0.75f - (k % 3) * 0.35f - random.Next() * 0.25f;
                Frond(leaves, stems, top + new Vector3(0f, 0.25f, 0f), heading, pitch, 2.8f + random.Next() * 0.9f, 0.35f + random.Next() * 0.25f, random);
            }
            for (int k = 0; k < 4; k++)
            {
                Frond(dead, stems, top + new Vector3(0f, -0.1f, 0f), random.Next() * Mathf.PI * 2f, -1.15f - random.Next() * 0.2f, 2.2f + random.Next() * 0.5f, 0.1f, random);
            }
            for (int k = 0; k < 5; k++)
            {
                float a = random.Next() * Mathf.PI * 2f;
                var profile = new List<Vector2>();
                for (int i = 0; i <= 8; i++)
                {
                    float phi = -Mathf.PI / 2f + i / 8f * Mathf.PI;
                    profile.Add(new Vector2(Mathf.Max(0.0001f, Mathf.Cos(phi) * 0.1f), Mathf.Sin(phi) * 0.12f));
                }
                nuts.Append(Shapes.Lathe(profile, 10).Translate(top.x + Mathf.Cos(a) * 0.22f, top.y - 0.15f - random.Next() * 0.15f, top.z + Mathf.Sin(a) * 0.22f));
            }
        }

        static void Frond(MeshData leaves, MeshData stems, Vector3 start, float heading, float pitch, float length, float droop, Rng random)
        {
            var dir = new Vector3(Mathf.Cos(heading) * Mathf.Cos(pitch), Mathf.Sin(pitch), Mathf.Sin(heading) * Mathf.Cos(pitch));
            const int steps = 26;
            var pts = new List<Vector3>();
            for (int i = 0; i <= steps; i++)
            {
                float s = (float)i / steps;
                pts.Add(start + dir * (s * length) + new Vector3(0f, -droop * s * s * length, 0f));
            }
            stems.Append(Shapes.Sweep(pts, t => 0.035f * (1f - t) + 0.006f, 5));
            const int pairs = 38;
            for (int i = 0; i < pairs; i++)
            {
                float s = 0.12f + (float)i / (pairs - 1) * 0.86f;
                float f = s * steps;
                int i0 = Mathf.Min(steps - 1, Mathf.FloorToInt(f));
                Vector3 p = Vector3.Lerp(pts[i0], pts[i0 + 1], f - i0);
                Vector3 tangent = (pts[i0 + 1] - pts[i0]).normalized;
                Vector3 lateral = Vector3.Cross(tangent, Vector3.up).normalized;
                Vector3 lift = Vector3.Cross(lateral, tangent).normalized;
                float len = 0.85f * Mathf.Pow(Mathf.Sin(Mathf.PI * Mathf.Min(1f, s * 1.05f)), 0.55f) + 0.1f;
                foreach (float side in new[] { -1f, 1f })
                {
                    // Leaflet: out to the side, raised in a V, swept forward towards the tip.
                    Vector3 d = (lateral * side + lift * (0.55f + random.Next() * 0.2f) + tangent * 0.75f).normalized;
                    Vector3 droopV = new Vector3(0f, -0.25f * len, 0f);
                    const float w = 0.035f;
                    Vector3 a = p - tangent * w;
                    Vector3 bb = p + tangent * w;
                    Vector3 mid = p + d * (len * 0.55f) + droopV * 0.3f;
                    Vector3 tip = p + d * len + droopV;
                    Vector3 m0 = mid - tangent * (w * 1.3f);
                    Vector3 m1 = mid + tangent * (w * 1.3f);
                    Vector3 n = Vector3.Cross(bb - a, m0 - a).normalized;
                    int v0 = leaves.AddVertex(a, n, new Vector2(0, 0));
                    int v1 = leaves.AddVertex(bb, n, new Vector2(1, 0));
                    int v2 = leaves.AddVertex(m0, n, new Vector2(0, 0.55f));
                    int v3 = leaves.AddVertex(m1, n, new Vector2(1, 0.55f));
                    int v4 = leaves.AddVertex(tip, n, new Vector2(0.5f, 1));
                    leaves.AddTriangle(v0, v1, v3);
                    leaves.AddTriangle(v0, v3, v2);
                    leaves.AddTriangle(v2, v3, v4);
                }
            }
        }
    }
}
