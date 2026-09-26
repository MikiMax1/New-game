using Solmar.City;
using UnityEngine;

namespace Solmar
{
    /// <summary>
    /// First-person walking on the camera: WASD to move, Shift to run, the mouse to look (click to
    /// lock the cursor, Esc to release it) and a subtle head bob. The eye height follows the street
    /// surface, including its 15 cm kerb steps, smoothed so they ease rather than snap. F swaps
    /// between walking and flying; flying hands control to the FreeCamera component on the same
    /// GameObject. The camera starts flying, at the scene's framed shot.
    /// </summary>
    [RequireComponent(typeof(Camera))]
    public sealed class PlayerWalker : MonoBehaviour
    {
        public bool walking;
        public float walkSpeed = 1.4f;
        public float runSpeed = 4.5f;
        public float eyeHeight = 1.65f;
        public float lookSensitivity = 2.2f;
        public float heightSmoothTime = 0.15f;
        public float bobFrequency = 1.8f;
        public float bobAmplitude = 0.035f;

        FreeCamera freeCamera;
        float yaw;
        float pitch;
        float smoothedGroundY;
        float heightVelocity;
        bool groundInitialised;
        float bobPhase;
        float bobWeight;

        void Start()
        {
            freeCamera = GetComponent<FreeCamera>();
            Vector3 e = transform.eulerAngles;
            yaw = e.y;
            pitch = e.x > 180f ? e.x - 360f : e.x;
            ApplyMode();
        }

        void ApplyMode()
        {
            if (freeCamera != null) freeCamera.enabled = !walking;
            if (!walking) return;
            // Carry on looking where the fly camera was looking.
            Vector3 e = transform.eulerAngles;
            yaw = e.y;
            pitch = e.x > 180f ? e.x - 360f : e.x;
            groundInitialised = false;
        }

#if ENABLE_LEGACY_INPUT_MANAGER
        void Update()
        {
            if (Input.GetKeyDown(KeyCode.F))
            {
                walking = !walking;
                ApplyMode();
            }

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

            if (!walking) return;

            if (Cursor.lockState == CursorLockMode.Locked)
            {
                yaw += Input.GetAxis("Mouse X") * lookSensitivity;
                pitch = Mathf.Clamp(pitch - Input.GetAxis("Mouse Y") * lookSensitivity, -89f, 89f);
            }

            float forward = (Input.GetKey(KeyCode.W) ? 1f : 0f) - (Input.GetKey(KeyCode.S) ? 1f : 0f);
            float strafe = (Input.GetKey(KeyCode.D) ? 1f : 0f) - (Input.GetKey(KeyCode.A) ? 1f : 0f);
            var input = new Vector2(strafe, forward);
            if (input.sqrMagnitude > 1f) input.Normalize();
            float speed = Input.GetKey(KeyCode.LeftShift) ? runSpeed : walkSpeed;

            Vector3 move = Quaternion.Euler(0f, yaw, 0f) * new Vector3(input.x, 0f, input.y) * (speed * Time.deltaTime);
            Vector3 pos = transform.position + move;
            float limitX = Layout.StreetHalfLength - 1f;
            float limitZ = Layout.BuildingZ - 0.35f;
            pos.x = Mathf.Clamp(pos.x, -limitX, limitX);
            pos.z = Mathf.Clamp(pos.z, -limitZ, limitZ);

            float groundY = Street.Height(pos.x, pos.z);
            if (!groundInitialised)
            {
                smoothedGroundY = groundY;
                groundInitialised = true;
            }
            else
            {
                smoothedGroundY = Mathf.SmoothDamp(smoothedGroundY, groundY, ref heightVelocity, heightSmoothTime);
            }

            float speedRatio = speed / walkSpeed;
            bobWeight = Mathf.MoveTowards(bobWeight, input.magnitude, Time.deltaTime * 4f);
            if (bobWeight > 0.0001f) bobPhase += Time.deltaTime * bobFrequency * speedRatio;
            float bob = Mathf.Sin(bobPhase * Mathf.PI * 2f) * bobAmplitude * bobWeight;

            pos.y = smoothedGroundY + eyeHeight + bob;
            transform.position = pos;
            transform.rotation = Quaternion.Euler(pitch, yaw, 0f);
        }
#endif
    }
}
