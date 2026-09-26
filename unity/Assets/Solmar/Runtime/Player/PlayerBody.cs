using Solmar.People;
using UnityEngine;

namespace Solmar
{
    /// <summary>
    /// Thin wrapper that grows a <see cref="HumanBody"/> for the player and feeds it every frame from
    /// <see cref="PlayerCharacter"/>. All of the actual body-building and procedural animation lives
    /// in Runtime/People now, shared with NPCs; this class only owns the player's own look and passes
    /// <see cref="PlayerCharacter"/>'s velocity and grounded state through. Kept as its own class (and
    /// keeps its <see cref="character"/> and <see cref="groundMask"/> fields) because
    /// <c>PlayerSpawner</c> sets them directly.
    /// </summary>
    public sealed class PlayerBody : MonoBehaviour
    {
        /// <summary>Optional: drives the walk/run cycle and grounded state. Assigned by <see cref="PlayerSpawner"/>.</summary>
        public PlayerCharacter character;
        /// <summary>Ground raycast layers for foot placement; PlayerSpawner excludes the player's own layer.</summary>
        public LayerMask groundMask = ~0;

        HumanBody body;

        void Awake()
        {
            var bodyGo = new GameObject("Human");
            bodyGo.transform.SetParent(transform, false);
            body = bodyGo.AddComponent<HumanBody>();
            body.Initialize(PlayerLook());
        }

        /// <summary>A plain, believable outfit for the player character themselves (not a random passer-by).</summary>
        static HumanLook PlayerLook()
        {
            return new HumanLook
            {
                heightMeters = 1.8f,
                build = HumanBuild.Average,
                gender = HumanGender.Male,
                skinTone = new Color(0.80f, 0.62f, 0.50f),
                hairStyle = HairStyle.Short,
                hairColor = new Color(0.14f, 0.10f, 0.07f),
                topStyle = TopStyle.TShirt,
                topColor = new Color(0.20f, 0.45f, 0.65f),
                bottomStyle = BottomStyle.Shorts,
                bottomColor = new Color(0.16f, 0.17f, 0.21f),
                shoeStyle = ShoeStyle.Sneakers,
                shoeColor = Color.white,
            };
        }

        void LateUpdate()
        {
            if (body == null) return;
            body.groundMask = groundMask;
            if (character != null)
            {
                if (body.Animator != null)
                {
                    body.Animator.referenceWalkSpeed = character.walkSpeed;
                    body.Animator.referenceRunSpeed = character.runSpeed;
                }
                body.Tick(character.Velocity, character.Grounded, Time.deltaTime);
            }
            else
            {
                body.Tick(Vector3.zero, true, Time.deltaTime);
            }
        }
    }
}
