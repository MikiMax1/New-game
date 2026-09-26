using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar
{
    /// <summary>
    /// A code-built human figure, about 1.78 m tall, from Lathe surfaces of revolution (limbs, torso,
    /// head) and chamfered boxes (pelvis, hands, feet, shoes), in a joint hierarchy: pelvis at the
    /// root, a chest with a neck and head above it and a shoulder and arm each side, and a hip, knee
    /// and ankle each side below. Every joint is a real Transform so it can be rotated directly.
    ///
    /// Each frame it drives a walk/run cycle from <see cref="PlayerCharacter"/>'s speed (leg swing,
    /// knee bend, an opposite arm counter-swing, and a pelvis bob and sway that fades into a slow
    /// idle breathing motion when standing still), then places each foot on the ground with a
    /// downward raycast and a simple analytic two-bone leg IK, so feet sit on kerbs and slopes
    /// instead of floating or sinking, fading out during the swing half of each stride so a lifted
    /// foot isn't dragged along the ground.
    /// </summary>
    public sealed class PlayerBody : MonoBehaviour
    {
        // ---- Proportions (metres): a 1.78 m adult figure. ----
        const float TotalHeight = 1.78f;
        const float HipHeight = 0.943f;
        const float KneeHeight = 0.507f;
        const float AnkleHeight = 0.069f;
        const float ShoulderHeight = 1.456f;
        const float NeckLength = 0.08f;
        const float HeadHeight = TotalHeight - ShoulderHeight - NeckLength;
        const float ThighLength = HipHeight - KneeHeight;
        const float ShinLength = KneeHeight - AnkleHeight;
        const float TorsoLength = ShoulderHeight - HipHeight;
        const float HipHalfWidth = 0.10f;
        const float ShoulderHalfWidth = 0.19f;
        const float UpperArmLength = 0.29f;
        const float ForearmLength = 0.25f;
        const float HandLength = 0.17f;
        const float FootLength = 0.255f;
        const float FootWidth = 0.095f;

        /// <summary>Optional: drives the walk/run cycle and grounded state. Assigned by <see cref="PlayerSpawner"/>.</summary>
        public PlayerCharacter character;
        /// <summary>Ground raycast layers for foot placement; PlayerSpawner excludes the player's own layer.</summary>
        public LayerMask groundMask = ~0;

        [Header("Gait")]
        public float stepFrequency = 1.8f;
        public float minLegSwingDeg = 10f;
        public float maxLegSwingDeg = 32f;
        public float minKneeBendDeg = 22f;
        public float maxKneeBendDeg = 55f;
        public float minArmSwingDeg = 8f;
        public float maxArmSwingDeg = 26f;
        public float pelvisBobAmplitude = 0.035f;
        public float pelvisSwayAmplitude = 0.03f;
        public float pelvisRollDeg = 5f;
        public float pelvisYawDeg = 6f;
        public float breatheFrequency = 0.28f;
        public float breatheAmplitudeDeg = 1.6f;

        Transform pelvis, chest, head;
        Transform leftHip, leftKnee, leftAnkle;
        Transform rightHip, rightKnee, rightAnkle;
        Transform leftShoulder, leftElbow;
        Transform rightShoulder, rightElbow;
        Vector3 pelvisRestLocalPos;

        float gaitPhase;
        float moveWeight;
        float breathePhase;

        void Awake()
        {
            Build();
        }

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            float speed = character != null ? character.Speed : 0f;
            float walkSpeed = character != null && character.walkSpeed > 0.0001f ? character.walkSpeed : 1.4f;
            float speedRatio = Mathf.Max(0f, speed / walkSpeed);
            bool grounded = character == null || character.Grounded;

            moveWeight = Mathf.MoveTowards(moveWeight, speed > 0.03f ? 1f : 0f, dt * 4f);
            if (moveWeight > 0.0001f) gaitPhase += dt * stepFrequency * Mathf.Max(0.05f, speedRatio);
            gaitPhase -= Mathf.Floor(gaitPhase);
            breathePhase += dt * breatheFrequency;
            breathePhase -= Mathf.Floor(breathePhase);

            float legSwingDeg = Mathf.Lerp(minLegSwingDeg, maxLegSwingDeg, Mathf.Clamp01(speedRatio));
            float kneeBendMax = Mathf.Lerp(minKneeBendDeg, maxKneeBendDeg, Mathf.Clamp01(speedRatio));
            float armSwingDeg = Mathf.Lerp(minArmSwingDeg, maxArmSwingDeg, Mathf.Clamp01(speedRatio));

            AnimateLeg(leftHip, leftKnee, leftAnkle, gaitPhase, legSwingDeg, kneeBendMax, grounded);
            AnimateLeg(rightHip, rightKnee, rightAnkle, gaitPhase + 0.5f, legSwingDeg, kneeBendMax, grounded);

            // Arms counter-swing against the opposite leg (contralateral gait).
            AnimateArm(leftShoulder, leftElbow, gaitPhase + 0.5f, armSwingDeg);
            AnimateArm(rightShoulder, rightElbow, gaitPhase, armSwingDeg);

            AnimateTorso(dt);
        }

        void AnimateArm(Transform shoulder, Transform elbow, float phase, float swingDeg)
        {
            if (shoulder == null || elbow == null) return;
            float cycle = phase * Mathf.PI * 2f;
            float shoulderDeg = Mathf.Sin(cycle) * swingDeg * moveWeight;
            float elbowDeg = 6f + Mathf.Max(0f, -Mathf.Cos(cycle)) * swingDeg * 0.8f * moveWeight;
            shoulder.localRotation = Quaternion.Euler(shoulderDeg, 0f, 0f);
            elbow.localRotation = Quaternion.Euler(elbowDeg, 0f, 0f);
        }

        void AnimateTorso(float dt)
        {
            float cycle = gaitPhase * Mathf.PI * 2f;
            float bob = -pelvisBobAmplitude * 0.5f * (1f - Mathf.Cos(cycle * 2f)) * moveWeight;
            float sway = Mathf.Sin(cycle) * pelvisSwayAmplitude * moveWeight;
            float roll = Mathf.Sin(cycle) * pelvisRollDeg * moveWeight;
            float yaw = Mathf.Sin(cycle) * pelvisYawDeg * moveWeight;

            pelvis.localPosition = pelvisRestLocalPos + new Vector3(sway, bob, 0f);
            pelvis.localRotation = Quaternion.Euler(0f, yaw, roll);

            float breathePitch = breatheAmplitudeDeg * Mathf.Sin(breathePhase * Mathf.PI * 2f) * (1f - moveWeight);
            if (chest != null) chest.localRotation = Quaternion.Euler(breathePitch, -yaw * 0.6f, -roll * 0.4f);
            if (head != null) head.localRotation = Quaternion.Euler(-breathePitch * 0.3f, 0f, 0f);
        }

        /// <summary>
        /// Sets the hip and knee's swing pose, then plants the foot on the actual ground under it
        /// with an analytic two-bone IK correction (law of cosines), blended in only while the leg is
        /// in its stance half of the stride so a swinging foot isn't dragged along the terrain.
        /// </summary>
        void AnimateLeg(Transform hip, Transform knee, Transform ankle, float phase, float swingDeg, float kneeBendMax, bool grounded)
        {
            if (hip == null || knee == null || ankle == null) return;
            float cycle = phase * Mathf.PI * 2f;
            float hipSwing = -Mathf.Sin(cycle) * swingDeg * moveWeight;
            float kneeSwing = 4f + Mathf.Max(0f, -Mathf.Cos(cycle)) * kneeBendMax * moveWeight;
            hip.localRotation = Quaternion.Euler(hipSwing, 0f, 0f);
            knee.localRotation = Quaternion.Euler(kneeSwing, 0f, 0f);

            float stance = grounded ? Mathf.Clamp01(Mathf.Cos(cycle)) : 0f;
            if (stance <= 0.0001f)
            {
                ankle.localRotation = Quaternion.identity;
                return;
            }

            Vector3 ankleFk = ankle.position;
            var origin = ankleFk + Vector3.up * 0.6f;
            if (!Physics.Raycast(origin, Vector3.down, out RaycastHit hit, 1.2f, groundMask, QueryTriggerInteraction.Ignore))
            {
                ankle.localRotation = Quaternion.identity;
                return;
            }

            float desiredY = hit.point.y + AnkleHeight;
            var targetWorld = new Vector3(ankleFk.x, desiredY, ankleFk.z);
            Transform hipParent = hip.parent != null ? hip.parent : hip;
            Vector3 targetInParent = hipParent.InverseTransformPoint(targetWorld) - hip.localPosition;
            // Rotations are about the local X axis only, so the lateral (x) component should already
            // be ~0; drop it defensively in case something upstream nudges it off-plane.
            float py = targetInParent.y;
            float pz = targetInParent.z;
            float dist = Mathf.Sqrt(py * py + pz * pz);
            const float eps = 1e-4f;
            if (dist < eps)
            {
                ankle.localRotation = Quaternion.identity;
                return;
            }
            float reach = Mathf.Clamp(dist, Mathf.Abs(ThighLength - ShinLength) + eps, ThighLength + ShinLength - eps);

            float cosKnee = (ThighLength * ThighLength + ShinLength * ShinLength - reach * reach) / (2f * ThighLength * ShinLength);
            float kneeInterior = Mathf.Acos(Mathf.Clamp(cosKnee, -1f, 1f));
            float ikKneeDeg = (Mathf.PI - kneeInterior) * Mathf.Rad2Deg;

            float cosHipToTarget = (ThighLength * ThighLength + reach * reach - ShinLength * ShinLength) / (2f * ThighLength * reach);
            float alpha = Mathf.Acos(Mathf.Clamp(cosHipToTarget, -1f, 1f));
            float phiToTarget = Mathf.Atan2(-pz, -py);
            float ikHipDeg = (phiToTarget - alpha) * Mathf.Rad2Deg;

            hip.localRotation = Quaternion.Euler(Mathf.Lerp(hipSwing, ikHipDeg, stance), 0f, 0f);
            knee.localRotation = Quaternion.Euler(Mathf.Lerp(kneeSwing, ikKneeDeg, stance), 0f, 0f);

            // Tilt the foot at the ankle to sit flush on a slope or kerb edge, within a modest range.
            Vector3 localNormal = ankle.parent.InverseTransformDirection(hit.normal);
            float tiltX = Mathf.Clamp(Mathf.Atan2(localNormal.z, Mathf.Max(0.2f, localNormal.y)) * Mathf.Rad2Deg, -25f, 25f);
            float tiltZ = Mathf.Clamp(-Mathf.Atan2(localNormal.x, Mathf.Max(0.2f, localNormal.y)) * Mathf.Rad2Deg, -25f, 25f);
            ankle.localRotation = Quaternion.Euler(tiltX * stance, 0f, tiltZ * stance);
        }

        // ---- Construction ----

        void Build()
        {
            Material skin = MakeMaterial("Skin", new Color(0.86f, 0.67f, 0.56f), 0.25f);
            Material shirt = MakeMaterial("Shirt", new Color(0.18f, 0.35f, 0.55f), 0.32f);
            Material trousers = MakeMaterial("Trousers", new Color(0.16f, 0.17f, 0.21f), 0.3f);
            Material shoes = MakeMaterial("Shoes", new Color(0.05f, 0.04f, 0.04f), 0.5f);

            pelvis = CreateJoint(transform, "Pelvis", new Vector3(0f, HipHeight, 0f));
            pelvisRestLocalPos = pelvis.localPosition;
            Attach(pelvis, Shapes.ChamferBox(0.26f, 0.20f, 0.18f, 0.03f).Translate(0f, -0.02f, 0f).ToMesh("Pelvis"), trousers);

            chest = CreateJoint(pelvis, "Chest", new Vector3(0f, TorsoLength, 0f));
            Attach(pelvis, UpwardLimb(TorsoLength, 0.13f, 0.155f, 0.115f, 18).ToMesh("Torso"), shirt);

            Transform neckTop = CreateJoint(chest, "NeckTop", new Vector3(0f, NeckLength, 0f));
            Attach(chest, UpwardLimb(NeckLength, 0.05f, 0.05f, 0.055f, 12).ToMesh("Neck"), skin);

            head = CreateJoint(neckTop, "Head", new Vector3(0f, HeadHeight * 0.5f, 0f));
            Attach(neckTop, HeadMesh(HeadHeight, 0.095f).ToMesh("Head"), skin);

            // Unity is left-handed with forward = +Z, so +X is the character's own right side.
            float shoulderY = TorsoLength - 0.06f;
            (rightShoulder, rightElbow) = BuildArm(chest, "Right", 1f, shoulderY, shirt, skin);
            (leftShoulder, leftElbow) = BuildArm(chest, "Left", -1f, shoulderY, shirt, skin);

            (rightHip, rightKnee, rightAnkle) = BuildLeg(pelvis, "Right", 1f, trousers, shoes);
            (leftHip, leftKnee, leftAnkle) = BuildLeg(pelvis, "Left", -1f, trousers, shoes);
        }

        (Transform shoulder, Transform elbow) BuildArm(Transform chestJoint, string side, float sign, float shoulderY, Material sleeve, Material handMat)
        {
            Transform shoulder = CreateJoint(chestJoint, side + "Shoulder", new Vector3(sign * ShoulderHalfWidth, shoulderY, 0f));
            Attach(shoulder, Limb(UpperArmLength, 0.055f, 0.05f, 0.04f, 12).ToMesh(side + " upper arm"), sleeve);

            Transform elbow = CreateJoint(shoulder, side + "Elbow", new Vector3(0f, -UpperArmLength, 0f));
            Attach(elbow, Limb(ForearmLength, 0.04f, 0.035f, 0.03f, 12).ToMesh(side + " forearm"), sleeve);

            Transform wrist = CreateJoint(elbow, side + "Wrist", new Vector3(0f, -ForearmLength, 0f));
            Attach(wrist, Shapes.ChamferBox(0.075f, HandLength, 0.032f, 0.015f).Translate(0f, -HandLength * 0.5f, 0f).ToMesh(side + " hand"), handMat);

            return (shoulder, elbow);
        }

        (Transform hip, Transform knee, Transform ankle) BuildLeg(Transform pelvisJoint, string side, float sign, Material pants, Material shoe)
        {
            Transform hip = CreateJoint(pelvisJoint, side + "Hip", new Vector3(sign * HipHalfWidth, -0.03f, 0f));
            Attach(hip, Limb(ThighLength, 0.10f, 0.085f, 0.062f, 14).ToMesh(side + " thigh"), pants);

            Transform knee = CreateJoint(hip, side + "Knee", new Vector3(0f, -ThighLength, 0f));
            Attach(knee, Limb(ShinLength, 0.055f, 0.046f, 0.036f, 14).ToMesh(side + " shin"), pants);

            Transform ankle = CreateJoint(knee, side + "Ankle", new Vector3(0f, -ShinLength, 0f));
            Attach(ankle, Shapes.ChamferBox(FootWidth, AnkleHeight, FootLength, 0.018f)
                .Translate(0f, -AnkleHeight * 0.5f, FootLength * 0.15f).ToMesh(side + " foot"), shoe);

            return (hip, knee, ankle);
        }

        static Transform CreateJoint(Transform parent, string name, Vector3 localPosition)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPosition;
            return go.transform;
        }

        /// <summary>
        /// Hangs a mesh (its offset already baked into its vertices) off `joint` on its own child
        /// GameObject, so a joint that needs more than one piece of geometry (the pelvis carries both
        /// its own box and the torso) never ends up with two MeshFilters on the same object.
        /// </summary>
        static void Attach(Transform joint, Mesh mesh, Material material)
        {
            mesh.hideFlags = HideFlags.DontSave;
            var go = new GameObject(mesh.name);
            go.transform.SetParent(joint, false);
            var filter = go.AddComponent<MeshFilter>();
            filter.sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.On;
        }

        static Material MakeMaterial(string name, Color color, float smoothness, float metallic = 0f)
        {
            var shader = Shader.Find("HDRP/Lit");
            var m = new Material(shader) { name = name, hideFlags = HideFlags.DontSave };
            m.SetColor("_BaseColor", color);
            m.SetFloat("_Smoothness", smoothness);
            m.SetFloat("_Metallic", metallic);
            HDMaterial.ValidateMaterial(m);
            return m;
        }

        /// <summary>A tapered limb hanging from y = 0 (the joint) down to y = -length (the child joint).</summary>
        static MeshData Limb(float length, float rTop, float rMid, float rBottom, int segments)
        {
            var profile = new List<Vector2>
            {
                new Vector2(Mathf.Max(0.001f, rBottom), -length),
                new Vector2(Mathf.Max(0.001f, rBottom * 1.03f), -length * 0.85f),
                new Vector2(Mathf.Max(0.001f, rMid), -length * 0.5f),
                new Vector2(Mathf.Max(0.001f, rTop * 0.96f), -length * 0.15f),
                new Vector2(Mathf.Max(0.001f, rTop), 0f),
            };
            return Shapes.Lathe(profile, Mathf.Max(6, segments));
        }

        /// <summary>A tapered limb rising from y = 0 (the joint) up to y = length (the child joint).</summary>
        static MeshData UpwardLimb(float length, float rBottom, float rMid, float rTop, int segments)
        {
            var profile = new List<Vector2>
            {
                new Vector2(Mathf.Max(0.001f, rBottom), 0f),
                new Vector2(Mathf.Max(0.001f, rBottom * 1.03f), length * 0.15f),
                new Vector2(Mathf.Max(0.001f, rMid), length * 0.5f),
                new Vector2(Mathf.Max(0.001f, rTop * 0.96f), length * 0.85f),
                new Vector2(Mathf.Max(0.001f, rTop), length),
            };
            return Shapes.Lathe(profile, Mathf.Max(6, segments));
        }

        /// <summary>A closed, roughly egg-shaped head rising from the jaw (y = 0) to the crown (y = height).</summary>
        static MeshData HeadMesh(float height, float radius)
        {
            var profile = new List<Vector2>
            {
                new Vector2(0f, 0f),
                new Vector2(radius * 0.55f, height * 0.08f),
                new Vector2(radius * 0.9f, height * 0.28f),
                new Vector2(radius, height * 0.55f),
                new Vector2(radius * 0.92f, height * 0.8f),
                new Vector2(radius * 0.5f, height * 0.95f),
                new Vector2(0f, height),
            };
            return Shapes.Lathe(profile, 18);
        }
    }
}
