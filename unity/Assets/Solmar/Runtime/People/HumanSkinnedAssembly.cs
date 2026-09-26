using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar.People
{
    /// <summary>
    /// Like Core's <see cref="Assembly"/> (mesh data per named slot, merged into one mesh with a
    /// submesh per slot), but also carries a <see cref="BoneWeight"/> per vertex in lock-step, so a
    /// single skinned mesh can be built from several differently-materialed regions (skin, hair,
    /// clothes, ...) that all move with the same bone hierarchy.
    /// </summary>
    sealed class HumanSkinnedAssembly
    {
        readonly List<string> slots = new List<string>();
        readonly Dictionary<string, MeshData> parts = new Dictionary<string, MeshData>();
        readonly Dictionary<string, List<BoneWeight>> weights = new Dictionary<string, List<BoneWeight>>();

        public void Add(string slot, MeshData data, List<BoneWeight> boneWeights)
        {
            if (data.VertexCount != boneWeights.Count)
            {
                Debug.LogWarning("Solmar: HumanSkinnedAssembly slot '" + slot + "' had mismatched vertex/weight counts.");
                return;
            }
            if (!parts.TryGetValue(slot, out MeshData part))
            {
                part = new MeshData();
                parts.Add(slot, part);
                weights.Add(slot, new List<BoneWeight>());
                slots.Add(slot);
            }
            part.Append(data);
            weights[slot].AddRange(boneWeights);
        }

        public bool HasSlot(string slot) => parts.TryGetValue(slot, out MeshData p) && p.indices.Count > 0;

        /// <summary>
        /// Builds the merged mesh; `order` picks which slots become submeshes and in what order
        /// (slots not present, or missing from `order`, are skipped). Returns the per-vertex bone
        /// weights in the same combined vertex order, and which slots ended up used (for materials).
        /// </summary>
        public (Mesh mesh, BoneWeight[] boneWeights, List<string> usedSlots) Build(string name, IList<string> order)
        {
            var used = new List<string>();
            foreach (string s in order) if (HasSlot(s)) used.Add(s);

            int total = 0;
            foreach (string s in used)
            {
                parts[s].DropNonFinite(name + " (" + s + ")");
                total += parts[s].VertexCount;
            }

            var positions = new List<Vector3>(total);
            var normals = new List<Vector3>(total);
            var uvs = new List<Vector2>(total);
            var allWeights = new List<BoneWeight>(total);
            var offsets = new List<int>();
            foreach (string s in used)
            {
                offsets.Add(positions.Count);
                positions.AddRange(parts[s].positions);
                normals.AddRange(parts[s].normals);
                uvs.AddRange(parts[s].uvs);
                allWeights.AddRange(weights[s]);
            }

            var mesh = new Mesh { name = name, indexFormat = total > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            mesh.SetVertices(positions);
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uvs);
            mesh.subMeshCount = Mathf.Max(1, used.Count);
            for (int k = 0; k < used.Count; k++)
            {
                List<int> src = parts[used[k]].indices;
                var tri = new List<int>(src.Count);
                for (int i = 0; i < src.Count; i++) tri.Add(src[i] + offsets[k]);
                mesh.SetTriangles(tri, k, false);
            }
            mesh.RecalculateBounds();
            mesh.RecalculateTangents();
            return (mesh, allWeights.ToArray(), used);
        }
    }
}
