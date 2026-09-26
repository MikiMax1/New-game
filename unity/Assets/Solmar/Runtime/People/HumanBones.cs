using System.Collections.Generic;
using UnityEngine;

namespace Solmar.People
{
    /// <summary>
    /// The joint hierarchy of one body: a real Transform per bone (so it can be posed directly, the
    /// same way <see cref="PlayerBody"/> used to), plus the flat, ordered bone list and name-to-index
    /// map that <see cref="HumanMeshFactory"/> needs to build skinned meshes against them.
    /// </summary>
    public sealed class HumanBones
    {
        public Transform root, pelvis, spine, chest, neck, head;
        public Transform rightShoulder, rightElbow, rightWrist;
        public Transform leftShoulder, leftElbow, leftWrist;
        public Transform rightHip, rightKnee, rightAnkle;
        public Transform leftHip, leftKnee, leftAnkle;

        public readonly List<Transform> all = new List<Transform>(17);
        public readonly Dictionary<Transform, int> index = new Dictionary<Transform, int>(17);
        public Vector3 pelvisRestLocalPos;

        public int Index(Transform t) => index.TryGetValue(t, out int i) ? i : 0;

        public Transform[] Array() => all.ToArray();

        /// <summary>Builds the skeleton under <paramref name="root"/> from <paramref name="p"/>, at rest pose.</summary>
        public static HumanBones Build(Transform root, HumanProportions p)
        {
            var b = new HumanBones { root = root };

            b.pelvis = Joint(b, root, "Pelvis", new Vector3(0f, p.hipHeight, 0f));
            b.pelvisRestLocalPos = b.pelvis.localPosition;
            b.spine = Joint(b, b.pelvis, "Spine", new Vector3(0f, p.lowerTorsoLength, 0f));
            b.chest = Joint(b, b.spine, "Chest", new Vector3(0f, p.upperTorsoLength, 0f));
            b.neck = Joint(b, b.chest, "Neck", new Vector3(0f, p.neckLength, 0f));
            b.head = Joint(b, b.neck, "Head", new Vector3(0f, p.headHeight * 0.5f, 0f));

            float shoulderY = p.upperTorsoLength - p.chestRadiusTop * 0.35f;
            (b.rightShoulder, b.rightElbow, b.rightWrist) = Arm(b, b.chest, "Right", 1f, shoulderY, p);
            (b.leftShoulder, b.leftElbow, b.leftWrist) = Arm(b, b.chest, "Left", -1f, shoulderY, p);

            (b.rightHip, b.rightKnee, b.rightAnkle) = Leg(b, b.pelvis, "Right", 1f, p);
            (b.leftHip, b.leftKnee, b.leftAnkle) = Leg(b, b.pelvis, "Left", -1f, p);
            return b;
        }

        static (Transform, Transform, Transform) Arm(HumanBones b, Transform chest, string side, float sign, float shoulderY, HumanProportions p)
        {
            Transform shoulder = Joint(b, chest, side + "Shoulder", new Vector3(sign * p.shoulderHalfWidth, shoulderY, 0f));
            Transform elbow = Joint(b, shoulder, side + "Elbow", new Vector3(0f, -p.upperArmLength, 0f));
            Transform wrist = Joint(b, elbow, side + "Wrist", new Vector3(0f, -p.forearmLength, 0f));
            return (shoulder, elbow, wrist);
        }

        static (Transform, Transform, Transform) Leg(HumanBones b, Transform pelvis, string side, float sign, HumanProportions p)
        {
            Transform hip = Joint(b, pelvis, side + "Hip", new Vector3(sign * p.hipHalfWidth, -0.02f * p.height, 0f));
            Transform knee = Joint(b, hip, side + "Knee", new Vector3(0f, -p.thighLength, 0f));
            Transform ankle = Joint(b, knee, side + "Ankle", new Vector3(0f, -p.shinLength, 0f));
            return (hip, knee, ankle);
        }

        static Transform Joint(HumanBones b, Transform parent, string name, Vector3 localPosition)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPosition;
            b.index[go.transform] = b.all.Count;
            b.all.Add(go.transform);
            return go.transform;
        }
    }
}
