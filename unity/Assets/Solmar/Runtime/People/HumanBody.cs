using UnityEngine;

namespace Solmar.People
{
    /// <summary>
    /// One person, fully code-built: call <see cref="Initialize"/> once with a <see cref="HumanLook"/>
    /// to grow the skeleton, the single skinned mesh (body, face, hair, hands, feet and clothes) and
    /// the procedural animator, then call <see cref="Tick"/> every frame (or every pedestrian-update
    /// tick) with that person's current world-space velocity and whether they're grounded. Used
    /// directly by <see cref="PlayerBody"/> for the player, and meant to be reused by a pedestrian
    /// controller for NPCs: nothing here depends on <c>PlayerCharacter</c>.
    /// </summary>
    public sealed class HumanBody : MonoBehaviour
    {
        /// <summary>Ground raycast layers for foot placement; the owner should exclude its own collider layer.</summary>
        public LayerMask groundMask = ~0;

        public HumanLook Look { get; private set; }
        public HumanBones Bones { get; private set; }
        public HumanProportions Proportions { get; private set; }
        public SkinnedMeshRenderer BodyRenderer { get; private set; }
        /// <summary>Gait/pose tuning knobs (step frequency, swing amounts, lean amounts, ...).</summary>
        public HumanAnimator Animator { get; private set; }

        bool built;

        /// <summary>Builds this person's mesh and rig from `look`. Safe to call once, right after adding the component.</summary>
        public void Initialize(HumanLook look)
        {
            Look = look ?? new HumanLook();
            Proportions = HumanProportions.From(Look);
            Bones = HumanBones.Build(transform, Proportions);
            HumanMaterials mats = HumanMaterials.Build(Look);
            BodyRenderer = HumanMeshFactory.Build(Bones, Proportions, Look, mats);
            Animator = new HumanAnimator(Bones, Proportions);
            built = true;
        }

        /// <summary>
        /// Advances the procedural pose by `dt` from `velocity` (world-space; its y drives the
        /// jump/fall pose) and `grounded`. Does nothing until <see cref="Initialize"/> has run.
        /// </summary>
        public void Tick(Vector3 velocity, bool grounded, float dt)
        {
            if (!built) return;
            Animator.Tick(velocity, grounded, dt, groundMask);
        }
    }
}
