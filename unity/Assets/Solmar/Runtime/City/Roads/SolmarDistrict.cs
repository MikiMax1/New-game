using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Generates a downtown grid district (Phase 2.1/2.2 of the plan: a road graph with a grid of
    /// streets and one avenue, its intersections, kerbs, sidewalks, kerb ramps, lane markings,
    /// street lamps and signals, and buildings filling every block) when enabled, in the editor and
    /// in play mode, the same way SolmarCity builds the single street: nothing is loaded from files
    /// and nothing generated is saved into the scene; it is rebuilt from the seed every time.
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class SolmarDistrict : MonoBehaviour
    {
        [Tooltip("ProceduralTextures.compute")]
        public ComputeShader textureShader;
        [Tooltip("HDRP/Lit")]
        public Shader litShader;
        [Tooltip("HDRP/Decal")]
        public Shader decalShader;

        [Tooltip("Resolution of the large surfaces' textures (small objects use half).")]
        public int textureSize = 2048;
        [Tooltip("Same seed, same district.")]
        public uint seed = 11;

        [Header("Sun")]
        [Range(-5f, 90f)] public float sunElevation = 32f;
        [Range(0f, 360f)] public float sunAzimuth = 205f;
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
                Debug.LogWarning("Solmar District: assign the texture compute shader and the HDRP/Lit and HDRP/Decal shaders (Solmar > Create District Scene does this).", this);
                return;
            }
            var random = new Rng(seed);
            materials = new CityMaterials(litShader, decalShader, new ProceduralTextures(textureShader), textureSize);
            generated = new GameObject("Generated district");
            generated.transform.SetParent(transform, false);

            DistrictGenerator.Build(generated.transform, materials, random);

            if (createDaylight)
            {
                Vector3 centre = new Vector3(DistrictGenerator.BlockLengthX * (DistrictGenerator.Columns - 1) * 0.5f, 0f, DistrictGenerator.BlockLengthZ * (DistrictGenerator.Rows - 1) * 0.5f);
                Vector3 towardsSun = Atmosphere.SunDirection(sunElevation, sunAzimuth);
                Atmosphere.CreateSun(generated.transform, towardsSun);
                Atmosphere.CreateVolume(generated.transform, out profile);
                Atmosphere.CreateProbe(generated.transform, centre + new Vector3(0f, 20f, 0f), new Vector3(DistrictGenerator.BlockLengthX * DistrictGenerator.Columns, 60f, DistrictGenerator.BlockLengthZ * DistrictGenerator.Rows));
            }

            // Generated content is rebuilt on load and never saved with the scene.
            foreach (Transform t in generated.GetComponentsInChildren<Transform>(true)) t.gameObject.hideFlags = HideFlags.DontSave;
            foreach (MeshFilter f in generated.GetComponentsInChildren<MeshFilter>(true))
            {
                if (f.sharedMesh != null) f.sharedMesh.hideFlags = HideFlags.DontSave;
            }
        }

        void Clear()
        {
            if (generated != null)
            {
                // Instances of a shared model (lamps, signals, palms) share one mesh: destroy each once.
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
