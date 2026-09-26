using Solmar.City.Roads;
using UnityEngine;

namespace Solmar.Police
{
    /// <summary>
    /// Small helpers shared by the police files: a ground-height raycast (the same technique
    /// <see cref="Solmar.Traffic.LaneNetwork"/> and pedestrians use), telling a police-liveried car
    /// (a spawned <see cref="PoliceCar"/> or an ambient traffic car that happened to roll
    /// <see cref="Solmar.Vehicles.CarModel.Police"/>) from any other car by its baked light-bar
    /// material, and a police-station respawn point.
    /// </summary>
    public static class PoliceUtil
    {
        /// <summary>The same car-space -&gt; root-local reframe <see cref="Solmar.Vehicles.VehicleBody"/>
        /// builds with (x forward, z left -&gt; +z forward, +x left), so a light-bar position computed
        /// from a <see cref="Solmar.Vehicles.CarSpec"/> lands where the baked mesh actually put it.</summary>
        public static readonly Matrix4x4 CarFrame = Matrix4x4.Rotate(Quaternion.Euler(0f, -90f, 0f));

        public static float GroundHeight(float x, float z, float fallbackY)
        {
            var origin = new Vector3(x, fallbackY + 60f, z);
            if (Physics.Raycast(origin, Vector3.down, out RaycastHit hit, 400f, ~0, QueryTriggerInteraction.Ignore) && float.IsFinite(hit.point.y))
                return hit.point.y;
            return fallbackY;
        }

        /// <summary>Whether `carRoot` (a car built by <see cref="Solmar.Vehicles.VehicleBody.Build"/>)
        /// is wearing a police light bar: true for a spawned <see cref="PoliceCar"/> and for any
        /// ambient traffic car that happened to roll the Police model.</summary>
        public static bool IsPoliceLivery(Transform carRoot)
        {
            if (carRoot == null) return false;
            Transform body = carRoot.Find("Body");
            var renderer = body != null ? body.GetComponent<MeshRenderer>() : null;
            if (renderer == null) return false;
            Material[] mats = renderer.sharedMaterials;
            for (int i = 0; i < mats.Length; i++)
            {
                if (mats[i] != null && mats[i].name == "Light bar red") return true;
            }
            return false;
        }

        static bool stationPicked;
        static Vector3 stationPoint;

        /// <summary>A police-station respawn point for a BUSTED player: any node of the loaded
        /// <see cref="RoadGraph"/>, resolved to ground height once and cached.</summary>
        public static Vector3 StationPoint()
        {
            if (stationPicked) return stationPoint;
            RoadGraph graph = RoadGraph.Current;
            if (graph == null || graph.Nodes.Count == 0) return Vector3.zero;
            Vector2 p = graph.Nodes[graph.Nodes.Count / 2].Position;
            float y = GroundHeight(p.x, p.y, 0f);
            stationPoint = new Vector3(p.x, y, p.y);
            stationPicked = true;
            return stationPoint;
        }
    }
}
