using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar.Police
{
    /// <summary>
    /// A simple code-built police helicopter for 4-5 stars: a boxy fuselage, tail boom and fin, skids,
    /// a spinning main rotor and tail rotor (built with <see cref="MeshBuilder"/>, no outside assets),
    /// and a spotlight that switches on with the street lights (<see cref="PoliceManager.IsNight"/>)
    /// and tracks the player. It hovers at a fixed altitude above <see cref="PoliceManager.PlayerPosition"/>,
    /// smoothly chasing the player's ground position rather than following any lane graph.
    /// </summary>
    public sealed class PoliceHelicopter : MonoBehaviour
    {
        const float HoverAltitude = 60f;
        const float FollowSmoothTime = 0.7f;
        const float MainRotorDegPerSec = 640f;
        const float TailRotorDegPerSec = 1500f;
        const float SpotlightLumen = 3_000_000f;

        public bool Active { get; private set; }
        public Vector3 Position => cachedTransform != null ? cachedTransform.position : Vector3.zero;

        Transform cachedTransform;
        Transform mainRotor;
        Transform tailRotor;
        Transform spotlightTransform;
        Light spotlight;
        float rotorDeg;
        Vector3 followVelocity;
        bool placed;

        public static PoliceHelicopter Build(Transform parent)
        {
            var go = new GameObject("Police helicopter");
            go.transform.SetParent(parent, false);
            var heli = go.AddComponent<PoliceHelicopter>();
            heli.BuildMesh();
            go.SetActive(false);
            return heli;
        }

        void Awake() => cachedTransform = transform;

        void BuildMesh()
        {
            Shader shader = Shader.Find("HDRP/Lit");
            var bodyMat = new Material(shader != null ? shader : Shader.Find("Hidden/InternalErrorShader")) { name = "Heli body", hideFlags = HideFlags.DontSave };
            bodyMat.SetColor("_BaseColor", new Color(0.045f, 0.05f, 0.06f));
            bodyMat.SetFloat("_Smoothness", 0.55f);
            bodyMat.SetFloat("_Metallic", 0.35f);
            HDMaterial.ValidateMaterial(bodyMat);

            var glassMat = new Material(bodyMat) { name = "Heli glass", hideFlags = HideFlags.DontSave };
            glassMat.SetColor("_BaseColor", new Color(0.03f, 0.05f, 0.06f));
            glassMat.SetFloat("_Smoothness", 0.9f);
            HDMaterial.ValidateMaterial(glassMat);

            var rotorMat = new Material(bodyMat) { name = "Heli rotor", hideFlags = HideFlags.DontSave };
            rotorMat.SetColor("_BaseColor", new Color(0.02f, 0.02f, 0.02f));
            HDMaterial.ValidateMaterial(rotorMat);

            var fuselage = new MeshBuilder("Heli fuselage");
            fuselage.Box(bodyMat, -1.1f, 0.9f, -0.75f, 2.0f, 1.5f, 0.75f, 0.12f);
            fuselage.Box(glassMat, 1.05f, 1.0f, -0.55f, 1.9f, 1.4f, 0.55f, 0.05f);
            fuselage.Box(bodyMat, -3.6f, 0.55f, -0.18f, -1.0f, 0.95f, 0.18f, 0.05f);
            fuselage.Box(bodyMat, -3.75f, 0.55f, -0.05f, -3.35f, 1.55f, 0.05f, 0.03f);
            fuselage.Build(cachedTransform);

            var skids = new MeshBuilder("Heli skids");
            skids.Box(rotorMat, -1.0f, -0.05f, 0.75f, 1.6f, 0.05f, 0.85f, 0.02f);
            skids.Box(rotorMat, -1.0f, -0.05f, -0.85f, 1.6f, 0.05f, -0.75f, 0.02f);
            skids.Box(rotorMat, -0.9f, 0.0f, 0.6f, -0.8f, 1.05f, 0.9f, 0.01f);
            skids.Box(rotorMat, 1.3f, 0.0f, 0.6f, 1.4f, 1.05f, 0.9f, 0.01f);
            skids.Box(rotorMat, -0.9f, 0.0f, -0.9f, -0.8f, 1.05f, -0.6f, 0.01f);
            skids.Box(rotorMat, 1.3f, 0.0f, -0.9f, 1.4f, 1.05f, -0.6f, 0.01f);
            skids.Build(cachedTransform);

            var mainHub = new GameObject("Main rotor").transform;
            mainHub.SetParent(cachedTransform, false);
            mainHub.localPosition = new Vector3(0.2f, 1.55f, 0f);
            mainRotor = mainHub;
            var mainBlades = new MeshBuilder("Main rotor blades");
            mainBlades.Box(rotorMat, -3.4f, -0.08f, -0.05f, 3.4f, 0.02f, 0.05f, 0.01f);
            mainBlades.Box(rotorMat, -0.05f, -0.08f, -3.4f, 0.05f, 0.02f, 3.4f, 0.01f);
            mainBlades.Build(mainHub);

            var tailHub = new GameObject("Tail rotor").transform;
            tailHub.SetParent(cachedTransform, false);
            tailHub.localPosition = new Vector3(-3.7f, 1.05f, 0f);
            tailRotor = tailHub;
            var tailBlades = new MeshBuilder("Tail rotor blades");
            tailBlades.Box(rotorMat, -0.02f, -0.02f, -0.55f, 0.02f, 0.02f, 0.55f, 0.005f);
            tailBlades.Box(rotorMat, -0.55f, -0.02f, -0.02f, 0.55f, 0.02f, 0.02f, 0.005f);
            tailBlades.Build(tailHub);

            var lightGo = new GameObject("Spotlight");
            lightGo.transform.SetParent(cachedTransform, false);
            lightGo.transform.localPosition = new Vector3(0.6f, -0.1f, 0f);
            lightGo.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            spotlightTransform = lightGo.transform;
            spotlight = lightGo.AddComponent<Light>();
            spotlight.type = LightType.Spot;
            var hd = lightGo.AddComponent<HDAdditionalLightData>();
            HDAdditionalLightData.InitDefaultHDAdditionalLightData(hd);
            spotlight.range = 95f;
            spotlight.color = new Color(1f, 0.98f, 0.9f);
            spotlight.lightUnit = LightUnit.Lumen;
            spotlight.intensity = 0f;
            spotlight.shadows = LightShadows.None;
            hd.SetSpotAngle(26f, 16f);
            hd.EnableShadows(false);
        }

        public void SetActive(bool on)
        {
            if (Active == on) return;
            Active = on;
            gameObject.SetActive(on);
            if (!on)
            {
                placed = false;
                if (spotlight != null) spotlight.intensity = 0f;
            }
        }

        public void Tick(float dt, PoliceManager manager)
        {
            if (!Active || dt <= 0f || !float.IsFinite(dt)) return;

            Vector3 target = manager.PlayerPosition + Vector3.up * HoverAltitude;
            if (!placed)
            {
                cachedTransform.position = target;
                followVelocity = Vector3.zero;
                placed = true;
            }
            else
            {
                Vector3 pos = Vector3.SmoothDamp(cachedTransform.position, target, ref followVelocity, FollowSmoothTime, 55f, dt);
                if (IsFinite(pos)) cachedTransform.position = pos;
            }

            Vector3 planarVel = followVelocity; planarVel.y = 0f;
            if (planarVel.sqrMagnitude > 0.4f)
            {
                Quaternion targetRot = Quaternion.LookRotation(planarVel.normalized, Vector3.up);
                cachedTransform.rotation = Quaternion.RotateTowards(cachedTransform.rotation, targetRot, 45f * dt);
            }

            rotorDeg = Mathf.Repeat(rotorDeg + MainRotorDegPerSec * dt, 360f);
            if (mainRotor != null) mainRotor.localRotation = Quaternion.Euler(0f, rotorDeg, 0f);
            if (tailRotor != null) tailRotor.localRotation = Quaternion.Euler(rotorDeg * (TailRotorDegPerSec / MainRotorDegPerSec), 0f, 0f);

            if (spotlight != null)
            {
                if (manager.IsNight)
                {
                    Vector3 toPlayer = manager.PlayerPosition - spotlightTransform.position;
                    if (toPlayer.sqrMagnitude > 0.01f) spotlightTransform.rotation = Quaternion.LookRotation(toPlayer.normalized, Vector3.up);
                    spotlight.intensity = SpotlightLumen;
                }
                else
                {
                    spotlight.intensity = 0f;
                }
            }
        }

        static bool IsFinite(Vector3 v) => float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z);
    }
}
