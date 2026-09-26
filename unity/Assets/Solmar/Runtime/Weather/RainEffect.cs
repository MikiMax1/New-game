using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar.Weather
{
    /// <summary>
    /// Falling rain and ground splashes, built entirely in code and kept centred on the camera so a
    /// fixed particle budget covers however far the player roams. Two HDRP/Unlit materials (additive
    /// streaks, a soft splash ring baked into a tiny procedural texture) are the only "assets", and
    /// both are generated the first time it runs. Not a MonoBehaviour: Weather owns the instance and
    /// calls Advance every frame, the same shape as WeatherVisuals.
    /// </summary>
    public sealed class RainEffect
    {
        const float StreakHeight = 16f;
        const float StreakBoxHalf = 24f;
        const float SplashRadius = 14f;
        const float SplashGroundY = 0.05f;
        const float MaxStreakRate = 3200f;
        const float MaxSplashRate = 130f;

        GameObject root;
        Transform streaksT, splashesT;
        ParticleSystem streaks, splashes;
        bool built;

        /// <summary>Builds the particle systems on first use and moves/feeds them every frame.
        /// `rain` is the smoothed 0..1 rain intensity; particles stop spawning (but are left to fall
        /// out naturally) once it's effectively zero.</summary>
        public void Advance(Transform parent, Shader unlitShader, Transform camera, float rain, float dt)
        {
            if (!built) Build(parent, unlitShader);
            if (!built || camera == null) return;

            Vector3 camPos = camera.position;
            streaksT.position = new Vector3(camPos.x, camPos.y + StreakHeight, camPos.z);
            splashesT.position = new Vector3(camPos.x, SplashGroundY, camPos.z);

            var streakEmission = streaks.emission;
            streakEmission.rateOverTime = rain * MaxStreakRate;
            var splashEmission = splashes.emission;
            splashEmission.rateOverTime = rain * MaxSplashRate;
        }

        void Build(Transform parent, Shader unlitShader)
        {
            if (unlitShader == null) return;

            root = new GameObject("Rain") { hideFlags = HideFlags.DontSave };
            root.transform.SetParent(parent, false);

            streaks = BuildStreaks(root.transform, unlitShader);
            streaksT = streaks.transform;
            splashes = BuildSplashes(root.transform, unlitShader);
            splashesT = splashes.transform;

            built = true;
        }

        static ParticleSystem BuildStreaks(Transform parent, Shader unlitShader)
        {
            var go = new GameObject("Streaks") { hideFlags = HideFlags.DontSave };
            go.transform.SetParent(parent, false);
            var ps = go.AddComponent<ParticleSystem>();

            var main = ps.main;
            main.loop = true;
            main.playOnAwake = false;
            main.startLifetime = 1.1f;
            main.startSpeed = 0f;
            main.startSize = new ParticleSystem.MinMaxCurve(0.025f, 0.05f);
            main.startColor = new Color(0.75f, 0.8f, 0.85f, 0.3f);
            main.maxParticles = 4000;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.gravityModifier = 0f;

            var emission = ps.emission;
            emission.rateOverTime = 0f;

            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Box;
            shape.scale = new Vector3(StreakBoxHalf * 2f, 0.2f, StreakBoxHalf * 2f);

            var vel = ps.velocityOverLifetime;
            vel.enabled = true;
            vel.space = ParticleSystemSimulationSpace.World;
            vel.y = new ParticleSystem.MinMaxCurve(-18f, -14f);
            vel.x = new ParticleSystem.MinMaxCurve(-1.2f, 1.2f);
            vel.z = new ParticleSystem.MinMaxCurve(-1.2f, 1.2f);

            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Stretch;
            renderer.velocityScale = 0.05f;
            renderer.lengthScale = 3.5f;
            renderer.alignment = ParticleSystemRenderSpace.World;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.material = MakeMaterial(unlitShader, new Color(0.85f, 0.9f, 0.95f, 1f), null, additive: true);

            ps.Play();
            return ps;
        }

        static ParticleSystem BuildSplashes(Transform parent, Shader unlitShader)
        {
            var go = new GameObject("Splashes") { hideFlags = HideFlags.DontSave };
            go.transform.SetParent(parent, false);
            var ps = go.AddComponent<ParticleSystem>();

            var main = ps.main;
            main.loop = true;
            main.playOnAwake = false;
            main.startLifetime = 0.35f;
            main.startSpeed = 0f;
            main.startSize = new ParticleSystem.MinMaxCurve(0.12f, 0.35f);
            main.startColor = new Color(0.8f, 0.85f, 0.9f, 0.6f);
            main.maxParticles = 600;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.gravityModifier = 0f;

            var emission = ps.emission;
            emission.rateOverTime = 0f;

            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Circle;
            shape.radius = SplashRadius;
            shape.rotation = new Vector3(-90f, 0f, 0f);

            var size = ps.sizeOverLifetime;
            size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0f, 0.2f, 1f, 1f));

            var color = ps.colorOverLifetime;
            color.enabled = true;
            var gradient = new Gradient();
            gradient.SetKeys(
                new[] { new GradientColorKey(Color.white, 0f), new GradientColorKey(Color.white, 1f) },
                new[] { new GradientAlphaKey(0.7f, 0f), new GradientAlphaKey(0f, 1f) });
            color.color = gradient;

            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Billboard;
            renderer.alignment = ParticleSystemRenderSpace.View;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.material = MakeMaterial(unlitShader, Color.white, MakeSplashSprite(), additive: true);

            ps.Play();
            return ps;
        }

        static Material MakeMaterial(Shader unlitShader, Color color, Texture2D sprite, bool additive)
        {
            var m = new Material(unlitShader) { name = "Rain particle", enableInstancing = true, hideFlags = HideFlags.DontSave };
            m.SetColor("_UnlitColor", color);
            if (sprite != null) m.SetTexture("_UnlitColorMap", sprite);
            HDMaterial.SetSurfaceType(m, true);
            m.SetFloat("_BlendMode", additive ? 1f : 0f);
            m.SetFloat("_ZWrite", 0f);
            HDMaterial.ValidateMaterial(m);
            return m;
        }

        /// <summary>A tiny soft ring, baked on the CPU once: a ripple sprite for the splash billboards
        /// with no external texture involved.</summary>
        static Texture2D MakeSplashSprite()
        {
            const int size = 24;
            var tex = new Texture2D(size, size, TextureFormat.Alpha8, false, true) { hideFlags = HideFlags.DontSave, wrapMode = TextureWrapMode.Clamp };
            var pixels = new Color32[size * size];
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float u = (x + 0.5f) / size * 2f - 1f;
                    float v = (y + 0.5f) / size * 2f - 1f;
                    float r = Mathf.Sqrt(u * u + v * v);
                    float ring = Mathf.Clamp01(1f - Mathf.Abs(r - 0.55f) * 4.5f);
                    pixels[y * size + x] = new Color32(255, 255, 255, (byte)(ring * 255f));
                }
            }
            tex.SetPixels32(pixels);
            tex.Apply(false, true);
            return tex;
        }
    }
}
