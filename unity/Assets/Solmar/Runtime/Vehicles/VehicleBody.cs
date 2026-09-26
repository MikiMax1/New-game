using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar.Vehicles
{
    /// <summary>
    /// Builds a drivable car's visual mesh procedurally, from the same lofted, model-driven builder
    /// (<see cref="CarBuilder"/>) that parked and traffic cars use in <see cref="Solmar.City.Cars"/>:
    /// a smooth hull with flared arches, an inset glasshouse with a visible interior, detailed lamps,
    /// mirrors and trim, spinning wheels with brake discs, and HDRP materials for paint, glass, trim
    /// and lamps. A <see cref="CarLights"/> is attached to the root so other code can switch its
    /// headlights and brake lights on and off.
    ///
    /// <see cref="CarBuilder"/> works in its own car-space (x forward, z left); everything built here
    /// is reframed by a fixed 90° turn into the local frame <see cref="UnityEngine.WheelCollider"/>
    /// expects: +z forward, +y up, +x to the left of the driver.
    /// </summary>
    public static class VehicleBody
    {
        /// <summary>The default (Sedan) model's dimensions, kept for anything that still reads them directly.</summary>
        static readonly CarSpec DefaultSpec = CarModels.Get(CarModel.Sedan);

        public static float Length => DefaultSpec.length;
        public static float Width => DefaultSpec.width;
        public static float Wheelbase => DefaultSpec.wheelbase;
        public static float FrontOverhang => DefaultSpec.frontOverhang;
        /// <summary>The WheelCollider radius every drivable car uses, whatever model is chosen for its visual mesh.</summary>
        public const float WheelRadius = 0.33f;
        public static float WheelWidth => DefaultSpec.wheelWidth;

        // The frame CarBuilder's car-space (x forward, z left) is turned into: +z forward, +x left.
        static readonly Matrix4x4 Frame = Matrix4x4.Rotate(Quaternion.Euler(0f, -90f, 0f));

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

        /// <summary>An emissive surface, off by default (0 nits): <see cref="CarLights"/> turns it up.</summary>
        static Material Emissive(string name, Color color, float smoothness, float coat = 0f)
        {
            Material m = Surface(name, color, smoothness, 0f, coat);
            HDMaterial.SetUseEmissiveIntensity(m, true);
            HDMaterial.SetEmissiveColor(m, Color.white);
            HDMaterial.SetEmissiveIntensity(m, 0f, EmissiveIntensityUnit.Nits);
            HDMaterial.ValidateMaterial(m);
            return m;
        }

        /// <summary>A model chosen with realistic street-traffic weights (mostly sedans, SUVs and hatchbacks).</summary>
        public static CarModel RandomModel(Rng random) => CarModels.Random(random);

        /// <summary>A plausible paint colour off the street, weighted towards white, silver, grey and black.</summary>
        public static Color RandomPaint(Rng random) => CarModels.RandomPaint(random);

        /// <summary>
        /// Builds the body, wheels and a body collider under <paramref name="root"/> as a Sedan.
        /// Returns the wheel slots in FL, FR, RL, RR order (+x is the left side of the car).
        /// </summary>
        public static WheelSlot[] Build(Transform root, Color paintColor) => Build(root, paintColor, CarModel.Sedan);

        /// <summary>
        /// Builds the body, wheels and a body collider under <paramref name="root"/> as the given
        /// model. Returns the wheel slots in FL, FR, RL, RR order (+x is the left side of the car).
        /// </summary>
        public static WheelSlot[] Build(Transform root, Color paintColor, CarModel model)
        {
            CarSpec spec = CarModels.Get(model);

            float metallic = paintColor.maxColorComponent > 0.6f ? 0.2f : 0.55f;
            var paint = Surface("Car paint", paintColor, 0.82f, metallic, 1f);
            var skirt = Surface("Car skirt", paintColor * 0.32f, 0.35f);
            var glass = Glass("Car glass", new Color(0.02f, 0.03f, 0.035f), 0.72f);
            var trim = Surface("Car trim", new Color(0.02f, 0.02f, 0.023f), 0.4f);
            var lamp = Surface("Car headlamp housing", new Color(0.6f, 0.62f, 0.65f), 0.85f, 0.7f);
            var lens = Emissive("Car headlamp lens", new Color(0.85f, 0.87f, 0.9f, 0.4f), 0.95f);
            var reflector = Surface("Car headlamp reflector", new Color(0.85f, 0.86f, 0.88f), 0.95f, 1f);
            var led = Surface("Car LED strip", new Color(0.85f, 0.92f, 1f), 0.6f);
            HDMaterial.SetUseEmissiveIntensity(led, true);
            HDMaterial.SetEmissiveColor(led, new Color(0.75f, 0.88f, 1f));
            HDMaterial.SetEmissiveIntensity(led, 3000f, EmissiveIntensityUnit.Nits);
            HDMaterial.ValidateMaterial(led);
            var tail = Emissive("Car tail lamp", new Color(0.32f, 0.01f, 0.008f, 0.85f), 0.9f, 1f);
            HDMaterial.SetEmissiveColor(tail, new Color(1f, 0.05f, 0.03f));
            var grille = Surface("Car grille", new Color(0.03f, 0.03f, 0.032f), 0.55f, 0.4f);
            var plate = Surface("Car plate", new Color(0.72f, 0.72f, 0.7f), 0.5f);
            var mirror = Surface("Car mirror glass", new Color(0.35f, 0.38f, 0.4f), 0.9f, 0.8f);
            var badge = Surface("Car badge", new Color(0.75f, 0.76f, 0.78f), 0.85f, 0.9f);
            var seat = Surface("Car seat", new Color(0.05f, 0.045f, 0.045f), 0.15f);
            var dash = Surface("Car dashboard", new Color(0.03f, 0.03f, 0.032f), 0.25f);
            var sign = Surface("Taxi sign", new Color(0.8f, 0.78f, 0.7f), 0.6f);
            var lightRed = Emissive("Light bar red", new Color(0.4f, 0.01f, 0.01f), 0.8f);
            HDMaterial.SetEmissiveColor(lightRed, new Color(1f, 0.02f, 0.02f));
            HDMaterial.SetEmissiveIntensity(lightRed, 4000f, EmissiveIntensityUnit.Nits);
            HDMaterial.ValidateMaterial(lightRed);
            var lightBlue = Emissive("Light bar blue", new Color(0.01f, 0.02f, 0.4f), 0.8f);
            HDMaterial.SetEmissiveColor(lightBlue, new Color(0.05f, 0.15f, 1f));
            HDMaterial.SetEmissiveIntensity(lightBlue, 4000f, EmissiveIntensityUnit.Nits);
            HDMaterial.ValidateMaterial(lightBlue);

            Assembly bodyAssembly = CarBuilder.BuildBody(spec, Frame);
            Mesh bodyMesh = bodyAssembly.Build(spec.name + " body");
            bodyMesh.hideFlags = HideFlags.DontSave;
            var bodyGo = new GameObject("Body");
            bodyGo.transform.SetParent(root, false);
            bodyGo.AddComponent<MeshFilter>().sharedMesh = bodyMesh;
            var mats = new Material[bodyAssembly.Slots.Count];
            for (int i = 0; i < mats.Length; i++)
            {
                mats[i] = bodyAssembly.Slots[i] switch
                {
                    "paint" => paint,
                    "skirt" => skirt,
                    "glass" => glass,
                    "trim" => trim,
                    "lamp" => lamp,
                    "lens" => lens,
                    "reflector" => reflector,
                    "led" => led,
                    "tail" => tail,
                    "grille" => grille,
                    "plate" => plate,
                    "mirror" => mirror,
                    "badge" => badge,
                    "seat" => seat,
                    "dash" => dash,
                    "sign" => sign,
                    "lightRed" => lightRed,
                    "lightBlue" => lightBlue,
                    "tyre" => trim,
                    _ => trim,
                };
            }
            var bodyRenderer = bodyGo.AddComponent<MeshRenderer>();
            bodyRenderer.sharedMaterials = mats;
            bodyRenderer.shadowCastingMode = ShadowCastingMode.On;

            var lights = root.gameObject.AddComponent<CarLights>();
            lights.Configure(lens, 8000f, tail, 40f, 900f);

            // Body collider: a simple box roughly matching the hull (a little inset from the full
            // width and length so it doesn't foul the wheels or overhang colliders).
            var box = root.gameObject.AddComponent<BoxCollider>();
            box.center = new Vector3(0f, (spec.sill + spec.roof) / 2f, 0f);
            box.size = new Vector3(spec.width * 0.94f, spec.roof - spec.sill, spec.length * 0.92f);

            // Wheels: one shared mesh (tyre, rim and disc), four independently posable visuals.
            var wheelTyre = Surface("Wheel tyre", new Color(0.02f, 0.02f, 0.022f), 0.2f);
            var wheelRim = Surface("Wheel rim", new Color(0.62f, 0.63f, 0.65f), 0.75f, 1f);
            var wheelDisc = Surface("Wheel brake disc", new Color(0.24f, 0.23f, 0.22f), 0.4f, 0.9f);
            Mesh wheelMesh = CarBuilder.BuildWheelMesh(spec, out string[] wheelSlots);
            wheelMesh.hideFlags = HideFlags.DontSave;
            var wheelMats = new Material[wheelSlots.Length];
            for (int i = 0; i < wheelSlots.Length; i++)
            {
                wheelMats[i] = wheelSlots[i] switch
                {
                    "tyre" => wheelTyre,
                    "rim" => wheelRim,
                    "disc" => wheelDisc,
                    _ => wheelTyre,
                };
            }

            float frontAxle = spec.FrontAxle, rearAxle = spec.RearAxle, track = spec.Track, wheelRadius = spec.wheelRadius;
            Vector3[] positions =
            {
                new Vector3(track, wheelRadius, frontAxle),
                new Vector3(-track, wheelRadius, frontAxle),
                new Vector3(track, wheelRadius, rearAxle),
                new Vector3(-track, wheelRadius, rearAxle),
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
