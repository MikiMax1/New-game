using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;

namespace Solmar.City
{
    /// <summary>
    /// Procedural buildings along both sides of the street.
    ///
    /// Each side is a row of buildings 9–34 m wide laid end to end along the building line from far
    /// down the street (x = -520) to behind the camera (x = +140). Within 110 m of the crossing they
    /// are modelled in full; beyond that, simpler blocks that only need to read through the haze.
    ///
    /// A building is described in its own frame: x along the facade from its left end (as seen
    /// from the street), y up from the pavement, z out of the facade towards the street, facade
    /// plane at z = 0. Its facade is a grid of bays × storeys: a 4.5 m ground floor (shop fronts)
    /// under 3.3 m upper storeys. Each upper-storey bay has a window opening with 15–25 cm reveals,
    /// a frame with mullions, a sill, and a room behind the glass (walls, floor, ceiling; some lit,
    /// some with blinds down). Styles:
    ///
    ///   Deco     Miami Art Deco: pastel stucco, eyebrow ledges over the windows, string courses, a
    ///            central tower of fins rising above a stepped parapet
    ///   MiMo     Miami Modern: cantilevered balconies with ship's-rail railings
    ///   Classic  older masonry style: moulded cornice, lintels with keystones, darker render
    ///   Glass    a curtain-wall tower: storey-high glazing between mullions, spandrel bands
    ///
    /// Everything goes into two MeshBuilders (detailed and distant): one mesh each with a submesh
    /// per material, so the whole street costs a draw call per material.
    /// </summary>
    public static class Buildings
    {
        enum Style { Deco, MiMo, Classic, Glass }

        sealed class Building
        {
            public int side;
            public float x;
            public float width;
            public float depth;
            public int storeys;
            public Style style;
            public Color tint;
            public int bays;
            public float seed;
            public bool detailed;
        }

        const float Ground = 4.5f;
        const float Storey = 3.3f;
        const float Parapet = 1.1f;
        const float RowStart = -520f;
        const float RowEnd = 140f;
        const float DetailRange = 110f;

        static readonly Dictionary<Style, string[]> Tints = new Dictionary<Style, string[]>
        {
            { Style.Deco, new[] { "#E9D8C4", "#E8C9C3", "#CFE0D6", "#F0E2B8", "#D8D2E6", "#F2ECE0" } },
            { Style.MiMo, new[] { "#ECE8DF", "#DFE3E2", "#F1E6D3" } },
            { Style.Classic, new[] { "#C9B49C", "#B89A82", "#D6C8B2", "#A88F7C" } },
            { Style.Glass, new[] { "#9AA4A6" } },
        };

        sealed class Palette
        {
            public CityMaterials m;
            public Material trim, frame, darkFrame, spandrel, rail, plant, roof, blind, panel, roomLit, shopRoom;
            public Material Wall(Color tint) => m.Stucco(tint);
        }

        public static GameObject Build(Transform parent, CityMaterials materials, Rng random)
        {
            var root = new GameObject("Buildings");
            root.transform.SetParent(parent, false);
            var p = new Palette
            {
                m = materials,
                trim = materials.Stucco(new Color(0.96f, 0.95f, 0.92f)),
                frame = materials.Painted(new Color(0.91f, 0.9f, 0.88f), 0.35f),
                darkFrame = materials.Painted(new Color(0.16f, 0.17f, 0.18f), 0.4f),
                spandrel = materials.Painted(new Color(0.23f, 0.27f, 0.28f), 0.3f),
                rail = materials.Painted(new Color(0.95f, 0.95f, 0.93f), 0.3f),
                plant = materials.Galvanised,
                roof = materials.Concrete,
                blind = materials.Stucco(new Color(0.9f, 0.88f, 0.84f)),
                panel = materials.Emissive(new Color(1f, 0.9f, 0.78f), 1400f),
                roomLit = materials.Emissive(new Color(1f, 0.78f, 0.55f), 35f),
                shopRoom = materials.Emissive(new Color(1f, 0.93f, 0.84f), 90f),
            };
            var detailed = new MeshBuilder("Buildings");
            var distant = new MeshBuilder("Distant buildings");
            foreach (int side in new[] { 1, -1 })
            {
                foreach (Building b in LayoutRow(side, random))
                {
                    MeshBuilder target = b.detailed ? detailed : distant;
                    target.SetFrame(FrameOf(b));
                    target.uvOffset = new Vector2(b.seed * 37.1f, b.seed * 11.7f);
                    if (b.detailed) BuildDetailed(target, b, p, random);
                    else BuildSimple(target, b, p);
                }
            }
            detailed.Build(root.transform);
            distant.Build(root.transform);
            return root;
        }

        /// <summary>Local → world: south buildings face +z as built; north ones are turned to face -z.</summary>
        static Matrix4x4 FrameOf(Building b)
        {
            float y = Street.PavementHeight(b.x, Layout.BuildingZ - Layout.KerbZ) - 0.02f;
            if (b.side < 0) return Matrix4x4.Translate(new Vector3(b.x, y, -Layout.BuildingZ));
            return Matrix4x4.TRS(new Vector3(b.x, y, Layout.BuildingZ), Quaternion.Euler(0f, 180f, 0f), Vector3.one);
        }

        static Color Hex(string hex)
        {
            ColorUtility.TryParseHtmlString(hex, out Color c);
            return c;
        }

        static List<Building> LayoutRow(int side, Rng random)
        {
            var list = new List<Building>();
            float x = RowStart;
            bool towerPlaced = false;
            float towerAt = side > 0 ? -70f : -46f;
            while (x < RowEnd)
            {
                bool near = Mathf.Abs(x - Layout.CrossingX) < DetailRange;
                float roll = random.Next();
                Style style = roll < 0.45f ? Style.Deco : roll < 0.7f ? Style.MiMo : Style.Classic;
                if (!towerPlaced && x > towerAt - 30f && x < towerAt)
                {
                    style = Style.Glass;
                    towerPlaced = true;
                }
                float width = style == Style.Glass ? 30f : Mathf.Round((9f + random.Next() * 22f) * 2f) / 2f;
                int storeys = style == Style.Glass ? 13 + (int)(random.Next() * 5) : style == Style.MiMo ? 5 + (int)(random.Next() * 5) : 2 + (int)(random.Next() * (style == Style.Deco ? 5 : 4));
                float bay = style == Style.Glass ? 1.5f : style == Style.MiMo ? 3.4f + random.Next() * 0.6f : 2.6f + random.Next() * 0.8f;
                string[] tints = Tints[style];
                list.Add(new Building
                {
                    side = side,
                    // North buildings are built towards -x from their local origin: start at the far end.
                    x = side > 0 ? x + width : x,
                    width = width,
                    depth = 18f,
                    storeys = storeys,
                    style = style,
                    tint = Hex(tints[(int)(random.Next() * tints.Length) % tints.Length]),
                    bays = Mathf.Max(2, Mathf.RoundToInt(width / bay)),
                    seed = random.Next(),
                    detailed = near,
                });
                // Mostly party walls; now and then a narrow service alley.
                x += width + (random.Next() < 0.12f ? 1.6f : 0f);
            }
            return list;
        }

        static void BuildDetailed(MeshBuilder mb, Building b, Palette p, Rng random)
        {
            float W = b.width;
            float top = Ground + b.storeys * Storey;
            Material wall = b.style == Style.Glass ? p.spandrel : p.Wall(b.tint);
            Material trim = b.style == Style.Classic ? p.Wall(b.tint) : p.trim;
            float bay = W / b.bays;

            // Plinth, a little proud of the wall and running below the pavement so there's no gap.
            mb.Box(trim, 0f, -0.4f, 0f, W, 0.5f, 0.06f, 0.01f, "ny");
            GroundFloor(mb, b, p, wall, trim, bay, random);
            if (b.style == Style.Glass) CurtainWall(mb, b, p, random);
            else UpperFloors(mb, b, p, wall, trim, bay, random);

            float parapetTop = top + Parapet;
            if (b.style != Style.Glass) mb.RectZ(wall, 0f, W, top, parapetTop, 0f, 1);
            mb.Box(trim, -0.05f, parapetTop, -0.25f, W + 0.05f, parapetTop + 0.12f, 0.08f, 0.015f);
            if (b.style == Style.Classic) Cornice(mb, trim, W, top);
            if (b.style == Style.Deco) DecoTower(mb, b, p, trim, bay, top);
            Material sideWall = b.style == Style.Glass ? p.spandrel : wall;
            mb.RectX(sideWall, -b.depth, 0f, -0.4f, parapetTop, 0f, -1);
            mb.RectX(sideWall, -b.depth, 0f, -0.4f, parapetTop, W, 1);
            mb.RectY(p.roof, 0f, W, -b.depth, 0f, top, 1);
            Rooftop(mb, b, p, top, random);
        }

        /// <summary>
        /// A room behind a window: back wall, side walls, floor and ceiling; lit rooms get a glowing
        /// ceiling panel and warm walls, and some windows have their blinds part-way down.
        /// </summary>
        static void Room(MeshBuilder mb, Palette p, float x0, float x1, float floorY, float ceilY, float glassZ, float depth, bool lit, bool shop, float blindFrom, float paneTop)
        {
            float rx0 = x0 - 0.5f, rx1 = x1 + 0.5f;
            float zb = glassZ - depth;
            Material wall = shop ? p.shopRoom : lit ? p.roomLit : p.m.RoomWall;
            mb.RectZ(wall, rx0, rx1, floorY, ceilY, zb, 1);
            mb.RectX(wall, zb, glassZ, floorY, ceilY, rx0, 1);
            mb.RectX(wall, zb, glassZ, floorY, ceilY, rx1, -1);
            mb.RectY(p.m.RoomFloor, rx0, rx1, zb, glassZ, floorY, 1);
            mb.RectY(p.m.RoomCeiling, rx0, rx1, zb, glassZ, ceilY, -1);
            if (lit || shop)
            {
                float cx = (rx0 + rx1) * 0.5f;
                mb.RectY(p.panel, cx - 0.3f, cx + 0.3f, zb * 0.5f + glassZ * 0.5f - 0.6f, zb * 0.5f + glassZ * 0.5f + 0.6f, ceilY - 0.01f, -1);
            }
            if (blindFrom < paneTop) mb.RectZ(p.blind, x0, x1, blindFrom, paneTop, glassZ - 0.05f, 1);
        }

        static void GroundFloor(MeshBuilder mb, Building b, Palette p, Material wall, Material trim, float bay, Rng random)
        {
            float W = b.width;
            const float pier = 0.45f;
            const float glazeTop = 3.3f;
            const float recess = 0.22f;
            int doorBay = (int)(random.Next() * b.bays) % b.bays;
            for (int i = 0; i < b.bays; i++)
            {
                float x0 = i * bay + pier / 2f;
                float x1 = (i + 1) * bay - pier / 2f;
                float riser = i == doorBay ? 0.02f : 0.5f;
                mb.RectZ(wall, i * bay, x0, 0.5f, Ground, 0f, 1);
                mb.RectZ(wall, x1, (i + 1) * bay, 0.5f, Ground, 0f, 1);
                mb.RectZ(wall, x0, x1, glazeTop, Ground, 0f, 1);
                mb.RectX(wall, -recess, 0f, riser, glazeTop, x0, 1);
                mb.RectX(wall, -recess, 0f, riser, glazeTop, x1, -1);
                mb.RectY(wall, x0, x1, -recess, 0f, glazeTop, -1);
                if (riser > 0.1f) mb.Box(trim, x0, 0.4f, -recess, x1, riser, 0.02f, 0.01f, "nz");
                else mb.RectY(trim, x0, x1, -recess, 0f, 0.02f, 1);
                float gz = -recess + 0.05f;
                mb.Pane(p.m.ShopGlass, x0, x1, riser, glazeTop, gz);
                FrameRect(mb, p.darkFrame, x0, x1, riser, glazeTop, gz, 0.06f);
                mb.Box(p.darkFrame, x0, glazeTop - 0.55f, gz - 0.03f, x1, glazeTop - 0.5f, gz + 0.04f, 0.005f);
                float mid = (x0 + x1) * 0.5f;
                if (i == doorBay || x1 - x0 > 3f) mb.Box(p.darkFrame, mid - 0.03f, riser, gz - 0.03f, mid + 0.03f, glazeTop - 0.55f, gz + 0.04f, 0.005f);
                Room(mb, p, x0, x1, 0.02f, 3.9f, gz - 0.01f, 5f + random.Next() * 3f, true, true, 99f, glazeTop);
            }
            mb.Box(trim, 0f, glazeTop + 0.2f, 0f, W, Ground - 0.25f, 0.12f, 0.015f);
            mb.Box(trim, -0.02f, Ground - 0.05f, 0f, W + 0.02f, Ground + 0.1f, 0.1f, 0.02f);
        }

        static void UpperFloors(MeshBuilder mb, Building b, Palette p, Material wall, Material trim, float bay, Rng random)
        {
            float recess = b.style == Style.Classic ? 0.25f : 0.18f;
            float winW = bay * (b.style == Style.MiMo ? 0.62f : 0.5f);
            float sill = b.style == Style.MiMo ? 0.55f : 0.9f;
            float head = b.style == Style.MiMo ? 2.55f : 2.45f;
            Material frame = b.style == Style.Classic ? p.darkFrame : p.frame;
            for (int s = 0; s < b.storeys; s++)
            {
                float floorY = Ground + s * Storey;
                float y0 = floorY + sill;
                float y1 = floorY + head;
                for (int i = 0; i < b.bays; i++)
                {
                    float cx = (i + 0.5f) * bay;
                    float x0 = cx - winW / 2f;
                    float x1 = cx + winW / 2f;
                    mb.RectZ(wall, i * bay, (i + 1) * bay, floorY, y0, 0f, 1);
                    mb.RectZ(wall, i * bay, (i + 1) * bay, y1, floorY + Storey, 0f, 1);
                    mb.RectZ(wall, i * bay, x0, y0, y1, 0f, 1);
                    mb.RectZ(wall, x1, (i + 1) * bay, y0, y1, 0f, 1);
                    mb.RectX(wall, -recess, 0f, y0, y1, x0, 1);
                    mb.RectX(wall, -recess, 0f, y0, y1, x1, -1);
                    mb.RectY(wall, x0, x1, -recess, 0f, y1, -1);
                    mb.RectY(wall, x0, x1, -recess, 0f, y0, 1);
                    float gz = -recess + 0.06f;
                    mb.Pane(p.m.WindowGlass, x0, x1, y0, y1, gz);
                    FrameRect(mb, frame, x0, x1, y0, y1, gz, 0.055f);
                    if (x1 - x0 > 1.3f) mb.Box(frame, cx - 0.025f, y0, gz - 0.025f, cx + 0.025f, y1, gz + 0.035f, 0.004f);
                    mb.Box(frame, x0, y1 - 0.5f, gz - 0.025f, x1, y1 - 0.45f, gz + 0.035f, 0.004f);
                    mb.Box(trim, x0 - 0.06f, y0 - 0.07f, -recess, x1 + 0.06f, y0, 0.07f, 0.012f);
                    bool lit = random.Next() < 0.18f;
                    float blind = random.Next() < 0.55f ? y1 - (y1 - y0) * random.Next() * 0.8f : 99f;
                    Room(mb, p, x0, x1, floorY + 0.05f, floorY + Storey - 0.35f, gz - 0.01f, 3f + random.Next() * 3f, lit, false, blind, y1);
                    if (b.style == Style.Deco)
                    {
                        // Eyebrow: a thin ledge over the window, the signature of Miami Deco.
                        mb.Box(trim, x0 - 0.18f, y1 + 0.18f, 0f, x1 + 0.18f, y1 + 0.26f, 0.5f, 0.02f);
                    }
                    else if (b.style == Style.Classic)
                    {
                        mb.Box(trim, x0 - 0.12f, y1, 0f, x1 + 0.12f, y1 + 0.22f, 0.05f, 0.01f);
                        mb.Box(trim, cx - 0.12f, y1 - 0.02f, 0f, cx + 0.12f, y1 + 0.28f, 0.08f, 0.01f);
                    }
                    else if (b.style == Style.MiMo && (i + s) % 2 == 0)
                    {
                        Balcony(mb, p, trim, i * bay + 0.25f, (i + 1) * bay - 0.25f, floorY);
                    }
                }
                if (b.style == Style.Deco) mb.Box(trim, -0.02f, floorY - 0.06f, 0f, b.width + 0.02f, floorY + 0.04f, 0.06f, 0.012f);
            }
        }

        static void CurtainWall(MeshBuilder mb, Building b, Palette p, Rng random)
        {
            float W = b.width;
            float module = W / b.bays;
            for (int s = 0; s < b.storeys; s++)
            {
                float y0 = Ground + s * Storey;
                mb.Box(p.spandrel, 0f, y0 - 0.1f, -0.05f, W, y0 + 0.75f, 0f, 0.005f, "nz");
                for (int i = 0; i < b.bays; i++)
                {
                    mb.Pane(p.m.TowerGlass, i * module, (i + 1) * module, y0 + 0.75f, y0 + Storey - 0.1f, -0.08f);
                }
                // Open-plan offices behind the glass: one long room per floor, some floors lit.
                Room(mb, p, 0.3f, W - 0.3f, y0 + 0.05f, y0 + Storey - 0.2f, -0.1f, 8f, random.Next() < 0.3f, false, 99f, 0f);
            }
            float top = Ground + b.storeys * Storey;
            for (int i = 0; i <= b.bays; i++)
            {
                float x = i * module;
                mb.Box(p.spandrel, x - 0.04f, Ground - 0.1f, -0.08f, x + 0.04f, top + Parapet, 0.14f, 0.008f);
            }
            mb.Box(p.spandrel, 0f, top - 0.1f, -0.05f, W, top + Parapet, 0.02f, 0.01f);
        }

        static void Balcony(MeshBuilder mb, Palette p, Material trim, float x0, float x1, float floorY)
        {
            const float depth = 1.25f;
            mb.Box(trim, x0, floorY - 0.18f, 0f, x1, floorY, depth, 0.02f);
            foreach (float h in new[] { 0.35f, 0.65f, 1.0f })
            {
                mb.Box(p.rail, x0 + 0.05f, floorY + h - 0.02f, depth - 0.07f, x1 - 0.05f, floorY + h + 0.02f, depth - 0.03f, 0.006f);
            }
            foreach (float x in new[] { x0 + 0.07f, x1 - 0.07f })
            {
                mb.Box(p.rail, x - 0.025f, floorY, depth - 0.08f, x + 0.025f, floorY + 1.02f, depth - 0.02f, 0.006f);
                foreach (float h in new[] { 0.35f, 0.65f, 1.0f })
                {
                    mb.Box(p.rail, x - 0.02f, floorY + h - 0.02f, 0.05f, x + 0.02f, floorY + h + 0.02f, depth - 0.03f, 0.006f);
                }
            }
        }

        static void Cornice(MeshBuilder mb, Material trim, float W, float top)
        {
            float y = top - 0.35f;
            var profile = new List<Vector2>
            {
                new Vector2(0f, y), new Vector2(0.08f, y), new Vector2(0.08f, y + 0.08f), new Vector2(0.14f, y + 0.12f),
                new Vector2(0.2f, y + 0.2f), new Vector2(0.3f, y + 0.26f), new Vector2(0.42f, y + 0.3f),
                new Vector2(0.45f, y + 0.36f), new Vector2(0.45f, y + 0.42f), new Vector2(0f, y + 0.42f),
            };
            mb.SweepX(trim, profile, -0.3f, W + 0.3f);
        }

        static void DecoTower(MeshBuilder mb, Building b, Palette p, Material trim, float bay, float top)
        {
            int mid = b.bays / 2;
            float x0 = mid * bay;
            float x1 = x0 + bay;
            const float rise = 2.4f;
            mb.Box(p.Wall(b.tint), x0 - 0.4f, top, -0.3f, x1 + 0.4f, top + Parapet + rise * 0.5f, 0.1f, 0.02f);
            mb.Box(p.Wall(b.tint), x0 + 0.1f, top, -0.3f, x1 - 0.1f, top + Parapet + rise, 0.14f, 0.02f);
            for (int k = 0; k < 3; k++)
            {
                float x = x0 + bay * (0.25f + k * 0.25f);
                mb.Box(trim, x - 0.07f, Ground + Storey, 0f, x + 0.07f, top + Parapet + rise + 0.6f, 0.38f, 0.02f);
            }
        }

        static void Rooftop(MeshBuilder mb, Building b, Palette p, float top, Rng random)
        {
            int units = (int)(b.width / 7f);
            for (int k = 0; k < units; k++)
            {
                float x = 2f + random.Next() * (b.width - 5f);
                float z = -3f - random.Next() * (b.depth - 6f);
                float w = 1.2f + random.Next() * 1.4f;
                mb.Box(p.plant, x, top, z, x + w, top + 1.1f + random.Next() * 0.6f, z + 1.1f, 0.02f);
            }
            if (random.Next() < 0.6f)
            {
                float bx = b.width * (0.2f + random.Next() * 0.5f);
                mb.Box(p.Wall(b.tint), bx, top, -b.depth + 2f, bx + 3.2f, top + 2.8f, -b.depth + 5.4f, 0.02f);
            }
            if (b.style != Style.Glass && random.Next() < 0.35f)
            {
                // Water tank on steel legs.
                float tx = b.width * (0.3f + random.Next() * 0.4f);
                float tz = -b.depth * 0.5f;
                var ring = new List<Vector2>();
                for (int k = 0; k < 16; k++)
                {
                    float a = k / 16f * Mathf.PI * 2f;
                    ring.Add(new Vector2(tx + Mathf.Cos(a) * 1.4f, tz + Mathf.Sin(a) * 1.4f));
                }
                mb.PrismY(p.plant, ring, top + 2.2f, top + 5.2f, true, true);
                foreach (Vector2 d in new[] { new Vector2(-1, -1), new Vector2(1, -1), new Vector2(1, 1), new Vector2(-1, 1) })
                {
                    mb.Box(p.darkFrame, tx + d.x * 0.9f - 0.06f, top, tz + d.y * 0.9f - 0.06f, tx + d.x * 0.9f + 0.06f, top + 2.25f, tz + d.y * 0.9f + 0.06f, 0.01f);
                }
            }
        }

        static void FrameRect(MeshBuilder mb, Material m, float x0, float x1, float y0, float y1, float z, float t)
        {
            mb.Box(m, x0, y0, z - 0.03f, x0 + t, y1, z + 0.04f, 0.004f);
            mb.Box(m, x1 - t, y0, z - 0.03f, x1, y1, z + 0.04f, 0.004f);
            mb.Box(m, x0 + t, y0, z - 0.03f, x1 - t, y0 + t, z + 0.04f, 0.004f);
            mb.Box(m, x0 + t, y1 - t, z - 0.03f, x1 - t, y1, z + 0.04f, 0.004f);
        }

        /// <summary>A distant building: the mass, flush windows, a coping; it only has to read through haze.</summary>
        static void BuildSimple(MeshBuilder mb, Building b, Palette p)
        {
            float W = b.width;
            float top = Ground + b.storeys * Storey;
            Material wall = b.style == Style.Glass ? p.spandrel : p.Wall(b.tint);
            float bay = W / b.bays;
            mb.RectZ(wall, 0f, W, -0.4f, Ground, 0f, 1);
            mb.Pane(p.m.ShopGlass, 0.4f, W - 0.4f, 0.5f, 3.3f, 0.01f);
            for (int s = 0; s < b.storeys; s++)
            {
                float y0 = Ground + s * Storey;
                mb.RectZ(wall, 0f, W, y0, y0 + Storey, 0f, 1);
                for (int i = 0; i < b.bays; i++)
                {
                    Material glass = b.style == Style.Glass ? p.m.TowerGlass : p.m.WindowGlass;
                    float ww = b.style == Style.Glass ? bay : bay * 0.5f;
                    float cx = (i + 0.5f) * bay;
                    // Flush glass over a dark backing: a window with nothing to see through to.
                    mb.RectZ(p.m.RoomWall, cx - ww / 2f, cx + ww / 2f, y0 + 0.9f, y0 + 2.45f, 0.005f, 1);
                    mb.Pane(glass, cx - ww / 2f, cx + ww / 2f, y0 + 0.9f, y0 + 2.45f, 0.01f);
                }
            }
            mb.RectZ(wall, 0f, W, top, top + Parapet, 0f, 1);
            mb.Box(p.trim, -0.05f, top + Parapet, -0.25f, W + 0.05f, top + Parapet + 0.12f, 0.08f, 0.015f);
            mb.RectX(wall, -b.depth, 0f, -0.4f, top + Parapet, 0f, -1);
            mb.RectX(wall, -b.depth, 0f, -0.4f, top + Parapet, W, 1);
        }
    }
}
