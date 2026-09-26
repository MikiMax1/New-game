using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar.Rendering
{
    /// <summary>
    /// The city's material palette, all HDRP/Lit (and HDRP/Decal for road paint and puddles), with
    /// procedural textures baked by ProceduralTextures. Geometry carries UVs in metres, and each
    /// material tiles its textures at their real-world size.
    ///
    /// Light-emitting surfaces are specified in nits (cd/m²), the unit HDRP's physical lighting
    /// works in: a lit office ceiling panel is about 1,000 nits, an LED traffic signal 5,000+.
    ///
    /// Colours passed in (Stucco, Painted, Emissive) are sRGB, as in a colour picker or a hex code;
    /// Material.SetColor converts them to linear. Albedos measured in linear are written with
    /// Linear(), which encodes them so they arrive in the shader unchanged.
    /// </summary>
    public sealed class CityMaterials
    {
        readonly Shader lit;
        readonly Shader decal;
        readonly ProceduralTextures textures;
        readonly int size;
        readonly Dictionary<string, Material> cache = new Dictionary<string, Material>();
        readonly List<Material> created = new List<Material>();

        public readonly Material Road;
        public readonly Material Pavement;
        public readonly Material Kerb;
        public readonly Material Concrete;
        public readonly Material FacadeConcrete;
        public readonly Material WindowGlass;
        public readonly Material ShopGlass;
        public readonly Material TowerGlass;
        public readonly Material Galvanised;
        public readonly Material Brushed;
        public readonly Material Rubber;
        public readonly Material Granite;
        public readonly Material Mulch;
        public readonly Material Bark;
        public readonly Material Leaf;
        public readonly Material DeadLeaf;
        public readonly Material GroundCover;
        public readonly Material RoomWall;
        public readonly Material RoomFloor;
        public readonly Material RoomCeiling;
        public readonly Material DecalWhite;
        public readonly Material DecalYellow;
        public readonly List<Material> PuddleDecals = new List<Material>();

        readonly PbrSet stucco;
        readonly PbrSet concrete;
        readonly PbrSet glass;

        /// <param name="size">Texture resolution for the large surfaces (2048); small objects use half.</param>
        public CityMaterials(Shader litShader, Shader decalShader, ProceduralTextures textures, int size = 2048)
        {
            lit = litShader;
            decal = decalShader;
            this.textures = textures;
            this.size = size;
            int small = Mathf.Max(256, size / 2);

            PbrSet asphalt = textures.Bake(ProceduralTextures.Recipe.Asphalt, 4f, size, Color.white);
            PbrSet pavement = textures.Bake(ProceduralTextures.Recipe.Pavement, 3f, size, Color.white);
            PbrSet granite = textures.Bake(ProceduralTextures.Recipe.Granite, 1.2f, small, Color.white);
            concrete = textures.Bake(ProceduralTextures.Recipe.Concrete, 2.4f, size, Color.white);
            stucco = textures.Bake(ProceduralTextures.Recipe.Stucco, 1.6f, size, Color.white);
            glass = textures.Bake(ProceduralTextures.Recipe.Glass, 2f, small, Color.white);
            PbrSet galvanised = textures.Bake(ProceduralTextures.Recipe.Galvanised, 0.6f, small, Color.white);
            PbrSet brushed = textures.Bake(ProceduralTextures.Recipe.Brushed, 0.6f, small, Color.white);

            // Wet asphalt: the water film is HDRP's clear coat (a smooth dielectric layer).
            Road = Lit("Wet road", asphalt, Color.white, coat: 1f);
            Pavement = Lit("Pavement", pavement, Color.white, coat: 0.5f);
            Kerb = Lit("Granite kerb", granite, Color.white, coat: 0.4f);
            Granite = Lit("Granite", granite, Color.white);
            Concrete = Lit("Concrete", concrete, Linear(1.05f, 1.04f, 1.02f), tile: 1.2f);
            FacadeConcrete = Lit("Facade concrete", concrete, Color.white);
            Galvanised = Lit("Galvanised steel", galvanised, Color.white);
            Brushed = Lit("Brushed metal", brushed, Color.white);
            Rubber = Flat("Rubber", Linear(0.022f, 0.022f, 0.024f), 0.2f);

            WindowGlass = Glass("Window glass", Linear(0.06f, 0.075f, 0.075f, 0.38f), 0f);
            ShopGlass = Glass("Shop glass", Linear(0.08f, 0.09f, 0.09f, 0.18f), 0f);
            // Low-e coated curtain wall: more reflective, tinted, less see-through.
            TowerGlass = Glass("Tower glass", Linear(0.05f, 0.09f, 0.1f, 0.7f), 0.35f);

            // Rooms behind the windows: lit only by daylight through the glass, so interiors read
            // dark from the street as they do in real photographs.
            RoomWall = Flat("Room wall", Linear(0.32f, 0.3f, 0.28f), 0.15f);
            RoomFloor = Flat("Room floor", Linear(0.12f, 0.08f, 0.05f), 0.35f);
            RoomCeiling = Flat("Room ceiling", Linear(0.45f, 0.44f, 0.42f), 0.1f);

            Mulch = Flat("Bark mulch", Linear(0.12f, 0.075f, 0.045f), 0.05f);
            Bark = Flat("Palm bark", Linear(0.36f, 0.33f, 0.29f), 0.1f);
            Leaf = DoubleSided(Flat("Palm leaf", Linear(0.1f, 0.19f, 0.05f), 0.45f));
            DeadLeaf = DoubleSided(Flat("Dead frond", Linear(0.33f, 0.24f, 0.13f), 0.15f));
            GroundCover = DoubleSided(Flat("Ground cover", Linear(0.05f, 0.11f, 0.03f), 0.35f));

            RenderTexture paint = textures.PaintWear(small);
            DecalWhite = PaintDecal("White road paint", paint, Linear(0.72f, 0.72f, 0.7f));
            DecalYellow = PaintDecal("Yellow road paint", paint, Linear(0.78f, 0.52f, 0.07f));
            for (int k = 0; k < 4; k++) PuddleDecals.Add(PuddleDecal(textures.Puddle(small, k * 7.31f), k));
        }

        /// <summary>Painted render, tinted per building (the texture is white; the tint is the paint).</summary>
        public Material Stucco(Color tint)
        {
            string key = "stucco" + ColorUtility.ToHtmlStringRGB(tint);
            if (!cache.TryGetValue(key, out Material m))
            {
                m = Lit("Stucco " + ColorUtility.ToHtmlStringRGB(tint), stucco, tint);
                cache.Add(key, m);
            }
            return m;
        }

        /// <summary>Painted steel of a colour: orange-peel paint, chips showing bare and rusting steel.</summary>
        public Material Painted(Color color, float roughness = 0.4f)
        {
            string key = "paint" + ColorUtility.ToHtmlStringRGB(color) + roughness;
            if (!cache.TryGetValue(key, out Material m))
            {
                // The compute shader writes albedo in linear.
                Color paint = color.linear;
                PbrSet set = textures.Bake(ProceduralTextures.Recipe.Painted, 0.6f, Mathf.Max(256, size / 2), new Color(paint.r, paint.g, paint.b, roughness));
                m = Lit("Painted " + ColorUtility.ToHtmlStringRGB(color), set, Color.white);
                cache.Add(key, m);
            }
            return m;
        }

        /// <summary>A light-emitting surface of `nits` (cd/m²).</summary>
        public Material Emissive(Color color, float nits)
        {
            string key = "emit" + ColorUtility.ToHtmlStringRGB(color) + nits;
            if (!cache.TryGetValue(key, out Material m))
            {
                m = Flat("Emissive " + ColorUtility.ToHtmlStringRGB(color), Linear(0.02f, 0.02f, 0.02f), 0.7f);
                HDMaterial.SetUseEmissiveIntensity(m, true);
                HDMaterial.SetEmissiveColor(m, color);
                HDMaterial.SetEmissiveIntensity(m, nits, EmissiveIntensityUnit.Nits);
                HDMaterial.ValidateMaterial(m);
                cache.Add(key, m);
            }
            return m;
        }

        /// <summary>A colour given in linear, encoded for Material.SetColor.</summary>
        static Color Linear(float r, float g, float b, float a = 1f) => new Color(r, g, b, a).gamma;

        Material New(string name)
        {
            var m = new Material(lit) { name = name, enableInstancing = true, hideFlags = HideFlags.DontSave };
            created.Add(m);
            return m;
        }

        /// <summary>HDRP/Lit with a baked set, tiled at the set's size (or `tile` metres).</summary>
        Material Lit(string name, PbrSet set, Color baseColor, float coat = 0f, float tile = 0f)
        {
            Material m = New(name);
            m.SetColor("_BaseColor", baseColor);
            m.SetTexture("_BaseColorMap", set.albedo);
            m.SetTexture("_NormalMap", set.normal);
            m.SetTexture("_MaskMap", set.mask);
            m.SetFloat("_NormalScale", 1f);
            float t = tile > 0f ? tile : set.tile;
            m.SetTextureScale("_BaseColorMap", new Vector2(1f / t, 1f / t));
            if (coat > 0f) m.SetFloat("_CoatMask", coat);
            HDMaterial.ValidateMaterial(m);
            return m;
        }

        /// <summary>HDRP/Lit without textures: a colour and a smoothness.</summary>
        Material Flat(string name, Color color, float smoothness, float metallic = 0f)
        {
            Material m = New(name);
            m.SetColor("_BaseColor", color);
            m.SetFloat("_Smoothness", smoothness);
            m.SetFloat("_Metallic", metallic);
            HDMaterial.ValidateMaterial(m);
            return m;
        }

        static Material DoubleSided(Material m)
        {
            m.SetFloat("_DoubleSidedEnable", 1f);
            m.doubleSidedGI = true;
            HDMaterial.ValidateMaterial(m);
            return m;
        }

        /// <summary>Transparent glass: dark tint, very smooth, keeps its reflections, receives SSR.</summary>
        Material Glass(string name, Color tint, float metallic)
        {
            Material m = New(name);
            m.SetColor("_BaseColor", tint);
            m.SetTexture("_BaseColorMap", glass.albedo);
            m.SetTexture("_NormalMap", glass.normal);
            m.SetTexture("_MaskMap", glass.mask);
            m.SetTextureScale("_BaseColorMap", new Vector2(1f / glass.tile, 1f / glass.tile));
            // With a mask map, metallic = lerp(remap min, remap max, mask R); the glass mask has R = 0.
            m.SetFloat("_Metallic", metallic);
            m.SetFloat("_MetallicRemapMin", metallic);
            m.SetFloat("_MetallicRemapMax", metallic);
            HDMaterial.SetSurfaceType(m, true);
            m.SetFloat("_BlendMode", 0f);
            m.SetFloat("_EnableBlendModePreserveSpecularLighting", 1f);
            m.SetFloat("_ReceivesSSRTransparent", 1f);
            HDMaterial.ValidateMaterial(m);
            return m;
        }

        Material NewDecal(string name)
        {
            var m = new Material(decal) { name = name, enableInstancing = true, hideFlags = HideFlags.DontSave };
            created.Add(m);
            return m;
        }

        /// <summary>Road paint: colour with worn alpha, a little smoother than the asphalt.</summary>
        Material PaintDecal(string name, RenderTexture wear, Color color)
        {
            Material m = NewDecal(name);
            m.SetColor("_BaseColor", color);
            m.SetTexture("_BaseColorMap", wear);
            m.SetFloat("_AffectAlbedo", 1f);
            m.SetFloat("_AffectNormal", 0f);
            m.SetFloat("_AffectSmoothness", 1f);
            m.SetFloat("_AffectAO", 0f);
            m.SetFloat("_AffectMetal", 0f);
            // Smoothness where the paint is: opacity from the colour's alpha, not a mask map.
            m.SetFloat("_MaskBlendSrc", 0f);
            m.SetFloat("_Smoothness", 0.5f);
            m.SetFloat("_DecalBlend", 1f);
            HDMaterial.ValidateMaterial(m);
            return m;
        }

        /// <summary>Standing water: darkens the asphalt, flattens it and makes it a mirror.</summary>
        Material PuddleDecal(RenderTexture[] maps, int index)
        {
            Material m = NewDecal("Puddle " + index);
            m.SetColor("_BaseColor", Color.white);
            m.SetTexture("_BaseColorMap", maps[0]);
            m.SetTexture("_MaskMap", maps[1]);
            m.SetTexture("_NormalMap", maps[2]);
            m.SetFloat("_AffectAlbedo", 1f);
            m.SetFloat("_AffectNormal", 1f);
            m.SetFloat("_AffectSmoothness", 1f);
            m.SetFloat("_AffectAO", 0f);
            m.SetFloat("_AffectMetal", 0f);
            // Normal and smoothness opacity from the mask map's blue channel.
            m.SetFloat("_NormalBlendSrc", 1f);
            m.SetFloat("_MaskBlendSrc", 1f);
            m.SetFloat("_DecalBlend", 1f);
            HDMaterial.ValidateMaterial(m);
            return m;
        }

        public void Release()
        {
            foreach (Material m in created)
            {
                if (m == null) continue;
                if (Application.isPlaying) Object.Destroy(m);
                else Object.DestroyImmediate(m);
            }
            created.Clear();
            cache.Clear();
            textures.Release();
        }
    }
}
