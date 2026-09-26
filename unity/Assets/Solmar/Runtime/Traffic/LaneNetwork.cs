using System.Collections.Generic;
using Solmar.City.Roads;
using UnityEngine;

namespace Solmar.Traffic
{
    /// <summary>
    /// Builds a driveable lane graph from <see cref="RoadGraph"/>: two carriageways per edge (right-hand
    /// traffic), trimmed back to a stop line at real junctions (3+ edges) and passed straight through at
    /// simple 2-edge nodes (a curve's interior points, since curves are chains of short straight edges),
    /// with Bezier turn paths connecting every lane that arrives at a node to the lanes that can legally
    /// follow it (right turns from the outer lane, left turns from the inner lane, straight from any,
    /// U-turns only at dead ends). Reads only the fields the map generator promises to keep stable
    /// (positions, edge endpoints, lane/parking/median widths) and never <see cref="RoadOrientation"/>,
    /// so it works whether roads are grid-aligned or run at any angle.
    /// </summary>
    public sealed class LaneNetwork
    {
        /// <summary>The lane network for the map currently loaded. Null until built.</summary>
        public static LaneNetwork Current;

        public readonly List<TrafficLane> Lanes = new List<TrafficLane>();

        /// <summary>Node index -> lanes that start there (used to link turns and to pick a spawn lane).</summary>
        readonly Dictionary<int, List<TrafficLane>> outgoingByNode = new Dictionary<int, List<TrafficLane>>();

        const float StopLineMargin = 2f;
        const float DeadEndMargin = 3.5f;
        const float MinLaneLength = 1f;
        const int TurnSamples = 8;

        public static void Build(RoadGraph graph)
        {
            var net = new LaneNetwork();
            net.BuildLanes(graph);
            net.BuildTurns(graph);
            Current = net;
        }

        void BuildLanes(RoadGraph graph)
        {
            for (int edgeId = 0; edgeId < graph.Edges.Count; edgeId++)
            {
                RoadEdge edge = graph.Edges[edgeId];
                BuildDirection(graph, edge, edgeId, +1);
                BuildDirection(graph, edge, edgeId, -1);
            }
        }

        void BuildDirection(RoadGraph graph, RoadEdge edge, int edgeId, int dir)
        {
            int fromNode = dir > 0 ? edge.A : edge.B;
            int toNode = dir > 0 ? edge.B : edge.A;
            Vector2 posFrom = graph.Nodes[fromNode].Position;
            Vector2 posTo = graph.Nodes[toNode].Position;
            Vector2 delta = posTo - posFrom;
            float span = delta.magnitude;
            if (!(span > 0.01f)) return;
            Vector2 fwd2 = delta / span;
            Vector2 right2 = new Vector2(fwd2.y, -fwd2.x);

            float trimFrom = TrimAt(graph, fromNode, span);
            float trimTo = TrimAt(graph, toNode, span);
            if (trimFrom + trimTo > span - MinLaneLength)
            {
                float scale = Mathf.Max(0f, span - MinLaneLength) / Mathf.Max(0.0001f, trimFrom + trimTo);
                trimFrom *= scale;
                trimTo *= scale;
            }
            float s0 = trimFrom;
            float s1 = Mathf.Max(s0 + MinLaneLength * 0.25f, span - trimTo);

            bool toIsJunction = graph.Nodes[toNode].EdgeIds.Count >= 3;
            float speedLimit = Mathf.Lerp(40f, 60f, Mathf.Clamp01((edge.LanesPerDirection - 1) / 2f)) / 3.6f;

            for (int laneIndex = 0; laneIndex < edge.LanesPerDirection; laneIndex++)
            {
                float offset = edge.MedianWidth * 0.5f + (laneIndex + 0.5f) * RoadWidths.LaneWidth;
                Vector2 p0 = posFrom + fwd2 * s0 + right2 * offset;
                Vector2 p1 = posFrom + fwd2 * s1 + right2 * offset;

                var lane = new TrafficLane
                {
                    Id = Lanes.Count,
                    EdgeId = edgeId,
                    Dir = dir,
                    LaneIndex = laneIndex,
                    LaneCount = edge.LanesPerDirection,
                    FromNode = fromNode,
                    ToNode = toNode,
                    ToNodeIsJunction = toIsJunction,
                    SpeedLimit = speedLimit,
                    Direction2D = fwd2,
                    Points = new[] { To3D(p0), To3D(p1) },
                };
                lane.Cumulative = TrafficPath.BuildCumulative(lane.Points);
                lane.Length = lane.Cumulative[lane.Cumulative.Length - 1];

                Lanes.Add(lane);
                if (!outgoingByNode.TryGetValue(fromNode, out List<TrafficLane> list))
                {
                    list = new List<TrafficLane>(4);
                    outgoingByNode[fromNode] = list;
                }
                list.Add(lane);
            }
        }

        /// <summary>How far a lane trims back from `node`: a stop line at a real junction, a short
        /// buffer at a dead end, or nothing at a simple pass-through (a curve's interior node).</summary>
        static float TrimAt(RoadGraph graph, int node, float edgeSpan)
        {
            int degree = graph.Nodes[node].EdgeIds.Count;
            if (degree >= 3) return MaxHalfWidth(graph, node) + StopLineMargin;
            if (degree == 1) return Mathf.Min(DeadEndMargin, edgeSpan * 0.4f);
            return 0f;
        }

        static float MaxHalfWidth(RoadGraph graph, int node)
        {
            float w = 0f;
            List<int> edgeIds = graph.Nodes[node].EdgeIds;
            for (int i = 0; i < edgeIds.Count; i++) w = Mathf.Max(w, graph.Edges[edgeIds[i]].HalfWidth);
            return w;
        }

        static Vector3 To3D(Vector2 xz)
        {
            float y = GroundHeight(xz.x, xz.y);
            return new Vector3(xz.x, y, xz.y);
        }

        static float GroundHeight(float x, float z)
        {
            var origin = new Vector3(x, 200f, z);
            if (Physics.Raycast(origin, Vector3.down, out RaycastHit hit, 400f, ~0, QueryTriggerInteraction.Ignore)) return hit.point.y;
            return 0f;
        }

        void BuildTurns(RoadGraph graph)
        {
            for (int i = 0; i < Lanes.Count; i++)
            {
                TrafficLane lane = Lanes[i];
                if (!outgoingByNode.TryGetValue(lane.ToNode, out List<TrafficLane> candidates)) continue;
                int degree = graph.Nodes[lane.ToNode].EdgeIds.Count;

                for (int c = 0; c < candidates.Count; c++)
                {
                    TrafficLane cand = candidates[c];
                    bool sameEdge = cand.EdgeId == lane.EdgeId;
                    if (degree == 1)
                    {
                        // Dead end: the only legal move is a U-turn back down the same edge, lane for lane.
                        if (sameEdge && cand.LaneIndex == lane.LaneIndex) AddTurn(lane, cand, TurnKind.UTurn);
                        continue;
                    }
                    if (sameEdge) continue; // never turn straight back onto the road you came from mid-block.

                    float dot = Vector2.Dot(lane.Direction2D, cand.Direction2D);
                    float cross = lane.Direction2D.x * cand.Direction2D.y - lane.Direction2D.y * cand.Direction2D.x;
                    TurnKind kind = dot > 0.85f ? TurnKind.Straight : (cross > 0.15f ? TurnKind.Left : (cross < -0.15f ? TurnKind.Right : TurnKind.Straight));

                    if (degree == 2)
                    {
                        // Pass-through (a curve's interior node): keep the same lane, no choice to make.
                        if (cand.LaneIndex == lane.LaneIndex) AddTurn(lane, cand, kind);
                        continue;
                    }

                    bool ok = kind switch
                    {
                        TurnKind.Right => lane.LaneIndex == lane.LaneCount - 1 && cand.LaneIndex == cand.LaneCount - 1,
                        TurnKind.Left => lane.LaneIndex == 0 && cand.LaneIndex == 0,
                        _ => cand.LaneIndex == Mathf.Min(lane.LaneIndex, cand.LaneCount - 1),
                    };
                    if (ok) AddTurn(lane, cand, kind);
                }
            }
        }

        void AddTurn(TrafficLane from, TrafficLane to, TurnKind kind)
        {
            Vector3 p0 = from.Points[from.Points.Length - 1];
            Vector3 p3 = to.Points[0];
            Vector3 inDir = new Vector3(from.Direction2D.x, 0f, from.Direction2D.y);
            Vector3 outDir = new Vector3(to.Direction2D.x, 0f, to.Direction2D.y);
            float handle = Mathf.Clamp(Vector3.Distance(p0, p3) * 0.4f, 2f, 15f);
            Vector3 p1 = p0 + inDir * handle;
            Vector3 p2 = p3 - outDir * handle;

            var points = new Vector3[TurnSamples + 1];
            for (int s = 0; s <= TurnSamples; s++)
            {
                float t = s / (float)TurnSamples;
                points[s] = CubicBezier(p0, p1, p2, p3, t);
            }

            var turn = new TrafficTurn
            {
                From = from,
                To = to,
                Kind = kind,
                Points = points,
            };
            turn.Cumulative = TrafficPath.BuildCumulative(points);
            turn.Length = turn.Cumulative[turn.Cumulative.Length - 1];
            from.Turns.Add(turn);
        }

        static Vector3 CubicBezier(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3, float t)
        {
            float u = 1f - t;
            return u * u * u * p0 + 3f * u * u * t * p1 + 3f * u * t * t * p2 + t * t * t * p3;
        }
    }

    /// <summary>
    /// Tracks which lane each car currently mid-turn at a junction came from, so a car about to enter
    /// the junction from a different approach waits ("yield to cars already turning") while cars
    /// following the same approach queue through normally (handled by ordinary car-following).
    /// </summary>
    public static class JunctionOccupancy
    {
        static readonly Dictionary<int, List<int>> turningFromLane = new Dictionary<int, List<int>>();

        public static bool CanEnter(int node, int fromLaneId)
        {
            if (!turningFromLane.TryGetValue(node, out List<int> list) || list.Count == 0) return true;
            for (int i = 0; i < list.Count; i++) if (list[i] == fromLaneId) return true;
            return false;
        }

        public static void Enter(int node, int fromLaneId)
        {
            if (!turningFromLane.TryGetValue(node, out List<int> list))
            {
                list = new List<int>(2);
                turningFromLane[node] = list;
            }
            list.Add(fromLaneId);
        }

        public static void Exit(int node, int fromLaneId)
        {
            if (turningFromLane.TryGetValue(node, out List<int> list)) list.Remove(fromLaneId);
        }

        public static void Clear() => turningFromLane.Clear();
    }
}
