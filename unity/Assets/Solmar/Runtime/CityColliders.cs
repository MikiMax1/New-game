using UnityEngine;

namespace Solmar
{
    /// <summary>
    /// Gives the generated city solid ground and walls in Play mode: every static mesh the city
    /// generated gets a MeshCollider, except foliage (grass, leaves, fronds, shrubs), which you can
    /// walk and drive through. Runs once the scene has loaded, and again on request after a
    /// regeneration (<see cref="AddTo"/>).
    /// </summary>
    public static class CityColliders
    {
        static readonly string[] Soft = { "Grass", "Palm leaves", "Dead fronds", "Palm stems", "Shrubs", "Bougainvillea", "Ground cover" };

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void AddToScene()
        {
            foreach (SolmarCity city in Object.FindObjectsByType<SolmarCity>(FindObjectsSortMode.None)) AddTo(city.transform);
        }

        /// <summary>Adds colliders to the static meshes under `root` that don't have one yet.</summary>
        public static void AddTo(Transform root)
        {
            foreach (MeshFilter f in root.GetComponentsInChildren<MeshFilter>(true))
            {
                GameObject go = f.gameObject;
                if (f.sharedMesh == null || !go.isStatic || go.GetComponent<Collider>() != null) continue;
                if (System.Array.IndexOf(Soft, go.name) >= 0) continue;
                go.AddComponent<MeshCollider>().sharedMesh = f.sharedMesh;
            }
        }
    }
}
