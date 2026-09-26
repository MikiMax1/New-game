using UnityEngine;

namespace Solmar.Vehicles
{
    /// <summary>
    /// A drivable car on four <see cref="WheelCollider"/>s: an engine torque curve by RPM, a 6-speed
    /// automatic gearbox, speed-sensitive steering, a handbrake that drops rear grip for drifts,
    /// downforce and front/rear anti-roll bars. Rear-wheel drive.
    ///
    /// Input (W/S/A/D, Space) is only read while <see cref="Enter"/> has been called; otherwise the
    /// car sits on its handbrake, e.g. while parked waiting for the player. Wheel visuals (assigned
    /// by whoever builds the car, typically from <see cref="VehicleBody"/>) are moved onto each
    /// wheel's <see cref="WheelCollider.GetWorldPose"/> every frame.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public sealed class VehicleController : MonoBehaviour
    {
        [Header("Chassis")]
        public float mass = 1450f;
        public Vector3 centerOfMassOffset = new Vector3(0f, -0.45f, -0.1f);

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
        public float[] gearRatios = { 3.9f, 2.5f, 1.7f, 1.25f, 1.0f, 0.82f };
        public float reverseRatio = -3.5f;
        public float finalDrive = 3.7f;
        public float idleRpm = 900f;
        public float redlineRpm = 6800f;
        public float shiftUpRpm = 6200f;
        public float shiftDownRpm = 2400f;
        public float shiftDuration = 0.35f;

        [Header("Steering")]
        public float maxSteerAngleLow = 34f;
        public float maxSteerAngleHigh = 8f;
        public float steerSpeedForFullAngle = 130f;
        public float steerRateDegPerSec = 200f;

        [Header("Braking and grip")]
        public float maxBrakeTorque = 3200f;
        public float handbrakeTorque = 7000f;
        public float coastBrakeTorque = 120f;
        public float rearHandbrakeGripFactor = 0.32f;

        [Header("Aero and roll")]
        public float downforceCoefficient = 2.6f;
        public float antiRollFront = 9000f;
        public float antiRollRear = 7000f;

        Rigidbody rb;
        float engineRpm;
        int currentGear = 1;
        float shiftTimer;
        float currentSteerAngle;
        float frontSidewaysStiffness = 1.9f;
        float rearSidewaysStiffness = 1.7f;
        bool isPlayerControlled;

        /// <summary>True from <see cref="Enter"/> until <see cref="Exit"/>.</summary>
        public bool IsPlayerControlled => isPlayerControlled;
        public float SpeedKmh => rb != null && IsFinite(rb.linearVelocity) ? rb.linearVelocity.magnitude * 3.6f : 0f;
        public Vector3 Velocity => rb != null ? rb.linearVelocity : Vector3.zero;
        public float Rpm => engineRpm;
        public float RedlineRpm => redlineRpm;
        public int GearNumber => currentGear;
        public string GearLabel => currentGear < 0 ? "R" : currentGear == 0 ? "N" : currentGear.ToString();

        void Awake()
        {
            rb = GetComponent<Rigidbody>();
            rb.mass = mass;
            rb.centerOfMass = centerOfMassOffset;
            rb.interpolation = RigidbodyInterpolation.Interpolate;
            rb.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
            if (torqueCurve == null || torqueCurve.length == 0) torqueCurve = DefaultTorqueCurve();
            engineRpm = idleRpm;
        }

        static AnimationCurve DefaultTorqueCurve()
        {
            var curve = new AnimationCurve(
                new Keyframe(700f, 80f),
                new Keyframe(1500f, 150f),
                new Keyframe(3000f, 235f),
                new Keyframe(4500f, 260f),
                new Keyframe(5500f, 235f),
                new Keyframe(6800f, 140f));
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

            var sideways = wc.sidewaysFriction;
            sideways.extremumSlip = 0.22f;
            sideways.extremumValue = 1.05f;
            sideways.asymptoteSlip = 0.5f;
            sideways.asymptoteValue = 0.8f;
            sideways.stiffness = front ? frontSidewaysStiffness : rearSidewaysStiffness;
            wc.sidewaysFriction = sideways;

            var forward = wc.forwardFriction;
            forward.extremumSlip = 0.4f;
            forward.extremumValue = 1.0f;
            forward.asymptoteSlip = 0.8f;
            forward.asymptoteValue = 0.7f;
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
            }
#endif
            UpdateSteering(steer);
            UpdateDrive(throttle, brakeInput, handbrake);
            ApplyAntiRoll(wheelFL, wheelFR, antiRollFront);
            ApplyAntiRoll(wheelRL, wheelRR, antiRollRear);
            ApplyDownforce();
        }

        void UpdateSteering(float steerInput)
        {
            float speedKmh = SpeedKmh;
            float t = Mathf.Clamp01(speedKmh / Mathf.Max(1f, steerSpeedForFullAngle));
            float maxAngle = Mathf.Lerp(maxSteerAngleLow, maxSteerAngleHigh, t);
            float target = Mathf.Clamp(steerInput, -1f, 1f) * maxAngle;
            currentSteerAngle = Mathf.MoveTowards(currentSteerAngle, target, steerRateDegPerSec * Time.fixedDeltaTime);
            if (!float.IsFinite(currentSteerAngle)) currentSteerAngle = 0f;
            wheelFL.steerAngle = currentSteerAngle;
            wheelFR.steerAngle = currentSteerAngle;
        }

        void UpdateDrive(float throttle, float brakeInput, bool handbrake)
        {
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
                    brakeTorque = coastBrakeTorque;
                }
            }

            if (!float.IsFinite(driveTorque)) driveTorque = 0f;
            if (!float.IsFinite(brakeTorque)) brakeTorque = 0f;

            wheelRL.motorTorque = handbrake ? 0f : driveTorque;
            wheelRR.motorTorque = handbrake ? 0f : driveTorque;
            wheelFL.motorTorque = 0f;
            wheelFR.motorTorque = 0f;

            wheelFL.brakeTorque = brakeTorque;
            wheelFR.brakeTorque = brakeTorque;
            wheelRL.brakeTorque = handbrake ? handbrakeTorque : brakeTorque;
            wheelRR.brakeTorque = handbrake ? handbrakeTorque : brakeTorque;

            // Handbrake drops rear sideways grip so the tail steps out under power or turning.
            var rearSide = wheelRL.sidewaysFriction;
            rearSide.stiffness = handbrake ? rearSidewaysStiffness * rearHandbrakeGripFactor : rearSidewaysStiffness;
            wheelRL.sidewaysFriction = rearSide;
            wheelRR.sidewaysFriction = rearSide;
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
