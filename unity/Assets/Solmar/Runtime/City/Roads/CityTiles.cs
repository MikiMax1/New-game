using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Collects the city's geometry by 200 m tile, so each tile is one mesh per material and the
    /// camera culls whole tiles: surfaces (roads, pavements, kerbs, ground) are MeshData per name
    /// and material, buildings one MeshBuilder per tile (a submesh per material) with a simple
    /// collision mesh of their footprints beside it.
    ///
    /// Solid surfaces are static, so <see cref="CityColliders"/> gives them mesh colliders in play
    /// mode; road markings, leaves and street furniture are not static, so they get none (furniture
    /// brings its own capsule colliders). Each tile's markings, street
    /// furniture and foliage sit in their own LOD groups that stop drawing them in the distance.
    /// </summary>
    public sealed class CityTiles
    {
        public const float Size = 200f;

        /// <summary>How a surface is rendered and collided with.</summary>
        public enum Layer
        {
            /// <summary>Static, casts shadows, gets a collider.</summary>
            Solid,
            /// <summary>Static, collides, casts no shadows (flat ground).</summary>
            Ground,
            /// <summary>Not static (no collider), no shadows, culled beyond a few hundred metres: road markings.</summary>
            Marking,
            /// <summary>Not static (no collider), casts shadows, culled far away: leaves and fronds.</summary>
            Foliage,
            /// <summary>Not static (it brings its own simple colliders), casts shadows, culled beyond a kilometre or so: street furniture combined per tile.</summary>
            Prop,
        }

        sealed class Part
        {
            public string name;
            public Material material;
            public Layer layer;
            public MeshData data = new MeshData();
        }

        sealed class Tile
        {
            public int i, j;
            public readonly Dictionary<(string, Material), Part> parts = new Dictionary<(string, Material), Part>();
            public readonly List<Part> order = new List<Part>();
            public MeshBuilder buildings;
            public MeshData collision;
            public Transform root, markings, props, foliage;
        }

        readonly Dictionary<long, Tile> tiles = new Dictionary<long, Tile>();
        readonly Transform parent;

        public CityTiles(Transform parent)
        {
            this.parent = parent;
        }

        static long Key(int i, int j) => ((long)i << 32) ^ (uint)j;

        Tile TileAt(Vector2 at)
        {
            int i = Mathf.FloorToInt(at.x / Size), j = Mathf.FloorToInt(at.y / Size);
            long k = Key(i, j);
            if (!tiles.TryGetValue(k, out Tile t))
            {
                t = new Tile { i = i, j = j };
                tiles.Add(k, t);
            }
            return t;
        }

        /// <summary>The mesh data for a named surface of a material in the tile containing `at`.</summary>
        public MeshData Surface(Vector2 at, string name, Material material, Layer layer = Layer.Solid)
        {
            Tile t = TileAt(at);
            var key = (name, material);
            if (!t.parts.TryGetValue(key, out Part p))
            {
                p = new Part { name = name, material = material, layer = layer };
                t.parts.Add(key, p);
                t.order.Add(p);
            }
            return p.data;
        }

        /// <summary>The building builder of the tile containing `at`.</summary>
        public MeshBuilder Buildings(Vector2 at)
        {
            Tile t = TileAt(at);
            if (t.buildings == null) t.buildings = new MeshBuilder("Buildings");
            return t.buildings;
        }

        /// <summary>The (invisible) collision mesh of the buildings in the tile containing `at`.</summary>
        public MeshData BuildingCollision(Vector2 at)
        {
            Tile t = TileAt(at);
            if (t.collision == null) t.collision = new MeshData();
            return t.collision;
        }

        /// <summary>The GameObject of the tile containing `at` (created on demand).</summary>
        public Transform Root(Vector2 at) => EnsureRoot(TileAt(at));

        /// <summary>Parent for street furniture in the tile containing `at`: drawn up to about a kilometre away.</summary>
        public Transform Props(Vector2 at)
        {
            Tile t = TileAt(at);
            return Group(t, ref t.props, "Props");
        }

        /// <summary>Parent for trees and palms in the tile containing `at`: drawn up to about two kilometres away.</summary>
        public Transform Foliage(Vector2 at)
        {
            Tile t = TileAt(at);
            return Group(t, ref t.foliage, "Foliage");
        }

        Transform EnsureRoot(Tile t)
        {
            if (t.root == null)
            {
                var go = new GameObject("Tile " + t.i + ", " + t.j);
                go.transform.SetParent(parent, false);
                go.isStatic = true;
                t.root = go.transform;
            }
            return t.root;
        }

        Transform Group(Tile t, ref Transform group, string name)
        {
            if (group == null)
            {
                var go = new GameObject(name);
                go.transform.SetParent(EnsureRoot(t), false);
                go.isStatic = true;
                group = go.transform;
            }
            return group;
        }

        /// <summary>Turns everything collected into GameObjects.</summary>
        public void Build()
        {
            foreach (Tile t in tiles.Values)
            {
                Transform root = EnsureRoot(t);
                foreach (Part p in t.order)
                {
                    if (p.data.VertexCount == 0 || p.data.indices.Count == 0) continue;
                    Transform under = p.layer == Layer.Marking ? Group(t, ref t.markings, "Markings") : p.layer == Layer.Foliage ? Group(t, ref t.foliage, "Foliage") : p.layer == Layer.Prop ? Group(t, ref t.props, "Props") : root;
                    var go = new GameObject(p.name);
                    go.transform.SetParent(under, false);
                    Mesh mesh = p.data.ToMesh(p.name);
                    mesh.hideFlags = HideFlags.DontSave;
                    go.AddComponent<MeshFilter>().sharedMesh = mesh;
                    var r = go.AddComponent<MeshRenderer>();
                    r.sharedMaterial = p.material;
                    r.shadowCastingMode = p.layer == Layer.Solid || p.layer == Layer.Foliage || p.layer == Layer.Prop ? ShadowCastingMode.On : ShadowCastingMode.Off;
                    r.receiveShadows = true;
                    go.isStatic = p.layer == Layer.Solid || p.layer == Layer.Ground;
                }
                if (t.buildings != null)
                {
                    GameObject b = t.buildings.Build(root);
                    if (b != null && t.collision != null && t.collision.VertexCount > 0)
                    {
                        // The detailed mesh would be slow to cook: collide with plain footprints instead.
                        Mesh col = t.collision.ToMesh("Building collision");
                        col.hideFlags = HideFlags.DontSave;
                        b.AddComponent<MeshCollider>().sharedMesh = col;
                    }
                }
                // A tile is 200 m across: it fills 0.45 of the screen's height about 650 m away,
                // 0.3 at 1 km and 0.16 at 2 km (35 mm lens).
                Cull(t.markings, 0.45f);
                Cull(t.props, 0.3f);
                Cull(t.foliage, 0.16f);
            }
        }

        /// <summary>A LOD group that stops drawing everything under `group` once the tile is smaller on screen than `screenHeight`.</summary>
        static void Cull(Transform group, float screenHeight)
        {
            if (group == null) return;
            Renderer[] renderers = group.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) return;
            var lod = group.gameObject.AddComponent<LODGroup>();
            lod.SetLODs(new[] { new LOD(screenHeight, renderers) });
            lod.RecalculateBounds();
        }
    }
}
