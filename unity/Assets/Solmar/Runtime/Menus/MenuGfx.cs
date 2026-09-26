using UnityEngine;

namespace Solmar.Menus
{
    /// <summary>Small, code-only drawing helpers shared by the pause menu: dark translucent panels, a
    /// per-letter sunset-gradient title in SOLMAR's pink/cyan Miami palette, and a keyboard/mouse
    /// button that can be driven by either. Nothing here is a MonoBehaviour; it's called from
    /// <see cref="PauseMenu"/>'s OnGUI.</summary>
    static class MenuGfx
    {
        public static readonly Color Pink = new Color(1f, 0.28f, 0.62f);
        public static readonly Color Cyan = new Color(0.25f, 0.92f, 0.98f);
        public static readonly Color Orange = new Color(1f, 0.55f, 0.22f);
        public static readonly Color Purple = new Color(0.55f, 0.28f, 0.85f);
        public static readonly Color PanelDark = new Color(0.05f, 0.04f, 0.09f, 0.86f);
        public static readonly Color PanelLight = new Color(0.12f, 0.09f, 0.18f, 0.9f);

        /// <summary>Fills `rect` with a flat translucent colour - the same GUI.color + whiteTexture
        /// trick the rest of SOLMAR's overlays already use.</summary>
        public static void Panel(Rect rect, Color color)
        {
            Color prev = GUI.color;
            GUI.color = color;
            GUI.DrawTexture(rect, Texture2D.whiteTexture);
            GUI.color = prev;
        }

        public static void HLine(float x, float y, float width, float thickness, Color color)
        {
            Panel(new Rect(x, y, width, thickness), color);
        }

        /// <summary>Draws `text` one letter at a time, each tinted along a pink -> orange -> purple ->
        /// cyan sunset gradient, faking gradient text without a shader.</summary>
        public static float GradientTitle(float centerX, float y, string text, int fontSize)
        {
            var style = new GUIStyle(GUI.skin.label) { fontSize = fontSize, fontStyle = FontStyle.Bold, alignment = TextAnchor.UpperLeft };
            float totalWidth = 0f;
            var widths = new float[text.Length];
            for (int i = 0; i < text.Length; i++)
            {
                widths[i] = style.CalcSize(new GUIContent(text[i].ToString())).x;
                totalWidth += widths[i];
            }

            float x = centerX - totalWidth * 0.5f;
            Color prev = GUI.color;
            for (int i = 0; i < text.Length; i++)
            {
                float t = text.Length <= 1 ? 0f : (float)i / (text.Length - 1);
                Color c = SunsetAt(t);
                var shadowStyle = style;
                GUI.color = new Color(0f, 0f, 0f, 0.55f);
                GUI.Label(new Rect(x + 2f, y + 2f, widths[i] + 4f, fontSize * 1.4f), text[i].ToString(), shadowStyle);
                GUI.color = c;
                GUI.Label(new Rect(x, y, widths[i] + 4f, fontSize * 1.4f), text[i].ToString(), shadowStyle);
                x += widths[i];
            }
            GUI.color = prev;
            return totalWidth;
        }

        static Color SunsetAt(float t)
        {
            if (t < 0.33f) return Color.Lerp(Pink, Orange, t / 0.33f);
            if (t < 0.66f) return Color.Lerp(Orange, Purple, (t - 0.33f) / 0.33f);
            return Color.Lerp(Purple, Cyan, (t - 0.66f) / 0.34f);
        }

        /// <summary>A button that lights up pink when it has keyboard focus and draws with a cyan
        /// border when it's the primary/selected item; true if clicked or activated by Enter while
        /// focused (the caller passes that in as `activateHeld`).</summary>
        public static bool Button(Rect rect, string label, bool focused, GUIStyle style)
        {
            Color prevBg = GUI.backgroundColor;
            Color prevColor = GUI.color;
            GUI.backgroundColor = focused ? new Color(1f, 0.28f, 0.62f, 0.35f) : new Color(1f, 1f, 1f, 0.06f);
            style.normal.textColor = focused ? Color.white : new Color(0.85f, 0.85f, 0.9f);
            bool clicked = GUI.Button(rect, label, style);
            if (focused) HLine(rect.x, rect.yMax - 2f, rect.width, 2f, Cyan);
            GUI.backgroundColor = prevBg;
            GUI.color = prevColor;
            return clicked;
        }
    }
}
