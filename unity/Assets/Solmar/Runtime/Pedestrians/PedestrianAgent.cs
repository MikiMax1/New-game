using Solmar.People;
using Solmar.Traffic;
using UnityEngine;

namespace Solmar.Pedestrians
{
    public enum PedState { Walking, WaitingToCross, Idle, Fleeing, Fallen }
    enum IdleKind { None, Phone, Chat, BusStop }

    /// <summary>
    /// One pedestrian: a code-built <see cref="HumanBody"/> on a kinematic capsule, walking
    /// <see cref="PedestrianNetwork"/> link to link at 1.1-1.6 m/s with a personal lateral offset
    /// (so a crowd doesn't walk single-file), waiting at kerbs for a red signal or a gap in traffic,
    /// occasionally stopping to idle (phone, a chat with a nearby idler, or just waiting), fleeing a
    /// fast car or a crash close by, and falling ragdoll-ish when one actually hits it.
    ///
    /// Pooled by <see cref="PedestrianManager"/>: <see cref="Build"/> grows the body once (expensive,
    /// spread over several frames by the manager); <see cref="Spawn"/>/<see cref="Despawn"/> just
    /// reposition and (de)activate the same body for as long as the pedestrian is needed.
    /// </summary>
    [RequireComponent(typeof(CapsuleCollider))]
    [RequireComponent(typeof(Rigidbody))]
    public sealed class PedestrianAgent : MonoBehaviour
    {
        /// <summary>Ground raycast layer for foot placement; PedestrianManager excludes every pedestrian's own layer.</summary>
        public LayerMask groundMask = ~0;

        public HumanBody Body { get; private set; }
        public bool Active { get; private set; }
        public Vector3 Position => cachedTransform != null ? cachedTransform.position : Vector3.zero;

        Transform cachedTransform;
        Rigidbody rb;
        CapsuleCollider capsule;

        int linkIndex = -1;
        bool forward = true;
        float distanceAlong;
        int sampleCursor;
        float personalOffset;

        int pendingLinkIndex = -1;
        bool pendingForward;
        int pendingRoadEdgeId = -1;
        int pendingRoadNodeId = -1;

        PedState state = PedState.Walking;
        IdleKind idleKind;
        float stateTimer;
        float speed;
        float walkSpeedBase;
        Vector3 lastVelocity;
        Vector3 fleeDir;
        PedestrianAgent chatPartner;

        float threatCheckTimer;
        float crossCheckTimer;
        float idleCooldown;
        float animAccum;
        float fallenSettleTimer;

        static readonly Collider[] ThreatBuffer = new Collider[16];
        const float ThreatRadius = 4.5f;
        const float ThreatSpeed = 3f;
        const float SeparationRadius = 0.8f;
        const float PlayerSeparationRadius = 1.2f;

        void Awake()
        {
            cachedTransform = transform;
            rb = GetComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.mass = 68f;
            rb.interpolation = RigidbodyInterpolation.Interpolate;
            rb.constraints = RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationZ;
            capsule = GetComponent<CapsuleCollider>();
        }

        /// <summary>Grows this pedestrian's body and rig from `rng`. Expensive; called once per pooled instance.</summary>
        public void Build(Rng rng)
        {
            var bodyGo = new GameObject("Human");
            bodyGo.transform.SetParent(cachedTransform, false);
            Body = bodyGo.AddComponent<HumanBody>();
            Body.Initialize(HumanLook.Random(rng));
            Body.groundMask = groundMask;

            float height = Mathf.Clamp(Body.Look.heightMeters, 1.4f, 2.1f);
            capsule.radius = 0.24f;
            capsule.height = Mathf.Max(0.6f, height);
            capsule.center = new Vector3(0f, capsule.height * 0.5f, 0f);
        }

        /// <summary>(Re)starts this pooled pedestrian walking link `linkIdx` from one end. Places it immediately so it never pops from the origin.</summary>
        public void Spawn(int linkIdx, bool goForward, float startDistance)
        {
            PedestrianNetwork net = PedestrianNetwork.Current;
            if (net == null || linkIdx < 0 || linkIdx >= net.Links.Count) return;
            PedestrianNetwork.WalkLink link = net.Links[linkIdx];

            linkIndex = linkIdx;
            forward = goForward;
            distanceAlong = Mathf.Clamp(startDistance, 0f, link.Length);
            sampleCursor = 0;
            personalOffset = link.IsCrossing ? 0f : Random.Range(link.MinOffset, link.MaxOffset);

            state = PedState.Walking;
            idleKind = IdleKind.None;
            chatPartner = null;
            speed = Random.Range(1.1f, 1.6f);
            walkSpeedBase = speed;
            idleCooldown = Random.Range(6f, 16f);
            threatCheckTimer = Random.Range(0f, 0.2f);
            crossCheckTimer = Random.Range(0f, 0.3f);
            animAccum = 0f;
            fallenSettleTimer = 0f;

            Vector3 pos = SamplePosition(link, out Vector3 dir);
            cachedTransform.position = pos;
            if (dir.sqrMagnitude > 1e-6f) cachedTransform.rotation = Quaternion.LookRotation(dir, Vector3.up);
            rb.isKinematic = true;
            rb.constraints = RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationZ;
            rb.linearVelocity = Vector3.zero;
            rb.angularVelocity = Vector3.zero;
            rb.position = cachedTransform.position;
            rb.rotation = cachedTransform.rotation;
            lastVelocity = Vector3.zero;

            Active = true;
            gameObject.SetActive(true);
        }

        public void Despawn()
        {
            Active = false;
            if (chatPartner != null) { chatPartner.chatPartner = null; chatPartner = null; }
            gameObject.SetActive(false);
        }

        // ---------------------------------------------------------------------------- physics ----

        public void TickPhysics(float dt)
        {
            if (!Active || dt <= 0f || !float.IsFinite(dt)) return;

            if (state == PedState.Fallen) { TickFallen(dt); return; }

            threatCheckTimer -= dt;
            if (threatCheckTimer <= 0f)
            {
                threatCheckTimer = 0.2f + Random.Range(0f, 0.05f);
                CheckThreats();
            }

            switch (state)
            {
                case PedState.Fleeing: TickFleeing(dt); break;
                case PedState.Idle: TickIdle(dt); break;
                case PedState.WaitingToCross: TickWaiting(dt); break;
                default: TickWalking(dt); break;
            }
        }

        void TickWalking(float dt)
        {
            PedestrianNetwork net = PedestrianNetwork.Current;
            if (net == null || linkIndex < 0 || linkIndex >= net.Links.Count) return;
            PedestrianNetwork.WalkLink link = net.Links[linkIndex];

            idleCooldown -= dt;
            if (idleCooldown <= 0f && !link.IsCrossing)
            {
                StartIdle();
                return;
            }

            distanceAlong += speed * dt;
            bool arrived = distanceAlong >= link.Length - 0.001f;
            if (arrived) distanceAlong = link.Length;

            Vector3 pos = SamplePosition(link, out Vector3 dir);
            Vector3 avoid = ComputeAvoidance(pos);
            if (avoid.sqrMagnitude > 4f) avoid = avoid.normalized * 2f;
            pos += avoid * dt;

            ApplyMotion(pos, dir, dt);

            if (arrived)
            {
                int endNode = forward ? link.NodeB : link.NodeA;
                AdvanceFromNode(net, endNode);
            }
        }

        void AdvanceFromNode(PedestrianNetwork net, int node)
        {
            if (node < 0 || node >= net.NodeLinks.Count) return;
            System.Collections.Generic.List<int> options = net.NodeLinks[node];
            if (options.Count == 0)
            {
                // Nothing else here: turn back the way we came.
                forward = !forward;
                distanceAlong = 0f;
                sampleCursor = 0;
                return;
            }

            int chosen = options[Random.Range(0, options.Count)];
            if (options.Count > 1 && chosen == linkIndex) chosen = options[Random.Range(0, options.Count)];
            PedestrianNetwork.WalkLink next = net.Links[chosen];
            bool goForward = next.NodeA == node;

            if (next.IsCrossing)
            {
                pendingLinkIndex = chosen;
                pendingForward = goForward;
                pendingRoadEdgeId = next.RoadEdgeId;
                pendingRoadNodeId = next.RoadNodeId;
                state = PedState.WaitingToCross;
                crossCheckTimer = 0f;
                return;
            }

            linkIndex = chosen;
            forward = goForward;
            distanceAlong = 0f;
            sampleCursor = 0;
            personalOffset = Random.Range(next.MinOffset, next.MaxOffset);
        }

        void TickWaiting(float dt)
        {
            lastVelocity = Vector3.zero;
            PedestrianNetwork net = PedestrianNetwork.Current;
            if (net == null || pendingLinkIndex < 0 || pendingLinkIndex >= net.Links.Count) { state = PedState.Walking; return; }
            PedestrianNetwork.WalkLink pending = net.Links[pendingLinkIndex];

            Vector3 target = pendingForward ? net.Nodes[pending.NodeB] : net.Nodes[pending.NodeA];
            Vector3 toTarget = target - cachedTransform.position;
            toTarget.y = 0f;
            if (toTarget.sqrMagnitude > 1e-4f)
                cachedTransform.rotation = Quaternion.RotateTowards(cachedTransform.rotation, Quaternion.LookRotation(toTarget.normalized, Vector3.up), 180f * dt);
            rb.rotation = cachedTransform.rotation;

            crossCheckTimer -= dt;
            if (crossCheckTimer > 0f) return;
            crossCheckTimer = 0.25f;

            bool clear;
            if (pendingRoadNodeId >= 0)
            {
                SignalState sig = TrafficSignals.StateFor(pendingRoadNodeId, pendingRoadEdgeId);
                clear = sig == SignalState.Uncontrolled ? GapClear(pending) : sig == SignalState.Red;
            }
            else
            {
                clear = GapClear(pending);
            }
            if (!clear) return;

            linkIndex = pendingLinkIndex;
            forward = pendingForward;
            distanceAlong = 0f;
            sampleCursor = 0;
            speed = Mathf.Max(walkSpeedBase, 1.35f);
            pendingLinkIndex = -1;
            state = PedState.Walking;
        }

        static bool GapClear(PedestrianNetwork.WalkLink pending)
        {
            TrafficManager tm = TrafficManager.Instance;
            if (tm == null) return true;
            Vector3 mid = Vector3.Lerp(pending.Points[0], pending.Points[pending.Points.Length - 1], 0.5f);
            if (tm.AnyCarNear(mid, 7f, null)) return false;
            if (tm.AnyCarNear(pending.Points[0], 5f, null)) return false;
            if (tm.AnyCarNear(pending.Points[pending.Points.Length - 1], 5f, null)) return false;
            return true;
        }

        // -------------------------------------------------------------------------------- idle ----

        void StartIdle()
        {
            PedestrianAgent partner = PedestrianManager.Instance != null ? PedestrianManager.Instance.FindIdlePartner(this, 2.5f) : null;
            float dur;
            if (partner != null)
            {
                chatPartner = partner;
                partner.chatPartner = this;
                idleKind = IdleKind.Chat;
                partner.idleKind = IdleKind.Chat;
                dur = Random.Range(5f, 11f);
                partner.state = PedState.Idle;
                partner.stateTimer = dur;
                partner.lastVelocity = Vector3.zero;
            }
            else
            {
                idleKind = Random.value < 0.55f ? IdleKind.Phone : IdleKind.BusStop;
                dur = Random.Range(4f, 9f);
            }
            state = PedState.Idle;
            stateTimer = dur;
            lastVelocity = Vector3.zero;
        }

        void TickIdle(float dt)
        {
            lastVelocity = Vector3.zero;
            if (chatPartner != null)
            {
                Vector3 to = chatPartner.cachedTransform.position - cachedTransform.position;
                to.y = 0f;
                if (to.sqrMagnitude > 0.01f)
                    cachedTransform.rotation = Quaternion.RotateTowards(cachedTransform.rotation, Quaternion.LookRotation(to.normalized, Vector3.up), 120f * dt);
                rb.rotation = cachedTransform.rotation;
            }

            stateTimer -= dt;
            if (stateTimer <= 0f) EndIdle();
        }

        void EndIdle()
        {
            if (chatPartner != null)
            {
                PedestrianAgent partner = chatPartner;
                chatPartner = null;
                if (partner.chatPartner == this) partner.chatPartner = null;
            }
            idleKind = IdleKind.None;
            state = PedState.Walking;
            idleCooldown = Random.Range(10f, 24f);
        }

        // ------------------------------------------------------------------------------- flee ----

        void CheckThreats()
        {
            if (state == PedState.Fallen) return;
            Vector3 pos = cachedTransform.position;
            int mask = PedestrianManager.NonPedestrianMask;
            int count = Physics.OverlapSphereNonAlloc(pos, ThreatRadius, ThreatBuffer, mask, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < count; i++)
            {
                Collider c = ThreatBuffer[i];
                if (c == null || c == capsule) continue;
                Rigidbody crb = c.attachedRigidbody;
                if (crb == null) continue;
                Vector3 v = crb.linearVelocity;
                if (!float.IsFinite(v.x) || !float.IsFinite(v.y) || !float.IsFinite(v.z)) continue;
                float horizSqr = v.x * v.x + v.z * v.z;
                if (horizSqr > ThreatSpeed * ThreatSpeed)
                {
                    StartFlee(crb.position);
                    return;
                }
            }
        }

        void StartFlee(Vector3 threatPos)
        {
            if (state == PedState.Fleeing) return;
            Vector3 away = cachedTransform.position - threatPos;
            away.y = 0f;
            fleeDir = away.sqrMagnitude > 0.01f ? away.normalized : cachedTransform.forward;
            if (chatPartner != null) { chatPartner.chatPartner = null; chatPartner = null; }
            state = PedState.Fleeing;
            stateTimer = Random.Range(2.5f, 4.5f);
            speed = Random.Range(4f, 5f);
        }

        void TickFleeing(float dt)
        {
            stateTimer -= dt;
            Vector3 pos = cachedTransform.position + fleeDir * speed * dt;
            pos.y = SampleGroundHeight(pos, cachedTransform.position.y);
            ApplyMotion(pos, fleeDir, dt, 720f);

            if (stateTimer <= 0f) ResumeAfterFlee(pos);
        }

        void ResumeAfterFlee(Vector3 pos)
        {
            PedestrianNetwork net = PedestrianNetwork.Current;
            speed = walkSpeedBase;
            idleCooldown = Random.Range(8f, 20f);
            state = PedState.Walking;
            if (net == null) return;
            int node = net.NearestNode(pos);
            if (node < 0 || node >= net.NodeLinks.Count || net.NodeLinks[node].Count == 0) return;
            int chosen = net.NodeLinks[node][0];
            PedestrianNetwork.WalkLink link = net.Links[chosen];
            linkIndex = chosen;
            forward = link.NodeA == node;
            distanceAlong = 0f;
            sampleCursor = 0;
            personalOffset = link.IsCrossing ? 0f : Random.Range(link.MinOffset, link.MaxOffset);
        }

        float SampleGroundHeight(Vector3 pos, float fallbackY)
        {
            var origin = new Vector3(pos.x, fallbackY + 2f, pos.z);
            if (Physics.Raycast(origin, Vector3.down, out RaycastHit hit, 6f, groundMask, QueryTriggerInteraction.Ignore) && float.IsFinite(hit.point.y))
                return hit.point.y;
            return fallbackY;
        }

        // ----------------------------------------------------------------------------- ragdoll ----

        void OnCollisionEnter(Collision collision)
        {
            if (!Active || state == PedState.Fallen) return;
            float rel = collision.relativeVelocity.magnitude;
            if (!float.IsFinite(rel) || rel <= 3.5f) return;

            Vector3 point = collision.contactCount > 0 ? collision.GetContact(0).point : cachedTransform.position;
            Vector3 dir = cachedTransform.position - point;
            dir.y = 0.25f;
            if (dir.sqrMagnitude < 0.01f) dir = cachedTransform.forward + Vector3.up * 0.25f;
            Fall(dir.normalized * Mathf.Clamp(rel, 2f, 9f));
        }

        void Fall(Vector3 impulse)
        {
            state = PedState.Fallen;
            stateTimer = Random.Range(6f, 10f);
            if (chatPartner != null) { chatPartner.chatPartner = null; chatPartner = null; }
            lastVelocity = Vector3.zero;

            rb.constraints = RigidbodyConstraints.None;
            rb.isKinematic = false;
            rb.AddForce(impulse, ForceMode.VelocityChange);
            Vector3 axis = Vector3.Cross(Vector3.up, impulse.sqrMagnitude > 1e-4f ? impulse.normalized : Vector3.forward);
            rb.AddTorque(axis * 5f, ForceMode.VelocityChange);
            fallenSettleTimer = 1.5f;
        }

        void TickFallen(float dt)
        {
            lastVelocity = Vector3.zero;
            stateTimer -= dt;
            if (!rb.isKinematic)
            {
                fallenSettleTimer -= dt;
                if (fallenSettleTimer <= 0f && rb.linearVelocity.sqrMagnitude < 0.05f && rb.angularVelocity.sqrMagnitude < 0.05f)
                    rb.isKinematic = true;
            }
            if (stateTimer <= 0f) Despawn();
        }

        // --------------------------------------------------------------------------- animation ----

        public void AccumulateDt(float dt) { animAccum += dt; }

        public void FlushAnimation()
        {
            if (!Active || Body == null || state == PedState.Fallen) { animAccum = 0f; return; }
            float dt = animAccum;
            animAccum = 0f;
            if (dt <= 0f || !float.IsFinite(dt)) return;

            Body.groundMask = groundMask;
            Vector3 v = lastVelocity;
            if (!float.IsFinite(v.x) || !float.IsFinite(v.y) || !float.IsFinite(v.z)) v = Vector3.zero;
            Body.Tick(v, true, dt);
            ApplyIdlePose();
        }

        void ApplyIdlePose()
        {
            if (state != PedState.Idle || Body == null || Body.Bones == null) return;
            HumanBones bones = Body.Bones;
            switch (idleKind)
            {
                case IdleKind.Phone:
                    if (bones.rightShoulder != null) bones.rightShoulder.localRotation *= Quaternion.Euler(-70f, 10f, 15f);
                    if (bones.rightElbow != null) bones.rightElbow.localRotation *= Quaternion.Euler(95f, 0f, 0f);
                    if (bones.head != null) bones.head.localRotation *= Quaternion.Euler(22f, 0f, 0f);
                    break;
                case IdleKind.Chat:
                    if (chatPartner != null && bones.head != null)
                    {
                        Vector3 to = chatPartner.cachedTransform.position - cachedTransform.position;
                        to.y = 0f;
                        if (to.sqrMagnitude > 0.01f)
                        {
                            float yaw = Vector3.SignedAngle(cachedTransform.forward, to.normalized, Vector3.up);
                            bones.head.localRotation *= Quaternion.Euler(0f, Mathf.Clamp(yaw, -70f, 70f), 0f);
                        }
                    }
                    break;
                case IdleKind.BusStop:
                    if (bones.spine != null) bones.spine.localRotation *= Quaternion.Euler(-4f, 0f, 0f);
                    break;
            }
        }

        // -------------------------------------------------------------------------- utilities ----

        Vector3 SamplePosition(PedestrianNetwork.WalkLink link, out Vector3 dir)
        {
            float d = forward ? distanceAlong : link.Length - distanceAlong;
            TrafficPath.Sample(link.Points, link.Cumulative, ref sampleCursor, d, out Vector3 pos, out dir);
            if (!link.IsCrossing && link.RightDir.sqrMagnitude > 1e-4f)
                pos += link.RightDir.normalized * (personalOffset - link.BakedOffset);
            if (!forward) dir = -dir;
            return pos;
        }

        void ApplyMotion(Vector3 pos, Vector3 dir, float dt, float turnRateDeg = 480f)
        {
            Vector3 delta = pos - cachedTransform.position;
            lastVelocity = dt > 1e-5f ? delta / dt : Vector3.zero;
            if (lastVelocity.sqrMagnitude > 100f) lastVelocity = dir.sqrMagnitude > 1e-4f ? dir.normalized * speed : Vector3.zero;

            cachedTransform.position = pos;
            if (dir.sqrMagnitude > 1e-6f)
                cachedTransform.rotation = Quaternion.RotateTowards(cachedTransform.rotation, Quaternion.LookRotation(dir.normalized, Vector3.up), turnRateDeg * dt);

            rb.MovePosition(pos);
            rb.MoveRotation(cachedTransform.rotation);
            rb.linearVelocity = lastVelocity;
        }

        Vector3 ComputeAvoidance(Vector3 pos)
        {
            Vector3 push = Vector3.zero;
            PedestrianAgent[] pool = PedestrianManager.Instance != null ? PedestrianManager.Instance.Pool : null;
            if (pool != null)
            {
                for (int i = 0; i < pool.Length; i++)
                {
                    PedestrianAgent other = pool[i];
                    if (other == null || other == this || !other.Active || other.state == PedState.Fallen) continue;
                    Vector3 d = pos - other.cachedTransform.position;
                    d.y = 0f;
                    float distSqr = d.sqrMagnitude;
                    if (distSqr < SeparationRadius * SeparationRadius && distSqr > 1e-5f)
                    {
                        float dist = Mathf.Sqrt(distSqr);
                        push += d / dist * (SeparationRadius - dist) * 2.2f;
                    }
                }
            }

            if (PedestrianManager.Instance != null && PedestrianManager.Instance.TryGetPlayerPosition(out Vector3 playerPos))
            {
                Vector3 d = pos - playerPos;
                d.y = 0f;
                float distSqr = d.sqrMagnitude;
                if (distSqr < PlayerSeparationRadius * PlayerSeparationRadius && distSqr > 1e-5f)
                {
                    float dist = Mathf.Sqrt(distSqr);
                    push += d / dist * (PlayerSeparationRadius - dist) * 2.5f;
                }
            }
            return push;
        }

        // ------------------------------------------------------------------- manager access ----

        public PedState CurrentState => state;
        public bool HasChatPartner => chatPartner != null;
    }
}
