using System.Collections.Generic;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Lighter versions of the street furniture for the whole city, where there are thousands of
    /// them: the same real dimensions as FurnitureParts' street lamp and signals, with fewer
    /// segments. Local frame as FurnitureParts: y up from the ground, arms reach towards +z.
    ///
    /// Each model is a list of parts by material slot, so it can be copied into a tile's combined
    /// meshes (<see cref="AppendTo"/>) or built into a mesh of its own with a submesh per slot.
    /// </summary>
    public sealed class CityProps
    {
        readonly List<string> slots = new List<string>();
        readonly List<MeshData> parts = new List<MeshData>();

        /// <summary>The material slots, in the order of the built mesh's submeshes.</summary>
        public IReadOnlyList<string> Slots => slots;

        CityProps Add(string slot, MeshData data)
        {
            int k = slots.IndexOf(slot);
            if (k < 0)
            {
                slots.Add(slot);
                parts.Add(new MeshData());
                k = slots.Count - 1;
            }
            parts[k].Append(data);
            return this;
        }

        /// <summary>Copies the model, placed by `placement`, into the mesh data `target` gives for each slot.</summary>
        public void AppendTo(System.Func<string, MeshData> target, Matrix4x4 placement)
        {
            for (int k = 0; k < slots.Count; k++)
            {
                MeshData copy = parts[k].Clone();
                copy.Transform(placement);
                target(slots[k]).Append(copy);
            }
        }

        /// <summary>A mesh of the model with a submesh per slot.</summary>
        public Mesh Build(string name)
        {
            var a = new Assembly();
            for (int k = 0; k < slots.Count; k++) a.Add(slots[k], parts[k]);
            return a.Build(name);
        }

        static List<Vector2> P(params float[] rz)
        {
            var list = new List<Vector2>(rz.Length / 2);
            for (int i = 0; i < rz.Length; i += 2) list.Add(new Vector2(rz[i], rz[i + 1]));
            return list;
        }

        /// <summary>A plain box (w × h × d, centred at x, y, z): six quads, too small for chamfers to show.</summary>
        static MeshData Box(float w, float h, float d, float x, float y, float z)
        {
            var m = new MeshData();
            float hx = w * 0.5f, hy = h * 0.5f, hz = d * 0.5f;
            var c = new Vector3(x, y, z);
            Vector3[] axes = { Vector3.right, Vector3.up, Vector3.forward };
            float[] half = { hx, hy, hz };
            for (int a = 0; a < 3; a++)
            {
                Vector3 u = axes[(a + 1) % 3] * half[(a + 1) % 3], v = axes[(a + 2) % 3] * half[(a + 2) % 3];
                foreach (float sign in new[] { 1f, -1f })
                {
                    Vector3 n = axes[a] * sign;
                    Vector3 f = c + n * half[a];
                    int first = m.indices.Count;
                    int i0 = m.AddVertex(f - u - v, n, Vector2.zero);
                    int i1 = m.AddVertex(f + u - v, n, new Vector2(1f, 0f));
                    int i2 = m.AddVertex(f + u + v, n, new Vector2(1f, 1f));
                    int i3 = m.AddVertex(f - u + v, n, new Vector2(0f, 1f));
                    m.AddTriangle(i0, i1, i2);
                    m.AddTriangle(i0, i2, i3);
                    Shapes.FixWinding(m, first, m.indices.Count);
                }
            }
            return m;
        }

        /// <summary>Cobra-head street lamp: base, tapered 8.5 m shaft, curved arm reaching 2.3 m, luminaire and lens.</summary>
        public static CityProps StreetLamp()
        {
            var a = new CityProps();
            a.Add("steel", Shapes.Lathe(P(0f, 0f, 0.22f, 0f, 0.22f, 0.05f, 0.15f, 0.4f, 0f, 0.45f), 6));
            a.Add("steel", Shapes.Lathe(P(0f, 0.4f, 0.1f, 0.4f, 0.062f, 8.5f, 0f, 8.58f), 6));
            a.Add("steel", Shapes.Tube(new[] { new Vector3(0f, 8.1f, 0f), new Vector3(0f, 8.62f, 0.28f), new Vector3(0f, 8.92f, 1.1f), new Vector3(0f, 9.02f, 2.25f) }, 0.042f, 6, 5));
            a.Add("housing", Box(0.32f, 0.12f, 0.72f, 0f, 9.02f, 2.4f));
            a.Add("lens", Box(0.26f, 0.012f, 0.5f, 0f, 8.955f, 2.45f));
            return a;
        }

        /// <summary>Traffic-signal mast-arm pole with an arm reaching `reach` metres towards +z at 6.4 m.</summary>
        public static CityProps SignalPole(float reach)
        {
            var a = new CityProps();
            a.Add("steel", Shapes.Lathe(P(0f, 0f, 0.28f, 0f, 0.28f, 0.06f, 0.18f, 0.5f, 0f, 0.55f), 6));
            a.Add("steel", Shapes.Lathe(P(0f, 0.5f, 0.15f, 0.5f, 0.1f, 6.9f, 0f, 7f), 6));
            a.Add("steel", Box(0.12f, 0.12f, reach, 0f, 6.4f, reach * 0.5f));
            return a;
        }

        /// <summary>
        /// The body of a three-section signal head facing +x (its lenses look along +x): housing
        /// with visors, and a backplate with a yellow border.
        /// </summary>
        public static CityProps SignalHead()
        {
            var a = new CityProps();
            a.Add("housing", Box(0.26f, 1.0f, 0.34f, 0f, 0f, 0f));
            a.Add("backplate", Box(0.02f, 1.24f, 0.56f, -0.14f, 0f, 0f));
            a.Add("border", Box(0.015f, 1.32f, 0.64f, -0.155f, 0f, 0f));
            for (int k = 0; k < 3; k++) a.Add("housing", Box(0.2f, 0.02f, 0.26f, 0.22f, 0.32f - k * 0.32f + 0.13f, 0f));
            return a;
        }

        /// <summary>The three lenses of a signal head (same frame as <see cref="SignalHead"/>): slots red, amber and green, top to bottom.</summary>
        public static CityProps SignalLenses()
        {
            var a = new CityProps();
            string[] lenses = { "red", "amber", "green" };
            for (int k = 0; k < 3; k++)
            {
                MeshData lens = Shapes.Extrude(Shapes.Circle(0.1f, 8), 0.02f);
                lens.RotateY(Mathf.PI / 2f).Translate(0.13f, 0.32f - k * 0.32f, 0f);
                a.Add(lenses[k], lens);
            }
            return a;
        }
    }
}
