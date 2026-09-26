using System.Collections.Generic;
using UnityEngine;

namespace Solmar.People
{
    /// <summary>
    /// Builds one person's whole visible geometry as a single <see cref="SkinnedMeshRenderer"/>: a
    /// continuous, smoothly-skinned skin mesh lofted from tapered cross-section rings for the torso,
    /// neck and limbs (bone weights blended across each joint so bending doesn't crease), a head with
    /// a jaw, nose, ears, eyes, brows and lips, a hair shell, hands with a thumb and a fused finger
    /// block, and shoes — with clothes as further, slightly-inflated regions of the same mesh (their
    /// own submesh/material), each rigidly skinned to the limb bone it covers.
    /// </summary>
    public static class HumanMeshFactory
    {
        static readonly string[] SlotOrder =
        {
            "skin", "eyeWhite", "iris", "lips", "hair", "top", "bottom", "shoes", "cap", "sunglasses",
        };

        public static SkinnedMeshRenderer Build(HumanBones bones, HumanProportions p, HumanLook look, HumanMaterials mats)
        {
            Transform root = bones.root;
            var asm = new HumanSkinnedAssembly();

            // ---- Torso: pelvis -> spine -> chest, flattened front-to-back like a real ribcage. ----
            AddSkinSegment(asm, bones, root, bones.pelvis, bones.spine, p.lowerTorsoLength,
                p.waistRadiusBottom, p.waistRadiusMid, p.waistRadiusTop, 16, true, 0.22f, new Vector3(1.05f, 1f, 0.85f));
            AddSkinSegment(asm, bones, root, bones.spine, bones.chest, p.upperTorsoLength,
                p.chestRadiusBottom, p.chestRadiusMid, p.chestRadiusTop, 16, true, 0.2f, new Vector3(1.12f, 1f, 0.8f));

            // A top always covers the whole torso, not just the sleeves; a tucked waistband layer
            // over the lower torso too, so shorts/jeans read as reaching the waist rather than
            // starting abruptly at the hip bone.
            AddClothSegment(asm, "top", bones, root, bones.spine, p.upperTorsoLength,
                p.chestRadiusBottom, p.chestRadiusMid, p.chestRadiusTop, 16, true, 1f, 1.06f, new Vector3(1.12f, 1f, 0.8f));
            AddClothSegment(asm, "top", bones, root, bones.pelvis, p.lowerTorsoLength,
                p.waistRadiusBottom, p.waistRadiusMid, p.waistRadiusTop, 16, true, 1f, 1.05f, new Vector3(1.05f, 1f, 0.85f));
            AddClothSegment(asm, "bottom", bones, root, bones.pelvis, p.lowerTorsoLength,
                p.waistRadiusBottom, p.waistRadiusMid, p.waistRadiusTop, 16, true, 0.55f, 1.08f, new Vector3(1.05f, 1f, 0.85f));

            // ---- Neck. ----
            AddSkinSegment(asm, bones, root, bones.chest, bones.neck, p.neckLength,
                p.neckRadius * 0.95f, p.neckRadius, p.neckRadius * 1.05f, 12, true, 0.35f, Vector3.one);

            // ---- Head, face and hair. ----
            BuildHead(asm, bones, p, look, root);

            // ---- Arms + hands, clothed sleeve per top style. ----
            BuildArm(asm, bones, p, look, root, true);
            BuildArm(asm, bones, p, look, root, false);

            // ---- Legs + feet, clothed leg length per bottom style. ----
            BuildLeg(asm, bones, p, look, root, true);
            BuildLeg(asm, bones, p, look, root, false);

            var (mesh, boneWeights, usedSlots) = asm.Build("Human", SlotOrder);
            mesh.boneWeights = boneWeights;

            Transform[] boneArray = bones.Array();
            var bindposes = new Matrix4x4[boneArray.Length];
            for (int i = 0; i < boneArray.Length; i++)
                bindposes[i] = boneArray[i].worldToLocalMatrix * root.localToWorldMatrix;
            mesh.bindposes = bindposes;

            var materials = new Material[usedSlots.Count];
            for (int i = 0; i < usedSlots.Count; i++) materials[i] = SlotMaterial(usedSlots[i], mats);

            var go = new GameObject("Body");
            go.transform.SetParent(root, false);
            var smr = go.AddComponent<SkinnedMeshRenderer>();
            smr.bones = boneArray;
            smr.rootBone = bones.pelvis;
            smr.sharedMesh = mesh;
            smr.sharedMaterials = materials;
            smr.updateWhenOffscreen = true;
            smr.quality = SkinQuality.Auto;
            return smr;
        }

        static Material SlotMaterial(string slot, HumanMaterials m) => slot switch
        {
            "skin" => m.skin,
            "eyeWhite" => m.eyeWhite,
            "iris" => m.iris,
            "lips" => m.lips,
            "hair" => m.hair,
            "top" => m.top,
            "bottom" => m.bottom,
            "shoes" => m.shoes,
            "cap" => m.cap,
            "sunglasses" => m.sunglasses,
            _ => m.skin,
        };

        // ---- Arms ----

        static void BuildArm(HumanSkinnedAssembly asm, HumanBones bones, HumanProportions p, HumanLook look, Transform root, bool right)
        {
            Transform shoulder = right ? bones.rightShoulder : bones.leftShoulder;
            Transform elbow = right ? bones.rightElbow : bones.leftElbow;
            Transform wrist = right ? bones.rightWrist : bones.leftWrist;

            AddSkinSegment(asm, bones, root, shoulder, elbow, p.upperArmLength, p.upperArmR0, p.upperArmR1, p.upperArmR2, 12, false, 0.3f, Vector3.one);
            AddSkinSegment(asm, bones, root, elbow, wrist, p.forearmLength, p.forearmR0, p.forearmR1, p.forearmR2, 12, false, 0.3f, Vector3.one);

            float sleeve = look.topStyle switch
            {
                TopStyle.TankTop => 0.12f,
                TopStyle.TShirt => 0.62f,
                TopStyle.Shirt => 1.32f,
                _ => 0.62f,
            };
            if (sleeve > 0.02f)
            {
                float upperCoverage = Mathf.Min(sleeve, 1f);
                AddClothSegment(asm, "top", bones, root, shoulder, p.upperArmLength, p.upperArmR0, p.upperArmR1, p.upperArmR2, 12, false, upperCoverage, 1.09f, Vector3.one);
                float forearmCoverage = Mathf.Clamp01(sleeve - 1f);
                if (forearmCoverage > 0.02f)
                    AddClothSegment(asm, "top", bones, root, elbow, p.forearmLength, p.forearmR0, p.forearmR1, p.forearmR2, 12, false, forearmCoverage, 1.09f, Vector3.one);
            }

            BuildHand(asm, bones, p, root, wrist, right);
        }

        static void BuildHand(HumanSkinnedAssembly asm, HumanBones bones, HumanProportions p, Transform root, Transform wrist, bool right)
        {
            float sign = right ? 1f : -1f;
            float wr = p.forearmR2;
            float hl = p.handLength;
            Matrix4x4 toRoot = root.worldToLocalMatrix * wrist.localToWorldMatrix;
            int idx = bones.Index(wrist);

            MeshData palm = Shapes.ChamferBox(wr * 1.9f, hl * 0.56f, wr * 1.25f, wr * 0.5f).Translate(0f, -hl * 0.28f, 0f);
            MeshData fingers = Shapes.ChamferBox(wr * 1.7f, hl * 0.42f, wr * 0.9f, wr * 0.35f).Translate(0f, -(hl * 0.56f + hl * 0.21f), 0f);
            MeshData thumb = Shapes.ChamferBox(wr * 0.6f, hl * 0.36f, wr * 0.75f, wr * 0.25f)
                .RotateZ(sign * 30f * Mathf.Deg2Rad)
                .Translate(sign * wr * 1.1f, -hl * 0.18f, wr * 0.35f);

            foreach (MeshData part in new[] { palm, fingers, thumb })
            {
                var weights = Uniform(part.VertexCount, idx);
                part.Transform(toRoot);
                asm.Add("skin", part, weights);
            }
        }

        // ---- Legs ----

        static void BuildLeg(HumanSkinnedAssembly asm, HumanBones bones, HumanProportions p, HumanLook look, Transform root, bool right)
        {
            Transform hip = right ? bones.rightHip : bones.leftHip;
            Transform knee = right ? bones.rightKnee : bones.leftKnee;
            Transform ankle = right ? bones.rightAnkle : bones.leftAnkle;

            AddSkinSegment(asm, bones, root, hip, knee, p.thighLength, p.thighR0, p.thighR1, p.thighR2, 14, false, 0.26f, Vector3.one);
            AddSkinSegment(asm, bones, root, knee, ankle, p.shinLength, p.shinR0, p.shinR1, p.shinR2, 14, false, 0.26f, Vector3.one);

            float legCoverage = look.bottomStyle == BottomStyle.Shorts ? 0.8f : 2f;
            float thighCoverage = Mathf.Min(legCoverage, 1f);
            AddClothSegment(asm, "bottom", bones, root, hip, p.thighLength, p.thighR0, p.thighR1, p.thighR2, 14, false, thighCoverage, 1.08f, Vector3.one);
            float shinCoverage = Mathf.Clamp01(legCoverage - 1f);
            if (shinCoverage > 0.02f)
                AddClothSegment(asm, "bottom", bones, root, knee, p.shinLength, p.shinR0, p.shinR1, p.shinR2, 14, false, shinCoverage, 1.08f, Vector3.one);

            BuildFoot(asm, bones, p, look, root, ankle);
        }

        static void BuildFoot(HumanSkinnedAssembly asm, HumanBones bones, HumanProportions p, HumanLook look, Transform root, Transform ankle)
        {
            int idx = bones.Index(ankle);
            Matrix4x4 toRoot = root.worldToLocalMatrix * ankle.localToWorldMatrix;

            MeshData foot = Shapes.ChamferBox(p.footWidth * 0.85f, p.ankleHeight * 0.8f, p.footLength * 0.82f, 0.018f)
                .Translate(0f, -p.ankleHeight * 0.4f, p.footLength * 0.1f);
            var footWeights = Uniform(foot.VertexCount, idx);
            foot.Transform(toRoot);
            asm.Add("skin", foot, footWeights);

            float toeRound = look.shoeStyle == ShoeStyle.Sneakers ? 0.03f : 0.018f;
            MeshData shoe = Shapes.ChamferBox(p.footWidth * 1.1f, p.ankleHeight * 1.05f, p.footLength * 1.06f, toeRound)
                .Translate(0f, -p.ankleHeight * 0.42f, p.footLength * 0.13f);
            var shoeWeights = Uniform(shoe.VertexCount, idx);
            shoe.Transform(toRoot);
            asm.Add("shoes", shoe, shoeWeights);

            if (look.shoeStyle == ShoeStyle.Boots)
            {
                float shaftH = p.ankleHeight + p.footWidth * 1.3f;
                MeshData shaft = Shapes.ChamferBox(p.footWidth * 0.95f, shaftH, p.footWidth, 0.015f)
                    .Translate(0f, shaftH * 0.5f - p.ankleHeight * 0.1f, -p.footLength * 0.1f);
                var shaftWeights = Uniform(shaft.VertexCount, idx);
                shaft.Transform(toRoot);
                asm.Add("shoes", shaft, shaftWeights);
            }
        }

        // ---- Head ----

        static void BuildHead(HumanSkinnedAssembly asm, HumanBones bones, HumanProportions p, HumanLook look, Transform root)
        {
            Transform head = bones.head;
            int idx = bones.Index(head);
            Matrix4x4 toRoot = root.worldToLocalMatrix * head.localToWorldMatrix;
            float R = p.headRadius;
            float Hh = p.headHeight;

            List<Vector2> profile = HeadProfile(R, Hh);
            MeshData skull = Shapes.Lathe(profile, 18);
            AddRigid(asm, "skin", skull, toRoot, idx);

            MeshData nose = Shapes.ChamferBox(R * 0.30f, Hh * 0.20f, R * 0.5f, R * 0.12f)
                .Translate(0f, -Hh * 0.02f, R * 0.92f);
            AddRigid(asm, "skin", nose, toRoot, idx);

            foreach (float sign in new[] { 1f, -1f })
            {
                MeshData ear = Shapes.ChamferBox(R * 0.16f, Hh * 0.24f, R * 0.36f, R * 0.06f)
                    .Translate(sign * R * 0.98f, Hh * 0.02f, 0f);
                AddRigid(asm, "skin", ear, toRoot, idx);

                MeshData eye = SphereMesh(R * 0.11f, 6, 10).Translate(sign * R * 0.34f, Hh * 0.06f, R * 0.84f);
                AddRigid(asm, "eyeWhite", eye, toRoot, idx);

                MeshData iris = SphereMesh(R * 0.05f, 5, 8).Translate(sign * R * 0.34f, Hh * 0.06f, R * 0.92f);
                AddRigid(asm, "iris", iris, toRoot, idx);

                MeshData brow = Shapes.ChamferBox(R * 0.30f, Hh * 0.045f, R * 0.05f, R * 0.02f)
                    .Translate(sign * R * 0.34f, Hh * 0.15f, R * 0.86f);
                AddRigid(asm, "hair", brow, toRoot, idx);
            }

            MeshData lips = Shapes.ChamferBox(R * 0.26f, Hh * 0.07f, R * 0.06f, R * 0.02f)
                .Translate(0f, -Hh * 0.30f, R * 0.90f);
            AddRigid(asm, "lips", lips, toRoot, idx);

            BuildHair(asm, bones, p, look, root);

            if (look.hasCap)
            {
                MeshData cap = ScaledShellFrom(profile, R, 1.22f, -Hh * 0.05f);
                AddRigid(asm, "cap", cap, toRoot, idx);
                MeshData brim = Shapes.ChamferBox(R * 0.85f, Hh * 0.03f, R * 0.55f, R * 0.02f)
                    .Translate(0f, Hh * 0.02f, R * 1.15f);
                AddRigid(asm, "cap", brim, toRoot, idx);
            }

            if (look.hasSunglasses)
            {
                foreach (float sign in new[] { 1f, -1f })
                {
                    MeshData lens = Shapes.ChamferBox(R * 0.30f, R * 0.20f, R * 0.06f, R * 0.03f)
                        .Translate(sign * R * 0.34f, Hh * 0.06f, R * 0.88f);
                    AddRigid(asm, "sunglasses", lens, toRoot, idx);
                }
                MeshData bridge = Shapes.ChamferBox(R * 0.18f, R * 0.03f, R * 0.04f, R * 0.01f)
                    .Translate(0f, Hh * 0.06f, R * 0.9f);
                AddRigid(asm, "sunglasses", bridge, toRoot, idx);
            }
        }

        static void BuildHair(HumanSkinnedAssembly asm, HumanBones bones, HumanProportions p, HumanLook look, Transform root)
        {
            if (look.hairStyle == HairStyle.Bald) return;
            Transform head = bones.head;
            int idx = bones.Index(head);
            Matrix4x4 toRoot = root.worldToLocalMatrix * head.localToWorldMatrix;
            float R = p.headRadius, Hh = p.headHeight;
            List<Vector2> baseProfile = HeadProfile(R, Hh);

            (float scale, float bottomY) = look.hairStyle switch
            {
                HairStyle.Buzz => (1.03f, Hh * 0.06f),
                HairStyle.Short => (1.08f, -Hh * 0.05f),
                HairStyle.Medium => (1.14f, -Hh * 0.20f),
                HairStyle.Long => (1.14f, -Hh * 0.20f),
                HairStyle.Ponytail => (1.12f, -Hh * 0.15f),
                _ => (1.08f, -Hh * 0.05f),
            };
            MeshData shell = ScaledShellFrom(baseProfile, R, scale, bottomY);
            AddRigid(asm, "hair", shell, toRoot, idx);

            if (look.hairStyle == HairStyle.Long || look.hairStyle == HairStyle.Ponytail)
            {
                MeshData drape = HairDrape(R, Hh, look.hairStyle == HairStyle.Ponytail);
                AddRigid(asm, "hair", drape, toRoot, idx);
            }
        }

        static MeshData HairDrape(float R, float Hh, bool ponytail)
        {
            List<Vector3> ctrl = ponytail
                ? new List<Vector3> { new Vector3(0f, -0.05f * Hh, -0.85f * R), new Vector3(0f, -0.35f * Hh, -0.95f * R), new Vector3(0f, -0.75f * Hh, -0.85f * R), new Vector3(0f, -1.15f * Hh, -0.6f * R) }
                : new List<Vector3> { new Vector3(0f, -0.05f * Hh, -0.85f * R), new Vector3(0f, -0.45f * Hh, -0.90f * R), new Vector3(0f, -0.95f * Hh, -0.75f * R), new Vector3(0f, -1.35f * Hh, -0.55f * R) };
            const int samples = 14;
            var path = new List<Vector3>(samples + 1);
            for (int i = 0; i <= samples; i++) path.Add(Shapes.CatmullRom(ctrl, (float)i / samples));
            float r0 = R * (ponytail ? 0.16f : 0.22f);
            float r1 = R * 0.04f;
            return Shapes.Sweep(path, t => Mathf.Lerp(r0, r1, t), 8);
        }

        static List<Vector2> HeadProfile(float R, float Hh)
        {
            return new List<Vector2>
            {
                new Vector2(0.06f * R, -0.50f * Hh),
                new Vector2(0.50f * R, -0.42f * Hh),
                new Vector2(0.82f * R, -0.28f * Hh),
                new Vector2(0.95f * R, -0.10f * Hh),
                new Vector2(1.00f * R, 0.04f * Hh),
                new Vector2(0.94f * R, 0.24f * Hh),
                new Vector2(0.55f * R, 0.42f * Hh),
                new Vector2(0f, 0.50f * Hh),
            };
        }

        /// <summary>A hair/cap shell: the head's own profile from `bottomY` up, scaled outward.</summary>
        static MeshData ScaledShellFrom(List<Vector2> headProfile, float R, float scale, float bottomY)
        {
            var pts = new List<Vector2>();
            float rim = RadiusAtY(headProfile, bottomY);
            pts.Add(new Vector2(Mathf.Max(0.0015f, rim * scale), bottomY));
            foreach (Vector2 v in headProfile)
            {
                if (v.y <= bottomY + 1e-5f) continue;
                pts.Add(new Vector2(Mathf.Max(0.0015f, v.x * scale), v.y));
            }
            return Shapes.Lathe(pts, 16);
        }

        static float RadiusAtY(List<Vector2> profile, float y)
        {
            for (int i = 0; i < profile.Count - 1; i++)
            {
                if (y >= profile[i].y && y <= profile[i + 1].y)
                    return Mathf.Lerp(profile[i].x, profile[i + 1].x, Mathf.InverseLerp(profile[i].y, profile[i + 1].y, y));
            }
            return profile[profile.Count - 1].x;
        }

        static MeshData SphereMesh(float radius, int rings, int segments)
        {
            var profile = new List<Vector2>(rings + 1);
            for (int i = 0; i <= rings; i++)
            {
                float a = Mathf.PI * i / rings;
                profile.Add(new Vector2(Mathf.Sin(a) * radius, -Mathf.Cos(a) * radius));
            }
            return Shapes.Lathe(profile, Mathf.Max(6, segments));
        }

        // ---- Shared segment/weight helpers ----

        static List<BoneWeight> Uniform(int count, int boneIndex)
        {
            var list = new List<BoneWeight>(count);
            var w = new BoneWeight { boneIndex0 = boneIndex, weight0 = 1f };
            for (int i = 0; i < count; i++) list.Add(w);
            return list;
        }

        static void AddRigid(HumanSkinnedAssembly asm, string slot, MeshData local, Matrix4x4 toRoot, int boneIndex)
        {
            var weights = Uniform(local.VertexCount, boneIndex);
            local.Transform(toRoot);
            asm.Add(slot, local, weights);
        }

        /// <summary>Radius at fraction t (0..1) along a 3-point taper: r0 at 0, r1 at 0.5, r2 at 1.</summary>
        static float RadiusAt(float t, float r0, float r1, float r2)
        {
            t = Mathf.Clamp01(t);
            return t <= 0.5f ? Mathf.Lerp(r0, r1, t * 2f) : Mathf.Lerp(r1, r2, (t - 0.5f) * 2f);
        }

        /// <summary>
        /// A tapered tube profile from the near bone (t=0) towards the far bone (t=1), built only up
        /// to `coverage` of the full length (for a sleeve or trouser leg that stops partway), always
        /// sampling the SAME taper curve as the full limb so the cut edge still reads as part of it.
        /// Returned bottom-to-top (ascending y), as <see cref="Shapes.Lathe"/> expects.
        /// </summary>
        static List<Vector2> LimbProfile(float length, float r0, float r1, float r2, bool upward, float coverage)
        {
            float cov = Mathf.Clamp(coverage, 0.02f, 1f);
            float farY = upward ? length * cov : -length * cov;
            float[] ts = { 0f, 0.15f, 0.5f, 0.85f, 1f };
            var pts = new List<Vector2>(ts.Length);
            foreach (float t0 in ts)
            {
                float r = RadiusAt(t0 * cov, r0, r1, r2);
                if (Mathf.Approximately(t0, 0.85f)) r *= 1.03f;
                pts.Add(new Vector2(Mathf.Max(0.0015f, r), t0 * farY));
            }
            if (farY < 0f) pts.Reverse();
            return pts;
        }

        static MeshData LimbMesh(float length, float r0, float r1, float r2, int segments, bool upward, float coverage = 1f)
        {
            return Shapes.Lathe(LimbProfile(length, r0, r1, r2, upward, coverage), Mathf.Max(6, segments));
        }

        /// <summary>
        /// A skin segment between two adjacent bones (torso, neck or a limb bone): a tapered tube
        /// authored in the near bone's rest local space, weighted fully to that bone except the last
        /// `blendFraction` of its length, which blends smoothly into the far (child) bone's weight so
        /// bending the joint doesn't crease the surface.
        /// </summary>
        static void AddSkinSegment(HumanSkinnedAssembly asm, HumanBones bones, Transform root, Transform near, Transform far,
            float length, float r0, float r1, float r2, int segments, bool upward, float blendFraction, Vector3 ellipseScale)
        {
            MeshData mesh = LimbMesh(length, r0, r1, r2, segments, upward);
            int nearIdx = bones.Index(near);
            int farIdx = bones.Index(far);
            float farY = upward ? length : -length;
            var weights = new List<BoneWeight>(mesh.VertexCount);
            for (int i = 0; i < mesh.VertexCount; i++)
            {
                float t = Mathf.Abs(farY) > 1e-6f ? Mathf.Clamp01(mesh.positions[i].y / farY) : 0f;
                float farW = t > (1f - blendFraction) ? Mathf.InverseLerp(1f - blendFraction, 1f, t) : 0f;
                weights.Add(new BoneWeight { boneIndex0 = nearIdx, weight0 = 1f - farW, boneIndex1 = farIdx, weight1 = farW });
            }
            Matrix4x4 m = (root.worldToLocalMatrix * near.localToWorldMatrix) * Matrix4x4.Scale(ellipseScale);
            mesh.Transform(m);
            asm.Add("skin", mesh, weights);
        }

        /// <summary>
        /// A clothing region covering part or all of a limb segment from the near bone: rigidly
        /// skinned to that one bone (fabric doesn't need the smooth per-vertex blend skin does) and
        /// inflated slightly outward so it reads as a separate layer over the skin beneath.
        /// </summary>
        static void AddClothSegment(HumanSkinnedAssembly asm, string slot, HumanBones bones, Transform root, Transform near,
            float length, float r0, float r1, float r2, int segments, bool upward, float coverage, float inflate, Vector3 ellipseScale)
        {
            if (coverage <= 0.02f) return;
            MeshData mesh = LimbMesh(length, r0 * inflate, r1 * inflate, r2 * inflate, segments, upward, coverage);
            int idx = bones.Index(near);
            var weights = Uniform(mesh.VertexCount, idx);
            Matrix4x4 m = (root.worldToLocalMatrix * near.localToWorldMatrix) * Matrix4x4.Scale(ellipseScale);
            mesh.Transform(m);
            asm.Add(slot, mesh, weights);
        }
    }
}
