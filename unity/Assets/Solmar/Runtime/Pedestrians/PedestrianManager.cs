using Solmar.City.Roads;
using UnityEngine;

namespace Solmar.Pedestrians
{
    /// <summary>
    /// Bootstraps pedestrians once the map exists: builds <see cref="PedestrianNetwork"/> from
    /// <see cref="RoadGraph.Current"/> (or, for the old single-street scene where there is no road
    /// graph, <see cref="PedestrianNetwork.BuildFallbackStreet"/>), grows a pool of ~40
    /// <see cref="PedestrianAgent"/> bodies a few at a time over several frames (building one is
    /// expensive), and keeps 25-40 of them active within roughly 20-120 m of the camera, spawned out
    /// of view (behind it or beyond ~60 m) and despawned past 150 m. Bodies more than 50 m out are
    /// animated at a reduced rate to stay well under a 1.5 ms budget for the whole crowd.
    /// </summary>
    public sealed class PedestrianManager : MonoBehaviour
    {
        public static PedestrianManager Instance;

        const int PoolSize = 40;
        const int MinActive = 25;
        const int BuildPerFrame = 2;
        const int SpawnPerPass = 3;
        const float SpawnNearDistance = 60f;
        const float DespawnDistance = 150f;
        const float ManageInterval = 0.5f;
        const float AnimateNearDistance = 50f;
        const int FarAnimateSkip = 4;

        /// <summary>The layer every pedestrian capsule is put on; a raw index (like the player's), not a named project layer.</summary>
        public const int PedestrianLayer = 30;
        /// <summary>Everything except pedestrians: used for the "is a fast vehicle nearby" overlap check, so pedestrians never spook each other.</summary>
        public static readonly int NonPedestrianMask = ~(1 << PedestrianLayer);

        PedestrianAgent[] pool;
        public PedestrianAgent[] Pool => pool;

        Transform poolRoot;
        Transform focus;
        PlayerSpawner playerSpawner;
        Rng rng;

        bool hasCity;
        bool hasDistrict;
        bool ready;
        int buildIndex;
        float manageTimer;
        int renderFrame;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Bootstrap()
        {
            bool anyCity = FindAnyObjectByType<SolmarCity>() != null || FindAnyObjectByType<SolmarDistrict>() != null;
            if (!anyCity || FindAnyObjectByType<PedestrianManager>() != null) return;
            var go = new GameObject("Pedestrian manager");
            go.AddComponent<PedestrianManager>();
        }

        void Awake()
        {
            Instance = this;
        }

        void Start()
        {
            hasCity = FindAnyObjectByType<SolmarCity>() != null;
            hasDistrict = FindAnyObjectByType<SolmarDistrict>() != null;
            poolRoot = new GameObject("Pedestrians").transform;
            poolRoot.SetParent(transform, false);
            rng = new Rng((uint)(System.DateTime.UtcNow.Ticks & 0x7fffffff) ^ 0x9E3779B9u);
        }

        void Update()
        {
            if (!ready)
            {
                if (RoadGraph.Current != null)
                {
                    PedestrianNetwork.BuildFromRoadGraph(RoadGraph.Current);
                    BuildPoolShell();
                    ready = true;
                }
                else if (!hasDistrict && hasCity)
                {
                    PedestrianNetwork.BuildFallbackStreet();
                    BuildPoolShell();
                    ready = true;
                }
                return;
            }

            if (buildIndex < pool.Length) BuildSome();
            if (focus == null && Camera.main != null) focus = Camera.main.transform;
            if (playerSpawner == null) playerSpawner = FindAnyObjectByType<PlayerSpawner>();

            float dt = Time.deltaTime;
            Vector3 focusPos = focus != null ? focus.position : Vector3.zero;
            renderFrame++;
            for (int i = 0; i < pool.Length; i++)
            {
                PedestrianAgent a = pool[i];
                if (a == null || !a.Active) continue;
                a.AccumulateDt(dt);
                float distSqr = (a.Position - focusPos).sqrMagnitude;
                bool animateNow = distSqr <= AnimateNearDistance * AnimateNearDistance || (renderFrame + i) % FarAnimateSkip == 0;
                if (animateNow) a.FlushAnimation();
            }

            manageTimer -= dt;
            if (manageTimer <= 0f)
            {
                manageTimer = ManageInterval;
                ManagePopulation(focusPos);
            }
        }

        void FixedUpdate()
        {
            if (!ready || pool == null) return;
            float dt = Time.fixedDeltaTime;
            for (int i = 0; i < pool.Length; i++)
            {
                PedestrianAgent a = pool[i];
                if (a == null || !a.Active) continue;
                a.TickPhysics(dt);
            }
        }

        void BuildPoolShell()
        {
            pool = new PedestrianAgent[PoolSize];
            for (int i = 0; i < PoolSize; i++)
            {
                var go = new GameObject("Pedestrian");
                go.transform.SetParent(poolRoot, false);
                go.layer = PedestrianLayer;
                var rb = go.AddComponent<Rigidbody>();
                rb.isKinematic = true;
                var agent = go.AddComponent<PedestrianAgent>();
                agent.groundMask = ~(1 << PedestrianLayer);
                go.SetActive(false);
                pool[i] = agent;
            }
            buildIndex = 0;
        }

        void BuildSome()
        {
            int n = Mathf.Min(BuildPerFrame, pool.Length - buildIndex);
            for (int k = 0; k < n; k++)
            {
                pool[buildIndex].Build(rng);
                buildIndex++;
            }
        }

        void ManagePopulation(Vector3 focusPos)
        {
            int activeCount = 0;
            for (int i = 0; i < pool.Length; i++)
            {
                PedestrianAgent a = pool[i];
                if (a == null || !a.Active) continue;
                float dist = Vector3.Distance(a.Position, focusPos);
                if (dist > DespawnDistance) { a.Despawn(); continue; }
                activeCount++;
            }

            if (activeCount >= MinActive) return;
            if (buildIndex < pool.Length) return; // still growing the pool; nothing free to place yet beyond buildIndex anyway

            Vector3 focusFwd = focus != null ? focus.forward : Vector3.forward;
            int toSpawn = Mathf.Min(PoolSize - activeCount, SpawnPerPass);
            for (int n = 0; n < toSpawn; n++) TrySpawnOne(focusPos, focusFwd);
        }

        bool TrySpawnOne(Vector3 focusPos, Vector3 focusFwd)
        {
            PedestrianNetwork net = PedestrianNetwork.Current;
            if (net == null || net.Links.Count == 0) return false;
            PedestrianAgent slot = FindFreeSlot();
            if (slot == null) return false;

            for (int attempt = 0; attempt < 10; attempt++)
            {
                PedestrianNetwork.WalkLink link = net.PickWeightedLink(out int idx);
                if (link == null || link.Length < 1.5f) continue;
                float t = Random.value;
                Vector3 point = Vector3.Lerp(link.Points[0], link.Points[link.Points.Length - 1], t);
                float dist = Vector3.Distance(point, focusPos);
                if (dist > DespawnDistance) continue;
                if (dist < SpawnNearDistance)
                {
                    Vector3 toPoint = point - focusPos;
                    if (toPoint.sqrMagnitude > 0.01f && Vector3.Dot(toPoint.normalized, focusFwd) > 0.2f) continue;
                }
                slot.Spawn(idx, Random.value < 0.5f, t * link.Length);
                return true;
            }
            return false;
        }

        PedestrianAgent FindFreeSlot()
        {
            for (int i = 0; i < buildIndex; i++) if (pool[i] != null && !pool[i].Active) return pool[i];
            return null;
        }

        /// <summary>An idling-alone pedestrian within `radius` of `asker`, to pair up with for a chat. Null when none.</summary>
        public PedestrianAgent FindIdlePartner(PedestrianAgent asker, float radius)
        {
            if (pool == null) return null;
            float r2 = radius * radius;
            for (int i = 0; i < pool.Length; i++)
            {
                PedestrianAgent p = pool[i];
                if (p == null || p == asker || !p.Active) continue;
                if (p.CurrentState != PedState.Idle || p.HasChatPartner) continue;
                if ((p.Position - asker.Position).sqrMagnitude > r2) continue;
                return p;
            }
            return null;
        }

        /// <summary>The player's own on-foot position, for local avoidance; false while driving or not spawned.</summary>
        public bool TryGetPlayerPosition(out Vector3 pos)
        {
            if (playerSpawner != null && playerSpawner.OnFoot)
            {
                pos = playerSpawner.Position;
                return true;
            }
            pos = Vector3.zero;
            return false;
        }
    }
}
