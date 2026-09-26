using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Builds every planned building (<see cref="CityPlan.Buildings"/>) and the contents of the
    /// blocks: pools, park paths and fountains.
    ///
    /// A building is its footprint extruded to its height, each side facing the street (or all
    /// round, for towers and houses) a facade in its style, the others plain walls:
    ///
    ///   Tower     glass curtain wall: a spandrel band and a band of glazing per storey, mullions
    ///             running the full height, a glass lobby, a plant room on the roof
    ///   Office    punched windows in concrete or render, shop fronts on the street side
    ///   Deco      pastel render, eyebrow ledges over the windows, string courses, a fin rising
    ///             above the roof in the middle of the front, awnings over the shop fronts
    ///   MiMo      a cantilevered balcony with a rail along every storey
    ///   House     two or three storeys, windows all round, a front door, a flat roof with a
    ///             parapet or a tiled hip roof
    ///   Lowrise   warehouses and shops: wide windows, roller doors
    ///
    /// Windows are recessed into their openings, with glass in front of a dark room wall (lit in
    /// some). Sides are written in the frame of their own facade (x along it, y up, z out to the
    /// street) into the tile's MeshBuilder, one mesh per material per tile; a plain prism of the
    /// footprint goes into the tile's collision mesh.
    /// </summary>
    public static class DistrictBlocks
    {
        const float Parapet = 1f;
        const float Recess = 0.16f;

        sealed class Palette
        {
            public CityMaterials m;
            public Material trim, frame, darkFrame, spandrel, rail, roof, roofTiles, door, lit, shop, awning, water;
            public readonly Dictionary<BuildingStyle, Color[]> tints = new Dictionary<BuildingStyle, Color[]>();

            public Material Wall(BuildingPlan b)
            {
                Color[] list = tints[b.Style];
                Color c = list[Mathf.Abs(b.Tint) % list.Length];
                if (b.Style == BuildingStyle.Office && b.Tint % 3 == 0) return m.FacadeConcrete;
                return m.Stucco(c);
            }
        }

        static Color Hex(string hex)
        {
            ColorUtility.TryParseHtmlString(hex, out Color c);
            return c;
        }

        static Color[] Hexes(params string[] hex)
        {
            var r = new Color[hex.Length];
            for (int i = 0; i < hex.Length; i++) r[i] = Hex(hex[i]);
            return r;
        }

        public static void Build(CityPlan plan, CityTiles tiles, CityMaterials m, Material lawn, Material water, Rng random)
        {
            var p = new Palette
            {
                m = m,
                trim = m.Stucco(new Color(0.96f, 0.95f, 0.92f)),
                frame = m.Painted(new Color(0.91f, 0.9f, 0.88f), 0.35f),
                darkFrame = m.Painted(new Color(0.16f, 0.17f, 0.18f), 0.4f),
                spandrel = m.Painted(new Color(0.2f, 0.25f, 0.27f), 0.3f),
                rail = m.Painted(new Color(0.95f, 0.95f, 0.93f), 0.3f),
                roof = m.Concrete,
                roofTiles = m.Surface("Roof tiles", new Color(0.42f, 0.15f, 0.07f), 0.3f),
                door = m.Painted(new Color(0.28f, 0.18f, 0.11f), 0.4f),
                lit = m.Emissive(new Color(1f, 0.78f, 0.55f), 35f),
                shop = m.Emissive(new Color(1f, 0.93f, 0.84f), 90f),
                awning = m.Painted(new Color(0.12f, 0.45f, 0.5f), 0.5f),
                water = water,
            };
            p.tints[BuildingStyle.Tower] = Hexes("#8E9A9E", "#6F7E86", "#A7A9A6");
            p.tints[BuildingStyle.Office] = Hexes("#D9D2C5", "#C9C3B8", "#E3DCCB", "#BDB6AA", "#D6CDBF", "#CFC9BC");
            p.tints[BuildingStyle.Deco] = Hexes("#E9D8C4", "#E8C9C3", "#CFE0D6", "#F0E2B8", "#D8D2E6", "#F2ECE0", "#F4C7B8", "#BFE3E0");
            p.tints[BuildingStyle.MiMo] = Hexes("#ECE8DF", "#DFE3E2", "#F1E6D3", "#E8EEF0");
            p.tints[BuildingStyle.House] = Hexes("#F3E3C7", "#E9D8C4", "#F2D4C8", "#DCE8DD", "#F4EEDC", "#E6DDEF", "#F7E7B9", "#D9E4EC");
            p.tints[BuildingStyle.Lowrise] = Hexes("#C9C1B2", "#D8D0C0", "#B7B2A8", "#E0D6C2");

            foreach (BuildingPlan b in plan.Buildings) BuildOne(tiles, p, b, random);
            foreach (CityBlock block in plan.Blocks) BlockContents(block, tiles, p, random);
        }

        // ------------------------------------------------------------------ buildings

        static void BuildOne(CityTiles tiles, Palette p, BuildingPlan b, Rng random)
        {
            List<Vector2> f = b.Footprint;
            int n = f.Count;
            if (n < 3 || Polygons.SignedArea(f) < 10f) return;
            MeshBuilder mb = tiles.Buildings(b.Centre);
            mb.uvOffset = new Vector2(b.Seed * 37.1f, b.Seed * 11.7f);
            bool hip = b.Style == BuildingStyle.House && b.HipRoof && n == 4;
            float top = b.Height + (hip ? 0f : b.Style == BuildingStyle.House ? 0.45f : Parapet);
            Material wall = b.Style == BuildingStyle.Tower ? p.spandrel : p.Wall(b);

            for (int i = 0; i < n; i++)
            {
                Vector2 p0 = f[i], p1 = f[(i + 1) % n];
                float w = Vector2.Distance(p0, p1);
                if (w < 0.05f) continue;
                SetFacadeFrame(mb, p0, p1);
                bool facade = i < b.Facade.Count && b.Facade[i] && w >= 2.6f;
                // Plinth below the pavement, so there is never a gap at its edge.
                mb.RectZ(wall, 0f, w, -0.35f, 0f, 0f, 1);
                if (!facade)
                {
                    mb.RectZ(wall, 0f, w, 0f, top, 0f, 1);
                }
                else
                {
                    switch (b.Style)
                    {
                        case BuildingStyle.Tower:
                            CurtainWall(mb, p, b, w, top, random);
                            break;
                        case BuildingStyle.House:
                            HouseFacade(mb, p, b, wall, w, i == b.Front, top, random);
                            break;
                        default:
                            PunchedFacade(mb, p, b, wall, w, i == b.Front, top, random);
                            break;
                    }
                }
                if (!hip)
                {
                    // Parapet: inner face and coping.
                    float py = b.Height;
                    mb.RectZ(wall, 0f, w, py, top, -0.25f, -1);
                    mb.RectY(p.trim, -0.02f, w + 0.02f, -0.27f, 0.03f, top, 1);
                }
            }

            mb.SetFrame(Matrix4x4.identity);
            if (hip) HipRoof(mb, p, f, b.Height);
            else FlatRoof(mb, p, f, b.Height + RoadWidths.KerbHeight);
            if (b.Style == BuildingStyle.Tower || b.Style == BuildingStyle.Office) RoofPlant(mb, p, b, random);
            if (b.Style == BuildingStyle.Deco) DecoFin(mb, p, b, wall);
            Collision(tiles.BuildingCollision(b.Centre), f, top);
        }

        /// <summary>Frame for the side p0→p1 (footprint counter-clockwise, street on the right): origin at p1 on the pavement, x back towards p0, z out to the street.</summary>
        static void SetFacadeFrame(MeshBuilder mb, Vector2 p0, Vector2 p1)
        {
            Vector2 d = RoadGraph.SafeNormal(p1 - p0);
            var outward = new Vector3(d.y, 0f, -d.x);
            mb.SetFrame(Matrix4x4.TRS(new Vector3(p1.x, RoadWidths.KerbHeight, p1.y), Quaternion.LookRotation(outward, Vector3.up), Vector3.one));
        }

        /// <summary>A box without its back face (x0..x1, y0..y1, z0..z1 in the facade frame).</summary>
        static void Box5(MeshBuilder mb, Material m, float x0, float y0, float z0, float x1, float y1, float z1)
        {
            if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
            mb.RectZ(m, x0, x1, y0, y1, z1, 1);
            mb.RectY(m, x0, x1, z0, z1, y1, 1);
            mb.RectY(m, x0, x1, z0, z1, y0, -1);
            mb.RectX(m, z0, z1, y0, y1, x0, -1);
            mb.RectX(m, z0, z1, y0, y1, x1, 1);
        }

        /// <summary>A window opening: reveals, the room behind (dark, or lit), the glass and a sill.</summary>
        static void Window(MeshBuilder mb, Palette p, Material wall, Material sill, float x0, float x1, float y0, float y1, Rng random)
        {
            mb.RectX(wall, -Recess, 0f, y0, y1, x0, 1);
            mb.RectX(wall, -Recess, 0f, y0, y1, x1, -1);
            mb.RectY(wall, x0, x1, -Recess, 0f, y1, -1);
            mb.RectZ(random.Next() < 0.12f ? p.lit : p.m.RoomWall, x0, x1, y0, y1, -Recess, 1);
            mb.Pane(p.m.WindowGlass, x0, x1, y0, y1, -Recess + 0.05f);
            if (sill != null)
            {
                // The sill runs through the bottom of the opening: its top and front (its ends and
                // underside are too small to see).
                mb.RectY(sill, x0 - 0.06f, x1 + 0.06f, -Recess, 0.06f, y0, 1);
                mb.RectZ(sill, x0 - 0.06f, x1 + 0.06f, y0 - 0.07f, y0, 0.06f, 1);
            }
            else
            {
                mb.RectY(wall, x0, x1, -Recess, 0f, y0, 1);
            }
        }

        /// <summary>A storey of punched windows between y and y + height across a wall of width w.</summary>
        static void WindowRow(MeshBuilder mb, Palette p, Material wall, Material sill, float w, float y, float height, float bay, float fraction, float sillH, float headH, Rng random, List<Vector2> openings = null)
        {
            int bays = Mathf.Max(1, Mathf.RoundToInt(w / bay));
            float bw = w / bays;
            float ww = Mathf.Min(bw * fraction, bw - 0.5f);
            if (ww < 0.5f)
            {
                mb.RectZ(wall, 0f, w, y, y + height, 0f, 1);
                return;
            }
            float ys = y + sillH, yh = y + headH;
            mb.RectZ(wall, 0f, w, y, ys, 0f, 1);
            mb.RectZ(wall, 0f, w, yh, y + height, 0f, 1);
            float x = 0f;
            for (int i = 0; i < bays; i++)
            {
                float cx = (i + 0.5f) * bw;
                float x0 = cx - ww * 0.5f, x1 = cx + ww * 0.5f;
                mb.RectZ(wall, x, x0, ys, yh, 0f, 1);
                Window(mb, p, wall, sill, x0, x1, ys, yh, random);
                openings?.Add(new Vector2(x0, x1));
                x = x1;
            }
            mb.RectZ(wall, x, w, ys, yh, 0f, 1);
        }

        /// <summary>Shop fronts across the ground floor: glazed bays between piers, lit shops behind, a fascia above.</summary>
        static void ShopFronts(MeshBuilder mb, Palette p, Material wall, float w, float ground, bool awning)
        {
            const float glazeTop = 3.3f, riser = 0.45f, pier = 0.5f, depth = 0.25f;
            int bays = Mathf.Max(1, Mathf.RoundToInt(w / 4.5f));
            float bw = w / bays;
            mb.RectZ(wall, 0f, w, glazeTop, ground, 0f, 1);
            for (int i = 0; i < bays; i++)
            {
                float x0 = i * bw + pier * 0.5f, x1 = (i + 1) * bw - pier * 0.5f;
                mb.RectZ(wall, i * bw, x0, 0f, glazeTop, 0f, 1);
                mb.RectZ(wall, x1, (i + 1) * bw, 0f, glazeTop, 0f, 1);
                if (x1 - x0 < 0.6f)
                {
                    mb.RectZ(wall, x0, x1, 0f, glazeTop, 0f, 1);
                    continue;
                }
                mb.RectZ(wall, x0, x1, 0f, riser, 0f, 1);
                mb.RectX(wall, -depth, 0f, riser, glazeTop, x0, 1);
                mb.RectX(wall, -depth, 0f, riser, glazeTop, x1, -1);
                mb.RectY(wall, x0, x1, -depth, 0f, glazeTop, -1);
                mb.RectY(p.trim, x0, x1, -depth, 0f, riser, 1);
                mb.RectZ(p.shop, x0, x1, riser, glazeTop, -depth, 1);
                mb.Pane(p.m.ShopGlass, x0, x1, riser, glazeTop, -depth + 0.06f);
                Box5(mb, p.darkFrame, x0, glazeTop - 0.55f, -depth + 0.02f, x1, glazeTop - 0.5f, -depth + 0.1f);
            }
            if (awning) Box5(mb, p.awning, 0.2f, glazeTop + 0.05f, 0f, w - 0.2f, glazeTop + 0.2f, 1.3f);
            else Box5(mb, p.trim, -0.02f, ground - 0.1f, 0f, w + 0.02f, ground + 0.05f, 0.1f);
        }

        static void PunchedFacade(MeshBuilder mb, Palette p, BuildingPlan b, Material wall, float w, bool front, float top, Rng random)
        {
            float ground = Heights.Ground(b.Style), storey = Heights.Storey(b.Style);
            float bay, fraction, sillH, headH;
            switch (b.Style)
            {
                case BuildingStyle.Deco:
                    bay = 2.9f; fraction = 0.5f; sillH = 0.9f; headH = 2.45f;
                    break;
                case BuildingStyle.MiMo:
                    bay = 3.4f; fraction = 0.64f; sillH = 0.55f; headH = 2.6f;
                    break;
                case BuildingStyle.Lowrise:
                    bay = 4.2f; fraction = 0.55f; sillH = 1.0f; headH = 2.4f;
                    break;
                default:
                    bay = 3.2f; fraction = 0.55f; sillH = 0.85f; headH = 2.5f;
                    break;
            }
            Material sill = b.Style == BuildingStyle.Lowrise ? null : p.trim;

            // Ground floor.
            if (front && b.Style != BuildingStyle.Lowrise) ShopFronts(mb, p, wall, w, ground, b.Style == BuildingStyle.Deco && random.Next() < 0.6f);
            else if (front) LoadingFront(mb, p, wall, w, ground);
            else WindowRow(mb, p, wall, sill, w, 0f, ground, bay, fraction, 1.0f, ground - 1.2f, random);

            // Upper storeys.
            var openings = new List<Vector2>();
            for (int s = 1; s < b.Storeys; s++)
            {
                float y = ground + (s - 1) * storey;
                openings.Clear();
                WindowRow(mb, p, wall, sill, w, y, storey, bay, fraction, sillH, headH, random, openings);
                if (b.Style == BuildingStyle.Deco)
                {
                    foreach (Vector2 o in openings) Box5(mb, p.trim, o.x - 0.2f, y + headH + 0.16f, 0f, o.y + 0.2f, y + headH + 0.25f, 0.45f);
                    Box5(mb, p.trim, -0.02f, y - 0.06f, 0f, w + 0.02f, y + 0.04f, 0.06f);
                }
                else if (b.Style == BuildingStyle.MiMo)
                {
                    Balcony(mb, p, 0.15f, w - 0.15f, y);
                }
            }
            // Parapet (or the whole wall above the last storey).
            float wallTop = ground + (b.Storeys - 1) * storey;
            mb.RectZ(wall, 0f, w, wallTop, top, 0f, 1);
            if (b.Style != BuildingStyle.Lowrise) Box5(mb, p.trim, -0.03f, top - 0.12f, 0f, w + 0.03f, top, 0.12f);
        }

        /// <summary>Warehouse fronts: roller doors and a band of high windows.</summary>
        static void LoadingFront(MeshBuilder mb, Palette p, Material wall, float w, float ground)
        {
            int doors = Mathf.Max(1, Mathf.RoundToInt(w / 9f));
            float bw = w / doors;
            for (int i = 0; i < doors; i++)
            {
                float x0 = i * bw + bw * 0.2f, x1 = (i + 1) * bw - bw * 0.2f;
                mb.RectZ(wall, i * bw, x0, 0f, ground, 0f, 1);
                mb.RectZ(wall, x1, (i + 1) * bw, 0f, ground, 0f, 1);
                mb.RectZ(wall, x0, x1, 3.4f, ground, 0f, 1);
                mb.RectZ(p.door == null ? wall : p.m.Galvanised, x0, x1, 0f, 3.4f, -0.1f, 1);
                mb.RectX(wall, -0.1f, 0f, 0f, 3.4f, x0, 1);
                mb.RectX(wall, -0.1f, 0f, 0f, 3.4f, x1, -1);
                mb.RectY(wall, x0, x1, -0.1f, 0f, 3.4f, -1);
            }
        }

        static void Balcony(MeshBuilder mb, Palette p, float x0, float x1, float floorY)
        {
            const float depth = 1.3f;
            Box5(mb, p.trim, x0, floorY - 0.18f, 0f, x1, floorY, depth);
            // Rail: a solid painted balustrade, both faces.
            mb.RectZ(p.rail, x0, x1, floorY, floorY + 1.0f, depth - 0.02f, 1);
            mb.RectZ(p.rail, x0, x1, floorY, floorY + 1.0f, depth - 0.06f, -1);
            mb.RectY(p.rail, x0, x1, depth - 0.06f, depth - 0.02f, floorY + 1.0f, 1);
            mb.RectX(p.rail, 0f, depth, floorY, floorY + 1.0f, x0, -1);
            mb.RectX(p.rail, 0f, depth, floorY, floorY + 1.0f, x1, 1);
        }

        static void HouseFacade(MeshBuilder mb, Palette p, BuildingPlan b, Material wall, float w, bool front, float top, Rng random)
        {
            float storey = Heights.Storey(BuildingStyle.House);
            float ground = Heights.Ground(BuildingStyle.House);
            // Ground floor: on the front, a door in the middle between windows.
            if (front && w > 5f)
            {
                float d0 = w * 0.5f - 0.55f, d1 = w * 0.5f + 0.55f;
                const float doorH = 2.3f;
                mb.RectZ(wall, d0, d1, doorH, ground, 0f, 1);
                mb.RectX(wall, -0.2f, 0f, 0f, doorH, d0, 1);
                mb.RectX(wall, -0.2f, 0f, 0f, doorH, d1, -1);
                mb.RectY(wall, d0, d1, -0.2f, 0f, doorH, -1);
                mb.RectZ(p.door, d0, d1, 0f, doorH, -0.2f, 1);
                Box5(mb, p.trim, d0 - 0.4f, doorH + 0.15f, 0f, d1 + 0.4f, doorH + 0.25f, 0.8f);
                // Windows either side, as two narrower walls.
                SubRow(mb, p, wall, 0f, d0, 0f, ground, random);
                SubRow(mb, p, wall, d1, w, 0f, ground, random);
            }
            else
            {
                WindowRow(mb, p, wall, p.trim, w, 0f, ground, 3.0f, 0.42f, 0.9f, 2.3f, random);
            }
            for (int s = 1; s < b.Storeys; s++)
            {
                float y = ground + (s - 1) * storey;
                WindowRow(mb, p, wall, p.trim, w, y, storey, 3.0f, 0.42f, 0.9f, 2.25f, random);
            }
            float wallTop = ground + (b.Storeys - 1) * storey;
            if (top > wallTop) mb.RectZ(wall, 0f, w, wallTop, top, 0f, 1);
        }

        /// <summary>A row of windows across part of a wall (x0..x1), in the facade frame.</summary>
        static void SubRow(MeshBuilder mb, Palette p, Material wall, float x0, float x1, float y, float height, Rng random)
        {
            float w = x1 - x0;
            if (w <= 0.05f) return;
            if (w < 1.8f)
            {
                mb.RectZ(wall, x0, x1, y, y + height, 0f, 1);
                return;
            }
            float c = (x0 + x1) * 0.5f, hw = Mathf.Min(0.6f, w * 0.3f);
            float ys = y + 0.9f, yh = y + 2.3f;
            mb.RectZ(wall, x0, x1, y, ys, 0f, 1);
            mb.RectZ(wall, x0, x1, yh, y + height, 0f, 1);
            mb.RectZ(wall, x0, c - hw, ys, yh, 0f, 1);
            mb.RectZ(wall, c + hw, x1, ys, yh, 0f, 1);
            Window(mb, p, wall, p.trim, c - hw, c + hw, ys, yh, random);
        }

        static void CurtainWall(MeshBuilder mb, Palette p, BuildingPlan b, float w, float top, Rng random)
        {
            float ground = Heights.Ground(BuildingStyle.Tower), storey = Heights.Storey(BuildingStyle.Tower);
            // A solid strip at each end of the facade, so neighbouring facades meet at a closed corner.
            float e = Mathf.Min(0.3f, w * 0.1f);
            float x0 = e, x1 = w - e;
            // Lobby: tall glazing over a lit interior, recessed between the corner strips.
            mb.RectZ(p.spandrel, 0f, w, 0f, 0.3f, 0f, 1);
            mb.RectZ(p.spandrel, 0f, x0, 0.3f, ground - 0.4f, 0f, 1);
            mb.RectZ(p.spandrel, x1, w, 0.3f, ground - 0.4f, 0f, 1);
            mb.RectZ(p.shop, x0, x1, 0.3f, ground - 0.4f, -0.4f, 1);
            mb.RectZ(p.m.ShopGlass, x0, x1, 0.3f, ground - 0.4f, -0.05f, 1);
            mb.RectZ(p.spandrel, 0f, w, ground - 0.4f, ground, 0f, 1);
            mb.RectY(p.spandrel, x0, x1, -0.4f, 0f, 0.3f, 1);
            mb.RectY(p.spandrel, x0, x1, -0.4f, 0f, ground - 0.4f, -1);
            mb.RectX(p.spandrel, -0.4f, 0f, 0.3f, ground - 0.4f, x0, 1);
            mb.RectX(p.spandrel, -0.4f, 0f, 0.3f, ground - 0.4f, x1, -1);
            for (int s = 1; s < b.Storeys; s++)
            {
                float y = ground + (s - 1) * storey;
                mb.RectZ(p.spandrel, 0f, w, y, y + 0.95f, 0f, 1);
                mb.RectZ(p.spandrel, 0f, x0, y + 0.95f, y + storey, 0f, 1);
                mb.RectZ(p.spandrel, x1, w, y + 0.95f, y + storey, 0f, 1);
                mb.RectZ(random.Next() < 0.2f ? p.lit : p.m.RoomWall, x0, x1, y + 0.95f, y + storey, -0.12f, 1);
                mb.RectZ(p.m.TowerGlass, x0, x1, y + 0.95f, y + storey, -0.02f, 1);
                // The band's sill and head, closing the recess behind the glass.
                mb.RectY(p.spandrel, x0, x1, -0.12f, 0f, y + 0.95f, 1);
                mb.RectY(p.spandrel, x0, x1, -0.12f, 0f, y + storey, -1);
            }
            float wallTop = ground + (b.Storeys - 1) * storey;
            // The ends of the recessed bands, inside the corner strips.
            mb.RectX(p.spandrel, -0.12f, 0f, ground, wallTop, x0, 1);
            mb.RectX(p.spandrel, -0.12f, 0f, ground, wallTop, x1, -1);
            mb.RectZ(p.spandrel, 0f, w, wallTop, top, 0f, 1);
            // Mullions: fins the full height of the glazing.
            int modules = Mathf.Max(1, Mathf.RoundToInt(w / 3f));
            float mw = w / modules;
            for (int i = 1; i < modules; i++)
            {
                float x = i * mw;
                mb.RectZ(p.spandrel, x - 0.05f, x + 0.05f, ground, wallTop, 0.12f, 1);
                mb.RectX(p.spandrel, 0f, 0.12f, ground, wallTop, x - 0.05f, -1);
                mb.RectX(p.spandrel, 0f, 0.12f, ground, wallTop, x + 0.05f, 1);
            }
        }

        /// <summary>A flat roof over the footprint at height y (world).</summary>
        static void FlatRoof(MeshBuilder mb, Palette p, List<Vector2> f, float y)
        {
            var roof = new MeshData();
            SurfaceMesh.Polygon(roof, f, y);
            mb.AppendLocal(p.roof, roof);
        }

        /// <summary>A tiled hip roof over a four-sided footprint, with a 0.4 m overhang.</summary>
        static void HipRoof(MeshBuilder mb, Palette p, List<Vector2> f, float height)
        {
            Vector2 c = (f[0] + f[1] + f[2] + f[3]) * 0.25f;
            var e = new Vector2[4];
            for (int i = 0; i < 4; i++) e[i] = f[i] + RoadGraph.SafeNormal(f[i] - c) * 0.55f;
            float y0 = height + RoadWidths.KerbHeight;
            float wu = Vector2.Distance(e[0], e[1]), wv = Vector2.Distance(e[1], e[2]);
            bool alongU = wu >= wv;
            Vector2 axis = alongU ? RoadGraph.SafeNormal(e[1] - e[0]) : RoadGraph.SafeNormal(e[2] - e[1]);
            float longSide = Mathf.Max(wu, wv), shortSide = Mathf.Min(wu, wv);
            float ridgeHalf = Mathf.Max(0f, (longSide - shortSide) * 0.5f);
            float rise = shortSide * 0.5f * 0.55f;
            Vector2 r0 = c - axis * ridgeHalf, r1 = c + axis * ridgeHalf;
            Vector3 W(Vector2 v, float y) => new Vector3(v.x, y, v.y);
            // Eaves corners and the ridge: which ridge end is nearer each corner decides the faces.
            Vector3 R0 = W(r0, y0 + rise), R1 = W(r1, y0 + rise);
            for (int i = 0; i < 4; i++)
            {
                Vector2 a = e[i], b = e[(i + 1) % 4];
                Vector3 A = W(a, y0), B = W(b, y0);
                Vector3 ra = Vector2.Distance(a, r0) <= Vector2.Distance(a, r1) ? R0 : R1;
                Vector3 rb = Vector2.Distance(b, r0) <= Vector2.Distance(b, r1) ? R0 : R1;
                Vector3 n = Vector3.Cross(B - A, ra - A).normalized;
                if (n.y < 0f) n = -n;
                // A hip end (both corners meet the same ridge end) is a triangle: a quad with two corners together.
                mb.Quad(p.roofTiles, A, B, rb, ra, n);
                // Soffit under the overhang.
                Vector3 fa = W(f[i], y0), fb = W(f[(i + 1) % 4], y0);
                mb.Quad(p.trim, A, B, fb, fa, Vector3.down);
            }
        }

        /// <summary>Plant on the roof of towers and offices: a lift overrun and a couple of units.</summary>
        static void RoofPlant(MeshBuilder mb, Palette p, BuildingPlan b, Rng random)
        {
            List<Vector2> f = b.Footprint;
            Vector2 c = b.Centre;
            if (!Polygons.Contains(f, c) || Polygons.DistanceToEdges(f, c) < 3.5f) return;
            Vector2 p0 = f[b.Front], p1 = f[(b.Front + 1) % f.Count];
            Vector2 d = RoadGraph.SafeNormal(p1 - p0);
            float roofY = b.Height + RoadWidths.KerbHeight;
            float size = Mathf.Min(6f, Polygons.DistanceToEdges(f, c) * 0.9f);
            // Frame at the centre, facing the front's street.
            var outward = new Vector3(d.y, 0f, -d.x);
            mb.SetFrame(Matrix4x4.TRS(new Vector3(c.x, roofY, c.y), Quaternion.LookRotation(outward, Vector3.up), Vector3.one));
            float h = b.Style == BuildingStyle.Tower ? 4f : 2.6f;
            Material m = b.Style == BuildingStyle.Tower ? p.spandrel : p.Wall(b);
            Box5(mb, m, -size * 0.5f, 0f, -size * 0.5f, size * 0.5f, h, size * 0.5f);
            mb.RectZ(m, -size * 0.5f, size * 0.5f, 0f, h, -size * 0.5f, -1);
            if (size > 3f) Box5(mb, p.m.Galvanised, size * 0.5f + 0.5f, 0f, -1f, size * 0.5f + 2.2f, 1.4f, 0.6f);
            mb.SetFrame(Matrix4x4.identity);
        }

        /// <summary>The Art Deco fin: a stepped stucco tower rising above the parapet in the middle of the front.</summary>
        static void DecoFin(MeshBuilder mb, Palette p, BuildingPlan b, Material wall)
        {
            List<Vector2> f = b.Footprint;
            Vector2 p0 = f[b.Front], p1 = f[(b.Front + 1) % f.Count];
            float w = Vector2.Distance(p0, p1);
            if (w < 12f || b.Storeys < 3) return;
            SetFacadeFrame(mb, p0, p1);
            float top = b.Height + Parapet;
            float cx = w * 0.5f;
            Box5(mb, wall, cx - 1.6f, Heights.Ground(b.Style), -0.6f, cx + 1.6f, top + 1.6f, 0.25f);
            Box5(mb, p.trim, cx - 0.9f, top + 1.6f, -0.4f, cx + 0.9f, top + 3.2f, 0.15f);
            for (int k = -1; k <= 1; k++) Box5(mb, p.trim, cx + k * 0.7f - 0.08f, Heights.Ground(b.Style) + 1f, 0.25f, cx + k * 0.7f + 0.08f, top + 2.6f, 0.55f);
            mb.SetFrame(Matrix4x4.identity);
        }

        /// <summary>A plain prism of the footprint: what the player and cars collide with.</summary>
        static void Collision(MeshData m, List<Vector2> f, float top)
        {
            int n = f.Count;
            float y0 = RoadWidths.KerbHeight - 0.35f, y1 = RoadWidths.KerbHeight + top;
            for (int i = 0; i < n; i++)
            {
                Vector2 a = f[i], b = f[(i + 1) % n];
                var nrm = new Vector3(b.y - a.y, 0f, a.x - b.x).normalized;
                SurfaceMesh.Quad(m, new Vector3(a.x, y0, a.y), new Vector3(b.x, y0, b.y), new Vector3(b.x, y1, b.y), new Vector3(a.x, y1, a.y), nrm, Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero);
            }
            SurfaceMesh.Polygon(m, f, y1);
        }

        // ------------------------------------------------------------------ block contents

        static void BlockContents(CityBlock b, CityTiles tiles, Palette p, Rng random)
        {
            const float y = RoadWidths.KerbHeight;
            foreach (Vector2[] pool in b.Pools)
            {
                Vector2 c = (pool[0] + pool[2]) * 0.5f;
                SurfaceMesh.Polygon(tiles.Surface(c, "Pools", p.water, CityTiles.Layer.Ground), pool, y + 0.02f);
                MeshData coping = tiles.Surface(c, "Pool coping", p.m.Concrete);
                for (int i = 0; i < 4; i++)
                {
                    Vector2 a = pool[i], bb = pool[(i + 1) % 4];
                    // The footprint is counter-clockwise: outside is on the right.
                    SurfaceMesh.BoxAlong(coping, a, bb, 0.2f, 0.4f, y - 0.05f, y + 0.08f, 0.01f, 0.4f);
                }
            }
            if (b.Kind == BlockKind.Park)
            {
                MeshData paths = tiles.Surface(b.Centre, "Park paths", p.m.Pavement, CityTiles.Layer.Ground);
                foreach (Vector2[] path in b.Paths)
                {
                    Vector2 d = RoadGraph.SafeNormal(path[1] - path[0]);
                    Vector2 side = RoadGraph.Left(d) * 1.5f;
                    SurfaceMesh.GroundQuad(paths, path[0] - side, y + 0.012f, path[1] - side, y + 0.012f, path[1] + side, y + 0.012f, path[0] + side, y + 0.012f);
                }
                if (b.Paths.Count > 0) Fountain(b.Centre, tiles, p);
            }
        }

        /// <summary>A round plaza with a fountain basin and a tiered column in the middle of a park.</summary>
        static void Fountain(Vector2 c, CityTiles tiles, Palette p)
        {
            const float y = RoadWidths.KerbHeight;
            SurfaceMesh.Polygon(tiles.Surface(c, "Park paths", p.m.Pavement, CityTiles.Layer.Ground), Shapes.Circle(9f, 32).ConvertAll(v => v + c), y + 0.015f);
            var basin = new List<Vector2> { new Vector2(0f, -0.1f), new Vector2(5f, -0.1f), new Vector2(5f, 0.55f), new Vector2(4.6f, 0.6f), new Vector2(4.5f, 0.3f), new Vector2(0f, 0.3f) };
            MeshData stone = tiles.Surface(c, "Fountain", p.m.Granite);
            stone.Append(Shapes.Lathe(basin, 32).Translate(c.x, y, c.y));
            var column = new List<Vector2> { new Vector2(0f, 0.3f), new Vector2(0.6f, 0.3f), new Vector2(0.35f, 1.4f), new Vector2(1.6f, 1.5f), new Vector2(1.6f, 1.7f), new Vector2(0.25f, 1.8f), new Vector2(0.2f, 2.8f), new Vector2(0.8f, 2.9f), new Vector2(0.8f, 3.05f), new Vector2(0f, 3.1f) };
            stone.Append(Shapes.Lathe(column, 20).Translate(c.x, y, c.y));
            SurfaceMesh.Polygon(tiles.Surface(c, "Pools", p.water, CityTiles.Layer.Ground), Shapes.Circle(4.55f, 32).ConvertAll(v => v + c), y + 0.45f);
        }
    }
}
