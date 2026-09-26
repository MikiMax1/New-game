using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Everything round and under the streets: one sheet of land a few centimetres below the roads
    /// running out to the horizon (so there is never a hole to fall through), sloping down the beach
    /// under the sea; the ocean; the waterfront promenade with its sea wall and palms; the raised
    /// lots of the buildings outside the ring road; and a kerb-like verge edge where the ring's
    /// outer pavement drops to the land.
    ///
    /// The land is laid out across the coast rather than along x, so its rows of vertices follow
    /// the curving shore and the beach keeps the same profile the whole way up it.
    /// </summary>
    public static class CityGround
    {
        /// <summary>Height of the land outside the city (and of the sheet hidden under it).</summary>
        public const float LandY = -0.05f;
        /// <summary>Height of the sea.</summary>
        public const float SeaY = -0.35f;
        /// <summary>How wide the promenade is, from the back of the boulevard's pavement to the sea wall.</summary>
        public const float PromenadeWidth = 12f;

        /// <summary>Distance from the shore line (<see cref="CityLayout.ShoreX"/>) at which the sand starts; negative is inland.</summary>
        const float SandFrom = -120f;
        const float WetSandFrom = -50f;

        /// <summary>Stations across the coast (metres east of the shore line), fine on the beach.</summary>
        static readonly float[] UStations = BuildU();
        /// <summary>Stations north-south, fine over the city and coarse towards the horizon.</summary>
        static readonly float[] ZStations = BuildZ();

        static float[] BuildU()
        {
            var u = new List<float>();
            for (float x = -7000f; x < -600f; x += 400f) u.Add(x);
            for (float x = -600f; x < -140f; x += 20f) u.Add(x);
            for (float x = -140f; x < 40f; x += 5f) u.Add(x);
            for (float x = 40f; x < 600f; x += 40f) u.Add(x);
            for (float x = 600f; x <= 2600f; x += 500f) u.Add(x);
            return u.ToArray();
        }

        static float[] BuildZ()
        {
            var z = new List<float>();
            for (float v = -6000f; v < -3000f; v += 300f) z.Add(v);
            for (float v = -3000f; v < 3000f; v += 25f) z.Add(v);
            for (float v = 3000f; v <= 6000f; v += 300f) z.Add(v);
            return z.ToArray();
        }

        /// <summary>Height of the land `u` metres east of the shore line: flat inland, a wide beach sloping into the sea, then the sea bed.</summary>
        public static float Height(float u)
        {
            if (u <= -80f) return LandY;
            if (u <= 30f)
            {
                float t = (u + 80f) / 110f;
                return Mathf.Lerp(LandY, -0.8f, t * (0.6f + 0.4f * t));
            }
            return Mathf.Max(-8f, -0.8f - (u - 30f) * 0.012f);
        }

        /// <summary>Height of the land at a point (the lots, pavements and roads of the city stand above it).</summary>
        public static float HeightAt(Vector2 p) => Height(p.x - CityLayout.ShoreX(p.y));

        public static void Build(CityPlan plan, Transform parent, CityTiles tiles, CityMaterials m, Material lawn, Material ocean, List<Vector3> palms, List<Vector3> trees, Rng random)
        {
            Material sand = m.Stucco(new Color(0.9f, 0.83f, 0.68f));
            Material wetSand = m.Stucco(new Color(0.66f, 0.58f, 0.45f));
            Land(tiles, lawn, sand, wetSand);
            Ocean(parent, ocean);
            if (plan.Outside != null && plan.Outside.PavementValid) Verge(plan.Outside.BuildingLine, tiles, m);
            foreach (List<Vector2> run in plan.OutskirtRuns) Lots(run, tiles, m);
            Promenade(plan.Waterfront, tiles, m, palms);
            Countryside(plan, palms, trees, random);
        }

        /// <summary>The sheet of land, quad by quad into the tile each falls in.</summary>
        static void Land(CityTiles tiles, Material lawn, Material sand, Material wetSand)
        {
            for (int j = 0; j + 1 < ZStations.Length; j++)
            {
                float z0 = ZStations[j], z1 = ZStations[j + 1];
                float s0 = CityLayout.ShoreX(z0), s1 = CityLayout.ShoreX(z1);
                for (int i = 0; i + 1 < UStations.Length; i++)
                {
                    float u0 = UStations[i], u1 = UStations[i + 1];
                    float um = (u0 + u1) * 0.5f;
                    var a = new Vector2(s0 + u0, z0);
                    var b = new Vector2(s0 + u1, z0);
                    var c = new Vector2(s1 + u1, z1);
                    var d = new Vector2(s1 + u0, z1);
                    Vector2 centre = (a + b + c + d) * 0.25f;
                    // Far out, the land joins the outermost tiles rather than making hundreds of tiles of its own.
                    centre = new Vector2(Mathf.Clamp(centre.x, -1500f, 1500f), Mathf.Clamp(centre.y, -1500f, 1500f));
                    Material mat = um < SandFrom ? lawn : um < WetSandFrom ? sand : wetSand;
                    string name = um < SandFrom ? "Land" : "Beach";
                    MeshData data = tiles.Surface(centre, name, mat, CityTiles.Layer.Ground);
                    SurfaceMesh.GroundQuad(data, a, Height(u0), b, Height(u1), c, Height(u1), d, Height(u0));
                }
            }
        }

        /// <summary>The sea: a flat sheet from under the beach out past the far clip plane. Not solid (a car that drives in sinks to the sea bed).</summary>
        static void Ocean(Transform parent, Material ocean)
        {
            var data = new MeshData();
            float[] us = { -100f, 0f, 300f, 1500f, 5000f, 13000f };
            var zs = new List<float>();
            zs.Add(-13000f);
            for (float z = -6000f; z <= 6000f; z += 50f) zs.Add(z);
            zs.Add(13000f);
            int cols = us.Length;
            for (int j = 0; j < zs.Count; j++)
            {
                float z = zs[j];
                float shore = CityLayout.ShoreX(Mathf.Clamp(z, -6000f, 6000f));
                for (int i = 0; i < cols; i++)
                {
                    var p = new Vector3(shore + us[i], SeaY, z);
                    data.AddVertex(p, Vector3.up, new Vector2(p.x, p.z) * 0.1f);
                }
            }
            for (int j = 0; j + 1 < zs.Count; j++)
            {
                for (int i = 0; i + 1 < cols; i++)
                {
                    int a = j * cols + i, b = a + 1, c = a + cols + 1, d = a + cols;
                    data.AddTriangle(a, d, c);
                    data.AddTriangle(a, c, b);
                }
            }
            Shapes.FixWinding(data, 0, data.indices.Count);
            var go = new GameObject("Ocean");
            go.transform.SetParent(parent, false);
            Mesh mesh = data.ToMesh("Ocean");
            mesh.hideFlags = HideFlags.DontSave;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = ocean;
            r.shadowCastingMode = ShadowCastingMode.Off;
        }

        /// <summary>
        /// The edge where the ring's outer pavement (at kerb height) drops to the land: a granite
        /// face along the outside's building line, facing out (the outside is on its left).
        /// </summary>
        static void Verge(List<Vector2> line, CityTiles tiles, CityMaterials m)
        {
            int n = line.Count;
            for (int i = 0; i < n; i++)
            {
                Vector2 p = line[i], q = line[(i + 1) % n];
                Vector2 d = q - p;
                if (d.sqrMagnitude < 1e-4f) continue;
                Vector2 left = RoadGraph.Left(RoadGraph.SafeNormal(d));
                Vector2 mid = (p + q) * 0.5f;
                float bottom = Mathf.Min(HeightAt(p), HeightAt(q)) - 0.1f;
                MeshData data = tiles.Surface(mid, "Kerbs", m.Kerb);
                var normal = new Vector3(left.x, 0f, left.y);
                float len = d.magnitude;
                SurfaceMesh.Quad(data,
                    new Vector3(p.x, RoadWidths.KerbHeight, p.y), new Vector3(q.x, RoadWidths.KerbHeight, q.y),
                    new Vector3(q.x, bottom, q.y), new Vector3(p.x, bottom, p.y), normal,
                    new Vector2(0f, RoadWidths.KerbHeight), new Vector2(len, RoadWidths.KerbHeight), new Vector2(len, bottom), new Vector2(0f, bottom));
            }
        }

        /// <summary>The lots of the buildings outside the ring: a paved band at kerb height behind the pavement, with an edge down to the land at its back.</summary>
        static void Lots(List<Vector2> run, CityTiles tiles, CityMaterials m)
        {
            if (run.Count < 2) return;
            // The outside lies to the left of its runs.
            List<Vector2> back = Polygons.OffsetOpen(run, 20f);
            const float y = RoadWidths.KerbHeight;
            for (int i = 0; i + 1 < run.Count; i++)
            {
                Vector2 a = run[i], b = run[i + 1], c = back[i + 1], d = back[i];
                Vector2 mid = (a + b + c + d) * 0.25f;
                MeshData lot = tiles.Surface(mid, "Lots", m.Concrete, CityTiles.Layer.Ground);
                SurfaceMesh.Triangle(lot, a, b, c, y);
                SurfaceMesh.Triangle(lot, a, c, d, y);

                // The back edge faces away from the road (to the left of the run).
                Vector2 e = c - d;
                if (e.sqrMagnitude < 1e-4f) continue;
                Vector2 left = RoadGraph.Left(RoadGraph.SafeNormal(e));
                float bottom = Mathf.Min(HeightAt(c), HeightAt(d)) - 0.1f;
                float len = e.magnitude;
                SurfaceMesh.Quad(tiles.Surface(mid, "Kerbs", m.Kerb),
                    new Vector3(d.x, y, d.y), new Vector3(c.x, y, c.y), new Vector3(c.x, bottom, c.y), new Vector3(d.x, bottom, d.y),
                    new Vector3(left.x, 0f, left.y), new Vector2(0f, y), new Vector2(len, y), new Vector2(len, bottom), new Vector2(0f, bottom));
            }
        }

        /// <summary>
        /// The promenade along the waterfront (south to north, the sea on its right): paving at
        /// pavement height, a low granite sea wall along its seaward edge with gaps down to the
        /// beach, and a row of palms down the middle.
        /// </summary>
        static void Promenade(List<Vector2> waterfront, CityTiles tiles, CityMaterials m, List<Vector3> palms)
        {
            if (waterfront.Count < 2) return;
            var reversed = new List<Vector2>(waterfront);
            reversed.Reverse();
            // Running north to south, the sea is on the left. The promenade reaches the top of the
            // beach, however far that is from the boulevard's pavement.
            List<Vector2> unit = Polygons.OffsetOpen(reversed, 1f);
            unit.Reverse();
            var sea = new List<Vector2>(waterfront.Count);
            for (int i = 0; i < waterfront.Count; i++)
            {
                Vector2 w = waterfront[i], n = unit[i] - w;
                float width = PromenadeWidth;
                if (n.x > 0.3f) width = Mathf.Clamp((CityLayout.ShoreX(w.y) + SandFrom + 1f - w.x) / n.x, PromenadeWidth * 0.5f, PromenadeWidth * 3f);
                sea.Add(w + n * width);
            }
            const float y = RoadWidths.KerbHeight;
            // Only along the coast: where the waterfront turns inland round the ring's corners, the
            // promenade stops (the corners get the plain verge instead).
            int count = waterfront.Count - 1;
            var along = new bool[count];
            for (int i = 0; i < count; i++) along[i] = Mathf.Abs(RoadGraph.SafeNormal(waterfront[i + 1] - waterfront[i]).y) > 0.6f;
            float walked = 0f, wallWalked = 0f, nextPalm = 12f;
            for (int i = 0; i < count; i++)
            {
                Vector2 a = waterfront[i], b = waterfront[i + 1], c = sea[i + 1], d = sea[i];
                float segment = Vector2.Distance(a, b);
                if (!along[i])
                {
                    walked += segment;
                    nextPalm = Mathf.Max(nextPalm, walked + 12f);
                    continue;
                }
                Vector2 mid = (a + b + c + d) * 0.25f;
                MeshData pave = tiles.Surface(mid, "Promenade", m.Pavement, CityTiles.Layer.Ground);
                SurfaceMesh.Triangle(pave, a, b, c, y);
                SurfaceMesh.Triangle(pave, a, c, d, y);
                MeshData stone = tiles.Surface(mid, "Sea wall", m.Granite);
                // Its ends drop to the land.
                if (i == 0 || !along[i - 1]) Drop(stone, a, d, y);
                if (i == count - 1 || !along[i + 1]) Drop(stone, c, b, y);

                // Sea wall face down to the sand.
                Vector2 e = c - d;
                float len = e.magnitude;
                if (len >= 0.01f)
                {
                    Vector2 dir = e / len;
                    Drop(stone, d, c, y);

                    // A sitting wall along the edge, with an opening down to the beach every 60 m.
                    int pieces = Mathf.Max(1, Mathf.CeilToInt(len / 4f));
                    for (int k = 0; k < pieces; k++)
                    {
                        float s0 = len * k / pieces, s1 = len * (k + 1) / pieces;
                        if (Mathf.Repeat(wallWalked + (s0 + s1) * 0.5f, 60f) > 55f) continue;
                        SurfaceMesh.BoxAlong(stone, d + dir * s0, d + dir * s1, -0.25f, 0.5f, y, y + 0.45f, 0.02f, 0.01f);
                    }
                    wallWalked += len;
                }

                // Palms down the middle.
                while (nextPalm <= walked + segment)
                {
                    float t = segment > 0.01f ? (nextPalm - walked) / segment : 0f;
                    Vector2 p = Vector2.Lerp((a + d) * 0.5f, (b + c) * 0.5f, t);
                    palms.Add(new Vector3(p.x, y, p.y));
                    nextPalm += 24f;
                }
                walked += segment;
            }
        }

        /// <summary>A vertical face from height `top` down into the land along p→q, facing its right.</summary>
        static void Drop(MeshData m, Vector2 p, Vector2 q, float top)
        {
            Vector2 e = q - p;
            float len = e.magnitude;
            if (len < 0.01f) return;
            Vector2 dir = e / len;
            var normal = new Vector3(dir.y, 0f, -dir.x);
            float bottom = Mathf.Min(HeightAt(p), HeightAt(q)) - 0.1f;
            SurfaceMesh.Quad(m, new Vector3(p.x, top, p.y), new Vector3(q.x, top, q.y), new Vector3(q.x, bottom, q.y), new Vector3(p.x, bottom, p.y),
                normal, new Vector2(0f, top), new Vector2(len, top), new Vector2(len, bottom), new Vector2(0f, bottom));
        }

        /// <summary>Palms scattered along the top of the beach, and shade trees over the land round the city.</summary>
        static void Countryside(CityPlan plan, List<Vector3> palms, List<Vector3> trees, Rng random)
        {
            for (float z = -2400f; z < 2400f; z += 18f)
            {
                if (random.Next() < 0.45f) continue;
                float u = random.Range(SandFrom + 12f, -88f);
                float zz = z + random.Range(-6f, 6f);
                palms.Add(new Vector3(CityLayout.ShoreX(zz) + u, LandY, zz));
            }

            List<Vector2> city = plan.Outside != null && plan.Outside.PavementValid ? plan.Outside.BuildingLine : null;
            if (city == null) return;
            for (int k = 0; k < 2600; k++)
            {
                var p = new Vector2(random.Range(-1900f, 1100f), random.Range(-1900f, 1900f));
                if (p.x > CityLayout.ShoreX(p.y) + SandFrom - 10f) continue;
                if (Polygons.Contains(city, p)) continue;
                if (Polygons.DistanceToEdges(city, p) < 32f) continue;
                // Thinner further out, in clumps.
                float r = Mathf.Max(Mathf.Abs(p.x), Mathf.Abs(p.y));
                float clump = Mathf.PerlinNoise(p.x * 0.004f + 13.1f, p.y * 0.004f + 7.7f);
                if (random.Next() > clump * 1.4f - (r - 1000f) / 2000f) continue;
                trees.Add(new Vector3(p.x, LandY, p.y));
            }
        }
    }
}
