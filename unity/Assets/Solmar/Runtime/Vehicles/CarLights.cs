using UnityEngine;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar.Vehicles
{
    /// <summary>
    /// Lets other code (the player's own input handling today, traffic AI later) switch a car's
    /// lamps on without reaching into its renderer's material list. <see cref="VehicleBody.Build"/>
    /// attaches one of these to the car's root and wires it to that car's own headlamp-lens and
    /// tail-lamp material instances (each Build call makes its own materials, so toggling one car's
    /// lights never affects another's).
    /// </summary>
    public sealed class CarLights : MonoBehaviour
    {
        Material headlampLens;
        Material tailLamp;
        float headlightNits;
        float tailIdleNits;
        float tailBrakeNits;
        bool configured;

        bool headlights;
        bool brake;

        /// <summary>Low beams on or off.</summary>
        public bool Headlights
        {
            get => headlights;
            set
            {
                if (headlights == value) return;
                headlights = value;
                Apply();
            }
        }

        /// <summary>Whether the brake lights are lit brighter than their idle glow.</summary>
        public bool Brake
        {
            get => brake;
            set
            {
                if (brake == value) return;
                brake = value;
                Apply();
            }
        }

        /// <summary>Wires this component to one car's own lamp material instances. Called once, right after <see cref="VehicleBody.Build"/> creates them.</summary>
        internal void Configure(Material headlampLens, float headlightNits, Material tailLamp, float tailIdleNits, float tailBrakeNits)
        {
            this.headlampLens = headlampLens;
            this.headlightNits = headlightNits;
            this.tailLamp = tailLamp;
            this.tailIdleNits = tailIdleNits;
            this.tailBrakeNits = tailBrakeNits;
            configured = true;
            Apply();
        }

        void Apply()
        {
            if (!configured) return;
            if (headlampLens != null)
            {
                HDMaterial.SetEmissiveIntensity(headlampLens, headlights ? headlightNits : 0f, EmissiveIntensityUnit.Nits);
                HDMaterial.ValidateMaterial(headlampLens);
            }
            if (tailLamp != null)
            {
                HDMaterial.SetEmissiveIntensity(tailLamp, brake ? tailBrakeNits : tailIdleNits, EmissiveIntensityUnit.Nits);
                HDMaterial.ValidateMaterial(tailLamp);
            }
        }
    }
}
