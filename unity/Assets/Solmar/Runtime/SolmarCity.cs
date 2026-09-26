using System.Collections.Generic;
using Solmar.City;
using Solmar.Rendering;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar
{
    /// <summary>
    /// Generates the procedural city block when enabled, in the editor and in play mode: textures
    /// (baked on the GPU), the street, buildings, street furniture, palms, road decals, and the
    /// daylight (sun, sky, fog, exposure and camera effects). Nothing is loaded from files and
    /// nothing generated is saved into the scene; it is rebuilt from the seed every time.
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class SolmarCity : MonoBehaviour
    {
        [Tooltip("ProceduralTextures.compute")]
        public ComputeShader textureShader;
        [Tooltip("HDRP/Lit")]
        public Shader litShader;
        [Tooltip("HDRP/Decal")]
        public Shader decalShader;

        [Tooltip("Resolution of the large surfaces' textures (small objects use half).")]
        public int textureSize = 2048;
        [Tooltip("Same seed, same city.")]
        public uint seed = 7;

        [Header("Sun")]
        [Range(-5f, 90f)] public float sunElevation = 12f;
        [Range(0f, 360f)] public float sunAzimuth = 188f;
        [Tooltip("Create the sun, sky and camera effects (turn off to light the scene yourself).")]
        public bool createDaylight = true;

        CityMaterials materials;
        GameObject generated;
        VolumeProfile profile;

        void OnEnable()
        {
            Generate();
        }

        void OnDisable()
        {
            Clear();
        }

        /// <summary>Throws away what was generated and builds it again.</summary>
        [ContextMenu("Regenerate")]
        public void Regenerate()
        {
            Clear();
            Generate();
        }

        void Generate()
        {
            if (generated != null) return;
            if (textureShader == null || litShader == null || decalShader == null)
            {
                Debug.LogWarning("Solmar City: assign the texture compute shader and the HDRP/Lit and HDRP/Decal shaders (Solmar > Create Street Scene does this).", this);
                return;
            }
            var random = new Rng(seed);
            materials = new CityMaterials(litShader, decalShader, new ProceduralTextures(textureShader), textureSize);
            generated = new GameObject("Generated city");
            generated.transform.SetParent(transform, false);
            Transform root = generated.transform;

            AddSurface(root, "Road", Street.BuildRoad(), materials.Road);
            AddSurface(root, "North pavement", Street.BuildPavement(1), materials.Pavement);
            AddSurface(root, "South pavement", Street.BuildPavement(-1), materials.Pavement);
            Buildings.Build(root, materials, random);
            StreetFurniture.Build(root, materials, random);
            RoadDecals.Build(root, materials, random);

            if (createDaylight)
            {
                Vector3 towardsSun = Atmosphere.SunDirection(sunElevation, sunAzimuth);
                Atmosphere.CreateSun(root, towardsSun);
                Atmosphere.CreateVolume(root, out profile);
                Atmosphere.CreateProbe(root, new Vector3(Layout.CrossingX + 10f, 2f, 0f), new Vector3(180f, 40f, 2f * Layout.BuildingZ));
            }

            // Generated content is rebuilt on load and never saved with the scene.
            foreach (Transform t in generated.GetComponentsInChildren<Transform>(true)) t.gameObject.hideFlags = HideFlags.DontSave;
            foreach (MeshFilter f in generated.GetComponentsInChildren<MeshFilter>(true))
            {
                if (f.sharedMesh != null) f.sharedMesh.hideFlags = HideFlags.DontSave;
            }
        }

        static void AddSurface(Transform parent, string name, Mesh mesh, Material material)
        {
            mesh.hideFlags = HideFlags.DontSave;
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = material;
            r.shadowCastingMode = ShadowCastingMode.On;
            go.isStatic = true;
        }

        void Clear()
        {
            if (generated != null)
            {
                // Instances of a street furniture model share one mesh: destroy each mesh once.
                var meshes = new HashSet<Mesh>();
                foreach (MeshFilter f in generated.GetComponentsInChildren<MeshFilter>(true))
                {
                    if (f.sharedMesh != null) meshes.Add(f.sharedMesh);
                }
                Dispose(generated);
                generated = null;
                foreach (Mesh mesh in meshes) Dispose(mesh);
            }
            if (materials != null)
            {
                materials.Release();
                materials = null;
            }
            if (profile != null)
            {
                foreach (VolumeComponent component in profile.components) Dispose(component);
                Dispose(profile);
                profile = null;
            }
        }

        static void Dispose(Object o)
        {
            if (Application.isPlaying) Destroy(o);
            else DestroyImmediate(o);
        }
    }
}
