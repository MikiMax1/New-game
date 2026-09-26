namespace Solmar.City.Roads
{
    /// <summary>
    /// The district's dimensions, taken from the same real-world numbers as the single street
    /// (Layout.cs): 3.3 m lanes, a 2.4 m parking lane, 15 cm kerbs and 4 m pavements.
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
    }
}
