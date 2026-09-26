using System.Collections.Generic;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>
    /// The pavement for one block: a flat frame (Layout.PavementWidth wide, matching the single
    /// street) between the surrounding streets' kerb lines and the building line, a kerb wall
    /// between the pavement and the road, and kerb ramps cut into the kerb near every corner, where
    /// a crosswalk lands.
    /// </summary>
    public static class SidewalkBuilder
    {
        const float RampRun = 1.4f;
        const float KerbThickness = 0.13f;

        /// <summary>The block's outer (kerb line) and inner (building line) rectangles.</summary>
        public struct BlockRect
        {
            public float x0, x1, z0, z1;
            public float bx0, bx1, bz0, bz1;

            public bool Valid => x1 > x0 + 0.5f && z1 > z0 + 0.5f && bx1 > bx0 + 0.5f && bz1 > bz0 + 0.5f;
        }

        /// <summary>The four nodes are the block's corners: bottom-left, bottom-right, top-left, top-right.</summary>
        public static BlockRect Compute(RoadGraph graph, int nBL, int nBR, int nTL, int nTR, float sidewalk)
        {
            var r = new BlockRect
            {
                x0 = Mathf.Max(graph.Nodes[nBL].Position.x + graph.HalfExtentX(nBL), graph.Nodes[nTL].Position.x + graph.HalfExtentX(nTL)),
                x1 = Mathf.Min(graph.Nodes[nBR].Position.x - graph.HalfExtentX(nBR), graph.Nodes[nTR].Position.x - graph.HalfExtentX(nTR)),
                z0 = Mathf.Max(graph.Nodes[nBL].Position.y + graph.HalfExtentZ(nBL), graph.Nodes[nBR].Position.y + graph.HalfExtentZ(nBR)),
                z1 = Mathf.Min(graph.Nodes[nTL].Position.y - graph.HalfExtentZ(nTL), graph.Nodes[nTR].Position.y - graph.HalfExtentZ(nTR)),
            };
            r.bx0 = r.x0 + sidewalk;
            r.bx1 = r.x1 - sidewalk;
            r.bz0 = r.z0 + sidewalk;
            r.bz1 = r.z1 - sidewalk;
            return r;
        }

        public static void Build(BlockRect r, MeshData pavement, MeshData kerb, MeshData ramps)
        {
            if (!r.Valid) return;
            Quad(pavement, r.x0, r.x1, r.z0, r.bz0);
            Quad(pavement, r.x0, r.x1, r.bz1, r.z1);
            Quad(pavement, r.x0, r.bx0, r.bz0, r.bz1);
            Quad(pavement, r.bx1, r.x1, r.bz0, r.bz1);

            KerbLineX(kerb, ramps, r.z0, r.x0, r.x1, -1f);
            KerbLineX(kerb, ramps, r.z1, r.x0, r.x1, 1f);
            KerbLineZ(kerb, ramps, r.x0, r.z0, r.z1, -1f);
            KerbLineZ(kerb, ramps, r.x1, r.z0, r.z1, 1f);
        }

        static void Quad(MeshData m, float x0, float x1, float z0, float z1)
        {
            if (x1 <= x0 || z1 <= z0) return;
            const float y = RoadWidths.KerbHeight;
            int i0 = m.AddVertex(new Vector3(x0, y, z0), Vector3.up, new Vector2(x0, z0));
            int i1 = m.AddVertex(new Vector3(x1, y, z0), Vector3.up, new Vector2(x1, z0));
            int i2 = m.AddVertex(new Vector3(x1, y, z1), Vector3.up, new Vector2(x1, z1));
            int i3 = m.AddVertex(new Vector3(x0, y, z1), Vector3.up, new Vector2(x0, z1));
            int start = m.indices.Count;
            m.AddTriangle(i0, i1, i2);
            m.AddTriangle(i0, i2, i3);
            Shapes.FixWinding(m, start, m.indices.Count);
        }

        /// <summary>Kerb wall (with ramp gaps) along a line of constant z, spanning x0..x1. `outward` is -1 (road to the south) or +1 (road to the north).</summary>
        static void KerbLineX(MeshData kerb, MeshData ramps, float z, float x0, float x1, float outward)
        {
            float length = x1 - x0;
            if (length <= 0.1f) return;
            List<float> cuts = RampCuts(length);
            for (int k = 0; k < cuts.Count - 1; k++)
            {
                float s0 = cuts[k], s1 = cuts[k + 1];
                if (s1 - s0 < 1e-3f) continue;
                float xa = x0 + s0, xb = x0 + s1;
                float mid = (s0 + s1) * 0.5f;
                if (IsRamp(mid, length))
                {
                    Vector3 in0 = new Vector3(xa, RoadWidths.KerbHeight, z);
                    Vector3 in1 = new Vector3(xb, RoadWidths.KerbHeight, z);
                    RampQuad(ramps, in0, in1, new Vector2(0f, outward));
                }
                else
                {
                    kerb.Append(Shapes.ChamferBox(xb - xa, RoadWidths.KerbHeight - RoadWidths.GutterHeight, KerbThickness, 0.015f)
                        .Translate((xa + xb) * 0.5f, (RoadWidths.KerbHeight + RoadWidths.GutterHeight) * 0.5f, z + outward * KerbThickness * 0.5f));
                }
            }
        }

        /// <summary>Kerb wall (with ramp gaps) along a line of constant x, spanning z0..z1. `outward` is -1 (road to the west) or +1 (road to the east).</summary>
        static void KerbLineZ(MeshData kerb, MeshData ramps, float x, float z0, float z1, float outward)
        {
            float length = z1 - z0;
            if (length <= 0.1f) return;
            List<float> cuts = RampCuts(length);
            for (int k = 0; k < cuts.Count - 1; k++)
            {
                float s0 = cuts[k], s1 = cuts[k + 1];
                if (s1 - s0 < 1e-3f) continue;
                float za = z0 + s0, zb = z0 + s1;
                float mid = (s0 + s1) * 0.5f;
                if (IsRamp(mid, length))
                {
                    Vector3 in0 = new Vector3(x, RoadWidths.KerbHeight, za);
                    Vector3 in1 = new Vector3(x, RoadWidths.KerbHeight, zb);
                    RampQuad(ramps, in0, in1, new Vector2(outward, 0f));
                }
                else
                {
                    kerb.Append(Shapes.ChamferBox(KerbThickness, RoadWidths.KerbHeight - RoadWidths.GutterHeight, zb - za, 0.015f)
                        .Translate(x + outward * KerbThickness * 0.5f, (RoadWidths.KerbHeight + RoadWidths.GutterHeight) * 0.5f, (za + zb) * 0.5f));
                }
            }
        }

        static List<float> RampCuts(float length)
        {
            float rw = Mathf.Min(RoadWidths.RampWidth, length * 0.3f);
            var cuts = new List<float> { 0f, length };
            if (length > rw * 3f)
            {
                cuts.Add(rw);
                cuts.Add(length - rw);
                cuts.Sort();
            }
            return cuts;
        }

        static bool IsRamp(float mid, float length)
        {
            float rw = Mathf.Min(RoadWidths.RampWidth, length * 0.3f);
            return mid < rw || mid > length - rw;
        }

        /// <summary>A sloped ramp quad from the pavement (in0, in1, at kerb height) down to the road, `outward` beyond it.</summary>
        static void RampQuad(MeshData m, Vector3 in0, Vector3 in1, Vector2 outward)
        {
            Vector3 offset = new Vector3(outward.x, 0f, outward.y) * RampRun;
            Vector3 out0 = new Vector3(in0.x + offset.x, RoadWidths.GutterHeight, in0.z + offset.z);
            Vector3 out1 = new Vector3(in1.x + offset.x, RoadWidths.GutterHeight, in1.z + offset.z);
            Vector3 n = Vector3.Cross(in1 - in0, out0 - in0).normalized;
            if (n.y < 0f) n = -n;
            int i0 = m.AddVertex(in0, n, new Vector2(in0.x, in0.z));
            int i1 = m.AddVertex(in1, n, new Vector2(in1.x, in1.z));
            int i2 = m.AddVertex(out1, n, new Vector2(out1.x, out1.z));
            int i3 = m.AddVertex(out0, n, new Vector2(out0.x, out0.z));
            int start = m.indices.Count;
            m.AddTriangle(i0, i1, i2);
            m.AddTriangle(i0, i2, i3);
            Shapes.FixWinding(m, start, m.indices.Count);
        }
    }
}
