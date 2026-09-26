using Solmar.People;
using UnityEngine;

namespace Solmar.Police
{
    /// <summary>
    /// One officer chasing the player on foot, dismounted by a <see cref="PoliceCar"/> that has
    /// closed on a player who isn't driving. Built from the same code-generated <see cref="HumanBody"/>
    /// every pedestrian uses, dressed in a dark navy uniform and cap; runs straight at
    /// <see cref="PoliceManager.PlayerPosition"/> at a jog faster than the player's run, no lane graph
    /// needed since it isn't crossing traffic. <see cref="PoliceManager"/> itself decides when a catch
    /// counts as BUSTED, so this component only needs to move and report where it is.
    /// </summary>
    [RequireComponent(typeof(CapsuleCollider))]
    [RequireComponent(typeof(Rigidbody))]
    public sealed class PoliceOfficer : MonoBehaviour
    {
        public LayerMask groundMask = ~0;
        const float RunSpeed = 5.6f;
        const float TurnRateDegPerSec = 260f;

        public HumanBody Body { get; private set; }
        public bool Active { get; private set; }
        public Vector3 Position => cachedTransform != null ? cachedTransform.position : Vector3.zero;

        Transform cachedTransform;
        Rigidbody rb;
        CapsuleCollider capsule;
        Vector3 lastVelocity;

        void Awake()
        {
            cachedTransform = transform;
            rb = GetComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.mass = 75f;
            rb.interpolation = RigidbodyInterpolation.Interpolate;
            rb.constraints = RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationZ;
            capsule = GetComponent<CapsuleCollider>();
        }

        /// <summary>Grows this officer's body and rig from `rng`. Expensive; called once per pooled instance.</summary>
        public void Build(Rng rng)
        {
            var bodyGo = new GameObject("Human");
            bodyGo.transform.SetParent(cachedTransform, false);
            Body = bodyGo.AddComponent<HumanBody>();
            Body.Initialize(OfficerLook(rng));
            Body.groundMask = groundMask;

            float height = Mathf.Clamp(Body.Look.heightMeters, 1.6f, 2f);
            capsule.radius = 0.26f;
            capsule.height = Mathf.Max(0.6f, height);
            capsule.center = new Vector3(0f, capsule.height * 0.5f, 0f);
        }

        static HumanLook OfficerLook(Rng rng)
        {
            HumanLook look = HumanLook.Random(rng);
            look.topStyle = TopStyle.Shirt;
            look.topColor = new Color(0.05f, 0.08f, 0.17f);
            look.bottomStyle = BottomStyle.Pants;
            look.bottomColor = new Color(0.04f, 0.05f, 0.11f);
            look.shoeStyle = ShoeStyle.Boots;
            look.shoeColor = new Color(0.03f, 0.03f, 0.03f);
            look.hasCap = true;
            look.capColor = new Color(0.04f, 0.05f, 0.11f);
            look.hasSunglasses = false;
            return look;
        }

        public void Spawn(Vector3 position, Vector3 lookDir)
        {
            lookDir.y = 0f;
            Quaternion rot = lookDir.sqrMagnitude > 1e-4f ? Quaternion.LookRotation(lookDir.normalized, Vector3.up) : cachedTransform.rotation;
            cachedTransform.SetPositionAndRotation(position, rot);
            rb.isKinematic = true;
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
            gameObject.SetActive(false);
        }

        public void Tick(float dt, PoliceManager manager)
        {
            if (!Active || dt <= 0f || !float.IsFinite(dt)) return;

            Vector3 target = manager.PlayerPosition;
            Vector3 toTarget = target - cachedTransform.position; toTarget.y = 0f;
            float dist = toTarget.magnitude;
            Vector3 dir = dist > 0.05f ? toTarget / dist : cachedTransform.forward;

            Vector3 pos = cachedTransform.position + dir * RunSpeed * dt;
            pos.y = PoliceUtil.GroundHeight(pos.x, pos.z, cachedTransform.position.y);
            Vector3 delta = pos - cachedTransform.position;
            lastVelocity = dt > 1e-5f ? delta / dt : Vector3.zero;

            cachedTransform.position = pos;
            cachedTransform.rotation = Quaternion.RotateTowards(cachedTransform.rotation, Quaternion.LookRotation(dir, Vector3.up), TurnRateDegPerSec * dt);
            rb.MovePosition(pos);
            rb.MoveRotation(cachedTransform.rotation);
            rb.linearVelocity = lastVelocity;

            if (Body != null) Body.Tick(lastVelocity, true, dt);
        }
    }
}
