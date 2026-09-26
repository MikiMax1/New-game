using System.Collections.Generic;
using Solmar.Vehicles;
using UnityEngine;

namespace Solmar.Traffic
{
    /// <summary>
    /// One ambient traffic car: drives kinematically along the <see cref="LaneNetwork"/> using the
    /// Intelligent Driver Model (a desired speed, a safe following gap, smooth braking), obeys
    /// <see cref="TrafficSignals"/> at its stop line, yields to cars already turning at a junction and
    /// won't enter one if its chosen exit lane is occupied, and brakes for anything a forward
    /// sphere-cast finds ahead (another car, the player's car, a pedestrian, once those exist). A
    /// kinematic <see cref="Rigidbody"/> plus <see cref="BoxCollider"/> (built by
    /// <see cref="VehicleBody.Build"/>) lets the player's car push against it; a hard enough hit
    /// (relative speed &gt; 4 m/s) turns it into an ordinary dynamic rigidbody wreck and stops driving
    /// it, left for <see cref="TrafficManager"/> to despawn once it's out of view.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public sealed class TrafficCar : MonoBehaviour
    {
        const float MaxAccel = 2.2f;
        const float ComfortDecel = 3.5f;
        const float TimeHeadway = 1.4f;
        const float MinGap = 2.5f;
        const float MaxSpeedOvershoot = 1.15f;
        const float PerceptionLookaheadMin = 15f;
        const float PerceptionLookaheadMax = 45f;
        const float JunctionCheckRadius = 6f;
        const float TurnSpeedCap = 8.3f; // ~30 km/h through a junction

        Transform selfTransform;
        Rigidbody rb;
        Transform wheelFL, wheelFR, wheelRL, wheelRR;
        float wheelSpinDeg;

        TrafficLane lane;
        TrafficTurn turn;
        TrafficTurn plannedTurn;
        bool onTurn;
        int turnNode;

        Vector3[] pts;
        float[] cum;
        float pathLength;
        int cursor;
        float distAlong;

        float speed;
        float personalSpeedFactor = 1f;
        bool isWrecked;
        bool active;
        float stuckTimer;

        bool cachedHaveLeader;
        float cachedLeaderGap = 9999f;
        float cachedLeaderSpeed;

        public bool Active => active;
        public bool IsWrecked => isWrecked;
        /// <summary>True once the car has sat unable to move for a while (a dead lane with no legal
        /// continuation, or permanently gridlocked); the manager recycles it.</summary>
        public bool IsStuck => stuckTimer > 6f;
        public Vector3 Position => selfTransform != null ? selfTransform.position : Vector3.zero;
        public float Speed => speed;
        public TrafficLane CurrentLane => lane;
        public bool OnTurn => onTurn;
        public TrafficTurn CurrentTurn => turn;

        public void Init(VehicleBody.WheelSlot[] wheels)
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
        }

        /// <summary>(Re)starts this pooled car on `startLane` at arc-length `startDistAlong`.</summary>
        public void Spawn(TrafficLane startLane, float startDistAlong, float personalFactor)
        {
            lane = startLane;
            onTurn = false;
            turn = null;
            plannedTurn = PickTurn(lane);
            pts = lane.Points;
            cum = lane.Cumulative;
            pathLength = Mathf.Max(0.01f, lane.Length);
            cursor = 0;
            distAlong = Mathf.Clamp(startDistAlong, 0f, pathLength);
            personalSpeedFactor = personalFactor;
            speed = Mathf.Min(lane.SpeedLimit * personalFactor, 8f);
            isWrecked = false;
            active = true;
            stuckTimer = 0f;
            cachedHaveLeader = false;
            cachedLeaderGap = 9999f;
            wheelSpinDeg = 0f;

            TrafficPath.Sample(pts, cum, ref cursor, distAlong, out Vector3 pos, out Vector3 fwd);
            rb.position = pos;
            rb.rotation = SafeLookRotation(fwd);
            rb.linearVelocity = Vector3.zero;
            gameObject.SetActive(true);
        }

        public void Despawn()
        {
            if (onTurn && turn != null) JunctionOccupancy.Exit(turnNode, turn.From.Id);
            active = false;
            onTurn = false;
            turn = null;
            plannedTurn = null;
            if (rb != null)
            {
                rb.isKinematic = true;
                rb.linearVelocity = Vector3.zero;
            }
            isWrecked = false;
            gameObject.SetActive(false);
        }

        /// <summary>Drives one step. `doPerception` gates the sphere-cast (skipped on some ticks for
        /// far-away cars); the cached result from the last perception tick is reused in between.</summary>
        public void Tick(float dt, bool doPerception)
        {
            if (!active || isWrecked || dt <= 0f || !float.IsFinite(dt)) return;

            Vector3 forward = selfTransform.forward;
            float v0 = Mathf.Max(1f, CurrentSpeedLimit() * personalSpeedFactor);

            if (doPerception) PerceiveLeader(forward);

            float accel = IDMAccel(speed, v0, 9999f, speed);
            if (cachedHaveLeader) accel = Mathf.Min(accel, IDMAccel(speed, v0, cachedLeaderGap, cachedLeaderSpeed));

            float stopGap = StopLineGap();
            if (stopGap >= 0f) accel = Mathf.Min(accel, IDMAccel(speed, v0, stopGap, 0f));
            if (!float.IsFinite(accel)) accel = -ComfortDecel;

            speed = Mathf.Clamp(speed + accel * dt, 0f, v0 * MaxSpeedOvershoot);
            if (!float.IsFinite(speed)) speed = 0f;
            stuckTimer = speed < 0.05f ? stuckTimer + dt : 0f;

            Advance(dt);

            TrafficPath.Sample(pts, cum, ref cursor, distAlong, out Vector3 pos, out Vector3 fwd);
            rb.MovePosition(pos);
            rb.MoveRotation(SafeLookRotation(fwd));
            rb.linearVelocity = fwd * speed;

            UpdateWheels(dt);
        }

        void Advance(float dt)
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
                    JunctionOccupancy.Exit(turnNode, turn.From.Id);
                    TrafficLane nextLane = turn.To;
                    onTurn = false;
                    turn = null;
                    lane = nextLane;
                    plannedTurn = PickTurn(lane);
                    pts = lane.Points;
                    cum = lane.Cumulative;
                    pathLength = Mathf.Max(0.01f, lane.Length);
                    cursor = 0;
                    distAlong = Mathf.Clamp(overflow, 0f, pathLength);
                }
                else
                {
                    TrafficTurn next = plannedTurn;
                    if (next == null || !JunctionOccupancy.CanEnter(lane.ToNode, lane.Id) || !DestinationClear(next))
                    {
                        distAlong = pathLength;
                        speed = 0f;
                        break;
                    }
                    turnNode = lane.ToNode;
                    JunctionOccupancy.Enter(turnNode, lane.Id);
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

        /// <summary>Distance left to the stop line if this lane's end needs one honoured right now
        /// (a red/amber signal, a junction still occupied by another approach, or a blocked exit lane);
        /// -1 when there's nothing to stop for.</summary>
        float StopLineGap()
        {
            if (onTurn || !lane.ToNodeIsJunction) return -1f;
            float remaining = pathLength - distAlong;
            SignalState state = TrafficSignals.StateFor(lane.ToNode, lane.EdgeId);
            if (state == SignalState.Red || state == SignalState.Amber) return Mathf.Max(0f, remaining);

            if (plannedTurn != null && remaining < PerceptionLookaheadMin)
            {
                if (!JunctionOccupancy.CanEnter(lane.ToNode, lane.Id)) return Mathf.Max(0f, remaining);
                if (!DestinationClear(plannedTurn)) return Mathf.Max(0f, remaining);
            }
            return -1f;
        }

        bool DestinationClear(TrafficTurn t)
        {
            if (t == null || TrafficManager.Instance == null) return true;
            return !TrafficManager.Instance.AnyCarNear(t.To.Points[0], JunctionCheckRadius, this);
        }

        void PerceiveLeader(Vector3 forward)
        {
            cachedHaveLeader = false;
            cachedLeaderGap = 9999f;
            cachedLeaderSpeed = 0f;
            if (forward.sqrMagnitude < 1e-6f) return;

            float maxDist = Mathf.Clamp(speed * 2.5f + PerceptionLookaheadMin, PerceptionLookaheadMin, PerceptionLookaheadMax);
            Vector3 origin = selfTransform.position + Vector3.up * 0.5f + forward * (VehicleBody.Length * 0.5f + 0.3f);
            float radius = VehicleBody.Width * 0.45f;
            if (!Physics.SphereCast(origin, radius, forward, out RaycastHit hit, maxDist, ~0, QueryTriggerInteraction.Ignore)) return;
            if (hit.rigidbody == rb) return;

            cachedHaveLeader = true;
            cachedLeaderGap = Mathf.Max(0.1f, hit.distance);
            if (hit.rigidbody != null)
            {
                Vector3 v = hit.rigidbody.linearVelocity;
                if (float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z)) cachedLeaderSpeed = Vector3.Dot(v, forward);
            }
        }

        void UpdateWheels(float dt)
        {
            if (wheelRL == null || wheelRR == null) return;
            float wheelRadius = Mathf.Max(0.05f, VehicleBody.WheelRadius);
            float spinDelta = (speed / wheelRadius) * Mathf.Rad2Deg * dt;
            if (float.IsFinite(spinDelta)) wheelSpinDeg = Mathf.Repeat(wheelSpinDeg + spinDelta, 360f);
            Quaternion spin = Quaternion.Euler(wheelSpinDeg, 0f, 0f);

            float steerDeg = 0f;
            int lookCursor = cursor;
            float lookDist = Mathf.Min(pathLength, distAlong + 3f);
            TrafficPath.Sample(pts, cum, ref lookCursor, lookDist, out _, out Vector3 aheadFwd);
            if (aheadFwd.sqrMagnitude > 1e-6f)
            {
                float signed = Vector3.SignedAngle(selfTransform.forward, aheadFwd, Vector3.up);
                if (float.IsFinite(signed)) steerDeg = Mathf.Clamp(signed, -32f, 32f);
            }
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
            if (onTurn && turn != null)
            {
                JunctionOccupancy.Exit(turnNode, turn.From.Id);
                onTurn = false;
            }
            rb.isKinematic = false;
        }

        float CurrentSpeedLimit() => onTurn ? Mathf.Min(turn.From.SpeedLimit, turn.To.SpeedLimit, TurnSpeedCap) : lane.SpeedLimit;

        TrafficTurn PickTurn(TrafficLane fromLane)
        {
            List<TrafficTurn> options = fromLane.Turns;
            int count = options.Count;
            if (count == 0) return null;
            if (count == 1) return options[0];
            float total = 0f;
            for (int i = 0; i < count; i++) total += TurnWeight(options[i].Kind);
            float r = Random.value * total;
            for (int i = 0; i < count; i++)
            {
                r -= TurnWeight(options[i].Kind);
                if (r <= 0f) return options[i];
            }
            return options[count - 1];
        }

        static float TurnWeight(TurnKind kind) => kind switch
        {
            TurnKind.Straight => 4f,
            TurnKind.Right => 1.5f,
            TurnKind.Left => 1.2f,
            _ => 0.4f,
        };

        static float IDMAccel(float v, float v0, float gap, float leaderV)
        {
            v0 = Mathf.Max(1f, v0);
            gap = Mathf.Max(0.05f, gap);
            float dv = v - leaderV;
            float sStar = MinGap + Mathf.Max(0f, v * TimeHeadway + (v * dv) / (2f * Mathf.Sqrt(MaxAccel * ComfortDecel)));
            float ratio = v / v0;
            float a = MaxAccel * (1f - ratio * ratio * ratio * ratio - (sStar / gap) * (sStar / gap));
            return float.IsFinite(a) ? a : -ComfortDecel;
        }

        static Quaternion SafeLookRotation(Vector3 forward)
        {
            if (forward.sqrMagnitude < 1e-6f || !float.IsFinite(forward.x) || !float.IsFinite(forward.y) || !float.IsFinite(forward.z)) return Quaternion.identity;
            return Quaternion.LookRotation(forward, Vector3.up);
        }
    }
}
