using System.Collections.Generic;
using Solmar.City.Roads;
using Solmar.Pedestrians;
using Solmar.Traffic;
using Solmar.UI;
using Solmar.Vehicles;
using UnityEngine;

namespace Solmar.Police
{
    enum BustedPhase { None, FadeOut, Teleport, FadeIn }

    /// <summary>
    /// The GTA-style wanted-level orchestrator: detects the crimes <see cref="Police.ReportCrime"/>
    /// doesn't already cover on its own (a pedestrian knocked down, speeding past a cop), scales the
    /// response to <see cref="PlayerStats.WantedLevel"/> (a couple of chasing cruisers at 1-2 stars,
    /// more of them trying to ram/PIT at 3, roadblocks and a helicopter at 4-5), keeps a "seen" check
    /// (line of sight from any active unit) that resets a countdown search circle when it breaks, and
    /// handles a foot officer catching the player (BUSTED) at 1-2 stars. Bootstrapped by
    /// <see cref="Police.Bootstrap"/> into any Play-mode scene with a city, once
    /// <see cref="RoadGraph.Current"/> and <see cref="LaneNetwork.Current"/> exist (the latter can
    /// arrive a frame late, built by <see cref="TrafficManager"/>). Debug key L adds a wanted star.
    /// </summary>
    public sealed class PoliceManager : MonoBehaviour
    {
        public static PoliceManager Instance;

        const int MaxCars = 6;
        const int MaxOfficers = 6;
        const float ManageInterval = 1f;
        const float ChaseSpawnMin = 55f;
        const float ChaseSpawnMax = 165f;

        const float CrimeCheckInterval = 0.25f;
        const float PedHitRadius = 4.5f;
        const float SpeedCrimeThresholdKmh = 100f;
        const float SpeedCrimeWitnessRadius = 24f;
        const float SpeedCrimeCooldownSeconds = 6f;

        const float SeeCarRadius = 70f;
        const float SeeOfficerRadius = 30f;
        const float SeeHeliRadius = 140f;
        const float SearchBaseRadius = 55f;
        const float SearchRadiusPerStar = 12f;
        const float SearchDurationMin = 10f;
        const float SearchDurationMax = 20f;

        const float BustedRadius = 1.6f;
        const float FadeDuration = 0.6f;

        // ---- pools & scene refs ----
        Transform poolRoot;
        PoliceCar[] carPool;
        PoliceCar[] roadblockPool;
        PoliceOfficer[] officerPool;
        PoliceHelicopter helicopter;
        bool ready;

        VehicleController[] cachedVehicles;
        float vehicleRescanTimer;
        VehicleController playerCar;
        PlayerSpawner playerSpawner;
        TimeOfDay timeOfDay;

        readonly HashSet<Transform> liveryTraffic = new HashSet<Transform>();

        // ---- cached player state, read by PoliceCar/PoliceOfficer/PoliceHelicopter ----
        public Vector3 PlayerPosition { get; private set; }
        public Vector3 PlayerForward { get; private set; } = Vector3.forward;
        public Vector3 PlayerVelocity { get; private set; }
        public bool PlayerDriving { get; private set; }
        public bool PlayerOnFoot { get; private set; }
        public bool IsNight { get; private set; }

        // ---- crime detection ----
        float crimeCheckTimer;
        bool[] pedWasFallen;
        float speedCrimeCooldownTimer;

        // ---- response scaling ----
        float manageTimer;
        int lastLevel = -1;
        bool roadblockPlaced;
        Vector3 roadblockAnchor;

        // ---- search circle / busted ----
        float searchTimeRemaining;
        BustedPhase bustedPhase;
        float bustedTimer;
        GUIStyle bustedStyle;

        void Awake() => Instance = this;

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        void Update()
        {
            if (!ready)
            {
                if (RoadGraph.Current == null || LaneNetwork.Current == null) return;
                BuildPools();
                ready = true;
            }

            float dt = Time.deltaTime;
            UpdatePlayerCache();
            UpdateNight();

#if ENABLE_LEGACY_INPUT_MANAGER
            if (Input.GetKeyDown(KeyCode.L))
            {
                PlayerStats.WantedLevel += 1;
                NotifySeen(PlayerPosition);
            }
#endif

            TickCrimeDetection(dt);
            TickSearchAndBusted(dt);

            int level = PlayerStats.WantedLevel;
            if (level != lastLevel) { manageTimer = 0f; lastLevel = level; }
            manageTimer -= dt;
            if (manageTimer <= 0f)
            {
                manageTimer = ManageInterval;
                ManagePopulation();
            }

            if (helicopter != null) helicopter.Tick(dt, this);
            UpdateBustedFade(dt);
        }

        void FixedUpdate()
        {
            if (!ready) return;
            float dt = Time.fixedDeltaTime;
            for (int i = 0; i < carPool.Length; i++) carPool[i]?.Tick(dt, this);
            for (int i = 0; i < roadblockPool.Length; i++) roadblockPool[i]?.Tick(dt, this);
            for (int i = 0; i < officerPool.Length; i++) officerPool[i]?.Tick(dt, this);
        }

        // ------------------------------------------------------------------------------ pools ----

        void BuildPools()
        {
            poolRoot = new GameObject("Police units").transform;
            poolRoot.SetParent(transform, false);

            var rng = new Rng(0xB0110CEu);

            carPool = new PoliceCar[MaxCars];
            for (int i = 0; i < MaxCars; i++) carPool[i] = BuildOneCar(i);

            roadblockPool = new PoliceCar[2];
            for (int i = 0; i < roadblockPool.Length; i++) roadblockPool[i] = BuildOneCar(MaxCars + i);

            officerPool = new PoliceOfficer[MaxOfficers];
            for (int i = 0; i < MaxOfficers; i++)
            {
                var go = new GameObject("Police officer");
                go.transform.SetParent(poolRoot, false);
                var rb = go.AddComponent<Rigidbody>();
                rb.isKinematic = true;
                go.AddComponent<CapsuleCollider>();
                var officer = go.AddComponent<PoliceOfficer>();
                officer.Build(rng);
                go.SetActive(false);
                officerPool[i] = officer;
            }

            helicopter = PoliceHelicopter.Build(poolRoot);
        }

        PoliceCar BuildOneCar(int index)
        {
            var go = new GameObject("Police cruiser");
            go.transform.SetParent(poolRoot, false);
            var rb = go.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            VehicleBody.WheelSlot[] wheels = VehicleBody.Build(go.transform, Color.white, CarModel.Police);
            go.AddComponent<PoliceLightBar>();
            go.AddComponent<PoliceSiren>();
            var car = go.AddComponent<PoliceCar>();
            car.Init(wheels, index);
            go.SetActive(false);
            return car;
        }

        // ------------------------------------------------------------------------ player cache ----

        void UpdatePlayerCache()
        {
            vehicleRescanTimer -= Time.deltaTime;
            if (cachedVehicles == null || vehicleRescanTimer <= 0f)
            {
                vehicleRescanTimer = 1f;
                cachedVehicles = FindObjectsByType<VehicleController>(FindObjectsSortMode.None);
                for (int i = 0; i < cachedVehicles.Length; i++)
                {
                    VehicleController vc = cachedVehicles[i];
                    if (vc != null && vc.GetComponent<PoliceCrimeWatcher>() == null) vc.gameObject.AddComponent<PoliceCrimeWatcher>();
                }
                if (playerSpawner == null) playerSpawner = FindAnyObjectByType<PlayerSpawner>();
            }

            playerCar = null;
            if (cachedVehicles != null)
            {
                for (int i = 0; i < cachedVehicles.Length; i++)
                {
                    VehicleController vc = cachedVehicles[i];
                    if (vc != null && vc.IsPlayerControlled) { playerCar = vc; break; }
                }
            }

            if (playerCar != null)
            {
                PlayerDriving = true;
                PlayerOnFoot = false;
                Transform t = playerCar.transform;
                PlayerPosition = t.position;
                PlayerForward = t.forward;
                PlayerVelocity = playerCar.Velocity;
            }
            else if (playerSpawner != null && playerSpawner.OnFoot)
            {
                PlayerDriving = false;
                PlayerOnFoot = true;
                PlayerPosition = playerSpawner.Position;
                PlayerVelocity = Vector3.zero;
            }
            else
            {
                PlayerDriving = false;
                PlayerOnFoot = false;
            }
        }

        void UpdateNight()
        {
            if (timeOfDay == null) timeOfDay = FindAnyObjectByType<TimeOfDay>();
            IsNight = timeOfDay != null && timeOfDay.ElevationDegrees < 3f;
        }

        // -------------------------------------------------------------------- crime detection ----

        void TickCrimeDetection(float dt)
        {
            crimeCheckTimer -= dt;
            if (crimeCheckTimer > 0f) return;
            crimeCheckTimer = CrimeCheckInterval;

            CheckPedestrianHits();
            CheckSpeedingPastPolice();
        }

        void CheckPedestrianHits()
        {
            if (!PlayerDriving) { pedWasFallen = null; return; }
            PedestrianAgent[] pool = PedestrianManager.Instance != null ? PedestrianManager.Instance.Pool : null;
            if (pool == null) return;
            if (pedWasFallen == null || pedWasFallen.Length != pool.Length) pedWasFallen = new bool[pool.Length];

            for (int i = 0; i < pool.Length; i++)
            {
                PedestrianAgent a = pool[i];
                bool fallen = a != null && a.Active && a.CurrentState == PedState.Fallen;
                if (fallen && !pedWasFallen[i])
                {
                    float d2 = (a.Position - PlayerPosition).sqrMagnitude;
                    if (d2 < PedHitRadius * PedHitRadius) Police.ReportCrime(a.Position, 1);
                }
                pedWasFallen[i] = fallen;
            }
        }

        void CheckSpeedingPastPolice()
        {
            speedCrimeCooldownTimer -= CrimeCheckInterval;
            if (!PlayerDriving || speedCrimeCooldownTimer > 0f) return;
            if (playerCar == null || playerCar.SpeedKmh < SpeedCrimeThresholdKmh) return;
            if (AnyPoliceWitness(PlayerPosition, SpeedCrimeWitnessRadius))
            {
                Police.ReportCrime(PlayerPosition, 1);
                speedCrimeCooldownTimer = SpeedCrimeCooldownSeconds;
            }
        }

        void RescanLivery()
        {
            var all = FindObjectsByType<TrafficCar>(FindObjectsSortMode.None);
            for (int i = 0; i < all.Length; i++)
            {
                Transform t = all[i].transform;
                if (!liveryTraffic.Contains(t) && PoliceUtil.IsPoliceLivery(t)) liveryTraffic.Add(t);
            }
        }

        /// <summary>Whether any active police unit (a chasing cruiser or an ambient police-liveried
        /// traffic car) is close enough to, and has line of sight on, `point` to count as a witness.</summary>
        public bool AnyPoliceWitness(Vector3 point, float radius)
        {
            float r2 = radius * radius;
            for (int i = 0; i < carPool.Length; i++)
            {
                PoliceCar c = carPool[i];
                if (c == null || !c.Active || c.IsWrecked) continue;
                if ((c.Position - point).sqrMagnitude <= r2 && HasLineOfSight(c.Position + Vector3.up * 1.3f, point)) return true;
            }
            foreach (Transform t in liveryTraffic)
            {
                if (t == null || !t.gameObject.activeInHierarchy) continue;
                if ((t.position - point).sqrMagnitude <= r2 && HasLineOfSight(t.position + Vector3.up * 1.3f, point)) return true;
            }
            return false;
        }

        static bool HasLineOfSight(Vector3 from, Vector3 to)
        {
            Vector3 delta = to - from;
            float dist = delta.magnitude;
            if (dist < 0.1f) return true;
            float checkDist = dist - 1.2f;
            if (checkDist <= 0f) return true;
            return !Physics.Raycast(from, delta / dist, checkDist, ~0, QueryTriggerInteraction.Ignore);
        }

        // ---------------------------------------------------------------------- response scale ----

        void ManagePopulation()
        {
            RescanLivery();
            int level = PlayerStats.WantedLevel;
            if (level <= 0) { DespawnAllPolice(); return; }

            int targetCars = level <= 2 ? 2 : (level == 3 ? 4 : 5);
            bool ramming = level >= 3;
            SpawnCarsUpTo(targetCars, ramming);
            DespawnExcessCars(targetCars);
            UpdateRammingFlagAll(ramming);

            if (level >= 4)
            {
                EnsureRoadblocks();
                if (helicopter != null) helicopter.SetActive(true);
            }
            else
            {
                ClearRoadblocks();
                if (helicopter != null) helicopter.SetActive(false);
            }

            DespawnFarCarsAndOfficers();
        }

        void SpawnCarsUpTo(int target, bool ramming)
        {
            int active = CountActiveCars();
            int guard = 0;
            while (active < target && guard < 8)
            {
                guard++;
                if (!TrySpawnCar(ramming)) break;
                active++;
            }
        }

        bool TrySpawnCar(bool ramming)
        {
            LaneNetwork net = LaneNetwork.Current;
            if (net == null || net.Lanes.Count == 0) return false;
            PoliceCar slot = FindFreeCarSlot();
            if (slot == null) return false;

            TrafficLane best = null;
            float bestT = 0f;
            for (int attempt = 0; attempt < 12; attempt++)
            {
                TrafficLane lane = net.Lanes[Random.Range(0, net.Lanes.Count)];
                if (lane.Length < 6f) continue;
                float t = Random.value;
                Vector3 point = Vector3.Lerp(lane.Points[0], lane.Points[lane.Points.Length - 1], t);
                float dist = Vector3.Distance(point, PlayerPosition);
                if (dist < ChaseSpawnMin || dist > ChaseSpawnMax) continue;
                best = lane;
                bestT = t;
                break;
            }
            if (best == null) return false;

            slot.Spawn(best, bestT * best.Length, ramming);
            return true;
        }

        int CountActiveCars()
        {
            int n = 0;
            for (int i = 0; i < carPool.Length; i++) if (carPool[i] != null && carPool[i].Active && !carPool[i].IsWrecked) n++;
            return n;
        }

        PoliceCar FindFreeCarSlot()
        {
            for (int i = 0; i < carPool.Length; i++) if (carPool[i] != null && !carPool[i].Active) return carPool[i];
            return null;
        }

        void DespawnExcessCars(int target)
        {
            int active = 0;
            for (int i = 0; i < carPool.Length; i++)
            {
                PoliceCar c = carPool[i];
                if (c == null || !c.Active) continue;
                active++;
                if (active > target) c.Despawn();
            }
        }

        void UpdateRammingFlagAll(bool ramming)
        {
            for (int i = 0; i < carPool.Length; i++) if (carPool[i] != null && carPool[i].Active) carPool[i].SetRamming(ramming);
        }

        void EnsureRoadblocks()
        {
            if (!PlayerDriving) return;
            bool needNew = !roadblockPlaced || Vector3.Distance(PlayerPosition, roadblockAnchor) > 260f || HasPlayerPassed(roadblockAnchor);
            if (!needNew) return;
            roadblockPlaced = PlaceRoadblock();
        }

        bool HasPlayerPassed(Vector3 anchor)
        {
            Vector3 toAnchor = anchor - PlayerPosition;
            return Vector3.Dot(toAnchor, PlayerForward) < -15f;
        }

        bool PlaceRoadblock()
        {
            LaneNetwork net = LaneNetwork.Current;
            if (net == null || net.Lanes.Count == 0 || !PlayerDriving) return false;

            Vector3 ahead = PlayerPosition + PlayerForward.normalized * 100f;
            TrafficLane best = null;
            float bestDist = float.MaxValue;
            Vector3 bestPoint = Vector3.zero;
            for (int i = 0; i < net.Lanes.Count; i++)
            {
                TrafficLane lane = net.Lanes[i];
                if (lane.Length < 8f) continue;
                Vector3 mid = Vector3.Lerp(lane.Points[0], lane.Points[lane.Points.Length - 1], 0.5f);
                float d = (mid - ahead).sqrMagnitude;
                if (d < bestDist) { bestDist = d; best = lane; bestPoint = mid; }
            }
            if (best == null || roadblockPool.Length < 2) return false;

            Vector3 across = new Vector3(best.Direction2D.y, 0f, -best.Direction2D.x);
            Quaternion rot = Quaternion.LookRotation(across, Vector3.up);
            const float halfSpan = 2.2f;
            roadblockPool[0]?.SpawnRoadblock(bestPoint + across * halfSpan, rot);
            roadblockPool[1]?.SpawnRoadblock(bestPoint - across * halfSpan, rot * Quaternion.Euler(0f, 180f, 0f));
            roadblockAnchor = bestPoint;
            return true;
        }

        void ClearRoadblocks()
        {
            if (!roadblockPlaced) return;
            roadblockPlaced = false;
            for (int i = 0; i < roadblockPool.Length; i++) roadblockPool[i]?.Despawn();
        }

        void DespawnFarCarsAndOfficers()
        {
            const float maxDist = 400f;
            for (int i = 0; i < carPool.Length; i++)
            {
                PoliceCar c = carPool[i];
                if (c == null || !c.Active) continue;
                float dist = Vector3.Distance(c.Position, PlayerPosition);
                if (dist > maxDist || (c.IsWrecked && dist > 150f)) c.Despawn();
            }
            for (int i = 0; i < officerPool.Length; i++)
            {
                PoliceOfficer o = officerPool[i];
                if (o == null || !o.Active) continue;
                if (Vector3.Distance(o.Position, PlayerPosition) > 150f) o.Despawn();
            }
        }

        void DespawnAllPolice()
        {
            if (carPool != null) for (int i = 0; i < carPool.Length; i++) carPool[i]?.Despawn();
            if (roadblockPool != null)
            {
                for (int i = 0; i < roadblockPool.Length; i++) roadblockPool[i]?.Despawn();
                roadblockPlaced = false;
            }
            if (officerPool != null) for (int i = 0; i < officerPool.Length; i++) officerPool[i]?.Despawn();
            if (helicopter != null) helicopter.SetActive(false);
        }

        /// <summary>Called by a <see cref="PoliceCar"/> that has closed on an on-foot player: deploys
        /// one or two pooled <see cref="PoliceOfficer"/>s near it to continue the chase on foot.</summary>
        public void DeployOfficers(Vector3 position)
        {
            int count = Random.value < 0.5f ? 1 : 2;
            Vector3 target = PlayerPosition;
            for (int n = 0; n < count; n++)
            {
                PoliceOfficer o = FindFreeOfficer();
                if (o == null) break;
                Vector3 offset = new Vector3(Random.Range(-1.5f, 1.5f), 0f, Random.Range(-1.5f, 1.5f));
                Vector3 spawnPos = position + offset;
                spawnPos.y = PoliceUtil.GroundHeight(spawnPos.x, spawnPos.z, position.y);
                o.Spawn(spawnPos, target - spawnPos);
            }
        }

        PoliceOfficer FindFreeOfficer()
        {
            for (int i = 0; i < officerPool.Length; i++) if (officerPool[i] != null && !officerPool[i].Active) return officerPool[i];
            return null;
        }

        // -------------------------------------------------------------------- search & busted ----

        /// <summary>Marks the player as seen right now at `pos`: resets the search circle onto them and
        /// restarts the countdown before it would otherwise clear the wanted level.</summary>
        public void NotifySeen(Vector3 pos)
        {
            if (!float.IsFinite(pos.x) || !float.IsFinite(pos.y) || !float.IsFinite(pos.z)) return;
            int level = Mathf.Max(1, PlayerStats.WantedLevel);
            searchTimeRemaining = Mathf.Lerp(SearchDurationMin, SearchDurationMax, (level - 1) / 4f);
            Police.SearchCircleCenter = pos;
            Police.SearchCircleRadius = SearchBaseRadius + (level - 1) * SearchRadiusPerStar;
        }

        void TickSearchAndBusted(float dt)
        {
            int level = PlayerStats.WantedLevel;
            if (level <= 0) { searchTimeRemaining = 0f; return; }

            if (IsPlayerSeenNow())
            {
                NotifySeen(PlayerPosition);
            }
            else
            {
                searchTimeRemaining -= dt;
                if (searchTimeRemaining <= 0f)
                {
                    PlayerStats.WantedLevel = 0;
                    DespawnAllPolice();
                    return;
                }
            }

            if (level <= 2 && PlayerOnFoot && bustedPhase == BustedPhase.None && AnyOfficerCaughtPlayer())
                StartBusted();
        }

        bool IsPlayerSeenNow()
        {
            if (!PlayerDriving && !PlayerOnFoot) return false;
            for (int i = 0; i < carPool.Length; i++)
            {
                PoliceCar c = carPool[i];
                if (c == null || !c.Active || c.IsWrecked) continue;
                if (Vector3.Distance(c.Position, PlayerPosition) <= SeeCarRadius && HasLineOfSight(c.Position + Vector3.up * 1.3f, PlayerPosition + Vector3.up)) return true;
            }
            for (int i = 0; i < officerPool.Length; i++)
            {
                PoliceOfficer o = officerPool[i];
                if (o == null || !o.Active) continue;
                if (Vector3.Distance(o.Position, PlayerPosition) <= SeeOfficerRadius && HasLineOfSight(o.Position + Vector3.up * 1.5f, PlayerPosition + Vector3.up)) return true;
            }
            if (helicopter != null && helicopter.Active && Vector3.Distance(helicopter.Position, PlayerPosition) <= SeeHeliRadius) return true;
            return false;
        }

        bool AnyOfficerCaughtPlayer()
        {
            for (int i = 0; i < officerPool.Length; i++)
            {
                PoliceOfficer o = officerPool[i];
                if (o == null || !o.Active) continue;
                if ((o.Position - PlayerPosition).sqrMagnitude <= BustedRadius * BustedRadius) return true;
            }
            return false;
        }

        void StartBusted()
        {
            bustedPhase = BustedPhase.FadeOut;
            bustedTimer = 0f;
        }

        void UpdateBustedFade(float dt)
        {
            if (bustedPhase == BustedPhase.None) return;
            bustedTimer += dt;
            switch (bustedPhase)
            {
                case BustedPhase.FadeOut:
                    if (bustedTimer >= FadeDuration) { bustedPhase = BustedPhase.Teleport; bustedTimer = 0f; }
                    break;
                case BustedPhase.Teleport:
                    DoBustedTeleport();
                    bustedPhase = BustedPhase.FadeIn;
                    bustedTimer = 0f;
                    break;
                case BustedPhase.FadeIn:
                    if (bustedTimer >= FadeDuration) bustedPhase = BustedPhase.None;
                    break;
            }
        }

        void DoBustedTeleport()
        {
            long fine = System.Math.Max(50L, PlayerStats.Money / 10L);
            PlayerStats.Money -= fine;
            PlayerStats.WantedLevel = 0;
            DespawnAllPolice();
            Vector3 station = PoliceUtil.StationPoint();
            if (playerSpawner != null) playerSpawner.ShowAt(station, Vector3.forward);
        }

        void OnGUI()
        {
            if (bustedPhase == BustedPhase.None) return;
            float alpha = bustedPhase switch
            {
                BustedPhase.FadeOut => Mathf.Clamp01(bustedTimer / FadeDuration),
                BustedPhase.Teleport => 1f,
                _ => 1f - Mathf.Clamp01(bustedTimer / FadeDuration),
            };

            Color prev = GUI.color;
            GUI.color = new Color(0f, 0f, 0f, alpha);
            GUI.DrawTexture(new Rect(0f, 0f, Screen.width, Screen.height), Texture2D.whiteTexture);
            GUI.color = prev;

            if (alpha > 0.4f)
            {
                bustedStyle ??= new GUIStyle(GUI.skin.label) { alignment = TextAnchor.MiddleCenter, fontSize = 42, fontStyle = FontStyle.Bold };
                bustedStyle.normal.textColor = new Color(1f, 1f, 1f, Mathf.Clamp01((alpha - 0.4f) / 0.3f));
                GUI.Label(new Rect(0f, Screen.height * 0.5f - 40f, Screen.width, 80f), "BUSTED", bustedStyle);
            }
        }
    }
}
