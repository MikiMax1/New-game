using Solmar.Traffic;
using Solmar.Vehicles;
using UnityEngine;

namespace Solmar.Police
{
    /// <summary>What a pooled <see cref="PoliceCar"/> is currently doing.</summary>
    public enum PoliceCarRole
    {
        /// <summary>Chasing the player: lane-following from a distance, direct pursuit (and a PIT
        /// attempt at 3+ stars) once close.</summary>
        Chaser,
        /// <summary>Parked across a lane ahead of the player's route (4-5 stars), lights flashing,
        /// engine off, doing nothing but blocking the road and taking a hit if the player ploughs in.</summary>
        Roadblock,
    }

    /// <summary>
    /// One police cruiser: from a distance it drives the same <see cref="LaneNetwork"/> traffic uses
    /// (<see cref="Solmar.Traffic.TrafficCar"/>'s lane/turn/arc-length technique), but ignoring signals
    /// and picking, at every junction, whichever turn's destination lies closest to the player right
    /// now, at a higher speed than ordinary traffic. Once close it drops the lane graph for a direct
    /// pursuit, steering straight at the player (or, once ramming is armed at 3+ stars, at an offset
    /// aimed to PIT their rear quarter). A kinematic <see cref="Rigidbody"/> (built by
    /// <see cref="VehicleBody.Build"/>, model <see cref="CarModel.Police"/>) lets the player's car push
    /// against it exactly like ordinary traffic; a hard enough hit (either way) turns it into an
    /// ordinary dynamic wreck, same rule as <see cref="TrafficCar"/>. Stops and lets
    /// <see cref="PoliceManager"/> deploy foot officers once it closes on a player who is on foot.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public sealed class PoliceCar : MonoBehaviour
    {
        const float ChaseSpeedFactor = 1.35f;
        const float ChaseSpeedCap = 36f; // ~130 km/h
        const float MaxAccel = 6f;
        const float MaxDecel = 8f;
        const float DirectChaseEnterRange = 42f;
        const float DirectChaseExitRange = 56f;
        const float DeployOfficerRange = 10f;

        Transform selfTransform;
        Rigidbody rb;
        Transform wheelFL, wheelFR, wheelRL, wheelRR;
        float wheelSpinDeg;
        float pitSide;

        PoliceLightBar lightBar;
        PoliceSiren siren;

        PoliceCarRole role;
        bool ramming;
        bool onDirectChase;
        bool hasDeployedOfficers;

        TrafficLane lane;
        TrafficTurn turn;
        bool onTurn;
        Vector3[] pts;
        float[] cum;
        float pathLength;
        int cursor;
        float distAlong;

        float speed;
        bool isWrecked;
        bool active;

        public bool Active => active;
        public bool IsWrecked => isWrecked;
        public PoliceCarRole Role => role;
        public Vector3 Position => selfTransform != null ? selfTransform.position : Vector3.zero;

        public void Init(VehicleBody.WheelSlot[] wheels, int index)
        {
            selfTransform = transform;
            rb = GetComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.interpolation = RigidbodyInterpolation.Interpolate;
            if (wheels != null && wheels.Length >= 4)
            {
                wheelFL = wheels[0].visual;
                wheelFR = wheels[1].visual;
                wheelRL = wheels[2].visual;
                wheelRR = wheels[3].visual;
            }
            pitSide = (index % 2 == 0) ? 1f : -1f;
            lightBar = GetComponent<PoliceLightBar>();
            siren = GetComponent<PoliceSiren>();
        }

        public void SetRamming(bool value) => ramming = value;

        /// <summary>(Re)starts this pooled cruiser as a chaser on `startLane` at arc-length `startDistAlong`.</summary>
        public void Spawn(TrafficLane startLane, float startDistAlong, bool rammingFlag)
        {
            role = PoliceCarRole.Chaser;
            ramming = rammingFlag;
            lane = startLane;
            onTurn = false;
            turn = null;
            pts = lane.Points;
            cum = lane.Cumulative;
            pathLength = Mathf.Max(0.01f, lane.Length);
            cursor = 0;
            distAlong = Mathf.Clamp(startDistAlong, 0f, pathLength);
            speed = Mathf.Min(lane.SpeedLimit, 10f);
            isWrecked = false;
            active = true;
            onDirectChase = false;
            hasDeployedOfficers = false;
            wheelSpinDeg = 0f;

            TrafficPath.Sample(pts, cum, ref cursor, distAlong, out Vector3 pos, out Vector3 fwd);
            rb.isKinematic = true;
            rb.position = pos;
            rb.rotation = SafeLookRotation(fwd);
            rb.linearVelocity = Vector3.zero;
            gameObject.SetActive(true);
            lightBar?.SetFlashing(true);
        }

        /// <summary>(Re)starts this pooled cruiser parked as a stationary roadblock at a fixed pose.</summary>
        public void SpawnRoadblock(Vector3 position, Quaternion rotation)
        {
            role = PoliceCarRole.Roadblock;
            lane = null;
            onTurn = false;
            turn = null;
            speed = 0f;
            isWrecked = false;
            active = true;
            hasDeployedOfficers = true; // roadblocks never chase on foot
            rb.isKinematic = true;
            rb.position = position;
            rb.rotation = rotation;
            rb.linearVelocity = Vector3.zero;
            gameObject.SetActive(true);
            lightBar?.SetFlashing(true);
        }

        public void Despawn()
        {
            active = false;
            isWrecked = false;
            if (rb != null)
            {
                rb.isKinematic = true;
                rb.linearVelocity = Vector3.zero;
            }
            lightBar?.SetFlashing(false);
            siren?.SetOn(false);
            gameObject.SetActive(false);
        }

        public void Tick(float dt, PoliceManager manager)
        {
            if (!active || dt <= 0f || !float.IsFinite(dt)) return;

            if (isWrecked)
            {
                siren?.SetOn(false);
                return;
            }

            if (role == PoliceCarRole.Roadblock)
            {
                speed = 0f;
                rb.linearVelocity = Vector3.zero;
                siren?.SetOn(false);
                return;
            }

            bool haveTarget = manager.PlayerDriving || manager.PlayerOnFoot;
            if (!haveTarget)
            {
                speed = Mathf.MoveTowards(speed, 0f, MaxDecel * dt);
                return;
            }

            Vector3 target = manager.PlayerPosition;
            float distToTarget = Vector3.Distance(selfTransform.position, target);

            float exitThreshold = onDirectChase ? DirectChaseExitRange : DirectChaseEnterRange;
            onDirectChase = distToTarget < exitThreshold;

            if (onDirectChase) DriveDirect(dt, target, manager);
            else DriveLane(dt, target);

            siren?.SetOn(true);

            if (!hasDeployedOfficers && manager.PlayerOnFoot && distToTarget < DeployOfficerRange)
            {
                hasDeployedOfficers = true;
                speed = 0f;
                manager.DeployOfficers(selfTransform.position);
            }
        }

        void DriveLane(float dt, Vector3 target)
        {
            if (lane == null) { speed = Mathf.MoveTowards(speed, 0f, MaxDecel * dt); return; }

            float baseLimit = onTurn && turn != null ? Mathf.Min(turn.From.SpeedLimit, turn.To.SpeedLimit) : lane.SpeedLimit;
            float v0 = Mathf.Min(baseLimit * ChaseSpeedFactor, ChaseSpeedCap);

            float obstacleGap = PerceiveObstacleGap();
            float targetSpeed = v0;
            if (obstacleGap < 9999f)
            {
                float safe = Mathf.Max(0f, obstacleGap - 5f);
                targetSpeed = Mathf.Min(v0, safe * 1.4f);
            }

            float accel = targetSpeed > speed ? MaxAccel : -MaxDecel;
            speed = Mathf.Clamp(speed + accel * dt, 0f, ChaseSpeedCap);
            if (!float.IsFinite(speed)) speed = 0f;

            Vector3 oldForward = selfTransform.forward;
            AdvanceAlongPath(dt, target);

            TrafficPath.Sample(pts, cum, ref cursor, distAlong, out Vector3 pos, out Vector3 fwd);
            rb.MovePosition(pos);
            rb.MoveRotation(SafeLookRotation(fwd));
            rb.linearVelocity = fwd * speed;
            UpdateWheels(dt, oldForward, fwd);
        }

        void AdvanceAlongPath(float dt, Vector3 target)
        {
            distAlong += speed * dt;
            if (!float.IsFinite(distAlong)) distAlong = 0f;

            int guard = 0;
            while (distAlong >= pathLength && guard < 4)
            {
                guard++;
                float overflow = distAlong - pathLength;

                if (onTurn)
                {
                    TrafficLane nextLane = turn.To;
                    onTurn = false;
                    turn = null;
                    lane = nextLane;
                    pts = lane.Points;
                    cum = lane.Cumulative;
                    pathLength = Mathf.Max(0.01f, lane.Length);
                    cursor = 0;
                    distAlong = Mathf.Clamp(overflow, 0f, pathLength);
                }
                else
                {
                    TrafficTurn next = PickChaseTurn(lane, target);
                    if (next == null) { distAlong = pathLength; speed = 0f; break; }
                    turn = next;
                    onTurn = true;
                    pts = turn.Points;
                    cum = turn.Cumulative;
                    pathLength = Mathf.Max(0.01f, turn.Length);
                    cursor = 0;
                    distAlong = Mathf.Clamp(overflow, 0f, pathLength);
                }
            }
        }

        /// <summary>Ignoring signals and occupancy (police push through): among this lane's turns,
        /// the one whose destination lane ends closest to `target` right now.</summary>
        static TrafficTurn PickChaseTurn(TrafficLane fromLane, Vector3 target)
        {
            var options = fromLane.Turns;
            int count = options.Count;
            if (count == 0) return null;
            var targetXZ = new Vector2(target.x, target.z);
            TrafficTurn best = options[0];
            float bestDist = float.MaxValue;
            for (int i = 0; i < count; i++)
            {
                TrafficTurn t = options[i];
                Vector3 end = t.To.Points[t.To.Points.Length - 1];
                float d = (new Vector2(end.x, end.z) - targetXZ).sqrMagnitude;
                if (d < bestDist) { bestDist = d; best = t; }
            }
            return best;
        }

        float PerceiveObstacleGap()
        {
            Vector3 forward = selfTransform.forward;
            if (forward.sqrMagnitude < 1e-6f) return 9999f;
            float maxDist = Mathf.Clamp(speed * 2f + 12f, 12f, 40f);
            Vector3 origin = selfTransform.position + Vector3.up * 0.5f + forward * (VehicleBody.Length * 0.5f + 0.3f);
            float radius = VehicleBody.Width * 0.45f;
            if (!Physics.SphereCast(origin, radius, forward, out RaycastHit hit, maxDist, ~0, QueryTriggerInteraction.Ignore)) return 9999f;
            if (hit.rigidbody == rb) return 9999f;
            return Mathf.Max(0.1f, hit.distance);
        }

        void DriveDirect(float dt, Vector3 target, PoliceManager manager)
        {
            Vector3 aim = target;
            if (ramming && manager.PlayerDriving)
            {
                Vector3 pf = manager.PlayerForward; pf.y = 0f;
                pf = pf.sqrMagnitude > 1e-6f ? pf.normalized : Vector3.forward;
                Vector3 pr = new Vector3(pf.z, 0f, -pf.x);
                aim = target - pf * 2.4f + pr * (2.1f * pitSide);
            }

            Vector3 toAim = aim - selfTransform.position; toAim.y = 0f;
            float dist = toAim.magnitude;
            Vector3 desiredFwd = dist > 0.05f ? toAim / dist : selfTransform.forward;

            float turnRateDeg = Mathf.Lerp(240f, 110f, Mathf.Clamp01(speed / ChaseSpeedCap));
            Vector3 oldForward = selfTransform.forward;
            Vector3 newForward = Vector3.RotateTowards(oldForward, desiredFwd, turnRateDeg * Mathf.Deg2Rad * dt, 0f);
            if (newForward.sqrMagnitude < 1e-6f) newForward = oldForward;

            float targetSpeed = ramming ? ChaseSpeedCap : Mathf.Min(ChaseSpeedCap, Mathf.Max(4f, dist * 1.1f));
            float accel = targetSpeed > speed ? MaxAccel : -MaxDecel;
            speed = Mathf.Clamp(speed + accel * dt, 0f, ChaseSpeedCap);
            if (!float.IsFinite(speed)) speed = 0f;

            Vector3 pos = selfTransform.position + newForward.normalized * speed * dt;
            pos.y = PoliceUtil.GroundHeight(pos.x, pos.z, selfTransform.position.y);
            rb.MovePosition(pos);
            rb.MoveRotation(SafeLookRotation(newForward));
            rb.linearVelocity = newForward.normalized * speed;
            UpdateWheels(dt, oldForward, newForward);
        }

        void UpdateWheels(float dt, Vector3 oldForward, Vector3 newForward)
        {
            if (wheelRL == null || wheelRR == null) return;
            float wheelRadius = Mathf.Max(0.05f, VehicleBody.WheelRadius);
            float spinDelta = (speed / wheelRadius) * Mathf.Rad2Deg * dt;
            if (float.IsFinite(spinDelta)) wheelSpinDeg = Mathf.Repeat(wheelSpinDeg + spinDelta, 360f);
            Quaternion spin = Quaternion.Euler(wheelSpinDeg, 0f, 0f);

            float steerDeg = 0f;
            float signed = Vector3.SignedAngle(oldForward, newForward, Vector3.up);
            if (float.IsFinite(signed)) steerDeg = Mathf.Clamp(signed * 6f, -32f, 32f);
            Quaternion steer = Quaternion.Euler(0f, steerDeg, 0f);

            wheelRL.localRotation = spin;
            wheelRR.localRotation = spin;
            if (wheelFL != null) wheelFL.localRotation = steer * spin;
            if (wheelFR != null) wheelFR.localRotation = steer * spin;
        }

        void OnCollisionEnter(Collision collision)
        {
            if (!active || isWrecked) return;
            float rel = collision.relativeVelocity.magnitude;
            if (!float.IsFinite(rel) || rel <= 4f) return;

            isWrecked = true;
            speed = 0f;
            rb.isKinematic = false;
            siren?.SetOn(false);
        }

        static Quaternion SafeLookRotation(Vector3 forward)
        {
            if (forward.sqrMagnitude < 1e-6f || !float.IsFinite(forward.x) || !float.IsFinite(forward.y) || !float.IsFinite(forward.z)) return Quaternion.identity;
            return Quaternion.LookRotation(forward, Vector3.up);
        }
    }
}
