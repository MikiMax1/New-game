using System.Collections.Generic;
using UnityEngine;

namespace Solmar.Traffic
{
    /// <summary>How a <see cref="TrafficTurn"/> bends relative to the lane it leaves from.</summary>
    public enum TurnKind
    {
        Straight,
        Left,
        Right,
        UTurn,
    }

    /// <summary>
    /// One lane, one direction of travel, trimmed back from the junctions at both ends (see
    /// <see cref="LaneNetwork"/>). <see cref="Points"/> is a driveable polyline in world space
    /// (road-surface height already resolved by a downward raycast at build time).
    /// </summary>
    public sealed class TrafficLane
    {
        public int Id;
        public int EdgeId;
        /// <summary>+1: travels RoadEdge.A -> RoadEdge.B. -1: B -> A.</summary>
        public int Dir;
        /// <summary>0 = innermost lane (nearest the centreline/median).</summary>
        public int LaneIndex;
        public int LaneCount;
        public int FromNode;
        public int ToNode;
        /// <summary>Whether <see cref="ToNode"/> is a real junction (3+ edges) with a stop line and, maybe, signals.</summary>
        public bool ToNodeIsJunction;
        /// <summary>Desired free-flow speed, m/s.</summary>
        public float SpeedLimit;

        public Vector3[] Points;
        public float[] Cumulative;
        public float Length;

        /// <summary>Unit direction (world x,z) the lane runs in, used to classify turns at its end.</summary>
        public Vector2 Direction2D;

        /// <summary>Outgoing options once a car reaches the end of this lane (built by <see cref="LaneNetwork"/>).</summary>
        public readonly List<TrafficTurn> Turns = new List<TrafficTurn>(4);
    }

    /// <summary>A Bezier-sampled path through a junction from one lane's stop line into another lane's start.</summary>
    public sealed class TrafficTurn
    {
        public TrafficLane From;
        public TrafficLane To;
        public TurnKind Kind;
        public Vector3[] Points;
        public float[] Cumulative;
        public float Length;
    }

    /// <summary>
    /// Shared, allocation-free helpers for walking a polyline by arc length: used by both
    /// <see cref="TrafficLane"/> and <see cref="TrafficTurn"/> paths while driving.
    /// </summary>
    public static class TrafficPath
    {
        public static float[] BuildCumulative(Vector3[] points)
        {
            var cum = new float[points.Length];
            cum[0] = 0f;
            for (int i = 1; i < points.Length; i++)
            {
                float d = Vector3.Distance(points[i - 1], points[i]);
                if (!float.IsFinite(d)) d = 0f;
                cum[i] = cum[i - 1] + d;
            }
            return cum;
        }

        /// <summary>
        /// Position and forward direction at arc-length <paramref name="distance"/> along the path.
        /// <paramref name="cursor"/> is caller-owned state that only ever moves forward, so repeated
        /// calls with increasing distance along the same path never allocate and never rescan from 0.
        /// </summary>
        public static void Sample(Vector3[] points, float[] cum, ref int cursor, float distance, out Vector3 position, out Vector3 forward)
        {
            int last = points.Length - 1;
            if (last <= 0)
            {
                position = points.Length > 0 ? points[0] : Vector3.zero;
                forward = Vector3.forward;
                return;
            }
            if (cursor < 0) cursor = 0;
            if (cursor > last - 1) cursor = last - 1;
            while (cursor < last - 1 && distance > cum[cursor + 1]) cursor++;
            while (cursor > 0 && distance < cum[cursor]) cursor--;

            float segLen = cum[cursor + 1] - cum[cursor];
            float t = segLen > 0.0001f ? Mathf.Clamp01((distance - cum[cursor]) / segLen) : 0f;
            Vector3 a = points[cursor];
            Vector3 b = points[cursor + 1];
            position = Vector3.Lerp(a, b, t);
            Vector3 dir = b - a;
            forward = dir.sqrMagnitude > 1e-6f ? dir.normalized : Vector3.forward;
        }
    }
}
