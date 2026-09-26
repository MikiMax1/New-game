using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Builds the whole city of Solmar from a seed, about 2 × 2 km inside its ring road: a
    /// downtown grid of towers crossed by a diagonal avenue, Art Deco and MiMo blocks along a
    /// coastal boulevard with a promenade and beach, residential neighbourhoods of curving streets
    /// and houses with yards, parks and plazas, and land, beach and ocean out to the horizon.
    ///
    /// <see cref="CityPlan"/> lays it out (streets, junctions, blocks, lots, buildings) without
    /// touching Unity; the builders here turn the plan into meshes, collected per 200 m tile and
    /// material by <see cref="CityTiles"/>. The plan and its road graph are published as
    /// <see cref="CityPlan.Current"/> and <see cref="RoadGraph.Current"/> for traffic, pedestrians
    /// and the minimap.
    /// </summary>
    public static class DistrictGenerator
    {
        // The old 4 × 4 grid's dimensions, kept for code that still reads them; the city no longer uses them.
        /// <summary>Nodes across the old grid.</summary>
        public const int Columns = 5;
        /// <summary>Nodes deep in the old grid.</summary>
        public const int Rows = 5;
        public const float BlockLengthX = 100f;
        public const float BlockLengthZ = 80f;
        /// <summary>Which column of the old grid was the avenue.</summary>
        public const int AvenueColumn = 2;

        /// <summary>Plans and builds the city under `parent`; returns the plan.</summary>
        public static CityPlan Build(Transform parent, CityMaterials m, uint seed, Rng random)
        {
            var watch = System.Diagnostics.Stopwatch.StartNew();
            CityPlan plan = CityPlan.Build(seed);
            CityPlan.Current = plan;
            RoadGraph.Current = plan.Graph;
            var stages = new System.Text.StringBuilder("plan " + watch.ElapsedMilliseconds + " ms");
            long last = watch.ElapsedMilliseconds;
            void Lap(string stage)
            {
                long now = watch.ElapsedMilliseconds;
                stages.Append(", " + stage + " " + (now - last) + " ms");
                last = now;
            }

            var root = new GameObject("District").transform;
            root.SetParent(parent, false);
            root.gameObject.isStatic = true;
            var tiles = new CityTiles(root);

            Material lawn = m.Surface("Lawn", new Color(0.075f, 0.13f, 0.04f), 0.12f);
            Material water = m.Surface("Pool water", new Color(0.03f, 0.2f, 0.24f), 0.95f);
            Material ocean = m.Surface("Ocean", new Color(0.012f, 0.055f, 0.07f), 0.94f);
            Material canopy = m.Surface("Tree leaves", new Color(0.055f, 0.11f, 0.035f), 0.25f);

            var medianPalms = new List<RoadSurfaceBuilder.PalmSpot>();
            RoadSurfaceBuilder.Build(plan.Graph, tiles, m, lawn, medianPalms, random);
            Lap("roads");
            SidewalkBuilder.Build(plan, tiles, m, lawn);
            Lap("pavements");
            RoadMarkings.Build(plan.Graph, tiles, m);
            Lap("markings");
            RoadFurniture.Build(plan.Graph, tiles, m);
            Lap("lamps and signals");
            DistrictBlocks.Build(plan, tiles, m, lawn, water, random);
            Lap("buildings");

            var detailed = new List<Vector3>();
            var palms = new List<Vector3>();
            var trees = new List<Vector3>();
            foreach (RoadSurfaceBuilder.PalmSpot spot in medianPalms) (spot.detailed ? detailed : palms).Add(spot.position);
            foreach (CityBlock block in plan.Blocks) AddPlanted(block, palms, trees);
            if (plan.Outside != null) AddPlanted(plan.Outside, palms, trees);

            CityGround.Build(plan, root, tiles, m, lawn, ocean, palms, trees, random);
            Lap("ground");
            CityTrees.Build(tiles, m, canopy, detailed, palms, trees, random);
            Lap("trees");
            tiles.Build();
            Lap("meshes");

            Debug.Log("Solmar city: " + plan.Graph.Nodes.Count + " junctions and bends, " + plan.Graph.Edges.Count + " street segments, "
                + plan.Blocks.Count + " blocks, " + plan.Buildings.Count + " buildings, " + (detailed.Count + palms.Count) + " palms (" + detailed.Count + " detailed) and " + trees.Count
                + " trees in " + watch.ElapsedMilliseconds + " ms (" + stages + ").");
            return plan;
        }

        /// <summary>The palms and trees a block's planner placed (on the ground inside its building line, at kerb height).</summary>
        static void AddPlanted(CityBlock block, List<Vector3> palms, List<Vector3> trees)
        {
            foreach (Vector2 p in block.Palms) palms.Add(new Vector3(p.x, RoadWidths.KerbHeight, p.y));
            foreach (Vector2 p in block.Trees) trees.Add(new Vector3(p.x, RoadWidths.KerbHeight, p.y));
        }
    }
}
