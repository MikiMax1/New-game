using Solmar.Traffic;
using UnityEngine;

namespace Solmar.City.Roads
{
    /// <summary>
    /// Lights the city's signal heads (<see cref="RoadFurniture.Signals"/>) to match the traffic
    /// controllers (<see cref="TrafficSignals.StateFor"/>) a few times a second, by swapping the
    /// materials of each head's lens slots. A head whose approach has no controller shows red.
    /// </summary>
    public sealed class SignalLamps : MonoBehaviour
    {
        const float Interval = 0.2f;

        Material[][] byState;
        int[] shown;
        float timer;

        void Update()
        {
            if (!Application.isPlaying) return;
            timer -= Time.deltaTime;
            if (timer > 0f) return;
            timer = Interval;

            var signals = RoadFurniture.Signals;
            if (signals.Count == 0 || RoadFurniture.LitRed == null) return;
            if (byState == null || shown == null || shown.Length != signals.Count)
            {
                MeshRenderer first = signals[0].Renderer;
                if (first == null) return;
                Material[] template = first.sharedMaterials;
                byState = new Material[3][];
                for (int s = 0; s < 3; s++)
                {
                    var mats = (Material[])template.Clone();
                    if (!Valid(mats)) return;
                    mats[RoadFurniture.RedSlot] = s == 0 ? RoadFurniture.LitRed : RoadFurniture.Unlit;
                    mats[RoadFurniture.AmberSlot] = s == 1 ? RoadFurniture.LitAmber : RoadFurniture.Unlit;
                    mats[RoadFurniture.GreenSlot] = s == 2 ? RoadFurniture.LitGreen : RoadFurniture.Unlit;
                    byState[s] = mats;
                }
                shown = new int[signals.Count];
                for (int i = 0; i < shown.Length; i++) shown[i] = -1;
            }

            for (int i = 0; i < signals.Count; i++)
            {
                RoadFurniture.Signal sig = signals[i];
                if (sig.Renderer == null) continue;
                int state = TrafficSignals.StateFor(sig.Node, sig.Edge) switch
                {
                    SignalState.Green => 2,
                    SignalState.Amber => 1,
                    _ => 0,
                };
                if (shown[i] == state) continue;
                shown[i] = state;
                sig.Renderer.sharedMaterials = byState[state];
            }
        }

        static bool Valid(Material[] mats)
        {
            int n = mats.Length;
            return RoadFurniture.RedSlot < n && RoadFurniture.AmberSlot < n && RoadFurniture.GreenSlot < n;
        }
    }
}
