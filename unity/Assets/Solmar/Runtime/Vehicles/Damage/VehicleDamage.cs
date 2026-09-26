using System;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;
using Solmar.Traffic;

namespace Solmar.Vehicles.Damage
{
    /// <summary>
    /// GTA-style body damage for any car: crumples the paint mesh around a hard hit, breaks a lamp or
    /// the glass on a big one, sparks while scraping a wall, and tracks an engine health that smokes,
    /// catches fire and finally explodes as it runs out. <see cref="VehicleDamageBootstrap"/> attaches
    /// one of these to every <see cref="VehicleController"/> and <see cref="TrafficCar"/> automatically;
    /// nothing else needs to reference this component directly (see <see cref="EnginePower01"/> for the
    /// one hook other systems are expected to read later).
    ///
    /// Everything expensive (the vertex pass, submesh/material lookups, mesh cloning) only ever runs
    /// from a qualifying collision, at most once every <see cref="HitCooldown"/> seconds per car — never
    /// from Update. Update itself only nudges particle emission rates and a light's intensity, which
    /// allocate nothing.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class VehicleDamage : MonoBehaviour
    {
        public const float MaxEngineHealth = 1000f;

        // ---- Tuning (impulse/energy units are engine-approximate, not physically exact; retune by feel) ----
        const float HitCooldown = 0.1f;
        const float DentMinImpulse = 150f;       // below this, a hit is cosmetically ignored
        const float DentSaturateImpulse = 2500f; // impulse at which dent radius/depth reach their max
        const float MinDentRadius = 0.4f, MaxDentRadius = 0.9f;
        const float MinDentDepth = 0.05f, MaxDentDepth = 0.25f;
        const float LampBreakImpulse = 420f;
        const float GlassShatterImpulse = 900f;
        const float LampZoneFraction = 0.22f; // front/rear fraction of car length that counts as "near" a lamp
        const float HealthLossPerEnergy = 0.006f;

        const float SparkMinTangentialSpeed = 3f;
        const float SparkMaxNormalSpeed = 6f;
        const short SparkBurstCount = 14;

        const float WhiteSmokeHealth = 400f;
        const float BlackSmokeHealth = 150f;
        const float WhiteSmokeRate = 10f, BlackSmokeRate = 16f;
        const float FireDurationBeforeExplosion = 6f;
        const float FireLightLumen = 18000f, FireLightRange = 9f;
        const float ExplosionFlashLumen = 450000f, ExplosionFlashRange = 18f, ExplosionFlashDuration = 0.35f;
        const float ExplosionForce = 1600f, ExplosionRadius = 6f;
        const int DebrisCount = 12;
        const float DebrisLifetime = 6f;

        Rigidbody rb;
        VehicleController controller;

        Transform bodyT;
        MeshFilter bodyFilter;
        MeshRenderer bodyRenderer;
        Mesh originalSharedMesh;
        Material[] originalMats;

        bool meshCloned;
        Mesh instanceMesh;
        Vector3[] origVerts, curVerts;
        bool[] isGlassVert;
        Material[] workingMats;
        int glassSubmesh = -1, lensSubmesh = -1, tailSubmesh = -1;
        bool glassShattered, headlightsBroken, taillightsBroken;
        Bounds localBounds;

        float engineHealth = MaxEngineHealth;
        bool destroyed;
        float fireStartTime = -1f;
        float lastDamageTime = -999f;

        bool fxBuilt;
        ParticleSystem smokeWhite, smokeBlack, fire, sparks, shardBurst, fireball;
        Light fireLight;
        HDAdditionalLightData fireLightHd;
        float explosionFlashTimer;

        /// <summary>0..1000, engine condition; 0 means dead (and, after the fire burns out, exploded).</summary>
        public float EngineHealth => engineHealth;
        public float EngineHealth01 => engineHealth / MaxEngineHealth;
        public bool IsOnFire => fireStartTime >= 0f && !destroyed;
        public bool IsDestroyed => destroyed;

        /// <summary>
        /// Hook for later: how much engine power the car should actually be able to put down, 0..1.
        /// Full until the engine's badly hurt, tapering as it dies, zero once destroyed.
        /// <see cref="VehicleController"/> doesn't read this yet — multiply its throttle/drive torque
        /// by it to make damage actually slow the car down.
        /// </summary>
        public float EnginePower01
        {
            get
            {
                if (destroyed || engineHealth <= 0f) return 0f;
                if (engineHealth >= BlackSmokeHealth) return 1f;
                return Mathf.Lerp(0.3f, 1f, engineHealth / BlackSmokeHealth);
            }
        }

        void Awake()
        {
            rb = GetComponent<Rigidbody>();
            controller = GetComponent<VehicleController>();
            bodyT = transform.Find("Body");
            if (bodyT != null)
            {
                bodyFilter = bodyT.GetComponent<MeshFilter>();
                bodyRenderer = bodyT.GetComponent<MeshRenderer>();
            }
        }

        /// <summary>Pooled traffic cars are disabled and reactivated rather than destroyed; put a
        /// respawned car's body back to pristine so a wreck doesn't come back from the pool damaged.</summary>
        void OnEnable()
        {
            if (!meshCloned) return;
            engineHealth = MaxEngineHealth;
            destroyed = false;
            fireStartTime = -1f;
            explosionFlashTimer = 0f;
            glassShattered = false;
            headlightsBroken = false;
            taillightsBroken = false;
            lastDamageTime = -999f;
            if (controller != null) controller.enabled = true;
            if (bodyFilter != null && originalSharedMesh != null) bodyFilter.sharedMesh = originalSharedMesh;
            if (bodyRenderer != null && originalMats != null) bodyRenderer.sharedMaterials = (Material[])originalMats.Clone();
            meshCloned = false;
            instanceMesh = null;
            origVerts = null;
            curVerts = null;
            isGlassVert = null;
            workingMats = null;
            glassSubmesh = lensSubmesh = tailSubmesh = -1;
            if (smokeWhite != null) smokeWhite.Stop(true, ParticleSystemStopBehavior.StopEmitting);
            if (smokeBlack != null) smokeBlack.Stop(true, ParticleSystemStopBehavior.StopEmitting);
            if (fire != null) fire.Stop(true, ParticleSystemStopBehavior.StopEmitting);
            if (fireLight != null) fireLight.intensity = 0f;
        }

        void OnCollisionEnter(Collision collision) => HandleCollision(collision);
        void OnCollisionStay(Collision collision) => HandleCollision(collision);

        void HandleCollision(Collision collision)
        {
            if (destroyed || bodyFilter == null || collision.contactCount == 0) return;

            ContactPoint c0 = collision.GetContact(0);
            Vector3 point = c0.point;
            Vector3 normal = c0.normal;
            if (!IsFinite(point) || !IsFinite(normal) || normal.sqrMagnitude < 1e-6f) return;

            Vector3 relVel = collision.relativeVelocity;
            float relSpeed = IsFinite(relVel) ? relVel.magnitude : 0f;
            float impulseMag = collision.impulse.magnitude;
            if (!float.IsFinite(impulseMag)) impulseMag = 0f;

            // Scraping along a wall: fast tangentially, not much normal closing speed. Independent of
            // the dent cooldown so a long scrape keeps throwing sparks, but Emit() itself is cheap.
            Vector3 tangential = relVel - Vector3.Dot(relVel, normal) * normal;
            float tangentialSpeed = tangential.magnitude;
            float normalSpeed = Mathf.Abs(Vector3.Dot(relVel, normal));
            if (tangentialSpeed > SparkMinTangentialSpeed && normalSpeed < SparkMaxNormalSpeed)
            {
                EmitSparks(point, normal);
            }

            if (impulseMag < DentMinImpulse) return;
            if (Time.time - lastDamageTime < HitCooldown) return;
            lastDamageTime = Time.time;

            ApplyDamage(point, normal, impulseMag, relSpeed);
        }

        void ApplyDamage(Vector3 point, Vector3 normal, float impulseMag, float relSpeed)
        {
            EnsureMeshCloned();
            if (bodyT != null && instanceMesh != null)
            {
                Vector3 localPoint = bodyT.InverseTransformPoint(point);
                Vector3 localInward = bodyT.InverseTransformDirection(-normal);
                if (localInward.sqrMagnitude > 1e-6f)
                {
                    localInward.Normalize();
                    float t = Mathf.Clamp01(Mathf.InverseLerp(DentMinImpulse, DentSaturateImpulse, impulseMag));
                    float radius = Mathf.Lerp(MinDentRadius, MaxDentRadius, t);
                    float depth = Mathf.Lerp(MinDentDepth, MaxDentDepth, t);
                    DentAt(localPoint, localInward, radius, depth);
                }
                if (impulseMag > LampBreakImpulse) TryBreakLamps(localPoint);
                if (impulseMag > GlassShatterImpulse) ShatterGlass(point);
            }

            float mass = rb != null && rb.mass > 0f ? rb.mass : 1450f;
            float energy = 0.5f * mass * relSpeed * relSpeed;
            if (!float.IsFinite(energy)) energy = 0f;
            SetEngineHealth(engineHealth - energy * HealthLossPerEnergy);
        }

        void SetEngineHealth(float value)
        {
            engineHealth = Mathf.Clamp(value, 0f, MaxEngineHealth);
        }

        // ---- Mesh deformation ----

        void EnsureMeshCloned()
        {
            if (meshCloned || bodyFilter == null || bodyRenderer == null) return;
            Mesh shared = bodyFilter.sharedMesh;
            if (shared == null) return;

            originalSharedMesh = shared;
            originalMats = (Material[])bodyRenderer.sharedMaterials.Clone();

            Mesh clone = Instantiate(shared);
            clone.name = shared.name + " (damaged)";
            clone.hideFlags = HideFlags.DontSave;
            clone.MarkDynamic();
            bodyFilter.mesh = clone;
            instanceMesh = clone;

            origVerts = shared.vertices;
            curVerts = clone.vertices;
            localBounds = clone.bounds;

            workingMats = (Material[])bodyRenderer.sharedMaterials.Clone();
            glassSubmesh = FindSubmesh(workingMats, "Car glass");
            lensSubmesh = FindSubmesh(workingMats, "Car headlamp lens");
            tailSubmesh = FindSubmesh(workingMats, "Car tail lamp");

            isGlassVert = new bool[curVerts.Length];
            if (glassSubmesh >= 0 && glassSubmesh < clone.subMeshCount)
            {
                int[] tris = clone.GetTriangles(glassSubmesh);
                for (int i = 0; i < tris.Length; i++)
                {
                    int v = tris[i];
                    if (v >= 0 && v < isGlassVert.Length) isGlassVert[v] = true;
                }
            }

            meshCloned = true;
        }

        static int FindSubmesh(Material[] mats, string name)
        {
            if (mats == null) return -1;
            for (int i = 0; i < mats.Length; i++)
            {
                if (mats[i] != null && mats[i].name == name) return i;
            }
            return -1;
        }

        /// <summary>Pushes vertices near `localPoint` inward along `localInwardDir`, falling off over
        /// `radius` with a little per-vertex noise so the crumple isn't perfectly smooth. Glass vertices
        /// are skipped; total displacement from the pristine surface is capped at <see cref="MaxDentDepth"/>.</summary>
        void DentAt(Vector3 localPoint, Vector3 localInwardDir, float radius, float depth)
        {
            if (curVerts == null || origVerts == null || isGlassVert == null || instanceMesh == null) return;
            float r2 = radius * radius;
            int n = curVerts.Length;
            for (int i = 0; i < n; i++)
            {
                if (isGlassVert[i]) continue;
                Vector3 orig = origVerts[i];
                Vector3 delta = orig - localPoint;
                float d2 = delta.sqrMagnitude;
                if (d2 > r2) continue;

                float d = Mathf.Sqrt(d2);
                float falloff = 1f - d / Mathf.Max(0.001f, radius);
                falloff = falloff * falloff * (3f - 2f * falloff);
                float noise = 0.6f + 0.4f * Mathf.PerlinNoise(orig.x * 9.7f + orig.y * 3.1f, orig.z * 9.7f);
                float push = depth * falloff * noise;
                if (!float.IsFinite(push) || push <= 0f) continue;

                Vector3 candidate = curVerts[i] + localInwardDir * push;
                Vector3 fromOrig = candidate - orig;
                float mag = fromOrig.magnitude;
                if (mag > MaxDentDepth && mag > 1e-5f) candidate = orig + fromOrig * (MaxDentDepth / mag);
                if (IsFinite(candidate)) curVerts[i] = candidate;
            }
            instanceMesh.SetVertices(curVerts);
            instanceMesh.RecalculateNormals();
            instanceMesh.RecalculateBounds();
        }

        // ---- Parts ----

        void TryBreakLamps(Vector3 localPoint)
        {
            float carLength = Mathf.Max(0.5f, localBounds.size.z);
            float frontZ = localBounds.max.z - carLength * LampZoneFraction;
            float rearZ = localBounds.min.z + carLength * LampZoneFraction;

            if (!headlightsBroken && lensSubmesh >= 0 && localPoint.z >= frontZ) BreakLamp(lensSubmesh, out headlightsBroken);
            if (!taillightsBroken && tailSubmesh >= 0 && localPoint.z <= rearZ) BreakLamp(tailSubmesh, out taillightsBroken);
        }

        void BreakLamp(int submeshIndex, out bool brokenFlag)
        {
            brokenFlag = true;
            if (workingMats == null || submeshIndex < 0 || submeshIndex >= workingMats.Length) return;
            Material original = workingMats[submeshIndex];
            if (original == null) return;

            var broken = new Material(original) { name = original.name + " (broken)", hideFlags = HideFlags.DontSave };
            Color baseColor = broken.GetColor("_BaseColor");
            broken.SetColor("_BaseColor", Color.Lerp(baseColor, Color.black, 0.85f));
            broken.SetFloat("_Smoothness", 0.15f);
            HDMaterial.SetUseEmissiveIntensity(broken, true);
            HDMaterial.SetEmissiveIntensity(broken, 0f, EmissiveIntensityUnit.Nits);
            HDMaterial.ValidateMaterial(broken);

            workingMats[submeshIndex] = broken;
            bodyRenderer.sharedMaterials = workingMats;
        }

        void ShatterGlass(Vector3 worldPoint)
        {
            if (glassShattered || glassSubmesh < 0 || instanceMesh == null) return;
            glassShattered = true;
            instanceMesh.SetTriangles(Array.Empty<int>(), glassSubmesh);

            EnsureFX();
            if (shardBurst != null)
            {
                shardBurst.transform.position = worldPoint;
                shardBurst.Play();
            }
        }

        // ---- Sparks ----

        void EmitSparks(Vector3 point, Vector3 normal)
        {
            EnsureFX();
            if (sparks == null) return;
            sparks.transform.position = point;
            sparks.transform.rotation = Quaternion.LookRotation(normal);
            var emitParams = new ParticleSystem.EmitParams();
            sparks.Emit(emitParams, SparkBurstCount);
        }

        // ---- Health state: smoke, fire, explosion ----

        void Update()
        {
            if (destroyed)
            {
                UpdateExplosionFlash();
                return;
            }
            if (!meshCloned) return; // never hit yet: no health lost, nothing to animate

            UpdateSmoke();

            if (engineHealth <= 0f)
            {
                if (fireStartTime < 0f) StartFire();
                UpdateFireLight();
                if (Time.time - fireStartTime >= FireDurationBeforeExplosion) Explode();
            }
        }

        void UpdateSmoke()
        {
            bool wantBlack = engineHealth < BlackSmokeHealth;
            bool wantWhite = !wantBlack && engineHealth < WhiteSmokeHealth;
            if (!wantBlack && !wantWhite) return; // don't build FX for a car that's only lightly hurt

            EnsureFX();
            Vector3 bonnet = BonnetWorldPosition();
            if (smokeWhite != null)
            {
                smokeWhite.transform.position = bonnet;
                var em = smokeWhite.emission;
                em.rateOverTime = wantWhite ? WhiteSmokeRate : 0f;
                if (wantWhite && !smokeWhite.isEmitting) smokeWhite.Play();
            }
            if (smokeBlack != null)
            {
                smokeBlack.transform.position = bonnet;
                var em = smokeBlack.emission;
                em.rateOverTime = wantBlack ? BlackSmokeRate : 0f;
                if (wantBlack && !smokeBlack.isEmitting) smokeBlack.Play();
            }
        }

        void StartFire()
        {
            fireStartTime = Time.time;
            EnsureFX();
            EnsureFireLight();
            if (fire != null)
            {
                fire.transform.position = BonnetWorldPosition();
                fire.Play();
            }
        }

        void UpdateFireLight()
        {
            if (fireLight == null) return;
            fireLight.transform.position = BonnetWorldPosition();
            float flicker = 0.7f + 0.3f * Mathf.PerlinNoise(Time.time * 9f, 0.37f);
            fireLight.intensity = FireLightLumen * flicker;
        }

        void UpdateExplosionFlash()
        {
            if (fireLight == null || explosionFlashTimer <= 0f) return;
            explosionFlashTimer -= Time.deltaTime;
            float k = Mathf.Clamp01(explosionFlashTimer / ExplosionFlashDuration);
            fireLight.intensity = ExplosionFlashLumen * k * k;
            fireLight.range = Mathf.Lerp(FireLightRange, ExplosionFlashRange, k);
            if (explosionFlashTimer <= 0f) fireLight.intensity = 0f;
        }

        void EnsureFireLight()
        {
            if (fireLight != null) return;
            var go = new GameObject("Damage fire light") { hideFlags = HideFlags.DontSave };
            go.transform.SetParent(transform, false);
            fireLight = go.AddComponent<Light>();
            fireLight.type = LightType.Point;
            fireLightHd = go.AddComponent<HDAdditionalLightData>();
            HDAdditionalLightData.InitDefaultHDAdditionalLightData(fireLightHd);
            fireLight.color = new Color(1f, 0.45f, 0.12f);
            fireLight.range = FireLightRange;
            fireLight.lightUnit = LightUnit.Lumen;
            fireLight.intensity = 0f;
            fireLight.shadows = LightShadows.None;
            fireLightHd.EnableShadows(false);
        }

        Vector3 BonnetWorldPosition()
        {
            if (bodyT != null && meshCloned)
            {
                Vector3 local = new Vector3(0f, localBounds.max.y - 0.08f, localBounds.max.z - localBounds.size.z * 0.12f);
                Vector3 world = bodyT.TransformPoint(local);
                if (IsFinite(world)) return world;
            }
            return transform.position + transform.up * 1f + transform.forward * 1.6f;
        }

        void Explode()
        {
            if (destroyed) return;
            destroyed = true;

            if (fire != null) fire.Stop(true, ParticleSystemStopBehavior.StopEmitting);
            Vector3 pos = BonnetWorldPosition();

            EnsureFX();
            if (fireball != null)
            {
                fireball.transform.position = pos;
                fireball.Play();
            }
            explosionFlashTimer = ExplosionFlashDuration;
            EnsureFireLight();

            SpawnDebris(pos);
            ApplyExplosionImpulse(pos);
            CharBody();

            if (controller != null) controller.enabled = false;
        }

        void SpawnDebris(Vector3 center)
        {
            for (int i = 0; i < DebrisCount; i++)
            {
                var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                go.name = "Wreck debris";
                go.hideFlags = HideFlags.DontSave;
                float scale = UnityEngine.Random.Range(0.05f, 0.16f);
                go.transform.localScale = new Vector3(scale, scale * UnityEngine.Random.Range(0.5f, 1f), scale);
                go.transform.position = center + UnityEngine.Random.insideUnitSphere * 0.3f;
                go.transform.rotation = UnityEngine.Random.rotation;

                var renderer = go.GetComponent<MeshRenderer>();
                renderer.sharedMaterial = DamageFX.DebrisMaterial();
                renderer.shadowCastingMode = ShadowCastingMode.On;

                var body = go.AddComponent<Rigidbody>();
                body.mass = 3f;
                body.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
                Vector3 dir = go.transform.position - center;
                if (dir.sqrMagnitude < 1e-4f) dir = UnityEngine.Random.onUnitSphere;
                dir.Normalize();
                body.AddForce(dir * UnityEngine.Random.Range(4f, 9f) + Vector3.up * UnityEngine.Random.Range(2f, 5f), ForceMode.VelocityChange);
                body.AddTorque(UnityEngine.Random.insideUnitSphere * 6f, ForceMode.VelocityChange);

                Destroy(go, DebrisLifetime);
            }
        }

        void ApplyExplosionImpulse(Vector3 center)
        {
            Collider[] hits = Physics.OverlapSphere(center, ExplosionRadius, ~0, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < hits.Length; i++)
            {
                Rigidbody other = hits[i].attachedRigidbody;
                if (other == null || other == rb) continue;
                other.AddExplosionForce(ExplosionForce, center, ExplosionRadius, 0.4f, ForceMode.Impulse);
            }
            if (rb != null) rb.AddExplosionForce(ExplosionForce * 0.6f, center, ExplosionRadius, 0.2f, ForceMode.Impulse);
        }

        void CharBody()
        {
            if (bodyRenderer == null || workingMats == null) return;
            for (int i = 0; i < workingMats.Length; i++)
            {
                Material m = workingMats[i];
                if (m == null) continue;
                var charred = new Material(m) { name = m.name + " (charred)", hideFlags = HideFlags.DontSave };
                Color baseColor = charred.HasProperty("_BaseColor") ? charred.GetColor("_BaseColor") : Color.black;
                charred.SetColor("_BaseColor", Color.Lerp(baseColor, new Color(0.015f, 0.015f, 0.015f), 0.92f));
                if (charred.HasProperty("_Smoothness")) charred.SetFloat("_Smoothness", 0.08f);
                if (HDMaterial.GetUseEmissiveIntensity(charred)) HDMaterial.SetEmissiveIntensity(charred, 0f, EmissiveIntensityUnit.Nits);
                HDMaterial.ValidateMaterial(charred);
                workingMats[i] = charred;
            }
            bodyRenderer.sharedMaterials = workingMats;
        }

        // ---- FX build-on-demand ----

        void EnsureFX()
        {
            if (fxBuilt) return;
            fxBuilt = true;
            smokeWhite = DamageFX.BuildSmoke(transform, false);
            smokeBlack = DamageFX.BuildSmoke(transform, true);
            fire = DamageFX.BuildFire(transform);
            sparks = DamageFX.BuildSparks(transform);
            shardBurst = DamageFX.BuildShardBurst(transform);
            fireball = DamageFX.BuildFireballBurst(transform);
        }

        static bool IsFinite(Vector3 v) => float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z);
    }
}
