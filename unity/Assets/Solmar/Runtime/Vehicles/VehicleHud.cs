using UnityEngine;

namespace Solmar.Vehicles
{
    /// <summary>
    /// A small speedometer, bottom-right, shown only while driving: km/h, the current gear, an RPM
    /// bar that reddens near the redline, and an "ESC OFF" warning when stability control (X) is off.
    /// </summary>
    public sealed class VehicleHud : MonoBehaviour
    {
        public VehicleController vehicle;

        GUIStyle speedStyle;
        GUIStyle smallStyle;
        GUIStyle escStyle;

        void OnGUI()
        {
            if (vehicle == null) return;
            speedStyle ??= new GUIStyle(GUI.skin.label) { fontSize = 34, alignment = TextAnchor.MiddleRight, fontStyle = FontStyle.Bold };
            smallStyle ??= new GUIStyle(GUI.skin.label) { fontSize = 16, alignment = TextAnchor.MiddleRight };
            escStyle ??= new GUIStyle(GUI.skin.label) { fontSize = 15, alignment = TextAnchor.MiddleLeft, fontStyle = FontStyle.Bold };

            bool escOff = !vehicle.StabilityControlEnabled;
            float h = escOff ? 136f : 112f;
            const float w = 220f, margin = 20f;
            var rect = new Rect(Screen.width - w - margin, Screen.height - h - margin, w, h);
            GUI.color = new Color(0f, 0f, 0f, 0.55f);
            GUI.DrawTexture(rect, Texture2D.whiteTexture);
            GUI.color = Color.white;

            float speed = vehicle.SpeedKmh;
            if (!float.IsFinite(speed)) speed = 0f;
            GUI.Label(new Rect(rect.x, rect.y + 4f, rect.width - 14f, 46f), Mathf.RoundToInt(speed) + " km/h", speedStyle);
            GUI.Label(new Rect(rect.x, rect.y + 46f, rect.width - 14f, 24f), "gear " + vehicle.GearLabel, smallStyle);

            float redline = Mathf.Max(1f, vehicle.RedlineRpm);
            float rpmT = Mathf.Clamp01(vehicle.Rpm / redline);
            if (!float.IsFinite(rpmT)) rpmT = 0f;
            var barBack = new Rect(rect.x + 14f, rect.y + 72f, rect.width - 28f, 10f);
            GUI.color = new Color(1f, 1f, 1f, 0.25f);
            GUI.DrawTexture(barBack, Texture2D.whiteTexture);
            GUI.color = Color.Lerp(new Color(0.35f, 0.85f, 0.4f), new Color(0.95f, 0.25f, 0.2f), rpmT);
            GUI.DrawTexture(new Rect(barBack.x, barBack.y, barBack.width * rpmT, barBack.height), Texture2D.whiteTexture);
            GUI.color = Color.white;

            if (escOff)
            {
                escStyle.normal.textColor = new Color(0.95f, 0.75f, 0.15f);
                GUI.Label(new Rect(rect.x + 14f, rect.y + 92f, rect.width - 28f, 24f), "ESC OFF (X)", escStyle);
            }
        }
    }
}
