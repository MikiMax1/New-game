using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Fills each block with a simple, tidy building along every side (varied heights, tinted
    /// stucco, a plain window band per storey), facing its own street and leaving a paved,
    /// planted courtyard in the middle, clear of every sidewalk.
    /// </summary>
    public static class DistrictBlocks
    {
        const float Ground = 4.5f;
        const float Storey = 3.3f;
        const float Parapet = 1f;
        const float MinFacade = 11f;
        const float MaxFacade = 23f;
        const float RingDepth = 15f;
        const float CourtyardY = RoadWidths.KerbHeight;

        public static GameObject Build(Transform parent, IList<SidewalkBuilder.BlockRect> blocks, CityMaterials m, Rng random)
        {
            var root = new GameObject("Blocks").transform;
            root.SetParent(parent, false);
            var mb = new MeshBuilder("Block buildings");
            var courtyardPaving = new MeshData();
            var lawn = new MeshData();
            var palmBases = new List<Vector3>();

            Material trim = m.Stucco(new Color(0.95f, 0.94f, 0.91f));
            Material frame = m.Painted(new Color(0.88f, 0.87f, 0.85f), 0.35f);
            string[] tints = { "#E9D8C4", "#E8C9C3", "#CFE0D6", "#F0E2B8", "#D8D2E6", "#ECE8DF", "#DFE3E2", "#C9B49C" };

            foreach (SidewalkBuilder.BlockRect r in blocks)
            {
                if (!r.Valid) continue;
                float depth = Mathf.Clamp(RingDepth, 4f, Mathf.Min(r.bx1 - r.bx0, r.bz1 - r.bz0) * 0.5f - 3f);
                if (depth < 4f) continue;

                BuildSide(mb, m, trim, frame, tints, random, r.bx0, r.bx1, r.bz0, false, false, depth);
                BuildSide(mb, m, trim, frame, tints, random, r.bx0, r.bx1, r.bz1, false, true, depth);
                BuildSide(mb, m, trim, frame, tints, random, r.bz0 + depth, r.bz1 - depth, r.bx0, true, false, depth);
                BuildSide(mb, m, trim, frame, tints, random, r.bz0 + depth, r.bz1 - depth, r.bx1, true, true, depth);

                CourtYard(r, depth, courtyardPaving, lawn, palmBases, random);
            }

            mb.Build(root);
            Add(root, "Courtyard paving", courtyardPaving, m.Concrete);
            Add(root, "Courtyard lawn", lawn, m.GroundCover);
            Palms.Build(root, palmBases, m, random, false);
            return root.gameObject;
        }

        static void Add(Transform parent, string name, MeshData data, Material material)
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

        static void CourtYard(SidewalkBuilder.BlockRect r, float depth, MeshData paving, MeshData lawn, List<Vector3> palmBases, Rng random)
        {
            float x0 = r.bx0 + depth, x1 = r.bx1 - depth, z0 = r.bz0 + depth, z1 = r.bz1 - depth;
            if (x1 <= x0 + 0.5f || z1 <= z0 + 0.5f) return;
            Flat(paving, x0, x1, z0, z1, CourtyardY);
            const float border = 1.2f;
            if (x1 - x0 > border * 3f && z1 - z0 > border * 3f) Flat(lawn, x0 + border, x1 - border, z0 + border, z1 - border, CourtyardY + 0.01f);
            int trees = Mathf.Clamp((int)((x1 - x0) * (z1 - z0) / 220f), 0, 4);
            for (int k = 0; k < trees; k++)
            {
                float px = random.Range(x0 + 2.5f, x1 - 2.5f);
                float pz = random.Range(z0 + 2.5f, z1 - 2.5f);
                palmBases.Add(new Vector3(px, CourtyardY, pz));
            }
        }

        static void Flat(MeshData m, float x0, float x1, float z0, float z1, float y)
        {
            if (x1 <= x0 || z1 <= z0) return;
            int i0 = m.AddVertex(new Vector3(x0, y, z0), Vector3.up, new Vector2(x0, z0));
            int i1 = m.AddVertex(new Vector3(x1, y, z0), Vector3.up, new Vector2(x1, z0));
            int i2 = m.AddVertex(new Vector3(x1, y, z1), Vector3.up, new Vector2(x1, z1));
            int i3 = m.AddVertex(new Vector3(x0, y, z1), Vector3.up, new Vector2(x0, z1));
            int start = m.indices.Count;
            m.AddTriangle(i0, i1, i2);
            m.AddTriangle(i0, i2, i3);
            Shapes.FixWinding(m, start, m.indices.Count);
        }

        /// <summary>
        /// One side of a block's ring of buildings: `along0`..`along1` runs along world x (a north
        /// or south side, vertical = false) or along world z (an east or west side, vertical =
        /// true); `line` is the facade line's fixed coordinate on the other axis; `far` is true for
        /// the side further from the origin (north or east), whose facade must face +x/+z.
        /// </summary>
        static void BuildSide(MeshBuilder mb, CityMaterials cm, Material trim, Material frame, string[] tints, Rng random, float along0, float along1, float line, bool vertical, bool far, float depth)
        {
            float length = along1 - along0;
            if (length < MinFacade) return;
            float yaw = vertical ? (far ? 90f : -90f) : (far ? 0f : 180f);
            bool reversed = far == vertical;
            var rotation = Quaternion.Euler(0f, yaw, 0f);

            float x = along0;
            while (along1 - x >= MinFacade)
            {
                float remaining = along1 - x;
                float w = Mathf.Min(MinFacade + random.Next() * (MaxFacade - MinFacade), remaining);
                if (remaining - w < MinFacade && remaining - w > 0.5f) w = remaining; // absorb an otherwise-too-narrow remainder
                float segAlong0 = x, segAlong1 = x + w;
                float alongCoord = reversed ? segAlong1 : segAlong0;
                Vector3 origin = vertical ? new Vector3(line, 0f, alongCoord) : new Vector3(alongCoord, 0f, line);
                mb.SetFrame(Matrix4x4.TRS(origin, rotation, Vector3.one));
                mb.uvOffset = new Vector2(random.Next() * 41f, random.Next() * 23f);
                BuildOne(mb, cm, trim, frame, tints, random, w, depth);
                x = segAlong1;
            }
        }

        static void BuildOne(MeshBuilder mb, CityMaterials cm, Material trim, Material frame, string[] tints, Rng random, float width, float depth)
        {
            int storeys = 3 + (int)(random.Next() * 23f);
            Material wall = cm.Stucco(Hex(tints[Mathf.Clamp((int)(random.Next() * tints.Length), 0, tints.Length - 1)]));
            float top = Ground + storeys * Storey;

            mb.RectZ(wall, 0f, width, -0.4f, Ground, 0f, 1);
            mb.Pane(cm.ShopGlass, 0.5f, Mathf.Max(0.6f, width - 0.5f), 0.5f, 3.3f, 0.01f);
            for (int s = 0; s < storeys; s++)
            {
                float y0 = Ground + s * Storey;
                mb.RectZ(wall, 0f, width, y0, y0 + Storey, 0f, 1);
                float ww = Mathf.Clamp(width - 1.4f, 0f, width * 0.75f);
                float cx = width * 0.5f;
                mb.RectZ(cm.RoomWall, cx - ww * 0.5f, cx + ww * 0.5f, y0 + 0.9f, y0 + 2.45f, 0.004f, 1);
                mb.Pane(cm.WindowGlass, cx - ww * 0.5f, cx + ww * 0.5f, y0 + 0.9f, y0 + 2.45f, 0.01f);
                mb.Box(frame, cx - ww * 0.5f - 0.06f, y0 + 0.82f, -0.02f, cx + ww * 0.5f + 0.06f, y0 + 0.9f, 0.05f, 0.006f);
            }
            mb.RectZ(wall, 0f, width, top, top + Parapet, 0f, 1);
            mb.Box(trim, -0.05f, top + Parapet, -0.2f, width + 0.05f, top + Parapet + 0.12f, 0.08f, 0.015f);
            mb.RectX(wall, -depth, 0f, -0.4f, top + Parapet, 0f, -1);
            mb.RectX(wall, -depth, 0f, -0.4f, top + Parapet, width, 1);
            mb.RectY(cm.Concrete, 0f, width, -depth, 0f, top, 1);
        }

        static Color Hex(string hex)
        {
            ColorUtility.TryParseHtmlString(hex, out Color c);
            return c;
        }
    }
}
