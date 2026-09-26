using UnityEngine;

namespace Solmar
{
    /// <summary>
    /// A third-person camera that orbits <see cref="target"/> from just behind and to one side of
    /// its shoulder: the mouse orbits it (click to lock the cursor, Esc to free it, matching
    /// <see cref="PlayerWalker"/>'s convention), the scroll wheel zooms, and it sphere-casts against
    /// the city so it never clips into a wall, snapping in quickly but easing back out. Its own
    /// position is smoothed so it trails the target gently rather than sticking rigidly to it.
    /// </summary>
    public sealed class OrbitCamera : MonoBehaviour
    {
        public Transform target;
        /// <summary>The pivot the camera looks at, above the target's feet (about chest/head height).</summary>
        public Vector3 targetOffset = new Vector3(0f, 1.55f, 0f);
        /// <summary>Sideways shift of the pivot so the shot sits over one shoulder rather than dead centre.</summary>
        public float shoulderOffset = 0.45f;

        public float distance = 4.2f;
        public float minDistance = 1.0f;
        public float maxDistance = 8f;
        public float mouseSensitivity = 2.2f;
        public float zoomSensitivity = 1.4f;
        public float minPitch = -35f;
        public float maxPitch = 75f;

        public float collisionRadius = 0.22f;
        /// <summary>Everything the camera should collide with; PlayerSpawner excludes the player's own layer.</summary>
        public LayerMask collisionMask = ~0;

        public float pivotSmoothTime = 0.06f;
        /// <summary>How fast the camera eases back out once an obstruction is gone (m/s).</summary>
        public float distanceRecoverSpeed = 6f;

        float yaw;
        float pitch;
        float currentDistance;
        Vector3 smoothedPivot;
        Vector3 pivotVelocity;
        bool initialised;

        void OnEnable()
        {
            Vector3 e = transform.eulerAngles;
            yaw = e.y;
            pitch = e.x > 180f ? e.x - 360f : e.x;
            currentDistance = distance;
            initialised = false;
        }

#if ENABLE_LEGACY_INPUT_MANAGER
        void HandleInput()
        {
            if (Input.GetMouseButtonDown(0) && Cursor.lockState != CursorLockMode.Locked)
            {
                Cursor.lockState = CursorLockMode.Locked;
                Cursor.visible = false;
            }
            if (Input.GetKeyDown(KeyCode.Escape))
            {
                Cursor.lockState = CursorLockMode.None;
                Cursor.visible = true;
            }
            if (Cursor.lockState == CursorLockMode.Locked)
            {
                yaw += Input.GetAxis("Mouse X") * mouseSensitivity;
                pitch = Mathf.Clamp(pitch - Input.GetAxis("Mouse Y") * mouseSensitivity, minPitch, maxPitch);
            }
            float scroll = Input.GetAxis("Mouse ScrollWheel");
            if (Mathf.Abs(scroll) > 0.0001f)
            {
                distance = Mathf.Clamp(distance - scroll * zoomSensitivity * 10f, minDistance, maxDistance);
            }
        }
#endif

        void LateUpdate()
        {
#if ENABLE_LEGACY_INPUT_MANAGER
            HandleInput();
#endif
            if (target == null) return;

            Vector3 pivot = target.position + targetOffset + target.right * shoulderOffset;
            if (!initialised)
            {
                smoothedPivot = pivot;
                initialised = true;
            }
            else
            {
                smoothedPivot = Vector3.SmoothDamp(smoothedPivot, pivot, ref pivotVelocity, pivotSmoothTime);
            }

            Quaternion rotation = Quaternion.Euler(pitch, yaw, 0f);
            Vector3 backDirection = rotation * Vector3.back;
            if (backDirection.sqrMagnitude < 1e-8f) backDirection = Vector3.back;

            float desiredDistance = distance;
            if (Physics.SphereCast(smoothedPivot, collisionRadius, backDirection, out RaycastHit hit, distance, collisionMask, QueryTriggerInteraction.Ignore))
            {
                desiredDistance = Mathf.Max(minDistance * 0.25f, hit.distance);
            }
            // Snap straight in against an obstruction (no clipping through walls), but ease back out
            // once it clears so the zoom doesn't pop.
            currentDistance = desiredDistance < currentDistance
                ? desiredDistance
                : Mathf.MoveTowards(currentDistance, desiredDistance, distanceRecoverSpeed * Time.deltaTime);

            Vector3 cameraPosition = smoothedPivot + backDirection * currentDistance;
            Vector3 look = smoothedPivot - cameraPosition;
            transform.SetPositionAndRotation(cameraPosition, look.sqrMagnitude > 1e-6f ? Quaternion.LookRotation(look.normalized, Vector3.up) : rotation);
        }
    }
}
