using System;
using System.Collections.Generic;
using Solmar.City;
using UnityEngine;

namespace Solmar.Vehicles
{
    /// <summary>
    /// The one body builder shared by the drivable car (<see cref="VehicleBody"/>) and parked/traffic
    /// cars (<see cref="Solmar.City.Cars"/>): a smooth lofted hull with flared wheel arches, an inset
    /// glasshouse, a visible interior, detailed lamps, mirrors, handles, grille and badges, plus a few
    /// model-specific extras (a taxi's roof sign, a cruiser's light bar, a pickup's bed rails, a
    /// sports car's spoiler).
    ///
    /// Geometry is authored in the car's own local frame: x forward from the car's centre, y up from
    /// the ground under the tyres, z to the left (matching <see cref="Solmar.City.Cars"/>'s existing
    /// convention, since most of this loft comes from there). <see cref="BuildBody"/> takes a `frame`
    /// matrix applied to every piece as it's added, so a caller that needs a different local frame
    /// (the drivable car uses +z forward, +x left, to match <see cref="WheelCollider"/>) can pass a
    /// rotation instead of reframing all the maths. Wheels are built separately (see
    /// <see cref="BuildWheelMesh"/> and <see cref="AddWheels"/>) since one caller poses them
    /// individually on wheel colliders and the other bakes them, motionless, into the parked car's
    /// mesh.
    ///
    /// Material slots used by <see cref="BuildBody"/>: paint, skirt, glass, trim, lamp, lens,
    /// reflector, led, tail, grille, plate, mirror, badge, seat, dash, sign, lightRed, lightBlue.
    /// <see cref="AddWheels"/> additionally uses: tyre, rim, disc, caliper (also used, without
    /// caliper, by <see cref="BuildWheelMesh"/>'s own slots).
    /// </summary>
    public static class CarBuilder
    {
        // ---- Body shape, as functions of x (forward) ----

        /// <summary>
        /// A smoothed unit bump: 1 at `center`, easing to 0 over `halfBand` either side (a raised
        /// cosine). Used to lay a shallow crease or tuck into an otherwise flat panel.
        /// </summary>
        static float Bell(float t, float center, float halfBand)
        {
            if (halfBand <= 1e-5f) return 0f;
            float d = Mathf.Clamp01(Mathf.Abs(t - center) / halfBand);
            return 0.5f * (1f + Mathf.Cos(d * Mathf.PI));
        }

        /// <summary>Top of the lower body: bonnet, beltline and boot, flat but for a crisp curve right at the nose and tail.</summary>
        static float BodyTop(CarSpec s, float x)
        {
            if (x >= s.windscreen)
            {
                float t = Mathf.Clamp01((s.Front - x) / Mathf.Max(0.05f, s.Front - s.windscreen));
                return s.hood - 0.1f * (1f - Mathf.Pow(t, 0.3f));
            }
            if (x >= s.rearGlass) return Mathf.Lerp(s.deck, s.hood, (x - s.rearGlass) / Mathf.Max(0.05f, s.windscreen - s.rearGlass));
            float u = Mathf.Clamp01((x - s.Rear) / Mathf.Max(0.05f, s.rearGlass - s.Rear));
            return s.deck - 0.09f * (1f - Mathf.Pow(u, 0.3f));
        }

        /// <summary>Bottom of the body: sills, bumpers lifting at the ends, and the wheel arches.</summary>
        static float BodyBottom(CarSpec s, float x)
        {
            float front = Mathf.Clamp01((s.Front - x) / 0.4f);
            float rear = Mathf.Clamp01((x - s.Rear) / 0.4f);
            float y = s.sill + 0.16f * (1f - front) * (1f - front) + 0.12f * (1f - rear) * (1f - rear);
            float archRadius = s.wheelRadius + 0.09f;
            foreach (float axle in new[] { s.FrontAxle, s.RearAxle })
            {
                float dx = x - axle;
                if (Mathf.Abs(dx) < archRadius) y = Mathf.Max(y, s.wheelRadius + Mathf.Sqrt(Mathf.Max(0f, archRadius * archRadius - dx * dx)));
            }
            return Mathf.Min(y, BodyTop(s, x) - 0.1f);
        }

        /// <summary>Half the body's width at mid-height: flat along the sides, a crisp corner at the ends and a slight flare at each wheel arch.</summary>
        static float HalfWidth(CarSpec s, float x)
        {
            const float endBand = 0.32f;
            float distEnd = Mathf.Min(s.Front - x, x - s.Rear);
            float k = Mathf.Clamp01(distEnd / endBand);
            float corner = 1f - 0.22f * (1f - k) * (1f - k);
            float flare = 0f;
            foreach (float axle in new[] { s.FrontAxle, s.RearAxle })
            {
                flare = Mathf.Max(flare, s.archFlare * Bell(Mathf.Abs(x - axle), 0f, s.wheelRadius + 0.22f));
            }
            return s.width / 2f * corner + flare;
        }

        /// <summary>Top of the cabin: windscreen and rear glass curving into the roof.</summary>
        static float Roofline(CarSpec s, float x)
        {
            if (x > s.roofFront)
            {
                float t = (s.windscreen - x) / (s.windscreen - s.roofFront);
                return Mathf.Lerp(BodyTop(s, s.windscreen), s.roof, Mathf.Sin(Mathf.Clamp01(t) * Mathf.PI / 2f));
            }
            if (x < s.roofRear)
            {
                float t = (x - s.rearGlass) / (s.roofRear - s.rearGlass);
                return Mathf.Lerp(BodyTop(s, s.rearGlass), s.roof, Mathf.Sin(Mathf.Clamp01(t) * Mathf.PI / 2f));
            }
            // A very slight crown along the roof.
            float c = (x - s.roofRear) / (s.roofFront - s.roofRear);
            return s.roof + 0.008f * Mathf.Sin(c * Mathf.PI);
        }

        struct Section
        {
            public float x, y0, y1, halfWidth, halfWidthTop;

            public Section(float x, float y0, float y1, float halfWidth, float halfWidthTop)
            {
                this.x = x;
                this.y0 = y0;
                this.y1 = y1;
                this.halfWidth = halfWidth;
                this.halfWidthTop = halfWidthTop;
            }
        }

        static List<Section> Sample(float x0, float x1, float step, Func<float, Section> at)
        {
            int n = Mathf.Max(2, Mathf.CeilToInt((x1 - x0) / step));
            var list = new List<Section>(n + 1);
            for (int i = 0; i <= n; i++) list.Add(at(Mathf.Lerp(x0, x1, (float)i / n)));
            return list;
        }

        /// <summary>
        /// Lofts a closed surface through cross-sections along x. Each section is a superellipse
        /// (exponent p: 1 is a diamond, small values a rounded rectangle) between y0 and y1, whose
        /// half-width narrows from halfWidth at mid-height to halfWidthTop at the top. A shallow dip
        /// can be laid into the width at a given ring position (in cy, -1 bottom to 1 top): a tucked
        /// rocker at cy = -1, or a shoulder crease partway up. Normals are smooth; the ends are capped.
        /// UVs are in metres (x, and distance around the section).
        /// </summary>
        static MeshData Loft(List<Section> sections, float p, int ring = 36, float shoulderCy = -2f, float creaseDepth = 0f, float rockerDepth = 0f)
        {
            var m = new MeshData();
            int n = sections.Count;
            int stride = ring + 1;
            var pts = new Vector3[n * stride];
            for (int i = 0; i < n; i++)
            {
                Section s = sections[i];
                float mid = (s.y0 + s.y1) / 2f, half = (s.y1 - s.y0) / 2f;
                for (int k = 0; k <= ring; k++)
                {
                    // Start at the bottom, so the seam is underneath.
                    float ang = -Mathf.PI / 2f + (float)k / ring * Mathf.PI * 2f;
                    float c = Mathf.Cos(ang), sn = Mathf.Sin(ang);
                    float cz = Mathf.Sign(c) * Mathf.Pow(Mathf.Abs(c), p);
                    float cy = Mathf.Sign(sn) * Mathf.Pow(Mathf.Abs(sn), p);
                    float hw = cy > 0f ? Mathf.Lerp(s.halfWidth, s.halfWidthTop, cy) : s.halfWidth;
                    if (creaseDepth > 0f) hw *= 1f - creaseDepth / Mathf.Max(0.05f, s.halfWidth) * Bell(cy, shoulderCy, 0.12f);
                    if (rockerDepth > 0f) hw *= 1f - rockerDepth / Mathf.Max(0.05f, s.halfWidth) * Bell(cy, -1f, 0.35f);
                    pts[i * stride + k] = new Vector3(s.x, mid + cy * half, cz * hw);
                }
            }
            for (int i = 0; i < n; i++)
            {
                Section s = sections[i];
                var centre = new Vector3(s.x, (s.y0 + s.y1) / 2f, 0f);
                float around = 0f;
                for (int k = 0; k <= ring; k++)
                {
                    Vector3 pos = pts[i * stride + k];
                    int kPrev = k == 0 ? ring - 1 : k - 1;
                    int kNext = k == ring ? 1 : k + 1;
                    Vector3 alongRing = pts[i * stride + kNext] - pts[i * stride + kPrev];
                    Vector3 alongX = pts[Mathf.Min(n - 1, i + 1) * stride + k] - pts[Mathf.Max(0, i - 1) * stride + k];
                    Vector3 normal = Vector3.Cross(alongRing, alongX).normalized;
                    Vector3 outward = pos - centre;
                    if (Vector3.Dot(normal, outward) < 0f) normal = -normal;
                    if (normal == Vector3.zero) normal = outward.normalized;
                    if (k > 0) around += Vector3.Distance(pos, pts[i * stride + k - 1]);
                    m.AddVertex(pos, normal, new Vector2(pos.x, around));
                }
            }
            for (int i = 0; i < n - 1; i++)
            {
                for (int k = 0; k < ring; k++)
                {
                    int a = i * stride + k, b = (i + 1) * stride + k;
                    m.AddTriangle(a, b, a + 1);
                    m.AddTriangle(a + 1, b, b + 1);
                }
            }
            Shapes.FixWinding(m, 0, m.indices.Count);

            // End caps: flat fans facing -x at the rear and +x at the front.
            foreach (int i in new[] { 0, n - 1 })
            {
                var normal = new Vector3(i == 0 ? -1f : 1f, 0f, 0f);
                Section s = sections[i];
                int from = m.indices.Count;
                int centreIndex = m.AddVertex(new Vector3(s.x, (s.y0 + s.y1) / 2f, 0f), normal, new Vector2(0f, (s.y0 + s.y1) / 2f));
                int first = m.VertexCount;
                for (int k = 0; k <= ring; k++)
                {
                    Vector3 pos = pts[i * stride + k];
                    m.AddVertex(pos, normal, new Vector2(pos.z, pos.y));
                }
                for (int k = 0; k < ring; k++) m.AddTriangle(centreIndex, first + k, first + k + 1);
                Shapes.FixWinding(m, from, m.indices.Count);
            }
            return m;
        }

        static MeshData Box(float w, float h, float d, float c, float x, float y, float z)
        {
            return Shapes.ChamferBox(w, h, d, c).Translate(x, y, z);
        }

        /// <summary>A sloped glass panel from (baseX, baseY) to (topX, topY), with a thin dark surround.</summary>
        static void AddSlopedGlass(Action<string, MeshData> add, float baseX, float baseY, float topX, float topY, float width)
        {
            float dx = topX - baseX, dy = topY - baseY;
            float len = Mathf.Sqrt(Mathf.Max(1e-4f, dx * dx + dy * dy));
            float angle = Mathf.Atan2(dy, dx);
            float cx = (baseX + topX) / 2f, cy = (baseY + topY) / 2f;
            add("glass", Shapes.ChamferBox(len, 0.025f, width, 0.01f).RotateZ(angle).Translate(cx, cy, 0f));
            add("trim", Shapes.ChamferBox(len + 0.03f, 0.02f, width + 0.05f, 0.008f).RotateZ(angle).Translate(cx, cy, 0f));
        }

        /// <summary>Windscreen and rear glass as sloped panels, and per side an A/B/C-pillar frame with one or two door windows and a sill trim.</summary>
        static void AddGlasshouse(Action<string, MeshData> add, CarSpec s)
        {
            float beltline = BodyTop(s, (s.windscreen + s.rearGlass) / 2f);
            AddSlopedGlass(add, s.windscreen, BodyTop(s, s.windscreen), s.roofFront, s.roof, s.width * 0.82f);
            AddSlopedGlass(add, s.rearGlass, BodyTop(s, s.rearGlass), s.roofRear, s.roof, s.width * 0.8f);

            bool hasRearWindow = s.HasRearWindow;
            float bPillarX = s.BPillarX;
            float cabinHalf = s.width / 2f * 0.86f;
            float top = s.roof - 0.035f;
            float mid = (beltline + top) / 2f;
            float height = Mathf.Max(0.15f, top - beltline);

            foreach (int side in new[] { 1, -1 })
            {
                float z = side * cabinHalf;
                add("trim", Box(0.05f, height + 0.05f, 0.05f, 0.012f, s.windscreen, mid, z));
                add("trim", Box(0.06f, height + 0.05f, 0.05f, 0.012f, s.roofRear, mid, z));
                if (hasRearWindow)
                {
                    add("trim", Box(0.05f, height + 0.05f, 0.05f, 0.012f, bPillarX, mid, z));
                    float frontLen = s.windscreen - bPillarX - 0.1f;
                    float rearLen = bPillarX - s.roofRear - 0.1f;
                    add("glass", Box(Mathf.Max(0.1f, frontLen), height, 0.03f, 0.01f, (s.windscreen + bPillarX) / 2f, mid, z));
                    add("glass", Box(Mathf.Max(0.1f, rearLen), height, 0.03f, 0.01f, (bPillarX + s.roofRear) / 2f, mid, z));
                }
                else
                {
                    float len = s.windscreen - s.roofRear - 0.1f;
                    add("glass", Box(Mathf.Max(0.1f, len), height, 0.03f, 0.01f, (s.windscreen + s.roofRear) / 2f, mid, z));
                }
                // Window sill: a thin trim strip along the base of the glass.
                add("trim", Box(s.windscreen - s.roofRear, 0.02f, 0.03f, 0.006f, (s.windscreen + s.roofRear) / 2f, beltline + 0.005f, z));
            }
        }

        /// <summary>A simple cabin: a dashboard, two front seats and a steering wheel on its column, dimly visible through the glass.</summary>
        static void AddInterior(Action<string, MeshData> add, CarSpec s)
        {
            float floor = s.sill + 0.1f;
            float dashY = Mathf.Lerp(s.hood, s.roof, 0.3f);
            float dashX = s.windscreen - 0.12f;
            add("dash", Box(0.16f, 0.1f, s.width * 0.72f, 0.02f, dashX, dashY, 0f));

            float cabinHalf = s.width / 2f * 0.86f;
            float seatZ = cabinHalf * 0.52f;
            float seatX = s.windscreen - 0.6f;
            float seatBaseY = floor + 0.16f;
            float seatBackTopY = Mathf.Lerp(floor, s.roof, 0.6f);
            foreach (int side in new[] { 1, -1 })
            {
                float z = side * seatZ;
                add("seat", Box(0.44f, 0.14f, 0.4f, 0.03f, seatX, seatBaseY, z));
                add("seat", Box(0.1f, Mathf.Max(0.05f, seatBackTopY - seatBaseY), 0.38f, 0.03f, seatX - 0.19f, (seatBaseY + seatBackTopY) / 2f, z));
            }

            float wheelX = dashX + 0.2f;
            float wheelZ = seatZ * 0.85f;
            float wheelY = seatBaseY + 0.3f;
            MeshData ring = CarParts.SteeringWheelRing(0.15f, 0.016f, 16, 8).RotateX(1.05f).Translate(wheelX, wheelY, wheelZ);
            add("trim", ring);
            add("trim", Box(0.16f, 0.03f, 0.03f, 0.008f, wheelX - 0.08f, wheelY - 0.05f, wheelZ));
        }

        /// <summary>The dark cavity behind each wheel arch, so the tyre reads as sitting in a real wheel well rather than through a hole in the bodywork.</summary>
        static void AddArchLiners(Action<string, MeshData> add, CarSpec s)
        {
            float archRadius = s.wheelRadius + 0.09f;
            foreach (float axle in new[] { s.FrontAxle, s.RearAxle })
            {
                foreach (int side in new[] { 1, -1 })
                {
                    MeshData liner = CarParts.ArchLiner(archRadius - 0.015f, s.wheelWidth + 0.1f)
                        .Translate(axle, s.wheelRadius, side * s.Track);
                    add("tyre", liner); // reuses the dark rubber-like material
                }
            }
        }

        /// <summary>
        /// Builds one car's paint, glass, trim, lamps, interior and model-specific extras (not the
        /// wheels — see <see cref="AddWheels"/> and <see cref="BuildWheelMesh"/>), transformed by
        /// `frame` as each piece is added so a caller can reframe the whole car (e.g. into +z-forward
        /// for a WheelCollider rig) without touching the loft maths.
        /// </summary>
        public static Assembly BuildBody(CarSpec s, Matrix4x4 frame)
        {
            var a = new Assembly();
            void Add(string slot, MeshData m) => a.Add(slot, m.Transform(frame));

            // Lower body: a tucked rocker at the bottom, flat-ish flanks, and a shoulder crease just
            // below the beltline, instead of one smooth superellipse blob.
            float rockerDepth = 0.03f + Mathf.Max(0f, s.sill - 0.2f) * 0.3f;
            Add("paint", Loft(Sample(s.Rear, s.Front, 0.045f, x =>
            {
                float hw = HalfWidth(s, x);
                return new Section(x, BodyBottom(s, x), BodyTop(s, x), hw, hw * 0.94f);
            }), 0.24f, 28, shoulderCy: 0.62f, creaseDepth: 0.012f, rockerDepth: rockerDepth));

            // Painted roof panel over the flat top of the cabin.
            float cabinHalf = s.width / 2f * 0.86f;
            float roofHalf = cabinHalf * s.cabinTaper * 0.92f + 0.01f;
            Add("paint", Loft(Sample(s.roofRear - 0.06f, s.roofFront + 0.06f, 0.05f, x =>
            {
                float y = Roofline(s, x);
                return new Section(x, y - 0.05f, y + 0.012f, roofHalf, roofHalf * 0.9f);
            }), 0.3f, 22));

            AddGlasshouse(Add, s);
            AddArchLiners(Add, s);
            AddInterior(Add, s);

            float noseTop = BodyTop(s, s.Front);
            float tailTop = BodyTop(s, s.Rear);
            bool hasRearWindow = s.HasRearWindow;
            float bPillarX = s.BPillarX;
            foreach (int side in new[] { 1, -1 })
            {
                // Headlamp cluster: housing, a clear lens proud of it, an inner reflector glint and
                // (on most models) a slim LED strip above it.
                float lampZ = side * s.width * 0.32f;
                float lampX = s.Front - 0.09f;
                float lampY = noseTop - 0.05f;
                Add("lamp", Box(0.12f, 0.09f, 0.3f, 0.02f, lampX, lampY, lampZ));
                Add("lens", Box(0.03f, 0.075f, 0.26f, 0.012f, lampX + 0.075f, lampY, lampZ));
                Add("reflector", Box(0.04f, 0.05f, 0.16f, 0.01f, lampX - 0.02f, lampY + 0.005f, lampZ));
                if (s.ledStrip) Add("led", Box(0.1f, 0.014f, 0.24f, 0.004f, lampX + 0.05f, lampY + 0.075f, lampZ));

                // Tail lamp cluster: a dark housing set back, a red lens proud of it.
                float tailZ = side * s.width * 0.33f;
                float tailX = s.Rear + 0.07f;
                float tailY = tailTop - 0.09f;
                Add("trim", Box(0.1f, 0.14f, 0.4f, 0.02f, tailX - 0.02f, tailY, tailZ));
                Add("tail", Box(0.05f, 0.11f, 0.34f, 0.018f, tailX + 0.045f, tailY, tailZ));

                // Mirror on an arm.
                float mirrorX = s.windscreen - 0.1f;
                float mirrorBaseZ = side * (s.width / 2f - 0.01f);
                float mirrorHeadZ = side * (s.width / 2f + 0.1f);
                float armY = BodyTop(s, mirrorX) + 0.06f;
                Add("trim", Box(0.035f, 0.035f, Mathf.Abs(mirrorHeadZ - mirrorBaseZ) + 0.02f, 0.01f,
                    mirrorX, armY, (mirrorBaseZ + mirrorHeadZ) / 2f));
                Add("paint", Box(0.13f, 0.09f, 0.18f, 0.02f, mirrorX, armY + 0.06f, mirrorHeadZ));
                Add("trim", Box(0.11f, 0.07f, 0.15f, 0.015f, mirrorX + 0.012f, armY + 0.05f, mirrorHeadZ));

                // Door handles and shut lines (thin dark seams at the door edges).
                var handles = new List<float> { s.windscreen - 0.55f };
                if (hasRearWindow) handles.Add(bPillarX);
                foreach (float hx in handles)
                {
                    Add("trim", Box(0.15f, 0.025f, 0.02f, 0.006f, hx, BodyTop(s, hx) - 0.1f, side * HalfWidth(s, hx)));
                }
                float frontSeamX = s.windscreen - 0.05f;
                Add("trim", Box(0.015f, (BodyTop(s, frontSeamX) - BodyBottom(s, frontSeamX)) * 0.85f, 0.012f, 0.004f,
                    frontSeamX, (BodyTop(s, frontSeamX) + BodyBottom(s, frontSeamX)) / 2f, side * HalfWidth(s, frontSeamX)));
                if (hasRearWindow)
                {
                    float rearSeamX = s.roofRear + 0.05f;
                    Add("trim", Box(0.015f, (BodyTop(s, rearSeamX) - BodyBottom(s, rearSeamX)) * 0.85f, 0.012f, 0.004f,
                        rearSeamX, (BodyTop(s, rearSeamX) + BodyBottom(s, rearSeamX)) / 2f, side * HalfWidth(s, rearSeamX)));
                }

                // Side skirt: a darker cladding strip along the sill between the wheel arches.
                float skirtFrom = s.RearAxle + s.wheelRadius * 0.95f;
                float skirtTo = s.FrontAxle - s.wheelRadius * 0.95f;
                float skirtLen = Mathf.Max(0.2f, skirtTo - skirtFrom);
                float skirtX = (skirtFrom + skirtTo) / 2f;
                Add("skirt", Box(skirtLen, 0.06f, 0.02f, 0.008f, skirtX, BodyBottom(s, skirtX) + 0.02f, side * (HalfWidth(s, skirtX) - 0.004f)));
            }

            float bumperFront = BodyBottom(s, s.Front) + 0.06f;
            float bumperRear = BodyBottom(s, s.Rear) + 0.06f;
            Add("trim", Box(0.1f, 0.09f, s.width * 0.78f, 0.03f, s.Front - 0.04f, bumperFront, 0f));
            Add("trim", Box(0.1f, 0.09f, s.width * 0.78f, 0.03f, s.Rear + 0.04f, bumperRear, 0f));

            // Grille: a recessed backing panel with a few horizontal mesh bars, and a badge centred on it.
            float grilleX = s.Front - 0.09f;
            float grilleY0 = bumperFront + 0.05f, grilleY1 = noseTop - 0.06f;
            if (grilleY1 > grilleY0)
            {
                Add("trim", Box(0.06f, grilleY1 - grilleY0 + 0.03f, s.width * 0.4f, 0.015f, grilleX - 0.025f, (grilleY0 + grilleY1) / 2f, 0f));
                const int bars = 4;
                for (int bar = 0; bar < bars; bar++)
                {
                    float by = Mathf.Lerp(grilleY0, grilleY1, (bar + 0.5f) / bars);
                    Add("grille", Box(0.06f, 0.022f, s.width * 0.36f, 0.008f, grilleX, by, 0f));
                }
                Add("badge", Box(0.025f, 0.05f, 0.05f, 0.01f, s.Front - 0.015f, (grilleY0 + grilleY1) / 2f, 0f));
            }
            Add("trim", Box(0.02f, 0.19f, 0.34f, 0.008f, s.Rear + 0.005f, (bumperRear + tailTop) / 2f, 0f));
            Add("plate", Box(0.03f, 0.15f, 0.3f, 0.005f, s.Rear + 0.02f, (bumperRear + tailTop) / 2f, 0f));
            Add("badge", Box(0.02f, 0.04f, 0.04f, 0.008f, s.Rear + 0.012f, (bumperRear + tailTop) / 2f + 0.14f, 0f));

            // Exhaust tip(s), poking out from under the rear bumper: a pair for a sports car, one off to the side otherwise.
            float exY = BodyBottom(s, s.Rear) + 0.05f;
            if (s.sporty)
            {
                foreach (int side in new[] { 1, -1 })
                {
                    Add("rim", CarParts.ExhaustTip(0.036f, 0.12f).RotateZ(Mathf.PI / 2f).Translate(s.Rear + 0.15f, exY, side * s.width * 0.22f));
                }
            }
            else
            {
                Add("rim", CarParts.ExhaustTip(0.032f, 0.13f).RotateZ(Mathf.PI / 2f).Translate(s.Rear + 0.17f, exY, -s.width * 0.18f));
            }

            if (s.taxiSign)
            {
                float rx = (s.roofFront + s.roofRear) / 2f;
                Add("trim", Box(0.28f, 0.04f, 0.6f, 0.01f, rx, s.roof + 0.03f, 0f));
                Add("sign", Box(0.24f, 0.15f, 0.7f, 0.03f, rx, s.roof + 0.12f, 0f));
            }

            if (s.policeLights)
            {
                float barX = (s.roofFront + s.roofRear) / 2f;
                float barY = s.roof + 0.045f;
                Add("trim", Box(0.32f, 0.08f, 0.7f, 0.015f, barX, barY, 0f));
                Add("lightRed", Box(0.1f, 0.05f, 0.3f, 0.008f, barX - 0.09f, barY + 0.005f, 0.17f));
                Add("lightBlue", Box(0.1f, 0.05f, 0.3f, 0.008f, barX - 0.09f, barY + 0.005f, -0.17f));
                Add("lightBlue", Box(0.1f, 0.05f, 0.3f, 0.008f, barX + 0.09f, barY + 0.005f, 0.17f));
                Add("lightRed", Box(0.1f, 0.05f, 0.3f, 0.008f, barX + 0.09f, barY + 0.005f, -0.17f));
            }

            if (s.pickupBed)
            {
                // Car-space runs +x forward, so the cabin end of the bed (near roofRear) is a larger
                // x than the tail end (near Rear).
                float bedFront = s.roofRear - 0.06f;
                float bedRear = s.Rear + 0.12f;
                float railY = s.deck - 0.01f;
                if (bedFront > bedRear)
                {
                    float bedLen = bedFront - bedRear;
                    float bedMid = (bedFront + bedRear) / 2f;
                    foreach (int side in new[] { 1, -1 })
                    {
                        float z = side * (HalfWidth(s, bedMid) - 0.01f);
                        Add("trim", Box(bedLen, 0.035f, 0.03f, 0.01f, bedMid, railY, z));
                    }
                }
                Add("trim", Box(0.02f, 0.24f, s.width * 0.8f, 0.006f, s.Rear + 0.03f, (BodyBottom(s, s.Rear) + s.deck) / 2f, 0f));
            }

            if (s.sporty)
            {
                float spX = s.Rear + 0.32f;
                float spY = s.roof + 0.14f;
                foreach (int side in new[] { 1, -1 })
                {
                    Add("trim", Box(0.03f, 0.12f, 0.03f, 0.006f, spX, spY - 0.06f, side * s.width * 0.28f));
                }
                Add("paint", Box(0.22f, 0.025f, s.width * 0.62f, 0.008f, spX, spY, 0f));
            }

            return a;
        }

        // ---- Wheels ----

        /// <summary>A tyre with spin axis local x (the WheelCollider convention): tread, rounded shoulders and sidewalls down to the rim.</summary>
        public static MeshData Tyre(float r, float w)
        {
            float h = w / 2f;
            MeshData m = Shapes.Lathe(new List<Vector2>
            {
                new Vector2(r * 0.62f, -h), new Vector2(r * 0.9f, -h), new Vector2(r * 0.97f, -h + 0.02f),
                new Vector2(r, -h + 0.05f), new Vector2(r, h - 0.05f), new Vector2(r * 0.97f, h - 0.02f),
                new Vector2(r * 0.9f, h), new Vector2(r * 0.62f, h),
            }, 32);
            return m.RotateZ(Mathf.PI / 2f);
        }

        /// <summary>An eight-spoke rim, spin axis local x: barrel, a dish set back behind the spokes, and a hub.</summary>
        public static MeshData Rim(float r, float w)
        {
            float h = w / 2f;
            float rr = r * 0.63f;
            MeshData m = Shapes.Lathe(new List<Vector2>
            {
                new Vector2(rr, -h + 0.02f), new Vector2(rr, h - 0.005f), new Vector2(rr * 0.93f, h - 0.012f),
                new Vector2(rr * 0.86f, h - 0.07f), new Vector2(rr * 0.25f, h - 0.07f), new Vector2(rr * 0.22f, h - 0.02f),
                new Vector2(rr * 0.12f, h - 0.012f), new Vector2(0f, h - 0.012f),
            }, 28);
            const int spokes = 8;
            for (int k = 0; k < spokes; k++)
            {
                m.Append(Shapes.ChamferBox(rr * 0.72f, 0.032f, 0.05f, 0.007f).Translate(rr * 0.56f, h - 0.035f, 0f).RotateY(k * Mathf.PI * 2f / spokes));
            }
            return m.RotateZ(Mathf.PI / 2f);
        }

        /// <summary>A brake disc, spin axis local x, sized to sit just behind a rim of radius `r`.</summary>
        public static MeshData Disc(float r, float w)
        {
            return CarParts.BrakeDisc(r * 0.72f, w * 0.3f).RotateZ(Mathf.PI / 2f);
        }

        /// <summary>
        /// One shared wheel (tyre, rim and a brake disc — no caliper, since a caliper mustn't spin
        /// with the wheel and this mesh is reused, posed as a whole, for all four corners), spin axis
        /// local x, for a posable drivable car.
        /// </summary>
        public static Mesh BuildWheelMesh(CarSpec s, out string[] slots)
        {
            var a = new Assembly();
            a.Add("tyre", Tyre(s.wheelRadius, s.wheelWidth));
            a.Add("rim", Rim(s.wheelRadius, s.wheelWidth));
            a.Add("disc", Disc(s.wheelRadius, s.wheelWidth));
            Mesh mesh = a.Build(s.name + " wheel");
            slots = new string[a.Slots.Count];
            for (int i = 0; i < slots.Length; i++) slots[i] = a.Slots[i];
            return mesh;
        }

        /// <summary>Bakes all four wheels — tyre, rim, brake disc and caliper — into `a` at rest, in the car's own frame (reframed by `frame` like <see cref="BuildBody"/>), for a parked car.</summary>
        public static void AddWheels(Assembly a, CarSpec s, Matrix4x4 frame)
        {
            void Add(string slot, MeshData m) => a.Add(slot, m.Transform(frame));
            float discRadius = s.wheelRadius * 0.72f;
            foreach (float axle in new[] { s.FrontAxle, s.RearAxle })
            {
                foreach (int side in new[] { 1, -1 })
                {
                    var centre = new Vector3(axle, s.wheelRadius, side * s.Track);
                    MeshData ToCarSpace(MeshData m) => m.RotateY(-Mathf.PI / 2f).Translate(centre.x, centre.y, centre.z);
                    Add("tyre", ToCarSpace(Tyre(s.wheelRadius, s.wheelWidth)));
                    Add("rim", ToCarSpace(Rim(s.wheelRadius, s.wheelWidth)));
                    Add("disc", ToCarSpace(Disc(s.wheelRadius, s.wheelWidth)));
                    Add("caliper", Box(0.1f, 0.09f, s.wheelWidth * 0.55f, 0.012f,
                        axle + discRadius * 0.2f, s.wheelRadius + discRadius * 0.7f, side * s.Track));
                }
            }
        }
    }
}
