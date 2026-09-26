using UnityEngine;

namespace Solmar.Vehicles
{
    /// <summary>
    /// A drivable car on four <see cref="WheelCollider"/>s: an engine torque curve by RPM, a 6-speed
    /// automatic gearbox, speed-sensitive steering with input smoothing and a countersteer assist,
    /// traction/stability control (X toggles it) and ABS-like brake modulation, a handbrake that
    /// drops rear grip for drifts, downforce and front/rear anti-roll bars. Rear-wheel drive.
    ///
    /// Tuned for an arcade-sim feel (GTA V / Forza Horizon): 0-100 km/h in about 6 seconds, a top
    /// speed around 200 km/h (drag-limited, not gear-limited), and grip that lets go progressively
    /// rather than snapping, so the driver can catch a slide.
    ///
    /// Input (W/S/A/D, Space, X) is only read while <see cref="Enter"/> has been called; otherwise the
    /// car sits on its handbrake, e.g. while parked waiting for the player. Wheel visuals (assigned
    /// by whoever builds the car, typically from <see cref="VehicleBody"/>) are moved onto each
    /// wheel's <see cref="WheelCollider.GetWorldPose"/> every frame.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public sealed class VehicleController : MonoBehaviour
    {
        [Header("Chassis")]
        public float mass = 1450f;
        public Vector3 centerOfMassOffset = new Vector3(0f, -0.5f, -0.05f);
        /// <summary>Quadratic aerodynamic drag (N per (m/s)^2), the main thing capping top speed.</summary>
        public float aeroDragCoefficient = 0.75f;

        [Header("Wheels (set by whoever assembles the car)")]
        public WheelCollider wheelFL;
        public WheelCollider wheelFR;
        public WheelCollider wheelRL;
        public WheelCollider wheelRR;
        public Transform wheelVisualFL;
        public Transform wheelVisualFR;
        public Transform wheelVisualRL;
        public Transform wheelVisualRR;

        [Header("Engine and gearbox")]
        public AnimationCurve torqueCurve;
        public float[] gearRatios = { 3.4f, 2.1f, 1.45f, 1.1f, 0.88f, 0.72f };
        public float reverseRatio = -3.0f;
        public float finalDrive = 4.1f;
        public float idleRpm = 900f;
        public float redlineRpm = 7000f;
        public float shiftUpRpm = 6500f;
        public float shiftDownRpm = 2800f;
        public float shiftDuration = 0.2f;
        public float reverseMaxKmh = 40f;
        public float coastEngineBrakeTorque = 90f;

        [Header("Steering")]
        public float maxSteerAngleLow = 34f;
        public float maxSteerAngleHigh = 9f;
        public float steerSpeedForFullAngle = 150f;
        public float steerRateDegPerSec = 260f;
        /// <summary>How fast the smoothed steer input tracks a growing key press (per second, -1..1 range).</summary>
        public float steerInputRatePerSec = 3.2f;
        /// <summary>How fast the smoothed steer input returns to centre once the key is released.</summary>
        public float steerReturnRatePerSec = 5.5f;
        /// <summary>Extra steer angle (deg) blended in opposite the excess yaw when the tail is sliding.</summary>
        public float countersteerAssistDeg = 6f;

        [Header("Braking and grip")]
        public float maxBrakeTorque = 4200f;
        public float brakeBiasFront = 0.65f;
        public float handbrakeTorque = 8000f;
        public float rearHandbrakeGripFactor = 0.45f;
        /// <summary>Forward slip magnitude past which ABS starts easing brake torque off (0..1ish).</summary>
        public float absSlipThreshold = 0.18f;
        /// <summary>Forward slip magnitude past which traction control starts cutting drive torque.</summary>
        public float tractionControlSlipThreshold = 0.14f;

        [Header("Stability control (toggle with X, on by default)")]
        public bool stabilityControlEnabled = true;
        public float yawDampingTorque = 4500f;

        [Header("Aero and roll")]
        public float downforceCoefficient = 3.2f;
        public float antiRollFront = 11000f;
        public float antiRollRear = 9500f;

        Rigidbody rb;
        float engineRpm;
        int currentGear = 1;
        float shiftTimer;
        float smoothedSteerInput;
        float currentSteerAngle;
        float frontSidewaysStiffness = 1.15f;
        float rearSidewaysStiffness = 1.3f;
        bool isPlayerControlled;
        bool prevStabilityKey;

        /// <summary>True from <see cref="Enter"/> until <see cref="Exit"/>.</summary>
        public bool IsPlayerControlled => isPlayerControlled;
        public float SpeedKmh => rb != null && IsFinite(rb.linearVelocity) ? rb.linearVelocity.magnitude * 3.6f : 0f;
        public Vector3 Velocity => rb != null ? rb.linearVelocity : Vector3.zero;
        public float Rpm => engineRpm;
        public float RedlineRpm => redlineRpm;
        public int GearNumber => currentGear;
        public string GearLabel => currentGear < 0 ? "R" : currentGear == 0 ? "N" : currentGear.ToString();
        public bool StabilityControlEnabled => stabilityControlEnabled;

        void Awake()
        {
            rb = GetComponent<Rigidbody>();
            rb.mass = mass;
            rb.centerOfMass = centerOfMassOffset;
            rb.interpolation = RigidbodyInterpolation.Interpolate;
            rb.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
            rb.linearDamping = 0.02f;
            rb.angularDamping = 0.5f;
            if (torqueCurve == null || torqueCurve.length == 0) torqueCurve = DefaultTorqueCurve();
            engineRpm = idleRpm;
        }

        static AnimationCurve DefaultTorqueCurve()
        {
            // ~430 Nm peak around 4200 rpm, still pulling hard from just above idle: enough with the
            // gearing below for 0-100 km/h in about 6 s, redline taper sets the drag-limited top speed.
            var curve = new AnimationCurve(
                new Keyframe(800f, 220f),
                new Keyframe(2000f, 380f),
                new Keyframe(4200f, 430f),
                new Keyframe(5500f, 400f),
                new Keyframe(7000f, 260f));
            for (int i = 0; i < curve.length; i++) curve.SmoothTangents(i, 0.35f);
            return curve;
        }

        /// <summary>Creates the four wheel colliders at the given slots and wires up their visuals.</summary>
        public void AttachWheels(VehicleBody.WheelSlot[] slots)
        {
            if (slots == null || slots.Length < 4) return;
            wheelFL = CreateWheel(transform, slots[0].localPosition, true);
            wheelFR = CreateWheel(transform, slots[1].localPosition, true);
            wheelRL = CreateWheel(transform, slots[2].localPosition, false);
            wheelRR = CreateWheel(transform, slots[3].localPosition, false);
            wheelVisualFL = slots[0].visual;
            wheelVisualFR = slots[1].visual;
            wheelVisualRL = slots[2].visual;
            wheelVisualRR = slots[3].visual;
        }

        WheelCollider CreateWheel(Transform root, Vector3 localPosition, bool front)
        {
            var go = new GameObject(front ? "Wheel collider (front)" : "Wheel collider (rear)");
            go.transform.SetParent(root, false);
            go.transform.localPosition = localPosition;
            var wc = go.AddComponent<WheelCollider>();
            wc.radius = VehicleBody.WheelRadius;
            wc.mass = 20f;
            wc.wheelDampingRate = 0.25f;
            wc.suspensionDistance = 0.26f;
            wc.forceAppPointDistance = 0.05f;
            var spring = wc.suspensionSpring;
            spring.spring = 42000f;
            spring.damper = 4200f;
            spring.targetPosition = 0.5f;
            wc.suspensionSpring = spring;

            // Sideways grip: rear a little above front for a stable, planted rear axle (a car whose
            // front grips harder than its rear tends to snap into oversteer). Extremum/asymptote fall
            // off progressively past the peak slip angle instead of cliff-edging into a slide.
            var sideways = wc.sidewaysFriction;
            sideways.extremumSlip = 0.2f;
            sideways.extremumValue = 1.0f;
            sideways.asymptoteSlip = 0.55f;
            sideways.asymptoteValue = 0.75f;
            sideways.stiffness = front ? frontSidewaysStiffness : rearSidewaysStiffness;
            wc.sidewaysFriction = sideways;

            var forward = wc.forwardFriction;
            forward.extremumSlip = 0.17f;
            forward.extremumValue = 1.0f;
            forward.asymptoteSlip = 0.5f;
            forward.asymptoteValue = 0.8f;
            forward.stiffness = 1.6f;
            wc.forwardFriction = forward;
            return wc;
        }

        /// <summary>Takes control: input is read and the handbrake releases.</summary>
        public void Enter()
        {
            isPlayerControlled = true;
        }

        /// <summary>Gives up control: the handbrake holds the car in place.</summary>
        public void Exit()
        {
            isPlayerControlled = false;
            smoothedSteerInput = 0f;
            currentSteerAngle = 0f;
            if (wheelFL != null) wheelFL.steerAngle = 0f;
            if (wheelFR != null) wheelFR.steerAngle = 0f;
        }

        bool WheelsReady => wheelFL != null && wheelFR != null && wheelRL != null && wheelRR != null;

        void FixedUpdate()
        {
            if (rb == null || !WheelsReady) return;
            if (shiftTimer > 0f) shiftTimer -= Time.fixedDeltaTime;

            float throttle = 0f, brakeInput = 0f, steer = 0f;
            bool handbrake = !isPlayerControlled;
#if ENABLE_LEGACY_INPUT_MANAGER
            if (isPlayerControlled)
            {
                throttle = Input.GetKey(KeyCode.W) ? 1f : 0f;
                brakeInput = Input.GetKey(KeyCode.S) ? 1f : 0f;
                steer = (Input.GetKey(KeyCode.D) ? 1f : 0f) - (Input.GetKey(KeyCode.A) ? 1f : 0f);
                handbrake = handbrake || Input.GetKey(KeyCode.Space);

                bool stabilityKey = Input.GetKey(KeyCode.X);
                if (stabilityKey && !prevStabilityKey) stabilityControlEnabled = !stabilityControlEnabled;
                prevStabilityKey = stabilityKey;
            }
#endif
            UpdateSteering(steer);
            UpdateDrive(throttle, brakeInput, handbrake);
            ApplyAeroDrag();
            ApplyAntiRoll(wheelFL, wheelFR, antiRollFront);
            ApplyAntiRoll(wheelRL, wheelRR, antiRollRear);
            ApplyDownforce();
        }

        void UpdateSteering(float steerInput)
        {
            float target = Mathf.Clamp(steerInput, -1f, 1f);
            // Smooth the raw key input like a wheel turning in, with a quicker return to centre so
            // the car doesn't keep tracing an old input once the key is released (no instant snap).
            bool growing = Mathf.Abs(target) > Mathf.Abs(smoothedSteerInput) + 0.001f;
            float inputRate = growing ? steerInputRatePerSec : steerReturnRatePerSec;
            smoothedSteerInput = Mathf.MoveTowards(smoothedSteerInput, target, inputRate * Time.fixedDeltaTime);
            if (!float.IsFinite(smoothedSteerInput)) smoothedSteerInput = 0f;

            float speedKmh = SpeedKmh;
            float t = Mathf.Clamp01(speedKmh / Mathf.Max(1f, steerSpeedForFullAngle));
            float maxAngle = Mathf.Lerp(maxSteerAngleLow, maxSteerAngleHigh, t);
            float wheelAngle = smoothedSteerInput * maxAngle;

            // Countersteer assist: if the tail is rotating faster than the steering alone would
            // explain (the car is sliding), blend in a little opposite lock to help catch it. Only
            // while stability control is on, and only up to a small cap so the driver stays in charge.
            if (stabilityControlEnabled && rb != null && speedKmh > 8f)
            {
                float forwardSpeed = Vector3.Dot(rb.linearVelocity, transform.forward);
                float wheelbase = Mathf.Max(0.1f, VehicleBody.Wheelbase);
                float expectedYawRate = forwardSpeed * Mathf.Tan(wheelAngle * Mathf.Deg2Rad) / wheelbase;
                float actualYawRate = rb.angularVelocity.y;
                if (float.IsFinite(expectedYawRate) && float.IsFinite(actualYawRate))
                {
                    float excess = actualYawRate - expectedYawRate;
                    float assist = Mathf.Clamp(-excess * Mathf.Rad2Deg * 0.15f, -countersteerAssistDeg, countersteerAssistDeg);
                    wheelAngle += assist;
                }
            }

            currentSteerAngle = Mathf.MoveTowards(currentSteerAngle, wheelAngle, steerRateDegPerSec * Time.fixedDeltaTime);
            if (!float.IsFinite(currentSteerAngle)) currentSteerAngle = 0f;
            currentSteerAngle = Mathf.Clamp(currentSteerAngle, -maxSteerAngleLow - countersteerAssistDeg, maxSteerAngleLow + countersteerAssistDeg);
            wheelFL.steerAngle = currentSteerAngle;
            wheelFR.steerAngle = currentSteerAngle;

            // Yaw damping: a light corrective torque opposing rotation beyond what the speed and
            // steering call for, i.e. the stability-control half of ESC (traction control is the
            // drive-torque cut in UpdateDrive).
            if (stabilityControlEnabled && rb != null && !handbrakeHeldLastFrame)
            {
                float forwardSpeed = Vector3.Dot(rb.linearVelocity, transform.forward);
                float wheelbase = Mathf.Max(0.1f, VehicleBody.Wheelbase);
                float expectedYawRate = forwardSpeed * Mathf.Tan(currentSteerAngle * Mathf.Deg2Rad) / wheelbase;
                float actualYawRate = rb.angularVelocity.y;
                if (float.IsFinite(expectedYawRate) && float.IsFinite(actualYawRate))
                {
                    float error = actualYawRate - expectedYawRate;
                    float correctiveTorque = Mathf.Clamp(-error * yawDampingTorque, -yawDampingTorque, yawDampingTorque);
                    if (float.IsFinite(correctiveTorque)) rb.AddTorque(Vector3.up * correctiveTorque);
                }
            }
        }

        bool handbrakeHeldLastFrame;

        void UpdateDrive(float throttle, float brakeInput, bool handbrake)
        {
            handbrakeHeldLastFrame = handbrake;
            float forwardSpeed = Vector3.Dot(rb.linearVelocity, transform.forward);
            if (!float.IsFinite(forwardSpeed)) forwardSpeed = 0f;

            float wheelRpmAvg = (wheelRL.rpm + wheelRR.rpm) * 0.5f;
            if (!float.IsFinite(wheelRpmAvg)) wheelRpmAvg = 0f;

            bool reverseRequested = brakeInput > 0.01f && throttle < 0.01f && forwardSpeed < 0.5f;
            float ratio = reverseRequested ? reverseRatio * finalDrive : CurrentGearRatio() * finalDrive;

            float targetRpm = idleRpm + Mathf.Abs(wheelRpmAvg) * Mathf.Abs(ratio);
            if (!float.IsFinite(targetRpm)) targetRpm = idleRpm;
            targetRpm = Mathf.Clamp(targetRpm, idleRpm, redlineRpm);
            engineRpm = Mathf.Lerp(engineRpm, targetRpm, 1f - Mathf.Exp(-5f * Time.fixedDeltaTime));
            engineRpm = Mathf.Clamp(engineRpm, idleRpm, redlineRpm);

            float driveTorque = 0f;
            float brakeTorque = 0f;

            if (reverseRequested)
            {
                currentGear = -1;
                float engineTorque = torqueCurve.Evaluate(engineRpm);
                driveTorque = -engineTorque * Mathf.Abs(ratio) * brakeInput;
                // Cap reverse speed: taper the torque out once past the reverse top speed.
                float reverseMaxMs = reverseMaxKmh / 3.6f;
                if (forwardSpeed < -reverseMaxMs) driveTorque = 0f;
            }
            else
            {
                if (currentGear < 1) currentGear = 1;
                if (brakeInput > 0.01f && forwardSpeed > 0.3f)
                {
                    brakeTorque = maxBrakeTorque * brakeInput;
                }
                else if (throttle > 0.01f)
                {
                    float engineTorque = torqueCurve.Evaluate(engineRpm);
                    driveTorque = engineTorque * ratio * throttle;
                    AutoShift();
                }
                else
                {
                    // Engine braking: stronger in a lower (higher-ratio) gear, like a real drivetrain.
                    brakeTorque = coastEngineBrakeTorque * (0.6f + Mathf.Abs(CurrentGearRatio()) * 0.4f);
                }
            }

            if (!float.IsFinite(driveTorque)) driveTorque = 0f;
            if (!float.IsFinite(brakeTorque)) brakeTorque = 0f;

            // Traction control: ease the rear drive torque off when the driven wheels are spinning up
            // noticeably faster than the road, instead of just lighting them up.
            if (stabilityControlEnabled && driveTorque > 0f)
            {
                float slip = Mathf.Max(WheelForwardSlip(wheelRL), WheelForwardSlip(wheelRR));
                if (slip > tractionControlSlipThreshold)
                {
                    float over = (slip - tractionControlSlipThreshold) / Mathf.Max(0.01f, 1f - tractionControlSlipThreshold);
                    driveTorque *= Mathf.Clamp01(1f - over);
                }
            }

            wheelRL.motorTorque = handbrake ? 0f : driveTorque;
            wheelRR.motorTorque = handbrake ? 0f : driveTorque;
            wheelFL.motorTorque = 0f;
            wheelFR.motorTorque = 0f;

            // Brake bias front/rear, then ABS-like modulation per wheel so a wheel that's about to
            // lock gets eased off rather than staying clamped at full brake torque.
            float frontBrake = brakeTorque * (brakeBiasFront * 2f);
            float rearBrake = brakeTorque * ((1f - brakeBiasFront) * 2f);
            wheelFL.brakeTorque = handbrake ? 0f : AbsModulate(wheelFL, frontBrake);
            wheelFR.brakeTorque = handbrake ? 0f : AbsModulate(wheelFR, frontBrake);
            wheelRL.brakeTorque = handbrake ? handbrakeTorque : AbsModulate(wheelRL, rearBrake);
            wheelRR.brakeTorque = handbrake ? handbrakeTorque : AbsModulate(wheelRR, rearBrake);

            // Handbrake drops rear sideways grip so the tail steps out under power or turning, but
            // only while it's actually held - a deliberate, controllable slide rather than a default one.
            var rearSide = wheelRL.sidewaysFriction;
            rearSide.stiffness = handbrake ? rearSidewaysStiffness * rearHandbrakeGripFactor : rearSidewaysStiffness;
            wheelRL.sidewaysFriction = rearSide;
            wheelRR.sidewaysFriction = rearSide;
        }

        /// <summary>Absolute forward slip at a wheel (0 = rolling with the road, larger = spinning/locking).</summary>
        static float WheelForwardSlip(WheelCollider wc)
        {
            if (wc.GetGroundHit(out WheelHit hit) && float.IsFinite(hit.forwardSlip)) return Mathf.Abs(hit.forwardSlip);
            return 0f;
        }

        /// <summary>Eases a wheel's brake torque off once its forward slip says it's about to lock.</summary>
        float AbsModulate(WheelCollider wc, float requestedTorque)
        {
            if (requestedTorque <= 0f) return 0f;
            float slip = WheelForwardSlip(wc);
            if (slip <= absSlipThreshold) return requestedTorque;
            float over = (slip - absSlipThreshold) / Mathf.Max(0.01f, 1f - absSlipThreshold);
            return requestedTorque * Mathf.Clamp01(1f - over * 0.85f);
        }

        float CurrentGearRatio()
        {
            if (gearRatios == null || gearRatios.Length == 0) return 1f;
            int index = Mathf.Clamp(currentGear - 1, 0, gearRatios.Length - 1);
            return gearRatios[index];
        }

        void AutoShift()
        {
            if (shiftTimer > 0f || gearRatios == null || gearRatios.Length == 0) return;
            if (currentGear < gearRatios.Length && engineRpm > shiftUpRpm)
            {
                currentGear++;
                shiftTimer = shiftDuration;
            }
            else if (currentGear > 1 && engineRpm < shiftDownRpm)
            {
                currentGear--;
                shiftTimer = shiftDuration;
            }
        }

        void ApplyAntiRoll(WheelCollider left, WheelCollider right, float antiRoll)
        {
            if (antiRoll <= 0f) return;
            float travelL = 1f, travelR = 1f;
            bool groundedL = left.GetGroundHit(out WheelHit hitL);
            if (groundedL)
            {
                float d = (-left.transform.InverseTransformPoint(hitL.point).y - left.radius) / left.suspensionDistance;
                if (float.IsFinite(d)) travelL = d;
            }
            bool groundedR = right.GetGroundHit(out WheelHit hitR);
            if (groundedR)
            {
                float d = (-right.transform.InverseTransformPoint(hitR.point).y - right.radius) / right.suspensionDistance;
                if (float.IsFinite(d)) travelR = d;
            }
            float force = (travelL - travelR) * antiRoll;
            if (!float.IsFinite(force)) return;
            if (groundedL) rb.AddForceAtPosition(left.transform.up * -force, left.transform.position);
            if (groundedR) rb.AddForceAtPosition(right.transform.up * force, right.transform.position);
        }

        /// <summary>Quadratic aerodynamic drag - the main thing that caps top speed (not the gearing).</summary>
        void ApplyAeroDrag()
        {
            Vector3 v = rb.linearVelocity;
            if (!IsFinite(v)) return;
            float speed = v.magnitude;
            if (speed < 0.05f) return;
            float force = aeroDragCoefficient * speed * speed;
            if (!float.IsFinite(force)) return;
            rb.AddForce(-v.normalized * force);
        }

        void ApplyDownforce()
        {
            Vector3 v = rb.linearVelocity;
            if (!IsFinite(v)) return;
            float speed = v.magnitude;
            float force = downforceCoefficient * speed * speed;
            if (float.IsFinite(force)) rb.AddForce(-transform.up * force);
        }

        void Update()
        {
            UpdateWheelVisual(wheelFL, wheelVisualFL);
            UpdateWheelVisual(wheelFR, wheelVisualFR);
            UpdateWheelVisual(wheelRL, wheelVisualRL);
            UpdateWheelVisual(wheelRR, wheelVisualRR);
        }

        static void UpdateWheelVisual(WheelCollider collider, Transform visual)
        {
            if (collider == null || visual == null) return;
            collider.GetWorldPose(out Vector3 pos, out Quaternion rot);
            if (!IsFinite(pos) || !IsFinite(rot)) return;
            visual.SetPositionAndRotation(pos, rot);
        }

        static bool IsFinite(Vector3 v) => float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z);
        static bool IsFinite(Quaternion q) => float.IsFinite(q.x) && float.IsFinite(q.y) && float.IsFinite(q.z) && float.IsFinite(q.w);
    }
}
