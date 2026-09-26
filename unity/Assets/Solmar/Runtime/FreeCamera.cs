using UnityEngine;

namespace Solmar
{
    /// <summary>
    /// A simple fly camera for play mode: hold the right mouse button to look around, WASD to move,
    /// Q/E down/up, Shift to go faster. Uses the classic Input Manager when it is enabled.
    /// </summary>
    public sealed class FreeCamera : MonoBehaviour
    {
        public float speed = 6f;
        public float fastMultiplier = 5f;
        public float lookSensitivity = 2.2f;

        float yaw;
        float pitch;

        // On enable rather than start: PlayerWalker hands the camera back here after walking.
        void OnEnable()
        {
            Vector3 e = transform.eulerAngles;
            yaw = e.y;
            pitch = e.x > 180f ? e.x - 360f : e.x;
        }

#if ENABLE_LEGACY_INPUT_MANAGER
        void Update()
        {
            if (Input.GetMouseButton(1))
            {
                yaw += Input.GetAxis("Mouse X") * lookSensitivity;
                pitch = Mathf.Clamp(pitch - Input.GetAxis("Mouse Y") * lookSensitivity, -89f, 89f);
                transform.rotation = Quaternion.Euler(pitch, yaw, 0f);
            }
            var move = new Vector3(
                (Input.GetKey(KeyCode.D) ? 1f : 0f) - (Input.GetKey(KeyCode.A) ? 1f : 0f),
                (Input.GetKey(KeyCode.E) ? 1f : 0f) - (Input.GetKey(KeyCode.Q) ? 1f : 0f),
                (Input.GetKey(KeyCode.W) ? 1f : 0f) - (Input.GetKey(KeyCode.S) ? 1f : 0f));
            float s = speed * (Input.GetKey(KeyCode.LeftShift) ? fastMultiplier : 1f);
            transform.Translate(move * (s * Time.deltaTime), Space.Self);
        }
#endif
    }
}
