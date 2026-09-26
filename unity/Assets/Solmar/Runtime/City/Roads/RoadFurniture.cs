using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Street lamps along every block's pavement, staggered on both sides, and signal poles with
    /// vehicle and pedestrian heads at every four-way intersection, built from FurnitureParts (the
    /// same models the single street uses).
    /// </summary>
    public static class RoadFurniture
    {
        public static GameObject Build(Transform parent, RoadGraph graph, CityMaterials m)
        {
            var root = new GameObject("Road furniture").transform;
            root.SetParent(parent, false);
            BuildLamps(root, graph, m);
            BuildSignals(root, graph, m);
            return root.gameObject;
        }

        struct Placement
        {
            public Vector3 pos;
            public float yaw;
        }

        static GameObject Place(Transform parent, string name, Mesh mesh, Material[] mats, IList<Placement> at)
        {
            if (at.Count == 0) return null;
            var group = new GameObject(name);
            group.transform.SetParent(parent, false);
            for (int i = 0; i < at.Count; i++)
            {
                var go = new GameObject(name + " " + (i + 1));
                go.transform.SetParent(group.transform, false);
                go.transform.SetPositionAndRotation(at[i].pos, Quaternion.Euler(0f, at[i].yaw * Mathf.Rad2Deg, 0f));
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                var r = go.AddComponent<MeshRenderer>();
                r.sharedMaterials = mats;
                r.shadowCastingMode = ShadowCastingMode.On;
                go.isStatic = true;
            }
            return group;
        }

        static Material[] MatsFor(Assembly a, Dictionary<string, Material> byName)
        {
            var mats = new Material[a.Slots.Count];
            for (int i = 0; i < mats.Length; i++) mats[i] = byName[a.Slots[i]];
            return mats;
        }

        static void BuildLamps(Transform parent, RoadGraph graph, CityMaterials m)
        {
            Assembly lampAsm = FurnitureParts.StreetLamp();
            Mesh mesh = lampAsm.Build("Street lamp");
            mesh.hideFlags = HideFlags.DontSave;
            Material[] mats = MatsFor(lampAsm, new Dictionary<string, Material>
            {
                { "steel", m.Galvanised },
                { "housing", m.Painted(new Color(0.55f, 0.57f, 0.57f), 0.35f) },
                { "lens", m.Painted(new Color(0.3f, 0.3f, 0.28f), 0.1f) },
            });

            var at = new List<Placement>();
            foreach (RoadEdge edge in graph.Edges)
            {
                graph.Span(edge, out float s0, out float s1, out float centre);
                graph.Ends(edge, out int nodeMin, out int nodeMax);
                float a = s0 + graph.TrimAt(edge, nodeMin);
                float b = s1 - graph.TrimAt(edge, nodeMax);
                if (b - a < 8f) continue;
                foreach (float sign in new[] { -1f, 1f })
                {
                    float w = sign * (edge.HalfWidth + 0.7f);
                    float yaw = edge.Orientation == RoadOrientation.Horizontal
                        ? (sign > 0f ? Mathf.PI : 0f)
                        : (sign > 0f ? -Mathf.PI / 2f : Mathf.PI / 2f);
                    float offset = sign > 0f ? 6f : 6f + Layout.LampSpacing * 0.5f;
                    for (float s = a + offset; s < b - 2f; s += Layout.LampSpacing)
                    {
                        Vector2 xz = RoadGraph.WorldAt(edge, centre, s, w);
                        at.Add(new Placement { pos = new Vector3(xz.x, RoadWidths.KerbHeight, xz.y), yaw = yaw });
                    }
                }
            }
            Place(parent, "Street lamps", mesh, mats, at);
        }

        static void BuildSignals(Transform parent, RoadGraph graph, CityMaterials m)
        {
            const float reach = 3f;
            Assembly poleAsm = FurnitureParts.SignalPole(reach);
            Mesh poleMesh = poleAsm.Build("Signal pole");
            poleMesh.hideFlags = HideFlags.DontSave;
            Material[] poleMats = MatsFor(poleAsm, new Dictionary<string, Material> { { "steel", m.Galvanised } });

            Assembly headAsm = FurnitureParts.SignalHead();
            Mesh headMesh = headAsm.Build("Signal head");
            headMesh.hideFlags = HideFlags.DontSave;
            Material[] headMats = MatsFor(headAsm, new Dictionary<string, Material>
            {
                { "housing", m.Painted(new Color(0.79f, 0.63f, 0.11f), 0.4f) },
                { "backplate", m.Painted(new Color(0.105f, 0.11f, 0.115f), 0.45f) },
                { "border", m.Painted(new Color(0.91f, 0.82f, 0.1f), 0.3f) },
                { "red", m.Emissive(new Color(1f, 0.16f, 0.08f), 8000f) },
                { "amber", m.Painted(new Color(0.3f, 0.3f, 0.28f), 0.1f) },
                { "green", m.Painted(new Color(0.3f, 0.3f, 0.28f), 0.1f) },
            });

            var poles = new List<Placement>();
            var heads = new List<Placement>();
            for (int i = 0; i < graph.Nodes.Count; i++)
            {
                if (graph.Nodes[i].EdgeIds.Count < 4) continue; // a true four-way crossing only
                float ex = graph.HalfExtentX(i) + 0.6f;
                float ez = graph.HalfExtentZ(i) + 0.6f;
                Vector2 c = graph.Nodes[i].Position;
                float headY = RoadWidths.GutterHeight + 5.2f;
                foreach (Vector2 corner in new[] { new Vector2(1, 1), new Vector2(-1, 1), new Vector2(1, -1), new Vector2(-1, -1) })
                {
                    Vector3 pos = new Vector3(c.x + corner.x * ex, RoadWidths.KerbHeight, c.y + corner.y * ez);
                    // Face the pole's arm and head back towards the intersection centre.
                    float yaw = Mathf.Atan2(-corner.x, -corner.y);
                    poles.Add(new Placement { pos = pos, yaw = yaw });
                    heads.Add(new Placement { pos = new Vector3(pos.x, headY, pos.z), yaw = yaw });
                }
            }
            Place(parent, "Signal poles", poleMesh, poleMats, poles);
            Place(parent, "Signal heads", headMesh, headMats, heads);
        }
    }
}
