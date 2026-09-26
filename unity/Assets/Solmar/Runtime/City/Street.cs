using System.Collections.Generic;
using UnityEngine;

namespace Solmar.City
{
    /// <summary>
    /// The street surface: road, gutters, kerbs, pavements and the kerb ramps at the crossing, as
    /// finely tessellated terrain meshes. Heights come from a function of (x, z): a crowned road
    /// that drains to the gutters, 15 cm kerbs with rounded arrises, pavements falling 1.5% towards
    /// the kerb, and kerb ramps with 1:10 flares. The road also carries wheel-path ruts and slow
    /// undulations in its geometry, where the puddles collect.
    /// </summary>
    public static class Street
    {
        const float GutterY = 0f;
        const float Crown = 0.09f;
        const float GutterWidth = 0.45f;
        const float RampRun = 1.5f;
        const float Flare = 1.2f;
        const float Arris = 0.02f;
        const float Batter = 0.015f;

        /// <summary>Road height at lateral position z, before ruts and undulations.</summary>
        public static float RoadHeight(float z)
        {
            float d = Layout.KerbZ - Mathf.Abs(z);
            if (d < GutterWidth) return GutterY + 0.02f * (d / GutterWidth);
            float t = Mathf.Abs(z) / (Layout.KerbZ - GutterWidth);
            return GutterY + 0.02f + (Crown - 0.02f) * (1f - t * t);
        }

        /// <summary>Wheel paths: 0..1, two per traffic lane, 0.9 m either side of the lane centre.</summary>
        public static float WheelPath(float z)
        {
            float az = Mathf.Abs(z);
            if (az > Layout.ParkingZ) return 0f;
            float laneOffset = Mathf.Abs(Mathf.Repeat(az / Layout.LaneWidth, 1f) - 0.5f) * Layout.LaneWidth;
            return Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.42f, 0.12f, Mathf.Abs(laneOffset - 0.9f)));
        }

        /// <summary>Slow undulations and ruts of the road surface (metres, relative to its crown).</summary>
        public static float RoadShape(float x, float z)
        {
            float undulation = (Mathf.PerlinNoise(x * 0.11f + 31.7f, z * 0.16f + 7.3f) - 0.5f) * 0.009f + (Mathf.PerlinNoise(x * 0.37f + 5.1f, z * 0.41f + 91.3f) - 0.5f) * 0.003f;
            return undulation - WheelPath(z) * 0.0035f;
        }

        static float RampMask(float x)
        {
            float half = Layout.RampWidth / 2f;
            float dx = Mathf.Abs(x - Layout.CrossingX);
            if (dx <= half) return 1f;
            if (dx >= half + Flare) return 0f;
            return 1f - (dx - half) / Flare;
        }

        /// <summary>Pavement height at (x, distance behind the kerb face).</summary>
        public static float PavementHeight(float x, float behindKerb)
        {
            float baseY = GutterY + Layout.KerbHeight + 0.015f * Mathf.Max(0f, behindKerb - 0.3f);
            float ramp = RampMask(x) * Mathf.Max(0f, 1f - behindKerb / RampRun);
            return baseY - (Layout.KerbHeight - 0.012f) * ramp;
        }

        /// <summary>Height of the street surface at (x, z), for placing things on it.</summary>
        public static float Height(float x, float z)
        {
            float behind = Mathf.Abs(z) - Layout.KerbZ;
            return behind > 0f ? PavementHeight(x, behind) : RoadHeight(z) + RoadShape(x, z);
        }

        /// <summary>Positions along x: fine near the crossing, coarser towards the ends.</summary>
        static List<float> XStations()
        {
            var xs = new List<float>();
            const float fine = 0.1f;
            const float coarse = 0.5f;
            float x = -Layout.StreetHalfLength;
            while (x < Layout.StreetHalfLength)
            {
                xs.Add(x);
                bool inFine = x > Layout.CrossingX - 36f && x < Layout.CrossingX + 66f;
                x += inFine ? fine : coarse;
            }
            xs.Add(Layout.StreetHalfLength);
            return xs;
        }

        static Mesh Grid(string name, List<float> xs, List<float> zs, System.Func<float, int, float> height, bool flip)
        {
            int nx = xs.Count, nz = zs.Count;
            var m = new MeshData();
            for (int i = 0; i < nx; i++)
            {
                for (int j = 0; j < nz; j++)
                {
                    float y = height(xs[i], j);
                    // UVs in metres: x along the street, z across (the kerb face adds its height so its
                    // texture isn't squashed).
                    m.AddVertex(new Vector3(xs[i], y, zs[j]), Vector3.up, new Vector2(xs[i], zs[j] + (flip ? -y : y)));
                }
            }
            for (int i = 0; i < nx - 1; i++)
            {
                for (int j = 0; j < nz - 1; j++)
                {
                    int a = i * nz + j, b = a + nz;
                    if (!flip)
                    {
                        m.AddTriangle(a, a + 1, b);
                        m.AddTriangle(b, a + 1, b + 1);
                    }
                    else
                    {
                        m.AddTriangle(a, b, a + 1);
                        m.AddTriangle(b, b + 1, a + 1);
                    }
                }
            }
            Mesh mesh = m.ToMesh(name);
            mesh.RecalculateNormals();
            mesh.RecalculateTangents();
            return mesh;
        }

        /// <summary>The road between the kerb faces (gutters included), with ruts and undulations.</summary>
        public static Mesh BuildRoad()
        {
            var zs = new List<float>();
            for (float z = -Layout.KerbZ; z < Layout.KerbZ; z += 0.08f) zs.Add(z);
            zs.Add(Layout.KerbZ);
            return Grid("Road", XStations(), zs, (x, j) => RoadHeight(zs[j]) + RoadShape(x, zs[j]), false);
        }

        /// <summary>
        /// One pavement with its kerb, from the bottom of the kerb face back past the building line.
        /// side = +1 for the north side (z > 0), -1 for the south.
        /// </summary>
        public static Mesh BuildPavement(int side)
        {
            var behind = new List<float>();
            const int faceRows = 6;
            for (int k = 0; k <= faceRows; k++) behind.Add(-Batter * (1f - (float)k / faceRows) - 0.0005f * (faceRows - k));
            for (int k = 1; k <= 4; k++) behind.Add(Arris * (1f - Mathf.Cos(k / 4f * Mathf.PI / 2f)));
            for (float d = 0.04f; d < Layout.BuildingZ - Layout.KerbZ + 0.3f; d += 0.08f) behind.Add(d);
            var zs = new List<float>();
            foreach (float d in behind) zs.Add(side * (Layout.KerbZ + d));
            float HeightAt(float x, int j)
            {
                float d = behind[j];
                float top = PavementHeight(x, Mathf.Max(d, 0f));
                if (j <= faceRows) return GutterY + (top - Arris - GutterY) * j / faceRows;
                if (j <= faceRows + 4) return top - Arris + Mathf.Sin((j - faceRows) / 4f * Mathf.PI / 2f) * Arris;
                return top;
            }
            // Rows run +z on the north side (wound like the road) and -z on the south side, whose
            // winding is flipped so it faces up too.
            return Grid(side > 0 ? "North pavement" : "South pavement", XStations(), zs, HeightAt, side < 0);
        }
    }
}
