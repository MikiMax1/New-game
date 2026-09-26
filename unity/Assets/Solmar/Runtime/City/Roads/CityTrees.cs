using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>
    /// The city's trees, planted by tile. The palms down Ocean Boulevard's median are
    /// the detailed ones from <see cref="Palms"/>; everywhere else (the promenade, avenue medians, parks,
    /// plazas, yards) there are too many for that, so they are lighter models built here: a leaning, tapering
    /// palm trunk with a crown of drooping fronds of paired leaflets (about 350 triangles), and a
    /// broadleaf shade tree (a gnarled trunk under a canopy of lumpy clumps). Trunks are solid;
    /// leaves are not (you walk and drive through them) and are dropped only far away.
    /// </summary>
    public static class CityTrees
    {
        /// <summary>Plants detailed palms at `detailed`, light palms at `palms` and shade trees at `trees` (bases on the ground).</summary>
        public static void Build(CityTiles tiles, CityMaterials m, Material canopy, IList<Vector3> detailed, IList<Vector3> palms, IList<Vector3> trees, Rng random)
        {
            // Detailed palms, grouped by tile.
            var byTile = new Dictionary<Transform, List<Vector3>>();
            foreach (Vector3 p in detailed)
            {
                Transform group = tiles.Foliage(new Vector2(p.x, p.z));
                if (!byTile.TryGetValue(group, out List<Vector3> list)) byTile.Add(group, list = new List<Vector3>());
                list.Add(p);
            }
            foreach (KeyValuePair<Transform, List<Vector3>> kv in byTile) Palms.Build(kv.Key, kv.Value, m, random, false);

            foreach (Vector3 p in palms)
            {
                var at = new Vector2(p.x, p.z);
                Palm(p, tiles.Surface(at, "Palm trunks", m.Bark), tiles.Surface(at, "Palm leaves", m.Leaf, CityTiles.Layer.Foliage), random);
            }
            foreach (Vector3 p in trees)
            {
                var at = new Vector2(p.x, p.z);
                Tree(p, tiles.Surface(at, "Tree trunks", m.Bark), tiles.Surface(at, "Tree canopies", canopy, CityTiles.Layer.Foliage), random);
            }
        }

        /// <summary>A tube through `centres` with a radius per ring, `sides` around.</summary>
        static void Trunk(MeshData m, IList<Vector3> centres, IList<float> radii, int sides)
        {
            int rings = centres.Count;
            int start = m.VertexCount;
            for (int i = 0; i < rings; i++)
            {
                for (int k = 0; k <= sides; k++)
                {
                    float a = k / (float)sides * Mathf.PI * 2f;
                    var n = new Vector3(Mathf.Cos(a), 0f, Mathf.Sin(a));
                    m.AddVertex(centres[i] + n * radii[i], n, new Vector2(k / (float)sides * radii[0] * 6.28f, centres[i].y));
                }
            }
            int first = m.indices.Count;
            for (int i = 0; i < rings - 1; i++)
            {
                for (int k = 0; k < sides; k++)
                {
                    int a = start + i * (sides + 1) + k, b = a + 1, c = a + sides + 1, d = c + 1;
                    m.AddTriangle(a, c, b);
                    m.AddTriangle(b, c, d);
                }
            }
            Shapes.FixWinding(m, first, m.indices.Count);
        }

        static void Palm(Vector3 b, MeshData trunk, MeshData leaves, Rng random)
        {
            float height = random.Range(7f, 11f);
            float leanDir = random.Next() * Mathf.PI * 2f;
            float lean = random.Range(0.2f, 1.1f);
            var centres = new List<Vector3>();
            var radii = new List<float>();
            const int rings = 9;
            for (int i = 0; i <= rings; i++)
            {
                float t = (float)i / rings;
                centres.Add(new Vector3(b.x + Mathf.Cos(leanDir) * lean * t * t, b.y - 0.1f + height * t, b.z + Mathf.Sin(leanDir) * lean * t * t));
                radii.Add(0.2f - 0.06f * t + 0.1f * Mathf.Exp(-t * 12f));
            }
            Trunk(trunk, centres, radii, 6);
            Vector3 top = centres[rings] + new Vector3(0f, 0.2f, 0f);
            int fronds = 11 + (int)(random.Next() * 3f);
            for (int k = 0; k < fronds; k++)
            {
                float heading = k / (float)fronds * Mathf.PI * 2f + random.Next() * 0.4f;
                float pitch = 0.6f - (k % 3) * 0.35f - random.Next() * 0.2f;
                Frond(leaves, top, heading, pitch, random.Range(2.6f, 3.4f), random.Range(0.4f, 0.65f));
            }
        }

        /// <summary>A frond: a drooping rachis with a V of leaflets along it, as two strips of quads.</summary>
        static void Frond(MeshData m, Vector3 start, float heading, float pitch, float length, float droop)
        {
            var dir = new Vector3(Mathf.Cos(heading) * Mathf.Cos(pitch), Mathf.Sin(pitch), Mathf.Sin(heading) * Mathf.Cos(pitch));
            const int steps = 5;
            var pts = new Vector3[steps + 1];
            for (int i = 0; i <= steps; i++)
            {
                float s = (float)i / steps;
                pts[i] = start + dir * (s * length) + new Vector3(0f, -droop * s * s * length, 0f);
            }
            int first = m.indices.Count;
            foreach (float side in new[] { -1f, 1f })
            {
                int prevIn = -1, prevOut = -1;
                for (int i = 0; i <= steps; i++)
                {
                    float s = (float)i / steps;
                    Vector3 tangent = (pts[Mathf.Min(steps, i + 1)] - pts[Mathf.Max(0, i - 1)]).normalized;
                    Vector3 lateral = Vector3.Cross(tangent, Vector3.up).normalized;
                    Vector3 lift = Vector3.Cross(lateral, tangent).normalized;
                    float w = 0.75f * Mathf.Sin(Mathf.PI * Mathf.Clamp(s * 1.05f, 0f, 1f)) + 0.08f;
                    Vector3 outer = pts[i] + (lateral * side * 0.85f + lift * 0.35f + tangent * 0.45f).normalized * w - new Vector3(0f, 0.18f * w, 0f);
                    Vector3 n = Vector3.Cross(tangent, lateral * side).normalized;
                    if (n.y < 0f) n = -n;
                    int iIn = m.AddVertex(pts[i], n, new Vector2(0f, s));
                    int iOut = m.AddVertex(outer, n, new Vector2(1f, s));
                    if (prevIn >= 0)
                    {
                        m.AddTriangle(prevIn, iIn, iOut);
                        m.AddTriangle(prevIn, iOut, prevOut);
                    }
                    prevIn = iIn;
                    prevOut = iOut;
                }
            }
            Shapes.FixWinding(m, first, m.indices.Count);
        }

        static readonly Vector3[] Ico = BuildIco();

        static readonly int[] IcoTris =
        {
            0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
            3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
        };

        static Vector3[] BuildIco()
        {
            float t = (1f + Mathf.Sqrt(5f)) * 0.5f;
            var v = new[]
            {
                new Vector3(-1, t, 0), new Vector3(1, t, 0), new Vector3(-1, -t, 0), new Vector3(1, -t, 0),
                new Vector3(0, -1, t), new Vector3(0, 1, t), new Vector3(0, -1, -t), new Vector3(0, 1, -t),
                new Vector3(t, 0, -1), new Vector3(t, 0, 1), new Vector3(-t, 0, -1), new Vector3(-t, 0, 1),
            };
            for (int i = 0; i < v.Length; i++) v[i] = v[i].normalized;
            return v;
        }

        static void Tree(Vector3 b, MeshData trunk, MeshData canopy, Rng random)
        {
            float height = random.Range(3f, 4.5f);
            float spread = random.Range(2.2f, 3.4f);
            float leanDir = random.Next() * Mathf.PI * 2f;
            var centres = new List<Vector3>();
            var radii = new List<float>();
            for (int i = 0; i <= 3; i++)
            {
                float t = i / 3f;
                centres.Add(new Vector3(b.x + Mathf.Cos(leanDir) * 0.4f * t, b.y - 0.1f + height * t, b.z + Mathf.Sin(leanDir) * 0.4f * t));
                radii.Add(Mathf.Lerp(0.26f, 0.13f, t));
            }
            Trunk(trunk, centres, radii, 6);
            Vector3 top = centres[3];
            int clumps = 4 + (int)(random.Next() * 3f);
            for (int k = 0; k < clumps; k++)
            {
                float a = k / (float)clumps * Mathf.PI * 2f + random.Next();
                float r = k == 0 ? 0f : spread * random.Range(0.45f, 0.8f);
                var c = top + new Vector3(Mathf.Cos(a) * r, random.Range(0.6f, 1.8f), Mathf.Sin(a) * r);
                float size = spread * random.Range(0.55f, 0.8f);
                Clump(canopy, c, size, new Vector3(1f, random.Range(0.6f, 0.8f), 1f), random);
            }
        }

        /// <summary>A lumpy, flattened ball of leaves: an icosahedron with jittered radii.</summary>
        static void Clump(MeshData m, Vector3 centre, float radius, Vector3 scale, Rng random)
        {
            int start = m.VertexCount;
            int first = m.indices.Count;
            foreach (Vector3 v in Ico)
            {
                float r = radius * random.Range(0.8f, 1.15f);
                var p = new Vector3(v.x * scale.x, v.y * scale.y, v.z * scale.z) * r;
                m.AddVertex(centre + p, v, new Vector2(v.x + v.z, v.y) * radius);
            }
            for (int t = 0; t < IcoTris.Length; t += 3) m.AddTriangle(start + IcoTris[t], start + IcoTris[t + 1], start + IcoTris[t + 2]);
            Shapes.FixWinding(m, first, m.indices.Count);
        }
    }
}
