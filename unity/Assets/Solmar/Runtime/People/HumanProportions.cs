using UnityEngine;

namespace Solmar.People
{
    /// <summary>
    /// Metric measurements for one body, derived from a <see cref="HumanLook"/>: an 8-heads-tall
    /// adult skeleton (ratios taken from a 1.78 m reference figure and scaled to height), with build
    /// and gender only ever changing thickness and width, never bone lengths.
    /// </summary>
    public struct HumanProportions
    {
        public float height;
        public float hipHeight, kneeHeight, ankleHeight, shoulderHeight, neckLength, headHeight;
        public float thighLength, shinLength, torsoLength, upperTorsoLength, lowerTorsoLength;
        public float upperArmLength, forearmLength, handLength;
        public float footLength, footWidth;
        public float hipHalfWidth, shoulderHalfWidth, headRadius, neckRadius;

        // Radii (metres), already build/gender scaled.
        public float chestRadiusTop, chestRadiusMid, chestRadiusBottom;
        public float waistRadiusTop, waistRadiusMid, waistRadiusBottom;
        public float upperArmR0, upperArmR1, upperArmR2;
        public float forearmR0, forearmR1, forearmR2;
        public float thighR0, thighR1, thighR2;
        public float shinR0, shinR1, shinR2;

        public static HumanProportions From(HumanLook look)
        {
            float h = Mathf.Clamp(look.heightMeters, 1.2f, 2.3f);
            const float refH = 1.78f;
            float s = h / refH;

            float radius = look.build switch
            {
                HumanBuild.Slim => 0.86f,
                HumanBuild.Heavy => 1.28f,
                _ => 1f,
            };
            float shoulderMul = look.gender == HumanGender.Male ? 1.12f : 0.94f;
            float hipMul = look.gender == HumanGender.Male ? 0.94f : 1.10f;
            float bustMul = look.gender == HumanGender.Female ? 1.05f : 1f;

            var p = new HumanProportions
            {
                height = h,
                hipHeight = 0.5298f * h,
                kneeHeight = 0.2848f * h,
                ankleHeight = 0.03876f * h,
                shoulderHeight = 0.8180f * h,
                neckLength = 0.04494f * h,
                headHeight = 0.13708f * h,
                upperArmLength = 0.16292f * h,
                forearmLength = 0.14045f * h,
                handLength = 0.09551f * h,
                footLength = 0.14326f * h,
                footWidth = 0.05337f * h * radius,
                hipHalfWidth = 0.05618f * h * hipMul,
                shoulderHalfWidth = 0.10674f * h * shoulderMul,
                headRadius = 0.0534f * h,
                neckRadius = 0.0281f * h * (0.9f + 0.15f * (radius - 1f)),
            };
            p.thighLength = p.hipHeight - p.kneeHeight;
            p.shinLength = p.kneeHeight - p.ankleHeight;
            p.torsoLength = p.shoulderHeight - p.hipHeight;
            p.lowerTorsoLength = p.torsoLength * 0.52f;
            p.upperTorsoLength = p.torsoLength - p.lowerTorsoLength;

            float rBase = s * radius;
            p.waistRadiusBottom = 0.0730f * rBase * hipMul;
            p.waistRadiusMid = 0.0791f * rBase * Mathf.Lerp(hipMul, shoulderMul, 0.3f);
            p.waistRadiusTop = 0.0781f * rBase * Mathf.Lerp(hipMul, shoulderMul, 0.6f);
            p.chestRadiusBottom = p.waistRadiusTop;
            p.chestRadiusMid = 0.0871f * rBase * shoulderMul * bustMul;
            p.chestRadiusTop = 0.0989f * rBase * shoulderMul;

            p.upperArmR0 = 0.0309f * rBase * shoulderMul;
            p.upperArmR1 = 0.0281f * rBase * shoulderMul;
            p.upperArmR2 = 0.0225f * rBase;
            p.forearmR0 = 0.0225f * rBase;
            p.forearmR1 = 0.0197f * rBase;
            p.forearmR2 = 0.0169f * rBase;

            p.thighR0 = 0.0562f * rBase * hipMul;
            p.thighR1 = 0.0478f * rBase;
            p.thighR2 = 0.0348f * rBase;
            p.shinR0 = 0.0309f * rBase;
            p.shinR1 = 0.0258f * rBase;
            p.shinR2 = 0.0202f * rBase;
            return p;
        }
    }
}
