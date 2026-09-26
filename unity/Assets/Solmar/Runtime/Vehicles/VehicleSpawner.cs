using Solmar.City;
using UnityEngine;

namespace Solmar.Vehicles
{
    /// <summary>
    /// Spawns one drivable car when a scene with a <see cref="SolmarCity"/> starts playing, parked
    /// facing south-west-bound in the near southbound traffic lane (the street runs along x; traffic
    /// heading -x uses the lanes at z &lt; 0). Press G to get in and out: entering hands the main
    /// camera to <see cref="ChaseCamera"/> and switches off <see cref="Solmar.FreeCamera"/> and
    /// <see cref="Solmar.PlayerWalker"/> on it for the duration, restoring them on exit.
    /// </summary>
    public sealed class VehicleSpawner : MonoBehaviour
    {
        /// <summary>Where the car is parked: x along the street, z the lane (southbound lanes are z &lt; 0).</summary>
        static readonly Vector3 SpawnXz = new Vector3(40f, 0f, -1.65f);
        /// <summary>In the district: the avenue's outer northbound lane, a few metres short of the player.</summary>
        static readonly Vector3 DistrictSpawnXz = new Vector3(City.Roads.DistrictGenerator.AvenueColumn * City.Roads.DistrictGenerator.BlockLengthX + 6.95f, 0f, City.Roads.DistrictGenerator.BlockLengthZ * 1.5f - 9f);
        /// <summary>How close the walking player has to be to the car to get in.</summary>
        const float EnterDistance = 6f;

        VehicleController car;
        VehicleHud hud;
        ChaseCamera chaseCamera;
        FreeCamera freeCamera;
        PlayerWalker playerWalker;
        bool driving;
        bool restoreFreeCamera;
        bool restoreWalker;
        PlayerSpawner player;
        bool playerWasOnFoot;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Bootstrap()
        {
            SolmarCity city = FindAnyObjectByType<SolmarCity>();
            City.Roads.SolmarDistrict district = FindAnyObjectByType<City.Roads.SolmarDistrict>();
            if ((city == null && district == null) || FindAnyObjectByType<VehicleSpawner>() != null) return;
            // Make sure the road already has a collider to raycast against, whatever order
            // RuntimeInitializeOnLoadMethod callbacks happen to run in.
            CityColliders.AddTo(city != null ? city.transform : district.transform);

            var go = new GameObject("Vehicle spawner");
            var spawner = go.AddComponent<VehicleSpawner>();
            spawner.car = city != null ? SpawnCar(SpawnXz.x, SpawnXz.z, Vector3.left) : SpawnCar(DistrictSpawnXz.x, DistrictSpawnXz.z, Vector3.forward);
            spawner.hud = go.AddComponent<VehicleHud>();
            spawner.hud.vehicle = spawner.car;
            spawner.hud.enabled = false;
        }

        static VehicleController SpawnCar(float x, float z, Vector3 heading)
        {
            float groundY = FindGroundHeight(x, z);
            var root = new GameObject("Drivable sedan");
            root.transform.SetPositionAndRotation(new Vector3(x, groundY + 0.6f, z), Quaternion.LookRotation(heading, Vector3.up));

            root.AddComponent<Rigidbody>();
            var controller = root.AddComponent<VehicleController>();
            VehicleBody.WheelSlot[] wheels = VehicleBody.Build(root.transform, new Color(0.62f, 0.06f, 0.05f));
            controller.AttachWheels(wheels);
            return controller;
        }

        static float FindGroundHeight(float x, float z)
        {
            var origin = new Vector3(x, 25f, z);
            if (Physics.Raycast(origin, Vector3.down, out RaycastHit hit, 60f)) return hit.point.y;
            // No collider under it yet (e.g. the city hasn't finished generating): fall back to the
            // road's own height function so the car still spawns at a sane height.
            return Street.Height(x, z);
        }

        /// <summary>On the ground beside the driver's door (left, as in the US).</summary>
        Vector3 ExitPoint()
        {
            Vector3 p = car.transform.position - car.transform.right * 1.7f;
            if (Physics.Raycast(p + Vector3.up * 3f, Vector3.down, out RaycastHit hit, 10f, ~(1 << 31), QueryTriggerInteraction.Ignore)) p.y = hit.point.y;
            return p;
        }

        void Update()
        {
            if (car == null) return;
#if ENABLE_LEGACY_INPUT_MANAGER
            if (Input.GetKeyDown(KeyCode.G)) Toggle();
#endif
        }

        void Toggle()
        {
            Camera cam = Camera.main;
            if (cam == null) return;
            if (freeCamera == null) freeCamera = cam.GetComponent<FreeCamera>();
            if (playerWalker == null) playerWalker = cam.GetComponent<PlayerWalker>();
            if (chaseCamera == null) chaseCamera = cam.GetComponent<ChaseCamera>();
            if (chaseCamera == null) chaseCamera = cam.gameObject.AddComponent<ChaseCamera>();

            if (player == null) player = FindAnyObjectByType<PlayerSpawner>();
            if (!driving && player != null && player.OnFoot)
            {
                // On foot you have to walk up to the car first.
                Vector3 offset = player.Position - car.transform.position;
                offset.y = 0f;
                if (offset.magnitude > EnterDistance) return;
            }

            driving = !driving;
            if (driving)
            {
                playerWasOnFoot = player != null && player.OnFoot;
                if (playerWasOnFoot) player.Hide();
                restoreFreeCamera = freeCamera != null && freeCamera.enabled;
                restoreWalker = playerWalker != null && playerWalker.enabled;
                if (freeCamera != null) freeCamera.enabled = false;
                if (playerWalker != null) playerWalker.enabled = false;

                chaseCamera.target = car.transform;
                chaseCamera.vehicle = car;
                chaseCamera.mode = ChaseCamera.Mode.Chase;
                chaseCamera.enabled = true;
                car.Enter();
                hud.enabled = true;
            }
            else
            {
                car.Exit();
                hud.enabled = false;
                chaseCamera.enabled = false;
                if (freeCamera != null) freeCamera.enabled = restoreFreeCamera;
                if (playerWalker != null) playerWalker.enabled = restoreWalker;
                if (playerWasOnFoot) player.ShowAt(ExitPoint(), car.transform.forward);
            }
        }
    }
}
