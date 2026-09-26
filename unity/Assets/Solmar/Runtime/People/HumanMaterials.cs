using UnityEngine;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar.People
{
    /// <summary>The one HDRP/Lit material per body-part role, tuned per <see cref="HumanLook"/>.</summary>
    public sealed class HumanMaterials
    {
        public Material skin, eyeWhite, iris, lips, hair, top, bottom, shoes, cap, sunglasses;

        public static HumanMaterials Build(HumanLook look)
        {
            var m = new HumanMaterials();
            // Skin: warm, low-gloss with a soft highlight to hint at subsurface scattering without a
            // diffusion profile asset (none of those may be authored offline for this project).
            m.skin = Make("Skin", Color.Lerp(look.skinTone, new Color(1f, 0.55f, 0.45f), 0.06f), 0.32f);
            m.eyeWhite = Make("EyeWhite", new Color(0.92f, 0.91f, 0.88f), 0.55f);
            m.iris = Make("Iris", new Color(0.22f, 0.15f, 0.10f), 0.7f);
            m.lips = Make("Lips", Color.Lerp(look.skinTone, new Color(0.55f, 0.18f, 0.20f), 0.45f), 0.4f);
            // Hair: high smoothness stands in for an anisotropic highlight without a true aniso profile.
            m.hair = Make("Hair", look.hairColor, 0.62f);
            m.top = Make("Top", look.topColor, ClothSmoothness(look.topStyle));
            m.bottom = Make("Bottom", look.bottomColor, look.bottomStyle == BottomStyle.Jeans ? 0.22f : 0.28f);
            m.shoes = Make("Shoes", look.shoeColor, look.shoeStyle == ShoeStyle.Boots ? 0.45f : 0.4f);
            if (look.hasCap) m.cap = Make("Cap", look.capColor, 0.3f);
            if (look.hasSunglasses) m.sunglasses = Make("Sunglasses", new Color(0.04f, 0.04f, 0.05f), 0.85f);
            return m;
        }

        static float ClothSmoothness(TopStyle style) => style switch
        {
            TopStyle.TankTop => 0.30f,
            TopStyle.Shirt => 0.34f,
            _ => 0.26f,
        };

        static Material Make(string name, Color color, float smoothness, float metallic = 0f)
        {
            var shader = Shader.Find("HDRP/Lit");
            var mat = new Material(shader) { name = name, hideFlags = HideFlags.DontSave };
            mat.SetColor("_BaseColor", color);
            mat.SetFloat("_Smoothness", smoothness);
            mat.SetFloat("_Metallic", metallic);
            HDMaterial.ValidateMaterial(mat);
            return mat;
        }
    }
}
