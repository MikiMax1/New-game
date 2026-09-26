using System.Collections.Generic;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>
    /// The crowned road cross-section, generalised from Street.cs for an edge of arbitrary width: a
    /// carriageway crowns gently from its own centre down to a gutter at each kerb face, and a
    /// planted median (when the edge has one) sits flat at kerb height between the two carriageways.
    /// `w` is the signed offset from the edge's own centreline, across its width.
    /// </summary>
    public static class RoadProfile
    {
        const float Crown = 0.09f;
        const float GutterWidth = 0.4f;

        /// <summary>Height of a carriageway of half width `half`, at an offset `cw` from its own centre (any range; folds to [0, half]).</summary>
        public static float CarriagewayHeight(float cw, float half)
        {
            half = Mathf.Max(0.6f, half);
            float d = half - Mathf.Abs(cw);
            float gutter = Mathf.Min(GutterWidth, half * 0.6f);
            if (d < gutter) return RoadWidths.GutterHeight * Mathf.Clamp01(d / gutter);
            float t = Mathf.Clamp01(Mathf.Abs(cw) / Mathf.Max(0.01f, half - gutter));
            return RoadWidths.GutterHeight + (Crown - RoadWidths.GutterHeight) * (1f - t * t);
        }

        /// <summary>
        /// Height of the road surface at offset `w` from the edge's centreline (w in
        /// [-edge.HalfWidth, edge.HalfWidth]), and whether that point falls in the median.
        /// </summary>
        public static float Height(RoadEdge edge, float w, out bool median)
        {
            float half = edge.CarriagewayHalfWidth;
            float m = edge.MedianWidth * 0.5f;
            median = m > 0f && Mathf.Abs(w) < m;
            if (median) return RoadWidths.KerbHeight;
            // No median: one crown for the whole road, peaking at the centreline. With a median,
            // each carriageway crowns on its own, peaking midway between the median and its kerb.
            if (m <= 0f) return CarriagewayHeight(w, half);
            float distFromMedian = Mathf.Abs(w) - m;
            float ownHalf = half * 0.5f;
            float cw = distFromMedian - ownHalf;
            return CarriagewayHeight(cw, ownHalf);
        }

        /// <summary>
        /// Height of the asphalt where an edge meets its junction plate: the crowned profile, and
        /// across the median (which stops there) the height of the median's gutters, which is the
        /// same as at a kerb face: <see cref="KerbFaceHeight"/>.
        /// </summary>
        public static float EndHeight(RoadEdge edge, float w)
        {
            float m = edge.MedianWidth * 0.5f;
            if (m > 0f && Mathf.Abs(w) < m) return KerbFaceHeight;
            return Height(edge, w, out _);
        }

        /// <summary>Height of the asphalt right at a kerb face (the bottom of the gutter).</summary>
        public const float KerbFaceHeight = 0f;

        /// <summary>Small undulation so the asphalt isn't perfectly flat (metres).</summary>
        public static float Undulation(float s, float w)
        {
            return (Mathf.PerlinNoise(s * 0.09f + 12.4f, w * 0.17f + 3.1f) - 0.5f) * 0.01f;
        }

        /// <summary>
        /// Offsets across one carriageway, from its inner edge (the centreline, or the median's
        /// side) to its kerb: both gutters sampled closely, the crown every `step` metres.
        /// </summary>
        public static List<float> CarriagewayStations(RoadEdge edge, float step)
        {
            float m = edge.MedianWidth * 0.5f;
            float half = edge.HalfWidth;
            var list = new List<float> { m };
            if (m > 0f) list.Add(m + GutterWidth);
            float from = m > 0f ? m + GutterWidth : m;
            float to = half - GutterWidth;
            int n = Mathf.Max(1, Mathf.CeilToInt((to - from) / Mathf.Max(0.3f, step)));
            for (int i = 1; i < n; i++) list.Add(from + (to - from) * i / n);
            list.Add(to);
            list.Add(half);
            return list;
        }
    }

    /// <summary>Offsets and heights across a whole edge, shared by the road surface and the junction plates so they meet exactly.</summary>
    public static class RoadSurfaceStations
    {
        /// <summary>Offsets across the whole edge, from the right kerb (-HalfWidth) to the left (+HalfWidth).</summary>
        public static List<float> Across(RoadEdge edge, float step)
        {
            List<float> side = RoadProfile.CarriagewayStations(edge, step);
            var list = new List<float>();
            for (int i = side.Count - 1; i >= 0; i--) list.Add(-side[i]);
            int start = side[0] <= 1e-4f ? 1 : 0;
            for (int i = start; i < side.Count; i++) list.Add(side[i]);
            return list;
        }

        /// <summary>Height of the road where it meets the plate (see <see cref="RoadProfile.EndHeight"/>).</summary>
        public static float EndHeight(RoadEdge edge, float w) => RoadProfile.EndHeight(edge, w);
    }
}
