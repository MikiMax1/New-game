using UnityEngine;

namespace Solmar
{
    /// <summary>
    /// Switches the on-foot player to swimming the moment their feet drop below
    /// <see cref="WaterLevel"/> - there's no real body of water yet, so this is a placeholder height a
    /// future water volume can set - hands the CharacterController over to a slow, WASD-steered
    /// breaststroke that eases the player back up to just under the surface rather than letting them
    /// sink or bob, and drives <see cref="Solmar.People.HumanAnimator"/>'s swim pose layer for as long
    /// as it's active. Hands control straight back to <see cref="PlayerCharacter"/> the moment they
    /// climb back above the water. Added automatically to the player by <see cref="PlayerCharacter"/>'s
    /// <c>RequireComponent</c>.
    /// </summary>
    public sealed class PlayerSwimming : MonoBehaviour
    {
        /// <summary>Below this Y, the player is "in water" and swims.</summary>
        public static float WaterLevel = -0.5f;

        public float swimSpeed = 2.2f;
        /// <summary>How far under <see cref="WaterLevel"/> the player's feet settle while swimming in place.</summary>
        public float surfaceDepth = 0.15f;
        public float surfaceEaseRate = 3f;
        public float turnRateDegPerSec = 220f;

        PlayerCharacter character;
        PlayerBody body;
        bool swimming;

        void Awake() => character = GetComponent<PlayerCharacter>();
        void Start() => body = GetComponentInChildren<PlayerBody>();

        void Update()
        {
            if (character == null) return;
            if (body == null) body = GetComponentInChildren<PlayerBody>();

            bool inWater = transform.position.y < WaterLevel;
            if (inWater && !swimming) EnterWater();
            else if (!inWater && swimming) ExitWater();

            if (swimming) TickSwim(Time.deltaTime);
        }

        void EnterWater()
        {
            swimming = true;
            character.SuspendControl = true;
            var anim = body != null && body.Body != null ? body.Body.Animator : null;
            if (anim != null) anim.swimming = true;
        }

        void ExitWater()
        {
            swimming = false;
            character.SuspendControl = false;
            character.SetVerticalVelocity(0f);
            var anim = body != null && body.Body != null ? body.Body.Animator : null;
            if (anim != null) anim.swimming = false;
        }

        void TickSwim(float dt)
        {
            var input = Vector2.zero;
#if ENABLE_LEGACY_INPUT_MANAGER
            float forward = (Input.GetKey(KeyCode.W) ? 1f : 0f) - (Input.GetKey(KeyCode.S) ? 1f : 0f);
            float strafe = (Input.GetKey(KeyCode.D) ? 1f : 0f) - (Input.GetKey(KeyCode.A) ? 1f : 0f);
            input = new Vector2(strafe, forward);
            if (input.sqrMagnitude > 1f) input.Normalize();
#endif
            Transform cam = character.cameraTransform != null ? character.cameraTransform : (Camera.main != null ? Camera.main.transform : transform);
            Vector3 camForward = cam.forward;
            camForward.y = 0f;
            camForward = camForward.sqrMagnitude > 1e-6f ? camForward.normalized : transform.forward;
            Vector3 camRight = cam.right;
            camRight.y = 0f;
            camRight = camRight.sqrMagnitude > 1e-6f ? camRight.normalized : transform.right;

            Vector3 wishDir = camForward * input.y + camRight * input.x;
            float wishMagnitude = wishDir.magnitude;
            Vector3 horizontalVelocity = Vector3.zero;
            if (wishMagnitude > 1e-4f)
            {
                Vector3 dir = wishDir / wishMagnitude;
                transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(dir, Vector3.up), turnRateDegPerSec * dt);
                horizontalVelocity = dir * swimSpeed * Mathf.Clamp01(wishMagnitude);
            }

            float targetY = WaterLevel - surfaceDepth;
            float newY = Mathf.Lerp(transform.position.y, targetY, Mathf.Clamp01(surfaceEaseRate * dt));
            float verticalDelta = newY - transform.position.y;

            character.ExternalMove(horizontalVelocity * dt + Vector3.up * verticalDelta);
            character.ExternalVelocity = horizontalVelocity + Vector3.up * (dt > 1e-5f ? verticalDelta / dt : 0f);
        }
    }
}
