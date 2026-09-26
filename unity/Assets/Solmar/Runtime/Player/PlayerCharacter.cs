using Solmar.UI;
using UnityEngine;

namespace Solmar
{
    /// <summary>
    /// Third-person walking on a CharacterController: WASD moves camera-relative at a jog by
    /// default, Left Alt held walks slowly, Left Ctrl toggles a crouch, Shift sprints (draining
    /// stamina in <see cref="PlayerStats"/>), Space jumps or, near a low obstacle, vaults/climbs it
    /// (see <see cref="PlayerVaulting"/>), gravity and a step offset climb 15 cm kerbs. The body (this
    /// transform) turns smoothly to face the direction it is moving in, independent of where the
    /// orbit camera is looking.
    ///
    /// Also the shared hub the rest of the on-foot player leans on: <see cref="SuspendControl"/> and
    /// <see cref="ExternalMove"/>/<see cref="SetVerticalVelocity"/>/<see cref="Teleport"/> let
    /// <see cref="PlayerVaulting"/>, <see cref="PlayerSwimming"/> and <see cref="PlayerHealthState"/>
    /// take the CharacterController over for a vault, a swim stroke, a knockdown tumble or a respawn,
    /// without fighting this class's own <c>Update</c>. <see cref="PlayerBody"/> reads
    /// <see cref="Velocity"/> and <see cref="Grounded"/> (by way of its own <c>HumanBody</c>) to drive
    /// its procedural walk cycle, and <see cref="OrbitCamera"/> or <see cref="PlayerSpawner"/> assign
    /// <see cref="cameraTransform"/> so movement is relative to the camera's facing. Those four
    /// companion components are added automatically (see the <c>RequireComponent</c>s below) the
    /// moment <c>PlayerSpawner</c> adds this one, so nothing else needs to know they exist.
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    [RequireComponent(typeof(PlayerVaulting))]
    [RequireComponent(typeof(PlayerCombat))]
    [RequireComponent(typeof(PlayerHealthState))]
    [RequireComponent(typeof(PlayerSwimming))]
    public sealed class PlayerCharacter : MonoBehaviour
    {
        /// <summary>Held with Left/Right Alt: a slow, deliberate walk.</summary>
        public float walkSpeed = 1.5f;
        /// <summary>The default pace with no modifier held.</summary>
        public float jogSpeed = 3.5f;
        /// <summary>Held with Shift (while stamina remains): a full sprint.</summary>
        public float runSpeed = 6f;
        /// <summary>Speed while crouched (Left Ctrl toggles it), whatever else is held.</summary>
        public float crouchSpeed = 1.2f;
        public float acceleration = 11f;
        public float deceleration = 15f;
        public float turnSmoothTime = 0.12f;
        public float jumpHeight = 1.2f;
        public float gravity = -20f;
        public float stepOffset = 0.15f;
        public float slopeLimit = 50f;
        public float controllerHeight = 1.75f;
        public float controllerRadius = 0.28f;
        /// <summary>The controller's crouched height, as a fraction of <see cref="controllerHeight"/>.</summary>
        public float crouchHeightMultiplier = 0.62f;
        /// <summary>How fast the crouch height/pose blends in and out (per second, 0..1 range).</summary>
        public float crouchBlendRate = 6f;

        [Header("Stamina (Solmar.UI.PlayerStats.Stamina)")]
        public float staminaDrainPerSecond = 20f;
        public float staminaRegenPerSecond = 14f;

        /// <summary>The camera movement is relative to; falls back to Camera.main.</summary>
        public Transform cameraTransform;

        CharacterController controller;
        float currentSpeed;
        float verticalVelocity;
        float yawVelocity;
        Vector3 lastMoveDirection = Vector3.forward;

        bool crouching;
        float crouchBlend;
        float standingHeight;
        Vector3 standingCenter;

        PlayerVaulting vaulting;

        /// <summary>Current horizontal speed in m/s (smoothed towards the input's target speed).</summary>
        public float Speed => currentSpeed;
        /// <summary>Current horizontal speed, 0..1 relative to <see cref="runSpeed"/>.</summary>
        public float NormalizedSpeed => runSpeed > 0.0001f ? Mathf.Clamp01(currentSpeed / runSpeed) : 0f;
        public bool Grounded { get; private set; }
        public bool Running { get; private set; }
        public float VerticalVelocity => verticalVelocity;
        /// <summary>The last non-zero horizontal direction the character moved in, world space.</summary>
        public Vector3 FacingDirection => lastMoveDirection;
        /// <summary>True while Left Ctrl has toggled a crouch on.</summary>
        public bool Crouching => crouching;
        /// <summary>0 standing .. 1 fully crouched, smoothed: what <see cref="PlayerBody"/> feeds the animator.</summary>
        public float Crouch01 => crouchBlend;
        public CharacterController Controller => controller;

        /// <summary>
        /// True while another companion (<see cref="PlayerVaulting"/>, <see cref="PlayerSwimming"/>,
        /// <see cref="PlayerHealthState"/>) is driving the CharacterController directly; this class's
        /// own <c>Update</c> does nothing at all while it's set, and <see cref="Velocity"/> reports
        /// <see cref="ExternalVelocity"/> instead so <see cref="PlayerBody"/> still animates sensibly.
        /// </summary>
        public bool SuspendControl;
        /// <summary>What <see cref="Velocity"/> reports while <see cref="SuspendControl"/> is set; the
        /// owning companion should keep this current (or zero it) for as long as it holds control.</summary>
        public Vector3 ExternalVelocity;

        /// <summary>World-space velocity for <see cref="PlayerBody"/>/<c>HumanBody</c> to animate from:
        /// the last-faced direction times current speed plus vertical, or <see cref="ExternalVelocity"/>
        /// while a companion has taken over motion.</summary>
        public Vector3 Velocity => SuspendControl ? ExternalVelocity : lastMoveDirection * currentSpeed + Vector3.up * verticalVelocity;

        void Awake()
        {
            controller = GetComponent<CharacterController>();
            controller.height = controllerHeight;
            controller.radius = controllerRadius;
            controller.center = new Vector3(0f, controllerHeight * 0.5f, 0f);
            controller.stepOffset = stepOffset;
            controller.slopeLimit = slopeLimit;
            standingHeight = controllerHeight;
            standingCenter = controller.center;
            vaulting = GetComponent<PlayerVaulting>();
        }

        /// <summary>Moves the CharacterController by a world-space delta directly. Used by whichever
        /// companion currently has <see cref="SuspendControl"/> set.</summary>
        public void ExternalMove(Vector3 worldDelta)
        {
            if (controller != null && controller.enabled) controller.Move(worldDelta);
        }

        /// <summary>Overwrites the vertical velocity this class resumes falling from once it gets
        /// control back (e.g. zero, after a vault lands or a swim ends at the surface).</summary>
        public void SetVerticalVelocity(float v)
        {
            verticalVelocity = float.IsFinite(v) ? v : 0f;
        }

        /// <summary>Warps the player to <paramref name="position"/> without the controller fighting the
        /// teleport (toggling it off for the move, as Unity's docs recommend) — used to respawn.</summary>
        public void Teleport(Vector3 position)
        {
            if (controller == null) return;
            controller.enabled = false;
            transform.position = position;
            controller.enabled = true;
            verticalVelocity = 0f;
            currentSpeed = 0f;
        }

#if ENABLE_LEGACY_INPUT_MANAGER
        void Update()
        {
            if (SuspendControl) return;
            float dt = Time.deltaTime;

            if (Input.GetKeyDown(KeyCode.LeftControl) || Input.GetKeyDown(KeyCode.RightControl))
                crouching = !crouching;

            float forward = (Input.GetKey(KeyCode.W) ? 1f : 0f) - (Input.GetKey(KeyCode.S) ? 1f : 0f);
            float strafe = (Input.GetKey(KeyCode.D) ? 1f : 0f) - (Input.GetKey(KeyCode.A) ? 1f : 0f);
            var input = new Vector2(strafe, forward);
            if (input.sqrMagnitude > 1f) input.Normalize();

            bool walkModifier = Input.GetKey(KeyCode.LeftAlt) || Input.GetKey(KeyCode.RightAlt);
            bool wantSprint = !crouching && (Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift));

            // Stamina: drains only while actually sprinting with some input, regenerates the rest of
            // the time (walking, jogging, standing still) - never below empty or above full.
            Running = wantSprint && input.sqrMagnitude > 0.01f && PlayerStats.Stamina > 0.01f;
            PlayerStats.Stamina += (Running ? -staminaDrainPerSecond : staminaRegenPerSecond) * dt;

            float baseSpeed = crouching ? crouchSpeed : (Running ? runSpeed : (walkModifier ? walkSpeed : jogSpeed));
            float targetSpeed = input.magnitude * baseSpeed;

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
                // Near a vaultable/climbable obstacle, Space hands motion over to PlayerVaulting for
                // the rest of this frame and every frame until it's done, instead of jumping.
                if (vaulting != null && vaulting.TryStartVault()) return;
                verticalVelocity = Mathf.Sqrt(Mathf.Max(0f, -2f * gravity * jumpHeight));
            }
            verticalVelocity += gravity * dt;

            crouchBlend = Mathf.MoveTowards(crouchBlend, crouching ? 1f : 0f, crouchBlendRate * dt);
            ApplyCrouchHeight();

            // Once there is no input, currentSpeed decelerates to 0, so horizontal fades out in the
            // last direction faced rather than snapping to zero.
            Vector3 horizontal = lastMoveDirection * currentSpeed;
            controller.Move(new Vector3(horizontal.x, verticalVelocity, horizontal.z) * dt);
        }
#endif

        void ApplyCrouchHeight()
        {
            float height = Mathf.Lerp(standingHeight, standingHeight * crouchHeightMultiplier, crouchBlend);
            controller.height = height;
            controller.center = new Vector3(standingCenter.x, height * 0.5f, standingCenter.z);
        }
    }
}
