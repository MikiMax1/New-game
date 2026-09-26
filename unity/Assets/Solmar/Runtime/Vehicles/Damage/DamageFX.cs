using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar.Vehicles.Damage
{
    /// <summary>
    /// Builds the code-only particle systems and materials <see cref="VehicleDamage"/> plays: engine
    /// smoke (white/black), an underbonnet fire, wall-scrape sparks, a glass-shard burst, an explosion
    /// fireball and a debris-chunk material. Everything here is baked from HDRP/Unlit or HDRP/Lit with
    /// a tiny CPU-baked sprite (same trick as <see cref="Solmar.Weather.RainEffect"/>), never an
    /// outside texture or model. Materials and the sprite are cached statically and shared by every
    /// car's particle systems; only the (cheap) GameObjects/ParticleSystems themselves are per-car,
    /// and only ever built once, lazily, the first time a given car actually needs them.
    /// </summary>
    static class DamageFX
    {
        static Shader unlitShaderCache;
        static Shader litShaderCache;
        static Texture2D softDotCache;
        static Material smokeWhiteMatCache, smokeBlackMatCache, fireMatCache, sparkMatCache, shardMatCache, fireballMatCache, debrisMatCache;

        static Shader Unlit()
        {
            if (unlitShaderCache == null) unlitShaderCache = Shader.Find("HDRP/Unlit");
            if (unlitShaderCache == null) Debug.LogWarning("Solmar VehicleDamage: HDRP/Unlit shader not found; damage FX materials will be missing.");
            return unlitShaderCache;
        }

        static Shader Lit()
        {
            if (litShaderCache == null) litShaderCache = Shader.Find("HDRP/Lit");
            return litShaderCache;
        }

        /// <summary>A small soft round dot, alpha-only, baked once on the CPU and reused (scaled by
        /// particle size) for smoke, fire, sparks and the fireball.</summary>
        static Texture2D SoftDot()
        {
            if (softDotCache != null) return softDotCache;
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
                    float a = Mathf.Clamp01(1f - Mathf.Pow(r, 1.6f));
                    pixels[y * size + x] = new Color32(255, 255, 255, (byte)(a * 255f));
                }
            }
            tex.SetPixels32(pixels);
            tex.Apply(false, true);
            softDotCache = tex;
            return tex;
        }

        static Material MakeUnlit(ref Material cache, string name, Color color, bool additive)
        {
            if (cache != null) return cache;
            Shader shader = Unlit();
            var m = new Material(shader != null ? shader : Shader.Find("Hidden/InternalErrorShader")) { name = name, enableInstancing = true, hideFlags = HideFlags.DontSave };
            m.SetColor("_UnlitColor", color);
            m.SetTexture("_UnlitColorMap", SoftDot());
            HDMaterial.SetSurfaceType(m, true);
            m.SetFloat("_BlendMode", additive ? 1f : 0f);
            m.SetFloat("_ZWrite", 0f);
            HDMaterial.ValidateMaterial(m);
            cache = m;
            return m;
        }

        public static Material DebrisMaterial()
        {
            if (debrisMatCache != null) return debrisMatCache;
            Shader shader = Lit();
            var m = new Material(shader != null ? shader : Shader.Find("Hidden/InternalErrorShader")) { name = "Wreck debris", hideFlags = HideFlags.DontSave };
            m.SetColor("_BaseColor", new Color(0.05f, 0.045f, 0.04f));
            m.SetFloat("_Smoothness", 0.25f);
            m.SetFloat("_Metallic", 0.3f);
            HDMaterial.ValidateMaterial(m);
            debrisMatCache = m;
            return m;
        }

        static ParticleSystem NewSystem(Transform parent, string name, bool loop, float lifetime, float startSize, Color color, int maxParticles, float gravity)
        {
            var go = new GameObject(name) { hideFlags = HideFlags.DontSave };
            go.transform.SetParent(parent, false);
            var ps = go.AddComponent<ParticleSystem>();
            var main = ps.main;
            main.loop = loop;
            main.playOnAwake = false;
            main.startLifetime = lifetime;
            main.startSpeed = 0f;
            main.startSize = startSize;
            main.startColor = color;
            main.maxParticles = maxParticles;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.gravityModifier = gravity;
            var emission = ps.emission;
            emission.rateOverTime = 0f;
            var renderer = go.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Billboard;
            renderer.alignment = ParticleSystemRenderSpace.View;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            return ps;
        }

        /// <summary>White or black engine smoke, rising and drifting, emission rate driven every frame by <see cref="VehicleDamage"/>.</summary>
        public static ParticleSystem BuildSmoke(Transform parent, bool black)
        {
            Color color = black ? new Color(0.05f, 0.05f, 0.05f, 0.55f) : new Color(0.82f, 0.82f, 0.8f, 0.4f);
            var ps = NewSystem(parent, black ? "Smoke black" : "Smoke white", true, 2.6f, 0.35f, color, 200, 0f);
            var main = ps.main;
            main.startSize = new ParticleSystem.MinMaxCurve(0.25f, 0.5f);

            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 12f;
            shape.radius = 0.08f;

            var vel = ps.velocityOverLifetime;
            vel.enabled = true;
            vel.space = ParticleSystemSimulationSpace.Local;
            vel.y = new ParticleSystem.MinMaxCurve(1.1f, 1.8f);
            vel.x = new ParticleSystem.MinMaxCurve(-0.3f, 0.3f);
            vel.z = new ParticleSystem.MinMaxCurve(-0.3f, 0.3f);

            var size = ps.sizeOverLifetime;
            size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0f, 0.5f, 1f, 1.8f));

            var color2 = ps.colorOverLifetime;
            color2.enabled = true;
            var gradient = new Gradient();
            gradient.SetKeys(
                new[] { new GradientColorKey(color, 0f), new GradientColorKey(color, 1f) },
                new[] { new GradientAlphaKey(0f, 0f), new GradientAlphaKey(black ? 0.6f : 0.4f, 0.15f), new GradientAlphaKey(0f, 1f) });
            color2.color = gradient;

            var renderer = ps.GetComponent<ParticleSystemRenderer>();
            renderer.material = black
                ? MakeUnlit(ref smokeBlackMatCache, "Smoke black FX", Color.white, false)
                : MakeUnlit(ref smokeWhiteMatCache, "Smoke white FX", Color.white, false);
            return ps;
        }

        /// <summary>A small underbonnet fire: a licking orange/red core plus its own light comes from
        /// <see cref="VehicleDamage"/>'s own Light, not this system.</summary>
        public static ParticleSystem BuildFire(Transform parent)
        {
            var ps = NewSystem(parent, "Fire", true, 0.6f, 0.25f, new Color(1f, 0.5f, 0.15f), 120, -0.15f);
            var main = ps.main;
            main.startSize = new ParticleSystem.MinMaxCurve(0.18f, 0.35f);
            main.startSpeed = new ParticleSystem.MinMaxCurve(0.4f, 0.9f);

            var emission = ps.emission;
            emission.rateOverTime = 18f;

            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 8f;
            shape.radius = 0.1f;

            var size = ps.sizeOverLifetime;
            size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0f, 1f, 1f, 0.1f));

            var color = ps.colorOverLifetime;
            color.enabled = true;
            var gradient = new Gradient();
            gradient.SetKeys(
                new[] { new GradientColorKey(new Color(1f, 0.9f, 0.5f), 0f), new GradientColorKey(new Color(1f, 0.25f, 0.03f), 0.5f), new GradientColorKey(new Color(0.3f, 0.03f, 0f), 1f) },
                new[] { new GradientAlphaKey(0.9f, 0f), new GradientAlphaKey(0.7f, 0.6f), new GradientAlphaKey(0f, 1f) });
            color.color = gradient;

            var noise = ps.noise;
            noise.enabled = true;
            noise.strength = 0.4f;
            noise.frequency = 1.2f;

            var renderer = ps.GetComponent<ParticleSystemRenderer>();
            renderer.material = MakeUnlit(ref fireMatCache, "Fire FX", Color.white, true);
            return ps;
        }

        /// <summary>Bright, fast, short-lived sparks — <see cref="VehicleDamage"/> Emit()s a burst at
        /// each contact point rather than driving a continuous rate.</summary>
        public static ParticleSystem BuildSparks(Transform parent)
        {
            var ps = NewSystem(parent, "Sparks", false, 0.28f, 0.035f, new Color(1f, 0.85f, 0.5f), 300, 1.6f);
            var main = ps.main;
            main.startSpeed = new ParticleSystem.MinMaxCurve(2.5f, 6f);
            main.startSize = new ParticleSystem.MinMaxCurve(0.02f, 0.05f);

            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 35f;
            shape.radius = 0.02f;

            var color = ps.colorOverLifetime;
            color.enabled = true;
            var gradient = new Gradient();
            gradient.SetKeys(
                new[] { new GradientColorKey(new Color(1f, 0.95f, 0.7f), 0f), new GradientColorKey(new Color(1f, 0.4f, 0.05f), 1f) },
                new[] { new GradientAlphaKey(1f, 0f), new GradientAlphaKey(0f, 1f) });
            color.color = gradient;

            var renderer = ps.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Stretch;
            renderer.velocityScale = 0.06f;
            renderer.lengthScale = 2.5f;
            renderer.material = MakeUnlit(ref sparkMatCache, "Sparks FX", Color.white, true);
            return ps;
        }

        /// <summary>A one-shot burst of small tinted glass chips for a big smash. <see cref="VehicleDamage"/> calls Play() at the hit point.</summary>
        public static ParticleSystem BuildShardBurst(Transform parent)
        {
            var ps = NewSystem(parent, "Glass shards", false, 1.1f, 0.03f, new Color(0.75f, 0.85f, 0.9f, 0.8f), 200, 2.2f);
            var main = ps.main;
            main.startSpeed = new ParticleSystem.MinMaxCurve(1.5f, 4.5f);
            main.startSize = new ParticleSystem.MinMaxCurve(0.015f, 0.045f);
            main.startRotation = new ParticleSystem.MinMaxCurve(0f, 360f * Mathf.Deg2Rad);

            var emission = ps.emission;
            emission.rateOverTime = 0f;
            var burst = new ParticleSystem.Burst(0f, 26, 40, 1, 0f);
            emission.SetBursts(new[] { burst });

            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Sphere;
            shape.radius = 0.05f;

            var rot = ps.rotationOverLifetime;
            rot.enabled = true;
            rot.z = new ParticleSystem.MinMaxCurve(-180f * Mathf.Deg2Rad, 180f * Mathf.Deg2Rad);

            var renderer = ps.GetComponent<ParticleSystemRenderer>();
            renderer.material = MakeUnlit(ref shardMatCache, "Glass shards FX", Color.white, false);
            return ps;
        }

        /// <summary>A one-shot bright fireball burst for the terminal explosion.</summary>
        public static ParticleSystem BuildFireballBurst(Transform parent)
        {
            var ps = NewSystem(parent, "Fireball", false, 0.9f, 0.6f, new Color(1f, 0.6f, 0.2f), 60, -0.05f);
            var main = ps.main;
            main.startSpeed = new ParticleSystem.MinMaxCurve(1.5f, 4f);
            main.startSize = new ParticleSystem.MinMaxCurve(0.6f, 1.6f);

            var emission = ps.emission;
            emission.rateOverTime = 0f;
            var burst = new ParticleSystem.Burst(0f, 18, 24, 1, 0f);
            emission.SetBursts(new[] { burst });

            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Sphere;
            shape.radius = 0.3f;

            var size = ps.sizeOverLifetime;
            size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0f, 0.5f, 1f, 1.6f));

            var color = ps.colorOverLifetime;
            color.enabled = true;
            var gradient = new Gradient();
            gradient.SetKeys(
                new[] { new GradientColorKey(new Color(1f, 0.95f, 0.75f), 0f), new GradientColorKey(new Color(1f, 0.3f, 0.05f), 0.4f), new GradientColorKey(new Color(0.15f, 0.05f, 0.02f), 1f) },
                new[] { new GradientAlphaKey(1f, 0f), new GradientAlphaKey(0.8f, 0.5f), new GradientAlphaKey(0f, 1f) });
            color.color = gradient;

            var renderer = ps.GetComponent<ParticleSystemRenderer>();
            renderer.material = MakeUnlit(ref fireballMatCache, "Fireball FX", Color.white, true);
            return ps;
        }
    }
}
