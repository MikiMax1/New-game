using System.Collections.Generic;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>A street drawn as a polyline (curves as chains of short straight pieces), before it is cut into a graph.</summary>
    public sealed class RoadLine
    {
        public readonly List<Vector2> Points = new List<Vector2>();
        public RoadClass Class;
        public string Name = "";
        /// <summary>A loop: the last point joins back to the first.</summary>
        public bool Closed;

        public RoadLine(RoadClass roadClass, string name)
        {
            Class = roadClass;
            Name = name ?? "";
        }
    }

    /// <summary>
    /// Turns a set of street polylines into a planar road graph: every crossing becomes a node
    /// (streets drawn to overshoot the road they end on become T-junctions), then the graph is
    /// tidied so every junction has room for its plate: junctions closer than `junctionMerge`
    /// are merged into one, bends crowding a junction are straightened out, dead ends are trimmed
    /// back to the nearest junction, and only the largest connected network is kept, so every
    /// street reaches a junction or loops.
    /// </summary>
    public static class RoadPlanarizer
    {
        sealed class Edge
        {
            public int a, b;
            public RoadClass cls;
            public string name;
            public bool alive = true;
        }

        sealed class Net
        {
            public readonly List<Vector2> pos = new List<Vector2>();
            public readonly List<bool> nodeAlive = new List<bool>();
            public readonly List<List<int>> adj = new List<List<int>>();
            public readonly List<Edge> edges = new List<Edge>();
            readonly Dictionary<long, List<int>> grid = new Dictionary<long, List<int>>();
            const float Cell = 4f;
            const float Snap = 0.75f;

            public int Degree(int n) => adj[n].Count;

            static long Key(int i, int j) => ((long)i << 32) ^ (uint)j;

            public int GetNode(Vector2 p)
            {
                int ci = Mathf.FloorToInt(p.x / Cell), cj = Mathf.FloorToInt(p.y / Cell);
                for (int i = ci - 1; i <= ci + 1; i++)
                {
                    for (int j = cj - 1; j <= cj + 1; j++)
                    {
                        if (!grid.TryGetValue(Key(i, j), out List<int> list)) continue;
                        foreach (int n in list)
                        {
                            if (nodeAlive[n] && (pos[n] - p).sqrMagnitude < Snap * Snap) return n;
                        }
                    }
                }
                pos.Add(p);
                nodeAlive.Add(true);
                adj.Add(new List<int>());
                int id = pos.Count - 1;
                long k = Key(ci, cj);
                if (!grid.TryGetValue(k, out List<int> cell)) grid.Add(k, cell = new List<int>());
                cell.Add(id);
                return id;
            }

            public int Find(int a, int b)
            {
                foreach (int e in adj[a])
                {
                    Edge ed = edges[e];
                    if ((ed.a == a && ed.b == b) || (ed.a == b && ed.b == a)) return e;
                }
                return -1;
            }

            public void Link(int a, int b, RoadClass cls, string name)
            {
                if (a == b) return;
                int existing = Find(a, b);
                if (existing >= 0)
                {
                    if (cls > edges[existing].cls)
                    {
                        edges[existing].cls = cls;
                        edges[existing].name = name;
                    }
                    return;
                }
                edges.Add(new Edge { a = a, b = b, cls = cls, name = name });
                adj[a].Add(edges.Count - 1);
                adj[b].Add(edges.Count - 1);
            }

            public void Kill(int e)
            {
                Edge ed = edges[e];
                if (!ed.alive) return;
                ed.alive = false;
                adj[ed.a].Remove(e);
                adj[ed.b].Remove(e);
            }

            public int Other(int e, int n) => edges[e].a == n ? edges[e].b : edges[e].a;

            public float Length(int e) => Vector2.Distance(pos[edges[e].a], pos[edges[e].b]);
        }

        /// <summary>Builds the graph (edges get their class's cross-section) and returns it.</summary>
        public static RoadGraph Build(IList<RoadLine> lines, float junctionMerge = 32f)
        {
            var net = new Net();
            Cut(lines, net);
            RoadGraph graph = null;
            for (int round = 0; round < 8; round++)
            {
                for (int pass = 0; pass < 12; pass++)
                {
                    bool changed = false;
                    changed |= PruneDeadEnds(net);
                    changed |= MergeJunctions(net, junctionMerge);
                    changed |= Straighten(net);
                    if (!changed) break;
                }
                graph = Export(net, out List<int> netNode, out List<int> netEdge);
                // Fit the junctions, then make room wherever two plates would overlap: junctions
                // too close for both plates merge into one, and a bend inside a plate is removed.
                RoadJunctions.Compute(graph);
                bool fixedAny = false;
                for (int id = 0; id < graph.Edges.Count; id++)
                {
                    RoadEdge e = graph.Edges[id];
                    int ne = netEdge[id];
                    if (!net.edges[ne].alive) continue;
                    float len = graph.Length(e);
                    bool ja = graph.IsJunction(e.A), jb = graph.IsJunction(e.B);
                    float rawA = RawTrim(graph, e, e.A), rawB = RawTrim(graph, e, e.B);
                    if (ja && jb && rawA + rawB > len - 5f)
                    {
                        Contract(net, ne);
                        fixedAny = true;
                    }
                    else if (ja && !jb && rawA > len - 3f && Dissolve(net, netNode[e.B])) fixedAny = true;
                    else if (jb && !ja && rawB > len - 3f && Dissolve(net, netNode[e.A])) fixedAny = true;
                }
                if (!fixedAny) break;
            }
            return graph;
        }

        /// <summary>The trim a junction wants on an edge before any clamping to the edge's length.</summary>
        static float RawTrim(RoadGraph g, RoadEdge e, int node) => RoadJunctions.WantedTrim(g, e, node);

        /// <summary>Removes a bend (two-edge node), joining its neighbours with one straight edge. False if it isn't possible.</summary>
        static bool Dissolve(Net net, int v)
        {
            if (!net.nodeAlive[v] || net.Degree(v) != 2) return false;
            int e1 = net.adj[v][0], e2 = net.adj[v][1];
            int u = net.Other(e1, v), w = net.Other(e2, v);
            if (u == w || net.Find(u, w) >= 0) return false;
            Edge a = net.edges[e1], b = net.edges[e2];
            RoadClass cls = a.cls >= b.cls ? a.cls : b.cls;
            string name = a.cls >= b.cls ? a.name : b.name;
            net.Kill(e1);
            net.Kill(e2);
            net.nodeAlive[v] = false;
            net.Link(u, w, cls, name);
            return true;
        }

        struct Segment
        {
            public Vector2 p, q;
            public int line, index;
        }

        /// <summary>Splits every polyline at every crossing and adds the pieces to the net.</summary>
        static void Cut(IList<RoadLine> lines, Net net)
        {
            var segs = new List<Segment>();
            var lineSegCount = new List<int>();
            for (int l = 0; l < lines.Count; l++)
            {
                List<Vector2> pts = lines[l].Points;
                int count = lines[l].Closed ? pts.Count : pts.Count - 1;
                for (int i = 0; i < count; i++)
                {
                    Vector2 p = pts[i], q = pts[(i + 1) % pts.Count];
                    if ((q - p).sqrMagnitude < 1e-4f) continue;
                    segs.Add(new Segment { p = p, q = q, line = l, index = i });
                }
                lineSegCount.Add(count);
            }

            var cuts = new List<float>[segs.Count];
            for (int i = 0; i < segs.Count; i++) cuts[i] = new List<float> { 0f, 1f };

            const float cell = 60f;
            var grid = new Dictionary<long, List<int>>();
            for (int i = 0; i < segs.Count; i++)
            {
                Segment s = segs[i];
                int x0 = Mathf.FloorToInt(Mathf.Min(s.p.x, s.q.x) / cell), x1 = Mathf.FloorToInt(Mathf.Max(s.p.x, s.q.x) / cell);
                int z0 = Mathf.FloorToInt(Mathf.Min(s.p.y, s.q.y) / cell), z1 = Mathf.FloorToInt(Mathf.Max(s.p.y, s.q.y) / cell);
                for (int x = x0; x <= x1; x++)
                {
                    for (int z = z0; z <= z1; z++)
                    {
                        long k = ((long)x << 32) ^ (uint)z;
                        if (!grid.TryGetValue(k, out List<int> list)) grid.Add(k, list = new List<int>());
                        list.Add(i);
                    }
                }
            }
            var tested = new HashSet<long>();
            foreach (List<int> list in grid.Values)
            {
                for (int u = 0; u < list.Count; u++)
                {
                    for (int v = u + 1; v < list.Count; v++)
                    {
                        int i = list[u], j = list[v];
                        long key = i < j ? ((long)i << 32) | (uint)j : ((long)j << 32) | (uint)i;
                        if (!tested.Add(key)) continue;
                        Segment a = segs[i], b = segs[j];
                        if (a.line == b.line)
                        {
                            int n = lineSegCount[a.line];
                            int d = Mathf.Abs(a.index - b.index);
                            if (d <= 1 || (lines[a.line].Closed && d == n - 1)) continue;
                        }
                        if (Intersect(a.p, a.q, b.p, b.q, out float t, out float s))
                        {
                            cuts[i].Add(t);
                            cuts[j].Add(s);
                        }
                    }
                }
            }

            for (int i = 0; i < segs.Count; i++)
            {
                List<float> ts = cuts[i];
                ts.Sort();
                int prev = -1;
                foreach (float t in ts)
                {
                    int node = net.GetNode(Vector2.Lerp(segs[i].p, segs[i].q, t));
                    if (prev >= 0 && prev != node) net.Link(prev, node, lines[segs[i].line].Class, lines[segs[i].line].Name);
                    prev = node;
                }
            }
        }

        /// <summary>Proper crossing of segments p→q and r→s (endpoints included): the parameters along each.</summary>
        static bool Intersect(Vector2 p, Vector2 q, Vector2 r, Vector2 s, out float t, out float u)
        {
            t = u = 0f;
            Vector2 d1 = q - p, d2 = s - r;
            float denom = d1.x * d2.y - d1.y * d2.x;
            if (Mathf.Abs(denom) < 1e-6f) return false;
            Vector2 w = r - p;
            t = (w.x * d2.y - w.y * d2.x) / denom;
            u = (w.x * d1.y - w.y * d1.x) / denom;
            const float eps = 1e-5f;
            if (t < -eps || t > 1f + eps || u < -eps || u > 1f + eps) return false;
            t = Mathf.Clamp01(t);
            u = Mathf.Clamp01(u);
            return true;
        }

        static bool PruneDeadEnds(Net net)
        {
            bool changed = false;
            var stack = new Stack<int>();
            for (int n = 0; n < net.pos.Count; n++)
            {
                if (net.nodeAlive[n] && net.Degree(n) <= 1) stack.Push(n);
            }
            while (stack.Count > 0)
            {
                int n = stack.Pop();
                if (!net.nodeAlive[n]) continue;
                if (net.Degree(n) == 1)
                {
                    int e = net.adj[n][0];
                    int other = net.Other(e, n);
                    net.Kill(e);
                    if (net.Degree(other) <= 1) stack.Push(other);
                }
                if (net.Degree(n) == 0)
                {
                    net.nodeAlive[n] = false;
                    changed = true;
                }
            }
            return changed;
        }

        /// <summary>Merges junctions (three or more edges) joined by an edge shorter than `limit` into one node at their midpoint.</summary>
        static bool MergeJunctions(Net net, float limit)
        {
            bool changed = false;
            while (true)
            {
                int best = -1;
                float bestLen = limit;
                for (int e = 0; e < net.edges.Count; e++)
                {
                    Edge ed = net.edges[e];
                    if (!ed.alive || net.Degree(ed.a) < 3 || net.Degree(ed.b) < 3) continue;
                    float len = net.Length(e);
                    if (len < bestLen)
                    {
                        bestLen = len;
                        best = e;
                    }
                }
                if (best < 0) return changed;
                Contract(net, best);
                changed = true;
            }
        }

        /// <summary>Collapses an edge: its B node is folded into its A node, which moves to the midpoint.</summary>
        static void Contract(Net net, int e)
        {
            Edge ed = net.edges[e];
            int keep = ed.a, gone = ed.b;
            net.Kill(e);
            net.pos[keep] = (net.pos[keep] + net.pos[gone]) * 0.5f;
            foreach (int other in new List<int>(net.adj[gone]))
            {
                Edge o = net.edges[other];
                int far = net.Other(other, gone);
                net.Kill(other);
                if (far != keep) net.Link(keep, far, o.cls, o.name);
            }
            net.nodeAlive[gone] = false;
        }

        /// <summary>
        /// Removes bends (two-edge nodes) that crowd a junction or make a tiny piece of road,
        /// replacing their two edges with one straight edge, when the bend is gentle.
        /// </summary>
        static bool Straighten(Net net)
        {
            bool changed = false;
            for (int v = 0; v < net.pos.Count; v++)
            {
                if (!net.nodeAlive[v] || net.Degree(v) != 2) continue;
                int e1 = net.adj[v][0], e2 = net.adj[v][1];
                int u = net.Other(e1, v), w = net.Other(e2, v);
                if (u == w || net.Find(u, w) >= 0) continue;
                float l1 = net.Length(e1), l2 = net.Length(e2);
                Vector2 d1 = RoadGraph.SafeNormal(net.pos[v] - net.pos[u]);
                Vector2 d2 = RoadGraph.SafeNormal(net.pos[w] - net.pos[v]);
                float turn = Mathf.Acos(Mathf.Clamp(Vector2.Dot(d1, d2), -1f, 1f)) * Mathf.Rad2Deg;
                bool tiny = l1 < 4f || l2 < 4f;
                bool crowding = (net.Degree(u) >= 3 && l1 < 24f) || (net.Degree(w) >= 3 && l2 < 24f);
                if (!(tiny && turn < 60f) && !(crowding && turn < 35f)) continue;
                Edge a = net.edges[e1], b = net.edges[e2];
                RoadClass cls = a.cls >= b.cls ? a.cls : b.cls;
                string name = a.cls >= b.cls ? a.name : b.name;
                net.Kill(e1);
                net.Kill(e2);
                net.nodeAlive[v] = false;
                net.Link(u, w, cls, name);
                changed = true;
            }
            return changed;
        }

        static RoadGraph Export(Net net, out List<int> netNode, out List<int> netEdge)
        {
            netNode = new List<int>();
            netEdge = new List<int>();
            // Keep the largest connected network.
            int n = net.pos.Count;
            var comp = new int[n];
            for (int i = 0; i < n; i++) comp[i] = -1;
            int bestComp = -1, bestSize = 0, compCount = 0;
            for (int i = 0; i < n; i++)
            {
                if (!net.nodeAlive[i] || comp[i] >= 0 || net.Degree(i) == 0) continue;
                int size = 0;
                var stack = new Stack<int>();
                stack.Push(i);
                comp[i] = compCount;
                while (stack.Count > 0)
                {
                    int x = stack.Pop();
                    size++;
                    foreach (int e in net.adj[x])
                    {
                        int y = net.Other(e, x);
                        if (comp[y] >= 0) continue;
                        comp[y] = compCount;
                        stack.Push(y);
                    }
                }
                if (size > bestSize)
                {
                    bestSize = size;
                    bestComp = compCount;
                }
                compCount++;
            }

            var graph = new RoadGraph();
            var map = new int[n];
            for (int i = 0; i < n; i++)
            {
                map[i] = -1;
                if (net.nodeAlive[i] && comp[i] == bestComp && net.Degree(i) > 0)
                {
                    map[i] = graph.AddNode(net.pos[i]);
                    netNode.Add(i);
                }
            }
            for (int k = 0; k < net.edges.Count; k++)
            {
                Edge e = net.edges[k];
                if (!e.alive || map[e.a] < 0 || map[e.b] < 0) continue;
                graph.AddEdge(map[e.a], map[e.b], e.cls, e.name);
                netEdge.Add(k);
            }
            return graph;
        }
    }
}
