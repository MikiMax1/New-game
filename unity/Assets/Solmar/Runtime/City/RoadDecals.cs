using System.Collections.Generic;
using Solmar.Rendering;
using UnityEngine;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar.City
{
    /// <summary>
    /// Road markings and puddles as HDRP decals projected onto the wet asphalt:
    ///   markings  double yellow centre line, dashed lane lines (3 m dash, 9 m gap), solid parking
    ///             lane edge lines, a continental crosswalk (0.6 m bars, 0.6 m gaps) and stop lines
    ///             1.2 m before it; worn paint (the decal texture's alpha)
    ///   puddles   standing water in the wheel paths and gutters: darker, flat, mirror-smooth
    /// </summary>
    public static class RoadDecals
    {
        public static GameObject Build(Transform parent, CityMaterials m, Rng random)
        {
            var root = new GameObject("Road decals");
            root.transform.SetParent(parent, false);
            float half = Layout.StreetHalfLength;

            // A decal projected straight down onto the road: centre (x, z), size along x and z.
            void Decal(string name, Material material, float x, float z, float sx, float sz, float yaw = 0f, float uvScaleX = 1f, float uvScaleY = 1f)
            {
                var go = new GameObject(name);
                go.transform.SetParent(root.transform, false);
                // Pointing straight down (local +z), centred 15 cm above the road: the box reaches
                // 10 cm below the centre's height, enough for the crown's fall across a stop line.
                go.transform.SetPositionAndRotation(new Vector3(x, Street.Height(x, z) + 0.15f, z), Quaternion.Euler(90f, yaw, 0f));
                var d = go.AddComponent<DecalProjector>();
                d.material = material;
                // Projector space: x and y across the decal, z the projection depth.
                d.size = new Vector3(sx, sz, 0.5f);
                d.pivot = Vector3.zero;
                d.uvScale = new Vector2(uvScaleX, uvScaleY);
                d.drawDistance = 400f;
                d.fadeFactor = 1f;
            }

            // Long lines in 20 m pieces (the paint texture tiles every metre along them).
            void Line(string name, Material material, float z, float width, float x0, float x1)
            {
                for (float x = x0; x < x1; x += 20f)
                {
                    float len = Mathf.Min(20f, x1 - x);
                    Decal(name, material, x + len / 2f, z, len, width, 0f, len, 1f);
                }
            }

            float cw0 = Layout.CrossingX - Layout.CrosswalkWidth / 2f;
            float cw1 = Layout.CrossingX + Layout.CrosswalkWidth / 2f;
            foreach (float s in new[] { -1f, 1f })
            {
                // Double yellow centre line (two 10 cm lines, 10 cm apart), broken by the crosswalk.
                Line("Centre line", m.DecalYellow, s * 0.12f, 0.1f, -half, cw0 - 1.2f);
                Line("Centre line", m.DecalYellow, s * 0.12f, 0.1f, cw1 + 1.2f, half);
                // Parking lane edge lines.
                Line("Edge line", m.DecalWhite, s * Layout.ParkingZ, 0.1f, -half, cw0 - 0.5f);
                Line("Edge line", m.DecalWhite, s * Layout.ParkingZ, 0.1f, cw1 + 0.5f, half);
                // Dashed lane lines: 3 m of paint every 12 m.
                for (float x = -half; x < half; x += 12f)
                {
                    if (x + 3f > cw0 - 2f && x < cw1 + 2f) continue;
                    Decal("Lane dash", m.DecalWhite, x + 1.5f, s * Layout.LaneWidth, 3f, 0.1f, 0f, 3f, 1f);
                }
            }
            // Continental crosswalk: bars parallel to the traffic, kerb to kerb.
            for (float z = -Layout.KerbZ + 0.6f; z < Layout.KerbZ - 0.4f; z += 1.2f)
            {
                Decal("Crosswalk bar", m.DecalWhite, Layout.CrossingX, z, Layout.CrosswalkWidth, 0.6f, 0f, 4f, 1f);
            }
            // Stop lines 1.2 m before the crosswalk, across the approach lanes (drive on the right).
            Decal("Stop line", m.DecalWhite, cw0 - 1.425f, Layout.ParkingZ / 2f + 0.1f, 0.45f, Layout.ParkingZ - 0.2f, 0f, 1f, 6f);
            Decal("Stop line", m.DecalWhite, cw1 + 1.425f, -Layout.ParkingZ / 2f - 0.1f, 0.45f, Layout.ParkingZ - 0.2f, 0f, 1f, 6f);

            // Puddles: in the wheel paths (where the ruts are) and along the gutters.
            var spots = new List<Vector4>();
            for (int k = 0; k < 34; k++)
            {
                float x = -70f + random.Next() * 110f;
                if (Mathf.Abs(x - Layout.CrossingX) < 3f) continue;
                int lane = (int)(random.Next() * 4f) % 4;
                float laneCentre = (lane < 2 ? -1f : 1f) * ((lane % 2) * Layout.LaneWidth + Layout.LaneWidth / 2f);
                float z = laneCentre + (random.Next() < 0.5f ? -0.9f : 0.9f);
                float len = 1.2f + random.Next() * 3.5f;
                spots.Add(new Vector4(x, z, len, 0.5f + random.Next() * 0.5f));
            }
            for (int k = 0; k < 16; k++)
            {
                float x = -80f + random.Next() * 150f;
                float z = (random.Next() < 0.5f ? -1f : 1f) * (Layout.KerbZ - 0.3f);
                spots.Add(new Vector4(x, z, 1.5f + random.Next() * 5f, 0.45f));
            }
            for (int k = 0; k < spots.Count; k++)
            {
                Vector4 s = spots[k];
                Decal("Puddle", m.PuddleDecals[k % m.PuddleDecals.Count], s.x, s.y, s.z, s.w * 1.4f, (random.Next() - 0.5f) * 20f);
            }
            return root;
        }
    }
}
