using UnityEngine;

namespace Solmar
{
    /// <summary>
    /// A short positional/rotational jitter on top of whatever's positioning <see cref="Camera.main"/>
    /// (normally <see cref="OrbitCamera"/>), for melee hits and other impacts. Call <see cref="Shake"/>
    /// from anywhere; it lazily adds itself to the main camera the first time it's needed. Runs in
    /// <c>LateUpdate</c> at a forced high execution order so it always applies its offset after
    /// <see cref="OrbitCamera"/> (or any other camera rig) has set the transform for the frame, rather
    /// than being overwritten by it.
    /// </summary>
    [DefaultExecutionOrder(1000)]
    public sealed class CameraShake : MonoBehaviour
    {
        float amplitude;
        float duration;
        float timer;

        /// <summary>Shakes the main camera for `seconds`, peaking at `strength` (roughly metres of
        /// jitter). Stacks with, rather than replacing, a shake already in progress.</summary>
        public static void Shake(float strength, float seconds)
        {
            Camera cam = Camera.main;
            if (cam == null || !float.IsFinite(strength) || !float.IsFinite(seconds)) return;
            CameraShake shake = cam.GetComponent<CameraShake>();
            if (shake == null) shake = cam.gameObject.AddComponent<CameraShake>();
            shake.amplitude = Mathf.Max(shake.timer > 0f ? shake.amplitude : 0f, strength);
            shake.duration = Mathf.Max(shake.duration, seconds);
            shake.timer = Mathf.Max(shake.timer, seconds);
        }

        void LateUpdate()
        {
            if (timer <= 0f) return;
            timer -= Time.deltaTime;
            float f = duration > 0f ? Mathf.Clamp01(timer / duration) : 0f;
            float mag = amplitude * f;

            float nx = (Mathf.PerlinNoise(Time.time * 27f, 0.37f) - 0.5f) * 2f;
            float ny = (Mathf.PerlinNoise(0.61f, Time.time * 27f) - 0.5f) * 2f;
            Vector3 offset = new Vector3(nx, ny, 0f) * mag * 0.05f;
            if (!IsFinite(offset)) return;

            transform.position += offset;
            transform.rotation *= Quaternion.Euler(ny * 3f * mag, nx * 3f * mag, 0f);
        }

        static bool IsFinite(Vector3 v) => float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z);
    }
}
