namespace Solmar.City.Roads
{
    /// <summary>
    /// The city's road dimensions, taken from the same real-world numbers as the single street
    /// (Layout.cs): 3.3 m lanes, a 2.4 m parking lane, 15 cm kerbs and 4 m pavements, plus the
    /// crosswalk, stop-line and kerb-corner sizes every junction is laid out with.
    /// </summary>
    public static class RoadWidths
    {
        public const float LaneWidth = Layout.LaneWidth;
        public const float ParkingWidth = Layout.ParkingWidth;
        public const float KerbHeight = Layout.KerbHeight;
        public const float DefaultSidewalk = Layout.PavementWidth;
        public const float RampWidth = Layout.RampWidth;

        /// <summary>Approximate height of the road surface at its gutters (kerb faces), where the pavement and the plate meet it.</summary>
        public const float GutterHeight = 0.02f;

        /// <summary>Depth of a crosswalk along the road, measured from where the road meets the junction.</summary>
        public const float CrosswalkDepth = 3.6f;

        /// <summary>Gap between the far side of a crosswalk and the stop line behind it.</summary>
        public const float StopLineGap = 1f;

        /// <summary>Radius of the rounded kerb at a street corner (smaller at sharp corners).</summary>
        public const float CornerRadius = 5f;
    }
}
