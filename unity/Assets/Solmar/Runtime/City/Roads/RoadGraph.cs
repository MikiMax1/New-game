using System.Collections.Generic;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>
    /// The axis an edge runs along: Horizontal edges run along x at a constant z (their width
    /// extends in z); Vertical edges run along z at a constant x (their width extends in x). The
    /// generator only ever builds axis-aligned grids, so every edge is one or the other.
    /// </summary>
    public enum RoadOrientation
    {
        Horizontal,
        Vertical,
    }

    /// <summary>An intersection: a position and the edges that meet there.</summary>
    public sealed class RoadNode
    {
        public Vector2 Position;
        public readonly List<int> EdgeIds = new List<int>();
    }

    /// <summary>
    /// A street between two nodes: lane counts, parking, an optional planted median and a sidewalk
    /// width. Widths are in metres, built from the same lane and parking dimensions as the single
    /// street (Layout.LaneWidth, Layout.ParkingWidth).
    /// </summary>
    public sealed class RoadEdge
    {
        public int A, B;
        public RoadOrientation Orientation;
        public int LanesPerDirection = 1;
        public bool Parking = true;
        public float MedianWidth;
        public float SidewalkWidth = RoadWidths.DefaultSidewalk;

        /// <summary>Kerb-to-kerb half width of one carriageway (one direction of travel).</summary>
        public float CarriagewayHalfWidth => LanesPerDirection * RoadWidths.LaneWidth + (Parking ? RoadWidths.ParkingWidth : 0f);

        /// <summary>Half width of the whole road, centreline to kerb face: the carriageway plus half the median.</summary>
        public float HalfWidth => CarriagewayHalfWidth + MedianWidth * 0.5f;
    }

    /// <summary>
    /// A graph of streets: nodes (intersections) with a position, and edges (streets) with their own
    /// lane counts, parking and median. Every query needed to lay out road, pavement and building
    /// geometry from the graph lives here, so the mesh builders only ever read from it.
    /// </summary>
    public sealed class RoadGraph
    {
        public readonly List<RoadNode> Nodes = new List<RoadNode>();
        public readonly List<RoadEdge> Edges = new List<RoadEdge>();

        public int AddNode(Vector2 position)
        {
            Nodes.Add(new RoadNode { Position = position });
            return Nodes.Count - 1;
        }

        public int AddEdge(int a, int b, RoadOrientation orientation, int lanesPerDirection = 1, bool parking = true, float medianWidth = 0f, float sidewalkWidth = -1f)
        {
            var edge = new RoadEdge
            {
                A = a,
                B = b,
                Orientation = orientation,
                LanesPerDirection = Mathf.Max(1, lanesPerDirection),
                Parking = parking,
                MedianWidth = Mathf.Max(0f, medianWidth),
                SidewalkWidth = sidewalkWidth >= 0f ? sidewalkWidth : RoadWidths.DefaultSidewalk,
            };
            Edges.Add(edge);
            int id = Edges.Count - 1;
            Nodes[a].EdgeIds.Add(id);
            Nodes[b].EdgeIds.Add(id);
            return id;
        }

        /// <summary>The node at the other end of an edge from `nodeIndex`.</summary>
        public int OtherNode(RoadEdge e, int nodeIndex) => e.A == nodeIndex ? e.B : e.A;

        /// <summary>
        /// The half extent, in x, that a node's plate (and the vertical edges through it) needs: the
        /// widest vertical edge at the node, since a vertical edge's width runs in x. Zero at a node
        /// with no vertical edges (a dead end along x only).
        /// </summary>
        public float HalfExtentX(int nodeIndex) => MaxHalfWidth(nodeIndex, RoadOrientation.Vertical);

        /// <summary>The equivalent half extent in z, from the widest horizontal edge at the node.</summary>
        public float HalfExtentZ(int nodeIndex) => MaxHalfWidth(nodeIndex, RoadOrientation.Horizontal);

        float MaxHalfWidth(int nodeIndex, RoadOrientation orientation)
        {
            float w = 0f;
            foreach (int id in Nodes[nodeIndex].EdgeIds)
            {
                RoadEdge e = Edges[id];
                if (e.Orientation == orientation) w = Mathf.Max(w, e.HalfWidth);
            }
            return w;
        }

        /// <summary>
        /// The trim taken off the length of `edge` at `nodeIndex` by the intersection there: how far
        /// its road surface stops short of the node's own position.
        /// </summary>
        public float TrimAt(RoadEdge edge, int nodeIndex) => edge.Orientation == RoadOrientation.Horizontal ? HalfExtentX(nodeIndex) : HalfExtentZ(nodeIndex);

        /// <summary>The along-axis span of an edge (world x for Horizontal, world z for Vertical), before trimming.</summary>
        public void Span(RoadEdge edge, out float s0, out float s1, out float centre)
        {
            Vector2 pa = Nodes[edge.A].Position;
            Vector2 pb = Nodes[edge.B].Position;
            if (edge.Orientation == RoadOrientation.Horizontal)
            {
                s0 = Mathf.Min(pa.x, pb.x);
                s1 = Mathf.Max(pa.x, pb.x);
                centre = pa.y;
            }
            else
            {
                s0 = Mathf.Min(pa.y, pb.y);
                s1 = Mathf.Max(pa.y, pb.y);
                centre = pa.x;
            }
        }

        /// <summary>Which of an edge's two nodes sits at the lower end of its span, and which at the higher.</summary>
        public void Ends(RoadEdge edge, out int nodeAtMin, out int nodeAtMax)
        {
            Vector2 pa = Nodes[edge.A].Position;
            Vector2 pb = Nodes[edge.B].Position;
            float a = edge.Orientation == RoadOrientation.Horizontal ? pa.x : pa.y;
            float b = edge.Orientation == RoadOrientation.Horizontal ? pb.x : pb.y;
            if (a <= b) { nodeAtMin = edge.A; nodeAtMax = edge.B; }
            else { nodeAtMin = edge.B; nodeAtMax = edge.A; }
        }

        /// <summary>World (x, z) at (s, w) along an edge whose centreline is at `centre`: s along its length, w across it.</summary>
        public static Vector2 WorldAt(RoadEdge edge, float centre, float s, float w)
        {
            return edge.Orientation == RoadOrientation.Horizontal ? new Vector2(s, centre + w) : new Vector2(centre + w, s);
        }
    }
}
