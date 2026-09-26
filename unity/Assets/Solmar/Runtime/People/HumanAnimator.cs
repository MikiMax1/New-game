using UnityEngine;

namespace Solmar.People
{
    /// <summary>
    /// Drives one body's skeleton entirely by code, every frame, from its world-space velocity and
    /// whether it's grounded — no animation clips. Blended purely by speed: idle breathing and a slow
    /// weight shift at a standstill, a walk/run cycle with contralateral arm swing and hip roll/bob
    /// and yaw that fades in with speed, the spine leaning into turns and acceleration, the head
    /// counter-rotating to stay steadier than the torso, a jump/fall pose while airborne, and an
    /// analytic two-bone IK correction that plants each stance foot on the actual ground (kerbs,
    /// slopes) instead of letting it float or sink.
    ///
    /// Stateless between bodies: one instance per <see cref="HumanBody"/>, ticked from its own
    /// <c>Tick</c> call so a pedestrian controller can drive it exactly like the player does.
    /// </summary>
    public sealed class HumanAnimator
    {
        readonly HumanBones bones;
        readonly HumanProportions p;

        public float stepFrequency = 1.8f;
        public float minLegSwingDeg = 10f;
        public float maxLegSwingDeg = 34f;
        public float minKneeBendDeg = 20f;
        public float maxKneeBendDeg = 52f;
        public float minArmSwingDeg = 8f;
        public float maxArmSwingDeg = 28f;
        public float referenceWalkSpeed = 1.5f;
        public float referenceRunSpeed = 6f;
        public float pelvisBobAmplitude = 0.035f;
        public float pelvisSwayAmplitude = 0.028f;
        public float pelvisRollDeg = 5f;
        public float pelvisYawDeg = 6f;
        public float breatheFrequency = 0.28f;
        public float breatheAmplitudeDeg = 1.6f;
        public float leanIntoTurnDeg = 14f;
        public float leanIntoAccelDeg = 10f;
        public float headStabilise = 0.65f;

        float gaitPhase, moveWeight, breathePhase, idlePhase;
        float speedSmoothed;
        Vector3 prevHorizontalDir = Vector3.forward;
        float airTime;
        bool wasGrounded = true;

        public HumanAnimator(HumanBones bones, HumanProportions proportions)
        {
            this.bones = bones;
            p = proportions;
        }

        /// <summary>
        /// Advances the pose by `dt`. `velocity` is world-space (its y is used for the jump/fall
        /// pose); `groundMask` is used only for the foot-planting raycast.
        /// </summary>
        public void Tick(Vector3 velocity, bool grounded, float dt, LayerMask groundMask)
        {
            dt = Mathf.Max(0f, dt);
            Vector3 horizontal = new Vector3(velocity.x, 0f, velocity.z);
            float speed = horizontal.magnitude;
            Vector3 dir = speed > 0.05f ? horizontal / speed : prevHorizontalDir;

            // Turn rate (deg/s, signed about +Y) and forward acceleration, for the lean.
            float turnRate = 0f;
            if (speed > 0.15f && prevHorizontalDir.sqrMagnitude > 1e-6f && dt > 1e-5f)
            {
                float signedAngle = Vector3.SignedAngle(prevHorizontalDir, dir, Vector3.up);
                turnRate = Mathf.Clamp(signedAngle / dt, -260f, 260f);
            }
            float accel = dt > 1e-5f ? (speed - speedSmoothed) / dt : 0f;
            speedSmoothed = Mathf.MoveTowards(speedSmoothed, speed, Mathf.Max(0.01f, Mathf.Abs(speed - speedSmoothed)) * 10f * dt + 0.0001f);
            prevHorizontalDir = dir;

            float walkRef = Mathf.Max(0.1f, referenceWalkSpeed);
            float speedRatio = Mathf.Clamp01(speed / Mathf.Max(walkRef, referenceRunSpeed));
            float walkRatio = Mathf.Max(0f, speed / walkRef);

            moveWeight = Mathf.MoveTowards(moveWeight, speed > 0.05f ? 1f : 0f, dt * 4f);
            if (moveWeight > 0.0001f) gaitPhase += dt * stepFrequency * Mathf.Max(0.05f, walkRatio);
            gaitPhase -= Mathf.Floor(gaitPhase);
            breathePhase += dt * breatheFrequency;
            breathePhase -= Mathf.Floor(breathePhase);
            idlePhase += dt * 0.12f;
            idlePhase -= Mathf.Floor(idlePhase);

            if (grounded) airTime = 0f;
            else airTime += dt;
            float airFactor = grounded ? 0f : Mathf.Clamp01(airTime * 4f);
            bool justLanded = grounded && !wasGrounded;
            wasGrounded = grounded;

            float legSwingDeg = Mathf.Lerp(minLegSwingDeg, maxLegSwingDeg, speedRatio);
            float kneeBendMax = Mathf.Lerp(minKneeBendDeg, maxKneeBendDeg, speedRatio);
            float armSwingDeg = Mathf.Lerp(minArmSwingDeg, maxArmSwingDeg, speedRatio);

            AnimateLeg(bones.leftHip, bones.leftKnee, bones.leftAnkle, gaitPhase, legSwingDeg, kneeBendMax, grounded, airFactor, groundMask);
            AnimateLeg(bones.rightHip, bones.rightKnee, bones.rightAnkle, gaitPhase + 0.5f, legSwingDeg, kneeBendMax, grounded, airFactor, groundMask);

            // Arms counter-swing against the opposite leg (contralateral gait), lifted forward when airborne.
            AnimateArm(bones.leftShoulder, bones.leftElbow, bones.leftWrist, gaitPhase + 0.5f, armSwingDeg, airFactor);
            AnimateArm(bones.rightShoulder, bones.rightElbow, bones.rightWrist, gaitPhase, armSwingDeg, airFactor);

            AnimateTorsoAndHead(turnRate, accel, airFactor, justLanded);
        }

        void AnimateArm(Transform shoulder, Transform elbow, Transform wrist, float phase, float swingDeg, float airFactor)
        {
            if (shoulder == null || elbow == null) return;
            float cycle = phase * Mathf.PI * 2f;
            float shoulderDeg = Mathf.Sin(cycle) * swingDeg * moveWeight;
            float elbowDeg = 8f + Mathf.Max(0f, -Mathf.Cos(cycle)) * swingDeg * 0.75f * moveWeight;
            // Airborne: arms come up and slightly out for balance.
            shoulderDeg = Mathf.Lerp(shoulderDeg, -55f, airFactor * 0.6f);
            elbowDeg = Mathf.Lerp(elbowDeg, 35f, airFactor * 0.6f);
            shoulder.localRotation = Quaternion.Euler(shoulderDeg, 0f, 6f * airFactor * (shoulder == bones.leftShoulder ? 1f : -1f));
            elbow.localRotation = Quaternion.Euler(elbowDeg, 0f, 0f);
            if (wrist != null) wrist.localRotation = Quaternion.Euler(-elbowDeg * 0.15f, 0f, 0f);
        }

        void AnimateTorsoAndHead(float turnRate, float accel, float airFactor, bool justLanded)
        {
            float cycle = gaitPhase * Mathf.PI * 2f;
            float bob = -pelvisBobAmplitude * 0.5f * (1f - Mathf.Cos(cycle * 2f)) * moveWeight;
            float idleSway = Mathf.Sin(idlePhase * Mathf.PI * 2f) * 0.01f * (1f - moveWeight);
            float sway = Mathf.Sin(cycle) * pelvisSwayAmplitude * moveWeight + idleSway;
            float roll = Mathf.Sin(cycle) * pelvisRollDeg * moveWeight;
            float yaw = Mathf.Sin(cycle) * pelvisYawDeg * moveWeight;

            if (bones.pelvis != null)
            {
                float squat = Mathf.Lerp(0f, -0.06f, airFactor);
                bones.pelvis.localPosition = bones.pelvisRestLocalPos + new Vector3(sway, bob + squat, 0f);
                bones.pelvis.localRotation = Quaternion.Euler(0f, yaw, roll);
            }

            // Lean into turns (bank/roll) and into acceleration or braking (pitch), on the spine.
            float turnLean = Mathf.Clamp(-turnRate * 0.05f, -leanIntoTurnDeg, leanIntoTurnDeg);
            float accelLean = Mathf.Clamp(-accel * 2.2f, -leanIntoAccelDeg, leanIntoAccelDeg);
            float landCrouch = justLanded ? 8f : 0f;
            if (bones.spine != null) bones.spine.localRotation = Quaternion.Euler(accelLean * 0.5f + landCrouch, 0f, turnLean * 0.5f);

            float breathePitch = breatheAmplitudeDeg * Mathf.Sin(breathePhase * Mathf.PI * 2f) * (1f - moveWeight);
            if (bones.chest != null)
                bones.chest.localRotation = Quaternion.Euler(breathePitch + accelLean * 0.5f, -yaw * 0.6f, -roll * 0.4f + turnLean * 0.5f);

            // The head counter-rotates against a fraction of the torso's own motion, so it reads as
            // more stable than the body swaying and bobbing beneath it.
            if (bones.head != null)
            {
                float headPitch = -breathePitch * 0.3f - accelLean * headStabilise;
                float headRoll = -(roll * -0.4f + turnLean * 0.5f) * headStabilise;
                float headYaw = -(-yaw * 0.6f) * headStabilise;
                bones.head.localRotation = Quaternion.Euler(headPitch, headYaw, headRoll);
            }
        }

        /// <summary>
        /// Sets the hip and knee's swing pose, then plants the foot on the actual ground under it
        /// with an analytic two-bone IK correction (law of cosines), blended in only while the leg is
        /// in its stance half of the stride, so a swinging foot isn't dragged along the terrain.
        /// </summary>
        void AnimateLeg(Transform hip, Transform knee, Transform ankle, float phase, float swingDeg, float kneeBendMax, bool grounded, float airFactor, LayerMask groundMask)
        {
            if (hip == null || knee == null || ankle == null) return;
            float cycle = phase * Mathf.PI * 2f;
            float hipSwing = -Mathf.Sin(cycle) * swingDeg * moveWeight;
            float kneeSwing = 4f + Mathf.Max(0f, -Mathf.Cos(cycle)) * kneeBendMax * moveWeight;

            // Airborne: knees tuck up, hips flex, ready to absorb a landing.
            hipSwing = Mathf.Lerp(hipSwing, -18f, airFactor);
            kneeSwing = Mathf.Lerp(kneeSwing, 45f, airFactor);

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

            float desiredY = hit.point.y + p.ankleHeight;
            var targetWorld = new Vector3(ankleFk.x, desiredY, ankleFk.z);
            Transform hipParent = hip.parent != null ? hip.parent : hip;
            Vector3 targetInParent = hipParent.InverseTransformPoint(targetWorld) - hip.localPosition;
            float py = targetInParent.y;
            float pz = targetInParent.z;
            float dist = Mathf.Sqrt(py * py + pz * pz);
            const float eps = 1e-4f;
            if (dist < eps)
            {
                ankle.localRotation = Quaternion.identity;
                return;
            }
            float thigh = p.thighLength, shin = p.shinLength;
            float reach = Mathf.Clamp(dist, Mathf.Abs(thigh - shin) + eps, thigh + shin - eps);

            float cosKnee = (thigh * thigh + shin * shin - reach * reach) / (2f * thigh * shin);
            float kneeInterior = Mathf.Acos(Mathf.Clamp(cosKnee, -1f, 1f));
            float ikKneeDeg = (Mathf.PI - kneeInterior) * Mathf.Rad2Deg;

            float cosHipToTarget = (thigh * thigh + reach * reach - shin * shin) / (2f * thigh * reach);
            float alpha = Mathf.Acos(Mathf.Clamp(cosHipToTarget, -1f, 1f));
            float phiToTarget = Mathf.Atan2(-pz, -py);
            float ikHipDeg = (phiToTarget - alpha) * Mathf.Rad2Deg;

            hip.localRotation = Quaternion.Euler(Mathf.Lerp(hipSwing, ikHipDeg, stance), 0f, 0f);
            knee.localRotation = Quaternion.Euler(Mathf.Lerp(kneeSwing, ikKneeDeg, stance), 0f, 0f);

            Vector3 localNormal = ankle.parent.InverseTransformDirection(hit.normal);
            float tiltX = Mathf.Clamp(Mathf.Atan2(localNormal.z, Mathf.Max(0.2f, localNormal.y)) * Mathf.Rad2Deg, -25f, 25f);
            float tiltZ = Mathf.Clamp(-Mathf.Atan2(localNormal.x, Mathf.Max(0.2f, localNormal.y)) * Mathf.Rad2Deg, -25f, 25f);
            ankle.localRotation = Quaternion.Euler(tiltX * stance, 0f, tiltZ * stance);
        }
    }
}
