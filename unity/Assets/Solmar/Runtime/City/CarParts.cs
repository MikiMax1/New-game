using System.Collections.Generic;
using UnityEngine;

namespace Solmar.City
{
    /// <summary>
    /// Small shape helpers for procedural cars that don't fit the generic body loft: the concave
    /// underside of a wheel arch, and a simple brake disc glimpsed behind the rim's spokes. Both are
    /// built directly (not lofted from a style) since they are plain constant-radius forms.
    /// </summary>
    static class CarParts
    {
        /// <summary>
        /// The dark cavity behind a wheel arch's cut-out: a semicircular strip of radius `radius`,
        /// swept along z by `zWidth`, centred on the wheel's axle-height centre and facing inward (so
        /// from outside the car it reads as the arch liner, not a hole through to the sky). Matches
        /// the circular arch cut in <see cref="Cars"/>'s body-bottom profile, which is also a
        /// semicircle about the same centre. Local frame: x forward, y up, z left; origin at the
        /// wheel centre.
        /// </summary>
        public static MeshData ArchLiner(float radius, float zWidth, int segments = 20)
        {
            var m = new MeshData();
            radius = Mathf.Max(0.01f, radius);
            float h = Mathf.Max(0.01f, zWidth) * 0.5f;
            for (int i = 0; i <= segments; i++)
            {
                float a = Mathf.PI * i / segments; // 0 at the trailing edge, PI at the leading edge, over the top
                float c = Mathf.Cos(a), sn = Mathf.Sin(a);
                var normal = new Vector3(-c, -sn, 0f); // faces back in towards the wheel
                float u = a * radius;
                m.AddVertex(new Vector3(c * radius, sn * radius, -h), normal, new Vector2(u, 0f));
                m.AddVertex(new Vector3(c * radius, sn * radius, h), normal, new Vector2(u, zWidth));
            }
            for (int i = 0; i < segments; i++)
            {
                int a = i * 2, b = a + 2;
                m.AddTriangle(a, a + 1, b);
                m.AddTriangle(a + 1, b + 1, b);
            }
            Shapes.FixWinding(m, 0, m.indices.Count);
            return m;
        }

        /// <summary>A plain brake disc band, a hint of hardware behind the rim's spokes.</summary>
        public static MeshData BrakeDisc(float radius, float thickness)
        {
            float h = Mathf.Max(0.002f, thickness) * 0.5f;
            float inner = radius * 0.42f;
            return Shapes.Lathe(new List<Vector2>
            {
                new Vector2(inner, h), new Vector2(radius, h), new Vector2(radius, -h), new Vector2(inner, -h),
            }, 22);
        }

        /// <summary>A short round exhaust tip, revolved about y like <see cref="Cars"/>'s tyres and rims.</summary>
        public static MeshData ExhaustTip(float radius, float length)
        {
            radius = Mathf.Max(0.01f, radius);
            length = Mathf.Max(0.02f, length);
            return Shapes.Lathe(new List<Vector2>
            {
                new Vector2(radius * 0.72f, 0f), new Vector2(radius, 0.012f), new Vector2(radius, length), new Vector2(radius * 0.82f, length),
            }, 16);
        }
    }
}
