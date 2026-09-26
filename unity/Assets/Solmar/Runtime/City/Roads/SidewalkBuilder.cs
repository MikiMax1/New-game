using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>
    /// The pavement round every block, whatever its shape: a flat ring (Layout.PavementWidth or the
    /// street's own width) between the kerb line, which follows the rounded corners of the
    /// junctions, and the building line; a granite kerb wall along the whole kerb line; kerb ramps
    /// down to every crosswalk; and the ground inside the building line: paved courtyards
    /// downtown and on the beach strip, lawns for yards and parks, paving for plazas.
    /// </summary>
    public static class SidewalkBuilder
    {
        const float KerbThickness = 0.13f;
        const float RampRun = 1.0f;

        public static void Build(CityPlan plan, CityTiles tiles, CityMaterials m, Material lawn)
        {
            foreach (CityBlock b in plan.Blocks) BuildBlock(plan.Graph, b, tiles, m, lawn);
            if (plan.Outside != null) BuildBlock(plan.Graph, plan.Outside, tiles, m, lawn);
        }

        static void BuildBlock(RoadGraph g, CityBlock b, CityTiles tiles, CityMaterials m, Material lawn)
        {
            int count = b.Nodes.Count;
            if (count < 2 || b.Kerb.Count < 3) return;
            List<Vector2> kerb = b.Kerb;
            const float y = RoadWidths.KerbHeight;

            // Kerb walls and ramps.
            for (int i = 0; i < count; i++)
            {
                Vector2 at = g.Nodes[b.Nodes[i]].Position;
                MeshData walls = tiles.Surface(at, "Kerbs", m.Kerb);
                for (int j = b.KerbCornerStart[i]; j < b.KerbCornerEnd[i]; j++) Wall(walls, kerb[j], kerb[j + 1]);

                // The straight kerb along Edges[i], with a ramp at each end that meets a crosswalk.
                Vector2 p = kerb[b.KerbCornerEnd[i]];
                Vector2 q = kerb[b.KerbCornerStart[(i + 1) % count]];
                float len = Vector2.Distance(p, q);
                if (len < 0.05f) continue;
                Vector2 dir = (q - p) / len;
                bool rampStart = g.IsJunction(b.Nodes[i]);
                bool rampEnd = g.IsJunction(b.Nodes[(i + 1) % count]);
                float ramp = Mathf.Min(RoadWidths.CrosswalkDepth, len * 0.4f);
                float s0 = rampStart ? ramp : 0f;
                float s1 = rampEnd ? len - ramp : len;
                MeshData ramps = tiles.Surface(at, "Kerb ramps", m.Pavement);
                if (rampStart && ramp > 0.3f) Ramp(ramps, p, p + dir * ramp);
                if (rampEnd && ramp > 0.3f) Ramp(ramps, q - dir * ramp, q);
                if (s1 > s0 + 0.02f) Wall(walls, p + dir * s0, p + dir * s1);
            }

            // The pavement ring.
            if (b.PavementValid)
            {
                List<Vector2> line = b.BuildingLine;
                for (int i = 0; i < count; i++)
                {
                    Vector2 qi = line[i];
                    MeshData pave = tiles.Surface(g.Nodes[b.Nodes[i]].Position, "Pavements", m.Pavement);
                    for (int j = b.KerbCornerStart[i]; j < b.KerbCornerEnd[i]; j++) SurfaceMesh.Triangle(pave, qi, kerb[j], kerb[j + 1], y);
                    int next = (i + 1) % count;
                    Vector2 c0 = kerb[b.KerbCornerEnd[i]], c1 = kerb[b.KerbCornerStart[next]];
                    SurfaceMesh.Triangle(pave, c0, c1, line[next], y);
                    SurfaceMesh.Triangle(pave, c0, line[next], qi, y);
                }
                if (b.Kind != BlockKind.Outside) Ground(b, tiles, m, lawn);
            }
            else if (b.Kind != BlockKind.Outside)
            {
                SurfaceMesh.Polygon(tiles.Surface(b.Centre, "Pavements", m.Pavement), Polygons.Dedupe(kerb), y);
            }
        }

        /// <summary>The ground inside the building line.</summary>
        static void Ground(CityBlock b, CityTiles tiles, CityMaterials m, Material lawn)
        {
            string name;
            Material mat;
            switch (b.Kind)
            {
                case BlockKind.Park:
                    name = "Park lawn";
                    mat = lawn;
                    break;
                case BlockKind.Plaza:
                    name = "Plaza paving";
                    mat = m.Pavement;
                    break;
                default:
                    bool yard = b.District == District.Residential;
                    name = yard ? "Yards" : "Courtyards";
                    mat = yard ? lawn : m.Concrete;
                    break;
            }
            SurfaceMesh.Polygon(tiles.Surface(b.Centre, name, mat, CityTiles.Layer.Ground), b.BuildingLine, RoadWidths.KerbHeight);
        }

        /// <summary>A kerb wall along p→q, standing on the road side (the right, looking from p to q) of the kerb line.</summary>
        static void Wall(MeshData m, Vector2 p, Vector2 q)
        {
            Vector2 d = q - p;
            float len = d.magnitude;
            if (len < 0.01f) return;
            d /= len;
            // Only the faces that can be seen: the top, a chamfer and the face to the road (the
            // pavement covers the back). Stretched a little at each end so bends close up.
            p -= d * 0.02f;
            q += d * 0.02f;
            len += 0.04f;
            var right = new Vector2(d.y, -d.x);
            const float top = RoadWidths.KerbHeight, chamfer = 0.02f, bottom = -0.06f;
            Vector3 P(Vector2 at, float across, float y)
            {
                Vector2 v = at + right * across;
                return new Vector3(v.x, y, v.y);
            }
            var up = Vector3.up;
            var face = new Vector3(right.x, 0f, right.y);
            Vector3 bevel = (up + face).normalized;
            const float inner = KerbThickness - chamfer;
            SurfaceMesh.Quad(m, P(p, 0f, top), P(q, 0f, top), P(q, inner, top), P(p, inner, top), up,
                new Vector2(0f, 0f), new Vector2(len, 0f), new Vector2(len, inner), new Vector2(0f, inner));
            SurfaceMesh.Quad(m, P(p, inner, top), P(q, inner, top), P(q, KerbThickness, top - chamfer), P(p, KerbThickness, top - chamfer), bevel,
                new Vector2(0f, inner), new Vector2(len, inner), new Vector2(len, KerbThickness + 0.01f), new Vector2(0f, KerbThickness + 0.01f));
            SurfaceMesh.Quad(m, P(p, KerbThickness, top - chamfer), P(q, KerbThickness, top - chamfer), P(q, KerbThickness, bottom), P(p, KerbThickness, bottom), face,
                new Vector2(0f, top), new Vector2(len, top), new Vector2(len, bottom), new Vector2(0f, bottom));
        }

        /// <summary>A kerb ramp: the pavement edge from p to q sloping down onto the road (to the right) over RampRun.</summary>
        static void Ramp(MeshData m, Vector2 p, Vector2 q)
        {
            Vector2 d = RoadGraph.SafeNormal(q - p);
            Vector2 right = new Vector2(d.y, -d.x);
            Vector2 po = p + right * RampRun, qo = q + right * RampRun;
            var a = new Vector3(p.x, RoadWidths.KerbHeight, p.y);
            var b = new Vector3(q.x, RoadWidths.KerbHeight, q.y);
            var c = new Vector3(qo.x, RoadWidths.GutterHeight * 0.5f, qo.y);
            var e = new Vector3(po.x, RoadWidths.GutterHeight * 0.5f, po.y);
            Vector3 n = Vector3.Cross(b - a, e - a).normalized;
            if (n.y < 0f) n = -n;
            SurfaceMesh.Quad(m, a, b, c, e, n, p, q, qo, po);
            // Cheeks closing the ramp's sides down to the road.
            var pb = new Vector3(p.x, -0.02f, p.y);
            var qb = new Vector3(q.x, -0.02f, q.y);
            int first = m.indices.Count;
            Vector3 side = new Vector3(-d.x, 0f, -d.y);
            int i0 = m.AddVertex(a, side, new Vector2(0f, a.y)), i1 = m.AddVertex(e, side, new Vector2(RampRun, e.y)), i2 = m.AddVertex(pb, side, new Vector2(0f, pb.y));
            m.AddTriangle(i0, i1, i2);
            side = -side;
            int j0 = m.AddVertex(b, side, new Vector2(0f, b.y)), j1 = m.AddVertex(c, side, new Vector2(RampRun, c.y)), j2 = m.AddVertex(qb, side, new Vector2(0f, qb.y));
            m.AddTriangle(j0, j1, j2);
            Shapes.FixWinding(m, first, m.indices.Count);
        }
    }
}
