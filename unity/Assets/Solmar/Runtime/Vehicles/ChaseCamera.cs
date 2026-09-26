using UnityEngine;

namespace Solmar.Vehicles
{
    /// <summary>
    /// A camera for driving: a smooth chase view (distance and height grow with speed, looks ahead
    /// into turns, pulls in when something is behind the car) and a bonnet view. V cycles between
    /// them. Attaches to whatever GameObject already carries the scene's <see cref="Camera"/> (the
    /// same one <see cref="Solmar.FreeCamera"/> and <see cref="Solmar.PlayerWalker"/> use), so
    /// <see cref="Solmar.Vehicles.VehicleSpawner"/> can enable it in place of them while driving.
    /// </summary>
    public sealed class ChaseCamera : MonoBehaviour
    {
        public enum Mode { Chase, Bonnet }

        public Transform target;
        public VehicleController vehicle;
        public Mode mode = Mode.Chase;

        [Header("Chase")]
        public float baseDistance = 6.5f;
        public float baseHeight = 2.3f;
        public float distancePerKmh = 0.02f;
        public float heightPerKmh = 0.008f;
        public float maxExtraDistance = 5f;
        public float maxExtraHeight = 2f;
        public float positionSmoothTime = 0.18f;
        public float rotationSharpness = 8f;
        public float lookAheadDistance = 5f;
        public float lookAheadBySteer = 2.5f;
        public LayerMask collisionMask = ~0;
        public float collisionSkin = 0.35f;

        [Header("Bonnet")]
        public Vector3 bonnetLocalOffset = new Vector3(0f, 1.15f, 1.9f);

        Vector3 velocityRef;

        void LateUpdate()
        {
            if (target == null) return;
#if ENABLE_LEGACY_INPUT_MANAGER
            if (Input.GetKeyDown(KeyCode.V)) mode = mode == Mode.Chase ? Mode.Bonnet : Mode.Chase;
#endif
            if (mode == Mode.Bonnet) UpdateBonnet();
            else UpdateChase();
        }

        void UpdateBonnet()
        {
            Vector3 worldPos = target.TransformPoint(bonnetLocalOffset);
            if (!IsFinite(worldPos)) return;
            transform.SetPositionAndRotation(worldPos, target.rotation);
        }

        void UpdateChase()
        {
            float speedKmh = vehicle != null ? Mathf.Abs(vehicle.SpeedKmh) : 0f;
            if (!float.IsFinite(speedKmh)) speedKmh = 0f;

            float distance = baseDistance + Mathf.Min(maxExtraDistance, speedKmh * distancePerKmh);
            float height = baseHeight + Mathf.Min(maxExtraHeight, speedKmh * heightPerKmh);

            Vector3 desired = target.position - target.forward * distance + Vector3.up * height;

            Vector3 rayOrigin = target.position + Vector3.up * (height * 0.5f + 0.3f);
            Vector3 toDesired = desired - rayOrigin;
            float dist = toDesired.magnitude;
            if (dist > 0.05f && Physics.Raycast(rayOrigin, toDesired / dist, out RaycastHit hit, dist, collisionMask, QueryTriggerInteraction.Ignore))
            {
                desired = hit.point - toDesired / dist * collisionSkin;
            }

            if (!IsFinite(desired)) return;
            transform.position = Vector3.SmoothDamp(transform.position, desired, ref velocityRef, positionSmoothTime);

            // Look a little ahead of the car, biased sideways by the steering so the camera leads
            // into a turn instead of just staring at the boot.
            Vector3 lateral = vehicle != null ? target.InverseTransformDirection(vehicle.Velocity) : Vector3.zero;
            float sidewaysBias = float.IsFinite(lateral.x) ? Mathf.Clamp(lateral.x, -8f, 8f) : 0f;
            Vector3 lookTarget = target.position + target.forward * lookAheadDistance + target.right * sidewaysBias * (lookAheadBySteer / 8f) + Vector3.up * 1.1f;
            Vector3 lookDir = lookTarget - transform.position;
            if (lookDir.sqrMagnitude > 1e-4f)
            {
                Quaternion wanted = Quaternion.LookRotation(lookDir.normalized, Vector3.up);
                transform.rotation = Quaternion.Slerp(transform.rotation, wanted, 1f - Mathf.Exp(-rotationSharpness * Time.deltaTime));
            }
        }

        static bool IsFinite(Vector3 v) => float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z);
    }
}
