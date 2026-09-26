using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Builds a downtown grid district from a seed: a 4 x 4 grid of blocks (about 100 x 80 m each),
    /// with one wider avenue (two lanes each way and a planted median) running through it, every
    /// road and intersection surface, kerb, sidewalk, kerb ramp, lane marking, street lamp and
    /// signal, and buildings filling every block.
    /// </summary>
    public static class DistrictGenerator
    {
        /// <summary>Nodes across (one more than the number of blocks across).</summary>
        public const int Columns = 5;
        /// <summary>Nodes deep (one more than the number of blocks deep).</summary>
        public const int Rows = 5;
        public const float BlockLengthX = 100f;
        public const float BlockLengthZ = 80f;
        /// <summary>Which column of vertical streets is the avenue.</summary>
        public const int AvenueColumn = 2;

        public static GameObject Build(Transform parent, CityMaterials m, Rng random)
        {
            var root = new GameObject("District").transform;
            root.SetParent(parent, false);

            RoadGraph graph = BuildGraph(out int[,] nodeAt);

            var road = new MeshData();
            var medianEdging = new MeshData();
            var medianSoil = new MeshData();
            var medianPalmBases = new List<Vector3>();
            RoadSurfaceBuilder.Build(graph, road, medianEdging, medianSoil, medianPalmBases, random);
            AddSurface(root, "Roads", road, m.Road);
            AddSurface(root, "Median edging", medianEdging, m.Granite);
            AddSurface(root, "Median soil", medianSoil, m.Mulch);
            Palms.Build(root, medianPalmBases, m, random, false);

            var pavement = new MeshData();
            var kerb = new MeshData();
            var ramps = new MeshData();
            var blocks = new List<SidewalkBuilder.BlockRect>();
            for (int i = 0; i < Columns - 1; i++)
            {
                for (int j = 0; j < Rows - 1; j++)
                {
                    SidewalkBuilder.BlockRect rect = SidewalkBuilder.Compute(graph, nodeAt[i, j], nodeAt[i + 1, j], nodeAt[i, j + 1], nodeAt[i + 1, j + 1], RoadWidths.DefaultSidewalk);
                    SidewalkBuilder.Build(rect, pavement, kerb, ramps);
                    blocks.Add(rect);
                }
            }
            AddSurface(root, "Pavements", pavement, m.Pavement);
            AddSurface(root, "Kerbs", kerb, m.Kerb);
            AddSurface(root, "Kerb ramps", ramps, m.Pavement);

            RoadMarkings.Build(root, graph, m);
            RoadFurniture.Build(root, graph, m);
            DistrictBlocks.Build(root, blocks, m, random);

            return root.gameObject;
        }

        static RoadGraph BuildGraph(out int[,] nodeAt)
        {
            var graph = new RoadGraph();
            nodeAt = new int[Columns, Rows];
            for (int i = 0; i < Columns; i++)
            {
                for (int j = 0; j < Rows; j++)
                {
                    nodeAt[i, j] = graph.AddNode(new Vector2(i * BlockLengthX, j * BlockLengthZ));
                }
            }
            for (int i = 0; i < Columns; i++)
            {
                bool avenue = i == AvenueColumn;
                for (int j = 0; j < Rows - 1; j++)
                {
                    graph.AddEdge(nodeAt[i, j], nodeAt[i, j + 1], RoadOrientation.Vertical, avenue ? 2 : 1, true, avenue ? 4f : 0f);
                }
            }
            for (int j = 0; j < Rows; j++)
            {
                for (int i = 0; i < Columns - 1; i++)
                {
                    graph.AddEdge(nodeAt[i, j], nodeAt[i + 1, j], RoadOrientation.Horizontal, 1, true, 0f);
                }
            }
            return graph;
        }

        static void AddSurface(Transform parent, string name, MeshData data, Material material)
        {
            if (data.VertexCount == 0) return;
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            Mesh mesh = data.ToMesh(name);
            mesh.hideFlags = HideFlags.DontSave;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = material;
            r.shadowCastingMode = ShadowCastingMode.On;
            go.isStatic = true;
        }
    }
}
