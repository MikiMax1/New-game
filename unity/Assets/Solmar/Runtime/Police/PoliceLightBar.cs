using Solmar.Vehicles;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Solmar.Police
{
    /// <summary>
    /// The flashing red/blue light bar on a <see cref="PoliceCar"/>: two real point lights at the bar
    /// (found from the same <see cref="CarSpec"/> numbers <see cref="Solmar.Vehicles.CarBuilder"/>
    /// bakes the bar mesh from) alternating red/blue, plus the baked "Light bar red"/"Light bar blue"
    /// lens materials on the body mesh flashed in step so the bar actually reads as lit up close.
    /// Silent while <see cref="SetFlashing"/> hasn't been told to turn on (a pooled, inactive cruiser).
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class PoliceLightBar : MonoBehaviour
    {
        const float FlashHz = 4.2f;
        const float PointLightLumen = 5000f;
        const float MaterialOnNits = 6000f;

        Light redLight, blueLight;
        Material redMat, blueMat;
        bool flashing;
        float phase;

        void Awake()
        {
            Transform body = transform.Find("Body");
            var renderer = body != null ? body.GetComponent<MeshRenderer>() : null;
            if (renderer != null)
            {
                Material[] mats = renderer.sharedMaterials;
                for (int i = 0; i < mats.Length; i++)
                {
                    if (mats[i] == null) continue;
                    if (redMat == null && mats[i].name == "Light bar red") redMat = mats[i];
                    else if (blueMat == null && mats[i].name == "Light bar blue") blueMat = mats[i];
                }
            }

            CarSpec spec = CarModels.Get(CarModel.Police);
            float barX = (spec.roofFront + spec.roofRear) * 0.5f;
            float barY = spec.roof + 0.1f;
            Vector3 redLocal = PoliceUtil.CarFrame.MultiplyPoint3x4(new Vector3(barX, barY, 0.16f));
            Vector3 blueLocal = PoliceUtil.CarFrame.MultiplyPoint3x4(new Vector3(barX, barY, -0.16f));

            redLight = CreatePointLight("Light bar red light", redLocal, new Color(1f, 0.05f, 0.03f));
            blueLight = CreatePointLight("Light bar blue light", blueLocal, new Color(0.05f, 0.2f, 1f));

            // Start dark: a pooled cruiser sits inactive until PoliceManager spawns it.
            SetEmissive(redMat, 0f);
            SetEmissive(blueMat, 0f);
        }

        Light CreatePointLight(string lightName, Vector3 localPos, Color color)
        {
            var go = new GameObject(lightName) { hideFlags = HideFlags.DontSave };
            go.transform.SetParent(transform, false);
            go.transform.localPosition = localPos;
            var light = go.AddComponent<Light>();
            light.type = LightType.Point;
            var hd = go.AddComponent<HDAdditionalLightData>();
            HDAdditionalLightData.InitDefaultHDAdditionalLightData(hd);
            light.color = color;
            light.range = 15f;
            light.lightUnit = LightUnit.Lumen;
            light.intensity = 0f;
            light.shadows = LightShadows.None;
            hd.EnableShadows(false);
            return light;
        }

        /// <summary>Starts or stops the flash; turning it off snaps everything dark immediately (a
        /// despawned or wrecked cruiser shouldn't keep strobing).</summary>
        public void SetFlashing(bool on)
        {
            flashing = on;
            if (on) return;
            if (redLight != null) redLight.intensity = 0f;
            if (blueLight != null) blueLight.intensity = 0f;
            SetEmissive(redMat, 0f);
            SetEmissive(blueMat, 0f);
        }

        void Update()
        {
            if (!flashing) return;
            phase += Time.deltaTime * FlashHz;
            if (phase > 1f) phase -= Mathf.Floor(phase);
            bool redOn = phase < 0.5f;

            if (redLight != null) redLight.intensity = redOn ? PointLightLumen : 0f;
            if (blueLight != null) blueLight.intensity = redOn ? 0f : PointLightLumen;
            SetEmissive(redMat, redOn ? MaterialOnNits : 0f);
            SetEmissive(blueMat, redOn ? 0f : MaterialOnNits);
        }

        static void SetEmissive(Material m, float nits)
        {
            if (m == null) return;
            HDMaterial.SetEmissiveIntensity(m, nits, EmissiveIntensityUnit.Nits);
        }
    }
}
