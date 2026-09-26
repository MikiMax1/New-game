using System;
using System.Collections.Generic;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>The character of a part of the city, which decides what its blocks are filled with.</summary>
    public enum District
    {
        /// <summary>Glass towers and office blocks on the downtown grid.</summary>
        Downtown,
        /// <summary>Art Deco and MiMo hotels and apartments between downtown and the beach.</summary>
        Beach,
        /// <summary>Two- and three-storey houses with yards on curving streets.</summary>
        Residential,
    }

    /// <summary>
    /// The plan of Solmar, about 2 × 2 km, in metres (x east, z north; the ocean is to the east).
    ///
    ///   Downtown      a grid of blocks 60–140 m on a side around the origin, with Main Avenue
    ///                 running north–south and Flagler Avenue east–west, and the Diagonal cutting
    ///                 across it from the south-west to the beach
    ///   Beach strip   between downtown and the ocean: Collins Street and the coastal Ocean
    ///                 Boulevard both follow the curving shoreline
    ///   Residential   west, north and south of downtown: the downtown streets carry on as gently
    ///                 curving residential streets, crossed by more curving streets, with a crescent
    ///                 loop in the north-west
    ///   Ring          the arterial ring road around the whole city, whose east side is the
    ///                 boulevard
    ///
    /// Every street is drawn as a polyline that overshoots the road it ends on; the planarizer
    /// cuts them at their crossings and trims the overshoots, so nothing ends in the void.
    /// </summary>
    public static class CityLayout
    {
        /// <summary>Downtown's north–south streets (x), west to east. Main Avenue is <see cref="MainAvenueX"/>.</summary>
        public static readonly float[] DowntownX = { -430f, -330f, -250f, -145f, -60f, 30f, 120f, 235f, 310f, 430f };
        /// <summary>Downtown's east–west streets (z), south to north. Flagler Avenue is <see cref="FlaglerZ"/>.</summary>
        public static readonly float[] DowntownZ = { -410f, -290f, -220f, -140f, -57f, 28f, 114f, 220f, 300f, 410f };
        public const float MainAvenueX = 30f;
        public const float FlaglerZ = -140f;

        /// <summary>The ring road's west side (x), north side and south side (z), before their gentle waves.</summary>
        public const float RingWest = -935f;
        public const float RingNorth = 930f;
        public const float RingSouth = -930f;

        /// <summary>The whole map's extent from the origin, including the land outside the ring.</summary>
        public const float Extent = 1100f;

        /// <summary>x of the shoreline (the water's edge) at z.</summary>
        public static float ShoreX(float z) => 905f + 38f * Mathf.Sin(0.0041f * z + 0.6f) + 22f * Mathf.Sin(0.0107f * z + 2.1f);

        /// <summary>x of Ocean Boulevard's centreline at z: 150 m inland of the shore, so there is room for the promenade and a wide beach.</summary>
        public static float BoulevardX(float z) => ShoreX(z) - 150f;

        /// <summary>x of Collins Street's centreline at z, parallel to the boulevard.</summary>
        public static float CollinsX(float z) => BoulevardX(z) - 135f;

        /// <summary>Which district a point (usually a block's centre) is in.</summary>
        public static District DistrictAt(Vector2 p)
        {
            bool inGridX = p.x > DowntownX[0] - 5f && p.x < DowntownX[DowntownX.Length - 1] + 5f;
            bool inGridZ = p.y > DowntownZ[0] - 5f && p.y < DowntownZ[DowntownZ.Length - 1] + 5f;
            if (inGridX && inGridZ) return District.Downtown;
            if (p.x > DowntownX[DowntownX.Length - 1] - 5f && p.x < BoulevardX(p.y) + 400f) return District.Beach;
            return District.Residential;
        }

        /// <summary>Parks: centres and radii. A block whose centre falls in one becomes a park.</summary>
        public static readonly Vector4[] Parks =
        {
            new Vector4(-190f, 690f, 150f, 0f),  // Northside Park
            new Vector4(230f, -700f, 120f, 0f),  // Southside Park
            new Vector4(-680f, 160f, 60f, 0f),   // the green inside the crescent
            new Vector4(365f, 355f, 60f, 0f),    // Bayfront Park, downtown by the Diagonal
            new Vector4(-100f, -190f, 45f, 0f),  // Flagler Plaza
        };

        /// <summary>Is `p` in one of the designated parks?</summary>
        public static bool InPark(Vector2 p)
        {
            foreach (Vector4 park in Parks)
            {
                if ((p - new Vector2(park.x, park.y)).sqrMagnitude < park.z * park.z) return true;
            }
            return false;
        }

        /// <summary>All of the city's streets as polylines, ready for <see cref="RoadPlanarizer"/>.</summary>
        public static List<RoadLine> Lines()
        {
            var lines = new List<RoadLine>();
            lines.AddRange(Ring());
            Downtown(lines);
            Diagonal(lines);
            BeachStrip(lines);
            Residential(lines);
            return lines;
        }

        /// <summary>A polyline through f(t) for t from t0 to t1, sampled every `step` of t.</summary>
        static RoadLine Trace(RoadClass cls, string name, Func<float, Vector2> f, float t0, float t1, float step)
        {
            var line = new RoadLine(cls, name);
            int n = Mathf.Max(1, Mathf.CeilToInt(Mathf.Abs(t1 - t0) / step));
            for (int i = 0; i <= n; i++) line.Points.Add(f(Mathf.Lerp(t0, t1, (float)i / n)));
            return line;
        }

        static RoadLine Straight(RoadClass cls, string name, Vector2 a, Vector2 b)
        {
            var line = new RoadLine(cls, name);
            line.Points.Add(a);
            line.Points.Add(b);
            return line;
        }

        /// <summary>Smoothstep from 0 at `from` to 1 at `to` (either order).</summary>
        static float Ease(float v, float from, float to)
        {
            float t = Mathf.Clamp01((v - from) / (to - from));
            return t * t * (3f - 2f * t);
        }

        /// <summary>
        /// The ring: Ocean Boulevard up the east side, then round the north, west and south sides
        /// as a gently waving arterial, with rounded corners; a closed loop, as two lines (the
        /// boulevard and the arterial) that meet at its north-east and south-east corners.
        /// </summary>
        static List<RoadLine> Ring()
        {
            // Control points, counter-clockwise from the boulevard's south end.
            var ctrl = new List<Vector2>();
            for (float z = -760f; z <= 760f; z += 95f) ctrl.Add(new Vector2(BoulevardX(z), z));
            for (float x = 620f; x >= -780f; x -= 100f) ctrl.Add(new Vector2(x, RingNorth + 14f * Mathf.Sin(x / 160f)));
            for (float z = 780f; z >= -780f; z -= 100f) ctrl.Add(new Vector2(RingWest + 12f * Mathf.Sin(z / 140f + 1f), z));
            for (float x = -780f; x <= 620f; x += 100f) ctrl.Add(new Vector2(x, RingSouth + 12f * Mathf.Sin(x / 170f + 2f)));

            // Closed Catmull-Rom through the control points, resampled every ~15 m.
            var dense = new List<Vector2>();
            int n = ctrl.Count;
            for (int i = 0; i < n; i++)
            {
                Vector2 p0 = ctrl[(i + n - 1) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
                for (int k = 0; k < 20; k++)
                {
                    float u = k / 20f, u2 = u * u, u3 = u2 * u;
                    dense.Add(0.5f * (2f * p1 + (-p0 + p2) * u + (2f * p0 - 5f * p1 + 4f * p2 - p3) * u2 + (-p0 + 3f * p1 - 3f * p2 + p3) * u3));
                }
            }
            var loop = new List<Vector2> { dense[0] };
            float acc = 0f;
            for (int i = 1; i < dense.Count; i++)
            {
                acc += Vector2.Distance(dense[i], dense[i - 1]);
                if (acc >= 15f)
                {
                    loop.Add(dense[i]);
                    acc = 0f;
                }
            }

            // Split where the loop leaves the coast: the boulevard is the run along it.
            int count = loop.Count;
            var coastal = new bool[count];
            for (int i = 0; i < count; i++) coastal[i] = loop[i].x > BoulevardX(loop[i].y) - 25f;
            int start = -1;
            for (int i = 0; i < count; i++)
            {
                if (coastal[i] && !coastal[(i + count - 1) % count])
                {
                    start = i;
                    break;
                }
            }
            var result = new List<RoadLine>();
            if (start < 0)
            {
                var whole = new RoadLine(RoadClass.Arterial, "Ring Road") { Closed = true };
                whole.Points.AddRange(loop);
                result.Add(whole);
                return result;
            }
            RoadLine current = null;
            for (int k = 0; k <= count; k++)
            {
                int i = (start + k) % count;
                bool c = coastal[i];
                if (current == null || (k < count && c != (current.Class == RoadClass.Boulevard)))
                {
                    // Consecutive lines share their end point.
                    if (current != null) current.Points.Add(loop[i]);
                    current = new RoadLine(c ? RoadClass.Boulevard : RoadClass.Arterial, c ? "Ocean Boulevard" : "Ring Road");
                    result.Add(current);
                }
                current.Points.Add(loop[i]);
            }
            return result;
        }

        static void Downtown(List<RoadLine> lines)
        {
            float x0 = DowntownX[0], x1 = DowntownX[DowntownX.Length - 1];
            float z0 = DowntownZ[0], z1 = DowntownZ[DowntownZ.Length - 1];
            string[] avenues = { "NW 12th Ave", "NW 9th Ave", "NW 7th Ave", "NW 5th Ave", "NW 3rd Ave", "Main Avenue", "NE 2nd Ave", "NE 4th Ave", "NE 6th Ave", "Biscayne Street" };
            string[] streets = { "SW 14th St", "SW 10th St", "SW 7th St", "Flagler Avenue", "SW 1st St", "NW 2nd St", "NW 5th St", "NW 8th St", "NW 11th St", "NW 14th St" };
            for (int i = 0; i < DowntownX.Length; i++)
            {
                float x = DowntownX[i];
                RoadClass cls = Mathf.Approximately(x, MainAvenueX) ? RoadClass.Avenue : RoadClass.Street;
                // Main Avenue runs the whole height of the city; the others stop at downtown's edge
                // and carry on as residential streets (Residential()).
                if (cls == RoadClass.Avenue) lines.Add(Straight(cls, avenues[i], new Vector2(x, RingSouth - 35f), new Vector2(x, RingNorth + 35f)));
                else lines.Add(Straight(cls, avenues[i], new Vector2(x, z0), new Vector2(x, z1)));
            }
            for (int j = 0; j < DowntownZ.Length; j++)
            {
                float z = DowntownZ[j];
                RoadClass cls = Mathf.Approximately(z, FlaglerZ) ? RoadClass.Avenue : RoadClass.Street;
                if (cls == RoadClass.Avenue) lines.Add(Straight(cls, streets[j], new Vector2(RingWest - 35f, z), new Vector2(BoulevardX(z) + 60f, z)));
                else lines.Add(Straight(cls, streets[j], new Vector2(x0, z), new Vector2(x1, z)));
            }
        }

        /// <summary>
        /// The Diagonal: an avenue from the ring's south-west corner across downtown to the beach.
        /// Where it passes close to a downtown crossing it bends to run through it, so every junction
        /// it makes has room for its plate.
        /// </summary>
        static void Diagonal(List<RoadLine> lines)
        {
            Vector2 a = new Vector2(-975f, -739f), b = new Vector2(760f, 700f);
            Vector2 d = (b - a).normalized;
            var pts = new List<Vector2> { a };
            // Downtown crossings within 30 m of the straight line become waypoints.
            var snaps = new List<(float t, Vector2 p)>();
            foreach (float x in DowntownX)
            {
                foreach (float z in DowntownZ)
                {
                    var p = new Vector2(x, z);
                    float t = Vector2.Dot(p - a, d);
                    Vector2 q = a + d * t;
                    if (Vector2.Distance(p, q) < 30f && !Mathf.Approximately(x, MainAvenueX) && !Mathf.Approximately(z, FlaglerZ)) snaps.Add((t, p));
                }
            }
            snaps.Sort((u, v) => u.t.CompareTo(v.t));
            foreach ((float t, Vector2 p) in snaps) pts.Add(p);
            pts.Add(b);
            var line = new RoadLine(RoadClass.Avenue, "The Diagonal");
            line.Points.AddRange(pts);
            lines.Add(line);
        }

        static void BeachStrip(List<RoadLine> lines)
        {
            // Collins Street, following the shore, from the ring's south side to its north side, and
            // Washington Avenue behind it where the strip is wide enough.
            lines.Add(Trace(RoadClass.Street, "Collins Street", z => new Vector2(CollinsX(z), z), RingSouth - 80f, RingNorth + 80f, 15f));
            float edge = DowntownX[DowntownX.Length - 1];
            RoadLine washington = Trace(RoadClass.Street, "Washington Avenue", z => new Vector2((CollinsX(z) + edge) * 0.5f, z), RingSouth - 80f, RingNorth + 80f, 15f);
            lines.AddRange(ClipOut(washington, p => CollinsX(p.y) - edge < 175f));
            // Downtown's east-west streets carry on to the boulevard.
            float xEnd = DowntownX[DowntownX.Length - 1];
            string[] names = { "14th Street", "10th Street", "7th Street", "", "1st Street", "2nd Street", "5th Street", "8th Street", "11th Street", "Lincoln Road" };
            for (int j = 0; j < DowntownZ.Length; j++)
            {
                float z = DowntownZ[j];
                if (Mathf.Approximately(z, FlaglerZ)) continue;
                lines.Add(Straight(RoadClass.Street, names[j], new Vector2(xEnd, z), new Vector2(BoulevardX(z) + 60f, z)));
            }
        }

        /// <summary>The green inside Crescent Drive: residential streets stop at the loop round it.</summary>
        static readonly Vector2 CrescentCentre = new Vector2(-680f, 160f);
        const float CrescentRx = 92f, CrescentRz = 88f;

        static bool InCrescent(Vector2 p)
        {
            Vector2 d = p - CrescentCentre;
            return (d.x * d.x) / (CrescentRx * CrescentRx) + (d.y * d.y) / (CrescentRz * CrescentRz) < 1f;
        }

        /// <summary>
        /// The parts of a line outside an excluded area, each carried one point into it so it still
        /// crosses whatever road bounds the area (the overshoot is trimmed off later).
        /// </summary>
        static List<RoadLine> ClipOut(RoadLine line, Func<Vector2, bool> excluded)
        {
            var result = new List<RoadLine>();
            RoadLine current = null;
            List<Vector2> pts = line.Points;
            for (int i = 0; i < pts.Count; i++)
            {
                bool outside = !excluded(pts[i]);
                if (outside)
                {
                    if (current == null)
                    {
                        current = new RoadLine(line.Class, line.Name);
                        if (i > 0) current.Points.Add(pts[i - 1]);
                        result.Add(current);
                    }
                    current.Points.Add(pts[i]);
                }
                else if (current != null)
                {
                    current.Points.Add(pts[i]);
                    current = null;
                }
            }
            result.RemoveAll(l => l.Points.Count < 2);
            return result;
        }

        static void AddClipped(List<RoadLine> lines, RoadLine line)
        {
            lines.AddRange(ClipOut(line, InCrescent));
        }

        static void Residential(List<RoadLine> lines)
        {
            float gx0 = DowntownX[0], gx1 = DowntownX[DowntownX.Length - 1];
            float gz0 = DowntownZ[0], gz1 = DowntownZ[DowntownZ.Length - 1];

            // Downtown's north-south streets carry on north and south, waving more the further they go.
            for (int i = 0; i < DowntownX.Length; i++)
            {
                float x = DowntownX[i];
                if (Mathf.Approximately(x, MainAvenueX)) continue;
                if (i == 1 || i == 7) continue; // wider blocks here for the parks
                float phase = i * 1.3f;
                float amp = 16f + 5f * (i % 3);
                AddClipped(lines, Trace(RoadClass.Residential, "", z => new Vector2(x + amp * Ease(z, gz1, gz1 + 90f) * Mathf.Sin((z - gz1) / 95f + phase), z), gz1, RingNorth + 35f, 12f));
                if (i == 3 || i == 8) continue;
                AddClipped(lines, Trace(RoadClass.Residential, "", z => new Vector2(x + amp * Ease(z, gz0, gz0 - 90f) * Mathf.Sin((gz0 - z) / 105f + phase), z), gz0, RingSouth - 35f, 12f));
            }

            // Downtown's east-west streets carry on west.
            for (int j = 0; j < DowntownZ.Length; j++)
            {
                float z = DowntownZ[j];
                if (Mathf.Approximately(z, FlaglerZ)) continue;
                if (j == 6) continue;
                float phase = j * 0.9f;
                float amp = 14f + 6f * (j % 2);
                AddClipped(lines, Trace(RoadClass.Residential, "", x => new Vector2(x, z + amp * Ease(x, gx0, gx0 - 90f) * Mathf.Sin((gx0 - x) / 100f + phase)), gx0, RingWest - 35f, 12f));
            }

            // Curving east-west streets north and south of downtown, from the ring to the boulevard.
            float[] north = { 520f, 630f, 740f, 845f };
            float[] south = { -520f, -625f, -735f, -840f };
            for (int k = 0; k < north.Length; k++)
            {
                float z = north[k];
                float phase = k * 1.7f + 0.4f;
                AddClipped(lines, Trace(RoadClass.Residential, "", x => new Vector2(x, z + 20f * Mathf.Sin(x / 150f + phase) + 8f * Mathf.Sin(x / 57f + phase * 2f)), RingWest - 35f, BoulevardX(z) + 60f, 12f));
            }
            for (int k = 0; k < south.Length; k++)
            {
                float z = south[k];
                float phase = k * 1.3f + 2.2f;
                AddClipped(lines, Trace(RoadClass.Residential, "", x => new Vector2(x, z + 20f * Mathf.Sin(x / 140f + phase) + 8f * Mathf.Sin(x / 61f + phase * 2f)), RingWest - 35f, BoulevardX(z) + 60f, 12f));
            }

            // Curving north-south streets in the west, from the ring's south side to its north side.
            float[] west = { -540f, -670f, -825f };
            for (int k = 0; k < west.Length; k++)
            {
                float x = west[k];
                float phase = k * 2.1f;
                AddClipped(lines, Trace(RoadClass.Residential, "", z => new Vector2(x + 15f * Mathf.Sin(z / 130f + phase) + 5f * Mathf.Sin(z / 47f + phase), z), RingSouth - 35f, RingNorth + 35f, 12f));
            }

            // A crescent in the north-west: a loop round a green, reached from the streets around it.
            var crescent = new RoadLine(RoadClass.Residential, "Crescent Drive") { Closed = true };
            for (int k = 0; k < 30; k++)
            {
                float t = k / 30f * Mathf.PI * 2f;
                crescent.Points.Add(CrescentCentre + new Vector2(Mathf.Cos(t) * CrescentRx, Mathf.Sin(t) * CrescentRz));
            }
            lines.Add(crescent);
        }
    }
}
