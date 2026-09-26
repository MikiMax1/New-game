using System.Collections.Generic;
using Solmar.City;
using Solmar.City.Roads;
using Solmar.Traffic;
using UnityEngine;

namespace Solmar.Pedestrians
{
    /// <summary>
    /// A walkable network for pedestrians, built once at load: either both pavements of every
    /// street in <see cref="RoadGraph.Current"/> (with corner links tying them into a continuous
    /// perimeter around every block and a crossing link over every real junction and dead end), or,
    /// when there is no road graph, the old single street's two long pavements
    /// (<see cref="BuildFallbackStreet"/>). Direction is always taken from node positions, never
    /// <see cref="RoadOrientation"/>, so this works whether streets are grid-aligned or run at any
    /// angle (a curve being a chain of short straight edges, exactly like <see cref="LaneNetwork"/>
    /// already assumes for traffic).
    ///
    /// A route is just a walk from link to link: <see cref="PedestrianAgent"/> advances along one
    /// <see cref="WalkLink"/>'s baked polyline, and on reaching its end picks another link at that
    /// node at random. A non-crossing link can be walked straight onto; a crossing link (tagged with
    /// the <see cref="RoadGraph"/> edge/node it crosses) must be waited out first.
    /// </summary>
    public sealed class PedestrianNetwork
    {
        /// <summary>The network for the map currently loaded. Null until <see cref="PedestrianManager"/> builds it.</summary>
        public static PedestrianNetwork Current;

        public sealed class WalkLink
        {
            public int NodeA, NodeB;
            /// <summary>Baked polyline in world space, NodeA -&gt; NodeB order, ground height already resolved.</summary>
            public Vector3[] Points;
            public float[] Cumulative;
            public float Length;

            public bool IsCrossing;
            /// <summary>Crossing links only: the RoadGraph edge being crossed and the RoadGraph node it crosses at (for TrafficSignals.StateFor).</summary>
            public int RoadEdgeId = -1;
            public int RoadNodeId = -1;

            /// <summary>Sidewalk links only: unit vector from the kerb towards the building line, so a
            /// walker can nudge sideways from the baked line cheaply (no raycast) to avoid single-file walking.</summary>
            public Vector3 RightDir;
            /// <summary>Sidewalk links only: how far from the road centreline the baked Points already sit (metres).</summary>
            public float BakedOffset;
            public float MinOffset = 1.2f, MaxOffset = 2.5f;

            /// <summary>How busy this area is (from RoadGraph node degree), used to weight spawn density (downtown junctions get more people).</summary>
            public float Weight = 1f;
        }

        public readonly List<Vector3> Nodes = new List<Vector3>();
        public readonly List<WalkLink> Links = new List<WalkLink>();
        public readonly List<List<int>> NodeLinks = new List<List<int>>();

        float[] linkCumWeight;
        float totalWeight;

        const float SampleSpacing = 9f;
        const float CornerMargin = 1.5f;
        const float DeadEndMargin = 2.5f;
        const float MinEdgeUsable = 1f;
        const float MinSidewalkOffset = 0.6f;
        const float BaseOffsetFromKerb = 1.85f;

        int AddNode(Vector3 pos)
        {
            Nodes.Add(pos);
            NodeLinks.Add(new List<int>(4));
            return Nodes.Count - 1;
        }

        int AddLink(WalkLink link)
        {
            link.Cumulative = TrafficPath.BuildCumulative(link.Points);
            link.Length = link.Cumulative.Length > 0 ? link.Cumulative[link.Cumulative.Length - 1] : 0f;
            Links.Add(link);
            int id = Links.Count - 1;
            NodeLinks[link.NodeA].Add(id);
            if (link.NodeB != link.NodeA) NodeLinks[link.NodeB].Add(id);
            return id;
        }

        public int OtherNode(WalkLink link, int node) => link.NodeA == node ? link.NodeB : link.NodeA;

        /// <summary>Picks a random link, weighted towards busier areas, for spawning. Null when the network is empty.</summary>
        public WalkLink PickWeightedLink(out int index)
        {
            index = -1;
            if (Links.Count == 0) return null;
            if (linkCumWeight == null || linkCumWeight.Length != Links.Count) BuildWeights();
            if (totalWeight <= 0f) { index = Random.Range(0, Links.Count); return Links[index]; }
            float r = Random.value * totalWeight;
            int lo = 0, hi = linkCumWeight.Length - 1;
            while (lo < hi)
            {
                int mid = (lo + hi) / 2;
                if (linkCumWeight[mid] < r) lo = mid + 1; else hi = mid;
            }
            index = lo;
            return Links[lo];
        }

        void BuildWeights()
        {
            linkCumWeight = new float[Links.Count];
            float acc = 0f;
            for (int i = 0; i < Links.Count; i++)
            {
                acc += Mathf.Max(0.01f, Links[i].Weight);
                linkCumWeight[i] = acc;
            }
            totalWeight = acc;
        }

        /// <summary>Linear-scan nearest walk node to `pos`. Only used occasionally (after a flee ends), never per pedestrian per frame.</summary>
        public int NearestNode(Vector3 pos)
        {
            int best = -1;
            float bestSqr = float.MaxValue;
            for (int i = 0; i < Nodes.Count; i++)
            {
                float d = (Nodes[i] - pos).sqrMagnitude;
                if (d < bestSqr) { bestSqr = d; best = i; }
            }
            return best;
        }

        // ---------------------------------------------------------------- from the road graph ----

        struct NearEntry
        {
            public int EdgeId;
            public int WalkNodeIndex;
            public float Angle;
        }

        public static void BuildFromRoadGraph(RoadGraph graph)
        {
            var net = new PedestrianNetwork();
            if (graph == null || graph.Nodes.Count == 0) { Current = net; return; }

            var nearByRoadNode = new List<NearEntry>[graph.Nodes.Count];
            for (int i = 0; i < nearByRoadNode.Length; i++) nearByRoadNode[i] = new List<NearEntry>(4);

            for (int edgeId = 0; edgeId < graph.Edges.Count; edgeId++)
                net.BuildEdge(graph, edgeId, nearByRoadNode);

            for (int nodeIndex = 0; nodeIndex < nearByRoadNode.Length; nodeIndex++)
                net.ConnectCorner(graph, nearByRoadNode[nodeIndex], nodeIndex);

            Current = net;
        }

        void BuildEdge(RoadGraph graph, int edgeId, List<NearEntry>[] nearByRoadNode)
        {
            RoadEdge edge = graph.Edges[edgeId];
            Vector2 posA = graph.Nodes[edge.A].Position;
            Vector2 posB = graph.Nodes[edge.B].Position;
            Vector2 delta = posB - posA;
            float span = delta.magnitude;
            if (!(span > 0.05f) || !float.IsFinite(span)) return;
            Vector2 fwd2 = delta / span;
            Vector2 right2 = new Vector2(fwd2.y, -fwd2.x);

            float trimA = TrimAt(graph, edge.A);
            float trimB = TrimAt(graph, edge.B);
            if (trimA + trimB > span - MinEdgeUsable)
            {
                float scale = Mathf.Max(0f, span - MinEdgeUsable) / Mathf.Max(0.0001f, trimA + trimB);
                trimA *= scale;
                trimB *= scale;
            }
            float s0 = trimA;
            float s1 = Mathf.Max(s0 + MinEdgeUsable * 0.25f, span - trimB);

            float half = Mathf.Max(0.3f, edge.SidewalkWidth - 0.5f);
            float baseOffset = Mathf.Clamp(BaseOffsetFromKerb, MinSidewalkOffset, half);
            float minOffset = Mathf.Clamp(1.2f, 0.4f, half);
            float maxOffset = Mathf.Clamp(2.5f, minOffset, half);
            float weight = 1f + 0.6f * (graph.Nodes[edge.A].EdgeIds.Count + graph.Nodes[edge.B].EdgeIds.Count);

            int negNearA = -1, negNearB = -1, posNearA = -1, posNearB = -1;

            for (int side = -1; side <= 1; side += 2)
            {
                Vector2 offset2 = right2 * (side * (edge.HalfWidth + baseOffset));
                Vector3[] points = BakePolyline(posA, fwd2, offset2, s0, s1);
                int nodeNearA = AddNode(points[0]);
                int nodeNearB = AddNode(points[points.Length - 1]);
                var link = new WalkLink
                {
                    NodeA = nodeNearA,
                    NodeB = nodeNearB,
                    Points = points,
                    RightDir = new Vector3(right2.x * side, 0f, right2.y * side),
                    BakedOffset = edge.HalfWidth + baseOffset,
                    MinOffset = edge.HalfWidth + minOffset,
                    MaxOffset = edge.HalfWidth + maxOffset,
                    Weight = weight,
                };
                AddLink(link);

                nearByRoadNode[edge.A].Add(new NearEntry { EdgeId = edgeId, WalkNodeIndex = nodeNearA, Angle = AngleFrom(posA, points[0]) });
                nearByRoadNode[edge.B].Add(new NearEntry { EdgeId = edgeId, WalkNodeIndex = nodeNearB, Angle = AngleFrom(posB, points[points.Length - 1]) });

                if (side < 0) { negNearA = nodeNearA; negNearB = nodeNearB; }
                else { posNearA = nodeNearA; posNearB = nodeNearB; }
            }

            // Only cross at a real junction (3+ edges) or a dead end (1 edge); a simple pass-through
            // (a curve's interior node, 2 edges) just continues straight along the sidewalk.
            if (graph.Nodes[edge.A].EdgeIds.Count != 2) AddCrossing(negNearA, posNearA, edgeId, edge.A, weight);
            if (graph.Nodes[edge.B].EdgeIds.Count != 2) AddCrossing(negNearB, posNearB, edgeId, edge.B, weight);
        }

        void AddCrossing(int nodeNeg, int nodePos, int edgeId, int roadNode, float weight)
        {
            if (nodeNeg < 0 || nodePos < 0 || nodeNeg == nodePos) return;
            var link = new WalkLink
            {
                NodeA = nodeNeg,
                NodeB = nodePos,
                Points = new[] { Nodes[nodeNeg], Nodes[nodePos] },
                IsCrossing = true,
                RoadEdgeId = edgeId,
                RoadNodeId = roadNode,
                Weight = weight * 1.3f,
            };
            AddLink(link);
        }

        /// <summary>Connects the pavement points that arrive at one RoadGraph node into a walkable
        /// perimeter: sorted by the angle they sit at around the node, each consecutive pair from two
        /// different edges gets a free corner link (walking around the block); a pair from the same
        /// edge (its two sides) is left to the dedicated crossing link instead.</summary>
        void ConnectCorner(RoadGraph graph, List<NearEntry> entries, int roadNode)
        {
            int k = entries.Count;
            if (k < 2) return;
            entries.Sort((a, b) => a.Angle.CompareTo(b.Angle));
            float weight = 1f + 0.6f * graph.Nodes[roadNode].EdgeIds.Count;
            for (int i = 0; i < k; i++)
            {
                NearEntry a = entries[i];
                NearEntry b = entries[(i + 1) % k];
                if (a.EdgeId == b.EdgeId || a.WalkNodeIndex == b.WalkNodeIndex) continue;
                var link = new WalkLink
                {
                    NodeA = a.WalkNodeIndex,
                    NodeB = b.WalkNodeIndex,
                    Points = new[] { Nodes[a.WalkNodeIndex], Nodes[b.WalkNodeIndex] },
                    Weight = weight,
                };
                AddLink(link);
            }
        }

        static float TrimAt(RoadGraph graph, int node)
        {
            int degree = graph.Nodes[node].EdgeIds.Count;
            if (degree >= 3) return MaxHalfWidth(graph, node) + CornerMargin;
            if (degree == 1) return DeadEndMargin;
            return 0f;
        }

        static float MaxHalfWidth(RoadGraph graph, int node)
        {
            float w = 0f;
            List<int> edgeIds = graph.Nodes[node].EdgeIds;
            for (int i = 0; i < edgeIds.Count; i++) w = Mathf.Max(w, graph.Edges[edgeIds[i]].HalfWidth);
            return w;
        }

        static float AngleFrom(Vector2 nodePos2D, Vector3 point)
        {
            float dx = point.x - nodePos2D.x;
            float dz = point.z - nodePos2D.y;
            return Mathf.Atan2(dz, dx);
        }

        Vector3[] BakePolyline(Vector2 posA, Vector2 fwd2, Vector2 offset2, float s0, float s1)
        {
            float len = Mathf.Max(0f, s1 - s0);
            int samples = Mathf.Clamp(Mathf.RoundToInt(len / SampleSpacing), 1, 40) + 1;
            var pts = new Vector3[samples];
            for (int i = 0; i < samples; i++)
            {
                float t = samples > 1 ? i / (float)(samples - 1) : 0f;
                float s = s0 + len * t;
                Vector2 xz = posA + fwd2 * s + offset2;
                pts[i] = new Vector3(xz.x, GroundHeight(xz.x, xz.y), xz.y);
            }
            return pts;
        }

        static float GroundHeight(float x, float z)
        {
            var origin = new Vector3(x, 250f, z);
            if (Physics.Raycast(origin, Vector3.down, out RaycastHit hit, 500f, ~0, QueryTriggerInteraction.Ignore) && float.IsFinite(hit.point.y))
                return hit.point.y;
            return RoadWidths.KerbHeight;
        }

        // -------------------------------------------------------------- the old single street ----

        /// <summary>Two long pavements up and down the single-street scene (Layout.KerbZ / StreetHalfLength), with a
        /// few crossing points along the way so people cross both ways, not just at Layout.CrossingX.</summary>
        public static void BuildFallbackStreet()
        {
            var net = new PedestrianNetwork();
            const float margin = 3f;
            float x0 = -Layout.StreetHalfLength + margin;
            float x1 = Layout.StreetHalfLength - margin;
            if (x1 <= x0) { Current = net; return; }

            const int crossingCount = 3;
            var stationX = new float[crossingCount + 2];
            stationX[0] = x0;
            for (int c = 0; c < crossingCount; c++) stationX[c + 1] = Mathf.Lerp(x0, x1, (c + 1f) / (crossingCount + 1f));
            stationX[stationX.Length - 1] = x1;

            const float baseOffset = BaseOffsetFromKerb;
            float northZ = Layout.KerbZ + baseOffset;
            float southZ = -(Layout.KerbZ + baseOffset);

            var northNodes = new int[stationX.Length];
            var southNodes = new int[stationX.Length];
            for (int i = 0; i < stationX.Length; i++)
            {
                float x = stationX[i];
                northNodes[i] = net.AddNode(new Vector3(x, Street.Height(x, northZ), northZ));
                southNodes[i] = net.AddNode(new Vector3(x, Street.Height(x, southZ), southZ));
            }

            for (int i = 0; i < stationX.Length - 1; i++)
            {
                net.AddLink(StraightLink(northNodes[i], northNodes[i + 1], stationX[i], stationX[i + 1], northZ, Vector3.forward));
                net.AddLink(StraightLink(southNodes[i], southNodes[i + 1], stationX[i], stationX[i + 1], southZ, Vector3.back));
            }
            // Only the interior stations are crossings; the two ends are just where the modelled street stops.
            for (int i = 1; i < stationX.Length - 1; i++)
            {
                net.AddLink(new WalkLink
                {
                    NodeA = northNodes[i],
                    NodeB = southNodes[i],
                    Points = new[] { net.Nodes[northNodes[i]], net.Nodes[southNodes[i]] },
                    IsCrossing = true,
                    RoadEdgeId = -1,
                    RoadNodeId = -1,
                    Weight = 1.3f,
                });
            }
            Current = net;
        }

        static WalkLink StraightLink(int nodeA, int nodeB, float xA, float xB, float z, Vector3 rightDir)
        {
            int samples = Mathf.Clamp(Mathf.RoundToInt(Mathf.Abs(xB - xA) / SampleSpacing), 1, 40) + 1;
            var pts = new Vector3[samples];
            for (int i = 0; i < samples; i++)
            {
                float t = samples > 1 ? i / (float)(samples - 1) : 0f;
                float x = Mathf.Lerp(xA, xB, t);
                pts[i] = new Vector3(x, Street.Height(x, z), z);
            }
            return new WalkLink
            {
                NodeA = nodeA,
                NodeB = nodeB,
                Points = pts,
                RightDir = rightDir,
                BakedOffset = Mathf.Abs(z),
                MinOffset = Layout.KerbZ + 1.2f,
                MaxOffset = Layout.KerbZ + 2.5f,
                Weight = 1f,
            };
        }
    }
}
