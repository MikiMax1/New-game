using System.Globalization;
using Solmar.City.Roads;
using UnityEngine;

namespace Solmar.Menus
{
    /// <summary>
    /// The GTA-style pause menu: Esc (when the cursor isn't locked - if it's locked, the first Esc
    /// just frees it as PlayerWalker/OrbitCamera already do, and a second Esc opens the menu) or P
    /// opens a full-screen, time-frozen menu with tabs for Resume, Map, Settings, Stats, Save game,
    /// Load game and Quit to desktop. Settings persist in PlayerPrefs via <see cref="GameSettings"/>;
    /// saves are three JSON slots plus an autosave (every five minutes) via <see cref="SaveSystem"/>.
    /// Navigable with the arrow keys, Enter and Esc, or with the mouse; drawn at a virtual 1080-tall
    /// canvas scaled by Screen.height/1080 so it reads the same at any resolution.
    /// </summary>
    public sealed class PauseMenu : MonoBehaviour
    {
        enum Tab { Resume, Map, Settings, Stats, SaveGame, LoadGame, Quit }
        static readonly Tab[] Tabs = { Tab.Resume, Tab.Map, Tab.Settings, Tab.Stats, Tab.SaveGame, Tab.LoadGame, Tab.Quit };
        static readonly string[] TabNames = { "Resume", "Map", "Settings", "Stats", "Save game", "Load game", "Quit" };

        const float AutosaveIntervalSeconds = 300f;
        const float SavingSpinnerSeconds = 1.4f;
        const float MessageSeconds = 2.5f;

        bool paused;
        bool cursorWasLockedLastFrame;
        bool lockedBeforePause;
        int currentTab;
        /// <summary>-1: the tab bar has focus (arrows switch tabs). 0+: a row in the current tab's
        /// content has focus (arrows adjust/select it; Up from row 0 returns focus to the tab bar).</summary>
        int focusIndex = -1;

        float autosaveTimer;
        float savingSpinnerTimer;
        string actionMessage = "";
        float actionMessageTimer;

        GUIStyle labelStyle, hintStyle, rowLabelStyle, valueStyle, tabStyle, buttonStyle;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void AddToScene()
        {
            if ((FindAnyObjectByType<Solmar.SolmarCity>() == null && FindAnyObjectByType<SolmarDistrict>() == null) || FindAnyObjectByType<PauseMenu>() != null) return;
            GameSettings.Load();
            GameSettings.Apply();
            new GameObject("Pause menu").AddComponent<PauseMenu>();
        }

        void Update()
        {
            float dt = Time.unscaledDeltaTime;

            autosaveTimer += dt;
            if (autosaveTimer >= AutosaveIntervalSeconds)
            {
                autosaveTimer = 0f;
                SaveSystem.SaveAutosave();
                savingSpinnerTimer = SavingSpinnerSeconds;
            }
            if (savingSpinnerTimer > 0f) savingSpinnerTimer -= dt;
            if (actionMessageTimer > 0f) actionMessageTimer -= dt;

#if ENABLE_LEGACY_INPUT_MANAGER
            bool escDown = Input.GetKeyDown(KeyCode.Escape);
            bool pDown = Input.GetKeyDown(KeyCode.P);

            if (paused)
            {
                if (escDown || pDown) { Resume(); }
                else HandleMenuInput();
            }
            else
            {
                if (pDown) Open();
                else if (escDown && !cursorWasLockedLastFrame) Open();
            }
#endif
        }

        /// <summary>Captured after every script's Update this frame (LateUpdate always runs after all
        /// Updates, whatever the relative script order), so next frame's Escape decision reflects the
        /// cursor state from *before* PlayerWalker/OrbitCamera may have unlocked it this frame - that's
        /// what makes "first Esc frees the cursor, second opens the menu" work regardless of script
        /// execution order.</summary>
        void LateUpdate()
        {
            cursorWasLockedLastFrame = Cursor.lockState == CursorLockMode.Locked;
        }

        void Open()
        {
            paused = true;
            currentTab = (int)Tab.Resume;
            focusIndex = -1;
            lockedBeforePause = Cursor.lockState == CursorLockMode.Locked;
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
            Time.timeScale = 0f;
            AudioListener.pause = true;
        }

        void Resume()
        {
            paused = false;
            Time.timeScale = 1f;
            AudioListener.pause = false;
            if (lockedBeforePause)
            {
                Cursor.lockState = CursorLockMode.Locked;
                Cursor.visible = false;
            }
        }

#if ENABLE_LEGACY_INPUT_MANAGER
        void HandleMenuInput()
        {
            bool left = Input.GetKeyDown(KeyCode.LeftArrow);
            bool right = Input.GetKeyDown(KeyCode.RightArrow);
            bool up = Input.GetKeyDown(KeyCode.UpArrow);
            bool down = Input.GetKeyDown(KeyCode.DownArrow);
            bool enter = Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.KeypadEnter);

            int rowCount = RowCount((Tab)currentTab);

            if (focusIndex < 0)
            {
                if (left) currentTab = (currentTab - 1 + Tabs.Length) % Tabs.Length;
                if (right) currentTab = (currentTab + 1) % Tabs.Length;
                if (down && rowCount > 0) focusIndex = 0;
                if (enter) ActivateRow((Tab)currentTab, 0, 0);
            }
            else
            {
                if (up)
                {
                    focusIndex--;
                    if (focusIndex < 0) focusIndex = -1;
                }
                if (down && focusIndex < rowCount - 1) focusIndex++;
                if (left) AdjustRow((Tab)currentTab, focusIndex, -1);
                if (right) AdjustRow((Tab)currentTab, focusIndex, 1);
                if (enter) ActivateRow((Tab)currentTab, focusIndex, 0);
            }
        }
#endif

        static int RowCount(Tab tab)
        {
            switch (tab)
            {
                case Tab.Resume: return 1;
                case Tab.Map: return 1;
                case Tab.Settings: return 12;
                case Tab.Stats: return 0;
                case Tab.SaveGame: return SaveSystem.SlotCount;
                case Tab.LoadGame: return SaveSystem.SlotCount + 1;
                case Tab.Quit: return 1;
                default: return 0;
            }
        }

        void ActivateRow(Tab tab, int row, int direction)
        {
            switch (tab)
            {
                case Tab.Resume:
                case Tab.Map:
                    Resume();
                    break;
                case Tab.Settings:
                    AdjustRow(tab, row, direction != 0 ? direction : 1);
                    break;
                case Tab.SaveGame:
                    SaveSystem.SaveToSlot(row);
                    Flash("Saved to slot " + (row + 1));
                    break;
                case Tab.LoadGame:
                    if (row < SaveSystem.SlotCount)
                    {
                        if (SaveSystem.LoadFromSlot(row)) Flash("Loaded slot " + (row + 1));
                        else Flash("Slot " + (row + 1) + " is empty");
                    }
                    else
                    {
                        if (SaveSystem.LoadAutosave()) Flash("Loaded autosave");
                        else Flash("No autosave yet");
                    }
                    break;
                case Tab.Quit:
                    QuitToDesktop();
                    break;
            }
        }

        void AdjustRow(Tab tab, int row, int direction)
        {
            if (tab != Tab.Settings || direction == 0) return;
            switch (row)
            {
                case 0: GameSettings.Preset = Mathf.Clamp(GameSettings.Preset + direction, 0, GameSettings.PresetCount - 1); break;
                case 1: GameSettings.FpsCap = CycleFpsCap(GameSettings.FpsCap, direction); break;
                case 2: GameSettings.Fov = Mathf.Clamp(GameSettings.Fov + direction * 2f, 50f, 100f); break;
                case 3: GameSettings.MotionBlur = !GameSettings.MotionBlur; break;
                case 4: GameSettings.CameraShake = !GameSettings.CameraShake; break;
                case 5: GameSettings.MasterVolume = Mathf.Clamp01(GameSettings.MasterVolume + direction * 0.05f); break;
                case 6: GameSettings.SfxVolume = Mathf.Clamp01(GameSettings.SfxVolume + direction * 0.05f); break;
                case 7: GameSettings.MouseSensitivity = Mathf.Clamp(GameSettings.MouseSensitivity + direction * 0.1f, 0.1f, 4f); break;
                case 8: GameSettings.InvertY = !GameSettings.InvertY; break;
                case 9: GameSettings.Subtitles = !GameSettings.Subtitles; break;
                case 10: GameSettings.HudEnabled = !GameSettings.HudEnabled; break;
                case 11: GameSettings.MinimapZoom = Mathf.Clamp(GameSettings.MinimapZoom + direction * 0.1f, 0.5f, 2f); break;
            }
            GameSettings.Save();
            GameSettings.Apply();
        }

        static int CycleFpsCap(int current, int direction)
        {
            int[] choices = GameSettings.FpsCapChoices;
            int i = System.Array.IndexOf(choices, current);
            if (i < 0) i = 0;
            i = (i + direction + choices.Length) % choices.Length;
            return choices[i];
        }

        void Flash(string message)
        {
            actionMessage = message;
            actionMessageTimer = MessageSeconds;
        }

        static void QuitToDesktop()
        {
#if UNITY_EDITOR
            UnityEditor.EditorApplication.isPlaying = false;
#else
            Application.Quit();
#endif
        }

        // ---- Drawing ----

        void OnGUI()
        {
            float scale = Mathf.Max(0.4f, Screen.height / 1080f);
            Matrix4x4 prevMatrix = GUI.matrix;
            GUIUtility.ScaleAroundPivot(new Vector2(scale, scale), Vector2.zero);
            float vw = Screen.width / scale;
            const float vh = 1080f;

            DrawSavingSpinner(vw);
            if (paused) DrawMenu(vw, vh);

            GUI.matrix = prevMatrix;
        }

        void DrawSavingSpinner(float vw)
        {
            if (savingSpinnerTimer <= 0f) return;
            labelStyle ??= new GUIStyle(GUI.skin.label) { fontSize = 18, alignment = TextAnchor.UpperRight };
            string dots = new string('.', 1 + Mathf.FloorToInt(Time.unscaledTime * 3f) % 3);
            var rect = new Rect(vw - 220f, 16f, 200f, 30f);
            MenuGfx.Panel(rect, MenuGfx.PanelDark);
            Color prev = labelStyle.normal.textColor;
            labelStyle.normal.textColor = MenuGfx.Cyan;
            GUI.Label(rect, "Saving" + dots, labelStyle);
            labelStyle.normal.textColor = prev;
        }

        void DrawMenu(float vw, float vh)
        {
            MenuGfx.Panel(new Rect(0f, 0f, vw, vh), new Color(0.02f, 0.015f, 0.04f, 0.82f));

            MenuGfx.GradientTitle(vw * 0.5f, 34f, "SOLMAR", 54);

            float tabsY = 120f;
            DrawTabs(vw, tabsY);

            var content = new Rect(vw * 0.5f - 430f, tabsY + 70f, 860f, vh - tabsY - 160f);
            MenuGfx.Panel(content, MenuGfx.PanelDark);
            MenuGfx.HLine(content.x, content.y, content.width, 2f, new Color(1f, 1f, 1f, 0.06f));

            switch ((Tab)currentTab)
            {
                case Tab.Resume: DrawResume(content); break;
                case Tab.Map: DrawMap(content); break;
                case Tab.Settings: DrawSettings(content); break;
                case Tab.Stats: DrawStats(content); break;
                case Tab.SaveGame: DrawSaveGame(content); break;
                case Tab.LoadGame: DrawLoadGame(content); break;
                case Tab.Quit: DrawQuit(content); break;
            }

            if (actionMessageTimer > 0f)
            {
                labelStyle ??= new GUIStyle(GUI.skin.label);
                labelStyle.fontSize = 18;
                labelStyle.alignment = TextAnchor.MiddleCenter;
                labelStyle.normal.textColor = MenuGfx.Pink;
                GUI.Label(new Rect(vw * 0.5f - 300f, content.yMax + 10f, 600f, 28f), actionMessage, labelStyle);
            }

            hintStyle ??= new GUIStyle(GUI.skin.label) { fontSize = 15, alignment = TextAnchor.LowerCenter };
            hintStyle.normal.textColor = new Color(1f, 1f, 1f, 0.6f);
            GUI.Label(new Rect(vw * 0.5f - 400f, vh - 40f, 800f, 26f),
                "← → tabs   ↑ ↓ select   Enter: choose   Esc / P: close", hintStyle);
        }

        void DrawTabs(float vw, float y)
        {
            tabStyle ??= new GUIStyle(GUI.skin.button) { fontSize = 20, fontStyle = FontStyle.Bold };
            float totalWidth = vw * 0.7f;
            float x = vw * 0.5f - totalWidth * 0.5f;
            float w = totalWidth / Tabs.Length;
            for (int i = 0; i < Tabs.Length; i++)
            {
                var rect = new Rect(x + i * w + 3f, y, w - 6f, 44f);
                bool selected = i == currentTab;
                bool focused = selected && focusIndex < 0;
                if (MenuGfx.Button(rect, TabNames[i], focused || selected, tabStyle))
                {
                    currentTab = i;
                    focusIndex = -1;
                }
            }
        }

        void DrawResume(Rect content)
        {
            rowLabelStyle ??= new GUIStyle(GUI.skin.label) { fontSize = 20, alignment = TextAnchor.MiddleCenter };
            rowLabelStyle.normal.textColor = Color.white;
            GUI.Label(new Rect(content.x, content.y + 30f, content.width, 40f), "Game paused", rowLabelStyle);
            DrawBigButton(content, 0, "Resume", () => Resume());
        }

        void DrawMap(Rect content)
        {
            rowLabelStyle ??= new GUIStyle(GUI.skin.label) { fontSize = 18, alignment = TextAnchor.MiddleCenter, wordWrap = true };
            rowLabelStyle.normal.textColor = new Color(0.9f, 0.9f, 0.95f);
            GUI.Label(new Rect(content.x + 60f, content.y + 40f, content.width - 120f, 90f),
                "The full map lives on the HUD - press M in the world to open it.", rowLabelStyle);
            DrawBigButton(content, 0, "Resume", () => Resume());
        }

        void DrawStats(Rect content)
        {
            float y = content.y + 30f;
            const float lineH = 40f;
            DrawStatLine(content, ref y, lineH, "Time played", FormatDuration(GameStats.TimePlayedSeconds));
            DrawStatLine(content, ref y, lineH, "Distance walked", FormatDistance(GameStats.DistanceWalkedMetres));
            DrawStatLine(content, ref y, lineH, "Distance driven", FormatDistance(GameStats.DistanceDrivenMetres));
            DrawStatLine(content, ref y, lineH, "Cars damaged", GameStats.CarsDamaged.ToString(CultureInfo.InvariantCulture));
            DrawStatLine(content, ref y, lineH, "Max wanted level", GameStats.MaxWantedLevel.ToString(CultureInfo.InvariantCulture));
            DrawStatLine(content, ref y, lineH, "Money", "$" + UI.PlayerStats.Money.ToString("N0", CultureInfo.InvariantCulture));
        }

        void DrawStatLine(Rect content, ref float y, float lineH, string label, string value)
        {
            rowLabelStyle ??= new GUIStyle(GUI.skin.label) { fontSize = 20 };
            valueStyle ??= new GUIStyle(GUI.skin.label) { fontSize = 20, alignment = TextAnchor.MiddleRight };
            rowLabelStyle.normal.textColor = new Color(0.85f, 0.85f, 0.9f);
            valueStyle.normal.textColor = MenuGfx.Cyan;
            GUI.Label(new Rect(content.x + 60f, y, content.width * 0.5f, lineH), label, rowLabelStyle);
            GUI.Label(new Rect(content.x + content.width * 0.5f, y, content.width - content.width * 0.5f - 60f, lineH), value, valueStyle);
            y += lineH;
        }

        static string FormatDuration(float seconds)
        {
            int total = Mathf.FloorToInt(seconds);
            int h = total / 3600, m = total / 60 % 60, s = total % 60;
            return h > 0 ? $"{h}h {m:00}m {s:00}s" : $"{m}m {s:00}s";
        }

        static string FormatDistance(float metres) => metres >= 1000f ? (metres / 1000f).ToString("0.00", CultureInfo.InvariantCulture) + " km" : Mathf.RoundToInt(metres) + " m";

        void DrawSettings(Rect content)
        {
            float y = content.y + 16f;
            const float lineH = 36f;
            DrawSettingRow(content, ref y, lineH, 0, "Graphics preset", ((QualityPresets.Preset)GameSettings.Preset).ToString());
            DrawSettingRow(content, ref y, lineH, 1, "FPS cap", GameSettings.FpsCap > 0 ? GameSettings.FpsCap + " fps" : "None");
            DrawSettingRow(content, ref y, lineH, 2, "Field of view", GameSettings.Fov.ToString("0") + "°");
            DrawSettingRow(content, ref y, lineH, 3, "Motion blur", GameSettings.MotionBlur ? "On" : "Off");
            DrawSettingRow(content, ref y, lineH, 4, "Camera shake", GameSettings.CameraShake ? "On" : "Off");
            DrawSettingRow(content, ref y, lineH, 5, "Master volume", Mathf.RoundToInt(GameSettings.MasterVolume * 100f) + "%");
            DrawSettingRow(content, ref y, lineH, 6, "SFX volume", Mathf.RoundToInt(GameSettings.SfxVolume * 100f) + "%");
            DrawSettingRow(content, ref y, lineH, 7, "Mouse sensitivity", GameSettings.MouseSensitivity.ToString("0.0"));
            DrawSettingRow(content, ref y, lineH, 8, "Invert Y", GameSettings.InvertY ? "On" : "Off");
            DrawSettingRow(content, ref y, lineH, 9, "Subtitles", GameSettings.Subtitles ? "On" : "Off");
            DrawSettingRow(content, ref y, lineH, 10, "HUD", GameSettings.HudEnabled ? "On" : "Off");
            DrawSettingRow(content, ref y, lineH, 11, "Minimap zoom", GameSettings.MinimapZoom.ToString("0.0") + "x");
        }

        void DrawSettingRow(Rect content, ref float y, float lineH, int row, string label, string value)
        {
            bool focused = focusIndex == row;
            var rowRect = new Rect(content.x + 20f, y, content.width - 40f, lineH - 4f);
            if (focused) MenuGfx.Panel(rowRect, new Color(1f, 0.28f, 0.62f, 0.14f));

            rowLabelStyle ??= new GUIStyle(GUI.skin.label) { fontSize = 19 };
            valueStyle ??= new GUIStyle(GUI.skin.label) { fontSize = 19, alignment = TextAnchor.MiddleRight };
            rowLabelStyle.normal.textColor = focused ? Color.white : new Color(0.85f, 0.85f, 0.9f);
            valueStyle.normal.textColor = focused ? MenuGfx.Cyan : new Color(0.7f, 0.85f, 0.9f);

            GUI.Label(new Rect(rowRect.x + 20f, rowRect.y, rowRect.width * 0.5f, rowRect.height), label, rowLabelStyle);

            var leftArrow = new Rect(rowRect.xMax - 260f, rowRect.y, 30f, rowRect.height);
            var valueRect = new Rect(rowRect.xMax - 220f, rowRect.y, 140f, rowRect.height);
            var rightArrow = new Rect(rowRect.xMax - 60f, rowRect.y, 30f, rowRect.height);
            if (GUI.Button(leftArrow, "◀", GUI.skin.label)) { focusIndex = row; AdjustRow((Tab)currentTab, row, -1); }
            GUI.Label(valueRect, value, valueStyle);
            if (GUI.Button(rightArrow, "▶", GUI.skin.label)) { focusIndex = row; AdjustRow((Tab)currentTab, row, 1); }

            if (Event.current.type == EventType.MouseDown && rowRect.Contains(Event.current.mousePosition)) focusIndex = row;

            y += lineH;
        }

        void DrawSaveGame(Rect content)
        {
            float y = content.y + 30f;
            const float lineH = 70f;
            for (int i = 0; i < SaveSystem.SlotCount; i++)
            {
                bool exists = SaveSystem.TryDescribeSlot(i, out string savedAt);
                string label = "Slot " + (i + 1) + (exists ? " - " + FriendlyTime(savedAt) : " - empty");
                DrawSlotButton(content, y, lineH, i, "Save to " + label, () =>
                {
                    SaveSystem.SaveToSlot(i);
                    Flash("Saved to slot " + (i + 1));
                });
                y += lineH;
            }
        }

        void DrawLoadGame(Rect content)
        {
            float y = content.y + 30f;
            const float lineH = 70f;
            for (int i = 0; i < SaveSystem.SlotCount; i++)
            {
                bool exists = SaveSystem.TryDescribeSlot(i, out string savedAt);
                string label = exists ? "Slot " + (i + 1) + " - " + FriendlyTime(savedAt) : "Slot " + (i + 1) + " - empty";
                int slot = i;
                DrawSlotButton(content, y, lineH, i, label, () =>
                {
                    if (SaveSystem.LoadFromSlot(slot)) Flash("Loaded slot " + (slot + 1));
                    else Flash("Slot " + (slot + 1) + " is empty");
                });
                y += lineH;
            }
            bool autosaveExists = SaveSystem.AutosaveExists(out string autosaveAt);
            string autosaveLabel = autosaveExists ? "Autosave - " + FriendlyTime(autosaveAt) : "Autosave - none yet";
            DrawSlotButton(content, y, lineH, SaveSystem.SlotCount, autosaveLabel, () =>
            {
                if (SaveSystem.LoadAutosave()) Flash("Loaded autosave");
                else Flash("No autosave yet");
            });
        }

        void DrawSlotButton(Rect content, float y, float lineH, int row, string label, System.Action onActivate)
        {
            buttonStyle ??= new GUIStyle(GUI.skin.button) { fontSize = 20 };
            var rect = new Rect(content.x + 40f, y, content.width - 80f, lineH - 14f);
            if (MenuGfx.Button(rect, label, focusIndex == row, buttonStyle))
            {
                focusIndex = row;
                onActivate();
            }
        }

        static string FriendlyTime(string savedAtIso)
        {
            if (System.DateTime.TryParse(savedAtIso, CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.RoundtripKind, out System.DateTime dt))
                return dt.ToLocalTime().ToString("MMM d, HH:mm", CultureInfo.InvariantCulture);
            return "saved";
        }

        void DrawQuit(Rect content)
        {
            rowLabelStyle ??= new GUIStyle(GUI.skin.label) { fontSize = 20, alignment = TextAnchor.MiddleCenter, wordWrap = true };
            rowLabelStyle.normal.textColor = new Color(0.9f, 0.9f, 0.95f);
            GUI.Label(new Rect(content.x + 60f, content.y + 30f, content.width - 120f, 60f), "Any unsaved progress since your last save will be lost.", rowLabelStyle);
            DrawBigButton(content, 0, "Quit to desktop", QuitToDesktop);
        }

        void DrawBigButton(Rect content, int row, string label, System.Action onActivate)
        {
            buttonStyle ??= new GUIStyle(GUI.skin.button) { fontSize = 22, fontStyle = FontStyle.Bold };
            var rect = new Rect(content.x + content.width * 0.5f - 160f, content.yMax - 130f, 320f, 56f);
            if (MenuGfx.Button(rect, label, focusIndex == row, buttonStyle))
            {
                focusIndex = row;
                onActivate();
            }
        }
    }
}
