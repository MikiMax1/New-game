using UnityEngine;

namespace Solmar
{
    /// <summary>
    /// Third-person walking on a CharacterController: WASD moves camera-relative, Shift runs, Space
    /// jumps, gravity and a step offset climb 15 cm kerbs. The body (this transform) turns smoothly
    /// to face the direction it is moving in, independent of where the orbit camera is looking.
    /// <see cref="PlayerBody"/> reads <see cref="Speed"/>, <see cref="NormalizedSpeed"/> and
    /// <see cref="Grounded"/> to drive its procedural walk cycle, and <see cref="OrbitCamera"/> or
    /// <see cref="PlayerSpawner"/> assign <see cref="cameraTransform"/> so movement is relative to
    /// the camera's facing.
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    public sealed class PlayerCharacter : MonoBehaviour
    {
        public float walkSpeed = 1.4f;
        public float runSpeed = 4.5f;
        public float acceleration = 9f;
        public float deceleration = 12f;
        public float turnSmoothTime = 0.12f;
        public float jumpHeight = 1.2f;
        public float gravity = -20f;
        public float stepOffset = 0.15f;
        public float slopeLimit = 50f;
        public float controllerHeight = 1.75f;
        public float controllerRadius = 0.28f;

        /// <summary>The camera movement is relative to; falls back to Camera.main.</summary>
        public Transform cameraTransform;

        CharacterController controller;
        float currentSpeed;
        float verticalVelocity;
        float yawVelocity;
        Vector3 lastMoveDirection = Vector3.forward;

        /// <summary>Current horizontal speed in m/s (smoothed towards the input's target speed).</summary>
        public float Speed => currentSpeed;
        /// <summary>Current horizontal speed, 0..1 relative to <see cref="runSpeed"/>.</summary>
        public float NormalizedSpeed => runSpeed > 0.0001f ? Mathf.Clamp01(currentSpeed / runSpeed) : 0f;
        public bool Grounded { get; private set; }
        public bool Running { get; private set; }
        public float VerticalVelocity => verticalVelocity;
        /// <summary>The last non-zero horizontal direction the character moved in, world space.</summary>
        public Vector3 FacingDirection => lastMoveDirection;

        void Awake()
        {
            controller = GetComponent<CharacterController>();
            controller.height = controllerHeight;
            controller.radius = controllerRadius;
            controller.center = new Vector3(0f, controllerHeight * 0.5f, 0f);
            controller.stepOffset = stepOffset;
            controller.slopeLimit = slopeLimit;
        }

#if ENABLE_LEGACY_INPUT_MANAGER
        void Update()
        {
            float dt = Time.deltaTime;
            float forward = (Input.GetKey(KeyCode.W) ? 1f : 0f) - (Input.GetKey(KeyCode.S) ? 1f : 0f);
            float strafe = (Input.GetKey(KeyCode.D) ? 1f : 0f) - (Input.GetKey(KeyCode.A) ? 1f : 0f);
            var input = new Vector2(strafe, forward);
            if (input.sqrMagnitude > 1f) input.Normalize();

            Running = Input.GetKey(KeyCode.LeftShift);
            float targetSpeed = input.magnitude * (Running ? runSpeed : walkSpeed);

            Transform cam = cameraTransform != null ? cameraTransform : (Camera.main != null ? Camera.main.transform : transform);
            Vector3 camForward = cam.forward;
            camForward.y = 0f;
            camForward = camForward.sqrMagnitude > 1e-6f ? camForward.normalized : transform.forward;
            Vector3 camRight = cam.right;
            camRight.y = 0f;
            camRight = camRight.sqrMagnitude > 1e-6f ? camRight.normalized : transform.right;

            Vector3 wishDir = camForward * input.y + camRight * input.x;
            float wishMagnitude = wishDir.magnitude;
            if (wishMagnitude > 1e-4f)
            {
                lastMoveDirection = wishDir / wishMagnitude;
                float targetYaw = Mathf.Atan2(lastMoveDirection.x, lastMoveDirection.z) * Mathf.Rad2Deg;
                float newYaw = Mathf.SmoothDampAngle(transform.eulerAngles.y, targetYaw, ref yawVelocity, turnSmoothTime);
                transform.rotation = Quaternion.Euler(0f, newYaw, 0f);
            }

            // An acceleration curve towards the target speed: quicker to speed up than to stop, so
            // sprinting feels punchy but coming to a halt isn't a snap.
            float accel = targetSpeed > currentSpeed ? acceleration : deceleration;
            currentSpeed = Mathf.MoveTowards(currentSpeed, targetSpeed, accel * dt);

            Grounded = controller.isGrounded;
            if (Grounded && verticalVelocity < 0f) verticalVelocity = -2f;
            if (Grounded && Input.GetKeyDown(KeyCode.Space))
            {
                verticalVelocity = Mathf.Sqrt(Mathf.Max(0f, -2f * gravity * jumpHeight));
            }
            verticalVelocity += gravity * dt;

            // Once there is no input, currentSpeed decelerates to 0, so horizontal fades out in the
            // last direction faced rather than snapping to zero.
            Vector3 horizontal = lastMoveDirection * currentSpeed;
            controller.Move(new Vector3(horizontal.x, verticalVelocity, horizontal.z) * dt);
        }
#endif
    }
}
