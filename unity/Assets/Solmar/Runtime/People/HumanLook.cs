using UnityEngine;

namespace Solmar.People
{
    public enum HumanGender { Male, Female }
    public enum HumanBuild { Slim, Average, Heavy }
    public enum HairStyle { Bald, Buzz, Short, Medium, Long, Ponytail }
    public enum TopStyle { TankTop, TShirt, Shirt }
    public enum BottomStyle { Shorts, Jeans, Pants }
    public enum ShoeStyle { Sneakers, Sandals, Boots }

    /// <summary>
    /// The appearance of one person: everything <see cref="HumanBody"/> needs to build their mesh
    /// and rig from code, with no outside assets. Plain data, so a spawner can hand-author it for the
    /// player or roll it for a crowd with <see cref="Random"/>.
    /// </summary>
    [System.Serializable]
    public sealed class HumanLook
    {
        public float heightMeters = 1.75f;
        public HumanBuild build = HumanBuild.Average;
        public HumanGender gender = HumanGender.Male;

        public Color skinTone = new Color(0.86f, 0.67f, 0.56f);

        public HairStyle hairStyle = HairStyle.Short;
        public Color hairColor = new Color(0.12f, 0.08f, 0.06f);

        public TopStyle topStyle = TopStyle.TShirt;
        public Color topColor = new Color(0.20f, 0.45f, 0.65f);
        public BottomStyle bottomStyle = BottomStyle.Shorts;
        public Color bottomColor = new Color(0.16f, 0.17f, 0.21f);
        public ShoeStyle shoeStyle = ShoeStyle.Sneakers;
        public Color shoeColor = Color.white;

        public bool hasCap;
        public Color capColor = Color.white;
        public bool hasSunglasses;

        /// <summary>A plausible, varied passer-by, for crowds: deterministic from <paramref name="rng"/>.</summary>
        public static HumanLook Random(Rng rng)
        {
            var look = new HumanLook
            {
                gender = rng.Next() < 0.5f ? HumanGender.Male : HumanGender.Female
            };

            float h = look.gender == HumanGender.Male ? Mathf.Lerp(1.68f, 1.92f, rng.Next()) : Mathf.Lerp(1.55f, 1.78f, rng.Next());
            look.heightMeters = Mathf.Clamp(h, 1.55f, 1.95f);

            float b = rng.Next();
            look.build = b < 0.3f ? HumanBuild.Slim : (b < 0.75f ? HumanBuild.Average : HumanBuild.Heavy);

            look.skinTone = Color.Lerp(new Color(0.94f, 0.80f, 0.69f), new Color(0.30f, 0.19f, 0.13f), rng.Next());

            HairStyle[] pool = look.gender == HumanGender.Male
                ? new[] { HairStyle.Bald, HairStyle.Buzz, HairStyle.Short, HairStyle.Short, HairStyle.Medium }
                : new[] { HairStyle.Short, HairStyle.Medium, HairStyle.Medium, HairStyle.Long, HairStyle.Ponytail };
            look.hairStyle = pool[Mathf.Clamp(rng.Range(0, pool.Length), 0, pool.Length - 1)];

            float hairT = rng.Next();
            look.hairColor = hairT < 0.55f
                ? Color.Lerp(new Color(0.04f, 0.03f, 0.03f), new Color(0.28f, 0.16f, 0.09f), rng.Next())
                : hairT < 0.85f
                    ? Color.Lerp(new Color(0.35f, 0.20f, 0.08f), new Color(0.75f, 0.52f, 0.26f), rng.Next())
                    : Color.Lerp(new Color(0.55f, 0.52f, 0.48f), new Color(0.92f, 0.89f, 0.82f), rng.Next());

            look.topStyle = (TopStyle)Mathf.Clamp(rng.Range(0, 3), 0, 2);
            look.bottomStyle = (BottomStyle)Mathf.Clamp(rng.Range(0, 3), 0, 2);
            look.shoeStyle = (ShoeStyle)Mathf.Clamp(rng.Range(0, 3), 0, 2);
            look.topColor = MiamiColor(rng);
            look.bottomColor = rng.Next() < 0.5f ? MiamiColor(rng) : new Color(0.15f, 0.16f, 0.20f);
            look.shoeColor = rng.Next() < 0.55f ? Color.Lerp(Color.white, new Color(0.85f, 0.85f, 0.9f), rng.Next()) : MiamiColor(rng);

            look.hasCap = rng.Next() < 0.18f;
            look.capColor = MiamiColor(rng);
            look.hasSunglasses = rng.Next() < 0.25f;
            return look;
        }

        static Color MiamiColor(Rng rng)
        {
            Color[] palette =
            {
                new Color(0.95f, 0.35f, 0.45f), new Color(0.20f, 0.75f, 0.75f), new Color(0.98f, 0.75f, 0.20f),
                new Color(0.35f, 0.55f, 0.95f), new Color(0.95f, 0.55f, 0.15f), new Color(0.92f, 0.92f, 0.90f),
                new Color(0.12f, 0.12f, 0.16f), new Color(0.50f, 0.85f, 0.42f), new Color(0.75f, 0.32f, 0.85f),
            };
            return palette[Mathf.Clamp(rng.Range(0, palette.Length), 0, palette.Length - 1)];
        }
    }
}
