using Solmar.Rendering;
using UnityEngine;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Lane markings and crosswalks, as HDRP decals projected onto the road: a double yellow centre
    /// line where a street has no median, a dashed lane line between multi-lane carriageways,
    /// solid parking-lane edge lines, a continental crosswalk at each end of every street and a
    /// stop line just behind it, for each direction of travel.
    /// </summary>
    public static class RoadMarkings
    {
        const float CrosswalkDepth = 3.6f;
        const float BarWidth = 0.6f;
        const float BarGap = 0.6f;

        public static GameObject Build(Transform parent, RoadGraph graph, CityMaterials m)
        {
            var root = new GameObject("Road markings").transform;
            root.SetParent(parent, false);

            foreach (RoadEdge edge in graph.Edges) BuildEdge(root, graph, edge, m);
            return root.gameObject;
        }

        /// <summary>A decal centred at `centreWorld`, `along` long (the edge's length axis) and `across` wide, projected straight down.</summary>
        static void Decal(Transform root, string name, Material material, RoadEdge edge, Vector2 centreWorld, float along, float across, float uvAlong)
        {
            var go = new GameObject(name);
            go.transform.SetParent(root, false);
            float yaw = edge.Orientation == RoadOrientation.Horizontal ? 0f : 90f;
            go.transform.SetPositionAndRotation(new Vector3(centreWorld.x, RoadWidths.KerbHeight, centreWorld.y), Quaternion.Euler(90f, yaw, 0f));
            var d = go.AddComponent<DecalProjector>();
            d.material = material;
            d.size = new Vector3(along, across, 0.4f);
            d.pivot = Vector3.zero;
            d.uvScale = new Vector2(uvAlong, 1f);
            d.drawDistance = 400f;
            d.fadeFactor = 1f;
        }

        static void BuildEdge(Transform root, RoadGraph graph, RoadEdge edge, CityMaterials m)
        {
            graph.Span(edge, out float s0, out float s1, out float centre);
            graph.Ends(edge, out int nodeMin, out int nodeMax);
            float a = s0 + graph.TrimAt(edge, nodeMin);
            float b = s1 - graph.TrimAt(edge, nodeMax);
            if (b - a < 5f) return;

            float half = edge.CarriagewayHalfWidth;
            float med = edge.MedianWidth * 0.5f;
            float lineFrom = Mathf.Min(a + CrosswalkDepth + 1.5f, (a + b) * 0.5f);
            float lineTo = Mathf.Max(b - CrosswalkDepth - 1.5f, (a + b) * 0.5f);

            void Line(Material material, float w, float from, float to)
            {
                for (float s = from; s < to; s += 18f)
                {
                    float len = Mathf.Min(18f, to - s);
                    if (len < 1f) continue;
                    Decal(root, "Line", material, edge, RoadGraph.WorldAt(edge, centre, s + len * 0.5f, w), len, 0.1f, len);
                }
            }

            void Dashes(Material material, float w, float from, float to)
            {
                for (float s = from; s < to; s += 12f)
                {
                    Decal(root, "Dash", material, edge, RoadGraph.WorldAt(edge, centre, s + 1.5f, w), 3f, 0.1f, 3f);
                }
            }

            foreach (float sign in new[] { -1f, 1f })
            {
                if (med <= 0.1f) Line(m.DecalYellow, sign * 0.12f, lineFrom, lineTo);
                if (edge.Parking) Line(m.DecalWhite, sign * (med + half - RoadWidths.ParkingWidth), lineFrom, lineTo);
                for (int lane = 1; lane < edge.LanesPerDirection; lane++) Dashes(m.DecalWhite, sign * (med + lane * RoadWidths.LaneWidth), lineFrom, lineTo);
            }

            // Crosswalk and stop line at each end, for the direction of travel arriving there.
            BuildCrossing(root, edge, m, centre, a, half, med, 1f);
            BuildCrossing(root, edge, m, centre, b, half, med, -1f);
        }

        /// <summary>The crosswalk and stop line at one end of an edge; `dir` is +1 at the low end, -1 at the high end.</summary>
        static void BuildCrossing(Transform root, RoadEdge edge, CityMaterials m, float centre, float end, float half, float med, float dir)
        {
            float cwCentre = end + dir * CrosswalkDepth * 0.5f;
            for (float w0 = -half; w0 < half - 0.2f; w0 += BarWidth + BarGap)
            {
                float w1 = Mathf.Min(w0 + BarWidth, half);
                float wc = (w0 + w1) * 0.5f;
                if (med > 0.1f && Mathf.Abs(wc) < med) continue;
                Decal(root, "Crosswalk bar", m.DecalWhite, edge, RoadGraph.WorldAt(edge, centre, cwCentre, wc), CrosswalkDepth, w1 - w0, 4f);
            }
            // Traffic keeps right: the carriageway arriving at this end is the one on `dir`'s side.
            float stopW = dir > 0f ? med + half * 0.5f : -(med + half * 0.5f);
            float stopS = end + dir * (CrosswalkDepth + 1f);
            Decal(root, "Stop line", m.DecalWhite, edge, RoadGraph.WorldAt(edge, centre, stopS, stopW), 0.45f, half, 6f);
        }
    }
}
