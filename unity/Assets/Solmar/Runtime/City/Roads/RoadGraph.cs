using System.Collections.Generic;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Deprecated: the axis an edge ran along when the district was an axis-aligned grid. Edges now
    /// run at any angle; use <see cref="RoadGraph.Direction"/> instead. Kept so old code compiles.
    /// </summary>
    public enum RoadOrientation
    {
        Horizontal,
        Vertical,
    }

    /// <summary>
    /// The kinds of street in the city, which set an edge's lanes, parking, median and pavement
    /// (see <see cref="RoadGraph.Template"/>). Ordered from least to most important: where two
    /// kinds overlap, the more important one wins.
    /// </summary>
    public enum RoadClass
    {
        /// <summary>Curving residential street: a lane each way, parking, 3.5 m pavements.</summary>
        Residential,
        /// <summary>Downtown side street: a lane each way, parking, 4.5 m pavements.</summary>
        Street,
        /// <summary>Ring road connecting the districts: two lanes each way, a 3 m planted median, no parking.</summary>
        Arterial,
        /// <summary>Downtown avenue: two lanes each way, parking, a 4 m median with palms.</summary>
        Avenue,
        /// <summary>The coastal boulevard: two lanes each way, parking, a 5 m median with palms.</summary>
        Boulevard,
    }

    /// <summary>
    /// An intersection (or, with two edges, a bend in a street): a position and the edges that meet
    /// there. <see cref="RoadJunctions.Compute"/> fills in the edges sorted around it and the kerb
    /// corners between them.
    /// </summary>
    public sealed class RoadNode
    {
        public Vector2 Position;
        public readonly List<int> EdgeIds = new List<int>();

        /// <summary>The edge ids sorted counter-clockwise (seen from above) by the direction they leave the node.</summary>
        public readonly List<int> Sorted = new List<int>();

        /// <summary>
        /// The kerb line around each corner between consecutive sorted edges: Corners[k] runs from
        /// the left kerb of Sorted[k] (where its road surface stops) round to the right kerb of
        /// Sorted[k + 1]. "Left" and "right" are as seen travelling away from the node.
        /// </summary>
        public readonly List<List<Vector2>> Corners = new List<List<Vector2>>();

        /// <summary>Whether corner k is a real street corner (a block corner between two roads) rather than the open side of a bend or T-junction.</summary>
        public readonly List<bool> CornerClosed = new List<bool>();

        public int Degree => EdgeIds.Count;
    }

    /// <summary>
    /// A street between two nodes, always a straight segment: lane counts, parking, an optional
    /// planted median and a sidewalk width. Widths are in metres, built from the same lane and
    /// parking dimensions as the single street (Layout.LaneWidth, Layout.ParkingWidth).
    ///
    /// Traffic keeps right. Seen travelling from A to B, the lanes going that way are on the right
    /// (negative offsets from the centreline, <see cref="RoadGraph.Left"/> being positive).
    /// </summary>
    public sealed class RoadEdge
    {
        public int A, B;
        public RoadClass Class = RoadClass.Street;
        public string Name = "";
        public int LanesPerDirection = 1;
        public bool Parking = true;
        public float MedianWidth;
        public float SidewalkWidth = RoadWidths.DefaultSidewalk;

        /// <summary>How far from node A (and from node B) the edge's own road surface starts: the rest, up to the node, is the junction plate. Set by <see cref="RoadJunctions.Compute"/>.</summary>
        public float TrimA, TrimB;

        /// <summary>Kerb-to-kerb half width of one carriageway (one direction of travel).</summary>
        public float CarriagewayHalfWidth => LanesPerDirection * RoadWidths.LaneWidth + (Parking ? RoadWidths.ParkingWidth : 0f);

        /// <summary>Half width of the whole road, centreline to kerb face: the carriageway plus half the median.</summary>
        public float HalfWidth => CarriagewayHalfWidth + MedianWidth * 0.5f;
    }

    /// <summary>
    /// A graph of streets: nodes (intersections) with a position, and edges (streets) with their own
    /// lane counts, parking and median. Every query needed to lay out road, pavement and building
    /// geometry from the graph lives here, so the mesh builders only ever read from it; traffic and
    /// pedestrians use the lane, stop-line and pavement queries.
    ///
    /// Positions are (x, z) in metres. Along an edge, `s` is the distance from a node and `w` the
    /// offset across it, positive to the left of the direction away from that node.
    /// </summary>
    public sealed class RoadGraph
    {
        /// <summary>The road network of the map being played, set by the generator that built it
        /// (for traffic, pedestrians and the minimap). Null when there is none.</summary>
        public static RoadGraph Current;

        public readonly List<RoadNode> Nodes = new List<RoadNode>();
        public readonly List<RoadEdge> Edges = new List<RoadEdge>();

        const float IndexCell = 100f;
        Dictionary<long, List<int>> index;

        public int AddNode(Vector2 position)
        {
            Nodes.Add(new RoadNode { Position = position });
            index = null;
            return Nodes.Count - 1;
        }

        /// <summary>Adds a street between two nodes with the given cross-section.</summary>
        public int AddEdge(int a, int b, int lanesPerDirection = 1, bool parking = true, float medianWidth = 0f, float sidewalkWidth = -1f)
        {
            var edge = new RoadEdge
            {
                A = a,
                B = b,
                LanesPerDirection = Mathf.Max(1, lanesPerDirection),
                Parking = parking,
                MedianWidth = Mathf.Max(0f, medianWidth),
                SidewalkWidth = sidewalkWidth >= 0f ? sidewalkWidth : RoadWidths.DefaultSidewalk,
            };
            return Add(edge);
        }

        /// <summary>Adds a street of a class, with that class's cross-section (<see cref="Template"/>).</summary>
        public int AddEdge(int a, int b, RoadClass roadClass, string name = "")
        {
            RoadEdge edge = Template(roadClass);
            edge.A = a;
            edge.B = b;
            edge.Name = name ?? "";
            return Add(edge);
        }

        /// <summary>Deprecated: edges run at any angle now, so the orientation is ignored.</summary>
        public int AddEdge(int a, int b, RoadOrientation orientation, int lanesPerDirection = 1, bool parking = true, float medianWidth = 0f, float sidewalkWidth = -1f)
        {
            return AddEdge(a, b, lanesPerDirection, parking, medianWidth, sidewalkWidth);
        }

        int Add(RoadEdge edge)
        {
            Edges.Add(edge);
            int id = Edges.Count - 1;
            Nodes[edge.A].EdgeIds.Add(id);
            Nodes[edge.B].EdgeIds.Add(id);
            index = null;
            return id;
        }

        /// <summary>A new edge with the cross-section of a road class (A and B unset).</summary>
        public static RoadEdge Template(RoadClass roadClass)
        {
            switch (roadClass)
            {
                case RoadClass.Boulevard:
                    return new RoadEdge { Class = roadClass, LanesPerDirection = 2, Parking = true, MedianWidth = 5f, SidewalkWidth = 5f };
                case RoadClass.Avenue:
                    return new RoadEdge { Class = roadClass, LanesPerDirection = 2, Parking = true, MedianWidth = 4f, SidewalkWidth = 5f };
                case RoadClass.Arterial:
                    return new RoadEdge { Class = roadClass, LanesPerDirection = 2, Parking = false, MedianWidth = 3f, SidewalkWidth = 4f };
                case RoadClass.Street:
                    return new RoadEdge { Class = roadClass, LanesPerDirection = 1, Parking = true, MedianWidth = 0f, SidewalkWidth = 4.5f };
                default:
                    return new RoadEdge { Class = RoadClass.Residential, LanesPerDirection = 1, Parking = true, MedianWidth = 0f, SidewalkWidth = 3.5f };
            }
        }

        /// <summary>The node at the other end of an edge from `nodeIndex`.</summary>
        public int OtherNode(RoadEdge e, int nodeIndex) => e.A == nodeIndex ? e.B : e.A;

        /// <summary>Length of an edge from node to node, metres.</summary>
        public float Length(RoadEdge e) => Vector2.Distance(Nodes[e.A].Position, Nodes[e.B].Position);

        /// <summary>Unit direction of an edge from A to B.</summary>
        public Vector2 Direction(RoadEdge e) => SafeNormal(Nodes[e.B].Position - Nodes[e.A].Position);

        /// <summary>Unit direction of an edge leaving `nodeIndex` (towards its other node).</summary>
        public Vector2 DirectionFrom(RoadEdge e, int nodeIndex) => e.A == nodeIndex ? Direction(e) : -Direction(e);

        /// <summary>The unit vector 90° to the left of `direction` (counter-clockwise seen from above).</summary>
        public static Vector2 Left(Vector2 direction) => new Vector2(-direction.y, direction.x);

        /// <summary>
        /// Where the road meets the junction plate at `nodeIndex`: the distance from the node, along
        /// the edge, at which the edge's own road surface (and its crosswalk) starts.
        /// </summary>
        public float TrimAt(RoadEdge edge, int nodeIndex) => edge.A == nodeIndex ? edge.TrimA : edge.TrimB;

        /// <summary>True where three or more streets meet (a bend in one street has two).</summary>
        public bool IsJunction(int nodeIndex) => Nodes[nodeIndex].EdgeIds.Count >= 3;

        /// <summary>True where the junction has traffic signals: every crossing of four or more streets.</summary>
        public bool HasSignals(int nodeIndex) => Nodes[nodeIndex].EdgeIds.Count >= 4;

        /// <summary>
        /// Distance from `nodeIndex` along the edge to the stop line for traffic arriving at that
        /// node: behind the crosswalk at a junction, right at the trim at a mere bend.
        /// </summary>
        public float StopLineAt(RoadEdge edge, int nodeIndex)
        {
            float trim = TrimAt(edge, nodeIndex);
            return IsJunction(nodeIndex) ? trim + RoadWidths.CrosswalkDepth + RoadWidths.StopLineGap : trim;
        }

        /// <summary>World (x, z) at distance `s` from `nodeIndex` along the edge and `w` to the left of the direction away from the node.</summary>
        public Vector2 PointFrom(RoadEdge edge, int nodeIndex, float s, float w)
        {
            Vector2 d = DirectionFrom(edge, nodeIndex);
            return Nodes[nodeIndex].Position + d * s + Left(d) * w;
        }

        /// <summary>Distance of the centre of lane `lane` (0 = next to the centreline or median) from the centreline.</summary>
        public static float LaneOffset(RoadEdge edge, int lane) => edge.MedianWidth * 0.5f + (Mathf.Clamp(lane, 0, edge.LanesPerDirection - 1) + 0.5f) * RoadWidths.LaneWidth;

        /// <summary>Distance of the centre of the parking lane from the centreline (only meaningful when the edge has parking).</summary>
        public static float ParkingOffset(RoadEdge edge) => edge.MedianWidth * 0.5f + edge.LanesPerDirection * RoadWidths.LaneWidth + RoadWidths.ParkingWidth * 0.5f;

        /// <summary>Distance of the middle of the pavement from the centreline.</summary>
        public static float SidewalkOffset(RoadEdge edge) => edge.HalfWidth + edge.SidewalkWidth * 0.5f;

        /// <summary>
        /// A point in lane `lane` for traffic travelling away from `fromNode` along the edge (right-hand
        /// traffic, so it is on the right of that direction), `s` metres from the node.
        /// </summary>
        public Vector2 LanePoint(RoadEdge edge, int fromNode, int lane, float s) => PointFrom(edge, fromNode, s, -LaneOffset(edge, lane));

        /// <summary>A point on the middle of the pavement, `s` metres from `fromNode`; side +1 is the left of the direction away from the node, -1 the right.</summary>
        public Vector2 SidewalkPoint(RoadEdge edge, int fromNode, float s, int side) => PointFrom(edge, fromNode, s, (side >= 0 ? 1f : -1f) * SidewalkOffset(edge));

        /// <summary>
        /// The edge nearest to `p`, or -1 if there is none within `maxDistance`: `s` is the distance
        /// along it from its node A (clamped to the edge) and `w` the signed offset to the left of A→B.
        /// </summary>
        public int NearestEdge(Vector2 p, out float s, out float w, float maxDistance = 200f)
        {
            s = w = 0f;
            BuildIndex();
            int best = -1;
            float bestDist = maxDistance;
            int r = Mathf.CeilToInt(maxDistance / IndexCell);
            int cx = Mathf.FloorToInt(p.x / IndexCell), cz = Mathf.FloorToInt(p.y / IndexCell);
            var seen = new HashSet<int>();
            for (int i = cx - r; i <= cx + r; i++)
            {
                for (int j = cz - r; j <= cz + r; j++)
                {
                    if (!index.TryGetValue(Key(i, j), out List<int> ids)) continue;
                    foreach (int id in ids)
                    {
                        if (!seen.Add(id)) continue;
                        RoadEdge e = Edges[id];
                        Vector2 a = Nodes[e.A].Position;
                        float len = Length(e);
                        Vector2 d = Direction(e);
                        float along = Mathf.Clamp(Vector2.Dot(p - a, d), 0f, len);
                        Vector2 q = a + d * along;
                        float dist = Vector2.Distance(p, q);
                        if (dist < bestDist)
                        {
                            bestDist = dist;
                            best = id;
                            s = along;
                            w = Vector2.Dot(p - a, Left(d));
                        }
                    }
                }
            }
            return best;
        }

        void BuildIndex()
        {
            if (index != null) return;
            index = new Dictionary<long, List<int>>();
            for (int id = 0; id < Edges.Count; id++)
            {
                Vector2 a = Nodes[Edges[id].A].Position, b = Nodes[Edges[id].B].Position;
                int x0 = Mathf.FloorToInt(Mathf.Min(a.x, b.x) / IndexCell), x1 = Mathf.FloorToInt(Mathf.Max(a.x, b.x) / IndexCell);
                int z0 = Mathf.FloorToInt(Mathf.Min(a.y, b.y) / IndexCell), z1 = Mathf.FloorToInt(Mathf.Max(a.y, b.y) / IndexCell);
                for (int i = x0; i <= x1; i++)
                {
                    for (int j = z0; j <= z1; j++)
                    {
                        long k = Key(i, j);
                        if (!index.TryGetValue(k, out List<int> list)) index.Add(k, list = new List<int>());
                        list.Add(id);
                    }
                }
            }
        }

        static long Key(int i, int j) => ((long)i << 32) ^ (uint)j;

        /// <summary>The normalised vector, or zero for a zero-length one (never NaN).</summary>
        public static Vector2 SafeNormal(Vector2 v)
        {
            float m = v.magnitude;
            return m > 1e-6f ? v / m : Vector2.zero;
        }
    }
}
