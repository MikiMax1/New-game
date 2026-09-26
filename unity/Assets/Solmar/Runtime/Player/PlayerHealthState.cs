using System.Collections;
using Solmar.People;
using Solmar.UI;
using Solmar.Vehicles;
using UnityEngine;

namespace Solmar
{
    /// <summary>
    /// Falls, being run over, and death for the on-foot player. Tracks the highest point reached while
    /// airborne so a landing can cost health (a fall over ~4 m) or knock the player down (over ~12 m);
    /// a car hitting the player's CharacterController at over 5 m/s (<see cref="VehicleController"/>'s
    /// own rigidbody speed) knocks them down too, for damage. A knockdown is a simple ragdoll-ish
    /// stumble - the animator frozen, the body's transform tumbled onto its side and its limbs splayed,
    /// then set upright again after ~2 s - rather than physical ragdoll bones. At zero
    /// <see cref="PlayerStats.Health"/>, "WASTED" fades in over the view and the player respawns on the
    /// pavement near where they fell, 4 s later, with full health.
    ///
    /// Added automatically to the player by <see cref="PlayerCharacter"/>'s <c>RequireComponent</c>.
    /// </summary>
    public sealed class PlayerHealthState : MonoBehaviour
    {
        public float minFallDamageHeight = 4f;
        public float knockdownFallHeight = 12f;
        public float fallDamagePerMetre = 6f;

        public float carHitSpeedThreshold = 5f;
        public float carHitDamage = 22f;
        public float carHitCooldown = 1f;

        public float knockdownSeconds = 2f;

        public float wastedFadeSeconds = 1f;
        public float wastedHoldSeconds = 4f;

        PlayerCharacter character;
        PlayerBody body;

        float peakY;
        bool wasGroundedLastFrame = true;
        bool knockedDown;
        float carHitTimer;

        bool wasted;
        float wastedAlpha;
        GUIStyle wastedStyle;

        void Awake() => character = GetComponent<PlayerCharacter>();

        void Start()
        {
            body = GetComponentInChildren<PlayerBody>();
            peakY = transform.position.y;
        }

        void Update()
        {
            if (character == null) return;
            if (body == null) body = GetComponentInChildren<PlayerBody>();

            float dt = Time.deltaTime;
            if (carHitTimer > 0f) carHitTimer -= dt;

            // Wasted/knockdown drive SuspendControl themselves; a vault or a swim stroke also sets it,
            // and Grounded/position go stale while any of them owns the CharacterController, so just
            // wait for it back rather than risk a false fall reading the moment it's returned.
            if (wasted || knockedDown || character.SuspendControl) return;

            bool grounded = character.Grounded;
            if (!grounded) peakY = Mathf.Max(peakY, transform.position.y);

            if (grounded && !wasGroundedLastFrame)
            {
                float fallDistance = peakY - transform.position.y;
                if (fallDistance > minFallDamageHeight)
                {
                    ApplyDamage((fallDistance - minFallDamageHeight) * fallDamagePerMetre);
                    if (!wasted && fallDistance > knockdownFallHeight)
                        StartCoroutine(KnockdownRoutine(Vector3.up * 0.4f - transform.forward * 0.6f));
                }
            }
            if (grounded) peakY = transform.position.y;
            wasGroundedLastFrame = grounded;
        }

        void OnControllerColliderHit(ControllerColliderHit hit)
        {
            if (wasted || knockedDown || carHitTimer > 0f || hit.rigidbody == null) return;
            if (character.SuspendControl) return; // mid-vault or mid-swim: let that finish first.
            VehicleController vc = hit.collider.GetComponentInParent<VehicleController>();
            if (vc == null) return;

            float speed = vc.Velocity.magnitude;
            if (!float.IsFinite(speed) || speed <= carHitSpeedThreshold) return;

            carHitTimer = carHitCooldown;
            ApplyDamage(carHitDamage);
            if (wasted) return;

            Vector3 away = transform.position - hit.point;
            away.y = 0.4f;
            if (away.sqrMagnitude < 0.01f) away = -transform.forward + Vector3.up * 0.4f;
            StartCoroutine(KnockdownRoutine(away.normalized * Mathf.Clamp(speed * 0.3f, 1f, 4f)));
        }

        void ApplyDamage(float damage)
        {
            if (damage <= 0f || !float.IsFinite(damage)) return;
            PlayerStats.Health -= damage;
            if (PlayerStats.Health <= 0f && !wasted) StartCoroutine(WastedRoutine());
        }

        /// <summary>A simple ragdoll-ish knockdown: freezes the animator, tumbles the body's own
        /// transform (not the CharacterController, which has to stay upright) onto its side with the
        /// limbs splayed out, holds it there, then eases it back upright.</summary>
        IEnumerator KnockdownRoutine(Vector3 impulseDir)
        {
            knockedDown = true;
            character.SuspendControl = true;
            character.ExternalVelocity = Vector3.zero;
            character.SetVerticalVelocity(0f);

            HumanBody hb = body != null ? body.Body : null;
            HumanAnimator anim = hb != null ? hb.Animator : null;
            HumanBones bones = hb != null ? hb.Bones : null;
            Transform bodyRoot = hb != null ? hb.transform : null;
            if (anim != null) anim.poseFrozen = true;

            Quaternion standingRot = bodyRoot != null ? bodyRoot.localRotation : Quaternion.identity;
            Vector3 standingPos = bodyRoot != null ? bodyRoot.localPosition : Vector3.zero;
            Vector3 fallAxis = Vector3.Cross(Vector3.up, impulseDir.sqrMagnitude > 1e-4f ? impulseDir.normalized : Vector3.forward);
            if (fallAxis.sqrMagnitude < 1e-4f) fallAxis = Vector3.right;
            Quaternion lyingRot = Quaternion.AngleAxis(82f, fallAxis.normalized) * standingRot;
            Vector3 lyingPos = standingPos + Vector3.down * 0.55f;

            float downTime = Mathf.Max(0.05f, knockdownSeconds * 0.22f);
            yield return TumbleLerp(bodyRoot, bones, standingRot, lyingRot, standingPos, lyingPos, downTime, false);

            float holdTime = Mathf.Max(0f, knockdownSeconds - downTime * 2f);
            yield return new WaitForSeconds(holdTime);

            yield return TumbleLerp(bodyRoot, bones, lyingRot, standingRot, lyingPos, standingPos, downTime, true);

            if (bodyRoot != null)
            {
                bodyRoot.localRotation = standingRot;
                bodyRoot.localPosition = standingPos;
            }
            if (anim != null) anim.poseFrozen = false;
            character.SuspendControl = false;
            knockedDown = false;
        }

        static IEnumerator TumbleLerp(Transform bodyRoot, HumanBones bones, Quaternion fromRot, Quaternion toRot, Vector3 fromPos, Vector3 toPos, float duration, bool gettingUp)
        {
            float t = 0f;
            while (t < duration)
            {
                t += Time.deltaTime;
                float f = Mathf.Clamp01(t / duration);
                if (bodyRoot != null)
                {
                    bodyRoot.localRotation = Quaternion.Slerp(fromRot, toRot, f);
                    bodyRoot.localPosition = Vector3.Lerp(fromPos, toPos, f);
                }
                SplayLimbs(bones, gettingUp ? 1f - f : f);
                yield return null;
            }
        }

        static void SplayLimbs(HumanBones bones, float f)
        {
            if (bones == null) return;
            f = Mathf.Clamp01(f);
            if (bones.leftShoulder != null) bones.leftShoulder.localRotation = Quaternion.Euler(-40f * f, 0f, 20f * f);
            if (bones.rightShoulder != null) bones.rightShoulder.localRotation = Quaternion.Euler(-30f * f, 0f, -25f * f);
            if (bones.leftHip != null) bones.leftHip.localRotation = Quaternion.Euler(-15f * f, 0f, 0f);
            if (bones.rightHip != null) bones.rightHip.localRotation = Quaternion.Euler(-8f * f, 0f, 0f);
            if (bones.leftKnee != null) bones.leftKnee.localRotation = Quaternion.Euler(25f * f, 0f, 0f);
            if (bones.rightKnee != null) bones.rightKnee.localRotation = Quaternion.Euler(15f * f, 0f, 0f);
        }

        IEnumerator WastedRoutine()
        {
            wasted = true;
            wastedAlpha = 0f;
            character.SuspendControl = true;
            character.ExternalVelocity = Vector3.zero;
            character.SetVerticalVelocity(0f);
            Vector3 deathPos = transform.position;

            float elapsed = 0f;
            float total = wastedFadeSeconds + wastedHoldSeconds;
            while (elapsed < total)
            {
                elapsed += Time.deltaTime;
                wastedAlpha = Mathf.Clamp01(elapsed / Mathf.Max(0.001f, wastedFadeSeconds));
                yield return null;
            }

            character.Teleport(FindPavementNear(deathPos));
            PlayerStats.Health = PlayerStats.MaxHealth;

            float t = 0f;
            while (t < wastedFadeSeconds)
            {
                t += Time.deltaTime;
                wastedAlpha = 1f - Mathf.Clamp01(t / Mathf.Max(0.001f, wastedFadeSeconds));
                yield return null;
            }
            wastedAlpha = 0f;
            character.SuspendControl = false;
            wasted = false;
        }

        Vector3 FindPavementNear(Vector3 pos)
        {
            int mask = ~(1 << gameObject.layer);
            Vector3 from = new Vector3(pos.x, pos.y + 60f, pos.z);
            if (Physics.Raycast(from, Vector3.down, out RaycastHit hit, 200f, mask, QueryTriggerInteraction.Ignore) && float.IsFinite(hit.point.y))
                return hit.point;
            return pos;
        }

        void OnGUI()
        {
            if (!wasted || wastedAlpha <= 0.001f) return;
            wastedStyle ??= new GUIStyle(GUI.skin.label)
            {
                alignment = TextAnchor.MiddleCenter,
                fontStyle = FontStyle.Bold,
            };
            wastedStyle.fontSize = Mathf.RoundToInt(Mathf.Min(Screen.width, Screen.height) * 0.12f);

            Color prev = GUI.color;
            GUI.color = new Color(0f, 0f, 0f, wastedAlpha * 0.6f);
            GUI.DrawTexture(new Rect(0f, 0f, Screen.width, Screen.height), Texture2D.whiteTexture);
            GUI.color = new Color(0.78f, 0.05f, 0.05f, wastedAlpha);
            GUI.Label(new Rect(0f, Screen.height * 0.5f - 80f, Screen.width, 160f), "WASTED", wastedStyle);
            GUI.color = prev;
        }
    }
}
