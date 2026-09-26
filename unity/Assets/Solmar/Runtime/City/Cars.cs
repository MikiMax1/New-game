using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar.City
{
    /// <summary>
    /// Parked cars in both parking lanes, modelled from real dimensions: a sedan, a hatchback, an
    /// SUV, a pickup and a taxi.
    ///
    /// Each body is lofted from cross-sections (rounded rectangles) sampled every few centimetres
    /// along the car, so the bonnet, the boot and the wheel arches are smooth curves. The cabin is a
    /// second loft in tinted glass that narrows towards the roof, capped by a painted roof panel.
    /// Wheels are lathed tyres with five-spoke rims. Local frame: x forward from the car's centre, y
    /// up from the ground under the tyres, z to the left.
    ///
    /// Cars park 0.22 m from the kerb, facing the traffic in their lane (drive on the right), with
    /// 0.9 to 2.2 m between bumpers and the odd empty space. They keep clear of the crossing, the
    /// hydrants, the roadworks and the no-parking zones, and each car sits on the road's crown and
    /// gutter by its four tyres.
    /// </summary>
    public static class Cars
    {
        sealed class Style
        {
            public string name;
            public float length, width;
            /// <summary>Bottom of the sills.</summary>
            public float sill = 0.2f;
            /// <summary>Top of the bonnet at the windscreen, and of the boot lid (or bed) at the rear glass.</summary>
            public float hood, deck;
            public float roof;
            /// <summary>x of the windscreen base, the roof's front and rear edges, and the rear glass base.</summary>
            public float windscreen, roofFront, roofRear, rearGlass;
            public float wheelRadius = 0.33f;
            public float wheelWidth = 0.225f;
            public float frontOverhang, wheelbase;
            /// <summary>Cabin width at the roof relative to the beltline.</summary>
            public float cabinTaper = 0.8f;
            public bool rearDoors = true;
            public bool taxiSign;

            public float Front => length / 2f;
            public float Rear => -length / 2f;
            public float FrontAxle => Front - frontOverhang;
            public float RearAxle => FrontAxle - wheelbase;
            /// <summary>z of the wheel centres (the tyres' outer walls 3 cm inside the body).</summary>
            public float Track => width / 2f - 0.03f - wheelWidth / 2f;
        }

        static readonly Style Sedan = new Style
        {
            name = "Sedan", length = 4.85f, width = 1.84f, hood = 0.92f, deck = 0.98f, roof = 1.44f,
            windscreen = 0.75f, roofFront = 0.05f, roofRear = -1.05f, rearGlass = -1.55f,
            frontOverhang = 0.95f, wheelbase = 2.85f,
        };

        static readonly Style Hatchback = new Style
        {
            name = "Hatchback", length = 4.25f, width = 1.79f, hood = 0.9f, deck = 1.0f, roof = 1.46f,
            windscreen = 0.95f, roofFront = 0.25f, roofRear = -1.55f, rearGlass = -1.95f,
            wheelRadius = 0.32f, wheelWidth = 0.205f, frontOverhang = 0.88f, wheelbase = 2.6f,
        };

        static readonly Style Suv = new Style
        {
            name = "SUV", length = 4.75f, width = 1.92f, sill = 0.32f, hood = 1.12f, deck = 1.18f, roof = 1.76f,
            windscreen = 0.95f, roofFront = 0.3f, roofRear = -1.95f, rearGlass = -2.15f,
            wheelRadius = 0.37f, wheelWidth = 0.245f, frontOverhang = 0.95f, wheelbase = 2.85f, cabinTaper = 0.84f,
        };

        static readonly Style Pickup = new Style
        {
            name = "Pickup", length = 5.8f, width = 2.0f, sill = 0.38f, hood = 1.2f, deck = 1.22f, roof = 1.9f,
            windscreen = 1.35f, roofFront = 0.7f, roofRear = -0.35f, rearGlass = -0.45f,
            wheelRadius = 0.39f, wheelWidth = 0.265f, frontOverhang = 1.0f, wheelbase = 3.6f, cabinTaper = 0.86f,
        };

        static readonly Style Taxi = new Style
        {
            name = "Taxi", length = 4.85f, width = 1.84f, hood = 0.92f, deck = 0.98f, roof = 1.44f,
            windscreen = 0.75f, roofFront = 0.05f, roofRear = -1.05f, rearGlass = -1.55f,
            frontOverhang = 0.95f, wheelbase = 2.85f, taxiSign = true,
        };

        // Kerb-side stretches with no parking, as x ranges, per side (+1 north, -1 south). They
        // follow StreetFurniture: the crossing with 6 m clear either side, the hydrants (4.5 m
        // either side), the roadworks in the north lane, the no-parking signs and the bus stop.
        static readonly float CrossingClearFrom = Layout.CrossingX - Layout.CrosswalkWidth / 2f - 6f;
        static readonly float CrossingClearTo = Layout.CrossingX + Layout.CrosswalkWidth / 2f + 6f;

        static List<Vector2> NoParking(int side)
        {
            var zones = new List<Vector2> { new Vector2(CrossingClearFrom, CrossingClearTo) };
            if (side > 0)
            {
                zones.Add(new Vector2(-56f, CrossingClearFrom)); // roadworks and the hydrant at -33
            }
            else
            {
                zones.Add(new Vector2(CrossingClearTo, -3f)); // no-parking sign at -3
                zones.Add(new Vector2(0f, 9f));               // hydrant at 4.5
                zones.Add(new Vector2(30f, 38f));             // loading zone at the sign at 34
                zones.Add(new Vector2(StreetDetails.BusStopFrom, StreetDetails.BusStopTo));
            }
            return zones;
        }

        public static GameObject Build(Transform parent, CityMaterials m, Rng random)
        {
            var root = new GameObject("Parked cars");
            root.transform.SetParent(parent, false);

            Style[] styles = { Sedan, Hatchback, Suv, Pickup, Taxi };
            float[] weights = { 0.33f, 0.2f, 0.3f, 0.1f, 0.07f };
            var meshes = new Dictionary<Style, (Mesh mesh, IReadOnlyList<string> slots)>();

            var shared = new Dictionary<string, Material>
            {
                { "glass", m.TintedGlass("Car glass", new Color(0.018f, 0.022f, 0.026f), 0.9f) },
                { "trim", m.Surface("Car trim", new Color(0.02f, 0.02f, 0.022f), 0.35f) },
                { "tyre", m.Rubber },
                { "rim", m.Surface("Car rim", new Color(0.55f, 0.56f, 0.58f), 0.75f, 1f) },
                { "lamp", m.Surface("Car headlamp", new Color(0.7f, 0.72f, 0.75f), 0.95f, 0.8f) },
                { "tail", m.Surface("Car tail lamp", new Color(0.3f, 0.008f, 0.006f), 0.92f, 0f, 1f) },
                { "plate", m.Surface("Car plate", new Color(0.72f, 0.72f, 0.7f), 0.5f) },
                { "sign", m.Surface("Taxi sign", new Color(0.8f, 0.78f, 0.7f), 0.6f) },
            };
            // Paint in linear: common colours, weighted towards white, silver, grey and black.
            (Color colour, float metallic)[] paints =
            {
                (new Color(0.78f, 0.78f, 0.76f), 0f), (new Color(0.78f, 0.78f, 0.76f), 0f),
                (new Color(0.72f, 0.7f, 0.64f), 0.2f), (new Color(0.52f, 0.53f, 0.54f), 0.7f),
                (new Color(0.52f, 0.53f, 0.54f), 0.7f), (new Color(0.12f, 0.13f, 0.14f), 0.5f),
                (new Color(0.012f, 0.012f, 0.014f), 0f), (new Color(0.012f, 0.012f, 0.014f), 0f),
                (new Color(0.02f, 0.05f, 0.14f), 0.5f), (new Color(0.36f, 0.02f, 0.02f), 0f),
                (new Color(0.42f, 0.36f, 0.26f), 0.6f), (new Color(0.05f, 0.2f, 0.2f), 0.3f),
            };
            Material taxiYellow = m.Surface("Car paint taxi", new Color(0.8f, 0.52f, 0.02f), 0.88f, 0f, 1f);

            int count = 0;
            foreach (int side in new[] { 1, -1 })
            {
                List<Vector2> zones = NoParking(side);
                float x = -Layout.StreetHalfLength + 4f + random.Range(0f, 3f);
                const float end = Layout.StreetHalfLength - 4f;
                while (x < end)
                {
                    // The odd empty space.
                    if (random.Next() < 0.15f)
                    {
                        x += random.Range(4f, 7f);
                        continue;
                    }
                    Style s = Pick(styles, weights, random);
                    float x1 = x + s.length;
                    if (x1 > end) break;
                    bool blocked = false;
                    foreach (Vector2 zone in zones)
                    {
                        if (x < zone.y && x1 > zone.x)
                        {
                            x = zone.y + random.Range(0.3f, 1.2f);
                            blocked = true;
                            break;
                        }
                    }
                    if (blocked) continue;

                    if (!meshes.TryGetValue(s, out var built))
                    {
                        Assembly a = Model(s);
                        Mesh mesh = a.Build(s.name);
                        mesh.hideFlags = HideFlags.DontSave;
                        built = (mesh, a.Slots);
                        meshes.Add(s, built);
                    }
                    Material paint;
                    if (s.taxiSign) paint = taxiYellow;
                    else
                    {
                        (Color colour, float metallic) p = paints[random.Range(0, paints.Length)];
                        paint = m.Surface("Car paint", p.colour, 0.88f, p.metallic, 1f);
                    }
                    var mats = new Material[built.slots.Count];
                    for (int i = 0; i < mats.Length; i++) mats[i] = built.slots[i] == "paint" ? paint : shared[built.slots[i]];

                    float cx = x + s.length / 2f;
                    float cz = side * (Layout.KerbZ - 0.22f - s.width / 2f - random.Range(0f, 0.12f));
                    float yaw = (side > 0 ? 0f : 180f) + random.Range(-0.8f, 0.8f);
                    var go = new GameObject(s.name + " " + (++count));
                    go.transform.SetParent(root.transform, false);
                    Settle(go.transform, s, new Vector3(cx, 0f, cz), yaw);
                    go.AddComponent<MeshFilter>().sharedMesh = built.mesh;
                    var r = go.AddComponent<MeshRenderer>();
                    r.sharedMaterials = mats;
                    r.shadowCastingMode = ShadowCastingMode.On;
                    go.isStatic = true;

                    x = x1 + random.Range(0.9f, 2.2f);
                }
            }
            return root;
        }

        static Style Pick(Style[] styles, float[] weights, Rng random)
        {
            float r = random.Next();
            for (int i = 0; i < styles.Length; i++)
            {
                if (r < weights[i]) return styles[i];
                r -= weights[i];
            }
            return styles[0];
        }

        /// <summary>Stands the car on its four tyres on the road surface: height, pitch and roll.</summary>
        static void Settle(Transform t, Style s, Vector3 centre, float yaw)
        {
            Quaternion heading = Quaternion.Euler(0f, yaw, 0f);
            float Ground(float lx, float lz)
            {
                Vector3 w = centre + heading * new Vector3(lx, 0f, lz);
                return Street.Height(w.x, w.z);
            }
            float fl = Ground(s.FrontAxle, s.Track), fr = Ground(s.FrontAxle, -s.Track);
            float rl = Ground(s.RearAxle, s.Track), rr = Ground(s.RearAxle, -s.Track);
            float pitch = Mathf.Atan2((fl + fr) - (rl + rr), 2f * s.wheelbase) * Mathf.Rad2Deg;
            // A positive turn about x lowers the +z (left) side.
            float roll = Mathf.Atan2((fr + rr) - (fl + rl), 4f * s.Track) * Mathf.Rad2Deg;
            centre.y = (fl + fr + rl + rr) / 4f;
            t.SetPositionAndRotation(centre, heading * Quaternion.Euler(roll, 0f, pitch));
        }

        // ---- Body shape, as functions of x ----

        /// <summary>Top of the lower body: bonnet, beltline and boot, with rounded nose and tail.</summary>
        static float BodyTop(Style s, float x)
        {
            if (x >= s.windscreen)
            {
                float t = (s.Front - x) / (s.Front - s.windscreen);
                float nose = s.hood - 0.13f;
                return nose + (s.hood - nose) * Mathf.Sqrt(Mathf.Clamp01(t));
            }
            if (x >= s.rearGlass) return Mathf.Lerp(s.deck, s.hood, (x - s.rearGlass) / (s.windscreen - s.rearGlass));
            float u = (x - s.Rear) / (s.rearGlass - s.Rear);
            float tail = s.deck - 0.11f;
            return tail + (s.deck - tail) * Mathf.Sqrt(Mathf.Clamp01(u));
        }

        /// <summary>Bottom of the body: sills, bumpers lifting at the ends, and the wheel arches.</summary>
        static float BodyBottom(Style s, float x)
        {
            float front = Mathf.Clamp01((s.Front - x) / 0.5f);
            float rear = Mathf.Clamp01((x - s.Rear) / 0.5f);
            float y = s.sill + 0.16f * (1f - front) * (1f - front) + 0.12f * (1f - rear) * (1f - rear);
            float archRadius = s.wheelRadius + 0.055f;
            foreach (float axle in new[] { s.FrontAxle, s.RearAxle })
            {
                float dx = x - axle;
                if (Mathf.Abs(dx) < archRadius) y = Mathf.Max(y, s.wheelRadius + Mathf.Sqrt(archRadius * archRadius - dx * dx));
            }
            return Mathf.Min(y, BodyTop(s, x) - 0.1f);
        }

        /// <summary>Half the body's width: full along the sides, rounding in at the corners.</summary>
        static float HalfWidth(Style s, float x)
        {
            float k = Mathf.Clamp01(Mathf.Min(s.Front - x, x - s.Rear) / 0.45f);
            return s.width / 2f * (0.86f + 0.14f * Mathf.Sqrt(k));
        }

        /// <summary>Top of the cabin: windscreen and rear glass curving into the roof.</summary>
        static float Roofline(Style s, float x)
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
            // A slight crown along the roof.
            float c = (x - s.roofRear) / (s.roofFront - s.roofRear);
            return s.roof + 0.015f * Mathf.Sin(c * Mathf.PI);
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

        static List<Section> Sample(float x0, float x1, float step, System.Func<float, Section> at)
        {
            int n = Mathf.Max(2, Mathf.CeilToInt((x1 - x0) / step));
            var list = new List<Section>(n + 1);
            for (int i = 0; i <= n; i++) list.Add(at(Mathf.Lerp(x0, x1, (float)i / n)));
            return list;
        }

        static Assembly Model(Style s)
        {
            var a = new Assembly();
            const float step = 0.03f;

            // Lower body.
            a.Add("paint", Loft(Sample(s.Rear, s.Front, step, x =>
            {
                float hw = HalfWidth(s, x);
                return new Section(x, BodyBottom(s, x), BodyTop(s, x), hw, hw * 0.94f);
            }), 0.38f));

            // Cabin glass, from just under the beltline, narrowing to the roof.
            float cabin = s.width / 2f * 0.89f;
            a.Add("glass", Loft(Sample(s.rearGlass, s.windscreen, step, x =>
                new Section(x, BodyTop(s, x) - 0.03f, Roofline(s, x), cabin, cabin * s.cabinTaper)), 0.34f));

            // Painted roof panel over the top of the cabin.
            float roofHalf = cabin * s.cabinTaper * 0.92f + 0.01f;
            a.Add("paint", Loft(Sample(s.roofRear - 0.06f, s.roofFront + 0.06f, step, x =>
            {
                float y = Roofline(s, x);
                return new Section(x, y - 0.05f, y + 0.012f, roofHalf, roofHalf * 0.9f);
            }), 0.3f));

            // Wheels: the outer faces towards ±z.
            foreach (float axle in new[] { s.FrontAxle, s.RearAxle })
            {
                foreach (int side in new[] { 1, -1 })
                {
                    Matrix4x4 place = Matrix4x4.TRS(new Vector3(axle, s.wheelRadius, side * s.Track), Quaternion.Euler(side * 90f, 0f, 0f), Vector3.one);
                    a.Add("tyre", Tyre(s.wheelRadius, s.wheelWidth).Transform(place));
                    a.Add("rim", Rim(s.wheelRadius, s.wheelWidth).Transform(place));
                }
            }

            // Lamps, bumpers, grille, the rear plate (Florida has none at the front), mirrors and handles.
            float noseTop = BodyTop(s, s.Front);
            float tailTop = BodyTop(s, s.Rear);
            foreach (int side in new[] { 1, -1 })
            {
                a.Add("lamp", Box(0.16f, 0.1f, 0.34f, 0.025f, s.Front - 0.1f, noseTop - 0.04f, side * s.width * 0.3f));
                a.Add("tail", Box(0.14f, 0.11f, 0.36f, 0.025f, s.Rear + 0.08f, tailTop - 0.08f, side * s.width * 0.31f));
                float mirrorX = s.windscreen - 0.1f;
                a.Add("paint", Box(0.13f, 0.1f, 0.2f, 0.025f, mirrorX, BodyTop(s, mirrorX) + 0.1f, side * (s.width / 2f + 0.07f)));
                a.Add("trim", Box(0.06f, 0.05f, 0.08f, 0.01f, mirrorX, BodyTop(s, mirrorX) + 0.04f, side * (s.width / 2f - 0.01f)));
                var handles = new List<float> { s.windscreen - 0.55f };
                if (s.rearDoors && s.roofRear < s.windscreen - 1.6f) handles.Add(s.windscreen - 1.5f);
                foreach (float hx in handles)
                {
                    a.Add("trim", Box(0.15f, 0.025f, 0.02f, 0.006f, hx, BodyTop(s, hx) - 0.1f, side * HalfWidth(s, hx)));
                }
            }
            float bumperFront = BodyBottom(s, s.Front) + 0.06f;
            float bumperRear = BodyBottom(s, s.Rear) + 0.06f;
            a.Add("trim", Box(0.1f, 0.09f, s.width * 0.78f, 0.03f, s.Front - 0.04f, bumperFront, 0f));
            a.Add("trim", Box(0.1f, 0.09f, s.width * 0.78f, 0.03f, s.Rear + 0.04f, bumperRear, 0f));
            a.Add("trim", Box(0.08f, 0.13f, s.width * 0.34f, 0.02f, s.Front - 0.04f, (bumperFront + noseTop) / 2f, 0f));
            a.Add("plate", Box(0.03f, 0.15f, 0.3f, 0.005f, s.Rear + 0.01f, (bumperRear + tailTop) / 2f, 0f));

            if (s.taxiSign)
            {
                float rx = (s.roofFront + s.roofRear) / 2f;
                a.Add("trim", Box(0.28f, 0.04f, 0.6f, 0.01f, rx, s.roof + 0.03f, 0f));
                a.Add("sign", Box(0.24f, 0.15f, 0.7f, 0.03f, rx, s.roof + 0.12f, 0f));
            }
            return a;
        }

        static MeshData Box(float w, float h, float d, float c, float x, float y, float z)
        {
            return Shapes.ChamferBox(w, h, d, c).Translate(x, y, z);
        }

        /// <summary>A tyre about y: tread, rounded shoulders and sidewalls down to the rim.</summary>
        static MeshData Tyre(float r, float w)
        {
            float h = w / 2f;
            return Shapes.Lathe(new List<Vector2>
            {
                new Vector2(r * 0.62f, -h), new Vector2(r * 0.9f, -h), new Vector2(r * 0.97f, -h + 0.02f),
                new Vector2(r, -h + 0.05f), new Vector2(r, h - 0.05f), new Vector2(r * 0.97f, h - 0.02f),
                new Vector2(r * 0.9f, h), new Vector2(r * 0.62f, h),
            }, 32);
        }

        /// <summary>A five-spoke rim about y, its face at +y: barrel, a dish set back behind the spokes, and a hub.</summary>
        static MeshData Rim(float r, float w)
        {
            float h = w / 2f;
            float rr = r * 0.63f;
            MeshData m = Shapes.Lathe(new List<Vector2>
            {
                new Vector2(rr, -h + 0.02f), new Vector2(rr, h - 0.005f), new Vector2(rr * 0.93f, h - 0.012f),
                new Vector2(rr * 0.86f, h - 0.07f), new Vector2(rr * 0.25f, h - 0.07f), new Vector2(rr * 0.22f, h - 0.02f),
                new Vector2(rr * 0.12f, h - 0.012f), new Vector2(0f, h - 0.012f),
            }, 28);
            for (int k = 0; k < 5; k++)
            {
                m.Append(Shapes.ChamferBox(rr * 0.72f, 0.04f, 0.055f, 0.008f).Translate(rr * 0.56f, h - 0.035f, 0f).RotateY(k * Mathf.PI * 2f / 5f));
            }
            return m;
        }

        /// <summary>
        /// Lofts a closed surface through cross-sections along x. Each section is a superellipse
        /// (exponent p: 1 is a diamond, small values a rounded rectangle) between y0 and y1, whose
        /// half-width narrows from halfWidth at mid-height to halfWidthTop at the top. Normals are
        /// smooth; the ends are capped. UVs are in metres (x, and distance around the section).
        /// </summary>
        static MeshData Loft(List<Section> sections, float p, int ring = 36)
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
                    float a = -Mathf.PI / 2f + (float)k / ring * Mathf.PI * 2f;
                    float c = Mathf.Cos(a), sn = Mathf.Sin(a);
                    float cz = Mathf.Sign(c) * Mathf.Pow(Mathf.Abs(c), p);
                    float cy = Mathf.Sign(sn) * Mathf.Pow(Mathf.Abs(sn), p);
                    float hw = cy > 0f ? Mathf.Lerp(s.halfWidth, s.halfWidthTop, cy) : s.halfWidth;
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
    }
}
