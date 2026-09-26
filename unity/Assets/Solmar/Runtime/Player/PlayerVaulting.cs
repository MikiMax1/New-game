using System.Collections;
using Solmar.People;
using UnityEngine;

namespace Solmar
{
    /// <summary>
    /// Space, near an obstacle in front of the player, vaults over it (0.5-1.2 m: a low wall, a fence,
    /// a bench, a car bonnet) or climbs up onto it (1.2-2.2 m) instead of jumping - found with a
    /// forward raycast to the obstacle's face and a downward raycast to its top (and, for the far
    /// side, to a landing spot). Added automatically to the player by <see cref="PlayerCharacter"/>'s
    /// <c>RequireComponent</c>.
    ///
    /// While a vault or climb plays out, this class takes the CharacterController over directly
    /// (<see cref="PlayerCharacter.SuspendControl"/>) and moves along a smoothed curve from the takeoff
    /// point to the landing point, arcing high enough to clear the obstacle's top; it also freezes
    /// <see cref="HumanAnimator"/> (<c>poseFrozen</c>) and poses the arms (reaching for, then pushing off
    /// the edge) and legs (tucking up and over) directly, frame by frame, rather than through the
    /// normal walk-cycle pose layers.
    /// </summary>
    public sealed class PlayerVaulting : MonoBehaviour
    {
        public float minVaultHeight = 0.5f;
        public float maxVaultHeight = 1.2f;
        public float maxClimbHeight = 2.2f;
        public float probeDistance = 0.9f;
        public float vaultDuration = 0.45f;
        public float climbDuration = 0.85f;

        PlayerCharacter character;
        PlayerBody body;
        bool active;

        /// <summary>True while a vault or climb is currently playing out.</summary>
        public bool IsActive => active;

        void Awake() => character = GetComponent<PlayerCharacter>();
        void Start() => body = GetComponentInChildren<PlayerBody>();

        /// <summary>Looks for a vaultable/climbable obstacle right in front of the player and, if one is
        /// found, starts moving over it. Returns false (and does nothing) if there's nothing there, so
        /// the caller can fall back to a normal jump.</summary>
        public bool TryStartVault()
        {
            if (active || character == null || character.SuspendControl) return false;
            if (!TryFindObstacle(out Vector3 landingFeet, out float topY, out bool climb)) return false;
            StartCoroutine(VaultRoutine(landingFeet, topY, climb));
            return true;
        }

        bool TryFindObstacle(out Vector3 landingFeet, out float topY, out bool climb)
        {
            landingFeet = default;
            topY = 0f;
            climb = false;

            Vector3 feet = transform.position;
            Vector3 fwd = transform.forward;
            int mask = ~(1 << gameObject.layer);

            // The obstacle's near face, chest-height so a kerb or a shallow step doesn't trigger this.
            Vector3 faceOrigin = feet + Vector3.up * 0.9f;
            if (!Physics.Raycast(faceOrigin, fwd, out RaycastHit faceHit, probeDistance, mask, QueryTriggerInteraction.Ignore))
                return false;

            // Its top: raycast down from well above, just past the face.
            Vector3 topProbe = faceHit.point + fwd * 0.2f + Vector3.up * (maxClimbHeight + 0.4f);
            if (!Physics.Raycast(topProbe, Vector3.down, out RaycastHit topHit, maxClimbHeight + 0.6f, mask, QueryTriggerInteraction.Ignore))
                return false;

            float height = topHit.point.y - feet.y;
            if (!float.IsFinite(height) || height < minVaultHeight || height > maxClimbHeight) return false;
            climb = height > maxVaultHeight;
            topY = topHit.point.y;

            // Where to land: on top of it for a climb, or just past it (down the far side) for a vault.
            Vector3 farPoint = topHit.point + fwd * (climb ? 0.05f : 0.6f);
            Vector3 landProbe = farPoint + Vector3.up * 0.6f;
            if (Physics.Raycast(landProbe, Vector3.down, out RaycastHit landHit, 3.5f, mask, QueryTriggerInteraction.Ignore) && float.IsFinite(landHit.point.y))
                landingFeet = landHit.point;
            else
                landingFeet = climb ? topHit.point : farPoint;
            return true;
        }

        IEnumerator VaultRoutine(Vector3 landingFeet, float topY, bool climb)
        {
            active = true;
            character.SuspendControl = true;
            character.SetVerticalVelocity(0f);
            if (body == null) body = GetComponentInChildren<PlayerBody>();

            HumanAnimator anim = body != null && body.Body != null ? body.Body.Animator : null;
            HumanBones bones = body != null && body.Body != null ? body.Body.Bones : null;
            if (anim != null) anim.poseFrozen = true;

            Vector3 start = transform.position;
            float duration = Mathf.Max(0.05f, climb ? climbDuration : vaultDuration);
            float t = 0f;
            while (t < duration)
            {
                t += Time.deltaTime;
                float f = Mathf.Clamp01(t / duration);
                float smooth = f * f * (3f - 2f * f);

                Vector3 flat = Vector3.Lerp(start, landingFeet, smooth);
                float baseY = Mathf.Lerp(start.y, landingFeet.y, smooth);
                float clearance = Mathf.Max(0.1f, topY - baseY + (climb ? 0.05f : 0.18f));
                float arc = climb
                    ? Mathf.Sin(Mathf.Clamp01(f / 0.85f) * Mathf.PI * 0.5f) * clearance * 0.9f
                    : Mathf.Sin(f * Mathf.PI) * clearance;
                Vector3 targetPos = new Vector3(flat.x, baseY + arc, flat.z);

                character.ExternalVelocity = (targetPos - transform.position) / Mathf.Max(Time.deltaTime, 1e-4f);
                character.ExternalMove(targetPos - transform.position);
                PoseVaultFrame(bones, f, climb);
                yield return null;
            }

            character.ExternalMove(landingFeet - transform.position);
            character.ExternalVelocity = Vector3.zero;
            character.SetVerticalVelocity(0f);
            if (anim != null) anim.poseFrozen = false;
            character.SuspendControl = false;
            active = false;
        }

        /// <summary>Hands placed on the edge early on, the body lifted (hips/knees driven up and
        /// through) across the middle, everything returning to neutral by the far side - all applied
        /// directly to the bones while <see cref="HumanAnimator.poseFrozen"/> is set.</summary>
        static void PoseVaultFrame(HumanBones b, float f, bool climb)
        {
            if (b == null) return;
            float reach = Mathf.Clamp01(f / 0.3f) * (1f - Mathf.Clamp01((f - 0.75f) / 0.25f));
            float lift = Mathf.Clamp01((f - 0.15f) / 0.5f) * (1f - Mathf.Clamp01((f - 0.8f) / 0.2f));

            if (b.leftShoulder != null) b.leftShoulder.localRotation = Quaternion.Euler(-95f * reach, 0f, 10f * reach);
            if (b.rightShoulder != null) b.rightShoulder.localRotation = Quaternion.Euler(-95f * reach, 0f, -10f * reach);
            if (b.leftElbow != null) b.leftElbow.localRotation = Quaternion.Euler(35f * reach, 0f, 0f);
            if (b.rightElbow != null) b.rightElbow.localRotation = Quaternion.Euler(35f * reach, 0f, 0f);

            float hipLift = lift * (climb ? 95f : 60f);
            float kneeLift = lift * (climb ? 110f : 75f);
            if (b.leftHip != null) b.leftHip.localRotation = Quaternion.Euler(-hipLift, 0f, 0f);
            if (b.rightHip != null) b.rightHip.localRotation = Quaternion.Euler(-hipLift * 0.8f, 0f, 0f);
            if (b.leftKnee != null) b.leftKnee.localRotation = Quaternion.Euler(kneeLift, 0f, 0f);
            if (b.rightKnee != null) b.rightKnee.localRotation = Quaternion.Euler(kneeLift * 0.8f, 0f, 0f);
            if (b.leftAnkle != null) b.leftAnkle.localRotation = Quaternion.identity;
            if (b.rightAnkle != null) b.rightAnkle.localRotation = Quaternion.identity;

            if (b.spine != null) b.spine.localRotation = Quaternion.Euler(Mathf.Lerp(0f, 35f, reach * 0.6f + lift * 0.4f), 0f, 0f);
        }
    }
}
