using System.Collections.Generic;
using Solmar.City.Roads;
using Solmar.Vehicles;
using UnityEngine;

namespace Solmar.Traffic
{
    /// <summary>
    /// Bootstraps ambient traffic once the map (and its <see cref="RoadGraph"/>) exists: builds the
    /// <see cref="LaneNetwork"/> and <see cref="TrafficSignals"/>, keeps a pool of ~30-50
    /// <see cref="TrafficCar"/>s within 60-250 m of the camera (spawning out of view, despawning past
    /// 300 m), and ticks every active car once a physics step. Press J to draw lanes, turn paths and
    /// signal states with <see cref="Debug.DrawLine"/> in the Scene view.
    /// </summary>
    public sealed class TrafficManager : MonoBehaviour
    {
        public static TrafficManager Instance;

        const int MaxCars = 50;
        const int MinCars = 30;
        const float SpawnMinDist = 60f;
        const float SpawnMaxDist = 250f;
        const float DespawnDist = 300f;
        const float ManageInterval = 0.5f;
        const float NearDistance = 120f;
        const int FarUpdateSkip = 4;
        const int SpawnPerPass = 3;

        readonly TrafficCar[] pool = new TrafficCar[MaxCars];
        Transform carsRoot;
        Transform focus;
        float manageTimer;
        bool debugDraw;
        bool networkReady;
        int frameCounter;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Bootstrap()
        {
            bool hasCity = FindAnyObjectByType<SolmarCity>() != null || FindAnyObjectByType<SolmarDistrict>() != null;
            if (!hasCity || FindAnyObjectByType<TrafficManager>() != null) return;
            var go = new GameObject("Traffic manager");
            go.AddComponent<TrafficManager>();
        }

        void Awake()
        {
            Instance = this;
        }

        void Start()
        {
            SolmarCity city = FindAnyObjectByType<SolmarCity>();
            SolmarDistrict district = FindAnyObjectByType<SolmarDistrict>();
            // Make sure the road already has a collider to raycast against (lane heights, spawn
            // checks) whatever order RuntimeInitializeOnLoadMethod callbacks happen to run in.
            CityColliders.AddTo(city != null ? city.transform : district.transform);
            carsRoot = new GameObject("Traffic cars").transform;
            carsRoot.SetParent(transform, false);
        }

        void Update()
        {
            if (!networkReady)
            {
                // RoadGraph.Current is set while the map generates; it can be a frame behind us.
                if (RoadGraph.Current == null) return;
                LaneNetwork.Build(RoadGraph.Current);
                TrafficSignals.Build(RoadGraph.Current);
                JunctionOccupancy.Clear();
                BuildPool();
                networkReady = true;
            }

#if ENABLE_LEGACY_INPUT_MANAGER
            if (Input.GetKeyDown(KeyCode.J)) debugDraw = !debugDraw;
#endif
            if (debugDraw) DrawDebug();
        }

        void FixedUpdate()
        {
            if (!networkReady) return;
            float dt = Time.fixedDeltaTime;
            TrafficSignals.Current?.Tick(dt);
            if (focus == null && Camera.main != null) focus = Camera.main.transform;

            TickCars(dt);

            manageTimer -= dt;
            if (manageTimer <= 0f)
            {
                manageTimer = ManageInterval;
                ManagePopulation();
            }
            frameCounter++;
        }

        void BuildPool()
        {
            // A realistic mix of models and paints (mostly white, silver, grey and black).
            var random = new Rng(0x7AF1C5u);
            for (int i = 0; i < MaxCars; i++)
            {
                var go = new GameObject("Traffic car");
                go.transform.SetParent(carsRoot, false);
                var rb = go.AddComponent<Rigidbody>();
                rb.isKinematic = true;
                VehicleBody.WheelSlot[] slots = VehicleBody.Build(go.transform, VehicleBody.RandomPaint(random), VehicleBody.RandomModel(random));
                var car = go.AddComponent<TrafficCar>();
                car.Init(slots);
                go.SetActive(false);
                pool[i] = car;
            }
        }

        void TickCars(float dt)
        {
            Vector3 focusPos = focus != null ? focus.position : Vector3.zero;
            for (int i = 0; i < pool.Length; i++)
            {
                TrafficCar car = pool[i];
                if (car == null || !car.Active) continue;
                bool doPerception = true;
                if (!car.IsWrecked)
                {
                    float sqrDist = (car.Position - focusPos).sqrMagnitude;
                    if (sqrDist > NearDistance * NearDistance) doPerception = (frameCounter + i) % FarUpdateSkip == 0;
                }
                car.Tick(dt, doPerception);
            }
        }

        void ManagePopulation()
        {
            Vector3 focusPos = focus != null ? focus.position : Vector3.zero;
            Vector3 focusFwd = focus != null ? focus.forward : Vector3.forward;

            int activeCount = 0;
            for (int i = 0; i < pool.Length; i++)
            {
                TrafficCar car = pool[i];
                if (car == null || !car.Active) continue;
                float dist = Vector3.Distance(car.Position, focusPos);
                bool farWreck = car.IsWrecked && dist > DespawnDist * 0.5f;
                if (dist > DespawnDist || car.IsStuck || farWreck) { car.Despawn(); continue; }
                activeCount++;
            }

            if (activeCount >= MinCars) return;
            int toSpawn = Mathf.Min(MaxCars - activeCount, SpawnPerPass);
            for (int n = 0; n < toSpawn; n++) TrySpawnOne(focusPos, focusFwd);
        }

        bool TrySpawnOne(Vector3 focusPos, Vector3 focusFwd)
        {
            LaneNetwork net = LaneNetwork.Current;
            if (net == null || net.Lanes.Count == 0) return false;
            TrafficCar slot = FindFreeSlot();
            if (slot == null) return false;

            TrafficLane bestLane = null;
            float bestT = 0f;
            Vector3 bestPoint = Vector3.zero;
            for (int attempt = 0; attempt < 10; attempt++)
            {
                TrafficLane lane = net.Lanes[Random.Range(0, net.Lanes.Count)];
                if (lane.Length < 4f) continue;
                float t = Random.value;
                Vector3 point = Vector3.Lerp(lane.Points[0], lane.Points[lane.Points.Length - 1], t);
                float dist = Vector3.Distance(point, focusPos);
                if (dist < SpawnMinDist || dist > SpawnMaxDist) continue;

                Vector3 toPoint = point - focusPos;
                bool inViewCone = toPoint.sqrMagnitude > 0.01f && Vector3.Dot(toPoint.normalized, focusFwd) > 0.3f && dist < 140f;
                bestLane = lane;
                bestT = t;
                bestPoint = point;
                if (!inViewCone) break;
            }
            if (bestLane == null) return false;
            if (AnyCarNear(bestPoint, 5f, null)) return false;

            float startDist = bestT * bestLane.Length;
            float personalFactor = Random.Range(0.9f, 1.1f);
            slot.Spawn(bestLane, startDist, personalFactor);
            return true;
        }

        TrafficCar FindFreeSlot()
        {
            for (int i = 0; i < pool.Length; i++) if (pool[i] != null && !pool[i].Active) return pool[i];
            return null;
        }

        /// <summary>Whether any other active traffic car's centre is within `radius` of `point` (used
        /// both to keep spawns clear of other cars and for the junction-box "exit blocked" check).</summary>
        public bool AnyCarNear(Vector3 point, float radius, TrafficCar exclude)
        {
            float r2 = radius * radius;
            for (int i = 0; i < pool.Length; i++)
            {
                TrafficCar car = pool[i];
                if (car == null || !car.Active || car == exclude) continue;
                if ((car.Position - point).sqrMagnitude < r2) return true;
            }
            return false;
        }

        void DrawDebug()
        {
            LaneNetwork net = LaneNetwork.Current;
            if (net == null) return;
            Vector3 focusPos = focus != null ? focus.position : Vector3.zero;
            const float range = 220f;
            float rangeSqr = range * range;
            List<TrafficLane> lanes = net.Lanes;
            for (int i = 0; i < lanes.Count; i++)
            {
                TrafficLane lane = lanes[i];
                Vector3 mid = Vector3.Lerp(lane.Points[0], lane.Points[lane.Points.Length - 1], 0.5f);
                if ((mid - focusPos).sqrMagnitude > rangeSqr) continue;

                var laneColor = new Color(0.1f, 0.9f, 0.25f);
                for (int p = 0; p < lane.Points.Length - 1; p++)
                    Debug.DrawLine(lane.Points[p] + Vector3.up * 0.15f, lane.Points[p + 1] + Vector3.up * 0.15f, laneColor);

                for (int t = 0; t < lane.Turns.Count; t++)
                {
                    TrafficTurn turn = lane.Turns[t];
                    Color turnColor = turn.Kind switch
                    {
                        TurnKind.Left => Color.cyan,
                        TurnKind.Right => Color.yellow,
                        TurnKind.UTurn => Color.magenta,
                        _ => new Color(0.1f, 0.6f, 1f),
                    };
                    for (int p = 0; p < turn.Points.Length - 1; p++)
                        Debug.DrawLine(turn.Points[p] + Vector3.up * 0.15f, turn.Points[p + 1] + Vector3.up * 0.15f, turnColor);
                }

                if (lane.ToNodeIsJunction)
                {
                    SignalState state = TrafficSignals.StateFor(lane.ToNode, lane.EdgeId);
                    Color stateColor = state switch
                    {
                        SignalState.Green => Color.green,
                        SignalState.Amber => new Color(1f, 0.6f, 0f),
                        SignalState.Red => Color.red,
                        _ => Color.white,
                    };
                    Vector3 stop = lane.Points[lane.Points.Length - 1];
                    Debug.DrawLine(stop + Vector3.up * 0.2f, stop + Vector3.up * 2.2f, stateColor);
                }
            }
        }
    }
}
