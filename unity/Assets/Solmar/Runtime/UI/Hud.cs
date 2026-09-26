using System.Collections.Generic;
using System.Globalization;
using Solmar.City;
using Solmar.City.Roads;
using Solmar.Vehicles;
using UnityEngine;
using WeatherSystem = Solmar.Weather.Weather;

namespace Solmar.UI
{
    /// <summary>
    /// The GTA-style HUD: a minimap bottom-left (rotated to the player's heading, zooming out with
    /// speed), health/armour bars under it, money and a wanted row top-right, a clock and the current
    /// weather, and an M-toggled full-screen map (pan by dragging, zoom by scrolling, right-click to
    /// set or clear a waypoint) with an A* route drawn in purple on both.
    ///
    /// Tracks whichever of these exists: the car the player is driving, the on-foot player ("Player"),
    /// or <see cref="Camera.main"/> as a last resort. Bootstrapped like <see cref="Weather.Weather"/>
    /// and <see cref="QualityPresets"/>, into any Play-mode scene with a city or district.
    /// </summary>
    public sealed class Hud : MonoBehaviour
    {
        const float RescanInterval = 0.5f;
        const float WaypointReachedMetres = 9f;
        const float FullMapMinZoom = 0.05f;
        const float FullMapMaxZoom = 1f;

        VehicleController cachedCar;
        Transform cachedPlayerWalker;
        TimeOfDay cachedTimeOfDay;
        float rescanTimer;

        bool fullMapOpen;
        Vector2 fullMapCenterUV = new Vector2(0.5f, 0.5f);
        float fullMapZoom = 1f;

        Vector2? waypointWorld;
        List<Vector2> currentRoute;
        Texture2D routeBuiltForTexture;

        GUIStyle topRightStyle;
        GUIStyle fullMapHintStyle;

        /// <summary>Adds the HUD to any Play-mode scene with a city or district, the same way
        /// Weather and QualityPresets add themselves.</summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Bootstrap()
        {
            if ((FindAnyObjectByType<SolmarCity>() == null && FindAnyObjectByType<SolmarDistrict>() == null) || FindAnyObjectByType<Hud>() != null) return;
            new GameObject("Hud").AddComponent<Hud>();
        }

        void Update()
        {
            float dt = Time.unscaledDeltaTime;

#if ENABLE_LEGACY_INPUT_MANAGER
            if (Input.GetKeyDown(KeyCode.M))
            {
                fullMapOpen = !fullMapOpen;
                if (fullMapOpen) { fullMapCenterUV = new Vector2(0.5f, 0.5f); fullMapZoom = 1f; }
            }
#endif

            rescanTimer += dt;
            if (rescanTimer >= RescanInterval)
            {
                RescanTargets();
                rescanTimer = 0f;
            }

            CheckWaypointReached();
        }

        void RescanTargets()
        {
            cachedCar = null;
            foreach (VehicleController vc in FindObjectsByType<VehicleController>(FindObjectsSortMode.None))
            {
                if (vc.IsPlayerControlled) { cachedCar = vc; break; }
            }

            if (cachedCar == null)
            {
                GameObject playerGO = GameObject.Find("Player");
                cachedPlayerWalker = playerGO != null ? playerGO.transform : null;
            }
            else
            {
                cachedPlayerWalker = null;
            }

            // The city can regenerate and replace its TimeOfDay, so keep re-finding it (mirrors Weather).
            cachedTimeOfDay = FindAnyObjectByType<TimeOfDay>();
        }

        void ResolveTarget(out Vector3 position, out float headingDeg, out float speedKmh)
        {
            Transform t;
            if (cachedCar != null && cachedCar.IsPlayerControlled)
            {
                t = cachedCar.transform;
                speedKmh = cachedCar.SpeedKmh;
            }
            else if (cachedPlayerWalker != null)
            {
                t = cachedPlayerWalker;
                speedKmh = 0f;
            }
            else if (Camera.main != null)
            {
                t = Camera.main.transform;
                speedKmh = 0f;
            }
            else
            {
                position = Vector3.zero;
                headingDeg = 0f;
                speedKmh = 0f;
                return;
            }

            position = t.position;
            Vector3 fwd = t.forward;
            headingDeg = (Mathf.Abs(fwd.x) > 1e-5f || Mathf.Abs(fwd.z) > 1e-5f) ? Mathf.Atan2(fwd.x, fwd.z) * Mathf.Rad2Deg : 0f;
            if (!float.IsFinite(headingDeg)) headingDeg = 0f;
            if (!float.IsFinite(speedKmh)) speedKmh = 0f;
        }

        void CheckWaypointReached()
        {
            if (!waypointWorld.HasValue) return;
            ResolveTarget(out Vector3 pos, out _, out _);
            var xz = new Vector2(pos.x, pos.z);
            if ((xz - waypointWorld.Value).sqrMagnitude <= WaypointReachedMetres * WaypointReachedMetres) ClearWaypoint();
        }

        void SetWaypoint(Vector2 worldXZ)
        {
            waypointWorld = worldXZ;
            RecomputeRoute();
        }

        void ClearWaypoint()
        {
            waypointWorld = null;
            currentRoute = null;
            RouteOverlay.Instance.Clear();
        }

        void RecomputeRoute()
        {
            if (!waypointWorld.HasValue) return;
            ResolveTarget(out Vector3 pos, out _, out _);
            currentRoute = RoutePlanner.FindRoute(RoadGraph.Current, new Vector2(pos.x, pos.z), waypointWorld.Value);
            RouteOverlay.Instance.SetRoute(RoadMapTexture.Instance, currentRoute);
            routeBuiltForTexture = RoadMapTexture.Instance.Texture;
        }

        void OnGUI()
        {
            HudIcons.EnsureBuilt();
            RoadMapTexture map = RoadMapTexture.Instance;
            map.EnsureCurrent();
            if (!map.Ready) return;

            // The road texture can be rebaked (regenerated map) without our knowing; if a route is
            // active, rebuild the overlay against whatever texture is current now.
            if (waypointWorld.HasValue && map.Texture != routeBuiltForTexture) RecomputeRoute();

            ResolveTarget(out Vector3 posV, out float headingDeg, out float speedKmh);
            var targetXZ = new Vector2(posV.x, posV.z);

            float uiScale = Mathf.Max(0.6f, Screen.height / 1080f);

            Rect minimapRect = DrawMinimap(map, targetXZ, headingDeg, speedKmh, uiScale);
            DrawStatusBars(minimapRect, uiScale);
            DrawTopRight(uiScale);

            if (fullMapOpen) DrawFullMap(map, targetXZ, headingDeg, uiScale);
        }

        Rect DrawMinimap(RoadMapTexture map, Vector2 targetXZ, float headingDeg, float speedKmh, float uiScale)
        {
            float size = 190f * uiScale;
            float margin = 18f * uiScale;
            var outer = new Rect(margin, Screen.height - size - margin, size, size);

            Color prevColor = GUI.color;
            GUI.BeginGroup(outer);
            var pivot = new Vector2(size * 0.5f, size * 0.5f);
            Matrix4x4 savedMatrix = GUI.matrix;
            // Rotate the whole map opposite the player's heading so their forward direction always
            // points up; GUIUtility.RotateAroundPivot is clockwise-positive, world yaw increases
            // clockwise too, so counter-rotating by -heading keeps "ahead" pointing to screen-up.
            GUIUtility.RotateAroundPivot(-headingDeg, pivot);

            float zoomMetres = Mathf.Clamp(150f + speedKmh * 1.1f, 150f, 420f);
            Vector2 uv = map.WorldToUV(targetXZ);
            float uSize = zoomMetres * map.PixelsPerMetre / map.Texture.width;
            float vSize = zoomMetres * map.PixelsPerMetre / map.Texture.height;
            var texCoords = new Rect(uv.x - uSize * 0.5f, uv.y - vSize * 0.5f, uSize, vSize);

            float big = size * 1.5f; // covers the corners once rotated
            var destLocal = new Rect(pivot.x - big * 0.5f, pivot.y - big * 0.5f, big, big);

            GUI.color = Color.white;
            GUI.DrawTextureWithTexCoords(destLocal, map.Texture, texCoords, false);
            if (RouteOverlay.Instance.Ready) GUI.DrawTextureWithTexCoords(destLocal, RouteOverlay.Instance.Texture, texCoords, true);

            GUI.matrix = savedMatrix;

            float arrowSize = 22f * uiScale;
            GUI.color = new Color(1f, 1f, 1f, 0.97f);
            GUI.DrawTexture(new Rect(pivot.x - arrowSize * 0.5f, pivot.y - arrowSize * 0.5f, arrowSize, arrowSize), HudIcons.Arrow);

            GUI.color = prevColor;
            GUI.EndGroup();

            GUI.color = new Color(0.02f, 0.02f, 0.03f, 0.92f);
            GUI.DrawTexture(outer, HudIcons.RingFrame);
            GUI.color = prevColor;

            return outer;
        }

        void DrawStatusBars(Rect minimapRect, float uiScale)
        {
            float barW = minimapRect.width;
            float barH = 9f * uiScale;
            float gap = 4f * uiScale;
            float x = minimapRect.x;
            float y = minimapRect.yMax + 6f * uiScale;

            DrawBar(new Rect(x, y, barW, barH), PlayerStats.Health / Mathf.Max(1f, PlayerStats.MaxHealth), new Color(0.85f, 0.16f, 0.16f));
            DrawBar(new Rect(x, y + barH + gap, barW, barH), PlayerStats.Armour / Mathf.Max(1f, PlayerStats.MaxArmour), new Color(0.28f, 0.58f, 0.95f));
        }

        static void DrawBar(Rect r, float fraction, Color fillColor)
        {
            fraction = float.IsFinite(fraction) ? Mathf.Clamp01(fraction) : 0f;
            Color prev = GUI.color;
            GUI.color = new Color(0f, 0f, 0f, 0.55f);
            GUI.DrawTexture(r, Texture2D.whiteTexture);
            GUI.color = fillColor;
            GUI.DrawTexture(new Rect(r.x + 1f, r.y + 1f, (r.width - 2f) * fraction, r.height - 2f), Texture2D.whiteTexture);
            GUI.color = prev;
        }

        void DrawTopRight(float uiScale)
        {
            float pad = 16f * uiScale;
            float lineH = 27f * uiScale;
            float w = 280f * uiScale;
            float y = pad;

            topRightStyle ??= new GUIStyle(GUI.skin.label) { alignment = TextAnchor.UpperRight, fontStyle = FontStyle.Bold };
            topRightStyle.fontSize = Mathf.RoundToInt(20f * uiScale);

            string moneyText = "$" + PlayerStats.Money.ToString("N0", CultureInfo.InvariantCulture);
            DrawShadowedLabel(new Rect(Screen.width - w - pad, y, w, lineH), moneyText, topRightStyle, new Color(0.35f, 0.95f, 0.4f));
            y += lineH;

            if (PlayerStats.WantedRecentlyChanged)
            {
                DrawWantedStars(Screen.width - pad, y + 3f * uiScale, uiScale);
                y += lineH;
            }

            if (cachedTimeOfDay != null)
            {
                int totalMinutes = Mathf.RoundToInt(Mathf.Repeat(cachedTimeOfDay.Hours, 24f) * 60f) % 1440;
                string clockText = $"{totalMinutes / 60:00}:{totalMinutes % 60:00}";
                DrawShadowedLabel(new Rect(Screen.width - w - pad, y, w, lineH), clockText, topRightStyle, Color.white);
                y += lineH;
            }

            string weatherText = WeatherDisplayName(WeatherSystem.Current);
            DrawShadowedLabel(new Rect(Screen.width - w - pad, y, w, lineH), weatherText, topRightStyle, new Color(0.8f, 0.85f, 0.95f));
        }

        static void DrawShadowedLabel(Rect r, string text, GUIStyle style, Color color)
        {
            Color prevGui = GUI.color;
            Color prevText = style.normal.textColor;
            style.normal.textColor = new Color(0f, 0f, 0f, 0.7f);
            GUI.Label(new Rect(r.x + 1.5f, r.y + 1.5f, r.width, r.height), text, style);
            style.normal.textColor = color;
            GUI.Label(r, text, style);
            style.normal.textColor = prevText;
            GUI.color = prevGui;
        }

        static void DrawWantedStars(float rightEdgeX, float y, float uiScale)
        {
            float starSize = 20f * uiScale;
            float spacing = 2f * uiScale;
            float totalWidth = 5f * starSize + 4f * spacing;
            float startX = rightEdgeX - totalWidth;

            Color prev = GUI.color;
            for (int i = 0; i < 5; i++)
            {
                float x = startX + i * (starSize + spacing);
                bool filled = i < PlayerStats.WantedLevel;
                GUI.color = filled ? new Color(1f, 0.82f, 0.15f, 1f) : new Color(1f, 1f, 1f, 0.22f);
                GUI.DrawTexture(new Rect(x, y, starSize, starSize), HudIcons.Star);
            }
            GUI.color = prev;
        }

        static string WeatherDisplayName(WeatherSystem.Kind kind)
        {
            switch (kind)
            {
                case WeatherSystem.Kind.Clear: return "Clear";
                case WeatherSystem.Kind.HumidHaze: return "Humid haze";
                case WeatherSystem.Kind.Overcast: return "Overcast";
                case WeatherSystem.Kind.Rain: return "Rain";
                case WeatherSystem.Kind.Thunderstorm: return "Thunderstorm";
                default: return kind.ToString();
            }
        }

        void DrawFullMap(RoadMapTexture map, Vector2 targetXZ, float headingDeg, float uiScale)
        {
            float margin = 46f * uiScale;
            var avail = new Rect(margin, margin, Screen.width - 2f * margin, Screen.height - 2f * margin);
            if (avail.width <= 1f || avail.height <= 1f) return;

            float texAspect = map.Texture.width / (float)map.Texture.height;
            float availAspect = avail.width / avail.height;
            Rect dest;
            if (availAspect > texAspect)
            {
                float w = avail.height * texAspect;
                dest = new Rect(avail.x + (avail.width - w) * 0.5f, avail.y, w, avail.height);
            }
            else
            {
                float h = avail.width / texAspect;
                dest = new Rect(avail.x, avail.y + (avail.height - h) * 0.5f, avail.width, h);
            }

            Color prev = GUI.color;
            GUI.color = new Color(0f, 0f, 0f, 0.55f);
            GUI.DrawTexture(new Rect(0f, 0f, Screen.width, Screen.height), Texture2D.whiteTexture);
            GUI.color = new Color(0.05f, 0.05f, 0.06f, 0.92f);
            float pad = 8f * uiScale;
            GUI.DrawTexture(new Rect(dest.x - pad, dest.y - pad, dest.width + 2f * pad, dest.height + 2f * pad), Texture2D.whiteTexture);

            float half = fullMapZoom * 0.5f;
            Vector2 c = fullMapCenterUV;
            c.x = Mathf.Clamp(c.x, half, 1f - half);
            c.y = Mathf.Clamp(c.y, half, 1f - half);
            fullMapCenterUV = c;
            var texCoords = new Rect(c.x - half, c.y - half, fullMapZoom, fullMapZoom);

            GUI.color = Color.white;
            GUI.DrawTextureWithTexCoords(dest, map.Texture, texCoords, false);
            if (RouteOverlay.Instance.Ready) GUI.DrawTextureWithTexCoords(dest, RouteOverlay.Instance.Texture, texCoords, true);

            Vector2 targetUV = map.WorldToUV(targetXZ);
            if (texCoords.Contains(targetUV))
            {
                Vector2 screenPos = UVToScreen(targetUV, dest, texCoords);
                float arrowSize = 22f * uiScale;
                Matrix4x4 savedMatrix = GUI.matrix;
                // The full map never rotates, so the arrow itself carries the heading directly.
                GUIUtility.RotateAroundPivot(headingDeg, screenPos);
                GUI.color = Color.white;
                GUI.DrawTexture(new Rect(screenPos.x - arrowSize * 0.5f, screenPos.y - arrowSize * 0.5f, arrowSize, arrowSize), HudIcons.Arrow);
                GUI.matrix = savedMatrix;
            }
            GUI.color = prev;

            HandleFullMapInput(dest, texCoords, map);

            fullMapHintStyle ??= new GUIStyle(GUI.skin.label) { alignment = TextAnchor.UpperLeft };
            fullMapHintStyle.fontSize = Mathf.RoundToInt(15f * uiScale);
            GUI.color = new Color(1f, 1f, 1f, 0.85f);
            GUI.Label(new Rect(dest.x, dest.y - 24f * uiScale, dest.width, 22f * uiScale),
                "M: close   drag: pan   scroll: zoom   right-click: set/clear waypoint", fullMapHintStyle);
            GUI.color = prev;
        }

        void HandleFullMapInput(Rect dest, Rect texCoords, RoadMapTexture map)
        {
            Event e = Event.current;
            if (e == null || dest.width <= 0f || dest.height <= 0f) return;
            bool overMap = dest.Contains(e.mousePosition);

            if (e.type == EventType.ScrollWheel && overMap)
            {
                float factor = Mathf.Pow(0.9f, -e.delta.y);
                if (float.IsFinite(factor)) fullMapZoom = Mathf.Clamp(fullMapZoom * factor, FullMapMinZoom, FullMapMaxZoom);
                e.Use();
            }
            else if (e.type == EventType.MouseDrag && e.button == 0 && overMap)
            {
                float duPerPixel = texCoords.width / dest.width;
                float dvPerPixel = texCoords.height / dest.height;
                fullMapCenterUV -= new Vector2(e.delta.x * duPerPixel, -e.delta.y * dvPerPixel);
                e.Use();
            }
            else if (e.type == EventType.MouseDown && e.button == 1 && overMap)
            {
                if (waypointWorld.HasValue) ClearWaypoint();
                else SetWaypoint(map.UVToWorld(ScreenToUV(e.mousePosition, dest, texCoords)));
                e.Use();
            }
        }

        static Vector2 ScreenToUV(Vector2 screenPos, Rect dest, Rect texCoords)
        {
            float lx = (screenPos.x - dest.x) / dest.width;
            float ly = (screenPos.y - dest.y) / dest.height;
            float u = texCoords.x + lx * texCoords.width;
            float v = texCoords.y + (1f - ly) * texCoords.height;
            return new Vector2(u, v);
        }

        static Vector2 UVToScreen(Vector2 uv, Rect dest, Rect texCoords)
        {
            float lx = (uv.x - texCoords.x) / texCoords.width;
            float ly = 1f - (uv.y - texCoords.y) / texCoords.height;
            return new Vector2(dest.x + lx * dest.width, dest.y + ly * dest.height);
        }
    }
}
