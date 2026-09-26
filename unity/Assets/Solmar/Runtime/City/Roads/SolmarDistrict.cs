using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Generates the city of Solmar (<see cref="DistrictGenerator"/>: its streets, junctions,
    /// pavements, markings, lamps and signals, buildings, parks, beach and sea) when enabled, in
    /// the editor and in play mode, the same way SolmarCity builds the single street: nothing is
    /// loaded from files and nothing generated is saved into the scene; it is rebuilt from the
    /// seed every time.
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
        [Tooltip("Same seed, same city.")]
        public uint seed = 11;

        [Header("Sun")]
        [Range(-5f, 90f)] public float sunElevation = 32f;
        [Range(0f, 360f)] public float sunAzimuth = 205f;
        [Tooltip("Create the sun, sky and camera effects (turn off to light the scene yourself).")]
        public bool createDaylight = true;

        /// <summary>Where the player starts (on a pavement, facing the street), once a city has been generated.</summary>
        public static Pose PlayerSpawn { get; private set; } = Pose.identity;
        /// <summary>Where the player's car starts (parked at the kerb beside the player, facing with the traffic in its lane).</summary>
        public static Pose CarSpawn { get; private set; } = Pose.identity;
        /// <summary>True once a city has been generated and the spawn poses are set.</summary>
        public static bool HasSpawn { get; private set; }

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
                Debug.LogWarning("Solmar District: assign the texture compute shader and the HDRP/Lit and HDRP/Decal shaders (Solmar > Create City Scene does this).", this);
                return;
            }
            var random = new Rng(seed);
            materials = new CityMaterials(litShader, decalShader, new ProceduralTextures(textureShader), textureSize);
            generated = new GameObject("Generated district");
            generated.transform.SetParent(transform, false);

            CityPlan plan = DistrictGenerator.Build(generated.transform, materials, seed, random);
            SetSpawns(plan);
            generated.AddComponent<SignalLamps>();

            if (createDaylight)
            {
                Vector3 towardsSun = Atmosphere.SunDirection(sunElevation, sunAzimuth);
                Atmosphere.CreateSun(generated.transform, towardsSun);
                Atmosphere.CreateVolume(generated.transform, out profile);
                // The city is two kilometres across: thin the haze so the far side still reads.
                if (profile != null && profile.TryGet(out Fog fog))
                {
                    fog.meanFreePath.Override(900f);
                    fog.maximumHeight.Override(220f);
                }
                Vector3 spawn = PlayerSpawn.position;
                Atmosphere.CreateProbe(generated.transform, new Vector3(spawn.x, 25f, spawn.z), new Vector3(600f, 160f, 600f));
            }

            // Generated content is rebuilt on load and never saved with the scene.
            foreach (Transform t in generated.GetComponentsInChildren<Transform>(true)) t.gameObject.hideFlags = HideFlags.DontSave;
            foreach (MeshFilter f in generated.GetComponentsInChildren<MeshFilter>(true))
            {
                if (f.sharedMesh != null) f.sharedMesh.hideFlags = HideFlags.DontSave;
            }
        }

        static void SetSpawns(CityPlan plan)
        {
            Vector2 p = plan.PlayerSpawn, pf = plan.PlayerFacing, c = plan.CarSpawn, cf = plan.CarFacing;
            PlayerSpawn = new Pose(new Vector3(p.x, RoadWidths.KerbHeight, p.y), Facing(pf));
            CarSpawn = new Pose(new Vector3(c.x, 0f, c.y), Facing(cf));
            HasSpawn = true;
        }

        static Quaternion Facing(Vector2 d)
        {
            if (!(d.sqrMagnitude > 1e-6f) || !float.IsFinite(d.x) || !float.IsFinite(d.y)) return Quaternion.identity;
            return Quaternion.LookRotation(new Vector3(d.x, 0f, d.y), Vector3.up);
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
                foreach (MeshCollider c in generated.GetComponentsInChildren<MeshCollider>(true))
                {
                    if (c.sharedMesh != null) meshes.Add(c.sharedMesh);
                }
                Dispose(generated);
                generated = null;
                foreach (Mesh mesh in meshes) Dispose(mesh);
            }
            RoadFurniture.Signals.Clear();
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
