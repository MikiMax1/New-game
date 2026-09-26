using System.Collections.Generic;
using UnityEngine;

namespace Solmar.Rendering
{
    /// <summary>A baked PBR texture set: HDRP base colour, normal and mask maps.</summary>
    public sealed class PbrSet
    {
        public RenderTexture albedo;
        public RenderTexture normal;
        public RenderTexture mask;
        /// <summary>Real-world size of one tile, metres (materials tile by 1 / tile per metre of UV).</summary>
        public float tile;
    }

    /// <summary>
    /// Bakes seamless PBR texture sets on the GPU with ProceduralTextures.compute: fields (height and
    /// masks), then normals, albedo and the HDRP mask map from them. Maps are mipmapped with 16×
    /// anisotropic filtering and repeat-wrapped.
    /// </summary>
    public sealed class ProceduralTextures
    {
        public enum Recipe
        {
            Asphalt = 0,
            Pavement = 1,
            Concrete = 2,
            Stucco = 3,
            Painted = 4,
            Glass = 5,
            Granite = 6,
            Galvanised = 7,
            Brushed = 8,
        }

        readonly ComputeShader shader;
        readonly List<RenderTexture> owned = new List<RenderTexture>();
        readonly int kFields, kNormals, kAlbedo, kMask, kPaint, kPuddle;

        public ProceduralTextures(ComputeShader shader)
        {
            this.shader = shader;
            kFields = shader.FindKernel("Fields");
            kNormals = shader.FindKernel("Normals");
            kAlbedo = shader.FindKernel("Albedo");
            kMask = shader.FindKernel("Mask");
            kPaint = shader.FindKernel("PaintWear");
            kPuddle = shader.FindKernel("Puddle");
        }

        RenderTexture Target(string name, int size, RenderTextureFormat format, bool mips)
        {
            var rt = new RenderTexture(size, size, 0, format, RenderTextureReadWrite.Linear)
            {
                name = name,
                enableRandomWrite = true,
                useMipMap = mips,
                autoGenerateMips = false,
                wrapMode = TextureWrapMode.Repeat,
                filterMode = mips ? FilterMode.Trilinear : FilterMode.Bilinear,
                anisoLevel = 16,
                hideFlags = HideFlags.DontSave,
            };
            rt.Create();
            owned.Add(rt);
            return rt;
        }

        void Run(int kernel, RenderTexture output, RenderTexture fields, int size)
        {
            shader.SetTexture(kernel, "_Out", output);
            shader.SetTexture(kernel, "_FieldsTex", fields != null ? (Texture)fields : Texture2D.blackTexture);
            shader.SetInt("_Size", size);
            shader.Dispatch(kernel, Mathf.CeilToInt(size / 8f), Mathf.CeilToInt(size / 8f), 1);
        }

        /// <summary>
        /// Bakes one set. `tint` is the paint colour for painted metal (alpha = paint roughness) and
        /// is ignored otherwise (materials tint stucco with their base colour).
        /// </summary>
        public PbrSet Bake(Recipe recipe, float tile, int size, Color tint)
        {
            shader.SetInt("_Recipe", (int)recipe);
            shader.SetFloat("_Tile", tile);
            shader.SetVector("_Tint", new Vector4(tint.r, tint.g, tint.b, tint.a));
            string n = recipe.ToString();
            RenderTexture fields = Target(n + ".fields", size, RenderTextureFormat.ARGBHalf, false);
            Run(kFields, fields, null, size);
            var set = new PbrSet
            {
                tile = tile,
                normal = Target(n + ".normal", size, RenderTextureFormat.ARGB32, true),
                albedo = Target(n + ".albedo", size, RenderTextureFormat.ARGBHalf, true),
                mask = Target(n + ".mask", size, RenderTextureFormat.ARGB32, true),
            };
            Run(kNormals, set.normal, fields, size);
            Run(kAlbedo, set.albedo, fields, size);
            Run(kMask, set.mask, fields, size);
            set.normal.GenerateMips();
            set.albedo.GenerateMips();
            set.mask.GenerateMips();
            owned.Remove(fields);
            Destroy(fields);
            return set;
        }

        /// <summary>Road paint for the marking decals: white, alpha worn away (1 m per tile).</summary>
        public RenderTexture PaintWear(int size)
        {
            RenderTexture rt = Target("PaintWear", size, RenderTextureFormat.ARGB32, true);
            Run(kPaint, rt, null, size);
            rt.GenerateMips();
            return rt;
        }

        /// <summary>One puddle decal: base colour (0), mask (1) and normal (2) textures.</summary>
        public RenderTexture[] Puddle(int size, float seed)
        {
            var maps = new RenderTexture[3];
            shader.SetFloat("_Seed", seed);
            for (int mode = 0; mode < 3; mode++)
            {
                shader.SetInt("_Mode", mode);
                maps[mode] = Target("Puddle" + mode, size, RenderTextureFormat.ARGB32, true);
                maps[mode].wrapMode = TextureWrapMode.Clamp;
                Run(kPuddle, maps[mode], null, size);
                maps[mode].GenerateMips();
            }
            return maps;
        }

        /// <summary>Frees every texture this baker made.</summary>
        public void Release()
        {
            foreach (RenderTexture rt in owned) Destroy(rt);
            owned.Clear();
        }

        static void Destroy(RenderTexture rt)
        {
            if (rt == null) return;
            rt.Release();
            if (Application.isPlaying) Object.Destroy(rt);
            else Object.DestroyImmediate(rt);
        }
    }
}
