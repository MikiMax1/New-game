using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar
{
    /// <summary>
    /// Accumulates the static geometry of many buildings into one mesh with a submesh per
    /// material, so a whole street of facades costs one draw call per material.
    ///
    /// Geometry is written in a building's local frame (x along the facade, y up, +z out of the
    /// facade towards the street, facade plane at z = 0) and transformed as it is written (see
    /// SetFrame). UVs are in metres, box-projected from the local position by the face's dominant
    /// normal axis, plus a per-building offset so neighbours don't show the same texture patch.
    /// </summary>
    public sealed class MeshBuilder
    {
        readonly Dictionary<Material, MeshData> parts = new Dictionary<Material, MeshData>();
        readonly List<Material> order = new List<Material>();
        Matrix4x4 matrix = Matrix4x4.identity;
        Matrix4x4 normalMatrix = Matrix4x4.identity;
        readonly string name;

        /// <summary>Added to every UV, metres.</summary>
        public Vector2 uvOffset;

        public MeshBuilder(string name)
        {
            this.name = name;
        }

        /// <summary>Sets the local-to-world transform for what follows.</summary>
        public MeshBuilder SetFrame(Matrix4x4 m)
        {
            matrix = m;
            normalMatrix = m.inverse.transpose;
            return this;
        }

        MeshData Part(Material material)
        {
            if (!parts.TryGetValue(material, out MeshData p))
            {
                p = new MeshData();
                parts.Add(material, p);
                order.Add(material);
            }
            return p;
        }

        int Vertex(MeshData part, Vector3 local, Vector3 localNormal)
        {
            Vector2 uv = Shapes.BoxUV(local, localNormal) + uvOffset;
            return part.AddVertex(matrix.MultiplyPoint3x4(local), normalMatrix.MultiplyVector(localNormal).normalized, uv);
        }

        /// <summary>A planar quad with normal n; the winding is fixed up from the normal.</summary>
        public void Quad(Material material, Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 n)
        {
            MeshData part = Part(material);
            int i0 = Vertex(part, a, n), i1 = Vertex(part, b, n), i2 = Vertex(part, c, n), i3 = Vertex(part, d, n);
            bool flip = Vector3.Dot(Vector3.Cross(b - a, c - a), n) < 0f;
            if (flip)
            {
                part.AddTriangle(i0, i2, i1);
                part.AddTriangle(i0, i3, i2);
            }
            else
            {
                part.AddTriangle(i0, i1, i2);
                part.AddTriangle(i0, i2, i3);
            }
        }

        /// <summary>A rectangle in the plane z = const, facing +z (facing = 1) or -z.</summary>
        public void RectZ(Material m, float x0, float x1, float y0, float y1, float z, int facing)
        {
            if (x1 - x0 < 1e-5f || y1 - y0 < 1e-5f) return;
            Quad(m, new Vector3(x0, y0, z), new Vector3(x1, y0, z), new Vector3(x1, y1, z), new Vector3(x0, y1, z), new Vector3(0, 0, facing));
        }

        /// <summary>A rectangle in the plane x = const, facing +x or -x.</summary>
        public void RectX(Material m, float z0, float z1, float y0, float y1, float x, int facing)
        {
            if (z1 - z0 < 1e-5f || y1 - y0 < 1e-5f) return;
            Quad(m, new Vector3(x, y0, z0), new Vector3(x, y0, z1), new Vector3(x, y1, z1), new Vector3(x, y1, z0), new Vector3(facing, 0, 0));
        }

        /// <summary>A rectangle in the plane y = const, facing up or down.</summary>
        public void RectY(Material m, float x0, float x1, float z0, float z1, float y, int facing)
        {
            if (x1 - x0 < 1e-5f || z1 - z0 < 1e-5f) return;
            Quad(m, new Vector3(x0, y, z0), new Vector3(x1, y, z0), new Vector3(x1, y, z1), new Vector3(x0, y, z1), new Vector3(0, facing, 0));
        }

        /// <summary>An axis-aligned box with chamfered edges (c metres); `skip` leaves faces out.</summary>
        public void Box(Material material, float x0, float y0, float z0, float x1, float y1, float z1, float c = 0.015f, string skip = "")
        {
            var local = new MeshData();
            Shapes.ChamferBoxInto(local, new Vector3((x1 - x0) * 0.5f, (y1 - y0) * 0.5f, (z1 - z0) * 0.5f), c, skip, new Vector3((x0 + x1) * 0.5f, (y0 + y1) * 0.5f, (z0 + z1) * 0.5f));
            AppendLocal(material, local);
        }

        /// <summary>Writes mesh data given in the building's local frame.</summary>
        public void AppendLocal(Material material, MeshData local)
        {
            MeshData part = Part(material);
            int start = part.VertexCount;
            for (int i = 0; i < local.VertexCount; i++) Vertex(part, local.positions[i], local.normals[i]);
            for (int i = 0; i < local.indices.Count; i++) part.indices.Add(local.indices[i] + start);
        }

        /// <summary>
        /// Sweeps a closed profile in the (z, y) plane along x from x0 to x1 (cornices, string
        /// courses, copings), with capped ends. Edges meeting at less than `smooth` radians share
        /// normals, so curved mouldings shade smoothly and sharp arrises stay crisp.
        /// </summary>
        public void SweepX(Material material, IList<Vector2> profile, float x0, float x1, float smooth = 0.6f)
        {
            var local = new MeshData();
            var pts = new List<Vector2>(profile);
            // Counter-clockwise seen from +x with z to the right and y up.
            if (Shapes.SignedArea(pts) < 0f) pts.Reverse();
            int n = pts.Count;
            var edgeN = new Vector2[n];
            for (int i = 0; i < n; i++)
            {
                Vector2 e = pts[(i + 1) % n] - pts[i];
                edgeN[i] = new Vector2(e.y, -e.x).normalized;
            }
            Vector2 Blend(Vector2 a, Vector2 b) => Vector2.Angle(a, b) * Mathf.Deg2Rad > smooth ? b : (a + b).normalized;
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                if ((pts[j] - pts[i]).sqrMagnitude < 1e-12f) continue;
                Vector2 na = Blend(edgeN[(i + n - 1) % n], edgeN[i]);
                Vector2 nb = Blend(edgeN[j], edgeN[i]);
                int v0 = local.AddVertex(new Vector3(x0, pts[i].y, pts[i].x), new Vector3(0, na.y, na.x), Vector2.zero);
                int v1 = local.AddVertex(new Vector3(x1, pts[i].y, pts[i].x), new Vector3(0, na.y, na.x), Vector2.zero);
                int v2 = local.AddVertex(new Vector3(x1, pts[j].y, pts[j].x), new Vector3(0, nb.y, nb.x), Vector2.zero);
                int v3 = local.AddVertex(new Vector3(x0, pts[j].y, pts[j].x), new Vector3(0, nb.y, nb.x), Vector2.zero);
                local.AddTriangle(v0, v1, v2);
                local.AddTriangle(v0, v2, v3);
            }
            List<int> tris = Shapes.Triangulate(pts);
            foreach (float x in new[] { x0, x1 })
            {
                var normal = new Vector3(x > x0 ? 1f : -1f, 0f, 0f);
                int start = local.VertexCount;
                foreach (Vector2 p in pts) local.AddVertex(new Vector3(x, p.y, p.x), normal, Vector2.zero);
                for (int t = 0; t < tris.Count; t += 3) local.AddTriangle(start + tris[t], start + tris[t + 1], start + tris[t + 2]);
            }
            Shapes.FixWinding(local, 0, local.indices.Count);
            AppendLocal(material, local);
        }

        /// <summary>Extrudes a closed footprint in the (x, z) plane from y0 to y1 (tanks, bulkheads).</summary>
        public void PrismY(Material material, IList<Vector2> footprint, float y0, float y1, bool top = true, bool bottom = false)
        {
            // Extrude builds along +z from an (x, y) outline: map (x, z) → (x, y) and rotate the
            // result so its extrusion axis points up.
            MeshData prism = Shapes.Extrude(footprint, y1 - y0);
            var rotate = Matrix4x4.Rotate(Quaternion.Euler(-90f, 0f, 0f));
            prism.Transform(Matrix4x4.Translate(new Vector3(0f, y0, 0f)) * rotate);
            // Rotating (x, y, z) by -90° about x maps y to -z: mirror z back so the footprint's
            // second coordinate is world z.
            for (int i = 0; i < prism.VertexCount; i++)
            {
                Vector3 p = prism.positions[i];
                Vector3 nn = prism.normals[i];
                prism.positions[i] = new Vector3(p.x, p.y, -p.z);
                prism.normals[i] = new Vector3(nn.x, nn.y, -nn.z);
            }
            // Drop the caps that aren't wanted (faces whose normals point straight up or down).
            if (!top || !bottom)
            {
                var kept = new List<int>();
                for (int t = 0; t < prism.indices.Count; t += 3)
                {
                    float ny = prism.normals[prism.indices[t]].y;
                    if ((ny > 0.99f && !top) || (ny < -0.99f && !bottom)) continue;
                    kept.Add(prism.indices[t]);
                    kept.Add(prism.indices[t + 1]);
                    kept.Add(prism.indices[t + 2]);
                }
                prism.indices.Clear();
                prism.indices.AddRange(kept);
            }
            Shapes.FixWinding(prism, 0, prism.indices.Count);
            AppendLocal(material, prism);
        }

        /// <summary>
        /// A window pane: a rectangle at depth z facing +z whose UVs run 0..1 across it (for
        /// materials that map a whole pane, e.g. interiors).
        /// </summary>
        public void Pane(Material material, float x0, float x1, float y0, float y1, float z)
        {
            if (x1 - x0 < 1e-5f || y1 - y0 < 1e-5f) return;
            MeshData part = Part(material);
            Vector3 n = normalMatrix.MultiplyVector(Vector3.forward).normalized;
            int a = part.AddVertex(matrix.MultiplyPoint3x4(new Vector3(x0, y0, z)), n, new Vector2(0, 0));
            int b = part.AddVertex(matrix.MultiplyPoint3x4(new Vector3(x1, y0, z)), n, new Vector2(1, 0));
            int c = part.AddVertex(matrix.MultiplyPoint3x4(new Vector3(x1, y1, z)), n, new Vector2(1, 1));
            int d = part.AddVertex(matrix.MultiplyPoint3x4(new Vector3(x0, y1, z)), n, new Vector2(0, 1));
            part.AddTriangle(a, b, c);
            part.AddTriangle(a, c, d);
            Shapes.FixWinding(part, part.indices.Count - 6, part.indices.Count);
        }

        public int TriangleCount
        {
            get
            {
                int n = 0;
                foreach (MeshData p in parts.Values) n += p.indices.Count / 3;
                return n;
            }
        }

        /// <summary>Builds the merged mesh under `parent`: one GameObject, a submesh per material.</summary>
        public GameObject Build(Transform parent)
        {
            var used = order.FindAll(m => parts[m].indices.Count > 0);
            if (used.Count == 0) return null;
            var positions = new List<Vector3>();
            var normals = new List<Vector3>();
            var uvs = new List<Vector2>();
            var offsets = new List<int>();
            foreach (Material m in used)
            {
                parts[m].DropNonFinite(name + " (" + m.name + ")");
                offsets.Add(positions.Count);
                positions.AddRange(parts[m].positions);
                normals.AddRange(parts[m].normals);
                uvs.AddRange(parts[m].uvs);
            }
            var mesh = new Mesh { name = name, indexFormat = IndexFormat.UInt32 };
            mesh.SetVertices(positions);
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uvs);
            mesh.subMeshCount = used.Count;
            for (int k = 0; k < used.Count; k++)
            {
                List<int> src = parts[used[k]].indices;
                var tri = new List<int>(src.Count);
                for (int i = 0; i < src.Count; i++) tri.Add(src[i] + offsets[k]);
                mesh.SetTriangles(tri, k, false);
            }
            mesh.RecalculateBounds();
            mesh.RecalculateTangents();
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterials = used.ToArray();
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
            go.isStatic = true;
            return go;
        }
    }
}
