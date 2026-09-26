namespace Solmar.City
{
    /// <summary>
    /// The street's plan, in metres; everything in the city is placed from these numbers.
    ///
    /// The street runs along x: two traffic lanes and a parking lane each way, 4 m pavements and
    /// buildings on both sides. y is up; the road surface is at about y = 0 (a few centimetres of
    /// crown), the pavements at about y = 0.15.
    ///
    ///   z:  +13.0  building line (north)
    ///       +9.0   kerb face (north); pavement 4 m wide between
    ///       +6.6   parking lane edge line (solid white)
    ///       +3.3   lane line (dashed white)
    ///        0     centre line (double yellow)
    ///       -3.3   lane line (dashed white)
    ///       -6.6   parking lane edge line (solid white)
    ///       -9.0   kerb face (south)
    ///       -13.0  building line (south)
    ///
    /// A signalised crossing with a zebra crosswalk and kerb ramps sits at x = CrossingX.
    /// </summary>
    public static class Layout
    {
        public const float LaneWidth = 3.3f;
        public const float ParkingWidth = 2.4f;
        /// <summary>z of the kerb faces: two lanes and a parking lane each way.</summary>
        public const float KerbZ = LaneWidth * 2f + ParkingWidth;
        public const float KerbHeight = 0.15f;
        public const float PavementWidth = 4f;
        /// <summary>z of the building lines (facade planes).</summary>
        public const float BuildingZ = KerbZ + PavementWidth;
        /// <summary>z of the parking-lane edge lines.</summary>
        public const float ParkingZ = KerbZ - ParkingWidth;
        /// <summary>Half the length of the modelled street; buildings continue beyond as distant blocks.</summary>
        public const float StreetHalfLength = 90f;
        public const float CrossingX = -14f;
        public const float CrosswalkWidth = 4f;
        public const float RampWidth = 2.4f;
        /// <summary>Street lamps along each side, the two sides staggered by half a spacing.</summary>
        public const float LampSpacing = 26f;
    }
}
