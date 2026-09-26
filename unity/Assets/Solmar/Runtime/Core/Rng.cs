namespace Solmar
{
    /// <summary>
    /// Small deterministic random number generator (mulberry32), so the city is the same on every
    /// run and on every machine.
    /// </summary>
    public sealed class Rng
    {
        uint state;

        public Rng(uint seed)
        {
            state = seed;
        }

        /// <summary>A number in [0, 1).</summary>
        public float Next()
        {
            unchecked
            {
                state += 0x6D2B79F5u;
                uint t = state;
                t = (t ^ (t >> 15)) * (t | 1u);
                t ^= t + (t ^ (t >> 7)) * (t | 61u);
                return ((t ^ (t >> 14)) >> 8) / 16777216f;
            }
        }

        /// <summary>A number in [min, max).</summary>
        public float Range(float min, float max)
        {
            return min + (max - min) * Next();
        }

        /// <summary>An integer in [min, max).</summary>
        public int Range(int min, int max)
        {
            return min + (int)(Next() * (max - min)) % System.Math.Max(1, max - min);
        }
    }
}
