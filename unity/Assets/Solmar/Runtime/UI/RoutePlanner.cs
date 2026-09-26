using System.Collections.Generic;
using Solmar.City.Roads;
using UnityEngine;

namespace Solmar.UI
{
    /// <summary>
    /// A* shortest path over <see cref="RoadGraph"/>: node positions as the search space, edge
    /// length as cost, straight-line distance to the goal as the heuristic (admissible since it can
    /// only under-estimate a path made of straight edges). Returns the route as a polyline of node
    /// world positions (x, z) for the minimap and full map to draw.
    /// </summary>
    public static class RoutePlanner
    {
        /// <summary>The index of the node in <paramref name="graph"/> closest to <paramref name="worldXZ"/>, or -1 if the graph is empty.</summary>
        public static int NearestNode(RoadGraph graph, Vector2 worldXZ)
        {
            if (graph == null || graph.Nodes.Count == 0) return -1;
            int best = -1;
            float bestSq = float.PositiveInfinity;
            for (int i = 0; i < graph.Nodes.Count; i++)
            {
                float sq = (graph.Nodes[i].Position - worldXZ).sqrMagnitude;
                if (sq < bestSq) { bestSq = sq; best = i; }
            }
            return best;
        }

        /// <summary>Shortest route from the node nearest <paramref name="from"/> to the node nearest
        /// <paramref name="to"/>, as world (x, z) positions from start to goal; null if there is no
        /// path (or no graph).</summary>
        public static List<Vector2> FindRoute(RoadGraph graph, Vector2 from, Vector2 to)
        {
            if (graph == null || graph.Nodes.Count == 0) return null;
            int start = NearestNode(graph, from);
            int goal = NearestNode(graph, to);
            if (start < 0 || goal < 0) return null;
            if (start == goal) return new List<Vector2> { graph.Nodes[start].Position };

            int n = graph.Nodes.Count;
            var gScore = new float[n];
            var fScore = new float[n];
            var cameFrom = new int[n];
            var closed = new bool[n];
            for (int i = 0; i < n; i++) { gScore[i] = float.PositiveInfinity; fScore[i] = float.PositiveInfinity; cameFrom[i] = -1; }
            gScore[start] = 0f;
            fScore[start] = Heuristic(graph, start, goal);

            // Small graphs (a city's intersections, at most a few hundred) so a plain open list
            // scanned for the lowest fScore is simpler than a heap and plenty fast enough here.
            var open = new List<int> { start };

            while (open.Count > 0)
            {
                int currentIdx = 0;
                for (int i = 1; i < open.Count; i++) if (fScore[open[i]] < fScore[open[currentIdx]]) currentIdx = i;
                int current = open[currentIdx];
                if (current == goal) return Reconstruct(graph, cameFrom, current);
                open.RemoveAt(currentIdx);
                closed[current] = true;

                foreach (int edgeId in graph.Nodes[current].EdgeIds)
                {
                    RoadEdge edge = graph.Edges[edgeId];
                    int neighbour = graph.OtherNode(edge, current);
                    if (closed[neighbour]) continue;

                    float edgeLength = Vector2.Distance(graph.Nodes[current].Position, graph.Nodes[neighbour].Position);
                    if (!float.IsFinite(edgeLength)) continue;
                    float tentativeG = gScore[current] + edgeLength;
                    if (tentativeG < gScore[neighbour])
                    {
                        cameFrom[neighbour] = current;
                        gScore[neighbour] = tentativeG;
                        fScore[neighbour] = tentativeG + Heuristic(graph, neighbour, goal);
                        if (!open.Contains(neighbour)) open.Add(neighbour);
                    }
                }
            }
            return null; // no path
        }

        static float Heuristic(RoadGraph graph, int a, int b) => Vector2.Distance(graph.Nodes[a].Position, graph.Nodes[b].Position);

        static List<Vector2> Reconstruct(RoadGraph graph, int[] cameFrom, int current)
        {
            var path = new List<Vector2>();
            while (current >= 0)
            {
                path.Add(graph.Nodes[current].Position);
                current = cameFrom[current];
            }
            path.Reverse();
            return path;
        }
    }
}
