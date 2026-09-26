using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar.City
{
    /// <summary>
    /// Street furniture placed from Layout (distances from the kerb face):
    ///   lamps     0.7 m back (poles clear the kerb by 0.45 m), every LampSpacing, the two sides
    ///             staggered by half a spacing; arms reach 2.3 m over the road
    ///   palms     in 1.4 m granite-edged tree pits, 1.0 m back, halfway between lamps
    ///   signals   mast-arm poles on the far side of the crossing for each direction (drive on the
    ///             right), 0.8 m back; heads over the lane centres 5.3 m up, facing the traffic;
    ///             pedestrian heads on the poles facing across the crosswalk
    ///   hydrants  0.6 m back, pumper outlet towards the road
    ///   covers    in the lanes on the road surface; drain grates in the gutters by the crossing
    ///   roadworks in the north parking lane: a taper of drums from the kerb out to the lane edge,
    ///             Jersey barriers, cones inside, a work sign ahead
    /// </summary>
    public static class StreetFurniture
    {
        /// <summary>Street lamps are off at golden hour; true for dusk.</summary>
        public static bool LampsOn = false;

        struct Placement
        {
            public float x, z, rot, lift;
            public float? y;

            public Placement(float x, float z, float rot = 0f, float lift = 0f, float? y = null)
            {
                this.x = x;
                this.z = z;
                this.rot = rot;
                this.lift = lift;
                this.y = y;
            }
        }

        public static GameObject Build(Transform parent, CityMaterials m, Rng random)
        {
            var root = new GameObject("Street furniture");
            root.transform.SetParent(parent, false);

            void Place(string name, Assembly part, Dictionary<string, Material> materials, IList<Placement> at)
            {
                if (at.Count == 0) return;
                Mesh mesh = part.Build(name);
                mesh.hideFlags = HideFlags.DontSave;
                var mats = new Material[part.Slots.Count];
                for (int i = 0; i < mats.Length; i++) mats[i] = materials[part.Slots[i]];
                var group = new GameObject(name);
                group.transform.SetParent(root.transform, false);
                for (int i = 0; i < at.Count; i++)
                {
                    Placement p = at[i];
                    var go = new GameObject(name + " " + (i + 1));
                    go.transform.SetParent(group.transform, false);
                    float y = p.y ?? Street.Height(p.x, p.z) + p.lift;
                    go.transform.SetPositionAndRotation(new Vector3(p.x, y, p.z), Quaternion.Euler(0f, p.rot * Mathf.Rad2Deg, 0f));
                    go.AddComponent<MeshFilter>().sharedMesh = mesh;
                    var r = go.AddComponent<MeshRenderer>();
                    r.sharedMaterials = mats;
                    r.shadowCastingMode = ShadowCastingMode.On;
                    go.isStatic = true;
                }
            }

            Material galv = m.Galvanised;
            Material lensOff = m.Painted(new Color(0.3f, 0.3f, 0.28f), 0.1f);
            Material orange = m.Painted(new Color(0.89f, 0.33f, 0.11f), 0.45f);
            Material white = m.Painted(new Color(0.86f, 0.86f, 0.84f), 0.3f);
            Material signalYellow = m.Painted(new Color(0.79f, 0.63f, 0.11f), 0.4f);
            Material black = m.Painted(new Color(0.105f, 0.11f, 0.115f), 0.45f);
            Material iron = m.Painted(new Color(0.17f, 0.165f, 0.16f), 0.55f);

            // Street lamps, staggered along both sides.
            var lamps = new List<Placement>();
            for (float x = Layout.CrossingX + 6.5f - Layout.LampSpacing * 4f; x < Layout.StreetHalfLength; x += Layout.LampSpacing)
            {
                if (x > -Layout.StreetHalfLength) lamps.Add(new Placement(x, Layout.KerbZ + 0.7f, Mathf.PI));
                float xs = x + Layout.LampSpacing / 2f;
                if (xs > -Layout.StreetHalfLength && xs < Layout.StreetHalfLength) lamps.Add(new Placement(xs, -Layout.KerbZ - 0.7f));
            }
            Place("Street lamps", FurnitureParts.StreetLamp(), new Dictionary<string, Material>
            {
                { "steel", galv },
                { "housing", m.Painted(new Color(0.55f, 0.57f, 0.57f), 0.35f) },
                { "lens", LampsOn ? m.Emissive(new Color(1f, 0.89f, 0.72f), 30000f) : lensOff },
            }, lamps);

            // Palms in tree pits, halfway between lamps (clear of the crossing).
            var palms = new List<Vector3>();
            foreach (Placement l in lamps)
            {
                float x = l.x + Layout.LampSpacing / 2f;
                float z = Mathf.Sign(l.z) * (Layout.KerbZ + 1.0f);
                if (Mathf.Abs(x) < Layout.StreetHalfLength - 2f && Mathf.Abs(x - Layout.CrossingX) > 4f) palms.Add(new Vector3(x, Street.Height(x, z), z));
            }
            Palms.Build(root.transform, palms, m, random);

            // Signals. Traffic heading +x uses the north lanes (z > 0): its pole stands on the north
            // pavement past the crossing and its arm reaches south over those lanes, the heads facing
            // -x towards the oncoming cars. The other direction mirrors it.
            float x0 = Layout.CrossingX - Layout.CrosswalkWidth / 2f;
            float x1 = Layout.CrossingX + Layout.CrosswalkWidth / 2f;
            float poleZ = Layout.KerbZ + 0.8f;
            float reach = poleZ - 0.6f;
            Place("Signal poles", FurnitureParts.SignalPole(reach), new Dictionary<string, Material> { { "steel", galv } }, new[]
            {
                new Placement(x1 + 1.2f, poleZ, Mathf.PI),
                new Placement(x0 - 1.2f, -poleZ),
            });
            float headY = Street.Height(0f, 0f) + 5.3f;
            var heads = new List<Placement>();
            foreach (float lane in new[] { 0.5f, 1.5f })
            {
                heads.Add(new Placement(x1 + 1.2f, lane * Layout.LaneWidth, Mathf.PI, 0f, headY));
                heads.Add(new Placement(x0 - 1.2f, -lane * Layout.LaneWidth, 0f, 0f, headY));
            }
            Place("Signal heads", FurnitureParts.SignalHead(), new Dictionary<string, Material>
            {
                { "housing", signalYellow },
                { "backplate", black },
                { "border", m.Painted(new Color(0.91f, 0.82f, 0.1f), 0.3f) },
                { "red", m.Emissive(new Color(1f, 0.16f, 0.08f), 8000f) },
                { "amber", lensOff },
                { "green", lensOff },
            }, heads);
            Place("Pedestrian heads", FurnitureParts.PedestrianHead(), new Dictionary<string, Material>
            {
                { "housing", black },
                { "face", m.Emissive(new Color(0.95f, 0.96f, 0.93f), 2500f) },
            }, new[]
            {
                new Placement(x1 + 1.2f, poleZ - 0.25f, Mathf.PI / 2f, 0f, Street.Height(x1, poleZ) + 2.8f),
                new Placement(x0 - 1.2f, -poleZ + 0.25f, -Mathf.PI / 2f, 0f, Street.Height(x0, -poleZ) + 2.8f),
            });

            // Hydrants (pumper outlet, local +z, towards the road), bins, pay stations and signs.
            Place("Hydrants", FurnitureParts.Hydrant(), new Dictionary<string, Material>
            {
                { "paint", m.Painted(new Color(0.85f, 0.67f, 0.12f), 0.45f) },
                { "caps", m.Painted(new Color(0.78f, 0.76f, 0.71f), 0.4f) },
            }, new[] { new Placement(4.5f, -Layout.KerbZ - 0.6f), new Placement(-33f, Layout.KerbZ + 0.6f, Mathf.PI) });
            Material binPaint = m.Painted(new Color(0.12f, 0.2f, 0.16f), 0.5f);
            Place("Litter bins", FurnitureParts.LitterBin(), new Dictionary<string, Material> { { "body", binPaint }, { "lid", binPaint } }, new[]
            {
                new Placement(x0 - 3.2f, -Layout.KerbZ - 0.9f),
                new Placement(x1 + 3.4f, Layout.KerbZ + 0.9f),
                new Placement(26f, Layout.KerbZ + 0.9f),
            });
            Place("Pay stations", FurnitureParts.PayStation(), new Dictionary<string, Material>
            {
                { "body", m.Painted(new Color(0.31f, 0.35f, 0.35f), 0.4f) },
                { "screen", m.Emissive(new Color(0.62f, 0.83f, 1f), 250f) },
            }, new[] { new Placement(12f, Layout.KerbZ + 0.75f, Mathf.PI), new Placement(-44f, -Layout.KerbZ - 0.75f) });
            Place("No-parking signs", FurnitureParts.SignPost(0.45f, 0.6f), new Dictionary<string, Material>
            {
                { "post", galv },
                { "face", white },
                { "border", m.Painted(new Color(0.7f, 0.09f, 0.11f), 0.35f) },
            }, new[]
            {
                new Placement(-3f, -Layout.KerbZ - 0.55f, Mathf.PI / 2f),
                new Placement(-24f, Layout.KerbZ + 0.55f, -Mathf.PI / 2f),
                new Placement(34f, -Layout.KerbZ - 0.55f, Mathf.PI / 2f),
            });

            // Drains in the gutters by the crossing, covers in the lanes.
            var ironOnly = new Dictionary<string, Material> { { "iron", iron } };
            Place("Drain grates", FurnitureParts.DrainGrate(), ironOnly, new[] { new Placement(x0 - 4f, -Layout.KerbZ + 0.26f, 0f, -0.012f), new Placement(x1 + 4f, Layout.KerbZ - 0.26f, 0f, -0.012f) });
            Place("Manhole covers", FurnitureParts.Cover(0.33f), ironOnly, new[]
            {
                new Placement(6f, 1.65f, 0f, -0.008f), new Placement(-31f, -4.95f, 0f, -0.008f),
                new Placement(-62f, 1.7f, 0f, -0.008f), new Placement(18f, -1.6f, 0f, -0.008f),
            });
            Place("Valve covers", FurnitureParts.Cover(0.12f), ironOnly, new[] { new Placement(2.5f, 5.2f, 0f, -0.006f), new Placement(-20f, -2.1f, 0f, -0.006f) });

            // Roadworks in the north parking lane, ahead of the crossing.
            float worksZ = Layout.ParkingZ + 0.35f;
            var barriers = new List<Placement>();
            for (int k = 0; k < 3; k++) barriers.Add(new Placement(-40f - k * 3.9f, worksZ, (random.Next() - 0.5f) * 0.02f));
            Place("Jersey barriers", FurnitureParts.JerseyBarrier(), new Dictionary<string, Material> { { "concrete", m.Concrete } }, barriers);
            var plastic = new Dictionary<string, Material> { { "rubber", m.Rubber }, { "orange", orange }, { "white", white } };
            var drums = new List<Placement>();
            for (int k = 0; k < 4; k++) drums.Add(new Placement(-33.5f + k * 3f, worksZ + k / 3f * (Layout.KerbZ - 0.6f - worksZ)));
            Place("Drums", FurnitureParts.Drum(), plastic, drums);
            Place("Cones", FurnitureParts.Cone(), plastic, new[]
            {
                new Placement(-44f, worksZ + 1.1f, 0.4f), new Placement(-47.5f, worksZ + 1.4f, 1.1f), new Placement(-51.6f, worksZ + 0.2f, 0.2f),
            });
            Place("Work sign", FurnitureParts.WorkSign(), new Dictionary<string, Material> { { "stand", galv }, { "face", orange }, { "border", black } }, new[]
            {
                new Placement(-27f, Layout.KerbZ - 0.55f, -Mathf.PI / 2f - 0.3f),
            });
            return root;
        }
    }
}
