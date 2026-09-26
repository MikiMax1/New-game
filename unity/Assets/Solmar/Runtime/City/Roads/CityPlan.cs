using System.Collections.Generic;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>What a block is used for.</summary>
    public enum BlockKind
    {
        /// <summary>Buildings along its frontages (towers, hotels or houses, by district).</summary>
        Buildings,
        /// <summary>Grass, paths, trees and palms, and a fountain in the middle.</summary>
        Park,
        /// <summary>Paved, with palms in planters: small or awkward downtown blocks.</summary>
        Plaza,
        /// <summary>Everything outside the ring road (not a block: the land around the city).</summary>
        Outside,
    }

    /// <summary>
    /// One block of the city: a face of the planar road graph, the pavement round it and what fills
    /// it. Nodes run counter-clockwise round the block (clockwise for the outside), Edges[i] joining
    /// Nodes[i] to Nodes[i + 1].
    /// </summary>
    public sealed class CityBlock
    {
        public readonly List<int> Nodes = new List<int>();
        public readonly List<int> Edges = new List<int>();
        /// <summary>At Nodes[i], the index of the node's kerb corner (RoadNode.Corners) this block's corner is.</summary>
        public readonly List<int> Corners = new List<int>();

        /// <summary>The kerb line: the road side of the pavement, following the rounded kerb corners, in the block's own winding.</summary>
        public readonly List<Vector2> Kerb = new List<Vector2>();
        /// <summary>For each node i, the range of <see cref="Kerb"/> that is its corner: KerbCornerStart[i] to KerbCornerEnd[i] inclusive. The straight kerb along Edges[i] runs from KerbCornerEnd[i] to KerbCornerStart[i + 1].</summary>
        public readonly List<int> KerbCornerStart = new List<int>();
        public readonly List<int> KerbCornerEnd = new List<int>();

        /// <summary>The building line: the back of the pavement, one point per node (the pavement's inner edge).</summary>
        public List<Vector2> BuildingLine = new List<Vector2>();
        /// <summary>False when the block is too small or thin for a pavement ring: then it is paved right across.</summary>
        public bool PavementValid;

        public District District;
        public BlockKind Kind;
        public Vector2 Centre;
        /// <summary>Area inside the building line, m² (0 when there is no valid one).</summary>
        public float Area;

        /// <summary>Trees, palms, pools and paths the block's contents planner chose.</summary>
        public readonly List<Vector2> Trees = new List<Vector2>();
        public readonly List<Vector2> Palms = new List<Vector2>();
        public readonly List<Vector2[]> Pools = new List<Vector2[]>();
        public readonly List<Vector2[]> Paths = new List<Vector2[]>();
    }

    /// <summary>The style a building is built in.</summary>
    public enum BuildingStyle
    {
        /// <summary>Glass curtain-wall tower.</summary>
        Tower,
        /// <summary>Mid-rise office or apartment block with punched windows.</summary>
        Office,
        /// <summary>Miami Art Deco: pastel stucco, eyebrow ledges, a finned central tower.</summary>
        Deco,
        /// <summary>Miami Modern: continuous balconies with rails.</summary>
        MiMo,
        /// <summary>A detached two- or three-storey house in its own yard.</summary>
        House,
        /// <summary>Low commercial building or warehouse on the edge of town.</summary>
        Lowrise,
    }

    /// <summary>
    /// A building to build: a counter-clockwise footprint, which of its sides are facades with
    /// windows, and its height.
    /// </summary>
    public sealed class BuildingPlan
    {
        public BuildingStyle Style;
        public readonly List<Vector2> Footprint = new List<Vector2>();
        /// <summary>Per footprint side i (Footprint[i] → Footprint[i + 1]): true for a facade with windows, false for a blank party or back wall.</summary>
        public readonly List<bool> Facade = new List<bool>();
        /// <summary>The side facing the street (entrance, shop fronts).</summary>
        public int Front;
        public int Storeys;
        public int Tint;
        public float Seed;
        public bool HipRoof;
        public Vector2 Centre;
        /// <summary>Height to the roof (not counting the parapet), metres above the pavement.</summary>
        public float Height;
    }

    /// <summary>
    /// The whole city's plan, in plain geometry, before anything is built: the road graph with its
    /// junctions fitted, the blocks, every building and tree, the beach and the spawn points. Built
    /// from <see cref="CityLayout"/> and a seed; the same seed always gives the same city.
    /// </summary>
    public sealed class CityPlan
    {
        /// <summary>The plan of the map being played (set by the generator), for pedestrians, the minimap and missions.</summary>
        public static CityPlan Current;

        public RoadGraph Graph;
        public readonly List<CityBlock> Blocks = new List<CityBlock>();
        /// <summary>The land outside the ring road (its Nodes run clockwise round the city).</summary>
        public CityBlock Outside;
        public readonly List<BuildingPlan> Buildings = new List<BuildingPlan>();

        /// <summary>The seaward run of the outside's building line (the back of the boulevard's east pavement), south to north: the promenade starts here.</summary>
        public readonly List<Vector2> Waterfront = new List<Vector2>();
        /// <summary>The outside's building line in the ring's own order, split into runs that are not on the waterfront (for the buildings outside the ring).</summary>
        public readonly List<List<Vector2>> OutskirtRuns = new List<List<Vector2>>();

        /// <summary>Where the player starts (on a pavement) and which way they face.</summary>
        public Vector2 PlayerSpawn, PlayerFacing;
        /// <summary>Where the car starts (in a parking lane next to the player) and which way it faces (with the traffic in that lane).</summary>
        public Vector2 CarSpawn, CarFacing;

        /// <summary>Plans the whole city.</summary>
        public static CityPlan Build(uint seed)
        {
            var plan = new CityPlan();
            var random = new Rng(seed);
            plan.Graph = RoadPlanarizer.Build(CityLayout.Lines());
            RoadJunctions.Compute(plan.Graph);
            plan.FindBlocks();
            foreach (CityBlock b in plan.Blocks) plan.Classify(b, random);
            foreach (CityBlock b in plan.Blocks) LotPlanner.Plan(plan, b, random);
            plan.PlanOutside(random);
            plan.ChooseSpawn();
            return plan;
        }

        /// <summary>Traces every face of the planar graph: the blocks, and the one outside the ring.</summary>
        void FindBlocks()
        {
            RoadGraph g = Graph;
            var visited = new HashSet<long>();
            CityBlock outside = null;
            float outsideArea = float.MaxValue;
            for (int id = 0; id < g.Edges.Count; id++)
            {
                for (int dir = 0; dir < 2; dir++)
                {
                    int from = dir == 0 ? g.Edges[id].A : g.Edges[id].B;
                    if (visited.Contains(HalfKey(id, from))) continue;
                    CityBlock block = Trace(id, from, visited);
                    if (block == null) continue;
                    var loop = new List<Vector2>();
                    foreach (int n in block.Nodes) loop.Add(g.Nodes[n].Position);
                    float area = Polygons.SignedArea(loop);
                    if (area < outsideArea)
                    {
                        if (outside != null) Blocks.Add(outside);
                        outside = block;
                        outsideArea = area;
                    }
                    else Blocks.Add(block);
                }
            }
            // The outside is the one face that winds clockwise (the most negative area).
            Outside = outside;
            if (Outside != null)
            {
                Outside.Kind = BlockKind.Outside;
                BuildKerb(Outside);
            }
            foreach (CityBlock b in Blocks) BuildKerb(b);
            // Faces that still wind clockwise (only possible on a broken graph) are dropped.
            Blocks.RemoveAll(b => Polygons.SignedArea(NodeLoop(b)) <= 1f);
        }

        static long HalfKey(int edge, int from) => ((long)edge << 32) | (uint)from;

        CityBlock Trace(int startEdge, int startFrom, HashSet<long> visited)
        {
            RoadGraph g = Graph;
            var block = new CityBlock();
            var cornerAtNext = new List<int>();
            int e = startEdge, from = startFrom;
            int guard = 0;
            do
            {
                visited.Add(HalfKey(e, from));
                block.Nodes.Add(from);
                block.Edges.Add(e);
                int to = g.OtherNode(g.Edges[e], from);
                RoadNode node = g.Nodes[to];
                int deg = node.Sorted.Count;
                int k = node.Sorted.IndexOf(e);
                if (k < 0 || deg == 0) return null;
                int kPrev = (k - 1 + deg) % deg;
                cornerAtNext.Add(kPrev);
                e = node.Sorted[kPrev];
                from = to;
                if (++guard > 100000) return null;
            } while (e != startEdge || from != startFrom);
            // The corner at node i was found on arriving there, at the end of step i - 1.
            int count = block.Nodes.Count;
            for (int i = 0; i < count; i++) block.Corners.Add(cornerAtNext[(i + count - 1) % count]);
            return block;
        }

        List<Vector2> NodeLoop(CityBlock b)
        {
            var loop = new List<Vector2>(b.Nodes.Count);
            foreach (int n in b.Nodes) loop.Add(Graph.Nodes[n].Position);
            return loop;
        }

        /// <summary>The kerb line (rounded corners, straight runs) and the building line of a face.</summary>
        void BuildKerb(CityBlock b)
        {
            RoadGraph g = Graph;
            int count = b.Nodes.Count;
            for (int i = 0; i < count; i++)
            {
                List<Vector2> corner = g.Nodes[b.Nodes[i]].Corners[b.Corners[i]];
                b.KerbCornerStart.Add(b.Kerb.Count);
                // A corner runs from the leaving edge's left kerb round to the arriving edge's right
                // kerb; round the block it is walked the other way.
                for (int k = corner.Count - 1; k >= 0; k--) b.Kerb.Add(corner[k]);
                b.KerbCornerEnd.Add(b.Kerb.Count - 1);
            }

            List<Vector2> loop = NodeLoop(b);
            var offsets = new List<float>(count);
            foreach (int e in b.Edges) offsets.Add(g.Edges[e].HalfWidth + g.Edges[e].SidewalkWidth);
            b.BuildingLine = Polygons.Offset(loop, offsets, 3f);
            b.PavementValid = Polygons.OffsetValid(loop, b.BuildingLine, 1f);
            if (!b.PavementValid)
            {
                Polygons.CollapseFolds(loop, b.BuildingLine);
                b.PavementValid = Polygons.OffsetValid(loop, b.BuildingLine, 1f);
            }
            b.Centre = Polygons.Centroid(b.PavementValid ? b.BuildingLine : loop);
            b.Area = b.PavementValid ? Mathf.Abs(Polygons.SignedArea(b.BuildingLine)) : 0f;
        }

        void Classify(CityBlock b, Rng random)
        {
            b.District = CityLayout.DistrictAt(b.Centre);
            float roll = random.Next();
            if (!b.PavementValid || b.Area < 400f) b.Kind = BlockKind.Plaza;
            else if (CityLayout.InPark(b.Centre)) b.Kind = BlockKind.Park;
            else if (b.District == District.Downtown && b.Area < 1500f) b.Kind = BlockKind.Plaza;
            else if (b.District == District.Residential && b.Area > 5000f && b.Area < 16000f && roll < 0.07f) b.Kind = BlockKind.Park;
            else b.Kind = BlockKind.Buildings;
        }

        /// <summary>
        /// Splits the outside's building line into the waterfront (along the boulevard, facing the
        /// beach) and the runs that get a row of buildings facing the ring road.
        /// </summary>
        void PlanOutside(Rng random)
        {
            if (Outside == null || !Outside.PavementValid) return;
            List<Vector2> line = Outside.BuildingLine;
            int n = line.Count;
            var coastal = new bool[n];
            for (int i = 0; i < n; i++) coastal[i] = line[i].x > CityLayout.ShoreX(line[i].y) - 260f;
            // Start the walk at a change from coastal to not, so every run comes out whole.
            int start = 0;
            for (int i = 0; i < n; i++)
            {
                if (coastal[i] != coastal[(i + n - 1) % n])
                {
                    start = i;
                    break;
                }
            }
            List<Vector2> current = null;
            bool currentCoastal = false;
            var coastRuns = new List<List<Vector2>>();
            for (int k = 0; k <= n; k++)
            {
                int i = (start + k) % n;
                if (current == null || coastal[i] != currentCoastal || k == n)
                {
                    if (current != null && current.Count >= 2)
                    {
                        if (k == n) current.Add(line[i]);
                        (currentCoastal ? coastRuns : OutskirtRuns).Add(current);
                    }
                    if (k == n) break;
                    // Runs share their end points so there are no gaps between them.
                    current = new List<Vector2>();
                    if (k > 0) current.Add(line[(i + n - 1) % n]);
                    currentCoastal = coastal[i];
                }
                current.Add(line[i]);
            }
            // The waterfront is the longest coastal run; the outside winds clockwise, so reverse it to run south to north.
            List<Vector2> best = null;
            foreach (List<Vector2> run in coastRuns)
            {
                if (best == null || Polygons.Perimeter(run, false) > Polygons.Perimeter(best, false)) best = run;
            }
            if (best != null)
            {
                Waterfront.AddRange(best);
                if (Waterfront.Count > 1 && Waterfront[0].y > Waterfront[Waterfront.Count - 1].y) Waterfront.Reverse();
            }
            foreach (List<Vector2> run in OutskirtRuns) LotPlanner.PlanOutskirts(this, run, random);
        }

        /// <summary>The player starts on Flagler Avenue's north pavement, a block east of Main Avenue, with the car parked at the kerb beside them.</summary>
        void ChooseSpawn()
        {
            RoadGraph g = Graph;
            int id = g.NearestEdge(new Vector2(CityLayout.MainAvenueX + 50f, CityLayout.FlaglerZ), out _, out _, 400f);
            if (id < 0)
            {
                PlayerSpawn = CarSpawn = Vector2.zero;
                PlayerFacing = CarFacing = new Vector2(1f, 0f);
                return;
            }
            RoadEdge e = g.Edges[id];
            // Walk from the western end, so the left side of the direction is the north side.
            int from = g.Nodes[e.A].Position.x <= g.Nodes[e.B].Position.x ? e.A : e.B;
            Vector2 dir = g.DirectionFrom(e, from);
            float s = g.Length(e) * 0.5f;
            PlayerSpawn = g.PointFrom(e, from, s, e.HalfWidth + e.SidewalkWidth * 0.45f);
            PlayerFacing = -RoadGraph.Left(dir);
            // Traffic on the north side travels west (it keeps right): the car faces west.
            float w = e.Parking ? RoadGraph.ParkingOffset(e) : RoadGraph.LaneOffset(e, e.LanesPerDirection - 1);
            CarSpawn = g.PointFrom(e, from, s - 3f, w);
            CarFacing = -dir;
        }
    }
}
