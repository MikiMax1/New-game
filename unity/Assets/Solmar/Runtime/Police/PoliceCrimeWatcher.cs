using Solmar.Traffic;
using Solmar.Vehicles;
using UnityEngine;

namespace Solmar.Police
{
    /// <summary>
    /// Watches the player's own car for two of <see cref="Police"/>'s crime triggers without touching
    /// <see cref="VehicleController"/> itself: <see cref="PoliceManager"/> auto-attaches one of these to
    /// every <see cref="VehicleController"/> it finds (mirrors how
    /// <see cref="Solmar.Vehicles.Damage.VehicleDamageBootstrap"/> attaches <c>VehicleDamage</c>).
    /// Ramming any police-liveried car hard reports a crime outright; crashing hard into ordinary
    /// traffic only counts if a police unit is close enough, with line of sight, to have witnessed it
    /// (<see cref="PoliceManager.AnyPoliceWitness"/>). The pedestrian-hit and speeding-past-police
    /// crimes are detected centrally in <see cref="PoliceManager"/> instead, since they need to watch
    /// pedestrians and continuous speed rather than a single collision.
    /// </summary>
    [RequireComponent(typeof(VehicleController))]
    public sealed class PoliceCrimeWatcher : MonoBehaviour
    {
        const float RamPoliceRelSpeed = 6f;
        const float CrashTrafficRelSpeed = 9f;
        const float WitnessRadius = 26f;
        const float ReportCooldown = 2.5f;

        VehicleController vehicle;
        float cooldown;

        void Awake() => vehicle = GetComponent<VehicleController>();

        void Update()
        {
            if (cooldown > 0f) cooldown -= Time.deltaTime;
        }

        void OnCollisionEnter(Collision collision) => Handle(collision);
        void OnCollisionStay(Collision collision) => Handle(collision);

        void Handle(Collision collision)
        {
            if (vehicle == null || !vehicle.IsPlayerControlled || cooldown > 0f) return;
            float rel = collision.relativeVelocity.magnitude;
            if (!float.IsFinite(rel)) return;
            Rigidbody otherRb = collision.rigidbody;
            if (otherRb == null) return;

            Vector3 point = collision.contactCount > 0 ? collision.GetContact(0).point : transform.position;

            if (rel >= RamPoliceRelSpeed && PoliceUtil.IsPoliceLivery(otherRb.transform))
            {
                Report(point, 1);
                return;
            }

            TrafficCar traffic = otherRb.GetComponent<TrafficCar>();
            if (traffic != null && rel >= CrashTrafficRelSpeed && PoliceManager.Instance != null && PoliceManager.Instance.AnyPoliceWitness(point, WitnessRadius))
            {
                Report(point, 1);
            }
        }

        void Report(Vector3 point, int stars)
        {
            cooldown = ReportCooldown;
            Police.ReportCrime(point, stars);
        }
    }
}
