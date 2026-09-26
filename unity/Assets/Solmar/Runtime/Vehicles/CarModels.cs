using UnityEngine;

namespace Solmar.Vehicles
{
    /// <summary>The body styles <see cref="CarBuilder"/> knows how to loft, shared by the drivable car and traffic/parked cars.</summary>
    public enum CarModel
    {
        Sedan,
        Suv,
        SportsCar,
        Hatchback,
        Pickup,
        Van,
        Taxi,
        Police,
    }

    /// <summary>
    /// Real-world-scale dimensions and cross-section landmarks for one <see cref="CarModel"/>, in the
    /// car's own local frame: x forward from the car's centre, y up from the ground under the tyres,
    /// z to the left. <see cref="CarBuilder"/> lofts the body from these numbers; nothing here is a
    /// mesh.
    /// </summary>
    public sealed class CarSpec
    {
        public CarModel model;
        public string name;
        public float length, width;
        /// <summary>Bottom of the sills.</summary>
        public float sill = 0.2f;
        /// <summary>Top of the bonnet at the windscreen, and of the boot lid (or bed rail) at the rear glass.</summary>
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
        /// <summary>Whether the cabin is short enough to skip a rear door (a 2-door coupe cabin).</summary>
        public bool coupe;
        public bool taxiSign;
        public bool policeLights;
        /// <summary>Open cargo bed behind a short cab instead of a boot.</summary>
        public bool pickupBed;
        /// <summary>A low, wide two-seat silhouette with a rear spoiler.</summary>
        public bool sporty;
        /// <summary>A slim LED strip above each headlamp.</summary>
        public bool ledStrip = true;
        /// <summary>How far the fender bulges out around each wheel arch.</summary>
        public float archFlare = 0.015f;

        public float Front => length / 2f;
        public float Rear => -length / 2f;
        public float FrontAxle => Front - frontOverhang;
        public float RearAxle => FrontAxle - wheelbase;
        /// <summary>z of the wheel centres (the tyres' outer walls 3 cm inside the body).</summary>
        public float Track => width / 2f - 0.03f - wheelWidth / 2f;
        /// <summary>Whether the cabin is long enough to read as a separate rear door and window.</summary>
        public bool HasRearWindow => !coupe && rearDoors && roofRear < windscreen - 1.6f;
        /// <summary>x of the B-pillar, when there is one.</summary>
        public float BPillarX => windscreen - 1.5f;
    }

    /// <summary>Dimension tables and pickers for the eight car models; the source of truth <see cref="CarBuilder"/> lofts from.</summary>
    public static class CarModels
    {
        public static CarSpec Get(CarModel model)
        {
            switch (model)
            {
                case CarModel.Suv:
                    return new CarSpec
                    {
                        model = model, name = "SUV", length = 4.75f, width = 1.92f, sill = 0.32f, hood = 1.12f, deck = 1.18f, roof = 1.76f,
                        windscreen = 0.95f, roofFront = 0.3f, roofRear = -1.95f, rearGlass = -2.15f,
                        wheelRadius = 0.37f, wheelWidth = 0.245f, frontOverhang = 0.95f, wheelbase = 2.85f, cabinTaper = 0.84f,
                        archFlare = 0.03f,
                    };
                case CarModel.SportsCar:
                    return new CarSpec
                    {
                        model = model, name = "Sports car", length = 4.3f, width = 1.86f, sill = 0.1f, hood = 0.78f, deck = 0.86f, roof = 1.12f,
                        windscreen = 0.55f, roofFront = -0.15f, roofRear = -0.75f, rearGlass = -1.05f,
                        wheelRadius = 0.34f, wheelWidth = 0.265f, frontOverhang = 0.75f, wheelbase = 2.5f, cabinTaper = 0.72f,
                        archFlare = 0.055f, coupe = true, sporty = true,
                    };
                case CarModel.Hatchback:
                    return new CarSpec
                    {
                        model = model, name = "Hatchback", length = 4.25f, width = 1.79f, hood = 0.9f, deck = 1.0f, roof = 1.46f,
                        windscreen = 0.95f, roofFront = 0.25f, roofRear = -1.55f, rearGlass = -1.95f,
                        wheelRadius = 0.32f, wheelWidth = 0.205f, frontOverhang = 0.88f, wheelbase = 2.6f,
                    };
                case CarModel.Pickup:
                    return new CarSpec
                    {
                        model = model, name = "Pickup", length = 5.8f, width = 2.0f, sill = 0.38f, hood = 1.2f, deck = 1.22f, roof = 1.9f,
                        windscreen = 1.35f, roofFront = 0.7f, roofRear = -0.35f, rearGlass = -0.45f,
                        wheelRadius = 0.39f, wheelWidth = 0.265f, frontOverhang = 1.0f, wheelbase = 3.6f, cabinTaper = 0.86f,
                        archFlare = 0.032f, pickupBed = true, ledStrip = false,
                    };
                case CarModel.Van:
                    return new CarSpec
                    {
                        model = model, name = "Van", length = 5.2f, width = 1.95f, sill = 0.28f, hood = 1.05f, deck = 1.05f, roof = 2.05f,
                        windscreen = 1.0f, roofFront = 0.55f, roofRear = -2.1f, rearGlass = -2.3f,
                        wheelRadius = 0.35f, wheelWidth = 0.235f, frontOverhang = 0.85f, wheelbase = 3.15f, cabinTaper = 0.92f,
                        archFlare = 0.02f, ledStrip = false,
                    };
                case CarModel.Taxi:
                    return Base(model, "Taxi", taxiSign: true);
                case CarModel.Police:
                    return Base(model, "Police cruiser", policeLights: true);
                default:
                    return Base(model, "Sedan");
            }
        }

        static CarSpec Base(CarModel model, string name, bool taxiSign = false, bool policeLights = false)
        {
            return new CarSpec
            {
                model = model, name = name, length = 4.85f, width = 1.84f, hood = 0.92f, deck = 0.98f, roof = 1.44f,
                windscreen = 0.75f, roofFront = 0.05f, roofRear = -1.05f, rearGlass = -1.55f,
                frontOverhang = 0.95f, wheelbase = 2.85f, taxiSign = taxiSign, policeLights = policeLights,
            };
        }

        static readonly CarModel[] AllModels =
        {
            CarModel.Sedan, CarModel.Suv, CarModel.SportsCar, CarModel.Hatchback,
            CarModel.Pickup, CarModel.Van, CarModel.Taxi, CarModel.Police,
        };
        static readonly float[] Weights = { 0.28f, 0.22f, 0.1f, 0.16f, 0.08f, 0.06f, 0.06f, 0.04f };

        /// <summary>A model picked with realistic street-traffic weights (mostly sedans, SUVs and hatchbacks; police and sports cars are rare).</summary>
        public static CarModel Random(Rng random)
        {
            float r = random.Next();
            for (int i = 0; i < AllModels.Length; i++)
            {
                if (r < Weights[i]) return AllModels[i];
                r -= Weights[i];
            }
            return CarModel.Sedan;
        }

        // Common paint colours, weighted towards white, silver, grey and black (as on any real
        // street), with a handful of saturated colours. Given as HDRP base-colour linear values (the
        // same numbers a colour swatch would give, before either builder's own gamma handling).
        static readonly (Color colour, float metallic)[] Paints =
        {
            (new Color(0.78f, 0.78f, 0.76f), 0f), (new Color(0.78f, 0.78f, 0.76f), 0f),
            (new Color(0.72f, 0.7f, 0.64f), 0.2f), (new Color(0.52f, 0.53f, 0.54f), 0.7f),
            (new Color(0.52f, 0.53f, 0.54f), 0.7f), (new Color(0.12f, 0.13f, 0.14f), 0.5f),
            (new Color(0.012f, 0.012f, 0.014f), 0f), (new Color(0.012f, 0.012f, 0.014f), 0f),
            (new Color(0.02f, 0.05f, 0.14f), 0.5f), (new Color(0.36f, 0.02f, 0.02f), 0f),
            (new Color(0.42f, 0.36f, 0.26f), 0.6f), (new Color(0.05f, 0.2f, 0.2f), 0.3f),
        };

        /// <summary>A plausible paint colour off the street, weighted towards neutrals. See <see cref="RandomPaintMetallic"/> for the matching metallic value.</summary>
        public static Color RandomPaint(Rng random) => Paints[random.Range(0, Paints.Length)].colour;

        /// <summary>Picks a paint colour and its metallic flake amount together (0 for a solid, up to 0.7 for a metallic).</summary>
        public static Color RandomPaint(Rng random, out float metallic)
        {
            (Color colour, float metallic) p = Paints[random.Range(0, Paints.Length)];
            metallic = p.metallic;
            return p.colour;
        }
    }
}
