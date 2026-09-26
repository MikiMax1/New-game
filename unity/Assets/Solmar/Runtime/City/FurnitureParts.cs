using System.Collections.Generic;
using UnityEngine;

namespace Solmar.City
{
    /// <summary>
    /// Parametric street furniture modelled from real dimensions. Each builder returns an Assembly:
    /// mesh data per material slot, built into one mesh with a submesh per slot. Local frame: y up
    /// from the ground at 0; things that reach over the road (lamp arms, signal mast arms) reach
    /// towards +z.
    /// </summary>
    public static class FurnitureParts
    {
        static List<Vector2> P(params float[] rz)
        {
            var list = new List<Vector2>(rz.Length / 2);
            for (int i = 0; i < rz.Length; i += 2) list.Add(new Vector2(rz[i], rz[i + 1]));
            return list;
        }

        static MeshData Box(float w, float h, float d, float c, float x, float y, float z)
        {
            return Shapes.ChamferBox(w, h, d, c).Translate(x, y, z);
        }

        /// <summary>
        /// LED cobra-head street lamp: anchor-base shroud, tapered 8.5 m galvanised shaft, a curved mast
        /// arm reaching 2.3 m over the road and the luminaire with its lens.
        /// </summary>
        public static Assembly StreetLamp()
        {
            var a = new Assembly();
            a.Add("steel", Shapes.Lathe(P(0f, 0f, 0.25f, 0f, 0.25f, 0.04f, 0.21f, 0.08f, 0.17f, 0.42f, 0.12f, 0.48f, 0f, 0.48f), 24));
            a.Add("steel", Shapes.Lathe(P(0f, 0.45f, 0.105f, 0.45f, 0.1f, 1.2f, 0.062f, 8.5f, 0.05f, 8.56f, 0f, 8.6f), 20));
            a.Add("steel", Shapes.Tube(new[] { new Vector3(0f, 8.1f, 0f), new Vector3(0f, 8.62f, 0.28f), new Vector3(0f, 8.92f, 1.1f), new Vector3(0f, 9.02f, 2.25f) }, 0.042f, 48, 12));
            // Luminaire: a teardrop side profile (z, y) extruded across its 0.32 m width.
            MeshData head = Shapes.Extrude(P(0f, -0.02f, 0.08f, 0.06f, 0.3f, 0.1f, 0.58f, 0.085f, 0.74f, 0.035f, 0.73f, -0.02f, 0.45f, -0.04f, 0.08f, -0.035f), 0.32f);
            // Extruded along +z from an (x, y) outline: turn it so the outline's x runs along +z.
            head.RotateY(-Mathf.PI / 2f).Translate(0.16f, 9.0f, 2.12f);
            a.Add("housing", head);
            a.Add("lens", Box(0.26f, 0.012f, 0.5f, 0.004f, 0f, 8.955f, 2.47f));
            return a;
        }

        /// <summary>Traffic-signal mast-arm pole with an arm reaching `reach` metres towards +z.</summary>
        public static Assembly SignalPole(float reach)
        {
            var a = new Assembly();
            a.Add("steel", Shapes.Lathe(P(0f, 0f, 0.3f, 0f, 0.3f, 0.05f, 0.2f, 0.1f, 0.19f, 0.55f, 0f, 0.55f), 24));
            a.Add("steel", Shapes.Lathe(P(0f, 0.5f, 0.16f, 0.5f, 0.15f, 1.5f, 0.11f, 6.9f, 0.08f, 6.95f, 0f, 7f), 20));
            a.Add("steel", Shapes.Tube(new[] { new Vector3(0f, 6.35f, 0.1f), new Vector3(0f, 6.42f, reach * 0.5f), new Vector3(0f, 6.5f, reach) }, 0.075f, 48, 12));
            a.Add("steel", Box(0.02f, 0.5f, 0.45f, 0.004f, 0f, 6.1f, 0.3f));
            return a;
        }

        /// <summary>
        /// Three-section vehicle signal head facing +x: housing, backplate with a retroreflective
        /// border, visors, and the three lenses (red, amber, green) in their own slots.
        /// </summary>
        public static Assembly SignalHead()
        {
            var a = new Assembly();
            a.Add("housing", Shapes.ChamferBox(0.24f, 1.02f, 0.34f, 0.03f));
            a.Add("backplate", Box(0.015f, 1.3f, 0.56f, 0.005f, -0.13f, 0f, 0f));
            a.Add("border", Box(0.012f, 1.38f, 0.64f, 0.004f, -0.145f, 0f, 0f));
            string[] lenses = { "red", "amber", "green" };
            for (int k = 0; k < 3; k++)
            {
                float y = 0.32f - k * 0.32f;
                MeshData lens = Shapes.Extrude(Shapes.Circle(0.1f, 24), 0.015f);
                lens.RotateY(Mathf.PI / 2f).Translate(0.12f, y, 0f);
                a.Add(lenses[k], lens);
                // Visor: a hood over the lens, open at the bottom (a C-shaped outline, extruded).
                var hood = Shapes.Circle(0.13f, 16, -0.35f, Mathf.PI + 0.35f);
                var inner = Shapes.Circle(0.12f, 16, -0.35f, Mathf.PI + 0.35f);
                inner.Reverse();
                hood.AddRange(inner);
                MeshData visor = Shapes.Extrude(hood, 0.22f);
                visor.RotateY(Mathf.PI / 2f).Translate(0.12f, y, 0f);
                a.Add("housing", visor);
            }
            return a;
        }

        /// <summary>Pedestrian signal head facing +x: housing, lit face, egg-crate visor.</summary>
        public static Assembly PedestrianHead()
        {
            var a = new Assembly();
            a.Add("housing", Shapes.ChamferBox(0.2f, 0.46f, 0.46f, 0.02f));
            a.Add("face", Box(0.01f, 0.34f, 0.34f, 0.003f, 0.1f, 0f, 0f));
            a.Add("housing", Box(0.12f, 0.02f, 0.44f, 0.004f, 0.16f, 0.2f, 0f));
            return a;
        }

        /// <summary>US-style fire hydrant: flanged base, barrel, bonnet, nut, two hose outlets and a pumper.</summary>
        public static Assembly Hydrant()
        {
            var a = new Assembly();
            a.Add("paint", Shapes.Lathe(P(0f, 0f, 0.17f, 0f, 0.17f, 0.045f, 0.125f, 0.07f, 0.112f, 0.1f, 0.11f, 0.56f, 0.132f, 0.58f, 0.132f, 0.63f, 0.1f, 0.69f, 0.045f, 0.745f, 0f, 0.75f), 28));
            a.Add("caps", Shapes.Lathe(P(0f, 0.74f, 0.034f, 0.74f, 0.034f, 0.8f, 0f, 0.8f), 5));
            void Outlet(float r, float len, float y, float yaw)
            {
                MeshData g = Shapes.Lathe(P(0f, 0f, r, 0f, r, len * 0.7f, r * 1.12f, len * 0.72f, r * 1.12f, len, 0f, len), 20);
                // Lay it along +x, then turn it to face its direction.
                g.RotateZ(-Mathf.PI / 2f).RotateY(yaw).Translate(0f, y, 0f);
                a.Add("caps", g);
            }
            Outlet(0.045f, 0.2f, 0.42f, 0f);
            Outlet(0.045f, 0.2f, 0.42f, Mathf.PI);
            Outlet(0.07f, 0.2f, 0.36f, -Mathf.PI / 2f);
            return a;
        }

        /// <summary>A litter bin: tapered steel drum with a rim and a lid held over the opening.</summary>
        public static Assembly LitterBin()
        {
            var a = new Assembly();
            a.Add("body", Shapes.Lathe(P(0f, 0.02f, 0.26f, 0.02f, 0.3f, 0.8f, 0.315f, 0.82f, 0.315f, 0.86f, 0f, 0.86f), 28));
            a.Add("lid", Shapes.Lathe(P(0f, 0.9f, 0.28f, 0.9f, 0.32f, 0.9f, 0.32f, 0.92f, 0.3f, 0.93f, 0.2f, 0.97f, 0f, 0.98f), 28));
            for (int k = 0; k < 4; k++)
            {
                float r = k * Mathf.PI / 2f;
                a.Add("lid", Box(0.03f, 0.06f, 0.03f, 0.005f, Mathf.Cos(r) * 0.28f, 0.88f, Mathf.Sin(r) * 0.28f));
            }
            return a;
        }

        /// <summary>Concrete Jersey barrier (F-shape profile, 0.81 m high, 0.61 m base), 3.8 m along x.</summary>
        public static Assembly JerseyBarrier()
        {
            var outline = P(-0.305f, 0f, 0.305f, 0f, 0.305f, 0.075f, 0.179f, 0.255f, 0.075f, 0.81f, -0.075f, 0.81f, -0.179f, 0.255f, -0.305f, 0.075f);
            MeshData g = Shapes.Extrude(outline, 3.8f);
            // Profile (z, y) extruded along x.
            g.RotateY(-Mathf.PI / 2f).Translate(1.9f, 0f, 0f);
            return new Assembly().Add("concrete", g);
        }

        /// <summary>Channelizer drum: orange body with two retroreflective white bands on a rubber base.</summary>
        public static Assembly Drum()
        {
            var a = new Assembly();
            a.Add("rubber", Shapes.Lathe(P(0f, 0f, 0.4f, 0f, 0.4f, 0.04f, 0.3f, 0.08f, 0f, 0.08f), 24));
            float R(float y) => 0.28f - y * 0.04f;
            (float, float, string)[] bands = { (0.08f, 0.28f, "orange"), (0.28f, 0.43f, "white"), (0.43f, 0.56f, "orange"), (0.56f, 0.71f, "white"), (0.71f, 0.96f, "orange") };
            foreach ((float y0, float y1, string slot) in bands)
            {
                a.Add(slot, Shapes.Lathe(P(R(y0), y0, R(y0) + 0.008f, y0 + 0.01f, R(y1) + 0.008f, y1 - 0.01f, R(y1), y1), 24));
            }
            a.Add("orange", Shapes.Lathe(P(0.24f, 0.96f, 0.2f, 1.0f, 0.06f, 1.02f, 0f, 1.02f), 24));
            return a;
        }

        /// <summary>Traffic cone, 0.72 m, two white bands, square rubber base.</summary>
        public static Assembly Cone()
        {
            var a = new Assembly();
            a.Add("rubber", Box(0.38f, 0.035f, 0.38f, 0.01f, 0f, 0.0175f, 0f));
            float R(float y) => 0.15f - y / 0.72f * 0.13f;
            (float, float, string)[] bands = { (0.035f, 0.3f, "orange"), (0.3f, 0.42f, "white"), (0.42f, 0.5f, "orange"), (0.5f, 0.58f, "white"), (0.58f, 0.72f, "orange") };
            foreach ((float y0, float y1, string slot) in bands)
            {
                a.Add(slot, y1 >= 0.72f ? Shapes.Lathe(P(R(y0), y0, R(y1), y1, 0f, 0.72f), 20) : Shapes.Lathe(P(R(y0), y0, R(y1), y1), 20));
            }
            return a;
        }

        /// <summary>Cast-iron cover (manhole or valve) flush in the surface: a disc with a rim and ribs.</summary>
        public static Assembly Cover(float radius)
        {
            var a = new Assembly();
            a.Add("iron", Shapes.Lathe(P(0f, 0f, radius + 0.02f, 0f, radius, 0.012f, radius - 0.02f, 0.012f, radius - 0.03f, 0.006f, 0f, 0.006f), 40));
            for (int k = -3; k <= 3; k++) a.Add("iron", Box(radius * 1.5f, 0.006f, 0.02f, 0.002f, 0f, 0.012f, k * radius * 0.2f));
            return a;
        }

        /// <summary>Storm-drain grate in the gutter: frame and bars, 0.95 × 0.5 m.</summary>
        public static Assembly DrainGrate()
        {
            var a = new Assembly();
            a.Add("iron", Box(0.95f, 0.02f, 0.5f, 0.005f, 0f, 0.01f, 0f));
            for (int k = 0; k < 9; k++) a.Add("iron", Box(0.85f, 0.03f, 0.025f, 0.004f, 0f, 0.02f, -0.19f + k * 0.0475f));
            return a;
        }

        /// <summary>Parking pay station on a plinth, screen facing +z.</summary>
        public static Assembly PayStation()
        {
            var a = new Assembly();
            a.Add("body", Box(0.34f, 0.1f, 0.3f, 0.01f, 0f, 0.05f, 0f));
            a.Add("body", Box(0.32f, 1.45f, 0.26f, 0.03f, 0f, 0.8f, 0f));
            a.Add("body", Box(0.36f, 0.06f, 0.3f, 0.02f, 0f, 1.53f, 0.02f));
            a.Add("screen", Box(0.18f, 0.12f, 0.01f, 0.003f, 0f, 1.25f, 0.13f));
            return a;
        }

        /// <summary>A sign on a square post: face towards +z at 2.4 m with a border plate behind.</summary>
        public static Assembly SignPost(float width, float height)
        {
            var a = new Assembly();
            a.Add("post", Box(0.05f, 3f, 0.05f, 0.004f, 0f, 1.5f, 0f));
            a.Add("face", Box(width, height, 0.004f, 0.002f, 0f, 2.4f, 0.034f));
            a.Add("border", Box(width + 0.04f, height + 0.04f, 0.004f, 0.002f, 0f, 2.4f, 0.029f));
            return a;
        }

        /// <summary>A diamond work-zone sign on a folding stand, face towards +z.</summary>
        public static Assembly WorkSign()
        {
            var a = new Assembly();
            List<Vector2> Diamond(float s) => P(0f, -s, s, 0f, 0f, s, -s, 0f);
            a.Add("face", Shapes.Extrude(Diamond(0.55f), 0.008f).Translate(0f, 1.35f, 0.03f));
            a.Add("border", Shapes.Extrude(Diamond(0.6f), 0.008f).Translate(0f, 1.35f, 0.02f));
            foreach (float s in new[] { -1f, 1f })
            {
                a.Add("stand", Shapes.Tube(new[] { new Vector3(s * 0.05f, 0.8f, 0f), new Vector3(s * 0.45f, 0f, s * 0.02f) }, 0.015f, 8, 6));
                a.Add("stand", Shapes.Tube(new[] { new Vector3(0f, 0.8f, 0f), new Vector3(s * 0.05f, 0f, -0.45f) }, 0.015f, 8, 6));
            }
            a.Add("stand", Shapes.Tube(new[] { new Vector3(0f, 0.75f, 0.01f), new Vector3(0f, 1.8f, 0.01f) }, 0.02f, 8, 6));
            return a;
        }
    }
}
