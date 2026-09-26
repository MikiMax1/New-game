using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Street lamps along every pavement, staggered on the two sides and facing the road whatever
    /// its angle, and at every junction of four or more streets a signal pole on the kerb corner to
    /// the right of each approach, its arm reaching over the arriving lanes and its head facing the
    /// traffic.
    ///
    /// Lamps, poles and the bodies of the signal heads are copied into their tile's combined prop
    /// meshes (thousands of separate objects would cost a draw call each), with a capsule collider
    /// each; only the lenses of each head are an object of their own, so the lights can change.
    /// </summary>
    public static class RoadFurniture
    {
        /// <summary>A signal head: which junction and which approach (edge) it controls, and its lenses.</summary>
        public sealed class Signal
        {
            public int Node;
            public int Edge;
            public Transform Head;
            /// <summary>The lenses: submeshes <see cref="RedSlot"/>, <see cref="AmberSlot"/> and <see cref="GreenSlot"/>.</summary>
            public MeshRenderer Renderer;
        }

        /// <summary>
        /// Every signal head in the city, for the traffic lights to drive: swap the materials of the
        /// renderer's red, amber and green slots (<see cref="LitRed"/> and the rest) to show a phase.
        /// <see cref="SignalLamps"/> does this from the traffic controllers.
        /// </summary>
        public static readonly List<Signal> Signals = new List<Signal>();

        /// <summary>Materials for the signal lenses, lit and unlit, made when the city is built.</summary>
        public static Material LitRed, LitAmber, LitGreen, Unlit;

        /// <summary>Which of a head renderer's material slots are the red, amber and green lenses.</summary>
        public static int RedSlot, AmberSlot = 1, GreenSlot = 2;

        public static void Build(RoadGraph graph, CityTiles tiles, CityMaterials m)
        {
            Signals.Clear();
            BuildLamps(graph, tiles, m);
            BuildSignals(graph, tiles, m);
        }

        static void Capsule(CityTiles tiles, Vector2 at, string name, Vector3 position, float height, float radius)
        {
            var go = new GameObject(name);
            go.transform.SetParent(tiles.Props(at), false);
            go.transform.position = position;
            var capsule = go.AddComponent<CapsuleCollider>();
            capsule.center = new Vector3(0f, height * 0.5f, 0f);
            capsule.height = height;
            capsule.radius = radius;
        }

        static void BuildLamps(RoadGraph g, CityTiles tiles, CityMaterials m)
        {
            CityProps lamp = CityProps.StreetLamp();
            var byslot = new Dictionary<string, Material>
            {
                { "steel", m.Galvanised },
                { "housing", m.Painted(new Color(0.55f, 0.57f, 0.57f), 0.35f) },
                { "lens", m.Painted(new Color(0.3f, 0.3f, 0.28f), 0.1f) },
            };

            foreach (RoadEdge edge in g.Edges)
            {
                float len = g.Length(edge);
                float clear = RoadWidths.CrosswalkDepth + 3f;
                float a = edge.TrimA + (g.IsJunction(edge.A) ? clear : 2f);
                float b = len - edge.TrimB - (g.IsJunction(edge.B) ? clear : 2f);
                if (b - a < 4f) continue;
                float spacing = edge.Class == RoadClass.Residential ? 44f : 32f;
                Vector2 d = g.Direction(edge);
                Vector2 left = RoadGraph.Left(d);
                foreach (float side in new[] { -1f, 1f })
                {
                    float w = side * (edge.HalfWidth + 0.6f);
                    // Arms reach over the road.
                    var facing = new Vector3(-left.x * side, 0f, -left.y * side);
                    Quaternion rot = Quaternion.LookRotation(facing, Vector3.up);
                    float offset = side > 0f ? spacing * 0.5f : 0f;
                    for (float s = a + offset; s <= b; s += spacing)
                    {
                        Vector2 xz = g.PointFrom(edge, edge.A, s, w);
                        var p = new Vector3(xz.x, RoadWidths.KerbHeight, xz.y);
                        lamp.AppendTo(slot => tiles.Surface(xz, "Street lamps", byslot[slot], CityTiles.Layer.Prop), Matrix4x4.TRS(p, rot, Vector3.one));
                        Capsule(tiles, xz, "Street lamp", p, 8.6f, 0.14f);
                    }
                }
            }
        }

        static void BuildSignals(RoadGraph g, CityTiles tiles, CityMaterials m)
        {
            CityProps body = CityProps.SignalHead();
            CityProps lensModel = CityProps.SignalLenses();
            Mesh lensMesh = lensModel.Build("Signal lenses");
            lensMesh.hideFlags = HideFlags.DontSave;
            for (int i = 0; i < lensModel.Slots.Count; i++)
            {
                if (lensModel.Slots[i] == "red") RedSlot = i;
                else if (lensModel.Slots[i] == "amber") AmberSlot = i;
                else if (lensModel.Slots[i] == "green") GreenSlot = i;
            }
            LitRed = m.Emissive(new Color(1f, 0.16f, 0.08f), 8000f);
            LitAmber = m.Emissive(new Color(1f, 0.6f, 0.05f), 8000f);
            LitGreen = m.Emissive(new Color(0.1f, 1f, 0.55f), 8000f);
            Unlit = m.Painted(new Color(0.3f, 0.3f, 0.28f), 0.1f);
            var lensMats = new Material[lensModel.Slots.Count];
            for (int i = 0; i < lensMats.Length; i++) lensMats[i] = i == RedSlot ? LitRed : Unlit;
            var bodySlots = new Dictionary<string, Material>
            {
                { "housing", m.Painted(new Color(0.79f, 0.63f, 0.11f), 0.4f) },
                { "backplate", m.Painted(new Color(0.105f, 0.11f, 0.115f), 0.45f) },
                { "border", m.Painted(new Color(0.91f, 0.82f, 0.1f), 0.3f) },
            };
            Material steel = m.Galvanised;
            var poles = new Dictionary<int, CityProps>();

            for (int n = 0; n < g.Nodes.Count; n++)
            {
                if (!g.HasSignals(n)) continue;
                RoadNode node = g.Nodes[n];
                int deg = node.Sorted.Count;
                for (int k = 0; k < deg; k++)
                {
                    // Traffic arriving along this edge keeps right, so its kerb is the edge's left
                    // kerb seen from the node; the pole stands on corner k, which starts there.
                    RoadEdge e = g.Edges[node.Sorted[k]];
                    List<Vector2> corner = node.Corners[k];
                    if (corner.Count == 0) continue;
                    Vector2 d = g.DirectionFrom(e, n);
                    Vector2 left = RoadGraph.Left(d);
                    Vector2 pos = corner[0] + left * 0.9f + d * 0.5f;
                    float reach = Mathf.Clamp(e.HalfWidth - (e.MedianWidth * 0.5f + e.LanesPerDirection * RoadWidths.LaneWidth * 0.5f) + 0.9f, 2.5f, 8f);
                    int key = Mathf.RoundToInt(reach * 2f);
                    if (!poles.TryGetValue(key, out CityProps pole))
                    {
                        pole = CityProps.SignalPole(key * 0.5f);
                        poles.Add(key, pole);
                    }
                    // The arm reaches from the kerb over the arriving lanes (towards -left).
                    var arm = new Vector3(-left.x, 0f, -left.y);
                    Quaternion rot = Quaternion.LookRotation(arm, Vector3.up);
                    var p3 = new Vector3(pos.x, RoadWidths.KerbHeight, pos.y);
                    pole.AppendTo(_ => tiles.Surface(pos, "Signal poles", steel, CityTiles.Layer.Prop), Matrix4x4.TRS(p3, rot, Vector3.one));
                    Capsule(tiles, pos, "Signal pole", p3, 7f, 0.2f);

                    // The head hangs under the arm's end, lenses facing the arriving traffic (along +d).
                    Vector3 headPos = p3 + arm * (key * 0.5f - 0.3f) + new Vector3(0f, 5.65f, 0f);
                    Quaternion headRot = Quaternion.LookRotation(new Vector3(d.x, 0f, d.y), Vector3.up) * Quaternion.Euler(0f, -90f, 0f);
                    body.AppendTo(slot => tiles.Surface(pos, "Signal heads", bodySlots[slot], CityTiles.Layer.Prop), Matrix4x4.TRS(headPos, headRot, Vector3.one));

                    var go = new GameObject("Signal lenses");
                    go.transform.SetParent(tiles.Props(pos), false);
                    go.transform.SetPositionAndRotation(headPos, headRot);
                    go.AddComponent<MeshFilter>().sharedMesh = lensMesh;
                    var r = go.AddComponent<MeshRenderer>();
                    r.sharedMaterials = lensMats;
                    r.shadowCastingMode = ShadowCastingMode.Off;
                    Signals.Add(new Signal { Node = n, Edge = node.Sorted[k], Head = go.transform, Renderer = r });
                }
            }
        }
    }
}
