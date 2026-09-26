using System.Collections.Generic;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Fills each block with what its district calls for, as plain footprints:
    ///
    ///   Downtown and the beach strip: a ring of buildings along the building line, cut into lots
    ///   of 15–45 m (a corner always ends a lot), each lot reaching back to a line a fixed depth
    ///   behind the frontage, so the party walls between lots follow the corners' bisectors and a
    ///   courtyard is left in the middle. Downtown lots rise to towers of 15–45 storeys towards the
    ///   centre; beach lots are Art Deco (3–6 storeys) or MiMo hotels (5–16).
    ///   Residential: detached houses of two or three storeys, each set back in its own lot with a
    ///   front yard, some with a pool and palms.
    ///   Parks: paths from the corners to a fountain in the middle, trees and palms on the grass.
    ///   Plazas: paving with palms.
    /// </summary>
    public static class LotPlanner
    {
        static readonly Vector2 DowntownCentre = new Vector2(CityLayout.MainAvenueX, CityLayout.FlaglerZ);

        public static void Plan(CityPlan plan, CityBlock b, Rng random)
        {
            switch (b.Kind)
            {
                case BlockKind.Park:
                    PlanPark(b, random);
                    break;
                case BlockKind.Plaza:
                    PlanPlaza(b, random);
                    break;
                case BlockKind.Buildings:
                    if (b.District == District.Residential) PlanHouses(plan, b, random);
                    else PlanRing(plan, b, random);
                    break;
            }
        }

        /// <summary>A position along a polyline: which segment, and how far along it (0..1).</summary>
        struct Station
        {
            public int seg;
            public float t;
        }

        /// <summary>Distances round a polyline (closed or open) and conversions to stations.</summary>
        sealed class Walk
        {
            public readonly List<Vector2> pts;
            public readonly float[] cum;
            public readonly bool closed;
            public float Length => cum[cum.Length - 1];
            public int Segments => closed ? pts.Count : pts.Count - 1;

            public Walk(List<Vector2> points, bool closed)
            {
                pts = points;
                this.closed = closed;
                int n = Segments;
                cum = new float[n + 1];
                for (int i = 0; i < n; i++) cum[i + 1] = cum[i] + Vector2.Distance(pts[i], pts[(i + 1) % pts.Count]);
            }

            public Station At(float d)
            {
                d = Mathf.Clamp(d, 0f, Length);
                int n = Segments;
                for (int i = 0; i < n; i++)
                {
                    if (d <= cum[i + 1] || i == n - 1)
                    {
                        float len = cum[i + 1] - cum[i];
                        return new Station { seg = i, t = len > 1e-5f ? Mathf.Clamp01((d - cum[i]) / len) : 0f };
                    }
                }
                return new Station { seg = n - 1, t = 1f };
            }

            public Vector2 Point(List<Vector2> line, Station s) => Vector2.LerpUnclamped(line[s.seg], line[(s.seg + 1) % line.Count], s.t);
        }

        /// <summary>
        /// Lot boundaries (distances round the walk, ascending, first 0 and last Length) with every
        /// sharp corner a boundary and the runs between cut into lots of about `minW`–`maxW`.
        /// </summary>
        static List<float> Boundaries(Walk walk, float minW, float maxW, Rng random, float sharpDegrees = 28f)
        {
            var sharp = new List<float> { 0f };
            int n = walk.pts.Count;
            int first = walk.closed ? 0 : 1, last = walk.closed ? n - 1 : n - 2;
            for (int i = first; i <= last; i++)
            {
                if (walk.closed && i == 0) continue;
                Vector2 a = walk.pts[(i + n - 1) % n], b = walk.pts[i], c = walk.pts[(i + 1) % n];
                float turn = Vector2.Angle(b - a, c - b);
                if (turn > sharpDegrees) sharp.Add(walk.cum[i]);
            }
            sharp.Add(walk.Length);
            var result = new List<float> { 0f };
            for (int k = 0; k < sharp.Count - 1; k++)
            {
                float from = sharp[k], to = sharp[k + 1];
                float len = to - from;
                if (len < 0.5f) continue;
                float w = random.Range(minW, maxW);
                int lots = Mathf.Max(1, Mathf.RoundToInt(len / w));
                for (int i = 1; i < lots; i++)
                {
                    float jitter = (random.Next() - 0.5f) * 0.25f * len / lots;
                    result.Add(from + len * i / lots + jitter);
                }
                result.Add(to);
            }
            return result;
        }

        /// <summary>Rotates a closed polygon to start at its sharpest corner, so a lot boundary sits on a corner.</summary>
        static List<Vector2> StartAtCorner(List<Vector2> poly)
        {
            int n = poly.Count, best = 0;
            float bestTurn = -1f;
            for (int i = 0; i < n; i++)
            {
                float turn = Vector2.Angle(poly[i] - poly[(i + n - 1) % n], poly[(i + 1) % n] - poly[i]);
                if (turn > bestTurn)
                {
                    bestTurn = turn;
                    best = i;
                }
            }
            var r = new List<Vector2>(n);
            for (int i = 0; i < n; i++) r.Add(poly[(best + i) % n]);
            return r;
        }

        /// <summary>
        /// A lot's footprint between two boundaries: the frontage from `d0` to `d1` along the front
        /// line, then back along the same stretch of the back line. Sides along the frontage are
        /// facades; the ends and (unless `allRound`) the back are blank.
        /// </summary>
        static BuildingPlan Lot(Walk walk, List<Vector2> front, List<Vector2> back, float d0, float d1, bool allRound)
        {
            Station s0 = walk.At(d0), s1 = walk.At(d1);
            var f = new List<Vector2> { walk.Point(front, s0) };
            var bk = new List<Vector2> { walk.Point(back, s0) };
            for (int i = s0.seg + 1; i <= s1.seg; i++)
            {
                // Vertices strictly inside the stretch.
                if (walk.cum[i] <= d0 + 0.05f || walk.cum[i] >= d1 - 0.05f) continue;
                f.Add(front[i % front.Count]);
                bk.Add(back[i % back.Count]);
            }
            f.Add(walk.Point(front, s1));
            bk.Add(walk.Point(back, s1));

            var plan = new BuildingPlan();
            plan.Footprint.AddRange(f);
            for (int i = 0; i < f.Count - 1; i++) plan.Facade.Add(true);
            plan.Facade.Add(allRound); // end wall
            for (int i = bk.Count - 1; i >= 0; i--) plan.Footprint.Add(bk[i]);
            for (int i = 0; i < bk.Count - 1; i++) plan.Facade.Add(allRound);
            plan.Facade.Add(allRound); // start wall
            float longest = -1f;
            for (int i = 0; i < f.Count - 1; i++)
            {
                float len = Vector2.Distance(f[i], f[i + 1]);
                if (len > longest)
                {
                    longest = len;
                    plan.Front = i;
                }
            }
            plan.Centre = Polygons.Centroid(plan.Footprint);
            return plan;
        }

        static bool Usable(BuildingPlan p) => Polygons.SignedArea(p.Footprint) > 25f;

        /// <summary>Downtown and beach blocks: a ring of buildings round a courtyard.</summary>
        static void PlanRing(CityPlan plan, CityBlock b, Rng random)
        {
            bool downtown = b.District == District.Downtown;
            List<Vector2> front = StartAtCorner(Polygons.Dedupe(b.BuildingLine));
            float depth = downtown ? random.Range(22f, 30f) : random.Range(15f, 20f);
            List<Vector2> back = null;
            while (depth >= 9f)
            {
                var d = new List<float>();
                for (int i = 0; i < front.Count; i++) d.Add(depth);
                back = Polygons.Offset(front, d, 3f);
                if (Polygons.OffsetValid(front, back, 1f)) break;
                back = null;
                depth *= 0.8f;
            }
            if (back == null)
            {
                // Too small for a ring: one building filling the block, windows all round.
                if (b.Area > 250f)
                {
                    var whole = new BuildingPlan();
                    whole.Footprint.AddRange(front);
                    for (int i = 0; i < front.Count; i++) whole.Facade.Add(true);
                    whole.Centre = Polygons.Centroid(front);
                    Style(whole, b, random, true);
                    plan.Buildings.Add(whole);
                }
                return;
            }

            var walk = new Walk(front, true);
            List<float> bounds = downtown ? Boundaries(walk, 24f, 42f, random) : Boundaries(walk, 15f, 28f, random);
            for (int k = 0; k < bounds.Count - 1; k++)
            {
                float d0 = bounds[k], d1 = bounds[k + 1];
                if (d1 - d0 < 6f) continue;
                if (random.Next() < (downtown ? 0.05f : 0.08f)) continue; // a gap: a car park or a little plaza
                bool tower = downtown && random.Next() < TowerChance(walk.Point(front, walk.At((d0 + d1) * 0.5f)));
                BuildingPlan lot = Lot(walk, front, back, d0, d1, tower);
                if (!Usable(lot)) continue;
                if (tower) Tower(lot, random);
                else Style(lot, b, random, false);
                plan.Buildings.Add(lot);
            }
        }

        static float TowerChance(Vector2 p)
        {
            float f = Mathf.Clamp01(1f - Vector2.Distance(p, DowntownCentre) / 650f);
            return 0.12f + 0.5f * f;
        }

        static void Tower(BuildingPlan p, Rng random)
        {
            float f = Mathf.Clamp01(1f - Vector2.Distance(p.Centre, DowntownCentre) / 650f);
            p.Style = BuildingStyle.Tower;
            p.Storeys = 15 + Mathf.RoundToInt(Mathf.Pow(random.Next(), 1.3f) * (8f + 22f * f));
            p.Tint = random.Range(0, 8);
            p.Seed = random.Next();
            p.Height = Heights.Of(p);
        }

        /// <summary>Style and height of a non-tower building in a ring (or a whole small block).</summary>
        static void Style(BuildingPlan p, CityBlock b, Rng random, bool whole)
        {
            p.Seed = random.Next();
            p.Tint = random.Range(0, 8);
            if (b.District == District.Downtown)
            {
                float f = Mathf.Clamp01(1f - Vector2.Distance(p.Centre, DowntownCentre) / 650f);
                p.Style = BuildingStyle.Office;
                p.Storeys = 3 + Mathf.RoundToInt(random.Next() * (4f + 8f * f));
                if (whole && random.Next() < 0.4f)
                {
                    p.Style = BuildingStyle.Tower;
                    p.Storeys = 12 + Mathf.RoundToInt(random.Next() * 14f);
                }
            }
            else
            {
                bool seafront = p.Centre.x > CityLayout.BoulevardX(p.Centre.y) - 95f;
                if (seafront || random.Next() < 0.35f)
                {
                    p.Style = BuildingStyle.MiMo;
                    p.Storeys = seafront ? 7 + Mathf.RoundToInt(random.Next() * 9f) : 5 + Mathf.RoundToInt(random.Next() * 5f);
                }
                else
                {
                    p.Style = BuildingStyle.Deco;
                    p.Storeys = 2 + Mathf.RoundToInt(random.Next() * 4f);
                }
            }
            p.Height = Heights.Of(p);
        }

        /// <summary>Residential blocks: detached houses in their own yards.</summary>
        static void PlanHouses(CityPlan plan, CityBlock b, Rng random)
        {
            List<Vector2> line = StartAtCorner(Polygons.Dedupe(b.BuildingLine));
            var walk = new Walk(line, true);
            List<float> bounds = Boundaries(walk, 17f, 24f, random, 24f);
            var placed = new List<Vector2[]>();
            for (int k = 0; k < bounds.Count - 1; k++)
            {
                float d0 = bounds[k], d1 = bounds[k + 1];
                if (d1 - d0 < 11f) continue;
                Vector2 a = walk.Point(line, walk.At(d0)), c = walk.Point(line, walk.At(d1));
                Vector2 dir = RoadGraph.SafeNormal(c - a);
                if (dir == Vector2.zero) continue;
                Vector2 inward = RoadGraph.Left(dir);
                Vector2 mid = walk.Point(line, walk.At((d0 + d1) * 0.5f));
                float lotW = Vector2.Distance(a, c);
                for (int attempt = 0; attempt < 2; attempt++)
                {
                    float scale = attempt == 0 ? 1f : 0.78f;
                    float w = Mathf.Min(lotW - 4f, random.Range(9f, 13f)) * scale;
                    float depth = random.Range(9f, 12f) * scale;
                    float setback = random.Range(4f, 6.5f);
                    if (w < 6.5f) break;
                    Vector2 p0 = mid - dir * (w * 0.5f) + inward * setback;
                    Vector2 p1 = mid + dir * (w * 0.5f) + inward * setback;
                    Vector2[] rect = { p0, p1, p1 + inward * depth, p0 + inward * depth };
                    if (!Polygons.Inside(rect, line) || Overlaps(rect, placed, 2f)) continue;
                    var house = new BuildingPlan { Style = BuildingStyle.House, Front = 0, Seed = random.Next(), Tint = random.Range(0, 8) };
                    house.Footprint.AddRange(rect);
                    for (int i = 0; i < 4; i++) house.Facade.Add(true);
                    house.Storeys = random.Next() < 0.65f ? 2 : 3;
                    house.HipRoof = random.Next() < 0.45f;
                    house.Centre = Polygons.Centroid(rect);
                    house.Height = Heights.Of(house);
                    plan.Buildings.Add(house);
                    placed.Add(rect);

                    // A pool in the back yard, a palm or a tree in the front yard.
                    if (random.Next() < 0.35f)
                    {
                        Vector2 pc = mid + inward * (setback + depth + 5f) + dir * random.Range(-2f, 2f);
                        Vector2[] pool = { pc - dir * 4f - inward * 2f, pc + dir * 4f - inward * 2f, pc + dir * 4f + inward * 2f, pc - dir * 4f + inward * 2f };
                        if (Polygons.Inside(pool, line) && !Overlaps(pool, placed, 1.5f))
                        {
                            b.Pools.Add(pool);
                            placed.Add(pool);
                        }
                    }
                    Vector2 yard = mid + inward * (setback * 0.45f) + dir * ((w * 0.5f + 1.5f) * (random.Next() < 0.5f ? -1f : 1f));
                    if (random.Next() < 0.6f && Polygons.Contains(line, yard) && Polygons.DistanceToEdges(line, yard) > 1.2f)
                    {
                        if (random.Next() < 0.55f) b.Palms.Add(yard);
                        else b.Trees.Add(yard);
                    }
                    Vector2 backYard = mid + inward * (setback + depth + 6f) + dir * random.Range(-w * 0.4f, w * 0.4f);
                    if (random.Next() < 0.45f && Polygons.Contains(line, backYard) && Polygons.DistanceToEdges(line, backYard) > 2f && !InAny(backYard, placed)) b.Trees.Add(backYard);
                    break;
                }
            }
        }

        static bool InAny(Vector2 p, List<Vector2[]> rects)
        {
            foreach (Vector2[] r in rects)
            {
                if (Polygons.Contains(r, p)) return true;
            }
            return false;
        }

        static bool Overlaps(Vector2[] rect, List<Vector2[]> placed, float clearance)
        {
            Vector2[] grown = Grow(rect, clearance);
            foreach (Vector2[] other in placed)
            {
                if (Polygons.ConvexOverlap(grown, other)) return true;
            }
            return false;
        }

        static Vector2[] Grow(Vector2[] rect, float by)
        {
            Vector2 c = (rect[0] + rect[1] + rect[2] + rect[3]) * 0.25f;
            var r = new Vector2[4];
            for (int i = 0; i < 4; i++)
            {
                Vector2 d = rect[i] - c;
                r[i] = rect[i] + RoadGraph.SafeNormal(d) * by * 1.41f;
            }
            return r;
        }

        /// <summary>Parks: paths from the corners to a fountain, trees and palms on the grass.</summary>
        static void PlanPark(CityBlock b, Rng random)
        {
            List<Vector2> line = b.BuildingLine;
            Vector2 c = b.Centre;
            if (!Polygons.Contains(line, c)) return;
            // Paths from the sharpest corners to the middle.
            var corners = new List<(float turn, int i)>();
            int n = line.Count;
            for (int i = 0; i < n; i++)
            {
                float turn = Vector2.Angle(line[i] - line[(i + n - 1) % n], line[(i + 1) % n] - line[i]);
                corners.Add((turn, i));
            }
            corners.Sort((u, v) => v.turn.CompareTo(u.turn));
            var ends = new List<Vector2>();
            foreach ((float turn, int i) in corners)
            {
                if (ends.Count >= 4) break;
                Vector2 p = line[i];
                bool far = true;
                foreach (Vector2 e in ends) far &= Vector2.Distance(e, p) > 40f;
                if (!far) continue;
                ends.Add(p);
                b.Paths.Add(new[] { p, c });
            }
            float spacing = 17f;
            float x0 = float.MaxValue, x1 = float.MinValue, z0 = float.MaxValue, z1 = float.MinValue;
            foreach (Vector2 p in line)
            {
                x0 = Mathf.Min(x0, p.x);
                x1 = Mathf.Max(x1, p.x);
                z0 = Mathf.Min(z0, p.y);
                z1 = Mathf.Max(z1, p.y);
            }
            for (float x = x0 + spacing * 0.5f; x < x1; x += spacing)
            {
                for (float z = z0 + spacing * 0.5f; z < z1; z += spacing)
                {
                    var p = new Vector2(x + random.Range(-6f, 6f), z + random.Range(-6f, 6f));
                    if (!Polygons.Contains(line, p) || Polygons.DistanceToEdges(line, p) < 4f) continue;
                    if (Vector2.Distance(p, c) < 16f) continue;
                    bool onPath = false;
                    foreach (Vector2[] path in b.Paths) onPath |= Polygons.DistanceToSegment(p, path[0], path[1]) < 4f;
                    if (onPath || random.Next() < 0.35f) continue;
                    if (random.Next() < 0.35f) b.Palms.Add(p);
                    else b.Trees.Add(p);
                }
            }
        }

        /// <summary>Plazas: palms in a loose grid across the paving.</summary>
        static void PlanPlaza(CityBlock b, Rng random)
        {
            List<Vector2> line = b.PavementValid ? b.BuildingLine : b.Kerb;
            if (line.Count < 3) return;
            const float spacing = 13f;
            float x0 = float.MaxValue, x1 = float.MinValue, z0 = float.MaxValue, z1 = float.MinValue;
            foreach (Vector2 p in line)
            {
                x0 = Mathf.Min(x0, p.x);
                x1 = Mathf.Max(x1, p.x);
                z0 = Mathf.Min(z0, p.y);
                z1 = Mathf.Max(z1, p.y);
            }
            for (float x = x0 + spacing * 0.5f; x < x1; x += spacing)
            {
                for (float z = z0 + spacing * 0.5f; z < z1; z += spacing)
                {
                    var p = new Vector2(x, z);
                    if (Polygons.Contains(line, p) && Polygons.DistanceToEdges(line, p) > 3f && random.Next() < 0.7f) b.Palms.Add(p);
                }
            }
        }

        /// <summary>
        /// A row of low buildings along one stretch of the outside of the ring road, facing it:
        /// warehouses, shops and small apartment blocks, with gaps and trees.
        /// </summary>
        public static void PlanOutskirts(CityPlan plan, List<Vector2> run, Rng random)
        {
            if (run.Count < 2) return;
            float depth = 18f;
            List<Vector2> back = Polygons.OffsetOpen(run, depth);
            var walk = new Walk(run, false);
            List<float> bounds = Boundaries(walk, 18f, 34f, random);
            for (int k = 0; k < bounds.Count - 1; k++)
            {
                float d0 = bounds[k], d1 = bounds[k + 1];
                if (d1 - d0 < 8f) continue;
                if (random.Next() < 0.2f)
                {
                    // A gap with a tree or two.
                    Vector2 p = walk.Point(run, walk.At((d0 + d1) * 0.5f));
                    Station st = walk.At((d0 + d1) * 0.5f);
                    Vector2 inward = walk.Point(back, st) - p;
                    plan.Outside.Trees.Add(p + inward * 0.5f);
                    continue;
                }
                BuildingPlan lot = Lot(walk, run, back, d0, d1, false);
                if (!Usable(lot)) continue;
                lot.Style = BuildingStyle.Lowrise;
                lot.Storeys = 1 + Mathf.RoundToInt(random.Next() * 3f);
                lot.Tint = random.Range(0, 8);
                lot.Seed = random.Next();
                lot.Height = Heights.Of(lot);
                plan.Buildings.Add(lot);
            }
        }
    }

    /// <summary>Storey heights by style, shared by the planner and the builder.</summary>
    public static class Heights
    {
        public static float Ground(BuildingStyle s) => s == BuildingStyle.House ? 3.2f : s == BuildingStyle.Lowrise ? 4.2f : 4.5f;
        public static float Storey(BuildingStyle s) => s == BuildingStyle.House ? 3.0f : s == BuildingStyle.Tower ? 3.6f : 3.3f;

        /// <summary>Height of the roof above the pavement: a ground floor and the storeys above it.</summary>
        public static float Of(BuildingPlan p) => Ground(p.Style) + Mathf.Max(0, p.Storeys - 1) * Storey(p.Style);
    }
}
