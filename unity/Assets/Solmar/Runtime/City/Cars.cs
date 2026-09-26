using System.Collections.Generic;
using Solmar.Rendering;
using Solmar.Vehicles;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar.City
{
    /// <summary>
    /// Parked cars in both parking lanes: all eight models from <see cref="CarModel"/>, built by the
    /// same lofted, model-driven <see cref="CarBuilder"/> the drivable car uses, with their tyres and
    /// brake discs baked in (motionless, since these never drive). Local frame: x forward from the
    /// car's centre, y up from the ground under the tyres, z to the left.
    ///
    /// Cars park 0.22 m from the kerb, facing the traffic in their lane (drive on the right), with
    /// 0.9 to 2.2 m between bumpers and the odd empty space. They keep clear of the crossing, the
    /// hydrants, the roadworks and the no-parking zones, and each car sits on the road's crown and
    /// gutter by its four tyres.
    /// </summary>
    public static class Cars
    {
        static readonly CarModel[] Models =
        {
            CarModel.Sedan, CarModel.Suv, CarModel.SportsCar, CarModel.Hatchback,
            CarModel.Pickup, CarModel.Van, CarModel.Taxi, CarModel.Police,
        };
        static readonly float[] Weights = { 0.27f, 0.22f, 0.05f, 0.19f, 0.09f, 0.06f, 0.08f, 0.04f };

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

            var meshes = new Dictionary<CarModel, (Mesh mesh, IReadOnlyList<string> slots)>();
            var specs = new Dictionary<CarModel, CarSpec>();

            var shared = new Dictionary<string, Material>
            {
                { "glass", m.TintedGlass("Car glass", new Color(0.018f, 0.022f, 0.026f), 0.9f) },
                { "trim", m.Surface("Car trim", new Color(0.02f, 0.02f, 0.022f), 0.35f) },
                { "tyre", m.Rubber },
                { "rim", m.Surface("Car rim", new Color(0.55f, 0.56f, 0.58f), 0.75f, 1f) },
                { "disc", m.Surface("Car brake disc", new Color(0.24f, 0.23f, 0.22f), 0.4f, 0.9f) },
                { "caliper", m.Surface("Car brake caliper", new Color(0.3f, 0.05f, 0.04f), 0.5f) },
                { "lamp", m.Surface("Car headlamp", new Color(0.7f, 0.72f, 0.75f), 0.95f, 0.8f) },
                { "lens", m.TintedGlass("Car headlamp lens", new Color(0.85f, 0.85f, 0.85f), 0.4f) },
                { "reflector", m.Surface("Car headlamp reflector", new Color(0.85f, 0.86f, 0.88f), 0.95f, 1f) },
                { "led", m.Surface("Car LED strip", new Color(0.55f, 0.6f, 0.65f), 0.5f) },
                { "tail", m.Surface("Car tail lamp", new Color(0.3f, 0.008f, 0.006f), 0.92f, 0f, 1f) },
                { "grille", m.Surface("Car grille", new Color(0.03f, 0.03f, 0.032f), 0.55f, 0.4f) },
                { "plate", m.Surface("Car plate", new Color(0.72f, 0.72f, 0.7f), 0.5f) },
                { "badge", m.Surface("Car badge", new Color(0.7f, 0.71f, 0.73f), 0.85f, 0.9f) },
                { "seat", m.Surface("Car seat", new Color(0.05f, 0.045f, 0.045f), 0.15f) },
                { "dash", m.Surface("Car dashboard", new Color(0.03f, 0.03f, 0.032f), 0.25f) },
                { "sign", m.Surface("Taxi sign", new Color(0.8f, 0.78f, 0.7f), 0.6f) },
                { "lightRed", m.Surface("Light bar red", new Color(0.35f, 0.04f, 0.03f), 0.6f) },
                { "lightBlue", m.Surface("Light bar blue", new Color(0.04f, 0.05f, 0.35f), 0.6f) },
            };
            Material taxiYellow = m.Surface("Car paint taxi", new Color(0.8f, 0.52f, 0.02f), 0.88f, 0f, 1f);
            Material taxiSkirt = m.Surface("Car skirt taxi", new Color(0.8f, 0.52f, 0.02f) * 0.32f, 0.35f);
            Material policeWhite = m.Surface("Car paint police", new Color(0.85f, 0.85f, 0.83f), 0.7f, 0f, 1f);
            Material policeSkirt = m.Surface("Car skirt police", new Color(0.05f, 0.05f, 0.06f), 0.35f);

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
                    CarModel model = Pick(Models, Weights, random);
                    if (!specs.TryGetValue(model, out CarSpec spec))
                    {
                        spec = CarModels.Get(model);
                        specs.Add(model, spec);
                    }
                    float x1 = x + spec.length;
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

                    if (!meshes.TryGetValue(model, out var built))
                    {
                        Assembly a = CarBuilder.BuildBody(spec, Matrix4x4.identity);
                        CarBuilder.AddWheels(a, spec, Matrix4x4.identity);
                        Mesh mesh = a.Build(spec.name);
                        mesh.hideFlags = HideFlags.DontSave;
                        built = (mesh, a.Slots);
                        meshes.Add(model, built);
                    }
                    Material paint, skirt;
                    if (spec.taxiSign) { paint = taxiYellow; skirt = taxiSkirt; }
                    else if (spec.policeLights) { paint = policeWhite; skirt = policeSkirt; }
                    else
                    {
                        Color colour = CarModels.RandomPaint(random, out float metallic);
                        paint = m.Surface("Car paint", colour, 0.88f, metallic, 1f);
                        // A subtly darker, matte tint of the paint for the lower cladding and trim.
                        skirt = m.Surface("Car skirt", colour * 0.32f, 0.35f);
                    }
                    var mats = new Material[built.slots.Count];
                    for (int i = 0; i < mats.Length; i++)
                    {
                        string slot = built.slots[i];
                        mats[i] = slot == "paint" ? paint : slot == "skirt" ? skirt : shared[slot];
                    }

                    float cx = x + spec.length / 2f;
                    float cz = side * (Layout.KerbZ - 0.22f - spec.width / 2f - random.Range(0f, 0.12f));
                    float yaw = (side > 0 ? 0f : 180f) + random.Range(-0.8f, 0.8f);
                    var go = new GameObject(spec.name + " " + (++count));
                    go.transform.SetParent(root.transform, false);
                    Settle(go.transform, spec, new Vector3(cx, 0f, cz), yaw);
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

        static CarModel Pick(CarModel[] models, float[] weights, Rng random)
        {
            float r = random.Next();
            for (int i = 0; i < models.Length; i++)
            {
                if (r < weights[i]) return models[i];
                r -= weights[i];
            }
            return models[0];
        }

        /// <summary>Stands the car on its four tyres on the road surface: height, pitch and roll.</summary>
        static void Settle(Transform t, CarSpec s, Vector3 centre, float yaw)
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
    }
}
