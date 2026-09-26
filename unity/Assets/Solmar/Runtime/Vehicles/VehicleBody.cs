using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar.Vehicles
{
    /// <summary>
    /// Builds a drivable car's visual mesh procedurally: a clean sedan body (lofted from chamfered
    /// boxes, with wheel-arch relief so the tyres aren't buried in the hull), separate spinning wheel
    /// meshes, and HDRP/Lit materials for paint, glass, trim, lamps and rubber. A later pass can swap
    /// this body for the shared parked-car model in <see cref="Solmar.City.Cars"/>.
    ///
    /// Local frame, matching <see cref="UnityEngine.WheelCollider"/>'s convention: +z forward, +y up,
    /// +x to the left of the driver.
    /// </summary>
    public static class VehicleBody
    {
        public const float Length = 4.6f;
        public const float Width = 1.82f;
        public const float Wheelbase = 2.65f;
        public const float FrontOverhang = 0.9f;
        public const float WheelRadius = 0.33f;
        public const float WheelWidth = 0.215f;

        public static float FrontAxleZ => Length / 2f - FrontOverhang;
        public static float RearAxleZ => FrontAxleZ - Wheelbase;
        /// <summary>z of the wheel centres, either side of the car's centreline.</summary>
        public static float Track => Width / 2f - 0.03f - WheelWidth / 2f;

        /// <summary>A spinning wheel's visual and its rest position relative to the body, for a WheelCollider to be placed at.</summary>
        public readonly struct WheelSlot
        {
            public readonly Transform visual;
            public readonly Vector3 localPosition;

            public WheelSlot(Transform visual, Vector3 localPosition)
            {
                this.visual = visual;
                this.localPosition = localPosition;
            }
        }

        static Shader litShaderCache;

        static Shader Lit()
        {
            if (litShaderCache == null) litShaderCache = Shader.Find("HDRP/Lit");
            if (litShaderCache == null) Debug.LogWarning("Solmar Vehicles: the HDRP/Lit shader wasn't found; car materials will be missing.");
            return litShaderCache;
        }

        static Material Surface(string name, Color baseColor, float smoothness, float metallic = 0f, float coat = 0f)
        {
            Shader shader = Lit();
            var m = new Material(shader != null ? shader : Shader.Find("Hidden/InternalErrorShader")) { name = name, hideFlags = HideFlags.DontSave };
            m.SetColor("_BaseColor", baseColor);
            m.SetFloat("_Smoothness", smoothness);
            m.SetFloat("_Metallic", metallic);
            if (coat > 0f) m.SetFloat("_CoatMask", coat);
            HDMaterial.ValidateMaterial(m);
            return m;
        }

        static Material Glass(string name, Color tint, float opacity)
        {
            Material m = Surface(name, new Color(tint.r, tint.g, tint.b, opacity), 0.92f, 0.1f);
            HDMaterial.SetSurfaceType(m, true);
            m.SetFloat("_BlendMode", 0f);
            m.SetFloat("_EnableBlendModePreserveSpecularLighting", 1f);
            m.SetFloat("_ReceivesSSRTransparent", 1f);
            HDMaterial.ValidateMaterial(m);
            return m;
        }

        static MeshData Box(float sizeX, float y0, float y1, float sizeZ, float chamfer, float cx, float cz)
        {
            float cy = (y0 + y1) * 0.5f;
            float h = Mathf.Max(0.01f, y1 - y0);
            return Shapes.ChamferBox(sizeX, h, sizeZ, chamfer).Translate(cx, cy, cz);
        }

        /// <summary>A tyre revolved about its own spin axis (local x once reoriented).</summary>
        static MeshData Tyre()
        {
            float r = WheelRadius, h = WheelWidth / 2f;
            var profile = new List<Vector2>
            {
                new Vector2(r * 0.6f, -h), new Vector2(r * 0.92f, -h), new Vector2(r, -h + 0.03f),
                new Vector2(r, h - 0.03f), new Vector2(r * 0.92f, h), new Vector2(r * 0.6f, h),
            };
            // Lathe revolves about y; rotate so the spin axis becomes local x (the axle direction).
            return Shapes.Lathe(profile, 28).RotateZ(Mathf.PI / 2f);
        }

        /// <summary>A five-spoke rim, face towards +x once reoriented.</summary>
        static MeshData Rim()
        {
            float r = WheelRadius, h = WheelWidth / 2f;
            float rr = r * 0.62f;
            MeshData m = Shapes.Lathe(new List<Vector2>
            {
                new Vector2(rr, -h + 0.02f), new Vector2(rr, h - 0.02f), new Vector2(rr * 0.3f, h - 0.05f), new Vector2(0f, h - 0.05f),
            }, 24);
            for (int k = 0; k < 5; k++)
            {
                m.Append(Shapes.ChamferBox(rr * 0.7f, 0.035f, 0.05f, 0.006f).Translate(rr * 0.5f, h - 0.03f, 0f).RotateY(k * Mathf.PI * 2f / 5f));
            }
            return m.RotateZ(Mathf.PI / 2f);
        }

        static Mesh BuildWheelMesh(out Material[] wheelMats)
        {
            var a = new Assembly();
            a.Add("tyre", Tyre());
            a.Add("rim", Rim());
            Mesh mesh = a.Build("Wheel");
            wheelMats = new Material[a.Slots.Count];
            for (int i = 0; i < a.Slots.Count; i++)
            {
                wheelMats[i] = a.Slots[i] == "tyre"
                    ? Surface("Wheel tyre", new Color(0.02f, 0.02f, 0.022f), 0.2f)
                    : Surface("Wheel rim", new Color(0.62f, 0.63f, 0.65f), 0.75f, 1f);
            }
            return mesh;
        }

        /// <summary>
        /// Builds the body, four wheel visuals and a body collider under <paramref name="root"/>.
        /// Returns the wheel slots in FL, FR, RL, RR order (+x is the left side of the car).
        /// </summary>
        public static WheelSlot[] Build(Transform root, Color paintColor)
        {
            var paint = Surface("Car paint", paintColor, 0.82f, paintColor.maxColorComponent > 0.6f ? 0.2f : 0.55f, 1f);
            var glass = Glass("Car glass", new Color(0.02f, 0.03f, 0.035f), 0.72f);
            var trim = Surface("Car trim", new Color(0.02f, 0.02f, 0.023f), 0.4f);
            var lamp = Surface("Car headlamp", new Color(0.85f, 0.87f, 0.9f), 0.95f, 0.6f);
            var tail = Surface("Car tail lamp", new Color(0.32f, 0.01f, 0.008f), 0.9f, 0f, 1f);
            var plate = Surface("Car plate", new Color(0.72f, 0.72f, 0.7f), 0.5f);
            var mirror = Surface("Car mirror glass", new Color(0.35f, 0.38f, 0.4f), 0.9f, 0.8f);

            const float midTop = 0.72f;
            const float sillLow = 0.08f;
            const float sillArch = 0.4f;
            const float archHalfLength = 0.55f;
            float frontAxle = FrontAxleZ, rearAxle = RearAxleZ;
            const float frontZ = Length / 2f, rearZ = -Length / 2f;

            var a = new Assembly();

            // Lower hull, five segments so the wheel arches (front and rear) relieve up above the
            // wheels while the overhangs and the mid-section sit low.
            (float z0, float z1, float sill)[] hull =
            {
                (rearZ + 0.15f, rearAxle - archHalfLength, sillLow),
                (rearAxle - archHalfLength, rearAxle + archHalfLength, sillArch),
                (rearAxle + archHalfLength, frontAxle - archHalfLength, sillLow),
                (frontAxle - archHalfLength, frontAxle + archHalfLength, sillArch),
                (frontAxle + archHalfLength, frontZ - 0.15f, sillLow),
            };
            foreach ((float z0, float z1, float sill) in hull)
            {
                if (z1 <= z0) continue;
                a.Add("paint", Box(Width, sill, midTop, z1 - z0, 0.1f, 0f, (z0 + z1) / 2f));
            }

            // Cabin zone.
            float cabinFrontZ = frontAxle - 0.15f;
            float cabinRearZ = rearAxle + 0.15f;
            const float beltTop = 0.86f;
            const float glassTop = 1.22f;
            const float roofTop = 1.3f;

            a.Add("paint", Box(Width * 0.98f, midTop, beltTop, cabinFrontZ - cabinRearZ, 0.06f, 0f, (cabinFrontZ + cabinRearZ) / 2f));
            a.Add("glass", Box(Width * 0.84f, beltTop - 0.01f, glassTop, cabinFrontZ - cabinRearZ - 0.1f, 0.05f, 0f, (cabinFrontZ + cabinRearZ) / 2f));
            float roofZ0 = cabinRearZ + 0.15f, roofZ1 = cabinFrontZ - 0.15f;
            if (roofZ1 > roofZ0) a.Add("paint", Box(Width * 0.7f, glassTop - 0.01f, roofTop, roofZ1 - roofZ0, 0.06f, 0f, (roofZ0 + roofZ1) / 2f));

            // Bumpers.
            a.Add("trim", Box(Width * 0.97f, 0.3f, 0.62f, 0.24f, 0.06f, 0f, frontZ - 0.12f));
            a.Add("trim", Box(Width * 0.97f, 0.3f, 0.6f, 0.24f, 0.06f, 0f, rearZ + 0.12f));

            // Lamps, grille, plate, mirrors, handles.
            foreach (int side in new[] { 1, -1 })
            {
                a.Add("lamp", Box(0.28f, 0.5f, 0.62f, 0.12f, 0.02f, side * Width * 0.32f, frontZ - 0.06f));
                a.Add("tail", Box(0.26f, 0.55f, 0.68f, 0.12f, 0.02f, side * Width * 0.33f, rearZ + 0.06f));
                a.Add("trim", Box(0.12f, beltTop + 0.02f, beltTop + 0.12f, 0.2f, 0.02f, side * (Width / 2f + 0.06f), cabinFrontZ));
                a.Add("mirror", Box(0.03f, beltTop + 0.04f, beltTop + 0.1f, 0.14f, 0.006f, side * (Width / 2f + 0.11f), cabinFrontZ));
                a.Add("trim", Box(0.015f, midTop - 0.14f, midTop - 0.04f, 0.16f, 0.004f, side * (Width / 2f - 0.01f), cabinFrontZ - 0.55f));
            }
            a.Add("trim", Box(0.5f, 0.35f, 0.55f, 0.05f, 0.01f, 0f, frontZ - 0.03f));
            a.Add("plate", Box(0.3f, 0.4f, 0.55f, 0.01f, 0.005f, 0f, rearZ + 0.02f));

            Mesh bodyMesh = a.Build("Sedan body");
            bodyMesh.hideFlags = HideFlags.DontSave;
            var bodyGo = new GameObject("Body");
            bodyGo.transform.SetParent(root, false);
            bodyGo.AddComponent<MeshFilter>().sharedMesh = bodyMesh;
            var mats = new Material[a.Slots.Count];
            for (int i = 0; i < a.Slots.Count; i++)
            {
                mats[i] = a.Slots[i] switch
                {
                    "paint" => paint,
                    "glass" => glass,
                    "trim" => trim,
                    "lamp" => lamp,
                    "tail" => tail,
                    "plate" => plate,
                    "mirror" => mirror,
                    _ => trim,
                };
            }
            var bodyRenderer = bodyGo.AddComponent<MeshRenderer>();
            bodyRenderer.sharedMaterials = mats;
            bodyRenderer.shadowCastingMode = ShadowCastingMode.On;

            // Body collider: a simple box roughly matching the hull (a little inset from the full
            // width and length so it doesn't foul the wheels or overhang colliders).
            var box = root.gameObject.AddComponent<BoxCollider>();
            box.center = new Vector3(0f, (sillLow + roofTop) / 2f, 0f);
            box.size = new Vector3(Width * 0.94f, roofTop - sillLow, Length * 0.92f);

            // Wheels: one shared mesh (tyre + rim), four independently posable visuals.
            Mesh wheelMesh = BuildWheelMesh(out Material[] wheelMats);
            wheelMesh.hideFlags = HideFlags.DontSave;
            Vector3[] positions =
            {
                new Vector3(Track, WheelRadius, frontAxle),
                new Vector3(-Track, WheelRadius, frontAxle),
                new Vector3(Track, WheelRadius, rearAxle),
                new Vector3(-Track, WheelRadius, rearAxle),
            };
            string[] names = { "Wheel visual FL", "Wheel visual FR", "Wheel visual RL", "Wheel visual RR" };
            var slots = new WheelSlot[4];
            for (int i = 0; i < 4; i++)
            {
                var wheelGo = new GameObject(names[i]);
                wheelGo.transform.SetParent(root, false);
                wheelGo.transform.localPosition = positions[i];
                wheelGo.AddComponent<MeshFilter>().sharedMesh = wheelMesh;
                var wr = wheelGo.AddComponent<MeshRenderer>();
                wr.sharedMaterials = wheelMats;
                wr.shadowCastingMode = ShadowCastingMode.On;
                slots[i] = new WheelSlot(wheelGo.transform, positions[i]);
            }
            return slots;
        }
    }
}
