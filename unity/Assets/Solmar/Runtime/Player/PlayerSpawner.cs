using Solmar.City;
using UnityEngine;

namespace Solmar
{
    /// <summary>
    /// In Play mode, if the scene has a <see cref="SolmarCity"/> or a <see cref="City.Roads.SolmarDistrict"/>, spawns the third-person player on the pavement and switches the main camera to
    /// <see cref="OrbitCamera"/>, disabling <see cref="FreeCamera"/> and <see cref="PlayerWalker"/> on
    /// it. C toggles between that third-person player and the old free-fly camera.
    /// </summary>
    public sealed class PlayerSpawner : MonoBehaviour
    {
        // The last layer index: used only so the camera's collision sphere-cast (and the feet's
        // ground raycasts) can ignore the player's own capsule, without needing a named project layer.
        const int PlayerLayer = 31;
        const float SpawnX = 10f;
        const float SpawnZ = -11f;
        /// <summary>In the district: the pavement beside the avenue, halfway along its second block.</summary>
        const float DistrictSpawnX = City.Roads.DistrictGenerator.AvenueColumn * City.Roads.DistrictGenerator.BlockLengthX + 12.5f;
        const float DistrictSpawnZ = City.Roads.DistrictGenerator.BlockLengthZ * 1.5f;

        GameObject playerRoot;
        PlayerCharacter character;
        OrbitCamera orbitCamera;
        FreeCamera freeCamera;
        PlayerWalker playerWalker;
        bool thirdPerson = true;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void AddToScene()
        {
            bool hasCity = FindAnyObjectByType<SolmarCity>() != null || FindAnyObjectByType<City.Roads.SolmarDistrict>() != null;
            if (!hasCity || FindAnyObjectByType<PlayerSpawner>() != null) return;
            var go = new GameObject("Player spawner");
            go.AddComponent<PlayerSpawner>();
        }

        void Start()
        {
            Camera cam = Camera.main;
            if (cam == null) return;

            freeCamera = cam.GetComponent<FreeCamera>();
            playerWalker = cam.GetComponent<PlayerWalker>();

            playerRoot = new GameObject("Player");
            playerRoot.transform.position = SpawnPosition();

            character = playerRoot.AddComponent<PlayerCharacter>();
            character.cameraTransform = cam.transform;

            var bodyGo = new GameObject("Body");
            bodyGo.transform.SetParent(playerRoot.transform, false);
            PlayerBody body = bodyGo.AddComponent<PlayerBody>();
            body.character = character;
            body.groundMask = ~(1 << PlayerLayer);

            SetLayerRecursive(playerRoot, PlayerLayer);

            if (playerWalker != null) playerWalker.enabled = false;
            if (freeCamera != null) freeCamera.enabled = false;

            orbitCamera = cam.gameObject.AddComponent<OrbitCamera>();
            orbitCamera.target = playerRoot.transform;
            orbitCamera.collisionMask = ~(1 << PlayerLayer);

            thirdPerson = true;
        }

        /// <summary>A sensible spot on the pavement, found with a downward raycast so it sits on the
        /// generated street's colliders; falls back to the street's own height function if the city's
        /// colliders (<see cref="CityColliders"/>) haven't been added yet.</summary>
        static Vector3 SpawnPosition()
        {
            bool district = FindAnyObjectByType<SolmarCity>() == null;
            float x = district ? DistrictSpawnX : SpawnX;
            float z = district ? DistrictSpawnZ : SpawnZ;
            var from = new Vector3(x, 50f, z);
            if (Physics.Raycast(from, Vector3.down, out RaycastHit hit, 200f, ~(1 << PlayerLayer), QueryTriggerInteraction.Ignore))
            {
                return new Vector3(x, hit.point.y, z);
            }
            return new Vector3(x, district ? 0.15f : Street.Height(x, z), z);
        }

        /// <summary>True while the player is walking (not driving, not in the free-fly camera).</summary>
        public bool OnFoot => thirdPerson && playerRoot != null && playerRoot.activeSelf;

        /// <summary>Where the player is standing.</summary>
        public Vector3 Position => playerRoot != null ? playerRoot.transform.position : Vector3.zero;

        /// <summary>Takes the player out of the world while they drive.</summary>
        public void Hide()
        {
            if (playerRoot == null) return;
            playerRoot.SetActive(false);
            if (orbitCamera != null) orbitCamera.enabled = false;
        }

        /// <summary>Puts the player back on foot at `position`, facing `forward`, and gives them the camera.</summary>
        public void ShowAt(Vector3 position, Vector3 forward)
        {
            if (playerRoot == null) return;
            forward.y = 0f;
            playerRoot.transform.SetPositionAndRotation(position, forward.sqrMagnitude > 1e-4f ? Quaternion.LookRotation(forward) : playerRoot.transform.rotation);
            playerRoot.SetActive(true);
            thirdPerson = true;
            if (character != null) character.enabled = true;
            if (orbitCamera != null) orbitCamera.enabled = true;
            if (freeCamera != null) freeCamera.enabled = false;
        }

        static void SetLayerRecursive(GameObject go, int layer)
        {
            go.layer = layer;
            foreach (Transform child in go.transform) SetLayerRecursive(child.gameObject, layer);
        }

#if ENABLE_LEGACY_INPUT_MANAGER
        void Update()
        {
            if (playerRoot == null || !playerRoot.activeSelf) return;
            if (Input.GetKeyDown(KeyCode.C)) ToggleThirdPerson();
        }
#endif

        void ToggleThirdPerson()
        {
            thirdPerson = !thirdPerson;
            if (character != null) character.enabled = thirdPerson;
            if (orbitCamera != null) orbitCamera.enabled = thirdPerson;
            if (freeCamera != null) freeCamera.enabled = !thirdPerson;
        }
    }
}
