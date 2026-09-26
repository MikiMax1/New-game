using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar.City
{
    /// <summary>
    /// Planting strips along both kerbs, the way Miami lines its streets: long raised beds 1.6 m
    /// wide, starting 0.35 m behind the kerb, edged with granite, filled with soil under dense St
    /// Augustine grass, a band of shrubs along the back (sea grape green and bougainvillea
    /// magenta), and the palms planted in them.
    ///
    /// Strips run wherever the kerb side of the pavement is free: they stop 0.5 m short of anything
    /// already standing there (lamps, signals, hydrants, bins, signs, the bus shelter, bike rack and
    /// so on, found from their bounds), leave the crossing's kerb ramps and the bus stop open, and
    /// break every 10 m or so for a paved gap to step through from parked cars.
    /// </summary>
    public static class Planting
    {
        /// <summary>Distance of the strip's near edge behind the kerb face, and its width.</summary>
        const float Near = 0.35f;
        const float Width = 1.6f;
        const float Edge = 0.08f;
        /// <summary>Height of the soil and of the edging above the paving.</summary>
        const float SoilRise = 0.07f;
        const float EdgeRise = 0.1f;
        const float MinLength = 3f;
        const float MaxLength = 10f;
        const float Gap = 1.4f;

        public static void Build(Transform parent, CityMaterials m, Rng random, params Transform[] existing)
        {
            var root = new GameObject("Planting");
            root.transform.SetParent(parent, false);

            var edging = new MeshData();
            var soil = new MeshData();
            var grass = new MeshData();
            var shrubs = new MeshData();
            var flowers = new MeshData();
            var palmBases = new List<Vector3>();

            foreach (int side in new[] { 1, -1 })
            {
                float zNear = side * (Layout.KerbZ + Near);
                float zFar = side * (Layout.KerbZ + Near + Width);
                float zMin = Mathf.Min(zNear, zFar), zMax = Mathf.Max(zNear, zFar);

                // Blocked stretches along x.
                var blocked = new List<Vector2>
                {
                    new Vector2(Layout.CrossingX - Layout.CrosswalkWidth / 2f - 2.5f, Layout.CrossingX + Layout.CrosswalkWidth / 2f + 2.5f),
                };
                if (side < 0) blocked.Add(new Vector2(StreetDetails.BusStopFrom - 0.5f, StreetDetails.BusStopTo + 0.5f));
                foreach (Transform t in existing)
                {
                    if (t == null) continue;
                    foreach (Renderer r in t.GetComponentsInChildren<Renderer>())
                    {
                        Bounds b = r.bounds;
                        if (b.max.z < zMin - 0.3f || b.min.z > zMax + 0.3f || b.min.y > 3f) continue;
                        blocked.Add(new Vector2(b.min.x - 0.5f, b.max.x + 0.5f));
                    }
                }

                foreach (Vector2 run in FreeRuns(blocked, -Layout.StreetHalfLength + 2f, Layout.StreetHalfLength - 2f))
                {
                    float length = run.y - run.x;
                    if (length < MinLength) continue;
                    // Split long runs into beds of up to MaxLength with paved gaps between.
                    int beds = Mathf.CeilToInt((length + Gap) / (MaxLength + Gap));
                    float bedLength = (length - (beds - 1) * Gap) / beds;
                    for (int k = 0; k < beds; k++)
                    {
                        float x0 = run.x + k * (bedLength + Gap);
                        float x1 = x0 + bedLength;
                        Bed(x0, x1, zNear, zFar, side, edging, soil, grass, shrubs, flowers, palmBases, random);
                    }
                }
            }

            Add(root.transform, "Planter edging", edging, m.Granite);
            Add(root.transform, "Planter soil", soil, m.Mulch);
            Add(root.transform, "Grass", grass, m.GroundCover);
            Add(root.transform, "Shrubs", shrubs, m.Leaf);
            Add(root.transform, "Bougainvillea", flowers, m.Surface("Bougainvillea", new Color(0.55f, 0.03f, 0.2f), 0.3f));
            Palms.Build(root.transform, palmBases, m, random, false);
        }

        /// <summary>The parts of [from, to] not covered by any blocked range, in order.</summary>
        static List<Vector2> FreeRuns(List<Vector2> blocked, float from, float to)
        {
            blocked.Sort((a, b) => a.x.CompareTo(b.x));
            var runs = new List<Vector2>();
            float x = from;
            foreach (Vector2 b in blocked)
            {
                if (b.y <= x) continue;
                if (b.x > x) runs.Add(new Vector2(x, Mathf.Min(b.x, to)));
                x = Mathf.Max(x, b.y);
                if (x >= to) break;
            }
            if (x < to) runs.Add(new Vector2(x, to));
            return runs;
        }

        static void Bed(float x0, float x1, float zNear, float zFar, int side, MeshData edging, MeshData soil, MeshData grass, MeshData shrubs, MeshData flowers, List<Vector3> palms, Rng random)
        {
            float cx = (x0 + x1) / 2f, cz = (zNear + zFar) / 2f;
            float length = x1 - x0;
            float y = Street.Height(cx, cz);
            // The paving falls 1.5% towards the kerb: sit the bed on its highest corner and bury it 0.2 m.
            float top = Mathf.Max(y, Street.Height(cx, zFar));
            float depth = 0.25f;

            // Granite edging on all four sides, EdgeRise above the paving.
            float ey = top + EdgeRise - depth / 2f;
            edging.Append(Shapes.ChamferBox(length + 2f * Edge, depth, Edge, 0.012f).Translate(cx, ey, zNear - side * Edge / 2f));
            edging.Append(Shapes.ChamferBox(length + 2f * Edge, depth, Edge, 0.012f).Translate(cx, ey, zFar + side * Edge / 2f));
            edging.Append(Shapes.ChamferBox(Edge, depth, Width, 0.012f).Translate(x0 - Edge / 2f, ey, cz));
            edging.Append(Shapes.ChamferBox(Edge, depth, Width, 0.012f).Translate(x1 + Edge / 2f, ey, cz));
            float soilY = top + SoilRise;
            soil.Append(Shapes.ChamferBox(length, depth, Width, 0.02f).Translate(cx, soilY - depth / 2f, cz));

            // Palms: one per bed, two in long ones, on the centre line.
            var bedPalms = new List<Vector3>();
            int count = length > 7f ? 2 : 1;
            for (int k = 0; k < count; k++)
            {
                float px = x0 + length * (k + 1f) / (count + 1f) + random.Range(-0.4f, 0.4f);
                var p = new Vector3(px, soilY, cz);
                bedPalms.Add(p);
                palms.Add(p);
            }

            // Shrubs along the back edge: rounded mounds, the odd one in flower.
            float backZ = zFar - side * 0.38f;
            for (float x = x0 + 0.45f; x < x1 - 0.35f; x += random.Range(0.7f, 1.1f))
            {
                float r = random.Range(0.28f, 0.42f);
                MeshData mound = Mound(r, random.Range(0.75f, 1.05f)).Translate(x, soilY - 0.04f, backZ + random.Range(-0.08f, 0.08f));
                if (random.Next() < 0.3f) flowers.Append(mound);
                else shrubs.Append(mound);
            }

            // Grass: tufts of blades over the front of the bed, clear of the palm bases.
            float grassFar = backZ - side * 0.2f;
            float gzMin = Mathf.Min(zNear, grassFar) + 0.05f, gzMax = Mathf.Max(zNear, grassFar) - 0.05f;
            int tufts = Mathf.RoundToInt(length * (gzMax - gzMin) * 14f);
            for (int t = 0; t < tufts; t++)
            {
                float gx = random.Range(x0 + 0.05f, x1 - 0.05f);
                float gz = random.Range(gzMin, gzMax);
                bool clear = true;
                foreach (Vector3 p in bedPalms)
                {
                    if ((new Vector2(gx - p.x, gz - p.z)).sqrMagnitude < 0.3f * 0.3f) clear = false;
                }
                if (clear) Tuft(grass, new Vector3(gx, soilY, gz), random);
            }
        }

        /// <summary>A shrub mound: a squashed sphere with a lumpy outline, radius r.</summary>
        static MeshData Mound(float r, float squash)
        {
            var profile = new List<Vector2>();
            const int n = 9;
            for (int i = 0; i <= n; i++)
            {
                float a = -Mathf.PI / 2f + (float)i / n * Mathf.PI;
                float lump = 1f + 0.08f * Mathf.Sin(i * 2.3f);
                profile.Add(new Vector2(Mathf.Max(0f, Mathf.Cos(a)) * r * lump, (Mathf.Sin(a) + 1f) * r * squash));
            }
            profile[0] = new Vector2(0f, 0f);
            profile[n] = new Vector2(0f, 2f * r * squash);
            return Shapes.Lathe(profile, 14);
        }

        /// <summary>A grass tuft: a dozen narrow arching blades.</summary>
        static void Tuft(MeshData grass, Vector3 c, Rng random)
        {
            for (int k = 0; k < 12; k++)
            {
                float dir = random.Next() * Mathf.PI * 2f;
                float len = random.Range(0.08f, 0.16f);
                float lean = random.Range(0.25f, 0.6f);
                float dx = Mathf.Cos(dir), dz = Mathf.Sin(dir);
                const float w = 0.005f;
                var p0 = new Vector3(c.x - dz * w, c.y, c.z + dx * w);
                var p1 = new Vector3(c.x + dz * w, c.y, c.z - dx * w);
                var p2 = new Vector3(c.x + dx * len * lean, c.y + len * (1f - lean * 0.5f), c.z + dz * len * lean);
                Vector3 normal = Vector3.Cross(p1 - p0, p2 - p0).normalized;
                if (normal.y < 0f) normal = -normal;
                int i0 = grass.AddVertex(p0, normal, new Vector2(0, 0));
                int i1 = grass.AddVertex(p1, normal, new Vector2(1, 0));
                int i2 = grass.AddVertex(p2, normal, new Vector2(0.5f, 1));
                grass.AddTriangle(i0, i1, i2);
            }
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
    }
}
