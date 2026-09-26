using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar.City
{
    /// <summary>
    /// The smaller things on the pavements, placed clear of the lamps, palms, hydrants and signs
    /// (see StreetFurniture): a bus shelter with its stop sign on the south side (the parked cars
    /// leave its bay free), benches, bollards at the crossing's kerb ramps, a row of newspaper boxes
    /// and a bike rack. Local frames face +z; a rotation of pi turns them round.
    /// </summary>
    public static class StreetDetails
    {
        /// <summary>The bus stop's kerb bay on the south side (x range); Cars keeps it free.</summary>
        public const float BusStopFrom = 45.5f;
        public const float BusStopTo = 56f;
        const float ShelterX = 51f;

        static List<Vector2> P(params float[] v)
        {
            var list = new List<Vector2>(v.Length / 2);
            for (int i = 0; i < v.Length; i += 2) list.Add(new Vector2(v[i], v[i + 1]));
            return list;
        }

        static MeshData Box(float w, float h, float d, float c, float x, float y, float z)
        {
            return Shapes.ChamferBox(w, h, d, c).Translate(x, y, z);
        }

        public static GameObject Build(Transform parent, CityMaterials m)
        {
            var root = new GameObject("Street details");
            root.transform.SetParent(parent, false);

            void Place(string name, Assembly part, Dictionary<string, Material> materials, params Vector3[] at)
            {
                Mesh mesh = part.Build(name);
                mesh.hideFlags = HideFlags.DontSave;
                var mats = new Material[part.Slots.Count];
                for (int i = 0; i < mats.Length; i++) mats[i] = materials[part.Slots[i]];
                var group = new GameObject(name);
                group.transform.SetParent(root.transform, false);
                for (int i = 0; i < at.Length; i++)
                {
                    // x, z and the rotation about y (radians) in the Vector3's z.
                    float x = at[i].x, z = at[i].y;
                    var go = new GameObject(name + " " + (i + 1));
                    go.transform.SetParent(group.transform, false);
                    go.transform.SetPositionAndRotation(new Vector3(x, Street.Height(x, z), z), Quaternion.Euler(0f, at[i].z * Mathf.Rad2Deg, 0f));
                    go.AddComponent<MeshFilter>().sharedMesh = mesh;
                    var r = go.AddComponent<MeshRenderer>();
                    r.sharedMaterials = mats;
                    r.shadowCastingMode = ShadowCastingMode.On;
                    go.isStatic = true;
                }
            }

            Material galv = m.Galvanised;
            Material iron = m.Painted(new Color(0.08f, 0.085f, 0.08f), 0.5f);
            Material wood = m.Surface("Bench wood", new Color(0.19f, 0.105f, 0.055f), 0.3f);
            float kerb = Layout.KerbZ;

            // Bus shelter on the south pavement, open towards the road (+z), and the stop sign by the kerb.
            Place("Bus shelter", Shelter(), new Dictionary<string, Material>
            {
                { "frame", galv },
                { "roof", m.Painted(new Color(0.2f, 0.22f, 0.23f), 0.45f) },
                { "glass", m.TintedGlass("Shelter glass", new Color(0.45f, 0.5f, 0.5f), 0.22f) },
                { "advert", m.Emissive(new Color(0.96f, 0.93f, 0.85f), 450f) },
                { "iron", iron },
                { "wood", wood },
            }, new Vector3(ShelterX, -kerb - 2.35f, 0f));
            Place("Bus stop sign", FurnitureParts.SignPost(0.45f, 0.6f), new Dictionary<string, Material>
            {
                { "post", galv },
                { "face", m.Painted(new Color(0.07f, 0.3f, 0.62f), 0.35f) },
                { "border", m.Painted(new Color(0.86f, 0.86f, 0.84f), 0.3f) },
            }, new Vector3(BusStopFrom + 1f, -kerb - 0.55f, Mathf.PI / 2f));

            // Benches by the building line, facing the road.
            Place("Benches", Bench(), new Dictionary<string, Material> { { "iron", iron }, { "wood", wood } },
                new Vector3(-1f, Layout.BuildingZ - 0.75f, Mathf.PI),
                new Vector3(64f, Layout.BuildingZ - 0.75f, Mathf.PI),
                new Vector3(25f, -Layout.BuildingZ + 0.75f, 0f));

            // Bollards either side of each kerb ramp at the crossing.
            float ramp = Layout.RampWidth / 2f + 0.4f;
            Place("Bollards", Bollard(), new Dictionary<string, Material>
            {
                { "steel", iron },
                { "band", m.Painted(new Color(0.9f, 0.9f, 0.86f), 0.3f) },
            },
                new Vector3(Layout.CrossingX - ramp, kerb + 0.35f, 0f), new Vector3(Layout.CrossingX + ramp, kerb + 0.35f, 0f),
                new Vector3(Layout.CrossingX - ramp, -kerb - 0.35f, 0f), new Vector3(Layout.CrossingX + ramp, -kerb - 0.35f, 0f));

            // Newspaper boxes in a row by the kerb, facing the pavement.
            Color[] boxColours = { new Color(0.62f, 0.08f, 0.07f), new Color(0.08f, 0.2f, 0.45f), new Color(0.85f, 0.83f, 0.78f) };
            for (int k = 0; k < boxColours.Length; k++)
            {
                Place("Newspaper box " + (k + 1), NewsBox(), new Dictionary<string, Material>
                {
                    { "body", m.Painted(boxColours[k], 0.4f) },
                    { "window", m.TintedGlass("News box window", new Color(0.3f, 0.32f, 0.3f), 0.5f) },
                    { "iron", iron },
                }, new Vector3(15.4f + k * 0.58f, kerb + 0.55f, 0f));
            }

            // A bike rack of three hoops on the south pavement.
            Place("Bike rack", BikeRack(), new Dictionary<string, Material> { { "steel", galv } }, new Vector3(12f, -kerb - 1.1f, 0f));
            return root;
        }

        /// <summary>Park bench, 1.8 m along x, facing +z: cast-iron ends, hardwood seat and back slats.</summary>
        public static Assembly Bench()
        {
            var a = new Assembly();
            foreach (float x in new[] { -0.78f, 0.78f })
            {
                a.Add("iron", Box(0.05f, 0.44f, 0.05f, 0.008f, x, 0.22f, 0.17f));
                MeshData back = Box(0.05f, 0.88f, 0.05f, 0.008f, 0f, 0.44f, 0f);
                back.RotateX(-0.2f).Translate(x, 0f, -0.2f);
                a.Add("iron", back);
                a.Add("iron", Box(0.05f, 0.04f, 0.46f, 0.01f, x, 0.44f, -0.02f));
                a.Add("iron", Box(0.06f, 0.035f, 0.42f, 0.012f, x, 0.66f, 0.0f));
            }
            for (int k = 0; k < 4; k++) a.Add("wood", Box(1.8f, 0.035f, 0.085f, 0.008f, 0f, 0.475f, 0.16f - k * 0.1f));
            for (int k = 0; k < 3; k++)
            {
                MeshData slat = Box(1.8f, 0.09f, 0.03f, 0.008f, 0f, 0f, 0f);
                float h = 0.58f + k * 0.12f;
                slat.RotateX(-0.2f).Translate(0f, h, -0.2f - (h - 0.44f) * 0.2f);
                a.Add("wood", slat);
            }
            return a;
        }

        /// <summary>
        /// Bus shelter 4 × 1.5 m, 2.5 m high, open towards +z: galvanised posts, a sloping roof,
        /// a glass back and end, a lit advert panel at the other end, and a bench inside.
        /// </summary>
        public static Assembly Shelter()
        {
            var a = new Assembly();
            foreach (float x in new[] { -1.95f, 1.95f })
            {
                foreach (float z in new[] { -0.7f, 0.55f })
                {
                    a.Add("frame", Box(0.08f, 2.45f, 0.08f, 0.01f, x, 1.225f, z));
                }
            }
            a.Add("frame", Box(4.0f, 0.08f, 0.06f, 0.01f, 0f, 2.42f, 0.55f));
            a.Add("frame", Box(4.0f, 0.06f, 0.06f, 0.01f, 0f, 0.1f, -0.7f));
            MeshData roof = Box(4.3f, 0.07f, 1.8f, 0.02f, 0f, 0f, 0f);
            roof.RotateX(0.06f).Translate(0f, 2.52f, -0.08f);
            a.Add("roof", roof);
            a.Add("glass", Box(3.82f, 2.2f, 0.012f, 0.003f, 0f, 1.25f, -0.7f));
            a.Add("glass", Box(0.012f, 2.2f, 1.1f, 0.003f, -1.95f, 1.25f, -0.1f));
            a.Add("frame", Box(0.16f, 1.95f, 1.3f, 0.02f, 1.95f, 1.2f, -0.08f));
            a.Add("advert", Box(0.17f, 1.7f, 1.15f, 0.005f, 1.95f, 1.22f, -0.08f));
            // Only the seat's slats and legs: a shorter bench against the back glass.
            foreach (float x in new[] { -1.2f, 0.4f })
            {
                a.Add("iron", Box(0.05f, 0.44f, 0.05f, 0.008f, x, 0.22f, -0.45f));
            }
            for (int k = 0; k < 3; k++) a.Add("wood", Box(1.8f, 0.035f, 0.085f, 0.008f, -0.4f, 0.475f, -0.3f - k * 0.1f));
            return a;
        }

        /// <summary>A steel bollard 0.95 m high with a domed cap and a reflective band.</summary>
        public static Assembly Bollard()
        {
            var a = new Assembly();
            a.Add("steel", Shapes.Lathe(P(0f, 0f, 0.1f, 0f, 0.1f, 0.72f, 0f, 0.72f), 20));
            a.Add("band", Shapes.Lathe(P(0.102f, 0.72f, 0.102f, 0.8f), 20));
            a.Add("steel", Shapes.Lathe(P(0f, 0.8f, 0.1f, 0.8f, 0.1f, 0.88f, 0.08f, 0.93f, 0.04f, 0.95f, 0f, 0.955f), 20));
            return a;
        }

        /// <summary>A coin-operated newspaper box on a pedestal, window towards +z.</summary>
        public static Assembly NewsBox()
        {
            var a = new Assembly();
            a.Add("iron", Box(0.08f, 0.4f, 0.08f, 0.01f, 0f, 0.2f, 0f));
            a.Add("iron", Box(0.4f, 0.03f, 0.36f, 0.01f, 0f, 0.015f, 0f));
            a.Add("body", Box(0.48f, 0.62f, 0.42f, 0.025f, 0f, 0.71f, 0f));
            MeshData lid = Box(0.5f, 0.05f, 0.46f, 0.015f, 0f, 0f, 0f);
            lid.RotateX(0.12f).Translate(0f, 1.05f, 0f);
            a.Add("body", lid);
            a.Add("window", Box(0.36f, 0.26f, 0.01f, 0.003f, 0f, 0.82f, 0.212f));
            a.Add("iron", Box(0.12f, 0.1f, 0.03f, 0.005f, 0.12f, 0.58f, 0.22f));
            return a;
        }

        /// <summary>Three galvanised inverted-U hoops, 0.85 m high, 0.7 m wide, 0.9 m apart along x.</summary>
        public static Assembly BikeRack()
        {
            var a = new Assembly();
            for (int k = -1; k <= 1; k++)
            {
                float x = k * 0.9f;
                a.Add("steel", Shapes.Tube(new[]
                {
                    new Vector3(x, 0f, -0.35f), new Vector3(x, 0.6f, -0.35f), new Vector3(x, 0.82f, -0.22f),
                    new Vector3(x, 0.85f, 0f), new Vector3(x, 0.82f, 0.22f), new Vector3(x, 0.6f, 0.35f), new Vector3(x, 0f, 0.35f),
                }, 0.025f, 40, 10));
            }
            return a;
        }
    }
}
