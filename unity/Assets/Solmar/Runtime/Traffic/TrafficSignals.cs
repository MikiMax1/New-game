using System.Collections.Generic;
using Solmar.City.Roads;
using UnityEngine;

namespace Solmar.Traffic
{
    public enum SignalState
    {
        /// <summary>No controller at this node (a 2-way stop or a pass-through): always free to go.</summary>
        Uncontrolled,
        Green,
        Amber,
        Red,
    }

    /// <summary>
    /// A signal controller per junction with 3+ edges: its approaches are grouped into two phases by
    /// rough direction (opposite/parallel approaches share a phase, the way a normal 4-way's north-south
    /// and east-west share theirs), cycling green (20s) -> amber (3s) -> all-red (2s) -> the other
    /// phase's green -> amber -> all-red. <see cref="StateFor"/> exposes the state for a signal head or
    /// a car's stop-line check.
    /// </summary>
    public sealed class TrafficSignals
    {
        public static TrafficSignals Current;

        const float GreenTime = 20f;
        const float AmberTime = 3f;
        const float AllRedTime = 2f;

        sealed class NodeSignal
        {
            public readonly List<int> GroupA = new List<int>(2);
            public readonly List<int> GroupB = new List<int>(2);
            public float Timer;
            public int Phase;
        }

        readonly Dictionary<int, NodeSignal> nodes = new Dictionary<int, NodeSignal>();

        public static void Build(RoadGraph graph)
        {
            var signals = new TrafficSignals();
            for (int i = 0; i < graph.Nodes.Count; i++)
            {
                List<int> edgeIds = graph.Nodes[i].EdgeIds;
                if (edgeIds.Count < 3) continue;
                signals.nodes[i] = signals.BuildNode(graph, i, edgeIds);
            }
            Current = signals;
        }

        NodeSignal BuildNode(RoadGraph graph, int node, List<int> edgeIds)
        {
            var ns = new NodeSignal();
            bool haveBase = false;
            float baseAngleDeg = 0f;
            for (int i = 0; i < edgeIds.Count; i++)
            {
                int edgeId = edgeIds[i];
                RoadEdge e = graph.Edges[edgeId];
                Vector2 pa = graph.Nodes[e.A].Position;
                Vector2 pb = graph.Nodes[e.B].Position;
                Vector2 outward = e.A == node ? pb - pa : pa - pb;
                if (outward.sqrMagnitude < 1e-6f) { ns.GroupA.Add(edgeId); continue; }
                // Fold to [0,180) so an approach and its opposite (parallel) partner land together.
                float angle = Mathf.Repeat(Mathf.Atan2(outward.y, outward.x) * Mathf.Rad2Deg, 180f);
                if (!haveBase) { baseAngleDeg = angle; haveBase = true; }
                float diff = Mathf.Abs(Mathf.DeltaAngle(angle, baseAngleDeg));
                if (diff < 45f) ns.GroupA.Add(edgeId); else ns.GroupB.Add(edgeId);
            }
            // A 3-way with two edges reading as parallel (e.g. a slight bend) would otherwise leave
            // group B empty; move one edge across so both phases still serve someone.
            if (ns.GroupB.Count == 0 && ns.GroupA.Count > 1)
            {
                ns.GroupB.Add(ns.GroupA[ns.GroupA.Count - 1]);
                ns.GroupA.RemoveAt(ns.GroupA.Count - 1);
            }
            return ns;
        }

        /// <summary>Advances every controller's phase timer. Call once a frame.</summary>
        public void Tick(float dt)
        {
            if (!float.IsFinite(dt) || dt <= 0f) return;
            foreach (KeyValuePair<int, NodeSignal> kv in nodes)
            {
                NodeSignal ns = kv.Value;
                ns.Timer += dt;
                float duration = PhaseDuration(ns.Phase);
                if (ns.Timer >= duration)
                {
                    ns.Timer -= duration;
                    ns.Phase = (ns.Phase + 1) % 6;
                }
            }
        }

        static float PhaseDuration(int phase) => phase switch
        {
            0 => GreenTime,
            1 => AmberTime,
            2 => AllRedTime,
            3 => GreenTime,
            4 => AmberTime,
            _ => AllRedTime,
        };

        /// <summary>The signal state facing traffic arriving at `node` along `edgeId`, for either
        /// direction of that edge. <see cref="SignalState.Uncontrolled"/> when the node has no controller.</summary>
        public static SignalState StateFor(int node, int edgeId)
        {
            if (Current == null || !Current.nodes.TryGetValue(node, out NodeSignal ns)) return SignalState.Uncontrolled;
            bool inA = ns.GroupA.Contains(edgeId);
            bool inB = !inA && ns.GroupB.Contains(edgeId);
            if (!inA && !inB) return SignalState.Uncontrolled;
            return ns.Phase switch
            {
                0 => inA ? SignalState.Green : SignalState.Red,
                1 => inA ? SignalState.Amber : SignalState.Red,
                3 => inB ? SignalState.Green : SignalState.Red,
                4 => inB ? SignalState.Amber : SignalState.Red,
                _ => SignalState.Red,
            };
        }
    }
}
