using Solmar.Pedestrians;
using Solmar.UI;
using UnityEngine;

namespace Solmar
{
    /// <summary>
    /// GTA-style unarmed melee: left mouse throws a punch (alternating two jabs and a hook), F throws a
    /// kick. Each strike drives <see cref="Solmar.People.HumanAnimator"/>'s punch/kick pose layer for
    /// its own duration, then checks an overlap sphere out in front of the player midway through the
    /// swing for <see cref="PedestrianAgent"/>s to hit. A connecting hit knocks the pedestrian down
    /// (<see cref="PedestrianAgent.Knockdown"/>, its own fall/ragdoll reaction), shakes the camera, and
    /// raises the player's wanted level to at least 1. Added automatically to the player by
    /// <see cref="PlayerCharacter"/>'s <c>RequireComponent</c>.
    /// </summary>
    public sealed class PlayerCombat : MonoBehaviour
    {
        public float punchRange = 1.0f;
        public float punchRadius = 0.55f;
        public float punchDuration = 0.32f;
        public float punchCooldown = 0.4f;
        public float punchImpulse = 3.2f;

        public float kickRange = 1.25f;
        public float kickRadius = 0.6f;
        public float kickDuration = 0.5f;
        public float kickCooldown = 0.6f;
        public float kickImpulse = 5.5f;

        public float cameraShakeStrength = 0.16f;
        public float cameraShakeSeconds = 0.2f;

        enum Action { None, Punch, Kick }

        PlayerCharacter character;
        PlayerBody body;

        Action action = Action.None;
        float actionElapsed;
        float actionDuration;
        float cooldownTimer;
        int punchVariant = -1;
        bool hitLanded;

        static readonly Collider[] HitBuffer = new Collider[12];

        void Awake() => character = GetComponent<PlayerCharacter>();
        void Start() => body = GetComponentInChildren<PlayerBody>();

#if ENABLE_LEGACY_INPUT_MANAGER
        void Update()
        {
            if (body == null) body = GetComponentInChildren<PlayerBody>();
            float dt = Time.deltaTime;
            if (cooldownTimer > 0f) cooldownTimer -= dt;

            if (action != Action.None)
            {
                actionElapsed += dt;
                float t = Mathf.Clamp01(actionElapsed / actionDuration);
                ApplyBlend(t);
                if (!hitLanded && t >= 0.4f && t <= 0.8f) TryLandHit();
                if (actionElapsed >= actionDuration)
                {
                    action = Action.None;
                    ApplyBlend(0f);
                }
                return;
            }

            if (character != null && character.SuspendControl) return;
            if (cooldownTimer > 0f) return;

            if (Input.GetMouseButtonDown(0)) BeginPunch();
            else if (Input.GetKeyDown(KeyCode.F)) BeginKick();
        }
#endif

        void BeginPunch()
        {
            punchVariant = (punchVariant + 1) % 3; // jab, jab, hook, repeat: "alternating jabs and a hook".
            action = Action.Punch;
            actionElapsed = 0f;
            actionDuration = Mathf.Max(0.05f, punchDuration);
            cooldownTimer = punchCooldown;
            hitLanded = false;
        }

        void BeginKick()
        {
            action = Action.Kick;
            actionElapsed = 0f;
            actionDuration = Mathf.Max(0.05f, kickDuration);
            cooldownTimer = kickCooldown;
            hitLanded = false;
        }

        void ApplyBlend(float t)
        {
            var anim = body != null && body.Body != null ? body.Body.Animator : null;
            if (anim == null) return;
            anim.punchBlend01 = action == Action.Punch ? t : 0f;
            anim.punchVariant = punchVariant;
            anim.kickBlend01 = action == Action.Kick ? t : 0f;
        }

        void TryLandHit()
        {
            hitLanded = true;
            bool isPunch = action == Action.Punch;
            float range = isPunch ? punchRange : kickRange;
            float radius = isPunch ? punchRadius : kickRadius;
            float impulseMag = isPunch ? punchImpulse : kickImpulse;

            Vector3 origin = transform.position + Vector3.up * 1.0f + transform.forward * (range * 0.5f);
            int count = Physics.OverlapSphereNonAlloc(origin, radius, HitBuffer, ~0, QueryTriggerInteraction.Ignore);
            bool anyHit = false;
            for (int i = 0; i < count; i++)
            {
                Collider c = HitBuffer[i];
                if (c == null) continue;
                PedestrianAgent ped = c.GetComponentInParent<PedestrianAgent>();
                if (ped == null || !ped.Active) continue;

                Vector3 impulseDir = ped.Position - transform.position;
                impulseDir.y = 0.35f;
                if (impulseDir.sqrMagnitude < 0.01f) impulseDir = transform.forward + Vector3.up * 0.35f;
                ped.Knockdown(impulseDir.normalized * impulseMag);
                anyHit = true;
            }

            if (anyHit)
            {
                CameraShake.Shake(cameraShakeStrength, cameraShakeSeconds);
                PlayerStats.WantedLevel = Mathf.Max(PlayerStats.WantedLevel, 1);
            }
        }
    }
}
